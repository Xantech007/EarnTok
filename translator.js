const LANGUAGE_KEY = 'earntok-translation-language';
const LANGUAGES = [
    ['ar', 'Arabic'], ['bn', 'Bengali'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
    ['nl', 'Dutch'], ['en', 'English (original)'], ['fr', 'French'], ['de', 'German'], ['el', 'Greek'],
    ['gu', 'Gujarati'], ['ha', 'Hausa'], ['hi', 'Hindi'], ['id', 'Indonesian'], ['it', 'Italian'],
    ['ja', 'Japanese'], ['ko', 'Korean'], ['ms', 'Malay'], ['fa', 'Persian'], ['pl', 'Polish'],
    ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['ru', 'Russian'], ['es', 'Spanish'], ['sw', 'Swahili'],
    ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'],
    ['ur', 'Urdu'], ['vi', 'Vietnamese'], ['yo', 'Yoruba'], ['zu', 'Zulu']
];

const savedLanguage = localStorage.getItem(LANGUAGE_KEY) || '';

function setTranslateCookie(language) {
    document.cookie = `googtrans=/en/${language}; path=/; max-age=31536000; SameSite=Lax`;
}

function clearTranslateCookie() {
    document.cookie = 'googtrans=; path=/; max-age=0; SameSite=Lax';
    const hostname = location.hostname;
    if (hostname.includes('.')) {
        document.cookie = `googtrans=; path=/; domain=.${hostname.split('.').slice(-2).join('.')}; max-age=0; SameSite=Lax`;
    }
}

function loadGoogleTranslate() {
    if (window.google?.translate?.TranslateElement || document.getElementById('earntok-google-translate-script')) return;
    window.googleTranslateElementInit = () => {
        if (!window.google?.translate?.TranslateElement) return;
        new window.google.translate.TranslateElement({
            pageLanguage: 'en',
            includedLanguages: LANGUAGES.filter(([code]) => code !== 'en').map(([code]) => code).join(','),
            autoDisplay: false
        }, 'earntok-google-translate');
    };
    const script = document.createElement('script');
    script.id = 'earntok-google-translate-script';
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onerror = () => {
        const message = document.getElementById('earntok-translate-status');
        if (message) {
            message.textContent = 'Translation could not load. Check your connection and try again.';
            message.classList.remove('hidden');
        }
    };
    document.head.append(script);
}

const style = document.createElement('style');
style.textContent = `
    #earntok-translate-modal { position: fixed; inset: 0; z-index: 9998; display: none; align-items: center; justify-content: center; padding: 1rem; background: rgb(0 0 0 / 50%); }
    #earntok-translate-modal.is-open { display: flex; }
    #earntok-translate-card { width: min(100%, 26rem); max-height: 85dvh; overflow-y: auto; border-radius: 1.25rem; background: #fff; color: #18181b; box-shadow: 0 24px 70px rgb(0 0 0 / 25%); }
    #earntok-translate-select { width: 100%; border: 1px solid #d4d4d8; border-radius: .75rem; background: white; padding: .75rem; color: #18181b; }
    #earntok-google-translate, .goog-te-gadget { position: fixed !important; left: -10000px !important; top: -10000px !important; width: 1px !important; height: 1px !important; overflow: hidden !important; }
    .goog-te-banner-frame, .goog-te-balloon-frame, #goog-gt-tt { display: none !important; }
    body { top: 0 !important; }
`;
document.head.append(style);

const modal = document.createElement('div');
modal.id = 'earntok-translate-modal';
modal.setAttribute('aria-hidden', 'true');
modal.innerHTML = `<section id="earntok-translate-card" role="dialog" aria-modal="true" aria-labelledby="earntok-translate-title">
    <div class="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div><h2 id="earntok-translate-title" class="text-lg font-bold">Translate this page</h2><p class="mt-1 text-xs text-zinc-500">Your choice applies across EarnTok pages.</p></div>
        <button id="earntok-translate-close" type="button" class="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" aria-label="Close language settings">✕</button>
    </div>
    <div class="space-y-4 p-5">
        <label class="block text-sm font-semibold">Translate to
            <select id="earntok-translate-select" class="mt-2">
                ${LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}
            </select>
        </label>
        <p id="earntok-translate-status" class="hidden rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="status"></p>
        <p class="text-xs leading-5 text-zinc-500">Translation is provided by Google Translate. When enabled, Google may process page text to provide the translation. Original text and media may not translate perfectly.</p>
        <div class="flex flex-wrap justify-end gap-2">
            <button id="earntok-translate-off" class="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50" type="button">Turn translation off</button>
            <button id="earntok-translate-apply" class="rounded-full bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600" type="button">Apply language</button>
        </div>
    </div>
</section>`;
document.body.append(modal);
document.body.insertAdjacentHTML('beforeend', '<div id="earntok-google-translate" aria-hidden="true"></div>');

const languageSelect = document.getElementById('earntok-translate-select');
languageSelect.value = savedLanguage || 'en';
function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
}
function openModal() {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    languageSelect.value = localStorage.getItem(LANGUAGE_KEY) || 'en';
}

document.querySelectorAll('[data-open-translator]').forEach(button => {
    button.addEventListener('click', openModal);
});
document.getElementById('earntok-translate-close').addEventListener('click', closeModal);
modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
});
document.getElementById('earntok-translate-apply').addEventListener('click', () => {
    const language = languageSelect.value;
    if (language === 'en') {
        localStorage.removeItem(LANGUAGE_KEY);
        clearTranslateCookie();
    } else {
        localStorage.setItem(LANGUAGE_KEY, language);
        setTranslateCookie(language);
    }
    closeModal();
    location.reload();
});
document.getElementById('earntok-translate-off').addEventListener('click', () => {
    localStorage.removeItem(LANGUAGE_KEY);
    clearTranslateCookie();
    closeModal();
    location.reload();
});

if (savedLanguage && savedLanguage !== 'en') loadGoogleTranslate();
