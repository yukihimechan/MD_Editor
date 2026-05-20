/**
 * Mermaid Base Module
 * Mermaidエディタ（フローチャート、シーケンス、クラス、ERなど）で共通して使用される
 * ロジック（テキスト反映と復元、ソースパース用ユーティリティなど）を提供します。
 */
window.MermaidBase = {
    /**
     * wrapper要素からMermaidソースコードブロックの範囲を取得する。
     * @param {Element} wrapper
     * @returns {{startIdx: number, endIdx: number, lines: string[]}|null}
     */
    getMermaidBlockRange(wrapper) {
        let dataLineEl = wrapper;
        if (!dataLineEl.hasAttribute('data-line') && wrapper.closest('.code-block-wrapper')) {
            const parentWrapper = wrapper.closest('.code-block-wrapper');
            if (parentWrapper.hasAttribute('data-line')) {
                dataLineEl = parentWrapper;
            }
        }
        const dataLine = dataLineEl.getAttribute('data-line');
        if (!dataLine || isNaN(dataLine)) return null;

        const fullText = typeof getEditorText === 'function' ? getEditorText() : '';
        const lines    = fullText.split('\n');
        let startIdx = parseInt(dataLine, 10) - 1; // 0-indexed

        const startLine = (lines[startIdx] || '').trim();
        if (!startLine.startsWith('```mermaid') && !startLine.startsWith('~~~mermaid')) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                const idx = startIdx + d;
                if (idx < 0 || idx >= lines.length) continue;
                const l = lines[idx].trim();
                if (l.startsWith('```mermaid') || l.startsWith('~~~mermaid')) {
                    found = idx;
                    break;
                }
            }
            if (found === -1) return null;
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) {
                endIdx = i;
                break;
            }
        }

        if (endIdx === -1) return null;
        return { startIdx, endIdx, lines };
    },

    /**
     * 編集モード時の完了ボタンのUI更新
     * @param {Element} wrapper
     */
    updateEditButtonToDoneMode(wrapper) {
        if (!wrapper) return;
        const cbw = wrapper.classList.contains('code-block-wrapper') ? wrapper : wrapper.closest('.code-block-wrapper');
        if (!cbw) return;

        const editBtn = cbw.querySelector('.code-edit-btn:not(.btn-expand-mermaid)');
        if (editBtn && !editBtn.classList.contains('mermaid-done-mode')) {
            const doneLabel = typeof I18n !== 'undefined' ? (I18n.translate('editor.done') || '完了') : '完了';
            editBtn.textContent = doneLabel;
            editBtn.classList.add('mermaid-done-mode');
            editBtn._originalOnclick = editBtn.onclick;
            editBtn.onclick = (ev) => {
                ev.stopPropagation();
                if (typeof InlineCodeEditor !== 'undefined') InlineCodeEditor.exitMermaidEdit();
            };
        }
    },

    /**
     * テキストを書き換えて再描画し、Mermaidの編集モード状態を復元する
     * @param {Element} wrapper 
     * @param {string[]} newTextLines 
     * @param {string} modeClass - 'mermaid-edit-mode', 'mermaid-sequence-edit-mode', etc.
     * @param {Object} toolbar - window.activeMermaidToolbar 等
     */
    applyEditorTextAndRestore(wrapper, newTextLines, modeClass = 'mermaid-edit-mode', toolbar = null, options = {}) {
        // 再描画前に編集状態情報を保存
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line')
            || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        if (typeof setEditorText === 'function') {
            setEditorText(newTextLines.join('\n'));
        }

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                // 編集モードを復元
                const preview = document.getElementById('preview');
                if (!preview) return;

                let newDiagramWrapper = null;
                let newCodeBlockWrapper = null;

                if (savedCodeIndex !== undefined) {
                    newCodeBlockWrapper = document.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
                    if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
                }
                if (!newDiagramWrapper && savedDataLine) {
                    newDiagramWrapper = document.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
                    if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
                }

                if (newDiagramWrapper) {
                    newDiagramWrapper.classList.add(modeClass);
                    if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
                        InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
                        if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
                    }
                    if (newCodeBlockWrapper) {
                        window.MermaidBase.updateEditButtonToDoneMode(newCodeBlockWrapper);
                    }
                    if (toolbar && typeof toolbar.show === 'function') {
                        toolbar.show(newDiagramWrapper);
                    }
                }

                // 復元完了後のコールバック（拡大ビューのリセット等に使用）
                if (typeof options.onAfterRestore === 'function') {
                    options.onAfterRestore(newDiagramWrapper);
                }
            }, 100);
        }, 50);
    }
};
