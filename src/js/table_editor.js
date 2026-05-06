
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

        // Add double-click to edit
        table.addEventListener('dblclick', (e) => {
            //             console.log(`[TableEditor] Table dblclicked. activeTable:`, this.activeTable);
            if (!this.activeTable) {
                this.startEdit(table, index);
            }
        });

        // Context Menu
        table.addEventListener('contextmenu', (e) => this.handleContextMenu(e, table, index));

        // Styling for interaction
        table.classList.add('interactive-table');

        // Restore edit mode if this table was being edited
        if (this.editingTableIndex === index) {
            //             console.log(`[TableEditor] Restoring edit mode for table #${index}`);
            // The activeTable reference is stale (removed from DOM), so we must clear it to allow startEdit to work
            this.activeTable = null;
            this.startEdit(table, index);
        }
    },

    /**
     * Start editing mode for a table
     */
    startEdit(table, index) {
        //         console.log(`[TableEditor] startEdit called for table #${index}. Current activeTable:`, this.activeTable);
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
            // Check if moving to the edit button or row controls (which are in body)
            if (e.relatedTarget && (e.relatedTarget.closest('.inline-edit-btn') || e.relatedTarget.closest('#table-row-controls'))) {
                return;
            }
            this.hideRowControls();
            this.hideEditButton();
        };
        preview.addEventListener('mouseleave', this._previewLeaveHandler);

        // Add hover listener for Edit Button on Tables
        this.setupTableHoverListeners(preview);
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

        // 【機能1】編集ボタン
        const editBtn = document.createElement('button');
        editBtn.className = 'inline-edit-btn';
        editBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.edit') || '編集' : '編集';
        editBtn.contentEditable = 'false';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.hideEditButton();

            if (!table.isConnected) {
                const idx = parseInt(table.dataset.tableIndex || '0', 10);
                const newTable = document.querySelector(`table[data-table-index="${idx}"]`);
                if (newTable && newTable.isConnected) table = newTable;
                else return;
            }
            const index = parseInt(table.dataset.tableIndex || '0', 10);
            this.startEdit(table, index);
        };

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
        btnGroup.appendChild(editBtn);

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

        if (!cell) {
            // If hovering buttons, don't hide
            if (!e.target.closest('#table-row-controls')) {
                this.hideRowControls();
            }
            return;
        }

        const table = cell.closest('table');
        if (!table || !table.classList.contains('interactive-table')) return;

        // [New] Inside restriction: Hide if cursor is too far right (more than 30px from left edge)
        const tableRect = table.getBoundingClientRect();
        if (e.clientX > tableRect.left + 30) {
            this.hideRowControls(true);
            return;
        }

        const tr = cell.closest('tr');
        if (!tr) return;

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

        // Determine target (Header or Body)
        const target = e.target;
        const tagName = target.tagName.toLowerCase();
        const cell = target.closest('th, td');
        if (!cell) return;

        const isHeader = cell.tagName.toLowerCase() === 'th';

        // Create Menu
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';

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
            }
        };
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
        //         console.log('Row copied:', this.copiedRowData);

        // Optional: Visual feedback
        if (typeof showToast === 'function') showToast(t('toast.rowCopied'), "success");
    },

    insertCopiedRow(table, rowIndex) {
        if (!this.copiedRowData) {
            if (typeof showToast === 'function') showToast(t('toast.noRowCopied'), "warning");
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
        // If not editing, save. If editing, assume user will click Done.
        // Actually, for context menu actions, we should probably save immediately even in edit mode, 
        // or effectively "restart" edit mode to refresh state.
        // For simplicity: Force full update.
        const markdown = this.serializeTable(table);
        this.updateMarkdownSource(table, markdown);
    },

    // --- Interaction Handlers ---

    handlePaste(e) {
        e.preventDefault();
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

        // Trigger safe save (not immediate, to avoid re-render breaking selection? 
        // Actually paste breaks selection anyway, so immediate save is fine)
        this.finalizeAction(table, true);
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
            if (!cell || cell.closest('table') !== this.activeTable) {
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
            // Note: input/keydownではないので別途手動保存するかはDoneボタン依存。
            // 念のため即時保存してもよいが、完了ボタンの方針なので一旦保留。
            // D&Dなどは即時保存(saveChangesImmediate)しているので即時保存する。
            this.saveChangesImmediate(this.activeTable);
        }
    },

    enableDragDrop(table) {
        if (this.dragManager) {
            this.dragManager.destroy();
            this.dragManager = null;
        }

        // Insert Drag Handles
        const headers = table.querySelectorAll('th');
        headers.forEach(th => {
            // Col Handle
            if (!th.querySelector('.drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'drag-handle drag-handle-col';
                handle.contentEditable = 'false';
                handle.innerHTML = '⠿'; // Six-dot handle

                th.insertBefore(handle, th.firstChild);
            }
        });

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(tr => {
            const firstCell = tr.cells[0];
            if (firstCell && !firstCell.querySelector('.drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'drag-handle drag-handle-row';
                handle.contentEditable = 'false';
                handle.innerHTML = '⠿'; // Six-dot handle

                firstCell.insertBefore(handle, firstCell.firstChild);
            }
        });

        if (typeof PointerDragManager !== 'undefined') {
            this.dragManager = new PointerDragManager({
                container: table,
                itemSelector: 'th, tbody tr',
                handleSelector: '.drag-handle',
                draggingClass: 'dragging-ghost', // Visual feedback like original
                onDragStart: (item, e) => {
                    const type = item.tagName === 'TH' ? 'col' : 'row';
                    const handle = e.target.closest('.drag-handle');
                    if (!handle) return null;
                    if (type === 'col' && !handle.classList.contains('drag-handle-col')) return null;
                    if (type === 'row' && !handle.classList.contains('drag-handle-row')) return null;

                    this.dragSrcEl = item;
                    this.dragType = type;
                    this.dragSrcIndex = type === 'col' ? item.cellIndex : item.rowIndex;

                    item.classList.add('dragging-source');

                    return { type, item, index: this.dragSrcIndex };
                },
                onDragMove: (data, e, info) => {
                    // Visual Drop Indicator Line is natively handled by PointerDragManager.
                    // We no longer apply drag-over-target rectangle.
                },
                onDragEnd: (data, e) => {
                    if (this.dragSrcEl) {
                        this.dragSrcEl.classList.remove('dragging-source');
                    }
                },
                onDrop: (data, dropTarget, e, dropBefore) => {
                    if (!data) return;
                    
                    const target = dropTarget ? dropTarget.closest(data.type === 'col' ? 'th' : 'tr') : null;
                    if (!target || target === this.dragSrcEl) return;

                    if (data.type === 'col' && target.tagName === 'TH') {
                        const targetIndex = target.cellIndex;
                        this.moveColumn(this.activeTable, this.dragSrcIndex, targetIndex, dropBefore);
                        this.refreshRowHandles(this.activeTable);
                    } else if (data.type === 'row' && target.tagName === 'TR') {
                        const targetIndex = target.rowIndex;
                        if (target.parentElement.tagName === 'THEAD') return;
                        this.moveRow(this.activeTable, this.dragSrcIndex, targetIndex, dropBefore);
                    }
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
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach(tr => {
            // 1. Remove existing handles from ALL cells in this row
            const existingHandles = tr.querySelectorAll('.drag-handle-row');
            existingHandles.forEach(h => h.remove());

            // 2. Add handle to the FIRST cell (index 0)
            const firstCell = tr.cells[0];
            if (firstCell) {
                const handle = document.createElement('span');
                handle.className = 'drag-handle drag-handle-row';
                handle.contentEditable = 'false';
                handle.innerHTML = '⠿';

                firstCell.insertBefore(handle, firstCell.firstChild);
            }
        });
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
            clone.querySelectorAll('.drag-handle').forEach(h => h.remove());
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

    updateMarkdownSource(tableOrIndex, newTableMarkdown) {
        const text = AppState.text;
        const lines = text.split('\n');

        let tableStartLine = -1;
        let tableEndLine = -1;
        let isObject = (typeof tableOrIndex === 'object' && tableOrIndex !== null);

        // [NEW] Use precise data-line if an element is passed
        if (isObject) {
            const sl = parseInt(tableOrIndex.getAttribute('data-line'), 10);
            const eline = parseInt(tableOrIndex.getAttribute('data-line-end'), 10);
            if (!isNaN(sl) && !isNaN(eline)) {
                tableStartLine = sl - 1;
                tableEndLine = eline - 1;
            }
        }

        // Fallback to naive block scanning if data-line is missing or index was passed
        if (tableStartLine === -1 || tableEndLine === -1) {
            let targetIndex = isObject ? parseInt(tableOrIndex.dataset.tableIndex, 10) : tableOrIndex;
            let currentTableIndex = 0;
            let inTable = false;
            let inCodeBlock = false;

            const isSeparatorRow = (l) => {
                const line = l.trim();
                if (!line || !line.includes('-')) return false;
                const cells = line.replace(/^\||\|$/g, '').split('|');
                return cells.every(c => /^\s*:?-+:?\s*$/.test(c));
            };

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

            // Push to Undo history
            if (UndoRedoManager) UndoRedoManager.push(newText);

            // Update Editor
            setEditorText(newText);
            AppState.text = newText;

            // Trigger Render (debounce handled usually, but here immediate might be better to see result)
            // But full render will kill our edit state if we were editing.
            // Since this function is called on "Done" or Context Menu (Atomic actions), full render is fine.
            if (typeof render === 'function') render();
        } else {
            //             console.error('Could not find corresponding table in source');
        }
    }
};

// Bind to window for access
window.TableEditor = TableEditor;

window.isTableEditing = function () {
    return typeof TableEditor !== 'undefined' && TableEditor.activeTable !== null;
};
