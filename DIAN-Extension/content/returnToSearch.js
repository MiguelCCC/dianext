/**
 * Regresa desde el detalle de la factura hacia la pantalla de búsqueda.
 * Esta función no decide el flujo, solo intenta volver al buscador y verifica que la interfaz de búsqueda esté disponible.
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function returnToSearch() {
  try {
    const { waitForElement, waitUntilVisible } = await import('./wait.js');
    const { findElementByText, findInputByNameOrPlaceholder, findButtonByText } = await import('../utils/selectors.js');

    await waitForElement('body');

    const backButton = findElementByText('Volver');
    if (backButton) {
      const firstAttempt = await tryBackButton(backButton);
      if (firstAttempt) {
        const searchReady = await confirmSearchIsReady();
        if (searchReady) {
          return { success: true };
        }
      }

      const secondAttempt = await tryBackButton(backButton);
      if (secondAttempt) {
        const searchReady = await confirmSearchIsReady();
        if (searchReady) {
          return { success: true };
        }
      }
    }

    const fallbackResult = await useHistoryBackFallback();
    if (!fallbackResult) {
      return {
        success: false,
        error: 'No fue posible regresar a la pantalla de búsqueda.',
      };
    }

    const searchReady = await confirmSearchIsReady();
    if (!searchReady) {
      return {
        success: false,
        error: 'La página de búsqueda no quedó disponible después del retorno.',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al regresar al buscador.',
    };
  }
}

/**
 * Intenta hacer clic en el botón visible de regreso una sola vez.
 * @param {Element} backButton - Botón o enlace visible para volver.
 * @returns {Promise<boolean>}
 */
async function tryBackButton(backButton) {
  if (!backButton) {
    return false;
  }

  backButton.click();
  await waitUntilVisible('body');

  return true;
}

/**
 * Utiliza history.back() como respaldo cuando el botón Volver no está disponible o no funciona.
 * @returns {Promise<boolean>}
 */
async function useHistoryBackFallback() {
  if (window.history.length > 1) {
    window.history.back();
    await waitUntilVisible('body');
    return true;
  }

  return false;
}

/**
 * Verifica que la interfaz de búsqueda esté nuevamente disponible.
 * @returns {Promise<boolean>}
 */
async function confirmSearchIsReady() {
  const { findInputByNameOrPlaceholder, findButtonByText } = await import('../utils/selectors.js');

  await waitForElement('body');

  const field = findInputByNameOrPlaceholder(['cufe', 'uuid', 'documento', 'buscar']);
  const button = findButtonByText(['Buscar', 'Search']);

  return Boolean(field && button);
}

export {
  returnToSearch,
};
