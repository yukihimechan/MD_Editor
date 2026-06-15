/**
 * SVG Container Manager
 * コンテナ（入れ物図形）の生成・所属管理・自動リサイズ・子要素追従・グロー表示を担当する。
 * 
 * 設計方針:
 * - 子要素はコンテナ <g> の中に DOM 移動しない（属性で論理的に管理）
 * - data-container="true" でコンテナを識別
 * - data-container-children="id1,id2" で子要素リストを保持
 * - data-container-id="container_1" で子要素側から所属先を参照
 */

const SVGContainerManager = (() => {

    // --- 定数 ---
    const CONTAINER_PADDING = 20;       // コンテナと子要素の間の余白(px)
    const MIN_WIDTH = 80;               // コンテナの最小幅
    const MIN_HEIGHT = 60;              // コンテナの最小高さ
    const LABEL_FONT_SIZE = 12;         // ラベルのフォントサイズ
    const LABEL_OFFSET_Y = 16;          // ラベルの上端からのオフセット
    const GLOW_CLASS = 'container-glow'; // グロー表示用CSSクラス

    // --- 内部状態 ---
    // ドラッグ開始時の子要素の位置を記録するマップ: { childId: { x, y, matrix } }
    let _dragStartChildPositions = new Map();
    // ドラッグ中のコンテナ自身の開始位置
    let _dragStartContainerPos = null;
    // 現在グロー中のコンテナ要素
    let _glowingContainer = null;

    /**
     * コンテナ要素を生成してキャンバスに配置する
     * @param {SVG.Doc} draw - SVG.js のルートオブジェクト
     * @param {number} x - 配置するX座標
     * @param {number} y - 配置するY座標
     * @param {number} w - 幅
     * @param {number} h - 高さ
     * @param {string} label - ラベルテキスト
     * @returns {SVG.G} 生成されたコンテナグループ要素
     */
    function createContainer(draw, x, y, w, h, label = 'コンテナ') {
        if (!draw) return null;

        const group = draw.group();
        group.attr({
            'data-tool-id': 'container',
            'data-container': 'true',
            'data-container-children': '',
            'data-label': label
        });

        // 背景矩形
        const bg = group.rect(w, h)
            .move(x, y)
            .fill('rgba(230,243,255,0.3)')
            .stroke({ color: '#0078d4', width: 1.5, dasharray: '6,3' })
            .attr('rx', 8)
            .addClass('container-bg');

        // ラベルテキスト
        const labelX = x + 6;
        const text = group.text(label)
            .move(labelX, y + 4)
            .font({ size: LABEL_FONT_SIZE, family: 'sans-serif' })
            .fill('#555')
            .addClass('container-label');
        // tspan の x 属性を明示的に設定（getBBox計算の一貫性確保）
        text.children().forEach(tspan => {
            if (tspan.type === 'tspan') tspan.attr('x', labelX);
        });
        // ラベルはポインターイベントを透過させる
        text.css('pointer-events', 'none');

        console.log(`[SVGContainerManager] Created container #${group.id()} at (${x}, ${y}) size ${w}x${h}`);
        return group;
    }

    /**
     * 子要素をコンテナに追加する
     * @param {string} containerId - コンテナのID
     * @param {SVG.Element} childEl - 追加する子要素
     */
    function addChild(containerId, childEl) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const draw = window.currentEditingSVG.draw;

        // [GUARD] コンテナ自身の構成要素（背景、ラベル、グロー）は子要素として追加しない
        if (childEl.hasClass('container-bg') || childEl.hasClass('container-label') || childEl.hasClass('container-glow')) {
            return;
        }

        const containers = draw.find(`#${containerId}`);
        if (containers.length === 0) return;
        const containerEl = containers[0];

        if (containerEl.attr('data-container') !== 'true') return;

        const childId = childEl.id();
        if (!childId) return;

        // 同じコンテナに既に属している場合はスキップ
        const existing = _getChildrenIds(containerEl);
        if (existing.includes(childId)) return;

        // 他のコンテナから離脱
        const oldContainerId = childEl.attr('data-container-id');
        if (oldContainerId && oldContainerId !== containerId) {
            removeChild(oldContainerId, childEl);
        }

        // 追加
        existing.push(childId);
        containerEl.attr('data-container-children', existing.join(','));
        childEl.attr('data-container-id', containerId);

        console.log(`[SVGContainerManager] Added child #${childId} to container #${containerId}`);

        // 自動リサイズ
        autoResize(containerId);
    }

    /**
     * 子要素をコンテナから除去する
     * @param {string} containerId - コンテナのID
     * @param {SVG.Element} childEl - 除去する子要素
     */
    function removeChild(containerId, childEl) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const draw = window.currentEditingSVG.draw;

        const containers = draw.find(`#${containerId}`);
        if (containers.length === 0) return;
        const containerEl = containers[0];

        const childId = childEl.id();
        if (!childId) return;

        const children = _getChildrenIds(containerEl);
        const newChildren = children.filter(id => id !== childId);
        containerEl.attr('data-container-children', newChildren.join(','));

        // 子要素側の参照も除去
        childEl.attr('data-container-id', null);

        console.log(`[SVGContainerManager] Removed child #${childId} from container #${containerId}`);

        // 自動リサイズ
        autoResize(containerId);
    }

    /**
     * 指定座標に存在するコンテナを検索する
     * @param {Object} pt - {x, y} 座標
     * @param {Set<string>} excludeIds - 除外するID群（ドラッグ中の要素自身など）
     * @returns {SVG.Element|null} 見つかったコンテナ要素
     */
    function findContainerAt(pt, excludeIds = new Set()) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return null;
        const draw = window.currentEditingSVG.draw;

        // すべてのコンテナ要素を取得（後ろにある＝上にある要素が優先）
        const containers = [];
        draw.children().each(child => {
            if (child.attr('data-container') === 'true' && !excludeIds.has(child.id())) {
                containers.push(child);
            }
        });

        // 上（後ろ）から順に判定
        for (let i = containers.length - 1; i >= 0; i--) {
            const containerEl = containers[i];
            try {
                const bg = containerEl.findOne('.container-bg');
                if (!bg) continue;
                const box = bg.bbox();
                const m = containerEl.matrix() || new SVG.Matrix();
                const tBox = new SVG.Box(box).transform(m);

                if (pt.x >= tBox.x && pt.x <= tBox.x2 &&
                    pt.y >= tBox.y && pt.y <= tBox.y2) {
                    return containerEl;
                }
            } catch (e) {
                console.warn('[SVGContainerManager] findContainerAt error:', e);
            }
        }
        return null;
    }

    /**
     * 指定のBBoxと少しでも交差（重なり）しているコンテナを検索する
     * @param {SVG.Box} dBox - ドラッグ中の要素のBBox
     * @param {Set<string>} excludeIds - 除外するID群
     * @returns {SVG.Element|null} 見つかったコンテナ要素
     */
    function findContainerIntersecting(dBox, excludeIds = new Set()) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return null;
        if (dBox.width <= 0 || dBox.height <= 0) return null;

        const draw = window.currentEditingSVG.draw;
        const containers = [];
        draw.children().each(child => {
            if (child.attr('data-container') === 'true' && !excludeIds.has(child.id())) {
                containers.push(child);
            }
        });

        // 上（後ろ）から順に判定
        for (let i = containers.length - 1; i >= 0; i--) {
            const containerEl = containers[i];
            try {
                const bg = containerEl.findOne('.container-bg');
                if (!bg) continue;
                const box = bg.bbox();
                const m = containerEl.matrix() || new SVG.Matrix();
                const cBox = new SVG.Box(box).transform(m);

                // 交差判定 (AABB)
                const intersects = !(dBox.x2 < cBox.x || 
                                     cBox.x2 < dBox.x || 
                                     dBox.y2 < cBox.y || 
                                     cBox.y2 < dBox.y);
                if (intersects) {
                    return containerEl;
                }
            } catch (e) {
                console.warn('[SVGContainerManager] findContainerIntersecting error:', e);
            }
        }
        return null;
    }

    /**
     * コンテナを子要素のバウンディングボックスに合わせて自動リサイズする
     * @param {string} containerId - コンテナのID
     */
    function autoResize(containerId) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const draw = window.currentEditingSVG.draw;

        const containers = draw.find(`#${containerId}`);
        if (containers.length === 0) return;
        const containerEl = containers[0];

        const childIds = _getChildrenIds(containerEl);
        if (childIds.length === 0) {
            // 子要素がない場合はデフォルトサイズを維持
            return;
        }

        // 子要素のバウンディングボックスを計算
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let validCount = 0;

        for (const childId of childIds) {
            const children = draw.find(`#${childId}`);
            if (children.length === 0) continue;
            const child = children[0];

            try {
                const m = child.matrix() || new SVG.Matrix();
                const box = child.bbox().transform(m);
                if (box.width <= 0 && box.height <= 0) continue;

                minX = Math.min(minX, box.x);
                minY = Math.min(minY, box.y);
                maxX = Math.max(maxX, box.x2);
                maxY = Math.max(maxY, box.y2);
                validCount++;
            } catch (e) {
                console.warn(`[SVGContainerManager] autoResize: Failed to get bbox for #${childId}`, e);
            }
        }

        if (validCount === 0) return;

        // ラベル分の上部スペースを確保
        const labelHeight = LABEL_OFFSET_Y + 4;

        // パディングを適用してコンテナサイズを決定
        const newX = minX - CONTAINER_PADDING;
        const newY = minY - CONTAINER_PADDING - labelHeight;
        const newW = Math.max(MIN_WIDTH, (maxX - minX) + CONTAINER_PADDING * 2);
        const newH = Math.max(MIN_HEIGHT, (maxY - minY) + CONTAINER_PADDING * 2 + labelHeight);

        // 背景矩形とラベルを更新
        const bg = containerEl.findOne('.container-bg');
        const label = containerEl.findOne('.container-label');

        if (bg) {
            bg.move(newX, newY).size(newW, newH);
        }
        if (label) {
            const labelX = newX + 6;
            const labelY = newY + 4;
            label.move(labelX, labelY);
            // tspan の x 属性も同期（getBBox肥大化を防止）
            label.children().forEach(tspan => {
                if (tspan.type === 'tspan' && tspan.node.hasAttribute('x')) {
                    tspan.attr('x', labelX);
                }
            });
        }

        console.log(`[SVGContainerManager] autoResize #${containerId} -> (${newX}, ${newY}) ${newW}x${newH}`);
    }

    /**
     * コンテナ移動時に子要素を追従させる
     * @param {string} containerId - コンテナのID
     * @param {number} dx - X方向の移動量
     * @param {number} dy - Y方向の移動量
     */
    function moveChildrenBy(containerId, dx, dy) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        if (dx === 0 && dy === 0) return;

        const draw = window.currentEditingSVG.draw;
        const containers = draw.find(`#${containerId}`);
        if (containers.length === 0) return;
        const containerEl = containers[0];

        const childIds = _getChildrenIds(containerEl);

        for (const childId of childIds) {
            const children = draw.find(`#${childId}`);
            if (children.length === 0) continue;
            const child = children[0];

            // 子要素が選択中（ドラッグ中）の場合はスキップ（二重移動を防ぐ）
            if (window.currentEditingSVG.selectedElements &&
                window.currentEditingSVG.selectedElements.has(child)) {
                continue;
            }

            try {
                const startPos = _dragStartChildPositions.get(childId);
                if (startPos) {
                    // 初期位置からの相対移動
                    const m = startPos.matrix;
                    const newM = new SVG.Matrix(m).translate(dx, dy);
                    child.transform(newM);
                }
            } catch (e) {
                console.warn(`[SVGContainerManager] moveChildrenBy: Failed to move #${childId}`, e);
            }
        }
    }

    /**
     * グロー表示を開始する
     * @param {SVG.Element} containerEl - コンテナ要素
     */
    function showGlow(containerEl) {
        if (!containerEl || _glowingContainer === containerEl) return;

        // 既存のグローを除去
        hideAllGlow();

        const bg = containerEl.findOne('.container-bg');
        if (bg) {
            bg.stroke({ color: '#0078d4', width: 2.5 });
            bg.fill('rgba(0, 120, 212, 0.08)');
        }
        containerEl.addClass(GLOW_CLASS);
        _glowingContainer = containerEl;
    }

    /**
     * グロー表示を除去する
     * @param {SVG.Element} containerEl - コンテナ要素（省略時は全コンテナ）
     */
    function hideGlow(containerEl) {
        if (!containerEl) return;

        const bg = containerEl.findOne('.container-bg');
        if (bg) {
            bg.stroke({ color: '#0078d4', width: 1.5 });
            bg.fill('rgba(230,243,255,0.3)');
        }
        containerEl.removeClass(GLOW_CLASS);
        if (_glowingContainer === containerEl) {
            _glowingContainer = null;
        }
    }

    /**
     * すべてのグロー表示を除去する
     */
    function hideAllGlow() {
        if (_glowingContainer) {
            hideGlow(_glowingContainer);
        }
    }

    // =============================================
    //  ドラッグイベントフック (SvgShape.js から呼び出し)
    // =============================================

    /**
     * ドラッグ開始時の処理
     * コンテナをドラッグする場合、子要素の初期位置を記録する
     * @param {SVG.Element} el - ドラッグ開始した要素
     */
    function onDragStart(el) {
        _dragStartChildPositions.clear();
        _dragStartContainerPos = null;

        if (!el || el.attr('data-container') !== 'true') return;

        const containerId = el.id();
        if (!containerId) return;

        // コンテナ自身の初期位置を記録
        try {
            _dragStartContainerPos = {
                matrix: new SVG.Matrix(el)
            };
        } catch (e) {}

        // 子要素の初期位置を記録
        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        if (!draw) return;

        const childIds = _getChildrenIds(el);
        for (const childId of childIds) {
            const children = draw.find(`#${childId}`);
            if (children.length === 0) continue;
            const child = children[0];
            try {
                _dragStartChildPositions.set(childId, {
                    matrix: new SVG.Matrix(child),
                    x: child.x(),
                    y: child.y()
                });
            } catch (e) {}
        }
    }

    /**
     * ドラッグ移動中の処理
     * - コンテナの場合: 子要素を追従させる
     * - 非コンテナの場合: ドロップ候補コンテナにグローを表示
     * @param {SVG.Element} el - ドラッグ中の要素
     * @param {number} dx - X移動量（ドラッグ開始からの累計）
     * @param {number} dy - Y移動量（ドラッグ開始からの累計）
     * @param {Object} pt - 現在のSVG座標 {x, y}
     */
    function onDragMove(el, dx, dy, pt) {
        if (!el) return;

        if (el.attr('data-container') === 'true') {
            // コンテナの移動 → 子要素追従
            moveChildrenBy(el.id(), dx, dy);
        } else {
            // 非コンテナの移動 → ドロップ候補にグロー表示
            const excludeIds = new Set();
            if (el.id()) excludeIds.add(el.id());
            // 選択中の全要素を除外
            if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
                window.currentEditingSVG.selectedElements.forEach(sel => {
                    if (sel.id()) excludeIds.add(sel.id());
                });
            }

            const dBox = _getDraggedElementsBBox(el);
            const target = findContainerIntersecting(dBox, excludeIds);
            if (target) {
                showGlow(target);
            } else {
                hideAllGlow();
            }
        }
    }

    /**
     * ドラッグ終了時のドロップ判定
     * @param {SVG.Element} el - ドラッグ終了した要素
     * @param {Object} pt - ドロップ位置のSVG座標 {x, y}
     */
    function handleDragEnd(el, pt) {
        hideAllGlow();
        _dragStartChildPositions.clear();
        _dragStartContainerPos = null;

        if (!el) return;

        // コンテナ自身のドロップは無視
        if (el.attr('data-container') === 'true') {
            // 子要素に付与されたtransformを座標属性に焼き込む
            const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
            if (draw) {
                const childIds = _getChildrenIds(el);
                for (const childId of childIds) {
                    const found = draw.find(`#${childId}`);
                    if (found.length === 0) continue;
                    const child = found[0];
                    const s = child.remember('_shapeInstance');
                    if (s && typeof s.bakeTransformation === 'function') {
                        s.bakeTransformation(true);
                    }
                }
            }
            // 子要素位置に基づいてコンテナを自動リサイズ
            autoResize(el.id());
            return;
        }

        const elId = el.id();
        if (!elId) return;

        // 選択中の全要素について処理
        const draggedElements = [];
        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.forEach(sel => {
                // コンテナ自身は除外
                if (sel.attr('data-container') !== 'true') {
                    draggedElements.push(sel);
                }
            });
        }
        if (draggedElements.length === 0) {
            draggedElements.push(el);
        }

        // ドロップ先のコンテナを検索
        const excludeIds = new Set();
        draggedElements.forEach(d => { if (d.id()) excludeIds.add(d.id()); });

        const dBox = _getDraggedElementsBBox(el);
        const targetContainer = findContainerIntersecting(dBox, excludeIds);

        for (const draggedEl of draggedElements) {
            const dId = draggedEl.id();
            if (!dId) continue;

            const currentContainerId = draggedEl.attr('data-container-id');

            if (targetContainer) {
                const targetId = targetContainer.id();
                // コンテナに追加
                addChild(targetId, draggedEl);
            } else if (currentContainerId) {
                // コンテナ外にドロップ → 所属解除
                removeChild(currentContainerId, draggedEl);
            }
        }
    }

    // =============================================
    //  DOM復元
    // =============================================

    /**
     * DOM属性からコンテナ関係を復元する
     * startSVGEdit時に呼び出される
     * @param {SVG.Doc} draw - SVG.js のルートオブジェクト
     */
    function restoreContainersFromDOM(draw) {
        if (!draw) return;

        let restoredCount = 0;
        draw.children().each(child => {
            if (child.attr('data-container') === 'true') {
                const containerId = child.id();
                const childrenStr = child.attr('data-container-children') || '';
                const childIds = childrenStr.split(',').filter(id => id.trim());

                // 子要素側の参照を検証・修復
                for (const childId of childIds) {
                    const found = draw.find(`#${childId}`);
                    if (found.length > 0) {
                        const childEl = found[0];
                        const existingRef = childEl.attr('data-container-id');
                        if (existingRef !== containerId) {
                            childEl.attr('data-container-id', containerId);
                        }
                        restoredCount++;
                    }
                }
            }
        });

        if (restoredCount > 0) {
            console.log(`[SVGContainerManager] Restored ${restoredCount} container-child relationships.`);
        }
    }

    /**
     * コンテナが削除される際に子要素の参照をクリーンアップする
     * @param {SVG.Element} containerEl - 削除されるコンテナ要素
     */
    function onContainerRemoved(containerEl) {
        if (!containerEl || containerEl.attr('data-container') !== 'true') return;
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const draw = window.currentEditingSVG.draw;

        const childIds = _getChildrenIds(containerEl);
        for (const childId of childIds) {
            const children = draw.find(`#${childId}`);
            if (children.length > 0) {
                children[0].attr('data-container-id', null);
            }
        }
        console.log(`[SVGContainerManager] Cleaned up ${childIds.length} children on container removal.`);
    }

    // =============================================
    //  内部ヘルパー
    // =============================================

    /**
     * ドラッグされている全要素を包含するBBoxを計算する
     * @param {SVG.Element} el - ドラッグ中の主要素
     * @returns {SVG.Box} 包含BBox
     */
    function _getDraggedElementsBBox(el) {
        const draggedElements = [];
        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.forEach(sel => {
                if (sel.attr('data-container') !== 'true') {
                    draggedElements.push(sel);
                }
            });
        }
        if (draggedElements.length === 0) {
            draggedElements.push(el);
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let valid = false;

        draggedElements.forEach(item => {
            try {
                const m = new SVG.Matrix(item);
                const box = item.bbox().transform(m);
                minX = Math.min(minX, box.x);
                minY = Math.min(minY, box.y);
                maxX = Math.max(maxX, box.x2);
                maxY = Math.max(maxY, box.y2);
                valid = true;
            } catch (e) {
                console.warn('[SVGContainerManager] Failed to get bbox for dragged element:', e);
            }
        });

        if (!valid) {
            return new SVG.Box(0, 0, 0, 0);
        }
        return new SVG.Box(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * コンテナ要素の子要素IDリストを取得する
     * @param {SVG.Element} containerEl
     * @returns {string[]}
     */
    function _getChildrenIds(containerEl) {
        const str = containerEl.attr('data-container-children') || '';
        return str.split(',').filter(id => id.trim());
    }

    // 公開API
    return {
        createContainer,
        addChild,
        removeChild,
        findContainerAt,
        autoResize,
        moveChildrenBy,
        showGlow,
        hideGlow,
        hideAllGlow,
        onDragStart,
        onDragMove,
        handleDragEnd,
        restoreContainersFromDOM,
        onContainerRemoved,
        // 定数のエクスポート（テスト用）
        CONTAINER_PADDING,
        MIN_WIDTH,
        MIN_HEIGHT
    };
})();

window.SVGContainerManager = SVGContainerManager;
