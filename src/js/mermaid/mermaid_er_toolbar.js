/**
 * MermaidErToolbar - Mermaid ER図編集用ツールバー
 * フローチャート(mermaid_toolbar.js)・シーケンス図(mermaid_sequence_toolbar.js)等と同じ
 * アーキテクチャで、SVGToolbarBase を継承して実装する。
 */
class MermaidErToolbar extends window.SVGToolbarBase {
    constructor() {
        super();
        this.id = 'mermaid-er-toolbar';
        this.config = {
            position: 'top-right',
            borderColor: '#f59e0b', // オレンジ系（ER図を他と区別）
            isGlobal: true
        };

        this._selectedRelationLine = '--'; // デフォルトは実線
        this._selectedClassId = null;
        this._clipboard = null;

        this._buildToolbar();
    }

    _buildToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id:          this.id,
            borderColor: this.config.borderColor,
            position:    this.config.position,
        });

        this.toolbarElement = toolbar;
        this.contentArea    = contentArea;

        // ── Entity追加ボタン ────────────────────────────────
        const addEntityBtn = document.createElement('button');
        addEntityBtn.title = 'エンティティを追加';
        addEntityBtn.dataset.tool = 'add-entity';
        addEntityBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24"
            style="pointer-events:none; display:block;" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="16" rx="2"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="12" y1="14" x2="12" y2="20"/>
            <line x1="9" y1="17" x2="15" y2="17"/>
        </svg>`;
        addEntityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._addNewEntity();
        });
        contentArea.appendChild(addEntityBtn);

        // ── セパレーター ───────────────────────────────────
        const sep = document.createElement('div');
        sep.style.cssText = 'width:1px; height:20px; background:#ccc; margin:0 4px;';
        contentArea.appendChild(sep);

        // ── 関係の編集（多重度・線種） ────────────────────────
        const selectWrapper = document.createElement('div');
        selectWrapper.style.cssText = 'display:flex; align-items:center; border-left:1px solid #ccc; padding-left:8px; position:relative;';

        const createSelect = (options) => {
            const select = document.createElement('select');
            select.style.cssText = `
                height: 24px;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: white;
                font-size: 11px;
                padding: 0 4px;
                margin: 0 4px;
                outline: none;
                cursor: pointer;
            `;
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                select.appendChild(option);
            });
            select.addEventListener('change', () => this._onRelationStateChanged());
            return select;
        };

        const leftOptions = [
            { label: '0 or 1 (|o)', value: '|o' },
            { label: 'Exactly 1 (||)', value: '||' },
            { label: '0 or More (}o)', value: '}o' },
            { label: '1 or More (}|)', value: '}|' }
        ];

        const lineOptions = [
            { label: 'Identifying (--)', value: '--' },
            { label: 'Non-identifying (..)', value: '..' }
        ];

        const rightOptions = [
            { label: '0 or 1 (o|)', value: 'o|' },
            { label: 'Exactly 1 (||)', value: '||' },
            { label: '0 or More (o{)', value: 'o{' },
            { label: '1 or More (|{)', value: '|{' }
        ];

        this.leftMultiSelect = createSelect(leftOptions);
        this.leftMultiSelect.value = '||';

        this.lineTypeSelect = createSelect(lineOptions);
        this.lineTypeSelect.value = '--';

        this.rightMultiSelect = createSelect(rightOptions);
        this.rightMultiSelect.value = 'o{';

        selectWrapper.appendChild(this.leftMultiSelect);
        selectWrapper.appendChild(this.lineTypeSelect);
        selectWrapper.appendChild(this.rightMultiSelect);
        contentArea.appendChild(selectWrapper);

        toolbar.style.display = 'none';
    }

    getLeftMultiplicity() { return this.leftMultiSelect.value; }
    getLineType() { return this.lineTypeSelect.value; }
    getRightMultiplicity() { return this.rightMultiSelect.value; }

    setRelationState(leftMulti, lineType, rightMulti) {
        if (leftMulti !== undefined) this.leftMultiSelect.value = leftMulti;
        if (lineType !== undefined) this.lineTypeSelect.value = lineType;
        if (rightMulti !== undefined) this.rightMultiSelect.value = rightMulti;
    }

    _onRelationStateChanged() {
        if (typeof this.onRelationStateChange === 'function') {
            this.onRelationStateChange({
                leftMulti: this.leftMultiSelect.value,
                lineType: this.lineTypeSelect.value,
                rightMulti: this.rightMultiSelect.value
            });
        }
    }

    _addNewEntity() {
        if (!this._diagramWrapper) return;
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let dataLine = parseInt(this._diagramWrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = this._diagramWrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const editorText = getEditorText();
        const lines      = editorText.split('\n');
        const startIdx   = dataLine - 1;

        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        const entityId = this._generateUniqueEntityId(lines, startIdx, endIdx);

        // templates_mermaid.js からテンプレートを取得
        let template = window.MERMAID_ER_NEW_ENTITY_TEMPLATE || 'NEW_ENTITY {\n    int id PK\n    string name\n}';
        template = template.replace('NEW_ENTITY', entityId);
        
        const newLines = template.split('\n').map(l => '    ' + l);
        lines.splice(endIdx, 0, ...newLines);

        const savedCodeIndex = this._diagramWrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = this._diagramWrapper.getAttribute('data-line')
            || this._diagramWrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => this._restoreEditMode(savedCodeIndex, savedDataLine), 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`エンティティ「${entityId}」を追加しました`, 'success');
    }

    _generateUniqueEntityId(lines, startIdx, endIdx) {
        const blockText = lines.slice(startIdx + 1, endIdx).join('\n');
        const used = new Set();
        const re   = /\bEntity(\d+)\b/g;
        let m;
        while ((m = re.exec(blockText)) !== null) used.add(parseInt(m[1], 10));
        let n = 1;
        while (used.has(n)) n++;
        return `Entity${n}`;
    }

    _restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId = null) {
        const preview = document.getElementById('preview');
        if (!preview) return;

        let newDiagramWrapper = null;
        let newCodeBlockWrapper = null;

        if (savedCodeIndex !== undefined) {
            newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
            if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
        }
        if (!newDiagramWrapper && savedDataLine) {
            newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
            if (newDiagramWrapper && !newCodeBlockWrapper) {
                newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
            }
        }

        if (!newDiagramWrapper) return;

        newDiagramWrapper.classList.add('mermaid-er-edit-mode');
        this._diagramWrapper = newDiagramWrapper;

        if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
            InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
            if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
        }

        // 「完了」ボタンの状態を復元
        if (newCodeBlockWrapper) {
            const editBtn = newCodeBlockWrapper.querySelector('.code-edit-btn');
            if (editBtn && !editBtn.classList.contains('mermaid-done-mode')) {
                const doneLabel = typeof I18n !== 'undefined' ? (I18n.translate('editor.done') || '完了') : '完了';
                editBtn.textContent = doneLabel;
                editBtn.classList.add('mermaid-done-mode');
                editBtn._originalOnclick = editBtn.onclick;
                editBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    if (typeof InlineCodeEditor !== 'undefined') InlineCodeEditor.exitMermaidEdit();
                };
            }
        }

        this.show(newDiagramWrapper);

        // ↓ここを追加：色を付ける前に、再描画された線へ確実にIDとヒットボックスを割り当てる
        if (window.MermaidErInteraction && typeof window.MermaidErInteraction._enhanceRelationHitboxes === 'function') {
            window.MermaidErInteraction._enhanceRelationHitboxes(newDiagramWrapper);
        }

        if (savedEdgeId) {
            if (!newDiagramWrapper._selectedRelations) {
                newDiagramWrapper._selectedRelations = new Set();
            }
            newDiagramWrapper._selectedRelations.add(savedEdgeId);
            if (window.MermaidErInteraction && typeof window.MermaidErInteraction._updateSelectionUI === 'function') {
                window.MermaidErInteraction._updateSelectionUI(newDiagramWrapper);
            }
        }
    }

    show(diagramWrapper) {
        this._diagramWrapper = diagramWrapper;
        if (!this.toolbarElement.parentNode) {
            document.body.appendChild(this.toolbarElement);
        }
        this.toolbarElement.style.setProperty('display', 'flex', 'important');
        this.updatePosition();

        if (!this._resizeHandler) {
            this._resizeHandler = () => this.updatePosition();
            window.addEventListener('resize', this._resizeHandler);
            if (typeof DOM !== 'undefined' && DOM.preview) {
                DOM.preview.addEventListener('scroll', this._resizeHandler);
            }
        }
    }

    hide() {
        if (this.toolbarElement) {
            this.toolbarElement.style.setProperty('display', 'none', 'important');
        }
        this._diagramWrapper = null;
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            if (typeof DOM !== 'undefined' && DOM.preview) {
                DOM.preview.removeEventListener('scroll', this._resizeHandler);
            }
            this._resizeHandler = null;
        }
    }

    updatePosition() {
        if (!this._diagramWrapper) return;
        const rect = this._diagramWrapper.getBoundingClientRect();
        this.toolbarElement.style.top  = `${rect.top  + window.scrollY + 10}px`;
        this.toolbarElement.style.left = `${rect.left + window.scrollX + 10}px`;
    }
}

// ── 自律初期化 ───────────────────────────────────────────────────────
(function initMermaidErToolbar() {
    function tryCreate() {
        if (window.activeMermaidErToolbar) return;
        if (typeof window.SVGToolbarBase === 'undefined') {
            console.warn('[MermaidErToolbar] SVGToolbarBase is not defined yet.');
            return;
        }
        window.activeMermaidErToolbar = new MermaidErToolbar();
        console.log('[MermaidErToolbar] インスタンス作成完了');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
        tryCreate();
    }
})();
