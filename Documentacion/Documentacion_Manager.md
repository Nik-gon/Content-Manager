# Documentación Técnico-Funcional: Sistema de Automatización de Instagram — NOVAELA

**Estado:** MVP en funcionamiento (happy path validado).
**Última actualización:** en base al código real (`Backend.js`, `Index.html`), al blueprint real de Make.com (`Integration Google Sheets`) y a la planilla real (`Gestor_Instagram_Normalizado.xlsx`).

> ⚠️ **Nota importante:** Este documento reemplaza a los documentos anteriores ("Make.com Documentación", "Novaela: Automatización community manager", "WEB APP standAlone", "Documentación Técnico-Funcional Content Manager" y "Proyect.md"). Esos documentos describían una versión anterior del proyecto (el enfoque "Catálogo Vivo" con rotación automática diaria vía columna `Siguiente_Tipo`) que **ya no es la que está implementada**. La sección 12 detalla punto por punto qué cambió.

---

## 1. Resumen ejecutivo

El sistema permite gestionar el inventario, la galería de medios (fotos/videos) y la publicación en Instagram de NOVAELA (marca de indumentaria femenina) desde una **Web App propia** (no desde Google Sheets directamente). La emprendedora arma el posteo visualmente (arrastrando fotos, opcionalmente escribiendo el pie de foto), lo envía a una cola, y un escenario de **Make.com** la consume, genera el copy con **Gemini** cuando no se escribió uno manual, y publica en Instagram.

A diferencia del enfoque anterior (rotación automática 100% desatendida, "Catálogo Vivo"), el sistema actual es **semi-asistido**: la persona decide qué producto, qué fotos y en qué orden se publica; la IA y Make se encargan de la redacción y la publicación técnica.

---

## 2. Arquitectura real (flujo end-to-end)

```
[Emprendedora] 
   → Web App (Content Manager, Apps Script)
        - selecciona producto
        - arma carrusel/foto/video (drag & drop o botón "Automatizar IA")
        - escribe pie de foto (opcional)
        → guarda en Google Sheets, hoja "Cola_Publicacion" (Estado="Pendiente")

[Make.com — escenario "Integration Google Sheets"]
   1. Lee 1 fila de "Cola_Publicacion" con Estado="Pendiente" (ordenada por columna Orden_Ejecucion)
   2. Router: ¿la fila trae Pie_Foto manual?
        SÍ  → usa ese texto tal cual
        NO  → busca datos del Producto y de la Galería, llama a Gemini y genera el copy
   3. Sub-router por Formato/URL: ¿Imagen única / Video (Reel) / Carrusel?
   4. Publica en Instagram (Facebook Graph API vía módulo instagram-business)
   5. Actualiza la fila en "Cola_Publicacion": Estado="Enviado"
```

**Componentes:**

| Componente | Tecnología | Rol |
|---|---|---|
| Frontend | HTML5 + Tailwind CSS + SortableJS + Emoji Picker Element | SPA de gestión (Content Manager) |
| Backend | Google Apps Script (`doGet`, funciones expuestas vía `google.script.run`) | CRUD de productos, medios y cola |
| Base de datos | Google Sheets (`Gestor_Instagram_Normalizado`) | 6 pestañas (ver sección 4) |
| Medios | Cloudinary (widget de subida *Unsigned*) | Hosting y transformación de imágenes/videos |
| Orquestación | Make.com (escenario **"Integration Google Sheets"**) | Consume la cola, arma el copy y publica |
| IA de copywriting | Gemini (`gemini-2.5-flash-lite`, vía HTTP dentro de Make) | Redacta el pie de foto cuando no hay uno manual |
| Publicación | Instagram Business API (conector nativo de Make) | Feed / Reel / Carrusel |

---

## 3. Base de datos: `Gestor_Instagram_Normalizado` (Google Sheets)

La planilla real tiene **6 pestañas** (dos más de las que describía la documentación anterior):

### 3.1 `Productos`
| Columna | Ejemplo | Notas |
|---|---|---|
| `SKU` | `BIK-001` | Identificador único, en mayúsculas |
| `Nombre` | Bikini Esencial | |
| `Stock` | 5 | Numérico. Se usa para el gatillo de urgencia en el copy |
| `Estado` | Activo / Inactivo / Borrador | Antes solo existían "Activo/Pausado"; ahora hay 3 estados |

### 3.2 `Categorias_Config`
| Columna | Ejemplo | Notas |
|---|---|---|
| `ID_Categoria` | `MOD`, `PROD`, `BRANDED` | Usado como filtro de galería y por el prompt de Gemini |
| `Nombre_Visible` | Imágenes Modelo | |
| `Orden_Prioridad` | 3 | Define el orden de las pestañas en el Content Manager |
| `Limite_Sugerido` | 15 | **No está siendo leída por el Backend actual** (columna presente en la planilla pero sin consumo de código detectado; queda como referencia manual o para una futura validación) |

### 3.3 `Galeria_Medios`
| Columna | Ejemplo | Notas |
|---|---|---|
| `ID_Medio` | `MED-XXXXXXX` / hash corto | Generado por el Backend al subir |
| `SKU` | `BIK-001` | |
| `ID_Categoria` | `MOD` | |
| `URL` | URL de Cloudinary o de TiendaNube | Puede ser imagen o video |
| `Orden_Galeria` | 1, 2, 3... | **No está siendo leída por el Backend actual** (el orden real que se usa es el de arrastre en el Content Manager, no esta columna) |

### 3.4 `Cola_Publicacion`
Esta es la tabla clave del sistema nuevo (reemplaza el concepto de "1 fila = 1 producto" del enfoque viejo por "1 fila = 1 publicación concreta ya armada").

| Columna | Ejemplo | Notas |
|---|---|---|
| `ID_Carrusel` | `POST-123456` | Se genera con un número aleatorio en el Backend |
| `SKU` | `TRIO-002` | |
| `Formato` | `Feed` / `Carrusel` | Lo decide el Backend: si hay más de 1 URL → `Carrusel`, si hay 1 sola → `Feed` (que luego Make sub-clasifica en Imagen o Video según la URL) |
| `URLs_Payload` | `url1 * url2 * url3` | URLs separadas por ` * ` (asterisco con espacios) |
| `Estado` | `Pendiente` / `Enviado` | Make solo toma filas en `Pendiente` |
| `Timestamp` | fecha/hora | Fecha de creación desde la Web App |
| `Pie_Foto` | texto o vacío | Si está vacío, Make dispara la generación con IA |
| `Orden_Ejecucion` | número | Define el orden en que Make va a procesar la cola (ver sección 6.3) |

> La documentación anterior solo mencionaba 6 columnas (`ID_Post`, `SKU`, `Formato`, `URLs_Payload`, `Estado`, `Timestamp`); en la realidad son **8**, y las dos que faltaban (`Pie_Foto`, `Orden_Ejecucion`) son las que sostienen las dos funcionalidades más importantes del sistema actual (caption manual opcional y control de distribución).

### 3.5 `Configuracion`
No documentada anteriormente. Es clave-valor:

| Clave | Ejemplo | Uso |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | `drf83zhw` | Se edita desde la vista "Configuración" de la Web App |
| `CLOUDINARY_UPLOAD_PRESET` | `app_instagram` | Ídem |
| `CiclicoOK` | `1` (cíclico) / `0` (aleatorio) | Controla el orden de procesamiento de la cola (ver 5.4 y 6.1) |

### 3.6 `Motor_Make` — **pestaña heredada, sin uso actual**
Existe en la planilla real una pestaña con formato ancho (`SKU, Nombre, Stock, Img_Branded, Prod_1...Prod_15, Mod_1...Mod_15`), que corresponde al modelo de datos que describían los documentos viejos ("Catálogo Vivo"). **Ni el `Backend.js` actual ni el escenario de Make analizado la leen.** Recomendación: confirmar si algún otro escenario de Make la sigue usando; si no, archivarla o eliminarla para evitar confusión futura.

---

## 4. Web App — "Auto Manager" (Content Manager SPA)

### 4.1 Despliegue
Confirmado por captura real: desplegada como **Aplicación web** de Apps Script (Versión 1, 30 ago 2026), ejecutando como el usuario propietario. El flujo de despliegue documentado anteriormente (Extensiones → Apps Script → `Codigo.gs` + `Index.html` → Implementar → Nueva implementación) es correcto y sigue vigente.

### 4.2 Vistas de la aplicación
La SPA tiene **4 vistas** accesibles desde el sidebar:

1. **Inventario** (`vista-productos`): tabla de productos con buscador, alta/edición/baja. La baja es **en cascada**: borra el producto, sus medios en `Galeria_Medios` y sus publicaciones pendientes en `Cola_Publicacion`.
2. **Diseñador de Posts** (`vista-manager`): pantalla principal de trabajo.
   - Panel izquierdo: galería del producto seleccionado, con tabs por categoría (`Categorias_Config`).
   - Panel derecho: zona de armado ("Zona de edición") donde se arrastran las fotos/videos (vía SortableJS, `pull: clone`), máximo **10 archivos** (límite real de Instagram para carruseles, validado en el frontend).
   - Campo de **pie de foto manual, opcional**, con selector de emojis integrado. Si se deja vacío, el copy lo genera la IA en Make.
   - Botón **"Enviar a Make"**: guarda la publicación en `Cola_Publicacion`.
3. **Cola de Envíos** (`vista-cola`): lista de publicaciones (histórico, incluye tanto pendientes como enviadas) con miniaturas, pie de foto (o "Generado por IA" si está vacío) y opción de eliminar una publicación pendiente antes de que Make la procese.
   - Incluye el selector **"Distribución (Make)": Cíclico (Secuencial) / Aleatorio**, que persiste en `Configuracion.CiclicoOK` y dispara un reordenamiento inmediato de toda la cola pendiente.
4. **Configuración** (`vista-config`): permite cargar/editar `CLOUDINARY_CLOUD_NAME` y `CLOUDINARY_UPLOAD_PRESET` desde la propia interfaz (ya no es necesario editar el HTML a mano como indicaba la documentación anterior).

### 4.3 Función "Automatizar IA" — aclaración importante
El botón **"Automatizar IA"** dentro del Diseñador de Posts **no llama a ningún modelo de IA**: es una función 100% cliente (JavaScript) que arma automáticamente una selección de fotos mezclando categorías (Branded/Producto/Modelo) según 3 patrones predefinidos ("Lookbook", "Catálogo Comercial", "Impacto Simple") elegidos al azar con `Math.random()`. Vale la pena considerar renombrarlo (por ejemplo "Armar automáticamente") para no generar expectativas de que está usando Gemini en ese paso — la IA real (Gemini) solo interviene más adelante, dentro de Make, para redactar el texto.

### 4.4 Reproducción de video y detección de tipo de archivo
El frontend distingue fotos de videos revisando si la URL contiene `/video/upload/` (convención de Cloudinary). Para videos, muestra un ícono de "play" y los reproduce en un modal; para la miniatura de un video usa la misma URL reemplazando la extensión por `.jpg`.

---

## 5. Backend (Google Apps Script — `Backend.js`)

Funciones expuestas a la Web App vía `google.script.run`:

| Función | Qué hace |
|---|---|
| `doGet()` | Sirve `Index.html` como Web App |
| `getInitialData()` | Carga inicial: productos, categorías, medios, cola y configuración |
| `guardarConfiguracion(cloudName, uploadPreset)` | Actualiza credenciales de Cloudinary en la hoja `Configuracion` |
| `guardarModoDistribucion(modo)` | Escribe `CiclicoOK` (`0`/`1`) y **reordena toda la cola pendiente** |
| `crearProductoConImagenes(payload)` | Alta de producto + carga inicial de medios |
| `actualizarProducto(sku, nombre, stock, estado)` | Edición de producto |
| `eliminarProducto(sku)` | Baja de producto **en cascada** (medios + cola) |
| `guardarNuevoMedio(url, sku, categoria)` / `eliminarMedio(idMedio)` | Alta/baja individual de un archivo en la galería |
| `enviarAColaPublicacion(payload)` | Crea la fila en `Cola_Publicacion` (calcula `Formato`, concatena URLs con ` * `) y reordena |
| `eliminarPostCola(idPost)` | Elimina una publicación pendiente de la cola |
| `_reordenarInterno(ss)` (privada) | Recalcula `Orden_Ejecucion` para todas las filas `Pendiente`: timestamp si es Cíclico, número aleatorio si es Aleatorio |
| `_leerColaInterno(ss)` (privada) | Lee y devuelve la cola (orden invertido, más reciente primero en la UI) |

---

## 6. Automatización en Make.com — escenario real **"Integration Google Sheets"**

> Reconstruido a partir del blueprint exportado (`Esquema_MAKE.json` / `Integration_Google_Sheets_blueprint.json`, archivos idénticos).

### 6.1 Disparador y lectura de la cola
El primer módulo (`Google Sheets → Search Rows`) lee de `Cola_Publicacion`:
- Filtro: columna `E` (`Estado`) = `Pendiente`
- Orden: por columna `H` (`Orden_Ejecucion`), ascendente
- Límite: **1 fila por ejecución**

> El blueprint exportado no incluye el módulo de disparo (Schedule/Watch), por lo que la frecuencia de ejecución debe confirmarse directamente en la interfaz de Make.com (el link de acceso ya existía en la documentación previa: `us2.make.com/2608472/scenarios`).

### 6.2 Router principal: ¿hay pie de foto manual?
El escenario usa un Router con dos caminos, cada uno con su propio filtro (basado en si la columna `G` / `Pie_Foto` existe o no):

- **Ruta A — sin pie de foto manual (`Pie_Foto` no existe):**
  1. Busca la fila del producto en `Productos` (por SKU) y en `Galeria_Medios` (por primera URL) para tener contexto.
  2. Llama a **Gemini** (`gemini-2.5-flash-lite`) para generar el copy (ver 6.3).
  3. Sub-router por `Formato`/URL → Imagen / Video / Carrusel.
- **Ruta B — con pie de foto manual (`Pie_Foto` existe):**
  1. Usa el texto tal cual fue escrito en la Web App.
  2. Sub-router por `Formato`/URL → Feed / Feed Video / Carrusel (misma lógica, sin pasar por Gemini).

### 6.3 Generación de copy con Gemini (prompt real)
Modelo: `gemini-2.5-flash-lite`.

**Instrucción de sistema (rol):**
> Eres el Community Manager experto de NOVAELA, una marca de indumentaria femenina. Tu tono es cercano, persuasivo y enfocado en resaltar la calidad, el calce y los detalles. Usás emojis estratégicos, pero sin exagerar. Jamás usas comillas en tus respuestas.

**Prompt de la tarea (resumen):** recibe el nombre del producto y el stock disponible, el tipo de imagen principal (`MOD`, `PROD` o `BRANDED`) y el `Formato`, con instrucciones diferenciadas:
- Imagen **MODELO**: texto aspiracional, foco en lifestyle y actitud.
- Imagen **PRODUCTO**: foco en calidad de materiales, textura y terminaciones.
- Imagen **BRANDED**: foco en la marca, cercanía con el público.
- Si el stock es menor a 5: agrega urgencia por escasez.
- Cierre fijo: link de la tienda (`novaelaintimates.mitiendanube.com`) + hashtags fijos `#NOVAELA #ModaFemenina #EstiloNOVAELA`.

> Nota: los "4 tonos de redacción" (Urgencia, Lifestyle, Calidad, Humor) y los "3-4 hashtags a definir" que pedía la checklist de Laura en la documentación anterior **ya están resueltos y hardcodeados** en este prompt (con 3 hashtags fijos, no 4, y sin un tono explícito de "Humor").

### 6.4 Determinación de formato final (Imagen / Video / Carrusel)
Sobre la columna `Formato` (C) y el contenido de la URL (D):

| Formato (col. C) | URL contiene "/video/" | Resultado |
|---|---|---|
| `Feed` | No | **Imagen única** (`CreatePostPhoto`) |
| `Feed` | Sí | **Video / Reel** (`CreateAReelPost`, con `share_to_feed: true`) |
| `Carrusel` | (cualquiera) | **Carrusel de imágenes** (`CreateCarouselPhoto`, todas las URLs pasadas por Cloudinary con transformación `c_pad,w_1080,h_1080,b_auto,f_jpg`) |

> El Backend solo asigna `Formato = "Carrusel"` cuando hay más de 1 URL, y `"Feed"` cuando hay 1 sola (sea imagen o video). Make es quien distingue Imagen vs. Video dentro de "Feed" mirando la URL.

### 6.5 Publicación y cierre
Cada rama termina con:
1. Módulo `instagram-business` correspondiente (`CreatePostPhoto` / `CreateAReelPost` / `CreateCarouselPhoto`), usando una cuenta de Instagram Business conectada por `accountId`.
2. `Google Sheets → Update Row` sobre la misma fila de `Cola_Publicacion`, seteando `Estado = "Enviado"`.

> ⚠️ **Atención (ver también sección 8):** la cuenta de Instagram conectada en el escenario actual está etiquetada en Make como **"PruebaAutomatizacion"** — es decir, hoy el escenario publica sobre una **cuenta de prueba**, no sobre la cuenta comercial definitiva de NOVAELA. Antes de considerar esto producción real, hay que re-vincular el módulo de Instagram a la cuenta oficial.

---

## 7. Cloudinary
Configuración vigente (visible en la hoja `Configuracion`): `CLOUDINARY_CLOUD_NAME = drf83zhw`, preset *Unsigned* `app_instagram`. El flujo de alta de cuenta y creación del preset que describía la documentación anterior sigue siendo válido, con la diferencia de que **ahora se configura desde la propia Web App** (vista Configuración), no editando `Index.html` a mano.

Transformación usada para carruseles: `f_jpg` (conversión de formato) **más** `c_pad,w_1080,h_1080,b_auto` (padding a cuadrado 1080×1080 con fondo automático) — más completa que la transformación simple (`f_jpg` solamente) que mencionaba la documentación vieja.

---

## 8. Flujo operativo diario (cómo se usa hoy)

1. **Cargar fotos/videos nuevos:** en la Web App, abrir el producto (Inventario → ícono de galería, o directamente en el Diseñador de Posts) y subir el archivo con el botón "Subir Archivos" (widget de Cloudinary), eligiendo antes la categoría (Branded/Producto/Modelo).
2. **Armar una publicación:** ir a "Diseñador de Posts", elegir el producto, arrastrar las fotos/videos deseados a la zona de edición (o usar "Automatizar IA" para una selección rápida), escribir el pie de foto si se quiere un texto específico (si no, quedará en manos de Gemini) y presionar "Enviar a Make".
3. **Seguimiento:** en "Cola de Envíos" se puede ver el estado de cada publicación y eliminar una pendiente si hace falta.
4. **Gestión de stock:** actualizar el campo `Stock` desde "Inventario" cuando se vende algo por otro canal — esto sigue afectando directamente el tono de urgencia del copy generado por IA.

---

## 9. Permisos y cuentas de Meta/Instagram (checklist — sigue vigente)
De la documentación anterior, estos puntos **siguen siendo válidos y deben verificarse**:
- [ ] Cuenta de Instagram tipo **Empresa/Creador** (no personal).
- [ ] Vinculada a una **Página de Facebook** de la marca.
- [ ] Rol de **Administradora con control total** de esa página.
- [ ] **Nuevo:** confirmar que el módulo de Instagram en Make esté apuntando a la cuenta comercial definitiva y no a la cuenta de prueba (`PruebaAutomatizacion`) detectada en el escenario actual.

---

## 10. Diferencias clave vs. la documentación anterior

| Documentación anterior | Realidad actual |
|---|---|
| "Catálogo Vivo": 1 fila = 1 producto, rotación automática diaria vía `Siguiente_Tipo` | 1 fila de cola = 1 publicación ya armada manualmente por la emprendedora en la Web App |
| Disparador por Schedule (1 vez/día) sin intervención humana | Sistema semi-asistido: la persona arma y dispara cada publicación desde la app |
| Aleatoriedad vía `=ALEATORIO()` en Google Sheets | Orden de la cola controlado por `Orden_Ejecucion`, editable desde la Web App (Cíclico/Aleatorio) |
| Router de Make por `Siguiente_Tipo` (Producto_1/Modelo_1) | Router de Make por presencia de pie de foto manual + por `Formato`/tipo de URL |
| 4 tonos de redacción a definir + 3-4 hashtags a definir | Prompt de Gemini ya definido y fijo, con 3 tipos de imagen (Modelo/Producto/Branded) y 3 hashtags fijos |
| Transformación Cloudinary simple (`f_jpg`) | Transformación con padding cuadrado 1080×1080 (`c_pad,w_1080,h_1080,b_auto,f_jpg`) |
| Configuración de Cloudinary hardcodeada en `Index.html` | Configuración editable desde la Web App, persistida en hoja `Configuracion` |
| Esquema de 4 pestañas en Sheets | Esquema real de 6 pestañas (+ `Configuracion` y `Motor_Make` legacy) |
| Sin soporte de Reels ni Carrusel explícito | Soporte real para Imagen, Reel (video) y Carrusel |

---

## 11. Puntos abiertos / riesgos / recomendaciones

1. **Cuenta de Instagram de prueba en Make:** re-vincular a la cuenta comercial real antes de operar en producción.
2. **Pestaña `Motor_Make`:** confirmar si algún otro escenario la usa; si no, archivarla para evitar confusión.
3. **Columnas sin uso:** `Limite_Sugerido` (Categorias_Config) y `Orden_Galeria` (Galeria_Medios) están en la planilla pero el código actual no las lee — decidir si se implementan o se eliminan.
4. **Disparador de Make no documentado:** confirmar en la interfaz la periodicidad real de ejecución del escenario (no viaja en el blueprint exportado).
5. **Manejo de errores:** el blueprint no muestra rutas de error/reintento explícitas (por ejemplo, si Instagram rechaza un archivo o Gemini falla); vale la pena revisar la configuración de manejo de errores de Make (reintentos, notificaciones).
6. **Botón "Automatizar IA":** renombrar o aclarar en la UI que es una selección aleatoria local y no una llamada a un modelo de IA, para evitar expectativas equivocadas.
7. **Límite de Instagram:** el máximo de 10 archivos por carrusel está validado solo en el frontend; si en el futuro se agrega otra vía de carga a la cola, replicar esa validación también en el backend.

---

## 12. Accesos

- Escenario de Make.com: `https://us2.make.com/2608472/scenarios?folder=all&tab=all&type=scenario&sort=nameAsc`
- Planilla base: `Gestor_Instagram_Normalizado` (Spreadsheet ID `1V7GOv_C4xi5I6ff1u_LDebOjgM5muSHGN30kae-W6Oc`)
- Cloud Name de Cloudinary: `drf83zhw` / preset `app_instagram`
