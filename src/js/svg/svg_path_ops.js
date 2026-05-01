/**
 * SVG Path Operations
 * Provides logic for flipping, combining, and subtracting (clipping) SVG shapes.
 * Includes a true boolean operation engine for outline extraction.
 */
const SVGPathOps = {
    flip(elements, axis) {
        if (!elements || elements.length === 0) return;
        let targetBox;
        if (elements.length === 1) targetBox = elements[0].bbox();
        else {
            let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
            elements.forEach(el => {
                const b = el.bbox();
                x = Math.min(x, b.x); y = Math.min(y, b.y);
                x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2);
            });
            targetBox = { cx: (x + x2) / 2, cy: (y + y2) / 2 };
        }
        elements.forEach(el => {
            if (axis === 'x') el.flip('x', targetBox.cx);
            else el.flip('y', targetBox.cy);
            this.bakeTransform(el);
            if (window.SVGUtils && window.SVGUtils.refreshPathMetadata) window.SVGUtils.refreshPathMetadata(el);
        });
    },

    bakeTransform(el) {
        const matrix = el.matrix();
        // SVG.js v3 matrix has direct properties: a, b, c, d, e, f
        if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0) return;
        const type = el.type; if (type !== 'path' && type !== 'polyline' && type !== 'polygon' && type !== 'line') return;
        const pArray = el.array(), transformed = this._transformArray(pArray, matrix);
        el.plot(transformed); el.untransform();
    },

    // Cache for loaded fonts during the session
    _cachedFonts: {},

    /**
     * Prompts the user to select a font file using standard browser input
     * @returns {Promise<opentype.Font|null>}
     */
    async _promptForFontFile(fontFamily) {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ttf, .otf, .ttc';
            input.style.display = 'none';
            document.body.appendChild(input);

            // [NEW] Window focus fallback to detect dialog cancellation (for browsers failing to fire oncancel)
            const cleanupFocus = () => {
                window.removeEventListener('focus', onFocusDelay);
            };

            const onFocusDelay = () => {
                // Wait slightly because 'change' might fire right after focus if a file was chosen
                setTimeout(() => {
                    if (input.parentNode && !input.value) {
                        document.body.removeChild(input);
                        cleanupFocus();
                        resolve(null);
                    }
                }, 1000);
            };
            window.addEventListener('focus', onFocusDelay);

            input.onchange = async (e) => {
                cleanupFocus();
                const file = e.target.files[0];
                document.body.removeChild(input);
                if (!file) {
                    resolve(null);
                    return;
                }

                try {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const font = opentype.parse(event.target.result);
                            resolve(font);
                        } catch (pe) {
                            console.error("[Outline] Font parse error:", pe);
                            if (pe && pe.message) {
                                alert(t('alert.fontParseFailed').replace('${file.name}', file.name).replace('${pe.message}', pe.message));
                            } else {
                                resolve(null);
                            }
                        }
                    };
                    reader.onerror = (err) => {
                        alert(t('alert.fileReadFailedExt').replace('${file.name}', file.name));
                    };
                    reader.readAsArrayBuffer(file);
                } catch (fe) {
                    cleanupFocus();
                    console.error("[Outline] File read error:", fe);
                    resolve(null);
                }
            };

            input.oncancel = () => {
                cleanupFocus();
                if (input.parentNode) document.body.removeChild(input);
                resolve(null);
            };

            // Trigger file dialog
            try {
                input.click();
            } catch (err) {
                console.warn("[Outline] Failed to show file picker due to missing user activation or security error.", err);
                cleanupFocus();
                if (input.parentNode) document.body.removeChild(input);
                resolve(null);
            }
        });
    },

    /**
     * Attempts to load a font from the Local Font API cache populated by the Font Toolbar.
     */
    async _loadFromLocalFontAPI(fontFamilyStr, textToCheck) {
        console.log(`[Outline] _loadFromLocalFontAPI called with: '${fontFamilyStr}', textToCheck length: ${textToCheck ? textToCheck.length : 0}`);

        if (!window._localFontDataMap) {
            console.warn(`[Outline] window._localFontDataMap is missing. Attempting JIT local font sync...`);
            if ('queryLocalFonts' in window) {
                try {
                    const localFonts = await window.queryLocalFonts();
                    window._localFontDataMap = new Map();
                    localFonts.forEach(font => {
                        const family = font.family.toLowerCase();
                        const style = font.style.toLowerCase();
                        // Cache using composite keys for precise matching
                        window._localFontDataMap.set(`${family}-${style}`, font);

                        // Fallback: If it's regular/standard, or if the family isn't registered yet, register as the default "family" key
                        if (!window._localFontDataMap.has(family) || style === 'regular' || style === 'normal') {
                            window._localFontDataMap.set(family, font);
                        }
                    });
                    console.log(`[Outline] JIT sync completed successfully. Cached ${window._localFontDataMap.size} fonts.`);
                } catch (e) {
                    console.error(`[Outline] JIT Local font access failed (permission denied or user activation missing?):`, e);
                    return null;
                }
            } else {
                return null;
            }
        }

        console.log(`[Outline] Map active. Cached names size: ${window._localFontDataMap.size}`);

        const fontNames = fontFamilyStr.split(',').map(f => f.replace(/['"]/g, '').trim().toLowerCase());

        // Add common system fallback fonts natively to the check list in case the primary web fonts fail the glyph test
        const fallbackFonts = ['biz udgothic', 'biz udmincho', 'meiryo', 'yu gothic', 'hiragino sans', 'hiragino kaku gothic pron', 'ms pgothic', 'segoe ui', 'arial unicode ms', 'arial'];
        const allFontsToCheck = [...fontNames, ...fallbackFonts];

        console.log(`[Outline] Checking sequence: `, allFontsToCheck);

        for (const fontName of allFontsToCheck) {
            if (window._localFontDataMap.has(fontName)) {
                console.log(`[Outline] Found physical font: ${fontName}. Initiating parse...`);
                try {
                    const fontData = window._localFontDataMap.get(fontName);
                    const blob = await fontData.blob();
                    const buffer = await blob.arrayBuffer();
                    
                    let parseBuffer = buffer;
                    const view = new DataView(parseBuffer);
                    const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
                    if (tag === 'ttcf') {
                        console.log(`[Outline] TTC file detected for ${fontName}. Extracting first TTF...`);
                        const offset0 = view.getUint32(12);
                        const numTables = view.getUint16(offset0 + 4);
                        let newSize = 12 + 16 * numTables;
                        const tables = [];
                        for (let i = 0; i < numTables; i++) {
                            const recordOffset = offset0 + 12 + i * 16;
                            const gtag = String.fromCharCode(view.getUint8(recordOffset), view.getUint8(recordOffset+1), view.getUint8(recordOffset+2), view.getUint8(recordOffset+3));
                            const checkSum = view.getUint32(recordOffset + 4);
                            const toffset = view.getUint32(recordOffset + 8);
                            const length = view.getUint32(recordOffset + 12);
                            const paddedLength = (length + 3) & ~3;
                            tables.push({ gtag, checkSum, toffset, length, paddedLength });
                            newSize += paddedLength;
                        }
                        const outBuffer = new ArrayBuffer(newSize);
                        const outView = new DataView(outBuffer);
                        const outBytes = new Uint8Array(outBuffer);
                        const inBytes = new Uint8Array(parseBuffer);
                        for(let i = 0; i < 12; i++) outBytes[i] = inBytes[offset0 + i];
                        let currentDataOffset = 12 + 16 * numTables;
                        for (let i = 0; i < numTables; i++) {
                            const t = tables[i];
                            const recordOffset = 12 + i * 16;
                            outBytes[recordOffset] = t.gtag.charCodeAt(0);
                            outBytes[recordOffset+1] = t.gtag.charCodeAt(1);
                            outBytes[recordOffset+2] = t.gtag.charCodeAt(2);
                            outBytes[recordOffset+3] = t.gtag.charCodeAt(3);
                            outView.setUint32(recordOffset + 4, t.checkSum);
                            outView.setUint32(recordOffset + 8, currentDataOffset);
                            outView.setUint32(recordOffset + 12, t.length);
                            outBytes.set(inBytes.subarray(t.toffset, t.toffset + t.length), currentDataOffset);
                            currentDataOffset += t.paddedLength;
                        }
                        parseBuffer = outBuffer;
                    }

                    const font = opentype.parse(parseBuffer);

                    console.log(`[Outline] Opentype parsed ${fontName} successfully. Validating glyphs...`);

                    // [NEW] Check if the font actually supports the characters and doesn't output missing tofu squares (.notdef)
                    let missingCount = 0;
                    let validLength = 0;

                    if (textToCheck && textToCheck.length > 0) {
                        for (let i = 0; i < Math.min(textToCheck.length, 100); i++) {
                            const char = textToCheck[i];
                            // Ignore invisible control characters and spaces
                            if (char.trim() === '' || char.charCodeAt(0) < 32 || char === '\u200B') {
                                continue;
                            }
                            validLength++;
                            try {
                                const glyph = font.charToGlyph(char);
                                // .notdef (0) is missing glyph
                                if (!glyph || glyph.index === 0) missingCount++;
                            } catch (err) {
                                missingCount++;
                            }
                        }
                        // If more than 30% of VALID sample characters are missing, skip this font
                        if (validLength > 0 && (missingCount / validLength) > 0.3) {
                            console.warn(`[Outline] Font ${fontName} skipped: lacks glyphs for text. (${missingCount}/${validLength} missing)`);
                            continue;
                        }
                    }

                    console.log(`[Outline] ACCEPTED! Font ${fontName} passes metrics (${missingCount}/${validLength} missing). Extracting Outlines...`);
                    return font;
                } catch (e) {
                    console.warn(`[Outline] Failed to parse local font ${fontName} (File might be an unsupported TTC collection):`, e);
                }
            } else {
                // Log silenced for brevity
            }
        }

        console.warn(`[Outline] Reached end of fallback array and no font was successfully generated!`);
        return null;
    },

    /**
     * Convert elements to paths (Outlining)
     */
    async convertToOutline(elements) {
        if (!elements || elements.length === 0) return;
        console.log(`[Outline] Processing ${elements.length} top-level elements.`);

        const results = [];
        const draw = elements[0].root();
        let hasTextSkipped = false;

        // 1. 選択された各トップレベル要素に対して処理
        // 元の要素を削除するため、配列をコピーしておく
        const originalSelection = Array.from(elements);

        for (const topEl of originalSelection) {
            // 再帰的に描画要素を収集
            const targets = [];
            const collect = (el) => {
                const type = el.type;
                if (type === 'g' || type === 'svg') {
                    // SVG.jsのListに対して安全に反復処理
                    Array.from(el.children()).forEach(child => collect(child));
                } else {
                    // Only collect renderable graphics elements
                    const nonRenderable = ['style', 'defs', 'marker', 'mask', 'pattern', 'clipPath', 'title', 'desc', 'metadata'];
                    if (!nonRenderable.includes(type)) {
                        targets.push(el);
                    }
                }
            };
            collect(topEl);
            console.log(`[Outline] Found ${targets.length} renderable targets in ${topEl.id()}. Types:`, targets.map(t => t.type));

            let convertedCount = 0;
            for (const el of targets) {
                const type = el.type;
                let newPath = null;

                // Safe CTM retrieval based on screen bounding relative offset (bypass viewBox scaling double-ups)
                let ctm = null;
                try {
                    if (el.node && draw && draw.node) {
                        const svgViewportMatrix = draw.node.getScreenCTM();
                        const elMatrix = el.node.getScreenCTM();
                        if (svgViewportMatrix && elMatrix) {
                            ctm = svgViewportMatrix.inverse().multiply(elMatrix);
                        }
                    }
                    if (!ctm && el.node && typeof el.node.getCTM === 'function') {
                        ctm = el.ctm(); // Fallback
                    }
                } catch (e) { console.warn("[Outline] Failed to get relative CTM for", type, el.id()); }

                // If we couldn't get CTM, we can't accurately convert it
                if (!ctm) {
                    console.warn(`[Outline] No CTM available for ${type} (${el.id()}). Skipping.`);
                    continue;
                }

                try {
                    if (type === 'text') {
                        let fontFamily = el.attr('font-family') || "Arial";
                        try {
                            const computedStyle = window.getComputedStyle(el.node);
                            if (computedStyle.fontFamily) {
                                fontFamily = computedStyle.fontFamily;
                            } else if (el.node.style.fontFamily) {
                                fontFamily = el.node.style.fontFamily;
                            }
                        } catch (e) { }
                        fontFamily = fontFamily.replace(/['"]/g, '').trim();

                        const rawTextContent = el.text() || el.node.textContent || "";
                        if (!this._cachedFonts[fontFamily]) {
                            const localFont = await this._loadFromLocalFontAPI(fontFamily, rawTextContent);
                            if (localFont) {
                                this._cachedFonts[fontFamily] = localFont;
                            } else {
                                const f = await this._promptForFontFile(fontFamily);
                                if (f) this._cachedFonts[fontFamily] = f;
                            }
                        }
                        const font = this._cachedFonts[fontFamily];
                        if (font) {
                            let fontSize = 16;
                            try {
                                const computedStyle = window.getComputedStyle(el.node);
                                if (computedStyle.fontSize) {
                                    fontSize = parseFloat(computedStyle.fontSize);
                                } else if (el.node.style.fontSize) {
                                    fontSize = parseFloat(el.node.style.fontSize);
                                } else if (el.attr('font-size')) {
                                    fontSize = parseFloat(el.attr('font-size'));
                                }
                            } catch (e) {
                                fontSize = parseFloat(el.attr('font-size')) || 16;
                            }

                            const anchor = el.attr('text-anchor') || 'start';
                            const tspans = Array.from(el.node.querySelectorAll('tspan'));

                            const fullConvertedPath = []; // Use native Array to prevent automatic 'M 0 0' prepending

                            if (tspans.length > 0) {
                                // Multi-line
                                let cumulativeY = parseFloat(el.attr('y')) || 0;
                                tspans.forEach((tspan, idx) => {
                                    const textChunk = tspan.textContent;
                                    if (!textChunk.trim()) return;

                                    const cx = parseFloat(tspan.getAttribute('x') || el.attr('x')) || 0;
                                    if (tspan.hasAttribute('y')) {
                                        cumulativeY = parseFloat(tspan.getAttribute('y'));
                                    }

                                    let dy = 0;
                                    const dyStr = tspan.getAttribute('dy');
                                    if (dyStr) {
                                        if (dyStr.endsWith('em')) dy = parseFloat(dyStr) * fontSize;
                                        else dy = parseFloat(dyStr) || 0;
                                    }
                                    cumulativeY += dy;

                                    let targetY = cumulativeY;
                                    try {
                                        // Calculate the OS/Browser hidden visual displacement for baselines
                                        const nativeBox = tspan.getBBox();
                                        const ascenderPx = (font.ascender / font.unitsPerEm) * fontSize;
                                        const opentypeEmTop = cumulativeY - ascenderPx;
                                        const dyCorrection = nativeBox.y - opentypeEmTop;
                                        // Guard against massive glitches in SVG spec implementation
                                        if (Math.abs(dyCorrection) < fontSize * 2) {
                                            targetY += dyCorrection;
                                        }
                                    } catch (e) { }

                                    let startX = cx;
                                    if (anchor === 'middle') startX -= font.getAdvanceWidth(textChunk, fontSize) / 2;
                                    else if (anchor === 'end') startX -= font.getAdvanceWidth(textChunk, fontSize);

                                    const chunkOpPath = font.getPath(textChunk, startX, targetY, fontSize);
                                    const chunkArray = new SVG.PathArray(chunkOpPath.toPathData());
                                    // merge arrays
                                    const iterableArray = chunkArray.value || chunkArray;
                                    iterableArray.forEach(seg => fullConvertedPath.push(seg));
                                });
                            } else {
                                // Single line
                                const textChunk = el.node.textContent || "";
                                const cx = parseFloat(el.attr('x')) || 0;
                                const cy = parseFloat(el.attr('y')) || 0;

                                let targetY = cy;
                                try {
                                    // BBox tracks browser's hidden line metric shift which opentype glyf math misses
                                    const nativeBox = el.node.getBBox();
                                    const ascenderPx = (font.ascender / font.unitsPerEm) * fontSize;
                                    const opentypeEmTop = cy - ascenderPx;
                                    const dyCorrection = nativeBox.y - opentypeEmTop;
                                    if (Math.abs(dyCorrection) < fontSize * 2) {
                                        targetY += dyCorrection;
                                    }
                                } catch (e) { }

                                let startX = cx;
                                if (anchor === 'middle') startX -= font.getAdvanceWidth(textChunk, fontSize) / 2;
                                else if (anchor === 'end') startX -= font.getAdvanceWidth(textChunk, fontSize);

                                const chunkOpPath = font.getPath(textChunk, startX, targetY, fontSize);
                                // Merge instead of root replacing using .parse()
                                const chunkArray = new SVG.PathArray(chunkOpPath.toPathData());
                                const iterableArray = chunkArray.value || chunkArray;
                                iterableArray.forEach(seg => fullConvertedPath.push(seg));
                            }

                            const transformed = this._transformArray(fullConvertedPath, ctm);

                            const finalD = transformed.map(seg => Array.isArray(seg) ? seg.join(' ') : seg).join(' ');
                            newPath = draw.path(finalD);
                        } else {
                            hasTextSkipped = true;
                        }
                    } else {
                        const supportedShapes = ['rect', 'circle', 'ellipse', 'polyline', 'polygon', 'line', 'path'];
                        if (supportedShapes.includes(type)) {
                            const d = this.convertToPathData(el, ctm);
                            if (d) {
                                newPath = draw.path(d);
                            } else {
                                console.warn(`[Outline] No path data for ${type} (${el.id()})`);
                            }
                        } else {
                            console.warn(`[Outline] Skipping unsupported type: ${type} (${el.id()})`);
                        }
                    }

                    if (newPath) {
                        // Copy style attributes
                        const attrsToCopy = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule'];
                        let compStyle = null;
                        try { compStyle = window.getComputedStyle(el.node); } catch(e) {}
                        
                        attrsToCopy.forEach(attr => {
                            let val = el.attr(attr);
                            if ((val === undefined || val === null) && compStyle) {
                                const camelAttr = attr.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                                const cVal = compStyle[camelAttr];
                                if (cVal && cVal !== '' && cVal !== 'rgba(0, 0, 0, 0)' && cVal !== 'transparent') {
                                    val = cVal;
                                }
                            }
                            if (val !== undefined && val !== null) {
                                newPath.attr(attr, val);
                            }
                        });

                        // Fallback for text: usually black if no fill is defined
                        if (type === 'text' && !newPath.attr('fill')) {
                            newPath.attr('fill', '#000000');
                        }

                        // Metadata for vertex editing
                        try {
                            const minData = this._extractMinimalPoints(newPath.array());
                            if (minData && minData.points.length > 0) {
                                newPath.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
                                newPath.attr('data-bez-points', JSON.stringify(minData.bezData));
                                newPath.attr('data-tool-id', 'polyline');
                                newPath.attr('data-poly-closed', 'true');
                            }
                        } catch (e) { console.error("[Outline] Extraction failed:", e); }

                        // Insert new path
                        topEl.before(newPath);
                        results.push(newPath);
                        convertedCount++;
                        if (window.makeInteractive) window.makeInteractive(newPath);
                    }
                } catch (err) {
                    console.error(`[Outline] Error converting ${type} (${el.id()}):`, err);
                }
            }

            // [FIX] Ensure the original element is deselected BEFORE removal
            // Otherwise its selection handles (which are in separate groups) will orphanage in the DOM.
            if (window.deselectElement) {
                window.deselectElement(topEl);
            }
            if (convertedCount > 0) {
                topEl.remove();
            } else {
                console.warn(`[Outline] No elements converted in ${topEl.id()}. Keeping original node.`);
            }
        }

        if (hasTextSkipped) {
            const msg = "フォントが選択されなかったため、一部のテキスト要素の変換をスキップしました。";
            if (window.showToast) window.showToast(msg);
            else alert(msg);
        }

        if (results.length > 0 && window.selectElement) {
            window.selectElement(results[results.length - 1]);
        }
        console.log(`[Outline] Finalized: Converted ${results.length} total elements to paths.`);
    },

    combine(elements) {
        console.log("[Combine] Called with", elements ? elements.length : 0, "elements.");
        if (!elements || elements.length < 2) return;

        // 画像分岐：<image>要素が含まれる場合はクリッピングモード
        const images = elements.filter(el => el.type === 'image');
        const vectors = elements.filter(el => el.type !== 'image');
        if (images.length > 0 && vectors.length > 0) {
            console.log("[Combine] Image+Vector mode. Applying clipPath.");
            const clipPathD = vectors.length === 1
                ? this._getPathDataInParentSpace(vectors[0])
                : this._performBoolean(vectors, 'union');
            if (clipPathD) {
                images.forEach(img => this._applyClipPathToImage(img, clipPathD));
                images.forEach(img => { if (window.makeInteractive) window.makeInteractive(img); });
            }
            vectors.forEach(v => v.remove());
            if (images.length > 0 && window.selectElement) window.selectElement(images[0]);
            if (window.syncChanges) window.syncChanges();
            return;
        }

        const sorted = [...elements].sort((a, b) => Array.from(a.node.parentNode.children).indexOf(a.node) - Array.from(b.node.parentNode.children).indexOf(b.node));
        const first = sorted[0], draw = first.root(), finalD = this._performBoolean(sorted, 'union');
        if (!finalD) return;
        const newPath = draw.path(finalD);
        Array.from(first.node.attributes).forEach(attr => { if (!['id', 'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform'].includes(attr.name)) newPath.attr(attr.name, attr.value); });
        newPath.attr('fill-rule', 'nonzero'); first.before(newPath);
        sorted.forEach(el => { el.remove(); });
        let minData; try { minData = this._extractMinimalPoints(newPath.array()); } catch (e) { return; }
        if (minData && minData.points.length > 0) {
            newPath.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
            newPath.attr('data-bez-points', JSON.stringify(minData.bezData));
            newPath.attr('data-tool-id', 'polyline'); newPath.attr('data-poly-closed', 'true');
        }
        if (window.makeInteractive) window.makeInteractive(newPath);
        if (window.selectElement) window.selectElement(newPath);
    },

    subtract(elements) {
        console.log("[Subtract] Called with", elements ? elements.length : 0, "elements.");
        if (!elements || elements.length < 2) return;

        // 画像分岐：<image>要素が含まれる場合は逆クリッピングモード
        const images = elements.filter(el => el.type === 'image');
        const vectors = elements.filter(el => el.type !== 'image');
        if (images.length > 0 && vectors.length > 0) {
            console.log("[Subtract] Image+Vector mode. Applying inverse clipPath.");
            images.forEach(img => {
                const clipPathD = this._computeSubtractFromRect(img, vectors);
                if (clipPathD) this._applyClipPathToImage(img, clipPathD);
                if (window.makeInteractive) window.makeInteractive(img);
            });
            vectors.forEach(v => v.remove());
            if (images.length > 0 && window.selectElement) window.selectElement(images[0]);
            if (window.syncChanges) window.syncChanges();
            return;
        }

        const sorted = [...elements].sort((a, b) => Array.from(a.node.parentNode.children).indexOf(a.node) - Array.from(b.node.parentNode.children).indexOf(b.node));
        const bottom = sorted[0], draw = bottom.root(), finalD = this._performBoolean(sorted, 'subtract');
        if (!finalD) return;
        const newPath = draw.path(finalD);
        Array.from(bottom.node.attributes).forEach(attr => { if (!['id', 'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform'].includes(attr.name)) newPath.attr(attr.name, attr.value); });
        newPath.attr('fill-rule', 'evenodd'); bottom.before(newPath);
        sorted.forEach(el => { el.remove(); });
        let minData; try { minData = this._extractMinimalPoints(newPath.array()); } catch (e) { return; }
        if (minData && minData.points.length > 0) {
            newPath.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
            newPath.attr('data-bez-points', JSON.stringify(minData.bezData));
            newPath.attr('data-tool-id', 'polyline'); newPath.attr('data-poly-closed', 'true');
        }
        if (window.makeInteractive) window.makeInteractive(newPath);
        if (window.selectElement) window.selectElement(newPath);
    },

    intersect(elements) {
        console.log("[Intersect] Called with", elements ? elements.length : 0, "elements.");
        if (!elements || elements.length < 2) return;

        // 画像分岐：<image>要素が含まれる場合はクリッピングモード
        const images = elements.filter(el => el.type === 'image');
        const vectors = elements.filter(el => el.type !== 'image');
        if (images.length > 0 && vectors.length > 0) {
            console.log("[Intersect] Image+Vector mode. Applying clipPath.");
            const clipPathD = vectors.length === 1
                ? this._getPathDataInParentSpace(vectors[0])
                : this._performBoolean(vectors, 'union');
            if (clipPathD) {
                images.forEach(img => this._applyClipPathToImage(img, clipPathD));
                images.forEach(img => { if (window.makeInteractive) window.makeInteractive(img); });
            }
            vectors.forEach(v => v.remove());
            if (images.length > 0 && window.selectElement) window.selectElement(images[0]);
            if (window.syncChanges) window.syncChanges();
            return;
        }

        const sorted = [...elements].sort((a, b) => Array.from(a.node.parentNode.children).indexOf(a.node) - Array.from(b.node.parentNode.children).indexOf(b.node));
        const bottom = sorted[0], draw = bottom.root(), finalD = this._performBoolean(sorted, 'intersect');
        if (!finalD) return;
        const newPath = draw.path(finalD);
        Array.from(bottom.node.attributes).forEach(attr => { if (!['id', 'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform'].includes(attr.name)) newPath.attr(attr.name, attr.value); });
        newPath.attr('fill-rule', 'nonzero'); bottom.before(newPath);
        sorted.forEach(el => { el.remove(); });
        let minData; try { minData = this._extractMinimalPoints(newPath.array()); } catch (e) { return; }
        if (minData && minData.points.length > 0) {
            newPath.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
            newPath.attr('data-bez-points', JSON.stringify(minData.bezData));
            newPath.attr('data-tool-id', 'polyline'); newPath.attr('data-poly-closed', 'true');
        }
        if (window.makeInteractive) window.makeInteractive(newPath);
        if (window.selectElement) window.selectElement(newPath);
    },

    divide(elements) {
        console.log("[Divide] Called with", elements ? elements.length : 0, "elements.");
        if (!elements || elements.length < 2) return;

        // 画像分岐：<image>要素が含まれる場合は非対応を通知
        const hasImage = elements.some(el => el.type === 'image');
        if (hasImage) {
            console.warn('[Divide] Image elements detected. Divide is not supported for images.');
            const msg = '分割（Divide）は画像要素には対応していません。';
            if (window.showToast) window.showToast(msg, 'warning');
            else alert(msg);
            return;
        }

        const sorted = [...elements].sort((a, b) => Array.from(a.node.parentNode.children).indexOf(a.node) - Array.from(b.node.parentNode.children).indexOf(b.node));
        const bottom = sorted[0], draw = bottom.root();

        const pathDataArray = this._performBooleanDivide(sorted);
        if (!pathDataArray || pathDataArray.length === 0) return;

        const newPaths = [];
        pathDataArray.forEach((d, idx) => {
            if (!d.trim()) return;
            const newPath = draw.path(d);

            // Generate a unique ID if the original had one
            const baseId = bottom.attr('id') ? (bottom.attr('id').replace(/_div\d+_[0-9]+$/, '') + `_div${Date.now()}_${idx}`) : null;
            if (baseId) newPath.attr('id', baseId);

            Array.from(bottom.node.attributes).forEach(attr => {
                if (!['id', 'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform'].includes(attr.name)) {
                    newPath.attr(attr.name, attr.value);
                }
            });
            newPath.attr('fill-rule', 'evenodd');
            bottom.before(newPath);
            newPaths.push(newPath);
        });

        if (newPaths.length === 0) return;

        sorted.forEach(el => { el.remove(); });

        newPaths.forEach(newPath => {
            let minData; try { minData = this._extractMinimalPoints(newPath.array()); } catch (e) { return; }
            if (minData && minData.points.length > 0) {
                newPath.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
                newPath.attr('data-bez-points', JSON.stringify(minData.bezData));
                newPath.attr('data-tool-id', 'polyline'); newPath.attr('data-poly-closed', 'true');
            }
            if (window.makeInteractive) window.makeInteractive(newPath);
        });

        if (window.selectElement) window.selectElement(newPaths[0]);
    },

    /**
     * 画像要素にクリッピングマスク（clipPath）を適用する。
     * 既存の clip-path があれば古い clipPath要素を <defs> から削除してから上書きする。
     * @param {SVG.Element} imageEl - SVG.jsの<image>要素
     * @param {string} clipPathD    - クリッピングに使うパスデータ (d属性の値)
     */
    _applyClipPathToImage(imageEl, clipPathD) {
        if (!imageEl || !clipPathD) return;
        const clipId = `clip-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // <defs> を取得または作成（svg_css_toolbar.js / svg_context_menu.js と同じパターン）
        const svgNode = imageEl.root().node;
        let defsEl = svgNode.querySelector('defs');
        if (!defsEl) {
            defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgNode.insertBefore(defsEl, svgNode.firstChild);
        }

        // 既存の clip-path があれば古い <clipPath> 要素を削除
        const existingClipAttr = imageEl.attr('clip-path');
        if (existingClipAttr) {
            const oldIdMatch = existingClipAttr.match(/url\(#(.+?)\)/);
            if (oldIdMatch) {
                const oldEl = svgNode.querySelector(`#${CSS.escape(oldIdMatch[1])}`);
                if (oldEl) oldEl.remove();
            }
        }

        // 新しい <clipPath> を生成
        const clipPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPathEl.setAttribute('id', clipId);
        clipPathEl.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', clipPathD);
        clipPathEl.appendChild(pathEl);
        defsEl.appendChild(clipPathEl);

        // <image> に clip-path 属性を適用
        imageEl.attr('clip-path', `url(#${clipId})`);
        console.log(`[ClipPath] Applied clip-path='url(#${clipId})' to image. Path length: ${clipPathD.length}`);
    },

    /**
     * 画像の外形矩形からベクター形状を引いたパスデータを生成（subtract用逆マスク）。
     * @param {string} imgRectD     - 画像全体を表す矩形パスデータ
     * @param {SVG.Element[]} vectorEls - 引くベクター形犲の配列
     * @returns {string} クリッピング用パスデータ
     */
    _computeSubtractFromRect(imgEl, vectorEls) {
        if (!imgEl || !vectorEls || vectorEls.length === 0) return '';
        try {
            this._initPaper();
        } catch (e) {
            console.error('[ClipPath] Paper.js init failed:', e);
            return '';
        }

        try {
            // ===== _performBoolean と全く同じ方式 =====
            // 1. ローカル座標のパスデータを取得
            // 2. Paper.js にインポートし、item.matrix.set() で relMatrix を適用
            // 3. paper.pathData で world 座標のパスデータを取得
            // 画像の x,y 属性はローカルパスに含め、transform 属性のみを matrix() で取得

            // 画像の親の CTM… ではなく、_performBoolean と同じ 「element の親の ctm()」 を基終とする
            const imgParent = imgEl.parent();
            let targetCTMInv;
            try {
                const tctm = imgParent ? imgParent.ctm() : null;
                if (!tctm) throw new Error('No CTM');
                targetCTMInv = tctm.inverse();
            } catch (e) {
                console.warn('[ClipPath] imgParent ctm failed, using identity:', e);
                targetCTMInv = new SVG.Matrix();
            }

            // 画像矩形ローカルパス (属性値 x,y を含む)
            const imgX = parseFloat(imgEl.attr('x')) || 0;
            const imgY = parseFloat(imgEl.attr('y')) || 0;
            const imgW = parseFloat(imgEl.attr('width')) || 0;
            const imgH = parseFloat(imgEl.attr('height')) || 0;
            const imgLocalD = `M${imgX},${imgY} H${imgX + imgW} V${imgY + imgH} H${imgX} Z`;

            // 画像の relMatrix: 親 CTM の逆行列 * 画像の CTM
            // (この計算は _performBoolean と全く同じ)
            let imgRelMatrix;
            try {
                const imgCTM = imgEl.ctm();
                imgRelMatrix = targetCTMInv.multiply(imgCTM);
            } catch (e) {
                console.warn('[ClipPath] imgEl.ctm() failed, using identity:', e);
                imgRelMatrix = new SVG.Matrix();
            }
            console.log(`[ClipPath] imgLocalD=${imgLocalD}, relMat e=${imgRelMatrix.e.toFixed(2)},f=${imgRelMatrix.f.toFixed(2)}`);

            const imgItem = paper.project.importSVG(`<path d="${imgLocalD}" />`);
            if (!imgItem) { paper.project.clear(); return ''; }
            imgItem.matrix.set(
                imgRelMatrix.a, imgRelMatrix.b, imgRelMatrix.c,
                imgRelMatrix.d, imgRelMatrix.e, imgRelMatrix.f
            );

            let result = imgItem;

            for (const el of vectorEls) {
                const d = this.convertToPathData(el, new SVG.Matrix()); // ローカル座標
                if (!d) continue;
                const vItem = paper.project.importSVG(`<path d="${d}" />`);
                if (!vItem) continue;

                let vRelMatrix;
                try {
                    const vParent = el.parent();
                    const vParentCTM = vParent ? vParent.ctm() : null;
                    const vParentCTMInv = vParentCTM ? vParentCTM.inverse() : targetCTMInv;
                    const ectm = el.ctm();
                    vRelMatrix = vParentCTMInv.multiply(ectm);
                } catch (e) {
                    console.warn('[ClipPath] vector ctm failed, using identity:', e);
                    vRelMatrix = new SVG.Matrix();
                }
                console.log(`[ClipPath] vec(${el.type}) relMat e=${vRelMatrix.e.toFixed(2)},f=${vRelMatrix.f.toFixed(2)}`);

                vItem.matrix.set(
                    vRelMatrix.a, vRelMatrix.b, vRelMatrix.c,
                    vRelMatrix.d, vRelMatrix.e, vRelMatrix.f
                );
                const temp = result.subtract(vItem);
                vItem.remove();
                if (temp) {
                    if (result !== imgItem) result.remove();
                    result = temp;
                }
            }

            const finalD = result ? (result.pathData || '') : '';
            paper.project.clear();
            console.log(`[ClipPath] _computeSubtractFromRect result path length: ${finalD.length}`);
            return finalD;
        } catch (e) {
            console.error('[ClipPath] _computeSubtractFromRect failed:', e);
            try { paper.project.clear(); } catch (ex) {}
            return '';
        }
    },

    /**
     * 要素のパスデータを SVG 親コンテナの座標系で返す。
     * _performBoolean() と全く同じパイプライン（ローカル座標 + Paper.jsで relMatrix 適用 → pathData取得）を使用する。
     * クリッピングマスクの単数ベクターケースで使用。
     * @param {SVG.Element} el - 変換したい要素
     * @returns {string} SVG ユーザー座標系に変換されたパスデータ、失敗時は ''
     */
    _getPathDataInParentSpace(el) {
        // convertToPathData(el, elMat) で SVGユーザー座標に変換してから Paper.js に渡す。
        // Paper.js 内部座標系の剏に依存せず、正確な SVG 座標の clip path を出力する。
        try {
            this._initPaper();
        } catch (e) {
            console.error('[ClipPath] _getPathDataInParentSpace: Paper.js init failed', e);
            return '';
        }
        try {
            const elMat = this._getElementToSVGMatrix(el);
            // convertToPathData に変換行列を渡し、SVG.js 側で SVGユーザー座標に変換・切り出す
            const d = this.convertToPathData(el, elMat);
            if (!d) { paper.project.clear(); return ''; }
            console.log(`[ClipPath] _getPathDataInParentSpace type=${el.type} d-start=${d.substring(0,60)}`);
            // Paper.js に identity でインポート (座標は変換済み)
            const item = paper.project.importSVG(`<path d="${d}" />`);
            if (!item) { paper.project.clear(); return ''; }
            const result = item.pathData || '';
            paper.project.clear();
            console.log(`[ClipPath] _getPathDataInParentSpace: path length=${result.length}`);
            return result;
        } catch (e) {
            console.error('[ClipPath] _getPathDataInParentSpace failed:', e);
            try { paper.project.clear(); } catch (ex) {}
            return '';
        }
    },

    /**
     * 要素から SVG ルートまでの累積変換行列を返す。
     * SVG.js の matrix() から構築するため、getCTM/getScreenCTM のブラウザ差異に依存しない。
     * アウトライン変換機能で使われる relMatrix と同等の値を返す。
     * @param {SVG.Element} el
     * @returns {SVG.Matrix} 要素のローカル座標系から SVG ユーザー空間への変換行列
     */
    _getElementToSVGMatrix(el) {
        // 要素自身の transform 属性から開始
        let mat = el.matrix();
        let parent = el.parent();
        // SVGルートまで親の transform を累積（アウトライン変換機能で使われるパターン）
        while (parent && parent.node && parent.node.nodeName.toLowerCase() !== 'svg') {
            mat = parent.matrix().multiply(mat);
            parent = parent.parent();
        }
        return mat;
    },

    _performBoolean(elements, op) {
        if (!elements || elements.length < 2) return "";
        try {
            this._initPaper();
        } catch (e) {
            console.error("[Boolean] Paper.js init failed:", e);
            return "";
        }

        const targetParent = elements[0].parent();
        if (!targetParent) return "";

        // [GUARD] Get target CTM safely
        let targetCTMInv;
        try {
            const tctm = targetParent.ctm();
            if (!tctm) throw new Error("Target parent has no CTM");
            targetCTMInv = tctm.inverse();
        } catch (e) {
            console.error("[Boolean] Failed to compute target coordinate space:", e);
            return "";
        }

        // Convert all elements to Paper.js Path objects and apply their relative transformations
        const paperPaths = elements.map((el, i) => {
            try {
                const type = el.type, id = el.id();
                // Get transform from element space to target parent space
                const ectm = el.ctm();
                if (!ectm) {
                    console.warn(`[Boolean] Element ${id} has no CTM.`);
                    return null;
                }
                const relMatrix = targetCTMInv.multiply(ectm);
                const m = relMatrix;

                // Get RAW path data in element local space (No baked matrix)
                // Use a fresh matrix to ensure local coordinates
                const d = this.convertToPathData(el, new SVG.Matrix());
                if (!d) return null;

                // Import into Paper.js
                const item = paper.project.importSVG(`<path d="${d}" />`);

                if (item) {
                    // Apply SVG matrix directly and bake it into coordinates
                    item.matrix.set(m.a, m.b, m.c, m.d, m.e, m.f);
                } else {
                    console.warn(`[Boolean] Failed to import element ${i} into Paper.js`);
                }

                return item;
            } catch (err) {
                console.error(`[Boolean] Conversion failed for element ${i}:`, err);
                return null;
            }
        }).filter(p => p !== null);

        if (paperPaths.length < 2) {
            console.warn("[Boolean] Not enough valid paths to perform operation.");
            paperPaths.forEach(p => { if (p.remove) p.remove(); });
            return "";
        }

        let result = paperPaths[0];
        try {
            for (let i = 1; i < paperPaths.length; i++) {
                const next = paperPaths[i];
                let temp = null;
                if (op === 'union') {
                    temp = result.unite(next);
                } else if (op === 'subtract') {
                    temp = result.subtract(next);
                } else if (op === 'intersect') {
                    temp = result.intersect(next);
                }

                if (temp) {
                    if (result && result !== paperPaths[0]) result.remove();
                    if (next) next.remove();
                    result = temp;
                }
            }
        } catch (e) {
            console.error("[Boolean] Paper.js operation failed:", e);
            paperPaths.forEach(p => { if (p && p.remove) p.remove(); });
            if (result && result.remove) result.remove();
            try { paper.project.clear(); } catch (ex) { }
            return "";
        }

        if (!result) {
            try { paper.project.clear(); } catch (ex) { }
            return "";
        }

        const finalD = result.pathData || "";

        // [NEW] Cleanup project AFTER getting result
        try { paper.project.clear(); } catch (ex) { }

        console.log(`[Boolean] Paper.js ${op} completed. Result path length: ${finalD.length}`);
        return finalD;
    },

    _performBooleanDivide(elements) {
        if (!elements || elements.length < 2) return [];
        try {
            this._initPaper();
        } catch (e) {
            console.error("[Boolean] Paper.js init failed:", e);
            return [];
        }

        const targetParent = elements[0].parent();
        if (!targetParent) return [];

        let targetCTMInv;
        try {
            const tctm = targetParent.ctm();
            if (!tctm) throw new Error("Target parent has no CTM");
            targetCTMInv = tctm.inverse();
        } catch (e) {
            console.error("[Boolean] Failed to compute target coordinate space:", e);
            return [];
        }

        const paperPaths = elements.map((el, i) => {
            try {
                const ectm = el.ctm();
                if (!ectm) return null;
                const relMatrix = targetCTMInv.multiply(ectm);
                const m = relMatrix;

                const d = this.convertToPathData(el, new SVG.Matrix());
                if (!d) return null;

                const item = paper.project.importSVG(`<path d="${d}" />`);
                if (item) {
                    item.matrix.set(m.a, m.b, m.c, m.d, m.e, m.f);
                }
                return item;
            } catch (err) {
                return null;
            }
        }).filter(p => p !== null);

        if (paperPaths.length < 2) {
            paperPaths.forEach(p => { if (p.remove) p.remove(); });
            return [];
        }

        const extractPaths = (paperItem, arr) => {
            if (!paperItem) return;
            if (paperItem.children && paperItem.children.length > 0) {
                paperItem.children.forEach(c => {
                    if (c.pathData && c.pathData.trim().length > 0) arr.push(c.clone());
                });
            } else if (paperItem.pathData && paperItem.pathData.trim().length > 0) {
                arr.push(paperItem.clone());
            }
        };

        let regions = [];
        extractPaths(paperPaths[0], regions);

        try {
            for (let i = 1; i < paperPaths.length; i++) {
                let next = paperPaths[i].clone();
                let nextRegions = [];
                let currentNext = next;

                for (let j = 0; j < regions.length; j++) {
                    let r = regions[j];
                    if (!r) continue;

                    let diffR = null;
                    let interR = null;

                    if (currentNext) {
                        try {
                            diffR = r.subtract(currentNext);
                            interR = r.intersect(currentNext);
                        } catch (ex) { }
                    }

                    if (diffR && interR) {
                        extractPaths(diffR, nextRegions);
                        extractPaths(interR, nextRegions);
                    } else {
                        nextRegions.push(r.clone());
                    }

                    if (currentNext) {
                        try {
                            let nextSub = currentNext.subtract(r);
                            if (!nextSub || (nextSub.isEmpty && nextSub.isEmpty()) || !nextSub.pathData.trim()) {
                                currentNext = null;
                                // If currentNext is fully consumed, pass all remaining regions unchanged
                                for (let k = j + 1; k < regions.length; k++) {
                                    if (regions[k]) nextRegions.push(regions[k].clone());
                                }
                                break;
                            } else {
                                currentNext = nextSub;
                            }
                        } catch (ex) {
                            console.warn("Subtract failed", ex);
                        }
                    }
                }

                if (currentNext) {
                    extractPaths(currentNext, nextRegions);
                }

                regions = nextRegions;
            }
        } catch (e) {
            console.error("[Boolean Divide] Paper.js operation failed:", e);
        }

        const pathDataArray = [];
        regions.forEach(r => {
            if (r && r.pathData && r.pathData.trim().length > 0) {
                pathDataArray.push(r.pathData);
            }
        });

        try { paper.project.clear(); } catch (ex) { }
        console.log(`[Boolean Divide] Paper.js completed. Produced ${pathDataArray.length} paths.`);
        return pathDataArray;
    },

    _initPaper() {
        if (!this._paperInitialized) {
            // Setup paper in a headless way with a large canvas to avoid bounds clipping on large svgs
            const canvas = document.createElement('canvas');
            canvas.width = 10000; canvas.height = 10000;
            paper.setup(canvas);
            this._paperInitialized = true;
            console.log("[Boolean] Paper.js initialized (headless).");
        } else {
            // Reset project state for clean operation
            paper.project.clear();
            try { paper.view.viewSize = new paper.Size(10000, 10000); } catch (e) { }
        }
    },

    convertToPathData(el, matrix, loopForText = false) {
        if (!el) return "";

        // [FIX] 行列が明示的に渡されない場合は、要素自体の matrix() ではなく恒等行列をデフォルトにする。
        let targetMatrix;
        try {
            targetMatrix = matrix || new SVG.Matrix();
        } catch (e) {
            console.warn("[convertToPathData] Matrix creation failed, using identity fallback.");
            targetMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, native: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), multiply: function (m) { return m || this; } };
        }
        const type = el.type;
        let d = "";
        if (type === 'g') {
            // [NEW] Recursive handling for Groups
            let combinedD = "";
            el.children().forEach(child => {
                try {
                    // Accumulate matrix: targetMatrix (parent to target) * child.matrix() (local to parent)
                    const childRelMatrix = targetMatrix.multiply(child.matrix());
                    const childD = this.convertToPathData(child, childRelMatrix);
                    if (childD) combinedD += childD + " ";
                } catch (e) {
                    console.warn(`[convertToPathData] Failed to process child of group: ${child.id()}`, e);
                }
            });
            return combinedD.trim();
        } else if (type === 'path') d = el.attr('d');
        else if (type === 'rect') {
            const w = parseFloat(el.attr('width')) || 0, h = parseFloat(el.attr('height')) || 0, x = parseFloat(el.attr('x')) || 0, y = parseFloat(el.attr('y')) || 0;
            const rx = parseFloat(el.attr('rx')) || 0, ry = parseFloat(el.attr('ry')) || 0;
            if (rx > 0 || ry > 0) {
                const r = Math.min(rx || ry, w / 2, h / 2);
                d = `M${x + r},${y} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - 2 * r} a${r},${r} 0 0 1 -${r},-${r} v-${h - 2 * r} a${r},${r} 0 0 1 ${r},-${r} Z`;
            } else d = `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
        } else if (type === 'circle' || type === 'ellipse') {
            const rx = parseFloat(type === 'circle' ? el.attr('r') : el.attr('rx')) || 0;
            const ry = parseFloat(type === 'circle' ? el.attr('r') : el.attr('ry')) || 0;
            const cx = parseFloat(el.attr('cx')) || 0, cy = parseFloat(el.attr('cy')) || 0;
            const arc = `A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy}`;
            if (loopForText) {
                // Generate 3 loops for TextPath to allow text to continuously wrap multiple times without clipping.
                d = `M${cx - rx},${cy} ${arc} ${arc} ${arc} Z`;
            } else {
                d = `M${cx - rx},${cy} ${arc} Z`;
            }
        } else if (type === 'polyline' || type === 'line' || type === 'polygon') {
            const pArray = el.array(), points = pArray.value || pArray; if (!points || points.length < 2) return "";
            d = `M${points[0][0]},${points[0][1]}`; for (let i = 1; i < points.length; i++) d += ` L${points[i][0]},${points[i][1]}`; if (type === 'polygon') d += " Z";
        }
        if (!d) return "";
        const pathArray = new SVG.PathArray(d);
        const t = this._transformArray(pathArray, targetMatrix);
        return t.map(seg => Array.isArray(seg) ? seg.join(' ') : seg).join(' ');
    },

    _transformArray(array, matrix) {
        if (!array || !matrix) return array;
        const tr = (x, y) => { const p = new SVG.Point(x, y).transform(matrix); return [p.x, p.y]; };

        let lastX = 0, lastY = 0, startX = 0, startY = 0;
        const segments = array.value || array;

        return segments.map(seg => {
            const rawCmd = seg[0], cmd = rawCmd.toUpperCase(), args = seg.slice(1);
            const isRel = (rawCmd === rawCmd.toLowerCase() && cmd !== 'Z');
            const res = [cmd]; // Normalize to Absolute commands for the matrix result

            if (cmd === 'M') {
                lastX = isRel ? lastX + args[0] : args[0];
                lastY = isRel ? lastY + args[1] : args[1];
                startX = lastX; startY = lastY;
                res.push(...tr(lastX, lastY));
            } else if (cmd === 'L') {
                lastX = isRel ? lastX + args[0] : args[0];
                lastY = isRel ? lastY + args[1] : args[1];
                res.push(...tr(lastX, lastY));
            } else if (cmd === 'H') {
                lastX = isRel ? lastX + args[0] : args[0];
                res[0] = 'L'; res.push(...tr(lastX, lastY));
            } else if (cmd === 'V') {
                lastY = isRel ? lastY + args[0] : args[0];
                res[0] = 'L'; res.push(...tr(lastX, lastY));
            } else if (cmd === 'C') {
                const x1 = isRel ? lastX + args[0] : args[0], y1 = isRel ? lastY + args[1] : args[1];
                const x2 = isRel ? lastX + args[2] : args[2], y2 = isRel ? lastY + args[3] : args[3];
                const x = isRel ? lastX + args[4] : args[4], y = isRel ? lastY + args[5] : args[5];
                res.push(...tr(x1, y1), ...tr(x2, y2), ...tr(x, y));
                lastX = x; lastY = y;
            } else if (cmd === 'S') {
                const x2 = isRel ? lastX + args[0] : args[0], y2 = isRel ? lastY + args[1] : args[1];
                const x = isRel ? lastX + args[2] : args[2], y = isRel ? lastY + args[3] : args[3];
                res.push(...tr(x2, y2), ...tr(x, y));
                lastX = x; lastY = y;
            } else if (cmd === 'Q') {
                const x1 = isRel ? lastX + args[0] : args[0], y1 = isRel ? lastY + args[1] : args[1];
                const x = isRel ? lastX + args[2] : args[2], y = isRel ? lastY + args[3] : args[3];
                res.push(...tr(x1, y1), ...tr(x, y));
                lastX = x; lastY = y;
            } else if (cmd === 'T') {
                const x = isRel ? lastX + args[0] : args[0], y = isRel ? lastY + args[1] : args[1];
                res.push(...tr(x, y));
                lastX = x; lastY = y;
            } else if (cmd === 'A') {
                const sX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b), sY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
                const rx = args[0] * sX, ry = args[1] * sY, rot = args[2];
                const x = isRel ? lastX + args[5] : args[5], y = isRel ? lastY + args[6] : args[6];
                const p = tr(x, y);
                res.push(rx, ry, rot, args[3], args[4], p[0], p[1]);
                lastX = x; lastY = y;
            } else if (cmd === 'Z') {
                lastX = startX; lastY = startY;
            }
            return res;
        });
    },

    _isSmooth(p, cpIn, cpOut) {
        if (!cpIn || !cpOut || !p) return false;
        const dx1 = cpIn[0] - p[0], dy1 = cpIn[1] - p[1];
        const dx2 = cpOut[0] - p[0], dy2 = cpOut[1] - p[1];
        const mag1 = Math.hypot(dx1, dy1);
        const mag2 = Math.hypot(dx2, dy2);
        if (mag1 < 0.1 || mag2 < 0.1) return false;
        // Normalized cross product should be near 0 (collinear)
        // Normalized dot product should be negative (opposite directions)
        const cross = (dx1 * dy2 - dy1 * dx2) / (mag1 * mag2);
        const dot = (dx1 * dx2 + dy1 * dy2) / (mag1 * mag2);
        return Math.abs(cross) < 0.02 && dot < -0.8;
    },

    _extractMinimalPoints(pathArray) {
        if (!pathArray) return { points: [], bezData: [] };
        const segments = pathArray.value || pathArray, points = [], bezData = [];
        let lastX = 0, lastY = 0, startX = 0, startY = 0;
        let lastCpX = 0, lastCpY = 0; // For S/T commands

        segments.forEach((seg, idx) => {
            const rawCmd = seg[0], cmd = rawCmd.toUpperCase(), args = seg.slice(1);
            const isRel = (rawCmd === rawCmd.toLowerCase() && cmd !== 'Z');

            let nextX = lastX, nextY = lastY;
            let isMove = false;
            let isBezier = false;
            let currentBez = { type: 0 };

            if (cmd === 'M') {
                // [NEW] Before starting a new sub-path, cleanup the previous one
                this._cleanupLastSubPath(points, bezData, startX, startY);

                nextX = isRel ? lastX + args[0] : args[0];
                nextY = isRel ? lastY + args[1] : args[1];
                startX = nextX; startY = nextY;
                isMove = true;
                lastCpX = nextX; lastCpY = nextY;
            } else if (cmd === 'L') {
                nextX = isRel ? lastX + args[0] : args[0];
                nextY = isRel ? lastY + args[1] : args[1];
                lastCpX = nextX; lastCpY = nextY;
            } else if (cmd === 'H') {
                nextX = isRel ? lastX + args[0] : args[0];
                lastCpX = nextX; lastCpY = nextY;
            } else if (cmd === 'V') {
                nextY = isRel ? lastY + args[0] : args[0];
                lastCpX = nextX; lastCpY = nextY;
            } else if (cmd === 'C') {
                const x1 = isRel ? lastX + args[0] : args[0], y1 = isRel ? lastY + args[1] : args[1];
                const x2 = isRel ? lastX + args[2] : args[2], y2 = isRel ? lastY + args[3] : args[3];
                nextX = isRel ? lastX + args[4] : args[4], nextY = isRel ? lastY + args[5] : args[5];
                if (bezData.length > 0 && !isMove) {
                    bezData[bezData.length - 1].cpOut = [x1, y1];
                    // Update previous point's type based on smoothness if we already had cpIn
                    const prevP = points[points.length - 1];
                    const prevBz = bezData[bezData.length - 1];
                    if (prevP && prevBz.cpIn && this._isSmooth(prevP, prevBz.cpIn, [x1, y1])) {
                        prevBz.type = 1;
                    } else {
                        prevBz.type = 2;
                    }
                }
                currentBez = { type: 2, cpIn: [x2, y2] };
                isBezier = true;
                lastCpX = x2; lastCpY = y2;
            } else if (cmd === 'S') {
                const x2 = isRel ? lastX + args[0] : args[0], y2 = isRel ? lastY + args[1] : args[1];
                nextX = isRel ? lastX + args[2] : args[2], nextY = isRel ? lastY + args[3] : args[3];
                const x1 = (idx > 0 && (segments[idx - 1][0].toUpperCase() === 'C' || segments[idx - 1][0].toUpperCase() === 'S')) ? 2 * lastX - lastCpX : lastX;
                const y1 = (idx > 0 && (segments[idx - 1][0].toUpperCase() === 'C' || segments[idx - 1][0].toUpperCase() === 'S')) ? 2 * lastY - lastCpY : lastY;
                if (bezData.length > 0 && !isMove) {
                    bezData[bezData.length - 1].cpOut = [x1, y1];
                    const prevP = points[points.length - 1];
                    const prevBz = bezData[bezData.length - 1];
                    if (prevP && prevBz.cpIn && this._isSmooth(prevP, prevBz.cpIn, [x1, y1])) {
                        prevBz.type = 1;
                    } else {
                        prevBz.type = 2;
                    }
                }
                currentBez = { type: 2, cpIn: [x2, y2] };
                isBezier = true;
                lastCpX = x2; lastCpY = y2;
            } else if (cmd === 'Q') {
                const x1 = isRel ? lastX + args[0] : args[0], y1 = isRel ? lastY + args[1] : args[1];
                nextX = isRel ? lastX + args[2] : args[2], nextY = isRel ? lastY + args[3] : args[3];
                const cp1x = lastX + (2 / 3) * (x1 - lastX), cp1y = lastY + (2 / 3) * (y1 - lastY);
                const cp2x = nextX + (2 / 3) * (x1 - nextX), cp2y = nextY + (2 / 3) * (y1 - nextY);
                if (bezData.length > 0 && !isMove) {
                    bezData[bezData.length - 1].cpOut = [cp1x, cp1y];
                    const prevP = points[points.length - 1];
                    const prevBz = bezData[bezData.length - 1];
                    if (prevP && prevBz.cpIn && this._isSmooth(prevP, prevBz.cpIn, [cp1x, cp1y])) {
                        prevBz.type = 1;
                    } else {
                        prevBz.type = 2;
                    }
                }
                currentBez = { type: 2, cpIn: [cp2x, cp2y] };
                isBezier = true;
                lastCpX = x1; lastCpY = y1;
            } else if (cmd === 'T') {
                nextX = isRel ? lastX + args[0] : args[0], nextY = isRel ? lastY + args[1] : args[1];
                const x1 = (idx > 0 && (segments[idx - 1][0].toUpperCase() === 'Q' || segments[idx - 1][0].toUpperCase() === 'T')) ? 2 * lastX - lastCpX : lastX;
                const y1 = (idx > 0 && (segments[idx - 1][0].toUpperCase() === 'Q' || segments[idx - 1][0].toUpperCase() === 'T')) ? 2 * lastY - lastCpY : lastY;
                const cp1x = lastX + (2 / 3) * (x1 - lastX), cp1y = lastY + (2 / 3) * (y1 - lastY);
                const cp2x = nextX + (2 / 3) * (x1 - nextX), cp2y = nextY + (2 / 3) * (y1 - nextY);
                if (bezData.length > 0 && !isMove) {
                    bezData[bezData.length - 1].cpOut = [cp1x, cp1y];
                    const prevP = points[points.length - 1];
                    const prevBz = bezData[bezData.length - 1];
                    if (prevP && prevBz.cpIn && this._isSmooth(prevP, prevBz.cpIn, [cp1x, cp1y])) {
                        prevBz.type = 1;
                    } else {
                        prevBz.type = 2;
                    }
                }
                currentBez = { type: 2, cpIn: [cp2x, cp2y] };
                isBezier = true;
                lastCpX = x1; lastCpY = y1;
            } else if (cmd === 'A') {
                const rx = args[0], ry = args[1], rot = args[2], large = args[3], sweep = args[4];
                nextX = isRel ? lastX + args[5] : args[5], nextY = isRel ? lastY + args[6] : args[6];
                const curves = this._arcToCubicBeziers(lastX, lastY, rx, ry, rot, large, sweep, nextX, nextY);
                curves.forEach((c, cidx) => {
                    const x1 = c[0], y1 = c[1], x2 = c[2], y2 = c[3], cx = c[4], cy = c[5];
                    if (bezData.length > 0 && !(cidx === 0 && isMove)) {
                        bezData[bezData.length - 1].cpOut = [x1, y1];
                        const prevP = points[points.length - 1];
                        const prevBz = bezData[bezData.length - 1];
                        if (prevP && prevBz.cpIn && this._isSmooth(prevP, prevBz.cpIn, [x1, y1])) {
                            prevBz.type = 1;
                        } else {
                            prevBz.type = 2;
                        }
                    }
                    points.push([cx, cy, (cidx === 0) ? isMove : false]);
                    bezData.push({ type: 2, cpIn: [x2, y2] });
                });
                lastX = nextX; lastY = nextY; lastCpX = nextX; lastCpY = nextY;
                isMove = false; // Important: for Arc, the first curve segment takes isMove
                return; // Points already pushed
            } else if (cmd === 'Z') {
                nextX = startX; nextY = startY;
            }

            // Only push if coordinates changed or it's a Move command
            const hasMoved = Math.abs(nextX - lastX) > 0.001 || Math.abs(nextY - lastY) > 0.001;
            if (isMove || hasMoved) {
                if (cmd !== 'Z') {
                    points.push([nextX, nextY, isMove]);
                    bezData.push(currentBez);
                }
            }

            lastX = nextX; lastY = nextY;
        });

        // [NEW] Final sub-path cleanup
        this._cleanupLastSubPath(points, bezData, startX, startY);

        console.log(`[VertexExtract] Extracted ${points.length} points.`);
        return { points, bezData };
    },

    /**
     * Helper to cleanup redundant closing points in sub-paths
     */
    _cleanupLastSubPath(points, bezData, startX, startY) {
        if (points.length < 2) return;

        // Find the start of the current sub-path
        let startIdx = points.length - 1;
        while (startIdx > 0 && !points[startIdx][2]) {
            startIdx--;
        }

        const subCount = points.length - startIdx;
        if (subCount < 2) return;

        const first = points[startIdx];
        const last = points[points.length - 1];

        // If last point matches sub-path start, it's redundant for the editor
        if (Math.abs(first[0] - last[0]) < 0.001 && Math.abs(first[1] - last[1]) < 0.001) {
            // Move the inward control point of the closing segment to the start point
            const closingBez = bezData.pop();
            points.pop();
            if (bezData[startIdx]) {
                bezData[startIdx].cpIn = closingBez.cpIn;
                // [NEW] Update point type for smooth transitions
                if (bezData[startIdx].cpIn && bezData[startIdx].cpOut && this._isSmooth(first, bezData[startIdx].cpIn, bezData[startIdx].cpOut)) {
                    bezData[startIdx].type = 1;
                } else {
                    bezData[startIdx].type = 2;
                }
            }
        }
    },

    _arcToCubicBeziers(x1, y1, rx, ry, angle, largeArcFlag, sweepFlag, x2, y2) {
        if (Math.abs(rx) < 0.1 || Math.abs(ry) < 0.1) return []; const phi = (angle * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
        const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy; rx = Math.abs(rx); ry = Math.abs(ry);
        const l = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry); if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
        const rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p; let cf = Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2))); if (largeArcFlag === sweepFlag) cf = -cf;
        const cxp = cf * (rx * y1p / ry), cyp = cf * (-ry * x1p / rx), cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2, cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
        const t1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx); let dt = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - t1; if (sweepFlag === 0 && dt > 0) dt -= 2 * Math.PI; else if (sweepFlag === 1 && dt < 0) dt += 2 * Math.PI;
        const segments = Math.ceil(Math.abs(dt) / (Math.PI / 2)), curves = [];
        for (let i = 0; i < segments; i++) {
            const sA = t1 + (i * dt) / segments, eA = t1 + ((i + 1) * dt) / segments, al = (Math.sin(eA - sA) * (Math.sqrt(4 + 3 * Math.pow(Math.tan((eA - sA) / 2), 2)) - 1)) / 3;
            const x0 = rx * Math.cos(sA), y0 = ry * Math.sin(sA), x3 = rx * Math.cos(eA), y3 = ry * Math.sin(eA); const rot = (px, py) => [cosP * px - sinP * py + cx, sinP * px + cosP * py + cy];
            curves.push([...rot(x0 - al * ry * Math.sin(sA), y0 + al * rx * Math.cos(sA)), ...rot(x3 + al * ry * Math.sin(eA), y3 - al * rx * Math.cos(eA)), ...rot(x3, y3)]);
        }
        return curves;
    },

    // [NEW] パス切断モード (Path Scissor)
    togglePathCutMode(btn) {
        if (this._isPathCutMode) {
            this.stopPathCutMode();
            return;
        }

        this._isPathCutMode = true;
        this._cutBtn = btn;
        if (this._cutBtn) {
            this._cutBtn.classList.add('active'); // CSSでUI制御
        }

        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        if (!draw) {
            if (window.showToast) window.showToast(t('toast.svgCanvasNotFound'));
            this.stopPathCutMode();
            return;
        }

        // マーカーの準備
        this._cutMarker = draw.circle(12).fill('rgba(255, 0, 0, 0.8)').stroke({ color: '#fff', width: 2 }).hide();
        this._cutMarker.attr('pointer-events', 'none'); // イベントブロック防止
        this._cutMarker.attr('class', 'svg-canvas-proxy');

        // ハンドラ登録
        this._boundCutMouseMove = this._onCutMouseMove.bind(this);
        this._boundCutClick = this._onCutClick.bind(this);

        const svgNode = draw.node;
        svgNode.addEventListener('mousemove', this._boundCutMouseMove, true);
        svgNode.addEventListener('click', this._boundCutClick, true); // キャプチャフェーズで処理

        if (window.showToast) window.showToast(t('toast.clickPathToCut'));
        if (window.deselectElement) window.deselectElement();
    },

    stopPathCutMode() {
        this._isPathCutMode = false;
        if (this._cutBtn) {
            this._cutBtn.classList.remove('active');
        }
        if (this._cutMarker) {
            this._cutMarker.remove();
            this._cutMarker = null;
        }

        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        if (draw && draw.node) {
            draw.node.removeEventListener('mousemove', this._boundCutMouseMove, true);
            draw.node.removeEventListener('click', this._boundCutClick, true);
        }

        if (this._currentHit && this._currentHit.paperItem) {
            this._currentHit.paperItem.remove();
        }
        this._currentHit = null;
        try { paper.project.clear(); } catch (e) { }
    },

    _onCutMouseMove(e) {
        if (!this._isPathCutMode) return;

        let bestHit = null;
        let minDistance = 20;

        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        if (!draw) return;

        const pt = draw.point(e.clientX, e.clientY);

        try {
            if (!this._paperInitialized) this._initPaper();
        } catch (ex) { return; }

        // Find all standard elements that can be converted to paths for cutting
        const candidates = draw.find('path, polyline, line, polygon, rect, circle, ellipse');

        paper.project.clear();

        candidates.forEach(el => {
            if (el.hasClass('svg-canvas-proxy') || el.hasClass('svg_select_shape') ||
                el.hasClass('svg-grid-line') || el.hasClass('svg-grid-lines') ||
                el.hasClass('svg-grid-rect') || el.hasClass('svg-ruler') ||
                el.hasClass('svg-interaction-hitarea') || el.hasClass('svg-connector-overlay') ||
                el.attr('data-internal') === 'true' || el.attr('id') === 'document-background') {
                return;
            }

            const ectm = el.ctm();
            const d = this.convertToPathData(el, ectm);
            if (!d) return;

            // [FIX] Avoid importSVG Group bounding boxes which cause infinite hits. Directly instantiate Path.
            let item;
            try {
                item = new paper.Path(d);
                item.strokeColor = 'black';
                item.strokeWidth = 2;
                item.fillColor = null;
            } catch (err) {
                console.error(`[PathCut] Failed to parse path data for hitTest:`, err);
                return;
            }

            const paperPt = new paper.Point(pt.x, pt.y);
            const hit = item.hitTest(paperPt, { stroke: true, segments: true, tolerance: minDistance });

            if (hit && hit.location) {
                if (hit.point.getDistance(paperPt) < minDistance) {
                    minDistance = hit.point.getDistance(paperPt);
                    if (bestHit && bestHit.paperItem) bestHit.paperItem.remove();
                    bestHit = { point: hit.point, location: hit.location, element: el, paperItem: item };
                } else {
                    item.remove();
                }
            } else {
                item.remove();
            }
        });

        if (this._currentHit && this._currentHit.paperItem && (!bestHit || bestHit.paperItem !== this._currentHit.paperItem)) {
            this._currentHit.paperItem.remove();
        }
        this._currentHit = bestHit;

        if (this._currentHit) {
            const cp = this._currentHit.point;
            // console.log(`[PathCut] MouseMove HIT on ${this._currentHit.element.type} at ${cp.x.toFixed(1)}, ${cp.y.toFixed(1)}`);
            this._cutMarker.attr({ cx: cp.x, cy: cp.y }).show();
            this._cutMarker.front();
        } else {
            this._cutMarker.hide();
        }
    },

    _onCutClick(e) {
        if (!this._isPathCutMode) return;
        e.stopPropagation();
        e.preventDefault();

        if (this._currentHit) {
            const el = this._currentHit.element;
            const item = this._currentHit.paperItem;
            const targetPath = item; // Guaranteed to be paper.Path now
            const location = this._currentHit.location;

            try {
                // [FIX] Use a safety margin of 1.0 (or 5% for tiny paths) to ensure reliability on very long paths.
                const margin = Math.min(1.0, targetPath.length * 0.05);
                if (location.offset < margin || location.offset > targetPath.length - margin) {
                    if (window.showToast) window.showToast(t('toast.pathCutTooClose'));
                    return; // abort
                }

                const wasClosed = targetPath.closed;
                const parts = targetPath.splitAt(location);

                if (!parts && !wasClosed) {
                    if (window.showToast) window.showToast(t('toast.pathSplitFailed'));
                    return;
                }

                const draw = window.currentEditingSVG.draw;
                const attrsToCopy = ['class', 'style', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'marker-start', 'marker-end'];

                const createNewPath = (paperPath, originalEl, indexLabel) => {
                    // Extract precise 'd' attribute directly from Paper.js pathData
                    const pathDataStr = paperPath.pathData;
                    const newEl = draw.path(pathDataStr);

                    // Generate unique ID specifically to avoid Markdown-sync collisions
                    const attrId = originalEl.attr('id') || 'line';
                    const baseId = attrId.replace(/_split\d+_[A-Z]$/, '');
                    const newId = `${baseId}_split${Date.now()}_${indexLabel}`;
                    newEl.attr('id', newId);

                    Array.from(originalEl.node.attributes).forEach(attr => {
                        // EXCLUDE geometry and ID attributes from being cloned!
                        if (['data-poly-points', 'data-bez-points', 'data-poly-closed', 'd', 'x1', 'y1', 'x2', 'y2', 'points', 'id'].includes(attr.name)) return;

                        if (attrsToCopy.includes(attr.name) || attr.name.startsWith('data-')) {
                            newEl.attr(attr.name, attr.value);
                        }
                    });
                    newEl.attr('transform', null);

                    if (originalEl.attr('data-tool-id')) {
                        newEl.attr('data-tool-id', 'polyline');
                    }
                    if (['line', 'polyline'].includes(originalEl.type)) {
                        newEl.attr('fill', 'none');
                    }

                    // Generate accurate minimal points from new pathData so SvgShape can handle vertices correctly
                    try {
                        let minData = this._extractMinimalPoints(newEl.array());
                        if (minData && minData.points.length > 0) {
                            newEl.attr('data-poly-points', minData.points.map(p => (p[2] ? 'M' : '') + p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '));
                            newEl.attr('data-bez-points', JSON.stringify(minData.bezData));
                        } else {
                            console.warn(`[PathCut] Failed to extract minimal points for ${newId}`);
                        }
                    } catch (e) {
                        try { newEl.attr('data-poly-points', null); newEl.attr('data-bez-points', null); } catch (ex) { }
                    }

                    return newEl;
                };

                const path1 = createNewPath(targetPath, el, "A");
                el.before(path1);
                const results = [path1];

                // If parts is returned and it's a newly created path (not the opened targetPath), process it.
                if (parts && parts !== targetPath) {
                    const path2 = createNewPath(parts, el, "B");
                    el.before(path2);
                    results.push(path2);
                }

                item.remove();
                if (parts && parts !== item) parts.remove();

                if (window.deselectElement) window.deselectElement();

                // Completely remove the original element from the canvas
                const origId = el.attr('id');
                el.remove();

                // Extra sanity check to see if there is any residue from editor sync
                const checkDOM = document.getElementById(origId);
                if (checkDOM && checkDOM !== el.node) {
                    checkDOM.remove();
                }

                setTimeout(() => {
                    if (window.makeInteractive) results.forEach(p => window.makeInteractive(p));
                    if (window.selectElement) window.selectElement(results[0]);
                }, 0);

                if (window.showToast) window.showToast(t('toast.pathCutSuccess'));
                if (window.syncChanges) window.syncChanges(true); // silent sync

            } catch (ex) {
                console.error("[PathCut] Error during split:", ex);
            }
        } else {
        }

        this.stopPathCutMode();
    }
};

window.SVGPathOps = SVGPathOps;

/**
 * SVG Path Operations Toolbar
 * Provides UI for flipping, combining, and subtracting (clipping) SVG shapes.
 */
class SVGPathOpToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-pathop-toolbar',
            container: container,
            borderColor: options.borderColor || '#444444',
            position: options.position || { top: '320px', left: '-37px' }
        });

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
        this.toolbarElement.classList.add('svg-pathop-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        contentArea.appendChild(this.createPathOpButton('↔️', '水平反転', () => {
            if (window.SVGPathOps) window.SVGPathOps.flip(this.getSelected(), 'x');
            if (window.syncChanges) window.syncChanges();
        }));

        contentArea.appendChild(this.createPathOpButton('↕️', '垂直反転', () => {
            if (window.SVGPathOps) window.SVGPathOps.flip(this.getSelected(), 'y');
            if (window.syncChanges) window.syncChanges();
        }));

        contentArea.appendChild(this.createSeparator());

        const iconCombine = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="9" cy="12" r="7" /><circle cx="15" cy="12" r="7" /></svg>';
        contentArea.appendChild(this.createPathOpButton(iconCombine, '結合 (Combine)', () => {
            if (window.SVGPathOps) window.SVGPathOps.combine(this.getSelected());
            if (window.syncChanges) window.syncChanges();
        }));

        const iconDivide = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M 12,5.7 A 7,7 0 1,0 12,18.3 A 7,7 0 0,1 12,5.7 Z" transform="translate(-1.5, 0)"/><path d="M 12,5.7 A 7,7 0 0,1 12,18.3 A 7,7 0 0,1 12,5.7 Z" /><path d="M 12,5.7 A 7,7 0 1,1 12,18.3 A 7,7 0 0,0 12,5.7 Z" transform="translate(1.5, 0)"/></svg>';
        contentArea.appendChild(this.createPathOpButton(iconDivide, '分割 (Divide)', () => {
            if (window.SVGPathOps) window.SVGPathOps.divide(this.getSelected());
            if (window.syncChanges) window.syncChanges();
        }));

        const iconSubtract = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M 12,5.7 A 7,7 0 1,0 12,18.3 A 7,7 0 0,1 12,5.7 Z" /><circle cx="15" cy="12" r="7" fill="none" stroke="currentColor" stroke-dasharray="2,2" stroke-width="1"/></svg>';
        contentArea.appendChild(this.createPathOpButton(iconSubtract, '切り抜き (Subtract)', () => {
            if (window.SVGPathOps) window.SVGPathOps.subtract(this.getSelected());
            if (window.syncChanges) window.syncChanges();
        }));

        // 抽出 (Intersect): 2図形の重なり部分のみを残す
        const iconIntersect = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><clipPath id="clip-intersect-a"><circle cx="9" cy="12" r="7"/></clipPath><circle cx="15" cy="12" r="7" clip-path="url(#clip-intersect-a)"/><circle cx="9" cy="12" r="7" fill="none" stroke="currentColor" stroke-dasharray="2,2" stroke-width="1"/><circle cx="15" cy="12" r="7" fill="none" stroke="currentColor" stroke-dasharray="2,2" stroke-width="1"/></svg>';
        contentArea.appendChild(this.createPathOpButton(iconIntersect, '抽出 (Intersect)', () => {
            if (window.SVGPathOps) window.SVGPathOps.intersect(this.getSelected());
            if (window.syncChanges) window.syncChanges();
        }));

        const cutBtn = this.createPathOpButton('✂️', 'パス切断 (Cut)', () => {
            if (window.SVGPathOps) window.SVGPathOps.togglePathCutMode(cutBtn);
        });
        contentArea.appendChild(cutBtn);

        contentArea.appendChild(this.createPathOpButton('🔤', 'アウトライン化', () => {
            if (window.SVGPathOps) window.SVGPathOps.convertToOutline(this.getSelected());
            if (window.syncChanges) window.syncChanges();
        }));
    }

    createPathOpButton(label, title, onClick) {
        const btn = document.createElement('button');
        btn.innerHTML = label;
        btn.title = title;
        btn.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        return btn;
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    getSelected() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return [];
        return Array.from(window.currentEditingSVG.selectedElements).filter(el => !el.hasClass('svg-canvas-proxy'));
    }

    destroy() {
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        super.resetPosition();
    }
}

// Global factory
window.createPathOpToolbar = (container, options) => {
    return new SVGPathOpToolbar(container, options);
};
