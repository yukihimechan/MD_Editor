/**
 * MermaidSequenceToolbar - Mermaidシーケンス図編集用ツールバー
 * プレビュー画面でシーケンス図のコードブロックに「編集」ボタンを押したときに表示される専用ツールバー
 */
class MermaidSequenceToolbar extends window.SVGToolbarBase {
    constructor() {
        super();
        this.id = 'mermaid-sequence-toolbar';
        this.config = {
            position: 'top-right',
            borderColor: '#3b82f6', // Mermaidの基調色に合わせる
            isGlobal: true          // ダイアグラム全体に対するツールバー
        };

        // シーケンス図用ツールボタン定義
        this._toolDefs = [
            {
                id:    'actor',
                label: 'Actorを追加',
                icon:  `<path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 10c-4.418 0-8 3.582-8 8h16c0-4.418-3.582-8-8-8z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>`,
                viewBox: '0 0 24 24',
            },
            {
                id:    'participant',
                label: 'Participantを追加',
                icon:  `<rect x="3" y="6" width="18" height="12" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" stroke-width="2"/>`,
                viewBox: '0 0 24 24',
            }
        ];

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

        // 各ツールボタンを追加
        this._toolDefs.forEach(t => {
            const btn = document.createElement('button');
            btn.title        = t.label;
            btn.dataset.tool = t.id;
            btn.innerHTML = `<svg width="18" height="18" viewBox="${t.viewBox}"
                style="pointer-events:none; overflow:hidden; display:block; flex-shrink:0;"
                fill="none" stroke="currentColor">${t.icon}</svg>`;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onToolClick(t.id);
            });

            contentArea.appendChild(btn);
        });

        // 矢印の種類を変更するセレクトボックスを追加
        const selectWrapper = document.createElement('div');
        selectWrapper.style.cssText = 'margin-left: 8px; display: flex; align-items: center; border-left: 1px solid #ccc; padding-left: 8px;';
        
        this.arrowSelect = document.createElement('select');
        this.arrowSelect.style.cssText = 'padding: 2px 4px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; cursor: pointer;';
        // 初期状態は無効（何も選択されていない時）
        this.arrowSelect.disabled = true;

        const arrowTypes = [
            { value: '->>', label: '->> (実線/塗り矢印)' },
            { value: '-->>', label: '-->> (点線/塗り矢印)' },
            { value: '-)', label: '-) (実線/オープン矢印)' },
            { value: '--)', label: '--) (点線/オープン矢印)' },
            { value: '-x', label: '-x (実線/バツ印)' },
            { value: '--x', label: '--x (点線/バツ印)' },
            { value: '->', label: '-> (実線/通常矢印)' },
            { value: '-->', label: '--> (点線/通常矢印)' }
        ];

        // デフォルトの非選択用オプション
        const defaultOpt = document.createElement('option');
        defaultOpt.value = "";
        defaultOpt.textContent = "メッセージを選択...";
        this.arrowSelect.appendChild(defaultOpt);

        arrowTypes.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type.value;
            opt.textContent = type.label;
            this.arrowSelect.appendChild(opt);
        });

        this.arrowSelect.addEventListener('change', (e) => {
            // テキストが空でもインデックスが有効なら変更可能にする
            if (!this.arrowSelect.disabled && (this._selectedMessageText !== null || this._selectedMessageIndex !== -1)) {
                this._changeArrowType(e.target.value); // テキストは渡さず、変更後の矢印だけを渡す
            }
        });

        selectWrapper.appendChild(this.arrowSelect);
        contentArea.appendChild(selectWrapper);

        // 初期は非表示にしておく
        toolbar.style.display = 'none';
    }

    /**
     * インタラクションから呼ばれる：選択されたメッセージの情報を受け取る
     * @param {string} messageText 選択されたメッセージテキスト
     * @param {string} currentArrow 現在の矢印の種類 (->> など)
     * @param {number} messageIndex 何番目のメッセージか
     */
    setSelectedMessage(messageText, currentArrow, messageIndex = -1) {
        if (!messageText && currentArrow == null) {
            this.arrowSelect.value = "";
            this.arrowSelect.disabled = true;
            this._selectedMessageText = null;
            this._selectedMessageIndex = -1;
        } else {
            this.arrowSelect.disabled = false;
            this._selectedMessageText = messageText || ""; // null回避
            this._selectedMessageIndex = messageIndex; // インデックスを記憶
            if (currentArrow) {
                this.arrowSelect.value = currentArrow;
            } else {
                this.arrowSelect.value = "";
            }
        }
    }

    /**
     * ソースコード内の特定のメッセージ行の矢印を変更する
     */
    _changeArrowType(newArrowType) {
        if (!this._diagramWrapper) return;
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let dataLine = parseInt(this._diagramWrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = this._diagramWrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const editorText = getEditorText();
        const lines = editorText.split('\n');
        
        const startIdx = dataLine - 1;
        let endIdx = lines.length; 
        
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('```')) {
                endIdx = i;
                break;
            }
        }

        let replaced = false;

        // === 1. インデックスによる確実な置換 ===
        if (this._selectedMessageIndex !== undefined && this._selectedMessageIndex !== -1) {
            const skipWords = "note|loop|alt|opt|par|and|rect|break|critical|option|end|else|activate|deactivate|autonumber|participant|actor|box|title|link|links|create|destroy";
            const re = new RegExp(`^(?!\\s*%%)(\\s*(?!(?:${skipWords})\\b).+?)(->>|-->>|-\\)|--\\)|-x|--x|->|-->)(.*)$`, 'i');
            let count = 0;
            
            for (let i = startIdx + 1; i < endIdx; i++) {
                const match = lines[i].match(re);
                if (match) {
                    if (count === this._selectedMessageIndex) {
                        console.log(`[Toolbar] 置換実行! index:${this._selectedMessageIndex}, 前:${lines[i]}`);
                        // match[1]=送信元, match[3]=送信先以降 (+B: req など) をそのまま残し、矢印だけ差し替える
                        lines[i] = `${match[1]}${newArrowType}${match[3]}`;
                        replaced = true;
                        break;
                    }
                    count++;
                }
            }
        }

        // === 2. インデックスが無効な場合のフォールバック（旧テキスト検索） ===
        if (!replaced && this._selectedMessageText) {
            const safeText = this._selectedMessageText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`^(\\s*.+?)(->>|-->>|-\\)|--\\)|-x|--x|->|-->)(.+?:\\s*)${safeText}\\s*$`, 'i');
            for (let i = startIdx + 1; i < endIdx; i++) {
                const match = lines[i].match(re);
                if (match) {
                    console.log(`[Toolbar] フォールバック置換実行! 前:${lines[i]}`);
                    lines[i] = `${match[1]}${newArrowType}${match[3]}`;
                    replaced = true;
                    break;
                }
            }
        }

        if (replaced) {
            const newText = lines.join('\n');
            if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
            setEditorText(newText);
            
            // 重要: 置換直後に古いインデックスをクリアし、誤爆を防ぐ
            this._selectedMessageIndex = -1;
            
            this._lastEditedLine = dataLine;
            console.log(`[Toolbar] _changeArrowType完了. 再描画後に復元します. targetLine: ${dataLine}`);
            if (typeof render === 'function') {
                setTimeout(() => {
                    console.log(`[Toolbar] render() を呼び出します`);
                    render();
                    setTimeout(() => {
                        console.log(`[Toolbar] render() 完了. _restoreEditMode() を呼び出します`);
                        this._restoreEditMode();
                    }, 100);
                }, 50);
            }
        }
    }

    _onToolClick(toolId) {
        if (!this._diagramWrapper) return;

        // クリックした瞬間だけアクティブスタイルを表示し、追加完了後（再描画後）に自動で解除
        this._currentTool = toolId;
        this._syncActiveState();

        this._addNode(this._diagramWrapper, toolId);
    }

    _syncActiveState() {
        if (!this.contentArea) return;
        this.contentArea.querySelectorAll('button[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === this._currentTool);
        });
    }

    _addNode(diagramWrapper, toolId) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') {
            console.warn('[MermaidSequenceToolbar] getEditorText/setEditorText が未定義です');
            return;
        }

        // data-line からMermaidブロック開始行を特定
        let dataLine = parseInt(diagramWrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = diagramWrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) {
            console.error('[MermaidSequenceToolbar] data-line が見つかりません', diagramWrapper);
            return;
        }

        const editorText = getEditorText();
        const lines = editorText.split('\n');
        
        // 0-indexed に変換してマーメードブロックの開始位置を探索
        const startIdx = dataLine - 1;
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('\`\`\`')) {
                endIdx = i;
                break;
            }
        }

        if (endIdx === -1) {
            console.error('[MermaidSequenceToolbar] マーメードブロックの終了が見つかりません');
            return;
        }

        // 追加するコードの生成
        const newNodeId = this._generateUniqueId(lines, startIdx, endIdx, toolId);
        let nodeCode = '';
        if (toolId === 'actor') {
            nodeCode = `    actor ${newNodeId} as ユーザー`;
        } else if (toolId === 'participant') {
            nodeCode = `    participant ${newNodeId} as システム`;
        }

        if (!nodeCode) return;

        // participant/actor 定義の最後尾（あるいはブロックの最後）に挿入する
        let insertIdx = endIdx;
        
        lines.splice(insertIdx, 0, nodeCode);
        const newText = lines.join('\n');

        if (typeof UndoRedoManager !== 'undefined') UndoRedoManager.push(newText);
        setEditorText(newText);
        
        // _diagramWrapper を再描画後に復元できるようマーク
        this._lastEditedLine = dataLine;
        console.log(`[MermaidSequenceToolbar] _addNode完了. 再描画後に復元します. targetLine: ${dataLine}`);

        if (typeof render === 'function') {
            setTimeout(() => {
                console.log(`[MermaidSequenceToolbar] render() を呼び出します`);
                render();
                setTimeout(() => {
                    console.log(`[MermaidSequenceToolbar] render() 完了. _restoreEditMode() を呼び出します`);
                    this._restoreEditMode();
                }, 100);
            }, 50);
        }
    }

    _generateUniqueId(lines, startIdx, endIdx, prefix) {
        // 例: actor1, actor2, participant1...
        const baseName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        let maxNum = 0;
        
        // prefix に続く数字を探す正規表現
        const re = new RegExp(`\\b${baseName}(\\d+)\\b`);

        for (let i = startIdx; i < endIdx; i++) {
            const line = lines[i];
            const m = line.match(re);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
        return `${baseName}${maxNum + 1}`;
    }

    _restoreEditMode() {
        console.log(`[MermaidSequenceToolbar] _restoreEditMode開始. _lastEditedLine: ${this._lastEditedLine}`);
        if (!this._lastEditedLine) return;
        
        const preview = document.getElementById('preview') || document;
        let targetWrapper = null;

        // まず mermaid-diagram-wrapper に data-line がついているか探す
        const diagramWrapper = preview.querySelector(`.mermaid-diagram-wrapper[data-line="${this._lastEditedLine}"]`);
        if (diagramWrapper) {
            targetWrapper = diagramWrapper.closest('.code-block-wrapper');
            console.log(`[MermaidSequenceToolbar] diagramWrapperからtargetWrapperを見つけました`);
        } else {
            // 見つからなければ code-block-wrapper を直接探す
            const wrappers = preview.querySelectorAll('.code-block-wrapper');
            for (const w of wrappers) {
                if (w.getAttribute('data-line') === String(this._lastEditedLine)) {
                    targetWrapper = w;
                    console.log(`[MermaidSequenceToolbar] code-block-wrapperの直接検索で見つけました`);
                    break;
                }
            }
        }

        if (targetWrapper) {
            console.log(`[MermaidSequenceToolbar] targetWrapper:`, targetWrapper);
            if (typeof InlineCodeEditor !== 'undefined' && typeof InlineCodeEditor.startMermaidEdit === 'function') {
                console.log(`[MermaidSequenceToolbar] InlineCodeEditor.startMermaidEdit を呼び出します`);
                InlineCodeEditor.startMermaidEdit(targetWrapper);
            } else {
                console.warn(`[MermaidSequenceToolbar] InlineCodeEditor.startMermaidEdit が見つかりません`);
            }
        } else {
            console.warn(`[MermaidSequenceToolbar] 指定したdata-lineの要素が見つかりませんでした: ${this._lastEditedLine}`);
        }

        this._lastEditedLine = null;
        this._currentTool = null;
        this._syncActiveState();
    }

    // 表示メソッド（インラインエディタから呼ばれる）
    show(diagramWrapper) {
        console.log('[MermaidSequenceToolbar] show() が呼ばれました');
        this._diagramWrapper = diagramWrapper;
        if (!this.toolbarElement.parentNode) {
            document.body.appendChild(this.toolbarElement);
        }
        this.toolbarElement.style.display = 'flex';

        // 位置の更新
        this.updatePosition();

        // リサイズ時の追従
        if (!this._resizeHandler) {
            this._resizeHandler = () => this.updatePosition();
            window.addEventListener('resize', this._resizeHandler);
            if (DOM && DOM.preview) DOM.preview.addEventListener('scroll', this._resizeHandler);
        }
    }

    hide() {
        this.toolbarElement.style.display = 'none';
        this._diagramWrapper = null;
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            if (DOM && DOM.preview) DOM.preview.removeEventListener('scroll', this._resizeHandler);
            this._resizeHandler = null;
        }
    }

    updatePosition() {
        if (!this._diagramWrapper || this.toolbarElement.style.display === 'none') return;
        
        const rect = this._diagramWrapper.getBoundingClientRect();
        
        // 左上に配置
        let top = rect.top + window.scrollY + 10;
        let left = rect.left + window.scrollX + 10;

        this.toolbarElement.style.top = `${top}px`;
        this.toolbarElement.style.left = `${left}px`;
    }
}

// ── 自律初期化 ────────────────────────────────────────────────────────
// インスタンス作成のみ行う（DOMへの追加は show() 時に行う）
(function initMermaidSequenceToolbar() {
    function tryCreate() {
        if (window.activeMermaidSequenceToolbar) return;
        if (typeof window.SVGToolbarBase === 'undefined') {
            console.warn('[MermaidSequenceToolbar] SVGToolbarBase is not defined yet.');
            return; // 依存クラスが未ロード
        }

        window.activeMermaidSequenceToolbar = new MermaidSequenceToolbar();
        console.log('[MermaidSequenceToolbar] インスタンス作成完了');
    }

    // スクリプトは body 末尾に配置されるため、DOM は構築済みのはず
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
        tryCreate();
    }
})();
