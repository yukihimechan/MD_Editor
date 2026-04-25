/**
 * SVG Utilities for shape calculations and common logic
 */
const SVGUtils = {
    /**
     * Calculate points for a star shape
     * @param {number} r Outer radius
     * @param {number} spikes Number of spikes
     * @returns {Array} Array of [x, y] coordinates
     */
    calculateStarPoints(r, spikes) {
        const points = [];
        for (let i = 0; i < spikes * 2; i++) {
            const angle = (Math.PI / spikes * i - Math.PI / 2);
            const rad = (i % 2 !== 0) ? r / 2 : r;
            const x = parseFloat((Math.cos(angle) * rad + r).toFixed(3));
            const y = parseFloat((Math.sin(angle) * rad + r).toFixed(3));
            points.push([x, y]);
        }
        return points;
    },

    /**
     * Calculate points for a polygon shape
     * @param {number} r Radius
     * @param {number} sides Number of sides
     * @returns {Array} Array of [x, y] coordinates
     */
    calculatePolygonPoints(r, sides) {
        const points = [];
        for (let i = 0; i < sides; i++) {
            const angle = (Math.PI * 2 / sides * i - Math.PI / 2);
            const x = parseFloat((Math.cos(angle) * r + r).toFixed(3));
            const y = parseFloat((Math.sin(angle) * r + r).toFixed(3));
            points.push([x, y]);
        }
        return points;
    },

    /**
     * 親要素の transform: scale() などの拡大率を取得する汎用メソッド
     * @param {HTMLElement|SVGElement} el 基準となる要素
     * @returns {number} 拡大率 (デフォルトは 1)
     */
    getTransformScale(el) {
        let current = el;
        // SVG要素などから親DOM要素へ辿る
        while (current && current !== document && current !== document.body) {
            if (current.nodeType === 1) { // ELEMENT_NODE
                const style = window.getComputedStyle(current);
                const transform = style.transform;
                if (transform && transform !== 'none') {
                    const matrix = transform.match(/^matrix\((.+)\)$/);
                    if (matrix) {
                        const values = matrix[1].split(', ');
                        return parseFloat(values[0]) || 1;
                    }
                }
            }
            // SVG.jsのラッパーが混ざる場合や親要素がない場合は親ノードへ
            current = current.parentElement || current.parentNode;
        }
        return 1;
    },

    /**
     * スナップ機能が現在有効かどうかを設定およびAltキーから統合的に判定する
     * @param {Event|Object} e マウスイベント等（altKey判定用）
     * @returns {boolean} スナップが有効な場合は true
     */
    isSnapEnabled(e) {
        let altPressed = false;
        if (window.currentEditingSVG && window.currentEditingSVG.isAltPressed) {
            altPressed = true;
        } else if (e) {
            if (e.altKey !== undefined) {
                altPressed = e.altKey;
            } else if (e.detail && e.detail.event && e.detail.event.altKey !== undefined) {
                altPressed = e.detail.event.altKey;
            }
        }

        const snapMode = (typeof AppState !== 'undefined' && AppState.config && AppState.config.svgGridSnap) 
            ? AppState.config.svgGridSnap : 'alt';

        if (snapMode === 'always') {
            return !altPressed; // 常時スナップ：Alt押下時のみスナップ解除
        } else {
            return altPressed; // 従来通り：Alt押下時のみスナップ
        }
    },

    /**
     * Altキーが押されている場合、座標をグリッドにスナップさせる
     * @param {Object} pt 現在の座標 {x, y}
     * @param {Event} e マウスイベント
     * @returns {Object} 補正後の座標 {x, y}
     */
    snapPointToGridIfAlt(pt, e) {
        const isSnap = this.isSnapEnabled(e);
        if (isSnap && typeof AppState !== 'undefined' && AppState.config.grid) {
            const snapSize = AppState.config.grid.size || 15;
            return {
                x: Math.round(pt.x / snapSize) * snapSize,
                y: Math.round(pt.y / snapSize) * snapSize
            };
        }
        return pt;
    },

    /**
     * Make an element draggable with scale compensation and position persistence.
     * @param {HTMLElement} el The element to move
     * @param {HTMLElement} handle The drag handle
     * @param {Object} options Configuration options
     */
    makeElementDraggable(el, handle, options = {}) {
        const {
            storageKey = null,
            storageType = 'local',
            container = document.body
        } = options;

        let isDragging = false, startX, startY, initialLeft, initialTop;

        const onMouseDown = (e) => {
            // Do not drag if typing in inputs
            if (e.target.tagName.toLowerCase() === 'input') return;
            // Only drag if clicking handle or handle children (if any)
            if (handle && !handle.contains(e.target) && handle !== e.target) {
                // Special case for buttons inside handle
                if (e.target.closest('button') && !e.target.closest('.svg-toolbar-drag-handle')) return;
            }

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const scale = SVGUtils.getTransformScale(container);

            // Handle center-aligned elements or transforms
            if (el.style.transform && (el.style.transform.includes('translateX') || el.style.transform.includes('translate(-50%'))) {
                const rect = el.getBoundingClientRect();
                const parentRect = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };

                el.style.transform = 'none';
                el.style.left = ((rect.left - parentRect.left) / scale) + 'px';
                el.style.top = ((rect.top - parentRect.top) / scale) + 'px';
            }

            initialLeft = parseFloat(el.style.left) || 0;
            initialTop = parseFloat(el.style.top) || 0;

            el.style.cursor = 'grabbing';
            if (handle) handle.style.cursor = 'grabbing';

            e.preventDefault();
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const scale = SVGUtils.getTransformScale(container);
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;
            el.style.left = (initialLeft + dx) + 'px';
            el.style.top = (initialTop + dy) + 'px';
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            el.style.cursor = '';
            if (handle) handle.style.cursor = '';

            if (storageKey) {
                const pos = { left: el.style.left, top: el.style.top };
                if (storageType === 'session') {
                    sessionStorage.setItem(storageKey, JSON.stringify(pos));
                } else {
                    localStorage.setItem(storageKey, JSON.stringify(pos));
                }
            }

            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        (handle || el).addEventListener('mousedown', onMouseDown);

        // Restore position
        if (storageKey) {
            const saved = (storageType === 'session' ? sessionStorage : localStorage).getItem(storageKey);
            if (saved) {
                try {
                    const pos = JSON.parse(saved);
                    const leftVal = parseFloat(pos.left);
                    const topVal = parseFloat(pos.top);

                    // Restrict only extremely large values that might indicate corruption
                    if (!isNaN(leftVal) && !isNaN(topVal) && Math.abs(leftVal) < 10000 && Math.abs(topVal) < 10000) {
                        el.style.transform = 'none';
                        el.style.left = pos.left;
                        el.style.top = pos.top;
                        el.style.right = 'auto'; // Ensure it's absolute
                    }
                } catch (err) { }
            }
        }
    },

    /**
     * Map a local point on a node to the coordinate system of an overlay group.
     * Used by handlers (radius, rotation, bubble) to place handles correctly.
     * @param {SVGPoint|Array|Object} pt Local point {x, y}
     * @param {SVGElement} node Target element
     * @param {SVGElement} overlay Overlay group element
     * @returns {SVGPoint} Point in overlay coordinates
     */
    mapLocalToOverlay(pt, node, overlay) {
        try {
            const svg = node.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: pt.x || pt[0] || 0, y: pt.y || pt[1] || 0 };

            const p = svg.createSVGPoint();
            p.x = pt.x !== undefined ? pt.x : (pt[0] !== undefined ? pt[0] : 0);
            p.y = pt.y !== undefined ? pt.y : (pt[1] !== undefined ? pt[1] : 0);

            // [FIX] Use getCTM() instead of getScreenCTM() to avoid browser zoom drift.
            const nodeMatrix = node.getCTM();
            const overlayMatrix = (overlay && typeof overlay.getCTM === 'function') ? overlay.getCTM() : null;

            if (nodeMatrix) {
                // Transform local point to SVG world coordinate
                const worldP = p.matrixTransform(nodeMatrix);
                // If overlay exists, map inversely to its local space.
                if (overlayMatrix) {
                    return worldP.matrixTransform(overlayMatrix.inverse());
                }
                return worldP;
            }
            return p; // Fallback
        } catch (e) {
            console.warn('[SVGUtils] mapLocalToOverlay failed:', e);
            return { x: pt.x || pt[0] || 0, y: pt.y || pt[1] || 0 };
        }
    },

    /**
     * Offset the coordinates in path metadata attributes (data-poly-points, data-bez-points)
     * Used when an element is moved via dmove() or similar direct coordinate changes.
     * @param {SVGElement|Object} el SVG.js element or DOM node
     * @param {number} dx X offset
     * @param {number} dy Y offset
     */
    offsetPathMetadata(el, dx, dy) {
        if (!el || (dx === 0 && dy === 0)) return;
        const node = el.node || el;

        // Helper to offset numbers in a comma/space separated string (alternate x, y)
        const offsetCsvPoints = (csv, dx, dy) => {
            if (!csv) return csv;
            let isX = true;
            // 負数、浮動小数点、指数表記に対応した数値抽出正規表現
            return csv.replace(/([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g, (match) => {
                const val = parseFloat(match);
                const res = (val + (isX ? dx : dy)).toString();
                isX = !isX; // X と Y を交互に切り替える
                return res;
            });
        };

        // 1. data-poly-points (CSV of x1,y1,x2,y2...)
        const polyPoints = node.getAttribute('data-poly-points');
        if (polyPoints) {
            node.setAttribute('data-poly-points', offsetCsvPoints(polyPoints, dx, dy));
        }

        // 2. data-bez-points (JSON array of point objects)
        const bezPoints = node.getAttribute('data-bez-points');
        if (bezPoints) {
            try {
                const data = JSON.parse(bezPoints);
                if (Array.isArray(data)) {
                    data.forEach(p => {
                        // Handle control points (cpIn/cpOut are [x, y] arrays)
                        if (Array.isArray(p.cpIn)) {
                            p.cpIn[0] += dx;
                            p.cpIn[1] += dy;
                        }
                        if (Array.isArray(p.cpOut)) {
                            p.cpOut[0] += dx;
                            p.cpOut[1] += dy;
                        }
                    });
                    node.setAttribute('data-bez-points', JSON.stringify(data));
                }
            } catch (e) {
                console.warn('[SVGUtils] Failed to parse/offset data-bez-points:', e);
            }
        }
    },

    /**
     * Refresh path metadata (data-poly-points, etc.) from the element's current 'd' or 'points' attribute.
     * Used when an element is scaled or morphed directly.
     * @param {SVGElement|Object} el SVG.js element or DOM node
     */
    refreshPathMetadata(el) {
        if (!el) return;
        const node = el.node || el;
        const tagName = node.tagName.toLowerCase();
        const toolId = el.attr ? el.attr('data-tool-id') : node.getAttribute('data-tool-id');

        // [MOD] Support any path/polyline/line regardless of toolId if they lack metadata
        if (tagName === 'path' || tagName === 'polyline' || tagName === 'line') {
            if (typeof SvgPolylineHandler !== 'undefined') {
                const handler = new SvgPolylineHandler(null, null);

                // SVG.js array() is expensive but accurate for 'd' parsing.
                // Fallback to native path parsing if needed.
                let points = [];
                let bezData = [];

                if (tagName === 'path') {
                    // [NEW] Use a more robust way to get path segments if data-poly-points is missing
                    const currentPoly = node.getAttribute('data-poly-points');
                    if (!currentPoly) {
                        try {
                            const pathData = (el.array && typeof el.array === 'function') ? el.array() : null;
                            if (pathData) {
                                pathData.forEach(seg => {
                                    const cmd = seg[0];
                                    const coords = seg.slice(1);
                                    if (coords.length >= 2) {
                                        points.push([coords[coords.length - 2], coords[coords.length - 1], cmd === 'M']);
                                        bezData.push({ type: 0 });
                                    }
                                });
                            }
                        } catch (e) {
                            console.warn('[SVGUtils] Failed to parse path array', e);
                        }
                    }
                } else if (tagName === 'polyline' || tagName === 'line') {
                    points = handler.getPoints(node);
                }

                if (points.length > 0 && !node.getAttribute('data-poly-points')) {
                    node.setAttribute('data-poly-points', points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' '));
                    console.log(`[SVGUtils] Refreshed data-poly-points for ${node.id || tagName}`);
                }
            }
        }
    },

    /**
     * Map screen coordinates (MouseEvent) to a node's local coordinate system.
     * Integrates grid snapping if Alt key is pressed.
     * @param {MouseEvent|PointerEvent} e The event with clientX/Y
     * @param {SVGElement} node The target node
     * @returns {SVGPoint} Point in node's local coordinates
     */
    getLocalPoint(e, node) {
        const svg = node.ownerSVGElement || (node.tagName.toLowerCase() === 'svg' ? node : document.querySelector('svg.svg-editable'));
        if (!svg) return { x: e.clientX, y: e.clientY };

        const p = svg.createSVGPoint();
        p.x = e.clientX;
        p.y = e.clientY;

        // getScreenCTM は現在の表示状態（CSSズームやviewBoxズーム）をすべて含んだ行列を返す
        const ctm = node.getScreenCTM();
        if (!ctm) return { x: e.clientX, y: e.clientY };

        // 1. Transform to local space
        let localPt = p.matrixTransform(ctm.inverse());

        // 2. Apply Grid Snapping in World Coordinate based on settings
        const isSnap = this.isSnapEnabled(e);
        if (isSnap && typeof AppState !== 'undefined' && AppState.config.grid) {
            const snapSize = AppState.config.grid.size || 15;
            const rootCTM = svg.getScreenCTM();
            if (rootCTM) {
                const worldPt = p.matrixTransform(rootCTM.inverse());
                const snappedWorldX = Math.round(worldPt.x / snapSize) * snapSize;
                const snappedWorldY = Math.round(worldPt.y / snapSize) * snapSize;

                const pSnappedWorld = svg.createSVGPoint();
                pSnappedWorld.x = snappedWorldX;
                pSnappedWorld.y = snappedWorldY;
                const pSnappedScreen = pSnappedWorld.matrixTransform(rootCTM);
                localPt = pSnappedScreen.matrixTransform(ctm.inverse());
            }
        }

        return localPt;
    },

    /**
     * Douglas-Peucker algorithm to simplify a set of points.
     * @param {Array} points Array of [x, y] coordinates.
     * @param {number} epsilon Distance threshold.
     * @returns {Array} Simplified array of [x, y] coordinates.
     */
    simplifyPoints(points, epsilon) {
        if (points.length <= 2) return points;

        let dmax = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const d = this._findPerpendicularDistance(points[i], points[0], points[end]);
            if (d > dmax) {
                index = i;
                dmax = d;
            }
        }

        if (dmax > epsilon) {
            const res1 = this.simplifyPoints(points.slice(0, index + 1), epsilon);
            const res2 = this.simplifyPoints(points.slice(index), epsilon);
            return res1.slice(0, res1.length - 1).concat(res2);
        } else {
            return [points[0], points[end]];
        }
    },

    _findPerpendicularDistance(p, p1, p2) {
        let x = p1[0], y = p1[1], dx = p2[0] - x, dy = p2[1] - y;
        if (dx !== 0 || dy !== 0) {
            const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = p2[0]; y = p2[1];
            } else if (t > 0) {
                x += dx * t; y += dy * t;
            }
        }
        dx = p[0] - x; dy = p[1] - y;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Calculate smooth cubic bezier control points for a set of vertices.
     * Based on Catmull-Rom to Cubic Bezier conversion or similar tension-based smoothing.
     * @param {Array} points Array of [x, y] coordinates.
     * @param {number} tension Smoothing tension (0.0 to 1.0, default ~0.3).
     * @returns {Array} Array of {type, cpIn, cpOut} for each point.
     */
    calculateSmoothControlPoints(points, tension = 0.3) {
        const result = points.map(() => ({ type: 1, cpIn: null, cpOut: null }));
        if (points.length < 2) return result;

        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const prev = points[i - 1] || curr;
            const next = points[i + 1] || curr;

            if (i === 0) {
                // First point: only cpOut
                const dx = next[0] - curr[0];
                const dy = next[1] - curr[1];
                result[i].cpOut = [curr[0] + dx * tension, curr[1] + dy * tension];
                result[i].type = 2; // Cusp-like at ends
            } else if (i === points.length - 1) {
                // Last point: only cpIn
                const dx = curr[0] - prev[0];
                const dy = curr[1] - prev[1];
                result[i].cpIn = [curr[0] - dx * tension, curr[1] - dy * tension];
                result[i].type = 2;
            } else {
                // Intermediate points: cpIn and cpOut should be collinear for smoothness (type 1)
                const prevDist = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) || 1;
                const nextDist = Math.hypot(next[0] - curr[0], next[1] - curr[1]) || 1;

                // Typical smooth curve tangent calculation
                const dx = next[0] - prev[0];
                const dy = next[1] - prev[1];
                const totalDist = Math.hypot(dx, dy) || 1;

                const ux = dx / totalDist;
                const uy = dy / totalDist;

                result[i].cpIn = [curr[0] - ux * prevDist * tension, curr[1] - uy * prevDist * tension];
                result[i].cpOut = [curr[0] + ux * nextDist * tension, curr[1] + uy * nextDist * tension];
                result[i].type = 1; // Smooth
            }
        }
        return result;
    },

    /**
     * Get snap points (edges and center) for an element.
     * @param {Object} rbox SVG.js rbox (bbox in world coords)
     * @returns {Object} Object containing vertical and horizontal lines
     */
    getSnapLines(rbox) {
        return {
            v: [rbox.x, rbox.cx, rbox.x2], // Left, Center, Right
            h: [rbox.y, rbox.cy, rbox.y2]  // Top, Middle, Bottom
        };
    },

    /**
     * Find the best smart snap for a moving box against target boxes.
     * @param {Object} movingRBox The box currently being moved
     * @param {Array} targetBoxes Array of other elements' rboxes
     * @param {number} threshold Pixel threshold for snapping
     * @returns {Object|null} Snap result {dx, dy, guidesV, guidesH} or null
     */
    findSmartSnap(movingRBox, targetBoxes, threshold = 5) {
        if (!targetBoxes || targetBoxes.length === 0) return null;

        const snapM = this.getSnapLines(movingRBox);
        let bestSnapX = { dist: Infinity, value: 0, targetValue: 0 };
        let bestSnapY = { dist: Infinity, value: 0, targetValue: 0 };

        for (const targetBox of targetBoxes) {
            const snapT = this.getSnapLines(targetBox);

            // Check Vertical Snapping (X-axis alignment)
            for (const mx of snapM.v) {
                for (const tx of snapT.v) {
                    const d = Math.abs(mx - tx);
                    if (d < threshold && d < bestSnapX.dist) {
                        bestSnapX = { dist: d, value: mx, targetValue: tx };
                    }
                }
            }

            // Check Horizontal Snapping (Y-axis alignment)
            for (const my of snapM.h) {
                for (const ty of snapT.h) {
                    const d = Math.abs(my - ty);
                    if (d < threshold && d < bestSnapY.dist) {
                        bestSnapY = { dist: d, value: my, targetValue: ty };
                    }
                }
            }
        }

        const result = { dx: 0, dy: 0, guidesV: [], guidesH: [] };
        let snapped = false;

        if (bestSnapX.dist !== Infinity) {
            result.dx = bestSnapX.targetValue - bestSnapX.value;
            result.guidesV.push(bestSnapX.targetValue);
            snapped = true;
        }
        if (bestSnapY.dist !== Infinity) {
            result.dy = bestSnapY.targetValue - bestSnapY.value;
            result.guidesH.push(bestSnapY.targetValue);
            snapped = true;
        }

        return snapped ? result : null;
    },

    /**
     * Apply zoom-invariant scaling to a handle element (circle or rect).
     * This keeps the handle visually the same size regardless of the SVG zoom level.
     * @param {SVGElement|Object} handle The SVG element (or SVG.js object) to scale
     * @param {number} zoom Current zoom level (e.g. 100, 200, 110)
     */
    updateHandleScaling(handle, zoom) {
        if (!handle) return;
        const node = handle.node || handle;
        if (!node || typeof node.setAttribute !== 'function') return;

        const zoomVal = zoom || (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
        const s = 100 / zoomVal;

        let tx, ty;
        const tagName = node.tagName.toLowerCase();

        if (tagName === 'line') {
            // [NEW] Special handling for lines (don't use transform to avoid moving endpoints)
            // Instead, adjust stroke properties directly
            const baseStroke = parseFloat(node.getAttribute('data-base-stroke') || node.getAttribute('stroke-width') || 1);
            if (!node.hasAttribute('data-base-stroke')) {
                node.setAttribute('data-base-stroke', baseStroke);
            }
            node.setAttribute('stroke-width', baseStroke * s);

            const dash = node.getAttribute('data-base-dash') || node.getAttribute('stroke-dasharray');
            if (dash && dash !== 'none') {
                if (!node.hasAttribute('data-base-dash')) {
                    node.setAttribute('data-base-dash', dash);
                }
                const dashedArray = dash.split(/[\s,]+/).map(v => parseFloat(v) * s);
                node.setAttribute('stroke-dasharray', dashedArray.join(' '));
            }
            return;
        }

        if (tagName === 'rect') {
            const w = parseFloat(node.getAttribute('width') || 0);
            const h = parseFloat(node.getAttribute('height') || 0);
            tx = parseFloat(node.getAttribute('x') || 0) + w / 2;
            ty = parseFloat(node.getAttribute('y') || 0) + h / 2;
        } else if (tagName === 'circle') {
            tx = parseFloat(node.getAttribute('cx') || 0);
            ty = parseFloat(node.getAttribute('cy') || 0);
        } else {
            // Fallback for groups or other elements: use BBox center
            try {
                const bbox = node.getBBox();
                tx = bbox.x + bbox.width / 2;
                ty = bbox.y + bbox.height / 2;
            } catch (e) {
                return;
            }
        }

        // Math: M(p) = s*p + dx. Condition: M(Target) = Target => dx = Target * (1 - s)
        const dx = tx * (1 - s);
        const dy = ty * (1 - s);

        // Clear CSS transform to avoid conflicts
        if (node.style) {
            node.style.transform = '';
            node.style.transformOrigin = '';
        }

        // Apply scale around Target point via coordinate shift
        node.setAttribute('transform', `translate(${dx} ${dy}) scale(${s})`);
    },

    /**
     * テキストを指定された幅と高さに基づいて折り返し・省略処理した行の配列を返します。
     * @param {string} text 元のテキスト
     * @param {number} maxWidth 最大幅 (px)
     * @param {number} maxHeight 最大高さ (px)
     * @param {Object} fontOpts フォント情報 { fontSize, fontFamily }
     * @param {number} lineSpacing 行間倍率（例: 1.2）
     * @returns {Array} 表示する各行の文字列が格納された配列
     */
    wrapAndTruncateText(text, maxWidth, maxHeight, fontOpts, lineSpacing = 1.2) {
        if (!text) return [''];
        
        // パディング（余白）を考慮して実質的な最大幅を狭める
        // 図形の寸法に対して5%の相対的な余白を取る（小さすぎる/大きすぎる図形への対応）
        const paddingX = maxWidth * 0.05;
        const paddingY = maxHeight * 0.05;
        const effectiveMaxWidth = Math.max(10, maxWidth - (paddingX * 2));
        const effectiveMaxHeight = Math.max(10, maxHeight - (paddingY * 2));

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = fontOpts.fontSize || 20;
        
        // fontFamilyが"Noto Sans JP"などスペースを含む場合にCanvasでパース失敗するのを防ぐ
        let cleanFamily = (fontOpts.fontFamily || 'sans-serif').replace(/['"]/g, '');
        if (cleanFamily === 'inherit') cleanFamily = 'sans-serif'; // inheritはCanvasでエラーや意図しない動作になる
        ctx.font = `${fontSize}px "${cleanFamily}", sans-serif`;
        
        console.log(`[WRAP CALC] text: "${text}", W: ${maxWidth}, H: ${maxHeight}, EffectiveW: ${effectiveMaxWidth}, Font: ${ctx.font}`);
        
        const lineHeight = fontSize * lineSpacing;
        const maxLines = Math.floor(effectiveMaxHeight / lineHeight);
        
        // もし高さが小さすぎて1行も入らない場合でも、最低1行は表示（省略して）させる
        const allowedLines = Math.max(1, maxLines);
        
        let lines = [];
        const paragraphs = text.split('\n');
        
        for (let j = 0; j < paragraphs.length; j++) {
            const pText = paragraphs[j];
            if (pText === '') {
                lines.push('');
                continue;
            }

            let currentLine = '';
            for (let i = 0; i < pText.length; i++) {
                const char = pText[i];
                const testLine = currentLine + char;
                const metrics = ctx.measureText(testLine);
                // 日本語の全角文字などの場合、Canvasのシステムフォールバック計測が実際より5〜10%ほど小さく出ることがあるため、
                // 安全係数 1.1 をかけて少し広めに見積もる
                const estimatedWidth = metrics.width * 1.1;
                
                // もしテスト行が幅を超え、かつ現在の行が空でない場合（1文字で超える場合は1文字を表示）
                if (estimatedWidth > effectiveMaxWidth && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine.length > 0) {
                lines.push(currentLine);
            }
        }
        
        // 最終的な行数が上限を超えた場合の省略（三点リーダ）処理
        if (lines.length > allowedLines) {
            lines = lines.slice(0, allowedLines);
            let lastLine = lines[lines.length - 1];
            
            // "..." が追加される分を考慮して最後の行の文字をさらに削る
            while (lastLine.length > 0 && ctx.measureText(lastLine + '...').width > effectiveMaxWidth) {
                lastLine = lastLine.slice(0, -1);
            }
            lines[lines.length - 1] = lastLine + '...';
        }
        
        return lines;
    }
};

window.SVGUtils = SVGUtils;
