/**
 * Loading state wrapper for async operations
 * Prevents double-submit and manages button state
 *
 * @param {HTMLElement} buttonEl - Button element
 * @param {Function} asyncFn - Async function to execute
 * @param {Object} options - Options
 * @param {string} options.loadingText - Text to show during loading (default: 'Loading...')
 * @returns {Promise} - Result of asyncFn
 */
export async function withLoading(buttonEl, asyncFn, options = {}) {
    const { loadingText = 'Loading...' } = options;

    if (!buttonEl || buttonEl.disabled) {
        return;
    }

    // Save original state without innerHTML to avoid injection risks
    const originalChildren = Array.from(buttonEl.childNodes).map((node) => node.cloneNode(true));
    const originalDisabled = buttonEl.disabled;

    // Set loading state
    buttonEl.disabled = true;
    setLoadingContent(buttonEl, loadingText);
    buttonEl.classList.add('is-loading');

    try {
        const result = await asyncFn();
        return result;
    } finally {
        // Restore original state
        buttonEl.disabled = originalDisabled;
        buttonEl.replaceChildren(...originalChildren);
        buttonEl.classList.remove('is-loading');
    }
}

/**
 * Set loading content on button
 * If button has .btn-text span, update only that span's text
 * Otherwise replace entire content with loading text
 */
function setLoadingContent(buttonEl, loadingText) {
    const textSpan = buttonEl.querySelector('.btn-text');
    if (textSpan) {
        // Button has dedicated text span - only update text, keep other elements
        textSpan.textContent = loadingText;
    } else {
        // No text span - replace entire content
        buttonEl.textContent = loadingText;
    }
}

export default withLoading;
