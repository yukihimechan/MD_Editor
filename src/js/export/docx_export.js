/**
 * DOCX Export functionality
 * Converts Markdown content to Microsoft Word (DOCX) format
 */

async function exportDOCX() {
    try {
        // Show progress dialog
        if (DOM.dialogDocxProgress) {
            DOM.docxProgressText.textContent = '処理中...';
            DOM.dialogDocxProgress.showModal();
        }

        // Get Markdown content from editor
        const view = window.editorInstance || window.editorView;
        if (!view) {
            throw new Error('エディタインスタンスが見つかりません');
        }
        const markdownText = view.state.doc.toString();

        // Determine filename
        let docxFilename = 'document.docx';
        if (typeof AppState !== 'undefined' && AppState.fileHandle) {
            const mdName = AppState.fileHandle.name;
            docxFilename = mdName.replace(/\.(md|markdown|txt)$/i, '') + '.docx';
        }

        // Convert Markdown to DOCX
        DOM.docxProgressText.textContent = 'Markdown を解析中...';
        const doc = await convertMarkdownToDocx(markdownText);

        // Save file
        DOM.docxProgressText.textContent = 'ファイルを保存中...';
        await saveDocxFile(doc, docxFilename);

        if (typeof showToast === 'function') {
            showToast(t('toast.docxSaved'));
        }

    } catch (e) {
        console.error('DOCX Export Error:', e);
        if (typeof showToast === 'function') {
            showToast(t('error.docxFailed').replace('${e.message}', e.message), 'error');
        }
    } finally {
        // Close progress dialog
        if (DOM.dialogDocxProgress) {
            DOM.dialogDocxProgress.close();
        }
    }
}

/**
 * Convert Markdown text to DOCX document
 */
async function convertMarkdownToDocx(markdownText) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = docx;

    // Parse Markdown using markdown-it
    const md = window.markdownItInstance || markdownit();
    const tokens = md.parse(markdownText, {});

    const children = [];
    let currentList = null;
    let currentListLevel = 0;
    let isInsideListItem = false;
    let listItemMarkerPending = false;

    // Process tokens
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === 'heading_open') {
            const level = Math.min(6, Math.max(1, parseInt(token.tag.substring(1))));
            const inlineToken = tokens[i + 1];
            if (inlineToken && inlineToken.type === 'inline') {
                const runs = parseInlineContent(inlineToken);

                const headingLevels = [
                    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
                    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6
                ];

                children.push(
                    new Paragraph({
                        children: runs,
                        heading: headingLevels[level - 1],
                        spacing: { before: 240, after: 120 }
                    })
                );
                i++; // Skip inline token
            }
        }
        else if (token.type === 'paragraph_open') {
            const contentToken = tokens[i + 1];
            if (contentToken && contentToken.type === 'inline') {
                const runs = parseInlineContent(contentToken);

                const paragraphParams = {
                    children: runs,
                    spacing: { before: 120, after: 120 }
                };

                if (isInsideListItem && listItemMarkerPending) {
                    if (currentList === 'bullet') {
                        paragraphParams.numbering = { reference: 'default-bullet', level: 0 };
                    } else if (currentList === 'number') {
                        paragraphParams.numbering = { reference: 'default-numbering', level: 0 };
                    }
                    paragraphParams.spacing = { before: 60, after: 60 };
                    listItemMarkerPending = false;
                }

                children.push(new Paragraph(paragraphParams));
                i++; // Skip inline token
            }
        }
        else if (token.type === 'bullet_list_open') {
            currentList = 'bullet';
            currentListLevel = 0;
        }
        else if (token.type === 'ordered_list_open') {
            currentList = 'number';
            currentListLevel = 0;
        }
        else if (token.type === 'list_item_open') {
            isInsideListItem = true;
            listItemMarkerPending = true;
        }
        else if (token.type === 'list_item_close') {
            isInsideListItem = false;
            listItemMarkerPending = false;
        }
        else if (token.type === 'inline' && isInsideListItem && listItemMarkerPending) {
            // Tight list support (inline follows list_item_open directly)
            const runs = parseInlineContent(token);
            const paragraphParams = {
                children: runs,
                spacing: { before: 60, after: 60 }
            };

            if (currentList === 'bullet') {
                paragraphParams.numbering = { reference: 'default-bullet', level: 0 };
            } else if (currentList === 'number') {
                paragraphParams.numbering = { reference: 'default-numbering', level: 0 };
            }

            children.push(new Paragraph(paragraphParams));
            listItemMarkerPending = false;
        }
        else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
            currentList = null;
        }
        else if (token.type === 'code_block' || token.type === 'fence') {
            children.push(
                new Paragraph({
                    children: [new TextRun({ text: token.content, font: 'Consolas' })],
                    shading: { fill: 'F5F5F5' },
                    spacing: { before: 120, after: 120 }
                })
            );
        }
        else if (token.type === 'table_open') {
            const tableData = parseTable(tokens, i);
            if (tableData) {
                children.push(createDocxTable(tableData.rows));
                i = tableData.endIndex;
            }
        }
        else if (token.type === 'hr') {
            children.push(
                new Paragraph({
                    text: '',
                    border: { bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 } },
                    spacing: { before: 120, after: 120 }
                })
            );
        }
    }

    // Create document with explicit numbering for bullets and decimal
    const doc = new Document({
        sections: [{ children: children }],
        numbering: {
            config: [
                {
                    reference: 'default-bullet',
                    levels: [
                        {
                            level: 0,
                            format: 'bullet',
                            text: '\u25CF', // ●
                            alignment: AlignmentType.LEFT,
                            style: {
                                paragraph: { indent: { left: 720, hanging: 360 } }
                            }
                        }
                    ]
                },
                {
                    reference: 'default-numbering',
                    levels: [
                        {
                            level: 0,
                            format: 'decimal',
                            text: '%1.',
                            alignment: AlignmentType.LEFT,
                            style: {
                                paragraph: { indent: { left: 720, hanging: 360 } }
                            }
                        }
                    ]
                }
            ]
        }
    });

    return doc;
}

/**
 * Parse inline content (bold, italic, code, links, etc.)
 */
function parseInlineContent(token) {
    const { TextRun } = docx;
    const runs = [];

    if (!token.children || token.children.length === 0) {
        return [new TextRun(token.content || '')];
    }

    const state = {
        bold: false,
        italics: false,
        strike: false,
        highlight: false,
        color: null,
        font: null
    };

    for (const child of token.children) {
        if (child.type === 'text') {
            runs.push(new TextRun({
                text: child.content,
                bold: state.bold,
                italics: state.italics,
                strike: state.strike,
                color: state.color,
                font: state.font
            }));
        }
        else if (child.type === 'strong_open') {
            state.bold = true;
        }
        else if (child.type === 'strong_close') {
            state.bold = false;
        }
        else if (child.type === 'em_open') {
            state.italics = true;
        }
        else if (child.type === 'em_close') {
            state.italics = false;
        }
        else if (child.type === 's_open') {
            state.strike = true;
        }
        else if (child.type === 's_close') {
            state.strike = false;
        }
        else if (child.type === 'code_inline') {
            runs.push(new TextRun({
                text: child.content,
                font: 'Consolas',
                shading: {
                    fill: 'F5F5F5'
                }
            }));
        }
        else if (child.type === 'link_open') {
            state.color = '0000FF';
            // docx v7 doesn't have a simple way to add Hyperlink in TextRun easily without a wrapper
            // but we can at least style it.
        }
        else if (child.type === 'link_close') {
            state.color = null;
        }
        else if (child.type === 'softbreak') {
            runs.push(new TextRun({ text: '', break: 1 }));
        }
    }

    return runs.length > 0 ? runs : [new TextRun('')];
}

/**
 * Get text content from token
 */
function getTextFromToken(token) {
    if (token.type === 'inline' && token.children) {
        return token.children.map(child => child.content || '').join('');
    }
    return token.content || '';
}

/**
 * Parse table from tokens
 */
function parseTable(tokens, startIndex) {
    const rows = [];
    let i = startIndex + 1; // Skip table_open
    let currentRow = [];

    while (i < tokens.length && tokens[i].type !== 'table_close') {
        const token = tokens[i];

        if (token.type === 'tr_open') {
            currentRow = [];
        }
        else if (token.type === 'th_open' || token.type === 'td_open') {
            const contentToken = tokens[i + 1];
            let cellText = '';
            if (contentToken && contentToken.type === 'inline') {
                cellText = getTextFromToken(contentToken);
            }
            currentRow.push({
                text: cellText,
                isHeader: token.type === 'th_open'
            });
        }
        else if (token.type === 'tr_close') {
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }
        }

        i++;
    }

    return {
        rows: rows,
        endIndex: i
    };
}

/**
 * Create DOCX table from parsed data
 */
function createDocxTable(rows) {
    const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType } = docx;

    const tableRows = rows.map((row, rowIndex) => {
        const cells = row.map(cell => {
            return new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: cell.text, bold: cell.isHeader })]
                    })
                ],
                shading: cell.isHeader ? {
                    fill: 'EAF5FF',
                    type: ShadingType.CLEAR
                } : undefined,
                width: {
                    size: 100 / row.length,
                    type: WidthType.PERCENTAGE
                }
            });
        });

        return new TableRow({
            children: cells
        });
    });

    return new Table({
        rows: tableRows,
        width: {
            size: 100,
            type: WidthType.PERCENTAGE
        }
    });
}

/**
 * Save DOCX file
 */
async function saveDocxFile(doc, filename) {
    const { Packer } = docx;

    // Generate blob
    const blob = await Packer.toBlob(doc);

    // Use File System Access API if available
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Word Document',
                    accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
                }]
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error('保存がキャンセルされました');
            }
            console.warn('File System Access API failed, falling back to download:', e);
        }
    }

    // Fallback: Download using anchor tag
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
