/**
 * SVG List (Layer Panel) Core Logic
 * Handles tree generation, synchronization with SVG editor, and structural editing.
 */

// Track collapse state [id] -> boolean
window._svgListCollapsedState = window._svgListCollapsedState || {};

// Helper to get element details (handles both SVG.js objects and raw DOM nodes)
function getSvgListElDetails(el) {
    if (el.node) { // SVG.js object
        let isVisible = false;
        if (el.node.isConnected) {
            try {
                isVisible = el.visible();
            } catch (e) {
                isVisible = el.node.getAttribute('display') !== 'none' && (!el.node.style || el.node.style.display !== 'none');
            }
        } else {
            isVisible = el.node.getAttribute('display') !== 'none' && (!el.node.style || el.node.style.display !== 'none');
        }

        return {
            id: el.id(),
            type: el.type,
            label: el.attr('data-label') || '',
            visible: isVisible,
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

    const svgWrappers = document.querySelectorAll('.svg-view-wrapper');
    if (svgWrappers.length === 0) {
        DOM.svgListContent.innerHTML = `<div class="outline-item" style="opacity:0.5; font-style:italic;" data-i18n="svgList.empty">${I18n.translate('svgList.empty')}</div>`;
        return;
    }

    window._svgListElementCache = new Map();
    const fragment = document.createDocumentFragment();
    let hasItems = false;
    
    const activeEditingIndex = (window.currentEditingSVG && window.currentEditingSVG.container) ?
        window.currentEditingSVG.container.getAttribute('data-svg-index') : null;

    function traverse(el, level = 0, isParentCollapsed = false, svgIndex, state) {
        const details = getSvgListElDetails(el);
        const type = details.type;
        const id = details.id || '';

        if (isSvgElementSkipped(details)) return;

        const treeIndex = state.counter++;
        if (window._svgListElementCache) {
            window._svgListElementCache.set(`${svgIndex}-${treeIndex}`, el);
        }

        const label = details.label || '';
        const isVisible = details.visible;
        const isLocked = details.locked;
        const children = details.children().filter(c => !isSvgElementSkipped(getSvgListElDetails(c)));
        const hasChildren = children.length > 0;

        const hasSomeMetadata = details.label || (details.getAttr && (details.getAttr('data-tool-id') || details.getAttr('data-label') || details.getAttr('data-type') || details.getAttr('data-original-id')));
        if (type === 'g' && !hasChildren && !hasSomeMetadata && (!id || id.startsWith('Svgjs'))) return;

        hasItems = true;
        const isCollapsed = !!window._svgListCollapsedState[id || `svg-${svgIndex}-${level}`];

        let iconHref = '#sym-shape';
        if (type === 'svg') iconHref = '#sym-image';
        else if (type === 'g') iconHref = '#sym-group';
        else if (type === 'image') iconHref = '#sym-image';

        const isEditingThis = (activeEditingIndex === String(svgIndex));
        const selectedIds = isEditingThis ? new Set(Array.from(window.currentEditingSVG.selectedElements || []).map(e => e.id())) : new Set();
        const canEditFields = isEditingThis && !isLocked;

        const itemClass = `svg-list-item level-${level} ${selectedIds.has(id) ? 'selected' : ''} ${isLocked ? 'item-locked' : ''}`;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = itemClass;
        
        // --- 改善案3: 仮想スクロール (CSSネイティブ) ---
        itemDiv.style.contentVisibility = 'auto';
        itemDiv.style.containIntrinsicSize = '30px'; 

        if (isParentCollapsed) itemDiv.style.display = 'none';
        
        itemDiv.dataset.elementId = id;
        itemDiv.dataset.svgIndex = svgIndex;
        itemDiv.dataset.treeIndex = treeIndex;
        itemDiv.dataset.type = type;
        itemDiv.dataset.visible = isVisible;

        itemDiv.innerHTML = `
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
        `;

        fragment.appendChild(itemDiv);

        if (hasChildren) {
            children.forEach(child => traverse(child, level + 1, isParentCollapsed || isCollapsed, svgIndex, state));
        }
    }

    svgWrappers.forEach((wrapper) => {
        const idx = wrapper.getAttribute('data-svg-index');
        const isEditingNow = (activeEditingIndex === String(idx));
        const state = { counter: 0 };

        if (isEditingNow && window.currentEditingSVG && window.currentEditingSVG.draw) {
            traverse(window.currentEditingSVG.draw, 0, false, idx, state);
        } else {
            const svgEl = wrapper.querySelector('svg');
            if (svgEl) traverse(svgEl, 0, false, idx, state);
        }
    });

    DOM.svgListContent.innerHTML = '';
    if (hasItems) {
        DOM.svgListContent.appendChild(fragment);
    } else {
        DOM.svgListContent.innerHTML = `<div class="outline-item" style="opacity:0.5; font-style:italic;" data-i18n="svgList.empty">${I18n.translate('svgList.empty')}</div>`;
    }

    attachSvgListItemEvents();
};

window.findElementByIndex = function(sIdx, tIdx) {
    const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === sIdx);
    if (!isEditingCurrent) return null;

    const cacheKey = `${sIdx}-${tIdx}`;
    if (window._svgListElementCache && window._svgListElementCache.has(cacheKey)) {
        return window._svgListElementCache.get(cacheKey);
    }
    
    const draw = window.currentEditingSVG.draw;
    let found = null, counter = 0;
    const searchRecursive = (el) => {
        if (found) return;
        const details = getSvgListElDetails(el);
        if (isSvgElementSkipped(details)) return;
        if (counter === parseInt(tIdx)) { found = el; return; }
        counter++;
        if (el.children) el.children().forEach(child => searchRecursive(child));
    };
    searchRecursive(draw);
    return found;
};

window._isSvgListEventDelegated = false;

function attachSvgListItemEvents() {
    if (window.svgListDragManager) {
        window.svgListDragManager.destroy();
        window.svgListDragManager = null;
    }

    if (typeof PointerDragManager !== 'undefined') {
        window.svgListDragManager = new PointerDragManager({
            container: DOM.svgListContent,
            itemSelector: '.svg-list-item',
            handleSelector: '.type-icon',
            draggingClass: 'dragging',
            onDragStart: (item, e) => {
                const svgIndex = item.dataset.svgIndex;
                const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);
                if (!isEditingCurrent || item.classList.contains('item-locked')) return null;

                return {
                    id: item.dataset.elementId,
                    svgIndex: item.dataset.svgIndex,
                    treeIndex: item.dataset.treeIndex,
                    currentTargetInfo: null
                };
            },
            onDragMove: (data, e, info) => {
                if (!data) return; 
                const items = DOM.svgListContent.querySelectorAll('.svg-list-item');
                items.forEach(i => i.classList.remove('drag-over', 'drag-over-inside'));

                if (!info.target) {
                    data.currentTargetInfo = null; return;
                }

                const targetEl = window.findElementByIndex(info.target.dataset.svgIndex, info.target.dataset.treeIndex);
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
                    info.target.classList.add('drag-over'); 
                }

                data.currentTargetInfo = { element: info.target, targetEl: targetEl, isInside: isInside };
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

                const sourceEl = window.findElementByIndex(sourceSvgIndex, sourceTreeIndex);
                if (!sourceEl || sourceEl === targetEl) return;

                if (isInside) targetEl.add(sourceEl);
                else sourceEl.insertBefore(targetEl);

                buildSvgList();
                if (typeof syncChanges === 'function') syncChanges();
            }
        });
    }

    if (!window._isSvgListEventDelegated && DOM.svgListContent) {
        window._isSvgListEventDelegated = true;

        DOM.svgListContent.addEventListener('click', (e) => {
            const item = e.target.closest('.svg-list-item');
            if (!item) return;

            const svgIndex = item.dataset.svgIndex;
            const treeIndex = item.dataset.treeIndex;
            const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);
            const getEl = () => isEditingCurrent ? window.findElementByIndex(svgIndex, treeIndex) : null;

            const expandBtn = e.target.closest('.expand-toggle');
            if (expandBtn) {
                e.stopPropagation();
                const collapseId = expandBtn.dataset.id;
                window._svgListCollapsedState[collapseId] = !window._svgListCollapsedState[collapseId];
                buildSvgList();
                return;
            }

            const visBtn = e.target.closest('[data-action="toggle-visibility"]');
            if (visBtn) {
                e.stopPropagation();
                if (isEditingCurrent) {
                    const el = getEl();
                    if (!el) return;
                    if (el.visible()) {
                        el.hide();
                        if (typeof window.deselectElement === 'function') window.deselectElement(el);
                    } else {
                        el.show();
                    }
                    buildSvgList();
                    if (typeof syncChanges === 'function') syncChanges();
                }
                return;
            }

            const lockBtn = e.target.closest('[data-action="toggle-lock"]');
            if (lockBtn) {
                e.stopPropagation();
                if (isEditingCurrent) {
                    const el = getEl();
                    if (!el) return;
                    const locked = el.attr('data-locked') === 'true';
                    el.attr('data-locked', !locked);
                    buildSvgList();
                    if (typeof syncChanges === 'function') syncChanges();
                }
                return;
            }

            if (e.target.tagName === 'INPUT' || e.target.closest('.action-icon') || e.target.closest('.expand-toggle')) return;

            if (isEditingCurrent) {
                const el = getEl();
                if (el) {
                    if (!el.remember('_shapeInstance') && typeof makeInteractive === 'function') {
                        makeInteractive(el);
                    }
                    if (typeof selectElement === 'function') {
                        selectElement(el, e.shiftKey || e.ctrlKey);
                    }
                }
            } else {
                // [FIX] SVGエディタが初期化中の場合は二重起動を防止
                if (window._svgEditorStarting) return;
                const container = document.querySelector(`.svg-view-wrapper[data-svg-index="${svgIndex}"]`);
                // [FIX] 同じSVGの場合は無視、別の場合は既存を閉じて開くのを許可
                if (window.currentEditingSVG && window.currentEditingSVG.container === container) return;
                if (container && typeof startSVGEdit === 'function') {
                    startSVGEdit(container, parseInt(svgIndex));
                }
            }
        });

        DOM.svgListContent.addEventListener('mouseover', (e) => {
            if (!window.currentEditingSVG) return;
            const item = e.target.closest('.svg-list-item');
            if (!item) return;

            const svgIndex = item.dataset.svgIndex;
            const treeIndex = item.dataset.treeIndex;
            const isEditingCurrent = (window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);
            if (!isEditingCurrent) return;

            const el = window.findElementByIndex(svgIndex, treeIndex);
            if (!el) return;

            if (window._hoveredSvgElement && window._hoveredSvgElement !== el) {
                window._hoveredSvgElement.removeClass('svg-list-hover-highlight');
            }
            el.addClass('svg-list-hover-highlight');
            window._hoveredSvgElement = el;
        });

        DOM.svgListContent.addEventListener('mouseout', (e) => {
            const item = e.target.closest('.svg-list-item');
            if (!item) return;

            if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.svg-list-item') === item) return;

            if (window._hoveredSvgElement) {
                window._hoveredSvgElement.removeClass('svg-list-hover-highlight');
                window._hoveredSvgElement = null;
            }
        });

        DOM.svgListContent.addEventListener('change', (e) => {
            const item = e.target.closest('.svg-list-item');
            if (!item) return;

            const svgIndex = item.dataset.svgIndex;
            const treeIndex = item.dataset.treeIndex;
            const id = item.dataset.elementId;
            const isEditingCurrent = (window.currentEditingSVG && window.currentEditingSVG.container && window.currentEditingSVG.container.getAttribute('data-svg-index') === svgIndex);
            if (!isEditingCurrent) return;

            const getEl = () => window.findElementByIndex(svgIndex, treeIndex);

            if (e.target.classList.contains('name-field')) {
                const el = getEl();
                if (!el) return;
                el.attr('data-label', e.target.value);
                if (typeof syncChanges === 'function') syncChanges();
            } else if (e.target.classList.contains('id-field')) {
                const el = getEl();
                if (!el) return;
                const oldId = id;
                const newId = e.target.value.trim();
                if (newId && newId !== oldId) {
                    try {
                        el.id(newId);
                        buildSvgList();
                        if (typeof syncChanges === 'function') syncChanges();
                    } catch (err) {
                        e.target.value = oldId;
                    }
                }
            }
        });

        DOM.svgListContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.target.blur();
            }
        });
    }
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
