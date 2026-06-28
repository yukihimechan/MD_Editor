/**
 * Markdown Rendering & Processing
 */

// --- Global Markdown Instance ---
let md = null;

// --- Shared IntersectionObserver for Prism Highlight ---
let _prismHighlightObserver = null;

function getPrismObserver() {
    if (!_prismHighlightObserver && window.IntersectionObserver) {
        _prismHighlightObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const code = entry.target.querySelector('code[class*="language-"]');
                    if (code) {
                        try { Prism.highlightElement(code); } catch (e) {}
                    }
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '300px' });
    }
    return _prismHighlightObserver;
}

function resetPrismObserver() {
    if (_prismHighlightObserver) {
        _prismHighlightObserver.disconnect();
    }
}

// [NEW] Disable Prism auto-highlighting to prevent it from scanning the editor area
if (typeof Prism !== 'undefined') {
    Prism.manual = true;
}

/**
 * Setup Markdown-it configuration
 */
function setupMarkdownIt() {
    if (typeof window.markdownit !== 'undefined') {
        md = window.markdownit({
            html: true,       // Enable HTML tags in source
            xhtmlOut: false,  // Use '/' to close single tags (<br />).
            breaks: true,     // Convert '\n' in paragraphs to <br>
            langPrefix: 'language-',  // CSS language prefix for fenced blocks
            linkify: true,    // Autoconvert URL-like text to links

            // Highlighting: let Prism handle it in post-process to keep consistent with existing logic
            // or we could integrate here. For now, keep post-process.
            highlight: function (str, lang) {
                // Return null to use default escaping
                return null;
            }
        });

        // Load Plugins
        if (typeof window.markdownItFrontMatterPlugin !== 'undefined') {
            md.use(window.markdownItFrontMatterPlugin);
        }
        if (typeof window.markdownitTaskLists !== 'undefined') {
            md.use(window.markdownitTaskLists, { enabled: true });
        }
        if (typeof window.markdownitEmoji !== 'undefined') {
            md.use(window.markdownitEmoji);
        }

        // --- LaTeX (texmath + katex) Integration ---
        if (typeof window.texmath !== 'undefined' && typeof window.katex !== 'undefined') {
            md.use(window.texmath, {
                engine: window.katex,
                delimiters: 'dollars',
                katexOptions: { macros: { "\\RR": "\\mathbb{R}" } }
            });
        }

        // --- Line Number Injection ---
        // Override renderer rules to inject data-line
        const injectLine = (tokens, idx, options, env, slf) => {
            if (tokens[idx].map && tokens[idx].level === 0) {
                // map[0] is 0-based line number. We want 1-based.
                tokens[idx].attrSet('data-line', String(tokens[idx].map[0] + 1));
            }
            return slf.renderToken(tokens, idx, options, env, slf);
        };

        const blockTypes = [
            'paragraph_open',
            'heading_open',
            'bullet_list_open',
            'ordered_list_open',
            'list_item_open',
            'blockquote_open',
            'table_open',
            'fence',
            'code_block',
            'math_block',
            'math_block_eqno',
            'hr'
        ];

        blockTypes.forEach(type => {
            // Check if rule exists (like fence), if not use renderToken
            const original = md.renderer.rules[type];
            md.renderer.rules[type] = (tokens, idx, options, env, slf) => {
                if (type === 'fence' || type === 'code_block') {
                    console.debug(`[MarkdownIt][Debug] rules[${type}] called. Has map:`, !!tokens[idx].map, tokens[idx].map);
                }
                if (tokens[idx].map) {
                    const startLine = tokens[idx].map[0] + 1;
                    const endLine = tokens[idx].map[1];
                    tokens[idx].attrSet('data-line', String(startLine));
                    tokens[idx].attrSet('data-line-end', String(endLine));
                }
                if (original) {
                    let html = original(tokens, idx, options, env, slf);
                    if (type === 'fence' || type === 'code_block') {
                        console.debug(`[MarkdownIt][Debug] original html:`, html);
                    }
                    // texmath rules as well as fence and code_block do not respect tokens[idx].attrs, so we manually inject data-line
                    if ((type === 'math_block' || type === 'math_block_eqno' || type === 'fence' || type === 'code_block') && tokens[idx].map) {
                        const startLine = tokens[idx].map[0] + 1;
                        const endLine = tokens[idx].map[1];
                        if (type === 'fence' || type === 'code_block') {
                            html = html.replace(/<pre\b/i, `<pre data-line="${startLine}" data-line-end="${endLine}"`);
                            console.debug(`[MarkdownIt][Debug] replaced html:`, html);
                        } else {
                            html = html.replace(/^\s*<([a-zA-Z0-9]+)/, `<$1 data-line="${startLine}" data-line-end="${endLine}"`);
                        }
                    }
                    return html;
                }
                return slf.renderToken(tokens, idx, options, env, slf);
            };
        });

        // --- Image & Link Rule Overrides ---
        // Save original src/href for Tauri path resolution
        const defaultImageRender = md.renderer.rules.image || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.image = function (tokens, idx, options, env, self) {
            const token = tokens[idx];
            const srcIdx = token.attrIndex('src');
            if (srcIdx >= 0) {
                const src = token.attrs[srcIdx][1];
                token.attrSet('data-original-src', src);
            }
            
            // ▼▼▼ 追加: ブラウザネイティブの遅延読み込みと非同期デコード ▼▼▼
            token.attrSet('loading', 'lazy');
            token.attrSet('decoding', 'async');
            // ▲▲▲ 追加ここまで ▲▲▲

            return defaultImageRender(tokens, idx, options, env, self);
        };

        const defaultLinkRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
            const token = tokens[idx];
            const hrefIdx = token.attrIndex('href');
            if (hrefIdx >= 0) {
                const href = token.attrs[hrefIdx][1];
                token.attrSet('data-original-href', href);

                // HTML版では常に別タブで開くように target="_blank" を追加
                if (!window.__TAURI__) {
                    token.attrSet('target', '_blank');
                    token.attrSet('rel', 'noopener noreferrer');
                }
            }
            return defaultLinkRender(tokens, idx, options, env, self);
        };

        // [NEW] Intercept html_block to attach data-lines to raw SVGs for the "Prepare Edit (Wrap)" feature
        const defaultHtmlBlock = md.renderer.rules.html_block || function (tokens, idx, options, env, self) {
            return tokens[idx].content;
        };
        md.renderer.rules.html_block = function (tokens, idx, options, env, self) {
            const token = tokens[idx];
            const content = token.content.trim();
            if (content.toLowerCase().startsWith('<svg') && token.map) {
                const startLine = token.map[0] + 1;
                const endLine = token.map[1];
                // Wrap raw svg in a div container with line data so it can be targeted by UI and sync mechanisms
                return `<div class="raw-svg-container" data-line="${startLine}" data-line-end="${endLine}">${token.content}</div>`;
            }
            return defaultHtmlBlock(tokens, idx, options, env, self);
        };

        // [NEW] Export fully configured instance for reuse (e.g. by docx_export.js)
        window.markdownItInstance = md;

    } else {
        console.error('Markdown-it library not found');
    }
}

// Ensure setup is called
if (typeof md === 'undefined' || md === null) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMarkdownIt);
    } else {
        setupMarkdownIt();
    }
}

// --- Rendering ---
let _renderPromise = null;
let _renderPending = false;
let _lastRenderedText = null;

// [NEW] 超高速ハッシュ関数（ブロックの変更検知に使用）
const cyrb53 = function(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097152 & h2) + (h1>>>0);
};

// [NEW] 小文字化されたインラインSVGタグ名を正しい大文字（キャメルケース）に復元する
function restoreSvgCamelCaseTags(html) {
    if (!html) return html;
    const replacements = {
        'clippath': 'clipPath',
        'fegaussianblur': 'feGaussianBlur',
        'feoffset': 'feOffset',
        'fedropshadow': 'feDropShadow',
        'feblend': 'feBlend',
        'fecolormatrix': 'feColorMatrix',
        'feflood': 'feFlood',
        'femerge': 'feMerge',
        'femergenode': 'feMergeNode',
        'lineargradient': 'linearGradient',
        'radialgradient': 'radialGradient',
        'textpath': 'textPath',
        'animatemotion': 'animateMotion',
        'animatetransform': 'animateTransform'
    };
    let res = html;
    for (const [lower, camel] of Object.entries(replacements)) {
        res = res.replace(new RegExp(`<${lower}(\\s|/|>)`, 'gi'), `<${camel}$1`);
        res = res.replace(new RegExp(`</${lower}>`, 'gi'), `</${camel}>`);
    }
    return res;
}

// [NEW] プレビュー内のすべてのインラインSVGタグ名をキャメルケースに修正・復元する
function fixAllInlineSvgCamelCase(root) {
    if (!root) return;
    const svgs = root.querySelectorAll('svg');
    svgs.forEach(svg => {
        if (svg.getAttribute('data-svg-camel-fixed') === 'true') {
            // すでに data-svg-camel-fixed="true" が付着して保存されている場合でも、実際には小文字タグが残っているなら修復を試みる
            const hasLowercase = svg.querySelector('clippath, fegaussianblur, feoffset, fedropshadow, feblend, fecolormatrix, feflood, femerge, femergenode, lineargradient, radialgradient, textpath, animatemotion, animatetransform');
            if (!hasLowercase) return;
        }
        
        const originalHtml = svg.outerHTML;
        const fixedHtml = restoreSvgCamelCaseTags(originalHtml);
        if (originalHtml !== fixedHtml) {
            const temp = document.createElement('div');
            temp.innerHTML = fixedHtml;
            const newSvg = temp.firstElementChild;
            if (newSvg && svg.parentNode) {
                newSvg.setAttribute('data-svg-camel-fixed', 'true');
                if (svg.closest('.svg-editing')) {
                    const defs = svg.querySelector('defs');
                    if (defs) {
                        const originalDefsHtml = defs.outerHTML;
                        const fixedDefsHtml = restoreSvgCamelCaseTags(originalDefsHtml);
                        if (originalDefsHtml !== fixedDefsHtml) {
                            const tempDefs = document.createElement('div');
                            tempDefs.innerHTML = `<svg>${fixedDefsHtml}</svg>`;
                            const newDefs = tempDefs.firstElementChild ? tempDefs.firstElementChild.firstElementChild : null;
                            if (newDefs && defs.parentNode) {
                                defs.parentNode.replaceChild(newDefs, defs);
                            }
                        }
                    }
                    svg.setAttribute('data-svg-camel-fixed', 'true');
                } else {
                    svg.parentNode.replaceChild(newSvg, svg);
                }
            }
        } else {
            svg.setAttribute('data-svg-camel-fixed', 'true');
        }
    });
}

// [NEW] ブロック単位のDOMキャッシュ
window._blockCache = window._blockCache || new Map();

async function render(force = false) {
    if (_renderPromise) {
        _renderPending = true;
        return _renderPromise;
    }

    _renderPromise = (async () => {
        if (window._lastDocChangeTime) {
            console.log(`[Perf] ⌨ docChanged から render() 開始まで: ${(performance.now() - window._lastDocChangeTime).toFixed(1)}ms`);
            window._lastDocChangeTime = null; // リセット
        }
        if (window._lastGlobalKeydownTime) {
            console.log(`[Perf] ⌨ キー入力から render() 開始までの合計: ${(performance.now() - window._lastGlobalKeydownTime).toFixed(1)}ms`);
        }
        
        await new Promise(r => setTimeout(r, 20));

        while (true) {
            _renderPending = false;
            const renderStartTime = performance.now();
            const editing = typeof window.isSVGEditing === 'function' && window.isSVGEditing() && (!window.currentEditingSVG || !window.currentEditingSVG._isAnnotationLayerMock);

            if (!md && typeof setupMarkdownIt === 'function') setupMarkdownIt();
            if (!md || typeof DOMPurify === 'undefined') return;

            try {
                let rawText = getEditorText().replace(/\r\n/g, '\n');
                let text = rawText;

                // --- アノテーションデータをDOMPurify処理前に抽出する ---
                // <!-- ANNOTATION_DATA:...--> コメントをパースしてAnnotationLayerに渡す
                const ANNO_PATTERN = /\n?<!-- ANNOTATION_DATA:([\s\S]*?)-->/g;
                let annoSvgData = null;
                const textWithoutAnno = text.replace(ANNO_PATTERN, (match, p1) => {
                    annoSvgData = p1.trim();
                    return ''; // コメントをレンダリングから除外
                });
                if (text !== textWithoutAnno) {
                    // テキストが変化した場合のみAnnotationLayerを更新
                    if (typeof window.AnnotationLayer !== 'undefined' && annoSvgData) {
                        window.AnnotationLayer.loadSVGData(annoSvgData);
                    }
                    text = textWithoutAnno;
                } else {
                    // 注釈データなし: Ctrl+Z で注釈ブロックが消された可能性があるためクリア
                    if (typeof window.AnnotationLayer !== 'undefined'
                        && typeof window.AnnotationLayer.clearSilent === 'function') {
                        window.AnnotationLayer.clearSilent();
                    }
                }
                // -------------------------------------------------------

                if (!force && _lastRenderedText !== null && text === _lastRenderedText) {
                    break;
                }
                
                const previousText = _lastRenderedText;
                _lastRenderedText = text;
                // [FIX] エディタ全体の生テキストを維持する（プレビュー側のインライン編集などで全テキストが必要になるため）
                AppState.text = rawText;

                // 既存のPrismオブザーバーをリセットしてメモリリークを防ぐ
                resetPrismObserver();

                // アノテーションアンカーの行番号を差分で更新（DOM描画の前に実行）
                if (typeof AnnotationLayer !== 'undefined' && typeof AnnotationLayer.trackContentChange === 'function') {
                    AnnotationLayer.trackContentChange(rawText);
                }

                if (!text || text.trim() === '') {
                    if (DOM.preview) {
                        DOM.preview.innerHTML = '';
                        const dummyArea = document.createElement('div');
                        dummyArea.className = 'dummy-tail-block';
                        dummyArea.setAttribute('data-placeholder', typeof I18n !== 'undefined' ? I18n.translate('editor.placeholder') || 'テキストを追加、または \'/\' でコマンド' : 'テキストを追加、または \'/\' でコマンド');
                        DOM.preview.appendChild(dummyArea);
                    }
                    if (typeof updateOutline === 'function') updateOutline();
                    if (typeof updateWordCount === 'function') updateWordCount();
                    if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.restoreFocusIfNeeded === 'function') {
                        PreviewInlineEdit.restoreFocusIfNeeded();
                    }
                    return;
                }

                // ----------------------------------------------------
                // ★ 超絶特急ルート (Fast Path): 差分特定による O(1) 部分レンダリング ★
                // お客様のアイデアである「前回の値との比較」を具現化し、全体パースを全スキップします。
                // ----------------------------------------------------
                let fastPathSuccess = false;
                
                if (!force && previousText !== null && typeof md !== 'undefined') {
                    try {
                        const oldText = previousText;
                        const newText = text;
                        
                        // 1. 前回のテキストとの差分位置（開始・終了）を特定
                        let diffStart = 0;
                        const minLen = Math.min(oldText.length, newText.length);
                        while (diffStart < minLen && oldText[diffStart] === newText[diffStart]) diffStart++;
                        
                        let oldDiffEnd = oldText.length - 1;
                        let newDiffEnd = newText.length - 1;
                        while (oldDiffEnd >= diffStart && newDiffEnd >= diffStart && oldText[oldDiffEnd] === newText[newDiffEnd]) {
                            oldDiffEnd--; newDiffEnd--;
                        }
                        
                        // 変更が局所的（1万文字以内）な場合のみ Fast Path を発動
                        if ((newDiffEnd - diffStart) < 10000 && (oldDiffEnd - diffStart) < 10000) {
                            
                            // コードブロック内での分断を防ぐため、安全な境界かチェック
                            const isSafeBoundary = (str, index) => {
                                let btCount = 0, i = 0;
                                while ((i = str.indexOf('```', i)) !== -1) {
                                    if (i > index) break;
                                    if (i === 0 || str[i-1] === '\n') btCount++;
                                    i += 3;
                                }
                                return btCount % 2 === 0;
                            };

                            // [FIX] ルーズリスト内の \n\n はリスト項目の区切りであり、ブロック境界ではない。
                            // \n\n の直後がリスト項目（- , * , + , 数字. ）の場合はスキップして次の境界を探す。
                            const isListContinuation = (str, pos) => {
                                // pos は \n\n の位置。pos+2 以降の行頭を調べる
                                const afterPos = pos + 2;
                                if (afterPos >= str.length) return false;
                                // インデント（スペース/タブ）を含むリスト項目にもマッチ
                                const lineStart = str.substring(afterPos, Math.min(afterPos + 20, str.length));
                                return /^[ \t]*([-*+]|\d+\.)\s/.test(lineStart);
                            };

                            // 2. 変更箇所を包含する安全なブロック（空行 \n\n）を切り出す
                            let blockStart = oldText.lastIndexOf('\n\n', diffStart);
                            // 変更箇所(diffStart)に \n\n が食い込んでいる場合は無視してさらに前方の \n\n を探す
                            // [FIX] ルーズリスト内の \n\n もスキップする
                            let _bsIter = 0;
                            while (blockStart !== -1 && (!isSafeBoundary(oldText, blockStart) || blockStart + 2 > diffStart || isListContinuation(oldText, blockStart))) {
                                _bsIter++;
                                if (_bsIter > 500) { console.error(`[render][FastPath] ⛔ blockStartループが500回を超えました blockStart=${blockStart}`); break; }
                                
                                // [BUGFIX] blockStart が 0 の場合、lastIndexOf(..., -1) は 0 扱いとなり無限ループするため -1 を明示
                                let nextSearchPos = blockStart - 1;
                                blockStart = nextSearchPos < 0 ? -1 : oldText.lastIndexOf('\n\n', nextSearchPos);
                            }
                            blockStart = blockStart === -1 ? 0 : blockStart + 2;
                            
                            // 変更の影響を受けていない「新旧共通の後方テキスト（サフィックス）」から安全な境界を検索する
                            let searchStartOld = oldDiffEnd + 1;
                            let blockEndOld = oldText.indexOf('\n\n', searchStartOld);
                            let _beIter = 0;
                            while (blockEndOld !== -1 && (!isSafeBoundary(oldText, blockEndOld) || isListContinuation(oldText, blockEndOld))) {
                                _beIter++;
                                if (_beIter > 500) { console.error(`[render][FastPath] ⛔ blockEndOldループが500回を超えました blockEndOld=${blockEndOld}`); break; }
                                blockEndOld = oldText.indexOf('\n\n', blockEndOld + 1);
                            }
                            if (blockEndOld === -1) blockEndOld = oldText.length;
                            
                            // サフィックスの長さは完全に一致するため、oldTextの末尾からの距離でnewTextの境界位置を正確に算出できる
                            const suffixLength = oldText.length - blockEndOld;
                            let blockEndNew = newText.length - suffixLength;
                            
                            // 編集によってコードブロック(```)の開閉状態が変化した場合、
                            // プレビュー全体が崩れるのを防ぐため、安全にFast Pathを中断し全体パースへ逃げる
                            if (blockEndNew < newText.length && !isSafeBoundary(newText, blockEndNew)) {
                                throw new Error("FASTPATH_ABORT_CODEBLOCK_PARITY_CHANGED");
                            }

                            // 切り出したブロックが適切なサイズか確認
                            if (blockStart !== -1 && blockEndNew !== -1 && blockEndOld !== -1 && (blockEndNew - blockStart) < 30000) {
                                
                                // 切り出したブロックの行番号を計算
                                let startLineNum = 1;
                                for (let i = 0; i < blockStart; i++) { if (newText[i] === '\n') startLineNum++; }
                                let oldEndLineNum = startLineNum;
                                for (let i = blockStart; i < blockEndOld; i++) { if (oldText[i] === '\n') oldEndLineNum++; }
                                let newEndLineNum = startLineNum;
                                for (let i = blockStart; i < blockEndNew; i++) { if (newText[i] === '\n') newEndLineNum++; }

                                const partialMarkdown = newText.substring(blockStart, blockEndNew);
                                const partialMarkdownOld = oldText.substring(blockStart, blockEndOld);
                                
                                // [FIX No.2] Fast Pathの中断条件を「変更ブロックがSVGの境界に触れる場合のみ」に緩和。
                                // 旧: SVGが含まれるだけで中断 → SVGとは無関係な編集でも毎回フルパースが走っていた。
                                // 新: ```svg フェンスまたは生 <svg タグの開始行が変更ブロックに含まれる場合のみ中断。
                                //     これにより、SVGコードブロック内部 or SVGブロック境界の変更のみフルパースに切り替わる。
                                //
                                // ★「古い側」にSVGフェンスが含まれる場合も中断が必要。
                                //    例: SVGブロックの後ろに見出しを追加すると、古い側のブロックにSVGフェンスが含まれ、
                                //    新しい側には含まれず、Fast PathがSVGノードを誤って削除する。
                                const svgFenceRe = /^```svg\s*$/m;
                                const rawSvgTagRe = /^[ \t]*<svg[\s>]/im;
                                const affectsSvgBoundary =
                                    svgFenceRe.test(partialMarkdown) || svgFenceRe.test(partialMarkdownOld) ||
                                    rawSvgTagRe.test(partialMarkdown) || rawSvgTagRe.test(partialMarkdownOld);

                                if (affectsSvgBoundary ||
                                    /data:image/i.test(partialMarkdown) || /data:image/i.test(partialMarkdownOld)) {
                                    throw new Error("FASTPATH_ABORT_HEAVY_ELEMENTS");
                                }

                                // 3. 変更されたブロック「だけ」をパース（これが 1〜2ms で終わる）
                                const partialHtml = md.render(partialMarkdown);
                                const tempDiv = document.createElement('div');
                                tempDiv.innerHTML = partialHtml;
                                
                                // 行番号の補正
                                const offsetLine = startLineNum - 1;
                                tempDiv.querySelectorAll('[data-line]').forEach(el => {
                                    const l = parseInt(el.getAttribute('data-line'), 10);
                                    el.setAttribute('data-line', l + offsetLine);
                                    if (el.hasAttribute('data-line-end')) {
                                        const le = parseInt(el.getAttribute('data-line-end'), 10);
                                        el.setAttribute('data-line-end', le + offsetLine);
                                    }
                                });

                                // 画面上の置換対象となるDOM要素の範囲を特定
                                const previewNodes = Array.from(DOM.preview.childNodes);
                                let targetStartIndex = -1;
                                let targetEndIndex = -1;
                                
                                // 高速化: querySelectorAll で data-line 要素をネイティブ抽出
                                const dataLineEls = DOM.preview.querySelectorAll(':scope > [data-line]');
                                
                                // 二分探索で startLineNum と oldEndLineNum に該当する要素を特定
                                let startEl = null;
                                let endEl = null;
                                
                                let left = 0;
                                let right = dataLineEls.length - 1;
                                while(left <= right) {
                                    const mid = Math.floor((left + right) / 2);
                                    const l = parseInt(dataLineEls[mid].getAttribute('data-line'), 10);
                                    if (l >= startLineNum) {
                                        startEl = dataLineEls[mid];
                                        right = mid - 1;
                                    } else {
                                        left = mid + 1;
                                    }
                                }
                                
                                left = 0;
                                right = dataLineEls.length - 1;
                                while(left <= right) {
                                    const mid = Math.floor((left + right) / 2);
                                    const l = parseInt(dataLineEls[mid].getAttribute('data-line'), 10);
                                    if (l <= oldEndLineNum) {
                                        endEl = dataLineEls[mid];
                                        left = mid + 1;
                                    } else {
                                        right = mid - 1;
                                    }
                                }

                                if (startEl) {
                                    const i = previewNodes.indexOf(startEl);
                                    let j = i;
                                    while(j > 0 && previewNodes[j-1].nodeType !== 1 && (!previewNodes[j-1].classList || !previewNodes[j-1].classList.contains('dummy-tail-block'))) j--;
                                    targetStartIndex = j;
                                }
                                
                                if (endEl) {
                                    const i = previewNodes.indexOf(endEl);
                                    let j = i;
                                    while (j + 1 < previewNodes.length && !(previewNodes[j+1].nodeType === 1 && previewNodes[j+1].hasAttribute('data-line')) && (!previewNodes[j+1].classList || !previewNodes[j+1].classList.contains('dummy-tail-block'))) {
                                        j++;
                                    }
                                    targetEndIndex = j;
                                }

                                // ファイル末尾への追記の場合の補正
                                if (targetStartIndex === -1 && startLineNum > oldEndLineNum) {
                                    targetStartIndex = previewNodes.length;
                                    if (previewNodes.length > 0 && previewNodes[previewNodes.length - 1].classList && previewNodes[previewNodes.length - 1].classList.contains('dummy-tail-block')) {
                                        targetStartIndex = previewNodes.length - 1;
                                    }
                                    targetEndIndex = targetStartIndex - 1;
                                }

                                if (targetStartIndex !== -1 && targetEndIndex !== -1 && targetStartIndex <= targetEndIndex + 1) {
                                    
                                    // 基本的な属性補正とサニタイズ
                                    tempDiv.querySelectorAll('img').forEach(img => {
                                        const src = img.getAttribute('src');
                                        if (src && !/^(http|https:|data:|blob:|file:)/i.test(src)) {
                                            img.setAttribute('data-original-src', src);
                                            img.removeAttribute('src');
                                        }
                                    });
                                    tempDiv.querySelectorAll('svg').forEach(svg => {
                                        if (!svg.getAttribute('width')) svg.setAttribute('width', '100%');
                                        if (!svg.getAttribute('height')) svg.setAttribute('height', '100%');
                                    });

                                    const purifyConfigFast = {
                                        ADD_TAGS: ['style', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'use', 'text', 'tspan', 'textPath', 'math', 'annotation', 'semantics', 'mrow', 'msub', 'msup', 'msubsup', 'mover', 'munder', 'munderover', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mtext', 'mi', 'mo', 'mn', 'mspace', 'ms', 'mglyph', 'mpadded', 'mphantom', 'menclose', 'mtable', 'mtr', 'mtd', 'maligngroup', 'malignmark', 'maction', 'marker', 'connector-data', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'feOffset', 'feDropShadow', 'feBlend', 'feColorMatrix', 'feFlood', 'feMerge', 'feMergeNode', 'animateMotion', 'mpath', 'image'],
                                        ADD_ATTR: ['rel', 'target', 'class', 'style', 'checked', 'type', 'start', 'viewBox', 'xmlns', 'd', 'fill', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'points', 'transform', 'data-original-src', 'data-original-href', 'id', 'opacity', 'font-family', 'font-size', 'text-anchor', 'dominant-baseline', 'href', 'xlink:href', 'data-line', 'data-line-end', 'display', 'encoding', 'accent', 'fence', 'separator', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'form', 'lspace', 'rspace', 'columnspan', 'rowspan', 'columnalign', 'rowalign', 'framespacing', 'columnlines', 'rowlines', 'frame', 'equalcolumns', 'equalrows', 'displaystyle', 'side', 'minlabelspacing', 'alignmentscope', 'alttext', 'overflow', 'scriptlevel', 'scriptsizemultiplier', 'scriptminize', 'dir', 'decimalpoint', 'columnspacing', 'rowspacing', 'data-tool-id', 'data-radius', 'data-spikes', 'data-sides', 'data-arrow-start', 'data-arrow-end', 'data-arrow-size', 'data-is-canvas', 'data-is-proxy', 'data-no-connector', 'data-original-id', 'data-connections', 'marker-start', 'marker-end', 'marker-mid', 'refX', 'refY', 'orient', 'markerWidth', 'markerHeight', 'data-paper-width', 'data-paper-height', 'data-paper-x', 'data-paper-y', 'data-internal', 'data-paper-zoom', 'data-paper-offx', 'data-paper-offy', 'data-poly-points', 'data-bez-points', 'data-text-highlight', 'data-align-h', 'data-align-v', 'data-writing-mode', 'data-line-spacing', 'data-original-text', 'data-block-hash', 'vector-effect', 'clip-path', 'clip-rule', 'fill-rule', 'offset', 'stop-color', 'stop-opacity', 'filter', 'gradientUnits', 'stdDeviation', 'in', 'result', 'dur', 'repeatCount', 'rotate', 'tabindex', 'data-sync-id'],
                                        FORBID_TAGS: ['iframe', 'object', 'embed', 'base'],
                                        IN_PLACE: true,
                                        ADD_DATA_URI_TAGS: ['img', 'image']
                                    };
                                    
                                    if (typeof DOMPurify !== 'undefined') DOMPurify.sanitize(tempDiv, purifyConfigFast);
                                    if (typeof processHeadings === 'function') processHeadings(tempDiv);
                                    if (typeof processListItems === 'function') processListItems(tempDiv);
                                    if (typeof processTables === 'function') processTables(tempDiv);
                                    if (typeof processCodeBlocks === 'function') processCodeBlocks(tempDiv);
                                    
                                    if (tempDiv.querySelector('.language-mermaid') && typeof processMermaidDiagrams === 'function') await processMermaidDiagrams(tempDiv);
                                    if (typeof processSVGBlocks === 'function') processSVGBlocks(tempDiv);
                                    if (tempDiv.querySelector('img') && typeof processImages === 'function') await processImages(tempDiv);
                                    if (tempDiv.querySelector('a[data-original-href]') && typeof processLinks === 'function') await processLinks(tempDiv);
                                    if (typeof processExternalImages === 'function') processExternalImages(tempDiv);
                                    if (typeof processFoldableElements === 'function') processFoldableElements(tempDiv);
                                    
                                    // 4. 古いDOMを削除し、新しいDOMをピンポイントで挿入
                                    for (let i = targetStartIndex; i <= targetEndIndex; i++) {
                                        if (previewNodes[i].parentNode) DOM.preview.removeChild(previewNodes[i]);
                                    }
                                    
                                    const refNode = previewNodes[targetEndIndex + 1] || null;
                                    const fragment = document.createDocumentFragment();
                                    while(tempDiv.firstChild) {
                                        fragment.appendChild(tempDiv.firstChild);
                                    }

                                    if (refNode && refNode.parentNode === DOM.preview) DOM.preview.insertBefore(fragment, refNode);
                                    else {
                                        const dummy = DOM.preview.querySelector('.dummy-tail-block');
                                        if (dummy) DOM.preview.insertBefore(fragment, dummy);
                                        else DOM.preview.appendChild(fragment);
                                    }
                                    
                                    // 5. 追加/削除された行数に応じて、後続のDOM要素の行番号をシフトする
                                    const lineDelta = newEndLineNum - oldEndLineNum;
                                    if (lineDelta !== 0) {
                                        // ▼修正: 非同期(requestAnimationFrame)を外し、即時同期反映させる
                                        // （高速タイピング時に次回のFast Pathが古い行番号を読み取ってDOMを破壊する競合バグを防止）
                                        let node = refNode;
                                        while (node) {
                                            if (node.nodeType === 1 && node.parentNode === DOM.preview && !node.classList?.contains('dummy-tail-block')) {
                                                const l = parseInt(node.getAttribute('data-line'), 10);
                                                if (!isNaN(l)) node.setAttribute('data-line', l + lineDelta);
                                                
                                                const le = parseInt(node.getAttribute('data-line-end'), 10);
                                                if (!isNaN(le)) node.setAttribute('data-line-end', le + lineDelta);
                                                
                                                node.querySelectorAll('[data-line]').forEach(el => {
                                                    const cl = parseInt(el.getAttribute('data-line'), 10);
                                                    el.setAttribute('data-line', cl + lineDelta);
                                                    const cle = parseInt(el.getAttribute('data-line-end'), 10);
                                                    if (!isNaN(cle)) el.setAttribute('data-line-end', cle + lineDelta);
                                                });
                                            }
                                            node = node.nextSibling;
                                        }
                                    }
                                    fastPathSuccess = true;
                                }
                            }
                        }
                    } catch (err) {
                        if (err.message !== "FASTPATH_ABORT_HEAVY_ELEMENTS") {
                            console.warn("Fast Path Partial Render failed, falling back to full render:", err);
                        }
                    }
                }

                // Fast Path が成功した場合は処理をここで打ち切り、150msのフルパースを回避！
                if (fastPathSuccess) {
                    // [FIX] FastPathが成功したため、デバウンスタイマーの2回目のrender() is不要。
                    if (typeof debounceTimer !== 'undefined') clearTimeout(debounceTimer);

                    const _postA = performance.now();

                    // 入力時のラグを完全に消滅させるため、二次的な重いDOM全走査処理を非同期（裏タスク）に回す
                    requestAnimationFrame(() => {
                        const postStart = performance.now();
                        
                        let globalCodeIndex = 0;
                        DOM.preview.querySelectorAll('.code-block-wrapper').forEach(el => el.setAttribute('data-code-index', globalCodeIndex++));
                        let globalSvgIndex = 0;
                        DOM.preview.querySelectorAll('.svg-view-wrapper').forEach(el => el.setAttribute('data-svg-index', globalSvgIndex++));

                        if (typeof fixAllInlineSvgCamelCase === 'function') {
                            fixAllInlineSvgCamelCase(DOM.preview);
                        }

                        if (typeof attachPreviewEvents === 'function') attachPreviewEvents();
                        if (typeof attachCopyButtonListeners === 'function') attachCopyButtonListeners();
                        if (typeof attachSVGSaveListeners === 'function') attachSVGSaveListeners();
                        if (typeof attachSVGToggleListeners === 'function') attachSVGToggleListeners();
                        if (typeof attachExternalSVGListeners === 'function') attachExternalSVGListeners();
                        if (typeof attachExternalPaintListeners === 'function') attachExternalPaintListeners();
                        if (typeof attachImageResizeListeners === 'function') attachImageResizeListeners();
                        if (typeof attachTableEvents === 'function') attachTableEvents();

                        // before_srcではrestoreFocusは非同期(rAF)内で実行される
                        const _postB_1 = performance.now();
                        if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.restoreFocusIfNeeded === 'function') PreviewInlineEdit.restoreFocusIfNeeded();
                        const _postB_2 = performance.now();

                        if (AppState.searchState && AppState.searchState.matches.length > 0) if (typeof highlightPreviewMatches === 'function') highlightPreviewMatches();
                        // アノテーションのアンカーをレンダリング直後に更新
                        if (typeof AnnotationLayer !== 'undefined' && typeof AnnotationLayer.updateAnchors === 'function') AnnotationLayer.updateAnchors();
                        
                        // SVGアニメーションの再開
                        if (typeof window.startAllSvgAnimations === 'function') {
                            setTimeout(() => {
                                window.startAllSvgAnimations(DOM.preview);
                            }, 100);
                        }
                        
                        const postTime = performance.now() - postStart;
                        console.log(`[Perf][Renderer] FastPath requestAnimationFrame listeners took ${postTime.toFixed(1)}ms (restoreFocus=${(_postB_2 - _postB_1).toFixed(1)}ms)`);
                        
                        if (window._lastGlobalKeydownTime) {
                            console.log(`[Perf] ⌨ キー入力からプレビュー反映完了までの総時間(FastPath + Async): ${(performance.now() - window._lastGlobalKeydownTime).toFixed(1)}ms`);
                            window._lastGlobalKeydownTime = null;
                        }
                    });
                    const _postC = performance.now();
                    
                    if (typeof updateScrollMap === 'function') setTimeout(() => updateScrollMap(), 50);
                    if (typeof updateOutline === 'function') setTimeout(() => updateOutline(), 100);
                    if (typeof buildSvgList === 'function') setTimeout(() => buildSvgList(), 150);
                    const _postD = performance.now();
                    if (typeof updateWordCount === 'function') updateWordCount();
                    const _postE = performance.now();
                    if (typeof schedulePageBreakDisplay === 'function') schedulePageBreakDisplay();
                    const _postF = performance.now();

                    console.log(`[Perf][PostFastPath] restoreFocus=0.0ms (rAF内非同期), rAFSetup=${(_postC - _postA).toFixed(1)}ms, scrollMapEtc=${(_postD - _postC).toFixed(1)}ms, updateWordCount=${(_postE - _postD).toFixed(1)}ms, pageBreak=${(_postF - _postE).toFixed(1)}ms, total=${(_postF - _postA).toFixed(1)}ms`);
                    console.log(`[Perf][Renderer] FastPath render() END at ${(performance.now() - renderStartTime).toFixed(1)}ms`);
                    
                    _renderPending = false;
                    break;
                }

                // 1. Markdown-it Rendering (プレーンHTMLへのパースはミリ秒で終わる)
                let html = md.render(text);
                if (typeof applyFrontMatterOverrides === 'function') applyFrontMatterOverrides();

                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // ▼▼ 高速化1: 正規表現をDOM APIに置換 ▼▼
                doc.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && !/^(http|https:|data:|blob:|file:)/i.test(src)) {
                        img.setAttribute('data-original-src', src);
                        img.removeAttribute('src');
                    }
                });
                doc.querySelectorAll('svg').forEach(svg => {
                    const w = svg.getAttribute('width');
                    const h = svg.getAttribute('height');
                    if (w !== null && w.trim() === '') svg.setAttribute('width', '100%');
                    if (h !== null && h.trim() === '') svg.setAttribute('height', '100%');
                });
                // ▲▲ 高速化1 ここまで ▲▲
                
                // ▼▼▼ 高速化: ブロック単位のキャッシュとサニタイズ ▼▼▼
                // ▼▼▼ 超・究極高速化: ハッシュ比較とディープキャッシュ（プレースホルダ方式） ▼▼▼
                const childNodes = Array.from(doc.body.childNodes);
                const currentBlockHashes = new Set();
                
                const purifyConfig = {
                    ADD_TAGS: ['style', 'input', 'label', 'li', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'use', 'text', 'tspan', 'textPath', 'math', 'annotation', 'semantics', 'mrow', 'msub', 'msup', 'msubsup', 'mover', 'munder', 'munderover', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mtext', 'mi', 'mo', 'mn', 'mspace', 'ms', 'mglyph', 'mpadded', 'mphantom', 'menclose', 'mtable', 'mtr', 'mtd', 'maligngroup', 'malignmark', 'maction', 'marker', 'connector-data', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'feOffset', 'feDropShadow', 'feBlend', 'feColorMatrix', 'feFlood', 'feMerge', 'feMergeNode', 'animateMotion', 'mpath', 'image'],
                    ADD_ATTR: ['rel', 'target', 'class', 'style', 'checked', 'type', 'start', 'viewBox', 'xmlns', 'd', 'fill', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'points', 'transform', 'data-original-src', 'data-original-href', 'id', 'opacity', 'font-family', 'font-size', 'text-anchor', 'dominant-baseline', 'href', 'xlink:href', 'data-line', 'data-line-end', 'display', 'encoding', 'accent', 'fence', 'separator', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'form', 'lspace', 'rspace', 'columnspan', 'rowspan', 'columnalign', 'rowalign', 'framespacing', 'columnlines', 'rowlines', 'frame', 'equalcolumns', 'equalrows', 'displaystyle', 'side', 'minlabelspacing', 'alignmentscope', 'alttext', 'overflow', 'scriptlevel', 'scriptsizemultiplier', 'scriptminize', 'dir', 'decimalpoint', 'columnspacing', 'rowspacing', 'data-tool-id', 'data-radius', 'data-spikes', 'data-sides', 'data-arrow-start', 'data-arrow-end', 'data-arrow-size', 'data-is-canvas', 'data-is-proxy', 'data-no-connector', 'data-original-id', 'data-connections', 'marker-start', 'marker-end', 'marker-mid', 'refX', 'refY', 'orient', 'markerWidth', 'markerHeight', 'data-paper-width', 'data-paper-height', 'data-paper-x', 'data-paper-y', 'data-internal', 'data-paper-zoom', 'data-paper-offx', 'data-paper-offy', 'data-poly-points', 'data-bez-points', 'data-text-highlight', 'data-align-h', 'data-align-v', 'data-writing-mode', 'data-line-spacing', 'data-placeholder-id', 'data-original-text', 'data-block-hash', 'vector-effect', 'clip-path', 'clip-rule', 'fill-rule', 'offset', 'stop-color', 'stop-opacity', 'filter', 'gradientUnits', 'stdDeviation', 'in', 'result', 'dur', 'repeatCount', 'rotate', 'tabindex', 'data-sync-id'],
                    FORBID_TAGS: ['iframe', 'object', 'embed', 'base'],
                    IN_PLACE: true,
                    ADD_DATA_URI_TAGS: ['img', 'image']
                };

                const processorDiv = document.createElement('div');
                const finalNodesData = [];
                const pendingElements = []; // { placeholder, cachedNode }

                const processNode = (el) => {
                    if (el.nodeType !== Node.ELEMENT_NODE) return { cached: false, node: el.cloneNode(true), hashKey: null };
                    
                    const dataLine = el.getAttribute('data-line');
                    const dataLineEnd = el.getAttribute('data-line-end');
                    
                    // 正規表現での置換を廃止し、DOM APIで一時的に外して純粋なコンテンツのハッシュを作る(爆速)
                    if (dataLine) el.removeAttribute('data-line');
                    if (dataLineEnd) el.removeAttribute('data-line-end');
                    const oldHash = el.getAttribute('data-block-hash');
                    if (oldHash) el.removeAttribute('data-block-hash');
                    
                    const rawHtml = el.outerHTML;
                    // ハッシュ生成の軽量化: 巨大なHTMLの場合は全体をハッシュ化せず、先頭/末尾/文字数を利用して計算量を削減
                    const hashInput = rawHtml.length > 2000 
                        ? rawHtml.substring(0, 1000) + '...' + rawHtml.substring(rawHtml.length - 1000) + '_' + rawHtml.length
                        : rawHtml;
                    const hashKey = el.tagName + '_' + cyrb53(hashInput);
                    currentBlockHashes.add(hashKey);
                    
                    // 属性を元に戻す
                    if (dataLine) el.setAttribute('data-line', dataLine);
                    if (dataLineEnd) el.setAttribute('data-line-end', dataLineEnd);
                    if (oldHash) el.setAttribute('data-block-hash', oldHash);
                    
                    if (!force && window._blockCache.has(hashKey)) {
                        const cachedNode = window._blockCache.get(hashKey).cloneNode(true);
                        
                        // 内部の行番号のズレを最新に同期
                        const newDesc = el.querySelectorAll('[data-line]');
                        const cachedDesc = cachedNode.querySelectorAll('[data-line]');
                        if (newDesc.length === cachedDesc.length) {
                            for (let j = 0; j < newDesc.length; j++) {
                                cachedDesc[j].setAttribute('data-line', newDesc[j].getAttribute('data-line'));
                                const dLineE = newDesc[j].getAttribute('data-line-end');
                                if (dLineE) cachedDesc[j].setAttribute('data-line-end', dLineE);
                                else cachedDesc[j].removeAttribute('data-line-end');
                            }
                        }

                        if (dataLine) cachedNode.setAttribute('data-line', dataLine);
                        else cachedNode.removeAttribute('data-line');
                        if (dataLineEnd) cachedNode.setAttribute('data-line-end', dataLineEnd);
                        else cachedNode.removeAttribute('data-line-end');
                        
                        return { cached: true, node: cachedNode, hashKey };
                    }
                    
                    return { cached: false, node: el, hashKey };
                };

                // リストやテーブルなど、奥深くまで生存確認を行うタグ
                const recursiveContainerTags = ['UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'THEAD', 'TR', 'LI', 'TD', 'TH', 'DETAILS', 'DIV'];

                const traverseAndExtractCached = (rawNode, parentClone) => {
                    Array.from(rawNode.childNodes).forEach(child => {
                        if (child.nodeType !== Node.ELEMENT_NODE) {
                            parentClone.appendChild(child.cloneNode(true));
                            return;
                        }
                        
                        if (recursiveContainerTags.includes(parentClone.tagName.toUpperCase())) {
                            const result = processNode(child);
                            if (result.cached) {
                                // キャッシュヒット：重い処理(DOMPurify等)を回避するため、ダミーのプレースホルダを置く
                                const placeholder = document.createElement(child.tagName);
                                // 元の属性（style等）を引き継ぎ、後続のパースロジックを騙す
                                Array.from(child.attributes).forEach(attr => {
                                    placeholder.setAttribute(attr.name, attr.value);
                                });
                                const pid = Math.random().toString(36).substr(2, 9);
                                placeholder.setAttribute('data-placeholder-id', pid);
                                placeholder.className = (placeholder.className ? placeholder.className + ' ' : '') + 'cached-placeholder';
                                parentClone.appendChild(placeholder);
                                pendingElements.push({ placeholder, cachedNode: result.node });
                                return;
                            }
                        }
                        
                        // キャッシュミス、またはコンテナ以外の子要素
                        if (recursiveContainerTags.includes(child.tagName.toUpperCase())) {
                            const childClone = child.cloneNode(false);
                            parentClone.appendChild(childClone);
                            traverseAndExtractCached(child, childClone);
                        } else {
                            parentClone.appendChild(child.cloneNode(true));
                        }
                    });
                };

                for (const node of childNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        finalNodesData.push({ type: 'text', node: node.cloneNode(true) });
                        continue;
                    }
                    
                    const topResult = processNode(node);
                    
                    if (topResult.cached) {
                        finalNodesData.push({ type: 'cached', node: topResult.node });
                    } else {
                        // 変更あり。内部の変更されていない要素をプレースホルダに置き換えたツリーを作る
                        const containerClone = node.cloneNode(false);
                        traverseAndExtractCached(node, containerClone);
                        
                        containerClone.setAttribute('data-block-hash', topResult.hashKey);
                        processorDiv.appendChild(containerClone);
                        
                        // 最終結果は後で processorDiv から拾う
                        finalNodesData.push({ type: 'new', node: null, hashKey: topResult.hashKey });
                    }
                }

                // 重い処理を実行 (processorDiv 内の大部分は空のプレースホルダなので処理がほぼ0秒で終わる)
                if (processorDiv.childNodes.length > 0) {
                    try {
                        DOMPurify.sanitize(processorDiv, purifyConfig);
                        
                        if (typeof processHeadings === 'function') processHeadings(processorDiv);
                        if (typeof processListItems === 'function') processListItems(processorDiv);
                        if (typeof processTables === 'function') processTables(processorDiv);
                        if (typeof processCodeBlocks === 'function') processCodeBlocks(processorDiv);
                        if (typeof processMermaidDiagrams === 'function') await processMermaidDiagrams(processorDiv);
                        if (typeof processSVGBlocks === 'function') processSVGBlocks(processorDiv);
                        if (typeof processImages === 'function') await processImages(processorDiv);
                        if (typeof processLinks === 'function') await processLinks(processorDiv);
                        if (typeof processExternalImages === 'function') processExternalImages(processorDiv);
                        if (typeof processFoldableElements === 'function') processFoldableElements(processorDiv);
                        
                        const allSvgs = processorDiv.querySelectorAll('svg');
                        allSvgs.forEach(el => {
                            if (el.hasAttribute('width') && el.getAttribute('width').trim() === '') el.setAttribute('width', '100%');
                            if (el.hasAttribute('height') && el.getAttribute('height').trim() === '') el.setAttribute('height', '100%');
                        });

                        // プレースホルダを実際のキャッシュノード(重い処理済みのデータ)に復元する
                        for (const pending of pendingElements) {
                            const pid = pending.placeholder.getAttribute('data-placeholder-id');
                            const phInDiv = processorDiv.querySelector(`[data-placeholder-id="${pid}"]`);
                            if (phInDiv && phInDiv.parentNode) {
                                phInDiv.parentNode.replaceChild(pending.cachedNode, phInDiv);
                            }
                        }

                        // 新しく処理されたルートノードをキャッシュに保存
                        const processedChildren = Array.from(processorDiv.childNodes);
                        let pIdx = 0;
                        for (const item of finalNodesData) {
                            if (item.type === 'new') {
                                const processedNode = processedChildren[pIdx++];
                                if (processedNode) {
                                    if (item.hashKey) window._blockCache.set(item.hashKey, processedNode.cloneNode(true));
                                    item.node = processedNode;
                                }
                            }
                        }
                    } catch (processError) {
                        console.error('Error during DOM processing:', processError);
                    }
                }

                const finalNodes = [];
                for (const item of finalNodesData) {
                    if (item.node) finalNodes.push(item.node);
                }
                // ▲▲▲ 超・究極高速化 ここまで ▲▲▲

                // 古いキャッシュを解放
                for (const key of window._blockCache.keys()) {
                    if (!currentBlockHashes.has(key)) window._blockCache.delete(key);
                }

                if (DOM.preview) {
                    const previewPane = DOM.previewPane;
                    const savedScrollTop = previewPane ? previewPane.scrollTop : 0;
                    window.isScrolling = true;

                    let svgEditorNodes = null;
                    let activeElementOffset = null;
                    if (editing && window.currentEditingSVG && window.currentEditingSVG.container) {
                        const activeContainer = window.currentEditingSVG.container;
                        const index = activeContainer.getAttribute('data-svg-index');
                        if (previewPane && !activeContainer.closest('.svg-expanded-content')) {
                            activeElementOffset = activeContainer.getBoundingClientRect().top - previewPane.getBoundingClientRect().top;
                        }
                        const placeholder = document.createElement('div');
                        placeholder.className = 'svg-editor-placeholder';
                        placeholder.setAttribute('data-svg-index', index);
                        let wasExpanded = false;
                        if (activeContainer.parentNode) {
                            if (activeContainer.parentNode.classList.contains('svg-expanded-content')) {
                                wasExpanded = true;
                                const expandedData = window.currentEditingSVG.expandedViewData;
                                if (expandedData && expandedData.originalParent) {
                                    if (expandedData.originalNextSibling) expandedData.originalParent.insertBefore(placeholder, expandedData.originalNextSibling);
                                    else expandedData.originalParent.appendChild(placeholder);
                                }
                            } else {
                                activeContainer.parentNode.replaceChild(placeholder, activeContainer);
                            }
                        }
                        svgEditorNodes = { container: activeContainer, index: index, wasExpanded: wasExpanded };
                    } else if (typeof window.isTableEditing === 'function' && window.isTableEditing()) {
                        window.isScrolling = false; return;
                    } else if (typeof window.isInlineEditing === 'function' && window.isInlineEditing()) {
                        window.isScrolling = false; return;
                    }

                    // ▼▼▼ VDOM Diffing (双方向スキャンによるスマート差分更新) ▼▼▼
                    const targetNodes = Array.from(DOM.preview.childNodes);

                    // ダミーブロックは Diff の邪魔になるため一時的にDOMから取り外す
                    let dummyNode = null;
                    if (targetNodes.length > 0 && targetNodes[targetNodes.length - 1].nodeType === 1 && targetNodes[targetNodes.length - 1].classList.contains('dummy-tail-block')) {
                        dummyNode = targetNodes.pop();
                        if (dummyNode.parentNode) dummyNode.parentNode.removeChild(dummyNode);
                    }

                    let oldStart = 0;
                    let oldEnd = targetNodes.length - 1;
                    let newStart = 0;
                    let newEnd = finalNodes.length - 1;

                    // ブロックが同一か判定する関数（ハッシュを活用して高速化）
                    const isSameBlock = (oldNode, newNode) => {
                        if (!oldNode || !newNode) return false;
                        if (oldNode.nodeType !== newNode.nodeType) return false;
                        
                        if (oldNode.nodeType === 1) { // 要素ノード
                            const oldHash = oldNode.getAttribute('data-block-hash');
                            const newHash = newNode.getAttribute('data-block-hash');
                            if (oldHash && newHash) return oldHash === newHash;
                            // isEqualNodeのディープ比較を回避し、タグ名とouterHTMLによる高速な文字列比較を行う
                            if (oldNode.tagName !== newNode.tagName) return false;
                            return oldNode.outerHTML === newNode.outerHTML;
                        } else if (oldNode.nodeType === 3) { // テキストノード
                            return oldNode.nodeValue === newNode.nodeValue;
                        }
                        return false;
                    };

                    // DOM要素を破壊せずに行番号などの「ズレ」だけを補正する関数
                    const updateAttributes = (oldNode, newNode) => {
                        if (oldNode.nodeType === 1 && newNode.nodeType === 1) {
                            const attrs = ['data-line', 'data-line-end', 'data-svg-index', 'data-code-index', 'id'];
                            attrs.forEach(attr => {
                                const newVal = newNode.getAttribute(attr);
                                if (newVal !== oldNode.getAttribute(attr)) {
                                    if (newVal !== null) oldNode.setAttribute(attr, newVal);
                                    else oldNode.removeAttribute(attr);
                                }
                            });
                            
                            // ★ 内部の子要素の行番号(data-line)も同期する（インライン編集で違う行に飛ぶバグを防止）
                            const oldDesc = oldNode.querySelectorAll('[data-line]');
                            const newDesc = newNode.querySelectorAll('[data-line]');
                            if (oldDesc.length === newDesc.length) {
                                for (let i = 0; i < oldDesc.length; i++) {
                                    oldDesc[i].setAttribute('data-line', newDesc[i].getAttribute('data-line'));
                                    const dLineE = newDesc[i].getAttribute('data-line-end');
                                    if (dLineE) oldDesc[i].setAttribute('data-line-end', dLineE);
                                    else oldDesc[i].removeAttribute('data-line-end');
                                }
                            }
                        }
                    };

                    // 1. 前方からのスキャン (変化がない部分をスキップ)
                    while (oldStart <= oldEnd && newStart <= newEnd) {
                        if (isSameBlock(targetNodes[oldStart], finalNodes[newStart])) {
                            updateAttributes(targetNodes[oldStart], finalNodes[newStart]);
                            oldStart++;
                            newStart++;
                        } else {
                            break;
                        }
                    }

                    // 2. 後方からのスキャン (変化がない部分をスキップ)
                    while (oldEnd >= oldStart && newEnd >= newStart) {
                        if (isSameBlock(targetNodes[oldEnd], finalNodes[newEnd])) {
                            updateAttributes(targetNodes[oldEnd], finalNodes[newEnd]);
                            oldEnd--;
                            newEnd--;
                        } else {
                            break;
                        }
                    }

                    // 3. 差分の適用（本当に変更された部分だけをDOM操作）
                    if (oldStart > oldEnd) {
                        // 古いノードを使い切り、新しいノードが追加された場合（挿入）
                        const refNode = targetNodes[oldEnd + 1] || null;
                        const fragment = document.createDocumentFragment();
                        for (let i = newStart; i <= newEnd; i++) {
                            fragment.appendChild(finalNodes[i]);
                        }
                        DOM.preview.insertBefore(fragment, refNode);
                    } else if (newStart > newEnd) {
                        // 新しいノードを使い切り、古いノードが余った場合（削除）
                        for (let i = oldStart; i <= oldEnd; i++) {
                            if (targetNodes[i].parentNode) {
                                DOM.preview.removeChild(targetNodes[i]);
                            }
                        }
                    } else {
                        // 複雑な変更（置換や範囲の入れ替え）
                        const refNode = targetNodes[oldEnd + 1] || null;
                        for (let i = oldStart; i <= oldEnd; i++) {
                            if (targetNodes[i].parentNode) {
                                DOM.preview.removeChild(targetNodes[i]);
                            }
                        }
                        const fragment = document.createDocumentFragment();
                        for (let i = newStart; i <= newEnd; i++) {
                            fragment.appendChild(finalNodes[i]);
                        }
                        DOM.preview.insertBefore(fragment, refNode);
                    }

                    // 4. ダミーブロックの復元
                    if (dummyNode) {
                        DOM.preview.appendChild(dummyNode);
                    } else {
                        let dummyArea = DOM.preview.querySelector('.dummy-tail-block');
                        if (!dummyArea) {
                            dummyArea = document.createElement('div');
                            dummyArea.className = 'dummy-tail-block';
                            dummyArea.setAttribute('data-placeholder', typeof I18n !== 'undefined' ? I18n.translate('editor.placeholder') || 'テキストを追加、または \'/\' でコマンド' : 'テキストを追加、または \'/\' でコマンド');
                            DOM.preview.appendChild(dummyArea);
                        }
                    }
                    // ▲▲▲ VDOM Diffing ここまで ▲▲▲

                    // ▼▼▼ キャッシュ再利用でズレたインデックスを実DOM上で一括更新 ▼▼▼
                    let globalCodeIndex = 0;
                    DOM.preview.querySelectorAll('.code-block-wrapper').forEach(el => {
                        el.setAttribute('data-code-index', globalCodeIndex++);
                    });

                    let globalSvgIndex = 0;
                    DOM.preview.querySelectorAll('.svg-view-wrapper').forEach(el => {
                        el.setAttribute('data-svg-index', globalSvgIndex++);
                    });
                    // ▲▲▲ インデックスの一括更新 ここまで ▲▲▲

                    if (typeof fixAllInlineSvgCamelCase === 'function') {
                        fixAllInlineSvgCamelCase(DOM.preview);
                    }

                    // SVGエディタの復元
                    if (svgEditorNodes) {
                        const newContainers = DOM.preview.querySelectorAll('.svg-view-wrapper, .svg-editor-placeholder');
                        let targetContainer = null;
                        for (const c of newContainers) {
                            if (c.getAttribute('data-svg-index') === String(svgEditorNodes.index) || c.classList.contains('svg-editor-placeholder')) {
                                targetContainer = c; break;
                            }
                        }
                        if (targetContainer && targetContainer.parentNode) {
                            if (svgEditorNodes.wasExpanded) {
                                const expandedData = window.currentEditingSVG.expandedViewData;
                                if (expandedData) {
                                    expandedData.originalParent = targetContainer.parentNode;
                                    expandedData.originalNextSibling = targetContainer.nextSibling;
                                }
                                targetContainer.parentNode.removeChild(targetContainer);
                            } else {
                                targetContainer.parentNode.replaceChild(svgEditorNodes.container, targetContainer);
                            }
                        } else {
                            if (typeof stopSVGEdit === 'function') stopSVGEdit(true);
                        }
                    }

                    if (previewPane) {
                        if (activeElementOffset !== null && svgEditorNodes && svgEditorNodes.container && !svgEditorNodes.wasExpanded) {
                            previewPane.scrollTop = savedScrollTop; 
                            const newRect = svgEditorNodes.container.getBoundingClientRect();
                            const paneRect = previewPane.getBoundingClientRect();
                            const currentOffset = newRect.top - paneRect.top;
                            const diff = currentOffset - activeElementOffset;
                            if (Math.abs(diff) > 1) previewPane.scrollTop += diff;
                        } else {
                            previewPane.scrollTop = savedScrollTop;
                        }
                    }

                    setTimeout(() => { if (window.isScrolling) window.isScrolling = false; }, 100);
                }

                // イベントリスナーの再アタッチ
                if (typeof attachPreviewEvents === 'function') attachPreviewEvents();
                if (typeof attachCopyButtonListeners === 'function') attachCopyButtonListeners();
                if (typeof attachSVGSaveListeners === 'function') attachSVGSaveListeners();
                if (typeof attachSVGToggleListeners === 'function') attachSVGToggleListeners();
                if (typeof attachExternalSVGListeners === 'function') attachExternalSVGListeners();
                if (typeof attachExternalPaintListeners === 'function') attachExternalPaintListeners();
                if (typeof attachImageExportListeners === 'function') attachImageExportListeners();
                if (typeof attachImageResizeListeners === 'function') attachImageResizeListeners();
                if (typeof attachTableEvents === 'function') attachTableEvents();

                if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.restoreFocusIfNeeded === 'function') PreviewInlineEdit.restoreFocusIfNeeded();
                if (AppState.searchState && AppState.searchState.matches.length > 0) if (typeof highlightPreviewMatches === 'function') highlightPreviewMatches();
                if (typeof updateScrollMap === 'function') setTimeout(() => updateScrollMap(), 50);
                // アノテーションのアンカーをレンダリング直後に更新（遅延なし）
                if (typeof AnnotationLayer !== 'undefined' && typeof AnnotationLayer.updateAnchors === 'function') AnnotationLayer.updateAnchors();
                
                // SVGアニメーションの再開
                if (typeof window.startAllSvgAnimations === 'function') {
                    setTimeout(() => {
                        window.startAllSvgAnimations(DOM.preview);
                    }, 100);
                }
                if (typeof updateOutline === 'function') setTimeout(() => updateOutline(), 100);
                if (typeof buildSvgList === 'function') setTimeout(() => buildSvgList(), 150);
                if (typeof updateWordCount === 'function') updateWordCount();
                
                // 改ページ表示の遅延スケジュール（フリーズ防止）
                if (typeof schedulePageBreakDisplay === 'function') schedulePageBreakDisplay();

                // ▼▼▼ この行を追加 ▼▼▼
                if (typeof window.restoreMermaidExpandedView === 'function') window.restoreMermaidExpandedView();

                // 無限ループの誤検知をリセット（タイピングは正常動作）
                window._renderLoopCount = 0;

                const endTime = performance.now();
                console.log(`[Perf][Renderer] render() END at ${(endTime - renderStartTime).toFixed(1)}ms`);
                if (window._lastGlobalKeydownTime) {
                    console.log(`[Perf] ⌨ キー入力からプレビュー反映完了までの総時間: ${(endTime - window._lastGlobalKeydownTime).toFixed(1)}ms`);
                    window._lastGlobalKeydownTime = null;
                }

            } catch (e) {
                console.error('Render Critical Error:', e);
            }

            if (!_renderPending) break;
        }
    })();

    try { await _renderPromise; } finally { _renderPromise = null; }
}

// ========================================================================
// プレビュー改ページ位置表示 (Preview Page Break Display)
// ========================================================================
let _pageBreakDisplayTimer = null;
let _pageBreakRequestId = 0; // 追加: 非同期処理の競合を防ぐためのID

function schedulePageBreakDisplay() {
    if (_pageBreakDisplayTimer) clearTimeout(_pageBreakDisplayTimer);
    
    // ★ タイピング中（短時間の連続呼び出し）は計算をキャンセルし、
    // 入力が完全に止まってから4秒後に実行する (3〜4秒のフリーズを回避)
    _pageBreakDisplayTimer = setTimeout(async () => {
        if (window.isScrolling) {
            schedulePageBreakDisplay();
            return;
        }
        await renderPageBreaks();
    }, 4000); 
}

async function renderPageBreaks() {
    if (!DOM.preview) return;

    // 新しいリクエストIDを発行
    const currentReqId = ++_pageBreakRequestId;

    // [FIX] 改ページ線（position: absolute）の基準は preview 要素の padding edge になるため、
    // preview 自身を position: relative にして基準を固定する
    if (window.getComputedStyle(DOM.preview).position === 'static') {
        DOM.preview.style.position = 'relative';
    }

    // 古い線をクリア
    DOM.preview.querySelectorAll('.preview-page-break-line').forEach(el => el.remove());
    if (!AppState.config.showPageBreaks) return;
    if (typeof window.getPageBreakTopPositions !== 'function' || typeof PageSplitter === 'undefined') return;

    const pageHeightPx  = window.getSlidePageHeightPx();
    const elementWidthPx = AppState.config.previewWidth || DOM.preview.offsetWidth || 820;

    let positions;
    try {
        await new Promise(r => setTimeout(r, 10)); // UIスレッド解放
        positions = await window.getPageBreakTopPositions(DOM.preview, pageHeightPx, elementWidthPx);
    } catch (e) {
        console.error("renderPageBreaks error:", e);
        return;
    }

    // [FIX] 非同期処理の間に次の計算リクエストが発行されていたら、この結果は捨てる（重複描画の防止）
    if (currentReqId !== _pageBreakRequestId) {
        console.warn(`renderPageBreaks request ID mismatch: current=${currentReqId}, latest=${_pageBreakRequestId}`);
        return;
    }

    // 念のため追記前にもう一度クリア
    DOM.preview.querySelectorAll('.preview-page-break-line').forEach(el => el.remove());

    if (!positions) {
        console.warn("renderPageBreaks: positions is undefined");
        return;
    }

    if (positions.length === 0) {
        // ドキュメントが1ページ以内の長さである場合は改ページ線が不要なため、警告を出さずに終了する
        return;
    }

    // [FIX] position: absolute の基準はボーダーエッジではなくパディングエッジ（内側）である。
    // borderTopWidth 分を引くことで、top: 0 が常にコンテンツ領域の先頭と一致するよう補正する。
    const borderTop = parseFloat(window.getComputedStyle(DOM.preview).borderTopWidth) || 0;

    const fragment = document.createDocumentFragment();
    positions.forEach((topPx, idx) => {
        const line = document.createElement('div');
        line.className = 'preview-page-break-line';
        // borderTop を引いて absolute 配置の起点（padding edge）に合わせる
        line.style.top = `${topPx - borderTop}px`;
        line.setAttribute('data-page-label', `← P${idx + 2}`);
        fragment.appendChild(line);
    });
    DOM.preview.appendChild(fragment);
}

window.schedulePageBreakDisplay = schedulePageBreakDisplay;
window.renderPageBreaks = renderPageBreaks;

function generateHeadingId(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u0080-\uFFFF-]/g, '')
        .replace(/^-+|-+$/g, '');
}

function processHeadings(root) {
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const usedIds = new Map(); // Track duplicate IDs

    headings.forEach((h, index) => {
        // If marked.js already generated an ID, keep it
        if (h.id) {
            usedIds.set(h.id, true);
        } else {
            // Generate ID from heading text using GFM rules
            let baseId = generateHeadingId(h.textContent);

            // Handle empty or invalid IDs
            if (!baseId) {
                baseId = `heading-${index}`;
            }

            // Handle duplicate IDs by appending a number
            let id = baseId;
            let counter = 1;
            while (usedIds.has(id)) {
                id = `${baseId}-${counter}`;
                counter++;
            }
            usedIds.set(id, true);

            h.id = id;
        }

        // Make collapsible
        h.classList.add('collapsible');
        h.setAttribute('tabindex', '0');
        h.setAttribute('aria-expanded', 'true');

        // Restore folded state
        if (AppState.foldState[h.id] === false) {
            h.classList.add('collapsed');
            h.setAttribute('aria-expanded', 'false');
        }
    });
}

function processListItems(root) {
    const listItems = root.querySelectorAll('li');
    listItems.forEach(li => {
        // 既にラップ済みの場合はスキップ
        if (li.querySelector(':scope > .li-text-wrapper')) return;

        let shouldWrap = false;
        const toWrap = [];
        for (let i = 0; i < li.childNodes.length; i++) {
            const child = li.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                shouldWrap = true;
                toWrap.push(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName;
                if (['UL', 'OL', 'P', 'BLOCKQUOTE', 'PRE', 'TABLE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
                    break;
                } else if (tag === 'INPUT' && child.getAttribute('type') === 'checkbox') {
                    // Ignore checkbox to keep it clickable outside the text wrapper
                } else {
                    shouldWrap = true;
                    toWrap.push(child);
                }
            } else if (child.nodeType === Node.TEXT_NODE) {
                toWrap.push(child);
            }
        }

        if (shouldWrap && toWrap.length > 0) {
            // Trim leading/trailing empty text nodes
            while (toWrap.length > 0 && toWrap[0].nodeType === Node.TEXT_NODE && toWrap[0].textContent.trim() === '') {
                toWrap.shift();
            }
            while (toWrap.length > 0 && toWrap[toWrap.length - 1].nodeType === Node.TEXT_NODE && toWrap[toWrap.length - 1].textContent.trim() === '') {
                toWrap.pop();
            }
            
            if (toWrap.length > 0) {
                const wrapper = document.createElement('span');
                wrapper.className = 'li-text-wrapper';
                li.insertBefore(wrapper, toWrap[0]);
                toWrap.forEach(node => wrapper.appendChild(node));
            }
        }
    });
}

function processTables(root) {
    const tables = root.querySelectorAll('table');
    tables.forEach((table, tableIndex) => {
        // Check alignment from marked output (style="text-align:...") and convert to classes
        const ths = table.querySelectorAll('th');
        ths.forEach((th, idx) => {
            const align = th.style.textAlign;
            if (align) {
                const className = `align-${align}`;
                // Apply to TH
                th.classList.add(className);
                th.style.textAlign = ''; // Clear inline

                // Apply to all TDs in this column
                const tds = table.querySelectorAll(`tr td:nth-child(${idx + 1})`);
                tds.forEach(td => {
                    td.classList.add(className);
                    // Numeric check
                    if (td.textContent.match(/^[\d,.]+$/)) {
                        td.classList.add('numeric');
                    }
                });
            }
        });

    });

}

function attachTableEvents() {
    if (typeof TableEditor === 'undefined' || !DOM.preview) return;

    const tables = DOM.preview.querySelectorAll('table');
    tables.forEach((table, index) => {
        // Find the index relative to all tables in the document (marked output)
        // If we are using filter/search, this might be tricky, but usually index matches sequence.
        TableEditor.init(table, index);
    });

    // Initialize Global Row Control UI (Hover listeners)
    TableEditor.initGlobalListeners();
}


function processCodeBlocks(root) {
    const pres = root.querySelectorAll('pre');
    pres.forEach((pre, index) => {
        const code = pre.querySelector('code');
        if (!code) return;

        // Save original code text BEFORE any processing
        const lines = code.textContent.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        const originalCodeText = lines.join('\n');

        // Detect language from class (e.g., language-javascript)
        let language = 'text';
        let languageLabel = 'NONE';
        const classList = code.className || '';
        const match = classList.match(/language-(\w+)/);
        if (match) {
            language = match[1];
            languageLabel = getLanguageLabel(language);
        }

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        wrapper.dataset.codeIndex = index;

        // ▼▼▼ 変更：元の pre または code の行番号・ハッシュを引き継ぎ、一番外側の枠が名札を持つようにする ▼▼▼
        ['data-line', 'data-line-end', 'data-block-hash'].forEach(attr => {
            if (pre.hasAttribute(attr)) {
                wrapper.setAttribute(attr, pre.getAttribute(attr));
                pre.removeAttribute(attr);
            } else if (code && code.hasAttribute(attr)) {
                wrapper.setAttribute(attr, code.getAttribute(attr));
                code.removeAttribute(attr);
            }
        });
        // ▲▲▲ 変更ここまで ▲▲▲

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Add controls container (top-right)
        const controls = document.createElement('div');
        controls.className = 'code-controls';
        wrapper.appendChild(controls);

        // Add language label (acts as button)
        const langLabel = document.createElement('div');
        langLabel.className = 'language-label clickable';
        langLabel.textContent = languageLabel;
        langLabel.dataset.language = language;
        langLabel.title = typeof I18n !== 'undefined' ? I18n.translate('languageSelect.change') || '言語を変更' : '言語を変更';
        controls.appendChild(langLabel);

        // Detect if this is an editable Mermaid diagram (flowchart/graph or sequenceDiagram)
        let isEditableMermaid = false;
        if (language === 'mermaid') {
            const lines = originalCodeText.trim().split('\n');
            // Find the first non-empty, non-comment line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('%%')) {
                    if (/^(?:flowchart|graph|sequenceDiagram|classDiagram|erDiagram)\b/i.test(line)) {
                        isEditableMermaid = true;
                    }
                    break;
                }
            }
        }

        // Add Edit Button
        if (language !== 'mermaid' || isEditableMermaid) {
            const editBtn = document.createElement('button');
            editBtn.className = 'code-edit-btn';
            editBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.edit') || '編集' : '編集';
            editBtn.setAttribute('type', 'button');
            editBtn.title = typeof I18n !== 'undefined' ? I18n.translate('editor.editCode') || 'コードを編集' : 'コードを編集';
            controls.appendChild(editBtn);
        }

        // Add Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = (typeof t === 'function') ? t('code.copyButton') : 'コピー';
        copyBtn.setAttribute('type', 'button');
        copyBtn.dataset.codeText = originalCodeText;
        controls.appendChild(copyBtn);

        // Apply Prism.js syntax highlighting
        if (language !== 'text' && typeof Prism !== 'undefined' && Prism.languages[language]) {
            try {
                // Set the text content first
                code.textContent = originalCodeText;

                // Apply line numbers class before highlighting
                if (AppState.config.lineNumbers) {
                    pre.classList.add('line-numbers');
                } else {
                    pre.classList.remove('line-numbers');
                }

                // ▼▼▼ 変更: IntersectionObserverを使った遅延ハイライトに変更 ▼▼▼
                const obs = getPrismObserver();
                if (obs) {
                    obs.observe(wrapper);
                } else {
                    // 非対応ブラウザ用のフォールバック
                    Prism.highlightElement(code);
                }
                // ▲▲▲ 変更ここまで ▲▲▲
            } catch (e) {
                console.warn(`Prism highlighting error for language "${language}":`, e.message);
                // Fallback to plain text with line numbers
                code.textContent = originalCodeText;
                if (AppState.config.lineNumbers) {
                    pre.classList.add('line-numbers');
                } else {
                    pre.classList.remove('line-numbers');
                }
            }
        } else {
            // No highlighting, just display plain text
            code.textContent = originalCodeText;
            if (AppState.config.lineNumbers) {
                pre.classList.add('line-numbers');
            } else {
                pre.classList.remove('line-numbers');
            }
        }
    });
}

/**
 * Apply line numbers without syntax highlighting
 */
function applyLineNumbers(pre, code, lines) {
    if (AppState.config.lineNumbers) {
        pre.setAttribute('data-line-numbers', 'on');
    } else {
        pre.setAttribute('data-line-numbers', 'off');
    }

    code.innerHTML = lines.map((line, i) => {
        return `<span class="code-line" data-line-number="${i + 1}">${escapeHtml(line)}</span>`;
    }).join('\n');
}

/**
 * Get display label for language
 */
function getLanguageLabel(lang) {
    const labels = {
        'javascript': 'JavaScript',
        'js': 'JavaScript',
        'typescript': 'TypeScript',
        'ts': 'TypeScript',
        'python': 'Python',
        'py': 'Python',
        'java': 'Java',
        'c': 'C',
        'cpp': 'C++',
        'csharp': 'C#',
        'cs': 'C#',
        'php': 'PHP',
        'ruby': 'Ruby',
        'rb': 'Ruby',
        'swift': 'Swift',
        'vb': 'Visual Basic',
        'vbnet': 'VB.NET',
        'pascal': 'Pascal',
        'go': 'Go',
        'rust': 'Rust',
        'matlab': 'MATLAB',
        'perl': 'Perl',
        'fortran': 'Fortran',
        'html': 'HTML',
        'markup': 'HTML',
        'xml': 'XML',
        'css': 'CSS',
        'markdown': 'Markdown',
        'md': 'Markdown',
        'json': 'JSON',
        'yaml': 'YAML',
        'yml': 'YAML',
        'bash': 'Bash',
        'sh': 'Shell',
        'shell': 'Shell',
        'sql': 'SQL'
    };
    return labels[lang.toLowerCase()] || lang.toUpperCase();
}

/**
 * Process Mermaid diagram code blocks
 * Converts ```mermaid code blocks into rendered diagrams
 */
async function processMermaidDiagrams(root) {
    // Check if Mermaid is loaded
    if (typeof mermaid === 'undefined') {
        console.warn('Mermaid library is not loaded');
        return;
    }

    // Initialize Mermaid with configuration (only once)
    // v11: mermaid.dataset は非公式APIのため window._mermaidInitialized で管理する
    if (!window._mermaidInitialized) {
        try {
            mermaid.parseError = function (err, hash) {
                console.error('Mermaid syntax error (suppressed from UI):', err);
            };

            const errorElements = document.querySelectorAll('#dmermaid-error-container, .error-icon, .mermaid-error-display');
            errorElements.forEach(el => el.remove());

            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
                htmlLabels: false,           // v11: ルートレベルに移動（flowchart.htmlLabels は非推奨）
                fontSize: 12,
                themeVariables: {
                    fontSize: '12px'
                },
                flowchart: {
                    useMaxWidth: false,
                    padding: 8,
                    curve: 'basis',          // v10互換のエッジ曲線スタイルを維持（v11デフォルト rounded から変更）
                },
                logLevel: 'error',
            });

            window._mermaidInitialized = true;

        } catch (e) {
            console.error('Mermaid initialization error:', e);
        }
    }

    // Find all code blocks with language-mermaid class
    const mermaidBlocks = root.querySelectorAll('pre code.language-mermaid');

    // Process each mermaid block
    let counter = 0;
    for (const code of mermaidBlocks) {
        const pre = code.parentElement;

        if (!pre || !pre.parentNode) {
            console.warn('Mermaid code block has no parent element');
            continue;
        }

        const mermaidCode = code.textContent.trim();

        if (!mermaidCode) {
            continue;
        }

        try {
            const diagramId = `mermaid-${Date.now()}-${counter++}`;
            const renderResult = await mermaid.render(diagramId, mermaidCode);
            let svg = typeof renderResult === 'string' ? renderResult : renderResult.svg;
            // [FIX] mermaid等のレンダラが稀に width="" を出力してブラウザのDOM解析エラーを誘発するのを防ぐ
            svg = svg.replace(/width=["']\s*["']/gi, 'width="100%"');

            const diagramContainer = document.createElement('div');
            diagramContainer.className = 'mermaid-diagram-wrapper';
            diagramContainer.innerHTML = svg;

            // ▼▼▼ 追加：元の pre または code-block-wrapper の行番号・ハッシュを引き継ぐ ▼▼▼
            // code-block-wrapperにラップされている場合、data-lineはwrapperに移動済みのため
            // preではなくwrapperから取得する（pre.removeAttribute()で削除済み）
            const codeBlockWrapper = pre.closest('.code-block-wrapper');
            const dataLineSource = codeBlockWrapper || pre;
            ['data-line', 'data-line-end', 'data-block-hash'].forEach(attr => {
                if (dataLineSource.hasAttribute(attr)) {
                    diagramContainer.setAttribute(attr, dataLineSource.getAttribute(attr));
                }
            });
            // ▲▲▲ 追加ここまで ▲▲▲

            // [NEW] SVG Save Button (Mermaid)
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn-save-mermaid';
            saveBtn.setAttribute('type', 'button');
            saveBtn.title = typeof I18n !== 'undefined' ? I18n.translate('editor.saveSvgTitle') || 'SVG形式で保存' : 'SVG形式で保存';
            saveBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.saveSvg') || 'SVG保存' : 'SVG保存';

            // ▼▼▼ プレビュー用拡大表示ボタン ▼▼▼
            const expandBtn = document.createElement('button');
            expandBtn.className = 'btn-expand-mermaid code-edit-btn';
            expandBtn.setAttribute('type', 'button');
            expandBtn.title = typeof I18n !== 'undefined' ? I18n.translate('mermaidEditor.zoomIn') || '拡大表示（パン・ズーム対応）' : '拡大表示（パン・ズーム対応）';
            expandBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('mermaidEditor.zoomText') || '拡大' : '拡大';
            expandBtn.style.marginRight = '4px';
            expandBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.showMermaidExpandedView) {
                    window.showMermaidExpandedView(diagramContainer);
                }
            };
            // ▲▲▲ 追記ここまで ▲▲▲

            // Find nearest wrapper's controls
            const wrapper = codeBlockWrapper;
            const controls = wrapper ? wrapper.querySelector('.code-controls') : null;
            if (controls) {
                // [Expand] [Save] の順に並べる
                controls.insertBefore(expandBtn, controls.firstChild);
                controls.insertBefore(saveBtn, expandBtn);
            } else {
                diagramContainer.appendChild(saveBtn);
                diagramContainer.appendChild(expandBtn);
            }

            pre.parentNode.replaceChild(diagramContainer, pre);

            // [NEW] Mermaidインタラクション初期化（ノードホバー・ドラッグ接続機能等）
            // レンダリング直後はSVGの座標がまだ確定していない場合があるため、1フレーム遅延させてから初期化する
            setTimeout(() => {
                const firstLine = mermaidCode.trim().split('\n')[0];
                if (/^sequenceDiagram\b/i.test(firstLine)) {
                    if (typeof MermaidSequenceInteraction !== 'undefined') {
                        MermaidSequenceInteraction.initDiagram(diagramContainer, mermaidCode);
                    }
                } else if (/^classDiagram\b/i.test(firstLine)) {
                    if (typeof MermaidClassInteraction !== 'undefined') {
                        MermaidClassInteraction.initDiagram(diagramContainer, mermaidCode);
                    }
                } else if (/^erDiagram\b/i.test(firstLine)) {
                    if (typeof MermaidErInteraction !== 'undefined') {
                        MermaidErInteraction.initDiagram(diagramContainer, mermaidCode);
                    }
                } else if (/^(?:flowchart|graph)\b/i.test(firstLine)) {
                    if (typeof MermaidInteraction !== 'undefined') {
                        MermaidInteraction.initDiagram(diagramContainer, mermaidCode);
                    }
                }
            }, 100);

        } catch (e) {
            console.error('Mermaid rendering error:', e);

            const errorDiv = document.createElement('div');
            errorDiv.className = 'mermaid-error';
            const errorMessage = e.message || e.str || String(e);
            errorDiv.innerHTML = `<strong>Mermaid図表のレンダリングエラー:</strong><br>${escapeHtml(errorMessage)}<pre>${escapeHtml(mermaidCode)}</pre>`;

            try {
                if (pre.parentNode) {
                    pre.parentNode.replaceChild(errorDiv, pre);
                }
            } catch (replaceError) {
                console.error('Failed toreplace element with error message:', replaceError);
            }
        }
    }
}



/**
 * Process SVG code blocks
 * Converts ```svg code blocks into rendered SVG images
 */
// --- SVG Render Cache ---
window._svgRenderCache = window._svgRenderCache || new Map();
const MAX_CACHE_SIZE = 50;

function processSVGBlocks(root) {
    const svgBlocks = root.querySelectorAll('pre code.language-svg');
    let svgIndex = 0;

    // 現在のプレビュー幅（キャッシュキーに使用）
    const targetWidth = (typeof AppState !== 'undefined' && AppState.config && AppState.config.previewWidth) ? AppState.config.previewWidth : 820;

    for (const code of svgBlocks) {
        const pre = code.parentElement;
        if (!pre || !pre.parentNode) continue;

        const svgCode = code.textContent.trim();
        if (!svgCode) continue;

        // 【No.1 修正】キャッシュキーを作成（簡易的なハッシュ化）
        const hash = str => {
            let h = 0;
            for(let i = 0; i < str.length; i++) h = Math.imul(31 * h + str.charCodeAt(i), 1);
            return h;
        };
        const cacheKey = `${targetWidth}_${svgCode.length}_${hash(svgCode)}`;

        try {
            let svgContainer;

            // 【No.1 修正】SVGコードをキーにしてキャッシュを確認
            if (window._svgRenderCache.has(cacheKey)) {
                // [FIX No.3] キャッシュヒット：パースとサニタイズをスキップしてクローン（爆速）
                // data-sanitized="true" マーカーを付与し、後続の全体サニタイズからSVGサブツリーを
                // 識別・除外できるようにする（将来的な二重サニタイズ防止）
                svgContainer = window._svgRenderCache.get(cacheKey).cloneNode(true);
                svgContainer.setAttribute('data-svg-index', svgIndex);
                svgContainer.setAttribute('data-sanitized', 'true'); // サニタイズ済みマーカー

                // 元の pre の行番号・ハッシュを引き継ぐ
                ['data-line', 'data-line-end', 'data-block-hash'].forEach(attr => {
                    if (pre.hasAttribute(attr)) svgContainer.setAttribute(attr, pre.getAttribute(attr));
                });
            } else {
                // キャッシュミス：重いパースとサニタイズを実行
                const parser = new DOMParser();
                let sanitizedSvgCode = svgCode.replace(/width=["']\s*["']/gi, '');
                if (!/xmlns=["']/i.test(sanitizedSvgCode)) {
                    sanitizedSvgCode = sanitizedSvgCode.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
                }
                const doc = parser.parseFromString(sanitizedSvgCode, 'image/svg+xml');
                const parsedSvg = doc.querySelector('svg');

                if (parsedSvg) {
                    DOMPurify.sanitize(parsedSvg, {
                        USE_PROFILES: { svg: true, svgFilters: true },
                        ADD_TAGS: ['use', 'defs', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'tspan', 'textPath', 'style', 'connector-data', 'image', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'feOffset', 'feDropShadow', 'feBlend', 'feColorMatrix', 'feFlood', 'feMerge', 'feMergeNode', 'animateMotion', 'mpath'],
                        ADD_ATTR: ['rel', 'target', 'class', 'style', 'checked', 'type', 'start', 'viewBox', 'xmlns', 'xmlns:xlink', 'd', 'fill', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'points', 'transform', 'data-original-src', 'data-original-href', 'id', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'letter-spacing', 'line-height', 'text-anchor', 'dominant-baseline', 'href', 'xlink:href', 'preserveAspectRatio', 'clip-path', 'clip-rule', 'fill-rule', 'offset', 'stop-color', 'stop-opacity', 'filter', 'gradientUnits', 'data-line', 'display', 'encoding', 'accent', 'fence', 'separator', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'form', 'lspace', 'rspace', 'columnspan', 'rowspan', 'columnalign', 'rowalign', 'framespacing', 'columnlines', 'rowlines', 'frame', 'equalcolumns', 'equalrows', 'displaystyle', 'side', 'minlabelspacing', 'alignmentscope', 'alttext', 'overflow', 'scriptlevel', 'scriptsizemultiplier', 'scriptminize', 'dir', 'decimalpoint', 'columnspacing', 'rowspacing', 'data-tool-id', 'data-radius', 'data-spikes', 'data-sides', 'data-arrow-start', 'data-arrow-end', 'data-arrow-size', 'data-is-canvas', 'data-is-proxy', 'data-no-connector', 'data-original-id', 'data-connections', 'marker-start', 'marker-end', 'marker-mid', 'refX', 'refY', 'orient', 'markerWidth', 'markerHeight', 'data-paper-width', 'data-paper-height', 'data-paper-x', 'data-paper-y', 'data-internal', 'data-paper-zoom', 'data-paper-offx', 'data-paper-offy', 'data-poly-points', 'data-bez-points', 'data-text-highlight', 'data-align-h', 'data-align-v', 'data-writing-mode', 'data-line-spacing', 'data-original-text', 'vector-effect', 'dur', 'repeatCount', 'rotate', 'tabindex'],
                        FORBID_TAGS: ['iframe', 'object', 'embed', 'base'],
                        IN_PLACE: true,
                        ADD_DATA_URI_TAGS: ['img', 'image']
                    });

                    svgContainer = document.createElement('div');
                    svgContainer.className = 'svg-view-wrapper';
                    svgContainer.setAttribute('data-svg-index', svgIndex);
                    svgContainer.setAttribute('data-sanitized', 'true'); // サニタイズ済みマーカー

                    // 元の pre の行番号・ハッシュを引き継ぐ
                    ['data-line', 'data-line-end', 'data-block-hash'].forEach(attr => {
                        if (pre.hasAttribute(attr)) svgContainer.setAttribute(attr, pre.getAttribute(attr));
                    });

                    svgContainer.style.textAlign = 'left';
                    svgContainer.style.margin = '16px 0';
                    svgContainer.style.cursor = 'pointer';
                    svgContainer.appendChild(parsedSvg);

                    // キャッシュの最大件数を制限（メモリ肥大化防止）
                    if (window._svgRenderCache.size >= MAX_CACHE_SIZE) {
                        const firstKey = window._svgRenderCache.keys().next().value;
                        window._svgRenderCache.delete(firstKey);
                    }
                    // キャッシュに保存（サイズ動的変更前の純粋なDOM）
                    window._svgRenderCache.set(cacheKey, svgContainer.cloneNode(true));
                }
            }

            if (svgContainer) {
                const svgElement = svgContainer.querySelector('svg');
                if (svgElement) {
                    const origWAttr = svgElement.getAttribute('width');
                    const origHAttr = svgElement.getAttribute('height');
                    const hasVb = svgElement.hasAttribute('viewBox');

                    const paperH = parseFloat(svgElement.getAttribute('data-paper-height')) || parseFloat(origHAttr);
                    const paperW = parseFloat(svgElement.getAttribute('data-paper-width')) || parseFloat(origWAttr);

                    // もし data-paper-width がなく、元の width/height がある場合は、それを論理サイズとして設定
                    if (!svgElement.hasAttribute('data-paper-width') && paperW > 0) {
                        svgElement.setAttribute('data-paper-width', String(paperW));
                    }
                    if (!svgElement.hasAttribute('data-paper-height') && paperH > 0) {
                        svgElement.setAttribute('data-paper-height', String(paperH));
                    }
                    if (!svgElement.hasAttribute('data-paper-x')) {
                        svgElement.setAttribute('data-paper-x', '0');
                    }
                    if (!svgElement.hasAttribute('data-paper-y')) {
                        svgElement.setAttribute('data-paper-y', '0');
                    }

                    // もし viewBox がなく、元の width/height がある場合は viewBox を設定して座標系を保証する
                    if (!hasVb && paperW > 0 && paperH > 0) {
                        svgElement.setAttribute('viewBox', `0 0 ${paperW} ${paperH}`);
                    }

                    if (targetWidth) {
                        if (paperH > 0 && paperW > 0) {
                            const aspect = paperH / paperW;
                            const computedHeight = Math.round(targetWidth * aspect);
                            svgElement.setAttribute('width', targetWidth);
                            svgElement.setAttribute('height', computedHeight);

                            // [FIX No.5(A)] PageSplitter用にアスペクト比から計算した高さを記録。
                            // PageSplitter側はこの属性値を読み取ることで、offsetHeight/getBoundingClientRect
                            // の呼び出し（Layout Thrashing）を回避できる。
                            svgContainer.setAttribute('data-computed-height', String(computedHeight));

                            const hasZoom = svgElement.hasAttribute('data-paper-zoom');
                            const currentVB = svgElement.getAttribute('viewBox');

                            if (!hasZoom && currentVB) {
                                // [FIX] 外部SVGの元のviewBoxを上書きしてしまい、拡大表示（トリミング異常）になる致命的バグを防ぐためコメントアウト
                                /*
                                const parts = currentVB.split(/[\\s,]+/).map(parseFloat);
                                if (parts.length === 4) {
                                    parts[2] = paperW;
                                    parts[3] = paperH;
                                    svgElement.setAttribute('viewBox', parts.join(' '));
                                }
                                */
                            }
                        } else {
                            const vb = svgElement.viewBox && svgElement.viewBox.baseVal ? svgElement.viewBox.baseVal : null;
                            if (vb && vb.width > 0) {
                                const aspect = vb.height / vb.width;
                                const computedHeight = Math.round(targetWidth * aspect);
                                svgElement.setAttribute('width', targetWidth);
                                svgElement.setAttribute('height', computedHeight);

                                // [FIX No.5(A)] viewBoxベースでもPageSplitter用に計算高さを記録
                                svgContainer.setAttribute('data-computed-height', String(computedHeight));
                            }
                        }
                    }
                    if (svgElement.style) {
                        svgElement.style.pointerEvents = 'all';
                    }
                }

                svgContainer.addEventListener('dblclick', function (e) {
                    if (window._svgEditorStarting) return;
                    if (window.currentEditingSVG && window.currentEditingSVG.container === this) return;
                    const index = parseInt(this.getAttribute('data-svg-index'));
                    if (typeof startSVGEdit === 'function') startSVGEdit(this, index);
                });

                pre.parentNode.replaceChild(svgContainer, pre);

                const wrapper = svgContainer.closest('.code-block-wrapper');
                if (wrapper) {
                    const controls = wrapper.querySelector('.code-controls');
                    if (controls && !controls.querySelector('.btn-save-svg')) {
                        const unwrapBtn = document.createElement('button');
                        unwrapBtn.className = 'btn-unwrap-svg';
                        unwrapBtn.setAttribute('type', 'button');
                        unwrapBtn.title = typeof I18n !== 'undefined' ? I18n.translate('editor.svgUnwrapTitle') || 'SVGのコード囲いを取り除き、他アプリで表示可能な形式にします' : 'SVGのコード囲いを取り除き、他アプリで表示可能な形式にします';
                        unwrapBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.svgUnwrap') || '編集完了' : '編集完了';
                        controls.insertBefore(unwrapBtn, controls.firstChild);

                        const saveBtn = document.createElement('button');
                        saveBtn.className = 'btn-save-svg';
                        saveBtn.setAttribute('type', 'button');
                        saveBtn.title = typeof I18n !== 'undefined' ? I18n.translate('editor.saveSvgTitle') || 'SVG形式で保存' : 'SVG形式で保存';
                        saveBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.saveSvg') || 'SVG保存' : 'SVG保存';
                        controls.insertBefore(saveBtn, unwrapBtn.nextSibling);
                    }
                }
            }
        } catch (e) {
            console.error('SVG rendering error:', e);
        }
        svgIndex++;
    }

    // Raw SVGコンテナの処理 (既存のまま)
    const rawWrappers = root.querySelectorAll('.raw-svg-container');
    rawWrappers.forEach(wrapper => {
        if (!wrapper.querySelector('.btn-wrap-svg')) {
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            const controls = document.createElement('div');
            controls.className = 'raw-svg-controls';
            const wrapBtn = document.createElement('button');
            wrapBtn.className = 'btn-wrap-svg';
            wrapBtn.setAttribute('type', 'button');
            wrapBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.svgWrap') || '編集用意' : '編集用意';
            wrapBtn.title = typeof I18n !== 'undefined' ? I18n.translate('editor.svgWrapTitle') || 'SVGをコードブロックで囲み、エディタで編集可能な安全な状態にします' : 'SVGをコードブロックで囲み、エディタで編集可能な安全な状態にします';
            controls.appendChild(wrapBtn);
            wrapper.appendChild(controls);
        }
    });
}

async function processImages(root) {
    // Tauri Mode Optimization
    const tauri = AppState.tauri || window.__TAURI__;
    if (tauri) {
        const path = tauri.path || (window.__TAURI__ && window.__TAURI__.path);
        if (!path) {
            console.error("Debug Error: path API NOT FOUND. window.__TAURI__.path is missing.");
        }

        // Tauri v2: convertFileSrc is in tauri.core, not tauri.tauri
        let convertFileSrc;
        if (tauri.core && tauri.core.convertFileSrc) {
            convertFileSrc = tauri.core.convertFileSrc;
        } else if (tauri.tauri && tauri.tauri.convertFileSrc) {
            // Fallback for v1
            convertFileSrc = tauri.tauri.convertFileSrc;
        } else if (typeof tauri.convertFileSrc === 'function') {
            // Direct function
            convertFileSrc = tauri.convertFileSrc;
        } else {
            console.error('convertFileSrc not found in Tauri API');
            alert('Tauri API Error: convertFileSrc function not found.\nPlease check Tauri version compatibility.');
            return;
        }

        const images = root.querySelectorAll('img');

        let baseDir = AppState.fileDirectory;
        // Fallback if fileDirectory is missing but fileFullPath exists
        if (!baseDir && AppState.fileFullPath) {
            try {
                baseDir = await path.dirname(AppState.fileFullPath);
                AppState.fileDirectory = baseDir;
            } catch (e) {
                console.warn('Failed to get dirname in Tauri:', e);
            }
        }

        if (!baseDir) {
            console.warn('Cannot resolve relative paths without baseDir');
            return;
        }


        // [FIX] Promise.all による全並列処理は、画像数が多い場合にOSのファイルディスクリプタ上限に
        // 達するリスクがある。チャンク単位（5件ずつ）で直列化して安全に処理する。
        const CHUNK_SIZE = 5;
        const imageArray = Array.from(images);
        for (let i = 0; i < imageArray.length; i += CHUNK_SIZE) {
            const chunk = imageArray.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (img) => {
                let src = img.getAttribute('data-original-src');
                if (!src) src = img.getAttribute('src'); // Fallback to src
                if (!src || src.startsWith('data:') || src.startsWith('http')) return;

                try {
                    let decodedSrc = src;
                    try { decodedSrc = decodeURIComponent(src); } catch (e) { }

                    // Join path
                    const absolutePath = await path.join(baseDir, decodedSrc);

                    // Convert to asset URL
                    let assetUrl = convertFileSrc(absolutePath);

                    // [NEW] Use cache buster if reload was triggered
                    if (window.assetCacheBusters && window.assetCacheBusters[src]) {
                        const sep = assetUrl.includes('?') ? '&' : '?';
                        assetUrl += sep + 't=' + window.assetCacheBusters[src];
                    }

                    img.setAttribute('src', assetUrl);
                } catch (e) {
                    console.warn('Failed to load image in Tauri:', src, e);
                    console.error(`Image Error during resolve/join: ${src}\nError: ${e}`);
                    img.alt = `[読み込み失敗: ${src}]`;
                }
            }));
        }
        return; // Skip standard browser logic
    }

    // Standard Browser Logic (File System Access API)
    const images = root.querySelectorAll('img');
    let needsDirectoryAccess = false;
    const relativeImages = [];

    // First pass: identify which images need directory access
    for (const img of images) {
        // data-original-src がない場合は src にフォールバック
        let src = img.getAttribute('data-original-src') || img.getAttribute('src');
        if (!src) continue;

        // data: / http / blob: URL は自嬩した URL なのでスキップ
        if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) continue;

        // ファイルスキーム (file://) もスキップ
        if (src.startsWith('file:')) continue;

        // ブラウザが相対パスで無効な file:// リクエストを退けるため、
        // data-original-src に元の値を保持したうえで src を空にする
        if (!img.hasAttribute('data-original-src')) {
            img.setAttribute('data-original-src', src);
        }
        img.removeAttribute('src'); // ブラウザの自動リクエストを防ぐ

        relativeImages.push({ img, src });

        if (!AppState.fileDirectory) {
            needsDirectoryAccess = true;
        }
    }

    // Request directory access if needed
    if (needsDirectoryAccess && relativeImages.length > 0) {
        try {
            const savedHandle = await getSavedDirectoryHandle();
            if (savedHandle) {
                if (AppState.fileHandle) {
                    const isRelated = await verifyHandleRelationship(savedHandle, AppState.fileHandle);
                    if (!isRelated) {
                        console.log('Saved directory handle is not related to current file. Ignoring.');
                        throw new Error('Unrelated directory handle');
                    }
                }

                const perm = await savedHandle.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    console.log('Restored directory access from saved handle');
                    AppState.fileDirectory = savedHandle;
                    needsDirectoryAccess = false;
                }
            }
        } catch (e) {
            console.warn('Failed to restore saved handle:', e);
        }

        if (needsDirectoryAccess) {
            console.warn('Directory access needed - showing warning with button');
            showImageAccessWarning(relativeImages);
            return;
        }
    }

    // Second pass: load images
    // ▼▼▼ 変更: for...of を Promise.all にして並列処理化 ▼▼▼
    console.log("[ImgLoad] ========== 画像読み込み開始 ========== 対象数: " + relativeImages.length + ", fileDirectory: " + (!!AppState.fileDirectory));
    relativeImages.forEach(function(x){ console.log("[ImgLoad] 対象画像:", x.src); });
    await Promise.all(relativeImages.map(async ({ img, src }) => {
        try {
            if (AppState.fileDirectory) {
                let decodedSrc = src;
                try {
                    decodedSrc = decodeURIComponent(src);
                } catch (e) {
                    console.warn('Failed to decode image src:', src, e);
                }

                const fileHandle = await resolveRelativePath(AppState.fileDirectory, decodedSrc);
                if (fileHandle) {
                    const file = await fileHandle.getFile();
                    const dataUrl = await fileToDataUrl(file);
                    img.setAttribute('src', dataUrl);
                } else {
                    console.warn(`Image not found: ${decodedSrc}`);
                    img.alt = `[画像が見つかりません: ${decodedSrc}]`;
                }
            } else {
                console.warn('[processImages] fileDirectory is null, skipping:', src);
                console.error("[ImgLoad] fileDirectory=null! AppState.fileDirectory:", AppState.fileDirectory, "fileFullPath:", AppState.fileFullPath);
            }
        } catch (e) {
            console.warn('Failed to load image:', src, e.message);
            console.error("[ImgLoad] エラー種別:", e.name, "詳細:", e.message);
            img.alt = `[読み込み失敗: ${src}]`;
        }
    }));
    // ▲▲▲ 変更ここまで ▲▲▲
}

function showImageAccessWarning(relativeImages) {
    const previewPane = DOM.previewPane || document.getElementById('preview-pane');
    if (!previewPane) {
        console.error('Preview pane not found');
        return;
    }

    let existingWarning = previewPane.querySelector('.image-access-warning-container');
    if (existingWarning) {
        return;
    }

    const warningContainer = document.createElement('div');
    warningContainer.className = 'image-access-warning-container';
    warningContainer.style.cssText = 'position: sticky; top: 0; z-index: 100; background: white; padding: 16px; margin-bottom: 16px;';

    const warning = document.createElement('div');
    warning.style.cssText = 'border: 2px dashed #ff9800; border-radius: 4px; padding: 16px; background: #fff3e0; color: #e65100;';

    const title = document.createElement('strong');
    title.textContent = `📁 画像フォルダへのアクセスが必要です (${relativeImages.length}個の画像)`;

    const description = document.createElement('p');
    description.style.cssText = 'margin: 8px 0;';
    description.textContent = '相対パス画像を表示するには、フォルダへのアクセス許可が必要です。';

    const button = document.createElement('button');
    button.id = 'grant-folder-access-btn-unique';
    button.className = 'grant-folder-access-btn';
    button.textContent = '📂 フォルダを選択して画像を表示';
    button.style.cssText = 'background: #ff9800; color: white; border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;';
    button.setAttribute('type', 'button');

    // Handler
    async function handleButtonClick(e, container) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        try {
            const granted = await requestDirectoryAccess();
            if (granted) {
                container.remove();
                await render();
            }
        } catch (err) {
            console.error('Error in button handler:', err);
            alert(t('error.occurred') + err.message);
        }
    }

    button.onclick = function (e) {
        handleButtonClick(e, warningContainer);
    };

    warning.appendChild(title);
    warning.appendChild(description);
    warning.appendChild(button);
    warningContainer.appendChild(warning);

    previewPane.insertBefore(warningContainer, previewPane.firstChild);


    // Hide all relative images
    for (const item of relativeImages) {
        const img = item.img;
        if (img && img.style) {
            img.style.display = 'none';
        }
    }
}

/**
 * [NEW] Process Foldable Elements
 * Wrap Code Blocks, SVGs, Mermaids in <details>
 */
function processFoldableElements(root) {
    if (!AppState.config) return;
    // We could add a config to disable this, but assuming enabled for Phase 1 as "Tag Folding"

    // 1. Code Blocks
    root.querySelectorAll('.code-block-wrapper').forEach(el => {
        // ▼ 追加: <p>内の要素（外部画像など）はDOM破壊を防ぐため折りたたまない
        if (el.closest('p')) return;
        // Extract language for summary
        const langLabel = el.querySelector('.language-label');
        const langText = langLabel ? langLabel.textContent : 'Code';
        wrapInDetails(el, `${langText} (onClick to toggle)`);
    });

    // 2. SVG (Explicit wrappers)
    root.querySelectorAll('.svg-view-wrapper').forEach(el => {
        // ▼ 追加: .code-block-wrapper内（SVGコードブロック）と<p>内は二重ラップ・DOM破壊を防止
        if (el.closest('.code-block-wrapper') || el.closest('p')) return;
        wrapInDetails(el, 'SVG Diagram');
    });

    // 3. Mermaid
    root.querySelectorAll('.mermaid-diagram-wrapper').forEach(el => {
        // ▼ 追加: .code-block-wrapper内と<p>内は二重ラップ・DOM破壊を防止
        if (el.closest('.code-block-wrapper') || el.closest('p')) return;
        wrapInDetails(el, 'Mermaid Chart');
    });

    // 4. Raw Tables (optional, but requested implicitly via "folding in editor... HTML")
    // root.querySelectorAll('table').forEach(el => {
    //     wrapInDetails(el, 'Table');
    // });
}

function wrapInDetails(element, summaryText) {
    // Check if parent is already a details (avoid double wrapping if re-running)
    if (element.parentNode && element.parentNode.tagName === 'DETAILS') return;

    const details = document.createElement('details');
    details.open = true; // Default open
    details.className = 'foldable-element-container';

    // ▼▼▼ 追加：元の要素から行番号・ハッシュを引き継ぎ、元からは削除（一番外側の枠が名札を持つ）▼▼▼
    ['data-line', 'data-line-end', 'data-block-hash'].forEach(attr => {
        if (element.hasAttribute(attr)) {
            details.setAttribute(attr, element.getAttribute(attr));
            element.removeAttribute(attr);
        }
    });
    // ▲▲▲ 追加ここまで ▲▲▲

    const summary = document.createElement('summary');
    summary.className = 'foldable-summary';
    // summaryは空にして、CSSで視覚的に非表示にする
    summary.textContent = '';

    // Preserve original element's position
    element.parentNode.insertBefore(details, element);
    details.appendChild(summary);
    details.appendChild(element);
}

/**
 * Process Relative Links in Tauri
 */
async function processLinks(root) {
    const tauri = AppState.tauri || window.__TAURI__;
    if (!tauri) return;

    const { path } = tauri;
    const links = root.querySelectorAll('a[data-original-href]');
    let baseDir = AppState.fileDirectory;

    if (!baseDir && AppState.fileFullPath) {
        try {
            baseDir = await path.dirname(AppState.fileFullPath);
        } catch (e) { }
    }

    if (!baseDir) return;

    for (const a of links) {
        const href = a.getAttribute('data-original-href');
        // Ignore external links, anchors, etc
        if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
            // Ensure external links open in browser
            if (href && href.startsWith('http')) {
                a.onclick = (e) => {
                    e.preventDefault();
                    if (tauri.shell && tauri.shell.open) {
                        tauri.shell.open(href);
                    } else if (window.__TAURI__ && window.__TAURI__.shell) {
                        window.__TAURI__.shell.open(href);
                    }
                };
            }
            continue;
        }

        try {
            let decodedHref = href;
            try { decodedHref = decodeURIComponent(href); } catch (e) { }

            // Resolve to absolute path
            const absolutePath = await path.join(baseDir, decodedHref);

            if (href.toLowerCase().endsWith('.md') || href.toLowerCase().endsWith('.markdown')) {
                a.onclick = (e) => {
                    e.preventDefault();
                    if (typeof openFileByPath === 'function') {
                        openFileByPath(absolutePath);
                    } else if (window.openFileByPath) {
                        window.openFileByPath(absolutePath);
                    }
                };
            } else {
                // Other files (PDF, etc) - use shell open
                a.onclick = (e) => {
                    e.preventDefault();
                    const shellOpen = (tauri.shell && tauri.shell.open) || (window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open);
                    if (shellOpen) {
                        shellOpen(absolutePath);
                    }
                };
            }

            a.title = absolutePath;
        } catch (e) {
            console.warn('Failed to resolve link in Tauri:', href, e);
        }
    }
}

/**
 * [NEW] Attach listeners to Mermaid Save buttons
 * Since innerHTML wipes out listeners, we re-bind them after render
 */
/**
 * Attach listeners for Mermaid AND SVG save buttons
 */
function attachSVGSaveListeners() {
    if (!DOM.preview) return;
    const saveButtons = DOM.preview.querySelectorAll('.btn-save-mermaid, .btn-save-svg');

    saveButtons.forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            let svgEl = null;

            // Mermaid check
            let diagramWrapper = btn.closest('.mermaid-diagram-wrapper');
            if (!diagramWrapper) {
                const codeWrapper = btn.closest('.code-block-wrapper');
                if (codeWrapper) {
                    diagramWrapper = codeWrapper.querySelector('.mermaid-diagram-wrapper');
                }
            }
            if (diagramWrapper) {
                svgEl = diagramWrapper.querySelector('svg');
            }

            // SVG check if not handled by mermaid
            if (!svgEl) {
                const codeWrapper = btn.closest('.code-block-wrapper');
                if (codeWrapper) {
                    const svgWrapper = codeWrapper.querySelector('.svg-view-wrapper');
                    if (svgWrapper) {
                        svgEl = svgWrapper.querySelector('svg');
                    }
                }
            }

            if (!svgEl) {
                console.error('SVG element not found for saving');
                return;
            }

            // Add XML namespace if missing
            if (!svgEl.getAttribute('xmlns')) {
                svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            }

            const svgData = svgEl.outerHTML;
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const defaultFileName = `mermaid-diagram-${timestamp}.svg`;

                if (window.__TAURI__) {
                    const { dialog, fs } = window.__TAURI__;
                    const targetPath = await dialog.save({
                        defaultPath: defaultFileName,
                        filters: [{
                            name: 'SVG Image',
                            extensions: ['svg']
                        }]
                    });
                    if (targetPath) {
                        await fs.writeTextFile(targetPath, svgData);
                        if (typeof showToast === 'function') showToast(t('toast.svgSaved'));
                    }
                } else if (window.showSaveFilePicker) {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: defaultFileName,
                        types: [{
                            description: 'SVG Image',
                            accept: { 'image/svg+xml': ['.svg'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(svgData);
                    await writable.close();
                    if (typeof showToast === 'function') showToast(t('toast.svgSaved'));
                } else {
                    // Fallback to auto-download
                    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                    if (typeof downloadBlob === 'function') {
                        downloadBlob(blob, defaultFileName);
                    } else {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = defaultFileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                    if (typeof showToast === 'function') showToast(t('toast.svgSaved'));
                }
            } catch (err) {
                // Ignore AbortError caused by user cancelling the picker
                if (err.name !== 'AbortError' && !err.toString().includes('User cancelled')) {
                    console.error('Save error:', err);
                    alert(t('error.saveFailed') + err.message);
                }
            }
        };

        // Prevent event capture by other modules
        btn.onmousedown = (e) => {
            e.stopPropagation();
        };
    });
}

/**
 * [NEW] Fixup existing SVG animations to support new Pattern 1 (preview) and Slide rules
 */
function fixupSvgAnimations() {
    if (!document.getElementById('svg-global-overrides')) {
        const style = document.createElement('style');
        style.id = 'svg-global-overrides';
        style.textContent = `
            /* プレビュー表示: SVGブロック全体(.svg-block-focused) または図形自体(:focus)にフォーカスがないと停止 */
            #preview:not(.playing-sequence) svg:not(.svg-block-focused) [data-anim-trigger="auto"]:not(:focus) {
                animation-play-state: paused !important;
            }
            #preview:not(.playing-sequence) svg:not(.svg-block-focused) [class*="anim-trigger-auto"]:not(:focus) {
                animation-play-state: paused !important;
            }

            /* Stepモードの特別制御: フォーカスされても Spaceが押される(anim-step-active)まで動かさない */
            #preview svg[data-anim-sequence-mode="step"] [data-anim-trigger="auto"]:not(.anim-step-active):not(:focus),
            #slideshow-overlay svg[data-anim-sequence-mode="step"] [data-anim-trigger="auto"]:not(.anim-step-active):not(:focus) {
                animation-play-state: paused !important;
            }
            #preview svg[data-anim-sequence-mode="step"] [class*="anim-trigger-auto"]:not(.anim-step-active):not(:focus),
            #slideshow-overlay svg[data-anim-sequence-mode="step"] [class*="anim-trigger-auto"]:not(.anim-step-active):not(:focus) {
                animation-play-state: paused !important;
            }

            /* Stepモードで発火した要素は、元のDelayを無視して即座に(0s)再生する */
            #preview svg[data-anim-sequence-mode="step"] .anim-step-active,
            #slideshow-overlay svg[data-anim-sequence-mode="step"] .anim-step-active {
                animation-play-state: running !important;
                animation-delay: 0s !important;
            }
        `;
        document.head.appendChild(style);
    }

    if (!DOM.preview) return;

    const isSlideshow = document.body.classList.contains('slideshow-active');

    DOM.preview.querySelectorAll('svg').forEach(svg => {
        // 1. Ensure all animated wrappers have tabindex="0" for focus events (Pattern 1)
        svg.querySelectorAll('[class*="anim-wrapper-"]').forEach(wrapper => {
            if (!wrapper.hasAttribute('tabindex')) {
                wrapper.setAttribute('tabindex', '0');
                wrapper.style.outline = 'none'; // クリック時の青枠を消す
            }
            // クリーンアップ（過去の不要な属性がMarkdownに混入した場合の除去）
            wrapper.removeAttribute('data-saved-animation');
            wrapper.removeAttribute('data-focus-fix-bound');
            wrapper.removeAttribute('data-log-bound');
            wrapper.classList.remove('anim-step-active');

            // SVGの<g>要素はマウスクリックでフォーカスを取得しないため、JSで強制する
            if (!wrapper.dataset.mousedownBound) {
                wrapper.dataset.mousedownBound = "1";
                wrapper.addEventListener('mousedown', (e) => {
                    if (document.body.classList.contains('slideshow-active')) return;
                    e.stopPropagation();
                    wrapper.focus();
                });
            }

            // 個別の図形クリック時の再始動（WebKit等のリスタート対策）
            if (!wrapper.dataset.focusBound) {
                wrapper.dataset.focusBound = "1";
                wrapper.addEventListener('focus', () => {
                    const anim = wrapper.style.animation;
                    if (anim && anim !== 'none') {
                        wrapper.style.animation = 'none';
                        wrapper.getBoundingClientRect(); // reflow for SVG
                        wrapper.style.animation = anim;
                    }
                });
            }
        });

        // 2. Fix local <style> tags to include slideshow overrides for click triggers
        const styleTag = svg.querySelector('#svg-animations');
        if (styleTag) {
            let css = styleTag.textContent || '';
            let modified = false;
            
            const regex = /\.anim-trigger-[\w-]+\:focus\s*\{\s*animation\:\s*([^!}]+)\!important;/g;
            let match;
            while ((match = regex.exec(css)) !== null) {
                const animValue = match[1].trim();
                const classNameMatch = match[0].match(/\.(anim-trigger-[\w-]+)/);
                if (classNameMatch) {
                    const className = classNameMatch[1];
                    if (!css.includes(`#slideshow-content .${className}`)) {
                        css += `\n#slideshow-content .${className} { animation: ${animValue} !important; outline: none; }`;
                        modified = true;
                    }
                }
            }
            
            if (modified) {
                styleTag.textContent = css;
                console.log(`[Animation] Fixed up CSS for slideshow: `, css);
            }
        }
    });
}

/**
 * [NEW] Attach listeners for Wrap and Unwrap SVG buttons
 */
function attachSVGToggleListeners() {
    fixupSvgAnimations();

    if (!DOM.preview) return;

    // Attach Unwrap Handlers
    const unwrapButtons = DOM.preview.querySelectorAll('.btn-unwrap-svg');
    console.log(`[attachSVGToggleListeners] Found ${unwrapButtons.length} Unwrap buttons`);
    unwrapButtons.forEach(btn => {
        btn.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('[UnwrapBtn] Hook triggered!');

            const wrapper = btn.closest('.code-block-wrapper');
            const svgContainer = wrapper ? wrapper.querySelector('.svg-view-wrapper') : null;
            if (!svgContainer) return;

            const index = parseInt(svgContainer.getAttribute('data-svg-index'));
            if (typeof DOM !== 'undefined' && DOM.editor && !isNaN(index)) {
                const editorContent = typeof getEditorText === 'function' ? getEditorText() : '';
                const lines = editorContent.split('\n');
                let currentIdx = 0, startIdx = -1, endIdx = -1, inBlock = false;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === '```svg') {
                        if (currentIdx === index) { startIdx = i; inBlock = true; }
                        currentIdx++;
                    } else if (inBlock && lines[i].trim() === '```') {
                        endIdx = i;
                        break;
                    }
                }
                if (startIdx !== -1 && endIdx !== -1) {
                    const innerCode = lines.slice(startIdx + 1, endIdx).join('\n');
                    DOM.editor.replaceLines(startIdx + 1, endIdx + 1, innerCode);
                    if (typeof AppState !== 'undefined') {
                        AppState.text = getEditorText();
                        AppState.isModified = true;
                    }

                    // 確実な再描画のトリガー
                    if (typeof window.render === 'function') {
                        console.log('[UnwrapBtn] Force calling render() directly');
                        window.render(getEditorText());
                    } else if (DOM.editor && DOM.editor.dispatchEvent) {
                        console.log('[UnwrapBtn] Dispatching input event');
                        DOM.editor.dispatchEvent(new Event('input'));
                    }
                }
            }
        };
        btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.ondblclick = (e) => { e.stopPropagation(); e.preventDefault(); };
    });

    // Attach Wrap Handlers
    const wrapButtons = DOM.preview.querySelectorAll('.btn-wrap-svg');
    wrapButtons.forEach(btn => {
        btn.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();

            const wrapper = btn.closest('.raw-svg-container');
            if (!wrapper) return;

            const lineStart = parseInt(wrapper.getAttribute('data-line'), 10);
            const lineEnd = parseInt(wrapper.getAttribute('data-line-end'), 10);
            if (typeof DOM !== 'undefined' && DOM.editor && !isNaN(lineStart) && !isNaN(lineEnd)) {
                const editorContent = typeof getEditorText === 'function' ? getEditorText() : '';
                const lines = editorContent.split('\n');
                const startIdx = lineStart - 1;
                const innerCode = lines.slice(startIdx, lineEnd).join('\n');

                console.log(`[WrapBtn] Replacing lines ${lineStart} to ${lineEnd}`);
                DOM.editor.replaceLines(lineStart, lineEnd, '```svg\n' + innerCode + '\n```');

                if (typeof AppState !== 'undefined') {
                    AppState.text = getEditorText();
                    AppState.isModified = true;
                }

                // 確実な再描画のトリガー
                if (typeof window.render === 'function') {
                    console.log('[WrapBtn] Force calling render() directly');
                    window.render(getEditorText());
                } else if (DOM.editor && DOM.editor.dispatchEvent) {
                    console.log('[WrapBtn] Dispatching input event');
                    DOM.editor.dispatchEvent(new Event('input'));
                }
            }
        };
        btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.ondblclick = (e) => { e.stopPropagation(); e.preventDefault(); };
    });
}

// [NEW] Hot-reload safeguard: if `md` exists but the new html_block rule isn't applied (e.g., during live edit of renderer.js), force setup.
if (typeof md !== 'undefined' && md !== null && md.renderer && md.renderer.rules.html_block) {
    if (!md.renderer.rules.html_block.toString().includes('raw-svg-container')) {
        setupMarkdownIt();
    }
}

/**
 * [NEW] 外部SVGおよびラスタ画像（ペイントツール）リンク画像の処理
 */
function processExternalImages(root) {
    const images = root.querySelectorAll('img');
    images.forEach((img) => {
        const src = img.getAttribute('src');
        const originalSrc = img.getAttribute('data-original-src');
        const targetSrc = originalSrc || src || '';
        
        if (!targetSrc) return;

        const lowerSrc = targetSrc.toLowerCase();
        const isSvg = lowerSrc.endsWith('.svg') || lowerSrc.startsWith('data:image/svg+xml') || (src && src.startsWith('data:image/svg+xml'));
        const isRaster = lowerSrc.endsWith('.png') || lowerSrc.endsWith('.jpg') || lowerSrc.endsWith('.jpeg') || lowerSrc.endsWith('.webp') || lowerSrc.startsWith('data:image/png') || lowerSrc.startsWith('data:image/jpeg') || lowerSrc.startsWith('data:image/webp');

        if (isSvg || isRaster) {
            // 親が既にもしラップされていたら無視
            if (img.parentElement && (img.parentElement.classList.contains('svg-external-container') || img.parentElement.classList.contains('raster-external-container'))) return;

            // ラッパー作成
            // ▼▼▼ 変更：<p>内でDOM破壊が起きないよう div から span に変更 ▼▼▼
            const wrapper = document.createElement('span');
            // ▲▲▲ 変更ここまで ▲▲▲
            wrapper.className = (isSvg ? 'svg-external-container' : 'raster-external-container') + ' code-block-wrapper';
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            wrapper.style.verticalAlign = 'top';

            // SVG内部の表示サイズ崩れ対策 (インラインCSSで強制指定)
            // viewBoxやwidth/heightを持たない一部のSVGが潰れて見えなくなるのを防ぐ
            if (isSvg) {
                if (!img.style.maxWidth) {
                    img.style.maxWidth = '100%';
                }
                if (!img.style.minHeight) {
                    img.style.minHeight = '75px';
                }
            }
            
            // 元のimgを複製または移動
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);

            // ボタングループ（code-controlsスタイルを適用）
            // ▼▼▼ 変更：<span>内でもレイアウトが崩れないよう div→span に変更 ▼▼▼
            const controls = document.createElement('span');
            controls.className = 'code-controls';
            controls.style.display = 'inline-flex'; // UIレイアウト崩れ防止
            // ▲▲▲ 変更ここまで ▲▲▲
            
            // ラベル
            // ▼▼▼ 変更：div→span に変更 ▼▼▼
            const langLabel = document.createElement('span');
            // ▲▲▲ 変更ここまで ▲▲▲
            langLabel.className = 'language-label';
            langLabel.textContent = isSvg ? 'SVG' : '画像';
            controls.appendChild(langLabel);

            const trEdit = typeof I18n !== 'undefined' ? I18n.translate('editor.edit') : '編集';
            const trReload = typeof I18n !== 'undefined' ? (I18n.translate('editor.reload') || '再読込') : '再読込';
            
            // 再読込ボタン
            const reloadBtn = document.createElement('button');
            reloadBtn.className = 'code-edit-btn ' + (isSvg ? 'btn-svg-external-reload' : 'btn-paint-external-reload');
            reloadBtn.textContent = trReload;
            reloadBtn.title = typeof I18n !== 'undefined' ? I18n.translate('fileMenu.reloadFile') || '再読み込み' : '再読み込み';
            reloadBtn.setAttribute('data-target-src', targetSrc);

            // 編集ボタン
            const editBtn = document.createElement('button');
            editBtn.className = 'code-edit-btn ' + (isSvg ? 'btn-svg-external-edit' : 'btn-paint-external-edit');
            editBtn.textContent = trEdit; // SVG・ラスター両方「編集」
            editBtn.title = '画像エディタで編集';
            editBtn.setAttribute('data-target-src', targetSrc);
            // ロード用src: img.srcはレンダラーがbase64変換済み（ローカルファイルの相対パスは直接fetch不可のため）
            // data-load-src にセットしておき、ペイントツール起動時はこちらを使う
            const imgCurrentSrc = img.getAttribute('src') || '';
            editBtn.setAttribute('data-load-src', imgCurrentSrc || targetSrc);
            if (src && src.startsWith('data:image/') && !originalSrc) {
                // data-original-src がない場合のみ base64 埋め込み扱いにする。
                // data-original-src がある場合はレンダラーがローカルファイルをbase64に変換したものなので
                // base64埋め込みとして扱わない（ローカルファイルパスとして保存処理させる）。
                editBtn.setAttribute('data-base64-src', src);
            }
            
            // [NEW] 画像保存ボタン
            const saveBtn = document.createElement('button');
            saveBtn.className = 'code-edit-btn btn-image-export-save';
            saveBtn.textContent = '保存';
            saveBtn.title = '画像をファイルとして保存';
            saveBtn.setAttribute('data-target-src', targetSrc);
            saveBtn.setAttribute('data-load-src', imgCurrentSrc || targetSrc);
            if (src && src.startsWith('data:image/') && !originalSrc) {
                saveBtn.setAttribute('data-base64-src', src);
            }
            
            controls.appendChild(reloadBtn);
            controls.appendChild(editBtn);
            controls.appendChild(saveBtn);
            wrapper.appendChild(controls);
        }
    });
}

function attachExternalSVGListeners() {
    if (!DOM.preview) return;

    // 再読込ボタン
    const reloadBtns = DOM.preview.querySelectorAll('.btn-svg-external-reload');
    reloadBtns.forEach(btn => {
        if (btn.hasAttribute('data-bound')) return;
        btn.setAttribute('data-bound', 'true');

        btn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetSrc = btn.getAttribute('data-target-src');
            if (!targetSrc) return;

            window.assetCacheBusters = window.assetCacheBusters || {};
            window.assetCacheBusters[targetSrc] = Date.now();

            if (typeof window.render === 'function' && typeof getEditorText === 'function') {
                if (typeof showToast === 'function') showToast(t('toast.imageReloaded'), "success");
                window.render(getEditorText());
            }
        };
    });

    const editBtns = DOM.preview.querySelectorAll('.btn-svg-external-edit');
    editBtns.forEach(btn => {
        // [FIX] Multiple attachment prevention
        if (btn.hasAttribute('data-bound')) return;
        btn.setAttribute('data-bound', 'true');

        btn.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            const targetSrc = btn.getAttribute('data-target-src');
            if (!targetSrc) return;

            // Tauriでの別ウィンドウ起動
            const tauri = AppState.tauri || window.__TAURI__;
            if (tauri) {
                const { path } = tauri;
                let absolutePath = targetSrc;

                // Base64 はTauriの別ウィンドウでそのまま開けない（ファイルパスではない）ので拒否
                if (targetSrc.startsWith('data:')) {
                    if (typeof showToast === 'function') showToast(t('toast.base64ExtEditError'), 'warning');
                    return;
                }

                // URL/http は開けない
                if (targetSrc.startsWith('http')) {
                    if (typeof showToast === 'function') showToast(t('toast.webImgExtEditError'), 'warning');
                    return;
                }

                try {
                    let baseDir = AppState.fileDirectory;
                    if (!baseDir) {
                        if (typeof showToast === 'function') showToast(t('error.baseDirUnknown'), 'error');
                        return;
                    }
                    
                    let decodedPath = decodeURIComponent(targetSrc);
                    absolutePath = await path.join(baseDir, decodedPath);
                    
                    let WebviewWindow;
                    if (tauri.webviewWindow && tauri.webviewWindow.WebviewWindow) {
                        WebviewWindow = tauri.webviewWindow.WebviewWindow;
                    } else {
                        throw new Error("WebviewWindow API missing");
                    }
                    
                    const label = 'svg-editor-' + Date.now();
                    const url = 'index.html?mode=svg&filepath=' + encodeURIComponent(absolutePath);
                    console.log("[ExternalSVG] Opening new window with URL:", url);
                    
                    const webview = new WebviewWindow(label, {
                        url: url,
                        title: 'SVG Editor - ' + decodedPath,
                        width: Math.max(820, AppState.config.previewWidth + 100),
                        height: 800
                    });
                } catch (err) {
                    console.error('Failed to open external SVG editor:', err);
                    alert(t('error.editorLaunchFailed') + err.message);
                }
            } else {
                // Browser fallback
                let url = 'index.html?mode=svg&filepath=' + encodeURIComponent(targetSrc);
                
                // [FIX] file:/// プロトコルでの CORS エラー回避のため、ロード済みのBase64データを渡す
                // data-base64-src: Markdown直接埋め込みのbase64
                // data-load-src: レンダラーがローカルファイルをBase64に変換したもの（img.src）
                const base64Src = btn.getAttribute('data-base64-src') || btn.getAttribute('data-load-src');
                if (base64Src && (base64Src.startsWith('data:') || base64Src.startsWith('blob:'))) {
                    const transferKey = 'svg_transfer_' + Date.now();
                    try {
                        sessionStorage.setItem(transferKey, base64Src);
                        url += '&transfer=' + transferKey;
                        console.log('[ExternalSVG] Browser mode: passing SVG data via sessionStorage, key:', transferKey);
                    } catch (e) {
                        console.warn("[ExternalSVG] sessionStorage exceeded", e);
                    }
                } else {
                    console.warn('[ExternalSVG] Browser mode: no Base64 data available for', targetSrc);
                }

                window.open(url, '_blank');
            }
        };
    });
}

function attachExternalPaintListeners() {
    if (!DOM.preview) return;

    // 再読込ボタン
    const reloadBtns = DOM.preview.querySelectorAll('.btn-paint-external-reload');
    reloadBtns.forEach(btn => {
        if (btn.hasAttribute('data-bound')) return;
        btn.setAttribute('data-bound', 'true');

        btn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetSrc = btn.getAttribute('data-target-src');
            if (!targetSrc) return;

            window.assetCacheBusters = window.assetCacheBusters || {};
            window.assetCacheBusters[targetSrc] = Date.now();

            if (typeof window.render === 'function' && typeof getEditorText === 'function') {
                if (typeof showToast === 'function') showToast(t('toast.imageReloaded'), "success");
                window.render(getEditorText());
            }
        };
    });

    const editBtns = DOM.preview.querySelectorAll('.btn-paint-external-edit');
    editBtns.forEach(btn => {
        // [FIX] Multiple attachment prevention
        if (btn.hasAttribute('data-bound')) return;
        btn.setAttribute('data-bound', 'true');

        btn.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            const targetSrc = btn.getAttribute('data-target-src');
            if (!targetSrc) return;

         // Paint Overlay 起動
            const overlayBg = document.getElementById('paint-overlay-bg');
            const overlay = document.getElementById('paint-overlay-container');
            if (!overlayBg || !overlay) {
                if (typeof showToast === 'function') showToast(t('error.paintUiNotFound'), 'error');
                return;
            }

            // 閉じる共通処理
            const closePaintOverlay = () => {
                overlayBg.style.display = 'none';
                overlay.innerHTML = '';
                document.removeEventListener('keydown', escHandler);
                overlayBg.removeEventListener('click', bgClickHandler);
            };

            // 初期化
            overlay.innerHTML = '';
            overlayBg.style.display = 'flex';

            // ESCキーで閉じる
            const escHandler = (evt) => {
                if (evt.key === 'Escape') closePaintOverlay();
            };
            document.addEventListener('keydown', escHandler);

            // 背景（暗い部分）クリックで閉じる（キャンセル扱い）
            const bgClickHandler = (evt) => {
                if (evt.target === overlayBg) closePaintOverlay();
            };
            overlayBg.addEventListener('click', bgClickHandler);

            // PaintLibrary の生成
            try {
                if (typeof PaintLibrary === 'undefined') {
                    if (typeof showToast === 'function') showToast(t('error.paintJsMissing'), 'error');
                    overlay.style.display = 'none';
                    return;
                }

                // paintLibをletで先に宣言（ColorPickerUIコンストラクタ内でonChangeが即呼ばれるため）
                let paintLib = null;

                // カラーピッカーを先に宣言（PaintLibraryのクロージャーから参照できるようにするため）
                let paintColorPicker = null;
                if (typeof ColorPickerUI !== 'undefined') {
                    paintColorPicker = new ColorPickerUI({
                        color: '#000000',
                        isPopup: true,
                        layout: 'horizontal',
                        onChange: (color) => {
                            if (paintLib) paintLib.setColor(color.toHexString(true));
                        }
                    });
                }

                paintLib = new PaintLibrary({
                    container: overlay,
                    width: Math.round(window.innerWidth * 0.88),
                    height: Math.round(window.innerHeight * 0.85),
                    toolbar: true,
                    editableShapes: true, // 図形配置後に選択・移動・リサイズを有効化
                    toolbarItems: {
                        savePng: false, // PNGダウンロードは隠す
                        save: false,    // ツールバーの上書き保存は使わない（下部actionButtonsを使う）
                        close: false    // 閉じるボタンも下部キャンセルに統一
                    },
                    actionButtons: {
                        cancelText: 'キャンセル',
                        saveText: '保存',
                        onCancel: () => {
                            closePaintOverlay();
                        },
                        onSave: async (editedBase64) => {
                            // ※ closePaintOverlay()はここでは呼ばない。
                            // 参考実装(index.html)と同様に、保存完了後にオーバーレイを閉じる。
                            // 先に閉じるとDOMが破壊されてキャンバス参照やダイアログ表示が失敗する。

                            const tauri = AppState.tauri || window.__TAURI__;

                            // Helper: Base64 -> Uint8Array
                            const base64ToBytes = (b64) => {
                                const base64Data = b64.replace(/^data:image\/\w+;base64,/, '');
                                const binary_string = window.atob(base64Data);
                                const len = binary_string.length;
                                const bytes = new Uint8Array(len);
                                for (let i = 0; i < len; i++) {
                                    bytes[i] = binary_string.charCodeAt(i);
                                }
                                return bytes;
                            };

                            const b64Src = btn.getAttribute('data-base64-src') || (targetSrc && targetSrc.startsWith('data:') ? targetSrc : null);

                            if (b64Src) {
                                // ─── Base64画像 → Markdownに書き戻す ───
                                closePaintOverlay(); // Base64の場合は即座に閉じてよい
                                try {
                                    let currentText = typeof getEditorText === 'function' ? getEditorText() : (AppState.text || '');

                                    // まず完全一致で検索
                                    let found = currentText.includes(b64Src);
                                    let newText = null;

                                    if (found) {
                                        // 完全一致で置換（最初の1件のみ）
                                        newText = currentText.replace(b64Src, editedBase64);
                                    } else {
                                        // 完全一致失敗時: Markdownの画像構文にある data: URL を正規表現で検索
                                        // DOMがbase64を正規化した場合に備えたフォールバック
                                        console.warn('[Paint] b64Src exact match failed, trying regex fallback...');
                                        // Markdownの ![alt](data:image/...;base64,...) 内のbase64部分を特定する
                                        // base64文字列: A-Za-z0-9+/=
                                        const imgMdRegex = /!\[[^\]]*\]\((data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)\)/g;
                                        let match;
                                        const candidateUrls = [];
                                        while ((match = imgMdRegex.exec(currentText)) !== null) {
                                            candidateUrls.push({ url: match[1], index: match.index, full: match[0] });
                                        }
                                        console.log('[Paint] Found', candidateUrls.length, 'base64 image(s) in Markdown');

                                        if (candidateUrls.length === 1) {
                                            // 候補が1つだけなら確実にそれを置換
                                            newText = currentText.replace(candidateUrls[0].url, editedBase64);
                                            found = true;
                                        } else if (candidateUrls.length > 1) {
                                            // 複数ある場合: 先頭から一致する長さで最も近いものを選ぶ
                                            const b64Data = b64Src.replace(/^data:image\/[a-z+]+;base64,/, '');
                                            const prefix = b64Data.substring(0, 50); // 先頭50文字で比較
                                            const best = candidateUrls.find(c => c.url.includes(prefix));
                                            if (best) {
                                                newText = currentText.replace(best.url, editedBase64);
                                                found = true;
                                            }
                                        }
                                    }

                                    if (found && newText !== null) {
                                        // CodeMirror 6 へ書き込む（setEditorText が正解）
                                        if (typeof setEditorText === 'function') {
                                            setEditorText(newText);
                                        } else if (typeof window.setEditorText === 'function') {
                                            window.setEditorText(newText);
                                        } else if (DOM && DOM.editor) {
                                            DOM.editor.value = newText;
                                        }
                                        AppState.text = newText;
                                        AppState.isModified = true;
                                        // プレビューを再描画
                                        if (typeof window.render === 'function') window.render();
                                        if (typeof showToast === 'function') showToast(t('toast.imageSavedToMd'), "success");
                                    } else {
                                        console.error('[Paint] Base64 not found in Markdown. b64Src length:', b64Src?.length);
                                        alert(t('alert.imageNotFoundDownload'));
                                        const a = document.createElement('a');
                                        a.href = editedBase64;
                                        a.download = 'edited-image.png';
                                        a.click();
                                    }
                                } catch (e) {
                                    console.error(e);
                                    alert(t('alert.mdSaveFailed'));
                                }
                            } else if (targetSrc && !targetSrc.startsWith('http')) {
                                // ─── ローカルファイルパス → 確認ダイアログ → 上書き保存 ───
                                // ダイアログはオーバーレイ(z-index:99990)より高いz-index(200001)で表示する。
                                // User Activation を維持するため、保存処理全体をOKボタンのonclick内で実行する。
                                // await customConfirm() → await showSaveFilePicker() と2段階awaitすると
                                // クリックのUser Activationが失効するため、ダイアログのOKクリック自体を
                                // 新たなUser Activationとして利用する実装にする（参考実装と同じパターン）。
                                const fileName = decodeURIComponent(targetSrc).split(/[/\\]/).pop();
                                const ext = fileName.split('.').pop().toLowerCase();
                                const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                                               : ext === 'webp' ? 'image/webp'
                                               : 'image/png';

                                await new Promise((resolveDialog) => {
                                    // ─ ダイアログ構築 ─
                                    const bg = document.createElement('div');
                                    bg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:200001;display:flex;align-items:center;justify-content:center;';
                                    const box = document.createElement('div');
                                    box.style.cssText = 'background:#2a2a2e;padding:24px;border-radius:10px;border:1px solid #4a4a5a;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.7);min-width:320px;max-width:480px;';
                                    const textEl = document.createElement('p');
                                    textEl.style.cssText = 'margin:0 0 20px 0;white-space:pre-wrap;color:#e0e0e0;font-size:14px;word-break:break-all;';
                                    textEl.textContent = `ファイル「${fileName}」を上書き保存します。\nよろしいですか？`;
                                    const btnRow = document.createElement('div');
                                    btnRow.style.cssText = 'display:flex;justify-content:center;gap:12px;';
                                    const cancelBtn = document.createElement('button');
                                    cancelBtn.textContent = 'キャンセル';
                                    cancelBtn.style.cssText = 'flex:1;padding:8px;background:#444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;';
                                    const okBtn = document.createElement('button');
                                    okBtn.textContent = 'OK（上書き）';
                                    okBtn.style.cssText = 'flex:1;padding:8px;background:#c0392b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;';
                                    cancelBtn.onmouseover = () => cancelBtn.style.background = '#555';
                                    cancelBtn.onmouseout  = () => cancelBtn.style.background = '#444';
                                    okBtn.onmouseover = () => okBtn.style.background = '#e74c3c';
                                    okBtn.onmouseout  = () => okBtn.style.background = '#c0392b';

                                    // キャンセル: ダイアログを消してオーバーレイを閉じる（参考実装と同様）
                                    cancelBtn.onclick = () => {
                                        document.body.removeChild(bg);
                                        closePaintOverlay();
                                        resolveDialog();
                                    };

                                    // ─ OKボタン: このクリック自体が新たなUser Activationになる ─
                                    okBtn.onclick = async () => {
                                        document.body.removeChild(bg);

                                        if (tauri) {
                                            // Tauri環境: writeBinaryFileで直接上書き
                                            try {
                                                const { fs, path } = tauri;
                                                const baseDir = AppState.fileDirectory;
                                                const decodedPath = decodeURIComponent(targetSrc);
                                                const absolutePath = baseDir ? await path.join(baseDir, decodedPath) : decodedPath;
                                                const bytes = base64ToBytes(editedBase64);
                                                await fs.writeBinaryFile(absolutePath, bytes);
                                                closePaintOverlay(); // 保存成功後にオーバーレイを閉じる
                                                if (typeof showToast === 'function') showToast(t('toast.localFileOverwritten'), "success");
                                                window.assetCacheBusters = window.assetCacheBusters || {};
                                                window.assetCacheBusters[targetSrc] = Date.now();
                                                if (typeof window.render === 'function') window.render();
                                            } catch (e) {
                                                console.error(e);
                                                closePaintOverlay();
                                                if (typeof showToast === 'function') showToast(t('error.saveFailedMsg') + e.message, "error");
                                                const a = document.createElement('a');
                                                a.href = editedBase64;
                                                a.download = fileName;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                            }
                                        } else {
                                            // ブラウザ環境: AppState.fileDirectory（ディレクトリハンドル）から
                                            // ファイルハンドルを取得して createWritable() で直接上書きする。
                                            // 参考実装(index.html)の droppedFileHandle.createWritable() と同じパターン。
                                            const dirHandle = AppState.fileDirectory;
                                            let imgFileHandle = null;

                                            if (dirHandle && typeof resolveRelativePath === 'function') {
                                                try {
                                                    const decodedPath = decodeURIComponent(targetSrc);
                                                    imgFileHandle = await resolveRelativePath(dirHandle, decodedPath);
                                                } catch(e) {
                                                    console.warn('[Paint] ファイルハンドル取得失敗:', e);
                                                }
                                            }

                                            if (imgFileHandle && typeof imgFileHandle.createWritable === 'function') {
                                                // ファイルハンドルがあれば書き込み権限を確認・要求して直接上書き
                                                try {
                                                    let perm = await imgFileHandle.queryPermission({ mode: 'readwrite' });
                                                    if (perm === 'prompt') {
                                                        perm = await imgFileHandle.requestPermission({ mode: 'readwrite' });
                                                    }
                                                    if (perm !== 'granted') throw new Error('書き込み権限が拒否されました');

                                                    const writable = await imgFileHandle.createWritable();
                                                    const blob = await new Promise((r) => paintLib.getCanvas().toBlob(r, mimeType));
                                                    await writable.write(blob);
                                                    await writable.close();
                                                    closePaintOverlay();
                                                    if (typeof showToast === 'function') showToast(t('toast.fileOverwritten'), "success");
                                                    window.assetCacheBusters = window.assetCacheBusters || {};
                                                    window.assetCacheBusters[targetSrc] = Date.now();
                                                    if (typeof window.render === 'function') window.render();
                                                } catch (e) {
                                                    closePaintOverlay();
                                                    console.error('[Paint] 上書き保存エラー:', e);
                                                    if (typeof showToast === 'function') showToast(t('error.saveFailedMsg') + e.message, "error");
                                                    // フォールバック: ダウンロード
                                                    const a = document.createElement('a');
                                                    a.href = editedBase64;
                                                    a.download = fileName;
                                                    document.body.appendChild(a);
                                                    a.click();
                                                    document.body.removeChild(a);
                                                }
                                            } else {
                                                // ディレクトリハンドルなし or File System Access API非対応: ダウンロード
                                                closePaintOverlay();
                                                if (typeof showToast === 'function') showToast(t('toast.noFileHandleDownload'), "warning");
                                                const a = document.createElement('a');
                                                a.href = editedBase64;
                                                a.download = fileName;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                            }
                                        }

                                        resolveDialog();
                                    };

                                    btnRow.appendChild(cancelBtn);
                                    btnRow.appendChild(okBtn);
                                    box.appendChild(textEl);
                                    box.appendChild(btnRow);
                                    bg.appendChild(box);
                                    document.body.appendChild(bg);
                                    // ダイアログ表示後にOKボタンにフォーカス
                                    setTimeout(() => okBtn.focus(), 10);
                                });
                            } else {
                                // それ以外（外部URL等）: 保存データをダウンロードして閉じる
                                closePaintOverlay();
                            }
                        }
                    },
                    onColorPickerRequest: (currentColor, anchorEl) => {
                        // ColorPickerUIにsetColorはないのでshowのみ呼ぶ
                        if (paintColorPicker) {
                            paintColorPicker.show(anchorEl);
                        }
                    }
                });

                // 画像をロード
                // data-load-src: レンダラーが変換済みのsrc（base64 or URL）。相対パスでは fetch できないため。
                // data-base64-src: 本当にMarkdown直接埋め込みのbase64（保存先の判別用）。
                const loadSrc = btn.getAttribute('data-load-src') || btn.getAttribute('data-base64-src') || targetSrc;
                await paintLib.loadImage(loadSrc);

            } catch (err) {
                console.error('Failed to load PaintLibrary:', err);
                overlay.style.display = 'none';
                if (typeof showToast === 'function') showToast(t('error.paintToolLaunchFailed'), 'error');
            }
        };
    });
}

/**
 * [NEW] 画像保存ボタンのイベントリスナー
 */
function attachImageExportListeners() {
    if (!DOM.preview) return;
    
    // ダウンロード用ヘルパー
    const triggerImageDownload = async (blob, defaultFileName) => {
        if (window.showSaveFilePicker) {
            try {
                const extMatch = defaultFileName.match(/\.([a-zA-Z0-9]+)$/);
                const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
                let accept = {};
                if (ext === 'svg') accept = {'image/svg+xml': ['.svg']};
                else if (ext === 'jpg' || ext === 'jpeg') accept = {'image/jpeg': ['.jpg', '.jpeg']};
                else if (ext === 'webp') accept = {'image/webp': ['.webp']};
                else accept = {'image/png': ['.png']};
                
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultFileName,
                    types: [{
                        description: 'Image File',
                        accept: accept
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                if (typeof showToast === 'function') showToast(t('toast.imageSaved'), "success");
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error('File save error:', e);
                    if (typeof showToast === 'function') showToast(t('error.imageSaveFailed'), "error");
                }
            }
        } else {
            // Fallback
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = defaultFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast(t('toast.imageSaved'), "success");
        }
    };

    DOM.preview.querySelectorAll('.btn-image-export-save').forEach(btn => {
        if (btn.hasAttribute('data-bound-save')) return;
        btn.setAttribute('data-bound-save', 'true');
        
        btn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const base64Src = btn.getAttribute('data-base64-src');
            const loadSrc = btn.getAttribute('data-load-src');
            const targetSrc = btn.getAttribute('data-target-src');
            
            let defaultName = 'image.png';
            if (targetSrc && !targetSrc.startsWith('data:')) {
                const parts = targetSrc.split('/');
                let cand = parts[parts.length - 1];
                cand = cand.split('?')[0];
                if (cand) defaultName = cand;
            } else if (targetSrc && targetSrc.startsWith('data:image/svg')) {
                defaultName = 'image.svg';
            } else if (targetSrc && targetSrc.startsWith('data:image/jpeg')) {
                defaultName = 'image.jpg';
            }
            
            try {
                let blob;
                const sourceData = base64Src || loadSrc || targetSrc;
                if (sourceData.startsWith('data:')) {
                    const parts = sourceData.split(',');
                    const byteString = atob(parts[1]);
                    const mimeString = parts[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    blob = new Blob([ab], {type: mimeString});
                } else {
                    const res = await fetch(sourceData);
                    blob = await res.blob();
                }
                
                await triggerImageDownload(blob, defaultName);
            } catch (err) {
                console.error("Failed to export image:", err);
                if (typeof showToast === 'function') showToast(t('error.imageFetchFailed'), "error");
            }
        };
    });
}


setTimeout(() => {
    const previewEl = document.getElementById('preview');
    if (previewEl && typeof ResizeObserver !== 'undefined') {
        let lastHeight = previewEl.offsetHeight;
        const ro = new ResizeObserver((entries) => {
            let heightChanged = false;
            for (let entry of entries) {
                if (entry.target.offsetHeight !== lastHeight) {
                    lastHeight = entry.target.offsetHeight;
                    heightChanged = true;
                }
            }
            if (heightChanged && typeof schedulePageBreakDisplay === 'function') {
                schedulePageBreakDisplay();
            }
        });
        ro.observe(previewEl);
    }
}, 1000);

// [NEW] 動的に挿入されたSVG SMILアニメーションを強制再開するヘルパー
function startAllSvgAnimations(container) {
    if (!container) return;
    container.querySelectorAll('svg').forEach(svg => {
        try {
            let hasAnimation = false;
            svg.querySelectorAll('animateMotion, animate, animateTransform').forEach(anim => {
                hasAnimation = true;
                if (typeof anim.beginElement === 'function') {
                    anim.beginElement();
                }
            });
            if (hasAnimation && typeof svg.setCurrentTime === 'function') {
                svg.setCurrentTime(0);
            }
        } catch (e) {
            console.warn('[Renderer] Failed to start SVG animation:', e);
        }
    });
}
window.startAllSvgAnimations = startAllSvgAnimations;
