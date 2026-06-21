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
        syntaxHighlighting, defaultHighlightStyle, HighlightStyle, tags,
        // [NEW] 追加言語のアンパック
        javascript, python, php, cpp, java, go, rust, StreamLanguage,
        ruby, shell, perl, octave, csharp, swift, fortran, pascal
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

    // [FIX No.4] キャッシュ済みSVGブロック範囲を引き継いで再利用できる引数を追加。
    // cachedSvgBlockRangesがnullの場合のみ全文書を走査してSVGブロック範囲を再計算する。
    function getSliderDecorationsFromState(state, cachedSvgBlockRanges) {
        const deco = [];
        const text = state.doc.toString();
        const processed = new Set(); // 処理済み位置を記録して重複を防ぐ

        // [FIX No.4] キャッシュがあれば再利用、なければ全文書を走査してSVGブロック範囲を計算
        let svgBlockRanges;
        if (cachedSvgBlockRanges !== null && cachedSvgBlockRanges !== undefined) {
            svgBlockRanges = cachedSvgBlockRanges;
        } else {
            svgBlockRanges = [];
            const blockRegex = /```svg\s*\n[\s\S]*?\n```/g;
            let bm;
            while ((bm = blockRegex.exec(text)) !== null) {
                svgBlockRanges.push({ start: bm.index, end: bm.index + bm[0].length });
            }
            window._cachedSvgBlockRanges = svgBlockRanges; // グローバルキャッシュを更新
        }

        const attrRegex = /(x|y|width|height|cx|cy|r|rx|ry|font-size|stroke-width)\s*=\s*["'](-?\d*\.?\d+)(["'])/g;
        const multiValueAttrRegex = /(viewBox|transform|fill|stroke|stop-color|color)\s*=\s*["']([^"']+)["']/g;
        const numberRegex = /-?\d*\.?\d+/g;

        if (svgBlockRanges.length > 0) {
            // [FIX No.4] SVGブロックが存在する場合、巨大な全文書ではなく「SVGブロック内部のテキストだけ」を走査する。
            // 従来は isInSvgBlock で判定しつつも「全文書」に対して正規表現を実行していたため、非常に高コストだった。
            for (const range of svgBlockRanges) {
                const blockText = text.substring(range.start, range.end);
                
                let m;
                // 1. Target common SVG attributes with numeric values (単一数値)
                while ((m = attrRegex.exec(blockText)) !== null) {
                    const attrName = m[1];
                    const valStr = m[2];
                    const start = range.start + m.index + m[0].length - m[3].length; // Position right after the number
                    deco.push(Decoration.widget({ widget: new NumberSliderWidget(valStr, start, attrName), side: 1 }).range(start));
                    processed.add(start);
                }

                // 2. SVG属性値内の複数数値を検出 (viewBox, transform など)
                while ((m = multiValueAttrRegex.exec(blockText)) !== null) {
                    const attrName = m[1];
                    const attrValue = m[2];
                    if (attrValue.length > 500) continue; // フリーズ防止
                    
                    const attrValueStart = range.start + m.index + m[0].indexOf(attrValue);
                    let numMatch;
                    const numRegex = /-?\d*\.?\d+/g;
                    while ((numMatch = numRegex.exec(attrValue)) !== null) {
                        const numValue = numMatch[0];
                        const numEnd = attrValueStart + numMatch.index + numValue.length;
                        if (!processed.has(numEnd)) {
                            deco.push(Decoration.widget({ widget: new NumberSliderWidget(numValue, numEnd, attrName), side: 1 }).range(numEnd));
                            processed.add(numEnd);
                        }
                    }
                }

                // 3. カンマ区切り/スペース区切り/括弧内の数値列を検出
                const lines = blockText.split('\n');
                let currentPos = range.start;
                for (const line of lines) {
                    const lineLength = line.length;
                    if (lineLength > 300 || line.includes('<path') || line.includes('<polyline') || line.includes('<polygon') || line.includes('points=')) {
                        currentPos += lineLength + 1;
                        continue;
                    }

                    numberRegex.lastIndex = 0;
                    const numbers = [];
                    let match;
                    while ((match = numberRegex.exec(line)) !== null) {
                        const numValue = match[0];
                        const numStart = currentPos + match.index;
                        const numEnd = numStart + numValue.length;

                        if (!processed.has(numEnd)) {
                            const beforeChar = match.index > 0 ? line[match.index - 1] : '';
                            const afterChar = match.index + numValue.length < line.length ? line[match.index + numValue.length] : '';
                            const validBefore = beforeChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(beforeChar);
                            const validAfter = afterChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(afterChar);

                            if (validBefore || validAfter) {
                                numbers.push({ value: numValue, start: numStart, end: numEnd, index: match.index });
                            }
                        }
                    }

                    if (numbers.length >= 2) {
                        for (let i = 0; i < numbers.length - 1; i++) {
                            const current = numbers[i];
                            const next = numbers[i + 1];
                            if (next.index - (current.index + current.value.length) <= 10) {
                                deco.push(Decoration.widget({ widget: new NumberSliderWidget(current.value, current.end, '数値'), side: 1 }).range(current.end));
                                processed.add(current.end);
                            }
                        }
                        const lastNum = numbers[numbers.length - 1];
                        if (numbers.length >= 2) {
                            const secondLast = numbers[numbers.length - 2];
                            if (lastNum.index - (secondLast.index + secondLast.value.length) <= 10) {
                                deco.push(Decoration.widget({ widget: new NumberSliderWidget(lastNum.value, lastNum.end, '数値'), side: 1 }).range(lastNum.end));
                                processed.add(lastNum.end);
                            }
                        }
                    }
                    currentPos += lineLength + 1;
                }
            }
        } else {
            // SVGブロックが存在しない場合（従来の振る舞いを維持して全文書をスキャン）
            // ただし、これが発生するのはSVGブロックがない場合のみであり、
            // SVGブロックが存在する文書でのパフォーマンスは大幅に向上する。
            let m;
            while ((m = attrRegex.exec(text)) !== null) {
                const attrName = m[1];
                const valStr = m[2];
                const start = m.index + m[0].length - m[3].length;
                deco.push(Decoration.widget({ widget: new NumberSliderWidget(valStr, start, attrName), side: 1 }).range(start));
                processed.add(start);
            }

            while ((m = multiValueAttrRegex.exec(text)) !== null) {
                const attrName = m[1];
                const attrValue = m[2];
                if (attrValue.length > 500) continue;
                const attrValueStart = m.index + m[0].indexOf(attrValue);
                let numMatch;
                const numRegex = /-?\d*\.?\d+/g;
                while ((numMatch = numRegex.exec(attrValue)) !== null) {
                    const numValue = numMatch[0];
                    const numEnd = attrValueStart + numMatch.index + numValue.length;
                    if (!processed.has(numEnd)) {
                        deco.push(Decoration.widget({ widget: new NumberSliderWidget(numValue, numEnd, attrName), side: 1 }).range(numEnd));
                        processed.add(numEnd);
                    }
                }
            }

            const lines = text.split('\n');
            let currentPos = 0;
            for (const line of lines) {
                const lineLength = line.length;
                if (lineLength > 300 || line.includes('<path') || line.includes('<polyline') || line.includes('<polygon') || line.includes('points=')) {
                    currentPos += lineLength + 1;
                    continue;
                }

                numberRegex.lastIndex = 0;
                const numbers = [];
                let match;
                while ((match = numberRegex.exec(line)) !== null) {
                    const numValue = match[0];
                    const numStart = currentPos + match.index;
                    const numEnd = numStart + numValue.length;

                    if (!processed.has(numEnd)) {
                        const beforeChar = match.index > 0 ? line[match.index - 1] : '';
                        const afterChar = match.index + numValue.length < line.length ? line[match.index + numValue.length] : '';
                        const validBefore = beforeChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(beforeChar);
                        const validAfter = afterChar === '' || /[\s,()（）年月日時分秒:\/・\-〜~]/.test(afterChar);

                        if (validBefore || validAfter) {
                            numbers.push({ value: numValue, start: numStart, end: numEnd, index: match.index });
                        }
                    }
                }

                if (numbers.length >= 2) {
                    for (let i = 0; i < numbers.length - 1; i++) {
                        const current = numbers[i];
                        const next = numbers[i + 1];
                        if (next.index - (current.index + current.value.length) <= 10) {
                            deco.push(Decoration.widget({ widget: new NumberSliderWidget(current.value, current.end, '数値'), side: 1 }).range(current.end));
                            processed.add(current.end);
                        }
                    }
                    const lastNum = numbers[numbers.length - 1];
                    if (numbers.length >= 2) {
                        const secondLast = numbers[numbers.length - 2];
                        if (lastNum.index - (secondLast.index + secondLast.value.length) <= 10) {
                            deco.push(Decoration.widget({ widget: new NumberSliderWidget(lastNum.value, lastNum.end, '数値'), side: 1 }).range(lastNum.end));
                            processed.add(lastNum.end);
                        }
                    }
                }
                currentPos += lineLength + 1;
            }
        }

        // Decoration の range は確実にソートされている必要がある
        deco.sort((a, b) => a.from - b.from);
        return Decoration.set(deco, true);
    }

    const sliderField = StateField.define({
        create(state) {
            return getSliderDecorationsFromState(state, null); // 初回は必ず全文書走査
        },
        update(decorations, tr) {
            if (!tr.docChanged) {
                // ドキュメント変更なしは位置のみをマップ
                return decorations.map(tr.changes);
            }

            // [FIX No.4] tr.changesを利用して、変更がSVGブロック内外どちらで起きたかを判定。
            // SVGブロック外（通常のMarkdownテキスト）でのタイピング時は正規表現スキャンを一切行わず、
            // 既存のデコレーション（スライダー）の位置を tr.changes でシフトして再利用する。
            const oldRanges = window._cachedSvgBlockRanges;
            let touchesSvgBlock = false;
            let fenceChanged = false;

            tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
                // SVGブロックの境界フェンスが追加/削除/変更された可能性がある場合はフルスキャンが必要
                const changedText = tr.state.doc.sliceString(fromB, toB);
                const oldChangedText = tr.startState.doc.sliceString(fromA, toA);
                if (/```/m.test(changedText) || /```/m.test(oldChangedText)) {
                    fenceChanged = true;
                }
                
                // 変更がキャッシュ済みのSVGブロック範囲内に触れているか
                if (oldRanges && oldRanges.length > 0) {
                    if (oldRanges.some(r => fromA <= r.end && toA >= r.start)) {
                        touchesSvgBlock = true;
                    }
                }
            });

            // 1. SVGブロックが存在し、その外側でのみ変更があった場合（大半のタイピング時）
            //    -> 高速なシフトのみで完了
            if (!fenceChanged && !touchesSvgBlock && oldRanges && oldRanges.length > 0) {
                window._cachedSvgBlockRanges = oldRanges.map(r => ({
                    start: tr.changes.mapPos(r.start),
                    end: tr.changes.mapPos(r.end)
                }));
                return decorations.map(tr.changes);
            }

            // 2. SVGブロック内で変更があった場合
            //    -> フェンス構造が壊れていない限り、キャッシュしたブロック範囲のシフトのみ行い、
            //       getSliderDecorationsFromState 内での全文書走査をスキップする
            let ranges = null;
            if (!fenceChanged && touchesSvgBlock && oldRanges && oldRanges.length > 0) {
                ranges = oldRanges.map(r => ({
                    start: tr.changes.mapPos(r.start),
                    end: tr.changes.mapPos(r.end)
                }));
                window._cachedSvgBlockRanges = ranges;
            }

            // 3. フェンスが変更された、または oldRanges がない（初回など）場合は ranges = null として渡す
            return getSliderDecorationsFromState(tr.state, ranges);
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
    window._historyCompartment = new Compartment();
    window._readOnlyCompartment = new Compartment();

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

        // [NEW] 追加言語の登録
        if (javascript) window.EditorLanguages.javascript = javascript;
        if (python) window.EditorLanguages.python = python;
        if (php) window.EditorLanguages.php = php;
        if (cpp) window.EditorLanguages.cpp = cpp;
        if (java) window.EditorLanguages.java = java;
        if (go) window.EditorLanguages.go = go;
        if (rust) window.EditorLanguages.rust = rust;
        
        // レガシーモード（StreamLanguageで包んで登録）
        if (StreamLanguage) {
            if (ruby) window.EditorLanguages.ruby = () => StreamLanguage.define(ruby);
            if (shell) window.EditorLanguages.shell = () => StreamLanguage.define(shell);
            if (perl) window.EditorLanguages.perl = () => StreamLanguage.define(perl);
            if (octave) window.EditorLanguages.matlab = () => StreamLanguage.define(octave);
            if (csharp) window.EditorLanguages.csharp = () => StreamLanguage.define(csharp);
            if (swift) window.EditorLanguages.swift = () => StreamLanguage.define(swift);
            if (fortran) window.EditorLanguages.fortran = () => StreamLanguage.define(fortran);
            if (pascal) window.EditorLanguages.pascal = () => StreamLanguage.define(pascal);
        }
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
            
            // [NEW] Mermaid Fold (subgraph...end, class...{...}, ENTITY...{...})
            const lineObj = state.doc.lineAt(lineStart);
            const text = lineObj.text.trim();
            
            if (text.startsWith("subgraph ")) {
                let depth = 1;
                for (let i = lineObj.number + 1; i <= state.doc.lines; i++) {
                    const l = state.doc.line(i).text.trim();
                    if (l.startsWith("subgraph ")) depth++;
                    else if (l === "end") {
                        depth--;
                        if (depth === 0) {
                            return { from: lineObj.to, to: state.doc.line(i).to };
                        }
                    }
                    if (l.startsWith("```")) break;
                }
            } else if (text.endsWith("{")) {
                let depth = 1;
                for (let i = lineObj.number + 1; i <= state.doc.lines; i++) {
                    const l = state.doc.line(i).text.trim();
                    if (l.endsWith("{")) depth++;
                    else if (l === "}") {
                        depth--;
                        if (depth === 0) {
                            return { from: lineObj.to, to: state.doc.line(i).to };
                        }
                    }
                    if (l.startsWith("```")) break;
                }
            }
            
            return null;
        }));
    }

    // [NEW] 共同編集のクラッシュ防止フィルター (Transaction Filter)
    const collabSafetyFilter = EditorState.transactionFilter.of(tr => {
        if (typeof CollabManager !== 'undefined' && CollabManager.isActive()) {
            // y-webrtcは巨大なデータ（約256KB以上）を同期しようとするとDataChannelがクラッシュする。
            // そこで1回のトランザクションでの巨大なテキスト追加（Base64等）をインターセプトし、
            // ドキュメント状態を元に戻すことで通信状態を安全に維持する。

            // 【重要】リモートからのYjs同期イベントをブロックすると、Yjs内部状態とCM6がズレて致命的なRangeErrorが発生する。
            // そのため、ユーザーの手動操作やアプリ内からの明示的な挿入（isUserEvent）のみを対象とする。
            const isUserAction = tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo');
            if (!isUserAction) {
                return tr; // リモート同期や内部ステート更新はそのまま通す
            }

            let addedChars = 0;
            tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                addedChars += inserted.length; // Text object length is the number of characters in CM6
            });
            
            // 50,000文字（約50KB）を安全な閾値とする
            if (addedChars > 50000) {
                if (typeof showToast === 'function') {
                    showToast("共同通信の安全限界を超える大量のデータ（50KB超）が追加されたため、操作をブロックして通信を保護しました。", "error");
                }
                return []; // トランザクションを破棄し、前の状態を維持
            }
        }
        return tr;
    });

    // Initial extensions
    const extensions = [
        ...fmExtensions,
        basicSetup,
        window._historyCompartment.of([
            history(),
            keymap.of(historyKeymap)
        ]),
        keymap.of(defaultKeymap),
        markdown({ base: markdownLanguage, codeLanguages: customCodeLanguages }),
        syntaxHighlighting(lightHighlightStyle),
        baseTheme,
        collabSafetyFilter,

        // Add our custom highlight field
        searchHighlightField,

        // [NEW] SVG Source highlight field
        svgSourceHighlightField,

        // SVG Number Slider Extension
        sliderField,

        lineWrappingComp.of(AppState.config.lineWrapping !== false ? EditorView.lineWrapping : []),
        themeComp.of([]), // Initialized in updateEditorTheme
        window._cmFocusModeComp.of(AppState.config.focusMode ? window._cmFocusModeTheme : []), // [NEW] Initial Focus Mode State
        window._readOnlyCompartment.of(EditorState.readOnly.of(false)),

        // [NEW] 共同編集 (yCollab) 用 Compartment
        // 最初の読み込み時に生成し、CollabManager.getCompartment() で参照可能にする
        (function() {
            if (window.CM6 && window.CM6.Compartment && !window._collabCompartment) {
                window._collabCompartment = new window.CM6.Compartment();
            }
            return window._collabCompartment ? window._collabCompartment.of([]) : [];
        })(),

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
                const isEditingPreview = typeof PreviewInlineEdit !== 'undefined' && 
                    (PreviewInlineEdit.isEditing || PreviewInlineEdit.isTransitioning);
                
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

            // [NEW] 注釈（アノテーション）のアンカー行番号を CodeMirror 6 の Transaction から正確にシフト
            if (window.AnnotationLayer && typeof window.AnnotationLayer.shiftAnchors === 'function') {
                const changes = [];
                update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                    const startLine = update.startState.doc.lineAt(fromA).number;
                    const endLine = update.startState.doc.lineAt(toA).number;
                    const deletedLines = endLine - startLine;
                    const addedLines = inserted.lines - 1;
                    const delta = addedLines - deletedLines;
                    if (delta !== 0 || deletedLines > 0) {
                        changes.push({ startLine, endLine, delta });
                    }
                });
                if (changes.length > 0) {
                    window.AnnotationLayer.shiftAnchors(changes);
                }
            }
            
            // パフォーマンス計測用: 変更検知時刻を記録
            window._lastDocChangeTime = performance.now();
            if (window._lastGlobalKeydownTime) {
                console.log(`[Perf] ⌨ キー入力から docChanged まで: ${(window._lastDocChangeTime - window._lastGlobalKeydownTime).toFixed(1)}ms`);
            }



            const isFromSvgSync = window._isDispatchingSvgSync ||
                (window.currentEditingSVG && window.currentEditingSVG._syncingToEditor);

            // [NEW] Undo/Redoによるイベントかを判定
            const isUndoRedo = update.transactions.some(tr => tr.isUserEvent('undo') || tr.isUserEvent('redo'));

            const newText = update.state.doc.toString();
            AppState.isModified = true;
            AppState.text = newText;

            if (typeof window.autoSaveManager !== 'undefined') {
                window.autoSaveManager.scheduleSave();
            }

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
                        // [FIX] ここのreturnは不要かつ有害。isFromSvgSync && !isUndoRedo で既に弾いており、
                        // ここで再度弾くと、直前のSVG同期のロック(400ms)が残っている間に発生した
                        // 正当なユーザー操作（UNDO等）のSVGキャンバスへの反映が永久にロストしてしまう。
                        // if (window.currentEditingSVG && window.currentEditingSVG._syncingToEditor) {
                        //     return;
                        // }

                        if (typeof updateSVGFromEditor === 'function') {
                            clearTimeout(window._svgSyncFromEditorTimer);
                            window._svgSyncFromEditorTimer = setTimeout(() => {
                                updateSVGFromEditor();
                            }, 300);
                        }
                        // [FIX] SVG編集中にUNDO/REDOが実行された場合は、プレビュー全体の再構築(render)を行うと
                        // UIが破壊されて閉じてしまうため、updateSVGFromEditorのみを実行して終了する。
                        if (isUndoRedo) {
                            return;
                        }
                        // [FIX] SVGエディタ起動中も、他の見出し等の変更をプレビューへ反映させるため、
                        // 通常時はここでのreturn（強制終了）は行わず、後続のrender()を実行させる。
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
                    // [NEW] プレビューのインラインテキスト編集中の場合もレンダリングをスキップする
                    if (typeof PreviewInlineEdit !== 'undefined' && PreviewInlineEdit.isEditing) {
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

                // [NEW] Update search results if active
                if (AppState.searchState && AppState.searchState.query && typeof performSearch === 'function') {
                    // Debounced search update
                    clearTimeout(window.searchDebounceTimer);
                    window.searchDebounceTimer = setTimeout(() => {
                        performSearch(true);
                    }, 300);
                }
            }

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

                    // 項目5対応: ランタイムでフラグが解除されない事態を防ぎ、ウォッチドッグタイマーで安全にリセットする
                    clearTimeout(window.editorScrollTimer);
                    clearTimeout(window.editorScrollWatchdog);
                    window.editorScrollTimer = setTimeout(() => window.isScrolling = false, 200);
                    // 最大待機時間のウォッチドッグ: 何かの理由で200msタイマーが発火しなかった場合も強制解除
                    window.editorScrollWatchdog = setTimeout(() => {
                        if (window.isScrolling) {
                            console.warn('[ScrollSync] Watchdog: isScrolling フラグが買ったままなので強制リセットします');
                            window.isScrolling = false;
                        }
                    }, 2000);
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
                // console.warn(`[setSVGSourceHighlights] Block for index ${svgIndex} NOT found.`);
                return;
            }

            // console.log(`[setSVGSourceHighlights] Block Range: Line ${startLine} to ${endLine}`);

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

                // Search for id="id" or id='id' within the block (prefix with \s to avoid data-original-id etc.)
                const regex = new RegExp(`\\sid\\s*=\\s*["']${h.id}["']`, 'g');
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
                            // [FIX No.1] DOMParserでSVGブロック全体をパースし、
                            // XMLとして正しい（タイピング途中ではない）場合のみ閉じタグ探索を実行する。
                            // パース成功 = 完全なXMLが保証される → nextClose === -1 になるリスクなし。
                            // パース失敗 = finalPos = tagEnd + 1（開きタグのみハイライト）の安全フォールバック。
                            // コメント（<!-- -->）内の偽タグ文字列による誤マッチも除外する。
                            try {
                                const parser = new DOMParser();
                                const tempDoc = parser.parseFromString(
                                    `<svg xmlns="http://www.w3.org/2000/svg">${blockText}</svg>`,
                                    'image/svg+xml'
                                );

                                // パースエラー = 不完全なXML（タイピング途中）→ 安全にスキップ
                                const parseError = tempDoc.querySelector('parsererror');
                                if (!parseError && tempDoc.getElementById(h.id)) {
                                    // DOMParserのパース成功を確認してからループを実行（完全なXMLが保証済み）
                                    const closingTag = `</${tagName}>`;
                                    let depth = 1;
                                    let searchPos = tagEnd + 1;
                                    const maxIterations = 10000; // 安全ガード（万全を期して残す）
                                    let iterations = 0;

                                    while (depth > 0 && iterations++ < maxIterations) {
                                        const sub = blockText.substring(searchPos);
                                        // コメント内の偽タグ文字列をスペースで置換して誤マッチを防ぐ
                                        const subClean = sub.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

                                        const nextClose = subClean.indexOf(closingTag);
                                        if (nextClose === -1) break; // 構造的にありえないが念のため

                                        const openingRe = new RegExp(`<${tagName}[\\s>]`);
                                        const nextOpenMatch = subClean.match(openingRe);
                                        if (nextOpenMatch && nextOpenMatch.index < nextClose) {
                                            const openIndex = nextOpenMatch.index;
                                            const openEnd = subClean.indexOf('>', openIndex);
                                            if (openEnd !== -1 && subClean.substring(openIndex, openEnd + 1).trimEnd().endsWith('/>')) {
                                                // 自己閉じタグはdepthを増やさない
                                                searchPos += openEnd + 1;
                                            } else {
                                                depth++;
                                                searchPos += openIndex + tagName.length + 1;
                                            }
                                        } else {
                                            depth--;
                                            searchPos += nextClose + closingTag.length;
                                            if (depth === 0) finalPos = searchPos;
                                        }
                                    }
                                }
                                // parseError または IDなしの場合は finalPos = tagEnd + 1 のまま（安全フォールバック）
                            } catch (e) {
                                // 例外時はフォールバック（開きタグのみハイライト）
                                // console.warn('[setSVGSourceHighlights] DOMParser failed, falling back to open-tag-only highlight.', e);
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

    // [NEW] Global Shorthand for Editor Line Highlighting (e.g. for Mermaid Selection)
    window.highlightEditorLine = function(lineIndex) {
        if (!editorView) return;
        const docLines = editorView.state.doc.lines;
        const safeLine = Math.max(1, Math.min(lineIndex + 1, docLines));
        const lineObj = editorView.state.doc.line(safeLine);
        
        editorView.dispatch({
            selection: { anchor: lineObj.from, head: lineObj.to },
            effects: [window.CM6.EditorView.scrollIntoView(lineObj.from, { y: "center" })]
        });
    };

    // [NEW] Global Shorthand for Editor Line Range Highlighting (e.g. for Mermaid subgraph Selection)
    // startLineIndex, endLineIndex は 0-based インデックス
    window.highlightEditorLineRange = function(startLineIndex, endLineIndex) {
        if (!editorView) return;
        const docLines = editorView.state.doc.lines;
        const safeStart = Math.max(1, Math.min(startLineIndex + 1, docLines));
        const safeEnd   = Math.max(1, Math.min(endLineIndex   + 1, docLines));
        const startObj  = editorView.state.doc.line(safeStart);
        const endObj    = editorView.state.doc.line(safeEnd);

        editorView.dispatch({
            selection: { anchor: startObj.from, head: endObj.to },
            effects: [window.CM6.EditorView.scrollIntoView(startObj.from, { y: "center" })]
        });
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
        replaceRange: (from, to, text, addToHistory = true, isolateHistory = false) => {
            console.log(`[editor_core] replaceRange called: textLength=${text.length}, addToHistory=${addToHistory}, isolateHistory=${isolateHistory}`);
            const spec = {
                changes: { from, to, insert: text }
            };
            const annos = [];
            let addToHistoryAnno = null;
            if (window.CM6) {
                if (window.CM6.addToHistory) {
                    addToHistoryAnno = window.CM6.addToHistory;
                } else if (window.CM6.Transaction && window.CM6.Transaction.addToHistory) {
                    addToHistoryAnno = window.CM6.Transaction.addToHistory;
                }
            }
            if (addToHistoryAnno) {
                console.log(`[editor_core] replaceRange: Adding addToHistory.of(${addToHistory})`);
                annos.push(addToHistoryAnno.of(addToHistory));
            }
            if (isolateHistory) {
                if (window.CM6) {
                    if (window.CM6.isolateHistory) {
                        console.log("[editor_core] replaceRange: Adding isolateHistory.of('before')");
                        annos.push(window.CM6.isolateHistory.of("before"));
                    } else {
                        console.warn("[editor_core] replaceRange: isolateHistory requested but window.CM6.isolateHistory is missing!");
                    }
                    if (window.CM6.Transaction && window.CM6.Transaction.userEvent) {
                        console.log("[editor_core] replaceRange: Adding Transaction.userEvent.of('svg-edit')");
                        annos.push(window.CM6.Transaction.userEvent.of("svg-edit"));
                    }
                }
            }
            if (annos.length > 0) {
                spec.annotations = annos;
            }
            editorView.dispatch(spec);
        },
        replaceLines: (fromLine, toLine, text, addToHistory = true, isolateHistory = false) => {
            console.log(`[editor_core] replaceLines called: lines ${fromLine}-${toLine}, addToHistory=${addToHistory}, isolateHistory=${isolateHistory}`);
            // fromLine, toLine are 1-based (toLine is inclusive)
            // matching CM5 replaceRange(start, end, text) behavior for blocks
            const docLines = editorView.state.doc.lines;
            // 最小値 1、最大値 docLines に収まるよう安全対策を追加
            const safeFrom = Math.max(1, Math.min(fromLine, docLines));
            const safeTo = Math.max(1, Math.min(toLine, docLines));

            const startLineObj = editorView.state.doc.line(safeFrom);
            const endLineObj = editorView.state.doc.line(safeTo);

            // [FIX] 変更が全くない場合はスキップしてUNDO履歴の破壊を防ぐ
            const currentText = editorView.state.sliceDoc(startLineObj.from, endLineObj.to);
            if (currentText === text) {
                console.log(`[editor_core] replaceLines skipped: text is identical`);
                return;
            }

            const spec = {
                changes: { from: startLineObj.from, to: endLineObj.to, insert: text }
            };
            const annos = [];
            let addToHistoryAnno = null;
            if (window.CM6) {
                if (window.CM6.addToHistory) {
                    addToHistoryAnno = window.CM6.addToHistory;
                } else if (window.CM6.Transaction && window.CM6.Transaction.addToHistory) {
                    addToHistoryAnno = window.CM6.Transaction.addToHistory;
                }
            }
            if (addToHistoryAnno) {
                console.log(`[editor_core] replaceLines: Adding addToHistory.of(${addToHistory})`);
                annos.push(addToHistoryAnno.of(addToHistory));
            }
            if (isolateHistory) {
                if (window.CM6) {
                    if (window.CM6.isolateHistory) {
                        console.log("[editor_core] replaceLines: Adding isolateHistory.of('before')");
                        annos.push(window.CM6.isolateHistory.of("before"));
                    } else {
                        console.warn("[editor_core] replaceLines: isolateHistory requested but window.CM6.isolateHistory is missing!");
                    }
                    if (window.CM6.Transaction && window.CM6.Transaction.userEvent) {
                        console.log("[editor_core] replaceLines: Adding Transaction.userEvent.of('svg-edit')");
                        annos.push(window.CM6.Transaction.userEvent.of("svg-edit"));
                    }
                }
            }
            if (annos.length > 0) {
                spec.annotations = annos;
            }

            window._isDispatchingSvgSync = true;
            try {
                editorView.dispatch(spec);
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
    let spec = state.replaceSelection(text);
    // 巨大データ保護フィルター（collabSafetyFilter）が捕捉できるようローカルイベントとしてマークする
    if (window.CM6 && window.CM6.Transaction && window.CM6.Transaction.userEvent) {
        spec.annotations = window.CM6.Transaction.userEvent.of("input.app");
    }
    editorView.dispatch(spec);
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
                let spec = {
                    changes: { from: pos, to: pos, insert: text },
                    selection: { anchor: pos + text.length }
                };
                if (window.CM6 && window.CM6.Transaction && window.CM6.Transaction.userEvent) {
                    spec.annotations = window.CM6.Transaction.userEvent.of("input.app");
                }
                editorView.dispatch(spec);
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

/**
 * エディタを動的に読み取り専用（ReadOnly）状態に設定する
 * @param {boolean} value
 */
function setEditorReadOnly(value) {
    if (!editorView || !window._readOnlyCompartment || !window.CM6) return;
    const { EditorState } = window.CM6;
    editorView.dispatch({
        effects: window._readOnlyCompartment.reconfigure(EditorState.readOnly.of(value))
    });
}
window.setEditorReadOnly = setEditorReadOnly;


