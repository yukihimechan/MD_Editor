/**
 * SVG CSS Toolbar
 * SVGの<style>タグに定義されたCSSクラスを図形に適用・管理するツールバー
 */
class SVGCSSToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-css-toolbar',
            container: container,
            borderColor: options.borderColor || '#E8A000',
            position: options.position || { top: '350px', left: '20px' }
        });
        this._draw = null;
        this._selectedClass = '';
        this._highlightedEls = [];
        this._cssFileInput = null;
        this._isEditing = false;
        this._origSelection = null;
        this._shield = null;

        this.createToolbar();
    }

    /** 現在編集中のSVGが持つdrawオブジェクトを返す */
    get draw() {
        return (window.currentEditingSVG && window.currentEditingSVG.draw) || this._draw;
    }

    // -----------------------------------------------------------------------
    // ツールバー構築
    // -----------------------------------------------------------------------

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;

        this.toolbarElement.classList.add('svg-css-toolbar');
        this._buildContent(contentArea);

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    _buildContent(contentArea) {
        contentArea.style.cssText += 'flex-direction: row; align-items: center; gap: 4px; flex-wrap: nowrap;';

        // ラベル
        const label = document.createElement('span');
        label.textContent = 'CSS:';
        label.style.cssText = 'font-size: 10px; color: var(--svg-toolbar-fg); opacity: 0.7; white-space: nowrap; flex-shrink: 0;';
        contentArea.appendChild(label);

        // クラス選択リストボックス
        this._classSelect = document.createElement('select');
        this._classSelect.title = 'CSSクラス一覧';
        this._classSelect.style.cssText = `
            height: 22px; font-size: 11px; padding: 0 2px;
            border: 1px solid var(--svg-toolbar-border);
            background: var(--svg-toolbar-bg);
            color: var(--svg-toolbar-fg);
            border-radius: 3px; flex-shrink: 1; min-width: 80px; max-width: 140px;
        `;
        this._classSelect.addEventListener('change', () => this._onClassSelectChange());
        contentArea.appendChild(this._classSelect);

        // スタイル編集ボタン
        this._editBtn = this._createBtn('✎', 'スタイルを編集', () => this._toggleEditPanel());
        contentArea.appendChild(this._editBtn);

        // セパレータ
        const sep = document.createElement('span');
        sep.style.cssText = 'width: 1px; height: 16px; background: var(--svg-toolbar-border); margin: 0 2px; flex-shrink: 0;';
        contentArea.appendChild(sep);

        // 保存ボタン
        this._saveBtn = this._createBtn('💾', 'CSSをファイルに保存', () => this._saveCSSFile());
        contentArea.appendChild(this._saveBtn);

        // 開くボタン
        this._openBtn = this._createBtn('📂', 'CSSファイルを開く', () => this._openCSSFile());
        contentArea.appendChild(this._openBtn);

        // 隠しファイルinput
        this._cssFileInput = document.createElement('input');
        this._cssFileInput.type = 'file';
        this._cssFileInput.accept = '.css,text/css';
        this._cssFileInput.style.display = 'none';
        this._cssFileInput.addEventListener('change', (e) => this._onFileSelected(e));
        document.body.appendChild(this._cssFileInput);

        // 編集パネル（ツールバーの外側に配置）
        this._buildEditPanel();

        // 初期データ更新
        this.refreshClassList();
    }

    _createBtn(icon, title, onclick) {
        const btn = document.createElement('button');
        btn.textContent = icon;
        btn.title = title;
        btn.style.cssText = `
            background: transparent; border: 1px solid transparent;
            color: var(--svg-toolbar-fg); cursor: pointer;
            border-radius: 4px; padding: 1px 5px;
            font-size: 13px; line-height: 1.4; flex-shrink: 0;
        `;
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--svg-toolbar-btn-hover-bg)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
        btn.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
        return btn;
    }

    // -----------------------------------------------------------------------
    // 編集パネル
    // -----------------------------------------------------------------------

    _buildEditPanel() {
        this._editPanel = document.createElement('div');
        this._editPanel.className = 'svg-css-edit-panel';
        this._editPanel.style.cssText = `
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            padding: 8px;
            background: var(--svg-toolbar-bg);
            border: 1px solid ${this.config.borderColor};
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            width: 260px;
            opacity: 1 !important;
            pointer-events: auto !important;
        `;

        // スタイル名入力
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 8px;';

        const nameLabel = document.createElement('span');
        nameLabel.textContent = 'クラス名:';
        nameLabel.style.cssText = 'font-size: 11px; color: var(--svg-toolbar-fg); white-space: nowrap; width: 56px; flex-shrink: 0;';
        nameRow.appendChild(nameLabel);

        this._classNameInput = document.createElement('input');
        this._classNameInput.type = 'text';
        this._classNameInput.placeholder = 'my-style';
        this._classNameInput.style.cssText = `
            flex: 1; height: 22px; font-size: 11px; padding: 0 4px;
            border: 1px solid var(--svg-toolbar-border);
            background: var(--svg-toolbar-bg);
            color: var(--svg-toolbar-fg);
            border-radius: 3px;
        `;
        nameRow.appendChild(this._classNameInput);
        this._editPanel.appendChild(nameRow);

        // 図形種類切り替え
        const typeRow = document.createElement('div');
        typeRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

        const typeLabel = document.createElement('span');
        typeLabel.textContent = '種類:';
        typeLabel.style.cssText = 'font-size: 11px; color: var(--svg-toolbar-fg); width: 56px; flex-shrink: 0;';
        typeRow.appendChild(typeLabel);

        ['図形', 'テキスト'].forEach((label, i) => {
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'css-preview-type-' + this.id;
            radio.value = i === 0 ? 'shape' : 'text';
            radio.checked = i === 0;
            radio.id = 'css-type-' + this.id + '-' + i;
            radio.addEventListener('change', () => this._updatePreview());

            const rlabel = document.createElement('label');
            rlabel.htmlFor = radio.id;
            rlabel.textContent = label;
            rlabel.style.cssText = 'font-size: 11px; color: var(--svg-toolbar-fg); cursor: pointer; margin-right: 4px;';

            typeRow.appendChild(radio);
            typeRow.appendChild(rlabel);
        });
        this._editPanel.appendChild(typeRow);

        // プレビュー用SVG領域
        this._previewContainer = document.createElement('div');
        this._previewContainer.style.cssText = `
            position: relative; width: 140px; height: 100px;
            margin: 0 auto 8px;
            border: 1px dashed var(--svg-toolbar-border);
            border-radius: 4px; overflow: hidden;
            background: var(--svg-toolbar-input-bg);
            resize: both; min-width: 100px; min-height: 100px;
            max-width: 200px; max-height: 200px;
        `;

        // SVG.jsでドキュメントと要素を構築（他ツールバーとの互換性向上のため）
        this._previewDraw = SVG().addTo(this._previewContainer).size('100%', '100%');

        // プレビュー用のstyle要素（Drawオブジェクトのdefs内に追加）
        this._previewStyleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        this._previewDraw.defs().node.appendChild(this._previewStyleEl);

        // プレビュー図形（rect）
        // .center() はDOM未アタッチ時に正しく機能しないため、x/yを%で直接指定してレスポンシブに中央配置する
        this._previewRectWrapper = this._previewDraw.rect('80%', '60%').attr({ x: '10%', y: '20%' });
        this._previewRectWrapper.attr({ 'fill': '#ddd', 'stroke': '#666', 'stroke-width': 1 });
        this._previewRect = this._previewRectWrapper.node;

        // プレビュー図形（text）
        this._previewTextWrapper = this._previewDraw.text('TEXT').font({ size: 24, family: 'Inter', anchor: 'middle' });
        this._previewTextWrapper.attr({ x: '50%', y: '50%', 'dominant-baseline': 'middle', 'fill': 'var(--svg-toolbar-fg)' });
        this._previewText = this._previewTextWrapper.node;
        this._previewTextWrapper.hide();

        this._editPanel.appendChild(this._previewContainer);
        this._activePreviewEl = this._previewRectWrapper;

        // ボタン行
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 6px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.style.cssText = `
            font-size: 11px; padding: 2px 10px; border-radius: 4px;
            border: 1px solid var(--svg-toolbar-border);
            background: transparent; color: var(--svg-toolbar-fg); cursor: pointer;
        `;
        cancelBtn.addEventListener('click', () => this._closeEditPanel());
        btnRow.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = `
            font-size: 11px; padding: 2px 14px; border-radius: 4px;
            border: 1px solid ${this.config.borderColor};
            background: ${this.config.borderColor}22;
            color: var(--svg-toolbar-fg); cursor: pointer; font-weight: bold;
        `;
        saveBtn.addEventListener('click', () => this._saveStyle());
        btnRow.appendChild(saveBtn);

        this._editPanel.appendChild(btnRow);

        // ツールバー要素の末尾に追加（absoluteなのでtoolbarElement基準）
        this.toolbarElement.style.position = 'absolute'; // already set
        this.toolbarElement.appendChild(this._editPanel);
    }

    _toggleEditPanel() {
        const isOpen = this._editPanel.style.display !== 'none';
        if (isOpen) {
            this._closeEditPanel();
        } else {
            this._openEditPanel();
        }
    }

    _openEditPanel() {
        if (!window.currentEditingSVG) return;

        // 現在選択中のクラスをフォームに反映
        if (this._selectedClass) {
            this._classNameInput.value = this._selectedClass;
            this._syncPreviewStyle();
        }

        // メインSVGの選択を退避し、プレビュー要素を「唯一の選択」にする
        this._origSelection = window.currentEditingSVG.selectedElements;
        this._isEditing = true;
        window.currentEditingSVG._inCSSEditMode = true; // [FIX] 同期停止フラグをセット
        console.log('[SVGCSSToolbar] CSS Edit Mode: Sync to editor paused.');
        this._updateSelectionToPreview();

        // メインSVGへの操作をロックするシールドを表示
        this._showShield();

        this._editPanel.style.display = 'block';
        this._editBtn.style.background = 'var(--svg-toolbar-btn-active-bg, rgba(232,160,0,0.2))';
    }

    _closeEditPanel() {
        if (this._isEditing && window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            // [FIX] 同期停止フラグを解除（先に解除しないと deselectAll が効かない）
            window.currentEditingSVG._inCSSEditMode = false;
            console.log('[SVGCSSToolbar] CSS Edit Mode exit: Sync resumed.');

            // 選択状態を復元
            if (typeof window.deselectAll === 'function') window.deselectAll(true);
            if (this._origSelection) {
                this._origSelection.forEach(el => {
                    if (el.node && el.node.isConnected) {
                        window.currentEditingSVG.selectedElements.add(el);
                    }
                });
            }
            this._origSelection = null;
            this._isEditing = false;
        }

        this._hideShield();
        this._editPanel.style.display = 'none';
        this._editBtn.style.background = 'transparent';

        // 他のツールバーの表示状態を更新
        if (typeof window.selectElement === 'function' && window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            const lastSel = Array.from(window.currentEditingSVG.selectedElements).pop();
            if (lastSel) window.selectElement(lastSel, true, true);
        }
    }

    _showShield() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;

        // 透明な要素を重ねるのではなく、キャンバス自体のイベントを無効化する
        // これによりツールバーへのクリックは邪魔されない
        const svgNode = window.currentEditingSVG.draw.node;
        this._origPointerEvents = svgNode.style.pointerEvents;
        svgNode.style.pointerEvents = 'none';
        svgNode.style.opacity = '0.5'; // 編集不可であることを視覚的に示す

        console.log('[SVGCSSToolbar] Main SVG interaction locked');
    }

    _hideShield() {
        if (window.currentEditingSVG && window.currentEditingSVG.draw) {
            const svgNode = window.currentEditingSVG.draw.node;
            svgNode.style.pointerEvents = this._origPointerEvents || '';
            svgNode.style.opacity = '';
        }
    }

    _updateSelectionToPreview() {
        if (!this._isEditing || !window.currentEditingSVG) return;

        const type = this._editPanel.querySelector('input[name="css-preview-type-' + this.id + '"]:checked');
        const isText = type && type.value === 'text';
        this._activePreviewEl = isText ? this._previewTextWrapper : this._previewRectWrapper;

        // グローバルな選択セットをプレビュー要素のみに書き換える
        // インスタンスを維持するため、代入ではなく clear/add を使用する
        if (this._activePreviewEl && window.currentEditingSVG.selectedElements) {
            window.currentEditingSVG.selectedElements.clear();
            window.currentEditingSVG.selectedElements.add(this._activePreviewEl);
            console.log(`[SVGCSSToolbar] Selection locked to preview element: ${this._activePreviewEl.type} (${this._activePreviewEl.id()})`);

            // 各ツールバーに選択変更を通知
            const tbs = ['styleToolbar', 'SVGFontToolbar', 'SVGLineToolbar', 'SVGTextAlignmentToolbar'];
            tbs.forEach(name => {
                const tb = window[name];
                if (tb && typeof tb.updateFromSelection === 'function') {
                    tb.updateFromSelection();
                }
            });
        }
    }

    _updatePreview() {
        const type = this._editPanel.querySelector('input[name="css-preview-type-' + this.id + '"]:checked');
        const isText = type && type.value === 'text';
        this._previewRect.style.display = isText ? 'none' : '';
        this._previewText.style.display = isText ? '' : 'none';

        if (this._isEditing) {
            this._updateSelectionToPreview();
        }
    }

    _syncPreviewStyle() {
        const className = this._classNameInput.value.trim();
        const draw = this.draw;
        if (!draw || !className) {
            this._previewStyleEl.textContent = '';
            return;
        }
        const styleEl = draw.node.querySelector('style');
        if (!styleEl) return;

        // 該当クラスのルールだけ抽出してプレビューに適用
        // [FIX] プレビュー中はツールバーによる色等のインライン変更を許可するため、!important を取り除く
        // さらに、メインキャンバス側の !important ルールがグローバルに波及してプレビューをロックするのを防ぐため、
        // プレビュー内だけで使う専用のユニークなクラス名に一時的に書き換える
        const previewClass = 'preview_' + className;
        const cssText = styleEl.textContent || '';
        const ruleRegex = new RegExp('\\.(' + this._escapeRegex(className) + ')\\s*\\{[^}]*\\}', 'g');
        const matched = cssText.match(ruleRegex) || [];

        let previewCss = matched.join('\n');
        previewCss = previewCss.replace(new RegExp('\\.' + this._escapeRegex(className), 'g'), '.' + previewClass);
        this._previewStyleEl.textContent = previewCss.replace(/!important/gi, '');

        // プレビュー図形からインラインスタイルをクリア（クラススタイルの反映を優先させるため）
        if (this._activePreviewEl) {
            // [FIX] 属性とインラインCSSの両方をクリア
            this._activePreviewEl.attr({ 'fill': null, 'stroke': null, 'stroke-width': null });
            if (typeof this._activePreviewEl.css === 'function') {
                this._activePreviewEl.css({ 'fill': '', 'stroke': '', 'stroke-width': '', 'opacity': '' });
            }
            console.log(`[SVGCSSToolbar] Cleaned inline styles for class sync: .${className}`);
        }

        // プレビュー図形に分離したプレビュー用クラスを適用
        this._previewRect.setAttribute('class', previewClass);
        this._previewText.setAttribute('class', previewClass);
        console.log(`[SVGCSSToolbar] Syncing preview style for class: .${previewClass} (ID: ${this._activePreviewEl.id()})`);
    }

    _saveStyle() {
        const className = this._classNameInput.value.trim();
        if (!className) {
            alert('クラス名を入力してください。');
            return;
        }
        if (!this._isValidClassName(className)) {
            alert('無効なクラス名です。\n使用可能: 半角英数字・ハイフン・アンダースコア（先頭は英字）');
            return;
        }

        const draw = this.draw;
        if (!draw) {
            alert('SVGが読み込まれていません。');
            return;
        }

        // スタイルを収集（編集パネルプレビューから。退避されたselectedElementsは使わない）
        const targetEl = this._activePreviewEl ? this._activePreviewEl.node : this._getPreviewTarget();
        if (!targetEl) {
            alert('スタイルを取得できませんでした。');
            return;
        }

        const styleStr = this._extractInlineStyle(targetEl);
        if (!styleStr) {
            alert('スタイルが設定されていません。');
            return;
        }

        this._ensureStyleTag(draw);
        const styleEl = draw.node.querySelector('style');
        const existing = styleEl.textContent || '';

        // 既存クラスを上書き or 追記
        const ruleRegex = new RegExp('\\.' + this._escapeRegex(className) + '\\s*\\{[^}]*\\}', 'g');
        const newRule = `.${className} { ${styleStr} }`;
        console.log('[SVGCSSToolbar] New rule generated: ' + newRule);
        let newCss;
        if (ruleRegex.test(existing)) {
            newCss = existing.replace(new RegExp('\\.' + this._escapeRegex(className) + '\\s*\\{[^}]*\\}', 'g'), newRule);
        } else {
            newCss = existing.trimEnd() + '\n' + newRule + '\n';
        }
        // styleタグを更新
        styleEl.textContent = newCss;
        console.log(`[SVGCSSToolbar] Style tag updated for class: .${className}`);

        // [FIX] SVG <style> の動的書き換えに伴うブラウザ（Chrome/Webkit）の再描画バグ対策の最終手段。
        // 同一フレーム内で状態を戻すと最適化で無視されてしまうため、長めの待機時間を設けて透明度をトグルする
        setTimeout(() => {
            const svgNode = draw.node;
            const originalOpacity = svgNode.style.opacity;
            svgNode.style.opacity = '0.99';
            // 今回は余裕を持って500ms（0.5秒）後に元に戻し、確実に再描画させる
            setTimeout(() => {
                svgNode.style.opacity = originalOpacity || '';
            }, 500);
        }, 50);

        // [NEW] メインキャンバス上の該当クラスを持つ要素から、インラインの上書きスタイルをクリア
        // draw.find ではなく、全要素を走査して確実に捕捉する
        let foundCount = 0;
        const classNameToFind = className.startsWith('.') ? className.slice(1) : className;

        const cleanElement = (el) => {
            const node = el.node;
            if (el.hasClass && el.hasClass(classNameToFind)) {
                foundCount++;
                console.log(`[SVGCSSToolbar] Cleaning canvas element: ${el.id()} (Class: ${classNameToFind})`);

                // [FIX] グループ要素などがクラスを持つ場合、その子要素（テキスト等）に直接付与された古い属性が
                //       親のCSSルールの継承を邪魔してしまうため、子要素を含めて再帰的に属性を一掃する
                const clearInlineRecursive = (targetEl) => {
                    const tNode = targetEl.node;
                    const targetAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
                        'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor'];

                    if (typeof tNode.removeAttribute === 'function') {
                        targetAttrs.forEach(attr => tNode.removeAttribute(attr));
                        tNode.removeAttribute('style');
                    }
                    if (targetEl.attrs) targetEl.attrs = {};
                    if (typeof targetEl.attr === 'function') {
                        targetEl.attr({
                            'fill': null, 'stroke': null, 'stroke-width': null, 'stroke-dasharray': null, 'opacity': null,
                            'font-size': null, 'font-family': null, 'font-weight': null, 'font-style': null, 'text-anchor': null
                        });
                    }
                    if (typeof targetEl.children === 'function') {
                        targetEl.children().each(child => clearInlineRecursive(child));
                    }
                };

                clearInlineRecursive(el);

                // 3. クラスの再適用でブラウザのリフローを強制
                const currentClass = node.getAttribute('class');
                node.setAttribute('class', '');
                node.offsetHeight; // 強制リフロー
                node.setAttribute('class', currentClass);

                // [FIX] 4. 最も強力なスタイル再評価手段：図形自身をDOM上から抜き差しする（元の重なり順を維持）
                const parent = node.parentNode;
                if (parent) {
                    const next = node.nextSibling;
                    parent.removeChild(node);
                    if (next) {
                        parent.insertBefore(node, next);
                    } else {
                        parent.appendChild(node);
                    }
                }

                // 5. マーカー更新
                if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                    window.SVGToolbar.updateArrowMarkers(el);
                }
            }

            if (typeof el.children === 'function') {
                el.children().each(child => cleanElement(child));
            }
        };

        cleanElement(draw);
        console.log(`[SVGCSSToolbar] Cleanup finished. Found and cleaned ${foundCount} elements.`);

        this.refreshClassList();
        this._classSelect.value = className;
        this._selectedClass = className;
        this._closeEditPanel();

        // [FIX] 編集終了を確実に通知
        if (window.currentEditingSVG) {
            window.currentEditingSVG._inCSSEditMode = false;
        }

        // [FIX] ブラウザへの描画反映を待ってから同期
        requestAnimationFrame(() => {
            if (window.syncChanges) {
                console.log('[SVGCSSToolbar] Saving changes and syncing to editor (force refresh)...');
                window.syncChanges(false);
            }
        });
    }

    _getPreviewTarget() {
        // 編集パネルが開いているときは選択図形の最初の要素を使う
        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements) {
            const sel = Array.from(window.currentEditingSVG.selectedElements);
            if (sel.length > 0) return sel[0].node;
        }
        return null;
    }

    _extractInlineStyle(node) {
        if (!node) return '';
        const attrs = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
            'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor'];

        const parts = [];
        const computed = window.getComputedStyle(node);

        attrs.forEach(attr => {
            // [FIX] getAttribute よりも優先度の高い inline style (node.style) を優先して取得
            // 変更されていない設定値（CSSクラス経由で継承した値）が抜け落ちるのを防ぐため、getComputedStyle を合流させる
            const camelAttr = attr.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            let val = node.style[camelAttr] || node.getAttribute(attr);
            if (!val || val === '') {
                val = computed.getPropertyValue(attr);
            }
            if (val !== null && val !== '') parts.push(`${attr}: ${val} !important`);
        });
        return parts.join('; ');
    }

    // -----------------------------------------------------------------------
    // クラスリスト管理
    // -----------------------------------------------------------------------

    /**
     * SVGの<style>タグからCSSクラス名一覧を抽出する
     */
    getStyleClasses(draw) {
        if (!draw) return [];
        const styleEl = draw.node.querySelector('style');
        if (!styleEl) return [];
        const cssText = styleEl.textContent || '';
        const classNames = [];
        // .クラス名 { ... } のパターンを検索
        const regex = /\.([a-zA-Z][a-zA-Z0-9_-]*)\s*\{/g;
        let m;
        while ((m = regex.exec(cssText)) !== null) {
            if (!classNames.includes(m[1])) {
                classNames.push(m[1]);
            }
        }
        return classNames;
    }

    /**
     * リストボックスを更新する
     */
    refreshClassList() {
        if (!this._classSelect) return;
        const draw = this.draw;
        const classes = this.getStyleClasses(draw);

        this._classSelect.innerHTML = '';

        // 空選択肢（クラスなし）
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '（なし）';
        this._classSelect.appendChild(emptyOpt);

        classes.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.textContent = cls;
            this._classSelect.appendChild(opt);
        });

        // 現在の選択状態を復元
        if (this._selectedClass) {
            this._classSelect.value = this._selectedClass;
        }
    }

    /**
     * クラス選択変更時のハンドラ
     */
    _onClassSelectChange() {
        const cls = this._classSelect.value;
        this._selectedClass = cls;

        // ハイライトをリセット
        this._clearHighlight();

        // 選択図形がある場合はクラスを適用（空文字の場合は削除）
        if (window.currentEditingSVG && window.currentEditingSVG.selectedElements && window.currentEditingSVG.selectedElements.size > 0) {
            this.applyClassToSelection(cls);
        } else if (cls !== '') {
            // 選択なし ＆ クラス指定あり → そのクラスを持つ図形をハイライト
            this.highlightByClass(cls);
        }

        // 編集パネルが開いている場合はスタイルを同期
        if (this._editPanel.style.display !== 'none' && cls !== '') {
            this._classNameInput.value = cls;
            this._syncPreviewStyle();
        }
    }

    /**
     * 選択図形にCSSクラスを適用
     */
    applyClassToSelection(className) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);
        if (selected.length === 0) return;

        selected.forEach(el => {
            if (className) {
                // インラインスタイルがCSSクラスの定義を上書きしてしまうのを防ぐため、
                // 新しいクラスを適用する前に既存のインラインスタイルや属性をクリアする
                this._clearInlineStyles(el);

                el.node.setAttribute('class', className);

                // 強制リフローによる描画更新
                el.node.offsetHeight;
            } else {
                el.node.removeAttribute('class');
            }
        });

        if (window.currentEditingSVG.pushUndoState) window.currentEditingSVG.pushUndoState();
        if (window.syncChanges) window.syncChanges(true);

        // クラス適用後、他ツールバー（カラーパレット等）の状態も更新する
        const tbs = ['styleToolbar', 'SVGFontToolbar', 'SVGLineToolbar', 'SVGTextAlignmentToolbar'];
        tbs.forEach(name => {
            const tb = window[name];
            if (tb && typeof tb.updateFromSelection === 'function') {
                tb.updateFromSelection();
            }
        });
    }

    /**
     * 要素（およびその子要素）からインラインスタイルやPresentation Attributesをクリアする
     */
    _clearInlineStyles(el) {
        if (!el || !el.node) return;
        const node = el.node;
        if (node.nodeType !== 1) return;

        const targetAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
            'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor'];

        targetAttrs.forEach(attr => node.removeAttribute(attr));
        node.removeAttribute('style');

        if (el.attrs) el.attrs = {};
        if (typeof el.attr === 'function') {
            el.attr({ 'fill': null, 'stroke': null, 'stroke-width': null, 'stroke-dasharray': null, 'opacity': null });
        }

        if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
            window.SVGToolbar.updateArrowMarkers(el);
        }

        if (typeof el.children === 'function') {
            el.children().each(child => this._clearInlineStyles(child));
        }
    }

    /**
     * そのクラスを持つ図形をハイライト
     */
    highlightByClass(className) {
        const draw = this.draw;
        if (!draw || !className) return;

        this._clearHighlight();

        draw.find('.' + CSS.escape(className)).each(el => {
            const origOpacity = el.attr('opacity') || 1;
            el.node.setAttribute('data-css-highlight-orig', origOpacity);
            el.node.style.outline = '2px solid #E8A000';
            this._highlightedEls.push(el);
        });
    }

    _clearHighlight() {
        this._highlightedEls.forEach(el => {
            el.node.style.outline = '';
            el.node.removeAttribute('data-css-highlight-orig');
        });
        this._highlightedEls = [];
    }

    /**
     * 選択図形のクラスをリストボックスに反映
     */
    updateFromSelection() {
        if (!this._classSelect) return;

        this.refreshClassList();

        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements);

        if (selected.length === 0) {
            this._classSelect.value = '';
            this._selectedClass = '';
            return;
        }

        const firstEl = selected[0];
        const cls = firstEl.node.getAttribute('class') || '';
        // リストにあるクラスのみ表示、なければ空
        const hasInList = Array.from(this._classSelect.options).some(o => o.value === cls);
        this._classSelect.value = hasInList ? cls : '';
        this._selectedClass = this._classSelect.value;
    }

    // -----------------------------------------------------------------------
    // CSS ファイル保存 / 開く
    // -----------------------------------------------------------------------

    _saveCSSFile() {
        const draw = this.draw;
        if (!draw) {
            alert('SVGが読み込まれていません。');
            return;
        }
        const styleEl = draw.node.querySelector('style');
        if (!styleEl || !styleEl.textContent.trim()) {
            alert('保存するスタイルがありません。');
            return;
        }

        const cssContent = styleEl.textContent;
        const blob = new Blob([cssContent], { type: 'text/css' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'style.css';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 200);
    }

    _openCSSFile() {
        if (this._cssFileInput) {
            this._cssFileInput.value = '';
            this._cssFileInput.click();
        }
    }

    _onFileSelected(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const cssText = ev.target.result;
            this._importCSS(cssText);
        };
        reader.readAsText(file, 'utf-8');
    }

    _importCSS(cssText) {
        const draw = this.draw;
        if (!draw) {
            alert('SVGが読み込まれていません。');
            return;
        }

        const existingStyleEl = draw.node.querySelector('style');
        if (existingStyleEl && existingStyleEl.textContent.trim()) {
            const overwrite = confirm('<style>タグが既に存在します。上書きしますか？\n「キャンセル」を選ぶと追記します。');
            if (overwrite) {
                existingStyleEl.textContent = cssText;
            } else {
                existingStyleEl.textContent = existingStyleEl.textContent.trimEnd() + '\n' + cssText;
            }
        } else {
            this._ensureStyleTag(draw);
            draw.node.querySelector('style').textContent = cssText;
        }

        this.refreshClassList();
        if (window.syncChanges) window.syncChanges(true);
    }

    // -----------------------------------------------------------------------
    // ユーティリティ
    // -----------------------------------------------------------------------

    /**
     * SVGに<style>タグがなければ<defs>内に作成する
     */
    _ensureStyleTag(draw) {
        let styleEl = draw.node.querySelector('style');
        if (!styleEl) {
            // <defs>の中に入れるのが正しいが、直接ルートに追加でも機能する
            let defsEl = draw.node.querySelector('defs');
            if (!defsEl) {
                defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                draw.node.insertBefore(defsEl, draw.node.firstChild);
            }
            styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            styleEl.setAttribute('type', 'text/css');
            defsEl.appendChild(styleEl);
        }
        return styleEl;
    }

    /**
     * CSSクラス名バリデーション
     */
    _isValidClassName(name) {
        return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
    }

    /**
     * 正規表現のエスケープ
     */
    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // -----------------------------------------------------------------------
    // 公開API
    // -----------------------------------------------------------------------

    show() { if (this.toolbarElement) this.toolbarElement.style.display = 'flex'; }
    hide() { /* 常に表示 */ }

    destroy() {
        this._clearHighlight();
        if (this._cssFileInput && this._cssFileInput.parentNode) {
            this._cssFileInput.parentNode.removeChild(this._cssFileInput);
        }
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        this._closeEditPanel();
        super.resetPosition();
    }
}

// グローバルファクトリ
window.createCSSToolbar = (container, options) => {
    return new SVGCSSToolbar(container, options);
};
