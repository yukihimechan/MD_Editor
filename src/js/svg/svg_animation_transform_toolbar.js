/**
 * SVG Animation Transform Toolbar
 * 変形アニメーション（スピン、スイング、バウンド、パルス）を設定するUIモジュール
 */
var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);
class SVGAnimationTransformToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-transform-toolbar',
            container: container,
            borderColor: options.borderColor || '#FF5722',
            position: options.position || { top: '20px', right: '-36px' },
            isSwapped: true
        });
        this.onValueChange = options.onValueChange || (() => { });
        this.animations = [{ type: 'none', amount: '', dur: '', easing: 'ease-in-out', repeat: 'infinite', trigger: 'auto' }];
        this.rowInputs = [];

        this.createToolbar();
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-animation-transform-toolbar');
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

        this.animations.forEach((anim, index) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:2px; white-space:nowrap;';

            // ツールバーラベル
            const label = document.createElement('span');
            label.style.cssText = 'color:var(--svg-toolbar-fg); font-size:10px; font-weight:bold; margin:0 4px; width:48px;';
            label.textContent = index === 0 ? (t('svgEditor.animTransform.label') || '変形アニメ:') : '';
            row.appendChild(label);

            // 種類 (Type)
            const typeSelect = document.createElement('select');
            typeSelect.style.width = '75px';
            typeSelect.innerHTML = `
                <option value="none">${t('svgEditor.animTransform.none') || 'なし'}</option>
                <option value="spin">${t('svgEditor.animTransform.spin') || 'スピン(回転)'}</option>
                <option value="swing">${t('svgEditor.animTransform.swing') || 'スイング(往復)'}</option>
                <option value="bounce">${t('svgEditor.animTransform.bounce') || 'バウンド(上下)'}</option>
                <option value="pulse">${t('svgEditor.animTransform.pulse') || 'パルス(拡縮)'}</option>
                <option value="shake">シェイク(左右揺れ)</option>
                <option value="float">フロート(ふわふわ)</option>
                <option value="flip">フリップ(裏返し)</option>
                <option value="jelly">ゼリー</option>
            `;
            typeSelect.value = anim.type;
            
            // 変化量 (Amount)
            const amountWrap = document.createElement('div');
            amountWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
            amountWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;" title="${t('svgEditor.animTransform.amountTitle') || '変化量（角度、高さ、スケール）'}">${t('svgEditor.animTransform.amount') || '量:'}</span>`;
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.style.width = '45px';
            amountInput.style.textAlign = 'right';
            amountInput.value = anim.amount;
            amountWrap.appendChild(amountInput);

            // 再生時間 (Duration)
            const durWrap = document.createElement('div');
            durWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
            durWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${t('svgEditor.animTransform.seconds') || '秒:'}</span>`;
            const durInput = document.createElement('input');
            durInput.type = 'number';
            durInput.style.width = '40px';
            durInput.style.textAlign = 'right';
            durInput.value = anim.dur;
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
            easeSelect.value = anim.easing || 'ease-in-out';

            // 回数 (Repeat)
            const repeatWrap = document.createElement('div');
            repeatWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
            repeatWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${t('svgEditor.animTransform.repeatLabel') || '回数:'}</span>`;
            const repeatSelect = document.createElement('select');
            repeatSelect.style.width = '55px';
            repeatSelect.innerHTML = `
                <option value="infinite">${t('svgEditor.animTransform.repeatInfinite') || '無限'}</option>
                <option value="1">${t('svgEditor.animTransform.repeat1') || '1回'}</option>
                <option value="2">${t('svgEditor.animTransform.repeat2') || '2回'}</option>
                <option value="3">${t('svgEditor.animTransform.repeat3') || '3回'}</option>
            `;
            repeatSelect.value = anim.repeat || 'infinite';
            repeatWrap.appendChild(repeatSelect);

            // 開始 (Trigger)
            const triggerWrap = document.createElement('div');
            triggerWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
            triggerWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${t('svgEditor.animTransform.triggerLabel') || '開始:'}</span>`;
            const triggerSelect = document.createElement('select');
            triggerSelect.style.width = '80px';
            triggerSelect.innerHTML = `
                <option value="auto">${t('svgEditor.animTransform.triggerAuto') || '初めから'}</option>
                <option value="click">${t('svgEditor.animTransform.triggerClick') || 'クリック時'}</option>
            `;
            triggerSelect.value = anim.trigger || 'auto';
            triggerWrap.appendChild(triggerSelect);

            typeSelect.addEventListener('change', () => {
                if (typeSelect.value !== 'none' && !amountInput.value) {
                    amountInput.value = this.getDefaultAmountForType(typeSelect.value);
                }
                if (typeSelect.value !== 'none' && !durInput.value) {
                    durInput.value = '1.2';
                }
                this.handleUIChange();
            });

            amountInput.addEventListener('change', () => this.handleUIChange());
            amountInput.addEventListener('keydown', (e) => e.stopPropagation());
            durInput.addEventListener('change', () => this.handleUIChange());
            durInput.addEventListener('keydown', (e) => e.stopPropagation());
            easeSelect.addEventListener('change', () => this.handleUIChange());
            repeatSelect.addEventListener('change', () => this.handleUIChange());
            triggerSelect.addEventListener('change', () => this.handleUIChange());

            row.appendChild(typeSelect);
            row.appendChild(this.createSeparator());
            row.appendChild(amountWrap);
            row.appendChild(durWrap);
            row.appendChild(easeSelect);
            row.appendChild(repeatWrap);
            row.appendChild(triggerWrap);

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

            // 追加ボタン (最後の行で、4種類未満なら表示)
            if (index === this.animations.length - 1 && this.animations.length < 4) {
                const addBtn = document.createElement('button');
                addBtn.innerHTML = '＋';
                addBtn.title = t('svgEditor.animTransform.addTitle') || 'アニメーションを追加';
                addBtn.style.cssText = 'background:transparent; border:none; color:#4CAF50; cursor:pointer; font-weight:bold; margin-left:4px; padding:0 4px;';
                addBtn.onclick = () => {
                    this.animations.push({ type: 'none', amount: '', dur: '', easing: 'ease-in-out', repeat: 'infinite', trigger: 'auto' });
                    this.renderContents();
                };
                row.appendChild(addBtn);
            }

            contentArea.appendChild(row);

            this.rowInputs.push({
                type: typeSelect,
                amount: amountInput,
                dur: durInput,
                easing: easeSelect,
                repeat: repeatSelect,
                trigger: triggerSelect
            });
        });
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    /**
     * UI変更イベントを検知し、アニメーションパラメータを適用する
     */
    handleUIChange() {
        // UIから有効な設定を収集
        const validAnimations = [];
        const seenTypes = new Set();

        this.rowInputs.forEach(inputs => {
            const type = inputs.type.value;
            const amount = parseFloat(inputs.amount.value);
            const dur = parseFloat(inputs.dur.value);
            const easing = inputs.easing.value;
            const repeat = inputs.repeat.value;
            const trigger = inputs.trigger.value;

            if (type !== 'none' && !isNaN(amount) && !isNaN(dur) && dur > 0 && !seenTypes.has(type)) {
                validAnimations.push({ type, amount, dur, easing, repeat, trigger });
                seenTypes.add(type);
            }
        });

        // 現在のUI状態を保存（再描画時に復元するため）
        this.animations = this.rowInputs.map(inputs => ({
            type: inputs.type.value,
            amount: inputs.amount.value,
            dur: inputs.dur.value,
            easing: inputs.easing.value,
            repeat: inputs.repeat.value,
            trigger: inputs.trigger.value
        }));

        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.forEach(el => {
                const animData = SvgAnimationManager.getAnimationData(el);

                // UIに存在しない（または重複排除された）古いアニメーションを削除
                ['spin', 'swing', 'bounce', 'pulse', 'shake', 'float', 'flip', 'jelly'].forEach(t => {
                    if (animData[t] && !seenTypes.has(t)) {
                        SvgAnimationManager.removeAnimation(el, t);
                    }
                });

                // UIで指定されたアニメーションを適用
                validAnimations.forEach(anim => {
                    const currentTiming = animData[anim.type] || {};
                    SvgAnimationManager.applyCssAnimation(el, {
                        type: anim.type,
                        amount: anim.amount,
                        dur: anim.dur,
                        easing: anim.easing,
                        repeat: anim.repeat,
                        trigger: anim.trigger,
                        delay: currentTiming.delay || 0,
                        originX: currentTiming.originX,
                        originY: currentTiming.originY
                    });
                });

                if (window.selectElement) window.selectElement(el, true);
            });

            if (window.animationTimingToolbar && typeof window.animationTimingToolbar.updateValuesFromSelected === 'function') {
                window.animationTimingToolbar.updateValuesFromSelected();
            }
        }
    }

    /**
     * 選択要素から現在の設定を復元してUIを更新する
     */
    updateValuesFromSelected() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        const selectedElements = Array.from(window.currentEditingSVG.selectedElements);
        if (selectedElements.length === 0) return;

        // 最初の要素のアニメーションを取得してUIを更新する
        const firstEl = selectedElements[0];
        const animData = SvgAnimationManager.getAnimationData(firstEl);

        const appliedTypes = ['spin', 'swing', 'bounce', 'pulse', 'shake', 'float', 'flip', 'jelly'].filter(t => animData[t]);
        
        this.animations = [];
        if (appliedTypes.length > 0) {
            appliedTypes.forEach(t => {
                const data = animData[t];
                this.animations.push({
                    type: data.type,
                    amount: data.amount,
                    dur: data.dur,
                    easing: data.easing,
                    repeat: data.repeat || 'infinite',
                    trigger: data.trigger || 'auto'
                });
            });
        } else {
            this.animations = [{ type: 'none', amount: '', dur: '', easing: 'ease-in-out', repeat: 'infinite', trigger: 'auto' }];
        }

        this.renderContents();
    }

    getDefaultAmountForType(type) {
        switch (type) {
            case 'spin': return 360;
            case 'swing': return 30;
            case 'bounce': return 8;
            case 'pulse': return 1.2;
            case 'shake': return 10;
            case 'float': return 15;
            case 'flip': return 180;
            case 'jelly': return 1.2;
            default: return 0;
        }
    }

    destroy() {
        if (this.toolbarElement) this.toolbarElement.remove();
    }
}

// グローバルファクトリ
window.createAnimationTransformToolbar = (container, options) => {
    return new SVGAnimationTransformToolbar(container, options);
};
