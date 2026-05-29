/**
 * SvgPolylineHandler - Handles vertex and arrow size manipulation for Polyline Arrow tool.
 * [最適化版] requestAnimationFrame と各種キャッシュ（DOM, CTM, データ）を導入
 */
class SvgPolylineHandler {
    constructor(container, onUpdate, options = {}) {
        this.container = container;
        this.onUpdate = onUpdate;
        this.options = options;
        this.handleGroup = null;
        this.activeNode = null;
        this.overlayGroup = null;

        // [NEW] パフォーマンス改善用のキャッシュ変数
        this._isDragging = false;
        this._handleCache = null;
        this._dragPoints = null;
        this._dragBezData = null;
        this._dragCTM = null;
        this._dragCTMCache = null;
        this._dragRootCTMInv = null;
    }

    // [NEW] CTMをキャッシュして強制レイアウト再計算（スラッシング）を防ぐ
    _createCTMCache(node, overlay) {
        const cache = {
            nodeCTM: null,
            overlayCTMInv: null
        };
        try { cache.nodeCTM = node.getCTM(); } catch(e) {}
        try { 
            const overlayCTM = overlay ? overlay.getCTM() : null; 
            if (overlayCTM) cache.overlayCTMInv = overlayCTM.inverse();
        } catch(e) {}
        return cache;
    }

    // [NEW] ドラッグ完了時にのみ、重いDOMメタ属性(文字列変換)の書き込みを行う
    _commitDataAttributes() {
        if (!this.activeNode) return;
        const tagName = this.activeNode.tagName.toLowerCase();
        if (tagName === 'path') {
            if (this._dragPoints) {
                const pointsStr = this._dragPoints.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                this.activeNode.setAttribute('data-poly-points', pointsStr);
            }
            if (this._dragBezData) {
                this.activeNode.setAttribute('data-bez-points', JSON.stringify(this._dragBezData));
            }
            this.generatePath(this.activeNode);
        } else if (tagName !== 'line') {
            if (this._dragPoints) {
                const pointsStr = this._dragPoints.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                this.activeNode.setAttribute('points', pointsStr);
                this.activeNode.setAttribute('data-poly-points', pointsStr);
            }
        }
    }

    update(overlayGroup, node, bbox, passedCtmCache = null) {
        console.log('[SvgPolylineHandler DEBUG] update called', {
            hasOverlayGroup: !!overlayGroup,
            nodeId: node ? node.id : null,
            nodeTagName: node ? node.tagName : null,
            bbox: bbox
        });
        const tagName = node ? node.tagName.toLowerCase() : '';
        if (tagName !== 'polyline' && tagName !== 'line' && tagName !== 'path') {
            console.log('[SvgPolylineHandler DEBUG] invalid tag, hiding');
            this.hide();
            return;
        }

        this.activeNode = node;
        if (overlayGroup && overlayGroup !== this.overlayGroup) this.overlayGroup = overlayGroup;
        if (!this.overlayGroup) {
            console.log('[SvgPolylineHandler DEBUG] no overlayGroup');
            return;
        }

        if (!this.handleGroup) {
            this.handleGroup = SVG(this.overlayGroup).group().addClass('polyline-handle-group').node;
            console.log('[SvgPolylineHandler DEBUG] created handleGroup', this.handleGroup);
        }

        const points = this.getPoints(node);
        const shouldDrawHandles = points.length <= 50;
        console.log('[SvgPolylineHandler DEBUG] points length:', points.length, 'shouldDrawHandles:', shouldDrawHandles);

        // [NEW] 頂点数が多すぎる場合はDOM負荷を避けるためハンドル描画をスキップ
        if (!shouldDrawHandles) {
            while (this.handleGroup.firstChild) {
                this.handleGroup.removeChild(this.handleGroup.firstChild);
            }
            this._handleCache = null;
            return;
        }

        const bezData = (tagName === 'path') ? this.getBezData(node) : [];
        const bezSignature = (tagName === 'path') ? bezData.map(b => b ? b.type : 0).join(',') : '';
        const isClosed = node.getAttribute('data-poly-closed') === 'true';
        const hasArrow = node.getAttribute('data-arrow-start') === 'true' || node.getAttribute('data-arrow-end') === 'true';

        // [NEW] ハンドルの構成要素に変化がないかチェック
        const needRebuild = !this._handleCache || 
                            this._handleCache.pointsLength !== points.length || 
                            this._handleCache.isClosed !== isClosed ||
                            this._handleCache.bezSignature !== bezSignature ||
                            this._handleCache.hasArrow !== hasArrow ||
                            this.handleGroup.children.length === 0;

        // [NEW] 構成変化がない場合はDOMを破棄せず、既存ハンドルの座標更新のみを超高速に行う
        if (!needRebuild) {
            this.updateDragPositions(points, bezData, node, passedCtmCache);
            return;
        }

        // --- 以下、再構築が必要な場合のみ実行される ---
        while (this.handleGroup.firstChild) {
            this.handleGroup.removeChild(this.handleGroup.firstChild);
        }

        // 構築前にCTMを1度だけ計算する（O(1)に削減）
        const ctmCache = this._createCTMCache(node, this.overlayGroup);

        if (tagName !== 'line') {
            const loopEnd = isClosed ? points.length : points.length - 1;
            for (let i = 0; i < loopEnd; i++) {
                const pt1 = points[i];
                const pt2 = points[(i + 1) % points.length];

                if (pt2[2] && !isClosed) continue;
                if (isClosed && i === points.length - 1 && pt2[2]) {
                } else if (pt2[2]) {
                    continue;
                }

                let midPt;
                if (tagName === 'path' && bezData.length > 0) {
                    const bz1 = bezData[i] || { type: 0 };
                    const bz2 = bezData[(i + 1) % points.length] || { type: 0 };
                    const cp1 = bz1.cpOut || pt1;
                    const cp2 = bz2.cpIn || pt2;
                    midPt = [
                        0.125 * pt1[0] + 0.375 * cp1[0] + 0.375 * cp2[0] + 0.125 * pt2[0],
                        0.125 * pt1[1] + 0.375 * cp1[1] + 0.375 * cp2[1] + 0.125 * pt2[1]
                    ];
                } else {
                    midPt = [(pt1[0] + pt2[0]) / 2, (pt1[1] + pt2[1]) / 2];
                }

                const handlePoint = this.getHandlePoint(midPt, node, this.overlayGroup, ctmCache);
                const midCircleWrap = SVG(this.handleGroup).circle(6)
                    .fill(this.options.customColor || '#ffec3d').attr('fill-opacity', '0.5')
                    .stroke({color: '#333', width: 1})
                    .attr('cursor', 'grab')
                    .addClass('midpoint-handle')
                    // [PERF] .center() は重いため、属性へ直接 cx/cy を書き込む
                    .attr({
                        'data-type': 'midpoint',
                        'data-vertex-index': i,
                        'pointer-events': 'all',
                        'cx': handlePoint.x,
                        'cy': handlePoint.y
                    });
                const midCircle = midCircleWrap.node;

                if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                    window.SVGUtils.updateHandleScaling(midCircle);
                }
                this.bindMidpointDrag(midCircle);
            }
        }

        points.forEach((pt, index) => {
            const handlePoint = this.getHandlePoint(pt, node, this.overlayGroup, ctmCache);
            const circleWrap = SVG(this.handleGroup).circle(10)
                .fill(this.options.customColor || '#ffec3d')
                .stroke({color: '#333', width: 1})
                .attr('cursor', 'move')
                .addClass('polyline-handle');
                
            if (this.options.handleClass) {
                circleWrap.addClass(this.options.handleClass);
            }

            circleWrap.attr({
                'data-type': 'vertex',
                'data-index': index,
                'pointer-events': 'all',
                'cx': handlePoint.x,
                'cy': handlePoint.y
            });
            const circle = circleWrap.node;

            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(circle);
            }

            // 【再調査デバッグログ】各マウスイベントのログ
            circle.addEventListener('mouseenter', (e) => { console.log('[SvgPolylineHandler DEBUG] handle mouseenter. index:', index, 'node:', circle); });
            circle.addEventListener('mouseleave', (e) => { console.log('[SvgPolylineHandler DEBUG] handle mouseleave. index:', index, 'node:', circle); });
            circle.addEventListener('mouseover', (e) => { console.log('[SvgPolylineHandler DEBUG] handle mouseover. index:', index, 'node:', circle); });
            circle.addEventListener('mouseout', (e) => { console.log('[SvgPolylineHandler DEBUG] handle mouseout. index:', index, 'node:', circle); });

            this.bindVertexDrag(circle, index);
            this.bindVertexDblClick(circle, index);
            
            if (this.options.onVertexClick) {
                circle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.options.onVertexClick(e, index);
                });
            }
        });

        if (tagName === 'path') {
            points.forEach((pt, index) => {
                const bz = bezData[index];
                if (!bz || bz.type === 0) return;

                const drawHandle = (cp, cpName) => {
                    if (!cp) return;
                    const hVertex = this.getHandlePoint(pt, node, this.overlayGroup, ctmCache);
                    const hCP = this.getHandlePoint(cp, node, this.overlayGroup, ctmCache);

                    const isCusp = bz && bz.type === 2;
                    const handleColor = isCusp ? '#000080' : '#0366d6';

                    const lineWrap = SVG(this.handleGroup).line(hVertex.x, hVertex.y, hCP.x, hCP.y)
                        .stroke({color: handleColor, width: 1.5})
                        .attr('stroke-dasharray', '3,3')
                        .attr({
                            'data-type': 'bez-control-line',
                            'data-index': index,
                            'data-cp-name': cpName
                        });
                    const line = lineWrap.node;

                    if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                        window.SVGUtils.updateHandleScaling(line);
                    }

                    const cpCircleWrap = SVG(this.handleGroup).circle(8)
                        .fill('#fff')
                        .stroke({color: handleColor, width: 2})
                        .attr('cursor', 'pointer')
                        .addClass('bez-control-point')
                        .attr({
                            'data-type': 'bez-control-point',
                            'data-index': index,
                            'data-cp-name': cpName,
                            'pointer-events': 'all',
                            'cx': hCP.x,
                            'cy': hCP.y
                        });
                    const cpCircle = cpCircleWrap.node;

                    if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                        window.SVGUtils.updateHandleScaling(cpCircle);
                    }
                    this.bindBezControlDrag(cpCircle, index, cpName);
                };
                drawHandle(bz.cpIn, 'cpIn');
                drawHandle(bz.cpOut, 'cpOut');
            });
        }

        if (hasArrow) {
            const arrowSize = parseFloat(node.getAttribute('data-arrow-size')) || 10;
            const lastPt = points[points.length - 1];
            const prevPt = points[points.length - 2] || points[0];
            const dx = lastPt[0] - prevPt[0];
            const dy = lastPt[1] - prevPt[1];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;

            const sizePt = {
                x: lastPt[0] - (dx / len) * arrowSize,
                y: lastPt[1] - (dy / len) * arrowSize
            };
            const handleSizePt = this.getHandlePoint([sizePt.x, sizePt.y], node, this.overlayGroup, ctmCache);

            const sizeHandleWrap = SVG(this.handleGroup).circle(8)
                .fill('#0366d6')
                .stroke({color: '#fff', width: 1})
                .attr('cursor', 'se-resize')
                .addClass('polyline-handle arrow-size-handle')
                .attr({
                    'data-type': 'arrow-size',
                    'pointer-events': 'all',
                    'cx': handleSizePt.x,
                    'cy': handleSizePt.y
                });
            const sizeHandle = sizeHandleWrap.node;
            this.bindSizeDrag(sizeHandle);

            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(sizeHandle);
            }
        }

        if (tagName === 'path' || tagName === 'polyline' || tagName === 'line') {
            if (!isClosed && node.getAttribute('fill') !== 'none') {
                node.setAttribute('fill', 'none');
            }
        }

        if (this.handleGroup && this.overlayGroup && this.handleGroup.parentNode !== this.overlayGroup) {
            this.overlayGroup.appendChild(this.handleGroup);
        }

        // [NEW] 再検索を防ぐためのDOM要素配列キャッシュを作成
        this._handleCache = {
            pointsLength: points.length,
            isClosed: isClosed,
            bezSignature: bezSignature,
            hasArrow: hasArrow,
            vertex: Array.from(this.handleGroup.querySelectorAll('.polyline-handle[data-type="vertex"]')),
            midpoint: Array.from(this.handleGroup.querySelectorAll('.midpoint-handle[data-type="midpoint"]')),
            cpCircles: Array.from(this.handleGroup.querySelectorAll('.bez-control-point[data-type="bez-control-point"]')),
            cpLines: Array.from(this.handleGroup.querySelectorAll('[data-type="bez-control-line"]')),
            arrowSize: this.handleGroup.querySelector('.polyline-handle[data-type="arrow-size"]')
        };
    }

    getPoints(node) {
        if (!node) return [];
        
        // [PERF] ドラッグ中はパースを省略しオンメモリキャッシュを返す
        if (this._isDragging && this._dragPoints) return this._dragPoints;

        const tagName = node.tagName.toLowerCase();
        if (tagName === 'line') {
            const x1 = parseFloat(node.getAttribute('x1')) || 0;
            const y1 = parseFloat(node.getAttribute('y1')) || 0;
            const x2 = parseFloat(node.getAttribute('x2')) || 0;
            const y2 = parseFloat(node.getAttribute('y2')) || 0;
            return [[x1, y1], [x2, y2]];
        }

        let pointsStr = node.getAttribute('data-poly-points') || node.getAttribute('points');
        if (!pointsStr && tagName === 'path') {
            const pathData = node.getAttribute('d') || "";
            const pts = [];
            try {
                const el = node.instance || (typeof SVG === 'function' ? SVG(node) : null);
                if (el && typeof el.array === 'function') {
                    const arr = el.array();
                    arr.forEach(seg => {
                        const cmd = seg[0];
                        const coords = seg.slice(1);
                        if (coords.length >= 2) {
                            pts.push([coords[coords.length - 2], coords[coords.length - 1], cmd === 'M']);
                        }
                    });
                }
            } catch (e) {}
            if (pts.length > 0) return pts;
        }
        if (!pointsStr) return [];

        const parts = pointsStr.split(/\s+/).filter(s => s !== "");
        const pts = [];
        parts.forEach(p => {
            const isM = p.startsWith('M');
            const coord = (isM ? p.substring(1) : p).split(',');
            const x = parseFloat(coord[0]);
            const y = parseFloat(coord[1]);
            if (!isNaN(x) && !isNaN(y)) pts.push([x, y, isM]);
        });
        return pts;
    }

    getBezData(node) {
        // [PERF]
        if (this._isDragging && this._dragBezData) return this._dragBezData;

        try {
            const bezStr = node.getAttribute('data-bez-points');
            if (bezStr) {
                const data = JSON.parse(bezStr);
                if (Array.isArray(data)) return data.map(bz => (bz && typeof bz === 'object') ? bz : { type: 0 });
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
        const points = (this._isDragging && this._dragPoints) ? this._dragPoints : this.getPoints(node);
        if (points.length === 0) return;

        const bezData = (this._isDragging && this._dragBezData) ? this._dragBezData : this.getBezData(node);
        const isClosed = node.getAttribute('data-poly-closed') === 'true';
        
        // [PERF] +=の文字列連結ではなく、配列のjoinを使用して大規模データでの処理を高速化
        const d = [];

        points.forEach((curr, i) => {
            if (i === 0 || curr[2]) {
                d.push(`M ${curr[0]} ${curr[1]}`);
            } else {
                const prev = points[i - 1];
                const prevBez = bezData[i - 1] || { type: 0 };
                const currBez = bezData[i] || { type: 0 };
                let cp1 = prevBez.cpOut || prev;
                let cp2 = currBez.cpIn || curr;

                if (cp1[0] === prev[0] && cp1[1] === prev[1] && cp2[0] === curr[0] && cp2[1] === curr[1]) {
                    d.push(`L ${curr[0]} ${curr[1]}`);
                } else {
                    d.push(`C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curr[0]} ${curr[1]}`);
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
                d.push(`C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curr[0]} ${curr[1]}`);
            }
            d.push("Z");
        } else if (isClosed) {
            d.push("Z");
        }
        node.setAttribute('d', d.join(' '));
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

        path.insertBefore(svgjsEl);
        svgjsEl.remove();

        if (typeof window.makeInteractive === 'function') window.makeInteractive(path);
        return path.node;
    }

    // [NEW] キャッシュがあれば計算をスキップして高速化
    getHandlePoint(pt, node, overlay, ctmCache = null) {
        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay && !ctmCache) {
            return window.SVGUtils.mapLocalToOverlay(pt, node, overlay);
        }
        try {
            const svg = node.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: pt[0], y: pt[1] };
            const p = svg.createSVGPoint();
            p.x = pt[0]; p.y = pt[1];

            const nodeMatrix = ctmCache ? ctmCache.nodeCTM : node.getCTM();
            let overlayMatrixInv = ctmCache ? ctmCache.overlayCTMInv : null;

            if (!ctmCache && overlay) {
                const overlayMatrix = overlay.getCTM();
                if (overlayMatrix) {
                    try { overlayMatrixInv = overlayMatrix.inverse(); } catch (err) {}
                }
            }

            if (nodeMatrix) {
                const worldP = p.matrixTransform(nodeMatrix);
                if (overlayMatrixInv) {
                    try { return worldP.matrixTransform(overlayMatrixInv); } catch (err) { return worldP; }
                }
                return worldP;
            }
            return p;
        } catch (e) {
            return { x: pt[0], y: pt[1] };
        }
    }

    getLocalPoint(e, options = {}) {
        let localPt;
        if (window.SVGUtils && window.SVGUtils.getLocalPoint) {
            localPt = window.SVGUtils.getLocalPoint(e, this.activeNode);
        } else {
            const svg = this.activeNode.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: e.clientX, y: e.clientY };
            const p = svg.createSVGPoint();
            p.x = e.clientX; p.y = e.clientY;
            const ctm = this.activeNode.getScreenCTM();
            localPt = (ctm) ? p.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY };
        }

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

    /**
     * Shiftキー押下時の水平・垂直固定スナップ、および交点（スマート直角）スナップを適用する
     */
    applyShiftSnap(localPt, activeIndex, points, e) {
        if (!this.activeNode) return;
        const tagName = this.activeNode.tagName.toLowerCase();
        
        // 1. まず交点（スマートガイド）スナップの判定
        let snappedToIntersection = false;
        const isClosed = this.activeNode.getAttribute('data-poly-closed') === 'true';
        
        if (tagName !== 'line') {
            let prevIdx = activeIndex - 1;
            let nextIdx = activeIndex + 1;
            
            if (isClosed) {
                prevIdx = (activeIndex - 1 + points.length) % points.length;
                nextIdx = (activeIndex + 1) % points.length;
            }
            
            const hasPrev = isClosed ? true : (prevIdx >= 0);
            const hasNext = isClosed ? true : (nextIdx < points.length);
            
            let prevPt = (hasPrev && points[prevIdx]) ? points[prevIdx] : null;
            let nextPt = (hasNext && points[nextIdx]) ? points[nextIdx] : null;
            
            if (tagName === 'path') {
                if (nextPt && nextPt[2]) nextPt = null;
                if (points[activeIndex] && points[activeIndex][2]) prevPt = null;
            }

            if (prevPt && nextPt) {
                // 両端が存在する場合の2つの交点候補 (prev.x, next.y) または (next.x, prev.y)
                const intersects = [
                    { x: prevPt[0], y: nextPt[1] },
                    { x: nextPt[0], y: prevPt[1] }
                ];
                
                const m = this._dragCTM;
                let bestIntersect = null;
                let minIntersectDist = Infinity;
                const intersectThreshold = 15; // 画面上のピクセル数
                
                intersects.forEach(pt => {
                    let dist;
                    if (m) {
                        dist = Math.hypot((localPt.x - pt.x) * m.a, (localPt.y - pt.y) * m.d);
                    } else {
                        dist = Math.hypot(localPt.x - pt.x, localPt.y - pt.y);
                    }
                    
                    if (dist < intersectThreshold && dist < minIntersectDist) {
                        minIntersectDist = dist;
                        bestIntersect = pt;
                    }
                });
                
                if (bestIntersect) {
                    localPt.x = bestIntersect.x;
                    localPt.y = bestIntersect.y;
                    snappedToIntersection = true;
                }
            }
        }

        // 2. 交点スナップしなかった場合は、通常の垂直・水平軸スナップを適用
        if (!snappedToIntersection) {
            const candidates = [];
            if (tagName === 'line') {
                const otherIdx = (activeIndex === 0) ? 1 : 0;
                if (points[otherIdx]) candidates.push(points[otherIdx]);
            } else {
                let prevIdx = activeIndex - 1;
                let nextIdx = activeIndex + 1;
                
                if (isClosed) {
                    prevIdx = (activeIndex - 1 + points.length) % points.length;
                    nextIdx = (activeIndex + 1) % points.length;
                } else {
                    if (tagName === 'path' && points[activeIndex] && points[activeIndex][2]) {
                        prevIdx = -1; // Mコマンド（始点）の場合は前とは繋がっていない
                    }
                }
                
                const hasPrev = isClosed ? true : (prevIdx >= 0);
                const hasNext = isClosed ? true : (nextIdx < points.length);
                
                let prevPt = (hasPrev && points[prevIdx]) ? points[prevIdx] : null;
                let nextPt = (hasNext && points[nextIdx]) ? points[nextIdx] : null;
                
                if (tagName === 'path') {
                    if (nextPt && nextPt[2]) nextPt = null;
                }
                
                if (prevPt) candidates.push(prevPt);
                if (nextPt) candidates.push(nextPt);
            }
            
            if (candidates.length > 0) {
                let minVDist = Infinity, minHDist = Infinity;
                let bestVPivot = null, bestHPivot = null;

                candidates.forEach(c => {
                    const dv = Math.abs(localPt.x - c[0]);
                    const dh = Math.abs(localPt.y - c[1]);
                    if (dv < minVDist) { minVDist = dv; bestVPivot = c; }
                    if (dh < minHDist) { minHDist = dh; bestHPivot = c; }
                });

                const isAlt = e.altKey || (window.currentEditingSVG && window.currentEditingSVG.isAltPressed);
                const gridConfig = (typeof AppState !== 'undefined' && AppState.config && AppState.config.grid) || { size: 15 };
                const snapSize = gridConfig.size || 15;

                if (minVDist < minHDist) {
                    if (bestVPivot) {
                        localPt.x = bestVPivot[0];
                        if (isAlt && snapSize > 0) localPt.y = Math.round(localPt.y / snapSize) * snapSize;
                    }
                } else {
                    if (bestHPivot) {
                        localPt.y = bestHPivot[1];
                        if (isAlt && snapSize > 0) localPt.x = Math.round(localPt.x / snapSize) * snapSize;
                    }
                }
            }
        }
    }

    bindVertexDrag(handle, index) {
        let isDragging = false;
        let rAF = null;
        let lastEvent = null;
        let lastClickTime = 0;

        const performUpdate = () => {
            rAF = null;
            if (!this.activeNode || !lastEvent) return;
            const e = lastEvent;
            this._isDragging = true;
            
            const draw = SVG(this.activeNode.ownerSVGElement);

            // 実線更新の前に、このフレームの最新CTMを取得 (レイアウトスラッシングの回避)
            const currentCtmCache = this._createCTMCache(this.activeNode, this.overlayGroup);

            const isAlt = SVGUtils.isSnapEnabled(e);
            if (!isAlt && window.SVGConnectorManager && this._connectorCache && !this.options.disableConnectors) {
                const zoom = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
                const worldPt = this._dragRootCTMInv ? new SVG.Point(e.clientX, e.clientY).transform(this._dragRootCTMInv) : draw.point(e.clientX, e.clientY);
                window.SVGConnectorManager.updateConnectorDisplay(draw, this._connectorCache, worldPt, zoom);
            } else if (window.SVGConnectorManager && !this.options.disableConnectors) {
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            let localPt = this.getLocalPoint(e);
            const vIdx = parseInt(handle.getAttribute('data-index'), 10);
            const points = this._dragPoints;
            const endType = (vIdx === 0) ? 'start' : (vIdx === points.length - 1 ? 'end' : null);

            if (!isAlt && endType && window.SVGConnectorManager && !this.options.disableConnectors) {
                // [NEW] getScreenCTM() の呼び出しを回避
                const worldPt = this._dragRootCTMInv ? new SVG.Point(e.clientX, e.clientY).transform(this._dragRootCTMInv) : draw.point(e.clientX, e.clientY);
                const nearest = window.SVGConnectorManager.findNearestConnector(draw, worldPt, 20, SVG(this.activeNode));

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
                        } catch (err) { }
                    }
                }

                if (nearest && !skipSnap) {
                    const mNode = this._dragRootCTMInv ? this._dragRootCTMInv.multiply(this._dragCTM) : draw.node.getScreenCTM().inverse().multiply(this._dragCTM);
                    const mInv = mNode.inverse();
                    const snappedLocal = new SVG.Point(nearest.x, nearest.y).transform(mInv);

                    const success = window.SVGConnectorManager.connect(SVG(this.activeNode), endType, nearest.id, nearest.index);
                    if (success) {
                        localPt = { x: snappedLocal.x, y: snappedLocal.y };
                    } else {
                        window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
                    }
                } else {
                    window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
                }
            } else if (endType && window.SVGConnectorManager && !this.options.disableConnectors) {
                window.SVGConnectorManager.disconnect(SVG(this.activeNode), endType);
            }

            const activeIndex = index;
            if (isNaN(activeIndex)) return;

            const isShift = e.shiftKey || (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed);
            if (isShift && this.activeNode) {
                this.applyShiftSnap(localPt, activeIndex, points, e);
            }

            this._isSnappedToClose = false;
            const isEndpoint = (activeIndex === 0 || activeIndex === points.length - 1);

            if (isEndpoint && points.length > 2) {
                const otherIdx = (activeIndex === 0) ? points.length - 1 : 0;
                const otherPt = points[otherIdx];
                const dx = localPt.x - otherPt[0];
                const dy = localPt.y - otherPt[1];

                const m = this._dragCTM;
                if (m) {
                    const screenDist = Math.hypot(dx * m.a, dy * m.d);
                    const threshold = 15;
                    if (screenDist < threshold) {
                        localPt.x = otherPt[0];
                        localPt.y = otherPt[1];
                        this._isSnappedToClose = true;
                    }
                }
            }

            if (isNaN(localPt.x) || isNaN(localPt.y)) return;

            const oldPt = points[activeIndex];
            points[activeIndex] = [localPt.x, localPt.y];

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
                const bezData = this._dragBezData;
                const bz = bezData[activeIndex];
                if (bz && bz.type > 0) {
                    const dx = localPt.x - oldPt[0];
                    const dy = localPt.y - oldPt[1];
                    if (bz.cpIn) bz.cpIn = [bz.cpIn[0] + dx, bz.cpIn[1] + dy];
                    if (bz.cpOut) bz.cpOut = [bz.cpOut[0] + dx, bz.cpOut[1] + dy];
                }
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
                // [PERF] ドラッグ中は重いデータ属性への書き込みを省略
                this.generatePath(this.activeNode);
            } else {
                const pointsStr = points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                this.activeNode.setAttribute('points', pointsStr);
            }

            this.update(this.overlayGroup, this.activeNode, null, currentCtmCache);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            lastEvent = e;
            if (!rAF) {
                rAF = requestAnimationFrame(performUpdate);
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            if (window.currentEditingSVG && typeof window.currentEditingSVG.resumeObserver === 'function') {
                window.currentEditingSVG.resumeObserver();
            }
            if (rAF) {
                cancelAnimationFrame(rAF);
                rAF = null;
            }

            if (window.currentEditingSVG) window.currentEditingSVG._isOperationInProgress = false;

            // [NEW] ドラッグ終了時にデータをDOMに確定させる
            this._commitDataAttributes();
            this._isDragging = false;
            this._connectorsShown = false;

            if (this._isSnappedToClose) {
                this.activeNode.setAttribute('data-poly-closed', 'true');
                this.activeNode.setAttribute('data-arrow-end', 'false');
                this.activeNode.setAttribute('data-arrow-start', 'false');

                const tagName = this.activeNode.tagName.toLowerCase();
                if (tagName !== 'path') {
                    const newNode = this.convertToPath(this.activeNode);
                    if (newNode && window.selectElement) {
                        window.selectElement(SVG(newNode));
                        this.generatePath(newNode);
                    }
                } else {
                    this.generatePath(this.activeNode);
                }

                if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                    window.SVGToolbar.updateArrowMarkers(SVG(this.activeNode));
                }
            }
            this._isSnappedToClose = false;

            if (window.SVGConnectorManager && this.activeNode && !this.options.disableConnectors) {
                const draw = SVG(this.activeNode.ownerSVGElement);
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            this._dragCTM = null;
            this._dragCTMCache = null;
            this._dragRootCTMInv = null;
            this._dragPoints = null;
            this._dragBezData = null;
            this._connectorCache = null;

            if (window.syncChanges) window.syncChanges(true, null, true);
        };

        handle.addEventListener('mousedown', (e) => {
            if (window.currentEditingSVG && typeof window.currentEditingSVG.suspendObserver === 'function') {
                window.currentEditingSVG.suspendObserver();
            }
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) return;

            // 自前ダブルクリック検出（手ぶれ許容）
            const now = Date.now();
            if (now - lastClickTime < 350) {
                lastClickTime = 0; // リセット
                e.stopPropagation(); e.preventDefault();
                this.triggerVertexDblClick(handle, index);
                return;
            }
            lastClickTime = now;

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = true;
                if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
            }

            // [NEW] ドラッグ開始時に計算用データを一括キャッシュ
            this._dragPoints = this.getPoints(this.activeNode);
            this._dragBezData = this.activeNode.tagName.toLowerCase() === 'path' ? this.getBezData(this.activeNode) : [];
            this._dragCTM = this.activeNode.getScreenCTM();
            this._dragCTMCache = this._createCTMCache(this.activeNode, this.overlayGroup);
            const draw = SVG(this.activeNode.ownerSVGElement);
            if (draw && draw.node) {
                this._dragRootCTMInv = draw.node.getScreenCTM().inverse();
            }
            if (window.SVGConnectorManager && draw && !this.options.disableConnectors) {
                this._connectorCache = window.SVGConnectorManager.cacheConnectorPoints(draw, SVG(this.activeNode));
            }

            const isCtrl = e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed);
            if (isCtrl) {
                e.stopPropagation(); e.preventDefault();
                const points = this._dragPoints;
                if (points.length <= 2) return;

                const vIdx = parseInt(handle.getAttribute('data-index'), 10);
                if (isNaN(vIdx)) return;

                points.splice(vIdx, 1);
                const isClosed = this.activeNode.getAttribute('data-poly-closed') === 'true';
                if (isClosed) points[points.length - 1] = [points[0][0], points[0][1]];

                const tagName = this.activeNode.tagName.toLowerCase();
                const pointsStr = points.map(p => p.join(',')).join(' ');

                if (tagName === 'path') {
                    const bezData = this._dragBezData;
                    bezData.splice(vIdx, 1);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                    this.activeNode.setAttribute('data-bez-points', JSON.stringify(bezData));
                    this.generatePath(this.activeNode);
                } else {
                    this.activeNode.setAttribute('points', pointsStr);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                }
                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true);
                return;
            }

            e.stopPropagation(); e.preventDefault();
            isDragging = true;
            this._isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindMidpointDrag(handle) {
        let isDragging = false;
        let hasConverted = false;
        let vertexIndex = -1;
        let rAF = null;
        let lastEvent = null;

        const performUpdate = () => {
            rAF = null;
            if (!this.activeNode || !lastEvent) return;
            const e = lastEvent;
            this._isDragging = true;

            // 実線更新の前に、このフレームの最新CTMを取得 (レイアウトスラッシングの回避)
            const currentCtmCache = this._createCTMCache(this.activeNode, this.overlayGroup);
            const draw = SVG(this.activeNode.ownerSVGElement);

            // ドラッグ中のリアルタイム近接接続表示
            const isAlt = SVGUtils.isSnapEnabled(e);
            if (!isAlt && window.SVGConnectorManager && this._connectorCache && draw && !this.options.disableConnectors) {
                const zoom = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
                const worldPt = this._dragRootCTMInv ? new SVG.Point(e.clientX, e.clientY).transform(this._dragRootCTMInv) : draw.point(e.clientX, e.clientY);
                window.SVGConnectorManager.updateConnectorDisplay(draw, this._connectorCache, worldPt, zoom);
            } else if (window.SVGConnectorManager && draw && !this.options.disableConnectors) {
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            if (!hasConverted) {
                hasConverted = true;
                const insertAfter = parseInt(handle.getAttribute('data-vertex-index'), 10);
                if (isNaN(insertAfter)) return;

                vertexIndex = insertAfter + 1;
                const points = this._dragPoints;
                let localPt = this.getLocalPoint(e);

                points.splice(vertexIndex, 0, [localPt.x, localPt.y]);

                if (this.activeNode.tagName.toLowerCase() === 'path') {
                    const bezData = this._dragBezData;
                    bezData.splice(vertexIndex, 0, { type: 0 });
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
            const points = this._dragPoints;
            if (vertexIndex >= points.length) return;

            const isShift = e.shiftKey || (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed);
            if (isShift && this.activeNode) {
                this.applyShiftSnap(localPt, vertexIndex, points, e);
            }

            points[vertexIndex] = [localPt.x, localPt.y];

            if (this.activeNode.tagName.toLowerCase() === 'path') {
                this.generatePath(this.activeNode);
            } else {
                const pointsStr = points.map(p => p.join(',')).join(' ');
                this.activeNode.setAttribute('points', pointsStr);
            }

            this.update(this.overlayGroup, this.activeNode, null, currentCtmCache);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            lastEvent = e;
            if (!rAF) {
                rAF = requestAnimationFrame(performUpdate);
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            if (window.currentEditingSVG && typeof window.currentEditingSVG.resumeObserver === 'function') {
                window.currentEditingSVG.resumeObserver();
            }
            if (rAF) {
                cancelAnimationFrame(rAF);
                rAF = null;
            }
            const didConvert = hasConverted;
            const vIndex = vertexIndex;
            hasConverted = false;
            vertexIndex = -1;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            if (window.currentEditingSVG) window.currentEditingSVG._isOperationInProgress = false;

            if (window.SVGConnectorManager && this.activeNode && !this.options.disableConnectors) {
                const draw = SVG(this.activeNode.ownerSVGElement);
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            this._commitDataAttributes();
            this._isDragging = false;
            this._dragCTM = null;
            this._dragCTMCache = null;
            this._dragRootCTMInv = null;
            this._dragPoints = null;
            this._dragBezData = null;
            this._connectorCache = null;

            if (didConvert || vIndex >= 0) {
                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true, null, true);
            }
        };

        handle.addEventListener('mousedown', (e) => {
            if (window.currentEditingSVG && typeof window.currentEditingSVG.suspendObserver === 'function') {
                window.currentEditingSVG.suspendObserver();
            }
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) return;

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = true;
                if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
            }

            this._dragPoints = this.getPoints(this.activeNode);
            this._dragBezData = this.activeNode.tagName.toLowerCase() === 'path' ? this.getBezData(this.activeNode) : [];
            this._dragCTM = this.activeNode.getScreenCTM();
            this._dragCTMCache = this._createCTMCache(this.activeNode, this.overlayGroup);

            const draw = SVG(this.activeNode.ownerSVGElement);
            if (draw && draw.node) {
                this._dragRootCTMInv = draw.node.getScreenCTM().inverse();
            }
            if (window.SVGConnectorManager && draw && !this.options.disableConnectors) {
                this._connectorCache = window.SVGConnectorManager.cacheConnectorPoints(draw, SVG(this.activeNode));
            }

            const isCtrl = e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed);
            if (isCtrl) {
                e.stopPropagation(); e.preventDefault();
                const insertAfter = parseInt(handle.getAttribute('data-vertex-index'), 10);
                if (isNaN(insertAfter)) return;

                const vIdx = insertAfter + 1;
                const points = this._dragPoints;
                const pt = this.getLocalPoint(e);

                points.splice(vIdx, 0, [pt.x, pt.y]);
                const pointsStr = points.map(p => p.join(',')).join(' ');

                if (this.activeNode.tagName.toLowerCase() === 'path') {
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                    const bezData = this._dragBezData;
                    bezData.splice(vIdx, 0, { type: 0 });
                    this.activeNode.setAttribute('data-bez-points', JSON.stringify(bezData));
                    this.generatePath(this.activeNode);
                } else {
                    this.activeNode.setAttribute('points', pointsStr);
                    this.activeNode.setAttribute('data-poly-points', pointsStr);
                }

                this.update(this.overlayGroup, this.activeNode, null);
                if (window.syncChanges) window.syncChanges(true);
                return;
            }

            e.stopPropagation(); e.preventDefault();
            isDragging = true;
            this._isDragging = true;
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
        let rAF = null;
        let lastEvent = null;

        const performUpdate = () => {
            rAF = null;
            if (!this.activeNode || !lastEvent) return;
            const e = lastEvent;
            this._isDragging = true;
            
            // 実線更新の前に、このフレームの最新CTMを取得 (レイアウトスラッシングの回避)
            const currentCtmCache = this._createCTMCache(this.activeNode, this.overlayGroup);
            
            const dy = e.clientY - startPt.y;
            const dx = e.clientX - startPt.x;
            const delta = Math.sqrt(dx * dx + dy * dy) * (dy > 0 ? 1 : -1);

            const newSize = Math.max(2, startSize + delta);
            this.activeNode.setAttribute('data-arrow-size', newSize);

            this.update(this.overlayGroup, this.activeNode, null, currentCtmCache);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            lastEvent = e;
            if (!rAF) {
                rAF = requestAnimationFrame(performUpdate);
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            this._isDragging = false;
            if (window.currentEditingSVG && typeof window.currentEditingSVG.resumeObserver === 'function') {
                window.currentEditingSVG.resumeObserver();
            }
            if (rAF) {
                cancelAnimationFrame(rAF);
                rAF = null;
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            if (window.currentEditingSVG) window.currentEditingSVG._isOperationInProgress = false;

            this._dragCTM = null;
            this._dragCTMCache = null;
            this._dragRootCTMInv = null;
            this._dragPoints = null;
            this._dragBezData = null;

            if (window.syncChanges) window.syncChanges(true, null, true);
        };

        handle.addEventListener('mousedown', (e) => {
            if (window.currentEditingSVG && typeof window.currentEditingSVG.suspendObserver === 'function') {
                window.currentEditingSVG.suspendObserver();
            }
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) return;

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = true;
                if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
            }

            this._dragCTMCache = this._createCTMCache(this.activeNode, this.overlayGroup);

            e.stopPropagation(); e.preventDefault();
            isDragging = true;
            this._isDragging = true;
            startSize = parseFloat(this.activeNode.getAttribute('data-arrow-size')) || 10;
            startPt = { x: e.clientX, y: e.clientY };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    triggerVertexDblClick(handle, index) {
        const currentIndex = parseInt(handle.getAttribute('data-index'), 10);
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

        let bz = bezData[currentIndex];
        if (!bz || typeof bz !== 'object') bz = { type: 0 };
        if (bz.type === undefined) bz.type = 0;

        const isClosed = targetNode.getAttribute('data-poly-closed') === 'true';
        const isEnd = !isClosed && (currentIndex === 0 || currentIndex === points.length - 1);

        if (bz.type === 0) {
            bz.type = 1;
            const pt = points[currentIndex];
            if (isEnd) {
                bz.type = 2; // 終端は常に cusp (角)
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
                    let pIdx = currentIndex - 1;
                    if (pIdx < 0) pIdx = points.length - 1;
                    prev = points[pIdx];
                    if (Math.abs(prev[0] - pt[0]) < 0.001 && Math.abs(prev[1] - pt[1]) < 0.001) {
                        pIdx = pIdx - 1;
                        if (pIdx < 0) pIdx = points.length - 1;
                        prev = points[pIdx];
                    }
                    
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
                    bz.cpIn = [pt[0] - 30, pt[1]];
                    bz.cpOut = [pt[0] + 30, pt[1]];
                }
            }
        } else if (bz.type === 1 && !isEnd) {
            bz.type = 2; // スムーズから cusp に変更
        } else {
            bz = { type: 0 }; // 直線に変更
        }

        bezData[currentIndex] = bz;

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
            if (window.selectElement) window.selectElement(SVG(targetNode));
        } else {
            this.update(this.overlayGroup, targetNode, null);
            if (this.onUpdate) this.onUpdate();
        }
    }

    bindVertexDblClick(handle, index) {
        SVG(handle).on('dblclick', (e) => {
            e.stopPropagation(); e.preventDefault();
            this.triggerVertexDblClick(handle, index);
        });
    }

    bindBezControlDrag(handle, index, cpName) {
        let isDragging = false;
        let rAF = null;
        let lastEvent = null;

        const performUpdate = () => {
            rAF = null;
            if (!this.activeNode || !lastEvent) return;
            const e = lastEvent;
            this._isDragging = true;

            // 実線更新の前に、このフレームの最新CTMを取得 (レイアウトスラッシングの回避)
            const currentCtmCache = this._createCTMCache(this.activeNode, this.overlayGroup);
            
            const bezData = this._dragBezData;
            const bz = bezData[index];
            const points = this._dragPoints;
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

                    const targetDist = (e.ctrlKey || (window.currentEditingSVG && window.currentEditingSVG.isCtrlPressed)) ? newDist : oldDist;

                    bz[otherName] = [
                        vPt[0] - (dx / newDist) * targetDist,
                        vPt[1] - (dy / newDist) * targetDist
                    ];
                }
            }

            // [PERF] ドラッグ中は重いデータ属性の書き込みを省略し、generatePath のみ呼ぶ
            this.generatePath(this.activeNode);
            
            this.update(this.overlayGroup, this.activeNode, null, currentCtmCache);
            if (this.onUpdate) this.onUpdate();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            lastEvent = e;
            if (!rAF) {
                rAF = requestAnimationFrame(performUpdate);
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            if (rAF) {
                cancelAnimationFrame(rAF);
                rAF = null;
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = false;
                if (typeof window.currentEditingSVG.resumeObserver === 'function') {
                    window.currentEditingSVG.resumeObserver();
                }
            }
            
            // [NEW] ドラッグ終了時にデータをコミット
            this._commitDataAttributes();
            this._isDragging = false;
            this._dragCTM = null;
            this._dragCTMCache = null;
            this._dragRootCTMInv = null;
            this._dragPoints = null;
            this._dragBezData = null;

            if (window.syncChanges) window.syncChanges(true, null, true);
        };

        handle.addEventListener('mousedown', (e) => {
            if (window.currentEditingSVG && typeof window.currentEditingSVG.suspendObserver === 'function') {
                window.currentEditingSVG.suspendObserver();
            }
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) return;

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = true;
                if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
            }
            
            this._dragPoints = this.getPoints(this.activeNode);
            this._dragBezData = this.getBezData(this.activeNode);
            this._dragCTM = this.activeNode.getScreenCTM();
            this._dragCTMCache = this._createCTMCache(this.activeNode, this.overlayGroup);

            e.stopPropagation(); e.preventDefault();
            isDragging = true;
            this._isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    updateDragPositions(points, bezData, node, passedCtmCache = null) {
        if (!this._handleCache) return;

        const tagName = node.tagName.toLowerCase();
        const ctmCache = passedCtmCache || (this._isDragging ? this._dragCTMCache : this._createCTMCache(node, this.overlayGroup));

        // 画面の表示領域（viewBox）を取得し、カリング判定関数を作成
        // 頂点数が50を超える場合のみ、パフォーマンス向上のためカリングを有効にする
        let isVisible = () => true;
        if (points && points.length > 50) {
            const svgEdit = window.currentEditingSVG;
            if (svgEdit && svgEdit.draw && svgEdit.draw.node.viewBox) {
                const vb = svgEdit.draw.node.viewBox.baseVal;
                const zoom = svgEdit.zoom ? svgEdit.zoom / 100 : 1;
                const margin = 50 / zoom; // 画面外に少し余裕を持たせる
                const minX = vb.x - margin;
                const maxX = vb.x + vb.width + margin;
                const minY = vb.y - margin;
                const maxY = vb.y + vb.height + margin;
                
                isVisible = (hp) => {
                    return hp.x >= minX && hp.x <= maxX && hp.y >= minY && hp.y <= maxY;
                };
            }
        }

        // 1. Vertex Handles
        const vertexHandles = this._handleCache.vertex;
        vertexHandles.forEach(h => {
            const idx = parseInt(h.getAttribute('data-index'), 10);
            if (!isNaN(idx) && points[idx]) {
                const hp = this.getHandlePoint(points[idx], node, this.overlayGroup, ctmCache);
                // ▼ 追加: 画面外なら非表示にしてDOM/描画負荷削減
                if (isVisible(hp)) {
                    h.style.display = '';
                    h.setAttribute('cx', hp.x);
                    h.setAttribute('cy', hp.y);
                } else {
                    h.style.display = 'none';
                }
            }
        });

        // 2. Midpoint Handles
        const midpointHandles = this._handleCache.midpoint;
        midpointHandles.forEach(h => {
            const idx = parseInt(h.getAttribute('data-vertex-index'), 10);
            if (!isNaN(idx) && points[idx]) {
                const pt1 = points[idx];
                const pt2 = points[(idx + 1) % points.length];
                if (pt2) {
                    let midPt;
                    if (tagName === 'path' && bezData.length > 0) {
                        const bz1 = bezData[idx] || { type: 0 };
                        const bz2 = bezData[(idx + 1) % points.length] || { type: 0 };
                        const cp1 = bz1.cpOut || pt1;
                        const cp2 = bz2.cpIn || pt2;
                        midPt = [
                            0.125 * pt1[0] + 0.375 * cp1[0] + 0.375 * cp2[0] + 0.125 * pt2[0],
                            0.125 * pt1[1] + 0.375 * cp1[1] + 0.375 * cp2[1] + 0.125 * pt2[1]
                        ];
                    } else {
                        midPt = [(pt1[0] + pt2[0]) / 2, (pt1[1] + pt2[1]) / 2];
                    }
                    const hp = this.getHandlePoint(midPt, node, this.overlayGroup, ctmCache);
                    // ▼ 追加: カリング
                    if (isVisible(hp)) {
                        h.style.display = '';
                        h.setAttribute('cx', hp.x);
                        h.setAttribute('cy', hp.y);
                    } else {
                        h.style.display = 'none';
                    }
                }
            }
        });

        // 3. Bezier Control Handles & Lines
        if (tagName === 'path') {
            const cpCircles = this._handleCache.cpCircles;
            cpCircles.forEach(h => {
                const idx = parseInt(h.getAttribute('data-index'), 10);
                const cpName = h.getAttribute('data-cp-name');
                if (!isNaN(idx) && bezData[idx] && bezData[idx][cpName]) {
                    const hp = this.getHandlePoint(bezData[idx][cpName], node, this.overlayGroup, ctmCache);
                    // ▼ 追加: カリング
                    if (isVisible(hp)) {
                        h.style.display = '';
                        h.setAttribute('cx', hp.x);
                        h.setAttribute('cy', hp.y);
                    } else {
                        h.style.display = 'none';
                    }
                }
            });

            const cpLines = this._handleCache.cpLines;
            cpLines.forEach(l => {
                const idx = parseInt(l.getAttribute('data-index'), 10);
                const cpName = l.getAttribute('data-cp-name');
                if (!isNaN(idx) && points[idx] && bezData[idx] && bezData[idx][cpName]) {
                    const hVertex = this.getHandlePoint(points[idx], node, this.overlayGroup, ctmCache);
                    const hCP = this.getHandlePoint(bezData[idx][cpName], node, this.overlayGroup, ctmCache);
                    // ▼ 追加: どちらかの端点が見えていれば表示するカリング
                    if (isVisible(hVertex) || isVisible(hCP)) {
                        l.style.display = '';
                        l.setAttribute('x1', hVertex.x);
                        l.setAttribute('y1', hVertex.y);
                        l.setAttribute('x2', hCP.x);
                        l.setAttribute('y2', hCP.y);
                    } else {
                        l.style.display = 'none';
                    }
                }
            });
        }

        // 4. Arrow Size Handle
        const sizeHandle = this._handleCache.arrowSize;
        if (sizeHandle && sizeHandle.style.display !== 'none') {
            const arrowSize = parseFloat(node.getAttribute('data-arrow-size')) || 10;
            const lastPt = points[points.length - 1];
            const prevPt = points[points.length - 2] || points[0];
            const dx = lastPt[0] - prevPt[0];
            const dy = lastPt[1] - prevPt[1];
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const sizePt = {
                x: lastPt[0] - (dx / len) * arrowSize,
                y: lastPt[1] - (dy / len) * arrowSize
            };
            const hp = this.getHandlePoint([sizePt.x, sizePt.y], node, this.overlayGroup, ctmCache);
            // ▼ 追加: カリング
            if (isVisible(hp)) {
                sizeHandle.style.display = '';
                sizeHandle.setAttribute('cx', hp.x);
                sizeHandle.setAttribute('cy', hp.y);
            } else {
                sizeHandle.style.display = 'none';
            }
        }
    }

    hide() {
        if (this.handleGroup) {
            this.handleGroup.remove();
            this.handleGroup = null;
        }
        this.activeNode = null;
    }
}

window.SvgPolylineHandler = SvgPolylineHandler;
