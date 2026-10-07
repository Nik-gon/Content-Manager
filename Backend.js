// ============================================================================
// AUTO MANAGER - BACKEND MULTI-TENANT
//
// Este script vive vinculado al SHEET MAESTRO (el que tiene las pestañas
// "Usuarios" y "Configuracion_Global"). Cada cliente tiene su PROPIO
// spreadsheet (Productos, Categorias_Config, Galeria_Medios, Cola_Publicacion,
// Configuracion), al que se accede con openById() una vez validada la sesión.
//
// ============================================================================

var HOJA_USUARIOS = 'Usuarios';
var HOJA_CONFIG_GLOBAL = 'Configuracion_Global';
var COL = { ID: 0, EMAIL: 1, TEL: 2, NEGOCIO: 3, HASH: 4, SALT: 5, ESTADO: 6, PLAN: 7, SHEET: 8, F_REG: 9, F_APR: 10, TOKEN: 11, ULTIMO: 12 };
var SESION_DIAS = 14;      // duración de una sesión (no se renueva por uso)
var MAX_INTENTOS = 5;      // intentos de login fallidos permitidos...
var BLOQUEO_SEG = 900;     // ...dentro de esta ventana (15 min)
var PASSWORD_MIN = 10;     // largo mínimo de contraseña (cuentas existentes: aplica al cambiarla)
var MAX_REGISTROS_HORA = 30; // tope global de altas por hora (anti-spam)
var TOKEN_PEPPER = 'am-session-v1';

// ============================================================================
// ENTRADA DE LA WEB APP
// ============================================================================
function doGet(e) {
  // COMPATIBILIDAD: el reciclado por GET deja la clave en la URL (queda en logs de Make/Google).
  // Migrar el módulo HTTP de Make a POST (ver doPost) y, después, borrar este bloque.
  if (e && e.parameter && e.parameter.action === 'reciclarCola') {
    auditar_('reciclar_por_get', 'Migrar el módulo HTTP de Make a POST');
    return procesarReciclado_(e.parameter);
  }

  // Comportamiento normal: servir la Web App.
  // Sin ALLOWALL: la app no se puede incrustar en sitios ajenos (clickjacking).
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Auto Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// Entrada para Make (HTTP POST). Campos: action=reciclarCola, key=<MAKE_SECRET>, idSheet=<ID del Sheet del cliente>.
// Acepta formulario (x-www-form-urlencoded) o JSON en el cuerpo.
function doPost(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  if (!p.action && e && e.postData && e.postData.contents) {
    try { p = JSON.parse(e.postData.contents) || {}; } catch (err) { p = {}; }
  }
  if (String(p.action || '') === 'reciclarCola') return procesarReciclado_(p);
  return jsonOut_({ estado: 'ERROR', mensaje: 'Solicitud no válida.' });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function procesarReciclado_(p) {
  // MAKE_SECRET vive en Propiedades del script (Configuración del proyecto), nunca en el código.
  var secreto = PropertiesService.getScriptProperties().getProperty('MAKE_SECRET');
  var recibido = String(p.key || '');
  if (!secreto || !igualesConstante_(recibido, secreto)) {
    Utilities.sleep(1500); // frena la fuerza bruta sin demorar a Make cuando la clave es correcta
    auditar_('reciclar_no_autorizado', '');
    return jsonOut_({ estado: 'ERROR', mensaje: 'No autorizado.' });
  }
  // Solo se opera sobre el Sheet de un cliente ACTIVO registrado en el Maestro (no sobre cualquier ID).
  var idSheet = String(p.idSheet || '').trim();
  if (!sheetEsDeClienteActivo_(idSheet)) {
    auditar_('reciclar_sheet_no_registrado', idSheet.substring(0, 8));
    return jsonOut_({ estado: 'ERROR', mensaje: 'No se pudo procesar la solicitud.' });
  }
  try {
    var ss = SpreadsheetApp.openById(idSheet);
    return jsonOut_(revisarYReiniciarColaInterno_(ss));
  } catch (error) {
    return jsonOut_({ estado: 'ERROR', mensaje: 'No se pudo procesar la solicitud.' });
  }
}

function sheetEsDeClienteActivo_(id) {
  if (!id) return false;
  var data = hojaUsuarios_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL.SHEET]).trim() === id && String(data[i][COL.ESTADO]).trim() === 'Activo') return true;
  }
  return false;
}

// ============================================================================
// UTILIDADES INTERNAS
// ============================================================================
function conLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// Registro de eventos de seguridad (Ejecuciones > Registros en el editor de Apps Script).
// Nunca pasar contraseñas ni tokens acá.
function auditar_(evento, detalle) {
  try {
    console.log(JSON.stringify({ evento: evento, detalle: String(detalle || '').substring(0, 200), t: new Date().toISOString() }));
  } catch (e) { /* el registro nunca debe romper el flujo */ }
}

// Solo el dueño del script (ejecutando desde el editor). Falla si el email viene vacío.
function soloDueno_() {
  var activo = Session.getActiveUser().getEmail();
  var efectivo = Session.getEffectiveUser().getEmail();
  if (!activo || activo !== efectivo) throw new Error('No autorizado.');
}

// En el Sheet se guarda el HASH del token de sesión, no el token.
function hashToken_(token) {
  return 't1$' + hashPassword_(String(token), TOKEN_PEPPER);
}

// Contador de intentos fallidos con ventana FIJA (el TTL no se renueva en cada fallo).
function claveFallos_(email) {
  return 'fail_' + hashPassword_(String(email).trim().toLowerCase(), 'am-throttle').substring(0, 40);
}
function leerFallos_(cache, key) {
  var raw = cache.get(key);
  if (!raw) return { n: 0, t: 0 };
  try {
    var o = JSON.parse(raw);
    if (o && typeof o === 'object') return { n: Number(o.n) || 0, t: Number(o.t) || 0 };
    return { n: Number(o) || 0, t: 0 };
  } catch (e) { return { n: 0, t: 0 }; }
}
function sumarFallo_(cache, key, f) {
  var ahora = Date.now();
  var ini = (f.n > 0 && f.t && (ahora - f.t) < BLOQUEO_SEG * 1000) ? f.t : ahora;
  var restante = Math.max(1, Math.ceil(BLOQUEO_SEG - (ahora - ini) / 1000));
  cache.put(key, JSON.stringify({ n: f.n + 1, t: ini }), restante);
}

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt, Utilities.Charset.UTF_8);
  return raw.map(function (byte) {
    var v = (byte < 0) ? byte + 256 : byte;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// Hash v2 (con stretching). Se guarda con prefijo "v2$" para distinguirlo del hash viejo.
var HASH_V2_PREFIX = 'v2$';
var HASH_ITERACIONES = 2000;

function bytesAHex_(raw) {
  return raw.map(function (byte) {
    var v = (byte < 0) ? byte + 256 : byte;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function hashPasswordV2_(password, salt) {
  var h = password + salt;
  for (var n = 0; n < HASH_ITERACIONES; n++) {
    h = bytesAHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return HASH_V2_PREFIX + h;
}

// Valida contra el hash guardado, sea v1 (viejo) o v2. Indica si hay que migrar.
function verificarPassword_(password, salt, hashGuardado) {
  hashGuardado = String(hashGuardado);
  if (hashGuardado.indexOf(HASH_V2_PREFIX) === 0) {
    return { ok: igualesConstante_(hashPasswordV2_(password, salt), hashGuardado), migrar: false };
  }
  return { ok: igualesConstante_(hashPassword_(password, salt), hashGuardado), migrar: true };
}

// Comparación de tiempo constante (evita filtrar información por temporización)
function igualesConstante_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var max = Math.max(a.length, b.length);
  for (var i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hojaUsuarios_() {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_USUARIOS);
  if (!ws) throw new Error('Falta la pestaña "' + HOJA_USUARIOS + '" en el Sheet Maestro.');
  return ws;
}

// Devuelve una pestaña del sheet del cliente o falla con un mensaje claro.
function hoja_(ss, nombre) {
  var ws = ss.getSheetByName(nombre);
  if (!ws) {
    console.error('Falta la pestaña "' + nombre + '" en el sheet del cliente.');
    throw new Error('Falta una pestaña requerida en tu workspace. Contactanos.');
  }
  return ws;
}

// Agrega una fila al final. Las columnas indicadas en colsTexto (base 1) se
// guardan como TEXTO: evita que "00123" se vuelva 123 y que un texto que
// empiece con "=" se ejecute como fórmula.
function appendFila_(ws, fila, colsTexto) {
  var r = ws.getLastRow() + 1;
  (colsTexto || []).forEach(function (c) { ws.getRange(r, c).setNumberFormat('@'); });
  ws.getRange(r, 1, 1, fila.length).setValues([fila]);
  return r;
}

// Normaliza un teléfono argentino al formato de wa.me (54 9 + área + número).
// 1167964852 -> 5491167964852 | 011 6796-4852 -> 5491167964852
function normalizarTelefonoAR_(raw) {
  var d = String(raw === null || raw === undefined ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^00/, '');
  if (d.length === 11 && d.charAt(0) === '0') d = d.substring(1);
  if (d.length === 10) return '549' + d;
  if (d.indexOf('54') === 0 && d.charAt(2) !== '9' && d.length === 12) return '549' + d.substring(2);
  return d;
}

// Solo URLs de entrega de Cloudinary (imagen/video), sin espacios ni caracteres que rompan el separador " * ".
function urlValida_(u) {
  u = String(u || '');
  return u.length <= 500 &&
    /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/(image|video)\/upload\/[^\s*'"<>]+$/i.test(u);
}

// ============================================================================
// CONFIGURACIÓN GLOBAL (pública: no requiere sesión)
// ============================================================================
function obtenerConfiguracionGlobal() {
  var config = {
    WHATSAPP_NUMERO: '',
    WHATSAPP_MENSAJE_DEFAULT: 'Hola! Quiero información sobre Auto Manager',
    EMAIL_CONTACTO: '',
    MENSAJE_PENDIENTE_APROBACION: 'Tu cuenta está en revisión, te contactamos pronto.',
    MENSAJE_SUSPENDIDO: 'Tu cuenta está inactiva. Contactanos para reactivarla.'
  };

  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CONFIG_GLOBAL);
  if (ws && ws.getLastRow() >= 1) {
    // getDisplayValues: trae el texto tal cual se ve (evita 1.16E9 y similares)
    var data = ws.getDataRange().getDisplayValues();
    var leidos = {};
    var vertical = data.length >= 1 && String(data[0][0]).trim().toLowerCase() === 'clave';
    if (vertical) {
      for (var i = 1; i < data.length; i++) {
        var k = String(data[i][0] || '').trim();
        if (k) leidos[k] = data[i][1];
      }
    } else if (data.length >= 2) {
      for (var j = 0; j < data[0].length; j++) {
        var clave = String(data[0][j] || '').trim();
        if (clave) leidos[clave] = data[1][j];
      }
    }
    Object.keys(config).forEach(function (key) {
      var v = leidos[key];
      if (v !== undefined && String(v).trim() !== '') config[key] = String(v).trim();
    });
  }

  config.WHATSAPP_NUMERO = normalizarTelefonoAR_(config.WHATSAPP_NUMERO);
  return config;
}

// ============================================================================
// AUTENTICACIÓN Y CUENTAS
// ============================================================================
function registrarUsuario(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var telefono = String(payload.telefono || '').trim();
  var nombreNegocio = String(payload.nombreNegocio || '').trim();
  var password = String(payload.password || '');

  if (!email || !telefono || !nombreNegocio || !password) throw new Error('Todos los campos son obligatorios.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresá un email válido.');
  if (password.length < PASSWORD_MIN) throw new Error('La contraseña debe tener al menos ' + PASSWORD_MIN + ' caracteres.');
  if (password.toLowerCase() === email) throw new Error('La contraseña no puede ser igual al email.');
  if (nombreNegocio.length > 100 || telefono.length > 30 || email.length > 120 || password.length > 100) {
    throw new Error('Alguno de los datos es demasiado largo.');
  }

  // Tope global de altas por hora (evita llenar el Sheet Maestro y saturar el lock).
  var cacheReg = CacheService.getScriptCache();
  var nReg = Number(cacheReg.get('reg_global') || 0);
  if (nReg >= MAX_REGISTROS_HORA) throw new Error('Hay muchas solicitudes de registro en este momento. Probá de nuevo más tarde.');
  cacheReg.put('reg_global', String(nReg + 1), 3600);

  // El hash (costoso) se calcula FUERA del lock para no bloquear a los demás clientes.
  var salt = Utilities.getUuid();
  var hashNuevo = hashPasswordV2_(password, salt);

  return conLock_(function () {
    var ws = hojaUsuarios_();
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL.EMAIL]).trim().toLowerCase() === email) {
        throw new Error('Ya existe una cuenta registrada con ese email.');
      }
    }

    var fila = ws.getLastRow() + 1;
    // A..I y L como texto: teléfono, hash, salt y token nunca se reinterpretan
    ws.getRange(fila, 1, 1, 9).setNumberFormat('@');
    ws.getRange(fila, 12).setNumberFormat('@');
    ws.getRange(fila, 1, 1, 13).setValues([[
      'USR-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      email, telefono, nombreNegocio,
      hashNuevo, salt,
      'Pendiente_Aprobacion', '', '',
      new Date(), '', '', ''
    ]]);
    auditar_('registro', email);
    return { ok: true, estado: 'Pendiente_Aprobacion' };
  });
}

function loginUsuario(email, password) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!email || !password) throw new Error('Completá email y contraseña.');
  if (email.length > 120 || password.length > 100) throw new Error('Email o contraseña incorrectos.');

  // Límite de intentos por email: ventana fija de BLOQUEO_SEG; se limpia al ingresar bien.
  var cache = CacheService.getScriptCache();
  var key = claveFallos_(email);
  var f = leerFallos_(cache, key);
  if (f.n >= MAX_INTENTOS) {
    auditar_('login_bloqueado', email);
    throw new Error('Demasiados intentos fallidos. Esperá unos minutos e intentá de nuevo.');
  }
  function fallar() {
    sumarFallo_(cache, key, f);
    auditar_('login_fallido', email);
    // Mismo mensaje para email inexistente y clave incorrecta
    throw new Error('Email o contraseña incorrectos.');
  }

  var ws = hojaUsuarios_();
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL.EMAIL]).trim().toLowerCase() !== email) continue;

    var salt = String(data[i][COL.SALT]);
    var chk = verificarPassword_(password, salt, data[i][COL.HASH]);
    if (!chk.ok) fallar();
    cache.remove(key);
    if (chk.migrar) {
      // Contraseña correcta con hash viejo: se actualiza al hash nuevo
      ws.getRange(i + 1, COL.HASH + 1).setNumberFormat('@').setValue(hashPasswordV2_(password, salt));
    }

    var estado = String(data[i][COL.ESTADO] || '').trim() || 'Pendiente_Aprobacion';
    var nombre = String(data[i][COL.NEGOCIO]);
    if (estado !== 'Activo') return { ok: false, estado: estado, nombreNegocio: nombre };

    // El navegador recibe el token; en el Sheet queda solo su hash.
    var token = Utilities.getUuid() + Utilities.getUuid();
    ws.getRange(i + 1, COL.TOKEN + 1).setNumberFormat('@');
    ws.getRange(i + 1, COL.TOKEN + 1, 1, 2).setValues([[hashToken_(token), new Date()]]);
    auditar_('login_ok', email);
    return { ok: true, estado: 'Activo', token: token, nombreNegocio: nombre };
  }
  // Email inexistente: se hace el mismo trabajo de hash para no revelar (por tiempo de respuesta) si la cuenta existe.
  hashPasswordV2_(password, 'sin-cuenta');
  fallar();
}

function logoutUsuario(token) {
  if (!token) return { ok: true };
  var th = hashToken_(token);
  var ws = hojaUsuarios_();
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var t = String(data[i][COL.TOKEN] || '');
    if (t !== '' && igualesConstante_(t, th)) {
      ws.getRange(i + 1, COL.TOKEN + 1).setValue('');
      break;
    }
  }
  return { ok: true };
}

// Cambio de contraseña (requiere sesión y la contraseña actual; comparte el límite de intentos del login).
function cambiarPassword(token, actual, nueva) {
  var u = requireSesion_(token);
  actual = String(actual || '');
  nueva = String(nueva || '');
  if (!actual || !nueva) throw new Error('Completá la contraseña actual y la nueva.');
  if (nueva.length < PASSWORD_MIN) throw new Error('La contraseña nueva debe tener al menos ' + PASSWORD_MIN + ' caracteres.');
  if (nueva.length > 100) throw new Error('La contraseña es demasiado larga.');
  if (nueva === actual) throw new Error('La contraseña nueva debe ser distinta de la actual.');
  var emailU = String(u.email).trim().toLowerCase();
  if (nueva.toLowerCase() === emailU) throw new Error('La contraseña no puede ser igual al email.');

  var cache = CacheService.getScriptCache();
  var key = claveFallos_(emailU);
  var f = leerFallos_(cache, key);
  if (f.n >= MAX_INTENTOS) throw new Error('Demasiados intentos fallidos. Esperá unos minutos e intentá de nuevo.');

  var salt = Utilities.getUuid();
  var nuevoHash = hashPasswordV2_(nueva, salt); // fuera del lock

  return conLock_(function () {
    var ws = hojaUsuarios_();
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL.ID]) !== u.idUsuario) continue;
      var chk = verificarPassword_(actual, String(data[i][COL.SALT]), data[i][COL.HASH]);
      if (!chk.ok) {
        sumarFallo_(cache, key, f);
        auditar_('password_actual_incorrecta', emailU);
        throw new Error('La contraseña actual no es correcta.');
      }
      cache.remove(key);
      ws.getRange(i + 1, COL.HASH + 1, 1, 2).setNumberFormat('@').setValues([[nuevoHash, salt]]);
      auditar_('password_cambiada', emailU);
      return { ok: true };
    }
    throw new Error('Usuario no encontrado.');
  });
}

// Valida el token y devuelve el usuario + el ID de SU sheet de datos.
// Todas las funciones que tocan datos de cliente arrancan llamando a esto.
function requireSesion_(token) {
  if (!token) throw new Error('Sesión inválida. Por favor, iniciá sesión nuevamente.');
  var th = hashToken_(token);
  var ws = hojaUsuarios_();
  var data = ws.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var t = String(data[i][COL.TOKEN] || '');
    if (t === '' || !igualesConstante_(t, th)) continue;

    if (String(data[i][COL.ESTADO]).trim() !== 'Activo') {
      ws.getRange(i + 1, COL.TOKEN + 1).setValue(''); // una cuenta suspendida no conserva su sesión
      throw new Error('Sesión inválida: tu cuenta no está activa.');
    }
    var ultimo = data[i][COL.ULTIMO];
    // Falla cerrado: si la fecha falta o no es una fecha válida, la sesión se considera vencida.
    if (!(ultimo instanceof Date) || (Date.now() - ultimo.getTime()) > SESION_DIAS * 86400000) {
      throw new Error('Sesión expirada. Por favor, iniciá sesión nuevamente.');
    }
    var idSheet = String(data[i][COL.SHEET] || '').trim();
    if (!idSheet) throw new Error('Tu cuenta todavía no tiene un workspace asignado. Contactanos.');

    return {
      idUsuario: String(data[i][COL.ID]),
      email: String(data[i][COL.EMAIL]),
      nombreNegocio: String(data[i][COL.NEGOCIO]),
      idSheetCliente: idSheet
    };
  }
  throw new Error('Sesión inválida o expirada. Por favor, iniciá sesión nuevamente.');
}

function abrirSheetCliente_(idSheetCliente) {
  try {
    return SpreadsheetApp.openById(idSheetCliente);
  } catch (e) {
    console.error('No se pudo abrir el workspace del cliente: ' + e.message);
    throw new Error('No se pudo acceder a tu workspace. Contactanos.');
  }
}

// Atajo: valida sesión y abre el sheet del cliente.
function ctx_(token) {
  var usuario = requireSesion_(token);
  return { usuario: usuario, ss: abrirSheetCliente_(usuario.idSheetCliente) };
}

// ============================================================================
// LECTURA INICIAL
// ============================================================================
function getInitialData(token) {
  var c = ctx_(token);
  var ss = c.ss;

  var productos = [];
  var dp = hoja_(ss, 'Productos').getDataRange().getValues();
  for (var i = 1; i < dp.length; i++) {
    if (dp[i][0] !== '') productos.push({
      sku: String(dp[i][0]),
      nombre: String(dp[i][1]),
      stock: (dp[i][2] instanceof Date) ? '' : dp[i][2],
      estado: String(dp[i][3] || 'Activo')
    });
  }

  var categorias = [];
  var dc = hoja_(ss, 'Categorias_Config').getDataRange().getValues();
  for (var j = 1; j < dc.length; j++) {
    if (dc[j][0] !== '') categorias.push({ id: String(dc[j][0]), nombre: String(dc[j][1]), orden: Number(dc[j][2]) || 99 });
  }
  categorias.sort(function (a, b) { return a.orden - b.orden; });

  var medios = [];
  var dm = hoja_(ss, 'Galeria_Medios').getDataRange().getValues();
  for (var k = 1; k < dm.length; k++) {
    if (dm[k][0] !== '') medios.push({ id: String(dm[k][0]), sku: String(dm[k][1]), categoria: String(dm[k][2]), url: String(dm[k][3]) });
  }

  var config = { CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_UPLOAD_PRESET: '', CiclicoOK: '1', RecicladoAutomatico: '0' };
  var wsConfig = ss.getSheetByName('Configuracion');
  if (wsConfig) {
    var dcfg = wsConfig.getDataRange().getValues();
    // Lista blanca: al navegador solo llegan estas claves (si alguien agrega un secreto a la hoja, no se filtra).
    var CLAVES_VISIBLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_UPLOAD_PRESET', 'CiclicoOK', 'RecicladoAutomatico'];
    for (var m = 1; m < dcfg.length; m++) {
      var clave = String(dcfg[m][0] || '').trim();
      if (clave && CLAVES_VISIBLES.indexOf(clave) !== -1) config[clave] = String(dcfg[m][1]);
    }
  }

  // Auto-migración: si la cola no tiene la columna "Fecha_Publicacion", se crea el encabezado.
  asegurarColumnaFechaPublicacion_(ss);

  return {
    productos: productos, categorias: categorias, medios: medios,
    cola: leerColaInterno_(ss), config: config,
    nombreNegocio: c.usuario.nombreNegocio
  };
}

// ============================================================================
// CONFIGURACIÓN DEL CLIENTE
// ============================================================================
function setConfig_(ws, clave, valor) {
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === clave) {
      ws.getRange(i + 1, 2).setNumberFormat('@').setValue(valor);
      return;
    }
  }
  appendFila_(ws, [clave, valor], [1, 2]);
}

function guardarConfiguracion(token, cloudName, uploadPreset) {
  var ss = ctx_(token).ss;
  cloudName = String(cloudName || '').trim();
  uploadPreset = String(uploadPreset || '').trim();
  if (cloudName && !/^[A-Za-z0-9_-]{1,100}$/.test(cloudName)) throw new Error('El Cloud Name solo puede tener letras, números, guion y guion bajo.');
  if (uploadPreset && !/^[A-Za-z0-9_.\- ]{1,100}$/.test(uploadPreset)) throw new Error('El Upload Preset tiene caracteres no válidos.');
  var ws = hoja_(ss, 'Configuracion');
  conLock_(function () {
    setConfig_(ws, 'CLOUDINARY_CLOUD_NAME', cloudName);
    setConfig_(ws, 'CLOUDINARY_UPLOAD_PRESET', uploadPreset);
  });
  // Se devuelve la config completa para no pisar CiclicoOK en el front
  var out = { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_UPLOAD_PRESET: uploadPreset, CiclicoOK: obtenerCiclicoOK_(ss) };
  return out;
}

function guardarModoDistribucion(token, modo) {
  var ss = ctx_(token).ss;
  var val = modo === 'aleatorio' ? '0' : '1';
  return conLock_(function () {
    setConfig_(hoja_(ss, 'Configuracion'), 'CiclicoOK', val);
    reordenarInterno_(ss);
    return leerColaInterno_(ss);
  });
}


// Modo "Iterativo": cuando está en '1', el escenario de reciclado de Make vuelve a
// poner en Pendiente todas las publicaciones cuando la cola se termina de enviar.
// Lee la clave RecicladoAutomatico de la pestaña "Configuracion" del cliente.
function guardarModoIterativo(token, activo) {
  var ss = ctx_(token).ss;
  var val = (activo === true || activo === 'true' || activo === 1 || activo === '1') ? '1' : '0';
  conLock_(function () {
    setConfig_(hoja_(ss, 'Configuracion'), 'RecicladoAutomatico', val);
  });
  return val;
}

// ============================================================================
// ABM DE PRODUCTOS
// ============================================================================
function crearProductoConImagenes(token, payload) {
  var ss = ctx_(token).ss;
  payload = payload || {};
  var sku = String(payload.sku || '').trim().toUpperCase();
  var nombre = String(payload.nombre || '').trim();
  if (!sku || !nombre) throw new Error('SKU y Nombre son obligatorios.');
  if (sku.length > 60 || nombre.length > 150) throw new Error('El SKU o el nombre son demasiado largos.');
  var stock = Number(payload.stock) || 0;
  var estado = ['Activo', 'Inactivo', 'Borrador'].indexOf(payload.estado) !== -1 ? payload.estado : 'Activo';

  return conLock_(function () {
    var wsProductos = hoja_(ss, 'Productos');
    var dp = wsProductos.getDataRange().getValues();
    for (var i = 1; i < dp.length; i++) {
      if (String(dp[i][0]).trim().toUpperCase() === sku) throw new Error('El SKU ya existe en la base de datos.');
    }
    appendFila_(wsProductos, [sku, nombre, stock, estado], [1, 2, 4]);

    var mediosGuardados = [];
    var imagenes = payload.imagenes || [];
    if (imagenes.length > 50) throw new Error('Demasiados archivos en una sola carga.');
    if (imagenes.length > 0) {
      var wsMedios = hoja_(ss, 'Galeria_Medios');
      imagenes.forEach(function (img) {
        if (!urlValida_(img.url)) throw new Error('Una de las imágenes tiene una dirección inválida.');
        if (String(img.categoria || '').length > 60) throw new Error('La categoría de una imagen es demasiado larga.');
        var idMedio = 'MED-' + Utilities.getUuid().split('-')[0].toUpperCase();
        appendFila_(wsMedios, [idMedio, sku, String(img.categoria), String(img.url)], [1, 2, 3, 4]);
        mediosGuardados.push({ id: idMedio, sku: sku, categoria: String(img.categoria), url: String(img.url) });
      });
    }
    return { producto: { sku: sku, nombre: nombre, stock: stock, estado: estado }, mediosNuevos: mediosGuardados };
  });
}

function actualizarProducto(token, sku, nombre, stock, estado) {
  var ss = ctx_(token).ss;
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('El nombre no puede quedar vacío.');
  if (nombre.length > 150) throw new Error('El nombre es demasiado largo.');
  stock = Number(stock) || 0;
  if (['Activo', 'Inactivo', 'Borrador'].indexOf(estado) === -1) estado = 'Activo';

  // Dentro del lock: si otra operación borra filas al mismo tiempo, el índice de fila no queda desfasado.
  return conLock_(function () {
    var ws = hoja_(ss, 'Productos');
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(sku)) {
        ws.getRange(i + 1, 2).setNumberFormat('@').setValue(nombre);
        ws.getRange(i + 1, 3).setValue(stock);
        ws.getRange(i + 1, 4).setValue(estado);
        return { sku: String(sku), nombre: nombre, stock: stock, estado: estado };
      }
    }
    throw new Error('Producto no encontrado.');
  });
}

function eliminarProducto(token, sku) {
  var ss = ctx_(token).ss;
  sku = String(sku);

  return conLock_(function () {
    var wsProductos = hoja_(ss, 'Productos');
    var data = wsProductos.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === sku) { wsProductos.deleteRow(i + 1); break; }
    }

    // Cascada: medios asociados (de atrás hacia adelante)
    var wsMedios = hoja_(ss, 'Galeria_Medios');
    var dm = wsMedios.getDataRange().getValues();
    for (var j = dm.length - 1; j > 0; j--) {
      if (String(dm[j][1]) === sku) wsMedios.deleteRow(j + 1);
    }

    // Cascada: publicaciones en cola
    var wsCola = ss.getSheetByName('Cola_Publicacion');
    if (wsCola) {
      var dcola = wsCola.getDataRange().getValues();
      for (var k = dcola.length - 1; k > 0; k--) {
        if (String(dcola[k][1]) === sku) wsCola.deleteRow(k + 1);
      }
      reordenarInterno_(ss);
    }
    return sku;
  });
}

// ============================================================================
// MEDIOS
// ============================================================================
function guardarNuevoMedio(token, url, sku, categoria) {
  var ss = ctx_(token).ss;
  if (!url || !sku || !categoria) throw new Error('Faltan datos del archivo.');
  if (String(sku).length > 60 || String(categoria).length > 60) throw new Error('El SKU o la categoría son demasiado largos.');
  if (!urlValida_(url)) throw new Error('La dirección del archivo no es válida.');
  var idMedio = 'MED-' + Utilities.getUuid().split('-')[0].toUpperCase();
  conLock_(function () {
    appendFila_(hoja_(ss, 'Galeria_Medios'), [idMedio, String(sku), String(categoria), String(url)], [1, 2, 3, 4]);
  });
  return { id: idMedio, sku: String(sku), categoria: String(categoria), url: String(url) };
}

function eliminarMedio(token, idMedio) {
  var ss = ctx_(token).ss;
  return conLock_(function () {
    var ws = hoja_(ss, 'Galeria_Medios');
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(idMedio)) { ws.deleteRow(i + 1); return String(idMedio); }
    }
    throw new Error('Medio no encontrado.');
  });
}

// ============================================================================
// COLA DE PUBLICACIÓN
// ============================================================================
function enviarAColaPublicacion(token, payload) {
  var ss = ctx_(token).ss;
  payload = payload || {};
  var urls = (payload.urls || []).map(String).filter(function (u) { return u; });
  if (!payload.sku) throw new Error('Seleccioná un producto.');
  if (String(payload.sku).length > 60) throw new Error('El SKU es demasiado largo.');
  if (String(payload.pieFoto || '').length > 2200) throw new Error('El pie de foto supera los 2200 caracteres que admite Instagram.');
  if (urls.length === 0) throw new Error('Agregá al menos un archivo.');
  if (urls.length > 10) throw new Error('Instagram permite máximo 10 archivos por carrusel.');
  urls.forEach(function (u) { if (!urlValida_(u)) throw new Error('Uno de los archivos tiene una dirección inválida.'); });

  return conLock_(function () {
    var idPost = 'POST-' + Utilities.getUuid().split('-')[0].toUpperCase();
    var formato = urls.length > 1 ? 'Carrusel' : 'Feed';
    appendFila_(hoja_(ss, 'Cola_Publicacion'),
      [idPost, String(payload.sku), formato, urls.join(' * '), 'Pendiente', new Date(), String(payload.pieFoto || ''), 0],
      [1, 2, 3, 4, 5, 7]);
    reordenarInterno_(ss);
    return leerColaInterno_(ss);
  });
}

function eliminarPostCola(token, idPost) {
  var ss = ctx_(token).ss;
  return conLock_(function () {
    var ws = hoja_(ss, 'Cola_Publicacion');
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(idPost)) { ws.deleteRow(i + 1); break; }
    }
    reordenarInterno_(ss);
    return leerColaInterno_(ss);
  });
}

function obtenerCiclicoOK_(ss) {
  var ws = ss.getSheetByName('Configuracion');
  if (!ws) return '1';
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === 'CiclicoOK') return String(data[i][1]);
  }
  return '1';
}

// Recalcula Orden_Ejecucion de las filas Pendiente (una sola escritura).
//   Cíclico  -> orden = fecha de creación (secuencial)
//   Aleatorio -> número al azar
function reordenarInterno_(ss) {
  var ws = ss.getSheetByName('Cola_Publicacion');
  if (!ws || ws.getLastRow() < 2) return;

  var ciclico = obtenerCiclicoOK_(ss);
  var data = ws.getRange(2, 1, ws.getLastRow() - 1, 8).getValues();
  var ordenes = data.map(function (fila) {
    if (String(fila[4]).trim() !== 'Pendiente') return [fila[7]];
    if (ciclico === '0') return [Math.floor(Math.random() * 999999)];
    var t = new Date(fila[5]).getTime();
    return [isNaN(t) ? Date.now() : t];
  });
  ws.getRange(2, 8, ordenes.length, 1).setValues(ordenes);
}

function leerColaInterno_(ss) {
  var ws = ss.getSheetByName('Cola_Publicacion');
  var cola = [];
  if (ws) {
    var data = ws.getDataRange().getValues();
    var tz = ss.getSpreadsheetTimeZone();
    var tieneFecha = data.length > 0 && String(data[0][COLA_COL_FECHA_PUB - 1] || '').trim() === 'Fecha_Publicacion';
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] !== '') {
        var fp = tieneFecha ? data[i][COLA_COL_FECHA_PUB - 1] : '';
        if (fp instanceof Date) fp = Utilities.formatDate(fp, tz, 'dd/MM/yyyy HH:mm');
        cola.push({
          id: String(data[i][0]),
          sku: String(data[i][1]),
          urls: String(data[i][3]),
          estado: String(data[i][4]),
          pieFoto: String(data[i][6] || ''),
          fechaPublicacion: String(fp || '')
        });
      }
    }
  }
  return cola.reverse();
}

// ============================================================================
// EDICIÓN DE PUBLICACIONES Y FECHA DE PUBLICACIÓN
// Cola_Publicacion suma la columna I "Fecha_Publicacion": la completa Make al
// publicar (ver documentación). Acá solo se lee y se crea el encabezado si falta.
// ============================================================================
var COLA_COL_FECHA_PUB = 9; // columna I

function asegurarColumnaFechaPublicacion_(ss) {
  var ws = ss.getSheetByName('Cola_Publicacion');
  if (!ws) return;
  if (ws.getMaxColumns() < COLA_COL_FECHA_PUB) ws.insertColumnsAfter(ws.getMaxColumns(), COLA_COL_FECHA_PUB - ws.getMaxColumns());
  var enc = ws.getRange(1, COLA_COL_FECHA_PUB);
  if (String(enc.getValue()).trim() === '') enc.setValue('Fecha_Publicacion');
}

// Modifica una publicación de la cola: medios (quitar / reordenar), pie de foto y estado.
// payload = { id, urls: [..en el nuevo orden..], pieFoto, estado }
function actualizarPostCola(token, payload) {
  var ss = ctx_(token).ss;
  payload = payload || {};
  var urls = (payload.urls || []).map(String).filter(function (u) { return u; });
  if (urls.length === 0) throw new Error('La publicación necesita al menos un archivo.');
  if (urls.length > 10) throw new Error('Instagram permite máximo 10 archivos por carrusel.');
  for (var u = 0; u < urls.length; u++) {
    if (!urlValida_(urls[u])) throw new Error('Uno de los archivos tiene una dirección inválida.');
  }
  var pie = String(payload.pieFoto || '');
  if (pie.length > 2200) throw new Error('El pie de foto supera los 2200 caracteres que admite Instagram.');
  var estadoNuevo = ['Pendiente', 'Enviado'].indexOf(payload.estado) !== -1 ? payload.estado : null;

  return conLock_(function () {
    var ws = hoja_(ss, 'Cola_Publicacion');
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(payload.id)) continue;

      var fila = i + 1;
      var estadoFinal = estadoNuevo || String(data[i][4]);
      var formato = urls.length > 1 ? 'Carrusel' : 'Feed';
      // C Formato | D URLs | E Estado  (como texto, para que nada se interprete como fórmula)
      ws.getRange(fila, 3, 1, 3).setNumberFormat('@').setValues([[formato, urls.join(' * '), estadoFinal]]);
      ws.getRange(fila, 7).setNumberFormat('@').setValue(pie);

      // Si vuelve a Pendiente, todavía no se publicó: se limpia la fecha
      var tieneFecha = String(data[0][COLA_COL_FECHA_PUB - 1] || '').trim() === 'Fecha_Publicacion';
      if (tieneFecha && estadoFinal === 'Pendiente') ws.getRange(fila, COLA_COL_FECHA_PUB).clearContent();

      reordenarInterno_(ss);
      return leerColaInterno_(ss);
    }
    throw new Error('Publicación no encontrada.');
  });
}

// ============================================================================
// PERFIL DEL USUARIO (pestaña Configuración > Información personal)
// ============================================================================
function obtenerPerfil(token) {
  var u = requireSesion_(token);
  var data = hojaUsuarios_().getDataRange().getValues();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL.ID]) !== u.idUsuario) continue;
    var reg = data[i][COL.F_REG];
    return {
      email: String(data[i][COL.EMAIL]),
      nombreNegocio: String(data[i][COL.NEGOCIO]),
      telefono: String(data[i][COL.TEL]),
      plan: String(data[i][COL.PLAN] || '').replace(/_/g, ' '),
      estado: String(data[i][COL.ESTADO]),
      fechaRegistro: (reg instanceof Date) ? Utilities.formatDate(reg, tz, 'dd/MM/yyyy') : String(reg || '')
    };
  }
  throw new Error('Usuario no encontrado.');
}

function guardarPerfil(token, nombreNegocio, telefono) {
  var u = requireSesion_(token);
  nombreNegocio = String(nombreNegocio || '').trim();
  telefono = String(telefono || '').trim();
  if (!nombreNegocio || !telefono) throw new Error('Completá el nombre del negocio y el teléfono.');
  if (nombreNegocio.length > 100 || telefono.length > 30) throw new Error('Alguno de los datos es demasiado largo.');

  return conLock_(function () {
    var ws = hojaUsuarios_();
    var data = ws.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL.ID]) !== u.idUsuario) continue;
      ws.getRange(i + 1, COL.NEGOCIO + 1).setNumberFormat('@').setValue(nombreNegocio);
      ws.getRange(i + 1, COL.TEL + 1).setNumberFormat('@').setValue(telefono);
      return { nombreNegocio: nombreNegocio, telefono: telefono };
    }
    throw new Error('Usuario no encontrado.');
  });
}

// ============================================================================
// DIAGNÓSTICO (ejecutar a mano desde el editor: menú Ejecutar)
// Revisa el Sheet Maestro y que cada usuario Activo tenga un workspace
// accesible. Resultado en Ver > Registros de ejecución.
// ============================================================================
function verificarConfiguracion() {
  soloDueno_(); // bloquea llamadas desde la web app
  var log = [];
  var porSheet = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  log.push('Sheet Maestro: ' + ss.getName());

  var ws = ss.getSheetByName(HOJA_USUARIOS);
  if (!ws) { log.push('❌ Falta la pestaña Usuarios'); }
  else {
    var data = ws.getDataRange().getValues();
    log.push('Usuarios registrados: ' + Math.max(0, data.length - 1));
    for (var i = 1; i < data.length; i++) {
      var estado = String(data[i][COL.ESTADO]);
      var linea = ' - ' + data[i][COL.EMAIL] + ' [' + estado + ']';
      if (estado === 'Activo') {
        var id = String(data[i][COL.SHEET] || '').trim();
        if (!id) linea += ' ❌ sin ID_Sheet_Cliente';
        else {
          (porSheet[id] = porSheet[id] || []).push(String(data[i][COL.EMAIL]));
          try {
            var s = SpreadsheetApp.openById(id);
            var faltan = ['Productos', 'Categorias_Config', 'Galeria_Medios', 'Cola_Publicacion', 'Configuracion']
              .filter(function (n) { return !s.getSheetByName(n); });
            linea += faltan.length ? ' ❌ faltan pestañas: ' + faltan.join(', ') : ' ✅ workspace OK';
          } catch (e) { linea += ' ❌ no se puede abrir el sheet (ID incorrecto o sin permisos)'; }
        }
      }
      log.push(linea);
    }
  }

  Object.keys(porSheet).forEach(function (id) {
    if (porSheet[id].length > 1) log.push('❌ El mismo Sheet está asignado a varios usuarios (' + porSheet[id].join(', ') + '): comparten datos.');
  });

  var cfg = obtenerConfiguracionGlobal();
  log.push('WhatsApp normalizado: ' + (cfg.WHATSAPP_NUMERO || '❌ vacío') +
    (cfg.WHATSAPP_NUMERO ? '  -> https://wa.me/' + cfg.WHATSAPP_NUMERO : ''));
  Logger.log(log.join('\n'));
  return log.join('\n');
}

// Aprueba un cliente de forma segura: verifica que el Sheet exista, tenga las pestañas
// y no esté asignado a otro usuario. Ejecutar desde el editor con una función auxiliar, p. ej.:
//   function aprobarEjemplo() { aprobarCliente('cliente@mail.com', 'ID_DEL_SHEET', 'Abonado'); }
function aprobarCliente(email, idSheet, plan) {
  soloDueno_();
  email = String(email || '').trim().toLowerCase();
  idSheet = String(idSheet || '').trim();
  plan = String(plan || '').trim();
  if (['Instalacion_Unica', 'Abonado'].indexOf(plan) === -1) throw new Error('Plan inválido: usá Instalacion_Unica o Abonado.');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(idSheet)) throw new Error('El ID del Sheet no parece válido.');

  var s = SpreadsheetApp.openById(idSheet); // falla si la cuenta del script no tiene acceso
  var faltan = ['Productos', 'Categorias_Config', 'Galeria_Medios', 'Cola_Publicacion', 'Configuracion']
    .filter(function (n) { return !s.getSheetByName(n); });
  if (faltan.length) throw new Error('Al Sheet le faltan pestañas: ' + faltan.join(', '));

  return conLock_(function () {
    var ws = hojaUsuarios_();
    var data = ws.getDataRange().getValues();
    var fila = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL.EMAIL]).trim().toLowerCase() === email) { fila = i + 1; continue; }
      if (String(data[i][COL.SHEET]).trim() === idSheet) {
        throw new Error('Ese Sheet ya está asignado a ' + data[i][COL.EMAIL] + '. Cada cliente necesita el suyo.');
      }
    }
    if (fila === -1) throw new Error('No hay ningún usuario registrado con ese email.');
    ws.getRange(fila, COL.SHEET + 1).setNumberFormat('@').setValue(idSheet);
    ws.getRange(fila, COL.PLAN + 1).setNumberFormat('@').setValue(plan);
    ws.getRange(fila, COL.F_APR + 1).setValue(new Date());
    ws.getRange(fila, COL.ESTADO + 1).setNumberFormat('@').setValue('Activo');
    auditar_('cliente_aprobado', email);
    return 'OK: ' + email + ' quedó Activo con el plan ' + plan + '.';
  });
}

// Mide cuánto tarda un hash v2 en tu cuenta (para decidir si se pueden subir las iteraciones sin saturar la cuota).
function medirCostoHash() {
  soloDueno_();
  var t0 = Date.now();
  hashPasswordV2_('prueba-de-costo', 'sal-de-prueba');
  var ms = Date.now() - t0;
  Logger.log('Un hash v2 (' + HASH_ITERACIONES + ' iteraciones) tarda ' + ms + ' ms.');
  return ms;
}

// ============================================================================
// Revisa si la cola está vacía de pendientes, lee la bandera y reinicia si es 1
// ============================================================================
function revisarYReiniciarColaInterno_(ss) {
  return conLock_(function () {
    var wsCola = ss.getSheetByName('Cola_Publicacion');
    if (!wsCola) return { estado: 'ERROR', mensaje: 'Falta la pestaña Cola_Publicacion' };
    var dataCola = wsCola.getDataRange().getValues();
    
    // 1. Verificar si hay registros 'Pendiente'
    for (var i = 1; i < dataCola.length; i++) {
      if (String(dataCola[i][4]) === 'Pendiente') {
        return { estado: 'PENDIENTES_ACTIVOS', mensaje: 'Todavía quedan registros pendientes.' };
      }
    }
    
    // 2. Si no hay pendientes, leer la configuración iterativa correcta
    var wsConfig = ss.getSheetByName('Configuracion');
    var valorBandera = '0';
    if (wsConfig) {
      var dataConfig = wsConfig.getDataRange().getValues();
      for (var c = 1; c < dataConfig.length; c++) {
        if (String(dataConfig[c][0]) === 'RecicladoAutomatico') {
          valorBandera = String(dataConfig[c][1]);
          break;
        }
      }
    }
    
    // 3. Reiniciar la cola
    if (valorBandera === '1') {
      if (dataCola.length > 1) {
        var numFilas = dataCola.length - 1;
        // Columna E (5): Pasar a Pendiente
        wsCola.getRange(2, 5, numFilas, 1).setNumberFormat('@').setValue('Pendiente');
        // Columna G (7): Vaciar Pie de Foto para que Gemini genere textos nuevos
        wsCola.getRange(2, 7, numFilas, 1).clearContent();
        // Columna I (9): Vaciar Fecha_Publicacion
        wsCola.getRange(2, 9, numFilas, 1).clearContent();
        
        // Ejecutar reordenamiento según configuración (Cíclico o Aleatorio)
        reordenarInterno_(ss);
      }
      return { estado: 'REINICIADO', mensaje: 'Cola reiniciada. Textos y fechas limpiados.' };
    }
    
    return { estado: 'IGNORADO', mensaje: 'Cola vacía pero el reciclado iterativo está apagado (0).' };
  });
}
