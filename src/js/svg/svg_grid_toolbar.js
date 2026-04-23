/**
 * SVG Grid Toolbar
 * Provides UI for configuring grid size and visibility.
 */
class SVGGridToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-grid-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '10px', left: '10px' }
        });
        this.onConfigChange = options.onConfigChange || (() => { });
        this.zoomDisplay = null;

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
        this.toolbarElement.classList.add('svg-grid-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;

        // Grid Size Label & Input
        const sizeLabel = document.createElement('span');
        sizeLabel.textContent = 'Grid:';
        sizeLabel.style.fontSize = '10px';
        sizeLabel.style.color = 'var(--svg-toolbar-fg)';
        sizeLabel.style.opacity = '0.7';
        contentArea.appendChild(sizeLabel);

        const sizeInput = document.createElement('input');
        sizeInput.type = 'number';
        sizeInput.value = AppState.config.grid.size || 15;
        sizeInput.style.width = '45px';
        sizeInput.title = 'グリッドのピクセル数';
        contentArea.appendChild(sizeInput);

        const majorLabel = document.createElement('span');
        majorLabel.textContent = '/';
        majorLabel.style.fontSize = '12px';
        majorLabel.style.margin = '0 2px';
        majorLabel.style.color = 'var(--svg-toolbar-fg)';
        majorLabel.style.opacity = '0.5';
        contentArea.appendChild(majorLabel);

        const majorInput = document.createElement('input');
        majorInput.type = 'number';
        majorInput.value = AppState.config.grid.majorInterval || 5;
        majorInput.style.width = '35px';
        majorInput.title = '強調線の間隔（本）';
        contentArea.appendChild(majorInput);

        // Vertical Line Toggle
        const btnV = document.createElement('button');
        btnV.innerHTML = 'V';
        btnV.title = 'Toggle Vertical Grid Lines';
        if (AppState.config.grid.showV) btnV.classList.add('active');
        contentArea.appendChild(btnV);

        // Horizontal Line Toggle
        const btnH = document.createElement('button');
        btnH.innerHTML = 'H';
        btnH.title = 'Toggle Horizontal Grid Lines';
        if (AppState.config.grid.showH) btnH.classList.add('active');
        contentArea.appendChild(btnH);

        const zoomSeparator = document.createElement('div');
        zoomSeparator.className = 'svg-toolbar-separator';
        contentArea.appendChild(zoomSeparator);

        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.innerHTML = '-';
        zoomOutBtn.title = 'Zoom Out';
        zoomOutBtn.style.fontSize = '14px';
        contentArea.appendChild(zoomOutBtn);

        this.zoomDisplay = document.createElement('span');
        this.zoomDisplay.style.cssText = 'min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; font-size: 10px; color: var(--svg-toolbar-fg); opacity: 0.8;';
        this.zoomDisplay.textContent = '100%';
        contentArea.appendChild(this.zoomDisplay);

        const zoomInBtn = document.createElement('button');
        zoomInBtn.innerHTML = '+';
        zoomInBtn.title = 'Zoom In';
        zoomInBtn.style.fontSize = '14px';
        contentArea.appendChild(zoomInBtn);

        const zoomResetBtn = document.createElement('button');
        zoomResetBtn.innerHTML = '1:1';
        zoomResetBtn.title = 'Reset Zoom (100%)';
        zoomResetBtn.style.fontSize = '9px';
        contentArea.appendChild(zoomResetBtn);

        // Event Listeners
        const changeZoom = (factor, isAbsolute = false) => {
            if (!window.currentEditingSVG) return;
            const current = window.currentEditingSVG;
            const oldZoom = current.zoom;
            let newZoom = isAbsolute ? factor : oldZoom * factor;
            newZoom = Math.max(1, Math.min(6400, newZoom));

            const isReset = isAbsolute && factor === 100;
            const isPanning = current.offX !== 0 || current.offY !== 0;

            if (newZoom !== oldZoom || (isReset && isPanning)) {
                const rect = this.container.getBoundingClientRect();
                const cx = rect.width / 2;
                const cy = rect.height / 2;

                const vb = current.draw.node.viewBox.baseVal;
                const worldCX = vb.x + (cx / rect.width) * vb.width;
                const worldCY = vb.y + (cy / rect.height) * vb.height;

                current.zoom = newZoom;
                const newScale = 100 / newZoom;
                const newW = current.baseWidth * newScale;
                const newH = current.baseHeight * newScale;

                current.offX = worldCX - (cx / rect.width) * newW - current.baseX;
                current.offY = worldCY - (cy / rect.height) * newH - current.baseY;

                if (isAbsolute && factor === 100) {
                    current.offX = 0;
                    current.offY = 0;
                }

                current.applyZoomPan();
            }
        };

        zoomInBtn.addEventListener('click', () => changeZoom(1.2));
        zoomOutBtn.addEventListener('click', () => changeZoom(1 / 1.2));
        zoomResetBtn.addEventListener('click', () => changeZoom(100, true));

        sizeInput.addEventListener('change', () => {
            const val = parseInt(sizeInput.value);
            if (isNaN(val) || val < 5) {
                sizeInput.value = 5;
            }
            AppState.config.grid.size = parseInt(sizeInput.value);
            if (typeof saveSettings === 'function') saveSettings();
            this.onConfigChange();
        });

        majorInput.addEventListener('change', () => {
            const val = parseInt(majorInput.value);
            if (isNaN(val) || val < 1) {
                majorInput.value = 1;
            }
            AppState.config.grid.majorInterval = parseInt(majorInput.value);
            if (typeof saveSettings === 'function') saveSettings();
            this.onConfigChange();
        });

        btnV.addEventListener('click', () => {
            AppState.config.grid.showV = !AppState.config.grid.showV;
            btnV.classList.toggle('active', AppState.config.grid.showV);
            if (typeof saveSettings === 'function') saveSettings();
            this.onConfigChange();
        });

        btnH.addEventListener('click', () => {
            AppState.config.grid.showH = !AppState.config.grid.showH;
            btnH.classList.toggle('active', AppState.config.grid.showH);
            if (typeof saveSettings === 'function') saveSettings();
            this.onConfigChange();
        });
    }

    destroy() {
        if (this.toolbarElement) {
            this.toolbarElement.remove();
        }
    }

    updateZoomDisplay(zoom) {
        if (this.zoomDisplay) {
            this.zoomDisplay.textContent = Math.round(zoom) + '%';
        }
    }

    resetPosition() {
        super.resetPosition();
    }
}

// 互換性維持のためのファクトリ関数
window.createGridToolbar = (container, options) => {
    return new SVGGridToolbar(container, options);
};
