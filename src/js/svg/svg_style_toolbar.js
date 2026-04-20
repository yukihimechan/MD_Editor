/**
 * SVG Style Toolbar
 * Provides a UI for quickly applying predefined fill and stroke colors to selected SVG elements.
 */
class SVGStyleToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-style-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '110px', left: '20px' }
        });
        this.svgToolbar = svgToolbar;
        this.currentPaletteIndex = 0;
        this.isPaletteListOpen = false;

        this.palettes = [
            {
                name: "パレット1",
                colors: [
                    { fill: '#fdeff2', stroke: '#f6bfbc', strokeWidth: 1 },
                    { fill: '#e6cde3', stroke: '#4f455c', strokeWidth: 1 },
                    { fill: '#eebbcb', stroke: '#e7609e', strokeWidth: 1 },
                    { fill: '#f7bd8f', stroke: '#eb6101', strokeWidth: 1 },
                    { fill: '#f8e58c', stroke: '#ffd900', strokeWidth: 1 },
                    { fill: '#d8e698', stroke: '#82ae46', strokeWidth: 1 },
                    { fill: '#69b076', stroke: '#316745', strokeWidth: 1 },
                    { fill: '#bbc8e6', stroke: '#17184b', strokeWidth: 1 },
                    { fill: '#dcdddd', stroke: '#7d7d7d', strokeWidth: 1 },
                    { fill: '#9acd32', stroke: '#383c3c', strokeWidth: 1 }
                ]
            },
            {
                name: "パレット2",
                colors: [
                    { fill: '#fff79980', stroke: '#fff352', strokeWidth: 1 },
                    { fill: '#fdede480', stroke: '#de82a7', strokeWidth: 1 },
                    { fill: '#bee0c280', stroke: '#00984f', strokeWidth: 1 },
                    { fill: '#00ff7f80', stroke: '#004d25', strokeWidth: 1 },
                    { fill: '#b2cbe480', stroke: '#0075c2', strokeWidth: 1 },
                    { fill: '#94adda80', stroke: '#192f60', strokeWidth: 1 },
                    { fill: '#4753a280', stroke: '#001e43', strokeWidth: 1 },
                    { fill: '#d1bada80', stroke: '#9f166a', strokeWidth: 1 },
                    { fill: '#e0b5d380', stroke: '#941f57', strokeWidth: 1 },
                    { fill: '#f5ecf480', stroke: '#7d7b83', strokeWidth: 1 }
                ]
            },
            {
                name: "パレット3",
                colors: [
                    { fill: '#E7B69599', stroke: '#E7B695', strokeWidth: 2 },
                    { fill: '#F1DC9899', stroke: '#F1DC98', strokeWidth: 2 },
                    { fill: '#CBCF6E99', stroke: '#CBCF6E', strokeWidth: 2 },
                    { fill: '#E7E9BB99', stroke: '#E7E9BB', strokeWidth: 2 },
                    { fill: '#E1D9C799', stroke: '#E1D9C7', strokeWidth: 2 },
                    { fill: '#97A68A99', stroke: '#97A68A', strokeWidth: 2 },
                    { fill: '#9B9B6999', stroke: '#9B9B69', strokeWidth: 2 },
                    { fill: '#A7D2A899', stroke: '#A7D2A8', strokeWidth: 2 },
                    { fill: '#9ECFCB99', stroke: '#9ECFCB', strokeWidth: 2 },
                    { fill: '#D9D6DE99', stroke: '#D9D6DE', strokeWidth: 2 }
                ]
            }
        ];

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

        this.toolbarElement.classList.add('svg-style-toolbar');

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
        contentArea.style.gap = '0';

        // メイン行
        const mainRow = document.createElement('div');
        mainRow.style.cssText = `display: flex; align-items: center; gap: 2px; padding-right: 2px;`;

        // 色ボタンコンテナ
        this.colorsContainer = document.createElement('div');
        this.colorsContainer.style.cssText = `display: flex; gap: 4px;`;
        mainRow.appendChild(this.colorsContainer);

        // 展開ボタン
        this.expandBtn = document.createElement('button');
        this.expandBtn.innerHTML = '▼';
        this.expandBtn.title = 'パレットエリアを展開';
        this.expandBtn.style.cssText = `
            background: transparent; border: none; color: var(--svg-toolbar-fg); cursor: pointer; padding: 0 4px;
            font-size: 10px; border-radius: 3px; margin-left: auto; height: 20px; opacity: 0.6;
        `;
        this.expandBtn.onclick = (e) => {
            e.stopPropagation();
            this.isPaletteListOpen = !this.isPaletteListOpen;
            this.updateExpandState();
        };
        mainRow.appendChild(this.expandBtn);

        contentArea.appendChild(mainRow);

        // パレットリスト
        this.paletteListContainer = document.createElement('div');
        this.paletteListContainer.style.cssText = `
            display: none; flex-direction: column; gap: 8px; margin-top: 4px; border-top: 1px solid var(--svg-toolbar-border);
            padding-top: 6px; padding-bottom: 2px; padding-left: 20px;
        `;
        contentArea.appendChild(this.paletteListContainer);

        this.refreshPaletteUI();
    }

    createColorButton(colorData) {
        const btn = document.createElement('button');
        btn.className = 'svg-color-btn';
        btn.style.cssText = `
            width: 20px; height: 20px; border-radius: 4px; padding: 0; cursor: pointer;
            background: ${colorData.fill} !important; border: ${colorData.strokeWidth}px solid ${colorData.stroke} !important;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.1); flex-shrink: 0;
        `;
        btn.title = `Fill: ${colorData.fill}\nStroke: ${colorData.stroke}`;

        btn.onclick = (e) => {
            e.stopPropagation();
            if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
                const elements = window.currentEditingSVG.selectedElements;
                if (elements.size === 0) return;

                elements.forEach(el => {
                    console.log(`[StyleToolbar] Applying style to: ${el.type} (${el.id()})`);
                    if (el.type === 'text') return;

                    // [NEW] オープンパスとクローズパスの判定関数
                    const isElementOpenPath = (node) => {
                        if (node.attr('data-poly-closed') === 'true') return false;
                        const type = node.type;
                        if (type === 'line' || type === 'polyline') return true;
                        if (type === 'path') {
                            const d = node.attr('d');
                            if (d && d.toUpperCase().endsWith('Z')) return false;
                            return true; // 閉じていないpathはオープンパス
                        }
                        return false;
                    };

                    const applyToNode = (target) => {
                        const isOpen = isElementOpenPath(target);
                        if (typeof target.css === 'function') {
                            if (isOpen) {
                                // オープンパスの場合は塗りつぶしをなし(none)にし、パレットの枠線色(stroke)を線色に適用する
                                target.css({
                                    'fill': 'none',
                                    'stroke': colorData.stroke
                                });
                            } else {
                                target.css({
                                    'fill': colorData.fill,
                                    'stroke': colorData.stroke
                                });
                            }
                            console.log(`[StyleToolbar] CSS style applied to: ${target.id()}. OpType: ${isOpen ? 'Open' : 'Closed'}`);
                        } else if (typeof target.fill === 'function' && typeof target.stroke === 'function') {
                            // フォールバック(属性ベース)
                            if (isOpen) {
                                target.fill('none');
                                target.stroke({ color: colorData.stroke });
                            } else {
                                target.fill(colorData.fill);
                                target.stroke({ color: colorData.stroke });
                            }
                        }

                        // SVGToolbarのマーカー更新が存在する場合
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
                    console.log(`[StyleToolbar] Applied style to: ${el.id()}.`);
                });

                if (typeof window.currentEditingSVG.pushUndoState === 'function') window.currentEditingSVG.pushUndoState();
                if (typeof window.syncChanges === 'function') window.syncChanges();
            }
        };
        return btn;
    }


    refreshPaletteUI() {
        if (!this.colorsContainer) return;
        this.colorsContainer.innerHTML = '';
        const currentPalette = this.palettes[this.currentPaletteIndex];
        currentPalette.colors.forEach(color => {
            this.colorsContainer.appendChild(this.createColorButton(color));
        });

        this.paletteListContainer.innerHTML = '';
        this.palettes.forEach((palette, pIndex) => {
            if (pIndex === this.currentPaletteIndex) return;

            const row = document.createElement('div');
            row.style.cssText = `display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 2px; border-radius: 3px;`;
            row.addEventListener('mouseover', () => row.style.background = 'var(--svg-toolbar-btn-hover)');
            row.addEventListener('mouseout', () => row.style.background = 'transparent');

            const label = document.createElement('span');
            label.textContent = palette.name;
            label.style.cssText = `color: var(--svg-toolbar-fg); width: 50px; font-size: 10px; user-select: none; opacity: 0.6; flex-shrink: 0;`;
            row.appendChild(label);

            const paletteColors = document.createElement('div');
            paletteColors.style.cssText = `display: flex; gap: 4px; pointer-events: none;`;
            palette.colors.forEach(color => {
                const previewBtn = document.createElement('div');
                previewBtn.className = 'svg-color-btn';
                previewBtn.style.cssText = `
                    width: 20px; height: 20px; border-radius: 4px;
                    background: ${color.fill} !important; border: ${color.strokeWidth}px solid ${color.stroke} !important;
                    box-shadow: 0 0 0 1px rgba(0,0,0,0.1); flex-shrink: 0;
                `;
                paletteColors.appendChild(previewBtn);
            });
            row.appendChild(paletteColors);

            row.onclick = (e) => {
                e.stopPropagation();
                this.currentPaletteIndex = pIndex;
                this.isPaletteListOpen = false;
                this.updateExpandState();
                this.refreshPaletteUI();
            };
            this.paletteListContainer.appendChild(row);
        });
    }

    updateExpandState() {
        if (!this.expandBtn || !this.paletteListContainer) return;
        if (this.isPaletteListOpen) {
            this.expandBtn.innerHTML = '▲';
            this.paletteListContainer.style.display = 'flex';
        } else {
            this.expandBtn.innerHTML = '▼';
            this.paletteListContainer.style.display = 'none';
        }
    }

    addGlobalClickClose() {
        this._globalClick = (e) => {
            if (this.isPaletteListOpen && this.toolbarElement && !this.toolbarElement.contains(e.target)) {
                this.isPaletteListOpen = false;
                this.updateExpandState();
            }
        };
        document.addEventListener('click', this._globalClick);
    }

    updateFromSelection() {
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
    }

    show() { if (this.toolbarElement) this.toolbarElement.style.display = 'flex'; }
    hide() { /* Always visible */ }

    destroy() {
        if (this._globalClick) document.removeEventListener('click', this._globalClick);
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        this.isPaletteListOpen = false;
        this.updateExpandState();
        super.resetPosition();
    }
}

// Global factory
window.createStyleToolbar = (container, svgToolbar, options) => {
    return new SVGStyleToolbar(container, svgToolbar, options);
};
