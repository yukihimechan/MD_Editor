/**
 * SVG Line Toolbar
 * 選択中の図形の線のプロパティ（太さ、線種、端点、角、透明度）を調整するツールバー
 */
class SVGLineToolbar extends SVGToolbarBase {
    constructor(container, draw, options = {}) {
        super({
            id: options.id || 'svg-line-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '250px', left: '10px' }
        });
        this.draw = draw;

        this.dashOptions = [
            { name: '実線', value: 'none' },
            { name: '点線', value: '1 2' },
            { name: '破線', value: '6 3' },
            { name: '一点鎖線', value: '8 3 1 3' },
            { name: '二点鎖線', value: '8 3 1 3 1 3' },
            { name: 'カスタム...', value: 'custom' }
        ];

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
        this.toolbarElement.classList.add('svg-line-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        // 線の太さ
        this.widthInput = document.createElement('input');
        this.widthInput.type = 'number';
        this.widthInput.title = '線の太さ';
        this.widthInput.min = '0';
        this.widthInput.step = '0.5';
        this.widthInput.style.width = '45px';
        this.widthInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { this.widthInput.blur(); e.preventDefault(); }
        });
        this.widthInput.addEventListener('change', () => {
            let val = parseFloat(this.widthInput.value);
            if (isNaN(val) || val < 0.01) val = 0.01;
            if (val > 100) val = 100;
            this.widthInput.value = val;
            this.updateWidthInputStep();
            this.applyProperty('stroke-width', val);
        });
        contentArea.appendChild(this.widthInput);

        contentArea.appendChild(this.createSeparator());

        // 線の種類
        const dashContainer = document.createElement('div');
        dashContainer.style.cssText = `display: flex; align-items: center; gap: 2px;`;

        this.dashSelect = document.createElement('select');
        this.dashSelect.title = '線の種類';
        this.dashSelect.style.width = '60px';
        this.dashOptions.forEach(optData => {
            const opt = document.createElement('option');
            opt.value = optData.value;
            opt.textContent = optData.name;
            this.dashSelect.appendChild(opt);
        });

        this.editDashBtn = document.createElement('button');
        this.editDashBtn.innerHTML = '✎';
        this.editDashBtn.title = 'カスタム点線を編集';
        this.editDashBtn.style.cssText = `font-size: 12px; width: 20px; padding: 0; display: none;`;
        this.editDashBtn.onclick = (e) => {
            e.stopPropagation();
            this.showCustomDashDialog();
        };

        this.dashSelect.onchange = () => {
            this.updateEditBtnVisibility();
            if (this.dashSelect.value === 'custom') {
                this.showCustomDashDialog();
            } else {
                this.applyProperty('stroke-dasharray', this.dashSelect.value);
            }
        };
        // 連打対応（ドロップダウンでの再選択時のみに限定）
        let prevDash = '';
        this.dashSelect.addEventListener('mousedown', () => prevDash = this.dashSelect.value);
        // 不要なclickリスナー（すでにカスタムの場合に開く）を削除：
        // ユーザーが他のオプションを選びたい場合にブロッキングしてしまうため

        dashContainer.appendChild(this.dashSelect);
        dashContainer.appendChild(this.editDashBtn);
        contentArea.appendChild(dashContainer);

        contentArea.appendChild(this.createSeparator());

        // 線端 (Cap)
        this.capButtons = {};
        const capContainer = document.createElement('div');
        capContainer.style.cssText = `display: flex; gap: 2px;`;

        const caps = [
            {
                id: 'butt', title: '端点: butt', icon: `
                <line x1="18" y1="4" x2="18" y2="20" stroke="var(--svg-toolbar-sep)" stroke-width="1.5"/>
                <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="6" stroke-linecap="butt"/>`
            },
            {
                id: 'round', title: '端点: round', icon: `
                <line x1="18" y1="4" x2="18" y2="20" stroke="var(--svg-toolbar-sep)" stroke-width="1.5"/>
                <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>`
            },
            {
                id: 'square', title: '端点: square', icon: `
                <line x1="18" y1="4" x2="18" y2="20" stroke="var(--svg-toolbar-sep)" stroke-width="1.5"/>
                <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="6" stroke-linecap="square"/>`
            }
        ];
        caps.forEach(c => {
            const btn = this.createIconBtn(c.title, c.icon, () => this.applyProperty('stroke-linecap', c.id));
            this.capButtons[c.id] = btn;
            capContainer.appendChild(btn);
        });
        contentArea.appendChild(capContainer);

        contentArea.appendChild(this.createSeparator());

        // 角 (Join)
        this.joinButtons = {};
        const joinContainer = document.createElement('div');
        joinContainer.style.cssText = `display: flex; gap: 2px;`;
        const joins = [
            { id: 'miter', title: '角: miter', icon: `<path d="M4 18 L12 6 L20 18" stroke="currentColor" stroke-width="5" stroke-linejoin="miter" fill="none"/>` },
            { id: 'round', title: '角: round', icon: `<path d="M4 18 L12 6 L20 18" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>` },
            { id: 'bevel', title: '角: bevel', icon: `<path d="M4 18 L12 6 L20 18" stroke="currentColor" stroke-width="5" stroke-linejoin="bevel" fill="none"/>` }
        ];
        joins.forEach(j => {
            const btn = this.createIconBtn(j.title, j.icon, () => this.applyProperty('stroke-linejoin', j.id));
            this.joinButtons[j.id] = btn;
            joinContainer.appendChild(btn);
        });
        contentArea.appendChild(joinContainer);
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    createIconBtn(title, iconHtml, onClick) {
        const btn = document.createElement('button');
        btn.title = title;
        btn.innerHTML = `<svg width="22" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${iconHtml}</svg>`;
        btn.onclick = (e) => { e.stopPropagation(); onClick(); };
        return btn;
    }

    updateWidthInputStep() {
        if (!this.widthInput) return;
        const val = parseFloat(this.widthInput.value) || 0;
        if (val >= 20) this.widthInput.step = '5';
        else if (val >= 5) this.widthInput.step = '1';
        else if (val >= 1) this.widthInput.step = '0.5';
        else if (val >= 0.1) this.widthInput.step = '0.1';
        else this.widthInput.step = '0.01';
    }

    updateEditBtnVisibility() {
        if (this.editDashBtn && this.dashSelect) {
            this.editDashBtn.style.display = this.dashSelect.value === 'custom' ? 'flex' : 'none';
        }
    }

    applyProperty(prop, value) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        selected.forEach(el => {
            console.log(`[LineToolbar] Applying property '${prop}'='${value}' to: ${el.type} (${el.id()})`);
            if (el.type === 'g') {
                el.children().forEach(child => {
                    if (child.type !== 'text' && !child.hasClass('svg-interaction-hitarea') && !child.hasClass('svg-select-handle')) {
                        child.css(prop, value);
                    }
                });
            } else if (el.type !== 'text') {
                el.css(prop, value);
            }
            console.log(`[LineToolbar] Applied property to: ${el.id()}. New CSS value: ${el.css(prop)}`);

            // マーカー更新
            if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                if (el.type === 'g') {
                    el.children().forEach(child => {
                        if (child.type !== 'text' && !child.hasClass('svg-interaction-hitarea')) {
                            window.SVGToolbar.updateArrowMarkers(child);
                        }
                    });
                } else {
                    window.SVGToolbar.updateArrowMarkers(el);
                }
            }
        });

        this.updateUI();
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    updateUI() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        const first = selected[0];
        let target = first;
        if (first.type === 'g') {
            let found = null;
            const children = first.children();
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea')) { found = c; break; }
            }
            target = found || first;
        }

        console.log(`[SVGLineToolbar] ----- updateUI called (Target: ${target.type}, ID: ${target.id()}) -----`);

        // CSSクラスやインラインスタイルによる指定を漏れなく取得するための関数
        const getEffectiveProp = (propName) => {
            if (!target || !target.node) return null;
            let val = target.node.style.getPropertyValue(propName);
            let source = 'inline style (.style)';

            if (!val) {
                val = target.node.getAttribute(propName);
                source = 'SVG attribute (.attr)';
            }
            if (!val) {
                const computed = window.getComputedStyle(target.node);
                val = computed.getPropertyValue(propName);
                source = 'computed style';
            }
            console.log(`[SVGLineToolbar] EffectiveProp [${propName}]: "${val}" (Source: ${source})`);
            return val;
        };

        if (this.widthInput) {
            const width = getEffectiveProp('stroke-width') || '1';
            this.widthInput.value = parseFloat(width) || 1;
            this.updateWidthInputStep();
        }

        if (this.dashSelect) {
            let dash = getEffectiveProp('stroke-dasharray') || 'none';
            if (dash !== 'none') {
                // ピクセル単位やカンマをスペース区切りに正規化 (例: "1px, 2px" -> "1 2")
                dash = dash.replace(/px/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
            }

            const knownDash = this.dashOptions.find(o => o.value === dash);
            if (knownDash) {
                this.dashSelect.value = dash;
            } else {
                this.dashSelect.value = 'custom';
                this.dashSelect.dataset.customValue = dash;
            }
            this.updateEditBtnVisibility();
        }

        const cap = getEffectiveProp('stroke-linecap') || 'butt';
        if (this.capButtons) {
            Object.keys(this.capButtons).forEach(k => {
                this.capButtons[k].classList.toggle('active', k === cap);
            });
        }

        const join = getEffectiveProp('stroke-linejoin') || 'miter';
        if (this.joinButtons) {
            Object.keys(this.joinButtons).forEach(k => {
                this.joinButtons[k].classList.toggle('active', k === join);
            });
        }
    }

    showCustomDashDialog() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        const first = selected[0];
        let target = first;
        if (first.type === 'g') {
            let found = null;
            const children = first.children();
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea')) { found = c; break; }
            }
            target = found || first;
        }

        const overlay = document.createElement('div');
        overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 11000; display: flex; align-items: center; justify-content: center; pointer-events: auto !important;`;

        const dialog = document.createElement('div');
        dialog.className = 'svg-toolbar is-active';
        dialog.style.cssText = `padding: 20px; border-radius: 8px; width: 440px; flex-direction: column; font-family: sans-serif; user-select: none; position: relative; opacity: 1 !important; pointer-events: auto !important; z-index: 11001 !important; display: flex !important;`;
        dialog.innerHTML = `<h3 style="margin-top:0; color:var(--svg-toolbar-fg)">カスタム点線の作成</h3>`;

        const resInput = document.createElement('input');
        resInput.type = 'number'; resInput.min = '4'; resInput.max = '128'; resInput.value = '24'; resInput.style.width = '50px';

        const settingsArea = document.createElement('div');
        settingsArea.style.cssText = `display: flex; align-items: center; gap: 10px; margin-bottom: 15px; font-size: 12px;`;

        const resLabel = document.createElement('label');
        resLabel.textContent = '解像度:';
        settingsArea.appendChild(resLabel);
        settingsArea.appendChild(resInput);

        const helpText = document.createElement('span');
        helpText.textContent = '(クリックまたはドラッグで描画)';
        helpText.style.color = '#888';
        settingsArea.appendChild(helpText);

        resInput.oninput = () => {
            let val = parseInt(resInput.value) || 24;
            if (val < 4) val = 4;
            if (val > 128) val = 128;
            rebuildGrid(val);
        };
        dialog.appendChild(settingsArea);

        const previewArea = document.createElement('div');
        previewArea.style.cssText = `height: 40px; background: #222; border: 1px solid #444; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; overflow: hidden;`;
        const previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        previewSvg.setAttribute('width', '400'); previewSvg.setAttribute('height', '40');
        const previewLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        previewLine.setAttribute('x1', '10'); previewLine.setAttribute('y1', '20'); previewLine.setAttribute('x2', '390'); previewLine.setAttribute('y2', '20');
        previewLine.setAttribute('stroke', 'var(--svg-toolbar-fg)'); previewLine.setAttribute('stroke-width', '4');
        previewSvg.appendChild(previewLine);
        previewArea.appendChild(previewSvg);
        dialog.appendChild(previewArea);

        const gridWrapper = document.createElement('div');
        gridWrapper.style.cssText = `display: flex; gap: 5px; margin-bottom: 15px; position: relative;`;
        const gridContainer = document.createElement('div');
        gridContainer.style.cssText = `max-height: 150px; overflow-y: auto; padding-right: 5px; background: rgba(0,0,0,0.1); border-radius: 4px; flex: 1;`;
        const grid = document.createElement('div');
        grid.style.cssText = `display: flex; gap: 2px; flex-wrap: wrap;`;
        gridContainer.appendChild(grid);
        gridWrapper.appendChild(gridContainer);

        const resizeHandle = document.createElement('div');
        resizeHandle.title = 'ドラッグして解像度を変更';
        resizeHandle.style.cssText = `width: 14px; height: 14px; cursor: ew-resize; background: #555; border: 1px dashed #888; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`;
        resizeHandle.innerHTML = '<span style="color:#aaa; font-size:10px;">↔</span>';

        let isResizing = false;
        let startX = 0;
        let startRes = 24;
        resizeHandle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            startX = e.clientX;
            startRes = parseInt(resInput.value) || 24;
        };
        const onResizeMove = (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            let newRes = startRes + Math.floor(dx / 10);
            if (newRes < 4) newRes = 4;
            if (newRes > 128) newRes = 128;
            if (newRes !== parseInt(resInput.value)) {
                resInput.value = newRes;
                rebuildGrid(newRes);
            }
        };
        const onResizeUp = () => isResizing = false;
        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('mouseup', onResizeUp);

        dialog.appendChild(gridWrapper);

        let bits = [];
        let isDrawing = false;
        let paintState = false;

        const parseDashToBits = (str, res) => {
            if (!str || str === 'none') return { bits: new Array(res).fill(false), length: 0 };
            if (str === 'custom') str = this.dashSelect.dataset.customValue || '';
            const parts = str.trim().split(/[\s,]+/).map(p => Math.abs(parseFloat(p)));
            const normalizedParts = parts.length % 2 !== 0 ? [...parts, ...parts] : parts;
            const resBits = [];
            let drawing = true;
            normalizedParts.forEach(len => {
                for (let i = 0; i < Math.round(len); i++) { if (resBits.length < 1024) resBits.push(drawing); }
                drawing = !drawing;
            });
            const finalCount = res || resBits.length || 24;
            const finalBits = new Array(finalCount).fill(false);
            for (let i = 0; i < Math.min(finalCount, resBits.length); i++) finalBits[i] = resBits[i];
            return { bits: finalBits, length: resBits.length };
        };

        const updateFromGrid = () => {
            const pattern = [];
            let current = bits[0]; let count = 0;
            bits.forEach(b => {
                if (b === current) count++;
                else { pattern.push(count); current = b; count = 1; }
            });
            pattern.push(count);
            if (bits[0] === false) pattern.unshift(0);
            const dashStr = pattern.join(' ');
            textInput.value = dashStr;
            previewLine.setAttribute('stroke-dasharray', dashStr);
        };

        const rebuildGrid = (count) => {
            const old = bits;
            bits = new Array(count).fill(false);
            for (let i = 0; i < Math.min(count, old.length); i++) bits[i] = old[i];
            grid.innerHTML = '';
            for (let i = 0; i < count; i++) {
                const cell = document.createElement('div');
                cell.style.cssText = `width: 14px; height: 14px; border: 1px solid var(--svg-toolbar-border); cursor: crosshair; background: ${bits[i] ? 'var(--svg-toolbar-btn-active-bg)' : 'var(--svg-toolbar-input-bg)'}; flex-shrink: 0;`;
                cell.onmousedown = (e) => { if (e.button !== 0) return; isDrawing = true; paintState = !bits[i]; bits[i] = paintState; cell.style.background = paintState ? 'var(--svg-toolbar-btn-active-bg)' : 'var(--svg-toolbar-input-bg)'; updateFromGrid(); };
                cell.onmouseenter = () => { if (isDrawing) { bits[i] = paintState; cell.style.background = paintState ? 'var(--svg-toolbar-btn-active-bg)' : 'var(--svg-toolbar-input-bg)'; updateFromGrid(); } };
                grid.appendChild(cell);
            }
            grid.appendChild(resizeHandle);
            updateFromGrid();
        };

        const textInput = document.createElement('input');
        textInput.type = 'text'; textInput.style.cssText = `width:100%; height:24px; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:0 5px; margin-bottom:15px; box-sizing:border-box;`;
        textInput.oninput = () => previewLine.setAttribute('stroke-dasharray', textInput.value);
        dialog.appendChild(textInput);

        const actions = document.createElement('div');
        actions.style.cssText = `display: flex; justify-content: flex-end; gap: 10px;`;
        const cancelBtn = document.createElement('button'); cancelBtn.textContent = "キャンセル";
        cancelBtn.style.cssText = `padding: 5px 10px; background: #444; color: #fff; border: none; border-radius: 4px; cursor: pointer;`;
        cancelBtn.onclick = () => { overlay.remove(); this.updateUI(); };
        const saveBtn = document.createElement('button'); saveBtn.textContent = "保存"; saveBtn.className = 'active'; saveBtn.style.padding = '5px 15px';
        saveBtn.onclick = () => { this.dashSelect.dataset.customValue = textInput.value; this.applyProperty('stroke-dasharray', textInput.value); overlay.remove(); };
        actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
        dialog.appendChild(actions);

        overlay.appendChild(dialog); document.body.appendChild(overlay);

        const currentDash = target.attr('stroke-dasharray') || this.dashSelect.dataset.customValue || '';
        const { bits: parsed, length: pLen } = parseDashToBits(currentDash, 512);
        const initRes = pLen > 0 ? pLen : 24;
        resInput.value = initRes;
        bits = parseDashToBits(currentDash, initRes).bits;
        rebuildGrid(initRes);

        const onUp = () => isDrawing = false;
        window.addEventListener('mouseup', onUp);
        // Clean up on remove
        const origRemove = overlay.remove.bind(overlay);
        overlay.remove = () => {
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('mousemove', onResizeMove);
            window.removeEventListener('mouseup', onResizeUp);
            origRemove();
        };
    }

    show() { if (this.toolbarElement) { this.toolbarElement.style.display = 'flex'; this.updateUI(); } }
    hide() { /* Line toolbar stays visible */ }
    updateFromSelection() { this.updateUI(); }
    destroy() { if (this.toolbarElement) this.toolbarElement.remove(); }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createLineToolbar = (container, draw, options) => {
    return new SVGLineToolbar(container, draw, options);
};
