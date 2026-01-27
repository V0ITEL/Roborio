/**
 * Toast notification module
 * Uses existing toast styles from main.css
 * API: success(text), error(text), info(text)
 */

const TOAST_DURATION = 4000;

function getContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function createToast(message, type = 'info') {
    const container = getContainer();

    const toast = document.createElement('div');
    // Use existing class names: .toast, .toast.success, .toast.error
    toast.className = `toast ${type}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'toast-message';
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => removeToast(toast);

    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => removeToast(toast), TOAST_DURATION);

    return toast;
}

function removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

export function success(message) {
    return createToast(message, 'success');
}

export function error(message) {
    return createToast(message, 'error');
}

export function info(message) {
    return createToast(message, 'info');
}

export default { success, error, info };
