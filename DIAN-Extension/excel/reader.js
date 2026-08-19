/**
 * Lee un archivo XLSX y devuelve una colección limpia de CUFEs.
 *
 * Este módulo corre en el POPUP (no en el service worker) porque ahí el
 * archivo se selecciona y se puede parsear sin restricciones.
 *
 * Estrategia: un CUFE/CUDE es SIEMPRE una cadena hexadecimal de exactamente
 * 96 caracteres, así que en lugar de exigir una columna llamada "CUFE" se
 * escanean las hojas y las cadenas compartidas del XLSX buscando ese patrón.
 * Esto acepta cualquier plantilla de Excel sin importar el nombre de columna.
 */

import { unzip } from './zip.js';

const PATRON_CUFE = /(?<![0-9a-fA-F])[0-9a-fA-F]{96}(?![0-9a-fA-F])/g;

/**
 * Extrae los CUFEs únicos presentes en el archivo Excel.
 * @param {ArrayBuffer} arrayBuffer - Contenido binario del archivo Excel.
 * @returns {Promise<Array<{ cufe: string }>>}
 */
async function readCuFesFromWorkbook(arrayBuffer) {
  const entradas = await unzip(arrayBuffer);
  const decoder = new TextDecoder();
  const vistos = new Set();
  const cufes = [];

  for (const [nombre, datos] of entradas) {
    const esHoja = /^xl\/worksheets\/[^/]+\.xml$/i.test(nombre);
    const esSharedStrings = /^xl\/sharedStrings\.xml$/i.test(nombre);
    if (!esHoja && !esSharedStrings) {
      continue;
    }

    const xml = decoder.decode(datos);
    for (const coincidencia of xml.match(PATRON_CUFE) || []) {
      const cufe = coincidencia.toLowerCase();
      if (!vistos.has(cufe)) {
        vistos.add(cufe);
        cufes.push({ cufe });
      }
    }
  }

  if (cufes.length === 0) {
    throw new Error('No se encontró ningún CUFE (cadena hexadecimal de 96 caracteres) en el Excel.');
  }

  return cufes;
}

export {
  readCuFesFromWorkbook,
};
