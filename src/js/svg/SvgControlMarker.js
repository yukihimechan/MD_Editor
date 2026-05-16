/**
 * SvgControlMarker.js
 * SVG図形の変形に使用する「黄色い制御マーカー」の共通クラス。
 * デザインの統一、座標変換（ローカル・ワールド間）、ドラッグ操作を管理する。
 */
class SvgControlMarker {
    /**
     * @param {SVG.Element} targetEl - 操作対象の図形要素 (SVG.js)
     * @param {Object} def - マーカーの定義
     *   - param: 操作する属性名 (例: 'shaftW')
     *   - axis: ドラッグ方向 ('x' または 'y')
     *   - dir: 方向係数 (1 or -1)
     *   - scale: スケール係数 (デフォルト 1)
     *   - cursor: カーソル形状
     *   - labelFn: パラメータからローカル座標を計算する関数 (params) => { x, y }
     */
    constructor(targetEl, def) {
        this.targetEl = targetEl;
        this.def = def;
        this.draw = targetEl.root();

        // デザイン定数
        this.color = '#FFDD00';
        this.stroke = '#000000';
        this.radius = 6; // 直径12px

        this.el = null;
        this._init();
    }

    _init() {
        if (!this.draw) return;

        this.el = this.draw.circle(this.radius * 2)
            .fill(this.color)
            .stroke({ color: this.stroke, width: 1.5 })
            .attr({
                'cursor': this.def.cursor || (this.def.axis === 'x' ? 'ew-resize' : 'ns-resize'),
                'style': 'pointer-events:all;',
                'data-type': 'control-marker',
                'data-param': this.def.param
            })
            .addClass('svg-control-marker');

        this.update();
        this._bindEvents();
    }

    /**
     * マーカーの位置を更新する
     * @param {Object} params - 図形の現在のパラメータ (オプション)
     */
    update(params) {
        if (!this.el || !this.targetEl.node.isConnected) return;

        if (!params) {
            // 図形のクラスインスタンスを通じて取得することを期待 (ArrowShapeなど)
            const shape = this.targetEl.remember('_shapeInstance');
            if (shape && typeof shape._readParams === 'function') {
                params = shape._readParams(this.targetEl.attr('data-tool-id'));
            }
        }
        if (!params) return;

        // 1. ローカル座標を取得
        const localPt = this.def.labelFn(params);

        // 2. 要素のCTM（内部行列）を使用してワールド座標へ変換
        const svg = this.targetEl.root();
        const node = this.targetEl.node;

        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
            // オーバーレイ（親）が指定されていない場合は、ルートSVG空間へのマッピングとして機能
            const pt = window.SVGUtils.mapLocalToOverlay(localPt, node, this.el.parent()?.node);
            this.el.center(pt.x, pt.y);
        } else {
            const worldPt = new SVG.Point(localPt.x, localPt.y).transform(node.getCTM());
            this.el.center(worldPt.x, worldPt.y);
        }

        // [NEW] Dynamic Scaling
        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
            window.SVGUtils.updateHandleScaling(this.el);
        }
    }

    _bindEvents() {
        let startClientX, startClientY, startVal;

        const onDown = (e) => {
            e.stopPropagation();
            e.preventDefault();

            startClientX = e.clientX;
            startClientY = e.clientY;

            // 現在の属性値を取得
            const attrName = `data-arrow-${this.def.param}`;
            startVal = parseFloat(this.targetEl.attr(attrName)) || 0;

            const onMove = (moveEvent) => {
                // スクリーン座標をSVGユーザー空間へ変換
                const p0 = this.draw.point(startClientX, startClientY);
                const p1 = this.draw.point(moveEvent.clientX, moveEvent.clientY);

                // 要素の逆行列を使用してローカル空間の移動量を計算
                const mInv = this.targetEl.matrix().inverse();
                const l0 = new SVG.Point(p0.x, p0.y).transform(mInv);
                const l1 = new SVG.Point(p1.x, p1.y).transform(mInv);

                const localDx = l1.x - l0.x;
                const localDy = l1.y - l0.y;

                const rawDelta = this.def.axis === 'x' ? localDx : localDy;
                const delta = rawDelta * this.def.dir * (this.def.scale || 1);

                // 制約条件の適用と更新
                let newVal = Math.max(2, startVal + delta);

                // 特定のパラメータに対する追加制約 (ArrowShape用)
                if (this.def.param === 'shaftW') {
                    const headW = parseFloat(this.targetEl.attr('data-arrow-headW')) || 40;
                    newVal = Math.min(newVal, headW - 2);
                }
                if (this.def.param === 'uWidth') {
                    const shaftW = parseFloat(this.targetEl.attr('data-arrow-shaftW')) || 20;
                    newVal = Math.max(newVal, shaftW * 2 + 2);
                }

                this.targetEl.attr(attrName, newVal);

                // 図形の再生成をトリガー
                const shape = this.targetEl.remember('_shapeInstance');
                if (shape) {
                    if (typeof shape._regeneratePath === 'function') shape._regeneratePath();
                    if (typeof shape.updateMarkers === 'function') {
                        shape.updateMarkers();
                    } else if (shape._controlMarkers) {
                        shape._controlMarkers.forEach(m => m.update());
                    }
                    if (typeof shape.updateHitArea === 'function') shape.updateHitArea();
                }

                if (window.syncChanges) window.syncChanges();
            };

            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (window.syncChanges) window.syncChanges();
            };

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };

        this.el.node.addEventListener('mousedown', onDown);
    }

    remove() {
        if (this.el) {
            this.el.remove();
            this.el = null;
        }
    }
}

window.SvgControlMarker = SvgControlMarker;
