/**
 * Editor <-> Preview Sync Functionality
 */

// --- Scroll Sync (CM6 Precise) ---
// Note: window.isScrolling is defined in editor_core.js

function syncPreviewFromEditor() {
    if (!DOM.previewPane || !editorView) return;

    // [NEW] １つでも編集状態がある場合はプレビューエリアの自動スクロールを停止
    const isEditingSVG = typeof window.isSVGEditing === 'function' && window.isSVGEditing();
    const isEditingTable = typeof window.isTableEditing === 'function' && window.isTableEditing();
    const isEditingInline = typeof window.isInlineEditing === 'function' && window.isInlineEditing();
    const textEditing = typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.isEditing;

    if (isEditingSVG || isEditingTable || isEditingInline || textEditing) {
        return; // Pause auto-scroll to preview while editing
    }

    // 1. Get Scroll Top
    const scrollTop = editorView.scrollDOM.scrollTop;

    // 2. Get Line Block at visible top
    // lineBlockAtHeight(height, mode?) -> BlockInfo { from, to, top, bottom, height, type... }
    // Using top of viewport + margin/padding offset if needed.
    // CM6 coords are relative to document top.
    const lineBlock = editorView.lineBlockAtHeight(scrollTop);

    // 3. Get Line Number (1-based)
    // Map position to line number
    const lineObj = editorView.state.doc.lineAt(lineBlock.from);
    const lineNumber = lineObj.number;

    // 4. Calculate progress within the line (0.0 - 1.0)
    const range = lineBlock.bottom - lineBlock.top;
    const ratio = (scrollTop - lineBlock.top) / range;

    // 5. Find target element in preview
    const targetElement = findElementByLineNumber(lineNumber);

    if (targetElement) {
        // Correctly handle multi-line elements (like code blocks)
        const startLineAttr = targetElement.getAttribute('data-line');
        const endLineAttr = targetElement.getAttribute('data-line-end');
        const startLine = parseInt(startLineAttr, 10);
        const endLine = parseInt(endLineAttr, 10) || startLine;

        if (isNaN(startLine)) {
            window.isScrolling = false;
            return;
        }

        let elementOffset = 0;

        // Calculate interpolation within the element
        const lineCount = endLine - startLine + 1;
        if (lineCount > 0 && targetElement.offsetHeight > 0) {
            // How far are we into the block (in lines)?
            const progressInBlock = (lineNumber - startLine) + ratio;
            // [FIX] Ensure ratio is within 0-1
            const blockRatio = Math.max(0, Math.min(1, progressInBlock / lineCount));
            elementOffset = targetElement.offsetHeight * blockRatio;
        }

        // [FIX] Calculate Offset Relative to Preview Pane (Accumulate offsetParents)
        const relativeTop = getRelativeOffsetTop(targetElement, DOM.previewPane);
        let targetScroll = relativeTop + elementOffset;

        // [FIX] Final validation before scrolling
        if (!isFinite(targetScroll) || isNaN(targetScroll)) {
            targetScroll = relativeTop;
        }

        // スクロール実行前にロックを設定
        window.isScrolling = true;

        if (DOM.previewPane) {
            DOM.previewPane.scrollTop = targetScroll;
        }

        // スクロール完了後にロックを解除
        setTimeout(() => window.isScrolling = false, 150);
    } else {
        // logDebug(`  [Sync->Preview] Element for Line ${lineNumber} NOT FOUND.`);
        if (scrollTop === 0) {
            DOM.previewPane.scrollTop = 0;
        }
    }
}

// Helper: Calculate offsetTop relative to a specific ancestor container
function getRelativeOffsetTop(element, container) {
    let offset = 0;
    let current = element;

    while (current && current !== container && container.contains(current)) {
        offset += current.offsetTop;
        current = current.offsetParent;
    }
    return offset;
}

function findElementByLineNumber(line) {
    if (!DOM.preview) return null;

    // Get all elements with data-line
    const elements = Array.from(DOM.preview.querySelectorAll('[data-line]'));
    if (elements.length === 0) return null;

    // Linear search is safer for sparse attributes
    let target = null;
    for (const el of elements) {
        const elLine = parseInt(el.getAttribute('data-line'), 10);
        if (isNaN(elLine)) continue;

        if (elLine > line) {
            break;
        }
        target = el;
    }

    return target;
}

function syncEditorFromPreview() {
    if (!DOM.previewPane || !editorView) return;

    // Find the element at the top of the preview pane
    // We can't use elementFromPoint easily because of stacking contexts and structure.
    // Better: Iterate elements and find the first one that is visible (offsetTop >= scrollTop)

    const elements = Array.from(DOM.preview.querySelectorAll('[data-line]'));
    if (elements.length === 0) return;

    const scrollTop = DOM.previewPane.scrollTop;


    const scrollBottom = scrollTop + DOM.previewPane.clientHeight;

    let targetElement = null;
    let fallbackElement = null;

    // Binary search or linear search for first visible element
    // Elements are sorted by DOM order, which usually matches line order.

    for (const el of elements) {
        const elTop = getRelativeOffsetTop(el, DOM.previewPane);
        const elBottom = elTop + el.offsetHeight;

        // Check if element overlaps with the top of the view
        // Or is the first element below the top
        if (elTop >= scrollTop) {
            targetElement = el;
            break;
        }
        fallbackElement = el; // Last element before top
    }

    // Refine: if fallbackElement is partially visible at top?
    if (!targetElement && fallbackElement) targetElement = fallbackElement;
    if (!targetElement) return;

    const lineNumber = parseInt(targetElement.getAttribute('data-line'), 10);
    const endLine = parseInt(targetElement.getAttribute('data-line-end'), 10) || lineNumber;
    if (isNaN(lineNumber)) return;


    let targetLine = lineNumber;
    let visualRatio = 0;
    if (targetElement.offsetHeight > 0) {
        const absoluteTop = getRelativeOffsetTop(targetElement, DOM.previewPane);
        visualRatio = Math.max(0, Math.min(1, (scrollTop - absoluteTop) / targetElement.offsetHeight));
        const lineCount = endLine - lineNumber + 1;
        targetLine = lineNumber + (visualRatio * lineCount);
    }

    // [FIX] 計算精度や要素の状態により NaN が発生するのを防ぐ
    if (!isFinite(visualRatio) || isNaN(visualRatio)) visualRatio = 0;
    if (!isFinite(targetLine) || isNaN(targetLine)) targetLine = lineNumber;

    // Scroll Editor to this line
    const { EditorView } = window.CM6 || {};
    if (!EditorView || !editorView) return;

    // Convert line number to position (targetLine is float)
    const lineInt = Math.floor(targetLine);
    const totalLines = editorView.state.doc.lines;
    const safeLine = Math.min(Math.max(1, lineInt), totalLines);

    try {
        const lineInfo = editorView.state.doc.line(safeLine);

        // [FIX] エディタスクロール前にロックを設定して無限ループを防ぐ
        window.isScrolling = true;

        // 軽量なscrollTop直接操作に切り替え（Measure loop restarted警告対策）
        const block = editorView.lineBlockAt(lineInfo.from);
        if (!block) throw new Error("Could not find line block");

        // 元のpreview側での相対位置（visualRatio）をエディタ側でも再現
        let targetScrollTop = block.top + (visualRatio * (block.bottom - block.top));

        // [FIX] NaN または無効なスクロール位置が設定されるのを防ぐ
        if (targetScrollTop !== undefined && isFinite(targetScrollTop) && !isNaN(targetScrollTop)) {
            editorView.scrollDOM.scrollTop = targetScrollTop;
        } else {
            console.warn("[Sync<-Preview] Invalid ScrollTop calculated:", targetScrollTop);
        }
    } catch (e) {
        console.warn("[Sync<-Preview] Failed to resolve line position:", e);
    }

    // [FIX] スクロール完了後にロックを解除
    setTimeout(() => window.isScrolling = false, 100);
}

function bindScrollSync() {
    if (!DOM.previewPane) return;

    // Editor -> Preview (Handled by scroll listener in updateListener or domEventHandlers)

    // [New] Editor -> UI (Outline Sync)
    // Ensures outline updates when scrolling editor, even if preview is hidden (Editor-Only mode)
    if (editorView && editorView.scrollDOM) {
        editorView.scrollDOM.addEventListener('scroll', () => {
            if (typeof debouncedUpdateActiveOutlineItem === 'function') {
                debouncedUpdateActiveOutlineItem();
            }
        });
    }

    // Preview -> Editor (Scroll Sync)
    DOM.previewPane.addEventListener('scroll', () => {
        if (window.isScrolling) return;

        // Debounce slightly to avoid aggressive fighting
        clearTimeout(window.previewScrollTimer);
        window.previewScrollTimer = setTimeout(() => {
            syncEditorFromPreview();
        }, 50); // スクロール追従を滑らかにするため50msでデバウンス
    });

    // Preview -> Editor (Click/Cursor Sync)
    // [NEW] Sync cursor position when clicking in preview
    if (DOM.preview) {
        DOM.preview.addEventListener('click', (e) => {
            // Find closest element with data-line
            const target = e.target.closest('[data-line]');
            if (!target) return;

            const lineStr = target.getAttribute('data-line');
            const startLine = parseInt(lineStr, 10); // 1-based
            if (isNaN(startLine)) return;

            // Get Selection to find offset within the element
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);

            // Calculate offset relative to the start of the target element
            // We create a temporary range from the target's start to the click position
            const preCaretRange = range.cloneRange();

            try {
                preCaretRange.setStart(target, 0); // Start of target
                preCaretRange.setEnd(range.endContainer, range.endOffset); // Click position
                const textOffset = preCaretRange.toString().length;

                // Move Editor Cursor
                if (editorView) {
                    // CM6 lines are 1-based
                    const doc = editorView.state.doc;
                    // Ensure line is valid
                    if (startLine > doc.lines) return;

                    const lineObj = doc.line(startLine);

                    // Constrain offset to line length
                    const validOffset = Math.min(textOffset, lineObj.length);
                    const pos = lineObj.from + validOffset;

                    /* 
                    // [Temporarily disabled by user request]
                    // Sync editor cursor and focus when clicking in preview
                    editorView.dispatch({
                        selection: { anchor: pos, head: pos },
                        scrollIntoView: true,
                    });
                    editorView.focus();
                    */
                }
            } catch (err) {
                console.warn("Cursor sync calculation failed:", err);
            }
        });
    }

    // [NEW] Preview Status Bar Update
    if (DOM.preview && DOM.previewStatusBar) {
        document.addEventListener('selectionchange', () => {
            // Only update if selection is inside preview
            const sel = window.getSelection();
            if (!sel.rangeCount) return;

            let node = sel.anchorNode;
            if (!node) return;

            // Check if node is inside preview
            // node might be text node, get parentElement
            const element = (node.nodeType === 3) ? node.parentElement : node;

            if (!DOM.preview.contains(element)) {
                // Cursor outside preview: Clear status bar text but keep visible
                DOM.previewStatusBar.textContent = '';
                return;
            }

            // Selection IS in preview
            const target = element.closest('[data-line]');
            if (target) {
                const lineStr = target.getAttribute('data-line');
                const startLine = parseInt(lineStr, 10);

                if (!isNaN(startLine)) {
                    // Calculate offset
                    const range = sel.getRangeAt(0);
                    const preCaretRange = range.cloneRange();
                    try {
                        preCaretRange.setStart(target, 0);
                        preCaretRange.setEnd(range.endContainer, range.endOffset);
                        const textOffset = preCaretRange.toString().length;

                        // Display in Status Bar
                        DOM.previewStatusBar.textContent = `行: ${startLine} 列: ${textOffset}`;
                        DOM.previewStatusBar.style.display = 'block';
                    } catch (e) { /* ignore range errors */ }
                    return;
                }
            }

            // Fallback if in preview but no data-line found (e.g. between blocks)
            DOM.previewStatusBar.textContent = ''; // Clear text but keep visible
        });
    }
}

/**
 * Detect which line was folded/unfolded in Editor and sync to UI
 */
function syncUIFoldFromEditor(update) {
    const { foldEffect, unfoldEffect } = window.CM6;

    update.transactions.forEach(tr => {
        tr.effects.forEach(effect => {
            let isCollapsed = null;
            if (effect.is(foldEffect)) isCollapsed = true;
            else if (effect.is(unfoldEffect)) isCollapsed = false;

            if (isCollapsed !== null) {
                const pos = effect.value.from;
                const line = update.state.doc.lineAt(pos);
                const lineNumber = line.number;

                // Find corresponding heading in preview
                const headingEl = findHeadingByLineNumber(lineNumber);
                if (headingEl) {
                    const uiCollapsed = headingEl.classList.contains('collapsed');
                    if (uiCollapsed !== isCollapsed) {
                        if (typeof toggleHeading === 'function') {
                            toggleHeading(headingEl, true);
                        }
                    }
                }
            }
        });
    });
}

/**
 * Find heading element in preview by line number in editor
 */
function findHeadingByLineNumber(lineNumber) {
    if (!DOM.preview) return null;
    const headings = DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');

    for (const h of headings) {
        const lineStr = h.getAttribute('data-line');
        const line = parseInt(lineStr, 10);
        if (line === lineNumber) {
            return h;
        }
    }
    return null;
}

// --- Scroll Restoration (Tauri F5 Reload Support) ---
function setupScrollRestoration() {
    // Only for Tauri environment to support F5 reload scroll restoration
    // HTML version naturally loses state on reload
    console.log(`[ScrollDebug] setupScrollRestoration called. TAURI=${!!window.__TAURI__}`); // DEBUG
    if (!window.__TAURI__) return;

    if (editorView && editorView.scrollDOM) {
        // Save scroll position on scroll with debounce
        let scrollTimeout;
        console.log('[ScrollDebug] Attaching scroll listener to:', editorView.scrollDOM); // DEBUG
        editorView.scrollDOM.addEventListener('scroll', () => {
            // console.log('[ScrollDebug] Scroll event fired'); // Too noisy? maybe useful once
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                saveScrollPosition('scroll');
            }, 100); // Save quicker (100ms)
        });

        // Also try to save on unload, just in case scroll event didn't fire yet
        window.addEventListener('beforeunload', () => {
            console.log('[ScrollDebug] beforeunload triggered'); // DEBUG
            saveScrollPosition('beforeunload');
        });
    }

    // [New] Listen to Preview Scroll as well (for Preview-Only mode)
    if (DOM.previewPane) {
        let previewScrollTimeout;
        console.log('[ScrollDebug] Attaching scroll listener to PreviewPane', DOM.previewPane);
        DOM.previewPane.addEventListener('scroll', (e) => {
            // console.log('[ScrollDebug] Preview scroll event fired', e.target);
            clearTimeout(previewScrollTimeout);
            previewScrollTimeout = setTimeout(() => {
                saveScrollPosition('preview-scroll');
            }, 100);
        });
    } else {
        console.error('[ScrollDebug] setupScrollRestoration: DOM.previewPane missing');
    }
}

function saveScrollPosition(context = 'unknown') {
    if (editorView && editorView.scrollDOM) {
        const scrollTop = editorView.scrollDOM.scrollTop;
        console.log(`[ScrollDebug] saveScrollPosition(${context}). scrollTop: ${scrollTop}`); // DEBUG

        // [Safety Fix] If beforeunload reports 0, it might be due to layout destruction. 
        // Trust the last 'scroll' event value (already in sessionStorage) instead of overwriting with 0.
        if (context === 'beforeunload' && scrollTop === 0) {
            console.warn('[ScrollDebug] Skipping save on beforeunload because scrollTop is 0 (preventing overwrite)');
            return;
        }

        if (scrollTop >= 0) {
            sessionStorage.setItem('editorScrollPos', scrollTop.toString());
            // Also save current file path to verify we are restoring for same file
            if (AppState && AppState.fileFullPath) {
                // console.log(`[ScrollDebug] Saving path: ${AppState.fileFullPath}`); // DEBUG
                sessionStorage.setItem('editorScrollPath', AppState.fileFullPath);
            }
        }
    } else {
        console.warn('[ScrollDebug] saveScrollPosition: editorView or scrollDOM missing'); // DEBUG
    }

    // 2. Save Preview Scroll (Independent)
    if (DOM.previewPane) {
        const previewTop = DOM.previewPane.scrollTop;
        if (context === 'preview-scroll' || context === 'scroll') {
            console.log(`[ScrollDebug] saveScrollPosition(${context}). Preview scrollTop: ${previewTop}, Height: ${DOM.previewPane.scrollHeight}, Client: ${DOM.previewPane.clientHeight}`);
        }
        if (previewTop >= 0) {
            sessionStorage.setItem('previewScrollPos', previewTop.toString());
        }
    }
}

function restoreScrollPosition() {
    const savedPos = sessionStorage.getItem('editorScrollPos');
    const savedPath = sessionStorage.getItem('editorScrollPath');
    const savedPreviewPos = sessionStorage.getItem('previewScrollPos'); // [New]

    console.log(`[ScrollDebug] Attempting restore. EditorPos: ${savedPos}, PreviewPos: ${savedPreviewPos}, Path: ${savedPath}, CurrentPath: ${AppState?.fileFullPath}, ViewMode: ${AppState?.viewMode}`); // DEBUG

    // Clear immediately to prevent affecting future file opens
    sessionStorage.removeItem('editorScrollPos');
    sessionStorage.removeItem('editorScrollPath');
    sessionStorage.removeItem('previewScrollPos');

    // Verify Path
    if (savedPath && AppState && AppState.fileFullPath && savedPath !== AppState.fileFullPath) {
        console.log('[ScrollDebug] Path mismatch, aborting restore.'); // DEBUG
        if (editorView) editorView.scrollDOM.scrollTop = 0;
        if (DOM.previewPane) DOM.previewPane.scrollTop = 0;
        return;
    }

    // Restore Logic
    // If Preview-Only mode, prioritize restoring Preview Pane directly
    if (AppState.viewMode === 'preview-only' && savedPreviewPos !== null && DOM.previewPane) {
        setTimeout(() => {
            console.log(`[ScrollDebug] Restoring Preview directly: ${savedPreviewPos}`);
            DOM.previewPane.scrollTop = parseInt(savedPreviewPos, 10);
        }, 100);
        return; // Skip editor restore to avoid conflict (editor is hidden anyway)
    }

    // Normal Mode (Editor or Split) - Restore Editor and Sync
    if (savedPos !== null) {
        if (editorView) {
            // Use setTimeout to allow render to settle
            setTimeout(() => {
                console.log(`[ScrollDebug] Restoring Editor execution. Setting scrollTop to ${savedPos}`); // DEBUG
                editorView.scrollDOM.scrollTop = parseInt(savedPos, 10);

                // Force sync preview to this position
                if (typeof syncPreviewFromEditor === 'function') {
                    window.forceScrollSync = true;
                    syncPreviewFromEditor();
                    window.forceScrollSync = false;
                }
            }, 100);
        } else {
            console.warn('[ScrollDebug] restoreScrollPosition: editorView missing'); // DEBUG
        }
    } else {
        console.log('[ScrollDebug] No saved position, scrolling to top.'); // DEBUG
        if (editorView) editorView.scrollDOM.scrollTop = 0;
        if (DOM.previewPane) DOM.previewPane.scrollTop = 0;
    }
}

// Export for usage if needed (though mainly internal)
window.setupScrollRestoration = setupScrollRestoration;
window.saveScrollPosition = saveScrollPosition;
window.restoreScrollPosition = restoreScrollPosition;
