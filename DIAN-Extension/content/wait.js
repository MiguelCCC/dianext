/**
 * Espera a que un elemento aparezca en el DOM.
 * @param {string} selector - Selector usado en la busqueda.
 * @returns {Promise<Element>}
 */
async function waitForElement(selector) {
  return new Promise((resolve, reject) => {
    const node = document.querySelector(selector);
    if (node) {
      resolve(node);
      return;
    }

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`No se encontró el elemento esperado: ${selector}`));
    }, 15000);
  });
}

/**
 * Espera a que un elemento desaparezca del DOM.
 * @param {string} selector - Selector usado en la verificación.
 * @returns {Promise<boolean>}
 */
async function waitUntilHidden(selector) {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const node = document.querySelector(selector);
      if (!node) {
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`El elemento no desapareció: ${selector}`));
    }, 15000);
  });
}

/**
 * Espera a que la página termine de cambiar de estado después de navegación.
 * @param {string} expectedUrl - URL esperada.
 * @returns {Promise<boolean>}
 */
async function waitForPage(expectedUrl) {
  await waitForElement('body');
  return window.location.href.includes(expectedUrl) || expectedUrl === window.location.href;
}

/**
 * Espera a que exista una mutación significativa en el DOM.
 * @param {string} selector - Selector base para observar.
 * @returns {Promise<MutationRecord[]>}
 */
async function waitForMutation(selector) {
  return new Promise((resolve, reject) => {
    const target = document.querySelector(selector) || document.body;
    const observer = new MutationObserver((records) => {
      observer.disconnect();
      resolve(records);
    });

    observer.observe(target, { childList: true, subtree: true, attributes: true });

    window.setTimeout(() => {
      observer.disconnect();
      reject(new Error('No hubo mutaciones observables en el DOM.'));
    }, 15000);
  });
}

export {
  waitForElement,
  waitUntilHidden,
  waitForPage,
  waitForMutation,
};
