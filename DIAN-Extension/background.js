/**
 * Service worker (MV3, tipo module) de la extensión DIAN Consulta CUFE.
 *
 * Notas de plataforma:
 * - Los service workers NO permiten import() dinámico: los módulos se
 *   importan estáticamente (por eso el manifest declara "type": "module").
 * - La lectura del Excel ocurre en el POPUP; aquí solo llega la lista de
 *   CUFEs ya limpia (mensaje LOAD_CUFES).
 * - Durante el lote se mantiene vivo el service worker con un keepalive,
 *   porque Chrome lo suspende tras ~30 s de inactividad.
 */

import { executeWorkflow } from './workflow.js';
import { writeWorkbook } from './excel/writer.js';

/**
 * Estado compartido del lote de CUFEs.
 */
const state = {
  total: 0,
  procesados: 0,
  pendientes: 0,
  listaCUFEs: [],
  results: [],
  currentCufe: '',
  facturaEncontrada: '',
  notaEncontrada: '',
  message: '',
  enProceso: false,
};

/**
 * Envía una actualización de estado al popup (ignora el error si está cerrado).
 * @param {object} payload - Payload parcial del estado.
 */
function notifyPopup(payload) {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: payload }, () => {
    void chrome.runtime.lastError;
  });
}

/**
 * Reinicia el estado del lote.
 */
function resetState() {
  state.total = 0;
  state.procesados = 0;
  state.pendientes = 0;
  state.listaCUFEs = [];
  state.results = [];
  state.currentCufe = '';
  state.facturaEncontrada = '';
  state.notaEncontrada = '';
  state.message = '';
}

/**
 * Carga la lista limpia de CUFEs enviada por el popup.
 * @param {Array<{ cufe: string }>} cuFes - Lista de CUFEs válidos.
 */
function setCuFeList(cuFes) {
  state.total = cuFes.length;
  state.procesados = 0;
  state.pendientes = cuFes.length;
  state.listaCUFEs = cuFes;
  state.results = [];
  state.currentCufe = '';
  state.facturaEncontrada = '';
  state.notaEncontrada = '';
  state.message = 'Lote cargado.';

  notifyPopup({
    total: state.total,
    procesados: state.procesados,
    pendientes: state.pendientes,
    currentCufe: state.currentCufe,
    facturaEncontrada: state.facturaEncontrada,
    notaEncontrada: state.notaEncontrada,
    message: state.message,
  });
}

/**
 * Actualiza el estado visual en el popup durante el procesamiento del lote.
 * @param {{ currentCufe?: string, facturaEncontrada?: string, notaEncontrada?: string, message?: string, processedCount?: number }} payload - Datos a mostrar.
 */
function pushProgress(payload = {}) {
  state.currentCufe = payload.currentCufe ?? state.currentCufe;
  state.facturaEncontrada = payload.facturaEncontrada ?? state.facturaEncontrada;
  state.notaEncontrada = payload.notaEncontrada ?? state.notaEncontrada;
  state.message = payload.message ?? state.message;

  if (typeof payload.processedCount === 'number') {
    state.procesados = payload.processedCount;
    state.pendientes = Math.max(0, state.total - state.procesados);
  }

  notifyPopup({
    total: state.total,
    procesados: state.procesados,
    pendientes: state.pendientes,
    currentCufe: state.currentCufe,
    facturaEncontrada: state.facturaEncontrada,
    notaEncontrada: state.notaEncontrada,
    message: state.message,
  });
}

/**
 * Recibe la lista de CUFEs ya parseada por el popup.
 * @param {{ cufes?: Array<{ cufe: string }> }} payload - Lista enviada desde el popup.
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function loadCufes(payload = {}) {
  try {
    const cufes = Array.isArray(payload.cufes) ? payload.cufes : [];
    if (cufes.length === 0) {
      throw new Error('La lista de CUFEs recibida está vacía.');
    }

    setCuFeList(cufes);

    return {
      success: true,
      data: {
        total: state.total,
        procesados: state.procesados,
        pendientes: state.pendientes,
      },
    };
  } catch (error) {
    resetState();
    return {
      success: false,
      error: error instanceof Error ? error.message : 'No se pudo cargar la lista de CUFEs.',
    };
  }
}

/**
 * Ejecuta el flujo completo del lote y finaliza con la exportación del Excel.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function startAutomation() {
  if (state.enProceso) {
    return { success: false, error: 'Ya hay un lote en proceso.' };
  }

  if (state.total === 0 || state.listaCUFEs.length === 0) {
    return { success: false, error: 'No hay CUFEs cargados para procesar.' };
  }

  // Keepalive: evita que Chrome suspenda el service worker en lotes largos.
  const keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20000);

  state.enProceso = true;

  try {
    const results = await executeWorkflow(state, pushProgress);
    state.results = results;

    await writeWorkbook(results, 'resultado.xlsx');

    pushProgress({
      currentCufe: '',
      message: 'Proceso finalizado. Se generó resultado.xlsx.',
      processedCount: state.total,
    });

    return {
      success: true,
      data: {
        total: state.total,
        procesados: state.total,
        pendientes: 0,
      },
    };
  } catch (error) {
    pushProgress({
      message: error instanceof Error ? error.message : 'Error durante la automatización.',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error durante la automatización.',
    };
  } finally {
    clearInterval(keepAlive);
    state.enProceso = false;
  }
}

/**
 * Listener principal del background.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const task = (async () => {
    try {
      if (request?.type === 'LOAD_CUFES') {
        return loadCufes(request);
      }

      if (request?.type === 'START_PROCESS') {
        return await startAutomation();
      }

      if (request?.type === 'GET_STATE') {
        return {
          success: true,
          data: {
            total: state.total,
            procesados: state.procesados,
            pendientes: state.pendientes,
            currentCufe: state.currentCufe,
            facturaEncontrada: state.facturaEncontrada,
            notaEncontrada: state.notaEncontrada,
            message: state.message,
            enProceso: state.enProceso,
          },
        };
      }

      return {
        success: false,
        error: `Tipo de mensaje no soportado: ${request?.type}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error en el background.',
      };
    }
  })();

  task.then((response) => sendResponse(response));
  return true;
});
