/**
 * Extrae la información de la factura electrónica ya abierta en la página DIAN.
 * Esta función está limitada a la extracción del detalle de factura y no realiza navegación ni control del flujo.
 * @returns {Promise<{ success: boolean, data?: { numeroFactura: string, valorFactura: string }, error?: string }>}
 */
async function extractInvoice() {
  try {
    const { waitForElement } = await import('./wait.js');
    const { findElementByText } = await import('../utils/selectors.js');

    await waitForElement('body');
    await waitForInvoiceDetail();

    const numeroFactura = getFieldValue('Folio');
    const valorFactura = getFieldValue('Valor Total');

    if (!numeroFactura) {
      return {
        success: false,
        error: 'No se encontró el campo Folio en el detalle de la factura.',
      };
    }

    if (!valorFactura) {
      return {
        success: false,
        error: 'No se encontró el campo Valor Total en el detalle de la factura.',
      };
    }

    return {
      success: true,
      data: {
        numeroFactura: normalizeText(numeroFactura),
        valorFactura: normalizeCurrency(valorFactura),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al extraer la factura.',
    };
  }
}

/**
 * Espera a que el detalle de la factura esté listo para extraer campos.
 * @returns {Promise<void>}
 */
async function waitForInvoiceDetail() {
  await waitForElement('body');

  return new Promise((resolve) => {
    const target = document.body;
    const observer = new MutationObserver(() => {
      const folioField = getFieldValue('Folio');
      const totalField = getFieldValue('Valor Total');

      if (folioField && totalField) {
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

/**
 * Normaliza un texto eliminando espacios redundantes y saltos de línea.
 * @param {string} value - Texto a normalizar.
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza un valor monetario removiendo separadores y símbolos no numéricos.
 * @param {string} value - Texto con formato monetario.
 * @returns {string}
 */
function normalizeCurrency(value) {
  return String(value || '')
    .replace(/[^\d]/g, '')
    .trim();
}

/**
 * Obtiene el valor asociado a una etiqueta visible dentro del DOM.
 * La estrategia no depende de índices ni de posiciones en pantalla.
 * @param {string} labelText - Texto de la etiqueta a buscar.
 * @returns {string}
 */
function getFieldValue(labelText) {
  const labelNode = findElementByText(labelText);

  if (!labelNode) {
    return '';
  }

  const container = labelNode.closest('div, tr, li, section, article, p, dd, dt, table') || labelNode.parentElement || document.body;
  const candidates = Array.from(container.querySelectorAll('*'));

  for (const candidate of candidates) {
    if (candidate === labelNode) {
      continue;
    }

    const text = normalizeText(candidate.textContent || '');
    if (!text || text.toLowerCase().includes(labelText.toLowerCase())) {
      continue;
    }

    if (isLikelyValueNode(text)) {
      return text;
    }
  }

  const nextSiblingValue = findSiblingValue(labelNode);
  if (nextSiblingValue) {
    return nextSiblingValue;
  }

  return '';
}

/**
 * Valida si el texto parece representar el valor asociado a un campo.
 * @param {string} text - Texto a validar.
 * @returns {boolean}
 */
function isLikelyValueNode(text) {
  return /\d/.test(text) && text.length > 0;
}

/**
 * Busca un valor en nodos hermanos cercanos al nodo de la etiqueta.
 * @param {Element} labelNode - Nodo de etiqueta.
 * @returns {string}
 */
function findSiblingValue(labelNode) {
  const siblings = [
    labelNode.nextElementSibling,
    labelNode.parentElement?.nextElementSibling,
    labelNode.parentElement?.previousElementSibling,
  ];

  for (const sibling of siblings) {
    if (!sibling) {
      continue;
    }

    const text = normalizeText(sibling.textContent || '');
    if (text && isLikelyValueNode(text)) {
      return text;
    }
  }

  return '';
}

export {
  extractInvoice,
};
