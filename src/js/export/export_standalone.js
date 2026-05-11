/**
 * export_standalone.js
 * エディタ同梱スタンドアロンHTMLエクスポート機能
 * Tauri版では内部アセット（tauri://localhost/）からMD_Editor.htmlを動的に再構築します。
 *
 * 重要: このファイル内ではscriptタグやbodyタグをリテラルに直接記述しないこと。
 * build.ps1 でMD_Editor.htmlにインライン化する際、HTMLパーサが誤動作するため。
 * 代わりに '<' + 'script' のように文字列を分割して記述すること。
 */

// HTMLタグ定数（直接リテラルに書くとインライン化時に壊れるため分割定義）
const _ES_S_OPEN     = '<' + 'script';  // scriptタグ開始
const _ES_S_CLOSE    = '</' + 'script' + '>'; // scriptタグ終了
const _ES_BODY_CLOSE = '</' + 'body' + '>';   // bodyタグ終了

const ExportStandalone = {

    // --- 進捗ダイアログ用ヘルパー ---
    _progressDialog: null,
    _progressBar: null,
    _progressText: null,

    _showProgress(message, percent = 0) {
        if (!this._progressDialog) {
            this._progressDialog = document.getElementById('dialog-standalone-progress');
            this._progressBar     = document.getElementById('standalone-progress-bar');
            this._progressText    = document.getElementById('standalone-progress-text');
        }
        if (this._progressDialog && !this._progressDialog.open) {
            this._progressDialog.showModal();
        }
        if (this._progressBar)  this._progressBar.style.width = `${percent}%`;
        if (this._progressText) this._progressText.textContent = message;
    },

    _closeProgress() {
        if (this._progressDialog && this._progressDialog.open) {
            this._progressDialog.close();
        }
    },

    async run() {
        try {
            this._showProgress('準備中...', 0);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            // 1. 現在のMarkdownテキストを取得
            let mdText = '';
            if (window.editorInstance) {
                mdText = window.editorInstance.state.doc.toString();
            } else if (AppState && AppState.text) {
                mdText = AppState.text;
            }

            // 2. ローカル画像パスをBase64に変換（Tauri環境のみ）
            this._showProgress('画像を変換中...', 5);
            mdText = await this.convertLocalImages(mdText);

            // 3. MarkdownをBase64エンコード（日本語対応）
            const encodedMd = btoa(encodeURIComponent(mdText));

            // 4. テンプレートHTMLを取得
            this._showProgress('HTMLを構築中...', 10);
            const templateHtml = await this.fetchTemplateHtml();
            if (!templateHtml) {
                this._closeProgress();
                if (typeof showToast === 'function') showToast('テンプレートHTMLの取得に失敗しました。', 'error');
                return;
            }

            // 5. bodyタグ直前に埋め込みタグを挿入
            // 注意: _ES_S_OPEN/_ES_S_CLOSE を使用（タグのリテラル直書き禁止）
            // 注意: replace() ではなく lastIndexOf() を使う。
            //       DOMPurify等のJSコード内に bodyタグの閉じタグ文字列が含まれており、
            //       replace() だとそちらを先に置換してしまうため。
            this._showProgress('Markdownを埋め込み中...', 95);
            const embeddedTag = '\n' + _ES_S_OPEN + ' id="embedded-markdown" type="text/plain">' + encodedMd + _ES_S_CLOSE + '\n';
            const lastBodyIdx = templateHtml.lastIndexOf(_ES_BODY_CLOSE);
            let outputHtml;
            if (lastBodyIdx !== -1) {
                outputHtml = templateHtml.slice(0, lastBodyIdx) + embeddedTag + templateHtml.slice(lastBodyIdx);
            } else {
                // bodyタグ終了が見つからない場合は末尾に追加
                outputHtml = templateHtml + embeddedTag;
            }

            // 6. ファイルとして保存
            this._showProgress('保存中...', 98);
            await this.saveFile(outputHtml);

        } catch (err) {
            console.error('[ExportStandalone] Error:', err);
            if (typeof showToast === 'function') showToast('エクスポート中にエラーが発生しました。', 'error');
        } finally {
            this._closeProgress();
        }
    },

    /**
     * Markdownテキスト内のローカル画像パスをBase64データURIに変換します。
     */
    async convertLocalImages(mdText) {
        if (!window.__TAURI__) return mdText;

        const { fs, path } = window.__TAURI__;
        const imagePattern = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g;

        let match;
        const replacements = new Map();

        while ((match = imagePattern.exec(mdText)) !== null) {
            const rawPath = match[1] || match[2];
            if (!rawPath || rawPath.startsWith('http') || rawPath.startsWith('data:')) continue;
            if (!replacements.has(rawPath)) replacements.set(rawPath, null);
        }

        for (const [imgPath] of replacements) {
            try {
                let resolvedPath = imgPath;
                if (AppState && AppState.fileDirectory && !imgPath.match(/^[A-Za-z]:|^\//)) {
                    resolvedPath = await path.join(AppState.fileDirectory, imgPath);
                }
                const binary   = await fs.readFile(resolvedPath);
                const ext      = resolvedPath.split('.').pop().toLowerCase();
                const mimeMap  = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml' };
                const mimeType = mimeMap[ext] || 'application/octet-stream';
                let binaryStr  = '';
                const bytes    = new Uint8Array(binary);
                for (let i = 0; i < bytes.byteLength; i++) binaryStr += String.fromCharCode(bytes[i]);
                replacements.set(imgPath, `data:${mimeType};base64,${btoa(binaryStr)}`);
            } catch (err) {
                console.warn('[ExportStandalone] Could not convert image:', imgPath, err);
            }
        }

        for (const [orig, dataUrl] of replacements) {
            if (dataUrl) mdText = mdText.split(orig).join(dataUrl);
        }
        return mdText;
    },

    /**
     * テンプレートHTMLを取得します。
     * Tauri版: 内部アセットから再構築（最優先）→ ファイル検索 → ダイアログ
     * ブラウザ版: fetch('./MD_Editor.html') → ファイル入力
     */
    async fetchTemplateHtml() {
        if (window.__TAURI__) {
            // 1. 内部アセットから動的に再構築（MD_Editor.htmlが不要）
            try {
                const html = await this._buildFromTauriAssets();
                if (html) return html;
            } catch (err) {
                console.warn('[ExportStandalone] Asset reconstruction failed, trying file-based:', err);
            }

            // 2. ファイルシステムから MD_Editor.html を探す
            const { fs, path } = window.__TAURI__;
            const candidateBaseDirs = [];
            try { candidateBaseDirs.push(await path.currentDir()); }  catch (_) {}
            try { candidateBaseDirs.push(await path.resourceDir()); } catch (_) {}

            for (const baseDir of candidateBaseDirs) {
                for (const rel of ['MD_Editor.html', '../MD_Editor.html']) {
                    try {
                        const candidate = await path.join(baseDir, rel).catch(() => null);
                        if (!candidate) continue;
                        if (await fs.exists(candidate)) {
                            console.log('[ExportStandalone] Template found at:', candidate);
                            return await fs.readTextFile(candidate);
                        }
                    } catch (_) {}
                }
            }

            // 3. ダイアログで選択
            try {
                const { dialog } = window.__TAURI__;
                if (typeof showToast === 'function') showToast('MD_Editor.html を選択してください', 'info');
                const selected = await dialog.open({
                    title: 'MD_Editor.html を選択してください',
                    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
                    multiple: false
                });
                if (selected) return await fs.readTextFile(selected);
            } catch (err) {
                console.error('[ExportStandalone] Dialog failed:', err);
            }
            return null;
        }

        // --- ブラウザ環境 ---
        // 1. 現在のページ自体をテンプレートとして使う
        //    注意: outerHTML のテキスト検索は使わない。
        //    インライン化されたJSのソース内に同名の文字列リテラルが存在し誤検知するため。
        //    DOM APIで実際の要素の有無を確認することで正確に判定する。
        const hasEmbeddedMd = document.getElementById('embedded-markdown') !== null;
        if (!hasEmbeddedMd) {
            // 進捗ダイアログをいったん閉じてからouterHTMLを取得する。
            // ダイアログが open 状態のまま outerHTML を取得すると、
            // エクスポート先のHTMLを起動したときにダイアログが表示されてしまうため。
            this._closeProgress();
            const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
            this._showProgress('HTMLを構築中...', 10);
            return html;
        }

        // 2. fetch で MD_Editor.html を取得（http/https 環境向け）


        try {
            const response = await fetch('./MD_Editor.html');
            if (response.ok) {
                const html = await response.text();
                if (!html.includes('id="embedded-markdown"')) {
                    return html;
                }
            }
        } catch (_) {}

        // 3. ファイル選択ダイアログ（最終フォールバック）
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type   = 'file';
            input.accept = '.html,.htm';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                resolve(file ? await file.text() : null);
            };
            input.oncancel = () => resolve(null);
            input.click();
        });
    },

    /**
     * Tauri内部アセット（tauri://localhost/）からHTMLを再構築します。
     * build.ps1 のインライン化ロジックをJavaScriptで再実装しています。
     */
    async _buildFromTauriAssets() {
        const base = window.location.origin;

        this._showProgress('index.html を取得中...', 12);
        const res = await fetch(`${base}/index.html`);
        if (!res.ok) throw new Error(`Cannot fetch index.html: ${res.status}`);
        let html = await res.text();

        this._showProgress('CSS をインライン化中...', 20);
        html = await this._inlineStylesheets(html, base);

        this._showProgress('ロケールデータを処理中...', 80);
        html = await this._inlineLocaleData(html, base);

        this._showProgress('JavaScript をインライン化中...', 85);
        html = await this._inlineScripts(html, base);

        console.log('[ExportStandalone] HTML successfully rebuilt from Tauri assets.');
        return html;
    },

    async _inlineStylesheets(html, base) {
        const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
        const links     = [...html.matchAll(linkRegex)];
        const total     = links.length;

        // </style> エスケープ用（リテラル直書き禁止のため文字列で構築）
        const styleCloseRx  = new RegExp('<' + '/style>', 'gi');
        const styleCloseEsc = '<\\' + '/style>';

        for (let i = 0; i < links.length; i++) {
            const fullTag   = links[i][0];
            const hrefMatch = /href=["']([^"']+)["']/.exec(fullTag);
            if (!hrefMatch) continue;

            const href    = hrefMatch[1];
            const cssUrl  = new URL(href, base + '/').href;
            const percent = 20 + Math.round((i / total) * 55);
            this._showProgress(`CSS: ${href.split('/').pop()}`, percent);
            await new Promise(r => requestAnimationFrame(r));

            try {
                const cssRes = await fetch(cssUrl);
                if (!cssRes.ok) continue;
                let css = await cssRes.text();
                css = await this._inlineCSSUrls(css, cssUrl);

                // </style>をエスケープ
                css = css.replace(styleCloseRx, styleCloseEsc);

                const idMatch = /id=["']([^"']+)["']/.exec(fullTag);
                const idAttr  = idMatch ? ` id="${idMatch[1]}"` : '';
                const inlined = `<style${idAttr}>\n${css}\n</style>`;
                html = html.replace(fullTag, () => inlined);
            } catch (err) {
                console.warn('[ExportStandalone] Could not inline CSS:', href, err);
            }
        }
        return html;
    },

    async _inlineCSSUrls(css, cssBaseUrl) {
        const urlRegex      = /url\(\s*(['"]?)(?!data:)([^'")\s]+)\1\s*\)/g;
        const matches       = [...css.matchAll(urlRegex)];
        const uniqueRelUrls = [...new Set(matches.map(m => m[2]))];

        for (const relUrl of uniqueRelUrls) {
            const cleanUrl = relUrl.replace(/[#?].*$/, '');
            try {
                const fullUrl = new URL(cleanUrl, cssBaseUrl).href;
                const res     = await fetch(fullUrl);
                if (!res.ok) continue;
                const blob    = await res.blob();
                const dataUri = await this._blobToBase64(blob);

                css = css.split(`url(${relUrl})`).join(`url('${dataUri}')`);
                css = css.split(`url('${relUrl}')`).join(`url('${dataUri}')`);
                css = css.split(`url("${relUrl}")`).join(`url('${dataUri}')`);
            } catch (_) {}
        }
        return css;
    },

    async _inlineLocaleData(html, base) {
        // 注意: _ES_S_OPEN/_ES_S_CLOSE を使用（リテラル直書き禁止）
        const placeholder = _ES_S_OPEN + ' id="locale-data" type="application/json">' + _ES_S_CLOSE;
        if (!html.includes(placeholder)) return html;

        // ロケールJSファイルのsrcを収集
        const localeRx    = new RegExp(_ES_S_OPEN + '[^>]+src=["\']([^"\']*js/locales/[^"\']+\\.js)["\'][^>]*>' + _ES_S_CLOSE, 'g');
        const localeFiles = [...html.matchAll(localeRx)].map(m => m[1]);

        const parts = [];
        for (const localeFile of localeFiles) {
            const langCode = localeFile.split('/').pop().replace('.js', '');
            try {
                const localeUrl = new URL(localeFile, base + '/').href;
                const jsText    = await fetch(localeUrl).then(r => r.text());
                const match     = /I18n\.register\(['"][^'"]+['"],\s*['"][^'"]+['"],\s*(\{[\s\S]*\})\);/.exec(jsText);
                if (match) parts.push(`"${langCode}": ${match[1].trim()}`);
            } catch (err) {
                console.warn('[ExportStandalone] Could not inline locale:', localeFile, err);
            }
        }

        if (parts.length > 0) {
            const localeJson    = `{\n${parts.join(',\n')}\n}`;
            const inlinedLocale = _ES_S_OPEN + ' id="locale-data" type="application/json">\n' + localeJson + '\n' + _ES_S_CLOSE;
            html = html.replace(placeholder, () => inlinedLocale);
            // 個別のロケールscriptタグを削除
            const localeTagRx = new RegExp(_ES_S_OPEN + '[^>]+src=["\'][^"\']*js/locales/[^"\']+\\.js["\'][^>]*>' + _ES_S_CLOSE, 'g');
            html = html.replace(localeTagRx, '');
        }
        return html;
    },

    async _inlineScripts(html, base) {
        // 注意: _ES_S_OPEN/_ES_S_CLOSE を使用（リテラル直書き禁止）
        const scriptTagRx  = new RegExp(_ES_S_OPEN + '\\s+[^>]*src=["\']([^"\']+)["\'][^>]*>' + _ES_S_CLOSE, 'gi');
        const scripts      = [...html.matchAll(scriptTagRx)];
        const total        = scripts.length;
        const scriptCloRx  = new RegExp(_ES_S_CLOSE, 'gi');
        const scriptCloEsc = '<\\' + '/script>';

        for (let i = 0; i < scripts.length; i++) {
            const fullTag = scripts[i][0];
            const src     = scripts[i][1];
            const percent = 85 + Math.round((i / total) * 8);
            this._showProgress(`JS: ${src.split('/').pop()}`, percent);
            await new Promise(r => requestAnimationFrame(r));

            const scriptUrl = new URL(src, base + '/').href;
            try {
                let js = await fetch(scriptUrl).then(r => r.text());

                // scriptタグの閉じタグをエスケープ（HTMLパーサがスクリプトを途中で終了させるのを防ぐ）
                js = js.replace(scriptCloRx, scriptCloEsc);

                // String.replace()の$特殊文字対策としてアロー関数を使用
                const inlined = _ES_S_OPEN + '>\n' + js + '\n' + _ES_S_CLOSE;
                html = html.replace(fullTag, () => inlined);
            } catch (err) {
                console.warn('[ExportStandalone] Could not inline JS:', src, err);
            }
        }
        return html;
    },

    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror   = reject;
            reader.readAsDataURL(blob);
        });
    },

    /**
     * 生成したHTMLをファイルとして保存します。
     */
    async saveFile(htmlContent) {
        const baseName   = (AppState && AppState.filePath) ? AppState.filePath.replace(/\.[^/.]+$/, '') : 'document';
        const defaultName = `${baseName}_export.html`;

        if (window.__TAURI__) {
            const { dialog, fs } = window.__TAURI__;
            const savePath = await dialog.save({
                title: 'HTMLとして保存',
                defaultPath: defaultName,
                filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
            });
            if (savePath) {
                await fs.writeTextFile(savePath, htmlContent);
                if (typeof showToast === 'function') showToast(`保存しました: ${savePath}`, 'success');
            }
        } else {
            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = defaultName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('ダウンロードを開始しました。', 'success');
        }
    }
};

window.ExportStandalone = ExportStandalone;
