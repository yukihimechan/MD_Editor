/**
 * SVG Toolbar - 12種類のツールを提供するツールバー
 * 依孁E svg.js, svg.shapes.js
 */

/**
 * SVG Tool Classes
 */
class BaseTool {
    constructor(toolbar) {
        this.toolbar = toolbar;
        this.activeElement = null;
        this.startPoint = null;
    }
    get draw() { return this.toolbar.draw; }
    getProp(name, defaultValue) {
        return this.toolbar.getToolProperty(this.toolbar.currentTool, name, defaultValue);
    }
    mousedown(e, pt) { }
    mousemove(e, pt) { }
    mouseup(e, pt) {
        if (this.activeElement) {
            this.finalize();
        }
    }
    finalize() {
        if (!this.activeElement) return;
        const box = this.activeElement.bbox();
        if (box.width < 2 && box.height < 2 && this.toolbar.currentTool !== 'freehand') {
            this.activeElement.remove();
        } else {
            // [NEW] メタデータの付与
            this.activeElement.attr('data-tool-id', this.toolbar.currentTool);

            if (window.makeInteractive) window.makeInteractive(this.activeElement);
            if (window.selectElement) window.selectElement(this.activeElement);
            if (window.syncChanges) window.syncChanges();
        }
        this.activeElement = null;
        this.toolbar.setTool('select');
    }
    getCursor() { return 'crosshair'; }
}

class SelectTool extends BaseTool {
    getCursor() { return 'default'; }
}

class ShapeTool extends BaseTool {
    mousedown(e, pt) {
        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        this.isDragging = false;
        const color = this.getProp('stroke', '#000000');
        const width = this.getProp('stroke-width', 1);
        const fill = this.getProp('fill', 'none');
        this.activeElement = this.createShape(pt);
        if (this.activeElement) {
            this.activeElement.fill(fill).stroke({ color, width });
        }
    }
    createShape(pt) {
        let el = null;
        switch (this.toolbar.currentTool) {
            case 'rect':
                el = this.draw.rect(0, 0).move(pt.x, pt.y);
                break;
            case 'circle':
                console.log(`[SVG Lib Call] draw.ellipse(0, 0).move(${pt.x}, ${pt.y})`);
                el = this.draw.ellipse(0, 0).move(pt.x, pt.y);
                break;
            case 'rounded':
                const r = this.getProp('radius', 10);
                console.log(`[SVG Lib Call] draw.rect(0, 0).radius(${r}).move(${pt.x}, ${pt.y})`);
                el = this.draw.rect(0, 0).radius(r).move(pt.x, pt.y);
                break;
        }
        return el;
    }
    mousemove(e, pt) {
        if (!this.activeElement) return;
        this.isDragging = true;
        const isAlt = SVGUtils.isSnapEnabled(e);
        let targetPt = pt;
        if (isAlt && typeof AppState !== 'undefined' && AppState.config.grid) {
            const snapSize = AppState.config.grid.size || 15;
            targetPt = {
                x: Math.round(pt.x / snapSize) * snapSize,
                y: Math.round(pt.y / snapSize) * snapSize
            };
        }

        const dx = targetPt.x - this.startPoint.x;
        const dy = targetPt.y - this.startPoint.y;
        const x = dx < 0 ? targetPt.x : this.startPoint.x;
        const y = dy < 0 ? targetPt.y : this.startPoint.y;
        let w = Math.abs(dx);
        let h = Math.abs(dy);

        if (this.toolbar.currentTool === 'circle' && e.shiftKey) {
            const r = Math.max(w, h);
            w = h = r;
        }
        this.activeElement.move(x, y).size(w, h);
    }
    mouseup(e, pt) {
        if (!this.activeElement) return;
        // クリックのみ（ドラッグなし）の場合、デフォルトの100pxサイズで配置
        if (!this.isDragging) {
            const defaults = this.toolbar.defaultSizes[this.toolbar.currentTool] || { w: 100, h: 100 };
            const x = this.startPoint.x - defaults.w / 2;
            const y = this.startPoint.y - defaults.h / 2;
            console.log(`[SVG Lib Call] ${this.activeElement.id()}.move(${x}, ${y}).size(${defaults.w}, ${defaults.h})`);
            this.activeElement.move(x, y).size(defaults.w, defaults.h);
        }
        this.finalize();
    }
}

class PolyTool extends BaseTool {
    mousedown(e, pt) {
        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        this.isDragging = false;
        const color = this.getProp('stroke', '#000000');
        const width = this.getProp('stroke-width', 1);
        const fill = this.getProp('fill', 'none');
        this.activeElement = this.createShape(pt);
        if (this.activeElement) {
            this.activeElement.fill(fill).stroke({ color, width });
        }
    }
    createShape(pt) {
        let el = null;
        switch (this.toolbar.currentTool) {
            case 'triangle':
                el = this.draw.polygon([[0, 0], [0, 0], [0, 0]]).move(pt.x, pt.y);
                break;
            case 'star':
                console.log(`[SVG Lib Call] draw.polygon([[0,0]]).move(${pt.x}, ${pt.y})`);
                el = this.draw.polygon([[0, 0]]).move(pt.x, pt.y);
                break;
            case 'polygon':
                console.log(`[SVG Lib Call] draw.polygon([[0,0]]).move(${pt.x}, ${pt.y})`);
                el = this.draw.polygon([[0, 0]]).move(pt.x, pt.y);
                break;
        }
        return el;
    }
    mousemove(e, pt) {
        if (!this.activeElement) return;
        this.isDragging = true;
        const dx = pt.x - this.startPoint.x;
        const dy = pt.y - this.startPoint.y;
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        const x = dx < 0 ? pt.x : this.startPoint.x;
        const y = dy < 0 ? pt.y : this.startPoint.y;

        let points = [];
        if (this.toolbar.currentTool === 'triangle') {
            points = [[w / 2, 0], [0, h], [w, h]];
            if (this.activeElement.plot) {
                console.log(`[SVG Lib Call] ${this.activeElement.id()}.plot(`, points, `).move(${x}, ${y})`);
                this.activeElement.plot(points);
            }
            this.activeElement.move(x, y);
        } else if (this.toolbar.currentTool === 'star' || this.toolbar.currentTool === 'polygon') {
            const isAlt = SVGUtils.isSnapEnabled(e);
            let targetPt = pt;
            if (isAlt && typeof AppState !== 'undefined' && AppState.config.grid) {
                const snapSize = AppState.config.grid.size || 15;
                targetPt = {
                    x: Math.round(pt.x / snapSize) * snapSize,
                    y: Math.round(pt.y / snapSize) * snapSize
                };
            }

            const r = Math.sqrt(Math.pow(targetPt.x - this.startPoint.x, 2) + Math.pow(targetPt.y - this.startPoint.y, 2));
            const isStar = this.toolbar.currentTool === 'star';
            const count = isStar ? this.getProp('spikes', 5) : this.getProp('sides', 6);

            if (isStar) {
                points = SVGUtils.calculateStarPoints(r, count);
                this.activeElement.attr('data-spikes', count);
            } else {
                points = SVGUtils.calculatePolygonPoints(r, count);
                this.activeElement.attr('data-sides', count);
            }
            this.activeElement.attr('data-radius', r);

            if (this.activeElement.plot) {
                this.activeElement.plot(points);
            }
            this.activeElement.center(this.startPoint.x, this.startPoint.y);
        }
    }
    mouseup(e, pt) {
        if (!this.activeElement) return;
        // クリックのみ（ドラッグなし）の場合、デフォルトサイズで配置
        if (!this.isDragging) {
            const defaults = this.toolbar.defaultSizes[this.toolbar.currentTool] || { w: 100, h: 100 };
            const r = defaults.w / 2;
            const isStar = this.toolbar.currentTool === 'star';
            const count = isStar ? this.getProp('spikes', 5) : this.getProp('sides', 6);
            let points = [];

            if (this.toolbar.currentTool === 'triangle') {
                points = [[defaults.w / 2, 0], [0, defaults.h], [defaults.w, defaults.h]];
                if (this.activeElement.plot) this.activeElement.plot(points);
                this.activeElement.move(this.startPoint.x - defaults.w / 2, this.startPoint.y - defaults.h / 2);
            } else if (isStar) {
                points = SVGUtils.calculateStarPoints(r, count);
                this.activeElement.attr('data-spikes', count);
                this.activeElement.attr('data-radius', r);
                if (this.activeElement.plot) this.activeElement.plot(points);
                this.activeElement.center(this.startPoint.x, this.startPoint.y);
            } else { // polygon
                points = SVGUtils.calculatePolygonPoints(r, count);
                this.activeElement.attr('data-sides', count);
                this.activeElement.attr('data-radius', r);
                if (this.activeElement.plot) this.activeElement.plot(points);
                this.activeElement.center(this.startPoint.x, this.startPoint.y);
            }
        }
        this.finalize();
    }
}

class LineTool extends BaseTool {
    mousedown(e, pt) {
        // [NEW] Snap start point to connector
        const isAlt = SVGUtils.isSnapEnabled(e);
        let startConnect = null;
        if (!isAlt && window.SVGConnectorManager) {
            const nearest = window.SVGConnectorManager.findNearestConnector(this.draw, pt, 20);
            if (nearest) {
                pt = { x: nearest.x, y: nearest.y };
                startConnect = nearest;
            }
        } else if (isAlt) {
            const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
            const snapSize = gridConfig.size || 15;
            pt = {
                x: Math.round(pt.x / snapSize) * snapSize,
                y: Math.round(pt.y / snapSize) * snapSize
            };
        }

        this.startPoint = pt; // Use snapped or grid-snapped point
        this.isDragging = false;
        const color = this.getProp('stroke', '#000000');
        const width = this.getProp('stroke-width', 1);

        // [MOD] Use path instead of polyline for unified behavior
        const pathData = `M ${pt.x} ${pt.y} L ${pt.x} ${pt.y}`;
        this.activeElement = this.draw.path(pathData)
            .fill('none')
            .stroke({ color, width })
            .attr({
                'data-arrow-start': 'false',
                'data-arrow-end': 'false',
                'data-arrow-size': '10',
                'data-poly-points': `${pt.x},${pt.y} ${pt.x},${pt.y}`
            });

        // [NEW] Save initial connection
        if (startConnect && window.SVGConnectorManager) {
            window.SVGConnectorManager.connect(this.activeElement, 'start', startConnect.id, startConnect.index);
        }

        // Initial marker setup
        this.toolbar.updateArrowMarkers(this.activeElement);
    }
    mousemove(e, pt) {
        if (!this.activeElement) return;

        // [NEW] 実際に動かし始めたタイミングでコネクタを表示
        if (!this.isDragging && window.SVGConnectorManager) {
            const isAlt = SVGUtils.isSnapEnabled(e);
            if (!isAlt) {
                window.SVGConnectorManager.showAllConnectors(this.draw, this.activeElement);
            }
        }

        this.isDragging = true;

        const isAlt = SVGUtils.isSnapEnabled(e);
        let targetPt = pt;

        // [NEW] コネクタ吸着またはグリッドスナップ
        if (!isAlt && window.SVGConnectorManager) {
            const nearest = window.SVGConnectorManager.findNearestConnector(this.draw, pt, 20, this.activeElement);

            // [FIX] 同じ要素の反対側の端点（start）と同じコネクタ点にはスナップしない
            let skipSnap = false;
            if (nearest) {
                const existingData = this.activeElement.attr('data-connections');
                if (existingData) {
                    try {
                        const connections = JSON.parse(existingData);
                        const startConn = connections.find(c => c.endType === 'start');
                        if (startConn && nearest.id === startConn.targetId && nearest.index === startConn.pointIndex) {
                            skipSnap = true;
                        }
                    } catch (e) { }
                }
            }

            if (nearest && !skipSnap) {
                // [FIX] Use correct transformation from world (root user units) 
                // to local element coordinate system.
                const rootNode = this.draw.node;
                const mLine = rootNode.getScreenCTM().inverse().multiply(this.activeElement.node.getScreenCTM());
                const mInv = mLine.inverse();
                const snappedLocal = new SVG.Point(nearest.x, nearest.y).transform(mInv);

                // [MOD] Ensure we only visual-snap if the logical connection is allowed
                const success = window.SVGConnectorManager.connect(this.activeElement, 'end', nearest.id, nearest.index);
                if (success) {
                    targetPt = { x: snappedLocal.x, y: snappedLocal.y };
                } else {
                    window.SVGConnectorManager.disconnect(this.activeElement, 'end');
                    targetPt = pt;
                }
            } else {
                window.SVGConnectorManager.disconnect(this.activeElement, 'end');
                targetPt = pt;
            }
        } else if (isAlt) {
            if (window.SVGConnectorManager) window.SVGConnectorManager.disconnect(this.activeElement, 'end');
            const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
            const snapSize = gridConfig.size || 15;
            targetPt = {
                x: Math.round(pt.x / snapSize) * snapSize,
                y: Math.round(pt.y / snapSize) * snapSize
            };
        }

        // [FIX] NaN Guard: Prevent setting invalid coordinates to path attributes
        if (isNaN(targetPt.x) || isNaN(targetPt.y)) {
            console.warn('[LineTool] Mousemove skipped due to NaN coordinates.');
            return;
        }

        // Just two points initially: start and current mouse
        // startPoint はmousedown時の座標（ローカル）
        const plotData = `M ${this.startPoint.x} ${this.startPoint.y} L ${targetPt.x} ${targetPt.y}`;
        this.activeElement.plot(plotData);
        this.activeElement.attr('data-poly-points', `${this.startPoint.x},${this.startPoint.y} ${targetPt.x},${targetPt.y}`);
    }
    mouseup(e, pt) {
        if (!this.activeElement) return;

        // [NEW] コネクタポイントを非表示
        if (window.SVGConnectorManager) {
            window.SVGConnectorManager.hideAllConnectors(this.draw);
        }

        // クリックのみ（ドラッグなし）の場合、デフォルトサイズで横線を配置
        if (!this.isDragging) {
            const defaults = this.toolbar.defaultSizes[this.toolbar.currentTool] || { w: 100, h: 0 };
            const endX = this.startPoint.x + defaults.w;
            this.activeElement.plot(`M ${this.startPoint.x} ${this.startPoint.y} L ${endX} ${this.startPoint.y}`);
            this.activeElement.attr('data-poly-points', `${this.startPoint.x},${this.startPoint.y} ${endX},${this.startPoint.y}`);
        }
        this.finalize();
    }
}

class ArrowLineTool extends LineTool {
    mousedown(e, pt) {
        super.mousedown(e, pt);
        this.activeElement.attr('data-arrow-end', 'true');
        this.toolbar.updateArrowMarkers(this.activeElement);
    }
}

/**
 * [NEW] Helper for SVG Icons
 */
const ToolIcons = {
    polyline_arrow: `<svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M3 17l6-6 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M17 11h4v4" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`,
    line_arrow: `<svg viewBox="0 0 24 24" width="24" height="24">
        <line x1="3" y1="21" x2="19" y2="5" stroke="currentColor" stroke-width="2"/>
        <path d="M15 5h4v4" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`
};

class PolylineArrowTool extends LineTool {
    mousedown(e, pt) {
        // [NEW] Snap point
        const isAlt = SVGUtils.isSnapEnabled(e);
        if (!isAlt && window.SVGConnectorManager) {
            const nearest = window.SVGConnectorManager.findNearestConnector(this.draw, pt, 20, this.activeElement);
            if (nearest) pt = { x: nearest.x, y: nearest.y, connector: nearest };
        } else if (isAlt) {
            const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
            const snapSize = gridConfig.size || 15;
            pt = {
                x: Math.round(pt.x / snapSize) * snapSize,
                y: Math.round(pt.y / snapSize) * snapSize
            };
        }

        if (!this.activeElement) {
            // 第一画目
            super.mousedown(e, pt);
            this.activeElement.attr('data-tool-id', 'polyline_arrow');
            this.activeElement.attr('data-arrow-end', 'true');
            this.points = [{ x: pt.x, y: pt.y }];
            this._isSnappedToClose = false;

            // コネクタ表示 (初回クリック時)
            if (!isAlt && window.SVGConnectorManager) {
                window.SVGConnectorManager.showAllConnectors(this.draw, this.activeElement);
            }

            // コネクタ接続 (開始点)
            if (pt.connector && window.SVGConnectorManager) {
                window.SVGConnectorManager.connect(this.activeElement, 'start', pt.connector.id, pt.connector.index);
            }
        } else {
            // 頂点の追加

            // [NEW] 始点への吸着判定を満たしている場合は、クローズパスとして確定させる
            if (this._isSnappedToClose) {
                this.points.push({ x: this.points[0].x, y: this.points[0].y });
                this.activeElement.attr('data-poly-closed', 'true');

                // 閉じた場合は、標準デザインとしてマーカー（矢印の先）を取り除くのが一般的
                this.activeElement.attr('data-arrow-end', 'false');
                this.activeElement.attr('data-arrow-start', 'false');

                this.updatePath([...this.points]);
                // 即座にマーカーの削除を反映させるため、finalizeの前にupdateArrowMarkersを呼ぶ
                this.toolbar.updateArrowMarkers(this.activeElement);
                this.finalize();
                return;
            }

            this.points.push({ x: pt.x, y: pt.y });

            // コネクタに接続した場合、そこで確定
            if (pt.connector && window.SVGConnectorManager) {
                window.SVGConnectorManager.connect(this.activeElement, 'end', pt.connector.id, pt.connector.index);
                this.updatePath([...this.points]);
                this.finalize();
            }
        }
        this.toolbar.updateArrowMarkers(this.activeElement);
    }

    mousemove(e, pt) {
        if (!this.activeElement) return;

        const isAlt = SVGUtils.isSnapEnabled(e);
        let targetPt = pt;
        this._isSnappedToClose = false;

        // コネクタ表示 (移動中、未表示の場合)
        if (!isAlt && window.SVGConnectorManager && !this.draw.findOne('.svg-connector-overlay')) {
            window.SVGConnectorManager.showAllConnectors(this.draw, this.activeElement);
        }

        // [NEW] 始点への吸着判定 (クローズパス化)
        if (!isAlt && this.points.length >= 2) {
            const startPt = this.points[0];
            const svg = this.draw.node;
            const m = svg.getScreenCTM() || { a: 1, d: 1 };
            const dx = pt.x - startPt.x;
            const dy = pt.y - startPt.y;
            const screenDist = Math.hypot(dx * m.a, dy * m.d);

            if (screenDist < 15) { // 15px スナップ閾値
                targetPt = { x: startPt.x, y: startPt.y };
                this._isSnappedToClose = true;
            }
        }

        // スナップ処理 (コネクタ・グリッド)
        if (!this._isSnappedToClose) {
            if (!isAlt && window.SVGConnectorManager) {
                const nearest = window.SVGConnectorManager.findNearestConnector(this.draw, pt, 20, this.activeElement);
                if (nearest) targetPt = { x: nearest.x, y: nearest.y };
            } else if (isAlt) {
                const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
                const snapSize = gridConfig.size || 15;
                targetPt = {
                    x: Math.round(pt.x / snapSize) * snapSize,
                    y: Math.round(pt.y / snapSize) * snapSize
                };
            }
        }

        // プレビューの更新 (既存のポイント群 + 現在のマウス位置)
        this.updatePath([...this.points, targetPt]);
    }

    mouseup(e, pt) {
        // マウスアップでは確定させない
    }

    updatePath(points) {
        if (!this.activeElement || !points || points.length < 2) return;
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
            d += ` L ${points[i].x} ${points[i].y}`;
        }

        // [NEW] クローズパス指定がある場合はZを追加
        if (this.activeElement.attr('data-poly-closed') === 'true') {
            d += " Z";
        }

        this.activeElement.plot(d);
        this.activeElement.attr('data-poly-points', points.map(p => `${p.x},${p.y}`).join(' '));
    }

    finalize() {
        if (this.activeElement) {
            // [NEW] 重複した末尾のポイントを除去 (ダブルクリックによる重複対策)
            while (this.points.length > 1) {
                const last = this.points[this.points.length - 1];
                const prev = this.points[this.points.length - 2];
                if (Math.abs(last.x - prev.x) < 0.01 && Math.abs(last.y - prev.y) < 0.01) {
                    this.points.pop();
                } else {
                    break;
                }
            }

            // 最終確定前にパスを固定頂点のみに更新 (プレビュー点を除去)
            this.updatePath([...this.points]);

            // コネクタを隠す
            if (window.SVGConnectorManager) window.SVGConnectorManager.hideAllConnectors(this.draw);

            super.finalize();
        }
    }

    cancel() {
        // [MOD] 右クリック時はキャンセルではなく、現在まで引いた固定頂点で確定させる
        if (this.activeElement) {
            if (this.points.length >= 1) {
                this.finalize();
                return;
            } else {
                this.activeElement.remove();
                this.activeElement = null;
            }
        }
        this.toolbar.setTool('select');
        if (window.SVGConnectorManager) window.SVGConnectorManager.hideAllConnectors(this.draw);
    }
}

class FreehandTool extends BaseTool {
    mousedown(e, pt) {
        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        const color = this.getProp('stroke', '#000000');
        const width = this.getProp('stroke-width', 1);
        this.activeElement = this.draw.polyline([[pt.x, pt.y]]).fill('none').stroke({ color, width });
    }
    mousemove(e, pt) {
        if (!this.activeElement) return;
        const arr = this.activeElement.array().valueOf();
        arr.push([pt.x, pt.y]);
        this.activeElement.plot(arr);
    }
    mouseup(e, pt) {
        if (!this.activeElement) return;

        const points = this.activeElement.array().valueOf();
        if (points.length > 2) {
            // 1. Simplify points (Douglas-Peucker)
            const epsilon = (typeof AppState !== 'undefined' && AppState.config.freehandEpsilon !== undefined)
                ? AppState.config.freehandEpsilon
                : 30.0;
            const simplified = SVGUtils.simplifyPoints(points, epsilon);

            // 2. Convert Polyline to Path
            if (window.SvgPolylineHandler) {
                const handler = new window.SvgPolylineHandler();
                const pathNode = handler.convertToPath(this.activeElement.node);
                if (pathNode) {
                    const pathEl = SVG(pathNode);

                    // 3. Calculate smooth control points
                    const bezData = SVGUtils.calculateSmoothControlPoints(simplified, 0.25);

                    // 4. Update path with new points and bezier data
                    pathEl.attr('data-poly-points', simplified.map(p => p.join(',')).join(' '));
                    pathEl.attr('data-bez-points', JSON.stringify(bezData));

                    // 5. Generate actual 'd' attribute using the same logic as handler
                    handler.activeNode = pathNode; // Temporarily set for generatePath
                    handler.generatePath(pathNode);

                    this.activeElement = pathEl;
                }
            }
        }

        super.mouseup(e, pt);
    }
}

class BubbleTool extends BaseTool {
    mousedown(e, pt) {
        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        this.isDragging = false;
        const color = this.getProp('stroke', '#000000');
        const width = this.getProp('stroke-width', 1);
        const fill = this.getProp('fill', 'none');

        const pathData = this.toolbar.getBubblePath(0, 0);
        const shiftedPath = pathData.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
            return "M " + (parseFloat(p1) + pt.x) + " " + (parseFloat(p2) + pt.y);
        });

        this.activeElement = this.draw.path(shiftedPath).fill(fill).stroke({ color, width });

        // 吹き出し固有の初期属性を付与
        this.activeElement.attr({
            'data-tool-id': 'bubble',
            'data-tail-side': 'bottom',
            'data-tail-pos': 20,
            'data-tail-width': 10,
            'data-width': 70,
            'data-height': 50,
            'data-rect-x': pt.x,
            'data-rect-y': pt.y
        });
    }
    mousemove(e, pt) {
        if (!this.activeElement) return;
        this.isDragging = true;
        const dx = pt.x - this.startPoint.x;
        const dy = pt.y - this.startPoint.y;
        const w = Math.max(70, Math.abs(dx));
        const h = Math.max(50, Math.abs(dy));
        const rx = dx < 0 ? pt.x : this.startPoint.x;
        const ry = dy < 0 ? pt.y : this.startPoint.y;

        const pathData = this.toolbar.getBubblePath(w, h);
        const shiftedPath = pathData.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
            return "M " + (parseFloat(p1) + rx) + " " + (parseFloat(p2) + ry);
        });

        this.activeElement.plot(shiftedPath);
        this.activeElement.attr({
            'data-width': w,
            'data-height': h,
            'data-rect-x': rx,
            'data-rect-y': ry
        });
    }
    mouseup(e, pt) {
        if (!this.activeElement) return;
        // クリックのみ（ドラッグなし）の場合、デフォルトサイズで配置
        if (!this.isDragging) {
            const defaults = this.toolbar.defaultSizes[this.toolbar.currentTool] || { w: 120, h: 80 };
            const rx = this.startPoint.x - defaults.w / 2;
            const ry = this.startPoint.y - defaults.h / 2;

            const pathData = this.toolbar.getBubblePath(defaults.w, defaults.h);
            const shiftedPath = pathData.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
                return "M " + (parseFloat(p1) + rx) + " " + (parseFloat(p2) + ry);
            });
            this.activeElement.plot(shiftedPath);

            this.activeElement.attr({
                'data-width': defaults.w,
                'data-height': defaults.h,
                'data-rect-x': rx,
                'data-rect-y': ry
            });
        }
        this.finalize();
    }
}

class TextTool extends BaseTool {
    getCursor() { return 'text'; }
    mousedown(e, pt) { } // Nothing on down
    mousemove(e, pt) { }
    mouseup(e, pt) {
        // デフォルトを空文字（半角スペース）にして要素を配置
        // ※完全に空だと bbox() が 0 になるため一時的にスペースを入れる
        const text = ' ';
        const size = parseFloat(this.getProp('fontSize', 20)) || 20;
        const fill = this.getProp('fill', '#000000');
        console.log(`[TextTool] テキスト作成座標 (クリック位置): x=${pt.x}, y=${pt.y}`);
        
        // [FIX] SVGテキスト(baseline: alphabetic)とインラインエディタ(top基準)のズレを解消するため、
        // クリックした y座標(pt.y)を文字の「上端」とし、ベースラインのyをフォントサイズ分(約0.88)下げる
        const targetY = pt.y + (size * 0.88);
        const el = this.draw.text(text).attr({ x: pt.x, y: targetY }).font({ size: size }).fill(fill);

        // 属性を追加してツール種別を判別できるようにする
        el.attr('data-tool-id', 'text');

        if (window.makeInteractive) window.makeInteractive(el);
        if (window.selectElement) window.selectElement(el);
        if (window.syncChanges) window.syncChanges();

        // 直ちに選択ツールに戻す
        this.toolbar.setTool('select');

        // 即座にインラインエディタを起動
        if (window.SvgTextEditor) {
            window.SvgTextEditor.startEditing(el, { x: pt.x, y: pt.y });
        }
    }
}

class CustomTool extends BaseTool {
    mousedown(e, pt) {
        const tool = this.toolbar.customTools.find(t => t.id === this.toolbar.currentTool);
        if (!tool || !tool.content) return;

        pt = SVGUtils.snapPointToGridIfAlt ? SVGUtils.snapPointToGridIfAlt(pt, e) : pt;
        this.startPoint = pt;
        this.isDragging = false;

        // 一時的なグループを作成してコンテンツを読み込む
        // これにより複数の要素が含まれるカスタムツールでも一括で扱える
        this.activeElement = this.draw.group();
        this.activeElement.svg(tool.content);

        // [FIX] カスタムツール作成時の正規化オフセットをクリア
        // e, f (translation) を 0, 0 にリセットすることで center() の計算を確実にする
        const m = this.activeElement.matrix();
        this.activeElement.matrix(m.a, m.b, m.c, m.d, 0, 0);

        // とりあえずクリック位置に配置
        this.activeElement.center(pt.x, pt.y);
    }

    mousemove(e, pt) {
        if (!this.activeElement) return;
        this.isDragging = true;

        const dx = pt.x - this.startPoint.x;
        const dy = pt.y - this.startPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 5px以上の移動があればドラッグとみなす
        if (dist > 5) {
            const bbox = this.activeElement.bbox();
            if (bbox.width > 0 && bbox.height > 0) {
                // アスペクト比を維持してサイズ変更
                const newSize = dist * 2;
                const maxDim = Math.max(bbox.width, bbox.height);
                const scale = newSize / maxDim;
                this.activeElement.size(bbox.width * scale, bbox.height * scale);
                // 中心位置を維持する
                this.activeElement.center(this.startPoint.x, this.startPoint.y);
            }
        }
    }

    mouseup(e, pt) {
        if (!this.activeElement) return;

        // クリックのみ（ドラッグなし）の場合、デフォルトの100pxサイズで配置
        if (!this.isDragging) {
            const bbox = this.activeElement.bbox();
            if (bbox.width > 0 && bbox.height > 0) {
                const maxDim = Math.max(bbox.width, bbox.height);
                const scale = 100 / maxDim;
                this.activeElement.size(bbox.width * scale, bbox.height * scale);
            }
        }

        // 最終的な中心位置をクリック位置に合わせる
        this.activeElement.center(this.startPoint.x, this.startPoint.y);

        const finalBbox = this.activeElement.bbox();
        console.log(`[CustomTool DEBUG] Before makeInteractive: element=${this.activeElement.type}#${this.activeElement.id()}`);
        console.log(`[CustomTool DEBUG] makeInteractive exists? ${typeof makeInteractive === 'function'}`);

        // インタラクティブ化と選択
        if (typeof makeInteractive === 'function') {
            console.log(`[CustomTool DEBUG] Calling makeInteractive...`);
            makeInteractive(this.activeElement);
            console.log(`[CustomTool DEBUG] makeInteractive completed`);
        }
        if (typeof selectElement === 'function') selectElement(this.activeElement);

        this.finalize();
    }
}

/**
 * [NEW] LassoTool - ドラッグによる範囲選択
 */
class LassoTool extends BaseTool {
    mousedown(e, pt) {
        this.startPoint = pt;
        if (window.deselectAll) window.deselectAll();

        // 範囲選択用のガイド矩形（点線）を作成
        this.activeElement = this.draw.rect(0, 0)
            .move(pt.x, pt.y)
            .fill('none')
            .stroke({ color: '#0366d6', width: 1, dasharray: '4,4' })
            .addClass('svg-lasso-rect');
    }

    mousemove(e, pt) {
        if (!this.activeElement) return;
        const x = Math.min(pt.x, this.startPoint.x);
        const y = Math.min(pt.y, this.startPoint.y);
        const w = Math.abs(pt.x - this.startPoint.x);
        const h = Math.abs(pt.y - this.startPoint.y);
        this.activeElement.move(x, y).size(w, h);
    }

    mouseup(e, pt) {
        if (!this.activeElement) return;

        const lassoBox = this.activeElement.bbox();
        console.log(`[SVG Lasso] Selection Area: x=${lassoBox.x.toFixed(1)}, y=${lassoBox.y.toFixed(1)}, w=${lassoBox.width.toFixed(1)}, h=${lassoBox.height.toFixed(1)}`);

        this.activeElement.remove();
        this.activeElement = null;

        // 矩形範囲内にある要素を検索して選択
        if (lassoBox.width > 2 || lassoBox.height > 2) {
            this.selectElementsInBox(lassoBox);
        }

        // 選択ツールに戻る
        this.toolbar.setTool('select');
    }

    selectElementsInBox(box) {
        const draw = this.draw;
        const found = [];

        console.log(`[SVG Lasso] Checking elements against Box:`, { x: box.x, y: box.y, x2: box.x2, y2: box.y2 });

        draw.children().each(function (el) {
            // 除外対象のタグまたはクラスをチェック
            const tagName = el.node.tagName.toLowerCase();
            if (['defs', 'style', 'marker', 'symbol', 'metadata'].includes(tagName)) return;

            // [FIX] 内部ツール系要素を確実に除外
            const internalClasses = [
                'svg-canvas-proxy', 'svg-lasso-rect', 'svg-interaction-hitarea',
                'svg_select_shape', 'svg_select_handle', 'svg_select_group',
                'svg-select-group', 'rotation-handle-group', 'radius-handle-group',
                'polyline-handle-group', 'bubble-handle-group', 'svg-control-marker'
            ];
            if (el.classes().some(c => internalClasses.includes(c) || c.startsWith('svg_select'))) return;

            // [FIX] Skip hidden elements (Include parent visibility check)
            const isVisibleLocal = el.visible();
            const displayAttr = el.attr('display');
            const visibilityAttr = el.attr('visibility');
            const displayCss = el.css('display');
            const visibilityCss = el.css('visibility');

            // [FIX] 属性とスタイルの両方を厳密にチェック
            let effectivelyVisible = isVisibleLocal &&
                displayAttr !== 'none' &&
                visibilityAttr !== 'hidden' &&
                displayCss !== 'none' &&
                visibilityCss !== 'hidden' &&
                el.node.style.display !== 'none' &&
                el.node.style.visibility !== 'hidden';

            // 親要素のチェック（グループが非表示の場合などに対応）
            if (effectivelyVisible) {
                let p = el.parent();
                while (p && p.type !== 'svg' && p.node && p.node.tagName) {
                    if (!p.visible() ||
                        p.attr('display') === 'none' || p.css('display') === 'none' || p.node.style.display === 'none' ||
                        p.attr('visibility') === 'hidden' || p.css('visibility') === 'hidden' || p.node.style.visibility === 'hidden') {
                        effectivelyVisible = false;
                        break;
                    }
                    p = p.parent();
                }
            }

            if (!effectivelyVisible) {
                console.log(`[SVG Lasso] Skipping HIDDEN element: <${tagName}>#${el.id()} (localVis=${isVisibleLocal}, disp=${displayAttr}/${displayCss}, vis=${visibilityAttr}/${visibilityCss})`);
                return;
            }

            console.log(`[SVG Lasso] Checking element: <${tagName}>#${el.id()} - PASSED Visibility (localVis=${isVisibleLocal}, disp=${displayAttr}/${displayCss}, vis=${visibilityAttr}/${visibilityCss})`);

            // [FIX] 行列（変形）を考慮したバウンディングボックスを取得
            const m = el.matrix() || new SVG.Matrix();
            const elBox = el.bbox().transform(m);

            // 矩形内に完全に入っているか判定
            const isContained = (
                elBox.x >= box.x - 0.5 &&
                elBox.x2 <= box.x2 + 0.5 &&
                elBox.y >= box.y - 0.5 &&
                elBox.y2 <= box.y2 + 0.5
            );

            if (isContained) {
                found.push(el);
                console.log(`[SVG Lasso] Selected: <${tagName}>`, { elBox: { x: elBox.x, y: elBox.y, x2: elBox.x2, y2: elBox.y2 } });
            } else {
                // ログが多すぎないよう、近くにあるものだけ表示
                if (elBox.x2 > box.x && elBox.x < box.x2 && elBox.y2 > box.y && elBox.y < box.y2) {
                    console.log(`[SVG Lasso] Excluded (partial?): <${tagName}>`, { elBox: { x: elBox.x, y: elBox.y, x2: elBox.x2, y2: elBox.y2 } });
                }
            }
        });

        if (found.length > 0) {
            found.forEach((el, i) => {
                const isMulti = i > 0 || window.currentEditingSVG.isShiftPressed;
                if (window.selectElement) window.selectElement(el, isMulti, true);
            });
            // 一括選択後にリストを更新
            if (typeof buildSvgList === 'function') {
                buildSvgList();
            }
        }
    }

    getCursor() { return 'crosshair'; }
}

class SVGMainToolbar extends SVGToolbarBase {
    constructor() {
        super({
            id: 'svg-main-toolbar',
            position: { top: '50px', left: '-37px' },
            borderColor: '#004DEB'
        });
        this.currentTool = 'select';
        this.draw = null;
        this.container = null;
        this.toolbarElement = null;
        this.activeToolInstance = null;
        this.customTools = [];

        this.toolDefaults = {
            'rect': { fill: 'none', stroke: '#000000', 'stroke-width': 1 },
            'circle': { fill: 'none', stroke: '#000000', 'stroke-width': 1 },
            'rounded': { fill: 'none', stroke: '#000000', 'stroke-width': 1, radius: 10 },
            'triangle': { fill: 'none', stroke: '#000000', 'stroke-width': 1 },
            'star': { fill: 'none', stroke: '#000000', 'stroke-width': 1, spikes: 5 },
            'polygon': { fill: 'none', stroke: '#000000', 'stroke-width': 1, sides: 6 },
            'line': { stroke: '#000000', 'stroke-width': 1 },
            'arrow': { stroke: '#000000', 'stroke-width': 1 },
            'polyline_arrow': { stroke: '#000000', 'stroke-width': 1 },
            'freehand': { stroke: '#000000', 'stroke-width': 1 },
            'bubble': { fill: 'none', stroke: '#000000', 'stroke-width': 1 },
            'text': { fill: '#000000', fontSize: 20 }
        };

        this.defaultSizes = {
            'rect': { w: 100, h: 100 },
            'circle': { w: 100, h: 100 },
            'rounded': { w: 100, h: 100 },
            'triangle': { w: 100, h: 100 },
            'star': { w: 100, h: 100 },
            'polygon': { w: 100, h: 100 },
            'line': { w: 100, h: 0 },
            'arrow': { w: 100, h: 0 },
            'polyline_arrow': { w: 100, h: 0 },
            'bubble': { w: 120, h: 80 }
        };

        this.toolDefaultsKey = 'mdEditor_svgToolDefaults';
        this.loadToolDefaults();

        this.tools = [
            { id: 'select', label: '選択', icon: '<svg viewBox="0 0 24 24"><path d="M7 2l12 12-4 1 3 7-2 1-3-7-4 4V2z" fill="currentColor"/></svg>' },
            { id: 'lasso', label: '範囲選択', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3,2"/><path d="M7 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" transform="translate(7, 8)"/></svg>' },
            { id: 'rect', label: '矩形', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'circle', label: '真円', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'rounded', label: '角丸矩形', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'triangle', label: '三角形', icon: '<svg viewBox="0 0 24 24"><path d="M12 2L2 21h20L12 2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'star', label: '星型', icon: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'polygon', label: '多角形', icon: '<svg viewBox="0 0 24 24"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'line', label: '直線', icon: '<svg viewBox="0 0 24 24"><line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'arrow', label: '矢印', icon: ToolIcons.line_arrow },
            { id: 'polyline_arrow', label: '折れ線矢印', icon: ToolIcons.polyline_arrow },
            { id: 'freehand', label: '自由描画', icon: '<svg viewBox="0 0 24 24"><path d="M3 21c3-3 6-3 9 0s6 3 9 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'bubble', label: '吹出し', icon: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' },
            { id: 'text', label: 'テキスト', icon: '<svg viewBox="0 0 24 24"><path d="M5 4v3h5.5l.25 13h3.5l.25-13H20V4z" fill="currentColor"/></svg>' }
        ];
    }


    /**
     * Update Arrow Markers based on data attributes
     */
    updateArrowMarkers(el) {
        if (!el || (el.type !== 'polyline' && el.type !== 'line' && el.type !== 'path')) return;

        const hasStart = el.node.getAttribute('data-arrow-start') === 'true';
        const hasEnd = el.node.getAttribute('data-arrow-end') === 'true';
        const size = parseFloat(el.node.getAttribute('data-arrow-size')) || 10;

        // CSSスタイルを優先して現在適用されている色を正確に取得する
        const color = el.node.style.stroke || el.attr('stroke') || '#000000';

        // Start marker
        if (hasStart) {
            const startId = el.id() + '_m_start';
            let mStart = SVG('#' + startId);
            if (mStart) {
                mStart.size(size, size);
                mStart.clear();
                mStart.path(`M${size} 0 L0 ${size / 2} L${size} ${size} z`).fill(color);
                mStart.attr('refX', 0).attr('refY', size / 2).attr('orient', 'auto');
                if (el.attr('marker-start') !== `url(#${startId})`) {
                    el.attr('marker-start', `url(#${startId})`);
                }
            } else {
                // コピーなどで他要素のマーカー参照を引き継いでいる場合、既存マーカーを上書き（汚染）しないように
                // 参照を強制的に外してから新しく作らせる
                el.attr('marker-start', null);

                el.marker('start', size, size, function (add) {
                    add.path(`M${size} 0 L0 ${size / 2} L${size} ${size} z`).fill(color);
                    this.attr('refX', 0).attr('refY', size / 2).attr('orient', 'auto');
                });
                const ref = typeof el.reference === 'function' ? el.reference('marker-start') : null;
                if (ref) {
                    ref.id(startId);
                    el.attr('marker-start', `url(#${startId})`);
                }
            }
        } else {
            el.attr('marker-start', null);
        }

        // End marker
        if (hasEnd) {
            const endId = el.id() + '_m_end';
            let mEnd = SVG('#' + endId);
            if (mEnd) {
                mEnd.size(size, size);
                mEnd.clear();
                mEnd.path(`M0 0 L${size} ${size / 2} L0 ${size} z`).fill(color);
                mEnd.attr('refX', size).attr('refY', size / 2).attr('orient', 'auto');
                if (el.attr('marker-end') !== `url(#${endId})`) {
                    el.attr('marker-end', `url(#${endId})`);
                }
            } else {
                // コピーなどで他要素のマーカー参照を引き継いでいる場合、既存マーカーを上書き（汚染）しないように
                el.attr('marker-end', null);

                el.marker('end', size, size, function (add) {
                    add.path(`M0 0 L${size} ${size / 2} L0 ${size} z`).fill(color);
                    this.attr('refX', size).attr('refY', size / 2).attr('orient', 'auto');
                });
                const ref = typeof el.reference === 'function' ? el.reference('marker-end') : null;
                if (ref) {
                    ref.id(endId);
                    el.attr('marker-end', `url(#${endId})`);
                }
            }
        } else {
            el.attr('marker-end', null);
        }
    }

    init(container, draw) {
        this.container = container;
        this.draw = draw;
        this.loadCustomTools();
        this.loadToolDefaults();

        // Initialize tool mapping
        this.toolMap = {
            'select': new SelectTool(this),
            'lasso': new LassoTool(this),
            'rect': new ShapeTool(this),
            'circle': new ShapeTool(this),
            'rounded': new ShapeTool(this),
            'triangle': new PolyTool(this),
            'star': new PolyTool(this),
            'polygon': new PolyTool(this),
            'line': new LineTool(this),
            'arrow': new ArrowLineTool(this),
            'polyline_arrow': new PolylineArrowTool(this),
            'freehand': new FreehandTool(this),
            'bubble': new BubbleTool(this),
            'text': new TextTool(this)
        };

        this.activeToolInstance = this.toolMap['select'];
        this.createToolbar();
        this.bindEvents();
    }

    loadCustomTools() {
        try {
            const saved = localStorage.getItem('mdEditor_svgCustomTools');
            if (saved) this.customTools = JSON.parse(saved);
        } catch (e) { console.error('Failed to load custom tools', e); }
    }

    saveCustomTools() {
        localStorage.setItem('mdEditor_svgCustomTools', JSON.stringify(this.customTools));
    }

    // loadToolDefaults, saveToolDefaults, getToolProperty, setToolProperty は SVGToolbarBase へ移行しました

    deleteCustomTool(toolId) {
        if (!confirm(`カスタムツール「${toolId}」を削除しますか？`)) return;
        this.customTools = this.customTools.filter(t => t.id !== toolId);
        if (this.toolMap[toolId]) delete this.toolMap[toolId];
        this.saveCustomTools();
        if (this.currentTool === toolId) this.setTool('select');
        this.refreshToolbar();
    }

    addCustomTool(name, svgContent, bbox) {
        const id = 'custom_' + Date.now();
        const icon = bbox ? svgContent : '<path d="M12 2v20M2 12h20M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6" stroke="currentColor" stroke-width="2"/>';
        this.customTools.push({
            id: id, label: name, icon: icon,
            viewBox: bbox ? `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}` : "0 0 24 24",
            content: svgContent, isCustom: true
        });
        // Register custom tool class
        this.toolMap[id] = new CustomTool(this);
        this.saveCustomTools();
        this.refreshToolbar();
        if (window.customToolbar) {
            window.customToolbar.refresh();
            window.customToolbar.updateVisibility();
        }
    }

    setTool(toolId) {
        if (this.currentTool === toolId) return;

        // Fallback for missing custom tool classes
        if (toolId.startsWith('custom_') && !this.toolMap[toolId]) {
            this.toolMap[toolId] = new CustomTool(this);
        }

        this.currentTool = toolId;
        this.activeToolInstance = this.toolMap[toolId] || this.toolMap['select'];

        // UI update
        if (this.toolbarElement) {
            Array.from(this.toolbarElement.querySelectorAll('button[data-tool]')).forEach(btn => {
                if (btn.dataset.tool === toolId) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        if (window.customToolbar) window.customToolbar.setTool(toolId);
        this.updateCursor();
        if (toolId !== 'select' && window.deselectAll) window.deselectAll();
    }

    updateCursor() {
        if (this.activeToolInstance) {
            this.container.style.cursor = this.activeToolInstance.getCursor();
        }
    }

    bindEvents() {
        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);
        this.handleDblClick = this.onDblClick.bind(this);
        this.handleContextMenu = this.onContextMenu.bind(this);

        if (this.draw && this.draw.node) {
            this.draw.node.addEventListener('mousedown', this.handleMouseDown, true);
            this.draw.node.addEventListener('dblclick', this.handleDblClick);
            this.draw.node.addEventListener('contextmenu', this.handleContextMenu);
        }

        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    unbindEvents() {
        if (this.draw && this.draw.node) {
            this.draw.node.removeEventListener('mousedown', this.handleMouseDown, true);
            this.draw.node.removeEventListener('dblclick', this.handleDblClick);
            this.draw.node.removeEventListener('contextmenu', this.handleContextMenu);
        }
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }

    onDblClick(e) {
        if (this.activeToolInstance && this.activeToolInstance.finalize) {
            e.preventDefault();
            e.stopPropagation();
            this.activeToolInstance.finalize();
        }
    }

    onContextMenu(e) {
        if (this.activeToolInstance && this.currentTool === 'polyline_arrow') {
            e.preventDefault();
            e.stopPropagation();
            if (this.activeToolInstance.cancel) {
                this.activeToolInstance.cancel();
            }
        }
    }

    onMouseDown(e) {
        if (e.button === 2) return;


        if (this.currentTool === 'select') {
            return;
        }

        e.stopPropagation();

        const pt = this.draw.point(e.clientX, e.clientY);
        if (this.activeToolInstance) {
            this.activeToolInstance.mousedown(e, pt);
        }
    }

    onMouseMove(e) {
        if (this.currentTool === 'select' || !this.activeToolInstance || !this.draw) return;
        const pt = this.draw.point(e.clientX, e.clientY);
        this.activeToolInstance.mousemove(e, pt);
    }

    onMouseUp(e) {
        if (e.button === 2 || this.currentTool === 'select' || !this.activeToolInstance || !this.draw) return;
        const pt = this.draw.point(e.clientX, e.clientY);
        this.activeToolInstance.mouseup(e, pt);
    }

    refreshToolbar() {
        if (this.toolbarElement) this.toolbarElement.remove();
        this.createToolbar();
        this.setTool(this.currentTool);
    }

    destroy() {
        if (this.toolbarElement) this.toolbarElement.remove();
        this.unbindEvents();
        this.draw = null;
        this.container = null;
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar(this.config);

        this.tools.forEach(tool => {
            const btn = document.createElement('button');
            const label = (typeof i18n !== 'undefined' && i18n.t(`svgToolbar.${tool.id}`)) || tool.label;
            btn.title = label;
            btn.dataset.tool = tool.id;
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="overflow: visible;">${tool.icon}</svg>`;
            if (tool.id === this.currentTool) {
                btn.classList.add('active');
            }
            btn.onclick = (e) => { e.stopPropagation(); this.setTool(tool.id); };
            btn.addEventListener('contextmenu', (e) => {
                console.log(`[SVG Toolbar] Context menu requested for: ${tool.id}`);
                e.preventDefault();
                e.stopPropagation();
                // 修正: showToolPropertiesDialog を呼び出す
                this.showToolPropertiesDialog(tool);
            });
            contentArea.appendChild(btn);
        });

        if (this.container) {
            this.container.appendChild(toolbar);
        }
        this.toolbarElement = toolbar;
    }

    makeDraggable(el) {
        if (window.SVGUtils && window.SVGUtils.makeElementDraggable) {
            window.SVGUtils.makeElementDraggable(el, el.querySelector('.svg-toolbar-drag-handle') || el, {
                storageKey: 'svg-main-toolbar-pos',
                container: this.container
            });
        }
    }

    resetPosition() {
        super.resetPosition();
    }

    updateCanvasInputs(w, h) {
        // [DEPRECATED] Canvas inputs moved to Transform Toolbar
    }

    showToolPropertiesDialog(tool) {
        // [MOD] ベースクラスの汎用メソッドを呼び出すように変更
        super.showToolPropertiesDialog(tool.id, tool.label);
    }

    getBubblePath(w, h, options = {}) {
        const r = 10;
        const tailW = options.tailW !== undefined ? options.tailW : 10;
        if (w < 70) w = 70;
        if (h < 50) h = 50;

        const side = options.side || 'bottom';
        let pos = options.pos !== undefined ? options.pos : 20;

        if (side === 'top' || side === 'bottom') {
            pos = Math.max(r, Math.min(pos, w - r - tailW));
        } else {
            pos = Math.max(r, Math.min(pos, h - r - tailW));
        }

        let tx = options.tx;
        let ty = options.ty;

        if (tx === undefined || isNaN(tx) || ty === undefined || isNaN(ty)) {
            if (side === 'bottom') {
                tx = pos + tailW / 2 - 5; ty = h + 15;
            } else if (side === 'top') {
                tx = pos + tailW / 2 - 5; ty = -15;
            } else if (side === 'left') {
                tx = -15; ty = pos + tailW / 2 - 5;
            } else if (side === 'right') {
                tx = w + 15; ty = pos + tailW / 2 - 5;
            }
        }

        let d = `M ${r} 0 `;

        if (side === 'top') {
            d += `h ${pos - r} l ${tx - pos} ${ty - 0} l ${(pos + tailW) - tx} ${0 - ty} h ${w - r - (pos + tailW)} `;
        } else {
            d += `h ${w - 2 * r} `;
        }
        d += `a ${r} ${r} 0 0 1 ${r} ${r} `;

        if (side === 'right') {
            d += `v ${pos - r} l ${tx - w} ${ty - pos} l ${w - tx} ${(pos + tailW) - ty} v ${h - r - (pos + tailW)} `;
        } else {
            d += `v ${h - 2 * r} `;
        }
        d += `a ${r} ${r} 0 0 1 -${r} ${r} `;

        if (side === 'bottom') {
            const rightPart = w - r - (pos + tailW);
            d += `h -${rightPart} l ${tx - (pos + tailW)} ${ty - h} l ${pos - tx} ${h - ty} h -${pos - r} `;
        } else {
            d += `h -${w - 2 * r} `;
        }
        d += `a ${r} ${r} 0 0 1 -${r} -${r} `;

        if (side === 'left') {
            const bottomPart = h - r - (pos + tailW);
            d += `v -${bottomPart} l ${tx - 0} ${ty - (pos + tailW)} l ${0 - tx} ${pos - ty} v -${pos - r} `;
        } else {
            d += `v -${h - 2 * r} `;
        }
        d += `a ${r} ${r} 0 0 1 ${r} -${r} z`;

        return d;
    }
}

window.SVGToolbar = new SVGMainToolbar();

/**
 * [NEW] ツールバーの近接検知ロジック
 * 透明で背面に隠れているツールバーにマウスが近づいた際、
 * 最前面に浮き上がらせて不透明化・操作有効化するためのグローバルリスナー。
 */
const updateToolbarProximity = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const toolbars = document.querySelectorAll('.svg-toolbar');
    toolbars.forEach(tb => {
        // [NEW] ピン留めされている場合は近接検知による制御をスキップ
        if (tb.classList.contains('is-pinned')) return;

        const rect = tb.getBoundingClientRect();
        const isActive = tb.classList.contains('is-active');

        // [MOD] 判定1: ツールバー本体の矩形内にあるか (マージンなし)
        const isInsideToolbar = (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );

        if (isActive) {
            // すでにアクティブな場合：ツールバーの外に出たら解除
            if (!isInsideToolbar) {
                tb.classList.remove('is-active');
            }
        } else {
            // アクティブでない場合：ドラッグハンドルの範囲に入った時のみアクティブ化を開始
            const handle = tb.querySelector('.svg-toolbar-drag-handle');
            if (handle) {
                const hRect = handle.getBoundingClientRect();
                const isInsideHandle = (
                    clientX >= hRect.left &&
                    clientX <= hRect.right &&
                    clientY >= hRect.top &&
                    clientY <= hRect.bottom
                );
                if (isInsideHandle) {
                    tb.classList.add('is-active');
                }
            }
        }
    });
};

window.addEventListener('mousemove', updateToolbarProximity, { passive: true });
window.addEventListener('touchstart', updateToolbarProximity, { passive: true });
window.addEventListener('touchmove', updateToolbarProximity, { passive: true });

function handleGlobalClick(e) {
    const toolbars = document.querySelectorAll('.svg-toolbar');
    toolbars.forEach(tb => {
        if (!tb.contains(e.target)) {
            tb.classList.remove('is-active');
        }
    });
}
window.addEventListener('click', handleGlobalClick, { capture: true });



