/**
 * SVG Align Toolbar
 * Provides UI for aligning and distributing selected elements.
 */
class SVGAlignToolbar extends SVGToolbarBase {
    constructor(container, draw, options = {}) {
        super({
            id: options.id || 'svg-align-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '145px', left: '10px' }
        });
        this.draw = draw;

        this.icons = {
            left: '<line x1="4" y1="2" x2="4" y2="22"></line><rect x="8" y="5" width="12" height="4" rx="1"></rect><rect x="8" y="15" width="8" height="4" rx="1"></rect>',
            hCenter: '<line x1="12" y1="2" x2="12" y2="22"></line><rect x="6" y="5" width="12" height="4" rx="1"></rect><rect x="8" y="15" width="8" height="4" rx="1"></rect>',
            right: '<line x1="20" y1="2" x2="20" y2="22"></line><rect x="4" y="5" width="12" height="4" rx="1"></rect><rect x="8" y="15" width="8" height="4" rx="1"></rect>',
            hDist: '<rect x="4" y="7" width="4" height="10" rx="1"></rect><rect x="16" y="7" width="4" height="10" rx="1"></rect><line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="2 2"></line>',
            top: '<line x1="2" y1="4" x2="22" y2="4"></line><rect x="5" y="8" width="4" height="12" rx="1"></rect><rect x="15" y="8" width="4" height="8" rx="1"></rect>',
            vCenter: '<line x1="2" y1="12" x2="22" y2="12"></line><rect x="5" y="6" width="4" height="12" rx="1"></rect><rect x="15" y="8" width="4" height="8" rx="1"></rect>',
            bottom: '<line x1="2" y1="20" x2="22" y2="20"></line><rect x="5" y="4" width="4" height="12" rx="1"></rect><rect x="15" y="8" width="4" height="8" rx="1"></rect>',
            vDist: '<rect x="7" y="4" width="10" height="4" rx="1"></rect><rect x="7" y="16" width="10" height="4" rx="1"></rect><line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="2 2"></line>'
        };

        this.buttonsConfig = [
            { id: 'align-left', title: '左揃え', icon: this.icons.left, action: () => this.alignElements('left') },
            { id: 'align-hcenter', title: '水平中央揃え', icon: this.icons.hCenter, action: () => this.alignElements('hCenter') },
            { id: 'align-right', title: '右揃え', icon: this.icons.right, action: () => this.alignElements('right') },
            { id: 'dist-h', title: '水平等間隔', icon: this.icons.hDist, action: () => this.distributeElements('horizontal') },
            { id: 'align-top', title: '上揃え', icon: this.icons.top, action: () => this.alignElements('top') },
            { id: 'align-vcenter', title: '垂直中央揃え', icon: this.icons.vCenter, action: () => this.alignElements('vCenter') },
            { id: 'align-bottom', title: '下揃え', icon: this.icons.bottom, action: () => this.alignElements('bottom') },
            { id: 'dist-v', title: '垂直等間隔', icon: this.icons.vDist, action: () => this.distributeElements('vertical') }
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
        this.toolbarElement.classList.add('svg-align-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        this.contentArea.innerHTML = '';
        this.buttonsConfig.forEach(b => {
            const btn = document.createElement('button');
            btn.id = b.id;
            btn.title = b.title;
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b.icon}</svg>`;
            btn.onclick = (e) => {
                e.stopPropagation();
                b.action();
            };
            this.contentArea.appendChild(btn);
        });
    }

    getRBox(el) {
        if (!el || !el.node || !el.node.isConnected) return null;
        try {
            return el.rbox(this.draw);
        } catch (e) {
            console.warn('[svg_align] Failed to get rbox:', e);
            return null;
        }
    }

    alignElements(type) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const elements = Array.from(window.currentEditingSVG.selectedElements)
            .filter(el => el.node && el.node.isConnected);

        if (elements.length < 2) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const validBoxes = [];

        elements.forEach(el => {
            const r = this.getRBox(el);
            if (!r) return;
            validBoxes.push({ el, box: r });
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x2);
            maxY = Math.max(maxY, r.y2);
        });

        if (validBoxes.length < 2) return;

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        validBoxes.forEach(({ el, box }) => {
            let dx = 0, dy = 0;
            switch (type) {
                case 'left': dx = minX - box.x; break;
                case 'hCenter': dx = centerX - box.cx; break;
                case 'right': dx = maxX - box.x2; break;
                case 'top': dy = minY - box.y; break;
                case 'vCenter': dy = centerY - box.cy; break;
                case 'bottom': dy = maxY - box.y2; break;
            }

            if (dx !== 0 || dy !== 0) {
                this.moveElementWorld(el, dx, dy);
            }
        });

        if (typeof syncSelectionHandlers === 'function') syncSelectionHandlers();
        if (typeof syncChanges === 'function') syncChanges();
    }

    distributeElements(dir) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length < 3) return;

        const boxes = selected.map(el => ({ el, box: this.getRBox(el) }))
            .filter(item => item.box !== null);

        if (boxes.length < 3) return;

        if (dir === 'horizontal') {
            boxes.sort((a, b) => a.box.x - b.box.x);
            const totalWidth = boxes.reduce((sum, item) => sum + item.box.width, 0);
            const fullSpan = boxes[boxes.length - 1].box.x2 - boxes[0].box.x;
            const gap = (fullSpan - totalWidth) / (boxes.length - 1);

            let currentX = boxes[0].box.x;
            for (let i = 1; i < boxes.length - 1; i++) {
                currentX += boxes[i - 1].box.width + gap;
                const dx = currentX - boxes[i].box.x;
                this.moveElementWorld(boxes[i].el, dx, 0);
            }
        } else {
            boxes.sort((a, b) => a.box.y - b.box.y);
            const totalHeight = boxes.reduce((sum, item) => sum + item.box.height, 0);
            const fullSpan = boxes[boxes.length - 1].box.y2 - boxes[0].box.y;
            const gap = (fullSpan - totalHeight) / (boxes.length - 1);

            let currentY = boxes[0].box.y;
            for (let i = 1; i < boxes.length - 1; i++) {
                currentY += boxes[i - 1].box.height + gap;
                const dy = currentY - boxes[i].box.y;
                this.moveElementWorld(boxes[i].el, 0, dy);
            }
        }

        if (typeof syncSelectionHandlers === 'function') syncSelectionHandlers();
        if (typeof syncChanges === 'function') syncChanges();
    }

    moveElementWorld(el, dx, dy) {
        if (dx === 0 && dy === 0) return;
        if (!el || !el.node || !el.node.isConnected) return;

        const worldMatrix = el.ctm();
        worldMatrix.e += dx;
        worldMatrix.f += dy;

        const parent = el.parent();
        if (parent) {
            const parentInv = parent.ctm().inverse();
            const newLocalMatrix = parentInv.multiply(worldMatrix);
            el.matrix(newLocalMatrix);
        }
    }

    destroy() {
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createAlignToolbar = (container, draw, options) => {
    return new SVGAlignToolbar(container, draw, options);
};
