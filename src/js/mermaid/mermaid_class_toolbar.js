/**
 * MermaidClassToolbar - Mermaidクラス図編集用ツールバー
 * フローチャート(mermaid_toolbar.js)・シーケンス図(mermaid_sequence_toolbar.js)と同じ
 * アーキテクチャで、SVGToolbarBase を継承して実装する。
 */
class MermaidClassToolbar extends window.SVGToolbarBase {
    constructor() {
        super();
        this.id = 'mermaid-class-toolbar';
        this.config = {
            position: 'top-right',
            borderColor: '#7c3aed', // 紫系（クラス図をシーケンス図と区別）
            isGlobal: true
        };

        // クラス図の関係タイプ定義
        this.relationTypes = [
            {
                value: '<|--',
                label: '継承 (Inheritance)',
                svg: `<line x1="10" y1="10" x2="80" y2="10" stroke="currentColor" stroke-width="2"/>
                      <polygon points="10,5 2,10 10,15" fill="white" stroke="currentColor" stroke-width="1.5"/>`
            },
            {
                value: '*--',
                label: 'コンポジション (Composition)',
                svg: `<line x1="15" y1="10" x2="85" y2="10" stroke="currentColor" stroke-width="2"/>
                      <polygon points="5,10 12,5 19,10 12,15" fill="currentColor"/>`
            },
            {
                value: 'o--',
                label: '集約 (Aggregation)',
                svg: `<line x1="15" y1="10" x2="85" y2="10" stroke="currentColor" stroke-width="2"/>
                      <polygon points="5,10 12,5 19,10 12,15" fill="white" stroke="currentColor" stroke-width="1.5"/>`
            },
            {
                value: '-->',
                label: '関連 (Association)',
                svg: `<line x1="5" y1="10" x2="80" y2="10" stroke="currentColor" stroke-width="2"/>
                      <polygon points="73,5 85,10 73,15" fill="currentColor"/>`
            },
            {
                value: '--',
                label: 'リンク (Link)',
                svg: `<line x1="5" y1="10" x2="90" y2="10" stroke="currentColor" stroke-width="2"/>`
            },
            {
                value: '..>',
                label: '依存 (Dependency)',
                svg: `<line x1="5" y1="10" x2="80" y2="10" stroke="currentColor" stroke-width="2" stroke-dasharray="5,3"/>
                      <polygon points="73,5 85,10 73,15" fill="currentColor"/>`
            },
            {
                value: '..|>',
                label: '実現 (Realization)',
                svg: `<line x1="10" y1="10" x2="80" y2="10" stroke="currentColor" stroke-width="2" stroke-dasharray="5,3"/>
                      <polygon points="10,5 2,10 10,15" fill="white" stroke="currentColor" stroke-width="1.5"/>`
            },
            {
                value: '<-->',
                label: '双方向関連 (Bidirectional)',
                svg: `<line x1="12" y1="10" x2="78" y2="10" stroke="currentColor" stroke-width="2"/>
                      <polygon points="20,5 8,10 20,15" fill="currentColor"/>
                      <polygon points="70,5 82,10 70,15" fill="currentColor"/>`
            }
        ];

        this._selectedRelationType = '-->'; // デフォルトは関連
        this._selectedClassId = null;       // 選択中のクラスID
        this._clipboard = null;             // コピー用クリップボード

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

        // ── クラス追加ボタン ────────────────────────────────
        const addClassBtn = document.createElement('button');
        addClassBtn.title = 'クラスを追加';
        addClassBtn.dataset.tool = 'add-class';
        addClassBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24"
            style="pointer-events:none; display:block;" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="12" y1="3" x2="12" y2="9"/>
            <line x1="12" y1="15" x2="12" y2="21"/>
        </svg>`;
        addClassBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._addNewClass();
        });
        contentArea.appendChild(addClassBtn);

        // ── セパレーター ───────────────────────────────────
        const sep = document.createElement('div');
        sep.style.cssText = 'width:1px; height:20px; background:#ccc; margin:0 4px;';
        contentArea.appendChild(sep);

        // ── 関係タイプドロップダウン ────────────────────────
        const selectWrapper = document.createElement('div');
        selectWrapper.style.cssText = 'display:flex; align-items:center; border-left:1px solid #ccc; padding-left:8px; position:relative;';

        this.relationTrigger = document.createElement('div');
        this.relationTrigger.className = 'mermaid-class-relation-trigger';
        this.relationTrigger.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 130px;
            height: 24px;
            padding: 2px 6px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            user-select: none;
        `;

        this.relationTriggerIconBox = document.createElement('div');
        this.relationTriggerIconBox.style.cssText = 'flex-grow:1; display:flex; align-items:center; justify-content:center; height:100%;';
        // デフォルト表示
        this._updateRelationTrigger(this._selectedRelationType);

        const triggerCaret = document.createElement('div');
        triggerCaret.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
        triggerCaret.style.cssText = 'display:flex; align-items:center; margin-left:4px;';

        this.relationTrigger.appendChild(this.relationTriggerIconBox);
        this.relationTrigger.appendChild(triggerCaret);

        const multiOptions = [
            { label: '-', value: '' },
            { label: '1', value: '"1"' },
            { label: '0..1', value: '"0..1"' },
            { label: '1..*', value: '"1..*"' },
            { label: '*', value: '"*"' }
        ];

        const createMultiSelect = () => {
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
            multiOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                select.appendChild(option);
            });
            select.addEventListener('change', () => this._onRelationStateChanged());
            return select;
        };

        this.leftMultiSelect = createMultiSelect();
        this.rightMultiSelect = createMultiSelect();

        // ── ドロップダウンメニュー ─────────────────────────
        this.relationMenu = document.createElement('div');
        this.relationMenu.className = 'mermaid-class-relation-menu';
        this.relationMenu.style.cssText = `
            position: absolute;
            margin-top: 4px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            width: 130px;
            display: none;
            flex-direction: column;
            z-index: 1000;
            overflow: hidden;
        `;

        this.relationTypes.forEach(type => {
            const item = document.createElement('div');
            item.style.cssText = `
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 6px 8px;
                cursor: pointer;
                border-bottom: 1px solid #f0f0f0;
            `;
            item.innerHTML = `
                <div style="width:100%; display:flex; justify-content:center; color:#7c3aed;">
                    <svg width="90" height="20" viewBox="0 0 95 20">${type.svg}</svg>
                </div>
            `;
            item.title = type.label;
            item.addEventListener('mouseenter', () => item.style.background = '#f3f4f6');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.relationMenu.style.display = 'none';
                this._selectedRelationType = type.value;
                this._updateRelationTrigger(type.value);
                this._onRelationStateChanged();
            });
            this.relationMenu.appendChild(item);
        });

        // ドロップダウンの開閉
        this.relationTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = this.relationMenu.style.display === 'flex';
            if (isOpen) {
                this.relationMenu.style.display = 'none';
            } else {
                this.relationMenu.style.display = 'flex';
                const tRect = toolbar.getBoundingClientRect();
                const dRect = this.relationTrigger.getBoundingClientRect();
                this.relationMenu.style.top  = (dRect.bottom - tRect.top + 4) + 'px';
                this.relationMenu.style.left = (dRect.left   - tRect.left)   + 'px';
            }
        });

        // 外部クリックで閉じる
        document.addEventListener('click', (e) => {
            if (!selectWrapper.contains(e.target) && !this.relationMenu.contains(e.target)) {
                this.relationMenu.style.display = 'none';
            }
        });

        this.swapBtn = document.createElement('button');
        this.swapBtn.className = 'mermaid-toolbar-btn';
        this.swapBtn.title = '矢印の向き（始点と終点）を入れ替える';
        this.swapBtn.style.cssText = `
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
            margin-left: 8px;
            color: #4b5563;
        `;
        this.swapBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 10h14M3 14h14M7 10L3 14M21 10l-4 4"></path>
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            </svg>
        `;
        // SVGをシンプルでわかりやすい水平の入れ替えアイコンに変更
        this.swapBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 7L4 11L8 15" />
                <path d="M4 11H20" />
                <path d="M16 17L20 13L16 9" />
                <path d="M20 13H4" />
            </svg>
        `;

        this.swapBtn.addEventListener('click', () => {
            if (typeof this.onRelationSwap === 'function') {
                this.onRelationSwap();
            }
        });
        this.swapBtn.addEventListener('mouseenter', () => this.swapBtn.style.background = '#f3f4f6');
        this.swapBtn.addEventListener('mouseleave', () => this.swapBtn.style.background = 'white');

        selectWrapper.appendChild(this.leftMultiSelect);
        selectWrapper.appendChild(this.relationTrigger);
        selectWrapper.appendChild(this.rightMultiSelect);
        selectWrapper.appendChild(this.swapBtn);
        contentArea.appendChild(selectWrapper);

        // ── 縦横切り替えボタン ─────────────────────────────
        const sep2 = document.createElement('div');
        sep2.style.cssText = 'width:1px; height:20px; background:#ccc; margin:0 4px;';
        contentArea.appendChild(sep2);

        this.directionBtn = document.createElement('button');
        this.directionBtn.className = 'mermaid-toolbar-btn';
        this.directionBtn.title = '縦・横（TB/LR/BT/RL）の切り替え';
        this.directionBtn.style.cssText = `
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
            color: #4b5563;
        `;
        this.directionBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12v-3a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 12v3a3 3 0 0 1-3 3H4m3 3-3-3 3-3"/>
            </svg>
        `;
        this.directionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._diagramWrapper && this._diagramWrapper._mermaidAPI && typeof this._diagramWrapper._mermaidAPI.toggleDirection === 'function') {
                this._diagramWrapper._mermaidAPI.toggleDirection();
            }
        });
        contentArea.appendChild(this.directionBtn);

        toolbar.appendChild(this.relationMenu);

        // 初期は非表示
        toolbar.style.display = 'none';
    }

    /**
     * 関係タイプのトリガーボタン表示を更新する
     */
    _updateRelationTrigger(typeValue) {
        const typeDef = this.relationTypes.find(t => t.value === typeValue);
        if (typeDef) {
            this.relationTriggerIconBox.innerHTML = `
                <div style="color:#7c3aed; display:flex; align-items:center; justify-content:center;">
                    <svg width="70" height="14" viewBox="0 0 95 20">${typeDef.svg}</svg>
                </div>`;
        } else {
            this.relationTriggerIconBox.innerHTML = `<span style="font-size:11px;color:#333;">${typeValue}</span>`;
        }
    }

    /**
     * 現在選択中の関係タイプを返す
     */
    getSelectedRelationType() {
        return this._selectedRelationType;
    }

    getLeftMultiplicity() { return this.leftMultiSelect.value; }
    getRightMultiplicity() { return this.rightMultiSelect.value; }

    /**
     * UIの状態をプログラムから更新する（選択した矢印の情報を反映）
     */
    setRelationState(type, leftMulti, rightMulti) {
        console.log('[MermaidClassToolbar] setRelationState 呼ばれました:', type, leftMulti, rightMulti);
        if (type) {
            this._selectedRelationType = type;
            this._updateRelationTrigger(type);
        }
        if (leftMulti !== undefined) {
            // valueが存在するか確認（前後のスペースやクオート付きなどに対応）
            let match = Array.from(this.leftMultiSelect.options).find(o => o.value === leftMulti || o.value === `"${leftMulti}"`);
            if (match) this.leftMultiSelect.value = match.value;
            else this.leftMultiSelect.value = '';
        }
        if (rightMulti !== undefined) {
            let match = Array.from(this.rightMultiSelect.options).find(o => o.value === rightMulti || o.value === `"${rightMulti}"`);
            if (match) this.rightMultiSelect.value = match.value;
            else this.rightMultiSelect.value = '';
        }
    }

    _onRelationStateChanged() {
        console.log('[MermaidClassToolbar] _onRelationStateChanged 発火', this.onRelationStateChange ? 'ハンドラあり' : 'ハンドラなし');
        if (typeof this.onRelationStateChange === 'function') {
            this.onRelationStateChange({
                type: this._selectedRelationType,
                leftMulti: this.leftMultiSelect.value,
                rightMulti: this.rightMultiSelect.value
            });
        }
    }

    /**
     * クラスを追加する
     */
    _addNewClass() {
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

        // classDiagram ブロックの終了行を探す
        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        // 一意なクラス名を生成
        const classId = this._generateUniqueClassId(lines, startIdx, endIdx);

        // 末尾に追加（空白行の直前）
        const newClassLine = `    class ${classId}`;
        lines.splice(endIdx, 0, newClassLine);

        const savedCodeIndex = this._diagramWrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = this._diagramWrapper.getAttribute('data-line')
            || this._diagramWrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => this._restoreEditMode(savedCodeIndex, savedDataLine), 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`クラス「${classId}」を追加しました`, 'success');
    }

    /**
     * ブロック内で未使用のクラスID（Class1, Class2, ...）を生成する
     */
    _generateUniqueClassId(lines, startIdx, endIdx) {
        const blockText = lines.slice(startIdx + 1, endIdx).join('\n');
        // 既存の Class\d+ を探す
        const used = new Set();
        const re   = /\bClass(\d+)\b/g;
        let m;
        while ((m = re.exec(blockText)) !== null) used.add(parseInt(m[1], 10));
        let n = 1;
        while (used.has(n)) n++;
        return `Class${n}`;
    }

    /**
     * 編集モード復元（再描画後に呼ばれる）
     * mermaid_sequence_toolbar.js と同一パターン
     */
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

        newDiagramWrapper.classList.add('mermaid-class-edit-mode');
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

        if (savedEdgeId) {
            if (!newDiagramWrapper._selectedRelations) {
                newDiagramWrapper._selectedRelations = new Set();
            }
            newDiagramWrapper._selectedRelations.add(savedEdgeId);
            if (window.MermaidClassInteraction && typeof window.MermaidClassInteraction._updateSelectionUI === 'function') {
                window.MermaidClassInteraction._updateSelectionUI(newDiagramWrapper);
            }
        }
    }

    // ── 表示制御 ─────────────────────────────────────────────

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
        if (this.relationMenu) {
            this.relationMenu.style.display = 'none';
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
(function initMermaidClassToolbar() {
    function tryCreate() {
        if (window.activeMermaidClassToolbar) return;
        if (typeof window.SVGToolbarBase === 'undefined') {
            console.warn('[MermaidClassToolbar] SVGToolbarBase is not defined yet.');
            return;
        }
        window.activeMermaidClassToolbar = new MermaidClassToolbar();
        console.log('[MermaidClassToolbar] インスタンス作成完了');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
        tryCreate();
    }
})();
