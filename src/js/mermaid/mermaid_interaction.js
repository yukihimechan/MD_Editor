/**
 * Mermaid Interaction Module
 * Mermaidダイアグラム上でのノードへのホバー・ドラッグ接続機能を提供します。
 * 対応タイプ: flowchart / graph
 */
const MermaidInteraction = (() => {

    // ── 定数 ──────────────────────────────────────────────────
    const SNAP_THRESHOLD_PX = 36;   // スナップ距離の閾値（px）
    const HANDLE_SIZE       = 10;   // 接続ハンドルの三角形サイズ（px）
    const HANDLE_OFFSET     = 6;    // ノード枠からハンドルまでの余白（px）

    // ── 状態 ──────────────────────────────────────────────────
    let _dragState     = null;  // 接続ハンドルドラッグ中の状態オブジェクト
    let _nodeDragState = null;  // ノード本体ドラッグ中の状態オブジェクト
    let _clipboard = null;  // コピー＆ペースト用の内部クリップボード

    // ── ユーティリティ ────────────────────────────────────────

    /**
     * wrapper要素からMermaidソースコードブロックの範囲を取得する。
     * @returns {{startIdx: number, endIdx: number, lines: string[]}|null}
     */
    function getMermaidBlockRange(wrapper) {
        return window.MermaidBase.getMermaidBlockRange(wrapper);
    }

    /**
     * テキストを書き換えて再描画し、Mermaidの編集モード状態を復元するヘルパー関数
     * @param {Element} wrapper 
     * @param {string[]} newTextLines 
     */
    function applyEditorTextAndRestore(wrapper, newTextLines, modeClass, toolbar, options) {
        window.MermaidBase.applyEditorTextAndRestore(wrapper, newTextLines, modeClass || 'mermaid-edit-mode', toolbar || window.activeMermaidToolbar, options);
    }

    /**
     * Mermaidのソースから、特定の接続(fromId -> toId)の既存のラベルテキストを取得する。
     * 存在しない場合は null を返す。
     */
    function findMermaidEdgeLabelText(wrapper, fromId, toId) {
        const dataLine = wrapper.dataset.line;
        if (!dataLine || isNaN(dataLine)) return null;

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx   = dataLine - 1;

        const isMermaidLine = (l) => /^\s*(?:```|~~~)mermaid/.test(l || '');
        if (!isMermaidLine(lines[startIdx])) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                if (isMermaidLine(lines[startIdx + d])) { found = startIdx + d; break; }
            }
            if (found === -1) return null;
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return null;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (line.includes(fromId) && line.includes(toId)) {
                // ラベルの抽出 (例: -->|label|, -.->|label|, ==>|label|)
                const match = line.match(/(?:-->|-\.->|==>)\|([^|]+)\|/);
                if (match) {
                    return match[1];
                }
            }
        }
        return null;
    }

    /**
     * SVGノードのIDからMermaid上のノードIDを抽出する。
     * v10: "flowchart-NodeId-数字" の形式
     * v11: "{diagramId}-flowchart-NodeId-数字" の形式（プレフィックス付き）
     * @param {Element} el - SVGのg要素
     * @returns {string|null} MermaidノードID（例: "A"）、判定不可なら null
     */
    function getMermaidNodeId(el) {
        const id = el.id || '';

        // パターン1: v11形式 - {任意のプレフィックス}-flowchart-NodeId-数字
        // 例: "mermaid-1234567890-0-flowchart-A-0"
        let m = id.match(/^.+-flowchart-(.+?)-\d+$/);
        if (m) return m[1];

        // パターン2: v10形式 - flowchart-NodeId-数字（プレフィックスなし）
        m = id.match(/^flowchart-(.+?)-\d+$/);
        if (m) return m[1];

        // パターン3: v10形式 - graph-NodeId-数字（古いバージョン互換）
        m = id.match(/^(?:.+-)?graph-(.+?)-\d+$/);
        if (m) return m[1];

        // パターン4: ノードに data-id 属性がある場合（v11のcluster等で使用）
        if (el.hasAttribute('data-id')) return el.getAttribute('data-id');

        // パターン5: cluster クラスを持つ場合のフォールバック
        // v11: subgraphのID形式は "{diagramId}-{sgId}" （末尾がサブグラフID）
        if (el.classList && el.classList.contains('cluster') && id) {
            const parts = id.split('-');
            if (parts.length > 1) {
                // v11パターン: "{diagramId}-{sgId}"
                // diagramIdは "mermaid-{timestamp}-{index}" の形式なので末尾のセグメントがサブグラフID
                // 例: "mermaid-1779234712982-0-SG1" → 末尾の "SG1" がサブグラフID
                const lastPart = parts[parts.length - 1];

                // 末尾が純粋な数字でなければサブグラフID（v11典型）
                if (!/^\d+$/.test(lastPart)) {
                    return lastPart;
                }

                // 末尾が数字の場合: flowchart-{sgId}-{N} パターン（v10）
                const fcIdx = parts.lastIndexOf('flowchart');
                if (fcIdx !== -1 && fcIdx < parts.length - 2) {
                    // "...-flowchart-SGid-N" → "SGid"
                    return parts.slice(fcIdx + 1, -1).join('-');
                }

                // 先頭の "flowchart" を除いた残り（v10定義）
                if (parts[0] === 'flowchart') {
                    return parts.slice(1).join('-');
                }
            }
            return id;
        }

        // パターン6: v11の空のsubgraph（g.nodeクラスを持つが、ソース上でsubgraphとして定義されている）
        const wrapper = el.closest('.mermaid-diagram-wrapper');
        if (wrapper && id) {
            const range = getMermaidBlockRange(wrapper);
            if (range) {
                const parts = id.split('-');
                const lastPart = parts[parts.length - 1];
                for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                    const m = range.lines[i].match(/^\s*subgraph\s+([^\s\[\]]+)/);
                    if (m && m[1] === lastPart) {
                        return lastPart;
                    }
                }
            }
        }

        return null;
    }

    /**
     * ダイアグラムSVG内のすべての操作可能なノードを収集する。
     * @param {Element} svgEl - Mermaidが生成したSVG要素
     * @returns {Array<{el, id, rect, cx, cy}>}
     */
    function collectNodes(svgEl) {
        const nodes = [];
        const nodeEls = svgEl.querySelectorAll('g.node, g.cluster');

        nodeEls.forEach(g => {
            const mId = getMermaidNodeId(g);
            if (!mId) return;
            const rect = g.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            nodes.push({
                el:  g,
                id:  mId,
                rect,
                cx: rect.left + rect.width  / 2,
                cy: rect.top  + rect.height / 2,
            });
        });
        return nodes;
    }

    /**
     * Mermaidの diagram タイプを判定する。
     * @param {string} source - Mermaidソーステキスト
     * @returns {string} 'flowchart' | 'other'
     */
    function getDiagramType(source) {
        if (!source || typeof source !== 'string') return 'other';
        const first = source.trimStart().split('\n')[0].toLowerCase();
        if (first.startsWith('graph ') || first.startsWith('flowchart ')) {
            return 'flowchart';
        }
        return 'other';
    }

    // ── オーバーレイSVG ────────────────────────────────────────

    /**
     * wrapper に1つだけオーバーレイSVGを生成して返す（冪等）。
     * @param {Element} wrapper - .mermaid-diagram-wrapper
     * @returns {SVGSVGElement}
     */
    function ensureOverlay(wrapper) {
        let overlay = wrapper.querySelector('.mermaid-overlay-svg');
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            overlay.classList.add('mermaid-overlay-svg');
            overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;';
            // アロー用defs（marker）を一度だけ定義
            overlay.innerHTML = `
                <defs>
                  <marker id="mi-arrow" markerWidth="8" markerHeight="8"
                    refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill="#4A90E2"/>
                  </marker>
                </defs>`;
            wrapper.appendChild(overlay);
        }
        return overlay;
    }

    /**
     * オーバーレイSVGをクリアする（defs以外）。
     * @param {SVGSVGElement} overlay
     */
    function clearOverlay(overlay) {
        Array.from(overlay.children).forEach(child => {
            if (child.tagName.toLowerCase() !== 'defs') overlay.removeChild(child);
        });
    }

    // ── 接続ハンドルの描画 ─────────────────────────────────────

    /**
     * クラスター（subgraph/グループ）かどうかを判定する。
     * @param {{el: Element}} nodeInfo
     * @param {Element} wrapper
     * @returns {boolean}
     */
    function isClusterNode(nodeInfo, wrapper) {
        const el = nodeInfo.el;
        if (!el) return false;
        // classList.contains が最も確実（SVGAnimatedString も classList は使える）
        if (el.classList && el.classList.contains('cluster')) return true;
        // ID パターンでのフォールバック（cluster-XXX 形式）
        if (el.id && /^cluster/.test(el.id)) return true;

        // v11の空のsubgraph（g.nodeクラスを持つ）対応
        const actualWrapper = wrapper || el.closest('.mermaid-diagram-wrapper');
        if (actualWrapper && nodeInfo.id) {
            const range = getMermaidBlockRange(actualWrapper);
            if (range) {
                for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                    const m = range.lines[i].match(/^\s*subgraph\s+([^\s\[\]]+)/);
                    if (m && m[1] === nodeInfo.id) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 指定ノードの上下左右に接続ハンドル（三角形）を描画する。
     * クラスター（グループ）の場合はグループ全体をハイライト枠で囲み、接続ハンドルは表示しない。
     * @param {SVGSVGElement} overlay
     * @param {{el, id, rect}} nodeInfo
     * @param {Element} wrapper
     * @param {boolean} skipClear 既存のオーバーレイ要素をクリアしない場合はtrue
     */
    function drawHandles(overlay, nodeInfo, wrapper, skipClear = false) {
        if (!skipClear) {
            clearOverlay(overlay);
        }

        const wRect  = wrapper.getBoundingClientRect();

        // クラスター（グループ）の場合はグループ全体を囲む矩形でハイライト表示する
        const isCluster = isClusterNode(nodeInfo, wrapper);
        if (isCluster) {
            drawGroupHighlight(overlay, nodeInfo, wRect);
            return;
        }

        const nRect  = nodeInfo.rect;

        // ノード枠をwrapper相対座標に変換
        const top    = nRect.top    - wRect.top;
        const left   = nRect.left   - wRect.left;
        const right  = nRect.right  - wRect.left;
        const bottom = nRect.bottom - wRect.top;
        const cx     = left + nRect.width  / 2;
        const cy     = top  + nRect.height / 2;

        // 選択ハイライト枠
        const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        selRect.setAttribute('x',       left - 3);
        selRect.setAttribute('y',       top  - 3);
        selRect.setAttribute('width',   nRect.width  + 6);
        selRect.setAttribute('height',  nRect.height + 6);
        selRect.setAttribute('fill',    'none');
        selRect.setAttribute('stroke',  '#4A90E2');
        selRect.setAttribute('stroke-width', '2');
        selRect.setAttribute('stroke-dasharray', '4,2');
        selRect.setAttribute('rx', '4');
        selRect.setAttribute('pointer-events', 'none');
        selRect.classList.add('mermaid-hover-rect');
        overlay.appendChild(selRect);

        // 4方向のハンドル定義（三角形の頂点が外向きになるよう座標を設定）
        // 上ハンドル: 底辺がノード側（cx-S,top-O / cx+S,top-O）、頂点が上（cx, top-O-S*1.5）
        // 下ハンドル: 底辺がノード側（cx-S,bottom+O / cx+S,bottom+O）、頂点が下（cx, bottom+O+S*1.5）
        // 左ハンドル: 底辺がノード側（left-O,cy-S / left-O,cy+S）、頂点が左（left-O-S*1.5, cy）
        // 右ハンドル: 底辺がノード側（right+O,cy-S / right+O,cy+S）、頂点が右（right+O+S*1.5, cy）
        const S = HANDLE_SIZE;
        const O = HANDLE_OFFSET;
        const tipDist = S * 1.6; // ノード枠から三角形先端までの距離
        const handles = [
            { dir: 'top',    hx: cx,              hy: top    - O - tipDist / 2,
              pts: `${cx},${top - O - tipDist} ${cx - S},${top - O} ${cx + S},${top - O}` },
            { dir: 'bottom', hx: cx,              hy: bottom + O + tipDist / 2,
              pts: `${cx},${bottom + O + tipDist} ${cx - S},${bottom + O} ${cx + S},${bottom + O}` },
            { dir: 'left',   hx: left - O - tipDist / 2, hy: cy,
              pts: `${left - O - tipDist},${cy} ${left - O},${cy - S} ${left - O},${cy + S}` },
            { dir: 'right',  hx: right + O + tipDist / 2, hy: cy,
              pts: `${right + O + tipDist},${cy} ${right + O},${cy - S} ${right + O},${cy + S}` },
        ];

        handles.forEach(h => {
            const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            tri.setAttribute('points', h.pts);
            tri.setAttribute('fill', '#4A90E2');
            tri.setAttribute('opacity', '0.75');
            tri.classList.add('mermaid-connect-handle');
            tri.style.pointerEvents = 'auto';
            tri.style.cursor = 'crosshair';
            tri.dataset.dir      = h.dir;
            tri.dataset.nodeId   = nodeInfo.id;
            tri.dataset.startCx  = h.hx;
            tri.dataset.startCy  = h.hy;
            overlay.appendChild(tri);
        });
    }

    /**
     * グループ（クラスター/subgraph）選択時にグループ全体を囲む矩形ハイライトを描画する。
     * 接続ハンドルは描画しない。
     * @param {SVGSVGElement} overlay
     * @param {{el: Element, id: string, rect: DOMRect}} nodeInfo
     * @param {DOMRect} wRect - wrapper の getBoundingClientRect()
     */
    function drawGroupHighlight(overlay, nodeInfo, wRect) {
        // クラスター要素全体のバウンディングボックスを取得する。
        // getBoundingClientRect() は子要素を含む全体の領域を返すため、
        // クラスターラベルだけでなくグループ全体を囲む枠を描画できる。
        const nRect = nodeInfo.el.getBoundingClientRect();

        // wrapper 相対座標に変換
        const top    = nRect.top    - wRect.top;
        const left   = nRect.left   - wRect.left;

        // グループ全体を囲む太い実線の矩形を描画
        const PADDING = 4; // グループ枠からのはみ出し余白（px）
        const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        selRect.setAttribute('x',      left   - PADDING);
        selRect.setAttribute('y',      top    - PADDING);
        selRect.setAttribute('width',  nRect.width  + PADDING * 2);
        selRect.setAttribute('height', nRect.height + PADDING * 2);
        selRect.setAttribute('fill',    'rgba(255, 140, 0, 0.06)');  // 薄いオレンジ背景
        selRect.setAttribute('stroke',  '#FF8C00');                   // オレンジ枠線
        selRect.setAttribute('stroke-width', '2.5');
        selRect.setAttribute('stroke-dasharray', '6,3');              // 長い破線でグループらしさを演出
        selRect.setAttribute('rx', '6');
        selRect.setAttribute('pointer-events', 'none');
        selRect.classList.add('mermaid-hover-rect', 'mermaid-group-highlight');
        overlay.appendChild(selRect);

        // グループであることを示すラベルアイコン（左上コーナーに小さなバッジ）
        const BADGE_R = 8;
        const badgeX = left - PADDING + BADGE_R + 2;
        const badgeY = top  - PADDING + BADGE_R + 2;

        const badgeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        badgeCircle.setAttribute('cx', badgeX);
        badgeCircle.setAttribute('cy', badgeY);
        badgeCircle.setAttribute('r',  BADGE_R);
        badgeCircle.setAttribute('fill', '#FF8C00');
        badgeCircle.setAttribute('pointer-events', 'none');
        badgeCircle.classList.add('mermaid-group-badge');
        overlay.appendChild(badgeCircle);

        // バッジ内のグループアイコン（「⊞」相当を簡易的にテキストで表現）
        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', badgeX);
        badgeText.setAttribute('y', badgeY + 4);
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('font-size', '9');
        badgeText.setAttribute('font-weight', 'bold');
        badgeText.setAttribute('fill', '#fff');
        badgeText.setAttribute('pointer-events', 'none');
        badgeText.textContent = 'G';
        badgeText.classList.add('mermaid-group-badge');
        overlay.appendChild(badgeText);
    }

    // ── ドラッグ処理 ───────────────────────────────────────────

    /**
     * ラバーバンドラインを生成してオーバーレイに追加する。
     */
    function createRubberLine(overlay, x1, y1) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x1);
        line.setAttribute('y2', y1);
        line.setAttribute('stroke', '#4A90E2');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '6,3');
        line.setAttribute('marker-end', 'url(#mi-arrow)');
        line.setAttribute('pointer-events', 'none');
        line.classList.add('mermaid-rubber-line');
        overlay.appendChild(line);
        return line;
    }

    /**
     * 全ノードから最も近いスナップ候補を探す。
     * @param {number} mx - wrapperローカルX（px）
     * @param {number} my - wrapperローカルY（px）
     * @param {Array}  nodes
     * @param {string} excludeId - ドラッグ元ノードID（除外）
     * @param {DOMRect} wRect - wrapperのBoundingClientRect
     * @returns {{nodeInfo, cx, cy}|null}
     */
    function findSnapTarget(mx, my, nodes, excludeId, wRect) {
        let best = null;
        let insideNodes = [];
        let minDistToBorder = SNAP_THRESHOLD_PX;
        
        for (const n of nodes) {
            if (n.id === excludeId) continue;
            
            // wrapperローカルでのノードの矩形
            const nLeft = n.rect.left - wRect.left;
            const nTop  = n.rect.top  - wRect.top;
            const nRight = nLeft + n.rect.width;
            const nBottom = nTop + n.rect.height;
            
            // 点 (mx, my) が矩形内部にあるか
            const isInside = mx >= nLeft && mx <= nRight && my >= nTop && my <= nBottom;
            
            if (isInside) {
                insideNodes.push(n);
            } else {
                // 外側の場合、矩形の境界からの最短距離を計算
                const dx = Math.max(nLeft - mx, 0, mx - nRight);
                const dy = Math.max(nTop - my, 0, my - nBottom);
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDistToBorder) {
                    minDistToBorder = d;
                    best = n;
                }
            }
        }
        
        if (insideNodes.length > 0) {
            // 内部に入っている場合は、面積が小さいものを優先する（巨大なsubgraphより中のノードを優先）
            insideNodes.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
            best = insideNodes[0];
        }
        
        if (best) {
            const cx = best.rect.left - wRect.left + best.rect.width  / 2;
            const cy = best.rect.top  - wRect.top  + best.rect.height / 2;
            return { nodeInfo: best, cx, cy };
        }
        return null;
    }

    // ── Mermaidソース更新 ──────────────────────────────────────

    /**
     * エディタのMermaidソースに矢印を追記して再描画する。
     * @param {Element} wrapper  - .mermaid-diagram-wrapper（data-line属性を持つ）
     * @param {string}  fromId   - 接続元ノードID
     * @param {string}  toId     - 接続先ノードID
     */
    function appendConnectionToSource(wrapper, fromId, toId) {
        if (!fromId || !toId || fromId === toId) return;

        // getEditorText / setEditorText は globals.js で定義されているグローバル関数
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') {
            console.warn('[MermaidInteraction] getEditorText / setEditorText が見つかりません');
            return;
        }

        // data-lineをwrapperから取得。取れない場合は親の.code-block-wrapperを遥って探す
        let dataLineEl = wrapper;
        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            // フォールバック: 親の.code-block-wrapperから取得を試みる
            const parentWrapper = wrapper.closest('.code-block-wrapper');
            if (parentWrapper) {
                dataLine = parseInt(parentWrapper.getAttribute('data-line'), 10);
                dataLineEl = parentWrapper;
            }
        }
        if (!dataLine || isNaN(dataLine)) {
            console.warn('[MermaidInteraction] data-line 属性が取得できません。wrapper:', wrapper);
            return;
        }

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx = dataLine - 1; // 0-indexed

        // data-lineが指す行が ```mermaid か確認する（ずれ対策）
        const startLine = (lines[startIdx] || '').trim();
        if (!startLine.startsWith('```mermaid') && !startLine.startsWith('~~~mermaid')) {
            // ±5行の範囲で ```mermaid を探す
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                const idx = startIdx + d;
                if (idx < 0 || idx >= lines.length) continue;
                const l = lines[idx].trim();
                if (l.startsWith('```mermaid') || l.startsWith('~~~mermaid')) {
                    found = idx;
                    break;
                }
            }
            if (found === -1) {
                console.warn('[MermaidInteraction] ```mermaid 行が見つかりません。startIdx:', startIdx, '行内容:', startLine);
                return;
            }
            startIdx = found;
        }

        // ```mermaid の行から ``` の閉じ行を探す
        let endIdx = -1;
        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) {
                endIdx = i;
                break;
            }
        }

        if (endIdx === -1) {
            console.warn('[MermaidInteraction] Mermaidブロックの閉じ ``` が見つかりません');
            return;
        }

        // 同じ接続がすでに存在するか確認（重複防止）
        const arrowLine = `    ${fromId} --> ${toId}`;
        const existingBlock = lines.slice(startIdx, endIdx + 1).join('\n');
        if (existingBlock.includes(`${fromId} --> ${toId}`) || existingBlock.includes(`${fromId}-->${toId}`)) {
            console.log('[MermaidInteraction] 接続が既に存在します:', fromId, '-->', toId);
            if (typeof showToast === 'function') showToast('接続は既に存在します', 'info');
            return;
        }

        // 閉じ ``` の直前に矢印行を挿入
        lines.splice(endIdx, 0, arrowLine);
        setEditorText(lines.join('\n'));

        // 再描画 — 編集モードだった場合は再描画後に編集モードを復元する
        const wasEditMode = wrapper.classList.contains('mermaid-edit-mode');
        // data-lineで再描画後の新しいDOMを特定するために保存
        const savedDataLine = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;

        setTimeout(() => {
            if (typeof window.render === 'function') {
                window.render();
            }
            // 再描画後に編集モードを復元（DOMが再構築されるため再適用が必要）
            if (wasEditMode) {
                // render()は非同期でDOMを更新するため、さらに1フレーム待つ
                setTimeout(() => {
                    const preview = document.getElementById('preview');
                    if (!preview) return;

                    // 新しいmermaid-diagram-wrapperを特定して編集モードを再適用
                    // codeIndexが最も確実なキーとなる（data-lineはdetailsに移動することがある）
                    let newDiagramWrapper = null;
                    let newCodeBlockWrapper = null;

                    if (savedCodeIndex !== undefined) {
                        newCodeBlockWrapper = document.querySelector(
                            `.code-block-wrapper[data-code-index="${savedCodeIndex}"]`
                        );
                        if (newCodeBlockWrapper) {
                            newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                        }
                    }
                    // フォールバック: data-lineで探す
                    if (!newDiagramWrapper && savedDataLine) {
                        newDiagramWrapper = document.querySelector(
                            `.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`
                        );
                        if (newDiagramWrapper && !newCodeBlockWrapper) {
                            newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                        }
                    }

                    if (newDiagramWrapper) {
                        // 編集モードクラスを再付与
                        newDiagramWrapper.classList.add('mermaid-edit-mode');
                        // InlineCodeEditorの内部参照も新しいDOMで更新する
                        if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                            InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                            if (newCodeBlockWrapper) {
                                InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                            }
                        }

                        // Mermaidツールバーを新しいdiagramWrapperに再アタッチして表示する
                        // （再描画でDOMが作り直されるため、再度 show() が必要）
                        // ただし「完了」ボタンで既に編集終了している場合は表示しない
                        if (window.activeMermaidToolbar
                            && typeof InlineCodeEditor !== 'undefined'
                            && InlineCodeEditor.activeMermaidWrapper) {
                            window.activeMermaidToolbar.show(newDiagramWrapper);
                        }

                        // 「編集」ボタンを「完了」ボタンに戻す（再描画でテキストがリセットされるため）
                        const targetWrapper = newCodeBlockWrapper
                            || newDiagramWrapper.closest('.code-block-wrapper');
                        if (targetWrapper) {
                            window.MermaidBase.updateEditButtonToDoneMode(targetWrapper);
                        }
                    }
                }, 100);
            }
        }, 50);

        if (typeof showToast === 'function') showToast(`${fromId} → ${toId} を接続しました`, 'success');
    }

    // ── ノードラベル書き換え ────────────────────────────────────

    /**
     * Mermaidソース内の指定ノードIDのラベルを書き換えて再描画する。
     * @param {Element} wrapper      - .mermaid-diagram-wrapper
     * @param {string}  nodeId       - ノードID (例: "A")
     * @param {string}  currentLabel - 現在のラベル
     * @param {string}  newLabel     - 新しいラベル
     */
    function renameMermaidNodeLabel(wrapper, nodeId, currentLabel, newLabel) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        // data-line から Mermaid ブロックの開始行を特定
        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) {
            console.warn('[MermaidInteraction] renameMermaidNodeLabel: data-line が取得できません');
            return;
        }

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx   = dataLine - 1;

        // ```mermaid 行の確認（±5行範囲）
        const isMermaidLine = (l) => /^\s*(?:```|~~~)mermaid/.test(l || '');
        if (!isMermaidLine(lines[startIdx])) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                if (isMermaidLine(lines[startIdx + d])) { found = startIdx + d; break; }
            }
            if (found === -1) { console.warn('[MermaidInteraction] ```mermaid が見つかりません'); return; }
            startIdx = found;
        }

        // 閉じ ``` を探す
        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) { console.warn('[MermaidInteraction] 閉じ ``` が見つかりません'); return; }

        // ブロック内のノード定義行を書き換える
        // Mermaidでは "A[label] --> B[label]" のように接続行にラベルが含まれるため、
        // 行頭マッチではなく行内のどこでもnodeId+ブラケットを検索する
        let replaced = false;

        // 対応するブラケット形式: 長い順に並べることで短いパターンが先にマッチするのを防ぐ
        const bracketPairs = [
            { open: '(((', close: ')))' },  // ID(((label))) 二重円
            { open: '((', close: '))' },    // ID((label))   円
            { open: '([', close: '])' },    // ID([label])   スタジアム
            { open: '[(', close: ')]' },    // ID[(label)]   DB形式
            { open: '{{', close: '}}' },    // ID{{label}}   六角形
            { open: '[', close: ']' },      // ID[label]     四角（最も一般的）
            { open: '{', close: '}' },      // ID{label}     ひし形
            { open: '(', close: ')' },      // ID(label)     丸角
        ];

        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (!line.includes(nodeId)) continue;

            for (const { open, close } of bracketPairs) {
                const searchStr = nodeId + open;
                let pos = -1;

                // 行内で nodeId+open の位置を探す（単語境界チェック付き）
                let searchFrom = 0;
                while (true) {
                    const found = line.indexOf(searchStr, searchFrom);
                    if (found === -1) break;
                    // nodeIdの直前が単語文字でなければ有効なマッチ（部分一致防止）
                    if (found === 0 || !/\w/.test(line[found - 1])) {
                        pos = found;
                        break;
                    }
                    searchFrom = found + 1;
                }

                if (pos === -1) continue;

                // 対応する閉じブラケットを探す
                const labelStart = pos + searchStr.length;
                const closePos = line.indexOf(close, labelStart);
                if (closePos === -1) continue;

                // closePos直後に余分な閉じ括弧がある場合、短いパターンが長いパターンに
                // 誤マッチしている可能性があるため（例: ((text)) を (text) でマッチした場合）スキップ
                const afterClose = line[closePos + close.length];
                if (close === ')' && afterClose === ')') continue;    // ( が (( に誤マッチ
                if (close === '))' && afterClose === ')') continue;   // (( が ((( に誤マッチ

                // ラベル部分だけを新しいラベルに置き換える（行の前後はそのまま保持）
                lines[i] = line.substring(0, labelStart) + newLabel + line.substring(closePos);
                replaced = true;
                break;
            }

            if (replaced) break;
        }

        // ノードが見つからなかった場合、subgraph のラベルか確認する
        if (!replaced) {
            const subgraphSearchStr = `subgraph ${nodeId}`;
            for (let i = startIdx + 1; i < endIdx; i++) {
                const line = lines[i];
                if (line.includes(subgraphSearchStr)) {
                    // escapeRegExp をここでも使うため関数を定義（あるいは単純な正規表現）
                    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
                    const regex = new RegExp(`(^\\s*subgraph\\s+${esc(nodeId)}\\s*)(\\[([^\\]]*)\\])?(.*)$`);
                    const match = line.match(regex);
                    if (match) {
                        lines[i] = match[1] + `[${newLabel}]` + match[4];
                        replaced = true;
                        break;
                    }
                }
            }
        }


        if (!replaced) {
            console.warn('[MermaidInteraction] ノード定義行が見つかりません:', nodeId);
            return;
        }

        // 再描画前に編集状態情報を保存
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                // 編集モードを復元
                const preview = document.getElementById('preview');
                if (!preview) return;

                let newDiagramWrapper = null;
                let newCodeBlockWrapper = null;

                if (savedCodeIndex !== undefined) {
                    newCodeBlockWrapper = document.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = document.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
                    if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                }

                if (newDiagramWrapper) {
                    newDiagramWrapper.classList.add('mermaid-edit-mode');
                    if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                        InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                        if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                    }
                        window.MermaidBase.updateEditButtonToDoneMode(newCodeBlockWrapper);
                    // Mermaidツールバーも復元
                    if (window.activeMermaidToolbar) {
                        window.activeMermaidToolbar.show(newDiagramWrapper);
                    }
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`「${nodeId}」のラベルを「${newLabel}」に変更しました`, 'success');
    }

    /**
     * Mermaidソース内のエッジ（矢印）のラベルを書き換えて再描画する。
     * @param {Element} wrapper      - .mermaid-diagram-wrapper
     * @param {string}  currentLabel - 現在のラベル
     * @param {string}  newLabel     - 新しいラベル
     */
    function renameMermaidEdgeLabel(wrapper, currentLabel, newLabel) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx   = dataLine - 1;

        const isMermaidLine = (l) => /^\s*(?:```|~~~)mermaid/.test(l || '');
        if (!isMermaidLine(lines[startIdx])) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                if (isMermaidLine(lines[startIdx + d])) { found = startIdx + d; break; }
            }
            if (found === -1) return;
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        let replaced = false;

        // エッジラベルの形式： -->|ラベル| または -- ラベル --- または -. ラベル .-> などのパターンがある
        // ここでは単純に文字列を検索して置換する
        // "-->|" "--> |" "-- " などの区切り文字があるかチェックすることで誤爆を防ぐ
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (!line.includes(currentLabel)) continue;

            // 矢印ラベルが含まれる代表的なパターン
            // 1. -->|label|
            // 2. -- label ---
            // 3. -. label .->
            // 4. == label ===
            const patterns = [
                `|${currentLabel}|`,
                ` ${currentLabel} `
            ];

            for (const pat of patterns) {
                if (line.includes(pat)) {
                    lines[i] = line.replace(pat, pat.replace(currentLabel, newLabel));
                    replaced = true;
                    break;
                }
            }

            // もし完全なパターンにマッチしなくても、単語として見つかれば置換する（フォールバック）
            if (!replaced) {
                const idx = line.indexOf(currentLabel);
                if (idx > -1 && line.includes('-')) { // 少なくとも矢印らしいハイフンが含まれている行
                    lines[i] = line.substring(0, idx) + newLabel + line.substring(idx + currentLabel.length);
                    replaced = true;
                }
            }

            if (replaced) break;
        }

        if (!replaced) {
            console.warn('[MermaidInteraction] エッジラベルが見つかりません:', currentLabel);
            return;
        }

        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                const preview = document.getElementById('preview');
                if (!preview) return;

                let newDiagramWrapper = null;
                let newCodeBlockWrapper = null;

                if (savedCodeIndex !== undefined) {
                    newCodeBlockWrapper = document.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = document.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
                    if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                }

                if (newDiagramWrapper) {
                    newDiagramWrapper.classList.add('mermaid-edit-mode');
                    if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                        InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                        if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                    }
                    if (newCodeBlockWrapper) {
                        const editBtn = newCodeBlockWrapper.querySelector('.code-edit-btn');
                        if (editBtn && !editBtn.classList.contains('mermaid-done-mode')) {
                            const doneLabel = typeof I18n !== 'undefined' ? (I18n.translate('editor.done') || '完了') : '完了';
                            editBtn.textContent = doneLabel;
                            editBtn.classList.add('mermaid-done-mode');
                            editBtn._originalOnclick = editBtn.onclick;
                            editBtn.onclick = (ev) => {
                                ev.stopPropagation();
                                if (typeof InlineCodeEditor !== 'undefined') InlineCodeEditor.exitMermaidEdit();
                            };
                        }
                    }
                    if (window.activeMermaidToolbar) {
                        window.activeMermaidToolbar.show(newDiagramWrapper);
                    }
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`矢印のラベルを「${newLabel}」に変更しました`, 'success');
    }

    /**
     * Mermaidソース内のエッジ（矢印）に新規ラベルを追加して再描画する。
     */
    function addMermaidEdgeLabel(wrapper, fromId, toId, newLabel) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx   = dataLine - 1;

        const isMermaidLine = (l) => /^\s*(?:```|~~~)mermaid/.test(l || '');
        if (!isMermaidLine(lines[startIdx])) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                if (isMermaidLine(lines[startIdx + d])) { found = startIdx + d; break; }
            }
            if (found === -1) return;
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        let replaced = false;

        // "fromId --> toId" のような行を探し、"fromId -->|newLabel| toId" にする
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (line.includes(fromId) && line.includes(toId)) {
                if (line.includes('-->')) {
                    lines[i] = line.replace('-->', `-->|${newLabel}|`);
                    replaced = true;
                    break;
                } else if (line.includes('-.->')) {
                    lines[i] = line.replace('-.->', `-.->|${newLabel}|`);
                    replaced = true;
                    break;
                } else if (line.includes('==>')) {
                    lines[i] = line.replace('==>', `==>|${newLabel}|`);
                    replaced = true;
                    break;
                } else if (line.includes('---')) {
                    lines[i] = line.replace('---', `---|${newLabel}|`);
                    replaced = true;
                    break;
                }
            }
        }

        if (!replaced) {
            console.warn('[MermaidInteraction] 対象のエッジが見つかりません:', fromId, toId);
            return;
        }

        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                const preview = document.getElementById('preview');
                if (!preview) return;

                let newDiagramWrapper = null;
                let newCodeBlockWrapper = null;

                if (savedCodeIndex !== undefined) {
                    newCodeBlockWrapper = document.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = document.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
                    if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                }

                if (newDiagramWrapper) {
                    newDiagramWrapper.classList.add('mermaid-edit-mode');
                    if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                        InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                        if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                    }
                    if (newCodeBlockWrapper) {
                        const editBtn = newCodeBlockWrapper.querySelector('.code-edit-btn');
                        if (editBtn && !editBtn.classList.contains('mermaid-done-mode')) {
                            const doneLabel = typeof I18n !== 'undefined' ? (I18n.translate('editor.done') || '完了') : '完了';
                            editBtn.textContent = doneLabel;
                            editBtn.classList.add('mermaid-done-mode');
                            editBtn._originalOnclick = editBtn.onclick;
                            editBtn.onclick = (ev) => {
                                ev.stopPropagation();
                                if (typeof InlineCodeEditor !== 'undefined') InlineCodeEditor.exitMermaidEdit();
                            };
                        }
                    }
                    if (window.activeMermaidToolbar) {
                        window.activeMermaidToolbar.show(newDiagramWrapper);
                    }
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`矢印にラベル「${newLabel}」を追加しました`, 'success');
    }


    /** 正規表現用エスケープ */
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ── ノードドラッグ機能 ────────────────────────────────────

    /**
     * ドラッグ中にノードに追従するゴースト要素を生成する。
     * @param {DOMRect} nodeRect - ノードのBoundingClientRect
     * @param {Element} wrapper  - .mermaid-diagram-wrapper
     * @param {string}  label    - ゴーストに表示するラベルテキスト
     * @returns {HTMLElement} ghost要素
     */
    function createNodeGhost(nodeRect, wrapper, label) {
        const wRect = wrapper.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'mermaid-node-ghost';
        ghost.textContent = label || '';
        ghost.style.width  = `${nodeRect.width}px`;
        ghost.style.height = `${nodeRect.height}px`;
        // 初期位置をノードの現在位置に合わせる
        ghost.style.left = `${nodeRect.left - wRect.left}px`;
        ghost.style.top  = `${nodeRect.top  - wRect.top}px`;
        wrapper.style.position = 'relative';
        wrapper.appendChild(ghost);
        return ghost;
    }

    /**
     * ゴースト要素の位置をマウス座標（wrapper相対）に合わせて更新する。
     * @param {HTMLElement} ghost
     * @param {number} mx - wrapperローカルX（px）
     * @param {number} my - wrapperローカルY（px）
     * @param {number} offsetX - マウスとゴースト左端の差（px）
     * @param {number} offsetY - マウスとゴースト上端の差（px）
     */
    function moveNodeGhost(ghost, mx, my, offsetX, offsetY) {
        ghost.style.left = `${mx - offsetX}px`;
        ghost.style.top  = `${my - offsetY}px`;
    }

    /**
     * ゴースト要素を削除する。
     * @param {HTMLElement} ghost
     */
    function removeNodeGhost(ghost) {
        if (ghost && ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
        }
    }

    /**
     * wrapper相対座標 (mx, my) の位置にあるsubgraph要素を探す。
     * @param {number}  mx      - wrapperローカルX
     * @param {number}  my      - wrapperローカルY
     * @param {Element} svgEl
     * @param {Element} wrapper
     * @param {string}  excludeId - 除外するノードID（ドラッグ中のノード自身）
     * @returns {{el: Element, id: string}|null}
     */
    function findSubgraphAtPoint(mx, my, svgEl, wrapper, excludeId) {
        const wRect = wrapper.getBoundingClientRect();

        // ── Mermaidソースから subgraph ID を取得 ──
        // Mermaid v11 では g.clusters が空なことがあるため、
        // ソースを直接パースしてsubgraphのIDを列挙する。
        const range = getMermaidBlockRange(wrapper);
        const subgraphIds = new Set();
        if (range) {
            for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                const m = range.lines[i].match(/^\s*subgraph\s+([^\s\[\]]+)/);
                if (m) subgraphIds.add(m[1]);
            }
        }

        // ── ソース解析でsubgraph IDが得られた場合：SVGをID検索 ──
        if (subgraphIds.size > 0) {
            // 各subgraphIDに対応するSVG g 要素を収集
            const candidates = [];
            subgraphIds.forEach(sgId => {
                if (sgId === excludeId) return;
                // Mermaid v11: IDパターンは {diagramId}-{sgId} （末尾一致で探索）
                // v11のsubgraphは必ずclass="cluster"を持つため絞り込み可能
                // Mermaid v10: flowchart-{ID}-N, cluster-{ID}, cluster_{ID}
                const selector = [
                    `g.cluster[id$="-${sgId}"]`,   // v11: {diagId}-{sgId} かつ cluster クラス（誤マッチ防止）
                    `g.node[id$="-${sgId}"]`,      // v11: 空のsubgraphが g.node になる場合への対応
                    `g[id^="flowchart-${sgId}-"]`,  // v10: flowchart-プレフィックス
                    `g[id^="cluster-${sgId}"]`,     // v10: cluster-プレフィックス
                    `g[id="cluster_${sgId}"]`,      // v10: cluster_形式
                    `g[id="${sgId}"]`,              // 完全一致
                ].join(', ');
                try {
                    Array.from(svgEl.querySelectorAll(selector)).forEach(el => {
                        // 重複登録防止
                        if (!candidates.find(c => c.el === el)) candidates.push({ el, id: sgId });
                    });
                } catch (_) { /* 無効なセレクタの場合は無視 */ }

                // data-id属性で照合（v11では未設定の場合もある）
                Array.from(svgEl.querySelectorAll(`g[data-id="${sgId}"]`)).forEach(el => {
                    if (!candidates.find(c => c.el === el)) candidates.push({ el, id: sgId });
                });
            });


            // 面積昇順（小さい方＝ネストが深い方を優先）
            candidates.sort((a, b) => {
                const ra = a.el.getBoundingClientRect();
                const rb = b.el.getBoundingClientRect();
                return (ra.width * ra.height) - (rb.width * rb.height);
            });

            for (const { el, id } of candidates) {
                let r = el.getBoundingClientRect();

                // v11: getBoundingClientRectが(0,0,0,0)を返すSVG要素がある場合の代替計算
                if (r.width === 0 && r.height === 0 && el.getBBox) {
                    try {
                        const bbox = el.getBBox();
                        const ctm = el.getScreenCTM();
                        if (ctm && bbox.width > 0) {
                            const p1 = svgEl.createSVGPoint();
                            p1.x = bbox.x; p1.y = bbox.y;
                            const p2 = svgEl.createSVGPoint();
                            p2.x = bbox.x + bbox.width; p2.y = bbox.y + bbox.height;
                            const c1 = p1.matrixTransform(ctm);
                            const c2 = p2.matrixTransform(ctm);
                            r = { left: c1.x, top: c1.y, right: c2.x, bottom: c2.y,
                                  width: c2.x - c1.x, height: c2.y - c1.y };
                        }
                    } catch (_) { /* getBBox失敗時は無視 */ }
                }

                const left   = r.left   - wRect.left;
                const top    = r.top    - wRect.top;
                const right  = r.right  - wRect.left;
                const bottom = r.bottom - wRect.top;
                if (mx >= left && mx <= right && my >= top && my <= bottom) {
                    return { el, id };
                }
            }
        }

        // ── フォールバック1: g.clusters 直下の子 g 要素 ──
        // Mermaid v11 では g.clusters が2重ネストすることがあるため querySelectorAll で全て収集する
        const allClustersContainers = Array.from(svgEl.querySelectorAll('g.clusters'));
        // 最初に見つかったコンテナ（フォールバック2用）
        const clustersContainer = allClustersContainers[0] || null;
        {
            // 全コンテナから直接の子 g 要素を収集（重複排除）
            const seenEls = new Set();
            const subgraphEls = [];
            for (const container of allClustersContainers) {
                for (const child of Array.from(container.children)) {
                    if (child.tagName === 'g' && !seenEls.has(child)) {
                        seenEls.add(child);
                        subgraphEls.push(child);
                    }
                }
            }
            subgraphEls.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (ra.width * ra.height) - (rb.width * rb.height);
            });
            for (const sg of subgraphEls) {
                // v11: getMermaidNodeIdは "SG1" を返すべきだが、subgraphIdsと照合して確実に正規IDを得る
                let id = getMermaidNodeId(sg);
                // subgraphIdsと照合: getMermaidNodeIdが正しくない場合のフォールバック
                if (id && subgraphIds.size > 0 && !subgraphIds.has(id)) {
                    // SVGのIDの末尾がsubgraphIdと一致するものを探す
                    const matched = Array.from(subgraphIds).find(sgId => sg.id.endsWith('-' + sgId) || sg.id === sgId);
                    if (matched) id = matched;
                }
                if (!id || id === excludeId) continue;
                const r = sg.getBoundingClientRect();
                const left   = r.left   - wRect.left;
                const top    = r.top    - wRect.top;
                const right  = r.right  - wRect.left;
                const bottom = r.bottom - wRect.top;
                if (mx >= left && mx <= right && my >= top && my <= bottom) {
                    return { el: sg, id };
                }
            }
        }

        // ── フォールバック2: document.elementsFromPoint ──
        const clientX = mx + wRect.left;
        const clientY = my + wRect.top;
        const hitElements = document.elementsFromPoint(clientX, clientY);
        for (const el of hitElements) {
            if (el.classList && (
                el.classList.contains('mermaid-node-ghost') ||
                el.classList.contains('mermaid-overlay-svg') ||
                el.classList.contains('mermaid-connect-handle')
            )) continue;

            // g.clusters の子孫なら祖先の直子を探す（全コンテナ対象）
            for (const container of allClustersContainers) {
                if (container.contains(el) && el !== container) {
                    let sg = el;
                    while (sg && sg.parentElement !== container) sg = sg.parentElement;
                    if (sg && sg.tagName === 'g') {
                        let id = getMermaidNodeId(sg);
                        // subgraphIdsと照合して正規IDに正規化
                        if (id && subgraphIds.size > 0 && !subgraphIds.has(id)) {
                            const matched = Array.from(subgraphIds).find(sgId => sg.id.endsWith('-' + sgId) || sg.id === sgId);
                            if (matched) id = matched;
                        }
                        if (id && id !== excludeId) {
                            return { el: sg, id };
                        }
                        break; // このコンテナで確定
                    }
                }
            }

            const clsVal = (el.className && el.className.baseVal !== undefined)
                ? el.className.baseVal : String(el.className || '');
            let cluster = null;
            if (el.tagName && el.tagName.toLowerCase() === 'g' && clsVal.includes('cluster') && !clsVal.includes('clusters')) {
                cluster = el;
            } else if (el.closest) {
                cluster = el.closest('g.cluster') || el.closest('g[class*="cluster"]:not(.clusters)');
            }
            if (!cluster || !svgEl.contains(cluster)) continue;
            let id = getMermaidNodeId(cluster);
            // subgraphIdsと照合して正規IDに正規化
            if (id && subgraphIds.size > 0 && !subgraphIds.has(id)) {
                const matched = Array.from(subgraphIds).find(sgId => cluster.id.endsWith('-' + sgId) || cluster.id === sgId);
                if (matched) id = matched;
            }
            if (!id || id === excludeId) continue;
            return { el: cluster, id };
        }

        return null;
    }



    /**
     * Mermaidソース内で指定ノードが属するsubgraphを探す。
     * @param {string[]} lines     - Mermaidブロック全行（lines配列）
     * @param {number}   startIdx  - ブロック開始行インデックス（```mermaid行）
     * @param {number}   endIdx    - ブロック終了行インデックス（```行）
     * @param {string}   nodeId    - 検索するノードID
     * @returns {{subId: string, subStart: number, subEnd: number}|null}
     */
    function findNodeCurrentSubgraph(lines, startIdx, endIdx, nodeId) {
        // subgraphスタックを使って現在の所属subgraphを特定する
        const stack = []; // { id, start }のスタック
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            // subgraph ID は空白または [ が来る前までを取得（例: "subgraph foo [Label]" → "foo"）
            const subMatch = line.match(/^\s*subgraph\s+([^\s\[\]]+)/);
            if (subMatch) {
                stack.push({ id: subMatch[1], start: i });
                continue;
            }
            if (/^\s*end\s*$/.test(line)) {
                if (stack.length > 0) {
                    const sub = stack.pop();
                    // このsubgraph範囲内でnodeIdが定義されているか確認
                    for (let j = sub.start + 1; j < i; j++) {
                        const ln = lines[j];
                        // 矢印を含まない行でnodeIdが含まれる → ノード定義とみなす
                        if (!arrowPattern.test(ln) && containsNodeIdSimple(ln, nodeId)) {
                            return { subId: sub.id, subStart: sub.start, subEnd: i };
                        }
                    }
                }
                continue;
            }
        }
        return null;
    }

    /**
     * 矢印なしでnodeIdを含む行かを判定するシンプルな版（arrowPattern未定義時のフォールバック用）。
     */
    function containsNodeIdSimple(line, nodeId) {
        const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[\\s\\(\\[\\{])${escaped}([\\s\\(\\[\\{\\)\\]\\}]|$)`).test(line);
    }

    /** 矢印パターン（ノード定義行と接続行を区別するため） */
    const arrowPattern = /-->|--[>-]|==>/;
    // NOTE: arrowPattern は上記で定義済み（findNodeCurrentSubgraph内で参照する定数）

    /**
     * Mermaidソース内で指定subgraphの範囲（start行インデックス、end行インデックス）を探す。
     * @param {string[]} lines
     * @param {number}   startIdx
     * @param {number}   endIdx
     * @param {string}   subgraphId
     * @returns {{subStart: number, subEnd: number}|null}
     */
    function findSubgraphRange(lines, startIdx, endIdx, subgraphId) {
        const esc = subgraphId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const subRegex = new RegExp(`^\\s*subgraph\\s+${esc}(\\s|\\[|$)`);
        let depth = 0;
        let subStart = -1;
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (subRegex.test(line)) {
                subStart = i;
                depth = 0;
                continue;
            }
            if (subStart !== -1) {
                if (/^\s*subgraph\s/.test(line)) { depth++; continue; }
                if (/^\s*end\s*$/.test(line)) {
                    if (depth === 0) return { subStart, subEnd: i };
                    depth--;
                }
            }
        }
        return null;
    }

    /**
     * ノードIDに関連する「定義行」（矢印なし）をブロック内から収集する。
     * subgraph/end 行は含まない。
     * @param {string[]} lines
     * @param {number}   rangeStart - 検索開始行インデックス（exclusive: この行+1から）
     * @param {number}   rangeEnd   - 検索終了行インデックス（exclusive）
     * @param {string}   nodeId
     * @param {boolean}  isTopLevel - trueの場合、他のsubgraph内をスキップ（トップレベル専用）
     * @returns {Array<{idx: number, line: string}>}
     */
    function collectNodeDefLines(lines, rangeStart, rangeEnd, nodeId, isTopLevel = false) {
        const result = [];
        let subgraphDepth = 0; // トップレベル時のsubgraph深度管理

        for (let i = rangeStart + 1; i < rangeEnd; i++) {
            const line = lines[i];

            // トップレベル検索時：subgraphブロック内はスキップ
            if (isTopLevel) {
                if (/^\s*subgraph\s/.test(line)) {
                    subgraphDepth++;
                    continue;
                }
                if (/^\s*end\s*$/.test(line)) {
                    if (subgraphDepth > 0) { subgraphDepth--; }
                    continue;
                }
                if (subgraphDepth > 0) continue; // subgraph内の行はスキップ
            } else {
                if (/^\s*subgraph\s/.test(line) || /^\s*end\s*$/.test(line)) continue;
            }

            if (/^\s*direction\s/.test(line)) continue;
            if (arrowPattern.test(line)) continue; // 矢印行は対象外
            if (containsNodeIdSimple(line, nodeId)) {
                result.push({ idx: i, line });
            }
        }
        return result;
    }

    /**
     * ノードをMermaidソース内で指定subgraphに移動する。
     * エッジ（接続行）は移動しない。
     * @param {Element} wrapper       - .mermaid-diagram-wrapper
     * @param {string}  nodeId        - 移動するノードID
     * @param {string}  targetGroupId - 移動先のsubgraphのID
     */
    function moveNodeToSubgraph(wrapper, nodeId, targetGroupId) {
        if (!nodeId || !targetGroupId || nodeId === targetGroupId) return;

        const range = getMermaidBlockRange(wrapper);
        if (!range) return;
        const { startIdx, endIdx, lines } = range;

        // 移動先subgraphの範囲を取得
        const targetRange = findSubgraphRange(lines, startIdx, endIdx, targetGroupId);
        if (!targetRange) {
            console.warn('[MermaidInteraction] moveNodeToSubgraph: 移動先subgraphが見つかりません:', targetGroupId);
            return;
        }

        // 現在のnodeIdの所属subgraphを取得
        const currentSub = findNodeCurrentSubgraph(lines, startIdx, endIdx, nodeId);

        // 既に対象subgraphに所属している場合は何もしない
        if (currentSub && currentSub.subId === targetGroupId) {
            if (typeof showToast === 'function') showToast('既にそのグループに属しています', 'info');
            return;
        }

        // 検索範囲を決定（現在のsubgraph内 or ブロック全体のトップレベル）
        let searchStart, searchEnd;
        if (currentSub) {
            searchStart = currentSub.subStart;
            searchEnd   = currentSub.subEnd;
        } else {
            // トップレベル：ブロック全体を対象とするが、他のsubgraph内は除く
            searchStart = startIdx;
            searchEnd   = endIdx;
        }

        // ノード定義行を収集（トップレベルの場合は他のsubgraph内をスキップ）
        const defLines = collectNodeDefLines(lines, searchStart, searchEnd, nodeId, !currentSub);

        if (defLines.length === 0) {
            // 定義行がない場合（接続行にのみ登場するノード）→ 新規に定義を追加
            defLines.push({ idx: -1, line: `    ${nodeId}` });
        }

        // 定義行のテキストを保存し、元の位置から削除するインデックスを収集
        const defTexts = defLines.map(d => d.line.trim());
        const deleteIndices = new Set(defLines.filter(d => d.idx >= 0).map(d => d.idx));

        // Mermaidブロック（startIdx〜endIdx）の行を組み直す
        // 削除対象を除外しつつ、移動先subgraphのend行直前に定義行を挿入する
        const blockLines = [];
        let insertionDone = false;

        for (let i = startIdx; i <= endIdx; i++) {
            if (deleteIndices.has(i)) {
                // 削除対象行はスキップ
                continue;
            }

            // 移動先subgraphのend行（元のインデックスで判定）の直前に定義行を挿入
            if (!insertionDone && i === targetRange.subEnd) {
                defTexts.forEach(t => blockLines.push(`    ${t}`));
                insertionDone = true;
            }

            blockLines.push(lines[i]);
        }

        // フォールバック：挿入が完了していない場合
        if (!insertionDone) {
            console.warn('[MermaidInteraction] moveNodeToSubgraph: 挿入位置が特定できませんでした。ブロック末尾に追記します。');
            blockLines.splice(blockLines.length - 1, 0, ...defTexts.map(t => `    ${t}`));
        }

        // blockLines（startIdx〜endIdx範囲）をエディタ全行配列に書き戻す
        // applyEditorTextAndRestore には全行配列を渡す必要がある
        lines.splice(startIdx, endIdx - startIdx + 1, ...blockLines);

        applyEditorTextAndRestore(wrapper, lines);
        if (typeof showToast === 'function') {
            showToast(`「${nodeId}」を「${targetGroupId}」グループに移動しました`, 'success');
        }
    }

    /**
     * ノードをMermaidソース内のsubgraphから取り出してトップレベルに移動する。
     * すでにトップレベルにある場合は何もしない。
     * @param {Element} wrapper - .mermaid-diagram-wrapper
     * @param {string}  nodeId  - 移動するノードID
     */
    function moveNodeToTopLevel(wrapper, nodeId) {
        if (!nodeId) return;

        const range = getMermaidBlockRange(wrapper);
        if (!range) return;
        const { startIdx, endIdx, lines } = range;

        // 現在の所属subgraphを確認
        const currentSub = findNodeCurrentSubgraph(lines, startIdx, endIdx, nodeId);
        if (!currentSub) {
            // 既にトップレベル → 何もしない
            return;
        }

        // 現在のsubgraph内からノード定義行を収集
        const defLines = collectNodeDefLines(lines, currentSub.subStart, currentSub.subEnd, nodeId, false);

        if (defLines.length === 0) {
            // 定義行がない場合（接続行にのみ登場するノード）→ 新規に定義を追加
            defLines.push({ idx: -1, line: `    ${nodeId}` });
        }

        // 定義行のテキストを保存し、元の位置から削除するインデックスを収集
        const defTexts = defLines.map(d => d.line.trim());
        const deleteIndices = new Set(defLines.filter(d => d.idx >= 0).map(d => d.idx));

        // Mermaidブロック（startIdx〜endIdx）の行を組み直す
        // 削除対象を除外しつつ、ブロックの終端（```行）の直前にトップレベルとして挿入する
        const blockLines = [];
        let insertionDone = false;

        for (let i = startIdx; i <= endIdx; i++) {
            if (deleteIndices.has(i)) {
                // 削除対象行はスキップ
                continue;
            }

            // ブロック終端行（```）の直前にトップレベル定義を挿入
            if (!insertionDone && i === endIdx) {
                defTexts.forEach(t => blockLines.push(`    ${t}`));
                insertionDone = true;
            }

            blockLines.push(lines[i]);
        }

        if (!insertionDone) {
            blockLines.splice(blockLines.length - 1, 0, ...defTexts.map(t => `    ${t}`));
        }

        lines.splice(startIdx, endIdx - startIdx + 1, ...blockLines);

        applyEditorTextAndRestore(wrapper, lines);
        if (typeof showToast === 'function') {
            showToast(`「${nodeId}」をグループから外しました`, 'success');
        }
    }

    // ── イベント初期化 ─────────────────────────────────────────


    /**
     * 矢印のクリック判定を広げるための透明な当たり判定パスを生成・追加する。
     */
    function enhanceEdgeHitboxes(wrapper) {
        // flowchart-v2 などでは .edgePaths などのクラスがない場合があるため、
        // 矢印（marker-endを持つpath）、または .edgePath に属するpath、または idがL-から始まるpath を探す
        let edgePaths = Array.from(wrapper.querySelectorAll('path[marker-end]:not(.edge-hitbox), .edgePath path:not(.edge-hitbox), path.flowchart-link:not(.edge-hitbox), path[id^="L-"]:not(.edge-hitbox)'));
        
        // Mermaidが独自生成した透明な判定用パスは除外する
        edgePaths = edgePaths.filter(el => {
            return el.getAttribute('stroke') !== 'transparent' && el.style.stroke !== 'transparent' && el.getAttribute('opacity') !== '0' && el.style.opacity !== '0';
        });
        
        // 重複を排除
        edgePaths = [...new Set(edgePaths)];

        // console.log('[MermaidInteraction] enhanceEdgeHitboxes: 対象のパス数 =', edgePaths.length);
        edgePaths.forEach(path => {
            // すでにヒットボックスがあればスキップ
            if (path.dataset.hasHitbox) return;
            path.dataset.hasHitbox = 'true';
            
            const hitbox = path.cloneNode(true);
            hitbox.classList.add('edge-hitbox');
            delete hitbox.dataset.hasHitbox;

            if (hitbox.id) hitbox.id = hitbox.id + '-hitbox';
            
            // 見た目は透明にし、太さを24pxにして当たり判定を広げる
            hitbox.style.setProperty('stroke', 'transparent', 'important');
            hitbox.style.setProperty('stroke-width', '24px', 'important');
            hitbox.style.setProperty('fill', 'none', 'important');
            hitbox.style.setProperty('pointer-events', 'stroke', 'important');
            hitbox.style.setProperty('cursor', 'pointer', 'important');
            hitbox.style.setProperty('stroke-dasharray', 'none', 'important');
            
            // pathはマーカー（矢印の先）を持っているので、ヒットボックスからは外す
            hitbox.removeAttribute('marker-end');
            hitbox.removeAttribute('marker-start');
            hitbox.removeAttribute('stroke-dasharray');

            path.parentNode.appendChild(hitbox);
            // console.log('[MermaidInteraction] ヒットボックスを追加しました:', hitbox);
        });
    }

    /**
     * ダイアグラムコンテナにインタラクションを初期化する。
     * processMermaidDiagrams() から呼び出される。
     * @param {Element} wrapper  - .mermaid-diagram-wrapper
     * @param {string}  source   - Mermaidソーステキスト
     */
    function initDiagram(wrapper, source) {
        // flowchart / graph 以外は非対応
        if (getDiagramType(source) !== 'flowchart') return;

        const svgEl = wrapper.querySelector('svg');
        if (!svgEl) return;

        const overlay = ensureOverlay(wrapper);

        // 編集モード時のマウスエンターでヒットボックスを追加
        wrapper.addEventListener('mouseenter', () => {
            if (wrapper.classList.contains('mermaid-edit-mode')) {
                enhanceEdgeHitboxes(wrapper);
            }
        });

        // SVGの再描画やクラス変更を監視してヒットボックスを確実に追加する
        const observer = new MutationObserver((mutations) => {
            let shouldEnhance = false;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    shouldEnhance = true;
                    break;
                }
                if (m.type === 'attributes' && m.attributeName === 'class' && m.target === wrapper) {
                    shouldEnhance = true;
                    break;
                }
            }
            if (shouldEnhance && wrapper.classList.contains('mermaid-edit-mode')) {
                // DOM構築直後を待つために少し遅延
                setTimeout(() => enhanceEdgeHitboxes(wrapper), 100);
            }
        });
        observer.observe(wrapper, { childList: true, subtree: true, attributes: true });

        const selectedNodes = new Set();
        const selectedEdges = new Set();
        let nodes = [];

        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function containsNodeId(text, mId) {
            // IDの直後には空白、閉じ括弧類、矢印記号のほかに、定義開始の開き括弧（[ { (など）も来うる
            const regex = new RegExp(`(^|[\\s\\(\\[\\{\\|\\->])` + escapeRegExp(mId) + `([\\s\\(\\[\\{\\)\\]\\}\\|\\->]|$)`);
            return regex.test(text);
        }

        function calculateInsertLineIndex(lines, startIdx, endIdx, selectedSet) {
            let insertIdx = endIdx;
            
            // 単一のノードが選択されているか
            if (selectedSet && selectedSet.size === 1) {
                const targetId = Array.from(selectedSet)[0];
                
                // targetId が subgraph として定義されているか探す
                let subgraphStartLine = -1;
                const subgraphRegex = new RegExp(`^\\s*subgraph\\s+${escapeRegExp(targetId)}(\\s|\\[|$)`);
                
                for (let i = startIdx + 1; i < endIdx; i++) {
                    if (subgraphRegex.test(lines[i])) {
                        subgraphStartLine = i;
                        break;
                    }
                }
                
                if (subgraphStartLine !== -1) {
                    // subgraph が見つかったので、そのスコープの end を探す
                    let depth = 0;
                    for (let i = subgraphStartLine + 1; i < endIdx; i++) {
                        const line = lines[i];
                        if (/^\s*subgraph\s/.test(line)) {
                            depth++;
                        } else if (/^\s*end\s*$/.test(line)) {
                            if (depth === 0) {
                                // この end が対象 subgraph の end
                                insertIdx = i; // end の行に挿入 (splice用)
                                break;
                            } else {
                                depth--;
                            }
                        }
                    }
                }
            }
            
            return insertIdx;
        }

        // Mermaidの矢印を分割するための正規表現 (ラベル付きも考慮)
        const arrowSplitRegex = /\s*(?:-->|-\.->|==>|---|--|-\.-)(?:\|[^|]+\|)?\s*/;

        // ── 編集用API（外部やショートカットキーから呼び出せるようにマウント） ──
        wrapper._mermaidAPI = {
            updateSelectionUI: () => updateSelectionUI(),
            restoreSelection: (nodeIds) => {
                // 再描画後に選択状態を外部から復元するためのAPI
                selectedNodes.clear();
                if (nodeIds) nodeIds.forEach(id => selectedNodes.add(id));
                selectedEdges.clear();
                // 復元完了したのでペンディングもクリア
                delete wrapper._pendingSelectedNodes;
                updateSelectionUI();
            },
            hasNodeSelection: () => {
                return selectedNodes.size > 0;
            },
            transformSelection: (shapeType) => {
                if (selectedNodes.size === 0) return;
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;

                const brackets = {
                    'rect': { open: '[', close: ']' },
                    'capsule': { open: '(', close: ')' },
                    'diamond': { open: '{', close: '}' },
                    'doublecircle': { open: '(((', close: ')))' },
                    'circle': { open: '((', close: '))' },
                    'cylinder': { open: '[(', close: ')]' }
                };
                const targetBrackets = brackets[shapeType];
                if (!targetBrackets) return;

                const allBracketPairs = [
                    { open: '(((', close: ')))' },
                    { open: '([', close: '])' },
                    { open: '[(', close: ')]' },
                    { open: '{{', close: '}}' },
                    { open: '((', close: '))' },
                    { open: '[', close: ']' },
                    { open: '{', close: '}' },
                    { open: '(', close: ')' },
                ];

                for (const mId of selectedNodes) {
                    let replaced = false;
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        let line = range.lines[i];
                        if (!line.includes(mId)) continue;
                        
                        for (const { open, close } of allBracketPairs) {
                            const searchStr = mId + open;
                            let searchFrom = 0;
                            while (true) {
                                const found = line.indexOf(searchStr, searchFrom);
                                if (found === -1) break;
                                if (found === 0 || !/\\w/.test(line[found - 1])) {
                                    const labelStart = found + searchStr.length;
                                    const closePos = line.indexOf(close, labelStart);
                                    if (closePos !== -1) {
                                        const label = line.substring(labelStart, closePos);
                                        range.lines[i] = line.substring(0, found) + mId + targetBrackets.open + label + targetBrackets.close + line.substring(closePos + close.length);
                                        replaced = true;
                                        break;
                                    }
                                }
                                searchFrom = found + 1;
                            }
                            if (replaced) break;
                        }
                        if (replaced) break;
                    }

                    if (!replaced) {
                        const targetIdx = calculateInsertLineIndex(range.lines, range.startIdx, range.endIdx, selectedNodes);
                        range.lines.splice(targetIdx, 0, `    ${mId}${targetBrackets.open}${mId}${targetBrackets.close}`);
                    }
                }
                
                applyEditorTextAndRestore(wrapper, range.lines);
                if (typeof showToast === 'function') showToast(`ノードを変形しました`, 'success');
            },
            getInsertTargetIndex: () => {
                const range = getMermaidBlockRange(wrapper);
                if (!range) return -1;
                return calculateInsertLineIndex(range.lines, range.startIdx, range.endIdx, selectedNodes);
            },
            deleteSelection: () => {
                if (selectedNodes.size === 0 && selectedEdges.size === 0) return;
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;
                const { startIdx, endIdx, lines } = range;

                // 削除対象のエッジ情報を抽出
                const edgesToRemove = [];
                selectedEdges.forEach(edge => {
                    const idMatch = edge.id ? edge.id.match(/^L-(.+?)-(.+?)-\d+/) : null;
                    if (idMatch) {
                        edgesToRemove.push({ from: idMatch[1], to: idMatch[2] });
                    } else if (edge.classList) {
                        let fromMatch = null, toMatch = null;
                        edge.classList.forEach(cls => {
                            if (cls.startsWith('LS-')) fromMatch = cls.substring(3);
                            if (cls.startsWith('LE-')) toMatch = cls.substring(3);
                        });
                        if (fromMatch && toMatch) edgesToRemove.push({ from: fromMatch, to: toMatch });
                    }
                });

                // サブグラフ全体の削除対象行を特定
                const subgraphLinesToRemove = new Set();
                for (const mId of selectedNodes) {
                    const subRange = findSubgraphRange(lines, startIdx, endIdx, mId);
                    if (subRange) {
                        for (let i = subRange.subStart; i <= subRange.subEnd; i++) {
                            subgraphLinesToRemove.add(i);
                        }
                    }
                }

                const newLines = [];
                for (let i = startIdx + 1; i < endIdx; i++) {
                    // サブグラフ削除の対象行なら無条件でスキップ（ブロックごと削除）
                    if (subgraphLinesToRemove.has(i)) continue;

                    const line = lines[i];
                    let hasTargetNode = false;
                    let hasTargetEdge = false;

                    // この行が削除対象のノードを含んでいるか？
                    for (const mId of selectedNodes) {
                        if (containsNodeId(line, mId)) {
                            hasTargetNode = true;
                            break;
                        }
                    }

                    // この行が削除対象のエッジを含んでいるか？
                    if (!hasTargetNode) {
                        for (const edge of edgesToRemove) {
                            if (containsNodeId(line, edge.from) && containsNodeId(line, edge.to) && arrowSplitRegex.test(line)) {
                                hasTargetEdge = true;
                                break;
                            }
                        }
                    }

                    if (hasTargetNode || hasTargetEdge) {
                        // 削除対象が含まれる場合、行を矢印で分割して、残すべきノード定義を救出する
                        const fragments = line.split(arrowSplitRegex).map(s => s.trim()).filter(s => s);
                        
                        if (fragments.length <= 1) {
                            // 矢印がない単一ノードの行で、削除対象なら何も残さない
                            if (!hasTargetNode) {
                                newLines.push(line);
                            }
                        } else {
                            // 矢印で繋がれていた場合、それぞれの破片を検証
                            fragments.forEach(frag => {
                                let fragHasTargetNode = false;
                                for (const mId of selectedNodes) {
                                    if (containsNodeId(frag, mId)) {
                                        fragHasTargetNode = true;
                                        break;
                                    }
                                }
                                // 破片自身が削除対象ノードを含んでいなければ、ノード定義として残す
                                if (!fragHasTargetNode) {
                                    newLines.push(`    ${frag}`);
                                }
                            });
                        }
                    } else {
                        // 削除対象が一切含まれない行はそのまま残す
                        newLines.push(line);
                    }
                }

                // 書き戻しと再描画
                lines.splice(startIdx + 1, endIdx - startIdx - 1, ...newLines);
                applyEditorTextAndRestore(wrapper, lines);
                selectedNodes.clear();
                selectedEdges.clear();
            },
            copySelection: () => {
                if (selectedNodes.size === 0) return;
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;

                const copiedNodes = [];
                const allNodeIds = collectNodes(svgEl).map(n => n.id).filter(id => id);

                // 選択されたノードの定義を探す
                for (const mId of selectedNodes) {
                    let bestDef = mId; // デフォルトはIDのみ
                    let isSubgraph = false;
                    let blockLines = [];
                    let internalNodes = [];
                    
                    // subgraphかどうかチェック
                    const subRange = findSubgraphRange(range.lines, range.startIdx, range.endIdx, mId);
                    if (subRange) {
                        isSubgraph = true;
                        bestDef = range.lines[subRange.subStart].trim();
                        blockLines = range.lines.slice(subRange.subStart + 1, subRange.subEnd);
                        // このsubgraph(または子孫)に属する内部ノードを特定
                        internalNodes = allNodeIds.filter(nId => {
                            let curr = findNodeCurrentSubgraph(range.lines, range.startIdx, range.endIdx, nId);
                            const visited = new Set();
                            while (curr && !visited.has(curr.subId)) {
                                if (curr.subId === mId) return true;
                                visited.add(curr.subId);
                                curr = findNodeCurrentSubgraph(range.lines, range.startIdx, range.endIdx, curr.subId);
                            }
                            return false;
                        });
                    }

                    if (!isSubgraph) {
                        for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                            const line = range.lines[i];
                            // 矢印で分割した各破片の中で探す
                            const fragments = line.split(arrowSplitRegex).map(s => s.trim()).filter(s => s);
                            for (const frag of fragments) {
                                if (containsNodeId(frag, mId)) {
                                    // もしこの破片が形状定義を持っているなら、これを採用
                                    if (/[\(\[\{>]/.test(frag)) {
                                        bestDef = frag;
                                        break; // 良い定義を見つけたらこの行の探索は終了
                                    }
                                }
                            }
                            if (bestDef !== mId) break; // すでに良い定義を見つけたら他の行も探索終了
                        }
                    }
                    copiedNodes.push({ id: mId, def: bestDef, isSubgraph, blockLines, internalNodes });
                }

                _clipboard = copiedNodes;
                if (typeof showToast === 'function') showToast(`コピーしました (${copiedNodes.length}件)`, 'success');
            },
            pasteSelection: () => {
                if (!_clipboard || _clipboard.length === 0) return;
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;

                // 既存のID一覧を取得して、重複しない新しいIDを生成
                const existingIds = new Set();
                for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                    const line = range.lines[i];
                    // ざっくりIDと思われる英数字を取得
                    const words = line.split(/[\s\[\(\{>\|\-]+/);
                    words.forEach(w => { if (w) existingIds.add(w); });
                }

                const pastedLines = [];
                const newSelectedIds = new Set();

                _clipboard.forEach(node => {
                    let newId = `${node.id}_copy`;
                    let counter = 1;
                    while (existingIds.has(newId)) {
                        newId = `${node.id}_copy${counter}`;
                        counter++;
                    }
                    existingIds.add(newId);
                    newSelectedIds.add(newId);

                    const escId = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    if (node.isSubgraph) {
                        // 1. サブグラフ自身の開始行を置換
                        const newDef = node.def.replace(new RegExp(`^subgraph\\s+${escId}`), `subgraph ${newId}`);
                        pastedLines.push(`    ${newDef}`);
                        
                        // 2. 内部ノードのIDマッピングを作成
                        const internalIdMap = {};
                        (node.internalNodes || []).forEach(nId => {
                            let newInternalId = `${nId}_copy`;
                            let c = 1;
                            while (existingIds.has(newInternalId)) {
                                newInternalId = `${nId}_copy${c}`;
                                c++;
                            }
                            existingIds.add(newInternalId);
                            internalIdMap[nId] = newInternalId;
                        });

                        // 3. 内部行のノードIDを置換
                        (node.blockLines || []).forEach(line => {
                            let replacedLine = line;
                            Object.keys(internalIdMap).forEach(oldNodeId => {
                                const newNodeId = internalIdMap[oldNodeId];
                                const escOld = oldNodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                // ノードIDの境界(行頭/スペース/カッコ/矢印など)を考慮して置換
                                const regex = new RegExp(`(^|[\\s\\(\\[\\{\\|\\->])` + escOld + `(?=[\\s\\(\\[\\{\\)\\]\\}\\|\\->]|$)`, 'g');
                                replacedLine = replacedLine.replace(regex, (match, p1) => {
                                    return p1 + newNodeId;
                                });
                            });
                            // subgraph定義自体が内部に含まれている場合（ネスト）のID置換
                            if (/^\s*subgraph\s/.test(replacedLine)) {
                                Object.keys(internalIdMap).forEach(oldNodeId => {
                                    const newNodeId = internalIdMap[oldNodeId];
                                    const escOld = oldNodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    replacedLine = replacedLine.replace(new RegExp(`(^\\s*subgraph\\s+)${escOld}(\\s|\\[|$)`), `$1${newNodeId}$2`);
                                });
                            }
                            pastedLines.push(replacedLine);
                        });

                        pastedLines.push(`    end`);
                    } else {
                        // 定義のID部分を新しいIDに置換して挿入
                        const newDef = node.def.replace(new RegExp(`^${escId}`), newId);
                        pastedLines.push(`    ${newDef}`);
                    }
                });

                const targetIdx = calculateInsertLineIndex(range.lines, range.startIdx, range.endIdx, selectedNodes);
                range.lines.splice(targetIdx, 0, ...pastedLines);
                applyEditorTextAndRestore(wrapper, range.lines);
                
                // 貼り付けたものを選択状態にする
                selectedNodes.clear();
                selectedEdges.clear();
                newSelectedIds.forEach(id => selectedNodes.add(id));
            },
            toggleDirection: () => {
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;

                const cycleDir = ['TB', 'LR', 'BT', 'RL'];
                const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const getNextDir = (curr) => {
                    if (curr === 'TD') curr = 'TB';
                    const idx = cycleDir.indexOf(curr);
                    return idx !== -1 ? cycleDir[(idx + 1) % cycleDir.length] : 'LR';
                };

                // 選択中ノードの中に subgraph として定義されているものがあるかチェック
                // selectedNodesが空の場合、500ms復元待機中の可能性があるため、
                // _pendingSelectedNodes(前回の意図した選択)をフォールバックとして使用する
                const effectiveSelectedNodes = selectedNodes.size > 0
                    ? selectedNodes
                    : (wrapper._pendingSelectedNodes || new Set());

                let targetSubgraphId = null;
                for (const mId of effectiveSelectedNodes) {
                    const subRegex = new RegExp(`^\\s*subgraph\\s+${escRe(mId)}(\\s|\\[|$)`);
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        if (subRegex.test(range.lines[i])) {
                            targetSubgraphId = mId;
                            break;
                        }
                    }
                    if (targetSubgraphId) break;
                }


                if (targetSubgraphId) {
                    // グループの direction を切り替える
                    const subRegex = new RegExp(`^\\s*subgraph\\s+${escRe(targetSubgraphId)}(\\s|\\[|$)`);
                    let subgraphStartIdx = -1;
                    let subgraphEndIdx = -1;
                    let directionLineIdx = -1;
                    let currentDirection = null;

                    // サブグラフの開始行と終端行を探す（ネスト対応）
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        if (subRegex.test(range.lines[i])) {
                            subgraphStartIdx = i;
                            break;
                        }
                    }

                    if (subgraphStartIdx !== -1) {
                        let depth = 1;
                        for (let i = subgraphStartIdx + 1; i < range.endIdx; i++) {
                            const trimmed = range.lines[i].trim();
                            if (/^subgraph\s/.test(trimmed)) depth++;
                            else if (trimmed === 'end') {
                                depth--;
                                if (depth === 0) { subgraphEndIdx = i; break; }
                            }
                        }

                        // サブグラフ内の direction 行を探す
                        for (let i = subgraphStartIdx + 1; i < subgraphEndIdx; i++) {
                            const dirMatch = range.lines[i].match(/^(\s*)direction\s+(TB|TD|LR|RL|BT)\s*$/);
                            if (dirMatch) {
                                directionLineIdx = i;
                                currentDirection = dirMatch[2];
                                break;
                            }
                        }

                        if (directionLineIdx !== -1) {
                            // 既に direction がある場合は次の方向に変更
                            const newDir = getNextDir(currentDirection);
                            range.lines[directionLineIdx] = range.lines[directionLineIdx].replace(/direction\s+\S+/, `direction ${newDir}`);
                        } else {
                            // direction がない場合はデフォルトTBとみなし、LRを追加する
                            range.lines.splice(subgraphStartIdx + 1, 0, '    direction LR');
                        }
                    }
                } else {
                    // 全体の direction を切り替える
                    let found = false;
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        const line = range.lines[i];
                        const match = line.match(/^(\s*(?:flowchart|graph)\s+)(TB|TD|LR|RL|BT)\s*$/);
                        if (match) {
                            const newDir = getNextDir(match[2]);
                            range.lines[i] = match[1] + newDir;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        // もし方向指定のない単なる graph や flowchart なら LR をつける
                        for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                            const line = range.lines[i];
                            const match = line.match(/^(\s*(?:flowchart|graph))\s*$/);
                            if (match) {
                                range.lines[i] = match[1] + ' LR';
                                break;
                            }
                        }
                    }
                }

                // 再描画後に選択状態を復元するため、事前にIDを保存しておく
                // selectedNodesが空でも_pendingSelectedNodesを参照したeffectiveSelectedNodesを使う
                const savedSelectedNodes = new Set(effectiveSelectedNodes);
                const savedSelectedEdges = new Set(selectedEdges);

                applyEditorTextAndRestore(wrapper, range.lines, undefined, undefined, {
                    onAfterRestore: (newDiagramWrapper) => {
                        // 拡大表示中の場合はリセット（全体表示に戻す）
                        if (window.MermaidExpandedManager &&
                            (window.MermaidExpandedManager.activeCodeIndex != null ||
                             window.MermaidExpandedManager.activeWrapperLine != null)) {
                            window.MermaidExpandedManager.resetView();
                        }

                        if (newDiagramWrapper && newDiagramWrapper !== wrapper) {
                            // wrapperが差し替わった場合：initDiagram完了待ち後に_mermaidAPI.restoreSelectionで復元
                            // initDiagramはrender()内のsetTimeout(100)で呼ばれるが、
                            // onAfterRestoreはrender()後の更にsetTimeout(100)で呼ばれるため競合する。
                            // 500ms待てば確実にinitDiagramが完了している。
                            // また、待機中に再度toggleDirectionが呼ばれても_pendingSelectedNodesがあるので
                            // グループ切り替えと判定できる。
                            newDiagramWrapper._pendingSelectedNodes = savedSelectedNodes;
                            setTimeout(() => {
                                if (newDiagramWrapper._mermaidAPI && typeof newDiagramWrapper._mermaidAPI.restoreSelection === 'function') {
                                    newDiagramWrapper._mermaidAPI.restoreSelection(savedSelectedNodes);
                                } else {
                                    // さらに500ms後にリトライ
                                    setTimeout(() => {
                                        if (newDiagramWrapper._mermaidAPI && typeof newDiagramWrapper._mermaidAPI.restoreSelection === 'function') {
                                            newDiagramWrapper._mermaidAPI.restoreSelection(savedSelectedNodes);
                                        } else {
                                            delete newDiagramWrapper._pendingSelectedNodes;
                                        }
                                    }, 500);
                                }
                            }, 500);
                        } else {
                            // wrapperが同じ場合：即座に復元
                            selectedNodes.clear();
                            savedSelectedNodes.forEach(id => selectedNodes.add(id));
                            selectedEdges.clear();
                            savedSelectedEdges.forEach(e => selectedEdges.add(e));
                            updateSelectionUI();
                        }
                    }
                });
                if (typeof showToast === 'function') {
                    const msg = targetSubgraphId
                        ? `グループ「${targetSubgraphId}」の縦横(TB/LR)を切り替えました`
                        : `縦横(TB/LR)を切り替えました`;
                    showToast(msg, 'success');
                }

            },
            // 拡大表示など外部から呼び出せるコンテキストメニュー表示API
            showContextMenu: (x, y) => {
                showMermaidContextMenu(x, y, wrapper);
            }
        };

        // ── コンテキストメニュー ──
        wrapper.addEventListener('contextmenu', e => {
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;
            if (e.target.closest('.mermaid-toolbar, .mermaid-edit-toolbar, .mermaid-context-menu')) return;
            e.preventDefault();
            e.stopPropagation();

            // クリック対象を取得し、選択されていない場合はそれを単一選択する
            const nodeEl = e.target.closest('g.node, g.cluster, g[class*="cluster"]:not(.clusters)');
            let edgePathEl = e.target.closest('.edge-hitbox, path[marker-end], .edgePath, .flowchart-link, path[id^="L-"]');
            const edgeLabelEl = e.target.closest('.edgeLabel, g.edgeLabel');

            // ヒットボックスがクリックされた場合は元のパスに変換
            if (edgePathEl && edgePathEl.classList.contains('edge-hitbox')) {
                const originalId = edgePathEl.id ? edgePathEl.id.replace(/-hitbox$/, '') : null;
                const originalPath = originalId ? svgEl.querySelector(`[id="${originalId}"]`) : null;
                edgePathEl = originalPath || edgePathEl.parentNode.querySelector('path:not(.edge-hitbox)') || edgePathEl;
            }
            
            let clickedMId = null;
            if (nodeEl) {
                clickedMId = getMermaidNodeId(nodeEl);
                if (clickedMId && !selectedNodes.has(clickedMId)) {
                    selectedNodes.clear();
                    selectedEdges.clear();
                    selectedNodes.add(clickedMId);
                    updateSelectionUI();
                }
            } else if (edgePathEl || edgeLabelEl) {
                // edgeLabelElがクリックされた場合も親のedgePathElを取得できるか試みる（ここは少し雑ですが、edgePathElが無ければedgeLabelEl自体を無視するフォールバックにもなります）
                const targetEdge = edgePathEl ? (edgePathEl.tagName.toLowerCase() === 'path' ? edgePathEl : edgePathEl.querySelector('path')) : null;
                if (targetEdge && !selectedEdges.has(targetEdge)) {
                    selectedNodes.clear();
                    selectedEdges.clear();
                    selectedEdges.add(targetEdge);
                    updateSelectionUI();
                }
            } else {
                // 余白クリック時
                if (selectedNodes.size === 0 && selectedEdges.size === 0) {
                    // 何も選択されていなければ何もしない（メニューは出す）
                } else {
                    // 選択をクリア
                    selectedNodes.clear();
                    selectedEdges.clear();
                    updateSelectionUI();
                }
            }

            // コンテキストメニューを表示
            showMermaidContextMenu(e.clientX, e.clientY, wrapper);
        });

        // 選択状態のUIを更新するヘルパー関数
        const updateSelectionUI = () => {
            // エッジのハイライト更新
            svgEl.querySelectorAll('.mermaid-edge-selected').forEach(el => {
                el.classList.remove('mermaid-edge-selected');
            });
            selectedEdges.forEach(edge => {
                if (document.contains(edge)) {
                    edge.classList.add('mermaid-edge-selected');
                }
            });

            // ノードのハイライト・ハンドル更新
            clearOverlay(overlay);
            nodes = collectNodes(svgEl);
            selectedNodes.forEach(mId => {
                const nodeInfo = nodes.find(n => n.id === mId);
                if (nodeInfo) {
                    drawHandles(overlay, nodeInfo, wrapper, true);
                }
            });

            // エディタ連携ハイライト
            if (typeof window.highlightEditorLine === 'function') {
                const range = getMermaidBlockRange(wrapper);
                if (range) {
                    let targetLineIndex = -1;
                    if (selectedNodes.size > 0) {
                        const mId = Array.from(selectedNodes)[0];

                        // クラスター（グループ/subgraph）の場合は subgraph〜end 全体をハイライト
                        const nodeInfo = nodes.find(n => n.id === mId);
                        if (nodeInfo && isClusterNode(nodeInfo)) {
                            // findSubgraphRange でグループのソース行範囲を取得
                            const sgRange = findSubgraphRange(range.lines, range.startIdx, range.endIdx, mId);
                            if (sgRange && typeof window.highlightEditorLineRange === 'function') {
                                window.highlightEditorLineRange(sgRange.subStart, sgRange.subEnd);
                            }
                        } else {
                            // 通常ノード: 定義行1行をハイライト
                            const defs = collectNodeDefLines(range.lines, range.startIdx, range.endIdx, mId, false);
                            if (defs && defs.length > 0) {
                                targetLineIndex = defs[0].idx;
                            }
                        }
                    } else if (selectedEdges.size > 0) {
                        const edge = Array.from(selectedEdges)[0];
                        const idMatch = edge.id ? edge.id.match(/^L-(.+?)-(.+?)-\d+/) : null;
                        if (idMatch) {
                            const from = idMatch[1];
                            const to = idMatch[2];
                            for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                                if (containsNodeId(range.lines[i], from) && containsNodeId(range.lines[i], to) && arrowSplitRegex.test(range.lines[i])) {
                                    targetLineIndex = i;
                                    break;
                                }
                            }
                        } else if (edge.classList) {
                            let fromMatch = null, toMatch = null;
                            edge.classList.forEach(cls => {
                                if (cls.startsWith('LS-')) fromMatch = cls.substring(3);
                                if (cls.startsWith('LE-')) toMatch = cls.substring(3);
                            });
                            if (fromMatch && toMatch) {
                                for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                                    if (containsNodeId(range.lines[i], fromMatch) && containsNodeId(range.lines[i], toMatch) && arrowSplitRegex.test(range.lines[i])) {
                                        targetLineIndex = i;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if (targetLineIndex !== -1) {
                        window.highlightEditorLine(targetLineIndex);
                    }
                }
            }
        };

        // ── ノード本体ドラッグ（mousedown on node）──
        // mousedown 時点ではドラッグ意図のみ記録し、閾値超過後にゴースト生成する。
        // これにより、単純クリックとドラッグを正しく区別できる。
        const NODE_DRAG_THRESHOLD = 5; // ドラッグ判定の最低移動距離（px）

        wrapper.addEventListener('mousedown', e => {
            // 編集モードでなければ無視
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;
            if (e.target.closest('.mermaid-toolbar, .mermaid-edit-toolbar, .mermaid-context-menu')) return;
            // SVGエディタ起動中は干渉しない
            if (window.currentEditingSVG) return;
            // 接続ハンドルドラッグ中は無視
            if (_dragState) return;
            // 右クリック・中クリックは無視
            if (e.button !== 0) return;

            // ノード要素を取得（g.node または g.cluster 等）
            const nodeEl = e.target.closest('g.node, g.cluster, g[class*="cluster"]:not(.clusters)');
            if (!nodeEl) return;

            // 接続ハンドル上からのドラッグは除外
            if (e.target.closest('.mermaid-connect-handle')) return;

            const mId = getMermaidNodeId(nodeEl);
            if (!mId) return;

            // mousedown時点では preventDefault/stopPropagation せず、ドラッグ意図のみ記録
            // （stopPropagation するとクリックイベントに影響する可能性があるため）
            const nodeRect = nodeEl.getBoundingClientRect();
            const wRect   = wrapper.getBoundingClientRect();
            const offsetX = e.clientX - nodeRect.left;
            const offsetY = e.clientY - nodeRect.top;

            // ノードのラベルテキストを取得（ゴーストに表示）
            const labelEl = nodeEl.querySelector('.nodeLabel, .label, .cluster-label, text, foreignObject');
            let label = mId;
            if (labelEl) {
                const p = labelEl.querySelector && labelEl.querySelector('p, span, div');
                label = ((p ? p.textContent : labelEl.textContent) || mId).trim();
            }

            // 状態を記録（ゴーストはまだ生成しない）
            _nodeDragState = {
                nodeId:       mId,
                nodeEl,
                nodeRect,
                label,
                wrapper,
                svgEl,
                ghost:        null,   // ドラッグ開始後に生成
                offsetX,
                offsetY,
                startX:       e.clientX, // ドラッグ判定の基準位置
                startY:       e.clientY,
                dragStarted:  false,  // 閾値を超えてドラッグが開始されたか
                prevDropTarget: null,
                hasMoved: false,
            };
        });

        // ── ノード・エッジ クリック検出 ──
        wrapper.addEventListener('click', e => {
            // SVGエディタ起動中は干渉しない
            if (window.currentEditingSVG) return;
            if (e.target.closest('.mermaid-toolbar, .mermaid-edit-toolbar, .mermaid-context-menu')) return;
            // 接続ドラッグ中はハンドル更新しない
            if (_dragState) return;
            // ノードドラッグ後のクリック誤検知を防ぐ（ドラッグして移動した場合はclickを無視）
            if (_nodeDragState && _nodeDragState.hasMoved) return;
            // 編集モード（.mermaid-edit-mode）の時だけハンドルを表示する
            // プレビューモードではハンドルを出さない
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;

            console.log(`[MermaidInteraction] Clicked at (${e.clientX}, ${e.clientY})`);
            console.log(`[MermaidInteraction] e.target =`, e.target);

            const nodeEl = e.target.closest('g.node, g.cluster, g[class*="cluster"]:not(.clusters)');
            // ヒットボックス自身、または flowchart-link クラス、marker-end を持つ path などを探す
            let edgePathEl = e.target.closest('.edge-hitbox, path[marker-end], .edgePath, .flowchart-link, path[id^="L-"]');
            const edgeLabelEl = e.target.closest('.edgeLabel, g.edgeLabel');

            console.log(`[MermaidInteraction] nodeEl =`, nodeEl, `, edgePathEl =`, edgePathEl, `, edgeLabelEl =`, edgeLabelEl);

            // ヒットボックスがクリックされた場合は元のパスに変換
            if (edgePathEl && edgePathEl.classList.contains('edge-hitbox')) {
                console.log('[MermaidInteraction] ヒットボックスがクリックされました。元のパスに変換します。');
                const originalId = edgePathEl.id ? edgePathEl.id.replace(/-hitbox$/, '') : null;
                const originalPath = originalId ? svgEl.querySelector(`[id="${originalId}"]`) : null;
                edgePathEl = originalPath || edgePathEl.parentNode.querySelector('path:not(.edge-hitbox)') || edgePathEl;
            }

            const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;

            // 余白クリック判定
            if (!nodeEl && !edgePathEl && !edgeLabelEl) {
                selectedNodes.clear();
                selectedEdges.clear();
                updateSelectionUI();
                return;
            }

            // ノードがクリックされた場合
            if (nodeEl) {
                const mId = getMermaidNodeId(nodeEl);
                if (mId) {
                    if (isMultiSelect) {
                        if (selectedNodes.has(mId)) {
                            selectedNodes.delete(mId); // トグル解除
                        } else {
                            selectedNodes.add(mId); // 追加
                        }
                    } else {
                        // 単一選択
                        selectedNodes.clear();
                        selectedEdges.clear();
                        selectedNodes.add(mId);
                    }
                    updateSelectionUI();
                }
                return;
            }

            // エッジ（矢印パス）またはエッジラベルがクリックされた場合
            let targetEdge = null;
            if (edgePathEl) {
                targetEdge = edgePathEl.tagName.toLowerCase() === 'path' ? edgePathEl : edgePathEl.querySelector('path');
            } else if (edgeLabelEl) {
                targetEdge = edgeLabelEl;
            }

            if (targetEdge) {
                if (isMultiSelect) {
                    if (selectedEdges.has(targetEdge)) {
                        selectedEdges.delete(targetEdge); // トグル解除
                    } else {
                        selectedEdges.add(targetEdge); // 追加
                    }
                } else {
                    // 単一選択
                    selectedNodes.clear();
                    selectedEdges.clear();
                    selectedEdges.add(targetEdge);
                }
                updateSelectionUI();
                return;
            }
        });

        // ── ノード・エッジダブルクリック → ラベルインライン編集 ──
        wrapper.addEventListener('dblclick', e => {
            // 編集モードでなければ無視
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;
            if (e.target.closest('.mermaid-toolbar, .mermaid-edit-toolbar, .mermaid-context-menu')) return;

            console.log(`[MermaidInteraction] DblClicked at (${e.clientX}, ${e.clientY})`);
            console.log(`[MermaidInteraction] e.target =`, e.target);

            const nodeEl = e.target.closest('g.node, g.cluster, g[class*="cluster"]:not(.clusters)');
            const edgeLabelEl = e.target.closest('.edgeLabel, g.edgeLabel');
            let edgePathEl = e.target.closest('.edge-hitbox, path[marker-end], .edgePath, .flowchart-link, path[id^="L-"]');

            console.log(`[MermaidInteraction] nodeEl =`, nodeEl, `, edgePathEl =`, edgePathEl, `, edgeLabelEl =`, edgeLabelEl);

            // ヒットボックスがクリックされた場合は元のパスに変換
            if (edgePathEl && edgePathEl.classList.contains('edge-hitbox')) {
                console.log('[MermaidInteraction] ダブルクリック: ヒットボックスがクリックされました。元のパスに変換します。');
                const originalId = edgePathEl.id ? edgePathEl.id.replace(/-hitbox$/, '') : null;
                const originalPath = originalId ? svgEl.querySelector(`[id="${originalId}"]`) : null;
                edgePathEl = originalPath || edgePathEl.parentNode.querySelector('path:not(.edge-hitbox)') || edgePathEl;
            }

            // パスがダブルクリックされた場合、そのパスに対応する既存のラベルがないか探す
            // クラス名での関連付け（v1等）
            if (edgePathEl && !edgeLabelEl) {
                const lsClass = Array.from(edgePathEl.classList).find(c => c.startsWith('LS-'));
                const leClass = Array.from(edgePathEl.classList).find(c => c.startsWith('LE-'));
                
                if (lsClass && leClass) {
                    // 対応するラベルをDOMから探す
                    const correspondingLabel = svgEl.querySelector(`g.edgeLabel.${lsClass}.${leClass}`);
                    if (correspondingLabel) {
                        console.log('[MermaidInteraction] ダブルクリック: 対応する既存のラベルが見つかったため、ラベル編集に切り替えます。', correspondingLabel);
                        edgeLabelEl = correspondingLabel;
                        edgePathEl = null; // パス（新規追加）としての処理をキャンセル
                    }
                }
            }

            // DOMで見つからなかった場合（v2等）、ソースコードから直接探す
            let existingLabelFromSource = null;
            if (edgePathEl && !edgeLabelEl) {
                const id = edgePathEl.id || (edgePathEl.parentNode && edgePathEl.parentNode.id);
                if (id) {
                    const match = id.match(/^L-(.+?)-(.+?)(?:-\d+)?$/);
                    if (match) {
                        const fromId = match[1];
                        const toId = match[2];
                        existingLabelFromSource = findMermaidEdgeLabelText(wrapper, fromId, toId);
                    }
                }
            }

            if (!nodeEl && !edgeLabelEl && !edgePathEl) return;
            e.preventDefault();
            e.stopPropagation();

            let targetEl = null;
            let currentLabel = '';
            let isEdgeLabel = false;
            let isEdgePath = false;
            let mId = null;
            let edgeFromId = null;
            let edgeToId = null;

            if (nodeEl) {
                targetEl = nodeEl;
                mId = getMermaidNodeId(nodeEl);
                if (!mId) return;

                // 現在のラベルテキストをSVGから取得
                const labelEl = nodeEl.querySelector('.nodeLabel, .label, .cluster-label, text, foreignObject');
                currentLabel = mId; // フォールバック
                if (labelEl) {
                    const p = labelEl.querySelector && labelEl.querySelector('p, span, div');
                    currentLabel = (p ? p.textContent : labelEl.textContent).trim() || mId;
                }
            } else if (edgeLabelEl) {
                targetEl = edgeLabelEl;
                isEdgeLabel = true;
                const span = edgeLabelEl.tagName.toLowerCase() === 'span' ? edgeLabelEl : edgeLabelEl.querySelector('span, .edgeLabel');
                currentLabel = (span ? span.textContent : edgeLabelEl.textContent).trim();
            } else if (edgePathEl) {
                targetEl = edgePathEl;
                const id = edgePathEl.id || (edgePathEl.parentNode && edgePathEl.parentNode.id);
                if (!id) return;
                const match = id.match(/^L-(.+?)-(.+?)(?:-\d+)?$/);
                if (!match) return;
                edgeFromId = match[1];
                edgeToId = match[2];

                if (existingLabelFromSource !== null) {
                    // ソースコード上にラベルが存在する場合、既存ラベルの編集として扱う
                    isEdgeLabel = true; 
                    currentLabel = existingLabelFromSource;
                    console.log('[MermaidInteraction] ダブルクリック: ソース上にラベル発見', currentLabel);
                } else {
                    // 新規追加
                    isEdgePath = true;
                    currentLabel = ''; 
                }
            }

            const wrapperRect = wrapper.getBoundingClientRect();
            let inputLeft, inputTop, inputW, inputH;

            if (isEdgePath) {
                inputW = 120;
                inputH = 28;
                inputLeft = e.clientX - wrapperRect.left - (inputW / 2);
                inputTop = e.clientY - wrapperRect.top - (inputH / 2);
            } else {
                const targetRect = targetEl.getBoundingClientRect();
                inputLeft  = targetRect.left - wrapperRect.left;
                inputTop   = targetRect.top  - wrapperRect.top;
                inputW     = Math.max(targetRect.width, 100);
                inputH     = Math.max(targetRect.height, 28);
            }

            // inputをwrapper上に絶対配置で表示
            const inp = document.createElement('input');
            inp.type  = 'text';
            inp.value = currentLabel;
            inp.className = 'mermaid-node-label-input';
            inp.style.cssText = `
                position: absolute;
                left: ${inputLeft}px;
                top: ${inputTop}px;
                width: ${inputW}px;
                height: ${inputH}px;
                font-size: 14px;
                text-align: center;
                border: 2px solid var(--primary, #4A90E2);
                border-radius: 4px;
                background: white;
                z-index: 9999;
                box-sizing: border-box;
                padding: 0 4px;
            `;
            wrapper.style.position = 'relative';
            wrapper.appendChild(inp);
            inp.select();
            inp.focus();

            // 確定処理
            let committed = false;
            const commit = () => {
                if (committed) return;
                committed = true;

                const newLabel = inp.value.trim();
                if (inp.parentNode) inp.parentNode.removeChild(inp);

                // Markdownソースのラベルを書き換える
                if (isEdgeLabel) {
                    if (!newLabel || newLabel === currentLabel) return;
                    renameMermaidEdgeLabel(wrapper, currentLabel, newLabel);
                } else if (isEdgePath) {
                    if (!newLabel) return;
                    addMermaidEdgeLabel(wrapper, edgeFromId, edgeToId, newLabel);
                } else {
                    if (!newLabel || newLabel === currentLabel) return;
                    renameMermaidNodeLabel(wrapper, mId, currentLabel, newLabel);
                }
            };

            inp.addEventListener('keydown', ev => {
                if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
                if (ev.key === 'Escape') {
                    committed = true;
                    if (inp.parentNode) inp.parentNode.removeChild(inp);
                }
            });
            inp.addEventListener('blur', commit);
        });


        overlay.addEventListener('mousedown', e => {
            const handle = e.target.closest('.mermaid-connect-handle');
            if (!handle) return;
            e.preventDefault();
            e.stopPropagation();

            const fromId = handle.dataset.nodeId;
            const startCx = parseFloat(handle.dataset.startCx);
            const startCy = parseFloat(handle.dataset.startCy);

            nodes = collectNodes(svgEl);

            const rubberLine = createRubberLine(overlay, startCx, startCy);

            _dragState = {
                fromId,
                wrapper,
                overlay,
                rubberLine,
                nodes,
                snapTarget: null,
                prevSnapEl: null,
            };

            // ハンドル以外をクリック透過させる（ドラッグ中は overlay 全体で受ける）
            overlay.style.pointerEvents = 'all';
        });

        // ── グローバル mousemove ──（一度だけ登録）
        if (!wrapper._miMoveRegistered) {
            wrapper._miMoveRegistered = true;
            document.addEventListener('mousemove', e => {
                // ── 接続ハンドルドラッグの処理 ──
                if (_dragState && _dragState.wrapper === wrapper) {
                    const wRect = wrapper.getBoundingClientRect();
                    const mx = e.clientX - wRect.left;
                    const my = e.clientY - wRect.top;

                    // ラバーバンドの終点を更新
                    _dragState.rubberLine.setAttribute('x2', mx);
                    _dragState.rubberLine.setAttribute('y2', my);

                    // スナップ検索
                    const snap = findSnapTarget(mx, my, _dragState.nodes, _dragState.fromId, wRect);

                    // 前回スナップ対象のハイライト解除
                    if (_dragState.prevSnapEl) {
                        _dragState.prevSnapEl.classList.remove('mermaid-snap-highlight');
                        _dragState.prevSnapEl = null;
                    }

                    if (snap) {
                        // ラバーバンドをスナップ先の中心に吸い付かせる
                        _dragState.rubberLine.setAttribute('x2', snap.cx);
                        _dragState.rubberLine.setAttribute('y2', snap.cy);
                        snap.nodeInfo.el.classList.add('mermaid-snap-highlight');
                        _dragState.prevSnapEl    = snap.nodeInfo.el;
                        _dragState.snapTarget    = snap.nodeInfo;
                    } else {
                        _dragState.snapTarget = null;
                    }
                }

                // ── ノード本体ドラッグの処理 ──
                if (_nodeDragState && _nodeDragState.wrapper === wrapper) {
                    const dx = e.clientX - _nodeDragState.startX;
                    const dy = e.clientY - _nodeDragState.startY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // 閾値を超えた場合のみドラッグを開始
                    if (!_nodeDragState.dragStarted) {
                        if (dist < NODE_DRAG_THRESHOLD) return; // 閾値未満はまだ待機
                        // ドラッグ開始：ゴーストを生成し、元ノードを半透明化
                        _nodeDragState.dragStarted = true;
                        _nodeDragState.ghost = createNodeGhost(_nodeDragState.nodeRect, wrapper, _nodeDragState.label);
                        _nodeDragState.nodeEl.classList.add('mermaid-node-dragging');
                    }

                    const wRect = wrapper.getBoundingClientRect();
                    const mx = e.clientX - wRect.left;
                    const my = e.clientY - wRect.top;

                    // ゴーストをマウス位置に追従
                    moveNodeGhost(_nodeDragState.ghost, mx, my, _nodeDragState.offsetX, _nodeDragState.offsetY);
                    _nodeDragState.hasMoved = true;

                    // subgraphへのホバー判定とハイライト切り替え
                    const dropTarget = findSubgraphAtPoint(mx, my, _nodeDragState.svgEl, wrapper, _nodeDragState.nodeId);
                    // デバッグ: subgraph検出結果を一定間隔で出力（パフォーマンス対策）
                    if (!_nodeDragState._lastDropLog || Date.now() - _nodeDragState._lastDropLog > 500) {
                        console.log('[MermaidInteraction] ドラッグ中 mx,my=', mx, my, 'dropTarget=', dropTarget ? dropTarget.id : null);
                        _nodeDragState._lastDropLog = Date.now();
                    }

                    // 前回のドロップターゲットハイライト解除
                    if (_nodeDragState.prevDropTarget && _nodeDragState.prevDropTarget !== (dropTarget && dropTarget.el)) {
                        _nodeDragState.prevDropTarget.classList.remove('mermaid-subgraph-drop-target');
                        _nodeDragState.prevDropTarget = null;
                    }

                    if (dropTarget) {
                        if (_nodeDragState.prevDropTarget !== dropTarget.el) {
                            dropTarget.el.classList.add('mermaid-subgraph-drop-target');
                            _nodeDragState.prevDropTarget = dropTarget.el;
                        }
                        _nodeDragState.currentDropTarget = dropTarget;
                    } else {
                        _nodeDragState.currentDropTarget = null;
                    }
                }
            });

            // ── グローバル mouseup ──
            document.addEventListener('mouseup', e => {
                // ── 接続ハンドルドラッグの終了処理 ──
                if (_dragState && _dragState.wrapper === wrapper) {
                    const state = _dragState;
                    _dragState = null;

                    // ハイライト解除
                    if (state.prevSnapEl) {
                        state.prevSnapEl.classList.remove('mermaid-snap-highlight');
                    }

                    // オーバーレイのポインタイベントをデフォルトに戻す
                    state.overlay.style.pointerEvents = '';

                    // ドラッグ終了時はオーバーレイ全体をクリアする（選択枠も消えるが、
                    // クリックイベントで再描画されるか、次回選択時に復帰する）
                    clearOverlay(state.overlay);

                    if (state.snapTarget) {
                        // 接続確定
                        appendConnectionToSource(state.wrapper, state.fromId, state.snapTarget.id);
                    }
                }

                // ── ノード本体ドラッグの終了処理 ──
                if (_nodeDragState && _nodeDragState.wrapper === wrapper) {
                    const state = _nodeDragState;
                    _nodeDragState = null;

                    // 元ノードの半透明を解除
                    state.nodeEl.classList.remove('mermaid-node-dragging');

                    // subgraphハイライト解除
                    if (state.prevDropTarget) {
                        state.prevDropTarget.classList.remove('mermaid-subgraph-drop-target');
                    }

                    // ゴーストを削除
                    removeNodeGhost(state.ghost);

                    // ドロップ先がsubgraphなら永続化処理
                    if (state.currentDropTarget && state.hasMoved) {
                        moveNodeToSubgraph(state.wrapper, state.nodeId, state.currentDropTarget.id);
                    } else if (!state.currentDropTarget && state.hasMoved) {
                        // subgraph外にドロップされた場合：
                        // 元のsubgraphに所属していたならトップレベルへ移動する
                        const range = getMermaidBlockRange(state.wrapper);
                        if (range) {
                            const currentSub = findNodeCurrentSubgraph(range.lines, range.startIdx, range.endIdx, state.nodeId);
                            if (currentSub) {
                                moveNodeToTopLevel(state.wrapper, state.nodeId);
                            }
                        }
                    }
                }
            });
        }
    }

    // ── グローバルショートカットとコンテキストメニュー ──
    
    if (!window._mermaidGlobalEventsBound) {
        window._mermaidGlobalEventsBound = true;

        // キーボードショートカット
        document.addEventListener('keydown', e => {
            // 入力要素やダイアログにフォーカスがある場合は無視
            const isInputTarget = e.target.tagName === 'INPUT' || 
                                  e.target.tagName === 'TEXTAREA' || 
                                  e.target.isContentEditable ||
                                  e.target.closest('dialog');
            if (isInputTarget) return;

            // 編集モードのラッパーを探す
            const activeWrapper = document.querySelector('.mermaid-diagram-wrapper.mermaid-edit-mode, .mermaid-diagram-wrapper.mermaid-sequence-edit-mode, .mermaid-diagram-wrapper.mermaid-class-edit-mode');
            if (!activeWrapper || !activeWrapper._mermaidAPI) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                activeWrapper._mermaidAPI.deleteSelection();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                activeWrapper._mermaidAPI.copySelection();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                activeWrapper._mermaidAPI.pasteSelection();
            }
        });

        // 外部クリックでコンテキストメニューを閉じる
        document.addEventListener('click', e => {
            const menu = document.getElementById('mermaid-context-menu');
            if (menu && !e.target.closest('#mermaid-context-menu')) {
                menu.remove();
            }
        });
    }

    /**
     * Mermaidエディタ専用のコンテキストメニューを表示する。
     */
    function showMermaidContextMenu(x, y, wrapper) {
        // 既存のメニューを削除
        const existingMenu = document.getElementById('mermaid-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'mermaid-context-menu';
        menu.className = 'context-menu visible';
        menu.style.position = 'fixed';
        // 拡大表示(.mermaid-fixed-expanded)のz-indexが100000なので、それより前に出す
        menu.style.zIndex = '100002';
        
        // メニュー項目
        const items = [
            { label: 'コピー', shortcut: 'Ctrl+C', action: 'copy' },
            { label: '貼り付け', shortcut: 'Ctrl+V', action: 'paste' },
            { type: 'separator' }
        ];

        // 選択されているノードがあれば、変形メニューを追加
        if (wrapper._mermaidAPI.hasNodeSelection && wrapper._mermaidAPI.hasNodeSelection()) {
            items.push({
                label: '変形 ▸',
                action: 'transform',
                submenu: [
                    { label: '四角', action: 'transform', value: 'rect' },
                    { label: 'ひし形', action: 'transform', value: 'diamond' },
                    { label: '角丸', action: 'transform', value: 'capsule' },
                    { label: '二重円', action: 'transform', value: 'doublecircle' },
                    { label: '円形', action: 'transform', value: 'circle' },
                    { label: '円柱', action: 'transform', value: 'cylinder' },
                ]
            });
            items.push({ type: 'separator' });
        }

        items.push({ label: '削除', shortcut: 'Del', action: 'delete' });

        items.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                menu.appendChild(sep);
                return;
            }

            const el = document.createElement('div');
            el.className = 'context-menu-item';
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            el.appendChild(labelSpan);

            if (item.shortcut) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.className = 'shortcut';
                shortcutSpan.style.marginLeft = 'auto';
                shortcutSpan.style.paddingLeft = '16px';
                shortcutSpan.style.color = '#999';
                shortcutSpan.style.fontSize = '11px';
                shortcutSpan.textContent = item.shortcut;
                el.appendChild(shortcutSpan);
            }

            if (item.submenu) {
                el.classList.add('has-submenu');
                
                const submenuDiv = document.createElement('div');
                submenuDiv.className = 'context-menu-submenu';
                
                item.submenu.forEach(sub => {
                    const subEl = document.createElement('div');
                    subEl.className = 'context-menu-item';
                    
                    const subLabelSpan = document.createElement('span');
                    subLabelSpan.textContent = sub.label;
                    subEl.appendChild(subLabelSpan);
                    
                    subEl.onclick = (e) => {
                        e.stopPropagation();
                        menu.remove();
                        if (sub.action === 'transform') wrapper._mermaidAPI.transformSelection(sub.value);
                    };
                    submenuDiv.appendChild(subEl);
                });
                
                el.appendChild(submenuDiv);
            } else {
                el.onclick = (e) => {
                    e.stopPropagation();
                    menu.remove();
                    
                    if (item.action === 'copy') {
                        wrapper._mermaidAPI.copySelection();
                    } else if (item.action === 'paste') {
                        wrapper._mermaidAPI.pasteSelection();
                    } else if (item.action === 'delete') {
                        wrapper._mermaidAPI.deleteSelection();
                    }
                };
            }
            menu.appendChild(el);
        });

        document.body.appendChild(menu);

        // 位置調整
        const padding = 10;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const menuRect = menu.getBoundingClientRect();
        
        let finalX = x;
        let finalY = y;
        
        if (finalX + menuRect.width > viewportW - padding) {
            finalX = viewportW - menuRect.width - padding;
        }
        if (finalY + menuRect.height > viewportH - padding) {
            finalY = viewportH - menuRect.height - padding;
        }

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    }

    // ── 公開API ───────────────────────────────────────────────
    return {
        initDiagram,
    };
})();

window.MermaidInteraction = MermaidInteraction;
