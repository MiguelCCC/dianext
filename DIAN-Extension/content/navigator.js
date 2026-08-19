import { waitForElement, waitForPage, waitUntilHidden } from './wait.js';
import { findElementByText, findElementByPredicate, findInputByNameOrPlaceholder, findButtonByText } from '../utils/selectors.js';

/**
 * Valida que el documento ya esté disponible para la automatización.
 * @returns {Promise<void>}
 */
async function ensurePageReady() {
  await waitForElement('body');
}

/**
 * Escribe el CUFE en el campo de consulta y dispara la búsqueda.
 * @param {string} cufe - CUFE a consultar.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function searchCufe(cufe) {
  await ensurePageReady();

  const input = findInputByNameOrPlaceholder(['cufe', 'documento', 'buscar']);
  if (!input) {
    throw new Error('No se encontró el campo de búsqueda del CUFE.');
  }

  input.value = cufe;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const searchButton = findButtonByText(['Buscar', 'Search']);
  if (!searchButton) {
    throw new Error('No se encontró el botón de búsqueda.');
  }

  searchButton.click();
  await waitUntilHidden('body');

  return {
    success: true,
    data: { searchedCufe: cufe },
  };
}

/**
 * Abre el detalle de la factura una vez la carga se completa.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function openInvoiceDetail() {
  await ensurePageReady();

  const actionButton = findElementByText('Detalle') || findElementByText('Ver detalle') || findElementByText('Consultar');
  if (!actionButton) {
    throw new Error('No se encontró el botón para abrir el detalle de la factura.');
  }

  actionButton.click();
  await waitForPage(window.location.href);

  return {
    success: true,
    data: { openedDetail: true },
  };
}

/**
 * Busca si existe la sección o enlace de nota de crédito electrónica.
 * @returns {Promise<{ success: boolean, data: boolean }>}
 */
async function hasCreditNoteSection() {
  await ensurePageReady();

  const section = findElementByText('Nota de crédito electrónica');
  return {
    success: true,
    data: Boolean(section),
  };
}

/**
 * Abre la nota de crédito cuando la sección se encuentre visible.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function openCreditNoteSection() {
  const section = findElementByText('Nota de crédito electrónica');
  if (!section) {
    return {
      success: true,
      data: { opened: false },
    };
  }

  section.click();
  await waitForElement('body');

  return {
    success: true,
    data: { opened: true },
  };
}

/**
 * Retorna a la búsqueda reutilizando el historial del navegador.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function goBackToSearch() {
  await ensurePageReady();

  if (window.history.length > 1) {
    window.history.back();
  }

  await waitForPage(window.location.href);

  return {
    success: true,
    data: { returnedToSearch: true },
  };
}

/**
 * Ejecuta el lote completo de CUFEs de forma secuencial.
 * @param {string[]} cuFes - Lista de CUFEs a procesar.
 * @returns {Promise<object[]>}
 */
async function startBatchProcess(cuFes) {
  const results = [];

  for (const cufe of cuFes) {
    try {
      await searchCufe(cufe);
      await openInvoiceDetail();

      const invoiceData = await extractInvoiceData();
      const hasNote = await hasCreditNoteSection();
      const noteData = hasNote.data ? await extractCreditNoteData() : { folio: '', valorTotal: '' };

      results.push({
        cufe,
        factura: invoiceData,
        notaCredito: noteData,
      });

      await goBackToSearch();
    } catch (error) {
      results.push({
        cufe,
        error: error instanceof Error ? error.message : 'Error sin detalle.',
      });
    }
  }

  return results;
}

export {
  ensurePageReady,
  searchCufe,
  openInvoiceDetail,
  hasCreditNoteSection,
  openCreditNoteSection,
  goBackToSearch,
  startBatchProcess,
};
