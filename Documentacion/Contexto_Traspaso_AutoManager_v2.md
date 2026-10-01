# Auto Manager — Documento de traspaso (estado a 29/09/2026)

> Pegá este documento entero al inicio de la conversación con otra IA. Resume el proyecto, todo lo que se hizo en la versión 2, cómo está construido el código, cómo se probó y qué queda pendiente. **La fuente de verdad del código son `Backend_v2.txt` e `Index_v2.txt`**: adjuntalos junto a este documento.

---

## 0. Cómo trabajar con Nico

* Escribe en **español rioplatense** (voseo). Es desarrollador (ERP Andrómeda, VB6/SQL Server y otros proyectos); este proyecto es aparte.
* **Prefiere parches y fragmentos puntuales ("reemplazá X por Y") en lugar de reescrituras completas**, para no volver a testear lo que ya aprobó. Si entregás archivos completos, que sea además de los parches y solo si los pide.
* Cada cambio de código en Apps Script requiere **Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar** y `Ctrl + F5`; si no, `/exec` sigue sirviendo el código viejo.
* Conviene decirle explícitamente qué está verificado y qué no (ver sección 9): no hay acceso a su Apps Script, a sus planillas reales ni a sus blueprints de Make.

---

## 1. Qué es el proyecto

Sistema que permite a emprendimientos chicos (cliente inicial: NOVAELA, indumentaria femenina) automatizar publicaciones de Instagram:

* **Web App propia (Google Apps Script)**: el dueño arma publicaciones (arrastra fotos/videos, escribe o deja vacío el pie de foto) y las envía a una cola.
* **Make.com**: toma la cola, genera el copy con **Gemini** si el pie está vacío y publica en **Instagram** (Feed, Reel o Carrusel).
* **Cloudinary**: aloja y transforma los medios.

Modelo **multi-tenant** para hasta ~20 clientes (planes "Instalación Única" y "Abonado"). Un **Sheet Maestro** (usuarios y configuración global, al que está vinculado el script) y **un Sheet separado por cliente** (datos del negocio). Todos entran por la misma Web App con login. Un escenario de Make por cliente.

### Flujo operativo

```
Visitante → "Registrarme" → fila nueva en Usuarios (Estado = Pendiente_Aprobacion)
Admin (manual) → copia el Sheet plantilla del cliente → crea/entrega el escenario de Make
              → completa ID_Sheet_Cliente, Plan, Fecha_Aprobacion y Estado = Activo
Cliente → login → Activo: entra (el backend abre su sheet con openById)
                → Pendiente/Suspendido: ve el mensaje de Configuracion_Global + botón de WhatsApp
```

### Requisitos de despliegue (de la versión multi-tenant, sin cambios)

1. El proyecto de Apps Script está vinculado al **Sheet Maestro**.
2. Web App con acceso "Cualquier usuario, incluso anónimo".
3. La cuenta que corre el script es **editora** de cada Sheet de cliente.
4. Para probar hace falta un usuario creado a mano en `Usuarios` con `Estado = Activo` e `ID_Sheet_Cliente`.

---

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `Backend_v2.txt` | Backend completo (698 líneas), con todos los cambios. Va en el archivo `Backend` de Apps Script |
| `Index_v2.txt` | Frontend completo (2205 líneas: HTML + CSS + 2 scripts). Va en `Index.html` |
| `Parches_AutoManager_v2.md` | Los mismos cambios como 30 parches "buscá/reemplazá" en orden (B1–B5 y I1–I25) |
| `Documentacion_Novedades_AutoManager.md` | Documentación funcional de lo nuevo (login, tablas, WhatsApp, cola, config, Make) |
| `Backend.txt`, `Index.txt` (originales de Nico) | Versión anterior. Sin modificar; sirven de respaldo |
| `Documentacion_Final_NOVAELA.md`, `Reciclado_Cola_Publicacion_blueprint.json` | Entregados en sesiones anteriores (pre multi-tenant / reciclado de cola) |

Los `.txt` v2 son los originales de Nico con los parches aplicados por script (cada ancla verificada una sola vez). Si se modifican, mantener `Parches_…` sincronizado o descartarlo.

---

## 3. Modelo de datos

### Sheet Maestro

**`Usuarios`** (fila 1 = encabezados): `A ID_Usuario` (USR-XXXXXXXX) · `B Email` · `C Telefono` · `D Nombre_Negocio` · `E Password_Hash` (SHA-256 + salt) · `F Password_Salt` · `G Estado` (`Pendiente_Aprobacion`/`Activo`/`Suspendido`) · `H Plan` (`Instalacion_Unica`/`Abonado`) · `I ID_Sheet_Cliente` · `J Fecha_Registro` · `K Fecha_Aprobacion` · `L Token_Sesion` · `M Ultimo_Login`. Constante `COL` en el backend (base 0).

**`Configuracion_Global`** (horizontal: fila 1 claves, fila 2 valores; también acepta vertical `Clave|Valor`): `WHATSAPP_NUMERO`, `WHATSAPP_MENSAJE_DEFAULT`, `EMAIL_CONTACTO`, `MENSAJE_PENDIENTE_APROBACION`, `MENSAJE_SUSPENDIDO`.

### Sheet de cada cliente

Pestañas: `Productos` (SKU, Nombre, Stock, Estado), `Categorias_Config` (ID, Nombre, Orden), `Galeria_Medios` (ID, SKU, Categoría, URL), `Cola_Publicacion`, `Configuracion` (Clave|Valor).

**`Cola_Publicacion`**: `A ID` (POST-…) · `B SKU` · `C Formato` (Feed si 1 archivo, Carrusel si 2+) · `D URLs` (separadas por `" * "`, el orden es el de publicación) · `E Estado` (`Pendiente`/`Enviado`) · `F Timestamp` · `G Pie_Foto` (vacío = lo redacta la IA) · `H Orden_Ejecucion` · **`I Fecha_Publicacion` (nueva)**.

**`Configuracion`** claves: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `CiclicoOK` (`1` cíclico/`0` aleatorio), **`RecicladoAutomatico` (`1`/`0`, nueva desde la app; ausente = `0`)**.

---

## 4. Qué se hizo en esta versión

### 4.1 Login

* Ojo para ver/ocultar contraseña en los 3 campos (login, registro, repetir).
* Checkboxes: **"Recordar usuario"** (solo guarda el email en `localStorage`, clave `am_email_recordado`) y **"Mantener la sesión iniciada"** (tildado por defecto: token en `localStorage`; destildado: `sessionStorage`; `am_token`). **La contraseña nunca se guarda desde la app** (decisión deliberada: quedaría en texto plano). Los formularios son `<form>` reales con `autocomplete` correcto para que el administrador de contraseñas del navegador pueda ofrecer guardarla (depende del navegador y del iframe de Apps Script).
* **Pantalla "¿Qué es esto?"** (`#info-overlay`): portada con ilustración SVG de un celular que completa la grilla, 4 pasos numerados (es una secuencia real) con una ilustración cada uno, sección de controles, sección de datos/seguridad y cierre con CTA. Botón arriba a la derecha del login y enlace debajo del formulario. Cierra con X, Esc, "Ya tengo cuenta" o "Crear mi cuenta".
* **Cerrar sesión**: ya no hace `location.reload()` (se sospecha que dentro del iframe de Apps Script dejaba la pantalla sin login; no se confirmó la causa). Ahora `volverAlLogin()` reinicia la app (`App.reiniciar()`), limpia contraseñas y errores, restaura el email recordado y muestra el login; `logoutUsuario(token)` se ejecuta en segundo plano.

### 4.2 Diseñador de posts

* **Combo de artículos** (reemplaza `<input list>` + `<datalist>`): lista propia con todos los artículos al enfocar; filtra por SKU/nombre sin distinguir mayúsculas/acentos; navegación con ↑↓/Enter/Esc; botón de flecha y botón X para quitar selección; `mousedown` + `preventDefault` para no perder el foco; al salir con texto inválido vuelve al artículo elegido. `actualizarDatalistManager()` conserva su nombre porque otras funciones (alta/edición/baja de producto) la llaman.
* **Automatizar con IA**: botón con degradé animado y brillo, mensajes de progreso ~1,3 s, **12 patrones** (`PATRONES_MAGIA`), no repite el mismo patrón dos veces seguidas, nunca repite una foto en un carrusel, máximo 10, los patrones con `req` (marca/producto/modelo) solo se ofrecen si hay fotos de ese tipo. Tipos detectados por el nombre de categoría (`MOD`, `PROD`, `BRAND`, sin distinguir mayúsculas). Franja `#magia-resultado` con el nombre del patrón aplicado. Se descartó a propósito inventar métricas ("+X% engagement").
* **Tooltip (i)**: se abre hacia abajo, encabezado con `relative z-30`, visible también con foco de teclado.
* **Medios en filas**: `#carousel-zone` con `flex-wrap` y `max-h-72` con scroll vertical; los medios se numeran con CSS `counter`. **Pie de foto** a 6 filas, `resize-y`, `maxlength=2200`.

### 4.3 Cola de envíos

* Columna **Fecha de publicación** y columna **Acciones** con lápiz + papelera.
* **Modal de edición** (`#modal-editar-post`, ids `ep-*`): quitar medios (X), reordenar arrastrando (Sortable sobre `#ep-medios`, clase `.ep-card`), pie de foto, estado (`Pendiente`/`Enviado`; si hubiera otro se conserva), fecha en solo lectura, aviso si ya estaba `Enviado` (editar no cambia lo ya publicado en Instagram). No permite guardar sin medios.
* **Interruptor Iterativo** (`#chk-iterativo`, `#caja-iterativo`) junto a Distribución, con cuadro informativo; **guarda al tildar** (no usa "Aplicar") vía `guardarModoIterativo`.

### 4.4 Configuración (4 pestañas)

`cfg-tab` con paneles `cfg-panel-personal|contacto|cloudinary|tutoriales`:
* **Información personal**: email, plan, estado y "cliente desde" (solo lectura); nombre del negocio y teléfono editables (`obtenerPerfil` / `guardarPerfil`; el perfil se cachea en `perfilCache`).
* **Contacto**: botón de WhatsApp (atributo `data-whatsapp`) y de email (`EMAIL_CONTACTO`).
* **Credenciales de Cloudinary**: mismos campos y `guardarConfiguracion` de antes, con nota de seguridad.
* **Tutoriales**: recorrido guiado, cómo funciona cada sección (`TUTORIAL_SECCIONES`), pasos de Cloudinary (`TUTORIAL_CLOUDINARY`) y 7 conexiones externas con qué hacen / qué comparten / qué no comparten / cómo cortar el acceso (`TUTORIAL_VINCULOS`).
* **Guía interactiva** (botón "Guía" del encabezado y desde Tutoriales): 18 pasos en `PASOS_TOUR` (`vista`, `tab` opcional, `sel` CSS, `titulo`, `texto`); cambia de sección sola, resalta con `#tour-foco` (box-shadow) y posiciona un popover; teclas ←/→/Esc; "Mostrámelo en pantalla" salta al primer paso de la sección. Los nodos del tour se crean bajo demanda (`tourCrear()`).

---

## 5. Arquitectura del código (para modificarlo)

### Backend (`Backend_v2.txt`)

Toda función que toca datos empieza con `_ctx(token)` (valida sesión con `_requireSesion` y abre el sheet del cliente con `openById`). Escrituras dentro de `_conLock`. Textos guardados con `setNumberFormat('@')` para que nada se interprete como fórmula.

| Función | Estado |
|---|---|
| `guardarModoIterativo(token, activo)` | nueva: escribe `RecicladoAutomatico`, devuelve `'1'`/`'0'` |
| `actualizarPostCola(token, payload)` | nueva: `{id, urls[], pieFoto, estado}`. Valida 1–10 URLs `http(s)`, pie ≤ 2200, estado ∈ {Pendiente, Enviado} (otro se ignora), recalcula Formato, limpia `Fecha_Publicacion` si queda Pendiente, llama a `_reordenarInterno`, devuelve la cola |
| `obtenerPerfil(token)` / `guardarPerfil(token, nombre, tel)` | nuevas: solo `Nombre_Negocio` y `Telefono`; nunca devuelve hash, salt ni token |
| `_asegurarColumnaFechaPublicacion(ss)` | nueva (interna): crea columna y encabezado `Fecha_Publicacion` en la columna I si faltan; se llama desde `getInitialData` |
| `_leerColaInterno(ss)` | modificada: agrega `fechaPublicacion` (si es `Date`, la formatea `dd/MM/yyyy HH:mm` con la zona del sheet; si es texto, tal cual) |
| `getInitialData(token)` | modificada: `config` incluye `RecicladoAutomatico` (default `'0'`) y corre la migración |

Sin cambios: `doGet`, `registrarUsuario`, `loginUsuario` (5 intentos/15 min por email), `logoutUsuario`, `obtenerConfiguracionGlobal` (**pública**, antes del login), ABM de productos y medios, `enviarAColaPublicacion`, `eliminarPostCola`, `guardarConfiguracion`, `guardarModoDistribucion`, `verificarConfiguracion` (diagnóstico manual).

### Frontend (`Index_v2.txt`)

* **Script 1 (auth, IIFE)**: `window.showToast`, `window.Auth = { getToken, cerrarSesion, getConfigGlobal }`. Maneja login, registro, pantallas de estado, WhatsApp (`data-whatsapp`), pantalla informativa y arranque. Es independiente del Script 2: si la app falla, el login sigue andando.
* **Script 2 (app, IIFE)**: `window.App = { iniciar(data), reiniciar() }`. Estado en `state`. Llama al servidor con `rpc(nombre, args, ok, fallo)` (agrega el token como primer argumento). Eventos por **delegación**: elementos con `data-action` / `data-arg` y el mapa `ACCIONES` (funciona con nodos dinámicos). El DOM se arma con el helper `el(tag, props, hijos)` (sin `innerHTML`, evita XSS y problemas de comillas).
* Interfaz con **Tailwind CDN** + Font Awesome + SortableJS + widget de Cloudinary + emoji-picker. Fuente **Bricolage Grotesque** solo para los títulos de la pantalla informativa. Paleta de esa pantalla: fondo `#2a1240`, acentos `#ff7a3d`, `#d6249f`, `#6c3de0`, `#14b88a`, base `#faf7ff`.
* Errores del backend que contienen "Sesión" fuerzan el cierre de sesión (`manejarError`).

---

## 6. Cambios necesarios en Make (NO hechos: no se tuvo acceso a los blueprints)

1. **Escenario principal**: en el módulo Google Sheets que pasa la fila a `Enviado`, mapear también `Fecha_Publicacion` (columna I) con `{{formatDate(now; "DD/MM/YYYY HH:mm"; "America/Argentina/Buenos_Aires")}}`. Si no aparece la columna, usar **Refresh** dentro del módulo.
2. **Escenario de reciclado** (Sheets + Router): ya respeta `RecicladoAutomatico = 1`. Recomendado (no implementado): que además **vacíe `Fecha_Publicacion`** al pasar `Enviado → Pendiente` y `Pie_Foto`.
3. Pendiente desde antes: **Filter** después de `Search Rows` en el escenario principal que corte si la cola no devuelve filas (hoy explota en el módulo de Instagram).

---

## 7. Interpretaciones que hay que confirmar con Nico

| Tema | Interpretación tomada | Alternativa |
|---|---|---|
| "Fecha de publicación" | Fecha en que **se publicó**, escrita por Make | Fecha **programada**: requeriría selector de fecha en el diseñador y que Make filtre por fecha ≤ hoy |
| "Tres áreas" | Listó cuatro → 4 pestañas | — |
| "Contacto" | Cómo contactar al soporte (WhatsApp y email de `Configuracion_Global`) | Contacto del cliente (mover email/teléfono ahí) |
| "Recordar las claves" | Recordar usuario + sesión persistente; la clave la guarda, si quiere, el navegador | — |
| "Vende humo" | Estética y animación llamativas, sin métricas inventadas | — |
| Estados editables | Solo `Pendiente` y `Enviado` (los que usa el flujo actual) | Un `Pausado` requiere tocar `actualizarPostCola` y los filtros de Make |

---

## 8. Consideraciones y limitaciones conocidas

* **Iterativo borra pies de foto manuales** en cada vuelta completa (lo hace el escenario de reciclado); el cuadro informativo lo aclara.
* **Vencimiento de sesión**: 30 días desde el último login, no se renueva por uso.
* **Textos de seguridad de Tutoriales**: describen la arquitectura contada por Nico, **no verificados** contra Make (qué datos recibe Gemini, qué acceso tiene la cuenta de Google que corre Make). Incluyen un aviso de que el administrador puede ver la planilla del cliente para soporte: quitarlo si no aplica.
* El tooltip de "Automatizar con IA" y el texto de la guía dicen "12 patrones": actualizarlos si se agregan o quitan.
* `obtenerConfiguracionGlobal` es pública: no poner datos sensibles en `Configuracion_Global`.
* El número de WhatsApp de prueba está como `1167964852`; funciona porque el backend lo normaliza (→ `5491167964852`), pero conviene cargarlo completo y con formato de celda texto plano.
* No se abordó la versión móvil de la app interna (la barra lateral es fija de `w-64`); el login y la pantalla informativa sí son responsivos.
* La cuenta de Instagram conectada en Make es de **prueba** (`PruebaAutomatizacion`): re-vincular antes de producción.

---

## 9. Qué se verificó y qué no

**Verificado** sobre los archivos reales con los parches aplicados:
* Sintaxis del backend y de los dos `<script>`; sin ids duplicados; todos los ids y `data-action` usados por el JS existen y tienen manejador.
* **96 comprobaciones del frontend** (jsdom con un `google.script.run` falso): ojo de contraseña, pestañas, pantalla informativa, recordar usuario y sesión, que no se guarde ninguna contraseña, combo (filtro, teclado, restaurar), 40 corridas del automatizador, modal de edición, iterativo, perfil, tutoriales, guía completa, cerrar sesión y reingreso, y regresión de editar/eliminar productos con el combo nuevo.
* **38 comprobaciones del backend** con una planilla simulada: migración de la columna I, lectura de fechas, `actualizarPostCola` (orden, formato, fecha, validaciones, token falso), iterativo, perfil y que `getInitialData` siga intacto.
* Las 5 ilustraciones SVG se renderizaron a imagen y se corrigió una superposición.

**NO verificado** (requiere el entorno real de Nico):
* Ningún renderizado real de estilos en navegador (no hubo Chromium): revisar la zona de edición con muchos medios, el tooltip (i), el modal de edición, el recorrido guiado y la pantalla informativa en celular.
* Ejecución contra el Sheet y el Apps Script reales (creación de la columna I, edición, iterativo).
* Que Make escriba `Fecha_Publicacion`.
* Si el administrador de contraseñas del navegador ofrece guardar la clave dentro del iframe.

Los scripts de prueba (jsdom y planilla simulada) no forman parte de los entregables; se pueden reconstruir a partir de la lista anterior.

---

## 10. Pendientes

1. **Bug "Registrarme" sin respuesta (sin resolver)**: causa original no confirmada. Posibles causas: redeploy sin "Nueva versión" (sirve la página vieja), código mezclado o error de JS. En las pruebas las pestañas del login funcionan. Si persiste tras implementar `Index_v2` como nueva versión y `Ctrl + F5`: pedir el error en rojo de la consola (F12 → Console) y si aparece el login al cargar.
2. Configurar Make: `Fecha_Publicacion`, vaciado en el reciclado y el Filter de cola vacía (sección 6).
3. Corregir `WHATSAPP_NUMERO` en la hoja.
4. Checklist de alta de cliente nuevo y proceso de clonado del sheet plantilla (que ya incluya la columna `Fecha_Publicacion`) y del escenario de Make.
5. Re-vincular la cuenta de Instagram comercial.
6. Decidir las interpretaciones de la sección 7 (sobre todo fecha programada vs. fecha real).
7. Pricing (charlado antes, sin cambios): los valores actuales del usuario ($60.000 instalación, $20.000/hora, $40.000/mes) quedaron por debajo de referencias de mercado; considerar además el costo de operaciones de Make si se administra una sola cuenta para varios clientes.

---

## 11. Verificación rápida después de implementar (Nueva versión + Ctrl + F5)

1. Login: ojo de contraseña (también en Registrarme); "¿Qué es esto?"; "Recordar usuario" completa el email la próxima vez.
2. Iniciar con "Mantener la sesión", cerrar la pestaña y volver a abrir la URL: entra directo.
3. Cerrar sesión: muestra el login al instante y sin datos del usuario anterior.
4. Diseñador: combo (escribir parte de un SKU/nombre, elegir con clic y con teclado), "Automatizar con IA" varias veces, (i) visible.
5. Cola: columna "Fecha de publicación"; lápiz → guardar un cambio y verlo en la planilla; tildar/destildar **Iterativo** y ver `RecicladoAutomatico` en `Configuracion`.
6. Configuración: las 4 pestañas; cambiar el nombre en Información personal (se actualiza en `Usuarios`); recorrido guiado desde "Guía".
