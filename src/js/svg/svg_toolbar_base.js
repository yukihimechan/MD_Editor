/**
 * SVGツールバーの共通基盤クラス
 * 各ツールバーはこのクラスを継承、またはこのクラスのメソッドを利用して構築します。
 */

var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);

class SVGToolbarBase {
    constructor(config = {}) {
        this.config = config;
        this.id = config.id || 'svg-toolbar';
        this.toolbarElement = null;
        this.contentArea = null;
        this.container = config.container || null;
    }

    /**
     * ツールバー用の共通ドラッグハンドルを作成
     */
    createDragHandle(title, borderColor) {
        const handle = document.createElement('button');
        handle.className = 'svg-toolbar-drag-handle';
        handle.title = title || t('svgEditor.toolbarBase.dragToMove') || 'ドラッグして移動';

        if (borderColor) {
            handle.style.setProperty('--handle-color', borderColor, 'important');
            handle.style.setProperty('border', `1px solid ${borderColor}`, 'important');
            handle.style.setProperty('border-radius', '3px', 'important');
            handle.style.setProperty('padding', '0', 'important');
            handle.style.setProperty('opacity', '1', 'important');
        }

        // 縦点リーダー(U+22EE)を2つ並べて6点マーカを表現。視認性向上のためサイズを22px、文字間隔を0pxに変更。
        handle.innerHTML = `<span style="font-size: 22px; line-height: 1; letter-spacing: 0px; pointer-events: none;">⋮⋮</span>`;

        // ダブルクリックで100%表示をピン留め/解除
        handle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const toolbar = handle.closest('.svg-toolbar');
            if (toolbar) {
                const isPinned = toolbar.classList.toggle('is-pinned');
                // ピン留め状態を保存
                const storageKey = (toolbar.id || 'svg-toolbar') + '-is-pinned';
                localStorage.setItem(storageKey, isPinned);
            }
        });

        return handle;
    }

    /**
     * ツールバー用の共通伸縮ハンドル（||）を作成
     */
    createResizeDivider(title, borderColor) {
        const divider = document.createElement('div');
        divider.className = 'svg-toolbar-resize-divider';
        divider.title = title || t('svgEditor.toolbarBase.dragToResize') || 'ドラッグして伸縮（端までドラッグで左右入替）';

        // ドラッグハンドルと同様のスタイルを適用
        divider.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 8px; /* 極限まで狭く */
            height: 24px;
            cursor: ew-resize;
            margin: 0 1px;
            color: ${borderColor || '#666'};
            user-select: none;
            flex-shrink: 0;
            opacity: 0.7;
        `;
        // 1px幅の線を0.5pxの隙間で2本配置
        divider.innerHTML = '<span style="border-left: 1.5px solid currentColor; height: 14px; margin: 0 0.5px;"></span><span style="border-left: 1.5px solid currentColor; height: 14px; margin: 0 0.5px;"></span>';

        divider.onmouseover = () => divider.style.opacity = '1';
        divider.onmouseout = () => divider.style.opacity = '0.7';

        return divider;
    }

    /**
     * ツールバーの伸縮・位置入替ロジックを初期化
     */
    initToolbarLayout(toolbar) {
        if (!toolbar) return;
        const handle = toolbar.querySelector('.svg-toolbar-drag-handle');
        const divider = toolbar.querySelector('.svg-toolbar-resize-divider');
        if (!handle || !divider) return;

        const storageKeyPrefix = toolbar.id || 'svg-toolbar';
        const widthKey = storageKeyPrefix + '-width';
        const swappedKey = storageKeyPrefix + '-is-swapped';

        // 状態の復元
        const savedWidth = localStorage.getItem(widthKey);
        if (savedWidth && parseInt(savedWidth) >= 100) { // 100px未満の極小幅は表示崩れを防ぐため無視
            toolbar.style.width = savedWidth + 'px';
        }

        const isSwapped = localStorage.getItem(swappedKey) === 'true';
        if (isSwapped) {
            toolbar.classList.add('is-swapped');
            toolbar.style.flexDirection = 'row-reverse';
        }

        // リサイズドラッグロジック
        let isResizing = false;
        let startX, startWidth, startLeft, interactOriginalWidth;

        divider.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            startX = e.clientX;
            startWidth = toolbar.offsetWidth;
            startLeft = parseInt(toolbar.style.left) || 0;
            interactOriginalWidth = startWidth; // ドラッグ開始時の長さを記録

            // 最大幅（自然な幅）を記録（初回のみ）
            if (!toolbar.dataset.maxWidth) {
                const contentArea = toolbar.querySelector('.svg-toolbar-content');
                const originalWidthStyle = toolbar.style.width;
                const originalContentOverflow = contentArea ? contentArea.style.overflow : 'hidden';

                toolbar.style.width = 'auto';
                if (contentArea) contentArea.style.overflow = 'visible';
                toolbar.dataset.maxWidth = toolbar.offsetWidth;
                toolbar.style.width = originalWidthStyle;
                if (contentArea) contentArea.style.overflow = originalContentOverflow;
            }

            const onMouseMove = (moveE) => {
                if (!isResizing) return;

                const swapped = toolbar.classList.contains('is-swapped');
                const dx = moveE.clientX - startX;

                let newWidth, newLeft;
                const minW = 46;
                const maxWidth = parseInt(toolbar.dataset.maxWidth);

                if (swapped) {
                    // 反転（||が左端）のときは、左に引くと伸び、右に引くと縮む。
                    // 左端（left）も同時に動かすことで、右端を固定したまま伸縮させる。
                    newWidth = startWidth - dx;
                    if (newWidth > maxWidth) newWidth = maxWidth;
                    if (newWidth < minW) newWidth = minW;

                    const actualDx = startWidth - newWidth;
                    newLeft = startLeft + actualDx;

                    toolbar.style.left = newLeft + 'px';
                    toolbar.style.width = newWidth + 'px';
                } else {
                    // 通常時（||が右端）
                    newWidth = startWidth + dx;
                    if (newWidth > maxWidth) newWidth = maxWidth;
                    if (newWidth < minW) newWidth = minW;

                    toolbar.style.width = newWidth + 'px';
                }
            };

            const onMouseUp = (upE) => {
                if (isResizing) {
                    isResizing = false;
                    toolbar.style.cursor = '';

                    const swapped = toolbar.classList.contains('is-swapped');
                    const handleRect = handle.getBoundingClientRect();

                    // 入替判定：マウスを放した瞬間に反対側にいるか
                    const shouldSwap = swapped ? (upE.clientX > handleRect.right) : (upE.clientX < handleRect.left);

                    if (shouldSwap) {
                        const nextSwapped = !swapped;
                        toolbar.classList.toggle('is-swapped', nextSwapped);
                        toolbar.style.flexDirection = nextSwapped ? 'row-reverse' : 'row';
                        localStorage.setItem(swappedKey, nextSwapped);

                        // 入替時は「ドラッグハンドル」の視覚的な位置を維持したまま反転させる
                        const hW = handle.offsetWidth;
                        const W = interactOriginalWidth;
                        let flipLeft;

                        if (nextSwapped) {
                            flipLeft = startLeft - (W - hW);
                        } else {
                            flipLeft = startLeft + (startWidth - hW);
                        }

                        toolbar.style.left = flipLeft + 'px';
                        toolbar.style.width = W + 'px';

                        // 座標の変化を保存
                        const posKey = storageKeyPrefix + '-pos';
                        const currentPos = JSON.parse(localStorage.getItem(posKey) || '{}');
                        currentPos.left = flipLeft;
                        localStorage.setItem(posKey, JSON.stringify(currentPos));
                    }

                    localStorage.setItem(widthKey, parseInt(toolbar.style.width));
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            toolbar.style.cursor = 'ew-resize';
        };
    }

    /**
     * ツールバーの共通レイアウト状態をリセット
     */
    resetLayoutState(toolbar) {
        if (!toolbar) return;
        const storageKeyPrefix = toolbar.id || 'svg-toolbar';
        localStorage.removeItem(storageKeyPrefix + '-width');
        localStorage.removeItem(storageKeyPrefix + '-is-swapped');
        localStorage.removeItem(storageKeyPrefix + '-is-pinned');

        toolbar.style.width = '';
        
        const defaultSwapped = this.config.isSwapped === true;
        if (defaultSwapped) {
            toolbar.style.flexDirection = 'row-reverse';
            toolbar.classList.add('is-swapped');
        } else {
            toolbar.style.flexDirection = 'row';
            toolbar.classList.remove('is-swapped');
        }
        toolbar.classList.remove('is-pinned');
    }

    /**
     * ピン留め状態やレイアウト状態を復元
     */
    applyPinnedState(toolbar) {
        if (!toolbar) return;
        const prefix = toolbar.id || 'svg-toolbar';

        // 1. ピン留め状態の復元 (100%表示固定)
        const isPinned = localStorage.getItem(prefix + '-is-pinned') === 'true';
        if (isPinned) {
            toolbar.classList.add('is-pinned');
        }

        // 2. 左右入替・幅の復元
        let isSwapped = localStorage.getItem(prefix + '-is-swapped');
        if (isSwapped === null) {
            isSwapped = this.config.isSwapped === true;
        } else {
            isSwapped = isSwapped === 'true';
        }
        const width = localStorage.getItem(prefix + '-width');

        if (isSwapped) {
            toolbar.classList.add('is-swapped');
            toolbar.style.flexDirection = 'row-reverse';
        }
        if (width && parseInt(width) >= 100) { // 100px未満の極小幅は表示崩れを防ぐため無視
            toolbar.style.width = width + 'px';
        }
    }

    /**
     * ツールバーの位置、伸縮、ピン留め状態を初期状態にリセット
     */
    resetPosition() {
        if (!this.toolbarElement) return;
        const toolbar = this.toolbarElement;
        const prefix = toolbar.id || 'svg-toolbar';

        // localStorage の情報を削除
        localStorage.removeItem(prefix + '-pos');
        localStorage.removeItem(prefix + '-width');
        localStorage.removeItem(prefix + '-is-swapped');
        localStorage.removeItem(prefix + '-is-pinned');

        // 位置をデフォルトへ
        if (this.config.position) {
            toolbar.style.top = this.config.position.top || '';
            if (this.config.position.right) {
                toolbar.style.right = this.config.position.right;
                toolbar.style.left = 'auto';
            } else {
                toolbar.style.left = this.config.position.left || '';
                toolbar.style.right = 'auto'; // 絶対配置を保証
            }
            toolbar.style.transform = 'none';
        }

        // 基盤クラスのレイアウト状態をリセット
        this.resetLayoutState(toolbar);
    }

    /**
     * ツールバーの基本構造（ハンドル、ロジック込）を生成する
     */
    createBaseToolbar(config) {
        const toolbar = document.createElement('div');
        toolbar.id = config.id;
        toolbar.className = 'svg-toolbar theme-blue';

        // 基本スタイル
        // [FIX] 外部CSSによって枠線色が上書きされるのを防ぐため !important を付与
        toolbar.style.cssText = `
            position: absolute;
            display: flex;
            align-items: center;
            background: white;
            border: 1px solid ${config.borderColor || '#0D31BB'} !important;
            border-radius: 8px;
            padding: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            z-index: 1000;
            white-space: nowrap;
        `;

        if (config.position) {
            if (config.position.top) toolbar.style.top = config.position.top;
            if (config.position.left) toolbar.style.left = config.position.left;
            if (config.position.right) toolbar.style.right = config.position.right;
        }

        const dragHandle = this.createDragHandle(t('svgEditor.toolbarBase.dragToMove') || 'ドラッグして移動', config.borderColor);
        toolbar.appendChild(dragHandle);

        const contentArea = document.createElement('div');
        contentArea.className = 'svg-toolbar-content';
        contentArea.style.cssText = `display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; flex: 1; overflow: hidden; border-radius: 0;`;
        toolbar.appendChild(contentArea);

        const resizeDivider = this.createResizeDivider(t('svgEditor.toolbarBase.dragToResize') || 'ドラッグして伸縮（端までドラッグで左右入替）', config.borderColor);
        toolbar.appendChild(resizeDivider);

        this.applyPinnedState(toolbar);

        if (window.SVGUtils && window.SVGUtils.makeElementDraggable) {
            window.SVGUtils.makeElementDraggable(toolbar, dragHandle, {
                storageKey: (config.id || 'svg-toolbar') + '-pos',
                container: this.container || document.body
            });
        }

        this.initToolbarLayout(toolbar);

        return { toolbar, contentArea };
    }

    loadToolDefaults() {
        if (!this.toolDefaults) this.toolDefaults = {};
        const key = this.toolDefaultsKey || (this.id + '-defaults');
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                for (let k in parsed) {
                    if (this.toolDefaults[k]) {
                        Object.assign(this.toolDefaults[k], parsed[k]);
                    } else {
                        this.toolDefaults[k] = parsed[k];
                    }
                }
            } catch (e) {
                console.warn(`[SVGToolbarBase] Failed to load tool defaults for ${this.id}`);
            }
        }
    }

    saveToolDefaults() {
        if (this.toolDefaults) {
            const key = this.toolDefaultsKey || (this.id + '-defaults');
            localStorage.setItem(key, JSON.stringify(this.toolDefaults));
        }
    }

    getToolProperty(toolId, propName, defaultValue) {
        if (this.toolDefaults && this.toolDefaults[toolId] && propName in this.toolDefaults[toolId]) {
            return this.toolDefaults[toolId][propName];
        }
        return defaultValue;
    }

    setToolProperty(toolId, propName, value) {
        if (!this.toolDefaults) this.toolDefaults = {};
        if (!this.toolDefaults[toolId]) this.toolDefaults[toolId] = {};
        this.toolDefaults[toolId][propName] = value;
        this.saveToolDefaults();
    }

    showToolPropertiesDialog(toolId, toolLabel) {
        if (typeof window.currentEditingSVG === 'undefined') return;

        if (!this.toolDefaults || !this.toolDefaults[toolId]) {
            console.log(`[SVGToolbarBase] No initial properties defined for ${toolId}`);
            return;
        }

        const props = this.toolDefaults[toolId];
        
        let style = document.getElementById('svg-toolbar-prop-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'svg-toolbar-prop-style';
            style.textContent = `
                .svg-prop-row { margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; }
                .svg-prop-label { font-size: 12px; color: #333; }
                .svg-color-preview-container { display: flex; align-items: center; gap: 8px; }
                .pcr-button { width: 40px !important; height: 24px !important; border: 1px solid #ccc !important; border-radius: 4px !important; }
                .pcr-app { z-index: 15000 !important; }
            `;
            document.head.appendChild(style);
        }

        const dialog = document.createElement('div');
        dialog.className = 'svg-property-dialog tool-settings';
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:25px;border:1px solid #ccc;box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:12000;width:400px;border-radius:12px;';

        let html = `<h3 style="margin:0 0 20px 0; font-size:16px;">${toolLabel || toolId} ${t('svgEditor.toolbarBase.defaultSettings') || 'の既定設定'}</h3>`;

        const keys = Object.keys(props);
        const pickersToInit = [];
        let tempProps = { ...props };

        keys.forEach(k => {
            const val = props[k];
            
            if (k === 'fill' || k === 'stroke') {
                const labelName = k === 'fill' ? (t('svgEditor.properties.fillColor') || '塗りつぶし色') : (t('svgEditor.properties.borderColor') || '枠線色');
                const triggerId = `tool-${k}-trigger`;
                html += `
                    <div class="svg-prop-row">
                        <span class="svg-prop-label">${labelName}:</span>
                        <div class="svg-color-preview-container">
                            <div id="${triggerId}"></div>
                            ${k === 'fill' ? `<label style="font-size:12px;"><input type="checkbox" id="tool-fill-none" ${val === 'none' ? 'checked' : ''}> ${t('svgEditor.toolbarBase.none') || 'なし'}</label>` : ''}
                        </div>
                    </div>
                `;
                pickersToInit.push({ key: k, triggerId: triggerId, initialVal: val });
            } else if (typeof val === 'number') {
                const labelMap = {
                    'stroke-width': t('svgEditor.properties.borderWidth') || '枠線幅',
                    'radius': t('svgEditor.properties.cornerRadius') || '角の半径',
                    'spikes': t('svgEditor.properties.starSpikes') || '星の角数',
                    'sides': t('svgEditor.properties.polygonSides') || '多角形の辺数',
                    'fontSize': t('svgEditor.properties.fontSize') || 'フォントサイズ',
                    'len': t('svgEditor.arrow.param_len') || '矢印の長さ',
                    'shaftW': t('svgEditor.arrow.param_shaft_w') || '軸の太さ',
                    'headW': t('svgEditor.arrow.param_head_w') || '矢印先の幅',
                    'headL': t('svgEditor.arrow.param_head_l') || '矢印先の長さ',
                    'legH': t('svgEditor.arrow.param_leg_h') || '水平部の長さ',
                    'legV': t('svgEditor.arrow.param_leg_v') || '垂直部の長さ',
                    'legH1': t('svgEditor.arrow.param_leg_h1') || '前半の長さ',
                    'legH2': t('svgEditor.arrow.param_leg_h2') || '後半の長さ',
                    'uWidth': t('svgEditor.arrow.param_u_width') || 'U字の幅'
                };
                const labelName = labelMap[k] || k;
                html += `
                    <div style="margin-bottom:15px;">
                        <label style="display:block;margin-bottom:5px;font-size:12px;">${labelName}:</label>
                        <input type="number" id="tool-${k}" data-prop-key="${k}" value="${val}" min="0" ${k === 'stroke-width' ? 'step="0.5"' : 'step="1"'} style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;">
                    </div>
                `;
            } else if (typeof val === 'string' && k !== 'fill' && k !== 'stroke') {
                html += `
                    <div style="margin-bottom:15px;">
                        <label style="display:block;margin-bottom:5px;font-size:12px;">${k}:</label>
                        <input type="text" id="tool-${k}" data-prop-key="${k}" value="${val}" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:4px;">
                    </div>
                `;
            }
        });

        html += `
            <div style="text-align:right; margin-top:20px; display:flex; gap:12px; justify-content:flex-end;">
                <button id="tool-settings-cancel" style="padding:6px 16px; border:1px solid #ddd; background:#fff; color:#333; cursor:pointer; border-radius:4px;">${t('svgEditor.properties.cancel') || '取消'}</button>
                <button id="tool-settings-ok" style="background:#0366d6; color:white; border:none; padding:6px 16px; border-radius:4px; cursor:pointer; font-weight:500;">${t('svgEditor.properties.save') || '保存'}</button>
            </div>
        `;
        dialog.innerHTML = html;
        document.body.appendChild(dialog);

        // カラーピッカーの初期化
        const pickers = [];
        pickersToInit.forEach(p => {
            const trigger = dialog.querySelector('#' + p.triggerId);
            if (!trigger || typeof ColorPickerUI === 'undefined') return;

            const initialStr = p.initialVal === 'none' ? 'rgba(0,0,0,0)' : p.initialVal;
            trigger.style.cssText = `width: 24px; height: 24px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background-color: ${p.initialVal === 'none' ? 'transparent' : initialStr};`;

            const picker = new ColorPickerUI({
                color: initialStr,
                isPopup: true,
                onChange: (color) => {
                    const hex = color.toHexString(true);
                    const val = color.a === 0 ? 'none' : hex;
                    trigger.style.backgroundColor = val === 'none' ? 'transparent' : val;
                    tempProps[p.key] = val;
                }
            });

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                picker.show(trigger);
            });
            pickers.push(picker);
        });

        const closeDialog = () => {
            // [FIX] 破棄処理のエラーを回避
            pickers.forEach(picker => {
                if (picker) {
                    try {
                        if (typeof picker.destroy === 'function') {
                            picker.destroy();
                        } else if (picker.wrapper && picker.wrapper.parentNode) {
                            picker.wrapper.parentNode.removeChild(picker.wrapper);
                        }
                    } catch (e) {
                         console.warn('[SVGToolbarBase] Error closing picker', e);
                    }
                }
            });
            
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        };

        dialog.querySelector('#tool-settings-ok').addEventListener('click', (ev) => {
            ev.stopPropagation();
            
            // "なし" チェックボックスの反映
            const fillNoneElement = dialog.querySelector('#tool-fill-none');
            if (fillNoneElement && fillNoneElement.checked) {
                tempProps['fill'] = 'none';
            }

            // 数値・テキストインプットの反映
            const inputs = dialog.querySelectorAll('input[data-prop-key]');
            inputs.forEach(input => {
                const k = input.getAttribute('data-prop-key');
                if (input.type === 'number') {
                    tempProps[k] = parseFloat(input.value);
                } else {
                    tempProps[k] = input.value;
                }
            });

            // プロパティを一括保存
            Object.keys(tempProps).forEach(k => {
                this.setToolProperty(toolId, k, tempProps[k]);
            });

            closeDialog();
        });

        dialog.querySelector('#tool-settings-cancel').addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeDialog();
        });
    }
}

// グローバルに公開
window.SVGToolbarBase = SVGToolbarBase;
