/**
 * SVG Custom Toolbar - カスタムツール専用ツールバー
 * 既存のSVGToolbarを補完し、カスタムツールのみを表示する独立したツールバー
 */
class SVGCustomToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-custom-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '110px', left: '-37px' }
        });
        this.onToolChange = options.onToolChange || (() => { });
        this.customTools = [];
        this.currentTool = null;

        this.initDebug();
        this.loadCustomTools();
        this.createToolbar();
    }

    initDebug() {
        window.debugSvgTools = () => {
            console.group('%c[SVG Custom Toolbar Debug]', 'color: #ff9; font-weight: bold;');
            const saved = localStorage.getItem('mdEditor_svgCustomTools');
            if (!saved) {
                console.log('No custom tools found in localStorage.');
            } else {
                try {
                    const tools = JSON.parse(saved);
                    console.log(`Found ${tools.length} registered tools:`);
                    tools.forEach((t, i) => {
                        console.log(`${i + 1}. ID: ${t.id}, Label: ${t.label}`);
                    });
                } catch (e) {
                    console.error('Failed to parse localStorage data:', e);
                }
            }
            console.log('Current Active Instance Tools:', this.customTools);
            console.groupEnd();
            return 'Debug complete.';
        };
    }

    loadCustomTools() {
        try {
            const saved = localStorage.getItem('mdEditor_svgCustomTools');
            this.customTools = saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load custom tools:', e);
            this.customTools = [];
        }
    }

    createToolbar() {
        // Position restoration logic is partially handled by base class, 
        // but custom toolbar has '50%' default which needs special care.
        const savedPosStr = localStorage.getItem(`${this.id}-pos`);
        let savedPos = null;
        try { if (savedPosStr) savedPos = JSON.parse(savedPosStr); } catch (e) { }

        const initialPos = savedPos || this.config.position;

        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: initialPos
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-custom-toolbar');

        // Apply centered transform if it's the default 50% left
        if (!savedPos && this.config.position.left === '50%') {
            this.toolbarElement.style.transform = 'translateX(-50%)';
        } else if (savedPos && savedPos.transform) {
            this.toolbarElement.style.transform = savedPos.transform;
        }

        this.toolbarElement.style.display = this.customTools.length > 0 ? 'flex' : 'none';

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        this.contentArea.innerHTML = '';
        this.customTools.forEach(tool => {
            const btn = this.createToolButton(tool);
            this.contentArea.appendChild(btn);
        });
    }

    createToolButton(tool) {
        const btn = document.createElement('button');
        btn.title = tool.label + ' (右クリックで削除)';
        btn.dataset.tool = tool.id;

        const viewBox = tool.viewBox || "0 0 24 24";
        const iconSvg = tool.icon || '<circle cx="12" cy="12" r="10"/>';

        btn.innerHTML = `<svg width="18" height="18" viewBox="${viewBox}" style="pointer-events:none; overflow:visible;" fill="none" stroke="currentColor">${iconSvg}</svg>`;

        if (tool.id === this.currentTool) {
            btn.classList.add('active');
        }

        btn.onclick = (e) => {
            e.stopPropagation();
            this.setTool(tool.id);
        };

        btn.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof showCustomToolContextMenu === 'function') {
                showCustomToolContextMenu(e, tool, (id) => this.deleteCustomTool(id), (t) => this.saveToolToFile(t));
            }
        };

        return btn;
    }

    setTool(toolId) {
        if (this.currentTool === toolId) return;
        this.currentTool = toolId;

        if (this.contentArea) {
            const buttons = this.contentArea.querySelectorAll('button[data-tool]');
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tool === toolId);
            });
        }

        this.onToolChange(toolId);
    }

    deleteCustomTool(toolId) {
        let tools = [];
        try {
            const saved = localStorage.getItem('mdEditor_svgCustomTools');
            if (saved) tools = JSON.parse(saved);
        } catch (e) { }

        tools = tools.filter(t => t.id !== toolId);
        localStorage.setItem('mdEditor_svgCustomTools', JSON.stringify(tools));

        this.customTools = tools;
        if (typeof SVGToolbar !== 'undefined') {
            SVGToolbar.customTools = tools;
        }

        this.renderContents();
        this.updateVisibility();
    }

    saveToolToFile(tool) {
        const parser = new DOMParser();
        const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tool.viewBox || '0 0 24 24'}">${tool.content || ''}</svg>`;
        const doc = parser.parseFromString(dummySvg, "image/svg+xml");
        
        let svgContent = "";
        if (doc.querySelector("parsererror")) {
            console.warn("[SVGCustomToolbar] Validate error, fallback to string concat.");
            svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tool.viewBox || '0 0 24 24'}">\n${tool.content || ''}\n</svg>`;
        } else {
            const serializer = new XMLSerializer();
            svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n` + serializer.serializeToString(doc.documentElement);
        }
        
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tool.label || 'custom-tool'}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    refresh() {
        this.loadCustomTools();
        this.renderContents();
        this.updateVisibility();
    }

    updateVisibility() {
        if (this.toolbarElement) {
            this.toolbarElement.style.display = this.customTools.length > 0 ? 'flex' : 'none';
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
window.createCustomToolbar = (container, options) => {
    return new SVGCustomToolbar(container, options);
};
