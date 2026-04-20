/**
 * UI Event Listeners & Shortcuts
 */

// --- Toolbar Events ---
function bindToolbarEvents() {
    // ツールバー要素が存在しない場合はスキップ
    const bindButton = (id, handler) => {
        const element = document.getElementById(id);
        if (element) {
            element.onclick = handler;
        } else {
            console.warn(`ツールバーボタンが見つかりません: ${id}`);
        }
    };

    // ファイルメニューボタン
    bindButton('btn-file-menu', toggleFileMenu);

    // エクスポートメニューボタン
    bindButton('btn-export-menu', toggleExportMenu);

    // スライドメニューボタン
    bindButton('btn-slide-menu', toggleSlideMenu);

    bindButton('btn-help', openHelp);
    bindButton('btn-close-help', () => DOM.dialogHelp.close());

    // Undo/Redo Buttons
    bindButton('btn-undo', () => {
        // Use global UndoRedoManager if available, or direct calls
        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.undo();
        else if (typeof execUndo === 'function') execUndo();
    });
    bindButton('btn-redo', () => {
        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.redo();
        else if (typeof execRedo === 'function') execRedo();
    });

    // Config Dialog
    bindButton('btn-config', openConfig);
    bindButton('btn-save-config', saveConfig);
    bindButton('btn-cancel-config', cancelConfig);

    // View Toggle
    bindButton('btn-toggle-view', toggleView);

    // Outline Menu Toggle
    bindButton('btn-outline', toggleOutlineMenu);

    // SVG List Toolbar Buttons
    bindButton('svg-list-copy', () => { if (typeof execSvgCopy === 'function') execSvgCopy(); });
    bindButton('svg-list-paste', () => { if (typeof execSvgPaste === 'function') execSvgPaste(); });
    bindButton('svg-list-delete', () => { if (typeof execSvgDelete === 'function') execSvgDelete(); });
    bindButton('svg-list-group', () => { if (typeof execSvgGroup === 'function') execSvgGroup(); });
    bindButton('svg-list-ungroup', () => { if (typeof execSvgUngroup === 'function') execSvgUngroup(); });

    // Search Button
    bindButton('btn-search', () => {
        if (typeof openSearchDialog === 'function') openSearchDialog(false);
    });
}

// Global Shortcuts
function bindShortcuts() {
    const isTauri = !!(window.__TAURI__ || (AppState && AppState.tauri));
    console.log(`[Shortcut] Binding global shortcuts (capture phase). Environment: ${isTauri ? 'Tauri' : 'Browser'}`);

    window.addEventListener('keydown', (e) => {
        // Detailed log for debugging shortcut conflicts
        // Logs everything when Ctrl, Alt, or Meta is pressed
        if (e.ctrlKey || e.metaKey || e.altKey) {
            console.log(`[Shortcut] Keydown: ctrl=${e.ctrlKey}, meta=${e.metaKey}, alt=${e.altKey}, shift=${e.shiftKey}, code=${e.code}, key=${e.key}`);
        }

        // --- SAVE ---
        // Ctrl+S or Alt+S
        if ((e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey && (e.code === 'KeyS')) {
            console.log('[Shortcut] Triggered Save');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof saveFile === 'function') saveFile();
            return;
        }

        // --- SAVE AS ---
        // Ctrl+Shift+S or Alt+Shift+S
        if ((e.ctrlKey || e.metaKey || e.altKey) && e.shiftKey && (e.code === 'KeyS')) {
            console.log('[Shortcut] Triggered Save As');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof saveFileAs === 'function') saveFileAs();
            return;
        }

        // --- NEW ---
        // Ctrl+N or Alt+N (Fallback)
        if (((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyN')) ||
            (e.altKey && !e.shiftKey && (e.code === 'KeyN'))) {
            console.log(`[Shortcut] Triggered New (via ${e.altKey ? 'Alt' : 'Ctrl'}+N)`);
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof newFile === 'function') newFile();
            else console.warn('[Shortcut] newFile function is not defined');
            return;
        }

        // --- NEW WINDOW ---
        // Ctrl+Shift+N or Alt+Shift+N (Fallback)
        if (((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyN')) ||
            (e.altKey && e.shiftKey && (e.code === 'KeyN'))) {
            console.log(`[Shortcut] Triggered New Window (via ${e.altKey ? 'Alt' : 'Ctrl'}+Shift+N)`);
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof newWindow === 'function') newWindow();
            else console.warn('[Shortcut] newWindow function is not defined');
            return;
        }

        // --- SEARCH ---
        // Ctrl+F or Cmd+F (Search)
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyF')) {
            console.log('[Shortcut] Triggered Search (KeyF)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof openSearchDialog === 'function') {
                openSearchDialog(false);
            }
            return;
        }

        // --- REPLACE ---
        // Ctrl+H or Cmd+H (Replace)
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyH')) {
            console.log('[Shortcut] Triggered Replace (KeyH)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof openSearchDialog === 'function') {
                openSearchDialog(true);
            }
            return;
        }

        // --- FIND NEXT ---
        // F3 (Find Next) — SVGモード時は無効
        if (e.code === 'F3') {
            if (AppState.isSvgMode) return;
            console.log('[Shortcut] Triggered F3 (Find Next/Prev)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.shiftKey) {
                if (typeof findPrevious === 'function') findPrevious();
            } else {
                if (typeof findNext === 'function') findNext();
            }
            return;
        }

        // [NEW] 入力要素フォーカス時はネイティブUndo/Redoを優先するため除外
        const isInputTarget = e.target && (
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable
        );

        // --- UNDO ---
        // Undo (Ctrl+Z)
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyZ')) {
            if (!e.target.closest('.cm-editor') && !isInputTarget) {
                console.log('[Shortcut] Triggered Undo');
                e.preventDefault();
                e.stopImmediatePropagation();
                if (typeof execUndo === 'function') execUndo();
            }
            return;
        }

        // --- REDO ---
        // Redo (Ctrl+Y or Ctrl+Shift+Z)
        const isRedoKey = ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY')) ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyZ'));

        if (isRedoKey) {
            if (!e.target.closest('.cm-editor') && !isInputTarget) {
                console.log('[Shortcut] Triggered Redo');
                e.preventDefault();
                e.stopImmediatePropagation();
                if (typeof execRedo === 'function') execRedo();
            }
            return;
        }

        // --- OUTLINE (Markdown) ---
        // F6 or Ctrl+Alt+O — SVGモード時は無効
        if (e.code === 'F6' || (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyO')) {
            if (AppState.isSvgMode) return;
            console.log('[Shortcut] Triggered Toggle Outline (F6)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof toggleOutline === 'function') toggleOutline();
            return;
        }

        // --- SVG LIST ---
        // F7
        if (e.code === 'F7') {
            console.log('[Shortcut] Triggered Toggle SVG List (F7)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof toggleSvgList === 'function') toggleSvgList();
            return;
        }

        // --- SLIDE ---
        // F10 (Fullscreen Slideshow) — SVGモード時は無効
        if (e.code === 'F10') {
            if (AppState.isSvgMode) return;
            console.log('[Shortcut] Triggered Slide Fullscreen (F10)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof openSlideshow === 'function') openSlideshow(true);
            return;
        }

        // --- VIEW TOGGLE ---
        // F4
        if (e.code === 'F4') {
            console.log('[Shortcut] Triggered View Toggle (F4)');
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof toggleView === 'function') toggleView();
            return;
        }
    }, true); // Use capture phase to override browser shortcuts
}

function attachCopyButtonListeners() {
    const copyButtons = DOM.preview.querySelectorAll('.copy-btn');

    copyButtons.forEach((btn) => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const originalCodeText = btn.dataset.codeText;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(originalCodeText).then(() => {
                    const copiedText = typeof I18n !== 'undefined' ? I18n.translate('code.copiedButton') || 'コピーしました!' : 'コピーしました!';
                    btn.textContent = copiedText;
                    btn.classList.add('copied');
                    setTimeout(() => {
                        const copyText = typeof I18n !== 'undefined' ? I18n.translate('code.copyButton') || 'コピー' : 'コピー';
                        btn.textContent = copyText;
                        btn.classList.remove('copied');
                    }, 2000);
                }).catch(() => {
                    // Fallback to execCommand
                    if (typeof fallbackCopy === 'function') fallbackCopy(originalCodeText, btn);
                });
            } else {
                // Fallback for older browsers or file:// protocol
                if (typeof fallbackCopy === 'function') fallbackCopy(originalCodeText, btn);
            }
        };
    });
}

/**
 * Fallback for clipboard copy using a temporary textarea
 * Used in non-secure contexts (file://, http://) or older browsers
 */
function fallbackCopy(text, btn) {
    const textArea = document.createElement("textarea");
    textArea.value = text;

    // Ensure the textarea is not visible but remains in the DOM
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);

    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            const copiedText = typeof I18n !== 'undefined' ? I18n.translate('code.copiedButton') || 'コピーしました!' : 'コピーしました!';
            btn.textContent = copiedText;
            btn.classList.add('copied');
            setTimeout(() => {
                const copyText = typeof I18n !== 'undefined' ? I18n.translate('code.copyButton') || 'コピー' : 'コピー';
                btn.textContent = copyText;
                btn.classList.remove('copied');
            }, 2000);
        }
    } catch (err) {
        console.error('[Fallback Copy] Unable to copy', err);
    }

    document.body.removeChild(textArea);
}


function attachPreviewEvents() {
    // Heading Click
    const headings = DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(h => {
        h.onclick = (e) => {
            // Only toggle if clicked on the icon (positioned to the left of the content)
            const rect = h.getBoundingClientRect();
            // Allow a bit of buffer, check if click is to the left of the text start
            if (e.clientX < rect.left) {
                e.stopPropagation();
                toggleHeading(h); // Use h directly
            }
        };
        // onkeydown によるキーボード操作機能（Enter/Spaceによる開閉）は
        // preview_inline_edit.js の全般的なフォーカス管理処理へと一元化しました。

        // Apply initial hidden state if collapsed
        if (h.classList.contains('collapsed')) {
            hideContent(h);
        }
    });

    // SVG Edit Mode - Add double-click handlers to SVG containers
    const svgContainers = DOM.preview.querySelectorAll('.svg-view-wrapper');
    svgContainers.forEach(container => {
        container.addEventListener('dblclick', function (e) {
            // [FIX] Skip if SVG editor is already active
            if (window.currentEditingSVG) {
                console.log('[UI Dblclick] SVG editor is already active, ignoring dblclick');
                return;
            }

            const index = parseInt(this.getAttribute('data-svg-index'));
            if (typeof startSVGEdit === 'function') startSVGEdit(this, index);
        });
    });

    // Link Click Handler for Markdown files and anchor links
    const isTauri = !!(window.__TAURI__ || (AppState && AppState.tauri));
    const links = DOM.preview.querySelectorAll('a');
    links.forEach(link => {
        link.onclick = async (e) => {
            const href = link.getAttribute('href');

            // アンカーリンク（ページ内ジャンプ）の処理
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const targetId = decodeURIComponent(href.substring(1));
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    scrollToHeading(targetElement);
                }
                return;
            }

            // Tauri版：外部URL（http/https）をOSのデフォルトブラウザで別ウィンドウで開く
            if (isTauri && href && (href.startsWith('http://') || href.startsWith('https://'))) {
                e.preventDefault();
                const tauri = AppState.tauri || window.__TAURI__;
                if (tauri && tauri.shell && tauri.shell.open) {
                    tauri.shell.open(href);
                } else if (window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open) {
                    window.__TAURI__.shell.open(href);
                }
                return;
            }

            // 相対Markdownリンクの処理
            if (href && (href.endsWith('.md') || href.endsWith('.markdown')) && !href.startsWith('http') && !href.startsWith('//')) {
                if (typeof isRelativeMdLink === 'function' && isRelativeMdLink(href)) {
                    e.preventDefault();
                    if (typeof openLinkedMarkdownFile === 'function') {
                        await openLinkedMarkdownFile(href);
                    }
                }
            }
            // HTML版：その他のリンク（外部リンクや一般ファイル）は、target="_blank" によるデフォルト挙動（新タブ）に任せるため preventDefault しない
        };
    });

    // Auto-resume SVG editing if pending
    if (typeof sessionStorage !== 'undefined') {
        const pendingIndex = sessionStorage.getItem('mdEditor_pendingSVGEditIndex');
        if (pendingIndex !== null) {
            sessionStorage.removeItem('mdEditor_pendingSVGEditIndex');
            const idx = parseInt(pendingIndex);

            // Wait slightly for DOM to settle
            setTimeout(() => {
                // [FIX] 既にエディタが起動している場合はスキップ。
                // ただし、以前のコンテナがDOMから消滅している（プレビューが再描画された）場合は常に再初期化を行う。
                const isStillValid = window.currentEditingSVG &&
                    window.currentEditingSVG.container &&
                    document.body.contains(window.currentEditingSVG.container);

                if (window.currentEditingSVG && window.currentEditingSVG.svgIndex === idx && isStillValid) {
                    console.log('[Auto-resume] Skipping: Already editing this SVG index in a valid container.');
                    return;
                }

                if (window.currentEditingSVG && window.currentEditingSVG.svgIndex === idx) {
                    console.log('[Auto-resume] Reconnecting: Preview re-render detected.');
                }

                const containers = DOM.preview.querySelectorAll('.svg-view-wrapper');
                containers.forEach(container => {
                    const cIdx = parseInt(container.getAttribute('data-svg-index'));
                    if (cIdx === idx) {
                        if (typeof startSVGEdit === 'function') {
                            startSVGEdit(container, idx);
                        }
                    }
                });
            }, 10);
        }
    }

    // [NEW] Task List Checkbox Sync
    const checkboxes = DOM.preview.querySelectorAll('.task-list-item-checkbox');
    checkboxes.forEach(cb => {
        cb.onclick = (e) => {
            // e.stopPropagation(); 
            const li = cb.closest('li');
            if (li && li.hasAttribute('data-line')) {
                const line = parseInt(li.getAttribute('data-line'), 10);
                if (!isNaN(line)) {
                    if (typeof toggleTaskListItem === 'function') toggleTaskListItem(line - 1, cb.checked);
                }
            }
        };
    });

    // [NEW] Foldable Elements (Code, SVG, Mermaid) Click Handler
    const foldableElements = DOM.preview.querySelectorAll('.foldable-element-container');
    foldableElements.forEach(details => {
        details.onclick = (e) => {
            // 左側の記号領域をクリックした時のみトグル
            const rect = details.getBoundingClientRect();
            // 記号は left: -24px に配置されているので、要素の左端から-24pxの範囲をチェック
            if (e.clientX < rect.left) {
                // [NEW] SVGエディタ起動時は、編集中のSVGを含む要素の折り畳みを無効化
                if (window.currentEditingSVG && window.currentEditingSVG.container) {
                    if (details.contains(window.currentEditingSVG.container)) {
                        console.log('[Foldable] Toggle blocked: SVG editor is active for this element.');
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                e.preventDefault();
                e.stopPropagation();
                // details要素のopen属性をトグル
                details.open = !details.open;
            }
        };
    });

    // 古い HTML5 ドラッグ＆ドロップマネージャーを破棄
    if (window.previewDragManager) {
        window.previewDragManager.destroy();
        window.previewDragManager = null;
    }

    // [NEW] Drag and Drop Handlers for Preview Blocks using PointerDragManager
    const previewItemSelector = '.md-preview p, .md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4, .md-preview h5, .md-preview h6, .md-preview li, .md-preview blockquote';
    const draggables = DOM.preview.querySelectorAll(previewItemSelector);
    
    draggables.forEach(block => {
        if (!block.hasAttribute('data-line')) return;
        // HTML5 DnD向けの draggable 属性があれば削除 (既存要素の場合)
        if (block.hasAttribute('draggable')) block.removeAttribute('draggable');
        
        // ハンドルの追加
        if (!block.querySelector('.drag-handle')) {
            const handle = document.createElement('div');
            handle.className = 'drag-handle';
            handle.innerHTML = '⠿';
            handle.contentEditable = "false";
            // 以前あった mousedown で draggable="true" を付与する処理は不要になりました
            block.appendChild(handle);
        }
    });

    if (typeof PointerDragManager !== 'undefined') {
        window.previewDragManager = new PointerDragManager({
            container: DOM.preview,
            itemSelector: previewItemSelector,
            handleSelector: '.drag-handle',
            draggingClass: 'dragging',
            onDragStart: (item, e) => {
                const hasImg = item.querySelector('img') !== null;
                const textNodes = Array.from(item.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim() !== '');
                const isImageOnly = hasImg && textNodes.length === 0;

                return {
                    element: item,
                    startLine: parseInt(item.getAttribute('data-line'), 10),
                    endLine: parseInt(item.getAttribute('data-line-end') || item.getAttribute('data-line'), 10),
                    isImageOnly: isImageOnly,
                    currentTargetInfo: null
                };
            },
            onDragMove: (data, e, info) => {
                let indicator = document.getElementById('drag-drop-indicator');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'drag-drop-indicator';
                    indicator.className = 'drop-indicator';
                    DOM.preview.appendChild(indicator);
                }

                if (!info.target) {
                    indicator.style.display = 'none';
                    data.currentTargetInfo = null;
                    return;
                }
                indicator.style.display = 'block';

                const rect = info.target.getBoundingClientRect();
                const previewRect = DOM.preview.getBoundingClientRect();
                const isTop = (e.clientY - rect.top) < (rect.height / 2);

                const hasImg = info.target.querySelector('img') !== null;
                const textNodes = Array.from(info.target.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim() !== '');
                const isTargetImageOnly = hasImg && textNodes.length === 0;

                let isMerge = false;
                if (data.isImageOnly && isTargetImageOnly) {
                    const relativeY = e.clientY - rect.top;
                    if (relativeY >= rect.height * 0.25 && relativeY <= rect.height * 0.75) {
                        isMerge = true;
                    }
                }

                if (isMerge) {
                    indicator.style.top = (rect.top - previewRect.top + DOM.preview.scrollTop - 2) + 'px';
                    indicator.style.height = (rect.height + 4) + 'px';
                    indicator.style.border = '2px dashed var(--accent-color, #2196F3)';
                    indicator.style.background = 'rgba(33, 150, 243, 0.1)';
                    indicator.style.left = '40px';
                    indicator.style.width = 'calc(100% - 80px)';
                } else {
                    indicator.style.height = '2px';
                    indicator.style.border = 'none';
                    indicator.style.background = 'var(--accent-color, #2196F3)';
                    const topPos = isTop ? (rect.top - previewRect.top + DOM.preview.scrollTop) : (rect.bottom - previewRect.top + DOM.preview.scrollTop);
                    indicator.style.top = topPos + 'px';
                    indicator.style.left = '40px';
                    indicator.style.width = 'calc(100% - 80px)';
                }

                data.currentTargetInfo = {
                    element: info.target,
                    isTop: isTop,
                    isMerge: isMerge
                };
            },
            onDragEnd: (data, e) => {
                const indicator = document.getElementById('drag-drop-indicator');
                if (indicator) indicator.remove();
            },
            onDrop: (data, dropTarget, e) => {
                const targetInfo = data.currentTargetInfo;
                if (!targetInfo || !targetInfo.element) return;

                const startLine = data.startLine;
                const endLine = data.endLine;

                const targetStartLine = parseInt(targetInfo.element.getAttribute('data-line'), 10);
                const targetEndLine = parseInt(targetInfo.element.getAttribute('data-line-end') || targetStartLine, 10);

                if (isNaN(startLine) || isNaN(targetStartLine) || startLine === targetStartLine) return;

                if (targetInfo.isMerge && typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.processMergeImages === 'function') {
                    PreviewInlineEdit.processMergeImages(startLine, endLine, targetStartLine, targetEndLine);
                } else if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.processDragAndDrop === 'function') {
                    PreviewInlineEdit.processDragAndDrop(startLine, endLine, targetStartLine, targetEndLine, targetInfo.isTop);
                }
            }
        });
    }
}
/**
 * プレビューエリアでのマウス移動を監視して行番号を表示
 */
function bindPreviewMouseMove() {
    if (!DOM.preview) return;

    DOM.preview.addEventListener('mousemove', (e) => {
        const target = e.target.closest('[data-line]');
        if (target) {
            const line = target.getAttribute('data-line');
            updateStatusBar({ previewLine: line });
        } else {
            updateStatusBar({ previewLine: null });
        }
    });

    DOM.preview.addEventListener('mouseleave', () => {
        updateStatusBar({ previewLine: null });
    });
}

/**
 * SVGモード時に不要なUI要素を非表示にする
 * AppState.isSvgMode が true の場合のみ動作する
 */
function applyUIModeRestrictions() {
    if (!AppState.isSvgMode) return;

    // 非表示にするボタンID（btn-outlineはSVGレイヤーメニューとして残す）
    const hideIds = ['btn-search', 'btn-slide-menu', 'btn-export-menu'];
    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    console.log('[SVGMode] UI restrictions applied: search/slide/export hidden');
}
window.applyUIModeRestrictions = applyUIModeRestrictions;
