/**
 * Lee un archivo XLSX y devuelve la lista de pares CUFE/NIT a consultar.
 *
 * Este módulo corre en el POPUP (no en el service worker) porque ahí el
 * archivo se selecciona y se puede parsear sin restricciones.
 *
 * A diferencia de un escaneo por patrón, aquí se leen filas y columnas
 * reales: se ubica en la primera fila la columna cuyo encabezado es "CUFE"
 * y la columna cuyo encabezado es "NIT" (sin importar su posición ni el
 * orden de las columnas) y se emparejan por fila, tal como lo describe el
 * README.
 */

import { unzip } from './zip.js';

const PATRON_CUFE = /^[0-9a-fA-F]{96}$/;

/**
 * Decodifica entidades XML básicas.
 * @param {string} texto - Texto crudo con entidades.
 * @returns {string}
 */
function decodeXmlEntities(texto) {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extrae las cadenas compartidas del XLSX (xl/sharedStrings.xml).
 * @param {Map<string, Uint8Array>} entradas - Contenido del ZIP descomprimido.
 * @returns {string[]}
 */
function leerSharedStrings(entradas) {
  const datos = entradas.get('xl/sharedStrings.xml');
  if (!datos) {
    return [];
  }

  const xml = new TextDecoder().decode(datos);
  const strings = [];
  const regexSi = /<si>([\s\S]*?)<\/si>/g;
  let coincidencia;

  while ((coincidencia = regexSi.exec(xml))) {
    const textos = Array.from(coincidencia[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1]);
    strings.push(decodeXmlEntities(textos.join('')));
  }

  return strings;
}

/**
 * Convierte una referencia de celda ("B12") en su letra de columna ("B").
 * @param {string} ref - Referencia de celda.
 * @returns {string}
 */
function columnaDeReferencia(ref) {
  return (ref.match(/^[A-Z]+/) || [''])[0];
}

/**
 * Parsea una hoja de cálculo y devuelve sus filas como Map columna→valor.
 * @param {string} xml - XML de la hoja.
 * @param {string[]} sharedStrings - Cadenas compartidas del workbook.
 * @returns {Array<Map<string, string>>}
 */
function parsearFilas(xml, sharedStrings) {
  const filas = [];
  const regexRow = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let filaMatch;

  while ((filaMatch = regexRow.exec(xml))) {
    const celdas = new Map();
    const regexCell = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let celdaMatch;

    while ((celdaMatch = regexCell.exec(filaMatch[1]))) {
      const atributos = celdaMatch[1];
      const contenido = celdaMatch[2];
      const ref = (atributos.match(/r="([^"]+)"/) || [])[1] || '';
      const tipo = (atributos.match(/t="([^"]+)"/) || [])[1] || '';
      const columna = columnaDeReferencia(ref);
      if (!columna) {
        continue;
      }

      let valor = '';
      if (tipo === 's') {
        const indice = Number((contenido.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        valor = sharedStrings[indice] || '';
      } else if (tipo === 'inlineStr') {
        const textos = Array.from(contenido.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1]);
        valor = decodeXmlEntities(textos.join(''));
      } else {
        valor = decodeXmlEntities((contenido.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      }

      celdas.set(columna, valor.trim());
    }

    if (celdas.size > 0) {
      filas.push(celdas);
    }
  }

  return filas;
}

/**
 * Ubica, en la primera fila de una hoja, las columnas cuyo encabezado sea
 * "CUFE" y "NIT" (sin distinguir mayúsculas ni espacios extra).
 * @param {Map<string, string>} encabezados - Primera fila de la hoja.
 * @returns {{ colCufe?: string, colNit?: string }}
 */
function ubicarColumnas(encabezados) {
  const resultado = {};
  for (const [columna, texto] of encabezados) {
    const normalizado = texto.trim().toUpperCase();
    if (normalizado === 'CUFE') {
      resultado.colCufe = columna;
    } else if (normalizado === 'NIT') {
      resultado.colNit = columna;
    }
  }
  return resultado;
}

/**
 * Extrae los pares CUFE/NIT únicos presentes en el archivo Excel.
 * @param {ArrayBuffer} arrayBuffer - Contenido binario del archivo Excel.
 * @returns {Promise<Array<{ cufe: string, nit: string }>>}
 */
async function readCuFesFromWorkbook(arrayBuffer) {
  const entradas = await unzip(arrayBuffer);
  const sharedStrings = leerSharedStrings(entradas);

  const hojas = Array.from(entradas.keys())
    .filter((nombre) => /^xl\/worksheets\/[^/]+\.xml$/i.test(nombre))
    .sort();

  const vistos = new Set();
  const registros = [];
  let filasSinNit = 0;

  for (const nombreHoja of hojas) {
    const xml = new TextDecoder().decode(entradas.get(nombreHoja));
    const filas = parsearFilas(xml, sharedStrings);
    if (filas.length === 0) {
      continue;
    }

    const { colCufe, colNit } = ubicarColumnas(filas[0]);
    if (!colCufe || !colNit) {
      continue;
    }

    for (let i = 1; i < filas.length; i += 1) {
      const cufeCrudo = filas[i].get(colCufe) || '';
      const nitCrudo = (filas[i].get(colNit) || '').replace(/[^0-9]/g, '');

      if (!cufeCrudo || !PATRON_CUFE.test(cufeCrudo)) {
        continue;
      }

      const cufe = cufeCrudo.toLowerCase();

      if (!nitCrudo) {
        filasSinNit += 1;
        continue;
      }

      if (vistos.has(cufe)) {
        continue;
      }
      vistos.add(cufe);
      registros.push({ cufe, nit: nitCrudo });
    }
  }

  if (registros.length === 0) {
    if (filasSinNit > 0) {
      throw new Error(`Se encontraron ${filasSinNit} fila(s) con CUFE pero sin NIT en la columna "NIT". Verifica que cada fila tenga su NIT correspondiente.`);
    }
    throw new Error('No se encontró ninguna hoja con columnas "CUFE" y "NIT" en el encabezado, o no hay filas válidas debajo de ellas.');
  }

  return registros;
}

export {
  readCuFesFromWorkbook,
};
