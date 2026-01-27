/* ============================================
   ROBORIO - i18n loader
   ============================================ */

(function() {
    'use strict';

    const translations = {};
    const availableLangs = ['en'];
    let currentLang = 'en';
    let loadingPromise = null;

    function getStoredLang() {
        const savedLang = localStorage.getItem('roborio-lang');
        return availableLangs.includes(savedLang) ? savedLang : 'en';
    }

    function loadTranslations(lang) {
        if (translations[lang]) {
            return Promise.resolve(translations[lang]);
        }

        if (!loadingPromise) {
            loadingPromise = fetch(`i18n/${lang}.json`, { cache: 'no-store' })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to load translations for ${lang}`);
                    }
                    return response.json();
                })
                .then(data => {
                    translations[lang] = data;
                    return data;
                })
                .catch(error => {
                    console.error('[i18n] Failed to load translations:', error);
                    return null;
                });
        }

        return loadingPromise;
    }

    function applyTranslations(lang) {
        return loadTranslations(lang).then(t => {
            if (!t) return;

            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (!key || !t[key]) return;

                if (el.tagName === 'INPUT') {
                    el.placeholder = t[key];
                } else {
                    el.textContent = t[key];
                }
            });
        });
    }

    function initLanguageToggle() {
        const toggles = [
            document.getElementById('langToggle'),
            document.getElementById('langToggleMobile')
        ];

        currentLang = getStoredLang();
        toggles.forEach(t => {
            if (t) t.textContent = currentLang.toUpperCase();
        });

        applyTranslations(currentLang);

        if (availableLangs.length < 2) {
            return;
        }

        toggles.forEach(toggle => {
            if (!toggle) return;
            toggle.addEventListener('click', () => {
                const nextIndex = (availableLangs.indexOf(currentLang) + 1) % availableLangs.length;
                currentLang = availableLangs[nextIndex];
                toggles.forEach(t => { if (t) t.textContent = currentLang.toUpperCase(); });
                localStorage.setItem('roborio-lang', currentLang);
                applyTranslations(currentLang);
            });
        });
    }

    window.initLanguageToggle = initLanguageToggle;
    window.applyTranslations = applyTranslations;
})();