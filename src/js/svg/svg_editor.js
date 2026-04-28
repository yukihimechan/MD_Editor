/**
 * SVG Editor - Powered by SVG.js
 * (Refactored: Main Entry Point)
 */

window.currentEditingSVG = null;

// [FIX] Define as global variable explicitly for other modules
// let window.currentEditingSVG = null; // Removed local let to enforce window usage

/**
 * Start SVG Editing Mode
 * @param {HTMLElement} container - The container element (split-cell)
 * @param {number} svgIndex - Index of the SVG block in the editor
 */
function startSVGEdit(container, svgIndex) {
    console.log('[startSVGEdit] Called with svgIndex:', svgIndex);

    const isSameSvg = window.currentEditingSVG && window.currentEditingSVG.svgIndex === svgIndex;
    const isSameContainer = isSameSvg && window.currentEditingSVG.container === container;
    const isStillValid = isSameContainer && document.body.contains(container);

    if (isStillValid && window.currentEditingSVG.draw) {
        console.log('[startSVGEdit] Already editing this SVG in current container. Skipping.');
        return;
    }

    const isReconnecting = isSameSvg && window.currentEditingSVG.draw;

    if (window.currentEditingSVG && !isReconnecting) {
        console.log('[startSVGEdit] Closing existing SVG editor first');
        // Disable render during stop to avoid race condition before we start again
        stopSVGEdit(true);
    }

    // [FIX] 再接続時は既存のメモリ状態を保持する
    const current = (isReconnecting) ? window.currentEditingSVG : {
        container,
        svgIndex,
        selectedElements: new Set(),
        draw: null
    };
    current.container = container; // コンテナのみ最新のもの（DOM）に更新
    window.currentEditingSVG = current;

    container.classList.add('svg-editing');
    container.style.userSelect = 'none';

    // [NEW] Hide overlay buttons (Language, Copy, Edit)
    const wrapper = container.closest('.code-block-wrapper');
    if (wrapper) {
        const buttons = wrapper.querySelectorAll('button, .language-label');
        buttons.forEach(b => {
            // Store original display state if not already stored
            if (!b.hasAttribute('data-original-display')) {
                b.setAttribute('data-original-display', b.style.display || '');
            }
            b.style.display = 'none';
        });
    }

    // Document Listeners (interaction.js)
    // if (typeof exitEditOnClickOutside === 'function') document.addEventListener('click', exitEditOnClickOutside);
    if (typeof svgEscapeHandler === 'function') document.addEventListener('keydown', svgEscapeHandler);
    if (typeof svgDeleteKeyHandler === 'function') document.addEventListener('keydown', svgDeleteKeyHandler);

    // [NEW] Shift/Alt/Ctrl Key Monitoring for Constraint
    const keyMonitor = (e) => {
        if (window.currentEditingSVG) {
            window.currentEditingSVG.isShiftPressed = e.shiftKey;
            window.currentEditingSVG.isAltPressed = e.altKey;
            window.currentEditingSVG.isCtrlPressed = e.ctrlKey;

            // [NEW] Space Key Monitoring for Pan
            if (e.code === 'Space') {
                const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || (window.currentEditingSVG && window.currentEditingSVG.isInlineEditing);
                if (!isInput) {
                    window.currentEditingSVG.isSpacePressed = (e.type === 'keydown');
                    if (window.currentEditingSVG.isSpacePressed) {
                        container.style.cursor = 'grab';
                        // Prevent scroll on SPACE
                        if (e.target === document.body || container.contains(e.target)) {
                            e.preventDefault();
                        }
                    } else {
                        container.style.cursor = '';
                    }
                }
            }
        }
    };
    document.addEventListener('keydown', keyMonitor);
    document.addEventListener('keyup', keyMonitor);
    current.keyMonitor = keyMonitor;

    // Drop Handler (Now handled globally in editor_io.js or app.js)

    container.addEventListener('contextmenu', (e) => handleContextMenu(e, container, svgIndex));

    const svgElement = container.querySelector('svg');
    if (!svgElement) return;

    // [NEW] 編集開始時 data-paper-* 属性の正規化
    // data-paper-width がない場合は外部SVG または旧バージョンのSVGと判断し、
    // normalizeSVGTagForPreviewWidth を使って viewBox / data-paper-* を補完する。
    // DOM とMarkdownソースの両方に反映させる（サイレント同期）。
    if (!svgElement.getAttribute('data-paper-width') && typeof normalizeSVGTagForPreviewWidth === 'function') {
        const configWidth = (typeof AppState !== 'undefined' && AppState.config && AppState.config.previewWidth)
            ? AppState.config.previewWidth : 820;
        // DOM側HTMLの1行目を生成してnormalizerに渡す（タグのみを含む文字列を作成）
        const outerStr = svgElement.outerHTML.split('\n')[0]; // <svg ...> の最初の行
        const result = normalizeSVGTagForPreviewWidth(outerStr, configWidth);
        if (result.changed) {
            // 変更された属性をDOM要素に直接適用
            const parser = new DOMParser();
            const parsed = parser.parseFromString(result.line.trim(), 'image/svg+xml');
            const parsedSvg = parsed.querySelector('svg');
            if (parsedSvg) {
                const attrsToSync = [
                    'width', 'height', 'viewBox',
                    'data-paper-width', 'data-paper-height',
                    'data-paper-x', 'data-paper-y',
                    'data-paper-zoom', 'data-paper-offx', 'data-paper-offy'
                ];
                attrsToSync.forEach(attr => {
                    const val = parsedSvg.getAttribute(attr);
                    if (val !== null) svgElement.setAttribute(attr, val);
                });
                console.log('[startSVGEdit] Normalized external SVG attributes (data-paper-*補完完了)');

                // Markdownソースにもサイレント同期（編集完了時に確定するため遅延実行）
                setTimeout(() => {
                    if (typeof syncChanges === 'function' && window.currentEditingSVG) {
                        syncChanges(true);
                    }
                }, 200);
            }
        }
    }

    // [FIX] Clear stale instances AND internal tool elements (hitArea) to ensure clean state
    const clearInstances = (el) => {
        if (el.instance) {
            // [NEW] Physically remove listeners from DOM node before discarding instance
            if (typeof el.instance.off === 'function') el.instance.off();
            el.instance = null;
        }

        // [NEW] Remove leaked hitArea elements from previous crashed/leaked sessions
        if (el.classList && el.classList.contains('svg-interaction-hitarea')) {
            el.remove();
            return;
        }

        // Use standard loop for child removal/traversal safety
        const children = Array.from(el.children);
        for (let child of children) {
            clearInstances(child);
        }
    };
    clearInstances(svgElement);

    // Adopt SVG using SVG.js
    const draw = SVG(svgElement);
    draw.addClass('svg-editable');
    current.draw = draw;

    // [NEW] Zoom & Pan Default State
    current.zoom = 100;
    current.offX = 0;
    current.offY = 0;
    current.isPanning = false;
    current.panStartX = 0;
    current.panStartY = 0;
    current.isSpacePressed = false;
    current.guidesGroup = null; // [NEW] Reset guides on fresh start/re-render

    // [NEW] Get Base dimensions from paper attributes (RESTORE STATE)
    const savedPaperW = parseFloat(svgElement.getAttribute('data-paper-width'));
    const savedPaperH = parseFloat(svgElement.getAttribute('data-paper-height'));
    const savedPaperX = parseFloat(svgElement.getAttribute('data-paper-x'));
    const savedPaperY = parseFloat(svgElement.getAttribute('data-paper-y'));

    if (!isNaN(savedPaperW)) {
        console.log(`[startSVGEdit] Attribute Trace - width: ${svgElement.getAttribute('width')}, height: ${svgElement.getAttribute('height')}, data: ${savedPaperW}x${savedPaperH}`);
    }

    const vbAttr = svgElement.getAttribute('viewBox');
    const vbBase = svgElement.viewBox.baseVal;
    console.log(`[startSVGEdit] Initial viewBox ATTR: "${vbAttr}"`);
    console.log(`[startSVGEdit] Initial viewBox baseVal: ${vbBase.x} ${vbBase.y} ${vbBase.width} ${vbBase.height}`);

    // [FIX] 再接続時はメモリ上の現在値を最優先し、データのダウングレード（450への戻り）を防ぐ
    const prevW = current.baseWidth;
    const prevH = current.baseHeight;
    const prevX = current.baseX;
    const prevY = current.baseY;

    // [MOD] 優先順位: 1. メモリに有効な値があり、DOMがデフォルト(350/450)に戻っている場合はメモリを維持
    //               2. さもなくば属性(savedPaper*)
    //               3. さもなくばDOMの基本寸法
    const domW = !isNaN(savedPaperW) ? savedPaperW : (vbBase.width || parseFloat(svgElement.getAttribute('width')) || 820);
    const domH = !isNaN(savedPaperH) ? savedPaperH : (vbBase.height || parseFloat(svgElement.getAttribute('height')) || 450);
    const isDomDefault = (Math.abs(domH - 450) < 1 || Math.abs(domH - 350) < 1);

    if (prevH && !isNaN(prevH) && isDomDefault && Math.abs(domH - prevH) > 10) {
        // [Safety] Favor memory when DOM seems reset to default
        current.baseWidth = prevW;
        current.baseHeight = prevH;
        current.baseX = prevX;
        current.baseY = prevY;
        console.log(`[startSVGEdit] Favoring Memory over suspicious DOM default (${domH}px -> ${prevH}px)`);
    } else {
        current.baseWidth = domW;
        current.baseHeight = domH;
        current.baseX = !isNaN(savedPaperX) ? savedPaperX : (prevX || vbBase.x || 0);
        current.baseY = !isNaN(savedPaperY) ? savedPaperY : (prevY || vbBase.y || 0);
    }

    // [NEW] キャンバス高さを正解の基準値として記録（ライブラリによる副作用リセットの検知・修復用）
    current.standardHeight = current.baseHeight;

    console.log(`[startSVGEdit] Resolved Base size: ${current.baseWidth}x${current.baseHeight}`);

    // [NEW] ズーム率とオフセットを復元
    const storedZoom = parseFloat(svgElement.getAttribute('data-paper-zoom'));
    const storedOffX = parseFloat(svgElement.getAttribute('data-paper-offx'));
    const storedOffY = parseFloat(svgElement.getAttribute('data-paper-offy'));

    if (!isNaN(storedZoom)) {
        // [MOD] 専用データ属性 (data-paper-zoom等) が存在する場合は最優先で復元 (viewBoxリセット対策)
        current.zoom = storedZoom;
        current.offX = !isNaN(storedOffX) ? storedOffX : 0;
        current.offY = !isNaN(storedOffY) ? storedOffY : 0;
        console.log(`[startSVGEdit] Restored View State via DATA-ATTR- Zoom: ${current.zoom}%, Offset: (${current.offX}, ${current.offY})`);
    } else if (!isNaN(savedPaperW) && vbBase.width > 0) {
        // [FALLBACK] 属性がない場合は従来通り viewBox から逆算
        const calculatedZoom = Math.round((current.baseWidth / vbBase.width) * 100);
        current.zoom = calculatedZoom;
        current.offX = vbBase.x - current.baseX;
        current.offY = vbBase.y - current.baseY;
        console.log(`[startSVGEdit] Restored View State via VIEWBOX- Zoom: ${current.zoom}% (calc: ${calculatedZoom}), Offset: (${current.offX}, ${current.offY})`);
    } else {
        console.log(`[startSVGEdit] No restoration attributes found. Defaulting to 100% zoom.`);
    }

    // [NEW] グリッド設定を復元
    const storedGridSize = parseInt(svgElement.getAttribute('data-paper-grid-size'));
    const storedGridMajor = parseInt(svgElement.getAttribute('data-paper-grid-major'));
    if (!isNaN(storedGridSize)) {
        console.log(`[startSVGEdit] Restoring grid size: ${storedGridSize}`);
        AppState.config.grid.size = storedGridSize;
    }
    if (!isNaN(storedGridMajor)) {
        console.log(`[startSVGEdit] Restoring grid major interval: ${storedGridMajor}`);
        AppState.config.grid.majorInterval = storedGridMajor;
    }

    /**
     * Apply Zoom and Pan to ViewBox
     */
    current.applyZoomPan = function () {
        // [NEW] CSS変数として拡大率を保持（ハンドルサイズ補正用）
        if (this.container) {
            this.container.classList.add('svg-editor-container');
            this.container.style.setProperty('--svg-zoom', this.zoom);
        }

        const svg = this.draw.node;
        const scale = 100 / this.zoom;
        const w = this.baseWidth * scale;
        const h = this.baseHeight * scale;

        // offsetはズーム後の座標系での相対移動量として扱う
        const vx = this.baseX + this.offX;
        const vy = this.baseY + this.offY;

        svg.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);

        // グリッドを更新
        if (typeof updateGrid === 'function') updateGrid(this.draw);

        // ツールバーの表示を更新
        if (this.gridToolbar && typeof this.gridToolbar.updateZoomDisplay === 'function') {
            this.gridToolbar.updateZoomDisplay(this.zoom);
        }

        // [NEW] ズーム変更イベントを発火（ハンドルサイズの調整用）
        this.draw.fire('zoomchange', { zoom: this.zoom });

        // [NEW] リアルタイム同期（デバウンス処理）
        clearTimeout(this._zoomPanSyncTimer);
        this._zoomPanSyncTimer = setTimeout(() => {
            if (typeof syncChanges === 'function' && window.currentEditingSVG === this) {
                syncChanges(true); // silent=true で同期
            }
        }, 500); // 500msのデバウンス
        // ルーラーを更新
        if (typeof updateRulers === 'function') updateRulers(this.draw);
    };

    // [NEW] setZoom method for current object
    current.setZoom = function (value) {
        this.zoom = Math.max(1, Math.min(6400, value)); // Limit: 1% to 6400%
        this.applyZoomPan();
    };

    /**
     * Show smart snap guides
     * @param {Array} guidesV Vertical guide X coordinates
     * @param {Array} guidesH Horizontal guide Y coordinates
     */
    current.showGuides = function (guidesV, guidesH) {
        // [FIX] Check if guidesGroup exists and is still part of the current draw's DOM. 
        // UNDO can replace the underlying SVG node, orphaning existing groups.
        if (!this.guidesGroup || !this.guidesGroup.node.parentNode || this.guidesGroup.node.ownerSVGElement !== this.draw.node) {
            this.guidesGroup = this.draw.group().attr({
                'class': 'svg-snap-guides',
                'data-internal': 'true'
            }).front();
            this.guidesGroup.node.style.pointerEvents = 'none';
        }
        this.guidesGroup.clear();

        const vb = this.draw.node.viewBox.baseVal;
        const color = '#ff4444';
        const dash = '4,4';
        const width = 1 / (this.zoom / 100);

        if (guidesV && guidesV.length > 0) {
            for (const x of guidesV) {
                this.guidesGroup.line(x, vb.y, x, vb.y + vb.height)
                    .stroke({ color: color, width: width, dasharray: dash });
            }
        }
        if (guidesH && guidesH.length > 0) {
            for (const y of guidesH) {
                this.guidesGroup.line(vb.x, y, vb.x + vb.width, y)
                    .stroke({ color: color, width: width, dasharray: dash });
            }
        }
        this.guidesGroup.front();
    };

    /**
     * Hide all smart snap guides
     */
    current.hideGuides = function () {
        if (this.guidesGroup) {
            this.guidesGroup.clear();
        }
    };


    const getPos = (idx) => ({ top: (20 + idx * 30) + 'px', left: '-37px' });

    // Initialize Toolbar
    if (typeof SVGToolbar !== 'undefined') {
        SVGToolbar.init(container, draw);
    }

    // Initialize Custom Toolbar
    if (typeof createCustomToolbar !== 'undefined') {
        window.customToolbar = createCustomToolbar(container, {
            id: 'svg-custom-toolbar',
            position: getPos(3), // (-37, 110)
            borderColor: '#0D31BB',
            onToolChange: (toolId) => {
                if (typeof SVGToolbar !== 'undefined') {
                    SVGToolbar.setTool(toolId);
                }
            }
        });
    }

    // [NEW] Initialize Arrow Toolbar
    if (typeof createArrowToolbar !== 'undefined' && typeof SVGToolbar !== 'undefined') {
        window.arrowToolbar = createArrowToolbar(container, SVGToolbar, {
            position: getPos(2), // (-37, 80)
            borderColor: '#0D31BB'
        });
    }

    // [NEW] Initialize Color Toolbar
    if (typeof createColorToolbar !== 'undefined') {
        window.colorToolbar = createColorToolbar(container, SVGToolbar, {
            position: getPos(4), // (-37, 140)
            borderColor: '#A8E74B'
        });
    }

    // [NEW] Initialize Style Toolbar
    if (typeof createStyleToolbar !== 'undefined') {
        window.styleToolbar = createStyleToolbar(container, SVGToolbar, {
            position: getPos(5), // (-37, 170)
            borderColor: '#A8E74B'
        });
    }

    // [FIX] Ensure markers are not clipped
    svgElement.style.overflow = 'visible';

    // [NEW] Create selection proxy for the canvas
    // [FIX] キャンバスのリセット位置（紙面）の座標系定義
    // すでに冒頭で restored しているため、ここでは current から取得する
    const baseWidth = current.baseWidth;
    const baseHeight = current.baseHeight;
    const baseX = current.baseX;
    const baseY = current.baseY;

    console.log(`[CanvasBorder] Using base size: ${baseWidth}x${baseHeight} at (${baseX}, ${baseY})`);
    console.log(`[CanvasBorder Debug] SVG Attributes - width:${svgElement.getAttribute('width')}, height:${svgElement.getAttribute('height')}`);
    console.log(`[CanvasBorder Debug] SVG ViewBox - x:${vbBase.x}, y:${vbBase.y}, w:${vbBase.width}, h:${vbBase.height}`);
    console.log(`[CanvasBorder Debug] Initial data-paper-y: ${svgElement.getAttribute('data-paper-y')}`);

    // [NEW] キャンバス境界枠 (青色実線)
    const canvasBorder = draw.rect(baseWidth, baseHeight)
        .move(baseX, baseY)
        .addClass('svg-canvas-border')
        .attr({
            'pointer-events': 'none',
            'stroke': '#2196F3',
            'stroke-width': 2,
            'fill': 'none'
        })
        .back();

    const inset = 4;
    const canvasProxy = draw.rect(Math.max(10, baseWidth - inset * 2), Math.max(10, baseHeight - inset * 2))
        .move(baseX + inset, baseY + inset)
        .addClass('svg-canvas-proxy')
        .attr({
            'fill': '#000',
            'fill-opacity': 0,
            'stroke': 'none',
            'pointer-events': 'all',
            'data-is-proxy': 'true',
            'data-is-canvas': 'true'
        })
        .back();

    current.canvasBorder = canvasBorder;
    current.canvasProxy = canvasProxy;
    current.canvas = canvasProxy.node; // [NEW] Added for backward compatibility/reference
    current.canvasInset = inset;

    // [NEW] Use CanvasShape for the proxy
    if (typeof CanvasShape !== 'undefined') {
        const canvasObj = new CanvasShape(canvasProxy);
        canvasObj.init();
    }

    // [NEW] Custom Rotation Handler
    // (Moved to instance per-shape inside SvgShape.js to support multiple selection markers)

    // [NEW] Radius Adjustment Handler
    // (Moved to instance per-shape inside SvgShape.js)



    // [NEW] Grid Adjustment Toolbar
    if (typeof createGridToolbar !== 'undefined') {
        current.gridToolbar = createGridToolbar(container, {
            onConfigChange: () => {
                updateGrid(draw);
            },
            position: getPos(0), // (-37, 20)
            borderColor: '#444444'
        });
    }

    // Transform Toolbar
    if (typeof createTransformToolbar !== 'undefined') {
        current.transformToolbar = createTransformToolbar(container, {
            onValueChange: (id, val) => {
                if (typeof handleTransformChange === 'function') handleTransformChange(id, val);
            },
            position: getPos(9), // (-37, 290)
            borderColor: '#59B5A8'
        });
        if (typeof updateTransformToolbarValues === 'function') updateTransformToolbarValues();
    }

    // Path Operations Toolbar (Flip, Combine, Subtract)
    if (typeof createPathOpToolbar !== 'undefined') {
        current.pathOpToolbar = createPathOpToolbar(container, {
            position: getPos(11), // (-37, 350)
            borderColor: '#59B5A8'
        });
    }

    // Align Toolbar
    if (typeof createAlignToolbar !== 'undefined') {
        current.alignToolbar = createAlignToolbar(container, draw, {
            position: getPos(10), // (-37, 320)
            borderColor: '#59B5A8'
        });
    }

    // Text Alignment Toolbar
    if (typeof createTextAlignToolbar !== 'undefined') {
        current.textAlignToolbar = window.SVGTextAlignmentToolbar = createTextAlignToolbar(container, draw, {
            position: getPos(8), // (-37, 260)
            borderColor: '#f71702'
        });
    }

    // Font Toolbar
    if (typeof createFontToolbar !== 'undefined') {
        current.fontToolbar = window.SVGFontToolbar = createFontToolbar(container, draw, {
            position: getPos(7), // (-37, 230)
            borderColor: '#f71702'
        });
    }

    // Line Toolbar
    if (typeof createLineToolbar !== 'undefined') {
        current.lineToolbar = window.SVGLineToolbar = createLineToolbar(container, draw, {
            position: getPos(6), // (-37, 200)
            borderColor: '#A8E74B'
        });
    }

    // CSS Toolbar
    if (typeof createCSSToolbar !== 'undefined') {
        window.cssToolbar = createCSSToolbar(container, {
            position: getPos(12), // (-37, 380)
            borderColor: '#E8A000'
        });
    }

    // [NEW] Listen for global transformations to update toolbar
    draw.on('dragmove.global resize.global rotate.global', () => {
        if (typeof updateTransformToolbarValues === 'function') updateTransformToolbarValues();
    });

    // [NEW] Polyline/Arrow Vertex Handler
    // (Moved to instance per-shape inside SvgShape.js to support multiple selection markers. Updates handled via SVG selection sync events.)

    // [NEW] Initialize Grid
    // updateGrid内でgridGroup.back()が呼ばれるため、以下のDOM順になる:
    //   [0] gridGroup, [...] その他の既存要素
    // そのあとcanvasProxyをgridGroupの直後に移動させて:
    //   [0] gridGroup, [1] canvasProxy, [2+] 図形
    // の順序を確立する。
    updateGrid(draw);

    // canvasProxyをgridGroupの直後（2番目）に配置する
    {
        const gridGroupNode = draw.node.querySelector('.svg-grid-lines');
        if (gridGroupNode) {
            const parent = gridGroupNode.parentNode;
            const nextSib = gridGroupNode.nextSibling;
            if (nextSib) {
                parent.insertBefore(canvasProxy.node, nextSib);
            } else {
                parent.appendChild(canvasProxy.node);
            }
        }
        // gridGroupがない場合は元の.back()の位置のまま
    }

    if (typeof showDoneButton === 'function') showDoneButton(container);

    // [NEW] Keyboard Shortcuts for Copy/Paste
    const keyboardHandler = (e) => {
        if (!window.currentEditingSVG) return;

        // Ctrl+C: Copy
        if (e.ctrlKey && e.code === 'KeyC' && !e.shiftKey && !e.altKey) {
            if (window.currentEditingSVG.selectedElements.size > 0) {
                e.preventDefault();
                if (typeof copySelectedElements === 'function') copySelectedElements();
            }
        }
        // Ctrl+V はネイティブの paste イベントで処理するため、ここではブロックしない
        // F2: Start Inline Editor
        else if (e.key === 'F2' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            const selected = Array.from(window.currentEditingSVG.selectedElements);
            if (selected.length === 1) {
                const el = selected[0];
                const instance = el.remember('_shapeInstance');
                if (instance && typeof instance.onDoubleClick === 'function') {
                    console.log(`[F2 Shortcut] Starting edit for ${el.id()}`);
                    e.preventDefault();
                    instance.onDoubleClick(e);
                }
            }
        }
        // [NEW] Arrow Keys: Nudge selected elements
        else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.ctrlKey) {
            // 入力欄にフォーカスがある場合は無視
            if (e.target && (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable)) return;

            const selectedSet = window.currentEditingSVG.selectedElements;
            if (selectedSet && selectedSet.size > 0) {
                e.preventDefault();
                const shiftMultiplier = e.shiftKey ? 10 : 1;

                let dx = 0, dy = 0;
                switch (e.key) {
                    case 'ArrowUp': dy = -1 * shiftMultiplier; break;
                    case 'ArrowDown': dy = 1 * shiftMultiplier; break;
                    case 'ArrowLeft': dx = -1 * shiftMultiplier; break;
                    case 'ArrowRight': dx = 1 * shiftMultiplier; break;
                }

                let moved = false;
                selectedSet.forEach(el => {
                    if (el.attr('data-locked') === 'true') return;

                    // [GUARD] キャンバスプロキシ自体の移動は直接扱わず、プロパティツールバーの更新と同様に機能させるか検討。キャンバスサイズ自体の移動は除外
                    if (el.hasClass('svg-canvas-proxy')) return;

                    el.dmove(dx, dy);
                    moved = true;

                    // Sync tspan coordinates if absolute
                    if (el.type === 'text' || el.find('text').length > 0) {
                        const textEls = el.type === 'text' ? [el] : el.find('text');
                        textEls.forEach(textEl => {
                            textEl.find('tspan').forEach(tspan => {
                                if (tspan.node.hasAttribute('x')) {
                                    const valX = parseFloat(tspan.attr('x'));
                                    if (!isNaN(valX)) tspan.attr('x', valX + dx);
                                }
                                if (tspan.node.hasAttribute('y')) {
                                    const valY = parseFloat(tspan.attr('y'));
                                    if (!isNaN(valY)) tspan.attr('y', valY + dy);
                                }
                            });
                        });
                    }

                    // Sync metadata for paths/lines
                    if (window.SVGUtils && window.SVGUtils.offsetPathMetadata) {
                        window.SVGUtils.offsetPathMetadata(el, dx, dy);
                    }

                    // Update connection markers
                    if (window.SVGConnectorManager && typeof window.SVGConnectorManager.updateConnectionsFromElement === 'function') {
                        window.SVGConnectorManager.updateConnectionsFromElement(el);
                    }

                    const shape = el.remember('_shapeInstance');
                    if (shape) {
                        if (typeof shape.updateMarkers === 'function') shape.updateMarkers();
                        if (typeof shape.syncSelectionHandlers === 'function') shape.syncSelectionHandlers();
                        if (typeof shape.applySelectionUI === 'function') shape.applySelectionUI();
                    }
                });

                if (moved) {
                    if (typeof syncChanges === 'function') syncChanges(false);
                    if (typeof updateTransformToolbarValues === 'function') updateTransformToolbarValues();
                    if (typeof updateSVGSourceHighlight === 'function') updateSVGSourceHighlight();
                }
            }
        }
    };

    document.addEventListener('keydown', keyboardHandler);
    current.keyboardHandler = keyboardHandler;

    // [NEW] Native Paste Event Handler (Bypasses navigator.clipboard prompt)
    const pasteHandler = (e) => {
        if (!window.currentEditingSVG) return;

        const active = document.activeElement;
        // SVGエディタ内の入力欄にフォーカスがある場合はネイティブペーストに任せる
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            const isInsideSVGEditor = active.closest('.svg-editor-container, .svg-inline-editor, .svg-toolbar');
            if (isInsideSVGEditor) return;
        }

        const text = e.clipboardData ? e.clipboardData.getData('text/plain') : null;

        // 内部クリップボード（図形）がある、またはテキストがある場合のみイベントを横取りする
        if ((window.SVGClipboard && window.SVGClipboard.elements && window.SVGClipboard.elements.length > 0) || text) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof pasteElements === 'function') {
                pasteElements(container, text);
            }
        }
    };
    document.addEventListener('paste', pasteHandler, { capture: true });
    current.pasteHandler = pasteHandler;

    // [NEW] Zoom & Pan Event Listeners
    container.addEventListener('wheel', (e) => {
        if (!window.currentEditingSVG) return;
        const current = window.currentEditingSVG;

        if (e.ctrlKey) {
            // Zoom In/Out
            e.preventDefault();
            const delta = -e.deltaY;
            const factor = delta > 0 ? 1.1 : 0.9;
            const oldZoom = current.zoom;
            let newZoom = oldZoom * factor;

            // Limit: 1% to 6400%
            newZoom = Math.max(1, Math.min(6400, newZoom));

            if (newZoom !== oldZoom) {
                // マウス位置を中心にズームするためのオフセット計算
                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const vb = draw.node.viewBox.baseVal;
                const worldX = vb.x + (mouseX / rect.width) * vb.width;
                const worldY = vb.y + (mouseY / rect.height) * vb.height;

                current.zoom = newZoom;
                const newScale = 100 / newZoom;
                const newW = current.baseWidth * newScale;
                const newH = current.baseHeight * newScale;

                // 新しい viewBox の左上を計算して offset を更新
                current.offX = worldX - (mouseX / rect.width) * newW - current.baseX;
                current.offY = worldY - (mouseY / rect.height) * newH - current.baseY;

                current.applyZoomPan();
            }
        } else if (e.shiftKey) {
            // Horizontal Scroll
            e.preventDefault();
            const vb = draw.node.viewBox.baseVal;
            const moveAmount = (e.deltaY || e.deltaX) * (vb.width / container.clientWidth);
            current.offX += moveAmount;
            current.applyZoomPan();
        } else {
            // Vertical Scroll
            e.preventDefault();
            const vb = draw.node.viewBox.baseVal;
            const moveAmount = e.deltaY * (vb.height / container.clientHeight);
            current.offY += moveAmount;
            current.applyZoomPan();
        }
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
        if (!window.currentEditingSVG) return;
        const current = window.currentEditingSVG;

        if (current.isSpacePressed || e.button === 1) { // Space + Drag or Middle Click
            current.isPanning = true;
            current.panStartX = e.clientX;
            current.panStartY = e.clientY;
            container.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    const onPanningMove = (e) => {
        if (!window.currentEditingSVG || !window.currentEditingSVG.isPanning) return;
        const current = window.currentEditingSVG;

        const dx = e.clientX - current.panStartX;
        const dy = e.clientY - current.panStartY;

        const vb = current.draw.node.viewBox.baseVal;
        const moveX = dx * (vb.width / container.clientWidth);
        const moveY = dy * (vb.height / container.clientHeight);

        current.offX -= moveX;
        current.offY -= moveY;

        current.panStartX = e.clientX;
        current.panStartY = e.clientY;

        current.applyZoomPan();
    };
    container._panningBound = onPanningMove;
    window.addEventListener('mousemove', onPanningMove);

    window.addEventListener('mouseup', () => {
        if (window.currentEditingSVG && window.currentEditingSVG.isPanning) {
            window.currentEditingSVG.isPanning = false;
            container.style.cursor = window.currentEditingSVG.isSpacePressed ? 'grab' : '';
        }
    });

    // Background Click -> Select Canvas Proxy
    draw.on('mousedown', (e) => {
        if (window.currentEditingSVG && (window.currentEditingSVG.isSpacePressed || window.currentEditingSVG.isPanning)) return;
        if (typeof SVGToolbar !== 'undefined' && SVGToolbar.currentTool !== 'select') return;

        const target = e.target;
        if (target === svgElement || target === draw.node || target === canvasProxy.node) {
            if (typeof selectElement === 'function') selectElement(canvasProxy);
        }
    });

    // Initialize Interactive Elements
    const initElement = (el) => {
        const tagName = el.node.tagName.toLowerCase();
        if (['defs', 'style', 'marker', 'symbol', 'metadata'].includes(tagName)) return;
        if (el.hasClass('svg-canvas-proxy') || el.hasClass('svg-grid-line') || el.hasClass('svg-grid-lines') || el.hasClass('svg-ruler') || el.attr('data-internal') === 'true') return;

        if (el.hasClass('svg_select_shape') || el.hasClass('svg_select_handle') || el.hasClass('svg_select_group') || el.hasClass('svg-select-group') ||
            el.parent().hasClass('svg_select_handle_rot') || el.hasClass('rotation-handle-group') || el.hasClass('radius-handle-group')) return;

        // [NEW] 独自要素 (connector-data) から接続情報を復元
        if (tagName === 'polyline') {
            const connectors = el.node.querySelectorAll('connector-data');
            if (connectors.length > 0) {
                const connectData = Array.from(connectors).map(c => ({
                    endType: c.getAttribute('end'),
                    targetId: c.getAttribute('target'),
                    pointIndex: parseInt(c.getAttribute('index'))
                }));
                el.attr('data-connections', JSON.stringify(connectData));
            }
        }

        if (typeof makeInteractive === 'function') makeInteractive(el);

        // [FIX] 再帰的に子要素を処理 (グループ内の図形にもホバー/選択イベントを適用するため)
        if (tagName === 'g' && typeof el.children === 'function') {
            el.children().each(function (child) {
                initElement(child);
            });
        }
    };

    draw.children().each(function (el) {
        initElement(el);
    });

    // Restore selection if pending
    if (typeof sessionStorage !== 'undefined') {
        const pendingSelection = sessionStorage.getItem('mdEditor_pendingSelectionIndices');
        if (pendingSelection) {
            sessionStorage.removeItem('mdEditor_pendingSelectionIndices');
            try {
                const indices = JSON.parse(pendingSelection);
                const validItems = [];
                const allItems = draw.children();
                allItems.each(function (el) {
                    const tagName = el.node.tagName.toLowerCase();
                    if (['defs', 'style', 'marker', 'symbol', 'metadata'].includes(tagName)) return;
                    const isTool = el.classes().some(c => c.startsWith('svg_select')) ||
                        el.parent().classes().some(c => c.startsWith('svg_select')) ||
                        el.hasClass('svg-canvas-proxy');
                    if (!isTool) {
                        validItems.push(el);
                    }
                });

                indices.forEach(idx => {
                    if (idx >= 0 && idx < validItems.length) {
                        if (typeof selectElement === 'function') selectElement(validItems[idx], true);
                    }
                });
            } catch (e) { console.error('Failed to restore selection', e); }
        }
    }

    // [NEW] Initialize Zoom and CSS Variables (RESTORED STATE)
    current.setZoom(current.zoom || 100);
}
window.startSVGEdit = startSVGEdit;

/**
 * Stop SVG Editing Mode
 * @param {boolean} skipRender - If true, skip the final render() call
 */
function stopSVGEdit(skipRender = false) {
    if (!window.currentEditingSVG) return;

    if (window.currentEditingSVG.expandedViewData && typeof closeSVGExpandedView === 'function') {
        closeSVGExpandedView();
    }

    if (window.SvgTextEditor && window.SvgTextEditor.activeEditor) {
        window.SvgTextEditor.cancelAndClose();
    }

    const { container, draw, canvasProxy } = window.currentEditingSVG;

    if (draw) {
        draw.off();
        draw.node.style.overflow = '';
    }

    // (Handler cleanup is now managed per instance via shape.clearSelectionUI())
    if (window.currentEditingSVG.gridToolbar) window.currentEditingSVG.gridToolbar.destroy();
    if (window.currentEditingSVG.transformToolbar) window.currentEditingSVG.transformToolbar.destroy();
    if (window.currentEditingSVG.pathOpToolbar) window.currentEditingSVG.pathOpToolbar.destroy();
    if (window.arrowToolbar) window.arrowToolbar.destroy();
    if (window.styleToolbar) window.styleToolbar.destroy();
    if (window.currentEditingSVG.alignToolbar) window.currentEditingSVG.alignToolbar.destroy();
    if (window.currentEditingSVG.textAlignToolbar) window.currentEditingSVG.textAlignToolbar.destroy();
    if (window.currentEditingSVG.fontToolbar) window.currentEditingSVG.fontToolbar.destroy();
    if (window.currentEditingSVG.lineToolbar) window.currentEditingSVG.lineToolbar.destroy();
    if (window.cssToolbar) window.cssToolbar.destroy();

    // [NEW] Remove grid lines before sync/cleanup
    if (draw) {
        draw.find('.svg-grid-lines').remove();
        draw.find('.svg-grid-line').remove();
        draw.find('.svg-grid-pattern').remove();
        draw.find('.svg-grid-rect').remove();
    }

    // Deselect everything quietly
    try {
        window.currentEditingSVG.selectedElements.forEach(el => {
            const shape = el.remember('_shapeInstance');
            if (shape) {
                if (shape.bakeTransformation) shape.bakeTransformation();
                if (typeof shape.clearSelectionUI === 'function') shape.clearSelectionUI();
                if (typeof shape.clearControlMarkers === 'function') shape.clearControlMarkers();
            }

            if (typeof el.select === 'function') el.select(false);
            if (typeof el.resize === 'function') el.resize(false);
            el.off('.selection');
        });

        // [SYNC] Final sync to editor source BEFORE clearing state
        if (typeof syncChanges === 'function') syncChanges(false);

        window.currentEditingSVG.selectedElements.clear();
    } catch (e) {
    }

    if (draw) {
        if (window.currentEditingSVG && window.currentEditingSVG.guidesGroup) {
            window.currentEditingSVG.guidesGroup.remove();
        }
        draw.find('.svg-interaction-hitarea').remove();

        draw.find('*').each(function () {
            try {
                if (typeof this.draggable === 'function') this.draggable(false);
                if (typeof this.select === 'function') this.select(false);
                if (typeof this.resize === 'function') this.resize(false);
                this.off();
            } catch (e) { }
        });
    }

    try {
        if (typeof SVGToolbar !== 'undefined') {
            SVGToolbar.destroy();
        }
        const strayToolbar = container.querySelector('.svg-toolbar');
        if (strayToolbar) strayToolbar.remove();
    } catch (e) {
        console.error('Error destroying toolbar:', e);
    }

    try {
        if (window.customToolbar && typeof window.customToolbar.destroy === 'function') {
            window.customToolbar.destroy();
            window.customToolbar = null;
        }
        const strayCustomToolbar = container.querySelector('.svg-custom-toolbar');
        if (strayCustomToolbar) strayCustomToolbar.remove();
    } catch (e) {
        console.error('Error destroying custom toolbar:', e);
    }

    container.classList.remove('svg-editing');
    container.style.userSelect = '';

    // [NEW] Remove 'svg-editable' class to reset z-index and pointer-events
    if (draw) {
        draw.removeClass('svg-editable');
    }

    // [NEW] Restore overlay buttons
    const wrapper = container.closest('.code-block-wrapper');
    if (wrapper) {
        const buttons = wrapper.querySelectorAll('button, .language-label');
        buttons.forEach(b => {
            if (b.hasAttribute('data-original-display')) {
                b.style.display = b.getAttribute('data-original-display');
                b.removeAttribute('data-original-display');
            } else {
                b.style.display = '';
            }
        });
    }

    if (typeof hideDoneButton === 'function') hideDoneButton();

    // if (typeof exitEditOnClickOutside === 'function') document.removeEventListener('click', exitEditOnClickOutside);
    if (typeof svgEscapeHandler === 'function') document.removeEventListener('keydown', svgEscapeHandler);
    if (typeof svgDeleteKeyHandler === 'function') document.removeEventListener('keydown', svgDeleteKeyHandler);

    if (window.currentEditingSVG.keyMonitor) {
        document.removeEventListener('keydown', window.currentEditingSVG.keyMonitor);
        document.removeEventListener('keyup', window.currentEditingSVG.keyMonitor);
    }

    if (window.currentEditingSVG.keyboardHandler) {
        document.removeEventListener('keydown', window.currentEditingSVG.keyboardHandler);
    }

    if (window.currentEditingSVG.pasteHandler) {
        document.removeEventListener('paste', window.currentEditingSVG.pasteHandler, { capture: true });
    }

    // Removed drop event cleanup

    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('mdEditor_pendingSVGEditIndex');
        sessionStorage.removeItem('mdEditor_pendingSelectionIndices');
    }

    // Cleanup removed to avoid duplication

    window.currentEditingSVG = null;

    // [NEW] Global events cleanup
    if (container._panningBound) {
        window.removeEventListener('mousemove', container._panningBound);
        delete container._panningBound;
    }

    if (!skipRender && typeof render === 'function') {
        render();
    }

    // [NEW] 完了時にプレビュー側のスクロール位置に合わせてエディタを同期する
    setTimeout(() => {
        if (typeof syncEditorFromPreview === 'function') {
            syncEditorFromPreview();
        }
    }, 150);
}
window.stopSVGEdit = stopSVGEdit;

function importSVGContent(svgString, dropPoint = null) {
    if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;

    console.log('[SVG Import] Starting import. Content preview:', svgString.substring(0, 100) + '...');

    const draw = window.currentEditingSVG.draw;

    try {
        // [NEW] SVGタグをGタグに変換し、グループを最適化する
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgRoot = doc.querySelector('svg');

        if (!svgRoot) {
            console.warn('[SVG Import] No SVG root found in string.');
            return;
        }

        // SVGとしての情報を保持しつつ、中身を抽出
        let contentToImport;
        const children = Array.from(svgRoot.childNodes);

        // [NEW] すでに単一のGタグで囲まれているかチェック
        const firstLevelElements = children.filter(node => node.nodeType === 1); // Element nodes
        if (firstLevelElements.length === 1 && firstLevelElements[0].tagName.toLowerCase() === 'g') {
            // 単一のGタグなので、その中身をさらに吸い出すか、そのまま使うか
            // 今回は「gタグが2つ続けて指定される場合は1つだけに」という要件なので、
            // svg -> g に置換した結果、g -> g になるのを防ぐため、中身を直接使う
            contentToImport = firstLevelElements[0].innerHTML;
        } else {
            contentToImport = svgRoot.innerHTML;
        }

        // 一時的なグループを作成してインポート
        const importGroup = draw.group();
        importGroup.svg(contentToImport);

        // [NEW] リサイズロジック (最大辺を100pxにする)
        const bbox = importGroup.bbox();
        const maxDim = Math.max(bbox.w, bbox.h);
        const targetSize = 100;

        if (maxDim > 0) {
            const scale = targetSize / maxDim;
            importGroup.scale(scale);
        }

        // [NEW] 配置座標の調整 (ドロップ位置、またはキャンバス中心)
        if (dropPoint) {
            // 要素の中心が dropPoint に来るように移動
            const newBbox = importGroup.bbox();
            const dx = dropPoint.x - (newBbox.x + newBbox.w / 2);
            const dy = dropPoint.y - (newBbox.y + newBbox.h / 2);
            importGroup.translate(dx, dy);
        }

        // グループの中身を個別にインタラクティブ化して選択（要件の「gタグ置換」を実質的に反映）
        // importGroup自体をインタラクティブな一つの要素として扱うのが最適
        if (typeof makeInteractive === 'function') makeInteractive(importGroup);
        if (typeof selectElement === 'function') selectElement(importGroup);

        if (typeof syncChanges === 'function') syncChanges();
        console.log('[SVG Import] Import complete. Synced changes to editor.');

    } catch (err) {
        console.error('[SVG Import] Error during processing:', err);
    }
}
window.importSVGContent = importSVGContent;

/**
 * [NEW] 非SVG画像をBase64としてインポート
 */
function importImageAsBase64(dataUrl, dropPoint = null) {
    if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;

    console.log('[Image Import] Starting import.');
    const draw = window.currentEditingSVG.draw;

    try {
        // 画像要素を作成
        const img = draw.image(dataUrl);

        // 画像の読み込み完了を待ってからサイズ調整と配置を行う
        img.on('load', function () {
            const bbox = img.bbox();
            const maxDim = Math.max(bbox.w, bbox.h);
            const targetSize = 100;

            if (maxDim > 0) {
                const scale = targetSize / maxDim;
                img.size(bbox.w * scale, bbox.h * scale);
            }

            if (dropPoint) {
                const newBbox = img.bbox();
                img.move(dropPoint.x - newBbox.w / 2, dropPoint.y - newBbox.h / 2);
            }

            if (typeof makeInteractive === 'function') makeInteractive(img);
            if (typeof selectElement === 'function') selectElement(img);

            if (typeof syncChanges === 'function') syncChanges();
            console.log('[Image Import] Import complete.');
        });

    } catch (err) {
        console.error('[Image Import] Error during processing:', err);
    }
}
window.importImageAsBase64 = importImageAsBase64;

// --- Context Menu ---

function handleContextMenu(e, container, svgIndex) {
    console.log('[Context Menu] handleContextMenu called', {
        hasEditingSVG: !!window.currentEditingSVG,
        container: container,
        svgIndex: svgIndex
    });

    if (!window.currentEditingSVG) {
        console.warn('[Context Menu] No window.currentEditingSVG found');
        return;
    }

    const actions = {
        resetLayout: () => {
            // [SYNC] 各ツールバーの resetPosition を設計書通りの固定座標にリセット
            if (typeof SVGToolbar !== 'undefined' && typeof SVGToolbar.resetPosition === 'function') {
                SVGToolbar.resetPosition();
            }
            if (window.customToolbar && typeof window.customToolbar.resetPosition === 'function') {
                window.customToolbar.resetPosition();
            }
            if (window.arrowToolbar && typeof window.arrowToolbar.resetPosition === 'function') {
                window.arrowToolbar.resetPosition();
            }
            if (window.currentEditingSVG.gridToolbar && typeof window.currentEditingSVG.gridToolbar.resetPosition === 'function') {
                window.currentEditingSVG.gridToolbar.resetPosition();
            }
            if (window.currentEditingSVG.transformToolbar && typeof window.currentEditingSVG.transformToolbar.resetPosition === 'function') {
                window.currentEditingSVG.transformToolbar.resetPosition();
            }
            if (window.currentEditingSVG.alignToolbar && typeof window.currentEditingSVG.alignToolbar.resetPosition === 'function') {
                window.currentEditingSVG.alignToolbar.resetPosition();
            }
            if (window.styleToolbar && typeof window.styleToolbar.resetPosition === 'function') {
                window.styleToolbar.resetPosition();
            }
            if (window.currentEditingSVG.textAlignToolbar && typeof window.currentEditingSVG.textAlignToolbar.resetPosition === 'function') {
                window.currentEditingSVG.textAlignToolbar.resetPosition();
            }
            if (window.currentEditingSVG.fontToolbar && typeof window.currentEditingSVG.fontToolbar.resetPosition === 'function') {
                window.currentEditingSVG.fontToolbar.resetPosition();
            }
            if (window.currentEditingSVG.lineToolbar && typeof window.currentEditingSVG.lineToolbar.resetPosition === 'function') {
                window.currentEditingSVG.lineToolbar.resetPosition();
            }
            if (window.currentEditingSVG.pathOpToolbar && typeof window.currentEditingSVG.pathOpToolbar.resetPosition === 'function') {
                window.currentEditingSVG.pathOpToolbar.resetPosition();
            }
        },
        group: typeof groupSelectedElements === 'function' ? groupSelectedElements : null,
        ungroup: typeof ungroupSelectedElements === 'function' ? ungroupSelectedElements : null,
        bringToFront: typeof moveSelectedToFront === 'function' ? moveSelectedToFront : null,
        sendToBack: typeof moveSelectedToBack === 'function' ? moveSelectedToBack : null,
        copy: typeof copySelectedElements === 'function' ? copySelectedElements : null,
        paste: typeof pasteElements === 'function' ? pasteElements : null,
        delete: typeof deleteSelectedElements === 'function' ? deleteSelectedElements : null,
        showProperties: typeof showPropertyEditor === 'function' ? showPropertyEditor : null,
        addToToolbar: typeof addToToolbar === 'function' ? addToToolbar : null,
        hasClipboard: () => window.SVGClipboard ? window.SVGClipboard.elements.length > 0 : false
    };

    console.log('[Context Menu] Actions defined', {
        showSVGContextMenuExists: typeof showSVGContextMenu === 'function',
        actionsKeys: Object.keys(actions)
    });

    if (typeof showSVGContextMenu === 'function') {
        console.log('[Context Menu] Calling showSVGContextMenu...');
        showSVGContextMenu(e, container, svgIndex, window.currentEditingSVG, actions);
    } else {
        console.error('[Context Menu] showSVGContextMenu function not found!');
    }
}

/**
 * [NEW] Update Grid Display
 * @param {Object} draw - SVG.js draw object
 */
function updateGrid(draw) {
    if (!draw) return;

    draw.find('.svg-grid-pattern').remove();
    draw.find('.svg-grid-rect').remove();
    draw.find('.svg-grid-line').remove();

    const config = AppState.config.grid || { size: 15, showV: true, showH: true };
    if (!config.showV && !config.showH) return;

    const size = config.size || 15;
    const majorInterval = config.majorInterval || 5;
    const majorSize = size * majorInterval;

    const vb = draw.node.viewBox.baseVal;
    const w = vb.width;
    const h = vb.height;
    const x = vb.x;
    const y = vb.y;

    // [FIX] 拡大率に応じてグリッドサイズを動的に調整するか、
    // あるいは描画負荷を下げるために現在の表示範囲のみ描画する
    // ここでは現在の viewBox の範囲に合わせて描画する

    // 拡大率を取得 (baseWidthに対する比率)
    const currentZoom = window.currentEditingSVG ? window.currentEditingSVG.zoom : 100;
    const scale = 100 / currentZoom;
    const strokeWidth = Math.max(0.2, scale); // ズームしても線が太くならないように調整

    // グリッドの開始位置を計算（グリッド幅の倍数）
    const startX = Math.floor(x / size) * size;
    const startY = Math.floor(y / size) * size;
    const endX = x + w;
    const endY = y + h;

    // [OPT] 大量描画を避けるための制限 (表示範囲内に線が多すぎる場合は描画をスキップ)
    if (w / size > 200 || h / size > 200) {
        // グリッドが細かすぎる場合は主要グリッドのみにする
        // もしくは何もしない (後述の majorSize のみ描画は複雑になるためここでは描画自体を抑制)
        // return; 
    }

    // グリッドグループを作成（常に最背面に配置）
    const gridGroup = draw.group().addClass('svg-grid-lines').back().attr('data-internal', 'true');

    // 垂直線を描画
    if (config.showV) {
        for (let posX = startX; posX <= endX; posX += size) {
            const isMajor = (Math.round(posX) % majorSize === 0);
            gridGroup.line(posX, y, posX, y + h)
                .stroke({ color: isMajor ? '#ccc' : '#ddd', width: isMajor ? strokeWidth * 1.5 : strokeWidth })
                .addClass('svg-grid-line')
                .attr('pointer-events', 'none');
        }
    }

    // 水平線を描画
    if (config.showH) {
        for (let posY = startY; posY <= endY; posY += size) {
            const isMajor = (Math.round(posY) % majorSize === 0);
            gridGroup.line(x, posY, x + w, posY)
                .stroke({ color: isMajor ? '#ccc' : '#ddd', width: isMajor ? strokeWidth * 1.5 : strokeWidth })
                .addClass('svg-grid-line')
                .attr('pointer-events', 'none');
        }
    }
}
window.updateGrid = updateGrid;

/**
 * [NEW] Update Rulers Display
 * @param {Object} draw - SVG.js draw object
 */
function updateRulers(draw) {
    if (!draw) return;

    // 既存のルーラーを削除
    draw.find('.svg-ruler').remove();

    // 設定を確認
    if (!AppState.config || !AppState.config.showRuler) return;

    const vb = draw.node.viewBox.baseVal;
    const zoom = window.currentEditingSVG ? window.currentEditingSVG.zoom : 100;
    const scale = 100 / zoom;

    const x = vb.x;
    const y = vb.y;
    const w = vb.width;
    const h = vb.height;

    // ルーラーグループ（常に最前面）
    const rulerGroup = draw.group().addClass('svg-ruler').front().attr('data-internal', 'true');
    rulerGroup.node.style.pointerEvents = 'none';

    // ルーラースタイル
    const tickColor = '#999';
    const labelColor = '#666';
    const fontSize = 10 * scale;
    const strokeWidth = 1 * scale;

    // 目盛りの間隔設定（ズームに応じて動的に変更）
    const idealMinorTarget = Math.max(1e-10, 10 * scale); 
    const order = Math.pow(10, Math.floor(Math.log10(idealMinorTarget)));
    const normalized = idealMinorTarget / order;
    
    let baseMinor, mediumMult, majorMult;
    if (normalized < 1.5) {
        baseMinor = 1;
        mediumMult = 5;
        majorMult = 10;
    } else if (normalized < 3.5) {
        baseMinor = 2;
        mediumMult = 5;
        majorMult = 10;
    } else if (normalized < 7.5) {
        baseMinor = 5;
        mediumMult = 2;
        majorMult = 10;
    } else {
        baseMinor = 10;
        mediumMult = 5;
        majorMult = 10;
    }
    
    const minorInterval = baseMinor * order;

    // 水平ルーラー (H)
    const hRulerY = y;
    const hRulerHeight = 20 * scale;

    // 背景（半透明）
    rulerGroup.rect(w, hRulerHeight).move(x, y).fill({ color: '#f5f5f5', opacity: 0.8 });

    const startXOffset = Math.floor(x / minorInterval);
    const startX = startXOffset * minorInterval;
    let tickIndexOffsetX = startXOffset;
    
    for (let curX = startX; curX <= x + w; curX += minorInterval, tickIndexOffsetX++) {
        if (curX < x) continue;
        let tickH = 4 * scale;
        let isMajor = false;
        let isMedium = false;

        if (tickIndexOffsetX % majorMult === 0) {
            tickH = 12 * scale;
            isMajor = true;
        } else if (tickIndexOffsetX % mediumMult === 0) {
            tickH = 8 * scale;
            isMedium = true;
        }

        rulerGroup.line(curX, y, curX, y + tickH).stroke({ color: tickColor, width: strokeWidth });

        if (isMajor) {
            let labelText = (Math.round(curX * 1e6) / 1e6).toString();
            rulerGroup.text(labelText)
                .font({ size: fontSize, family: 'sans-serif', fill: labelColor })
                .move(curX + 2 * scale, y + 2 * scale);
        }
    }

    // 垂直ルーラー (V)
    const vRulerWidth = 20 * scale;
    rulerGroup.rect(vRulerWidth, h).move(x, y).fill({ color: '#f5f5f5', opacity: 0.8 });

    const startYOffset = Math.floor(y / minorInterval);
    const startY = startYOffset * minorInterval;
    let tickIndexOffsetY = startYOffset;
    
    for (let curY = startY; curY <= y + h; curY += minorInterval, tickIndexOffsetY++) {
        if (curY < y) continue;
        let tickW = 4 * scale;
        let isMajor = false;
        let isMedium = false;

        if (tickIndexOffsetY % majorMult === 0) {
            tickW = 12 * scale;
            isMajor = true;
        } else if (tickIndexOffsetY % mediumMult === 0) {
            tickW = 8 * scale;
            isMedium = true;
        }

        rulerGroup.line(x, curY, x + tickW, curY).stroke({ color: tickColor, width: strokeWidth });

        if (isMajor) {
            let labelText = (Math.round(curY * 1e6) / 1e6).toString();
            rulerGroup.text(labelText)
                .font({ size: fontSize, family: 'sans-serif', fill: labelColor })
                .move(x + 2 * scale, curY + 2 * scale)
                .attr('transform', `rotate(-90, ${x + 2 * scale}, ${curY + 2 * scale})`);
        }
    }

    // コーナーボックス
    rulerGroup.rect(vRulerWidth, hRulerHeight).move(x, y).fill({ color: '#eee' })
        .stroke({ color: '#ccc', width: strokeWidth });
}
window.updateRulers = updateRulers;

