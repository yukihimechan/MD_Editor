/**
 * SVG Text Alignment Toolbar
 * 図形内のテキストの配置（左・中央・右、上・中・下）を調整するツールバー
 */
class SVGTextAlignToolbar extends SVGToolbarBase {
    constructor(container, draw, options = {}) {
        super({
            id: options.id || 'svg-text-align-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '180px', left: '10px' }
        });
        this.draw = draw;

        this.icons = {
            hLeft: '<line x1="4" y1="2" x2="4" y2="22" stroke="#888"></line><rect x="8" y="7" width="12" height="10" rx="1"></rect><line x1="10" y1="10" x2="14" y2="10" stroke-width="1"></line><line x1="10" y1="14" x2="16" y2="14" stroke-width="1"></line>',
            hCenter: '<line x1="12" y1="2" x2="12" y2="22" stroke="#888"></line><rect x="6" y="7" width="12" height="10" rx="1"></rect><line x1="9" y1="10" x2="15" y2="10" stroke-width="1"></line><line x1="10" y1="14" x2="14" y2="14" stroke-width="1"></line>',
            hRight: '<line x1="20" y1="2" x2="20" y2="22" stroke="#888"></line><rect x="4" y="7" width="12" height="10" rx="1"></rect><line x1="10" y1="10" x2="14" y2="10" stroke-width="1"></line><line x1="8" y1="14" x2="14" y2="14" stroke-width="1"></line>',
            vTop: '<line x1="2" y1="4" x2="22" y2="4" stroke="#888"></line><rect x="7" y="8" width="10" height="12" rx="1"></rect><line x1="10" y1="11" x2="14" y2="11" stroke-width="1"></line>',
            vMiddle: '<line x1="2" y1="12" x2="22" y2="12" stroke="#888"></line><rect x="7" y="6" width="10" height="12" rx="1"></rect><line x1="10" y1="12" x2="14" y2="12" stroke-width="1"></line>',
            vBottom: '<line x1="2" y1="20" x2="22" y2="20" stroke="#888"></line><rect x="7" y="4" width="10" height="12" rx="1"></rect><line x1="10" y1="13" x2="14" y2="13" stroke-width="1"></line>',
            wmH_LTR: '<path d="M3 6h10M8 6v12"></path><path d="M15 12h6m0 0l-3-3m3 3l-3 3"></path>',
            wmH_RTL: '<path d="M11 6h10M16 6v12"></path><path d="M9 12H3m0 0l3-3m-3 3l3 3"></path>',
            wmV_RL: '<path d="M2 6h11M7.5 6v13"></path><path d="M19 4v15m-4-4 4 4 4-4"></path>'
        };

        this.buttonsConfig = [
            { id: 'h-left', title: '左寄せ', icon: this.icons.hLeft, h: 'left' },
            { id: 'h-center', title: '中央寄せ', icon: this.icons.hCenter, h: 'center' },
            { id: 'h-right', title: '右寄せ', icon: this.icons.hRight, h: 'right' },
            { separator: true },
            { id: 'v-top', title: '上寄せ', icon: this.icons.vTop, v: 'top' },
            { id: 'v-middle', title: '上下中央', icon: this.icons.vMiddle, v: 'middle' },
            { id: 'v-bottom', title: '下寄せ', icon: this.icons.vBottom, v: 'bottom' },
            { separator: true },
            { id: 'wm-h-ltr', title: '左書き', icon: this.icons.wmH_LTR, wm: 'h-ltr' },
            { id: 'wm-h-rtl', title: '右書き', icon: this.icons.wmH_RTL, wm: 'h-rtl' },
            { id: 'wm-v-rl', title: '縦書き', icon: this.icons.wmV_RL, wm: 'v-rl' },
            { separator: true },
            { isLabel: true, title: '行間' }
        ];

        this.createToolbar();
        window.SVGTextAlignmentToolbar = this;
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-text-align-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        this.alignedButtons = [];

        this.buttonsConfig.forEach(b => {
            if (b.separator) {
                contentArea.appendChild(this.createSeparator());
            } else if (b.isLabel) {
                const label = document.createElement('span');
                label.textContent = b.title;
                label.style.cssText = `font-size: 10px; color: var(--svg-toolbar-fg); opacity: 0.7; margin: 0 2px; white-space: nowrap;`;
                contentArea.appendChild(label);
            } else {
                const btn = this.createButton(b);
                this.alignedButtons.push(btn);
                contentArea.appendChild(btn);
            }
        });

        this.spacingInput = document.createElement('input');
        this.spacingInput.type = 'number';
        this.spacingInput.title = '行間の倍率 (例: 1.2 や 1.5)';
        this.spacingInput.step = '0.1';
        this.spacingInput.style.width = '45px';
        this.spacingInput.onchange = () => {
            const val = parseFloat(this.spacingInput.value);
            if (isNaN(val)) return;
            this.applyToSelection(target => {
                target.attr('data-line-spacing', val);
                this.updateTextPosition(target);
            });
        };
        contentArea.appendChild(this.spacingInput);
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    createButton(b) {
        const btn = document.createElement('button');
        btn.title = b.title;
        btn.dataset.h = b.h || '';
        btn.dataset.v = b.v || '';
        btn.dataset.wm = b.wm || '';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${b.icon}</svg>`;

        btn.onclick = (e) => {
            e.stopPropagation();
            if (b.wm) this.applyWritingMode(b.wm);
            else this.applyAlignment(b.h, b.v);
        };
        return btn;
    }

    applyToSelection(action) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const target = this.findTextGroup(el);
            if (target) action(target);
        });
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    applyAlignment(alignH, alignV) {
        this.applyToSelection(target => {
            let changed = false;
            if (alignH && target.attr('data-align-h') !== alignH) {
                target.attr('data-align-h', alignH);
                changed = true;
            }
            if (alignV && target.attr('data-align-v') !== alignV) {
                target.attr('data-align-v', alignV);
                changed = true;
            }

            // [FIX] 同じ揃え位置をクリックし続けた場合にBBoxの再取得誤差でドリフトしないよう、変更時のみ更新
            if (changed) {
                this.updateTextPosition(target);
            }
        });
        this.updateUI();
    }

    applyWritingMode(mode) {
        this.applyToSelection(target => {
            if (target.attr('data-writing-mode') !== mode) {
                target.attr('data-writing-mode', mode);
                this.updateTextPosition(target);
            }
        });
        this.updateUI();
    }

    updateUI() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        const target = this.findTextGroup(selected[0]);
        if (target) {
            const h = target.attr('data-align-h') || 'center';
            const v = target.attr('data-align-v') || 'middle';
            const wm = target.attr('data-writing-mode') || 'h-ltr';

            this.alignedButtons.forEach(btn => {
                const isMatch = (btn.dataset.h && btn.dataset.h === h) || (btn.dataset.v && btn.dataset.v === v) || (btn.dataset.wm && btn.dataset.wm === wm);
                btn.classList.toggle('active', isMatch);
            });

            let sv = parseFloat(target.attr('data-line-spacing'));
            if (isNaN(sv) && target.type === 'g') {
                let textEl = null;
                target.children().forEach(ch => {
                    if (ch.type === 'text' && !ch.hasClass('svg-interaction-hitarea') && !textEl) textEl = ch;
                });
                if (!textEl && typeof target.findOne === 'function') {
                    try { textEl = target.findOne('text:not(.svg-interaction-hitarea)'); } catch(e){}
                }
                if (textEl) sv = parseFloat(textEl.attr('data-line-spacing'));
            }
            if (isNaN(sv)) sv = 1.2;
            this.spacingInput.value = (Math.round(sv * 10) / 10).toString();
        }
    }

    findTextGroup(el) {
        if (!el) return null;
        if (el.attr('data-tool-id') === 'shape-text-group') return el;
        const parent = el.parent();
        if (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') return parent;
        if (el.type === 'text') return el;
        return null;
    }

    updateTextPosition(target, skipSync = false) {
        if (!target) return;
        let shape = null; let text = null;

        if (target.attr('data-tool-id') === 'shape-text-group') {
            const children = Array.from(target.children());
            shape = children.find(c => c.type !== 'text' && !c.hasClass('svg-interaction-hitarea') && !c.hasClass('svg-select-handle'));
            text = children.find(c => c.type === 'text' && !c.hasClass('svg-interaction-hitarea'));
        } else if (target.type === 'text') {
            text = target;
        }
        if (!text) return;

        // [FIX] 背景図形がない単独テキストで、アライメント指定が一切ない場合は、再配置を行わずSVGネイティブの座標を尊重する
        if (!shape && !target.attr('data-align-h') && !target.attr('data-align-v') && !target.attr('data-writing-mode')) {
            return;
        }

        const h = target.attr('data-align-h') || 'center';
        const v = target.attr('data-align-v') || 'middle';
        const wm = target.attr('data-writing-mode') || 'h-ltr';
        const isVertical = wm === 'v-rl';
        const isRTL = wm === 'h-rtl';

        let sBox = shape ? shape.bbox().transform(shape.matrix()) : text.bbox().transform(text.matrix());
        const margin = 5; let anchor = 'middle'; let baseline = 'central';
        let fontSize = NaN;
        if (window.getComputedStyle) {
            const cs = window.getComputedStyle(text.node);
            if (cs && cs.fontSize) fontSize = parseFloat(cs.fontSize);
        }
        if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.node.getAttribute('font-size'));
        if (isNaN(fontSize) || fontSize <= 0) fontSize = parseFloat(text.attr('font-size'));
        if (isNaN(fontSize) || fontSize <= 0) fontSize = 20;


        // 倍率ベースでの行間解釈
        let spacingVal = parseFloat(target.attr('data-line-spacing'));
        if (isNaN(spacingVal) && target.type === 'g' && text) {
            spacingVal = parseFloat(text.attr('data-line-spacing'));
        }
        if (isNaN(spacingVal)) spacingVal = 1.2;
        const lineSpacing = fontSize * spacingVal;

        const tspans = Array.from(text.node.querySelectorAll('tspan'));
        const totalOffset = (tspans.length - 1) * lineSpacing;

        if (isVertical) {
            text.attr({ 'writing-mode': 'vertical-rl', 'direction': 'ltr' });
            text.css({ 'writing-mode': 'vertical-rl', 'direction': 'ltr', 'unicode-bidi': 'normal' });
        } else if (isRTL) {
            text.attr({ 'writing-mode': 'horizontal-tb', 'direction': 'rtl' });
            text.css({ 'writing-mode': 'horizontal-tb', 'direction': 'rtl', 'unicode-bidi': 'bidi-override' });
        } else {
            text.attr({ 'writing-mode': 'horizontal-tb', 'direction': 'ltr' });
            text.css({ 'writing-mode': 'horizontal-tb', 'direction': 'ltr', 'unicode-bidi': 'normal' });
        }

        let targetX, targetY;
        if (isVertical) {
            if (shape) {
                if (v === 'top') { anchor = 'start'; targetY = sBox.y + margin; }
                else if (v === 'bottom') { anchor = 'end'; targetY = sBox.y2 - margin; }
                else { anchor = 'middle'; targetY = sBox.cy; }
                if (h === 'left') targetX = sBox.x + margin + totalOffset;
                else if (h === 'right') targetX = sBox.x2 - margin;
                else targetX = sBox.cx + (totalOffset / 2);
            } else {
                if (v === 'top') anchor = 'start'; else if (v === 'bottom') anchor = 'end'; else anchor = 'middle';
                targetY = (v === 'top' ? sBox.y : (v === 'bottom' ? sBox.y2 : sBox.cy));
                targetX = parseFloat(text.attr('x')) || sBox.x;
            }
            baseline = 'central';
        } else {
            if (shape) {
                if (h === 'left') { anchor = isRTL ? 'end' : 'start'; targetX = sBox.x + margin; }
                else if (h === 'right') { anchor = isRTL ? 'start' : 'end'; targetX = sBox.x2 - margin; }
                else { anchor = 'middle'; targetX = sBox.cx; }
                if (v === 'top') { baseline = 'text-before-edge'; targetY = sBox.y + margin; }
                else if (v === 'bottom') { baseline = 'text-after-edge'; targetY = sBox.y2 - margin - totalOffset; }
                else { baseline = 'central'; targetY = sBox.cy - (totalOffset / 2); }
            } else {
                if (h === 'left') anchor = isRTL ? 'end' : 'start'; else if (h === 'right') anchor = isRTL ? 'start' : 'end'; else anchor = 'middle';

                // 初回配置や変更時の座標基準としてBBoxを利用
                targetX = (h === 'left' ? sBox.x : (h === 'right' ? sBox.x2 : sBox.cx));
                if (v === 'top') targetY = sBox.y; else if (v === 'bottom') targetY = sBox.y2 - totalOffset; else targetY = sBox.cy - (totalOffset / 2);

                // [FIX] baselineが固定されたままだとBBoxに基づく座標計算で上下に大きくドリフトするため
                // 形状付きグループと同様に、アライメントに応じたベースラインを強制適用する
                if (v === 'top') baseline = 'text-before-edge';
                else if (v === 'bottom') baseline = 'text-after-edge';
                else baseline = 'central';
            }
        }

        const rotation = text.transform().rotate || 0;
        text.attr({ 'x': targetX, 'y': targetY, 'text-anchor': anchor, 'dominant-baseline': baseline, 'transform': rotation ? `rotate(${rotation} ${targetX} ${targetY})` : null });

        tspans.forEach((node, idx) => {
            const tspan = SVG(node); if (!tspan) return;
            if (isVertical) tspan.attr({ 'x': targetX - (idx * lineSpacing), 'y': targetY, 'dy': 0, 'text-anchor': anchor, 'dominant-baseline': baseline });
            else tspan.attr({ 'x': targetX, 'y': null, 'text-anchor': anchor, 'dominant-baseline': baseline, 'dy': idx === 0 ? 0 : lineSpacing });
        });

        // [FIX] SVGエンジンのキャッシュによる描画遅延を防ぐため、強制的にリフロー(再描画)を発生させる
        const display = text.node.style.display;
        text.node.style.display = 'none';
        void text.node.offsetHeight; 
        text.node.style.display = display;

        if (!skipSync) {
            const si = target.remember('_shapeInstance');
            if (si && typeof si.syncSelectionHandlers === 'function') si.syncSelectionHandlers();
        }
        text.attr('data-last-align', Date.now());

        if (shape && shape.attr('data-is-background') === 'true') {
            const tBox = text.bbox();
            shape.size(tBox.width + 10, tBox.height + 4);
            const tc = text.bbox().transform(text.matrix());
            shape.center(tc.cx, tc.cy);
            const si = target.remember('_shapeInstance');
            if (si && typeof si.updateHitArea === 'function') si.updateHitArea();
        }
    }

    show() { if (this.toolbarElement) { this.toolbarElement.style.display = 'flex'; this.updateFromSelection(); } }
    hide() { /* Always visible */ }
    isVisible() { return this.toolbarElement && this.toolbarElement.style.display === 'flex'; }
    updateFromSelection() { this.updateUI(); }
    destroy() { if (this.toolbarElement) this.toolbarElement.remove(); }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createTextAlignToolbar = (container, draw, options) => {
    return new SVGTextAlignToolbar(container, draw, options);
};
