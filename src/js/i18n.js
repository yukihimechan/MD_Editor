/**
 * i18n.js - 多言語対応モジュール
 *
 * ビルド時に <script id="locale-data"> タグとして index.html へインライン統合されます。
 * 翻訳データを読み込み、グローバル関数 t(key) を提供します。
 *
 * 使用例:
 *   showToast(t('toast.saved'));
 *   btn.textContent = t('code.copyButton');
 *
 * キーはドット区切りで指定します:
 *   'section.key'  例: 'toast.saved', 'menu.file'
 */

const I18n = (() => {
    let _locales = {};
    let _currentLang = 'ja';
    let _languageNames = {}; // { 'ja': '日本語', 'en': 'English' }

    /**
     * 言語を登録する
     * @param {string} langCode - 言語コード (例: 'ja')
     * @param {string} langName - 表示名 (例: '日本語')
     * @param {Object} data - 翻訳データ
     */
    function register(langCode, langName, data) {
        _locales[langCode] = data;
        _languageNames[langCode] = langName;
        console.log(`[i18n] Language registered: ${langCode} (${langName})`);
    }

    /**
     * 初期化: 
     * ビルド版では <script id="locale-data"> にデータが注入されることがあるため、
     * それが存在する場合はJSONとしてパースして一括登録する。
     */
    async function init() {
        const el = document.getElementById('locale-data');
        const raw = el ? el.textContent.trim() : '';

        if (raw) {
            try {
                const bundled = JSON.parse(raw);
                // ビルド版のデータ形式に合わせて登録
                Object.keys(bundled).forEach(code => {
                    // ビルド版のJSONには言語名が含まれていない可能性があるため、
                    // キー名などを元に推測するか、別途管理が必要
                    const name = code === 'ja' ? '日本語' : (code === 'en' ? 'English' : code);
                    register(code, name, bundled[code]);
                });
            } catch (e) {
                console.error('[i18n] ロケールデータのパースに失敗しました:', e);
            }
        }

        // localStorageから言語設定を復元
        const savedLang = localStorage.getItem('mdEditor_lang');
        if (savedLang && _locales[savedLang]) {
            _currentLang = savedLang;
        }

        console.log(`[i18n] 現在の言語: ${_currentLang}`);
    }

    function setLang(lang) {
        if (!_locales[lang]) {
            console.warn(`[i18n] 未対応の言語コードです: ${lang}`);
            return;
        }
        _currentLang = lang;
        localStorage.setItem('mdEditor_lang', lang);
        if (typeof applyTranslations === 'function') applyTranslations();
    }

    function getLang() {
        return _currentLang;
    }

    function getAvailableLangs() {
        return Object.keys(_locales);
    }

    /**
     * 登録されている言語のリスト（コードと名称）を返す
     * @returns {Object} { 'ja': '日本語', ... }
     */
    function getLanguageNames() {
        return _languageNames;
    }

    function translate(key, params) {
        const parts = key.split('.');
        // 現在の言語 -> 日本語 (フォールバック) -> キー名 の順で探索
        let value = navigateObject(_locales[_currentLang], parts)
            ?? navigateObject(_locales['ja'], parts)
            ?? key;

        if (params && typeof value === 'string') {
            Object.keys(params).forEach(k => {
                value = value.replace(new RegExp(`{{${k}}}`, 'g'), params[k]);
            });
        }

        return value;
    }

    function navigateObject(obj, parts) {
        if (!obj) return undefined;
        let current = obj;
        for (const part of parts) {
            if (current[part] === undefined) return undefined;
            current = current[part];
        }
        return typeof current === 'string' ? current : undefined;
    }

    return { init, register, setLang, getLang, getAvailableLangs, getLanguageNames, translate };
})();

// グローバル関数 t() として公開（既存コードから使いやすいよう短縮名で）
window.t = (key, params) => I18n.translate(key, params);
window.I18n = I18n;

/**
 * data-i18n 属性を持つ要素へ翻訳テキストを適用する
 * 属性値はキー文字列（例: data-i18n="toolbar.file"）
 * data-i18n-attr が指定されている場合は textContent ではなくその属性値を変更する
 * （例: data-i18n-attr="placeholder" data-i18n="search.placeholder"）
 */
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const attr = el.getAttribute('data-i18n-attr');
        const value = I18n.translate(key);
        if (attr) {
            el.setAttribute(attr, value);
        } else {
            el.textContent = value;
        }
    });
}

// グローバルに公開
window.applyTranslations = applyTranslations;

