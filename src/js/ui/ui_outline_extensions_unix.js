/**
 * Outline Panel Extensions
 * - Drag and Drop for heading reordering
 * - Keyboard controls for heading level changes
 */

let outlineDragData = null;

/**
 * Attach drag and drop events to outline items
 * Call this function after buildOutline()
 */
function attachOutlineDragAndKeyboardEvents() {
    const items = DOM.outlineContent.querySelectorAll('.outline-item');
    console.log('[Outline] Found', items.length, 'outline items to attach events');

    items.forEach((item, idx) => {
        // Verify draggable attribute
        if (!item.hasAttribute('draggable')) {
            console.warn('[Outline] Item', idx, 'missing draggable attribute, adding it');
            item.setAttribute('draggable', 'true');
        }

        // Remove old event listeners to avoid duplicates
        item.removeEventListener('dragstart', handleOutlineDragStart);
        item.removeEventListener('dragover', handleOutlineDragOver);
        item.removeEventListener('dragenter', handleOutlineDragEnter);
        item.removeEventListener('drop', handleOutlineDrop);
        item.removeEventListener('dragleave', handleOutlineDragLeave);
        item.removeEventListener('dragend', handleOutlineDragEnd);

        // Drag and Drop Events
        item.addEventListener('dragstart', handleOutlineDragStart);
        item.addEventListener('dragover', handleOutlineDragOver);
        item.addEventListener('dragenter', handleOutlineDragEnter);
        item.addEventListener('drop', handleOutlineDrop);
        item.addEventListener('dragleave', handleOutlineDragLeave);
        item.addEventListener('dragend', handleOutlineDragEnd);

        // Keyboard Events for heading level change
        item.addEventListener('keydown', handleOutlineKeyDown);
    });

    console.log('[Outline] Event listeners attached to', items.length, 'items');
}

/**
 * Handle drag start for outline items
 */
function handleOutlineDragStart(e) {
    const item = e.currentTarget;
    const index = parseInt(item.dataset.headingIndex);
    const level = parseInt(item.dataset.headingLevel);

    console.log('[Outline] Drag start:', index, 'level:', level);

    outlineDragData = { index, level, element: item };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Add visual feedback
    setTimeout(() => {
        item.classList.add('dragging');
    }, 0);
}

/**
 * Handle drag enter for outline items
 */
function handleOutlineDragEnter(e) {
    console.log('[Outline] Drag enter');
    if (!outlineDragData) return;

    e.preventDefault();
    const item = e.currentTarget;
    const targetIndex = parseInt(item.dataset.headingIndex);

    if (isNaN(targetIndex) || targetIndex === outlineDragData.index) return;

    item.classList.add('drop-target');
}

/**
 * Handle drag over for outline items
 */
function handleOutlineDragOver(e) {
    console.log('[Outline] Drag over');
    if (!outlineDragData) return;

    e.preventDefault();
    e.stopPropagation();

    // CRITICAL: Set dropEffect to allow drop
    e.dataTransfer.dropEffect = 'move';

    const item = e.currentTarget;
    const targetIndex = parseInt(item.dataset.headingIndex);

    if (isNaN(targetIndex) || targetIndex === outlineDragData.index) {
        e.dataTransfer.dropEffect = 'none';
        return;
    }
}

/**
 * Handle drag leave for outline items
 */
function handleOutlineDragLeave(e) {
    const item = e.currentTarget;

    // Only remove if we're actually leaving this element (not entering a child)
    const rect = item.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        item.classList.remove('drop-target');
    }
}

/**
 * Handle drop for outline items
 */
function handleOutlineDrop(e) {
    console.log('[Outline] Drop event');
    e.preventDefault();
    e.stopPropagation();

    const targetItem = e.currentTarget;
    if (!targetItem || !outlineDragData) {
        console.warn('[Outline] No target or drag data on drop');
        return;
    }

    const fromIndex = outlineDragData.index;
    const toIndex = parseInt(targetItem.dataset.headingIndex);

    console.log('[Outline] Moving from', fromIndex, 'to', toIndex);

    // Clean up visual feedback
    const allItems = DOM.outlineContent.querySelectorAll('.outline-item');
    allItems.forEach(i => i.classList.remove('drop-target'));

    if (fromIndex === toIndex || isNaN(toIndex)) return;

    // 隕句・縺励ｒ繧ｨ繝・ぅ繧ｿ蜀・〒遘ｻ蜍・
    moveHeadingInEditor(fromIndex, toIndex);
}

/**
 * Handle drag end for outline items
 */
function handleOutlineDragEnd(e) {
    console.log('[Outline] Drag end');
    const item = e.currentTarget;
    item.classList.remove('dragging');

    // 縺吶∋縺ｦ縺ｮdrop-target繧ｯ繝ｩ繧ｹ繧貞炎髯､
    const items = DOM.outlineContent.querySelectorAll('.outline-item');
    items.forEach(i => {
        i.classList.remove('drop-target');
        i.classList.remove('dragging');
    });

    outlineDragData = null;
}

/**
 * Handle keyboard events for outline items
 */
function handleOutlineKeyDown(e) {
    const item = e.target;
    const index = parseInt(item.dataset.headingIndex);

    if (e.key === 'ArrowLeft') {
        // 隕句・縺励Ξ繝吶Ν繧剃ｸ九￡繧具ｼ・2 -> H1・・
        e.preventDefault();
        changeHeadingLevel(index, -1);
    } else if (e.key === 'ArrowRight') {
        // 隕句・縺励Ξ繝吶Ν繧剃ｸ翫￡繧具ｼ・2 -> H3・・
        e.preventDefault();
        changeHeadingLevel(index, +1);
    }
}

/**
 * 繧ｨ繝・ぅ繧ｿ蜀・〒隕句・縺励ヶ繝ｭ繝・け繧堤ｧｻ蜍・
 * @param {number} fromIndex - 遘ｻ蜍募・隕句・縺励・繧､繝ｳ繝・ャ繧ｯ繧ｹ
 * @param {number} toIndex - 遘ｻ蜍募・隕句・縺励・繧､繝ｳ繝・ャ繧ｯ繧ｹ
 */
function moveHeadingInEditor(fromIndex, toIndex) {
    if (!window.editorInstance) return;

    const doc = window.editorInstance.state.doc;
    const headings = [];

    // 縺吶∋縺ｦ縺ｮ隕句・縺励・陦檎分蜿ｷ繧貞庶髮・
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (/^#{1,6}\s/.test(line.text)) {
            const level = line.text.match(/^(#{1,6})/)[1].length;
            headings.push({ lineNumber: i, level, from: line.from, to: line.to });
        }
    }

    if (fromIndex >= headings.length || toIndex >= headings.length) return;

    // 遘ｻ蜍募・縺ｮ隕句・縺励→縺昴・荳倶ｽ阪さ繝ｳ繝・Φ繝・・遽・峇繧貞叙蠕・
    const fromHeading = headings[fromIndex];
    const fromLevel = fromHeading.level;

    // 谺｡縺ｮ蜷後Ξ繝吶Ν縺ｾ縺溘・荳贋ｽ阪Ξ繝吶Ν縺ｮ隕句・縺励ｒ謗｢縺・
    let endIndex = fromIndex + 1;
    while (endIndex < headings.length && headings[endIndex].level > fromLevel) {
        endIndex++;
    }

    // 遘ｻ蜍輔☆繧狗ｯ・峇繧貞叙蠕・
    const startLine = fromHeading.lineNumber;
    const endLine = endIndex < headings.length ? headings[endIndex].lineNumber - 1 : doc.lines;

    const startPos = doc.line(startLine).from;
    const endPos = doc.line(endLine).to;
    const movingText = doc.sliceString(startPos, endPos);

    // 遘ｻ蜍募・縺ｮ菴咲ｽｮ繧定ｨ育ｮ・
    const toHeading = headings[toIndex];
    let insertPos;

    if (fromIndex < toIndex) {
        // 荳九↓遘ｻ蜍・ toIndex縺ｮ隕句・縺励ヶ繝ｭ繝・け縺ｮ蠕後ｍ縺ｫ謖ｿ蜈･
        let toEndIndex = toIndex + 1;
        while (toEndIndex < headings.length && headings[toEndIndex].level > toHeading.level) {
            toEndIndex++;
        }
        const toEndLine = toEndIndex < headings.length ? headings[toEndIndex].lineNumber - 1 : doc.lines;
        insertPos = doc.line(toEndLine).to;
    } else {
        // 荳翫↓遘ｻ蜍・ toIndex縺ｮ隕句・縺励・蜑阪↓謖ｿ蜈･
        insertPos = doc.line(toHeading.lineNumber).from;
    }

    // 繝医Λ繝ｳ繧ｶ繧ｯ繧ｷ繝ｧ繝ｳ繧剃ｽ懈・縺励※驕ｩ逕ｨ
    const changes = [];

    if (fromIndex < toIndex) {
        // 荳九↓遘ｻ蜍・ 蜈医↓謖ｿ蜈･縺励※縺九ｉ蜑企勁
        changes.push({
            from: insertPos,
            to: insertPos,
            insert: "\n" + movingText
        });
        changes.push({
            from: startPos,
            to: endPos + 1, // 謾ｹ陦後ｂ蜷ｫ繧√ｋ
            insert: ""
        });
    } else {
        // 荳翫↓遘ｻ蜍・ 蜈医↓蜑企勁縺励※縺九ｉ謖ｿ蜈･
        changes.push({
            from: startPos,
            to: endPos + 1,
            insert: ""
        });
        changes.push({
            from: insertPos,
            to: insertPos,
            insert: movingText + "\n"
        });
    }

    window.editorInstance.dispatch({ changes });

    // 繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ縺ｨ繧｢繧ｦ繝医Λ繧､繝ｳ譖ｴ譁ｰ
    setTimeout(() => {
        if (typeof render === 'function') render();
    }, 50);
}

/**
 * 隕句・縺励Ξ繝吶Ν繧貞､画峩
 * @param {number} headingIndex - 隕句・縺励・繧､繝ｳ繝・ャ繧ｯ繧ｹ
 * @param {number} delta - 繝ｬ繝吶Ν縺ｮ螟画峩驥擾ｼ・1縺ｧ荳九￡繧九・1縺ｧ荳翫￡繧具ｼ・
 */
function changeHeadingLevel(headingIndex, delta) {
    if (!window.editorInstance) return;

    const doc = window.editorInstance.state.doc;
    const headings = [];

    // 縺吶∋縺ｦ縺ｮ隕句・縺励・陦檎分蜿ｷ繧貞庶髮・
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (/^#{1,6}\s/.test(line.text)) {
            headings.push({ lineNumber: i, from: line.from, to: line.to, text: line.text });
        }
    }

    if (headingIndex >= headings.length) return;

    const heading = headings[headingIndex];
    const currentLevel = heading.text.match(/^(#{1,6})/)[1].length;
    const newLevel = currentLevel + delta;

    // 繝ｬ繝吶Ν縺ｮ繝√ぉ繝・け・・1・曰6縺ｮ遽・峇蜀・ｼ・
    if (newLevel < 1 || newLevel > 6) return;

    // 譁ｰ縺励＞隕句・縺励ユ繧ｭ繧ｹ繝医ｒ菴懈・
    const newHeadingMark = '#'.repeat(newLevel);
    const newText = heading.text.replace(/^#{1,6}/, newHeadingMark);

    // 繧ｨ繝・ぅ繧ｿ繧呈峩譁ｰ
    window.editorInstance.dispatch({
        changes: { from: heading.from, to: heading.to, insert: newText }
    });

    // 繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ縺ｨ繧｢繧ｦ繝医Λ繧､繝ｳ譖ｴ譁ｰ
    setTimeout(() => {
        if (typeof render === 'function') render();
    }, 50);
}

// Export functions to global scope
window.attachOutlineDragAndKeyboardEvents = attachOutlineDragAndKeyboardEvents;
