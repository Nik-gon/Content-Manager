# Make.com Documentacion

Links Testing

https://us2.make.com/2608472/scenarios?folder=all&tab=all&type=scenario&sort=nameAsc

# 🤖 Documentación Técnica & Operativa: MVP de Automatización para Community Manager (Make.com + Gemini + Cloudinary + Google Sheets)

💡 **Objetivo del Sistema:** Automatizar la creación de copys persuasivos, la variabilidad visual y la publicación de productos en Instagram para liquidar stock inmovilizado. Con este nuevo enfoque de **"Catálogo Vivo"**, se requiere nula intervención manual diaria: el sistema rota infinitamente entre formatos (producto, modelo, detalle) sin depender de computadoras locales encendidas ni de cargas manuales constantes.

## 📐 1. Arquitectura del Sistema (El Stack Gratuito en la Nube)

El flujo funciona como una tubería de datos (*pipeline*) 100% en la nube:

- 🗄️ **Base de Datos (Google Sheets):** Actúa como inventario inteligente. Almacena 1 fila por producto con todas sus fotos posibles (producto, modelo, detalle) y controla qué toca publicar a continuación mediante una lógica de rotación.
- ☁️ **Procesador de Imágenes (Cloudinary):** Transforma automáticamente las imágenes `.webp` de TiendaNube a `.jpg` al vuelo para que sean aceptadas por la API de Meta.
- 🧠 **Inteligencia Artificial (Gemini Flash API):** Redacta copys dinámicos. Su estilo se adapta automáticamente a lo que se muestra en la foto (ej. *Lifestyle* para fotos de modelo, *Diseño* para flatlay) y evalúa el stock para generar sentido de urgencia si quedan pocas unidades.
- ⚙️ **Orquestador (Make.com):** Conecta la base, enruta la estrategia del día, dispara la IA y actualiza la base de datos para la siguiente publicación.
- 📢 **Canal de Emisión (Instagram API):** Publica el contenedor (foto + texto) en la cuenta comercial.

## 📊 2. Preparación de la Base de Datos y Estrategia de Contenido

### 2.1 Estrategia de Rotación de Contenido (1 Fila = 1 Producto)

A diferencia de sistemas básicos, aquí no creamos "1 fila = 1 publicación". Cada fila representa **un producto real** y posee múltiples columnas de imágenes. El sistema consulta la columna **`Siguiente_Tipo`** para saber qué imagen elegir hoy, cómo redactar el texto, y luego la actualiza para que la próxima vez se publique una imagen y un ángulo totalmente distinto.

### 2.2 Estructura de Columnas en Google Sheets

Crea tu planilla (basada en el catálogo oficial) con esta estructura:

| **Columna** | **Nombre** | **Ejemplo de Valor** | **Descripción / Función** |
| --- | --- | --- | --- |
| **A** | `ID` | 001 | Identificador único del producto. |
| **B** | `Producto` | Conjunto Silene | Nombre descriptivo del artículo. |
| **C** | `Precio` | $43.000 | Precio de lista. |
| **D** | `URL_Tienda` | `https://.../silene` | Link de compra directa. |
| **E** | `Stock` | 4 | **Solo números enteros**. Clave para la urgencia de la IA. |
| **F** | `Img_Prod_1` | `https://.../foto1.jpg` | Foto enfocada 100% en el producto (Flatlay). |
| **G** | `Img_Prod_2` | `https://.../foto2.jpg` | Segunda foto del producto. |
| **H** | `Img_Mod_1` | `https://.../mod1.jpg` | Foto del producto siendo usado por una modelo. |
| **I** | `Siguiente_Tipo` | Producto_1 | **El cerebro del sistema.** Define qué formato se publica en el turno actual (ej. `Producto_1`, `Modelo_1`, `Carrusel`). |
| **J** | `Sorteo` | `=ALEATORIO()` | Mezcla la tabla para no repetir orden. |
| **K** | `Estado` | Activo | Valores: **`Activo`** o **`Pausado`**. |

### 2.3 Hack de Aleatoriedad Dinámica

1. Escribe **`=ALEATORIO()`** en la primera celda de la columna `Sorteo` y arrastra hasta abajo.
2. En Google Sheets: *Archivo ➔ Configuración ➔ Cálculo ➔ Recálculo*.
3. Cambia a **"Al cambiar y cada hora"**. El Excel se re-ordenará solo automáticamente de fondo.

## 🚀 4. Guía Paso a Paso en Make.com (Configuración del Escenario)

La arquitectura de Make.com utilizará un **Enrutador (Router)** para tomar caminos diferentes dependiendo del tipo de publicación.

El flujo será: `[Reloj]` ➔ `[Search Rows]` ➔ `[Router]` ➔ `[Rutas de Gemini + Instagram + Update Row]`.

### ⚙️ Módulo 0: El Disparador (Schedule)

Configura para que corra 1 vez al día en el horario de mayor audiencia (ej. 11:00 AM).

### 📊 Módulo 1: Google Sheets ➔ Search Rows (Guía de Vinculación)

El objetivo de este módulo es leer la base de datos y extraer **solo un producto al azar** que tenga stock.

- **Paso 1:** En tu cuenta de [Make.com](http://make.com/), ve a Scenarios y haz clic en Create a new scenario.
- **Paso 2:** Agrega el módulo `Google Sheets` y selecciona `Search Rows`.
- **Paso 3:** Vincula tu cuenta, selecciona la planilla y hoja. Activa `Table contains headers` (Yes).
- **Paso 4 (La Magia):**
    - Filter Regla 1: `Estado` Equal to `Activo`.
    - Filter Regla 2 (AND): `Stock` Greater than `0`.
    - Sort order: `Ascending`.
    - Order by: `Sorteo` (la columna aleatoria).
    - Maximum number of returned rows: `1`.
- **Paso 5:** Clic derecho ➔ *Run this module only*. Comprueba que trae un solo producto.

### 🔀 Módulo 2: Router

Conecta un Router al Módulo 1. Crearemos distintos "caminos" (rutas) filtrados por la columna `Siguiente_Tipo`.

#### 🛣️ CAMINO A: Foto de Producto (Si `Siguiente_Tipo` = Producto_1)

- **Filtro en la ruta:** `Siguiente_Tipo` Equal to `Producto_1`.

**1. Módulo HTTP ➔ Make a request (Gemini API)**

- **Body (JSON):** Aquí usamos un **condicional de stock** directamente en Make para generar Urgencia.

JSON

```
{
  "contents": [{
    "parts": [{
      "text": "Eres un Community Manager de lencería. Redacta un pie de foto para Instagram. Producto: {{1.Producto}}, Precio: {{1.Precio}}, Link: {{1.URL_Tienda}}. La imagen mostrará el producto en primer plano, enfócate en el DISEÑO y los DETALLES. {{if(1.Stock < 5; '🚨 ALERTA DE STOCK CRÍTICO: Quedan solo ' + 1.Stock + ' unidades. Usa tono de ALTA URGENCIA y escasez.'; 'Usa un tono persuasivo sobre los beneficios del producto.')}} Incluye 4 hashtags y un CTA claro sin comillas."
    }]
  }]
}
```

**2. Módulo Instagram ➔ Create a Photo Post**

- **Photo URL (Transformación Cloudinary):**
    
    `https://res.cloudinary.com/TU_CLOUD_NAME/image/fetch/f_jpg/{{1.Img_Prod_1}}`
    
- **Caption:** Mapea el texto de Gemini.

**3. Módulo Google Sheets ➔ Update a Row**

- **Row number:** `{{1.row_number}}`
- **Columna `Siguiente_Tipo`:** Escribe **`Modelo_1`** *(Esto asegura que la próxima vez que salga este producto, saltará a la foto con modelo).*

#### 🛣️ CAMINO B: Foto con Modelo (Si `Siguiente_Tipo` = Modelo_1)

- **Filtro en la ruta:** `Siguiente_Tipo` Equal to `Modelo_1`.
- **Gemini API:** El prompt es igual, pero cambia la orden de estilo: *"La imagen muestra a una modelo usándolo, enfócate en el LIFESTYLE, cómo queda puesto y la comodidad."*
- **Instagram Photo URL:** Usa la variable `{{1.Img_Mod_1}}`.
- **Update a Row:** Cambia la columna `Siguiente_Tipo` a **`Producto_2`** (o de vuelta a `Producto_1` para reiniciar el ciclo).

## 🛠️ 5. Manual Operativo para la Emprendedora (Mantenimiento 1 min/día)

Con esta estructura, el mantenimiento es nulo, pero si la dueña quiere agregar material nuevo, el proceso es simple:

1. **Subir foto a la nube:** Entra a Cloudinary, sube las fotos nuevas y haz clic en *Copy URL*.
2. **Asignar a un producto existente:** Abre el Google Sheets, busca la fila del producto correspondiente y pega el link en la celda vacía (por ejemplo, en `Img_Mod_2` si es una foto nueva de modelo).
3. **Agregar nuevos productos:** Simplemente llena una fila nueva al final de la tabla, ponle fotos, escribe el precio, el stock real, ingresa `Producto_1` en `Siguiente_Tipo` y pon el `Estado` en `Activo`.

**💡 Gestión de Stock:**

Tu amiga **SOLO** debe preocuparse por actualizar el número en la columna `Stock` si se vende algo por otro medio.

- Si el número cae por debajo de 5, Make y Gemini lo detectan solos y redactarán copys de *"¡Últimos X disponibles!"*.
- Si el stock llega a 0, Make directamente lo ignora y pasa al siguiente producto.