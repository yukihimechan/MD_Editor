/**
 * Editor File I/O & Drag-Drop Actions
 */

// --- File I/O Bindings ---

function bindDragDrop() {
    // [FIX] Use document and capture phase to ensure we intercept events before CodeMirror
    document.addEventListener('dragover', (e) => {
        // もしアウトラインのドラッグ中なら、このグローバルハンドラでは何もしない（個別の要素に任せる）
        if (typeof outlineDragData !== 'undefined' && outlineDragData) {
            return;
        }

        e.preventDefault();
        // e.stopPropagation(); // [FIX] これが子要素（アウトライン等）のイベントを遮断していたため削除

        // Explicitly show copy cursor for files
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
    }, true);

    document.addEventListener('drop', async (e) => {
        // もしアウトラインのドラッグ中なら、このグローバルハンドラでは何もしない（個別の要素に任せる）
        if (typeof outlineDragData !== 'undefined' && outlineDragData) {
            return;
        }

        // [FIX] SVG編集中のファイルドロップ処理 (Browser環境用)
        if (window.currentEditingSVG && window.currentEditingSVG.draw) {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;

            const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
            const isImage = file.type.startsWith('image/');
            
            if (isSvg || isImage) {
               const container = window.currentEditingSVG.container;
               const rect = container.getBoundingClientRect();
               const draw = window.currentEditingSVG.draw;
               const dropPoint = draw.point(e.clientX - rect.left, e.clientY - rect.top);
               
               const reader = new FileReader();
               reader.onload = (event) => {
                   const content = event.target.result;
                   if (isSvg) {
                       if (typeof importSVGContent === 'function') importSVGContent(content, dropPoint);
                   } else {
                       if (typeof importImageAsBase64 === 'function') importImageAsBase64(content, dropPoint);
                   }
               };
               if (isSvg) reader.readAsText(file);
               else reader.readAsDataURL(file);
            }
            return;
        }

        e.preventDefault();
        // e.stopPropagation(); // [FIX] これが子要素（アウトライン等）のイベントを遮断していたため削除

        // Tauri Environment: Let app.js (tauri://file-drop) handle it for full path access
        if (window.__TAURI__) {
            return;
        }

        // Browser Environment: Handle File API
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const isImage = file.type.startsWith('image/') ||
            file.name.toLowerCase().endsWith('.svg') ||
            file.type === 'image/svg+xml';

        if (isImage) {
            // [FIX] 画像ドロップ時は fileDirectory をリセットしない（Base64に変換するので不要）
            // ドロップ座標とターゲット要素を渡して、適切な位置に挿入する
            if (typeof insertImageAsBase64 === 'function') {
                await insertImageAsBase64(file, e.clientX, e.clientY, e.target);
            }
            return;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'txt';
        const commonCodeExts = ['js', 'ts', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'swift', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sh', 'sql'];

        if (!isMarkdown && (commonCodeExts.includes(ext) || (typeof Prism !== 'undefined' && Prism.languages[ext]))) {
            const text = await readFileAsText(file);
            const fileName = file.name;
            const codeBlockText = `\n${fileName}\n\`\`\`${ext}\n${text}\n\`\`\`\n`;

            if (typeof window.insertTextAtDropPosition === 'function') {
                // Determine drop position in CodeMirror
                window.insertTextAtDropPosition(codeBlockText, e.clientX, e.clientY, e.target);
            } else if (window.editorInstance) {
                const pos = window.editorInstance.state.selection.main.head;
                window.editorInstance.dispatch({
                    changes: { from: pos, insert: codeBlockText },
                    selection: { anchor: pos + codeBlockText.length }
                });
            }
            if (typeof showToast === 'function') showToast(`コードを展開しました: ${fileName}`);
            return;
        }

        // Markdownファイル等をドロップした場合のみ fileDirectory をリセット
        AppState.fileDirectory = null;
        console.log('[ImageDrop][Debug] fileDirectory を null にリセット（Markdownドロップ用）');

        let handle = null;
        try {
            if (e.dataTransfer.items) {
                const item = [...e.dataTransfer.items].find(i => i.kind === 'file');
                if (item && item.getAsFileSystemHandle) {
                    handle = await item.getAsFileSystemHandle();
                }
            }
        } catch (e) { }

        await loadFile(file, handle);
        if (typeof updateTitle === 'function') updateTitle();
    }, true);
}

async function loadFile(file, handle = null) {
    if (file.size > 10 * 1024 * 1024) {
        if (typeof showToast === 'function') showToast(t('toast.fileTooLarge'), "error");
        return;
    }
    try {
        const text = await readFileAsText(file);
        if (typeof resetSearch === 'function') resetSearch();
        clearTimeout(debounceTimer); // Clear global debounce timer

        // Reset editor state (clears history)
        if (typeof resetEditor === 'function') resetEditor(text);

        // AppState.text is sync'd inside updateListener now, but for safety:
        AppState.text = text;

        AppState.filePath = file.name;
        AppState.fileHandle = handle;
        AppState.isModified = false;
        if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers();
        if (typeof render === 'function') await render();
        if (typeof showToast === 'function') showToast(`${t('toast.fileOpened').replace('ファイルを開きました', '読み込み完了')}: ${file.name}`);

        // Save current file path for auto-load on restart/reload (Tauri)
        // Use sessionStorage so it only persists for F5 reload, not app restart
        if (AppState.fileFullPath) {
            sessionStorage.setItem('lastOpenedFilePath', AppState.fileFullPath);
        }

        // Restore scroll position (Tauri F5 Support) or scroll to top
        if (typeof restoreScrollPosition === 'function') {
            console.log('[ScrollDebug] Calling restoreScrollPosition from loadFile'); // DEBUG
            restoreScrollPosition();
        } else {
            console.warn('[ScrollDebug] restoreScrollPosition function not found'); // DEBUG
            if (window.editorInstance && window.editorInstance.scrollDOM) window.editorInstance.scrollDOM.scrollTop = 0;
        }
    } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') showToast(t('toast.fileReadError'), "error");
    }
}

/**
 * Open file by absolute path (for Tauri)
 */
async function openFileByPath(filePath) {
    if (!window.__TAURI__) return;
    try {
        const { fs, path } = window.__TAURI__;
        const text = await fs.readTextFile(filePath);
        const fileName = await path.basename(filePath);
        const dirPath = await path.dirname(filePath);

        const file = new File([text], fileName, { type: 'text/markdown' });



        AppState.fileDirectory = dirPath;
        AppState.filePath = fileName;
        AppState.fileFullPath = filePath;
        await loadFile(file, null);

        if (typeof updateTitle === 'function') updateTitle();
        if (typeof showToast === 'function') showToast(`ファイルを開きました: ${fileName}`);
    } catch (err) {
        console.error('Failed to open file by path:', err);
        if (typeof showToast === 'function') showToast(t('toast.fileOpenError'), "error");
    }
}
window.openFileByPath = openFileByPath;

async function newFile() {
    // 未保存の変更がある場合は確認
    if (AppState.isModified) {
        const confirmMsg = '現在のドキュメントに未保存の変更があります。破棄して新規作成しますか？';
        if (!confirm(confirmMsg)) {
            return;
        }
    }

    if (window.editorInstance) {
        window.editorInstance.dispatch({
            changes: { from: 0, to: window.editorInstance.state.doc.length, insert: "" }
        });
    }

    AppState.text = "";
    AppState.filePath = null;
    AppState.fileHandle = null;
    AppState.fileFullPath = null;
    AppState.isModified = false;

    if (typeof updateTitle === 'function') updateTitle();
    if (typeof render === 'function') render();
    if (typeof showToast === 'function') showToast(t('toast.newFile'));
}
window.newFile = newFile; // Global alias

async function openFile() {
    // 未保存の変更がある場合は確認
    if (AppState.isModified) {
        const confirmMsg = '現在のドキュメントに未保存の変更があります。破棄して別のファイルを開きますか？';
        if (!confirm(confirmMsg)) {
            return;
        }
    }

    try {
        // Tauri Environment
        if (window.__TAURI__) {
            const { dialog, fs, path } = window.__TAURI__;
            const selected = await dialog.open({
                multiple: false,
                filters: [{
                    name: 'Markdown',
                    extensions: ['md', 'markdown', 'txt']
                }]
            });

            if (selected) {
                const filePath = Array.isArray(selected) ? selected[0] : selected;
                const text = await fs.readTextFile(filePath);
                const fileName = await path.basename(filePath);
                const dirPath = await path.dirname(filePath);

                const file = new File([text], fileName, { type: 'text/markdown' });

                AppState.fileDirectory = dirPath;
                await loadFile(file, null);

                AppState.filePath = fileName;
                AppState.fileFullPath = filePath;

                if (typeof updateTitle === 'function') updateTitle();
                if (typeof showToast === 'function') showToast(`ファイルを開きました: ${fileName}`);
            }
            return;
        }

        // Browser Environment (File System Access API)
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Markdown Files',
                    accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] }
                }],
                multiple: false
            });
            const file = await handle.getFile();
            await loadFile(file, handle);
            if (typeof updateTitle === 'function') updateTitle();
            return;
        }

        // Fallback for older browsers
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) await loadFile(file);
        };
        input.click();
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Failed to open file:', e);
            if (typeof showToast === 'function') showToast("ファイルを開けませんでした", "error");
        }
    }
}

async function saveFile() {
    // SVGモードの場合はSVG保存処理へ
    if (AppState.isSvgMode) {
        return await saveSvgMode('save');
    }

    const text = typeof getEditorText === 'function' ? getEditorText() : "";

    try {
        // Tauri Environment
        if (window.__TAURI__) {
            const { dialog, fs, path } = window.__TAURI__;
            let targetPath = AppState.fileFullPath;

            if (!targetPath) {
                targetPath = await dialog.save({
                    defaultPath: AppState.filePath || 'document.md',
                    filters: [{
                        name: 'Markdown',
                        extensions: ['md', 'markdown']
                    }]
                });
            }

            if (targetPath) {
                await fs.writeTextFile(targetPath, text);

                // Update state if it was a new file
                if (!AppState.fileFullPath) {
                    AppState.fileFullPath = targetPath;
                    AppState.filePath = await path.basename(targetPath);
                    AppState.fileDirectory = await path.dirname(targetPath);
                    if (typeof updateTitle === 'function') updateTitle();
                }

                AppState.isModified = false;
                if (typeof showToast === 'function') showToast("保存しました");
            }
            return;
        }

        // Browser Environment
        const blob = new Blob([text], { type: 'text/markdown' });
        if (window.showSaveFilePicker) {
            if (AppState.fileHandle) {
                const writable = await AppState.fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                if (typeof showToast === 'function') showToast("保存しました (上書き)");
            } else {
                const handle = await window.showSaveFilePicker({
                    suggestedName: AppState.filePath || 'document.md',
                    types: [{
                        description: 'Markdown File',
                        accept: { 'text/markdown': ['.md', '.markdown'] }
                    }]
                });
                AppState.fileHandle = handle;
                AppState.filePath = handle.name;
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                if (typeof updateTitle === 'function') updateTitle();
                if (typeof showToast === 'function') showToast("保存しました");
            }
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = AppState.filePath || 'document.md';
            a.click();
            if (typeof showToast === 'function') showToast("保存しました (ダウンロード)");
        }
        AppState.isModified = false;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            if (typeof showToast === 'function') showToast("保存に失敗しました", "error");
        }
    }
}

async function saveFileAs() {
    // SVGモードの場合はSVGの別名保存処理へ
    if (AppState.isSvgMode) {
        return await saveSvgMode('save-as');
    }

    const text = typeof getEditorText === 'function' ? getEditorText() : "";

    try {
        // Tauri Environment
        if (window.__TAURI__) {
            const { dialog, fs, path } = window.__TAURI__;

            // 常に新しいファイル名を尋ねる
            const targetPath = await dialog.save({
                defaultPath: AppState.filePath || 'document.md',
                filters: [{
                    name: 'Markdown',
                    extensions: ['md', 'markdown']
                }]
            });

            if (targetPath) {
                await fs.writeTextFile(targetPath, text);

                // 状態を更新
                AppState.fileFullPath = targetPath;
                AppState.filePath = await path.basename(targetPath);
                AppState.fileDirectory = await path.dirname(targetPath);
                AppState.isModified = false;

                if (typeof updateTitle === 'function') updateTitle();
                if (typeof showToast === 'function') showToast("別名で保存しました");
            }
            return;
        }

        // Browser Environment
        const blob = new Blob([text], { type: 'text/markdown' });
        if (window.showSaveFilePicker) {
            // 常に新しいファイル名を尋ねる
            const handle = await window.showSaveFilePicker({
                suggestedName: AppState.filePath || 'document.md',
                types: [{
                    description: 'Markdown File',
                    accept: { 'text/markdown': ['.md', '.markdown'] }
                }]
            });

            AppState.fileHandle = handle;
            AppState.filePath = handle.name;
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            AppState.isModified = false;

            if (typeof updateTitle === 'function') updateTitle();
            if (typeof showToast === 'function') showToast("別名で保存しました");
        } else {
            // フォールバック
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = AppState.filePath || 'document.md';
            a.click();
            if (typeof showToast === 'function') showToast("別名で保存しました (ダウンロード)");
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            if (typeof showToast === 'function') showToast("保存に失敗しました", "error");
        }
    }
}

/**
 * SVGテキストから ```svg...``` 内のコンテンツを抽出する
 * @param {string} text - エディターのテキスト全体
 * @returns {{ svgText: string, hasExtraContent: boolean } | null}
 */
function extractSvgContent(text) {
    const match = text.match(/```svg\s*\n([\s\S]*?)\n```/);
    if (!match) return null;
    const svgText = match[1];
    // コードブロック外側にテキストがあるかチェック
    const outside = text.replace(/```svg\s*\n[\s\S]*?\n```/, '').trim();
    return {
        svgText,
        hasExtraContent: outside.length > 0
    };
}

/**
 * SVGモード時の保存処理
 * @param {'save'|'save-as'} mode
 */
async function saveSvgMode(mode) {
    console.log(`[SVGMode] saveSvgMode called with mode='${mode}'`);
    console.log(`[SVGMode] State: isTauri=${!!window.__TAURI__}, fileFullPath=${AppState.fileFullPath}, hasFileHandle=${!!AppState.fileHandle}`);
    
    const text = typeof getEditorText === 'function' ? getEditorText() : '';
    const result = extractSvgContent(text);

    // SVGコードブロックが見つからない場合
    if (!result) {
        if (typeof showToast === 'function') showToast('SVGコードブロックが見つかりません。保存をキャンセルしました。', 'error');
        return;
    }

    // コードブロック外側にコンテンツがある場合は確認ダイアログ
    if (result.hasExtraContent) {
        const confirmed = window.confirm(
            'SVGコードブロックの外側にコンテンツがあります。\n' +
            'コードブロック外の内容は保存されませんが、SVGとして保存してよろしいですか？'
        );
        if (!confirmed) return;
    }

    const svgText = result.svgText;

    try {
        // Tauri版
        if (window.__TAURI__) {
            const { dialog, fs, path } = window.__TAURI__;

            let targetPath = AppState.fileFullPath;

            // 別名保存、またはパス未設定の場合ダイアログ表示
            if (mode === 'save-as' || !targetPath) {
                targetPath = await dialog.save({
                    defaultPath: AppState.filePath || 'diagram.svg',
                    filters: [{ name: 'SVG画像', extensions: ['svg'] }]
                });
            }

            if (!targetPath) return; // キャンセル

            await fs.writeTextFile(targetPath, svgText);
            AppState.fileFullPath = targetPath;
            AppState.filePath = await path.basename(targetPath);
            AppState.fileDirectory = await path.dirname(targetPath);
            AppState.isModified = false;

            if (typeof updateTitle === 'function') updateTitle();
            const msg = mode === 'save-as' ? '別名で保存しました' : '保存しました';
            if (typeof showToast === 'function') showToast(msg);
            return;
        }

        // ブラウザ版
        const blob = new Blob([svgText], { type: 'image/svg+xml' });
        if (window.showSaveFilePicker) {
            const useExisting = (mode === 'save') && AppState.fileHandle;
            if (useExisting) {
                // 上書き
                console.log('[SVGMode] Using existing AppState.fileHandle to overwrite.');
                const writable = await AppState.fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                AppState.isModified = false;
                if (typeof showToast === 'function') showToast('保存しました (上書き)');
            } else {
                // 新規 or 別名
                console.log(`[SVGMode] Prompting showSaveFilePicker. mode='${mode}', hasFileHandle=${!!AppState.fileHandle}`);
                const handle = await window.showSaveFilePicker({
                    suggestedName: AppState.filePath || 'diagram.svg',
                    types: [{
                        description: 'SVG画像',
                        accept: { 'image/svg+xml': ['.svg'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                AppState.fileHandle = handle;
                AppState.filePath = handle.name;
                AppState.isModified = false;
                if (typeof updateTitle === 'function') updateTitle();
                const msg = mode === 'save-as' ? '別名で保存しました' : '保存しました';
                if (typeof showToast === 'function') showToast(msg);
            }
        } else {
            // フォールバック: ダウンロード
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = AppState.filePath || 'diagram.svg';
            a.click();
            if (typeof showToast === 'function') showToast('保存しました (ダウンロード)');
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('[SVGMode] Save error:', e);
            if (typeof showToast === 'function') showToast('SVGの保存に失敗しました', 'error');
        }
    }
}

async function newWindow() {
    const isTauri = !!window.__TAURI__;
    console.log(`[Editor] newWindow called. Env: ${isTauri ? 'Tauri' : 'Browser'}`);

    try {
        if (isTauri) {
            // Tauri v2: WebviewWindow
            const { webviewWindow } = window.__TAURI__;
            if (!webviewWindow || !webviewWindow.WebviewWindow) {
                console.error('[Editor] Tauri WebviewWindow API not found');
                alert('新しいウィンドウを開くための API が見つかりません。');
                return;
            }

            const label = `win_${Date.now()}`;
            console.log(`[Editor] Opening WebviewWindow with label: ${label}`);
            const webview = new webviewWindow.WebviewWindow(label, {
                title: 'Markdown Editor',
                width: 1200,
                height: 800
            });

            webview.once('tauri://error', (e) => {
                console.error('[Editor] Tauri WebviewWindow error:', e);
            });
        } else {
            const url = window.location.href.split('?')[0];
            console.log(`[Editor] Browser window.open. URL: ${url}`);
            window.open(url, '_blank');
        }
    } catch (err) {
        console.error('[Editor] newWindow catch error:', err);
        window.open(window.location.href, '_blank');
    }
}
window.newWindow = newWindow;

// insertImageAsBase64 は utils.js に実装があるため、ここでは定義しない
