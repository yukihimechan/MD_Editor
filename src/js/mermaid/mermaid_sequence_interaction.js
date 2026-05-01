/**
 * MermaidSequenceInteraction - シーケンス図におけるインタラクション（将来的な拡張用）
 */

window.MermaidSequenceInteraction = {
    
    /**
     * レンダリングされたシーケンス図のSVGコンテナに対してインタラクションを初期化する
     */
    initDiagram(diagramContainer, originalCode) {
        if (!diagramContainer) return;
        
        const svg = diagramContainer.querySelector('svg');
        if (!svg) return;

        // 再描画のたびにキャッシュを無効化する
        this._lifelineCache = null;

        // 編集モード時のみ有効なスタイルを注入
        if (!document.getElementById('mermaid-sequence-styles')) {
            const style = document.createElement('style');
            style.id = 'mermaid-sequence-styles';
            style.textContent = `
                .mermaid-sequence-edit-mode .seq-clickable {
                    cursor: pointer !important;
                }
            `;
            document.head.appendChild(style);
        }

        // クリック可能な要素にクラスを設定する（実際のカーソル変更はCSSに委譲）
        this._setPointerCursors(svg);

        // 編集モード時にヒットボックスを追加するMutationObserverを設定
        if (!diagramContainer._seqHitboxObserver) {
            const observer = new MutationObserver(() => {
                if (diagramContainer.classList.contains('mermaid-sequence-edit-mode')) {
                    // DOM更新直後を待ってからヒットボックスを追加
                    setTimeout(() => this._enhanceMessageHitboxes(diagramContainer), 150);
                }
            });
            observer.observe(diagramContainer, { attributes: true, attributeFilter: ['class'], subtree: false });
            diagramContainer._seqHitboxObserver = observer;
        }

        // すでに編集モードであればすぐに追加
        if (diagramContainer.classList.contains('mermaid-sequence-edit-mode')) {
            setTimeout(() => this._enhanceMessageHitboxes(diagramContainer), 150);
        }

        // イベントのバインド
        this._attachEvents(diagramContainer, svg);
    },

    /**
     * クリック可能な要素に対してクラスを設定
     */
    _setPointerCursors(svg) {
        const clickables = svg.querySelectorAll('rect, text, path, line');
        clickables.forEach(el => {
            const cls = (el.getAttribute('class') || '').toLowerCase();
            const pCls = (el.parentElement && el.parentElement.getAttribute('class') || '').toLowerCase();
            
            if (cls.includes('actor') || cls.includes('participant') || cls.includes('message') || cls.includes('activation') ||
                pCls.includes('actor') || pCls.includes('participant') || pCls.includes('message') || pCls.includes('activation')) {
                el.classList.add('seq-clickable');
            }
        });
    },

    _currentSelections: [],
    _clipboard: [],
    _arrowDragState: null,      // 矢印ドラッグの状態管理
    _activateDragState: null,   // activateドラッグの状態管理
    _hoverActorIndex: -1,       // ホバー中のactorインデックス
    _lifelineCache: null,       // ライフライン情報のキャッシュ

    /**
     * イベントリスナーのアタッチ
     */
    _attachEvents(container, svg) {
        svg.addEventListener('dblclick', (e) => {
            const wrapper = container.closest('.code-block-wrapper');
            if (!wrapper) return;
            
            if (!container.classList.contains('mermaid-sequence-edit-mode')) {
                if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.startMermaidEdit === 'function') {
                    PreviewInlineEdit.startMermaidEdit(wrapper);
                }
            } else {
                // 編集モード中のダブルクリック：インラインエディタを表示
                e.preventDefault();
                e.stopPropagation();
                
                const target = e.target;
                let isActorOrParticipant = false;
                let isMessage = false;

                const classes = (target.getAttribute('class') || '').toLowerCase();
                const parentClasses = (target.parentElement && target.parentElement.getAttribute('class') || '').toLowerCase();
                
                // ヒットボックスがダブルクリックされた場合はメッセージとして扱う
                if (classes.includes('seq-msg-hitbox')) {
                    isMessage = true;
                } else if (classes.includes('actor') || classes.includes('participant') || parentClasses.includes('actor') || parentClasses.includes('participant')) {
                    isActorOrParticipant = true;
                } else if (classes.includes('message') || parentClasses.includes('message')) {
                    isMessage = true;
                } else if (target.tagName.toLowerCase() === 'path' || target.tagName.toLowerCase() === 'line') {
                    if (!classes.includes('actor-line')) {
                        isMessage = true;
                    }
                }

                if (target.tagName.toLowerCase() === 'text' || target.tagName.toLowerCase() === 'tspan') {
                    if (!isMessage && !isActorOrParticipant && !classes.includes('activation') && !parentClasses.includes('activation')) {
                        isActorOrParticipant = true;
                    }
                }

                if (isActorOrParticipant || isMessage) {
                    this._editLabelInline(container, svg, target, isActorOrParticipant ? 'actor' : 'message');
                }
            }
        });

        svg.addEventListener('click', (e) => {
            if (!container.classList.contains('mermaid-sequence-edit-mode')) {
                return;
            }

            if (e.target.tagName.toLowerCase() === 'svg') {
                this._clearSelection(container);
                return;
            }

            const target = e.target;
            let textContent = null;
            let isActorOrParticipant = false;
            let isMessage = false;
            let isActivation = false;

            const classes = (target.getAttribute('class') || '').toLowerCase();
            const parentClasses = (target.parentElement && target.parentElement.getAttribute('class') || '').toLowerCase();
            
            // ヒットボックス（透明な当たり判定エリア）がクリックされた場合はメッセージとして扱う
            if (classes.includes('seq-msg-hitbox')) {
                isMessage = true;
            } else if (classes.includes('actor') || classes.includes('participant') || parentClasses.includes('actor') || parentClasses.includes('participant')) {
                isActorOrParticipant = true;
            } else if (classes.includes('message') || parentClasses.includes('message')) {
                isMessage = true;
            } else if (classes.includes('activation') || parentClasses.includes('activation')) {
                isActivation = true;
            } else if (target.tagName.toLowerCase() === 'path' || target.tagName.toLowerCase() === 'line') {
                if (!classes.includes('actor-line')) {
                    isMessage = true;
                }
            }

            if (target.tagName.toLowerCase() === 'text' || target.tagName.toLowerCase() === 'tspan') {
                textContent = target.textContent;
                if (!isMessage && !isActorOrParticipant && !isActivation) {
                    isActorOrParticipant = true;
                }
            } else if (target.tagName.toLowerCase() === 'rect') {
                const textNode = target.parentElement ? target.parentElement.querySelector('text') : null;
                if (textNode) {
                    textContent = textNode.textContent;
                }
            }

            if (isActorOrParticipant) {
                this._selectActorOrParticipant(container, svg, textContent, target, e);
            } else if (isActivation) {
                this._selectActivation(container, svg, target, e);
            } else if (isMessage) {
                this._selectMessage(container, svg, target, textContent, e);
            } else {
                if (!e.shiftKey) this._clearSelection(container);
            }
        });

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            if (!container.classList.contains('mermaid-sequence-edit-mode')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this._deleteSelection(container);
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault();
                this._copySelection(container);
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                this._pasteSelection(container);
            }
        });

        // ドラッグ状態の管理
        let isDraggingActor = false;
        let dragStartActorIndex = -1;
        let currentDropTargetIndex = -1;
        let dragIndicator = null;
        let actorCentersInfo = [];

        svg.addEventListener('mousedown', (e) => {
            if (!container.classList.contains('mermaid-sequence-edit-mode')) return;

            // ホバーアイコン（↔矢印）のドラッグ開始チェック
            const arrowHoverIcon = e.target.closest('.mermaid-seq-hover-icon[data-icon-type="arrow"]');
            if (arrowHoverIcon) {
                e.preventDefault();
                e.stopPropagation();
                const cache = this._buildLifelineCache(svg, container);
                const insertBeforeIdx = parseInt(arrowHoverIcon.getAttribute('data-insert-before-idx') || '-1', 10);
                const gapIdx = parseInt(arrowHoverIcon.getAttribute('data-gap-idx') || '0', 10);

                const pt0 = svg.createSVGPoint();
                pt0.x = e.clientX; pt0.y = e.clientY;
                const svgP0 = pt0.matrixTransform(svg.getScreenCTM().inverse());
                const fromActor = cache.actors[this._hoverActorIndex];
                const fromCX = fromActor ? fromActor.cx : svgP0.x;

                this._arrowDragState = {
                    active: true,
                    fromActorIndex: this._hoverActorIndex,
                    fromCenterX: fromCX,
                    fromY: svgP0.y,
                    actorCenters: cache.actors,
                    snapTargetIndex: -1,
                    insertBeforeIdx,
                    gapIdx,
                    uturnMode: false
                };
                this._hideLifelineHoverIcons(svg);
                return;
            }

            // ホバーアイコン（↕ activate）のドラッグ開始チェック
            const activateHoverIcon = e.target.closest('.mermaid-seq-hover-icon[data-icon-type="activate"]');
            if (activateHoverIcon) {
                e.preventDefault();
                e.stopPropagation();
                const cache = this._buildLifelineCache(svg, container);
                const msgIdx = parseInt(activateHoverIcon.getAttribute('data-gap-idx') || '0', 10);
                const fromActor = cache.actors[this._hoverActorIndex];

                const pt0 = svg.createSVGPoint();
                pt0.x = e.clientX; pt0.y = e.clientY;
                const svgP0 = pt0.matrixTransform(svg.getScreenCTM().inverse());

                this._activateDragState = {
                    active: true,
                    actorIndex: this._hoverActorIndex,
                    fromMsgIdx: msgIdx,
                    fromY: cache.messages[msgIdx] ? cache.messages[msgIdx].y : svgP0.y,
                    actorCenterX: fromActor ? fromActor.cx : svgP0.x,
                    snapMsgIdx: msgIdx,
                    messages: cache.messages
                };
                this._hideLifelineHoverIcons(svg);
                return;
            }

            // 既存のactorドラッグハンドル処理
            const handle = e.target.closest('.mermaid-sequence-drag-handle');
            if (!handle || this._currentSelections.length === 0 || this._currentSelections[0].type !== 'actor') return;

            e.preventDefault();
            e.stopPropagation();

            isDraggingActor = true;
            // 複数選択時はドラッグ移動の対象を最初の1つとする
            dragStartActorIndex = this._currentSelections[0].index;
            handle.style.cursor = 'grabbing';
            
            const textNodesAll = Array.from(svg.querySelectorAll('text'));
            actorCentersInfo = [];
            textNodesAll.forEach(node => {
                const cls = (node.getAttribute('class') || '').toLowerCase();
                const parentCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
                if (cls.includes('actor') || cls.includes('participant') || parentCls.includes('actor') || parentCls.includes('participant')) {
                    let tNode = node;
                    if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                    const b = this._getSVGBBox(svg, tNode);
                    const cx = b.x + b.width / 2;
                    if (!actorCentersInfo.some(existing => Math.abs(existing.cx - cx) < 20)) {
                        actorCentersInfo.push({ cx, text: node.textContent.trim() });
                    }
                }
            });
            actorCentersInfo.sort((a, b) => a.cx - b.cx);

            dragIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            dragIndicator.setAttribute('class', 'mermaid-sequence-selection-line');
            dragIndicator.setAttribute('stroke', '#0d6efd');
            dragIndicator.setAttribute('stroke-width', '4');
            dragIndicator.setAttribute('stroke-dasharray', '5,5');
            dragIndicator.setAttribute('y1', '0');
            dragIndicator.setAttribute('y2', svg.getBoundingClientRect().height);
            dragIndicator.style.display = 'none';
            svg.appendChild(dragIndicator);
        });

        document.addEventListener('mousemove', (e) => {
            // 矢印ドラッグ中のプレビュー更新
            if (this._arrowDragState && this._arrowDragState.active) {
                e.preventDefault();
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

                const fromX = this._arrowDragState.fromCenterX;
                const fromY = this._arrowDragState.fromY;
                let toX = svgP.x;
                let snapIdx = -1;

                // スナップ判定：自分以外の最も近いライフラインに吸着（40px以内）
                const snapDist = 40;
                let minDist = snapDist;
                this._arrowDragState.actorCenters.forEach((ac, idx) => {
                    if (idx === this._arrowDragState.fromActorIndex) return;
                    const dist = Math.abs(ac.cx - svgP.x);
                    if (dist < minDist) { minDist = dist; snapIdx = idx; toX = ac.cx; }
                });
                this._arrowDragState.snapTargetIndex = snapIdx;

                // Uターン判定：45度以上下向きの場合
                const dx = svgP.x - fromX;
                const dy = svgP.y - fromY;
                const isUturn = dy > Math.abs(dx) && dy > 10;
                this._arrowDragState.uturnMode = isUturn;

                if (isUturn) {
                    this._drawUTurnPreview(svg, fromX, fromY);
                } else {
                    this._updateArrowPreview(svg, fromX, fromY, toX, fromY, snapIdx !== -1);
                }
                return;
            }

            // activate ドラッグ中のプレビュー更新
            if (this._activateDragState && this._activateDragState.active) {
                e.preventDefault();
                const pt = svg.createSVGPoint();
                pt.x = e.clientX; pt.y = e.clientY;
                const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

                const msgs = this._activateDragState.messages;
                let snapMsgIdx = this._activateDragState.fromMsgIdx;
                let minDist2 = 20;
                msgs.forEach((m, idx) => {
                    const d = Math.abs(m.y - svgP.y);
                    if (d < minDist2) { minDist2 = d; snapMsgIdx = idx; }
                });
                this._activateDragState.snapMsgIdx = snapMsgIdx;
                this._drawActivatePreview(svg, this._activateDragState);
                return;
            }

            if (!isDraggingActor) return;
            e.preventDefault();
            
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
            
            const mouseX = svgP.x;

            let targetIndex = 0;
            for (let i = 0; i < actorCentersInfo.length; i++) {
                if (mouseX > actorCentersInfo[i].cx) {
                    targetIndex = i + 1;
                } else {
                    break;
                }
            }
            
            currentDropTargetIndex = targetIndex;
            
            let lineX = 0;
            if (targetIndex === 0) {
                lineX = actorCentersInfo[0].cx - 50;
            } else if (targetIndex >= actorCentersInfo.length) {
                lineX = actorCentersInfo[actorCentersInfo.length - 1].cx + 50;
            } else {
                lineX = (actorCentersInfo[targetIndex - 1].cx + actorCentersInfo[targetIndex].cx) / 2;
            }

            if (dragIndicator) {
                dragIndicator.setAttribute('x1', lineX);
                dragIndicator.setAttribute('x2', lineX);
                dragIndicator.style.display = 'block';
            }
        });

        document.addEventListener('mouseup', (e) => {
            // 矢印ドラッグの確定処理
            if (this._arrowDragState && this._arrowDragState.active) {
                const state = this._arrowDragState;
                this._arrowDragState = null;
                this._removeArrowPreview(svg);
                if (state.uturnMode) {
                    // 自己メッセージ
                    this._addMessageLine(container, state.fromActorIndex, state.fromActorIndex, state.actorCenters, state.insertBeforeIdx);
                } else if (state.snapTargetIndex !== -1) {
                    this._addMessageLine(container, state.fromActorIndex, state.snapTargetIndex, state.actorCenters, state.insertBeforeIdx);
                }
                return;
            }

            // activate ドラッグの確定処理
            if (this._activateDragState && this._activateDragState.active) {
                const state = this._activateDragState;
                this._activateDragState = null;
                this._removeActivatePreview(svg);
                const startIdx = Math.min(state.fromMsgIdx, state.snapMsgIdx);
                const endIdx   = Math.max(state.fromMsgIdx, state.snapMsgIdx);
                if (startIdx !== endIdx) {
                    this._addActivation(container, state.actorIndex, startIdx, endIdx, state.messages);
                }
                return;
            }

            if (!isDraggingActor) return;
            isDraggingActor = false;
            if (dragIndicator) {
                dragIndicator.remove();
                dragIndicator = null;
            }

            if (currentDropTargetIndex !== -1) {
                let insertIndex = currentDropTargetIndex;
                if (insertIndex > dragStartActorIndex) {
                    insertIndex -= 1;
                }

                if (dragStartActorIndex !== insertIndex) {
                    this._moveActorSequence(container, dragStartActorIndex, insertIndex, actorCentersInfo);
                }
            }
            
            currentDropTargetIndex = -1;
            dragStartActorIndex = -1;
        });

        // =========================================================
        // SVGホバー検出：ライフライン付近でアイコンを表示
        // =========================================================
        svg.addEventListener('mousemove', (e) => {
            if (!container.classList.contains('mermaid-sequence-edit-mode')) return;
            if (this._arrowDragState && this._arrowDragState.active) return;
            if (this._activateDragState && this._activateDragState.active) return;
            if (isDraggingActor) return;

            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

            // キャッシュを使ってライフライン情報を取得
            const cache = this._buildLifelineCache(svg, container);

            // ±15px 以内の最も近いライフラインを探す
            let nearestIdx = -1;
            let minD = 15;
            cache.actors.forEach((actor, idx) => {
                const d = Math.abs(actor.cx - svgP.x);
                if (d < minD) { minD = d; nearestIdx = idx; }
            });

            if (nearestIdx !== -1) {
                this._showLifelineHoverIcons(svg, nearestIdx, svgP.y, cache);
                this._hoverActorIndex = nearestIdx;
            } else {
                this._hideLifelineHoverIcons(svg);
                this._hoverActorIndex = -1;
            }
        });

        svg.addEventListener('mouseleave', () => {
            this._hideLifelineHoverIcons(svg);
            this._hoverActorIndex = -1;
        });

        // APIのセットアップ
        if (!container._mermaidSequenceAPI) {
            container._mermaidSequenceAPI = {
                deleteSelection: () => this._deleteSelection(container),
                copySelection: () => this._copySelection(container),
                pasteSelection: () => this._pasteSelection(container)
            };
        }

        // コンテキストメニュー (右クリック)
        svg.addEventListener('contextmenu', (e) => {
            if (!container.classList.contains('mermaid-sequence-edit-mode')) return;
            e.preventDefault();
            e.stopPropagation();

            const wrapper = container.closest('.code-block-wrapper');
            if (!wrapper) return;

            const target = e.target;
            const classes = (target.getAttribute('class') || '').toLowerCase();
            const parentClasses = (target.parentElement && target.parentElement.getAttribute('class') || '').toLowerCase();
            
            let isActor = classes.includes('actor') || classes.includes('participant') || parentClasses.includes('actor') || parentClasses.includes('participant');
            // ヒットボックスは常にメッセージとして扱う
            let isMsg = classes.includes('seq-msg-hitbox') || classes.includes('message') || parentClasses.includes('message');
            let isAct = classes.includes('activation') || parentClasses.includes('activation');
            
            if (target.tagName.toLowerCase() === 'path' || target.tagName.toLowerCase() === 'line') {
                if (!classes.includes('actor-line') && !classes.includes('seq-msg-hitbox')) isMsg = true;
            }
            if (target.tagName.toLowerCase() === 'text' || target.tagName.toLowerCase() === 'tspan') {
                if (!isMsg && !isActor && !isAct) isActor = true;
            }

            if (isActor) {
                this._selectActorOrParticipant(container, svg, target.textContent, target, e);
            } else if (isAct) {
                this._selectActivation(container, svg, target, e);
            } else if (isMsg) {
                this._selectMessage(container, svg, target, target.textContent, e);
            } else {
                this._clearSelection(container);
            }

            this._showContextMenu(e.clientX, e.clientY, wrapper, container);
        });
    },


    _getSVGBBox(svg, node) {
        const bbox = node.getBoundingClientRect();
        const svgPt = svg.createSVGPoint();
        const screenCTM = svg.getScreenCTM();

        if (!screenCTM) {
            return node.getBBox ? node.getBBox() : { x: 0, y: 0, width: 0, height: 0 };
        }

        const inverseCTM = screenCTM.inverse();
        
        const corners = [
            { x: bbox.left, y: bbox.top },
            { x: bbox.right, y: bbox.top },
            { x: bbox.left, y: bbox.bottom },
            { x: bbox.right, y: bbox.bottom }
        ];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        corners.forEach(c => {
            svgPt.x = c.x;
            svgPt.y = c.y;
            const localPt = svgPt.matrixTransform(inverseCTM);
            if (localPt.x < minX) minX = localPt.x;
            if (localPt.y < minY) minY = localPt.y;
            if (localPt.x > maxX) maxX = localPt.x;
            if (localPt.y > maxY) maxY = localPt.y;
        });

        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    },

    _handleSelection(svg, sel, e) {
        if (!this._currentSelections) this._currentSelections = [];
        
        if (e && e.shiftKey) {
            // トグル処理
            const idx = this._currentSelections.findIndex(s => s.type === sel.type && s.index === sel.index);
            if (idx !== -1) {
                this._currentSelections.splice(idx, 1);
            } else {
                this._currentSelections.push(sel);
            }
        } else {
            this._currentSelections = [sel];
        }
        this._redrawSelections(svg);
    },

    _redrawSelections(svg) {
        document.querySelectorAll('.mermaid-sequence-selection-rect').forEach(el => el.remove());
        const existingLines = svg.querySelectorAll('.mermaid-sequence-selection-line');
        existingLines.forEach(line => line.remove());
        document.querySelectorAll('.mermaid-sequence-drag-handle').forEach(el => el.remove());
        // ホバーアイコンもクリア（再描画後に再表示される）
        svg.querySelectorAll('.mermaid-seq-hover-icon').forEach(el => el.remove());

        if (this._currentSelections) {
            this._currentSelections.forEach(sel => {
                if (sel.drawParams) {
                    this._drawSelectionBox(svg, ...sel.drawParams);
                }
            });
        }
    },

    _drawSelectionBox(svg, x, y, width, height) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'mermaid-sequence-selection-rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        svg.appendChild(rect);
    },

    /**
     * ダブルクリック時にインラインエディタを表示してラベルを書き換える
     */
    _editLabelInline(container, svg, target, type) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let targetNode = target;
        if (target.tagName.toLowerCase() === 'tspan' && target.parentElement) {
            targetNode = target.parentElement;
        }

        // テキスト情報を取得
        let currentText = "";
        const tagName = targetNode.tagName.toLowerCase();
        
        if (tagName === 'text') {
            currentText = targetNode.textContent.trim();
        } else {
            let textNode = null;
            if (tagName === 'g') {
                textNode = targetNode.querySelector('text');
            } else if (tagName === 'rect' || tagName === 'polygon' || tagName === 'circle') {
                // Actor等の図形の場合は親からテキスト取得を試みる
                textNode = targetNode.parentElement ? targetNode.parentElement.querySelector('text') : null;
            }
            // path(矢印)やline等の場合は安易に親から取得せず、後続の座標ベースの検索に任せる

            if (textNode) {
                currentText = textNode.textContent.trim();
                targetNode = textNode; // 入力欄の位置合わせ用にtext要素を対象とする
            }
        }

        // Actorの場合は、名前が取得できなかったら一番近いテキストを探す
        let actorIndex = -1;
        if (type === 'actor') {
            const clickedBBox = this._getSVGBBox(svg, target);
            const clickedCenterX = clickedBBox.x + clickedBBox.width / 2;
            const textNodes = Array.from(svg.querySelectorAll('text'));
            
            if (!currentText) {
                let minDiffX = Infinity;
                let closestTextNode = null;
                textNodes.forEach(node => {
                    const txt = node.textContent.trim();
                    if (!txt) return;
                    let tNode = node;
                    if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                    const bbox = this._getSVGBBox(svg, tNode);
                    const centerX = bbox.x + bbox.width / 2;
                    const diffX = Math.abs(centerX - clickedCenterX);
                    if (diffX < minDiffX && diffX < 50) {
                        minDiffX = diffX;
                        closestTextNode = node;
                    }
                });
                if (closestTextNode) {
                    currentText = closestTextNode.textContent.trim();
                    targetNode = closestTextNode;
                }
            }

            // X座標からactorIndexを特定する
            const actorCenters = [];
            textNodes.forEach(node => {
                const cls = (node.getAttribute('class') || '').toLowerCase();
                const parentCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
                if (cls.includes('actor') || cls.includes('participant') || parentCls.includes('actor') || parentCls.includes('participant')) {
                    let tNode = node;
                    if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                    const bbox = this._getSVGBBox(svg, tNode);
                    const cx = bbox.x + bbox.width / 2;
                    if (!actorCenters.some(existing => Math.abs(existing - cx) < 20)) {
                        actorCenters.push(cx);
                    }
                }
            });
            actorCenters.sort((a, b) => a - b);
            const finalBBox = this._getSVGBBox(svg, targetNode);
            const finalCenterX = finalBBox.x + finalBBox.width / 2;
            actorIndex = actorCenters.findIndex(cx => Math.abs(cx - finalCenterX) < 20);
        }

        // Messageの場合は、Y座標から msgIndex を特定する
        let msgIndex = -1;
        if (type === 'message') {
            // メッセージグループの特定
            let messageGroup = targetNode;
            while (messageGroup && messageGroup !== svg) {
                const className = (messageGroup.getAttribute('class') || '').toLowerCase();
                if (className.includes('messageline') || className.includes('messagetext') || className.includes('message-line') || className.includes('message-text')) break;
                messageGroup = messageGroup.parentElement;
            }
            if (!messageGroup || messageGroup === svg) messageGroup = targetNode;

            const bbox = this._getSVGBBox(svg, messageGroup);
            const targetY = bbox.y + bbox.height / 2;

            const lineNodes = Array.from(svg.querySelectorAll('path, line')).filter(el => {
                const cls = (el.getAttribute('class') || '').toLowerCase();
                const id = (el.getAttribute('id') || '').toLowerCase();
                const parentCls = (el.parentElement ? el.parentElement.getAttribute('class') || '' : '').toLowerCase();
                if (cls.includes('actor') || parentCls.includes('actor') || cls.includes('participant') || parentCls.includes('participant')) return false;
                return cls.includes('message') || id.includes('message') || parentCls.includes('message');
            });

            if (lineNodes.length > 0) {
                const linesData = [];
                lineNodes.forEach(node => {
                    const b = this._getSVGBBox(svg, node);
                    linesData.push(b.y + b.height / 2);
                });
                linesData.sort((a, b) => a - b);
                const uniqueY = [];
                linesData.forEach(y => {
                    if (uniqueY.length === 0 || Math.abs(uniqueY[uniqueY.length - 1] - y) > 15) uniqueY.push(y);
                });
                let minDiff = Infinity;
                uniqueY.forEach((y, idx) => {
                    const diff = Math.abs(y - targetY);
                    if (diff < minDiff && diff < 30) {
                        minDiff = diff;
                        msgIndex = idx;
                    }
                });
            }
            
            if (!currentText) {
                const textNodes = Array.from(svg.querySelectorAll('text')).filter(node => {
                    const cls = (node.getAttribute('class') || '').toLowerCase();
                    const pCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
                    return cls.includes('message') || pCls.includes('message');
                });
                let minDiffText = Infinity;
                textNodes.forEach(node => {
                    const txt = node.textContent.trim();
                    if (!txt) return;
                    const b = this._getSVGBBox(svg, node);
                    const cy = b.y + b.height / 2;
                    const diff = Math.abs(cy - targetY);
                    if (diff < minDiffText && diff < 30) {
                        minDiffText = diff;
                        currentText = txt;
                        targetNode = node;
                    }
                });
            }
        }

        if (!currentText && type === 'actor') return; // Actor名が取れなかったら諦める

        // インプット要素の生成
        const wrapperRect = container.getBoundingClientRect();
        const targetRect = targetNode.getBoundingClientRect();
        
        let inputLeft = targetRect.left - wrapperRect.left;
        let inputTop  = targetRect.top - wrapperRect.top;
        let inputW    = Math.max(targetRect.width, 80);
        let inputH    = Math.max(targetRect.height, 28);

        // SVGテキスト要素はバウンディングボックスがタイトなため、少し余裕を持たせる
        inputLeft -= 4;
        inputTop -= 4;
        inputW += 8;
        inputH += 8;

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = currentText;
        inp.className = 'mermaid-node-label-input';
        inp.style.cssText = `
            position: absolute;
            left: ${inputLeft}px;
            top: ${inputTop}px;
            width: ${inputW}px;
            height: ${inputH}px;
            font-size: 14px;
            text-align: center;
            border: 2px solid #3b82f6;
            border-radius: 4px;
            background: white;
            z-index: 9999;
            box-sizing: border-box;
            padding: 0 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        `;
        
        container.style.position = 'relative';
        container.appendChild(inp);
        inp.select();
        inp.focus();

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            const newLabel = inp.value.trim();
            if (inp.parentNode) inp.parentNode.removeChild(inp);

            if (!newLabel || newLabel === currentText) return; // 変更なし

            const targetIndex = type === 'actor' ? actorIndex : msgIndex;
            this._applyLabelEdit(container, type, currentText, newLabel, targetIndex);
        };

        inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
            if (ev.key === 'Escape') {
                committed = true;
                if (inp.parentNode) inp.parentNode.removeChild(inp);
            }
        });
        inp.addEventListener('blur', commit);
    },

    /**
     * ソースコードを書き換えて再描画する
     */
    _applyLabelEdit(container, type, currentText, newLabel, targetIndex) {
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        let replaced = false;

        if (type === 'actor' && targetIndex !== -1) {
            // participant/actor 定義行を抽出し、targetIndex番目を置換する
            const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
            const defLines = [];
            
            for (let i = startIdx + 1; i < endIdx; i++) {
                const match = lines[i].match(reDef);
                if (match) {
                    defLines.push({ index: i, match: match });
                }
            }

            if (defLines.length > targetIndex) {
                const targetDef = defLines[targetIndex];
                const keyword = targetDef.match[1];
                const id = targetDef.match[2];
                lines[targetDef.index] = `    ${keyword} ${id} as ${newLabel}`;
                replaced = true;
            } else {
                // 明示的な定義行が見つからず、targetIndexでの特定ができなかった場合のフォールバック（文字列一致）
                const safeText = currentText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const reAs = new RegExp(`^(\\s*(?:participant|actor)\\s+[^\\s]+\\s+as\\s+)${safeText}\\s*$`, 'i');
                for (let i = startIdx + 1; i < endIdx; i++) {
                    const matchAs = lines[i].match(reAs);
                    if (matchAs) {
                        lines[i] = `${matchAs[1]}${newLabel}`;
                        replaced = true;
                        break;
                    }
                }
            }
        } else if (type === 'message' && targetIndex !== -1) {
            const skipWords = "note|loop|alt|opt|par|and|rect|break|critical|option|end|else|activate|deactivate|autonumber|participant|actor|box|title|link|links|create|destroy";
            const re = new RegExp(`^(?!\\s*%%)(\\s*(?!(?:${skipWords})\\b).+?(?:->>|-->>|-\\)|--\\)|-x|--x|->|-->).*?:\\s*)(.*)$`, 'i');
            let count = 0;
            
            for (let i = startIdx + 1; i < endIdx; i++) {
                const match = lines[i].match(re);
                if (match) {
                    if (count === targetIndex) {
                        // match[1] は 「A->>B: 」まで
                        lines[i] = `${match[1]}${newLabel}`;
                        replaced = true;
                        break;
                    }
                    count++;
                }
            }
        }

        if (replaced) {
            const newText = lines.join('\n');
            if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
            setEditorText(newText);

            // ツールバー等に選択解除を伝達
            this._clearSelection(container);

            if (typeof render === 'function') {
                setTimeout(() => {
                    render();
                    setTimeout(() => {
                        // MermaidSequenceToolbar._restoreEditModeを呼ぶ（存在する場合）
                        if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                            window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                            window.activeMermaidSequenceToolbar._restoreEditMode();
                        }
                    }, 100);
                }, 50);
            }
        }
    },

    _selectActorOrParticipant(container, svg, textContent, clickedElement, e) {
        let clickedTargetNode = clickedElement;
        if (clickedElement.tagName.toLowerCase() === 'text') {
            if (clickedElement.parentElement && clickedElement.parentElement.tagName.toLowerCase() === 'g') {
                clickedTargetNode = clickedElement.parentElement;
            }
        } else if (clickedElement.tagName.toLowerCase() === 'rect') {
            if (clickedElement.parentElement && clickedElement.parentElement.tagName.toLowerCase() === 'g') {
                clickedTargetNode = clickedElement.parentElement;
            }
        }

        const padding = 10;
        const clickedBBox = this._getSVGBBox(svg, clickedTargetNode);
        const clickedCenterX = clickedBBox.x + clickedBBox.width / 2;
        
        let textContentTrimmed = textContent ? textContent.trim() : "";

        // テキスト内容が直接渡されていない（図形や線がクリックされた）場合は、
        // X座標が最も近い text 要素を探して名前を特定する
        if (!textContentTrimmed) {
            const textNodes = Array.from(svg.querySelectorAll('text'));
            let minDiffX = Infinity;
            let closestText = "";
            textNodes.forEach(node => {
                const txt = node.textContent.trim();
                if (!txt) return;
                let targetNode = node;
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') targetNode = node.parentElement;
                const bbox = this._getSVGBBox(svg, targetNode);
                const centerX = bbox.x + bbox.width / 2;
                const diffX = Math.abs(centerX - clickedCenterX);
                if (diffX < minDiffX && diffX < 50) { // 同一ライン上にあるテキストを許容
                    minDiffX = diffX;
                    closestText = txt;
                }
            });
            textContentTrimmed = closestText;
        }

        // X座標からactorIndexを特定する
        const textNodesAll = Array.from(svg.querySelectorAll('text'));
        const actorCenters = [];
        textNodesAll.forEach(node => {
            const cls = (node.getAttribute('class') || '').toLowerCase();
            const parentCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
            if (cls.includes('actor') || cls.includes('participant') || parentCls.includes('actor') || parentCls.includes('participant')) {
                let tNode = node;
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                const bbox = this._getSVGBBox(svg, tNode);
                const cx = bbox.x + bbox.width / 2;
                if (!actorCenters.some(existing => Math.abs(existing - cx) < 20)) {
                    actorCenters.push(cx);
                }
            }
        });
        actorCenters.sort((a, b) => a - b);
        const finalBBox = this._getSVGBBox(svg, clickedTargetNode);
        const finalCenterX = finalBBox.x + finalBBox.width / 2;
        const actorIndex = actorCenters.findIndex(cx => Math.abs(cx - finalCenterX) < 20);

        const newSel = {
            type: 'actor',
            text: textContentTrimmed,
            index: actorIndex,
            id: null,
            drawParams: null
        };

        // actorIndexに対応するX座標付近にあるすべてのactor関連要素（縦線・矢印を除く）を集める
        const actorCenterX = actorCenters[actorIndex];
        const allActorNodes = Array.from(svg.querySelectorAll('rect, text, path, g, use, circle')).filter(node => {
            const cls = (node.getAttribute('class') || '').toLowerCase();
            const idAttr = (node.getAttribute('id') || '').toLowerCase();
            const parentCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
            
            // actor系の要素かどうか
            if (cls.includes('actor') || cls.includes('participant') || parentCls.includes('actor') || parentCls.includes('participant') || idAttr.includes('actor')) {
                // 縦線や矢印は除外
                if (node.tagName.toLowerCase() === 'line' || node.tagName.toLowerCase() === 'path') {
                    if (cls.includes('actor-line') || parentCls.includes('actor-line') || cls.includes('message') || parentCls.includes('message')) return false;
                }
                
                let tNode = node;
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                try {
                    const bbox = this._getSVGBBox(svg, tNode);
                    const cx = bbox.x + bbox.width / 2;
                    return Math.abs(cx - actorCenterX) < 50; // X座標が一致するもの（許容誤差拡大）
                } catch(e) {
                    return false;
                }
            }
            return false;
        });

        if (allActorNodes.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            allActorNodes.forEach(node => {
                try {
                    const bbox = this._getSVGBBox(svg, node);
                    if (bbox.width > 0 && bbox.height > 0) { // 不可視要素は除外
                        if (bbox.x < minX) minX = bbox.x;
                        if (bbox.y < minY) minY = bbox.y;
                        if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width;
                        if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height;
                    }
                } catch(e) {}
            });
            if (minX !== Infinity) {
                newSel.drawParams = [minX - padding, minY - padding, (maxX - minX) + padding * 2, (maxY - minY) + padding * 2, 'actor'];
                this._handleSelection(svg, newSel, e);
                return;
            }
        }

        // 最終フォールバック：どうしても取れない場合はクリックした要素自体を囲む
        let fbX = clickedBBox.x;
        let fbY = clickedBBox.y;
        let fbW = clickedBBox.width;
        let fbH = clickedBBox.height;

        if (fbW === 0 || fbH === 0) {
            fbX = actorCenterX - 30;
            fbW = 60;
            fbH = 100; // 適当な大きさで代用
        }

        newSel.drawParams = [fbX - padding, fbY - padding, fbW + padding * 2, fbH + padding * 2, 'actor'];
        this._handleSelection(svg, newSel, e);
    },

    /**
     * 活性化区間 (activate/deactivate) を点線で囲む
     */
    _selectActivation(container, svg, target, e) {
        let targetNode = target;
        // activationクラスを持つ親を探す
        while (targetNode && targetNode !== svg) {
            const className = (targetNode.getAttribute('class') || '').toLowerCase();
            if (className.includes('activation')) {
                break;
            }
            targetNode = targetNode.parentElement;
        }

        if (!targetNode || targetNode === svg) {
            targetNode = target; // 見つからなければクリックした要素自体
        }

        const bbox = this._getSVGBBox(svg, targetNode);
        const padding = 4;
        
        const targetCenterX = bbox.x + bbox.width / 2;
        const targetCenterY = bbox.y + bbox.height / 2;

        // X座標から、どのActorに属するActivationかを特定する
        const textNodesAll = Array.from(svg.querySelectorAll('text'));
        const actorCenters = [];
        textNodesAll.forEach(node => {
            const cls = (node.getAttribute('class') || '').toLowerCase();
            const parentCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
            if (cls.includes('actor') || cls.includes('participant') || parentCls.includes('actor') || parentCls.includes('participant')) {
                let tNode = node;
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'g') tNode = node.parentElement;
                const b = this._getSVGBBox(svg, tNode);
                const cx = b.x + b.width / 2;
                if (!actorCenters.some(existing => Math.abs(existing.cx - cx) < 20)) {
                    actorCenters.push({ cx, text: node.textContent.trim() });
                }
            }
        });
        actorCenters.sort((a, b) => a.cx - b.cx);

        let targetActorIndex = -1;
        let targetActorText = "";
        let minDiff = Infinity;
        actorCenters.forEach((actor, idx) => {
            const diff = Math.abs(actor.cx - targetCenterX);
            if (diff < minDiff && diff < 30) {
                minDiff = diff;
                targetActorIndex = idx;
                targetActorText = actor.text;
            }
        });

        // そのActorに属する全ActivationをY座標でソート
        const actBoxes = Array.from(svg.querySelectorAll('rect')).filter(el => {
            const cls = (el.getAttribute('class')||'').toLowerCase();
            const pCls = (el.parentElement ? el.parentElement.getAttribute('class')||'' : '').toLowerCase();
            return cls.includes('activation') || pCls.includes('activation');
        });
        
        const myActBoxes = [];
        actBoxes.forEach(el => {
            const b = this._getSVGBBox(svg, el);
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            if (Math.abs(cx - targetCenterX) < 30) {
                myActBoxes.push({ y: cy, el });
            }
        });
        myActBoxes.sort((a, b) => a.y - b.y);
        
        const actIndexOnActor = myActBoxes.findIndex(item => Math.abs(item.y - targetCenterY) < 10);

        const newSel = {
            type: 'activation',
            text: targetActorText,
            actorIndex: targetActorIndex,
            index: actIndexOnActor,
            node: targetNode,
            drawParams: [bbox.x - padding, bbox.y - padding, bbox.width + padding * 2, bbox.height + padding * 2]
        };

        this._handleSelection(svg, newSel, e);
    },

    /**
     * メッセージ（矢印）を点線で囲む
     */
    _selectMessage(container, svg, target, clickedText, e) {
        let targetNode = target;
        // tspanがクリックされた場合は親のtext要素を対象とする
        if (target.tagName.toLowerCase() === 'tspan' && target.parentElement) {
            targetNode = target.parentElement;
        }

        // messageLine や messageText クラスを持つ親を探す
        let messageGroup = targetNode;
        while (messageGroup && messageGroup !== svg) {
            const className = (messageGroup.getAttribute('class') || '').toLowerCase();
            if (className.includes('messageline') || className.includes('messagetext') || className.includes('message-line') || className.includes('message-text')) {
                break;
            }
            messageGroup = messageGroup.parentElement;
        }

        if (!messageGroup || messageGroup === svg) {
            messageGroup = targetNode;
        }
        
        targetNode = messageGroup;

        const bbox = this._getSVGBBox(svg, targetNode);
        const padding = 8;

        // === 1. クラスの番号を完全に無視し、「Y座標」だけで上から何番目かを特定する ===
        let messageIndex = -1;

        // SVG内のすべての矢印の線を収集する（テキストは除外し、線だけを抽出して二重カウントを防ぐ）
        const lineNodes = Array.from(svg.querySelectorAll('path, line')).filter(el => {
            const cls = (el.getAttribute('class') || '').toLowerCase();
            const id = (el.getAttribute('id') || '').toLowerCase();
            const parentCls = (el.parentElement ? el.parentElement.getAttribute('class') || '' : '').toLowerCase();
            
            // actorの縦線などは除外
            if (cls.includes('actor') || parentCls.includes('actor') || cls.includes('participant') || parentCls.includes('participant')) return false;

            return cls.includes('message') || id.includes('message') || parentCls.includes('message');
        });

        if (lineNodes.length > 0) {
            const targetY = bbox.y + bbox.height / 2;
            const linesData = [];
            
            lineNodes.forEach(node => {
                const b = this._getSVGBBox(svg, node);
                linesData.push(b.y + b.height / 2);
            });
            
            // Y座標を昇順（上から下）にソート
            linesData.sort((a, b) => a - b);
            
            // 近いY座標（誤差15px以内）をグループ化して重複を排除（これで矢印の数が確定する）
            const uniqueY = [];
            linesData.forEach(y => {
                if (uniqueY.length === 0 || Math.abs(uniqueY[uniqueY.length - 1] - y) > 15) {
                    uniqueY.push(y);
                }
            });
            
            // クリックされた要素のY座標が、上から何番目か（インデックス）を判定
            let minDiff = Infinity;
            uniqueY.forEach((y, idx) => {
                const diff = Math.abs(y - targetY);
                // テキストと線の間隔を考慮して許容誤差を少し広め(30px)に取る
                if (diff < minDiff && diff < 30) {
                    minDiff = diff;
                    messageIndex = idx;
                }
            });
        }

        // === 2. テキストが取れていない場合の補完 ===
        let textContentTrimmed = clickedText ? clickedText.trim() : "";
        if (!textContentTrimmed) {
            const clickCenterY = bbox.y + bbox.height / 2;
            const textNodes = Array.from(svg.querySelectorAll('text')).filter(node => {
                const cls = (node.getAttribute('class') || '').toLowerCase();
                const pCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
                return cls.includes('message') || pCls.includes('message');
            });
            let closestText = null;
            let minDiffText = Infinity;
            
            textNodes.forEach(textNode => {
                const txt = textNode.textContent.trim();
                if (!txt) return;
                let tNode = textNode;
                if (textNode.parentElement && textNode.parentElement.tagName.toLowerCase() === 'g') tNode = textNode.parentElement;
                const b = this._getSVGBBox(svg, tNode);
                const cy = b.y + b.height / 2;
                const diff = Math.abs(cy - clickCenterY);
                if (diff < minDiffText && diff < 30) {
                    minDiffText = diff;
                    closestText = txt;
                }
            });
            if (closestText) textContentTrimmed = closestText;
        }

        const newSel = {
            type: 'message',
            text: textContentTrimmed,
            index: messageIndex,
            id: null,
            drawParams: [bbox.x - padding, bbox.y - padding, bbox.width + padding * 2, bbox.height + padding * 2]
        };

        this._handleSelection(svg, newSel, e);

        // ツールバーへ選択情報を伝達（現在の矢印タイプをソースから取得して渡す）
        if (window.activeMermaidSequenceToolbar) {
            const currentArrow = this._getArrowTypeByIndex(container, messageIndex);
            window.activeMermaidSequenceToolbar.setSelectedMessage(textContentTrimmed, currentArrow, messageIndex);
        }
    },

    // =========================================================================
    // コンテキストメニューと API 実装
    // =========================================================================

    _showContextMenu(x, y, wrapper, container) {
        const existingMenu = document.getElementById('mermaid-context-menu');
        if (existingMenu) existingMenu.remove();

        if (!window._mermaidGlobalEventsBoundSeq) {
            window._mermaidGlobalEventsBoundSeq = true;
            document.addEventListener('click', e => {
                const menu = document.getElementById('mermaid-context-menu');
                if (menu && !e.target.closest('#mermaid-context-menu')) {
                    menu.remove();
                }
            });
        }

        const menu = document.createElement('div');
        menu.id = 'mermaid-context-menu';
        menu.className = 'context-menu visible';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';
        
        // _currentSelectionsは配列なので、それを参照して状態を判定する
        const hasActorSelected = this._currentSelections && this._currentSelections.some(s => s.type === 'actor');
        const isSelected = this._currentSelections && this._currentSelections.length > 0;
        
        const items = [];
        
        if (hasActorSelected) {
            items.push({ label: 'コピー', shortcut: 'Ctrl+C', action: 'copy' });
        }
        // クリップボードが配列の場合と単体の場合に対応
        const hasClipboard = Array.isArray(this._clipboard)
            ? this._clipboard.length > 0 && this._clipboard[0].type === 'actor'
            : (this._clipboard && this._clipboard.type === 'actor');
        if (hasClipboard) {
            items.push({ label: '貼り付け', shortcut: 'Ctrl+V', action: 'paste' });
        }
        
        if (items.length > 0) {
            items.push({ type: 'separator' });
        }
        
        if (isSelected) {
            items.push({ label: '削除', shortcut: 'Delete', action: 'delete' });
        }

        if (items.length === 0) return;

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

            // ショートカットキーの表示（フローチャートと同じスタイル）
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
                    container._mermaidSequenceAPI.copySelection();
                } else if (item.action === 'paste') {
                    container._mermaidSequenceAPI.pasteSelection();
                } else if (item.action === 'delete') {
                    container._mermaidSequenceAPI.deleteSelection();
                }
            };
            menu.appendChild(el);
        });

        document.body.appendChild(menu);

        const padding = 10;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const menuRect = menu.getBoundingClientRect();
        
        let finalX = x;
        let finalY = y;
        
        if (finalX + menuRect.width > viewportW - padding) finalX = viewportW - menuRect.width - padding;
        if (finalY + menuRect.height > viewportH - padding) finalY = viewportH - menuRect.height - padding;

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    },

    _deleteSelection(container) {
        if (!this._currentSelections || this._currentSelections.length === 0) return;
        
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        const linesToDelete = new Set();
        let replaced = false;

        this._currentSelections.forEach(sel => {
            if (sel.type === 'actor' && sel.index !== -1) {
                const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
                const defLines = [];
                for (let i = startIdx + 1; i < endIdx; i++) {
                    const match = lines[i].match(reDef);
                    if (match) {
                        defLines.push({ index: i, match: match });
                    }
                }
                if (defLines.length > sel.index) {
                    const targetId = defLines[sel.index].match[2];
                    const safeId = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    
                    const reTargetDef = new RegExp(`^\\s*(participant|actor)\\s+${safeId}(?:\\s+as\\s+.*)?\\s*$`, 'i');
                    const reTargetAct = new RegExp(`^\\s*(activate|deactivate)\\s+${safeId}\\s*$`, 'i');
                    const reTargetMsgFrom = new RegExp(`^\\s*${safeId}\\s*(?:->>|-->>|-\\)|--\\)|-x|--x|->|-->)`, 'i');
                    const reTargetMsgTo = new RegExp(`(?:->>|-->>|-\\)|--\\)|-x|--x|->|-->)\\s*${safeId}\\s*:`, 'i');

                    for (let i = startIdx + 1; i < endIdx; i++) {
                        const line = lines[i];
                        if (reTargetDef.test(line) || reTargetAct.test(line) || reTargetMsgFrom.test(line) || reTargetMsgTo.test(line)) {
                            linesToDelete.add(i);
                        }
                    }
                }
            } else if (sel.type === 'message' && sel.index !== -1) {
                const skipWords = "note|loop|alt|opt|par|and|rect|break|critical|option|end|else|activate|deactivate|autonumber|participant|actor|box|title|link|links|create|destroy";
                const re = new RegExp(`^(?!\\s*%%)(\\s*(?!(?:${skipWords})\\b).+?(?:->>|-->>|-\\)|--\\)|-x|--x|->|-->).*?:\\s*)(.*)$`, 'i');
                let count = 0;
                for (let i = startIdx + 1; i < endIdx; i++) {
                    // linesToDeleteに入っている行はカウントに含めるかどうか？
                    // 本来のインデックスは現在のテキストベースなので、含めてカウントする
                    if (lines[i].match(re)) {
                        if (count === sel.index) {
                            linesToDelete.add(i);
                            break;
                        }
                        count++;
                    }
                }
            } else if (sel.type === 'activation' && sel.actorIndex !== -1 && sel.index !== -1) {
                const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
                const defLines = [];
                for (let i = startIdx + 1; i < endIdx; i++) {
                    const match = lines[i].match(reDef);
                    if (match) {
                        defLines.push({ index: i, match: match });
                    }
                }

                let targetId = null;
                if (defLines.length > sel.actorIndex) {
                    targetId = defLines[sel.actorIndex].match[2];
                } else if (sel.text) {
                    targetId = sel.text;
                }

                if (targetId) {
                    const safeId = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const reAct = new RegExp(`^\\s*activate\\s+${safeId}\\s*$`, 'i');
                    const reDeact = new RegExp(`^\\s*deactivate\\s+${safeId}\\s*$`, 'i');
                    
                    let countAct = 0;
                    let targetActLine = -1;
                    for (let i = startIdx + 1; i < endIdx; i++) {
                        if (lines[i].match(reAct)) {
                            if (countAct === sel.index) {
                                targetActLine = i;
                                break;
                            }
                            countAct++;
                        }
                    }
                    
                    let countDeact = 0;
                    let targetDeactLine = -1;
                    for (let i = startIdx + 1; i < endIdx; i++) {
                        if (lines[i].match(reDeact)) {
                            if (countDeact === sel.index) {
                                targetDeactLine = i;
                                break;
                            }
                            countDeact++;
                        }
                    }

                    if (targetDeactLine !== -1 && targetActLine !== -1) {
                        linesToDelete.add(targetActLine);
                        linesToDelete.add(targetDeactLine);
                    }
                }
            }
        });

        if (linesToDelete.size > 0) {
            replaced = true;
            const sortedIndices = Array.from(linesToDelete).sort((a, b) => b - a);
            sortedIndices.forEach(idx => {
                lines.splice(idx, 1);
            });
        }

        if (replaced) {
            this._clearSelection(container);
            const newText = lines.join('\n');
            if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
            setEditorText(newText);
            if (typeof render === 'function') {
                setTimeout(() => {
                    render();
                    setTimeout(() => {
                        if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                            window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                            window.activeMermaidSequenceToolbar._restoreEditMode();
                        }
                    }, 100);
                }, 50);
            }
            if (typeof showToast === 'function') showToast('削除しました', 'success');
        }
    },

    _copySelection(container) {
        if (!this._currentSelections || this._currentSelections.length === 0) return;
        
        const actors = this._currentSelections.filter(s => s.type === 'actor');
        if (actors.length === 0) return;
        
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
        const defLines = [];
        for (let i = startIdx + 1; i < endIdx; i++) {
            const match = lines[i].match(reDef);
            if (match) {
                defLines.push({ index: i, match: match });
            }
        }
        
        this._clipboard = [];
        
        actors.forEach(sel => {
            if (defLines.length > sel.index) {
                const targetDef = defLines[sel.index];
                this._clipboard.push({
                    type: 'actor',
                    keyword: targetDef.match[1],
                    id: targetDef.match[2],
                    alias: targetDef.match[3] || targetDef.match[2]
                });
            }
        });

        if (this._clipboard.length > 0) {
            if (typeof showToast === 'function') showToast(`${this._clipboard.length}個の要素をコピーしました`, 'success');
        }
    },

    _pasteSelection(container) {
        if (!this._clipboard || this._clipboard.length === 0 || this._clipboard[0].type !== 'actor') return;

        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
        const existingIds = new Set();
        let lastDefIndex = startIdx + 1;
        
        for (let i = startIdx + 1; i < endIdx; i++) {
            const match = lines[i].match(reDef);
            if (match) {
                existingIds.add(match[2]);
                lastDefIndex = i;
            }
        }
        
        let insertIndex = lastDefIndex + 1;
        
        this._clipboard.forEach(clip => {
            let newId = `${clip.id}_copy`;
            let counter = 1;
            while (existingIds.has(newId)) {
                newId = `${clip.id}_copy${counter}`;
                counter++;
            }
            existingIds.add(newId);
            
            const newAlias = clip.alias ? `${clip.alias}_コピー` : newId;
            const newLine = `    ${clip.keyword} ${newId} as ${newAlias}`;
            
            lines.splice(insertIndex, 0, newLine);
            insertIndex++;
        });

        const newText = lines.join('\n');
        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
        setEditorText(newText);
        
        if (typeof showToast === 'function') showToast(`${this._clipboard.length}個の要素を貼り付けました`, 'success');
        
        if (typeof render === 'function') {
            setTimeout(() => {
                render();
                setTimeout(() => {
                    if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                        window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                        window.activeMermaidSequenceToolbar._restoreEditMode();
                    }
                }, 100);
            }, 50);
        }
    },

    /**
     * 選択枠の描画
     */
    _drawSelectionBox(svg, x, y, width, height, type = null) {
        // this._clearSelection() は _redrawSelections 内で行うため削除

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute('class', 'mermaid-sequence-selection-rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#3b82f6');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('stroke-dasharray', '5,5');
        rect.setAttribute('pointer-events', 'none');
        rect.setAttribute('rx', '4');
        rect.setAttribute('ry', '4');

        svg.appendChild(rect);

        if (type === 'actor') {
            const handleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            handleG.setAttribute('class', 'mermaid-sequence-drag-handle mermaid-sequence-selection-rect');
            handleG.style.cursor = 'grab';

            const hWidth = 12;
            const hHeight = 20;
            const hX = x + width / 2 - hWidth / 2;
            const hY = y + height - hHeight - 2;

            const handleBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            handleBg.setAttribute('x', hX);
            handleBg.setAttribute('y', hY);
            handleBg.setAttribute('width', hWidth);
            handleBg.setAttribute('height', hHeight);
            handleBg.setAttribute('fill', '#ffffff');
            handleBg.setAttribute('stroke', '#0d6efd');
            handleBg.setAttribute('stroke-width', '1');
            handleBg.setAttribute('rx', '3');
            handleG.appendChild(handleBg);

            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 2; col++) {
                    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('cx', hX + 4 + col * 4);
                    dot.setAttribute('cy', hY + 5 + row * 5);
                    dot.setAttribute('r', '1');
                    dot.setAttribute('fill', '#0d6efd');
                    handleG.appendChild(dot);
                }
            }

            svg.appendChild(handleG);
        }
    },

    /**
     * 選択枠のクリア
     */
    _clearSelection(container) {
        this._currentSelections = [];
        document.querySelectorAll('.mermaid-sequence-selection-rect').forEach(el => el.remove());
        const existingLines = container.querySelectorAll('.mermaid-sequence-selection-line');
        existingLines.forEach(line => line.remove());
        document.querySelectorAll('.mermaid-sequence-drag-handle').forEach(el => el.remove());
        // SVG内のプレビュー矢印もクリア
        const svg = container.querySelector('svg');
        if (svg) this._removeArrowPreview(svg);

        if (window.activeMermaidSequenceToolbar) {
            window.activeMermaidSequenceToolbar.setSelectedMessage(null, null);
        }
    },

    _moveActorSequence(container, fromIndex, toIndex, actorCentersInfo) {
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        const blockLines = lines.slice(startIdx + 1, endIdx);

        const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+(.*))?\s*$/i;
        const extractedDefs = [];
        
        const newBlockLines = [];
        let seqDiagramLineIdx = -1;

        for (let i = 0; i < blockLines.length; i++) {
            const line = blockLines[i];
            if (line.trim().toLowerCase().startsWith('sequencediagram')) {
                seqDiagramLineIdx = i;
                newBlockLines.push(line);
                continue;
            }

            const match = line.match(reDef);
            if (match) {
                extractedDefs.push({ originalText: line.trim() });
            } else {
                newBlockLines.push(line);
            }
        }

        // actorCentersInfo の数が extractedDefs より多い場合、暗黙のActorとして扱う
        for (let i = extractedDefs.length; i < actorCentersInfo.length; i++) {
            const implicitId = actorCentersInfo[i].text;
            extractedDefs.push({ originalText: `participant ${implicitId}` });
        }

        if (fromIndex >= 0 && fromIndex < extractedDefs.length && toIndex >= 0 && toIndex <= extractedDefs.length) {
            const [moved] = extractedDefs.splice(fromIndex, 1);
            extractedDefs.splice(toIndex, 0, moved);
        }

        if (seqDiagramLineIdx !== -1) {
            const newDefLines = extractedDefs.map(def => `    ${def.originalText}`);
            newBlockLines.splice(seqDiagramLineIdx + 1, 0, ...newDefLines);
        }

        const newText = [
            ...lines.slice(0, startIdx + 1),
            ...newBlockLines,
            ...lines.slice(endIdx)
        ].join('\n');

        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
        setEditorText(newText);
        
        if (typeof render === 'function') {
            setTimeout(() => {
                render();
                setTimeout(() => {
                    if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                        window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                        window.activeMermaidSequenceToolbar._restoreEditMode();
                    }
                }, 100);
            }, 50);
        }
    },

    /**
     * actor選択時にライフライン中段へ矢印ハンドル（▶）を表示する
     * @param {SVGElement} svg
     * @param {number} actorCenterX ライフライン中心X座標（SVG座標系）
     */
    _showArrowHandle(svg, actorCenterX) {
        svg.querySelectorAll('.mermaid-seq-arrow-handle').forEach(el => el.remove());

        // SVGの表示高さを取得して中段Yを算出
        let svgH = 200;
        try {
            const vb = svg.getAttribute('viewBox');
            if (vb) {
                const parts = vb.trim().split(/[\s,]+/);
                if (parts.length >= 4) svgH = parseFloat(parts[3]);
            } else {
                svgH = svg.clientHeight || 200;
            }
        } catch (_) {}
        const midY = svgH / 2;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'mermaid-seq-arrow-handle mermaid-sequence-selection-rect');
        g.style.cursor = 'crosshair';

        const r = 10;
        const hx = actorCenterX + 4; // ライフライン右側

        // 背景円（クリック領域を広げる）
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', String(hx + r));
        bg.setAttribute('cy', String(midY));
        bg.setAttribute('r', String(r + 2));
        bg.setAttribute('fill', 'white');
        bg.setAttribute('stroke', '#3b82f6');
        bg.setAttribute('stroke-width', '1.5');
        bg.setAttribute('pointer-events', 'all');
        g.appendChild(bg);

        // 右向き三角形（▶）
        const tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tri.setAttribute('d', `M${hx + 3},${midY - 6} L${hx + r * 2 - 1},${midY} L${hx + 3},${midY + 6} Z`);
        tri.setAttribute('fill', '#3b82f6');
        tri.setAttribute('pointer-events', 'none');
        g.appendChild(tri);

        svg.appendChild(g);
    },

    /**
     * 矢印プレビュー（点線）をSVGに描画・更新する
     */
    _updateArrowPreview(svg, x1, y1, x2, y2, snapping) {
        let line = svg.querySelector('.mermaid-seq-arrow-preview');
        if (!line) {
            line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'mermaid-seq-arrow-preview');
            line.setAttribute('pointer-events', 'none');
            line.setAttribute('stroke-dasharray', '6,4');
            line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);
        }
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', snapping ? '#22c55e' : '#3b82f6');
        line.setAttribute('stroke-width', snapping ? '2.5' : '2');

        // スナップ中のみ矢先を表示
        let arrowHead = svg.querySelector('.mermaid-seq-arrow-preview-head');
        if (snapping) {
            if (!arrowHead) {
                arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                arrowHead.setAttribute('class', 'mermaid-seq-arrow-preview-head');
                arrowHead.setAttribute('pointer-events', 'none');
                svg.appendChild(arrowHead);
            }
            const dir = x2 >= x1 ? 1 : -1;
            arrowHead.setAttribute('d', `M${x2},${y2} L${x2 - dir * 10},${y2 - 5} L${x2 - dir * 10},${y2 + 5} Z`);
            arrowHead.setAttribute('fill', '#22c55e');
        } else if (arrowHead) {
            arrowHead.remove();
        }
    },

    /**
     * 矢印プレビュー要素をすべて削除する
     */
    _removeArrowPreview(svg) {
        if (!svg) return;
        svg.querySelectorAll('.mermaid-seq-arrow-preview, .mermaid-seq-arrow-preview-head, .mermaid-seq-uturn-preview').forEach(el => el.remove());
    },

    /**
     * メッセージインデックスからソースコードの矢印タイプを取得する
     * @param {Element} container
     * @param {number} messageIndex メッセージの0-baseインデックス
     * @returns {string|null} 矢印タイプ（例: '->>', '-->>') または null
     */
    _getArrowTypeByIndex(container, messageIndex) {
        if (messageIndex < 0 || typeof getEditorText !== 'function') return null;

        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return null;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t.startsWith('```') || t.startsWith('~~~')) { endIdx = i; break; }
        }

        const skipWords = 'note|loop|alt|opt|par|and|rect|break|critical|option|end|else|activate|deactivate|autonumber|participant|actor|box|title|link|links|create|destroy';
        // 矢印タイプを長い順にマッチ（短いものが先にマッチしないよう）末尾のスペースは必須にしない
        const arrowRe = new RegExp(`^(?!\\s*%%)(\\s*(?!(?:${skipWords})\\b).+?)(->\\)|--\\)|-->>|->>|--x|-x|-->|->)`, 'i');
        let count = 0;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const match = lines[i].match(arrowRe);
            if (match) {
                if (count === messageIndex) {
                    return match[2];
                }
                count++;
            }
        }
        return null;
    },

    /**
     * シーケンス図の矢印・ライン要素にクリック判定エリアを拡大するヒットボックスを追加する
     * フローチャートの enhanceEdgeHitboxes と同等の処理
     */
    _enhanceMessageHitboxes(container) {
        const svg = container.querySelector('svg');
        if (!svg) return;

        // メッセージに関連するパスと線を収集（actorの縦線を除く）
        const msgEls = Array.from(svg.querySelectorAll('path, line')).filter(el => {
            const cls = (el.getAttribute('class') || '').toLowerCase();
            const pCls = (el.parentElement ? el.parentElement.getAttribute('class') || '' : '').toLowerCase();
            // actorの縦線や背景矩形は除外
            if (cls.includes('actor-line') || pCls.includes('actor-line')) return false;
            if (cls.includes('actor') || pCls.includes('actor')) return false;
            // ヒットボックス自身は除外
            if (cls.includes('seq-msg-hitbox')) return false;
            // Mermaidが独自生成した透明な判定用パスは除外する
            if (el.getAttribute('stroke') === 'transparent' || el.style.stroke === 'transparent' || el.getAttribute('opacity') === '0' || el.style.opacity === '0') return false;

            return cls.includes('message') || pCls.includes('message') ||
                   cls.includes('messageline') || pCls.includes('messageline');
        });

        msgEls.forEach(el => {
            if (el.dataset.hasSeqHitbox) return;
            el.dataset.hasSeqHitbox = 'true';

            const hitbox = el.cloneNode(false);
            hitbox.classList.add('seq-msg-hitbox');
            hitbox.removeAttribute('id');
            delete hitbox.dataset.hasSeqHitbox;

            // 見た目は透明にし、線幅を24pxにしてクリック判定を広げる
            hitbox.style.setProperty('stroke', 'transparent', 'important');
            hitbox.style.setProperty('stroke-width', '24px', 'important');
            hitbox.style.setProperty('fill', 'none', 'important');
            hitbox.style.setProperty('pointer-events', 'stroke', 'important');
            hitbox.style.setProperty('cursor', 'pointer', 'important');
            hitbox.style.setProperty('stroke-dasharray', 'none', 'important'); // 点線の判定をなくすため
            // 矢印マーカーは除去
            hitbox.removeAttribute('marker-end');
            hitbox.removeAttribute('marker-start');
            hitbox.removeAttribute('stroke-dasharray'); // 属性としても削除

            if (el.parentNode) {
                el.parentNode.appendChild(hitbox);
            }
        });
    },

    /**
     * actorIndexに対応するMermaidソース上のIDを返す
     * 定義行が見つからない場合は actorCenters[index].text をフォールバックとして使用
     */
    _getActorIdByIndex(container, index, actorCenters) {
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return actorCenters[index] ? actorCenters[index].text : null;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) { endIdx = i; break; }
        }

        const reDef = /^\s*(participant|actor)\s+([^\s]+)(?:\s+as\s+.*)?\s*$/i;
        const defLines = [];
        for (let i = startIdx + 1; i < endIdx; i++) {
            const m = lines[i].match(reDef);
            if (m) defLines.push(m[2]);
        }

        if (defLines.length > index) return defLines[index];
        // 暗黙定義のフォールバック
        return actorCenters[index] ? actorCenters[index].text : null;
    },

    /**
     * ドラッグで確定した矢印をMermaidソースに追加して再描画する
     * @param {Element} container
     * @param {number} fromIndex 送信元actorのインデックス
     * @param {number} toIndex 送信先actorのインデックス
     * @param {Array} actorCenters {cx, text}の配列
     * @param {number} insertBeforeIdx 挿入先のソース行インデックス
     */
    _addMessageLine(container, fromIndex, toIndex, actorCenters, insertBeforeIdx) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        const fromId = this._getActorIdByIndex(container, fromIndex, actorCenters);
        const toId   = this._getActorIdByIndex(container, toIndex,   actorCenters);
        if (!fromId || !toId) return;

        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) { endIdx = i; break; }
        }

        // 挿入位置の決定: insertBeforeIdx が有効なら、そのソース行の直前に挿入
        const newMsgLine = `    ${fromId}->>${toId}: メッセージ`;
        let insertAt = endIdx; // デフォルトは末尾
        if (typeof insertBeforeIdx === 'number' && insertBeforeIdx >= 0 && insertBeforeIdx < lines.length) {
            insertAt = insertBeforeIdx;
        }
        lines.splice(insertAt, 0, newMsgLine);

        const newText = lines.join('\n');
        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
        setEditorText(newText);
        // キャッシュを無効化
        this._lifelineCache = null;

        if (typeof showToast === 'function') showToast('矢印を追加しました', 'success');

        if (typeof render === 'function') {
            setTimeout(() => {
                render();
                setTimeout(() => {
                    if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                        window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                        window.activeMermaidSequenceToolbar._restoreEditMode();
                    }
                }, 100);
            }, 50);
        }
    },

    // ============================================================
    // ライフラインキャッシュ構築
    // ============================================================

    /**
     * SVGからactor位置・メッセージY座標・ソース行インデックスを収集してキャッシュする
     */
    _buildLifelineCache(svg, container) {
        if (this._lifelineCache) return this._lifelineCache;

        const cache = { actors: [], messages: [] };

        // --- actors: ライフライン中心X・上下ボックスY ---
        const seenActors = []; // { cx, text }
        Array.from(svg.querySelectorAll('text')).forEach(node => {
            const cls = (node.getAttribute('class') || '').toLowerCase();
            const pCls = (node.parentElement ? node.parentElement.getAttribute('class') || '' : '').toLowerCase();
            if (!(cls.includes('actor') || cls.includes('participant') || pCls.includes('actor') || pCls.includes('participant'))) return;
            let tNode = node.parentElement && node.parentElement.tagName.toLowerCase() === 'g' ? node.parentElement : node;
            const b = this._getSVGBBox(svg, tNode);
            const cx = b.x + b.width / 2;
            if (!seenActors.some(ex => Math.abs(ex.cx - cx) < 20)) {
                seenActors.push({ cx, text: node.textContent.trim() });
            }
        });
        seenActors.sort((a, b) => a.cx - b.cx);
        const seenCX = seenActors.map(a => a.cx);

        // 各ライフラインの上下ボックスY範囲を rect から取得
        const allRects = Array.from(svg.querySelectorAll('rect')).filter(el => {
            const c = (el.getAttribute('class') || '').toLowerCase();
            const pc = (el.parentElement ? el.parentElement.getAttribute('class') || '' : '').toLowerCase();
            return c.includes('actor') || pc.includes('actor') || c.includes('participant') || pc.includes('participant');
        });

        seenCX.forEach((cx, idx) => {
            const near = allRects.filter(r => {
                const b = this._getSVGBBox(svg, r);
                return Math.abs(b.x + b.width / 2 - cx) < 30;
            }).map(r => this._getSVGBBox(svg, r)).sort((a, b) => a.y - b.y);

            const topBoxBottomY = near.length > 0 ? near[0].y + near[0].height : 0;
            const botBoxTopY    = near.length > 1 ? near[near.length - 1].y : (near.length === 1 ? near[0].y : 999);
            cache.actors.push({ cx, index: idx, text: seenActors[idx] ? seenActors[idx].text : '', topBoxBottomY, botBoxTopY });
        });

        // --- messages: メッセージY座標とソース行インデックス ---
        const msgYValues = [];
        Array.from(svg.querySelectorAll('path, line')).forEach(el => {
            const cls = (el.getAttribute('class') || '').toLowerCase();
            const pCls = (el.parentElement ? el.parentElement.getAttribute('class') || '' : '').toLowerCase();
            if (cls.includes('actor') || pCls.includes('actor') || cls.includes('actor-line') || pCls.includes('actor-line')) return;
            if (cls.includes('message') || pCls.includes('message') || cls.includes('messageline') || pCls.includes('messageline')) {
                const b = this._getSVGBBox(svg, el);
                const y = b.y + b.height / 2;
                if (!msgYValues.some(v => Math.abs(v - y) < 10)) msgYValues.push(y);
            }
        });
        msgYValues.sort((a, b) => a - b);

        // ソース行インデックスのマッピング
        const srcIndices = this._getMsgSourceLineIndices(container);
        cache.messages = msgYValues.map((y, i) => ({
            y,
            srcLineIdx: srcIndices[i] !== undefined ? srcIndices[i] : -1
        }));

        this._lifelineCache = cache;
        return cache;
    },

    /**
     * ソースからメッセージ行のインデックス（0-based）を取得する
     */
    _getMsgSourceLineIndices(container) {
        if (typeof getEditorText !== 'function') return [];
        const editorText = getEditorText();
        const lines = editorText.split('\n');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return [];

        const startIdx = dataLine - 1;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) { endIdx = i; break; }
        }

        // メッセージ行を抽出（participant/actor/activate/deactivate/note等を除外）
        const skip = /^\s*(participant|actor|activate|deactivate|note|loop|alt|opt|par|and|rect|break|critical|option|end|else|box|title|link|links|create|destroy|autonumber|%%)\b/i;
        const msgRe = /->>|-->>/;
        const result = [];
        for (let i = startIdx + 1; i < endIdx; i++) {
            const t = lines[i].trim();
            if (!skip.test(t) && msgRe.test(t)) result.push(i);
        }
        return result;
    },

    // ============================================================
    // ホバーアイコン表示・非表示
    // ============================================================

    /**
     * ライフラインにホバーアイコンを表示する
     */
    _showLifelineHoverIcons(svg, actorIndex, mouseY, cache) {
        svg.querySelectorAll('.mermaid-seq-hover-icon').forEach(el => el.remove());
        const actor = cache.actors[actorIndex];
        if (!actor) return;

        const cx = actor.cx;
        const topY = actor.topBoxBottomY;
        const botY = actor.botBoxTopY;
        const msgs = cache.messages;

        // === ↔ アイコン（マウスに最も近い隙間に1つ）===
        const gaps = [];
        if (msgs.length === 0) {
            gaps.push({ midY: (topY + botY) / 2, insertBeforeIdx: -1, gapIdx: 0 });
        } else {
            gaps.push({ midY: (topY + msgs[0].y) / 2, insertBeforeIdx: msgs[0].srcLineIdx, gapIdx: 0 });
            for (let i = 1; i < msgs.length; i++) {
                gaps.push({ midY: (msgs[i-1].y + msgs[i].y) / 2, insertBeforeIdx: msgs[i].srcLineIdx, gapIdx: i });
            }
            gaps.push({ midY: (msgs[msgs.length-1].y + botY) / 2, insertBeforeIdx: -1, gapIdx: msgs.length });
        }

        // === ↔ ↕ アイコンの表示制御 ===
        // マウスに最も近い隙間（↔）と最も近い端点（↕）を比較し、より近い方のみを表示する
        
        let closestGap = gaps[0];
        let minDGap = Math.abs(gaps[0].midY - mouseY);
        gaps.forEach(g => { const d = Math.abs(g.midY - mouseY); if (d < minDGap) { minDGap = d; closestGap = g; } });

        let closestMsg = null;
        let closestMsgIdx = -1;
        let minDMsg = Infinity;
        if (msgs.length > 0) {
            closestMsg = msgs[0];
            closestMsgIdx = 0;
            minDMsg = Math.abs(msgs[0].y - mouseY);
            msgs.forEach((msg, idx) => {
                const d = Math.abs(msg.y - mouseY);
                if (d < minDMsg) { minDMsg = d; closestMsg = msg; closestMsgIdx = idx; }
            });
        }

        if (minDGap <= minDMsg) {
            const arrowIcon = this._createHoverIcon(cx, closestGap.midY, 'arrow', closestGap.gapIdx, closestGap.insertBeforeIdx);
            svg.appendChild(arrowIcon);
        } else if (closestMsg) {
            const activateIcon = this._createHoverIcon(cx, closestMsg.y, 'activate', closestMsgIdx, closestMsg.srcLineIdx);
            svg.appendChild(activateIcon);
        }
    },

    _hideLifelineHoverIcons(svg) {
        if (!svg) return;
        svg.querySelectorAll('.mermaid-seq-hover-icon').forEach(el => el.remove());
    },

    /**
     * ホバーアイコン要素を生成する
     * type: 'arrow'（↔青）| 'activate'（↕紫）
     */
    _createHoverIcon(cx, cy, type, gapIdx, insertBeforeIdx) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'mermaid-seq-hover-icon mermaid-sequence-selection-rect');
        g.setAttribute('data-icon-type', type);
        g.setAttribute('data-gap-idx', String(gapIdx));
        g.setAttribute('data-insert-before-idx', String(insertBeforeIdx !== undefined ? insertBeforeIdx : -1));
        g.style.cursor = type === 'arrow' ? 'crosshair' : 'ns-resize';
        g.setAttribute('pointer-events', 'all');

        const color = type === 'arrow' ? '#3b82f6' : '#8b5cf6';
        const r = 8;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', String(cx)); bg.setAttribute('cy', String(cy));
        bg.setAttribute('r', String(r));
        bg.setAttribute('fill', 'rgba(255,255,255,0.92)');
        bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1.5');
        g.appendChild(bg);

        if (type === 'arrow') {
            // ← 左向き三角（外向き）
            const lt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            lt.setAttribute('d', `M${cx-6},${cy} L${cx-2},${cy-3} L${cx-2},${cy+3} Z`);
            lt.setAttribute('fill', color); lt.setAttribute('pointer-events', 'none');
            g.appendChild(lt);
            // → 右向き三角（外向き）
            const rt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            rt.setAttribute('d', `M${cx+6},${cy} L${cx+2},${cy-3} L${cx+2},${cy+3} Z`);
            rt.setAttribute('fill', color); rt.setAttribute('pointer-events', 'none');
            g.appendChild(rt);
        } else {
            // ↑ 上向き三角（外向き）
            const ut = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            ut.setAttribute('d', `M${cx},${cy-5} L${cx-3},${cy-1} L${cx+3},${cy-1} Z`);
            ut.setAttribute('fill', color); ut.setAttribute('pointer-events', 'none');
            g.appendChild(ut);
            // ↓ 下向き三角（外向き）
            const dt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            dt.setAttribute('d', `M${cx},${cy+5} L${cx-3},${cy+1} L${cx+3},${cy+1} Z`);
            dt.setAttribute('fill', color); dt.setAttribute('pointer-events', 'none');
            g.appendChild(dt);
        }
        return g;
    },

    // ============================================================
    // U-turn プレビュー
    // ============================================================

    /**
     * コの字型Uターン矢印プレビューを描画（固定サイズ60px下）
     */
    _drawUTurnPreview(svg, fromX, fromY) {
        svg.querySelectorAll('.mermaid-seq-uturn-preview').forEach(el => el.remove());
        const toY = fromY + 60;
        const offset = 40; // 右側への張り出し量

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'mermaid-seq-uturn-preview');
        path.setAttribute('d', `M${fromX},${fromY} H${fromX+offset} V${toY} H${fromX}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#f59e0b');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '6,4');
        path.setAttribute('pointer-events', 'none');
        svg.appendChild(path);

        // 矢先（左向き）
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        head.setAttribute('class', 'mermaid-seq-uturn-preview');
        head.setAttribute('d', `M${fromX},${toY} L${fromX+10},${toY-5} L${fromX+10},${toY+5} Z`);
        head.setAttribute('fill', '#f59e0b');
        head.setAttribute('pointer-events', 'none');
        svg.appendChild(head);
    },

    // ============================================================
    // activate プレビュー・挿入
    // ============================================================

    /**
     * activate区間のプレビュー（縦の帯）を描画する
     */
    _drawActivatePreview(svg, state) {
        svg.querySelectorAll('.mermaid-seq-activate-preview').forEach(el => el.remove());

        const msgs = state.messages;
        const fromY = msgs[state.fromMsgIdx] ? msgs[state.fromMsgIdx].y : state.fromY;
        const toY   = msgs[state.snapMsgIdx] ? msgs[state.snapMsgIdx].y : state.fromY;
        const cx = state.actorCenterX;
        const y1 = Math.min(fromY, toY);
        const y2 = Math.max(fromY, toY);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'mermaid-seq-activate-preview');
        rect.setAttribute('x', String(cx - 5));
        rect.setAttribute('y', String(y1));
        rect.setAttribute('width', '10');
        rect.setAttribute('height', String(y2 - y1));
        rect.setAttribute('fill', 'rgba(139,92,246,0.25)');
        rect.setAttribute('stroke', '#8b5cf6');
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('pointer-events', 'none');
        svg.appendChild(rect);
    },

    _removeActivatePreview(svg) {
        if (!svg) return;
        svg.querySelectorAll('.mermaid-seq-activate-preview').forEach(el => el.remove());
    },

    /**
     * activate/deactivate をMermaidソースに挿入する
     */
    _addActivation(container, actorIndex, startMsgIdx, endMsgIdx, messages) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        // 常にソース上のIDを取得する（エイリアスではなくIDを使うため）
        const cache = this._lifelineCache;
        let actorId = this._getActorIdByIndex(container, actorIndex, (cache ? cache.actors : []));
        if (!actorId) {
            // フォールバック: キャッシュのSVGテキスト
            actorId = cache && cache.actors[actorIndex] ? cache.actors[actorIndex].text : null;
        }
        if (!actorId) return;

        const startSrcLine = messages[startMsgIdx] ? messages[startMsgIdx].srcLineIdx : -1;
        const endSrcLine   = messages[endMsgIdx]   ? messages[endMsgIdx].srcLineIdx   : -1;
        if (startSrcLine < 0 || endSrcLine < 0) return;

        const editorText = getEditorText();
        const lines = editorText.split('\n');

        // endより後に deactivate を挿入（先に後ろから挿入してインデックスがずれないようにする）
        lines.splice(endSrcLine + 1, 0, `    deactivate ${actorId}`);
        lines.splice(startSrcLine + 1, 0, `    activate ${actorId}`);

        const newText = lines.join('\n');
        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
        setEditorText(newText);
        this._lifelineCache = null;

        if (typeof showToast === 'function') showToast('activateを追加しました', 'success');

        let dataLine = parseInt(container.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = container.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }

        if (typeof render === 'function') {
            setTimeout(() => {
                render();
                setTimeout(() => {
                    if (window.activeMermaidSequenceToolbar && typeof window.activeMermaidSequenceToolbar._restoreEditMode === 'function') {
                        window.activeMermaidSequenceToolbar._lastEditedLine = dataLine;
                        window.activeMermaidSequenceToolbar._restoreEditMode();
                    }
                }, 100);
            }, 50);
        }
    }
};
