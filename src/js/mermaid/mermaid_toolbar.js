/**
 * MermaidToolbar - Mermaidダイアグラム編集用ツールバー
 * SVGToolbarBase を継承し、SVGエディタと同一の見た目を実現する。
 *
 * ポイント:
 *  - コンストラクタではDOMに追加しない（依存関係の問題を回避）
 *  - show(diagramWrapper) 呼び出し時に .mermaid-diagram-wrapper 内へ移動して表示
 *  - position: absolute で図の右上に浮かせる
 */
class MermaidToolbar extends SVGToolbarBase {
    constructor(options = {}) {
        super({
            id:          options.id || 'mermaid-edit-toolbar',
            container:   null,   // 初期コンテナなし（show()時に設定）
            borderColor: '#7B5EA7',
            position:    { top: '4px', left: '4px' },
        });

        this._diagramWrapper = null;
        this._currentTool    = null;

        // ツール定義（svg_custom_toolbar.js と同じ形式）
        this._toolDefs = [
            {
                id:    'rect',
                label: '処理ノードを追加（四角）',
                // viewBox="0 0 24 24" の四角アイコン
                icon:    `<rect x="3" y="6" width="18" height="12" rx="2" stroke-width="2"/>`,
                viewBox: '0 0 24 24',
            },
            {
                id:    'diamond',
                label: '条件ノードを追加（ひし形）',
                // viewBox="0 0 24 24" のひし形アイコン
                icon:    `<polygon points="12,3 21,12 12,21 3,12" stroke-width="2"/>`,
                viewBox: '0 0 24 24',
            },
            {
                id:    'capsule',
                label: '開始・終了ノードを追加（角丸）',
                icon:    `<rect x="2" y="6" width="20" height="12" rx="6" stroke-width="2"/>`,
                viewBox: '0 0 24 24',
            },
            {
                id:    'subgraph',
                label: 'グループ（サブグラフ）を追加',
                // 点線の四角アイコン
                icon:    `<rect x="2" y="2" width="20" height="20" rx="2" stroke-width="2" stroke-dasharray="4,2"/>`,
                viewBox: '0 0 24 24',
            },
            { isSeparator: true },
            {
                id:    'direction',
                label: '縦・横（TB/LR）の切り替え',
                icon:    `<path d="M4 12v-3a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 12v3a3 3 0 0 1-3 3H4m3 3-3-3 3-3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
                viewBox: '0 0 24 24',
            }
        ];

        // ツールバーを生成（DOMへの追加はまだ行わない）
        this._buildToolbar();
    }

    // ── ツールバー生成 ────────────────────────────────────────────────

    _buildToolbar() {
        // SVGToolbarBase.createBaseToolbar() でドラッグハンドル・コンテンツ領域・伸縮ハンドルを生成
        const { toolbar, contentArea } = this.createBaseToolbar({
            id:          this.id,
            borderColor: this.config.borderColor,
            position:    this.config.position,
        });

        this.toolbarElement = toolbar;
        this.contentArea    = contentArea;

        // 各ツールボタンを追加
        this._toolDefs.forEach(t => {
            if (t.isSeparator) {
                const sep = document.createElement('div');
                sep.style.width = '1px';
                sep.style.height = '16px';
                sep.style.backgroundColor = 'rgba(0,0,0,0.1)';
                sep.style.margin = '0 4px';
                contentArea.appendChild(sep);
                return;
            }

            const btn = document.createElement('button');
            btn.title        = t.label;
            btn.dataset.tool = t.id;
            // svg_custom_toolbar.js と同じ形式でSVGアイコンを埋め込む
            btn.innerHTML = `<svg width="18" height="18" viewBox="${t.viewBox}"
                style="pointer-events:none; overflow:hidden; display:block; flex-shrink:0;"
                fill="none" stroke="currentColor">${t.icon}</svg>`;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onToolClick(t.id);
            });

            contentArea.appendChild(btn);
        });

        // 初期は非表示にしておく
        toolbar.style.display = 'none';
    }

    _onToolClick(toolId) {
        if (!this._diagramWrapper) return;

        if (toolId === 'direction') {
            if (this._diagramWrapper._mermaidAPI && typeof this._diagramWrapper._mermaidAPI.toggleDirection === 'function') {
                this._diagramWrapper._mermaidAPI.toggleDirection();
            }
            return;
        }

        // クリックした瞬間だけアクティブスタイルを表示し、
        // ノード追加完了後（再描画後）に自動で解除する（ワンショット動作）
        this._currentTool = toolId;
        this._syncActiveState();

        this._addNode(this._diagramWrapper, toolId);
        // ※ _addNode → 再描画 → _restoreEditMode の中で
        //   this._currentTool = null が呼ばれてリセットされる
    }

    _syncActiveState() {
        if (!this.contentArea) return;
        this.contentArea.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === this._currentTool);
        });
    }

    // ── ノード追加 ────────────────────────────────────────────────────

    _addNode(diagramWrapper, toolId) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') {
            console.warn('[MermaidToolbar] getEditorText/setEditorText が未定義です');
            return;
        }

        // data-line からMermaidブロック開始行を特定
        let dataLine = parseInt(diagramWrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = diagramWrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) {
            console.warn('[MermaidToolbar] data-line が取得できません');
            return;
        }

        const fullText = getEditorText();
        const lines    = fullText.split('\n');
        let startIdx   = dataLine - 1;

        const isMermaidLine = (l) => /^\s*(?:```|~~~)mermaid/.test(l || '');
        if (!isMermaidLine(lines[startIdx])) {
            let found = -1;
            for (let d = -5; d <= 5; d++) {
                if (isMermaidLine(lines[startIdx + d])) { found = startIdx + d; break; }
            }
            if (found === -1) { console.warn('[MermaidToolbar] ```mermaid が見つかりません'); return; }
            startIdx = found;
        }

        const fenceChar = lines[startIdx].trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) { console.warn('[MermaidToolbar] 閉じ ``` が見つかりません'); return; }

        const blockText = lines.slice(startIdx, endIdx + 1).join('\n');
        const nodeId    = this._generateUniqueId(blockText);

        let nodeLabel = '処理';
        if (toolId === 'diamond') nodeLabel = '条件';
        if (toolId === 'capsule') nodeLabel = '開始・終了';
        if (toolId === 'subgraph') nodeLabel = 'グループ';

        let nodeText = '';
        if (toolId === 'subgraph') {
            nodeText = `    subgraph ${nodeId} [${nodeLabel}]\n    end`;
        } else {
            nodeText = toolId === 'diamond'
                ? `    ${nodeId}{${nodeLabel}}`
                : toolId === 'capsule'
                    ? `    ${nodeId}(${nodeLabel})`
                    : `    ${nodeId}[${nodeLabel}]`;
        }

        let targetIdx = endIdx;
        if (diagramWrapper._mermaidAPI && typeof diagramWrapper._mermaidAPI.getInsertTargetIndex === 'function') {
            const idx = diagramWrapper._mermaidAPI.getInsertTargetIndex();
            if (idx !== -1) targetIdx = idx;
        }

        lines.splice(targetIdx, 0, nodeText);

        const savedCodeIndex = diagramWrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = diagramWrapper.getAttribute('data-line')
            || diagramWrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                this._restoreEditMode(savedCodeIndex, savedDataLine);
                this._currentTool = null;
                this._syncActiveState();
            }, 100);
        }, 50);

        if (typeof showToast === 'function') {
            showToast(`${nodeLabel}ノード「${nodeId}」を追加しました`, 'success');
        }
    }

    _generateUniqueId(blockText) {
        const existingIds = new Set();
        const pat = /\b([A-Za-z][A-Za-z0-9_]*)\b/g;
        let m;
        while ((m = pat.exec(blockText)) !== null) existingIds.add(m[1]);
        let idx = 1;
        while (existingIds.has(`N${idx}`)) idx++;
        return `N${idx}`;
    }

    // ── 編集モード復元（再描画後） ────────────────────────────────────

    _restoreEditMode(savedCodeIndex, savedDataLine) {
        const preview = document.getElementById('preview');
        if (!preview) return;

        let newDiagramWrapper   = null;
        let newCodeBlockWrapper = null;

        if (savedCodeIndex !== undefined) {
            newCodeBlockWrapper = preview.querySelector(`.code-block-wrapper[data-code-index="${savedCodeIndex}"]`);
            if (newCodeBlockWrapper) newDiagramWrapper = newCodeBlockWrapper.querySelector('.mermaid-diagram-wrapper');
        }
        if (!newDiagramWrapper && savedDataLine) {
            newDiagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${savedDataLine}"]`);
            if (newDiagramWrapper && !newCodeBlockWrapper) newCodeBlockWrapper = newDiagramWrapper.closest('.code-block-wrapper');
        }

        if (!newDiagramWrapper) return;

        // 「完了」で既に編集終了している場合は復元しない（競合防止）
        if (typeof InlineCodeEditor !== 'undefined' && !InlineCodeEditor.activeMermaidWrapper) return;

        newDiagramWrapper.classList.add('mermaid-edit-mode');
        this.show(newDiagramWrapper);  // ツールバーを新しいwrapperに移動

        if (typeof InlineCodeEditor !== 'undefined' && InlineCodeEditor.activeMermaidWrapper) {
            InlineCodeEditor._activeMermaidDiagram = newDiagramWrapper;
            if (newCodeBlockWrapper) InlineCodeEditor.activeMermaidWrapper = newCodeBlockWrapper;
        }

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
    }

    // ── 公開API: 表示制御 ─────────────────────────────────────────────

    /**
     * 編集モード開始時に呼び出す。
     * ツールバーを diagramWrapper の内側にアタッチして右上に表示する。
     * @param {Element} diagramWrapper - .mermaid-diagram-wrapper
     */
    show(diagramWrapper) {
        if (!this.toolbarElement) return;

        // 別のdiagramWrapperから移動する場合は取り外す
        if (this.toolbarElement.parentNode && this.toolbarElement.parentNode !== diagramWrapper) {
            this.toolbarElement.parentNode.removeChild(this.toolbarElement);
        }

        // diagramWrapper に追加（まだ追加されていない場合）
        if (!this.toolbarElement.parentNode) {
            diagramWrapper.appendChild(this.toolbarElement);
        }

        this._diagramWrapper = diagramWrapper;

        // ツールバーを右上に配置
        this.toolbarElement.style.position = 'absolute';
        this.toolbarElement.style.top      = '6px';
        this.toolbarElement.style.left     = '6px';
        this.toolbarElement.style.right    = 'auto';
        this.toolbarElement.style.display  = 'flex';
        this.toolbarElement.style.zIndex   = '1200';
    }

    /** 編集モード終了時に呼び出す。 */
    hide() {
        this._diagramWrapper = null;
        this._currentTool    = null;
        this._syncActiveState();
        if (this.toolbarElement && this.toolbarElement.parentNode) {
            this.toolbarElement.parentNode.removeChild(this.toolbarElement);
        }
    }

    destroy() {
        if (this.toolbarElement && this.toolbarElement.parentNode) {
            this.toolbarElement.parentNode.removeChild(this.toolbarElement);
        }
        this.toolbarElement = null;
    }
}

// グローバルに公開
window.MermaidToolbar = MermaidToolbar;

// ── 自律初期化 ────────────────────────────────────────────────────────
// インスタンス作成のみ行う（DOMへの追加は show() 時に行う）
(function initMermaidToolbar() {
    function tryCreate() {
        if (window.activeMermaidToolbar) return;
        if (typeof SVGToolbarBase === 'undefined') return; // 依存クラスが未ロード

        window.activeMermaidToolbar = new MermaidToolbar({ id: 'mermaid-edit-toolbar' });
        console.log('[MermaidToolbar] インスタンス作成完了');
    }

    // スクリプトは body 末尾に配置されるため、DOM は構築済みのはず
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
        tryCreate();
    }
})();
