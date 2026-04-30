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
    let _dragState = null;  // ドラッグ中の状態オブジェクト
    let _clipboard = null;  // コピー＆ペースト用の内部クリップボード

    // ── ユーティリティ ────────────────────────────────────────

    /**
     * wrapper要素からMermaidソースコードブロックの範囲を取得する。
     * @returns {{startIdx: number, endIdx: number, lines: string[]}|null}
     */
    function getMermaidBlockRange(wrapper) {
        let dataLineEl = wrapper;
        if (!dataLineEl.hasAttribute('data-line') && wrapper.closest('.code-block-wrapper')) {
            const parentWrapper = wrapper.closest('.code-block-wrapper');
            if (parentWrapper.hasAttribute('data-line')) {
                dataLineEl = parentWrapper;
            }
        }
        const dataLine = dataLineEl.getAttribute('data-line');
        if (!dataLine || isNaN(dataLine)) return null;

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx = parseInt(dataLine, 10) - 1; // 0-indexed

        const startLine = (lines[startIdx] || '').trim();
        if (!startLine.startsWith('```mermaid') && !startLine.startsWith('~~~mermaid')) {
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
            if (found === -1) return null;
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) {
                endIdx = i;
                break;
            }
        }

        if (endIdx === -1) return null;
        return { startIdx, endIdx, lines };
    }

    /**
     * テキストを書き換えて再描画し、Mermaidの編集モード状態を復元するヘルパー関数
     * @param {Element} wrapper 
     * @param {string[]} newTextLines 
     */
    function applyEditorTextAndRestore(wrapper, newTextLines) {
        // 再描画前に編集状態情報を保存
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(newTextLines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                // 編集モードを復元
                const preview = document.getElementById('preview');
                if (!preview) return;

                let newDiagramWrapper = null;
                let newCodeBlockWrapper = null;

                if (savedCodeIndex !== undefined) {
                    newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
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
     * Mermaidが生成するIDは "flowchart-NodeId-数字" の形式（graph TD も同様）。
     * @param {Element} el - SVGのg要素
     * @returns {string|null} MermaidノードID（例: "A"）、判定不可なら null
     */
    function getMermaidNodeId(el) {
        const id = el.id || '';
        // パターン1: flowchart-NodeId-数字 （graph TD / flowchart TD 共通）
        let m = id.match(/^flowchart-(.+?)-\d+$/);
        if (m) return m[1];
        // パターン2: graph-NodeId-数字 （古いMermaidバージョン）
        m = id.match(/^graph-(.+?)-\d+$/);
        if (m) return m[1];
        // パターン3: cluster-NodeId-数字 （subgraphの場合）
        m = id.match(/^cluster-(.+?)(?:-\d+)?$/);
        if (m) return m[1];
        
        // パターン4: ノードに data-id 属性がある場合
        if (el.hasAttribute('data-id')) return el.getAttribute('data-id');

        // フォールバック: el が subgraph でIDがある場合 (MermaidのバージョンによってはそのままのIDやflowchart-ID)
        if (el.classList.contains('cluster') && id) {
            const parts = id.split('-');
            if (parts.length > 1 && parts[0] === 'flowchart') {
                return parts.slice(1).join('-');
            }
            return id;
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
     * 指定ノードの上下左右に接続ハンドル（三角形）を描画する。
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
            tri.dataset.dir      = h.dir;
            tri.dataset.nodeId   = nodeInfo.id;
            tri.dataset.startCx  = h.hx;
            tri.dataset.startCy  = h.hy;
            overlay.appendChild(tri);
        });
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
                        newCodeBlockWrapper = preview.querySelector(
                            `.code-block-wrapper[data-code-index="${savedCodeIndex}"]`
                        );
                        if (newCodeBlockWrapper) {
                            newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                        }
                    }
                    // フォールバック: data-lineで探す
                    if (!newDiagramWrapper && savedDataLine) {
                        newDiagramWrapper = preview.querySelector(
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
                            const editBtn = targetWrapper.querySelector('.code-edit-btn');
                            if (editBtn && !editBtn.classList.contains('mermaid-done-mode')) {
                                const doneLabel = typeof I18n !== 'undefined'
                                    ? (I18n.translate('editor.done') || '完了') : '完了';
                                editBtn.textContent = doneLabel;
                                editBtn.classList.add('mermaid-done-mode');
                                editBtn._originalOnclick = editBtn.onclick;
                                editBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    if (typeof InlineCodeEditor !== 'undefined') {
                                        InlineCodeEditor.exitMermaidEdit();
                                    }
                                };
                            }
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

        // 対応するブラケット形式: [label], {label}, (label), ([label]), [(label)]
        const bracketPairs = [
            { open: '([', close: '])' },  // ID([label]) サブグラフ形式
            { open: '[(', close: ')]' },  // ID[(label)] DB形式
            { open: '{{', close: '}}' },  // ID{{label}} 六角形
            { open: '[', close: ']' },    // ID[label]  四角（最も一般的）
            { open: '{', close: '}' },    // ID{label}  ひし形
            { open: '(', close: ')' },    // ID(label)  丸角
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
                    newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
                    if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                }

                if (newDiagramWrapper) {
                    newDiagramWrapper.classList.add('mermaid-edit-mode');
                    if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                        InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                        if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                    }
                    // ボタンテキストを「完了」に更新
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
                    newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
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
                    newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
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

    // ── イベント初期化 ─────────────────────────────────────────


    /**
     * 矢印のクリック判定を広げるための透明な当たり判定パスを生成・追加する。
     */
    function enhanceEdgeHitboxes(wrapper) {
        // flowchart-v2 などでは .edgePaths などのクラスがない場合があるため、
        // 矢印（marker-endを持つpath）、または .edgePath に属するpath、または idがL-から始まるpath を探す
        let edgePaths = Array.from(wrapper.querySelectorAll('path[marker-end]:not(.edge-hitbox), .edgePath path:not(.edge-hitbox), path.flowchart-link:not(.edge-hitbox), path[id^="L-"]:not(.edge-hitbox)'));
        
        // 重複を排除
        edgePaths = [...new Set(edgePaths)];

        console.log('[MermaidInteraction] enhanceEdgeHitboxes: 対象のパス数 =', edgePaths.length);
        edgePaths.forEach(path => {
            // すでにヒットボックスがあればスキップ
            if (path.dataset.hasHitbox) return;
            path.dataset.hasHitbox = 'true';
            
            const hitbox = path.cloneNode(true);
            hitbox.classList.add('edge-hitbox');
            delete hitbox.dataset.hasHitbox;

            if (hitbox.id) hitbox.id = hitbox.id + '-hitbox';
            
            // 見た目は透明にし、太さを24pxにして当たり判定を広げる
            hitbox.style.stroke = 'transparent';
            hitbox.style.strokeWidth = '24px';
            hitbox.style.fill = 'none';
            hitbox.style.pointerEvents = 'stroke';
            hitbox.style.cursor = 'pointer';
            hitbox.style.cursor = 'pointer';
            
            // pathはマーカー（矢印の先）を持っているので、ヒットボックスからは外す
            hitbox.removeAttribute('marker-end');
            hitbox.removeAttribute('marker-start');

            path.parentNode.appendChild(hitbox);
            console.log('[MermaidInteraction] ヒットボックスを追加しました:', hitbox);
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

                const newLines = [];
                for (let i = startIdx + 1; i < endIdx; i++) {
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

                // 不要な単独ノード行のクリーンアップ
                // 分割によって生じた「B」のような単なるIDだけの行は、他で定義・使用されているなら削除する
                const finalLines = [];
                for (let i = 0; i < newLines.length; i++) {
                    const line = newLines[i];
                    const trimmed = line.trim();
                    
                    // 矢印がなく、かつカッコ等の定義記号を含まない単独行か？
                    if (!arrowSplitRegex.test(trimmed) && !/[\(\[\{>]/.test(trimmed)) {
                        const mId = trimmed; // 単なるIDとみなす
                        let usedElsewhere = false;
                        for (let j = 0; j < newLines.length; j++) {
                            if (i === j) continue;
                            if (containsNodeId(newLines[j], mId)) {
                                usedElsewhere = true;
                                break;
                            }
                        }
                        // 他で使われているならこの単独行は不要
                        if (usedElsewhere) {
                            continue;
                        }
                    }
                    finalLines.push(line);
                }

                // 書き戻しと再描画
                lines.splice(startIdx + 1, endIdx - startIdx - 1, ...finalLines);
                applyEditorTextAndRestore(wrapper, lines);
                selectedNodes.clear();
                selectedEdges.clear();
            },
            copySelection: () => {
                if (selectedNodes.size === 0) return;
                const range = getMermaidBlockRange(wrapper);
                if (!range) return;

                const copiedNodes = [];
                // 選択されたノードの定義を探す
                for (const mId of selectedNodes) {
                    let bestDef = mId; // デフォルトはIDのみ
                    
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
                    copiedNodes.push({ id: mId, def: bestDef });
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

                    // 定義のID部分を新しいIDに置換して挿入
                    const newDef = node.def.replace(new RegExp(`^${node.id}`), newId);
                    pastedLines.push(`    ${newDef}`);
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

                // 選択中ノードの中に subgraph があるかチェック
                let targetSubgraphId = null;
                for (const mId of selectedNodes) {
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
                        if (range.lines[i].match(new RegExp(`^\\s*subgraph\\s+${esc(mId)}\\b`))) {
                            targetSubgraphId = mId;
                            break;
                        }
                    }
                    if (targetSubgraphId) break;
                }

                if (targetSubgraphId) {
                    // グループの direction を切り替える
                    let inSubgraph = false;
                    let directionLineIdx = -1;
                    let currentDirection = null;
                    let subgraphStartIdx = -1;

                    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
                    const subRegex = new RegExp(`^\\s*subgraph\\s+${esc(targetSubgraphId)}\\b`);

                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        const line = range.lines[i];
                        if (line.match(subRegex)) {
                            inSubgraph = true;
                            subgraphStartIdx = i;
                            continue;
                        }
                        if (inSubgraph) {
                            if (line.trim() === 'end') {
                                break; // subgraph 終了
                            }
                            const dirMatch = line.match(/^\s*direction\s+(TB|TD|LR|RL|BT)\s*$/);
                            if (dirMatch) {
                                directionLineIdx = i;
                                currentDirection = dirMatch[1];
                                break;
                            }
                        }
                    }

                    if (directionLineIdx !== -1) {
                        // 既に direction がある場合は反転
                        const isLR = currentDirection === 'LR' || currentDirection === 'RL';
                        const newDir = isLR ? 'TB' : 'LR';
                        range.lines[directionLineIdx] = range.lines[directionLineIdx].replace(currentDirection, newDir);
                    } else if (subgraphStartIdx !== -1) {
                        // direction がない場合はデフォルトTBとみなし、LRを追加する
                        range.lines.splice(subgraphStartIdx + 1, 0, '    direction LR');
                    }
                } else {
                    // 全体の direction を切り替える
                    let found = false;
                    for (let i = range.startIdx + 1; i < range.endIdx; i++) {
                        const line = range.lines[i];
                        const match = line.match(/^(\s*(?:flowchart|graph)\s+)(TB|TD|LR|RL|BT)\s*$/);
                        if (match) {
                            const isLR = match[2] === 'LR' || match[2] === 'RL';
                            const newDir = isLR ? 'TB' : 'LR';
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

                applyEditorTextAndRestore(wrapper, range.lines);
                if (typeof showToast === 'function') showToast(`縦横(TB/LR)を切り替えました`, 'success');
            }
        };

        // ── コンテキストメニュー ──
        svgEl.addEventListener('contextmenu', e => {
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;
            e.preventDefault();
            e.stopPropagation();

            // クリック対象を取得し、選択されていない場合はそれを単一選択する
            const nodeEl = e.target.closest('g.node');
            const edgePathEl = e.target.closest('.edge-hitbox, path[marker-end], .edgePath, .flowchart-link, path[id^="L-"]');
            
            let clickedMId = null;
            if (nodeEl) {
                clickedMId = getMermaidNodeId(nodeEl);
                if (clickedMId && !selectedNodes.has(clickedMId)) {
                    selectedNodes.clear();
                    selectedEdges.clear();
                    selectedNodes.add(clickedMId);
                    updateSelectionUI();
                }
            } else if (edgePathEl) {
                const targetEdge = edgePathEl.tagName.toLowerCase() === 'path' ? edgePathEl : edgePathEl.querySelector('path');
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
        };

        // ── ノード・エッジ クリック検出 ──
        svgEl.addEventListener('click', e => {
            // SVGエディタ起動中は干渉しない
            if (window.currentEditingSVG) return;
            // ドラッグ中はハンドル更新しない
            if (_dragState) return;
            // 編集モード（.mermaid-edit-mode）の時だけハンドルを表示する
            // プレビューモードではハンドルを出さない
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;

            console.log(`[MermaidInteraction] Clicked at (${e.clientX}, ${e.clientY})`);
            console.log(`[MermaidInteraction] e.target =`, e.target);

            const nodeEl = e.target.closest('g.node, g.cluster');
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
        svgEl.addEventListener('dblclick', e => {
            // 編集モードでなければ無視
            if (!wrapper.classList.contains('mermaid-edit-mode')) return;

            console.log(`[MermaidInteraction] DblClicked at (${e.clientX}, ${e.clientY})`);
            console.log(`[MermaidInteraction] e.target =`, e.target);

            const nodeEl = e.target.closest('g.node, g.cluster');
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
                if (!_dragState || _dragState.wrapper !== wrapper) return;

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
            });

            // ── グローバル mouseup ──
            document.addEventListener('mouseup', e => {
                if (!_dragState || _dragState.wrapper !== wrapper) return;

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
            });
        }
    }

    // ── グローバルショートカットとコンテキストメニュー ──
    
    if (!window._mermaidGlobalEventsBound) {
        window._mermaidGlobalEventsBound = true;

        // キーボードショートカット
        document.addEventListener('keydown', e => {
            // 入力要素にフォーカスがある場合は無視
            const isInputTarget = e.target.tagName === 'INPUT' || 
                                  e.target.tagName === 'TEXTAREA' || 
                                  e.target.isContentEditable;
            if (isInputTarget) return;

            // 編集モードのラッパーを探す
            const activeWrapper = document.querySelector('.mermaid-diagram-wrapper.mermaid-edit-mode');
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
        menu.style.zIndex = '10000';
        
        // メニュー項目
        const items = [
            { label: 'コピー', shortcut: 'Ctrl+C', action: 'copy' },
            { label: '貼り付け', shortcut: 'Ctrl+V', action: 'paste' },
            { type: 'separator' },
            { label: '削除', shortcut: 'Del', action: 'delete' }
        ];

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
