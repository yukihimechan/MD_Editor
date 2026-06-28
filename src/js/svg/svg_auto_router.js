/**
 * SVG Auto Router
 * 直線描画時に障害物（図形）を自動的に迂回する経路を計算する。
 *
 * アルゴリズム: マージンBBox + 可視グラフ + A*探索
 */
const SVGAutoRouter = {

  /** デフォルト設定 */
  config: {
    margin: 15,           // 障害物BBoxの膨張マージン (px)
    maxIterations: 1000,  // A* の最大反復回数（無限ループ防止）
  },

  // ─────────────────────────────────────────────
  // 1. 障害物の収集
  // ─────────────────────────────────────────────

  /**
   * キャンバス上の全障害物のBBoxを収集し、ワールド（キャンバス）座標に変換する。
   * @param {SVG.Doc} draw - SVG.jsのドキュメントオブジェクト
   * @param {Array} excludeEls - 除外する要素（描画中の線自身など）
   * @returns {Array<{x, y, w, h, x2, y2}>} 障害物BBox配列
   */
  collectObstacles(draw, excludeEls = []) {
    const obstacles = [];
    const excludeNodes = new Set(excludeEls.map(el => el.node || el));

    const rootNode = draw.node;
    if (!rootNode || typeof rootNode.getScreenCTM !== 'function') return obstacles;
    const rootScreenCTM = rootNode.getScreenCTM();
    if (!rootScreenCTM) return obstacles;

    draw.children().forEach(el => {
      const node = el.node;
      const tagName = node.tagName.toLowerCase();
      // 定義、テキスト、および線要素は迂回対象（障害物）から除外
      const skipTags = ['defs', 'style', 'marker', 'symbol', 'metadata',
                        'line', 'polyline', 'text', 'tspan'];
      if (skipTags.includes(tagName)) {
        return;
      }
      
      // コネクタ対象と同じ判定ロジックを流用して迂回すべき図形を判定
      if (window.SVGConnectorManager &&
          !window.SVGConnectorManager.shouldShowConnectorsFor(el)) {
        return;
      }
      
      // 除外指定された図形ならスキップ
      if (excludeNodes.has(node)) {
        return;
      }

      // 内部要素・UIハンドルは除外
      if (window.isSVGInternalElement && window.isSVGInternalElement(node)) return;

      try {
        const bbox = el.bbox();
        if (bbox.w > 0 && bbox.h > 0 && typeof node.getScreenCTM === 'function') {
          const targetScreenCTM = node.getScreenCTM();
          if (targetScreenCTM) {
            const m = rootScreenCTM.inverse().multiply(targetScreenCTM);
            
            // ローカルの4隅の座標をワールド座標に変換
            const p1 = new SVG.Point(bbox.x, bbox.y).transform(m);
            const p2 = new SVG.Point(bbox.x + bbox.w, bbox.y).transform(m);
            const p3 = new SVG.Point(bbox.x, bbox.y + bbox.h).transform(m);
            const p4 = new SVG.Point(bbox.x + bbox.w, bbox.y + bbox.h).transform(m);

            const xs = [p1.x, p2.x, p3.x, p4.x];
            const ys = [p1.y, p2.y, p3.y, p4.y];
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);

            obstacles.push({
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
              x2: maxX,
              y2: maxY,
              el: el
            });
          }
        }
      } catch (e) { 
        console.log(`[OrthogonalLineTool] SVGAutoRouter error ${node.id}:`, e);
      }
    });

    console.log(`[OrthogonalLineTool] SVGAutoRouter collectObstacles: found ${obstacles.length} obstacles.`, obstacles.map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, id: o.el ? o.el.id() : 'none' })));
    return obstacles;
  },

  // ─────────────────────────────────────────────
  // 2. BBox膨張
  // ─────────────────────────────────────────────

  /**
   * BBoxにマージンを付けて膨張させる。
   * @param {{x, y, w, h}} bbox
   * @param {number} margin
   * @returns {{x, y, w, h, x2, y2}}
   */
  inflateBBox(bbox, margin) {
    return {
      x:  bbox.x - margin,
      y:  bbox.y - margin,
      w:  bbox.w + margin * 2,
      h:  bbox.h + margin * 2,
      x2: bbox.x + bbox.w + margin,
      y2: bbox.y + bbox.h + margin,
    };
  },

  // ─────────────────────────────────────────────
  // 3. 線分と矩形の交差判定（堅牢なクロス積による線分交差判定）
  // ─────────────────────────────────────────────

  /**
   * 2つの線分 AB と CD が交差するかをCCW(反時計回り)で判定する（ゼロ除算が絶対に発生しない）
   */
  lineSegmentsIntersect(a, b, c, d) {
    const isSamePoint = (p1, p2) => {
      const eps = 1e-5;
      return Math.abs(p1.x - p2.x) < eps && Math.abs(p1.y - p2.y) < eps;
    };
    if (isSamePoint(a, c) || isSamePoint(a, d) || isSamePoint(b, c) || isSamePoint(b, d)) {
      return false;
    }
    const ccw = (p1, p2, p3) => {
      return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
    };
    return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  },

  /**
   * 点が矩形（膨張BBox）の内部にあるか判定する
   */
  isPointInsideRect(p, rect) {
    const eps = 1.0; // 境界線上の点を内部とみなさないための許容誤差
    return p.x >= rect.x + eps && p.x <= rect.x2 - eps && p.y >= rect.y + eps && p.y <= rect.y2 - eps;
  },

  /**
   * 線分(p1→p2)が矩形と交差するかを判定する。
   * @param {{x, y}} p1 - 線分の始点
   * @param {{x, y}} p2 - 線分の終点
   * @param {{x, y, x2, y2}} rect - 矩形
   * @param {{x, y}} [start] - 全体経路の始点
   * @param {{x, y}} [end] - 全体経路の終点
   * @returns {boolean}
   */
  segmentIntersectsRect(p1, p2, rect, start = null, end = null) {
    const isSamePoint = (pt1, pt2) => {
      if (!pt1 || !pt2) return false;
      const eps = 1e-5;
      return Math.abs(pt1.x - pt2.x) < eps && Math.abs(pt1.y - pt2.y) < eps;
    };

    const isStartEdge = isSamePoint(p1, start) || isSamePoint(p2, start);
    const isEndEdge = isSamePoint(p1, end) || isSamePoint(p2, end);

    // p1 または p2 が全体経路の始点/終点そのものである場合、
    // それらの点が矩形（障害物の膨張BBox）の内部にあっても、接続元/接続先自身の内部領域であるため衝突とみなさない。
    const checkP1 = !(isSamePoint(p1, start) || isSamePoint(p1, end));
    const checkP2 = !(isSamePoint(p2, start) || isSamePoint(p2, end));

    if ((checkP1 && this.isPointInsideRect(p1, rect)) || (checkP2 && this.isPointInsideRect(p2, rect))) {
      return true;
    }

    // 始点または終点がこの障害物の内部に配置されている場合、
    // その点から繋がる最初の1エッジ（脱出エッジ・進入エッジ）に限り、
    // この障害物の境界線を越えることを許可する（交差とみなさない）。
    if (isStartEdge && start && this.isPointInsideRect(start, rect)) {
        return false;
    }
    if (isEndEdge && end && this.isPointInsideRect(end, rect)) {
        return false;
    }

    // 貫通チェック: 両端点が境界上（または外部）であっても、中点が内部にあれば貫通している
    const midP = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (this.isPointInsideRect(midP, rect)) {
        return true;
    }

    // 矩形の4つの辺
    const sides = [
      { p1: { x: rect.x, y: rect.y }, p2: { x: rect.x2, y: rect.y } },     // Top
      { p1: { x: rect.x2, y: rect.y }, p2: { x: rect.x2, y: rect.y2 } },   // Right
      { p1: { x: rect.x2, y: rect.y2 }, p2: { x: rect.x, y: rect.y2 } },   // Bottom
      { p1: { x: rect.x, y: rect.y2 }, p2: { x: rect.x, y: rect.y } }      // Left
    ];

    // いずれかの辺と線分が交差するか
    for (const side of sides) {
      if (this.lineSegmentsIntersect(p1, p2, side.p1, side.p2)) {
        // T-junction (丁字路) 対策: 
        // p1 または p2 が内部にないことは既に確認済みなので、
        // 線分の端点が矩形の辺上にぴったり乗っている場合は、内部を横切っていないため交差とみなさない。
        const isPointOnSegment = (p, a, b) => {
            const eps = 1e-3;
            const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
            if (Math.abs(cross) > eps) return false;
            const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
            if (dot < -eps) return false;
            const sqLen = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
            if (dot > sqLen + eps) return false;
            return true;
        };
        if (isPointOnSegment(p1, side.p1, side.p2) || isPointOnSegment(p2, side.p1, side.p2)) {
            continue; // 接しているだけ
        }
        return true;
      }
    }
    return false;
  },

  // ─────────────────────────────────────────────
  // 4. 経路上の障害物判定
  // ─────────────────────────────────────────────

  /**
   * 2点間(p1→p2)を結ぶ線分が、いずれかの障害物と交差するかどうかを判定する。
   * @param {{x, y}} p1
   * @param {{x, y}} p2
   * @param {Array} obstacles - 膨張した障害物BBoxの配列
   * @param {{x, y}} [start] - 全体経路の始点
   * @param {{x, y}} [end] - 全体経路の終点
   * @returns {boolean}
   */
  hasObstacleOnPath(p1, p2, obstacles, start = null, end = null) {
    for (const obs of obstacles) {
      if (this.segmentIntersectsRect(p1, p2, obs, start, end)) {
        return true;
      }
    }
    return false;
  },

  // ─────────────────────────────────────────────
  // 5. 経由点の生成
  // ─────────────────────────────────────────────

  /**
   * 膨張したBBoxの四隅から、経由点（ウェイポイント）候補を生成する。
   * @param {Array} obstacles - 膨張した障害物BBoxの配列
   * @returns {Array<{x, y}>} ウェイポイントの配列
   */
  generateWaypoints(obstacles) {
    const points = [];
    obstacles.forEach(obs => {
      // 四隅の座標
      points.push({ x: obs.x, y: obs.y });
      points.push({ x: obs.x2, y: obs.y });
      points.push({ x: obs.x2, y: obs.y2 });
      points.push({ x: obs.x, y: obs.y2 });
    });
    return points;
  },

  // ─────────────────────────────────────────────
  // 6. 経路探索 (A* アルゴリズム)
  // ─────────────────────────────────────────────

  /**
   * 始点から終点までの迂回経路を計算する。
   * @param {{x, y}} start
   * @param {{x, y}} end
   * @param {Array} obstacles
   * @param {Object} [options]
   * @returns {Array<{x, y}>} 経路の点配列
   */
  findRoute(start, end, obstacles, options = {}) {
    const margin = options.margin || this.config.margin;
    const maxIter = options.maxIterations || this.config.maxIterations;

    console.log(`[SVGAutoRouter] findRoute: start=(${start.x}, ${start.y}), end=(${end.x}, ${end.y}), obstacles=${obstacles.length}`);
    obstacles.forEach((o, i) => {
        console.log(`  Obstacle[${i}]: x=${o.x}, y=${o.y}, w=${o.w}, h=${o.h}, id=${o.el ? o.el.id() : 'none'}`);
    });

    // 障害物を膨張
    const inflated = obstacles.map(obs => this.inflateBBox(obs, margin));

    const hasObs = this.hasObstacleOnPath(start, end, inflated, start, end);
    console.log(`[SVGAutoRouter] hasObstacleOnPath: ${hasObs}`);

    // 直線で到達可能なら即リターン
    if (!hasObs) {
      return [start, end];
    }

    // 経由点候補 = 始点 + 膨張BBoxの四隅 + 終点
    const waypoints = [start, ...this.generateWaypoints(inflated), end];
    const n = waypoints.length;
    const startIdx = 0;
    const endIdx = n - 1;

    // 可視グラフの構築（各ノード間が障害物に遮られないか）
    const visible = new Map();
    for (let i = 0; i < n; i++) {
      visible.set(i, []);
      for (let j = i + 1; j < n; j++) {
        if (!this.hasObstacleOnPath(waypoints[i], waypoints[j], inflated, start, end)) {
          visible.get(i).push(j);
          if (!visible.has(j)) visible.set(j, []);
          visible.get(j).push(i);
        }
      }
    }

    // A* 探索
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y); // 直線距離をコストとする
    const gScore = new Array(n).fill(Infinity);
    const fScore = new Array(n).fill(Infinity);
    const cameFrom = new Array(n).fill(-1);

    gScore[startIdx] = 0;
    fScore[startIdx] = dist(start, end);

    const openSet = new Set([startIdx]);
    let iterations = 0;

    while (openSet.size > 0 && iterations < maxIter) {
      iterations++;

      // fScoreが最小のノードを取得
      let current = -1;
      let minF = Infinity;
      for (const idx of openSet) {
        if (fScore[idx] < minF) {
          minF = fScore[idx];
          current = idx;
        }
      }

      if (current === endIdx) {
        // 経路を復元
        const path = [];
        let c = endIdx;
        while (c !== -1) {
          path.unshift(waypoints[c]);
          c = cameFrom[c];
        }
        return this.simplifyRoute(path, inflated, start, end);
      }

      openSet.delete(current);
      const neighbors = visible.get(current) || [];

      for (const neighbor of neighbors) {
        const tentG = gScore[current] + dist(waypoints[current], waypoints[neighbor]);

        if (tentG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentG;
          fScore[neighbor] = tentG + dist(waypoints[neighbor], end);
          openSet.add(neighbor);
        }
      }
    }

    // 経路が見つからない場合は直線で返す
    console.warn('[SVGAutoRouter] 迂回経路が見つかりませんでした。直線で代替します。');
    return [start, end];
  },

  // ─────────────────────────────────────────────
  // 7. 経路の簡略化
  // ─────────────────────────────────────────────

  /**
   * 冗長な中間点を除去して経路を簡略化する。
   * @param {Array<{x, y}>} points
   * @param {Array} obstacles
   * @param {{x, y}} [start] - 全体経路の始点
   * @param {{x, y}} [end] - 全体経路 of終点
   * @returns {Array<{x, y}>}
   */
  simplifyRoute(points, obstacles, start = null, end = null) {
    if (points.length <= 2) return points;

    const result = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const next = points[i + 1];

      // prev→next が障害物なしで直通可能なら中間点 points[i] をスキップ
      if (!this.hasObstacleOnPath(prev, next, obstacles, start, end)) {
        continue;
      }
      result.push(points[i]);
    }

    result.push(points[points.length - 1]);
    return result;
  },

  // ─────────────────────────────────────────────
  // 8. 公開API
  // ─────────────────────────────────────────────

  /**
   * 始点→終点の迂回経路を折れ線の頂点配列として返す。
   * @param {{x, y}} startPt - 始点
   * @param {{x, y}} endPt - 終点
   * @param {SVG.Doc} draw - SVG.jsドキュメント
   * @param {Array} excludeEls - 除外要素
   * @returns {Array<{x, y}>}
   */
  routeAsPolyline(startPt, endPt, draw, excludeEls = []) {
    const obstacles = this.collectObstacles(draw, excludeEls);
    return this.findRoute(startPt, endPt, obstacles);
  }
};

window.SVGAutoRouter = SVGAutoRouter;
