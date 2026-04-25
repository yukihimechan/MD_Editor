/**
 * Preview Inline Editing Module
 * Allows users to edit Markdown content directly from the preview pane.
 */

const PreviewInlineEdit = {
    selectedElement: null,
    editTargetElement: null,
    isEditing: false,
    originalDisplay: '',
    
    isFocused: false,
    focusedElement: null,
    lastTabDirection: 1,
    _focusedParent: null, // [NEW] li フォーカス時に背景色を付与する親 ul/ol 要素

    // [NEW] 複数選択関連
    selectedElements: new Set(),
    selectionAnchorElement: null,

    init() {
        if (!DOM.preview) {
            console.error('PreviewInlineEdit: DOM.preview not found');
            return;
        }

        this.bindEvents();
        console.log('PreviewInlineEdit initialized');
    },

    bindEvents() {
        const preview = DOM.preview;

        // シングルクリック（mousedown）によるインライン編集開始
        preview.addEventListener('mousedown', (e) => {
            if (this.isEditing) return;
            if (e.button !== 0) return; // 左クリックのみ

            // リンクや既存のUIアクション、画像リサイズ機能を阻害しない
            if (e.target.closest('a[href], button, input, .drag-handle, .img-resize-wrapper')) return;

            // [NEW] ダミーブロックのクリック判定（末尾への追加用）
            const dummyTarget = e.target.closest('.dummy-tail-block');
            if (dummyTarget) {
                if (this.focusedElement !== dummyTarget) {
                    this.startFocus(dummyTarget);
                } else {
                    this.startEditing(dummyTarget, '', e.clientX, e.clientY);
                }
                return;
            }

            const target = this.getSelectableTarget(e.target);
            if (target) {
                const isMediaBlock = target.classList && (target.classList.contains('svg-external-container') || target.classList.contains('raster-external-container'));
                
                // [NEW] 複数選択の制御（ShiftとCtrl/Cmd）
                if (e.shiftKey) {
                    this.selectRange(this.selectionAnchorElement || this.focusedElement, target);
                    e.preventDefault();
                    return;
                } else if (e.ctrlKey || e.metaKey) {
                    this.toggleSelection(target);
                    e.preventDefault();
                    return;
                }

                // [FIX] Excelのように「まずはフォーカス、既にフォーカスされていれば編集開始」に変更
                if (this.focusedElement !== target || this.selectedElements.size > 1) {
                    this.startFocus(target, true, false); // 単一選択でリセット
                } else {
                    // SVGや画像はテキスト編集モードには入らない
                    if (!isMediaBlock) {
                        this.startEditing(target, '', e.clientX, e.clientY);
                    }
                }
            } else if (this.isEditing) {
                // 明示的な外部クリック時はフォーカスを外れたとみなして保存を実行
                this.saveEditing();
            }
        });

        // Keydown to start editing (when hovering) or save/cancel (when editing)
        document.addEventListener('keydown', (e) => {
            // [FIX] CodeMirrorエディタ内など、プレビュー外の入力フィールド操作時は
            // プレビューのブロックナビゲーションでキーイベントを奪わないように先にチェックする
            const isInputTarget = e.target.tagName === 'INPUT' || 
                                  e.target.tagName === 'TEXTAREA' || 
                                  e.target.isContentEditable;

            if (isInputTarget) {
                // インライン編集中のナビゲーション（両端での移動など）は、プレビュー内での操作時のみ処理
                const inPreview = e.target.closest && e.target.closest('#preview-pane');
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    console.log(`[PreviewEdit][Debug] Ctrl+Enter: isEditing=${this.isEditing}, inPreview=${!!inPreview}, target.tagName=${e.target.tagName}, isContentEditable=${e.target.isContentEditable}`);
                }
                if (this.isEditing && inPreview) {
                    if (e.key === 'Escape') {
                        console.log('[PreviewEdit] Escape inside isInputTarget');
                        e.preventDefault();
                        this.cancelEditing();
                        return;
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        console.log('[PreviewEdit] Ctrl+Enter inside isInputTarget');
                        e.preventDefault();
                        this.saveEditing();
                        return;
                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
                        // [FIX] スラッシュコマンドメニューが開いているときは矢印キーをここで横取りしない
                        // (SlashCommandPreview.handleKeyDown が editTargetElement のkeydownで既に処理済み)
                        if (!(window.SlashCommandPreview && window.SlashCommandPreview.isActive)) {
                            this.handleNavigationInEdit(e);
                        }
                    }
                }
                return; // ここから下は非入力要素向けのショートカット処理なのでスキップ
            }

            // フォーカスモードにおけるプレビュー専用のキーボードナビゲーション
            if (!this.isEditing && this.isFocused && this.focusedElement) {
                // スラッシュコマンドメニューが開いているときは、キーをメニュー側に優先して渡す
                if (window.SlashCommandPreview && window.SlashCommandPreview.isActive) {
                    if (window.SlashCommandPreview.handleKeyDown(e)) {
                        return; // メニューが処理済み（↑↓Enter/Esc） → フォーカス移動等はスキップ
                    }
                    // 絞り込みのための文字入力処理
                    if (e.key === 'Backspace') {
                        e.preventDefault();
                        if (!this._focusModeFilterText) this._focusModeFilterText = '';
                        this._focusModeFilterText = this._focusModeFilterText.slice(0, -1);
                        window.SlashCommandPreview.filter(this._focusModeFilterText);
                    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        e.preventDefault();
                        if (!this._focusModeFilterText) this._focusModeFilterText = '';
                        this._focusModeFilterText += e.key;
                        window.SlashCommandPreview.filter(this._focusModeFilterText);
                    }
                    return; // いずれの場合もフォーカス移動は行わない
                }

                if (e.key === ' ' && this.focusedElement.tagName.match(/^H[1-6]$/i)) {
                    e.preventDefault(); // デフォルトのスクロール動作を防止
                    if (typeof toggleHeading === 'function') {
                        toggleHeading(this.focusedElement);
                    }
                    return;
                } else if (e.key === 'F2' || e.key === 'Enter') {
                    // スラッシュコマンド実行中（またはメニュー表示中）のEnterを誤処理しない
                    if (this.isSlashCommandExecuting) return;
                    if (e.key === 'Enter' && window.SlashCommandPreview && window.SlashCommandPreview.isActive) return;
                    e.preventDefault();
                    this.startEditing(this.focusedElement, '', null, null, true); // true = selectAll
                    return;
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    this.moveFocus(e.shiftKey ? -1 : 1, true); // true = headings only
                    return;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    const direction = e.key === 'ArrowLeft' ? -1 : 1;
                    if (this.focusedElement.tagName.match(/^H[1-6]$/i)) {
                        e.preventDefault();
                        this._handleHeadingLevelChange(direction);
                        return;
                    } else if (this.focusedElement.tagName === 'LI' || 
                               (this.focusedElement.classList && this.focusedElement.classList.contains('li-text-wrapper')) ||
                               this.focusedElement.closest('li')) {
                        e.preventDefault();
                        this._handleListIndentChange(direction);
                        return;
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveFocus(-1, false, e.shiftKey);
                    return;
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveFocus(1, false, e.shiftKey);
                    return;
                } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.selectAll();
                    return;
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    // [NEW] Delete / Backspace キーで選択されている要素を削除
                    e.preventDefault();
                    this.deleteBlock();
                    return;
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.clearFocus();
                    return;
                }
            }


            // [FIX] isInputTarget == false（例えばBODYにフォーカスが抜けた状態）でも
            // 編集中であれば Escape / Ctrl+Enter を受け付ける救済措置
            if (this.isEditing && this.editTargetElement) {
                if (e.key === 'Escape') {
                    console.log('[PreviewEdit] Escape outside isInputTarget (Fallback)');
                    e.preventDefault();
                    this.cancelEditing();
                    return;
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    console.log('[PreviewEdit] Ctrl+Enter outside isInputTarget (Fallback)');
                    e.preventDefault();
                    this.saveEditing();
                    return;
                }
            }

            // (削除: Ctrl+Enter / Escape の処理は isInputTarget 内に移動しました)

            // [FIX] フォーカスモード中に「/」を押した場合のみ、スラッシュコマンドメニューを表示する
            // 編集状態にはせず、フォーカス行の左端にメニューを表示し、次行に挿入する
            if (!this.isEditing && e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const focusEl = this.isFocused ? this.focusedElement : null;
                if (focusEl && window.SlashCommandPreview) {
                    e.preventDefault();
                    // フォーカス行の位置にメニューを表示
                    this._focusModeInsertSource = focusEl;
                    this._focusModeFilterText = ''; // 絞り込みテキストをリセット
                    const rect = focusEl.getBoundingClientRect();
                    const previewEl = DOM.preview;
                    const previewRect = previewEl ? previewEl.getBoundingClientRect() : { left: 0 };
                    window.SlashCommandPreview.show(previewRect.left, rect.bottom + window.scrollY);
                    window.SlashCommandPreview.filter('');
                }
            }
        });
    },

    // [NEW] レンダリング完了後に呼び出される（フォーカス復帰処理）
    restoreFocusIfNeeded() {
        // [FIX] 再レンダリングが複数回走っても消えないように、focusedLineIndex をメインで使う
        const targetLine = this.restoreFocusLine !== null ? this.restoreFocusLine : this.focusedLineIndex;
        if (targetLine !== null && !this.isEditing) {
            const elements = Array.from(DOM.preview.querySelectorAll('[data-line]'));
            const focusableSelectors = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, .code-block-wrapper, table, .dummy-tail-block, .image-caption'.split(',').map(s => s.trim());
            
            // isFocusable 関数を追加し、編集可能な要素のみを対象とする
            const isFocusable = (el) => focusableSelectors.some(selector => el.matches(selector));

            let targetElement = elements.find(el => isFocusable(el) && parseInt(el.getAttribute('data-line')) >= targetLine);

            // [NEW] スラッシュコマンド由来によるレンダリング後の「即時編集モード突入」
            if (this.pendingActionType) {
                const { type, isBlockLevel, startLineIndex, newBlockText, targetLineIndex } = this.pendingActionType;
                
                // 挿入処理直後は、事前に targetLine ベースで見つけた「挿入元の要素」ではなく、
                // これから探す「新しく挿入された要素」にフォーカスを当てるべきなのでリセットする
                targetElement = null;
                
                // 段落・見出し・リスト等の「テキストが空の状態で挿入された要素」には、目印として \u200B が含まれているので最優先で探し出す
                if (type === 'insert-text-block' || type === 'insert') {
                    const candidates = elements.filter(el => isFocusable(el) && el.textContent.includes('\u200B'));
                    if (candidates.length > 0) {
                        // 対象が複数残っている場合を考慮し、文書の後ろの要素付近にあるであろう最新のものを選ぶ
                        targetElement = candidates[candidates.length - 1];
                    }
                }

                if (!targetElement) {
                    if (targetLineIndex !== undefined) {
                        targetElement = elements.find(el => isFocusable(el) && parseInt(el.getAttribute('data-line')) >= targetLineIndex);
                    } else if (!isBlockLevel) {
                        targetElement = elements.find(el => isFocusable(el) && parseInt(el.getAttribute('data-line')) >= startLineIndex + 1);
                    } else {
                        const insertedLinesCount = newBlockText.split('\n').length;
                        const nextLineIndex = startLineIndex + insertedLinesCount;
                        targetElement = elements.find(el => isFocusable(el) && parseInt(el.getAttribute('data-line')) >= nextLineIndex);
                    }
                }
                
                if (targetElement) {
                    this.startFocus(targetElement, false);
                    setTimeout(() => { this.startEditing(targetElement, ''); }, 50);
                }
                this.pendingActionType = null;
                this.restoreFocusLine = null;
                return;
            }

            if (targetElement && targetElement !== this.focusedElement) {
                // エディタからの逆同期ループを起こさないように false を渡す
                this.startFocus(targetElement, false);
            }
            this.restoreFocusLine = null; // 一度復元したら予約用フラグは消す
        }
    },

    // [NEW] Focus Mode Management
    startFocus(element, syncToEditor = true, keepSelection = false) {
        if (!keepSelection) {
            this.clearSelection();
        } else {
            this.clearFocus();
        }
        
        if (this.isEditing) {
            this.saveEditing();
        }

        this.isFocused = true;
        
        let dataLineEl = element;
        if (element.classList && element.classList.contains('li-text-wrapper')) {
            dataLineEl = element.closest('li') || element;
        }

        // [FIX] Convert LI to wrapper if available
        if (element.tagName === 'LI') {
            const wrapper = element.querySelector('.li-text-wrapper');
            if (wrapper) element = wrapper;
        }

        this.focusedElement = element;

        if (!dataLineEl.hasAttribute('data-line') && element.closest('[data-line]')) {
            dataLineEl = element.closest('[data-line]');
        }
        
        this.focusedLineIndex = parseInt(dataLineEl.getAttribute('data-line')); // [FIX] フォーカスされた行を永続記録
        if (this.focusedElement) {
            this.focusedElement.classList.add('preview-focused');
        }

        if (!keepSelection) {
            this.selectedElements.add(this.focusedElement);
            this.selectionAnchorElement = this.focusedElement;
        }

        // [NEW] li 要素にフォーカスした場合、親 ul/ol に背景色クラスを付与する
        // （破線枠は li 1行のみ、背景色は同じ段落ブロック全体に見せるため）
        let liElement = element;
        if (element.classList && element.classList.contains('li-text-wrapper')) {
            liElement = element.closest('li');
        }
        if (liElement && liElement.tagName === 'LI') {
            const parent = liElement.parentElement;
            if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL')) {
                parent.classList.add('preview-focused-parent');
                this._focusedParent = parent;
            }
        }
        
        // 画面内にスクロール
        this.focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // [FIX] エディタへカーソル位置を強制同期するかどうかを引数で確実に制御しループ（エラー）を防止
        if (syncToEditor && !window._previewFocusingSuppressed) {
            const lineStr = element.getAttribute('data-line');
            const lineNum = parseInt(lineStr, 10);
            if (!isNaN(lineNum) && typeof editorView !== 'undefined' && editorView) {
                try {
                    const doc = editorView.state.doc;
                    if (lineNum >= 1 && lineNum <= doc.lines) {
                        const lineInfo = doc.line(lineNum);
                        // フォーカスは奪わず、カーソル位置のみ更新
                        window._previewFocusingSuppressed = true;
                        editorView.dispatch({ selection: { anchor: lineInfo.from } });
                        setTimeout(() => { window._previewFocusingSuppressed = false; }, 200);
                    }
                } catch (e) { /* 位置解決に失敗しても無視 */ }
            }
        }
    },


    clearFocus() {
        if (this.focusedElement) {
            this.focusedElement.classList.remove('preview-focused');
        }
        // [NEW] li フォーカス時に付与した親要素の背景色クラスもクリアする
        if (this._focusedParent) {
            this._focusedParent.classList.remove('preview-focused-parent');
            this._focusedParent = null;
        }
        this.isFocused = false;
        this.focusedElement = null;
        this.focusedLineIndex = null;
    },

    // [NEW] 複数選択状態をすべてクリア
    clearSelection() {
        if (this.selectedElements) {
            this.selectedElements.forEach(el => {
                if (el.classList) el.classList.remove('preview-selected-element');
            });
            this.selectedElements.clear();
        }
        this.selectionAnchorElement = null;
        this.clearFocus();
    },

    // [NEW] 複数選択：要素のトグル（Ctrl / Cmd + Click 用）
    toggleSelection(element) {
        if (!element) return;
        if (this.selectedElements.has(element)) {
            // 選択解除
            this.selectedElements.delete(element);
            if (element.classList) element.classList.remove('preview-selected-element');
            
            // フォーカス対象だった場合はフォーカスを外す
            if (this.focusedElement === element) {
                element.classList.remove('preview-focused');
                this.focusedElement = null;
                this.isFocused = this.selectedElements.size > 0;
            }
        } else {
            // 選択追加
            this.selectedElements.add(element);
            if (element.classList) element.classList.add('preview-selected-element');
            this.selectionAnchorElement = element;
            
            // 何もフォーカスされていなければメインフォーカスにする
            if (!this.focusedElement) {
                this.startFocus(element, true, true);
            }
        }
    },

    // [NEW] 複数選択：範囲選択（Shift + Click 用）
    selectRange(anchor, target) {
        if (!anchor || !target) return;
        
        const focusableElements = this.getFocusableElements();
        
        let anchorMatch = anchor;
        if (anchor.classList && anchor.classList.contains('li-text-wrapper')) anchorMatch = anchor.closest('li');
        
        let targetMatch = target;
        if (target.classList && target.classList.contains('li-text-wrapper')) targetMatch = target.closest('li');
        
        const anchorIndex = focusableElements.indexOf(anchorMatch);
        const targetIndex = focusableElements.indexOf(targetMatch);
        
        if (anchorIndex === -1 || targetIndex === -1) {
            this.toggleSelection(target);
            return;
        }
        
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        
        this.clearSelection();
        
        for (let i = start; i <= end; i++) {
            const el = focusableElements[i];
            let selectTarget = el;
            if (el.tagName === 'LI') {
                const wrapper = el.querySelector('.li-text-wrapper');
                if (wrapper) selectTarget = wrapper;
            }
            this.selectedElements.add(selectTarget);
            if (selectTarget.classList) selectTarget.classList.add('preview-selected-element');
        }
        
        this.selectionAnchorElement = anchor;
        this.startFocus(target, true, true);
    },

    // [NEW] 複数選択：全選択（Ctrl + A 用）
    selectAll() {
        const focusableElements = this.getFocusableElements();
        
        this.clearSelection();
        if (focusableElements.length === 0) return;
        
        focusableElements.forEach(el => {
            let selectTarget = el;
            if (el.tagName === 'LI') {
                const wrapper = el.querySelector('.li-text-wrapper');
                if (wrapper) selectTarget = wrapper;
            }
            this.selectedElements.add(selectTarget);
            if (selectTarget.classList) selectTarget.classList.add('preview-selected-element');
        });
        
        let firstTarget = focusableElements[0];
        if (firstTarget.tagName === 'LI') {
            const wrapper = firstTarget.querySelector('.li-text-wrapper');
            if (wrapper) firstTarget = wrapper;
        }
        
        let lastTarget = focusableElements[focusableElements.length - 1];
        if (lastTarget.tagName === 'LI') {
            const wrapper = lastTarget.querySelector('.li-text-wrapper');
            if (wrapper) lastTarget = wrapper;
        }
        
        this.selectionAnchorElement = firstTarget;
        this.startFocus(lastTarget, false, true);
    },

    getFocusableElements(headingsOnly = false) {
        const selectors = headingsOnly 
            ? 'h1, h2, h3, h4, h5, h6' 
            : 'h1, h2, h3, h4, h5, h6, p, li, blockquote, .code-block-wrapper, table, .dummy-tail-block, .image-caption';
        return Array.from(DOM.preview.querySelectorAll(selectors)).filter(el => {
            // 折りたたまれて非表示になっている要素はフォーカス移動の対象外とする
            if (el.classList.contains('collapsed-content') || el.closest('.collapsed-content')) {
                return false;
            }
            if (el.closest('details:not([open])')) {
                return false;
            }
            return true;
        });
    },

    moveFocus(direction, headingsOnly = false, expandSelection = false) {
        if (!this.focusedElement) return;
        
        const allElements = this.getFocusableElements(headingsOnly);
        
        let currentFocusMatch = this.focusedElement;
        if (this.focusedElement && this.focusedElement.classList && this.focusedElement.classList.contains('li-text-wrapper')) {
            currentFocusMatch = this.focusedElement.closest('li');
        }

        const currentIndex = allElements.indexOf(currentFocusMatch);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex + direction;
        while (nextIndex >= 0 && nextIndex < allElements.length) {
            const el = allElements[nextIndex];
            if (!headingsOnly || el.tagName.match(/^H[1-6]$/i)) {
                // If it's an LI, target the wrapper
                let target = el;
                if (el.tagName === 'LI') {
                    const wrapper = el.querySelector('.li-text-wrapper');
                    if (wrapper) target = wrapper;
                }
                
                // [NEW] Shiftキーが押下されている場合は範囲選択に拡張する
                if (expandSelection) {
                    this.selectRange(this.selectionAnchorElement || this.focusedElement, target);
                } else {
                    this.startFocus(target, true, false);
                }
                return;
            }
            nextIndex += direction;
        }
    },
    
    // [NEW] インライン編集中にカーソル位置に応じて矢印/Tabキーで他要素へ移動するためのハンドラ
    handleNavigationInEdit(e) {
        // [FIX] スラッシュコマンドメニューが開いているときはナビゲーションを行わない
        if (window.SlashCommandPreview && window.SlashCommandPreview.isActive) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            this.lastTabDirection = e.shiftKey ? -1 : 1;
            // 保存後にフォーカスモードで次の(見出し)要素へ移動させる予約
            this._prepareFocusMoveAfterSave(this.lastTabDirection, true);
            this.saveEditing();
            return;
        }

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        
        const range = sel.getRangeAt(0);
        const elementText = this.editTargetElement.textContent || "";
        
        // 端にいるかどうかを正確に調べる（選択範囲がなく、かつ要素全体の本当の先頭/末尾か）
        let isVeryStart = false;
        let isVeryEnd = false;
        
        if (range.collapsed) {
            const getVisibleContentInfo = (r) => {
                const fragment = r.cloneContents();
                const rawText = fragment.textContent;
                const filteredText = rawText.replace(/[\n\r\t\u200B]/g, '');
                const elements = Array.from(fragment.querySelectorAll('*')).map(el => el.tagName);
                
                let hasVisible = false;
                if (filteredText.length > 0) hasVisible = true;
                if (elements.length > 0) hasVisible = true;
                
                return {
                    rawTextLength: rawText.length,
                    rawTextDisplay: JSON.stringify(rawText),
                    filteredTextLength: filteredText.length,
                    filteredTextDisplay: JSON.stringify(filteredText),
                    elements: elements,
                    hasVisible: hasVisible
                };
            };

            const preRange = document.createRange();
            preRange.selectNodeContents(this.editTargetElement);
            preRange.setEnd(range.startContainer, range.startOffset);
            const preInfo = getVisibleContentInfo(preRange);
            isVeryStart = !preInfo.hasVisible;
            
            const postRange = document.createRange();
            postRange.selectNodeContents(this.editTargetElement);
            postRange.setStart(range.endContainer, range.endOffset);
        }
        
        if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && isVeryStart) {
            e.preventDefault();
            this._prepareFocusMoveAfterSave(-1, false);
            this.saveEditing();
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && isVeryEnd) {
            e.preventDefault();
            this._prepareFocusMoveAfterSave(1, false);
            this.saveEditing();
        }
    },

    _prepareFocusMoveAfterSave(direction, headingsOnly) {
        const allElements = this.getFocusableElements(false);
        
        let currentTarget = this.focusedElement || this.editTargetElement;
        if (currentTarget) {
            if (currentTarget.classList && currentTarget.classList.contains('li-text-wrapper')) {
                currentTarget = currentTarget.closest('li') || currentTarget;
            } else if (currentTarget.classList && currentTarget.classList.contains('task-list-item-text-wrapper')) {
                currentTarget = currentTarget.closest('li') || currentTarget;
            }
        }
        
        const currentIndex = allElements.indexOf(currentTarget);
        if (currentIndex === -1) {
            return;
        }

        let nextIndex = currentIndex + direction;
        while (nextIndex >= 0 && nextIndex < allElements.length) {
            const el = allElements[nextIndex];
            if (!headingsOnly || el.tagName.match(/^H[1-6]$/i)) {
                const targetList = this.getFocusableElements(headingsOnly);
                this._pendingNextFocusIndex = targetList.indexOf(el);
                this._pendingNextFocusHeadingsOnly = headingsOnly;
                return;
            }
            nextIndex += direction;
        }
    },

    getSelectableTarget(element) {
        // Define selectable text elements
        // Valid tags for standard block selection (Tables and code blocks handled explicitly)
        const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TABLE', 'PRE'];

        // Traverse up to find a valid container
        let target = element;

        // [FIX] Click on the wrapper itself
        if (target && target.classList && target.classList.contains('li-text-wrapper')) {
            return target;
        }

        while (target && target !== DOM.preview) {
            // [NEW] Allow selection of code block wrapper as well as image/svg containers
            if (validTags.includes(target.tagName) || 
                (target.classList && (
                    target.classList.contains('code-block-wrapper') || 
                    target.classList.contains('svg-external-container') || 
                    target.classList.contains('raster-external-container')
                ))) {
                
                // Exclude if inside an existing editor, or clicking on action buttons
                if (target.closest('.inline-editor-wrapper') ||
                    target.closest('button')) return null;
                
                // [NEW] Intercept LI and return its text wrapper if available
                if (target.tagName === 'LI') {
                    const wrapper = target.querySelector('.li-text-wrapper');
                    if (wrapper) return wrapper;
                }
                return target;
            }
            target = target.parentElement;
        }
        return null;
    },

    startEditing(element, initialChar = '', clientX = null, clientY = null, selectAll = false) {
        if (this.isEditing) return;

        // [FIX] テーブルやコードブロック 등、インライン編集できない要素は編集処理に進めず、readonlyな「フォーカス（選択）」状態に留める
        if (element.tagName === 'TABLE' || element.tagName === 'PRE' || (element.classList && element.classList.contains('code-block-wrapper'))) {
            return;
        }

        this.selectedElement = element;
        this.isEditing = true;
        this.originalHtml = element.innerHTML;
        this.originalDisplay = element.style.display;
        this.isDummyBlock = element.classList.contains('dummy-tail-block');

        // 編集の邪魔になる（ホバー時に改行バグやフォーカス阻害を引き起こす）drag-handleを要素内から削除
        const dragHandles = element.querySelectorAll('.drag-handle');
        dragHandles.forEach(handle => handle.remove());

        // 1. マッピング用情報の取得
        if (!this.isDummyBlock) {
            const currentText = element.textContent;
            let checkTagName = element.tagName;
            if (element.classList && element.classList.contains('li-text-wrapper')) {
                checkTagName = 'LI';
            }
            this.currentSourceInfo = this.findSourceLocation(currentText, checkTagName, element);

            if (!this.currentSourceInfo) {
                console.warn('Could not map preview element to source.');
                if (typeof showToast === 'function') showToast("編集箇所の特定に失敗しました", "error");
                this.cancelEditing();
                return;
            }
        } else {
            // [FIX] ダミーブロックの場合は確実にリセットし、過去の情報を引き継いで誤って上書きするのを防ぐ
            this.currentSourceInfo = null;
        }

        // 2. DOMの contenteditable 化
        let editTarget = element;

        // タスクリストの場合、チェックボックス以外の内容をラップして編集対象に限定する
        const parentLi = element.closest('li');
        let isTaskListItem = parentLi && parentLi.classList.contains('task-list-item');
        
        if (isTaskListItem) {
            const checkbox = parentLi.querySelector('input[type="checkbox"]');
            if (checkbox) {
                let wrapper = element; // We already have .li-text-wrapper as our element
                if (element.tagName === 'LI') {
                    // Fallback just in case element is the LI itself
                    wrapper = element.querySelector('.li-text-wrapper') || element.querySelector('.task-list-item-text-wrapper');
                }
                
                if (!wrapper || wrapper === element && element.tagName === 'LI') {
                    wrapper = document.createElement('span');
                    wrapper.className = 'task-list-item-text-wrapper';
                    
                    let nextNode = checkbox.nextSibling;
                    while (nextNode) {
                        const current = nextNode;
                        nextNode = nextNode.nextSibling;
                        wrapper.appendChild(current);
                    }
                    element.appendChild(wrapper);
                }
                
                // チェックボックスとテキスト入力欄を横並びにするためflexboxを適用
                this._taskListOriginalDisplay = parentLi.style.display || '';
                parentLi.style.display = 'flex';
                parentLi.style.alignItems = 'center';
                // wrapperはflex itemとして横幅いっぱいに広がる
                wrapper.style.flex = '1';
                wrapper.style.minWidth = '50px';
                
                editTarget = wrapper;
            }
        }

        if (this.isDummyBlock) {
            // ダミーブロックは確実にゼロ幅スペースのみにしておき、CSS擬似要素を消す
            editTarget.textContent = '\u200B';
        } else if (editTarget.textContent.replace(/\u200B/g, '').trim() === '') {
            editTarget.innerHTML = '\u200B';
        }

        editTarget.setAttribute('contenteditable', 'true');
        editTarget.classList.add('inline-editing-active');
        this.editTargetElement = editTarget;
        
        if (this.selectedElement && editTarget !== this.selectedElement) {
            this.selectedElement.classList.remove('preview-focused');
        }

        // setTimeout を使って確実にフォーカスとキャレットを当てる
        setTimeout(() => {
            // すでに編集がキャンセルされていたら何もしない
            if (!this.isEditing) return;

            this.editTargetElement.focus();

            // 3. クリック位置にキャレットを設定（マウスからの起動時）、または末尾に設定
            if (this.isDummyBlock) {
                const selection = window.getSelection();
                const range = document.createRange();
                
                // [FIX] スラッシュコマンド（テキストノード前提）を動作させるため、
                // 確実にテキストノードにキャレットが合うように設定する。
                let textNode = this.editTargetElement.lastChild;
                if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
                    textNode = document.createTextNode('\u200B');
                    this.editTargetElement.appendChild(textNode);
                }
                range.setStart(textNode, textNode.textContent.length);
                range.collapse(true);
                // [FIX] DOMから切り離されていた場合（render後の古い要素など）は addRange をスキップ
                if (this.editTargetElement.isConnected) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            } else if (clientX !== null && clientY !== null) {
                let range = null;
                if (document.caretRangeFromPoint) {
                    range = document.caretRangeFromPoint(clientX, clientY);
                } else if (document.caretPositionFromPoint) {
                    const pos = document.caretPositionFromPoint(clientX, clientY);
                    if (pos) {
                        range = document.createRange();
                        range.setStart(pos.offsetNode, pos.offset);
                        range.collapse(true);
                    }
                }
                if (range) {
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                } else {
                    const selection = window.getSelection();
                    range = document.createRange();
                    range.selectNodeContents(this.editTargetElement);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            } else if (selectAll) {
                // [NEW] F2キー等で起動した場合、要素内の文字列を全選択する
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(this.editTargetElement);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(this.editTargetElement);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }

            // 4. 入力された文字がある場合 (直接タイピング開始) の挿入処理を、キャレット設定後に実行
            if (initialChar) {
                try {
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        const textNode = document.createTextNode(initialChar);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.setEndAfter(textNode);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        
                        // [FIX] 文字挿入直後はレイアウト未完のため getBoundingClientRect() が (0,0) になる。
                        // rAF で 1 フレーム待ってからスラッシュコマンドをチェックする。
                        if (typeof this.checkSlashCommand === 'function') {
                            requestAnimationFrame(() => {
                                if (this.isEditing) this.checkSlashCommand();
                            });
                        }
                    }
                } catch(e) {
                    console.warn('[PreviewInlineEdit] initialChar insertion failed', e);
                }
            }
        }, 0);

        // 4. イベントリスナーの設定
        this.boundKeydown = this.handleKeydown.bind(this);
        this.boundBlur = this.handleBlur.bind(this);
        this.boundInput = (e) => {
            // 文字が完全に消えた（またはブラウザの自動<br>だけ残った）場合に、キャレット維持のための文字を復活させる
            const html = this.editTargetElement.innerHTML;
            if (html === '' || html === '<br>') {
                this.editTargetElement.innerHTML = '\u200B';
                
                // 再度末尾にキャレットをセット
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(this.editTargetElement);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        };

        this.editTargetElement.addEventListener('keydown', this.boundKeydown);
        this.editTargetElement.addEventListener('blur', this.boundBlur);
        this.editTargetElement.addEventListener('input', this.boundInput);

        // 文字選択時（mouseup, keyup）にミニツールバーを表示するイベント
        this.boundSelectionChange = () => {
            setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0 || sel.isCollapsed || sel.toString().trim() === '') {
                    if (typeof TableEditor !== 'undefined' && typeof TableEditor.hideMiniToolbar === 'function') {
                        TableEditor.hideMiniToolbar();
                    }
                    return;
                }
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                if (typeof TableEditor !== 'undefined' && typeof TableEditor.showMiniToolbar === 'function') {
                    TableEditor.showMiniToolbar(rect);
                }
            }, 10);
        };
        this.editTargetElement.addEventListener('mouseup', this.boundSelectionChange);
        this.editTargetElement.addEventListener('keyup', this.boundSelectionChange);

        // [NEW] Slash Command Detection on Input/Keyup
        this.boundKeyup = (e) => {
            if (!window.SlashCommandPreview) return;
            
            // 矢印キー上下やEnter、F2は handleKeydown 等で処理済みまたは無視
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Escape' || e.key === 'F2') return;

            this.checkSlashCommand();
        };
        this.editTargetElement.addEventListener('keyup', this.boundKeyup);
    },

    checkSlashCommand() {
        if (!window.SlashCommandPreview) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
            window.SlashCommandPreview.hide();
            return;
        }
        
        let range = sel.getRangeAt(0);
        let textNode = range.startContainer;
        let offset = range.startOffset;

        // Elementが選択されている場合は、直前のTextNodeに解決する
        if (textNode.nodeType === Node.ELEMENT_NODE) {
            if (textNode.childNodes.length > 0) {
                // offsetが0〜childNodes.lengthの範囲を取る
                let targetIndex = offset > 0 ? offset - 1 : 0;
                let child = textNode.childNodes[targetIndex];
                
                // 余分なB等のタグの中なら再帰的にテキストを探す
                // [FIX] 空要素ノード（<b></b>等）の場合、lastChild が TEXT_NODE でない可能性がある
                while (child && child.lastChild) {
                    child = child.lastChild;
                }
                
                // [FIX] lastChild 探索の結果がテキストノードでなかった場合、
                // 兄弟ノードを遡って実際のテキストノードを探すフォールバック処理
                if (child && child.nodeType !== Node.TEXT_NODE) {
                    let fallback = child;
                    while (fallback && fallback.nodeType !== Node.TEXT_NODE) {
                        fallback = fallback.previousSibling;
                    }
                    if (!fallback) {
                        // 兄弟に見つからなければ親の直前兄弟から探す
                        let parentSibling = child.parentElement ? child.parentElement.previousSibling : null;
                        while (parentSibling && parentSibling.nodeType !== Node.TEXT_NODE) {
                            parentSibling = parentSibling.previousSibling;
                        }
                        fallback = parentSibling;
                    }
                    child = fallback;
                }
                
                if (child && child.nodeType === Node.TEXT_NODE) {
                    textNode = child;
                    offset = textNode.textContent.length;
                    
                    // ※ 不要なセレクション再設定（キャレット補正）を削除
                    // これにより Shift+Enter などのDOM変更時にキャレットが直前へ引き戻されるバグを防止します。
                }
            }
        }
        
        if (textNode.nodeType === Node.TEXT_NODE) {
            const textToCaret = textNode.textContent.substring(0, offset);
            const match = textToCaret.match(/[\/；][^\s]*$/);
            
            let isValidTrigger = false;
            if (match) {
                const index = match.index;
                if (index === 0) isValidTrigger = true;
                // eslint-disable-next-line no-irregular-whitespace
                else if (textToCaret.charAt(index - 1).match(/\s|　|\n|\u200B/)) isValidTrigger = true;
            }

            if (isValidTrigger && match) {
                const keyword = match[0].substring(1);
                console.log(`[PreviewInlineEdit] Slash command trigger detected! keyword='${keyword}'`);
                const rect = range.getBoundingClientRect();
                
                const triggerRange = document.createRange();
                triggerRange.setStart(textNode, match.index);
                triggerRange.setEnd(textNode, match.index + match[0].length);
                
                window.SlashCommandPreview.show(rect.left, rect.bottom, triggerRange);
                window.SlashCommandPreview.filter(keyword);
            } else {
                if (window.SlashCommandPreview.isActive) {
                    console.log(`[PreviewInlineEdit] Trigger condition no longer met. Hiding.`);
                }
                window.SlashCommandPreview.hide();
            }
        } else {
            if (window.SlashCommandPreview && window.SlashCommandPreview.isActive) {
                window.SlashCommandPreview.hide();
            }
        }
    },

    handleKeydown(e) {
        // [NEW] Slash Command Hook
        if (window.SlashCommandPreview && window.SlashCommandPreview.isActive) {
            if (window.SlashCommandPreview.handleKeyDown(e)) {
                return;
            }
        }

        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            console.log(`[PreviewEdit][Debug] handleKeydown Ctrl+Enter: isEditing=${this.isEditing}`);
        }

        let editTagName = this.selectedElement.tagName;
        if (this.selectedElement.classList && (this.selectedElement.classList.contains('li-text-wrapper') || this.selectedElement.classList.contains('task-list-item-text-wrapper'))) {
            editTagName = 'LI';
        } else if (this.selectedElement.closest('blockquote')) {
            // [FIX] P要素であっても、blockquote内であれば BLOCKQUOTE として扱う
            editTagName = 'BLOCKQUOTE';
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelEditing();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            this.saveEditing();
        } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();

            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                range.deleteContents(); // 選択されているテキストがあれば削除

                const br = document.createElement('br');
                const textNode = document.createTextNode('\u200B'); // キャレット維持用のゼロ幅スペース

                // 逆順に挿入することで <br> -> \u200B の順になる
                range.insertNode(textNode);
                range.insertNode(br);

                // ゼロ幅スペースの後ろにカーソルを合わせる
                range.setStart(textNode, 1);
                range.collapse(true);

                sel.removeAllRanges();
                sel.addRange(range);
            }
        } else if (e.key === 'Enter' && !e.shiftKey) {
            // [FIX] キャレット位置でテキストを分割し、要素に応じたアクションを予約する
            if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'].includes(editTagName)) {
                e.preventDefault();
                e.stopPropagation();

                // キャレット位置に分割用の目印（マーカー）を挿入する
                const sel = window.getSelection();
                const marker = "\uE000ENTER\uE001";
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.insertNode(document.createTextNode(marker));
                } else {
                    if (this.editTargetElement) {
                        this.editTargetElement.appendChild(document.createTextNode(marker));
                    }
                }

                this.enterAction = 'split';
                this.saveEditing();
            }
        }
    },

    handleBlur(e) {
        // ミニツールバーのクリック等によるblurだった場合はキャンセルしない
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.mini-format-toolbar')) {
            return;
        }

        // スラッシュコマンド（プレビュー）メニューのクリックによるblurだった場合もキャンセルしない
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.slash-command-preview')) {
            return;
        }

        // [FIX] renderにより DOM から切り離された要素での blur は無視する
        // （render による無意圖な編集キャンセルを防ぐ）
        if (this.editTargetElement && !this.editTargetElement.isConnected) {
            return;
        }

        // もし現在スラッシュコマンドメニューが開いている状態であれば、blurによる保存を阻害する
        if (typeof window.SlashCommandPreview !== 'undefined' && window.SlashCommandPreview.isActive) {
            return;
        }

        // 既にスラッシュコマンドの適用処理が開始されている場合も阻害
        if (this.isSlashCommandExecuting) {
            return;
        }

        // 遅延を入れてボタンクリック等との競合を防ぐ
        setTimeout(() => {
            if (this.isEditing) {
                if (typeof window.SlashCommandPreview !== 'undefined' && window.SlashCommandPreview.isActive) return;
                if (this.isSlashCommandExecuting) return; // 実行中なら抜ける
                if (this.editTargetElement && !this.editTargetElement.isConnected) return; // DOMから切り離された場合
                this.saveEditing();
            }
        }, 150);
    },

    /**
     * DOMから取得したHTML文字列をMarkdown記法へ変換する
     */
    convertHtmlToMarkdown(htmlContent) {
        // [FIX] 改行が消えてしまう問題を修正。
        // これまで見えない改行(\n)を全て削除していたため、既存のテキスト内の改行が保存時に消滅していました。
        let text = htmlContent.replace(/\r/g, "");

        // drag-handle (D&D用マーカー) が混入した場合は消去する
        text = text.replace(/<div(?:[^>]*\s+)?class="[^"]*drag-handle[^"]*"[^>]*>.*?<\/div>/gi, "");
        // <b> / <strong> to **
        text = text.replace(/<(b|strong)[^>]*>(.*?)<\/\1>/gi, "**$2**");
        // <i> / <em> to *
        text = text.replace(/<(i|em)[^>]*>(.*?)<\/\1>/gi, "*$2*");
        // <s> / <del> to ~~
        text = text.replace(/<(s|del)[^>]*>(.*?)<\/\1>/gi, "~~$2~~");
        // <code> to `
        text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
        
        // <div>...</div> などのブロック要素による改行をMarkdownの改行コードに変換
        // chromeが生成する <div> を検知する。先頭のdivによる余分な改行を防ぐ
        text = text.replace(/^<div(?:[^>]*)>/i, "");
        text = text.replace(/<div(?:[^>]*)>/gi, "\n");
        text = text.replace(/<\/div>/gi, ""); // 閉じタグは単に除去

        // <br> to newline (Markdown のハードブレークとして保存するため、半角スペース2つ付きの改行にする)
        text = text.replace(/<br\s*\/?>/gi, "  \n");
        // その他のタグを削除して生テキストだけ残す
        text = text.replace(/<[^>]+>/g, "");

        // エンティティアンスケープ
        text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
        
        // 取得したテキストの前後の改行コードのみを削除し、不要な空行が挿入されるのを防ぐ
        return text.replace(/^[\r\n]+|[\r\n]+$/g, "");
    },

    async saveEditing() {
        console.log(`[PreviewEdit][Debug] saveEditing called: isEditing=${this.isEditing}`);
        if (!this.isEditing || !this.selectedElement) return;

        // 二重実行を防ぐ
        if (this.isSaving) return;
        this.isSaving = true;

        const previewPane = DOM.previewPane || document.getElementById('preview-pane');
        const savedPreviewScrollTop = previewPane ? previewPane.scrollTop : 0;

        const rawHtml = (this.editTargetElement && this.editTargetElement !== this.selectedElement) 
            ? this.editTargetElement.innerHTML 
            : this.selectedElement.innerHTML;
        let newText = this.convertHtmlToMarkdown(rawHtml).replace(/\u200B/g, '');

        // --- [NEW] Enterキーによるキャレット位置でのテキスト分割処理 ---
        const marker = "\uE000ENTER\uE001";
        let isSplit = false;
        let textBefore = newText;
        let textAfter = "";

        if (this.enterAction === 'split' && newText.includes(marker)) {
            isSplit = true;
            const parts = newText.split(marker);
            textBefore = parts[0];
            textAfter = parts[1] || "";
        }
        
        // 挿入したマーカーを安全のために全て削除
        newText = newText.replace(new RegExp(marker, 'g'), '');
        textBefore = textBefore.replace(new RegExp(marker, 'g'), '');
        textAfter = textAfter.replace(new RegExp(marker, 'g'), '');

        // [FIX] ダミーブロック編集時は currentSourceInfo が null になる。
        // テキスト入力がない場合はキャンセル、入力がある場合はドキュメントの末尾に追記する。
        if (!this.currentSourceInfo) {
            if (newText.trim() === '') {
                this.isSaving = false;
                this.cleanup();
                return;
            }
            
            // ドキュメントの末尾に追記
            let currentDocText = AppState.text;
            if (typeof editorView !== 'undefined' && editorView) {
                currentDocText = editorView.state.doc.toString();
            }
            currentDocText = currentDocText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            const prefix = (currentDocText.length > 0 && !currentDocText.endsWith('\n\n')) 
                ? (currentDocText.endsWith('\n') ? '\n' : '\n\n') 
                : '';
            
            // 分割状態なら改行を入れる
            if (isSplit) newText = textBefore + '\n\n' + textAfter;

            const appendedText = prefix + newText;
            const updatedFullText = currentDocText + appendedText;
            
            window.isScrolling = true;
            if (typeof window.updateEditorRange === 'function') {
                const docLength = typeof editorView !== 'undefined' && editorView ? editorView.state.doc.length : currentDocText.length;
                window.updateEditorRange(docLength, docLength, appendedText);
            } else {
                setEditorText(updatedFullText);
            }
            
            AppState.text = typeof editorView !== 'undefined' ? editorView.state.doc.toString() : updatedFullText;
            AppState.isModified = true;
            AppState.hasUnsavedChanges = true;

            // 追加されたテキストの開始行を計算し、フォーカス復帰用の情報をセット
            const textBeforeInsert = currentDocText + prefix;
            this.restoreFocusLine = textBeforeInsert.split('\n').length;

            this.isEditing = false;
            this.enterAction = null;
            
            // [FIX] ダミーブロックに追記したテキストの残骸をDOMから消去し、ダブり表示を防ぐ
            // 注: cleanup() によって selectedElement が null にリセットされる前にDOMをクリアする
            if (this.selectedElement && this.selectedElement.classList.contains('dummy-tail-block')) {
                this.selectedElement.replaceChildren(); // innerHTML = '' と同等だが安全
                this.selectedElement.textContent = '\u200B';
            }

            this.cleanup();
            
            await render();
            
            // プレビューの末尾までスクロールする
            if (previewPane) {
                previewPane.scrollTop = previewPane.scrollHeight;
            }
            setTimeout(() => {
                if (typeof syncEditorFromPreview === 'function') syncEditorFromPreview();
                window.isScrolling = false;
            }, 100);
            return;
        }

        const sourceInfo = this.currentSourceInfo;
        const originalSourceText = sourceInfo.sourceText;
        
        let tagName = this.selectedElement.tagName;
        if (this.selectedElement.classList && (this.selectedElement.classList.contains('li-text-wrapper') || this.selectedElement.classList.contains('task-list-item-text-wrapper'))) {
            tagName = 'LI';
        } else if (this.selectedElement.closest('blockquote')) {
            tagName = 'BLOCKQUOTE'; // 保存時も確実に引用として扱う
        }
        
        let fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // --- [FIX] タグの種類に応じたMarkdownプレフィックスの復元と、分割アクション ---
        if (tagName.match(/^H[1-6]$/)) {
            const match = originalSourceText.match(/^(#{1,6}\s+)/);
            if (match) textBefore = match[1] + textBefore;
            if (isSplit) {
                // 新規段落(P)に引き継ぐ
                newText = textBefore + '\n\n\u200B' + textAfter;
                this.pendingFocusNext = true;
            } else {
                newText = textBefore;
            }
        } else if (tagName === 'BLOCKQUOTE') {
            const bqMatch = originalSourceText.match(/^(>\s*)+/);
            const quotePrefix = bqMatch ? bqMatch[0].replace(/\s+$/, '') + ' ' : '> ';
            if (isSplit) {
                // 空行か判定する
                const isContentEmpty = (textBefore.trim() === '' && textAfter.trim() === '');
                if (isContentEmpty) {
                    // 空行の場合は引用から離脱して完全な新規段落へ（プレフィックス無し）
                    newText = "\n\n\u200B";
                    this.pendingFocusNext = true;
                } else {
                    textBefore = quotePrefix + textBefore;
                    // 新しい引用行(>)の中にゼロ幅スペースを仕込み、段落を分ける
                    newText = textBefore + '\n' + quotePrefix.trimEnd() + ' \u200B' + textAfter;
                    this.pendingFocusNext = true;
                }
            } else {
                if (bqMatch) newText = bqMatch[0] + newText;
            }
        } else if (tagName === 'P') {
            if (isSplit) {
                newText = textBefore + '\n\n\u200B' + textAfter;
                this.pendingFocusNext = true;
            }
        } else if (tagName === 'LI') {
            const match = originalSourceText.match(/^(\s*)([-*+]|\d+\.)(\s+(?:\[[x ]\]\s+)?)/i);
            const prefix = match ? match[1] + match[2] + match[3] : '';
            if (isSplit) {
                const isContentEmpty = (textBefore.trim() === '' && textAfter.trim() === '');
                if (isContentEmpty) {
                    // 空行の場合はリストから離脱して新規段落へ
                    newText = "\n\n\u200B";
                    this.pendingFocusNext = true;
                } else {
                    let nextPrefix = prefix || '- ';
                    // 次の行のタスクリストは未完了状態([ ])で引き継ぐ
                    nextPrefix = nextPrefix.replace(/\[x\]/i, '[ ]');
                    textBefore = prefix + textBefore;
                    newText = textBefore + '\n' + nextPrefix + '\u200B' + textAfter;
                    this.pendingFocusNext = true;
                }
            } else {
                newText = prefix + newText;
            }
        }
        
        // [FIX] 置換によって後続の段落と結合してしまわないよう、元のテキストが持っていたブロック末尾の改行（構造的な余白）を復元する
        const trailingNewlinesMatch = originalSourceText.match(/[\r\n]+$/);
        if (trailingNewlinesMatch) {
            newText += trailingNewlinesMatch[0];
        }

        const updatedFullText = fullText.substring(0, sourceInfo.start) + newText + fullText.substring(sourceInfo.end);

        window.isScrolling = true;

        if (typeof window.updateEditorRange === 'function') {
            window.updateEditorRange(sourceInfo.start, sourceInfo.end, newText);
        } else {
            setEditorText(updatedFullText);
        }

        AppState.text = typeof editorView !== 'undefined' ? editorView.state.doc.toString() : updatedFullText;
        AppState.isModified = true;
        AppState.hasUnsavedChanges = true;

        this.isEditing = false; 

        if (typeof TableEditor !== 'undefined' && typeof TableEditor.hideMiniToolbar === 'function') {
            TableEditor.hideMiniToolbar();
        }

        this.cleanup();

        // [FIX] render後に確実にフォーカスを復帰させるため、restoreFocusLine を明示的にセットする
        if (this.focusedLineIndex !== null) {
            this.restoreFocusLine = this.focusedLineIndex;
        }

        await render();

        // エディタ（左側）のテキスト更新に伴う二重レンダリングが終わるまで十分待機する
        await new Promise(resolve => setTimeout(resolve, 200));

        // --- [FIX] 分割・追加後のフォーカス復帰と自動編集の開始処理 ---
        if (this.pendingFocusNext) {
            this.pendingFocusNext = false;
            
            const focusableSelectors = 'p, li, h1, h2, h3, h4, h5, h6, blockquote'.split(',').map(s => s.trim());
            const elements = Array.from(DOM.preview.querySelectorAll(focusableSelectors.join(', ')));
            
            // 挿入しておいたゼロ幅スペース（\u200B）を持つ要素をドキュメントの最後尾から探す
            let targetEl = elements.reverse().find(el => el.textContent.includes('\u200B'));
            
            if (targetEl) {
                let editTarget = targetEl;
                if (targetEl.tagName === 'LI') {
                    const wrapper = targetEl.querySelector('.li-text-wrapper') || targetEl.querySelector('.task-list-item-text-wrapper');
                    if (wrapper) editTarget = wrapper;
                }
                
                this.startFocus(editTarget, false);
                this.startEditing(editTarget);
                
                // startEditing が完了した直後に \u200B を削除し、キャレットをテキスト先頭に合わせる
                setTimeout(() => {
                    if (this.editTargetElement) {
                        const html = this.editTargetElement.innerHTML;
                        if (html.includes('\u200B')) {
                            this.editTargetElement.innerHTML = html.replace(/\u200B/g, '');
                            const sel = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(this.editTargetElement);
                            range.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    }
                }, 50);
            } else {
                if (typeof this.restoreFocusLine === 'number') {
                    this.restoreFocusIfNeeded();
                }
            }
        } else {
            // 矢印キーやTabキーでのナビゲーション時の次の要素へのフォーカス移行
            if (typeof this._pendingNextFocusIndex !== 'undefined' && this._pendingNextFocusIndex !== null) {
                const elements = this.getFocusableElements(this._pendingNextFocusHeadingsOnly);
                const targetElement = elements[this._pendingNextFocusIndex];
                if (targetElement) {
                    this.startFocus(targetElement);
                }
                this._pendingNextFocusIndex = null;
                this._pendingNextFocusHeadingsOnly = null;
            }
        }
        
        this.enterAction = null;

        if (previewPane) {
            previewPane.scrollTop = savedPreviewScrollTop;
        }

        setTimeout(() => {
            // 自動的に次の要素の編集に入っている場合は、
            // 左側のエディタへの強制同期（フォーカス奪取）を行わないことで、編集状態の解除を防ぐ
            if (!this.isEditing && typeof syncEditorFromPreview === 'function') {
                syncEditorFromPreview();
            }
        }, 50);

        setTimeout(() => {
            if (previewPane && Math.abs(previewPane.scrollTop - savedPreviewScrollTop) > 1) {
                previewPane.scrollTop = savedPreviewScrollTop;
            }
            window.isScrolling = false;
        }, 150);
    },

    /**
     * スラッシュコマンドによるDOMの直接書き換えの代わりに、Markdownデータに直接挿入し
     * レンダリング後に適切な要素へフォーカス復帰（パターン1・パターン2）を行う
     */
    async applySlashCommandAction(contentToInsert, actionType, item) {
        console.log(`[PreviewInlineEdit] applySlashCommandAction called. Action: ${actionType}, content length: ${contentToInsert.length}`);
        
        // フォーカスモードインサート（編集なしでフォーカス行の次に挿入）
        if (this._focusModeInsertSource && !this.isEditing) {
            await this._handleFocusModeInsert(contentToInsert, actionType, item);
            return;
        }
        
        // [FIX] renderによる非同期 blur ディスパッチで isEditing が false になる競合状態があるため、
        // isEditing 以外に selectedElement（編集対象要素）の有無でも実行可能か判定する
        const canExecute = this.isEditing || (this.selectedElement != null) || (this.isDummyBlock && this.editTargetElement != null);
        if (!canExecute) {
            console.warn('[PreviewInlineEdit] applySlashCommandAction aborted: no editing context available.');
            return;
        }
        
        // 御守り: isEditing が false なら isEditing を true に戻して続行する
        if (!this.isEditing) {
            console.warn('[PreviewInlineEdit] applySlashCommandAction: isEditing was false, restoring state to continue.');
            this.isEditing = true;
        }

        // 保存の割り込みを防止
        this.isSlashCommandExecuting = true;

        try {
            const sel = window.getSelection();
            
            // チェックボックス（wrapperを持つLI）の場合と通常要素で処理を分岐
            const isWrappedTarget = this.editTargetElement && this.editTargetElement !== this.selectedElement;
            
            console.log(`[ApplySlash][Debug] isWrappedTarget=${isWrappedTarget}, isDummyBlock=${this.isDummyBlock}, editTargetElement tag=${this.editTargetElement?.tagName}, selectedElement tag=${this.selectedElement?.tagName}`);

            let newBlockText;

            // ▼▼▼ 追加・修正部分: コマンドの種別を詳細に判定 ▼▼▼
            // 見出し・リスト・段落など、行の書式自体を書き換えるもの
            let isHeadingOrList = item && (item.type === 'heading' || item.type === 'list' || actionType === 'insert-text-block');
            
            // 安全のためのフォールバック（typeがない場合でも値で行頭書式か判定）
            if (!isHeadingOrList && item && item.action === 'insert' && typeof item.value === 'string') {
                if (/^(#{1,6}\s+|[-*+]\s+(?:\[[x ]\]\s+)?|\d+\.\s+)$/i.test(item.value)) {
                    isHeadingOrList = true;
                }
            }

            // 表・コードブロック・水平線など、次の行に独立したブロック要素として挿入するもの
            let isIndependentBlock = item && (item.type === 'block' || item.type === 'table' || item.type === 'toc' || item.type === 'template' || actionType === 'insert-template' || actionType === 'insert-toc') && actionType !== 'insert-text-block';

            if (isWrappedTarget) {
                // --- チェックボックス等のラッパー方式 ---
                let currentText = this.editTargetElement.textContent.replace(/\u200B/g, '');
                
                // 入力中のトリガー文字（/tableなど）を消去
                currentText = currentText.replace(/[\/；][^\s]*$/, '');

                let originalPrefix = '';
                if (!this.isDummyBlock && this.currentSourceInfo) {
                    const match = this.currentSourceInfo.sourceText.match(/^(\s*)([-*+]|\d+\.)(\s+(?:\[[x ]\]\s+)?)/i);
                    if (match) originalPrefix = match[1] + match[2] + match[3];
                }

                if (isHeadingOrList) {
                    // 元のプレフィックスを捨て、新しい書式をテキストの先頭に適用する
                    let cleanText = currentText.trimStart().replace(/^(#{1,6}\s+|[-*+]\s+(?:\\[[x ]\\]\s+)?|\\d+\\.\\s+)/i, '');
                    newBlockText = actionType === 'insert-text-block' ? cleanText : contentToInsert + cleanText;
                } else if (isIndependentBlock) {
                    // 現在のテキストを残したまま、後ろに改行してブロックを挿入
                    newBlockText = originalPrefix + currentText.trimEnd() + "\n\n" + contentToInsert + "\n\n";
                } else {
                    // インライン要素はそのまま追加
                    newBlockText = originalPrefix + currentText + contentToInsert;
                }
                console.log(`[ApplySlash][Debug] WRAPPED path: newBlockText="${newBlockText}"`);
            } else {
                // --- 通常のマーカー方式 ---
                const marker = "\uE000SLASH" + Date.now() + "\uE001";  // Unicodeプライベート領域を使い、Turndownエスケープを回避
                
                // 1. キャレット位置にマーカーを挿入し、現在の入力状況を含むMarkdown文字列を取得
                if (sel && sel.rangeCount > 0 && this.selectedElement && (this.selectedElement.contains(sel.anchorNode) || this.isDummyBlock)) {
                    const range = sel.getRangeAt(0);
                    range.insertNode(document.createTextNode(marker));
                    console.log(`[ApplySlash][Debug] Marker inserted at selection range`);
                } else {
                    if (this.selectedElement) {
                        this.selectedElement.appendChild(document.createTextNode(marker));
                        console.log(`[ApplySlash][Debug] Marker appended to selectedElement`);
                    }
                }

                const rawHtml = this.selectedElement ? this.selectedElement.innerHTML : marker;
                console.log(`[ApplySlash][Debug] rawHtml (first 200 chars)="${rawHtml.substring(0, 200)}"`);
                
                // マーカーテキストノードをDOMから直接削除（render時に残骸が表示されるのを防ぐ）
                const markerWalker = document.createTreeWalker(this.selectedElement, NodeFilter.SHOW_TEXT);
                const markerNodes = [];
                let node = markerWalker.nextNode();
                while (node) {
                    if (node.textContent.includes(marker)) {
                        markerNodes.push(node);
                    }
                    node = markerWalker.nextNode();
                }
                markerNodes.forEach(n => n.parentNode && n.parentNode.removeChild(n));
                console.log(`[ApplySlash][Debug] Removed ${markerNodes.length} marker text node(s) from DOM`);
                
                newBlockText = this.convertHtmlToMarkdown(rawHtml).replace(/\u200B/g, '');
                console.log(`[ApplySlash][Debug] After Turndown (first 200 chars)="${newBlockText.substring(0, 200)}"`);
                console.log(`[ApplySlash][Debug] marker="${marker}", marker in text=${newBlockText.includes(marker)}`);
                
                // プレフィックスの抽出
                let bqPrefix = '';
                let originalPrefix = '';
                let tagName = this.selectedElement ? this.selectedElement.tagName : '';
                
                if (this.selectedElement && this.selectedElement.classList && (this.selectedElement.classList.contains('li-text-wrapper') || this.selectedElement.classList.contains('task-list-item-text-wrapper'))) {
                    tagName = 'LI';
                } else if (this.selectedElement && this.selectedElement.closest && this.selectedElement.closest('blockquote')) {
                    tagName = 'BLOCKQUOTE';
                }

                if (!this.isDummyBlock && this.selectedElement && this.currentSourceInfo) {
                    const originalText = this.currentSourceInfo.sourceText;
                    
                    if (tagName === 'BLOCKQUOTE') {
                        const bqMatch = originalText.match(/^(>\s*)+/);
                        if (bqMatch) bqPrefix = bqMatch[0];
                    }

                    let textWithoutQuote = originalText;
                    if (bqPrefix) textWithoutQuote = originalText.substring(bqPrefix.length);

                    if (tagName.match(/^H[1-6]$/)) {
                        const match = textWithoutQuote.match(/^(#{1,6}\s+)/);
                        if (match) originalPrefix = match[1];
                    } else if (tagName === 'LI') {
                        const match = textWithoutQuote.match(/^(\s*)([-*+]|\d+\.)(\s+(?:\[[x ]\]\s+)?)/i);
                        if (match) originalPrefix = match[1] + match[2] + match[3];
                    }
                    
                    // 行頭の書式変更ではない場合は、元のプレフィックスを維持するため付与しておく
                    if (!isHeadingOrList && originalPrefix) {
                        if (!newBlockText.startsWith(originalPrefix.trim())) {
                            newBlockText = originalPrefix + newBlockText;
                        }
                    }
                }

                // コマンドの種別に応じた挿入フォーマット
                if (isHeadingOrList) {
                    // マーカー（カーソル位置）を消去し、元のテキストを残したまま先頭に新しい記号を付ける
                    newBlockText = newBlockText.replace(marker, '');
                    newBlockText = newBlockText.replace(/[\/；][^\s]*$/, ''); // 残骸消去
                    
                    // 意図せず残った既存のマークダウン行頭記号があればクリーンアップして重複を防ぐ
                    newBlockText = newBlockText.replace(/^(#{1,6}\s+|[-*+]\s+(?:\[[x ]\]\s+)?|\d+\.\s+)/i, '');

                    if (actionType !== 'insert-text-block') {
                        newBlockText = contentToInsert + newBlockText.trimStart();
                    } else {
                        newBlockText = newBlockText.trimStart();
                    }
                } else if (isIndependentBlock) {
                    // マーカー位置で改行を挟んでブロックを挿入
                    newBlockText = newBlockText.replace(marker, "\n\n" + contentToInsert + "\n\n");
                } else {
                    // インライン要素（リンクなど）はマーカー位置にそのまま挿入
                    newBlockText = newBlockText.replace(marker, contentToInsert);
                }

                // Blockquote 内での処理だった場合は、全行の先頭に `> ` を再付与する
                if (bqPrefix) {
                    newBlockText = newBlockText.split('\n').map(line => line.trim() === '' ? bqPrefix.trim() : bqPrefix + line).join('\n');
                }

                // --- 元テキストの末尾の改行情報の復元（下の行との結合防止およびインデント混入防止） ---
                if (!this.isDummyBlock && this.currentSourceInfo) {
                    const originalText = this.currentSourceInfo.sourceText;
                    const trailingWhitespaceMatch = originalText.match(/(\s+)$/);
                    let newlinesOnly = '';
                    if (trailingWhitespaceMatch) {
                        // 空白文字群の中から改行文字（\r または \n）のみを抽出し、余分なスペースやタブは捨てる
                        newlinesOnly = trailingWhitespaceMatch[1].replace(/[^\r\n]/g, '');
                    }
                    // 元のテキストの末尾にあった改行だけを復元し、不必要な末尾空白は一掃する
                    newBlockText = newBlockText.trimEnd() + newlinesOnly;
                }
                
                console.log(`[ApplySlash][Debug] After replace: newBlockText (first 200 chars)="${newBlockText.substring(0, 200)}"`);
            }
            // ▲▲▲ 追加・修正部分 ここまで ▲▲▲


            // 単独で挿入された空の箇条書き（'- '）が直前の段落と結合してSetext見出し化するのを防いだり、
            // 空要素が非表示になりフォーカス不可となる現象を防ぐためゼロ幅スペースを補完
            const needsEditingAction = item && (item.type === 'heading' || item.type === 'list' || actionType === 'insert-text-block');
            if (needsEditingAction) {
                // 改行文字（\n）は除外して、行の最後（改行の手前含む）がスペースやタブで終わっている場合のみ不可視文字を補完する
                if (newBlockText.match(/[ \t](?:\r?\n)?$/)) {
                    newBlockText = newBlockText.replace(/([ \t])(\r?\n)?$/, '$1\u200B$2');
                }
            } else if (newBlockText.match(/^[\s]*[-*+]\s+\[[x ]\]\s*(?:\r?\n)?$/i)) {
                // タスクリストの空要素の場合
                newBlockText = newBlockText.replace(/(\r?\n)?$/, '\u200B$1');
            }

            const fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            
            let sourceInfo = null;
            if (this.isDummyBlock) {
                sourceInfo = { start: fullText.length, end: fullText.length };
            } else {
                sourceInfo = this.currentSourceInfo;
            }

            if (!sourceInfo) {
                this.cleanup();
                return;
            }

            const t0 = performance.now();
            console.log(`[Perf][InlineEdit] saveEditing target text parsed at ${t0.toFixed(1)}ms`);

            // 2. ドキュメントへの変更の適用
            let prefixNewline = this.isDummyBlock ? "\n\n" : ""; 
            const updatedFullText = fullText.substring(0, sourceInfo.start) + prefixNewline + newBlockText + fullText.substring(sourceInfo.end);
            
            // 挿入開始位置の行番号（0-based）
            const textBeforeInsert = fullText.substring(0, sourceInfo.start) + prefixNewline;
            const startLineIndex = textBeforeInsert.split('\n').length - 1; 
            
            if (typeof window.updateEditorRange === 'function') {
                window.updateEditorRange(sourceInfo.start, sourceInfo.end, prefixNewline + newBlockText);
            } else {
                setEditorText(updatedFullText);
            }

            AppState.text = typeof editorView !== 'undefined' ? editorView.state.doc.toString() : updatedFullText;
            AppState.isModified = true;
            AppState.hasUnsavedChanges = true;

            this.isEditing = false;
            
            const isScrollingPrev = window.isScrolling;
            window.isScrolling = true;
            const previewPane = DOM.preview;
            const savedScrollTop = previewPane ? previewPane.scrollTop : 0;

            this.cleanup();

            const t1 = performance.now();
            console.log(`[Perf][InlineEdit] saveEditing DOM update delegated to Editor/Renderer at ${(t1 - t0).toFixed(1)}ms`);

            // 3. 次回のレンダリング後のアクション設定（スラッシュコマンドか通常保存か）
            if (actionType) {
                // スラッシュコマンド（追加挿入）由来での適用完了後は、非同期レンダリング後に即座に編集モードに入る
                this.pendingActionType = { type: actionType, isBlockLevel: isIndependentBlock, startLineIndex, newBlockText };
            } else {
                // Ctrl+Enterなどの通常の保存完了後は、非同期レンダリング完了後に該当行へフォーカス復帰する
                this.restoreFocusLine = startLineIndex + 1;
            }

            // [FIX] updateEditorRange のデバウンスだけでは render が空振る場合があるため明示的に render() を呼ぶ
            if (typeof render === 'function') {
                await render();
            }

            // 4. スクロール位置の維持
            if (previewPane) {
                previewPane.scrollTop = savedScrollTop;
                setTimeout(() => { window.isScrolling = isScrollingPrev; }, 100);
            }
        } finally {
            this.isSlashCommandExecuting = false;
        }
    },

    /**
     * Delete a block from the source based on a preview element (Using precise data-line mapping)
     * @param {HTMLElement} element 
     */
    async deleteBlock(element) {
        let targets = [];
        if (this.selectedElements && this.selectedElements.size > 0) {
            targets = Array.from(this.selectedElements);
        } else if (element) {
            targets = [element];
        } else if (this.focusedElement) {
            targets = [this.focusedElement];
        }

        if (targets.length === 0) return;

        const fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = fullText.split('\n');
        
        let rangesToSubtract = [];
        
        for (const targetEl of targets) {
            const dataLineTarget = targetEl.hasAttribute('data-line') ? targetEl : targetEl.closest('[data-line]');
            
            if (!dataLineTarget || ['UL', 'OL', 'BODY', 'HTML'].includes(dataLineTarget.tagName)) {
                continue;
            }
            
            const startLineStr = dataLineTarget.getAttribute('data-line');
            const endLineStr = dataLineTarget.getAttribute('data-line-end');
            
            if (!startLineStr) continue;

            const startLineNum = parseInt(startLineStr, 10);
            const endLineNum = endLineStr ? parseInt(endLineStr, 10) : startLineNum;

            if (startLineNum <= 0) continue;

            let startPos = 0;
            for (let i = 0; i < startLineNum - 1; i++) {
                if (i < lines.length) startPos += lines[i].length + 1;
            }
            let endPos = startPos;
            for (let i = startLineNum - 1; i < endLineNum; i++) {
                if (i < lines.length) endPos += lines[i].length + 1;
            }

            startPos = Math.min(startPos, fullText.length);
            endPos = Math.min(endPos, fullText.length);
            
            rangesToSubtract.push({start: startPos, end: endPos});
        }

        if (rangesToSubtract.length === 0) {
            console.warn('[PreviewInlineEdit] Could not locate data-line for deletion.');
            if (typeof showToast === 'function') showToast("削除箇所の特定に失敗しました", "error");
            return;
        }

        // Merge overlapping ranges
        rangesToSubtract.sort((a, b) => a.start - b.start);
        const mergedRanges = [];
        for (const range of rangesToSubtract) {
            if (mergedRanges.length === 0) {
                mergedRanges.push(range);
            } else {
                const last = mergedRanges[mergedRanges.length - 1];
                if (range.start <= last.end) {
                    last.end = Math.max(last.end, range.end);
                } else {
                    mergedRanges.push(range);
                }
            }
        }

        const confirmMsg = typeof I18n !== 'undefined' ? I18n.translate('dialog.confirmDeleteObject') || 'これらのオブジェクトを削除しますか？' : 'これらのオブジェクトを削除しますか？';
        if (confirm(confirmMsg)) {
            // Delete from end to start to properly maintain string indices
            mergedRanges.sort((a, b) => b.start - a.start);
            
            let newText = fullText;
            for (const range of mergedRanges) {
                newText = newText.substring(0, range.start) + newText.substring(range.end);
            }
            
            // エディタの該当範囲を置換
            if (typeof window.updateEditorRange === 'function' && mergedRanges.length === 1) {
                window.updateEditorRange(mergedRanges[0].start, mergedRanges[0].end, '');
            } else {
                if (typeof setEditorText === 'function') {
                    setEditorText(newText);
                }
            }

            // Clear selection after deletion
            this.clearSelection();

            // 更新と再描画
            AppState.isModified = true;
            AppState.hasUnsavedChanges = true;
            if (typeof render === 'function') {
                await render();
            }

            if (typeof showToast === 'function') showToast("削除しました");
        }
    },

    cancelEditing() {
        if (!this.isEditing) return;
        
        // 編集終了後にフォーカスを復元するため、対象要素を保持しておく
        const targetElement = this.focusedElement || this.selectedElement;

        if (this.selectedElement) {
            this.selectedElement.innerHTML = this.originalHtml;
        }
        this.cleanup();
        
        // [FIX] 編集状態が終わった後も、編集前のときみたいに青い点線の枠でフォーカスを表示する
        if (targetElement) {
            setTimeout(() => {
                this.startFocus(targetElement);
            }, 10);
        }
    },

    cleanup() {
        if (this.editTargetElement) {
            this.editTargetElement.removeAttribute('contenteditable');
            this.editTargetElement.classList.remove('inline-editing-active');
            
            // リスナーの解除
            if (this.boundKeydown) this.editTargetElement.removeEventListener('keydown', this.boundKeydown);
            if (this.boundBlur)    this.editTargetElement.removeEventListener('blur', this.boundBlur);
            if (this.boundInput)   this.editTargetElement.removeEventListener('input', this.boundInput);
            if (this.boundSelectionChange) {
                this.editTargetElement.removeEventListener('mouseup', this.boundSelectionChange);
                this.editTargetElement.removeEventListener('keyup', this.boundSelectionChange);
            }
            if (this.boundKeyup)   this.editTargetElement.removeEventListener('keyup', this.boundKeyup);
        }
        
        if (typeof TableEditor !== 'undefined' && typeof TableEditor.hideMiniToolbar === 'function') {
            TableEditor.hideMiniToolbar();
        }

        // タスクリストLIのflexboxスタイルをリセット（編集中に適用したもの）
        if (this.selectedElement && this.selectedElement.tagName === 'LI' && 
            this.selectedElement.classList.contains('task-list-item') &&
            typeof this._taskListOriginalDisplay !== 'undefined') {
            this.selectedElement.style.display = this._taskListOriginalDisplay;
            this._taskListOriginalDisplay = undefined;
        }

        this.selectedElement = null;
        this.editTargetElement = null;
        this.isEditing = false;
        this.isSaving = false; // 処理中フラグをリセット
        this.originalDisplay = '';
        
        // [FIX] enterAction や listAction はレンダリング後の自動フォーカスに使うためここでは消去しない

        // Clear status bar line info
        if (typeof updateStatusBar === 'function') {
            updateStatusBar({ previewLine: null });
        }

        // [FIX] 編集終了時にブラウザのネイティブテキスト選択状態（青背景の選択）をクリアし、編集中だと誤認させないようにする
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
        }
    },

    /**
     * フォーカスモードでのスラッシュコマンド挿入処理
     * 編集状態にせず、フォーカス行の次の行に内容を挿入する
     */
    async _handleFocusModeInsert(contentToInsert, actionType, item) {
        const sourceElement = this._focusModeInsertSource;
        this._focusModeInsertSource = null;

        if (!sourceElement) return;

        // ソース位置を特定（ダミーブロックや空テキストの場合はファイル末尾に挿入）
        const isDummyBlock = sourceElement.classList && sourceElement.classList.contains('dummy-tail-block');
        const currentText = sourceElement.textContent.replace(/\u200B/g, '').trim();

        const fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let insertPos;

        if (isDummyBlock || currentText === '') {
            // ダミーブロックまたは空テキスト → ファイル末尾に追加
            insertPos = fullText.length;
        } else {
            const sourceInfo = this.findSourceLocation(currentText, sourceElement.tagName, sourceElement);
            if (!sourceInfo) {
                console.warn('[FocusModeInsert] Could not find source location for focused element.');
                return;
            }
            insertPos = sourceInfo.end;
        }

        // 単独で挿入された箇条書き（'- '）が直前の段落と結合してSetext見出し化するのを防いだり、
        // 空の要素がDOMで非表示になりフォーカスできなくなる現象を防ぐためゼロ幅スペースを補完
        let insertContent = contentToInsert;
        
        // insert-text-block の場合、slash_command_preview.jsからダミー値として渡される '\n'（文字列）を破棄
        if (actionType === 'insert-text-block') {
            insertContent = '';
        }

        // 単独で挿入された箇条書き（'- '）が直前の段落と結合してSetext見出し化するのを防いだり、
        // 空の要素がDOMで非表示になりフォーカスできなくなる現象を防ぐためゼロ幅スペースを補完
        const needsEditingEarly = item && (item.type === 'heading' || item.type === 'list' || actionType === 'insert-text-block');
        if (needsEditingEarly) {
            // 文字列が空、または末尾がスペースやタブで終わっている場合に不可視文字を補完する
            if (insertContent === '' || insertContent.match(/[ \t]$/)) {
                insertContent += '\u200B';
            }
        } else if (insertContent.match(/^\s*[-*+]\s+\[[x ]\]\s*$/i)) {
            insertContent += '\u200B';
        }
        
        let insertText = '\n' + insertContent;
        // 挿入位置の後ろにテキストが続いており、それが改行文字から始まっていない場合は、
        // 挿入したテキストの直後にくっついてしまうのを防ぐため末尾にも改行を挟む
        if (insertPos < fullText.length && !/^[\r\n]/.test(fullText.substring(insertPos))) {
            insertText += '\n';
        }

        // 挿入後の行番号（0-based）
        const textBeforeInsert = fullText.substring(0, insertPos);
        const insertLineIndex = textBeforeInsert.split('\n').length; // 挿入行（次の行）

        if (typeof window.updateEditorRange === 'function') {
            window.updateEditorRange(insertPos, insertPos, insertText);
        } else {
            setEditorText(fullText.substring(0, insertPos) + insertText + fullText.substring(insertPos));
        }

        AppState.text = typeof editorView !== 'undefined' ? editorView.state.doc.toString() :
            (fullText.substring(0, insertPos) + insertText + fullText.substring(insertPos));
        AppState.isModified = true;
        AppState.hasUnsavedChanges = true;

        // 見出し・箇条書き・チェックボックスは挿入後に編集状態にする
        const needsEditing = item && (item.type === 'heading' || item.type === 'list' || actionType === 'insert-text-block');
        if (needsEditing) {
            // 次のrender完了後に対象要素を見つけて編集状態にする
            this.pendingActionType = {
                type: actionType,
                isBlockLevel: false,
                startLineIndex: insertLineIndex,
                newBlockText: insertContent,
            };
        } else {
            // 挿入行にフォーカスを復帰
            this.restoreFocusLine = insertLineIndex + 1;
        }

        await render();
    },

    findSourceLocation(previewText, tagName, element) {
        // \r\n（Windows）や\r（旧Mac）の改行コードを\nに統一してから処理する。
        const fullText = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        let searchStartIndex = 0;
        let expectedStartPos = -1; // [NEW] 期待される本来の開始位置
        if (element) {
            const dataLineTarget = element.hasAttribute('data-line') ? element : element.closest('[data-line]');
            if (dataLineTarget && !['UL', 'OL', 'BODY', 'HTML'].includes(dataLineTarget.tagName)) {
                const dl = dataLineTarget.getAttribute('data-line');
                if (dl) {
                    const lineNum = parseInt(dl, 10);
                    const lines = fullText.split('\n');
                    if (lineNum > 0 && lineNum <= lines.length) {
                        let currentPos = 0;
                        for (let i = 0; i < lineNum - 1; i++) {
                            currentPos += lines[i].length + 1;
                        }
                        expectedStartPos = currentPos;
                        searchStartIndex = Math.max(0, currentPos - 100); 
                    }
                }
            }
        }

        let index = -1;
        const snippet = previewText.trim().substring(0, 25);
        
        if (snippet.length > 0) {
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let pattern = "[\\*\\_\\~\\`\\# \\t\\-]*"; 
            for (let i = 0; i < snippet.length; i++) {
                const char = snippet[i];
                if (/[ \t]/.test(char)) {
                    pattern += "[ \\t]*";
                } else {
                    pattern += escapeRegExp(char) + "[\\*\\_\\~\\` \\t]*";
                }
            }

            try {
                const regex = new RegExp(pattern, 'g');
                let match;
                
                if (expectedStartPos !== -1) {
                    let bestMatch = null;
                    let minDistance = Infinity;
                    
                    // [FIX] 誤爆を防ぐため、全文から検索して expectedStartPos に最も近いものを選択する
                    while ((match = regex.exec(fullText)) !== null) {
                        const distance = Math.abs(match.index - expectedStartPos);
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestMatch = match;
                        }
                    }
                    if (bestMatch) {
                        index = bestMatch.index;
                    }
                } else {
                    regex.lastIndex = searchStartIndex;
                    match = regex.exec(fullText);
                    if (!match && searchStartIndex > 0) {
                        regex.lastIndex = 0;
                        match = regex.exec(fullText);
                    }
                    if (match) index = match.index;
                }
            } catch (e) {
                console.warn('[PreviewInlineEdit] regex failed', e);
            }

            // ファジー検索が失敗した場合は完全一致を探す
            if (index === -1) {
                if (expectedStartPos !== -1) {
                    let currentIdx = fullText.indexOf(snippet, 0);
                    let bestIdx = -1;
                    let minDistance = Infinity;
                    while (currentIdx !== -1) {
                        const distance = Math.abs(currentIdx - expectedStartPos);
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestIdx = currentIdx;
                        }
                        currentIdx = fullText.indexOf(snippet, currentIdx + 1);
                    }
                    index = bestIdx;
                } else {
                    index = fullText.indexOf(snippet, searchStartIndex);
                    if (index === -1 && searchStartIndex > 0) {
                        index = fullText.indexOf(snippet, 0);
                    }
                }
            }
        }

        // ファジー検索または完全一致で見つかった場合
        if (index !== -1) {
            let start = index;

            // 行の先頭まで拡張
            while (start > 0 && fullText[start - 1] !== '\n') {
                start--;
            }

            let end = index; 
            
            let useLineBasedEnd = false;
            // [FIX] 終了位置を「絶対位置」ではなく、マッチしたstartからの「相対行数」で計算して範囲暴走を防ぐ
            if (element) {
                const blockContainer = element.closest('[data-line]');
                if (blockContainer) {
                    const startLine = parseInt(blockContainer.getAttribute('data-line'), 10);
                    const endLineAttr = blockContainer.getAttribute('data-line-end');
                    if (!isNaN(startLine) && endLineAttr) {
                        let targetEndLine = parseInt(endLineAttr, 10);
                        const descendants = blockContainer.querySelectorAll('[data-line]');
                        descendants.forEach(desc => {
                            const dLine = parseInt(desc.getAttribute('data-line'), 10);
                            if (!isNaN(dLine) && dLine > startLine && dLine < targetEndLine) {
                                targetEndLine = dLine;
                            }
                        });
                        
                        const linesArray = fullText.split('\n');
                        
                        // start位置が現在のテキストの何行目にあるかを算出
                        let actualStartLine = 1;
                        for (let i = 0; i < start; i++) {
                            if (fullText[i] === '\n') actualStartLine++;
                        }
                        
                        // [NEW] 相対行数での計算
                        const lineSpan = targetEndLine - startLine;
                        const actualEndLine = actualStartLine + lineSpan;
                        
                        let targetEndPos = 0;
                        for (let i = 0; i < actualEndLine; i++) {
                            if (i < linesArray.length) {
                                targetEndPos += linesArray[i].length + 1;
                            }
                        }
                        
                        if (targetEndPos > start) {
                            end = Math.min(targetEndPos, fullText.length);
                            useLineBasedEnd = true;
                        }
                    }
                }
            }

            if (!useLineBasedEnd) {
                while (end < fullText.length) {
                    if (fullText[end] === '\n') {
                        end++;
                        break;
                    }
                    end++;
                }

                if (element && element.closest('table, pre')) {
                    const blockEl = element.closest('[data-line-end]');
                    if (blockEl) {
                        const sLine = parseInt(blockEl.getAttribute('data-line'), 10);
                        const eLine = parseInt(blockEl.getAttribute('data-line-end'), 10);
                        if (!isNaN(sLine) && !isNaN(eLine)) {
                            const linesArray = fullText.split('\n');
                            let actualStartLine = 1;
                            for (let i = 0; i < start; i++) {
                                if (fullText[i] === '\n') actualStartLine++;
                            }
                            
                            const lineSpan = eLine - sLine;
                            const actualEndLine = actualStartLine + lineSpan;
                            
                            let targetEndPos = 0;
                            for (let i = 0; i < actualEndLine; i++) {
                                if (i < linesArray.length) {
                                    targetEndPos += linesArray[i].length + 1;
                                }
                            }
                            if (targetEndPos > start) {
                                end = Math.min(targetEndPos, fullText.length);
                            }
                        }
                    }
                }
            }

            const linesBeforeStart = fullText.substring(0, start).split('\n');
            const linesBeforeEnd = fullText.substring(0, end).split('\n');
            const startLineDebug = linesBeforeStart.length;
            const endLineDebug = linesBeforeEnd.length - (fullText[end - 1] === '\n' ? 1 : 0);
            
            console.log(`[PreviewInlineEdit] Found source location by text match: Line ${startLineDebug} to ${endLineDebug}`);

            return {
                start: start,
                end: end,
                startLineDebug: startLineDebug,
                endLineDebug: endLineDebug,
                sourceText: fullText.substring(start, end)
            };
        } 
        else if (element) {
            const dataLineTarget = element.hasAttribute('data-line') ? element : element.closest('[data-line]');
            if (dataLineTarget && !['UL', 'OL', 'BODY', 'HTML'].includes(dataLineTarget.tagName)) {
                const startLineStr = dataLineTarget.getAttribute('data-line');
                const endLineStr = dataLineTarget.getAttribute('data-line-end');
                const startLineNum = parseInt(startLineStr, 10);
                const endLineNum = endLineStr ? parseInt(endLineStr, 10) : startLineNum;

                if (startLineNum > 0) {
                    const lines = fullText.split('\n');
                    let startPos = 0;
                    for (let i = 0; i < startLineNum - 1; i++) {
                        if (i < lines.length) startPos += lines[i].length + 1;
                    }
                    let endPos = startPos;
                    for (let i = startLineNum - 1; i < endLineNum; i++) {
                        if (i < lines.length) endPos += lines[i].length + 1;
                    }

                    startPos = Math.min(startPos, fullText.length);
                    endPos = Math.min(endPos, fullText.length);

                    console.log(`[PreviewInlineEdit] Found source location by data-line fallback: Line ${startLineNum} to ${endLineNum}`);

                    return {
                        start: startPos,
                        end: endPos,
                        startLineDebug: startLineNum,
                        endLineDebug: endLineNum,
                        sourceText: fullText.substring(startPos, endPos)
                    };
                }
            }
        }
        
        return null;
    },

    /**
     * D&Dによる要素の入れ替えとMarkdownソース自体の再構築を行う
     */
    processDragAndDrop(startLine, endLine, targetStartLine, targetEndLine, isTop) {
        let lines = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        
        const blockToMove = lines.slice(startLine - 1, endLine).join('\n');
        lines.splice(startLine - 1, endLine - startLine + 1);
        
        let insertIndex;
        if (targetStartLine > startLine) {
            const shift = endLine - startLine + 1;
            insertIndex = (isTop ? targetStartLine : targetEndLine + 1) - 1 - shift;
        } else {
            insertIndex = (isTop ? targetStartLine : targetEndLine + 1) - 1;
        }
        
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > lines.length) insertIndex = lines.length;
        
        lines.splice(insertIndex, 0, blockToMove);
        
        let newText = lines.join('\n');
        
        if (typeof window.updateEditorRange === 'function') {
            setEditorText(newText); 
        } else {
            setEditorText(newText);
        }
        
        AppState.text = newText;
        AppState.isModified = true;
        AppState.hasUnsavedChanges = true;
        
        const previewPane = DOM.previewPane || document.getElementById('preview-pane');
        const savedPreviewScrollTop = previewPane ? previewPane.scrollTop : 0;
        
        window.isScrolling = true;
        render().then(() => {
            if (previewPane) previewPane.scrollTop = savedPreviewScrollTop;
            setTimeout(() => {
                if (typeof syncEditorFromPreview === 'function') syncEditorFromPreview();
                window.isScrolling = false;
            }, 100);
        });
    },

    /**
     * D&Dによる画像ブロック同士の結合（横並び表示）を行う。
     * どちらかがすでに<table>の場合も、全imgを1つのflatなtableにまとめ直す。
     */
    processMergeImages(startLine, endLine, targetStartLine, targetEndLine) {
        let lines = AppState.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        const sourceText = lines.slice(startLine - 1, endLine).join('\n').trim();
        const targetText = lines.slice(targetStartLine - 1, targetEndLine).join('\n').trim();

        // <img ...> タグを全て抽出するヘルパー
        const extractImgTags = (text) => {
            const results = [];
            const re = /<img\b[^>]*>/gi;
            let m;
            while ((m = re.exec(text)) !== null) {
                results.push(m[0]);
            }
            return results;
        };

        // どちらかがすでに<table>を含む場合は全imgを抽出してフラット化
        let allImgs;
        if (/<table/i.test(sourceText) || /<table/i.test(targetText)) {
            const targetImgs = extractImgTags(targetText);
            const sourceImgs = extractImgTags(sourceText);
            allImgs = [...targetImgs, ...sourceImgs];
        } else {
            allImgs = [targetText, sourceText];
        }

        // 列幅を均等分割し1つのtableを生成
        const colPct = Math.floor(100 / allImgs.length);
        const tds = allImgs.map(img =>
            `    <td style="width: ${colPct}%; border: none; text-align: center; vertical-align: top;">\n${img}\n    </td>`
        ).join('\n');
        const mergedText = `<table style="width: 100%; border: none; background: transparent;">\n  <tr>\n${tds}\n  </tr>\n</table>`;

        // 行番号が大きい方から削除（インデックスズレ防止）
        const ranges = [
            { start: startLine - 1, count: endLine - startLine + 1 },
            { start: targetStartLine - 1, count: targetEndLine - targetStartLine + 1 }
        ];
        ranges.sort((a, b) => b.start - a.start);
        for (const range of ranges) {
            lines.splice(range.start, range.count);
        }

        // 挿入位置を計算
        let insertIndex = targetStartLine - 1;
        if (startLine < targetStartLine) {
            insertIndex -= (endLine - startLine + 1);
        }
        if (insertIndex < 0) insertIndex = 0;

        lines.splice(insertIndex, 0, mergedText);

        const newText = lines.join('\n');
        setEditorText(newText);

        AppState.text = newText;
        AppState.isModified = true;
        AppState.hasUnsavedChanges = true;

        const previewPane = DOM.previewPane || document.getElementById('preview-pane');
        const savedPreviewScrollTop = previewPane ? previewPane.scrollTop : 0;

        window.isScrolling = true;
        render().then(() => {
            if (previewPane) previewPane.scrollTop = savedPreviewScrollTop;
            setTimeout(() => {
                if (typeof syncEditorFromPreview === 'function') syncEditorFromPreview();
                window.isScrolling = false;
            }, 100);
        });
    },

    /**
     * 見出しレベルの変更（フォーカスモード用）
     * @param {number} direction -1: 上位へ(#減らす), 1: 下位へ(#増やす)
     */
    _handleHeadingLevelChange(direction) {
        if (!this.focusedElement) return;

        const lineStr = this.focusedElement.getAttribute('data-line') || this.focusedElement.closest('[data-line]')?.getAttribute('data-line');
        if (!lineStr) return;
        const lineNum = parseInt(lineStr, 10);
        if (isNaN(lineNum) || typeof editorView === 'undefined' || !editorView) return;

        const doc = editorView.state.doc;
        if (lineNum < 1 || lineNum > doc.lines) return;

        const lineInfo = doc.line(lineNum);
        const text = lineInfo.text;

        const match = text.match(/^(#{1,6})\s+(.*)$/);
        if (!match) return;

        const currentLevel = match[1].length;
        let newLevel = currentLevel;

        if (direction === -1) {
            newLevel = Math.max(1, currentLevel - 1);
        } else {
            newLevel = Math.min(6, currentLevel + 1);
        }

        if (newLevel !== currentLevel) {
            const newText = '#'.repeat(newLevel) + ' ' + match[2];

            editorView.dispatch({
                changes: { from: lineInfo.from, to: lineInfo.to, insert: newText }
            });

            AppState.text = editorView.state.doc.toString();
            AppState.isModified = true;
            AppState.hasUnsavedChanges = true;

            this.restoreFocusLine = lineNum;
            if (typeof render === 'function') render();
        }
    },

    /**
     * リストインデントの変更（フォーカスモード用）
     * @param {number} direction -1: インデント減(Outdent), 1: インデント増(Indent)
     */
    _handleListIndentChange(direction) {
        if (!this.focusedElement) return;

        const element = this.focusedElement;
        const lineStr = element.getAttribute('data-line') || element.closest('[data-line]')?.getAttribute('data-line');
        if (!lineStr) return;
        const lineNum = parseInt(lineStr, 10);
        if (isNaN(lineNum) || typeof editorView === 'undefined' || !editorView) return;

        const doc = editorView.state.doc;
        if (lineNum < 1 || lineNum > doc.lines) return;

        const lineInfo = doc.line(lineNum);
        const text = lineInfo.text;

        // 現在の行がリスト項目であるか判定
        const match = text.match(/^(\s*)([-*+]|\d+\.)(\s+(?:\[[x ]\]\s+)?)(.*)$/i);
        if (!match) return;

        const currentIndentStr = match[1];
        const currentIndentLen = currentIndentStr.length;
        
        // Scan upwards to build valid indentation levels
        let validLevels = [];
        let checkLineNum = lineNum - 1;
        let isFirstPrev = true;
        
        while (checkLineNum >= 1) {
            const prevText = doc.line(checkLineNum).text;
            const prevMatch = prevText.match(/^(\s*)([-*+]|\d+\.)/i);
            
            if (prevMatch) {
                const indent = prevMatch[1].length;
                const markerLen = prevMatch[2].length + 1; // marker width + 1 space
                
                validLevels.push(indent);
                
                if (isFirstPrev) {
                    validLevels.push(indent + markerLen);
                    isFirstPrev = false;
                }
                
                if (indent === 0) {
                    break; // Reached root level, no need to scan higher
                }
            }
            checkLineNum--;
        }
        
        validLevels.push(0); // 0 is always a valid root level
        validLevels = [...new Set(validLevels)].sort((a, b) => a - b);
        
        let newIndentStr = currentIndentStr;
        
        if (direction === 1) { // 右：インデント増加
            // DOM上の構造を見て、最初のアイテムならインデント不可
            const liElement = this.focusedElement.tagName === 'LI' ? this.focusedElement : this.focusedElement.closest('li');
            let isFirstItem = true;
            if (liElement && liElement.previousElementSibling && liElement.previousElementSibling.tagName === 'LI') {
                isFirstItem = false;
            } else if (!isFirstPrev) {
                // DOMで見つからなくても、直前にリスト項目があればフォールバック的に許可する
                isFirstItem = false;
            }
            
            if (isFirstItem) {
                return;
            }
            
            // 現在のインデントより一段深い正しいインデント量を探す
            const nextLevel = validLevels.find(l => l > currentIndentLen);
            if (nextLevel === undefined) {
                return; // 既に最大インデントに達している
            }
            newIndentStr = ' '.repeat(nextLevel);
            
        } else if (direction === -1) { // 左：インデント減少
            if (currentIndentLen === 0) return;
            
            const liElement = this.focusedElement.tagName === 'LI' ? this.focusedElement : this.focusedElement.closest('li');
            if (liElement && liElement.querySelector('ul, ol')) {
                // 下の行が自分より深くインデントされている（子要素を持つ）場合は不可
                return; 
            }
            
            // 現在のインデントより一段浅い正しいインデント量を探す
            const prevLevels = validLevels.filter(l => l < currentIndentLen);
            const nextLevel = prevLevels.length > 0 ? prevLevels[prevLevels.length - 1] : 0;
            newIndentStr = ' '.repeat(nextLevel);
        }
        
        if (newIndentStr.length !== currentIndentLen) {
            const newText = newIndentStr + match[2] + match[3] + match[4];
            
            editorView.dispatch({
                changes: { from: lineInfo.from, to: lineInfo.to, insert: newText }
            });
            
            AppState.text = editorView.state.doc.toString();
            AppState.isModified = true;
            AppState.hasUnsavedChanges = true;
            
            this.restoreFocusLine = lineNum;
            if (typeof render === 'function') render();
        }
    },

    /**
     * 指定したブロックの下に新しいテキストブロックを挿入し、即座にインライン編集を開始する
     */
    insertTextBlock(blockElement) {
        this._focusModeInsertSource = blockElement;
        this._handleFocusModeInsert('\n\u200B', 'insert-text-block', { type: 'paragraph' });
    },

};

// プレビュー上のインライン編集状態を判定するグローバル関数
window.isInlineEditing = function () {
    // 1. 通常テキストのインライン編集 (PreviewInlineEdit)
    const textEditing = typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.isEditing;

    // 2. コードブロックのインライン編集 (InlineCodeEditor)
    const codeEditing = typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeEditorView !== null;

    return textEditing || codeEditing;
};

// 外部からアクセスできるようにグローバルオブジェクトに登録
window.PreviewInlineEdit = PreviewInlineEdit;
