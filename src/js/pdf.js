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

// Browser print function (called from print button)
function openPrintDialog() {
    try {
        // Apply page break before H2 if enabled
        if (AppState.config.pageBreakOnH2) {
            const h2Elements = DOM.preview.querySelectorAll('h2');
            h2Elements.forEach(h2 => {
                h2.classList.add('page-break-before');
            });
        }

        // Open print dialog
        window.print();

        // Remove page break classes after print
        setTimeout(() => {
            const h2Elements = DOM.preview.querySelectorAll('h2');
            h2Elements.forEach(h2 => {
                h2.classList.remove('page-break-before');
            });
        }, 1000);

    } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') showToast("印刷ダイアログを開けませんでした", "error");
    }
}

// Original: High-quality image-based PDF export
async function exportPDFAsImage() {
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
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });

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
        const elementWidthPx = element.offsetWidth;
        // Scale: How many pt per 1 px
        const scalePxToPt = contentWidthPt / elementWidthPx;

        // Calculate available height in PX (DOM coordinates)
        const pageHeightPx = contentHeightPt / scalePxToPt;

        const totalHeightPx = element.scrollHeight;
        let currentY = 0;


        console.log(`Starting PDF export. Total Height: ${totalHeightPx}`);

        while (currentY < totalHeightPx) {
            status = `Processing loop Y=${currentY}/${totalHeightPx}`;
            // Check cancellation
            if (abortPDFExport) {
                status = "Cancelled by user";
                throw new Error("PDF export cancelled by user");
            }

            // Default split point (fill the page)
            let splitHeight = pageHeightPx;

            // Check if this split point cuts through an element
            // Limit check to direct children of preview to avoid deep complexity
            if (currentY + splitHeight < totalHeightPx) {
                const splitY = currentY + splitHeight;

                // Find element crossing the split line
                const children = Array.from(element.children);
                for (const child of children) {
                    const top = child.offsetTop;
                    const bottom = top + child.offsetHeight;

                    // [New Option] Page Break before H2
                    // Check if there is an H2 in this page (but not at the very top)
                    if (AppState.config.pageBreakOnH2 && child.tagName === 'H2') {
                        if (top > currentY && top < currentY + splitHeight) {
                            // Cut exactly before this H2
                            splitHeight = top - currentY;
                            break; // Found priority break point
                        }
                    }

                    // If element crosses the line
                    if (top < splitY && bottom > splitY) {
                        // If element is smaller than a page, move split point up to start of element
                        if (child.offsetHeight < pageHeightPx) {
                            splitHeight = top - currentY;
                        }
                        // If element is larger than a page (huge table), we must cut it.
                        // (Alternatively, we could look deeper, but for now we cut)
                        break;
                    }
                }
            }

            // Safety check: avoid 0 height loop
            if (splitHeight <= 0) {
                splitHeight = pageHeightPx; // Force split if stuck
            }

            // Update Progress
            if (DOM.dialogProgress) {
                const progress = Math.min(99, Math.round((currentY / totalHeightPx) * 100));
                DOM.pdfProgressBar.style.width = `${progress}%`;
                DOM.pdfProgressText.textContent = `${progress}%`;
                // Invoke a short delay to allow UI to update and user to click cancel
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Capture this segment
            status = `Capturing canvas at Y=${currentY}`;
            const canvas = await html2canvas(element, {
                scale: 2, // High resolution
                useCORS: true,
                backgroundColor: '#ffffff',
                scrollY: -currentY, // Shift viewport
                windowWidth: element.scrollWidth,
                windowHeight: element.scrollHeight,
                x: 0,
                y: currentY, // Capture starting from currentY
                width: element.scrollWidth,
                height: splitHeight // Capture only this height
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.8);
            const imgH = splitHeight * scalePxToPt;

            // Add to PDF
            status = `Adding page to PDF at Y=${currentY}`;
            if (currentY > 0) doc.addPage();
            doc.addImage(imgData, 'JPEG', marginLeft, marginTop, contentWidthPt, imgH);

            // Footer (Page Number)
            if (AppState.config.pdfFooter) {
                const pageNum = doc.internal.getNumberOfPages();
                doc.setFontSize(10);
                doc.setTextColor(100);
                doc.text(`${pageNum}`, pdfWidth - marginRight, pdfHeight - (marginBottom / 2), { align: 'right' });
            }

            currentY += splitHeight;

            // Progress feedback
            console.log(`Page added: Y=${currentY}/${totalHeightPx}`);
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

        // Close progress dialog
        if (DOM.dialogProgress) {
            DOM.dialogProgress.close();
        }
    }
}
