// 1. CONFIGURACIÓN INICIAL
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Auto Manager - MVP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 2. LECTURA DE DATOS (READ)
function getInitialData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Productos 
  var wsProductos = ss.getSheetByName('Productos');
  var datosProductos = wsProductos.getDataRange().getValues();
  var productos = [];
  for (var i = 1; i < datosProductos.length; i++) {
    if (datosProductos[i][0]) productos.push({ 
      sku: String(datosProductos[i][0]), 
      nombre: String(datosProductos[i][1]), 
      stock: datosProductos[i][2],
      estado: String(datosProductos[i][3] || 'Activo')
    });
  }

  // Categorías
  var wsCategorias = ss.getSheetByName('Categorias_Config');
  var datosCategorias = wsCategorias.getDataRange().getValues();
  var categorias = [];
  for (var j = 1; j < datosCategorias.length; j++) {
    if (datosCategorias[j][0]) categorias.push({ id: String(datosCategorias[j][0]), nombre: String(datosCategorias[j][1]), orden: Number(datosCategorias[j][2]) || 99 });
  }
  categorias.sort(function(a, b) { return a.orden - b.orden; });

  // Medios
  var wsMedios = ss.getSheetByName('Galeria_Medios');
  var datosMedios = wsMedios.getDataRange().getValues();
  var medios = [];
  for (var k = 1; k < datosMedios.length; k++) {
    if (datosMedios[k][0]) medios.push({ id: String(datosMedios[k][0]), sku: String(datosMedios[k][1]), categoria: String(datosMedios[k][2]), url: String(datosMedios[k][3]) });
  }

  // Configuración (Ahora leemos CiclicoOK, por defecto '1')
  var wsConfig = ss.getSheetByName('Configuracion');
  var config = { CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_UPLOAD_PRESET: '', CiclicoOK: '1' };
  if (wsConfig) {
    var datosConfig = wsConfig.getDataRange().getValues();
    for (var c = 1; c < datosConfig.length; c++) {
      if (datosConfig[c][0]) config[datosConfig[c][0]] = String(datosConfig[c][1]);
    }
  }

  // La cola se lee a través de la función auxiliar para mantener el orden
  var cola = _leerColaInterno(ss);

  return { productos: productos, categorias: categorias, medios: medios, cola: cola, config: config };
}

// 3. CONFIGURACIÓN (UPDATE)
function guardarConfiguracion(cloudName, uploadPreset) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Configuracion');
  var data = ws.getDataRange().getValues();
  var foundCloud = false, foundPreset = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'CLOUDINARY_CLOUD_NAME') { ws.getRange(i + 1, 2).setValue(cloudName); foundCloud = true; }
    if (data[i][0] === 'CLOUDINARY_UPLOAD_PRESET') { ws.getRange(i + 1, 2).setValue(uploadPreset); foundPreset = true; }
  }
  if (!foundCloud) ws.appendRow(['CLOUDINARY_CLOUD_NAME', cloudName]);
  if (!foundPreset) ws.appendRow(['CLOUDINARY_UPLOAD_PRESET', uploadPreset]);
  return { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_UPLOAD_PRESET: uploadPreset };
}

// NUEVA FUNCIÓN: Guarda la distribución de Make (CiclicoOK)
function guardarModoDistribucion(modo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsConfig = ss.getSheetByName('Configuracion');
  var data = wsConfig.getDataRange().getValues();
  var val = modo === 'aleatorio' ? '0' : '1';
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'CiclicoOK') {
       wsConfig.getRange(i + 1, 2).setValue(val); found = true; break;
    }
  }
  if(!found) wsConfig.appendRow(['CiclicoOK', val]);
  
  _reordenarInterno(ss);
  return _leerColaInterno(ss);
}

// 4. ABM DE PRODUCTOS
function crearProductoConImagenes(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsProductos = ss.getSheetByName('Productos');
  var dataProd = wsProductos.getDataRange().getValues();
  for (var i = 1; i < dataProd.length; i++) {
    if (String(dataProd[i][0]).toUpperCase() === String(payload.sku).toUpperCase()) throw new Error("El SKU ya existe en la base de datos.");
  }
  wsProductos.appendRow([payload.sku.toUpperCase(), payload.nombre, payload.stock, payload.estado]);
  
  var mediosGuardados = [];
  if (payload.imagenes && payload.imagenes.length > 0) {
    var wsMedios = ss.getSheetByName('Galeria_Medios');
    payload.imagenes.forEach(function(img) {
      var idMedio = 'MED-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      wsMedios.appendRow([idMedio, payload.sku.toUpperCase(), img.categoria, img.url]); 
      mediosGuardados.push({ id: idMedio, sku: payload.sku.toUpperCase(), categoria: img.categoria, url: img.url });
    });
  }
  return { producto: { sku: payload.sku.toUpperCase(), nombre: payload.nombre, stock: payload.stock, estado: payload.estado }, mediosNuevos: mediosGuardados };
}

function actualizarProducto(sku, nombre, stock, estado) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) {
      ws.getRange(i + 1, 2).setValue(nombre); 
      ws.getRange(i + 1, 3).setValue(stock);
      ws.getRange(i + 1, 4).setValue(estado);
      return { sku: sku, nombre: nombre, stock: stock, estado: estado };
    }
  }
  throw new Error("Producto no encontrado");
}

function eliminarProducto(sku) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsProductos = ss.getSheetByName('Productos');
  var data = wsProductos.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) { wsProductos.deleteRow(i + 1); break; }
  }

  // CASCADA: Eliminar Medios asociados (de atrás hacia adelante)
  var wsMedios = ss.getSheetByName('Galeria_Medios');
  var dataMedios = wsMedios.getDataRange().getValues();
  for (var j = dataMedios.length - 1; j > 0; j--) {
    if (String(dataMedios[j][1]) === String(sku)) { wsMedios.deleteRow(j + 1); }
  }

  // CASCADA: Eliminar Publicaciones en cola (de atrás hacia adelante)
  var wsCola = ss.getSheetByName('Cola_Publicacion');
  if(wsCola) {
    var dataCola = wsCola.getDataRange().getValues();
    for (var k = dataCola.length - 1; k > 0; k--) {
      if (String(dataCola[k][1]) === String(sku)) { wsCola.deleteRow(k + 1); }
    }
    _reordenarInterno(ss); // Reordenamos lo que haya quedado
  }

  return sku;
}

// 5. GESTIÓN DE MEDIOS INDIVIDUAL
function guardarNuevoMedio(url, sku, categoria) {
  var wsMedios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Galeria_Medios');
  var idMedio = 'MED-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  wsMedios.appendRow([idMedio, sku, categoria, url]);
  return { id: idMedio, sku: sku, categoria: categoria, url: url };
}

function eliminarMedio(idMedio) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Galeria_Medios');
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(idMedio)) { ws.deleteRow(i + 1); return idMedio; }
  }
  throw new Error("Medio no encontrado");
}

// 6. GESTIÓN DE COLA (AUTOMATIZADA)
function enviarAColaPublicacion(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCola = ss.getSheetByName('Cola_Publicacion');
  var idPost = 'POST-' + Math.floor(Math.random() * 1000000);
  var formato = payload.urls.length > 1 ? 'Carrusel' : 'Feed';
  var urlsCombinadas = payload.urls.join(' * ');
  var fecha = new Date();
  
  wsCola.appendRow([idPost, payload.sku, formato, urlsCombinadas, 'Pendiente', fecha, payload.pieFoto, 0]); // El 0 es un placeholder, se sobrescribe al reordenar
  
  _reordenarInterno(ss);
  return _leerColaInterno(ss);
}

function eliminarPostCola(idPost) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wsCola = ss.getSheetByName('Cola_Publicacion');
  var data = wsCola.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(idPost)) {
      wsCola.deleteRow(i + 1); break;
    }
  }
  _reordenarInterno(ss);
  return _leerColaInterno(ss);
}

// ---- FUNCIONES PRIVADAS PARA REORDENAMIENTO GLOBAL ----

function _obtenerCiclicoOK(ss) {
  var wsConfig = ss.getSheetByName('Configuracion');
  var data = wsConfig.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'CiclicoOK') return String(data[i][1]);
  }
  return '1'; // Por defecto es cíclico
}

function _reordenarInterno(ss) {
   var ciclico = _obtenerCiclicoOK(ss);
   var wsCola = ss.getSheetByName('Cola_Publicacion');
   if(!wsCola) return;
   
   var data = wsCola.getDataRange().getValues();
   for (var i = 1; i < data.length; i++) {
     if (data[i][4] === 'Pendiente') { // Solo procesar los que no tomó Make
        var nuevoOrden = ciclico === '0' 
                         ? Math.floor(Math.random() * 999999) 
                         : new Date(data[i][5]).getTime(); // Ordena por timestamp
        wsCola.getRange(i + 1, 8).setValue(nuevoOrden);
     }
   }
}

function _leerColaInterno(ss) {
  var wsCola = ss.getSheetByName('Cola_Publicacion');
  var cola = [];
  if (wsCola) {
    var datosCola = wsCola.getDataRange().getValues();
    for (var m = 1; m < datosCola.length; m++) {
      if (datosCola[m][0]) {
        cola.push({ 
          id: String(datosCola[m][0]), 
          sku: String(datosCola[m][1]), 
          urls: String(datosCola[m][3]), 
          estado: String(datosCola[m][4]),
          pieFoto: String(datosCola[m][6] || '')
        });
      }
    }
  }
  return cola.reverse();
}