/**
 * UI Components & Visual Interactions
 */

// --- Utilities ---
function showToast(msg, type = 'success') {
    if (!DOM.toast) return;
    DOM.toast.textContent = msg;
    DOM.toast.className = 'show';
    setTimeout(() => DOM.toast.className = '', 3000);
}

// --- Outline Panel ---

/**
 * Toggle outline panel visibility (Markdown)
 */
function toggleOutline() {
    if (!DOM.outlinePanel) return;
    const willBeVisible = !DOM.outlinePanel.classList.contains('visible');

    if (willBeVisible) {
        DOM.outlinePanel.classList.add('visible');
        document.body.classList.add('outline-visible');
        buildOutline();
    } else {
        DOM.outlinePanel.classList.remove('visible');
        document.body.classList.remove('outline-visible');
    }
}

/**
 * Toggle SVG List panel visibility
 * @param {boolean|null} force - Force state
 */
function toggleSvgList(force = null) {
    if (!DOM.svgListPanel) return;

    const isVisible = DOM.svgListPanel.classList.contains('visible');
    const willBeVisible = force !== null ? force : !isVisible;

    if (willBeVisible) {
        DOM.svgListPanel.classList.add('visible');
        document.body.classList.add('svg-list-visible');
        if (typeof window.buildSvgList === 'function') window.buildSvgList();
    } else {
        DOM.svgListPanel.classList.remove('visible');
        document.body.classList.remove('svg-list-visible');
    }
}

/**
 * Update outline if visible
 * Referenced in renderer.js
 */
function updateOutline() {
    if (DOM.outlinePanel && DOM.outlinePanel.classList.contains('visible')) {
        buildOutline();
    }
}
window.updateOutline = updateOutline;

/**
 * Build outline from headings in preview
 */
function buildOutline() {
    const headings = DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const outlineHTML = [];

    // 折りたたみ状態を管理するスタック
    const foldStack = [];

    headings.forEach((heading, index) => {
        const level = parseInt(heading.tagName.substring(1)); // h1 -> 1, h2 -> 2, etc.
        const text = heading.textContent.trim();
        const id = heading.id;
        const isFolded = heading.classList.contains('collapsed');

        // 親要素が折りたたまれているかチェック
        // スタックを現在のレベルに合わせて調整
        while (foldStack.length > 0 && foldStack[foldStack.length - 1].level >= level) {
            foldStack.pop();
        }

        const isHidden = foldStack.length > 0;
        const hiddenClass = isHidden ? ' hidden' : '';
        const foldedClass = isFolded ? ' folded' : '';

        outlineHTML.push(`
            <div class="outline-item level-${level}${foldedClass}${hiddenClass}" 
                 data-heading-id="${id}"
                 data-heading-index="${index}"
                 data-heading-level="${level}"
                 tabindex="0"
                 title="${text}">
                <span class="fold-toggle"></span>
                <span class="outline-text">${text}</span>
            </div>
        `);

        // もしこの見出し自体が折りたたまれていたら、スタックに追加
        if (isFolded) {
            foldStack.push({ level });
        }
    });

    DOM.outlineContent.innerHTML = outlineHTML.join('');

    // Attach click events
    attachOutlineItemEvents();

    // [NEW] Attach drag and drop + keyboard events
    if (typeof attachOutlineDragAndKeyboardEvents === 'function') {
        attachOutlineDragAndKeyboardEvents();
    }

    // Highlight current heading
    if (typeof updateActiveOutlineItem === 'function') updateActiveOutlineItem();
}

/**
 * Attach click events to outline items
 */
function attachOutlineItemEvents() {
    const items = DOM.outlineContent.querySelectorAll('.outline-item');

    items.forEach((item, itemIndex) => {
        // [NEW] Add fold-toggle click handler
        const toggle = item.querySelector('.fold-toggle');
        if (toggle) {
            toggle.onclick = (e) => {
                e.stopPropagation(); // 項目自体のクリックイベント（ジャンプ）を防止
                const headingId = item.dataset.headingId;
                const targetHeading = document.getElementById(headingId);
                if (targetHeading && typeof toggleHeading === 'function') {
                    toggleHeading(targetHeading);
                }
            };
        }

        item.onclick = async () => {
            const headingId = item.dataset.headingId;

            // Use getElementById or find by matching id attribute
            let targetHeading = null;
            const allHeadings = DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
            for (const heading of allHeadings) {
                if (heading.id === headingId) {
                    targetHeading = heading;
                    break;
                }
            }

            if (!targetHeading) return;

            // [Fix] Check if in Editor-Only mode and scroll editor instead
            if (AppState.viewMode === 'editor-only' && window.editorInstance) {
                // Get the line number from the heading's data-line attribute
                const lineStr = targetHeading.getAttribute('data-line');
                const lineNumber = parseInt(lineStr, 10);

                if (!isNaN(lineNumber) && lineNumber > 0) {
                    const doc = window.editorInstance.state.doc;
                    if (lineNumber <= doc.lines) {
                        const lineInfo = doc.line(lineNumber);

                        // [Fix] Disable outline update during smooth scroll and store target index
                        window.outlineClickScrolling = true;
                        window.outlineClickTargetIndex = itemIndex;

                        // Scroll editor to this line using CodeMirror's scrollIntoView
                        window.editorInstance.dispatch({
                            effects: [window.CM6.EditorView.scrollIntoView(lineInfo.from, { y: "start", yMargin: 50 })]
                        });

                        // Re-enable and highlight the clicked item
                        setTimeout(() => {
                            window.outlineClickScrolling = false;

                            // Highlight the clicked item directly
                            const outlineItems = DOM.outlineContent.querySelectorAll('.outline-item');
                            outlineItems.forEach(i => i.classList.remove('active'));
                            if (outlineItems[itemIndex]) {
                                outlineItems[itemIndex].classList.add('active');
                                outlineItems[itemIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }

                            window.outlineClickTargetIndex = null;
                        }, 600);
                    }
                }
                return; // Skip preview scroll logic
            }

            // If folded, expand first
            if (targetHeading.classList.contains('collapsed')) {
                toggleHeading(targetHeading);

                // Wait for animation
                setTimeout(() => {
                    scrollToHeading(targetHeading);

                    // Highlight the clicked item
                    const outlineItems = DOM.outlineContent.querySelectorAll('.outline-item');
                    outlineItems.forEach(i => i.classList.remove('active'));
                    if (outlineItems[itemIndex]) {
                        outlineItems[itemIndex].classList.add('active');
                        outlineItems[itemIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                }, 300);
            } else {
                // Jump immediately
                scrollToHeading(targetHeading);

                // Highlight the clicked item
                const outlineItems = DOM.outlineContent.querySelectorAll('.outline-item');
                outlineItems.forEach(i => i.classList.remove('active'));
                if (outlineItems[itemIndex]) {
                    outlineItems[itemIndex].classList.add('active');
                    outlineItems[itemIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        };
    });
}

/**
 * Scroll to element (vertical only, preserve horizontal scroll)
 */
function scrollToHeading(element) {
    if (!element) return;

    const previewPaneRect = DOM.previewPane.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Store current horizontal scroll position
    const currentScrollLeft = DOM.previewPane.scrollLeft;

    // Calculate target scroll position (relative to preview-pane container)
    const targetScrollTop = DOM.previewPane.scrollTop + (elementRect.top - previewPaneRect.top);

    // Smooth scroll (vertical only, preserve horizontal)
    DOM.previewPane.scrollTo({
        top: targetScrollTop,
        left: currentScrollLeft, // Explicitly preserve horizontal scroll
        behavior: 'smooth'
    });
}

function makeOutlinePanelResizable() {
    const panel = document.getElementById('outline-panel');
    if (!panel) return;

    // Create resize handle if it doesn't exist
    let handle = panel.querySelector('.outline-resize-handle');
    if (!handle) {
        handle = document.createElement('div');
        handle.className = 'outline-resize-handle';
        // Style for the handle to be on the right edge
        handle.style.position = 'absolute';
        handle.style.top = '0';
        handle.style.right = '0';
        handle.style.width = '5px';
        handle.style.height = '100%';
        handle.style.cursor = 'ew-resize';
        handle.style.zIndex = '10';
        panel.appendChild(handle);
    }

    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(window.getComputedStyle(panel).width, 10);

        document.body.style.cursor = 'ew-resize';
        panel.classList.add('resizing');
        e.preventDefault(); // Prevent selection
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const delta = e.clientX - startX;
        const newWidth = startWidth + delta;

        // Min/Max constraints
        if (newWidth >= 150 && newWidth <= 800) {
            panel.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            panel.classList.remove('resizing');
        }
    });
}

/**
 * Toggle Task List Item Checkbox (Sync to Editor)
 * @param {number} lineIndex - 0-based line index
 * @param {boolean} isChecked - New checked state
 */
function toggleTaskListItem(lineIndex, isChecked) {
    if (typeof AppState === 'undefined' || !AppState.text) return;

    // Use CodeMirror 6 instance if available
    if (window.editorInstance) {
        const view = window.editorInstance;
        const doc = view.state.doc;

        // Safety check
        if (lineIndex < 0 || lineIndex >= doc.lines) return;

        // CM6 lines are 1-based
        const lineObj = doc.line(lineIndex + 1);
        const lineText = lineObj.text;

        // Regex to match task list item
        // Matches: indent + bullet + [ + char + ]
        const regex = /^(\s*[-+*]\s*)\[([ xX])\]/;
        const match = lineText.match(regex);

        if (match) {
            const currentMark = match[2];
            const newMark = isChecked ? 'x' : ' ';

            // Only update if changed
            if (currentMark !== newMark) {
                const newLineText = lineText.replace(regex, `$1[${newMark}]`);

                view.dispatch({
                    changes: { from: lineObj.from, to: lineObj.to, insert: newLineText }
                });
            }
        }
    }
}

function toggleHeading(h, fromSync = false) {
    if (!h) return;
    const headingEl = h.closest('h1, h2, h3, h4, h5, h6');
    if (!headingEl) return;

    // [GUARD] Prevent rapid double-firing for the same element
    const now = Date.now();
    if (!fromSync && headingEl._lastToggle && (now - headingEl._lastToggle < 150)) {
        return;
    }
    if (!fromSync) headingEl._lastToggle = now;

    const lock = window.foldSyncLock || { editor: false, ui: false };

    // Only block if NOT from sync and editor lock is active
    if (!fromSync && lock.editor) {
        return; // Prevent loop triggered by editor
    }

    const isCollapsed = h.classList.contains('collapsed');
    let newState = !isCollapsed; // true = collapsed, false = expanded (logic below is inverted in classList add/remove)

    if (isCollapsed) {
        h.classList.remove('collapsed');
        h.setAttribute('aria-expanded', 'true');
        showContent(h);
        AppState.foldState[h.id] = true; // Expanded
        newState = false; // Expanded
    } else {
        h.classList.add('collapsed');
        h.setAttribute('aria-expanded', 'false');
        hideContent(h);
        AppState.foldState[h.id] = false; // Collapsed
        newState = true; // Collapsed
    }

    if (typeof saveFoldState === 'function') saveFoldState();

    // Immediately update scroll map after fold/unfold to maintain sync accuracy
    if (typeof updateScrollMap === 'function') setTimeout(() => updateScrollMap(), 50);

    // Update outline if visible
    if (DOM.outlinePanel && DOM.outlinePanel.classList.contains('visible')) {
        buildOutline();
    }

    // Sync to Editor
    if (!fromSync) {
        if (window.foldSyncLock) window.foldSyncLock.ui = true;
        syncEditorFold(headingEl, newState);
        setTimeout(() => {
            if (window.foldSyncLock) window.foldSyncLock.ui = false;
        }, 300);
    }
}

/**
 * Sync fold state from UI to Editor
 */
function syncEditorFold(headingEl, isCollapsed) {
    if (!window.editorInstance) return;

    // Get line number from data-line attribute
    const line = parseInt(headingEl.getAttribute('data-line'), 10);
    if (isNaN(line)) return;

    // CM6 positions are character-based
    const lineObj = window.editorInstance.state.doc.line(line);

    if (isCollapsed) {
        if (DOM.cmCompartments && DOM.cmCompartments.fold) {
            DOM.cmCompartments.fold(lineObj.from);
        }
    } else {
        if (DOM.cmCompartments && DOM.cmCompartments.unfold) {
            DOM.cmCompartments.unfold(lineObj.from);
        }
    }
}

/**
 * Get index of heading among all headings
 */
function getHeadingIndex(h) {
    const headings = DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    return Array.from(headings).indexOf(h);
}

/**
 * Find line number in editor for the N-th heading
 */
function findEditorLineByHeadingIndex(targetIndex) {
    if (!window.editorInstance) return -1;

    // CodeMirror 6 State
    const doc = window.editorInstance.state.doc;
    const lineCount = doc.lines;
    let headingCount = 0;

    let inCodeBlock = false;
    for (let i = 1; i <= lineCount; i++) {
        const line = doc.line(i);
        const text = line.text;
        if (text.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
        // Match Markdown heading
        if (!inCodeBlock && /^#{1,6}\s/.test(text)) {
            if (headingCount === targetIndex) {
                return i - 1; // Return 0-based index for logic compatibility if needed? 
            }
            headingCount++;
        }
    }
    return -1;
}

/**
 * [New] Find the index of the heading that covers the given line number.
 * @param {number} targetLine 1-based line number (from CM6)
 * @returns {number} 0-based index of the heading in the outline, or -1 if none
 */
function findHeadingIndexByLine(targetLine) {
    if (!window.editorInstance) return -1;

    const doc = window.editorInstance.state.doc;
    const lineCount = doc.lines;

    // Guard
    if (targetLine < 1) targetLine = 1;
    if (targetLine > lineCount) targetLine = lineCount;

    let headingsCount = -1; // We want 0-based index
    let lastFoundHeadingIndex = -1;

    // Iterate specific range? No, to get accurate index we need to count ALL headings from top to targetLine.
    // Optimization: Just iterate from 1 to targetLine.
    let inCodeBlock = false;
    for (let i = 1; i <= targetLine; i++) {
        const line = doc.line(i);
        if (line.text.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
        if (!inCodeBlock && /^#{1,6}\s/.test(line.text)) {
            headingsCount++;
            lastFoundHeadingIndex = headingsCount;
            console.log(`[OutlineDebug] Found heading at line ${i}: "${line.text.substring(0, 50)}", Index: ${headingsCount}`);
        }
    }


    console.log(`[OutlineDebug] findHeadingIndexByLine(${targetLine}) returning: ${lastFoundHeadingIndex}`);
    // Returns the index of the *last* heading encountered before or at targetLine.
    // If no headings found yet, returns -1.
    return lastFoundHeadingIndex;
}

// Simple folding: hide everything until next header of same or higher level
function hideContent(h) {
    const level = parseInt(h.tagName.substring(1));
    let next = h.nextElementSibling;
    while (next) {
        if (/^H[1-6]$/.test(next.tagName)) {
            const nextLevel = parseInt(next.tagName.substring(1));
            if (nextLevel <= level) break;
        }
        next.classList.add('collapsed-content');
        next = next.nextElementSibling;
    }
}

function showContent(h) {
    const level = parseInt(h.tagName.substring(1));
    let next = h.nextElementSibling;
    while (next) {
        if (/^H[1-6]$/.test(next.tagName)) {
            const nextLevel = parseInt(next.tagName.substring(1));
            if (nextLevel <= level) break;
        }
        next.classList.remove('collapsed-content');
        next = next.nextElementSibling;
    }
}

function openHelp() {
    // Initialize Tabs
    const tabs = document.querySelectorAll('.help-tab-btn');
    const contents = document.querySelectorAll('.help-tab-content');

    function switchTab(tabId) {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        const selectedTab = document.querySelector(`.help-tab-btn[data-tab="${tabId}"]`);
        const selectedContent = document.getElementById(`help-tab-${tabId}`);

        if (selectedTab && selectedContent) {
            selectedTab.classList.add('active');
            selectedContent.classList.add('active');
        }
    }

    tabs.forEach(tab => {
        tab.onclick = () => {
            switchTab(tab.dataset.tab);
        };
    });

    // Reset to first tab
    switchTab('cheat-sheet');

    DOM.dialogHelp.showModal();
}

/**
 * Save fold state to storage
 */
function saveFoldState() {
    try {
        sessionStorage.setItem('markdown_fold_state', JSON.stringify(AppState.foldState));
    } catch (e) {
        console.warn('Failed to save fold state:', e);
    }
}

/**
 * Load fold state from storage
 */
function loadFoldState() {
    try {
        const saved = sessionStorage.getItem('markdown_fold_state');
        if (saved) {
            AppState.foldState = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load fold state:', e);
    }
}

/**
 * Update Undo/Redo Button State
 * @param {boolean} canUndo 
 * @param {boolean} canRedo 
 */
function updateUndoRedoButtonState(canUndo, canRedo) {
    const setButtonStyle = (btn, isEnabled) => {
        if (!btn) return;
        btn.disabled = !isEnabled;
        if (!isEnabled) {
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
            const icon = btn.querySelector('svg, .icon');
            if (icon) {
                icon.style.setProperty('fill', '#aaaaaa', 'important');
                icon.style.setProperty('stroke', '#aaaaaa', 'important');
            }
        } else {
            btn.style.opacity = '';
            btn.style.cursor = '';
            const icon = btn.querySelector('svg, .icon');
            if (icon) {
                icon.style.removeProperty('fill');
                icon.style.removeProperty('stroke');
            }
        }
    };

    setButtonStyle(document.getElementById('btn-undo'), canUndo);
    setButtonStyle(document.getElementById('btn-redo'), canRedo);
}

/**
 * ステータスバーの表示を更新（既存の preview-status-bar を使用）
 * @param {Object} info { line, col, previewLine, filePath, wordCount }
 */
function updateStatusBar(info) {
    if (!DOM.previewStatusBar) return;

    if (info.previewLine !== undefined) {
        if (info.previewLine) {
            DOM.previewStatusBar.textContent = `プレビュー行: ${info.previewLine}`;
        } else {
            DOM.previewStatusBar.textContent = ''; // Clear text but keep visible
        }
    }
}

// --- Context Menu ---
function rebuildContextMenu() {
    const oldMenu = document.getElementById('custom-context-menu');
    if (oldMenu) {
        oldMenu.remove();
    }
    // フラグはリセットしない: イベントリスナーは document に一度だけ登録する設計。
    // ハンドラ内で毎回 getElementById でDOMを取得するため、DOM再作成後も正しく動作する。
    initContextMenu();
}

let _contextMenuEventsBound = false;

function initContextMenu() {
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.id = 'custom-context-menu';
    document.body.appendChild(contextMenu);

    // Helper to translate safely
    const t = typeof I18n !== 'undefined' ? I18n.translate : (k => k);
    const locale = (typeof I18n !== 'undefined' && typeof I18n.getLang === 'function') ? I18n.getLang() : 'ja';

    // 動的なテンプレートメニューの生成
    const templateChildren = [];
    if (typeof MD_TEMPLATES !== 'undefined' && MD_TEMPLATES[locale]) {
        MD_TEMPLATES[locale].forEach(tmpl => {
            templateChildren.push({
                label: tmpl.title,
                action: 'insert-template',
                templateId: tmpl.id,
                source: 'md'
            });
        });
    }

    const svgTemplateChildren = [];
    if (typeof SVG_TEMPLATES !== 'undefined' && SVG_TEMPLATES[locale]) {
        SVG_TEMPLATES[locale].forEach(tmpl => {
            svgTemplateChildren.push({
                label: tmpl.title,
                action: 'insert-template',
                templateId: tmpl.id,
                source: 'svg'
            });
        });
    }

    const mermaidTemplateChildren = [];
    if (typeof MERMAID_TEMPLATES !== 'undefined' && MERMAID_TEMPLATES[locale]) {
        MERMAID_TEMPLATES[locale].forEach(tmpl => {
            mermaidTemplateChildren.push({
                label: tmpl.title,
                action: 'insert-template',
                templateId: tmpl.id,
                source: 'mermaid'
            });
        });
    }

    // Menu Structure
    const menuStructure = [
        { label: t('contextMenuEditor.cut') || '切り取り', action: 'cut', id: 'menu-cut', shortcut: 'Ctrl+X' },
        { label: t('contextMenuEditor.paste') || '貼り付け', action: 'paste', id: 'menu-paste', shortcut: 'Ctrl+V' },
        { label: t('contextMenuEditor.deleteSelection') || '削除', action: 'delete-selection', id: 'menu-delete-selection', shortcut: 'Del' },
        { type: 'separator', id: 'menu-sep-editor' },
        { label: t('contextMenuEditor.copy') || 'コピー', action: 'copy', id: 'menu-copy', shortcut: 'Ctrl+C' },
        {
            label: t('contextMenuEditor.insert') || '挿入',
            id: 'menu-insert',
            children: [
                {
                    label: t('contextMenuEditor.heading') || '見出し',
                    children: [
                        { label: t('contextMenuEditor.heading1') || '見出し1', action: 'insert', value: '# 見出し1' },
                        { label: t('contextMenuEditor.heading2') || '見出し2', action: 'insert', value: '## 見出し2' },
                        { label: t('contextMenuEditor.heading3') || '見出し3', action: 'insert', value: '### 見出し3' },
                        { label: t('contextMenuEditor.heading4') || '見出し4', action: 'insert', value: '#### 見出し4' },
                        { label: t('contextMenuEditor.heading5') || '見出し5', action: 'insert', value: '##### 見出し5' },
                        { label: t('contextMenuEditor.heading6') || '見出し6', action: 'insert', value: '###### 見出し6' }
                    ]
                },
                {
                    label: t('contextMenuEditor.list') || 'リスト',
                    children: [
                        { label: t('contextMenuEditor.numberList') || '番号付き', action: 'insert', value: '1. ' },
                        { label: t('contextMenuEditor.bulletList') || '箇条書き', action: 'insert', value: '- ' }
                    ]
                },
                {
                    label: t('contextMenuEditor.link') || 'リンク',
                    children: [
                        { label: t('contextMenuEditor.fileLink') || 'ファイル', action: 'insert', value: '[リンクテキスト](filename.md)' },
                        { label: t('contextMenuEditor.imageLink') || '画像', action: 'insert', value: '![画像タイトル](image.png)' }
                    ]
                },
                { label: t('contextMenuEditor.codeBlock') || 'コードブロック', action: 'insert', value: '```\n\n```' },
                {
                    label: t('contextMenuEditor.table') || 'テーブル',
                    children: [
                        { label: t('contextMenuEditor.table2Col') || '2列', action: 'insert', value: '\n\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |' },
                        { label: t('contextMenuEditor.table3Col') || '3列', action: 'insert', value: '\n\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |' },
                        { label: t('contextMenuEditor.table4Col') || '4列', action: 'insert', value: '\n\n| Header 1 | Header 2 | Header 3 | Header 4 |\n| --- | --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 | Cell 4 |' }
                    ]
                },
                {
                    label: t('contextMenuEditor.taskList') || 'タスクリスト',
                    children: [
                        { label: t('contextMenuEditor.taskChecked') || 'チェック有', action: 'insert', value: '- [x] ' },
                        { label: t('contextMenuEditor.taskUnchecked') || 'チェック無', action: 'insert', value: '- [ ] ' }
                    ]
                },
                { label: t('contextMenuEditor.hr_') || '水平線', action: 'insert', value: '\n---\n', id: 'menu-insert-hr' },
                {
                    label: t('contextMenuEditor.toc') || '目次',
                    children: [
                        { label: t('contextMenuEditor.tocAll') || '全て', action: 'insert-toc', level: 6 },
                        { label: t('contextMenuEditor.tocLv1') || 'Lv1のみ', action: 'insert-toc', level: 1 },
                        { label: t('contextMenuEditor.tocLv2') || 'Lv2まで', action: 'insert-toc', level: 2 },
                        { label: t('contextMenuEditor.tocLv3') || 'Lv3まで', action: 'insert-toc', level: 3 },
                        { label: t('contextMenuEditor.tocLv4') || 'Lv4まで', action: 'insert-toc', level: 4 },
                        { label: t('contextMenuEditor.tocLv5') || 'Lv5まで', action: 'insert-toc', level: 5 }
                    ]
                },
                {
                    label: t('contextMenuEditor.template') || 'テンプレート',
                    children: templateChildren.length > 0 ? templateChildren : [{ label: 'なし', action: 'none' }]
                },
                {
                    label: t('contextMenuEditor.svg') || 'SVG',
                    children: svgTemplateChildren.length > 0 ? svgTemplateChildren : [{ label: 'なし', action: 'none' }]
                },
                {
                    label: t('contextMenuEditor.mermaid') || 'マーメイド',
                    children: mermaidTemplateChildren.length > 0 ? mermaidTemplateChildren : [{ label: 'なし', action: 'none' }]
                }
            ]
        },
        {
            label: t('contextMenuEditor.renumberHeadings') || '見出し番号振り直し',
            children: [
                { label: '1, 1.1', action: 'renumber-headings', format: 'dot' },
                { label: '1., 1.1.', action: 'renumber-headings', format: 'trailing-dot' },
                { label: '1, 1-1', action: 'renumber-headings', format: 'dash' }
            ]
        },
        { type: 'separator' },
        { label: t('contextMenuEditor.editObject') || 'オブジェクト編集', action: 'edit', id: 'menu-edit' },
        { label: t('contextMenuEditor.deleteObject') || 'オブジェクト削除', action: 'delete', id: 'menu-delete' }
    ];

    // Helper to build menu items
    function buildMenuItems(container, items, parentPath = [], nestLevel = 0) {
        items.forEach((item, index) => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                if (item.id) sep.id = item.id;
                container.appendChild(sep);
                return;
            }

            const el = document.createElement('div');
            el.className = 'context-menu-item';
            if (item.id) el.id = item.id;
            if (item.class) el.classList.add(item.class);

            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            el.appendChild(labelSpan);

            // ショートカットキーの表示
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

            if (item.children) {
                el.classList.add('has-submenu');
                const submenu = document.createElement('div');
                submenu.className = 'context-menu-submenu';
                submenu.dataset.nestLevel = nestLevel + 1; // ネストレベルを記録
                buildMenuItems(submenu, item.children, [...parentPath, index], nestLevel + 1);
                el.appendChild(submenu);

                // サブメニューの位置調整（ホバー時）
                el.addEventListener('mouseenter', () => {
                    adjustSubmenuPosition(submenu);
                });
            } else {
                el.onclick = (e) => {
                    e.stopPropagation();
                    handleMenuAction(item, contextMenu.targetElement);
                    closeContextMenu();
                };
            }

            container.appendChild(el);
        });
    }

    buildMenuItems(contextMenu, menuStructure);

    // サブメニューの位置調整関数
    function adjustSubmenuPosition(submenu) {
        if (!submenu) return;

        const submenuRect = submenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 10;
        const nestLevel = parseInt(submenu.dataset.nestLevel) || 1;

        // デフォルトは右側表示（left: 100%）
        // 右側にはみ出る場合は左側に表示
        if (submenuRect.right > viewportWidth - padding) {
            // 左側に表示: 親の左端から左に配置
            // ネストレベルが2以上（3段目以降）の場合、追加のオフセットを設定
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
            submenu.style.marginLeft = '0';

            // 3段目以降は親メニュー幅の50%程度ずらして、2段目と3段目を両方選択可能にする
            // 背景の不透明度が高いので1段目と少し重なっても問題ない
            if (nestLevel >= 2) {
                // 親要素（メニュー項目）を取得
                const parentItem = submenu.parentElement;
                const parentMenu = parentItem.parentElement;
                const parentWidth = parentMenu.offsetWidth;

                // 親メニューの幅の50%程度だけずらす（2段目と3段目が適度に重なる）
                submenu.style.marginRight = `-${Math.floor(parentWidth * 0.5)}px`;
            } else {
                submenu.style.marginRight = '-4px';
            }
        } else {
            // 右側に表示（デフォルト）
            submenu.style.left = '100%';
            submenu.style.right = 'auto';
            submenu.style.marginLeft = '-4px';
            submenu.style.marginRight = '0';
        }

        // 垂直位置の調整
        // サブメニューが下端からはみ出る場合
        if (submenuRect.bottom > viewportHeight - padding) {
            const overflow = submenuRect.bottom - (viewportHeight - padding);
            const currentTop = parseInt(getComputedStyle(submenu).top) || -4;
            submenu.style.top = `${currentTop - overflow}px`;
        }

        // サブメニューが上端からはみ出る場合
        if (submenuRect.top < padding) {
            submenu.style.top = `${padding - submenuRect.top}px`;
        }
    }


    // Event Listener (Bind only once)
    if (!_contextMenuEventsBound) {
        document.addEventListener('contextmenu', (e) => {
            // Close existing first
            closeContextMenu();

            const isEditor = e.target.closest('.cm-editor');
            let isPreviewSelectable = null;
            const isInPreview = DOM.preview && DOM.preview.contains(e.target);

            // Check if hovering over a selectable element in preview
            if (isInPreview) {
                // まず.preview-selectableクラスを持つ要素を探す
                isPreviewSelectable = e.target.closest('.preview-selectable');

                // クラスがない場合でも、編集可能な要素かチェック
                if (!isPreviewSelectable && typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.getSelectableTarget === 'function') {
                    isPreviewSelectable = PreviewInlineEdit.getSelectableTarget(e.target);
                }
            }

            if (!isEditor && !isInPreview) {
                return; // Default menu
            }

            e.preventDefault();

            // 0. Update dynamic labels
            const hrMenuBtn = document.getElementById('menu-insert-hr');
            if (hrMenuBtn) {
                const labelSpan = hrMenuBtn.querySelector('span');
                if (labelSpan) {
                    const hrText = (typeof I18n !== 'undefined') ? I18n.translate('contextMenuEditor.hr_') : '水平線';
                    const hrPageBreakText = (typeof I18n !== 'undefined') ? I18n.translate('contextMenu.insertHrPageBreak') : '水平線(改ページ)';
                    labelSpan.textContent = AppState.config.pageBreakOnHr ? hrPageBreakText : hrText;
                }
            }

            // 1. Update visibility of options
            const editBtn = document.getElementById('menu-edit');
            const deleteBtn = document.getElementById('menu-delete');

            // 編集操作ボタン（Cut/Copy/Paste/Delete）の表示制御
            const cutBtn = document.getElementById('menu-cut');
            const copyBtn = document.getElementById('menu-copy');
            const pasteBtn = document.getElementById('menu-paste');
            const deleteSelectionBtn = document.getElementById('menu-delete-selection');

            if (isEditor) {
                // エディタの場合、編集操作を表示、オブジェクト編集系メニューを非表示
                if (cutBtn) cutBtn.style.display = 'flex';
                if (copyBtn) copyBtn.style.display = 'flex';
                if (pasteBtn) pasteBtn.style.display = 'flex';
                if (deleteSelectionBtn) deleteSelectionBtn.style.display = 'flex';
                const sepEditor = document.getElementById('menu-sep-editor');
                if (sepEditor) sepEditor.style.display = 'block';

                if (editBtn) {
                    editBtn.style.display = 'none';
                    // 前の区切り線も非表示
                    if (editBtn.previousElementSibling && editBtn.previousElementSibling.classList.contains('context-menu-separator')) {
                        editBtn.previousElementSibling.style.display = 'none';
                    }
                }
                if (deleteBtn) deleteBtn.style.display = 'none';

                // 選択範囲があるかどうかで、Cut/Copy/Deleteの有効/無効を切り替えるなど
                // CodeMirrorの選択状態を取得
                let hasSelection = false;
                if (window.editorInstance) {
                    const state = window.editorInstance.state;
                    hasSelection = !state.selection.main.empty;
                }

                // NOTE: システムのクリップボードアクセス権限によってはPasteが使えない場合もあるが
                // 基本的には有効にしておく
            } else {
                // プレビューの場合、編集操作を非表示（コピー以外）、オブジェクト編集系を表示
                if (cutBtn) cutBtn.style.display = 'none';
                if (copyBtn) copyBtn.style.display = 'flex';
                if (pasteBtn) pasteBtn.style.display = 'none';
                if (deleteSelectionBtn) deleteSelectionBtn.style.display = 'none';
                const sepEditor = document.getElementById('menu-sep-editor');
                if (sepEditor) sepEditor.style.display = 'none';

                if (editBtn) {
                    editBtn.style.display = 'flex';
                    // 前の区切り線を表示
                    if (editBtn.previousElementSibling && editBtn.previousElementSibling.classList.contains('context-menu-separator')) {
                        editBtn.previousElementSibling.style.display = 'block';
                    }
                }
                if (deleteBtn) deleteBtn.style.display = 'flex';

                // プレビュー選択可能要素でない場合は、オブジェクト編集/削除は隠すべきかもしれないが、
                // 既存ロジックに合わせて表示制御を行う（必要なら）
            }

            // Store target for action reference
            // DOM再作成後も正しい要素を参照するため、毎回 getElementById で取得する
            const menu = document.getElementById('custom-context-menu');
            if (!menu) return;
            menu.targetElement = isPreviewSelectable || isEditor || e.target;

            // Position
            let x = e.clientX;
            let y = e.clientY;

            // 画面境界チェックのため、まずメニューを表示して寸法を取得
            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
            menu.classList.add('visible');

            // メニューのサイズを取得
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 10; // 最小限の余白

            // --- 水平位置の調整 ---
            const spaceRight = viewportWidth - x;
            if (spaceRight < menuWidth + padding) {
                // 右に空間がない場合
                const spaceLeft = x;
                if (spaceLeft > menuWidth + padding) {
                    // 左に十分な空間がある：左に表示
                    x = x - menuWidth;
                } else {
                    // 左右どちらも足りない：画面右端に合わせる
                    x = viewportWidth - menuWidth - padding;
                }
            }

            // --- 垂直位置の調整 ---
            const spaceBelow = viewportHeight - y;
            if (spaceBelow < menuHeight + padding) {
                // 下に空間がない場合
                const spaceAbove = y;
                if (spaceAbove > menuHeight + padding) {
                    // 上に十分な空間がある：上に表示
                    y = y - menuHeight;
                } else {
                    // 上下どちらも足りない：画面下部に合わせる
                    y = viewportHeight - menuHeight - padding;
                }
            }

            // 調整後の位置を設定（最小余白を確保）
            menu.style.left = `${Math.max(padding, x)}px`;
            menu.style.top = `${Math.max(padding, y)}px`;
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                closeContextMenu();
            }
        });

        _contextMenuEventsBound = true;
    }

    function closeContextMenu() {
        // DOM再作成後も正しい要素を参照するため、毎回 getElementById で取得する
        const menu = document.getElementById('custom-context-menu');
        if (menu) {
            menu.classList.remove('visible');
        }
    }
}

function performInsert(textToInsert, target) {
    if (!target) return;
    // テキストノード対策：親の要素を取得する
    if (target.nodeType === Node.TEXT_NODE) {
        target = target.parentElement;
    }

    if (target.closest('.cm-editor')) {
        // エディタへの挿入
        if (window.editorInstance) {
            const view = window.editorInstance;
            const selection = view.state.selection.main;
            view.dispatch({
                changes: { from: selection.from, to: selection.to, insert: textToInsert },
                selection: { anchor: selection.from + textToInsert.length },
                scrollIntoView: true
            });
        }
    }
    // Preview Insert
    else if (target.closest('.md-preview')) {
        if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.findSourceLocation === 'function') {
            const block = target.closest('.preview-selectable') || target;
            const sourceInfo = PreviewInlineEdit.findSourceLocation(block.textContent, block.tagName, block);

            if (sourceInfo) {
                const fullText = AppState.text;
                const insertPos = sourceInfo.end;
                const prefix = (fullText[insertPos - 1] === '\n' || textToInsert.startsWith('\n')) ? '' : '\n';
                const suffix = '\n';
                const editAmount = prefix + textToInsert + suffix;

                if (typeof window.updateEditorRange === 'function') {
                    window.updateEditorRange(insertPos, insertPos, editAmount);
                } else if (typeof setEditorText === 'function') {
                    const newText = fullText.substring(0, insertPos) + editAmount + fullText.substring(insertPos);
                    setEditorText(newText);
                }
            } else {
                // 挿入箇所が特定できない場合は、エディタの現在のカーソル位置へ挿入
                if (window.editorInstance) {
                    const view = window.editorInstance;
                    const selection = view.state.selection.main;
                    view.dispatch({
                        changes: { from: selection.from, to: selection.to, insert: textToInsert },
                        selection: { anchor: selection.from + textToInsert.length },
                        scrollIntoView: true
                    });
                }
            }
        }
    }
}

function handleMenuAction(item, target) {
    if (!target) return;
    if (target.nodeType === Node.TEXT_NODE) {
        target = target.parentElement;
    }
    // locale is needed here if not globally available in this scope
    let locale = (typeof I18n !== 'undefined' && typeof I18n.getLang === 'function') ? I18n.getLang() : 'ja';
    // Normalize locale (e.g., 'ja-JP' -> 'ja')
    if (locale.includes('-')) locale = locale.split('-')[0];

    if (item.action === 'insert') {
        const textToInsert = item.value;
        performInsert(textToInsert, target);
    }
    else if (item.action === 'insert-template') {
        const templateId = item.templateId;
        const source = item.source || 'md';
        let textToInsert = null;

        if (source === 'md' && typeof MD_TEMPLATES !== 'undefined' && MD_TEMPLATES[locale]) {
            const tmpl = MD_TEMPLATES[locale].find(t => t.id === templateId);
            if (tmpl) textToInsert = tmpl.content;
        } else if (source === 'svg' && typeof SVG_TEMPLATES !== 'undefined' && SVG_TEMPLATES[locale]) {
            const tmpl = SVG_TEMPLATES[locale].find(t => t.id === templateId);
            if (tmpl) textToInsert = tmpl.content;
        } else if (source === 'mermaid' && typeof MERMAID_TEMPLATES !== 'undefined' && MERMAID_TEMPLATES[locale]) {
            const tmpl = MERMAID_TEMPLATES[locale].find(t => t.id === templateId);
            if (tmpl) textToInsert = tmpl.content;
        }
        if (textToInsert) {
            performInsert(textToInsert, target);
        } else {
            console.warn(`Template not found: ${templateId}`);
            const errorMsg = (typeof I18n !== 'undefined') ? I18n.translate('toast.templateNotFound') : 'テンプレートが見つかりません';
            showToast(errorMsg, 'error');
        }
    }
    else if (item.action === 'cut') {
        if (target.closest('.cm-content')) {
            // エディタでの切り取り
            if (window.editorInstance) {
                const view = window.editorInstance;
                const selection = view.state.selection.main;
                if (!selection.empty) {
                    const text = view.state.sliceDoc(selection.from, selection.to);
                    navigator.clipboard.writeText(text).then(() => {
                        view.dispatch({
                            changes: { from: selection.from, to: selection.to, insert: '' }
                        });
                    }).catch(err => {
                        console.error('Failed to cut text: ', err);
                        showToast(t('toast.cutFailed'), 'error');
                    });
                }
            }
        }
    }
    else if (item.action === 'copy') {
        if (target.closest('.cm-content')) {
            // エディタでのコピー
            if (window.editorInstance) {
                const view = window.editorInstance;
                const selection = view.state.selection.main;
                if (!selection.empty) {
                    const text = view.state.sliceDoc(selection.from, selection.to);
                    navigator.clipboard.writeText(text).then(() => {
                        showToast(t('toast.copied'));
                    }).catch(err => {
                        console.error('Failed to copy text: ', err);
                        showToast(t('toast.copyFailed'), 'error');
                    });
                }
            }
        } else if (target.closest('.md-preview')) {
            // プレビュー選択範囲のコピー（ブラウザ標準範囲選択）
            const selection = window.getSelection();
            if (selection && selection.toString()) {
                navigator.clipboard.writeText(selection.toString()).then(() => {
                    showToast('コピーしました');
                });
            }
        }
    }
    else if (item.action === 'paste') {
        if (target.closest('.cm-editor')) {
            // エディタでの貼り付け
            if (window.editorInstance) {
                const view = window.editorInstance;
                navigator.clipboard.readText().then(text => {
                    if (text) {
                        const selection = view.state.selection.main;
                        view.dispatch({
                            changes: { from: selection.from, to: selection.to, insert: text },
                            selection: { anchor: selection.from + text.length }
                        });
                    }
                }).catch(err => {
                    console.error('Failed to read clipboard: ', err);
                    showToast('クリップボードの読み取りに失敗しました。権限を確認してください。', 'error');
                });
            }
        }
    }
    else if (item.action === 'delete-selection') {
        if (target.closest('.cm-editor')) {
            // エディタでの削除
            if (window.editorInstance) {
                const view = window.editorInstance;
                const selection = view.state.selection.main;
                if (!selection.empty) {
                    view.dispatch({
                        changes: { from: selection.from, to: selection.to, insert: '' }
                    });
                } else {
                    // 選択範囲がない場合、カーソルの右側1文字を削除 (Deleteキーの挙動)
                    const pos = selection.from;
                    if (pos < view.state.doc.length) {
                        view.dispatch({
                            changes: { from: pos, to: pos + 1, insert: '' }
                        });
                    }
                }
            }
        }
    }
    else if (item.action === 'edit') {
        if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.startEditing === 'function') {
            // Target should be the selectable element
            // targetが既に.preview-selectableの場合と、その子要素の場合の両方に対応
            let block = null;
            if (target && target.classList && target.classList.contains('preview-selectable')) {
                block = target;
            } else if (target) {
                block = target.closest('.preview-selectable');
            }

            // クラスがない場合は、targetが編集可能な要素かチェック
            if (!block && target) {
                const validTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'];
                if (validTags.includes(target.tagName)) {
                    block = target;
                } else if (typeof PreviewInlineEdit.getSelectableTarget === 'function') {
                    block = PreviewInlineEdit.getSelectableTarget(target);
                }
            }

            if (block) {
                PreviewInlineEdit.startEditing(block);
            }
        }
    }
    else if (item.action === 'delete') {
        if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.deleteBlock === 'function') {
            const block = target.closest('.preview-selectable') || target;
            PreviewInlineEdit.deleteBlock(block);
        }
    }
    else if (item.action === 'insert-toc') {
        if (!window.editorInstance) return;

        const maxLevel = item.level || 6;
        const doc = window.editorInstance.state.doc;
        const headings = [];
        const slugCounter = {};

        // Helper to generate slugs (matching markdown-it or GFM style)
        const getSlug = (text) => {
            let slug = text.toLowerCase().trim()
                .replace(/\s+/g, '-')
                .replace(/[^\w\u0080-\uFFFF-]/g, '') // Keep alphanumeric and all non-ASCII characters (Hiragana, Katakana, etc.)
                .replace(/^-+|-+$/g, '');

            if (slugCounter[slug] !== undefined) {
                slugCounter[slug]++;
                slug += '-' + slugCounter[slug];
            } else {
                slugCounter[slug] = 0;
            }
            return slug;
        };

        // Extract headings
        let inCodeBlock = false;
        for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            const text = line.text;

            // コードブロックの開始/終了をチェック
            if (text.trim().startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                continue;
            }

            // コードブロック内はスキップ
            if (inCodeBlock) continue;

            const match = text.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                if (level <= maxLevel) {
                    const title = match[2].trim();
                    headings.push({ level, title, slug: getSlug(title) });
                }
            }
        }

        if (headings.length === 0) {
            if (typeof showToast === 'function') showToast("目次を作成できる見出しが見つかりませんでした", "error");
            return;
        }

        // Generate TOC markdown
        const tocLines = [];
        headings.forEach(h => {
            const indent = '  '.repeat(h.level - 1);
            tocLines.push(`${indent}- [${h.title}](#${h.slug})`);
        });

        const tocText = tocLines.join('\n') + '\n';

        // Use common performInsert to handle target (Editor or Preview) consistently
        performInsert(tocText, target);

        if (typeof showToast === 'function') showToast("目次を挿入しました");
    }
    else if (item.action === 'renumber-headings') {
        if (!window.editorInstance) return;

        const format = item.format || 'dot'; // 'dot', 'trailing-dot', 'dash'
        const doc = window.editorInstance.state.doc;
        const fullText = doc.toString();
        const slugCounter = {};

        // getSlug helper (locally defined for consistency)
        const getSlug = (text, counter) => {
            let slug = text.toLowerCase().trim()
                .replace(/\s+/g, '-')
                .replace(/[^\w\u0080-\uFFFF-]/g, '')
                .replace(/^-+|-+$/g, '');

            if (counter[slug] !== undefined) {
                counter[slug]++;
                slug += '-' + counter[slug];
            } else {
                counter[slug] = 0;
            }
            return slug;
        };

        // 1. Collect initial state and slugs
        const headings = [];
        const initialSlugCounter = {};
        const newSlugCounter = {};
        const slugMap = {}; // oldSlug -> newSlug
        const changes = [];
        let inCodeBlock = false;

        for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            const text = line.text;

            if (text.trim().startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                continue;
            }
            if (inCodeBlock) continue;

            const match = text.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                const content = match[2];
                // 既存の番号を除去 (例: "1. ", "1.1 ", "1-1 ", "1.1. ")
                const cleanContent = content.replace(/^([0-9]+([.\-][0-9]+)*[.\-]?\s+)/, '').trim();
                const oldSlug = getSlug(match[0].trim().substring(level).trim(), initialSlugCounter);

                if (level === 1) {
                    // H1は番号振りの対象外（既存番号除去のみ行う）
                    const lineObj = doc.line(i);
                    changes.push({ from: lineObj.from, to: lineObj.to, insert: "# " + cleanContent });
                    // リンク更新用にMapに登録（番号が消えるためアンカーが変わる）
                    const newSlug = getSlug(cleanContent, newSlugCounter);
                    slugMap[oldSlug] = newSlug;
                } else {
                    headings.push({
                        lineNum: i,
                        level: level,
                        content: cleanContent,
                        oldSlug: oldSlug
                    });
                }
            }
        }

        if (headings.length === 0 && changes.length === 0) {
            if (typeof showToast === 'function') showToast("見出しが見つかりませんでした", "error");
            return;
        }

        // 2. Generate new numbers and new slugs
        const counters = [0, 0, 0, 0, 0, 0];
        const minLevel = 2; // H2を第1セグメントとする

        headings.forEach(h => {
            const currentIdx = h.level - minLevel;
            counters[currentIdx]++;
            for (let i = currentIdx + 1; i < 6; i++) counters[i] = 0;

            // 番号文字列の生成
            const activeCounters = counters.slice(0, currentIdx + 1);
            let numStr = "";
            if (format === 'dash') {
                numStr = activeCounters.join('-');
            } else {
                numStr = activeCounters.join('.');
                if (format === 'trailing-dot') numStr += '.';
            }

            const newTitle = `${numStr} ${h.content}`;
            const fullHeader = "#".repeat(h.level) + " " + newTitle;
            const newSlug = getSlug(newTitle, newSlugCounter);

            slugMap[h.oldSlug] = newSlug;

            const lineObj = doc.line(h.lineNum);
            changes.push({ from: lineObj.from, to: lineObj.to, insert: fullHeader });
        });

        // 3. Update links using slugMap
        // ドキュメント全体を走査してリンク [text](#anchor) を置換
        // 安全のため、一度に更新するためのトランザクションを作成
        const linkRegex = /\]\(#([^\)]+)\)/g;
        for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            let lineText = line.text;
            let newLineText = lineText;
            let match;

            // 行内で複数のリンクがある場合に対応
            const lineChanges = [];
            while ((match = linkRegex.exec(lineText)) !== null) {
                const oldAnchor = match[1];
                if (slugMap[oldAnchor] && slugMap[oldAnchor] !== oldAnchor) {
                    const start = line.from + match.index + 3; // # の後
                    const end = start + oldAnchor.length;
                    lineChanges.push({ from: start, to: end, insert: slugMap[oldAnchor] });
                }
            }
            // 同一行内の変更は後ろから適用するか、まとめて追加
            lineChanges.forEach(c => changes.push(c));
        }

        // Apply all changes
        if (changes.length > 0) {
            window.editorInstance.dispatch({
                changes: changes,
                scrollIntoView: false
            });
            if (typeof showToast === 'function') showToast("見出し番号を振り直しました");
        }
    }
}

/**
 * Initialize Task List Toggle listener on preview area
 */
function initTaskListToggle() {
    if (!DOM.preview) return;

    DOM.preview.addEventListener('click', (e) => {
        const target = e.target;
        // Check if clicked element is a task list checkbox
        if (target.tagName === 'INPUT' && target.type === 'checkbox' && target.classList.contains('task-list-item-checkbox')) {
            // Find parent LI to get the line number
            const li = target.closest('li[data-line]');
            if (!li) return;

            const lineNum = parseInt(li.getAttribute('data-line'), 10);
            if (isNaN(lineNum)) return;

            const fullText = AppState.text;
            const lines = fullText.split('\n');
            const lineIdx = lineNum - 1;

            if (lineIdx >= 0 && lineIdx < lines.length) {
                let lineText = lines[lineIdx];
                const isChecked = target.checked;

                let newLineText = lineText;
                if (isChecked) {
                    newLineText = lineText.replace(/\[\s\]/, '[x]');
                } else {
                    newLineText = lineText.replace(/\[[xX]\]/, '[ ]');
                }

                if (newLineText !== lineText) {
                    if (typeof editorView !== 'undefined') {
                        const lineObj = editorView.state.doc.line(lineNum);
                        const from = lineObj.from;
                        const to = lineObj.to;

                        window.isScrolling = true;

                        editorView.dispatch({
                            changes: { from, to, insert: newLineText }
                        });

                        AppState.text = editorView.state.doc.toString();
                        AppState.isModified = true;

                        setTimeout(() => { window.isScrolling = false; }, 50);
                    } else {
                        lines[lineIdx] = newLineText;
                        setEditorText(lines.join('\n'));
                        AppState.text = getEditorText();
                        AppState.isModified = true;
                        if (typeof render === 'function') render();
                    }
                }
            }
        }
    });
}

// --- Outline Menu (Selection between Markdown and SVG) ---
let outlineMenuDropdown = null;

function toggleOutlineMenu(e) {
    if (e) e.stopPropagation();

    if (!outlineMenuDropdown) {
        createOutlineMenu();
    }

    const isVisible = outlineMenuDropdown.classList.contains('visible');
    if (isVisible) {
        closeOutlineMenu();
    } else {
        showOutlineMenu();
    }
}
window.toggleOutlineMenu = toggleOutlineMenu;

function createOutlineMenu() {
    outlineMenuDropdown = document.createElement('div');
    outlineMenuDropdown.className = 'file-menu-dropdown';

    if (AppState.isSvgMode) {
        // SVGモード: SVG（レイヤー）のみ表示
        outlineMenuDropdown.innerHTML = `
            <div class="file-menu-item" data-action="svg">
                <span data-i18n="outlineMenu.svg">SVG (レイヤー)</span>
                <span class="shortcut">F7</span>
            </div>
        `;
    } else {
        // 通常モード: Markdown・SVG両方
        outlineMenuDropdown.innerHTML = `
            <div class="file-menu-item" data-action="markdown">
                <span data-i18n="outlineMenu.markdown">Markdown (アウトライン)</span>
                <span class="shortcut">F6</span>
            </div>
            <div class="file-menu-item" data-action="svg">
                <span data-i18n="outlineMenu.svg">SVG (レイヤー)</span>
                <span class="shortcut">F7</span>
            </div>
        `;
    }

    document.body.appendChild(outlineMenuDropdown);

    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

    outlineMenuDropdown.querySelectorAll('.file-menu-item').forEach(item => {
        item.onclick = () => {
            const action = item.dataset.action;
            handleOutlineMenuAction(action);
            closeOutlineMenu();
        };
    });
}

function showOutlineMenu() {
    if (!outlineMenuDropdown) return;
    const btn = document.getElementById('btn-outline');
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    outlineMenuDropdown.style.position = 'fixed';
    outlineMenuDropdown.style.top = `${rect.bottom + 4}px`;
    outlineMenuDropdown.style.left = `${rect.left}px`;
    outlineMenuDropdown.classList.add('visible');

    setTimeout(() => {
        document.addEventListener('click', closeOutlineMenu);
    }, 0);
}

function closeOutlineMenu() {
    if (!outlineMenuDropdown) return;
    outlineMenuDropdown.classList.remove('visible');
    document.removeEventListener('click', closeOutlineMenu);
}

function handleOutlineMenuAction(action) {
    if (action === 'markdown') {
        toggleOutline();
    } else if (action === 'svg') {
        toggleSvgList();
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTaskListToggle);
} else {
    initTaskListToggle();
}

// --- File Menu ---
let fileMenuDropdown = null;

function toggleFileMenu(e) {
    if (e) {
        e.stopPropagation();
    }

    if (!fileMenuDropdown) {
        createFileMenu();
    }

    const isVisible = fileMenuDropdown.classList.contains('visible');

    if (isVisible) {
        closeFileMenu();
    } else {
        showFileMenu();
    }
}

// グローバルスコープに公開
window.toggleFileMenu = toggleFileMenu;


function createFileMenu() {
    fileMenuDropdown = document.createElement('div');
    fileMenuDropdown.className = 'file-menu-dropdown';

    if (AppState.isSvgMode) {
        // SVGモード: 保存・別名保存のみ表示
        fileMenuDropdown.innerHTML = `
            <div class="file-menu-item" data-action="save">
                <span data-i18n="fileMenu.saveFile">保存</span>
                <span class="shortcut">Ctrl+S</span>
            </div>
            <div class="file-menu-item" data-action="save-as">
                <span data-i18n="fileMenu.saveFileAs">別名保存</span>
                <span class="shortcut">Ctrl+Shift+S</span>
            </div>
        `;
    } else {
        // 通常モード: 全項目
        fileMenuDropdown.innerHTML = `
            <div class="file-menu-item" data-action="new">
                <span data-i18n="fileMenu.newFile">新規</span>
                <span class="shortcut">Alt+N</span>
            </div>
            <div class="file-menu-item" data-action="new-window">
                <span data-i18n="fileMenu.newWindow">新しいウィンドウ</span>
                <span class="shortcut">Alt+Shift+N</span>
            </div>
            <div class="file-menu-item" data-action="open">
                <span data-i18n="fileMenu.openFile">開く</span>
                <span class="shortcut">Ctrl+O</span>
            </div>
            <div class="file-menu-separator"></div>
            <div class="file-menu-item" data-action="save">
                <span data-i18n="fileMenu.saveFile">保存</span>
                <span class="shortcut">Ctrl+S</span>
            </div>
            <div class="file-menu-item" data-action="save-as">
                <span data-i18n="fileMenu.saveFileAs">別名保存</span>
                <span class="shortcut">Ctrl+Shift+S</span>
            </div>
        `;
    }

    // 翻訳の適用
    if (typeof applyTranslations === 'function') {
        // メニューがDOMに追加される前に適用しても、applyTranslationsはdocument全体の[data-i18n]を探すため
        // まずメニューをbodyに追加してから翻訳を適用するように順序を変更します。
    }

    // メニューをbodyに追加
    document.body.appendChild(fileMenuDropdown);

    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

    // メニュー項目のクリックイベント
    fileMenuDropdown.querySelectorAll('.file-menu-item').forEach(item => {
        item.onclick = () => {
            const action = item.dataset.action;
            handleFileMenuAction(action);
            closeFileMenu();
        };
    });
}

function showFileMenu() {
    if (!fileMenuDropdown) return;

    // ボタンの位置を取得
    const fileMenuButton = document.getElementById('btn-file-menu');
    if (!fileMenuButton) return;

    const rect = fileMenuButton.getBoundingClientRect();

    // メニューの位置を設定
    fileMenuDropdown.style.position = 'fixed';
    fileMenuDropdown.style.top = `${rect.bottom + 4}px`;
    fileMenuDropdown.style.left = `${rect.left}px`;

    fileMenuDropdown.classList.add('visible');

    // メニュー外をクリックで閉じる
    setTimeout(() => {
        document.addEventListener('click', closeFileMenu);
    }, 0);
}

function closeFileMenu() {
    if (!fileMenuDropdown) return;

    fileMenuDropdown.classList.remove('visible');
    document.removeEventListener('click', closeFileMenu);
}

function handleFileMenuAction(action) {
    switch (action) {
        case 'new':
            if (typeof newFile === 'function') newFile();
            break;
        case 'new-window':
            if (typeof newWindow === 'function') newWindow();
            break;
        case 'open':
            if (typeof openFile === 'function') openFile();
            break;
        case 'save':
            if (typeof saveFile === 'function') saveFile();
            break;
        case 'save-as':
            if (typeof saveFileAs === 'function') saveFileAs();
            break;
    }
}

// --- Slide Menu ---
let slideMenuDropdown = null;

function toggleSlideMenu(e) {
    if (e) {
        e.stopPropagation();
    }

    if (!slideMenuDropdown) {
        createSlideMenu();
    }

    const isVisible = slideMenuDropdown.classList.contains('visible');

    if (isVisible) {
        closeSlideMenu();
    } else {
        showSlideMenu();
    }
}
window.toggleSlideMenu = toggleSlideMenu; // グローバル公開

function createSlideMenu() {
    slideMenuDropdown = document.createElement('div');
    slideMenuDropdown.className = 'file-menu-dropdown'; // 共用スタイル
    slideMenuDropdown.innerHTML = `
        <div class="file-menu-item" data-action="slide-fullscreen">
            <span data-i18n="slideMenu.fullscreen">全画面表示</span>
            <span class="shortcut">F10</span>
        </div>
        <div class="file-menu-item" data-action="slide-window">
            <span data-i18n="slideMenu.window">ウィンドウ表示</span>
        </div>
    `;

    document.body.appendChild(slideMenuDropdown);

    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

    // メニュー項目のクリックイベント
    slideMenuDropdown.querySelectorAll('.file-menu-item').forEach(item => {
        item.onclick = () => {
            const action = item.dataset.action;
            handleSlideMenuAction(action);
            closeSlideMenu();
        };
    });
}

function showSlideMenu() {
    if (!slideMenuDropdown) return;

    // ボタンの位置を取得
    const slideMenuButton = document.getElementById('btn-slide-menu');
    if (!slideMenuButton) return;

    const rect = slideMenuButton.getBoundingClientRect();

    // メニューの位置を設定
    slideMenuDropdown.style.position = 'fixed';
    slideMenuDropdown.style.top = `${rect.bottom + 4}px`;
    slideMenuDropdown.style.left = `${rect.left}px`;

    slideMenuDropdown.classList.add('visible');

    // メニュー外をクリックで閉じる
    setTimeout(() => {
        document.addEventListener('click', closeSlideMenu);
    }, 0);
}

function closeSlideMenu() {
    if (!slideMenuDropdown) return;

    slideMenuDropdown.classList.remove('visible');
    document.removeEventListener('click', closeSlideMenu);
}

function handleSlideMenuAction(action) {
    switch (action) {
        case 'slide-fullscreen':
            if (typeof openSlideshow === 'function') openSlideshow(true);
            break;
        case 'slide-window':
            if (typeof openSlideshow === 'function') openSlideshow(false);
            break;
    }
}

// --- Export Menu ---
let exportMenuDropdown = null;

function toggleExportMenu(e) {
    if (e) {
        e.stopPropagation();
    }

    if (!exportMenuDropdown) {
        createExportMenu();
    }

    const isVisible = exportMenuDropdown.classList.contains('visible');

    if (isVisible) {
        hideExportMenu();
    } else {
        showExportMenu();
    }
}
window.toggleExportMenu = toggleExportMenu; // グローバル公開

function createExportMenu() {
    exportMenuDropdown = document.createElement('div');
    exportMenuDropdown.id = 'export-menu';
    exportMenuDropdown.className = 'export-menu-dropdown';
    exportMenuDropdown.innerHTML = `
        <div class="export-menu-item export-menu-item-with-submenu">
            <div class="export-menu-item-content">
                <svg class="icon" width="16" height="16"><use href="#icon-pdf" /></svg>
                <span data-i18n="exportMenu.pdf">PDF出力</span>
                <span class="submenu-arrow">◀</span>
            </div>
            <div class="export-submenu">
                <div class="export-submenu-item" data-action="export-pdf-portrait" data-i18n="exportMenu.pdfPortrait">A4縦</div>
                <div class="export-submenu-item" data-action="export-pdf-landscape" data-i18n="exportMenu.pdfLandscape">A4横</div>
            </div>
        </div>
        <div class="export-menu-item" data-action="export-html">
            <svg class="icon" width="16" height="16"><use href="#icon-file-text" /></svg>
            <span data-i18n="exportMenu.html">HTMLファイル</span>
        </div>
        <div class="export-menu-item" data-action="docx">
            <svg class="icon" width="16" height="16"><use href="#icon-save" /></svg>
            <span data-i18n="exportMenu.docx">ワード文書(DOCX)</span>
        </div>
        <div class="export-menu-item export-menu-item-with-submenu">
            <div class="export-menu-item-content">
                <svg class="icon" width="16" height="16"><use href="#icon-file-text" /></svg>
                <span data-i18n="exportMenu.text">テキスト</span>
                <span class="submenu-arrow">◀</span>
            </div>
            <div class="export-submenu">
                <div class="export-submenu-item" data-action="export-text-file" data-i18n="exportMenu.textFile">ファイル</div>
                <div class="export-submenu-item" data-action="export-text-clipboard" data-i18n="exportMenu.textClipboard">クリップボード</div>
            </div>
        </div>
        <div class="export-menu-separator"></div>
        <div class="export-menu-item" data-action="print">
            <svg class="icon" width="16" height="16"><use href="#icon-print" /></svg>
            <span data-i18n="exportMenu.print">印刷プレビュー</span>
        </div>
    `;

    document.body.appendChild(exportMenuDropdown);

    // 翻訳の適用
    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

    // Click events for menu items
    exportMenuDropdown.querySelectorAll('.export-menu-item, .export-submenu-item').forEach(item => {
        item.onclick = (e) => {
            // サブメニューを持つ親項目自体がクリックされた場合は何もしない（ホバーで制御）
            if (item.classList.contains('export-menu-item-with-submenu') && !e.target.classList.contains('export-submenu-item')) {
                return;
            }
            e.stopPropagation();
            const action = item.dataset.action;
            if (action) {
                handleExportAction(action);
                hideExportMenu();
            }
        };
    });
}

function showExportMenu() {
    if (!exportMenuDropdown) return;

    const button = document.getElementById('btn-export-menu');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    exportMenuDropdown.style.top = `${rect.bottom + 4}px`;
    exportMenuDropdown.style.left = `${rect.left}px`;
    exportMenuDropdown.classList.add('visible');

    // Adjust horizontal position if it overflows the window
    // `exportMenuDropdown` はCSSで `min-width: 200px`
    let expectedWidth = exportMenuDropdown.offsetWidth || 200;
    if (rect.left + expectedWidth > window.innerWidth) {
        exportMenuDropdown.style.left = `${window.innerWidth - expectedWidth - 8}px`; // 8px margin
    }

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeExportMenu);
    }, 0);
}

function hideExportMenu() {
    if (!exportMenuDropdown) return;
    exportMenuDropdown.classList.remove('visible');
    document.removeEventListener('click', closeExportMenu);
}

function closeExportMenu(e) {
    if (exportMenuDropdown && !exportMenuDropdown.contains(e.target)) {
        hideExportMenu();
    }
}

function handleExportAction(action) {
    switch (action) {
        case 'export-pdf-portrait':
            if (typeof exportPDFAsImage === 'function') exportPDFAsImage('portrait');
            break;
        case 'export-pdf-landscape':
            if (typeof exportPDFAsImage === 'function') exportPDFAsImage('landscape');
            break;
        case 'docx':
            if (typeof exportDOCX === 'function') exportDOCX();
            break;
        case 'print':
            if (typeof openPrintDialog === 'function') openPrintDialog();
            break;
        case 'export-text-file':
            if (typeof exportTextToFile === 'function') exportTextToFile();
            break;
        case 'export-text-clipboard':
            if (typeof exportTextToClipboard === 'function') exportTextToClipboard();
            break;
        case 'export-html':
            if (typeof exportHTMLFile === 'function') exportHTMLFile();
            break;
    }
}

// --- DOM Cache for DOCX Export ---
window.DOM = window.DOM || {};
DOM.dialogDocxProgress = document.getElementById('dialog-docx-progress');
DOM.docxProgressBar = document.getElementById('docx-progress-bar');
DOM.docxProgressText = document.getElementById('docx-progress-text');

// --- DOM Cache for PDF Export ---
DOM.dialogProgress = document.getElementById('dialog-progress');
DOM.pdfProgressBar = document.getElementById('pdf-progress-bar');
DOM.pdfProgressText = document.getElementById('pdf-progress-text');
DOM.btnCancelPDF = document.getElementById('btn-cancel-pdf');
DOM.preview = document.getElementById('preview');
