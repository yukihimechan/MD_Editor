/**
 * ColorPicker Library
 * 依存ライブラリなしのVanilla JSカラーピッカー
 */
(function (global) {

    // -------------------------------------------------------------
    // 色の変換ロジックを担当するクラス
    // -------------------------------------------------------------
    class Color {
        constructor(color = '#000000FF') {
            // 内部状態は HSVA で管理
            this.h = 0; // 0-360
            this.s = 0; // 0-100
            this.v = 0; // 0-100
            this.a = 1; // 0-1

            this.parse(color);
        }

        parse(color) {
            if (typeof color === 'string') {
                color = color.trim().toLowerCase();
                // RGB / RGBA / HSL / HSLA (Prefix check removed to allow flexible input in HEX field)
                if (color.startsWith('rgb')) {
                    const match = color.match(/rgba?\(\s*([\d.%]+)[\s,]+([\d.%]+)[\s,]+([\d.%]+)(?:[\s,/]+([\d.%]+))?\s*\)/);
                    if (match) {
                        const parseComp = (val, max) => val.endsWith('%') ? parseFloat(val) * max / 100 : parseFloat(val);
                        this.setRgba(
                            parseComp(match[1], 255),
                            parseComp(match[2], 255),
                            parseComp(match[3], 255),
                            match[4] ? parseComp(match[4], 1) : this.a
                        );
                    }
                }
                // HSL / HSLA
                else if (color.startsWith('hsl')) {
                    const match = color.match(/hsla?\(\s*([\d.]+)(deg|grad|rad|turn)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.%]+))?\s*\)/);
                    if (match) {
                        let h = parseFloat(match[1]);
                        const unit = match[2];
                        if (unit === 'grad') h = h * 0.9;
                        else if (unit === 'rad') h = h * 180 / Math.PI;
                        else if (unit === 'turn') h = h * 360;

                        const sl = parseFloat(match[3]);
                        const l = parseFloat(match[4]) / 100;
                        const s = sl / 100;
                        const a = match[5] ? (match[5].endsWith('%') ? parseFloat(match[5]) / 100 : parseFloat(match[5])) : this.a;

                        const v = l + s * Math.min(l, 1 - l);
                        const sv = v === 0 ? 0 : 2 * (1 - l / v);
                        this.setHsva(h, sv * 100, v * 100, a);
                    }
                }
                // HEX (Moved to last to allow other formats without forced #)
                else {
                    const hexVal = color.startsWith('#') ? color : '#' + color;
                    const rgba = this._hexToRgba(hexVal);
                    if (rgba) this.setRgba(rgba.r, rgba.g, rgba.b, rgba.a);
                }
            }
        }

        setHsva(h, s, v, a = this.a) {
            this.h = Math.max(0, Math.min(360, h));
            this.s = Math.max(0, Math.min(100, s));
            this.v = Math.max(0, Math.min(100, v));
            this.a = Math.max(0, Math.min(1, a));
        }

        setRgba(r, g, b, a = this.a) {
            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            b = Math.max(0, Math.min(255, b));
            const { h, s, v } = this._rgbaToHsv(r, g, b);
            if (s !== 0) { // 彩度が0（無彩色）でない場合のみ色相を更新する
                this.h = h;
            }
            this.s = s;
            this.v = v;
            this.a = Math.max(0, Math.min(1, a));
        }

        setAlpha(a) {
            this.a = Math.max(0, Math.min(1, a));
        }

        getHsva() {
            return { h: this.h, s: this.s, v: this.v, a: this.a };
        }

        getRgba() {
            const { r, g, b } = this._hsvToRgba(this.h, this.s, this.v);
            return { r, g, b, a: this.a };
        }

        getHsla() {
            const { h, s, l } = this._hsvToHsl(this.h, this.s, this.v);
            return { h, s, l, a: this.a };
        }

        toHexString(includeAlpha = true) {
            let { r, g, b, a } = this.getRgba();
            if (isNaN(r) || isNaN(g) || isNaN(b)) { r = 0; g = 0; b = 0; }
            const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
            let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            if (includeAlpha && a < 1) { // αが1未満の場合は付ける
                hex += toHex(a * 255);
            }
            return hex.toUpperCase();
        }

        toRgbaString() {
            let { r, g, b, a } = this.getRgba();
            if (isNaN(r) || isNaN(g) || isNaN(b)) { r = 0; g = 0; b = 0; }
            if (a === 1) return `rgb(${r}, ${g}, ${b})`;
            // 小数第2位までにする
            return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
        }

        clone() {
            const c = new Color();
            c.setHsva(this.h, this.s, this.v, this.a);
            return c;
        }

        getLuminance() {
            const { r, g, b } = this.getRgba();
            // Rec. 709 輝度公式
            return (0.2126 * r + 0.7152 * g + 0.0722 * b);
        }

        getContrastColor() {
            // 輝度が128（50%）より大きい場合は黒、そうでなければ白
            return this.getLuminance() > 128 ? '#000000' : '#FFFFFF';
        }

        // --- Private Helper Methods ---

        _rgbaToHsv(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const d = max - min;
            let h = 0, s = (max === 0 ? 0 : d / max), v = max;

            if (max !== min) {
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            return { h: h * 360, s: s * 100, v: v * 100 };
        }

        _hsvToRgba(h, s, v) {
            h /= 360; s /= 100; v /= 100;
            let r, g, b;
            const i = Math.floor(h * 6);
            const f = h * 6 - i;
            const p = v * (1 - s);
            const q = v * (1 - f * s);
            const t = v * (1 - (1 - f) * s);
            switch (i % 6) {
                case 0: r = v, g = t, b = p; break;
                case 1: r = q, g = v, b = p; break;
                case 2: r = p, g = v, b = t; break;
                case 3: r = p, g = q, b = v; break;
                case 4: r = t, g = p, b = v; break;
                case 5: r = v, g = p, b = q; break;
            }
            return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
        }

        _hsvToHsl(h, s, v) {
            s /= 100; v /= 100;
            let l = (2 - s) * v / 2;
            let sl = s * v;
            const divisor = (l <= 0.5 ? (l * 2) : (2 - l * 2));
            sl = divisor === 0 ? 0 : sl / divisor; // 0除算を明示的に回避
            return { h, s: sl * 100, l: l * 100 };
        }

        _hexToRgba(hex) {
            const cleanHex = hex.replace(/^#/, '');
            if (!/^[0-9a-fA-F]+$/.test(cleanHex)) return null;

            let r, g, b, a = this.a;
            if (cleanHex.length === 3) {
                r = parseInt(cleanHex[0] + cleanHex[0], 16);
                g = parseInt(cleanHex[1] + cleanHex[1], 16);
                b = parseInt(cleanHex[2] + cleanHex[2], 16);
            } else if (cleanHex.length === 4) {
                r = parseInt(cleanHex[0] + cleanHex[0], 16);
                g = parseInt(cleanHex[1] + cleanHex[1], 16);
                b = parseInt(cleanHex[2] + cleanHex[2], 16);
                a = parseInt(cleanHex[3] + cleanHex[3], 16) / 255;
            } else if (cleanHex.length === 6) {
                r = parseInt(cleanHex.substring(0, 2), 16);
                g = parseInt(cleanHex.substring(2, 4), 16);
                b = parseInt(cleanHex.substring(4, 6), 16);
            } else if (cleanHex.length === 8) {
                r = parseInt(cleanHex.substring(0, 2), 16);
                g = parseInt(cleanHex.substring(2, 4), 16);
                b = parseInt(cleanHex.substring(4, 6), 16);
                a = parseInt(cleanHex.substring(6, 8), 16) / 255;
            } else {
                return null;
            }
            return { r, g, b, a };
        }
    }

    // -------------------------------------------------------------
    // UIの描画とイベント管理を担当するクラス
    // -------------------------------------------------------------
    class ColorPickerUI {
        constructor(optionsOrContainer, options = {}) {
            if (optionsOrContainer instanceof HTMLElement) {
                this.container = optionsOrContainer;
                this.options = options;
            } else {
                this.options = optionsOrContainer || {};
                this.container = this.options.container || null;
            }

            this.color = new Color(this.options.color || '#3B82F6');
            this.originalColor = this.color.clone();
            this.onChange = this.options.onChange || function () { };

            this.isPopup = !!this.options.isPopup;
            this.layout = this.options.layout || 'vertical';
            this.mode = 'RGB'; // RGB, HSV, HSL
            this.wrapper = null;
            this._lastTrigger = null;
            this.ringOrder = [0, 1, 2]; // 0: Vibrant, 1: Pastel, 2: Dark
            try {
                this.palette = JSON.parse(localStorage.getItem('cp-palette') || '[]');
                if (!Array.isArray(this.palette)) this.palette = [];
            } catch (e) {
                this.palette = [];
            }
            this.showBorder = !!this.options.showBorder;
            this._currentScale = 1;

            this.render();
            this.updateView();
            this._renderPalette();

            // 初期状態を発火
            this.onChange(this.color.clone());
        }

        render() {
            this.wrapper = document.createElement('div');
            this.wrapper.className = 'cp-wrapper';
            if (this.isPopup) {
                this.wrapper.classList.add('cp-is-popup');
            }

            // 1. プレビュー
            const previewHTML = `
            <div class="cp-preview-container">
                <div class="cp-preview-current"></div>
                <div class="cp-preview-original" title="クリックで元の色に戻す" tabindex="0"></div>
            </div>
        `;

            // 2. カラーサークル (SVG)
            const size = 240;
            const wheelHTML = `
            <div class="cp-wheel-container">
                <svg width="${size}" height="${size}" viewBox="-120 -120 240 240" class="cp-wheel-svg"></svg>
            </div>
        `;

            // 3. Opacity スライダー
            const opacityHTML = `
            <div class="cp-opacity-row">
                <span class="cp-label-text">Opacity</span>
                <div class="cp-slider-track cp-opacity-track">
                    <div class="cp-slider-gradient"></div>
                    <input type="range" class="cp-slider-input" min="0" max="1" step="0.01" value="1">
                </div>
                <div class="cp-alpha-input-box">
                    <input type="number" class="cp-input-field cp-alpha-input" min="0" max="100" step="1">
                    <span class="cp-unit">%</span>
                </div>
            </div>
        `;

            // 4. HEX と モード切替
            const toolsHTML = `
            <div class="cp-tools-row">
                <div class="cp-hex-group">
                    <span class="cp-label-text">HEX</span>
                    <input type="text" class="cp-input-field cp-hex-input">
                    <button type="button" class="cp-eye-dropper-btn" title="スポイト">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.43 2.52L15.31 4.64l2.12 2.12 2.12-2.12-2.12-2.12M13.19 6.76l-9.03 9.03V19.92h4.13l9.03-9.03-4.13-4.13M3.1 21.03c-.56 0-1.03-.47-1.03-1.03V15.5c0-.28.11-.53.3-.72L12.1 5.05c.39-.39 1.02-.39 1.41 0l4.24 4.24c.39.39.39 1.02 0 1.41L8.03 20.43c-.19.19-.44.3-.72.3H3.1z"/></svg>
                    </button>
                </div>
                <div class="cp-mode-switch">
                    <button type="button" class="cp-mode-btn active" data-mode="RGB">RGB</button>
                    <button type="button" class="cp-mode-btn" data-mode="HSV">HSV</button>
                    <button type="button" class="cp-mode-btn" data-mode="HSL">HSL</button>
                </div>
            </div>
        `;

            // 5. 色成分入力
            const inputsHTML = `
            <div class="cp-mode-inputs">
                <!-- 動的に生成 -->
            </div>
        `;

            // 6. カラーパレット
            const paletteHTML = `
            <div class="cp-palette-row">
                <button type="button" class="cp-palette-add" title="現在の色をパレットに追加">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                </button>
                <div class="cp-palette-list">
                    <!-- 保存された色がここに並ぶ -->
                </div>
            </div>
        `;

            if (this.layout === 'horizontal') {
                this.wrapper.classList.add('cp-layout-horizontal');
                this.wrapper.innerHTML = `
                <div class="cp-panel-left">${previewHTML}</div>
                <div class="cp-panel-center">${wheelHTML}</div>
                <div class="cp-panel-right">${opacityHTML}${toolsHTML}${inputsHTML}${paletteHTML}</div>
            `;
            } else {
                this.wrapper.innerHTML = previewHTML + wheelHTML + opacityHTML + toolsHTML + inputsHTML + paletteHTML;
            }

            if (this.container) {
                this.container.innerHTML = '';
                this.container.appendChild(this.wrapper);
            } else if (this.isPopup) {
                document.body.appendChild(this.wrapper);
            }

            if (this.isPopup) {
                const resizeHandleHTML = `
                <div class="cp-resize-handle" title="ドラッグしてリサイズ">
                    <svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M22 22h-2v-2h2v2zm0-4h-2v-2h2v2zm-4 4h-2v-2h2v2zm0-4h-2v-2h2v2zm-4 4h-2v-2h2v2z"/></svg>
                </div>
                `;
                this.wrapper.insertAdjacentHTML('beforeend', resizeHandleHTML);
            }

            this.dom = {
                current: this.wrapper.querySelector('.cp-preview-current'),
                original: this.wrapper.querySelector('.cp-preview-original'),
                wheel: this.wrapper.querySelector('.cp-wheel-svg'),
                alphaGradient: this.wrapper.querySelector('.cp-slider-gradient'),
                alphaSlider: this.wrapper.querySelector('.cp-slider-input'),
                alphaInput: this.wrapper.querySelector('.cp-alpha-input'),
                hex: this.wrapper.querySelector('.cp-hex-input'),
                modeBtns: this.wrapper.querySelectorAll('.cp-mode-btn'),
                modeInputs: this.wrapper.querySelector('.cp-mode-inputs'),
                eyeDropper: this.wrapper.querySelector('.cp-eye-dropper-btn'),
                paletteAdd: this.wrapper.querySelector('.cp-palette-add'),
                paletteList: this.wrapper.querySelector('.cp-palette-list'),
                resizeHandle: this.wrapper.querySelector('.cp-resize-handle')
            };

            if (!window.EyeDropper) {
                this.dom.eyeDropper.style.display = 'none';
            }

            this._renderWheel(this.dom.wheel);
            this._renderModeInputs();
            this._bindEvents();

            if (this.isPopup) {
                this._boundCloseHandler = (e) => {
                    if (this.wrapper.classList.contains('cp-visible')) {
                        // トリガーボタンまたはその子要素以外をクリックした場合に閉じる
                        const isTriggerOrChild = this._lastTrigger && this._lastTrigger.contains(e.target);
                        if (!this.wrapper.contains(e.target) && !isTriggerOrChild) {
                            this.hide();
                        }
                    }
                };
                document.addEventListener('mousedown', this._boundCloseHandler);
            }
        }

        // SVGでカラーサークルを描画
        _renderWheel(svg) {
            if (!svg) return;
            const segments = 24; // 24色相 (15度間隔)
            const angleStep = 360 / segments;

            // 基本の3つのスタイル定義
            const ringStyles = [
                { s: 100, v: 100 }, // Style 0: 鮮やか
                { s: 40, v: 100 },  // Style 1: パステル
                { s: 100, v: 50 },   // Style 2: 暗い色
            ];

            // 固定の半径設定に、現在の順序でスタイルを割り当て
            const rings = [
                { r0: 85, r1: 120, ...ringStyles[this.ringOrder[0]] }, // 外周
                { r0: 50, r1: 85, ...ringStyles[this.ringOrder[1]] }, // 中間
                { r0: 15, r1: 50, ...ringStyles[this.ringOrder[2]] }, // 内周
            ];

            let html = '';

            // SVGパスデータ生成関数 (扇形)
            const describeArc = (x, y, r0, r1, startAngle, endAngle) => {
                const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
                    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
                    return {
                        x: centerX + (radius * Math.cos(angleInRadians)),
                        y: centerY + (radius * Math.sin(angleInRadians))
                    };
                };

                const start0 = polarToCartesian(x, y, r0, endAngle);
                const end0 = polarToCartesian(x, y, r0, startAngle);
                const start1 = polarToCartesian(x, y, r1, endAngle);
                const end1 = polarToCartesian(x, y, r1, startAngle);

                const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

                if (r0 === 0) {
                    return [
                        "M", start1.x, start1.y,
                        "A", r1, r1, 0, largeArcFlag, 0, end1.x, end1.y,
                        "L", x, y, "Z"
                    ].join(" ");
                }

                return [
                    "M", start1.x, start1.y,
                    "A", r1, r1, 0, largeArcFlag, 0, end1.x, end1.y,
                    "L", end0.x, end0.y,
                    "A", r0, r0, 0, largeArcFlag, 1, start0.x, start0.y,
                    "Z"
                ].join(" ");
            };

            rings.forEach((ring) => {
                for (let i = 0; i < segments; i++) {
                    const h = i * angleStep;
                    const path = describeArc(0, 0, ring.r0, ring.r1, h, h + angleStep);

                    // 色計算
                    const tempColor = new Color();
                    tempColor.setHsva(h, ring.s, ring.v, 1);
                    const fill = tempColor.toRgbaString();

                    html += `<path class="cp-wheel-segment" d="${path}" fill="${fill}" data-h="${h}" data-s="${ring.s}" data-v="${ring.v}"></path>`;
                }
            });

            svg.innerHTML = html;
        }

        _renderModeInputs() {
            const container = this.dom.modeInputs;
            let html = '';

            const createRow = (label, id, min, max) => `
            <div class="cp-value-row">
                <span class="cp-row-label">${label}</span>
                <div class="cp-value-input-box">
                    <input type="number" class="cp-input-field" data-cp-id="input-${id}" min="${min}" max="${max}">
                </div>
                <div class="cp-value-slider-box">
                    <div class="cp-slider-track cp-component-track">
                        <div class="cp-slider-gradient" data-cp-id="grad-${id}"></div>
                        <input type="range" class="cp-slider-input" data-cp-id="slider-${id}" min="${min}" max="${max}" step="1">
                    </div>
                </div>
            </div>
        `;

            if (this.mode === 'RGB') {
                html += createRow('R', 'r', 0, 255) + createRow('G', 'g', 0, 255) + createRow('B', 'b', 0, 255);
            } else if (this.mode === 'HSV') {
                html += createRow('H', 'h', 0, 360) + createRow('S', 's', 0, 100) + createRow('V', 'v', 0, 100);
            } else if (this.mode === 'HSL') {
                html += createRow('H', 'h', 0, 360) + createRow('S', 's', 0, 100) + createRow('L', 'l', 0, 100);
            }
            container.innerHTML = html;

            // イベントバインド
            const inputs = container.querySelectorAll('.cp-input-field');
            const sliders = container.querySelectorAll('.cp-slider-input');

            const updateFromFields = () => this._handleModeInputChange('input');
            const updateFromSliders = () => this._handleModeInputChange('slider');

            inputs.forEach(input => {
                input.addEventListener('input', updateFromFields);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') updateFromFields();
                });
                input.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const step = parseFloat(input.step) || 1;
                    const min = parseFloat(input.min) || 0;
                    const max = parseFloat(input.max) || 100;
                    let val = parseFloat(input.value) || 0;
                    val += e.deltaY < 0 ? step : -step;
                    input.value = Math.max(min, Math.min(max, val));
                    updateFromFields();
                }, { passive: false });
            });

            sliders.forEach(slider => {
                slider.addEventListener('input', updateFromSliders);
                slider.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const step = parseFloat(slider.step) || 1;
                    const min = parseFloat(slider.min) || 0;
                    const max = parseFloat(slider.max) || 100;
                    let val = parseFloat(slider.value) || 0;
                    val += e.deltaY < 0 ? step : -step;
                    slider.value = Math.max(min, Math.min(max, val));
                    updateFromSliders();
                }, { passive: false });
            });

            this.updateView(true);
        }

        _bindEvents() {
            // 色を戻す
            this.dom.original.addEventListener('click', () => {
                this.color = this.originalColor.clone();
                this._notifyChange();
            });

            // サークルのクリック
            this.dom.wheel.addEventListener('click', (e) => {
                const segment = e.target.closest('.cp-wheel-segment');
                if (segment) {
                    const h = parseFloat(segment.getAttribute('data-h'));
                    const s = parseFloat(segment.getAttribute('data-s'));
                    const v = parseFloat(segment.getAttribute('data-v'));
                    this.color.setHsva(h, s, v, this.color.a);
                    this._notifyChange();
                }
            });

            // ホイールによるリングの入れ替え
            this.dom.wheel.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.deltaY > 0) {
                    // 正方向：[0,1,2] -> [2,0,1]
                    this.ringOrder.unshift(this.ringOrder.pop());
                } else {
                    // 逆方向：[0,1,2] -> [1,2,0]
                    this.ringOrder.push(this.ringOrder.shift());
                }
                this._renderWheel(this.dom.wheel);
            }, { passive: false });

            // スライダー
            this.dom.alphaSlider.addEventListener('input', (e) => {
                this.color.setAlpha(parseFloat(e.target.value));
                this._notifyChange(false);
            });

            // 透過率のスライダー上でのホイール
            this.dom.alphaSlider.addEventListener('wheel', (e) => {
                e.preventDefault();
                let val = parseFloat(this.dom.alphaSlider.value) || 0;
                val += e.deltaY < 0 ? 0.01 : -0.01;
                this.dom.alphaSlider.value = Math.max(0, Math.min(1, +val.toFixed(2)));
                this.color.setAlpha(parseFloat(this.dom.alphaSlider.value));
                this._notifyChange(false);
            }, { passive: false });

            // 透過率の数値入力
            this.dom.alphaInput.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value);
                // 空欄(NaN)の場合は一時的に無視して入力を妨げない
                if (!isNaN(val)) {
                    this.color.setAlpha(Math.max(0, Math.min(100, val)) / 100);
                    this._notifyChange(false);
                }
            });
            this.dom.alphaInput.addEventListener('change', (e) => {
                this._notifyChange(true);
            });

            // 透過率の数値入力上でのホイール
            this.dom.alphaInput.addEventListener('wheel', (e) => {
                e.preventDefault();
                let val = parseFloat(this.dom.alphaInput.value) || 0;
                val += e.deltaY < 0 ? 1 : -1;
                this.dom.alphaInput.value = Math.max(0, Math.min(100, val));
                this.color.setAlpha(parseFloat(this.dom.alphaInput.value) / 100);
                this._notifyChange(false);
            }, { passive: false });

            // HEX入力 (inputイベントでリアルタイム反映)
            this.dom.hex.addEventListener('input', (e) => {
                this.color.parse(e.target.value);
                this._notifyChange(false); // HEX入力中はHEXフィールド自体は更新しない（カーソル飛び防止）
            });
            this.dom.hex.addEventListener('change', (e) => {
                this._notifyChange(true); // 確定時にフォーマットを整える
            });

            // モード切替
            this.dom.modeBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.dom.modeBtns.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    this.mode = e.target.getAttribute('data-mode');
                    this._renderModeInputs();
                    this._updateInputs();
                });
            });

            // スポイト機能
            this.dom.eyeDropper.addEventListener('click', async () => {
                if (!window.EyeDropper) return;
                const dropper = new EyeDropper();
                try {
                    const result = await dropper.open();
                    this.color.parse(result.sRGBHex);
                    this._notifyChange();
                } catch (e) {
                    // キャンセル時などは何もしない
                }
            });

            // キーボード操作（フォーカストラップ等）
            this.wrapper.addEventListener('keydown', (e) => {
                if (e.key === 'Tab' && this.isPopup) {
                    const focusableNodes = Array.from(this.wrapper.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                        .filter(node => {
                            const style = window.getComputedStyle(node);
                            return style.display !== 'none' && style.visibility !== 'hidden';
                        });

                    if (focusableNodes.length === 0) return;

                    const first = focusableNodes[0];
                    const last = focusableNodes[focusableNodes.length - 1];

                    if (e.shiftKey) {
                        if (document.activeElement === first) {
                            last.focus();
                            e.preventDefault();
                        }
                    } else {
                        if (document.activeElement === last) {
                            first.focus();
                            e.preventDefault();
                        }
                    }
                } else if (e.key === 'Escape') {
                    this.hide();
                } else if (e.key === 'Enter' && document.activeElement === this.dom.original) {
                    // 元の色に戻す（Enter対応）
                    this.color = this.originalColor.clone();
                    this._notifyChange();
                }
            });

            // -------------------------------------------------------------
            // カラーパレット操作
            // -------------------------------------------------------------
            this.dom.paletteAdd.addEventListener('click', () => {
                const hex = this.color.toHexString(true);
                // 重複チェック（最新を先頭にするため、既存にある場合は一旦消す）
                const index = this.palette.indexOf(hex);
                if (index !== -1) {
                    this.palette.splice(index, 1);
                }
                this.palette.unshift(hex);

                // 最大20個（2列分目安）
                if (this.palette.length > 20) {
                    this.palette.pop();
                }

                localStorage.setItem('cp-palette', JSON.stringify(this.palette));
                this._renderPalette();
            });

            // -------------------------------------------------------------
            // リサイズ操作
            // -------------------------------------------------------------
            if (this.isPopup && this.dom.resizeHandle) {
                let startX = 0;
                let startY = 0;
                let startScale = 1;
                let baseWidth = 0;

                const onPointerMove = (e) => {
                    const dx = e.clientX - startX;
                    // ピクセル移動量を元の幅に対する割合としてスケールに換算
                    // 横方向のドラッグ量からスケールを決定する (縦横比維持)
                    const scaleDelta = dx / baseWidth;
                    let newScale = startScale + scaleDelta;

                    // 縮小と拡大の限界 (0.5x ~ 2.0x)
                    newScale = Math.max(0.5, Math.min(2.0, newScale));
                    this._currentScale = newScale;
                    this.wrapper.style.transform = `scale(${this._currentScale})`;
                };

                const onPointerUp = (e) => {
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                    this.wrapper.style.transition = ''; // ドラッグ終了後に元に戻す
                };

                this.dom.resizeHandle.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    startX = e.clientX;
                    startY = e.clientY;
                    startScale = this._currentScale;
                    
                    // transform: scale が掛かっている前の本来の幅を利用するため basic width を取得
                    // offsetWidth は scale の影響を受けない。getBoundingClientRect().width は影響を受ける。
                    baseWidth = this.wrapper.offsetWidth;

                    this.wrapper.style.transition = 'none'; // ドラッグ中のチラつきを抑える

                    document.addEventListener('pointermove', onPointerMove);
                    document.addEventListener('pointerup', onPointerUp);
                });
            }

            // -------------------------------------------------------------
            // ポップアップ自体のドラッグ移動操作
            // -------------------------------------------------------------
            if (this.isPopup && this.wrapper) {
                let dragStartX = 0;
                let dragStartY = 0;
                let startLeft = 0;
                let startTop = 0;

                const onDragMove = (e) => {
                    const dx = e.clientX - dragStartX;
                    const dy = e.clientY - dragStartY;
                    this.wrapper.style.left = `${startLeft + dx}px`;
                    this.wrapper.style.top = `${startTop + dy}px`;
                };

                const onDragUp = (e) => {
                    document.removeEventListener('pointermove', onDragMove);
                    document.removeEventListener('pointerup', onDragUp);
                    this.wrapper.classList.remove('cp-dragging');
                };

                this.wrapper.addEventListener('pointerdown', (e) => {
                    // インタラクティブな要素をクリックした場合は移動させない
                    const isInteractive = e.target.closest('input, button, svg, .cp-preview-container, .cp-slider-input, .cp-palette-swatch, .cp-resize-handle');
                    if (isInteractive) return;

                    // ドラッグ開始
                    e.preventDefault();
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    startLeft = parseFloat(this.wrapper.style.left) || 0;
                    startTop = parseFloat(this.wrapper.style.top) || 0;

                    this.wrapper.classList.add('cp-dragging');

                    document.addEventListener('pointermove', onDragMove);
                    document.addEventListener('pointerup', onDragUp);
                });
            }
        }

        _renderPalette() {
            if (!this.dom.paletteList) return;
            this.dom.paletteList.innerHTML = '';

            this.palette.forEach((hex) => {
                const swatch = document.createElement('div');
                swatch.className = 'cp-palette-swatch';
                swatch.style.backgroundColor = hex;
                swatch.title = hex;

                swatch.addEventListener('click', () => {
                    this.color.parse(hex);
                    this._notifyChange();
                });

                // 右クリックで削除可能にする
                swatch.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const index = this.palette.indexOf(hex);
                    if (index !== -1) {
                        this.palette.splice(index, 1);
                        localStorage.setItem('cp-palette', JSON.stringify(this.palette));
                        this._renderPalette();
                    }
                });

                this.dom.paletteList.appendChild(swatch);
            });
        }

        _handleModeInputChange(source = 'input') {
            const getVal = (id) => {
                const selector = source === 'input' ? `[data-cp-id="input-${id}"]` : `[data-cp-id="slider-${id}"]`;
                const el = this.wrapper.querySelector(selector);
                if (!el) return 0;
                const val = parseFloat(el.value);
                return isNaN(val) ? 0 : val;
            };

            const id1 = this.mode === 'RGB' ? 'r' : 'h';
            const id2 = this.mode === 'RGB' ? 'g' : 's';
            const id3 = this.mode === 'RGB' ? 'b' : (this.mode === 'HSV' ? 'v' : 'l');

            const val1 = getVal(id1);
            const val2 = getVal(id2);
            const val3 = getVal(id3);

            if (this.mode === 'RGB') {
                this.color.setRgba(val1, val2, val3);
            } else if (this.mode === 'HSV') {
                this.color.setHsva(val1, val2, val3);
            } else if (this.mode === 'HSL') {
                // HSLからHSVへの変換
                const l = val3 / 100;
                const s = val2 / 100;
                const v = l + s * Math.min(l, 1 - l);
                const sv = v === 0 ? 0 : 2 * (1 - l / v);
                this.color.setHsva(val1, sv * 100, v * 100);
            }
            this._notifyChange();
        }

        _notifyChange(updateInputs = true) {
            this.updateView(updateInputs);
            if (this.onChange) {
                this.onChange(this.color.clone());
            }
        }

        updateView(updateInputs = true) {
            const rgbaStr = this.color.toRgbaString();

            // プレビュー
            this.dom.current.style.backgroundColor = rgbaStr;
            this.dom.original.style.backgroundColor = this.originalColor.toRgbaString();

            // 文字色のコントラスト調整（New / Original）
            const contrast = this.color.getContrastColor();
            this.dom.current.style.setProperty('--cp-preview-text', contrast);
            this.dom.current.style.setProperty('--cp-preview-shadow', contrast === '#000000' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.5)');

            const contrastOrig = this.originalColor.getContrastColor();
            this.dom.original.style.setProperty('--cp-preview-text-orig', contrastOrig);
            this.dom.original.style.setProperty('--cp-preview-shadow-orig', contrastOrig === '#000000' ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.5)');

            // 枠線の更新
            if (this.showBorder && this.isPopup && this.wrapper) {
                this.wrapper.style.borderColor = rgbaStr;
            }

            // Alpha スライダー (Safari等のグラデーション補間バグ対策)
            const pureColor = this.color.clone();
            pureColor.setAlpha(0);
            const transparentColor = pureColor.toRgbaString();
            pureColor.setAlpha(1);
            this.dom.alphaGradient.style.background = `linear-gradient(to right, ${transparentColor}, ${pureColor.toRgbaString()})`;
            this.dom.alphaSlider.value = this.color.a;

            if (this.dom.alphaInput && document.activeElement !== this.dom.alphaInput) {
                this.dom.alphaInput.value = Math.round(this.color.a * 100);
            }

            if (updateInputs) {
                this._updateInputs();
            }
            this._updateGradients();
        }

        _updateInputs() {
            this.dom.hex.value = this.color.toHexString(true);

            const { r, g, b } = this.color.getRgba();
            const { h, s, v } = this.color.getHsva();
            const hsl = this.color.getHsla();

            const syncVal = (id, val) => {
                const input = this.wrapper.querySelector(`[data-cp-id="input-${id}"]`);
                const slider = this.wrapper.querySelector(`[data-cp-id="slider-${id}"]`);
                if (input && input !== document.activeElement) input.value = Math.round(val);
                if (slider && slider !== document.activeElement) slider.value = Math.round(val);
            };

            if (this.mode === 'RGB') {
                syncVal('r', r);
                syncVal('g', g);
                syncVal('b', b);
            } else if (this.mode === 'HSV') {
                syncVal('h', h);
                syncVal('s', s);
                syncVal('v', v);
            } else if (this.mode === 'HSL') {
                syncVal('h', hsl.h);
                syncVal('s', hsl.s);
                syncVal('l', hsl.l);
            }
        }

        _updateGradients() {
            const { r, g, b } = this.color.getRgba();
            const { h, s, v } = this.color.getHsva();
            const hsl = this.color.getHsla();

            const setGrad = (id, colorStops) => {
                const el = this.wrapper.querySelector(`[data-cp-id="grad-${id}"]`);
                if (el) el.style.background = `linear-gradient(to right, ${colorStops.join(', ')})`;
            };

            if (this.mode === 'RGB') {
                setGrad('r', [`rgb(0, ${g}, ${b})`, `rgb(255, ${g}, ${b})`]);
                setGrad('g', [`rgb(${r}, 0, ${b})`, `rgb(${r}, 255, ${b})`]);
                setGrad('b', [`rgb(${r}, ${g}, 0)`, `rgb(${r}, ${g}, 255)`]);
            } else if (this.mode === 'HSV') {
                setGrad('h', [
                    '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'
                ]);

                const temp = this.color.clone();
                temp.setAlpha(1);
                temp.setHsva(h, 0, v);
                const startStr = temp.toRgbaString();
                temp.setHsva(h, 100, v);
                const endStr = temp.toRgbaString();
                setGrad('s', [startStr, endStr]);

                temp.setHsva(h, s, 0);
                const startVStr = '#000000'; // Value = 0 is always black
                temp.setHsva(h, s, 100);
                const endVStr = temp.toRgbaString();
                setGrad('v', [startVStr, endVStr]);
            } else if (this.mode === 'HSL') {
                setGrad('h', [
                    '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'
                ]);
                setGrad('s', [`hsl(${hsl.h}, 0%, ${hsl.l}%)`, `hsl(${hsl.h}, 100%, ${hsl.l}%)`]);
                setGrad('l', ['#000', `hsl(${hsl.h}, ${hsl.s}%, 50%)`, '#fff']);
            }
        }

        show(triggerElement) {
            if (!this.isPopup || !this.wrapper) return;

            // 複数インスタンス間での同期：パレットの再読込
            try {
                this.palette = JSON.parse(localStorage.getItem('cp-palette') || '[]');
                this._renderPalette();
            } catch (e) {
                // パース失敗時は無視
            }

            // 同じトリガーボタンが押された場合にトグル（閉じる）動作を実現
            if (this.wrapper.classList.contains('cp-visible') && this._lastTrigger === triggerElement) {
                this.hide();
                return;
            }

            this.wrapper.classList.add('cp-visible');
            this._lastTrigger = triggerElement;
            this._originalFocus = document.activeElement; // 開く前のフォーカスを保持
            this.originalColor = this.color.clone();
            this.updateView();

            // 初期フォーカス
            setTimeout(() => {
                if (this.dom.hex) this.dom.hex.focus();
            }, 10);

            if (triggerElement) {
                const rect = triggerElement.getBoundingClientRect();
                const scrollY = window.scrollY || document.documentElement.scrollTop;
                const scrollX = window.scrollX || document.documentElement.scrollLeft;

                let top = rect.bottom + scrollY + 8;
                let left = rect.left + scrollX;

                // 画面外へのはみ出しチェック
                this.wrapper.style.visibility = 'hidden';
                this.wrapper.style.display = 'block'; // 一時的に表示してサイズを取得
                const pickerRect = this.wrapper.getBoundingClientRect();
                this.wrapper.style.display = '';
                this.wrapper.style.visibility = '';

                const winW = window.innerWidth;
                const winH = window.innerHeight;

                if (left + pickerRect.width > winW + scrollX) {
                    left = winW + scrollX - pickerRect.width - 16;
                }
                if (top + pickerRect.height > winH + scrollY) {
                    top = rect.top + scrollY - pickerRect.height - 8;
                }

                this.wrapper.style.top = Math.max(scrollY, top) + 'px';
                this.wrapper.style.left = Math.max(scrollX, left) + 'px';
            }
        }

        hide() {
            if (this.isPopup && this.wrapper) {
                this.wrapper.classList.remove('cp-visible');
                this._lastTrigger = null;
                // フォーカスを元の要素に戻す
                if (this._originalFocus && this._originalFocus.focus) {
                    this._originalFocus.focus();
                }
            }
        }

        destroy() {
            if (this._boundCloseHandler) {
                document.removeEventListener('mousedown', this._boundCloseHandler);
            }
            if (this.wrapper && this.wrapper.parentNode) {
                this.wrapper.parentNode.removeChild(this.wrapper);
            }
            this.dom = null;
            this.wrapper = null;
        }
    }

    // 外部から使えるようにグローバルに登録
    global.ColorPickerUI = ColorPickerUI;

})(window);
