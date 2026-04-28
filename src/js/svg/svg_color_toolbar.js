/**
 * SVG Color Toolbar
 * 枠・ラインの色、塗りの色、不透明度を設定するツールバー
 */
class SVGColorToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-color-toolbar',
            container: container,
            borderColor: options.borderColor || '#A8E74B',
            position: options.position || { top: '140px', left: '-37px' }
        });
        this.svgToolbar = svgToolbar;
        this.lineColorPicker = null;
        this.fillColorPicker = null;

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

        this.toolbarElement.classList.add('svg-color-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';
        contentArea.style.flexDirection = 'column';
        contentArea.style.alignItems = 'stretch';
        contentArea.style.gap = '2px';

        const mainRow = document.createElement('div');
        mainRow.style.cssText = `display: flex; align-items: center; gap: 4px; padding-right: 2px;`;

        // ラインカラーツール
        const { container: lineTrigger, anchor: lineAnchor } = this.createColorTrigger('ライン色', 'stroke');
        mainRow.appendChild(lineTrigger);
        this.lineColorPicker = this.initPicker('stroke', lineAnchor, lineTrigger, '#000000');

        // 塗りカラーツール
        const { container: fillTrigger, anchor: fillAnchor } = this.createColorTrigger('塗り色', 'fill');
        mainRow.appendChild(fillTrigger);
        this.fillColorPicker = this.initPicker('fill', fillAnchor, fillTrigger, 'transparent');

        // 区切り線
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        mainRow.appendChild(sep);

        // 不透明度
        const opacityLabel = document.createElement('span');
        opacityLabel.textContent = '不透明';
        opacityLabel.style.cssText = `font-size: 9px; color: var(--svg-toolbar-fg); opacity: 0.6; margin: 0 2px 0 2px; white-space: nowrap;`;
        mainRow.appendChild(opacityLabel);

        this.opacityInput = document.createElement('input');
        this.opacityInput.type = 'number';
        this.opacityInput.title = '不透明度 (%)';
        this.opacityInput.min = '1';
        this.opacityInput.max = '100';
        this.opacityInput.step = '1';
        this.opacityInput.style.cssText = `width: 45px; height: 20px; font-size: 10px; padding: 0 2px;`;
        this.opacityInput.onchange = () => this.applyOpacity(parseFloat(this.opacityInput.value) / 100);
        mainRow.appendChild(this.opacityInput);

        contentArea.appendChild(mainRow);

        // Disable drag propagation from inputs avoiding layout issues
        [this.opacityInput].forEach(el => {
            el.addEventListener('mousedown', e => e.stopPropagation());
            el.addEventListener('keydown', e => e.stopPropagation());
        });
    }

    createColorTrigger(title, type) {
        const container = document.createElement('div');
        container.title = title;
        container.className = `shape-color-trigger-${type}`;
        container.style.cssText = `width: 20px; height: 20px; padding: 0; border: 1px solid var(--svg-toolbar-input-border); background: var(--svg-toolbar-input-bg); border-radius: 3px; cursor: pointer; position: relative; flex-shrink: 0; margin: 0 1px; box-sizing: border-box; display: inline-block; vertical-align: middle;`;

        const bg = document.createElement('div');
        bg.className = 'color-preview-bg';
        bg.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; border-radius: 2px; box-sizing: border-box;`;
        if (type === 'stroke') {
            bg.style.border = '2px solid #000000';
            bg.style.background = 'transparent';
        } else {
            bg.style.background = 'transparent';
        }
        container.appendChild(bg);

        const anchor = document.createElement('div');
        anchor.className = 'picker-anchor';
        container.appendChild(anchor);

        container.dataset.currentColor = 'none';
        return { container, anchor };
    }

    initPicker(type, anchor, trigger, defaultColor) {
        if (typeof ColorPickerUI === 'undefined') return null;
        const picker = new ColorPickerUI({
            color: defaultColor || 'rgba(0,0,0,0)',
            isPopup: true,
            layout: 'horizontal',
            onChange: (color) => {
                let colorStr = color;
                if (typeof color.toHexString === 'function') {
                    colorStr = color.toHexString(true);
                } else if (color === 'none') {
                    colorStr = 'none';
                } else if (color === 'transparent') {
                    colorStr = 'transparent';
                }
                trigger.dataset.currentColor = colorStr;
                this.applyColor(type, colorStr);
            }
        });

        picker.options.trigger = trigger;

        trigger.onmousedown = (e) => e.stopPropagation();
        trigger.onclick = (e) => {
            e.stopPropagation();
            picker.show(trigger);
        };

        return picker;
    }

    applyColor(type, value) {
        const picker = type === 'fill' ? this.fillColorPicker : this.lineColorPicker;
        this.updatePickerUI(picker, value, type);

        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const elements = window.currentEditingSVG.selectedElements;
        if (elements.size === 0) return;

        elements.forEach(el => {
            if (el.type === 'text') return;

            const applyToNode = (target) => {
                if (typeof target.css === 'function') {
                    target.css(type, value);
                } else if (typeof target[type] === 'function') {
                    if (type === 'stroke') target.stroke({ color: value });
                    else target.fill(value);
                }
                if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                    window.SVGToolbar.updateArrowMarkers(target);
                }
            };

            if (el.type === 'g') {
                el.children().forEach(child => {
                    if (child.type !== 'text' && !child.hasClass('svg-interaction-hitarea') && !child.hasClass('svg-select-handle')) {
                        applyToNode(child);
                    }
                });
            } else {
                applyToNode(el);
            }
        });

        if (typeof window.currentEditingSVG.pushUndoState === 'function') window.currentEditingSVG.pushUndoState();
        if (typeof window.syncChanges === 'function') window.syncChanges();
    }

    updatePickerUI(picker, value, type) {
        if (!picker || !picker.options || !picker.options.trigger) return;
        const trigger = picker.options.trigger;
        const bgEl = trigger.querySelector('.color-preview-bg');

        if (value === 'none' || value === 'transparent' || !value) {
            if (type === 'stroke') {
                if (bgEl) bgEl.style.border = '2px solid transparent';
            } else {
                if (bgEl) bgEl.style.background = 'transparent';
                if (bgEl) bgEl.style.border = '1px solid var(--svg-toolbar-border)';
            }
        } else {
            if (type === 'stroke') {
                if (bgEl) bgEl.style.border = `2px solid ${value}`;
            } else {
                if (bgEl) bgEl.style.background = value;
                if (bgEl) bgEl.style.border = 'none';
            }
        }
        trigger.dataset.currentColor = value;

        if (picker.color && typeof picker.color.parse === 'function') {
            const parseVal = (!value || value === 'none' || value === 'transparent') ? 'rgba(0,0,0,0)' : value;
            picker.color.parse(parseVal);
            if (typeof picker.updateView === 'function') picker.updateView(true);
        }
    }

    applyOpacity(value) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        selected.forEach(el => {
            if (el.type === 'g') {
                el.children().forEach(child => {
                    if (child.type !== 'text' && !child.hasClass('svg-interaction-hitarea') && !child.hasClass('svg-select-handle')) {
                        child.css('opacity', value);
                    }
                });
            } else if (el.type !== 'text') {
                el.css('opacity', value);
            }
        });

        if (typeof window.currentEditingSVG.pushUndoState === 'function') window.currentEditingSVG.pushUndoState();
        if (typeof window.syncChanges === 'function') window.syncChanges();
    }

    updateFromSelection() {
        console.log('[SVGColorToolbar] updateFromSelection start');
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        const first = selected[0];
        let target = first;
        console.log('[SVGColorToolbar] selected item:', target.type);
        if (first.type === 'g') {
            let found = null;
            const children = first.children();
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea')) { found = c; break; }
            }
            target = found || first;
        }

        // Sync Opacity
        let opacity = target.css('opacity') || target.attr('opacity') || 1;
        opacity = parseFloat(opacity) || 1;
        if (this.opacityInput) {
            this.opacityInput.value = Math.round(opacity * 100);
        }

        // Sync colors
        let strokeColor = target.css('stroke') || target.attr('stroke');
        if (typeof strokeColor === 'object') strokeColor = strokeColor.color || 'none';
        if (!strokeColor) strokeColor = 'none';
        console.log('[SVGColorToolbar] apply strokeColor to picker:', strokeColor);
        if (this.lineColorPicker) this.updatePickerUI(this.lineColorPicker, strokeColor, 'stroke');

        let fillColor = target.css('fill') || target.attr('fill');
        if (typeof fillColor === 'object') fillColor = fillColor.color || 'none';
        if (!fillColor) fillColor = 'none';
        console.log('[SVGColorToolbar] apply fillColor to picker:', fillColor);
        if (this.fillColorPicker) this.updatePickerUI(this.fillColorPicker, fillColor, 'fill');
    }

    show() { if (this.toolbarElement) this.toolbarElement.style.display = 'flex'; }
    hide() { /* Always visible */ }

    addGlobalClickClose() {
        this._globalClick = (e) => {
        };
        document.addEventListener('click', this._globalClick);
    }

    destroy() {
        if (this._globalClick) document.removeEventListener('click', this._globalClick);
        if (this.lineColorPicker && this.lineColorPicker.destroyAndRemove) this.lineColorPicker.destroyAndRemove();
        if (this.fillColorPicker && this.fillColorPicker.destroyAndRemove) this.fillColorPicker.destroyAndRemove();
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createColorToolbar = (container, svgToolbar, options) => {
    return new SVGColorToolbar(container, svgToolbar, options);
};
