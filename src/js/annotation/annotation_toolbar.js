/**
 * AnnotationToolbar - 注釈機能用ツールバー
 * SVGToolbarBase を継承し、SVGエディタと同一の見た目を実現する。
 */
class AnnotationToolbar extends SVGToolbarBase {
    constructor(options = {}) {
        super({
            id:          options.id || 'annotation-edit-toolbar',
            container:   null,
            borderColor: '#e74c3c', // 注釈のデフォルトカラーっぽい赤
            position:    { top: '10px', left: '10px' },
        });

        this._toolDefs = [
            { id: 'select',   label: '選択',     icon: '<svg viewBox="0 0 24 24"><path d="M7 2l12 12-4 1 3 7-2 1-3-7-4 4V2z" fill="currentColor"/></svg>' },
            { id: 'freehand', label: '自由描画', icon: '<svg viewBox="0 0 24 24"><path d="M3 21c3-3 6-3 9 0s6 3 9 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'rect',     label: '矩形',     icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'circle',   label: '真円',     icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'line',     label: '直線',     icon: '<svg viewBox="0 0 24 24"><line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'bubble',   label: '吹出し',   icon: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'marker',   label: 'マーカー', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 14H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { isSeparator: true },
            { isCustom: true, type: 'color' },
            { isCustom: true, type: 'stroke' },
            { isSeparator: true },
            { id: 'clear',    label: '全消去',       icon: '🗑', isText: true, isAction: true, color: '#e74c3c' },
            { id: 'comments', label: 'コメント一覧', icon: '💬', isText: true, isAction: true },
            { id: 'close',    label: '終了',         icon: '✕', isText: true, isAction: true }
        ];

        this._buildToolbar();
    }

    _buildToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id:          this.id,
            borderColor: this.config.borderColor,
            position:    this.config.position,
        });

        this.toolbarElement = toolbar;
        this.toolbarElement.classList.add('annotation-toolbar');
        this.contentArea    = contentArea;
        this.toolbarElement.style.zIndex = '1200';
        this.toolbarElement.style.setProperty('display', 'none', 'important');

        // ツールバーのタイトル表示を追加（SVGツールバー等と合わせるため、必要なら入れる。今回はアイコンのみで十分かも）
        // const title = document.createElement('span');
        // title.style.cssText = 'font-weight:bold; font-size:12px; margin:0 8px; color:#333;';
        // title.textContent = '📝 アノテーション';
        // contentArea.appendChild(title);

        this._toolDefs.forEach(t => {
            if (t.isSeparator) {
                const sep = document.createElement('div');
                sep.style.cssText = 'width: 1px; height: 16px; background-color: rgba(0,0,0,0.1); margin: 0 4px;';
                contentArea.appendChild(sep);
                return;
            }

            if (t.isCustom) {
                if (t.type === 'color') {
                    const colorBtnContainer = document.createElement('div');
                    colorBtnContainer.title = '色';
                    colorBtnContainer.style.cssText = 'width: 24px; height: 24px; padding: 0; border: 1px solid var(--svg-toolbar-input-border, #ccc); cursor: pointer; border-radius: 4px; overflow: hidden; background-color: #e74c3c; margin: 0 4px;';
                    
                    if (typeof ColorPickerUI !== 'undefined') {
                        this.colorPicker = new ColorPickerUI({
                            color: '#e74c3c',
                            isPopup: true,
                            layout: 'horizontal',
                            onChange: (color) => {
                                let colorStr = color;
                                if (color && typeof color.toRGBA === 'function') {
                                    colorStr = color.toRGBA().toString(3); // rgba(r, g, b, a)
                                } else if (color && typeof color.toHexString === 'function') {
                                    colorStr = color.toHexString(true);
                                }
                                colorBtnContainer.style.backgroundColor = colorStr;
                                if (window.AnnotationLayer && typeof window.AnnotationLayer.setColor === 'function') {
                                    window.AnnotationLayer.setColor(colorStr);
                                }
                            }
                        });
                        this.colorPicker.options.trigger = colorBtnContainer;
                        colorBtnContainer.onclick = (e) => {
                            e.stopPropagation();
                            this.colorPicker.show(colorBtnContainer);
                        };
                    } else {
                        // Fallback to native
                        const colorInput = document.createElement('input');
                        colorInput.type = 'color';
                        colorInput.value = '#e74c3c';
                        colorInput.style.cssText = 'width: 100%; height: 100%; opacity: 0; cursor: pointer;';
                        colorInput.addEventListener('input', () => {
                            colorBtnContainer.style.backgroundColor = colorInput.value;
                            if (window.AnnotationLayer && typeof window.AnnotationLayer.setColor === 'function') {
                                window.AnnotationLayer.setColor(colorInput.value);
                            }
                        });
                        colorBtnContainer.appendChild(colorInput);
                    }
                    contentArea.appendChild(colorBtnContainer);
                } else if (t.type === 'stroke') {
                    const wrap = document.createElement('div');
                    wrap.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                    
                    const strokeInput = document.createElement('input');
                    strokeInput.type = 'range';
                    strokeInput.id = 'annotation-stroke-width';
                    strokeInput.min = '1';
                    strokeInput.max = '20';
                    strokeInput.value = '3';
                    strokeInput.title = '太さ';
                    strokeInput.style.cssText = 'width: 60px; cursor: pointer;';
                    
                    const strokeLabel = document.createElement('span');
                    strokeLabel.id = 'annotation-stroke-width-label';
                    strokeLabel.textContent = '3';
                    strokeLabel.style.cssText = 'font-size: 12px; min-width: 16px; text-align: center;';

                    strokeInput.addEventListener('input', () => {
                        strokeLabel.textContent = strokeInput.value;
                        if (window.AnnotationLayer && typeof window.AnnotationLayer.setStrokeWidth === 'function') {
                            window.AnnotationLayer.setStrokeWidth(parseInt(strokeInput.value, 10));
                        }
                    });

                    wrap.appendChild(strokeInput);
                    wrap.appendChild(strokeLabel);
                    contentArea.appendChild(wrap);
                }
                return;
            }

            const btn = document.createElement('button');
            btn.title = t.label;
            btn.dataset.tool = t.id;
            btn.className = 'annotation-tool-btn'; // 既存のCSSを利用
            
            // ボタンスタイル（SVGToolbarBase内の標準的なボタンに合わせる）
            btn.style.cssText = `
                width: 28px; height: 28px;
                border: 1px solid transparent; border-radius: 4px;
                background: transparent;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
                font-size: 14px;
            `;
            if (t.color) btn.style.color = t.color;
            if (t.id === 'select') {
                btn.classList.add('active');
                btn.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                btn.style.borderColor = '#ddd';
            }

            if (t.isText) {
                btn.textContent = t.icon;
            } else {
                btn.innerHTML = t.icon;
            }

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (t.isAction) {
                    this._onActionClick(t.id);
                } else {
                    this._onToolClick(t.id);
                }
            });

            // ホバーエフェクト
            btn.addEventListener('mouseenter', () => {
                if (!btn.classList.contains('active')) btn.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
            });
            btn.addEventListener('mouseleave', () => {
                if (!btn.classList.contains('active')) btn.style.backgroundColor = 'transparent';
            });

            contentArea.appendChild(btn);
        });

        document.body.appendChild(toolbar);
    }

    setActiveTool(toolId) {
        this._onToolClick(toolId);
    }

    _onToolClick(toolId) {
        if (window.AnnotationLayer && typeof window.AnnotationLayer.setTool === 'function') {
            window.AnnotationLayer.setTool(toolId);
        }
        
        // 選択状態の更新
        this.contentArea.querySelectorAll('button[data-tool]').forEach(btn => {
            const isAction = this._toolDefs.find(t => t.id === btn.dataset.tool)?.isAction;
            if (!isAction) {
                if (btn.dataset.tool === toolId) {
                    btn.classList.add('active');
                    btn.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                    btn.style.borderColor = '#ddd';
                } else {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = 'transparent';
                    btn.style.borderColor = 'transparent';
                }
            }
        });
    }

    _onActionClick(actionId) {
        if (window.AnnotationLayer) {
            if (actionId === 'clear' && typeof window.AnnotationLayer.clearAll === 'function') {
                if (confirm('すべてのアノテーションを削除しますか？')) {
                    window.AnnotationLayer.clearAll();
                    // コメントパネルも更新
                    if (typeof window.AnnotationCommentPanel !== 'undefined') {
                        window.AnnotationCommentPanel.refresh();
                    }
                }
            } else if (actionId === 'comments') {
                // コメントパネルのトグル
                if (typeof window.AnnotationCommentPanel !== 'undefined') {
                    window.AnnotationCommentPanel.toggle();
                }
            } else if (actionId === 'close') {
                this.hide(); // 自身のツールバーを確実に隠す
                if (typeof window.AnnotationLayer.disable === 'function') {
                    window.AnnotationLayer.disable();
                }
                const btnAnnotation = document.getElementById('btn-annotation');
                if (btnAnnotation) {
                    btnAnnotation.classList.remove('annotation-mode-on');
                    btnAnnotation.title = 'アノテーション（注釈描画）';
                }
            }
        }
    }

    show() {
        if (this.toolbarElement) {
            this.toolbarElement.style.setProperty('display', 'flex', 'important');
            this.toolbarElement.style.setProperty('position', 'fixed', 'important');
            this.toolbarElement.classList.add('is-active');
            
            // プレビュー領域内に確実に表示するよう位置セット
            const previewPane = document.getElementById('preview-pane');
            let leftPos, topPos;
            if (previewPane) {
                const rect = previewPane.getBoundingClientRect();
                leftPos = (rect.left + 20) + 'px';
                topPos = (rect.top + 20) + 'px';
            } else {
                leftPos = '20px';
                topPos = '20px';
            }
            this.toolbarElement.style.left = leftPos;
            this.toolbarElement.style.top = topPos;
            
            console.log(`[AnnotationToolbar] ツールバーを表示しました。座標: left=${leftPos}, top=${topPos}`);
            console.log(`[AnnotationToolbar Debug] parentElement:`, this.toolbarElement.parentElement ? this.toolbarElement.parentElement.tagName : 'null');
            console.log(`[AnnotationToolbar Debug] style.cssText:`, this.toolbarElement.style.cssText);
            const comp = window.getComputedStyle(this.toolbarElement);
            console.log(`[AnnotationToolbar Debug] Computed: display=${comp.display}, visibility=${comp.visibility}, opacity=${comp.opacity}, z-index=${comp.zIndex}, position=${comp.position}, width=${comp.width}, height=${comp.height}`);
        }
    }

    hide() {
        if (this.toolbarElement) {
            this.toolbarElement.style.setProperty('display', 'none', 'important');
            this.toolbarElement.classList.remove('is-active');
        }
    }
}

// グローバルに公開
window.AnnotationToolbar = AnnotationToolbar;

// インスタンス作成
(function initAnnotationToolbar() {
    function tryCreate() {
        if (window.activeAnnotationToolbar) return;
        if (typeof SVGToolbarBase === 'undefined') return;

        window.activeAnnotationToolbar = new AnnotationToolbar();
        console.log('[AnnotationToolbar] インスタンス作成完了');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
        tryCreate();
    }
})();
