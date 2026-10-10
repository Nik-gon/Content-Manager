# Auto Manager — App Android (Capacitor)

Envoltorio (WebView) de la Web App de Apps Script. La app siempre carga la versión desplegada:
cuando hagas "Nueva versión" en Apps Script, todos la ven sin reinstalar el APK.

## Requisitos (una sola vez)
- Node.js 18+  ·  JDK 17  ·  Android SDK (lo más fácil: instalar Android Studio una vez y usarlo solo como instalador del SDK)
- Variable `ANDROID_HOME` (o `android/local.properties` con `sdk.dir=...`)

## 1. Configurar la URL
Editá `capacitor.config.json` → `server.url` con tu URL `/exec` (la de "Implementar → Administrar implementaciones").
Nunca la `/dev`.

## 2. Instalar y compilar
    npm install
    npm run build:debug
El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.
(En Windows usá `cd android && gradlew.bat assembleDebug` si el script npm falla.)

Probarlo en el celular: activar depuración USB y `adb install -r app-debug.apk`,
o pasar el APK por WhatsApp/Drive y abrirlo (hay que permitir "instalar apps desconocidas").

## 3. APK final firmado para repartir
1. Crear el keystore (UNA vez; guardalo y su clave en lugar seguro, sin él no se puede actualizar la app):
       keytool -genkeypair -v -keystore auto-manager.keystore -alias automanager -keyalg RSA -keysize 2048 -validity 10000
2. Copiar `android/keystore.properties.example` a `android/keystore.properties` y completarlo.
3. `npm run build:release` → `android/app/build/outputs/apk/release/app-release.apk`

## Qué ya viene resuelto
- Almacenamiento del navegador activo (la opción "Mantener la sesión iniciada" funciona).
- Selector de archivos/cámara para el widget de Cloudinary (lo maneja Capacitor).
- Navegación permitida a Google (Apps Script) y Cloudinary; el resto se abre en el navegador.
- `allowBackup=false`: el token de sesión no entra en los backups de Android.

## Personalizar
- Nombre: `capacitor.config.json` → `appName` y `android/app/src/main/res/values/strings.xml`.
- ID del paquete: `appId` (cambiarlo antes del primer `cap add`; después se complica).
- Ícono: reemplazar los `mipmap-*` de `android/app/src/main/res/` (o usar `@capacitor/assets`).
- Versión: `versionCode` / `versionName` en `android/app/build.gradle` (subir `versionCode` en cada APK nuevo).

## Si algo falla
Con `webContentsDebuggingEnabled: true` en la config, abrí `chrome://inspect` en la PC con el celular conectado para ver la consola del WebView.
