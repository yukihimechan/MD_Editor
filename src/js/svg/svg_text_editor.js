/**
 * SVG Text Inline Editor
 * Handles double-click editing of SVG text shapes with accurate overlay positioning.
 */

const SvgTextEditor = {
    activeEditor: null,
    targetElement: null,
    lastStartTime: 0,

    _getSelectionTarget: function (el) {
        if (!el) return null;
        let target = el;
        let current = el.parent();
        // SVGルートに達するまで親を辿り、最上位のコンテナ（group等）を特定する
        while (current && current.type && current.type !== 'svg' && current.node) {
            const toolId = current.attr ? current.attr('data-tool-id') : null;
            if (toolId === 'group' || toolId === 'shape-text-group') {
                target = current;
            }
            current = current.parent();
        }
        return target;
    },

    startEditing: function (el, forceSvgPt) {
        if (this.activeEditor) {
            this.saveAndClose();
        }

        this.targetElement = el;
        this.lastStartTime = Date.now(); // [NEW] Track start time to prevent rapid-fire events

        // [FIX] Consistently delayed start to allow browser layout to settle.
        // Even with forceSvgPt, a small delay helps stability.
        setTimeout(() => {
            this._doStartEditing(el, forceSvgPt, 0);
        }, 32);
    },

    _doStartEditing: function (el, forceSvgPt, retryCount = 0) {
        if (this.targetElement !== el) return; // Guard against rapid clicks

        // Get text content. Prioritizes data-original-text for word-wrapped/truncated handling.
        let textContent = '';
        if (el.node.tagName.toLowerCase() === 'text') {
            const origAttr = el.attr('data-original-text');
            if (origAttr !== undefined && origAttr !== null) {
                textContent = typeof origAttr === 'string' ? origAttr : String(origAttr);
            } else {
                const textPath = el.node.querySelector('textPath');
                if (textPath) {
                    textContent = textPath.textContent;
                } else {
                    const tspans = Array.from(el.node.querySelectorAll('tspan'));
                    if (tspans.length > 0) {
                        textContent = tspans.map(tspan => tspan.textContent).join('\n');
                    } else {
                        textContent = el.node.textContent || '';
                    }
                }
            }
        }

        console.group(`[SvgTextEditor] Starting edit for element: ${el.id()}`);
        console.log(`1. SVGエディタ上の構造 (innerHTML):`, el.node.innerHTML);
        console.log(`2. SVGエディタ上のテキスト (node.textContent):`, el.node.textContent);
        console.log(`3. SVG.jsの内部キャッシュ (el.text()):`, el.text());
        console.log(`4. インラインエディタで表示する文字列:\n${textContent}`);
        if (el.attr('data-original-id') || el.attr('data-associated-text-id')) {
            console.log(`5. 関連テキストID: data-original-id=${el.attr('data-original-id')}, data-associated-text-id=${el.attr('data-associated-text-id')}`);
        }
        console.groupEnd();

        const root = el.root();
        const rootCtm = (root && root.node) ? root.node.getScreenCTM() : null;
        const localBox = el.rbox(root); // Logic box relative to root SVG coordinate system
        const baseFontSize = parseFloat(el.attr('font-size') || el.font('size') || 20);
        const anchor = el.attr('text-anchor') || 'start';

        // [FIX] Delayed start retry logic.
        // We only retry if we don't have a forced point and layout is zero.
        if (!forceSvgPt && (localBox.width === 0 || localBox.height === 0 || !rootCtm) && retryCount < 5) {
            setTimeout(() => this._doStartEditing(el, null, retryCount + 1), 16);
            return;
        }

        if (window.deselectAll && window.currentEditingSVG) {
            window.deselectAll();
        }

        let screenPt = { x: 0, y: 0 };
        let finalBbox = localBox;

        const elScreenCtm = el.node.getScreenCTM();
        if (elScreenCtm && el.node.ownerSVGElement) {
            finalBbox = el.node.getBBox(); // ローカル座標系における実際の形状ボックス
            
            // 幅・高さがない（空要素など）場合のフォールバック
            if (finalBbox.width === 0) {
                finalBbox.width = 10;
                finalBbox.x = parseFloat(el.attr('x')) || 0;
            }
            if (finalBbox.height === 0) {
                finalBbox.height = baseFontSize * 1.2;
                finalBbox.y = (parseFloat(el.attr('y')) || 0) - finalBbox.height / 2;
            }

            const pt = el.node.ownerSVGElement.createSVGPoint();
            if (forceSvgPt && rootCtm) {
                // クリック位置などの強制配置用座標がある場合
                pt.x = forceSvgPt.x;
                pt.y = forceSvgPt.y;
                screenPt = pt.matrixTransform(rootCtm);
            } else {
                pt.x = finalBbox.x;
                pt.y = finalBbox.y;
                // ローカル座標系の左上端に、自身の画面変換行列を適用することで、「画面上の確実な絶対座標」を得る
                screenPt = pt.matrixTransform(elScreenCtm);
            }
        } else {
            if (forceSvgPt && rootCtm && root) {
                const pt = root.node.createSVGPoint();
                pt.x = forceSvgPt.x;
                pt.y = forceSvgPt.y;
                screenPt = pt.matrixTransform(rootCtm);
            } else {
                const bruteRect = el.node.getBoundingClientRect();
                screenPt = { x: bruteRect.left, y: bruteRect.top };
            }
            finalBbox = el.bbox();
        }

        // Hide original element
        el.hide();

        console.log(`[SvgTextEditor] インラインエディタ起動 - SVG要素BBox: `, finalBbox);
        console.log(`[SvgTextEditor] インラインエディタ起動 - 画面配置座標 (画面左上): x=${screenPt.x}, y=${screenPt.y}, baseFontSize=${baseFontSize}`);

        const isActuallyEmpty = textContent.trim() === '';
        this._originalText = textContent;
        const bbox = finalBbox;

        const editor = document.createElement('div');
        editor.className = 'svg-inline-editor';
        editor.contentEditable = 'true';
        editor.innerText = isActuallyEmpty ? '' : textContent;

        const fontFamily = el.attr('font-family') || el.font('family') || 'sans-serif';
        const fill = el.attr('fill') || '#000000';

        editor.style.position = 'fixed';
        editor.style.transformOrigin = '0 0';
        editor.style.left = `${screenPt.x}px`;
        editor.style.top = `${screenPt.y}px`;

        let angle = 0;
        let scaleX = 1;
        let scaleY = 1;

        if (rootCtm) {
            scaleX = Math.sqrt(rootCtm.a * rootCtm.a + rootCtm.b * rootCtm.b);
            scaleY = Math.sqrt(rootCtm.c * rootCtm.c + rootCtm.d * rootCtm.d);
            const fullCtm = el.node.getScreenCTM();
            if (fullCtm) {
                angle = Math.atan2(fullCtm.b, fullCtm.a) * (180 / Math.PI);
            }
        }

        if (Math.abs(angle) > 0.1) {
            editor.style.transform = `rotate(${angle}deg)`;
        } else {
            editor.style.transform = 'none';
        }

        editor.style.width = `${bbox.width * scaleX}px`;
        editor.style.height = `${bbox.height * scaleY}px`;

        let screenFontSize = baseFontSize;
        if (scaleY > 0) {
            screenFontSize = baseFontSize * scaleY;
        }

        editor.style.fontSize = `${screenFontSize}px`;
        editor.style.fontFamily = fontFamily;
        editor.style.color = fill;
        
        let alignVal = 'left';
        if (anchor === 'middle') alignVal = 'center';
        else if (anchor === 'end') alignVal = 'right';
        editor.style.textAlign = alignVal;

        editor.style.margin = '0';
        editor.style.padding = '0';
        editor.style.border = 'none';
        editor.style.outline = '1px dashed #4b88e3';
        editor.style.background = 'transparent';
        editor.style.whiteSpace = 'pre';

        // 倍率ベースの行間設定をHTMLエディタのlineHeightに反映
        const targetForSpacing = this.targetElement;
        const parentForSpacing = targetForSpacing.parent();
        const hasGroupForSpacing = parentForSpacing && parentForSpacing.attr && parentForSpacing.attr('data-tool-id') === 'shape-text-group';
        const spacingAttr = hasGroupForSpacing ? (parentForSpacing.attr('data-line-spacing') || targetForSpacing.attr('data-line-spacing')) : targetForSpacing.attr('data-line-spacing');
        let spacingVal = parseFloat(spacingAttr);
        if (isNaN(spacingVal)) spacingVal = 1.2;
        const htmlLineHeight = spacingVal;

        editor.style.lineHeight = htmlLineHeight.toString();

        editor.style.zIndex = '999999';
        editor.style.minWidth = '10px';
        editor.style.minHeight = `${screenFontSize}px`;

        // [NEW] Writing Mode の反映
        const target = this.targetElement;
        const parent = target.parent();
        const hasGroup = parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group';
        const wm = hasGroup ? parent.attr('data-writing-mode') : target.attr('data-writing-mode');

        if (wm === 'v-rl') {
            editor.style.writingMode = 'vertical-rl';
            editor.style.direction = 'ltr';
            editor.style.unicodeBidi = 'normal';
        } else if (wm === 'h-rtl') {
            editor.style.writingMode = 'horizontal-tb';
            editor.style.direction = 'rtl';
            editor.style.unicodeBidi = 'bidi-override';
        } else {
            editor.style.writingMode = 'horizontal-tb';
            editor.style.direction = 'ltr';
            editor.style.unicodeBidi = 'normal';
        }

        editor.style.overflow = 'visible';

        document.body.appendChild(editor);
        editor.focus();
        if (!isActuallyEmpty) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        this.activeEditor = editor;
        this.onPointerDown = this.handlePointerDown.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('pointerdown', this.onPointerDown, true);
        editor.addEventListener('keydown', this.onKeyDown);

        // [FIX] インライン編集中はSVGキャンバスのズーム/パンを無効化する
        // 入力枚がフローティング中にキャンバスが動くと位置ずれが発生するため
        this.onWheelBlock = (e) => {
            const svgContainer = document.querySelector('.svg-editor-container, .svg-view-wrapper');
            if (svgContainer && svgContainer.contains(e.target)) {
                e.stopPropagation();
                e.preventDefault();
            }
        };
        document.addEventListener('wheel', this.onWheelBlock, { capture: true, passive: false });

        if (window.currentEditingSVG) {
            window.currentEditingSVG.isInlineEditing = true;
        }
    },

    saveAndClose: function (skipSelect = false) {
        if (!this.activeEditor || !this.targetElement) return;

        const newText = this.activeEditor.innerText || '';
        let lines = newText.split('\n');
        const isActuallyEmpty = newText.trim() === '';

        console.log('[SvgTextEditor] saveAndClose called', {
            targetId: this.targetElement.id(),
            skipSelect: skipSelect,
            newText: newText
        });

        if (isActuallyEmpty) {
            const target = this.targetElement;
            const parent = target.parent();
            const group = (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') ? parent : null;

            if (group) {
                let shape = null;
                const childrenList = group.children();
                for (let i = 0; i < childrenList.length; i++) {
                    const c = childrenList[i];
                    if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea') && !c.hasClass('svg-select-handle')) { shape = c; break; }
                }
                if (shape) {
                    group.before(shape);
                    group.remove();
                    if (window.makeInteractive) window.makeInteractive(shape);
                    if (!skipSelect && window.selectElement) {
                        window.selectElement(shape, false);
                    }
                } else {
                    group.remove();
                }
            } else {
                target.remove();
            }

            if (window.deselectAll && window.currentEditingSVG && !group) {
                window.deselectAll();
            }
            if (window.syncChanges) {
                window.syncChanges();
            }
            this.cleanup();
            return;
        }

        this.targetElement.show();

        const textNode = this.targetElement.node;
        const fontSize = parseFloat(this.targetElement.attr('font-size') || 14);

        // [FIX] 行間設定（data-line-spacing）の取得
        const group = this.targetElement.parent();
        const hasGroup = group && group.attr && group.attr('data-tool-id') === 'shape-text-group';
        const spacingAttr = hasGroup ? (group.attr('data-line-spacing') || this.targetElement.attr('data-line-spacing')) : this.targetElement.attr('data-line-spacing');

        // 倍率ベースでの行間解釈
        let spacingVal = parseFloat(spacingAttr);
        if (isNaN(spacingVal)) spacingVal = 1.2;
        
        let finalFontSize = parseFloat(this.targetElement.css('font-size') || this.targetElement.attr('font-size'));
        if (isNaN(finalFontSize) || finalFontSize <= 0) {
            if (window.getComputedStyle) {
                const cs = window.getComputedStyle(this.targetElement.node);
                if (cs && cs.fontSize) {
                    const zoom = (window.currentEditingSVG && window.currentEditingSVG.zoom) ? (window.currentEditingSVG.zoom / 100) : 1;
                    finalFontSize = parseFloat(cs.fontSize) / zoom;
                }
            }
        }
        if (isNaN(finalFontSize) || finalFontSize <= 0) finalFontSize = fontSize;
        if (isNaN(finalFontSize) || finalFontSize <= 0) finalFontSize = 14;
        
        const lineHeight = finalFontSize * spacingVal;


        // [FIX] Flatten translation into x/y attributes to prevent double-offsetting.
        const m = this.targetElement.matrix();
        const attrX = parseFloat(this.targetElement.attr('x')) || 0;
        const attrY = parseFloat(this.targetElement.attr('y')) || 0;
        const curX = attrX + (m ? m.e : 0);
        const curY = attrY + (m ? m.f : 0);
        const rotation = (this.targetElement.transform().rotate || 0);

        const anchor = this.targetElement.attr('text-anchor') || 'start';
        const baseline = this.targetElement.attr('dominant-baseline') || 'alphabetic';

        console.log(`[SvgTextEditor] テキスト配置確定 - 座標: x=${curX}, y=${curY}, baseline=${baseline}, fontSize=${finalFontSize}`);

        // Apply flattened coordinates and reset transform (keep only rotation)
        this.targetElement.attr({
            'x': curX,
            'y': curY,
            'transform': rotation ? `rotate(${rotation} ${curX} ${curY})` : null
        });

        // Check if there was a textPath
        const existingTextPath = textNode.querySelector('textPath');
        let textPathData = null;
        if (existingTextPath) {
            textPathData = {
                href: existingTextPath.getAttribute('href') || existingTextPath.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
                startOffset: existingTextPath.getAttribute('startOffset')
            };
        }

        // [FIX] newText の不要な連続改行や末尾の改行を防ぐ
        const cleanText = newText.replace(/\r/g, '').replace(/\n+$/, '');
        
        // 編集された元のテキスト全体を常に保持
        this.targetElement.attr('data-original-text', cleanText);
        
        lines = cleanText.split('\n');

        // [NEW] グループ（Shape with Text）の場合、背景図形のサイズに合わせて自動折り返しおよび省略表示を適用する
        if (hasGroup && typeof window.SVGUtils !== 'undefined' && typeof window.SVGUtils.wrapAndTruncateText === 'function') {
            // 背景となる図形要素を取得（基本的に一番最初の要素、またはrect/ellipse等）
            let bgShape = null;
            group.children().forEach(ch => {
                if (!bgShape && ch.type !== 'text' && ch.type !== 'defs' && ch.type !== 'title' && ch.type !== 'desc') {
                    bgShape = ch;
                }
            });
            
            if (bgShape) {
                let locW = parseFloat(bgShape.attr('width'));
                let locH = parseFloat(bgShape.attr('height'));
                
                if (isNaN(locW) || locW <= 0) {
                    const sb = typeof bgShape.bbox === 'function' ? bgShape.bbox() : { width: 0, height: 0 };
                    locW = sb.width;
                    locH = sb.height;
                }

                if (locW > 0) {
                    // グループのtransformスケール（sx, sy）を加味してスクリーン上の視覚的サイズに合わせる
                    const gMatrix = group.matrix();
                    const sx = Math.sqrt(gMatrix.a * gMatrix.a + gMatrix.b * gMatrix.b);
                    const sy = Math.sqrt(gMatrix.c * gMatrix.c + gMatrix.d * gMatrix.d);
                    
                    let visualW = locW;
                    let visualH = locH;
                    if (sx > 0.01 && sx !== 1) visualW *= sx;
                    if (sy > 0.01 && sy !== 1) visualH *= sy;

                    const fontOpts = {
                        fontSize: finalFontSize,
                        fontFamily: this.targetElement.attr('font-family') || this.targetElement.font('family') || 'sans-serif'
                    };
                    lines = window.SVGUtils.wrapAndTruncateText(cleanText, visualW, visualH, fontOpts, spacingVal);
                }
            }
        }

        if (textPathData && textPathData.href) {
            // Clear existing safely
            while (textNode.firstChild) {
                textNode.removeChild(textNode.firstChild);
            }
            // Restore textPath
            const textPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
            textPathEl.setAttribute('href', textPathData.href);
            if (textPathData.startOffset) {
                textPathEl.setAttribute('startOffset', textPathData.startOffset);
            }
            // textPath does not support multiline nicely, convert to spaces
            textPathEl.textContent = cleanText.replace(/\n/g, ' ');
            textNode.appendChild(textPathEl);
        } else {
            // [FIX] Use SVG.js API instead of Native DOM API to reconstruct tspans.
            // This is CRITICAL because SVG.js maintains an internal cache of text structure.
            // If we use Native DOM API, SVG.js's clone() method will lose the text on native Copy/Paste.
            this.targetElement.clear();

            this.targetElement.text(add => {
                lines.forEach((line, i) => {
                    const safeLine = line === '' ? '\u200B' : line;
                    const tspan = add.tspan(safeLine);
                    tspan.attr({
                        'x': curX,
                        'dy': i === 0 ? '0' : `${lineHeight}`,
                        'text-anchor': anchor,
                        'dominant-baseline': baseline
                    });
                });
            });
        }

        const targetEl = this.targetElement;
        requestAnimationFrame(() => {
            if (!targetEl || !targetEl.node || !targetEl.node.isConnected) return;

            // [FIX] Re-integrate auto-alignment
            if (window.SVGTextAlignmentToolbar && typeof window.SVGTextAlignmentToolbar.updateTextPosition === 'function') {
                const parent = targetEl.parent();
                const target = (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') ? parent : targetEl;
                window.SVGTextAlignmentToolbar.updateTextPosition(target);
            }

            if (!skipSelect && window.selectElement && window.currentEditingSVG) {
                const elToSelect = this._getSelectionTarget(targetEl);
                const shapeInstance = elToSelect.remember('_shapeInstance');
                if (shapeInstance && typeof shapeInstance.updateHitArea === 'function') shapeInstance.updateHitArea();
                window.selectElement(elToSelect, false);
            }

            if (window.syncChanges) {
                window.syncChanges();
            }
        });

        this.cleanup();
    },

    cancelAndClose: function () {
        if (!this.activeEditor || !this.targetElement) return;
        console.log('[SvgTextEditor] cancelAndClose called');

        if ((this._originalText || '').trim() === '') {
            const target = this.targetElement;
            const parent = target.parent();
            const group = (parent && parent.attr && parent.attr('data-tool-id') === 'shape-text-group') ? parent : null;
            if (group) {
                let shape = null;
                const childrenList = group.children();
                for (let i = 0; i < childrenList.length; i++) {
                    const c = childrenList[i];
                    if (c.type !== 'text' && !c.hasClass('svg-interaction-hitarea') && !c.hasClass('svg-select-handle')) { shape = c; break; }
                }
                if (shape) {
                    group.before(shape);
                    group.remove();
                    if (window.makeInteractive) window.makeInteractive(shape);
                    if (window.selectElement) window.selectElement(shape, false);
                } else {
                    group.remove();
                }
            } else {
                target.remove();
            }
            if (window.deselectAll && window.currentEditingSVG && !group) window.deselectAll();
            if (window.syncChanges) window.syncChanges();
            this.cleanup();
            return;
        }

        this.targetElement.show();
        if (window.selectElement && window.currentEditingSVG) {
            const elToSelect = this._getSelectionTarget(this.targetElement);
            const shapeInstance = elToSelect.remember('_shapeInstance');
            if (shapeInstance && typeof shapeInstance.updateHitArea === 'function') shapeInstance.updateHitArea();
            window.selectElement(elToSelect, false);
        }
        this.cleanup();
    },

    cleanup: function () {
        console.log('[SvgTextEditor] cleanup called');
        if (this.activeEditor) {
            document.removeEventListener('pointerdown', this.onPointerDown, true);
            this.activeEditor.removeEventListener('keydown', this.onKeyDown);
            this.activeEditor.remove();
            this.activeEditor = null;
        }

        // [FIX] インライン編集中に登録したズーム/パンブロックリスナーを解除
        if (this.onWheelBlock) {
            document.removeEventListener('wheel', this.onWheelBlock, { capture: true, passive: false });
            this.onWheelBlock = null;
        }

        if (window.currentEditingSVG) {
            window.currentEditingSVG.isInlineEditing = false;
        }
        this.targetElement = null;

        const container = (window.currentEditingSVG && window.currentEditingSVG.container) ? window.currentEditingSVG.container : document.querySelector('.svg-editor-container');
        if (container) {
            if (container.getAttribute('tabindex') === null) {
                container.setAttribute('tabindex', '-1');
            }
            container.focus({ preventScroll: true });
        }
    },

    handlePointerDown: function (e) {
        if (this.activeEditor && !this.activeEditor.contains(e.target)) {
            e.stopPropagation();
            this.saveAndClose();
        }
    },

    handleKeyDown: function (e) {
        console.log(`[SvgTextEditor] handleKeyDown: key=${e.key}, code=${e.code}, ctrl=${e.ctrlKey}, isComposing=${e.isComposing}`);

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelAndClose();
            return;
        }

        const isEnter = e.key === 'Enter' || e.code === 'Enter';
        if (isEnter && e.ctrlKey) {
            e.preventDefault();
            this.saveAndClose();
            return;
        }

        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();

            if (Date.now() - this.lastStartTime < 150) return;

            let searchRoot = this.targetElement ? this.targetElement.parent() : null;
            if (searchRoot && searchRoot.type === 'g') {
                let current = searchRoot.parent();
                while (current && current.type && current.type !== 'svg' && current.node) {
                    if (current.attr && current.attr('data-tool-id') === 'group') {
                        searchRoot = current;
                    }
                    current = current.parent();
                }

                const texts = Array.from(searchRoot.find('text'));
                if (texts.length > 1) {
                    const currentIndex = texts.indexOf(this.targetElement);
                    const direction = e.shiftKey ? -1 : 1;
                    const nextIndex = (currentIndex + direction + texts.length) % texts.length;
                    const nextEl = texts[nextIndex];
                    const nextId = nextEl.id();

                    nextEl.attr('data-tab-next', 'true');
                    this.saveAndClose(true);

                    setTimeout(() => {
                        const root = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
                        let resolvedEl = root ? root.findOne('[data-tab-next="true"]') : null;
                        if (resolvedEl) resolvedEl.attr('data-tab-next', null);
                        if (!resolvedEl) resolvedEl = SVG('#' + nextId);
                        if (resolvedEl) this.startEditing(resolvedEl);
                    }, 150);
                    return;
                }
            }
            this.saveAndClose();
            return;
        }
        e.stopPropagation();
    }
};

window.addEventListener('blur', () => {
    console.log(`[SvgTextEditor FOCUS] Window BLUR! Active element: ${document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : 'null'}`);
}, true);

window.SvgTextEditor = SvgTextEditor;
