/**
 * Genera el archivo resultado.xlsx con el reporte solicitado y lo descarga.
 *
 * Este módulo corre en el service worker (MV3), donde NO existe
 * URL.createObjectURL, por lo que la descarga usa una data URL en base64.
 * El XLSX se construye a mano (XML + ZIP sin compresión) para no depender
 * de librerías externas.
 */

import { zipStore } from './zip.js';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Escapa texto para incrustarlo en XML.
 * @param {string} value - Texto crudo.
 * @returns {string}
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convierte un valor de celda a XML de SpreadsheetML.
 * Los valores enteros se escriben como número para que Excel pueda sumarlos.
 * @param {string | number} value - Valor de la celda.
 * @returns {string}
 */
function cellXml(value) {
  const texto = String(value ?? '').trim();
  if (texto === '') {
    return '<c t="inlineStr"><is><t/></is></c>';
  }
  if (/^\d+$/.test(texto) && texto.length < 15) {
    return `<c t="n"><v>${texto}</v></c>`;
  }
  return `<c t="inlineStr"><is><t xml:space="preserve">${escapeXml(texto)}</t></is></c>`;
}

/**
 * Construye los bytes del XLSX a partir de filas de datos.
 * @param {Array<Array<string | number>>} rows - Filas (la primera es el encabezado).
 * @returns {Uint8Array}
 */
function buildXlsx(rows) {
  const filasXml = rows
    .map((fila) => `<row>${fila.map(cellXml).join('')}</row>`)
    .join('');

  const declaracion = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const contentTypes = `${declaracion}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rels = `${declaracion}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `${declaracion}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resultado" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `${declaracion}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const sheet = `${declaracion}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`;

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

/**
 * Convierte bytes a una data URL base64 (compatible con service workers).
 * @param {Uint8Array} bytes - Contenido binario.
 * @param {string} mime - Tipo MIME.
 * @returns {string}
 */
function bytesToDataUrl(bytes, mime) {
  let binario = '';
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloque));
  }
  return `data:${mime};base64,${btoa(binario)}`;
}

/**
 * Genera un archivo resultado.xlsx con el formato solicitado y lo descarga.
 * @param {Array<object>} results - Arreglo de resultados ya normalizados.
 * @param {string} [outputFileName='resultado.xlsx'] - Nombre del archivo de salida.
 * @returns {Promise<void>}
 */
async function writeWorkbook(results, outputFileName = 'resultado.xlsx') {
  const filas = [
    ['CUFE', 'FACTURA', 'VALOR FACTURA', 'NUMERO NOTA CREDITO', 'VALOR NOTA CREDITO', 'ESTADO', 'ERROR'],
    ...results.map((item) => [
      item.cufe || '',
      item.numeroFactura || '',
      item.valorFactura || '',
      item.numeroNotaCredito || '',
      item.valorNotaCredito || '',
      item.estado || '',
      item.error || '',
    ]),
  ];

  const bytes = buildXlsx(filas);
  const dataUrl = bytesToDataUrl(bytes, MIME_XLSX);

  await chrome.downloads.download({
    url: dataUrl,
    filename: outputFileName,
    saveAs: true,
  });
}

export {
  writeWorkbook,
};
