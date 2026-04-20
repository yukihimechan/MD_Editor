/**
 * SVG Shape Interaction Classes
 * Handles interaction logic (Selection, Resize, Rotate, Drag) using Inheritance.
 */

/**
 * Base SvgShape Class
 */
class SvgShape {
    constructor(el) {
        this.el = el; // SVG.js element
        this.node = el.node;

        // Store reference back to instance
        el.remember('_shapeInstance', this);
        this.hitArea = null;

        // [NEW] Control markers for shape manipulation
        this._controlMarkers = [];

        console.log(`[SvgShape] Created instance for ${el.type}#${el.id()}`);
    }

    /**
     * Common initialization logic
     */
    init() {
        const self = this;
        console.log(`[SvgShape] Initializing ${this.el.type}#${this.el.id()}`);

        // [NEW] 同期のため、子要素のポインターイベントを制御（グループの場合）
        if (this.el.type === 'g') {
            // グループ全体でクリックを受け取るように調整
            this.el.attr('pointer-events', 'all');
        }

        // [FIX] Revert to mousedown to avoid canceling SVGToolbar capture listener (mousedown)
        // Calling preventDefault on pointerdown cancels legacy mousedown in some cases.
        this.el.off('.svg_interaction');
        this.el.on('mousedown.svg_interaction', (e) => {
            self.onMouseDown(e);
        });

        // [FIX] Removed native dblclick.svg_interaction listener here.
        // We now rely on robust manual double-click detection inside onMouseDown to bypass 
        // issues caused by micro-shakes (dragmove) canceling browser native dblclicks.

        // [NEW] 同期リスナー (移動・リサイズ)
        this.el.on('dragmove.toolbar.svg_interaction resize.toolbar.svg_interaction', () => {
            if (window.updateTransformToolbarValues) window.updateTransformToolbarValues();
        });

        // [NEW] ヒットエリア拡張 (Canvas以外)
        if (!this.el.hasClass('svg-canvas-proxy')) {
            this.setupHitArea();

            // [NEW] ソースコードハイライト連携 (ホバー)
            this.el.on('mouseenter.svg_highlight', () => {
                let hoverTarget = this.el;
                let p = this.el.parent();
                while (p && p.type === 'g' && !p.hasClass('svg-canvas-proxy') && p.node !== this.el.root().node) {
                    if (p.remember('_shapeInstance')) {
                        hoverTarget = p;
                    }
                    p = p.parent();
                }

                window._hoveredSvgElement = hoverTarget;
                if (typeof window.updateSVGSourceHighlight === 'function') {
                    window.updateSVGSourceHighlight();
                }
            });
            this.el.on('mouseleave.svg_highlight', () => {
                let hoverTarget = this.el;
                let p = this.el.parent();
                while (p && p.type === 'g' && !p.hasClass('svg-canvas-proxy') && p.node !== this.el.root().node) {
                    if (p.remember('_shapeInstance')) {
                        hoverTarget = p;
                    }
                    p = p.parent();
                }

                if (window._hoveredSvgElement === hoverTarget) {
                    window._hoveredSvgElement = null;
                }
                if (typeof window.updateSVGSourceHighlight === 'function') {
                    window.updateSVGSourceHighlight();
                }
            });
        }
    }

    /**
     * Cleanup and destruction
     */
    destroy() {
        console.log(`[SvgShape] Destroying ${this.el.type}#${this.el.id()}`);

        // 1. Remove control markers
        this.clearControlMarkers();

        // 2. Remove hit area
        if (this.hitArea) {
            this.hitArea.off(); // Remove listeners on hitArea
            this.hitArea.remove();
            this.hitArea = null;
        }

        // 3. Remove event listeners
        this.el.off('.svg_interaction');
        if (this._rotateMoveHandler) {
            this.el.node.removeEventListener('rotatemove', this._rotateMoveHandler);
        }

        // [FIX] draggable 状態も明示的に解除
        if (typeof this.el.draggable === 'function') {
            this.el.draggable(false);
        }

        // 4. Remove library-specific data
        this.el.forget('_shapeInstance');
    }

    /**
     * [NEW] Clear all control markers
     */
    clearControlMarkers() {
        if (this._controlMarkers) {
            this._controlMarkers.forEach(m => m.remove());
            this._controlMarkers = [];
        }
    }

    /**
     * Set up hit area proxy (To be implemented by subclasses)
     */
    setupHitArea() { }

    /**
     * Update hit area transformation and geometry (To be implemented by subclasses)
     */
    updateHitArea() { }

    /**
     * Handling selection start
     */
    onMouseDown(e) {
        // [FIX] Ignore events on hidden elements
        if (!this.el.visible()) return;

        // [FIX] Robust manual double-click detection that ignores micro-shakes and dragmove cancellations
        const now = Date.now();
        if (this._lastMasterMouseDownTime && (now - this._lastMasterMouseDownTime < 500)) {
            this._lastMasterMouseDownTime = 0; // Reset to avoid triple-click registering as 2 dblclicks
            this.onDoubleClick(e);
        } else {
            this._lastMasterMouseDownTime = now;
        }

        // [NEW] グループ選択を優先するため、親を遡る
        let selectionTarget = this.el;
        let p = this.el.parent();

        while (p && p.type === 'g' && !p.hasClass('svg-canvas-proxy') && p.node !== this.el.root().node) {
            if (p.remember('_shapeInstance')) {
                selectionTarget = p;
            }
            p = p.parent();
        }

        // [FIX] Prevent event from bubbling to canvas proxy (which would trigger deselectAll)
        // [FIX-REVERT] e.preventDefault() をコメントアウト。フォーカスやブラウザの標準挙動を壊す可能性があるため。
        // e.preventDefault();
        e.stopPropagation();

        // [FIX] Detect if element is detached (Ghost element call from leaked listener)
        if (!this.el.node.isConnected) {
            this.el.off('.svg_interaction'); // Suicide listener
            return;
        }

        // [FIX] Allow bubbling so that preview area listeners can see the interaction
        // e.preventDefault(); 
        // e.stopPropagation(); 

        // Right click logic
        if (e.button === 2) {
            const isSelected = window.currentEditingSVG.selectedElements.has(this.el);
            if (isSelected) return;
        }

        const isMulti = e.shiftKey || e.ctrlKey;
        const isSelected = window.currentEditingSVG.selectedElements.has(this.el);

        if (isSelected && !isMulti) {
            let dragged = false;
            const detectDrag = () => { dragged = true; };
            this.el.on('dragmove.check', detectDrag);

            const upHandler = () => {
                this.el.off('dragmove.check', detectDrag);
                window.removeEventListener('mouseup', upHandler);
                if (!dragged) {
                    selectElement(selectionTarget, false);
                }
            };
            window.addEventListener('mouseup', upHandler);
        } else {
            selectElement(selectionTarget, isMulti);
        }

        // [FIX] Force clear resize state on any new interaction to prevent data persistence
        this._resizeState = null;
    }

    /**
     * [NEW] Handle double click for text editing
     */
    onDoubleClick(e) {
        e.stopPropagation();
        e.preventDefault();

        let targetTextEl = null;

        // [NEW] Check if the element itself is text or a group containing text
        if (this.el.type === 'text') {
            targetTextEl = this.el;
        } else if (this.el.type === 'g') {
            // [FIX] Manual parent search to avoid incompatible callback usage in SVG.js parent()
            let searchRoot = this.el;
            let current = this.el.parent();
            while (current && current.type && current.type !== 'svg' && current.node) {
                if (current.attr && current.attr('data-tool-id') === 'group') {
                    searchRoot = current;
                }
                current = current.parent();
            }

            const texts = Array.from(searchRoot.find('text'));

            // [DEBUG]
            let chain = [];
            let p = this.el;
            while (p && p.type && p !== p.root()) {
                const info = p.id() + (p.attr('data-tool-id') ? `(${p.attr('data-tool-id')})` : '');
                chain.push(info);
                p = p.parent();
            }
            console.log(`[SvgShape DEBUG] onDoubleClick in group ${this.el.id()}, Parent Chain: ${chain.reverse().join(' > ')}`);
            console.log(` - Texts in this group (${texts.length}):`, texts.map(t => ({
                id: t.id(),
                text: t.text().substring(0, 20),
                isConnected: t.node.isConnected,
                assocShape: t.attr('data-associated-shape-id')
            })));

            if (texts.length > 0) {
                // 1. [FIX] Prioritize association! (Crucial for F2 or if coordinates don't match)
                // Try to find if any child shape in this group is associated with one of these texts
                const shapes = Array.from(searchRoot.children());
                for (const child of shapes) {
                    const assocId = child.attr ? child.attr('data-associated-text-id') : null;
                    if (assocId) {
                        const found = texts.find(t => t.id() === assocId);
                        if (found) {
                            console.log(`[SvgShape DEBUG] Found prioritized text by association: ${assocId}`);
                            targetTextEl = found;
                            break;
                        }
                    }
                }

                // 1.5. [NEW] Reverse association check (Text pointing to this shape)
                if (!targetTextEl && this.el && this.el.id) {
                    const myId = this.el.id();
                    targetTextEl = texts.find(t => t.attr('data-associated-shape-id') === myId);
                    if (targetTextEl) {
                        console.log(`[SvgShape DEBUG] Found prioritized text by reverse association: ${targetTextEl.id()}`);
                    }
                }

                // 2. If no association found, find the text under the click (topmost first)
                if (!targetTextEl && e.clientX !== undefined && e.clientY !== undefined) {
                    for (let i = texts.length - 1; i >= 0; i--) {
                        const t = texts[i];
                        const rect = t.node.getBoundingClientRect();
                        if (e.clientX >= rect.left && e.clientX <= rect.right &&
                            e.clientY >= rect.top && e.clientY <= rect.bottom) {
                            targetTextEl = t;
                            break;
                        }
                    }
                }

                // 3. Fallback to first non-empty text, then just the topmost/last text
                if (!targetTextEl) {
                    targetTextEl = texts.find(t => t.text().trim().length > 0) || texts[texts.length - 1] || texts[0];
                }

                // 4. [NEW] Clean up zombie texts to proactively fix sync bugs
                if (targetTextEl && texts.length > 1) {
                    console.log(`[SvgShape DEBUG] Multiple texts found in group. Target selected: ${targetTextEl.id()}. Cleaning up zombies...`);
                    texts.forEach(t => {
                        if (t !== targetTextEl && t.node.isConnected) {
                            console.log(`[SvgShape DEBUG] Removed zombie text element: ${t.id()} with text: "${t.text()}"`);
                            t.remove();
                        }
                    });
                     // Heal links just in case
                    if (this.el.type !== 'text' && this.el.type !== 'g') {
                          this.el.attr('data-associated-text-id', targetTextEl.id());
                          targetTextEl.attr('data-associated-shape-id', this.el.id());
                    }
                }
            }
        }

        if (targetTextEl && window.SvgTextEditor) {
            window.SvgTextEditor.startEditing(targetTextEl);
            return;
        }

        // [FIX] Even if targetTextEl wasn't found above, check if this shape belongs to ANY group 
        // that already contains text. This prevents duplicate text creation if IDs are mismatched.
        const parent = this.el.parent();
        if (parent && parent.type === 'g') {
            const textsInGroup = Array.from(parent.find('text'));
            if (textsInGroup.length > 0) {
                // If it's a shape-text-group, prefer delegating to its shapeInstance if it exists
                if (parent.attr('data-tool-id') === 'shape-text-group') {
                    const parentShape = parent.remember('_shapeInstance');
                    if (parentShape) {
                        parentShape.onDoubleClick(e);
                        return;
                    }
                }
                // Fallback: Just edit the first text found in this generic group
                if (window.SvgTextEditor) {
                    window.SvgTextEditor.startEditing(textsInGroup[0]);
                    return;
                }
            }
        }

        // Try to find associated text element by attribute-linked ID
        const textId = this.el.attr('data-associated-text-id');
        let textEl = textId ? SVG('#' + textId) : null;

        // [FIX] Self-Healing Association
        // If the associated text element is NOT found, OR it is found but belongs to a DIFFERENT group, 
        // treat it as a broken link (common after copy-paste).
        let isBrokenAssociation = false;
        if (textEl) {
            const root = this.el.root();
            // Check if they share the same top-level group (or at least one common parent that isn't root)
            let commonParent = false;
            let p1 = this.el.parent();
            while (p1 && p1 !== root) {
                if (p1.node && textEl.node && p1.node.contains(textEl.node)) {
                    commonParent = true;
                    break;
                }
                p1 = p1.parent();
            }
            if (!commonParent) {
                console.warn(`[SvgShape] Detected cross-group association for ${this.el.id()} -> ${textId}. Healing...`);
                isBrokenAssociation = true;
                textEl = null;
            }
        } else if (textId) {
            isBrokenAssociation = true;
        }

        // [FIX] If association is broken, try to find an orphan text in the CURRENT group before creating a new one.
        if (isBrokenAssociation || !textEl) {
            const parent = this.el.parent();
            if (parent && parent.type === 'g') {
                const textsInGroup = Array.from(parent.find('text'));
                if (textsInGroup.length > 0) {
                    // Find the best orphan (one not already pointed to by another shape in the SAME group)
                    textEl = textsInGroup[0]; // For now, just take the first one available in group
                    console.log(`[SvgShape] Healed association by picking existing text in group: ${textEl.id()}`);

                    // Update attributes to fix the link
                    this.el.attr('data-associated-text-id', textEl.id());
                    textEl.attr('data-associated-shape-id', this.el.id());
                }
            }
        }

        // Verify it still exists and is connected
        if (textEl && (!textEl.node || !textEl.node.isConnected)) {
            textEl = null;
        }

        // Calculate target center coordinate in root SVG space
        const root = this.el.root();
        const rbox = root ? this.el.rbox(root) : null;
        const cx = rbox ? rbox.cx : 0;
        const cy = rbox ? rbox.cy : 0;

        if (!textEl) {
            if (!root) return;


            // Create placeholder text with explicit alignment attributes
            textEl = root.text(' ').font({ size: 20 }).fill('#000000');
            textEl.attr({
                'text-anchor': 'middle',
                'dominant-baseline': 'central'
            });
            textEl.center(cx, cy);

            // [NEW] 図形とテキストをグループ化
            const group = this.el.parent().group();
            group.attr({
                'data-tool-id': 'shape-text-group',
                'data-label': 'Shape with Text'
            });

            // 図形の直前にグループを挿入し、図形とテキストを中に入れる
            this.el.before(group);
            group.add(this.el);
            group.add(textEl);

            // 属性の紐付け
            const newId = 'text_' + Math.random().toString(36).substr(2, 9);
            textEl.id(newId);
            this.el.attr('data-associated-text-id', newId);
            textEl.attr('data-associated-shape-id', this.el.id());
            textEl.attr('data-tool-id', 'text');

            const oldShape = this;
            if (window.makeInteractive) {
                oldShape.destroy();
                window.makeInteractive(group);
                // [FIX] DO NOT call makeInteractive on textEl here because it's inside the group.
                // Making it interactive creates a redundant hitArea inside the group that can pull the 
                // group's BBox to (0,0) if not positioned perfectly/instantly.
                window.selectElement(group, false);
                
                // [NEW] グループ作成直後にも線幅・フォントサイズの維持設定を適用
                const newShape = group.remember('_shapeInstance');
                if (newShape && typeof newShape.syncStrokeTextScale === 'function') {
                    newShape.syncStrokeTextScale();
                }
            }
            if (window.syncChanges) window.syncChanges();
        } else {
        }

        // Start editing
        if (window.SvgTextEditor) {
            // [FIX] Always pass the intended SVG center point to ensure absolute accuracy.
            const center = { x: cx, y: cy };
            window.SvgTextEditor.startEditing(textEl, center);
        }
    }

    /**
     * Interface for enabling Selection UI (Resize/Rotate)
     * To be overridden by subclasses.
     */
    applySelectionUI(options) {
        throw new Error('applySelectionUI must be implemented by subclass');
    }

    /**
     * Common selection UI logic (Select and Resize)
     */
    _applySelectAndResize(options) {
        // [FIX] Ensure element is strictly linked to root before calling plugins in SVG.js v3
        if (!this.el.root() && window.currentEditingSVG && window.currentEditingSVG.draw) {
            if (!this.el.node.isConnected) {
                return;
            }
            delete this.el.node.instance; // Clear stale instance
            this.el = SVG(this.el.node); // Update this.el to the new linked instance
            this.el.remember('_shapeInstance', this); // RE-REGISTER ourself to the new instance
        }

        if (typeof this.el.select === 'function') {
            console.log(`[SVG Lib Call] ${this.el.id()}.select(`, options, `)`);
            this.el.select(options);
        }

        // [NEW] resizable: false 指定がある場合は以降のリサイズハンドル表示処理をスキップ
        if (options && options.resizable === false) {
            if (typeof this.el.resize === 'function') {
                this.el.resize(false); // [FIX] 明示的にリサイズプラグインをOFFにする
            }
            return;
        }

        // [LOCK GUARD] Disable resize handles for locked elements
        const isLocked = this.el.attr('data-locked') === 'true' || this.el.attr('data-locked') === true;
        if (isLocked) {
            return;
        }

        if (typeof this.el.resize === 'function') {
            console.log(`[SVG Lib Call] ${this.el.id()}.resize()`);
            this.el.resize();
        }

        // CSS transform deals with handles.
    }

    /**
     * [NEW] Cleanup selection UI listeners
     */
    clearSelectionUI() {
        if (this._rotationHandler) { this._rotationHandler.hide(); this._rotationHandler = null; }
        if (this._radiusHandler) { this._radiusHandler.hide(); this._radiusHandler = null; }
        if (this._polylineHandler) { this._polylineHandler.hide(); this._polylineHandler = null; }
        if (this._bubbleHandler) { this._bubbleHandler.hide(); this._bubbleHandler = null; }

        // [REMOVED] Event cleanup no longer needed for zoom
    }

}

/**
 * Standard Shape Class (Rect, Circle, etc.)
 */
class StandardShape extends SvgShape {
    init() {
        super.init();
        const el = this.el;

        // [FIX] プラグイン(svg.resize.min.js)側で行われる「標準的な幅／高さの再設定」などをキャンセル。
        // SvgShape 独自の resize.sync ハンドラでのみ完全なマトリクス操作を行うための措置。
        el.on('resize', (e) => {
            if (e && e.preventDefault && typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
        });

        el.on('resizestart.sync', (e) => {
            // [LOCK GUARD]
            const isLocked = this.el.attr('data-locked') === 'true' || this.el.attr('data-locked') === true;
            if (isLocked) {
                console.warn(`[LOCK GUARD] Resize blocked for ${this.el.id()}`);
                if (e.preventDefault) e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                return;
            }
            this._isResizing = true;
            this.handleResizeStart(e);
        });
        el.on('resize.sync', (e) => {
            if (!this._isResizing || !this._resizeState) {
                this._isResizing = true;
                this.handleResizeStart(e);
            }
            this.handleResizeMirroring(e);

            this.updateHitArea();
            this.syncSelectionHandlers();

            if (window.updateTransformToolbarValues) window.updateTransformToolbarValues();
        });

        el.off('resizedone');
        el.on('resizedone', (e) => {
            this.handleResizeDone(e);
        });

        // Cleanup on remove
        el.on('remove', () => {
            if (this.hitArea) this.hitArea.remove();
        });

        if (typeof el.draggable === 'function') {
            el.draggable();

            // Store initial states for group dragging
            let selectionStates = new Map();
            let startDragX = 0;
            let startDragY = 0;

            el.on('beforedrag', (e) => {
                // [LOCK GUARD]
                const isLocked = el.attr('data-locked') === 'true' || el.attr('data-locked') === true;
                if (isLocked) {
                    console.warn(`[LOCK GUARD] Drag blocked for ${el.id()}`);
                    e.preventDefault();
                    return;
                }

                const ev = e.detail ? (e.detail.event || e) : e;
                if (!ev || typeof ev.clientX === 'undefined') return;
                startDragX = ev.clientX;
                startDragY = ev.clientY;

                const isCtrl = (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed) || ev.ctrlKey;

                selectionStates.clear();

                // [NEW] Ctrl複製: ドラッグ開始時にCtrlが押されていれば複製を作成して選択する
                if (isCtrl) {
                    // [FIX] Zオーダー（DOM上の順序）でソートしてから複製することで、複製後の前後関係を維持する
                    const originalElements = Array.from(window.currentEditingSVG.selectedElements)
                        .filter(item => !item.hasClass('svg-canvas-proxy') && item.node && item.node.isConnected)
                        .sort((a, b) => {
                            if (a.node.parentNode !== b.node.parentNode) return 0;
                            const indexA = Array.from(a.node.parentNode.children).indexOf(a.node);
                            const indexB = Array.from(b.node.parentNode.children).indexOf(b.node);
                            return indexA - indexB;
                        });

                    if (originalElements.length > 0) {
                        const clones = [];
                        const svg = window.currentEditingSVG.draw;

                        // 全選択を解除してから複製を選択し直す
                        deselectAll();

                        originalElements.forEach(item => {
                            // SVGノードを複製して同じ親に追加
                            const cloneNode = item.node.cloneNode(true);
                            // 新しいIDを付与してIDの重複を防ぐ
                            const newId = 'SvgjsClone' + Date.now() + Math.floor(Math.random() * 10000);
                            cloneNode.setAttribute('id', newId);
                            // 複製されたIDも一意にする（子要素も含む）
                            cloneNode.querySelectorAll('[id]').forEach(child => {
                                child.setAttribute('id', child.getAttribute('id') + '_c' + Math.floor(Math.random() * 10000));
                            });

                            // [FIX] insertBefore ではなく appendChild (または parentNode.add) で最前面に追加する
                            // ただし、グループ内での複製ならそのグループの末尾へ
                            item.node.parentNode.appendChild(cloneNode);
                            const cloneEl = SVG(cloneNode);

                            // [FIX] 確実に最前面へ
                            cloneEl.front();

                            // インタラクティブにして選択する
                            makeInteractive(cloneEl);
                            selectElement(cloneEl, clones.length > 0);
                            clones.push(cloneEl);
                        });

                        // 複製した要素の状態を selectionStates に登録
                        window.currentEditingSVG.selectedElements.forEach(item => {
                            if (item.hasClass('svg-canvas-proxy')) return;
                            // [FIX] 接続チェック
                            if (!item.node || !item.node.isConnected) return;

                            selectionStates.set(item.node, {
                                matrix: new SVG.Matrix(item),
                                x: item.x(),
                                y: item.y(),
                                rbox: item.rbox(item.root())
                            });
                        });
                    }
                } else {
                    // 通常: 選択要素の初期状態を記録
                    window.currentEditingSVG.selectedElements.forEach(item => {
                        if (item.hasClass('svg-canvas-proxy')) return;
                        // [FIX] DOMに接続されていない要素（削除済みなど）はスキップする
                        if (!item.node || !item.node.isConnected) return;

                        // [NEW] Capture textPath offset state if this is text on a path
                        let startOffsetAttr = null;
                        if (item.type === 'text') {
                            const tp = item.node.querySelector('textPath');
                            if (tp) startOffsetAttr = tp.getAttribute('startOffset') || '0%';
                        }

                        selectionStates.set(item.node, {
                            matrix: new SVG.Matrix(item),
                            x: item.x(),
                            y: item.y(),
                            rbox: item.rbox(item.root()),
                            startOffsetAttr: startOffsetAttr,
                            startOffset: parseFloat(startOffsetAttr) || 0
                        });

                        // [NEW] Text -> Shape sync: capture associated shape state if only text is selected
                        const shapeId = item.attr('data-associated-shape-id');
                        const assocShape = shapeId ? SVG('#' + shapeId) : null;
                        if (assocShape && assocShape.node && assocShape.node.isConnected) {
                            if (!selectionStates.has(assocShape.node)) {
                                selectionStates.set(assocShape.node, {
                                    matrix: new SVG.Matrix(assocShape),
                                    x: assocShape.x(),
                                    y: assocShape.y(),
                                    rbox: assocShape.rbox(assocShape.root())
                                });
                            }
                        }

                        // [NEW] Shape -> Text sync: capture associated text state
                        const textId = item.attr('data-associated-text-id');
                        const assocText = textId ? SVG('#' + textId) : null;
                        if (assocText && assocText.node && assocText.node.isConnected) {
                            if (!selectionStates.has(assocText.node)) {
                                selectionStates.set(assocText.node, {
                                    matrix: new SVG.Matrix(assocText),
                                    x: assocText.x(),
                                    y: assocText.y(),
                                    rbox: assocText.rbox(assocText.root())
                                });
                            }
                        }
                    });
                }

                // Reset axis lock
                const shape = el.remember('_shapeInstance');
                if (shape) {
                    shape._dragLockAxis = null;
                    shape._dragLockAxisFinalized = false;
                    shape._isActuallyMoved = false; // [NEW] Reset move flag
                }
            });

            el.on('dragmove', function (e) {
                e.preventDefault();
                const { event } = e.detail;
                const svg = this.root();
                if (!svg) return;

                const p = svg.point(event.clientX, event.clientY);
                const sp = svg.point(startDragX, startDragY);
                const shape = this.remember('_shapeInstance');

                const scale = window.SVGUtils && window.SVGUtils.getTransformScale ? window.SVGUtils.getTransformScale(svg.node) : 1;
                const screenDist = Math.sqrt((event.clientX - startDragX) ** 2 + (event.clientY - startDragY) ** 2);

                let dx = p.x - sp.x;
                let dy = p.y - sp.y;

                // [NEW] Drag Threshold (Dead Zone): Ignore movements less than 3 screen pixels
                const deadZone = 3;
                let isActuallyMoving = screenDist >= deadZone;

                if (!isActuallyMoving) {
                    dx = 0;
                    dy = 0;
                } else if (shape) {
                    shape._isActuallyMoved = true; // [NEW] Mark as moved
                }

                const isShift = (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed) || event.shiftKey;
                const isSnapEnabled = typeof window.SVGUtils !== 'undefined' ? window.SVGUtils.isSnapEnabled(event) : ((window.currentEditingSVG && window.currentEditingSVG.isAltPressed) || event.altKey);

                // Shift押下時: 水平・垂直移動の制限 (座標比較スナップ方式)
                if (isShift && shape && isActuallyMoving) {
                    const lockThreshold = 15; // 固定エリアの境界
                    // screenDist は既に計算済み
                    if (screenDist < lockThreshold) {
                        // 【再判定・スナップエリア】マウス座標を比較し、変位の大きい方に「即座に」スナップ
                        // このエリア内では finalize しないため、マウスを振るだけで軸が入れ替わる
                        shape._dragLockAxis = (Math.abs(dx) >= Math.abs(dy)) ? 'h' : 'v';
                        shape._dragLockAxisFinalized = false;
                    } else {
                        // 【ロックエリア】境界を超えた瞬間の dx, dy で軸を最終固定
                        if (!shape._dragLockAxisFinalized) {
                            shape._dragLockAxis = (Math.abs(dx) >= Math.abs(dy)) ? 'h' : 'v';
                            shape._dragLockAxisFinalized = true;
                            console.log(`[SHIFT DRAG] Axis Fixed to ${shape._dragLockAxis} at dist ${screenDist.toFixed(1)}px`);
                        }
                    }

                    // 決定された軸に基づいて移動を強制（バイナリスナップ）
                    if (shape._dragLockAxis === 'h') dy = 0;
                    else if (shape._dragLockAxis === 'v') dx = 0;
                } else if (shape) {
                    shape._dragLockAxis = null;
                    shape._dragLockAxisFinalized = false;
                }

                const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
                const snapSize = gridConfig.size || 15;

                // Alt押下時: スナップ座標の計算
                if (isSnapEnabled && snapSize > 0 && isActuallyMoving) {
                    let mainState = selectionStates.get(el.node);

                    // [FIX] Ctrl+Drag (複製)時は元の要素(el)が選択解除されているため、最初の選択状態にフォールバックする
                    if (!mainState && selectionStates.size > 0) {
                        mainState = selectionStates.values().next().value;
                    }

                    if (mainState && mainState.rbox) {
                        const predictedX = mainState.rbox.x + dx;
                        const predictedY = mainState.rbox.y + dy;
                        const snappedX = Math.round(predictedX / snapSize) * snapSize;
                        const snappedY = Math.round(predictedY / snapSize) * snapSize;
                        dx = snappedX - mainState.rbox.x;
                        dy = snappedY - mainState.rbox.y;
                    }
                }

                // [NEW] Smart Snapping (Object-to-Object)
                if (window.currentEditingSVG && !isSnapEnabled && isActuallyMoving) {
                    let mainState = selectionStates.get(el.node);
                    if (!mainState && selectionStates.size > 0) {
                        mainState = selectionStates.values().next().value;
                    }

                    if (mainState && mainState.rbox) {
                        // 1. Calculate moving box after initial DX/DY (Shift alignment)
                        const movingRBox = {
                            x: mainState.rbox.x + dx,
                            y: mainState.rbox.y + dy,
                            width: mainState.rbox.width,
                            height: mainState.rbox.height,
                            x2: mainState.rbox.x + dx + mainState.rbox.width,
                            y2: mainState.rbox.y + dy + mainState.rbox.height,
                            cx: mainState.rbox.x + dx + mainState.rbox.width / 2,
                            cy: mainState.rbox.y + dy + mainState.rbox.height / 2
                        };

                        // 2. Identify target elements (all interactive elements except selected ones)
                        const targetBoxes = [];
                        const root = this.root();

                        // [NEW] Identify IDs of elements currently being moved to exclude connected lines
                        const movingIds = new Set();
                        selectionStates.forEach((state, node) => {
                            if (node.id) movingIds.add(node.id);
                        });

                        // [NEW] Add Canvas (Paper) edges and center as snap targets
                        const svgEdit = window.currentEditingSVG;
                        if (svgEdit && !isNaN(svgEdit.baseWidth)) {
                            targetBoxes.push({
                                x: svgEdit.baseX,
                                y: svgEdit.baseY,
                                width: svgEdit.baseWidth,
                                height: svgEdit.baseHeight,
                                x2: svgEdit.baseX + svgEdit.baseWidth,
                                y2: svgEdit.baseY + svgEdit.baseHeight,
                                cx: svgEdit.baseX + svgEdit.baseWidth / 2,
                                cy: svgEdit.baseY + svgEdit.baseHeight / 2
                            });
                        }

                        root.children().each(function (child) {
                            // [FIX] Strict Exclusion Logic
                            // 1. Exclude currently dragging/selected elements
                            if (selectionStates.has(child.node)) return;

                            // [NEW] Exclude lines/arrows connected to the current moving set
                            // (Prevents snapping to objects that are moving with us)
                            const tagName = child.node.tagName.toLowerCase();
                            if (['polyline', 'line', 'path'].includes(tagName)) {
                                const connStr = child.attr('data-connections');
                                if (connStr) {
                                    try {
                                        const conns = JSON.parse(connStr);
                                        if (conns.some(c => movingIds.has(c.targetId))) {
                                            // This line is connected to a moving element, skip it
                                            return;
                                        }
                                    } catch (e) { }
                                }
                            }

                            // 2. Exclude elements marked as internal or components lacking tool ID
                            // [FIX] Any element without 'data-tool-id' is likely an internal editor component
                            // (Grid lines, Guides, Selection UI, orphaned groups, etc.) and should NOT be snappable.
                            const toolId = child.attr('data-tool-id');
                            const isInternal = child.attr('data-internal') === 'true';

                            if (isInternal || (!toolId && tagName !== 'canvas')) {
                                return;
                            }

                            // 3. Exclude all tool-related components by class
                            const classes = child.attr('class') || '';
                            const isTool = classes.includes('svg_select') ||
                                classes.includes('svg-select') ||
                                classes.includes('svg_interaction') ||
                                classes.includes('svg-canvas-proxy') ||
                                classes.includes('svg-snap-guides') ||
                                classes.includes('svg-control-marker') ||
                                classes.includes('handle-group') ||
                                classes.includes('hitarea') ||
                                classes.includes('svg-grid');

                            if (isTool) return;

                            // 4. Skip strictly internal or empty groups
                            if (['defs', 'style', 'marker', 'symbol', 'metadata', 'script'].includes(tagName)) return;
                            if (tagName === 'g' && !child.hasClass('radius-handle-group') && child.children().length === 0) return;

                            // 5. Validate physical presence and size
                            try {
                                const box = child.rbox(root);
                                if (box.width > 0 || box.height > 0) {
                                    // [NEW] Add label for easier logging
                                    const idLabel = child.attr('id') || tagName;
                                    box.label = toolId ? `${toolId}#${idLabel}` : idLabel;
                                    targetBoxes.push(box);
                                }
                            } catch (err) { }
                        });

                        // [NEW] Enabled debug log for verification
                        if (targetBoxes.length > 0) {
                            const targets = targetBoxes.map(b => b.label || 'Canvas');
                            console.log(`[SNAP] Potential targets (${targetBoxes.length}):`, targets);
                        }

                        // 3. Find snap
                        const snap = window.SVGUtils.findSmartSnap(movingRBox, targetBoxes, 8);
                        if (snap) {
                            dx += snap.dx;
                            dy += snap.dy;
                            window.currentEditingSVG.showGuides(snap.guidesV, snap.guidesH);
                        } else {
                            window.currentEditingSVG.hideGuides();
                        }
                    }
                } else if (window.currentEditingSVG) {
                    window.currentEditingSVG.hideGuides();
                }

                // 1. 全ての選択要素の移動（トランスフォーム適用）を優先
                selectionStates.forEach((state, node) => {
                    const item = SVG(node);
                    if (!item) return;

                    let isTextPathSlide = false;
                    if (item.type === 'text') {
                        const tp = item.node.querySelector('textPath');
                        if (tp) {
                            const pathHref = tp.getAttribute('href') || tp.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                            let targetShapeNode = null;
                            let pathLen = 1000;

                            if (pathHref) {
                                targetShapeNode = document.querySelector(pathHref);
                                if (targetShapeNode && typeof targetShapeNode.getTotalLength === 'function') {
                                    try {
                                        pathLen = targetShapeNode.getTotalLength() || 1000;
                                    } catch (e) {
                                        console.warn("[TextPath] getTotalLength failed:", e);
                                    }
                                }
                            }

                            // [FIX] Ensure the base shape is NOT also being moved.
                            // If both are moving, we should just transform both normally.
                            if (targetShapeNode && !selectionStates.has(targetShapeNode)) {
                                isTextPathSlide = true;
                                const isPercent = state.startOffsetAttr && state.startOffsetAttr.includes('%');
                                const slideDelta = dx + dy;
                                const loops = parseInt(targetShapeNode.getAttribute('data-loops')) || 1;
                                const logicalPathLen = pathLen / loops;

                                if (isPercent) {
                                    const logicalPercent = 100 / loops;
                                    let newPct = state.startOffset + (slideDelta / pathLen * 100);
                                    let wrapped = ((newPct % logicalPercent) + logicalPercent) % logicalPercent;
                                    if (loops > 1) {
                                        wrapped += Math.floor(loops / 2) * logicalPercent;
                                    }
                                    tp.setAttribute('startOffset', wrapped.toFixed(2) + '%');
                                } else {
                                    let newOff = state.startOffset + slideDelta;
                                    let wrapped = ((newOff % logicalPathLen) + logicalPathLen) % logicalPathLen;
                                    if (loops > 1) {
                                        wrapped += Math.floor(loops / 2) * logicalPathLen;
                                    }
                                    tp.setAttribute('startOffset', wrapped.toFixed(2));
                                }
                            }
                        }
                    }

                    if (!isTextPathSlide) {
                        const newMatrix = new SVG.Matrix().translate(dx, dy).multiply(state.matrix);
                        item.matrix(newMatrix);
                    }

                    const shape = item.remember('_shapeInstance');
                    if (shape && shape.updateHitArea) shape.updateHitArea();
                    if (shape && typeof shape.syncSelectionHandlers === 'function') shape.syncSelectionHandlers();
                    if (shape && typeof shape.syncStrokeTextScale === 'function') shape.syncStrokeTextScale();
                });

                // 2. 移動完了後に全ての接続を更新
                if (window.SVGConnectorManager) {
                    selectionStates.forEach((state, node) => {
                        const item = SVG(node);
                        if (item) {
                            window.SVGConnectorManager.updateConnectionsFromElement(item);
                        }
                    });
                }

                // [NEW] Debug Log: Movement (Shape state and mouse coords)
                if (window.currentEditingSVG) {
                    const visual = this.rbox(this.root());
                    console.log(`[SVG DRAG DEBUG] Mouse(${event.clientX}, ${event.clientY}) | Shape ${this.id()}: pos(${visual.x.toFixed(1)}, ${visual.y.toFixed(1)}), size(${visual.width.toFixed(1)}x${visual.height.toFixed(1)})`);
                }

                if (window.updateTransformToolbarValues) {
                    window.updateTransformToolbarValues();
                }
            });

            // Sync on end
            el.off('dragend');
            el.on('dragend', (e) => {
                const shape = el.remember('_shapeInstance');
                if (window.currentEditingSVG) window.currentEditingSVG.hideGuides();
                if (shape && shape._isActuallyMoved) {
                    syncChanges(true);
                }
                selectionStates.clear();
            });

            el.off('resizedone');
            // [REMOVED] Redundant/Conflict with resizedone.sync above
        }
    }

    /**
     * [NEW] Get clean bounding box excluding interaction specific helper elements.
     * For groups, calculates the union of visible children.
     */
    getCleanBBox() {
        // [FORCE REFLOW] Get latest layout from browser
        try { this.node.getBBox(); } catch (e) { }

        if (this.el.type !== 'g') {
            let bbox;
            try {
                bbox = this.node.getBBox();
            } catch (e) {
                bbox = { x: 0, y: 0, width: 0, height: 0 };
            }

            // [FIX] Recover from browser's 0,0 bbox bug for clipped TextPath (e.g. text completely overflowing path)
            if (this.el.type === 'text' && (bbox.width === 0 || bbox.height === 0)) {
                const tp = this.node.querySelector('textPath');
                if (tp) {
                    const href = tp.getAttribute('href') || tp.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                    if (href && href.startsWith('#')) {
                        const targetShape = document.getElementById(href.substring(1));
                        if (targetShape && typeof targetShape.getBBox === 'function') {
                            try {
                                const tBox = targetShape.getBBox();
                                if (tBox.width > 0 && tBox.height > 0) {
                                    bbox = tBox;
                                }
                            } catch (e) { }
                        }
                    }
                }
            }
            return bbox;
        }

        const children = this.el.children().filter(c => {
            const tag = c.node.tagName.toLowerCase();
            const isInternal = c.hasClass('svg-interaction-hitarea') ||
                c.hasClass('svg-select-handle') ||
                c.hasClass('rotation-handle-group') ||
                c.attr('data-internal') === 'true';
            // [FIX] Filter out non-renderable elements that don't support getBBox()
            const isNonRenderable = ['defs', 'style', 'marker', 'symbol', 'metadata', 'script', 'title', 'desc'].includes(tag);
            return !isInternal && !isNonRenderable;
        });

        if (children.length === 0) {
            try {
                return this.node.getBBox();
            } catch (e) {
                return { x: 0, y: 0, width: 0, height: 0 };
            }
        }

        let bbox = null;
        for (let i = 0; i < children.length; i++) {
            const childBox = children[i].bbox().transform(children[i].matrix());
            // [FIX] Ignore buggy 0-size bbox from textPath children stretching the group frame to 0,0
            if (childBox.width > 0 || childBox.height > 0) {
                if (!bbox) bbox = childBox;
                else bbox = bbox.merge(childBox);
            }
        }

        if (!bbox) {
            try {
                return this.node.getBBox();
            } catch (e) {
                return { x: 0, y: 0, width: 0, height: 0 };
            }
        }
        return bbox;
    }

    handleResizeStart(e) {
        // [LOCK GUARD] Re-check at start of resize
        const isLocked = this.el.attr('data-locked') === 'true' || this.el.attr('data-locked') === true;
        if (isLocked) {
            console.warn(`[LOCK GUARD] handleResizeStart aborted for ${this.el.id()}`);
            this._isResizing = false;
            return;
        }

        console.log('[RESIZE START] Detail:', e.detail);
        const el = this.el;
        const parent = el.parent() || el.root();

        // [V20] Strict cleanup of any stale state before starting
        this._resizeState = null;
        this._isResizing = true;

        // [V13] Capture initial state perfectly at the start
        const mStart = el.matrix();
        const localBBox = el.node.getBBox(); // Untransformed geometry

        const { event } = e.detail || {};
        if (!event) return;

        // Map mouse to the shape's initial local coordinate system
        let mInv;
        try {
            mInv = mStart.inverse();
        } catch (err) {
            console.warn('[DEBUG-RESIZE] Matrix not invertible', err);
            return;
        }

        const startMouseLocal = (parent.point(event.clientX, event.clientY)).transform(mInv);

        // [V21] Selective attribute capture based on type to avoid data contamination
        const initialAttrs = {};
        const type = el.type;
        const keys = (['polyline', 'path', 'polygon'].includes(type)) ? ['points', 'd'] :
            (['circle', 'ellipse'].includes(type)) ? ['cx', 'cy', 'rx', 'ry', 'r'] :
                (['line'].includes(type)) ? ['x1', 'y1', 'x2', 'y2'] :
                    ['x', 'y', 'width', 'height'];

        keys.forEach(k => {
            const val = el.attr(k);
            if (val !== undefined && val !== null) initialAttrs[k] = val;
        });

        const initVisual = el.rbox(el.root());

        // [V18] Improved Side/Corner detection using handle classes at the START
        const hElem = event.target.closest && event.target.closest('[class*="svg_select_handle"], [class*="svg-select-handle"]');
        const hCls = hElem ? (hElem.getAttribute('class') || '') : (event.target.getAttribute('class') || '');

        // Match all potential side/corner suffixes and pick the most specific
        // Supports: tl, tr, bl, br, lt, rt, lb, rb, nw, ne, sw, se, t, b, l, r, n, s, w, e
        const allMatches = hCls.match(/svg[-_]select[-_]handle[-_](tl|tr|bl|br|lt|rt|lb|rb|nw|ne|sw|se|t|b|l|r|n|s|w|e)\b/g);
        let side = null;
        if (allMatches) {
            // Find 2-char match (corner) first
            const cornerMatch = allMatches.find(m => /[-_](tl|tr|bl|br|lt|rt|lb|rb|nw|ne|sw|se)\b/.test(m));
            if (cornerMatch) {
                side = cornerMatch.match(/[-_](tl|tr|bl|br|lt|rt|lb|rb|nw|ne|sw|se)\b/)[1];
            } else {
                const sideMatch = allMatches[0].match(/[-_](t|b|l|r|n|s|w|e)\b/);
                if (sideMatch) side = sideMatch[1];
            }
        }

        // console.log(`[SVG RESIZE START] Target: <${event.target.tagName}>, Handle: "${hCls}", DetectedSide: ${side || 'corner'}`);
        // console.log(`[SVG RESIZE START] Matrix: ${mStart.toString()}`);
        // console.log(`[SVG RESIZE START] BBox: x=${localBBox.x}, y=${localBBox.y}, w=${localBBox.width}, h=${localBBox.height}`);

        this._resizeState = {
            mStart,
            localBBox,
            initialAttrs,
            initialVisual: { x: initVisual.x, y: initVisual.y, w: initVisual.width, h: initVisual.height },
            startMouseLocal,
            side: side, // Capturing side at start
            frameCounter: 0,
            localPivotX: undefined,
            localPivotY: undefined,
            startDistX: 1,
            startDistY: 1
        };

        // [V20] Add robust window-level safety to end the operation
        const self = this;
        const globalUpHandler = (e) => {
            if (self._isResizing) {
                self.handleResizeDone(e);
            }
            window.removeEventListener('mouseup', globalUpHandler);
        };
        window.addEventListener('mouseup', globalUpHandler);
    }

    /**
     * [NEW] グループ要素をスナップ先の座標とサイズに適合させる
     */
    _updateGroupToFitBox(tgtX, tgtY, tgtW, tgtH) {
        if (!this.el || this.el.type !== 'g') return;
        
        let currentW = 0, currentH = 0, currentX = 0, currentY = 0;
        
        let bgShape = null;
        if (this.el.attr('data-tool-id') === 'shape-text-group') {
            this.el.children().forEach(ch => {
                if (!bgShape && ch.type !== 'text' && ch.type !== 'defs' && ch.type !== 'title' && ch.type !== 'desc' && !ch.hasClass('svg-interaction-hitarea')) {
                    bgShape = ch;
                }
            });
        }
        
        const targetBBoxElem = bgShape || this.el;
        if (targetBBoxElem.type === 'g') {
            const bbox = targetBBoxElem.bbox();
            currentX = bbox.x;
            currentY = bbox.y;
            currentW = bbox.width;
            currentH = bbox.height;
        } else if (['rect', 'image', 'svg'].includes(targetBBoxElem.type)) {
            currentX = parseFloat(targetBBoxElem.attr('x') || 0);
            currentY = parseFloat(targetBBoxElem.attr('y') || 0);
            currentW = parseFloat(targetBBoxElem.attr('width') || 0);
            currentH = parseFloat(targetBBoxElem.attr('height') || 0);
        } else if (['ellipse', 'circle'].includes(targetBBoxElem.type)) {
            const rx = parseFloat(targetBBoxElem.attr('rx') || targetBBoxElem.attr('r') || 0);
            const ry = parseFloat(targetBBoxElem.attr('ry') || targetBBoxElem.attr('r') || 0);
            const cx = parseFloat(targetBBoxElem.attr('cx') || 0);
            const cy = parseFloat(targetBBoxElem.attr('cy') || 0);
            currentX = cx - rx;
            currentY = cy - ry;
            currentW = rx * 2;
            currentH = ry * 2;
        } else {
            const bbox = targetBBoxElem.bbox();
            currentX = bbox.x;
            currentY = bbox.y;
            currentW = bbox.width;
            currentH = bbox.height;
        }

        if (currentW === 0 || currentH === 0) return;
        
        const scaleX = tgtW / currentW;
        const scaleY = tgtH / currentH;
        const dx = tgtX - (currentX * scaleX);
        const dy = tgtY - (currentY * scaleY);
        
        const transformString = `matrix(${scaleX}, 0, 0, ${scaleY}, ${dx}, ${dy})`;
        this.el.attr('transform', transformString);
        
        // ベイクして子要素にサイズ・座標を焼き付ける
        this.bakeTransformation(true);
    }

    /**
     * [V20] Unified completion handler for resize
     */
    handleResizeDone(e) {
        if (!this._resizeState) {
            this._isResizing = false;
            return;
        }

        try {
            // Bake transformation into geometry attributes
            this.bakeTransformation();

            this.updateHitArea();
            this.syncSelectionHandlers();

            // [V21] Refresh library selection UI to match new geometry and cleared matrix
            const sh = this.el.remember('_selectHandler');
            if (sh && typeof sh.mutationHandler === 'function') {
                try {
                    sh.mutationHandler();
                } catch (me) {
                    console.warn('[SVG RESIZE] mutationHandler update skipped:', me);
                    // 選択ハンドラが壊死した場合の復旧措置
                    setTimeout(() => {
                        if (window.selectElement) {
                            window.selectElement(this.el, false, true); 
                        }
                    }, 0);
                }
            }

            // グリッドスナップ設定とAltキーの状態でスナップを判定
            const isSnapEnabled = typeof window.SVGUtils !== 'undefined' ? window.SVGUtils.isSnapEnabled(e || window.event) : false;
            
            console.log('[RESIZE DONE] isSnapEnabled=', isSnapEnabled);

            if (isSnapEnabled && typeof AppState !== 'undefined' && AppState.config && AppState.config.grid) {
                const elType = this.el.type;
                if (['rect', 'image', 'svg', 'g'].includes(elType)) {
                    const snapSize = AppState.config.grid.size || 15;
                    const el = this.el;

                    // 焼き込み後の属性を取得
                    let x = parseFloat(el.attr('x') || 0);
                    let y = parseFloat(el.attr('y') || 0);
                    let width = parseFloat(el.attr('width') || 0);
                    let height = parseFloat(el.attr('height') || 0);
                    
                    if (elType === 'g') {
                        let bgShape = null;
                        if (el.attr('data-tool-id') === 'shape-text-group') {
                            el.children().forEach(ch => {
                                if (!bgShape && ch.type !== 'text' && ch.type !== 'defs' && ch.type !== 'title' && ch.type !== 'desc' && !ch.hasClass('svg-interaction-hitarea')) {
                                    bgShape = ch;
                                }
                            });
                        }
                        
                        const targetBBoxElem = bgShape || el;
                        if (targetBBoxElem.type === 'g') {
                            const bbox = targetBBoxElem.bbox();
                            x = bbox.x;
                            y = bbox.y;
                            width = bbox.width;
                            height = bbox.height;
                        } else if (['rect', 'image', 'svg'].includes(targetBBoxElem.type)) {
                            x = parseFloat(targetBBoxElem.attr('x') || 0);
                            y = parseFloat(targetBBoxElem.attr('y') || 0);
                            width = parseFloat(targetBBoxElem.attr('width') || 0);
                            height = parseFloat(targetBBoxElem.attr('height') || 0);
                        } else if (['ellipse', 'circle'].includes(targetBBoxElem.type)) {
                            const rx = parseFloat(targetBBoxElem.attr('rx') || targetBBoxElem.attr('r') || 0);
                            const ry = parseFloat(targetBBoxElem.attr('ry') || targetBBoxElem.attr('r') || 0);
                            const cx = parseFloat(targetBBoxElem.attr('cx') || 0);
                            const cy = parseFloat(targetBBoxElem.attr('cy') || 0);
                            x = cx - rx;
                            y = cy - ry;
                            width = rx * 2;
                            height = ry * 2;
                        } else {
                            const bbox = targetBBoxElem.bbox();
                            x = bbox.x;
                            y = bbox.y;
                            width = bbox.width;
                            height = bbox.height;
                        }
                    }

                    // イベントまたはリサイズ状態からリサイズハンドルのタイプを取得
                    // e.detailがある場合はイベントから、ない場合は_resizeStateから取得
                    let eventType = '';
                    if (e && e.detail && e.detail.handler && e.detail.handler.eventType) {
                        eventType = e.detail.handler.eventType;
                    } else if (this._resizeState && this._resizeState.side) {
                        eventType = this._resizeState.side;
                    }
                    console.log('[SNAP DONE] eventType:', eventType);

                    // リサイズハンドルの種類に応じて、固定する辺を基準にスナップ
                    let snappedX = x;
                    let snappedY = y;
                    let snappedW = width;
                    let snappedH = height;

                    if (eventType.includes('t')) {
                        // 上ハンドル: 下端(y + h)を固定
                        const fixedBottom = y + height;
                        snappedY = Math.round(y / snapSize) * snapSize;
                        snappedH = fixedBottom - snappedY; // 下端を固定するため、hはスナップしない
                    } else if (eventType.includes('b')) {
                        // 下ハンドル: 上端(y)を固定、下端をスナップ
                        const fixedTop = y;
                        const snappedBottom = Math.round((y + height) / snapSize) * snapSize;
                        snappedH = snappedBottom - fixedTop; // 下端をスナップ
                    }
                    // else: 垂直方向のハンドルがない場合はy, hを変更しない

                    if (eventType.includes('l')) {
                        // 左ハンドル: 右端(x + w)を固定
                        const fixedRight = x + width;
                        snappedX = Math.round(x / snapSize) * snapSize;
                        snappedW = fixedRight - snappedX; // 右端を固定するため、wはスナップしない
                    } else if (eventType.includes('r')) {
                        // 右ハンドル: 左端(x)を固定、右端をスナップ
                        const fixedLeft = x;
                        const snappedRight = Math.round((x + width) / snapSize) * snapSize;
                        snappedW = snappedRight - fixedLeft; // 右端をスナップ
                    }
                    // else: 水平方向のハンドルがない場合はx, wを変更しない

                    console.log('[SNAP DONE] Before:', { x: x.toFixed(2), y: y.toFixed(2), w: width.toFixed(2), h: height.toFixed(2) });

                    // 浮動小数点演算の誤差を除去するため、座標を整数化
                    snappedX = Math.round(snappedX);
                    snappedY = Math.round(snappedY);

                    console.log('[SNAP DONE] After:', { x: snappedX, y: snappedY, w: snappedW, h: snappedH });

                    // 属性を直接設定
                    console.log('[SNAP] Setting attributes...');
                    if (elType === 'g') {
                        // グループの場合は transform scale でスナップを再現（bakeTransformationの前に行うのが理想だが、後ろでも機能する）
                        // 実際には子要素を一括で移動・リサイズする
                        this._updateGroupToFitBox(snappedX, snappedY, snappedW, snappedH);
                    } else {
                        el.attr({
                            x: snappedX,
                            y: snappedY,
                            width: snappedW,
                            height: snappedH
                        });
                    }

                    // 設定後の実際の値を確認
                    const actualX = parseFloat(el.attr('x'));
                    const actualY = parseFloat(el.attr('y'));
                    const actualW = parseFloat(el.attr('width'));
                    const actualH = parseFloat(el.attr('height'));
                    console.log('[SNAP] Attributes set to:', { x: actualX, y: actualY, w: actualW, h: actualH });

                    // 選択ハンドラを再同期
                    console.log('[SNAP] Before syncSelectionHandlers...');
                    this.syncSelectionHandlers();
                    console.log('[SNAP] After syncSelectionHandlers, x=', parseFloat(el.attr('x')));
                }
            }

            // Sync changes to editor AFTER baking
            console.log('[SNAP] Before syncChanges, x=', parseFloat(this.el.attr('x')));
            syncChanges(true);
            console.log('[SNAP] After syncChanges, x=', parseFloat(this.el.attr('x')));

            // Transform Toolbarを更新
            if (window.updateTransformToolbarValues) {
                console.log('[SNAP] Before updateTransformToolbarValues, x=', parseFloat(this.el.attr('x')));
                window.updateTransformToolbarValues();
                console.log('[SNAP] After updateTransformToolbarValues, x=', parseFloat(this.el.attr('x')));
            }
        } catch (err) {
            console.error('[SVG RESIZE DONE] Failed:', err);
        } finally {
            this._resizeState = null;
            this._isResizing = false;
        }
    }

    /**
     * [NEW] 拡大縮小時の線幅・フォントサイズ維持を適用
     */
    syncStrokeTextScale() {
        const el = this.el;
        if (el.type === 'g' && el.attr('data-tool-id') === 'shape-text-group') {
            const maintain = typeof AppState !== 'undefined' && AppState.config && AppState.config.svgMaintainStrokeText !== false;
            const matrix = el.matrix();
            const sx = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
            const sy = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);

            el.children().forEach(child => {
                if (child.type === 'text') {
                    if (maintain && sx > 0.001 && sy > 0.001) {
                        const cx = parseFloat(child.attr('x')) || 0;
                        const cy = parseFloat(child.attr('y')) || 0;
                        
                        // 1. 基底のフォントサイズをDOMオブジェクトに退避（初回のみ）
                        let baseFs = parseFloat(child.node.dataset.baseFontSize);
                        if (!baseFs || isNaN(baseFs)) {
                            // [FIX] css('font-size') を明示的に優先（ツールバー等でインライン指定された場合に対応）
                            let styleFs = child.css('font-size');
                            baseFs = parseFloat(styleFs) || parseFloat(child.attr('font-size')) || 16;
                            child.node.dataset.baseFontSize = baseFs;
                        }

                        // 2. ブラウザの再描画を確実に強制するため、font-size 属性自体を逆スケールで変更
                        // これにより sy (垂直拡大率) の視覚的な伸びを相殺する
                        const rawSy = sy === 0 ? 1 : sy;
                        const dynamicFs = baseFs / rawSy;
                        child.attr('font-size', dynamicFs);
                        // [FIX] インラインCSSが存在する場合は属性が効かないため、インラインスタイルも更新する
                        if (child.node.style && child.node.style.fontSize) {
                            child.css('font-size', dynamicFs + 'px');
                        }

                        // 3. font-size だけでは「縦横比」の歪み（sxとsyが異なる場合）は吸収できないため、
                        // CSS の transform で水平スケールだけを調整してアスペクト比を1.0に保つ
                        const rawSx = sx === 0 ? 1 : sx;
                        const aspectScaleX = rawSy / rawSx;
                        
                        if (Math.abs(aspectScaleX - 1.0) > 0.001) {
                            child.node.style.transformOrigin = `${cx}px ${cy}px`;
                            child.node.style.transform = `scaleX(${aspectScaleX.toFixed(4)})`;
                        } else {
                            child.node.style.transform = 'none';
                        }
                        
                        // [NEW] リアルタイムでのテキスト自動折り返し適用（設定が有効な場合）
                        let bgShape = null;
                        el.children().forEach(ch => {
                            if (!bgShape && ch.type !== 'text' && ch.type !== 'defs' && ch.type !== 'title' && ch.type !== 'desc') {
                                bgShape = ch;
                            }
                        });
                        
                        if (bgShape && typeof window.SVGUtils !== 'undefined' && typeof window.SVGUtils.wrapAndTruncateText === 'function') {
                            const origAttr = child.attr('data-original-text');
                            let cleanText = '';
                            if (origAttr !== undefined && origAttr !== null) {
                                cleanText = typeof origAttr === 'string' ? origAttr : String(origAttr);
                            } else {
                                const tspans = Array.from(child.node.querySelectorAll('tspan'));
                                if (tspans.length > 0) {
                                    cleanText = tspans.map(tspan => tspan.textContent).join('\n');
                                } else {
                                    cleanText = child.node.textContent || '';
                                }
                                child.attr('data-original-text', cleanText);
                            }
                            
                            if (cleanText.trim() !== '') {
                                const rawW = parseFloat(bgShape.attr('width'));
                                const rawH = parseFloat(bgShape.attr('height'));
                                let visualWidth = 0; let visualHeight = 0;
                                
                                if (!isNaN(rawW) && rawW > 0 && !isNaN(rawH) && rawH > 0) {
                                    visualWidth = rawW * (sx > 0.01 ? sx : 1);
                                    visualHeight = rawH * (sy > 0.01 ? sy : 1);
                                } else {
                                    let localBox = { width: 0, height: 0 };
                                    if (typeof bgShape.bbox === 'function') {
                                        localBox = bgShape.bbox();
                                    } else if (bgShape.node && typeof bgShape.node.getBBox === 'function') {
                                        localBox = bgShape.node.getBBox();
                                    }
                                    visualWidth = localBox.width * (sx > 0.01 ? sx : 1);
                                    visualHeight = localBox.height * (sy > 0.01 ? sy : 1);
                                }
                                
                                // 万一NANになったときのガード
                                if (isNaN(visualWidth) || visualWidth < 10) visualWidth = 100;
                                if (isNaN(visualHeight) || visualHeight < 10) visualHeight = 100;

                                const fontOpts = {
                                    fontSize: baseFs, // 見た目のフォントサイズは常に一定
                                    fontFamily: child.attr('font-family') || child.font('family') || 'sans-serif'
                                };
                                let spacingVal = parseFloat(el.attr('data-line-spacing')) || 1.2;
                                
                                let lines = window.SVGUtils.wrapAndTruncateText(cleanText, visualWidth, visualHeight, fontOpts, spacingVal);
                                
                                const curX = parseFloat(child.attr('x')) || 0;
                                const anchor = child.attr('text-anchor') || 'middle';
                                const baseline = child.attr('dominant-baseline') || 'central';

                                child.clear();
                                child.text(add => {
                                    lines.forEach((line, i) => {
                                        const safeLine = line === '' ? '\u200B' : line;
                                        const tspan = add.tspan(safeLine);
                                        tspan.attr({
                                            'x': curX,
                                            // リサイズ中はローカル上のfont-size(dynamicFs)を基準に行間を計算する
                                            'dy': i === 0 ? '0' : `${dynamicFs * spacingVal}`,
                                            'text-anchor': anchor,
                                            'dominant-baseline': baseline
                                        });
                                    });
                                });
                                
                                // テキストの再構築後にリアルタイムな位置調整を実行
                                if (window.SVGTextAlignmentToolbar && typeof window.SVGTextAlignmentToolbar.updateTextPosition === 'function') {
                                    window.SVGTextAlignmentToolbar.updateTextPosition(el);
                                }
                            }
                        }
                    } else {
                        child.node.style.transform = 'none';
                        if (child.node.dataset.baseFontSize) {
                            child.attr('font-size', parseFloat(child.node.dataset.baseFontSize));
                        }
                    }
                } else if (!child.hasClass('svg-interaction-hitarea') && child.type !== 'g') {
                    if (maintain) {
                        child.attr('vector-effect', 'non-scaling-stroke');
                    } else {
                        child.attr('vector-effect', null);
                    }
                }
            });
        }
    }

    /**
     * [V13] Handle Mirroring (Flip) logic during resize - Pure Local-Space Matrix Projection
     */
    handleResizeMirroring(e) {
        const el = this.el;

        // --- 0. Initialize State if missing (Fallback) ---
        if (!this._resizeState) {
            this.handleResizeStart(e);
            if (!this._resizeState) return;
        }

        const rs = this._resizeState;

        // --- 1. Strict Geometry Locking (V17) ---
        if (rs.initialAttrs) {
            for (const [k, v] of Object.entries(rs.initialAttrs)) {
                el.attr(k, v);
            }
        }

        const { event } = e.detail || {};
        
        // [FIX] svg.resize.js がドラッグ終了直前に座標無しイベント等で強制発火し、
        // 内部的に維持していたスケール行列を無効化してしまう現象を防ぐため、
        // eventが不完全な場合は lastMatrix で元の状態に復旧させてから抜ける
        if (!event || event.clientX === undefined) {
            if (rs.lastMatrix) {
                el.matrix(rs.lastMatrix);
                this.updateHitArea();
                this.syncSelectionHandlers();
                this.syncStrokeTextScale();
            }
            return;
        }

        const parent = el.parent() || el.root();

        let mInv;
        try { mInv = rs.mStart.inverse(); } catch (e) { return; }

        const rawMouseLocal = parent.point(event.clientX, event.clientY).transform(mInv);

        const mouseLocal = rawMouseLocal;

        const isSnapEnabled = typeof window.SVGUtils !== 'undefined' ? window.SVGUtils.isSnapEnabled(event || e) : false;
        
        const isShift = (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed) || (event && event.shiftKey);

        // --- 2. Pivot Detection in LOCAL Space ---
        if (rs.localPivotX === undefined && rs.localPivotY === undefined) {
            const cx = rs.localBBox.x + rs.localBBox.width / 2;
            const cy = rs.localBBox.y + rs.localBBox.height / 2;
            const side = rs.side;
            let isHOnly = /^(l|r|w|e)$/.test(side);
            let isVOnly = /^(t|b|n|s)$/.test(side);
            console.log(`[RESIZE START] Side:${side} isHOnly:${isHOnly} isVOnly:${isVOnly}`);

            if (!isVOnly) {
                if (rs.startMouseLocal.x > cx) rs.localPivotX = rs.localBBox.x;
                else rs.localPivotX = rs.localBBox.x + rs.localBBox.width;
                rs.startDistX = rs.startMouseLocal.x - rs.localPivotX;
            }
            if (!isHOnly) {
                if (rs.startMouseLocal.y > cy) rs.localPivotY = rs.localBBox.y;
                else rs.localPivotY = rs.localBBox.y + rs.localBBox.height;
                rs.startDistY = rs.startMouseLocal.y - rs.localPivotY;
            }
            const pX = rs.localPivotX !== undefined ? rs.localPivotX : cx;
            const pY = rs.localPivotY !== undefined ? rs.localPivotY : cy;
            rs._finalPivotL = { x: pX, y: pY };
            const pWStart = (new SVG.Point(pX, pY)).transform(rs.mStart);
            rs._targetPivotW = { x: pWStart.x, y: pWStart.y };
        }

        // --- 3. Calculate Scale Ratios ---
        let ratioX = 1;
        let ratioY = 1;
        if (rs.localPivotX !== undefined && Math.abs(rs.startDistX || 0) > 0.01) {
            ratioX = (mouseLocal.x - rs.localPivotX) / rs.startDistX;
        }
        if (rs.localPivotY !== undefined && Math.abs(rs.startDistY || 0) > 0.01) {
            ratioY = (mouseLocal.y - rs.localPivotY) / rs.startDistY;
        }

        // [DEBUG LOG]
        const currentRBox = el.rbox(el.root());
        console.log(`[RESIZE DEBUG] Handle:${rs.side || 'corner'} RatioX:${ratioX.toFixed(3)} RatioY:${ratioY.toFixed(3)} Vis:${currentRBox.w.toFixed(0)}x${currentRBox.h.toFixed(0)} Snap:${isSnapEnabled}`);

        // --- 4. Constraints / Shift Key ---
        if (isShift && rs.localPivotX !== undefined && rs.localPivotY !== undefined) {
            const common = Math.max(Math.abs(ratioX), Math.abs(ratioY));
            ratioX = common * Math.sign(ratioX || 1);
            ratioY = common * Math.sign(ratioY || 1);
        }
        if (Math.abs(ratioX) < 1e-6) ratioX = 1e-6 * Math.sign(ratioX || 1);
        if (Math.abs(ratioY) < 1e-6) ratioY = 1e-6 * Math.sign(ratioY || 1);

        // --- 4.5 Grid Snapping (Alt Key / Always Snap Mode) ---
        if (isSnapEnabled) {
            const gridConfig = AppState.config.grid || { size: 15 };
            const snapSize = gridConfig.size || 15;
            const initBox = rs.initialVisual;
            const pivotW = rs._targetPivotW;
            const isHOnly = /^(l|r|w|e)$/.test(rs.side);
            const isVOnly = /^(t|b|n|s)$/.test(rs.side);

            // ONLY snap width if NOT in Vertical-Only mode
            if (initBox.w > 0 && Math.abs(rs.startDistX || 0) > 0.01 && !isVOnly) {
                const isPivotLeft = (rs.localPivotX === rs.localBBox.x);
                const signX = Math.sign(ratioX) || 1;
                const projW = initBox.w * Math.abs(ratioX);
                const movingEdgeX = pivotW.x + (projW * (isPivotLeft ? 1 : -1) * signX);
                const snappedEdgeX = Math.round(movingEdgeX / snapSize) * snapSize;
                const finalVisualW = Math.abs(snappedEdgeX - pivotW.x);
                if (projW > 0.001) ratioX *= (finalVisualW / projW);
                if (Math.abs(ratioX) < 1e-6) ratioX = 1e-6 * signX;
            }

            // ONLY snap height if NOT in Horizontal-Only mode
            if (initBox.h > 0 && Math.abs(rs.startDistY || 0) > 0.01 && !isHOnly) {
                const isPivotTop = (rs.localPivotY === rs.localBBox.y);
                const signY = Math.sign(ratioY) || 1;
                const projH = initBox.h * Math.abs(ratioY);
                const movingEdgeY = pivotW.y + (projH * (isPivotTop ? 1 : -1) * signY);
                const snappedEdgeY = Math.round(movingEdgeY / snapSize) * snapSize;
                const finalVisualH = Math.abs(snappedEdgeY - pivotW.y);
                if (projH > 0.001) ratioY *= (finalVisualH / projH);
                if (Math.abs(ratioY) < 1e-6) ratioY = 1e-6 * signY;
            }

            if (isShift) {
                const common = Math.max(Math.abs(ratioX), Math.abs(ratioY));
                ratioX = common * Math.sign(ratioX || 1);
                ratioY = common * Math.sign(ratioY || 1);
            }
        }

        // --- 5. Generate and Apply Matrix ---
        const MatrixClass = rs.mStart.constructor;
        const mScaleLocal = new MatrixClass().scale(ratioX, ratioY, rs._finalPivotL.x, rs._finalPivotL.y);
        const finalMatrix = rs.mStart.multiply(mScaleLocal);
        el.matrix(finalMatrix);

        // Keep the latest successful matrix calculated from the physical mouse pointer.
        rs.lastMatrix = finalMatrix;

        this.updateHitArea();
        this.syncSelectionHandlers();
        if (e && e.preventDefault) e.preventDefault();
        
        // [NEW] 線の太さとテキストのスケール維持を適用
        this.syncStrokeTextScale();
        
        rs.frameCounter++;
    }

    /**
     * [FIX] Bake transformation matrix into geometric attributes (x, y, width, height, etc.)
     * This resets the coordinate system and prevents sensitivity issues during consecutive resizes.
     */
    bakeTransformation(forceDOMMatrix = false) {
        const el = this.el;

        // [NEW] 要素がDOMに存在しない、またはすでに破棄されている場合はBakeをスキップ
        if (!el || !el.node || !el.node.isConnected) {
            return;
        }

        // [FIX] svg.resize.js がリサイズ完了時に勝手にネイティブDOMからmatrixを消去するのを防ぐため、
        // 最後に正しく計算した lastMatrix があればそちらを強制的に使用する
        let matrix = el.matrix();
        if (!forceDOMMatrix && this._resizeState && this._resizeState.lastMatrix) {
            matrix = this._resizeState.lastMatrix;
        }

        // Identity check: If no transformation, nothing to bake
        if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0) {
            return;
        }

        try {
            const type = el.type;
            const parent = el.parent() || el.root();

            // Get current visual bounding box in parent coordinates
            const box = el.rbox(parent);

            // [V19] Identification of complex matrix (Rotation or Skew)
            const rotate = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
            // Flag as rotated if off-axis values are significant
            const isRotated = Math.abs(matrix.b) > 0.01 || Math.abs(matrix.c) > 0.01;

            // console.log(`[SVG BAKE] Baked started. Matrix: ${matrix.toString()}, Rotated: ${isRotated}`);

            if (isRotated) {
                // If rotated, it's safer to keep the rotation in the matrix.
                // We'll bake Scale and Translation, but keep Rotation.

                // Final visual center
                const cx = box.cx;
                const cy = box.cy;

                // 1. Temporarily remove rotation from world visualization (mathematically)
                const mNoRot = matrix.rotate(-rotate, cx, cy);

                // 2. Update attributes using the non-rotated matrix (for Scale/Translation)
                const success = this._updateAttributesUsingMatrix(mNoRot);

                // 3. Re-apply rotation only to matrix if successful
                if (success) {
                    el.matrix(new SVG.Matrix().rotate(rotate, cx, cy));
                }
            } else {
                // Not rotated: Simple bake everything and clear matrix
                const success = this._updateAttributesUsingMatrix(matrix);
                if (success) {
                    el.attr('transform', null);
                }
            }
        } catch (err) {
            console.error('[SVG BAKE] Failed to bake transformation:', err);
        }

        // [NEW] 焼き込み後も接続を更新
        if (window.SVGConnectorManager) {
            window.SVGConnectorManager.updateConnectionsFromElement(this.el);
        }
        
        // [NEW] ベイク後も線と文字のスケールを確実に維持
        this.syncStrokeTextScale();

        // [NEW] 焼き込み後、Shape with Text であれば、テキストの自動折り返し処理を再適用
        if (this.el && this.el.type === 'g' && this.el.attr('data-tool-id') === 'shape-text-group') {
            this.applyTextWrap();
        }
    }

    /**
     * [NEW] テキストを指定された幅と高さに基づいて折り返し・省略処理した行の配列を強制的に適用します
     */
    applyTextWrap() {
        if (!this.el || this.el.type !== 'g' || this.el.attr('data-tool-id') !== 'shape-text-group') return;
        
        let textEl = null;
        this.el.children().forEach(ch => {
            if (ch.type === 'text' && !ch.hasClass('svg-interaction-hitarea') && !textEl) textEl = ch;
        });
        if (!textEl && typeof this.el.findOne === 'function') {
            try { textEl = this.el.findOne('text:not(.svg-interaction-hitarea)'); } catch(e){}
        }
        if (!textEl && typeof this.el.findOne === 'function') textEl = this.el.findOne('text'); // fallback
        
        // [FIX] 背景図形を特定する際、defsやtitleなどをスキップする
        let bgShape = null;
        this.el.children().forEach(ch => {
            if (!bgShape && ch.type !== 'text' && ch.type !== 'defs' && ch.type !== 'title' && ch.type !== 'desc') {
                bgShape = ch;
            }
        });
        
        if (!textEl || !bgShape || typeof window.SVGUtils === 'undefined' || typeof window.SVGUtils.wrapAndTruncateText !== 'function') return;

        const origAttr = textEl.attr('data-original-text');
        let cleanText = '';
        if (origAttr !== undefined && origAttr !== null) {
            cleanText = typeof origAttr === 'string' ? origAttr : String(origAttr);
        } else {
            const tspans = Array.from(textEl.node.querySelectorAll('tspan'));
            if (tspans.length > 0) {
                cleanText = tspans.map(tspan => tspan.textContent).join('\n');
            } else {
                cleanText = textEl.node.textContent || '';
            }
            textEl.attr('data-original-text', cleanText);
        }
        
        if (cleanText.trim() === '') return;

        const rbox = bgShape.bbox();
        // ツールバー等で適用された見た目のスケールと実測を合わせるため、退避した本来の baseFs があれば優先
        const baseFs = parseFloat(textEl.node.dataset.baseFontSize);
        const cssFs = parseFloat(textEl.css('font-size') || textEl.attr('font-size'));
        const finalFontSize = (!isNaN(baseFs) && baseFs > 0) ? baseFs : (cssFs || 20);

        const fontOpts = {
            fontSize: finalFontSize,
            fontFamily: textEl.css('font-family') || textEl.attr('font-family') || textEl.font('family') || 'sans-serif'
        };
        let spacingVal = parseFloat(this.el.attr('data-line-spacing')) || parseFloat(textEl.css('letter-spacing') || textEl.attr('data-line-spacing')) || 1.2;
        
        // bgShape (rect等) に transform が残存していると bbox 値が増幅してしまうため、
        // ローカルでの純粋な attr 幅/高さ をフォールバックとして優先取得
        const rawW = parseFloat(bgShape.attr('width'));
        const rawH = parseFloat(bgShape.attr('height'));
        // targetW は BBox や属性を元にするが、Canvas の measureText の安全係数 (1.1) や
        // わずかな誤差による理不尽な折り返しを防ぐため、さらに安全マージンを含むことが望ましい。
        // SvgShape 自体の transform を bake した後なので、rawW には既にスケール適用済みの値が入っている。
        // もし wrapAndTruncateText でさらに 1.1 が掛けられると折り返されてしまう。
        const targetW = (!isNaN(rawW) && rawW > 0) ? rawW : rbox.width;
        const targetH = (!isNaN(rawH) && rawH > 0) ? rawH : rbox.height;

        // Canvasの安全係数による誤判定を相殺するため、判定用領域を 1.1倍 して余裕をもたせる
        const canvasSafeAreaW = targetW * 1.15;

        let lines = window.SVGUtils.wrapAndTruncateText(cleanText, canvasSafeAreaW, targetH, fontOpts, spacingVal);
        
        const curX = parseFloat(textEl.attr('x')) || 0;
        const anchor = textEl.css('text-anchor') || textEl.attr('text-anchor') || 'middle';
        const baseline = textEl.css('dominant-baseline') || textEl.attr('dominant-baseline') || 'central';

        textEl.clear();
        textEl.text(add => {
            lines.forEach((line, i) => {
                const safeLine = line === '' ? '\u200B' : line;
                const tspan = add.tspan(safeLine);
                tspan.attr({
                    'x': curX,
                    'dy': i === 0 ? '0' : `${finalFontSize * spacingVal}`,
                    'text-anchor': anchor,
                    'dominant-baseline': baseline
                });
            });
        });
        
        // 自動位置調整の再呼び出し
        if (window.SVGTextAlignmentToolbar && typeof window.SVGTextAlignmentToolbar.updateTextPosition === 'function') {
            window.SVGTextAlignmentToolbar.updateTextPosition(this.el);
        }
    }

    /**
     * Helper to update shape-specific attributes using a transformation matrix
     */
    _updateAttributesUsingMatrix(matrix, targetEl) {
        const el = targetEl || this.el;
        const type = el.type;
        const attrs = {};

        const isComplex = Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001;
        const box = el.bbox().transform(matrix);

        if (['rect', 'image', 'svg'].includes(type)) {
            if (isComplex) return false;
            attrs.x = box.x; attrs.y = box.y;
            attrs.width = box.width; attrs.height = box.height;
        } else if (['circle', 'ellipse'].includes(type)) {
            if (isComplex) return false;
            attrs.cx = box.cx; attrs.cy = box.cy;
            if (type === 'circle') {
                attrs.r = Math.min(box.width, box.height) / 2;
            } else {
                attrs.rx = box.width / 2; attrs.ry = box.height / 2;
            }
        } else if (type === 'g') {
            // テキスト付き図形 (shape-text-group) の特別処理
            if (el.attr('data-tool-id') === 'shape-text-group') {
                const maintain = typeof AppState !== 'undefined' && AppState.config && AppState.config.svgMaintainStrokeText !== false;
                let successAll = true;
                el.children().forEach(child => {
                    const childType = child.type;
                    if (childType === 'text') {
                        // ... existing text processing ...
                        const cx = parseFloat(child.attr('x')) || 0;
                        const cy = parseFloat(child.attr('y')) || 0;
                        const pt = new SVG.Point(cx, cy).transform(matrix);
                        child.attr({x: pt.x, y: pt.y});
                        
                        child.children().forEach(tspan => {
                            if (tspan.type === 'tspan') {
                                const tx = parseFloat(tspan.attr('x')) || 0;
                                const ty = parseFloat(tspan.attr('y')) || 0;
                                const tpt = new SVG.Point(tx, ty).transform(matrix);
                                tspan.attr({x: tpt.x, y: tpt.y});
                            }
                        });
                        
                        if (!maintain) {
                            const sy = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
                            const fs = parseFloat(child.attr('font-size')) || 20;
                            child.attr('font-size', fs * sy);
                        } else {
                            if (child.node.dataset.baseFontSize) child.attr('font-size', parseFloat(child.node.dataset.baseFontSize));
                            child.node.style.transform = 'none';
                        }
                        child.node.removeAttribute('transform');
                    } else if (!child.hasClass('svg-interaction-hitarea') && childType !== 'g') {
                        const success = this._updateAttributesUsingMatrix(matrix, child);
                        if (!success) successAll = false;
                        child.attr('vector-effect', null);
                    }
                });
                return successAll;
            } else {
                // 【図形崩れ防止】汎用グループは子要素をBakeせず、グループのtransform属性を維持する
                console.log(`[SVG BAKE] Skipping bake for generic group ${el.id()} to prevent distortion.`);
                return false;
            }
        } else if (type === 'text') {
            if (isComplex) return false;
            const sx = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
            const sy = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
            const scale = Math.max(sx, sy);
            
            if (Math.abs(scale - 1) > 0.001) {
                let currentFs = parseFloat(el.attr('font-size'));
                if (isNaN(currentFs)) {
                    if (el.node && window.getComputedStyle) currentFs = parseFloat(window.getComputedStyle(el.node).fontSize);
                    if (isNaN(currentFs)) currentFs = 20;
                }
                attrs['font-size'] = parseFloat((currentFs * scale).toFixed(3));
                
                let baseFs = parseFloat(el.node && el.node.dataset ? el.node.dataset.baseFontSize : el.attr('data-base-font-size'));
                if (!isNaN(baseFs) && baseFs > 0) {
                    attrs['data-base-font-size'] = parseFloat((baseFs * scale).toFixed(3));
                    if (el.node && el.node.dataset) el.node.dataset.baseFontSize = attrs['data-base-font-size'];
                }
                
                el.children().forEach(tspan => {
                    const dy = parseFloat(tspan.attr('dy'));
                    if (!isNaN(dy) && dy !== 0 && String(tspan.attr('dy')).indexOf('em') === -1) {
                        tspan.attr('dy', parseFloat((dy * scale).toFixed(3)));
                    }
                });
            }
            
            const pt = new SVG.Point(parseFloat(el.attr('x')) || 0, parseFloat(el.attr('y')) || 0).transform(matrix);
            attrs.x = pt.x; attrs.y = pt.y;
            
            el.children().forEach(tspan => {
                const tx = parseFloat(tspan.attr('x'));
                if (!isNaN(tx)) tspan.attr('x', new SVG.Point(tx, pt.y).transform(matrix).x);
            });

        } else if (['polyline', 'path', 'polygon'].includes(type)) {
            const toolId = el.attr('data-tool-id');

            // 【図形崩れ防止】外部インポートパスや複雑なパスはBakeをスキップ
            const isNativeTool = ['polyline', 'freehand', 'polygon', 'triangle', 'star', 'polyline_arrow', 'line_arrow', 'bubble'].includes(toolId);
            const dStr = el.attr('d') || '';
            const ptsStr = el.attr('points') || el.attr('data-poly-points') || '';
            if (!isNativeTool || dStr.includes('a') || dStr.includes('A') || dStr.length > 300 || ptsStr.length > 300 || (!toolId && dStr.length > 50)) {
                console.log(`[SVG BAKE] 複雑なパスのBakeをスキップし、transformを維持します: ${el.id()}`);
                return false;
            }

            if (toolId && toolId.includes('_arrow') && !['polyline_arrow', 'line_arrow'].includes(toolId)) return false;

            if (toolId === 'bubble' && typeof SVGToolbar !== 'undefined') {
                // ... (既存のバブル処理)
                try {
                    const isFlippedX = matrix.a < 0;
                    const isFlippedY = matrix.d < 0;

                    let w = parseFloat(el.attr('data-width'));
                    if (isNaN(w)) w = box.width;
                    let h = parseFloat(el.attr('data-height'));
                    if (isNaN(h)) h = box.height;

                    let rx = parseFloat(el.attr('data-rect-x'));
                    if (isNaN(rx)) rx = box.x;
                    let ry = parseFloat(el.attr('data-rect-y'));
                    if (isNaN(ry)) ry = box.y;

                    const pt = new SVG.Point(rx, ry).transform(matrix);
                    rx = pt.x;
                    ry = pt.y;

                    w = w * Math.abs(matrix.a);
                    h = h * Math.abs(matrix.d);

                    const opts = {
                        side: el.attr('data-tail-side') || 'bottom',
                        pos: parseFloat(el.attr('data-tail-pos')),
                        tx: el.attr('data-tail-tx') !== null && el.attr('data-tail-tx') !== 'undefined' ? parseFloat(el.attr('data-tail-tx')) : undefined,
                        ty: el.attr('data-tail-ty') !== null && el.attr('data-tail-ty') !== 'undefined' ? parseFloat(el.attr('data-tail-ty')) : undefined
                    };
                    if (isNaN(opts.pos)) opts.pos = 20;

                    if (opts.side === 'top' || opts.side === 'bottom') {
                        opts.pos *= Math.abs(matrix.a);
                    } else {
                        opts.pos *= Math.abs(matrix.d);
                    }
                    if (opts.tx !== undefined && !isNaN(opts.tx)) {
                        opts.tx *= Math.abs(matrix.a);
                        opts.ty *= Math.abs(matrix.d);
                    }

                    el.attr({
                        'data-width': w,
                        'data-height': h,
                        'data-rect-x': rx,
                        'data-rect-y': ry,
                        'data-tail-pos': opts.pos
                    });
                    if (opts.tx !== undefined && !isNaN(opts.tx)) {
                        el.attr('data-tail-tx', opts.tx);
                        el.attr('data-tail-ty', opts.ty);
                    }

                    const newPath = SVGToolbar.getBubblePath(w, h, opts);

                    if (!isFlippedX && !isFlippedY) {
                        const shiftedPath = newPath.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
                            return "M " + (parseFloat(p1) + rx) + " " + (parseFloat(p2) + ry);
                        });
                        el.plot(shiftedPath);
                        return true;
                    } else {
                        el.plot(newPath); 
                        const cleanMatrix = new SVG.Matrix()
                            .translate(rx, ry)
                            .scale(isFlippedX ? -1 : 1, isFlippedY ? -1 : 1, w / 2, h / 2);
                        el.matrix(cleanMatrix);
                        return false;
                    }
                } catch (e) {
                    console.warn('[SVG BAKE] Failed to regenerate bubble path:', e);
                }
            }

            try {
                const arr = el.array();
                let transformedArr = (arr && typeof arr.transform === 'function') ? arr.transform(matrix) : arr.map(p => {
                    if (Array.isArray(p)) {
                        const cmd = typeof p[0] === 'string' ? p[0] : null;
                        const coords = cmd ? p.slice(1) : p;
                        if (!cmd && coords.length >= 2) return [new SVG.Point(coords[0], coords[1]).transform(matrix).x, new SVG.Point(coords[0], coords[1]).transform(matrix).y];
                        else if (cmd && coords.length >= 2) return [cmd, new SVG.Point(coords[0], coords[1]).transform(matrix).x, new SVG.Point(coords[0], coords[1]).transform(matrix).y, ...coords.slice(2)];
                    }
                    return p;
                });

                if (transformedArr) {
                    el.plot(transformedArr);
                    if (['polyline', 'freehand', 'line', 'polyline_arrow', 'line_arrow', 'arrow'].includes(toolId) && typeof SvgPolylineHandler !== 'undefined') {
                        const handler = new SvgPolylineHandler(null, null);
                        const newPoints = handler.getPoints(el.node).map(pt => {
                            const p = new SVG.Point(pt[0], pt[1]).transform(matrix);
                            return [p.x, p.y, pt[2]]; 
                        });
                        const newBez = handler.getBezData(el.node).map(bz => {
                            if (!bz) return bz;
                            const nbz = { type: bz.type };
                            if (bz.cpIn) nbz.cpIn = [new SVG.Point(bz.cpIn[0], bz.cpIn[1]).transform(matrix).x, new SVG.Point(bz.cpIn[0], bz.cpIn[1]).transform(matrix).y];
                            if (bz.cpOut) nbz.cpOut = [new SVG.Point(bz.cpOut[0], bz.cpOut[1]).transform(matrix).x, new SVG.Point(bz.cpOut[0], bz.cpOut[1]).transform(matrix).y];
                            return nbz;
                        });
                        el.attr('data-poly-points', newPoints.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
                        el.attr('data-bez-points', JSON.stringify(newBez));
                        if (el.type === 'path') handler.generatePath(el.node);
                        else el.attr('points', newPoints.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
                    }
                    return true;
                }
            } catch (e) { console.warn(e); }
            return false;

        } else if (type === 'line') {
            attrs.x1 = box.x; attrs.y1 = box.y; attrs.x2 = box.x2; attrs.y2 = box.y2;
        }

        if (Object.keys(attrs).length > 0) { el.attr(attrs); return true; }
        return false;
    }

    flipX(doFlip) {
        const el = this.el;
        // Simple Center Flip
        // Note: Using scale(-1, 1) flips around the element center.
        // We might need to adjust x to keep the stationary side fixed?
        // Let's assume the library's resize logic naturally handles the 'dragging' side,
        // so we just inverse the content.

        // We need to maintain the current flip state vs requested state
        const currentScaleX = el.transform().scaleX || 1;
        const targetScaleX = doFlip ? -1 : 1;

        // Only apply if changed (sign)
        if (Math.sign(currentScaleX) !== targetScaleX) {
            // Apply scale. SVG.js 'scale' method multiplies?
            // Better to operate on matrix or transform object.
            const t = el.transform();
            t.scaleX = targetScaleX * Math.abs(currentScaleX); // Preserve magnitude if any? usually 1
            el.transform(t);
        }
    }

    flipY(doFlip) {
        const el = this.el;
        const currentScaleY = el.transform().scaleY || 1;
        const targetScaleY = doFlip ? -1 : 1;

        if (Math.sign(currentScaleY) !== targetScaleY) {
            const t = el.transform();
            t.scaleY = targetScaleY * Math.abs(currentScaleY);
            el.transform(t);
        }
    }

    applySelectionUI() {
        // ▼▼▼ 追加/変更: すべてのグループ要素で deepSelect を false にし、無駄な個別青枠の大量生成を防ぐ ▼▼▼
        const isGroup = this.el.type === 'g';

        // [FORCE REFLOW] Ensure browser has updated calculations
        this.node.getBBox();

        this._applySelectAndResize({
            rotationPoint: false,
            deepSelect: !isGroup
        });

        // [DEBUG] CSS変数とクラスの適用状況を確認
        const currentZoom = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
        console.log(`[SvgShape DEBUG] applySelectionUI for ${this.el.id()}, Current Zoom: ${currentZoom}%`);

        if (this.el.root()) {
            const container = this.el.root().node.parentNode;
            if (container) {
                console.log(`[SvgShape DEBUG] Container classes: ${container.className}`);
                console.log(`[SvgShape DEBUG] Container --svg-zoom: ${container.style.getPropertyValue('--svg-zoom')}`);
            }
        }

        // CSS transform is doing the job of handle scaling.
        // Removed redundant JS zoom listeners to prevent double-scaling issues.
        this.syncSelectionHandlers();
    }

    /**
     * [REFACTOR] Synchronize selection UI handles.
     */
    syncSelectionHandlers() {
        // [FIX] Prefer the specific selection group associated with this element
        // to avoid orphaning handles or attaching to the wrong group during multi-select moves.
        const sh = this.el.remember('_selectHandler');
        // [FIX] window.currentEditingSVG が既に null または cleanup 済みの場合のガードを追加
        if (!window.currentEditingSVG || !window.currentEditingSVG.container) {
            return;
        }

        const selectionGroups = new Set();
        if (sh && sh.nested && sh.nested.node) {
            selectionGroups.add(sh.nested.node);
        } else {
            // Fallback: querySelectorAll to catch all selection groups in case of multi-select
            // where specific select handler association might be temporarily lost.
            window.currentEditingSVG.container.querySelectorAll('.svg_select_group, .svg-select-group').forEach(g => selectionGroups.add(g));
            window.currentEditingSVG.container.querySelectorAll('.svg_select_shape').forEach(g => {
                if (g.parentNode) selectionGroups.add(g.parentNode);
            });
        }

        // [LOCK GUARD] If locked, we don't display any interactive handles (Rotation, Radius, etc.)
        const isLocked = this.el.attr('data-locked') === 'true' || this.el.attr('data-locked') === true;
        if (isLocked) {
            // Clean up existing handles if any
            if (this._rotationHandler) this._rotationHandler.hide();
            if (this._radiusHandler) this._radiusHandler.hide();
            if (this._polylineHandler) this._polylineHandler.hide();
            if (this._bubbleHandler) this._bubbleHandler.hide();
            return;
        }

        if (selectionGroups.size === 0) {
            return;
        }

        const bbox = this.getCleanBBox();

        // Ensure all handles have classes for CSS scaling
        // svg.select.js creates handles that might miss our custom classes sometimes.
        const editor = window.currentEditingSVG;
        const zoomVal = (editor && editor.zoom) || 100;
        const s = 100 / zoomVal;
        const container = editor && editor.container;

        selectionGroups.forEach(selectionGroup => {
            selectionGroup.querySelectorAll('circle, rect').forEach(h => {
                // クラスの付与（CSSでの一括制御用）
                if (h.classList.length === 0 || (!h.classList.contains('svg-select-handle') && !h.classList.contains('rotation-handle') && !h.classList.contains('radius-handle'))) {
                    h.classList.add('svg-select-handle');
                    if (!h.className.baseVal.includes('-handle')) {
                        h.classList.add('select-point-handle');
                    }
                }

                // [FIX] Invariant Point Scaling (SVG Utils approach)
                if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                    window.SVGUtils.updateHandleScaling(h, zoomVal);
                }
            });
        });


        const primarySelectionGroup = (sh && sh.nested && sh.nested.node) ||
            (selectionGroups.size > 0 ? selectionGroups.values().next().value : null);

        if (container) {
            // Update Rotation Handle
            if (!this._rotationHandler && typeof SvgRotationHandler !== 'undefined') {
                this._rotationHandler = new SvgRotationHandler(container, () => { if (window.syncChanges) window.syncChanges(true); });
            }
            if (this._rotationHandler) this._rotationHandler.update(primarySelectionGroup, this.node, bbox);

            // Update Radius Handle
            if (!this._radiusHandler && typeof SvgRadiusHandler !== 'undefined') {
                this._radiusHandler = new SvgRadiusHandler(container, () => { if (window.syncChanges) window.syncChanges(true); });
            }
            if (this._radiusHandler) this._radiusHandler.update(primarySelectionGroup, this.node, bbox);

            // [NEW] Update Polyline Handles
            if (this instanceof PolylineShape) {
                if (!this._polylineHandler && typeof SvgPolylineHandler !== 'undefined') {
                    this._polylineHandler = new SvgPolylineHandler(container, () => {
                        if (typeof SVGToolbar !== 'undefined' && this._polylineHandler.activeNode) {
                            const activeEl = SVG(this._polylineHandler.activeNode);
                            SVGToolbar.updateArrowMarkers(activeEl);
                        }
                        if (typeof updateTransformToolbarValues === 'function') updateTransformToolbarValues();
                        if (window.syncChanges) window.syncChanges(true);
                    });
                }
                if (this._polylineHandler) this._polylineHandler.update(primarySelectionGroup, this.node, bbox);
            }

            // [NEW] Update Bubble Handles
            if (!this._bubbleHandler && typeof SvgBubbleHandler !== 'undefined') {
                this._bubbleHandler = new SvgBubbleHandler(container, () => {
                    if (typeof SVGToolbar !== 'undefined' && this._bubbleHandler.activeNode) {
                        const activeEl = SVG(this._bubbleHandler.activeNode);
                        if (activeEl && typeof window.updateTransformToolbarValues === 'function') window.updateTransformToolbarValues();
                    }
                    if (window.syncChanges) window.syncChanges(true);
                });
            }
            if (this._bubbleHandler) this._bubbleHandler.update(primarySelectionGroup, this.node, bbox);
        }

        // [NEW] Text alignment synchronization during UI sync (Resize/Move)
        if (window.SVGTextAlignmentToolbar) {
            let group = null;
            if (this.el.attr('data-tool-id') === 'shape-text-group') {
                group = this.el;
            } else {
                const p = this.el.parent();
                if (p && typeof p.attr === 'function' && p.attr('data-tool-id') === 'shape-text-group') {
                    group = p;
                }
            }

            if (group) {
                window.SVGTextAlignmentToolbar.updateTextPosition(group, true);
            }
        }
    }

    // [MOVED] clearSelectionUI moved up

    setupHitArea() {
        if (this.hitArea) {
            if (!this.hitArea.node.isConnected) {
                this.hitArea.remove();
                this.hitArea = null;
            } else {
                return;
            }
        }

        const el = this.el;
        const parent = el.parent();
        if (!parent) return;

        // 【No.3 修正】 複雑なパスやポリゴンはクローンせず、矩形で代用してDOM爆発を防ぐ
        const dStr = el.attr('d') || '';
        const ptsStr = el.attr('points') || el.attr('data-poly-points') || '';
        const isComplex = (el.type === 'path' && dStr.length > 200) || 
                          ((el.type === 'polyline' || el.type === 'polygon') && ptsStr.length > 200);

        if (el.type === 'g' || isComplex || el.type === 'image') {
            this.hitArea = parent.rect(0, 0)
                .addClass('svg-interaction-hitarea')
                .attr({
                    'fill': 'transparent',
                    'stroke': 'transparent',
                    'pointer-events': 'all',
                    'opacity': 0
                });
        } else {
            // 単純な図形のみクローンを許容
            this.hitArea = el.clone()
                .addClass('svg-interaction-hitarea')
                .attr({
                    'fill': 'transparent',
                    'stroke': 'transparent',
                    'pointer-events': 'all',
                    'opacity': 0
                })
                .forget('_shapeInstance'); 
        }

        // Sync initial state
        this.updateHitArea();

        // Ensure hit area is removed when the master element is removed
        el.on('remove.svg_interaction', () => {
            if (this.hitArea) {
                this.hitArea.remove();
                this.hitArea = null;
            }
        });

        // Insert BEHIND the master element
        this.hitArea.insertBefore(el);

        // Forward events to master
        this.hitArea.on('mousedown.svg_interaction', (e) => {
            if (!el.node.isConnected) {
                if (this.hitArea) this.hitArea.remove();
                return;
            }
            if (typeof el.visible === 'function' && !el.visible()) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const ev = e.nativeEvent || e;
            if (!ev || typeof ev.clientX === 'undefined') return;

            const clonedEvent = new MouseEvent('mousedown', {
                clientX: ev.clientX, clientY: ev.clientY,
                screenX: ev.screenX, screenY: ev.screenY,
                button: ev.button, buttons: ev.buttons,
                shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey,
                altKey: ev.altKey, metaKey: ev.metaKey,
                bubbles: true, cancelable: true
            });
            el.node.dispatchEvent(clonedEvent);
        });
    }

    updateHitArea() {
        if (!this.hitArea) return;
        const el = this.el;
        const bbox = this.getCleanBBox();

        // Sync transformation matrix
        this.hitArea.matrix(el.matrix());

        // Sync geometry based on element type
        const attrs = {};
        const type = el.type;

        // 【No.3 修正】 HitAreaが代替の四角形(rect)で生成されている場合、BBoxの寸法を流し込む
        if (this.hitArea.type === 'rect' && type !== 'rect') {
            this.hitArea.attr({
                x: bbox.x,
                y: bbox.y,
                width: bbox.width || 10,
                height: bbox.height || 10,
                'stroke-width': 4 // ヒット判定を少し広くする
            });
            return;
        }

        if (['rect', 'image', 'svg', 'g'].includes(type)) {
            attrs.x = bbox.x;
            attrs.y = bbox.y;
            attrs.width = bbox.width;
            attrs.height = bbox.height;
        } else if (['circle', 'ellipse'].includes(type)) {
            attrs.cx = el.attr('cx');
            attrs.cy = el.attr('cy');
            attrs.rx = el.attr('rx');
            attrs.ry = el.attr('ry');
            attrs.r = el.attr('r');
        } else if (type === 'line') {
            attrs.x1 = el.attr('x1');
            attrs.y1 = el.attr('y1');
            attrs.x2 = el.attr('x2');
            attrs.y2 = el.attr('y2');
        } else if (['path', 'polyline', 'polygon'].includes(type)) {
            attrs.d = el.attr('d');
            attrs.points = el.attr('points');
        } else if (type === 'text') {
            attrs.x = el.attr('x');
            attrs.y = el.attr('y');
            this.hitArea.text(el.text());
        }

        // Expanded stroke width (original + 4px = 2px expansion on each side)
        const sw = parseFloat(el.attr('stroke-width')) || 0;
        attrs['stroke-width'] = sw + 4;

        this.hitArea.attr(attrs);
    }
}

/**
 * Canvas Shape Class (Root SVG Proxy)
 */
class CanvasShape extends SvgShape {
    init() {
        super.init();
        const el = this.el;

        // [NEW] ズーム変更時に境界描画（青枠）を同期させる
        if (window.currentEditingSVG && window.currentEditingSVG.draw) {
            window.currentEditingSVG.draw.on('zoomchange', () => {
                this.updateCanvasUI(true);
            });
        }

        el.on('resize', (e) => {
            // [FIX] resizestart が発火しないため、resize イベント内のネイティブイベントでフラグを管理
            const nativeEvent = e.detail && e.detail.event;
            const isDone = nativeEvent && (nativeEvent.type === 'mouseup' || nativeEvent.type === 'touchend');
            if (!isDone) {
                this._isResizing = true;
            }

            // [REMOVED] 揺り戻し防止 (DEEP-GUARD): 350px/450px へのリセット検知を削除
            // ユーザーの意図的な操作（350px付近へのリサイズ）と衝突するため。

            this.updateCanvasUI(true);
        });

        // ドラッグ終了（マウスアップ）時のみ silent: false でプレビューも更新する
        el.on('resizedone', () => {
            console.log('[CanvasShape] resizedone detected. Triggering full sync.');
            // [FIX] フラグを降ろす前に最後の同期を行い、判定を確定させる
            this.updateCanvasUI(false);
            // わずかに遅延させることで、ライブラリ側からの最終的な不自然な更新入力を無視させる
            setTimeout(() => { this._isResizing = false; }, 50);
        });

        // [NEW] 初期化時も境界の状態を同期
        setTimeout(() => this.updateCanvasUI(true), 10);
    }

    updateCanvasUI(silent = true) {
        if (this._isUpdatingUI) return;
        this._isUpdatingUI = true;

        try {
            const current = window.currentEditingSVG;
            if (!current || !current.canvasBorder || !current.draw) return;
            const draw = current.draw;

            // [GUARD] 同期中または他の同期処理中の場合はスキップ
            // [FIX] _syncingToEditor は操作をブロックしすぎるため除外...と言いたいが、
            // 実際は editor_core からの逆方向同期との競合を防ぐために必要。
            if (current._updatingFromEditor || current._inCounterSync || current._syncingToEditor) {
                return;
            }

            // [FIX] 自身のインスタンスが現在アクティブなエディタのプロキシであるかを確認
            if (current.canvasProxy !== this.el) return;

            const el = this.el;
            const h = parseFloat(el.attr('height')) || 0;
            const configWidth = (typeof AppState !== 'undefined' && AppState.config.previewWidth) || 820;
            const inset = current.canvasInset || 4;
            let borderH = h + inset * 2;
            const borderW = configWidth;

            // [REMOVED] DEEP-GUARD: 350px / 450px へのリセット遮断ロジックを削除
            // ユーザーがこれらの数値に設定したい場合があるため。


            // --- 以降、正常なリサイズ時の更新処理 ---

            // 横幅を強制固定 (Heightのみのリサイズを達成)
            const targetWidth = configWidth - inset * 2;
            if (Math.abs(parseFloat(el.attr('width')) - targetWidth) > 0.1) {
                el.attr('width', targetWidth);
            }

            // 境界枠（canvasBorder）を同期
            const borderX = current.baseX || 0;
            const borderY = current.baseY || 0;

            current.canvasBorder.attr({
                x: borderX,
                y: borderY,
                width: borderW,
                height: Math.max(10, borderH)
            });

            // [NEW] 視覚的整合性: ルート SVG 本体の物理サイズを更新 (CSS の outline = 緑枠 を同期させる)
            if (draw && draw.node) {
                const svgNode = draw.node;
                const currentSvgH = parseFloat(svgNode.getAttribute('height')) || 0;
                if (Math.abs(currentSvgH - borderH) > 0.1) {
                    console.log(`[CanvasShape] Syncing root SVG height to ${borderH} (Guide Green Border)`);
                    svgNode.setAttribute('height', borderH);
                    svgNode.setAttribute('data-paper-height', borderH);
                }
            }

            // メモリの baseHeight を更新
            current.baseHeight = borderH;

            // ViewBox の同期
            const vb = draw.node.viewBox.baseVal;
            const scale = 100 / (current.zoom || 100);
            const vh = borderH * scale;
            const vw = borderW * scale;

            // [FIX] ズーム・パン情報を維持するため、可能な限り中央管理の applyZoomPan を通す
            // これにより、ビューボックスの同期時にパン（offX, offY）がリセットされるのを防ぐ
            if (current.applyZoomPan && Math.abs(vb.height - vh) > 0.1) {
                current.applyZoomPan();
            } else if (Math.abs(vb.height - vh) > 0.1) {
                draw.viewbox(vb.x, vb.y, vw, vh);
            }

            // エディタへの同期（サイレントでない場合のみ）
            if (!silent) {
                if (typeof syncChanges === 'function') {
                    syncChanges(false);
                }
            }

            // [NEW] 最終同期: リサイズハンドル（青い四角）の位置を強制的にリフレッシュ
            // 物理的に el の座標や内部状態を書き換えた場合、ハンドルが古い場所に取り残されるのを防ぐ
            if (typeof this.el.selectize === 'function') {
                const sh = this.el.remember('_selectHandler');
                if (sh && sh.nested) {
                    // [FIX] 不整合がある場合は強制的に再適用
                    const hBox = sh.nested.bbox();
                    const isLeaked = Math.abs(hBox.height - borderH) > 5;

                    if (!this._isResizing && isLeaked) {
                        console.log(`[CanvasShape] Refreshing selection handles for visual consistency (${hBox.height} -> ${borderH})`);
                        this.applySelectionUI();
                    }
                }
            }
        } finally {
            this._isUpdatingUI = false;
        }
    }

    applySelectionUI() {
        // [GUARD] 描画前に最新のキャンバス状態に強制同期
        this.updateCanvasUI(true);

        // 1. 基本的な選択・リサイズ設定の適用
        this._applySelectAndResize({
            points: [],          // [FIX] false ではなく空配列を指定し、プラグインの予期せぬ挙動を抑制
            rotationPoint: false,
            deepSelect: false,
            resizable: false
        });

        // 2. [復旧] キャンバス専用のハンドル非活性化のための堅牢なロジック
        // points: false 指定でもプラグインの競合によりハンドルが漏れる場合があるため、直接ノードを操作して隠滅します。
        const syncCanvasClass = () => {
            const sh = this.el.remember('_selectHandler');
            const container = window.currentEditingSVG && window.currentEditingSVG.container;

            if (!container || !sh) return false;

            // 確実なハンドルグループの特定（以前の堅牢なスキャナを流用）
            let nested = sh.nested || sh.group || sh.selection;

            if (!nested) {
                const getScanRoot = () => {
                    const r = this.el.root ? this.el.root() : null;
                    if (r && r.node && r.node.querySelectorAll) return r.node;
                    return document.querySelector('svg');
                };
                const scanRoot = getScanRoot();
                if (scanRoot && scanRoot.querySelectorAll) {
                    const allGroups = scanRoot.querySelectorAll('g[class*="select"]');
                    const targetId = this.el.id();
                    for (const group of allGroups) {
                        const inst = group.instance || group;
                        const instEl = inst.el || inst.target || inst.targetEl || inst.selection;
                        const instElId = (instEl && typeof instEl.id === 'function') ? instEl.id() : (instEl ? instEl.id : null);
                        if (instElId === targetId) {
                            nested = group.instance || (typeof group.each === 'function' ? group : null);
                            if (nested) break;
                        }
                    }
                }
            }

            if (nested) {
                if (!nested.hasClass('svg-select-group-canvas')) {
                    nested.addClass('svg-select-group-canvas');
                }

                nested.each(function () {
                    const node = this.node;
                    const cls = node.getAttribute('class') || '';
                    const isShapeOutline = cls.includes('select_shape') || cls.includes('select-shape');

                    if (isShapeOutline) {
                        this.show(); // 青い破線枠（アウトライン）は維持
                        return;
                    }

                    // [FIX] リサイズハンドル（点）はすべて物理的に非表示・無効化
                    this.hide();
                    node.style.setProperty('display', 'none', 'important');
                    node.style.setProperty('visibility', 'hidden', 'important');
                    node.style.setProperty('pointer-events', 'none', 'important');
                    node.style.setProperty('opacity', '0', 'important');
                }, true);
                return true;
            }
            return false;
        };

        if (this._canvasSyncTimer) clearInterval(this._canvasSyncTimer);
        if (!syncCanvasClass()) {
            let count = 0;
            this._canvasSyncTimer = setInterval(() => {
                count++;
                if (syncCanvasClass() || count > 40) { // 2秒間試行
                    clearInterval(this._canvasSyncTimer);
                    this._canvasSyncTimer = null;
                }
            }, 50);
        }

        // 独自回転ハンドラの抑制
        if (window.currentEditingSVG && window.currentEditingSVG.rotationHandler) {
            window.currentEditingSVG.rotationHandler.hide();
        }
    }

    /**
     * [NEW] ライブラリ (svg.resize.js) の内部キャッシュ・パラメータを物理的に矯正する
     */
    _patchLibraryInternalState(ins, w, h) {
        if (!ins) return;
        try {
            if (ins.parameters) {
                console.log(`[CanvasShape] Patching parameters: ${ins.parameters.w}x${ins.parameters.h} -> ${w}x${h}`);
                ins.parameters.h = h;
                ins.parameters.w = w;
            }
            if (ins._box) {
                console.log(`[CanvasShape] Patching _box: ${ins._box.width}x${ins._box.height} -> ${w}x${h}`);
                ins._box.height = h;
                ins._box.width = w;
            }
            // [NEW] svg.resize.js の rt オブジェクトが存在する場合のパッチ
            const rt = ins.remember('_svgResize');
            if (rt && rt.box) {
                console.log(`[CanvasShape] Patching _svgResize.box: ${rt.box.width}x${rt.box.height} -> ${w}x${h}`);
                rt.box.width = w;
                rt.box.height = h;
            }
        } catch (e) {
            console.warn("[CanvasShape] Failed to patch internal state:", e);
        }
    }
}

/**
 * Arrow Shape Class (StandardShape継承)
 * 矢印要素の選択時に黄色いマーカーを表示し、ドラッグでパラメータを調整できる。
 */
class ArrowShape extends StandardShape {
    /** マーカーのDOM要素配列 */
    _markers = [];

    init() {
        super.init();
        console.log('[ArrowShape] init', this.el.id());

        const updateMarkers = () => {
            if (this._controlMarkers) {
                this._controlMarkers.forEach(m => m.update());
            }
        };

        // 移動およびリサイズ時にマーカーを追従させる
        this.el.on('dragmove.arrowmarkers', updateMarkers);
        this.el.on('resize.arrowmarkers', updateMarkers);

        // SvgRotationHandler (独自ハンドラ) からの回転イベントに追従させる
        this.el.node.addEventListener('rotatemove', updateMarkers);
        this._rotateMoveHandler = updateMarkers;
    }

    applySelectionUI(options) {
        // 標準の選択UIを適用
        this._applySelectAndResize({
            rotationPoint: false,
            deepSelect: false,
            classRect: 'svg_select_boundingRect'
        });
        // 黄色いマーカーを生成
        this._createMarkers();
    }

    updateMarkers() {
        if (this._controlMarkers) {
            this._controlMarkers.forEach(m => m.update());
        }
    }

    /**
     * 選択解除 / 破棄時にマーカーを削除
     */
    _removeMarkers() {
        this.clearControlMarkers();
    }

    /**
     * 選択UIクリア時にも呼ぶ（標準のclearSelectionUIパスで呼ばれる）
     */
    clearSelectionUI() {
        this._removeMarkers();
        super.clearSelectionUI && super.clearSelectionUI();
    }

    /**
     * マーカーを生成する
     * ArrowPaths で生成した各パラメータに対応した黄色い円を配置する。
     */
    _createMarkers() {
        this.clearControlMarkers();

        const el = this.el;
        const toolId = el.attr('data-tool-id');
        if (!window.ArrowPaths) return;

        // マーカーの定義（パラメータ名、ドラッグ方向、制御点の計算）
        const markerDefs = this._getMarkerDefs(toolId);
        if (!markerDefs) return;

        markerDefs.forEach(def => {
            // SvgControlMarkerへ共通化
            const marker = new SvgControlMarker(el, def);
            this._controlMarkers.push(marker);
        });
    }

    /**
     * 矢印タイプ別マーカー定義を返す
     * dir: +1=矢印伸び方向にドラッグでパラメータ増加、-1=縮み方向
     */
    _getMarkerDefs(toolId) {
        const el = this.el;
        const get = (k, d) => parseFloat(el.attr(`data-arrow-${k}`)) || d;

        if (toolId === 'straight_arrow' || toolId === 'straight_both_arrow') {
            return [
                { param: 'len', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 1, labelFn: (p) => ({ x: p.len, y: 0 }) },
                { param: 'shaftW', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 2, labelFn: (p) => ({ x: p.len * 0.3, y: p.shaftW / 2 }) },
                { param: 'headW', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 2, labelFn: (p) => ({ x: p.len - p.headL / 2, y: p.headW / 2 }) },
                { param: 'headL', cursor: 'ew-resize', axis: 'x', dir: -1, scale: 1, labelFn: (p) => ({ x: p.len - p.headL, y: p.headW / 2 + 8 }) },
            ];
        } else if (toolId === 'curved_arrow' || toolId === 'curved_both_arrow') {
            return [
                { param: 'legH', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 1, labelFn: (p) => ({ x: p.legH, y: 0 }) },
                { param: 'legV', cursor: 'ns-resize', axis: 'y', dir: -1, scale: 1, labelFn: (p) => ({ x: 0, y: -p.legV }) },
                { param: 'shaftW', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 2, labelFn: (p) => ({ x: p.legH / 2, y: p.shaftW / 2 }) },
                { param: 'headW', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 2, labelFn: (p) => ({ x: p.headW / 2, y: -p.legV + p.headL / 2 }) },
                { param: 'headL', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 1, labelFn: (p) => ({ x: p.headW / 2 + 8, y: -p.legV + p.headL }) },
                // 角丸調整用マーカー（カーブ開始点の内側に配置）
                {
                    param: 'radius', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 1, labelFn: (p) => {
                        const sw2 = p.shaftW / 2;
                        const neckV = Math.max(sw2 + 1, p.legV - p.headL);
                        const r = Math.max(0, Math.min(p.radius, Math.min(p.legH - sw2 * 2, neckV - sw2)));
                        return { x: sw2 + r, y: -sw2 };
                    }
                },
            ];
        } else if (toolId === 'uturn_arrow' || toolId === 'uturn_both_arrow') {
            return [
                { param: 'legH1', cursor: 'ns-resize', axis: 'y', dir: -1, scale: 1, labelFn: (p) => ({ x: -p.shaftW / 2, y: -p.legH1 }) },
                { param: 'legH2', cursor: 'ns-resize', axis: 'y', dir: -1, scale: 1, labelFn: (p) => ({ x: p.uWidth + p.shaftW / 2, y: -p.legH2 }) },
                { param: 'uWidth', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 2, labelFn: (p) => ({ x: p.uWidth / 2, y: p.shaftW + 5 }) },
                { param: 'shaftW', cursor: 'ew-resize', axis: 'x', dir: -1, scale: 2, labelFn: (p) => ({ x: -p.shaftW / 2, y: -p.legH1 / 2 }) },
                { param: 'headW', cursor: 'ew-resize', axis: 'x', dir: 1, scale: 2, labelFn: (p) => ({ x: p.uWidth + p.headW / 2, y: -p.legH2 + p.headL / 2 }) },
                { param: 'headL', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 1, labelFn: (p) => ({ x: p.uWidth + p.headW / 2 + 8, y: -p.legH2 + p.headL }) },
                // 角丸調整用マーカー（U字の底の中心に配置）
                {
                    param: 'radius', cursor: 'ns-resize', axis: 'y', dir: 1, scale: 1, labelFn: (p) => {
                        const sw2 = p.shaftW / 2;
                        const maxR = Math.max(0, p.uWidth / 2 - sw2);
                        const ir = Math.min(Math.max(0, p.radius), maxR);
                        return { x: p.uWidth / 2, y: ir };
                    }
                },
            ];
        }
        return null;
    }

    /**
     * data-arrow-* 属性からパラメータを読み込む
     */
    _readParams(toolId) {
        const el = this.el;
        const get = (k, d) => {
            const v = el.attr(`data-arrow-${k}`);
            if (v === null || v === undefined || v === '') return d;
            const parsed = parseFloat(v);
            return isNaN(parsed) ? d : parsed;
        };


        const base = {
            shaftW: get('shaftW', 20),
            headW: get('headW', 40),
            headL: get('headL', 40),
        };

        if (toolId === 'straight_arrow' || toolId === 'straight_both_arrow') {
            return { ...base, len: get('len', 120) };
        } else if (toolId === 'curved_arrow' || toolId === 'curved_both_arrow') {
            return {
                ...base,
                legH: get('legH', 80),
                legV: get('legV', 80),
                radius: get('radius', 20),
            };
        } else if (toolId === 'uturn_arrow' || toolId === 'uturn_both_arrow') {
            return {
                ...base,
                legH1: get('legH1', 80),
                legH2: get('legH2', 80),
                uWidth: get('uWidth', 60),
                radius: get('radius', 20),
            };
        }
        return base;
    }

    /**
     * 現在のパラメータからSVGパスを再生成する
     */
    _regeneratePath() {
        if (!window.ArrowPaths) return;
        const toolId = this.el.attr('data-tool-id');
        const params = this._readParams(toolId);

        let pathD = '';
        if (toolId === 'straight_arrow') {
            pathD = ArrowPaths.straight(params);
        } else if (toolId === 'straight_both_arrow') {
            pathD = ArrowPaths.straight_both(params);
        } else if (toolId === 'curved_arrow') {
            pathD = ArrowPaths.curved(params);
        } else if (toolId === 'curved_both_arrow') {
            pathD = ArrowPaths.curved_both(params);
        } else if (toolId === 'uturn_arrow') {
            pathD = ArrowPaths.uturn(params);
        } else if (toolId === 'uturn_both_arrow') {
            pathD = ArrowPaths.uturn_both(params);
        }

        if (pathD) {
            this.el.plot(pathD);
        }
    }

    /**
     * リサイズ開始時に初期パラメータを保存する（StandardShapeを拡張）
     */
    handleResizeStart(e) {
        super.handleResizeStart(e);
        if (this._resizeState) {
            const toolId = this.el.attr('data-tool-id');
            this._resizeState.initialArrowParams = this._readParams(toolId);
        }
    }

    /**
     * リサイズ完了時: matrix scaleをパラメータに変換し、matrixをリセットする。
     * StandardShapeの_updateAttributesUsingMatrixはpathに対して機能しないため、
     * 代わりに矢印専用の変換を行う。
     */
    handleResizeDone(e) {
        this._isResizing = false;
        const rs = this._resizeState;
        this._resizeState = null;

        if (!rs || !rs.mStart) {
            if (window.syncChanges) window.syncChanges();
            return;
        }

        // 現在のmatrixと初期matrixから、適用されたスケールを計算する
        const currentMatrix = this.el.matrix();
        let relMatrix;
        try {
            relMatrix = rs.mStart.inverse().multiply(currentMatrix);
        } catch (err) {
            // matrix逆計算失敗: matrixをリセットしてパスを再生成
            this.el.matrix(rs.mStart);
            this._regeneratePath();
            if (window.syncChanges) window.syncChanges();
            return;
        }

        // [NEW] スケールの符号（反転状態）を取得
        const signX = Math.sign(relMatrix.a) || 1;
        const signY = Math.sign(relMatrix.d) || 1;

        // スケール成分を抽出 (rotationが絡む場合も考慮してnormで計算)
        const sx = Math.sqrt(relMatrix.a * relMatrix.a + relMatrix.b * relMatrix.b);
        const sy = Math.sqrt(relMatrix.c * relMatrix.c + relMatrix.d * relMatrix.d);

        const toolId = this.el.attr('data-tool-id');
        const initP = rs.initialArrowParams || this._readParams(toolId);

        // パラメータをスケールに比例して更新
        if (toolId === 'straight_arrow' || toolId === 'straight_both_arrow') {
            this.el.attr('data-arrow-len', Math.max(20, initP.len * sx));
            this.el.attr('data-arrow-shaftW', Math.max(4, initP.shaftW * sy));
            this.el.attr('data-arrow-headW', Math.max(8, initP.headW * sy));
        } else if (toolId === 'curved_arrow' || toolId === 'curved_both_arrow') {
            this.el.attr('data-arrow-legH', Math.max(20, initP.legH * sx));
            this.el.attr('data-arrow-legV', Math.max(20, initP.legV * sy));
        } else if (toolId === 'uturn_arrow' || toolId === 'uturn_both_arrow') {
            this.el.attr('data-arrow-uWidth', Math.max(20, initP.uWidth * sx));
            this.el.attr('data-arrow-legH1', Math.max(20, initP.legH1 * sy));
            this.el.attr('data-arrow-legH2', Math.max(20, initP.legH2 * sy));
        }

        // matrixをリセット（スケール除去、位置と回転だけ残す）
        // 単純に mStart に戻すと「リサイズ固定端」の移動が失われて位置がズレるため、
        // リサイズ後の現在のmatrixにおける(0,0)の位置を新しい原点(e,f)とする。
        const pt = new SVG.Point(0, 0).transform(currentMatrix);
        let newM = new SVG.Matrix(rs.mStart.a, rs.mStart.b, rs.mStart.c, rs.mStart.d, pt.x, pt.y);

        // [NEW] 反転が行われていた場合は、ローカル空間の反転スケールを乗算して新matrixに適用する
        if (signX < 0 || signY < 0) {
            const MatrixClass = rs.mStart.constructor;
            // ローカル原点 (0,0) を基準にスケール反転を行う
            newM = newM.multiply(new MatrixClass().scale(signX, signY, 0, 0));
        }

        this.el.matrix(newM);

        // パスを新しいパラメータで再生成
        this._regeneratePath();

        // 黄色マーカーの位置も更新
        this.updateMarkers();

        this.updateHitArea();
        this.syncSelectionHandlers();

        if (window.syncChanges) window.syncChanges();
        if (window.updateTransformToolbarValues) window.updateTransformToolbarValues();
    }
}

/**
 * Polyline/Line Shape Class
 * [NEW] リサイズハンドル(8点マーカー)とコネクタポイントを無効化するクラス
 */
class PolylineShape extends StandardShape {
    init() {
        super.init();
        console.log('[PolylineShape] init', this.el.id());
        // 線自体にはコネクタポイントを表示しない
        this.el.attr('data-no-connector', 'true');
    }

    applySelectionUI() {
        console.log('[PolylineShape] applySelectionUI', this.el.id());
        // 1. 標準の選択・リサイズ・回転UIを適用
        super.applySelectionUI();

        // 2. 頂点ハンドラの更新 (SvgPolylineHandler) は applySelectionUI 内の syncSelectionHandlers で呼ばれる
    }


}

// Global registry or factory if needed
function wrapShape(el) {
    if (el.hasClass('svg-canvas-proxy')) {
        return new CanvasShape(el);
    }

    const tagName = el.node.tagName.toLowerCase();
    const id = el.id();

    // [NEW] 矢印要素は ArrowShape へ
    const arrowToolId = el.attr('data-tool-id');
    if (tagName === 'path' && (
        arrowToolId === 'straight_arrow' || arrowToolId === 'curved_arrow' || arrowToolId === 'uturn_arrow' ||
        arrowToolId === 'straight_both_arrow' || arrowToolId === 'curved_both_arrow' || arrowToolId === 'uturn_both_arrow'
    )) {
        console.log('[wrapShape] Mapping', id, 'to ArrowShape');
        return new ArrowShape(el);
    }

    // [NEW] Use PolylineShape for line/polyline elements
    if (tagName === 'polyline' || tagName === 'line' || (tagName === 'path' && ['polyline', 'line', 'arrow', 'freehand', 'polyline_arrow'].includes(el.attr('data-tool-id')))) {
        console.log('[wrapShape] Mapping', id, tagName, 'to PolylineShape');
        return new PolylineShape(el);
    }

    console.log('[wrapShape] Mapping', id, tagName, 'to StandardShape');
    return new StandardShape(el);
}

// Export to window
window.SvgShape = SvgShape;
window.StandardShape = StandardShape;
window.CanvasShape = CanvasShape;
window.PolylineShape = PolylineShape;
window.wrapShape = wrapShape;
