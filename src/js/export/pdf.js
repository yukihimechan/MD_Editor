/**
 * PDF Export and Print operations
 */

let abortPDFExport = false;

// Attach cancel event listener if button exists
document.addEventListener('DOMContentLoaded', () => {
    const btnCancel = document.getElementById('btn-cancel-pdf');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            abortPDFExport = true;
            btnCancel.textContent = "キャンセル中...";
            btnCancel.disabled = true;
        });
    }
});

async function exportPDF() {
    // Always use image-based export
    await exportPDFAsImage();
}

// [FIX] Removed duplicate openPrintDialog()
// The advanced, slide-aware version of openPrintDialog is already defined in editor_commands.js.
// Since pdf.js is loaded after editor_commands.js, this duplicate was overwriting the advanced logic,
// breaking the Slide PDF printing feature.

// Original: High-quality image-based PDF export
async function exportPDFAsImage(orientation = 'portrait') {
    // Reset cancellation flag
    abortPDFExport = false;

    // Determine filename early
    let pdfFilename = 'document.pdf';
    if (typeof AppState !== 'undefined' && AppState.fileHandle) {
        const mdName = AppState.fileHandle.name;
        pdfFilename = mdName.replace(/\.(md|markdown|txt)$/i, '') + '.pdf';
    }

    // Ask for save location first (to avoid user gesture timeout during rendering)
    let saveHandle = null;
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            saveHandle = await window.showSaveFilePicker({
                suggestedName: pdfFilename,
                types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
            });
        } catch (e) {
            if (e.name === 'AbortError') return; // User cancelled
            console.warn('File picker failed, falling back to download:', e);
        }
    }

    // Show progress dialog
    if (DOM.dialogProgress) {
        DOM.pdfProgressBar.style.width = '0%';
        DOM.pdfProgressText.textContent = '0%';
        DOM.btnCancelPDF.disabled = false;
        DOM.btnCancelPDF.textContent = "キャンセル";
        DOM.dialogProgress.showModal();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // [NEW] 確実な描画猶予
        await new Promise(resolve => setTimeout(resolve, 50));
    } else {
        if (typeof showToast === 'function') showToast("PDFを作成中...", "info");
    }

    // 1. Prepare UI for capture
    // Store current scroll positions (Preview Area & Window)
    const originalScrollTop = DOM.preview.scrollTop;
    const originalWindowX = window.scrollX;
    const originalWindowY = window.scrollY;

    // Reset scroll to top explicitly (Both element and window)
    DOM.preview.scrollTop = 0;
    window.scrollTo(0, 0);

    // Add printing class to disable sticky headers via CSS
    document.body.classList.add('printing-mode');

    // Apply page break classes before HR if enabled to hide them via CSS
    if (AppState.config.pageBreakOnHr) {
        const hrElements = DOM.preview.querySelectorAll('hr');
        hrElements.forEach(hr => {
            hr.classList.add('page-break-before');
        });
    }

    // [FIX] Manually force inline styles to ensure sticky is removed
    // html2canvas might ignore CSS overrides for sticky elements, so we set inline styles directly.
    const stickyElements = DOM.preview.querySelectorAll('th, thead');
    stickyElements.forEach(el => {
        el.dataset.originalPosition = el.style.position;
        el.dataset.originalTop = el.style.top;
        el.style.setProperty('position', 'static', 'important');
        el.style.setProperty('top', 'auto', 'important');
    });

    // Wait a moment for reflow (Increased to 500ms to ensure layout update)
    await new Promise(resolve => setTimeout(resolve, 500));

    let status = "Initializing"; // Track status for debugging

    try {
        // Ensure jsPDF is available
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: orientation });

        // --- Smart Page Splitting Logic ---
        const pdfWidth = doc.internal.pageSize.getWidth();   // 595.28 pt
        const pdfHeight = doc.internal.pageSize.getHeight(); // 841.89 pt

        // Get margins from config (convert mm to pt: 1mm = 2.83465pt)
        const margins = AppState.config.pdfMargins || { top: 10, bottom: 10, left: 10, right: 10 };
        const marginTop = margins.top * 2.83465;
        const marginBottom = margins.bottom * 2.83465;
        const marginLeft = margins.left * 2.83465;
        const marginRight = margins.right * 2.83465;

        const contentWidthPt = pdfWidth - marginLeft - marginRight;
        const contentHeightPt = pdfHeight - marginTop - marginBottom;

        // Calculate scale factor to fit DOM width to PDF content width
        const element = DOM.preview;
        const elementWidthPx = AppState.config.previewWidth || element.offsetWidth || 820;
        // Scale: How many pt per 1 px
        const scalePxToPt = contentWidthPt / elementWidthPx;

        // Calculate available height in PX (DOM coordinates)
        const pageHeightPx = contentHeightPt / scalePxToPt;

        console.log(`Starting PDF export. Total Height: ${element.scrollHeight}px`);

        // PageSplitterを使ってプレビュー全体をページごとのDOMに分割
        // ※ PageSplitterは内部で要素の移動（破壊的変更）を行うため、必ずプレビューの複製を渡す
        status = "Splitting pages...";
        const clonedPreview = element.cloneNode(true);

        // [NEW] 内部用データ属性 (data-paper-*) を削除して出力をクリーンにする
        const paperAttributes = ['data-paper-width', 'data-paper-height', 'data-paper-x', 'data-paper-y'];
        clonedPreview.querySelectorAll('svg').forEach(svg => {
            paperAttributes.forEach(attr => svg.removeAttribute(attr));
        });

        const pages = await PageSplitter.splitToPages(clonedPreview, pageHeightPx, elementWidthPx);

        // 分割されたページを描画するための専用の一時コンテナを作成
        const renderContainer = document.createElement('div');
        renderContainer.className = element.className;
        Object.assign(renderContainer.style, {
            position: 'absolute',
            top: '-9999px',
            left: '0',
            width: `${elementWidthPx}px`, // 元の幅と同じにする
            backgroundColor: '#ffffff'
        });
        document.body.appendChild(renderContainer);

        try {
            for (let i = 0; i < pages.length; i++) {
                status = `Processing page ${i + 1}/${pages.length}`;

                // Check cancellation
                if (abortPDFExport) {
                    status = "Cancelled by user";
                    throw new Error("PDF export cancelled by user");
                }

                const pageNode = pages[i];
                renderContainer.innerHTML = ''; // クリア
                renderContainer.appendChild(pageNode);

                // Update Progress (DOM描画待ちを兼ねる)
                if (DOM.dialogProgress) {
                    const progress = Math.min(99, Math.round(((i + 1) / pages.length) * 100));
                    DOM.pdfProgressBar.style.width = `${progress}%`;
                    DOM.pdfProgressText.textContent = `${progress}%`;
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // [NEW] 確実な描画猶予
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                // Capture this segment (pageNode)
                status = `Capturing canvas for page ${i + 1}`;
                const canvas = await html2canvas(renderContainer, {
                    scale: 2, // High resolution
                    useCORS: true,
                    backgroundColor: '#ffffff',
                    windowWidth: elementWidthPx,
                    // scrollY: 0, // Topから
                    // x: 0,
                    // y: 0
                });

                // [FIX] 空のキャンバス（高さ0または幅0）が生成された場合のクラッシュを防止
                if (canvas.width === 0 || canvas.height === 0) {
                    console.warn(`[PDF Debug] Skipped empty canvas for page ${i + 1}`);
                    continue; // 空白ページとして扱い、PDFの描画処理をスキップ
                }
                const imgData = canvas.toDataURL('image/jpeg', 0.8);

                // 画像の高さはキャンバスの比率から計算
                const imgH = (canvas.height / canvas.width) * contentWidthPt;

                // Add to PDF
                status = `Adding page ${i + 1} to PDF`;
                if (i > 0) doc.addPage();
                doc.addImage(imgData, 'JPEG', marginLeft, marginTop, contentWidthPt, imgH);

                // Footer (Page Number)
                if (AppState.config.pdfFooter) {
                    const pageNum = doc.internal.getNumberOfPages();
                    doc.setFontSize(10);
                    doc.setTextColor(100);
                    doc.text(`${pageNum}`, pdfWidth - marginRight, pdfHeight - (marginBottom / 2), { align: 'right' });
                }
            }
        } finally {
            // 一時コンテナを破棄
            if (renderContainer.parentNode) {
                document.body.removeChild(renderContainer);
            }
        }

        // Finalize Progress
        if (DOM.dialogProgress) {
            DOM.pdfProgressBar.style.width = '100%';
            DOM.pdfProgressText.textContent = '100%';
        }

        status = "Saving PDF file";

        // Save PDF
        if (saveHandle) {
            status = "Writing file to disk";
            const pdfData = doc.output('arraybuffer');
            const writable = await saveHandle.createWritable();
            await writable.write(pdfData);
            await writable.close();
            if (typeof showToast === 'function') showToast("PDFを保存しました");
        } else {
            status = "Downloading PDF file";
            doc.save(pdfFilename);
            if (typeof showToast === 'function') showToast("PDFを作成しました");
        }
    } catch (e) {
        console.error("PDF Export Error:", e);
        console.error("Final Status:", typeof status !== 'undefined' ? status : "Unknown");

        if (e.message === "PDF export cancelled by user") {
            if (typeof showToast === 'function') showToast("PDF出力をキャンセルしました", "warning");
        } else {
            const statusMsg = typeof status !== 'undefined' ? status : "Unknown Ref";
            if (typeof showToast === 'function') showToast(`PDFのエクスポートに失敗しました (Status: ${statusMsg})`, "error");
            alert(`PDF出力エラーが発生しました。\n\n状況: ${statusMsg}\nエラー: ${e.message}\n\nコンソール(F12)で詳細を確認してください。`);
        }
    } finally {
        // Restore UI state
        document.body.classList.remove('printing-mode');

        // [FIX] Restore inline styles
        stickyElements.forEach(el => {
            if (el.dataset.originalPosition) {
                el.style.position = el.dataset.originalPosition;
            } else {
                el.style.removeProperty('position');
            }

            if (el.dataset.originalTop) {
                el.style.top = el.dataset.originalTop;
            } else {
                el.style.removeProperty('top');
            }
            delete el.dataset.originalPosition;
            delete el.dataset.originalTop;
        });

        // Restore scroll positions
        DOM.preview.scrollTop = originalScrollTop;
        window.scrollTo(originalWindowX, originalWindowY);

        // Remove page break classes
        if (AppState.config.pageBreakOnHr) {
            const hrElements = DOM.preview.querySelectorAll('hr');
            hrElements.forEach(hr => {
                hr.classList.remove('page-break-before');
            });
        }

        // Close progress dialog
        if (DOM.dialogProgress) {
            DOM.dialogProgress.close();
        }
    }
}
