# Auto Manager — Guía de Implementación: Alta de Cliente Nuevo

Guía operativa para configurar el sistema desde cero y para dar de alta cada cliente nuevo. Pensada para seguirse paso a paso, sin necesidad de tocar código.

> **Qué cambió respecto a la versión anterior:** el reciclado de la cola ahora lo hace el backend y lo dispara Make desde el mismo escenario (ya no hay un escenario de reciclado aparte); hay un secreto nuevo (`MAKE_SECRET`); las contraseñas piden 10 caracteres como mínimo; la sesión dura 14 días; y el alta de un cliente se hace con la función `aprobarCliente`. Todo está integrado en los pasos de abajo.

---

## Parte A — Configuración inicial del sistema (se hace **una sola vez**)

Esto es la infraestructura compartida: el Sheet Maestro y la Web App central. Todos los clientes futuros entran por acá.

### A.1 Crear el Sheet Maestro

1. Creá un Google Sheet nuevo. Nombralo algo como `Auto Manager - Sheet Maestro`.
2. Creá dos pestañas, **exactamente con estos nombres**:

**Pestaña `Usuarios`** — fila 1 con estos encabezados, en este orden:
```
ID_Usuario | Email | Telefono | Nombre_Negocio | Password_Hash | Password_Salt | Estado | Plan | ID_Sheet_Cliente | Fecha_Registro | Fecha_Aprobacion | Token_Sesion | Ultimo_Login
```
Dejala vacía de datos — se completa sola cuando alguien se registra. (El orden de las columnas importa: el código las lee por posición.)

**Pestaña `Configuracion_Global`** — fila 1 con los encabezados, fila 2 con los valores:

| WHATSAPP_NUMERO | WHATSAPP_MENSAJE_DEFAULT | EMAIL_CONTACTO | MENSAJE_PENDIENTE_APROBACION | MENSAJE_SUSPENDIDO |
|---|---|---|---|---|
| *(tu número, ej. 5491167964852)* | *(texto precargado del WhatsApp)* | *(tu email de contacto)* | *(mensaje para cuentas sin aprobar)* | *(mensaje para cuentas suspendidas)* |

ℹ️ El sistema completa el prefijo argentino si cargás un número de 10 dígitos (`1167964852` → `5491167964852`), pero lo más seguro es cargarlo **completo** (`54` + `9` + número, sin 0 ni 15). Formateá la celda como **texto plano** antes de escribirlo, para que Sheets no te borre un eventual `0` inicial.

⚠️ Esta pestaña es **pública**: se lee antes del login. No guardes nada sensible ahí.

### A.2 Crear el proyecto de Apps Script

1. En el Sheet Maestro: **Extensiones → Apps Script**.
2. Borrá el contenido del archivo `Codigo.gs` que viene por defecto y pegá ahí el contenido completo de `Backend.js` (la versión vigente).
3. Creá un archivo HTML nuevo llamado exactamente `Index` (Apps Script le agrega `.html` solo) y pegá ahí el contenido completo de `Index.html`.
4. Guardá (ícono de disco o `Ctrl+S`).

### A.3 Definir el secreto para Make (`MAKE_SECRET`)

Es la clave con la que Make le pide al backend que recicle la cola. **Sin esto el modo "Iterativo" no funciona** (Make recibe "No autorizado").

1. En Apps Script: **Configuración del proyecto** (⚙️) → **Propiedades del script** → **Agregar propiedad**.
2. Nombre: `MAKE_SECRET`. Valor: una clave larga y aleatoria (30+ caracteres, sin espacios).
3. Guardá y anotá la clave: la vas a pegar en Make (paso B.3). **Nunca la pegues en el código.**

### A.4 Desplegar la Web App

1. **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como:** Tú (tu cuenta de Google).
4. **Quién tiene acceso:** **Cualquier usuario, incluso anónimo**. *(Obligatorio — si queda en "Solo yo", nadie más que vos puede loguearse, y Make tampoco puede llamar al backend.)*
5. **Implementar** → autorizá los permisos que pida Google.
6. Copiá la URL que termina en **`/exec`**. Esa es la URL que le das a todos tus clientes **y** la que usa Make.

⚠️ No uses nunca la URL que termina en `/dev` para Make ni para los clientes: es el deployment de prueba, solo funciona con tu sesión.

### A.5 Crear tu propio usuario admin para pruebas

El registro público siempre arranca en `Pendiente_Aprobacion`, y la contraseña se guarda con un hash que no se puede escribir a mano, así que:

1. Registrate vos mismo desde la Web App (como si fueras un cliente). La contraseña debe tener **al menos 10 caracteres** y no puede ser igual al email.
2. Aprobate con la función `aprobarCliente` (paso B.5), o cambiando a mano `Estado` a `Activo` y completando `ID_Sheet_Cliente` y `Plan` en la fila de la pestaña `Usuarios`.

### A.6 Cada vez que cambies el código

Pegar el código nuevo **no alcanza** para que se vea reflejado:

1. **Implementar → Administrar implementaciones**.
2. Click en el lápiz (✏️) de la implementación activa.
3. **Versión: Nueva versión**.
4. **Implementar**.
5. En el navegador, refrescá con `Ctrl + F5` (recarga forzada, ignora caché) antes de probar.

Si te saltás este paso, la URL `/exec` sigue sirviendo el código viejo aunque hayas guardado los cambios en el editor.

---

## Parte B — Alta de cliente nuevo

Repetí esto por cada cliente que se suma al sistema.

### B.1 El cliente se registra (o lo registrás vos por él)

1. El cliente entra a la URL `/exec` y usa la opción **"Registrarme"**.
2. Completa: nombre del negocio, email, teléfono, contraseña (mínimo 10 caracteres).
3. Queda creada su fila en `Usuarios` con `Estado = Pendiente_Aprobacion` — **todavía no puede entrar**.

*(Hay un tope de 30 registros por hora en todo el sistema, para frenar el spam. Si a un cliente le aparece "Hay muchas solicitudes de registro", que pruebe más tarde.)*

### B.2 Crear el Sheet de datos del cliente

1. Copiá el **Sheet plantilla** de cliente (el que tiene las pestañas `Productos`, `Categorias_Config`, `Galeria_Medios`, `Cola_Publicacion`, `Configuracion` ya armadas con sus encabezados correctos).
   - La pestaña `Configuracion` lleva encabezados `Clave | Valor` y una fila por clave: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `CiclicoOK` (`1`) y `RecicladoAutomatico` (`0`).
   - `Cola_Publicacion` tiene 9 columnas (`ID`, `SKU`, `Formato`, `URLs_Payload`, `Estado`, `Timestamp`, `Pie_Foto`, `Orden_Ejecucion`, `Fecha_Publicacion`). Si falta la última, la app la crea sola al primer ingreso.
   - Si todavía no tenés una plantilla guardada, armala una vez a partir de un Sheet de cliente que ya funcione y guardala aparte como "plantilla maestra".
2. Renombrá la copia con el nombre del negocio (ej. `Auto Manager - NOVAELA`).
3. Completá, si corresponde, su catálogo inicial de productos y categorías (o dejalo vacío para que lo cargue el cliente desde la app).
   - ⚠️ Si precargás medios en `Galeria_Medios`, tienen que ser **URLs de Cloudinary** (`https://res.cloudinary.com/…`). Imágenes de otro sitio (por ejemplo, de Tienda Nube) se ven en la galería pero la app **no las deja encolar**.
4. Copiá el **Spreadsheet ID** de este nuevo Sheet (es la parte de la URL entre `/d/` y `/edit`).
5. **Importante:** tu cuenta de Google (la misma que corre el Apps Script) tiene que tener acceso de **editor** a este Sheet. Si lo creaste vos copiando la plantilla, ya lo tenés. Si el Sheet termina en la cuenta de Google del cliente, pedile que te lo comparta con permiso de edición.
6. **Un Sheet por cliente, siempre.** Nunca le asignes el mismo Sheet a dos usuarios: compartirían datos (`aprobarCliente` lo bloquea).

### B.3 Configurar el escenario de Make.com

Hay **un solo escenario por cliente** ("Integration Google Sheets"). El reciclado de la cola ya viene incluido: **no hace falta importar ningún escenario de reciclado aparte** (el blueprint `Reciclado_Cola_Publicacion_blueprint.json` ya no se usa).

Según el plan del cliente:

- **Plan Abonado:** creás el escenario en **tu propia cuenta** de Make, dentro de una carpeta con el nombre del cliente.
- **Plan Instalación Única:** le entregás el blueprint para que lo importe en **su propia** cuenta de Make. ⚠️ Antes de entregarlo, mirá la nota de seguridad al final de este paso.

Pasos:
1. Importá o clonás el escenario plantilla "Integration Google Sheets".
2. En **todos** los módulos de **Google Sheets** (el `Search Rows` inicial, los de `Productos` y `Galeria_Medios`, y los 6 `Update Row`), apuntalos al Spreadsheet ID del Sheet de este cliente (B.2.4) y reconectá la cuenta de Google correspondiente.
3. En el **primer módulo (HTTP)**, el que dispara el reciclado:
   - **URL:** la `/exec` de tu Web App (A.4) — **no** la `/dev`.
   - **Método:** `POST`, con los campos `action = reciclarCola`, `idSheet = <Spreadsheet ID del cliente>` y `key = <MAKE_SECRET>`, enviados en el cuerpo (formulario o JSON), **no en la URL**.
   - *Estado actual:* el blueprint de referencia todavía lo tiene como `GET` con todo en la URL y apuntando a `/dev`. La `/dev` solo responde con tu sesión de Google, así que desde Make puede fallar; hay que migrarlo a `POST` y `/exec` (ver Documentación Técnica, sección 6.2).
4. En los **módulos de Instagram** (hay 6: Foto, Reel y Carrusel, con y sin pie manual), elegí la cuenta de Instagram Business real del cliente (checklist en B.4) — **no la dejes apuntando a una cuenta de prueba**.
5. En el **módulo de Gemini**, reemplazá el prompt: el que viene está escrito para la marca NOVAELA (nombre, link de la tienda y hashtags fijos). Cambialos por los del cliente.
6. En los **6 módulos `Update Row`** (los que marcan `Estado = Enviado`), mapeá también la columna `Fecha_Publicacion` (I) con la fecha/hora actual, por ejemplo `{{formatDate(now; "DD/MM/YYYY HH:mm"; "America/Argentina/Buenos_Aires")}}`. *(Hoy el blueprint de referencia solo marca `Enviado`; sin este mapeo la columna "Fecha de publicación" de la app queda vacía.)*
7. El filtro de cola vacía **ya está incluido** (una rama del router que termina la corrida si no hay filas `Pendiente`); no hace falta agregar nada.
8. Programá el escenario (por ejemplo cada 15–30 minutos) y activalo. **La frecuencia del reciclado es la del escenario**: cada corrida revisa primero si hay que reiniciar la cola.

🔒 **Seguridad del blueprint:** el módulo HTTP lleva en texto plano el `MAKE_SECRET` y el `idSheet`. Si vas a entregar el blueprint a un cliente "Instalación Única", **cambiá el `MAKE_SECRET` por uno nuevo** (A.3) y no dejes el `idSheet` de otro cliente adentro.

### B.4 Checklist de permisos de Meta/Instagram (pedírselo al cliente antes de B.3.4)

- [ ] La cuenta de Instagram es tipo **Empresa** o **Creador** (no personal).
- [ ] Está vinculada a una **Página de Facebook** de su marca (`Editar perfil → Información pública de empresa → Página` en la app de Instagram).
- [ ] El cliente tiene rol de **Administrador con control total** de esa página de Facebook (necesario para autorizar la conexión con Make).

### B.5 Aprobar la cuenta

**Forma recomendada — con `aprobarCliente` (valida todo antes de activar):**

1. En Apps Script, agregá una función auxiliar (o editá la que ya tengas) con los datos del cliente:
   ```js
   function aprobarEjemplo() {
     aprobarCliente('cliente@mail.com', 'ID_DEL_SHEET_DEL_CLIENTE', 'Abonado'); // o 'Instalacion_Unica'
   }
   ```
2. Ejecutala desde el editor (**Ejecutar**). Si algo está mal te lo dice: plan inválido, el Sheet no abre (falta permiso de editor), le faltan pestañas, o ya está asignado a otro usuario.
3. Si todo está bien, el cliente queda con `ID_Sheet_Cliente`, `Plan`, `Fecha_Aprobacion` completos y `Estado = Activo`.
4. Avisale al cliente que ya puede entrar.

**Alternativa manual** (sin esas validaciones): en la pestaña `Usuarios` completá `ID_Sheet_Cliente`, `Plan` (`Instalacion_Unica` o `Abonado`), `Fecha_Aprobacion` y cambiá `Estado` a `Activo`.

Para **suspender** a un cliente, cambiá su `Estado` a `Suspendido`: pierde la sesión en su próxima acción. También podés ejecutar `verificarConfiguracion()` desde el editor para ver el estado de todas las cuentas y detectar problemas (resultado en **Ejecuciones → Registros**).

### B.6 Configuración que carga el cliente (o vos, por él) desde la propia app

Una vez que entra por primera vez:

1. **Configuración → Cloudinary**: cargar `Cloud Name` y `Upload Preset` (ver Parte C si todavía no tiene cuenta de Cloudinary).
2. **Configuración → Información personal**: puede ajustar nombre del negocio y teléfono, y **cambiar su contraseña** (mínimo 10 caracteres).
3. **Inventario**: cargar productos si no se precargaron en B.2.3.
4. **Diseñador de Posts**: subir fotos/videos a la galería de cada producto (vía el widget de Cloudinary, que ya debería estar configurado del paso 1).
5. **Configuración → Tutoriales**: tiene un recorrido guiado de toda la app, útil para el primer ingreso.

---

## Parte C — Configuración de Cloudinary (una vez por cliente)

Cada cliente necesita su propia cuenta de Cloudinary (plan gratuito alcanza para empezar).

1. Crear cuenta gratuita en [cloudinary.com](https://cloudinary.com/) — puede ser con el email del propio negocio, o centralizada en una cuenta tuya si administrás varios clientes (ojo con los límites del plan free si hacés esto para muchos clientes a la vez).
2. Copiar el **Cloud Name** desde el Dashboard principal.
3. Ir a **Settings → Upload → Upload presets** → crear uno nuevo.
4. Nombrarlo (ej. `app_instagram`) y cambiar el **Signing Mode a Unsigned** — esto es obligatorio, si queda en *Signed* el widget de subida de la Web App no va a poder subir archivos.
5. Cargar el `Cloud Name` y el nombre del preset en la Web App (Configuración → Cloudinary, paso B.6.1).

Límites del widget: se aceptan `jpg`, `jpeg`, `png`, `webp`, `heic`, `heif`, `mp4` y `mov`; hasta 15 MB por imagen y 100 MB por video.

---

## Parte D — Verificación después de cada alta o cada cambio de código

Checklist rápida para confirmar que todo quedó bien:

1. **Login:** el cliente puede entrar con su email y contraseña; si tilda "Mantener la sesión iniciada", al cerrar y reabrir el navegador sigue adentro (la sesión dura 14 días desde el último login).
2. **Cerrar sesión:** vuelve al login al instante, sin rastros de la sesión anterior.
3. **Contraseña:** desde Configuración → Información personal se puede cambiar (pide la actual; mínimo 10 caracteres).
4. **Diseñador de Posts:** el combo de productos filtra bien por SKU/nombre; "Automatizar con IA" arma un carrusel (es una selección local de 12 estructuras, no una IA real); se puede guardar un pie de foto manual con emojis.
5. **Enviar a la cola:** la publicación aparece en la pestaña `Cola_Publicacion` del Sheet del cliente con `Estado = Pendiente`. Si da "dirección inválida", alguno de los medios no es de Cloudinary.
6. **Cola de Envíos:** se ve la publicación recién creada; el lápiz permite editarla y el cambio se refleja en la planilla.
7. **Corrida de Make:** ejecutar el escenario manualmente una vez (▶ en Make) y confirmar que: el módulo HTTP respondió sin error (`PENDIENTES_ACTIVOS`, `REINICIADO` o `IGNORADO`), tomó la fila `Pendiente`, generó o usó el pie de foto correcto, publicó en la cuenta de Instagram correcta (no la de prueba), marcó `Estado = Enviado` y completó `Fecha_Publicacion`.
8. **Modo Iterativo** (si aplica): tildarlo en Cola de Envíos y confirmar que `Configuracion.RecicladoAutomatico` pasó a `1` en el Sheet del cliente. Para probar el reciclado, dejá todas las publicaciones en `Enviado` y ejecutá el escenario: el HTTP debe responder `REINICIADO`, las filas vuelven a `Pendiente` y sin pies de foto ni fecha de publicación.
9. **Celular:** abrir la app desde un teléfono y confirmar que el menú lateral se abre con el botón de hamburguesa.

---

## Troubleshooting — problemas conocidos

### El botón "Registrarme" no responde al hacer clic

Antes de buscar un bug de código, descartá en este orden:

1. **¿Se hizo "Nueva versión" después del último cambio de código?** (Parte A.6). Es la causa más común — sin este paso, `/exec` sigue sirviendo una versión vieja del HTML.
2. **`Ctrl + F5`** en el navegador para descartar una versión cacheada.
3. Si sigue sin funcionar: abrí la consola del navegador (**F12 → pestaña Console**) justo antes de hacer clic, y anotá cualquier texto en rojo que aparezca — ese mensaje es lo que hace falta para diagnosticarlo.
4. Confirmá también si la pantalla de login carga bien de entrada (el loader desaparece, se ven los campos de email/contraseña). Si ni eso carga bien, el problema es anterior al botón en sí.

### El link de WhatsApp abre en blanco o no reconoce el número

- Confirmá que `WHATSAPP_NUMERO` en `Configuracion_Global` esté bien cargado (ver A.1). Podés ejecutar `verificarConfiguracion()` en el editor: te muestra el número ya normalizado y el link `wa.me` resultante.
- Confirmá que la celda esté en formato texto (no número), para que no se haya perdido un cero inicial.

### Un cliente no puede cargar sus datos después de loguearse bien

Casi siempre es un problema de permisos: tu cuenta de Google (la que corre el Apps Script) no es editora del Sheet de ese cliente. Volvé al paso B.2.5. Mensajes típicos: *"No se pudo acceder a tu workspace"*, *"Falta una pestaña requerida en tu workspace"* (le falta una de las 5 pestañas o está mal escrita).

### Un cliente aprobado ve "Tu cuenta todavía no tiene un workspace asignado"

Quedó `Estado = Activo` pero sin `ID_Sheet_Cliente`. Completalo (o usá `aprobarCliente`).

### "Sesión expirada" o lo sacan al login

La sesión dura 14 días desde el último login y no se renueva por uso: tiene que volver a iniciar sesión. También ocurre si suspendiste la cuenta o si iniciaron sesión en otro navegador (cada login genera un token nuevo y el anterior deja de valer).

### "Demasiados intentos fallidos"

Se bloquean 15 minutos los intentos de login (y de cambio de contraseña) de ese email tras 5 fallos. Hay que esperar.

### Make: el módulo HTTP devuelve "No autorizado" o una página de Google

- **"No autorizado":** la `key` no coincide con la propiedad `MAKE_SECRET` del script (o la propiedad no existe — A.3).
- **"No se pudo procesar la solicitud":** el `idSheet` no corresponde a un cliente con `Estado = Activo` en el Maestro, o la cuenta del script no puede abrir ese Sheet.
- **Respuesta HTML / pantalla de login de Google:** la URL es la `/dev` o la Web App no está desplegada para "Cualquier usuario, incluso anónimo". Usá la `/exec` (A.4).
- **No recicla aunque esté todo bien:** puede ser que `RecicladoAutomatico` sea `0` (respuesta `IGNORADO`) o que todavía queden filas en `Pendiente` (respuesta `PENDIENTES_ACTIVOS`).

### La columna "Fecha de publicación" queda vacía

Make todavía no está mapeando `Fecha_Publicacion` en los `Update Row` (B.3, paso 6).

### No puedo agregar una imagen a una publicación ("dirección inválida")

Solo se aceptan URLs de Cloudinary. Volvé a subir el archivo desde la app (el widget lo sube a Cloudinary).

### Cambié el código y no veo el cambio

Te faltó el paso A.6 (Nueva versión) o el `Ctrl+F5` del navegador.

---

## Resumen de accesos y datos a tener a mano

- URL `/exec` de la Web App (la das a todos los clientes y la usa Make).
- Spreadsheet ID del Sheet Maestro.
- Spreadsheet ID de la plantilla de cliente (para copiar en cada alta).
- Valor del `MAKE_SECRET` (guardado en un gestor de contraseñas; el único otro lugar donde vive es el módulo HTTP de Make).
- Blueprint del escenario "Integration Google Sheets" (ya incluye el reciclado).
- Credenciales de la cuenta de Make donde administrás los escenarios de los clientes "Abonado".
