/**
 * SvgOrthogonalHandler
 * 直角折れ線選択時の操作ハンドル（始点・終点・中点）の描画およびドラッグ操作を制御する。
 */
class SvgOrthogonalHandler {
    constructor(node, draw) {
        this.activeNode = node;
        this.draw = draw;
        this.overlayGroup = null;
        this.handleGroup = null;
        
        // ドラッグ管理用変数
        this.isDragging = false;
        this.dragType = null; // 'start', 'end', 'midpoint'
        this.dragIndex = -1;
        this.startPos = { x: 0, y: 0 };
        this.draggedPoints = [];

        // Bindings
        this.onDragStart = this.onDragStart.bind(this);
        this.onDragMove = this.onDragMove.bind(this);
        this.onDragEnd = this.onDragEnd.bind(this);
    }

    /**
     * data-ortho-points から頂点配列を取得する
     */
    getPoints() {
        const pointsStr = this.activeNode.getAttribute('data-ortho-points');
        if (!pointsStr) return [];
        return pointsStr.split(/\s+/).filter(s => s).map(pt => {
            const parts = pt.split(',');
            return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
        });
    }

    /**
     * 頂点配列を data-ortho-points と path d 属性に反映する
     */
    setPoints(points) {
        console.log("[DEBUG SvgOrthogonalHandler] setPoints input points:", JSON.stringify(points));
        // 直角制約クリーンアップ
        const cleanPoints = OrthogonalRouter.recalculateRoute(points);
        console.log("[DEBUG SvgOrthogonalHandler] setPoints clean points:", JSON.stringify(cleanPoints));
        if (cleanPoints.length < 2) return;

        const pointsStr = cleanPoints.map(p => `${p.x},${p.y}`).join(' ');
        this.activeNode.setAttribute('data-ortho-points', pointsStr);

        const d = this._generatePathD(cleanPoints);
        console.log("[DEBUG SvgOrthogonalHandler] setPoints set d attribute:", d);
        this.activeNode.setAttribute('d', d);

        // [NEW] 交差ブリッジを適用（キャンバス全体の直角折れ線をチェック）
        if (window.SVGUtils && window.SVGUtils.refreshAllLineBridges) {
            const svgRoot = this.activeNode.ownerSVGElement;
            if (svgRoot) {
                window.SVGUtils.refreshAllLineBridges(svgRoot);
            }
        }
    }

    /**
     * パスの d 属性文字列を生成する (M H V ...)
     */
    _generatePathD(points) {
        if (points.length < 2) return '';
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            if (prev.y === curr.y) {
                d += ` H ${curr.x}`;
            } else if (prev.x === curr.x) {
                d += ` V ${curr.y}`;
            } else {
                // 制約違反時のフォールバック
                d += ` L ${curr.x} ${curr.y}`;
            }
        }
        return d;
    }

    /**
     * ハンドルを表示する
     */
    update(overlayGroup, node, bbox) {
        this.overlayGroup = overlayGroup;
        this.activeNode = node || this.activeNode;

        if (!this.overlayGroup) return;

        if (!this.handleGroup) {
            this.handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            this.handleGroup.setAttribute('class', 'orthogonal-handle-group');
            this.overlayGroup.node.appendChild(this.handleGroup);
        }

        // 既存のハンドルをクリア
        while (this.handleGroup.firstChild) {
            this.handleGroup.removeChild(this.handleGroup.firstChild);
        }

        const points = this.getPoints();
        if (points.length < 2) return;

        const mapLocalToOverlay = (pt) => {
            if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
                return window.SVGUtils.mapLocalToOverlay([pt.x, pt.y], this.activeNode, this.overlayGroup);
            }
            return pt;
        };

        // 1. セグメント中点ハンドル (正方形, 緑)
        for (let i = 0; i < points.length - 1; i++) {
            const pt1 = points[i];
            const pt2 = points[i + 1];
            const isHorizontal = Math.abs(pt1.y - pt2.y) < 1e-2;

            // ローカル空間での中点座標
            const midLocal = {
                x: (pt1.x + pt2.x) / 2,
                y: (pt1.y + pt2.y) / 2
            };
            const midOverlay = mapLocalToOverlay(midLocal);

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', midOverlay.x - 4);
            rect.setAttribute('y', midOverlay.y - 4);
            rect.setAttribute('width', '8');
            rect.setAttribute('height', '8');
            rect.setAttribute('fill', '#28a745');
            rect.setAttribute('stroke', '#ffffff');
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('class', 'orthogonal-midpoint-handle');
            rect.setAttribute('data-type', 'midpoint');
            rect.setAttribute('data-index', i.toString());
            rect.style.cursor = isHorizontal ? 'ns-resize' : 'ew-resize';
            rect.style.pointerEvents = 'all';

            this.handleGroup.appendChild(rect);

            rect.addEventListener('pointerdown', (e) => this.onDragStart(e, 'midpoint', i));
        }

        // 2. 始点ハンドル (円, 青)
        const startOverlay = mapLocalToOverlay(points[0]);
        const startCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        startCircle.setAttribute('cx', startOverlay.x);
        startCircle.setAttribute('cy', startOverlay.y);
        startCircle.setAttribute('r', '5');
        startCircle.setAttribute('fill', '#ffffff');
        startCircle.setAttribute('stroke', '#0366d6');
        startCircle.setAttribute('stroke-width', '2');
        startCircle.setAttribute('class', 'orthogonal-endpoint-handle');
        startCircle.setAttribute('data-type', 'start');
        startCircle.style.cursor = 'move';
        startCircle.style.pointerEvents = 'all';

        this.handleGroup.appendChild(startCircle);
        startCircle.addEventListener('pointerdown', (e) => this.onDragStart(e, 'start', 0));

        // 3. 終点ハンドル (円, 青)
        const endOverlay = mapLocalToOverlay(points[points.length - 1]);
        const endCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        endCircle.setAttribute('cx', endOverlay.x);
        endCircle.setAttribute('cy', endOverlay.y);
        endCircle.setAttribute('r', '5');
        endCircle.setAttribute('fill', '#ffffff');
        endCircle.setAttribute('stroke', '#0366d6');
        endCircle.setAttribute('stroke-width', '2');
        endCircle.setAttribute('class', 'orthogonal-endpoint-handle');
        endCircle.setAttribute('data-type', 'end');
        endCircle.style.cursor = 'move';
        endCircle.style.pointerEvents = 'all';

        this.handleGroup.appendChild(endCircle);
        endCircle.addEventListener('pointerdown', (e) => this.onDragStart(e, 'end', points.length - 1));

        // [NEW] DOMマウントの保証
        if (this.handleGroup.parentNode !== this.overlayGroup.node) {
            this.overlayGroup.node.appendChild(this.handleGroup);
        }

        // [NEW] アタッチ後にサイズ補正を適用
        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
            const zoomVal = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
            const handles = this.handleGroup.querySelectorAll('rect, circle');
            handles.forEach(h => window.SVGUtils.updateHandleScaling(h, zoomVal));
        }
    }

    /**
     * ハンドルを非表示にする
     */
    hide() {
        if (this.handleGroup) {
            this.handleGroup.remove();
            this.handleGroup = null;
        }
    }

    /**
     * ドラッグ開始
     */
    onDragStart(e, type, idx) {
        console.log("[DEBUG SvgOrthogonalHandler] onDragStart called", type, idx, e.type);
        e.preventDefault();
        e.stopPropagation();

        // ロックチェック
        if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
            return;
        }

        this.isDragging = true;
        this.dragType = type;
        this.dragIndex = idx;
        this.draggedPoints = this.getPoints();
        console.log("[DEBUG SvgOrthogonalHandler] onDragStart draggedPoints initialized:", JSON.stringify(this.draggedPoints));

        // 基準座標の保存 (ローカル空間への逆変換)
        if (window.SVGUtils && window.SVGUtils.getLocalPoint) {
            this.startPos = window.SVGUtils.getLocalPoint(e, this.activeNode);
        } else {
            const svg = this.activeNode.ownerSVGElement;
            const p = svg.createSVGPoint();
            p.x = e.clientX; p.y = e.clientY;
            const ctm = this.activeNode.getScreenCTM();
            this.startPos = ctm ? p.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY };
        }
        console.log("[DEBUG SvgOrthogonalHandler] onDragStart startPos:", JSON.stringify(this.startPos));

        if (window.currentEditingSVG) {
            window.currentEditingSVG._isOperationInProgress = true;
            if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
        }

        const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
        if (draw && draw.node) {
            this._dragRootCTMInv = draw.node.getScreenCTM().inverse();
        }
        if (window.SVGConnectorManager && draw) {
            this._connectorCache = window.SVGConnectorManager.cacheConnectorPoints(draw, SVG(this.activeNode));
        }

        // グローバルなマウスイベントを登録
        window.addEventListener('pointermove', this.onDragMove);
        window.addEventListener('pointerup', this.onDragEnd);
        window.addEventListener('pointercancel', this.onDragEnd);
    }

    /**
     * ドラッグ中
     */
    onDragMove(e) {
        try {
            console.log("[DEBUG SvgOrthogonalHandler] onDragMove called", this.isDragging, e.type, e.clientX, e.clientY);
            if (!this.isDragging) return;

            let currPos;
            if (window.SVGUtils && window.SVGUtils.getLocalPoint) {
                currPos = window.SVGUtils.getLocalPoint(e, this.activeNode);
            } else {
                const svg = this.activeNode.ownerSVGElement;
                const p = svg.createSVGPoint();
                p.x = e.clientX; p.y = e.clientY;
                const ctm = this.activeNode.getScreenCTM();
                currPos = ctm ? p.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY };
            }

            const dx = currPos.x - this.startPos.x;
            const dy = currPos.y - this.startPos.y;
            console.log(`[DEBUG SvgOrthogonalHandler] dx: ${dx}, dy: ${dy}, startPos: ${JSON.stringify(this.startPos)}, currPos: ${JSON.stringify(currPos)}`);

            const isAlt = SVGUtils.isSnapEnabled(e);
            const draw = window.currentEditingSVG ? window.currentEditingSVG.draw : null;
            if (!isAlt && window.SVGConnectorManager && this._connectorCache && draw) {
                const zoom = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
                let worldPt;
                if (this._dragRootCTMInv) {
                    const pt = draw.node.createSVGPoint();
                    pt.x = e.clientX; pt.y = e.clientY;
                    const wt = pt.matrixTransform(this._dragRootCTMInv);
                    worldPt = { x: wt.x, y: wt.y };
                } else {
                    worldPt = draw.point(e.clientX, e.clientY);
                }
                window.SVGConnectorManager.updateConnectorDisplay(draw, this._connectorCache, worldPt, zoom, SVG(this.activeNode));
            } else if (window.SVGConnectorManager && draw) {
                window.SVGConnectorManager.hideAllConnectors(draw);
            }

            const points = JSON.parse(JSON.stringify(this.draggedPoints));

            if (this.dragType === 'start' || this.dragType === 'end') {
                // 始点・終点移動時の自動迂回
                const isStart = this.dragType === 'start';
                const movingPt = points[isStart ? 0 : points.length - 1];
                movingPt.x += dx;
                movingPt.y += dy;

                // 移動した端点をコネクタに吸着させる
                let snapPtWorld = null;
                let targetConnector = null;

                if (!isAlt && window.SVGConnectorManager && draw) {
                    let worldPt;
                    if (this._dragRootCTMInv) {
                        const pt = draw.node.createSVGPoint();
                        pt.x = e.clientX; pt.y = e.clientY;
                        const wt = pt.matrixTransform(this._dragRootCTMInv);
                        worldPt = { x: wt.x, y: wt.y };
                    } else {
                        worldPt = draw.point(e.clientX, e.clientY);
                    }
                    const nearest = window.SVGConnectorManager.findNearestConnector(draw, worldPt, 20, SVG(this.activeNode));
                    if (nearest) {
                        // コネクタ座標をローカル空間に変換
                        const ctm = this.activeNode.getScreenCTM();
                        if (ctm) {
                            const p = draw.node.createSVGPoint();
                            p.x = nearest.x; p.y = nearest.y;
                            const localP = p.matrixTransform(this.activeNode.getCTM().inverse());
                            movingPt.x = localP.x;
                            movingPt.y = localP.y;
                            targetConnector = nearest;
                        }
                    }
                }

                // A* 迂回経路の計算
                const startPt = isStart ? movingPt : points[0];
                const endPt = isStart ? points[points.length - 1] : movingPt;

                // ローカル座標からワールド座標へ変換して障害物迂回計算
                const mLine = draw.node.getScreenCTM().inverse().multiply(this.activeNode.getScreenCTM());

                const pStart = draw.node.createSVGPoint();
                pStart.x = startPt.x; pStart.y = startPt.y;
                const startWorld = pStart.matrixTransform(mLine);

                const pEnd = draw.node.createSVGPoint();
                pEnd.x = endPt.x; pEnd.y = endPt.y;
                const endWorld = pEnd.matrixTransform(mLine);

                // 接続情報の取得（両端のコネクタ情報を取得）
                let startConn = null;
                let endConn = null;
                const connDataStr = this.activeNode.getAttribute('data-connections');
                let connectData = [];
                if (connDataStr) {
                    try { connectData = JSON.parse(connDataStr); } catch (e) {}
                }

                // 自身がドラッグ中のコネクタ
                if (isStart && targetConnector) startConn = targetConnector;
                if (!isStart && targetConnector) endConn = targetConnector;

                // もう一方の端点のコネクタを検索
                if (window.SVGConnectorManager) {
                    if (isStart) {
                        const otherConnData = connectData.find(c => c.endType === 'end');
                        if (otherConnData) {
                            const target = draw.findOne('#' + otherConnData.targetId);
                            if (target) endConn = window.SVGConnectorManager.getConnectorPoints(target)[otherConnData.pointIndex];
                        }
                    } else {
                        const otherConnData = connectData.find(c => c.endType === 'start');
                        if (otherConnData) {
                            const target = draw.findOne('#' + otherConnData.targetId);
                            if (target) startConn = window.SVGConnectorManager.getConnectorPoints(target)[otherConnData.pointIndex];
                        }
                    }
                }

                // 接続先の図形は障害物として扱うため除外しない
                const excludeEls = [this.activeNode];
                const obstacles = window.SVGAutoRouter ? window.SVGAutoRouter.collectObstacles(draw, excludeEls) : [];
                
                // スタブ付きの経路探索
                const routeWorld = OrthogonalRouter.routeWithStubs(
                    startConn, endConn,
                    { x: startWorld.x, y: startWorld.y },
                    { x: endWorld.x, y: endWorld.y },
                    obstacles
                );

                // ワールド座標からローカル座標へ逆変換
                const mInv = mLine.inverse();
                const routeLocal = routeWorld.map(p => {
                    const pt = draw.node.createSVGPoint();
                    pt.x = p.x; pt.y = p.y;
                    const lp = pt.matrixTransform(mInv);
                    return { x: lp.x, y: lp.y };
                });

                this.setPoints(routeLocal);

                // コネクタデータ同期
                if (window.SVGConnectorManager) {
                    const connType = isStart ? 'start' : 'end';
                    if (targetConnector) {
                        window.SVGConnectorManager.connect(SVG(this.activeNode), connType, targetConnector.id, targetConnector.index);
                    } else {
                        window.SVGConnectorManager.disconnect(SVG(this.activeNode), connType);
                    }
                }

            } else if (this.dragType === 'midpoint') {
                // セグメント中点ドラッグ
                const i = this.dragIndex;
                const pt1 = points[i];
                const pt2 = points[i + 1];
                const isHorizontal = Math.abs(pt1.y - pt2.y) < 1e-2;
                const zoomScale = (window.currentEditingSVG && window.currentEditingSVG.zoom) ? window.currentEditingSVG.zoom / 100 : 1;
                const snapThreshold = 20 / zoomScale; // 直線を簡単に戻すためのスナップ閾値（ズームに応じる）

                if (isHorizontal) {
                    // 水平セグメント: 上下移動 (dy)
                    let targetY = pt1.y + dy;

                    // まず隣接セグメントへのスナップ判定を優先 (直角を消して直線にするため)
                    let snapped = false;
                    if (i > 0 && Math.abs(targetY - this.draggedPoints[i - 1].y) < snapThreshold) {
                        targetY = this.draggedPoints[i - 1].y;
                        snapped = true;
                    } else if (i < points.length - 2 && Math.abs(targetY - this.draggedPoints[i + 2].y) < snapThreshold) {
                        targetY = this.draggedPoints[i + 2].y;
                        snapped = true;
                    } 
                    
                    if (!snapped && isAlt) {
                        // isAlt が true の場合（実際は Alt非押下でグリッドスナップ有効の意）
                        const gridConfig = (typeof AppState !== 'undefined' && AppState.config && AppState.config.grid) || { size: 15 };
                        const snapSize = gridConfig.size || 15;
                        if (snapSize > 0) targetY = Math.round(targetY / snapSize) * snapSize;
                    }

                    pt1.y = targetY;
                    pt2.y = targetY;

                    // 境界条件（端点固定とセグメント分割）
                    if (i === 0) {
                        // 最初のセグメント: 始点を固定するため頂点を挿入
                        const newPt = { x: this.draggedPoints[0].x, y: this.draggedPoints[0].y };
                        points.unshift(newPt);
                    } else if (i === points.length - 2) {
                        // 最後のセグメント: 終点を固定するため頂点を挿入
                        const lastIdx = points.length - 1;
                        const newPt = { x: this.draggedPoints[lastIdx].x, y: this.draggedPoints[lastIdx].y };
                        points.push(newPt);
                    }
                } else {
                    // 垂直セグメント: 左右移動 (dx)
                    let targetX = pt1.x + dx;

                    // 隣接セグメントへのスナップを優先
                    let snapped = false;
                    if (i > 0 && Math.abs(targetX - this.draggedPoints[i - 1].x) < snapThreshold) {
                        targetX = this.draggedPoints[i - 1].x;
                        snapped = true;
                    } else if (i < points.length - 2 && Math.abs(targetX - this.draggedPoints[i + 2].x) < snapThreshold) {
                        targetX = this.draggedPoints[i + 2].x;
                        snapped = true;
                    }
                    
                    if (!snapped && isAlt) {
                        // グリッドスナップ
                        const gridConfig = (typeof AppState !== 'undefined' && AppState.config && AppState.config.grid) || { size: 15 };
                        const snapSize = gridConfig.size || 15;
                        if (snapSize > 0) targetX = Math.round(targetX / snapSize) * snapSize;
                    }

                    pt1.x = targetX;
                    pt2.x = targetX;

                    // 境界条件
                    if (i === 0) {
                        const newPt = { x: this.draggedPoints[0].x, y: this.draggedPoints[0].y };
                        points.unshift(newPt);
                    } else if (i === points.length - 2) {
                        const lastIdx = points.length - 1;
                        const newPt = { x: this.draggedPoints[lastIdx].x, y: this.draggedPoints[lastIdx].y };
                        points.push(newPt);
                    }
                }

                this.setPoints(points);
            }

            // ハンドル再表示
            this.update(this.overlayGroup, this.activeNode, null);
        } catch (err) {
            console.error("[ERROR SvgOrthogonalHandler.onDragMove]", err);
        }
    }

    /**
     * ドラッグ終了
     */
    onDragEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;

        window.removeEventListener('pointermove', this.onDragMove);
        window.removeEventListener('pointerup', this.onDragEnd);
        window.removeEventListener('pointercancel', this.onDragEnd);

        if (window.currentEditingSVG) {
            window.currentEditingSVG._isOperationInProgress = false;
        }

        // コネクタ表示クリア
        if (window.SVGConnectorManager && window.currentEditingSVG.draw) {
            window.SVGConnectorManager.hideAllConnectors(window.currentEditingSVG.draw);
        }
        this._connectorCache = null;
        this._dragRootCTMInv = null;

        if (window.syncChanges) {
            window.syncChanges(true, null, true);
        }
    }
}

window.SvgOrthogonalHandler = SvgOrthogonalHandler;
