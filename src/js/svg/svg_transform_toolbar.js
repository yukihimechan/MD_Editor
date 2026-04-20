/**
 * SVG Transform Toolbar
 * Provides UI for viewing and editing element/canvas geometry (X, Y, W, H, Angle).
 */
class SVGTransformToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-transform-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '10px', left: '10px' }
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
        this.toolbarElement.classList.add('svg-transform-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        contentArea.appendChild(this.createTransformField('X:', 'x'));
        contentArea.appendChild(this.createTransformField('Y:', 'y'));
        contentArea.appendChild(this.createSeparator());
        contentArea.appendChild(this.createTransformField('W:', 'w'));
        contentArea.appendChild(this.createTransformField('H:', 'h'));
        contentArea.appendChild(this.createSeparator());
        contentArea.appendChild(this.createTransformField('A:', 'angle'));
        contentArea.appendChild(this.createSeparator());
    }

    createTransformField(label, id) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        wrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${label}</span>`;

        const input = document.createElement('input');
        input.type = 'number';
        input.style.width = '45px';
        input.style.textAlign = 'right';

        input.addEventListener('change', () => {
            this.onValueChange(id, parseFloat(input.value));
        });

        input.addEventListener('keydown', (e) => e.stopPropagation());

        wrap.appendChild(input);
        this.inputs[id] = input;
        return wrap;
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    updateValues(data) {
        for (const key in data) {
            if (this.inputs[key]) {
                const val = data[key];
                if (val === null || val === undefined || val === '') {
                    this.inputs[key].value = '';
                    this.inputs[key].placeholder = 'mixed';
                } else {
                    const rounded = key === 'angle' ? Math.round(val) : Math.round(val * 10) / 10;
                    this.inputs[key].value = rounded;
                    this.inputs[key].placeholder = '';
                }
            }
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
window.createTransformToolbar = (container, options) => {
    return new SVGTransformToolbar(container, options);
};
