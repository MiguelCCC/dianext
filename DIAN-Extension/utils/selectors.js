/**
 * Encuentra un elemento según texto visible dentro del DOM.
 * @param {string} text - Texto esperado.
 * @returns {Element | null}
 */
function findElementByText(text) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = (node.textContent || '').replace(/\s+/g, ' ').trim();

    if (content.toLowerCase().includes(text.toLowerCase())) {
      return node;
    }
  }

  return null;
}

/**
 * Encuentra el primer elemento que cumpla con una condición arbitraria.
 * @param {(element: Element) => boolean} predicate - Predicado a evaluar.
 * @returns {Promise<Element | null>}
 */
async function findElementByPredicate(predicate) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (predicate(node)) {
      return node;
    }
  }

  return null;
}

/**
 * Busca un input con nombre o placeholder asociado al CUFE.
 * @param {string[]} hints - Lista de nombres o placeholders posibles.
 * @returns {HTMLInputElement | null}
 */
function findInputByNameOrPlaceholder(hints) {
  const collection = Array.from(document.querySelectorAll('input'));
  return collection.find((input) => {
    const name = (input.name || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    return hints.some((hint) => name.includes(hint) || placeholder.includes(hint));
  }) || null;
}

/**
 * Busca un botón por texto visible.
 * @param {string[]} hints - Lista de textos esperados.
 * @returns {HTMLButtonElement | null}
 */
function findButtonByText(hints) {
  const collection = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));

  return collection.find((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return hints.some((hint) => text.includes(hint.toLowerCase()));
  }) || null;
}

export {
  findElementByText,
  findElementByPredicate,
  findInputByNameOrPlaceholder,
  findButtonByText,
};
