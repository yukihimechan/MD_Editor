/**
 * SVG Connector Manager
 * 図形のコネクタポイントの管理、表示、吸着、追従ロジックを担当します。
 */
const SVGConnectorManager = {
    /**
     * 要素の16個のコネクタポイントを絶対座標（SVGルート座標系）で計算します。
     */
    getConnectorPoints(el) {
        if (!el) return [];
        // SVG.js インスタンスであることを保証
        el = SVG(el);
        if (!el || typeof el.bbox !== 'function') return [];

        // [FIX] ctm() ではなく getScreenCTM() を使用して、ルートSVGのユーザー座標系への行列を計算します。
        // これにより、SVG全体のズーム（viewBox）やパンの影響を正しく排除できます。
        const node = el.node;
        const root = el.root().node;
        const rootScreenCTM = root.getScreenCTM();
        const nodeScreenCTM = node.getScreenCTM();

        if (!rootScreenCTM || !nodeScreenCTM) return [];

        // ルートSVGのユーザー単位系への変換行列
        const m = rootScreenCTM.inverse().multiply(nodeScreenCTM);
        const bbox = el.bbox();

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

        return relativeOffsets.map((off, index) => {
            const localPt = new SVG.Point(x + w * off[0], y + h * off[1]);
            const worldPt = localPt.transform(m);
            return {
                x: worldPt.x,
                y: worldPt.y,
                index: index,
                id: el.id()
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

        // 1. ラッパーまたはノード自体、あるいはその親コンテナが除外対象かチェック
        // excludeElが指定されている場合、excludeEl自身とその祖先要素（グループ等）の両方に対してコネクタを表示させない
        if (excludeEl) {
            let currentExclude = excludeEl;
            if (currentExclude.node) {
                if (el.node === currentExclude.node || el.node.contains(currentExclude.node)) {
                    return false;
                }
            }
        }

        // 2. タグ名による除外 (大文字小文字無視)
        const tagName = node.tagName.toLowerCase();
        const excludedTags = [
            'defs', 'style', 'marker', 'symbol', 'metadata', 'script', 'title', 'desc',
            'svg', 'foreignobject', 'polyline', 'line', 'text', 'tspan', 'connector-data'
        ];
        if (excludedTags.includes(tagName)) return false;

        // ▼▼▼ 追加: 巨大なパス（アウトライン化フォントなど）はスナップ計算から除外してフリーズ防止 ▼▼▼
        if (tagName === 'path') {
            const d = el.attr('d') || '';
            if (d.length > 500) {
                return false;
            }
        }
        // ▲▲▲ 追加ここまで ▲▲▲

        // 3. クラス名による除外 (UI/ハンドル/ツール関連を徹底排除)
        const classStr = (el.attr('class') || '').toLowerCase();
        const excludedKeywords = ['handle', 'hitarea', 'select', 'overlay', 'interaction', 'proxy', 'grid'];
        if (excludedKeywords.some(key => classStr.includes(key))) return false;

        // 4. 親要素による除外 (ツール用グループの配下にある要素を除外)
        let parent = el.parent();
        while (parent && parent.type !== 'svg') {
            const pClass = (parent.attr('class') || '').toLowerCase();
            if (excludedKeywords.some(key => pClass.includes(key))) return false;

            // [FIX] 親がグループ(g)の場合、その親が代表してコネクタを持つべきなので子は除外する
            // これにより、グループ化されたオブジェクト（カスタムツール等）は外枠にのみコネクタが表示される
            if (parent.node.tagName.toLowerCase() === 'g') {
                return false;
            }

            parent = parent.parent();
        }

        // 5. 属性による除外
        if (el.attr('data-is-canvas') === 'true' || el.attr('data-is-proxy') === 'true' || el.attr('data-no-connector') === 'true') return false;

        // [FIX] グループ要素(g)の除外について
        if (tagName === 'g') {
            // SVG.jsの選択枠（8点ハンドルなど）を含むUIグループは除外
            if (el.node.querySelector('[class*="svg_select_"]')) {
                return false;
            }

            const children = el.children();
            const hasLine = children.some(c => ['polyline', 'line'].includes(c.type));
            const hasShape = children.some(c => ['rect', 'circle', 'ellipse', 'path', 'polygon', 'image', 'text'].includes(c.type));

            // 線を持ち、かつ他の主要な形状を持たない場合は除外
            // (矢印などは g > polyline + marker なのでここに含まれる)
            if (hasLine && !hasShape) {
                return false;
            }
        }

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
    }
};

window.SVGConnectorManager = SVGConnectorManager;
