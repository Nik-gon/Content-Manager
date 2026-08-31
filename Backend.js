// 1. CONFIGURACIÓN INICIAL
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Content Manager - MVP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 2. LECTURA DE DATOS (READ)
function getInitialData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var wsProductos = ss.getSheetByName('Productos');
  var datosProductos = wsProductos.getDataRange().getValues();
  var productos = [];
  for (var i = 1; i < datosProductos.length; i++) {
    if (datosProductos[i][0]) productos.push({ sku: String(datosProductos[i][0]), nombre: String(datosProductos[i][1]), stock: datosProductos[i][2] });
  }

  var wsCategorias = ss.getSheetByName('Categorias_Config');
  var datosCategorias = wsCategorias.getDataRange().getValues();
  var categorias = [];
  for (var j = 1; j < datosCategorias.length; j++) {
    if (datosCategorias[j][0]) categorias.push({ id: String(datosCategorias[j][0]), nombre: String(datosCategorias[j][1]), orden: Number(datosCategorias[j][2]) || 99 });
  }
  categorias.sort(function(a, b) { return a.orden - b.orden; });

  var wsMedios = ss.getSheetByName('Galeria_Medios');
  var datosMedios = wsMedios.getDataRange().getValues();
  var medios = [];
  for (var k = 1; k < datosMedios.length; k++) {
    if (datosMedios[k][0]) medios.push({ id: String(datosMedios[k][0]), sku: String(datosMedios[k][1]), categoria: String(datosMedios[k][2]), url: String(datosMedios[k][3]) });
  }

  return { productos: productos, categorias: categorias, medios: medios };
}

// 3. ABM DE PRODUCTOS (CREATE, UPDATE, DELETE)
function crearProducto(sku, nombre, stock) {
  var wsProductos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  wsProductos.appendRow([sku, nombre, stock, 'Activo']);
  return { sku: sku, nombre: nombre, stock: stock };
}

function actualizarProducto(sku, nombre, stock) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  var data = ws.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) {
      ws.getRange(i + 1, 2).setValue(nombre); // Actualiza Nombre
      ws.getRange(i + 1, 3).setValue(stock);  // Actualiza Stock
      return { sku: sku, nombre: nombre, stock: stock };
    }
  }
  throw new Error("Producto no encontrado");
}

function eliminarProducto(sku) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Productos');
  var data = ws.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(sku)) {
      ws.deleteRow(i + 1);
      return sku; // Devolvemos el SKU para que el Front-End sepa cuál borrar de la memoria
    }
  }
  throw new Error("Producto no encontrado");
}

// 4. GESTIÓN DE MEDIOS
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
    if (String(data[i][0]) === String(idMedio)) {
      ws.deleteRow(i + 1);
      return idMedio;
    }
  }
  throw new Error("Medio no encontrado");
}

// 5. INTEGRACIÓN CON MAKE
function enviarAColaPublicacion(payload) {
  var wsCola = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cola_Publicacion');
  var idPost = 'POST-' + Math.floor(Math.random() * 1000000);
  var formato = payload.urls.length > 1 ? 'Carrusel' : 'Foto';
  
  wsCola.appendRow([idPost, payload.sku, formato, payload.urls.join(' * '), 'Pendiente', new Date()]);
  return "¡Post encolado exitosamente para Make!";
}