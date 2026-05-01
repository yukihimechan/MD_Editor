/**
 * Math Inline Editor Module
 * Handles inline editing of KaTeX formulas using a floating CodeMirror instance.
 */

const MathInlineEditor = {
    activeWrapper: null,
    activeEditorView: null,
    dataLine: -1,
    overlayElement: null,

    init() {
        if (!DOM.preview) return;
        this.bindEvents();
    },

    bindEvents() {
        // Delegate click for KaTeX elements
        DOM.preview.addEventListener('click', (e) => {
            // Find if click was on a math element. texmath renders as <eq> or elements with .katex-html inside
            const mathElement = e.target.closest('.katex-html') || e.target.closest('eq');
            if (mathElement) {
                // Ignore clicks on SVG or inner interactive elements if any
                if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'svg') return;

                // Find block container to get data-line
                const blockContainer = mathElement.closest('[data-line]');
                if (blockContainer) {
                    // Prevent default PreviewInlineEdit handling if needed
                    e.stopPropagation();
                    e.preventDefault();
                    this.startEdit(mathElement, blockContainer);
                }
            }
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (this.activeEditorView && this.overlayElement &&
                !this.overlayElement.contains(e.target) &&
                !e.target.closest('.katex-html')) {
                this.saveAndExit();
            }
        });
    },

    startEdit(mathElement, blockContainer) {
        if (this.activeEditorView) {
            this.saveAndExit();
        }

        this.dataLine = parseInt(blockContainer.getAttribute('data-line'), 10);
        const dataLineEnd = blockContainer.getAttribute('data-line-end');
        this.dataLineEnd = dataLineEnd ? parseInt(dataLineEnd, 10) : this.dataLine;
        this.activeWrapper = mathElement;

        // Extract raw LaTeX from the markdown source
        const doc = window.editorInstance.state.doc;

        // Block math spans multiple lines
        let rawLatex = '';
        this.originalMatch = null;

        if (this.dataLineEnd > this.dataLine) {
            // It's a block math
            const startLine = doc.line(this.dataLine);
            const endLine = doc.line(this.dataLineEnd - 1); // data-line-end is exclusive in this engine
            const blockText = doc.sliceString(startLine.from, endLine.to);

            const blockRegex = /\$\$([\s\S]*?)\$\$/;
            const match = blockRegex.exec(blockText);
            if (match) {
                rawLatex = match[1];
                this.originalMatch = { text: match[0], isBlock: true, isMultiLine: true };
            } else {
                rawLatex = blockText;
                this.originalMatch = { text: blockText, isBlock: true, isMultiLine: true };
            }
        } else {
            // Inline math
            const lineStr = doc.line(this.dataLine).text;

            const blockRegex = /\$\$([\s\S]*?)\$\$/g;
            const inlineRegex = /\$([^$]+?)\$/g;

            let match = blockRegex.exec(lineStr);
            if (match) {
                rawLatex = match[1];
                this.originalMatch = { text: match[0], isBlock: true, isMultiLine: false };
            } else {
                match = inlineRegex.exec(lineStr);
                if (match) {
                    rawLatex = match[1];
                    this.originalMatch = { text: match[0], isBlock: false, isMultiLine: false };
                } else {
                     rawLatex = lineStr;
                     this.originalMatch = { text: lineStr, isBlock: false, isMultiLine: false };
                }
            }
        }

        this.createOverlay(mathElement, rawLatex);
    },

    createOverlay(targetElement, initialText) {
        // Create container
        this.overlayElement = document.createElement('div');
        this.overlayElement.className = 'math-inline-editor-overlay';

        // Position overlay over the element
        const rect = targetElement.getBoundingClientRect();
        const previewRect = DOM.preview.getBoundingClientRect();

        Object.assign(this.overlayElement.style, {
            position: 'absolute',
            top: `${targetElement.offsetTop}px`,
            left: `${Math.max(10, targetElement.offsetLeft - 10)}px`,
            width: `${Math.max(200, rect.width + 20)}px`
        });

        // Preview container for real-time rendering
        const livePreview = document.createElement('div');
        livePreview.className = 'math-live-preview';

        // Initial render
        try {
            window.katex.render(initialText, livePreview, { throwOnError: false, displayMode: true });
        } catch (e) {}

        this.overlayElement.appendChild(livePreview);

        DOM.preview.appendChild(this.overlayElement);

        // Setup CM6
        const { EditorState, EditorView, keymap, history, defaultKeymap, historyKeymap, drawSelection, dropCursor, syntaxHighlighting, defaultHighlightStyle, markdown, markdownLanguage } = window.CM6;

        // Custom Keymap for Suggestion Box
        const mathEditorKeymap = [
            {
                key: "Escape",
                run: () => {
                    if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                        window.MathSlashCommand.hide();
                        return true;
                    }
                    this.saveAndExit();
                    return true;
                }
            },
            {
                key: "Mod-Enter",
                run: () => { this.saveAndExit(); return true; }
            },
            {
                key: "Enter",
                run: (view) => {
                    if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                        window.MathSlashCommand.applySelection();
                        return true;
                    }
                    return false; // let default newline happen
                }
            },
            {
                key: "ArrowDown",
                run: (view) => {
                    if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                        window.MathSlashCommand.moveSelection(1);
                        return true;
                    }
                    return false;
                }
            },
            {
                key: "ArrowUp",
                run: (view) => {
                    if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                        window.MathSlashCommand.moveSelection(-1);
                        return true;
                    }
                    return false;
                }
            },
            ...defaultKeymap,
            ...historyKeymap
        ];

        // Custom Theme to remove focus ring and set padding
        const customTheme = EditorView.theme({
            "&": {
                border: "1px solid var(--border)",
                borderRadius: "4px",
                backgroundColor: "var(--code-bg)"
            },
            "&.cm-focused": {
                outline: "none",
                border: "1px solid var(--primary)"
            },
            ".cm-scroller": {
                padding: "8px",
                fontFamily: "var(--font-mono)",
                maxHeight: "200px"
            }
        });

        const state = EditorState.create({
            doc: initialText,
            extensions: [
                history(),
                drawSelection ? drawSelection() : [],
                dropCursor ? dropCursor() : [],
                syntaxHighlighting ? syntaxHighlighting(defaultHighlightStyle) : [],
                markdown ? markdown({ base: markdownLanguage }) : [],
                customTheme,
                keymap.of(mathEditorKeymap),
                EditorView.updateListener.of((v) => {
                    if (v.docChanged) {
                        const newText = v.state.doc.toString();
                        try {
                            window.katex.render(newText, livePreview, { throwOnError: false, displayMode: true });
                        } catch (err) {
                            livePreview.innerHTML = `<span style="color:red">${err.message}</span>`;
                        }
                    }

                    // Handle slash command suggestion
                    if (v.selectionSet || v.docChanged) {
                        const currentPos = v.state.selection.main.head;
                        const line = v.state.doc.lineAt(currentPos);
                        const textBeforeCursor = line.text.slice(0, currentPos - line.from);

                        // Find last backslash
                        const slashIndex = textBeforeCursor.lastIndexOf('\\');

                        if (slashIndex !== -1) {
                            const word = textBeforeCursor.slice(slashIndex + 1);
                            // If word doesn't have spaces, it's a valid trigger
                            if (!/\s/.test(word)) {
                                if (window.MathSlashCommand) {
                                    window.MathSlashCommand.show(v.view, line.from + slashIndex);
                                    window.MathSlashCommand.updateKeyword(word);
                                }
                            } else if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                                window.MathSlashCommand.hide();
                            }
                        } else if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
                            window.MathSlashCommand.hide();
                        }
                    }
                })
            ]
        });

        this.activeEditorView = new EditorView({
            state,
            parent: this.overlayElement
        });

        this.activeEditorView.focus();
    },

    saveAndExit() {
        if (!this.activeEditorView || !this.overlayElement) return;

        if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
            window.MathSlashCommand.hide();
        }

        const newLatex = this.activeEditorView.state.doc.toString();

        // Clean up UI
        this.activeEditorView.destroy();
        this.activeEditorView = null;
        if (this.overlayElement.parentNode) {
            this.overlayElement.parentNode.removeChild(this.overlayElement);
        }
        this.overlayElement = null;

        // Apply changes to main CodeMirror document
        if (this.dataLine > 0 && window.editorInstance) {
            const doc = window.editorInstance.state.doc;
            let startLineObj = doc.line(this.dataLine);
            let endLineObj = this.dataLineEnd > this.dataLine ? doc.line(this.dataLineEnd - 1) : startLineObj;

            if (this.originalMatch && this.originalMatch.isMultiLine) {
                 const blockText = doc.sliceString(startLineObj.from, endLineObj.to);
                 const replacementText = `$$\n${newLatex}\n$$`;
                 const newBlockText = blockText.replace(this.originalMatch.text, () => replacementText);

                 window.editorInstance.dispatch({
                    changes: {
                        from: startLineObj.from,
                        to: endLineObj.to,
                        insert: newBlockText
                    }
                });
            } else {
                // Re-apply substitution safely using originalMatch
                let newLineText = startLineObj.text;
                if (this.originalMatch) {
                    const replacementText = this.originalMatch.isBlock ? `$$${newLatex}$$` : `$${newLatex}$`;
                    newLineText = newLineText.replace(this.originalMatch.text, () => replacementText);
                } else {
                    newLineText = newLatex;
                }

                window.editorInstance.dispatch({
                    changes: {
                        from: startLineObj.from,
                        to: startLineObj.to,
                        insert: newLineText
                    }
                });
            }
        }
    }
};

window.MathInlineEditor = MathInlineEditor;
