/**
 * SVG Connector Manager
 * 図形のコネクタポイントの管理、表示、吸着、追従ロジックを担当します。
 */
const SVGConnectorManager = {
    debug: false, // デバッグフラグ

    /**
     * 要素のコネクタポイントを図形の輪郭上の座標（SVGルート座標系）で計算します。
     * BBox上の16点を基準方向とし、中心から各方向へのレイと図形輪郭の交点を求めます。
     */
    getConnectorPoints(el) {
        if (!el) return [];
        // SVG.js インスタンスであることを保証
        el = SVG(el);
        if (!el || typeof el.bbox !== 'function') return [];

        const node = el.node;
        if (!node || typeof node.getScreenCTM !== 'function') return [];

        const rootEl = el.root();
        const root = rootEl ? rootEl.node : null;
        if (!root || typeof root.getScreenCTM !== 'function') return [];

        const rootScreenCTM = root.getScreenCTM();
        if (!rootScreenCTM) return [];

        const elId = el.id();

        // グループの場合、背景図形のジオメトリを使用してコネクタポイントを計算
        let targetEl = el;
        const tagName = node.tagName.toLowerCase();
        if (tagName === 'g') {
            const bgShape = this._findBackgroundShape(el);
            if (bgShape) {
                targetEl = SVG(bgShape);
            }
        }

        const targetNode = targetEl.node;
        if (!targetNode || typeof targetNode.getScreenCTM !== 'function') return [];

        const targetScreenCTM = targetNode.getScreenCTM();
        if (!targetScreenCTM) return [];

        // ルートSVGのユーザー単位系への変換行列（背景図形の座標系から変換）
        const m = rootScreenCTM.inverse().multiply(targetScreenCTM);
        const bbox = targetEl.bbox();

        const x = bbox.x;
        const y = bbox.y;
        const w = bbox.w;
        const h = bbox.h;

        // 相対的な16点（0.0〜1.0）
        const relativeOffsets = [
            [0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0],    // Top
            [1, 0.25], [1, 0.5], [1, 0.75], [1, 1],             // Right
            [0.75, 1], [0.5, 1], [0.25, 1], [0, 1],             // Bottom
            [0, 0.75], [0, 0.5], [0, 0.25]                      // Left
        ];

        // BBox上のローカル座標ポイント（方向の基準）
        const bboxLocalPoints = relativeOffsets.map(off => ({
            x: x + w * off[0],
            y: y + h * off[1]
        }));

        // 図形の輪郭上に投影
        const projectedPoints = this._projectPointsToOutline(targetEl, bboxLocalPoints, bbox);

        // ワールド座標に変換して返す
        return projectedPoints.map((pt, index) => {
            const worldPt = new SVG.Point(pt.x, pt.y).transform(m);
            return {
                x: worldPt.x,
                y: worldPt.y,
                index: index,
                id: elId
            };
        });
    },

    /**
     * コネクタを表示すべき要素かどうかを判定します。
     */
    shouldShowConnectorsFor(el, excludeEl) {
        if (!el) return false;
        // SVG.js インスタンスであることを保証
        el = SVG(el);
        const node = el.node;
        if (!node) return false;

        const elId = el.id() || 'no-id';

        // 1. ラッパーまたはノード自体、あるいはその親コンテナが除外対象かチェック
        // excludeElが指定されている場合、excludeEl自身とその祖先要素（グループ等）の両方に対してコネクタを表示させない
        if (excludeEl) {
            let currentExclude = excludeEl;
            if (currentExclude.node) {
                if (el.node === currentExclude.node || el.node.contains(currentExclude.node)) {
                    if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: matches or contained in excludeEl`);
                    return false;
                }
            }
        }

        // 2. タグ名による除外 (大文字小文字無視)
        const tagName = node.tagName.toLowerCase();
        const excludedTags = [
            'defs', 'style', 'marker', 'symbol', 'metadata', 'script', 'title', 'desc',
            'svg', 'foreignobject', 'polyline', 'line', 'text', 'tspan', 'connector-data',
            'clippath', 'filter', 'lineargradient', 'radialgradient', 'fegaussianblur', 'fe-gaussian-blur'
        ];
        if (excludedTags.includes(tagName)) {
            if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: tagName "${tagName}" in excludedTags`);
            return false;
        }

        // ▼▼▼ 追加: 極端に巨大なパス（アウトライン化フォントなど）はスナップ計算から完全に除外してフリーズ防止 ▼▼▼
        if (tagName === 'path') {
            const d = el.attr('d') || '';
            if (d.length > 100000) {
                if (this.debug || d.length > 150000) {
                    console.log(`[SVG Connector] Path excluded completely: d.length = ${d.length} (> 100000) on #${elId}`);
                }
                return false;
            }
        }
        // ▲▲▲ 追加ここまで ▲▲▲

        // 3. クラス名による除外 (UI/ハンドル/ツール関連を徹底排除)
        const classStr = (el.attr('class') || '').toLowerCase();
        const excludedKeywords = ['handle', 'hitarea', 'select', 'overlay', 'interaction', 'proxy', 'grid', 'border', 'canvas'];
        if (excludedKeywords.some(key => classStr.includes(key))) {
            if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: class contains excluded keyword. class="${classStr}"`);
            return false;
        }

        // 4. 親要素による除外 (ツール用グループの配下にある要素を除外)
        let parent = el.parent();
        while (parent && parent.type !== 'svg') {
            const pClass = (parent.attr('class') || '').toLowerCase();
            if (excludedKeywords.some(key => pClass.includes(key))) {
                if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: parent class contains excluded keyword. parent class="${pClass}"`);
                return false;
            }

            // [FIX] 親がグループ(g)の場合、その親が代表してコネクタを持つべきなので子は除外する
            // これにより、グループ化されたオブジェクト（カスタムツール等）は外枠にのみコネクタが表示される
            if (parent.node.tagName.toLowerCase() === 'g') {
                if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: parent is group (g), parent is representative`);
                return false;
            }

            parent = parent.parent();
        }

        // 5. 属性による除外
        if (el.attr('data-is-canvas') === 'true' || el.attr('data-is-proxy') === 'true' || el.attr('data-no-connector') === 'true') {
            if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: data-is-canvas/proxy/no-connector is true`);
            return false;
        }

        // 6. 線タイプ(line, arrow, polyline_arrow, freehand, airbrush)の除外
        const toolId = el.attr('data-tool-id');
        if (['line', 'arrow', 'polyline_arrow', 'freehand', 'airbrush'].includes(toolId)) {
            if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: line/arrow tool type`);
            return false;
        }

        // [FIX] グループ要素(g)の除外について
        if (tagName === 'g') {
            // SVG.jsの選択枠（8点ハンドルなど）を含むUIグループは除外
            if (el.node.querySelector('[class*="svg_select_"]')) {
                if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: group has selection UI`);
                return false;
            }

            const children = el.children();
            const hasLine = children.some(c => ['polyline', 'line'].includes(c.type));
            const hasShape = children.some(c => ['rect', 'circle', 'ellipse', 'path', 'polygon', 'image', 'text'].includes(c.type));

            // 線を持ち、かつ他の主要な形状を持たない場合は除外
            // (矢印などは g > polyline + marker なのでここに含まれる)
            if (hasLine && !hasShape) {
                if (this.debug) console.log(`[SVG Connector] Excluded #${elId}: group contains line but no shapes`);
                return false;
            }
        }

        if (this.debug) console.log(`[SVG Connector] ALLOWED connectors for: <${tagName}>#${elId}`);
        return true;
    },

    /**
     * すべての図形のコネクタポイントを表示します（ドラッグ中用）
     */
    showAllConnectors(draw, excludeEl = null) {
        // console.log('[SVG Connector] showAllConnectors starting... exclude:', excludeEl ? excludeEl.id() : 'none');
        this.hideAllConnectors(draw);
        const group = draw.group().addClass('svg-connector-overlay').attr('pointer-events', 'none');

        // draw.find('*') を使用して再帰的にすべての要素をチェック
        draw.find('*').each((el) => {
            if (this.shouldShowConnectorsFor(el, excludeEl)) {
                // デバッグ用ログ出力を削減（必要な場合のみ有効化）
                // console.log(`[SVG Connector] Rendering points for: ${el.node.tagName}#${el.id()}`);
                const points = this.getConnectorPoints(el);
                points.forEach(p => {
                    const c = group.circle(8)
                        .center(p.x, p.y)
                        .fill('#0366d6')
                        .stroke({ color: '#fff', width: 1.5 })
                        .opacity(0.8);

                    // [NEW] ズームレベルに関わらず見た目の大きさを一定に保つ
                    if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                        window.SVGUtils.updateHandleScaling(c);
                    }
                });
            }
        });
    },

    hideAllConnectors(draw) {
        draw.find('.svg-connector-overlay').remove();
    },

    /**
     * すべての対象図形のコネクタポイントを事前に計算してキャッシュします。
     */
    cacheConnectorPoints(draw, excludeEl = null) {
        const cache = [];
        draw.find('*').each((el) => {
            if (this.shouldShowConnectorsFor(el, excludeEl)) {
                cache.push({
                    id: el.id(),
                    el: el,
                    points: this.getConnectorPoints(el)
                });
            }
        });
        return cache;
    },

    /**
     * 現在のマウス座標（ワールド座標）から、一定距離内にある図形のコネクタポイントのみを表示します。
     */
    updateConnectorDisplay(draw, cache, mousePt, zoom = 100, excludeEl = null) {
        this.hideAllConnectors(draw);
        if (!cache || cache.length === 0) return;

        let group = draw.findOne('.svg-connector-overlay');
        if (!group) {
            group = draw.group().addClass('svg-connector-overlay').attr('pointer-events', 'none');
        }

        // 閾値をワールド座標系に換算 (画面上の 80px 程度)
        const threshold = 80 / (zoom / 100);
        // スナップ閾値もワールド座標系に換算 (画面上の 20px 程度)
        const snapThreshold = 20 / (zoom / 100);

        // 1. 全てのキャッシュポイントから、最も近いポイントを見つける
        let nearestPt = null;
        let minSnapDist = snapThreshold;

        cache.forEach(shape => {
            if (excludeEl) {
                if (shape.id === excludeEl.id()) return;
                if (excludeEl.node && shape.el && shape.el.node && (excludeEl.node === shape.el.node || excludeEl.node.contains(shape.el.node))) {
                    return;
                }
            }
            shape.points.forEach(p => {
                const dist = Math.hypot(p.x - mousePt.x, p.y - mousePt.y);
                if (dist < minSnapDist) {
                    minSnapDist = dist;
                    nearestPt = p;
                }
            });
        });

        // 2. 描画処理
        cache.forEach(shape => {
            if (excludeEl) {
                if (shape.id === excludeEl.id()) return;
                if (excludeEl.node && shape.el && shape.el.node && (excludeEl.node === shape.el.node || excludeEl.node.contains(shape.el.node))) {
                    return;
                }
            }

            // 各接続ポイントとの最小距離を求める
            let minDistance = Infinity;
            shape.points.forEach(p => {
                const dist = Math.hypot(p.x - mousePt.x, p.y - mousePt.y);
                if (dist < minDistance) {
                    minDistance = dist;
                }
            });

            // 最小距離が閾値以下のとき、その図形のすべての接続ポイントを描画
            if (minDistance <= threshold) {
                shape.points.forEach(p => {
                    const isNearest = (nearestPt && nearestPt.id === p.id && nearestPt.index === p.index);
                    const size = isNearest ? 12 : 8;
                    const fill = isNearest ? '#ff3b30' : '#0366d6';
                    const opacity = isNearest ? 1.0 : 0.8;

                    const c = group.circle(size)
                        .center(p.x, p.y)
                        .fill(fill)
                        .stroke({ color: '#fff', width: 1.5 })
                        .opacity(opacity);

                    if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                        window.SVGUtils.updateHandleScaling(c, zoom);
                    }
                });
            }
        });
    },

    /**
     * 最も近いコネクタポイントを検索します。
     */
    findNearestConnector(draw, pt, threshold = 20, excludeEl = null) {
        let nearest = null;
        let minDist = threshold;

        // 全ての形状要素から検索
        draw.find('*').each((el) => {
            if (this.shouldShowConnectorsFor(el, excludeEl)) {
                const points = this.getConnectorPoints(el);
                points.forEach(p => {
                    const dx = p.x - pt.x;
                    const dy = p.y - pt.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = p;
                    }
                });
            }
        });

        if (nearest) {
            console.log(`[SVG Connector] Found nearest: ${nearest.id} point[${nearest.index}]`);
            // Diagnostic: What is this element?
            const el = document.getElementById(nearest.id);
            if (el) {
                console.log(`[SVG Connector DEBUG] Nearest Element Details: tag=${el.tagName}, class=${el.getAttribute('class')}, parent=${el.parentNode ? el.parentNode.tagName + '#' + el.parentNode.id : 'null'}`);
            }
        }
        return nearest;
    },

    /**
     * 接続情報を保存します。
     */
    connect(line, endType, targetId, pointIndex) {
        let connectData = [];
        const existingData = line.attr('data-connections');
        if (existingData) {
            try {
                connectData = JSON.parse(existingData);
            } catch (e) { }
        }

        // [NEW] Strict Guard: Prevent both ends of the same line from connecting to the exact same point
        // or to different points that are visually at the same location.
        const otherEndType = (endType === 'start') ? 'end' : 'start';
        const otherConn = connectData.find(c => c.endType === otherEndType);

        if (otherConn) {
            // 1. Same point check (ID and Index)
            if (otherConn.targetId === targetId && otherConn.pointIndex === pointIndex) {
                console.warn(`[SVG Connector] Blocked connect to SAME point for ${line.id()}(${endType}) -> ${targetId}[${pointIndex}]`);
                return false;
            }

            // 2. Proximity check (World coordinates)
            const draw = line.root();
            const targetEl = draw.findOne('#' + targetId);
            const otherEl = draw.findOne('#' + otherConn.targetId);

            if (targetEl && otherEl) {
                const targetPoints = this.getConnectorPoints(targetEl);
                const otherPoints = this.getConnectorPoints(otherEl);
                const p1 = targetPoints[pointIndex];
                const p2 = otherPoints[otherConn.pointIndex];

                if (p1 && p2) {
                    const distSq = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                    if (distSq < 1e-4) { // Practically same location
                        console.warn(`[SVG Connector] Blocked connect to overlapping point for ${line.id()}(${endType})`);
                        return false;
                    }
                }
            }
        }

        console.log(`[SVG Connector] Connect request: ${line.id()} (${endType}) -> ${targetId}[${pointIndex}]`);

        // 既存の同じ端点の接続を書き換え
        connectData = connectData.filter(c => c.endType !== endType);
        connectData.push({ endType, targetId, pointIndex });

        line.attr('data-connections', JSON.stringify(connectData));

        // 接続先が必要なIDを持っているか確認し、なければ強制付与
        const draw = line.root();
        const target = draw.findOne('#' + targetId);
        if (target && !target.node.hasAttribute('id')) {
            console.warn(`[SVG Connector] Target element missing ID attribute, forcing: ${targetId}`);
            target.attr('id', targetId);
        }

        this.syncConnectorMetadata(line, connectData);
        return true;
    },

    disconnect(line, endType) {
        const existingData = line.attr('data-connections');
        if (!existingData) return;

        try {
            let connectData = JSON.parse(existingData);
            const originalLen = connectData.length;
            connectData = connectData.filter(c => c.endType !== endType);

            if (connectData.length !== originalLen) {
                console.log(`[SVG Connector] Disconnected ${line.id()} (${endType})`);
                if (connectData.length > 0) {
                    line.attr('data-connections', JSON.stringify(connectData));
                } else {
                    line.attr('data-connections', null);
                }
                this.syncConnectorMetadata(line, connectData);
            }
        } catch (e) { }
    },

    /**
     * SVG独自要素として接続情報を同期します。
     */
    syncConnectorMetadata(el, data) {
        const node = el.node;
        const existing = node.querySelectorAll('connector-data');
        existing.forEach(n => n.remove());

        if (data && data.length > 0) {
            data.forEach(c => {
                const meta = document.createElementNS('http://www.w3.org/2000/svg', 'connector-data');
                meta.setAttribute('end', c.endType);
                meta.setAttribute('target', c.targetId);
                meta.setAttribute('index', c.pointIndex);
                node.appendChild(meta);
            });
        }
    },

    /**
     * data-poly-points 属性から座標配列を取得します。
     */
    getPolyPoints(el) {
        const pointsStr = el.attr('data-poly-points') || el.attr('points') || "";
        const parts = pointsStr.split(/\s+/).filter(s => s !== "");
        const pts = [];

        parts.forEach(p => {
            const isM = p.startsWith('M');
            // Extract all numbers from this part (handling signs and scientific notation)
            const nums = (isM ? p.substring(1) : p).match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
            if (nums && nums.length >= 2) {
                const x = Number(nums[0]);
                const y = Number(nums[1]);
                if (!isNaN(x) && !isNaN(y)) {
                    pts.push([x, y, isM]);
                }
            }
        });

        // [NEW] Debug Log for Verification
        const hasM = pts.some(p => p[2]);
        if (pts.length > 0) {
            console.log(`[SVG Connector] getPolyPoints for ${el.id()}: Parsed ${pts.length} points (M-flag: ${hasM})`);
        }

        // [FIX] For lines/arrows, ensure we have AT LEAST 2 points so that
        // start and end connection points exist. We should NOT prune points
        // because users can add vertices to lines and arrows to bend them.
        const toolId = el.attr('data-tool-id');
        const isLineType = (el.type === 'line' || el.type === 'polyline' || (el.type === 'path' && (toolId === 'line' || toolId === 'arrow')));

        if (isLineType) {
            while (pts.length < 2) pts.push([0, 0, pts.length === 0]);
        }

        return pts;
    },

    /**
     * data-bez-points 属性からベジェデータを取得します。
     */
    getBezData(el) {
        try {
            const bezStr = el.attr('data-bez-points');
            if (bezStr) return JSON.parse(bezStr);
        } catch (e) { }
        return [];
    },

    /**
     * 座標とベジェデータからパスの d 属性を再生成します。
     * SvgPolylineHandler.generatePath とロジックを同期させています。
     */
    generatePath(line, points, bezData) {
        if (line.type !== 'path') return;
        if (points.length === 0) return;

        let d = `M ${points[0][0]} ${points[0][1]} `;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
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
        line.attr('d', d);
    },

    /**
     * 線自体が持っている接続情報（data-connections）に基づき、
     * 接続先図形の現在の位置に合わせて線の端点を更新します。
     */
    updateLineConnections(line) {
        if (!line) return false;
        line = SVG(line);
        if (!line || typeof line.attr !== 'function') return false;

        const connectDataAttr = line.attr('data-connections');
        if (!connectDataAttr) return false;

        try {
            const connectData = JSON.parse(connectDataAttr);
            const points = this.getPolyPoints(line);
            const bezData = this.getBezData(line);
            let changed = false;
            const draw = line.root();
            const isPath = (line.type === 'path');

            connectData.forEach(conn => {
                const target = draw.findOne('#' + conn.targetId);
                if (target) {
                    const targetPoints = this.getConnectorPoints(target);
                    const p = targetPoints[conn.pointIndex];
                    if (p) {
                        if (points.length === 0) return;
                        const idx = (conn.endType === 'start') ? 0 : Math.max(0, points.length - 1);
                        const pt = points[idx];

                        // ターゲットのルート座標(p: ユーザー単位)を、線の現在のローカル座標系に変換
                        const rootNode = line.root().node;
                        const mLine = rootNode.getScreenCTM().inverse().multiply(line.node.getScreenCTM());
                        const mInv = mLine.inverse();

                        const worldPoint = new SVG.Point(p.x, p.y);
                        const localPt = worldPoint.transform(mInv);

                        const oldX = pt[0];
                        const oldY = pt[1];

                        if (Math.abs(oldX - localPt.x) > 0.1 || Math.abs(oldY - localPt.y) > 0.1) {
                            // [FIX] NaN Guard: If calculation failed, skip syncing this time
                            if (isNaN(localPt.x) || isNaN(localPt.y)) {
                                console.warn(`[SVG Connector] Sync skipped for ${line.id()} due to NaN coordinates.`);
                                return;
                            }

                            // [FIX] Bound check for points array
                            if (idx < 0 || idx >= points.length) {
                                console.warn(`[SVG Connector] Sync skipped for ${line.id()}: Index ${idx} out of range (${points.length})`);
                                return;
                            }

                            console.log(`[SVG Connector Debug] Syncing ${line.id()}(${conn.endType}) -> target(${conn.targetId})@idx(${conn.pointIndex})`);
                            console.log(`      Target(World): (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
                            console.log(`      Local Move: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) -> (${localPt.x.toFixed(1)}, ${localPt.y.toFixed(1)})`);

                            // 頂点の移動差分を計算（ベジェハンドルの並行移動用）
                            const dx = localPt.x - oldX;
                            const dy = localPt.y - oldY;

                            // 頂点座標の更新
                            points[idx] = [localPt.x, localPt.y];

                            // ベジェ制御点の同期移動（パスの場合のみ）
                            if (isPath) {
                                const bz = bezData[idx];
                                if (bz && bz.type > 0) {
                                    if (bz.cpIn) bz.cpIn = [bz.cpIn[0] + dx, bz.cpIn[1] + dy];
                                    if (bz.cpOut) bz.cpOut = [bz.cpOut[0] + dx, bz.cpOut[1] + dy];
                                }
                            }
                            changed = true;
                        }
                    }
                }
            });

            if (changed) {
                const pointsStr = points.map(p => (p[2] ? 'M' : '') + p[0] + ',' + p[1]).join(' ');
                line.attr('data-poly-points', pointsStr);

                if (isPath) {
                    line.attr('data-bez-points', JSON.stringify(bezData));
                    this.generatePath(line, points, bezData);
                } else if (line.type === 'polyline') {
                    line.attr('points', pointsStr);
                } else if (line.type === 'line') {
                    line.attr({ x1: points[0][0], y1: points[0][1], x2: points[1][0], y2: points[1][1] });
                }
                return true;
            }
        } catch (e) {
            console.error('[SVG Connector] updateLineConnections error:', e);
        }
        return false;
    },


    /**
     * 要素（形状または線）が移動・変形した際、関連するすべての接続を更新します。
     * [FIX] グループやコンテナが移動した場合、その子孫要素に対する接続も更新します。
     */
    updateConnectionsFromElement(el) {
        if (!el) return;
        // SVG.js インスタンスであることを保証
        el = SVG(el);
        if (!el || typeof el.root !== 'function' || !el.node) return;

        const draw = el.root();
        if (!draw) return;

        const tagName = el.node.tagName.toLowerCase();

        // 1. el 自体が線の場合、自身の接続（どこかに刺さっている端点）を更新
        if (tagName === 'polyline' || tagName === 'line' || tagName === 'path') {
            this.updateLineConnections(el);
        }

        // 2. 更新対象となるターゲットIDのリストを作成 (一応残すが、メインロジックでは使わない)
        const targetIds = new Set();
        if (el.id()) targetIds.add(el.id());

        /*
        // コンテナ要素なら子孫を検索
        if (['g', 'svg', 'a', 'symbol', 'defs'].includes(tagName)) {
            const children = el.node.querySelectorAll('*');
            children.forEach(child => {
                if (child.id) {
                    targetIds.add(child.id);
                }
            });
        }
        */

        // console.log(`[SVG Connector] updateConnectionsFromElement targets=`, Array.from(targetIds));

        let updatedLinesCount = 0;

        // [FIX] Unify logic: loop over lines/paths and call updateLineConnections
        draw.find('polyline, line, path').each(line => {
            if (this.updateLineConnections(line)) {
                updatedLinesCount++;

                // UIハンドラ（頂点ハンドル）が表示されている場合は再描画
                if (window.currentEditingSVG && window.currentEditingSVG.polylineHandler) {
                    if (window.currentEditingSVG.polylineHandler.activeNode === line.node) {
                        window.currentEditingSVG.polylineHandler.update(null, line.node, null);
                    }
                }
            }
        });

        if (updatedLinesCount > 0) {
            console.log(`[SVG Connector] Successfully updated ${updatedLinesCount} line points connected to moved element(s)`);
        }
    },

    // =========================================================================
    // 輪郭投影ヘルパーメソッド
    // =========================================================================

    /**
     * グループ内の背景図形（最初の非テキスト・非メタデータ要素）を検索します。
     */
    _findBackgroundShape(groupEl) {
        const node = groupEl.node || groupEl;
        if (!node || !node.children) return null;

        const allowedTags = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'image', 'g'];
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            const tag = children[i].tagName.toLowerCase();
            if (allowedTags.includes(tag)) {
                if (tag === 'g') {
                    // gの場合はさらにその中を再帰的に検索
                    const subShape = this._findBackgroundShape(children[i]);
                    if (subShape) return subShape;
                } else {
                    return children[i];
                }
            }
        }
        return null;
    },

    /**
     * BBox上のポイントを図形の輪郭上に投影します。
     * 図形タイプに応じて最適な投影方法を選択します。
     */
    _projectPointsToOutline(el, bboxPoints, bbox) {
        try {
            const tagName = el.node.tagName.toLowerCase();

            // rect / image → BBoxがそのまま輪郭
            if (tagName === 'rect' || tagName === 'image') {
                return bboxPoints;
            }

            // ellipse / circle → 楕円方程式による解析的計算
            if (tagName === 'ellipse' || tagName === 'circle') {
                return this._projectToEllipse(bboxPoints, el, bbox);
            }

            // polygon → 頂点間の線分交差判定
            if (tagName === 'polygon') {
                return this._projectToPolygonVertices(bboxPoints, el, bbox);
            }

            // path → SVGネイティブAPIでサンプリング + 線分交差判定
            if (tagName === 'path') {
                const d = el.attr('d') || '';
                // 10000文字を超える複雑なパスの場合、重いサンプリングを避けてBBoxフォールバックを返すことでフリーズを防ぐ
                if (d.length > 10000) {
                    if (this.debug) {
                        console.log(`[SVG Connector] Path outline projection skipped (d.length = ${d.length} > 10000) for #${el.id()}. Falling back to BBox.`);
                    }
                    return bboxPoints;
                }
                return this._projectToPathOutline(bboxPoints, el, bbox);
            }
        } catch (e) {
            console.warn('[SVG Connector] _projectPointsToOutline error:', e);
        }
        return bboxPoints; // フォールバック
    },

    /**
     * 楕円/円の輪郭に投影します（解析的計算、O(1)）。
     * 楕円方程式: ((x-cx)/rx)² + ((y-cy)/ry)² = 1 との交点を求めます。
     */
    _projectToEllipse(bboxPoints, el, bbox) {
        const tagName = el.node.tagName.toLowerCase();
        const centerX = bbox.x + bbox.w / 2;
        const centerY = bbox.y + bbox.h / 2;
        let cx, cy, rx, ry;

        if (tagName === 'circle') {
            cx = parseFloat(el.attr('cx')) || centerX;
            cy = parseFloat(el.attr('cy')) || centerY;
            rx = ry = parseFloat(el.attr('r')) || 1;
        } else {
            cx = parseFloat(el.attr('cx')) || centerX;
            cy = parseFloat(el.attr('cy')) || centerY;
            rx = parseFloat(el.attr('rx')) || 1;
            ry = parseFloat(el.attr('ry')) || 1;
        }

        return bboxPoints.map(pt => {
            const dx = pt.x - cx;
            const dy = pt.y - cy;
            // 中心と一致する場合はフォールバック
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return pt;

            // t = 1 / sqrt((dx/rx)² + (dy/ry)²) で楕円上の交点を算出
            const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
            return {
                x: cx + dx * t,
                y: cy + dy * t
            };
        });
    },

    /**
     * ポリゴンの輪郭に投影します（頂点間の線分交差判定）。
     */
    _projectToPolygonVertices(bboxPoints, el, bbox) {
        const pointsAttr = el.attr('points');
        if (!pointsAttr) return bboxPoints;

        // points属性を解析して頂点配列を構築
        const vertices = [];
        const parts = String(pointsAttr).trim().split(/[\s,]+/);
        for (let i = 0; i < parts.length - 1; i += 2) {
            const px = parseFloat(parts[i]);
            const py = parseFloat(parts[i + 1]);
            if (!isNaN(px) && !isNaN(py)) {
                vertices.push({ x: px, y: py });
            }
        }
        if (vertices.length < 3) return bboxPoints;

        // 閉じたポリゴンの辺セグメントを構築
        const segments = [];
        for (let i = 0; i < vertices.length; i++) {
            segments.push([vertices[i], vertices[(i + 1) % vertices.length]]);
        }

        const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
        return this._projectToSegments(bboxPoints, segments, center);
    },

    /**
     * パスの輪郭に投影します（SVGネイティブAPIでサンプリング → 線分交差判定）。
     * getPointAtLength() でパスをN点にサンプリングし、近似ポリゴンとして交差判定を行います。
     */
    _projectToPathOutline(bboxPoints, el, bbox) {
        const node = el.node;
        if (!node || typeof node.getTotalLength !== 'function') return bboxPoints;

        let totalLength;
        try {
            totalLength = node.getTotalLength();
        } catch (e) {
            return bboxPoints;
        }
        if (totalLength <= 0) return bboxPoints;

        // パスをN点でサンプリングして近似セグメントを構築
        const N = 100;
        const samples = [];
        for (let i = 0; i <= N; i++) {
            try {
                const pt = node.getPointAtLength((i / N) * totalLength);
                samples.push({ x: pt.x, y: pt.y });
            } catch (e) {
                break;
            }
        }
        if (samples.length < 2) return bboxPoints;

        // サンプル点間のセグメントを構築（最初と最後を閉じる）
        const segments = [];
        for (let i = 0; i < samples.length - 1; i++) {
            segments.push([samples[i], samples[i + 1]]);
        }

        const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
        return this._projectToSegments(bboxPoints, segments, center);
    },

    /**
     * 線分群との交点を求めて投影します（polygon / path 共通ロジック）。
     * 中心からBBoxポイント方向へのレイと各セグメントの交点を求め、最も近い交点を採用します。
     */
    _projectToSegments(bboxPoints, segments, center) {
        return bboxPoints.map(pt => {
            const dx = pt.x - center.x;
            const dy = pt.y - center.y;
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return pt;

            let closestPt = null;
            let closestDist = Infinity;

            for (const [a, b] of segments) {
                const intersection = this._raySegmentIntersect(center, dx, dy, a, b);
                if (intersection) {
                    const dist = Math.hypot(intersection.x - center.x, intersection.y - center.y);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestPt = intersection;
                    }
                }
            }

            return closestPt || pt; // 交点が見つからない場合はBBoxポイントをフォールバック
        });
    },

    /**
     * レイ（origin から方向 (dx, dy) への半直線）と線分（A-B）の交点を求めます。
     * @param {Object} origin - レイの始点 {x, y}
     * @param {number} dx - レイの方向ベクトルX成分
     * @param {number} dy - レイの方向ベクトルY成分
     * @param {Object} a - 線分の始点 {x, y}
     * @param {Object} b - 線分の終点 {x, y}
     * @returns {Object|null} 交点座標 {x, y} または null
     */
    _raySegmentIntersect(origin, dx, dy, a, b) {
        const ex = b.x - a.x;
        const ey = b.y - a.y;

        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-10) return null; // 平行

        const fx = a.x - origin.x;
        const fy = a.y - origin.y;

        const t = (fx * ey - fy * ex) / denom; // レイ上のパラメータ
        const u = (fx * dy - fy * dx) / denom; // セグメント上のパラメータ

        // t >= 0（レイの正方向）かつ 0 <= u <= 1（セグメント上）
        if (t >= 0 && u >= -1e-10 && u <= 1 + 1e-10) {
            return {
                x: origin.x + t * dx,
                y: origin.y + t * dy
            };
        }
        return null;
    }
};

window.SVGConnectorManager = SVGConnectorManager;
