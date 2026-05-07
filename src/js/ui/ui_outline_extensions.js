/**
 * Outline Panel Extensions
 * - Drag and Drop for heading reordering
 * - Keyboard controls for heading level changes
 */

let outlineDragManager = null;

/**
 * Attach drag and drop events to outline items
 * Call this function after buildOutline()
 */
function attachOutlineDragAndKeyboardEvents() {
    const items = DOM.outlineContent.querySelectorAll('.outline-item');
    console.log('[Outline] Found', items.length, 'outline items to attach events');

    // 古い HTML5 ドラッグ＆ドロップマネージャーを破棄
    if (outlineDragManager) {
        outlineDragManager.destroy();
        outlineDragManager = null;
    }

    // PointerDragManagerを利用した新しいドラッグ＆ドロップ
    if (typeof PointerDragManager !== 'undefined') {
        outlineDragManager = new PointerDragManager({
            container: DOM.outlineContent,
            itemSelector: '.outline-item',
            onDragStart: (item, e) => {
                const index = parseInt(item.dataset.headingIndex);
                const level = parseInt(item.dataset.headingLevel);
                console.log('[Outline] Drag start:', index, 'level:', level);
                return { index, level };
            },
            onDrop: (data, dropTarget, e) => {
                console.log('[Outline] Drop event');
                const fromIndex = data.index;
                const toIndex = parseInt(dropTarget.dataset.headingIndex);

                console.log('[Outline] Moving from', fromIndex, 'to', toIndex);

                if (fromIndex === toIndex || isNaN(toIndex)) return;

                // 見出しをエディタ内で移動
                moveHeadingInEditor(fromIndex, toIndex);
            }
        });
    } else {
        console.warn('[Outline] PointerDragManager is not available');
    }

    items.forEach((item, idx) => {
        // draggable属性を明示的に削除 (HTML5 DnD廃止)
        if (item.hasAttribute('draggable')) {
            item.removeAttribute('draggable');
        }

        // Remove old HTML5 event listeners (if any are still lingering)
        // just in case, this could be omitted logically.

        // Keyboard Events for heading level change
        item.removeEventListener('keydown', handleOutlineKeyDown);
        item.addEventListener('keydown', handleOutlineKeyDown);
    });

    console.log('[Outline] Pointer events and Keyboard events attached to', items.length, 'items');
}


/**
 * Handle keyboard events for outline items
 */
function handleOutlineKeyDown(e) {
    const item = e.target;
    const index = parseInt(item.dataset.headingIndex);

    if (e.key === 'ArrowLeft') {
        // 見出しレベルを下げる（H2 -> H1）
        e.preventDefault();
        changeHeadingLevel(index, -1);
    } else if (e.key === 'ArrowRight') {
        // 見出しレベルを上げる（H2 -> H3）
        e.preventDefault();
        changeHeadingLevel(index, +1);
    }
}

/**
 * エディタ内で見出しブロックを移動
 * @param {number} fromIndex - 移動元見出しのインデックス
 * @param {number} toIndex - 移動先見出しのインデックス
 */
function moveHeadingInEditor(fromIndex, toIndex) {
    if (!window.editorInstance) return;

    const doc = window.editorInstance.state.doc;
    const headings = [];

    let inCodeBlock = false;
    // すべての見出しの行番号を収集
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.text.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
        if (!inCodeBlock && /^#{1,6}\s/.test(line.text)) {
            const level = line.text.match(/^(#{1,6})/)[1].length;
            headings.push({ lineNumber: i, level, from: line.from, to: line.to });
        }
    }

    if (fromIndex >= headings.length || toIndex >= headings.length) return;

    // 移動元の見出しとその下位コンテンツの範囲を取得
    const fromHeading = headings[fromIndex];
    const fromLevel = fromHeading.level;

    // 次の同レベルまたは上位レベルの見出しを探す
    let endIndex = fromIndex + 1;
    while (endIndex < headings.length && headings[endIndex].level > fromLevel) {
        endIndex++;
    }

    // 移動する範囲を取得
    const startLine = fromHeading.lineNumber;
    const endLine = endIndex < headings.length ? headings[endIndex].lineNumber - 1 : doc.lines;

    const startPos = doc.line(startLine).from;
    const endPos = doc.line(endLine).to;
    const movingText = doc.sliceString(startPos, endPos);

    // 移動先の位置を計算
    const toHeading = headings[toIndex];
    let insertPos;

    if (fromIndex < toIndex) {
        // 下に移動: toIndexの見出しブロックの後ろに挿入
        let toEndIndex = toIndex + 1;
        while (toEndIndex < headings.length && headings[toEndIndex].level > toHeading.level) {
            toEndIndex++;
        }
        const toEndLine = toEndIndex < headings.length ? headings[toEndIndex].lineNumber - 1 : doc.lines;
        insertPos = doc.line(toEndLine).to;
    } else {
        // 上に移動: toIndexの見出しの前に挿入
        insertPos = doc.line(toHeading.lineNumber).from;
    }

    // トランザクションを作成して適用
    const changes = [];
    const docLength = doc.length;

    if (fromIndex < toIndex) {
        // 下に移動: 
        // 1. 先に挿入（insertPosは削除範囲の後ろなので影響を受けない）
        changes.push({
            from: insertPos,
            to: insertPos,
            insert: "\n" + movingText
        });
        // 2. 削除（改行を含めて削除するが、ドキュメント末尾を超えないようにする）
        changes.push({
            from: startPos,
            to: Math.min(endPos + 1, docLength),
            insert: ""
        });
    } else {
        // 上に移動:
        // 1. 削除
        changes.push({
            from: startPos,
            to: Math.min(endPos + 1, docLength),
            insert: ""
        });
        // 2. 挿入
        changes.push({
            from: insertPos,
            to: insertPos,
            insert: movingText + "\n"
        });
    }

    try {
        window.editorInstance.dispatch({ changes });
    } catch (err) {
        console.error('[Outline] Failed to move heading:', err);
        // フォールバック: 一括更新（効率は悪いが確実）
        // ただし通常は上記で通るはず
    }

    // レンダリングとアウトライン更新
    setTimeout(() => {
        if (typeof render === 'function') render();
    }, 50);
}

/**
 * 見出しレベルを変更
 * @param {number} headingIndex - 見出しのインデックス
 * @param {number} delta - レベルの変更量（-1で下げる、+1で上げる）
 */
function changeHeadingLevel(headingIndex, delta) {
    if (!window.editorInstance) return;

    const doc = window.editorInstance.state.doc;
    const headings = [];

    let inCodeBlock = false;
    // すべての見出しの行番号を収集
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.text.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
        if (!inCodeBlock && /^#{1,6}\s/.test(line.text)) {
            headings.push({ lineNumber: i, from: line.from, to: line.to, text: line.text });
        }
    }

    if (headingIndex >= headings.length) return;

    const heading = headings[headingIndex];
    const currentLevel = heading.text.match(/^(#{1,6})/)[1].length;
    const newLevel = currentLevel + delta;

    // レベルのチェック（H1～H6の範囲内）
    if (newLevel < 1 || newLevel > 6) return;

    // 新しい見出しテキストを作成
    const newHeadingMark = '#'.repeat(newLevel);
    const newText = heading.text.replace(/^#{1,6}/, newHeadingMark);

    // エディタを更新
    window.editorInstance.dispatch({
        changes: { from: heading.from, to: heading.to, insert: newText }
    });

    // レンダリングとアウトライン更新
    setTimeout(() => {
        if (typeof render === 'function') render();
    }, 50);
}

// Export functions to global scope
window.attachOutlineDragAndKeyboardEvents = attachOutlineDragAndKeyboardEvents;
