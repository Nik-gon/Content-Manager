# Configuración del cliente

Pedirle al cliente que instale AnyDesk para poder hacer la configuracion de Cloudinary y Make con su cuenta. (Ya debe tener la cuenta configurada)

## Cuenta del cliente

- La cuenta de instagram debe ser de “Profesional” (Empresa o Creador).
- Desde la cuenta de faceBook del emprendimiento crear la ‘pagina de faceBook’ del negocio.
    - Una vez creada la ‘Pagina de faceBook’  ir a “Configuracion” → “Cuentas vinculadas” y vincular la cuenta de instagram del negocio con la “Pagina de faceBook”

## Cloudinary

1. Crear cuenta en [cloudinary.com](https://cloudinary.com/) — con el email del propio negocio.
2. Copiar el **Cloud Name** desde el Dashboard principal.
3. Ir a **Settings → Upload → Upload presets** → crear uno nuevo.
    1. Nombrarlo (Nombre del negocio) y cambiar el **Signing Mode a Unsigned** — esto es obligatorio, si queda en *Signed* el widget de subida de la Web App no va a poder subir archivos.
4. Cargar el `Cloud Name` y el nombre del preset en la Web App (Configuración → Cloudinary)

Límites del widget: se aceptan `jpg`, `jpeg`, `png`, `webp`, `heic`, `heif`, `mp4` y `mov`; hasta 15 MB por imagen y 100 MB por video.

## Make

1. Crear un espacio de trabajo con el Nombre del emprendimiento
    1. Icono de perfil —> “organization settings” —> “Edit organization”
2. Invitar a [gonzaleztunu2@gmail.com](mailto:gonzaleztunu2@gmail.com) al espacio de trabajo
3. Crear un escenario nuevo e importar el bluePrint del flujo
    1. Editar los links de Docs
    2. Iniciar sesion con la cuenta del enprendimiento en cada modulo de Intagram
        1. Seleccionar la pagina de facebook en ‘Pages’
4. Ajustar el prompt de IA segun el  modelo de negocio del cliente.
5. Configurar el Schedule segun lo quiera el cliente.