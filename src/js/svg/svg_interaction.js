/**
 * SVG Editor Interaction
 * - Selection, Drag & Drop, Keyboard Events
 * - Toolbar Value Updates
 */

/**
 * Check if SVG interaction is active
 */
function isSVGEditing() {
    return !!window.currentEditingSVG;
}
window.isSVGEditing = isSVGEditing;

/**
 * Make an element interactive (Selectable, Draggable, Sync)
 */
function makeInteractive(el) {
    // Avoid re-initializing internal tools
    if (el.hasClass('svg_select_shape') || el.hasClass('svg_select_handle')) return;

    // [NEW] Use SvgShape class hierarchy
    // Assuming wrapShape is global or available via SvgShape.js (window.wrapShape?)
    // SvgShape.js needs to export wrapShape globally.
    if (typeof wrapShape !== 'function') {
        console.warn('wrapShape not found. SvgShape.js might not be loaded.');
        return;
    }
    const shape = wrapShape(el);
    shape.init();

    // [FIX] Ensure element is strictly linked to root in SVG.js v3
    // Sometimes wrapShape might be called on elements that haven't fully inherited the root reference.
    if (!el.root() && window.currentEditingSVG && window.currentEditingSVG.draw) {
        delete el.node.instance; // Force new instance creation
        const rewrapped = SVG(el.node);
        if (!rewrapped.root()) {
            // Error handling
        }
    }


    // Fix Text Tspan pinning
    // [NOTE] We intentionally do NOT strip x attributes from tspans here.
    // Our inline editor sets explicit x attributes on each tspan to ensure
    // proper horizontal alignment on multiline text. Removing them would
    // break multiline text rendering by collapsing all lines to x=0.
    if (el.type === 'text') {
        // [REMOVED] Inline Editing dblclick now handled by SvgShape base class
    }
}
window.makeInteractive = makeInteractive;

/**
 * Select an element
 */
function selectElement(el, isMulti, silent = false) {
    if (!window.currentEditingSVG) {
        return;
    }

    // [FIX] CSS 編集モード中は、プレビュー以外の要素を選択させない
    if (window.currentEditingSVG._inCSSEditMode) {
        console.log(`[selectElement] BLOCKED: In CSS Edit Mode.`);
        return;
    }

    // [NEW] Robustness: If el is a native Node, wrap it with SVG()
    if (el instanceof Node) {
        el = SVG(el);
    }

    // [FIX] Prevent selection of hidden elements
    if (!el.visible()) {
        return;
    }

    // [FIX] Ensure element has root before proceeding with selection/resize
    if (!el.root() && window.currentEditingSVG.draw) {
        if (el.node && !el.node.isConnected) {
            return;
        }
        if (el.node) delete el.node.instance; // Clear stale instance
        el = SVG(el.node || el); // Re-adopt/Link to root AND update reference
    }

    // ▼▼▼ 追加: すでに選択されている場合のガード処理 ▼▼▼
    const alreadySelected = window.currentEditingSVG.selectedElements.has(el);
    
    if (!isMulti && alreadySelected && window.currentEditingSVG.selectedElements.size === 1) {
        // 単一選択モードで自分のみが選択されている場合は何もしない
        return;
    } else if (!isMulti) {
        deselectAll();
    } else if (isMulti && alreadySelected) {
        // マルチ選択モードで既に選択済みの場合は多重登録を防ぐためリターン
        return;
    }

    window.currentEditingSVG.selectedElements.add(el);
    // ▲▲▲ ここまで ▲▲▲
    // [NEW] Update transform toolbar after adding element to selection
    updateTransformToolbarValues();

    // [NEW] Delegate Selection UI to SvgShape instance
    const shape = el.remember('_shapeInstance');
    if (shape && typeof shape.applySelectionUI === 'function') {
        try {
            shape.applySelectionUI();
        } catch (e) {
            console.warn('[selectElement] shape.applySelectionUI failed:', e);
        }
    } else {
        // Fallback for non-wrapped elements
        // [FIX] Ensure element is connected to a root and has select method before calling
        if (typeof el.select === 'function' && el.root()) {
            try {
                el.select({ rotationPoint: false, deepSelect: true });
            } catch (e) {
                console.warn('[selectElement] el.select failed:', e);
            }
        }
    }

    if (typeof el.resize === 'function' && !shape && el.root()) {
        try {
            el.resize();
        } catch (e) {
            console.warn('[selectElement] el.resize failed:', e);
        }
    }

    // [NEW] Toolbars Visibility & Update
    const selected = Array.from(window.currentEditingSVG.selectedElements);
    const hasStyleTarget = selected.some(item => item.type !== 'text');

    if (window.SVGFontToolbar) {
        window.SVGFontToolbar.show();
        window.SVGFontToolbar.updateFromSelection();
    }

    if (window.SVGLineToolbar) {
        if (hasStyleTarget) {
            window.SVGLineToolbar.show();
            window.SVGLineToolbar.updateFromSelection();
        }
    }

    if (window.colorToolbar) {
        if (hasStyleTarget) {
            window.colorToolbar.show();
            if (typeof window.colorToolbar.updateFromSelection === 'function') {
                window.colorToolbar.updateFromSelection();
            }
        }
    }

    if (window.styleToolbar) {
        if (hasStyleTarget) {
            window.styleToolbar.show();
            if (typeof window.styleToolbar.updateFromSelection === 'function') {
                window.styleToolbar.updateFromSelection();
            }
        }
    }

    // [NEW] CSSツールバーの選択状態を更新
    if (window.cssToolbar && typeof window.cssToolbar.updateFromSelection === 'function') {
        window.cssToolbar.updateFromSelection();
    }

    // [NEW] テキスト配置ツールバーの選択状態を更新
    if (window.SVGTextAlignmentToolbar && typeof window.SVGTextAlignmentToolbar.updateFromSelection === 'function') {
        window.SVGTextAlignmentToolbar.updateFromSelection();
    }

    if (typeof el.resize === 'function') {
        // [NEW] Snap to dynamic grid on Resize/Rotate
        el.off('resize.snap'); // Avoid duplicates
        el.on('resize.snap', function (e) {
            const isAlt = SVGUtils.isSnapEnabled(e.detail ? e.detail.event : e);
            const isShift = (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed) || e.detail.event.shiftKey;
            const handler = e.detail.handler;

            const gridConfig = AppState.config.grid || { size: 15, showV: true, showH: true };

            if (handler) {
                // Resize snap -> Alt key
                handler.grid = isAlt ? gridConfig.size : 0;
                // Rotation snap -> Shift key (fixed 15deg as per requirement)
                handler.degree = isShift ? 15 : 0;
            }
        });
    }

    // Listen for resize changes
    const handleCanvasSync = (isSilent = true, event = null) => {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;

        // [GUARD] 逆方向の同期（エディタへの書き戻し）が行われている最中は、キャンバス側からの更新を無視する
        if (window.currentEditingSVG._syncingToEditor) {
            // console.log('[handleCanvasSync] Ignored: _syncingToEditor is active.');
            return;
        }

        const draw = window.currentEditingSVG.draw;
        const isProxy = el.hasClass('svg-canvas-proxy');

        if (el.type === 'svg' || isProxy) {
            const inset = isProxy ? (window.currentEditingSVG.canvasInset || 4) : 0;

            // [NEW] Use box from event if available (more reliable during active resize)
            let w, h, x, y;
            if (event && event.detail && event.detail.box) {
                const box = event.detail.box;
                w = Math.round(box.width + (inset * 2));
                h = Math.round(box.height + (inset * 2));
                x = Math.round(box.x - inset);
                y = Math.round(box.y - inset);
            } else {
                w = Math.round(el.width() + (inset * 2));
                h = Math.round(el.height() + (inset * 2));
                x = Math.round((isProxy ? el.x() : 0) - inset);
                y = Math.round((isProxy ? el.y() : 0) - inset);
            }

            const node = draw.node;
            const current = window.currentEditingSVG;

            if (isSilent) {
                // NO-OP for visual root
            } else {
                node.setAttribute('width', w);
                node.setAttribute('height', h);
                node.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);

                if (current.container) {
                    current.container.style.width = '';
                    current.container.style.height = '';
                }
            }

            updateTransformToolbarValues();

            const dims = { w, h, x, y };

            // [FIX] Update memory source of truth immediately during resize
            if (window.currentEditingSVG) {
                const cur = window.currentEditingSVG;
                cur.baseWidth = w;
                cur.baseHeight = h;
                cur.baseX = x;
                cur.baseY = y;

                // [FIX] 同期値の保護は不要になったため、常に測定値を使用して同期する
                syncChanges(isSilent, dims);
            } else {
                syncChanges(isSilent, dims);
            }
        }
    };

    // [NEW] 同期ハイライトの更新呼び出し
    if (typeof window.updateSVGSourceHighlight === 'function') {
        window.updateSVGSourceHighlight();
    }

    // Unified resize handler
    el.on('resize.selection', (e) => {
        const nativeEvent = e.detail.event;
        const isDone = nativeEvent && (nativeEvent.type === 'mouseup' || nativeEvent.type === 'touchend');

        // [GUARD] キャンバスプロキシのリサイズは CanvasShape (SvgShape.js) が専任で扱う。
        // ドラッグ中（!isDone）にここで重複して同期を走らせると、プレビューの再描画ループを引き起こすため除外。
        if (el.hasClass('svg-canvas-proxy') && !isDone) return;

        // [NEW] 接続されている線をリアルタイムに更新
        if (window.SVGConnectorManager) {
            window.SVGConnectorManager.updateConnectionsFromElement(el);
        }

        // [NEW] 頂点ハンドラ（ベジェ・折れ線）もリアルタイムに更新
        const shape = el.remember('_shapeInstance');
        if (shape && typeof shape.syncSelectionHandlers === 'function') {
            shape.syncSelectionHandlers();
        }

        if (isDone) {
            window.currentEditingSVG.isSyncing = true;
            handleCanvasSync(false, e);
            // [NEW] 相互作用終了位時にハイライトを再同期
            if (typeof window.updateSVGSourceHighlight === 'function') {
                window.updateSVGSourceHighlight();
            }
        } else {
            handleCanvasSync(true, e);
        }
    });

    // [NEW] 回転時（rot）のリアルタイム追従（SVG.jsネイティブ）
    el.on('rot', (e) => {
        // [LOCK GUARD]
        const isLocked = el.attr('data-locked') === 'true' || el.attr('data-locked') === true;
        if (isLocked) return;

        if (window.SVGConnectorManager) {
            window.SVGConnectorManager.updateConnectionsFromElement(el);
        }

        const shape = el.remember('_shapeInstance');
        if (shape && typeof shape.syncSelectionHandlers === 'function') {
            shape.syncSelectionHandlers();
        }
    });

    // [NEW] 確実なトラッキングのためのMutationObserver (transform属性監視)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'transform') {
                if (window.SVGConnectorManager) {
                    window.SVGConnectorManager.updateConnectionsFromElement(el);
                }
                const shape = el.remember('_shapeInstance');
                if (shape && typeof shape.syncSelectionHandlers === 'function') {
                    // CTMが更新されるよう、少し遅延させるか同期実行
                    shape.syncSelectionHandlers();
                }
            }
        }
    });
    observer.observe(el.node, { attributes: true, attributeFilter: ['transform'] });

    // [REMOVED] Canvasのハンドル制限のための setTimeout を除去
    // SvgShape.applySelectionUI 内で updateCanvasUI(true) を呼ぶようにしたため、この遅延実行は不要かつ
    // 「行ったり来たり（Jumping）」の原因となる。

    // クリーンアップ処理を登録
    el.on('remove.selection cleanup.selection', () => {
        observer.disconnect();
    });

    // [NEW] SVGリスト情報の再構築（キャンバス選択を反映）
    if (!silent && typeof buildSvgList === 'function') {
        buildSvgList();
    }
}
window.selectElement = selectElement;

/**
 * Deselect all elements
 */
function deselectElement(el, silent = false) {
    if (!window.currentEditingSVG) return;

    if (window.currentEditingSVG.selectedElements.has(el)) {
        // [FIX] Ensure custom markers are cleared
        const shape = el.remember('_shapeInstance');
        if (shape) {
            if (typeof shape.clearSelectionUI === 'function') shape.clearSelectionUI();
            if (typeof shape.clearControlMarkers === 'function') shape.clearControlMarkers();
        }

        if (typeof el.select === 'function') el.select(false);
        if (typeof el.resize === 'function') el.resize(false);
        el.off('.selection');

        window.currentEditingSVG.selectedElements.delete(el);

        // UI Updates
        updateTransformToolbarValues();
        if (typeof window.updateSVGSourceHighlight === 'function') {
            window.updateSVGSourceHighlight();
        }

        // [NEW] SVGリスト情報の再構築
        if (!silent && typeof buildSvgList === 'function') {
            buildSvgList();
        }
    }
}
window.deselectElement = deselectElement;

/**
 * Deselect all elements
 */
function deselectAll(silent = false) {
    if (!window.currentEditingSVG) return;

    // [FIX] CSS 編集モード中は、選択を一斉解除させない（プレビュー選択を維持するため）
    if (window.currentEditingSVG._inCSSEditMode) {
        console.log(`[deselectAll] BLOCKED: In CSS Edit Mode.`);
        return;
    }

    // Use a copy of the set to avoid mutation issues during loop
    const selected = Array.from(window.currentEditingSVG.selectedElements);
    selected.forEach(el => {
        deselectElement(el, true);
    });

    if (window.currentEditingSVG.rotationHandler) window.currentEditingSVG.rotationHandler.hide();
    if (window.currentEditingSVG.radiusHandler) window.currentEditingSVG.radiusHandler.hide();
    if (window.currentEditingSVG.polylineHandler) window.currentEditingSVG.polylineHandler.hide();
    if (window.currentEditingSVG.bubbleHandler) window.currentEditingSVG.bubbleHandler.hide();

    // [NEW] Hide Text Alignment Toolbar
    if (window.SVGTextAlignmentToolbar) {
        window.SVGTextAlignmentToolbar.hide();
    }

    // [NEW] Hide Font Toolbar
    if (window.SVGFontToolbar) {
        window.SVGFontToolbar.hide();
    }

    // Keep Style/Line toolbars always visible

    updateTransformToolbarValues();

    // [NEW] 同期ハイライトの更新呼び出し
    if (typeof window.updateSVGSourceHighlight === 'function') {
        window.updateSVGSourceHighlight();
    }

    // [NEW] SVGリスト情報の再構築
    if (!silent && typeof buildSvgList === 'function') {
        buildSvgList();
    }
}
window.deselectAll = deselectAll;

/**
 * [NEW] SVG要素ハイライトの更新
 * 選択中の要素とホバー中の要素のIDを収集し、エディタ側のハイライトを更新する
 */
function updateSVGSourceHighlight() {
    if (!window.currentEditingSVG) return;

    const highlights = [];
    const processedIds = new Set();
    const svgIndex = window.currentEditingSVG.svgIndex;

    // 1. 選択中の要素（優先）
    if (window.currentEditingSVG.selectedElements) {
        window.currentEditingSVG.selectedElements.forEach(el => {
            if (el && typeof el.id === 'function') {
                const id = el.id();
                if (id) {
                    // 同一IDの中での出現順序を計算
                    const siblingsWithSameId = window.currentEditingSVG.draw.find(`#${id}`);
                    const index = siblingsWithSameId.indexOf(el);
                    highlights.push({ id, type: 'select', index: index >= 0 ? index : 0 });
                    processedIds.add(id);
                }
            }
        });
    }

    // 2. ホバー中の要素
    if (window._hoveredSvgElement) {
        try {
            const el = window._hoveredSvgElement;
            if (el && typeof el.id === 'function') {
                const id = el.id();
                if (id && !processedIds.has(id)) {
                    // 同一IDの中での出現順序を計算
                    const siblingsWithSameId = window.currentEditingSVG.draw.find(`#${id}`);
                    const index = siblingsWithSameId.indexOf(el);
                    highlights.push({ id, type: 'hover', index: index >= 0 ? index : 0 });
                }
            }
        } catch (e) {
            console.warn('[updateSVGSourceHighlight] Error fetching hover element ID', e);
        }
    }

    // No logging for production-ready state

    if (typeof window.setSVGSourceHighlights === 'function') {
        window.setSVGSourceHighlights(highlights);
    }
}
window.updateSVGSourceHighlight = updateSVGSourceHighlight;

// --- Event Handlers ---

function exitEditOnClickOutside(e) {
    if (!window.currentEditingSVG) return;
    const activeDialog = document.querySelector('.svg-property-dialog');
    if (activeDialog) return;

    const isInsideContainer = window.currentEditingSVG.container.contains(e.target);
    const isToolbar = e.target.closest('.svg-toolbar');
    const clickedInsideEditingArea = e.target.closest('.svg-editing');

    if (!isInsideContainer && !isToolbar && !clickedInsideEditingArea) {
        if (typeof stopSVGEdit === 'function') stopSVGEdit();
    }
}
window.exitEditOnClickOutside = exitEditOnClickOutside;

function svgEscapeHandler(e) {
    if (e.key === 'Escape' && window.currentEditingSVG) {
        if (typeof stopSVGEdit === 'function') stopSVGEdit();
    }
}
window.svgEscapeHandler = svgEscapeHandler;

function svgDeleteKeyHandler(e) {
    if (!window.currentEditingSVG) return;

    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        const shapesToDelete = selected.filter(el => !el.hasClass('svg-canvas-proxy') && el.attr('data-locked') !== 'true');

        if (shapesToDelete.length > 0) {
            e.preventDefault();
            if (typeof deleteSelectedElements === 'function') deleteSelectedElements();
        }
    }
}
window.svgDeleteKeyHandler = svgDeleteKeyHandler;

// --- Drag & Drop ---

// --- Transform Toolbar Integration ---

function updateTransformToolbarValues() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.transformToolbar) {
        return;
    }

    const selected = Array.from(window.currentEditingSVG.selectedElements);

    // [FIX] Ensure all selected elements are still part of the current draw session
    const currentDrawNode = window.currentEditingSVG.draw.node;
    const validSelection = selected.filter(el => {
        if (!el.node || !el.node.isConnected) return false;
        return currentDrawNode.contains(el.node);
    });

    if (validSelection.length !== selected.length) {
        // Optional: Sync selection back if we want to be strict
    }

    const data = { x: null, y: null, w: null, h: null, angle: null };

    // Transform ToolbarはviewBox座標系で表示する
    const pageX = 0;
    const pageY = 0;

    const getVal = (elements, prop) => {
        let first = null;
        for (const el of elements) {
            if (!el || typeof el.bbox !== 'function') continue;
            let val = 0;
            const isProxy = el.hasClass('svg-canvas-proxy');

            try {
                // [FIX] 行列を適用したあとの正確な「表示座標」と「表示サイズ」を取得する
                const m = el.matrix() || new SVG.Matrix();
                const bbox = isProxy ? { x: el.x(), y: el.y(), w: el.width(), h: el.height() } : el.bbox();

                // 行列適用後のボックス (回転がある場合は外接矩形になるが、スケール変化は正しく反映される)
                const transformedBox = new SVG.Box(bbox).transform(m);

                switch (prop) {
                    case 'x': val = isProxy ? 0 : transformedBox.x; break;
                    case 'y': val = isProxy ? 0 : transformedBox.y; break;
                    case 'w': val = transformedBox.w; break;
                    case 'h': val = transformedBox.h; break;
                    case 'angle':
                        val = el.transform().rotate || 0;
                        break;
                }
            } catch (err) {
                console.warn(`[SVG Transform] Failed to get ${prop}`, err);
                val = 0;
            }

            val = Math.round(val * 10) / 10;
            if (isNaN(val)) val = 0;

            if (first === null) first = val;
            else if (first !== val) return '';
        }
        return first === null ? 0 : first;
    };

    if (selected.length === 0) {
        // [FIX] 表示枠 (viewBox) ではなく、メモリ上の数値を正解として表示する
        const cur = window.currentEditingSVG;
        const inset = cur.canvasInset || 0;
        data.x = Math.round((cur.baseX || 0) * 10) / 10;
        data.y = Math.round((cur.baseY || 0) * 10) / 10;
        data.w = Math.round((cur.baseWidth || 820) * 10) / 10;
        data.h = Math.round((cur.baseHeight || 350) * 10) / 10;
        data.angle = 0;
    } else {
        data.x = getVal(selected, 'x');
        data.y = getVal(selected, 'y');
        data.w = getVal(selected, 'w');
        data.h = getVal(selected, 'h');
        data.angle = getVal(selected, 'angle');
    }

    window.currentEditingSVG.transformToolbar.updateValues(data);
}
window.updateTransformToolbarValues = updateTransformToolbarValues;

function handleTransformChange(id, value) {
    if (!window.currentEditingSVG || isNaN(value)) return;
    const selected = Array.from(window.currentEditingSVG.selectedElements);

    // viewBox座標系で処理
    const pageX = 0;
    const pageY = 0;

    const update = (el) => {
        // [LOCK GUARD]
        if (el.attr('data-locked') === 'true') return;

        const isProxy = el.hasClass('svg-canvas-proxy');
        const inset = window.currentEditingSVG.canvasInset || 0;

        const currentBox = isProxy ? { x: el.x(), y: el.y(), w: el.width(), h: el.height() } : el.bbox();

        switch (id) {
            case 'x':
                if (isProxy) el.x(value + inset);
                else {
                    const dx = (value + pageX) - currentBox.x;
                    const m = el.matrix();
                    el.matrix(m.a, m.b, m.c, m.d, m.e + dx, m.f);
                }
                break;
            case 'y':
                if (isProxy) el.y(value + inset);
                else {
                    const dy = (value + pageY) - currentBox.y;
                    const m = el.matrix();
                    el.matrix(m.a, m.b, m.c, m.d, m.e, m.f + dy);
                }
                break;
            case 'w':
                if (isProxy) el.width(value);
                else el.width(value);
                break;
            case 'h':
                if (isProxy) el.height(value);
                else el.height(value);
                break;
            case 'angle':
                el.rotate(value);
                break;
        }

        // [NEW] Sync metadata for paths if dimensions changed directly
        if (id === 'w' || id === 'h') {
            if (window.SVGUtils && window.SVGUtils.refreshPathMetadata) {
                window.SVGUtils.refreshPathMetadata(el);
            }
        }

        if (isProxy) {
            el.fire('resize', { event: { type: 'mouseup' }, handler: null });
        } else {
            // [NEW] 接続されている線を更新
            if (window.SVGConnectorManager) {
                window.SVGConnectorManager.updateConnectionsFromElement(el);
            }
            const shape = el.remember('_shapeInstance');
            if (shape && typeof shape.syncSelectionHandlers === 'function') {
                shape.syncSelectionHandlers();
            }
        }
    };

    if (selected.length === 0) {
        const draw = window.currentEditingSVG.draw;
        const vb = draw.node.viewBox.baseVal;
        const inset = window.currentEditingSVG.canvasInset || 0;
        let { x, y, width, height } = vb;
        switch (id) {
            case 'x': x = value - inset; break;
            case 'y': y = value - inset; break;
            case 'w': width = value + inset * 2; break;
            case 'h': height = value + inset * 2; break;
        }
        draw.node.setAttribute('width', width);
        draw.node.setAttribute('height', height);
        draw.node.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);

        if (window.currentEditingSVG.canvasProxy) {
            const targetW = Math.max(10, width - inset * 2);
            const targetH = Math.max(10, height - inset * 2);
            window.currentEditingSVG.canvasProxy.size(targetW, targetH).move(x + inset, y + inset);
        }
        syncChanges(false);
    } else {
        selected.forEach(update);
        syncChanges(false);
    }

    if (selected.length > 0) {
        selected.forEach(el => {
            const shape = el.remember('_shapeInstance');
            if (shape && typeof shape.applySelectionUI === 'function') {
                shape.applySelectionUI();
            }
        });
    }
}
window.handleTransformChange = handleTransformChange;
