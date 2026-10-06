# Auto Manager — Documentación Técnica (para desarrolladores)

**Estado:** v2 multi-tenant, en validación (ver sección 9, "qué está verificado y qué no").
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
   1. Lee 1 fila Pendiente de Cola_Publicacion (orden: Orden_Ejecucion asc)
   2. Router: ¿Pie_Foto manual?
        Sí → usa ese texto
        No → busca Producto + Galeria_Medios, llama a Gemini, genera el copy
   3. Sub-router por Formato/URL → Imagen / Video (Reel) / Carrusel
   4. Publica en Instagram (instagram-business, accountId del cliente)
   5. Update Row: Estado = Enviado (+ Fecha_Publicacion, pendiente de configurar — ver 6)

[Make.com — escenario de reciclado, opcional por cliente]
   Si no quedan Pendientes y Configuracion.RecicladoAutomatico = 1:
     todas las Enviado → Pendiente de nuevo, se vacía Pie_Foto
```

**Componentes y rol:**

| Componente | Tecnología | Rol |
|---|---|---|
| Frontend | HTML + Tailwind (CDN) + SortableJS + Emoji Picker Element + Font Awesome | SPA servida por Apps Script |
| Backend | Google Apps Script | Auth, multi-tenant (resuelve el Sheet del cliente), CRUD |
| Sheet Maestro | Google Sheets | `Usuarios`, `Configuracion_Global` |
| Sheet de cliente (uno por cliente) | Google Sheets | `Productos`, `Categorias_Config`, `Galeria_Medios`, `Cola_Publicacion`, `Configuracion` |
| Medios | Cloudinary (widget Unsigned) | Hosting + transformación |
| Orquestación | Make.com (1 escenario por cliente + 1 opcional de reciclado) | Consume la cola, genera el copy, publica |
| IA de copywriting | Gemini `gemini-2.5-flash-lite` (HTTP dentro de Make) | Redacta el pie de foto si está vacío |
| Publicación | Instagram Business API (conector nativo de Make) | Feed / Reel / Carrusel |

---

## 3. Modelo de datos

### 3.1 Sheet Maestro

El script de Apps Script está vinculado a **este** spreadsheet (no al de ningún cliente).

**Pestaña `Usuarios`** (fila 1 = encabezados, 1 fila = 1 usuario):

| Col | Campo | Notas |
|---|---|---|
| A | `ID_Usuario` | `USR-XXXXXXXX`, autogenerado |
| B | `Email` | login, único |
| C | `Telefono` | |
| D | `Nombre_Negocio` | editable por el cliente desde Configuración → Información personal |
| E | `Password_Hash` | SHA-256 + salt — **nunca texto plano** |
| F | `Password_Salt` | |
| G | `Estado` | `Pendiente_Aprobacion` / `Activo` / `Suspendido` |
| H | `Plan` | `Instalacion_Unica` / `Abonado` — lo completa el admin al aprobar |
| I | `ID_Sheet_Cliente` | Spreadsheet ID del Sheet de datos del cliente — lo completa el admin al aprobar |
| J | `Fecha_Registro` | |
| K | `Fecha_Aprobacion` | |
| L | `Token_Sesion` | se genera en cada login, se invalida en logout |
| M | `Ultimo_Login` | |

En el backend v2, los índices de columna están en una constante `COL` (base 0) en vez de números mágicos sueltos — tocar ahí si cambia el esquema.

**Pestaña `Configuracion_Global`** — clave-valor horizontal (fila 1 = claves, fila 2 = valores; el parser v2 también acepta el formato vertical `Clave | Valor` como fallback):

| Clave | Uso |
|---|---|
| `WHATSAPP_NUMERO` | con código de país, ej. `5491167964852` (el backend v2 normaliza números sin `54`/`9` — igual conviene cargarlo completo) |
| `WHATSAPP_MENSAJE_DEFAULT` | texto precargado del link `wa.me` |
| `EMAIL_CONTACTO` | mostrado en Configuración → Contacto |
| `MENSAJE_PENDIENTE_APROBACION` | pantalla de estado para cuentas sin aprobar |
| `MENSAJE_SUSPENDIDO` | pantalla de estado para cuentas suspendidas |

⚠️ Es de lectura **pública** (`obtenerConfiguracionGlobal` no requiere sesión, se usa antes del login): no guardar nada sensible ahí.

### 3.2 Sheet de cada cliente (uno por cliente, independiente)

**`Productos`**: `SKU` | `Nombre` | `Stock` | `Estado` (`Activo`/`Inactivo`/`Borrador`).

**`Categorias_Config`**: `ID_Categoria` (`MOD`/`PROD`/`BRANDED`, se detecta por substring sin distinguir mayúsculas) | `Nombre_Visible` | `Orden_Prioridad` (orden de tabs en el Diseñador).

**`Galeria_Medios`**: `ID_Medio` (`MED-XXXXXXX`) | `SKU` | `ID_Categoria` | `URL` (imagen o video de Cloudinary).

**`Cola_Publicacion`** — la tabla central del sistema (1 fila = 1 publicación ya armada, no 1 producto):

| Col | Campo | Notas |
|---|---|---|
| A | `ID` | `POST-XXXXXX` |
| B | `SKU` | |
| C | `Formato` | `Feed` (1 archivo) / `Carrusel` (2+) — lo calcula el backend; Make sub-clasifica Imagen vs Video dentro de `Feed` mirando si la URL contiene `/video/` |
| D | `URLs_Payload` | URLs separadas por `" * "` (asterisco con espacios); el orden es el de publicación |
| E | `Estado` | `Pendiente` / `Enviado` |
| F | `Timestamp` | fecha de creación |
| G | `Pie_Foto` | vacío = lo redacta Gemini |
| H | `Orden_Ejecucion` | define el orden de procesamiento en Make (ver 3.3) |
| I | `Fecha_Publicacion` | **nueva en v2** — fecha en que Make efectivamente publicó. Se crea sola (`_asegurarColumnaFechaPublicacion`) si falta, al llamar `getInitialData`. **Pendiente de configurar del lado de Make** (ver sección 6) |

**`Configuracion`** (clave-valor vertical, una fila por clave):

| Clave | Valores | Uso |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | texto | credencial Cloudinary |
| `CLOUDINARY_UPLOAD_PRESET` | texto | credencial Cloudinary (preset *Unsigned*) |
| `CiclicoOK` | `1` (cíclico, por timestamp) / `0` (aleatorio) | orden de `Orden_Ejecucion` |
| `RecicladoAutomatico` | `1` / `0`, ausente = `0` | **nueva en v2** — activa el escenario de reciclado desde la UI (interruptor "Iterativo") |

### 3.3 Lógica de `Orden_Ejecucion` (sin cambios desde v1)

`_reordenarInterno(ss)` recorre todas las filas `Pendiente` y recalcula la columna H:
- `CiclicoOK = '0'` (Aleatorio): número aleatorio.
- `CiclicoOK = '1'` (Cíclico, default): `new Date(Timestamp).getTime()` — por eso el escenario de reciclado **no necesita tocar esta columna**: como no se modifica `Timestamp` al reciclar, el orden cronológico original se preserva solo.

---

## 4. Backend (Apps Script)

### 4.1 Patrón general (multi-tenant)

Toda función que toca datos de un cliente sigue el mismo patrón:

```
function algo(token, ...otrosParams) {
  var ctx = _ctx(token);           // valida sesión + abre el sheet del cliente (openById)
  // ... trabaja sobre ctx.ss ...
}
```

`_ctx(token)` internamente llama a `_requireSesion(token)` (busca el token en `Usuarios`, valida `Estado = Activo`, devuelve `idSheetCliente`) y hace `SpreadsheetApp.openById(idSheetCliente)`. Las escrituras van dentro de `_conLock` (lock de script para evitar condiciones de carrera si hay dos pestañas abiertas). Los textos se guardan con `setNumberFormat('@')` para que Sheets no interprete nada como fórmula (importante para pies de foto que puedan empezar con `=`).

### 4.2 Autenticación

| Función | Firma | Qué hace |
|---|---|---|
| `registrarUsuario` | `(payload)` | Alta en `Usuarios`, `Estado = Pendiente_Aprobacion`. Sin sesión. |
| `loginUsuario` | `(email, password)` | Verifica hash, genera `Token_Sesion`, actualiza `Ultimo_Login`. **Rate limit: 5 intentos / 15 min por email** (v2). Sin sesión previa. |
| `logoutUsuario` | `(token)` | Invalida el token. |
| `obtenerConfiguracionGlobal` | `()` | Pública — WhatsApp, mensajes de estado. |
| `obtenerPerfil` | `(token)` | **Nueva v2.** Devuelve `Nombre_Negocio`, `Telefono`, `Email`, `Plan`, `Estado`, `Fecha_Aprobacion`. Nunca expone hash/salt/token. |
| `guardarPerfil` | `(token, nombre, telefono)` | **Nueva v2.** Solo esos dos campos son editables por el cliente. |

### 4.3 Datos del cliente (CRUD)

| Función | Firma | Qué hace |
|---|---|---|
| `getInitialData` | `(token)` | Carga completa: productos, categorías, medios, cola, config. Corre la migración de columna `Fecha_Publicacion` si falta. |
| `guardarConfiguracion` | `(token, cloudName, uploadPreset)` | Credenciales Cloudinary del cliente. |
| `guardarModoDistribucion` | `(token, modo)` | `CiclicoOK`, reordena la cola. |
| `guardarModoIterativo` | `(token, activo)` | **Nueva v2.** `RecicladoAutomatico`, devuelve `'1'`/`'0'`. |
| `crearProductoConImagenes` | `(token, payload)` | Alta de producto + medios iniciales. |
| `actualizarProducto` | `(token, sku, nombre, stock, estado)` | Edición. |
| `eliminarProducto` | `(token, sku)` | Baja **en cascada** (medios + cola). |
| `guardarNuevoMedio` / `eliminarMedio` | `(token, ...)` | ABM de galería. |
| `enviarAColaPublicacion` | `(token, payload)` | Alta en `Cola_Publicacion`, calcula `Formato`, reordena. |
| `eliminarPostCola` | `(token, idPost)` | Baja de un pendiente. |
| `actualizarPostCola` | `(token, payload)` | **Nueva v2.** `{id, urls[], pieFoto, estado}`. Valida 1–10 URLs `http(s)`, pie ≤ 2200 caracteres, `estado` solo puede ser `Pendiente`/`Enviado` (otro valor se ignora); recalcula `Formato`; limpia `Fecha_Publicacion` si vuelve a `Pendiente`; reordena. |
| `verificarConfiguracion` | — | Diagnóstico manual (sin uso desde la UI). |

### 4.4 Privadas / internas

| Función | Qué hace |
|---|---|
| `_obtenerCiclicoOK(ss)` | Lee `Configuracion.CiclicoOK`, default `'1'` |
| `_reordenarInterno(ss)` | Recalcula `Orden_Ejecucion` de todas las `Pendiente` (ver 3.3) |
| `_leerColaInterno(ss)` | Devuelve la cola completa; **v2** agrega `fechaPublicacion` (formatea `dd/MM/yyyy HH:mm` con la zona horaria del sheet si es `Date`, o la deja tal cual si es texto) |
| `_asegurarColumnaFechaPublicacion(ss)` | **Nueva v2.** Crea la columna I y su encabezado si no existen (migración silenciosa, se corre en cada `getInitialData`) |
| `_requireSesion(token)` | Valida token contra `Usuarios`, chequea `Estado = Activo` |
| `_ctx(token)` | Azúcar sintáctico sobre `_requireSesion` + `openById` |

---

## 5. Frontend (Index.html)

Dos `<script>` IIFE independientes, a propósito: **si el script de la app falla, el login sigue funcionando.**

### 5.1 Script 1 — Autenticación

Expone globalmente:
- `window.showToast(mensaje, tipo)`
- `window.Auth = { getToken(), cerrarSesion(), getConfigGlobal() }`

Responsabilidades: pantallas de login/registro/estado de cuenta, pantalla informativa "¿Qué es esto?" (`#info-overlay`), botones de WhatsApp (atributo `data-whatsapp`, resuelto contra `Configuracion_Global`), arranque de la app.

**Persistencia de sesión (v2):**
- Checkbox **"Recordar usuario"**: guarda solo el email en `localStorage` (`am_email_recordado`).
- Checkbox **"Mantener la sesión iniciada"** (tildado por defecto): token en `localStorage`; destildado → `sessionStorage`. Clave `am_token` en ambos casos.
- **La contraseña nunca se guarda desde la app.** Los `<form>` son reales con `autocomplete` correcto para que sea el gestor de contraseñas del navegador quien la ofrezca guardar (no garantizado dentro del iframe de Apps Script — no verificado).
- `cerrarSesion()` → `volverAlLogin()`: reinicia el estado de la app (`App.reiniciar()`), limpia contraseñas/errores, restaura el email recordado, muestra el login. **Ya no hace `location.reload()`** (se sospechaba, sin confirmar, que dentro del iframe de Apps Script dejaba la pantalla sin login).

### 5.2 Script 2 — Aplicación

Expone `window.App = { iniciar(data), reiniciar() }`. Estado centralizado en `state`.

**Comunicación con el backend:** helper `rpc(nombre, args, ok, fallo)` que antepone el token a los argumentos automáticamente — ningún call site arma el array de argumentos a mano.

**Eventos por delegación:** nada de `onclick` inline nuevo — los elementos llevan `data-action` + `data-arg`, y un mapa `ACCIONES` resuelve qué función llamar. Funciona con nodos creados dinámicamente (carrusel, medios de galería, etc.) sin tener que re-bindear listeners.

**Construcción del DOM:** helper `el(tag, props, hijos)` en vez de `innerHTML` — evita problemas de XSS/comillas al insertar nombres de producto o pies de foto con caracteres especiales.

**Errores de sesión:** cualquier error del backend cuyo mensaje contenga la palabra "Sesión" dispara `manejarError()` → logout automático (cubre el caso de que el admin suspenda a alguien con la app abierta, o el token expire).

### 5.3 Funcionalidades agregadas en v2 (resumen, ver el doc de novedades para el detalle completo)

- **Combo de artículos** en el Diseñador (reemplaza `<input list>`+`<datalist>`): autocompletado con filtro por SKU/nombre sin distinguir mayúsculas/acentos, navegación por teclado, botón de limpiar.
- **"Automatizar con IA"**: 12 patrones (`PATRONES_MAGIA`), no repite patrón dos veces seguidas ni foto repetida en un carrusel, máximo 10 medios, patrones condicionados a qué categorías tiene el producto. **Sigue siendo 100% local — no llama a Gemini ni a ningún modelo.** Esa aclaración del v1 sigue vigente y es importante no perderla de vista en la documentación de cara al cliente.
- **Cola de envíos**: columna `Fecha de publicación`; modal de edición de un post ya encolado (quitar/reordenar medios, editar pie de foto y estado); interruptor **"Iterativo"** (activa `RecicladoAutomatico`, guarda al tildar, sin botón "Aplicar" aparte).
- **Configuración en 4 pestañas**: Información personal (editable: nombre, teléfono; solo lectura: email, plan, estado, fecha de alta), Contacto (WhatsApp/email de soporte), Cloudinary (igual que v1), Tutoriales (incluye guía interactiva paso a paso, `PASOS_TOUR`).

---

## 6. Automatización en Make.com

### 6.1 Escenario principal ("Integration Google Sheets") — uno por cliente

1. **Google Sheets → Search Rows** en `Cola_Publicacion`: `Estado = Pendiente`, orden por `Orden_Ejecucion` asc, límite 1.
   > ⚠️ **Pendiente sin aplicar:** agregar un **Filter** acá que corte la ejecución si no hay ninguna fila (ej. `{{2.\`0\`}} exists`) — sin esto, el escenario sigue de largo con datos vacíos y explota en el módulo de Instagram.
2. **Router** según si `Pie_Foto` (columna G) existe:
   - **Sin pie manual:** busca `Productos` (por SKU) y `Galeria_Medios` (por primera URL) → llama a **Gemini** (`gemini-2.5-flash-lite`) → genera el copy.
   - **Con pie manual:** usa el texto tal cual.
3. **Sub-router** por `Formato` + contenido de la URL:

   | Formato | URL contiene "/video/" | Resultado |
   |---|---|---|
   | `Feed` | No | Imagen única (`CreatePostPhoto`) |
   | `Feed` | Sí | Reel (`CreateAReelPost`, `share_to_feed: true`) |
   | `Carrusel` | — | Carrusel (`CreateCarouselPhoto`), con transformación Cloudinary `c_pad,w_1080,h_1080,b_auto,f_jpg` |

4. **Publica** en Instagram vía `instagram-business`, `accountId` del cliente.
5. **Update Row**: `Estado = Enviado`.
   > ⚠️ **Pendiente sin aplicar (v2):** mapear también `Fecha_Publicacion` (columna I) con algo como `{{formatDate(now; "DD/MM/YYYY HH:mm"; "America/Argentina/Buenos_Aires")}}`. Si el módulo no muestra la columna nueva, usar **Refresh** dentro del módulo de Sheets.

**Prompt de Gemini (rol/sistema):**
> Eres el Community Manager experto de [MARCA]. Tu tono es cercano, persuasivo y enfocado en resaltar la calidad, el calce y los detalles. Usás emojis estratégicos, pero sin exagerar. Jamás usas comillas en tus respuestas.

Instrucciones diferenciadas por tipo de imagen principal (`MOD` lifestyle / `PROD` calidad y textura / `BRANDED` cercanía con la marca), urgencia automática si `Stock < 5`, cierre con link de tienda + hashtags fijos de la marca.

### 6.2 Escenario de reciclado (opcional, activado por cliente)

Corre programado (cada 15-30 min). Si `Search Rows` no devuelve ninguna `Pendiente` **y** `Configuracion.RecicladoAutomatico = 1`: todas las `Enviado` pasan a `Pendiente`, se vacía `Pie_Foto`. No toca `Orden_Ejecucion` ni `Timestamp` (ver 3.3 — el orden cíclico se preserva solo).

> ⚠️ **Pendiente sin aplicar (v2):** al reciclar, vaciar también `Fecha_Publicacion` (si no, queda la fecha de la vuelta anterior en una fila que todavía no se volvió a publicar).

Implementado solo con módulos nativos de Google Sheets + Router (se descartó a propósito un diseño con HTTP a un endpoint de Apps Script, para no duplicar infraestructura).

---

## 7. Permisos y cuentas externas (checklist técnica)

- [ ] Instagram: cuenta **Empresa/Creador**, vinculada a una Página de Facebook, con el dueño del negocio como administrador de control total de esa página.
- [ ] `accountId` del módulo `instagram-business` en Make apunta a la cuenta comercial real del cliente (no a una cuenta de prueba).
- [ ] Cuenta de Google que corre Apps Script: **editora** de cada Sheet de cliente (requisito de `openById`).
- [ ] Web App desplegada con acceso **"Cualquier usuario, incluso anónimo"**.
- [ ] Cloudinary: cuenta + upload preset tipo **Unsigned**.

---

## 8. Limitaciones y decisiones conocidas

- **Iterativo borra pies de foto manuales** en cada ciclo (lo hace el escenario de reciclado) — está avisado en la UI con un cuadro informativo, pero es un comportamiento irreversible a tener en cuenta.
- **Sesión:** vence a los 30 días del último login; no se renueva por uso.
- **`obtenerConfiguracionGlobal` es pública** (se llama antes del login) — no cargar nada sensible en `Configuracion_Global`.
- **No hay versión responsiva** de la app interna (sidebar fija `w-64`); el login y la pantalla informativa sí lo son.
- La aclaración de v1 sobre **"Automatizar con IA"** sigue vigente: es selección aleatoria local, no IA real. Mantenerla en cualquier material de cara al cliente para no generar expectativas erróneas.
- El límite de 10 medios por carrusel está validado solo en frontend — si se agrega otra vía de carga a la cola en el futuro, replicar la validación en el backend.

---

## 9. Qué está verificado y qué no (estado a la fecha de este documento)

**Verificado** (sobre archivos con los parches aplicados, fuera del entorno real del cliente):
- Sintaxis de backend y de ambos `<script>`; sin ids duplicados; todo `data-action` referenciado tiene manejador.
- Pruebas automatizadas de frontend (ojo de contraseña, tabs, pantalla informativa, recordar usuario/sesión, que ninguna contraseña se persista, combo de artículos, automatizador en varias corridas, modal de edición de post, iterativo, perfil, tutoriales, guía interactiva, logout/reingreso, regresión de ABM de producto).
- Pruebas automatizadas de backend contra una planilla simulada (migración de columna `Fecha_Publicacion`, lectura de fechas, `actualizarPostCola`, iterativo, perfil, que `getInitialData` no se haya roto).

**NO verificado** (requiere el entorno real del cliente/proveedor):
- Renderizado real en navegador (zona de edición con muchos medios, tooltips, modal de edición, guía interactiva y pantalla informativa en celular real).
- Ejecución contra el Sheet y el Apps Script reales (creación de la columna `Fecha_Publicacion`, edición de posts, iterativo end-to-end).
- Que Make efectivamente escriba `Fecha_Publicacion` (cambio de configuración de Make pendiente, no hecho).
- Si el gestor de contraseñas del navegador ofrece guardar la clave dentro del iframe de Apps Script.

---

## 10. Pendientes técnicos (prioridad sugerida)

1. Resolver/confirmar el bug histórico de "Registrarme" sin respuesta (ver guía de implementación, sección de troubleshooting) — si reaparece tras una "Nueva versión" + `Ctrl+F5`, levantar el error de consola.
2. Configurar en Make: mapear `Fecha_Publicacion` al marcar `Enviado`; vaciarla en el escenario de reciclado; agregar el `Filter` de cola vacía en el escenario principal.
3. Re-vincular la cuenta de Instagram comercial real (hoy hay una de prueba conectada en el escenario de referencia).
4. Validar en el entorno real todo lo listado como "NO verificado" en la sección 9.
5. Decidir si `Fecha_Publicacion` debe ser la fecha real de publicación (interpretación actual) o una fecha programada (requeriría selector de fecha + que Make filtre por fecha ≤ hoy).
