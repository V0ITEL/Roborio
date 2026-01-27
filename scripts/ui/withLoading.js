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

    // Save original state
    const originalText = getButtonText(buttonEl);
    const originalDisabled = buttonEl.disabled;

    // Set loading state
    buttonEl.disabled = true;
    setButtonText(buttonEl, loadingText);
    buttonEl.classList.add('is-loading');

    try {
        const result = await asyncFn();
        return result;
    } finally {
        // Restore original state
        buttonEl.disabled = originalDisabled;
        setButtonText(buttonEl, originalText);
        buttonEl.classList.remove('is-loading');
    }
}

/**
 * Get button text (handles nested .btn-text span)
 */
function getButtonText(buttonEl) {
    const textSpan = buttonEl.querySelector('.btn-text');
    if (textSpan) {
        return textSpan.textContent;
    }
    return buttonEl.textContent;
}

/**
 * Set button text (handles nested .btn-text span)
 */
function setButtonText(buttonEl, text) {
    const textSpan = buttonEl.querySelector('.btn-text');
    if (textSpan) {
        textSpan.textContent = text;
    } else {
        buttonEl.textContent = text;
    }
}

export default withLoading;
