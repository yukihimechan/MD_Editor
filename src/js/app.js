
/**
 * Main Application Entry Point
 * Initializes modules and handles app startup
 */

document.addEventListener('DOMContentLoaded', init);

async function init() {
    console.log('Initializing Markdown Editor...');

    if (typeof I18n !== 'undefined' && typeof I18n.init === 'function') {
        await I18n.init();
        if (typeof applyTranslations === 'function') applyTranslations();
    }

    // 1. Bind Global DOM Elements
    // These are used by other modules via the global DOM object
    DOM.editor = document.getElementById('editor');
    DOM.editorPane = document.getElementById('editor-pane');
    DOM.editorHighlights = document.getElementById('editor-highlights');
    DOM.preview = document.getElementById('preview');
    DOM.previewPane = document.getElementById('preview-pane');
    DOM.resizeBar = document.getElementById('resize-bar');
    DOM.toast = document.getElementById('toast');
    DOM.previewStatusBar = document.getElementById('preview-status-bar');
    DOM.dialogHelp = document.getElementById('dialog-help');
    DOM.dialogConfig = document.getElementById('dialog-config');
    DOM.dialogDirAccess = document.getElementById('dialog-dir-access');
    DOM.dialogSearch = document.getElementById('search-dialog');
    DOM.appTitle = document.getElementById('app-title');
    DOM.outlinePanel = document.getElementById('outline-panel');
    DOM.outlineContent = document.getElementById('outline-content');
    DOM.svgListPanel = document.getElementById('svg-list-panel');
    DOM.svgListContent = document.getElementById('svg-list-content');

    // Search dialog elements
    DOM.searchInput = document.getElementById('search-query');
    DOM.replaceInput = document.getElementById('replace-query');
    DOM.searchHistoryList = document.getElementById('search-history-list');
    DOM.replaceHistoryList = document.getElementById('replace-history-list');
    DOM.searchNextBtn = document.getElementById('btn-find-next');
    DOM.searchPrevBtn = document.getElementById('btn-find-previous');
    DOM.searchShowAllBtn = document.getElementById('btn-find-all');
    DOM.searchCloseBtn = document.getElementById('btn-search-close');
    DOM.replaceOneBtn = document.getElementById('btn-replace-one');
    DOM.replaceAllBtn = document.getElementById('btn-replace-all');
    DOM.svgPropCancelBtn = document.getElementById('svg-prop-cancel');

    // Search Options
    DOM.searchRegexCheck = document.getElementById('search-regex');
    DOM.searchCaseCheck = document.getElementById('search-case-sensitive');
    DOM.searchCount = document.getElementById('search-count');
    DOM.searchCurrent = document.getElementById('search-current');
    DOM.searchPosition = document.getElementById('search-position');
    DOM.searchTargetAll = document.getElementById('search-target-all');
    DOM.searchTargetHeadings = document.getElementById('search-target-headings');
    DOM.searchTargetLinks = document.getElementById('search-target-links');
    DOM.searchTargetCodeBlocks = document.getElementById('search-target-code');
    DOM.searchTargetTables = document.getElementById('search-target-tables');
    DOM.searchTargetOther = document.getElementById('search-target-other');
    DOM.searchLayoutSelect = document.getElementById('search-layout-select');

    // Search Results Dialog
    DOM.searchResultsDialog = document.getElementById('search-results-dialog');
    DOM.searchResultsList = document.getElementById('search-results-list');
    DOM.searchResultsQuery = document.getElementById('search-results-query');
    DOM.searchResultsCount = document.getElementById('search-results-count');
    DOM.searchResultsCloseBtn = document.getElementById('btn-close-search-results');
    DOM.searchResultsHeader = document.querySelector('.search-results-header');
    DOM.searchResultsResizeHandle = document.querySelector('.search-results-resize-handle');

    // PDF Progress Dialog
    DOM.dialogProgress = document.getElementById('dialog-progress');
    DOM.pdfProgressBar = document.getElementById('pdf-progress-bar');
    DOM.pdfProgressText = document.getElementById('pdf-progress-text');
    DOM.btnCancelPDF = document.getElementById('btn-cancel-pdf');

    // 2. Setup Libraries & Utilities
    if (typeof setupMarkdownIt === 'function') setupMarkdownIt();
    setupMermaidErrorSuppression();

    // 3. Restore Settings & State (Load before initializing editor)
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof loadFoldState === 'function') loadFoldState();

    // 4. Initialize Modules & Bind Events
    if (typeof initEditor === 'function') initEditor();
    if (typeof bindToolbarEvents === 'function') bindToolbarEvents();
    if (typeof bindDragDrop === 'function') bindDragDrop();
    if (typeof bindShortcuts === 'function') bindShortcuts();
    if (typeof bindSearchDialogEvents === 'function') bindSearchDialogEvents();
    if (typeof bindScrollSync === 'function') bindScrollSync();
    if (typeof bindResize === 'function') bindResize();
    if (typeof bindSidebarResize === 'function') bindSidebarResize();
    bindPreviewMouseMove();

    // 5. Initialize Inline Editing
    if (typeof PreviewInlineEdit !== 'undefined' && typeof PreviewInlineEdit.init === 'function') {
        PreviewInlineEdit.init();
    }
    if (typeof MathInlineEditor !== 'undefined' && typeof MathInlineEditor.init === 'function') {
        MathInlineEditor.init();
    }
    if (typeof initContextMenu === 'function') initContextMenu();


    // 6. Initial Content Load and Tauri Setup
    if (window.__TAURI__) {
        try {
            // Save Tauri API reference to AppState for other modules
            AppState.tauri = window.__TAURI__;
            AppState.isTauri = true;

            const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.tauri?.invoke || window.__TAURI__.invoke;
            const listen = window.__TAURI__.event?.listen;
            const { fs, path } = window.__TAURI__;


            const handleDrop = async (event, eventName) => {
                let paths = [];
                let dropPos = null; // [NEW] Tauri 2.0 position data

                if (Array.isArray(event.payload)) {
                    paths = event.payload;
                } else if (event.payload && typeof event.payload === 'object') {
                    if (Array.isArray(event.payload.paths)) {
                        paths = event.payload.paths;
                    } else if (event.payload.position) {
                        paths = event.payload.paths || [];
                    }
                    if (event.payload.position) {
                        dropPos = { x: event.payload.position.x, y: event.payload.position.y };
                    }
                }

                if (paths && paths.length > 0) {
                    for (let i = 0; i < paths.length; i++) {
                        const filePath = paths[i];

                        try {
                            const ext = filePath.split('.').pop().toLowerCase();
                            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

                            if (isImage) {
                                if (window.currentEditingSVG && window.currentEditingSVG.draw) {
                                    // SVG編集中は、SVG/画像ファイルともにSVGキャンバスへ配置する
                                    if (typeof showToast === 'function') showToast(t('app.placingInSvg'), "info");
                                    try {
                                        // Tauri側の座標から、SVGキャンバス内の相対座標への変換
                                        let svgDropPoint = null;
                                        if (dropPos) {
                                            const container = window.currentEditingSVG.container;
                                            if (container) {
                                                const rect = container.getBoundingClientRect();
                                                const draw = window.currentEditingSVG.draw;
                                                // SVGキャンバス上での複数ドロップ時には少しずつずらして配置する
                                                svgDropPoint = draw.point(dropPos.x - rect.left + (i * 20), dropPos.y - rect.top + (i * 20));
                                            }
                                        }

                                        if (ext === 'svg') {
                                            const text = await fs.readTextFile(filePath);
                                            if (typeof window.importSVGContent === 'function') {
                                                window.importSVGContent(text, svgDropPoint);
                                            }
                                        } else {
                                            // SVG以外の画像の場合はBase64化してインポート
                                            const binary = await fs.readFile(filePath);
                                            const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                                            // ArrayBuffer to Base64
                                            let binaryStr = '';
                                            const bytes = new Uint8Array(binary);
                                            for (let j = 0; j < bytes.byteLength; j++) {
                                                binaryStr += String.fromCharCode(bytes[j]);
                                            }
                                            const base64 = btoa(binaryStr);
                                            const dataUrl = `data:${mimeType};base64,${base64}`;
                                            
                                            if (typeof window.importImageAsBase64 === 'function') {
                                                window.importImageAsBase64(dataUrl, svgDropPoint);
                                            } else {
                                                console.error('importImageAsBase64 is not defined');
                                            }
                                        }
                                    } catch (err) {
                                        console.error('Failed to import to SVG editor:', err);
                                        if (typeof showToast === 'function') showToast(t('app.importFailed'), "error");
                                    }
                                    continue; // SVGに配置したため、Markdownとしては処理せず次のファイルへ
                                } else {
                                    // Markdownエディタへの挿入
                                    if (typeof showToast === 'function') showToast(t('app.insertingImage'), "info");

                                    let file;
                                    if (ext === 'svg') {
                                        const text = await fs.readTextFile(filePath);
                                        const fileName = await path.basename(filePath);
                                        file = new File([text], fileName, { type: 'image/svg+xml' });
                                    } else {
                                        const binary = await fs.readFile(filePath);
                                        const fileName = await path.basename(filePath);
                                        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                                        file = new File([binary], fileName, { type: mimeType });
                                    }

                                    if (typeof insertImageAsBase64 === 'function') {
                                        await insertImageAsBase64(file);
                                    }
                                    continue; // 次の画像を処理
                                }
                            }

                            // Code file detection
                            const commonCodeExts = ['js', 'ts', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'swift', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sh', 'sql'];
                            const isMarkdownExt = ext === 'md' || ext === 'markdown';
                            if (!isMarkdownExt && (commonCodeExts.includes(ext) || (typeof Prism !== 'undefined' && Prism.languages[ext]))) {
                                const text = await fs.readTextFile(filePath);
                                const fileName = await path.basename(filePath);
                                const codeBlockText = `\n${fileName}\n\`\`\`${ext}\n${text}\n\`\`\`\n`;

                                // Try to insert at cursor position
                                if (window.editorInstance) {
                                    const docLength = window.editorInstance.state.doc.length;
                                    const pos = Math.min(window.editorInstance.state.selection.main.head, docLength);
                                    window.editorInstance.dispatch({
                                        changes: { from: pos, insert: codeBlockText },
                                        selection: { anchor: pos + codeBlockText.length }
                                    });
                                    if (typeof showToast === 'function') showToast(t('app.codeExpanded', { fileName }));
                                    continue; // 次のファイルを処理
                                }
                            }

                            // Markdown loading (1つのファイルでエディタ全体を上書きするため、これ以降のファイルは無視する)
                            if (typeof showToast === 'function') showToast(t('app.loadingFile'), "info");
                            const text = await fs.readTextFile(filePath);
                            const fileName = await path.basename(filePath);
                            const dirPath = await path.dirname(filePath);

                            const file = new File([text], fileName, { type: 'text/markdown' });

                            AppState.fileDirectory = dirPath;
                            AppState.filePath = fileName;
                            AppState.fileFullPath = filePath;

                            await loadFile(file, null);

                            if (typeof updateTitle === 'function') updateTitle();
                            if (typeof showToast === 'function') showToast(t('toast.fileOpened') + `: ${fileName}`);
                            
                            // エディタ全体を読み込んだので、他のファイルの処理は打ち切る
                            return;

                        } catch (err) {
                            console.error('Failed to load dropped file:', err);
                            if (typeof showToast === 'function') showToast(t('toast.fileReadError') + `: ${err}`, "error");
                        }
                    }
                }
            };

            // Listen for files dropped
            listen('tauri://file-drop', (e) => handleDrop(e, 'tauri://file-drop'));
            listen('tauri://drag-drop', (e) => handleDrop(e, 'tauri://drag-drop'));

            // URL Params
            const urlParams = new URLSearchParams(window.location.search);
            const queryFilePath = urlParams.get('filepath');
            const modeParam = urlParams.get('mode');
            let isSvgMode = modeParam === 'svg';

            if (queryFilePath || urlParams.get('file') || urlParams.get('url')) {
                const targetPath = queryFilePath || urlParams.get('file') || urlParams.get('url');
                try {
                    let text = '';
                    let fileName = '';
                    let dirPath = '';

                    if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
                        // Remote URL
                        if (typeof showToast === 'function') showToast(t('app.loadingRemoteFile'), "info");
                        let decodedUrl = targetPath;
                        try {
                            decodedUrl = decodeURIComponent(targetPath);
                        } catch (e) {
                            console.warn('[Init] Remote URL decoding failed, using raw path:', e);
                        }
                        // [FIX] Upgrade HTTP to HTTPS to avoid Mixed Content error if app is loaded via HTTPS
                        if (decodedUrl.startsWith('http://') && window.location.protocol === 'https:') {
                            decodedUrl = decodedUrl.replace(/^http:\/\//i, 'https://');
                        }
                        const response = await fetch(decodedUrl);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        text = await response.text();
                        fileName = decodedUrl.split('/').pop() || 'remote_file.md';
                        // For remote files, we don't have a local directory path
                    } else {
                        // Local Path (Tauri)
                        let decodedPath = targetPath;
                        if (decodedPath.includes('%')) {
                            try { decodedPath = decodeURIComponent(decodedPath); } catch (e) { }
                        }
                        text = await fs.readTextFile(decodedPath);
                        fileName = await path.basename(decodedPath);
                        dirPath = await path.dirname(decodedPath);
                    }

                    if (fileName.toLowerCase().endsWith('.svg')) {
                        // SVGファイルをドラッグ＆ドロップした時と同じコードブロック形式に変換
                        if (typeof formatSVGAsCodeBlock === 'function') {
                            text = await formatSVGAsCodeBlock(text);
                        } else {
                            text = "```svg\n" + text + "\n```";
                        }
                        if (!isSvgMode) isSvgMode = true; // [NEW] SVG extension check
                        AppState.isSvgMode = true;
                    }

                    const file = new File([text], fileName, { type: 'text/markdown' });
                    AppState.fileDirectory = dirPath;
                    AppState.filePath = fileName;
                    if (!targetPath.startsWith('http')) {
                        AppState.fileFullPath = targetPath;
                    }
                    await loadFile(file, null);

                    // Switch to preview mode if loaded via URL parameter
                    AppState.viewMode = 'preview-only';
                    if (typeof applyViewMode === 'function') applyViewMode();
                    if (typeof saveSettings === 'function') saveSettings();

                    // SVGモード起動予約
                    if (isSvgMode) {
                        AppState._pendingAutoSVGEdit = true;
                        if (typeof updateTitle === 'function') updateTitle();
                        if (typeof applyUIModeRestrictions === 'function') applyUIModeRestrictions();
                    }

                } catch (err) {
                    console.error('URL param load error:', err);
                    if (typeof showToast === 'function') showToast(t('toast.fileReadError') + `: ${err.message}`, "error");
                }
            } else {
                // ファイル指定がない場合（通常起動、起動引数、または履歴復元）
                const launchPath = await invoke('get_launch_path').catch(() => null);
                if (launchPath) {
                    // 1. コマンドライン引数（ダブルクリック等）からの起動
                    try {
                        console.log('[Init] Loading from launch path:', launchPath);
                        let text = await fs.readTextFile(launchPath);
                        const fileName = await path.basename(launchPath);
                        const dirPath = await path.dirname(launchPath);
                        
                        // [NEW] SVG extension check for Tauri auto-open
                        if (fileName.toLowerCase().endsWith('.svg')) {
                            if (typeof formatSVGAsCodeBlock === 'function') {
                                text = await formatSVGAsCodeBlock(text);
                            } else {
                                text = "```svg\n" + text + "\n```";
                            }
                            if (!isSvgMode) isSvgMode = true;
                            AppState.isSvgMode = true;
                            AppState._pendingAutoSVGEdit = true;
                            if (typeof updateTitle === 'function') updateTitle();
                            if (typeof applyUIModeRestrictions === 'function') applyUIModeRestrictions();
                        }

                        const file = new File([text], fileName, { type: 'text/markdown' });

                        AppState.fileDirectory = dirPath;
                        AppState.filePath = fileName;
                        AppState.fileFullPath = launchPath;
                        await loadFile(file, null);
                    } catch (err) {
                        console.error('Launch path load error:', err);
                        await loadSampleContent();
                    }
                } else if (isSvgMode) {
                    // 2. mode=svg パラメータがある場合：空のSVGを作成
                    try {
                        const previewW = (AppState.config && AppState.config.previewWidth) ? AppState.config.previewWidth : 820;
                        const emptySvg = `<svg width="${previewW}" height="600" viewBox="0 0 ${previewW} 600" xmlns="http://www.w3.org/2000/svg"></svg>`;
                        const text = "```svg\n" + emptySvg + "\n```";
                        const file = new File([text], 'new_diagram.svg', { type: 'text/markdown' });

                        AppState.viewMode = 'preview-only';
                        AppState.isSvgMode = true;
                        await loadFile(file, null);
                        if (typeof applyViewMode === 'function') applyViewMode();
                        if (typeof updateTitle === 'function') updateTitle();
                        if (typeof applyUIModeRestrictions === 'function') applyUIModeRestrictions();

                        AppState._pendingAutoSVGEdit = true;
                    } catch (err) {
                        console.error('SVG Mode initiation error:', err);
                        await loadSampleContent();
                    }
                } else {
                    // 3. 履歴からの復元
                    const lastOpened = sessionStorage.getItem('lastOpenedFilePath');
                    let restored = false;

                    if (lastOpened) {
                        try {
                            const exists = await fs.exists(lastOpened);
                            if (exists) {
                                console.log('[Init] Restoring last opened file:', lastOpened);
                                const text = await fs.readTextFile(lastOpened);
                                const fileName = await path.basename(lastOpened);
                                const dirPath = await path.dirname(lastOpened);
                                const file = new File([text], fileName, { type: 'text/markdown' });

                                AppState.fileDirectory = dirPath;
                                AppState.filePath = fileName;
                                AppState.fileFullPath = lastOpened;
                                await loadFile(file, null);
                                restored = true;
                            }
                        } catch (err) {
                            console.error('[Init] Failed to restore last file:', err);
                        }
                    }

                    if (!restored) {
                        // 4. すべてなければサンプルを表示
                        await loadSampleContent();
                    }
                }
            }

            if (!AppState.fileDirectory) {
                try {
                    AppState.fileDirectory = await path.documentDir();
                } catch (e) { console.warn(e); }
            }
        } catch (e) {
            console.error('Tauri init error:', e);
            alert(t('app.tauriInitError') + ':\n' + e);
            await loadSampleContent();
        }
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        const fileParam = urlParams.get('file') || urlParams.get('url') || urlParams.get('filepath');
        const modeParam = urlParams.get('mode');
        let isSvgMode = modeParam === 'svg';

        if (fileParam) {
            try {
                if (typeof showToast === 'function') showToast(t('app.loadingFile'), "info");
                let decodedUrl = fileParam;
                try {
                    decodedUrl = decodeURIComponent(fileParam);
                } catch (e) {
                    console.warn('[Init] Browser URL decoding failed, using raw path:', e);
                }
                // [FIX] Upgrade HTTP to HTTPS to avoid Mixed Content error if app is loaded via HTTPS
                if (decodedUrl.startsWith('http://') && window.location.protocol === 'https:') {
                    decodedUrl = decodedUrl.replace(/^http:\/\//i, 'https://');
                }
                
                let text = "";
                // [FIX] file:///プロトコルでのCORSエラー回避のため、ロード済みBase64データを受け取る
                const transferKey = urlParams.get('transfer');
                if (transferKey) {
                    try {
                        const base64Data = sessionStorage.getItem(transferKey);
                        if (base64Data && base64Data.startsWith('data:image/')) {
                            const response = await fetch(base64Data);
                            text = await response.text();
                            sessionStorage.removeItem(transferKey);
                            console.log("[Init] Loaded SVG data from sessionStorage successfully.");
                        } else {
                            console.warn('[Init] sessionStorage data missing or invalid for key:', transferKey);
                        }
                    } catch (err) {
                        console.warn("[Init] Failed to load data from sessionStorage:", err);
                    }
                }

                // Fallback to normal fetch (works for http/https URLs, fails for file:// local paths)
                if (!text) {
                    const response = await fetch(decodedUrl);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    text = await response.text();
                }
                
                const fileName = decodedUrl.split('/').pop() || 'remote_file.md';

                if (fileName.toLowerCase().endsWith('.svg')) {
                    if (typeof formatSVGAsCodeBlock === 'function') {
                        text = await formatSVGAsCodeBlock(text);
                    } else {
                        text = "```svg\n" + text + "\n```";
                    }
                    if (!isSvgMode) isSvgMode = true;
                }

                setEditorText(text);
                AppState.text = text;
                AppState.filePath = fileName;

                // [FIX] ローカルパスの場合はフルパスを保持（Tauriでの上書き保存ダイアログ回避のため）
                if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://') && !decodedUrl.startsWith('data:')) {
                    AppState.fileFullPath = decodedUrl;
                    const lastSlashIdx = Math.max(decodedUrl.lastIndexOf('/'), decodedUrl.lastIndexOf('\\'));
                    if (lastSlashIdx >= 0) {
                        AppState.fileDirectory = decodedUrl.substring(0, lastSlashIdx);
                    }
                }


                // Switch to preview mode
                AppState.viewMode = 'preview-only';
                if (typeof applyViewMode === 'function') applyViewMode();
                if (typeof saveSettings === 'function') saveSettings();

                if (isSvgMode) {
                    AppState.isSvgMode = true;
                    AppState._pendingAutoSVGEdit = true;
                    if (typeof updateTitle === 'function') updateTitle();
                    if (typeof applyUIModeRestrictions === 'function') applyUIModeRestrictions();
                }

                if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers();
                if (typeof render === 'function') await render();
            } catch (err) {
                console.error('URL param load error (Browser):', err);
                if (typeof showToast === 'function') showToast(t('toast.fileReadError') + `: ${err.message}`, "error");
            }
        } else if (isSvgMode) {
            // ファイル指定がなく、mode=svg の場合：空のSVGを作成
            try {
                const previewW = (AppState.config && AppState.config.previewWidth) ? AppState.config.previewWidth : 820;
                const emptySvg = `<svg width="${previewW}" height="600" viewBox="0 0 ${previewW} 600" xmlns="http://www.w3.org/2000/svg"></svg>`;
                const text = "```svg\n" + emptySvg + "\n```";

                setEditorText(text);
                AppState.text = text;
                AppState.filePath = 'new_diagram.svg';
                AppState.viewMode = 'preview-only';
                AppState.isSvgMode = true;
                if (typeof applyViewMode === 'function') applyViewMode();
                if (typeof updateTitle === 'function') updateTitle();
                if (typeof applyUIModeRestrictions === 'function') applyUIModeRestrictions();

                AppState._pendingAutoSVGEdit = true;
                if (typeof render === 'function') await render();
            } catch (err) {
                console.error('SVG Mode initiation error (Browser):', err);
            }
        } else {
            const linkedFileLoaded = await checkLinkedFile();
            if (!linkedFileLoaded) {
                await loadSampleContent();
            }
        }
    }

    if (typeof updateTitle === 'function') updateTitle();
    if (UndoRedoManager) UndoRedoManager.updateButtons();
}

/**
 * Setup mutation observer to suppress Mermaid error divs
 */
function setupMermaidErrorSuppression() {
    const mermaidObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const isMermaidError =
                        (node.id && node.id.startsWith('dmermaid-')) ||
                        node.classList.contains('error-icon') ||
                        node.classList.contains('mermaid-error-display') ||
                        (node.textContent && node.textContent.includes('Syntax error in text'));

                    if (isMermaidError) {
                        const hasErrorContent = node.textContent.includes('Syntax error') ||
                            node.querySelector('svg[aria-roledescription="error"]');

                        if (hasErrorContent) {
                            if (node.style) {
                                node.style.display = 'none';
                                node.style.position = 'absolute';
                                node.style.width = '0';
                                node.style.height = '0';
                            }
                            if (node.parentNode) {
                                node.parentNode.removeChild(node);
                            } else {
                                node.remove();
                            }
                        }
                    }
                }
            }
        }
    });
    mermaidObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Check if the editor was opened via a link to a file
 */
async function checkLinkedFile() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromLink = urlParams.get('fromLink');

    if (fromLink === 'true') {
        try {
            const linkedDataStr = sessionStorage.getItem('mdEditor_linkedFile');
            if (linkedDataStr) {
                const linkedData = JSON.parse(linkedDataStr);
                if (Date.now() - linkedData.timestamp < 10000) {
                    setEditorText(linkedData.content);
                    AppState.text = linkedData.content;
                    AppState.filePath = linkedData.fileName;
                    sessionStorage.removeItem('mdEditor_linkedFile');
                    if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers();
                    if (typeof render === 'function') await render();
                    return true;
                }
            }
        } catch (e) {
            console.error('Linked file load error:', e);
        }
    }
    return false;
}

/**
 * Load sample content if no file is loaded
 */
async function loadSampleContent() {
    // [FIX] Use global constant from default_content.js instead of fetch to avoid CORS errors
    const sampleMarkdown = (typeof DEFAULT_CONTENT !== 'undefined')
        ? DEFAULT_CONTENT
        : `# Markdown Editor へようこそ\n\n(初期コンテンツを読み込めませんでした)`;

    if (typeof resetEditor === 'function') {
        resetEditor(sampleMarkdown);
    } else {
        setEditorText(sampleMarkdown);
    }
    AppState.text = sampleMarkdown;
    if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers();
    if (typeof render === 'function') await render();
}
