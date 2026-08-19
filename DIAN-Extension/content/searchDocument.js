/**
 * Busca un CUFE en la página de la DIAN y devuelve el resultado estructurado.
 * Esta función es responsable únicamente de la búsqueda del CUFE.
 * @param {string} cufe - CUFE a consultar.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function searchDocument(cufe) {
  try {
    if (!cufe || !String(cufe).trim()) {
      return {
        success: false,
        error: 'El CUFE recibido está vacío.',
      };
    }

    const { waitForElement, waitForMutation } = await import('./wait.js');
    const {
      findInputByNameOrPlaceholder,
      findButtonByText,
      findElementByText,
    } = await import('../utils/selectors.js');

    await waitForElement('body');

    const input = findInputByNameOrPlaceholder(['cufe', 'uuid', 'documento', 'buscar']);
    if (!input) {
      return {
        success: false,
        error: 'No se encontró el campo de búsqueda del CUFE.',
      };
    }

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    input.value = String(cufe).trim();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const searchButton = findButtonByText(['Buscar', 'Search']);
    if (!searchButton) {
      return {
        success: false,
        error: 'No se encontró el botón Buscar.',
      };
    }

    searchButton.click();

    await waitForMutation('body');
    await waitForElement('body');

    const resultFound = findElementByText('Resultado') || findElementByText('Factura') || findElementByText('Documento');
    const isLoadingVisible = document.querySelector('[role="status"], .loading, .spinner, .loader');

    if (resultFound || !isLoadingVisible) {
      return {
        success: true,
        data: {
          searchedCufe: String(cufe).trim(),
        },
      };
    }

    return {
      success: false,
      error: 'La búsqueda no terminó correctamente.',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al buscar el CUFE.',
    };
  }
}

export {
  searchDocument,
};
