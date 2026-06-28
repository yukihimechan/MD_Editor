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
            isGlobal: true,
            isPinned: true
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

        // ── 拡大表示ボタン ─────────────────────────────────
        const sepExpand = document.createElement('div');
        sepExpand.style.cssText = 'width:1px; height:20px; background:#ccc; margin:0 4px;';
        contentArea.appendChild(sepExpand);

        const expandBtn = document.createElement('button');
        expandBtn.className = 'mermaid-toolbar-btn';
        expandBtn.title = '拡大表示（パン・ズーム対応）';
        expandBtn.style.cssText = `
            width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
            background: white; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; color: #4b5563;
        `;
        expandBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
        `;
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.showMermaidExpandedView && this._diagramWrapper) {
                window.showMermaidExpandedView(this._diagramWrapper);
            }
        });
        expandBtn.addEventListener('mouseenter', () => expandBtn.style.background = '#f3f4f6');
        expandBtn.addEventListener('mouseleave', () => expandBtn.style.background = 'white');
        contentArea.appendChild(expandBtn);

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
            newCodeBlockWrapper = document.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
            if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
        }
        if (!newDiagramWrapper && savedDataLine) {
            newDiagramWrapper = document.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
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
            window.MermaidBase.updateEditButtonToDoneMode(newCodeBlockWrapper);
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
            
            // プレフィックスの変動に対応するため、クリーンIDで一致する要素を探して新しいIDを特定する
            let matchedNewId = savedEdgeId;
            const cleanSavedId = savedEdgeId.replace(/^mermaid-\d+-\d+-/, '');
            
            const edges = newDiagramWrapper.querySelectorAll('.edgePath path:not(.mermaid-er-arrow-hitbox), path.relation:not(.mermaid-er-arrow-hitbox), .relationshipLine:not(.mermaid-er-arrow-hitbox)');
            for (const edge of edges) {
                const edgeId = edge.id || (edge.parentNode && edge.parentNode.id);
                if (edgeId) {
                    const cleanEdgeId = edgeId.replace(/^mermaid-\d+-\d+-/, '');
                    if (cleanEdgeId === cleanSavedId) {
                        matchedNewId = edgeId;
                        break;
                    }
                }
            }

            newDiagramWrapper._selectedRelations.add(matchedNewId);
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

        // 拡大表示中はz-indexをモーダルより前面に設定
        const isExpanded = diagramWrapper.classList.contains('mermaid-fixed-expanded');
        this.toolbarElement.style.zIndex = isExpanded ? '100001' : '';

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
        const displayVal = getComputedStyle(this.toolbarElement).display;
        if (displayVal === 'none') return;

        const isExpanded = this._diagramWrapper.classList.contains('mermaid-fixed-expanded');
        const expandBtn = this.contentArea ? (this.contentArea.querySelector('button[title*="拡大表示"]') || this.contentArea.querySelector('button[title*="縮小表示"]')) : null;
        if (expandBtn) {
            const svgPath = expandBtn.querySelector('path');
            if (svgPath) {
                if (isExpanded) {
                    svgPath.setAttribute('d', 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7');
                    expandBtn.title = '縮小表示（元のサイズに戻す）';
                } else {
                    svgPath.setAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
                    expandBtn.title = '拡大表示（パン・ズーム対応）';
                }
            }
        }

        const rect = this._diagramWrapper.getBoundingClientRect();
        // position: fixed でviewport座標を直接使用
        this.toolbarElement.style.position = 'fixed';
        this.toolbarElement.style.top  = `${rect.top + 10}px`;
        this.toolbarElement.style.left = `${rect.left + 10}px`;

        // 拡大表示中はz-indexを最前面に設定（!importantでcssTextの設定を上書き）
        if (isExpanded) {
            this.toolbarElement.style.setProperty('z-index', '100001', 'important');
        } else {
            this.toolbarElement.style.removeProperty('z-index');
        }
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
