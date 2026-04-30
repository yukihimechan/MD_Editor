/**
 * Inline Code Editor Module
 * Handles inline editing of code blocks using CodeMirror and language selection.
 */

const InlineCodeEditor = {
    activeWrapper: null,
    activeEditorView: null,
    codeIndex: -1,

    languages: {
        '画像系': ['svg', 'mermaid'],
        'スクリプト系': ['javascript', 'typescript', 'python', 'ruby', 'php'],
        'インタープリタ系': ['bash', 'perl', 'matlab'],
        'コンパイル系': ['c', 'cpp', 'csharp', 'java', 'swift', 'go', 'rust', 'fortran', 'pascal'],
        'その他': ['html', 'css', 'xml', 'markdown', 'json', 'yaml', 'sql', 'text']
    },

    init() {
        this.bindEvents();
    },

    bindEvents() {
        const preview = document.getElementById('preview');
        if (!preview) return;

        // Delegate click for Edit button and Language label
        preview.addEventListener('click', (e) => {
            if (e.target.closest('.code-edit-btn')) {
                const wrapper = e.target.closest('.code-block-wrapper');
                if (wrapper) {
                    this.startEdit(wrapper);
                }
            } else if (e.target.closest('.language-label.clickable')) {
                const wrapper = e.target.closest('.code-block-wrapper');
                if (wrapper) {
                    this.openLanguageDialog(wrapper);
                }
            }
        });

        // Delegate double click for code block
        preview.addEventListener('dblclick', (e) => {
            const wrapper = e.target.closest('.code-block-wrapper');
            if (wrapper && !e.target.closest('.code-edit-btn') && !e.target.closest('.language-label.clickable') && !e.target.closest('.copy-btn')) {
                if (wrapper.classList.contains('svg-view-wrapper')) return; // handled by svg editor
                this.startEdit(wrapper);
            }
        });
    },

    initLanguageDialog() {
        const dialog = document.getElementById('dialog-language-select');
        const container = document.getElementById('lang-categories-container');
        const customInput = document.getElementById('custom-language-input');
        const setBtn = document.getElementById('btn-set-custom-language');
        const closeBtn = document.getElementById('btn-close-language-select');

        if (!dialog || !container || this._dialogInitialized) return;
        this._dialogInitialized = true;

        const categoryI18nKeys = {
            '画像系': 'languageSelect.catImage',
            'スクリプト系': 'languageSelect.catScript',
            'インタープリタ系': 'languageSelect.catInterpreter',
            'コンパイル系': 'languageSelect.catCompile',
            'その他': 'languageSelect.catOther'
        };

        // Build category buttons
        for (const [categoryName, langs] of Object.entries(this.languages)) {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'lang-category';

            const title = document.createElement('div');
            title.className = 'lang-category-title';

            if (categoryI18nKeys[categoryName]) {
                title.setAttribute('data-i18n', categoryI18nKeys[categoryName]);
            }

            let titleText = categoryName;
            if (typeof I18n !== 'undefined' && categoryI18nKeys[categoryName]) {
                titleText = I18n.translate(categoryI18nKeys[categoryName]) || categoryName;
            }
            title.textContent = titleText;
            categoryDiv.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'lang-buttons-grid';

            langs.forEach(lang => {
                const btn = document.createElement('button');
                btn.className = 'lang-btn';
                // Fallback label if getLanguageLabel isn't available
                let label = lang.toUpperCase();
                if (typeof getLanguageLabel === 'function') {
                    label = getLanguageLabel(lang);
                }
                btn.textContent = label;
                btn.dataset.lang = lang;

                btn.onclick = () => {
                    if (this.activeWrapper) {
                        this.updateLanguage(lang);
                        dialog.close();
                    }
                };
                grid.appendChild(btn);
            });

            categoryDiv.appendChild(grid);
            container.appendChild(categoryDiv);
        }

        setBtn.onclick = () => {
            const val = customInput.value.trim();
            if (val && this.activeWrapper) {
                this.updateLanguage(val);
                dialog.close();
            }
        };

        closeBtn.onclick = () => dialog.close();

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.close();
        });
    },

    openLanguageDialog(wrapper) {
        if (!this._dialogInitialized) {
            this.initLanguageDialog();
        }

        this.activeWrapper = wrapper;
        this.codeIndex = parseInt(wrapper.dataset.codeIndex, 10);

        const dialog = document.getElementById('dialog-language-select');
        const langLabel = wrapper.querySelector('.language-label');
        const currentLang = langLabel ? (langLabel.dataset.language || 'text') : 'text';

        dialog.querySelectorAll('.lang-btn').forEach(btn => {
            if (btn.dataset.lang === currentLang) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const customInput = document.getElementById('custom-language-input');
        customInput.value = currentLang;

        dialog.showModal();
    },

    updateLanguage(newLang) {
        if (this.codeIndex === -1) return;

        const text = AppState.text;
        const lines = text.split('\n');
        let currentCodeIndex = 0;
        let inCodeBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.match(/^\s*```/)) {
                if (!inCodeBlock) {
                    if (currentCodeIndex === this.codeIndex) {
                        // Replace the language tag
                        const indentation = line.match(/^\s*/)[0];
                        lines[i] = `${indentation}\`\`\`${newLang}`;

                        const newText = lines.join('\n');
                        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);

                        AppState.text = newText;
                        if (typeof setEditorText === 'function') setEditorText(newText);
                        if (typeof render === 'function') render();
                        break;
                    }
                    inCodeBlock = true;
                } else {
                    inCodeBlock = false;
                    currentCodeIndex++;
                }
            }
        }

        this.activeWrapper = null;
        this.codeIndex = -1;
    },

    startEdit(wrapper) {
        if (this.activeEditorView) {
            this.saveAndExit(); // close previous if any
        }

        this.activeWrapper = wrapper;
        this.codeIndex = parseInt(wrapper.dataset.codeIndex, 10);

        // [NEW] If language is SVG, use SVG Editor instead of CM6 inline editor
        const langLabel = wrapper.querySelector('.language-label');
        const lang = langLabel ? (langLabel.dataset.language || 'text') : 'text';

        if (lang === 'svg') {
            const svgView = wrapper.querySelector('.svg-view-wrapper');
            if (svgView && typeof startSVGEdit === 'function') {
                startSVGEdit(svgView, parseInt(svgView.getAttribute('data-svg-index')));
                return;
            }
        }

        // [NEW] Mermaid言語の場合: ダイアグラムを隠してコードを直接編集
        if (lang === 'mermaid') {
            this.startMermaidEdit(wrapper);
            return;
        }

        const pre = wrapper.querySelector('pre');
        const codeElement = wrapper.querySelector('code');
        const copyBtn = wrapper.querySelector('.copy-btn');

        if (!pre || !copyBtn) return;

        // Hide original content
        pre.style.display = 'none';

        // Hide overlay buttons (Copy, Edit, Language)
        const buttons = wrapper.querySelectorAll('button, .language-label');
        buttons.forEach(b => b.style.display = 'none');

        const originalCodeText = copyBtn.dataset.codeText || '';

        // Create editor container
        const editorContainer = document.createElement('div');
        editorContainer.className = 'inline-editor-container';
        // Basic style for inline CodeMirror
        editorContainer.style.border = '2px solid var(--primary)';
        editorContainer.style.borderRadius = '4px';
        editorContainer.style.margin = '4px 0';
        editorContainer.style.position = 'relative';

        wrapper.appendChild(editorContainer);

        // Setup CodeMirror
        if (!window.CM6) {
            console.error("CodeMirror 6 not loaded");
            return;
        }

        const { EditorState, EditorView, basicSetup, oneDark, syntaxHighlighting, defaultHighlightStyle, keymap, defaultKeymap, historyKeymap } = window.CM6;

        // Theme
        const isDark = document.body.classList.contains('dark-theme');

        // Extensions
        const extensions = [
            basicSetup,
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            EditorView.theme({
                "&": { height: "auto", minHeight: "60px", maxHeight: "400px" },
                ".cm-scroller": { overflow: "auto" }
            })
        ];

        if (isDark && oneDark) extensions.push(oneDark);

        // Try to load language extension based on current code block language
        if (lang !== 'text' && window.EditorLanguages) {
            if (lang === 'javascript' || lang === 'js') extensions.push(window.EditorLanguages.javascript());
            else if (lang === 'python' || lang === 'py') extensions.push(window.EditorLanguages.python());
            else if (lang === 'html') extensions.push(window.EditorLanguages.html());
            else if (lang === 'css') extensions.push(window.EditorLanguages.css());
            else if (lang === 'cpp' || lang === 'c') extensions.push(window.EditorLanguages.cpp());
            else if (lang === 'java') extensions.push(window.EditorLanguages.java());
            else if (lang === 'json') extensions.push(window.EditorLanguages.json());
            else if (lang === 'markdown' || lang === 'md') extensions.push(window.EditorLanguages.markdown());
            // More languages can be added if loaded in index.html
        }

        const state = EditorState.create({
            doc: originalCodeText,
            extensions: extensions
        });

        this.activeEditorView = new EditorView({
            state,
            parent: editorContainer
        });

        // Add Done button
        const doneBtn = document.createElement('button');
        doneBtn.className = 'inline-done-btn';
        doneBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.done') || '完了' : '完了';
        doneBtn.onclick = () => this.saveAndExit();
        doneBtn.style.top = '5px';
        doneBtn.style.right = '5px';
        editorContainer.appendChild(doneBtn);

        // Focus the editor
        this.activeEditorView.focus();
    },

    saveAndExit() {
        if (!this.activeEditorView || !this.activeWrapper || this.codeIndex === -1) return;

        const newCode = this.activeEditorView.state.doc.toString();

        // Update markdown source
        const text = AppState.text;
        const lines = text.split('\n');

        let currentCodeIndex = 0;
        let inCodeBlock = false;
        let blockStartLine = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.match(/^\s*```/)) {
                if (!inCodeBlock) {
                    if (currentCodeIndex === this.codeIndex) {
                        blockStartLine = i;
                    }
                    inCodeBlock = true;
                } else {
                    if (currentCodeIndex === this.codeIndex) {
                        const blockEndLine = i;
                        const before = lines.slice(0, blockStartLine + 1).join('\n');
                        const after = lines.slice(blockEndLine).join('\n');
                        // Ensure inner code ends with a single newline or no newline before the closing tag, 
                        // but actually just join it properly
                        const newText = before + '\n' + newCode + (newCode.endsWith('\n') ? '' : '\n') + after;

                        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);

                        AppState.text = newText;
                        if (typeof setEditorText === 'function') setEditorText(newText);

                        // We will call full render() which destroys this DOM element completely.
                        this.activeEditorView.destroy();
                        this.activeEditorView = null;
                        this.activeWrapper = null;
                        this.codeIndex = -1;

                        if (typeof render === 'function') render();
                        return;
                    }
                    inCodeBlock = false;
                    currentCodeIndex++;
                }
            }
        }

        // If we reach here, codeblock wasn't found (maybe deleted in parallel?)
        this.activeEditorView.destroy();
        this.activeEditorView = null;
        this.activeWrapper = null;
        this.codeIndex = -1;
        if (typeof render === 'function') render();
    },

    // ── Mermaid専用編集メソッド ──────────────────────────────────

    /**
     * Mermaidダイアグラムを「編集モード」にする。
     * ダイアグラムはそのまま表示したまま、ノード接続ハンドルを有効化する。
     * コードブロック（pre）は非表示のままにし、ダイアグラムの操作のみ行う。
     * @param {Element} codeBlockWrapper - .code-block-wrapper
     */
    startMermaidEdit(codeBlockWrapper) {
        if (this.activeMermaidWrapper) {
            this.exitMermaidEdit(); // 既存の編集モードを閉じる
        }

        this.activeMermaidWrapper = codeBlockWrapper;
        this.codeIndex = parseInt(codeBlockWrapper.dataset.codeIndex, 10);

        // mermaid-diagram-wrapperを探す（code-block-wrapper内）
        const diagramWrapper = codeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
        this._activeMermaidDiagram = diagramWrapper;

        // ── 編集モード開始 ──
        // Mermaidの元コードを取得して種類を判定する
        const copyBtn = codeBlockWrapper.querySelector('.copy-btn');
        const mermaidCode = copyBtn ? (copyBtn.dataset.codeText || '') : '';
        const firstLine = mermaidCode.trim().split('\n')[0] || '';
        
        const isSequence = /^sequenceDiagram\b/i.test(firstLine);
        console.log(`[InlineEditor] startMermaidEdit: isSequence=${isSequence}, firstLine=${firstLine}`);

        // ダイアグラムをそのまま表示し、状態クラスを付与して
        // Interaction がハンドル等を表示できるようにする
        if (diagramWrapper) {
            if (isSequence) {
                diagramWrapper.classList.add('mermaid-sequence-edit-mode');
            } else {
                diagramWrapper.classList.add('mermaid-edit-mode');
            }
        }

        // 「編集」ボタンを「完了」ボタンに切り替える
        const editBtn = codeBlockWrapper.querySelector('.code-edit-btn');
        if (editBtn) {
            editBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.done') || '完了' : '完了';
            editBtn.classList.add('mermaid-done-mode');
            // クリックで完了処理に切り替え
            editBtn._originalOnclick = editBtn.onclick;
            editBtn.onclick = (e) => {
                e.stopPropagation();
                this.exitMermaidEdit();
            };
        }

        // Mermaidツールバーを表示する
        if (isSequence) {
            console.log('[InlineEditor] sequenceDiagram用のツールバー表示を試みます');
            if (window.activeMermaidSequenceToolbar && diagramWrapper) {
                console.log('[InlineEditor] activeMermaidSequenceToolbar.show() を呼び出します');
                window.activeMermaidSequenceToolbar.show(diagramWrapper);
            } else {
                console.error('[InlineEditor] window.activeMermaidSequenceToolbar が見つかりません。初期化に失敗している可能性があります。', window.activeMermaidSequenceToolbar);
            }
        } else {
            console.log('[InlineEditor] flowchart用のツールバー表示を試みます');
            if (window.activeMermaidToolbar && diagramWrapper) {
                window.activeMermaidToolbar.show(diagramWrapper);
            }
        }
    },

    /**
     * Mermaid編集モードを終了する（ダイアグラム操作完了）。
     * ハンドルを非表示にして「編集」ボタンに戻す。
     */
    exitMermaidEdit() {
        // ツールバーは状態に依らず必ず非表示にする（早期リターン前に実行）
        if (window.activeMermaidToolbar) {
            window.activeMermaidToolbar.hide();
        }
        if (window.activeMermaidSequenceToolbar) {
            window.activeMermaidSequenceToolbar.hide();
        }

        if (!this.activeMermaidWrapper) return;

        const diagramWrapper = this._activeMermaidDiagram;
        if (diagramWrapper) {
            diagramWrapper.classList.remove('mermaid-edit-mode');
            diagramWrapper.classList.remove('mermaid-sequence-edit-mode');
        }

        // 「完了」→「編集」ボタンに戻す
        const editBtn = this.activeMermaidWrapper.querySelector('.code-edit-btn');
        if (editBtn && editBtn.classList.contains('mermaid-done-mode')) {
            editBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.edit') || '編集' : '編集';
            editBtn.classList.remove('mermaid-done-mode');
            editBtn.onclick = editBtn._originalOnclick || null;
            delete editBtn._originalOnclick;
        }

        this.activeMermaidWrapper = null;
        this._activeMermaidDiagram = null;
        this.codeIndex = -1;
    },

    /**
     * @deprecated saveMermaidAndExit は exitMermaidEdit に統合されました
     */
    saveMermaidAndExit() {
        this.exitMermaidEdit();
    }
};



// Auto-initialize when DOM is ready
// but note dialog content is built lazily on first open,
// ensuring I18n has loaded first.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => InlineCodeEditor.init());
} else {
    InlineCodeEditor.init();
}
