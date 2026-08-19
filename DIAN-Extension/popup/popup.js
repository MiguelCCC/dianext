/**
 * Lógica del popup. El Excel se lee y parsea AQUÍ (el service worker no puede
 * usar import() dinámico ni parsear con DOM), y al background solo se le envía
 * la lista limpia de CUFEs.
 */

import { readCuFesFromWorkbook } from '../excel/reader.js';

const excelFileInput = document.getElementById('excelFileInput');
const cufeCount = document.getElementById('cufeCount');
const startButton = document.getElementById('startButton');
const currentCufe = document.getElementById('currentCufe');
const facturaFound = document.getElementById('facturaFound');
const notaFound = document.getElementById('notaFound');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const message = document.getElementById('message');

let isProcessing = false;
let loadedCufeCount = 0;

/**
 * Muestra mensajes de estado en el popup.
 * @param {string} text - Texto a mostrar.
 * @param {string} [type=''] - Tipo opcional: success, error.
 */
function setMessage(text, type = '') {
  message.textContent = text;
  message.className = 'message';

  if (type) {
    message.classList.add(`is-${type}`);
  }
}

/**
 * Actualiza el contador visual del progreso.
 * @param {number} current - Número procesado.
 * @param {number} total - Total esperado.
 */
function updateProgress(current, total) {
  const safeTotal = total || 0;
  const safeCurrent = Math.min(current, safeTotal);

  progressText.textContent = `${safeCurrent} / ${safeTotal}`;
  const percentage = safeTotal === 0 ? 0 : (safeCurrent / safeTotal) * 100;
  progressBar.style.width = `${percentage}%`;
}

/**
 * Aplica un estado (parcial o completo) a la interfaz del popup.
 * @param {object} estado - Estado enviado por el background.
 */
function applyState(estado = {}) {
  if (typeof estado.total === 'number') {
    loadedCufeCount = estado.total;
    cufeCount.textContent = String(estado.total);
    updateProgress(estado.procesados || 0, estado.total);
  }

  if (typeof estado.currentCufe === 'string') {
    currentCufe.textContent = estado.currentCufe || '-';
  }

  if (typeof estado.facturaEncontrada === 'string') {
    facturaFound.textContent = estado.facturaEncontrada || '-';
  }

  if (typeof estado.notaEncontrada === 'string') {
    notaFound.textContent = estado.notaEncontrada || '-';
  }

  if (estado.message) {
    setMessage(estado.message, estado.message.startsWith('⚠️') ? 'error' : '');
  }
}

/**
 * Envía un mensaje al background y devuelve su respuesta.
 * @param {object} payload - Mensaje a enviar.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
function sendToBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || { success: false, error: 'Respuesta vacía del background.' });
    });
  });
}

/**
 * Gestiona la selección del archivo: lo parsea localmente y envía los CUFEs.
 * @param {Event} event - Evento del input file.
 */
async function handleFileSelection(event) {
  const [file] = event.target.files;

  if (!file) {
    return;
  }

  try {
    setMessage('Leyendo el archivo Excel...', '');
    const arrayBuffer = await file.arrayBuffer();
    const cufes = await readCuFesFromWorkbook(arrayBuffer);

    const response = await sendToBackground({ type: 'LOAD_CUFES', cufes });
    if (!response?.success) {
      throw new Error(response?.error || 'No se pudo cargar la lista de CUFEs.');
    }

    loadedCufeCount = response?.data?.total || 0;
    cufeCount.textContent = String(loadedCufeCount);
    updateProgress(0, loadedCufeCount);
    startButton.disabled = loadedCufeCount === 0;
    setMessage(`Se cargaron ${loadedCufeCount} CUFEs.`, 'success');
  } catch (error) {
    startButton.disabled = true;
    loadedCufeCount = 0;
    cufeCount.textContent = '0';
    updateProgress(0, 0);
    setMessage(error.message || 'Error al cargar el archivo.', 'error');
  }
}

/**
 * Solicita al background iniciar el proceso.
 * El proceso corre en el background: este popup puede cerrarse sin detenerlo.
 */
async function startProcessing() {
  if (isProcessing || loadedCufeCount === 0) {
    return;
  }

  try {
    isProcessing = true;
    startButton.disabled = true;
    setMessage('Procesando... puedes cerrar este popup, el proceso sigue en segundo plano.', '');

    const response = await sendToBackground({ type: 'START_PROCESS' });

    if (!response?.success) {
      throw new Error(response?.error || 'No se pudo iniciar el proceso.');
    }

    setMessage('Proceso finalizado. Se descargó resultado.xlsx.', 'success');
  } catch (error) {
    setMessage(error.message || 'Error durante el proceso.', 'error');
  } finally {
    isProcessing = false;
    startButton.disabled = loadedCufeCount === 0;
  }
}

/**
 * Escucha los estados enviados por el background.
 */
chrome.runtime.onMessage.addListener((messageEvent) => {
  if (messageEvent?.type === 'STATE_UPDATE') {
    applyState(messageEvent.state || {});
  }
});

/**
 * Al abrir el popup, recupera el estado actual del background (por si hay un
 * lote en curso iniciado antes de cerrar el popup).
 */
async function restoreState() {
  try {
    const response = await sendToBackground({ type: 'GET_STATE' });
    if (response?.success && response.data) {
      applyState(response.data);
      isProcessing = Boolean(response.data.enProceso);
      startButton.disabled = isProcessing || (response.data.total || 0) === 0;
    }
  } catch (error) {
    // Si el background aún no responde, se mantiene el estado inicial.
  }
}

excelFileInput.addEventListener('change', handleFileSelection);
startButton.addEventListener('click', startProcessing);

currentCufe.textContent = '-';
facturaFound.textContent = '-';
notaFound.textContent = '-';
updateProgress(0, 0);
restoreState();
