window.I18n = (function () {
    'use strict';

    const LANGS = ['ru', 'en'];
    const DEFAULT_LANG = 'en';
    const STORAGE_KEY = 'ct-lang';
    const FILE_BY_LANG = { ru: 'russian.json', en: 'english.json' };

    let currentLang = DEFAULT_LANG;
    let dict = {};

    function getNested(obj, path) {
        return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    }

    async function load(lang) {
        if (!LANGS.includes(lang)) lang = DEFAULT_LANG;
        try {
            const res = await fetch('./lang/' + FILE_BY_LANG[lang], { cache: 'no-cache' });
            if (!res.ok) throw new Error('Lang file not found: ' + FILE_BY_LANG[lang]);
            const data = await res.json();
            if (!data || typeof data !== 'object') throw new Error('Invalid language file');
            dict = data;
            currentLang = lang;
            try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* private mode */ }
            document.documentElement.setAttribute('lang', lang);
            apply();
            return true;
        } catch (e) {
            console.warn('[i18n]', e.message);
            if (lang !== DEFAULT_LANG) return load(DEFAULT_LANG);
            return false;
        }
    }

    function t(key, fallback) {
        const value = getNested(dict, key);
        if (value !== undefined && value !== null) return value;
        return fallback !== undefined ? fallback : key;
    }

    function apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const value = getNested(dict, el.getAttribute('data-i18n'));
            if (value !== undefined) el.textContent = value;
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const value = getNested(dict, el.getAttribute('data-i18n-placeholder'));
            if (value !== undefined) el.setAttribute('placeholder', value);
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const value = getNested(dict, el.getAttribute('data-i18n-title'));
            if (value !== undefined) el.setAttribute('title', value);
        });

        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const value = getNested(dict, el.getAttribute('data-i18n-aria-label'));
            if (value !== undefined) el.setAttribute('aria-label', value);
        });

        document.querySelectorAll('[data-i18n-content]').forEach(el => {
            const value = getNested(dict, el.getAttribute('data-i18n-content'));
            if (value !== undefined) el.setAttribute('content', value);
        });

        document.querySelectorAll('[data-lang]').forEach(btn => {
            const isActive = btn.dataset.lang === currentLang;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });

        document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { lang: currentLang } }));
    }

    function getLang() {
        return currentLang;
    }

    function showWelcomeModal() {
        const modal = document.getElementById('langModal');
        if (!modal) return;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        modal.inert = false;
        document.body.classList.add('modal-open');
        const first = modal.querySelector('.lang-modal-btn');
        if (first) setTimeout(() => first.focus(), 250);
    }

    function hideWelcomeModal() {
        const modal = document.getElementById('langModal');
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            modal.inert = true;
        }
        document.body.classList.remove('modal-open');
    }

    function init() {
        let saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }
        if (!saved) {
            showWelcomeModal();
            return load(DEFAULT_LANG);
        }
        return load(saved);
    }

    function bindEvents() {
        document.querySelectorAll('.lang-modal-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await load(btn.dataset.lang);
                hideWelcomeModal();
            });
        });

        const globeBtn = document.getElementById('globeBtn');
        const dropdown = document.getElementById('langDropdown');
        if (globeBtn && dropdown) {
            const closeDropdown = () => {
                dropdown.classList.remove('open');
                globeBtn.classList.remove('active');
                globeBtn.setAttribute('aria-expanded', 'false');
            };

            globeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropdown.classList.toggle('open');
                globeBtn.classList.toggle('active', isOpen);
                globeBtn.setAttribute('aria-expanded', String(isOpen));
            });

            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target) && !globeBtn.contains(e.target)) closeDropdown();
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dropdown.classList.contains('open')) {
                    closeDropdown();
                    globeBtn.focus();
                }
            });

            document.querySelectorAll('.lang-dropdown-item').forEach(item => {
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await load(item.dataset.lang);
                    closeDropdown();
                });
            });
        }
    }

    return { init, t, apply, getLang, load, bindEvents, hideWelcomeModal };
})();
