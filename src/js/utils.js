/**
 * Generic Utility Functions
 */

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * HTML Escape
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- IndexedDB Helper for Large Files (Fonts) ---
const DB_CONFIG = { name: 'MDEditor_DB', version: 1, store: 'fonts' };

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
                db.createObjectStore(DB_CONFIG.store);
            }
        };
    });
}

async function saveToDB(key, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.store, 'readwrite');
        const store = tx.objectStore(DB_CONFIG.store);
        const req = store.put(data, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function getFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.store, 'readonly');
        const store = tx.objectStore(DB_CONFIG.store);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// --- Directory Handle Persistence ---
async function saveDirectoryHandle(dirHandle) {
    if (window.__TAURI__) return; // Tauriではハンドル保存は不要（パスを使う）
    try {
        await saveToDB('last_directory_handle', dirHandle);
        console.log('Directory handle saved to IndexedDB');
    } catch (e) {
        console.error('Failed to save directory handle:', e);
    }
}

async function getSavedDirectoryHandle() {
    if (window.__TAURI__) return null;
    try {
        const handle = await getFromDB('last_directory_handle');
        if (handle && handle.kind === 'directory') {
            return handle;
        }
    } catch (e) {
        console.error('Failed to retrieve directory handle:', e);
    }
    return null;
}

async function clearDirectoryHandle() {
    if (window.__TAURI__) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.store, 'readwrite');
        const store = tx.objectStore(DB_CONFIG.store);
        const req = store.delete('last_directory_handle');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Verifies if the file is contained within the directory
 * @param {FileSystemDirectoryHandle} dirHandle 
 * @param {FileSystemFileHandle} fileHandle 
 * @returns {Promise<boolean>}
 */
async function verifyHandleRelationship(dirHandle, fileHandle) {
    if (!dirHandle || !fileHandle) return false;
    try {
        // resolve returns an array of directory names if found, or null if not found
        const path = await dirHandle.resolve(fileHandle);
        return path !== null;
    } catch (e) {
        console.warn('Error resolving handle relationship:', e);
        return false;
    }
}

async function requestDirectoryAccess(targetFileName = null) {
    // Only ask once per session
    if (AppState.fileDirectory) return true;

    // Tauri does not need permissions (handled by OS/Allowlist)
    if (AppState.tauri || window.__TAURI__) return true;

    if (!window.showDirectoryPicker) {
        alert(t('alert.noDirApiSupport'));
        return false;
    }

    // --- Try to use saved directory handle first (FAST PATH) ---
    try {
        let savedDirHandle = await getSavedDirectoryHandle();

        if (savedDirHandle) {
            // Verify relationship
            if (AppState.fileHandle) {
                const isRelated = await verifyHandleRelationship(savedDirHandle, AppState.fileHandle);
                if (!isRelated) {
                    console.log('Saved directory handle is not related to current file. Fallback to picker.');
                    // Treat as if no saved handle found
                    savedDirHandle = null;
                }
            }
        }

        if (savedDirHandle) {
            console.log('Saved directory handle found, attempting to open picker directly');

            // Direct open with startIn option
            const options = { mode: 'read' };
            // Check permission status
            const perm = await savedDirHandle.queryPermission({ mode: 'read' });

            if (perm === 'granted') {
                // Already granted (e.g. same session or persistent)
                AppState.fileDirectory = savedDirHandle;
                return true;
            }

            if (perm === 'prompt') {
                // Permission expired but handle valid - ask simply to renew
                console.log('Saved directory handle found, requesting permission renewal');
                const newPerm = await savedDirHandle.requestPermission({ mode: 'read' });
                if (newPerm === 'granted') {
                    AppState.fileDirectory = savedDirHandle;
                    if (typeof showToast === 'function') showToast(t('toast.directoryWait') + '"' + AppState.fileDirectory.name + '" へのアクセスが復元されました');
                    return true;
                }
                // If denied, fall through to picker
            }

            console.log('Saved directory handle permission not granted, falling back to picker');
            // Use saved handle as startIn only if permission is granted (unlikely here if we fell through, but safe check)

            try {
                const newHandle = await window.showDirectoryPicker(options);
                AppState.fileDirectory = newHandle;

                // Save again (updates timestamp/internal state if needed)
                await saveDirectoryHandle(AppState.fileDirectory);

                if (typeof showToast === 'function') showToast(t('toast.directoryWait') + '"' + AppState.fileDirectory.name + '" へのアクセスが許可されました');
                return true;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('User cancelled directory selection (fast path)');
                    return false;
                }
                console.warn('Fast path directory access failed:', e);
            }
        }
    } catch (err) {
        console.warn('Error checking saved directory:', err);
    }

    // --- Fallback: Show Directory Picker Directly (SLOW PATH) ---
    try {
        const options = { mode: 'read', startIn: 'documents' };

        // Set initial directory to current file's location if available
        if (AppState.fileHandle) {
            options.startIn = AppState.fileHandle;
        }

        console.log('Showing directory picker (fallback)');

        const newHandle = await window.showDirectoryPicker(options);
        AppState.fileDirectory = newHandle;

        console.log('Directory access granted (via picker):', AppState.fileDirectory.name);

        // Save for next time
        await saveDirectoryHandle(AppState.fileDirectory);

        if (typeof showToast === 'function') showToast(t('toast.directoryAccessGranted').replace('${name}', AppState.fileDirectory.name));
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('User cancelled directory selection');
            return false;
        } else {
            console.warn('Directory access failed:', e.message);
            alert(t('alert.dirAccessFailed') + e.message);
            return false;
        }
    }
}

async function resolveRelativePath(dirHandle, relativePath) {
    // Tauri Mode
    const tauri = AppState.tauri || window.__TAURI__;
    if (tauri) {
        try {
            const { path, fs } = tauri;
            const sep = (await path.sep) || (/^[a-zA-Z]:\\/.test(dirHandle) ? '\\' : '/');

            // dirHandle is treated as current directory path (string) in Tauri mode
            let cleanRelativePath = relativePath.replace(/\\/g, '/');
            if (cleanRelativePath.startsWith('./')) cleanRelativePath = cleanRelativePath.slice(2);

            // Handle parent directory (..) for Tauri
            const absolutePath = await path.join(dirHandle, cleanRelativePath);
            const fileName = await path.basename(absolutePath);

            return {
                name: fileName,
                kind: 'file',
                getFile: async () => {
                    const binary = await fs.readFile(absolutePath);
                    return new File([binary], fileName);
                }
            };
        } catch (e) {
            console.warn('Tauri path resolution failed:', e);
            return null;
        }
    }

    // Browser Mode (File System Access API)
    // relativePath is already decoded in processImages(), so don't decode again here

    // Split path into parts
    const parts = relativePath.split(/[/\\]/).filter(p => p && p !== '.');

    let currentDir = dirHandle;

    // Navigate through directory structure
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];

        if (part === '..') {
            // Parent directory - not supported by File System Access API
            console.warn('Parent directory (..) not supported');
            return null;
        }

        try {
            currentDir = await currentDir.getDirectoryHandle(part);
        } catch (e) {
            console.warn('Directory not found:', part);
            return null;
        }
    }

    // Get the file
    const fileName = parts[parts.length - 1];
    try {
        return await currentDir.getFileHandle(fileName);
    } catch (e) {
        // File not found - this is expected for missing images
        return null;
    }
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * @param {number} pos 
 * @returns {number} 0-6 (0はなし)
 */
function getNearestHeadingLevel(text, pos) {
    const lines = text.substring(0, pos).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        const match = line.match(/^(#{1,6})\s/);
        if (match) {
            return match[1].length;
        }
    }
    return 0;
}

async function insertImageAsBase64(file, clientX, clientY, target) {
    try {
        const isSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml';
        let saveLocation = AppState.config.imageSaveLocation || 'document'; // 'document' or 'local'
        let content = "";

        const insertToApp = (insertText) => {
            if (clientX !== undefined && clientY !== undefined && target !== undefined &&
                typeof window.insertTextAtDropPosition === 'function') {
                window.insertTextAtDropPosition(insertText, clientX, clientY, target);
                if (typeof render === 'function') render();
            } else if (typeof insertTextAtEditorCursor === 'function') {
                insertTextAtEditorCursor(insertText);
                if (typeof render === 'function') render();
            } else {
                console.error('[Utils] insertTextAtEditorCursor function not found!');
                if (typeof showToast === 'function') showToast(t('error.editorInitFailed'), 'error');
            }
        };

        // 別ファイル（ローカル）保存
        if (saveLocation === 'local') {
            const isTauriEnv = AppState.tauri || window.__TAURI__;

            if (!isTauriEnv) {
                // ===== ブラウザ版 =====
                // showDirectoryPicker 1回で「MDの保存 + 画像の保存」を完結させる。
                // ユーザーのペースト操作はジェスチャ内なのでそのまま showDirectoryPicker が呼べる。

                if (!window.showDirectoryPicker) {
                    if (typeof showToast === 'function')
                        showToast(t('error.noFolderApi'), 'error');
                    saveLocation = 'document';
                }

                if (saveLocation === 'local') {
                    // MDが未保存かどうかを判定（ブラウザでは明確なfileHandleの有無で判定）
                    const mdIsSaved = !!AppState.fileHandle;

                    try {
                        let dirHandle = null;

                        if (!mdIsSaved) {
                            // 要件1: MDファイル未保存の場合は、過去のアクセス権限を無視して必ずフォルダを確認する
                            if (typeof showToast === 'function') {
                                showToast(t('toast.selectFolderToSave'), 'info');
                            }
                            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                            await saveDirectoryHandle(dirHandle);
                        } else {
                            // 要件2: MDファイル保存済みの場合、現在のアクセス権限(dirHandle)がそのMDと適切かチェックする

                            // 1. AppState.fileDirectory を検証
                            if (AppState.fileDirectory) {
                                try {
                                    const perm = await AppState.fileDirectory.queryPermission({ mode: 'readwrite' });
                                    if (perm === 'granted') {
                                        const isRelated = await verifyHandleRelationship(AppState.fileDirectory, AppState.fileHandle);
                                        if (isRelated) dirHandle = AppState.fileDirectory;
                                    } else if (perm === 'prompt') {
                                        const isRelated = await verifyHandleRelationship(AppState.fileDirectory, AppState.fileHandle);
                                        if (isRelated) {
                                            const newPerm = await AppState.fileDirectory.requestPermission({ mode: 'readwrite' });
                                            if (newPerm === 'granted') dirHandle = AppState.fileDirectory;
                                        }
                                    }
                                } catch (_) { /* fall through */ }
                            }

                            // 2. IndexedDB の保存済みハンドルを検証
                            if (!dirHandle) {
                                const saved = await getSavedDirectoryHandle();
                                if (saved) {
                                    try {
                                        const perm = await saved.queryPermission({ mode: 'readwrite' });
                                        if (perm === 'granted') {
                                            const isRelated = await verifyHandleRelationship(saved, AppState.fileHandle);
                                            if (isRelated) dirHandle = saved;
                                        } else if (perm === 'prompt') {
                                            const isRelated = await verifyHandleRelationship(saved, AppState.fileHandle);
                                            if (isRelated) {
                                                const newPerm = await saved.requestPermission({ mode: 'readwrite' });
                                                if (newPerm === 'granted') dirHandle = saved;
                                            }
                                        }
                                    } catch (_) { /* fall through */ }
                                }
                            }

                            // 3. 関連するdirHandleが無い（別フォルダのMDファイルを開いている等）場合は、手動取得
                            if (!dirHandle) {
                                if (typeof showToast === 'function') {
                                    showToast(t('toast.grantFolderAccess').replace('${name}', AppState.fileHandle.name), 'info');
                                }
                                
                                const pickerOpts = { mode: 'readwrite', startIn: AppState.fileHandle };
                                dirHandle = await window.showDirectoryPicker(pickerOpts);

                                // 取得後、本当に同じフォルダ（親子関係）が含まれているか検証
                                const verified = await verifyHandleRelationship(dirHandle, AppState.fileHandle);
                                if (!verified) {
                                    throw new Error('MismatchDirectory');
                                }
                                await saveDirectoryHandle(dirHandle);
                            }
                        }

                        AppState.fileDirectory = dirHandle;

                        // MDが未保存の場合、選択したフォルダにデフォルト名で保存する
                        if (!mdIsSaved) {
                            const defaultMdName = AppState.filePath || 'document.md';
                            const editorText = typeof getEditorText === 'function' ? getEditorText() : '';
                            const blob = new Blob([editorText], { type: 'text/markdown' });
                            const mdFileHandle = await dirHandle.getFileHandle(defaultMdName, { create: true });
                            const mdWritable = await mdFileHandle.createWritable();
                            await mdWritable.write(blob);
                            await mdWritable.close();

                            AppState.fileHandle  = mdFileHandle;
                            AppState.filePath    = defaultMdName;
                            AppState.isModified  = false;
                            if (typeof updateTitle === 'function') updateTitle();
                            if (typeof showToast === 'function')
                                showToast(t('toast.savedWithDefaultName').replace('${name}', defaultMdName), 'success');
                        }

                        // 画像を image/ フォルダに保存
                        const imgDirHandle  = await dirHandle.getDirectoryHandle('image', { create: true });
                        const imgFileHandle = await imgDirHandle.getFileHandle(file.name, { create: true });
                        const writable      = await imgFileHandle.createWritable();
                        await writable.write(file);
                        await writable.close();

                    } catch (e) {
                        if (e.name === 'AbortError') {
                            if (typeof showToast === 'function') showToast(t('toast.folderSelectionCancelled'), 'warning');
                        } else {
                            console.error('Browser local save error:', e);
                            if (typeof showToast === 'function')
                                showToast(t('toast.localSaveFailedFallback'), 'warning');
                            saveLocation = 'document';
                        }
                        if (saveLocation === 'local' && e.name === 'AbortError') return; // キャンセルは中断
                    }
                }

            } else {
                // ===== Tauri 版 =====
                const { fs, path } = isTauriEnv;

                // Tauri では fileDirectory が常にパス文字列として設定されている
                const baseDir = AppState.fileDirectory;
                if (!baseDir) {
                    // 未保存の場合は先に saveFileAs で保存させる
                    if (typeof showToast === 'function')
                        showToast(t('toast.saveFirst'), 'warning');
                    if (typeof saveFileAs === 'function') await saveFileAs();
                    if (!AppState.fileDirectory) return;
                }

                try {
                    const imageDirPath = await path.join(AppState.fileDirectory, 'image');
                    const imagePath    = await path.join(imageDirPath, file.name);

                    const exists = await fs.exists(imageDirPath);
                    if (!exists) await fs.mkdir(imageDirPath, { recursive: true });

                    const buffer = await file.arrayBuffer();
                    await fs.writeFile(imagePath, new Uint8Array(buffer));
                } catch (e) {
                    console.error('Tauri file save error:', e);
                    saveLocation = 'document';
                }
            }

            if (saveLocation === 'local') {
                // ファイル名にスペースやカッコがある場合、Markdownの URL 部分をエンコードする
                // 例: transparent (24).png → image/transparent%20(24).png
                const encodedName = encodeURIComponent(file.name);
                const relativeImagePath = `image/${encodedName}`;
                // altテキストは元のファイル名、URL 部分はエンコード済みを使用
                content = `\n\n![${file.name}](${relativeImagePath})\n\n`;
                insertToApp(content);
                return;
            }
        }

        // 文書内（Base64/SVGコード等）保存モード（または fallback）
        if (saveLocation === 'document') {
            if (typeof showToast === 'function') showToast(t('toast.loadingImage').replace('${name}', file.name), "info");
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                let docContent = "";
                if (isSvg) {
                    let svgText = e.target.result;
                    svgText = await formatSVGAsCodeBlock(svgText, true);
                    docContent = `\n\n${svgText}\n\n`;
                } else {
                    const base64 = e.target.result;
                    docContent = `\n\n![${file.name}](${base64})\n\n`;
                }
                insertToApp(docContent);
            };

            if (isSvg) {
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
        }

    } catch (e) {
        console.error('File process error:', e);
        if (typeof showToast === 'function') showToast(t('error.imageReadSaveFailed'), 'error');
    }
}


/**
 * Find the first position where two texts differ
 */
function findFirstDifference(text1, text2) {
    const minLength = Math.min(text1.length, text2.length);
    for (let i = 0; i < minLength; i++) {
        if (text1[i] !== text2[i]) {
            return i;
        }
    }
    // If one text is a prefix of the other, return the shorter length
    if (text1.length !== text2.length) {
        return minLength;
    }
    return -1; // Texts are identical
}

/**
 * Scroll editor to show the specified text position
 */
function scrollToPosition(position) {
    try {
        if (typeof scrollToMatch === 'function') {
            // scrollToPosition is used by preview-inline-edit etc.
            // We need a way to scroll to absolute char position in CM6.
            // For now, let's try to find line/col.
            const text = getEditorText();
            const textBefore = text.substring(0, position);
            const lines = textBefore.split('\n');
            const lineNumber = lines.length;
            const column = lines[lines.length - 1].length;
            scrollToMatch(lineNumber - 1, column);
            return;
        }

        if (!DOM.editor) return;
        // Fallback
        DOM.editor.setSelectionRange(position, position);
        DOM.editor.focus();

        const textareaRect = DOM.editor.getBoundingClientRect();
        const textBeforePosition = DOM.editor.value.substring(0, position);
        const lineNumber = textBeforePosition.split('\n').length;
        const lineHeight = parseFloat(getComputedStyle(DOM.editor).lineHeight) || 24;
        const targetScrollTop = (lineNumber - 1) * lineHeight - (textareaRect.height / 2);
        DOM.editor.scrollTop = Math.max(0, targetScrollTop);
    } catch (e) {
        console.error('Failed to scroll to position:', e);
    }
}

/**
 * Update page title and header with filename
 */
function updateTitle() {
    const fileName = AppState.filePath;
    const isSvgMode = AppState.isSvgMode === true;
    const svgBadge = document.getElementById('svg-mode-badge');

    // SVGモードバッジの表示制御
    if (svgBadge) {
        svgBadge.style.display = isSvgMode ? 'inline-flex' : 'none';
    }

    // SVGモードプレフィックス
    const modePrefix = isSvgMode ? '[SVGモード] ' : '';

    if (fileName) {
        // Update page title
        document.title = `${modePrefix}${fileName} - Markdown Editor`;
        // Update header
        DOM.appTitle.textContent = fileName;
    } else {
        // Default titles
        document.title = `${modePrefix}Markdown Editor (Offline)`;
        DOM.appTitle.textContent = 'MD Editor';
    }

    // Tauri版: ネイティブウィンドウタイトルも更新
    const tauri = AppState.tauri || window.__TAURI__;
    if (tauri && tauri.window && tauri.window.getCurrentWindow) {
        try {
            const appWindow = tauri.window.getCurrentWindow();
            const titleText = fileName
                ? `${modePrefix}${fileName} - Markdown Editor`
                : `${modePrefix}Markdown Editor`;
            appWindow.setTitle(titleText).catch(() => {});
        } catch (e) { /* Tauri API unavailable */ }
    }
}

/**
 * Check if a link href is a relative path to a .md file
 */
function isRelativeMdLink(href) {
    if (!href) return false;

    // Exclude absolute URLs (http://, https://, //, etc.)
    if (/^(https?:)?\/\//i.test(href)) return false;

    // Exclude anchors (#...)
    if (href.startsWith('#')) return false;

    // Exclude mailto:, tel:, etc.
    if (/^[a-z]+:/i.test(href)) return false;

    // Check if it ends with .md or .markdown
    return /\.(md|markdown)$/i.test(href);
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function updateActiveOutlineItem() {
    // [Fix] Skip update during outline click scrolling
    if (window.outlineClickScrolling) {
        return;
    }

    if (!DOM.previewPane || !DOM.outlineContent) return;

    const scrollTop = DOM.previewPane.scrollTop;
    const headings = Array.from(DOM.preview.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    // Find the heading that is currently in view
    let currentHeading = null;
    for (const heading of headings) {
        if (heading.offsetTop <= scrollTop + 100) {
            currentHeading = heading;
        } else {
            break;
        }
    }

    // Update active class
    const items = DOM.outlineContent.querySelectorAll('.outline-item');
    items.forEach(item => item.classList.remove('active'));

    // [Fix] Editor-Only Mode Strategy
    if (AppState.viewMode === 'editor-only' && window.editorInstance) {
        if (typeof findHeadingIndexByLine === 'function') {
            const view = window.editorInstance;
            // Get approximate top line
            const topBlock = view.viewport.from;
            const topLine = view.state.doc.lineAt(topBlock).number;

            // Find active heading index
            const activeIndex = findHeadingIndexByLine(topLine);
            console.log(`[OutlineDebug] TopLine: ${topLine}, ActiveIndex: ${activeIndex}`);
            if (activeIndex !== -1 && items[activeIndex]) {
                items[activeIndex].classList.add('active');
                items[activeIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
        return; // Skip default logic
    }

    // Default Preview-Based Strategy
    if (currentHeading && currentHeading.id) {
        // Find active item by matching data-heading-id
        let activeItem = null;
        items.forEach(item => {
            if (item.dataset.headingId === currentHeading.id) {
                activeItem = item;
            }
        });

        if (activeItem) {
            activeItem.classList.add('active');
            // Scroll outline to keep active item visible
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

// Debounced version of updateActiveOutlineItem
const debouncedUpdateActiveOutlineItem = debounce(updateActiveOutlineItem, 50);

/**
 * Open linked Markdown file
 */
async function openLinkedMarkdownFile(relativePath) {
    console.log('[Utils] openLinkedMarkdownFile called with:', relativePath);
    // Tauri Mode Optimization
    const tauri = AppState.tauri || window.__TAURI__;
    if (tauri) {
        console.log('[Utils] Tauri mode detected for openLinkedMarkdownFile');
        const { path } = tauri;

        // Tauri v2 API adjustment for WebviewWindow
        // It moved from tauri.window to tauri.webviewWindow in some contexts, 
        // or strictly needs to be imported if using modules.
        // Checking global availability:
        let WebviewWindow;
        if (tauri.webviewWindow && tauri.webviewWindow.WebviewWindow) {
            WebviewWindow = tauri.webviewWindow.WebviewWindow;
        } else {
            console.error('Tauri WebviewWindow constructor not found (V2 only)');
            alert(t('alert.noNewWindowFeature'));
            return;
        }

        try {
            let baseDir = AppState.fileDirectory;
            if (!baseDir && AppState.fileFullPath) {
                try {
                    baseDir = await path.dirname(AppState.fileFullPath);
                    AppState.fileDirectory = baseDir; // Update state
                    console.log('[Utils] Derived baseDir from fileFullPath:', baseDir);
                } catch (e) {
                    console.warn('[Utils] Failed to derive baseDir from fileFullPath:', e);
                }
            }

            if (!baseDir) {
                console.warn('[Utils] Base directory unknown, cannot open linked file in Tauri.');
                // Determine if this is sample content
                if (!AppState.fileHandle && !AppState.fileDirectory) {
                    alert(t('alert.sampleLinkWarning'));
                } else {
                    alert(t('alert.noBaseDirForLink'));
                }
                return;
            }

            let decodedPath = relativePath;
            try { decodedPath = decodeURIComponent(relativePath); } catch (e) { console.warn('[Utils] Failed to decode relativePath:', e); }
            console.log('[Utils] Decoded relativePath:', decodedPath);

            const absolutePath = await path.join(baseDir, decodedPath);
            console.log('[Utils] Absolute path for new window:', absolutePath);

            const label = 'editor-' + Date.now();
            // index.html is likely a copy of MarkdownEditor.html in src-dist
            const url = 'index.html?filepath=' + encodeURIComponent(absolutePath);
            console.log('[Utils] Opening new Tauri WebviewWindow with URL:', url);

            const webview = new WebviewWindow(label, {
                url: url,
                title: 'Markdown Editor',
                width: 1200,
                height: 800
            });

        } catch (e) {
            console.error('Failed to open linked file in Tauri:', e);
            alert(t('alert.fileOpenFailed') + e.message);
        }
        return;
    }

    console.log('[Utils] Browser mode detected for openLinkedMarkdownFile');
    try {
        relativePath = decodeURIComponent(relativePath);
        console.log('[Utils] Decoded relativePath (browser):', relativePath);
    } catch (e) {
        console.warn('Failed to decode path:', relativePath, e);
    }

    const fileName = relativePath.split('/').pop();
    console.log('[Utils] Target fileName:', fileName);

    if (relativePath === './README.md' || relativePath === 'README.md') {
        console.log('[Utils] Attempting to open README.md');
        try {
            let dirHandle = AppState.fileDirectory;

            if (!dirHandle) {
                console.log('[Utils] No directory handle, requesting access for README.md');
                const granted = await requestDirectoryAccess('README.md');
                if (!granted) {
                    if (typeof showToast === 'function') showToast(t('error.dirAccessDenied'), "error");
                    return;
                }
                dirHandle = AppState.fileDirectory;
            }
            console.log('[Utils] Resolved dirHandle for README.md:', dirHandle);

            const fileHandle = await resolveRelativePath(dirHandle, 'README.md');
            if (!fileHandle) {
                if (typeof showToast === 'function') showToast(t('error.readmeNotFoundInFolder'), "error");
                return;
            }
            console.log('[Utils] Found fileHandle for README.md:', fileHandle.name);

            if (typeof showToast === 'function') showToast(t('toast.readingReadme'), "info");
            const file = await fileHandle.getFile();
            const text = await readFileAsText(file);
            console.log('[Utils] README.md content read successfully.');

            const linkData = {
                fileName: 'README.md',
                content: text,
                timestamp: Date.now()
            };
            sessionStorage.setItem('mdEditor_linkedFile', JSON.stringify(linkData));
            console.log('[Utils] README.md data saved to sessionStorage.');

            const url = 'index.html?filepath=' + encodeURIComponent('README.md');
            window.open(url, '_blank');

            if (typeof showToast === 'function') showToast(t('toast.readmeOpenedNewWin'));
            return;

        } catch (e) {
            console.error('Failed to load README.md:', e);
            if (typeof showToast === 'function') showToast(t('error.readmeReadFailed'), "error");
            return;
        }
    }

    if (!AppState.fileDirectory) {
        if (typeof showToast === 'function') showToast(t('toast.reqBaseFolderForLink'), "info");

        const granted = await requestDirectoryAccess(fileName);
        if (!granted) {
            if (typeof showToast === 'function') showToast(t('toast.linkOpenFailedNoFolder'), "warning");
            return;
        }
    }

    try {
        if (typeof showToast === 'function') showToast(t('toast.readingFileWait') + relativePath, "info");

        const fileHandle = await resolveRelativePath(AppState.fileDirectory, relativePath);

        if (!fileHandle) {
            if (typeof showToast === 'function') showToast(t('error.fileNotFoundSys') + relativePath, "error");
            return;
        }

        const file = await fileHandle.getFile();
        const text = await readFileAsText(file);

        const linkData = {
            fileName: file.name,
            content: text,
            timestamp: Date.now()
        };
        sessionStorage.setItem('mdEditor_linkedFile', JSON.stringify(linkData));

        const url = 'index.html?filepath=' + encodeURIComponent(relativePath);
        window.open(url, '_blank');

        if (typeof showToast === 'function') showToast(t('toast.fileOpenedNewWin').replace('${file.name}', file.name));

    } catch (e) {
        console.error('Failed to open linked file:', e);
        if (typeof showToast === 'function') showToast(t('error.fileOpenFailedMsg') + e.message, "error");
    }
}

/**
 * エディタとプレビューペインの間のリサイズバーのドラッグ機能を追加
 */
function bindResize() {
    if (!DOM.resizeBar || !DOM.editorPane) {
        console.warn('リサイズ要素が見つかりません');
        return;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    // マウスダウンでドラッグ開始
    DOM.resizeBar.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;

        // 現在の幅を取得
        const rect = DOM.editorPane.getBoundingClientRect();
        startWidth = rect.width;

        // ドラッグ中のスタイルを適用
        DOM.resizeBar.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // テキスト選択を防止

        e.preventDefault();
    });

    // マウス移動でリサイズ
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const mainWidth = document.querySelector('main.split').getBoundingClientRect().width;
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;

        // 幅を20%～80%の範囲に制限
        const minWidth = mainWidth * 0.2;
        const maxWidth = mainWidth * 0.8;
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        // パーセンテージに変換
        const widthPercent = (clampedWidth / mainWidth) * 100;

        // エディタペインの幅を設定
        DOM.editorPane.style.flex = `0 0 ${widthPercent}%`;

        // 設定を保存
        AppState.config.splitRatio = Math.round(widthPercent);

        e.preventDefault();
    });

    // マウスアップでドラッグ終了
    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        DOM.resizeBar.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 設定を保存
        if (typeof saveSettings === 'function') {
            saveSettings();
        }

        if (window.editorInstance && typeof window.editorInstance.requestMeasure === 'function') {
            setTimeout(() => window.editorInstance.requestMeasure(), 10);
        }
    });
}

/**
 * サイドバー（アウトライン・SVGリスト）のリサイズ機能をバインド
 */
function bindSidebarResize() {
    const setupResize = (panelId, handleClass, configKey, isRight) => {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        const handle = panel.querySelector(handleClass);
        if (!handle) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.getBoundingClientRect().width;

            handle.classList.add('resizing');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            // 右側のパネル（SVGリスト）の場合はマウスが左に動くと幅が増える
            const newWidth = isRight ? (startWidth - deltaX) : (startWidth + deltaX);

            // 150px ～ 600px の範囲に制限
            const clampedWidth = Math.max(150, Math.min(600, newWidth));

            // 設定を更新して反映
            AppState.config[configKey] = clampedWidth;
            if (typeof applySidebarWidths === 'function') {
                applySidebarWidths();
            }
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            handle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            if (typeof saveSettings === 'function') {
                saveSettings();
            }
        });
    };

    // アウトラインパネル（左側）
    setupResize('outline-panel', '.outline-resize-handle', 'sidebarOutlineWidth', false);
    // SVGリストパネル（右側）
    setupResize('svg-list-panel', '.outline-resize-handle', 'sidebarSvgListWidth', true);
}

/**
 * Make an element draggable using a specific handle
 * @param {HTMLElement} element The element to move
 * @param {HTMLElement} handle The element that triggers the drag (header)
 */
function makeElementDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;

        // Don't start drag if clicking on interactive elements (inputs, selects, buttons, etc.)
        const interactiveTags = ['INPUT', 'SELECT', 'OPTION', 'BUTTON', 'TEXTAREA'];
        if (interactiveTags.includes(e.target.tagName) || e.target.closest('button, input, select')) {
            return;
        }

        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        element.style.margin = "0";
        element.style.transform = "none";
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}


/**
 * Download a Blob as a file
 * @param {Blob} blob - The Blob to download
 * @param {string} fileName - The default file name
 */
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * SVG文字列を解析し、必要に応じてリサイズしてMarkdownコードブロックとして返す
 * @param {string} svgText - 元のSVG文字列
 * @param {boolean} wrap - コードブロックで囲むかどうか (default: true)
 * @returns {Promise<string>} - フォーマットされたSVG文字列（またはコードブロック）
 */
async function formatSVGAsCodeBlock(svgText, wrap = true) {
    let result = svgText;
    try {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = svgDoc.querySelector('svg');

        if (svgEl) {
            let width = parseFloat(svgEl.getAttribute('width'));
            let height = parseFloat(svgEl.getAttribute('height'));
            let viewBox = svgEl.getAttribute('viewBox');

            // viewBoxから情報の補完
            if ((isNaN(width) || isNaN(height)) && viewBox) {
                const vbParts = viewBox.split(/[ ,]+/).map(parseFloat);
                if (vbParts.length === 4) {
                    if (isNaN(width)) width = vbParts[2];
                    if (isNaN(height)) height = vbParts[3];
                }
            }

            // 完全なデフォルト値の適用（設計書：previewWidth x 600）
            const defaultW = (typeof AppState !== 'undefined' && AppState.config && AppState.config.previewWidth) ? AppState.config.previewWidth : 820;
            const defaultH = 600;

            if (isNaN(width) && isNaN(height) && !viewBox) {
                width = defaultW;
                height = defaultH;
                svgEl.setAttribute('width', width.toString());
                svgEl.setAttribute('height', height.toString());
                svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
            } else {
                // 片方だけある場合の補完
                if (isNaN(width) && !isNaN(height)) width = height;
                else if (!isNaN(width) && isNaN(height)) height = width;
            }

            // サイズ制限（previewWidth x 600）とスケーリング
            const MAX_W = defaultW;
            const MAX_H = defaultH;

            if (width > MAX_W || height > MAX_H) {
                const ratio = Math.min(MAX_W / width, MAX_H / height);
                const newW = Math.round(width * ratio);
                const newH = Math.round(height * ratio);

                svgEl.setAttribute('width', newW.toString());
                svgEl.setAttribute('height', newH.toString());

                // viewBoxがない場合は元のサイズを保持させるために設定しておく
                if (!svgEl.getAttribute('viewBox')) {
                    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
                }
            }

            // 再シリアライズ
            const serializer = new XMLSerializer();
            result = serializer.serializeToString(svgDoc);
        }
    } catch (err) {
        console.warn('[formatSVGAsCodeBlock] Failed to format SVG:', err);
    }

    return wrap ? "```svg\n" + result + "\n```" : result;
}
window.formatSVGAsCodeBlock = formatSVGAsCodeBlock;
