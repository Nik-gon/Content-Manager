# Auto Manager — Documentación Técnica (para desarrolladores)

**Estado:** v2 multi-tenant, en validación (ver sección 9, "qué está verificado y qué no").
**Última actualización:** alineada con `Backend.js`, `Index.html` y el blueprint `Integration Google Sheets` vigentes (octubre 2026).
**Stack:** Google Apps Script (backend + frontend servido como Web App) + Google Sheets (base de datos) + Cloudinary (medios) + Make.com (orquestación) + Gemini (copywriting) + Instagram Business API (publicación).

---

## 1. Qué es el sistema

Plataforma multi-tenant que permite a emprendimientos chicos (indumentaria, retail local) armar y publicar contenido en Instagram sin trabajo manual de redacción ni de subida.

- El dueño del negocio entra a una **Web App** (Apps Script), arma el posteo (arrastra fotos/videos, pie de foto opcional) y lo manda a una cola.
- **Make.com** procesa la cola: si no hay pie de foto, lo genera con **Gemini**; publica en Instagram (Feed, Reel o Carrusel); marca la fila como enviada.
- **Cloudinary** aloja y transforma los medios (conversión a `.jpg`, padding a cuadrado para carrusel).

Es **multi-tenant con aislamiento físico de datos**: un Sheet Maestro (usuarios + config global) y un Sheet independiente por cliente (su catálogo, su cola, su configuración). Se eligió este modelo (en vez de un sheet único con columna `ClienteID`) priorizando que un bug de filtrado nunca exponga datos entre clientes, a costa de más trabajo manual de alta. Válido para la escala objetivo (~20 clientes).

---

## 2. Arquitectura end-to-end

```
[Dueño del negocio]
   → Web App (login) → abre SU Sheet de datos (openById, resuelto por sesión)
        - Diseñador de Posts: arma carrusel/foto/video, pie de foto opcional
        → Cola_Publicacion (Estado = Pendiente) en el Sheet del cliente

[Make.com — 1 escenario por cliente, "Integration Google Sheets"]
   0. HTTP → Apps Script (action=reciclarCola): si la cola no tiene Pendientes y el
      cliente tiene Iterativo activo, el backend reinicia la cola (ver 6.2)
   1. Lee 1 fila Pendiente de Cola_Publicacion (orden: Orden_Ejecucion asc)
   2. Router de 3 ramas:
        cola vacía (col A no existe)  → termina limpio (placeholder)
        Pie_Foto manual               → usa ese texto
        sin Pie_Foto                  → busca Producto + Galeria_Medios, llama a Gemini
   3. Sub-router por Formato/URL → Imagen / Video (Reel) / Carrusel
   4. Publica en Instagram (instagram-business, accountId del cliente)
   5. Update Row: Estado = Enviado   (Fecha_Publicacion: pendiente de mapear — ver 6.1)
```

El reciclado **ya no es un escenario aparte**: está integrado como primer módulo del escenario principal y la lógica vive en el backend de Apps Script (ver 6.2).

**Componentes y rol:**

| Componente | Tecnología | Rol |
|---|---|---|
| Frontend | HTML + Tailwind (CDN) + SortableJS (SRI) + Emoji Picker Element (SRI) + Font Awesome + Widget de subida de Cloudinary | SPA servida por Apps Script, responsive (menú lateral con hamburguesa bajo 1024 px) |
| Backend | Google Apps Script | Auth, multi-tenant (resuelve el Sheet del cliente), CRUD, endpoint de reciclado para Make |
| Sheet Maestro | Google Sheets | `Usuarios`, `Configuracion_Global` |
| Sheet de cliente (uno por cliente) | Google Sheets | `Productos`, `Categorias_Config`, `Galeria_Medios`, `Cola_Publicacion`, `Configuracion` |
| Medios | Cloudinary (widget Unsigned) | Hosting + transformación |
| Orquestación | Make.com (1 escenario por cliente) | Dispara el reciclado, consume la cola, genera el copy, publica |
| IA de copywriting | Gemini `gemini-2.5-flash-lite` (módulo nativo `gemini-ai` en Make) | Redacta el pie de foto si está vacío |
| Publicación | Instagram Business API (conector nativo de Make) | Feed / Reel / Carrusel |

---

## 3. Modelo de datos

### 3.1 Sheet Maestro

El script de Apps Script está vinculado a **este** spreadsheet (no al de ningún cliente).

**Pestaña `Usuarios`** (fila 1 = encabezados, 1 fila = 1 usuario):

| Col | Campo | Notas |
|---|---|---|
| A | `ID_Usuario` | `USR-XXXXXXXX`, autogenerado |
| B | `Email` | login, único (se guarda en minúsculas) |
| C | `Telefono` | |
| D | `Nombre_Negocio` | editable por el cliente desde Configuración → Información personal |
| E | `Password_Hash` | `v2$` + SHA-256 con 2000 iteraciones y salt. Los hashes viejos (SHA-256 simple, sin prefijo) se migran solos al próximo login correcto. **Nunca texto plano** |
| F | `Password_Salt` | UUID por usuario |
| G | `Estado` | `Pendiente_Aprobacion` / `Activo` / `Suspendido` |
| H | `Plan` | `Instalacion_Unica` / `Abonado` — lo completa el admin al aprobar (`aprobarCliente` lo valida) |
| I | `ID_Sheet_Cliente` | Spreadsheet ID del Sheet de datos del cliente — lo completa el admin al aprobar |
| J | `Fecha_Registro` | |
| K | `Fecha_Aprobacion` | |
| L | `Token_Sesion` | guarda el **hash** del token (`t1$…`), no el token. El navegador recibe el token real. Se regenera en cada login y se vacía en logout |
| M | `Ultimo_Login` | base del vencimiento de la sesión (debe ser una fecha válida; si no, la sesión se considera vencida) |

Los índices de columna están en la constante `COL` (base 0) en `Backend.js` — tocar ahí si cambia el esquema.

**Pestaña `Configuracion_Global`** — clave-valor horizontal (fila 1 = claves, fila 2 = valores; el parser también acepta el formato vertical `Clave | Valor` si la celda A1 dice `Clave`):

| Clave | Uso |
|---|---|
| `WHATSAPP_NUMERO` | `normalizarTelefonoAR_` completa el prefijo: un número de 10 dígitos (`1167964852`) pasa a `5491167964852`; igual conviene cargarlo completo y como texto |
| `WHATSAPP_MENSAJE_DEFAULT` | texto precargado del link `wa.me` |
| `EMAIL_CONTACTO` | mostrado en Configuración → Contacto |
| `MENSAJE_PENDIENTE_APROBACION` | pantalla de estado para cuentas sin aprobar |
| `MENSAJE_SUSPENDIDO` | pantalla de estado para cuentas suspendidas |

⚠️ Es de lectura **pública** (`obtenerConfiguracionGlobal` no requiere sesión, se usa antes del login): no guardar nada sensible ahí.

### 3.2 Sheet de cada cliente (uno por cliente, independiente)

**`Productos`**: `SKU` | `Nombre` | `Stock` | `Estado` (`Activo`/`Inactivo`/`Borrador`).

**`Categorias_Config`**: `ID_Categoria` (`MOD`/`PROD`/`BRANDED`, se detecta por substring sin distinguir mayúsculas) | `Nombre_Visible` | `Orden_Prioridad` (orden de tabs en el Diseñador).

**`Galeria_Medios`**: `ID_Medio` (`MED-XXXXXXX`) | `SKU` | `ID_Categoria` | `URL` (imagen o video).

> ⚠️ **Solo se pueden encolar URLs de Cloudinary.** El backend valida (`urlValida_`) que toda URL de medio sea `https://res.cloudinary.com/<cloud>/(image|video)/upload/…`, sin espacios, `*`, comillas ni `<>`, de hasta 500 caracteres. Si se cargan a mano medios de otro host (por ejemplo `acdn-us.mitiendanube.com`), esos archivos **se ven en la galería pero `enviarAColaPublicacion` y `actualizarPostCola` los rechazan** ("Uno de los archivos tiene una dirección inválida"). En la planilla de referencia hay 2 medios así.

**`Cola_Publicacion`** — la tabla central del sistema (1 fila = 1 publicación ya armada, no 1 producto):

| Col | Campo | Notas |
|---|---|---|
| A | `ID` | `POST-XXXXXX`. El backend usa la posición, no el nombre del encabezado (en la planilla de referencia la columna se llama `ID_Carrusel`; es indistinto) |
| B | `SKU` | |
| C | `Formato` | `Feed` (1 archivo) / `Carrusel` (2+) — lo calcula el backend; Make sub-clasifica Imagen vs Video dentro de `Feed` mirando si la URL contiene `/video/` |
| D | `URLs_Payload` | URLs separadas por `" * "` (asterisco con espacios); el orden es el de publicación |
| E | `Estado` | `Pendiente` / `Enviado` |
| F | `Timestamp` | fecha de creación |
| G | `Pie_Foto` | vacío = lo redacta Gemini |
| H | `Orden_Ejecucion` | define el orden de procesamiento en Make (ver 3.3) |
| I | `Fecha_Publicacion` | fecha en que Make efectivamente publicó. Se crea sola (`asegurarColumnaFechaPublicacion_`) si falta, al llamar `getInitialData`. **Make todavía no la completa** (ver 6.1) |

**`Configuracion`** (clave-valor vertical, una fila por clave; encabezados `Clave | Valor`):

| Clave | Valores | Uso |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | texto (`[A-Za-z0-9_-]`, ≤100) | credencial Cloudinary |
| `CLOUDINARY_UPLOAD_PRESET` | texto (≤100) | credencial Cloudinary (preset *Unsigned*) |
| `CiclicoOK` | `1` (cíclico, por timestamp) / `0` (aleatorio) | orden de `Orden_Ejecucion` |
| `RecicladoAutomatico` | `1` / `0`, ausente = `0` | activa el reciclado desde la UI (interruptor "Iterativo"); lo lee el endpoint de reciclado |

Al navegador solo llegan estas cuatro claves (lista blanca en `getInitialData`): si se agrega un secreto a esta hoja, no se filtra al front.

### 3.3 Lógica de `Orden_Ejecucion`

`reordenarInterno_(ss)` recorre todas las filas `Pendiente` y recalcula la columna H:
- `CiclicoOK = '0'` (Aleatorio): número aleatorio.
- `CiclicoOK = '1'` (Cíclico, default): `new Date(Timestamp).getTime()`.

Como el reciclado no modifica `Timestamp`, el orden cronológico original se preserva solo; igualmente el backend llama a `reordenarInterno_` al terminar de reciclar.

---

## 4. Backend (Apps Script — `Backend.js`)

### 4.1 Patrón general (multi-tenant)

Toda función que toca datos de un cliente sigue el mismo patrón:

```
function algo(token, ...otrosParams) {
  var ss = ctx_(token).ss;     // valida sesión + abre el sheet del cliente (openById)
  // ... trabaja sobre ss ...
}
```

`ctx_(token)` llama a `requireSesion_(token)` (busca el hash del token en `Usuarios`, valida `Estado = Activo` y vigencia, devuelve `idSheetCliente`) y hace `SpreadsheetApp.openById`. Las escrituras van dentro de `conLock_` (lock de script, espera hasta 20 s). Los textos se guardan con `setNumberFormat('@')` para que Sheets no interprete nada como fórmula (importante para pies de foto que empiecen con `=`). Cuando una cuenta se suspende, `requireSesion_` le borra el token en la próxima llamada.

### 4.2 Seguridad (parámetros en la cabecera del archivo)

| Constante | Valor | Qué controla |
|---|---|---|
| `SESION_DIAS` | 14 | vencimiento de la sesión; **no se renueva por uso** |
| `MAX_INTENTOS` / `BLOQUEO_SEG` | 5 / 900 | intentos fallidos de login por email dentro de una ventana **fija** de 15 min (`CacheService`); se limpia al ingresar bien |
| `PASSWORD_MIN` | 10 | largo mínimo (registro y cambio de contraseña; las cuentas existentes con clave más corta siguen entrando hasta que la cambien). El front valida lo mismo |
| `MAX_REGISTROS_HORA` | 30 | tope **global** de altas por hora (anti-spam) |
| `HASH_ITERACIONES` | 2000 | stretching del hash v2 (`medirCostoHash` mide cuánto tarda) |
| `TOKEN_PEPPER` | `am-session-v1` | pepper del hash del token de sesión |

Otras medidas: comparación de tiempo constante (`igualesConstante_`); mismo mensaje y mismo costo de hash para email inexistente y clave incorrecta; hash costoso del registro calculado fuera del lock; eventos de seguridad en consola vía `auditar_` (Ejecuciones → Registros; nunca se loguean contraseñas ni tokens); la Web App se sirve con `XFrameOptionsMode.DEFAULT` (no se puede incrustar en sitios ajenos).

### 4.3 Entradas HTTP

| Función | Qué hace |
|---|---|
| `doGet(e)` | Sirve `Index.html`. **Compatibilidad legacy:** si llega `?action=reciclarCola`, ejecuta el reciclado por GET (deja la clave en la URL → queda en logs). Marcado en el código para borrarse cuando Make migre a POST |
| `doPost(e)` | Recibe `action=reciclarCola`, `key`, `idSheet` (formulario o JSON) y ejecuta el reciclado |

`procesarReciclado_` valida `key` contra la propiedad de script **`MAKE_SECRET`** (Configuración del proyecto → Propiedades del script; nunca en el código), con espera de 1,5 s ante clave incorrecta, y solo opera si `idSheet` pertenece a un usuario **Activo** del Maestro (`sheetEsDeClienteActivo_`). Respuesta JSON con `estado`: `PENDIENTES_ACTIVOS`, `REINICIADO`, `IGNORADO` o `ERROR`.

### 4.4 Autenticación y cuenta

| Función | Firma | Qué hace |
|---|---|---|
| `registrarUsuario` | `(payload)` | Alta en `Usuarios`, `Estado = Pendiente_Aprobacion`. Valida campos, email, clave (≥10, distinta del email), largos y tope global/hora. Sin sesión |
| `loginUsuario` | `(email, password)` | Verifica hash (v1 o v2, migra a v2), aplica rate limit, genera token (2 UUID), guarda su hash + `Ultimo_Login`. Si el estado no es `Activo` devuelve `{ok:false, estado}` sin token |
| `logoutUsuario` | `(token)` | Invalida el token |
| `cambiarPassword` | `(token, actual, nueva)` | Requiere la clave actual; comparte el contador de intentos del login; nueva ≥10, distinta de la actual y del email |
| `obtenerConfiguracionGlobal` | `()` | Pública — WhatsApp (normalizado), mensajes de estado |
| `obtenerPerfil` | `(token)` | Devuelve `email`, `nombreNegocio`, `telefono`, `plan`, `estado`, `fechaRegistro`. Nunca expone hash/salt/token |
| `guardarPerfil` | `(token, nombre, telefono)` | Solo esos dos campos son editables por el cliente |

### 4.5 Datos del cliente (CRUD)

| Función | Firma | Qué hace |
|---|---|---|
| `getInitialData` | `(token)` | Carga completa: productos, categorías, medios, cola, config (lista blanca), `nombreNegocio`. Corre la migración de la columna `Fecha_Publicacion` |
| `guardarConfiguracion` | `(token, cloudName, uploadPreset)` | Credenciales Cloudinary, con validación de caracteres. Devuelve la config con `CiclicoOK` para no pisarlo en el front |
| `guardarModoDistribucion` | `(token, modo)` | `CiclicoOK`, reordena y devuelve la cola |
| `guardarModoIterativo` | `(token, activo)` | `RecicladoAutomatico`, devuelve `'1'`/`'0'` |
| `crearProductoConImagenes` | `(token, payload)` | Alta de producto + medios iniciales (SKU en mayúsculas ≤60, nombre ≤150, ≤50 medios, URLs validadas) |
| `actualizarProducto` | `(token, sku, nombre, stock, estado)` | Edición |
| `eliminarProducto` | `(token, sku)` | Baja **en cascada** (medios + cola) |
| `guardarNuevoMedio` / `eliminarMedio` | `(token, ...)` | ABM de galería (URL validada) |
| `enviarAColaPublicacion` | `(token, payload)` | Alta en `Cola_Publicacion` (1–10 URLs, pie ≤2200), calcula `Formato`, reordena |
| `eliminarPostCola` | `(token, idPost)` | Baja de un post |
| `actualizarPostCola` | `(token, payload)` | `{id, urls[], pieFoto, estado}`. Valida 1–10 URLs, pie ≤2200, `estado` solo `Pendiente`/`Enviado` (otro valor se ignora); recalcula `Formato`; limpia `Fecha_Publicacion` si vuelve a `Pendiente`; reordena |

### 4.6 Administración (solo ejecutables desde el editor por el dueño del script; `soloDueno_()` las bloquea desde la Web App)

| Función | Qué hace |
|---|---|
| `aprobarCliente(email, idSheet, plan)` | Alta segura: valida plan, formato del ID, que el Sheet abra y tenga las 5 pestañas, que no esté asignado a otro usuario; completa `ID_Sheet_Cliente`, `Plan`, `Fecha_Aprobacion` y pone `Estado = Activo`. Se invoca desde una función auxiliar (ver comentario en el código) |
| `verificarConfiguracion()` | Diagnóstico: usuarios, workspaces accesibles, Sheets duplicados entre usuarios, WhatsApp normalizado. Resultado en Registros |
| `medirCostoHash()` | Mide el costo de un hash v2 |

### 4.7 Internas

`conLock_`, `auditar_`, `hashPassword_` (v1, solo para verificar hashes viejos y el token), `hashPasswordV2_`, `verificarPassword_`, `igualesConstante_`, `hojaUsuarios_`, `hoja_` (falla con mensaje claro si falta una pestaña), `appendFila_`, `urlValida_`, `normalizarTelefonoAR_`, `obtenerCiclicoOK_`, `reordenarInterno_`, `leerColaInterno_` (formatea `fechaPublicacion` como `dd/MM/yyyy HH:mm` en la zona horaria del Sheet; devuelve la cola en orden inverso, la más nueva primero), `asegurarColumnaFechaPublicacion_`, `revisarYReiniciarColaInterno_` (ver 6.2).

---

## 5. Frontend (Index.html)

Dos `<script>` IIFE independientes, a propósito: **si el script de la app falla, el login sigue funcionando.** Librerías externas: Tailwind (CDN), SortableJS y Emoji Picker (con integridad SRI), Font Awesome 6.4, widget de subida de Cloudinary.

### 5.1 Script 1 — Autenticación

Expone globalmente `window.showToast(mensaje, tipo)` y `window.Auth = { getToken(), cerrarSesion(), getConfigGlobal() }`.

Responsabilidades: pantallas de login/registro/estado de cuenta, pantalla informativa "¿Qué es esto?" (`#info-overlay`), botones de WhatsApp (atributo `data-whatsapp`, resuelto contra `Configuracion_Global`), arranque de la app.

**Persistencia de sesión:**
- **"Recordar usuario"**: guarda solo el email en `localStorage` (`am_email_recordado`).
- **"Mantener la sesión iniciada"** (tildado por defecto): token en `localStorage`; destildado → `sessionStorage`. Clave `am_token`.
- **La contraseña nunca se guarda desde la app.** Los `<form>` son reales con `autocomplete` correcto para que sea el gestor de contraseñas del navegador quien la ofrezca (no garantizado dentro del iframe de Apps Script — no verificado).
- `cerrarSesion()` → `volverAlLogin()`: reinicia el estado (`App.reiniciar()`), limpia contraseñas/errores y muestra el login; no hace `location.reload()`.
- El registro exige contraseña de al menos **10 caracteres** (el backend lo vuelve a validar).

### 5.2 Script 2 — Aplicación

Expone `window.App = { iniciar(data), reiniciar() }`. Estado centralizado en `state`.

- **Backend:** helper `rpc(nombre, args, ok, fallo)` que antepone el token automáticamente. Funciones usadas: `obtenerPerfil`, `guardarPerfil`, `cambiarPassword`, `crearProductoConImagenes`, `actualizarProducto`, `eliminarProducto`, `guardarNuevoMedio`, `eliminarMedio`, `enviarAColaPublicacion`, `eliminarPostCola`, `actualizarPostCola`, `guardarConfiguracion`, `guardarModoDistribucion`, `guardarModoIterativo`.
- **Eventos por delegación:** los elementos llevan `data-action` + `data-arg` y un mapa `ACCIONES` resuelve la función; funciona con nodos creados dinámicamente.
- **DOM:** helper `el(tag, props, hijos)` en vez de `innerHTML`, para evitar XSS/comillas con nombres de producto o pies de foto con caracteres especiales.
- **Errores de sesión:** cualquier error del backend cuyo mensaje contenga "Sesión" dispara `manejarError()` → logout automático (cuenta suspendida o token vencido).
- **Subida a Cloudinary:** widget con fuentes `local` y `url`, formatos `jpg/jpeg/png/webp/heic/heif/mp4/mov`, máximo 15 MB por imagen y 100 MB por video; se inicializa solo si el cliente cargó Cloud Name y Upload Preset.

### 5.3 Vistas y funcionalidades

- **Inventario:** catálogo con buscador, alta de producto con fotos/videos en un paso, galería por producto, edición y baja.
- **Diseñador de posts:** combo de artículos (filtro por SKU/nombre sin distinguir mayúsculas/acentos, teclado, botón limpiar); pestañas de galería por categoría; zona de edición con arrastrar para reordenar y doble clic para quitar; pie de foto con selector de emojis; máximo 10 medios (validado en front **y** en backend).
- **"Automatizar con IA"**: 12 patrones (`PATRONES_MAGIA`: Lookbook, Catálogo comercial, Impacto simple, Portada y detalles, Historia de marca, Detalle total, Editorial, Dúo, Galería mixta, Antes de comprar, Identidad de marca, Desfile); no repite patrón dos veces seguidas ni foto repetida; patrones condicionados a las categorías que tenga el producto. **Es 100% local — no llama a Gemini ni a ningún modelo.** Importante mantener esa aclaración en cualquier material de cara al cliente.
- **Cola de envíos:** selector Cíclico/Aleatorio con botón "Aplicar"; interruptor **"Iterativo"** (guarda al tildar); columna de fecha de publicación; modal de edición de un post (quitar/reordenar medios, pie de foto, estado); baja de posts.
- **Configuración (4 pestañas):** *Información personal* (editable: nombre y teléfono; solo lectura: email, plan, estado, "cliente desde"; formulario de **cambio de contraseña**), *Contacto* (WhatsApp/email de soporte), *Cloudinary* (Cloud Name y Upload Preset), *Tutoriales* (guía por sección, cómo conseguir credenciales de Cloudinary, conexiones externas y seguridad, y el **recorrido guiado** `PASOS_TOUR`).
- **Responsive:** el login, la pantalla informativa y la app interna se adaptan; bajo 1024 px la barra lateral pasa a menú desplegable con botón de hamburguesa y overlay.

---

## 6. Automatización en Make.com

Blueprint de referencia: `Integration Google Sheets` (un solo escenario por cliente).

### 6.1 Flujo del escenario

0. **HTTP → Apps Script** (módulo 101, `action=reciclarCola`, `idSheet` del cliente, `key`): se ejecuta al inicio de cada corrida. Ver 6.2.
1. **Google Sheets → Search Rows** (módulo 2) en `Cola_Publicacion`: `Estado = Pendiente` **y** columna A no vacía, orden por `Orden_Ejecucion` (H) asc, límite 1.
2. **Router** (módulo 39) con 3 ramas:
   - `{{2.0}}` no existe (cola vacía) → `placeholder`, termina la corrida sin error. *Esto resuelve el pendiente histórico del Filter de cola vacía (se hizo con una rama del router, no con un Filter).*
   - `Pie_Foto` (`{{2.6}}`) no existe → busca `Productos` (por SKU) y `Galeria_Medios` (por primera URL) → **Gemini** (`gemini-2.5-flash-lite`) → publica con `{{55.result}}`. (Esta rama aparece rotulada "Camino manual" en el blueprint por un error de nombre; es la rama sin pie manual.)
   - `Pie_Foto` existe → publica con el texto tal cual.
3. **Sub-router** por `Formato` + contenido de la URL:

   | Formato | URL contiene "/video/" | Resultado |
   |---|---|---|
   | `Feed` | No | Imagen única (`CreatePostPhoto`) |
   | `Feed` | Sí | Reel (`CreateAReelPost`) |
   | `Carrusel` | — | Carrusel (`CreateCarouselPhoto`) vía Feeder (`split` por `" * "`) + Aggregator, con transformación Cloudinary `c_pad,w_1080,h_1080,b_auto,f_jpg` |

4. **Publica** en Instagram vía `instagram-business` (`accountId` configurado en cada uno de los 6 módulos de publicación).
5. **Update Row** (6 módulos, uno por camino: 75, 92, 93, 94, 95, 96): hoy solo mapea `Estado = Enviado`.
   > ⚠️ **Pendiente sin aplicar:** mapear también `Fecha_Publicacion` (columna I) con algo como `{{formatDate(now; "DD/MM/YYYY HH:mm"; "America/Argentina/Buenos_Aires")}}` **en los 6 módulos**. Si el módulo no muestra la columna nueva, usar **Refresh** dentro del módulo de Sheets. Hasta que se haga, la columna "Fecha de publicación" de la app queda vacía.

**Prompt de Gemini:** el texto de sistema y las instrucciones están **escritos a mano para la marca NOVAELA** (nombre de la marca, link de la tienda `novaelaintimates.mitiendanube.com` y hashtags fijos `#NOVAELA #ModaFemenina #EstiloNOVAELA`). Al clonar el escenario para otro cliente hay que reemplazarlos. Instrucciones diferenciadas por tipo de imagen principal (`MOD` lifestyle / `PROD` calidad y textura / `BRANDED` cercanía con la marca) y llamado a la acción por escasez si `Stock < 5`. El módulo tiene activado `google_search_context`.

### 6.2 Reciclado ("Iterativo")

Lo ejecuta el **backend** (`revisarYReiniciarColaInterno_`) cuando Make lo llama (módulo 101 al inicio de cada corrida):

1. Si queda alguna fila `Pendiente` → responde `PENDIENTES_ACTIVOS` y no toca nada.
2. Si no hay pendientes, lee `Configuracion.RecicladoAutomatico`. Si es `1`: pone **todas** las filas en `Pendiente`, **vacía `Pie_Foto` (G) y `Fecha_Publicacion` (I)**, y reordena según `CiclicoOK` → responde `REINICIADO`.
3. Si es `0` → responde `IGNORADO`.

Como corre antes del `Search Rows`, en la misma corrida en que se vacía la cola ya se publica el primer post reciclado. No hay un escenario de reciclado separado ni una programación aparte: **la frecuencia es la del escenario principal**. El cambio de `Fecha_Publicacion` en el reciclado (pendiente en la versión anterior de este documento) **ya está resuelto en el backend**.

> ⚠️ **Problemas detectados en el módulo HTTP del blueprint actual (a corregir antes de entregar a un cliente):**
> 1. **Usa la URL `/dev`** de la Web App (deployment de prueba: solo funciona con la sesión del dueño y sirve siempre el último código guardado). Debe apuntar a la URL **`/exec`** de la implementación publicada.
> 2. **Usa GET con la clave en la URL** (`?action=reciclarCola&idSheet=…&key=…`). Es el camino legacy: la clave queda en logs de Make y de Google. Migrar a **POST** (`doPost` ya está implementado; enviar `action`, `key` e `idSheet` como formulario o JSON) y después borrar el bloque de compatibilidad de `doGet`.
> 3. **El blueprint contiene en texto plano el `MAKE_SECRET` y el `idSheet`** del cliente de prueba. Si el archivo se comparte o se entrega a un cliente "Instalación Única", **rotar el `MAKE_SECRET`** (Propiedades del script) y cambiar el `idSheet` en cada copia.

### 6.3 Credenciales y cuentas en Make

- Conexión de Google Sheets (`__IMTCONN__`) y de Instagram propias de cada escenario.
- `accountId` de Instagram del blueprint de referencia: `17841439199985986` en los 6 módulos de publicación — **confirmar que sea la cuenta comercial real y no la de prueba** antes de activar un cliente.

---

## 7. Permisos y cuentas externas (checklist técnica)

- [ ] Instagram: cuenta **Empresa/Creador**, vinculada a una Página de Facebook, con el dueño del negocio como administrador de control total de esa página.
- [ ] `accountId` del módulo `instagram-business` en Make apunta a la cuenta comercial real del cliente (no a una cuenta de prueba) — en los 6 módulos.
- [ ] Cuenta de Google que corre Apps Script: **editora** de cada Sheet de cliente (requisito de `openById`).
- [ ] Web App desplegada con acceso **"Cualquier usuario, incluso anónimo"** y ejecutándose como el dueño; Make llama a la URL `/exec`.
- [ ] Propiedad de script `MAKE_SECRET` definida (si falta, el reciclado responde "No autorizado").
- [ ] Cloudinary: cuenta + upload preset tipo **Unsigned**.

---

## 8. Limitaciones y decisiones conocidas

- **Iterativo borra pies de foto manuales** en cada ciclo (los vacía el reciclado para que Gemini genere textos nuevos) — está avisado en la UI con un cuadro informativo, pero es irreversible.
- **Sesión:** vence a los **14 días** del último login; no se renueva por uso. Hay que cambiar `SESION_DIAS` para ajustarlo.
- **Tope de registros:** 30 altas por hora en total (todo el sistema), no por IP.
- **`obtenerConfiguracionGlobal` es pública** (se llama antes del login) — no cargar nada sensible en `Configuracion_Global`.
- **Solo URLs de Cloudinary** pueden encolarse (ver 3.2).
- **Gemini y marca:** el prompt está fijo para NOVAELA; no hay prompt por cliente en la app.
- **El hash de contraseña es SHA-256 iterado 2000 veces** (limitado por lo que ofrece Apps Script, que no tiene bcrypt/argon2). Se puede subir `HASH_ITERACIONES` midiendo antes con `medirCostoHash`.
- "Automatizar con IA" es selección local de patrones, no IA real.
- El límite de 10 medios por carrusel está validado en front y en backend.
- Cada alta de un cliente sigue siendo manual (ver Guía de Implementación).

---

## 9. Qué está verificado y qué no (estado a la fecha de este documento)

**Verificado en una revisión de código** (lectura de `Backend.js`, `Index.html` y el blueprint contra esta documentación): firmas y comportamiento de todas las funciones del backend, llamadas `rpc` del front, estructura del escenario de Make, esquema de las planillas de referencia.

**Verificado en pruebas anteriores** (sobre archivos con los parches aplicados, fuera del entorno real): sintaxis de backend y frontend, ids duplicados, manejadores de `data-action`, flujos de login/logout/recordar sesión, combo, automatizador, modal de edición, iterativo, perfil, tutoriales y guía interactiva.

**NO verificado** (requiere el entorno real del cliente/proveedor; no se ejecutó nada contra Apps Script ni Make en esta actualización):
- Renderizado real en celular (menú lateral, modales, guía interactiva, pantalla informativa).
- Llamada real Make → Apps Script (`/exec` con POST), incluyendo el `MAKE_SECRET`.
- Que Make escriba `Fecha_Publicacion` (cambio pendiente).
- Cambio de contraseña y migración de hash v1→v2 contra el Sheet real. *(La cuenta de prueba de la planilla `Usuarios` todavía tiene hash v1 y token en texto plano de la versión anterior: al primer login se migra el hash, y la sesión vieja deja de valer porque ahora se compara el hash del token.)*
- Si el gestor de contraseñas del navegador ofrece guardar la clave dentro del iframe de Apps Script.

---

## 10. Pendientes técnicos (prioridad sugerida)

1. **Corregir el módulo HTTP de Make:** `/dev` → `/exec`, GET → POST con `key` fuera de la URL, y rotar `MAKE_SECRET` antes de compartir el blueprint (ver 6.2). Luego borrar el bloque de compatibilidad de `doGet`.
2. **Make:** mapear `Fecha_Publicacion` al marcar `Enviado` en los 6 módulos Update Row (ver 6.1).
3. Parametrizar el prompt de Gemini por cliente (marca, link de tienda, hashtags) al clonar el escenario.
4. Re-vincular la cuenta de Instagram comercial real (el `accountId` del blueprint de referencia puede ser de prueba).
5. Validar en el entorno real todo lo listado como "NO verificado" en la sección 9.
6. Resolver/confirmar el bug histórico de "Registrarme" sin respuesta (ver guía de implementación, troubleshooting): si reaparece tras una "Nueva versión" + `Ctrl+F5`, levantar el error de consola.
7. Decidir si `Fecha_Publicacion` debe ser la fecha real de publicación (interpretación actual) o una fecha programada (requeriría selector de fecha + que Make filtre por fecha ≤ hoy).

---

## 11. Cambios respecto a la versión anterior de este documento

| Tema | Antes | Ahora |
|---|---|---|
| Vencimiento de sesión | 30 días | **14 días** (`SESION_DIAS`) |
| Token de sesión | guardado en el Sheet | en el Sheet solo su **hash**; el navegador tiene el token |
| Hash de contraseña | SHA-256 + salt | **`v2$` con 2000 iteraciones**; migración automática; mínimo **10 caracteres** |
| Cambio de contraseña | no existía | `cambiarPassword` + formulario en Configuración |
| Anti-abuso | 5 intentos / 15 min | igual, con ventana fija + tope global de **30 registros/hora** |
| Funciones privadas | `_ctx`, `_requireSesion`, … | `ctx_`, `requireSesion_`, … (sufijo `_`) |
| URLs de medios | cualquiera `http(s)` | solo `res.cloudinary.com` (`urlValida_`) |
| Reciclado | escenario separado, solo módulos de Sheets | **endpoint en Apps Script** (`doPost`/`doGet` + `MAKE_SECRET`), llamado desde el escenario principal; vacía también `Fecha_Publicacion` |
| Filter de cola vacía | pendiente | resuelto con rama del router |
| Altas de cliente | manual en la planilla | además `aprobarCliente()` (validada) |
| Perfil | devolvía fecha de aprobación | devuelve `fechaRegistro` ("Cliente desde") |
| Responsive | "no hay versión responsiva" | menú lateral desplegable bajo 1024 px |
| Embebido | — | sin `ALLOWALL` (anti-clickjacking) |
