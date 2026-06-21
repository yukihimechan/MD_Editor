/**
 * SVG Orthogonal Router
 * 水平・垂直セグメントのみで障害物を自動迂回する直交経路探索エンジン。
 */
const OrthogonalRouter = {
    config: {
        margin: 15,            // 障害物BBoxの膨張マージン (px)
        maxIterations: 2000,   // A* の最大反復回数
        bendPenalty: 150,      // 屈折1回あたりのペナルティ (移動コスト換算px)
    },

    /**
     * 始点から終点への直交経路を計算する
     * @param {Object} start - 始点 {x, y}
     * @param {Object} end - 終点 {x, y}
     * @param {Array} obstacles - 障害物BBox配列（膨張前）
     * @param {Object} options
     * @returns {Array<Object>} 頂点リスト [{x, y}, ...]
     */
    findOrthogonalRoute(start, end, obstacles, options = {}) {
        const margin = options.margin !== undefined ? options.margin : this.config.margin;
        const bendPenalty = options.bendPenalty !== undefined ? options.bendPenalty : this.config.bendPenalty;

        // 1. 障害物を膨張させる
        const inflatedObstacles = obstacles.map(obs => {
            if (window.SVGAutoRouter && typeof window.SVGAutoRouter.inflateBBox === 'function') {
                return window.SVGAutoRouter.inflateBBox(obs, margin);
            }
            // 自前実装フォールバック
            return {
                x: obs.x - margin,
                y: obs.y - margin,
                w: obs.w + margin * 2,
                h: obs.h + margin * 2,
                x2: obs.x + obs.w + margin,
                y2: obs.y + obs.h + margin
            };
        });

        // 2. 単純なL字経路（H→V または V→H）で障害物に衝突しないか試す
        const p1 = { x: end.x, y: start.y }; // H→V の折れ点
        const p2 = { x: start.x, y: end.y }; // V→H の折れ点

        const hasObstacle = (pt1, pt2) => {
            if (window.SVGAutoRouter && typeof window.SVGAutoRouter.hasObstacleOnPath === 'function') {
                return window.SVGAutoRouter.hasObstacleOnPath(pt1, pt2, inflatedObstacles, start, end);
            }
            // フォールバック
            return false; 
        };

        // H->V 判定
        if (!hasObstacle(start, p1) && !hasObstacle(p1, end)) {
            return [start, p1, end];
        }
        // V->H 判定
        if (!hasObstacle(start, p2) && !hasObstacle(p2, end)) {
            return [start, p2, end];
        }

        // 3. 障害物と衝突するため、グラフを構築して A* 探索を行う
        const graph = this._buildOrthogonalGraph(start, end, inflatedObstacles);
        if (!graph || graph.nodes.length === 0) {
            // グラフ構築失敗時は単純L字（フォールバック）を返す
            return [start, p1, end];
        }

        const route = this._aStarOrthogonal(graph, start, end, bendPenalty);
        if (route && route.length > 0) {
            return this._simplifyRoute(route);
        }

        // 探索失敗時も単純L字を返す
        return [start, p1, end];
    },

    /**
     * スタブ（引き出し線）を考慮した経路探索
     * 接続先図形を回避するために、まず法線方向にスタブを引き出してからA*探索を行う
     * @param {Object} startConn - 始点の接続情報（getConnectorPointsの戻り値） null可
     * @param {Object} endConn - 終点の接続情報 null可
     * @param {Object} startWorld - 始点座標
     * @param {Object} endWorld - 終点座標
     * @param {Array} obstacles - 障害物配列
     * @param {Object} options - オプション
     */
    routeWithStubs(startConn, endConn, startWorld, endWorld, obstacles, options = {}) {
        const margin = options.margin !== undefined ? options.margin : this.config.margin;
        let p1 = startWorld;
        let p2 = endWorld;
        const routeStart = [startWorld];
        const routeEnd = [endWorld];

        // 仮想的なコネクタ情報を生成（ポイントが障害物内部にある場合）
        const createPseudoConnector = (pt) => {
            const eps = 2.0;
            for (const obs of obstacles) {
                if (pt.x >= obs.x - eps && pt.x <= obs.x2 + eps && pt.y >= obs.y - eps && pt.y <= obs.y2 + eps) {
                    // 中心からのベクトルで法線を近似
                    const cx = obs.x + obs.w / 2;
                    const cy = obs.y + obs.h / 2;
                    let nx = 0, ny = 0;
                    if (Math.abs(pt.x - cx) > Math.abs(pt.y - cy)) {
                        nx = pt.x > cx ? 1 : -1;
                    } else {
                        ny = pt.y > cy ? 1 : -1;
                    }
                    return { nx, ny, bboxWidth: obs.w, bboxHeight: obs.h };
                }
            }
            return null;
        };

        const effStartConn = startConn || createPseudoConnector(startWorld);
        const effEndConn = endConn || createPseudoConnector(endWorld);

        const getStub = (conn, pt) => {
            if (!conn) return null;
            // 指定された引き出し長：(w+h)/2 * 0.1 だが、最低20pxを確保（マージンが15pxのため、障害物外へ確実に出す）
            const stubLen = Math.max(20, (conn.bboxWidth + conn.bboxHeight) / 2 * 0.1);
            
            // 法線を直交軸にスナップ（形状が回転している場合でも直交ルートを維持するため）
            let ox = 0, oy = 0;
            if (Math.abs(conn.nx) > Math.abs(conn.ny)) {
                ox = conn.nx > 0 ? 1 : -1;
            } else {
                oy = conn.ny > 0 ? 1 : -1;
            }
            return {
                x: pt.x + ox * stubLen,
                y: pt.y + oy * stubLen
            };
        };

        const stub1 = getStub(effStartConn, startWorld);
        const stub2 = getStub(effEndConn, endWorld);

        if (stub1) {
            p1 = stub1;
            routeStart.push(stub1);
        }
        if (stub2) {
            p2 = stub2;
            routeEnd.unshift(stub2);
        }

        const route = this.findOrthogonalRoute(p1, p2, obstacles, options);

        if (!route) {
            // A*が失敗した場合は、スタブを含めた単純なL字や直線をフォールバックとして返す
            return this.recalculateRoute([...routeStart, { x: p1.x, y: p2.y }, ...routeEnd]);
        }

        // ルートの結合（重複点の排除）
        const finalRoute = [...routeStart];
        const eps = 1e-1;
        for (let i = 0; i < route.length; i++) {
            // 先頭や末尾がスタブの端点と完全に一致する場合はスキップ（重複を防ぐため）
            if (i === 0 && stub1 && Math.abs(route[i].x - stub1.x) < eps && Math.abs(route[i].y - stub1.y) < eps) continue;
            if (i === route.length - 1 && stub2 && Math.abs(route[i].x - stub2.x) < eps && Math.abs(route[i].y - stub2.y) < eps) continue;
            finalRoute.push(route[i]);
        }
        finalRoute.push(...routeEnd);

        return this.recalculateRoute(finalRoute);
    },

    /**
     * 直交グラフの構築
     */
    _buildOrthogonalGraph(start, end, obstacles) {
        // X/Y座標の候補値を収集
        const xs = new Set([start.x, end.x]);
        const ys = new Set([start.y, end.y]);

        obstacles.forEach(obs => {
            xs.add(obs.x);
            xs.add(obs.x2);
            ys.add(obs.y);
            ys.add(obs.y2);
        });

        const sortedX = Array.from(xs).sort((a, b) => a - b);
        const sortedY = Array.from(ys).sort((a, b) => a - b);

        // ノードの生成（障害物の完全内部にある交点は除外）
        const nodes = [];
        const isPointInsideObstacle = (p) => {
            if (window.SVGAutoRouter && typeof window.SVGAutoRouter.isPointInsideRect === 'function') {
                for (const obs of obstacles) {
                    if (window.SVGAutoRouter.isPointInsideRect(p, obs)) {
                        // 始点・終点は例外的に許可
                        const eps = 1e-5;
                        const isStart = Math.abs(p.x - start.x) < eps && Math.abs(p.y - start.y) < eps;
                        const isEnd = Math.abs(p.x - end.x) < eps && Math.abs(p.y - end.y) < eps;
                        if (!isStart && !isEnd) return true;
                    }
                }
            }
            return false;
        };

        // ノードの登録とマップ作成
        const nodeMap = new Map(); // "x,y" -> nodeIndex
        sortedX.forEach(x => {
            sortedY.forEach(y => {
                const p = { x, y };
                if (!isPointInsideObstacle(p)) {
                    nodes.push(p);
                    nodeMap.set(`${x},${y}`, nodes.length - 1);
                }
            });
        });

        // 始点・終点がノードにない（微小な誤差などで漏れた）場合に強制追加
        const ensureNode = (pt) => {
            const key = `${pt.x},${pt.y}`;
            if (!nodeMap.has(key)) {
                nodes.push(pt);
                nodeMap.set(key, nodes.length - 1);
            }
            return nodeMap.get(key);
        };
        const startIdx = ensureNode(start);
        const endIdx = ensureNode(end);

        // エッジ（隣接リスト）の構築
        const adj = Array.from({ length: nodes.length }, () => []);

        const hasObstacle = (pt1, pt2) => {
            if (window.SVGAutoRouter && typeof window.SVGAutoRouter.hasObstacleOnPath === 'function') {
                return window.SVGAutoRouter.hasObstacleOnPath(pt1, pt2, obstacles, start, end);
            }
            return false;
        };

        // 水平エッジの作成（各Yライン上で、隣り合うX座標同士が直通できるか）
        sortedY.forEach(y => {
            const yNodes = []; // {x, idx}
            sortedX.forEach(x => {
                const key = `${x},${y}`;
                if (nodeMap.has(key)) {
                    yNodes.push({ x, idx: nodeMap.get(key) });
                }
            });
            for (let i = 0; i < yNodes.length - 1; i++) {
                const n1 = nodes[yNodes[i].idx];
                const n2 = nodes[yNodes[i+1].idx];
                if (!hasObstacle(n1, n2)) {
                    adj[yNodes[i].idx].push({ to: yNodes[i+1].idx, dist: n2.x - n1.x, dir: 'H' });
                    adj[yNodes[i+1].idx].push({ to: yNodes[i].idx, dist: n2.x - n1.x, dir: 'H' });
                }
            }
        });

        // 垂直エッジの作成（各Xライン上で、隣り合うY座標同士が直通できるか）
        sortedX.forEach(x => {
            const xNodes = []; // {y, idx}
            sortedY.forEach(y => {
                const key = `${x},${y}`;
                if (nodeMap.has(key)) {
                    xNodes.push({ y, idx: nodeMap.get(key) });
                }
            });
            for (let i = 0; i < xNodes.length - 1; i++) {
                const n1 = nodes[xNodes[i].idx];
                const n2 = nodes[xNodes[i+1].idx];
                if (!hasObstacle(n1, n2)) {
                    adj[xNodes[i].idx].push({ to: xNodes[i+1].idx, dist: n2.y - n1.y, dir: 'V' });
                    adj[xNodes[i+1].idx].push({ to: xNodes[i].idx, dist: n2.y - n1.y, dir: 'V' });
                }
            }
        });

        return { nodes, adj, startIdx, endIdx };
    },

    /**
     * A* 探索（方向と屈折ペナルティを考慮）
     */
    _aStarOrthogonal(graph, startPt, endPt, bendPenalty) {
        const { nodes, adj, startIdx, endIdx } = graph;
        const n = nodes.length;

        // 状態キー: nodeIndex + "_" + dir (dir: 'H', 'V', 'N')
        const getGScore = (idx, dir) => gScore.get(`${idx}_${dir}`) ?? Infinity;
        const setGScore = (idx, dir, val) => gScore.set(`${idx}_${dir}`, val);

        const gScore = new Map();
        const fScore = new Map();
        const cameFrom = new Map(); // "toIdx_toDir" -> { fromIdx, fromDir }

        // 初期化
        setGScore(startIdx, 'N', 0);
        fScore.set(`${startIdx}_N`, Math.abs(startPt.x - endPt.x) + Math.abs(startPt.y - endPt.y));

        const openSet = new Set([`${startIdx}_N`]);
        let iterations = 0;
        const maxIter = this.config.maxIterations;

        while (openSet.size > 0 && iterations < maxIter) {
            iterations++;

            // fScoreが最小の状態を取得
            let currentKey = null;
            let minF = Infinity;
            for (const key of openSet) {
                const val = fScore.get(key) ?? Infinity;
                if (val < minF) {
                    minF = val;
                    currentKey = key;
                }
            }

            if (!currentKey) break;

            const [currIdxStr, currDir] = currentKey.split('_');
            const currIdx = parseInt(currIdxStr, 10);

            // ゴール判定
            if (currIdx === endIdx) {
                // 経路復元
                const path = [];
                let cKey = currentKey;
                while (cKey) {
                    const [idxStr, dir] = cKey.split('_');
                    const idx = parseInt(idxStr, 10);
                    path.unshift(nodes[idx]);
                    const parent = cameFrom.get(cKey);
                    cKey = parent ? `${parent.fromIdx}_${parent.fromDir}` : null;
                }
                return path;
            }

            openSet.delete(currentKey);

            // 隣接ノードへの遷移
            const neighbors = adj[currIdx] || [];
            for (const edge of neighbors) {
                const nextIdx = edge.to;
                const nextDir = edge.dir;

                // 屈折ペナルティの計算
                let penalty = 0;
                if (currDir !== 'N' && currDir !== nextDir) {
                    penalty = bendPenalty;
                }

                const currG = getGScore(currIdx, currDir);
                const nextG = currG + edge.dist + penalty;

                const nextKey = `${nextIdx}_${nextDir}`;
                if (nextG < getGScore(nextIdx, nextDir)) {
                    cameFrom.set(nextKey, { fromIdx: currIdx, fromDir: currDir });
                    setGScore(nextIdx, nextDir, nextG);
                    
                    const h = Math.abs(nodes[nextIdx].x - endPt.x) + Math.abs(nodes[nextIdx].y - endPt.y);
                    fScore.set(nextKey, nextG + h);
                    openSet.add(nextKey);
                }
            }
        }

        console.log(`[OrthogonalLineTool] A* FAILED in _aStarOrthogonal! start=(${startPt.x},${startPt.y}) end=(${endPt.x},${endPt.y}). iterations: ${iterations}, openSet size: ${openSet.size}, total nodes in graph: ${nodes.length}`);
        return null; // 探索失敗
    },

    /**
     * 同同一線上の連続する点（collinear）を統合して頂点リストを簡略化する
     */
    _simplifyRoute(points) {
        if (points.length <= 2) return points;

        const result = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const prev = result[result.length - 1];
            const curr = points[i];
            const next = points[i + 1];

            const eps = 1e-5;
            const isCollinearX = Math.abs(prev.x - curr.x) < eps && Math.abs(curr.x - next.x) < eps;
            const isCollinearY = Math.abs(prev.y - curr.y) < eps && Math.abs(curr.y - next.y) < eps;

            if (isCollinearX || isCollinearY) {
                // 中間点を除去
                continue;
            }
            result.push(curr);
        }
        result.push(points[points.length - 1]);
        return result;
    },

    /**
     * 直角制約が維持できているかをチェックし、重複した点などを削除して経路を再構成する
     */
    recalculateRoute(points) {
        const merged = [];
        const eps = 1e-1;
        points.forEach(p => {
            if (merged.length === 0) {
                merged.push(p);
            } else {
                const prev = merged[merged.length - 1];
                if (Math.abs(prev.x - p.x) < eps && Math.abs(prev.y - p.y) < eps) {
                    // 同一座標なのでスキップ
                } else {
                    merged.push(p);
                }
            }
        });
        return this._simplifyRoute(merged);
    }
};

window.OrthogonalRouter = OrthogonalRouter;
