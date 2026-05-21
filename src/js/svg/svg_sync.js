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

function schedulePartialSync() {
    clearTimeout(partialSyncTimeout);
    partialSyncTimeout = setTimeout(() => {
        if (!window.currentEditingSVG) return;
        // 溜まった変更を同期実行（ドラッグ中は silent=true で呼ばれる）
        syncChanges(true); 
    }, 50); // 50ms（約20fps）のデバウンス
}
window.schedulePartialSync = schedulePartialSync;

function syncChanges(silent = true, overrideDims = null) {
    console.log(`[svg_sync] syncChanges called (silent: ${silent}, override: ${overrideDims ? 'yes' : 'no'})`);
    
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
        console.log(`[svg_sync] syncChanges SKIPPED: In CSS Edit Mode. (Preview changes are UI-only)`);
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

    const cur = window.currentEditingSVG;

    // MutationObserverの未処理キューを即座に回収（タイミングズレ防止）
    if (cur.syncObserver) {
        const records = cur.syncObserver.takeRecords();
        if (records.length > 0 && typeof cur.syncQueue !== 'undefined') {
            const queue = cur.syncQueue;
            for (const mutation of records) {
                const targetNode = mutation.target;
                if (targetNode.nodeType !== 1) continue;

                if (targetNode.closest('.svg-grid-lines, .svg-canvas-proxy, .svg-snap-guides, .svg-interaction-hitarea, .svg-control-marker, .svg-ruler, .svg_select_group')) {
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

    // キャンバスのリサイズ(overrideDims) や 構造変更 がある場合は安全優先でフル同期
    if (queue && !queue.requiresFullSync && !overrideDims && queue.changedNodeIds.size > 0 && queue.changedNodeIds.size < 50) {
        // 属性の変更のみであれば超高速な部分同期
        isPartialSuccess = applyPartialSvgSync(cur.svgIndex, queue.changedNodeIds, silent);
    }

    if (!isPartialSuccess) {
        // 部分同期がスキップされた、またはパースエラー等で失敗した場合は従来のフル同期へ
        syncSVGToEditor(cur.container, cur.svgIndex, silent, overrideDims);
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
function applyPartialSvgSync(targetSvgIndex, changedIds, silent) {
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

            if (['data-is-proxy', 'data-is-canvas', 'data-internal', 'data-locked', 'data-tool-id'].includes(name) && id !== '__root__') continue;

            if (name === 'class') {
                val = val.split(' ').filter(c => !c.includes('svg_select') && !c.includes('svg-interaction')).join(' ').trim();
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
    DOM.editor.replaceLines(startLine + 1, endLine + 1, newBlock);

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
    let formatted = '';
    // まず既存のタグ間の空白や改行をすべて削除してクリーンにする
    svgStr = svgStr.replace(/>\s+</g, '><').trim();

    // タグごとに改行を入れる
    const reg = /(>)(<)(\/*)/g;
    svgStr = svgStr.replace(reg, '$1\n$2$3');

    let pad = 0;
    svgStr.split('\n').forEach(function (node) {
        node = node.trim();
        if (!node) return; // 空行はスキップ

        let indent = 0;
        // [PERF] 非常に長い行（Base64等）は検索・正規表現コストが高いため、
        // 1000文字を超える場合はインデント計算をスキップして単なる要素として扱う
        if (node.length > 1000) {
            indent = 0;
        } else if (node.match(/.+<\/\w[^>]*>$/) || node.match(/^<\w[^>]*\/>$/)) {
            // 1行で完結するタグ (例: <rect ... /> or <text>...</text>) はインデントを変化させない
            indent = 0;
        } else if (node.match(/^<\/\w/)) {
            // 閉じタグの場合はインデントを下げる
            if (pad > 0) pad -= 1;
        } else if (node.match(/^<\w[^>]*[^\/]>.*$/) && !node.includes('</')) {
            // 開始タグの場合はインデントを上げる
            indent = 1;
        } else {
            indent = 0;
        }

        // [PERF] repeat のコストを抑え、巨大な行はそのまま連結 (閾値を1000に統一)
        const prefix = (pad > 0 && node.length < 1000) ? '  '.repeat(pad) : '';
        formatted += prefix + node + '\n';
        pad += indent;
    });

    return formatted.trim();
}

/**
 * Helper to identify a stable signature for a line to preserve folding
 * @param {string} lineText 
 * @returns {string} Signature (Priority: ID, Fallback: trimmed text)
 */
function getFoldSignature(lineText) {
    const trimmed = lineText.trim();
    // Match id="id" or id='id'
    const idMatch = trimmed.match(/id=["']([^"']+)["']/);
    if (idMatch) return 'id:' + idMatch[1];
    return trimmed;
}

/**
 * Sync Logic (Preserved from original)
 * @param {boolean} silent - If true, update values but don't fire 'input' event. Default: true.
 * @param {Object} overrideDims - Optional dimensions to force update.
 */
function syncSVGToEditor(container, svgIndex, silent = true, overrideDims = null) {
    // [FIX] 古い呼び出し形式 syncSVGToEditor(svgIndex, silent, overrideDims) との互換性を正しく維持
    if (typeof container === 'number') {
        const actualThirdArg = arguments.length >= 3 ? arguments[2] : null;
        // 第3引数がオブジェクト（且つ非配列）の場合のみ overrideDims とみなす
        overrideDims = (actualThirdArg && typeof actualThirdArg === 'object' && !Array.isArray(actualThirdArg)) ? actualThirdArg : null;
        silent = (svgIndex === true || svgIndex === false) ? svgIndex : true;
        svgIndex = container;
        container = window.currentEditingSVG ? window.currentEditingSVG.container : null;
    }

    console.log(`[svg_sync] syncSVGToEditor start (silent: ${silent}, svgIndex: ${svgIndex})`);
    if (!container) {
        console.error('[svg_sync] syncSVGToEditor: No container provided');
        return;
    }
    // エディタ→SVG同期中（updateSVGFromEditor実行中）は逆方向同期をスキップ（無限ループ防止）
    if (window.currentEditingSVG && window.currentEditingSVG._updatingFromEditor) {
        console.log('[svg_sync] syncSVGToEditor skipped: _updatingFromEditor is true');
        return;
    }

    // Save state for auto-resume after render
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('mdEditor_pendingSVGEditIndex', svgIndex);

        // Save selected elements indices
        if (window.currentEditingSVG && window.currentEditingSVG.draw) {
            const allItems = window.currentEditingSVG.draw.children();
            const validItems = [];
            allItems.each(function (el) {
                const tagName = el.node.tagName.toLowerCase();
                if (['defs', 'style', 'marker', 'symbol', 'metadata'].includes(tagName)) return;

                // [NEW] Exclude proxy and internal tools
                const isTool = el.classes().some(c => c.startsWith('svg_select')) ||
                    el.parent().classes().some(c => c.startsWith('svg_select')) ||
                    el.hasClass('svg-canvas-proxy') ||
                    el.hasClass('svg-control-marker');
                if (!isTool) {
                    validItems.push(el);
                }
            });

            const selectedIndices = [];
            window.currentEditingSVG.selectedElements.forEach(el => {
                // Find index in validItems by node reference
                const idx = validItems.findIndex(item => item.node === el.node);
                if (idx !== -1) selectedIndices.push(idx);
            });
            sessionStorage.setItem('mdEditor_pendingSelectionIndices', JSON.stringify(selectedIndices));
        }
    }

    const svgElement = container.querySelector('svg');
    if (!svgElement) return;

    const clone = svgElement.cloneNode(true);

    // [NEW] Remove hit areas and internal editor-only elements before syncing to editor source
    // These elements should NEVER persist in the Markdown source.
    const internalSelectors = [
        '.svg-interaction-hitarea',
        '.svg_interaction',
        '.svg-canvas-proxy',
        '.svg-grid-lines',
        '.svg-grid-pattern',
        '.svg-grid-rect',
        '.svg-grid-line',
        '.svg_select_group',
        '.svg-select-group',
        '.svg-select-group-canvas',
        '.rotation-handle-group',
        '.radius-handle-group',
        '.polyline-handle-group',
        '.bubble-handle-group',
        '.svg-snap-guides',
        '.svg-control-marker',
        '.svg-canvas-border',
        '.svg-ruler',
        '[data-internal="true"]',
        '#grid-group'
    ];
    let strippedCount = 0;
    try {
        // [FIX] セレクタを結合して走査を1回に統合 (Additional Optimization 3)
        const combinedSelector = internalSelectors.join(', ');
        const found = clone.querySelectorAll(combinedSelector);
        found.forEach(n => {
            n.remove();
            strippedCount++;
        });
    } catch (e) {
        console.warn('[svg_sync] querySelectorAll combined failed, using TreeWalker fallback', e);
        // Fallback: 1回の DOM 探索で全要素をチェックし、複数回の querySelectorAll によるレイアウトスラッシングや遅延を防ぐ
        const treeWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null, false);
        const nodesToRemove = [];
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            let shouldRemove = false;
            if (currentNode.classList) {
                for (let i = 0; i < internalSelectors.length; i++) {
                    const sel = internalSelectors[i];
                    if (sel.startsWith('.') && currentNode.classList.contains(sel.substring(1))) {
                        shouldRemove = true; break;
                    } else if (sel.startsWith('#') && currentNode.id === sel.substring(1)) {
                        shouldRemove = true; break;
                    } else if (sel === '[data-internal="true"]' && currentNode.getAttribute('data-internal') === 'true') {
                        shouldRemove = true; break;
                    }
                }
            }
            if (shouldRemove) nodesToRemove.push(currentNode);
            currentNode = treeWalker.nextNode();
        }
        nodesToRemove.forEach(n => { n.remove(); strippedCount++; });
    }

    // [DEBUG] 非表示属性の保持状態を確認
    const hiddenElements = Array.from(clone.querySelectorAll('*')).filter(el => {
        return el.getAttribute('display') === 'none' || el.style.display === 'none';
    });
    if (hiddenElements.length > 0) {
        console.log(`[svg_sync] Found ${hiddenElements.length} HIDDEN elements in clone:`,
            hiddenElements.map(el => `${el.tagName}#${el.id || 'no-id'} (dispAttr=${el.getAttribute('display')}, styleDisp=${el.style.display})`));
    }

    if (strippedCount > 0) {
        console.log(`[svg_sync] Stripped ${strippedCount} internal editor elements from SVG clone.`);
    }

    // [FIX] Ensure clone has latest proxy dimensions even if root isn't updated yet
    // [NEW] Use AppState.config.previewWidth for width if available
    const configWidth = (typeof AppState !== 'undefined' && AppState.config) ? AppState.config.previewWidth : null;

    if (overrideDims) {
        // Use explicit dimensions passed from resize handler
        const { w, h, x, y } = overrideDims;
        const finalW = configWidth || w;
        const finalH = configWidth ? Math.round(h * (configWidth / w)) : h;

        clone.setAttribute('width', finalW);
        clone.setAttribute('height', finalH);
        clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);

        // [FIX] Phase 5: Ensure restoration attributes are also set when overrideDims is used
        clone.setAttribute('data-paper-width', Math.round(w));
        clone.setAttribute('data-paper-height', Math.round(h));
        clone.setAttribute('data-paper-x', Math.round(x));
        clone.setAttribute('data-paper-y', Math.round(y));

        // [FIX] Ensure memory is also updated if overrideDims is provided
        // This acts as a safety net if the caller forgot to update memory.
        if (window.currentEditingSVG) {
            const cur = window.currentEditingSVG;
            // [TIGHTENED] Reset check criteria: Within 1px of defaults
            const isResetVal = Math.abs(h - (cur.standardHeight || 350)) < 1 || Math.abs(h - 350) < 1 || Math.abs(h - 450) < 1;
            // [TIGHTENED] Pollution check: If it's a reset value but memory says otherwise (>1px diff), it's suspicious
            const isSus = isResetVal && Math.abs(h - cur.baseHeight) > 1;

            if (isSus) {
                console.warn(`[svg_sync] Memory Sync (Safety) BLOCKED to prevent pollution: ${w}x${h} (Current: ${cur.baseWidth}x${cur.baseHeight})`);
            } else if (cur.baseWidth !== w || cur.baseHeight !== h || cur.baseX !== x || cur.baseY !== y) {
                console.log(`[svg_sync] Memory Sync (Safety) - BEFORE: ${cur.baseWidth}x${cur.baseHeight} at (${cur.baseX}, ${cur.baseY})`);
                cur.baseWidth = w;
                cur.baseHeight = h;
                cur.baseX = x;
                cur.baseY = y;
                console.log(`[svg_sync] Memory Sync (Safety) - AFTER:  ${cur.baseWidth}x${cur.baseHeight} at (${cur.baseX}, ${cur.baseY})`);
            }
        }
    } else if (window.currentEditingSVG && window.currentEditingSVG.canvasProxy) {
        const proxy = window.currentEditingSVG.canvasProxy;
        const inset = window.currentEditingSVG.canvasInset || 4;
        const w = Math.round(proxy.width() + (inset * 2));
        const h = Math.round(proxy.height() + (inset * 2));
        const x = Math.round(proxy.x() - inset);
        const y = Math.round(proxy.y() - inset);

        // [FIX] Zoom/Pan Persistence: Use current living viewBox for preservation
        const current = window.currentEditingSVG;
        console.log(`[svg_sync] syncSVGToEditor - Current Zoom State: ${current.zoom}%`);
        const svgNode = current.draw.node;
        const vb = svgNode.viewBox.baseVal;

        // [FIX] 優先順位: 1. overrideDims (引数)  2. current.baseWidth/Height (メモリ)  3. node attributes (DOM)
        const mW = (overrideDims && !isNaN(overrideDims.w)) ? overrideDims.w : (current.baseWidth && !isNaN(current.baseWidth) ? current.baseWidth : null);
        const mH = (overrideDims && !isNaN(overrideDims.h)) ? overrideDims.h : (current.baseHeight && !isNaN(current.baseHeight) ? current.baseHeight : null);

        const finalW = configWidth || mW || w;
        const finalH = configWidth ? Math.round((mH || h) * (configWidth / (mW || w))) : (mH || h);

        // [FIX] viewBox 算出: エディタの作業用ズーム・パンを意図的に含めて保存する (永続化のため)
        if (overrideDims) {
            clone.setAttribute('viewBox', `${overrideDims.x} ${overrideDims.y} ${overrideDims.w} ${overrideDims.h}`);
        } else {
            const rx = (current.baseX !== undefined && !isNaN(current.baseX)) ? current.baseX : vb.x;
            const ry = (current.baseY !== undefined && !isNaN(current.baseY)) ? current.baseY : vb.y;
            const rh = mH || vb.height || h;
            const rw = mW || vb.width || w;

            // [NEW] エディタ内での操作状態 (zoom, offX, offY) を元に viewBox を算出
            const scale = 100 / (current.zoom || 100);
            const r3 = (v) => Math.round(v * 1000) / 1000;
            const vx = r3(rx + (current.offX || 0));
            const vy = r3(ry + (current.offY || 0));
            const vw = r3(rw * scale);
            const vh = r3(rh * scale);

            console.log(`[svg_sync] Serializing with Zoom/Pan: zoom=${current.zoom}%, off=(${current.offX},${current.offY}), viewBox=${vx} ${vy} ${vw} ${vh}`);
            clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
            // [VERIFY] Check after setting
            console.log(`[svg_sync] Verified attribute on clone: viewBox="${clone.getAttribute('viewBox')}"`);
        }

        const scaleFactor = (current.zoom || 100) / 100;
        const fW = configWidth || Math.round(mW * scaleFactor);
        const fH = configWidth ? Math.round((mH || h) * (configWidth / (mW || w))) : Math.round(mH * scaleFactor);

        console.log(`[svg_sync] Setting SVG display size (Zoomed): width:${fW}, height:${fH} (zoom=${current.zoom}%, base=${mW}x${mH})`);
        clone.setAttribute('width', fW);
        clone.setAttribute('height', fH);

        // Paper State (the "100%" base for zoom/pan restoration)
        const paperH = Math.round(current.baseHeight || h);
        console.log(`[svg_sync] FINAL Dimension Sync - W: ${fW}, H: ${fH}, PaperH: ${paperH}`);
        clone.setAttribute('data-paper-width', Math.round(current.baseWidth || w));
        clone.setAttribute('data-paper-height', paperH);
        clone.setAttribute('data-paper-x', Math.round(current.baseX !== undefined ? current.baseX : x));
        clone.setAttribute('data-paper-y', Math.round(current.baseY !== undefined ? current.baseY : y));

        // [NEW] ズーム・パン状態を専用属性として明示的に永続化 (viewBoxのリセット対策)
        clone.setAttribute('data-paper-zoom', current.zoom || 100);
        clone.setAttribute('data-paper-offx', current.offX || 0);
        clone.setAttribute('data-paper-offy', current.offY || 0);

        // [NEW] グリッド設定を永続化
        if (typeof AppState !== 'undefined' && AppState.config.grid) {
            clone.setAttribute('data-paper-grid-size', AppState.config.grid.size || 15);
            clone.setAttribute('data-paper-grid-major', AppState.config.grid.majorInterval || 5);
        }

        console.log(`[svg_sync] Persisted view state: zoom=${current.zoom}, offX=${current.offX}, offY=${current.offY}`);
    }

    // Cleanup clone (Remove editor-only temporary elements)
    const tools = clone.querySelectorAll([
        '.svg_select_shape', '.svg-select-shape',
        '.svg_select_handle', '.svg-select-handle',
        '.svg_select_handle_rot', '.svg-select-handle-rot',
        '.svg_select_handle_point', '.svg-select-handle-point',
        '.svg_select_group', '.svg-select-group',
        '.svg-canvas-proxy', '.svg-canvas-border',
        '.rotation-handle-group', '.radius-handle-group',
        '.polyline-handle-group', '.bubble-handle-group',
        '.svg-control-marker', '.svg-connector-overlay',
        '.svg-interaction-hitarea' // [NEW] もし残っていたら削除
    ].join(', '));
    tools.forEach(t => t.remove());

    // [NEW] Remove empty groups (debris from grouping/ungrouping or selection tools)
    // Note: We avoid removing <defs>, <symbol>, <marker> etc. just in case, though they are usually not <g>.
    // Using simple loop to handle nested emptiness if needed? Just top level debris is likely enough.
    const emptyGroups = clone.querySelectorAll('g');
    emptyGroups.forEach(g => {
        // Check if truly empty (no children, no text content)
        // Adjust check if we want to keep groups with specific attributes?
        // Usually an empty group <g></g> has no visual meaning.
        if (g.children.length === 0 && (!g.textContent || !g.textContent.trim())) {
            g.remove();
        }
    });

    // [NEW] Remove grid elements (editing aids, not part of the actual drawing)
    clone.querySelectorAll('.svg-grid-pattern').forEach(el => el.remove());
    clone.querySelectorAll('.svg-grid-rect').forEach(el => el.remove());
    clone.querySelectorAll('.svg-grid-lines').forEach(el => el.remove());
    clone.querySelectorAll('.svg-grid-line').forEach(el => el.remove());

    // [NEW] Remove unused marker definitions
    if (typeof cleanupUnusedMarkers === 'function') {
        cleanupUnusedMarkers(clone);
    }

    // Restore temporary styles
    clone.style.overflow = '';


    // [NEW] Text Alignment Persistence Sync
    // g[data-tool-id="shape-text-group"] 内のテキスト位置を、data-align 属性に基づいて
    // シリアライズ直前に再確定させる。これにより Markdown ソースへの保存漏れを防ぐ。
    clone.querySelectorAll('g[data-tool-id="shape-text-group"]').forEach(groupNode => {
        try {
            const group = SVG(groupNode);
            let rect = null, text = null;
            group.children().forEach(ch => {
                if (!ch.hasClass('svg-interaction-hitarea')) {
                    if (ch.type === 'rect' && !rect) rect = ch;
                    if (ch.type === 'text' && !text) text = ch;
                }
            });
            if (!rect && typeof group.findOne === 'function') {
                try { rect = group.findOne('rect:not(.svg-interaction-hitarea)'); } catch(e){}
            }
            if (!text && typeof group.findOne === 'function') {
                try { text = group.findOne('text:not(.svg-interaction-hitarea)'); } catch(e){}
            }
            if (!rect && typeof group.findOne === 'function') rect = group.findOne('rect');
            if (!text && typeof group.findOne === 'function') text = group.findOne('text');

            if (!rect || !text) return;

            const h = group.attr('data-align-h') || 'center';
            const v = group.attr('data-align-v') || 'middle';

            // [FIX] Use matrix-based box calculation (Reflow-Independent) in the clone.
            // This ensures that the text alignment is calculated based on the MOVED position of the rect.
            // [FIX] Use matrix-based box calculation (Reflow-Independent) in the clone.
            // This ensures that the text alignment is calculated based on the MOVED position of the rect.
            const rawX = parseFloat(rect.attr('x')) || 0;
            const rawY = parseFloat(rect.attr('y')) || 0;
            const rawW = parseFloat(rect.attr('width')) || 0;
            const rawH = parseFloat(rect.attr('height')) || 0;
            
            const m = rect.matrix();
            const p1 = new SVG.Point(rawX, rawY).transform(m);
            const p2 = new SVG.Point(rawX + rawW, rawY + rawH).transform(m);
            
            const rx = Math.min(p1.x, p2.x);
            const ry = Math.min(p1.y, p2.y);
            const rx2 = Math.max(p1.x, p2.x);
            const ry2 = Math.max(p1.y, p2.y);
            const rw = rx2 - rx;
            const rh = ry2 - ry;
            const rcx = rx + rw / 2;
            const rcy = ry + rh / 2;

            let fontSize = NaN;
            const orig = document.getElementById(text.attr('id'));
            if (orig && window.getComputedStyle) {
                const cs = window.getComputedStyle(orig);
                if (cs && cs.fontSize) fontSize = parseFloat(cs.fontSize);
            }
            if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.node.getAttribute('font-size'));
            if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.attr('font-size'));
            if (isNaN(fontSize) || fontSize <= 0) fontSize = 20;
            let spacingVal = parseFloat(group.attr('data-line-spacing'));
            if (isNaN(spacingVal)) spacingVal = 1.2;
            const lineSpacing = fontSize * spacingVal;
            const tspans = text.find('tspan');
            const totalOffset = (tspans.length - 1) * lineSpacing;
            const margin = 5;
            // [NEW] Writing Mode の取得
            const wm = group.attr('data-writing-mode') || text.attr('data-writing-mode') || 'h-ltr';
            const isVertical = wm === 'v-rl';
            const isRTL = wm === 'h-rtl';

            let targetX, targetY, anchor, baseline;

            // 水平方向の決定
            if (isVertical) {
                if (h === 'left') targetX = rx + margin + totalOffset;
                else if (h === 'right') targetX = rx2 - margin;
                else targetX = rcx + (totalOffset / 2);
            } else {
                if (h === 'left') {
                    // [FIX] RTL時は start/end を反転させて視覚的な「左」に合わせる
                    anchor = isRTL ? 'end' : 'start';
                    targetX = rx + margin;
                } else if (h === 'right') {
                    anchor = isRTL ? 'start' : 'end';
                    targetX = rx2 - margin;
                } else {
                    anchor = 'middle';
                    targetX = rcx;
                }
            }

            // 垂直方向の決定
            if (isVertical) {
                if (v === 'top') { anchor = 'start'; targetY = ry + margin; }
                else if (v === 'bottom') { anchor = 'end'; targetY = ry2 - margin; }
                else { anchor = 'middle'; targetY = rcy; }
                baseline = 'central';
            } else {
                if (v === 'top') {
                    baseline = 'text-before-edge';
                    targetY = ry + margin;
                } else if (v === 'bottom') {
                    baseline = 'text-after-edge';
                    targetY = ry2 - margin - totalOffset;
                } else {
                    baseline = 'central';
                    targetY = rcy - (totalOffset / 2);
                }
            }

            // クローン側のすべてのテキスト要素に属性を強制適用
            group.find('text').forEach(text => {
                // 筆記方向の適用
                if (isVertical) {
                    text.attr({ 'writing-mode': 'vertical-rl', 'direction': 'ltr' });
                    text.css({ 'writing-mode': 'vertical-rl', 'direction': 'ltr', 'unicode-bidi': 'normal' });
                } else if (isRTL) {
                    text.attr({ 'writing-mode': 'horizontal-tb', 'direction': 'rtl' });
                    // [FIX] unicode-bidi: bidi-override を追加
                    text.css({ 'writing-mode': 'horizontal-tb', 'direction': 'rtl', 'unicode-bidi': 'bidi-override' });
                } else {
                    text.attr({ 'writing-mode': 'horizontal-tb', 'direction': 'ltr' });
                    text.css({ 'writing-mode': 'horizontal-tb', 'direction': 'ltr', 'unicode-bidi': 'normal' });
                }

                text.attr({
                    'x': targetX,
                    'y': targetY,
                    'text-anchor': anchor,
                    'dominant-baseline': baseline,
                    'transform': null
                });

                // tspan にも同期
                text.find('tspan').forEach((tspan, idx) => {
                    if (isVertical) {
                        tspan.attr({
                            'x': targetX - (idx * lineSpacing),
                            'y': targetY,
                            'dy': 0,
                            'text-anchor': anchor,
                            'dominant-baseline': baseline
                        });
                    } else {
                        tspan.attr({
                            'x': targetX,
                            'y': null, // [FIX] 明示的に削除
                            'text-anchor': anchor,
                            'dominant-baseline': baseline,
                            'dy': idx === 0 ? 0 : lineSpacing
                        });
                    }
                });
            });

        } catch (e) {
            console.warn('[svg_sync] Failed to restore alignment for group:', e);
        }
    });

    // [NEW] 単体テキストの同期処理 (data-line-spacing 等の反映)
    clone.querySelectorAll('text[data-line-spacing]').forEach(textNode => {
        try {
            const text = SVG(textNode);
            let fontSize = NaN;
            const orig = document.getElementById(text.attr('id'));
            if (orig && window.getComputedStyle) {
                const cs = window.getComputedStyle(orig);
                if (cs && cs.fontSize) fontSize = parseFloat(cs.fontSize);
            }
            if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.node.getAttribute('font-size'));
            if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.attr('font-size'));
            if (isNaN(fontSize) || fontSize <= 0) fontSize = 20;
            let spacingVal = parseFloat(text.attr('data-line-spacing'));
            if (isNaN(spacingVal)) spacingVal = 1.2;
            const lineSpacing = fontSize * spacingVal;
            const targetX = text.attr('x') || 0;

            text.find('tspan').forEach((tspan, idx) => {
                tspan.attr({
                    'x': targetX,
                    'dy': idx === 0 ? 0 : lineSpacing
                });
            });
        } catch (e) { }
    });

    // 【No.4 修正】 巨大なSVG（300KB以上）は負荷を減らすため、文字列処理や整形をスキップ
    const rawHTML = clone.outerHTML;
    const isHuge = rawHTML.length > 300000;
    const elementCount = clone.querySelectorAll('*').length;

    // [FIX] 巨大SVG時やドラッグ中のリアルタイム同期(silent=true)時は丸め処理をスキップ (Optimization 4)
    const isDraggingOrResizing = window.currentEditingSVG && (window.currentEditingSVG._isDragging || window.currentEditingSVG._isResizing);
    const skipRounding = isHuge || elementCount > 200 || (silent === true && isDraggingOrResizing);

    if (!skipRounding) {
        // Also remove classes from elements and round numeric attributes
        const elements = clone.querySelectorAll('*');
        elements.forEach(el => {
            el.classList.remove('svg_select_isSelected');

            // 丸め処理用関数 (小数第3位まで)
            const round3 = (val) => Math.round(val * 1000) / 1000;

            // 一般的な数値属性の丸め
            ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'].forEach(attr => {
                const val = el.getAttribute(attr);
                if (val && !isNaN(val)) {
                    el.setAttribute(attr, round3(parseFloat(val)));
                }
            });

            // カスタムデータ属性(data-arrow-* など)の丸め
            Array.from(el.attributes).forEach(attr => {
                if (attr.value.length > 512) return;
                if (attr.name.startsWith('data-') && !isNaN(attr.value) && attr.value.trim() !== '') {
                    el.setAttribute(attr.name, round3(parseFloat(attr.value)));
                }
            });

            // transform属性の丸め
            const transform = el.getAttribute('transform');
            if (transform && transform.length < 5000 && transform.includes('.')) {
                const roundedTransform = transform.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (match) => {
                    return round3(parseFloat(match));
                });
                el.setAttribute('transform', roundedTransform);
            }

            // path要素のd属性の丸め
            if (el.tagName.toLowerCase() === 'path') {
                const d = el.getAttribute('d');
                if (d && d.length < 1500 && d.includes('.')) {
                    const roundedD = d.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (match) => {
                        return round3(parseFloat(match));
                    });
                    el.setAttribute('d', roundedD);
                }
            }

            // points属性の丸め
            if (el.tagName.toLowerCase() === 'polyline' || el.tagName.toLowerCase() === 'polygon') {
                const pts = el.getAttribute('points');
                if (pts && pts.length < 1500 && pts.includes('.')) {
                    const roundedPts = pts.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (match) => {
                        return round3(parseFloat(match));
                    });
                    el.setAttribute('points', roundedPts);
                }
            }

            // カスタムポイントデータ属性の丸め
            ['data-poly-points', 'stroke-dasharray'].forEach(attr => {
                const val = el.getAttribute(attr);
                if (val && val.length < 1500 && val.includes('.')) {
                    const rounded = val.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (match) => {
                        return round3(parseFloat(match));
                    });
                    el.setAttribute(attr, rounded);
                }
            });

            // CSS変数やインラインスタイル内の数値丸め
            ['font-size', 'stroke-width', 'letter-spacing'].forEach(attr => {
                const val = el.getAttribute(attr);
                if (val && !isNaN(parseFloat(val))) {
                    const rounded = val.replace(parseFloat(val), round3(parseFloat(val)));
                    el.setAttribute(attr, rounded);
                }
                if (el.style && el.style[attr]) {
                    const sVal = el.style[attr];
                    if (!isNaN(parseFloat(sVal))) {
                        const rounded = sVal.replace(parseFloat(sVal), round3(parseFloat(sVal)));
                        el.style[attr] = rounded;
                    }
                }
            });

            // viewBox の丸め
            if (el.tagName.toLowerCase() === 'svg') {
                const vb = el.getAttribute('viewBox');
                if (vb && vb.includes('.')) {
                    const roundedVb = vb.replace(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (match) => {
                        return round3(parseFloat(match));
                    });
                    el.setAttribute('viewBox', roundedVb);
                }
            }
        });
    }

    let svgCode = clone.outerHTML;
    if (!isHuge) {
        svgCode = formatSVGCode(svgCode);
    }
    console.log(`[svg_sync] Final SVG string generated. viewBox in string: ${svgCode.match(/viewBox=["']([^"']+)["']/)?.[1]}`);
    console.log(`[svg_sync] Serialization Result (Preview):`, svgCode.substring(0, 500) + '...');


    // Editor update logic
    if (typeof DOM === 'undefined' || !DOM.editor) return; // Guard

    const editorContent = getEditorText();
    const lines = editorContent.split('\n');

    let currentSvgIndex = 0;
    let startLine = -1;
    let endLine = -1;
    let inSvgBlock = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '```svg') {
            if (currentSvgIndex === svgIndex) {
                startLine = i;
                inSvgBlock = true;
            }
            currentSvgIndex++;
        } else if (inSvgBlock && lines[i].trim() === '```') {
            endLine = i;
            break;
        }
    }

    if (startLine !== -1 && endLine !== -1) {
        // [NEW] Save fold state of this block before replacing
        const foldedSignatures = new Set();
        const editor = DOM.editorInstance || DOM.editor;
        if (window.CM6 && window.CM6.foldedRanges && editor && editor.state) {
            const state = editor.state;
            const foldedIt = window.CM6.foldedRanges(state).iter();
            while (foldedIt.value) {
                const foldPos = foldedIt.from;
                const lineObj = state.doc.lineAt(foldPos);
                // lineObj.number is 1-based, startLine is 0-based
                if (lineObj.number >= startLine + 1 && lineObj.number <= endLine + 1) {
                    // Save the stable signature of the folded line
                    foldedSignatures.add(getFoldSignature(lineObj.text));
                }
                foldedIt.next();
            }
        }

        // 元の ```svg 行のインデント（行頭の空白）を取得
        const startLineText = lines[startLine];
        const indentationMatch = startLineText.match(/^\s*/);
        const indentation = indentationMatch ? indentationMatch[0] : '';

        // SVGコードの各行にも同じインデントを適用
        const indentedSvgCode = svgCode.split('\n')
            .map(line => line.trim() ? indentation + line : line) // 空行には余計なスペースを入れない
            .join('\n');

        // 開始/終了の ``` にもインデントを付与
        const newBlock = `${indentation}\`\`\`svg\n${indentedSvgCode}\n${indentation}\`\`\``;

        // [LOG-VERBOSE] Verify height in the actual block we are about to write
        const writtenHeightMatch = svgCode.match(/height="(\d+(?:\.\d+)?)"/);
        console.log(`[syncSVGToEditor] FINAL BLOCK VERIFICATION: Height="${writtenHeightMatch ? writtenHeightMatch[1] : 'NOT FOUND'}" (Line ${startLine + 1})`);

        // [FIX] フラグを立てて、この変更によるeditor_core.js側のdocChangedが
        // updateSVGFromEditorを呼ばないようにする
        if (window.currentEditingSVG) {
            window.currentEditingSVG._syncingToEditor = true;
            // [NEW] エディタ→SVGへの逆方向同期タイマーが動いていればキャンセルする
            if (window._svgSyncFromEditorTimer) {
                console.log('[syncSVGToEditor] Cancelling pending reverse sync timer.');
                clearTimeout(window._svgSyncFromEditorTimer);
                window._svgSyncFromEditorTimer = null;
            }
        }

        // [FIX] Surgical update instead of full-text rewrite
        // DOM.editor.replaceLines is 1-based, startLine is 0-based index of ```svg
        // endLine is 0-based index of ```
        DOM.editor.replaceLines(startLine + 1, endLine + 1, newBlock);

        if (typeof AppState !== 'undefined') {
            AppState.text = getEditorText();
            AppState.isModified = true;
            if (typeof updateTitle === 'function') updateTitle();
        }

        // Trigger render updates ONLY if not silent
        if (!silent) {
            DOM.editor.dispatchEvent(new Event('input'));
        }

        // [FIX] CodeMirror v6のupdateListenerは非同期または遅れて発火する場合があるため、
        // 余裕を持ってフラグを解除する（editor_coreのデバウンス120+300msより長く設定）
        if (window.currentEditingSVG) {
            clearTimeout(window.currentEditingSVG._syncingToEditorTimer);
            window.currentEditingSVG._syncingToEditorTimer = setTimeout(() => {
                if (window.currentEditingSVG) {
                    const currentDocHeight = getEditorText().match(/height="(\d+)"/)?.[1];
                    console.log(`[syncSVGToEditor] Syncing guard cleared. Current source height in editor: ${currentDocHeight}`);
                    window.currentEditingSVG._syncingToEditor = false;
                }
            }, 400); // 800ms -> 400ms に短縮 (マウス操作をブロックしすぎないよう調整)
        }

        // [NEW] Restore fold state
        if (foldedSignatures.size > 0 && window.CM6 && window.CM6.foldEffect && window.CM6.foldable) {
            setTimeout(() => {
                try {
                    const editor = DOM.editorInstance || DOM.editor;
                    if (!editor || !editor.state) return;
                    const state = editor.state;
                    const effects = [];
                    // Search lines in the new block for matches
                    let searchLine = startLine + 2; // the first content line
                    while (searchLine <= state.doc.lines) {
                        const lineObj = state.doc.line(searchLine);
                        const lineText = lineObj.text;
                        if (lineText.trim() === '```') break;

                        const sig = getFoldSignature(lineText);
                        if (foldedSignatures.has(sig)) {
                            // Find the foldable range for this line
                            const range = window.CM6.foldable(state, lineObj.from, lineObj.to);
                            if (range) {
                                effects.push(window.CM6.foldEffect.of(range));
                                // Make sure not to fold it again if identical text is repeated, 
                                // though repeated IDs are unlikely in robust SVG
                                foldedSignatures.delete(sig);
                            }
                        }
                        searchLine++;
                    }
                    if (effects.length > 0) {
                        editor.dispatch({ effects: effects });
                    }
                } catch (e) {
                    console.warn('[svg_sync] Failed to restore fold state:', e);
                }
            }, 100); // 100ms waits for syntax tree to be updated post-dispatch
        }

        // [NEW] テキスト置換によってCodeMirrorのデコレーションが揮発する問題を防ぐため、
        // 同期完了直後にハイライトを再適用して復元する
        if (typeof window.updateSVGSourceHighlight === 'function') {
            window.updateSVGSourceHighlight();
        }

        // [NEW] Update SVG List panel after sync
        if (typeof window.buildSvgList === 'function') {
            window.buildSvgList();
        }
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
    const { draw, svgIndex } = window.currentEditingSVG;
    if (!draw || svgIndex === undefined) return;

    // [FIX] 削除前に選択されている要素のIDを記録しておく
    const selectedIds = Array.from(window.currentEditingSVG.selectedElements)
        .filter(el => el.node && el.node.isConnected)
        .map(el => el.id());

    // 一旦全ての選択を解除（古いDOM要素への参照をクリア）
    if (typeof deselectAll === 'function') deselectAll();

    // ループ防止フラグをチェック
    if (window.currentEditingSVG._syncingToEditor || window._isDispatchingSvgSync) {
        console.log(`[updateSVGFromEditor] Aborted: Syncing to editor is in progress. (_syncingToEditor=${window.currentEditingSVG._syncingToEditor}, _isDispatchingSvgSync=${!!window._isDispatchingSvgSync})`);
        return;
    }

    // [FIX] CSS 編集モード中は、エディタからの再描画を行わない（プレビュー中の一時的な変更のリセットを防ぐ）
    if (window.currentEditingSVG._inCSSEditMode) {
        console.log(`[updateSVGFromEditor] Aborted: In CSS Edit Mode to prevent flickering.`);
        return;
    }

    // [FIX] 逆方向同期の抑制: キャンバス操作中（ドラッグ・リサイズ中）はエディタからの同期を破棄する
    if (window.currentEditingSVG && (window.currentEditingSVG._isDragging || window.currentEditingSVG._isResizing)) {
        return;
    }

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
                // [WATCH] Detect unnatural reset to 350
                if (window.currentEditingSVG.baseHeight !== 350 && newVb.height === 350) {
                    console.warn(`[updateSVGFromEditor] UNNATURAL RESET DETECTED! Height changing from ${window.currentEditingSVG.baseHeight} back to 350. Source: viewBox`);
                    console.trace();
                }

                window.currentEditingSVG.baseWidth = newVb.width;
                window.currentEditingSVG.baseHeight = newVb.height;
                window.currentEditingSVG.baseX = newVb.x;
                window.currentEditingSVG.baseY = newVb.y;
                console.log(`[updateSVGFromEditor] Updated memory from viewBox: ${newVb.x} ${newVb.y} ${newVb.width} ${newVb.height}`);
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

        // [FIX] 記録しておいたIDを元に、新しいDOM要素を選択し直す
        if (selectedIds.length > 0) {
            console.log(`[updateSVGFromEditor] Restoring selection: ${selectedIds.join(', ')}`);
            selectedIds.forEach(id => {
                const newEl = draw.findOne('#' + id);
                if (newEl) {
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
            window.currentEditingSVG._updatingFromEditor = false;
        }
        // [NEW] スクロールロック解除
        window.isScrolling = prevIsScrolling;
    }
}
window.updateSVGFromEditor = updateSVGFromEditor;
