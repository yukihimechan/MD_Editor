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

        // [追加] ユーザー要望: 注釈オフ時にクリックがプレビューへ素通りしているか確認するデバッグ用ログ
        document.addEventListener('click', (e) => {
            if (!_isActive) {
                const pane = document.getElementById('preview-pane');
                // クリックされた場所がプレビュー画面内か判定
                if (pane && pane.contains(e.target)) {
                    // SVGレイヤー自身がクリックされていない（素通りしている）ことを確認
                    if (e.target !== _svgEl && !e.target.closest('.annotation-layer')) {
                        console.log(`[AnnotationLayer Debug] 注釈オフ: クリックがプレビュー画面(${e.target.tagName.toLowerCase()})へ素通りしました`);
                    }
                }
            }
        });

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

    let _bubbleObserver = null;

    function _initBubbleObserver() {
        if (_bubbleObserver) _bubbleObserver.disconnect();
        
        _bubbleObserver = new MutationObserver((mutations) => {
            let processed = new Set();
            mutations.forEach(m => {
                const target = m.target;
                if (!target || !target.tagName) return;

                // status-icons の変更は無視（無限ループ防止）
                if (target.hasAttribute('data-status-icon') || 
                    (target.parentNode && target.parentNode.hasAttribute && target.parentNode.hasAttribute('data-status-icon'))) {
                    return;
                }
                
                let shapeEl = null;
                if (target.getAttribute('data-tool-id') === 'bubble') {
                    // SVG.jsインスタンスを取り出すかラップする
                    const id = target.getAttribute('id');
                    if (id) shapeEl = _draw.findOne(`#${CSS.escape(id)}`);
                    // console.log('[AnnotationLayer] Observer hit bubble directly:', id);
                } else if (target.tagName.toLowerCase() === 'g') {
                    const bubbleChild = target.querySelector('[data-tool-id="bubble"]');
                    if (bubbleChild) {
                        const id = bubbleChild.getAttribute('id');
                        if (id) shapeEl = _draw.findOne(`#${CSS.escape(id)}`);
                        // console.log('[AnnotationLayer] Observer hit group for bubble:', id);
                    }
                }
                
                if (shapeEl && !processed.has(shapeEl.id())) {
                    processed.add(shapeEl.id());
                    console.log(`[AnnotationLayer] Observer rendering icons for ${shapeEl.id()}`);
                    _renderStatusIcons(shapeEl);
                }
            });
        });
        
        if (_svgEl) {
            _bubbleObserver.observe(_svgEl, {
                attributes: true,
                attributeFilter: ['transform', 'x', 'y', 'width', 'height', 'd'],
                subtree: true
            });
            console.log('[AnnotationLayer] Bubble Observer started on _svgEl');
        }
    }
    let _markerStartOffset = 0;

    // --- 内部状態に追加 ---
    let _svgRectCache = null; // ドラッグ中の座標キャッシュ用

    // 【修正】クラッシュ対策 (try-catchを追加)
    function _getSafeRange(startNode, startOffset, endNode, endOffset) {
        const range = document.createRange();
        try {
            const pos = startNode.compareDocumentPosition(endNode);
            if (pos & Node.DOCUMENT_POSITION_PRECEDING || (startNode === endNode && startOffset > endOffset)) {
                range.setStart(endNode, endOffset);
                range.setEnd(startNode, startOffset);
            } else {
                range.setStart(startNode, startOffset);
                range.setEnd(endNode, endOffset);
            }
        } catch (e) {
            // 例外発生時は開始位置のみの安全なRangeを返す
            range.setStart(startNode, startOffset);
            range.setEnd(startNode, startOffset);
        }
        return range;
    }

    // 【修正】座標のキャッシュ化 (強制リフローの防止)
    function _getCanvasPoint(e) {
        if (!_svgEl) return { x: 0, y: 0 };
        const rect = _svgRectCache || _svgEl.getBoundingClientRect();
        return { 
            x: e.clientX - rect.left, 
            y: e.clientY - rect.top 
        };
    }

    function _bindDrawEvents() {
        if (!_svgEl) return;
        _svgEl.addEventListener('mousedown',  _onMouseDown);
        document.addEventListener('mousemove',  _onMouseMove);
        document.addEventListener('mouseup',    _onMouseUp);
        document.addEventListener('keydown',  _onKeyDown);
    }

    function _unbindDrawEvents() {
        if (!_svgEl) return;
        _svgEl.removeEventListener('mousedown',  _onMouseDown);
        document.removeEventListener('mousemove',  _onMouseMove);
        document.removeEventListener('mouseup',    _onMouseUp);
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
        _svgRectCache = _svgEl.getBoundingClientRect(); // 【追加】ドラッグ開始時にキャッシュ取得
        
        _startPt   = _getCanvasPoint(e);
        const { x, y } = _startPt;
        const color     = _currentColor;
        const width     = _currentStrokeWidth;

        try {
            if (_currentTool === 'marker') {
                // 【追加】描画中のみ pointerEvents を none にする
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

                if (range) {
                    _markerStartNode = range.startContainer;
                    _markerStartOffset = range.startOffset;
                } else {
                    _markerStartNode = null;
                }
                
                _activeShape = _draw.group().attr({
                    'data-tool-id': 'marker'
                }).css({ 'mix-blend-mode': 'multiply' });
                
                // 【修正】大量のRectではなく、1つのPathデータで描画するよう初期化
                _activeShape.markerPath = _activeShape.path('').fill(color).stroke('none');

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
            
            // 毎フレームの pointerEvents の切り替えを削除
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

            if (currentRange) {
                const range = _getSafeRange(_markerStartNode, _markerStartOffset, currentRange.startContainer, currentRange.startOffset);
                const rects = range.getClientRects();
                const svgRect = _svgRectCache;
                
                // 【追加】ユーザーから要望のあったドラッグ時のログ出力
                console.log(`[AnnotationLayer] マーカー描画中 | rects:${rects.length}個 | x:${e.clientX}, y:${e.clientY}`);

                // 【修正】clear() をやめ、文字列 (d属性) だけで描画を完結（レイアウトスラッシング消滅）
                let pathStr = '';
                for (let i = 0; i < rects.length; i++) {
                    const r = rects[i];
                    if (r.width > 0 && r.height > 0) {
                        const rx = r.left - svgRect.left;
                        const ry = r.top - svgRect.top;
                        pathStr += `M${rx},${ry} h${r.width} v${r.height} h-${r.width} Z `;
                    }
                }
                if (_activeShape.markerPath) {
                    _activeShape.markerPath.plot(pathStr);
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
        _svgRectCache = null; // 【追加】キャッシュ解放
        _svgEl.style.pointerEvents = ''; // 【修正】CSSによる制御に戻すため空にする

        if (_activeShape) {
            let keep = true;
            if (_currentTool === 'marker') {
                // 【修正】子要素の数ではなく、pathのd属性が空かどうかで判定
                if (!_activeShape.markerPath || !_activeShape.markerPath.attr('d')) keep = false;
            } else {
                const bbox = _activeShape.bbox();
                if (_currentTool !== 'freehand' && bbox.width < 3 && bbox.height < 3) keep = false;
            }

            if (!keep) {
                _activeShape.remove();
            } else {
                _activeShape.attr('data-annotation', 'true');

                // 吹き出しの場合はステータス属性を付与
                if (_currentTool === 'bubble') {
                    _activeShape.attr('data-read-status', 'unread');
                    _activeShape.attr('data-action-status', 'pending');
                }

                _history.push(_activeShape);

                if (typeof window.makeInteractive === 'function') {
                    window.makeInteractive(_activeShape);
                    if (typeof window.selectElement === 'function') {
                        window.selectElement(_activeShape);
                    }
                }

                // 描画完了直後にアンカーを設定
                _attachNearestAnchor(_activeShape);

                // 吹き出しの場合はステータスアイコンを描画
                if (_currentTool === 'bubble') {
                    _renderStatusIcons(_activeShape);
                }

                _notifyChange();

                // コメントパネルを更新
                if (typeof window.AnnotationCommentPanel !== 'undefined') {
                    window.AnnotationCommentPanel.refresh();
                }
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
        
        // 入力フィールドやダイアログ等でのキー操作は無視する
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest('dialog')) return;
        
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

        let syncId = null;
        if (nearest) {
            // Check if nearest is an SVG with sync-id
            if (nearest.tagName.toLowerCase() === 'svg' && nearest.hasAttribute('data-sync-id')) {
                syncId = nearest.getAttribute('data-sync-id');
            } else {
                // Check if nearest contains an element with sync-id (like SVG or Mermaid wrapper)
                const syncChild = nearest.querySelector('[data-sync-id]');
                if (syncChild) syncId = syncChild.getAttribute('data-sync-id');
            }
        }

        // 既存エントリのコメントを引き継ぐ（再アンカー時にコメントが消えないよう）
        const existingEntry = _anchorMap.get(shapeId);
        _anchorMap.set(shapeId, {
            sourceLine   : sourceLine,                              // Markdown行番号（主キー）
            syncId       : syncId,                                  // 一意の同期ID（SVGやMermaid用）
            paragraphText: (nearest.textContent || '').trim().slice(0, 30), // フォールバック用
            offsetY      : bbox.y - paraTopInCanvas,
            initialBboxY : bbox.y,
            comment      : existingEntry ? (existingEntry.comment || '') : '' // コメントを引き継ぐ
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
    // 【修正】入力毎の多重走査（O(N^2)）を排除
    function _updateAllAnchors() {
        if (!_draw || _anchorMap.size === 0) return;

        const paneEl    = document.getElementById('preview-pane');
        const contentEl = document.getElementById('preview');
        if (paneEl && contentEl) {
            const newLeft = contentEl.getBoundingClientRect().left - paneEl.getBoundingClientRect().left;
            if (_svgEl.style.left !== `${newLeft}px`) _svgEl.style.left = `${newLeft}px`;
        }

        const svgRect = _svgEl.getBoundingClientRect();
        if (svgRect.width === 0 && svgRect.height === 0) return;

        // 【最適化】全 [data-line] 要素を1回だけ取得して辞書(Map)化
        const lineNodes = contentEl ? contentEl.querySelectorAll('[data-line]') : [];
        const lineMap = new Map();
        const lineArray = [];
        lineNodes.forEach(el => {
            const line = parseInt(el.dataset.line, 10);
            if (!isNaN(line)) {
                if (!lineMap.has(line)) lineMap.set(line, el);
                lineArray.push({ line, el });
            }
        });

        _anchorMap.forEach((anchor, shapeId) => {
            const escaped = typeof CSS !== 'undefined' ? CSS.escape(shapeId) : shapeId;
            const shapeEl = _draw.findOne(`#${escaped}`);
            if (!shapeEl) return;

            let paraEl = null;
            
            // 1. syncId による確実な要素特定を優先
            if (anchor.syncId) {
                const syncEl = contentEl.querySelector(`[data-sync-id="${anchor.syncId}"]`);
                if (syncEl) {
                    paraEl = syncEl.closest('[data-line]') || syncEl;
                    // 行番号が変わっていたら更新しておく
                    if (paraEl.dataset && paraEl.dataset.line) {
                        anchor.sourceLine = parseInt(paraEl.dataset.line, 10);
                    }
                }
            }

            // 2. syncId で見つからない場合は sourceLine にフォールバック
            if (!paraEl && anchor.sourceLine != null) {
                if (lineMap.has(anchor.sourceLine)) {
                    paraEl = lineMap.get(anchor.sourceLine); // O(1)アクセス
                } else if (lineArray.length > 0) {
                    let best = null;
                    let bestDist = Infinity;
                    for (let i = 0; i < lineArray.length; i++) {
                        const d = Math.abs(lineArray[i].line - anchor.sourceLine);
                        if (d < bestDist) { bestDist = d; best = lineArray[i].el; }
                    }
                    paraEl = best;
                }
                
                // 【互換性対応】旧データで syncId がない場合、ここで特定できた要素から補完する
                if (paraEl && !anchor.syncId) {
                    if (paraEl.tagName.toLowerCase() === 'svg' && paraEl.hasAttribute('data-sync-id')) {
                        anchor.syncId = paraEl.getAttribute('data-sync-id');
                    } else {
                        const syncChild = paraEl.querySelector('[data-sync-id]');
                        if (syncChild) anchor.syncId = syncChild.getAttribute('data-sync-id');
                    }
                }
            }

            if (!paraEl) return;

            const paraRect = paraEl.getBoundingClientRect();
            const newParaTopInCanvas = paraRect.top - svgRect.top;
            const targetY = newParaTopInCanvas + anchor.offsetY;
            const newTy = targetY - anchor.initialBboxY;

            const currentTransform = shapeEl.node.getAttribute('transform') || '';
            const matchX = currentTransform.match(/translate\s*\(\s*([+-]?\d*\.?\d+)/);
            const currentTx = matchX ? parseFloat(matchX[1]) : 0;
            const matchY = currentTransform.match(/translate\s*\(\s*[+-]?\d*\.?\d+\s*,\s*([+-]?\d*\.?\d+)/);
            const currentTy = matchY ? parseFloat(matchY[1]) : 0;
            
            if (Math.abs(newTy - currentTy) < 0.5) return;
            shapeEl.node.setAttribute('transform', `translate(${currentTx},${newTy})`);

            // 吹き出しの場合、ステータスアイコンも新座標に合わせて再描画
            if (shapeEl.attr('data-tool-id') === 'bubble') {
                _renderStatusIcons(shapeEl);
            }
        });
    }

    /**
     * 吹き出し図形の右上にステータスアイコン（<text>要素）を描画/更新する。
     * @param {object} shapeEl - SVG.js のシェイプオブジェクト
     */
    function _renderStatusIcons(shapeEl) {
        if (!shapeEl || !_draw) return;
        const toolId = shapeEl.attr('data-tool-id');
        if (toolId !== 'bubble') return;

        const shapeId = shapeEl.id();
        if (!shapeId) return;

        // 既存アイコングループをすべて削除（過去のバグで残ったゴミも一掃する）
        _draw.find(`[data-status-icon="true"][data-for-shape="${CSS.escape(shapeId)}"]`).forEach(el => el.remove());
        _draw.find(`#status-icons-${CSS.escape(shapeId)}`).forEach(el => el.remove());

        const readStatus   = shapeEl.attr('data-read-status')   || 'unread';
        const actionStatus = shapeEl.attr('data-action-status') || 'pending';

        const readIcon   = readStatus   === 'read' ? '✔' : '●';
        const actionIcon = actionStatus === 'done' ? '✅' : '⚠';
        const readColor   = readStatus   === 'read' ? '#888' : '#e74c3c';
        const actionColor = actionStatus === 'done' ? '#27ae60' : '#e67e22';

        function getTranslate(transformStr) {
            let tx = 0, ty = 0;
            if (!transformStr) return { tx, ty };
            const trMatch = transformStr.match(/translate\s*\(\s*([+-]?[\d.]+)(?:\s*,\s*([+-]?[\d.]+))?\s*\)/);
            if (trMatch) {
                tx = parseFloat(trMatch[1]) || 0;
                ty = parseFloat(trMatch[2]) || 0;
            } else {
                const matMatch = transformStr.match(/matrix\s*\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*\)/);
                if (matMatch) {
                    tx = parseFloat(matMatch[5]) || 0;
                    ty = parseFloat(matMatch[6]) || 0;
                }
            }
            return { tx, ty };
        }

        // bboxはtransformを考慮しないローカル座標なので、transformを加算して画面座標を得る
        const bbox = shapeEl.bbox();
        const currentTransform = shapeEl.node.getAttribute('transform') || '';
        const { tx, ty } = getTranslate(currentTransform);

        let ptx = 0, pty = 0;
        if (shapeEl.node.parentNode && shapeEl.node.parentNode.tagName.toLowerCase() === 'g') {
            const pTransform = shapeEl.node.parentNode.getAttribute('transform') || '';
            const parentT = getTranslate(pTransform);
            ptx = parentT.tx;
            pty = parentT.ty;
            // console.log('[AnnotationLayer] Parent transform:', ptx, pty, pTransform);
        }

        const iconX = bbox.x + tx + ptx + bbox.width - 2;
        const iconY = bbox.y + ty + pty - 2;
        
        // console.log(`[AnnotationLayer] _renderStatusIcons: shapeId=${shapeId}, bbox=(${bbox.x}, ${bbox.y}), tx=${tx}, ty=${ty}, ptx=${ptx}, pty=${pty}, iconX=${iconX}, iconY=${iconY}`);

        const group = _draw.group()
            .id(`status-icons-${shapeId}`)
            .attr('data-status-icon', 'true')
            .attr('data-for-shape', shapeId);

        // 未読/既読アイコン
        group.text(readIcon)
            .move(iconX - 20, iconY)
            .font({ size: 10, family: 'sans-serif', weight: 'bold' })
            .fill(readColor)
            .attr('pointer-events', 'none');

        // 未対応/対応済アイコン
        group.text(actionIcon)
            .move(iconX - 6, iconY)
            .font({ size: 10, family: 'sans-serif', weight: 'bold' })
            .fill(actionColor)
            .attr('pointer-events', 'none');

        // shapeのtransformに追従させるためgroupのtransformをリセット
        group.attr('transform', '');
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
                    const isAtEnd = match.index + match[0].length === currentText.length;
                    if (isAtEnd) {
                        window.updateEditorRange(match.index, match.index + match[0].length, newBlock);
                    } else {
                        // 既存の途中にあるコメントを削除し、常に末尾に再配置する
                        window.updateEditorRange(match.index, match.index + match[0].length, '');
                        // CodeMirrorが同期的に更新されるため、最新のdocLengthを取得して末尾に追加する
                        const newLen = (window.editorInstance && window.editorInstance.state) 
                                       ? window.editorInstance.state.doc.length 
                                       : currentText.length - match[0].length;
                        console.log(`[AnnotationLayer] Moving ANNOTATION_DATA to true end. match.index: ${match.index}, match[0].length: ${match[0].length}, newLen(true docLength): ${newLen}`);
                        window.updateEditorRange(newLen, newLen, newBlock);
                    }
                } else {
                    const docLen = (window.editorInstance && window.editorInstance.state) 
                                   ? window.editorInstance.state.doc.length 
                                   : currentText.length;
                    window.updateEditorRange(docLen, docLen, newBlock);
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
            _draw.find('[data-annotation="true"]').forEach(el => {
                window.makeInteractive(el);
            });
        }

        _initBubbleObserver();

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
        if (_svgEl) {
            _svgEl.classList.remove('annotation-layer--active');
            _svgEl.style.pointerEvents = ''; // インラインスタイルをリセットしてCSSクラスに委ねる
        }
        if (window.activeAnnotationToolbar) window.activeAnnotationToolbar.hide();
        _unbindDrawEvents();

        if (window.currentEditingSVG && window.currentEditingSVG._isAnnotationLayerMock) {
            if (typeof window.deselectAll === 'function') window.deselectAll();
            window.currentEditingSVG = null;
        }

        if (_bubbleObserver) {
            _bubbleObserver.disconnect();
            _bubbleObserver = null;
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
            if (id) {
                _anchorMap.delete(id);
                // 吹き出しの場合はアイコングループも削除
                if (_draw) {
                    const escaped = typeof CSS !== 'undefined' ? CSS.escape(id) : id;
                    const iconGroup = _draw.findOne(`#status-icons-${escaped}`);
                    if (iconGroup) iconGroup.remove();
                }
            }
            last.remove();
            _notifyChange();
            // コメントパネルも更新
            if (typeof window.AnnotationCommentPanel !== 'undefined') {
                window.AnnotationCommentPanel.refresh();
            }
        }
    }

    /** 全アノテーションを削除する */
    function clearAll() {
        if (!_draw) return;
        _draw.find('[data-annotation="true"]').forEach(el => el.remove());
        // ステータスアイコングループも削除
        _draw.find('[data-status-icon="true"]').forEach(el => el.remove());
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
        // ステータスアイコングループも剩らないよう削除
        _draw.find('[data-status-icon="true"]').forEach(el => el.remove());
        _history = [];
        _anchorMap.clear();
        _prevContent = null;
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

        // ステータスアイコングループは保存しないよう、一時的にDOMから完全に取り除く
        // （アイコンは毎回再生成するため、マークアップへの保存は不要かつゴミになるため）
        const iconGroups = Array.from(_svgEl.querySelectorAll('[data-status-icon="true"]'));
        const parents = iconGroups.map(g => g.parentNode);

        iconGroups.forEach(g => g.remove());
        
        const html = _svgEl.outerHTML;
        
        // 元に戻す（appendChildで末尾に追加して最前面を維持）
        iconGroups.forEach((g, i) => {
            if (parents[i]) {
                parents[i].appendChild(g);
            }
        });

        return html;
    }

    /**
     * SVG データを復元する（ファイル読み込み時）
     * @param {string} svgString - getSVGData() で取得した SVG 文字列
     */
    function loadSVGData(svgString) {
        if (!_draw || !svgString) return;
        if (_lastLoadedSVGString === svgString) return; // 内容が同じなら再構築（先祖返り）をスキップ

        // 既存アノテーションとアイコングループをクリア
        _draw.find('[data-annotation="true"]').forEach(el => el.remove());
        _draw.find('[data-status-icon="true"]').forEach(el => el.remove());
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
                // 過去のバグでMarkdown内に保存されてしまったアイコンのゴミを除去する
                const garbageIcons = child.querySelectorAll('[data-status-icon="true"]');
                garbageIcons.forEach(g => g.remove());

                const imported = document.importNode(child, true);
                _svgEl.appendChild(imported);
                const wrapped = SVG(imported);
                _history.push(wrapped);

                // 吹き出しのステータスアイコンを復元
                if (wrapped.attr('data-tool-id') === 'bubble') {
                    _renderStatusIcons(wrapped);
                }
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

        // 【最適化】splitによる巨大配列生成をやめ、文字列比較で差分を計算
        let firstDiffIdx = 0;
        const minLen = Math.min(_prevContent.length, newContent.length);
        while (firstDiffIdx < minLen && _prevContent[firstDiffIdx] === newContent[firstDiffIdx]) {
            firstDiffIdx++;
        }

        // 差異が発生した箇所までの改行の数をカウント
        let firstDiffLine = 0;
        let idx = _prevContent.indexOf('\n');
        while (idx !== -1 && idx < firstDiffIdx) {
            firstDiffLine++;
            idx = _prevContent.indexOf('\n', idx + 1);
        }

        const countNewlines = (str) => {
            let count = 0, i = str.indexOf('\n');
            while (i !== -1) { count++; i = str.indexOf('\n', i + 1); }
            return count;
        };

        const oldLinesCount = countNewlines(_prevContent) + 1;
        const newLinesCount = countNewlines(newContent) + 1;
        const delta = newLinesCount - oldLinesCount;
        
        if (delta === 0) {
            _prevContent = newContent;
            return; 
        }

        // 【修正】HTML文字列の行数差分（delta）をMarkdownの行番号（sourceLine）に加算する
        // 誤ったロジックを無効化。要素の特定は syncId による追跡を主軸とする。
        // （Markdown本来の行シフトは別途 CodeMirror の Transaction から取得すべきだが、
        //   syncId があれば大部分のズレは防げるため一旦無効化する）

        _prevContent = newContent;
    }

    function setColor(color) {
        _currentColor = color;
    }

    function setStrokeWidth(width) {
        _currentStrokeWidth = width;
    }

    /**
     * 吹き出し図形の一覧を返す（コメントパネル構築用）
     * @returns {Array} [{id, readStatus, actionStatus, comment, paragraphText}]
     */
    function getBubbleList() {
        if (!_draw) return [];
        const result = [];
        const processedIds = new Set();

        _draw.find('[data-annotation="true"][data-tool-id="bubble"]').forEach(shapeEl => {
            // 当たり判定用の透明クローン（ヒットエリア）は除外する
            if (shapeEl.hasClass('svg-interaction-hitarea')) return;

            // 最上位の bubble 要素（通常は SvgShape でラップされたグループ要素）を特定する
            let rootBubble = shapeEl;
            let p = shapeEl.parent();
            while (p && p.type === 'g') {
                if (p.attr('data-tool-id') === 'bubble') {
                    rootBubble = p;
                }
                p = p.parent();
            }

            const rootId = rootBubble.id();
            if (processedIds.has(rootId)) {
                return;
            }
            processedIds.add(rootId);

            const anchor = _anchorMap.get(rootId) || {};
            result.push({
                id: rootId,
                readStatus  : rootBubble.attr('data-read-status')   || 'unread',
                actionStatus: rootBubble.attr('data-action-status') || 'pending',
                comment     : anchor.comment || '',
                paragraphText: anchor.paragraphText || '',
                shapeEl: rootBubble
            });
        });
        return result;
    }

    /**
     * 吹き出しの既読ステータスを変更する
     * @param {string} shapeId
     * @param {string} status 'unread' | 'read'
     */
    function setReadStatus(shapeId, status) {
        if (!_draw) return;
        const escaped = typeof CSS !== 'undefined' ? CSS.escape(shapeId) : shapeId;
        const shapeEl = _draw.findOne(`#${escaped}`);
        if (!shapeEl) return;
        shapeEl.attr('data-read-status', status);
        _renderStatusIcons(shapeEl);
        _notifyChange();
    }

    /**
     * 吹き出しの対応ステータスを変更する
     * @param {string} shapeId
     * @param {string} status 'pending' | 'done'
     */
    function setActionStatus(shapeId, status) {
        if (!_draw) return;
        const escaped = typeof CSS !== 'undefined' ? CSS.escape(shapeId) : shapeId;
        const shapeEl = _draw.findOne(`#${escaped}`);
        if (!shapeEl) return;
        shapeEl.attr('data-action-status', status);
        _renderStatusIcons(shapeEl);
        _notifyChange();
    }

    /**
     * 吹き出しのコメントテキストを保存する
     * @param {string} shapeId
     * @param {string} text
     */
    function setComment(shapeId, text) {
        const anchor = _anchorMap.get(shapeId);
        if (!anchor) return;
        anchor.comment = text;
        _anchorMap.set(shapeId, anchor);
        _notifyChange();
    }

    return { init, enable, disable, toggle, setTool, setColor, setStrokeWidth, undo, clearAll, clearSilent, getSVGData, loadSVGData, isActive, updateAnchors, trackContentChange, getBubbleList, setReadStatus, setActionStatus, setComment };

})();
