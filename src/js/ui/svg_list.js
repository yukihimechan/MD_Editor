/**
 * SVG List (Layer Panel) Core Logic
 * Handles tree generation, synchronization with SVG editor, and structural editing.
 */

// Track collapse state [id] -> boolean
window._svgListCollapsedState = window._svgListCollapsedState || {};

// Helper to get element details (handles both SVG.js objects and raw DOM nodes)
function getSvgListElDetails(el) {
    if (el.node) { // SVG.js object
        return {
            id: el.id(),
            type: el.type,
            label: el.attr('data-label') || '',
            visible: el.visible(),
            locked: el.attr('data-locked') === 'true',
            hasClass: (c) => el.hasClass(c),
            getAttr: (n) => el.attr(n),
            children: () => el.children ? el.children() : []
        };
    } else { // Native DOM node
        const id = el.id || el.getAttribute('id');
        const type = el.tagName.toLowerCase();
        return {
            id: id,
            type: type,
            label: el.getAttribute('data-label') || '',
            visible: el.getAttribute('display') !== 'none' && el.style.display !== 'none',
            locked: el.getAttribute('data-locked') === 'true',
            hasClass: (c) => el.classList.contains(c),
            getAttr: (n) => el.getAttribute(n),
            children: () => Array.from(el.children)
        };
    }
}

// Consistently define skip criteria
function isSvgElementSkipped(d) {
    const did = d.id || '';
    const dt = d.type;

    // 1. 属性ベースの除外（最優先）
    if (d.getAttr) {
        if (d.getAttr('data-internal') === 'true' ||
            d.getAttr('data-is-proxy') === 'true' ||
            d.getAttr('data-is-canvas') === 'true' ||
            d.getAttr('data-is-grid') === 'true' ||
            d.getAttr('data-is-tool') === 'true' ||
            d.getAttr('data-temp') === 'true') {
            return true;
        }
    }

    // 2. クラスベースの除外（強力な判定）
    const skipClasses = [
        'svg-grid-line', 'svg-grid-lines', 'svg-ruler',
        'svg-grid-pattern', 'svg-grid-rect', 'grid-line',
        'svg-canvas-border', 'svg-canvas-proxy', 'svg-snap-guides',
        'svg-interaction-hitarea',
        'svg-select-group', 'svg_select_group',
        'svg-select-shape', 'svg_select_shape',
        'svg-select-handle', 'svg_select_handle',
        'svg-select-handle-rot', 'svg_select_handle_rot',
        'svg-select-handle-point', 'svg_select_handle_point',
        'rotation-handle', 'rotation-handle-group',
        'radius-handle', 'radius-handle-group',
        'polyline-handle-group', 'bubble-handle-group',
        'svg-select-rect', 'select-point-handle', 'select-handler',
        'svg-control-marker', 'svg-connector-overlay'
    ];
    if (skipClasses.some(cls => d.hasClass(cls))) return true;

    // 3. IDベースの除外
    const skipIdKeywords = [
        'grid-', 'svg-select-', 'svg_select_', 'svg-resize-',
        'svg-canvas-', 'svg-interaction-',
        'svg-snap-', 'svg-ruler-'
    ];
    if (skipIdKeywords.some(sid => did.includes(sid))) return true;

    // [FIX] 外部インポートされた（独自属性を持たない）標準的な図形要素も表示対象に含める
    // 以前は metadata がない SvgjsXXX 要素をノイズとして除外していましたが、
    // これによって外部読み込みされた正規のパスまで消えてしまっていました。
    // 今後はクラスベースの除外（skipClasses）に頼り、タグ名だけでの除外は行いません。

    // 4. 要素タイプベースの除外
    const skipTypes = ['defs', 'marker', 'style', 'connector-data', 'metadata', 'title', 'desc'];
    if (skipTypes.includes(dt)) return true;

    return false;
};

window.buildSvgList = function () {
    if (!DOM.svgListContent) return;

    // Find all SVG blocks in the document
    const svgWrappers = document.querySelectorAll('.svg-view-wrapper');
    if (svgWrappers.length === 0) {
        DOM.svgListContent.innerHTML = `<div class="outline-item" style="opacity:0.5; font-style:italic;" data-i18n="svgList.empty">${I18n.translate('svgList.empty')}</div>`;
        return;
    }

    const itemsHTML = [];
    const activeEditingIndex = (window.currentEditingSVG && window.currentEditingSVG.container) ?
        window.currentEditingSVG.container.getAttribute('data-svg-index') : null;

    // Recursive function to build tree items
    function traverse(el, level = 0, isParentCollapsed = false, svgIndex, state) {
        const details = getSvgListElDetails(el);
        const type = details.type;
        const id = details.id || '';

        if (isSvgElementSkipped(details)) return;

        // Increment tree index for this valid element
        const treeIndex = state.counter++;

        const label = details.label || '';
        const isVisible = details.visible;
        const isLocked = details.locked;
        const children = details.children().filter(c => !isSvgElementSkipped(getSvgListElDetails(c)));
        const hasChildren = children.length > 0;

        // [FIX] Skip empty groups with no meaningful attributes (Ghost library groups)
        const hasSomeMetadata = details.label ||
            (details.getAttr && (details.getAttr('data-tool-id') || details.getAttr('data-label') || details.getAttr('data-type') || details.getAttr('data-original-id')));
        if (type === 'g' && !hasChildren && !hasSomeMetadata && (!id || id.startsWith('Svgjs'))) {
            return;
        }

        const isCollapsed = !!window._svgListCollapsedState[id || `svg-${svgIndex}-${level}`];

        let iconHref = '#sym-shape';
        if (type === 'svg') iconHref = '#sym-image';
        else if (type === 'g') iconHref = '#sym-group';
        else if (type === 'image') iconHref = '#sym-image';

        const isEditingThis = (activeEditingIndex === String(svgIndex));
        const selectedIds = isEditingThis ? new Set(Array.from(window.currentEditingSVG.selectedElements || []).map(e => e.id())) : new Set();
        const canEditFields = isEditingThis && !isLocked;

        const itemClass = `svg-list-item level-${level} ${selectedIds.has(id) ? 'selected' : ''} ${isLocked ? 'item-locked' : ''}`;
        const displayStyle = isParentCollapsed ? 'display: none;' : '';

        itemsHTML.push(`
            <div class="${itemClass}" 
                 style="${displayStyle}"
                 data-element-id="${id}"
                 data-svg-index="${svgIndex}"
                 data-tree-index="${treeIndex}"
                 data-type="${type}"
                 data-visible="${isVisible}">
                <div class="expand-toggle" data-action="toggle-collapse" data-id="${id || `svg-${svgIndex}-${level}`}">
                    ${hasChildren ? `<svg width="12" height="12"><use href="${isCollapsed ? '#sym-chevron-right' : '#sym-chevron-down'}" /></svg>` : ''}
                </div>
                <div class="type-icon">
                    <svg width="18" height="18"><use href="${iconHref}" /></svg>
                </div>
                <input type="text" class="name-field" value="${label}" placeholder="${type}" data-action="edit-label" spellcheck="false" ${!canEditFields ? 'readonly' : ''}>
                
                <span class="id-label">ID</span>
                <input type="text" class="id-field" value="${id || ''}" data-action="edit-id" spellcheck="false" ${!canEditFields ? 'readonly' : ''}>

                <div class="item-actions">
                    <div class="action-icon" data-action="toggle-visibility" title="${I18n.translate(isVisible ? 'svgList.hide' : 'svgList.show')}">
                        <svg width="18" height="18"><use href="${isVisible ? '#sym-eye' : '#sym-eye-off'}" /></svg>
                    </div>
                    <div class="action-icon" data-action="toggle-lock" title="${I18n.translate(isLocked ? 'svgList.unlock' : 'svgList.lock')}">
                        <svg width="18" height="18"><use href="${isLocked ? '#sym-lock' : '#sym-lock-open'}" /></svg>
                    </div>
                </div>
            </div>
        `);

        if (hasChildren) {
            children.forEach(child => traverse(child, level + 1, isParentCollapsed || isCollapsed, svgIndex, state));
        }
    }

    // Process each SVG block found in the preview
    svgWrappers.forEach((wrapper, index) => {
        const idx = wrapper.getAttribute('data-svg-index');
        const isEditingNow = (activeEditingIndex === String(idx));
        const state = { counter: 0 };

        if (isEditingNow && window.currentEditingSVG.draw) {
            // Use real-time SVG.js instance
            traverse(window.currentEditingSVG.draw, 0, false, idx, state);
        } else {
            // Use native DOM from preview (only the top <svg> element)
            const svgEl = wrapper.querySelector('svg');
            if (svgEl) {
                traverse(svgEl, 0, false, idx, state);
            }
        }
    });

    DOM.svgListContent.innerHTML = itemsHTML.length > 0 ? itemsHTML.join('') : `<div class="outline-item" style="opacity:0.5; font-style:italic;" data-i18n="svgList.empty">${I18n.translate('svgList.empty')}</div>`;

    attachSvgListItemEvents();
};

function attachSvgListItemEvents() {
    // Helper to find original element by index (Duplicate ID proof)
    const findElementByIndex = (sIdx, tIdx) => {
        const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === sIdx);
        if (!isEditingCurrent) return null;

        const draw = window.currentEditingSVG.draw;
        let found = null;
        let counter = 0;

        // Same logic as traverse to ensure consistency
        const searchRecursive = (el) => {
            if (found) return;

            // Re-fetch details with shared logic
            const details = getSvgListElDetails(el);

            if (isSvgElementSkipped(details)) return;

            if (counter === parseInt(tIdx)) {
                found = el;
                return;
            }
            counter++;

            if (el.children) {
                el.children().forEach(child => searchRecursive(child));
            }
        };

        searchRecursive(draw);
        return found;
    };

    if (window.svgListDragManager) {
        window.svgListDragManager.destroy();
        window.svgListDragManager = null;
    }

    if (typeof PointerDragManager !== 'undefined') {
        window.svgListDragManager = new PointerDragManager({
            container: DOM.svgListContent,
            itemSelector: '.svg-list-item',
            handleSelector: '.type-icon', // アイコン部分をドラッグハンドルとする
            draggingClass: 'dragging',
            onDragStart: (item, e) => {
                const svgIndex = item.dataset.svgIndex;
                const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);
                // ロックされている等、ドラッグ不可の条件
                if (!isEditingCurrent || item.classList.contains('item-locked')) {
                    return null; // ※完全に止める仕様ではないが、Drop側でガードする
                }

                return {
                    id: item.dataset.elementId,
                    svgIndex: item.dataset.svgIndex,
                    treeIndex: item.dataset.treeIndex,
                    currentTargetInfo: null
                };
            },
            onDragMove: (data, e, info) => {
                if (!data) return; // ignore invalid drag start
                
                const items = DOM.svgListContent.querySelectorAll('.svg-list-item');
                items.forEach(i => i.classList.remove('drag-over', 'drag-over-inside'));

                if (!info.target) {
                    data.currentTargetInfo = null;
                    return;
                }

                const targetEl = findElementByIndex(info.target.dataset.svgIndex, info.target.dataset.treeIndex);
                if (!targetEl) return;

                const rect = info.target.getBoundingClientRect();
                const relY = e.clientY - rect.top;

                let isInside = false;
                if (relY < rect.height * 0.25) {
                    info.target.classList.add('drag-over');
                } else if ((targetEl.type === 'g' || targetEl.type === 'svg') && relY < rect.height * 0.75) {
                    info.target.classList.add('drag-over-inside');
                    isInside = true;
                } else {
                    info.target.classList.add('drag-over'); // defaults to above conceptually? wait, actually 'drag-over' means sibling drop.
                }

                data.currentTargetInfo = {
                    element: info.target,
                    targetEl: targetEl,
                    isInside: isInside
                };
            },
            onDragEnd: (data, e) => {
                const items = DOM.svgListContent.querySelectorAll('.svg-list-item');
                items.forEach(i => i.classList.remove('drag-over', 'drag-over-inside'));
            },
            onDrop: (data, dropTarget, e) => {
                if (!data || !data.currentTargetInfo) return;

                const targetItem = data.currentTargetInfo.element;
                const targetEl = data.currentTargetInfo.targetEl;
                const isInside = data.currentTargetInfo.isInside;

                const sourceSvgIndex = data.svgIndex;
                const sourceTreeIndex = data.treeIndex;
                const targetSvgIndex = targetItem.dataset.svgIndex;

                if (sourceSvgIndex !== targetSvgIndex || !targetEl) return;

                const sourceEl = findElementByIndex(sourceSvgIndex, sourceTreeIndex);
                if (!sourceEl || sourceEl === targetEl) return;

                if (isInside) {
                    targetEl.add(sourceEl);
                } else {
                    sourceEl.insertBefore(targetEl);
                }

                buildSvgList();
                if (typeof syncChanges === 'function') syncChanges();
            }
        });
    }

    const items = DOM.svgListContent.querySelectorAll('.svg-list-item');
    items.forEach(item => {
        const id = item.dataset.elementId;
        const svgIndex = item.dataset.svgIndex;
        const treeIndex = item.dataset.treeIndex;
        const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);

        const getEl = () => isEditingCurrent ? findElementByIndex(svgIndex, treeIndex) : null;

        // Click to select or start editing
        item.onclick = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.closest('.action-icon') || e.target.closest('.expand-toggle')) return;

            if (isEditingCurrent) {
                const el = getEl();
                if (el && typeof selectElement === 'function') {
                    selectElement(el, e.shiftKey || e.ctrlKey);
                }
            } else {
                // Focus and start editing that SVG block
                const container = document.querySelector(`.svg-view-wrapper[data-svg-index="${svgIndex}"]`);
                if (container && typeof startSVGEdit === 'function') {
                    startSVGEdit(container, parseInt(svgIndex));
                }
            }
        };

        // Hover highlight (Only if editing)
        if (isEditingCurrent) {
            item.onmouseenter = () => {
                const el = getEl();
                if (!el) return;
                if (window._hoveredSvgElement) window._hoveredSvgElement.removeClass('svg-list-hover-highlight');
                el.addClass('svg-list-hover-highlight');
                window._hoveredSvgElement = el;
            };
            item.onmouseleave = () => {
                const el = getEl();
                if (el) el.removeClass('svg-list-hover-highlight');
                window._hoveredSvgElement = null;
            };
        }

        // Collapse toggle
        const expandBtn = item.querySelector('.expand-toggle');
        if (expandBtn) {
            expandBtn.onclick = (e) => {
                e.stopPropagation();
                const collapseId = expandBtn.dataset.id;
                window._svgListCollapsedState[collapseId] = !window._svgListCollapsedState[collapseId];
                buildSvgList();
            };
        }

        // Editing actions only if active
        if (isEditingCurrent) {
            // Label Edit
            const nameInput = item.querySelector('.name-field');
            if (nameInput) {
                nameInput.onchange = () => {
                    const el = getEl();
                    if (!el) return;
                    el.attr('data-label', nameInput.value);
                    if (typeof syncChanges === 'function') syncChanges();
                };
                nameInput.onkeydown = (e) => { if (e.key === 'Enter') nameInput.blur(); };
            }

            // ID Edit
            const idInput = item.querySelector('.id-field');
            if (idInput) {
                idInput.onchange = () => {
                    const el = getEl();
                    if (!el) return;
                    const newId = idInput.value.trim();
                    if (newId && newId !== id) {
                        try {
                            el.id(newId);
                            buildSvgList();
                            if (typeof syncChanges === 'function') syncChanges();
                        } catch (err) {
                            idInput.value = id;
                            console.error('Failed to change ID:', err);
                        }
                    }
                };
                idInput.onkeydown = (e) => { if (e.key === 'Enter') idInput.blur(); };
            }

            // Visibility Toggle
            const visBtn = item.querySelector('[data-action="toggle-visibility"]');
            if (visBtn) {
                visBtn.onclick = (e) => {
                    e.stopPropagation();
                    const el = getEl();
                    if (!el) return;
                    console.log(`[SVG List] Toggle visibility for #${el.id()}, currentVis=${el.visible()}`);
                    if (el.visible()) {
                        el.hide();
                        console.log(`[SVG List] After hide(): #${el.id()}, visible=${el.visible()}, style.display=${el.node.style.display}`);
                        // [NEW] Deselect if hidden
                        if (typeof window.deselectElement === 'function') {
                            window.deselectElement(el);
                        }
                    } else {
                        el.show();
                    }
                    buildSvgList();
                    if (typeof syncChanges === 'function') {
                        syncChanges();
                        console.log(`[SVG List] After syncChanges(): #${el.id()}, visible=${el.visible()}, style.display=${el.node.style.display}`);
                    }
                };
            }

            // Lock Toggle
            const lockBtn = item.querySelector('[data-action="toggle-lock"]');
            if (lockBtn) {
                lockBtn.onclick = (e) => {
                    e.stopPropagation();
                    const el = getEl();
                    if (!el) return;
                    const locked = el.attr('data-locked') === 'true';
                    el.attr('data-locked', !locked);
                    buildSvgList();
                    if (typeof syncChanges === 'function') syncChanges();
                };
            }

        }
    });
}

// Global Toolbar Commands
window.execSvgCopy = () => { if (typeof copySelectedElements === 'function') copySelectedElements(); };
window.execSvgPaste = () => { if (typeof pasteElements === 'function') pasteElements(); };
window.execSvgDelete = () => { if (typeof deleteSelectedElements === 'function') deleteSelectedElements(); };
window.execSvgGroup = () => { if (typeof groupSelectedElements === 'function') groupSelectedElements(); };
window.execSvgUngroup = () => { if (typeof ungroupSelectedElements === 'function') ungroupSelectedElements(); };

// Sync toolbar buttons from index.html if they exist
document.getElementById('svg-list-copy')?.addEventListener('click', () => window.execSvgCopy());
document.getElementById('svg-list-paste')?.addEventListener('click', () => window.execSvgPaste());
document.getElementById('svg-list-delete')?.addEventListener('click', () => window.execSvgDelete());
document.getElementById('svg-list-group')?.addEventListener('click', () => window.execSvgGroup());
document.getElementById('svg-list-ungroup')?.addEventListener('click', () => window.execSvgUngroup());
