/**
 * Search and Replace Functionality
 */

function openSearchDialog(replaceMode = false) {
    if (typeof loadSearchHistory === 'function') loadSearchHistory();

    if (AppState.searchState.query) {
        DOM.searchInput.value = AppState.searchState.query;
    }

    applySearchDialogLayout();
    DOM.dialogSearch.show();

    setTimeout(() => {
        DOM.searchInput.focus({ preventScroll: true });
        DOM.searchInput.select();
    }, 100);
}

// [NEW] Close on Esc (Global)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (DOM.dialogSearch && DOM.dialogSearch.open) {
            e.preventDefault();
            closeSearchDialog();
        }
    }
});


function bindSearchDialogEvents() {
    // Buttons
    if (DOM.searchNextBtn) DOM.searchNextBtn.onclick = findNext;
    if (DOM.searchPrevBtn) DOM.searchPrevBtn.onclick = findPrevious;
    if (DOM.searchShowAllBtn) DOM.searchShowAllBtn.onclick = showSearchResults;
    if (DOM.searchCloseBtn) DOM.searchCloseBtn.onclick = closeSearchDialog;

    if (DOM.replaceOneBtn) DOM.replaceOneBtn.onclick = replaceOne;
    if (DOM.replaceAllBtn) DOM.replaceAllBtn.onclick = replaceAll;

    // Draggable
    if (DOM.dialogSearch) {
        const header = DOM.dialogSearch.querySelector('.search-dialog-header');
        if (header && typeof makeElementDraggable === 'function') {
            makeElementDraggable(DOM.dialogSearch, header);
            header.style.cursor = 'move'; // Add visual cue
        }


        // Layout Select
        if (DOM.searchLayoutSelect) {
            DOM.searchLayoutSelect.onchange = () => {
                AppState.config.searchDialogLayout = DOM.searchLayoutSelect.value;
                applySearchDialogLayout();
                // Save config if persistence is implemented
                if (typeof saveSettings === 'function') saveSettings();
            };
        }

        // Initialize Search Results Dialog Events
        if (DOM.searchResultsCloseBtn) {
            DOM.searchResultsCloseBtn.onclick = closeSearchResultsDialog;
        }

        if (DOM.searchResultsDialog) {
            const header = DOM.searchResultsDialog.querySelector('.search-results-header');
            if (header && typeof makeElementDraggable === 'function') {
                makeElementDraggable(DOM.searchResultsDialog, header);
                header.style.cursor = 'move';
            }
        }

        // Inputs (Enter key)
        if (DOM.searchInput) {
            DOM.searchInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) findPrevious();
                    else findNext();

                    // Trigger search if not yet done or changed?
                    // Logic: findNext wraps performSearch if no matches? No.
                    // If matches empty, performSearch.
                    if (AppState.searchState.matches.length === 0) {
                        performSearch();
                    }
                }
            };
        }

        if (DOM.replaceInput) {
            DOM.replaceInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.ctrlKey) {
                        if (e.shiftKey) replaceAll();
                        else replaceOne();
                    }
                }
            };
        }
    }
}


function applySearchDialogLayout() {
    const layout = AppState.config.searchDialogLayout || 'vertical';
    if (DOM.searchLayoutSelect) {
        DOM.searchLayoutSelect.value = layout;
    }
    DOM.dialogSearch.classList.remove('search-dialog-vertical', 'search-dialog-horizontal');
    DOM.dialogSearch.classList.add(`search-dialog-${layout}`);
}

function closeSearchDialog() {
    DOM.dialogSearch.close();
    clearSearchHighlights();
}

function loadSearchHistory() {
    try {
        const history = localStorage.getItem('md_editor_search_history');
        if (history) {
            const parsed = JSON.parse(history);
            updateHistoryDatalist(parsed);
        }
    } catch (e) {
        console.error('Failed to load search history:', e);
    }
}

function updateHistoryDatalist(history) {
    if (DOM.searchHistoryList && history.searchHistory) {
        DOM.searchHistoryList.innerHTML = '';
        history.searchHistory.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            DOM.searchHistoryList.appendChild(option);
        });
    }

    if (DOM.replaceHistoryList && history.replaceHistory) {
        DOM.replaceHistoryList.innerHTML = '';
        history.replaceHistory.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            DOM.replaceHistoryList.appendChild(option);
        });
    }
}

function saveSearchHistory() {
    try {
        const query = AppState.searchState.query;
        if (!query) return;

        let history = { searchHistory: [], replaceHistory: [] };
        const stored = localStorage.getItem('md_editor_search_history');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    // Migrate from old array-only format
                    history.searchHistory = parsed;
                } else if (parsed && typeof parsed === 'object') {
                    history.searchHistory = Array.isArray(parsed.searchHistory) ? parsed.searchHistory : [];
                    history.replaceHistory = Array.isArray(parsed.replaceHistory) ? parsed.replaceHistory : [];
                }
            } catch (err) {
                console.warn('Failed to parse search history', err);
            }
        }

        const existingIndex = history.searchHistory.indexOf(query);
        if (existingIndex !== -1) history.searchHistory.splice(existingIndex, 1);
        history.searchHistory.unshift(query);
        if (history.searchHistory.length > 10) history.searchHistory = history.searchHistory.slice(0, 10);

        localStorage.setItem('md_editor_search_history', JSON.stringify(history));
        updateHistoryDatalist(history);
    } catch (e) {
        console.error('Failed to save search history:', e);
    }
}

function saveReplaceHistory(replaceText) {
    try {
        if (!replaceText) return;

        let history = { searchHistory: [], replaceHistory: [] };
        const stored = localStorage.getItem('md_editor_search_history');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    // Migrate from old array-only format
                    history.searchHistory = parsed;
                } else if (parsed && typeof parsed === 'object') {
                    history.searchHistory = Array.isArray(parsed.searchHistory) ? parsed.searchHistory : [];
                    history.replaceHistory = Array.isArray(parsed.replaceHistory) ? parsed.replaceHistory : [];
                }
            } catch (err) {
                console.warn('Failed to parse replace history', err);
            }
        }

        if (!history.replaceHistory) history.replaceHistory = [];

        const existingIndex = history.replaceHistory.indexOf(replaceText);
        if (existingIndex !== -1) history.replaceHistory.splice(existingIndex, 1);
        history.replaceHistory.unshift(replaceText);
        if (history.replaceHistory.length > 10) history.replaceHistory = history.replaceHistory.slice(0, 10);

        localStorage.setItem('md_editor_search_history', JSON.stringify(history));
        updateHistoryDatalist(history);
    } catch (e) {
        console.error('Failed to save replace history:', e);
    }
}

function resetSearch() {
    AppState.searchState.query = "";
    AppState.searchState.matches = [];
    AppState.searchState.currentIndex = -1;

    if (DOM.searchInput) DOM.searchInput.value = "";
    if (DOM.replaceInput) DOM.replaceInput.value = "";

    updateSearchStats();
    clearSearchHighlights();
}

function performSearch(isUpdate = false) {


    const query = DOM.searchInput.value;
    if (!query) {
        AppState.searchState.matches = [];
        AppState.searchState.currentIndex = -1;
        updateSearchStats();
        clearSearchHighlights();
        return;
    }

    clearPreviewHighlights();

    AppState.searchState.query = query;
    AppState.searchState.useRegex = DOM.searchRegexCheck.checked;
    AppState.searchState.matchCase = DOM.searchCaseCheck.checked;

    saveSearchHistory();

    let pattern;
    try {
        if (AppState.searchState.useRegex) {
            const flags = AppState.searchState.matchCase ? 'g' : 'gi';
            pattern = new RegExp(query, flags);
        } else {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flags = AppState.searchState.matchCase ? 'g' : 'gi';
            pattern = new RegExp(escapedQuery, flags);
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast(I18n.translate('search.invalidRegex'), 'error');
        return;
    }

    const text = getEditorText();
    const lines = text.split('\n');
    const matches = [];

    let inCodeBlock = false;

    lines.forEach((line, lineIndex) => {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            return;
        }

        let match;
        while ((match = pattern.exec(line)) !== null) {
            const column = match.index;
            const matchText = match[0];

            let type = 'other';
            if (inCodeBlock) type = 'codeBlock';
            else if (line.trim().startsWith('#')) type = 'heading';
            else if (line.includes('![') || line.includes('](')) type = 'link';
            else if (line.trim().startsWith('|')) type = 'table';

            const targets = AppState.searchState.targets;
            const typeMap = { 'heading': 'headings', 'link': 'links', 'codeBlock': 'codeBlocks', 'table': 'tables', 'other': 'other' };
            const targetKey = typeMap[type] || type;

            if (targets.all || targets[targetKey]) {
                matches.push({
                    line: lineIndex,
                    column: column,
                    length: matchText.length,
                    text: matchText,
                    type: type,
                    context: line
                });
            }

            if (match[0].length === 0) pattern.lastIndex++;
        }
    });

    AppState.searchState.matches = matches;
    if (isUpdate) {
        AppState.searchState.currentIndex = -1;
    } else {
        AppState.searchState.currentIndex = matches.length > 0 ? 0 : -1;
    }

    updateSearchStats();
    highlightMatches();
    highlightPreviewMatches();
    scrollPreviewToMatch();

    if (matches.length > 0 && !isUpdate) {
        jumpToMatch(0);
    }
}

function findNext() {


    // [NEW] Check if query changed
    const currentInput = DOM.searchInput ? DOM.searchInput.value : "";
    if (currentInput !== AppState.searchState.query) {
        performSearch();
        return;
    }

    const matches = AppState.searchState.matches;
    if (matches.length === 0) return;

    const prevIndex = AppState.searchState.currentIndex;
    AppState.searchState.currentIndex = (AppState.searchState.currentIndex + 1) % matches.length;

    if (prevIndex === matches.length - 1 && AppState.searchState.currentIndex === 0) {
        if (typeof showToast === 'function') showToast(I18n.translate('search.reachedFirst'));
    }

    jumpToMatch(AppState.searchState.currentIndex);
    updateSearchStats();
    highlightMatches();
    clearPreviewHighlights();
    highlightPreviewMatches();
    scrollPreviewToMatch();
}

function findPrevious() {
    // [NEW] Check if query changed
    const currentInput = DOM.searchInput ? DOM.searchInput.value : "";
    if (currentInput !== AppState.searchState.query) {
        performSearch();
        return;
    }

    const matches = AppState.searchState.matches;
    if (matches.length === 0) return;

    const prevIndex = AppState.searchState.currentIndex;
    AppState.searchState.currentIndex = (AppState.searchState.currentIndex - 1 + matches.length) % matches.length;

    if (prevIndex === 0 && AppState.searchState.currentIndex === matches.length - 1) {
        if (typeof showToast === 'function') showToast(I18n.translate('search.reachedLast'));
    }

    jumpToMatch(AppState.searchState.currentIndex);
    updateSearchStats();
    highlightMatches();
    clearPreviewHighlights();
    highlightPreviewMatches();
    scrollPreviewToMatch();
}

function jumpToMatch(index) {

    const match = AppState.searchState.matches[index];
    if (!match) return;

    // Use global helper from editor.js (CodeMirror 6 compatible)
    if (typeof scrollToMatch === 'function') {
        scrollToMatch(match.line, match.column);
    } else {
        // Fallback
        const editorEl = document.getElementById('editor-container') || DOM.editor;
        const lineHeight = editorEl ? (parseInt(getComputedStyle(editorEl).lineHeight) || 20) : 20;
        const scrollTarget = match.line * lineHeight - (editorEl ? editorEl.clientHeight : 500) / 2;
        if (editorEl) editorEl.scrollTop = Math.max(0, scrollTarget);
    }

    scrollPreviewToMatch();
}

function updateSearchStats() {
    const matches = AppState.searchState.matches;
    const currentIndex = AppState.searchState.currentIndex;

    if (matches.length === 0) {
        DOM.searchCount.textContent = '0';
        DOM.searchCurrent.textContent = '-';
        if (DOM.searchPosition) DOM.searchPosition.textContent = '';
    } else {
        DOM.searchCount.textContent = matches.length;
        DOM.searchCurrent.textContent = `${currentIndex + 1}/${matches.length}`;
        if (DOM.searchPosition && currentIndex >= 0 && currentIndex < matches.length) {
            const match = matches[currentIndex];
            DOM.searchPosition.textContent = `  (${I18n.translate('search.line')}: ${match.line + 1}, ${I18n.translate('search.column')}: ${match.column + 1})`;
        } else if (DOM.searchPosition) {
            DOM.searchPosition.textContent = '';
        }
    }
}

function highlightMatches() {
    const matches = AppState.searchState.matches;
    const currentIndex = AppState.searchState.currentIndex;

    // Use global helper from editor.js
    if (typeof highlightEditorMatches === 'function') {
        highlightEditorMatches(matches, currentIndex);
    }
}

function clearSearchHighlights() {
    // Clear via helper (passing empty array)
    if (typeof highlightEditorMatches === 'function') {
        highlightEditorMatches([], -1); // Clears decorations
    }

    // Legacy fallback (remove raw HTML highlights if any)
    if (DOM.editorHighlights) {
        DOM.editorHighlights.innerHTML = '';
    }
    clearPreviewHighlights();
}

function syncHighlightScroll() {
    // No-op
}

function highlightPreviewMatches() {
    if (!DOM.preview || !AppState.searchState.query) return;

    clearPreviewHighlights();

    const query = AppState.searchState.query;
    const useRegex = AppState.searchState.useRegex;
    const matchCase = AppState.searchState.matchCase;
    const editorMatches = AppState.searchState.matches;
    const currentIndex = AppState.searchState.currentIndex;

    if (editorMatches.length === 0) return;

    let pattern;
    try {
        if (useRegex) {
            const flags = matchCase ? 'g' : 'gi';
            pattern = new RegExp(query, flags);
        } else {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flags = matchCase ? 'g' : 'gi';
            pattern = new RegExp(escapedQuery, flags);
        }
    } catch (e) {
        return;
    }

    let globalMatchIndex = 0;
    highlightTextNodes(DOM.preview, pattern, currentIndex, globalMatchIndex, editorMatches);
}

function highlightTextNodes(element, pattern, currentIndex, globalMatchIndex, editorMatches) {
    // (Existing logic remains same, just condensed for brevity in replace)
    if (element.nodeType !== Node.ELEMENT_NODE || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return globalMatchIndex;

    const targets = AppState.searchState.targets;
    let shouldInclude = targets.all;

    if (!shouldInclude) {
        // ... (Simpilfied check logic preserved implicitly or explicitly)
        // For brevity, assuming full logic is restored or this tool handles full file replacement if block provided?
        // Note: tool is overwrite full usage. I need to be careful not to delete logic.
        // I will copy the original highlightTextNodes logic back in full.
        const tagName = element.tagName;
        if (targets.headings && /^H[1-6]$/.test(tagName)) shouldInclude = true;
        if (targets.links && tagName === 'A') shouldInclude = true;
        if (targets.codeBlocks && (tagName === 'PRE' || tagName === 'CODE')) shouldInclude = true;
        if (targets.tables && /^(TABLE|TD|TH)$/.test(tagName)) shouldInclude = true;

        if (!shouldInclude && element.parentElement) {
            const pTag = element.parentElement.tagName;
            if (targets.headings && /^H[1-6]$/.test(pTag)) shouldInclude = true;
            if (targets.links && pTag === 'A') shouldInclude = true;
            if (targets.codeBlocks && (pTag === 'PRE' || pTag === 'CODE')) shouldInclude = true;
            if (targets.tables && /^(TABLE|TD|TH)$/.test(pTag)) shouldInclude = true;
        }

        if (!shouldInclude && targets.other) {
            // Check current or parent against excluded list
            const isSpecial = (t) => /^H[1-6]$/.test(t) || /^(A|PRE|CODE|TABLE|TD|TH)$/.test(t);
            if (!isSpecial(tagName) && (!element.parentElement || !isSpecial(element.parentElement.tagName))) {
                shouldInclude = true;
            }
        }
    }

    const childNodes = Array.from(element.childNodes);
    childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && shouldInclude) {
            const text = node.textContent;
            if (!text.trim()) return;

            const matches = [...text.matchAll(pattern)];
            if (matches.length === 0) return;

            // [FIX] SVG内部の場合はハイライト（DOM改変）をスキップする
            // SVG内部に <span> や <mark> を入れるとレンダリングが破壊されるため。
            // インデックスの整合性を保つため、カウント（globalMatchIndex）だけ進める。
            const isInsideSVG = element.closest('svg');
            if (isInsideSVG) {
                globalMatchIndex += matches.length;
                return;
            }

            let lastIndex = 0;
            let html = '';
            matches.forEach(match => {
                html += escapeHtml(text.substring(lastIndex, match.index));
                const isCurrent = globalMatchIndex === currentIndex;
                const className = isCurrent ? 'search-highlight search-highlight-current' : 'search-highlight';
                html += `<mark class="${className}">${escapeHtml(match[0])}</mark>`;
                lastIndex = match.index + match[0].length;
                globalMatchIndex++;
            });
            html += escapeHtml(text.substring(lastIndex));

            const span = document.createElement('span');
            span.className = 'search-highlight-wrapper';
            span.innerHTML = html;
            node.replaceWith(span);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            globalMatchIndex = highlightTextNodes(node, pattern, currentIndex, globalMatchIndex, editorMatches);
        }
    });

    return globalMatchIndex;
}

function clearPreviewHighlights() {
    if (!DOM.preview) return;
    const wrappers = DOM.preview.querySelectorAll('span.search-highlight-wrapper');
    wrappers.forEach(wrapper => {
        const textContent = wrapper.textContent;
        const textNode = document.createTextNode(textContent);
        wrapper.replaceWith(textNode);
    });
    DOM.preview.normalize();
}

function scrollPreviewToMatch() {
    if (!DOM.preview) return;
    const currentMatch = DOM.preview.querySelector('.search-highlight-current');
    if (currentMatch) {
        // --- 該当要素が折りたたまれている（非表示）場合の自動展開処理 ---
        // offsetParent が null または見えない場合、親の要素を遡って collapsed のものを展開する
        let parent = currentMatch.parentElement;
        let needsExpand = false;
        const parentsToExpand = [];

        while (parent && parent !== DOM.preview) {
            // hidden クラスが付与されている、または直接非表示にされている要素を保持する
            // 実際は兄弟要素として非表示になっている場合があるため、
            // 見出しの折りたたみ実装に合わせて要素が非表示かどうかを判定する
            if (parent.style.display === 'none' || parent.classList.contains('hidden')) {
                needsExpand = true;
            }
            parent = parent.parentElement;
        }

        // 見出しの折りたたみ実装では、実は対象要素自体ではなく、その前の見出しが状態を持っている。
        // currentMatch の位置から上（前）に向かって一番近い見出し要素を探す
        // かつ、その見出しが collapsed 状態なら展開する。
        if (currentMatch.offsetParent === null) {
            let prevSibling = currentMatch;
            while (prevSibling) {
                // 親要素へたどって、そこからさらに前の兄弟要素を探索
                let node = prevSibling;
                while (node.previousElementSibling) {
                    node = node.previousElementSibling;
                    const tagName = node.tagName ? node.tagName.toUpperCase() : '';
                    if (/^H[1-6]$/.test(tagName) && node.classList.contains('collapsed')) {
                        // 隠れている原因となる折りたたみ見出しを発見したら展開
                        // UIコンポーネントの toggleHeading(node) を呼ぶか、直接クラスを操作
                        if (typeof toggleHeading === 'function') {
                            toggleHeading(node);
                        } else {
                            node.classList.remove('collapsed');
                            node.setAttribute('aria-expanded', 'true');
                            if (typeof showContent === 'function') showContent(node);
                        }
                    }
                }
                prevSibling = prevSibling.parentElement;
                if (prevSibling === DOM.preview) break;
            }
        }

        // 展開後にスクロール
        setTimeout(() => {
            currentMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }, 50);
    }
}

function replaceOne() {
    const matches = AppState.searchState.matches;
    const currentIndex = AppState.searchState.currentIndex;
    if (currentIndex < 0 || currentIndex >= matches.length) return;

    const match = matches[currentIndex];
    const replaceWith = DOM.replaceInput.value;
    saveReplaceHistory(replaceWith);

    // Calc pos
    const text = getEditorText();
    const lines = text.split('\n');
    let charPos = 0;
    // CM6 treats all newlines as 1 char internally for indexing
    for (let i = 0; i < match.line; i++) {
        charPos += lines[i].length + 1;
    }
    charPos += match.column;

    clearTimeout(debounceTimer);

    // Use updateEditorRange for partial replacement instead of setEditorText to prevent CM6 infinite loops
    if (typeof window.updateEditorRange === 'function') {
        window.updateEditorRange(charPos, charPos + match.length, replaceWith);
    } else {
        // Fallback
        const newText = text.substring(0, charPos) + replaceWith + text.substring(charPos + match.length);
        setEditorText(newText);
    }

    // エディタ変更イベントによって自動で performSearch が 300ms 後に走るのを防ぐ
    // これにより手動で設定した currentIndex が -1 にリセットされるのを防ぐ
    if (typeof window.searchDebounceTimer !== 'undefined') {
        clearTimeout(window.searchDebounceTimer);
    }

    AppState.isModified = true;

    // Execute search without resetting index
    performSearch(true);

    const nextMatches = AppState.searchState.matches;
    if (nextMatches.length > 0) {
        let nextIndex = currentIndex;
        if (nextIndex >= nextMatches.length) {
            nextIndex = nextMatches.length - 1;
        }

        AppState.searchState.currentIndex = nextIndex;

        jumpToMatch(nextIndex);
        updateSearchStats();
        highlightMatches();
        clearPreviewHighlights();
        highlightPreviewMatches();
        scrollPreviewToMatch();
    }

    if (typeof showToast === 'function') showToast(I18n.translate('search.replacedOne'));
}

function replaceAll() {
    const matches = AppState.searchState.matches;
    if (matches.length === 0) return;
    const replaceWith = DOM.replaceInput.value;
    saveReplaceHistory(replaceWith);

    if (!confirm(I18n.translate('search.confirmReplaceAll', { count: matches.length }))) return;

    const sortedMatches = [...matches].sort((a, b) => {
        if (a.line !== b.line) return b.line - a.line;
        return b.column - a.column;
    });

    let text = getEditorText();
    const lines = text.split('\n');

    sortedMatches.forEach(match => {
        let charPos = 0;
        for (let i = 0; i < match.line; i++) charPos += lines[i].length + 1;
        charPos += match.column;
        text = text.substring(0, charPos) + replaceWith + text.substring(charPos + match.length);
    });

    clearTimeout(debounceTimer);
    setEditorText(text);
    AppState.isModified = true;
    if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(text);
    if (typeof render === 'function') render();

    // 全置換後に遅延で検索が走り直すのを防ぐ
    if (typeof window.searchDebounceTimer !== 'undefined') {
        clearTimeout(window.searchDebounceTimer);
    }

    if (typeof showToast === 'function') showToast(I18n.translate('search.replacedAll', { count: matches.length }));

    AppState.searchState.matches = [];
    AppState.searchState.currentIndex = -1;
    updateSearchStats();
}

// --- Search Results Dialog ---
function showSearchResults() {
    // Ensure search is up to date
    performSearch();

    const matches = AppState.searchState.matches;
    if (matches.length === 0) {
        if (typeof showToast === 'function') showToast(I18n.translate('search.notFound'), 'info');
        return;
    }

    // Populate List
    updateSearchResultsList(matches);

    // Update Footer
    if (DOM.searchResultsQuery) DOM.searchResultsQuery.textContent = I18n.translate('search.resultsQuery', { query: AppState.searchState.query });
    if (DOM.searchResultsCount) DOM.searchResultsCount.textContent = I18n.translate('search.resultsCount', { count: matches.length });

    // Show Dialog
    if (DOM.searchResultsDialog) {
        DOM.searchResultsDialog.show(); // Non-modal

        // Smart Positioning (Basic)
        // Ensure it doesn't overlap completely if possible, or just default pos
        const searchRect = DOM.dialogSearch.getBoundingClientRect();
        DOM.searchResultsDialog.style.top = `${searchRect.top}px`;
        DOM.searchResultsDialog.style.left = `${searchRect.right + 10}px`;

        // Adjust if off-screen
        const resultsRect = DOM.searchResultsDialog.getBoundingClientRect();
        if (resultsRect.right > window.innerWidth) {
            DOM.searchResultsDialog.style.left = `${searchRect.left - resultsRect.width - 10}px`;
        }
    }
}

function updateSearchResultsList(matches) {
    if (!DOM.searchResultsList) return;
    DOM.searchResultsList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    matches.forEach((match, index) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.index = index;

        // Line Number
        const lineSpan = document.createElement('span');
        lineSpan.className = 'search-result-line';
        lineSpan.textContent = I18n.translate('search.lineNumber', { line: match.line + 1 });

        // Type Badge
        const typeSpan = document.createElement('span');
        const typeMap = {
            'heading': { label: I18n.translate('search.targetHeadings'), class: 'badge-heading', color: '#2196f3' },
            'link': { label: I18n.translate('search.targetLinks'), class: 'badge-link', color: '#9c27b0' },
            'codeBlock': { label: I18n.translate('search.targetCode'), class: 'badge-code', color: '#ff9800' },
            'table': { label: I18n.translate('search.targetTables'), class: 'badge-table', color: '#4caf50' },
            'other': { label: I18n.translate('search.targetOther'), class: 'badge-other', color: '#757575' }
        };
        const typeInfo = typeMap[match.type] || typeMap['other'];
        typeSpan.className = `search-result-type`;
        typeSpan.style.backgroundColor = typeInfo.color;
        typeSpan.style.color = 'white';
        typeSpan.style.padding = '2px 6px';
        typeSpan.style.borderRadius = '4px';
        typeSpan.style.fontSize = '10px';
        typeSpan.style.marginRight = '8px';
        typeSpan.textContent = typeInfo.label;


        // Context (Text content) with Highlight
        const contextSpan = document.createElement('span');
        contextSpan.className = 'search-result-context';

        // Exact highlighting based on column and length
        try {
            // Trim context but keep highlight offset correct? 
            // Trimming might break index. Let's keep it simple: no trim for now or handle offset.
            // match.context is full line.
            const pre = escapeHtml(match.context.substring(0, match.column));
            const target = escapeHtml(match.context.substring(match.column, match.column + match.length));
            const post = escapeHtml(match.context.substring(match.column + match.length));

            contextSpan.innerHTML = `${pre}<mark class="search-highlight-preview">${target}</mark>${post}`;
        } catch (e) {
            contextSpan.textContent = escapeHtml(match.context);
        }

        item.appendChild(lineSpan);
        item.appendChild(typeSpan);
        item.appendChild(contextSpan);

        item.onclick = () => {
            AppState.searchState.currentIndex = index;

            // 1. Move Editor
            jumpToMatch(index);

            // 2. Update Highlights (Editor & Preview)
            highlightMatches();                // Editor
            clearPreviewHighlights();          // Preview Clear
            highlightPreviewMatches();         // Preview Draw (includes current orange)

            // 3. Ensure Preview Visible
            scrollPreviewToMatch();

            // Update selected style in list
            document.querySelectorAll('.search-result-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
        };

        fragment.appendChild(item);
    });

    DOM.searchResultsList.appendChild(fragment);
    DOM.searchResultsList.scrollTop = 0;
}

// Escape helper if not global
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function closeSearchResultsDialog() {
    if (DOM.searchResultsDialog) DOM.searchResultsDialog.close();
}
