/**
 * Utilidades ZIP mínimas para leer y escribir archivos .xlsx sin librerías
 * externas (un .xlsx es un ZIP con XML adentro).
 *
 * - Lectura: usa DecompressionStream('deflate-raw'), disponible en Chrome 103+.
 * - Escritura: entradas sin compresión (método "stored") con CRC32 propio.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Calcula el CRC32 de un arreglo de bytes.
 * @param {Uint8Array} bytes - Datos de entrada.
 * @returns {number}
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Descomprime datos deflate-raw usando DecompressionStream.
 * @param {Uint8Array} bytes - Datos comprimidos.
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Lee un archivo ZIP y devuelve un Map nombre → contenido descomprimido.
 * @param {ArrayBuffer} arrayBuffer - Contenido binario del ZIP.
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minPos; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('El archivo no es un XLSX válido (estructura ZIP no encontrada).');
  }

  const totalEntradas = view.getUint16(eocd + 10, true);
  let puntero = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const resultado = new Map();

  for (let n = 0; n < totalEntradas; n += 1) {
    if (view.getUint32(puntero, true) !== 0x02014b50) {
      break;
    }

    const metodo = view.getUint16(puntero + 10, true);
    const tamanoComprimido = view.getUint32(puntero + 20, true);
    const nombreLen = view.getUint16(puntero + 28, true);
    const extraLen = view.getUint16(puntero + 30, true);
    const comentarioLen = view.getUint16(puntero + 32, true);
    const offsetLocal = view.getUint32(puntero + 42, true);
    const nombre = decoder.decode(bytes.subarray(puntero + 46, puntero + 46 + nombreLen));

    const localNombreLen = view.getUint16(offsetLocal + 26, true);
    const localExtraLen = view.getUint16(offsetLocal + 28, true);
    const inicioDatos = offsetLocal + 30 + localNombreLen + localExtraLen;
    const datos = bytes.subarray(inicioDatos, inicioDatos + tamanoComprimido);

    if (metodo === 8) {
      resultado.set(nombre, await inflateRaw(datos));
    } else if (metodo === 0) {
      resultado.set(nombre, new Uint8Array(datos));
    }

    puntero += 46 + nombreLen + extraLen + comentarioLen;
  }

  return resultado;
}

/**
 * Crea un ZIP sin compresión a partir de una lista de archivos.
 * @param {Array<{ name: string, data: string | Uint8Array }>} files - Archivos a incluir.
 * @returns {Uint8Array}
 */
function zipStore(files) {
  const encoder = new TextEncoder();
  const partesLocales = [];
  const partesCentrales = [];
  let offset = 0;

  for (const file of files) {
    const nombreBytes = encoder.encode(file.name);
    const datos = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
    const crc = crc32(datos);

    const local = new Uint8Array(30 + nombreBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, datos.length, true);
    lv.setUint32(22, datos.length, true);
    lv.setUint16(26, nombreBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nombreBytes, 30);
    partesLocales.push(local, datos);

    const central = new Uint8Array(46 + nombreBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, datos.length, true);
    cv.setUint32(24, datos.length, true);
    cv.setUint16(28, nombreBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nombreBytes, 46);
    partesCentrales.push(central);

    offset += local.length + datos.length;
  }

  const tamanoCentral = partesCentrales.reduce((suma, parte) => suma + parte.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, tamanoCentral, true);
  ev.setUint32(16, offset, true);

  const salida = new Uint8Array(offset + tamanoCentral + 22);
  let pos = 0;
  for (const parte of [...partesLocales, ...partesCentrales, eocd]) {
    salida.set(parte, pos);
    pos += parte.length;
  }

  return salida;
}

export {
  crc32,
  unzip,
  zipStore,
};
