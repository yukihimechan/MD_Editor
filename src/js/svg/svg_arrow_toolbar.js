/**
 * SVG Arrow Toolbar - 矢印ツール専用ツールバー
 * 直線矢印、90度曲がり矢印、U字矢印の3種類をサポート。
 */

// ============================================================
//  パスユーティリティ（ローカル座標系、原点(0,0)から右向き）
// ============================================================
const ArrowPaths = {
    /**
     * 直線矢印（左→右向き）
     * 座標: x=0(左端) ～ x=len(矢印先端)、y=0が中心軸
     */
    straight({ len = 120, shaftW = 20, headW = 40, headL = 40 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const neck = Math.max(0, len - headL); // 矢印先と軸の接続点
        return [
            `M 0 ${-sw2}`,
            `H ${neck}`,
            `V ${-hw2}`,
            `L ${len} 0`,
            `L ${neck} ${hw2}`,
            `V ${sw2}`,
            `H 0`,
            `Z`
        ].join(' ');
    },

    /**
     * 直線矢印（両端）
     */
    straight_both({ len = 120, shaftW = 20, headW = 40, headL = 40 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const neckH = Math.max(headL, len - headL);
        return [
            `M ${headL} ${-sw2}`,
            `H ${neckH}`,
            `V ${-hw2}`,
            `L ${len} 0`,
            `L ${neckH} ${hw2}`,
            `V ${sw2}`,
            `H ${headL}`,
            `V ${hw2}`,
            `L 0 0`,
            `L ${headL} ${-hw2}`,
            `Z`
        ].join(' ');
    },

    /**
     * 90度曲がり矢印（水平右→垂直上に曲がる L字型）
     * 座標: コーナーを原点付近に配置
     *   垂直軸 x=0中心, y=-legV(矢印先) ～ y=+sw2(H軸交差)
     *   水平軸 y=0中心, x=+sw2(V軸右端) ～ x=legH(右端)
     */
    curved({ legH = 80, legV = 80, radius = 20, shaftW = 20, headW = 40, headL = 40 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const neckV = Math.max(sw2 + 1, legV - headL);
        const r = Math.max(0, Math.min(radius, Math.min(legH - sw2 * 2, neckV - sw2)));
        if (r <= 0) {
            // 直角コーナー（半径なし）
            return [
                `M ${legH} ${-sw2}`,
                `H ${sw2}`,
                `V ${-neckV}`,
                `H ${hw2}`,
                `L 0 ${-legV}`,
                `L ${-hw2} ${-neckV}`,
                `H ${-sw2}`,
                `V ${sw2}`,
                `H ${legH}`,
                `Z`
            ].join(' ');
        }
        // コーナー丸み付き
        return [
            `M ${legH} ${-sw2}`,
            `H ${sw2 + r}`,
            `Q ${sw2} ${-sw2} ${sw2} ${-sw2 - r}`,
            `V ${-neckV}`,
            `H ${hw2}`,
            `L 0 ${-legV}`,
            `L ${-hw2} ${-neckV}`,
            `H ${-sw2}`,
            `V ${-sw2 - r}`,
            `Q ${-sw2} ${sw2} ${sw2 + r} ${sw2}`,
            `H ${legH}`,
            `Z`
        ].join(' ');
    },

    /**
     * 90度曲がり矢印（両端）
     */
    curved_both({ legH = 80, legV = 80, radius = 20, shaftW = 20, headW = 40, headL = 40 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const neckV = Math.max(sw2 + 1, legV - headL);
        const neckH = Math.max(sw2 + 1, legH - headL);
        const r = Math.max(0, Math.min(radius, Math.min(neckH - sw2, neckV - sw2)));
        if (r <= 0) {
            return [
                `M ${legH} ${-sw2}`,
                `H ${sw2}`,
                `V ${-neckV}`,
                `H ${hw2}`,
                `L 0 ${-legV}`,
                `L ${-hw2} ${-neckV}`,
                `H ${-sw2}`,
                `V ${sw2}`,
                `H ${neckH}`,
                `V ${hw2}`,
                `L ${legH} 0`,
                `L ${neckH} ${-hw2}`,
                `Z`
            ].join(' ');
        }
        return [
            `M ${neckH} ${-sw2}`,
            `H ${sw2 + r}`,
            `Q ${sw2} ${-sw2} ${sw2} ${-sw2 - r}`,
            `V ${-neckV}`,
            `H ${hw2}`,
            `L 0 ${-legV}`,
            `L ${-hw2} ${-neckV}`,
            `H ${-sw2}`,
            `V ${-sw2 - r}`,
            `Q ${-sw2} ${sw2} ${sw2 + r} ${sw2}`,
            `H ${neckH}`,
            `V ${hw2}`,
            `L ${legH} 0`,
            `L ${neckH} ${-hw2}`,
            `Z`
        ].join(' ');
    },

    /**
     * U字矢印（左軸が下り、底でUターンし、右軸が上がって矢印先）
     * 座標: 左軸 x=0中心, 右軸 x=uWidth中心, y=0が上端, U底はy>0
     */
    uturn({ legH1 = 80, legH2 = 80, uWidth = 60, shaftW = 20, headW = 40, headL = 40, radius = 20 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const maxR = Math.max(0, uWidth / 2 - sw2);
        const ir = Math.min(Math.max(0, radius), maxR); // 内弧半径
        const or = ir + shaftW;                         // 外弧半径
        const neckH2 = Math.max(sw2 + 1, legH2 - headL);

        return [
            // 右軸 矢印先（上向き）
            `M ${uWidth - hw2} ${-neckH2}`,
            `L ${uWidth} ${-legH2}`,
            `L ${uWidth + hw2} ${-neckH2}`,
            // 矢印先→右軸外側→右軸下端(y=0)
            `H ${uWidth + sw2}`,
            `V 0`,
            // 外弧 右側
            `A ${or} ${or} 0 0 1 ${uWidth + sw2 - or} ${or}`,
            // 底辺 外側
            `H ${-sw2 + or}`,
            // 外弧 左側
            `A ${or} ${or} 0 0 1 ${-sw2} 0`,
            // 左軸外側左→左軸上端
            `V ${-legH1}`,
            // 左端横棒（外→内）
            `H ${sw2}`,
            // 左軸内側→左軸下端
            `V 0`,
            // 内弧 左側
            (ir > 0 ? `A ${ir} ${ir} 0 0 0 ${sw2 + ir} ${ir}` : ''),
            // 底辺 内側
            (ir > 0 ? `H ${uWidth - sw2 - ir}` : `H ${uWidth - sw2}`),
            // 内弧 右側
            (ir > 0 ? `A ${ir} ${ir} 0 0 0 ${uWidth - sw2} 0` : ''),
            // 右軸内側→矢印先基部
            `V ${-neckH2}`,
            `H ${uWidth - hw2}`,
            `Z`
        ].join(' ');
    },

    /**
     * U字矢印（両端）
     */
    uturn_both({ legH1 = 80, legH2 = 80, uWidth = 60, shaftW = 20, headW = 40, headL = 40, radius = 20 } = {}) {
        const sw2 = shaftW / 2;
        const hw2 = headW / 2;
        const maxR = Math.max(0, uWidth / 2 - sw2);
        const ir = Math.min(Math.max(0, radius), maxR);
        const or = ir + shaftW;
        const neckH1 = Math.max(sw2 + 1, legH1 - headL);
        const neckH2 = Math.max(sw2 + 1, legH2 - headL);

        return [
            // 右軸 矢印先（上向き）
            `M ${uWidth - hw2} ${-neckH2}`,
            `L ${uWidth} ${-legH2}`,
            `L ${uWidth + hw2} ${-neckH2}`,
            `H ${uWidth + sw2}`,
            `V 0`,
            // 外弧 右側
            `A ${or} ${or} 0 0 1 ${uWidth + sw2 - or} ${or}`,
            `H ${-sw2 + or}`,
            // 外弧 左側
            `A ${or} ${or} 0 0 1 ${-sw2} 0`,
            `V ${-neckH1}`,
            `H ${-hw2}`,
            `L 0 ${-legH1}`,
            `L ${hw2} ${-neckH1}`,
            `H ${sw2}`,
            `V 0`,
            // 内弧 左側
            (ir > 0 ? `A ${ir} ${ir} 0 0 0 ${sw2 + ir} ${ir}` : ''),
            (ir > 0 ? `H ${uWidth - sw2 - ir}` : `H ${uWidth - sw2}`),
            // 内弧 右側
            (ir > 0 ? `A ${ir} ${ir} 0 0 0 ${uWidth - sw2} 0` : ''),
            `V ${-neckH2}`,
            `H ${uWidth - hw2}`,
            `Z`
        ].join(' ');
    },
};



// ============================================================
//  ツールクラス
// ============================================================

class ArrowBaseTool extends BaseTool {
    get arrowToolId() { return 'straight_arrow'; }

    _getDefaults() {
        const id = this.arrowToolId;
        return {
            fill: this.toolbar.getToolProperty(id, 'fill', '#4472C4'),
            stroke: this.toolbar.getToolProperty(id, 'stroke', 'none'),
            strokeWidth: this.toolbar.getToolProperty(id, 'stroke-width', 0),
            shaftW: this.toolbar.getToolProperty(id, 'shaftW', 20),
            headW: this.toolbar.getToolProperty(id, 'headW', 40),
            headL: this.toolbar.getToolProperty(id, 'headL', 40),
        };
    }

    _buildPath(params) { return ''; }              // サブクラスで実装
    _defaultParams() { return {}; }                // サブクラスで実装
    _paramsFromLen(len) { return this._defaultParams(); } // サブクラスで実装

    mousedown(e, pt) {
        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        this.isDragging = false;
        const d = this._getDefaults();
        const params = this._defaultParams();
        const pathD = this._buildPath(params);

        this.activeElement = this.draw.path(pathD)
            .fill(d.fill)
            .stroke(d.stroke === 'none' ? 'none' : { color: d.stroke, width: d.strokeWidth });

        this.activeElement.attr('data-tool-id', this.arrowToolId);
        this._saveParams(this.activeElement, params);
        // 原点に置く（transformで移動）
        this.activeElement.attr('transform', `translate(${pt.x},${pt.y})`);
    }

    _saveParams(el, params) {
        for (const [k, v] of Object.entries(params)) {
            el.attr(`data-arrow-${k}`, v);
        }
    }

    mousemove(e, pt) {
        if (!this.activeElement) return;
        this.isDragging = true;
        const dx = pt.x - this.startPoint.x;
        const dy = pt.y - this.startPoint.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 3) return;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const params = this._paramsFromLen(len);
        this.activeElement.plot(this._buildPath(params));
        this._saveParams(this.activeElement, params);
        this.activeElement.attr('transform', `translate(${this.startPoint.x},${this.startPoint.y}) rotate(${angle})`);
    }

    mouseup(e, pt) {
        if (!this.activeElement) return;
        if (!this.isDragging) {
            const params = this._defaultParams();
            this.activeElement.plot(this._buildPath(params));
            this._saveParams(this.activeElement, params);
        }
        this.finalize();
    }
}

class StraightArrowTool extends ArrowBaseTool {
    get arrowToolId() { return 'straight_arrow'; }
    _defaultParams() {
        const d = this._getDefaults();
        return { len: this.toolbar.getToolProperty(this.arrowToolId, 'len', 120), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        return { len: Math.max(d.headL + 10, len), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.straight(p); }
}

class CurvedArrowTool extends ArrowBaseTool {
    get arrowToolId() { return 'curved_arrow'; }
    _defaultParams() {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        return { legH: this.toolbar.getToolProperty(id, 'legH', 80), legV: this.toolbar.getToolProperty(id, 'legV', 80), radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        const half = Math.max(d.headL + 10, len / 2);
        return { legH: half, legV: half, radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.curved(p); }
}

class UTurnArrowTool extends ArrowBaseTool {
    get arrowToolId() { return 'uturn_arrow'; }
    _defaultParams() {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        return { legH1: this.toolbar.getToolProperty(id, 'legH1', 80), legH2: this.toolbar.getToolProperty(id, 'legH2', 80), uWidth: this.toolbar.getToolProperty(id, 'uWidth', 60), radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        return { legH1: Math.max(d.headL + 10, len), legH2: Math.max(d.headL + 10, len), uWidth: this.toolbar.getToolProperty(id, 'uWidth', 60), radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.uturn(p); }
}

class DoubleStraightArrowTool extends StraightArrowTool {
    get arrowToolId() { return 'straight_both_arrow'; }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        return { len: Math.max(d.headL * 2 + 10, len), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.straight_both(p); }
}

class DoubleCurvedArrowTool extends CurvedArrowTool {
    get arrowToolId() { return 'curved_both_arrow'; }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        const half = Math.max(d.headL + 10, len / 2);
        return { legH: half, legV: half, radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.curved_both(p); }
}

class DoubleUTurnArrowTool extends UTurnArrowTool {
    get arrowToolId() { return 'uturn_both_arrow'; }
    _paramsFromLen(len) {
        const d = this._getDefaults();
        const id = this.arrowToolId;
        return { legH1: Math.max(d.headL + 10, len), legH2: Math.max(d.headL + 10, len), uWidth: this.toolbar.getToolProperty(id, 'uWidth', 60), radius: this.toolbar.getToolProperty(id, 'radius', 20), shaftW: d.shaftW, headW: d.headW, headL: d.headL };
    }
    _buildPath(p) { return ArrowPaths.uturn_both(p); }
}



// ============================================================
//  ツールバーUI
// ============================================================
// ============================================================
//  ツールバーUI
// ============================================================
const ARROW_TOOLS = [
    {
        id: 'straight_arrow', label: '直線矢印',
        title: '直線矢印',
        icon: `<path d="M2 12H17V8L23 12L17 16V12" fill="currentColor"/>`,
        ToolClass: StraightArrowTool
    },
    {
        id: 'curved_arrow', label: '90度矢印',
        title: '90度曲がり矢印',
        icon: `<path d="M4 18V10Q4 4 10 4H17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
               <path d="M14 0L21 4L14 8Z" fill="currentColor"/>`,
        ToolClass: CurvedArrowTool
    },
    {
        id: 'uturn_arrow', label: 'U字矢印',
        title: 'U字矢印',
        icon: `<path d="M7 4V16Q7 20 12 20Q17 20 17 16V4" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
               <path d="M14 0L21 4L14 8Z" fill="currentColor"/>`,
        ToolClass: UTurnArrowTool
    },
    {
        id: 'straight_both_arrow', label: '直線(両端)',
        title: '直線矢印（両端）',
        icon: `<path d="M2 12H22M2 12L8 8M2 12L8 16M22 12L16 8M22 12L16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,
        ToolClass: DoubleStraightArrowTool
    },
    {
        id: 'curved_both_arrow', label: '90度(両端)',
        title: '90度曲がり矢印（両端）',
        icon: `<path d="M4 18V10Q4 4 10 4H17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
               <path d="M14 0L21 4L14 8ZM0 15L4 22L8 15Z" fill="currentColor"/>`,
        ToolClass: DoubleCurvedArrowTool
    },
    {
        id: 'uturn_both_arrow', label: 'U字(両端)',
        title: 'U字矢印（両端）',
        icon: `<path d="M7 5V16Q7 20 12 20Q17 20 17 16V5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
               <path d="M14 0L21 5L14 10ZM0 10L7 0L14 10Z" fill="currentColor"/>`,
        ToolClass: DoubleUTurnArrowTool
    }
];

class SVGArrowToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-arrow-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '50px', left: '10px' }
        });
        this.svgToolbar = svgToolbar;
        this.createToolbar();
    }

    createToolbar() {
        // SVGToolbarにツールを登録
        if (this.svgToolbar && this.svgToolbar.toolMap) {
            ARROW_TOOLS.forEach(t => {
                this.svgToolbar.toolMap[t.id] = new t.ToolClass(this.svgToolbar);
                if (!this.svgToolbar.toolDefaults[t.id]) {
                    const defaults = { fill: '#4472C4', stroke: 'none', 'stroke-width': 0 };
                    (ARROW_EXTRA_PARAMS[t.id] || []).forEach(p => {
                        defaults[p.key] = p.default;
                    });
                    this.svgToolbar.toolDefaults[t.id] = defaults;
                    // 保存を同期
                    this.svgToolbar.saveToolDefaults();
                }
            });
        }

        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-arrow-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }

        // setToolのフック（ハイライト同期）
        if (this.svgToolbar && this.svgToolbar.setTool) {
            const _origSetTool = this.svgToolbar.setTool.bind(this.svgToolbar);
            this.svgToolbar.setTool = (toolId) => {
                _origSetTool(toolId);
                this.updateHighlight(toolId);
            };
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        ARROW_TOOLS.forEach(tool => {
            const btn = document.createElement('button');
            btn.title = tool.title;
            btn.dataset.tool = tool.id;
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="overflow:visible;">${tool.icon}</svg>`;
            btn.onclick = (e) => {
                e.stopPropagation();
                if (this.svgToolbar) {
                    this.svgToolbar.setTool(tool.id);
                    this.updateHighlight(tool.id);
                }
            };
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.svgToolbar && typeof this.svgToolbar.showToolPropertiesDialog === 'function') {
                    this.svgToolbar.showToolPropertiesDialog(tool.id, tool.label);
                }
            });
            contentArea.appendChild(btn);
        });
    }

    updateHighlight(activeId) {
        if (!this.toolbarElement) return;
        this.toolbarElement.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === activeId);
        });
    }

    destroy() {
        if (this.toolbarElement) {
            this.toolbarElement.remove();
        }
    }

    resetPosition() {
        super.resetPosition();
    }
}

// 互換性維持のためのファクトリ関数
window.createArrowToolbar = (container, svgToolbar, options) => {
    return new SVGArrowToolbar(container, svgToolbar, options);
};



// ============================================================
//  プロパティダイアログ
// ============================================================
const ARROW_EXTRA_PARAMS = {
    straight_arrow: [
        { key: 'len', label: '矢印の長さ', default: 120, min: 20 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
    curved_arrow: [
        { key: 'legH', label: '水平部の長さ', default: 80, min: 20 },
        { key: 'legV', label: '垂直部の長さ', default: 80, min: 20 },
        { key: 'radius', label: 'コーナーの丸み', default: 20, min: 0 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
    uturn_arrow: [
        { key: 'legH1', label: '前半の長さ', default: 80, min: 20 },
        { key: 'legH2', label: '後半の長さ', default: 80, min: 20 },
        { key: 'uWidth', label: 'U字の幅', default: 60, min: 20 },
        { key: 'radius', label: 'コーナーの丸み', default: 20, min: 0 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
    straight_both_arrow: [
        { key: 'len', label: '矢印の長さ', default: 120, min: 40 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
    curved_both_arrow: [
        { key: 'legH', label: '水平部の長さ', default: 80, min: 20 },
        { key: 'legV', label: '垂直部の長さ', default: 80, min: 20 },
        { key: 'radius', label: 'コーナーの丸み', default: 20, min: 0 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
    uturn_both_arrow: [
        { key: 'legH1', label: '前半の長さ', default: 80, min: 20 },
        { key: 'legH2', label: '後半の長さ', default: 80, min: 20 },
        { key: 'uWidth', label: 'U字の幅', default: 60, min: 20 },
        { key: 'radius', label: 'コーナーの丸み', default: 20, min: 0 },
        { key: 'shaftW', label: '軸の太さ', default: 20, min: 2 },
        { key: 'headW', label: '矢印先の幅', default: 40, min: 5 },
        { key: 'headL', label: '矢印先の長さ', default: 40, min: 5 },
    ],
};

// ============================================================
//  グローバルエクスポート
// ============================================================
window.ArrowPaths = ArrowPaths;
window.ArrowBaseTool = ArrowBaseTool;
window.StraightArrowTool = StraightArrowTool;
window.CurvedArrowTool = CurvedArrowTool;
window.UTurnArrowTool = UTurnArrowTool;
window.createArrowToolbar = createArrowToolbar;
