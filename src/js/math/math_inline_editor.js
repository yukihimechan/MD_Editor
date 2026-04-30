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

        // Very basic extraction for now, assuming block math ($$ ... $$) or inline ($...$)
        // In reality, we need to match the specific formula. This is a simplified version.
        let rawLatex = '';
        const blockMatch = lineStr.match(/\$\$(.*?)\$\$/);
        const inlineMatch = lineStr.match(/\$(.*?)\$/);

        if (blockMatch) {
            rawLatex = blockMatch[1];
        } else if (inlineMatch) {
            rawLatex = inlineMatch[1];
        } else {
             // Fallback: just take the line
             rawLatex = lineStr;
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

        const state = EditorState.create({
            doc: initialText,
            extensions: [
                history(),
                drawSelection(),
                dropCursor(),
                syntaxHighlighting(defaultHighlightStyle),
                markdown({ base: markdownLanguage }),
                keymap.of([
                    ...defaultKeymap,
                    ...historyKeymap,
                    {
                        key: "Escape",
                        run: () => { this.saveAndExit(); return true; }
                    },
                    {
                        key: "Mod-Enter",
                        run: () => { this.saveAndExit(); return true; }
                    }
                ]),
                EditorView.updateListener.of((v) => {
                    if (v.docChanged) {
                        const newText = v.state.doc.toString();
                        try {
                            window.katex.render(newText, livePreview, { throwOnError: false, displayMode: true });
                        } catch (err) {
                            livePreview.innerHTML = `<span style="color:red">${err.message}</span>`;
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

            // Re-apply substitution (simplified)
            // Note: A robust implementation requires precise replacement in AST.
            let newLineText = lineObj.text;
            if (newLineText.includes('$$')) {
                 newLineText = newLineText.replace(/\$\$(.*?)\$\$/, `$$$${newLatex}$$$`);
            } else if (newLineText.includes('$')) {
                 newLineText = newLineText.replace(/\$(.*?)\$/, `$${newLatex}$`);
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
