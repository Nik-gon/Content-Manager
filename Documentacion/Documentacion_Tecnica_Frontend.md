# Auto Manager — Frontend Web (Netlify/Cloudflare) — Documentación Técnica

**Estado:** en construcción, por etapas (ver sección "Progreso").
**Objetivo:** reemplazar el `Index.html` servido por Apps Script por un frontend estático propio (Vite), que habla con el mismo backend de Apps Script a través de un proxy. El backend (`Backend.js`, Sheets, Make, Cloudinary, Groq) no cambia salvo el router de `doPost` descrito en la sección 2.

Este documento es el equivalente, para el frontend nuevo, de `Documentacion_Tecnica_Desarrollador.md` (que sigue describiendo el backend y el Apps Script actual). Se actualiza al cerrar cada etapa.

---

## 1. Por qué se reescribe

El `Index.html` original es un solo archivo (~1500 líneas) con dos `<script>` IIFE que se comunican por `window`, estado centralizado a mano, y Tailwind por CDN. Funciona, pero:

- No se puede alojar fuera de Apps Script sin reescribir la comunicación (`google.script.run` solo existe dentro de HTML Service).
- No hay separación por módulos: todo vive en dos funciones gigantes.
- Tailwind Play CDN no es apto para producción (lo dice el propio comentario del código original).

La reescritura apunta a: **Vite + JavaScript con módulos ES + Tailwind compilado**, organizado por features, con una sola capa que habla con el backend.

## 2. Qué cambia en el backend (una sola vez, ya resuelto)

- Nueva Script Property `FRONTEND_API_SECRET` (distinta de `MAKE_SECRET`).
- Nuevo router en `doPost(e)` con lista blanca de acciones (públicas y con sesión), que nunca expone `aprobarCliente`, `verificarConfiguracion`, `medirCostoHash` ni funciones con sufijo `_`.
- `doGet` sigue sirviendo `Index.html` durante la transición (rollback).

Esto está descrito en detalle en la conversación previa y ya aplicado. No se repite acá porque pertenece a `Backend.js`, no al frontend.

## 3. Stack y convenciones

| | |
|---|---|
| Build | Vite (`npm create vite@latest`, template `vanilla`) |
| Lenguaje | JavaScript (módulos ES, sin TypeScript por ahora) |
| Estilos | Tailwind compilado (`@tailwindcss/vite`), no CDN |
| Estado | Módulo propio (`estado/almacen.js`), sin librería externa |
| Hosting | Cloudflare Pages (frontend + proxy en `functions/`) |
| Nombres | Carpetas y archivos en español, salvo los que una herramienta exige en inglés (`index.html`, `package.json`, `vite.config.js`, carpeta `functions/`) |
| Calidad | ESLint + Prettier desde el inicio |

### Reglas de organización

- Un módulo por *feature* (`caracteristicas/<nombre>/`), con su propio `index.js` de entrada.
- Textos y datos estáticos (tutoriales, patrones, pasos del recorrido) van en `constantes/`, nunca mezclados con la lógica.
- **Nadie hace `fetch` fuera de `src/api/cliente.js`.** Si cambia el transporte, se toca un solo archivo.
- Nada de `window.App` / `window.Auth` globales: todo se conecta por `import`. Si el APK necesita un puente, se define en un único lugar (a resolver en una etapa futura, sección 6).

## 4. Estructura completa del proyecto

```
auto-manager-web/
├─ index.html
├─ package.json
├─ vite.config.js
├─ public/
├─ functions/                  # Cloudflare Pages Functions — nombre fijo
│  └─ api.js
└─ src/
   ├─ principal.js             # punto de entrada
   ├─ estilos/
   │  ├─ principal.css
   │  └─ componentes.css
   ├─ api/
   │  ├─ cliente.js
   │  └─ rutas-api.js
   ├─ estado/
   │  ├─ almacen.js
   │  └─ sesion.js
   ├─ caracteristicas/
   │  ├─ autenticacion/
   │  ├─ inventario/
   │  ├─ disenador/
   │  ├─ cola/
   │  ├─ configuracion/
   │  └─ recorrido/
   ├─ componentes/
   ├─ utilidades/
   │  ├─ dom.js
   │  ├─ medios.js
   │  ├─ cloudinary.js
   │  └─ formato.js
   └─ constantes/
      ├─ patrones-magia.js
      ├─ tutoriales.js
      └─ pasos-recorrido.js
```

## 5. Progreso por etapas

Cada etapa es un conjunto de archivos con una responsabilidad única, pensada para poder probarse sola antes de pasar a la siguiente.

### ✅ Etapa 0 — Configuración inicial del proyecto
**Estado: hecha.**

- `npm create vite@latest auto-manager-web -- --template vanilla`
- Tailwind instalado y compilado vía `@tailwindcss/vite` (`vite.config.js` en la raíz).
- Estructura completa de carpetas creada (vacías donde corresponde), con nombres en español.
- Archivos de ejemplo del scaffold (`counter.js`, `style.css`) eliminados/renombrados.

**Archivos que quedaron de esta etapa:** `index.html`, `package.json`, `vite.config.js`, el árbol de carpetas de la sección 4.

### ✅ Etapa 1 — Capa de comunicación con el backend
**Estado: hecha.**

Reemplaza a `google.script.run` y al viejo `rpc()` del `Index.html` original. Es la etapa más importante porque todo lo demás depende de ella.

- **`src/api/cliente.js`**: única función que hace `fetch`. Envía `{ action, args }` por `POST` a `VITE_API_URL` (el proxy), interpreta `{ ok, data }` o `{ ok:false, error, code }`, y lanza `ErrorApi` con un `codigo` (`SESSION` | `RED` | `ERROR`) para que el resto de la app no tenga que parsear mensajes de texto.
- **`src/api/rutas-api.js`**: una función nombrada por cada acción del backend (`loginUsuario`, `getInitialData`, `enviarAColaPublicacion`, etc.), en vez de pasar strings sueltos desde cada feature. Las acciones con sesión anteponen el token automáticamente.
- **`src/estado/sesion.js`**: maneja el token (memoria → `localStorage` → `sessionStorage`, igual que el original) y el email recordado. Expone `obtenerToken`, `guardarToken`, `borrarToken`, `obtenerEmailRecordado`, `guardarEmailRecordado`.

**Dependencia:** esta etapa asume que existe `functions/api.js` (etapa 2) y que el backend ya tiene el router de `doPost` con `FRONTEND_API_SECRET`.

**Criterio de cierre:** se puede llamar `loginUsuario(email, password)` desde la consola del navegador (una vez montado el proxy) y recibir un token real.

### ⬜ Etapa 2 — Proxy (`functions/api.js`)
**Estado: pendiente — siguiente paso.**

Función de Cloudflare Pages que:
1. Acepta solo `POST`.
2. Valida que `action` esté en una lista blanca propia del proxy (espejo de la del backend, defensa en profundidad).
3. Reenvía a la URL `/exec` de Apps Script agregando `serviceKey` (desde variable de entorno `APPS_SCRIPT_SECRET`, nunca hardcodeada).
4. Sigue la redirección de `ContentService` hacia `script.googleusercontent.com`.
5. Nunca loguea el cuerpo de la petición (lleva contraseñas en login/registro/cambio de clave).
6. Devuelve al navegador un JSON limpio, sin trazas internas.

**Variables de entorno necesarias (Cloudflare):** `APPS_SCRIPT_URL` (la `/exec`), `APPS_SCRIPT_SECRET` (= `FRONTEND_API_SECRET` del backend).

**Criterio de cierre:** `npx wrangler pages dev` local + `loginUsuario` de la Etapa 1 responde con datos reales del Sheet Maestro.

### ⬜ Etapa 3 — Estado central (`src/estado/almacen.js`)
**Estado: pendiente.**

Equivalente al objeto `state` del `Index.html` original (`productos`, `categorias`, `medios`, `cola`, `config`, `nombreNegocio`, selección activa del Diseñador). Expone getters/setters o un patrón simple de suscripción, para que las features no toquen un objeto global directamente.

**Criterio de cierre:** `getInitialData()` carga y queda reflejado en el almacén, verificable desde la consola.

### ⬜ Etapa 4 — Utilidades y constantes
**Estado: pendiente.**

- `utilidades/dom.js`: el helper `el()` / `vaciar()` del original (crear nodos sin `innerHTML`).
- `utilidades/medios.js`: `esVideo()`, `obtenerThumbnail()`.
- `utilidades/cloudinary.js`: inicialización del widget de subida.
- `utilidades/formato.js`: normalización de teléfono, fechas, etc.
- `constantes/patrones-magia.js`: los 12 patrones del automatizador.
- `constantes/tutoriales.js`: contenido de las pestañas de ayuda.
- `constantes/pasos-recorrido.js`: `PASOS_TOUR`.

No tienen dependencias de red ni de estado: son funciones puras y datos, fáciles de probar sueltas.

### ⬜ Etapa 5 — Componentes genéricos
**Estado: pendiente.**

`componentes/`: toast, loader, modal base, combobox (el del Diseñador de Posts), reproductor de video. Reutilizables entre features.

### ⬜ Etapa 6 — Feature: autenticación
**Estado: pendiente.**

Login, registro, pantalla de estado de cuenta (pendiente/suspendida), pantalla "¿Qué es esto?", "recordar usuario", persistencia de sesión. Usa las Etapas 1, 3 y 5.

**Criterio de cierre:** se puede loguear, ver el estado de una cuenta no activa, y cerrar sesión, todo contra el backend real.

### ⬜ Etapa 7 — Feature: inventario
**Estado: pendiente.**

Tabla de productos, alta con imágenes, edición, galería por producto.

### ⬜ Etapa 8 — Feature: diseñador de posts
**Estado: pendiente.**

Combo de artículos, pestañas de galería, zona de edición (drag & drop con SortableJS), automatizador (patrones locales), pie de foto con emoji picker.

### ⬜ Etapa 9 — Feature: cola de envíos
**Estado: pendiente.**

Tabla de la cola, distribución cíclico/aleatorio, modo iterativo, modal de edición de una publicación.

### ⬜ Etapa 10 — Feature: configuración
**Estado: pendiente.**

Perfil, cambio de contraseña, contacto, credenciales de Cloudinary, tutoriales.

### ⬜ Etapa 11 — Feature: recorrido guiado
**Estado: pendiente.**

Tour interactivo (`PASOS_TOUR`), reutilizando las features ya migradas como destino de cada paso. Por eso va al final.

### ⬜ Etapa 12 — Integración, deploy y pruebas
**Estado: pendiente.**

- `src/principal.js` arma todo: decide si mostrar autenticación o la app, según la sesión.
- Deploy de prueba en Cloudflare Pages.
- Pruebas completas: login/registro/logout/sesión expirada, CRUD de cada feature, aislamiento entre clientes (token de A no debe tocar datos de B).
- Prueba del APK apuntando al deploy de prueba antes de cambiar la URL de producción en `capacitor.config.json`.
- Plan de rollback: `doGet` de Apps Script sigue sirviendo el `Index.html` viejo mientras tanto.

---

## 6. Pendientes a resolver en etapas futuras (no bloquean el avance actual)

- Definir si el APK necesita algún puente nativo nuevo (hoy usa `window.App`/`window.Auth`; con módulos ES hay que decidir un único punto de exposición, si hace falta).
- Reemplazar el Tailwind Play CDN por el compilado (ya resuelto por el stack elegido, pero falta portar las clases específicas usadas en el `Index.html` original).
- Decidir si se migra `SortableJS` y `emoji-picker-element` tal cual (vía npm) o se buscan alternativas; ambas seguían siendo necesarias para el Diseñador de Posts.
- Rate limiting en el proxy para el endpoint de registro (hoy el límite de 30 registros/hora es global en el backend; conviene además limitar en el proxy para no gastar cuota de Cloudflare con abuso).

## 7. Historial de cambios de este documento

| Fecha | Cambio |
|---|---|
| 2026-10-30 | Creación del documento. Etapas 0 y 1 cerradas. |
