'use strict';

import en from '../i18n/en.json';

const translations = { en };
const availableLangs = ['en'];
let currentLang = 'en';

function getStoredLang() {
    const savedLang = localStorage.getItem('roborio-lang');
    return availableLangs.includes(savedLang) ? savedLang : 'en';
}

export function applyTranslations(lang) {
    const t = translations[lang];
    if (!t) return;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key || !t[key]) return;

        if (el.tagName === 'INPUT') {
            el.placeholder = t[key];
        } else {
            el.textContent = t[key];
        }
    });
}

export function initLanguageToggle() {
    const toggles = [
        document.getElementById('langToggle'),
        document.getElementById('langToggleMobile')
    ];

    currentLang = getStoredLang();
    toggles.forEach((t) => {
        if (t) t.textContent = currentLang.toUpperCase();
    });

    applyTranslations(currentLang);

    if (availableLangs.length < 2) {
        return;
    }

    toggles.forEach((toggle) => {
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            const nextIndex = (availableLangs.indexOf(currentLang) + 1) % availableLangs.length;
            currentLang = availableLangs[nextIndex];
            toggles.forEach((t) => { if (t) t.textContent = currentLang.toUpperCase(); });
            localStorage.setItem('roborio-lang', currentLang);
            applyTranslations(currentLang);
        });
    });
}

export function getCurrentLang() {
    return currentLang;
}
