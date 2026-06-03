/**
 * SVG Shadow Toolbar
 * 選択したSVG要素に対して、カスタマイズ可能な影効果（ドロップシャドウ/インナーシャドウ）を設定・編集するツールバー
 */
class SVGShadowToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-shadow-toolbar',
            container: container,
            borderColor: options.borderColor || '#9C27B0',
            position: options.position || { top: '470px', left: '-37px' }
        });
        this.svgToolbar = svgToolbar;
        this.container = container;

        // 影のパラメータ初期値
        this.params = {
            enabled: false,
            blur: 4,
            color: '#000000',
            opacity: 0.5,
            spread: 0,
            inner: false,
            angle: 135,
            distance: 6,
            blendMode: 'normal'
        };

        this.isExpanded = false;
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
        this.toolbarElement.classList.add('svg-shadow-toolbar');

        // メイン行と展開エリアを含む全体のレイアウトを縦方向に変更可能にする
        this.contentArea.style.flexDirection = 'column';
        this.contentArea.style.alignItems = 'stretch';
        this.contentArea.style.gap = '0px';

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        // 1. メイン行 (基本設定)
        const mainRow = document.createElement('div');
        mainRow.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;';

        // 1-1. シャドウ有効化ボタン (トグル)
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.title = '影効果 ON/OFF';
        this.toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                <rect x="9" y="9" width="12" height="12" rx="2" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-dasharray="2,2"/>
            </svg>
        `;
        this.toggleBtn.style.cssText = 'padding: 2px 6px; cursor: pointer; display:flex; align-items:center;';
        this.toggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.params.enabled = !this.params.enabled;
            this.updateToggleButtonState();
            this.applyToSelection();
        };
        mainRow.appendChild(this.toggleBtn);

        // 区切り線
        mainRow.appendChild(this._createSeparator());

        // 1-2. ぼかし半径スライダー
        const blurContainer = this._createSliderGroup('ぼかし:', 0, 50, 1, this.params.blur, 'px', 'shadow-blur-val', (val) => {
            this.params.blur = val;
            this.applyToSelection();
        });
        this.blurSlider = blurContainer.querySelector('input');
        this.blurValueLabel = blurContainer.querySelector('.shadow-slider-value');
        mainRow.appendChild(blurContainer);

        // 区切り線
        mainRow.appendChild(this._createSeparator());

        // 1-3. 影の色ボタン (カラーピッカー)
        const colorLabel = document.createElement('span');
        colorLabel.textContent = '色:';
        colorLabel.style.cssText = 'font-size:11px;color:#666;';
        mainRow.appendChild(colorLabel);

        this.colorBtn = document.createElement('div');
        this.colorBtn.title = '影の色';
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
        mainRow.appendChild(this.colorBtn);

        // 区切り線
        mainRow.appendChild(this._createSeparator());

        // 1-4. 不透明度スライダー
        const opacityContainer = this._createSliderGroup('透明度:', 0.0, 1.0, 0.05, this.params.opacity, '', 'shadow-opacity-val', (val) => {
            this.params.opacity = parseFloat(val);
            this.applyToSelection();
        });
        this.opacitySlider = opacityContainer.querySelector('input');
        this.opacityValueLabel = opacityContainer.querySelector('.shadow-slider-value');
        mainRow.appendChild(opacityContainer);

        // 区切り線
        mainRow.appendChild(this._createSeparator());

        // 1-5. 展開ボタン (▼/▲)
        this.expandBtn = document.createElement('button');
        this.expandBtn.innerHTML = '▼';
        this.expandBtn.title = '詳細設定を展開/折りたたむ';
        this.expandBtn.style.cssText = `
            background: transparent; border: none; color: var(--svg-toolbar-fg); cursor: pointer; padding: 0 4px;
            font-size: 10px; border-radius: 3px; margin-left: auto; height: 20px; opacity: 0.6;
        `;
        this.expandBtn.onclick = (e) => {
            e.stopPropagation();
            this.isExpanded = !this.isExpanded;
            this.updateExpandState();
        };
        mainRow.appendChild(this.expandBtn);

        contentArea.appendChild(mainRow);

        // 2. 展開エリア (拡張パラメータ)
        this.expandArea = document.createElement('div');
        this.expandArea.style.cssText = `
            display: none;
            flex-direction: column;
            gap: 6px;
            margin-top: 6px;
            border-top: 1px solid var(--svg-toolbar-border, #eee);
            padding-top: 6px;
            padding-bottom: 2px;
        `;

        // 2-1. 拡張パラメータ行1: スプレッド & インナーシャドウ
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;align-items:center;gap:8px;white-space:nowrap;';

        // スプレッドスライダー
        const spreadContainer = this._createSliderGroup('拡散:', -20, 50, 1, this.params.spread, 'px', 'shadow-spread-val', (val) => {
            this.params.spread = val;
            this.applyToSelection();
        });
        this.spreadSlider = spreadContainer.querySelector('input');
        this.spreadValueLabel = spreadContainer.querySelector('.shadow-slider-value');
        row1.appendChild(spreadContainer);

        // 区切り線
        row1.appendChild(this._createSeparator());

        // インナーシャドウ トグル
        const innerContainer = document.createElement('div');
        innerContainer.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:#666;';
        
        const innerLabel = document.createElement('span');
        innerLabel.textContent = '内側:';
        innerContainer.appendChild(innerLabel);

        this.innerCheckbox = document.createElement('input');
        this.innerCheckbox.type = 'checkbox';
        this.innerCheckbox.checked = this.params.inner;
        this.innerCheckbox.style.cssText = 'cursor:pointer;';
        this.innerCheckbox.onchange = (e) => {
            e.stopPropagation();
            this.params.inner = e.target.checked;
            this.applyToSelection();
        };
        innerContainer.appendChild(this.innerCheckbox);
        row1.appendChild(innerContainer);

        this.expandArea.appendChild(row1);

        // 2-2. 拡張パラメータ行2: 角度 & 距離 & ブレンドモード
        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex;align-items:center;gap:8px;white-space:nowrap;margin-top:4px;';

        // 角度スライダー
        const angleContainer = this._createSliderGroup('角度:', 0, 360, 5, this.params.angle, '°', 'shadow-angle-val', (val) => {
            this.params.angle = val;
            this.applyToSelection();
        });
        this.angleSlider = angleContainer.querySelector('input');
        this.angleValueLabel = angleContainer.querySelector('.shadow-slider-value');
        row2.appendChild(angleContainer);

        // 区切り線
        row2.appendChild(this._createSeparator());

        // 距離スライダー
        const distanceContainer = this._createSliderGroup('距離:', 0, 50, 1, this.params.distance, 'px', 'shadow-distance-val', (val) => {
            this.params.distance = val;
            this.applyToSelection();
        });
        this.distanceSlider = distanceContainer.querySelector('input');
        this.distanceValueLabel = distanceContainer.querySelector('.shadow-slider-value');
        row2.appendChild(distanceContainer);

        // 区切り線
        row2.appendChild(this._createSeparator());

        // ブレンドモード
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
            { value: 'overlay', label: 'オーバーレイ' }
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
        row2.appendChild(blendContainer);

        this.expandArea.appendChild(row2);
        contentArea.appendChild(this.expandArea);

        this.updateToggleButtonState();
    }

    _createSliderGroup(label, min, max, step, value, unit, valueClass, onChange) {
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
        valueLabel.className = `shadow-slider-value ${valueClass}`;
        valueLabel.style.width = '32px';
        valueLabel.style.textAlign = 'right';
        valueLabel.textContent = `${value}${unit}`;
        container.appendChild(valueLabel);

        slider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            valueLabel.textContent = `${step < 0.1 ? val.toFixed(2) : val}${unit}`;
            onChange(val);
        };

        return container;
    }

    _createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        sep.style.cssText = 'width:1px; height:18px; background:#ddd; margin:0 4px; flex-shrink:0;';
        return sep;
    }

    updateExpandState() {
        if (!this.expandBtn || !this.expandArea) return;
        if (this.isExpanded) {
            this.expandBtn.innerHTML = '▲';
            this.expandArea.style.display = 'flex';
        } else {
            this.expandBtn.innerHTML = '▼';
            this.expandArea.style.display = 'none';
        }
    }

    updateToggleButtonState() {
        if (!this.toggleBtn) return;
        if (this.params.enabled) {
            this.toggleBtn.classList.add('active');
        } else {
            this.toggleBtn.classList.remove('active');
        }
    }

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
     * <defs> 内にシャドウフィルターを確保・更新する
     * @param {SVG.Doc} draw - SVG.js の描画インスタンス
     * @param {object} params - 影パラメータ
     * @returns {string} フィルターID
     */
    ensureFilter(draw, params) {
        if (!params.enabled) return null;

        // パラメータを組み合わせたユニークなIDを作成
        const colorHex = params.color.replace('#', '');
        const opacityStr = String(params.opacity).replace('.', '_');
        const innerVal = params.inner ? '1' : '0';
        const filterId = `svg-shadow-b${params.blur}-c${colorHex}-o${opacityStr}-s${params.spread}-i${innerVal}-a${params.angle}-d${params.distance}-m${params.blendMode}`;

        const svgNode = draw.node;
        let defs = svgNode.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgNode.insertBefore(defs, svgNode.firstChild);
        }

        // ID検索時に特殊文字や重複が発生しても安全なように、defs直下の属性セレクターで検索する
        let filter = defs.querySelector(`filter[id="${filterId}"]`);
        if (!filter) {
            filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', filterId);
            filter.setAttribute('filterUnits', 'userSpaceOnUse');

            // 極座標 (angle, distance) から dx, dy を算出
            const angleRad = (params.angle * Math.PI) / 180;
            const dx = params.distance * Math.cos(angleRad);
            const dy = params.distance * Math.sin(angleRad);

            if (params.inner) {
                // インナーシャドウ（内側の影）の構成

                // 1. feMorphology (スプレッド)
                let lastIn = 'SourceAlpha';
                if (params.spread !== 0) {
                    const morph = document.createElementNS('http://www.w3.org/2000/svg', 'feMorphology');
                    morph.setAttribute('in', 'SourceAlpha');
                    morph.setAttribute('operator', params.spread > 0 ? 'dilate' : 'erode');
                    morph.setAttribute('radius', Math.abs(params.spread));
                    morph.setAttribute('result', 'morphed');
                    filter.appendChild(morph);
                    lastIn = 'morphed';
                }

                // 2. feOffset
                const offset = document.createElementNS('http://www.w3.org/2000/svg', 'feOffset');
                offset.setAttribute('in', lastIn);
                offset.setAttribute('dx', dx);
                offset.setAttribute('dy', dy);
                offset.setAttribute('result', 'offset');
                filter.appendChild(offset);

                // 3. feComposite (SourceAlpha と offset の out) -> 内側の未交差部分
                const compositeOut = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
                compositeOut.setAttribute('in', 'SourceAlpha');
                compositeOut.setAttribute('in2', 'offset');
                compositeOut.setAttribute('operator', 'out');
                compositeOut.setAttribute('result', 'inverse');
                filter.appendChild(compositeOut);

                // 4. feGaussianBlur (ぼかし)
                const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
                blur.setAttribute('in', 'inverse');
                blur.setAttribute('stdDeviation', params.blur);
                blur.setAttribute('result', 'blurred');
                filter.appendChild(blur);

                // 5. feComposite (SourceAlpha で in クリップ) -> 外側へのぼかし漏れ防止
                const compositeIn = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
                compositeIn.setAttribute('in', 'blurred');
                compositeIn.setAttribute('in2', 'SourceAlpha');
                compositeIn.setAttribute('operator', 'in');
                compositeIn.setAttribute('result', 'clipped');
                filter.appendChild(compositeIn);

                // 6. feFlood (影の色・透明度)
                const flood = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
                flood.setAttribute('flood-color', params.color);
                flood.setAttribute('flood-opacity', params.opacity);
                flood.setAttribute('result', 'flood');
                filter.appendChild(flood);

                // 7. feComposite (flood と clipped の重なり)
                const compositeShadow = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
                compositeShadow.setAttribute('in', 'flood');
                compositeShadow.setAttribute('in2', 'clipped');
                compositeShadow.setAttribute('operator', 'in');
                compositeShadow.setAttribute('result', 'coloredShadow');
                filter.appendChild(compositeShadow);

                // 8. feBlend (元画像の上にブレンド合成)
                const blend = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
                blend.setAttribute('in', 'coloredShadow');
                blend.setAttribute('in2', 'SourceGraphic');
                blend.setAttribute('mode', params.blendMode);
                filter.appendChild(blend);

            } else {
                // アウターシャドウ（通常のドロップシャドウ）の構成

                // 1. feMorphology (スプレッド)
                let lastIn = 'SourceAlpha';
                if (params.spread !== 0) {
                    const morph = document.createElementNS('http://www.w3.org/2000/svg', 'feMorphology');
                    morph.setAttribute('in', 'SourceAlpha');
                    morph.setAttribute('operator', params.spread > 0 ? 'dilate' : 'erode');
                    morph.setAttribute('radius', Math.abs(params.spread));
                    morph.setAttribute('result', 'morphed');
                    filter.appendChild(morph);
                    lastIn = 'morphed';
                }

                // 2. feOffset
                const offset = document.createElementNS('http://www.w3.org/2000/svg', 'feOffset');
                offset.setAttribute('in', lastIn);
                offset.setAttribute('dx', dx);
                offset.setAttribute('dy', dy);
                offset.setAttribute('result', 'offset');
                filter.appendChild(offset);

                // 3. feGaussianBlur (ぼかし)
                const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
                blur.setAttribute('in', 'offset');
                blur.setAttribute('stdDeviation', params.blur);
                blur.setAttribute('result', 'blurred');
                filter.appendChild(blur);

                // 4. feFlood (影の色・透明度)
                const flood = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood');
                flood.setAttribute('flood-color', params.color);
                flood.setAttribute('flood-opacity', params.opacity);
                flood.setAttribute('result', 'flood');
                filter.appendChild(flood);

                // 5. feComposite
                const compositeShadow = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
                compositeShadow.setAttribute('in', 'flood');
                compositeShadow.setAttribute('in2', 'blurred');
                compositeShadow.setAttribute('operator', 'in');
                compositeShadow.setAttribute('result', 'coloredShadow');
                filter.appendChild(compositeShadow);

                // 6. feBlend (影の上に元画像を重ねる。in2が背景側である影)
                const blend = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
                blend.setAttribute('in', 'SourceGraphic');
                blend.setAttribute('in2', 'coloredShadow');
                blend.setAttribute('mode', params.blendMode);
                filter.appendChild(blend);
            }

            defs.appendChild(filter);
        }

        // パン・ズーム操作で影が切れないようにフィルター領域（x, y, width, height）を
        // ビューボックスに基づいて十分広く確保する
        const vb = svgNode.viewBox.baseVal;
        const margin = 5000;
        const x = (vb.x || 0) - margin;
        const y = (vb.y || 0) - margin;
        const w = (vb.width || svgNode.clientWidth || 820) + margin * 2;
        const h = (vb.height || svgNode.clientHeight || 600) + margin * 2;

        const allFilters = svgNode.querySelectorAll('filter[id^="svg-shadow-"]');
        allFilters.forEach(f => {
            f.setAttribute('x', x);
            f.setAttribute('y', y);
            f.setAttribute('width', w);
            f.setAttribute('height', h);
        });

        return filterId;
    }

    /**
     * 使用されていないシャドウフィルターを <defs> からクリーンアップする
     */
    cleanupUnusedFilters(draw) {
        const svgNode = draw.node;
        const usedFilterIds = new Set();

        // defs以外の要素を探索し、適用されているフィルターIDを収集
        // 処理をより安全かつシンプルにするため、すべての要素を走査し、タグ名でフィルタリングする
        const elements = svgNode.querySelectorAll('*');
        const skipTags = new Set(['defs', 'filter', 'fegaussianblur', 'feoffset', 'femorphology', 'fecomposite', 'feflood', 'feblend']);
        elements.forEach(el => {
            const tagName = el.tagName.toLowerCase();
            if (skipTags.has(tagName)) return;

            const filterAttr = el.getAttribute('filter');
            if (filterAttr) {
                // url(#id) または url("#id") または url('#id') に対応
                const match = filterAttr.match(/url\(['"]?#([^'"]+?)['"]?\)/);
                if (match) {
                    usedFilterIds.add(match[1]);
                }
            }
        });

        // 既に保持したフィルターIDを記録し、重複したフィルターを排除する
        const keptFilterIds = new Set();

        // シャドウフィルターのうち、現在使用されていないもの、またはすでに重複しているものを削除
        const allShadowFilters = svgNode.querySelectorAll('filter[id^="svg-shadow-"]');
        allShadowFilters.forEach(filter => {
            const id = filter.getAttribute('id');
            if (!usedFilterIds.has(id) || keptFilterIds.has(id)) {
                filter.remove();
            } else {
                keptFilterIds.add(id);
            }
        });
    }

    /**
     * 選択要素に現在のシャドウ設定を適用する
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
            // パス系要素およびグループを対象とする
            if (!['path', 'polyline', 'line', 'circle', 'ellipse', 'rect', 'polygon', 'g', 'text'].includes(tagName)) return;

            if (this.params.enabled) {
                const filterId = this.ensureFilter(draw, this.params);
                if (filterId) {
                    el.attr('filter', `url(#${filterId})`);
                }
                // 不要になったデータ属性を削除（既存の古い属性のクリーンアップ）
                el.attr({
                    'data-shadow-enabled': null,
                    'data-shadow-blur': null,
                    'data-shadow-color': null,
                    'data-shadow-opacity': null,
                    'data-shadow-spread': null,
                    'data-shadow-inner': null,
                    'data-shadow-angle': null,
                    'data-shadow-distance': null,
                    'data-shadow-blend': null
                });
            } else {
                // 影無効化
                el.attr('filter', null);
                // 既存の古い属性があれば削除
                el.attr({
                    'data-shadow-enabled': null,
                    'data-shadow-blur': null,
                    'data-shadow-color': null,
                    'data-shadow-opacity': null,
                    'data-shadow-spread': null,
                    'data-shadow-inner': null,
                    'data-shadow-angle': null,
                    'data-shadow-distance': null,
                    'data-shadow-blend': null
                });
            }
        });

        // 未使用フィルターを即時クリーンアップ
        this.cleanupUnusedFilters(draw);

        if (window.currentEditingSVG.pushUndoState) window.currentEditingSVG.pushUndoState();
        if (window.syncChanges) window.syncChanges();
    }

    /**
     * 選択された要素からパラメータを読み込み、UIに反映する（リバースシンク）
     */
    updateFromSelection() {
        if (!window.currentEditingSVG) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements || []);

        const draw = window.currentEditingSVG.draw;
        if (draw) {
            this.cleanupUnusedFilters(draw);
        }

        if (selected.length === 0) {
            this.params.enabled = false;
            this.updateUIValues();
            return;
        }

        const el = selected[0];
        if (!el || !el.node || el.hasClass('svg-canvas-proxy')) {
            this.params.enabled = false;
            this.updateUIValues();
            return;
        }

        // filter 属性の有無とID形式の解析を試みる
        const filterAttr = el.attr('filter');
        let parsedParams = null;
        let shadowEnabled = false;

        if (filterAttr) {
            // url(#id) や url("#id") に対応
            const match = filterAttr.match(/url\(['"]?#([^'"]+?)['"]?\)/);
            if (match) {
                const filterId = match[1];
                // 正規表現でパラメータをパース
                // svg-shadow-b4-c000000-o0_5-s0-i0-a135-d6-mnormal
                const idRegex = /^svg-shadow-b([\d.]+)-c([0-9a-fA-F]{6})-o([\d_]+)-s(-?[\d.]+)-i([01])-a([\d.]+)-d([\d.]+)-m([a-z]+)$/;
                const idMatch = filterId.match(idRegex);
                if (idMatch) {
                    shadowEnabled = true;
                    parsedParams = {
                        enabled: true,
                        blur: parseFloat(idMatch[1]),
                        color: '#' + idMatch[2],
                        opacity: parseFloat(idMatch[3].replace('_', '.')),
                        spread: parseFloat(idMatch[4]),
                        inner: idMatch[5] === '1',
                        angle: parseFloat(idMatch[6]),
                        distance: parseFloat(idMatch[7]),
                        blendMode: idMatch[8]
                    };
                }
            }
        }

        // フォールバック：古い data-shadow-* 属性が存在するか確認
        if (!parsedParams) {
            const hasLegacyAttr = el.attr('data-shadow-enabled') !== undefined;
            if (hasLegacyAttr) {
                const legacyEnabled = el.attr('data-shadow-enabled') === 'true';
                shadowEnabled = legacyEnabled;
                if (legacyEnabled) {
                    parsedParams = {
                        enabled: true,
                        blur: el.attr('data-shadow-blur') !== undefined ? parseFloat(el.attr('data-shadow-blur')) : 4,
                        color: el.attr('data-shadow-color') || '#000000',
                        opacity: el.attr('data-shadow-opacity') !== undefined ? parseFloat(el.attr('data-shadow-opacity')) : 0.5,
                        spread: el.attr('data-shadow-spread') !== undefined ? parseFloat(el.attr('data-shadow-spread')) : 0,
                        inner: el.attr('data-shadow-inner') === 'true',
                        angle: el.attr('data-shadow-angle') !== undefined ? parseFloat(el.attr('data-shadow-angle')) : 135,
                        distance: el.attr('data-shadow-distance') !== undefined ? parseFloat(el.attr('data-shadow-distance')) : 6,
                        blendMode: el.attr('data-shadow-blend') || 'normal'
                    };
                }
            }
        }

        this.params.enabled = shadowEnabled;
        if (parsedParams) {
            this.params.blur = parsedParams.blur;
            this.params.color = parsedParams.color;
            this.params.opacity = parsedParams.opacity;
            this.params.spread = parsedParams.spread;
            this.params.inner = parsedParams.inner;
            this.params.angle = parsedParams.angle;
            this.params.distance = parsedParams.distance;
            this.params.blendMode = parsedParams.blendMode;
        }

        this.updateUIValues();
    }

    /**
     * UIパーツの表示値を現在の params に同期する
     */
    updateUIValues() {
        this.updateToggleButtonState();

        if (this.blurSlider) {
            this.blurSlider.value = this.params.blur;
            this.blurValueLabel.textContent = `${this.params.blur}px`;
        }

        if (this.colorBtn) {
            this.colorBtn.style.backgroundColor = this.params.color;
        }

        if (this.opacitySlider) {
            this.opacitySlider.value = this.params.opacity;
            this.opacityValueLabel.textContent = this.params.opacity.toFixed(2);
        }

        if (this.spreadSlider) {
            this.spreadSlider.value = this.params.spread;
            this.spreadValueLabel.textContent = `${this.params.spread}px`;
        }

        if (this.innerCheckbox) {
            this.innerCheckbox.checked = this.params.inner;
        }

        if (this.angleSlider) {
            this.angleSlider.value = this.params.angle;
            this.angleValueLabel.textContent = `${this.params.angle}°`;
        }

        if (this.distanceSlider) {
            this.distanceSlider.value = this.params.distance;
            this.distanceValueLabel.textContent = `${this.params.distance}px`;
        }

        if (this.blendSelect) {
            this.blendSelect.value = this.params.blendMode;
        }
    }

    show() {
        if (this.toolbarElement) this.toolbarElement.style.display = 'flex';
    }

    hide() {
        if (this.toolbarElement) this.toolbarElement.style.display = 'none';
    }

    destroy() {
        if (this._activeColorPicker) {
            try { this._activeColorPicker.destroy(); } catch (e) {}
            this._activeColorPicker = null;
        }
        if (this.toolbarElement) {
            this.toolbarElement.remove();
        }
    }
}

// グローバルファクトリ関数
window.createShadowToolbar = (container, svgToolbar, options) => {
    return new SVGShadowToolbar(container, svgToolbar, options);
};
