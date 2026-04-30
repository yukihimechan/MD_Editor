/**
 * Editor Commands (Undo/Redo, Print)
 * 検索ダイアログは search.js の openSearchDialog() を使用
 */

// --- Undo/Redo Button Sync ---
function updateUndoRedoButtons() {
    if (typeof UndoRedoManager !== 'undefined') {
        UndoRedoManager.updateButtons();
    }
}

// --- Undo/Redo Actions ---
function execUndo() {
    if (!window.editorInstance) return;
    let undoFunc = window.CM6.undo;

    // Fallback: search in historyKeymap
    if (!undoFunc && window.CM6.historyKeymap) {
        const item = window.CM6.historyKeymap.find(k => k.key === "Mod-z");
        if (item) undoFunc = item.run;
    }

    if (typeof undoFunc === 'function') {
        undoFunc(window.editorInstance);
        updateUndoRedoButtons();
    } else {
        console.warn("Undo function not found in window.CM6 or historyKeymap");
    }
}
window.execUndo = execUndo;

function execRedo() {
    if (!window.editorInstance) return;
    let redoFunc = window.CM6.redo;

    // Fallback: search in historyKeymap
    if (!redoFunc && window.CM6.historyKeymap) {
        // Redo is often Mod-y or Mod-Shift-z
        const item = window.CM6.historyKeymap.find(k => k.key === "Mod-y" || k.key === "Mod-Shift-z");
        if (item) redoFunc = item.run;
    }

    if (typeof redoFunc === 'function') {
        redoFunc(window.editorInstance);
        updateUndoRedoButtons();
    } else {
        console.warn("Redo function not found in window.CM6 or historyKeymap");
    }
}
window.execRedo = execRedo;

async function openPrintDialog() {
    try {
        const isSlideMode = typeof SlideManager !== 'undefined' && SlideManager.isActive;

        // 印刷用コンテナの準備
        const printContainer = document.createElement('div');
        printContainer.id = 'print-container';
        printContainer.className = 'md-preview'; // デフォルトのプレビュースタイルを当てるため
        document.body.appendChild(printContainer);

        if (!isSlideMode && typeof showToast === 'function') {
            showToast(t('toast.preparingPrint'), "info");
            // 少し待機してToastを表示させる
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (isSlideMode) {
            // スライド表示中の場合：各スライドを1ページに収ぺる
            // @page { size: landscape } は Chrome/Edge で無視されるため、
            // aspect-ratio: 16/9 でA4縦に完全に収まるようにする（A4縦にスライド是感なく欲る）
            const pages = SlideManager.slides;
            pages.forEach((page, index) => {
                const wrapper = document.createElement('div');
                wrapper.style.cssText = [
                    'display: flex',
                    'align-items: center',
                    'justify-content: center',
                    'width: 100%',
                    'height: 100vh',     // 1ページ分の高さ
                    'page-break-after: always',
                    'break-after: page',
                    'box-sizing: border-box',
                    'overflow: hidden',
                ].join('; ');

                const clone = page.cloneNode(true);
                // スライド用スタイルが適用されるようにクラスを付与
                clone.classList.add('slide-page');

                // スライドを白紙に収まるサイズ設定
                clone.style.position = 'relative';
                clone.style.top = 'auto';
                clone.style.left = 'auto';
                clone.style.transform = 'none';
                clone.style.width = '100%';
                clone.style.height = 'auto';
                clone.style.aspectRatio = '16 / 9';
                clone.style.maxWidth = '100%';
                clone.style.maxHeight = '100vh';
                clone.style.margin = '0';
                clone.style.boxShadow = 'none';
                clone.style.overflow = 'hidden';

                wrapper.appendChild(clone);
                printContainer.appendChild(wrapper);
            });
        } else {
            // 通常レイアウトの場合：ブラウザネイティブの改ページ（CSSページング）を使用する
            // PageSplitterはPDF/スライドの画面描画用であり、実際の印刷にはブラウザ自身の改ページ管理が最適
            const element = DOM.preview;
            const clonedPreview = element.cloneNode(true);
            clonedPreview.style.padding = '';
            clonedPreview.style.margin = '0';
            clonedPreview.style.maxWidth = 'none';
            printContainer.appendChild(clonedPreview);
        }

        // 印刷クラスの付与 (CSSで他の要素を非表示化)
        document.body.classList.add('is-printing');
        if (isSlideMode) {
            // スライド印刷時は A4横を適用するためのクラスも付与
            document.body.classList.add('is-printing-slide');
        }

        // hr の改ページ指定を適用
        if (AppState.config.pageBreakOnHr) {
            const hrElements = printContainer.querySelectorAll('hr');
            hrElements.forEach(hr => {
                hr.classList.add('page-break-before');
            });
        }

        // 描画が反映されるのを少し待つ
        await new Promise(resolve => setTimeout(resolve, 300));

        // スライド印刷時は A4横の @page ルールを一時スタイルとして注入
        let landscapeStyle = null;
        if (isSlideMode) {
            landscapeStyle = document.createElement('style');
            landscapeStyle.id = 'print-landscape-override';
            landscapeStyle.textContent = '@page { size: A4 landscape; margin: 0; }';
            document.head.appendChild(landscapeStyle);
        }

        // 印刷ダイアログの表示
        window.print();

        // 後始末― 初期化
        if (landscapeStyle) document.head.removeChild(landscapeStyle);
        document.body.classList.remove('is-printing');
        document.body.classList.remove('is-printing-slide');
        document.body.removeChild(printContainer);

    } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') showToast(t('error.printPrepHalfFailed'), "error");

        // エラー時も確実に後始末を行う
        document.body.classList.remove('is-printing');
        const pc = document.getElementById('print-container');
        if (pc) document.body.removeChild(pc);
    }
}

/**
 * Toggle Markdown mark (e.g. **, *) for selection
 */
function toggleMark(view, mark) {
    const markLen = mark.length;
    const { state, dispatch } = view;
    const docLen = state.doc.length;

    dispatch(state.changeByRange(range => {
        let { from, to } = range;

        // Safety clamp
        from = Math.max(markLen, Math.min(from, docLen));
        to = Math.max(0, Math.min(to, docLen - markLen));

        const text = state.doc.sliceString(range.from, range.to);
        const before = state.doc.sliceString(Math.max(0, range.from - markLen), range.from);
        const after = state.doc.sliceString(range.to, Math.min(docLen, range.to + markLen));

        // Use the range's own constructor to ensure we return a proper SelectionRange instance
        const makeRange = (anchor, head) => {
            const a = Math.max(0, Math.min(anchor, docLen));
            const h = Math.max(0, Math.min(head, docLen));

            // [NEW] window.CM6 に登録した正規クラスを優先
            const CM6Selection = window.CM6?.EditorSelection;
            if (CM6Selection && typeof CM6Selection.range === 'function') {
                return CM6Selection.range(a, h);
            }

            try {
                // インスタンスのコンストラクタを利用 (SelectionRange)
                return range.constructor.range(a, h);
            } catch (e) {
                // 完全なフォールバック: プレーンオブジェクトを返すとCM6内部（range.map等）でTypeErrorを引き起こすため、
                // 確実にインスタンスが生成できない場合は、元の range をそのまま返すことでエディタのクラッシュを回避する。
                console.warn("[toggleMark] Failed to build SelectionRange. Falling back to original range to prevent crashes.");
                return range;
            }
        };

        // Case 1: Already wrapped (check surroundings)
        if (before === mark && after === mark) {
            return {
                changes: [
                    { from: range.from - markLen, to: range.from, insert: "" },
                    { from: range.to, to: range.to + markLen, insert: "" }
                ],
                range: makeRange(range.from - markLen, range.to - markLen)
            };
        }

        // Case 2: Selected text is wrapped (internal check)
        if (text.startsWith(mark) && text.endsWith(mark) && text.length >= markLen * 2) {
            return {
                changes: { from: range.from, to: range.to, insert: text.slice(markLen, -markLen) },
                range: makeRange(range.from, range.to - markLen * 2)
            };
        }

        // Case 3: Not wrapped - wrap it
        return {
            changes: { from: range.from, to: range.to, insert: mark + text + mark },
            range: makeRange(range.from + markLen, range.to + markLen)
        };
    }));

    return true;
}

function execBold(view) {
    return toggleMark(view || window.editorInstance, "**");
}
window.execBold = execBold;

function execItalic(view) {
    return toggleMark(view || window.editorInstance, "*");
}
window.execItalic = execItalic;
