/**
 * UI Settings & Configuration Management
 */

// --- Configuration ---
function openConfig() {
    // Initialize Tabs
    const tabs = document.querySelectorAll('.cfg-tab-btn');
    const contents = document.querySelectorAll('.cfg-tab-content');

    function switchTab(tabId) {
        // Deactivate all
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        // Activate selected
        const selectedTab = document.querySelector(`.cfg-tab-btn[data-tab="${tabId}"]`);
        const selectedContent = document.getElementById(`cfg-tab-${tabId}`);

        if (selectedTab && selectedContent) {
            selectedTab.classList.add('active');
            selectedContent.classList.add('active');
        }
    }

    // Add click listeners to tabs
    tabs.forEach(tab => {
        tab.onclick = () => {
            switchTab(tab.dataset.tab);
        };
    });

    // Reset to first tab
    switchTab('editor');


    // Base Font Size
    const fontSizeSlider = document.getElementById('cfg-base-font-size');
    const fontSizeLabel = document.getElementById('cfg-base-font-size-value');
    fontSizeSlider.value = AppState.config.baseFontSize;
    fontSizeLabel.textContent = AppState.config.baseFontSize;
    fontSizeSlider.oninput = (e) => {
        fontSizeLabel.textContent = e.target.value;
    };

    // Preview Width
    const widthSlider = document.getElementById('cfg-preview-width');
    const widthLabel = document.getElementById('cfg-preview-width-value');
    widthSlider.value = AppState.config.previewWidth;
    widthLabel.textContent = AppState.config.previewWidth;
    widthSlider.oninput = (e) => {
        widthLabel.textContent = e.target.value;
    };

    // Undo History Limit
    const undoLimitSlider = document.getElementById('cfg-undo-history-limit');
    const undoLimitLabel = document.getElementById('cfg-undo-history-limit-value');
    undoLimitSlider.value = AppState.config.undoHistoryLimit;
    undoLimitLabel.textContent = AppState.config.undoHistoryLimit;
    undoLimitSlider.oninput = (e) => {
        undoLimitLabel.textContent = e.target.value;
    };

    // [NEW] Editor Font Size
    const editorFontSizeSlider = document.getElementById('cfg-editor-font-size');
    const editorFontSizeLabel = document.getElementById('cfg-editor-font-size-value');
    if (editorFontSizeSlider && editorFontSizeLabel) {
        editorFontSizeSlider.value = AppState.config.editorFontSize || 14;
        editorFontSizeLabel.textContent = editorFontSizeSlider.value;
        editorFontSizeSlider.oninput = (e) => {
            editorFontSizeLabel.textContent = e.target.value;
        };
    }

    // Split Ratio
    const splitRatioSlider = document.getElementById('cfg-split-ratio');
    const splitRatioLabel = document.getElementById('cfg-split-ratio-value');
    const splitRatioPreviewLabel = document.getElementById('cfg-split-ratio-preview');
    splitRatioSlider.value = AppState.config.splitRatio;
    splitRatioLabel.textContent = AppState.config.splitRatio;
    splitRatioPreviewLabel.textContent = 100 - AppState.config.splitRatio;
    splitRatioSlider.oninput = (e) => {
        const ratio = parseInt(e.target.value);
        splitRatioLabel.textContent = ratio;
        splitRatioPreviewLabel.textContent = 100 - ratio;
    };

    document.getElementById('cfg-line-numbers').checked = AppState.config.lineNumbers;
    document.getElementById('cfg-editor-line-numbers').checked = AppState.config.editorLineNumbers; // [NEW]
    document.getElementById('cfg-line-wrapping').checked = AppState.config.lineWrapping !== false; // [NEW]
    document.getElementById('cfg-pdf-footer').checked = AppState.config.pdfFooter;
    document.getElementById('cfg-pdf-hr-break').checked = AppState.config.pageBreakOnHr;

    // [NEW] 改ページ位置の表示
    const showPageBreaksCheck = document.getElementById('cfg-show-page-breaks');
    if (showPageBreaksCheck) {
        showPageBreaksCheck.checked = AppState.config.showPageBreaks || false;
    }


    // Line Heights
    document.getElementById('cfg-editor-line-height').value = AppState.config.editorLineHeight !== undefined ? AppState.config.editorLineHeight : 1.6;
    document.getElementById('cfg-code-line-height').value = AppState.config.codeLineHeight;
    document.getElementById('cfg-editor-line-height-value').textContent = document.getElementById('cfg-editor-line-height').value;
    document.getElementById('cfg-code-line-height-value').textContent = AppState.config.codeLineHeight;

    // Line Height Sliders
    document.getElementById('cfg-editor-line-height').oninput = (e) => {
        document.getElementById('cfg-editor-line-height-value').textContent = e.target.value;
    };
    document.getElementById('cfg-code-line-height').oninput = (e) => {
        document.getElementById('cfg-code-line-height-value').textContent = e.target.value;
    };

    // Colors
    const colors = AppState.config.colors || { tableHead: '#eaf5ff', codeBg: '#fff7e6' };

    const initColorButton = (id, colorVal) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.dataset.value = colorVal;
        btn.style.backgroundColor = colorVal;
        if (!btn._picker && typeof ColorPickerUI !== 'undefined') {
            btn._picker = new ColorPickerUI({
                color: colorVal,
                isPopup: true,
                onChange: (colorObj) => {
                    const c = colorObj.toHexString(true);
                    btn.dataset.value = c;
                    btn.style.backgroundColor = c;
                }
            });
            btn.addEventListener('click', () => btn._picker.show(btn));
        } else if (btn._picker) {
            btn._picker.color.parse(colorVal);
            btn._picker.updateView();
        }
    };
    initColorButton('cfg-color-table-head', colors.tableHead);
    initColorButton('cfg-color-code-bg', colors.codeBg);

    // Syntax Theme
    document.getElementById('cfg-syntax-theme').value = AppState.config.syntaxTheme || 'prism';

    // 言語選択
    const langSelect = document.getElementById('cfg-language');
    if (langSelect && typeof I18n !== 'undefined') {
        const currentLang = I18n.getLang();
        const languages = I18n.getLanguageNames();

        // 既存のオプションをクリア
        langSelect.innerHTML = '';

        // 登録されている言語を追加
        Object.keys(languages).forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = languages[code];
            langSelect.appendChild(option);
        });

        langSelect.value = currentLang;
    }

    // PDF Margins
    const margins = AppState.config.pdfMargins || { top: 10, bottom: 10, left: 10, right: 10 };
    document.getElementById('cfg-pdf-margin-top').value = margins.top;
    document.getElementById('cfg-pdf-margin-bottom').value = margins.bottom;
    document.getElementById('cfg-pdf-margin-left').value = margins.left;
    document.getElementById('cfg-pdf-margin-right').value = margins.right;

    document.getElementById('cfg-pdf-margin-top-value').textContent = margins.top;
    document.getElementById('cfg-pdf-margin-bottom-value').textContent = margins.bottom;
    document.getElementById('cfg-pdf-margin-left-value').textContent = margins.left;
    document.getElementById('cfg-pdf-margin-right-value').textContent = margins.right;

    // SVG Freehand Epsilon
    const epsilonSlider = document.getElementById('cfg-freehand-epsilon');
    const epsilonLabel = document.getElementById('cfg-freehand-epsilon-value');
    if (epsilonSlider && epsilonLabel) {
        epsilonSlider.value = AppState.config.freehandEpsilon !== undefined ? AppState.config.freehandEpsilon : 30;
        epsilonLabel.textContent = epsilonSlider.value;
        epsilonSlider.oninput = (e) => {
            epsilonLabel.textContent = e.target.value;
        };
    }



    // Ruler
    const showRulerCheck = document.getElementById('cfg-show-ruler');
    if (showRulerCheck) {
        showRulerCheck.checked = AppState.config.showRuler || false;
    }

    // [NEW] SVG Grid Snap
    const svgGridSnapSelect = document.getElementById('cfg-svg-grid-snap');
    if (svgGridSnapSelect) {
        svgGridSnapSelect.value = AppState.config.svgGridSnap || 'alt';
    }


    // [NEW] SVG Use Vector Effect / Reverse Scale Text
    const maintainStrokeSelect = document.getElementById('cfg-svg-maintain-stroke');
    if (maintainStrokeSelect) {
        maintainStrokeSelect.value = AppState.config.svgMaintainStrokeText !== false ? 'true' : 'false';
    }

    // [NEW] SVG Toolbar Opacity
    const toolbarOpacitySlider = document.getElementById('cfg-svg-toolbar-opacity');
    const toolbarOpacityLabel = document.getElementById('cfg-svg-toolbar-opacity-value');
    if (toolbarOpacitySlider && toolbarOpacityLabel) {
        const opacityVal = AppState.config.svgToolbarOpacity !== undefined ? AppState.config.svgToolbarOpacity : 0.4;
        toolbarOpacitySlider.value = Math.round(opacityVal * 100);
        toolbarOpacityLabel.textContent = toolbarOpacitySlider.value;
        toolbarOpacitySlider.oninput = (e) => {
            toolbarOpacityLabel.textContent = e.target.value;
        };
    }

    // [NEW] Slide Orientation
    const slideOrientSelect = document.getElementById('cfg-slide-orientation');
    if (slideOrientSelect) {
        slideOrientSelect.value = AppState.config.slideOrientation || 'landscape';
    }

    ['top', 'bottom', 'left', 'right'].forEach(side => {
        const input = document.getElementById(`cfg-pdf-margin-${side}`);
        const label = document.getElementById(`cfg-pdf-margin-${side}-value`);
        input.oninput = (e) => {
            label.textContent = e.target.value;
        };
    });

    // [NEW] Focus Settings
    const typewriterModeCheck = document.getElementById('cfg-typewriter-mode');
    if (typewriterModeCheck) {
        typewriterModeCheck.checked = AppState.config.typewriterMode || false;
    }
    const focusModeCheck = document.getElementById('cfg-focus-mode');
    if (focusModeCheck) {
        focusModeCheck.checked = AppState.config.focusMode || false;
    }

    // [NEW] Image Save Location
    const imageSaveLocationSelect = document.getElementById('cfg-image-save-location');
    if (imageSaveLocationSelect) {
        imageSaveLocationSelect.value = AppState.config.imageSaveLocation || 'document';
    }

    DOM.dialogConfig.showModal();
}

async function saveConfig() {
    AppState.config.baseFontSize = parseInt(document.getElementById('cfg-base-font-size').value);
    AppState.config.previewWidth = parseInt(document.getElementById('cfg-preview-width').value);
    AppState.config.undoHistoryLimit = parseInt(document.getElementById('cfg-undo-history-limit').value);
    // [NEW]
    const editorFontSizeInput = document.getElementById('cfg-editor-font-size');
    if (editorFontSizeInput) {
        AppState.config.editorFontSize = parseInt(editorFontSizeInput.value);
    }
    AppState.config.splitRatio = parseInt(document.getElementById('cfg-split-ratio').value);
    AppState.config.lineNumbers = document.getElementById('cfg-line-numbers').checked;
    AppState.config.editorLineNumbers = document.getElementById('cfg-editor-line-numbers').checked; // [NEW]
    AppState.config.lineWrapping = document.getElementById('cfg-line-wrapping').checked; // [NEW]
    AppState.config.pdfFooter = document.getElementById('cfg-pdf-footer').checked;
    AppState.config.pageBreakOnHr = document.getElementById('cfg-pdf-hr-break').checked;

    // [NEW] 改ページ位置の表示
    const showPageBreaksInput = document.getElementById('cfg-show-page-breaks');
    if (showPageBreaksInput) {
        AppState.config.showPageBreaks = showPageBreaksInput.checked;
    }


    AppState.config.editorLineHeight = parseFloat(document.getElementById('cfg-editor-line-height').value);
    AppState.config.codeLineHeight = parseFloat(document.getElementById('cfg-code-line-height').value);

    // Colors
    AppState.config.colors = {
        tableHead: document.getElementById('cfg-color-table-head').dataset.value || '#eaf5ff',
        codeBg: document.getElementById('cfg-color-code-bg').dataset.value || '#fff7e6'
    };

    // Syntax Theme
    AppState.config.syntaxTheme = document.getElementById('cfg-syntax-theme').value;

    // 言語設定
    const langSelectSave = document.getElementById('cfg-language');
    if (langSelectSave && typeof I18n !== 'undefined') {
        I18n.setLang(langSelectSave.value);
    }

    // PDF Margins
    AppState.config.pdfMargins = {
        top: parseInt(document.getElementById('cfg-pdf-margin-top').value),
        bottom: parseInt(document.getElementById('cfg-pdf-margin-bottom').value),
        left: parseInt(document.getElementById('cfg-pdf-margin-left').value),
        right: parseInt(document.getElementById('cfg-pdf-margin-right').value)
    };

    // SVG
    const epsilonInput = document.getElementById('cfg-freehand-epsilon');
    if (epsilonInput) {
        AppState.config.freehandEpsilon = parseInt(epsilonInput.value);
    }

    // [NEW] SVG Grid Snap
    const svgGridSnapSelectSave = document.getElementById('cfg-svg-grid-snap');
    if (svgGridSnapSelectSave) {
        AppState.config.svgGridSnap = svgGridSnapSelectSave.value;
    }


    // [NEW] SVG Use Vector Effect / Reverse Scale Text
    const maintainStrokeSelectSave = document.getElementById('cfg-svg-maintain-stroke');
    if (maintainStrokeSelectSave) {
        AppState.config.svgMaintainStrokeText = maintainStrokeSelectSave.value === 'true';
    }

    // [NEW] SVG Toolbar Opacity
    const toolbarOpacitySliderSave = document.getElementById('cfg-svg-toolbar-opacity');
    if (toolbarOpacitySliderSave) {
        AppState.config.svgToolbarOpacity = parseInt(toolbarOpacitySliderSave.value) / 100;
    }

    // [NEW] Slide Orientation
    const slideOrientSelectSave = document.getElementById('cfg-slide-orientation');
    if (slideOrientSelectSave) {
        AppState.config.slideOrientation = slideOrientSelectSave.value;
    }

    // Ruler
    const showRulerInput = document.getElementById('cfg-show-ruler');
    if (showRulerInput) {
        AppState.config.showRuler = showRulerInput.checked;
    }


    // [NEW] Focus Settings
    const typewriterModeInput = document.getElementById('cfg-typewriter-mode');
    if (typewriterModeInput) {
        AppState.config.typewriterMode = typewriterModeInput.checked;
    }
    const focusModeInput = document.getElementById('cfg-focus-mode');
    if (focusModeInput) {
        AppState.config.focusMode = focusModeInput.checked;
    }

    // [NEW] Image Save Location
    const imageSaveLocationInput = document.getElementById('cfg-image-save-location');
    if (imageSaveLocationInput) {
        AppState.config.imageSaveLocation = imageSaveLocationInput.value;
    }

    // Base設定を更新（フロントマター一時上書き前への状態を正として保存）
    AppState.baseConfig = JSON.parse(JSON.stringify(AppState.config));

    saveSettings();
    applyBaseFontSize(); // Apply base font size
    applyEditorFontSize(); // [NEW] Apply editor font size
    applyPreviewWidth(); // Apply preview width
    applyLineHeights(); // Apply CSS variable
    applyColors(); // Apply Colors
    applySplitRatio(); // Apply split ratio
    applySvgToolbarOpacity(); // [NEW] Apply SVG toolbar opacity
    applyFocusMode();         // [NEW] Apply Focus Mode
    await applySyntaxTheme(); // Apply Syntax Theme (wait for CSS to load)

    // [NEW] Update all SVG blocks to match new preview width
    if (typeof updateAllSVGWidthsInEditor === 'function') {
        updateAllSVGWidthsInEditor();
    }

    DOM.dialogConfig.close();

    if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers(); // [NEW]
    if (typeof updateLineWrapping === 'function') updateLineWrapping(); // [NEW]
    if (typeof rebuildContextMenu === 'function') rebuildContextMenu(); // [NEW] 言語切り替え時にメニューも再構築
    if (typeof render === 'function') render();
    // [NEW] 設定変更後に改ページ表示を即更新
    if (typeof schedulePageBreakDisplay === 'function') schedulePageBreakDisplay();
}

/**
 * Update all SVG code block dimensions in the editor to match current previewWidth setting
 */
function updateAllSVGWidthsInEditor() {
    if (typeof getEditorText !== 'function' || !AppState.config.previewWidth) return;

    const editorContent = getEditorText();
    const lines = editorContent.split('\n');
    let hasChanges = false;
    const targetWidth = AppState.config.previewWidth;

    let inSvgBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '```svg') {
            inSvgBlock = true;
            continue;
        }
        if (inSvgBlock && line.trim() === '```') {
            inSvgBlock = false;
            continue;
        }

        if (inSvgBlock && line.includes('<svg')) {
            // Find <svg ... > tag
            const svgMatch = line.match(/<svg[^>]*>/);
            if (svgMatch) {
                let svgTag = svgMatch[0];
                const originalTag = svgTag;

                // Extract current width, height, viewBox
                const wMatch = svgTag.match(/width="([^"]+)"/);
                const hMatch = svgTag.match(/height="([^"]+)"/);
                const vbMatch = svgTag.match(/viewBox="([^"]+)"/);

                if (wMatch && vbMatch) {
                    const currentW = parseFloat(wMatch[1]);
                    const vb = vbMatch[1].split(/[ ,]+/).map(parseFloat);

                    if (vb.length === 4 && vb[2] > 0) {
                        const aspect = vb[3] / vb[2]; // height / width
                        const newW = targetWidth;
                        const newH = Math.round(targetWidth * aspect);

                        if (currentW !== newW) {
                            // Update width
                            svgTag = svgTag.replace(/width="[^"]+"/, `width="${newW}"`);
                            // Update height
                            if (hMatch) {
                                svgTag = svgTag.replace(/height="[^"]+"/, `height="${newH}"`);
                            } else {
                                // Add height if missing
                                svgTag = svgTag.replace('<svg', `<svg height="${newH}" `);
                            }

                            lines[i] = line.replace(originalTag, svgTag);
                            hasChanges = true;
                        }
                    }
                }
            }
        }
    }

    if (hasChanges) {
        const newText = lines.join('\n');
        
        // ▼ 修正: グローバルの setEditorText または DOM.editorInstance を使用する
        if (typeof setEditorText === 'function') {
            setEditorText(newText);
        } else if (typeof DOM !== 'undefined' && DOM.editorInstance) {
            DOM.editorInstance.dispatch({
                changes: { from: 0, to: DOM.editorInstance.state.doc.length, insert: newText }
            });
        } else if (typeof DOM !== 'undefined' && DOM.editor) {
            DOM.editor.value = newText; // setValue() ではなく setter を使用
        }

        AppState.text = newText;
        console.log('[Config] All SVG widths updated to:', targetWidth);
    }
}

function cancelConfig() {
    DOM.dialogConfig.close();
}

async function applySyntaxTheme() {
    const theme = AppState.config.syntaxTheme || 'prism';

    // Apply dark theme to body
    if (theme === 'prism-okaidia') {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }

    const oldLink = document.getElementById('prism-theme');
    if (!oldLink) return;

    const newHref = `lib/prism/${theme}.min.css`;

    // Check if oldLink has href (might be missing if bundled as <style>)
    if (!oldLink.href) {
        return;
    }

    // If the theme is the same, no need to reload
    if (oldLink.href.endsWith(newHref)) {
        return;
    }

    // Create a new link element
    return new Promise((resolve) => {
        const newLink = document.createElement('link');
        newLink.rel = 'stylesheet';
        newLink.id = 'prism-theme';
        newLink.href = newHref;

        newLink.onload = () => {
            // Remove old link after new one is loaded
            if (oldLink.parentNode) {
                oldLink.parentNode.removeChild(oldLink);
            }
            resolve();
        };

        newLink.onerror = () => {
            console.error('Failed to load theme:', newHref);
            resolve(); // Resolve anyway to continue
        };

        // Insert new link before old one
        oldLink.parentNode.insertBefore(newLink, oldLink.nextSibling);
    });
}

function applyBaseFontSize() {
    const fontSize = AppState.config.baseFontSize || 16;
    DOM.preview.style.fontSize = `${fontSize}px`;
}

function applyEditorFontSize() {
    const fontSize = AppState.config.editorFontSize || 14;
    document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`);
}

function applyPreviewWidth() {
    const width = AppState.config.previewWidth || 820;
    // previewWidth is the actual text width, so we need to add padding (40px * 2 = 80px)
    const totalWidth = width + 80;
    // Use fixed width instead of max-width to ensure consistent sizing for PDF output
    DOM.preview.style.width = `${totalWidth}px`;
    DOM.preview.style.maxWidth = 'none'; // Override CSS max-width
}

function applyLineHeights() {
    document.documentElement.style.setProperty('--code-line-height', AppState.config.codeLineHeight);
    // Use new editor setting
    const editorLH = AppState.config.editorLineHeight !== undefined ? AppState.config.editorLineHeight : 1.6;
    document.documentElement.style.setProperty('--editor-line-height', editorLH);
}

function applyColors() {
    const colors = AppState.config.colors || { tableHead: '#eaf5ff', codeBg: '#fff7e6' };
    document.documentElement.style.setProperty('--table-head-bg', colors.tableHead);
    document.documentElement.style.setProperty('--code-bg', colors.codeBg);
}

function applySplitRatio() {
    const ratio = AppState.config.splitRatio || 50;
    // Clamp ratio to 20-80 and round to integer
    const clampedRatio = Math.round(Math.max(20, Math.min(80, ratio)));
    AppState.config.splitRatio = clampedRatio;

    // Apply to DOM
    if (DOM.editorPane) {
        DOM.editorPane.style.flex = `0 0 ${clampedRatio}%`;
    }
}

function applySidebarWidths() {
    const outlineWidth = AppState.config.sidebarOutlineWidth || 280;
    const svgListWidth = AppState.config.sidebarSvgListWidth || 280;

    document.documentElement.style.setProperty('--sidebar-outline-width', `${outlineWidth}px`);
    document.documentElement.style.setProperty('--sidebar-svg-list-width', `${svgListWidth}px`);
}

/**
 * [NEW] Apply SVG Toolbar Opacity
 */
function applySvgToolbarOpacity() {
    const opacity = AppState.config.svgToolbarOpacity !== undefined ? AppState.config.svgToolbarOpacity : 0.4;
    document.documentElement.style.setProperty('--svg-toolbar-opacity-inactive', opacity);
}

function saveSettings() {
    const configToSave = AppState.baseConfig ? AppState.baseConfig : AppState.config;
    localStorage.setItem('mdEditor_config', JSON.stringify(configToSave));
    localStorage.setItem('mdEditor_viewMode', AppState.viewMode);
}

function loadSettings() {
    try {
        const s = localStorage.getItem('mdEditor_config');
        if (s) {
            const loaded = JSON.parse(s);
            AppState.config = { ...AppState.config, ...loaded };
            // Ensure colors object exists
            if (!AppState.config.colors) {
                AppState.config.colors = { tableHead: '#eaf5ff', codeBg: '#fff7e6' };
            }
            // Ensure new settings have defaults
            if (!AppState.config.baseFontSize) {
                AppState.config.baseFontSize = 16;
            }
            if (AppState.config.editorLineNumbers === undefined) {
                AppState.config.editorLineNumbers = true; // Default to true for editor
            }
            if (AppState.config.lineWrapping === undefined) {
                AppState.config.lineWrapping = true; // Default to true
            }
            if (!AppState.config.previewWidth) {
                AppState.config.previewWidth = 820;
            }
            if (!AppState.config.undoHistoryLimit) {
                AppState.config.undoHistoryLimit = 200;
            }
            if (AppState.config.splitRatio === undefined) {
                AppState.config.splitRatio = 50;
            }
            if (AppState.config.editorLineHeight === undefined) {
                AppState.config.editorLineHeight = 1.6;
            }
            if (AppState.config.freehandEpsilon === undefined) {
                AppState.config.freehandEpsilon = 30; // Default
            }
            if (AppState.config.showRuler === undefined) {
                AppState.config.showRuler = false; // Default
            }
            if (AppState.config.svgToolbarOpacity === undefined) {
                AppState.config.svgToolbarOpacity = 0.4; // [NEW] Default 40%
            }


            if (AppState.config.svgGridSnap === undefined) {
                AppState.config.svgGridSnap = 'alt'; // [NEW] Default
            }

            if (AppState.config.slideOrientation === undefined) {
                AppState.config.slideOrientation = 'landscape'; // [NEW] Default
            }

            // [NEW] Focus Settings defaults
            if (AppState.config.typewriterMode === undefined) {
                AppState.config.typewriterMode = false;
            }
            if (AppState.config.focusMode === undefined) {
                AppState.config.focusMode = false;
            }

            // [NEW] Image Save Location default
            if (AppState.config.imageSaveLocation === undefined) {
                AppState.config.imageSaveLocation = 'document';
            }

            // [NEW] Ensure grid settings
            if (!AppState.config.grid) {
                AppState.config.grid = { size: 15, showV: true, showH: true, majorInterval: 5 };
            }
            if (AppState.config.grid.majorInterval === undefined) {
                AppState.config.grid.majorInterval = 5;
            }

            if (AppState.config.sidebarOutlineWidth === undefined) {
                AppState.config.sidebarOutlineWidth = 280;
            }
            if (AppState.config.sidebarSvgListWidth === undefined) {
                AppState.config.sidebarSvgListWidth = 280;
            }

            // [NEW] 改ページ位置の表示
            if (AppState.config.showPageBreaks === undefined) {
                AppState.config.showPageBreaks = false;
            }

            console.log('[Config] Loaded from localStorage:', AppState.config);
        }

        // Load View Mode
        const savedViewMode = localStorage.getItem('mdEditor_viewMode');
        if (savedViewMode && ['split', 'preview-only', 'editor-only'].includes(savedViewMode)) {
            AppState.viewMode = savedViewMode;
        }

        // Initialize Base Config
        AppState.baseConfig = JSON.parse(JSON.stringify(AppState.config));

    } catch (e) { 
        // Fallback Base Config
        AppState.baseConfig = JSON.parse(JSON.stringify(AppState.config));
    }

    // Apply settings immediately
    applyBaseFontSize();
    applyEditorFontSize(); // [NEW]
    applyPreviewWidth();
    applyLineHeights();
    applyColors();
    applySplitRatio(); // Apply split ratio
    applySidebarWidths(); // [NEW] Apply sidebar widths
    applySvgToolbarOpacity(); // [NEW] Apply SVG toolbar opacity
    applyFocusMode();         // [NEW] Apply Focus Mode
    // Apply theme (no need to await on initial load)
    applySyntaxTheme();
    applyViewMode();

    // Apply editor specific settings
    if (typeof updateLineWrapping === 'function') updateLineWrapping();
    if (typeof updateEditorTheme === 'function') updateEditorTheme();
}

/**
 * [NEW] Apply Focus Mode (Dim inactive lines) via CodeMirror Compartment
 */
function applyFocusMode() {
    if (window.editorInstance && window._cmFocusModeComp && window._cmFocusModeTheme) {
        console.log('[FocusMode] Reconfiguring CodeMirror, focusMode:', AppState.config.focusMode);
        window.editorInstance.dispatch({
            effects: window._cmFocusModeComp.reconfigure(
                AppState.config.focusMode ? window._cmFocusModeTheme : []
            )
        });
    } else {
        console.log('[FocusMode] editorInstance not ready yet. Will be applied on load.');
    }
}

/**
 * [NEW] Apply overrides from YAML Front Matter
 */
window.applyFrontMatterOverrides = function() {
    if (!AppState.baseConfig) {
        AppState.baseConfig = JSON.parse(JSON.stringify(AppState.config));
    }

    // Reset to base config
    AppState.config = JSON.parse(JSON.stringify(AppState.baseConfig));

    const fm = AppState.frontMatter || {};
    let changed = false;

    // Theme override
    if (fm.theme && typeof fm.theme === 'string') {
        AppState.config.syntaxTheme = fm.theme;
        changed = true;
    }
    // Slide / PDF overrides
    if (fm.slide && fm.slide.orientation) {
        AppState.config.slideOrientation = fm.slide.orientation;
        changed = true;
    }
    if (fm.pdf) {
        if (typeof fm.pdf.landscape === 'boolean') {
            AppState.config.slideOrientation = fm.pdf.landscape ? 'landscape' : 'portrait';
            changed = true;
        }
        if (typeof fm.pdf.pageNumbers === 'boolean') {
            AppState.config.pdfFooter = fm.pdf.pageNumbers;
            changed = true;
        }
        if (fm.pdf.margins && typeof fm.pdf.margins === 'object') {
            AppState.config.pdfMargins = { ...AppState.config.pdfMargins, ...fm.pdf.margins };
            changed = true;
        }
    }

    if (changed) {
        // Apply the necessary UI changes if overriden
        applySyntaxTheme();
        Promise.resolve().then(() => {
            // Also refresh syntax theme in editor (Codemirror) if the theme changed
            if (typeof updateEditorTheme === 'function') updateEditorTheme();
        });
    }
};

// --- View Mode Toggle ---
function toggleView() {
    const modes = ['split', 'preview-only', 'editor-only'];
    const currentIndex = modes.indexOf(AppState.viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    AppState.viewMode = modes[nextIndex];

    applyViewMode();
    saveSettings();
}

function applyViewMode() {
    const main = document.querySelector('main.split');
    const iconUse = document.querySelector('#btn-toggle-view use');
    const label = document.getElementById('view-label');

    // Remove mode classes (but keep 'split' as base class)
    if (main) {
        main.classList.remove('preview-only', 'editor-only');

        // Apply current mode class if not default split
        if (AppState.viewMode !== 'split') {
            main.classList.add(AppState.viewMode);
        }
    }

    // Update button icon and label
    if (iconUse && label) {
        switch (AppState.viewMode) {
            case 'split':
                iconUse.setAttribute('href', '#icon-view-split');
                label.setAttribute('data-i18n', 'toolbar.viewToggle');
                label.textContent = typeof I18n !== 'undefined' ? I18n.translate('toolbar.viewToggle') : '表示切替';
                break;
            case 'preview-only':
                iconUse.setAttribute('href', '#icon-view-preview');
                label.setAttribute('data-i18n', 'toolbar.previewOnly');
                label.textContent = typeof I18n !== 'undefined' ? I18n.translate('toolbar.previewOnly') : 'プレビュー';
                break;
            case 'editor-only':
                iconUse.setAttribute('href', '#icon-save');
                label.setAttribute('data-i18n', 'toolbar.editorOnly');
                label.textContent = typeof I18n !== 'undefined' ? I18n.translate('toolbar.editorOnly') : 'エディタ';
                break;
        }
    }
}
