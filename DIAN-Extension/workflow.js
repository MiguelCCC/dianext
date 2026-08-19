/**
 * Orquestador principal del proceso de automatización DIAN.
 *
 * Punto clave: el buscador de la DIAN hace un POST con navegación COMPLETA
 * (no AJAX). Cada búsqueda destruye el content script y carga una página
 * nueva, así que el flujo se coordina desde aquí con chrome.tabs:
 *
 *   1. Asegurar que la pestaña esté en /User/SearchDocument con el token de
 *      Cloudflare Turnstile listo (si Cloudflare exige verificación humana,
 *      se avisa al usuario y se espera a que marque la casilla).
 *   2. Enviar 'buscarCUFE': el content script responde ANTES de hacer submit.
 *   3. Esperar a que la pestaña termine de cargar la página de detalle.
 *   4. Enviar 'extraer': la factura y sus notas crédito están todas en el DOM
 *      como paneles .tab-pane con id igual al CUFE (no hay que abrir pestañas).
 *   5. Volver al buscador navegando directo a la URL (más confiable que el
 *      enlace "Volver") y continuar con el siguiente CUFE.
 */

import ResultModel from './excel/models.js';

const SEARCH_URL = 'https://catalogo-vpfe.dian.gov.co/User/SearchDocument';
const MENSAJE_VERIFICACION =
  "⚠️ Cloudflare pide verificación humana: en la pestaña de la DIAN marca la casilla 'Verifique que es un ser humano'. El proceso continuará automáticamente.";

/**
 * Pausa asíncrona.
 * @param {number} ms - Milisegundos a esperar.
 * @returns {Promise<void>}
 */
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Notifica al background el progreso del lote para actualizar el popup.
 * @param {(payload: object) => void} onProgress - Callback del background.
 * @param {object} payload - Estado parcial.
 */
function notifyProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    onProgress(payload);
  }
}

/**
 * Envía una acción al content script con reintentos (el script se recarga en
 * cada navegación y puede no estar listo de inmediato).
 * @param {number} tabId - Pestaña donde está la página DIAN.
 * @param {string} action - Acción a ejecutar.
 * @param {object} [payload={}] - Datos de la acción.
 * @param {{ intentos?: number, espera?: number }} [opciones={}] - Reintentos.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function executeContentAction(tabId, action, payload = {}, opciones = {}) {
  const intentos = opciones.intentos ?? 10;
  const espera = opciones.espera ?? 600;
  let ultimoError = null;

  for (let i = 0; i < intentos; i += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_ACTION',
        action,
        payload,
      });
      if (response) {
        return response;
      }
      ultimoError = new Error('Respuesta vacía del content script.');
    } catch (error) {
      ultimoError = error;
    }
    await esperar(espera);
  }

  throw ultimoError || new Error(`Sin respuesta del content script para la acción ${action}.`);
}

/**
 * Espera a que la pestaña termine de cargar (status 'complete').
 * IMPORTANTE: llamar ANTES de disparar la navegación para no perder el evento.
 * @param {number} tabId - Pestaña observada.
 * @param {number} [timeoutMs=45000] - Tiempo máximo de espera.
 * @returns {Promise<void>}
 */
function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let resuelto = false;

    const finalizar = () => {
      if (!resuelto) {
        resuelto = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finalizar();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finalizar, timeoutMs);
  });
}

/**
 * Navega la pestaña directamente a la página de búsqueda y espera la carga.
 * @param {number} tabId - Pestaña de la DIAN.
 * @returns {Promise<void>}
 */
async function gotoSearchPage(tabId) {
  const navegacion = waitForTabComplete(tabId);
  await chrome.tabs.update(tabId, { url: SEARCH_URL });
  await navegacion;
  await esperar(500);
}

/**
 * Localiza una pestaña abierta de la DIAN o crea una nueva en el buscador.
 * @returns {Promise<number>}
 */
async function obtenerTabDian() {
  const tabs = await chrome.tabs.query({ url: 'https://catalogo-vpfe.dian.gov.co/*' });
  if (tabs.length > 0 && tabs[0].id) {
    return tabs[0].id;
  }

  const tab = await chrome.tabs.create({ url: SEARCH_URL });
  await waitForTabComplete(tab.id);
  return tab.id;
}

/**
 * Garantiza que la pestaña esté en el buscador con el token Turnstile emitido.
 * Si Cloudflare exige la casilla humana, avisa al usuario y sigue esperando.
 * @param {number} tabId - Pestaña de la DIAN.
 * @param {string} cufe - CUFE en curso (solo para el mensaje de progreso).
 * @param {(payload: object) => void} [onProgress] - Callback de progreso.
 * @returns {Promise<void>}
 */
async function asegurarBuscadorConToken(tabId, cufe, onProgress) {
  for (let intento = 0; intento < 3; intento += 1) {
    const estado = await executeContentAction(tabId, 'estado');
    if (!estado.success || !estado.data?.esBuscador) {
      await gotoSearchPage(tabId);
      continue;
    }

    const limite = Date.now() + 5 * 60 * 1000;
    let avisado = false;

    while (Date.now() < limite) {
      const token = await executeContentAction(tabId, 'esperarToken', { timeoutMs: 8000 });
      if (token.success && token.data?.tokenListo) {
        return;
      }

      if (!avisado) {
        notifyProgress(onProgress, { currentCufe: cufe, message: MENSAJE_VERIFICACION });
        avisado = true;
      }
    }

    throw new Error('Cloudflare no liberó el token de verificación después de 5 minutos.');
  }

  throw new Error('No se pudo preparar la página de búsqueda de la DIAN.');
}

/**
 * Construye un objeto ResultModel para un CUFE.
 * @param {string} cufe - CUFE consultado.
 * @param {string} nit - NIT del emisor o receptor asociado al CUFE.
 * @param {object} [data={}] - Datos extraídos.
 * @returns {ResultModel}
 */
function createResultModel(cufe, nit, data = {}) {
  return new ResultModel({
    cufe,
    nit,
    numeroFactura: data.numeroFactura || '',
    valorFactura: data.valorFactura || '',
    numeroNotaCredito: data.numeroNotaCredito || '',
    valorNotaCredito: data.valorNotaCredito || '',
    estado: data.estado || 'OK',
    error: data.error || '',
  });
}

/**
 * Ejecuta el flujo completo para una sola CUFE.
 * @param {number} tabId - Pestaña activa donde se ejecuta la automatización.
 * @param {{ cufe: string, nit: string }} pendiente - CUFE y NIT a consultar.
 * @param {(payload: object) => void} [onProgress] - Callback para el popup.
 * @returns {Promise<ResultModel>}
 */
async function processSingleCufe(tabId, pendiente, onProgress) {
  const { cufe, nit } = pendiente;

  try {
    notifyProgress(onProgress, {
      currentCufe: cufe,
      facturaEncontrada: '',
      notaEncontrada: '',
      message: 'Preparando la página de búsqueda...',
    });

    await asegurarBuscadorConToken(tabId, cufe, onProgress);

    notifyProgress(onProgress, { currentCufe: cufe, message: 'Buscando CUFE en la DIAN...' });

    const navegacion = waitForTabComplete(tabId);
    const busqueda = await executeContentAction(tabId, 'buscarCUFE', { cufe, nit }, { intentos: 2 });
    if (!busqueda.success) {
      throw new Error(busqueda.error || 'No se pudo enviar la búsqueda del CUFE.');
    }
    await navegacion;

    notifyProgress(onProgress, { currentCufe: cufe, message: 'Leyendo el detalle del documento...' });

    let datos = null;
    for (let i = 0; i < 12; i += 1) {
      const respuesta = await executeContentAction(tabId, 'extraer');
      const data = respuesta.data || {};

      if (Array.isArray(data.docs) && data.docs.length > 0) {
        datos = data;
        break;
      }

      if (data.sinResultado) {
        datos = data;
        break;
      }

      await esperar(700);
    }

    if (!datos || !Array.isArray(datos.docs) || datos.docs.length === 0) {
      if (datos?.sinResultado) {
        throw new Error('La DIAN no encontró documentos para este CUFE.');
      }
      throw new Error('No se pudo leer el detalle del documento en la DIAN.');
    }

    // Clasificación determinística: el panel cuyo id (CUFE) coincide con el
    // CUFE buscado es la factura; cualquier otro panel es una nota crédito.
    // No depende de detectar textos en paneles ocultos (frágil).
    const cufeBuscado = String(cufe).trim().toLowerCase();
    const factura = datos.docs.find((doc) => doc.cufe === cufeBuscado)
      || datos.docs.find((doc) => !doc.esNota)
      || {};
    const notas = datos.docs.filter((doc) => doc !== factura && doc.folio);

    const resultado = createResultModel(cufe, nit, {
      numeroFactura: factura.folio || '',
      valorFactura: factura.total || '',
      numeroNotaCredito: notas.map((nota) => nota.folio).filter(Boolean).join(' | '),
      valorNotaCredito: notas.map((nota) => nota.total).filter(Boolean).join(' | '),
      estado: 'OK',
      error: '',
    });

    notifyProgress(onProgress, {
      currentCufe: cufe,
      facturaEncontrada: `${resultado.numeroFactura} / ${resultado.valorFactura}`,
      notaEncontrada: notas.length > 0
        ? `${resultado.numeroNotaCredito} / ${resultado.valorNotaCredito}`
        : 'Sin nota de crédito',
      message: notas.length > 0 ? 'Nota de crédito encontrada.' : 'Factura sin nota de crédito.',
    });

    return resultado;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido al procesar el CUFE.';

    notifyProgress(onProgress, {
      currentCufe: cufe,
      facturaEncontrada: '',
      notaEncontrada: '',
      message: mensaje,
    });

    return createResultModel(cufe, nit, { estado: 'ERROR', error: mensaje });
  } finally {
    try {
      await gotoSearchPage(tabId);
    } catch (error) {
      // Si no se pudo volver al buscador, el siguiente CUFE lo reintentará.
    }
  }
}

/**
 * Obtiene la siguiente CUFE pendiente según el estado del proceso.
 * @param {{ listaCUFEs: Array<{ cufe: string, nit: string }>, procesados: number }} state - Estado actual.
 * @returns {{ cufe: string } | null}
 */
function getNextPendingCufe(state) {
  return state.listaCUFEs[state.procesados] || null;
}

/**
 * Actualiza la información del estado del proceso.
 * @param {{ total: number, procesados: number, pendientes: number }} state - Estado global.
 * @param {number} processedCount - Nuevo contador de procesados.
 */
function syncState(state, processedCount) {
  state.procesados = processedCount;
  state.pendientes = Math.max(0, state.total - state.procesados);
}

/**
 * Ejecuta el flujo completo para todos los CUFEs pendientes.
 * @param {{ total: number, procesados: number, pendientes: number, listaCUFEs: Array<{ cufe: string, nit: string }> }} state - Estado global.
 * @param {(payload: object) => void} [onProgress] - Callback de progreso.
 * @param {() => boolean} [shouldStop] - Se consulta antes de cada CUFE; si devuelve true, el lote se detiene.
 * @returns {Promise<Array<ResultModel>>}
 */
async function executeWorkflow(state, onProgress, shouldStop) {
  const tabId = await obtenerTabDian();
  const results = [];

  while (state.procesados < state.total) {
    if (typeof shouldStop === 'function' && shouldStop()) {
      notifyProgress(onProgress, { message: 'Proceso detenido por el usuario.' });
      break;
    }

    const pendiente = getNextPendingCufe(state);
    if (!pendiente) {
      break;
    }

    const resultado = await processSingleCufe(tabId, pendiente, onProgress);
    results.push(resultado);

    syncState(state, state.procesados + 1);
    notifyProgress(onProgress, {
      processedCount: state.procesados,
      message: `CUFE procesado ${state.procesados}/${state.total}.`,
    });
  }

  return results;
}

export {
  executeContentAction,
  getNextPendingCufe,
  syncState,
  createResultModel,
  processSingleCufe,
  executeWorkflow,
};
