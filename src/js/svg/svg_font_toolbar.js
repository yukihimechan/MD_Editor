/**
 * SVG Font Toolbar
 * テキスト要素のフォントプロパティ（フォント名、サイズ、スタイル、色等）を調整するツールバー
 */
class SVGFontToolbar extends SVGToolbarBase {
    constructor(container, draw, options = {}) {
        super({
            id: options.id || 'svg-font-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '215px', left: '10px' }
        });
        this.draw = draw;
        this.fillPicker = null;
        this.bgPicker = null;

        this.fonts = [
            { name: 'Inter', value: 'Inter, system-ui, sans-serif' },
            { name: 'Roboto', value: 'Roboto, sans-serif' },
            { name: 'Montserrat', value: 'Montserrat, sans-serif' },
            { name: 'Arial', value: 'Arial, sans-serif' },
            { name: 'Georgia', value: 'Georgia, serif' },
            { name: 'Times', value: 'Times New Roman, serif' },
            { name: 'Courier', value: 'Courier New, monospace' },
            // [NEW] 日本語フォント
            { name: 'ゴシック (標準)', value: '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif' },
            { name: '游ゴシック', value: '"Yu Gothic", YuGothic, sans-serif' },
            { name: '明朝体', value: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "MS PMincho", serif' },
            { name: 'Noto Sans JP', value: '"Noto Sans JP", sans-serif' }
        ];

        this.createToolbar();
        this._autoInitLocalFonts();
    }

    async _autoInitLocalFonts() {
        if ('queryLocalFonts' in window && !this.localFontsLoaded) {
            try {
                const perm = await navigator.permissions.query({ name: 'local-fonts' });
                if (perm.state === 'granted') {
                    const localFonts = await window.queryLocalFonts();
                    this.localFontsLoaded = true;
                    window._localFontDataMap = window._localFontDataMap || new Map();
                    const newFonts = new Map();
                    localFonts.forEach(font => {
                        const family = font.family;
                        window._localFontDataMap.set(family.toLowerCase(), font);
                        if (!this.fonts.some(f => f.name.toLowerCase() === family.toLowerCase() || f.value.includes(family))) {
                            newFonts.set(family.toLowerCase(), { name: family, value: `"${family}", sans-serif` });
                        }
                    });
                    if (newFonts.size > 0) {
                        const sortedNewFonts = Array.from(newFonts.values()).sort((a, b) => a.name.localeCompare(b.name));
                        this.fonts = [...this.fonts.filter(f => !newFonts.has(f.name.toLowerCase())), ...sortedNewFonts];
                    }
                    if (this._listEl && this._triggerEl) {
                        this.renderFontList(this._listEl, this._triggerEl);
                    }
                }
            } catch (e) { }
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
        this.toolbarElement.classList.add('svg-font-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';
        // 以前の overflow: visible は廃止（ツールバーの縮小時に中身がはみ出す原因になるため）

        // フォントファミリー（カスタムドロップダウン）
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.cssText = 'position: relative; display: inline-block; width: 85px; margin-right: 2px; font-family: sans-serif;';

        const trigger = document.createElement('button');
        trigger.className = 'svg-font-custom-select';
        trigger.title = 'フォントファミリー';
        trigger.style.cssText = 'width: 100%; box-sizing: border-box; padding: 2px 4px; border: 1px solid var(--svg-toolbar-input-border); background: var(--svg-toolbar-input-bg); color: var(--svg-toolbar-fg); font-size: 11px; cursor: pointer; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; justify-content: space-between; height: 21px; font-family: inherit; margin: 0; outline: none;';
        trigger.innerHTML = '<span class="label" style="overflow: hidden; text-overflow: ellipsis;">Inter</span><span style="font-size: 8px; margin-left: 2px; opacity: 0.7;">▼</span>';

        const list = document.createElement('div');
        list.className = 'svg-font-custom-list';
        list.style.cssText = 'display: none; position: fixed; width: 180px; max-height: 250px; overflow-y: auto; overflow-x: hidden; background: var(--svg-toolbar-bg, #ffffff); border: 1px solid var(--svg-toolbar-border, #ccc); z-index: 100500; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border-radius: 3px;';

        // [FIX] リスト上でのスクロール（ホイール操作）がキャンバスまで伝播してパン（移動）するのを防ぐ
        list.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: false });

        this.renderFontList(list, trigger);

        trigger.onclick = (e) => {
            e.stopPropagation();
            const isOpen = list.style.display === 'block';
            document.querySelectorAll('.svg-font-custom-list').forEach(l => l.style.display = 'none'); // close others
            
            if (!isOpen) {
                // fixed配置のリストに対して、クリックされたトリガーボタンの位置基準でドロップダウンを表示
                const rect = trigger.getBoundingClientRect();
                list.style.top = (rect.bottom + 1) + 'px';
                list.style.left = rect.left + 'px';
                list.style.display = 'block';
            } else {
                list.style.display = 'none';
            }
        };

        const closeDropdown = () => {
            if (list.style.display === 'block') {
                list.style.display = 'none';
                if (typeof this.revertPreviewProperty === 'function') {
                    this.revertPreviewProperty('font-family');
                }
            }
        };
        document.addEventListener('click', closeDropdown);
        this.cleanupDropdown = () => document.removeEventListener('click', closeDropdown);

        dropdownContainer.appendChild(trigger);
        document.body.appendChild(list); // Overflowを回避するためbody等最上位に配置
        contentArea.appendChild(dropdownContainer);

        this.customFontTrigger = trigger.querySelector('.label');

        // フォントサイズ
        this.sizeInput = document.createElement('input');
        this.sizeInput.type = 'number';
        this.sizeInput.title = 'フォントサイズ';
        this.sizeInput.min = '1';
        this.sizeInput.style.width = '45px';
        
        let sizeDebounce;
        const applySize = () => {
            const val = this.sizeInput.value;
            if (val) this.applyProperty('font-size', val);
        };
        this.sizeInput.onchange = applySize;
        this.sizeInput.oninput = () => {
            clearTimeout(sizeDebounce);
            sizeDebounce = setTimeout(applySize, 300);
        };
        this.sizeInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(sizeDebounce);
                applySize();
                this.sizeInput.blur();
            }
        };

        contentArea.appendChild(this.sizeInput);

        contentArea.appendChild(this.createSeparator());

        // スタイルボタン
        this.boldBtn = this.createIconButton('太字', '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>', () => this.toggleStyle('font-weight', 'bold', 'normal', this.boldBtn));
        this.italicBtn = this.createIconButton('斜体', '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>', () => this.toggleStyle('font-style', 'italic', 'normal', this.italicBtn));
        this.underlineBtn = this.createIconButton('下線', '<path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/>', () => this.toggleDecoration('underline', this.underlineBtn));
        this.strikeBtn = this.createIconButton('打ち消し線', '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>', () => this.toggleDecoration('line-through', this.strikeBtn));

        [this.boldBtn, this.italicBtn, this.underlineBtn, this.strikeBtn].forEach(btn => contentArea.appendChild(btn));

        contentArea.appendChild(this.createSeparator());

        // カラートリガー
        const { container: tcTrigger, anchor: tcAnchor } = this.createColorTrigger('文字色', 'fill');
        const { container: bgTrigger, anchor: bgAnchor } = this.createColorTrigger('背景色', 'background');

        contentArea.appendChild(tcTrigger);
        contentArea.appendChild(bgTrigger);

        this.fillPicker = this.initPicker('fill', tcAnchor, tcTrigger);
        this.bgPicker = this.initPicker('background', bgAnchor, bgTrigger);

        contentArea.appendChild(this.createSeparator());

        // 文字間隔
        const spacingLabel = document.createElement('span');
        spacingLabel.textContent = '間隔';
        spacingLabel.style.cssText = `font-size: 10px; color: var(--svg-toolbar-fg); opacity: 0.6; margin: 0 2px; white-space: nowrap;`;
        contentArea.appendChild(spacingLabel);

        this.letterSpacingInput = document.createElement('input');
        this.letterSpacingInput.type = 'number';
        this.letterSpacingInput.title = '文字間隔';
        this.letterSpacingInput.step = '0.5';
        this.letterSpacingInput.style.width = '45px';
        
        let spacingDebounce;
        const applySpacing = () => {
            const val = this.letterSpacingInput.value;
            if (val) this.applyProperty('letter-spacing', val);
        };
        this.letterSpacingInput.onchange = applySpacing;
        this.letterSpacingInput.oninput = () => {
            clearTimeout(spacingDebounce);
            spacingDebounce = setTimeout(applySpacing, 300);
        };
        this.letterSpacingInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(spacingDebounce);
                applySpacing();
                this.letterSpacingInput.blur();
            }
        };

        contentArea.appendChild(this.letterSpacingInput);
    }

    renderFontList(list, trigger) {
        this._listEl = list;
        this._triggerEl = trigger;
        list.innerHTML = '';

        this.fonts.forEach(f => {
            const item = document.createElement('div');
            item.style.cssText = `padding: 5px 8px; cursor: pointer; font-size: 11px; color: var(--svg-toolbar-fg); border-bottom: 1px solid var(--svg-toolbar-input-border); font-family: ${f.value}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
            item.textContent = f.name;
            item.title = f.name;

            item.onmouseenter = () => {
                item.style.background = 'var(--svg-toolbar-input-bg)';
                item.style.filter = 'brightness(0.9)';
                if (typeof this.previewProperty === 'function') {
                    this.previewProperty('font-family', f.value);
                }
            };
            item.onmouseleave = () => {
                item.style.background = '';
                item.style.filter = '';
                if (typeof this.revertPreviewProperty === 'function') {
                    this.revertPreviewProperty('font-family');
                }
            };
            item.onclick = (e) => {
                e.stopPropagation();
                list.style.display = 'none';
                trigger.querySelector('.label').textContent = f.name;
                if (typeof this.commitProperty === 'function') {
                    this.commitProperty('font-family', f.value);
                }
            };
            list.appendChild(item);
        });

        if ('queryLocalFonts' in window && !this.localFontsLoaded) {
            const loadBtn = document.createElement('div');
            loadBtn.style.cssText = `padding: 8px; cursor: pointer; font-size: 10px; color: #0D31BB; background: #EEF2FF; border-top: 1px solid var(--svg-toolbar-input-border); text-align: center; font-weight: bold; font-family: sans-serif; position: sticky; bottom: 0; box-shadow: 0 -2px 5px rgba(0,0,0,0.05);`;
            loadBtn.innerHTML = '✨ PCの全フォントを追加';
            loadBtn.onclick = async (e) => {
                e.stopPropagation();
                loadBtn.innerHTML = '読み込み中...';
                try {
                    const localFonts = await window.queryLocalFonts();
                    this.localFontsLoaded = true;

                    // [NEW] Cache Local Font API data globally for Outline operations
                    window._localFontDataMap = window._localFontDataMap || new Map();

                    const newFonts = new Map();
                    localFonts.forEach(font => {
                        const family = font.family.toLowerCase();
                        const style = font.style.toLowerCase();
                        window._localFontDataMap.set(`${family}-${style}`, font);

                        if (!window._localFontDataMap.has(family) || style === 'regular' || style === 'normal') {
                            window._localFontDataMap.set(family, font);
                        }

                        if (!this.fonts.some(f => f.name.toLowerCase() === font.family.toLowerCase() || f.value.includes(font.family))) {
                            newFonts.set(font.family.toLowerCase(), { name: font.family, value: `"${font.family}", sans-serif` });
                        }
                    });

                    if (newFonts.size > 0) {
                        const sortedNewFonts = Array.from(newFonts.values()).sort((a, b) => a.name.localeCompare(b.name));
                        this.fonts = [...this.fonts.filter(f => !newFonts.has(f.name.toLowerCase())), ...sortedNewFonts];
                    }
                    this.renderFontList(list, trigger);
                } catch (err) {
                    console.warn("Local font access failed:", err);
                    loadBtn.innerHTML = '取得失敗（権限が必要です）';
                    loadBtn.style.color = 'red';
                    setTimeout(() => {
                        if (list && list.parentNode) this.renderFontList(list, trigger);
                    }, 3000);
                }
            };
            list.appendChild(loadBtn);
        }
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    createIconButton(title, iconHtml, action) {
        const btn = document.createElement('button');
        btn.title = title;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconHtml}</svg>`;
        btn.onclick = (e) => { e.stopPropagation(); action(); };
        return btn;
    }

    createColorTrigger(title, type) {
        const container = document.createElement('div');
        container.title = title;
        container.className = `font-color-trigger-${type}`;
        container.style.cssText = `width: 20px; height: 20px; padding: 0; border: 1px solid var(--svg-toolbar-input-border); background: var(--svg-toolbar-input-bg); border-radius: 3px; cursor: pointer; position: relative; flex-shrink: 0; margin: 0 1px; box-sizing: border-box; display: inline-block; vertical-align: middle;`;

        const bg = document.createElement('div');
        bg.className = 'color-preview-bg';
        bg.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: ${type === 'fill' ? '#ffffff' : 'transparent'}; z-index: 1; pointer-events: none;`;
        container.appendChild(bg);

        const label = document.createElement('span');
        label.className = 'color-preview-label';
        label.textContent = type === 'fill' ? 'A' : 'ab';
        label.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 2; font-size: 13px; font-weight: bold; color: ${type === 'fill' ? '#000000' : '#ffffff'}; text-shadow: ${type === 'fill' ? 'none' : '0 0 2px #000'}; pointer-events: none; line-height: 1;`;
        container.appendChild(label);

        const anchor = document.createElement('div');
        anchor.className = 'picker-anchor';
        container.appendChild(anchor);

        container.dataset.currentColor = type === 'fill' ? '#000000' : 'none';
        return { container, anchor };
    }

    initPicker(type, el, trigger) {
        if (typeof ColorPickerUI === 'undefined') return null;
        const defaultColor = type === 'fill' ? '#000000' : 'rgba(0,0,0,0)';
        const picker = new ColorPickerUI({
            color: defaultColor,
            isPopup: true,
            onChange: (color) => {
                const colorStr = color.toHexString(true);
                trigger.dataset.currentColor = colorStr;
                this.applyColor(type, colorStr);
            }
        });

        picker.options.trigger = trigger; // Save reference for updatePickerUI

        trigger.onmousedown = (e) => e.stopPropagation();
        trigger.onclick = (e) => {
            e.stopPropagation();
            picker.show(trigger);
        };

        return picker;
    }

    applyColor(type, value) {
        const picker = type === 'fill' ? this.fillPicker : this.bgPicker;
        this.updatePickerUI(picker, value, type);

        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText) {
                if (type === 'fill') {
                    // [FIX] 属性としての適用ではなく、インラインCSSとして適用することでCSSクラスよりも優先させる
                    targetText.css('fill', value);
                } else {
                    targetText.attr('data-text-highlight', value);
                    const parent = targetText.parent();
                    if (parent && parent.attr('data-tool-id') === 'shape-text-group') {
                        let shape = null;
                        const childrenList = parent.children();
                        for (let i = 0; i < childrenList.length; i++) {
                            const c = childrenList[i];
                            if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea') && !c.hasClass('svg-select-handle')) { shape = c; break; }
                        }
                        if (shape) {
                            if (value === 'none' && shape.attr('data-is-background') === 'true') {
                                parent.before(targetText);
                                parent.remove();
                                if (window.makeInteractive) { window.makeInteractive(targetText); window.selectElement(targetText, false); }
                            } else {
                                // [FIX] 背景図形の塗りつぶしもインラインCSSで適用
                                shape.css('fill', value);
                            }
                        }
                    } else if (value !== 'none') {
                        const group = targetText.parent().group();
                        group.attr({ 'data-tool-id': 'shape-text-group', 'data-label': 'Text with Background' });
                        targetText.before(group);
                        const bbox = targetText.bbox();
                        const bgRect = group.rect(bbox.width + 10, bbox.height + 4);
                        bgRect.attr({ 'fill': value, 'data-is-background': 'true' });
                        bgRect.center(bbox.cx, bbox.cy);
                        group.add(bgRect); group.add(targetText);
                        if (window.makeInteractive) {
                            const si = targetText.remember('_shapeInstance');
                            if (si) si.destroy();
                            window.makeInteractive(group); window.selectElement(group, false);
                        }
                    }
                }
            }
        });
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    updatePickerUI(picker, value, type) {
        if (!picker || !picker.options || !picker.options.trigger) return;
        const trigger = picker.options.trigger;
        const bgEl = trigger.querySelector('.color-preview-bg');
        const labelEl = trigger.querySelector('.color-preview-label');
        if (value === 'none') {
            if (bgEl) bgEl.style.background = type === 'fill' ? '#ffffff' : 'transparent';
            if (labelEl) {
                labelEl.style.color = type === 'fill' ? '#000000' : '#ffffff';
                labelEl.style.textShadow = type === 'fill' ? 'none' : '0 0 2px #000';
            }
        } else {
            if (type === 'fill') {
                if (bgEl) bgEl.style.background = '#ffffff';
                if (labelEl) { labelEl.style.color = value; labelEl.style.textShadow = 'none'; }
            } else {
                if (bgEl) bgEl.style.background = value;
                if (labelEl) { labelEl.style.color = '#ffffff'; labelEl.style.textShadow = '0 0 2px #000'; }
            }
        }
        trigger.dataset.currentColor = value;
        if (picker.color && typeof picker.color.parse === 'function') {
            picker.color.parse(value === 'none' ? 'rgba(0,0,0,0)' : value);
            if (typeof picker.updateView === 'function') picker.updateView(true);
        }
    }

    toggleStyle(prop, onValue, offValue, btn) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;
        const current = this.getComputedProp(selected[0], prop);
        const next = current === onValue ? offValue : onValue;
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText) targetText.css(prop, next);
        });
        this.updateToggleBtnState(btn, next === onValue);
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    toggleDecoration(value, btn) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;
        const currentDecorations = (this.getComputedProp(selected[0], 'text-decoration') || '').split(' ');
        let next;
        if (currentDecorations.includes(value)) next = currentDecorations.filter(d => d !== value && d !== 'none').join(' ') || 'none';
        else next = [...currentDecorations.filter(d => d !== 'none'), value].join(' ');
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText) targetText.css('text-decoration', next);
        });
        this.updateToggleBtnState(btn, next.includes(value));
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    previewProperty(prop, value) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText && targetText.node) {
                if (targetText.node.dataset.origFont === undefined) {
                    targetText.node.dataset.origFont = targetText.css(prop) || targetText.attr(prop) || '';
                }
                targetText.css(prop, value);
            }
        });
    }

    revertPreviewProperty(prop) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText && targetText.node && targetText.node.dataset.origFont !== undefined) {
                targetText.css(prop, targetText.node.dataset.origFont);
                delete targetText.node.dataset.origFont;
            }
        });
    }

    commitProperty(prop, value) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText && targetText.node) {
                delete targetText.node.dataset.origFont;
            }
        });
        this.applyProperty(prop, value);
    }

    applyProperty(prop, value) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        selected.forEach(el => {
            const targetText = this.findTextElement(el);
            if (targetText) {
                let cssValue = value;
                if ((prop === 'font-size' || prop === 'letter-spacing') && String(value).trim().match(/^-?[0-9.]+$/)) {
                    cssValue = `${value}px`;
                }

                // [FIX] SVG属性ではなくインラインCSSとして適用し、CSSクラスを強力にオーバーライドする
                targetText.css(prop, cssValue);
                
                // 互換性のため属性にも保存する
                if (prop === 'font-size' || prop === 'letter-spacing' || prop === 'font-family') {
                    targetText.attr(prop, value);
                }
                
                // [FIX] フォントサイズ変更時は基準フォントサイズのキャッシュを削除し、古いサイズが使用されるのを防ぐ
                if (prop === 'font-size' && targetText.node) {
                    delete targetText.node.dataset.baseFontSize;
                    targetText.attr('data-base-font-size', null);
                }
                
                // 親が Shape with Text なら、フォント変更により折り返し再計算を呼び出す
                const parent = targetText.parent();
                if (parent && parent.attr('data-tool-id') === 'shape-text-group') {
                    const si = parent.remember('_shapeInstance');
                    if (si && typeof si.applyTextWrap === 'function') {
                        si.applyTextWrap();
                    }
                }

                if ((prop === 'font-size' || prop === 'letter-spacing') && window.SVGTextAlignmentToolbar) {
                    window.SVGTextAlignmentToolbar.updateTextPosition(parent || targetText);
                }
            }
        });
        if (typeof syncChanges === 'function') syncChanges(false);
    }

    updateToggleBtnState(btn, isActive) { btn.classList.toggle('active', isActive); }

    findTextElement(el) {
        if (!el) return null;
        
        // 対象が既にヒットエリア要素の場合は親グループに委譲する
        if (el.type === 'text' && typeof el.hasClass === 'function' && el.hasClass('svg-interaction-hitarea')) {
             const parent = el.parent();
             if (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') el = parent;
             else return null;
        }
        
        if (el.type === 'text') return el;
        
        const getFirstText = (container) => {
            const isHitArea = (node) => node && typeof node.hasClass === 'function' && node.hasClass('svg-interaction-hitarea');
            let found = null;

            if (container.children) {
                const list = container.children();
                for (let i = 0; i < list.length; i++) {
                    const child = list[i];
                    if (child && child.type === 'text' && !isHitArea(child)) { found = child; break; }
                }
            }
            if (!found && typeof container.find === 'function') {
                const list = container.find('text');
                if (list && list.length > 0) {
                    for (let i = 0; i < list.length; i++) {
                        const t = list[i];
                        if (!isHitArea(t)) { found = t; break; }
                    }
                }
            }
            if (!found && typeof container.findOne === 'function') {
                try { found = container.findOne('text:not(.svg-interaction-hitarea)'); } catch(e) {}
                if (!found) {
                    const altText = container.findOne('text');
                    if (altText && !isHitArea(altText)) found = altText;
                }
            }
            return found;
        };

        if (el.attr && el.attr('data-tool-id') === 'shape-text-group') return getFirstText(el);
        const parent = el.parent();
        if (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') return getFirstText(parent);
        
        return null;
    }

    getComputedProp(el, prop) {
        const text = this.findTextElement(el);
        return text ? (text.css(prop) || text.attr(prop)) : null;
    }

    show() { if (this.toolbarElement) { this.toolbarElement.style.display = 'flex'; this.updateFromSelection(); } }
    hide() { /* Always visible */ }

    updateFromSelection() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;
        const text = this.findTextElement(selected[0]);
        if (text) {
            const currentFont = text.css('font-family') || text.attr('font-family') || 'Inter, system-ui, sans-serif';
            if (this.fontSelect) this.fontSelect.value = currentFont;
            if (this.customFontTrigger) {
                const cleanFont = currentFont.split(',')[0].replace(/['"]/g, '').trim();
                const matched = this.fonts.find(f => currentFont.includes(f.name) || currentFont === f.value || f.value.includes(cleanFont));
                this.customFontTrigger.textContent = matched ? matched.name : 'Mixed';
            }
            if (this.sizeInput) {
                // [FIX] '16px' のように単位が含まれる場合があるため parseFloat で数値化する
                this.sizeInput.value = parseFloat(text.css('font-size') || text.attr('font-size') || 20);
            }
            if (this.letterSpacingInput) {
                this.letterSpacingInput.value = parseFloat(text.css('letter-spacing') || text.attr('letter-spacing') || 0);
            }

            const fw = text.css('font-weight') || text.attr('font-weight');
            this.updateToggleBtnState(this.boldBtn, fw === 'bold');

            const fs = text.css('font-style') || text.attr('font-style');
            this.updateToggleBtnState(this.italicBtn, fs === 'italic');

            const decor = text.css('text-decoration') || text.attr('text-decoration') || '';
            this.updateToggleBtnState(this.underlineBtn, decor.includes('underline'));
            this.updateToggleBtnState(this.strikeBtn, decor.includes('line-through'));

            // Sync colors
            let textColor = text.css('fill') || text.attr('fill');
            if (typeof textColor === 'object') textColor = textColor.color || 'none';
            if (!textColor) textColor = '#000000';
            if (this.fillPicker) this.updatePickerUI(this.fillPicker, textColor, 'fill');

            let bgColor = text.attr('data-text-highlight');
            if (!bgColor) {
                const parent = text.parent();
                if (parent && parent.attr('data-tool-id') === 'shape-text-group') {
                    let bgShape = null;
                    const childrenList = parent.children();
                    for (let i = 0; i < childrenList.length; i++) {
                        const c = childrenList[i];
                        if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea') && !c.hasClass('svg-select-handle')) { bgShape = c; break; }
                    }
                    if (bgShape) {
                        bgColor = bgShape.css('fill') || bgShape.attr('fill');
                        if (typeof bgColor === 'object') bgColor = bgColor.color;
                    }
                }
            }
            if (!bgColor) bgColor = 'none';
            if (this.bgPicker) this.updatePickerUI(this.bgPicker, bgColor, 'background');
        }
    }

    destroy() {
        if (this.cleanupDropdown) this.cleanupDropdown();
        if (this.fillPicker && this.fillPicker.destroy) this.fillPicker.destroy();
        if (this.bgPicker && this.bgPicker.destroy) this.bgPicker.destroy();
        if (this.toolbarElement) this.toolbarElement.remove();
        if (this._listEl && this._listEl.parentNode) this._listEl.parentNode.removeChild(this._listEl);
    }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createFontToolbar = (container, draw, options) => {
    return new SVGFontToolbar(container, draw, options);
};
