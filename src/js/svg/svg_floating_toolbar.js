/**
 * SVG Editor Floating Toolbar
 * 選択した図形の近くに表示されるコンテキストツールバー
 */

class SVGFloatingToolbar {
    constructor() {
        this.el = null;
        this.activeEditor = null;
        this.selectedElements = new Set();
        this._updatePositionBound = this.updatePosition.bind(this);
        this.isVisible = false;
        
        // 外部から操作を渡してもらう用
        this.actions = null;
        this.container = null;
        this.svgIndex = null;
    }

    init() {
        if (this.el) return;

        this.el = document.createElement('div');
        this.el.className = 'svg-floating-toolbar';
        this.el.style.cssText = `
            position: fixed;
            display: none;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            opacity: 0;
            transition: opacity 0.15s ease, transform 0.1s ease;
            pointer-events: none; /* ラッパー自体はマウスイベントを素通りさせる */
        `;

        this.el.innerHTML = this._getToolbarHTML();
        document.body.appendChild(this.el);

        this._bindEvents();
    }

    _isOpenPath(el) {
        if (!el || !el.node) return false;
        const tagName = el.node.tagName.toLowerCase();
        const toolId = el.attr('data-tool-id');
        const openPathTools = ['line', 'arrow', 'polyline', 'freehand', 'airbrush', 'orthogonal', 'orthogonal_line', 'curve'];
        if (openPathTools.includes(toolId)) return true;
        if (tagName === 'line' || tagName === 'polyline') return true;
        return false;
    }

    _getMainPanelHTML(isOpenPath) {
        const iconStyle = 'width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;';
        const icons = {
            duplicate: `<svg style="${iconStyle}" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
            trash: `<svg style="${iconStyle}" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
            startArrow: `<svg style="${iconStyle}" viewBox="0 0 24 24"><path d="M19 12H5M9 16l-4-4 4-4"/></svg>`,
            endArrow: `<svg style="${iconStyle}" viewBox="0 0 24 24"><path d="M5 12h14M15 16l4-4-4-4"/></svg>`,
            forward: `<svg style="${iconStyle}" viewBox="0 0 24 24"><path d="M4 10h12v10H4z"/><path d="M10 4h10v10h-6"/></svg>`,
            backward: `<svg style="${iconStyle}" viewBox="0 0 24 24"><path d="M10 4h10v10h-6"/><path d="M4 10h12v10H4z" fill="var(--svg-toolbar-bg, #ffffff)"/></svg>`,
            more: `<svg style="${iconStyle}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`
        };

        const btnStyle = `
            background: transparent;
            border: none;
            padding: 0;
            cursor: pointer;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--svg-toolbar-fg, #333);
            transition: background 0.15s ease;
        `;

        if (isOpenPath) {
            return `
                <button class="svg-float-btn" data-action="duplicate" style="${btnStyle}" title="複製">${icons.duplicate}</button>
                <button class="svg-float-btn" data-action="delete" style="${btnStyle}" title="削除">${icons.trash}</button>
                <div style="width: 1px; height: 14px; background: var(--svg-toolbar-border, #e0e0e0); margin: 0 4px;"></div>
                <button class="svg-float-btn" data-action="startArrow" style="${btnStyle}" title="始点矢印">${icons.startArrow}</button>
                <button class="svg-float-btn" data-action="endArrow" style="${btnStyle}" title="終点矢印">${icons.endArrow}</button>
                <div style="width: 1px; height: 14px; background: var(--svg-toolbar-border, #e0e0e0); margin: 0 4px;"></div>
                <button class="svg-float-btn" data-action="more" style="${btnStyle}" title="詳細メニュー">${icons.more}</button>
            `;
        } else {
            return `
                <button class="svg-float-btn" data-action="duplicate" style="${btnStyle}" title="複製">${icons.duplicate}</button>
                <button class="svg-float-btn" data-action="delete" style="${btnStyle}" title="削除">${icons.trash}</button>
                <div style="width: 1px; height: 14px; background: var(--svg-toolbar-border, #e0e0e0); margin: 0 4px;"></div>
                <button class="svg-float-btn" data-action="forward" style="${btnStyle}" title="一つ前へ">${icons.forward}</button>
                <button class="svg-float-btn" data-action="backward" style="${btnStyle}" title="一つ後ろへ">${icons.backward}</button>
                <div style="width: 1px; height: 14px; background: var(--svg-toolbar-border, #e0e0e0); margin: 0 4px;"></div>
                <button class="svg-float-btn" data-action="more" style="${btnStyle}" title="詳細メニュー">${icons.more}</button>
            `;
        }
    }

    _getAnnotationPanelHTML(isOpenPath, toolId) {
        const iconStyle = 'width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;';
        const icons = {
            duplicate: `<svg style="${iconStyle}" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
            trash: `<svg style="${iconStyle}" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
            comment: `<svg style="${iconStyle}" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"></path></svg>`
        };

        const btnStyle = `
            background: transparent;
            border: none;
            padding: 0;
            cursor: pointer;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--svg-toolbar-fg, #333);
            transition: background 0.15s ease;
        `;

        let html = '';
        
        // 吹き出しの場合はコメントボタンを出す
        if (toolId === 'bubble') {
            html += `<button class="svg-float-btn" data-action="comment" style="${btnStyle}" title="コメントを編集">${icons.comment}</button>`;
            html += `<div style="width: 1px; height: 14px; background: var(--svg-toolbar-border, #e0e0e0); margin: 0 4px;"></div>`;
        }

        html += `
            <button class="svg-float-btn" data-action="duplicate" style="${btnStyle}" title="複製">${icons.duplicate}</button>
            <button class="svg-float-btn" data-action="delete" style="${btnStyle}; color: #e74c3c;" title="削除">${icons.trash}</button>
        `;

        return html;
    }

    _getToolbarHTML() {
        const iconStyle = 'width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;';
        
        const panelStyle = `
            background: var(--svg-toolbar-bg, #ffffff);
            border: 1px solid var(--svg-toolbar-border, #e0e0e0);
            box-shadow: 0 4px 15px var(--svg-toolbar-shadow, rgba(0,0,0,0.1));
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 12px;
            padding: 0px 6px;
            display: flex;
            align-items: center;
            gap: 2px;
            pointer-events: auto;
        `;

        const rotatePanelStyle = `
            background: var(--svg-toolbar-bg, #ffffff);
            border: 1px solid var(--svg-toolbar-border, #e0e0e0);
            box-shadow: 0 4px 15px var(--svg-toolbar-shadow, rgba(0,0,0,0.1));
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            cursor: grab;
            color: var(--svg-toolbar-fg, #333);
            touch-action: none; /* ドラッグ中断防止 */
        `;

        return `
            <div class="svg-float-rotate-handle" style="${rotatePanelStyle}" title="ドラッグして回転">
                <svg style="${iconStyle}; width:18px; height:18px;" viewBox="0 0 24 24">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                </svg>
            </div>
            <div class="svg-floating-toolbar-main" style="${panelStyle}">
                ${this._getMainPanelHTML(false)}
            </div>
        `;
    }

    _bindEvents() {
        this.el.addEventListener('mouseover', (e) => {
            const btn = e.target.closest('.svg-float-btn');
            if (btn) btn.style.background = 'var(--svg-toolbar-btn-hover-bg, rgba(0,0,0,0.05))';
        });

        this.el.addEventListener('mouseout', (e) => {
            const btn = e.target.closest('.svg-float-btn');
            if (btn) btn.style.background = 'transparent';
        });

        this.el.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // ドラッグ選択解除防止
        });

        this.el.addEventListener('click', (e) => {
            const btn = e.target.closest('.svg-float-btn');
            if (!btn || !this.actions) return;
            e.stopPropagation();

            const action = btn.getAttribute('data-action');
            this._handleAction(action, e);
        });

        // 回転ハンドルのイベント
        const rotateHandle = this.el.querySelector('.svg-float-rotate-handle');
        if (rotateHandle) {
            rotateHandle.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                console.log('[FloatingToolbar] rotate pointerdown', e);
                
                let handler = null;
                if (this.selectedElements && this.selectedElements.size > 0) {
                    const firstEl = this.selectedElements.values().next().value;
                    if (firstEl && typeof firstEl.remember === 'function') {
                        const shape = firstEl.remember('_shapeInstance');
                        if (shape) handler = shape._rotationHandler;
                    }
                }
                
                console.log('[FloatingToolbar] resolved handler:', handler);
                
                if (handler) {
                    if (!handler.activeElement && this.selectedElements && this.selectedElements.size > 0) {
                        handler.activeElement = this.selectedElements.values().next().value.node;
                        console.log('[FloatingToolbar] Set activeElement manually:', handler.activeElement);
                    }

                    // 回転中はメインツールバーを隠す
                    const mainPanel = this.el.querySelector('.svg-floating-toolbar-main');
                    if (mainPanel) mainPanel.style.display = 'none';

                    // ドラッグ終了時に元に戻すためのフック
                    const restorePanel = () => {
                        if (mainPanel) mainPanel.style.display = 'flex';
                        window.removeEventListener('pointerup', restorePanel);
                        window.removeEventListener('pointercancel', restorePanel);
                    };
                    window.addEventListener('pointerup', restorePanel);
                    window.addEventListener('pointercancel', restorePanel);
                    
                    // 回転処理の開始
                    handler.handleRotationStart(e);
                }
            });
            rotateHandle.addEventListener('mouseover', () => {
                rotateHandle.style.background = 'var(--svg-toolbar-btn-hover-bg, rgba(0,0,0,0.05))';
            });
            rotateHandle.addEventListener('mouseout', () => {
                rotateHandle.style.background = 'var(--svg-toolbar-bg, #ffffff)';
            });
        }
    }

    _handleAction(action, e) {
        switch (action) {
            case 'comment': {
                let isAnnotation = false;
                if (this.selectedElements && this.selectedElements.size > 0) {
                    const firstEl = this.selectedElements.values().next().value;
                    if (firstEl && firstEl.attr('data-annotation') === 'true') {
                        isAnnotation = true;
                    }
                }

                if ((this.activeEditor && this.activeEditor._isAnnotationLayerMock) || isAnnotation) {
                    if (window.AnnotationCommentPanel) {
                        window.AnnotationCommentPanel.toggle();
                    }
                } else if (this.selectedElements && this.selectedElements.size > 0 && typeof this.actions.showProperties === 'function') {
                    const firstEl = this.selectedElements.values().next().value;
                    let targetNode = firstEl.node;
                    if (firstEl.hasClass('svg-canvas-proxy')) {
                        targetNode = this.activeEditor.draw.node;
                    }
                    this.actions.showProperties(targetNode, this.svgIndex, this.container);
                }
                break;
            }
            case 'lock':
                if (this.selectedElements.size > 0) {
                    let allLocked = true;
                    this.selectedElements.forEach(el => {
                        if (el.node.getAttribute('data-locked') !== 'true') {
                            allLocked = false;
                        }
                    });

                    const newState = !allLocked;
                    this.selectedElements.forEach(el => {
                        el.node.setAttribute('data-locked', newState ? 'true' : 'false');
                        // ロック状態に応じて、必要であればリサイズハンドルなどを更新する
                        const shape = el.remember && el.remember('_shapeInstance');
                        if (shape && typeof shape.syncSelectionHandlers === 'function') {
                            shape.syncSelectionHandlers(null, true);
                        }
                    });

                    // アイコンの状態を更新
                    this._updateLockIcon(newState);

                    // 同期とSVGリストの更新
                    if (window.syncChanges) window.syncChanges(true);
                    if (window.svgList && typeof window.svgList.updateList === 'function') {
                        window.svgList.updateList();
                    }
                }
                break;
            case 'duplicate':
                if (typeof this.actions.copy === 'function' && typeof this.actions.paste === 'function') {
                    this.actions.copy();
                    // 少しずらしてペーストするロジックは paste 側にあると想定
                    this.actions.paste(this.container);
                }
                break;
            case 'delete':
                if (typeof this.actions.delete === 'function') {
                    this.actions.delete();
                }
                break;
            case 'startArrow':
                if (this.selectedElements.size === 1) {
                    const el = this.selectedElements.values().next().value;
                    const hasStart = el.node.getAttribute('data-arrow-start') === 'true';
                    el.node.setAttribute('data-arrow-start', !hasStart);
                    if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                        window.SVGToolbar.updateArrowMarkers(el);
                    }
                    if (window.cleanUpUnusedMarkers) window.cleanUpUnusedMarkers(this.activeEditor.draw);
                    if (window.syncChanges) window.syncChanges(true);
                    if (this.activeEditor.polylineHandler) {
                        const selGrp = this.container.querySelector('.svg-select-group, .svg_select_group');
                        this.activeEditor.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                    }
                }
                break;
            case 'endArrow':
                if (this.selectedElements.size === 1) {
                    const el = this.selectedElements.values().next().value;
                    const hasEnd = el.node.getAttribute('data-arrow-end') === 'true';
                    el.node.setAttribute('data-arrow-end', !hasEnd);
                    if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                        window.SVGToolbar.updateArrowMarkers(el);
                    }
                    if (window.cleanUpUnusedMarkers) window.cleanUpUnusedMarkers(this.activeEditor.draw);
                    if (window.syncChanges) window.syncChanges(true);
                    if (this.activeEditor.polylineHandler) {
                        const selGrp = this.container.querySelector('.svg-select-group, .svg_select_group');
                        this.activeEditor.polylineHandler.update(selGrp, el.node, el.node.getBBox());
                    }
                }
                break;
            case 'forward':
                if (typeof this.actions.bringForward === 'function') {
                    this.actions.bringForward();
                }
                break;
            case 'backward':
                if (typeof this.actions.sendBackward === 'function') {
                    this.actions.sendBackward();
                }
                break;
            case 'more':
                if (typeof window.showSVGContextMenu === 'function') {
                    // SVG_context_menu.js の呼び出し
                    // ボタンの下に出るように位置を調整
                    window.showSVGContextMenu(e, this.container, this.svgIndex, this.activeEditor, this.actions, true);
                }
                break;
        }
    }

    show(editor, selectedElements, actions, container, svgIndex) {
        console.log('[FloatingToolbar] show called. selected:', selectedElements.size);
        if (!this.el) this.init();
        if (selectedElements.size === 0) {
            this.hide();
            return;
        }

        this.activeEditor = editor;
        this.selectedElements = selectedElements;
        this.actions = actions;
        this.container = container;
        this.svgIndex = svgIndex;

        let toolId = null;
        let isOpenPath = false;
        let isAnnotation = false;

        if (this.selectedElements.size > 0) {
            const firstEl = this.selectedElements.values().next().value;
            if (firstEl && firstEl.attr('data-annotation') === 'true') {
                isAnnotation = true;
            }
        }

        if (this.selectedElements.size === 1) {
            const el = this.selectedElements.values().next().value;
            isOpenPath = this._isOpenPath(el);
            toolId = el.attr('data-tool-id');
            
            // テキスト追加によってグループ化（shape-text-group）された場合、子要素にbubbleがあるかチェック
            if (toolId !== 'bubble' && el.node && typeof el.node.querySelector === 'function') {
                if (el.node.querySelector('[data-tool-id="bubble"]')) {
                    toolId = 'bubble';
                }
            }
        }

        const mainPanel = this.el.querySelector('.svg-floating-toolbar-main');
        if (mainPanel) {
            if ((this.activeEditor && this.activeEditor._isAnnotationLayerMock) || isAnnotation) {
                mainPanel.innerHTML = this._getAnnotationPanelHTML(isOpenPath, toolId);
            } else {
                mainPanel.innerHTML = this._getMainPanelHTML(isOpenPath);
            }
        }

        // ロックアイコンは削除したため更新処理をコメントアウトまたは削除します
        // this._updateLockIcon(allLocked);

        this.isVisible = true;
        this.el.style.display = 'flex';
        // pointer-eventsは子要素(panelStyle)で制御するためここは変更しない
        
        // 描画を待って位置計算
        requestAnimationFrame(() => {
            this.updatePosition();
            this.el.style.opacity = '1';
        });

        // ズーム・パン追従用
        if (this.activeEditor && this.activeEditor.draw) {
            this.activeEditor.draw.off('zoomchange', this._updatePositionBound);
            this.activeEditor.draw.on('zoomchange', this._updatePositionBound);
            this.activeEditor.draw.off('panchange', this._updatePositionBound);
            this.activeEditor.draw.on('panchange', this._updatePositionBound);
        }
    }

    hide() {
        console.log('[FloatingToolbar] hide called.');
        if (!this.el || !this.isVisible) return;
        this.isVisible = false;
        this.el.style.opacity = '0';
        // pointer-eventsは固定

        if (this.activeEditor && this.activeEditor.draw) {
            this.activeEditor.draw.off('zoomchange', this._updatePositionBound);
            this.activeEditor.draw.off('panchange', this._updatePositionBound);
        }

        setTimeout(() => {
            if (!this.isVisible && this.el) {
                this.el.style.display = 'none';
            }
        }, 150);
    }

    updatePosition() {
        if (!this.isVisible || !this.el || !this.activeEditor || this.selectedElements.size === 0) {
            console.log('[FloatingToolbar] updatePosition aborted', { isVisible: this.isVisible, size: this.selectedElements ? this.selectedElements.size : 0 });
            return;
        }

        // 全要素のバウンディングボックスを計算 (画面座標)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        this.selectedElements.forEach(el => {
            if (!el || !el.node || !el.node.isConnected) return;
            try {
                // キャンバス選択時は除く
                if (el.hasClass('svg-canvas-proxy')) return;

                const rect = el.node.getBoundingClientRect();
                minX = Math.min(minX, rect.left);
                minY = Math.min(minY, rect.top);
                maxX = Math.max(maxX, rect.right);
                maxY = Math.max(maxY, rect.bottom);
            } catch (e) {}
        });

        if (minX === Infinity) {
            console.log('[FloatingToolbar] minX is Infinity. Hiding.');
            // 有効な要素がなければ隠す
            this.hide();
            return;
        }

        const menuRect = this.el.getBoundingClientRect();
        const padding = 16;
        
        let left = minX + (maxX - minX) / 2 - menuRect.width / 2;
        let top = minY - menuRect.height - padding;

        // console.log('[FloatingToolbar] Positioning at', { left, top, minX, minY, maxX, maxY });

        // 画面上部にはみ出す場合は下に出す
        if (top < 10) {
            top = maxY + padding;
        }

        // 左右のはみ出し補正
        if (left < 10) left = 10;
        if (left + menuRect.width > window.innerWidth - 10) {
            left = window.innerWidth - menuRect.width - 10;
        }

        this.el.style.transform = `translate(${left}px, ${top}px)`;
    }

    // ドラッグ中やリサイズ中は一時的に隠すためのメソッド
    temporarilyHide() {
        if (!this.el) return;
        this.el.style.opacity = '0';
        this.el.style.pointerEvents = 'none';
    }

    restoreVisibility() {
        if (!this.el || !this.isVisible) return;
        this.updatePosition();
        this.el.style.opacity = '1';
        this.el.style.pointerEvents = 'auto';
    }

    _updateLockIcon(isLocked) {
        const lockBtn = this.el.querySelector('[data-action="lock"]');
        if (!lockBtn) return;
        const iconStyle = 'width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;';
        if (isLocked) {
            // ロックされている場合は「アンロック」アイコンにするなどの工夫も可能だが、
            // 今回はとりあえず色や不透明度で状態を示すか、アイコンを変える
            lockBtn.innerHTML = `<svg style="${iconStyle}" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
            lockBtn.style.color = 'var(--svg-toolbar-accent, #2196F3)';
        } else {
            lockBtn.innerHTML = `<svg style="${iconStyle}" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`; // アンロックアイコン風
            lockBtn.style.color = 'var(--svg-toolbar-fg, #333)';
        }
    }
}

window.svgFloatingToolbar = new SVGFloatingToolbar();
