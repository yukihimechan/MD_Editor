/**
 * SVG Editor Operations
 * - File/Clipboard operations
 * - Group/Ungroup
 * - Z-index management
 */

var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);

// Global Clipboard for SVG Elements
window.SVGClipboard = {
    elements: [],
    pasteOffset: { x: 20, y: 20 }
};

function groupSelectedElements() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

    window.currentEditingSVG._isOperationInProgress = true;
    if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();

    // [PERF] Z-orderのソートを O(N^2) から O(N) に高速化
    const parentChildrenMap = new Map();
    const getIndex = (node) => {
        const parent = node.parentNode;
        if (!parent) return 0;
        if (!parentChildrenMap.has(parent)) {
            const children = Array.from(parent.children);
            const indexMap = new Map();
            for (let i = 0; i < children.length; i++) indexMap.set(children[i], i);
            parentChildrenMap.set(parent, indexMap);
        }
        return parentChildrenMap.get(parent).get(node) || 0;
    };

    const selected = Array.from(window.currentEditingSVG.selectedElements)
        .sort((a, b) => {
            if (a.node.parentNode !== b.node.parentNode) return 0;
            return getIndex(a.node) - getIndex(b.node);
        });

    if (selected.length < 2) {
        window.currentEditingSVG._isOperationInProgress = false;
        return;
    }

    if (selected.some(el => el.attr('data-locked') === 'true')) {
        console.warn('[groupSelectedElements] Cannot group: Locked element included.');
        window.currentEditingSVG._isOperationInProgress = false;
        return;
    }

    const first = selected[0];
    const group = first.parent().group();
    group.attr({ 'data-label': 'Group', 'data-tool-id': 'group' });
    first.before(group);

    // [PERF] ループ前に全体の選択を解除し、個別解除時のリフロー・再描画連鎖を防ぐ
    clearSelection();

    // [PERF] DOM移動をFragmentで一括化してリフローと再描画を削減
    const fragment = document.createDocumentFragment();

    selected.forEach(el => {
        const shape = el.remember('_shapeInstance');
        if (shape && typeof shape.destroy === 'function') shape.destroy();
        else if (shape && shape.hitArea) { shape.hitArea.remove(); shape.hitArea = null; }

        if (typeof el.draggable === 'function') el.draggable(false);
        try { if (typeof el.select === 'function') el.select(false); } catch(e){}
        try { if (typeof el.resize === 'function') el.resize(false); } catch(e){}
        el.off();
        el.removeClass('svg_select_isSelected');
        
        fragment.appendChild(el.node);
    });

    group.node.appendChild(fragment);

    if (typeof makeInteractive === 'function') makeInteractive(group);
    group.attr('pointer-events', 'all');

    // [PERF] 重い再帰関数での pointer-events 設定を削除し、ネイティブDOM APIによる一括処理へ置換
    const groupNode = group.node;
    if (groupNode && groupNode.querySelectorAll) {
        const childGroups = groupNode.querySelectorAll('g');
        for (let i = 0; i < childGroups.length; i++) {
            childGroups[i].setAttribute('pointer-events', 'all');
        }
        const nonGroups = groupNode.querySelectorAll('*:not(g)');
        for (let i = 0; i < nonGroups.length; i++) {
            if (nonGroups[i].getAttribute('pointer-events') !== 'none') {
                nonGroups[i].removeAttribute('pointer-events');
            }
        }
    }
    
    selectElement(group);

    window.currentEditingSVG._isOperationInProgress = false;
    syncChanges();
}
window.groupSelectedElements = groupSelectedElements;

function ungroupSelectedElements() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

    window.currentEditingSVG._isOperationInProgress = true;
    if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();

    const selected = Array.from(window.currentEditingSVG.selectedElements);
    const newSelection = [];
    
    // [PERF] 解除対象を含め全体の選択を先に解除し、個別操作によるUIの無駄な連鎖更新を防ぐ
    clearSelection();

    selected.forEach(el => {
        if (el.type === 'g') {
            if (el.attr('data-locked') === 'true') return;

            const childrenArray = el.children().map(c => c);
            const groupMatrix = new SVG.Matrix(el);
            
            // [PERF] 子要素の元の階層への復帰をFragmentで一括化
            const fragment = document.createDocumentFragment();

            childrenArray.forEach(function (child) {
                const childMatrix = new SVG.Matrix(child);
                child.matrix(groupMatrix.multiply(childMatrix));
                fragment.appendChild(child.node);

                const childShape = child.remember('_shapeInstance');
                if (childShape && childShape.hitArea) {
                    childShape.hitArea.remove();
                    childShape.hitArea = null;
                }

                newSelection.push(child);
            });

            // 親の前に一括挿入
            if (el.node.parentNode) {
                el.node.parentNode.insertBefore(fragment, el.node);
            }

            // DOMへ追加後、インタラクティブにする
            childrenArray.forEach(child => {
                 if (typeof makeInteractive === 'function' && !child.remember('_shapeInstance')) {
                     makeInteractive(child);
                 }
            });

            const groupShape = el.remember('_shapeInstance');
            if (groupShape && typeof groupShape.destroy === 'function') groupShape.destroy();
            else if (groupShape && groupShape.hitArea) { groupShape.hitArea.remove(); groupShape.hitArea = null; }
            
            el.remove();
        }
    });

    newSelection.forEach(el => selectElement(el, true));
    window.currentEditingSVG._isOperationInProgress = false;
    syncChanges();
}
window.ungroupSelectedElements = ungroupSelectedElements;

function moveSelectedToFront() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
    window.currentEditingSVG._isOperationInProgress = true;

    const parentChildrenMap = new Map();
    const getIndex = (node) => {
        const parent = node.parentNode;
        if (!parent) return 0;
        if (!parentChildrenMap.has(parent)) {
            const children = Array.from(parent.children);
            const indexMap = new Map();
            for (let i = 0; i < children.length; i++) indexMap.set(children[i], i);
            parentChildrenMap.set(parent, indexMap);
        }
        return parentChildrenMap.get(parent).get(node) || 0;
    };

    Array.from(window.currentEditingSVG.selectedElements)
        .sort((a, b) => (a.node.parentNode !== b.node.parentNode) ? 0 : getIndex(a.node) - getIndex(b.node))
        .forEach(el => {
            el.front();
            const shapeInstance = el.remember('_shapeInstance');
            if (shapeInstance && shapeInstance.hitArea) {
                shapeInstance.hitArea.insertBefore(el);
            }
        });

    window.currentEditingSVG._isOperationInProgress = false;
    syncChanges();
}
window.moveSelectedToFront = moveSelectedToFront;

function moveSelectedToBack() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
    window.currentEditingSVG._isOperationInProgress = true;
    const draw = window.currentEditingSVG.draw;

    const parentChildrenMap = new Map();
    const getIndex = (node) => {
        const parent = node.parentNode;
        if (!parent) return 0;
        if (!parentChildrenMap.has(parent)) {
            const children = Array.from(parent.children);
            const indexMap = new Map();
            for (let i = 0; i < children.length; i++) indexMap.set(children[i], i);
            parentChildrenMap.set(parent, indexMap);
        }
        return parentChildrenMap.get(parent).get(node) || 0;
    };

    Array.from(window.currentEditingSVG.selectedElements)
        .sort((a, b) => (a.node.parentNode !== b.node.parentNode) ? 0 : getIndex(b.node) - getIndex(a.node))
        .forEach(el => {
            const canvasProxy = draw.node.querySelector('.svg-canvas-proxy');
            const gridGroupNode = draw.node.querySelector('.svg-grid-lines');
            if (canvasProxy) {
                const parent = canvasProxy.parentNode;
                const nextSibling = canvasProxy.nextElementSibling;
                if (nextSibling) parent.insertBefore(el.node, nextSibling);
                else parent.appendChild(el.node);
            } else if (gridGroupNode) {
                const parent = gridGroupNode.parentNode;
                const nextSibling = gridGroupNode.nextElementSibling;
                if (nextSibling) parent.insertBefore(el.node, nextSibling);
                else parent.appendChild(el.node);
            } else {
                el.back();
            }
            const shapeInstance = el.remember('_shapeInstance');
            if (shapeInstance && shapeInstance.hitArea) {
                shapeInstance.hitArea.insertBefore(el);
            }
        });

    window.currentEditingSVG._isOperationInProgress = false;
    syncChanges();
}
window.moveSelectedToBack = moveSelectedToBack;

// Helper to recursively store original IDs on cloned elements
function storeOriginalIds(original, clone) {
    if (original.id()) {
        clone.attr('data-original-id', original.id());
    }
    const origChildren = original.children ? original.children() : [];
    const cloneChildren = clone.children ? clone.children() : [];

    if (origChildren.length === cloneChildren.length) {
        for (let i = 0; i < origChildren.length; i++) {
            storeOriginalIds(origChildren[i], cloneChildren[i]);
        }
    }
}

function copySelectedElements() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
    window.SVGClipboard.elements = [];
    
    // SVGコードを収集するための配列
    const svgCodeList = [];

    window.currentEditingSVG.selectedElements.forEach(el => {
        const clone = el.clone().remove();
        storeOriginalIds(el, clone);
        window.SVGClipboard.elements.push(clone);
        
        // クローンのSVG文字列を取得（外部アプリ連携用）
        try {
            svgCodeList.push(clone.svg());
        } catch(e) {}
    });
    
    // コピー時にオフセットを初期値にリセット（次の最初のペーストは20,20ずれた位置に配置）
    window.SVGClipboard.pasteOffset = { x: 20, y: 20 };
    console.log(`[SVG Copy] Copied ${window.SVGClipboard.elements.length} elements to clipboard.`);

    // システムクリップボードにもSVGコードをテキストとして書き込む
    if (svgCodeList.length > 0 && navigator.clipboard && navigator.clipboard.writeText) {
        const combinedSVG = svgCodeList.join('\n');
        navigator.clipboard.writeText(combinedSVG).catch(err => {
            console.warn('[SVG Copy] Failed to write to system clipboard:', err);
        });
    }
}
window.copySelectedElements = copySelectedElements;

async function pasteElements(container, nativeText = null) {
    if (!window.currentEditingSVG) return;
    const draw = window.currentEditingSVG.draw;

    // 貼り付け位置の管理変数の初期化（最後の貼り付け位置を記憶）
    if (!window.currentEditingSVG.lastPastePosition) {
        window.currentEditingSVG.lastPastePosition = { x: 0, y: 0, timestamp: 0 };
    }

    // SVGクリップボードに図形がある場合は既存の動作
    if (window.SVGClipboard.elements.length > 0) {
        clearSelection();

        const pastedElements = [];
        const idMap = new Map();

        // 1. Paste all elements and build ID map (Original ID -> New ID)
        window.SVGClipboard.elements.forEach(originalModel => {
            const clone = originalModel.clone();

            // [NEW] Clear remember memory leaks to avoid reusing stale instances on cloned elements
            const clearRememberData = (el) => {
                if (el && typeof el.forget === 'function') {
                    el.forget('_shapeInstance');
                    el.forget('_selectHandler');
                    el.forget('_pointSelectHandler');
                    el.forget('_resizeState');
                }
            };
            clearRememberData(clone);
            clone.find('*').forEach(child => clearRememberData(child));

            // Offset
            const dx = window.SVGClipboard.pasteOffset.x;
            const dy = window.SVGClipboard.pasteOffset.y;
            clone.dmove(dx, dy);

            // [FIX] Sync tspan coordinates if they are absolute.
            // SVG.js dmove() might not update absolute x/y on nested tspans of a text element.
            if (clone.type === 'text' || clone.find('text').length > 0) {
                const textEls = clone.type === 'text' ? [clone] : clone.find('text');
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

            // [NEW] Sync metadata points (data-poly-points, etc.) for paths/lines
            if (window.SVGUtils && window.SVGUtils.offsetPathMetadata) {
                window.SVGUtils.offsetPathMetadata(clone, dx, dy);
            }

            draw.add(clone);

            // Map the root element ID
            // Use data-original-id if available, otherwise originalModel.id()
            const origIdRoot = originalModel.attr('data-original-id') || originalModel.id();
            if (origIdRoot && clone.id()) {
                idMap.set(origIdRoot, clone.id());
            }

            // Map all descendant element IDs
            const originalDescendants = originalModel.find('*');
            const cloneDescendants = clone.find('*');

            // Assuming structure is identical (it should be for a clone)
            if (originalDescendants.length === cloneDescendants.length) {
                for (let i = 0; i < originalDescendants.length; i++) {
                    const origDesc = originalDescendants[i];
                    const cloneDesc = cloneDescendants[i];
                    const origId = origDesc.attr('data-original-id') || origDesc.id();
                    const newId = cloneDesc.id();

                    if (origId && newId) {
                        idMap.set(origId, newId);
                    }
                }
            }

            pastedElements.push(clone);
        });

        console.log(`[SVG Paste] ID Map created with ${idMap.size} entries.`);
        // Debug map contents
        // for (const [k, v] of idMap.entries()) {
        //    console.log(`  ${k} -> ${v}`);
        // }

        // 2. Remap connector targets
        // Helper to find all connectors (lines/polylines) recursively
        const findConnectors = (element) => {
            let results = [];
            if (element.type === 'polyline' || element.type === 'line' || element.type === 'path') {
                results.push(element);
            }
            if (element.children) {
                element.children().forEach(child => {
                    results = results.concat(findConnectors(child));
                });
            }
            return results;
        };

        const allPastedConnectors = [];
        pastedElements.forEach(el => {
            allPastedConnectors.push(...findConnectors(el));
        });

        allPastedConnectors.forEach(el => {
            // Check for connector data in 'polyline' or 'line'
            // Update <connector-data> tags
            const connectors = el.node.querySelectorAll('connector-data');
            connectors.forEach(c => {
                const targetId = c.getAttribute('target');
                if (idMap.has(targetId)) {
                    const newTargetId = idMap.get(targetId);
                    c.setAttribute('target', newTargetId);
                    console.log(`[SVG Paste] Remapped connector target: ${targetId} -> ${newTargetId}`);
                } else {
                    console.log(`[SVG Paste] Dropping orphaned connector-data for target: ${targetId}`);
                    c.remove();
                }
            });

            // Update data-connections attribute (JSON)
            const dataConn = el.attr('data-connections');
            if (dataConn) {
                try {
                    const conns = JSON.parse(dataConn);
                    const validConns = [];
                    let modified = false;
                    conns.forEach(c => {
                        if (idMap.has(c.targetId)) {
                            console.log(`[SVG Paste] Found connection to re-map: ${c.targetId} -> ${idMap.get(c.targetId)}`);
                            c.targetId = idMap.get(c.targetId);
                            validConns.push(c);
                            modified = true;
                        } else {
                            console.log(`[SVG Paste] Connection target ${c.targetId} NOT found in idMap. Dropping connection.`);
                            modified = true;
                        }
                    });
                    if (modified) {
                        if (validConns.length > 0) {
                            el.attr('data-connections', JSON.stringify(validConns));
                        } else {
                            el.node.removeAttribute('data-connections');
                        }
                    }
                } catch (e) {
                    console.warn('[SVG Paste] Failed to parse data-connections:', e);
                }
            }
        });

        // 2.5 [FIX] Remap text/shape associations to prevent zombie texts
        pastedElements.forEach(clone => {
            const allElements = [clone, ...clone.find('*')];
            allElements.forEach(el => {
                if (el.node && el.node.setAttribute) {
                    const textId = el.attr('data-associated-text-id');
                    if (textId && idMap.has(textId)) {
                        el.attr('data-associated-text-id', idMap.get(textId));
                        console.log(`[SVG Paste] Remapped associated-text-id: ${textId} -> ${idMap.get(textId)}`);
                    }

                    const shapeId = el.attr('data-associated-shape-id');
                    if (shapeId && idMap.has(shapeId)) {
                        el.attr('data-associated-shape-id', idMap.get(shapeId));
                        console.log(`[SVG Paste] Remapped associated-shape-id: ${shapeId} -> ${idMap.get(shapeId)}`);
                    }
                }
            });
        });

        // 2.75 [FIX] コピー＆ペーストしたコンテナの移動時にコピー元の要素が動いてしまうバグを防ぐため、親子ID関係をリマップ
        pastedElements.forEach(clone => {
            const allElements = [clone, ...clone.find('*')];
            allElements.forEach(el => {
                if (el.node && el.node.setAttribute) {
                    // 子要素側の data-container-id リマップ
                    const containerId = el.attr('data-container-id');
                    if (containerId) {
                        if (idMap.has(containerId)) {
                            const newContainerId = idMap.get(containerId);
                            el.attr('data-container-id', newContainerId);
                            console.log(`[SVG Paste] Remapped data-container-id: ${containerId} -> ${newContainerId}`);
                        } else {
                            // コピー元のコンテナは一緒にコピーされなかったため、参照を解除
                            el.node.removeAttribute('data-container-id');
                            console.log(`[SVG Paste] Cleared data-container-id: ${containerId} (not in idMap)`);
                        }
                    }

                    // 親コンテナ側の data-container-children リマップ
                    if (el.attr('data-container') === 'true') {
                        const childrenStr = el.attr('data-container-children') || '';
                        const childIds = childrenStr.split(',').filter(id => id.trim());
                        const newChildIds = [];
                        childIds.forEach(cId => {
                            if (idMap.has(cId)) {
                                newChildIds.push(idMap.get(cId));
                            }
                        });
                        if (newChildIds.length > 0) {
                            el.attr('data-container-children', newChildIds.join(','));
                            console.log(`[SVG Paste] Remapped data-container-children: ${childrenStr} -> ${newChildIds.join(',')}`);
                        } else {
                            el.attr('data-container-children', '');
                            console.log(`[SVG Paste] Cleared data-container-children: ${childrenStr}`);
                        }
                    }
                }
            });
        });

        // 3. Finalize
        pastedElements.forEach(clone => {
            // [NEW] ペーストされた要素が元図形のマーカーを共有しないよう、個別のマーカーを即座に再生成する
            if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                window.SVGToolbar.updateArrowMarkers(clone);
            }
            makeInteractive(clone);

            // [NEW] ペースト直後に transform (dmove 等で追加された平行移動) を子要素に焼き込み、
            // グループ要素の transform をクリアしておくことで、ダブルクリック時の transform 競合や
            // 他のプラグインとの座標競合を防止する
            const shapeInstance = clone.remember('_shapeInstance');
            if (shapeInstance && typeof shapeInstance.bakeTransformation === 'function') {
                shapeInstance.bakeTransformation();
            }

            selectElement(clone, true);
        });

        syncChanges();

        // 連続ペースト時に次の配置位置をずらす
        window.SVGClipboard.pasteOffset.x += 20;
        window.SVGClipboard.pasteOffset.y += 20;
        return;
    }

    // SVGクリップボードが空の場合、システムクリップボードからテキストを取得
    try {
        let text = nativeText;
        if (text === null || text === undefined) {
            text = await navigator.clipboard.readText().catch(() => null);
        }

        if (!text || text.trim() === '') {
            console.log('[SVG Paste] No text in clipboard');
            return;
        }

        let targetShape = null;

        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements.size === 1) {
            const selected = Array.from(window.currentEditingSVG.selectedElements)[0];
            const type = selected.type;
            if (['path', 'circle', 'ellipse', 'rect', 'polygon', 'line'].includes(type) && !selected.hasClass('svg-canvas-proxy')) {
                targetShape = selected;
            }
        }

        clearSelection();

        let textEl;
        let pasteX = 0, pasteY = 0;
        const now = Date.now();

        if (targetShape) {
            // [FIX] Older WebView engines reject <textPath> on non-path elements like <ellipse>.
            // We convert everything to a explicit <path> here implicitly before binding.
            if (targetShape.type !== 'path' && window.SVGPathOps && window.SVGPathOps.convertToPathData) {
                const isCircleOrEllipse = (targetShape.type === 'circle' || targetShape.type === 'ellipse');
                // [NEW] Pass true for loopForText if it's a circle/ellipse to prevent text from clipping at the start point.
                const d = window.SVGPathOps.convertToPathData(targetShape, null, isCircleOrEllipse);
                if (d) {
                    const newPath = draw.path(d);
                    const attrsToCopy = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'transform'];
                    attrsToCopy.forEach(attr => {
                        const val = targetShape.attr(attr);
                        if (val !== undefined && val !== null) newPath.attr(attr, val);
                    });

                    if (isCircleOrEllipse) {
                        newPath.attr('data-loops', '3');
                    }

                    targetShape.before(newPath);
                    targetShape.remove();
                    targetShape = newPath;

                    if (typeof makeInteractive === 'function') makeInteractive(targetShape);
                }
            }

            if (!targetShape.id()) {
                targetShape.id(`shape-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
            }
            const shapeId = targetShape.id();

            textEl = draw.text('')
                .font({ size: 20, family: 'sans-serif' })
                .fill('#000000');

            // [FIX] Explicitly remove 'x' and 'y' to prevent the bounding box from 
            // artificially stretching back to (0,0) when a textPath displaces the text.
            textEl.node.removeAttribute('x');
            textEl.node.removeAttribute('y');

            const textPath = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
            textPath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + shapeId);
            textPath.setAttribute('href', '#' + shapeId);

            if (targetShape.attr('data-loops') === '3') {
                textPath.setAttribute('startOffset', '33.33%');
            } else {
                textPath.setAttribute('startOffset', '0%');
            }

            textPath.textContent = text;

            textEl.node.appendChild(textPath);
        } else {
            // 貼り付け位置を計算（連続貼り付けの場合は位置をずらす）
            const timeSinceLastPaste = now - window.currentEditingSVG.lastPastePosition.timestamp;

            if (timeSinceLastPaste < 5000) {
                // 5秒以内の連続貼り付けの場合は位置をずらす
                pasteX = window.currentEditingSVG.lastPastePosition.x + 10;
                pasteY = window.currentEditingSVG.lastPastePosition.y + 10;
            } else {
                // 初回または間隔が開いた場合は (0, 0) から開始
                pasteX = 0;
                pasteY = 0;
            }

            // キャンバス座標系に変換（CanvasProxyの位置を考慮）
            const proxy = window.currentEditingSVG.canvasProxy;
            const canvasX = proxy ? proxy.x() : 0;
            const canvasY = proxy ? proxy.y() : 0;
            const inset = window.currentEditingSVG.canvasInset || 0;

            const absoluteX = canvasX + inset + pasteX;
            const absoluteY = canvasY + inset + pasteY;

            // テキストオブジェクトを作成
            textEl = draw.text(text)
                .font({ size: 20, family: 'sans-serif' })
                .fill('#000000')
                .move(absoluteX, absoluteY);
        }

        // インタラクティブにして選択
        makeInteractive(textEl);
        selectElement(textEl, true);

        // 最後の貼り付け位置を更新
        window.currentEditingSVG.lastPastePosition = { x: pasteX, y: pasteY, timestamp: now };

        syncChanges();

        console.log(`[SVG Paste] Pasted text at (${pasteX}, ${pasteY}): "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
    } catch (err) {
        console.warn('[SVG Paste] Failed to read clipboard:', err);
    }
}
window.pasteElements = pasteElements;

function deleteSelectedElements() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
    window.currentEditingSVG.selectedElements.forEach(el => {
        // キャンバス自体のプロキシおよびロックされた要素は削除しない
        if (!el.hasClass('svg-canvas-proxy') && el.attr('data-locked') !== 'true') {
            // [NEW] Use shape.destroy() for complete cleanup (markers, hitArea, etc.)
            const shape = el.remember('_shapeInstance');
            if (shape && typeof shape.destroy === 'function') {
                shape.destroy();
            }

            // [NEW] コンテナ削除時に子要素の参照をクリーンアップ
            if (window.SVGContainerManager && el.attr('data-container') === 'true') {
                window.SVGContainerManager.onContainerRemoved(el);
            }

            el.remove();
        }
    });

    if (typeof clearSelection === 'function') {
        clearSelection();
    } else {
        if (typeof deselectAll === 'function') deselectAll();
    }
    syncChanges();
}
window.deleteSelectedElements = deleteSelectedElements;

function addToToolbar(container) {
    if (window.currentEditingSVG.selectedElements.size !== 1) {
        alert(t('alert.selectOneForToolbar'));
        return;
    }

    // Check if SVGToolbar is available
    if (typeof SVGToolbar === 'undefined' || typeof SVGToolbar.addCustomTool !== 'function') {
        alert(t('alert.customToolUnavailable'));
        return;
    }

    const selected = window.currentEditingSVG.selectedElements.values().next().value;

    // [FIX] Canvas Proxy はツールバーに追加できない
    if (selected.hasClass('svg-canvas-proxy')) {
        alert(t('alert.selectOneForToolbar'));
        return;
    }

    // Ask for name
    const name = prompt(t('svgEditor.operations.enterCustomToolName') || 'ツールバーに追加する名前を入力してください:', t('svgEditor.operations.defaultCustomShape') || 'カスタム図形');
    if (!name) return;

    // [FIX] 絶対変換行列 (CTM) に基づく完全な正規化
    // 1. 描画領域に対する絶対的なバウンディングボックスを取得
    const rbox = selected.rbox(window.currentEditingSVG.draw);
    const finalPadding = 5;

    // 2. 要素を複製して一時的な空間で処理
    const tempGroup = window.currentEditingSVG.draw.group();
    const clone = selected.clone().addTo(tempGroup);
    clone.removeClass('svg_select_isSelected');

    // 3. 要素の「現在の見た目」を完全に再現する絶対行列を取得
    // ネストされたグループの影響をすべて含んでいる
    let matrix = selected.ctm();

    // 4. 行列に「原点(padding)への移動」を合成する
    // 見た目上の左上を (finalPadding, finalPadding) に持ってくる
    matrix.e = matrix.e - rbox.x + finalPadding;
    matrix.f = matrix.f - rbox.y + finalPadding;

    // クローンのローカル変換をこの絶対行列で上書きする
    clone.matrix(matrix);

    // 5. 最終的なSVG内容と viewBox を決定
    const svgContent = clone.svg();
    const viewBox = {
        x: 0,
        y: 0,
        width: Math.ceil(rbox.width + finalPadding * 2),
        height: Math.ceil(rbox.height + finalPadding * 2)
    };

    // クリーンアップ
    tempGroup.remove();

    // 6. ツールバーに追加
    SVGToolbar.addCustomTool(name, svgContent, viewBox);

    // Feedback
    console.log(`[SVG] Custom tool added (Absolute): ${name}, viewBox: 0 0 ${viewBox.width} ${viewBox.height}`);
}
window.addToToolbar = addToToolbar;

function clearSelection() {
    if (typeof deselectAll === 'function') deselectAll();
}
window.clearSelection = clearSelection;
