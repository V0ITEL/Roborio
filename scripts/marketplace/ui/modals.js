'use strict';

export function openModal(modal) {
    if (!modal) return;
    modal.__triggerEl = document.activeElement;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
}

export function closeModal(modal) {
    if (!modal) return;
    if (modal.contains(document.activeElement)) {
        modal.__triggerEl?.focus?.();
        if (modal.contains(document.activeElement)) {
            document.body.focus?.();
        }
    }
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

export function closeAllModals() {
    document.querySelectorAll('.marketplace-modal.active').forEach((modal) => closeModal(modal));
}
