/**
 * SVG Airbrush Toolbar
 * エアブラシ風の描画効果（Gaussianブラー + 半透明ストローク）を設定・編集するツールバー
 * 描画ツール（AirbrushTool）のロジックもこのファイルに含め、
 * SVGMainToolbar の toolMap へ動的に登録する。
 */

// ─────────────────────────────────────────────
// AirbrushTool: BaseTool を継承した描画ツール
// ─────────────────────────────────────────────

/**
 * エアブラシツール
 * Canvas プロキシでリアルタイム描画し、mouseup 時に SVG path + feGaussianBlur に変換する
 * BaseTool は svg_toolbar.js で定義されており、このファイルより先に読み込まれる前提
 */
class AirbrushTool extends BaseTool {
    getCursor() { return 'crosshair'; }

    mousedown(e, pt) {
        this.startPoint = pt;
        this.points = [[pt.x, pt.y]];

        // エアブラシツールバーからパラメータを取得
        const params = this._getAirbrushParams();

        // ぼかしフィルターを事前に確保
        let filterAttr = null;
        if (params.blur > 0 && window.airbrushToolbar) {
            const filterId = window.airbrushToolbar.ensureFilter(this.draw, params.blur);
            if (filterId) filterAttr = `url(#${filterId})`;
        }

        // SVG 上に polyline を作成し、最終結果と同一の見た目を適用する
        // SVGレンダラーが直接描画するため、描画中 = 最終結果の見た目になる
        this.activeElement = this.draw.polyline([[pt.x, pt.y]])
            .fill('none')
            .stroke({
                color: params.color,
                width: params.strokeWidth
            })
            .attr({
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'opacity': params.opacity
            });

        // ぼかしフィルターを描画中から適用
        if (filterAttr) {
            this.activeElement.attr('filter', filterAttr);
        }

        // ブレンドモードを描画中から適用
        if (params.blendMode && params.blendMode !== 'normal') {
            this.activeElement.node.style.mixBlendMode = params.blendMode;
        }
    }

    mousemove(e, pt) {
        if (!this.activeElement) return;

        // polyline に座標を追加（SVGレンダラーがリアルタイムで再描画する）
        const arr = this.activeElement.array().valueOf();
        arr.push([pt.x, pt.y]);
        this.activeElement.plot(arr);
        this.points.push([pt.x, pt.y]);
    }

    mouseup(e, pt) {
        if (!this.activeElement) return;

        const params = this._getAirbrushParams();
        const points = this.activeElement.array().valueOf();

        if (points.length > 2) {
            // 1. Douglas-Peucker で間引き
            const epsilon = (typeof AppState !== 'undefined' && AppState.config.freehandEpsilon !== undefined)
                ? AppState.config.freehandEpsilon
                : 30.0;
            const simplified = SVGUtils.simplifyPoints(points, epsilon);

            // 2. Polyline → Path に変換
            if (window.SvgPolylineHandler) {
                const handler = new window.SvgPolylineHandler();
                const pathNode = handler.convertToPath(this.activeElement.node);
                if (pathNode) {
                    const pathEl = SVG(pathNode);

                    // 3. スムースコントロールポイントを計算
                    const bezData = SVGUtils.calculateSmoothControlPoints(simplified, 0.25);

                    // 4. メタデータを設定
                    pathEl.attr('data-poly-points', simplified.map(p => p.join(',')).join(' '));
                    pathEl.attr('data-bez-points', JSON.stringify(bezData));

                    // 5. パスの 'd' 属性を生成
                    handler.activeNode = pathNode;
                    handler.generatePath(pathNode);

                    this.activeElement = pathEl;
                }
            }
        }

        // エアブラシ固有の属性を再付与（Polyline → Path 変換後に失われる可能性があるため）
        if (this.activeElement) {
            this.activeElement.attr({
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'opacity': params.opacity
            });

            // ぼかしフィルター
            if (params.blur > 0 && window.airbrushToolbar) {
                const filterId = window.airbrushToolbar.ensureFilter(this.draw, params.blur);
                if (filterId) {
                    this.activeElement.attr('filter', `url(#${filterId})`);
                }
            }

            // ブレンドモード
            if (params.blendMode && params.blendMode !== 'normal') {
                this.activeElement.node.style.mixBlendMode = params.blendMode;
            }
        }

        this.points = [];
        super.mouseup(e, pt);
    }

    /**
     * エアブラシツールバーからパラメータを取得する
     */
    _getAirbrushParams() {
        if (window.airbrushToolbar && typeof window.airbrushToolbar.getParams === 'function') {
            return window.airbrushToolbar.getParams();
        }
        // フォールバック: デフォルト値
        return {
            color: '#ff007f',
            strokeWidth: 20,
            blur: 15,
            opacity: 0.5,
            blendMode: 'normal'
        };
    }

    /**
     * finalize をオーバーライド: 連続描画のため select に戻さない
     */
    finalize() {
        if (!this.activeElement) return;
        const box = this.activeElement.bbox();

        if (box.width < 2 && box.height < 2) {
            this.activeElement.remove();
        } else {
            // メタデータの付与
            this.activeElement.attr('data-tool-id', 'airbrush');

            if (window.makeInteractive) window.makeInteractive(this.activeElement);
            if (window.selectElement) window.selectElement(this.activeElement);
            if (window.syncChanges) window.syncChanges();
        }
        this.activeElement = null;
        // エアブラシモードは維持する（連続描画を可能にするため selectに戻さない）
    }
}

// ─────────────────────────────────────────────
// SVGAirbrushToolbar: ツールバーUI + パラメータ管理
// ─────────────────────────────────────────────

class SVGAirbrushToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-airbrush-toolbar',
            container: container,
            borderColor: options.borderColor || '#7B68EE',
            position: options.position || { top: '440px', left: '-37px' }
        });
        this.svgToolbar = svgToolbar;
        this.container = container;

        // 現在のパラメータ
        this.params = {
            color: '#ff007f',
            strokeWidth: 20,
            blur: 15,
            opacity: 0.5,
            blendMode: 'normal'
        };

        this.createToolbar();

        // SVGMainToolbar の toolMap に AirbrushTool を動的に登録する
        this._registerTool();
    }

    /**
     * AirbrushTool を SVGMainToolbar の toolMap へ動的に登録する
     */
    _registerTool() {
        if (this.svgToolbar && this.svgToolbar.toolMap && typeof BaseTool !== 'undefined') {
            this.svgToolbar.toolMap['airbrush'] = new AirbrushTool(this.svgToolbar);
            // toolDefaults も追加
            if (this.svgToolbar.toolDefaults) {
                this.svgToolbar.toolDefaults['airbrush'] = { stroke: '#ff007f', 'stroke-width': 20 };
            }
        }
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-airbrush-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';
        contentArea.style.display = 'flex';
        contentArea.style.alignItems = 'center';
        contentArea.style.gap = '4px';
        contentArea.style.flexWrap = 'wrap';

        // 1. エアブラシ有効化ボタン（トグル）
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.title = 'エアブラシモード ON/OFF';
        this.toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="8" cy="16" r="5" opacity="0.4"/>
                <circle cx="12" cy="12" r="5" opacity="0.5"/>
                <circle cx="16" cy="8" r="5" opacity="0.6"/>
                <path d="M18 2l4 4-10 10-4 0 0-4z"/>
            </svg>
        `;
        this.toggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleAirbrushMode();
        };
        contentArea.appendChild(this.toggleBtn);

        // 区切り線
        contentArea.appendChild(this._createSeparator());

        // 2. カラーボタン
        this.colorBtn = document.createElement('div');
        this.colorBtn.title = '描画色';
        this.colorBtn.style.cssText = `
            width: 18px; height: 18px;
            background-color: ${this.params.color};
            border: 1px solid #999;
            border-radius: 3px;
            cursor: pointer;
            flex-shrink: 0;
        `;
        this.colorBtn.onclick = (e) => {
            e.stopPropagation();
            this._showColorPicker(e);
        };
        contentArea.appendChild(this.colorBtn);

        // 区切り線
        contentArea.appendChild(this._createSeparator());

        // 3. 太さスライダー
        const widthContainer = this._createSliderGroup('太さ:', 1, 100, 1, this.params.strokeWidth, 'px', (val) => {
            this.params.strokeWidth = val;
            this.applyToSelection();
        });
        this.widthSlider = widthContainer.querySelector('input');
        this.widthValueLabel = widthContainer.querySelector('.airbrush-slider-value');
        contentArea.appendChild(widthContainer);

        // 区切り線
        contentArea.appendChild(this._createSeparator());

        // 4. ぼかしスライダー
        const blurContainer = this._createSliderGroup('ぼかし:', 0, 50, 1, this.params.blur, 'px', (val) => {
            this.params.blur = val;
            this.applyToSelection();
        });
        this.blurSlider = blurContainer.querySelector('input');
        this.blurValueLabel = blurContainer.querySelector('.airbrush-slider-value');
        contentArea.appendChild(blurContainer);

        // 区切り線
        contentArea.appendChild(this._createSeparator());

        // 5. 不透明度スライダー
        const opacityContainer = this._createSliderGroup('不透明度:', 0.05, 1.0, 0.05, this.params.opacity, '', (val) => {
            this.params.opacity = parseFloat(val);
            this.applyToSelection();
        });
        this.opacitySlider = opacityContainer.querySelector('input');
        this.opacityValueLabel = opacityContainer.querySelector('.airbrush-slider-value');
        contentArea.appendChild(opacityContainer);

        // 区切り線
        contentArea.appendChild(this._createSeparator());

        // 6. ブレンドモードセレクト
        const blendContainer = document.createElement('div');
        blendContainer.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#666;';

        const blendLabel = document.createElement('span');
        blendLabel.textContent = '合成:';
        blendContainer.appendChild(blendLabel);

        this.blendSelect = document.createElement('select');
        this.blendSelect.style.cssText = 'padding:1px 2px;font-size:11px;border:1px solid #ccc;border-radius:3px;background:#fff;';
        const modes = [
            { value: 'normal', label: '通常' },
            { value: 'multiply', label: '乗算' },
            { value: 'screen', label: 'スクリーン' },
            { value: 'overlay', label: 'オーバーレイ' },
            { value: 'darken', label: '暗く' },
            { value: 'lighten', label: '明るく' }
        ];
        modes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.textContent = m.label;
            this.blendSelect.appendChild(opt);
        });
        this.blendSelect.value = this.params.blendMode;
        this.blendSelect.onchange = (e) => {
            e.stopPropagation();
            this.params.blendMode = e.target.value;
            this.applyToSelection();
        };
        blendContainer.appendChild(this.blendSelect);
        contentArea.appendChild(blendContainer);
    }

    /**
     * スライダーグループのヘルパー
     */
    _createSliderGroup(label, min, max, step, value, unit, onChange) {
        const container = document.createElement('div');
        container.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#666;';

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        container.appendChild(labelEl);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.style.width = '60px';
        container.appendChild(slider);

        const valueLabel = document.createElement('span');
        valueLabel.className = 'airbrush-slider-value';
        valueLabel.style.width = '30px';
        valueLabel.style.textAlign = 'right';
        valueLabel.textContent = `${value}${unit}`;
        container.appendChild(valueLabel);

        slider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            valueLabel.textContent = `${step < 1 ? val.toFixed(2) : val}${unit}`;
            onChange(val);
        };

        return container;
    }

    /**
     * 区切り線ヘルパー
     */
    _createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    /**
     * エアブラシモードの切り替え
     */
    toggleAirbrushMode() {
        if (this.svgToolbar && this.svgToolbar.currentTool === 'airbrush') {
            // 既にエアブラシモード → 選択モードに戻す
            this.svgToolbar.setTool('select');
            this.toggleBtn.classList.remove('active');
        } else if (this.svgToolbar) {
            // エアブラシモードに切り替え
            this.svgToolbar.setTool('airbrush');
            this.toggleBtn.classList.add('active');
        }
    }

    /**
     * メインツールバーのツール切り替え時に呼ばれるフック
     * エアブラシ以外のツールが選択されたらトグルを解除する
     */
    onToolChanged(toolId) {
        if (this.toggleBtn) {
            if (toolId === 'airbrush') {
                this.toggleBtn.classList.add('active');
            } else {
                this.toggleBtn.classList.remove('active');
            }
        }
    }

    /**
     * カラーピッカーの表示
     */
    _showColorPicker(e) {
        if (this._activeColorPicker) {
            try { this._activeColorPicker.destroy(); } catch (err) {}
        }

        if (typeof ColorPickerUI === 'undefined') return;

        this._activeColorPicker = new ColorPickerUI({
            color: this.params.color,
            isPopup: true,
            skipInitialChange: true,
            onChange: (color) => {
                const hex = typeof color.toHexString === 'function' ? color.toHexString(true) : color;
                this.params.color = hex;
                this.colorBtn.style.backgroundColor = hex;
                this.applyToSelection();
            }
        });
        this._activeColorPicker.show(this.colorBtn);
    }

    /**
     * 現在のパラメータを取得
     */
    getParams() {
        return { ...this.params };
    }

    /**
     * <defs> 内にガウスブラーフィルターを確保・再利用する
     * @param {SVG.Doc} draw - SVG.js のドローイングインスタンス
     * @param {number} stdDev - ぼかし量 (stdDeviation)
     * @returns {string} フィルターID
     */
    ensureFilter(draw, stdDev) {
        if (stdDev <= 0) return null;

        const filterId = `airbrush-blur-${stdDev}`;
        const svgNode = draw.node;
        
        // <defs> を取得または作成
        let defs = svgNode.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgNode.insertBefore(defs, svgNode.firstChild);
        }

        let filter = svgNode.querySelector(`#${filterId}`);
        if (!filter) {
            // <filter> を作成
            // filterUnits="userSpaceOnUse" を使い、SVG座標系の絶対値で領域を指定する
            // 割合ベース（objectBoundingBox）では真横・真縦の線でバウンディングボックスの
            // 高さ/幅がほぼ0になり、フィルター領域が消失してクリッピングが発生するため
            filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', filterId);
            filter.setAttribute('filterUnits', 'userSpaceOnUse');

            // <feGaussianBlur> を作成
            const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
            blur.setAttribute('stdDeviation', stdDev);
            blur.setAttribute('result', 'blur');
            filter.appendChild(blur);

            defs.appendChild(filter);
        }

        // [FIX] すでにフィルターが存在する場合でも、パン・ズーム移動後にクリッピングが
        // 発生しないように、現在の viewBox に基づいてフィルター領域を動的に更新する。
        // さらに、異なるぼかし量で過去に描画された既存の線もパン移動後に消えないように、
        // SVG内にあるすべてのエアブラシ用フィルター領域を最新の viewBox に合わせて一括更新する。
        // マージンも 5000px と十分広く取ることで、急激なパン移動によるクリッピングを防ぎます。
        const vb = svgNode.viewBox.baseVal;
        const margin = 5000; 
        const x = (vb.x || 0) - margin;
        const y = (vb.y || 0) - margin;
        const w = (vb.width || svgNode.clientWidth || 820) + margin * 2;
        const h = (vb.height || svgNode.clientHeight || 600) + margin * 2;

        const allFilters = svgNode.querySelectorAll('filter[id^="airbrush-blur-"]');
        allFilters.forEach(f => {
            f.setAttribute('x', x);
            f.setAttribute('y', y);
            f.setAttribute('width', w);
            f.setAttribute('height', h);
        });

        return filterId;
    }

    /**
     * 選択中の要素に現在のUIパラメータを適用する
     */
    applyToSelection() {
        if (!window.currentEditingSVG) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements || []);
        if (selected.length === 0) return;

        const draw = window.currentEditingSVG.draw;
        if (!draw) return;

        selected.forEach(el => {
            // キャンバスプロキシは除外
            if (el.hasClass('svg-canvas-proxy')) return;

            const tagName = el.node.tagName.toLowerCase();
            // パス系要素（path, polyline, line, circle, ellipse, rect）のみ対象
            if (!['path', 'polyline', 'line', 'circle', 'ellipse', 'rect', 'polygon'].includes(tagName)) return;

            // ストローク色
            el.stroke({ color: this.params.color, width: this.params.strokeWidth });
            el.attr('stroke-linecap', 'round');
            el.attr('stroke-linejoin', 'round');

            // 不透明度
            el.attr('opacity', this.params.opacity);

            // ぼかしフィルター
            if (this.params.blur > 0) {
                const filterId = this.ensureFilter(draw, this.params.blur);
                if (filterId) {
                    el.attr('filter', `url(#${filterId})`);
                }
            } else {
                el.attr('filter', null);
            }

            // ブレンドモード
            if (this.params.blendMode && this.params.blendMode !== 'normal') {
                el.node.style.mixBlendMode = this.params.blendMode;
            } else {
                el.node.style.mixBlendMode = '';
            }

            // data-tool-id をエアブラシに更新（識別用）
            el.attr('data-tool-id', 'airbrush');
        });

        if (window.syncChanges) window.syncChanges();
    }

    /**
     * 選択要素からパラメータを読み取ってUI（リバースシンク）を更新する
     */
    updateFromSelection() {
        if (!window.currentEditingSVG) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements || []);
        if (selected.length === 0) return;

        // 最初の選択要素からパラメータを読み取る
        const el = selected[0];
        if (!el || !el.node) return;

        // キャンバスプロキシは除外
        if (el.hasClass('svg-canvas-proxy')) return;

        // ストローク色
        const strokeColor = el.node.style.stroke || el.attr('stroke');
        if (strokeColor && strokeColor !== 'none') {
            this.params.color = strokeColor;
            if (this.colorBtn) this.colorBtn.style.backgroundColor = strokeColor;
        }

        // ストローク幅
        const sw = parseFloat(el.attr('stroke-width'));
        if (!isNaN(sw) && sw > 0) {
            this.params.strokeWidth = sw;
            if (this.widthSlider) {
                this.widthSlider.value = sw;
                this.widthValueLabel.textContent = `${sw}px`;
            }
        }

        // 不透明度
        const opacity = parseFloat(el.attr('opacity'));
        if (!isNaN(opacity)) {
            this.params.opacity = opacity;
            if (this.opacitySlider) {
                this.opacitySlider.value = opacity;
                this.opacityValueLabel.textContent = opacity.toFixed(2);
            }
        }

        // フィルターからぼかし量を逆算
        const filterAttr = el.attr('filter');
        if (filterAttr) {
            const match = filterAttr.match(/url\(#airbrush-blur-(\d+)\)/);
            if (match) {
                const blurVal = parseInt(match[1], 10);
                this.params.blur = blurVal;
                if (this.blurSlider) {
                    this.blurSlider.value = blurVal;
                    this.blurValueLabel.textContent = `${blurVal}px`;
                }
            } else {
                // 他のフィルター → defs から直接 stdDeviation を読む
                const filterId = filterAttr.replace(/url\(#([^)]+)\)/, '$1');
                if (filterId && window.currentEditingSVG.draw) {
                    const filterNode = window.currentEditingSVG.draw.node.querySelector(`#${filterId}`);
                    if (filterNode) {
                        const blurNode = filterNode.querySelector('feGaussianBlur');
                        if (blurNode) {
                            const std = parseFloat(blurNode.getAttribute('stdDeviation'));
                            if (!isNaN(std)) {
                                this.params.blur = std;
                                if (this.blurSlider) {
                                    this.blurSlider.value = std;
                                    this.blurValueLabel.textContent = `${std}px`;
                                }
                            }
                        }
                    }
                }
            }
        } else {
            this.params.blur = 0;
            if (this.blurSlider) {
                this.blurSlider.value = 0;
                this.blurValueLabel.textContent = '0px';
            }
        }

        // ブレンドモード
        const blendMode = el.node.style.mixBlendMode || 'normal';
        this.params.blendMode = blendMode;
        if (this.blendSelect) {
            this.blendSelect.value = blendMode;
        }
    }

    /**
     * ツールバーを表示する
     */
    show() {
        if (this.toolbarElement) this.toolbarElement.style.display = 'flex';
    }

    /**
     * ツールバーを非表示にする
     */
    hide() {
        if (this.toolbarElement) this.toolbarElement.style.display = 'none';
    }

    /**
     * ツールバーを破棄する
     */
    destroy() {
        // toolMap から登録解除
        if (this.svgToolbar && this.svgToolbar.toolMap) {
            delete this.svgToolbar.toolMap['airbrush'];
        }
        if (this.svgToolbar && this.svgToolbar.toolDefaults) {
            delete this.svgToolbar.toolDefaults['airbrush'];
        }

        if (this._activeColorPicker) {
            try { this._activeColorPicker.destroy(); } catch (e) {}
            this._activeColorPicker = null;
        }
        if (this.toolbarElement) {
            this.toolbarElement.remove();
        }
    }
}

/**
 * ファクトリ関数（他ツールバーと同一パターン）
 */
window.createAirbrushToolbar = (container, svgToolbar, options) => {
    return new SVGAirbrushToolbar(container, svgToolbar, options);
};
