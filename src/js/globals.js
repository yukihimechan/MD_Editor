/**
 * Global State and DOM Elements
 */

// --- Global State ---
const AppState = {
    text: "",
    filePath: null,
    fileHandle: null,
    fileDirectory: null, // Directory handle for resolving relative image paths
    isModified: false,
    foldState: {}, // id -> boolean
    config: {
        baseFontSize: 16, // Base font size in px
        editorFontSize: 14, // [NEW] Editor font size in px
        previewWidth: 820, // Preview content width in px (actual text area, excluding padding)
        undoHistoryLimit: 200, // Undo history limit (10-1000)
        splitRatio: 50, // Editor width percentage (20-80, preview takes the rest)
        lineNumbers: true,
        pdfFooter: true,
        pageBreakOnHr: false,

        editorLineHeight: 1.6, // Editor line height
        lineWrapping: true,    // [NEW] Editor line wrapping
        codeLineHeight: 1.45,
        syntaxTheme: 'prism', // Prism.js theme: 'prism' or 'prism-okaidia'
        colors: {
            tableHead: '#eaf5ff',
            codeBg: '#fff7e6'
        },
        pdfMargins: {
            top: 10,
            bottom: 10,
            left: 10,
            right: 10
        },
        searchDialogLayout: 'vertical', // [NEW] Default search dialog layout
        grid: {
            size: 15,    // グリッド幅（ピクセル）
            showV: true, // 垂直線の表示
            showH: true, // 水平線の表示
            majorInterval: 5 // 強調線の間隔（本） [NEW]
        },
        svgToolbarOpacity: 0.4, // [NEW] SVGツールバーの通常時透過率 (10%～90%)
        showPageBreaks: false  // [NEW] プレビューに改ページ位置を表示するか
    },
    viewMode: 'editor-only', // 'split', 'preview-only', 'editor-only'
    searchState: {
        query: "",
        replaceWith: "",
        useRegex: false,
        matchCase: false,
        targets: {
            all: true,
            headings: true,
            links: true,
            codeBlocks: true,
            tables: true,
            other: true
        },
        matches: [],
        currentIndex: -1
    }
};

// --- DOM Elements ---
const DOM = {};

// --- Debounce Timers ---
let debounceTimer;
let undoDebounceTimer;
let searchHighlightDebounceTimer;

// --- Sync Lock ---
window.foldSyncLock = { ui: false, editor: false };
const foldSyncLock = window.foldSyncLock; // Keep alias for compatibility in same file

// --- Undo/Redo Manager ---
const UndoRedoManager = {
    history: [],           // All states in chronological order
    currentIndex: -1,      // Current position in history (-1 = no history)
    isUndoRedoing: false,  // Flag to prevent recording during undo/redo

    /**
     * Push current state to history
     */
    push(text) {
        // Don't record if we're in the middle of undo/redo operation
        if (this.isUndoRedoing) return;

        // Don't push if text hasn't changed
        if (this.currentIndex >= 0 && this.history[this.currentIndex] === text) {
            return;
        }

        // If we're not at the end of history, remove everything after current position
        // (This happens when user makes a new change after undo)
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        // Enforce history limit
        const limit = AppState.config.undoHistoryLimit || 200;
        if (this.history.length >= limit) {
            this.history.shift(); // Remove oldest
            this.currentIndex = Math.max(0, this.currentIndex - 1);
        }

        // Add new state to history
        this.history.push(text);
        this.currentIndex = this.history.length - 1;

        this.updateButtons();
    },

    /**
     * Undo operation - go back one step in history
     */
    undo() {
        // CodeMirrorの実装(editor.js)がある場合はそれを使用
        if (typeof execUndo === 'function') {
            execUndo();
            return;
        }

        // CodeMirrorインスタンスがある場合はそのUndo機能を使用
        if (typeof editorInstance !== 'undefined' && editorInstance && typeof editorInstance.undo === 'function') {
            editorInstance.undo();
            this.updateButtons();
            return;
        }

        // 既存のロジック（フォールバック）
        // Can't undo if we're at the beginning or no history
        if (this.currentIndex <= 0) return;

        this.isUndoRedoing = true;

        // Get current and previous text
        const currentText = this.history[this.currentIndex];

        // Move back one step
        this.currentIndex--;

        // Get previous state
        const previousText = this.history[this.currentIndex];

        // Find the position of first difference
        const changePosition = findFirstDifference(currentText, previousText);

        // Apply to editor
        setEditorText(previousText);
        AppState.text = previousText;
        AppState.isModified = true;

        // Scroll to change position if needed
        if (changePosition !== -1) {
            scrollToPosition(changePosition);
        }

        // Update preview
        render();

        this.isUndoRedoing = false;
        this.updateButtons();
    },

    /**
     * Redo operation - go forward one step in history
     */
    redo() {
        // CodeMirrorの実装(editor.js)がある場合はそれを使用
        if (typeof execRedo === 'function') {
            execRedo();
            return;
        }

        // CodeMirrorインスタンスがある場合はそのRedo機能を使用
        if (typeof editorInstance !== 'undefined' && editorInstance && typeof editorInstance.redo === 'function') {
            editorInstance.redo();
            this.updateButtons();
            return;
        }

        // 既存のロジック（フォールバック）
        // Can't redo if we're at the end of history
        if (this.currentIndex >= this.history.length - 1) return;

        this.isUndoRedoing = true;

        // Get current text
        const currentText = this.history[this.currentIndex];

        // Move forward one step
        this.currentIndex++;

        // Get next state
        const nextText = this.history[this.currentIndex];

        // Find the position of first difference
        const changePosition = findFirstDifference(currentText, nextText);

        // Apply to editor
        setEditorText(nextText);
        AppState.text = nextText;
        AppState.isModified = true;

        // Scroll to change position if needed
        if (changePosition !== -1) {
            scrollToPosition(changePosition);
        }

        // Update preview
        render();

        this.isUndoRedoing = false;
        this.updateButtons();
    },

    /**
     * Update button states (enabled/disabled)
     */
    updateButtons() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');

        // CodeMirror 6 の履歴状態を確認
        if (typeof editorInstance !== 'undefined' && editorInstance) {
            const { undoDepth, redoDepth } = window.CM6;

            if (typeof undoDepth === 'function' && typeof redoDepth === 'function') {
                const uDepth = undoDepth(editorInstance.state);
                const rDepth = redoDepth(editorInstance.state);

                if (undoBtn) {
                    const canUndo = uDepth > 0;
                    undoBtn.disabled = !canUndo;
                    undoBtn.title = canUndo
                        ? `元に戻す (Ctrl+Z) - ${uDepth}回分戻せます`
                        : '元に戻す (Ctrl+Z) - 履歴なし';
                }
                if (redoBtn) {
                    const canRedo = rDepth > 0;
                    redoBtn.disabled = !canRedo;
                    redoBtn.title = canRedo
                        ? `やり直す (Ctrl+Y) - ${rDepth}回分進めます`
                        : 'やり直す (Ctrl+Y) - 履歴なし';
                }
                return;
            } else {
                // 深度が取得できない場合は、一律で有効にする（コマンド側でチェックされるため）
                if (undoBtn) undoBtn.disabled = false;
                if (redoBtn) redoBtn.disabled = false;
                return;
            }
        }

        // 既存のロジック（フォールバック）
        if (undoBtn) {
            // Can undo if we're not at the beginning of history
            const canUndo = this.currentIndex > 0;
            const undoCount = this.currentIndex; // Number of steps we can undo

            undoBtn.disabled = !canUndo;
            undoBtn.title = canUndo
                ? `元に戻す (Ctrl+Z) - ${undoCount}回分戻せます`
                : '元に戻す (Ctrl+Z) - 履歴なし';
        }
        if (redoBtn) {
            // Can redo if we're not at the end of history
            const canRedo = this.currentIndex < this.history.length - 1;
            const redoCount = this.history.length - 1 - this.currentIndex; // Number of steps we can redo

            redoBtn.disabled = !canRedo;
            redoBtn.title = canRedo
                ? `やり直す (Ctrl+Y) - ${redoCount}回分進めます`
                : 'やり直す (Ctrl+Y) - 履歴なし';
        }
    },

    /**
     * Clear all history
     */
    clear() {
        this.history = [];
        this.currentIndex = -1;
        this.updateButtons();
    }
};
