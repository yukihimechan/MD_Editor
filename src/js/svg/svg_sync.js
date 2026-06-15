/**
 * SVG Editor Sync Logic
 * - Sync changes to Markdown
 * - Handle canvas resize sync
 */

/**
 * Sync changes to the Markdown Editor
 * @param {boolean} silent - If true, sync source but don't trigger re-render. Default: true for safety.
 * @param {Object} overrideDims - Optional {w, h, x, y} to enforce specific canvas dimensions.
 */
let partialSyncTimeout = null;

// ゼロアロケーションでSVGブロックの位置を特定する高速スキャナ
function getSvgBlockInfo(text, targetSvgIndex) {
    if (!text) return null;
    let currentIdx = 0, searchPos = 0, currentLine = 0;

    while (true) {
        const startIdx = text.indexOf('```svg', searchPos);
        if (startIdx === -1) return null;

        // startIdxまでの改行を数える
        for (let i = searchPos; i < startIdx; i++) {
            if (text[i] === '\n') currentLine++;
        }
        const startLine = currentLine;

        const endIdx = text.indexOf('```', startIdx + 6);
        if (endIdx === -1) return null;

        // endIdxまでの改行を数える
        for (let i = startIdx; i < endIdx; i++) {
            if (text[i] === '\n') currentLine++;
        }
        const endLine = currentLine;

        if (currentIdx === targetSvgIndex) {
            let lineStart = text.lastIndexOf('\n', startIdx - 1);
            lineStart = lineStart === -1 ? 0 : lineStart + 1;
            const indentationMatch = text.substring(lineStart, startIdx).match(/^[ \t]*/);
            const indentation = indentationMatch ? indentationMatch[0] : '';
            
            return {
                startIdx, endIdx,
                startLine, endLine,
                content: text.substring(startIdx + 6, endIdx).trim(),
                indentation
            };
        }
        currentIdx++;
        // searchPosを進める
        for (let i = endIdx; i < endIdx + 3 && i < text.length; i++) {
             if (text[i] === '\n') currentLine++;
        }
        searchPos = endIdx + 3;
    }
}

// 既存の getSVGBlockText を以下に置換
function getSVGBlockText(svgIndex) {
    if (typeof getEditorText !== 'function') return null;
    const info = getSvgBlockInfo(getEditorText(), svgIndex);
    return info ? info.content : null;
}

function schedulePartialSync() {
    clearTimeout(partialSyncTimeout);
    partialSyncTimeout = setTimeout(() => {
        if (!window.currentEditingSVG) return;
        // 溜まった変更を同期実行（ドラッグ・リサイズ中は履歴に積まない）
        syncChanges(true, null, false); 
    }, 50); // 50ms（約20fps）のデバウンス
}
window.schedulePartialSync = schedulePartialSync;

// 操作開始前のエディタ状態をUNDO履歴のために明示的に保存するヘルパー
// [NOTE] ドラッグ中はエディタ同期をスキップしており、エディタは元々操作前の状態を維持しているため、
// ロールバックによる履歴管理は不要になり、この関数は無効化されました。
function startSVGUndoTracking() {
    // 処理をスキップ
}
window.startSVGUndoTracking = startSVGUndoTracking;

function syncChanges(silent = true, overrideDims = null, addToHistory = true) {
    if (window.currentEditingSVG && window.currentEditingSVG._initializing) {
        // console.log(`[svg_sync] syncChanges SKIPPED: initializing...`);
        return;
    }
    const cur = window.currentEditingSVG;
    if (cur) {
        // [NOTE] ロールバック履歴管理の廃止に伴い、操作開始前の保存処理をスキップします。
    }

    if (window.currentEditingSVG && window.currentEditingSVG._isOperationInProgress && !addToHistory) {
        // console.log(`[svg_sync] syncChanges SKIPPED: operation in progress and addToHistory is false`);
        return;
    }
    clearTimeout(partialSyncTimeout);
    partialSyncTimeout = null;
    // console.log(`[svg_sync] syncChanges called (silent: ${silent}, override: ${overrideDims ? 'yes' : 'no'}, addToHistory: ${addToHistory})`);
    
    // [FIX] アノテーションモード時の同期処理
    if (window.currentEditingSVG && window.currentEditingSVG._isAnnotationLayerMock) {
        if (typeof window.currentEditingSVG.pushUndoState === 'function') {
            window.currentEditingSVG.pushUndoState();
        }
        return;
    }

    if (!window.currentEditingSVG || !window.currentEditingSVG.container || window.currentEditingSVG.svgIndex === undefined) return;

    // [FIX] CSS 編集モード中は Markdown ソースへの書き出しをスキップする（保存ボタン押下時のみ書き出すため）
    if (window.currentEditingSVG._inCSSEditMode) {
        // console.log(`[svg_sync] syncChanges SKIPPED: In CSS Edit Mode. (Preview changes are UI-only)`);
        return;
    }

    // [NEW] Update hit areas for selected elements before syncing
    window.currentEditingSVG.selectedElements.forEach(el => {
        const shape = el.remember('_shapeInstance');
        if (shape) {
            if (shape.updateHitArea) shape.updateHitArea();
            // [NEW] Ensure all custom handles are synced whenever any change occurs
            if (shape.syncSelectionHandlers) shape.syncSelectionHandlers();
        }
    });

    // [NOTE] ロールバック履歴管理の廃止に伴い、確定同期時のテキスト復元処理をスキップします。

    // MutationObserverの未処理キューを即座に回収（タイミングズレ防止）
    if (cur.syncObserver) {
        const records = cur.syncObserver.takeRecords();
        if (records.length > 0 && typeof cur.syncQueue !== 'undefined') {
            const queue = cur.syncQueue;
            for (const mutation of records) {
                const targetNode = mutation.target;
                if (targetNode.nodeType !== 1) continue;

                if (targetNode.closest('.svg-grid-lines, .svg-canvas-proxy, .svg-snap-guides, .svg-interaction-hitarea, .svg-control-marker, .svg-ruler, .svg_select_group, .svg-grad-control-ui, .svg-grad-control-handle')) {
                    continue;
                }

                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    queue.requiresFullSync = true;
                } else if (mutation.type === 'attributes') {
                    if (targetNode.tagName.toLowerCase() === 'svg') {
                        queue.changedNodeIds.add('__root__');
                    } else {
                        const closestInteractive = targetNode.closest('[id]');
                        if (closestInteractive && closestInteractive.id) {
                            queue.changedNodeIds.add(closestInteractive.id);
                        }
                    }
                }
            }
        }
    }

    let isPartialSuccess = false;
    const queue = cur.syncQueue;

    // 確定同期（操作完了）のタイミングで履歴を強制分離し、自動マージを防ぐ
    const isolateHistory = addToHistory;

    // キャンバスのリサイズ(overrideDims) や 構造変更 がある場合は安全優先でフル同期
    if (queue && !queue.requiresFullSync && !overrideDims && queue.changedNodeIds.size > 0 && queue.changedNodeIds.size < 50) {
        // 属性の変更のみであれば超高速な部分同期
        isPartialSuccess = applyPartialSvgSync(cur.svgIndex, queue.changedNodeIds, silent, addToHistory, isolateHistory);
    }

    if (!isPartialSuccess) {
        // 部分同期がスキップされた、またはパースエラー等で失敗した場合は従来のフル同期へ
        syncSVGToEditor(cur.container, cur.svgIndex, silent, overrideDims, addToHistory, isolateHistory);
    }

    // キューの初期化
    if (queue) {
        queue.changedNodeIds.clear();
        queue.requiresFullSync = false;
    }

    // [NEW] Ensure transform toolbar is updated after sync
    if (typeof updateTransformToolbarValues === 'function') {
        updateTransformToolbarValues();
    }
}
window.syncChanges = syncChanges;

/**
 * 変更があったノードの「属性のみ」を高速同期する (Fast Path)
 */
function applyPartialSvgSync(targetSvgIndex, changedIds, silent, addToHistory = true, isolateHistory = false) {
    if (!DOM.editor || (window.currentEditingSVG && window.currentEditingSVG._updatingFromEditor)) return false;



    // 1. 正規表現のリスクを避け、既存と同じ行ベースでブロックを特定
    const editorContent = getEditorText();
    const lines = editorContent.split('\n');
    let currentIdx = 0, startLine = -1, endLine = -1, inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const lineStr = lines[i].trim();
        if (lineStr === '```svg') {
            if (currentIdx === targetSvgIndex) { startLine = i; inBlock = true; }
            currentIdx++;
        } else if (inBlock && lineStr === '```') {
            endLine = i;
            break;
        }
    }
    if (startLine === -1 || endLine <= startLine) return false;

    const indentationMatch = lines[startLine].match(/^\s*/);
    const indentation = indentationMatch ? indentationMatch[0] : '';
    const oldSvgString = lines.slice(startLine + 1, endLine).join('\n');

    // 2. ブロック内のみを DOMParser でパース (1〜2msで完了)
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(oldSvgString, 'image/svg+xml');
    if (svgDoc.querySelector('parsererror')) return false;

    let hasChange = false;
    const draw = window.currentEditingSVG.draw;
    const round3 = (val) => Math.round(parseFloat(val) * 1000) / 1000;

    // 3. 属性のピンポイントコピー
    changedIds.forEach(id => {
        let liveElNode = null, docEl = null;

        if (id === '__root__') {
            liveElNode = draw.node;
            docEl = svgDoc.documentElement;
        } else {
            const elements = draw.find(`#${id}`);
            if (elements.length > 0) liveElNode = elements[0].node;
            docEl = svgDoc.getElementById(id);
        }

        if (!liveElNode || !docEl) return;

        // [A] Live側で消えた属性の削除
        const liveAttrs = liveElNode.attributes;
        for (let i = docEl.attributes.length - 1; i >= 0; i--) {
            const name = docEl.attributes[i].name;
            if (name === 'xmlns' || name.startsWith('data-paper')) continue;
            if (!liveElNode.hasAttribute(name)) {
                docEl.removeAttribute(name);
                hasChange = true;
            }
        }

        // [B] 属性の転記と丸め処理
        for (let i = 0; i < liveAttrs.length; i++) {
            const name = liveAttrs[i].name;
            let val = liveAttrs[i].value;

            if (['data-is-proxy', 'data-is-canvas', 'data-internal', 'data-locked'].includes(name) && id !== '__root__') continue;

            if (name === 'class') {
                val = val.split(' ').filter(c => !c.includes('svg_select') && !c.includes('svg-interaction') && c !== 'svg-edit-selected').join(' ').trim();
                if (!val) { docEl.removeAttribute('class'); hasChange = true; continue; }
            }

            if (['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'].includes(name)) {
                if (!isNaN(val) && val !== '') val = round3(val).toString();
            } else if (['transform', 'd', 'points', 'data-poly-points', 'viewBox'].includes(name)) {
                if (val.includes('.')) val = val.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, m => round3(m));
            }

            if (docEl.getAttribute(name) !== String(val)) {
                docEl.setAttribute(name, String(val));
                hasChange = true;
            }
        }

        // [C] ルート要素特有の永続化メタデータ (data-paper-*) を強制注入
        if (id === '__root__') {
            const cur = window.currentEditingSVG;
            docEl.setAttribute('data-paper-zoom', cur.zoom || 100);
            docEl.setAttribute('data-paper-offx', cur.offX || 0);
            docEl.setAttribute('data-paper-offy', cur.offY || 0);
            if (cur.baseWidth) docEl.setAttribute('data-paper-width', Math.round(cur.baseWidth));
            if (cur.baseHeight) docEl.setAttribute('data-paper-height', Math.round(cur.baseHeight));
            hasChange = true;
        }
    });

    if (!hasChange) return true;

    // 4. 文字列化し、インデントを整える
    const serializer = new XMLSerializer();
    let newSvgString = serializer.serializeToString(svgDoc.documentElement);
    if (typeof formatSVGCode === 'function') newSvgString = formatSVGCode(newSvgString);

    const indentedSvgCode = newSvgString.split('\n')
        .map(line => line.trim() ? indentation + line : line).join('\n');
    const newBlock = `${indentation}\`\`\`svg\n${indentedSvgCode}\n${indentation}\`\`\``;

    // [SAFETY] 逆方向同期タイマーのキャンセル
    if (window.currentEditingSVG) {
        window.currentEditingSVG._syncingToEditor = true;
        if (window._svgSyncFromEditorTimer) {
            console.log('[applyPartialSvgSync] Cancelling pending reverse sync timer.');
            clearTimeout(window._svgSyncFromEditorTimer);
            window._svgSyncFromEditorTimer = null;
        }
    }

    // 5. CodeMirror へ行範囲を指定して差分適用
    DOM.editor.replaceLines(startLine + 1, endLine + 1, newBlock, addToHistory, isolateHistory);

    if (typeof AppState !== 'undefined') {
        AppState.text = getEditorText();
        AppState.isModified = true;
        if (typeof updateTitle === 'function') updateTitle();
    }
    if (!silent) DOM.editor.dispatchEvent(new Event('input'));
    if (typeof updateSVGSourceHighlight === 'function') updateSVGSourceHighlight();
    if (typeof window.buildSvgList === 'function') window.buildSvgList();

    if (window.currentEditingSVG) {
        clearTimeout(window.currentEditingSVG._syncingToEditorTimer);
        window.currentEditingSVG._syncingToEditorTimer = setTimeout(() => {
            if (window.currentEditingSVG) window.currentEditingSVG._syncingToEditor = false;
        }, 400);
    }

    return true;
}

/**
 * Helper to pretty-print SVG HTML for CodeMirror folding
 * @param {string} svgStr 
 * @returns {string} Formatted SVG
 */
function formatSVGCode(svgStr) {
    let cleanStr = svgStr.replace(/>\s+</g, '><').trim();
    cleanStr = cleanStr.replace(/(>)(<)(\/*)/g, '$1\n$2$3');

    const lines = cleanStr.split('\n');
    const out = []; // 文字列の += 結合を廃止し、配列 of push を使用
    let pad = 0;

    for (let i = 0; i < lines.length; i++) {
        const node = lines[i].trim();
        if (!node) continue;

        let indent = 0;
        if (node.length > 1000) {
            indent = 0;
        } else if ((node.includes('</') && node.endsWith('>')) || node.endsWith('/>')) {
            indent = 0; 
        } else if (node.startsWith('</')) {
            if (pad > 0) pad -= 1;
        } else if (node.startsWith('<') && !node.includes('</')) {
            indent = 1;
        }

        const prefix = (pad > 0 && node.length < 1000) ? '  '.repeat(pad) : '';
        out.push(prefix + node);
        pad += indent;
    }

    return out.join('\n');
}

// ▼▼▼ 新規追加 ▼▼▼
const FLOAT_ROUND_REGEX = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
const ROUND3 = (val) => Math.round(parseFloat(val) * 1000) / 1000;

const IGNORE_CLASSES = new Set([
    'svg-interaction-hitarea', 'svg_interaction', 'svg-canvas-proxy', 
    'svg-grid-lines', 'svg-grid-pattern', 'svg-grid-rect', 'svg-grid-line',
    'svg_select_group', 'svg-select-group', 'svg-select-group-canvas',
    'rotation-handle-group', 'radius-handle-group', 'polyline-handle-group', 
    'bubble-handle-group', 'svg-snap-guides', 'svg-control-marker', 
    'svg-canvas-border', 'svg-ruler', 'svg-select-handle', 'svg_select_handle',
    'svg_select_shape', 'rotation-handle', 'svg_select_handle_rot',
    'svg-grad-control-ui', 'svg-grad-control-handle',
    'container-glow'
]);

function serializeLiveSvgNode(node, skipRounding, rootOptions = null) {
    if (node.nodeType === 3) {
        return typeof escapeHtml === 'function' ? escapeHtml(node.nodeValue) : node.nodeValue; // XML escape
    }
    if (node.nodeType !== 1) return ''; // Skip comments etc.

    // O(1) exclusion of editor-only elements
    if (node.getAttribute('data-internal') === 'true' || node.id === 'grid-group') return '';
    
    const tagName = node.tagName.toLowerCase();
    
    // Class-based exclusion (both self and descendants)
    if (node.classList) {
        for (let i = 0; i < node.classList.length; i++) {
            const cls = node.classList[i];
            if (IGNORE_CLASSES.has(cls) || 
                (cls.includes('svg-select') && cls !== 'svg-edit-selected') || 
                cls.includes('svg_select') || 
                cls.includes('select-handle') ||
                cls.includes('select_handle') ||
                cls.includes('rotation-handle')) {
                return '';
            }
        }
    }

    // If it's a container element (like g), check if it contains any internal editor elements
    // 【バグ修正】選択中のカスタム図形（bubble等）に一時的な編集用UI（hitarea等）が含まれている場合に、
    // 図形ごと消去されてしまう不具合を防ぐため、g要素自体の巻き込み削除処理をコメントアウトしました。
    // 一時的UI自体は個別要素のクラス名や属性判定（IGNORE_CLASSES等）で直列化から正しく除外されます。
    /*
    if (tagName === 'g') {
        const toolId = node.getAttribute('data-tool-id');
        const hasGradient = node.getAttribute('data-has-gradient') === 'true';
        
        // ユーザー作成グループ（グループ化、テキスト付き図形、グラデーション付きグループ、およびグラデーション内部のグループなど）は全体除外判定をスキップする
        const isInsideGradient = !!node.closest('[data-has-gradient="true"]');
        if (toolId !== 'group' && toolId !== 'shape-text-group' && !hasGradient && !isInsideGradient) {
            const hasInternal = node.querySelector(
                '.svg-interaction-hitarea, .svg_interaction, .svg-canvas-proxy, ' +
                '.svg-grid-lines, .svg-grid-pattern, .svg-grid-rect, .svg-grid-line, ' +
                '.svg_select_group, .svg-select-group, .svg-select-group-canvas, ' +
                '.rotation-handle-group, .radius-handle-group, .polyline-handle-group, ' +
                '.bubble-handle-group, .svg-snap-guides, .svg-control-marker, ' +
                '.svg-canvas-border, .svg-ruler, .svg_select_shape, .svg-select-handle, ' +
                '.svg_select_handle, .rotation-handle, .svg_select_handle_rot'
            );
            if (hasInternal) return '';
        }
    }
    */

    // Skip empty g tags
    if (tagName === 'g' && node.childNodes.length === 0 && (!node.textContent || !node.textContent.trim())) return '';

    let str = `<${tagName}`;
    const attrs = node.attributes;
    const isRoot = tagName === 'svg';
    
    const attrMap = new Map();
    for (let i = 0; i < attrs.length; i++) attrMap.set(attrs[i].name, attrs[i].value);
    
    // Apply overrides for root
    if (isRoot && rootOptions) {
        for (const [k, v] of Object.entries(rootOptions)) attrMap.set(k, v);
    }

    if (attrMap.has('class')) {
        const cleanedClass = attrMap.get('class').split(' ')
            .filter(c => !c.includes('svg_select') && !c.includes('svg-interaction') && c !== 'svg-editable' && c !== 'isSelected' && c !== 'svg-edit-selected')
            .join(' ').trim();
        if (cleanedClass) attrMap.set('class', cleanedClass);
        else attrMap.delete('class');
    }

    attrMap.forEach((val, name) => {
        // Remove internal attributes
        if (name === 'data-svg-camel-fixed') return;
        if (['data-is-proxy', 'data-is-canvas', 'data-locked'].includes(name) && !isRoot && tagName !== 'g') return;

        if (!skipRounding && val !== undefined && val !== null) {
            val = String(val);
            if (['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'].includes(name)) {
                if (!isNaN(val) && val.trim() !== '') val = ROUND3(val).toString();
            } else if (['transform', 'd', 'points', 'data-poly-points', 'stroke-dasharray', 'viewBox'].includes(name) || name.startsWith('data-arrow-')) {
                if (val.length < 5000 && val.includes('.')) val = val.replace(FLOAT_ROUND_REGEX, m => ROUND3(m));
            } else if (name.startsWith('data-') && !isNaN(val) && val.trim() !== '' && val.length < 512) {
                val = ROUND3(val).toString();
            } else if (['font-size', 'stroke-width', 'letter-spacing'].includes(name)) {
                if (!isNaN(parseFloat(val))) val = val.replace(parseFloat(val).toString(), ROUND3(parseFloat(val)).toString());
            }
        }
        // Basic escaping
        // [FIX] 属性値内の改行をXMLエンティティにエスケープする。
        // formatSVGCode が \n で行分割してインデントを追加するため、
        // エスケープしないと data-original-text 等の改行含み属性が
        // スペース入りの壊れた値になってしまう。
        // DOMParser は &#10; を自動的に \n にデコードするので読み取り側の変更は不要。
        val = String(val).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
        str += ` ${name}="${val}"`;
    });

    const voidElements = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image', 'use', 'pattern'];
    if (node.childNodes.length === 0 && voidElements.includes(tagName)) return str + ` />`;

    str += `>`;
    for (let i = 0; i < node.childNodes.length; i++) {
        str += serializeLiveSvgNode(node.childNodes[i], skipRounding);
    }
    return str + `</${tagName}>`;
}

function syncSVGToEditor(container, svgIndex, silent = true, overrideDims = null, addToHistory = true, isolateHistory = false) {
    if (typeof container === 'number') {
        const arg2 = arguments.length >= 3 ? arguments[2] : null;
        overrideDims = (arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) ? arg2 : null;
        silent = (svgIndex === true || svgIndex === false) ? svgIndex : true;
        svgIndex = container;
        container = window.currentEditingSVG ? window.currentEditingSVG.container : null;
        addToHistory = arguments.length >= 4 ? arguments[3] : true;
        isolateHistory = arguments.length >= 5 ? arguments[4] : false;
    }

    if (!container || (window.currentEditingSVG && window.currentEditingSVG._updatingFromEditor)) return;

    const svgElement = container.querySelector('svg');
    if (!svgElement) return;

    const editorContent = getEditorText();
    const info = getSvgBlockInfo(editorContent, svgIndex);
    if (!info) return;

    // ----- Pre-processing: Apply text alignment changes to live DOM -----
    if (window.currentEditingSVG) window.currentEditingSVG._syncingToEditor = true;
    
    try {
        const groups = svgElement.querySelectorAll('g[data-tool-id="shape-text-group"]');
        if (groups.length > 0 && window.SVGTextAlignmentToolbar && typeof window.SVGTextAlignmentToolbar.updateTextPosition === 'function') {
            // Re-apply alignment calculations to ensure they are baked into x/y attributes
            groups.forEach(g => window.SVGTextAlignmentToolbar.updateTextPosition(SVG(g), true));
        }
        
        // Single text line spacing persistence
        svgElement.querySelectorAll('text[data-line-spacing]').forEach(textNode => {
            let fontSize = parseFloat(textNode.getAttribute('font-size')) || 20;
            let spacingVal = parseFloat(textNode.getAttribute('data-line-spacing')) || 1.2;
            const lineSpacing = fontSize * spacingVal;
            let targetX = parseFloat(textNode.getAttribute('x')) || 0;
            const tspans = textNode.querySelectorAll('tspan');
            tspans.forEach((tspan, idx) => {
                tspan.setAttribute('x', targetX);
                tspan.setAttribute('dy', idx === 0 ? '0' : String(lineSpacing));
            });
        });
    } catch (e) {}

    // ----- Prepare Root Attributes -----
    const cur = window.currentEditingSVG;
    const configWidth = (typeof AppState !== 'undefined' && AppState.config) ? AppState.config.previewWidth : null;
    const rootOptions = {};

    if (overrideDims) {
        rootOptions.width = configWidth || overrideDims.w;
        rootOptions.height = configWidth ? Math.round(overrideDims.h * (configWidth / overrideDims.w)) : overrideDims.h;
        rootOptions.viewBox = `${overrideDims.x} ${overrideDims.y} ${overrideDims.w} ${overrideDims.h}`;
        rootOptions['data-paper-width'] = Math.round(overrideDims.w);
        rootOptions['data-paper-height'] = Math.round(overrideDims.h);
        rootOptions['data-paper-x'] = Math.round(overrideDims.x);
        rootOptions['data-paper-y'] = Math.round(overrideDims.y);
        if (cur) {
            cur.baseWidth = overrideDims.w;
            cur.baseHeight = overrideDims.h;
            cur.baseX = overrideDims.x;
            cur.baseY = overrideDims.y;
        }
    } else if (cur) {
        const scaleFactor = (cur.zoom || 100) / 100;
        const vb = svgElement.viewBox.baseVal;
        // [FIX] viewBox はズーム込みの値 (baseSize * 100/zoom) なので、フォールバック時はズームで割り戻して論理サイズに変換する。
        // これをしないと、baseHeight が一時的に falsy になった際に viewBox の肥大化した値が論理サイズとして記録され、
        // キャンバスが突然大きくなるバグが発生する。
        const zoomFactor = (cur.zoom || 100) / 100;
        const mW = cur.baseWidth || Math.round(vb.width * zoomFactor);
        const mH = cur.baseHeight || Math.round(vb.height * zoomFactor);
        const rx = cur.baseX !== undefined ? cur.baseX : vb.x;
        const ry = cur.baseY !== undefined ? cur.baseY : vb.y;

        rootOptions.width = configWidth || Math.round(mW * scaleFactor);
        rootOptions.height = configWidth ? Math.round(mH * (configWidth / mW)) : Math.round(mH * scaleFactor);
        
        const vx = ROUND3(rx + (cur.offX || 0));
        const vy = ROUND3(ry + (cur.offY || 0));
        const vw = ROUND3(mW * (100 / (cur.zoom || 100)));
        const vh = ROUND3(mH * (100 / (cur.zoom || 100)));

        rootOptions.viewBox = `${vx} ${vy} ${vw} ${vh}`;
        rootOptions['data-paper-width'] = Math.round(mW);
        rootOptions['data-paper-height'] = Math.round(mH);
        rootOptions['data-paper-x'] = Math.round(rx);
        rootOptions['data-paper-y'] = Math.round(ry);
        rootOptions['data-paper-zoom'] = cur.zoom || 100;
        rootOptions['data-paper-offx'] = cur.offX || 0;
        rootOptions['data-paper-offy'] = cur.offY || 0;
        if (typeof AppState !== 'undefined' && AppState.config && AppState.config.grid) {
            rootOptions['data-paper-grid-size'] = AppState.config.grid.size || 15;
            rootOptions['data-paper-grid-major'] = AppState.config.grid.majorInterval || 5;
        }
    }

    const isDraggingOrResizing = cur && (cur._isDragging || cur._isResizing);
    const elementCount = svgElement.querySelectorAll('*').length;
    // Skip rounding for huge files or during drag/resize for max performance
    const skipRounding = elementCount > 500 || (silent && isDraggingOrResizing);

    // ★ Execute Zero-Clone Serialization
    let svgCode = serializeLiveSvgNode(svgElement, skipRounding, rootOptions);

    if (elementCount <= 500) {
        svgCode = formatSVGCode(svgCode);
    }

    // ----- Apply to Markdown Editor -----
    const indentedSvgCode = svgCode.split('\n')
        .map(line => line.trim() ? info.indentation + line : line).join('\n');
    const newBlock = `${info.indentation}\`\`\`svg\n${indentedSvgCode}\n${info.indentation}\`\`\``;

    if (window._svgSyncFromEditorTimer) {
        clearTimeout(window._svgSyncFromEditorTimer);
        window._svgSyncFromEditorTimer = null;
    }

    if (typeof DOM !== 'undefined' && DOM.editor) {
        // Save fold state if using CM6
        const foldedSignatures = new Set();
        if (window.CM6 && window.CM6.foldedRanges && DOM.editor.state) {
            const state = DOM.editor.state;
            const foldedIt = window.CM6.foldedRanges(state).iter();
            while (foldedIt.value) {
                const foldPos = foldedIt.from;
                const lineObj = state.doc.lineAt(foldPos);
                if (lineObj.number >= info.startLine + 1 && lineObj.number <= info.endLine + 1) {
                    const match = lineObj.text.match(/id=["']([^"']+)["']/);
                    foldedSignatures.add(match ? 'id:' + match[1] : lineObj.text.trim());
                }
                foldedIt.next();
            }
        }

        // Replace using lines (0-based to 1-based)
        DOM.editor.replaceLines(info.startLine + 1, info.endLine + 1, newBlock, addToHistory, isolateHistory);
        if (!silent) DOM.editor.dispatchEvent(new Event('input'));

        // Restore fold state
        if (foldedSignatures.size > 0 && window.CM6 && window.CM6.foldEffect) {
            setTimeout(() => {
                try {
                    const state = DOM.editor.state;
                    const effects = [];
                    for (let i = info.startLine + 2; i <= state.doc.lines; i++) {
                        const lineObj = state.doc.line(i);
                        if (lineObj.text.trim() === '```') break;
                        const match = lineObj.text.match(/id=["']([^"']+)["']/);
                        const sig = match ? 'id:' + match[1] : lineObj.text.trim();
                        if (foldedSignatures.has(sig)) {
                            const range = window.CM6.foldable(state, lineObj.from, lineObj.to);
                            if (range) {
                                effects.push(window.CM6.foldEffect.of(range));
                                foldedSignatures.delete(sig);
                            }
                        }
                    }
                    if (effects.length > 0) DOM.editor.dispatch({ effects });
                } catch (e) {}
            }, 100);
        }
    }

    if (typeof AppState !== 'undefined') {
        AppState.text = getEditorText();
        AppState.isModified = true;
        if (typeof updateTitle === 'function') updateTitle();
    }

    if (typeof updateSVGSourceHighlight === 'function') updateSVGSourceHighlight();
    if (typeof window.buildSvgList === 'function') window.buildSvgList();

    if (cur) {
        clearTimeout(cur._syncingToEditorTimer);
        cur._syncingToEditorTimer = setTimeout(() => { 
            if (window.currentEditingSVG) window.currentEditingSVG._syncingToEditor = false; 
        }, 400);
    }
}
window.syncSVGToEditor = syncSVGToEditor;

/**
 * [REFACTOR] Use Transform Toolbar logic for Manual Canvas Size Change?
 * Or keep this as a handler for manual adjustments form old UI if any?
 * The original code had handleManualCanvasSizeChange tied to SVGToolbar inputs.
 */
function handleManualCanvasSizeChange() {
    // If someone calls this, just trigger sync with current inputs if they still exist (unlikely) or just ignore
    // Old inputs should be gone, we now use transformToolbar.
    syncChanges(false);
}
window.handleManualCanvasSizeChange = handleManualCanvasSizeChange;

/**
 * エディタのSVGコードをSVGキャンバスへ反映する（エディタ→SVGエディタ方向の同期）
 * SVGエディタ起動中にテキストエディタでSVGコードを直接編集した際に呼ばれる。
 */
function updateSVGFromEditor() {
    if (!window.currentEditingSVG) return;
    const { draw, svgIndex, container } = window.currentEditingSVG;
    if (!draw || svgIndex === undefined) return;

    // [FIX] キャンバスやコンテナがDOMから切り離されている場合は、プレビュー再生成中のため同期をスキップする
    if (!draw.node || !draw.node.isConnected || (container && !container.isConnected)) {
        console.log(`[updateSVGFromEditor] Aborted: Canvas or container is disconnected from DOM.`);
        return;
    }

    // [FIX] ループ防止フラグをチェック（ガード節をdeselectAllおよび退避処理より前に移動）
    if (window.currentEditingSVG._syncingToEditor || window._isDispatchingSvgSync) {
        console.log(`[updateSVGFromEditor] Aborted: Syncing to editor is in progress. (_syncingToEditor=${window.currentEditingSVG._syncingToEditor}, _isDispatchingSvgSync=${!!window._isDispatchingSvgSync})`);
        return;
    }

    // [FIX] CSS 編集モード中は、エディタからの再描画を行わない（ガード節をdeselectAllおよび退避処理より前に移動）
    if (window.currentEditingSVG._inCSSEditMode) {
        console.log(`[updateSVGFromEditor] Aborted: In CSS Edit Mode to prevent flickering.`);
        return;
    }

    // [FIX] 逆方向同期の抑制: キャンバス操作中（ドラッグ・リサイズ中）はエディタからの同期を破棄する（ガード節をdeselectAllおよび退避処理より前に移動）
    if (window.currentEditingSVG && (window.currentEditingSVG._isDragging || window.currentEditingSVG._isResizing)) {
        console.log(`[updateSVGFromEditor] Aborted: Dragging or resizing in progress.`);
        return;
    }

    // [FIX] 削除前に選択されている要素の情報（IDとインデックスパス）を記録しておく（ガード節通過後に実行）
    const selectedTargets = [];
    if (window.currentEditingSVG.selectedElements) {
        const rootNode = draw.node;
        window.currentEditingSVG.selectedElements.forEach(el => {
            if (el && el.node && el.node.isConnected) {
                const id = (typeof el.id === 'function') ? el.id() : el.node.getAttribute('id');
                
                // 有効な非内部図形要素のみを対象としてインデックスパスを算出
                const path = [];
                let curr = el.node;
                while (curr && curr !== rootNode) {
                    const parent = curr.parentNode;
                    if (!parent) break;
                    const validChildren = (typeof window.getSVGValidChildren === 'function') 
                        ? window.getSVGValidChildren(parent) 
                        : Array.from(parent.children);
                    const idx = validChildren.indexOf(curr);
                    if (idx !== -1) {
                        path.unshift(idx);
                    } else {
                        path.unshift(-1);
                    }
                    curr = parent;
                }
                selectedTargets.push({ id, path });
            }
        });
    }

    // 一旦全ての選択を解除（古いDOM要素への参照をクリア。ガード節通過後に実行）
    if (typeof deselectAll === 'function') deselectAll();

    // ループ防止フラグを立てる（syncSVGToEditorの逆方向呼び出しを抑制）
    window.currentEditingSVG._updatingFromEditor = true;

    // [NEW] スクロールやフォーカスジャンプを防ぐためのロック
    const prevIsScrolling = window.isScrolling;
    window.isScrolling = true;

    try {
        // エディタから対象SVGブロック（svgIndex番目の```svgブロック）を抽出
        const editorContent = getEditorText();
        const lines = editorContent.split('\n');
        let currentIdx = 0, startLine = -1, endLine = -1, inBlock = false;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '```svg') {
                if (currentIdx === svgIndex) { startLine = i + 1; inBlock = true; }
                currentIdx++;
            } else if (inBlock && lines[i].trim() === '```') {
                endLine = i - 1;
                break;
            }
        }

        if (startLine === -1 || endLine < startLine) return;

        const svgCode = lines.slice(startLine, endLine + 1).join('\n').trim();
        if (!svgCode || !svgCode.includes('<svg')) return;

        // DOMParserでSVGをパース
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgCode, 'image/svg+xml');
        const parsedSvg = doc.querySelector('svg');
        if (!parsedSvg) return;

        // パースエラーチェック
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.warn('[updateSVGFromEditor] SVG parse error, skipping update.');
            return;
        }

        // [FIX] Clean up empty text nodes inside <text> elements that cause bounding boxes to excessively expand
        // This handles cases where formatSVGCode injected newlines/indentations between <tspan> elements.
        parsedSvg.querySelectorAll('text').forEach(textEl => {
            Array.from(textEl.childNodes).forEach(node => {
                if (node.nodeType === 3 && node.nodeValue.trim() === '') {
                    node.remove();
                }
            });
        });

        const svgElement = draw.node;

        // viewBox / width / height / data-paper-* を更新
        ['width', 'height', 'viewBox', 'data-paper-width', 'data-paper-height', 'data-paper-x', 'data-paper-y', 'data-paper-zoom', 'data-paper-offx', 'data-paper-offy'].forEach(attr => {
            const val = parsedSvg.getAttribute(attr);
            if (val) {
                const oldVal = svgElement.getAttribute(attr);
                if (oldVal !== val) {
                    console.log(`[updateSVGFromEditor] Updating attr "${attr}": ${oldVal} -> ${val}`);
                    svgElement.setAttribute(attr, val);
                }
            }
        });

        // [NEW] 優先順位: 1. data-paper属性 (保存された真のサイズ)  2. viewBox属性 (現在の表示枠)
        const dpW = parsedSvg.getAttribute('data-paper-width');
        const dpH = parsedSvg.getAttribute('data-paper-height');
        const dpX = parsedSvg.getAttribute('data-paper-x');
        const dpY = parsedSvg.getAttribute('data-paper-y');

        if (dpW && dpH) {
            const newH = parseFloat(dpH);
            // [WATCH] Detect unnatural reset to 350
            if (window.currentEditingSVG.baseHeight !== 350 && newH === 350) {
                console.warn(`[updateSVGFromEditor] UNNATURAL RESET DETECTED! Height changing from ${window.currentEditingSVG.baseHeight} back to 350. Source: data-paper`);
                console.trace();
            }

            window.currentEditingSVG.baseWidth = parseFloat(dpW);
            window.currentEditingSVG.baseHeight = newH;
            window.currentEditingSVG.baseX = parseFloat(dpX || 0);
            window.currentEditingSVG.baseY = parseFloat(dpY || 0);

            // [NEW] ズーム・パン状態も属性から復元
            const dz = parsedSvg.getAttribute('data-paper-zoom');
            const dox = parsedSvg.getAttribute('data-paper-offx');
            const doy = parsedSvg.getAttribute('data-paper-offy');
            if (dz) window.currentEditingSVG.zoom = parseFloat(dz);
            if (dox) window.currentEditingSVG.offX = parseFloat(dox);
            if (doy) window.currentEditingSVG.offY = parseFloat(doy);

            console.log(`[updateSVGFromEditor] Updated memory from data-paper: ${window.currentEditingSVG.baseX} ${window.currentEditingSVG.baseY} ${window.currentEditingSVG.baseWidth} ${window.currentEditingSVG.baseHeight}, zoom: ${window.currentEditingSVG.zoom}`);
        } else {
            let newVb = parsedSvg.viewBox && parsedSvg.viewBox.baseVal ? parsedSvg.viewBox.baseVal : null;
            // Fallback for strict/legacy DOMParsers where baseVal is missing or unpopulated
            if (!newVb || isNaN(newVb.width) || (newVb.width === 0 && newVb.height === 0)) {
                const vbAttr = parsedSvg.getAttribute('viewBox');
                if (vbAttr) {
                    const parts = vbAttr.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
                    if (parts.length === 4) {
                        newVb = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
                    }
                }
            }

            if (newVb && newVb.width > 0 && newVb.height > 0) {
                // [FIX] viewBox はズーム込みの値 (baseSize * 100/zoom) なので、
                // ズームで割り戻して論理サイズに変換する。
                const curZoom = window.currentEditingSVG.zoom || 100;
                const zf = curZoom / 100;
                const logicalW = Math.round(newVb.width * zf);
                const logicalH = Math.round(newVb.height * zf);

                // [WATCH] Detect unnatural reset to 350
                if (window.currentEditingSVG.baseHeight !== 350 && logicalH === 350) {
                    console.warn(`[updateSVGFromEditor] UNNATURAL RESET DETECTED! Height changing from ${window.currentEditingSVG.baseHeight} back to 350. Source: viewBox`);
                    console.trace();
                }

                // [SAFETY] 既知の baseHeight と大幅に異なる場合（2倍以上 or 1/2以下）は
                // ズーム補正の誤りの可能性があるため、メモリの値を維持する
                const prevBH = window.currentEditingSVG.baseHeight;
                if (prevBH && prevBH > 0 && (logicalH > prevBH * 1.8 || logicalH < prevBH * 0.5)) {
                    console.warn(`[updateSVGFromEditor] SUSPICIOUS viewBox fallback: ${logicalH} vs current ${prevBH}. Keeping current value.`);
                } else {
                    window.currentEditingSVG.baseWidth = logicalW;
                    window.currentEditingSVG.baseHeight = logicalH;
                    window.currentEditingSVG.baseX = newVb.x;
                    window.currentEditingSVG.baseY = newVb.y;
                    console.log(`[updateSVGFromEditor] Updated memory from viewBox (zoom-corrected): ${newVb.x} ${newVb.y} ${logicalW} ${logicalH} (raw viewBox: ${newVb.width}x${newVb.height}, zoom: ${curZoom}%)`);
                }
            }
        }

        // [FIX] Phase 10: 同期されたメモリ状態を、現在のエディタ上のツール系要素（プロキシ/ボーダー）にも即座に適用する
        // これを行わないと、古いプロキシの寸法が updateCanvasUI によって再度メモリに書き戻され、ループが発生する。
        if (window.currentEditingSVG.canvasProxy && window.currentEditingSVG.canvasBorder) {
            const inset = window.currentEditingSVG.canvasInset || 4;
            const bW = window.currentEditingSVG.baseWidth;
            const bH = window.currentEditingSVG.baseHeight;
            const bX = window.currentEditingSVG.baseX || 0;
            const bY = window.currentEditingSVG.baseY || 0;

            console.log(`[updateSVGFromEditor] Syncing live proxy/border to: ${bW}x${bH} at (${bX}, ${bY})`);

            window.currentEditingSVG.canvasBorder.attr({
                x: bX,
                y: bY,
                width: bW,
                height: bH
            });
            window.currentEditingSVG.canvasProxy.attr({
                x: bX + inset,
                y: bY + inset,
                width: Math.max(10, bW - inset * 2),
                height: Math.max(10, bH - inset * 2)
            });
        }

        // 内部ツール要素のクラス一覧（削除対象外）
        const internalClasses = [
            'svg-canvas-proxy', 'svg-grid-lines', 'svg-grid-line',
            'svg-grid-pattern', 'svg-grid-rect', 'svg-interaction-hitarea',
            'svg_select_shape', 'svg_select_handle', 'svg_select_group',
            'svg-select-group', 'rotation-handle-group', 'radius-handle-group',
            'polyline-handle-group', 'bubble-handle-group', 'svg-control-marker'
        ];

        const persistentFragment = document.createDocumentFragment();
        const persistentClasses = [
            'svg-canvas-proxy', 'svg-grid-lines', 'svg-grid-line',
            'svg-grid-pattern', 'svg-grid-rect', 'svg-canvas-border'
        ];

        // 1. グリッド等の残すべき基盤要素を退避 (DocumentFragmentへ移動)
        Array.from(svgElement.children).forEach(el => {
            const cls = el.classList ? Array.from(el.classList) : [];
            if (cls.some(c => persistentClasses.includes(c))) {
                persistentFragment.appendChild(el);
            }
        });

        // 2. 実DOMを一瞬で空にする (削除コストの削減と再描画計算の抑制)
        svgElement.innerHTML = '';

        // 3. 新規要素のフラグメント構築
        const defsFragment = document.createDocumentFragment();
        const mainFragment = document.createDocumentFragment();
        Array.from(parsedSvg.children).forEach(child => {
            const tag = child.tagName.toLowerCase();
            const adopted = document.adoptNode(child.cloneNode(true));
            if (['defs', 'style', 'symbol'].includes(tag)) {
                defsFragment.appendChild(adopted);
            } else {
                mainFragment.appendChild(adopted);
            }
        });

        // 4. 一括挿入（リフローが最小限で済む）
        svgElement.appendChild(defsFragment);
        svgElement.appendChild(persistentFragment);
        svgElement.appendChild(mainFragment);

        // [NEW] 初期化ループは廃止。イベントデリゲーション (svg_editor.js の lazyInitHandler) で遅延初期化されます。

        // canvas-proxyをz-orderでグリッドより1段上（2番目）に配置する
        // 1) gridGroup を先に最背面へ
        const gridGroup = draw.findOne('.svg-grid-lines');
        if (gridGroup) {
            // gridGroupを最背面へ (position 0)
            gridGroup.back();
            // canvasProxyをgridGroupの直後 (position 1) へ
            const gNode = gridGroup.node;
            const gParent = gNode.parentNode;
            const gNext = gNode.nextSibling;
            if (gNext) {
                gParent.insertBefore(window.currentEditingSVG.canvasProxy.node, gNext);
            } else {
                gParent.appendChild(window.currentEditingSVG.canvasProxy.node);
            }
        } else {
            window.currentEditingSVG.canvasProxy.back();
        }

        // viewBox更新後にcanvasProxyのサイズも合わせる
        const vb = svgElement.viewBox.baseVal;
        const inset = window.currentEditingSVG.canvasInset || 4;
        if (window.currentEditingSVG.canvasProxy && vb.width && vb.height) {
            // [FIX] Negative value is not valid エラーを回避するため、最小サイズを保証する
            const targetW = Math.max(10, vb.width - inset * 2);
            const targetH = Math.max(10, vb.height - inset * 2);
            window.currentEditingSVG.canvasProxy
                .size(targetW, targetH)
                .move(vb.x + inset, vb.y + inset);
        }

        console.log('[updateSVGFromEditor] SVG canvas updated from editor content.');

        // [FIX] 記録しておいた情報（インデックスパスとID）を元に、新しいDOM要素を選択し直す
        if (selectedTargets.length > 0) {
            console.log('[updateSVGFromEditor] Restoring selection targets:', selectedTargets);
            selectedTargets.forEach(target => {
                let newEl = null;
                
                // 1. まずインデックスパスで同じDOM位置の要素を探す
                if (target.path && target.path.length > 0 && typeof window.getSVGValidChildren === 'function') {
                    let curr = draw.node;
                    for (const idx of target.path) {
                        if (idx === -1) {
                            curr = null;
                            break;
                        }
                        const validChildren = window.getSVGValidChildren(curr);
                        if (idx >= 0 && idx < validChildren.length) {
                            curr = validChildren[idx];
                        } else {
                            curr = null;
                            break;
                        }
                    }
                    if (curr) {
                        newEl = SVG(curr);
                    }
                }
                
                // 2. パスで見つからなかった場合、または固定ID（Svgjsから始まらない）の場合はIDで検索
                if (!newEl && target.id && !target.id.startsWith('Svgjs')) {
                    newEl = draw.findOne('#' + target.id);
                }
                
                // 3. 要素が見つかれば選択を復元
                if (newEl) {
                    // [NEW] 古いインスタンスが残っている場合は確実に破棄する
                    const oldShape = newEl.remember('_shapeInstance');
                    if (oldShape) {
                        if (oldShape.node !== newEl.node || !oldShape.node.isConnected) {
                            console.log(`[updateSVGFromEditor] Destroying stale shape instance for #${target.id || 'unknown'}`);
                            oldShape.destroy();
                        }
                    }

                    // [NEW] オンデマンドで初期化
                    if (!newEl.remember('_shapeInstance') && typeof makeInteractive === 'function') {
                        makeInteractive(newEl);
                    }
                    if (typeof selectElement === 'function') {
                        // 第2引数を true にして、既存の選択に追加（複数選択の復元）
                        selectElement(newEl, true);
                    }
                }
            });
        }

        // [NEW] Update SVG List panel after editor sync
        if (typeof window.buildSvgList === 'function') {
            window.buildSvgList();
        }

    } catch (e) {
        console.error('[updateSVGFromEditor] Error:', e);
    } finally {
        // フラグを解除（必ずfinallyで解除）
        if (window.currentEditingSVG) {
            // エディタ側からの更新中に発生したDOM変化のレコードをクリアして無視する
            if (window.currentEditingSVG.syncObserver) {
                window.currentEditingSVG.syncObserver.takeRecords();
            }
            if (window.currentEditingSVG._pendingMutations) {
                window.currentEditingSVG._pendingMutations = [];
            }
            window.currentEditingSVG._updatingFromEditor = false;
        }
        // [NEW] スクロールロック解除
        window.isScrolling = prevIsScrolling;
    }
}
window.updateSVGFromEditor = updateSVGFromEditor;
