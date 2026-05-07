/**
 * image_resize_handler.js
 * プレビュー上の <img> 要素をクリックしてリサイズ・左右移動できる機能。
 * ドラッグ完了時に Markdown ソースを <img> タグ形式で自動更新する。
 */

const ImageResizeHandler = (() => {
    // 現在選択中の状態を保持
    let _wrapper   = null;  // .img-resize-wrapper
    let _img       = null;  // 選択中の img 要素
    let _origSrc   = '';    // data-original-src 値
    let _origAlt   = '';    // alt テキスト

    // ドラッグ状態
    let _dragMode  = null;  // 'resize' | 'move' | null
    let _startX    = 0;
    let _startY    = 0;
    let _startW    = 0;     // リサイズ開始時の幅
    let _startML   = 0;     // 移動開始時の margin-left

    const MIN_WIDTH = 50;

    // =============================================
    // 公開API: render() 後にプレビュー内の img に
    //          イベントを設定する
    // =============================================
    function attachImageResizeListeners() {
        if (!DOM.preview) return;

        // 既存ラッパーをすべて解除（再レンダリング後の重複防止）
        _deselect();

        // すべての img に click リスナーを設定
        DOM.preview.querySelectorAll('img').forEach(img => {
            // SVG コンテナ内や既にラッパーに入ったものは除外
            if (img.closest('.svg-view-wrapper')) return;
            if (img.closest('.img-resize-wrapper')) return;

            // 既存のリスナーを重複設定しないために flag 管理
            if (img.dataset.resizeListenerBound) return;
            img.dataset.resizeListenerBound = 'true';

            // ブラウザのネイティブドラッグ（ファイルDnD）を抑止
            img.addEventListener('dragstart', e => e.preventDefault());

            // mousedown でダイレクトに選択＆移動ドラッグを開始
            img.addEventListener('mousedown', _onImgMousedown);
        });

        // プレビュー外クリックで選択解除
        document.addEventListener('mousedown', _onDocMousedown, true);
    }

    // =============================================
    // img の mousedown――未選択なら選択してそのままドラッグ開始、
    //             既選択済ならラッパーの _onWrapperMousedown に引き渡す
    // =============================================
    function _onImgMousedown(e) {
        // 左ボタンのみ対応
        if (e.button !== 0) return;

        const img = e.currentTarget;

        if (_img === img) {
            // 既に選択中 → ラッパーのドラッグに委ねる（そのまま何もしない = _onWrapperMousedown が捕捉する）
            return;
        }

        // 未選択→まず選択する
        e.preventDefault();
        e.stopPropagation();
        _deselect();
        _select(img);

        // 選択後即座に移動ドラッグを開始
        _startMoveFrom(e);
    }

    // =============================================
    // 選択: img をラッパーで囲みハンドルを付与
    // =============================================
    function _select(img) {
        _img     = img;
        _origSrc = img.getAttribute('data-original-src') || img.getAttribute('src') || '';
        _origAlt = img.getAttribute('alt') || '';

        // PreviewInlineEdit との干渉防止
        if (typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.isEditing) {
            PreviewInlineEdit.cancelEditing();
        }

        // 現在の width を取得（属性 or 実際のオフセット幅）
        const currentW = img.hasAttribute('width')
            ? parseInt(img.getAttribute('width'), 10)
            : img.offsetWidth;

        // 親が td / th の場合は margin-left による位置調整は不要（td側がtext-align管理）
        const parentTag = img.parentNode ? img.parentNode.tagName.toLowerCase() : '';
        const isInTableCell = parentTag === 'td' || parentTag === 'th';

        // 現在の margin-left（td内は無視）
        const currentML = isInTableCell ? 0 : _parseMarginLeft(img);

        // --- ラッパー作成 ---
        const wrapper = document.createElement('div');
        wrapper.className    = 'img-resize-wrapper';
        wrapper.style.width  = currentW + 'px';
        wrapper.style.marginLeft = currentML + 'px';
        if (isInTableCell) {
            // テーブルセル内: display:block + margin:autoでセントリング維持、widthはpx指定のまま
            wrapper.style.display = 'block';
            wrapper.style.margin  = '0 auto';
        }

        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);

        // img 自身の margin-left は wrapper が管理するためリセット
        img.style.marginLeft = '';
        img.style.width      = '100%';

        // --- 4隅のハンドル ---
        ['nw', 'ne', 'sw', 'se'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `img-resize-handle ${pos}`;
            handle.dataset.pos = pos;
            wrapper.appendChild(handle);
        });

        // --- ハンドルのドラッグ ---
        wrapper.querySelectorAll('.img-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', _onHandleMousedown);
        });

        // --- 画像本体を掴んで移動 ---
        wrapper.addEventListener('mousedown', _onWrapperMousedown);

        _wrapper = wrapper;
    }

    // =============================================
    // 選択解除: ラッパーを除去して img を元に戻す
    // =============================================
    function _deselect() {
        if (!_wrapper || !_img) return;

        // ラッパーの現在の幅・位置を img の属性に反映（選択解除前に保存）
        const w  = _wrapper.offsetWidth;
        const ml = _parseMarginLeft(_wrapper);

        // img を元の場所に戻す
        if (_wrapper.parentNode) {
            _wrapper.parentNode.insertBefore(_img, _wrapper);
            _wrapper.remove();
        }
        _img.style.width = '';
        _img.style.marginLeft = '';

        _wrapper = null;
        _img     = null;
    }

    // =============================================
    // ドキュメント mousedown（選択解除判定）
    // =============================================
    function _onDocMousedown(e) {
        if (!_wrapper) return;
        if (_wrapper.contains(e.target)) return;  // ラッパー内クリックは無視
        _deselect();
    }

    // =============================================
    // リサイズハンドル mousedown
    // =============================================
    function _onHandleMousedown(e) {
        e.preventDefault();
        e.stopPropagation();

        _dragMode = 'resize';
        _startX   = e.clientX;
        _startW   = _wrapper.offsetWidth;
        _startML  = _parseMarginLeft(_wrapper);

        const pos = e.currentTarget.dataset.pos;
        // 左辺ハンドル（nw, sw）は左方向ドラッグで拡大
        const isLeft = pos === 'nw' || pos === 'sw';

        const onMove = (ev) => {
            if (_dragMode !== 'resize') return;
            const dx = ev.clientX - _startX;
            let newW, newML;

            if (isLeft) {
                // 左ハンドル: 幅は増え、margin-left は減る
                newW  = Math.max(MIN_WIDTH, _startW - dx);
                newML = Math.max(0, _startML + dx);
            } else {
                // 右ハンドル: 幅のみ変わる
                newW  = Math.max(MIN_WIDTH, _startW + dx);
                newML = _startML;
            }

            // プレビュー最大幅クランプ
            const maxW = _getPreviewWidth();
            newW  = Math.min(newW, maxW);
            newML = Math.min(newML, maxW - newW);

            _wrapper.style.width      = newW + 'px';
            _wrapper.style.marginLeft = newML + 'px';
            // ツールチップ更新
            _wrapper.setAttribute('data-size', `${Math.round(newW)} × auto`);
            _wrapper.classList.add('resizing');
        };

        const onUp = () => {
            if (_dragMode !== 'resize') return;
            _dragMode = null;
            _wrapper.classList.remove('resizing');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            const newW  = _wrapper.offsetWidth;
            const newML = _parseMarginLeft(_wrapper);
            _updateImageInSource(newW, newML);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // =============================================
    // ラッパー mousedown（移動ドラッグ）
    // =============================================
    function _onWrapperMousedown(e) {
        // ハンドル上なら無視（ハンドルが先に処理）
        if (e.target.classList.contains('img-resize-handle')) return;
        e.preventDefault();

        _startMoveFrom(e);
    }

    // =============================================
    // 移動ドラッグ開始共通ロジック
    // =============================================
    function _startMoveFrom(e) {

        _dragMode = 'move';
        _startX   = e.clientX;
        _startY   = e.clientY;
        _startML  = _parseMarginLeft(_wrapper);

        // 実際にマウスが動いたかどうかのフラグ（単なるクリックと区別する）
        let _didMove = false;

        // 縦方向移動（行並び替え）の状態
        let _verticalMode = false;
        let _vertDropTarget = null;  // { element, isTop }

        const onMove = (ev) => {
            if (_dragMode !== 'move') return;
            const dx = ev.clientX - _startX;
            const dy = ev.clientY - _startY;
            if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) _didMove = true;

            // 縦方向を優先: 縦 30px 以上かつ縦 > 横の場合は行移動モードへ
            if (!_verticalMode && Math.abs(dy) >= 30 && Math.abs(dy) > Math.abs(dx)) {
                _verticalMode = true;
                // ラッパーを半透明にしてドラッグ中であることを示す
                if (_wrapper) _wrapper.style.opacity = '0.5';
            }

            if (_verticalMode) {
                // 縦方向ドロップインジケーター (DOM.preview を直接利用)
                const preview = DOM.preview;
                if (!preview) return;

                // ソース画像のDOM要素を記録（除外判定用）
                const sourceImg = _img;
                const sourceWrapper = _wrapper;

                // 検索対象: data-line のある要素 + img (テーブル内等data-lineなし画像のため)
                const allElements = Array.from(preview.querySelectorAll('[data-line], img'));
                let nearest = null;
                let nearestDist = Infinity;

                allElements.forEach(el => {
                    let targetEl, isImageOnly;

                    if (el.tagName === 'IMG') {
                        // img要素の場合
                        if (el === sourceImg) return;  // 自身は除外
                        // wrapperの中のimgも除外 (sourceWrapperの子)
                        if (sourceWrapper && sourceWrapper.contains(el)) return;
                        targetEl = el;
                        isImageOnly = true;  // imgは常に「画像のみ」の要素
                    } else {
                        // data-line 要素の場合
                        targetEl = el;
                        // ソース画像を含む要素は除外
                        if (sourceImg && targetEl.contains(sourceImg)) return;
                        if (sourceWrapper && targetEl.contains(sourceWrapper)) return;
                        // 画像のみかどうか判定 (ドラッグハンドル⠿を除いた文字列がない)
                        const hasImg = targetEl.querySelector('img') !== null;
                        const textContent = (targetEl.textContent || '').replace(/[⠿\u28ff]/g, '').trim();
                        isImageOnly = hasImg && textContent === '';
                    }

                    if (!targetEl) return;
                    const r = targetEl.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    const centerY = (r.top + r.bottom) / 2;
                    const dist = Math.abs(ev.clientY - centerY);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        const relY = ev.clientY - r.top;
                        const isMerge = isImageOnly && (relY >= r.height * 0.25) && (relY <= r.height * 0.75);
                        nearest = { element: targetEl, isTop: ev.clientY < centerY, isMerge, isImageOnly };
                    }
                });

                _vertDropTarget = nearest;

                // インジケーター表示
                let indicator = document.getElementById('img-vdrop-indicator');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'img-vdrop-indicator';
                    preview.style.position = 'relative';
                    preview.appendChild(indicator);
                }
                indicator.style.pointerEvents = 'none';
                indicator.style.zIndex = '9999';
                indicator.style.position = 'absolute';
                indicator.style.left = '40px';
                indicator.style.width = 'calc(100% - 80px)';

                if (nearest) {
                    const rect = nearest.element.getBoundingClientRect();
                    const previewRect = preview.getBoundingClientRect();

                    if (nearest.isMerge) {
                        // マージ: 青枠ハイライト
                        indicator.style.top    = (rect.top - previewRect.top + preview.scrollTop - 2) + 'px';
                        indicator.style.height = (rect.height + 4) + 'px';
                        indicator.style.border = '2px dashed #2196F3';
                        indicator.style.background = 'rgba(33,150,243,0.1)';
                        indicator.style.borderRadius = '4px';
                    } else {
                        // 通常移動: 線インジケーター
                        const topPos = nearest.isTop
                            ? (rect.top - previewRect.top + preview.scrollTop)
                            : (rect.bottom - previewRect.top + preview.scrollTop);
                        indicator.style.top    = topPos + 'px';
                        indicator.style.height = '2px';
                        indicator.style.border = 'none';
                        indicator.style.background = 'var(--accent-color,#2196F3)';
                        indicator.style.borderRadius = '2px';
                    }
                    indicator.style.display = 'block';
                } else {
                    indicator.style.display = 'none';
                }
            } else {
                // 横方向の移動
                const maxW = _getPreviewWidth();
                const imgW = _wrapper.offsetWidth;
                const newML = Math.max(0, Math.min(_startML + dx, maxW - imgW));
                _wrapper.style.marginLeft = newML + 'px';
            }
        };

        const onUp = () => {
            if (_dragMode !== 'move') return;
            _dragMode = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            // インジケーターの削除
            const indicator = document.getElementById('img-vdrop-indicator');
            if (indicator) indicator.remove();
            if (_wrapper) _wrapper.style.opacity = '';

            // 動かなかった場合は何もしない
            if (!_didMove) {
                console.log('[ImageMove] mouseup: no movement detected, keeping selection');
                return;
            }

            console.log('[ImageMove] mouseup: didMove=true, verticalMode=', _verticalMode);

            if (_verticalMode) {
                // 行並び替えモード: img を含む行番号を取得
                const imgBlock = _img && _img.closest('[data-line]');
                console.log('[ImageMove] _img=', _img, '_img data-line attr=', _img && _img.getAttribute('data-line'));
                console.log('[ImageMove] imgBlock=', imgBlock, 'data-line=', imgBlock && imgBlock.getAttribute('data-line'));
                console.log('[ImageMove] _vertDropTarget=', _vertDropTarget);

                if (!_vertDropTarget) {
                    console.warn('[ImageMove] ABORT: _vertDropTarget is null');
                    _deselect();
                    return;
                }

                // data-line が取れない場合（rawHTML画像）はソーステキストから行番号を検索
                let startLine, endLine;
                if (imgBlock) {
                    startLine = parseInt(imgBlock.getAttribute('data-line'), 10);
                    endLine   = parseInt(imgBlock.getAttribute('data-line-end') || startLine, 10);
                } else if (_origSrc) {
                    const srcLines = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
                    const decodedSrc = (() => { try { return decodeURIComponent(_origSrc); } catch { return _origSrc; } })();
                    for (let i = 0; i < srcLines.length; i++) {
                        if (srcLines[i].includes(_origSrc) || srcLines[i].includes(decodedSrc)) {
                            startLine = i + 1;
                            endLine   = i + 1;
                            console.log('[ImageMove] Found image at line (via src search):', startLine, '->', srcLines[i].substring(0, 60));
                            break;
                        }
                    }
                }

                if (isNaN(startLine)) {
                    console.warn('[ImageMove] ABORT: could not determine startLine');
                    _deselect();
                    return;
                }

                const target = _vertDropTarget;

                // ターゲットの行番号を取得（data-line 属性 or srcで検索）
                let targetStartLine = target.element.getAttribute('data-line')
                    ? parseInt(target.element.getAttribute('data-line'), 10)
                    : NaN;
                let targetEndLine = target.element.getAttribute('data-line-end')
                    ? parseInt(target.element.getAttribute('data-line-end'), 10)
                    : targetStartLine;

                // ターゲットもrawHTML画像の場合は src で行番号検索
                if (isNaN(targetStartLine)) {
                    const targetImg = target.element.tagName === 'IMG'
                        ? target.element
                        : target.element.querySelector('img');
                    const targetSrc = targetImg
                        ? (targetImg.getAttribute('data-original-src') || targetImg.getAttribute('src') || '')
                        : '';
                    if (targetSrc) {
                        const decodedTgt = (() => { try { return decodeURIComponent(targetSrc); } catch { return targetSrc; } })();
                        const tgtLines = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
                        for (let i = 0; i < tgtLines.length; i++) {
                            if (tgtLines[i].includes(targetSrc) || tgtLines[i].includes(decodedTgt)) {
                                targetStartLine = i + 1;
                                targetEndLine   = i + 1;
                                console.log('[ImageMove] Found target image at line:', targetStartLine);
                                break;
                            }
                        }
                    }
                }

                console.log('[ImageMove] startLine=', startLine, 'endLine=', endLine,
                    'targetStartLine=', targetStartLine, 'targetEndLine=', targetEndLine,
                    'isMerge=', target.isMerge, 'isTop=', target.isTop);

                if (isNaN(targetStartLine) || startLine === targetStartLine) {
                    console.warn('[ImageMove] ABORT: invalid targetStartLine or same line');
                    _deselect();
                    return;
                }

                if (target.isMerge &&
                    typeof PreviewInlineEdit !== 'undefined' &&
                    typeof PreviewInlineEdit.processMergeImages === 'function') {
                    console.log('[ImageMove] calling processMergeImages...');
                    _deselect();
                    PreviewInlineEdit.processMergeImages(startLine, endLine, targetStartLine, targetEndLine);
                } else if (typeof PreviewInlineEdit !== 'undefined' &&
                    typeof PreviewInlineEdit.processDragAndDrop === 'function') {
                    console.log('[ImageMove] calling processDragAndDrop...');
                    _deselect();
                    PreviewInlineEdit.processDragAndDrop(startLine, endLine, targetStartLine, targetEndLine, target.isTop);
                } else {
                    console.warn('[ImageMove] no handler available');
                }
            } else {
                const newW  = _wrapper.offsetWidth;
                const newML = _parseMarginLeft(_wrapper);
                _updateImageInSource(newW, newML);
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // =============================================
    // Markdown ソースを更新する
    // =============================================
    async function _updateImageInSource(newWidth, newMarginLeft) {
        if (!_origSrc) return;

        const fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // <img> タグの組み立て
        const styleAttr   = newMarginLeft > 0 ? ` style="margin-left:${Math.round(newMarginLeft)}px"` : '';
        const newImgTag   = `<img src="${_origSrc}" width="${Math.round(newWidth)}"${styleAttr} alt="${_origAlt}">`;

        const decodedSrc  = (() => { try { return decodeURIComponent(_origSrc); } catch { return _origSrc; } })();

        // 汎用的な画像タグマッチ用正規表現（Base64等の超長文字列による RegExp エラー回避のため）
        const mdPattern   = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const htmlPattern = /<img(?:[^>]*?)\ssrc=["']([^"']+)["'][^>]*>/gi;

        let matched = false;
        let changes = [];

        // HTML 形式
        let match;
        while ((match = htmlPattern.exec(fullText)) !== null) {
            const src = match[1];
            if (src === _origSrc || src === decodedSrc) {
                const srcStartOffset = match[0].indexOf(src);
                const srcEndOffset = srcStartOffset + src.length;
                
                const newSrcStart = newImgTag.indexOf(_origSrc);
                const newSrcEnd = newSrcStart + _origSrc.length;
                
                changes.push({
                    from: match.index,
                    to: match.index + srcStartOffset,
                    insert: newImgTag.substring(0, newSrcStart)
                });
                changes.push({
                    from: match.index + srcEndOffset,
                    to: match.index + match[0].length,
                    insert: newImgTag.substring(newSrcEnd)
                });
                
                matched = true;
            }
        }

        // Markdown 形式
        if (!matched) {
            const targets = [
                `](${_origSrc})`,
                `](${decodedSrc})`,
                `](<${_origSrc}>)`,
                `](<${decodedSrc}>)`
            ];

            for (const target of targets) {
                let idx = fullText.indexOf(target);
                if (idx !== -1) {
                    let startIdx = fullText.lastIndexOf('![', idx);
                    if (startIdx !== -1) {
                        let between = fullText.substring(startIdx, idx);
                        if (!between.includes('\n')) {
                            let altText = fullText.substring(startIdx + 2, idx);
                            _origAlt = altText || _origAlt;
                            const mkdImgTag = `<img src="${_origSrc}" width="${Math.round(newWidth)}"${styleAttr} alt="${_origAlt}">`;
                            
                            let origSrcStart = fullText.indexOf(_origSrc, startIdx);
                            let origSrcEnd = origSrcStart + _origSrc.length;
                            
                            const newSrcStart = mkdImgTag.indexOf(_origSrc);
                            const newSrcEnd = newSrcStart + _origSrc.length;
                            
                            changes.push({
                                from: startIdx,
                                to: origSrcStart,
                                insert: mkdImgTag.substring(0, newSrcStart)
                            });
                            changes.push({
                                from: origSrcEnd,
                                to: idx + target.length,
                                insert: mkdImgTag.substring(newSrcEnd)
                            });
                            
                            matched = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!matched) {
            console.warn('[ImageResize] Could not find source line for src:', _origSrc);
            if (typeof showToast === 'function') showToast('ソース行が見つかりませんでした', 'warning');
            return;
        }

        // エディタに反映
        if (typeof window.editorView !== 'undefined') {
            window.editorView.dispatch({ changes: changes });
            AppState.text = window.editorView.state.doc.toString();
        } else if (typeof setEditorText === 'function') {
            let updated = fullText;
            for (let i = changes.length - 1; i >= 0; i--) {
                updated = updated.substring(0, changes[i].from) + changes[i].insert + updated.substring(changes[i].to);
            }
            setEditorText(updated);
            AppState.text = updated;
        } else {
            let updated = fullText;
            for (let i = changes.length - 1; i >= 0; i--) {
                updated = updated.substring(0, changes[i].from) + changes[i].insert + updated.substring(changes[i].to);
            }
            AppState.text = updated;
        }

        AppState.isModified   = true;
        AppState.hasUnsavedChanges = true;

        // 再描画（描画後に同じ画像を再選択）
        const srcToReselect = _origSrc;
        const altToReselect = _origAlt;

        if (typeof render === 'function') {
            await render();
        }

        // render 後にDOMが再構築されるので、同じ src の img を再選択する
        await new Promise(r => setTimeout(r, 80));
        if (DOM.preview) {
            const reselect = Array.from(DOM.preview.querySelectorAll('img')).find(el => {
                const s = el.getAttribute('data-original-src') || el.getAttribute('src') || '';
                return s === srcToReselect;
            });
            if (reselect) {
                _img     = null;
                _wrapper = null;
                _select(reselect);
            }
        }
    }

    // =============================================
    // ユーティリティ
    // =============================================
    function _parseMarginLeft(el) {
        const ml = parseFloat(el.style.marginLeft) || 0;
        return isNaN(ml) ? 0 : ml;
    }

    function _getPreviewWidth() {
        if (AppState && AppState.config && AppState.config.previewWidth) {
            return AppState.config.previewWidth;
        }
        return DOM.preview ? DOM.preview.clientWidth : 820;
    }

    function _escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // =============================================
    // 公開
    // =============================================
    return { attachImageResizeListeners };
})();

// グローバルに公開
function attachImageResizeListeners() {
    ImageResizeHandler.attachImageResizeListeners();
}
