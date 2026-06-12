
/**
 * Table Editor Module
 * Provides interactive editing capabilities for Markdown tables in the preview area.
 */

const TableEditor = {
    // State
    editingTableIndex: -1,
    activeTable: null,
    dragSrcEl: null,
    dragSrcIndex: -1,
    dragType: null, // 'row' or 'col'
    copiedRowData: null,

    // セル単体編集用の状態
    activeCellElement: null,   // 現在フォーカス中のセル（選択状態）
    editingCellElement: null,  // 現在編集中のセル
    _cellOriginalText: null,   // Escape で戻す用の元テキスト

    // 範囲選択用状態
    isMouseDownForSelection: false,
    selectionStartCell: null,
    selectionEndCell: null,
    selectedCells: [],
    pendingFocusCellIndex: null, // 再描画後に選択復帰させるセルのインデックス
    pendingEditCellIndex: null,  // 再描画後にインライン編集を開始させるセルのインデックス

    /**
     * Initialize table editor functionality
     * @param {HTMLElement} table - The table element in the preview
     * @param {number} index - Index of the table in the document
     */
    init(table, index) {
        if (table.dataset.eventsBound) {
            table.setAttribute('data-table-index', index);
            return;
        }
        table.dataset.eventsBound = 'true';
        table.setAttribute('data-table-index', index);


        // Context Menu
        table.addEventListener('contextmenu', (e) => this.handleContextMenu(e, table, index));

        // Styling for interaction
        table.classList.add('interactive-table');



        // 複数セル選択イベントの初期化
        this.setupCellSelectionEvents(table);

        // 古いハンドルのクリーンアップ
        this.refreshRowHandles(table);
    },

    /**
     * Start editing mode for a table
     */
    startEdit(table, index) {
        //         console.log(`[TableEditor] startEdit called for table #${index}. Current activeTable:`, this.activeTable);

        // セル単体編集が進行中であれば先に保存・終了してから表エディタを起動する
        if (this.editingCellElement) {
            this.saveCellEdit();
        }
        this.clearCellFocus();

        if (this.activeTable) {
            if (!this.activeTable.isConnected) {
                //                 console.warn('[TableEditor] activeTable is detached from DOM. Clearing dead state.');
                this.activeTable = null;
                this.editingTableIndex = -1;
                const btn = document.getElementById('table-editor-done-btn');
                if (btn) btn.remove();
            } else {
                //                 console.warn('[TableEditor] Already editing a table. activeTable:', this.activeTable);
                return;
            }
        }

        if (!table.isConnected) {
            //             console.warn('[TableEditor] Target table is detached. Cannot start edit.');
            return;
        }

        //         console.log(`Starting edit for table #${index}`);
        this.editingTableIndex = index;
        this.activeTable = table;
        table.classList.add('table-editing');
        // table.contentEditable = "true"; // D&D conflict if whole table is editable

        // Make cells editable individually
        table.querySelectorAll('th, td').forEach(cell => cell.contentEditable = "true");

        // Initialize Drag & Drop
        this.enableDragDrop(table);

        // Initialize Row Controls (Add/Delete on Hover)
        this.setupRowControlUI();

        // Add "Done" button
        this.showDoneButton(table);

        // Bind and store handlers to preserve 'this' context and allow removal
        this._boundHandlePaste = this.handlePaste.bind(this);
        this._boundHandleKeydown = this.handleKeydown.bind(this);
        this._boundHandleSelection = this.handleSelection.bind(this);

        // Handle Paste (CSV/TSV)
        table.addEventListener('paste', this._boundHandlePaste);

        // Handle Enter key (insert <br>) and Navigations
        table.addEventListener('keydown', this._boundHandleKeydown);

        // Handle Text Selection for Mini Toolbar
        table.addEventListener('mouseup', this._boundHandleSelection);
        table.addEventListener('keyup', this._boundHandleSelection);
    },

    /**
     * Stop editing mode and save changes
     */
    saveAndExit() {
        //         console.log(`[TableEditor] saveAndExit called. activeTable:`, this.activeTable);
        //         console.trace('[TableEditor] saveAndExit call stack');
        if (!this.activeTable) return;

        const table = this.activeTable;
        const index = this.editingTableIndex;

        // [FIX] Reset state BEFORE anything else to prevent infinite loops
        this.activeTable = null;
        this.editingTableIndex = -1;

        // Cleanup DOM and listeners
        table.contentEditable = "false";
        table.classList.remove('table-editing');

        if (this._boundHandlePaste) {
            table.removeEventListener('paste', this._boundHandlePaste);
            this._boundHandlePaste = null;
        }
        if (this._boundHandleKeydown) {
            table.removeEventListener('keydown', this._boundHandleKeydown);
            this._boundHandleKeydown = null;
        }
        if (this._boundHandleSelection) {
            table.removeEventListener('mouseup', this._boundHandleSelection);
            table.removeEventListener('keyup', this._boundHandleSelection);
            this._boundHandleSelection = null;
            this.hideMiniToolbar();
        }

        // Remove sticky positioning listeners
        if (this._positionHandler) {
            window.removeEventListener('scroll', this._positionHandler);
            window.removeEventListener('resize', this._positionHandler);
            this._positionHandler = null;
        }

        if (this.dragManager) {
            this.dragManager.destroy();
            this.dragManager = null;
        }

        const btn = document.getElementById('table-editor-done-btn');
        if (btn) btn.remove();

        // プレビューの再描画などで既にDOMから消えている場合は保存処理をスキップ
        if (!table.isConnected) {
            //             console.warn('[TableEditor] Table is detached from DOM. Aborting markdown update to prevent overwriting newer edits.');
            return;
        }

        // Serialize table to Markdown
        const markdown = this.serializeTable(table);

        // Update main editor text (triggers render)
        this.updateMarkdownSource(table, markdown);

        // [NEW] 完了時にプレビュー側のスクロール位置に合わせてエディタを同期する
        setTimeout(() => {
            if (typeof syncEditorFromPreview === 'function') {
                syncEditorFromPreview();
            }
        }, 150);
    },

    // --- Cell-Level Inline Editing ---

    /**
     * セルを「選択状態」にする（編集は開始しない）
     * @param {HTMLElement} cell - th または td 要素
     */
    focusCell(cell) {
        if (!cell || !cell.matches('th, td')) return;

        // 表エディタが起動中の場合はセル単体フォーカスを無視する
        if (this.activeTable) return;

        const table = cell.closest('table');
        this.clearSelection();
        this.selectionStartCell = cell;
        this.selectionEndCell = cell;
        this.updateRangeSelection(table);
    },

    /**
     * セル選択状態を解除する
     */
    clearCellFocus() {
        if (this.activeCellElement) {
            this.activeCellElement.classList.remove('table-cell-focused');
            this.activeCellElement = null;
        }
    },

    /**
     * セル単体のインライン編集を開始する
     * @param {HTMLElement} cell     - th または td 要素
     * @param {number|null} clientX  - クリック位置 X（カーソル設定用）
     * @param {number|null} clientY  - クリック位置 Y（カーソル設定用）
     */
    startCellEdit(cell, clientX = null, clientY = null) {
        console.log('[startCellEdit] 開始:', cell, 'clientX:', clientX, 'clientY:', clientY);
        console.trace('[startCellEdit] 呼び出しスタック');

        // キーボードナビゲーションの未発火 setTimeout をキャンセルする（手動操作による編集開始などで旧ナビが割り込むのを防ぐ）
        if (this._pendingNavTimeout !== undefined && this._pendingNavTimeout !== null) {
            clearTimeout(this._pendingNavTimeout);
            this._pendingNavTimeout = null;
        }

        if (!cell || !cell.matches('th, td')) {
            console.log('[startCellEdit] 無効なセルでリターン');
            return;
        }

        // 表エディタが起動中の場合はセル単体編集を無視する（表エディタが優先）
        if (this.activeTable) {
            console.log('[startCellEdit] activeTableが設定されているのでリターン:', this.activeTable);
            return;
        }

        // 既に同じセルを編集中なら何もしない
        if (this.editingCellElement === cell) {
            console.log('[startCellEdit] 既に同じセルを編集中なのでリターン');
            return;
        }

        // 別のセルを編集中なら先に保存する
        if (this.editingCellElement && this.editingCellElement !== cell) {
            console.log('[startCellEdit] 別セルを編集中のため先に保存');
            this.saveCellEdit();
        }

        // セル内にコピーボタンがある場合は削除しておく
        const copyBtn = cell.querySelector('.table-cell-copy-btn');
        if (copyBtn) {
            copyBtn.remove();
        }

        // 元のテキストを保存（Escape でキャンセル用）― button 要素のテキストは除いて保存
        const origClone = cell.cloneNode(true);
        origClone.querySelectorAll('button').forEach(b => b.remove());
        this._cellOriginalText = origClone.innerText;
        this.editingCellElement = cell;
        console.log('[startCellEdit] _cellOriginalText:', JSON.stringify(this._cellOriginalText));

        // セル選択状態のスタイルを解除して編集中スタイルを適用
        cell.classList.remove('table-cell-focused');
        cell.classList.add('table-cell-editing');
        this.activeCellElement = null;

        // セル内の button 要素を編集対象外にしてカーソルの侵入を射止する
        const btns = cell.querySelectorAll('button');
        console.log('[startCellEdit] cell内のbutton数:', btns.length, btns);
        btns.forEach(btn => {
            btn.contentEditable = 'false';
            btn.style.pointerEvents = 'none';
            btn.tabIndex = -1;
        });

        // セルを contentEditable にする
        cell.contentEditable = 'true';
        console.log('[startCellEdit] cell.contentEditable設定完了. innerHTML:', cell.innerHTML);

        // イベントリスナーをバインドして登録
        this._boundCellKeydown = this._handleCellKeydown.bind(this);
        this._boundCellBlur = this._handleCellBlur.bind(this);
        this._boundCellPaste = this.handlePaste.bind(this);
        this._boundCellSelection = this.handleSelection.bind(this);
        
        cell.addEventListener('keydown', this._boundCellKeydown);
        cell.addEventListener('blur', this._boundCellBlur, true);
        cell.addEventListener('paste', this._boundCellPaste);
        cell.addEventListener('mouseup', this._boundCellSelection);
        cell.addEventListener('keyup', this._boundCellSelection);

        // フォーカスを当ててカーソルを設定する
        setTimeout(() => {
            // 編集対象セルが変わっていたらスキップ（他のセルに切り替わった場合やキャンセル後）
            if (!this.editingCellElement || this.editingCellElement !== cell) {
                console.log('[startCellEdit:setTimeout] 編集対象セルが変わったため中断');
                return;
            }

            // setEditorText() が 2回目の docChanged を引き起こし、その render が
            // contentEditable を 'false' にリセットすることがある。
            // ここで再適用することで確実に編集状態を維持する。
            if (cell.contentEditable !== 'true') {
                cell.contentEditable = 'true';
            }
            if (!cell.classList.contains('table-cell-editing')) {
                cell.classList.add('table-cell-editing');
            }

            // 先にフォーカスを確保する（これにより基本的な入力は受け付けられる）
            cell.focus();
            console.log('[startCellEdit:setTimeout] cell.focus()完了. document.activeElement:', document.activeElement);

            // クリック位置にカーソルを設定する（マウスクリック起動時）
            if (clientX !== null && clientY !== null) {
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
                console.log('[startCellEdit:setTimeout] caretRangeFromPoint結果:', range);
                if (range) {
                    // カーソルがボタン要素の内部に入っていないか確認する
                    const container = range.startContainer;
                    const insideBtn = container.nodeType === Node.ELEMENT_NODE
                        ? container.closest('button')
                        : (container.parentNode && container.parentNode.closest('button'));
                    console.log('[startCellEdit:setTimeout] range.startContainer:', container, '/ insideBtn:', insideBtn);
                    if (!insideBtn) {
                        // ボタン外のみ Range を適用する（ボタン内の場合は focus() のみ）
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                        console.log('[startCellEdit:setTimeout] Range適用完了');
                    } else {
                        console.log('[startCellEdit:setTimeout] button内のため Range 不適用, focus()のみ');
                    }
                    return;
                }
            }

            // クリック位置指定なし（Tab移動など）: ボタン外の最後のテキストノード末尾へ
            const walker = document.createTreeWalker(
                cell,
                NodeFilter.SHOW_TEXT,
                { acceptNode: (n) => n.parentNode.closest('button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
            );
            let lastText = null;
            while (walker.nextNode()) lastText = walker.currentNode;
            console.log('[startCellEdit:setTimeout] Tab移動用 lastTextノード:', lastText);

            if (lastText) {
                // テキストノードが見つかった場合はその末尾にカーソルを移動
                const sel = window.getSelection();
                const r = document.createRange();
                r.setStart(lastText, lastText.length);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                console.log('[startCellEdit:setTimeout] テキスト末尾にカーソル設定完了');
            } else {
                console.log('[startCellEdit:setTimeout] テキストノードなし（空セル）: cell.focus()のみで入力待機');
            }
        }, 0);
    },

    /**
     * 現在のセル編集を保存してMarkdownソースを更新する
     */
    async saveCellEdit() {
        if (!this.editingCellElement) return;
        const cell = this.editingCellElement;
        const table = cell.closest('table');

        // クリーンアップ
        cell.contentEditable = 'false';
        cell.classList.remove('table-cell-editing');

        if (this._boundCellKeydown) {
            cell.removeEventListener('keydown', this._boundCellKeydown);
            this._boundCellKeydown = null;
        }
        if (this._boundCellBlur) {
            cell.removeEventListener('blur', this._boundCellBlur, true);
            this._boundCellBlur = null;
        }
        if (this._boundCellPaste) {
            cell.removeEventListener('paste', this._boundCellPaste);
            this._boundCellPaste = null;
        }
        if (this._boundCellSelection) {
            cell.removeEventListener('mouseup', this._boundCellSelection);
            cell.removeEventListener('keyup', this._boundCellSelection);
            this._boundCellSelection = null;
            this.hideMiniToolbar();
        }

        this.editingCellElement = null;
        this._cellOriginalText = null;

        // テーブルが DOM に残っている場合のみ Markdown を更新する
        if (table && table.isConnected) {
            const markdown = this.serializeTable(table);
            await this.updateMarkdownSource(table, markdown);
        }
    },

    /**
     * 現在のセル編集をキャンセルして元のテキストに戻す
     */
    cancelCellEdit() {
        if (!this.editingCellElement) return;
        const cell = this.editingCellElement;

        // 元のテキストを復元する
        if (this._cellOriginalText !== null) {
            cell.innerText = this._cellOriginalText;
        }

        cell.contentEditable = 'false';
        cell.classList.remove('table-cell-editing');

        if (this._boundCellKeydown) {
            cell.removeEventListener('keydown', this._boundCellKeydown);
            this._boundCellKeydown = null;
        }
        if (this._boundCellBlur) {
            cell.removeEventListener('blur', this._boundCellBlur, true);
            this._boundCellBlur = null;
        }
        if (this._boundCellPaste) {
            cell.removeEventListener('paste', this._boundCellPaste);
            this._boundCellPaste = null;
        }
        if (this._boundCellSelection) {
            cell.removeEventListener('mouseup', this._boundCellSelection);
            cell.removeEventListener('keyup', this._boundCellSelection);
            this._boundCellSelection = null;
            this.hideMiniToolbar();
        }

        this.editingCellElement = null;
        this._cellOriginalText = null;

        // キャンセル後はセルを選択状態（フォーカス）に戻す
        this.focusCell(cell);
    },

    /**
     * セル単体編集中のキーボードナビゲーション処理
     */
    async _handleCellKeydown(e) {
        const cell = e.target;
        if (!cell || !cell.matches('th, td')) return;

        // IME変換中は無視する
        if (e.isComposing || e.keyCode === 229) return;

        // ── Escape: 編集キャンセル ──────────────────────────────────
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelCellEdit();
            return;
        }

        // ── Ctrl+Enter / Meta+Enter: 確定して選択状態に戻る（改行なし） ──
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            const rowIndex = cell.parentElement.rowIndex;
            const colIndex = cell.cellIndex;
            this.pendingFocusCellIndex = { rowIndex, colIndex };
            this.saveCellEdit(); // ← 再レンダリング発生
            return;
        }

        // ── Shift+Enter / Alt+Enter: セル内改行（<br>）を挿入 ──────────
        if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            const br = document.createElement('br');
            range.deleteContents();
            range.insertNode(br);
            // br の直後にカーソルを置く
            range.setStartAfter(br);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }

        // ── Enter: 確定して下のセルへ移動・編集開始 ─────────────────────
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const table = cell.closest('table');
            const tableDataLine = table.getAttribute('data-line');
            const row = cell.parentElement;
            const colIndex = cell.cellIndex;

            // 下の行を決定（thead → tbody またぎも考慮）
            let nextRow = row.nextElementSibling;
            if (!nextRow && row.parentElement.tagName === 'THEAD') {
                const tbody = table.querySelector('tbody');
                if (tbody) nextRow = tbody.firstElementChild;
            }
            const nextRowIndex = nextRow ? nextRow.rowIndex : -1;

            if (nextRowIndex >= 0) {
                this.pendingEditCellIndex = { rowIndex: nextRowIndex, colIndex };
                await this.saveCellEdit(); // 再レンダリング発生
                
                // 再描画が発生しなかった（Markdownに変更がなかった）場合のフォールバック
                setTimeout(() => {
                    if (this.pendingEditCellIndex) {
                        const { rowIndex, colIndex } = this.pendingEditCellIndex;
                        this.pendingEditCellIndex = null;
                        const freshTable = document.querySelector(`table[data-line="${tableDataLine}"]`) || table;
                        if (freshTable && freshTable.rows[rowIndex]) {
                            const targetCell = freshTable.rows[rowIndex].cells[colIndex];
                            if (targetCell) this.startCellEdit(targetCell);
                        }
                    }
                }, 100);
            } else if (row.parentElement.tagName === 'TBODY') {
                // 最下行で Enter 押下時は新行を追加し、その行の同列セルを編集開始
                const currentRowIndex = row.rowIndex;
                this.pendingEditCellIndex = { rowIndex: currentRowIndex + 1, colIndex };
                await this.saveCellEdit(); // 再レンダリング発生
                this.insertRow(table, currentRowIndex + 1); // 再レンダリング発生
            } else {
                await this.saveCellEdit();
            }
            return;
        }

        // ── Tab / ArrowUp / ArrowDown: セル間移動・編集継続 ─────────────
        if (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const isShift = e.shiftKey;
            const row = cell.parentElement;
            const table = cell.closest('table');
            const tableDataLine = table.getAttribute('data-line');

            // 移動先セルの rowIndex / cellIndex を計算する（再レンダリング前のDOMで計算）
            let nextRowIndex = -1;
            let nextColIndex = -1;
            let shouldInsertRow = false;

            if (e.key === 'Tab') {
                let nextCell = isShift ? cell.previousElementSibling : cell.nextElementSibling;
                let nextRow = row;

                if (!nextCell) {
                    const section = row.parentElement;
                    nextRow = isShift ? row.previousElementSibling : row.nextElementSibling;

                    // thead/tbody またぎ処理
                    if (!nextRow) {
                        if (!isShift && section.tagName === 'THEAD') {
                            const tbody = table.querySelector('tbody');
                            if (tbody) nextRow = tbody.firstElementChild;
                        } else if (isShift && section.tagName === 'TBODY') {
                            const thead = table.querySelector('thead');
                            if (thead) nextRow = thead.lastElementChild;
                        }
                    }

                    if (nextRow) {
                        nextCell = isShift ? nextRow.lastElementChild : nextRow.firstElementChild;
                    } else if (!isShift && section.tagName === 'TBODY') {
                        // 最終行末: 新しい行を追加
                        shouldInsertRow = true;
                    }
                }

                if (!shouldInsertRow && nextCell) {
                    nextRowIndex = nextCell.parentElement.rowIndex;
                    nextColIndex = nextCell.cellIndex;
                }
            } else {
                // ArrowUp / ArrowDown
                const isUp = e.key === 'ArrowUp';
                let nextRow = isUp ? row.previousElementSibling : row.nextElementSibling;

                if (!nextRow) {
                    const section = row.parentElement;
                    if (!isUp && section.tagName === 'THEAD') {
                        const tbody = table.querySelector('tbody');
                        if (tbody) nextRow = tbody.firstElementChild;
                    } else if (isUp && section.tagName === 'TBODY') {
                        const thead = table.querySelector('thead');
                        if (thead) nextRow = thead.lastElementChild;
                    }
                }
                if (nextRow) {
                    nextRowIndex = nextRow.rowIndex;
                    nextColIndex = cell.cellIndex;
                }
            }

            const currentRowIndex = row.rowIndex;

            if (shouldInsertRow) {
                // 最終行末: 新行を追加してから先頭セルへ移動
                const insertIndex = currentRowIndex + 1;
                this.pendingEditCellIndex = { rowIndex: insertIndex, colIndex: 0 };
                await this.saveCellEdit();
                this.insertRow(table, insertIndex);
            } else if (nextRowIndex >= 0) {
                this.pendingEditCellIndex = { rowIndex: nextRowIndex, colIndex: nextColIndex };
                await this.saveCellEdit();
                
                // 再描画が発生しなかった（Markdownに変更がなかった）場合のフォールバック
                setTimeout(() => {
                    if (this.pendingEditCellIndex) {
                        const { rowIndex, colIndex } = this.pendingEditCellIndex;
                        this.pendingEditCellIndex = null;
                        const freshTable = document.querySelector(`table[data-line="${tableDataLine}"]`) || table;
                        if (freshTable && freshTable.rows[rowIndex]) {
                            const targetCell = freshTable.rows[rowIndex].cells[colIndex];
                            if (targetCell) this.startCellEdit(targetCell);
                        }
                    }
                }, 100);
            }
            return;
        }
    },

    /**
     * セルのフォーカスが外れた時の処理
     * 表内の別セルへ移動する場合は重複保存を避ける
     */
    _handleCellBlur(e) {
        if (!this.editingCellElement) return;

        const cell = this.editingCellElement;
        const next = e.relatedTarget;

        // 移動先が同じ表内のセルならば、そちらの startCellEdit で保存が行われるのでスキップ
        if (next && next.matches('td, th') && next.closest('table') === cell.closest('table')) {
            return;
        }

        // 表の外（または他の表）へフォーカスが移動したら保存する
        this.saveCellEdit();
    },

    // --- Global Row Control Logic ---

    initGlobalListeners() {
        const preview = document.getElementById('preview');
        if (!preview) return;

        // Clean up stale UI when re-initializing
        this.hideEditButton();
        this.hideRowControls(true);

        // One-time setup for the UI container
        this.setupRowControlUI();

        // Delegate mousemove on preview to handle all tables
        if (this._globalHoverHandler) {
            preview.removeEventListener('mousemove', this._globalHoverHandler);
        }
        this._globalHoverHandler = (e) => this.handleGlobalRowHover(e);
        preview.addEventListener('mousemove', this._globalHoverHandler);

        // Hide if leaving preview
        if (this._previewLeaveHandler) {
            preview.removeEventListener('mouseleave', this._previewLeaveHandler);
        }
        this._previewLeaveHandler = (e) => {
            // Check if moving to the edit button, row controls, row drag handle, or col drag handle (which are in body)
            if (e.relatedTarget && (
                e.relatedTarget.closest('.inline-edit-btn') || 
                e.relatedTarget.closest('#table-row-controls') ||
                e.relatedTarget.closest('.table-row-drag-handle') ||
                e.relatedTarget.closest('.table-col-drag-handle')
            )) {
                return;
            }
            this.hideRowControls();
            this.hideEditButton();
            this.hideRowDragHandle();
            this.hideColDragHandle();
        };
        preview.addEventListener('mouseleave', this._previewLeaveHandler);

        // Setup global row drag & drop
        this.setupGlobalRowDragDrop(preview);

        // Add hover listener for Edit Button on Tables
        this.setupTableHoverListeners(preview);
    },

    setupGlobalRowDragDrop(preview) {
        if (this.globalRowDragManager) {
            this.globalRowDragManager.destroy();
            this.globalRowDragManager = null;
        }

        // シングルトンハンドルの生成（行用）
        if (!this.rowDragHandle) {
            this.rowDragHandle = document.createElement('div');
            this.rowDragHandle.className = 'table-row-drag-handle drag-handle';
            this.rowDragHandle.innerHTML = '⠿';
            this.rowDragHandle.title = 'ドラッグして行を移動';
            this.rowDragHandle.contentEditable = 'false';
            
            this.rowDragHandle.addEventListener('mouseenter', () => {
                this.rowDragHandle.style.display = 'block';
            });
            this.rowDragHandle.addEventListener('mouseleave', (e) => {
                if (e.relatedTarget && !e.relatedTarget.closest('table') && !e.relatedTarget.closest('.table-row-drag-handle')) {
                    this.hideRowDragHandle();
                }
            });
            
            document.body.appendChild(this.rowDragHandle);
        }

        // シングルトンハンドルの生成（列用）
        if (!this.colDragHandle) {
            this.colDragHandle = document.createElement('div');
            this.colDragHandle.className = 'table-col-drag-handle drag-handle';
            this.colDragHandle.innerHTML = '⠿';
            this.colDragHandle.title = 'ドラッグして列を移動';
            this.colDragHandle.contentEditable = 'false';
            
            this.colDragHandle.addEventListener('mouseenter', () => {
                this.colDragHandle.style.display = 'block';
            });
            this.colDragHandle.addEventListener('mouseleave', (e) => {
                if (e.relatedTarget && !e.relatedTarget.closest('table') && !e.relatedTarget.closest('.table-col-drag-handle')) {
                    this.hideColDragHandle();
                }
            });
            
            document.body.appendChild(this.colDragHandle);
        }

        if (typeof PointerDragManager !== 'undefined') {
            // グローバル行ドラッグマネージャーのセットアップ
            this.globalRowDragManager = new PointerDragManager({
                container: document.body,
                itemSelector: '#preview tbody tr',
                handleSelector: '.table-row-drag-handle',
                draggingClass: 'dragging-ghost',
                getDragItem: (handle, e) => {
                    return this.activeHoveredTr || null;
                },
                onDragStart: (item, e) => {
                    item.classList.add('dragging-source');
                    if (this.rowDragHandle) {
                        this.rowDragHandle.style.display = 'none';
                    }
                    return { type: 'row', item, index: item.rowIndex };
                },
                onDragMove: (data, e, info) => {
                },
                onDragEnd: (data, e) => {
                    if (data && data.item) {
                        data.item.classList.remove('dragging-source');
                    }
                },
                onDrop: (data, dropTarget, e, dropBefore) => {
                    if (!data) return;
                    const target = dropTarget ? dropTarget.closest('tr') : null;
                    if (!target || target === data.item) return;

                    const targetIndex = target.rowIndex;
                    if (target.parentElement.tagName === 'THEAD') return;

                    const table = data.item.closest('table');
                    if (table) {
                        this.moveRow(table, data.index, targetIndex, dropBefore);
                    }
                }
            });

            // グローバル列ドラッグマネージャーのセットアップ
            if (this.globalColDragManager) {
                this.globalColDragManager.destroy();
                this.globalColDragManager = null;
            }
            this.globalColDragManager = new PointerDragManager({
                container: document.body,
                itemSelector: '#preview th',
                handleSelector: '.table-col-drag-handle',
                draggingClass: 'dragging-ghost',
                getDragItem: (handle, e) => {
                    return this.activeHoveredTh || null;
                },
                onDragStart: (item, e) => {
                    item.classList.add('dragging-source');
                    if (this.colDragHandle) {
                        this.colDragHandle.style.display = 'none';
                    }
                    return { type: 'col', item, index: item.cellIndex };
                },
                onDragMove: (data, e, info) => {
                },
                onDragEnd: (data, e) => {
                    if (data && data.item) {
                        data.item.classList.remove('dragging-source');
                    }
                },
                onDrop: (data, dropTarget, e, dropBefore) => {
                    if (!data) return;
                    const target = dropTarget ? dropTarget.closest('th') : null;
                    if (!target || target === data.item) return;

                    const targetIndex = target.cellIndex;
                    const table = data.item.closest('table');
                    if (table) {
                        this.moveColumn(table, data.index, targetIndex, dropBefore);
                        this.saveChangesImmediate(table);
                    }
                }
            });
        }
    },

    showRowDragHandle(tr) {
        if (!this.rowDragHandle) return;

        // ドラッグ中は表示更新しない
        if (this.globalRowDragManager && this.globalRowDragManager.isDragging) {
            return;
        }

        this.activeHoveredTr = tr;

        const rect = tr.getBoundingClientRect();
        
        // tr の右外側に配置 (画面外へのはみ出しを防ぐため maxLeft を設定)
        const dragHandleWidth = 24; // パディング込みの最大幅想定
        const maxLeft = window.innerWidth - dragHandleWidth - 5;
        const left = Math.min(rect.right + 5, maxLeft);
        const top = rect.top + (rect.height / 2) - 11; // 11 はフォントサイズとパディングを考慮した半値

        this.rowDragHandle.style.left = `${left}px`;
        this.rowDragHandle.style.top = `${top}px`;
        this.rowDragHandle.style.display = 'block';
    },

    hideRowDragHandle() {
        if (this.globalRowDragManager && this.globalRowDragManager.isDragging) {
            return;
        }

        if (this.rowDragHandle) {
            this.rowDragHandle.style.display = 'none';
        }
        this.activeHoveredTr = null;
    },

    showColDragHandle(cell) {
        if (!this.colDragHandle) return;

        // ドラッグ中は表示更新しない
        if (this.globalColDragManager && this.globalColDragManager.isDragging) {
            return;
        }

        const table = cell.closest('table');
        if (!table) return;

        const colIndex = cell.cellIndex;
        const th = table.querySelector(`thead tr th:nth-child(${colIndex + 1})`) || 
                   table.querySelector(`tr th:nth-child(${colIndex + 1})`);
        
        if (!th) return;

        this.activeHoveredTh = th;

        const rect = th.getBoundingClientRect();
        
        // 列の中央の少し上に配置
        const left = rect.left + (rect.width / 2) - 10;
        const top = Math.max(rect.top - 20, 60);

        this.colDragHandle.style.left = `${left}px`;
        this.colDragHandle.style.top = `${top}px`;
        this.colDragHandle.style.display = 'block';
    },

    hideColDragHandle() {
        if (this.globalColDragManager && this.globalColDragManager.isDragging) {
            return;
        }

        if (this.colDragHandle) {
            this.colDragHandle.style.display = 'none';
        }
        this.activeHoveredTh = null;
    },

    setupTableHoverListeners(preview) {
        if (this._tableHoverOverHandler) {
            preview.removeEventListener('mouseover', this._tableHoverOverHandler);
        }
        if (this._tableHoverOutHandler) {
            preview.removeEventListener('mouseout', this._tableHoverOutHandler);
        }

        this._tableHoverOverHandler = (e) => {
            const table = e.target.closest('table');
            if (table) {
                const isInteractive = table.classList.contains('interactive-table');
                //                 console.log(`[TableEditor] mouseover table. isInteractive: ${isInteractive}, activeTable:`, this.activeTable);
                if (isInteractive) {
                    if (this.activeTable === table) return; // Already editing
                    this.showEditButton(table);
                }
            }
        };

        this._tableHoverOutHandler = (e) => {
            // Check if moving to the edit button?
            if (e.relatedTarget && (e.relatedTarget.closest('.inline-edit-btn') || e.relatedTarget.closest('table'))) {
                //                 console.log('[TableEditor] mouseout: moving to button or same table, keeping edit button');
                return;
            }
            //             console.log('[TableEditor] mouseout: hiding edit button');
            this.hideEditButton();
        };

        preview.addEventListener('mouseover', this._tableHoverOverHandler);
        preview.addEventListener('mouseout', this._tableHoverOutHandler);
    },

    showEditButton(table) {
        if (this.editButton && this.editButton._targetTable === table) {
            return;
        }
        this.hideEditButton();

        // ボタングループコンテナを作成
        const btnGroup = document.createElement('div');
        btnGroup.className = 'table-btn-group';
        btnGroup.style.position = 'absolute';
        btnGroup._targetTable = table;


        const extractTableData = () => {
             // 編集モード状態を保存するためserializeTableに似た抽出
            const rows = Array.from(table.rows);
            return rows.map(tr => {
                return Array.from(tr.cells).map(cell => {
                    const clone = cell.cloneNode(true);
                    clone.querySelectorAll('.drag-handle').forEach(h => h.remove());
                    // 改行のみをスペースに置換するよう修正（/\n| /g は誤り）
                    return clone.innerText.replace(/\n/g, ' ').trim();
                });
            });
        };

        // 【機能2】CSVコピーボタン
        const csvBtn = document.createElement('button');
        csvBtn.className = 'inline-edit-btn table-export-btn';
        csvBtn.textContent = 'CSV';
        csvBtn.title = 'CSV形式でコピー';
        csvBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const data = extractTableData();
            const csvStr = data.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
            navigator.clipboard.writeText(csvStr);
            if(window.showToast) window.showToast(t('toast.copiedAsCsv'), 'info');
        };

        // 【機能3】TSVコピーボタン
        const tsvBtn = document.createElement('button');
        tsvBtn.className = 'inline-edit-btn table-export-btn';
        tsvBtn.textContent = 'TSV';
        tsvBtn.title = 'TSV形式でコピー（Excel用）';
        tsvBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const data = extractTableData();
            const tsvStr = data.map(row => row.join('\t')).join('\n');
            navigator.clipboard.writeText(tsvStr);
            if(window.showToast) window.showToast(t('toast.copiedAsTsv'), 'info');
        };

        btnGroup.appendChild(csvBtn);
        btnGroup.appendChild(tsvBtn);

        document.body.appendChild(btnGroup);

        const updatePos = () => {
            if (!btnGroup.isConnected) return;
            const r = table.getBoundingClientRect();
            btnGroup.style.top = (r.top + window.scrollY + 4) + 'px';
            btnGroup.style.right = 'auto';
            btnGroup.style.left = (r.right + window.scrollX - btnGroup.offsetWidth - 4) + 'px';
        };
        // wait for render to get full offsetWidth
        setTimeout(updatePos, 0);

        this.editButton = btnGroup;
    },

    hideEditButton() {
        if (this.editButton) {
            this.editButton.remove();
            this.editButton = null;
        }
    },

    setupRowControlUI() {
        if (document.getElementById('table-row-controls')) return;

        const rowControls = document.createElement('div');
        rowControls.id = 'table-row-controls';
        rowControls.className = 'table-row-controls';

        // Add Button (+)
        const addBtn = document.createElement('div');
        addBtn.className = 'row-control-btn row-add-btn';
        addBtn.innerHTML = '+';
        addBtn.title = '行を追加';
        addBtn.onclick = (e) => this.handleRowControlAction(e, 'add');

        // Delete Button (-)
        const delBtn = document.createElement('div');
        delBtn.className = 'row-control-btn row-del-btn';
        delBtn.innerHTML = '-';
        delBtn.title = '行を削除';
        delBtn.onclick = (e) => this.handleRowControlAction(e, 'delete');

        rowControls.appendChild(addBtn);
        rowControls.appendChild(delBtn);
        document.body.appendChild(rowControls);

        this.rowControlUI = { container: rowControls, add: addBtn, del: delBtn };

        // Keep visible if hovering buttons
        rowControls.addEventListener('mouseleave', () => {
            this.hideRowControls();
        });
    },

    hideRowControls(force = false) {
        if (this.rowControlUI && this.rowControlUI.container) {
            // Check if we are really leaving or just moving to the button
            setTimeout(() => {
                const hoverBtn = this.rowControlUI.container.matches(':hover');
                const hoverTable = document.querySelectorAll('.interactive-table:hover').length > 0;

                if (!hoverBtn && (!hoverTable || force)) {
                    this.rowControlUI.container.style.display = 'none';
                }
            }, 50);
        }
    },

    handleGlobalRowHover(e) {
        // 1. Check if target is inside a table
        let cell = e.target.closest('th, td');

        // [Updated] Buffer zone logic: Check if we are near the left edge of a table (30px)
        if (!cell) {
            // Check specific points to the right to see if we are near a table
            // We check +30px.
            const potentialElem = document.elementFromPoint(e.clientX + 30, e.clientY);
            const nearCell = potentialElem ? potentialElem.closest('th, td') : null;

            if (nearCell) {
                const rect = nearCell.getBoundingClientRect();
                // Confirm we are within 30px left of the cell
                if (e.clientX < rect.left && e.clientX >= rect.left - 30) {
                    cell = nearCell;
                }
            }
        }

        // [New] Right-side buffer zone logic: Check if we are near the right edge of a table (30px)
        if (!cell) {
            // Check specific points to the left to see if we are near a table
            // We check -30px.
            const potentialElem = document.elementFromPoint(e.clientX - 30, e.clientY);
            const nearCell = potentialElem ? potentialElem.closest('th, td') : null;

            if (nearCell) {
                const rect = nearCell.getBoundingClientRect();
                // Confirm we are within 30px right of the cell
                if (e.clientX > rect.right && e.clientX <= rect.right + 30) {
                    cell = nearCell;
                }
            }
        }

        // [New] Top-side buffer zone logic: Check if we are slightly above a table cell (within 25px)
        if (!cell) {
            // Check specific points below to see if we are near a table
            // We check +25px.
            const potentialElem = document.elementFromPoint(e.clientX, e.clientY + 25);
            const nearCell = potentialElem ? potentialElem.closest('th, td') : null;

            if (nearCell) {
                const rect = nearCell.getBoundingClientRect();
                // Confirm we are within 25px above the cell
                if (e.clientY < rect.top && e.clientY >= rect.top - 25) {
                    cell = nearCell;
                }
            }
        }

        if (!cell) {
            // If hovering buttons, don't hide
            if (!e.target.closest('#table-row-controls')) {
                this.hideRowControls();
            }
            if (!e.target.closest('.table-row-drag-handle')) {
                this.hideRowDragHandle();
            }
            if (!e.target.closest('.table-col-drag-handle')) {
                this.hideColDragHandle();
            }
            return;
        }

        const table = cell.closest('table');
        if (!table || !table.classList.contains('interactive-table')) return;

        // 列ドラッグハンドルの表示
        this.showColDragHandle(cell);

        // [New] Inside restriction: Hide if cursor is too far right (more than 30px from left edge)
        const tableRect = table.getBoundingClientRect();
        if (e.clientX > tableRect.left + 30) {
            this.hideRowControls(true);
            
            // ドラッグハンドルはテーブル全域のホバーで表示したいので、ここで表示させる
            const tr = cell.closest('tr');
            if (tr && tr.parentElement.tagName !== 'THEAD') {
                this.showRowDragHandle(tr);
            } else {
                this.hideRowDragHandle();
            }
            return;
        }

        const tr = cell.closest('tr');
        if (!tr) return;

        // ドラッグハンドルの表示 (tbody tr のみ)
        if (tr.parentElement.tagName !== 'THEAD') {
            this.showRowDragHandle(tr);
        } else {
            this.hideRowDragHandle();
        }

        // 2. Logic: Near Left Edge of the TABLE (first column)
        // With the above restrict check, we know we are near the left edge.
        // We can skip the cellIndex check or keep it as sanity check.
        // But the "Inside restriction" handles the main requirement.

        // Show Controls
        const rect = tr.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const height = rect.height;

        // Thresholds
        const edgeThreshold = 0.25;

        let mode = null;
        if (relativeY < height * edgeThreshold) {
            mode = 'add-top';
        } else if (relativeY > height * (1 - edgeThreshold)) {
            mode = 'add-bottom';
        } else {
            mode = 'delete';
        }

        this.showRowControl(mode, tr, rect);
    },

    showRowControl(mode, tr, rect) {
        const ui = this.rowControlUI;
        if (!ui) return;

        ui.container.style.display = 'block';
        ui.currentTr = tr;
        ui.currentMode = mode;
        // Store table ref in UI for action handler
        ui.currentTable = tr.closest('table');

        const btnHeight = 24; // Updated size

        // Position: Left of the table row
        const left = rect.left - 30; // 30px offset

        let top;

        if (mode === 'delete') {
            ui.add.style.display = 'none';
            ui.del.style.display = 'flex';
            top = rect.top + (rect.height / 2) - (btnHeight / 2);
        } else {
            ui.del.style.display = 'none';
            ui.add.style.display = 'flex';
            if (mode === 'add-top') {
                top = rect.top - (btnHeight / 2);
            } else {
                top = rect.bottom - (btnHeight / 2);
            }
        }

        ui.container.style.position = 'fixed';
        ui.container.style.left = left + 'px';
        ui.container.style.top = top + 'px';
    },

    handleRowControlAction(e, action) {
        e.stopPropagation();
        const ui = this.rowControlUI;
        if (!ui || !ui.currentTr || !ui.currentTable) return;

        const tr = ui.currentTr;
        const table = ui.currentTable;
        const rowIndex = tr.rowIndex;

        // Determine if we are in "Edit Mode" for this table
        // If this.activeTable === table, we are.
        // If not, we need to apply change and save immediately.

        const isEditing = (this.activeTable === table);

        if (action === 'delete') {
            this.deleteRow(table, rowIndex);
            ui.container.style.display = 'none';
        } else if (action === 'add') {
            const insertIndex = (ui.currentMode === 'add-bottom') ? rowIndex + 1 : rowIndex;
            this.insertRow(table, insertIndex);
            ui.container.style.display = 'none';
        }
    },


    /**
     * Show "Done" button (Edit Mode Only)
     */
    showDoneButton(table) {
        let btn = document.getElementById('table-editor-done-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'table-editor-done-btn';
            btn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.done') || '完了' : '完了';
            btn.className = 'inline-done-btn'; // Reuse inline editor style
            btn.onclick = (e) => {
                //                 console.log('[TableEditor] Done button natively clicked!', e);
                this.saveAndExit();
            };
            document.body.appendChild(btn);
        }

        // Show button
        btn.style.display = 'block';
        this.updateButtonPosition();

        // Add scroll/resize listeners for sticky positioning
        this._positionHandler = () => this.updateButtonPosition();
        window.addEventListener('scroll', this._positionHandler, { passive: true });
        window.addEventListener('resize', this._positionHandler);
    },

    updateButtonPosition() {
        const btn = document.getElementById('table-editor-done-btn');
        if (!btn || !this.activeTable) return;

        // Ensure button is fixed so it doesn't take full width (if display: block)
        // This fixes the issue where btnRect.width was equal to viewportWidth
        btn.style.position = 'fixed';
        btn.style.right = 'auto';
        btn.style.width = 'auto';

        const tableRect = this.activeTable.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        // Vertical Position: Sticky to Top of visible Table area
        let top = Math.max(tableRect.top, 60);
        const limitBottom = tableRect.bottom - btnRect.height - 10;
        if (top > limitBottom) top = limitBottom;

        // Horizontal Position: Sticky to Right of visible Table area
        const padding = 20;

        // Target is the rightmost visible edge: min(Table Right, Viewport Width)
        const visibleRight = Math.min(tableRect.right, viewportWidth);
        let left = visibleRight - btnRect.width - padding;

        // Safety: Ensure it doesn't float way off to the left if table is scrolled far left
        if (left < tableRect.left + padding) {
            left = Math.max(left, tableRect.left + padding);
        }

        // Apply coordinates
        btn.style.top = top + 'px';
        btn.style.left = left + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    },

    /**
     * Handle Context Menu
     */
    handleContextMenu(e, table, index) {
        e.preventDefault();

        // 既存のコンテキストメニューがあれば閉じる
        if (this.activeMenu) {
            if (this.activeMenu.parentNode) {
                this.activeMenu.parentNode.removeChild(this.activeMenu);
            }
            if (this.activeMenuCloseListener) {
                document.removeEventListener('click', this.activeMenuCloseListener);
            }
            this.activeMenu = null;
            this.activeMenuCloseListener = null;
        }

        // Determine target (Header or Body)
        const target = e.target;
        const tagName = target.tagName.toLowerCase();
        const cell = target.closest('th, td');
        if (!cell) return;

        const isHeader = cell.tagName.toLowerCase() === 'th';

        // Create Menu
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        this.activeMenu = menu;

        let closeMenu; // Define earlier for reference in createItem

        const createItem = (label, action) => {
            const item = document.createElement('div');
            item.className = 'ctx-menu-item';
            item.textContent = label;
            item.onclick = () => {
                action();
                if (menu.parentNode) {
                    menu.parentNode.removeChild(menu);
                }
                if (closeMenu) {
                    document.removeEventListener('click', closeMenu);
                }
                if (this.activeMenu === menu) {
                    this.activeMenu = null;
                    this.activeMenuCloseListener = null;
                }
            };
            menu.appendChild(item);
        };

        if (isHeader) {
            createItem('左揃え', () => this.setAlign(table, cell.cellIndex, 'left'));
            createItem('中央揃え', () => this.setAlign(table, cell.cellIndex, 'center'));
            createItem('右揃え', () => this.setAlign(table, cell.cellIndex, 'right'));
            menu.appendChild(document.createElement('hr'));
            createItem('列を挿入 (左)', () => this.insertColumn(table, cell.cellIndex));
            createItem('列を挿入 (右)', () => this.insertColumn(table, cell.cellIndex + 1));
            createItem('列を右に複製', () => this.duplicateColumn(table, cell.cellIndex));
            createItem('列を削除', () => this.deleteColumn(table, cell.cellIndex));
            menu.appendChild(document.createElement('hr'));
            createItem('昇順ソート', () => this.sortTable(table, cell.cellIndex, true));
            createItem('降順ソート', () => this.sortTable(table, cell.cellIndex, false));
        } else {
            const row = cell.parentElement;
            createItem('行を挿入 (上)', () => this.insertRow(table, row.rowIndex));
            createItem('行を挿入 (下)', () => this.insertRow(table, row.rowIndex + 1));
            menu.appendChild(document.createElement('hr'));
            createItem('行をコピー', () => this.copyRow(table, row.rowIndex));
            createItem('コピー行を挿入', () => this.insertCopiedRow(table, row.rowIndex));
            menu.appendChild(document.createElement('hr'));
            createItem('行を削除', () => this.deleteRow(table, row.rowIndex));
            menu.appendChild(document.createElement('hr'));
            createItem('合計列を追加', () => this.addTotalColumn(table));
            createItem('合計行を追加', () => this.addTotalRow(table));
        }

        // Position menu
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        document.body.appendChild(menu);

        // Click outside to close
        closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                if (menu.parentNode) menu.parentNode.removeChild(menu);
                document.removeEventListener('click', closeMenu);
                if (this.activeMenu === menu) {
                    this.activeMenu = null;
                    this.activeMenuCloseListener = null;
                }
            }
        };
        this.activeMenuCloseListener = closeMenu;
        // Delay adding listener to avoid immediate triggering
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    // --- Table Operations (Header) ---

    setAlign(table, colIndex, align) {
        // Just update DOM classes for visual feedback. 
        // Real change happens when serialized.
        const rows = table.rows;
        for (let i = 0; i < rows.length; i++) {
            const cell = rows[i].cells[colIndex];
            if (cell) {
                cell.style.textAlign = align;
                cell.className = cell.className.replace(/align-(left|center|right)/g, '') + ` align-${align}`;
            }
        }
        // If not in edit mode, commit immediately
        if (!this.activeTable) {
            const markdown = this.serializeTable(table);
            this.updateMarkdownSource(table, markdown);
        }
    },

    insertColumn(table, colIndex) {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cell = row.children[colIndex] || row.children[row.children.length - 1]; // Fallback
            const newCell = document.createElement(row.tagName === 'THEAD' || row.parentElement.tagName === 'THEAD' ? 'th' : 'td');
            newCell.textContent = ' ';

            if (row.children[colIndex]) {
                row.insertBefore(newCell, row.children[colIndex]);
            } else {
                // If appending to the right end, just append to the row
                row.appendChild(newCell);
            }
        });
        this.saveChangesImmediate(table);
    },

    deleteColumn(table, colIndex) {
        const rows = table.querySelectorAll('tr');
        if (rows[0].cells.length <= 1) return; // Prevent deleting last column
        rows.forEach(row => {
            if (row.cells[colIndex]) row.deleteCell(colIndex);
        });
        this.saveChangesImmediate(table);
    },

    duplicateColumn(table, colIndex) {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cell = row.children[colIndex];
            if (!cell) return;
            const newCell = cell.cloneNode(true);
            
            // ドラッグハンドル複製防止
            newCell.querySelectorAll('.drag-handle').forEach(h => h.remove());

            if (row.children[colIndex + 1]) {
                row.insertBefore(newCell, row.children[colIndex + 1]);
            } else {
                row.appendChild(newCell);
            }
        });
        
        // ヘッダにドラッグハンドルを再生成させるためにリフレッシュが必要
        if (this.activeTable === table) {
            table.querySelectorAll('th, td').forEach(c => c.contentEditable = "true");
            this.enableDragDrop(table);
        }
        
        this.saveChangesImmediate(table);
    },

    sortTable(table, colIndex, asc) {
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
            const aVal = a.cells[colIndex].textContent.trim();
            const bVal = b.cells[colIndex].textContent.trim();

            // Numeric check
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);

            if (!isNaN(aNum) && !isNaN(bNum)) {
                return asc ? aNum - bNum : bNum - aNum;
            }
            return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        });

        rows.forEach(row => tbody.appendChild(row));
        this.saveChangesImmediate(table);
    },

    // --- Table Operations (Body) ---

    insertRow(table, rowIndex) {
        const tbody = table.querySelector('tbody');
        const colCount = table.rows[0].cells.length;
        const newRow = document.createElement('tr');
        for (let i = 0; i < colCount; i++) {
            const td = document.createElement('td');
            td.textContent = ' ';
            if (this.activeTable === table) td.contentEditable = "true"; // 編集中なら編集可能にする
            newRow.appendChild(td);
        }

        // rowIndex includes thead rows. Adjust for tbody.
        const theadRows = table.querySelector('thead')?.rows?.length || 0;
        const targetIndex = rowIndex - theadRows;

        if (targetIndex >= 0 && targetIndex < tbody.rows.length) {
            tbody.insertBefore(newRow, tbody.rows[targetIndex]);
        } else {
            tbody.appendChild(newRow);
        }
        
        if (this.activeTable === table) {
            this.refreshRowHandles(table);
        }
        
        this.saveChangesImmediate(table);
    },



    // --- Interaction Handlers ---

    handlePaste(e) {
        e.preventDefault();
        e.stopPropagation();
        const text = (e.clipboardData || window.clipboardData).getData('text');

        // TSV parser (CSVサポートはPapaParse等が必要になり実装が複雑化するため、要望があるまで見送りとします)
        const rows = text.trim().split(/\r\n|\n|\r/);

        // カンマ(,)での分割は行わず、タブ(\t)のみで分割します（Excelやスプレッドシートからのコピペに対応）
        const data = rows.map(row => row.split('\t'));

        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const startNode = selection.anchorNode;
        const startCell = (startNode.nodeType === 3 ? startNode.parentNode : startNode).closest('td, th');

        if (!startCell) return;

        const table = startCell.closest('table');
        const startRowIndex = startCell.parentNode.rowIndex;
        const startColIndex = startCell.cellIndex;

        // [New] Column Expansion Logic
        let maxColsNeeded = 0;
        data.forEach(rowData => {
            const needed = startColIndex + rowData.length;
            if (needed > maxColsNeeded) maxColsNeeded = needed;
        });

        const currentCols = table.rows[0].cells.length;
        if (maxColsNeeded > currentCols) {
            const colsToAdd = maxColsNeeded - currentCols;
            // Add columns to ALL rows
            Array.from(table.rows).forEach(tr => {
                const isHeader = tr.parentElement.tagName === 'THEAD' || tr.querySelector('th');
                const tag = isHeader ? 'th' : 'td';
                for (let i = 0; i < colsToAdd; i++) {
                    const cell = document.createElement(tag);
                    cell.textContent = ' '; // Empty content
                    cell.contentEditable = "true"; // Ensure editable
                    tr.appendChild(cell);
                }
            });
        }

        data.forEach((rowData, rIdx) => {
            const currentRowIndex = startRowIndex + rIdx;
            let row = table.rows[currentRowIndex];

            // Create new row if needed
            if (!row) {
                const tbody = table.querySelector('tbody');
                row = document.createElement('tr');
                // Use the NEW column count (maxColsNeeded or currentCols if no expansion)
                const targetColCount = Math.max(currentCols, maxColsNeeded);

                for (let k = 0; k < targetColCount; k++) {
                    const td = document.createElement('td');
                    td.textContent = ' ';
                    td.contentEditable = "true";
                    row.appendChild(td);
                }
                tbody.appendChild(row);
            }

            rowData.forEach((cellData, cIdx) => {
                const currentColIndex = startColIndex + cIdx;
                const cell = row.cells[currentColIndex];
                if (cell) {
                    cell.textContent = cellData.trim();
                }
            });
        });

        // ペースト完了後の保存処理
        if (this.activeTable === table) {
            this.saveChangesImmediate(table);
        } else {
            this.saveCellEdit();
        }
    },

    handleKeydown(e) {
        const cell = e.target;
        if (!cell || !cell.matches('th, td')) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);

            // Insert <br>
            const br = document.createElement('br');
            range.deleteContents();
            range.insertNode(br);

            // Move caret after <br>
            range.setStartAfter(br);
            range.collapse(true);

            selection.removeAllRanges();
            selection.addRange(range);

            br.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const isShift = e.shiftKey;
            const row = cell.parentElement;
            const table = cell.closest('table');
            
            let nextCell = isShift ? cell.previousElementSibling : cell.nextElementSibling;
            let nextRow = row;
            
            if (!nextCell) {
                nextRow = isShift ? row.previousElementSibling : row.nextElementSibling;
                // thead/tbody またぎ
                const section = row.parentElement;
                if (!nextRow) {
                    if (!isShift && section.tagName === 'THEAD') {
                        const tbody = table.querySelector('tbody');
                        if (tbody) nextRow = tbody.firstElementChild;
                    } else if (isShift && section.tagName === 'TBODY') {
                        const thead = table.querySelector('thead');
                        if (thead) nextRow = thead.lastElementChild;
                    }
                }

                if (nextRow) {
                    nextCell = isShift ? nextRow.lastElementChild : nextRow.firstElementChild;
                } else if (!isShift && section.tagName === 'TBODY') {
                    // 自動行追加
                    this.insertRow(table, row.rowIndex + 1);
                    nextRow = row.nextElementSibling;
                    if (nextRow) nextCell = nextRow.firstElementChild;
                }
            }

            if (nextCell) {
                nextCell.focus();
                const r = document.createRange();
                
                // ドラッグハンドル（ある場合）以降を選択範囲にする
                const handle = nextCell.querySelector('.drag-handle');
                if (handle && handle.nextSibling) {
                    r.setStartBefore(handle.nextSibling);
                    if (nextCell.lastChild) r.setEndAfter(nextCell.lastChild);
                } else {
                    r.selectNodeContents(nextCell);
                }
                
                // 有効な文字列が存在しない(スペースのみ等)場合は選択せず末尾にカーソルを置く
                const textContent = nextCell.textContent.replace('⠿', '').trim();
                if (textContent.length === 0) {
                    r.collapse(false);
                }
                
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(r);
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const isUp = e.key === 'ArrowUp';
            const row = cell.parentElement;
            const table = cell.closest('table');
            let nextRow = isUp ? row.previousElementSibling : row.nextElementSibling;
            
            if (!nextRow) {
                const section = row.parentElement;
                if (!isUp && section.tagName === 'THEAD') {
                    const tbody = table.querySelector('tbody');
                    if (tbody) nextRow = tbody.firstElementChild;
                } else if (isUp && section.tagName === 'TBODY') {
                    const thead = table.querySelector('thead');
                    if (thead) nextRow = thead.lastElementChild;
                }
            }
            if (nextRow) {
                const targetCell = nextRow.children[cell.cellIndex];
                if (targetCell) {
                    e.preventDefault();
                    targetCell.focus();
                    const r = document.createRange();
                    r.selectNodeContents(targetCell);
                    r.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(r);
                }
            }
        }
    },

    // --- Mini Format Toolbar ---
    handleSelection(e) {
        // 短い遅延を入れて選択完了を待つ
        setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed || sel.toString().trim() === '') {
                this.hideMiniToolbar();
                return;
            }

            // 選択範囲が本当に編集中テーブルのセルか確認
            let node = sel.anchorNode;
            if (node && node.nodeType === 3) node = node.parentNode;
            const cell = node ? node.closest('th, td') : null;
            if (!cell || cell.closest('table') !== (this.activeTable || this.editingCellElement?.closest('table'))) {
                this.hideMiniToolbar();
                return;
            }

            // 範囲の座標を取得してツールバーを表示
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            this.showMiniToolbar(rect);
        }, 10);
    },

    showMiniToolbar(rect) {
        if (!this.miniToolbar) {
            const tb = document.createElement('div');
            tb.className = 'mini-format-toolbar';
            
            const createBtn = (label, htmlTag, title) => {
                const b = document.createElement('button');
                b.innerHTML = label;
                b.title = title;
                b.onmousedown = (e) => {
                    e.preventDefault(); // 選択解除を防ぐ
                    this.applyFormat(htmlTag);
                };
                return b;
            };

            tb.appendChild(createBtn('<b>B</b>', 'b', '太字'));
            tb.appendChild(createBtn('<i>I</i>', 'i', '斜体'));
            tb.appendChild(createBtn('<s>S</s>', 's', '取り消し線'));
            tb.appendChild(createBtn('<code>C</code>', 'code', 'インラインコード'));
            
            document.body.appendChild(tb);
            this.miniToolbar = tb;
        }

        this.miniToolbar.style.display = 'flex';
        // 位置調整: 選択領域の少し上にフロート
        const w = this.miniToolbar.offsetWidth || 120;
        this.miniToolbar.style.top = (rect.top + window.scrollY - 30) + 'px';
        this.miniToolbar.style.left = (rect.left + window.scrollX + (rect.width/2) - (w/2)) + 'px';
    },

    hideMiniToolbar() {
        if (this.miniToolbar) {
            this.miniToolbar.style.display = 'none';
        }
    },

    applyFormat(tag) {
        // execCommand で安全にHTMLタグとしてフォーマット
        const sel = window.getSelection();
        if(!sel.rangeCount) return;
        const text = sel.toString();
        // 単純なラップタグ注入 (contentEditable内で動作)
        document.execCommand('insertHTML', false, `<${tag}>${text}</${tag}>`);
        this.hideMiniToolbar();
        // すぐ保存
        if (this.activeTable) {
            this.saveChangesImmediate(this.activeTable);
        } else if (this.editingCellElement) {
            this.saveCellEdit();
        }
    },

    enableDragDrop(table) {
        if (this.dragManager) {
            this.dragManager.destroy();
            this.dragManager = null;
        }

        // Insert Drag Handles for Columns
        const headers = table.querySelectorAll('th');
        headers.forEach(th => {
            if (!th.querySelector('.drag-handle-col')) {
                const handle = document.createElement('span');
                handle.className = 'drag-handle drag-handle-col';
                handle.contentEditable = 'false';
                handle.innerHTML = '⠿'; // Six-dot handle

                th.insertBefore(handle, th.firstChild);
            }
        });

        if (typeof PointerDragManager !== 'undefined') {
            this.dragManager = new PointerDragManager({
                container: table,
                itemSelector: 'th',
                handleSelector: '.drag-handle-col',
                draggingClass: 'dragging-ghost', // Visual feedback like original
                onDragStart: (item, e) => {
                    const handle = e.target.closest('.drag-handle-col');
                    if (!handle) return null;

                    this.dragSrcEl = item;
                    this.dragType = 'col';
                    this.dragSrcIndex = item.cellIndex;

                    item.classList.add('dragging-source');

                    return { type: 'col', item, index: this.dragSrcIndex };
                },
                onDragMove: (data, e, info) => {
                },
                onDragEnd: (data, e) => {
                    if (this.dragSrcEl) {
                        this.dragSrcEl.classList.remove('dragging-source');
                    }
                },
                onDrop: (data, dropTarget, e, dropBefore) => {
                    if (!data) return;
                    
                    const target = dropTarget ? dropTarget.closest('th') : null;
                    if (!target || target === this.dragSrcEl) return;

                    const targetIndex = target.cellIndex;
                    this.moveColumn(this.activeTable, this.dragSrcIndex, targetIndex, dropBefore);
                    this.refreshRowHandles(this.activeTable);
                }
            });
        }
    },

    moveColumn(table, fromIndex, toIndex, dropBefore) {
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = Array.from(row.cells);
            const fromCell = cells[fromIndex];
            const toCell = cells[toIndex];
            
            if (fromCell && toCell) {
                if (dropBefore !== undefined) {
                    if (dropBefore) {
                        row.insertBefore(fromCell, toCell);
                    } else {
                        row.insertBefore(fromCell, toCell.nextSibling);
                    }
                } else {
                    if (fromIndex < toIndex) {
                        row.insertBefore(fromCell, toCell.nextSibling);
                    } else {
                        row.insertBefore(fromCell, toCell);
                    }
                }
            }
        });
        
        this.saveChangesImmediate(table);
    },

    moveRow(table, fromIndex, toIndex, dropBefore) {
        const rows = Array.from(table.rows);
        const fromRow = rows[fromIndex];
        const toRow = rows[toIndex];

        // Check if both are in tbody
        if (!fromRow || !toRow || fromRow.parentElement.tagName !== 'TBODY' || toRow.parentElement.tagName !== 'TBODY') return;

        const parent = fromRow.parentNode;
        
        if (dropBefore !== undefined) {
            if (dropBefore) {
                parent.insertBefore(fromRow, toRow);
            } else {
                parent.insertBefore(fromRow, toRow.nextSibling);
            }
        } else {
            if (fromIndex < toIndex) {
                parent.insertBefore(fromRow, toRow.nextSibling);
            } else {
                parent.insertBefore(fromRow, toRow);
            }
        }
        
        this.saveChangesImmediate(table);
    },

    /**
     * Refresh row handles after column move.
     * Ensures handles are always in the first column.
     */
    refreshRowHandles(table) {
        if (!table) return;

        // 古い左端の drag-handle-row や右端の既存ハンドルがあれば全て削除（動的シングルトン化のため個別アタッチは行わない）
        table.querySelectorAll('.drag-handle-row, .table-row-drag-handle').forEach(h => h.remove());
    },

    // --- Serialization & Sync ---

    serializeTable(table) {
        if (!table) return '';
        // Convert DOM table back to GFM Markdown
        let md = "";
        const rows = Array.from(table.rows);

        // Helper to get text excluding handles and convert formats to Markdown
        const getCellText = (cell) => {
            const clone = cell.cloneNode(true);
            // ドラッグハンドルやUIボタンなど表示専用要素を除去する
            clone.querySelectorAll('.drag-handle, button').forEach(h => h.remove());
            let html = clone.innerHTML;
            
            // HTMLの装飾タグをMarkdown記法に変換
            html = html.replace(/<(b|strong)\b[^>]*>(.*?)<\/\1>/gi, '**$2**');
            html = html.replace(/<(i|em)\b[^>]*>(.*?)<\/\1>/gi, '*$2*');
            html = html.replace(/<(s|strike|del)\b[^>]*>(.*?)<\/\1>/gi, '~~$2~~');
            html = html.replace(/<code\b[^>]*>(.*?)<\/code>/gi, '`$1`');
            
            // ブラウザが自動挿入する実体参照スペースをプレーンなスペースに変換
            html = html.replace(/&nbsp;/gi, ' ');

            html = html.replace(/\|/g, '\\|');
            return html.replace(/\n/g, '').trim();
        };

        // 表示幅計算 (全角は2、半角は1)
        const getDisplayWidth = (str) => {
            let w = 0;
            // 簡易的にASCII以外は2幅とする
            for (let i = 0; i < str.length; i++) {
                w += str.charCodeAt(i) <= 0x7E ? 1 : 2;
            }
            return w;
        };

        // 右または中央・左埋め
        const padText = (str, targetWidth, align = 'left') => {
            const w = getDisplayWidth(str);
            if (w >= targetWidth) return str;
            const diff = targetWidth - w;
            if (align === 'right') return ' '.repeat(diff) + str;
            if (align === 'center') return ' '.repeat(Math.floor(diff/2)) + str + ' '.repeat(Math.ceil(diff/2));
            return str + ' '.repeat(diff);
        };

        // 全行のテキストを取得して列幅の最大値を計算
        const tableData = [];
        for (let i = 0; i < rows.length; i++) {
            tableData.push(Array.from(rows[i].cells).map(cell => getCellText(cell)));
        }

        const aligns = Array.from(rows[0].cells).map(cell => {
            if (cell.style.textAlign === 'center' || cell.classList.contains('align-center')) return 'center';
            if (cell.style.textAlign === 'right' || cell.classList.contains('align-right')) return 'right';
            return 'left';
        });

        const colWidths = new Array(tableData[0].length).fill(3); // 最低幅 3
        tableData.forEach(row => {
            row.forEach((text, c) => {
                const cw = getDisplayWidth(text);
                if (cw > colWidths[c]) colWidths[c] = cw;
            });
        });

        // 1. Header
        const paddedHeaders = tableData[0].map((t, c) => padText(t, colWidths[c], aligns[c]));
        md += "| " + paddedHeaders.join(" | ") + " |\n";

        // 2. Separator
        const separator = aligns.map((a, c) => {
            const w = colWidths[c];
            if (a === 'center') return ':' + '-'.repeat(Math.max(w - 2, 1)) + ':';
            if (a === 'right') return '-'.repeat(Math.max(w - 1, 2)) + ':';
            return '-'.repeat(w);
        });
        md += "| " + separator.join(" | ") + " |\n";

        // 3. Body
        for (let i = 1; i < tableData.length; i++) {
            const paddedCells = tableData[i].map((t, c) => padText(t, colWidths[c], aligns[c]));
            md += "| " + paddedCells.join(" | ") + " |\n";
        }

        return md;
    },

    addTotalColumn(table) {
        const rows = table.querySelectorAll('tr');
        if (rows.length === 0) return;

        // 数値抽出・判定関数
        const getNumericValue = (cell) => {
            const clone = cell.cloneNode(true);
            clone.querySelectorAll('.table-cell-copy-btn, .drag-handle').forEach(el => el.remove());
            let text = clone.textContent || '';
            text = text.replace('⠿', '').trim();
            const cleanText = text.replace(/,/g, '');
            if (cleanText === '') return 0;
            const num = Number(cleanText);
            return isNaN(num) ? 0 : num;
        };

        rows.forEach(row => {
            const isHeader = row.closest('thead') || row.querySelector('th');
            if (isHeader) {
                const newCell = document.createElement('th');
                newCell.textContent = '合計';
                row.appendChild(newCell);
            } else {
                let sum = 0;
                Array.from(row.cells).forEach(cell => {
                    sum += getNumericValue(cell);
                });
                const newCell = document.createElement('td');
                newCell.textContent = String(sum);
                if (this.activeTable === table) newCell.contentEditable = "true";
                row.appendChild(newCell);
            }
        });

        this.saveChangesImmediate(table);
    },

    addTotalRow(table) {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const colCount = table.rows[0].cells.length;
        const newRow = document.createElement('tr');

        // 数値抽出・判定関数
        const getNumericValue = (cell) => {
            const clone = cell.cloneNode(true);
            clone.querySelectorAll('.table-cell-copy-btn, .drag-handle').forEach(el => el.remove());
            let text = clone.textContent || '';
            text = text.replace('⠿', '').trim();
            const cleanText = text.replace(/,/g, '');
            if (cleanText === '') return 0;
            const num = Number(cleanText);
            return isNaN(num) ? 0 : num;
        };

        for (let i = 0; i < colCount; i++) {
            let sum = 0;
            tbody.querySelectorAll('tr').forEach(row => {
                const cell = row.cells[i];
                if (cell) {
                    sum += getNumericValue(cell);
                }
            });

            const td = document.createElement('td');
            td.textContent = String(sum);
            if (this.activeTable === table) td.contentEditable = "true";
            newRow.appendChild(td);
        }

        tbody.appendChild(newRow);

        if (this.activeTable === table) {
            this.refreshRowHandles(table);
        }

        this.saveChangesImmediate(table);
    },

    deleteRow(table, rowIndex) {
        const theadRows = table.querySelector('thead')?.rows?.length || 0;
        if (rowIndex < theadRows) return; // Don't delete header via this

        table.deleteRow(rowIndex);
        this.saveChangesImmediate(table);
    },

    copyRow(table, rowIndex) {
        const row = table.rows[rowIndex];
        if (!row) return;

        // Clone the row content
        this.copiedRowData = Array.from(row.cells).map(cell => cell.innerHTML);

        // Optional: Visual feedback
        if (typeof showToast === 'function') {
            const msg = typeof t === 'function' ? t('toast.rowCopied') : '行をコピーしました';
            showToast(msg, "success");
        }
    },

    insertCopiedRow(table, rowIndex) {
        if (!this.copiedRowData) {
            if (typeof showToast === 'function') {
                const msg = typeof t === 'function' ? t('toast.noRowCopied') : 'コピーされた行がありません';
                showToast(msg, "warning");
            }
            return;
        }

        const tbody = table.querySelector('tbody');
        const newRow = document.createElement('tr');

        this.copiedRowData.forEach(html => {
            const td = document.createElement('td');
            td.innerHTML = html;
            if (this.activeTable === table) td.contentEditable = "true"; // 編集中なら編集可能にする
            newRow.appendChild(td);
        });

        const theadRows = table.querySelector('thead')?.rows?.length || 0;
        const targetIndex = rowIndex - theadRows;

        // Insert after the target row
        if (targetIndex < 0) {
            if (tbody.firstChild) {
                tbody.insertBefore(newRow, tbody.firstChild);
            } else {
                tbody.appendChild(newRow);
            }
        } else if (targetIndex < tbody.rows.length) {
            tbody.insertBefore(newRow, tbody.rows[targetIndex].nextSibling);
        } else {
            tbody.appendChild(newRow);
        }

        if (this.activeTable === table) {
            this.refreshRowHandles(table);
        }

        this.saveChangesImmediate(table);
    },

    saveChangesImmediate(table) {
        if (!table) return;
        // 編集中ならDOMの変更を確定させるだけとし、再描画でフォーカスが飛ぶのを防ぐ
        if (this.activeTable === table) {
            return;
        }
        
        // 非編集中（コンテキストメニュー操作など）なら即座にMarkdownを更新する
        const markdown = this.serializeTable(table);
        this.updateMarkdownSource(table, markdown);
    },

    async updateMarkdownSource(tableOrIndex, newTableMarkdown) {
        const text = AppState.text;
        const lines = text.split('\n');

        let tableStartLine = -1;
        let tableEndLine = -1;
        let isObject = (typeof tableOrIndex === 'object' && tableOrIndex !== null);

        const isSeparatorRow = (l) => {
            const line = l.trim();
            if (!line || !line.includes('-')) return false;
            const cells = line.replace(/^\||\|$/g, '').split('|');
            return cells.every(c => /^\s*:?-+:?\s*$/.test(c));
        };

        // [NEW] Use precise data-line if an element is passed
        if (isObject) {
            const sl = parseInt(tableOrIndex.getAttribute('data-line'), 10);
            if (!isNaN(sl)) {
                const tempStart = sl - 1;

                // 開始行が有効で、かつパイプ行であり、アラインメント行ではないことを確認
                if (tempStart >= 0 && tempStart < lines.length) {
                    const firstLine = lines[tempStart].trim();
                    if (firstLine.startsWith('|') && !isSeparatorRow(firstLine)) {
                        // 開始行から下方向に、パイプ行が連続する終端をスキャンして tempEnd を決定する
                        let tempEnd = tempStart;
                        while (tempEnd + 1 < lines.length && lines[tempEnd + 1].trim().startsWith('|')) {
                            tempEnd++;
                        }

                        // 範囲内にアラインメント行（セパレーター行）が含まれているか検証
                        let hasSeparator = false;
                        for (let k = tempStart + 1; k <= tempEnd; k++) {
                            if (isSeparatorRow(lines[k])) {
                                hasSeparator = true;
                                break;
                            }
                        }

                        if (hasSeparator) {
                            tableStartLine = tempStart;
                            tableEndLine = tempEnd;
                        }
                    }
                }
                if (tableStartLine === -1 || tableEndLine === -1) {
                    console.warn(`[TableEditor] Invalid table range from data-line attribute: ${sl}. Falling back to scan.`);
                }
            }
        }

        // Fallback to naive block scanning if data-line is missing or index was passed
        if (tableStartLine === -1 || tableEndLine === -1) {
            let targetIndex = isObject ? parseInt(tableOrIndex.dataset.tableIndex, 10) : tableOrIndex;
            let currentTableIndex = 0;
            let inTable = false;
            let inCodeBlock = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.match(/^```/)) {
                    inCodeBlock = !inCodeBlock;
                }
                if (inCodeBlock) continue;

                const tLine = line.trim();
                const isPipeLine = tLine.startsWith('|');

                if (!inTable) {
                    if (isPipeLine && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
                        inTable = true;
                        tableStartLine = i;
                    }
                } else {
                    if (!isPipeLine) {
                        if (currentTableIndex === targetIndex) {
                            tableEndLine = i - 1;
                            break;
                        }
                        inTable = false;
                        currentTableIndex++;
                    }
                }
            }

            if (inTable && tableEndLine === -1) {
                if (currentTableIndex === targetIndex) {
                    tableEndLine = lines.length - 1;
                }
            }
        }

        if (tableStartLine !== -1 && tableEndLine !== -1) {
            const before = lines.slice(0, tableStartLine).join('\n');
            const after = lines.slice(tableEndLine + 1).join('\n');
            const newText = (before ? before + '\n' : '') + newTableMarkdown.trim() + (after ? '\n' + after : '');

            // CM6 の dispatch() が履歴を自動管理するため、独自スタックへの push は不要

            // Update Editor
            setEditorText(newText);
            AppState.text = newText;

            // Trigger Render (debounce handled usually, but here immediate might be better to see result)
            // But full render will kill our edit state if we were editing.
            // Since this function is called on "Done" or Context Menu (Atomic actions), full render is fine.
            if (typeof render === 'function') {
                await render();
            }
        } else {
            //             console.error('Could not find corresponding table in source');
        }
    },

    setupNonEditDragDrop(table) {
        // 廃止: グローバルのドラッグ＆ドロップマネージャーで処理されるため不要
    },

    setupCellSelectionEvents(table) {
        table.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 左クリックのみ

            // コピーボタンをクリックした場合はセル選択を処理しない
            if (e.target.closest('.table-cell-copy-btn')) {
                return;
            }

            // 現在インライン編集中の場合は無視
            if (this.editingCellElement) return;

            // 表全体エディタが起動中の場合も、ここでは単体フォーカスを無視
            if (this.activeTable) return;

            const cell = e.target.closest('td, th');
            if (!cell) return;

            if (typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.focusedElement !== table) {
                PreviewInlineEdit.startFocus(table);
            }

            if (e.shiftKey) {
                // Shift+クリックによる範囲拡張
                if (!this.selectionStartCell) {
                    this.selectionStartCell = cell;
                }
                this.selectionEndCell = cell;
                this.updateRangeSelection(table);
            } else if (e.ctrlKey || e.metaKey) {
                // Ctrl+クリックによる離れたセルのトグル選択
                this.toggleCellSelection(cell);
                this.selectionStartCell = cell;
                this.selectionEndCell = cell;
            } else {
                // 新規選択
                this.clearSelection();
                this.selectionStartCell = cell;
                this.selectionEndCell = cell;
                this.isMouseDownForSelection = true;
                table.classList.add('selecting-cells');
                this.updateRangeSelection(table);
            }
        });

        table.addEventListener('mousemove', (e) => {
            if (!this.isMouseDownForSelection) return;

            const cell = e.target.closest('td, th');
            if (!cell) return;

            if (cell !== this.selectionEndCell) {
                this.selectionEndCell = cell;
                this.updateRangeSelection(table);
            }
        });

        if (!this._documentMouseUpBound) {
            document.addEventListener('mouseup', () => {
                this.isMouseDownForSelection = false;
                document.querySelectorAll('.selecting-cells').forEach(t => {
                    t.classList.remove('selecting-cells');
                });
            });
            this._documentMouseUpBound = true;
        }
    },

    updateRangeSelection(table) {
        if (!this.selectionStartCell || !this.selectionEndCell) return;

        const cells = this.getCellsInRange(this.selectionStartCell, this.selectionEndCell);

        // 既存の選択スタイルを削除
        this.selectedCells.forEach(c => {
            c.classList.remove('table-cell-selected');
        });

        // 新しい選択スタイルを適用
        this.selectedCells = cells;
        this.selectedCells.forEach(c => {
            c.classList.add('table-cell-selected');
        });

        // 起点セルをアクティブセル（table-cell-focused）にする
        if (this.activeCellElement) {
            this.activeCellElement.classList.remove('table-cell-focused');
        }
        this.activeCellElement = this.selectionStartCell;
        this.activeCellElement.classList.add('table-cell-focused');
        this.updateSelectedCellsStatus();
    },

    toggleCellSelection(cell) {
        if (!cell) return;

        const index = this.selectedCells.indexOf(cell);
        if (index > -1) {
            // すでに選択されていれば解除
            this.selectedCells.splice(index, 1);
            cell.classList.remove('table-cell-selected');

            if (this.activeCellElement === cell) {
                cell.classList.remove('table-cell-focused');
                // 代わりのアクティブセルを設定（残っている最後のセル）
                this.activeCellElement = this.selectedCells[this.selectedCells.length - 1] || null;
                if (this.activeCellElement) {
                    this.activeCellElement.classList.add('table-cell-focused');
                }
            }
        } else {
            // 選択されていなければ追加
            this.selectedCells.push(cell);
            cell.classList.add('table-cell-selected');

            // 新しくクリックしたセルをアクティブにする
            if (this.activeCellElement) {
                this.activeCellElement.classList.remove('table-cell-focused');
            }
            this.activeCellElement = cell;
            this.activeCellElement.classList.add('table-cell-focused');
        }
        this.updateSelectedCellsStatus();
    },

    clearSelection() {
        this.selectedCells.forEach(c => {
            c.classList.remove('table-cell-selected');
        });
        this.selectedCells = [];
        this.selectionStartCell = null;
        this.selectionEndCell = null;
        this.clearCellFocus();
        this.updateSelectedCellsStatus();
    },

    handleFocusedCellKeydown(e) {
        const key = e.key;
        if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Escape' && key !== 'Enter' && key !== 'F2' && key !== 'Tab') {
            return false;
        }

        const activeCell = this.activeCellElement || this.selectionStartCell;
        if (!activeCell) return false;

        const table = activeCell.closest('table');
        if (!table) return false;

        // Escape: 選択解除
        if (key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.clearSelection();
            if (typeof PreviewInlineEdit !== 'undefined') {
                PreviewInlineEdit.clearFocus();
            }
            return true;
        }

        // Enter / F2: 選択中のセルを編集開始
        if (key === 'Enter' || key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            const cellToEdit = this.activeCellElement;
            this.clearSelection();
            this.focusCell(cellToEdit);
            this.startCellEdit(cellToEdit);
            return true;
        }

        // Tab / Shift+Tab キーによるセル間移動および最下行末尾での自動行追加
        if (key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            const isShift = e.shiftKey;
            const row = activeCell.parentElement;
            const colIndex = activeCell.cellIndex;
            const section = row.parentElement;
            
            let nextCell = isShift ? activeCell.previousElementSibling : activeCell.nextElementSibling;
            let nextRow = row;
            let shouldInsertRow = false;
            
            if (!nextCell) {
                nextRow = isShift ? row.previousElementSibling : row.nextElementSibling;
                // thead/tbody またぎ
                if (!nextRow) {
                    if (!isShift && section.tagName === 'THEAD') {
                        const tbody = table.querySelector('tbody');
                        if (tbody) nextRow = tbody.firstElementChild;
                    } else if (isShift && section.tagName === 'TBODY') {
                        const thead = table.querySelector('thead');
                        if (thead) nextRow = thead.lastElementChild;
                    }
                }
                
                if (nextRow) {
                    nextCell = isShift ? nextRow.lastElementChild : nextRow.firstElementChild;
                } else if (!isShift && section.tagName === 'TBODY') {
                    shouldInsertRow = true;
                }
            }
            
            if (shouldInsertRow) {
                const tableDataLine = table.getAttribute('data-line');
                const currentRowIndex = row.rowIndex;
                this.insertRow(table, currentRowIndex + 1);
                
                setTimeout(() => {
                    const freshTable = document.querySelector(`table[data-line="${tableDataLine}"]`);
                    if (!freshTable) return;
                    const newRowEl = freshTable.rows[currentRowIndex + 1];
                    if (!newRowEl) return;
                    const firstCell = newRowEl.firstElementChild;
                    if (firstCell) {
                        this.clearSelection();
                        this.focusCell(firstCell);
                    }
                }, 50);
            } else if (nextCell) {
                this.clearSelection();
                this.focusCell(nextCell);
            }
            return true;
        }

        // 矢印キー処理
        const currentEnd = this.selectionEndCell || activeCell;
        const neighbor = this.getNeighborCell(currentEnd, key);

        if (neighbor) {
            e.preventDefault();
            e.stopPropagation();

            if (e.shiftKey) {
                // Shift+矢印キー: 選択範囲を拡張
                this.selectionEndCell = neighbor;
                this.updateRangeSelection(table);
            } else {
                // 矢印キー単体: 選択範囲を解除して移動
                this.clearSelection();
                this.selectionStartCell = neighbor;
                this.selectionEndCell = neighbor;
                this.updateRangeSelection(table);
            }
            return true;
        }
        return false;
    },

    getCellsInRange(startCell, endCell) {
        if (!startCell || !endCell) return [];
        const table = startCell.closest('table');
        const rows = Array.from(table.rows);
        
        const startRowIdx = startCell.parentElement.rowIndex;
        const startColIdx = startCell.cellIndex;
        const endRowIdx = endCell.parentElement.rowIndex;
        const endColIdx = endCell.cellIndex;
        
        const minRow = Math.min(startRowIdx, endRowIdx);
        const maxRow = Math.max(startRowIdx, endRowIdx);
        const minCol = Math.min(startColIdx, endColIdx);
        const maxCol = Math.max(startColIdx, endColIdx);
        
        const cells = [];
        for (let r = minRow; r <= maxRow; r++) {
            const row = rows[r];
            if (!row) continue;
            for (let c = minCol; c <= maxCol; c++) {
                if (row.cells[c]) {
                    cells.push(row.cells[c]);
                }
            }
        }
        return cells;
    },

    getNeighborCell(cell, direction) {
        const row = cell.parentElement;
        const table = cell.closest('table');
        const rowIndex = row.rowIndex;
        const colIndex = cell.cellIndex;
        
        let targetRowIndex = rowIndex;
        let targetColIndex = colIndex;
        
        switch (direction) {
            case 'ArrowUp':
                targetRowIndex = rowIndex - 1;
                break;
            case 'ArrowDown':
                targetRowIndex = rowIndex + 1;
                break;
            case 'ArrowLeft':
                targetColIndex = colIndex - 1;
                break;
            case 'ArrowRight':
                targetColIndex = colIndex + 1;
                break;
        }
        
        const targetRow = table.rows[targetRowIndex];
        if (targetRow) {
            const targetCell = targetRow.cells[targetColIndex];
            if (targetCell) {
                return targetCell;
            }
        }
        return null;
    },

    getSelectedCellsStats() {
        if (!this.selectedCells || this.selectedCells.length <= 1) {
            return { hasNumber: false, dataCount: 0, sum: 0 };
        }

        const getNumericValue = (cell) => {
            const clone = cell.cloneNode(true);
            clone.querySelectorAll('.table-cell-copy-btn, .drag-handle').forEach(el => el.remove());
            let text = clone.textContent || '';
            text = text.replace('⠿', '').trim();
            const cleanText = text.replace(/,/g, '');
            if (cleanText === '') return null;
            const num = Number(cleanText);
            return isNaN(num) ? null : num;
        };

        let hasNumber = false;
        let sum = 0;
        let dataCount = 0;

        this.selectedCells.forEach(cell => {
            const clone = cell.cloneNode(true);
            clone.querySelectorAll('.table-cell-copy-btn, .drag-handle').forEach(el => el.remove());
            const text = clone.textContent.replace('⠿', '').trim();
            if (text !== '') {
                dataCount++;
            }

            const val = getNumericValue(cell);
            if (val !== null) {
                sum += val;
                hasNumber = true;
            }
        });

        return { hasNumber, dataCount, sum };
    },

    updateSelectedCellsStatus() {
        const bar = document.getElementById('preview-status-bar');
        if (!bar) return;

        if (!this.selectedCells || this.selectedCells.length <= 1) {
            if (this._originalStatusText !== undefined) {
                bar.textContent = this._originalStatusText;
                this._originalStatusText = undefined;
            } else {
                const currentText = bar.textContent || '';
                const match = currentText.match(/^(行: \d+ 列: \d+)/);
                if (match) {
                    bar.textContent = match[1];
                } else {
                    bar.textContent = '';
                }
            }
            return;
        }

        const stats = this.getSelectedCellsStats();

        if (stats.hasNumber) {
            let baseText = '';
            const currentText = bar.textContent || '';
            const match = currentText.match(/^(行: \d+ 列: \d+)/);
            if (match) {
                baseText = match[1] + '  ';
            } else if (this._originalStatusText && this._originalStatusText.match(/^(行: \d+ 列: \d+)/)) {
                baseText = this._originalStatusText.match(/^(行: \d+ 列: \d+)/)[1] + '  ';
            }

            if (this._originalStatusText === undefined) {
                this._originalStatusText = bar.textContent;
            }
            bar.textContent = `${baseText}データの個数: ${stats.dataCount}  合計: ${stats.sum}`;
        } else {
            if (this._originalStatusText !== undefined) {
                bar.textContent = this._originalStatusText;
                this._originalStatusText = undefined;
            } else {
                const currentText = bar.textContent || '';
                const match = currentText.match(/^(行: \d+ 列: \d+)/);
                if (match) {
                    bar.textContent = match[1];
                } else {
                    bar.textContent = '';
                }
            }
        }
    }
};

// Bind to window for access
window.TableEditor = TableEditor;

window.isTableEditing = function () {
    // 全体表エディタ起動中、またはセル単体編集中のどちらかの場合に true を返す
    return typeof TableEditor !== 'undefined' &&
           (TableEditor.activeTable !== null || TableEditor.editingCellElement !== null);
};
