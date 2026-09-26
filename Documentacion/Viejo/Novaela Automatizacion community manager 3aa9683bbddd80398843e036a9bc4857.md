# Novaela: Automatizacion community manager

# Instagram

[[Make.com](http://Make.com) Documentacion](Make%20com%20Documentacion%203aa9683bbddd806cb0aec2d5e7fc3811.md)

[WEB APP standAlone](WEB%20APP%20standAlone%203cd9683bbddd80219ecff67383de01fe.md)

## Acciones de Laura

> 💡 **Objetivo:** Preparar los accesos, la tienda y los contenidos necesarios para que el sistema automatizado comience a funcionar en su fase de pruebas y posterior pase a producción.
> 

---

## 📱 1. Redes Sociales y Permisos (El Puente con Meta)

Para que el sistema automatizado pueda publicar en el feed sin errores de permisos, se deben cumplir los siguientes requisitos en las cuentas oficiales:

- [ ]  **Tipo de Cuenta de Instagram:** Confirmar que el perfil de Instagram de la tienda sea de tipo **Empresa (Business)** o **Creador**. *(Las cuentas personales no permiten el acceso a la API oficial de publicación).*
- [ ]  **Vinculación con Página de Facebook:** Verificar que la cuenta de Instagram esté enlazada a una **Página de Facebook** de la marca (se revisa desde la App de Instagram en *Editar perfil ➔ Información pública de empresa ➔ Página*).
- [ ]  **Permisos de Administrador:** Asegurarse de que la dueña tenga el rol de **Administradora con control total** de dicha Página de Facebook para poder autorizar la conexión con la herramienta de automatización.

---

## 🛍️ 2. Tienda Online y Stock (Canal de Venta)

Como el objetivo principal es derivar tráfico para liquidar el stock inmovilizado, el circuito comercial debe estar listo:

- [ ]  **Estado de TiendaNube:** Confirmar que la tienda online siga activa (bajo el dominio `.mitiendanube.com` o el propio) y que el carrito de compras junto con los medios de pago (Mercado Pago) funcionen correctamente.
- [ ]  **Depuración del Catálogo:** Revisar el inventario inicial de ~20 productos y **marcar con stock `0` o eliminar** aquellos artículos que ya no tengan disponibilidad física real, evitando promocionar productos agotados.

---

## 🎨 3. Contenido y Lineamientos de Marca (Identidad y IA)

Para que la Inteligencia Artificial redacte textos alineados a la voz del emprendimiento:

- [ ]  **Creación de Cuenta en Cloudinary:** Registrar una cuenta gratuita en [Cloudinary.com](https://cloudinary.com/) (o centralizarla con un correo del negocio) para utilizarla como repositorio y convertidor automático de imágenes.
- [ ]  **Validación de Estilos / Ángulos Creativos:** Aprobar los 4 tonos de redacción que utilizará la IA para variar las publicaciones:
    1. *Urgencia / Liquidación* (Descuentos y últimas unidades).
    2. *Beneficio / Lifestyle* (Cómo queda puesto, comodidad, ocasiones de uso).
    3. *Calidad / Zoom* (Detalles y texturas de la tela).
    4. *Humor / Relacionable* (Preguntas interactivas y situaciones cotidianas).
- [ ]  **Hashtags y Vocabulario:** Definir 3 o 4 hashtags fijos de la marca y detallar si existen palabras o términos específicos que prefieran evitar en las descripciones.

---

## 🛠️ 4. Rutina de Mantenimiento Operativo (Día a Día)

Instrucciones rápidas para que la emprendedora cargue nuevo material sin complicaciones técnicas:

1. **Subir la foto:** Arrastrar la foto (de la sesión modelando o exportada de Canva) a la *Media Library* de Cloudinary.
2. **Copiar el link:** Hacer clic en los tres puntos (`...`) de la imagen subida y copiar el **"Copy URL"**.
3. **Pegar en Google Sheets:** Agregar una nueva fila en el Excel de inventario, pegar el link en la columna de imagen, completar los datos, elegir un **Estilo** y cambiar el estado a **`Pendiente`**.