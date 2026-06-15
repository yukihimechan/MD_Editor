/**
 * Text Export Logic
 */

/**
 * プレビューエリアからテキストを抽出する
 * インデント、リスト記号(・)、H2改行、罫線テーブルを再現する
 */
function getPreviewText() {
    const preview = document.getElementById('preview');
    if (!preview) return "";

    /**
     * DOMノードを再帰的に処理してテキストを構築する
     */
    function walk(node, indentLevel = 0, context = null) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return "";
        }

        // 不要な要素をスキップ
        if (node.matches('.copy-button, .mermaid-save-button, .katex-html, .preview-edit-button, .foldable-summary, script, style')) {
            return "";
        }

        // 図形表示(SVG)は要求によりスキップ
        if (node.tagName.toLowerCase() === 'svg' || node.closest('svg')) {
            return "";
        }

        let text = "";
        const tagName = node.tagName.toLowerCase();

        // テーブルの特別処理
        if (tagName === 'table') {
            return formatTable(node) + "\n\n";
        }

        // ブロック要素の判定
        const isBlock = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'blockquote', 'pre', 'ul', 'ol'].includes(tagName);

        // H2の見出しの前に改行を追加
        if (tagName === 'h2') {
            text += "\n";
        }

        // 子ノードを再帰的に処理
        let childText = "";
        let liIndex = 1;
        node.childNodes.forEach(child => {
            // リスト内の不要な空白テキストノード（改行文字など）をスキップ
            if ((tagName === 'ul' || tagName === 'ol') &&
                child.nodeType === Node.TEXT_NODE &&
                !child.textContent.trim()) {
                return;
            }

            // 子へのコンテキスト（olの場合は番号）とインデントの引き継ぎ
            let subContext = null;
            if (tagName === 'ol') {
                subContext = { index: liIndex++ };
            }

            // リスト構造（ul/ol）に入るときにインデントレベルを上げる
            const nextLevel = (tagName === 'ul' || tagName === 'ol') ? indentLevel + 1 : indentLevel;
            childText += walk(child, nextLevel, subContext);
        });

        if (tagName === 'li') {
            // インデントの付与（indentLevel 1 = 0階層, 2 = 1階層...と計算）
            const indentStr = "  ".repeat(Math.max(0, indentLevel - 1));
            let bullet = "・ ";
            if (context && context.index !== undefined) {
                bullet = `${context.index}. `;
            }
            // 行頭の空白（インデント）を壊さないよう、改行のみをトリムする
            const cleanContent = childText.replace(/^[\r\n]+|[\r\n]+$/g, '');
            text += indentStr + bullet + cleanContent + "\n";
        } else if (tagName === 'ul' || tagName === 'ol') {
            // リストコンテナ自体は前後を trim せず、子(li)の出力をそのまま繋げる
            text += childText + "\n";
        } else if (isBlock) {
            // 一般的なブロック要素
            text += childText.trim() + "\n\n";
        } else {
            // インライン要素
            text += childText;
        }

        return text;
    }

    const result = walk(preview);
    return result.trim().replace(/\n{3,}/g, '\n\n');
}

/**
 * テーブル要素を罫線を用いたテキスト形式に変換する
 */
function formatTable(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return "";

    const data = rows.map(tr => {
        return Array.from(tr.querySelectorAll('th, td')).map(td => td.textContent.trim());
    });

    const colWidths = [];
    data.forEach(row => {
        row.forEach((cell, i) => {
            const width = getVisualWidth(cell);
            colWidths[i] = Math.max(colWidths[i] || 0, width);
        });
    });

    function getVisualWidth(str) {
        let width = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if ((code >= 0x00 && code < 0x81) || (code === 0xf8f0) || (code >= 0xff61 && code <= 0xff9f)) {
                width += 1;
            } else {
                width += 2;
            }
        }
        return width;
    }

    function pad(str, width) {
        const currentWidth = getVisualWidth(str);
        const diff = width - currentWidth;
        return str + " ".repeat(Math.max(0, diff));
    }

    let output = "";
    output += "┌" + colWidths.map(w => "─".repeat(w + 2)).join("┬") + "┐\n";

    data.forEach((row, rowIndex) => {
        output += "│ " + row.map((cell, i) => pad(cell, colWidths[i])).join(" │ ") + " │\n";
        if (rowIndex < data.length - 1) {
            output += "├" + colWidths.map(w => "─".repeat(w + 2)).join("┼") + "┤\n";
        }
    });

    output += "└" + colWidths.map(w => "─".repeat(w + 2)).join("┴") + "┘";
    return output;
}

/**
 * テキストをファイルに出力する
 */
async function exportTextToFile() {
    const text = getPreviewText();
    if (!text) {
        if (typeof showToast === 'function') showToast(t('toast.noContent'), "error");
        return;
    }

    try {
        if (window.__TAURI__) {
            const { dialog, fs } = window.__TAURI__;
            const targetPath = await dialog.save({
                defaultPath: 'export.txt',
                filters: [{ name: 'Text Files', extensions: ['txt'] }]
            });
            if (targetPath) {
                await fs.writeTextFile(targetPath, text);
                if (typeof showToast === 'function') showToast(t('toast.textSaved'));
            }
            return;
        }

        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'export.txt',
                types: [{ description: 'Text File', accept: { 'text/plain': ['.txt'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
            if (typeof showToast === 'function') showToast(t('toast.textSaved'));
        } else {
            const blob = new Blob([text], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'export.txt';
            a.click();
            if (typeof showToast === 'function') showToast(t('toast.textSaved'));
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Text export failed:', e);
            if (typeof showToast === 'function') showToast(t('toast.exportError'), "error");
        }
    }
}

async function exportTextToClipboard() {
    const text = getPreviewText();
    if (!text) {
        if (typeof showToast === 'function') showToast(t('toast.noContent'), "error");
        return;
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            if (typeof showToast === 'function') showToast(t('toast.textCopied'));
        } else {
            throw new Error("Clipboard API not available");
        }
    } catch (e) {
        console.error('Clipboard copy failed:', e);
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            if (typeof showToast === 'function') showToast(t('toast.textCopied'));
        } catch (err) {
            if (typeof showToast === 'function') showToast(t('toast.textCopyFailed'), "error");
        }
    }
}

window.exportTextToFile = exportTextToFile;
window.exportTextToClipboard = exportTextToClipboard;
