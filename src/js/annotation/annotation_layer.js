/**
 * AnnotationLayer - プレビュー全体を覆う透明SVGキャンバス
 * GoodNotes / PDFリーダーのような注釈描画機能を提供する。
 *
 * 設計方針:
 *   - DOM.previewPane (#preview-pane) 直下に position:absolute の <svg> を配置
 *   - DOM.preview (#preview) とは分離し、Fast Pathレンダラーの干渉を避ける
 *   - window.currentEditingSVG とは完全に独立した window.AnnotationLayer を使用
 *   - データは Markdown 末尾の <!-- ANNOTATION_DATA: <svg>...</svg> --> に保存
 *
 * アンカー追随ロジック:
 *   描画後に最近傍の段落 (<p>/<h1> 等) にアンカーを設定する。
 *   テキスト変更 → プレビューDOM変化 → MutationObserver が検知
 *   → _updateAllAnchors() で図形を段落の新位置に追随させる。
 *
 *   累積バグ防止: bbox.y (transform後の実座標) と targetY の差分を
 *   現在のtranslateYに「加算」する方式で正確に追随する。
 */
window.AnnotationLayer = (function () {

    // --- 内部状態 ---
    let _svgEl    = null;   // アノテーション用 <svg> DOM要素
    let _draw     = null;   // SVG.js の Draw インスタンス
    let _isActive = false;  // アノテーションモードが有効か
    let _currentTool = 'freehand';

    // アンカーマップ: shapeId -> { sourceLine, paragraphText, offsetY, initialBboxY }
    //   sourceLine   : Markdownソースの行番号（1始まり）。差分追跡で更新される。
    //   offsetY      : 段落top から bbox.y までの差分（px）
    //   initialBboxY : アンカー設定時の bbox.y（絶対値計算の基準）
    const _anchorMap = new Map();

    // 差分追跡用: 直前のレンダリング対象コンテンツ
    let _prevContent = null;

    // エディタへの注釈書き込み中フラグ（二重書き込み防止）
    let _isApplyingAnnotationToEditor = false;

    let _mutationObserver  = null;
    let _resizeObserver    = null;
    let _anchorUpdateTimer = null; // デバウンス用

    // --- 定数 ---
    const SVG_LAYER_ID = 'annotation-svg-layer';

    // ===== 初期化 =====

    function init() {
        const previewPane    = document.getElementById('preview-pane');
        const previewContent = document.getElementById('preview');
        if (!previewPane || !previewContent) {
            console.warn('[AnnotationLayer] #preview-pane または #preview が見つかりません。');
            return;
        }
        if (document.getElementById(SVG_LAYER_ID)) return; // 二重初期化防止

        // SVGレイヤーを #preview-pane 直下に配置する。
        // #preview に入れるとレンダラーの innerHTML 置換で消えてしまうため。
        // X座標は _syncLayerSize で #preview の左端に合わせて動的に設定する。
        _svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        _svgEl.id = SVG_LAYER_ID;
        _svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        _svgEl.classList.add('annotation-layer');
        previewPane.style.position = 'relative';
        _syncLayerSize(previewPane, previewContent);
        previewPane.appendChild(_svgEl);

        // SVG.js でラップ
        if (typeof SVG === 'undefined') {
            console.warn('[AnnotationLayer] SVG.js が見つかりません。');
            return;
        }
        try {
            _draw = typeof SVG.adopt === 'function' ? SVG.adopt(_svgEl) : SVG(_svgEl);
        } catch (e) {
            console.warn('[AnnotationLayer] SVG.js の初期化に失敗:', e);
            return;
        }



        // ResizeObserver: アウトライン開閉など外枠サイズが変わったときにSVG位置を再計算
        // #preview-pane と #preview の両方を監視:
        //   - #preview-pane: ウィンドウリサイズ時
        //   - #preview: アウトライン開閉でプレビュー幅/位置が変わったとき
        _resizeObserver = new ResizeObserver(() => {
            _syncLayerSize(previewPane, previewContent);
            _scheduleAnchorUpdateDebounced();
        });
        _resizeObserver.observe(previewPane);
        _resizeObserver.observe(previewContent); // アウトライン開閉を検知

        // MutationObserver: プレビューのDOMツリー変化を監視（テキスト編集に追随）
        _mutationObserver = new MutationObserver(() => _scheduleAnchorUpdate());
        _mutationObserver.observe(previewContent, {
            childList: true,
            subtree: true,
            characterData: false
        });
        // ウィンドウが再フォーカスされたときにSVGサイズ・位置を再同期する。
        // 非アクティブ中はRAFが止まるため、その間のレイアウト変化（DevTools開閉など）を
        // ウィンドウ復帰時にまとめて修正する。
        window.addEventListener('focus', () => {
            _syncLayerSize(previewPane, previewContent);
            _scheduleAnchorUpdate();
        }, true);

        console.log('[AnnotationLayer] 初期化完了');
    }

    /** アンカー更新をrequestAnimationFrameでスケジュール（連続発火防止付き） */
    let _anchorDebounceTimer = null;
    function _scheduleAnchorUpdate() {
        // RAFガード: 既にスケジュール済みならスキップ
        if (_anchorUpdateTimer) return;
        _anchorUpdateTimer = requestAnimationFrame(() => {
            _anchorUpdateTimer = null;
            _updateAllAnchors();
        });
    }

    /**
     * ResizeObserver用のアンカー更新スケジューラー（デバウンス保護）
     * _syncLayerSize → ResizeObserver → _scheduleAnchorUpdate → _updateAllAnchors → _syncLayerSize
     * というループを防ぐため、setTimeout でスキップ間隔を置く。
     */
    function _scheduleAnchorUpdateDebounced() {
        clearTimeout(_anchorDebounceTimer);
        _anchorDebounceTimer = setTimeout(() => {
            // ResizeObserverからの呈起時は_syncLayerSizeは呼ばず、座標再計算のみ行う
            _updateAllAnchors();
        }, 50);
    }

    /** SVGレイヤーのサイズと位置を同期する（アウトライン開閉対応） */
    function _syncLayerSize(previewPane, previewEl) {
        if (!_svgEl || !previewPane) return;
        if (!previewEl) previewEl = previewPane; // 省略時は pane を使う

        // SVGの left/top を #preview の pane 内オフセットに合わせる。
        // これによりアウトライン開閉でも X 座標がコンテンツと一致する。
        const paneRect    = previewPane.getBoundingClientRect();
        const previewRect = previewEl.getBoundingClientRect();

        // #preview の pane 内相対オフセット
        const offsetLeft = previewRect.left - paneRect.left;
        const offsetTop  = 0;

        _svgEl.style.left = `${offsetLeft}px`;
        _svgEl.style.top  = `${offsetTop}px`;

        // 幅は #preview 自身の幅 (offsetWidth) を使用する
        // これにより left オフセットと合わせても右側にはみ出さず、スクロールバーが発生しない
        const w = previewEl.offsetWidth;
        const h = previewEl.scrollHeight || previewPane.clientHeight;
        _svgEl.setAttribute('width',   w);
        _svgEl.setAttribute('height',  h);
        _svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    // ===== 描画機能 =====

    let _currentColor       = '#e74c3c';
    let _currentStrokeWidth = 3;
    let _isDrawing  = false;
    let _activeShape = null;
    let _lastLoadedSVGString = null; // 同じデータの連続ロード（先祖返り）を防ぐキャッシュ
    let _startPt    = null;
    let _freehandPoints = [];
    let _history    = []; // undo 用
    let _markerStartNode = null;
    let _markerStartOffset = 0;

    function _getSafeRange(startNode, startOffset, endNode, endOffset) {
        const range = document.createRange();
        const pos = startNode.compareDocumentPosition(endNode);
        if (pos & Node.DOCUMENT_POSITION_PRECEDING || (startNode === endNode && startOffset > endOffset)) {
            range.setStart(endNode, endOffset);
            range.setEnd(startNode, startOffset);
        } else {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
        }
        return range;
    }

    /**
     * SVGキャンバス内座標を取得する
     * previewPane のスクロール量を加算してキャンバス絶対座標に変換する
     */
    function _getCanvasPoint(e) {
        if (!_svgEl) return { x: 0, y: 0 };
        const previewPane = document.getElementById('preview-pane');
        const rect       = _svgEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        console.log(`[AnnotationLayer] 座標計算 | mouse:(${e.clientX}, ${e.clientY}) rect:(${rect.left.toFixed(1)}, ${rect.top.toFixed(1)}) canvas:(${x.toFixed(1)}, ${y.toFixed(1)}) scrollTop:${previewPane ? previewPane.scrollTop : 0}`);
        
        return { x, y };
    }

    function _bindDrawEvents() {
        if (!_svgEl) return;
        _svgEl.addEventListener('mousedown',  _onMouseDown);
        _svgEl.addEventListener('mousemove',  _onMouseMove);
        _svgEl.addEventListener('mouseup',    _onMouseUp);
        _svgEl.addEventListener('mouseleave', _onMouseUp);
        document.addEventListener('keydown',  _onKeyDown);
    }

    function _unbindDrawEvents() {
        if (!_svgEl) return;
        _svgEl.removeEventListener('mousedown',  _onMouseDown);
        _svgEl.removeEventListener('mousemove',  _onMouseMove);
        _svgEl.removeEventListener('mouseup',    _onMouseUp);
        _svgEl.removeEventListener('mouseleave', _onMouseUp);
        document.removeEventListener('keydown',  _onKeyDown);
    }

    function _onMouseDown(e) {
        if (!_draw) return;

        if (_currentTool === 'select') {
            // SvgShape 側で処理される
            return;
        }

        e.preventDefault();
        _isDrawing = true;
        _startPt   = _getCanvasPoint(e);
        const { x, y } = _startPt;
        const color     = _currentColor;
        const width     = _currentStrokeWidth;

        try {
            if (_currentTool === 'marker') {
                const oldEvents = _svgEl.style.pointerEvents;
                _svgEl.style.pointerEvents = 'none';
                let range = null;
                if (document.caretRangeFromPoint) {
                    range = document.caretRangeFromPoint(e.clientX, e.clientY);
                } else if (document.caretPositionFromPoint) {
                    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                    if (pos) {
                        range = document.createRange();
                        range.setStart(pos.offsetNode, pos.offset);
                        range.setEnd(pos.offsetNode, pos.offset);
                    }
                }
                _svgEl.style.pointerEvents = oldEvents;

                if (range) {
                    _markerStartNode = range.startContainer;
                    _markerStartOffset = range.startOffset;
                } else {
                    _markerStartNode = null;
                }
                
                _activeShape = _draw.group().attr({
                    'data-tool-id': 'marker'
                }).css({
                    'mix-blend-mode': 'multiply'
                });
            } else if (_currentTool === 'freehand') {
                _freehandPoints = [[x, y]];
                _activeShape = _draw.polyline([[x, y]])
                    .fill('none')
                    .stroke({ color, width, linecap: 'round', linejoin: 'round' });
            } else if (_currentTool === 'rect') {
                _activeShape = _draw.rect(1, 1).move(x, y).fill('none').stroke({ color, width });
            } else if (_currentTool === 'circle') {
                _activeShape = _draw.ellipse(1, 1).move(x, y).fill('none').stroke({ color, width });
            } else if (_currentTool === 'line') {
                _activeShape = _draw.line(x, y, x + 1, y).stroke({ color, width, linecap: 'round' });
            } else if (_currentTool === 'bubble') {
                const pathData = _getBubblePath(70, 50);
                const shiftedPath = pathData.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
                    return "M " + (parseFloat(p1) + x) + " " + (parseFloat(p2) + y);
                });
                _activeShape = _draw.path(shiftedPath)
                    .fill('none').stroke({ color, width })
                    .attr({
                        'data-tool-id': 'bubble',
                        'data-tail-side': 'bottom',
                        'data-tail-pos': 20,
                        'data-tail-width': 10,
                        'data-width': 70,
                        'data-height': 50,
                        'data-rect-x': x,
                        'data-rect-y': y
                    });
            }
        } catch (err) {
            console.error('[AnnotationLayer] mousedown エラー:', err);
            _isDrawing = false;
        }
    }

    function _onMouseMove(e) {
        if (_currentTool === 'select') return;
        if (!_isDrawing || !_activeShape) return;
        const pt = _getCanvasPoint(e);

        if (_currentTool === 'marker') {
            if (!_markerStartNode || !_activeShape) return;
            
            const oldEvents = _svgEl.style.pointerEvents;
            _svgEl.style.pointerEvents = 'none';
            let currentRange = null;
            if (document.caretRangeFromPoint) {
                currentRange = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) {
                    currentRange = document.createRange();
                    currentRange.setStart(pos.offsetNode, pos.offset);
                    currentRange.setEnd(pos.offsetNode, pos.offset);
                }
            }
            _svgEl.style.pointerEvents = oldEvents;

            if (currentRange) {
                const range = _getSafeRange(_markerStartNode, _markerStartOffset, currentRange.startContainer, currentRange.startOffset);
                const rects = range.getClientRects();
                const svgRect = _svgEl.getBoundingClientRect();
                
                _activeShape.clear();
                
                // RGB/RGBA形式以外で不透明度が欲しい場合はColorPickerのアルファ値に依存する
                const mColor = _currentColor;
                
                for (let i = 0; i < rects.length; i++) {
                    const r = rects[i];
                    if (r.width > 0 && r.height > 0) {
                        _activeShape.rect(r.width, r.height)
                            .move(r.left - svgRect.left, r.top - svgRect.top)
                            .fill(mColor)
                            .stroke('none');
                    }
                }
            }
        } else if (_currentTool === 'freehand') {
            _freehandPoints.push([pt.x, pt.y]);
            _activeShape.plot(_freehandPoints);
        } else if (_currentTool === 'rect' || _currentTool === 'circle' || _currentTool === 'bubble') {
            const dx = pt.x - _startPt.x;
            const dy = pt.y - _startPt.y;
            
            if (_currentTool === 'bubble') {
                const w = Math.max(70, Math.abs(dx));
                const h = Math.max(50, Math.abs(dy));
                const mx = dx < 0 ? pt.x : _startPt.x;
                const my = dy < 0 ? pt.y : _startPt.y;
                const pathData = _getBubblePath(w, h);
                const shiftedPath = pathData.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
                    return "M " + (parseFloat(p1) + mx) + " " + (parseFloat(p2) + my);
                });
                _activeShape.plot(shiftedPath);
                _activeShape.attr({
                    'data-width': w,
                    'data-height': h,
                    'data-rect-x': mx,
                    'data-rect-y': my
                });
            } else {
                _activeShape.move(dx < 0 ? pt.x : _startPt.x, dy < 0 ? pt.y : _startPt.y)
                            .size(Math.abs(dx), Math.abs(dy));
            }
        } else if (_currentTool === 'line') {
            _activeShape.plot(_startPt.x, _startPt.y, pt.x, pt.y);
        }
    }

    function _onMouseUp() {
        if (_currentTool === 'select') return;

        if (!_isDrawing) return;
        _isDrawing = false;

        if (_activeShape) {
            let keep = true;
            if (_currentTool === 'marker') {
                if (!_activeShape.children || _activeShape.children().length === 0) keep = false;
            } else {
                const bbox = _activeShape.bbox();
                if (_currentTool !== 'freehand' && bbox.width < 3 && bbox.height < 3) keep = false;
            }

            if (!keep) {
                _activeShape.remove();
            } else {
                _activeShape.attr('data-annotation', 'true');
                _history.push(_activeShape);

                if (typeof window.makeInteractive === 'function') {
                    window.makeInteractive(_activeShape);
                    if (typeof window.selectElement === 'function') {
                        window.selectElement(_activeShape);
                    }
                }

                // 描画完了直後にアンカーを設定
                _attachNearestAnchor(_activeShape);
                _notifyChange();
            }
        }
        _activeShape    = null;
        _freehandPoints = [];
        _markerStartNode = null;

        // 描画後は自動的に選択ツールに戻る
        if (window.activeAnnotationToolbar && typeof window.activeAnnotationToolbar.setActiveTool === 'function') {
            window.activeAnnotationToolbar.setActiveTool('select');
        }
    }

    function _onKeyDown(e) {
        if (!_isActive || !window.currentEditingSVG) return;
        
        // 入力フィールド等でのキー操作は無視する
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const selected = Array.from(window.currentEditingSVG.selectedElements);
            const shapesToDelete = selected.filter(el => el.attr('data-annotation') === 'true');
            if (shapesToDelete.length > 0) {
                e.preventDefault();
                shapesToDelete.forEach(el => {
                    const id = el.id();
                    if (id) _anchorMap.delete(id);
                    const shape = el.remember('_shapeInstance');
                    if (shape && typeof shape.destroy === 'function') {
                        shape.destroy();
                    }
                    el.remove();
                });
                if (typeof window.deselectAll === 'function') window.deselectAll();
                _updateAllAnchorsForModifiedShapes();
                _notifyChange();
            }
        }
    }

    /**
     * 吹き出しのSVGパスを生成する
     */
    function _getBubblePath(w, h, options = {}) {
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

    // ===== アンカー機能（data-line 行番号ベース） =====

    /**
     * 図形を最近傍の段落に紐付ける。
     * レンダラーが付与する data-line 属性（Markdownの行番号）をアンカーキーに使う。
     * これにより、テンプレート重複・フルレンダリングによるID消失を根本解決する。
     */
    function _attachNearestAnchor(shapeEl) {
        if (!shapeEl || !_svgEl) return;
        const previewContent = document.getElementById('preview');
        if (!previewContent) return;

        const bbox         = shapeEl.bbox();
        const shapeCenterY = bbox.y + bbox.height / 2;
        const svgRect      = _svgEl.getBoundingClientRect();
        if (svgRect.width === 0 && svgRect.height === 0) return;

        // data-line を持つ要素を優先的に走査する
        const candidates = previewContent.querySelectorAll(
            '[data-line], p, h1, h2, h3, h4, h5, h6, li, blockquote'
        );
        let nearest = null;
        let minDist = Infinity;
        candidates.forEach(el => {
            const r = el.getBoundingClientRect();
            const cy = r.top - svgRect.top + r.height / 2;
            const d  = Math.abs(shapeCenterY - cy);
            if (d < minDist) { minDist = d; nearest = el; }
        });
        if (!nearest) return;

        // data-line が取れない場合は先祖を辿る
        let lineEl = nearest;
        while (lineEl && !lineEl.dataset.line) lineEl = lineEl.parentElement;
        const sourceLine = lineEl ? parseInt(lineEl.dataset.line, 10) : null;

        const paraRect        = nearest.getBoundingClientRect();
        const paraTopInCanvas = paraRect.top - svgRect.top;

        let shapeId = shapeEl.id();
        if (!shapeId) {
            shapeId = `anno-shape-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            shapeEl.id(shapeId);
        }

        _anchorMap.set(shapeId, {
            sourceLine   : sourceLine,                              // Markdown行番号（主キー）
            paragraphText: (nearest.textContent || '').trim().slice(0, 30), // フォールバック用
            offsetY      : bbox.y - paraTopInCanvas,
            initialBboxY : bbox.y
        });

        console.log(`[AnnotationLayer] アンカー設定: shape=${shapeId.slice(-8)} | line=${sourceLine} | text="${(nearest.textContent||'').trim().slice(0,10)}" | offsetY=${(bbox.y - paraTopInCanvas).toFixed(1)}`);
    }

    /**
     * data-line から段落要素を取得する。
     * data-line が一致する要素、またはその直近の兄弟/子要素を返す。
     */
    function _findElBySourceLine(previewContent, sourceLine) {
        if (sourceLine == null) return null;
        // data-line が完全一致する要素を優先
        let el = previewContent.querySelector(`[data-line="${sourceLine}"]`);
        if (el) return el;
        // 見つからない場合は最も近い行番号の要素を返す
        const all = Array.from(previewContent.querySelectorAll('[data-line]'));
        if (all.length === 0) return null;
        let best = null, bestDist = Infinity;
        for (const e of all) {
            const l = parseInt(e.dataset.line, 10);
            const d = Math.abs(l - sourceLine);
            if (d < bestDist) { bestDist = d; best = e; }
        }
        return best;
    }

    /**
     * SvgShape によって操作（移動・リサイズ）された図形のアンカー情報を再計算して更新する。
     */
    function _updateAllAnchorsForModifiedShapes() {
        if (!_draw) return;
        _draw.find('[data-annotation="true"]').forEach(shapeEl => {
            _attachNearestAnchor(shapeEl);
        });
    }

    /**
     * 全アンカーを再計算し、図形を段落に追随させる
     *
     * ===== 正しいアルゴリズム =====
     * SVG.js v3 の bbox() は transform を考慮しない「ローカル座標」を返す。
     * そのため「bbox.y + 現translateY = 実際の画面上のY」となる。
     *
     * 目標: 図形の画面上のYを targetY にしたい
     *   → 必要な translateY = targetY - bbox.y(transform前)
     *   → つまり translateY = targetY - initialBboxY
     *
     * initialBboxY はアンカー設定時の bbox.y（transform前の純粋な描画位置）。
     * これを毎回「絶対値」として設定するため、累積ズレが発生しない。
     *
     * NG例（以前の実装）:
     *   dy = targetY - currentBboxY    ← bbox.yがtransformを含まないため毎回ズレる
     *   translateY += dy               ← 呼ぶたびに累積してズレる/消滅する
     */
    function _updateAllAnchors() {
        if (!_draw || _anchorMap.size === 0) return;

        // SVGのX位置を#previewの現在位置に合わせて更新（アウトライン開閉に即座に対応）
        // left変更はpaneのサイズに影響しないためResizeObserverループにならない
        const paneEl    = document.getElementById('preview-pane');
        const contentEl = document.getElementById('preview');
        if (paneEl && contentEl) {
            const newLeft = contentEl.getBoundingClientRect().left
                          - paneEl.getBoundingClientRect().left;
            _svgEl.style.left = `${newLeft}px`;
        }

        // left更新後にsvgRectを取得（更新前の値を使うと座標がズレる）
        const svgRect = _svgEl.getBoundingClientRect();

        // SVGレイヤーが非表示の場合はスキップ
        if (svgRect.width === 0 && svgRect.height === 0) return;


        _anchorMap.forEach((anchor, shapeId) => {
            const escaped = typeof CSS !== 'undefined' ? CSS.escape(shapeId) : shapeId;
            const shapeEl = _draw.findOne(`#${escaped}`);
            if (!shapeEl) return;

            const previewContent = document.getElementById('preview');
            if (!previewContent) return;

            // data-line（行番号）で段落を検索 → テンプレート重複・ID消失に依存しない
            let paraEl = _findElBySourceLine(previewContent, anchor.sourceLine);

            if (!paraEl) {
                console.warn(`[AnnotationLayer] 段落が見つかりません: line=${anchor.sourceLine} text="${anchor.paragraphText}"`);
                return;
            }

            const paraRect = paraEl.getBoundingClientRect();
            // paraRect.top - svgRect.top でスクロールは相殺済み
            // scrollTop を足すと二重計上になるため除去
            const newParaTopInCanvas = paraRect.top - svgRect.top;
            // 図形があるべき Y 座標（絶対値）
            const targetY = newParaTopInCanvas + anchor.offsetY;

            // 必要な translateY（絶対値）= targetY - initialBboxY
            // SVG.js の transform() は API に依存するため、
            // attr('transform', ...) で SVG 属性を直接文字列設定する（累積しない）
            const newTy = targetY - anchor.initialBboxY;

            // 現在の translate 文字列からXだけ取り出す
            const currentTransform = shapeEl.node.getAttribute('transform') || '';
            const matchX = currentTransform.match(/translate\s*\(\s*([+-]?\d*\.?\d+)/);
            const currentTx = matchX ? parseFloat(matchX[1]) : 0;

            // 変化量が微小ならスキップ
            const matchY = currentTransform.match(/translate\s*\(\s*[+-]?\d*\.?\d+\s*,\s*([+-]?\d*\.?\d+)/);
            const currentTy = matchY ? parseFloat(matchY[1]) : 0;
            if (Math.abs(newTy - currentTy) < 0.5) return;

            // デバッグログ: アンカー先テキスト先頭10文字と計算値を出力
            const paraText = (paraEl.textContent || '').trim().slice(0, 10);
            console.log(
                `[AnnotationLayer] 図形移動: shape="${shapeId.slice(-8)}"` +
                ` | 段落="${paraText}"` +
                ` | paraTop=${newParaTopInCanvas.toFixed(1)}` +
                ` | offsetY=${anchor.offsetY.toFixed(1)}` +
                ` | initBboxY=${anchor.initialBboxY.toFixed(1)}` +
                ` | targetY=${targetY.toFixed(1)}` +
                ` | newTy=${newTy.toFixed(1)}` +
                ` | 前Ty=${currentTy.toFixed(1)}`
            );

            // SVG transform 属性を直接上書き（累積しない）
            shapeEl.node.setAttribute('transform', `translate(${currentTx},${newTy})`);
        });
    }


    /**
     * 注釈データをエディタのテキスト末尾の <!-- ANNOTATION_DATA --> ブロックに書き込む。
     * updateEditorRange で末尾ブロックだけ外科的置換するためカーソルはづれない。
     * CM6 の Undo スタックに積まるので Ctrl+Z で注釈も元に戻せる。
     * loadSVGData は _notifyChange を呼ばないのでループしない。
     */
    function _updateEditorAnnotationData() {
        if (_isApplyingAnnotationToEditor) return;
        if (typeof window.updateEditorRange !== 'function') return;

        const svgData = getSVGData();
        const currentText = (typeof getEditorText === 'function')
            ? getEditorText()
            : (typeof AppState !== 'undefined' ? AppState.text : null);
        if (currentText == null) return;

        const ANNO_RE = /\n?<!-- ANNOTATION_DATA:[\s\S]*?-->/;
        const match   = ANNO_RE.exec(currentText);

        // ===== スクロール調査ログ（更新前） =====
        const ev  = window.editorInstance;
        const pp  = document.getElementById('preview-pane');
        const bES = ev  ? ev.scrollDOM.scrollTop          : 'N/A';
        const bPS = pp  ? pp.scrollTop                    : 'N/A';
        const bCP = ev  ? ev.state.selection.main.head    : 'N/A';
        const docLen   = currentText.length;
        const updFrom  = match ? match.index              : docLen;
        const updTo    = match ? match.index + match[0].length : docLen;
        console.log(`[AnnotationLayer][ScrollDebug] 更新前 | cursor=${bCP} | editorScroll=${bES} | previewScroll=${bPS} | from=${updFrom} to=${updTo} docLen=${docLen}`);
        // ======================================================

        _isApplyingAnnotationToEditor = true;
        try {
            if (svgData) {
                _lastLoadedSVGString = svgData; // 保存した最新データでキャッシュを更新
                const newBlock = `\n<!-- ANNOTATION_DATA:${svgData}-->`;
                if (match) {
                    window.updateEditorRange(match.index, match.index + match[0].length, newBlock);
                } else {
                    window.updateEditorRange(currentText.length, currentText.length, newBlock);
                }
            } else if (match) {
                window.updateEditorRange(match.index, match.index + match[0].length, '');
            }
        } finally {
            _isApplyingAnnotationToEditor = false;
        }

        // ===== スクロール調査ログ（更新後 RAF） =====
        requestAnimationFrame(() => {
            const aES = ev ? ev.scrollDOM.scrollTop       : 'N/A';
            const aPS = pp ? pp.scrollTop                 : 'N/A';
            const aCP = ev ? ev.state.selection.main.head : 'N/A';
            const dES = (typeof bES === 'number' && typeof aES === 'number') ? aES - bES : '?';
            const dPS = (typeof bPS === 'number' && typeof aPS === 'number') ? aPS - bPS : '?';
            console.log(`[AnnotationLayer][ScrollDebug] 更新後(RAF) | cursor=${aCP}(diff=${aCP-bCP}) | editorScroll=${aES}(diff=${dES}) | previewScroll=${aPS}(diff=${dPS})`);
            if (dES !== 0 && dES !== '?') console.warn(`[AnnotationLayer][ScrollDebug] ⚠ エディタスクロール diff=${dES}px`);
            if (dPS !== 0 && dPS !== '?') console.warn(`[AnnotationLayer][ScrollDebug] ⚠ プレビュースクロール diff=${dPS}px`);
        });
        // =====================================================
    }

    /** 変更をエディタに通知（保存フラグを立てる） */
    function _notifyChange() {
        if (typeof AppState !== 'undefined') AppState.isModified = true;
        if (typeof updateTitle === 'function') updateTitle();
        // エディタテキストに注釈データを反映（Ctrl+Z に対応）
        _updateEditorAnnotationData();
    }

    // ===== 公開 API =====

    /** アノテーションモードを有効化する */
    function enable() {
        if (!_svgEl) init();
        if (!_svgEl) return;

        _isActive = true;
        _svgEl.classList.add('annotation-layer--active');
        if (window.activeAnnotationToolbar) window.activeAnnotationToolbar.show();
        _bindDrawEvents();
        _syncLayerSize(document.getElementById('preview-pane'));

        // [FIX] Ensure text alignment toolbar exists for auto-fit calculations
        if (!window.SVGTextAlignmentToolbar && typeof window.createTextAlignToolbar === 'function') {
            const dummyContainer = document.createElement('div');
            window.SVGTextAlignmentToolbar = window.createTextAlignToolbar(dummyContainer, _draw, { id: 'hidden-text-align' });
            // Override show to prevent any accidental display
            window.SVGTextAlignmentToolbar.show = () => {};
        }

        // SvgShape インタラクション用のモック
        if (!window.currentEditingSVG) {
            window.currentEditingSVG = {
                draw: _draw,
                container: _svgEl.parentNode,
                selectedElements: new Set(),
                isShiftPressed: false,
                isCtrlPressed: false,
                isAltPressed: false,
                zoom: 100,
                pushUndoState: () => {
                    _updateAllAnchorsForModifiedShapes();
                    _notifyChange();
                },
                showGuides: () => {},
                hideGuides: () => {},
                _isAnnotationLayerMock: true
            };
        }

        // 既存の全図形をインタラクティブ化
        if (typeof window.makeInteractive === 'function') {
            _draw.find('[data-annotation="true"]').forEach(el => window.makeInteractive(el));
        }

        console.log('[AnnotationLayer] 有効化');
    }

    /**
     * アノテーションモードを無効化する
     *
     * 注意: SVGレイヤー自体は DOM に残し pointer-events:none のみにする。
     *       display:none にすると getBoundingClientRect() が 0 になり
     *       アンカー追随計算が崩壊するため。
     */
    function disable() {
        _isActive = false;
        // SVGレイヤーは非表示にしない（アンカー追随を維持するため）
        if (_svgEl) _svgEl.classList.remove('annotation-layer--active');
        if (window.activeAnnotationToolbar) window.activeAnnotationToolbar.hide();
        _unbindDrawEvents();

        if (window.currentEditingSVG && window.currentEditingSVG._isAnnotationLayerMock) {
            if (typeof window.deselectAll === 'function') window.deselectAll();
            window.currentEditingSVG = null;
        }

        console.log('[AnnotationLayer] 無効化');
    }

    /** アノテーションモードのトグル */
    function toggle() {
        if (_isActive) disable();
        else enable();
        return _isActive;
    }

    /** 描画ツールを切り替える */
    function setTool(toolName) {
        _currentTool = toolName;
        if (_svgEl) {
            _svgEl.style.cursor = toolName === 'select' ? 'default' : 'crosshair';
        }
        if (toolName !== 'select' && typeof window.deselectAll === 'function') {
            window.deselectAll();
        }
    }

    /** 最後の図形を元に戻す */
    function undo() {
        if (_history.length === 0) return;
        const last = _history.pop();
        if (last) {
            const id = last.id();
            if (id) _anchorMap.delete(id);
            last.remove();
            _notifyChange();
        }
    }

    /** 全アノテーションを削除する */
    function clearAll() {
        if (!_draw) return;
        _draw.find('[data-annotation="true"]').forEach(el => el.remove());
        _history = [];
        _anchorMap.clear();
        _notifyChange();
    }

    /**
     * SVGレイヤーをサイレントにクリア（_notifyChangeを呼び出さない）。
     * Ctrl+Z で注釈ブロックが消えた時に renderer.js から呼ぶ。
     * _notifyChangeを呼ぶとエディタ再書き込み・ループになるため直接クリアする。
     */
    function clearSilent() {
        if (!_draw) return;
        _draw.find('[data-annotation="true"]').forEach(el => el.remove());
        _history = [];
        _anchorMap.clear();
        _prevContent = null; // コンテンツトラッカーをリセット
        // _notifyChange() は呼び出さない
    }

    /**
     * 保存用の SVG データ文字列を取得する
     * アンカーマップを data-anchor-map 属性として SVG に埋め込む
     */
    function getSVGData() {
        if (!_svgEl || !_draw) return '';
        const shapes = _draw.find('[data-annotation="true"]');
        if (shapes.length === 0) return '';

        const anchorJson = JSON.stringify(Object.fromEntries(_anchorMap));
        _svgEl.setAttribute('data-anchor-map', anchorJson);
        return _svgEl.outerHTML;
    }

    /**
     * SVG データを復元する（ファイル読み込み時）
     * @param {string} svgString - getSVGData() で取得した SVG 文字列
     */
    function loadSVGData(svgString) {
        if (!_draw || !svgString) return;
        if (_lastLoadedSVGString === svgString) return; // 内容が同じなら再構築（先祖返り）をスキップ

        // 既存アノテーションをクリア
        _draw.find('[data-annotation="true"]').forEach(el => el.remove());
        _history = [];
        _anchorMap.clear();
        _lastLoadedSVGString = svgString;

        const parser    = new DOMParser();
        const doc       = parser.parseFromString(svgString, 'image/svg+xml');
        const sourceSvg = doc.querySelector('svg');
        if (!sourceSvg) return;

        // アンカーマップを復元
        const anchorJson = sourceSvg.getAttribute('data-anchor-map');
        if (anchorJson) {
            try {
                const entries = JSON.parse(anchorJson);
                Object.entries(entries).forEach(([k, v]) => _anchorMap.set(k, v));
            } catch (e) {
                console.warn('[AnnotationLayer] アンカーマップの復元に失敗:', e);
            }
        }

        // アノテーション要素を _svgEl に追加
        Array.from(sourceSvg.children).forEach(child => {
            if (child.getAttribute('data-annotation') === 'true') {
                const imported = document.importNode(child, true);
                _svgEl.appendChild(imported);
                const wrapped = SVG(imported);
                _history.push(wrapped);
            }
        });

        console.log(`[AnnotationLayer] ${_history.length}個の図形を復元しました`);
        _prevContent = null; // ファイル読み込み時はコンテンツトラッカーをリセットし、誤った行シフトを防ぐ
    }

    /** アノテーションモードが有効かどうか */
    function isActive() { return _isActive; }

    /**
     * アンカー位置を今すぐ更新する（レンダラーから呼び出す公開API）
     */
    function updateAnchors() {
        _updateAllAnchors();
    }

    /**
     * レンダリング前にコンテンツ差分でアンカー行番号を更新する（公開API）
     *
     * ユーザー提案の実装:
     *   1. 新旧コンテンツを行単位で比較
     *   2. 最初に差異が生じた行（firstDiff）を検出
     *   3. 行数の増減（delta）を計算
     *   4. firstDiff より後にある全アンカーの sourceLine を delta だけずらす
     *
     * これにより、先頭/途中へのテンプレート挿入・行削除に関係なく
     * アンカーが常に正しい行を指し続ける。
     *
     * @param {string} newContent - レンダリングされる新しいMarkdownテキスト
     */
    function trackContentChange(newContent) {
        if (_anchorMap.size === 0 || _prevContent === null) {
            _prevContent = newContent;
            return;
        }
        if (_prevContent === newContent) return;

        const oldLines = _prevContent.split('\n');
        const newLines = newContent.split('\n');

        // 最初に差異が生じた行インデックス（0始まり）を求める
        let firstDiff = 0;
        const minLen = Math.min(oldLines.length, newLines.length);
        while (firstDiff < minLen && oldLines[firstDiff] === newLines[firstDiff]) {
            firstDiff++;
        }

        // 行数の増減
        const delta = newLines.length - oldLines.length;
        if (delta === 0) {
            _prevContent = newContent;
            return; // 行数変化なし（インライン編集のみ）
        }

        // firstDiff（0始まり）より後ろにあるアンカーの行番号を更新
        // アンカーの sourceLine は 1始まりなので firstDiff+1 と比較
        _anchorMap.forEach((anchor) => {
            if (anchor.sourceLine == null) return;
            if (anchor.sourceLine > firstDiff + 1) {
                const before = anchor.sourceLine;
                anchor.sourceLine = Math.max(1, anchor.sourceLine + delta);
                console.log(`[AnnotationLayer] 行番号更新: ${before} → ${anchor.sourceLine} (firstDiff=${firstDiff+1}, delta=${delta})`);
            }
        });

        _prevContent = newContent;
    }

    function setColor(color) {
        _currentColor = color;
    }

    function setStrokeWidth(width) {
        _currentStrokeWidth = width;
    }

    return { init, enable, disable, toggle, setTool, setColor, setStrokeWidth, undo, clearAll, clearSilent, getSVGData, loadSVGData, isActive, updateAnchors, trackContentChange };

})();
