/**
 * Editor Operations (CodeMirror 6 Version) - Core & Initialization
 */

let editorView = null; // CM6 EditorView instance
let editorState = null; // CM6 EditorState (managed by view)

// Helper for Search Highlights
let searchEffects = null; // StateEffect for search/highlights

// CM6 Extensions state
let currentExtensions = [];

// --- Scroll Sync Lock ---
window.isScrolling = false;


// --- Initialize CodeMirror 6 ---

// --- Initialization ---
function initEditor() {
    if (editorView) return;

    const editorContainer = document.getElementById('editor-container');
    if (!editorContainer) {
        console.error('Editor container not found');
        return;
    }

    if (!window.CM6) {
        console.error('CodeMirror 6 bundle not loaded (window.CM6 missing)');
        return;
    }

    const {
        EditorView, EditorState, basicSetup, markdown, markdownLanguage, languages,
        html, LanguageDescription,
        keymap, defaultKeymap, history, historyKeymap, searchKeymap, Compartment,
        oneDark, StateEffect, StateField, Decoration, WidgetType,
        syntaxHighlighting, defaultHighlightStyle, HighlightStyle, tags
    } = window.CM6;

    // [NEW] 明示的に EditorSelection クラスを登録 (コマンド側で使用するため)
    // バンドル内で直接公開されていない場合、既存の state から取得を試みる
    if (!window.CM6.EditorSelection) {
        // ダミーの state を作成してインスタンスからクラスを取得
        const tempState = EditorState.create({ selection: { anchor: 0, head: 0 } });
        if (tempState.selection && tempState.selection.constructor) {
            window.CM6.EditorSelection = tempState.selection.constructor;
        }
    }

    // --- SVG Number Slider Widget Implementation ---
    class NumberSliderWidget extends WidgetType {
        constructor(value, pos, attrName) {
            super();
            this.value = parseFloat(value);
            this.pos = pos;
            this.attrName = attrName;
        }

        eq(other) { return other.value === this.value && other.pos === this.pos; }

        toDOM(view) {
            const wrap = document.createElement("span");
            wrap.className = "cm-number-slider-widget";
            wrap.title = `${this.attrName}: ${this.value} (ドラッグで調整)`;
            wrap.style.display = "inline-flex";
            wrap.style.alignItems = "center";
            wrap.style.justifyContent = "center";
            wrap.style.width = "12px";
            wrap.style.height = "12px";
            wrap.style.backgroundColor = "var(--primary, #0366d6)";
            wrap.style.borderRadius = "50%";
            wrap.style.cursor = "ew-resize";
            wrap.style.margin = "0 2px";
            wrap.style.verticalAlign = "middle";
            wrap.style.opacity = "0.7";

            let startX, startValue;

            const onMouseMove = (e) => {
                const diff = (e.clientX - startX);
                const step = e.shiftKey ? 0.1 : 1;
                const newValue = Math.round((startValue + diff * step) * 10) / 10;

                // Find current position of the value in the doc
                const line = view.state.doc.lineAt(this.pos);
                const text = line.text;

                let found = false;

                // 1. Try to match as SVG attribute
                if (this.attrName !== '数値') {
                    const attrRegex = new RegExp(`(${this.attrName}\\s*=\\s*["'])(-?\\d*\\.?\\d+)(["'])`, 'g');
                    let match;
                    while ((match = attrRegex.exec(text)) !== null) {
                        const matchStart = line.from + match.index + match[1].length;
                        const matchEnd = matchStart + match[2].length;

                        // If this match covers our original widget position, it's the right one
                        if (this.pos >= matchStart - match[1].length && this.pos <= matchEnd + 1) {
                            let newStr = String(newValue);
                            if (match[2].length > 1 && match[2].startsWith('0') && match[2].indexOf('.') === -1 && newValue >= 0 && Number.isInteger(newValue)) {
                                newStr = String(newValue).padStart(match[2].length, '0');
                            }
                            const oldLen = match[2].length;
                            view.dispatch({
                                changes: { from: matchStart, to: matchEnd, insert: newStr }
                            });
                            // [FIX] Update widget tracking position to handle digit count changes
                            this.pos += (newStr.length - oldLen);
                            found = true;
                            break;
                        }
                    }
                }

                // 2. If not found as attribute, try to match as number in sequence
                if (!found) {
                    // Find all numbers in the line and match by position
                    const numRegex = /-?\d*\.?\d+/g;
                    let match;
                    while ((match = numRegex.exec(text)) !== null) {
                        const matchStart = line.from + match.index;
                        const matchEnd = matchStart + match[0].length;

                        // Check if this number is at the expected position
                        // The widget was placed right after the number, so this.pos should equal matchEnd
                        if (Math.abs(this.pos - matchEnd) <= 1) {
                            let newStr = String(newValue);
                            if (match[0].length > 1 && match[0].startsWith('0') && match[0].indexOf('.') === -1 && newValue >= 0 && Number.isInteger(newValue)) {
                                newStr = String(newValue).padStart(match[0].length, '0');
                            }
                            const oldLen = match[0].length;
                            view.dispatch({
                                changes: { from: matchStart, to: matchEnd, insert: newStr }
                            });
                            // [FIX] Update widget tracking position to handle digit count changes
                            this.pos += (newStr.length - oldLen);
                            found = true;
                            break;
                        }
                    }
                }
            };

            const onMouseUp = () => {
                wrap.style.opacity = "0.7";
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };

            wrap.addEventListener("mousedown", (e) => {
                e.preventDefault();
                startX = e.clientX;
                startValue = this.value;
                wrap.style.opacity = "1";
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
            });

            return wrap;
        }

        ignoreEvent() { return true; }
    }

    function getSliderDecorationsFromState(state) {
        const deco = [];
        const text = state.doc.toString();
        const processed = new Set(); // 処理済み位置を記録して重複を防ぐ

        // 1. Target common SVG attributes with numeric values (単一数値)
        const attrRegex = /(x|y|width|height|cx|cy|r|rx|ry|font-size|stroke-width)\s*=\s*["'](-?\d*\.?\d+)(["'])/g;

        let m;
        while (m = attrRegex.exec(text)) {
            const attrName = m[1];
            const valStr = m[2];
            const start = m.index + m[0].length - m[3].length; // Position right after the number

            deco.push(Decoration.widget({
                widget: new NumberSliderWidget(valStr, start, attrName),
                side: 1
            }).range(start));
            processed.add(start);
        }

        // 2. SVG属性値内の複数数値を検出 (viewBox, transform など)
        // 【No.2 修正】 d や points は無数の座標を持つため除外
        const multiValueAttrRegex = /(viewBox|transform|fill|stroke|stop-color|color)\s*=\s*["']([^"']+)["']/g;

        while (m = multiValueAttrRegex.exec(text)) {
            const attrName = m[1];
            const attrValue = m[2];
            const attrValueStart = m.index + m[0].indexOf(attrValue);

            // 【No.2 修正】 長すぎる属性値は正規表現をスキップしてフリーズを防ぐ
            if (attrValue.length > 500) continue;

            // 属性値内のすべての数値を検出
            const numRegex = /-?\d*\.?\d+/g;
            let numMatch;
            while ((numMatch = numRegex.exec(attrValue)) !== null) {
                const numValue = numMatch[0];
                const numEnd = attrValueStart + numMatch.index + numValue.length;

                if (!processed.has(numEnd)) {
                    deco.push(Decoration.widget({
                        widget: new NumberSliderWidget(numValue, numEnd, attrName),
                        side: 1
                    }).range(numEnd));
                    processed.add(numEnd);
                }
            }
        }

        // 3. カンマ区切り/スペース区切り/括弧内の数値列を検出
        // 例: "1, 2, 3" や "10 20 30" や "rgba(88.46, 134.018, 179.888, 0.5)" のような値
        // すべての数値を検出し、近接する数値を数値列として認識
        const numberRegex = /-?\d*\.?\d+/g;

        // 連続する数値を検出 (最低2つ以上の数値があれば数値列として認識)
        const lines = text.split('\n');
        let currentPos = 0;

        for (const line of lines) {
            const lineLength = line.length;

            // 【No.2 修正】 Base64画像や巨大パスなど、長すぎる行は処理を完全にスキップ
            if (lineLength > 300 || line.includes('<path') || line.includes('<polyline') || line.includes('<polygon') || line.includes('points=')) {
                currentPos += lineLength + 1;
                continue;
            }

            const numbers = [];
            numberRegex.lastIndex = 0;

            let match;
            while ((match = numberRegex.exec(line)) !== null) {
                const numValue = match[0];
                const numStart = currentPos + match.index;
                const numEnd = numStart + numValue.length;

                // すでに処理済みでない場合のみ追加
                if (!processed.has(numEnd)) {
                    // 前後の文字をチェックして、数値列の一部かどうか判断
                    const beforeChar = match.index > 0 ? line[match.index - 1] : '';
                    const afterChar = match.index + numValue.length < line.length ? line[match.index + numValue.length] : '';

                    // 区切り文字または括弧、または日付時刻の単位文字に囲まれている場合のみ対象
                    const validBefore = beforeChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(beforeChar);
                    const validAfter = afterChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(afterChar);

                    if (validBefore || validAfter) {
                        numbers.push({
                            value: numValue,
                            start: numStart,
                            end: numEnd,
                            index: match.index
                        });
                    }
                }
            }

            // 連続する数値が2つ以上あり、それらが近接している場合に数値列と判断
            if (numbers.length >= 2) {
                for (let i = 0; i < numbers.length - 1; i++) {
                    const current = numbers[i];
                    const next = numbers[i + 1];

                    // 次の数値との間隔が狭い(10文字以内)場合、数値列の一部と判断
                    const gap = next.index - (current.index + current.value.length);

                    if (gap <= 10) {
                        deco.push(Decoration.widget({
                            widget: new NumberSliderWidget(current.value, current.end, '数値'),
                            side: 1
                        }).range(current.end));
                        processed.add(current.end);
                    }
                }

                // 最後の数値も追加（列の一部として判断された場合）
                const lastNum = numbers[numbers.length - 1];
                if (numbers.length >= 2) {
                    const secondLast = numbers[numbers.length - 2];
                    const gap = lastNum.index - (secondLast.index + secondLast.value.length);

                    if (gap <= 10) {
                        deco.push(Decoration.widget({
                            widget: new NumberSliderWidget(lastNum.value, lastNum.end, '数値'),
                            side: 1
                        }).range(lastNum.end));
                        processed.add(lastNum.end);
                    }
                }
            }

            currentPos += lineLength + 1; // +1 for newline
        }

        return Decoration.set(deco, true);
    }

    const sliderField = StateField.define({
        create(state) {
            return getSliderDecorationsFromState(state);
        },
        update(decorations, tr) {
            // ドキュメントが変更された場合のみ再計算
            if (tr.docChanged) {
                return getSliderDecorationsFromState(tr.state);
            }
            // 変更がない場合は位置をマップ
            return decorations.map(tr.changes);
        },
        provide: f => EditorView.decorations.from(f)
    });
    // ----------------------------------------------------


    // Define Custom Light Highlight Style

    // Define Custom Light Highlight Style
    const lightHighlightStyle = HighlightStyle.define([
        { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.strong, fontWeight: "bold", color: "#d73a49" },
        { tag: tags.emphasis, fontStyle: "italic", color: "#24292e" },
        { tag: tags.link, textDecoration: "underline", color: "#005cc5" },
        { tag: tags.url, color: "#032f62" },
        { tag: tags.list, color: "#e36209" },
        { tag: tags.quote, color: "#6a737d", fontStyle: "italic" },
        { tag: tags.keyword, color: "#d73a49" },
        { tag: tags.comment, color: "#6a737d" },
        { tag: tags.string, color: "#032f62" },
        { tag: tags.variableName, color: "#6f42c1" },
        { tag: tags.propertyName, color: "#005cc5" },
        { tag: tags.number, color: "#005cc5" },
        { tag: tags.bool, color: "#005cc5" },
        { tag: tags.punctuation, color: "#24292e" }
    ]);

    // Save StateEffect for later use
    window.CM6_StateEffect = StateEffect; // Export if needed, or just use locally

    // Config compartments for dynamic updates
    const lineWrappingComp = new Compartment();
    const lineNumbersComp = new Compartment();
    const themeComp = new Compartment();
    const searchHighlightComp = new Compartment(); // Compartment for search highlights

    // [NEW] Focus Mode Compartment & Theme
    window._cmFocusModeComp = new Compartment();
    window._cmFocusModeTheme = EditorView.theme({
        ".cm-line": { opacity: "0.25", transition: "opacity 0.2s ease-in-out" },
        ".cm-activeLine": { opacity: "1 !important" }
    });

    // -------------------------------------------------------------
    // Define Custom Search Highlighting (Decoration)
    // -------------------------------------------------------------

    // Effect to add/remove search highlights
    const setSearchHighlights = StateEffect.define();

    // Field to manage decorations
    const searchHighlightField = StateField.define({
        create() { return Decoration.none; },
        update(decorations, tr) {
            decorations = decorations.map(tr.changes);
            for (let e of tr.effects) {
                if (e.is(setSearchHighlights)) {
                    decorations = e.value;
                }
            }
            return decorations;
        },
        provide: f => EditorView.decorations.from(f)
    });

    // -------------------------------------------------------------
    // [NEW] SVG Source Element Highlighting
    // -------------------------------------------------------------
    const setSVGSourceHighlights = StateEffect.define();
    const svgSourceHighlightField = StateField.define({
        create() { return Decoration.none; },
        update(decorations, tr) {
            decorations = decorations.map(tr.changes);
            for (let e of tr.effects) {
                if (e.is(setSVGSourceHighlights)) {
                    decorations = e.value;
                }
            }
            return decorations;
        },
        provide: f => EditorView.decorations.from(f)
    });

    // Base Theme for the editor to match app styles
    const baseTheme = EditorView.theme({
        "&": {
            height: "100%",
            fontSize: "var(--editor-font-size, 14px)",
            backgroundColor: "transparent"
        },
        ".cm-content": {
            fontFamily: "var(--font-mono)",
            lineHeight: "var(--editor-line-height, 1.6)",
            padding: "10px 0"
        },
        ".cm-gutters": {
            backgroundColor: "var(--header-bg)",
            color: "#666",
            borderRight: "1px solid var(--border)",
            fontFamily: "var(--font-mono)"
        },
        ".cm-activeLine": {
            backgroundColor: "rgba(0, 0, 0, 0.03)"
        },
        ".cm-activeLineGutter": {
            backgroundColor: "rgba(0, 0, 0, 0.05)",
            color: "var(--primary)"
        },
        // [NEW] SVG Source Highlighting Styles
        ".cm-svg-source-highlight-hover": {
            backgroundColor: "rgba(255, 255, 0, 0.4) !important", // 黄色
            borderBottom: "2px dashed rgba(255, 165, 0, 0.8) !important",
            borderRadius: "2px"
        },
        ".cm-svg-source-highlight-select": {
            backgroundColor: "rgba(0, 150, 255, 0.4) !important", // 明るめの青
            borderBottom: "2px solid rgba(0, 150, 255, 1) !important", // はっきりとした青の下線
            borderRadius: "2px"
        }
    });

    // [NEW] SVG/HTML parser configuration for folding
    let customCodeLanguages = languages;
    if (html && LanguageDescription) {
        const htmlDesc = LanguageDescription.of({
            name: "html",
            alias: ["svg", "xml"],
            support: html()
        });
        customCodeLanguages = [htmlDesc, ...languages];

        // Setup EditorLanguages globally for inline_editor.js
        window.EditorLanguages = window.EditorLanguages || {};
        window.EditorLanguages.html = html;
    }

    // [NEW] Front Matter Folding Extension
    const fmExtensions = [];
    if (window.CM6.foldService) {
        fmExtensions.push(window.CM6.foldService.of((state, lineStart, lineEnd) => {
            if (lineStart === 0 && state.sliceDoc(0, 3) === "---") {
                for (let i = 2; i <= Math.min(50, state.doc.lines); i++) {
                    const line = state.doc.line(i);
                    if (line.text.startsWith("---") && line.text.trim() === "---") {
                        // Fold from end of first line to end of second '---'
                        return { from: 3, to: line.to };
                    }
                }
            }
            return null;
        }));
    }

    // Initial extensions
    const extensions = [
        ...fmExtensions,
        basicSetup,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: customCodeLanguages }),
        syntaxHighlighting(lightHighlightStyle),
        baseTheme,

        // Add our custom highlight field
        searchHighlightField,

        // [NEW] SVG Source highlight field
        svgSourceHighlightField,

        // SVG Number Slider Extension
        sliderField,

        // Dynamic configurations with Compartments
        lineWrappingComp.of(AppState.config.lineWrapping !== false ? EditorView.lineWrapping : []),
        themeComp.of([]), // Initialized in updateEditorTheme
        window._cmFocusModeComp.of(AppState.config.focusMode ? window._cmFocusModeTheme : []), // [NEW] Initial Focus Mode State

        // Update Listener
        EditorView.updateListener.of(update => {
            // [NEW] Folding Sync Listener
            if (window.CM6) {
                const { foldEffect, unfoldEffect } = window.CM6;
                if (update.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)))) {
                    const lock = window.foldSyncLock || { ui: false, editor: false };
                    if (!lock.ui) {
                        if (window.foldSyncLock) window.foldSyncLock.editor = true;
                        if (typeof syncUIFoldFromEditor === 'function') {
                            syncUIFoldFromEditor(update);
                        }
                        setTimeout(() => {
                            if (window.foldSyncLock) window.foldSyncLock.editor = false;
                        }, 300);
                    }
                }
            }

            // [NEW] Typewriter Mode (自動中央スクロール)
            if (AppState.config.typewriterMode && update.selectionSet) {
                const isFromMouse = update.transactions.some(tr => tr.isUserEvent('select.pointer'));
                // マウスでの文字選択中による激しい揺れを防ぐため、キーボード移動かドキュメント変更時を優先
                if (!isFromMouse || update.docChanged) {
                    const pos = update.state.selection.main.head;
                    requestAnimationFrame(() => {
                        if (editorView) {
                            editorView.dispatch({
                                effects: [window.CM6.EditorView.scrollIntoView(pos, { y: "center" })]
                            });
                        }
                    });
                }
            }

            // [NEW] カーソル移動時にプレビューのフォーカス枠を追従させる（エディタ→プレビュー連動）
            // プレビュー側で「インライン編集中」の時はスキップして干渉を防ぐ（青い破線枠だけなら同期可能なのでスキップしない）
            if (update.selectionSet && !window._previewFocusingSuppressed) {
                const isEditingPreview = typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.isEditing;
                
                if (!isEditingPreview) {
                    clearTimeout(window._previewFocusFromEditorTimer);
                    window._previewFocusFromEditorTimer = setTimeout(() => {
                        if (typeof PreviewInlineEdit !== 'undefined' && !PreviewInlineEdit.isEditing) {
                            const pos = update.state.selection.main.head;
                            const lineObj = update.state.doc.lineAt(pos);
                            const el = typeof findElementByLineNumber === 'function'
                                ? findElementByLineNumber(lineObj.number)
                                : null;
                            
                            if (el) {
                                console.log(`[Sync Focus] Editor(${lineObj.number}) -> Preview`);
                                // プレビュー側にエディタへの逆同期（ループの原因）を起こさせないよう引数に false を渡す
                                window._previewFocusingSuppressed = true;
                                PreviewInlineEdit.startFocus(el, false);
                                setTimeout(() => { window._previewFocusingSuppressed = false; }, 200);
                            } else {
                                console.log(`[Sync Focus] Target element not found for line: ${lineObj.number}`);
                            }
                        }
                    }, 100);
                }
            }

            // [FIX] ドキュメントに変更がない場合（選択範囲の変更やフォーカス移動のみの場合）は、
            // 重いレンダリング処理や状態更新をスキップする。
            if (!update.docChanged) return;


            const isFromSvgSync = window._isDispatchingSvgSync ||
                (window.currentEditingSVG && window.currentEditingSVG._syncingToEditor);

            // [NEW] Undo/Redoによるイベントかを判定
            const isUndoRedo = update.transactions.some(tr => tr.isUserEvent('undo') || tr.isUserEvent('redo'));

            const newText = update.state.doc.toString();
            AppState.isModified = true;
            AppState.text = newText;

            // もしSVGエディタからの直接同期であれば、エディタへのプレビュー反映やSVGからの逆同期（updateSVGFromEditor）は一切行わない
            if (isFromSvgSync && !isUndoRedo) {
                // [FIX] 同期ガード中に以前のタイマーが生き残って上書きするのを防ぐため、明示的にクリアする
                clearTimeout(debounceTimer);
                if (window._svgSyncFromEditorTimer) {
                    clearTimeout(window._svgSyncFromEditorTimer);
                    window._svgSyncFromEditorTimer = null;
                }
                // console.log("[Sync] CodeMirror update ignored and timers cleared due to SvgSync flag");
                // UndoRedo状態の更新だけは行い、タイマー系は登録させない
                // （後続のhistory update logicはそのまま通すため、ここでリターンはせずに debounceTimerだけスキップする構成にする）
            } else {
                // Debounce render
                clearTimeout(debounceTimer);

                // タイピングが続く限り、重い改ページ計算を延期する
                if (typeof window.schedulePageBreakDisplay === 'function') {
                    window.schedulePageBreakDisplay();
                }

                // ★ 120ms から 300ms に変更（連打が止まってからレンダリングが走るようになります）
                debounceTimer = setTimeout(async () => {
                    // [NEW] Skip render during SVG editing to prevent flickering
                    // SVG editing session manages its own state and preserves preview DOM.
                    // A full render would destroy/recreate the SVG session, causing a flicker.
                    // [SYNC] ただしエディタ側の変更をSVGキャンバスへ反映する（エディタ→SVG方向の同期）
                    if (typeof window.isSVGEditing === 'function' && window.isSVGEditing()) {
                        // SVGキャンバスからの同期（syncSVGToEditor）による更新の場合はスキップ
                        if (window.currentEditingSVG && window.currentEditingSVG._syncingToEditor) {
                            return;
                        }

                        if (typeof updateSVGFromEditor === 'function') {
                            clearTimeout(window._svgSyncFromEditorTimer);
                            window._svgSyncFromEditorTimer = setTimeout(() => {
                                updateSVGFromEditor();
                            }, 300);
                        }
                        // [FIX] SVGエディタ起動中も、他の見出し等の変更をプレビューへ反映させるため、
                        // ここでのreturn（強制終了）は行わず、後続のrender()を実行させる。
                        // renderer.js側でSVGエディタノードを一時退避・復元してUIの破壊を防ぐ仕組みが導入されている。
                    }

                    // [FIX] Skip render during Table or Inline Code editing.
                    // If a delayed render fires while they are active, it will overwrite the DOM
                    // and detach their active UI elements, causing editing to silently fail.
                    if (typeof window.isTableEditing === 'function' && window.isTableEditing()) {
                        return;
                    }
                    if (typeof window.isInlineEditing === 'function' && window.isInlineEditing()) {
                        return;
                    }

                    // [DISABLED] インラインエディタ編集中のデバウンスチェックを無効化
                    // 貼り付け操作などでスクロールが発生した際に、タイマーが完了する前に
                    // 次の編集が行われると、window.isScrollingがtrueのまま停止してしまうのを防ぐため
                    /*
                    if (window.isScrolling) {
                        return;
                    }
                    */

                    await render();
                }, 120);

                if (typeof updateUndoRedoButtonState === 'function') {
                    // Use CodeMirror 6 official API if available
                    if (window.CM6 && typeof window.CM6.undoDepth === 'function' && typeof window.CM6.redoDepth === 'function') {
                        const uDepth = window.CM6.undoDepth(update.state);
                        const rDepth = window.CM6.redoDepth(update.state);
                        const canUndo = uDepth > 0;
                        const canRedo = rDepth > 0;

                        // console.log(`[UndoRedo] API: Undo=${uDepth}, Redo=${rDepth}`);
                        updateUndoRedoButtonState(canUndo, canRedo);
                    } else {
                        // Fallback: Use heuristic approach
                        // [Heuristic] Find History State and Determine Undo/Redo Properties
                        if (!window._historyStateInfo) {
                            try {
                                window._historyStateInfo = findHistoryState(update.state);
                            } catch (e) { console.error('History finding error', e); }
                        }

                        // Retry if still null
                        if (!window._historyStateInfo) window._historyStateInfo = findHistoryState(update.state);

                        let canUndo = false;
                        let canRedo = false;

                        if (window._historyStateInfo) {
                            const info = window._historyStateInfo;
                            // Get current object from state using index
                            const currentObj = update.state.values[info.index];


                            if (!currentObj) {
                                // Invalidated? Reset info
                                window._historyStateInfo = null;
                            } else {
                                // Determine keys if not yet known
                                if (!info.undoKey) {
                                    // If counts changed, try to identify
                                    info.candidates.forEach(k => {
                                        const len = currentObj[k].length;
                                        const diff = len - (info.lastCounts[k] || 0);
                                        info.lastCounts[k] = len;

                                        // If doc changed and NOT undo/redo event, the growing stack is UNDO.
                                        // But here we rely on basic assumption: usually first array is done(undo), second is undone(redo)?
                                        // Or just check: if one is growing and we are typing, that's undo.
                                        if (update.docChanged && !update.transactions.some(tr => tr.isUserEvent('undo') || tr.isUserEvent('redo'))) {
                                            if (diff > 0) {
                                                info.undoKey = k;
                                                // The other is redo
                                                info.redoKey = info.candidates.find(ck => ck !== k);
                                            }
                                        }
                                    });

                                    // Fallback 2: Check standard property names if not minified
                                    if (!info.undoKey) {
                                        if (currentObj.done) { info.undoKey = 'done'; info.redoKey = 'undone'; }
                                    }
                                }

                                if (info.undoKey && info.redoKey) {
                                    // Subtract baseline
                                    const currentUndoLen = currentObj[info.undoKey].length;
                                    // Force base to 0 if it was somehow lost but don't reset it from currentUndoLen here
                                    const base = (info.baseUndoCount !== undefined) ? info.baseUndoCount : 0;

                                    // Reset baseline only if stack becomes completely empty (to recover from errors)
                                    if (currentUndoLen === 0) info.baseUndoCount = 0;

                                    const undoLen = currentUndoLen - (info.baseUndoCount || 0);
                                    const redoLen = currentObj[info.redoKey].length;
                                    canUndo = undoLen > 0;
                                    canRedo = redoLen > 0;

                                    // console.log(`[UndoRedo] Determine: Undo=${undoLen} (Raw=${currentUndoLen}, Base=${info.baseUndoCount}), Redo=${redoLen}`);
                                } else {
                                    // Still learning
                                    const c1 = currentObj[info.candidates[0]].length;
                                    const c2 = currentObj[info.candidates[1]].length;
                                    if (c1 === 0 && c2 === 0) {
                                        canUndo = false; canRedo = false;
                                    } else {
                                        // Ambiguous state
                                        canUndo = true; canRedo = true;
                                    }
                                }
                            }
                        } else {
                            // Fallback if state finding failed
                            canUndo = true; canRedo = true;
                            console.warn('[UndoRedo] History State NOT FOUND in this update');
                        }

                        // console.log(`[UndoRedo] Update Button Request: Undo=${canUndo}, Redo=${canRedo}`);
                        updateUndoRedoButtonState(canUndo, canRedo);
                    }
                }

                // [NEW] Update search results if active
                if (AppState.searchState && AppState.searchState.query && typeof performSearch === 'function') {
                    // Debounced search update
                    clearTimeout(window.searchDebounceTimer);
                    window.searchDebounceTimer = setTimeout(() => {
                        performSearch(true);
                    }, 300);
                }
            }

        }),

        // Scroll Listener
        EditorView.domEventHandlers({
            scroll: (event, view) => {
                if (typeof syncHighlightScroll === 'function') syncHighlightScroll();

                // Only sync if scroll is user-initiated (trusted) OR we are not locked
                // Note: CodeMirror scrollIntoView can trigger Trusted events in some contexts.
                if (window.isScrolling) return;

                if (event.isTrusted || window.forceScrollSync) {
                    window.isScrolling = true;
                    // Get visible line in Editor
                    const lineBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop);

                    if (typeof syncPreviewFromEditor === 'function') {
                        syncPreviewFromEditor();
                    }

                    // Reset lock with safety buffer
                    clearTimeout(window.editorScrollTimer);
                    window.editorScrollTimer = setTimeout(() => window.isScrolling = false, 200);
                }
            },
            paste: (event, view) => {
                const items = event.clipboardData?.items;
                if (!items) return false;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image/') !== -1) {
                        const file = items[i].getAsFile();
                        if (file && typeof insertImageAsBase64 === 'function') {
                            // カーソル位置へ挿入する
                            insertImageAsBase64(file);
                            event.preventDefault();
                            return true;
                        }
                    }
                }
                return false;
            }
        })
    ];

    // 1. (Removed domEventHandlers for keydown, replaced with capture phase listener after init)

    // 2. Detect "/" input to show the dropdown
    extensions.push(
        window.CM6.EditorView.inputHandler.of((view, from, to, text) => {
            if (text === "/" || text === "；") {
                console.log('[SlashCommand] "/" or "；" input detected in EditorView');
                // "/"を入力する直前の文字で判定し、単語の中の/でないかチェック
                const prevChar = from > 0 ? view.state.sliceDoc(from - 1, from) : ' ';
                console.log('[SlashCommand] prevChar:', JSON.stringify(prevChar));
                if (/[\s\n]/.test(prevChar)) {
                    console.log('[SlashCommand] Showing dropdown...');
                    // Slash command 開始
                    setTimeout(() => {
                        // 入力後のカーソル位置を正しく取得するため setTimeout
                        if (window.SlashCommandEditor) {
                            window.SlashCommandEditor.show(view, from);
                        } else {
                            console.error('[SlashCommand] window.SlashCommandEditor is undefined!');
                        }
                    }, 10);
                } else {
                    console.log('[SlashCommand] Not showing dropdown (prevChar is not whitespace)');
                }
                // "/", false を返すことで CM6 自身に挿入させる
                return false;
            }
            return false;
        })
    );

    // 3. Listen to document updates to filter the list or close it
    extensions.push(
        window.CM6.EditorView.updateListener.of(update => {
            if (update.docChanged || update.selectionSet) {
                if (window.SlashCommandEditor && window.SlashCommandEditor.isActive) {
                    // setTimeoutで処理を遅らせて、文字が確定したあとのStateでチェックする
                    setTimeout(() => window.SlashCommandEditor.updateFilter(), 5);
                }
            }
        })
    );

    // 4. [NEW] Base64 Image folding plugin
    if (typeof createBase64FoldPlugin === 'function') {
        const foldPlugin = createBase64FoldPlugin();
        if (foldPlugin) {
            extensions.push(foldPlugin);
        }
    }

    // Key bindings (overrides)
    extensions.push(window.CM6.keymap.of([
        { key: "Mod-n", run: () => { newFile(); return true; } },
        { key: "Mod-s", run: () => { saveFile(); return true; } },
        { key: "Mod-Shift-s", run: () => { saveFileAs(); return true; } },
        { key: "Mod-Shift-n", run: () => { newWindow(); return true; } },
        { key: "Mod-p", run: () => { openPrintDialog(); return true; } },
        { key: "Mod-f", run: () => { openSearchDialog(); return true; } },
        { key: "Mod-b", run: execBold },
        { key: "Mod-i", run: execItalic },
    ]));

    currentExtensions = extensions;

    // Create Editor
    editorView = new EditorView({
        doc: AppState.text || "",
        extensions: extensions,
        parent: editorContainer
    });

    // Capture-phase keydown listener for SlashCommand Editor to override default CM6 keymaps (Arrow Up/Down/Enter)
    editorView.dom.addEventListener('keydown', (event) => {
        if (window.SlashCommandEditor && window.SlashCommandEditor.isActive) {
            // handleKeyDown returns true if it handled the event
            if (window.SlashCommandEditor.handleKeyDown(event)) {
                // Completely stop propagation so CM6 never sees it
                event.stopPropagation();
            }
        }
    }, true);

    // Setup scroll restoration logic (Tauri F5 Support) - AFTER editorView init
    if (typeof setupScrollRestoration === 'function') {
        setupScrollRestoration();
    }

    // Save instance global & alias
    DOM.editorInstance = editorView;
    window.editorInstance = editorView;

    // [NEW] Set initial history baseline immediately to avoid user-input being counted as baseline
    try {
        const info = findHistoryState(editorView.state);
        if (info) {
            window._historyStateInfo = info;
            const val = editorView.state.values[info.index];
            if (info.undoKey && val[info.undoKey]) {
                window._historyStateInfo.baseUndoCount = val[info.undoKey].length;
                // console.log('[UndoRedo] Base Count set at init: ' + window._historyStateInfo.baseUndoCount);
            }
        }
    } catch (e) { console.error(e); }


    // Save compartments
    DOM.cmCompartments = {
        lineWrapping: lineWrappingComp,
        theme: themeComp,
        // Helper to update highlights via dispatch
        setHighlights: (matches, currentIndex) => {
            const { Decoration } = window.CM6;

            let decorations = [];
            matches.forEach((match, idx) => {
                // Convert line/column to absolute position
                const line = editorView.state.doc.line(match.line + 1);
                const from = line.from + match.column;
                const to = from + match.length;

                // Add class
                let className = 'cm-search-match';
                if (idx === currentIndex) className += ' cm-search-match-selected'; // Use CSS to style this

                decorations.push(Decoration.mark({
                    class: className
                }).range(from, to));
            });

            editorView.dispatch({
                effects: setSearchHighlights.of(Decoration.set(decorations))
            });
        },
        // [NEW] Folding helpers (Updated with high-level commands)
        fold: (pos) => {
            const { foldCode } = window.CM6;
            // foldCode handles range identification internally based on position
            editorView.dispatch({
                selection: { anchor: pos, head: pos },
                effects: [window.CM6.EditorView.scrollIntoView(pos, { y: "center" })]
            });
            foldCode(editorView);
        },
        unfold: (pos) => {
            const { unfoldCode } = window.CM6;
            editorView.dispatch({
                selection: { anchor: pos, head: pos }
            });
            unfoldCode(editorView);
        },
        // [NEW] SVG Source Highlight Helper
        setSVGSourceHighlights: (highlights) => {
            // highlights: [{ id: string, type: 'hover'|'select' }]
            if (!window.currentEditingSVG || window.currentEditingSVG.svgIndex === undefined) {
                editorView.dispatch({ effects: setSVGSourceHighlights.of(Decoration.none) });
                return;
            }

            const svgIndex = window.currentEditingSVG.svgIndex;
            const text = editorView.state.doc.toString();
            const lines = text.split('\n');


            // Find current SVG block range
            let currentIdx = 0, startLine = -1, endLine = -1, inBlock = false;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === '```svg') {
                    if (currentIdx === svgIndex) { startLine = i; inBlock = true; }
                    currentIdx++;
                } else if (inBlock && lines[i].trim() === '```') {
                    endLine = i;
                    break;
                }
            }

            if (startLine === -1 || endLine === -1) {
                console.warn(`[setSVGSourceHighlights] Block for index ${svgIndex} NOT found.`);
                return;
            }

            console.log(`[setSVGSourceHighlights] Block Range: Line ${startLine} to ${endLine}`);

            // Handle empty SVG block (e.g., ```svg immediately followed by ```)
            if (startLine + 1 >= endLine) {
                return;
            }

            // Convert line numbers to absolute positions with bounds checking
            const docLines = editorView.state.doc.lines;
            const targetStart = Math.min(startLine + 2, docLines);
            const targetEnd = Math.max(1, Math.min(endLine, docLines));

            const blockStartPos = editorView.state.doc.line(targetStart).from; // Line after ```svg
            const blockEndPos = Math.max(blockStartPos, editorView.state.doc.line(targetEnd).to); // Line before ```

            const blockText = text.substring(blockStartPos, blockEndPos);
            const decorations = [];

            highlights.forEach(h => {
                if (!h.id) return;
                const occIndex = h.index || 0;

                // Search for id="id" or id='id' within the block
                const regex = new RegExp(`id\\s*=\\s*["']${h.id}["']`, 'g');
                let match;
                let currentOcc = 0;
                let found = false;

                while ((match = regex.exec(blockText)) !== null) {
                    if (currentOcc === occIndex) {
                        // Find the opening tag start index (<)
                        let tagStart = blockText.lastIndexOf('<', match.index);
                        if (tagStart === -1) continue;

                        // Extract tag name
                        const tagMatch = blockText.substring(tagStart).match(/^<([a-zA-Z0-9:-]+)/);
                        if (!tagMatch) continue;
                        const tagName = tagMatch[1];

                        // Find the end of the opening tag (>)
                        let tagEnd = blockText.indexOf('>', match.index);
                        if (tagEnd === -1) continue;

                        // Check if the opening tag is self-closing (<tag ... />)
                        const isSelfClosing = blockText.substring(tagStart, tagEnd + 1).trim().endsWith('/>');

                        let finalPos = tagEnd + 1;

                        if (!isSelfClosing) {
                            // Find matching closing tag (</tagName>), taking nesting into account
                            const openingTagPattern = new RegExp(`<${tagName}(\\s|>)`);
                            const closingTag = `</${tagName}>`;

                            let depth = 1;
                            let searchPos = tagEnd + 1;

                            while (depth > 0) {
                                const nextOpenMatch = blockText.substring(searchPos).match(openingTagPattern);
                                const nextClose = blockText.indexOf(closingTag, searchPos);

                                if (nextClose === -1) break; // Error or incomplete XML

                                if (nextOpenMatch && (searchPos + nextOpenMatch.index) < nextClose) {
                                    const openIndex = searchPos + nextOpenMatch.index;
                                    const openEnd = blockText.indexOf('>', openIndex);

                                    if (openEnd !== -1 && blockText.substring(openIndex, openEnd + 1).trim().endsWith('/>')) {
                                        // This nested opening tag is self-closing, so it doesn't increase depth
                                        searchPos = openEnd + 1;
                                    } else {
                                        depth++;
                                        searchPos = openIndex + tagName.length + 1;
                                    }
                                } else {
                                    depth--;
                                    searchPos = nextClose + closingTag.length;
                                    if (depth === 0) finalPos = searchPos;
                                }
                            }
                        }
                        if (tagStart !== -1 && tagEnd !== -1) {
                            const from = blockStartPos + tagStart;
                            const to = blockStartPos + finalPos;
                            const cls = h.type === 'hover' ? 'cm-svg-source-highlight-hover' : 'cm-svg-source-highlight-select';

                            decorations.push(Decoration.mark({ class: cls }).range(from, to));
                            found = true;
                        }
                        break; // 目標の出現順序を見つけたらこのIDの検索を終了
                    }
                    currentOcc++;
                }

                if (!found) {
                    // console.warn(`[DEBUG-HL-CORE] ID="${h.id}" NOT found in text.`);
                }
            });

            // console.log(`[DEBUG-HL-CORE] Dispatching ${decorations.length} decorations.`);

            // Sort decorations by position (required by CM6)
            decorations.sort((a, b) => a.from - b.from);

            editorView.dispatch({
                effects: setSVGSourceHighlights.of(Decoration.set(decorations))
            });
        }
    };

    // [NEW] Global Shorthand for SVG Highlighting
    window.setSVGSourceHighlights = (highlights) => {
        if (DOM.cmCompartments && DOM.cmCompartments.setSVGSourceHighlights) {
            DOM.cmCompartments.setSVGSourceHighlights(highlights);
        }
    };

    // Shim DOM.editor compatibility layer
    DOM.editor = {
        get value() {
            return editorView.state.doc.toString();
        },
        set value(v) {
            editorView.dispatch({
                changes: { from: 0, to: editorView.state.doc.length, insert: v }
            });
        },
        focus: () => editorView.focus(),

        // Selection shim
        setSelectionRange: (start, end) => {
            editorView.dispatch({
                selection: { anchor: start, head: end },
                scrollIntoView: true
            });
        },
        get selectionStart() {
            return editorView.state.selection.main.head;
        },

        // Scroll shim
        get scrollTop() { return editorView.scrollDOM.scrollTop; },
        set scrollTop(v) { editorView.scrollDOM.scrollTop = v; },

        // [NEW] Surgical Update Methods for CodeMirror 6
        replaceRange: (from, to, text) => {
            editorView.dispatch({
                changes: { from, to, insert: text }
            });
        },
        replaceLines: (fromLine, toLine, text) => {
            // fromLine, toLine are 1-based (toLine is inclusive)
            // matching CM5 replaceRange(start, end, text) behavior for blocks
            const docLines = editorView.state.doc.lines;
            // 最小値 1、最大値 docLines に収まるよう安全対策を追加
            const safeFrom = Math.max(1, Math.min(fromLine, docLines));
            const safeTo = Math.max(1, Math.min(toLine, docLines));

            const startLineObj = editorView.state.doc.line(safeFrom);
            const endLineObj = editorView.state.doc.line(safeTo);

            window._isDispatchingSvgSync = true;
            try {
                editorView.dispatch({
                    changes: { from: startLineObj.from, to: endLineObj.to, insert: text }
                });
            } finally {
                window._isDispatchingSvgSync = false;
            }
        },

        // Event listener shim (ignored)
        addEventListener: (type, handler) => { },

        // Dispatch event shim
        dispatchEvent: (event) => { }
    };

    // Initial Theme Update
    updateEditorTheme();
}

/**
 * Reset Editor Content and History
 */
function resetEditor(text) {
    if (!editorView || !window.CM6) return;
    const { EditorState } = window.CM6;

    const newState = EditorState.create({
        doc: text,
        extensions: currentExtensions
    });


    editorView.setState(newState);

    // Re-apply dynamic settings
    if (typeof updateLineWrapping === 'function') updateLineWrapping();
    if (typeof updateEditorTheme === 'function') updateEditorTheme();

    // Clear history info cache but try to re-identify and set baseline immediately
    window._historyStateInfo = findHistoryState(editorView.state);
    if (window._historyStateInfo && window._historyStateInfo.undoKey) {
        const val = editorView.state.values[window._historyStateInfo.index];
        window._historyStateInfo.baseUndoCount = val[window._historyStateInfo.undoKey].length;
    }

    // update buttons explicitly
    if (typeof updateUndoRedoButtonState === 'function') {
        updateUndoRedoButtonState(false, false);
    }
}

// --- New Helper for Search.js ---
function highlightEditorMatches(matches, currentIndex) {
    if (editorView && DOM.cmCompartments && DOM.cmCompartments.setHighlights) {
        DOM.cmCompartments.setHighlights(matches, currentIndex);
    }
}

function scrollToMatch(lineIndex, columnIndex) {
    if (!editorView) return;

    // Convert line/column to position
    const line = editorView.state.doc.line(lineIndex + 1);
    const pos = line.from + columnIndex;

    // 検索ジャンプ対象が折りたたまれている場合は展開する
    // unfoldCode(editorView) は現在の selection の位置、または対象の行に対して働くため、
    // まず選択・ジャンプし、その位置に対して unfold をかける
    editorView.dispatch({
        selection: { anchor: pos, head: pos }, // Optional: don't necessarily select, just scroll?
        scrollIntoView: true,
        effects: [window.CM6.EditorView.scrollIntoView(pos, { y: "center" })]
    });

    if (DOM.editor && DOM.editor.unfold) {
        DOM.editor.unfold(pos);
    }
}

// --- Theme & Config ---
function updateEditorTheme() {
    if (!editorView || !DOM.cmCompartments.theme) return;
    const { oneDark, syntaxHighlighting, HighlightStyle, tags } = window.CM6;
    const isDark = document.body.classList.contains('dark-theme');

    // Define the same light style for consistency during reconfiguration
    const lightHighlightStyle = HighlightStyle.define([
        { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold", color: "#0366d6" },
        { tag: tags.strong, fontWeight: "bold", color: "#d73a49" },
        { tag: tags.emphasis, fontStyle: "italic", color: "#24292e" },
        { tag: tags.link, textDecoration: "underline", color: "#005cc5" },
        { tag: tags.url, color: "#032f62" },
        { tag: tags.list, color: "#e36209" },
        { tag: tags.quote, color: "#6a737d", fontStyle: "italic" },
        { tag: tags.keyword, color: "#d73a49" },
        { tag: tags.comment, color: "#6a737d" },
        { tag: tags.string, color: "#032f62" },
        { tag: tags.variableName, color: "#6f42c1" },
        { tag: tags.propertyName, color: "#005cc5" },
        { tag: tags.number, color: "#005cc5" },
        { tag: tags.bool, color: "#005cc5" },
        { tag: tags.punctuation, color: "#24292e" }
    ]);

    const lightTheme = [
        syntaxHighlighting(lightHighlightStyle)
    ];

    editorView.dispatch({
        effects: DOM.cmCompartments.theme.reconfigure(isDark ? oneDark : lightTheme)
    });
}

function updateEditorLineNumbers() { }

function updateLineWrapping() {
    if (!editorView || !DOM.cmCompartments.lineWrapping) return;
    const { EditorView } = window.CM6;
    const isWrapping = AppState.config.lineWrapping !== false;

    editorView.dispatch({
        effects: DOM.cmCompartments.lineWrapping.reconfigure(isWrapping ? EditorView.lineWrapping : [])
    });
}

/**
 * Helper to find history state object in EditorState
 */
function findHistoryState(state) {
    const values = state.values;
    if (!values || !Array.isArray(values)) return null;

    let bestMatchIndex = -1;
    let bestMatchKeys = null;

    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (!val || typeof val !== 'object') continue;

        // Check explicit keys
        if (Array.isArray(val.done) && Array.isArray(val.undone)) {
            bestMatchIndex = i;
            bestMatchKeys = ['done', 'undone'];
            break;
        }

        // Fallback
        if (bestMatchIndex === -1) {
            const keys = Object.keys(val);
            const arrayKeys = keys.filter(k => Array.isArray(val[k]));
            if (arrayKeys.length >= 2) {
                bestMatchIndex = i;
                bestMatchKeys = arrayKeys;
            }
        }
    }

    if (bestMatchIndex !== -1) {
        const info = {
            index: bestMatchIndex,
            undoKey: null,
            redoKey: null,
            candidates: bestMatchKeys,
            lastCounts: {}
        };

        if (bestMatchKeys[0] === 'done' && bestMatchKeys[1] === 'undone') {
            info.undoKey = 'done';
            info.redoKey = 'undone';
        }

        return info;
    }
    return null;
}

/**
 * エディタの指定範囲を更新（部分書き換え）
 * 全体置換を避けることでスクロールの跳ねを防止します。
 */
window.updateEditorRange = function (from, to, text) {
    if (!editorView) return;
    const docLength = editorView.state.doc.length;
    from = Math.max(0, Math.min(from, docLength));
    to = Math.max(0, Math.min(to, docLength));
    editorView.dispatch({
        changes: { from: from, to: to, insert: text }
    });
};

/**
 * Get current text content from CodeMirror editor
 */
function getEditorText() {
    if (editorView) {
        return editorView.state.doc.toString();
    }
    return AppState.text || "";
}
window.getEditorText = getEditorText;

function setEditorText(text) {
    if (editorView) {
        editorView.dispatch({
            changes: { from: 0, to: editorView.state.doc.length, insert: text }
        });
    }
    AppState.text = text;
}
window.setEditorText = setEditorText;

/**
 * Insert text at current cursor position(s) in the editor
 * Exposed for Context Menu interactions
 */
window.insertTextAtEditorCursor = function (text) {
    if (!editorView) return;
    const state = editorView.state;
    // Use replaceSelection to handle multiple cursors and replacing selection if any
    editorView.dispatch(state.replaceSelection(text));
    editorView.focus();
};

/**
 * ドロップ座標またはプレビューのdata-line属性から
 * エディタのテキスト位置を特定してテキストを挿入する
 * @param {string} text 挿入するテキスト
 * @param {number} clientX ドロップのX座標
 * @param {number} clientY ドロップのY座標
 * @param {Element} target ドロップのターゲット要素
 */
window.insertTextAtDropPosition = function (text, clientX, clientY, target) {
    if (!editorView) return;

    const editorEl = editorView.dom;
    const editorContentEl = editorEl.querySelector('.cm-content');
    const previewEl = DOM.preview || document.getElementById('md-preview');

    // --- エディタエリアへのドロップ ---
    if (editorContentEl && editorContentEl.contains(target)) {
        try {
            // CM6のposAtCoordsでドロップ座標からDoc位置を取得
            const pos = editorView.posAtCoords({ x: clientX, y: clientY });
            if (pos !== null) {
                editorView.dispatch({
                    changes: { from: pos, to: pos, insert: text },
                    selection: { anchor: pos + text.length }
                });
                editorView.focus();
                return;
            }
        } catch (e) {
            console.warn("[Editor] CodeMirror posAtCoords failed, falling back to cursor position...", e);
            // エラー時はそのまま下のフォールバックへ進ませる
        }
    }

    // --- プレビューエリアへのドロップ ---
    if (previewEl && previewEl.contains(target)) {
        // ドロップ先の要素から最も近い data-line 属性を持つ要素を探す
        let lineEl = target.closest('[data-line]');
        if (!lineEl) {
            // ドロップ座標に最も近い data-line 要素を探す
            const allLineEls = Array.from(previewEl.querySelectorAll('[data-line]'));
            let closest = null;
            let minDist = Infinity;
            for (const el of allLineEls) {
                const rect = el.getBoundingClientRect();
                const elCenterY = rect.top + rect.height / 2;
                const dist = Math.abs(clientY - elCenterY);
                if (dist < minDist) {
                    minDist = dist;
                    closest = el;
                }
            }
            lineEl = closest;
        }

        if (lineEl) {
            const lineNum = parseInt(lineEl.getAttribute('data-line'), 10);
            if (!isNaN(lineNum)) {
                // 対象行の末尾に挿入（行番号は1-based）
                const docLine = editorView.state.doc.line(Math.min(lineNum, editorView.state.doc.lines));
                const insertPos = docLine.to;  // 行末
                const insertText = '\n' + text;
                editorView.dispatch({
                    changes: { from: insertPos, to: insertPos, insert: insertText },
                    selection: { anchor: insertPos + insertText.length }
                });
                editorView.focus();
                return;
            }
        }
    }

    // --- フォールバック: 現在のカーソル位置に挿入 ---
    window.insertTextAtEditorCursor(text);
};

/**
 * Editor extension to fold long Base64 strings using standard CM6 fold mechanism.
 * This avoids Measure Loop issues caused by extremely large inline widgets.
 */
function createBase64FoldPlugin() {
    if (!window.CM6 || !window.CM6.StateField || !window.CM6.ViewPlugin) {
        console.warn('CM6 required modules for base64 folding not found. Base64 folding disabled.');
        return null;
    }
    
    // 巨大なBase64による折り返し時の Measure Loop (クラッシュ) を防ぐため、
    // Widgetによる置換ではなく、CodeMirror純正の fold(隠蔽)機能を使用する。
    const { ViewPlugin, foldEffect, foldedRanges } = window.CM6;

    const base64FoldPlugin = ViewPlugin.fromClass(class {
        constructor(view) {
            this.foldBase64(view);
        }
        
        update(update) {
            if (update.docChanged) {
                this.foldBase64(update.view);
            }
        }

        foldBase64(view) {
            // エディタ内の長大な文字列を検索し、まだ折りたまれていない場合は foldEffect を発行
            const docText = view.state.doc.toString();
            // `<img src="data:..."` や `](data:...)` の data 部分をマッチさせる
            const pattern = /(data:image\/[^;]+;base64,)([A-Za-z0-9+/=]+)/g;
            let match;
            let effects = [];
            
            const folded = typeof foldedRanges === 'function' ? foldedRanges(view.state) : null;
            
            while ((match = pattern.exec(docText)) !== null) {
                // 十分長い Base64 のみ対象
                if (match[2].length > 100) {
                    const from = match.index;
                    const to = match.index + match[0].length;
                    
                    let isFolded = false;
                    if (folded) {
                        folded.between(from, to, (fFrom, fTo) => {
                            if (fFrom === from && fTo === to) isFolded = true;
                        });
                    }
                    
                    if (!isFolded) {
                        effects.push(foldEffect.of({ from, to }));
                    }
                }
            }

            if (effects.length > 0) {
                // エディタの update(DOM描画) サイクル中に dispatch を呼ぶとエラーになるため、
                // 次のフレームで非同期に fold を適用する
                requestAnimationFrame(() => {
                    if (view && !view.isDestroyed) {
                        view.dispatch({ effects: effects });
                    }
                });
            }
        }
    });

    return base64FoldPlugin;
}

