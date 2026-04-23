/**
 * 表示中のコンテキストメニュー管理
 */
let activeSVGContextMenu = null;
let activeSVGContextMenuCleanup = null;

/**
 * コンテキストメニューを非表示にする
 */
function hideSVGContextMenu() {
    if (activeSVGContextMenu) {
        activeSVGContextMenu.remove();
        activeSVGContextMenu = null;
    }
    if (activeSVGContextMenuCleanup) {
        document.removeEventListener('pointerdown', activeSVGContextMenuCleanup, true);
        document.removeEventListener('mousedown', activeSVGContextMenuCleanup, true);
        activeSVGContextMenuCleanup = null;
    }
}

/**
 * コンテキストメニューを表示
 * @param {MouseEvent} e - マウスイベント
 * @param {HTMLElement} container - SVGコンテナ
 * @param {number} svgIndex - SVGインデックス
 * @param {Object} currentEditingSVG - 現在編集中のSVG情報
 * @param {Object} actions - アクション関数群
 */
function showSVGContextMenu(e, container, svgIndex, currentEditingSVG, actions) {
    if (!currentEditingSVG) {
        console.warn('[SVG Context Menu] No currentEditingSVG provided');
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    // 既存のメニューを削除
    hideSVGContextMenu();

    const selected = Array.from(currentEditingSVG.selectedElements);

    // メニューを作成
    const menu = document.createElement('div');
    menu.className = 'svg-context-menu';
    menu.style.cssText = `
        position: fixed;
        background: var(--svg-toolbar-bg);
        border: 1px solid var(--svg-toolbar-border);
        box-shadow: 0 4px 15px var(--svg-toolbar-shadow);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        z-index: 10001;
        border-radius: 8px;
        padding: 4px 0;
        font-size: 13px;
        min-width: 150px;
        font-family: sans-serif;
        visibility: hidden;
        color: var(--svg-toolbar-fg);
    `;

    const selectionCount = currentEditingSVG.selectedElements.size;
    const hasSelection = selectionCount > 0;
    const hasClipboard = actions.hasClipboard();

    // グループ化可能かチェック
    let canUngroup = false;
    currentEditingSVG.selectedElements.forEach(el => {
        if (el.type === 'g') canUngroup = true;
    });

    // Helper to translate safely
    const t = (k, d) => (typeof I18n !== 'undefined' ? I18n.translate(k) : null) || d;

    // メニューアイテムの定義 (多言語対応)
    const menuItems = [
        { label: t('svgContextMenu.resetLayout', '配置リセット'), enabled: true, action: actions.resetLayout },
        { type: 'separator' },
        { label: t('svgContextMenu.group', 'グループ化'), enabled: selectionCount > 1, action: actions.group },
        { label: t('svgContextMenu.ungroup', 'グループ化解除'), enabled: canUngroup, action: actions.ungroup },
        { type: 'separator' },
        { label: t('svgContextMenu.bringToFront', '最前面へ移動'), enabled: hasSelection, action: actions.bringToFront },
        { label: t('svgContextMenu.sendToBack', '最背面へ移動'), enabled: hasSelection, action: actions.sendToBack },
        { type: 'separator' },
        { label: t('contextMenuEditor.copy', 'コピー'), enabled: hasSelection, action: actions.copy },
        { label: t('contextMenuEditor.paste', '貼り付け'), enabled: hasClipboard, action: () => actions.paste(container) },
        { label: t('contextMenuEditor.deleteSelection', '削除'), enabled: hasSelection, action: actions.delete },
        { type: 'separator' },
        {
            label: t('svgContextMenu.showProperties', 'プロパティ表示'),
            enabled: hasSelection,
            action: () => {
                if (hasSelection) {
                    const firstEl = currentEditingSVG.selectedElements.values().next().value;
                    let targetNode = firstEl.node;
                    // Canvas Proxyの処理
                    if (firstEl.hasClass('svg-canvas-proxy')) {
                        targetNode = currentEditingSVG.draw.node;
                    }
                    actions.showProperties(targetNode, svgIndex, container);
                }
            }
        },
        { type: 'separator' },
        { label: 'ツールバーに追加', enabled: selectionCount === 1, action: () => actions.addToToolbar(container) }
    ];

    // [NEW] CSS追加メニュー（クラス未設定の図形のみ、且つscriptタグが読み込まれているとき）
    if (selectionCount === 1 && typeof SVGCSSToolbar !== 'undefined') {
        const el = selected[0];
        const existingClass = el.node.getAttribute('class') || '';
        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        const styleEl = draw ? draw.node.querySelector('style') : null;
        const cssText = styleEl ? (styleEl.textContent || '') : '';
        const classInStyle = existingClass ? existingClass.split(/\s+/).filter(Boolean).some(c => 
            new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{').test(cssText)
        ) : false;
        const hasValidClass = existingClass && classInStyle;

        if (!hasValidClass) {
            menuItems.push({ type: 'separator' });
            menuItems.push({
                label: 'CSS追加',
                enabled: true,
                action: () => {
                    _showCSSAddDialog(el, draw);
                }
            });
        }
    }

    // [NEW] Polyline/Arrow specific items
    if (selectionCount === 1) {
        const el = selected[0];
        const tagName = el.node.tagName.toLowerCase();
        const toolId = el.attr('data-tool-id');
        const isPathTool = ['line', 'arrow', 'polyline', 'freehand'].includes(toolId);

        if (tagName === 'polyline' || (tagName === 'path' && isPathTool)) {
            menuItems.push({ type: 'separator' });

            const hasStart = el.node.getAttribute('data-arrow-start') === 'true';
            const hasEnd = el.node.getAttribute('data-arrow-end') === 'true';

            menuItems.push({
                label: hasStart ? '開始矢印を消す' : '開始矢印をつける',
                enabled: true,
                action: () => {
                    el.node.setAttribute('data-arrow-start', !hasStart);
                    if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                        window.SVGToolbar.updateArrowMarkers(el);
                    }
                    if (window.syncChanges) window.syncChanges(true);
                    if (currentEditingSVG.polylineHandler) {
                        const selGrp = currentEditingSVG.container.querySelector('.svg-select-group, .svg_select_group');
                        currentEditingSVG.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                    }
                }
            });
            menuItems.push({
                label: hasEnd ? '終了矢印を消す' : '終了矢印をつける',
                enabled: true,
                action: () => {
                    el.node.setAttribute('data-arrow-end', !hasEnd);
                    if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                        window.SVGToolbar.updateArrowMarkers(el);
                    }
                    if (window.syncChanges) window.syncChanges(true);
                    if (currentEditingSVG.polylineHandler) {
                        const selGrp = currentEditingSVG.container.querySelector('.svg-select-group, .svg_select_group');
                        currentEditingSVG.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                    }
                }
            });

            menuItems.push({ type: 'separator' });
            menuItems.push({
                label: '頂点を追加',
                enabled: true,
                action: () => {
                    const pts = window.SVGConnectorManager ? window.SVGConnectorManager.getPolyPoints(el) : [];

                    if (pts.length >= 2) {
                        const last = pts[pts.length - 1];
                        const prev = pts[pts.length - 2];
                        const mid = [(last[0] + prev[0]) / 2, (last[1] + prev[1]) / 2];
                        pts.splice(pts.length - 1, 0, mid);

                        const newPointsStr = pts.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
                        el.node.setAttribute('data-poly-points', newPointsStr);
                        if (tagName === 'polyline') {
                            el.node.setAttribute('points', newPointsStr);
                        } else if (tagName === 'path') {
                            const bezData = [];
                            try {
                                const bezStr = el.node.getAttribute('data-bez-points');
                                if (bezStr) {
                                    const oldBez = JSON.parse(bezStr);
                                    oldBez.forEach(b => bezData.push(b));
                                }
                            } catch (e) { }
                            if (bezData.length > 0) {
                                bezData.splice(pts.length - 2, 0, { type: 0 });
                                el.node.setAttribute('data-bez-points', JSON.stringify(bezData));
                            }
                            // path の d 更新ロジック呼出 (SvgPolylineHandler が window にあれば利用)
                            if (window.SvgPolylineHandler) {
                                const handler = new SvgPolylineHandler(null, null);
                                handler.generatePath(el.node);
                            }
                        }

                        if (window.syncChanges) window.syncChanges(true);
                        if (currentEditingSVG.polylineHandler) {
                            const selGrp = currentEditingSVG.container.querySelector('.svg-select-group, .svg_select_group');
                            currentEditingSVG.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                        }
                    }
                }
            });
            menuItems.push({
                label: t('svgContextMenu.deleteVertex', '頂点を削除'),
                enabled: true,
                action: () => {
                    const pts = window.SVGConnectorManager ? window.SVGConnectorManager.getPolyPoints(el) : [];

                    if (pts.length > 2) {
                        pts.splice(pts.length - 2, 1); // 最後から2番目を削除

                        const newPointsStr = pts.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
                        el.node.setAttribute('data-poly-points', newPointsStr);
                        if (tagName === 'polyline') {
                            el.node.setAttribute('points', newPointsStr);
                        } else if (tagName === 'path') {
                            const bezData = [];
                            try {
                                const bezStr = el.node.getAttribute('data-bez-points');
                                if (bezStr) {
                                    const oldBez = JSON.parse(bezStr);
                                    oldBez.forEach(b => bezData.push(b));
                                }
                            } catch (e) { }
                            if (bezData.length > 0) {
                                bezData.splice(pts.length - 1, 1);
                                el.node.setAttribute('data-bez-points', JSON.stringify(bezData));
                            }
                            if (window.SvgPolylineHandler) {
                                const handler = new SvgPolylineHandler(null, null);
                                handler.generatePath(el.node);
                            }
                        }

                        if (window.syncChanges) window.syncChanges(true);
                        if (currentEditingSVG.polylineHandler) {
                            const selGrp = currentEditingSVG.container.querySelector('.svg-select-group, .svg_select_group');
                            currentEditingSVG.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                        }
                    }
                }
            });
        }
    }

    // メニューアイテムを構築
    menuItems.forEach(item => {
        if (item.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'svg-toolbar-separator';
            sep.style.margin = '4px 0';
            sep.style.width = '100%';
            sep.style.height = '1px';
            menu.appendChild(sep);
        } else {
            const itemDiv = document.createElement('div');
            itemDiv.textContent = item.label;
            itemDiv.style.cssText = `
                padding: 6px 16px;
                cursor: ${item.enabled ? 'pointer' : 'default'};
                color: ${item.enabled ? 'var(--svg-toolbar-fg)' : 'rgba(128, 128, 128, 0.5)'};
            `;

            if (item.enabled) {
                itemDiv.addEventListener('mouseenter', () => itemDiv.style.background = 'var(--svg-toolbar-btn-hover-bg)');
                itemDiv.addEventListener('mouseleave', () => itemDiv.style.background = 'transparent');
                itemDiv.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    item.action();
                    hideSVGContextMenu();
                });
            }
            menu.appendChild(itemDiv);
        }
    });

    // DOMに追加
    const expandedDialog = document.getElementById('svg-expanded-dialog');
    const parentElement = expandedDialog || document.body;
    parentElement.appendChild(menu);

    activeSVGContextMenu = menu;

    // 位置の自動調整
    adjustMenuPosition(menu, e.clientX, e.clientY);

    // クリーンアップ処理（メニュー外クリックで消去）
    const cleanup = (ev) => {
        if (menu && !menu.contains(ev.target)) {
            hideSVGContextMenu();
        }
    };
    activeSVGContextMenuCleanup = cleanup;

    // 即座にリスナーが反応して消えるのを防ぐため、少し遅らせて登録
    setTimeout(() => {
        document.addEventListener('pointerdown', cleanup, true);
        document.addEventListener('mousedown', cleanup, true);
    }, 0);
}

/**
 * メニューの位置を自動調整
 */
function adjustMenuPosition(menu, clickX, clickY) {
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 10;

    let top = clickY;
    const spaceBelow = viewportHeight - clickY;
    if (spaceBelow < menuHeight + padding) {
        const spaceAbove = clickY;
        if (spaceAbove > menuHeight + padding) {
            top = clickY - menuHeight;
        } else {
            top = viewportHeight - menuHeight - padding;
        }
    }

    let left = clickX;
    const spaceRight = viewportWidth - clickX;
    if (spaceRight < menuWidth + padding) {
        const spaceLeft = clickX;
        if (spaceLeft > menuWidth + padding) {
            left = clickX - menuWidth;
        } else {
            left = viewportWidth - menuWidth - padding;
        }
    }

    menu.style.top = Math.max(padding, top) + 'px';
    menu.style.left = Math.max(padding, left) + 'px';
    menu.style.visibility = 'visible';
}

/**
 * カスタムツールアイコンの右クリックメニューを表示
 */
function showCustomToolContextMenu(e, tool, deleteCallback, saveCallback) {
    hideSVGContextMenu();

    const menu = document.createElement('div');
    menu.className = 'svg-context-menu';
    menu.style.cssText = `
        position: fixed;
        background: var(--svg-toolbar-bg);
        border: 1px solid var(--svg-toolbar-border);
        box-shadow: 0 4px 15px var(--svg-toolbar-shadow);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        z-index: 10001;
        border-radius: 8px;
        padding: 4px 0;
        font-size: 13px;
        min-width: 150px;
        font-family: sans-serif;
        visibility: hidden;
        color: var(--svg-toolbar-fg);
    `;

    const t = (k, d) => (typeof I18n !== 'undefined' ? I18n.translate(k) : null) || d;

    const menuItems = [
        {
            label: t('svgContextMenu.removeFromToolbar', 'ツールバーから削除'),
            action: () => {
                const confirmMsgTemplate = t('confirm.deleteCustomTool', 'カスタムツール「{{name}}」を削除しますか？');
                const confirmMsg = confirmMsgTemplate.replace('{{name}}', tool.label);
                if (confirm(confirmMsg)) {
                    deleteCallback(tool.id);
                }
            }
        },
        {
            label: 'ファイルに保存',
            action: () => {
                saveCallback(tool);
            }
        }
    ];

    menuItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.textContent = item.label;
        itemDiv.style.cssText = `
            padding: 6px 16px;
            cursor: pointer;
            color: var(--svg-toolbar-fg);
        `;

        itemDiv.addEventListener('mouseenter', () => itemDiv.style.background = 'var(--svg-toolbar-btn-hover-bg)');
        itemDiv.addEventListener('mouseleave', () => itemDiv.style.background = 'transparent');
        itemDiv.addEventListener('click', (ev) => {
            ev.stopPropagation();
            item.action();
            hideSVGContextMenu();
        });

        menu.appendChild(itemDiv);
    });

    document.body.appendChild(menu);
    activeSVGContextMenu = menu;

    adjustMenuPosition(menu, e.clientX, e.clientY);

    const cleanup = (ev) => {
        if (menu && !menu.contains(ev.target)) {
            hideSVGContextMenu();
        }
    };
    activeSVGContextMenuCleanup = cleanup;

    setTimeout(() => {
        document.addEventListener('pointerdown', cleanup, true);
        document.addEventListener('mousedown', cleanup, true);
    }, 0);
}

// Global exports
window.hideSVGContextMenu = hideSVGContextMenu;
window.showSVGContextMenu = showSVGContextMenu;
window.showCustomToolContextMenu = showCustomToolContextMenu;
window.adjustMenuPosition = adjustMenuPosition;

/**
 * CSS追加ダイアログを表示する
 * @param {Object} el - 対象SVG要素（SVG.jsラッパー）
 * @param {Object} draw - SVG.jsのdrawオブジェクト
 */
function _showCSSAddDialog(el, draw) {
    // ダイアログ用オーバーレイ
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.3); z-index: 20000;
        display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: var(--svg-toolbar-bg, #fff);
        border: 1px solid var(--svg-toolbar-border, #ccc);
        border-radius: 8px; padding: 16px; min-width: 280px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        font-family: sans-serif; font-size: 13px;
        color: var(--svg-toolbar-fg, #222);
        opacity: 1 !important; pointer-events: auto !important;
    `;

    const title = document.createElement('p');
    title.textContent = 'CSSに追加するクラス名を入力してください';
    title.style.cssText = 'margin: 0 0 10px 0; font-weight: bold;';
    dialog.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'my-style';
    input.style.cssText = `
        width: 100%; box-sizing: border-box; padding: 5px 8px;
        font-size: 13px; border: 1px solid var(--svg-toolbar-border, #ccc);
        border-radius: 4px; background: var(--svg-toolbar-bg, #fff);
        color: var(--svg-toolbar-fg, #222); margin-bottom: 12px;
    `;
    dialog.appendChild(input);

    // 注意書き
    const note = document.createElement('small');
    note.textContent = '使用可能: 半角英数字・ハイフン・アンダースコア（先頭は英字）';
    note.style.cssText = 'display: block; color: #888; margin-bottom: 12px; font-size: 11px;';
    dialog.appendChild(note);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = `
        padding: 4px 14px; border-radius: 4px; cursor: pointer;
        border: 1px solid var(--svg-toolbar-border, #ccc);
        background: transparent; color: var(--svg-toolbar-fg, #222);
    `;
    cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
    btnRow.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = `
        padding: 4px 18px; border-radius: 4px; cursor: pointer;
        border: 1px solid #E8A000;
        background: rgba(232,160,0,0.15); color: var(--svg-toolbar-fg, #222); font-weight: bold;
    `;
    saveBtn.addEventListener('click', () => {
        const className = input.value.trim();
        if (!className) {
            alert('クラス名を入力してください。');
            return;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(className)) {
            alert('無効なクラス名です。\n使用可能: 半角英数字・ハイフン・アンダースコア（先頭は英字）');
            return;
        }

        // SVGのstyleタグに図形のスタイルを保存
        if (draw) {
            let styleEl = draw.node.querySelector('style');
            if (!styleEl) {
                let defsEl = draw.node.querySelector('defs');
                if (!defsEl) {
                    defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                    draw.node.insertBefore(defsEl, draw.node.firstChild);
                }
                styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
                styleEl.setAttribute('type', 'text/css');
                defsEl.appendChild(styleEl);
            }

            // 図形の主要スタイル属性を収集してCSSルールを生成
            const node = el.node;
            const attrs = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
                'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor'];
            const parts = [];
            attrs.forEach(attr => {
                // インラインスタイル (.style) を優先して取得
                const camelAttr = attr.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                const val = node.style[camelAttr] || node.getAttribute(attr);
                if (val !== null && val !== '') parts.push(`  ${attr}: ${val} !important;`);
            });

            const newRule = `.${className} {\n${parts.join('\n')}\n}`;
            const existing = styleEl.textContent.trimEnd();
            styleEl.textContent = existing ? existing + '\n' + newRule + '\n' : newRule + '\n';
        }

        // インラインスタイルが残っているとクラスの指定が上書きされてしまうため、クリアする
        if (window.cssToolbar && typeof window.cssToolbar._clearInlineStyles === 'function') {
            window.cssToolbar._clearInlineStyles(el);
        } else {
            // cssToolbarのメソッドがない場合のフォールバック
            const attrs = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
                'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor'];
            attrs.forEach(attr => el.node.removeAttribute(attr));
            el.node.removeAttribute('style');
            if (el.attrs) el.attrs = {};
            if (typeof el.attr === 'function') el.attr({ 'fill': null, 'stroke': null, 'stroke-width': null, 'stroke-dasharray': null, 'opacity': null });
        }

        // 図形にクラスを設定
        el.node.setAttribute('class', className);
        el.node.offsetHeight; // 強制リフロー

        // CSSツールバーのリストを更新
        if (window.cssToolbar && typeof window.cssToolbar.refreshClassList === 'function') {
            window.cssToolbar.refreshClassList();
        }

        if (window.syncChanges) window.syncChanges(true);
        document.body.removeChild(overlay);
    });
    btnRow.appendChild(saveBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Enterキーで保存
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
    });
    setTimeout(() => input.focus(), 50);
}

