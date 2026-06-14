/**
 * SVG Animation Transform Toolbar
 * 変形アニメーション（スピン、スイング、バウンド、パルス）を設定するUIモジュール
 */
class SVGAnimationTransformToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-transform-toolbar',
            container: container,
            borderColor: options.borderColor || '#FF5722',
            position: options.position || { top: '20px', right: '-45px' }
        });
        this.onValueChange = options.onValueChange || (() => { });
        this.inputs = {};
        
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

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        // ツールバーラベル
        const label = document.createElement('span');
        label.style.cssText = 'color:var(--svg-toolbar-fg); font-size:10px; font-weight:bold; margin:0 4px;';
        label.textContent = '変形アニメ:';
        contentArea.appendChild(label);

        // 種類 (Type)
        const typeSelect = document.createElement('select');
        typeSelect.style.width = '75px';
        typeSelect.innerHTML = `
            <option value="none">なし</option>
            <option value="spin">スピン(回転)</option>
            <option value="swing">スイング(往復)</option>
            <option value="bounce">バウンド(上下)</option>
            <option value="pulse">パルス(拡縮)</option>
        `;
        typeSelect.addEventListener('change', () => {
            this.inputs['amount'].value = this.getDefaultAmountForType(typeSelect.value);
            this.handleUIChange();
        });
        contentArea.appendChild(typeSelect);
        this.inputs['type'] = typeSelect;

        contentArea.appendChild(this.createSeparator());

        // 変化量 (Amount)
        const amountWrap = document.createElement('div');
        amountWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        amountWrap.innerHTML = '<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;" title="変化量（角度、高さ、スケール）">量:</span>';
        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.style.width = '50px';
        amountInput.style.textAlign = 'right';
        amountInput.value = '360';
        amountInput.addEventListener('change', () => this.handleUIChange());
        amountInput.addEventListener('keydown', (e) => e.stopPropagation());
        amountWrap.appendChild(amountInput);
        contentArea.appendChild(amountWrap);
        this.inputs['amount'] = amountInput;

        // 再生時間 (Duration)
        const durWrap = document.createElement('div');
        durWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        durWrap.innerHTML = '<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">秒:</span>';
        const durInput = document.createElement('input');
        durInput.type = 'number';
        durInput.style.width = '45px';
        durInput.style.textAlign = 'right';
        durInput.value = '1.2';
        durInput.step = '0.1';
        durInput.min = '0.1';
        durInput.addEventListener('change', () => this.handleUIChange());
        durInput.addEventListener('keydown', (e) => e.stopPropagation());
        durWrap.appendChild(durInput);
        contentArea.appendChild(durWrap);
        this.inputs['dur'] = durInput;

        // イージング (Easing)
        const easeSelect = document.createElement('select');
        easeSelect.style.width = '70px';
        easeSelect.innerHTML = `
            <option value="linear">linear</option>
            <option value="ease">ease</option>
            <option value="ease-in">ease-in</option>
            <option value="ease-out">ease-out</option>
            <option value="ease-in-out" selected>ease-in-out</option>
        `;
        easeSelect.addEventListener('change', () => this.handleUIChange());
        contentArea.appendChild(easeSelect);
        this.inputs['easing'] = easeSelect;
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
        const type = this.inputs['type'].value;
        const amount = parseFloat(this.inputs['amount'].value);
        const dur = parseFloat(this.inputs['dur'].value);
        const easing = this.inputs['easing'].value;

        // バリデーション
        if (type !== 'none' && (isNaN(amount) || isNaN(dur) || dur <= 0)) return;

        // 選択された要素にアニメーションを反映する
        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.forEach(el => {
                if (type === 'none') {
                    // 解除処理（全種類の可能性をクリア）
                    ['spin', 'swing', 'bounce', 'pulse'].forEach(t => {
                        SvgAnimationManager.removeAnimation(el, t);
                    });
                    // アンラップ後に要素を再取得
                    if (window.selectElement) window.selectElement(el, true);
                    return;  // 早期リターンして二重呼び出しを防ぐ
                } else {
                    // 以前適用されていた他のアニメーションがあればクリア（種類切り替え時のため）
                    ['spin', 'swing', 'bounce', 'pulse'].forEach(t => {
                        if (t !== type) SvgAnimationManager.removeAnimation(el, t);
                    });

                    // アニメーション適用
                    const animData = SvgAnimationManager.getAnimationData(el);
                    const currentTiming = animData[type] || {};

                    SvgAnimationManager.applyCssAnimation(el, {
                        type,
                        amount,
                        dur,
                        easing,
                        delay: currentTiming.delay || 0,
                        originX: currentTiming.originX,
                        originY: currentTiming.originY
                    });
                }

                // エディタ側での選択マーカー等の再計算・表示同期
                if (window.selectElement) window.selectElement(el, true);
            });

            // メタデータ復元のため、タイミング/基点ツールバー値も同期
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

        let types = [];
        let amounts = [];
        let durs = [];
        let easings = [];

        selectedElements.forEach(el => {
            const animData = SvgAnimationManager.getAnimationData(el);
            const activeType = ['spin', 'swing', 'bounce', 'pulse'].find(t => animData[t]);
            if (activeType) {
                const data = animData[activeType];
                types.push(data.type);
                amounts.push(data.amount);
                durs.push(data.dur);
                easings.push(data.easing);
            } else {
                types.push('none');
                amounts.push(null);
                durs.push(null);
                easings.push(null);
            }
        });

        const uniqueTypes = [...new Set(types)];
        const uniqueAmounts = [...new Set(amounts.filter(v => v !== null))];
        const uniqueDurs = [...new Set(durs.filter(v => v !== null))];
        const uniqueEasings = [...new Set(easings.filter(v => v !== null))];

        let foundType = 'none';
        if (uniqueTypes.length === 1) {
            foundType = uniqueTypes[0];
        } else if (uniqueTypes.length > 1) {
            const activeType = uniqueTypes.find(t => t !== 'none');
            foundType = activeType || 'none';
        }

        // UIへの値の書き戻しとプレースホルダー設定
        this.inputs['type'].value = foundType;

        const amountInput = this.inputs['amount'];
        if (uniqueAmounts.length > 1) {
            amountInput.value = '';
            amountInput.placeholder = '複数';
        } else if (uniqueAmounts.length === 1) {
            amountInput.value = uniqueAmounts[0];
            amountInput.placeholder = '';
        } else {
            amountInput.value = this.getDefaultAmountForType(foundType);
            amountInput.placeholder = '';
        }

        const durInput = this.inputs['dur'];
        if (uniqueDurs.length > 1) {
            durInput.value = '';
            durInput.placeholder = '複数';
        } else if (uniqueDurs.length === 1) {
            durInput.value = uniqueDurs[0];
            durInput.placeholder = '';
        } else {
            durInput.value = '1.2';
            durInput.placeholder = '';
        }

        if (uniqueEasings.length === 1) {
            this.inputs['easing'].value = uniqueEasings[0];
        } else if (uniqueEasings.length > 1) {
            this.inputs['easing'].value = uniqueEasings[0];
        } else {
            this.inputs['easing'].value = 'ease-in-out';
        }
    }

    getDefaultAmountForType(type) {
        switch (type) {
            case 'spin': return 360;
            case 'swing': return 30;
            case 'bounce': return 8;
            case 'pulse': return 1.2;
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
