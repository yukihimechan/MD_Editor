/**
 * SVG Animation Style Toolbar
 * 表示・スタイルアニメーション（フェードイン、色変更、一筆書きなど）を設定するUIモジュール
 */
var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);
class SVGAnimationStyleToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-style-toolbar',
            container: container,
            borderColor: options.borderColor || '#FF5722',
            position: options.position || { top: '50px', right: '-36px' },
            isSwapped: true
        });
        this.onValueChange = options.onValueChange || (() => { });
        this.animations = [{ type: 'none', amount: '', dur: '', easing: 'ease-in-out', repeat: '1', trigger: 'auto' }];
        this.rowInputs = [];
        this.colorPickers = []; // Keep track of pickers to destroy them

        this.createToolbar();
        this.addGlobalClickClose();
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-animation-style-toolbar');
        this.contentArea.style.flexDirection = 'column';
        this.contentArea.style.alignItems = 'stretch';
        this.contentArea.style.gap = '4px';

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';
        this.rowInputs = [];
        
        // Destroy old color pickers
        this.colorPickers.forEach(p => { if (p && p.destroyAndRemove) p.destroyAndRemove(); });
        this.colorPickers = [];

        this.animations.forEach((anim, index) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:2px; white-space:nowrap;';

            // ツールバーラベル
            const label = document.createElement('span');
            label.style.cssText = 'color:var(--svg-toolbar-fg); font-size:10px; font-weight:bold; margin:0 4px; width:48px;';
            label.textContent = index === 0 ? (t('svgEditor.animStyle.label') || 'スタイルアニメ:') : '';
            row.appendChild(label);

            // 種類 (Type)
            const typeSelect = document.createElement('select');
            typeSelect.style.width = '75px';
            typeSelect.innerHTML = `
                <option value="none">${t('svgEditor.animTransform.none') || 'なし'}</option>
                <option value="fade-in">${t('svgEditor.animStyle.fadeIn') || 'フェードイン(徐々に表示)'}</option>
                <option value="fade-out">${t('svgEditor.animStyle.fadeOut') || 'フェードアウト(徐々に消える)'}</option>
                <option value="flash">${t('svgEditor.animStyle.flash') || '点滅'}</option>
                <option value="color-fill">${t('svgEditor.animStyle.colorFill') || '塗り色変更'}</option>
                <option value="color-line">${t('svgEditor.animStyle.colorLine') || '線色変更'}</option>
                <option value="dash-draw">${t('svgEditor.animStyle.dashDraw') || '一筆書き(線の描画)'}</option>
            `;
            typeSelect.value = anim.type;
            
            // 変化量 (Amount / Color)
            const amountWrap = document.createElement('div');
            amountWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px; width: 45px; justify-content:center;';
            
            const colorContainer = document.createElement('div');
            colorContainer.style.cssText = `width: 20px; height: 20px; padding: 0; border: 1px solid var(--svg-toolbar-input-border); background: var(--svg-toolbar-input-bg); border-radius: 3px; cursor: pointer; position: relative; box-sizing: border-box; display: none;`;
            
            const colorBg = document.createElement('div');
            colorBg.className = 'color-preview-bg';
            colorBg.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; border-radius: 2px; box-sizing: border-box; background: transparent; border: 1px solid var(--svg-toolbar-border);`;
            colorContainer.appendChild(colorBg);
            
            const colorAnchor = document.createElement('div');
            colorAnchor.className = 'picker-anchor';
            colorContainer.appendChild(colorAnchor);
            
            amountWrap.appendChild(colorContainer);

            // 値の同期用内部変数
            let currentColorAmount = anim.amount || '#ff0000';

            const updateAmountUI = () => {
                const val = typeSelect.value;
                if (val === 'color-fill' || val === 'color-line') {
                    colorContainer.style.display = 'block';
                    colorBg.style.background = currentColorAmount;
                    if (val === 'color-line') {
                        colorBg.style.border = `2px solid ${currentColorAmount}`;
                        colorBg.style.background = 'transparent';
                    } else {
                        colorBg.style.border = 'none';
                        colorBg.style.background = currentColorAmount;
                    }
                } else {
                    colorContainer.style.display = 'none';
                }
            };
            
            // Color Picker Initialization
            if (typeof ColorPickerUI !== 'undefined') {
                let isInitializingPicker = true;
                const picker = new ColorPickerUI({
                    color: currentColorAmount,
                    isPopup: true,
                    layout: 'horizontal',
                    onChange: (color) => {
                        let colorStr = color;
                        if (typeof color.toHexString === 'function') {
                            colorStr = color.toHexString(true);
                        } else if (color === 'none') {
                            colorStr = 'transparent';
                        }
                        currentColorAmount = colorStr;
                        updateAmountUI();
                        if (!isInitializingPicker) {
                            this.handleUIChange();
                        }
                    }
                });
                isInitializingPicker = false;
                picker.options.trigger = colorContainer;
                colorContainer.onmousedown = (e) => e.stopPropagation();
                colorContainer.onclick = (e) => {
                    e.stopPropagation();
                    picker.show(colorContainer);
                };
                this.colorPickers.push(picker);
            }

            // 再生時間 (Duration)
            const durWrap = document.createElement('div');
            durWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
            durWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${t('svgEditor.animTransform.seconds') || '秒:'}</span>`;
            const durInput = document.createElement('input');
            durInput.type = 'number';
            durInput.style.width = '40px';
            durInput.style.textAlign = 'right';
            durInput.value = anim.dur || '1.0';
            durInput.step = '0.1';
            durInput.min = '0.1';
            durWrap.appendChild(durInput);

            // イージング (Easing)
            const easeSelect = document.createElement('select');
            easeSelect.style.width = '70px';
            easeSelect.innerHTML = `
                <option value="linear">${t('svgEditor.animTransform.ease.linear') || '一定'}</option>
                <option value="ease">${t('svgEditor.animTransform.ease.ease') || '滑らか'}</option>
                <option value="ease-in">${t('svgEditor.animTransform.ease.easeIn') || '徐々に'}</option>
                <option value="ease-out">${t('svgEditor.animTransform.ease.easeOut') || '最後急に'}</option>
                <option value="ease-in-out">${t('svgEditor.animTransform.ease.easeInOut') || '滑らか(強)'}</option>
            `;
            easeSelect.value = anim.easing;

            // 繰り返し (Repeat)
            const repeatSelect = document.createElement('select');
            repeatSelect.style.width = '60px';
            repeatSelect.innerHTML = `
                <option value="1">${t('svgEditor.animTransform.repeat1') || '1回'}</option>
                <option value="2">${t('svgEditor.animTransform.repeat2') || '2回'}</option>
                <option value="3">${t('svgEditor.animTransform.repeat3') || '3回'}</option>
                <option value="infinite">${t('svgEditor.animTransform.repeatInfinite') || '無限'}</option>
            `;
            repeatSelect.value = anim.repeat || '1';

            // トリガー (Trigger)
            const triggerSelect = document.createElement('select');
            triggerSelect.style.width = '75px';
            triggerSelect.innerHTML = `
                <option value="auto">${t('svgEditor.animTransform.triggerAuto') || '初めから'}</option>
                <option value="click">${t('svgEditor.animTransform.triggerClick') || 'クリックしたら'}</option>
            `;
            triggerSelect.value = anim.trigger || 'auto';

            // 初期化呼び出し
            updateAmountUI();

            const getAmountValue = () => {
                if (typeSelect.value === 'color-fill' || typeSelect.value === 'color-line') {
                    return currentColorAmount;
                }
                return '';
            };

            const inputs = {
                typeSelect,
                getAmountValue,
                durInput,
                easeSelect,
                repeatSelect,
                triggerSelect,
                updateAmountUI
            };
            this.rowInputs.push(inputs);

            // イベントリスナー
            [typeSelect, durInput, easeSelect, repeatSelect, triggerSelect].forEach(el => {
                el.addEventListener('change', () => {
                    if (el === typeSelect) updateAmountUI();
                    this.handleUIChange();
                });
            });

            // Prevent drag propagation
            [durInput, typeSelect, easeSelect, repeatSelect, triggerSelect].forEach(el => {
                el.addEventListener('mousedown', e => e.stopPropagation());
            });

            row.appendChild(typeSelect);
            row.appendChild(amountWrap);
            row.appendChild(durWrap);
            row.appendChild(easeSelect);
            row.appendChild(repeatSelect);
            row.appendChild(triggerSelect);
            
            // 削除ボタン
            if (this.animations.length > 1) {
                const removeBtn = document.createElement('button');
                removeBtn.innerHTML = '×';
                removeBtn.title = t('svgEditor.animTransform.removeTitle') || 'このアニメーションを削除';
                removeBtn.style.cssText = 'background:transparent; border:none; color:#FF5722; cursor:pointer; font-weight:bold; margin-left:4px; opacity:0.7; padding:0 4px;';
                removeBtn.onclick = () => {
                    this.animations.splice(index, 1);
                    this.renderContents();
                    this.handleUIChange();
                };
                row.appendChild(removeBtn);
            }

            // 追加ボタン
            if (index === this.animations.length - 1 && this.animations.length < 6) {
                const addBtn = document.createElement('button');
                addBtn.innerHTML = '＋';
                addBtn.title = t('svgEditor.animTransform.addTitle') || 'アニメーションを追加';
                addBtn.style.cssText = 'background:transparent; border:none; color:#4CAF50; cursor:pointer; font-weight:bold; margin-left:4px; padding:0 4px;';
                addBtn.onclick = () => {
                    this.animations.push({ type: 'none', amount: '', dur: '1.0', easing: 'ease-in-out', repeat: '1', trigger: 'auto' });
                    this.renderContents();
                };
                row.appendChild(addBtn);
            }

            contentArea.appendChild(row);
        });
    }

    handleUIChange() {
        const validAnimations = [];
        const seenTypes = new Set();

        this.rowInputs.forEach(inputs => {
            const type = inputs.typeSelect.value;
            const amount = inputs.getAmountValue();
            const dur = parseFloat(inputs.durInput.value);
            const easing = inputs.easeSelect.value;
            const repeat = inputs.repeatSelect.value;
            const trigger = inputs.triggerSelect.value;

            if (type !== 'none' && !isNaN(dur) && dur > 0 && !seenTypes.has(type)) {
                validAnimations.push({ type, amount, dur, easing, repeat, trigger });
                seenTypes.add(type);
            }
        });

        this.animations = this.rowInputs.map(inputs => ({
            type: inputs.typeSelect.value,
            amount: inputs.getAmountValue(),
            dur: inputs.durInput.value,
            easing: inputs.easeSelect.value,
            repeat: inputs.repeatSelect.value,
            trigger: inputs.triggerSelect.value
        }));

        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.forEach(el => {
                const animData = typeof SvgAnimationManager !== 'undefined' ? SvgAnimationManager.getAnimationData(el) : {};

                // 古いスタイルアニメーションの削除
                ['fade-in', 'fade-out', 'flash', 'color-fill', 'color-line', 'dash-draw'].forEach(t => {
                    if (animData[t] && !seenTypes.has(t)) {
                        if (typeof SvgAnimationManager !== 'undefined') SvgAnimationManager.removeAnimation(el, t);
                    }
                });

                // 新しいアニメーションの適用
                validAnimations.forEach(anim => {
                    const currentTiming = animData[anim.type] || {};
                    if (typeof SvgAnimationManager !== 'undefined') {
                        SvgAnimationManager.applyCssAnimation(el, {
                            type: anim.type,
                            amount: anim.amount,
                            dur: anim.dur,
                            easing: anim.easing,
                            repeat: anim.repeat,
                            trigger: anim.trigger,
                            delay: currentTiming.delay || 0
                        });
                    }
                });

                if (window.selectElement) window.selectElement(el, true);
            });

            if (window.animationTimingToolbar && typeof window.animationTimingToolbar.updateValuesFromSelected === 'function') {
                window.animationTimingToolbar.updateValuesFromSelected();
            }
        }
        
        this.onValueChange(this.id, this.animations);
    }

    updateValuesFromSelected() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        const selectedElements = Array.from(window.currentEditingSVG.selectedElements);
        if (selectedElements.length === 0) return;

        const firstEl = selectedElements[0];
        const animData = typeof SvgAnimationManager !== 'undefined' ? SvgAnimationManager.getAnimationData(firstEl) : {};

        const appliedTypes = ['fade-in', 'fade-out', 'flash', 'color-fill', 'color-line', 'dash-draw'].filter(t => animData[t]);
        
        this.animations = [];
        if (appliedTypes.length > 0) {
            appliedTypes.forEach(t => {
                const data = animData[t];
                this.animations.push({
                    type: data.type,
                    amount: data.amount,
                    dur: data.dur,
                    easing: data.easing,
                    repeat: data.repeat || '1',
                    trigger: data.trigger || 'auto'
                });
            });
        } else {
            this.animations = [{ type: 'none', amount: '', dur: '1.0', easing: 'ease-in-out', repeat: '1', trigger: 'auto' }];
        }

        this.renderContents();
    }

    show() { if (this.toolbarElement) this.toolbarElement.style.display = 'flex'; }
    hide() { /* Always visible */ }

    addGlobalClickClose() {
        this._globalClick = (e) => {};
        document.addEventListener('click', this._globalClick);
    }

    destroy() {
        if (this._globalClick) document.removeEventListener('click', this._globalClick);
        this.colorPickers.forEach(p => { if (p && p.destroyAndRemove) p.destroyAndRemove(); });
        this.colorPickers = [];
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createAnimationStyleToolbar = (container, options) => {
    return new SVGAnimationStyleToolbar(container, options);
};
