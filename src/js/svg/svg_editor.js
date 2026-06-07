/**
 * SVG Editor - Powered by SVG.js
 * (Refactored: Main Entry Point)
 */

// [FIX] SVG.js adopt (SVG(node) & SVG.adopt(node)) による tspan の属性・コンテンツ消失を防ぐグローバルフック
(function() {
    const originalSVG = window.SVG;
    
    // 共通のテキスト要素 adopt 保護処理
    function safeAdoptText(node, adoptFn, context, args) {
        // すでにインスタンスがあればそのまま返す (再 adopt を防ぐ)
        if (node.instance) return node.instance;

        // tspan データの退避
        const tspanData = [];
        node.querySelectorAll('tspan').forEach((tspan, index) => {
            tspanData.push({
                index: index,
                id: tspan.getAttribute('id'),
                x: tspan.getAttribute('x'),
                y: tspan.getAttribute('y'),
                dy: tspan.getAttribute('dy'),
                text: tspan.textContent
            });
        });
        console.log(`[SVG adopt hook] Evacuating ${tspanData.length} tspans for text#${node.id || 'no-id'}`, JSON.stringify(tspanData));

        // 元の adopt 処理を実行
        const el = adoptFn.apply(context, args);

        // 退避したデータを復元し、SVG.jsの内部キャッシュ・子要素リストを再構築
        if (el && tspanData.length > 0) {
            console.log(`[SVG adopt hook] Rebuilding Text elements with ${tspanData.length} tspans`);
            el.clear();
            el.text(add => {
                tspanData.forEach(data => {
                    const tspan = add.tspan(data.text);
                    if (data.id) tspan.id(data.id);
                    const attrs = {};
                    if (data.x) attrs.x = data.x;
                    if (data.y) attrs.y = data.y;
                    if (data.dy) attrs.dy = data.dy;
                    tspan.attr(attrs);
                });
            });
        }
        return el;
    }

    if (typeof originalSVG === 'function') {
        // 1. window.SVG 関数のフック
        window.SVG = function(node, ...args) {
            if (node && node.nodeType === 1) { // Element node
                const tagName = node.tagName ? node.tagName.toLowerCase() : '';
                if (tagName === 'text') {
                    return safeAdoptText(node, originalSVG, this, [node, ...args]);
                }
            }
            return originalSVG.apply(this, arguments);
        };
        
        // 2. SVG.adopt 静的メソッドのフック
        if (typeof originalSVG.adopt === 'function') {
            const originalAdopt = originalSVG.adopt;
            window.SVG.adopt = function(node) {
                if (node && node.nodeType === 1) {
                    const tagName = node.tagName ? node.tagName.toLowerCase() : '';
                    if (tagName === 'text') {
                        return safeAdoptText(node, originalAdopt, this, arguments);
                    }
                }
                return originalAdopt.apply(this, arguments);
            };
        }

        // 必要に応じてプロパティを委譲
        Object.assign(window.SVG, originalSVG);
    }
})();

window.currentEditingSVG = null;

// [FIX] Define as global variable explicitly for other modules
// let window.currentEditingSVG = null; // Removed local let to enforce window usage

/**
 * Start SVG Editing Mode
 * @param {HTMLElement} container - The container element (split-cell)
 * @param {number} svgIndex - Index of the SVG block in the editor
 */
function startSVGEdit(container, svgIndex) {
    // console.log('[startSVGEdit] Called with svgIndex:', svgIndex);

    // [FIX] 再入防止: 初期化処理中に別のstartSVGEditが呼ばれた場合は無視する
    if (window._svgEditorStarting) {
        console.log('[startSVGEdit] Blocked: Already starting an SVG editor.');
        return;
    }

    const isSameSvg = window.currentEditingSVG && window.currentEditingSVG.svgIndex === svgIndex;
    const isSameContainer = isSameSvg && window.currentEditingSVG.container === container;
    const isStillValid = isSameContainer && document.body.contains(container);

    if (isStillValid && window.currentEditingSVG.draw) {
        // console.log('[startSVGEdit] Already editing this SVG in current container. Skipping.');
        return;
    }

    const isReconnecting = isSameSvg && window.currentEditingSVG.draw;

    // [NEW] 内部補助要素の判定
    function isInternalElement(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.getAttribute('data-internal') === 'true') return true;
        const classes = node.classList;
        if (!classes) return false;
        const internalPatterns = [
            'svg-canvas-border', 'svg-canvas-proxy', 'svg-grid-lines', 'svg-snap-guides',
            'svg-control-marker', 'polyline-handle-group', 'svg-grad-skeleton-hitarea',
            'svg-grad-skeleton-line', 'midpoint-handle', 'polyline-handle', 'bez-control-point',
            'arrow-size-handle', 'svg-interaction-hitarea', 'svg-select-group-canvas',
            'svg-connector-overlay', 'svg-gradient-stroke', 'svg-gradient-meta',
            'svg-grad-control-ui', 'svg-grad-blur-back', 'svg-selection-marker',
            'svg-rotation-handler', 'svg-resize-handler', 'svg-radius-handler',
            'svg-vertex-handler', 'svg-connector-handler'
        ];
        for (const pattern of internalPatterns) {
            if (classes.contains(pattern)) return true;
        }
        return false;
    }
    window.isSVGInternalElement = isInternalElement;

    // [NEW] 有効な非内部子要素のリストを取得
    function getValidChildren(parent) {
        if (!parent) return [];
        return Array.from(parent.children).filter(child => !isInternalElement(child));
    }
    window.getSVGValidChildren = getValidChildren;

    // [NEW] 再接続時の選択状態維持のため、古い要素の情報（IDとインデックスパス）を退避
    let reconnectSelectionTargets = [];
    if (isReconnecting && window.currentEditingSVG.selectedElements && window.currentEditingSVG.draw) {
        const oldRoot = window.currentEditingSVG.draw.node;
        window.currentEditingSVG.selectedElements.forEach(el => {
            if (el && el.node) {
                const id = (typeof el.id === 'function') ? el.id() : el.node.getAttribute('id');
                
                // 有効な非内部図形要素のみを対象としてインデックスパスを算出
                const path = [];
                let curr = el.node;
                while (curr && curr !== oldRoot) {
                    const parent = curr.parentNode;
                    if (!parent) break;
                    const validChildren = getValidChildren(parent);
                    const idx = validChildren.indexOf(curr);
                    if (idx !== -1) {
                        path.unshift(idx);
                    } else {
                        // 自身が内部要素だった場合はパス同定を不可とする
                        path.unshift(-1);
                    }
                    curr = parent;
                }
                reconnectSelectionTargets.push({ id, path });
            }
        });
        // 一旦選択をクリア（後で新しいインスタンスで再選択するため）
        window.currentEditingSVG.selectedElements.clear();
    }

    // [FIX] 再入防止フラグをセット
    window._svgEditorStarting = true;
    try {

    if (window.currentEditingSVG && !isReconnecting) {
        // console.log('[startSVGEdit] Closing existing SVG editor first');
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
    current._initializing = true;
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

    // [FIX] 名前付き関数に変更してstopSVGEdit時にクリーンアップ可能にする
    const contextMenuHandler = (e) => handleContextMenu(e, container, svgIndex);
    container.addEventListener('contextmenu', contextMenuHandler);
    current._contextMenuHandler = contextMenuHandler;

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
                // console.log('[startSVGEdit] Normalized external SVG attributes (data-paper-*補完完了)');

                // Markdownソースにもサイレント同期（編集完了時に確定するため遅延実行、履歴には追加しない）
                setTimeout(() => {
                    if (typeof syncChanges === 'function' && window.currentEditingSVG) {
                        syncChanges(true, null, false);
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

    // [FIX] SVG(svgElement) を呼び出すと、SVG.js内部で再帰的に adopt され、tspan の中身や属性が消える現象を防ぐため、一時退避
    const savedTspans = [];
    svgElement.querySelectorAll('text').forEach(textNode => {
        const tspans = [];
        textNode.querySelectorAll('tspan').forEach((tspan, index) => {
            tspans.push({
                index: index,
                id: tspan.getAttribute('id'),
                x: tspan.getAttribute('x'),
                y: tspan.getAttribute('y'),
                dy: tspan.getAttribute('dy'),
                text: tspan.textContent
            });
        });
        savedTspans.push({
            textNode: textNode,
            tspans: tspans
        });
    });

    // Adopt SVG using SVG.js
    const draw = SVG(svgElement);

    // [FIX] 一時退避した tspan データを復元し、SVG.jsの内部キャッシュを再構築
    savedTspans.forEach(data => {
        // textNode の instance (SVG.Text) を取得する。なければ adopt する
        const el = data.textNode.instance || (typeof window.SVG === 'function' ? window.SVG(data.textNode) : null);
        if (el && data.tspans.length > 0) {
            el.clear();
            el.text(add => {
                data.tspans.forEach(tspanData => {
                    const tspan = add.tspan(tspanData.text);
                    if (tspanData.id) tspan.id(tspanData.id);
                    const attrs = {};
                    if (tspanData.x) attrs.x = tspanData.x;
                    if (tspanData.y) attrs.y = tspanData.y;
                    if (tspanData.dy) attrs.dy = tspanData.dy;
                    tspan.attr(attrs);
                });
            });
        }
    });

    draw.addClass('svg-editable');
    current.draw = draw;

    // [NEW] 再接続時の選択状態復元（インデックスパスによる同定＋IDフォールバック）
    if (isReconnecting && reconnectSelectionTargets.length > 0 && draw) {
        console.log('[startSVGEdit] Reconnecting: Restoring selection targets:', reconnectSelectionTargets);
        reconnectSelectionTargets.forEach(target => {
            let newEl = null;
            
            // 1. 有効な非内部図形要素のみを辿って厳密に同じDOM位置の要素を探す
            if (target.path && target.path.length > 0) {
                let curr = draw.node;
                for (const idx of target.path) {
                    if (idx === -1) {
                        curr = null;
                        break;
                    }
                    const validChildren = getValidChildren(curr);
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
            if (newEl && newEl.node && newEl.node.isConnected) {
                if (typeof selectElement === 'function') {
                    selectElement(newEl, true, true);
                }
            }
        });
    }

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
        // console.log(`[startSVGEdit] Attribute Trace - width: ${svgElement.getAttribute('width')}, height: ${svgElement.getAttribute('height')}, data: ${savedPaperW}x${savedPaperH}`);
    }

    const vbAttr = svgElement.getAttribute('viewBox');
    const vbBase = svgElement.viewBox.baseVal;
    // console.log(`[startSVGEdit] Initial viewBox ATTR: "${vbAttr}"`);
    // console.log(`[startSVGEdit] Initial viewBox baseVal: ${vbBase.x} ${vbBase.y} ${vbBase.width} ${vbBase.height}`);

    // [FIX] 再接続時はメモリ上の現在値を最優先し、データのダウングレード（450への戻り）を防ぐ
    const prevW = current.baseWidth;
    const prevH = current.baseHeight;
    const prevX = current.baseX;
    const prevY = current.baseY;

    // [MOD] 優先順位: 1. メモリに有効な値があり、DOMがデフォルト(350/450)に戻っている場合はメモリを維持
    //               2. さもなくば属性(savedPaper*)
    //               3. さもなくばDOMの基本寸法
    // [FIX] viewBox はズーム込みの値のため、フォールバック時はズームで割り戻して論理サイズに変換する
    const initZoom = parseFloat(svgElement.getAttribute('data-paper-zoom')) || 100;
    const initZoomFactor = initZoom / 100;
    const domW = !isNaN(savedPaperW) ? savedPaperW : (vbBase.width ? Math.round(vbBase.width * initZoomFactor) : (parseFloat(svgElement.getAttribute('width')) || 820));
    const domH = !isNaN(savedPaperH) ? savedPaperH : (vbBase.height ? Math.round(vbBase.height * initZoomFactor) : (parseFloat(svgElement.getAttribute('height')) || 450));
    const isDomDefault = (Math.abs(domH - 450) < 1 || Math.abs(domH - 350) < 1);

    if (prevH && !isNaN(prevH) && isDomDefault && Math.abs(domH - prevH) > 10) {
        // [Safety] Favor memory when DOM seems reset to default
        current.baseWidth = prevW;
        current.baseHeight = prevH;
        current.baseX = prevX;
        current.baseY = prevY;
        // console.log(`[startSVGEdit] Favoring Memory over suspicious DOM default (${domH}px -> ${prevH}px)`);
    } else {
        current.baseWidth = domW;
        current.baseHeight = domH;
        current.baseX = !isNaN(savedPaperX) ? savedPaperX : (prevX || vbBase.x || 0);
        current.baseY = !isNaN(savedPaperY) ? savedPaperY : (prevY || vbBase.y || 0);
    }

    // [NEW] キャンバス高さを正解の基準値として記録（ライブラリによる副作用リセットの検知・修復用）
    current.standardHeight = current.baseHeight;

    // console.log(`[startSVGEdit] Resolved Base size: ${current.baseWidth}x${current.baseHeight}`);

    // [NEW] ズーム率とオフセットを復元
    const storedZoom = parseFloat(svgElement.getAttribute('data-paper-zoom'));
    const storedOffX = parseFloat(svgElement.getAttribute('data-paper-offx'));
    const storedOffY = parseFloat(svgElement.getAttribute('data-paper-offy'));

    if (!isNaN(storedZoom)) {
        // [MOD] 専用データ属性 (data-paper-zoom等) が存在する場合は最優先で復元 (viewBoxリセット対策)
        current.zoom = storedZoom;
        current.offX = !isNaN(storedOffX) ? storedOffX : 0;
        current.offY = !isNaN(storedOffY) ? storedOffY : 0;
        // console.log(`[startSVGEdit] Restored View State via DATA-ATTR- Zoom: ${current.zoom}%, Offset: (${current.offX}, ${current.offY})`);
    } else if (!isNaN(savedPaperW) && vbBase.width > 0) {
        // [FALLBACK] 属性がない場合は従来通り viewBox から逆算
        const calculatedZoom = Math.round((current.baseWidth / vbBase.width) * 100);
        current.zoom = calculatedZoom;
        current.offX = vbBase.x - current.baseX;
        current.offY = vbBase.y - current.baseY;
        // console.log(`[startSVGEdit] Restored View State via VIEWBOX- Zoom: ${current.zoom}% (calc: ${calculatedZoom}), Offset: (${current.offX}, ${current.offY})`);
    } else {
        // console.log(`[startSVGEdit] No restoration attributes found. Defaulting to 100% zoom.`);
    }

    // [NEW] グリッド設定を復元
    const storedGridSize = parseInt(svgElement.getAttribute('data-paper-grid-size'));
    const storedGridMajor = parseInt(svgElement.getAttribute('data-paper-grid-major'));
    if (!isNaN(storedGridSize)) {
        // console.log(`[startSVGEdit] Restoring grid size: ${storedGridSize}`);
        AppState.config.grid.size = storedGridSize;
    }
    if (!isNaN(storedGridMajor)) {
        // console.log(`[startSVGEdit] Restoring grid major interval: ${storedGridMajor}`);
        AppState.config.grid.majorInterval = storedGridMajor;
    }

    /**
     * Zoom and Pan の適用
     */
    current.applyZoomPan = function () {
        if (this.container) {
            this.container.classList.add('svg-editor-container');
            this.container.style.setProperty('--svg-zoom', this.zoom);
        }

        const svg = this.draw.node;
        const scale = 100 / this.zoom;
        const w = this.baseWidth * scale;
        const h = this.baseHeight * scale;

        const vx = this.baseX + this.offX;
        const vy = this.baseY + this.offY;

        svg.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);

        // [最適化] Pattern化したため、グリッドは毎回の再生成不要。ズームツールバー更新のみ
        if (this.gridToolbar && typeof this.gridToolbar.updateZoomDisplay === 'function') {
            this.gridToolbar.updateZoomDisplay(this.zoom);
        }

        this.draw.fire('zoomchange', { zoom: this.zoom });

        // 【Phase 4】 ルーラーとグリッドを Canvas に再描画
        if (typeof updateGrid === 'function') updateGrid(this.draw);
        if (typeof updateRulers === 'function') updateRulers(this.draw);

        clearTimeout(this._zoomPanSyncTimer);
        this._zoomPanSyncTimer = setTimeout(() => {
            if (typeof syncChanges === 'function' && window.currentEditingSVG === this) {
                syncChanges(true, null, false); 
            }
        }, 500); 
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

    // [NEW] Initialize Shadow Toolbar
    if (typeof createShadowToolbar !== 'undefined') {
        window.shadowToolbar = createShadowToolbar(container, SVGToolbar, {
            position: getPos(15), // (-37, 470)
            borderColor: '#9C27B0'
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

    // Gradient Toolbar
    if (typeof createGradientToolbar !== 'undefined') {
        current.gradientToolbar = window.gradientToolbar = createGradientToolbar(container, SVGToolbar, {
            position: getPos(13), // (-37, 410)
            borderColor: '#E74BA8'
        });
    }

    // [NEW] Airbrush Toolbar
    if (typeof createAirbrushToolbar !== 'undefined') {
        current.airbrushToolbar = window.airbrushToolbar = createAirbrushToolbar(container, SVGToolbar, {
            position: getPos(14), // (-37, 440)
            borderColor: '#7B68EE'
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
    // --- マウス操作（ズーム・パン）のイベント間引き処理 ---
    // [FIX] 名前付き関数に変更してstopSVGEdit時にクリーンアップ可能にする
    const wheelHandler = (e) => {
        if (!window.currentEditingSVG) return;
        const current = window.currentEditingSVG;

        if (e.ctrlKey) {
            e.preventDefault();
            const delta = -e.deltaY;
            const factor = delta > 0 ? 1.1 : 0.9;
            current._targetZoom = Math.max(1, Math.min(6400, (current._targetZoom || current.zoom) * factor));
            current._zoomMouseX = e.clientX;
            current._zoomMouseY = e.clientY;
        } else if (e.shiftKey) {
            e.preventDefault();
            const vb = draw.node.viewBox.baseVal;
            current._targetOffX = (current._targetOffX !== undefined ? current._targetOffX : current.offX) + (e.deltaY || e.deltaX) * (vb.width / container.clientWidth);
        } else {
            e.preventDefault();
            const vb = draw.node.viewBox.baseVal;
            current._targetOffY = (current._targetOffY !== undefined ? current._targetOffY : current.offY) + e.deltaY * (vb.height / container.clientHeight);
        }

        // ホイールイベントの間引き
        if (!current._isZoomPanScheduled) {
            current._isZoomPanScheduled = true;
            window.requestAnimationFrame(() => {
                current._isZoomPanScheduled = false;
                if (!window.currentEditingSVG) return;
                
                let changed = false;
                if (current._targetZoom !== undefined && current._targetZoom !== current.zoom) {
                    const rect = container.getBoundingClientRect();
                    const mouseX = current._zoomMouseX - rect.left;
                    const mouseY = current._zoomMouseY - rect.top;

                    const vb = draw.node.viewBox.baseVal;
                    const worldX = vb.x + (mouseX / rect.width) * vb.width;
                    const worldY = vb.y + (mouseY / rect.height) * vb.height;

                    current.zoom = current._targetZoom;
                    const newScale = 100 / current.zoom;
                    const newW = current.baseWidth * newScale;
                    const newH = current.baseHeight * newScale;

                    current.offX = worldX - (mouseX / rect.width) * newW - current.baseX;
                    current.offY = worldY - (mouseY / rect.height) * newH - current.baseY;
                    changed = true;
                }
                current._targetZoom = undefined;

                if (current._targetOffX !== undefined && current._targetOffX !== current.offX) {
                    current.offX = current._targetOffX;
                    changed = true;
                }
                current._targetOffX = undefined;

                if (current._targetOffY !== undefined && current._targetOffY !== current.offY) {
                    current.offY = current._targetOffY;
                    changed = true;
                }
                current._targetOffY = undefined;

                if (changed) current.applyZoomPan();
            });
        }
    };
    container.addEventListener('wheel', wheelHandler, { passive: false });
    current._wheelHandler = wheelHandler;

    // [FIX] 名前付き関数に変更してstopSVGEdit時にクリーンアップ可能にする
    const panMousedownHandler = (e) => {
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
    };
    container.addEventListener('mousedown', panMousedownHandler, true);
    current._panMousedownHandler = panMousedownHandler;

    // パン（ドラッグ）移動の間引き
    const onPanningMove = (e) => {
        if (!window.currentEditingSVG || !window.currentEditingSVG.isPanning) return;
        const current = window.currentEditingSVG;

        const dx = e.clientX - current.panStartX;
        const dy = e.clientY - current.panStartY;

        const vb = current.draw.node.viewBox.baseVal;
        current.offX -= dx * (vb.width / container.clientWidth);
        current.offY -= dy * (vb.height / container.clientHeight);

        current.panStartX = e.clientX;
        current.panStartY = e.clientY;

        if (!current._isPanMoveScheduled) {
            current._isPanMoveScheduled = true;
            window.requestAnimationFrame(() => {
                current._isPanMoveScheduled = false;
                if (window.currentEditingSVG) window.currentEditingSVG.applyZoomPan();
            });
        }
    };
    container._panningBound = onPanningMove;
    window.addEventListener('mousemove', onPanningMove);

    // [FIX] 名前付き関数に変更してstopSVGEdit時にクリーンアップ可能にする
    const panMouseupHandler = () => {
        if (window.currentEditingSVG && window.currentEditingSVG.isPanning) {
            window.currentEditingSVG.isPanning = false;
            container.style.cursor = window.currentEditingSVG.isSpacePressed ? 'grab' : '';
        }
    };
    window.addEventListener('mouseup', panMouseupHandler);
    current._panMouseupHandler = panMouseupHandler;

    // Background Click -> Select Canvas Proxy
    draw.on('mousedown', (e) => {
        if (window.currentEditingSVG && (window.currentEditingSVG.isSpacePressed || window.currentEditingSVG.isPanning)) return;
        if (typeof SVGToolbar !== 'undefined' && SVGToolbar.currentTool !== 'select') return;

        const target = e.target;
        if (target === svgElement || target === draw.node || target === canvasProxy.node) {
            if (typeof selectElement === 'function') selectElement(canvasProxy);
        }
    });

    // [NEW] 改善案2: makeInteractiveの遅延初期化（デリゲーション）
    let _lazyInitTicking = false;
    const lazyInitHandler = (e) => {
        if (!window.currentEditingSVG) return;
        
        // 描画ツールがアクティブな場合は、作成中の要素への誤った初期化を防ぐためスキップ
        if (typeof SVGToolbar !== 'undefined' && SVGToolbar.currentTool !== 'select') {
            return;
        }
        
        const processInit = (target) => {
            const svgElement = window.currentEditingSVG.container.querySelector('svg');
            const drawNode = window.currentEditingSVG.draw.node;
            
            while (target && target !== svgElement && target !== drawNode) {
                if (target.nodeType === 1) { // Element nodes only
                    const rawTagName = target.tagName.toLowerCase();
                    if (['tspan', 'textpath'].includes(rawTagName)) {
                        target = target.parentNode;
                        continue;
                    }
                    if (target.parentNode && target.parentNode.nodeType === 1) {
                        const pTagName = target.parentNode.tagName.toLowerCase();
                        const pToolId = target.parentNode.getAttribute('data-tool-id');
                        if (pTagName === 'g' && pToolId === 'shape-text-group') {
                            target = target.parentNode;
                            continue;
                        }
                    }
                    
                    const el = target.instance || (typeof window.SVG === 'function' ? window.SVG(target) : null);
                    if (el) {
                        const oldShape = el.remember('_shapeInstance');
                        if (oldShape && (oldShape.node !== target || !oldShape.node.isConnected)) {
                            oldShape.destroy();
                        }
                    }

                    if (el && !el.remember('_shapeInstance')) {
                        const tagName = el.node.tagName.toLowerCase();
                        if (['defs', 'style', 'marker', 'symbol', 'metadata'].includes(tagName)) {
                            target = target.parentNode;
                            continue;
                        }
                        // 堅牢な判定: 自身または祖先要素に一時的な操作UI用のクラス/属性が1つでも含まれる場合は即座に除外して親要素を辿る
                        const isInternalUI = target.closest(
                            '.svg-canvas-proxy, .svg-grid-lines, .svg-grid-line, .svg-ruler, ' +
                            '.svg-interaction-hitarea, .svg-grad-control-ui, .svg-grad-control-handle, ' +
                            '.polyline-handle-group, .rotation-handle-group, .radius-handle-group, ' +
                            '.bubble-handle-group, .svg-control-marker, .svg-snap-guides, ' +
                            '.svg-canvas-border, .svg_select_group, .svg-select-group, ' +
                            '.svg_select_handle_rot, [data-internal="true"], ' +
                            '.polyline-handle, .midpoint-handle, .bez-control-point, .bez-control-line, .arrow-size-handle, ' +
                            '.svg_select_shape, .svg_select_handle, .rotation-handle, .radius-handle'
                        );
                        if (isInternalUI) {
                            target = target.parentNode;
                            continue;
                        }
                        
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

                        if (typeof makeInteractive === 'function') {
                            makeInteractive(el);
                        }
                    }
                }
                target = target.parentNode;
            }
        };

        if (e.type === 'pointerover' || e.type === 'mouseover' || e.type === 'mousemove') {
            if (_lazyInitTicking) return;
            _lazyInitTicking = true;
            const target = e.target;
            requestAnimationFrame(() => {
                _lazyInitTicking = false;
                processInit(target);
            });
        } else {
            processInit(e.target);
        }
    };

    draw.node.addEventListener('pointerover', lazyInitHandler, { passive: true });
    draw.node.addEventListener('pointerdown', lazyInitHandler, { capture: true });
    draw.node.addEventListener('mouseover', lazyInitHandler, { passive: true });
    draw.node.addEventListener('mousedown', lazyInitHandler, { capture: true });
    current.lazyInitHandler = lazyInitHandler;

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

    // [NEW] Initialize hybrid sync queue (間引きあり)
    current.syncQueue = {
        changedNodeIds: new Set(),
        requiresFullSync: false
    };
    current._pendingMutations = [];
    let isSyncScheduled = false;

    const syncObserver = new MutationObserver((mutations) => {
        if (current._updatingFromEditor || current._syncingToEditor || current._initializing) return;

        current._pendingMutations.push(...mutations);

        if (!isSyncScheduled) {
            isSyncScheduled = true;
            window.requestAnimationFrame(() => {
                isSyncScheduled = false;
                if (!window.currentEditingSVG) return;

                const buffer = current._pendingMutations;
                current._pendingMutations = [];
                const queue = current.syncQueue;
                let hasChanges = false;

                for (let i = 0; i < buffer.length; i++) {
                    const mutation = buffer[i];
                    const targetNode = mutation.target;
                    if (targetNode.nodeType !== 1) continue;

                    // 高速化: 重い closest() の前に、軽量な判定で無視要素を弾く
                    if (targetNode.classList && targetNode.classList.contains('svg-interaction-hitarea')) continue;
                    if (targetNode.getAttribute('data-internal') === 'true') continue;

                    let isIgnored = false;
                    let curr = targetNode;
                    // 最大4階層までの O(1) 判定で遡上を高速化
                    for (let j = 0; j < 4 && curr && curr.nodeType === 1; j++) {
                        if (curr.getAttribute('data-internal') === 'true' || curr.id === 'grid-group') {
                            isIgnored = true; break;
                        }
                        if (curr.classList) {
                            const cls = curr.className.baseVal || curr.className || '';
                            if (typeof cls === 'string' && (
                                cls.includes('svg-canvas-proxy') || cls.includes('svg-grid') || 
                                cls.includes('svg_select') || cls.includes('svg-interaction') ||
                                cls.includes('svg-snap-guides') || cls.includes('svg-ruler') ||
                                cls.includes('svg-control-marker') || cls.includes('-handle-group')
                            )) {
                                isIgnored = true; break;
                            }
                        }
                        curr = curr.parentNode;
                    }
                    if (isIgnored) continue;

                    if (mutation.type === 'childList' || mutation.type === 'characterData') {
                        queue.requiresFullSync = true;
                        hasChanges = true;
                    } else if (mutation.type === 'attributes') {
                        if (targetNode.tagName.toLowerCase() === 'svg') {
                            queue.changedNodeIds.add('__root__');
                            hasChanges = true;
                        } else {
                            const closestInteractive = targetNode.id ? targetNode : targetNode.closest('[id]');
                            if (closestInteractive && closestInteractive.id) {
                                queue.changedNodeIds.add(closestInteractive.id);
                                hasChanges = true;
                            }
                        }
                    }
                }

                if (hasChanges && (queue.requiresFullSync || queue.changedNodeIds.size > 0)) {
                    if (typeof window.schedulePartialSync === 'function') window.schedulePartialSync();
                }
            });
        }
    });

    syncObserver.observe(svgElement, {
        attributes: true, childList: true, characterData: true, subtree: true,
        attributeFilter: ['transform', 'd', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'style', 'class', 'viewBox']
    });
    current.syncObserver = syncObserver;

    // ▼ 追加: Observerの完全一時停止・再開メソッド
    current.suspendObserver = function() {
        if (this.syncObserver && !this._isObserverSuspended) {
            this.syncObserver.takeRecords(); // 溜まった未処理キューを破棄
            this.syncObserver.disconnect();  // 監視を完全に停止
            this._pendingMutations = [];
            this._isObserverSuspended = true;
        }
    };

    current.resumeObserver = function() {
        if (this.syncObserver && this._isObserverSuspended && this.container) {
            const svgEl = this.container.querySelector('svg');
            if (svgEl) {
                this.syncObserver.observe(svgEl, {
                    attributes: true, childList: true, characterData: true, subtree: true,
                    attributeFilter: ['transform', 'd', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'style', 'class', 'viewBox']
                });
                this._isObserverSuspended = false;
            }
        }
    };

    // 起動時に既存の全要素を即座にインタラクティブ化する処理を【軽量化】
    const initializeAllElements = () => {
        if (!draw) return;
        
        // ▼ 変更: 全ノードのループを廃止し、lazyInitHandler (遅延評価) に完全に委ねる。
        // 起動直後に視覚的な崩れを防ぐ必要がある「テキスト付き図形」のみに絞る。
        const textGroups = svgElement.querySelectorAll('g[data-tool-id="shape-text-group"]');
        textGroups.forEach(node => {
            const el = node.instance || (typeof window.SVG === 'function' ? window.SVG(node) : null);
            if (el) {
                // 最低限のインスタンス化
                if (!el.remember('_shapeInstance') && typeof makeInteractive === 'function') {
                    makeInteractive(el);
                }
                const inst = el.remember('_shapeInstance');
                if (inst && typeof inst.applyTextWrap === 'function') {
                    inst.applyTextWrap();
                }
            }
        });
    };
    initializeAllElements();

    // 【Phase 4】 リサイズ時の Canvas サイズ自動追従
    if (typeof ResizeObserver !== 'undefined' && !current.resizeObserver) {
        current.resizeObserver = new ResizeObserver(() => {
            if (window.currentEditingSVG && window.currentEditingSVG.draw) {
                requestAnimationFrame(() => {
                    if (typeof updateGrid === 'function') updateGrid(window.currentEditingSVG.draw);
                    if (typeof updateRulers === 'function') updateRulers(window.currentEditingSVG.draw);
                });
            }
        });
        current.resizeObserver.observe(container);
    }

    // [NEW] Initialize Zoom and CSS Variables (RESTORED STATE)
    current.setZoom(current.zoom || 100);

    // [NEW] 初期化完了後に初期化フラグを解除（非同期でMutationObserverのバーストを避けるため遅延）
    setTimeout(() => {
        if (window.currentEditingSVG === current) {
            current._initializing = false;
            // console.log('[startSVGEdit] _initializing flag cleared');
        }
    }, 300);

    } finally {
        // [FIX] 再入防止フラグを解除（例外発生時も確実に解除する）
        window._svgEditorStarting = false;
    }
}
window.startSVGEdit = startSVGEdit;

/**
 * Stop SVG Editing Mode
 * @param {boolean} skipRender - If true, skip the final render() call
 */
function stopSVGEdit(skipRender = false) {
    if (!window.currentEditingSVG) return;

    window.currentEditingSVG._operationStartBlock = null;

    if (window.currentEditingSVG.syncObserver) {
        window.currentEditingSVG.syncObserver.disconnect();
        window.currentEditingSVG.syncObserver = null;
    }
    
    // 【Phase 4】 Canvasオブザーバーのクリーンアップ
    if (window.currentEditingSVG.resizeObserver) {
        window.currentEditingSVG.resizeObserver.disconnect();
        window.currentEditingSVG.resizeObserver = null;
    }

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
    if (window.colorToolbar) window.colorToolbar.destroy();
    if (window.currentEditingSVG.alignToolbar) window.currentEditingSVG.alignToolbar.destroy();
    if (window.currentEditingSVG.textAlignToolbar) window.currentEditingSVG.textAlignToolbar.destroy();
    if (window.currentEditingSVG.fontToolbar) window.currentEditingSVG.fontToolbar.destroy();
    if (window.currentEditingSVG.lineToolbar) window.currentEditingSVG.lineToolbar.destroy();
    if (window.cssToolbar) window.cssToolbar.destroy();
    if (window.gradientToolbar) {
        window.gradientToolbar.destroy();
        window.gradientToolbar = null;
    }
    // [NEW] Airbrush Toolbar 破棄
    if (window.airbrushToolbar) {
        window.airbrushToolbar.destroy();
        window.airbrushToolbar = null;
    }

    // [NEW] Remove grid lines before sync/cleanup
    if (draw) {
        draw.find('.svg-grid-lines, .svg-grid-line, .svg-grid-pattern, .svg-grid-rect').remove();
    }
    
    // 【Phase 4】ハイブリッド描画用のCanvasもクリーンアップ
    if (container) {
        container.querySelectorAll('canvas.svg-grid-canvas, canvas.svg-ruler-canvas').forEach(c => c.remove());
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
        document.querySelectorAll('.svg-toolbar:not(.annotation-toolbar)').forEach(tb => tb.remove());
        const strayToolbar = container.querySelector('.svg-toolbar:not(.annotation-toolbar)');
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

    if (window.currentEditingSVG.lazyInitHandler) {
        draw.node.removeEventListener('pointerover', window.currentEditingSVG.lazyInitHandler);
        draw.node.removeEventListener('pointerdown', window.currentEditingSVG.lazyInitHandler, { capture: true });
        draw.node.removeEventListener('mouseover', window.currentEditingSVG.lazyInitHandler);
        draw.node.removeEventListener('mousedown', window.currentEditingSVG.lazyInitHandler, { capture: true });
    }

    // Removed drop event cleanup

    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('mdEditor_pendingSVGEditIndex');
        sessionStorage.removeItem('mdEditor_pendingSelectionIndices');
    }

    // Cleanup removed to avoid duplication

    // [FIX] container上のイベントリスナーをクリーンアップ
    if (container) {
        if (window.currentEditingSVG._wheelHandler) {
            container.removeEventListener('wheel', window.currentEditingSVG._wheelHandler);
        }
        if (window.currentEditingSVG._panMousedownHandler) {
            container.removeEventListener('mousedown', window.currentEditingSVG._panMousedownHandler, true);
        }
        if (window.currentEditingSVG._contextMenuHandler) {
            container.removeEventListener('contextmenu', window.currentEditingSVG._contextMenuHandler);
        }
    }
    // [FIX] window上のmouseupリスナーをクリーンアップ
    if (window.currentEditingSVG._panMouseupHandler) {
        window.removeEventListener('mouseup', window.currentEditingSVG._panMouseupHandler);
    }

    window.currentEditingSVG = null;

    // [NEW] Global events cleanup
    if (container._panningBound) {
        window.removeEventListener('mousemove', container._panningBound);
        delete container._panningBound;
    }

    // [FIX] 再入防止フラグをリセット（stopSVGEditが単独で呼ばれた場合にも対応）
    window._svgEditorStarting = false;

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

    // [DEBUG LOG] 右クリック情報と選択状態を出力
    try {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const draw = window.currentEditingSVG.draw;
        let svgPt = null;
        if (draw) {
            svgPt = draw.point(mouseX, mouseY);
        }

        const targetNode = e.target;
        let targetInfo = {
            tagName: targetNode ? targetNode.tagName : 'none',
            id: targetNode ? targetNode.getAttribute('id') : 'none',
            class: targetNode ? targetNode.getAttribute('class') : 'none'
        };

        if (targetNode && typeof targetNode.getBoundingClientRect === 'function') {
            const rect = targetNode.getBoundingClientRect();
            targetInfo.clientRect = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            };
        }

        if (targetNode && typeof SVG === 'function') {
            try {
                const el = SVG(targetNode);
                if (el && typeof el.bbox === 'function') {
                    const bbox = el.bbox();
                    targetInfo.bbox = {
                        x: bbox.x,
                        y: bbox.y,
                        width: bbox.width,
                        height: bbox.height
                    };
                }
            } catch(err) {}
        }

        const selectedElementsInfo = Array.from(window.currentEditingSVG.selectedElements).map(el => {
            return {
                tagName: el.node ? el.node.tagName : 'unknown',
                id: (typeof el.id === 'function') ? el.id() : (el.node ? el.node.getAttribute('id') : 'unknown'),
                class: el.node ? el.node.getAttribute('class') : 'none'
            };
        });

        console.log('[DEBUG Context Menu Click Information]\n' + JSON.stringify({
            mouse: {
                clientX: mouseX,
                clientY: mouseY,
                svgX: svgPt ? svgPt.x : null,
                svgY: svgPt ? svgPt.y : null
            },
            targetElement: targetInfo,
            selectionState: {
                count: selectedElementsInfo.length,
                elements: selectedElementsInfo
            }
        }, null, 2));
    } catch (err) {
        console.error('[DEBUG Context Menu Click Information Error]', err);
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

// 【Phase 4】 Canvas生成ヘルパー
function getOrCreateCanvas(container, className, zIndex) {
    let canvas = container.querySelector(`canvas.${className}`);
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = className;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.zIndex = zIndex;
        canvas.style.pointerEvents = 'none';
        container.insertBefore(canvas, container.firstChild);
        
        const svgEl = container.querySelector('svg');
        if (svgEl) {
            svgEl.style.position = 'relative';
            svgEl.style.zIndex = '1';
        }
        container.style.position = 'relative';
    }
    
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
    }
    return canvas;
}

/**
 * [Phase 4] Update Grid Display using Canvas
 */
function updateGrid(draw) {
    if (!draw) return;

    // SVG DOM上の古いグリッド要素は完全削除
    draw.find('.svg-grid-pattern, .svg-grid-lines, .svg-grid-line, .svg-grid-rect').remove();

    const container = window.currentEditingSVG ? window.currentEditingSVG.container : draw.node.parentNode;
    if (!container) return;

    const config = AppState.config.grid || { size: 15, showV: true, showH: true };
    const canvas = getOrCreateCanvas(container, 'svg-grid-canvas', '0');
    
    if (!config.showV && !config.showH) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const size = config.size || 15;
    const majorInterval = config.majorInterval || 5;
    const cur = window.currentEditingSVG;
    const vb = draw.node.viewBox.baseVal;
    if (!vb || vb.width === 0) return;
    
    const rect = container.getBoundingClientRect();
    const screenScale = rect.width / vb.width;
    
    const step = size * screenScale;
    const majorStep = size * majorInterval * screenScale;
    const offsetX = -(vb.x * screenScale);
    const offsetY = -(vb.y * screenScale);
    
    const startX = (offsetX % step + step) % step;
    const startY = (offsetY % step + step) % step;

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#e0e0e0';
    ctx.beginPath();
    
    if (config.showV) {
        for (let x = startX; x <= rect.width; x += step) {
            const gridIdx = Math.round((x - offsetX) / step);
            if (gridIdx % majorInterval === 0) continue;
            ctx.moveTo(x, 0); ctx.lineTo(x, rect.height);
        }
    }
    if (config.showH) {
        for (let y = startY; y <= rect.height; y += step) {
            const gridIdx = Math.round((y - offsetY) / step);
            if (gridIdx % majorInterval === 0) continue;
            ctx.moveTo(0, y); ctx.lineTo(rect.width, y);
        }
    }
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#cccccc';
    ctx.beginPath();
    const majorStartX = (offsetX % majorStep + majorStep) % majorStep;
    const majorStartY = (offsetY % majorStep + majorStep) % majorStep;

    if (config.showV) {
        for (let x = majorStartX; x <= rect.width; x += majorStep) {
            ctx.moveTo(x, 0); ctx.lineTo(x, rect.height);
        }
    }
    if (config.showH) {
        for (let y = majorStartY; y <= rect.height; y += majorStep) {
            ctx.moveTo(0, y); ctx.lineTo(rect.width, y);
        }
    }
    ctx.stroke();
}
window.updateGrid = updateGrid;

/**
 * [Phase 4] Update Rulers Display using Canvas
 */
function updateRulers(draw) {
    if (!draw) return;

    draw.find('.svg-ruler').remove();

    const container = window.currentEditingSVG ? window.currentEditingSVG.container : draw.node.parentNode;
    if (!container) return;

    const canvas = getOrCreateCanvas(container, 'svg-ruler-canvas', '2');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    if (!AppState.config || !AppState.config.showRuler) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const vb = draw.node.viewBox.baseVal;
    if (!vb || vb.width === 0) return;
    
    const rect = container.getBoundingClientRect();
    const screenScale = rect.width / vb.width; 
    
    const RULER_PX = 20;
    const FONT_PX = 10;
    const TICK_MINOR_PX = 4, TICK_MEDIUM_PX = 8, TICK_MAJOR_PX = 12;

    const idealMinorTarget = Math.max(1e-10, 40 / screenScale);
    const order = Math.pow(10, Math.floor(Math.log10(idealMinorTarget)));
    const normalized = idealMinorTarget / order;

    let baseMinor, mediumMult, majorMult;
    if (normalized < 1.5) { baseMinor = 1; mediumMult = 5; majorMult = 10; }
    else if (normalized < 3.5) { baseMinor = 2; mediumMult = 5; majorMult = 10; }
    else if (normalized < 7.5) { baseMinor = 5; mediumMult = 2; majorMult = 10; }
    else { baseMinor = 10; mediumMult = 5; majorMult = 10; }
    const minorInterval = baseMinor * order;

    ctx.fillStyle = 'rgba(245, 245, 245, 0.9)';
    ctx.fillRect(0, 0, rect.width, RULER_PX);
    ctx.fillRect(0, 0, RULER_PX, rect.height);
    
    ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, RULER_PX, RULER_PX);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, RULER_PX, RULER_PX);

    ctx.strokeStyle = '#999'; ctx.fillStyle = '#666';
    ctx.font = `${FONT_PX}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';

    const startXOffset = Math.ceil(vb.x / minorInterval);
    let tickIndexX = startXOffset;
    ctx.beginPath();
    for (let curX = startXOffset * minorInterval; curX <= vb.x + vb.width; curX += minorInterval, tickIndexX++) {
        const cx = Math.floor((curX - vb.x) * screenScale) + 0.5;
        if (cx < RULER_PX || cx > rect.width) continue;

        let tickH = tickIndexX % majorMult === 0 ? TICK_MAJOR_PX : (tickIndexX % mediumMult === 0 ? TICK_MEDIUM_PX : TICK_MINOR_PX);
        ctx.moveTo(cx, RULER_PX); ctx.lineTo(cx, RULER_PX - tickH);

        if (tickIndexX % majorMult === 0) ctx.fillText((Math.round(curX * 1e6) / 1e6).toString(), cx + 2, 2);
    }
    ctx.stroke();

    const startYOffset = Math.ceil(vb.y / minorInterval);
    let tickIndexY = startYOffset;
    ctx.beginPath();
    for (let curY = startYOffset * minorInterval; curY <= vb.y + vb.height; curY += minorInterval, tickIndexY++) {
        const cy = Math.floor((curY - vb.y) * screenScale) + 0.5;
        if (cy < RULER_PX || cy > rect.height) continue;

        let tickW = tickIndexY % majorMult === 0 ? TICK_MAJOR_PX : (tickIndexY % mediumMult === 0 ? TICK_MEDIUM_PX : TICK_MINOR_PX);
        ctx.moveTo(RULER_PX, cy); ctx.lineTo(RULER_PX - tickW, cy);

        if (tickIndexY % majorMult === 0) {
            ctx.save();
            ctx.translate(2, cy + 2); ctx.rotate(-Math.PI / 2);
            ctx.fillText((Math.round(curY * 1e6) / 1e6).toString(), 0, 0);
            ctx.restore();
        }
    }
    ctx.stroke();
}
window.updateRulers = updateRulers;

