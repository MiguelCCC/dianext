/**
 * Content script de la extensión DIAN Consulta CUFE.
 *
 * IMPORTANTE: este archivo es autocontenido (sin import dinámico) porque los
 * content scripts de manifest V3 no pueden importar módulos hermanos sin
 * declararlos como web_accessible_resources, y porque la página de la DIAN
 * navega con POST completo al buscar (el script se recarga en cada página).
 *
 * Estructura real de la página de detalle de la DIAN (verificada):
 * - Cada documento (factura y nota(s) crédito) vive en un div `.tab-pane`
 *   cuyo id es el CUFE/CUDE de 96 caracteres hexadecimales.
 * - Los campos visibles son "Folio: <número>" y "Total: $<valor>".
 * - Las notas crédito incluyen la sección "CONCEPTO DE CORRECCIÓN" con
 *   "Descripción: <concepto>".
 * - El buscador es el input #DocumentKey dentro de un form POST que exige el
 *   token Cloudflare Turnstile en el hidden [name="cf-turnstile-response"].
 */

const HEX96 = /^[0-9a-f]{96}$/i;

/**
 * Devuelve el texto visible completo de la página.
 * @returns {string}
 */
function textoPagina() {
  return (document.body && document.body.innerText) || '';
}

/**
 * Obtiene el token actual de Cloudflare Turnstile (vacío si aún no se emite).
 * @returns {string}
 */
function obtenerToken() {
  const el = document.querySelector('[name="cf-turnstile-response"]');
  return el && typeof el.value === 'string' ? el.value : '';
}

/**
 * Devuelve los paneles de documento (factura / notas crédito) presentes en el DOM.
 * @returns {Element[]}
 */
function obtenerPanes() {
  return Array.from(document.querySelectorAll('.tab-pane')).filter((pane) => HEX96.test(pane.id));
}

/**
 * Describe en qué estado está la página actual.
 * @returns {{ url: string, esBuscador: boolean, tokenListo: boolean, esDetalle: boolean, sinResultado: boolean }}
 */
function estadoPagina() {
  return {
    url: window.location.href,
    esBuscador: Boolean(document.getElementById('DocumentKey')),
    tokenListo: obtenerToken().length > 20,
    esDetalle: obtenerPanes().length > 0,
    sinResultado: /no se encontr|no existe informaci|documento inv[aá]lido/i.test(textoPagina()),
  };
}

/**
 * Pausa asíncrona.
 * @param {number} ms - Milisegundos a esperar.
 * @returns {Promise<void>}
 */
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera hasta que Cloudflare Turnstile emita el token del formulario.
 * @param {number} [timeoutMs=10000] - Tiempo máximo de espera.
 * @returns {Promise<{ tokenListo: boolean }>}
 */
async function esperarToken(timeoutMs = 10000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (obtenerToken().length > 20) {
      return { tokenListo: true };
    }
    await esperar(250);
  }
  return { tokenListo: false };
}

/**
 * Devuelve el texto de un panel de documento, aunque esté oculto.
 * IMPORTANTE: los paneles no activos están ocultos (display:none) y su
 * innerText se comporta como textContent: incluye el CSS de los <style>
 * incrustados y no garantiza saltos de línea. Por eso se clona el panel,
 * se eliminan style/script y se usa textContent, igual para todos.
 * @param {Element} pane - Panel .tab-pane del documento.
 * @returns {string}
 */
function textoPane(pane) {
  const clon = pane.cloneNode(true);
  clon.querySelectorAll('style, script').forEach((nodo) => nodo.remove());
  return clon.textContent || '';
}

/**
 * Extrae todos los documentos presentes en la página de detalle.
 * La factura y sus notas crédito están todas en el DOM (pestañas ocultas),
 * por lo que NO es necesario hacer clic en la pestaña de nota crédito.
 *
 * La clasificación factura/nota NO se hace aquí: el workflow compara el id
 * del panel (que es el CUFE/CUDE del documento) contra el CUFE buscado.
 * @returns {object}
 */
function extraerDocumentos() {
  const docs = obtenerPanes().map((pane) => {
    const texto = textoPane(pane);
    // El folio puede ser ALFANUMÉRICO (ej. "FEH8025111"), no solo dígitos.
    const folio = (texto.match(/Folio:\s*([A-Za-z0-9-]+)/) || [])[1] || '';
    const serie = (texto.match(/Serie:\s*([A-Za-z0-9-]+)/) || [])[1] || '';
    // "TOTALES E IMPUESTOS" no tiene dos puntos, así que "Total:" es inequívoco.
    const totalCrudo = (texto.match(/Total:\s*\$?\s*([\d.,]+)/) || [])[1] || '';
    const esNota = /Nota de cr[eé]dito electr[oó]nica/i.test(texto) && /CONCEPTO DE CORRECCI/i.test(texto);
    const concepto = ((texto.match(/Descripci[oó]n:\s*([^\n]{1,100})/) || [])[1] || '').trim();

    return {
      cufe: pane.id.toLowerCase(),
      folio,
      serie,
      total: totalCrudo.replace(/[^\d]/g, ''),
      esNota,
      concepto,
    };
  });

  return { ...estadoPagina(), docs };
}

/**
 * Espera a que aparezca el campo NIT en el DOM. La DIAN solo lo revela
 * después de que el CUFE queda diligenciado (no está presente de entrada).
 * @param {number} [timeoutMs=8000] - Tiempo máximo de espera.
 * @returns {Promise<HTMLInputElement | null>}
 */
async function esperarInputNit(timeoutMs = 8000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const inputNit = document.getElementById('SearchDocumentNit');
    if (inputNit) {
      return inputNit;
    }
    await esperar(200);
  }
  return null;
}

/**
 * Diligencia el CUFE, espera a que la DIAN revele el campo NIT y lo
 * diligencia también, y envía el formulario de búsqueda.
 * Responde ANTES de enviar el formulario: el submit navega a otra página y
 * destruye este content script, así que el sendResponse debe salir primero.
 * @param {string} cufe - CUFE a consultar.
 * @param {string} nit - NIT del emisor o receptor asociado al CUFE.
 * @param {(response: object) => void} sendResponse - Callback de respuesta.
 */
async function buscarCufe(cufe, nit, sendResponse) {
  const valorCufe = String(cufe || '').trim();
  const valorNit = String(nit || '').trim();

  if (!valorCufe) {
    sendResponse({ success: false, error: 'El CUFE recibido está vacío.' });
    return;
  }
  if (!valorNit) {
    sendResponse({ success: false, error: 'El NIT recibido está vacío.' });
    return;
  }

  const input = document.getElementById('DocumentKey');
  if (!input) {
    sendResponse({ success: false, error: 'La página actual no es el buscador de documentos.' });
    return;
  }

  if (obtenerToken().length <= 20) {
    sendResponse({ success: false, error: 'TOKEN_NO_LISTO' });
    return;
  }

  const form = input.closest('form');
  if (!form) {
    sendResponse({ success: false, error: 'No se encontró el formulario de búsqueda.' });
    return;
  }

  input.value = valorCufe;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));

  const inputNit = await esperarInputNit();
  if (!inputNit) {
    sendResponse({ success: false, error: 'El campo NIT (#SearchDocumentNit) no apareció después de diligenciar el CUFE.' });
    return;
  }

  inputNit.value = valorNit;
  inputNit.dispatchEvent(new Event('input', { bubbles: true }));
  inputNit.dispatchEvent(new Event('change', { bubbles: true }));

  sendResponse({ success: true, data: { submitted: true } });
  setTimeout(() => form.submit(), 50);
}

/**
 * Listener principal del content script.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || request.type !== 'EXECUTE_ACTION') {
    sendResponse({ success: false, error: `Tipo de mensaje no soportado: ${request && request.type}` });
    return false;
  }

  const action = request.action;
  const payload = request.payload || {};

  try {
    switch (action) {
      case 'estado':
        sendResponse({ success: true, data: estadoPagina() });
        return false;

      case 'esperarToken':
        esperarToken(payload.timeoutMs)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Error esperando el token.',
          }));
        return true;

      case 'buscarCUFE':
        buscarCufe(payload.cufe, payload.nit, sendResponse);
        return true;

      case 'extraer':
        sendResponse({ success: true, data: extraerDocumentos() });
        return false;

      default:
        sendResponse({ success: false, error: `Acción no soportada: ${action}` });
        return false;
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado en el content script.',
    });
    return false;
  }
});
