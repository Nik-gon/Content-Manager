# Auto Manager — Guía de Implementación: Alta de Cliente Nuevo

Guía operativa para configurar el sistema desde cero y para dar de alta cada cliente nuevo. Pensada para seguirse paso a paso, sin necesidad de tocar código.

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
Dejala vacía de datos — se completa sola cuando alguien se registra.

**Pestaña `Configuracion_Global`** — fila 1 con los encabezados, fila 2 con los valores:

| WHATSAPP_NUMERO | WHATSAPP_MENSAJE_DEFAULT | EMAIL_CONTACTO | MENSAJE_PENDIENTE_APROBACION | MENSAJE_SUSPENDIDO |
|---|---|---|---|---|
| *(tu número con código de país, sin espacios ni signos, ej. 5491167964852)* | *(texto precargado del WhatsApp)* | *(tu email de contacto)* | *(mensaje para cuentas sin aprobar)* | *(mensaje para cuentas suspendidas)* |

⚠️ El número de WhatsApp **tiene que llevar el código de país** (`54` Argentina + `9` para celular + el número sin el 0 ni el 15). Si lo cargás sin eso, el botón de WhatsApp puede no funcionar. Formateá la celda como **texto plano** antes de escribir el número, para que Sheets no te borre un eventual `0` inicial.

### A.2 Crear el proyecto de Apps Script

1. En el Sheet Maestro: **Extensiones → Apps Script**.
2. Borrá el contenido del archivo `Codigo.gs` que viene por defecto y pegá ahí el contenido completo de `Backend_v2.txt` (o el `Backend` vigente que te hayan entregado).
3. Creá un archivo HTML nuevo llamado exactamente `Index` (Apps Script le agrega `.html` solo) y pegá ahí el contenido completo de `Index_v2.txt`.
4. Guardá (ícono de disco o `Ctrl+S`).

### A.3 Desplegar la Web App

1. **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como:** Tú (tu cuenta de Google).
4. **Quién tiene acceso:** **Cualquier usuario, incluso anónimo**. *(Esto es obligatorio — si queda en "Solo yo", nadie más que vos va a poder entrar a loguearse.)*
5. **Implementar** → autorizá los permisos que pida Google.
6. Copiá la URL que termina en `/exec`. Esa es la URL que le vas a dar a todos tus clientes.

### A.4 Crear tu propio usuario admin para pruebas

El registro público siempre arranca en estado `Pendiente_Aprobacion`, así que para poder entrar y probar necesitás crear un usuario a mano:

1. Andá a la pestaña `Usuarios` del Sheet Maestro.
2. Agregá una fila con tus propios datos de prueba. Completá como mínimo:
   - `Email` y una contraseña *(ojo: el campo `Password_Hash` no se completa a mano con la contraseña en texto plano — para esto es más simple usar el flujo de registro normal desde la app y después solo cambiarle el `Estado` a `Activo` a mano, ver A.5)*.
3. **Forma recomendada:** registrate vos mismo desde la Web App (como si fueras un cliente), y después en el Sheet Maestro buscá esa fila y cambiale manualmente `Estado` a `Activo`. Así el hash de la contraseña queda generado correctamente por el sistema.

### A.5 Cada vez que cambies el código

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
2. Completa: nombre del negocio, email, teléfono, contraseña.
3. Queda creada su fila en `Usuarios` con `Estado = Pendiente_Aprobacion` — **todavía no puede entrar**.

### B.2 Crear el Sheet de datos del cliente

1. Copiá el **Sheet plantilla** de cliente (el que tiene las pestañas `Productos`, `Categorias_Config`, `Galeria_Medios`, `Cola_Publicacion`, `Configuracion` ya armadas con sus encabezados correctos, incluyendo la columna `Fecha_Publicacion` en `Cola_Publicacion`).
   - Si todavía no tenés una plantilla guardada, armala una vez a partir de un Sheet de cliente que ya funcione y guardala aparte como "plantilla maestra" para no tener que recrearla cada vez.
2. Renombrá la copia con el nombre del negocio (ej. `Auto Manager - NOVAELA`).
3. Completá, si corresponde, su catálogo inicial de productos y categorías (o dejalo vacío para que lo cargue el cliente desde la app).
4. Copiá el **Spreadsheet ID** de este nuevo Sheet (es la parte de la URL entre `/d/` y `/edit`).
5. **Importante:** tu cuenta de Google (la misma que corre el Apps Script) tiene que tener acceso de **editor** a este Sheet. Si lo creaste vos copiando la plantilla, ya lo tenés. Si en algún momento el Sheet termina en la cuenta de Google del cliente, pedile que te lo comparta con permiso de edición — si no, el login le va a funcionar pero la carga de datos le va a tirar error.

### B.3 Crear el escenario de Make.com

Según el plan del cliente:

- **Plan Abonado:** creás el escenario en **tu propia cuenta** de Make, dentro de una carpeta con el nombre del cliente (para mantenerlos separados).
- **Plan Instalación Única:** le entregás el blueprint (`Reciclado_Cola_Publicacion_blueprint.json` y el del escenario principal) para que lo importe en **su propia** cuenta de Make.

Pasos (en cualquiera de los dos casos):
1. Importá o clonás el escenario plantilla "Integration Google Sheets".
2. En los módulos de **Google Sheets**, apuntalos al Spreadsheet ID del Sheet de este cliente (paso B.2.4).
3. En el módulo de **Instagram**, conectá la cuenta de Instagram Business real del cliente (ver checklist en B.4) — **no la dejes apuntando a una cuenta de prueba**.
4. Aplicá el **Filter** de cola vacía después del `Search Rows` inicial (corta la ejecución si no hay ninguna fila `Pendiente`, evita que explote en el módulo de Instagram).
5. En el módulo que marca `Estado = Enviado`, mapeá también la columna `Fecha_Publicacion` con la fecha/hora actual.
6. Si el cliente va a usar el modo "Iterativo" (reciclado automático de la cola): importá también el escenario de reciclado, apuntado al mismo Sheet, programado para correr cada 15-30 minutos.
7. Activá (encendé) el/los escenario/s.

### B.4 Checklist de permisos de Meta/Instagram (pedírselo al cliente antes de B.3.3)

- [ ] La cuenta de Instagram es tipo **Empresa** o **Creador** (no personal).
- [ ] Está vinculada a una **Página de Facebook** de su marca (`Editar perfil → Información pública de empresa → Página` en la app de Instagram).
- [ ] El cliente tiene rol de **Administrador con control total** de esa página de Facebook (necesario para autorizar la conexión con Make).

### B.5 Aprobar la cuenta en el Sheet Maestro

1. Volvé a la pestaña `Usuarios` del Sheet Maestro.
2. Buscá la fila del cliente (por email).
3. Completá:
   - `ID_Sheet_Cliente`: el Spreadsheet ID del paso B.2.4.
   - `Plan`: `Instalacion_Unica` o `Abonado`.
   - `Fecha_Aprobacion`: hoy.
   - `Estado`: cambialo a `Activo`.
4. Avisale al cliente que ya puede entrar.

### B.6 Configuración que carga el cliente (o vos, por él) desde la propia app

Una vez que entra por primera vez:

1. **Configuración → Cloudinary**: cargar `Cloud Name` y `Upload Preset` (ver Parte C si todavía no tiene cuenta de Cloudinary).
2. **Configuración → Información personal**: puede ajustar nombre del negocio y teléfono si hace falta.
3. **Inventario**: cargar productos si no se precargaron en B.2.3.
4. **Diseñador de Posts**: subir fotos/videos a la galería de cada producto (vía el widget de Cloudinary, que ya debería estar configurado del paso 1).

---

## Parte C — Configuración de Cloudinary (una vez por cliente)

Cada cliente necesita su propia cuenta de Cloudinary (plan gratuito alcanza para empezar).

1. Crear cuenta gratuita en [cloudinary.com](https://cloudinary.com/) — puede ser con el email del propio negocio, o centralizada en una cuenta tuya si administrás varios clientes (ojo con los límites del plan free si hacés esto para muchos clientes a la vez).
2. Copiar el **Cloud Name** desde el Dashboard principal.
3. Ir a **Settings → Upload → Upload presets** → crear uno nuevo.
4. Nombrarlo (ej. `app_instagram`) y cambiar el **Signing Mode a Unsigned** — esto es obligatorio, si queda en *Signed* el widget de subida de la Web App no va a poder subir archivos.
5. Cargar el `Cloud Name` y el nombre del preset en la Web App (Configuración → Cloudinary, paso B.6.1).

---

## Parte D — Verificación después de cada alta o cada cambio de código

Checklist rápida para confirmar que todo quedó bien:

1. **Login:** el cliente puede entrar con su email y contraseña; si tilda "Mantener la sesión iniciada", al cerrar y reabrir el navegador sigue adentro.
2. **Cerrar sesión:** vuelve al login al instante, sin rastros de la sesión anterior.
3. **Diseñador de Posts:** el combo de productos filtra bien por SKU/nombre; "Automatizar con IA" arma un carrusel; se puede guardar un pie de foto manual con emojis.
4. **Enviar a Make:** la publicación aparece en la pestaña `Cola_Publicacion` del Sheet del cliente con `Estado = Pendiente`.
5. **Cola de Envíos:** se ve la publicación recién creada; el lápiz permite editarla y el cambio se refleja en la planilla.
6. **Corrida de Make:** ejecutar el escenario manualmente una vez (▶ en Make) y confirmar que: tomó la fila `Pendiente`, generó o usó el pie de foto correcto, publicó en la cuenta de Instagram correcta (no la de prueba), marcó `Estado = Enviado` y completó `Fecha_Publicacion`.
7. **Modo Iterativo** (si aplica): tildarlo en Cola de Envíos y confirmar que `Configuracion.RecicladoAutomatico` pasó a `1` en el Sheet del cliente.

---

## Troubleshooting — problemas conocidos

### El botón "Registrarme" no responde al hacer clic

Antes de buscar un bug de código, descartá en este orden:

1. **¿Se hizo "Nueva versión" después del último cambio de código?** (Parte A.5). Es la causa más común — sin este paso, `/exec` sigue sirviendo una versión vieja del HTML que puede no tener el flujo de login completo.
2. **`Ctrl + F5`** en el navegador para descartar una versión cacheada.
3. Si sigue sin funcionar: abrí la consola del navegador (**F12 → pestaña Console**) justo antes de hacer clic, y anotá cualquier texto en rojo que aparezca — ese mensaje es lo que hace falta para diagnosticarlo.
4. Confirmá también si la pantalla de login carga bien de entrada (el loader desaparece, se ven los campos de email/contraseña). Si ni eso carga bien, el problema es anterior al botón en sí.

### El link de WhatsApp abre en blanco o no reconoce el número

- Confirmá que `WHATSAPP_NUMERO` en `Configuracion_Global` tenga el código de país completo (`549` + número, sin 0 ni 15 — ver A.1).
- Confirmá que la celda esté en formato texto (no número), para que no se haya perdido un cero inicial.

### Un cliente no puede cargar sus datos después de loguearse bien

Casi siempre es un problema de permisos: tu cuenta de Google (la que corre el Apps Script) no es editora del Sheet de ese cliente. Volvé al paso B.2.5.

### Cambié el código y no veo el cambio

Te faltó el paso A.5 (Nueva versión) o el `Ctrl+F5` del navegador.

---

## Resumen de accesos y datos a tener a mano

- URL `/exec` de la Web App (la das a todos los clientes).
- Spreadsheet ID del Sheet Maestro.
- Spreadsheet ID de la plantilla de cliente (para copiar en cada alta).
- Blueprint del escenario principal de Make y del escenario de reciclado.
- Credenciales de la cuenta de Make donde administrás los escenarios de los clientes "Abonado".
