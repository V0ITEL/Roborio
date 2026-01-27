'use strict';

import notify from './ui/notify.js';
import { withLoading } from './ui/withLoading.js';
import { safeFetch } from './utils/safeFetch.js';
import { log } from './utils/logger.js';

export function initWaitlist() {
    const form = document.getElementById('waitlistForm');
    const success = document.getElementById('waitlistSuccess');

    if (!form || !success) return;

    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

       
        if (!navigator.onLine) {
            notify.error("You're offline. Please go online and try again.");
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
                notify.success('Successfully joined the waitlist!');

            } catch (error) {
                log.error('[Waitlist]', 'API error:', error);

                let errorMessage = error.message || 'Failed to join waitlist. Please try again.';

                
                if (errorMessage.includes('already registered') || errorMessage.includes('Email already')) {
                    errorMessage = 'This email is already on the waitlist!';
                }

                notify.error(errorMessage);
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