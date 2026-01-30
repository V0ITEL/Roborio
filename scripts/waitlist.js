'use strict';

import notify from './ui/notify.js';
import { withLoading } from './ui/withLoading.js';
import { safeFetch } from './utils/safeFetch.js';
import { log } from './utils/logger.js';

export function initWaitlist() {
    const form = document.getElementById('waitlistForm');
    const success = document.getElementById('waitlistSuccess');
    let confirmModal = document.getElementById('waitlistConfirmModal');
    let confirmOverlay = document.getElementById('waitlistConfirmOverlay');

    if (!form || !success) return;

    function ensureConfirmModal() {
        if (confirmModal && confirmOverlay) {
            if (confirmOverlay.parentNode !== document.body) document.body.appendChild(confirmOverlay);
            if (confirmModal.parentNode !== document.body) document.body.appendChild(confirmModal);
            return confirmModal;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'waitlistConfirmOverlay';
        overlay.setAttribute('aria-hidden', 'true');

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'waitlistConfirmModal';
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const header = document.createElement('div');
        header.className = 'modal-header';

        const title = document.createElement('h3');
        title.className = 'modal-title';
        title.textContent = 'Email confirmed';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.setAttribute('data-confirm-close', '');
        closeBtn.textContent = 'x';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';

        const hero = document.createElement('div');
        hero.className = 'waitlist-confirm-hero';

        const icon = document.createElement('div');
        icon.className = 'waitlist-confirm-icon';
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

        const desc = document.createElement('p');
        desc.className = 'waitlist-confirm-desc';
        desc.textContent = 'You are on the waitlist.';

        const cta = document.createElement('button');
        cta.className = 'btn btn-primary btn-full';
        cta.type = 'button';
        cta.setAttribute('data-confirm-close', '');
        cta.textContent = 'Back to site';

        hero.appendChild(icon);
        hero.appendChild(desc);
        body.appendChild(hero);
        body.appendChild(cta);

        modal.appendChild(header);
        modal.appendChild(body);

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        confirmModal = modal;
        confirmOverlay = overlay;

        [confirmOverlay, confirmModal].forEach((el) => {
            el.querySelectorAll('[data-confirm-close]').forEach((btn) => {
                btn.addEventListener('click', () => closeConfirmModal());
            });
        });

        confirmOverlay.addEventListener('click', () => closeConfirmModal());

        return confirmModal;
    }

    function closeConfirmModal() {
        if (confirmModal) {
            confirmModal.classList.remove('active');
            confirmModal.setAttribute('aria-hidden', 'true');
        }
        if (confirmOverlay) {
            confirmOverlay.classList.remove('active');
            confirmOverlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('waitlist-confirm-open');
        if (window.location.hash.includes('waitlist?status=')) {
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
    }

    function openConfirmModal() {
        confirmModal = ensureConfirmModal();
        if (!confirmModal) return;
        confirmModal.classList.add('active');
        confirmModal.setAttribute('aria-hidden', 'false');
        if (confirmOverlay) {
            confirmOverlay.classList.add('active');
            confirmOverlay.setAttribute('aria-hidden', 'false');
        }
        document.body.classList.add('waitlist-confirm-open');
        setTimeout(() => closeConfirmModal(), 10000);
    }

    if (confirmModal) {
        confirmModal.querySelectorAll('[data-confirm-close]').forEach((btn) => {
            btn.addEventListener('click', () => closeConfirmModal());
        });
    }

    const hash = window.location.hash || '';
    const statusMatch = hash.match(/waitlist\?status=([^&]+)/);
    if (statusMatch && statusMatch[1]) {
        const status = decodeURIComponent(statusMatch[1]);
        if (status === 'confirmed') {
            openConfirmModal();
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeConfirmModal();
            }, { once: true });
        } else if (status === 'expired') {
            notify.error('Confirmation link expired. Please sign up again.');
        } else if (status === 'invalid') {
            notify.error('Invalid confirmation link.');
        } else if (status === 'error') {
            notify.error('Could not confirm. Please try again later.');
        }
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

       
        if (!navigator.onLine) {
            notify.error('No internet connection');
            return;
        }

        const emailInput = form.querySelector('input[type="email"]');
        const submitBtn = form.querySelector('button[type="submit"]');
        const segmentInput = form.querySelector('input[name="waitlistSegment"]:checked');
        const email = emailInput.value.trim();
        const segment = segmentInput ? segmentInput.value : 'business';

        
        if (!email) {
            emailInput.setCustomValidity('Email is required');
            emailInput.reportValidity();
            return;
        }

        if (!emailRegex.test(email)) {
            emailInput.setCustomValidity('Please enter a valid email address');
            emailInput.reportValidity();
            return;
        }

        
        const sanitizedEmail = email.replace(/[<>]/g, '');

        
        if (sanitizedEmail.length > 254) {
            emailInput.setCustomValidity('Email address is too long');
            emailInput.reportValidity();
            return;
        }

        
        emailInput.setCustomValidity('');

        await withLoading(submitBtn, async () => {
            try {
                const { data } = await safeFetch('/api/waitlist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: sanitizedEmail, segment }),
                });

                log.info('[Waitlist]', 'Signup successful:', sanitizedEmail);
                form.style.display = 'none';
                success.classList.add('show');
                if (data?.message) {
                    success.textContent = data.message;
                }
                notify.success("Check your email");

            } catch (error) {
                log.error('[Waitlist]', 'API error:', error);

                // Check for specific error cases, otherwise show generic message
                const errMsg = error.message || '';
                if (errMsg.includes('already registered') || errMsg.includes('Email already')) {
                    notify.error('Email already on the list');
                } else {
                    notify.error('Something went wrong. Please try again.');
                }
            }
        }, { loadingText: 'Sending...' });
    });

    
    const emailInput = form.querySelector('input[type="email"]');
    if (emailInput) {
        emailInput.addEventListener('input', function() {
            this.setCustomValidity('');
        });
    }
}
