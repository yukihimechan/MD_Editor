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
            // Find if click was on a math element
            const mathElement = e.target.closest('.katex-html');
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
        this.activeWrapper = mathElement;

        // Extract raw LaTeX from the markdown source
        const doc = window.editorInstance.state.doc;
        const lineStr = doc.line(this.dataLine).text;

        // Extract exact math content bounded by $ or $$ correctly.
        // We look for the first occurrence. A full parser-based logic is better but we use regex matching line bounds
        let rawLatex = '';
        this.originalMatch = null;

        const blockRegex = /\$\$([\s\S]*?)\$\$/g;
        const inlineRegex = /\$([^$]+?)\$/g;

        let match = blockRegex.exec(lineStr);
        if (match) {
            rawLatex = match[1];
            this.originalMatch = { text: match[0], isBlock: true };
        } else {
            match = inlineRegex.exec(lineStr);
            if (match) {
                rawLatex = match[1];
                this.originalMatch = { text: match[0], isBlock: false };
            } else {
                 rawLatex = lineStr;
                 this.originalMatch = { text: lineStr, isBlock: false };
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
            top: `${targetElement.offsetTop}px`, // Relative to preview container
            left: `${Math.max(10, targetElement.offsetLeft - 10)}px`,
            width: `${Math.max(200, rect.width + 20)}px`,
            backgroundColor: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            borderRadius: '4px',
            zIndex: 1000,
            padding: '8px'
        });

        // Preview container for real-time rendering
        const livePreview = document.createElement('div');
        livePreview.className = 'math-live-preview';
        livePreview.style.marginBottom = '8px';
        livePreview.style.padding = '4px';
        livePreview.style.borderBottom = '1px solid var(--border-color)';
        livePreview.style.minHeight = '30px';

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
            ...defaultKeymap,
            ...historyKeymap,
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
            }
        ];

        const state = EditorState.create({
            doc: initialText,
            extensions: [
                history(),
                drawSelection(),
                dropCursor(),
                syntaxHighlighting(defaultHighlightStyle),
                markdown({ base: markdownLanguage }),
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
            const lineObj = doc.line(this.dataLine);

            // Re-apply substitution safely using originalMatch
            let newLineText = lineObj.text;
            if (this.originalMatch) {
                const replacementText = this.originalMatch.isBlock ? `$$${newLatex}$$` : `$${newLatex}$`;
                newLineText = newLineText.replace(this.originalMatch.text, replacementText);
            } else {
                newLineText = newLatex;
            }

            window.editorInstance.dispatch({
                changes: {
                    from: lineObj.from,
                    to: lineObj.to,
                    insert: newLineText
                }
            });
        }
    }
};

window.MathInlineEditor = MathInlineEditor;
