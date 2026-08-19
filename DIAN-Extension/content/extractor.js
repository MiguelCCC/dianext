import { findElementByText, findElementByPredicate } from '../utils/selectors.js';

/**
 * Extrae el número de factura y el valor total desde el detalle principal.
 * @returns {Promise<{ folio: string, valorTotal: string }>}
 */
async function extractInvoiceData() {
  const folio = await findElementByPredicate((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return /factura|folio/i.test(text) && /\d+/.test(text);
  });

  const valor = await findElementByPredicate((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return /valor total|total/i.test(text) && /\d/.test(text);
  });

  return {
    folio: folio ? (folio.textContent || '').trim() : '',
    valorTotal: valor ? (valor.textContent || '').trim() : '',
  };
}

/**
 * Extrae el número y el valor de la nota de crédito cuando exista su sección.
 * @returns {Promise<{ folio: string, valorTotal: string }>}
 */
async function extractCreditNoteData() {
  const section = findElementByText('Nota de crédito electrónica');
  if (!section) {
    return {
      folio: '',
      valorTotal: '',
    };
  }

  const folio = await findElementByPredicate((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return /nota.*crédito|número.*nota/i.test(text) && /\d+/.test(text);
  });

  const valor = await findElementByPredicate((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return /valor.*nota|total.*nota/i.test(text) && /\d/.test(text);
  });

  return {
    folio: folio ? (folio.textContent || '').trim() : '',
    valorTotal: valor ? (valor.textContent || '').trim() : '',
  };
}

export {
  extractInvoiceData,
  extractCreditNoteData,
};
