/**
 * Mermaid Expanded View
 * Mermaid図形を全画面化し、SVGの viewBox を操作してパン・ズーム機能を提供します。
 * 実際のDOMを全画面化するため、拡大状態のままインライン編集やドラッグ操作が可能です。
 */

window.MermaidExpandedManager = {
    activeWrapperLine: null,
    activeCodeIndex: null, // ★追加: 行の変動に強い確実な要素特定のキー
    currentViewBox: null,
    defaultViewBox: null,
    origStyle: null,
    origSvgStyle: null,

    init() {
        if (document.getElementById('mermaid-expanded-styles')) return;

        // 全画面表示用のスタイル注入
        const style = document.createElement('style');
        style.id = 'mermaid-expanded-styles';
        style.textContent = `
            #mermaid-expanded-backdrop {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.6); z-index: 99999; display: none;
            }
            .mermaid-fixed-expanded {
                position: fixed !important;
                top: 5vh !important; left: 5vw !important;
                width: 90vw !important; height: 90vh !important;
                background: #ffffff !important;
                z-index: 100000 !important;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important;
                border-radius: 8px !important;
                margin: 0 !important;
                padding: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .mermaid-fixed-expanded svg {
                max-width: none !important;
                max-height: none !important;
                width: 100% !important;
                height: 100% !important;
            }
            .mermaid-fixed-expanded svg { cursor: grab; }
            .mermaid-fixed-expanded svg:active { cursor: grabbing; }
            .mermaid-fixed-expanded svg * { cursor: inherit; }

            .mermaid-expanded-controls {
                position: absolute;
                top: 16px; right: 16px;
                display: flex; gap: 8px;
                z-index: 100001;
            }
            .mermaid-expanded-btn {
                padding: 8px 16px; font-size: 13px; font-weight: bold;
                color: white; border: none;
                border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                cursor: pointer; transition: background 0.2s;
                display: flex; align-items: center; justify-content: center;
            }
            .mermaid-expanded-close-btn { background: #ef4444; }
            .mermaid-expanded-close-btn:hover { background: #dc2626; }

            .mermaid-expanded-reset-btn { background: #3b82f6; }
            .mermaid-expanded-reset-btn:hover { background: #2563eb; }

            .mermaid-expanded-edit-btn { background: #10b981; }
            .mermaid-expanded-edit-btn:hover { background: #059669; }
            .mermaid-expanded-edit-btn.is-editing { background: #f59e0b; }
            .mermaid-expanded-edit-btn.is-editing:hover { background: #d97706; }

            .mermaid-expanded-placeholder {
                width: 100%; min-height: 200px;
                background: #f8f9fa; border: 1px dashed #ccc;
                display: flex; align-items: center; justify-content: center;
                color: #888; font-size: 14px;
                margin: 16px 0;
            }
        `;
        document.head.appendChild(style);

        const backdrop = document.createElement('div');
        backdrop.id = 'mermaid-expanded-backdrop';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        backdrop.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });

        document.addEventListener('wheel', this.onWheel.bind(this), { passive: false, capture: true });
        document.addEventListener('mousedown', this.onMouseDown.bind(this), { capture: true });
        document.addEventListener('mousemove', this.onMouseMove.bind(this), { capture: true });
        document.addEventListener('mouseup', this.onMouseUp.bind(this), { capture: true });
        document.addEventListener('keydown', (e) => {
            // インプット要素でのEscapeは無視
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'Escape' && (this.activeWrapperLine != null || this.activeCodeIndex != null)) {
                this.close();
            }
        });

        // 自動復元オブザーバー（DOMが追加されたら最新の要素を探してバトンタッチする）
        const observer = new MutationObserver((mutations) => {
            if (this.activeCodeIndex == null && this.activeWrapperLine == null) return;
            let hasNewNodes = false;
            for (const m of mutations) {
                if (m.addedNodes.length > 0) {
                    hasNewNodes = true;
                    break;
                }
            }
            if (hasNewNodes) {
                this.restoreIfNeeded();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    toggle(wrapper) {
        if (this.activeWrapperLine != null || this.activeCodeIndex != null) {
            this.close();
            return;
        }

        const cbw = wrapper.closest('.code-block-wrapper');
        const codeIndex = cbw?.getAttribute('data-code-index');
        const dataLine = wrapper.getAttribute('data-line') || cbw?.getAttribute('data-line');
        
        if (codeIndex == null && dataLine == null) return;

        this.activeCodeIndex = codeIndex;
        this.activeWrapperLine = dataLine;
        this.applyExpandedState(wrapper, true);
    },

    close() {
        const wrapper = document.querySelector('.mermaid-diagram-wrapper.mermaid-fixed-expanded');
        if (!wrapper) {
            this.activeCodeIndex = null;
            this.activeWrapperLine = null;
            this.currentViewBox = null;
            const backdrop = document.getElementById('mermaid-expanded-backdrop');
            if (backdrop) backdrop.style.display = 'none';
            return;
        }

        const cbw = wrapper.closest('.code-block-wrapper');
        const codeIndex = this.activeCodeIndex !== null ? this.activeCodeIndex : cbw?.getAttribute('data-code-index');
        const line = this.activeWrapperLine || cbw?.getAttribute('data-line');
        
        this.activeCodeIndex = null;
        this.activeWrapperLine = null;
        this.currentViewBox = null;
        
        const backdrop = document.getElementById('mermaid-expanded-backdrop');
        if (backdrop) backdrop.style.display = 'none';

        wrapper.classList.remove('mermaid-fixed-expanded');
        if (this.origStyle !== null) wrapper.style.cssText = this.origStyle;
        
        if (cbw && cbw.parentNode === document.body) {
            let placeholder = null;
            if (codeIndex != null) placeholder = document.getElementById('mermaid-expanded-placeholder-idx-' + codeIndex);
            if (!placeholder && line != null) placeholder = document.getElementById('mermaid-expanded-placeholder-' + line);
            
            if (placeholder && placeholder.parentNode) {
                // プレースホルダーの属性をcbwに反映（FastPathによる行番号の変動を適用するため）
                ['data-line', 'data-line-end', 'data-code-index', 'data-block-hash'].forEach(attr => {
                    if (placeholder.hasAttribute(attr)) {
                        cbw.setAttribute(attr, placeholder.getAttribute(attr));
                        if(wrapper.hasAttribute(attr)) wrapper.setAttribute(attr, placeholder.getAttribute(attr)); // wrapperも更新
                    }
                });

                placeholder.replaceWith(cbw);
            } else {
                const preview = document.getElementById('preview');
                if (preview) {
                    const existing = preview.querySelector(`.code-block-wrapper[data-code-index="${codeIndex}"]`) || 
                                     preview.querySelector(`.code-block-wrapper[data-line="${line}"]`);
                    if (existing && existing !== cbw) {
                        existing.replaceWith(cbw);
                    } else {
                        preview.appendChild(cbw);
                    }
                } else {
                    cbw.remove();
                }
            }
        }

        const svg = wrapper.querySelector('svg:not(.mermaid-overlay-svg):not(.mermaid-class-overlay-svg):not(.mermaid-er-overlay-svg)');
        if (svg) {
            if (this.defaultViewBox) svg.setAttribute('viewBox', this.defaultViewBox);
            const overlays = wrapper.querySelectorAll('.mermaid-overlay-svg, .mermaid-class-overlay-svg, .mermaid-er-overlay-svg');
            overlays.forEach(o => o.removeAttribute('viewBox'));
            if (this.origSvgStyle !== null) svg.style.cssText = this.origSvgStyle;
        }
        
        wrapper.querySelectorAll('.mermaid-expanded-controls').forEach(el => el.remove());

        this.triggerUpdateUI(wrapper);
        this.updateToolbars();
    },

    getActiveWrapper() {
        const wrapper = document.querySelector('.mermaid-diagram-wrapper.mermaid-fixed-expanded');
        if (wrapper) return wrapper;

        if (this.activeCodeIndex == null && this.activeWrapperLine == null) return null;
        
        let w = null;
        if (this.activeCodeIndex != null) {
            w = document.querySelector(`body > .code-block-wrapper[data-code-index="${this.activeCodeIndex}"] .mermaid-diagram-wrapper`);
        }
        if (!w && this.activeWrapperLine != null) {
            w = document.querySelector(`body > .code-block-wrapper[data-line="${this.activeWrapperLine}"] .mermaid-diagram-wrapper`);
        }
        return w;
    },

    applyExpandedState(wrapper, isInitial = false) {
        const backdrop = document.getElementById('mermaid-expanded-backdrop');
        if (backdrop) backdrop.style.display = 'block';

        if (isInitial) {
            this.origStyle = wrapper.style.cssText;
        }

        wrapper.classList.add('mermaid-fixed-expanded');
        
        const cbw = wrapper.closest('.code-block-wrapper');
        const codeIndex = this.activeCodeIndex != null ? this.activeCodeIndex : cbw?.getAttribute('data-code-index');
        const dataLine = this.activeWrapperLine || cbw?.getAttribute('data-line');

        if (cbw && cbw.parentNode !== document.body) {
            let pid = codeIndex != null ? 'mermaid-expanded-placeholder-idx-' + codeIndex : 'mermaid-expanded-placeholder-' + dataLine;
            let placeholder = document.getElementById(pid);
            if (!placeholder && dataLine) {
                placeholder = document.getElementById('mermaid-expanded-placeholder-' + dataLine);
            }
            
            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = pid;
                placeholder.className = 'mermaid-expanded-placeholder';
                placeholder.textContent = '拡大表示中...';
            }
            
            // ★ FastPath の Diff で正しく検知されるよう、重要な属性をプレースホルダーに引き継ぐ
            ['data-line', 'data-line-end', 'data-code-index', 'data-block-hash'].forEach(attr => {
                if (cbw.hasAttribute(attr)) {
                    placeholder.setAttribute(attr, cbw.getAttribute(attr));
                }
            });

            cbw.parentNode.insertBefore(placeholder, cbw);
            document.body.appendChild(cbw);
        }

        const svg = wrapper.querySelector('svg:not(.mermaid-overlay-svg):not(.mermaid-class-overlay-svg):not(.mermaid-er-overlay-svg)');
        
        if (svg) {
            if (isInitial) this.origSvgStyle = svg.style.cssText;
            
            let vb = svg.getAttribute('viewBox');
            if (!vb) {
                const rect = svg.getBBox ? svg.getBBox() : svg.getBoundingClientRect();
                vb = `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
            }
            this.defaultViewBox = vb;
            
            const parts = vb.split(/[ ,]+/).map(parseFloat);
            if (parts.length === 4) {
                const margin = Math.max(parts[2], parts[3]) * 0.05;
                parts[0] -= margin;
                parts[1] -= margin;
                parts[2] += margin * 2;
                parts[3] += margin * 2;
                
                if (isInitial || !this.currentViewBox) this.currentViewBox = parts;
            } else if (isInitial || !this.currentViewBox) {
                this.currentViewBox = parts;
            }

            if (this.currentViewBox) {
                const vbStr = this.currentViewBox.join(' ');
                svg.setAttribute('viewBox', vbStr);
                const overlays = wrapper.querySelectorAll('.mermaid-overlay-svg, .mermaid-class-overlay-svg, .mermaid-er-overlay-svg');
                overlays.forEach(o => o.removeAttribute('viewBox'));
            }
        }

        let controls = wrapper.querySelector('.mermaid-expanded-controls');
        if (!controls) {
            controls = document.createElement('div');
            controls.className = 'mermaid-expanded-controls';
            wrapper.appendChild(controls);
        }

        // ★ tabIndex=-1 と onmousedown でキーボード・クリック誤爆を防止
        if (!controls.querySelector('.mermaid-expanded-edit-btn')) {
            const eBtn = document.createElement('button');
            eBtn.className = 'mermaid-expanded-btn mermaid-expanded-edit-btn';
            eBtn.tabIndex = -1;
            
            const isEditing = wrapper.classList.contains('mermaid-edit-mode') || 
                              wrapper.classList.contains('mermaid-sequence-edit-mode') ||
                              wrapper.classList.contains('mermaid-class-edit-mode') ||
                              wrapper.classList.contains('mermaid-er-edit-mode');
            
            eBtn.innerHTML = isEditing ? '✔️ 完了' : '✏️ 編集';
            if (isEditing) eBtn.classList.add('is-editing');
            
            eBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
            eBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                
                if (typeof InlineCodeEditor !== 'undefined') {
                    const cbw = wrapper.closest('.code-block-wrapper');
                    if (cbw) {
                        const currentlyEditing = wrapper.classList.contains('mermaid-edit-mode') || 
                                                 wrapper.classList.contains('mermaid-sequence-edit-mode') ||
                                                 wrapper.classList.contains('mermaid-class-edit-mode') ||
                                                 wrapper.classList.contains('mermaid-er-edit-mode');
                        
                        if (currentlyEditing) {
                            InlineCodeEditor.exitMermaidEdit();
                        } else {
                            InlineCodeEditor.startMermaidEdit(cbw);
                        }

                        setTimeout(() => {
                            const stillEditing = wrapper.classList.contains('mermaid-edit-mode') || 
                                                 wrapper.classList.contains('mermaid-sequence-edit-mode') ||
                                                 wrapper.classList.contains('mermaid-class-edit-mode') ||
                                                 wrapper.classList.contains('mermaid-er-edit-mode');
                            if (stillEditing) {
                                eBtn.innerHTML = '✔️ 完了';
                                eBtn.classList.add('is-editing');
                            } else {
                                eBtn.innerHTML = '✏️ 編集';
                                eBtn.classList.remove('is-editing');
                            }
                        }, 100);
                    }
                }
            };
            controls.appendChild(eBtn);
        } else {
            const eBtn = controls.querySelector('.mermaid-expanded-edit-btn');
            const isEditing = wrapper.classList.contains('mermaid-edit-mode') || 
                              wrapper.classList.contains('mermaid-sequence-edit-mode') ||
                              wrapper.classList.contains('mermaid-class-edit-mode') ||
                              wrapper.classList.contains('mermaid-er-edit-mode');
            if (isEditing) {
                eBtn.innerHTML = '✔️ 完了';
                eBtn.classList.add('is-editing');
            } else {
                eBtn.innerHTML = '✏️ 編集';
                eBtn.classList.remove('is-editing');
            }
        }

        if (!controls.querySelector('.mermaid-expanded-reset-btn')) {
            const rBtn = document.createElement('button');
            rBtn.className = 'mermaid-expanded-btn mermaid-expanded-reset-btn';
            rBtn.tabIndex = -1;
            rBtn.innerHTML = '↻ リセット';
            rBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
            rBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (this.defaultViewBox && svg) {
                    this.currentViewBox = this.defaultViewBox.split(/[ ,]+/).map(parseFloat);
                    svg.setAttribute('viewBox', this.defaultViewBox);
                    const overlays = wrapper.querySelectorAll('.mermaid-overlay-svg, .mermaid-class-overlay-svg, .mermaid-er-overlay-svg');
                    overlays.forEach(o => o.removeAttribute('viewBox'));
                    this.triggerUpdateUI(wrapper);
                }
            };
            controls.appendChild(rBtn);
        }

        if (!controls.querySelector('.mermaid-expanded-close-btn')) {
            const btn = document.createElement('button');
            btn.className = 'mermaid-expanded-btn mermaid-expanded-close-btn';
            btn.tabIndex = -1; // フォーカス奪取を防止
            btn.innerHTML = `閉じる`;
            btn.title = '閉じる (Esc)';
            btn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                this.close();
            };
            controls.appendChild(btn);
        }

        setTimeout(() => {
            this.updateToolbars();
            this.triggerUpdateUI(wrapper);
        }, 50);
    },

    // ★ rendererによって作り直された「新しい要素」を探し、古い要素から状態を引き継ぐ
    restoreIfNeeded(newWrapper) {
        if (this.activeCodeIndex == null && this.activeWrapperLine == null) return;
        
        let latestWrapper = newWrapper;
        if (!latestWrapper) {
            const preview = document.getElementById('preview');
            if (preview) {
                if (this.activeCodeIndex != null) {
                    const cbw = preview.querySelector(`.code-block-wrapper[data-code-index="${this.activeCodeIndex}"]`);
                    if (cbw) latestWrapper = cbw.querySelector('.mermaid-diagram-wrapper');
                }
                if (!latestWrapper && this.activeWrapperLine != null) {
                    const cbw = preview.querySelector(`.code-block-wrapper[data-line="${this.activeWrapperLine}"]`);
                    if (cbw) latestWrapper = cbw.querySelector('.mermaid-diagram-wrapper');
                }
            }
        }

        if (latestWrapper && !latestWrapper.classList.contains('mermaid-fixed-expanded')) {
            const oldExpanded = document.querySelector('.mermaid-diagram-wrapper.mermaid-fixed-expanded');
            let wasEditMode = false;

            if (oldExpanded && oldExpanded !== latestWrapper) {
                wasEditMode = oldExpanded.classList.contains('mermaid-edit-mode') || 
                              oldExpanded.classList.contains('mermaid-sequence-edit-mode') ||
                              oldExpanded.classList.contains('mermaid-class-edit-mode') ||
                              oldExpanded.classList.contains('mermaid-er-edit-mode');
                const oldCbw = oldExpanded.closest('.code-block-wrapper');
                if (oldCbw && oldCbw.parentNode === document.body) {
                    oldCbw.remove();
                }
            }

            this.activeWrapperLine = latestWrapper.getAttribute('data-line') || latestWrapper.closest('.code-block-wrapper')?.getAttribute('data-line') || this.activeWrapperLine;
            this.activeCodeIndex = latestWrapper.closest('.code-block-wrapper')?.getAttribute('data-code-index') || this.activeCodeIndex;
            
            // 最新の要素を拡大・退避
            this.applyExpandedState(latestWrapper, false);

            // 編集モードだった場合は、InlineCodeEditor等を使って編集状態を再起動する
            if (wasEditMode && typeof InlineCodeEditor !== 'undefined') {
                const newCbw = latestWrapper.closest('.code-block-wrapper');
                if (newCbw) {
                    InlineCodeEditor.startMermaidEdit(newCbw);
                    // ボタン表示の更新
                    const eBtn = latestWrapper.querySelector('.mermaid-expanded-edit-btn');
                    if (eBtn) {
                        eBtn.innerHTML = '✔️ 完了';
                        eBtn.classList.add('is-editing');
                    }
                }
            }
        }
    },

    updateToolbars() {
        if (window.activeMermaidToolbar && typeof window.activeMermaidToolbar.updatePosition === 'function') window.activeMermaidToolbar.updatePosition();
        if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar.updatePosition === 'function') window.activeMermaidSequenceToolbar.updatePosition();
        if (window.activeMermaidClassToolbar && typeof window.activeMermaidClassToolbar.updatePosition === 'function') window.activeMermaidClassToolbar.updatePosition();
        if (window.activeMermaidErToolbar && typeof window.activeMermaidErToolbar.updatePosition === 'function') window.activeMermaidErToolbar.updatePosition();
    },

    // --- パン・ズーム処理 ---
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,

    onWheel(e) {
        if (this.activeCodeIndex == null && this.activeWrapperLine == null) return;
        const wrapper = this.getActiveWrapper();
        if (!wrapper || !wrapper.contains(e.target)) return;

        e.preventDefault();
        const svg = wrapper.querySelector('svg:not(.mermaid-overlay-svg):not(.mermaid-class-overlay-svg):not(.mermaid-er-overlay-svg)');
        if (!svg || !this.currentViewBox) return;

        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const svgP = pt.matrixTransform(ctm.inverse());

        const zoomFactor = Math.exp(e.deltaY * 0.0015);
        let [vx, vy, vw, vh] = this.currentViewBox;

        const newVw = vw * zoomFactor;
        const newVh = vh * zoomFactor;

        if (newVw > 100000 || newVw < 10) return;

        const rx = (svgP.x - vx) / vw;
        const ry = (svgP.y - vy) / vh;

        const newVx = svgP.x - newVw * rx;
        const newVy = svgP.y - newVh * ry;

        this.currentViewBox = [newVx, newVy, newVw, newVh];
        const vbStr = this.currentViewBox.join(' ');
        svg.setAttribute('viewBox', vbStr);
        
        const overlays = wrapper.querySelectorAll('.mermaid-overlay-svg, .mermaid-class-overlay-svg, .mermaid-er-overlay-svg');
        overlays.forEach(o => o.removeAttribute('viewBox'));

        this.triggerUpdateUI(wrapper);
    },

    onMouseDown(e) {
        if (this.activeCodeIndex == null && this.activeWrapperLine == null) return;
        const wrapper = this.getActiveWrapper();
        if (!wrapper || !wrapper.contains(e.target)) return;

        if (e.target.closest('.mermaid-expanded-close-btn, .mermaid-expanded-reset-btn, .mermaid-expanded-edit-btn')) return;

        const isInteractive = e.target.closest('g.node, g.classGroup, [id^="entity-"], .mermaid-connect-handle, .mermaid-class-connect-handle, .mermaid-er-connect-handle, .mermaid-seq-hover-icon, .mermaid-sequence-drag-handle, rect, circle, polygon, path:not(.edge-hitbox), text, button, select, input, textarea');
        
        if (!isInteractive || e.button === 1 || e.shiftKey || e.target.tagName.toLowerCase() === 'svg') {
            e.preventDefault();
            this.isPanning = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        }
    },

    onMouseMove(e) {
        if (!this.isPanning || (this.activeCodeIndex == null && this.activeWrapperLine == null)) return;
        
        const wrapper = this.getActiveWrapper();
        const svg = wrapper?.querySelector('svg:not(.mermaid-overlay-svg):not(.mermaid-class-overlay-svg):not(.mermaid-er-overlay-svg)');
        if (!svg || !this.currentViewBox) return;

        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        const rect = svg.getBoundingClientRect();
        const scaleX = this.currentViewBox[2] / (rect.width || window.innerWidth);
        const scaleY = this.currentViewBox[3] / (rect.height || window.innerHeight);

        this.currentViewBox[0] -= dx * scaleX;
        this.currentViewBox[1] -= dy * scaleY;
        
        const vbStr = this.currentViewBox.join(' ');
        svg.setAttribute('viewBox', vbStr);

        const overlays = wrapper.querySelectorAll('.mermaid-overlay-svg, .mermaid-class-overlay-svg, .mermaid-er-overlay-svg');
        overlays.forEach(o => o.removeAttribute('viewBox'));

        this.triggerUpdateUI(wrapper);
    },

    onMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
        }
    },

    triggerUpdateUI(wrapper) {
        const svg = wrapper.querySelector('svg');
        if (!svg) return;

        if (wrapper._mermaidAPI && typeof wrapper._mermaidAPI.updateSelectionUI === 'function') {
            wrapper._mermaidAPI.updateSelectionUI();
        } else {
            if (window.MermaidSequenceInteraction && wrapper.classList.contains('mermaid-sequence-edit-mode')) {
                if (typeof MermaidSequenceInteraction._redrawSelections === 'function') MermaidSequenceInteraction._redrawSelections(svg);
            }
            if (window.MermaidClassInteraction && wrapper.classList.contains('mermaid-class-edit-mode')) {
                if (typeof MermaidClassInteraction._updateSelectionUI === 'function') MermaidClassInteraction._updateSelectionUI(wrapper);
            }
            if (window.MermaidErInteraction && wrapper.classList.contains('mermaid-er-edit-mode')) {
                if (typeof MermaidErInteraction._updateSelectionUI === 'function') MermaidErInteraction._updateSelectionUI(wrapper);
            }
            
            if (wrapper.classList.contains('mermaid-edit-mode')) {
                const overlay = wrapper.querySelector('.mermaid-overlay-svg');
                if (overlay) {
                    Array.from(overlay.children).forEach(c => {
                        if (c.tagName.toLowerCase() !== 'defs') overlay.removeChild(c);
                    });
                    wrapper.querySelectorAll('.mermaid-hover-rect').forEach(el => el.remove());
                }
            }
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.MermaidExpandedManager.init());
} else {
    window.MermaidExpandedManager.init();
}

window.showMermaidExpandedView = (wrapper) => window.MermaidExpandedManager.toggle(wrapper);
window.restoreMermaidExpandedView = (wrapper) => {
    if (window.MermaidExpandedManager) window.MermaidExpandedManager.restoreIfNeeded(wrapper);
};
