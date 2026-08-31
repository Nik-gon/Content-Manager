# Documentación Técnico-Funcional: Content Manager (Instagram MVP)

## 1. Arquitectura y Tecnologías
El proyecto es una **Single Page Application (SPA)** diseñada para gestionar inventario, recursos multimedia y programar publicaciones en Instagram. Opera de forma independiente (Standalone) y utiliza una arquitectura orientada a eventos.
* **Frontend:** HTML5, Tailwind CSS (maquetación), SortableJS (drag & drop).
* **Backend:** Google Apps Script (GAS) servido mediante `doGet()`.
* **Almacenamiento (Base de Datos):** Google Sheets (actúa como motor relacional estático).
* **Gestión de Medios:** Cloudinary (Widget de subida Unsigned).
* **Automatización:** Make / Integromat (consumidor de la cola de publicación).

---

## 2. Esquema de Base de Datos (Google Sheets)
El documento debe contener exactamente las siguientes 4 pestañas con sus respectivos encabezados en la fila 1:

| Pestaña | Columnas Requeridas |
| :--- | :--- |
| **Productos** | `SKU` \| `Nombre` \| `Stock` \| `Estado` |
| **Categorias_Config** | `ID_Categoria` \| `Nombre_Visible` \| `Orden` |
| **Galeria_Medios** | `ID_Medio` \| `SKU` \| `ID_Categoria` \| `URL` |
| **Cola_Publicacion** | `ID_Post` \| `SKU` \| `Formato` \| `URLs_Payload` \| `Estado` \| `Timestamp` |

---

## 3. Guía de Despliegue (Apps Script)
Para inicializar o actualizar el entorno de producción, sigue estos pasos:
1. Abre el Google Sheet asociado al proyecto y navega a **Extensiones > Apps Script**.
2. Crea un archivo llamado `Codigo.gs` y pega el código backend (Lógica y CRUD).
3. Crea un archivo HTML llamado `Index.html` y pega el código frontend (UI y SPA).
4. Haz clic en **Implementar > Nueva implementación**.
5. Selecciona el tipo **Aplicación web**.
6. Configura "Ejecutar como: Tú" y "Quién tiene acceso: Solo yo" (o según necesidad).
7. Autoriza los permisos de Google. La URL resultante (terminada en `/exec`) es el acceso al sistema en producción. Para desarrollo, utiliza la URL de prueba terminada en `/dev`.

---

## 4. Configuración de Cloudinary
El sistema requiere un entorno de Cloudinary para alojar las imágenes sin sobrecargar Google Drive.
1. Crea una cuenta gratuita en [Cloudinary](https://cloudinary.com/).
2. Copia el **Cloud Name** desde el panel principal (Dashboard).
3. Navega a **Settings > Upload > Upload presets** y crea uno nuevo.
4. Nómbralo (ej. `app_instagram`) y cambia obligatoriamente el *Signing Mode* a **Unsigned**.
5. Reemplaza los valores `cloudName` y `uploadPreset` en el archivo `Index.html` dentro de la función de inicialización del widget.