/**
 * SvgPolylineHandler - Handles vertex and arrow size manipulation for Polyline Arrow tool.
 */
class SvgPolylineHandler {
    constructor(container, onUpdate) {
        this.container = container;
        this.onUpdate = onUpdate;
        this.handleGroup = null;
        this.activeNode = null;
        this.overlayGroup = null;
    }

    /**
     * Update or create handles for the given polyline node
     */
    update(overlayGroup, node, bbox) {
        // [FIX] Ensure we only handle polyline, line, and our special path.
        const tagName = node ? node.tagName.toLowerCase() : '';
        if (tagName !== 'polyline' && tagName !== 'line' && tagName !== 'path') {
            this.hide();
            return;
        }

        this.activeNode = node;

        if (overlayGroup && overlayGroup !== this.overlayGroup) {
            this.overlayGroup = overlayGroup;
            // [REMOVED] JS-based zoom listener is now replaced by CSS scaling
        }

        if (!this.overlayGroup) {
            return;
        }

        if (!this.handleGroup) {
            this.handleGroup = SVG(this.overlayGroup).group().addClass('polyline-handle-group').node;
        }

        // Get points first - needed by both midpoint and vertex handle creation
        const points = this.getPoints(node);

        // [FIX] Clear all existing handles to ensure correct DOM order
        while (this.handleGroup.firstChild) {
            this.handleGroup.removeChild(this.handleGroup.firstChild);
        }

        // ▼▼▼ 追加: 複雑なパス(50頂点以上)の場合は個別ハンドルの生成をスキップ ▼▼▼
        const shouldDrawHandles = points.length <= 50;

        if (shouldDrawHandles) {
            // [NEW] 1. Create Midpoint Handles FIRST (so they are behind vertices in DOM)
            // Note: For <line> elements, midpoint division into <polyline> is not supported here yet.
            if (tagName !== 'line') {
                const bezData = (tagName === 'path') ? this.getBezData(node) : [];
                const isClosed = node.getAttribute('data-poly-closed') === 'true';
                const loopEnd = isClosed ? points.length : points.length - 1;
                for (let i = 0; i < loopEnd; i++) {
                    const pt1 = points[i];
                    const pt2 = points[(i + 1) % points.length];

                    // [NEW] Skip midpoint handles between sub-paths
                    if (pt2[2] && !isClosed) continue;
                    if (isClosed && i === points.length - 1 && pt2[2]) {
                        // Wrap-around
                    } else if (pt2[2]) {
                        continue;
                    }

                    let midPt;
                    if (tagName === 'path' && bezData.length > 0) {
                        const bz1 = bezData[i] || { type: 0 };
                        const bz2 = bezData[(i + 1) % points.length] || { type: 0 };
                        const cp1 = bz1.cpOut || pt1;
                        const cp2 = bz2.cpIn || pt2;
                        // Cubic Bezier t=0.5: 0.125*P0 + 0.375*CP1 + 0.375*CP2 + 0.125*P1
                        midPt = [
                            0.125 * pt1[0] + 0.375 * cp1[0] + 0.375 * cp2[0] + 0.125 * pt2[0],
                            0.125 * pt1[1] + 0.375 * cp1[1] + 0.375 * cp2[1] + 0.125 * pt2[1]
                        ];
                    } else {
                        midPt = [(pt1[0] + pt2[0]) / 2, (pt1[1] + pt2[1]) / 2];
                    }

                    const handlePoint = this.getHandlePoint(midPt, node, this.overlayGroup);

                    const midCircleWrap = SVG(this.handleGroup).circle(6)
                        .fill('#ffec3d').attr('fill-opacity', '0.5')
                        .stroke({color: '#333', width: 1})
                        .attr('cursor', 'grab')
                        .addClass('midpoint-handle')
                        .attr({
                            'data-type': 'midpoint',
                            'data-vertex-index': i,
                            'pointer-events': 'all'
                        })
                        .center(handlePoint.x, handlePoint.y);
                    const midCircle = midCircleWrap.node;

                    // [NEW] Dynamic Scaling
                    if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                        window.SVGUtils.updateHandleScaling(midCircle);
                    }

                    // Already added by SVG(this.handleGroup)
                    this.bindMidpointDrag(midCircle);
                }
            }

            // 2. Create Vertex Handles AFTER (so they are on top in DOM)
            points.forEach((pt, index) => {
                const handlePoint = this.getHandlePoint(pt, node, this.overlayGroup);

                const circleWrap = SVG(this.handleGroup).circle(10)
                    .fill('#ffec3d')
                    .stroke({color: '#333', width: 1})
                    .attr('cursor', 'move')
                    .addClass('polyline-handle')
                    .attr({
                        'data-type': 'vertex',
                        'data-index': index
                    })
                    .center(handlePoint.x, handlePoint.y);
                const circle = circleWrap.node;

                // [NEW] Dynamic Scaling
                if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                    window.SVGUtils.updateHandleScaling(circle);
                }

                // Already added by SVG(this.handleGroup)
                this.bindVertexDrag(circle, index);
                this.bindVertexDblClick(circle, index); // [NEW] Bezeir toggle
            });

            // [NEW] 3. Create Bezier Control Handles
            if (tagName === 'path') {
                const bezData = this.getBezData(node);
                points.forEach((pt, index) => {
                    const bz = bezData[index];
                    if (!bz || bz.type === 0) return;

                    const drawHandle = (cp, cpName) => {
                        if (!cp) return;
                        const hVertex = this.getHandlePoint(pt, node, this.overlayGroup);
                        const hCP = this.getHandlePoint(cp, node, this.overlayGroup);

                        const isCusp = bz && bz.type === 2;
                        const handleColor = isCusp ? '#000080' : '#0366d6';

                        const lineWrap = SVG(this.handleGroup).line(hVertex.x, hVertex.y, hCP.x, hCP.y)
                            .stroke({color: handleColor, width: 1.5})
                            .attr('stroke-dasharray', '3,3')
                            .attr('data-type', 'bez-control-line');
                        const line = lineWrap.node;

                        // [NEW] Dynamic Scaling for the dashed line
                        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                            window.SVGUtils.updateHandleScaling(line);
                        }

                        // Already added by SVG(this.handleGroup)

                        const cpCircleWrap = SVG(this.handleGroup).circle(8)
                            .fill('#fff')
                            .stroke({color: handleColor, width: 2})
                            .attr('cursor', 'pointer')
                            .addClass('bez-control-point')
                            .attr('data-type', 'bez-control-point')
                            .center(hCP.x, hCP.y);
                        const cpCircle = cpCircleWrap.node;

                        // [NEW] Dynamic Scaling
                        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                            window.SVGUtils.updateHandleScaling(cpCircle);
                        }

                        // Already added by SVG(this.handleGroup)

                        this.bindBezControlDrag(cpCircle, index, cpName);
                    };

                    drawHandle(bz.cpIn, 'cpIn');
                    drawHandle(bz.cpOut, 'cpOut');
                });
            }
        }
        // ▲▲▲ 追加ここまで ▲▲▲

        // 4. Arrow Size Handle (Placed near the end point or a specific offset)
        const arrowSize = parseFloat(node.getAttribute('data-arrow-size')) || 10;
        const hasStart = node.getAttribute('data-arrow-start') === 'true';
        const hasEnd = node.getAttribute('data-arrow-end') === 'true';

        if (hasStart || hasEnd) {
            const lastPt = points[points.length - 1];
            const prevPt = points[points.length - 2] || points[0];

            // Calculate direction for arrow size handle placement (offset from end point)
            const dx = lastPt[0] - prevPt[0];
            const dy = lastPt[1] - prevPt[1];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;

            // Size handle position (offset inward along the line)
            const sizePt = {
                x: lastPt[0] - (dx / len) * arrowSize,
                y: lastPt[1] - (dy / len) * arrowSize
            };
            const handleSizePt = this.getHandlePoint([sizePt.x, sizePt.y], node, this.overlayGroup);

            let sizeHandle = Array.from(this.handleGroup.children).find(h => h.getAttribute('data-type') === 'arrow-size');
            if (!sizeHandle) {
                const sizeHandleWrap = SVG(this.handleGroup).circle(8)
                    .fill('#0366d6')
                    .stroke({color: '#fff', width: 1})
                    .attr('cursor', 'se-resize')
                    .addClass('polyline-handle arrow-size-handle')
                    .attr('data-type', 'arrow-size');
                sizeHandle = sizeHandleWrap.node;
                this.bindSizeDrag(sizeHandle);
            }
            sizeHandle.setAttribute('cx', handleSizePt.x);
            sizeHandle.setAttribute('cy', handleSizePt.y);

            // [NEW] Dynamic Scaling
            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(sizeHandle);
            }

            sizeHandle.style.display = 'block';
        } else {

            const sizeHandle = Array.from(this.handleGroup.children).find(h => h.getAttribute('data-type') === 'arrow-size');
            if (sizeHandle) sizeHandle.style.display = 'none';
        }

        // [NEW] Enforce fill="none" for open paths (as per user request)
        if (tagName === 'path' || tagName === 'polyline' || tagName === 'line') {
            const isClosed = node.getAttribute('data-poly-closed') === 'true';
            if (!isClosed) {
                if (node.getAttribute('fill') !== 'none') {
                    node.setAttribute('fill', 'none');
                }
            }
        }

        // [REMOVED] refreshHandleSizes is now a no-op handled by CSS

        // [FIX] Ensure handle group is attached
        if (this.handleGroup && this.overlayGroup && this.handleGroup.parentNode !== this.overlayGroup) {
            this.overlayGroup.appendChild(this.handleGroup);
        }
    }

    getPoints(node) {
        if (!node) return [];
        const tagName = node.tagName.toLowerCase();

        if (tagName === 'line') {
            const x1 = parseFloat(node.getAttribute('x1')) || 0;
            const y1 = parseFloat(node.getAttribute('y1')) || 0;
            const x2 = parseFloat(node.getAttribute('x2')) || 0;
            const y2 = parseFloat(node.getAttribute('y2')) || 0;
            return [[x1, y1], [x2, y2]];
        }

        let pointsStr = node.getAttribute('data-poly-points') || node.getAttribute('points');

        // [NEW] Fallback for paths without metadata: Parse 'd' attribute
        if (!pointsStr && tagName === 'path') {
            const pathData = node.getAttribute('d') || "";
            // Simple parsing for M/L/C commands to extract vertices
            // (Note: C commands are handled by getting the final point of the segment)
            const pts = [];
            try {
                // Use SVG.js if available on the node's instance or via global
                const el = node.instance || (typeof SVG === 'function' ? SVG(node) : null);
                if (el && typeof el.array === 'function') {
                    const arr = el.array();
                    arr.forEach(seg => {
                        const cmd = seg[0];
                        const coords = seg.slice(1);
                        if (coords.length >= 2) {
                            // The last two coordinates are always the anchor point in L, C, S, Q, T
                            pts.push([coords[coords.length - 2], coords[coords.length - 1], cmd === 'M']);
                        }
                    });
                }
            } catch (e) {
                console.warn('[SvgPolylineHandler] Fallback path parsing failed', e);
            }
            if (pts.length > 0) return pts;
        }

        if (!pointsStr) return [];

        // Support "M x,y" format for sub-paths
        const parts = pointsStr.split(/\s+/).filter(s => s !== "");
        const pts = [];
        parts.forEach(p => {
            const isM = p.startsWith('M');
            const coord = (isM ? p.substring(1) : p).split(',');
            const x = parseFloat(coord[0]);
            const y = parseFloat(coord[1]);
            if (!isNaN(x) && !isNaN(y)) {
                pts.push([x, y, isM]);
            }
        });
        return pts;
    }

    getBezData(node) {
        try {
            const bezStr = node.getAttribute('data-bez-points');
            if (bezStr) {
                const data = JSON.parse(bezStr);
                if (Array.isArray(data)) {
                    // [FIX] Sanitize array: replace null/undefined with default corner type
                    return data.map(bz => (bz && typeof bz === 'object') ? bz : { type: 0 });
                }
            }
        } catch (e) { }
        return [];
    }

    setBezData(node, data) {
        node.setAttribute('data-bez-points', JSON.stringify(data));
        this.generatePath(node);
    }

    generatePath(node) {
        if (node.tagName.toLowerCase() !== 'path') return;
        const points = this.getPoints(node);
        if (points.length === 0) return;

        const bezData = this.getBezData(node);
        const isClosed = node.getAttribute('data-poly-closed') === 'true';
        let d = "";

        points.forEach((curr, i) => {
            if (i === 0 || curr[2]) {
                // First point or explicit MoveTo
                d += `M ${curr[0]} ${curr[1]} `;
            } else {
                const prev = points[i - 1];
                const prevBez = bezData[i - 1] || { type: 0 };
                const currBez = bezData[i] || { type: 0 };

                let cp1 = prevBez.cpOut || prev;
                let cp2 = currBez.cpIn || curr;

                if (cp1[0] === prev[0] && cp1[1] === prev[1] && cp2[0] === curr[0] && cp2[1] === curr[1]) {
                    d += `L ${curr[0]} ${curr[1]} `;
                } else {
                    d += `C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curr[0]} ${curr[1]} `;
                }
            }
        });

        if (isClosed && points.length > 1) {
            const lastIdx = points.length - 1;
            const prev = points[lastIdx];
            const curr = points[0];
            const lastBez = bezData[lastIdx] || { type: 0 };
            const firstBez = bezData[0] || { type: 0 };

            const cp1 = lastBez.cpOut || prev;
            const cp2 = firstBez.cpIn || curr;

            if (cp1[0] !== prev[0] || cp1[1] !== prev[1] || cp2[0] !== curr[0] || cp2[1] !== curr[1]) {
                d += `C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curr[0]} ${curr[1]} `;
            }
            d += "Z";
        } else if (isClosed) {
            d += "Z";
        }

        node.setAttribute('d', d);
    }

    convertToPath(node) {
        if (node.tagName.toLowerCase() === 'path') return null;

        const svgjsEl = SVG(node);
        const points = this.getPoints(node);
        if (points.length === 0) return null;

        let d = `M ${points[0][0]} ${points[0][1]} `;
        for (let i = 1; i < points.length; i++) {
            d += `L ${points[i][0]} ${points[i][1]} `;
        }

        const path = SVG(node.ownerSVGElement).path(d);
        Array.from(node.attributes).forEach(attr => {
            if (['x1', 'y1', 'x2', 'y2', 'points', 'd', 'id', 'data-tool-id'].indexOf(attr.name) === -1) {
                path.attr(attr.name, attr.value);
            }
        });

        if (node.id) path.attr('id', node.id);
        const toolId = node.getAttribute('data-tool-id') || (node.tagName.toLowerCase() === 'line' ? 'line' : 'polyline');
        path.attr('data-tool-id', toolId);
        path.attr('data-poly-points', points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' '));
        console.log(`[SvgPolylineHandler] convertToPath for ${node.id}: pointsStr=${path.attr('data-poly-points')}`);

        path.insertBefore(svgjsEl);
        svgjsEl.remove();

        if (typeof window.makeInteractive === 'function') {
            window.makeInteractive(path);
        }

        return path.node;
    }

    getHandlePoint(pt, node, overlay) {
        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
            return window.SVGUtils.mapLocalToOverlay(pt, node, overlay);
        }

        try {
            const svg = node.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: pt[0], y: pt[1] };

            const p = svg.createSVGPoint();
            p.x = pt[0];
            p.y = pt[1];

            const nodeMatrix = node.getCTM();
            const overlayMatrix = overlay ? overlay.getCTM() : null;

            if (nodeMatrix) {
                const worldP = p.matrixTransform(nodeMatrix);
                if (overlayMatrix) {
                    try {
                        return worldP.matrixTransform(overlayMatrix.inverse());
                    } catch (err) {
                        return worldP;
                    }
                }
                return worldP;
            }
            return p;
        } catch (e) {
            console.warn('[SvgPolylineHandler] getHandlePoint failed:', e);
            return { x: pt[0], y: pt[1] };
        }
    }

    getLocalPoint(e, options = {}) {
        let localPt;
        if (window.SVGUtils && window.SVGUtils.getLocalPoint) {
            localPt = window.SVGUtils.getLocalPoint(e, this.activeNode);
        } else {
            // Fallback (duplicated logic but safer if utils missing)
            const svg = this.activeNode.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: e.clientX, y: e.clientY };
            const p = svg.createSVGPoint();
            p.x = e.clientX; p.y = e.clientY;
            const ctm = this.activeNode.getScreenCTM();
            localPt = (ctm) ? p.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY };
        }

        // Apply Angle Snapping in Local Coordinate (相對於頂点)
        const isShift = options.isShift || (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed) || e.shiftKey;
        if (isShift && options.pivot) {
            const dx = localPt.x - options.pivot[0];
            const dy = localPt.y - options.pivot[1];
            const dist = Math.hypot(dx, dy);
            if (dist > 0.1) {
                let angle = Math.atan2(dy, dx);
                const step = (15 * Math.PI) / 180;
                angle = Math.round(angle / step) * step;
                return {
                    x: options.pivot[0] + Math.cos(angle) * dist,
                    y: options.pivot[1] + Math.sin(angle) * dist
                };
            }
        }

        return localPt;
    }

    bindVertexDrag(handle, index) {
        let isDragging = false;

        const onMouseMove = (e) => {
            if (!isDragging) return;

            // [NEW] 実際に動かし始めたタイミングでコネクタを表示
            if (!this._connectorsShown) {
                const isAlt = SVGUtils.isSnapEnabled(e);
                if (!isAlt && window.SVGConnectorManager) {
                    const draw = SVG(this.activeNode.ownerSVGElement);
                    window.SVGConnectorManager.showAllConnectors(draw, SVG(this.activeNode));
                }
                this._connectorsShown = true;
            }

            let localPt = this.getLocalPoint(e);

            const isAlt = SVGUtils.isSnapEnabled(e);
            const draw = SVG(this.activeNode.ownerSVGElement);
            const vIdx = parseInt(handle.getAttribute('data-index'));
            const endType = (vIdx === 0) ? 'start' : (vIdx === this.getPoints(this.activeNode).length - 1 ? 'end' : null);

            // [NEW] コネクタ吸着（Altキーが押されていない場合）
            if (!isAlt && endType && window.SVGConnectorManager) {
                const worldPt = draw.point(e.clientX, e.clientY);
                const nearest = window.SVGConnectorManager.findNearestConnector(draw, worldPt, 20, SVG(this.activeNode));

                // [FIX] 同じ要素の反対側の端点がすでに接続されているコネクタ点にはスナップしない
                let skipSnap = false;
                if (nearest) {
                    const existingData = this.activeNode.getAttribute('data-connections');
                    if (existingData) {
                        try {
                            const connections = JSON.parse(existingData);
                            const otherEndType = (endType === 'start') ? 'end' : 'start';
                            const otherEnd = connections.find(c => c.endType === otherEndType);
                            if (otherEnd && nearest.id === otherEnd.targetId && nearest.index === otherEnd.pointIndex) {
                                skipSnap = true;
                            }
                        } catch (e) { }
                    }
                }

                if (nearest && !skipSnap) {
                    const rootNode = draw.node;
                    const mNode = rootNode.getScreenCTM().inverse().multiply(this.activeNode.getScreenCTM());
                    const mInv = mNode.inverse();
                    const snappedLocal = new SVG.Point(nearest.x, nearest.y).transform(mInv);

                    // [MOD] Ensure we only visual-snap if the logical connection is allowed
                    const success = window.SVGConnectorManager.connect(SVG(this.activeNode), endType, nearest.id, nearest.index);
                    if (success) {
                        localPt = { x: snappedLocal.x, y: snappedLocal.y };
                    } else {
                        window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
                        // localPt already contains mouse coordinates from getLocalPoint()
                    }
                } else {
                    window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
                }
            } else if (endType && window.SVGConnectorManager) {
                window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
            }



            const activeIndex = index;
            if (isNaN(activeIndex)) return;
            const points = this.getPoints(this.activeNode);

            // [NEW] Snapping to start/end point to close path
            this._isSnappedToClose = false;
            const isEndpoint = (activeIndex === 0 || activeIndex === points.length - 1);

            if (isEndpoint && points.length > 2) {
                const otherIdx = (activeIndex === 0) ? points.length - 1 : 0;
                const otherPt = points[otherIdx];
                const dx = localPt.x - otherPt[0];
                const dy = localPt.y - otherPt[1];

                // Get screen distance for threshold
                const svg = this.activeNode.ownerSVGElement;
                const m = this.activeNode.getScreenCTM();
                if (m) {
                    const screenDist = Math.hypot(dx * m.a, dy * m.d); // simplified, assume no rotation for threshold
                    const threshold = 15; // px
                    if (screenDist < threshold) {
                        localPt.x = otherPt[0];
                        localPt.y = otherPt[1];
                        this._isSnappedToClose = true;
                    }
                }
            }

            // [FIX] NaN Guard: skip updating if coordinates are invalid
            if (isNaN(localPt.x) || isNaN(localPt.y)) {
                console.warn('[SvgPolylineHandler] Vertex move skipped due to NaN coordinates.');
                return;
            }

            const oldPt = points[activeIndex];
            points[activeIndex] = [localPt.x, localPt.y];

            // [NEW] If already closed, move both start and end together ONLY if they are redundant points
            const isClosed = this.activeNode.getAttribute('data-poly-closed') === 'true';
            if (isClosed && isEndpoint) {
                const otherIdx = (activeIndex === 0) ? points.length - 1 : 0;
                const otherPt = points[otherIdx];
                if (Math.abs(oldPt[0] - otherPt[0]) < 0.001 && Math.abs(oldPt[1] - otherPt[1]) < 0.001) {
                    points[otherIdx] = [localPt.x, localPt.y];
                }
            }

            const tagName = this.activeNode.tagName.toLowerCase();
            if (tagName === 'line') {
                if (activeIndex === 0) {
                    this.activeNode.setAttribute('x1', points[0][0]);
                    this.activeNode.setAttribute('y1', points[0][1]);
                } else {
                    this.activeNode.setAttribute('x2', points[1][0]);
                    this.activeNode.setAttribute('y2', points[1][1]);
                }
            } else if (tagName === 'path') {
                const bezData = this.getBezData(this.activeNode);
                const bz = bezData[activeIndex];
                if (bz && bz.type > 0) {
                    const dx = localPt.x - oldPt[0];
                    const dy = localPt.y - oldPt[1];
                    if (bz.cpIn) bz.cpIn = [bz.cpIn[0] + dx, bz.cpIn[1] + dy];
                    if (bz.cpOut) bz.cpOut = [bz.cpOut[0] + dx, bz.cpOut[1] + dy];
                }
                // If closed and moving endpoints, sync bezier data too for cusp handles
                if (isClosed && isEndpoint) {
                    const otherIdx = (activeIndex === 0) ? points.length - 1 : 0;
                    const obz = bezData[otherIdx];
                    if (obz && obz.type > 0) {
                        const dx = localPt.x - oldPt[0];
                        const dy = localPt.y - oldPt[1];
                        if (obz.cpIn) obz.cpIn = [obz.cpIn[0] + dx, obz.cpIn[1] + dy];
                        if (obz.cpOut) obz.cpOut = [obz.cpOut[0] + dx, obz.cpOut[1] + dy];
                    }
                }
                const pointsStr = points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                this.activeNode.setAttribute('data-poly-points', pointsStr);
                this.setBezData(this.activeNode, bezData);
                console.log(`[SvgPolylineHandler] Vertex drag (path): updated pointsStr=${pointsStr}`);
            } else {
                const pointsStr = points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                this.activeNode.setAttribute('points', pointsStr);
                this.activeNode.setAttribute('data-poly-points', pointsStr);
                console.log(`[SvgPolylineHandler] Vertex drag: updated pointsStr=${pointsStr}`);
            }

            // Sync UI
            this.update(this.overlayGroup, this.activeNode, null);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseUp = () => {
            isDragging = false;
            this._connectorsShown = false;

            // [NEW] Close path if snapped
            if (this._isSnappedToClose) {
                this.activeNode.setAttribute('data-poly-closed', 'true');

                // 閉じた場合は、標準デザインとしてマーカー（矢印の先）を取り除くのが一般的
                this.activeNode.setAttribute('data-arrow-end', 'false');
                this.activeNode.setAttribute('data-arrow-start', 'false');

                const tagName = this.activeNode.tagName.toLowerCase();
                if (tagName !== 'path') {
                    // Convert to path first to support 'Z'
                    const newNode = this.convertToPath(this.activeNode);
                    if (newNode && window.selectElement) {
                        window.selectElement(SVG(newNode));
                        // Redraw via generatePath (already called inside convertToPath if it was a path, 
                        // but here we just converted from polyline, so set d with Z)
                        this.generatePath(newNode);
                    }
                } else {
                    this.generatePath(this.activeNode);
                }

                // マーカーの更新を反映させるためにSVGToolbarを呼ぶ
                if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                    window.SVGToolbar.updateArrowMarkers(SVG(this.activeNode));
                }

                if (window.syncChanges) window.syncChanges(true);
            }
            this._isSnappedToClose = false;

            // [NEW] コネクタポイントを非表示
            if (window.SVGConnectorManager) {
                const draw = SVG(this.activeNode.ownerSVGElement);
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[POLYLINE GUARD] Vertex drag blocked for ${this.activeNode.id()}`);
                return;
            }

            const isCtrl = e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed);
            if (isCtrl) {
                e.stopPropagation();
                e.preventDefault();
                const points = this.getPoints(this.activeNode);
                if (points.length <= 2) return; // Minimum 2 points required

                const vIdx = parseInt(handle.getAttribute('data-index'));
                if (isNaN(vIdx)) return;

                points.splice(vIdx, 1);

                // If closed, ensure consistency
                const isClosed = this.activeNode.getAttribute('data-poly-closed') === 'true';
                if (isClosed) {
                    // Force start and end to match
                    points[points.length - 1] = [points[0][0], points[0][1]];
                }

                const tagName = this.activeNode.tagName.toLowerCase();
                const pointsStr = points.map(p => p.join(',')).join(' ');

                if (tagName === 'path') {
                    const bezData = this.getBezData(this.activeNode);
                    bezData.splice(vIdx, 1);
                    if (isClosed) {
                        // Mirror bezier data for closed endpoints if needed
                        // (Usually the last one's cpIn and first one's cpOut are independent or synced)
                    }
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                    this.setBezData(this.activeNode, bezData);
                    this.generatePath(this.activeNode);
                } else {
                    this.activeNode.setAttribute('points', pointsStr);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                }

                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true);
                return;
            }

            e.stopPropagation();
            e.preventDefault();
            isDragging = true;

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindMidpointDrag(handle) {
        let isDragging = false;
        let hasConverted = false;
        let vertexIndex = -1;

        const onMouseMove = (e) => {
            if (!isDragging) return;

            if (!hasConverted) {
                hasConverted = true;

                const insertAfter = parseInt(handle.getAttribute('data-vertex-index'));
                if (isNaN(insertAfter)) return;

                vertexIndex = insertAfter + 1;
                const points = this.getPoints(this.activeNode);
                let localPt = this.getLocalPoint(e);

                points.splice(vertexIndex, 0, [localPt.x, localPt.y]);

                const pointsStr = points.map(p => p.join(',')).join(' ');

                if (this.activeNode.tagName.toLowerCase() === 'path') {
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                    const bezData = this.getBezData(this.activeNode);
                    bezData.splice(vertexIndex, 0, { type: 0 });
                    this.setBezData(this.activeNode, bezData);
                } else {
                    this.activeNode.setAttribute('points', pointsStr);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                }

                handle.setAttribute('data-type', 'vertex');
                handle.setAttribute('data-index', vertexIndex);
                handle.setAttribute('r', '5');
                handle.setAttribute('fill-opacity', '1.0');
                handle.setAttribute('cursor', 'move');

                if (this.onUpdate) this.onUpdate();
            }

            if (vertexIndex < 0) return;

            let localPt = this.getLocalPoint(e);



            const points = this.getPoints(this.activeNode);
            if (vertexIndex >= points.length) return;

            // [FIX] Update the point at vertexIndex with dragged coordinates
            points[vertexIndex] = [localPt.x, localPt.y];

            const pointsStr = points.map(p => p.join(',')).join(' ');

            if (this.activeNode.tagName.toLowerCase() === 'path') {
                this.activeNode.setAttribute('data-poly-points', pointsStr);
                this.generatePath(this.activeNode);
            } else {
                this.activeNode.setAttribute('points', pointsStr);
                this.activeNode.setAttribute('data-poly-points', pointsStr);
            }

            const handlePoint = this.getHandlePoint([localPt.x, localPt.y], this.activeNode, this.overlayGroup);
            handle.setAttribute('cx', handlePoint.x);
            handle.setAttribute('cy', handlePoint.y);

            if (this.onUpdate) this.onUpdate();
        };

        const onMouseUp = () => {
            isDragging = false;
            const didConvert = hasConverted;
            const vIndex = vertexIndex;
            hasConverted = false;
            vertexIndex = -1;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            if (didConvert || vIndex >= 0) {
                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true);
            }
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[POLYLINE GUARD] Midpoint drag blocked for ${this.activeNode.id()}`);
                return;
            }

            const isCtrl = e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed);
            if (isCtrl) {
                e.stopPropagation();
                e.preventDefault();

                const insertAfter = parseInt(handle.getAttribute('data-vertex-index'));
                if (isNaN(insertAfter)) return;

                const vIdx = insertAfter + 1;
                const points = this.getPoints(this.activeNode);

                // Get current handle position in local coordinates
                // Since this is a click, we can just use its current cx/cy and convert back, 
                // or just calculate the midpoint similarly to update().
                const cx = parseFloat(handle.getAttribute('cx'));
                const cy = parseFloat(handle.getAttribute('cy'));

                // Convert screen-ish overlay point back to local
                const pt = this.getLocalPoint(e);
                // Using event coordinates is better because it's where the user clicked.

                points.splice(vIdx, 0, [pt.x, pt.y]);

                const pointsStr = points.map(p => p.join(',')).join(' ');

                if (this.activeNode.tagName.toLowerCase() === 'path') {
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                    const bezData = this.getBezData(this.activeNode);
                    bezData.splice(vIdx, 0, { type: 0 });
                    this.setBezData(this.activeNode, bezData);
                    this.generatePath(this.activeNode);
                } else {
                    this.activeNode.setAttribute('points', pointsStr);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                }

                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true);
                return;
            }

            e.stopPropagation();
            e.preventDefault();
            isDragging = true;
            hasConverted = false;
            vertexIndex = -1;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindSizeDrag(handle) {
        let isDragging = false;
        let startSize = 10;
        let startPt = { x: 0, y: 0 };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const dy = e.clientY - startPt.y;
            const dx = e.clientX - startPt.x;
            const delta = Math.sqrt(dx * dx + dy * dy) * (dy > 0 ? 1 : -1);

            const newSize = Math.max(2, startSize + delta);
            this.activeNode.setAttribute('data-arrow-size', newSize);

            this.update(this.overlayGroup, this.activeNode, null);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[POLYLINE GUARD] Arrow size drag blocked for ${this.activeNode.id()}`);
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            isDragging = true;
            startSize = parseFloat(this.activeNode.getAttribute('data-arrow-size')) || 10;
            startPt = { x: e.clientX, y: e.clientY };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindVertexDblClick(handle, index) {
        SVG(handle).on('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // [FIX] Get fresh index because array might have changed by midpoint insertions
            const currentIndex = parseInt(handle.getAttribute('data-index'));
            if (isNaN(currentIndex)) return;

            let targetNode = this.activeNode;
            let converted = false;

            if (targetNode.tagName.toLowerCase() !== 'path') {
                const newNode = this.convertToPath(targetNode);
                if (newNode) {
                    targetNode = newNode;
                    converted = true;
                }
            }

            const points = this.getPoints(targetNode);
            const bezData = this.getBezData(targetNode);

            // [FIX] Ensure bz is a valid object and has a type
            let bz = bezData[currentIndex];
            if (!bz || typeof bz !== 'object') bz = { type: 0 };
            if (bz.type === undefined) bz.type = 0;

            const isClosed = targetNode.getAttribute('data-poly-closed') === 'true';
            const isEnd = !isClosed && (currentIndex === 0 || currentIndex === points.length - 1);

            if (bz.type === 0) {
                bz.type = 1;
                const pt = points[currentIndex];
                if (isEnd) {
                    bz.type = 2; // Endpoints are always cusp
                    if (currentIndex === 0) {
                        const next = points[1] || pt;
                        const dx = pt[0] - next[0]; const dy = pt[1] - next[1];
                        const len = Math.hypot(dx, dy) || 1;
                        bz.cpOut = [pt[0] + (dx / len) * 30, pt[1] + (dy / len) * 30];
                    } else {
                        const prev = points[currentIndex - 1] || pt;
                        const dx = pt[0] - prev[0]; const dy = pt[1] - prev[1];
                        const len = Math.hypot(dx, dy) || 1;
                        bz.cpIn = [pt[0] + (dx / len) * 30, pt[1] + (dy / len) * 30];
                    }
                } else {
                    let prev, next;
                    if (isClosed) {
                        // Find a non-overlapping prev point
                        let pIdx = currentIndex - 1;
                        if (pIdx < 0) pIdx = points.length - 1;
                        prev = points[pIdx];
                        if (Math.abs(prev[0] - pt[0]) < 0.001 && Math.abs(prev[1] - pt[1]) < 0.001) {
                            pIdx = pIdx - 1;
                            if (pIdx < 0) pIdx = points.length - 1;
                            prev = points[pIdx];
                        }
                        
                        // Find a non-overlapping next point
                        let nIdx = currentIndex + 1;
                        if (nIdx >= points.length) nIdx = 0;
                        next = points[nIdx];
                        if (Math.abs(next[0] - pt[0]) < 0.001 && Math.abs(next[1] - pt[1]) < 0.001) {
                            nIdx = nIdx + 1;
                            if (nIdx >= points.length) nIdx = 0;
                            next = points[nIdx];
                        }
                    } else {
                        prev = points[currentIndex - 1];
                        next = points[currentIndex + 1];
                    }

                    if (prev && next) {
                        const dx = next[0] - prev[0];
                        const dy = next[1] - prev[1];
                        const len = Math.hypot(dx, dy) || 1;
                        const udx = dx / len; const udy = dy / len;
                        bz.cpIn = [pt[0] - udx * 30, pt[1] - udy * 30];
                        bz.cpOut = [pt[0] + udx * 30, pt[1] + udy * 30];
                    } else {
                        // Fallback for missing neighbors
                        bz.cpIn = [pt[0] - 30, pt[1]];
                        bz.cpOut = [pt[0] + 30, pt[1]];
                    }
                }
            } else if (bz.type === 1 && !isEnd) {
                bz.type = 2; // Change smooth to cusp
            } else {
                bz = { type: 0 }; // Change to straight
            }

            bezData[currentIndex] = bz;

            // Sync overlapping endpoint if closed
            if (isClosed && (currentIndex === 0 || currentIndex === points.length - 1)) {
                const otherIdx = (currentIndex === 0) ? points.length - 1 : 0;
                const pt = points[currentIndex];
                const otherPt = points[otherIdx];
                if (Math.abs(pt[0] - otherPt[0]) < 0.001 && Math.abs(pt[1] - otherPt[1]) < 0.001) {
                    bezData[otherIdx] = JSON.parse(JSON.stringify(bz));
                }
            }

            this.setBezData(targetNode, bezData);

            if (converted) {
                if (window.selectElement) {
                    window.selectElement(SVG(targetNode));
                }
            } else {
                this.update(this.overlayGroup, targetNode, null);
                if (this.onUpdate) this.onUpdate();
            }
        });
    }

    bindBezControlDrag(handle, index, cpName) {
        let isDragging = false;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const bezData = this.getBezData(this.activeNode);
            const bz = bezData[index];
            const points = this.getPoints(this.activeNode);
            const vPt = points[index];

            if (!bz || !vPt) return;

            let localPt = this.getLocalPoint(e, { pivot: vPt });

            bz[cpName] = [localPt.x, localPt.y];

            if (bz.type === 1) { // Smooth
                const otherName = cpName === 'cpIn' ? 'cpOut' : 'cpIn';
                if (bz[otherName]) {
                    const dx = localPt.x - vPt[0];
                    const dy = localPt.y - vPt[1];
                    const odx = bz[otherName][0] - vPt[0];
                    const ody = bz[otherName][1] - vPt[1];
                    const oldDist = Math.hypot(odx, ody);
                    const newDist = Math.hypot(dx, dy) || 1;

                    // [NEW] Ctrlキーが押されている場合は長さを同期（対象の新しい長さを対向ハンドルにも適用）
                    const targetDist = (e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed)) ? newDist : oldDist;

                    bz[otherName] = [
                        vPt[0] - (dx / newDist) * targetDist,
                        vPt[1] - (dy / newDist) * targetDist
                    ];
                }
            }

            this.setBezData(this.activeNode, bezData);
            this.update(this.overlayGroup, this.activeNode, null);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[POLYLINE GUARD] Bezier control drag blocked for ${this.activeNode.id()}`);
                return;
            }
            e.stopPropagation(); e.preventDefault();
            isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }


    hide() {
        if (this.handleGroup) {
            // [REMOVED] Event cleanup no longer needed for zoom
            this.handleGroup.remove();
            this.handleGroup = null;
        }
        this.activeNode = null;
    }
}

window.SvgPolylineHandler = SvgPolylineHandler;
