'use strict';

import notify from './ui/notify.js';
import { withLoading } from './ui/withLoading.js';
import { safeFetch } from './utils/safeFetch.js';
import { log } from './utils/logger.js';

export function initWaitlist() {
    const form = document.getElementById('waitlistForm');
    const success = document.getElementById('waitlistSuccess');
    const confirmModal = document.getElementById('waitlistConfirmModal');

    if (!form || !success) return;

    function closeConfirmModal() {
        if (!confirmModal) return;
        confirmModal.classList.remove('show');
        confirmModal.setAttribute('aria-hidden', 'true');
        if (window.location.hash.includes('waitlist?status=')) {
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
    }

    function openConfirmModal() {
        if (!confirmModal) return;
        confirmModal.classList.add('show');
        confirmModal.setAttribute('aria-hidden', 'false');
        setTimeout(() => closeConfirmModal(), 10000);
    }

    if (confirmModal) {
        confirmModal.querySelectorAll('[data-confirm-close]').forEach((btn) => {
            btn.addEventListener('click', () => closeConfirmModal());
        });
    }

    const hash = window.location.hash || '';
    const statusMatch = hash.match(/waitlist\\?status=([^&]+)/);
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
        const email = emailInput.value.trim();

        
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
                    body: JSON.stringify({ email: sanitizedEmail }),
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
