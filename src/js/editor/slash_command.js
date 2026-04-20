/**
 * Slash Command (Editor)
 * CodeMirror 6 の純正 autocompletion は記号のトリガーで仕様上の制限があるため、
 * プレビュー機能で使用しているものと同様のカスタムコンテキストメニュー(SlashCommandEditor)を実装します。
 */

const SlashCommandEditor = {
    element: null,
    listElement: null,
    items: [],
    filteredItems: [],
    selectedIndex: 0,
    isActive: false,
    view: null,
    triggerPos: null, // '/' の文字の開始位置 (ここから現在のカーソルまでを置換)
    currentKeyword: '',

    init() {
        if (this.element) return;

        this.element = document.createElement('div');
        this.element.className = 'cm-tooltip cm-tooltip-autocomplete slash-command-preview';
        this.element.style.display = 'none';
        this.element.style.position = 'absolute';
        this.element.style.zIndex = '9999';

        this.listElement = document.createElement('ul');
        this.listElement.className = 'cm-tooltip-autocomplete-list';
        this.element.appendChild(this.listElement);

        document.body.appendChild(this.element);

        // Preview側のスタイル再利用（無ければ定義）
        if (!document.getElementById('slash-command-preview-style')) {
            const style = document.createElement('style');
            style.id = 'slash-command-preview-style';
            style.textContent = `
                .slash-command-preview {
                    background-color: #282c34;
                    border: 1px solid #181a1f;
                    border-radius: 4px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                    color: #abb2bf;
                    font-family: inherit;
                    font-size: 13px;
                    max-height: 250px;
                    overflow-y: auto;
                    min-width: 200px;
                }
                .slash-command-preview ul { list-style: none; margin: 0; padding: 0; }
                .slash-command-preview li { padding: 4px 8px; cursor: pointer; display: flex; align-items: center; }
                .slash-command-preview li.is-selected { background-color: #2c313a; color: #fff; }
                .slash-command-preview li:hover { background-color: #2c313a; }
                .slash-command-preview .type-icon { margin-right: 8px; color: #c678dd; font-size: 11px; width: 14px; text-align: center; }
            `;
            document.head.appendChild(style);
        }
    },

    show(view, pos) {
        if (!this.element) this.init();
        
        // データリロード
        this.items = window.getSlashCommandItems ? window.getSlashCommandItems(typeof I18n !== 'undefined' ? I18n.getLang() : 'ja') : [];
        this.view = view;
        this.triggerPos = pos;
        this.isActive = true;
        this.currentKeyword = '';
        
        // CM6 からカーソル座標を取得
        const coords = view.coordsAtPos(pos);
        if (coords) {
            this.originalCoords = { top: coords.top, bottom: coords.bottom, left: coords.left };
            this.element.style.left = `${coords.left}px`;
            this.element.style.top = `${coords.bottom + 4}px`; // 行のちょっと下に表示
        } else {
            this.originalCoords = null;
            // スクロール外などの場合は適当に置くか非表示
            this.element.style.left = '50%';
            this.element.style.top = '50%';
        }
        
        this.element.style.display = 'block';
        this.filter('');
    },

    hide() {
        if (!this.element) return;
        this.isActive = false;
        this.element.style.display = 'none';
        this.view = null;
        this.triggerPos = null;
        this.currentKeyword = '';
    },

    filter(keyword) {
        this.currentKeyword = keyword.toLowerCase();
        
        if (this.currentKeyword === '') {
            this.filteredItems = this.items;
        } else {
            this.filteredItems = this.items.filter(item => {
                const textMatch = item.label.toLowerCase().includes(this.currentKeyword);
                const kwMatch = item.keywords && item.keywords.some(k => k.toLowerCase().includes(this.currentKeyword));
                return textMatch || kwMatch;
            });
        }

        this.selectedIndex = 0;
        this.render();

        if (this.filteredItems.length === 0) {
            this.hide();
        }
    },

    render() {
        this.listElement.innerHTML = '';
        
        this.filteredItems.forEach((item, index) => {
            const li = document.createElement('li');
            if (index === this.selectedIndex) li.className = 'is-selected';
            
            const typeSpan = document.createElement('span');
            typeSpan.className = 'type-icon';
            typeSpan.textContent = item.type ? item.type.charAt(0).toUpperCase() : 'T';
            li.appendChild(typeSpan);
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            li.appendChild(labelSpan);

            li.onmousedown = (e) => {
                e.preventDefault(); 
                this.execute(item);
            };

            this.listElement.appendChild(li);
        });

        const selected = this.listElement.querySelector('.is-selected');
        if (selected) selected.scrollIntoView({ block: 'nearest' });

        this.adjustPosition();
    },

    adjustPosition() {
        if (!this.isActive || !this.element || this.filteredItems.length === 0) return;

        // Reset to original bottom position first to measure natural height
        if (this.originalCoords) {
            this.element.style.top = `${this.originalCoords.bottom + 4}px`;
        }

        const rect = this.element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // If it overflows the bottom of the viewport
        if (rect.bottom > viewportHeight && this.originalCoords) {
            let newTop = this.originalCoords.top - rect.height - 4;
            // Ensure it doesn't go off the top of the screen
            if (newTop < 4) newTop = 4;
            this.element.style.top = `${newTop}px`;
        }
    },

    handleKeyDown(e) {
        if (!this.isActive) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
            this.render();
            return true;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.render();
            return true;
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            if (this.filteredItems[this.selectedIndex]) {
                this.execute(this.filteredItems[this.selectedIndex]);
            }
            return true;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            // エスケープしたときは単なる文字入力として継続させる
            return true;
        }
        return false;
    },

    updateFilter() {
        if (!this.isActive || !this.view) return;
        const currentPos = this.view.state.selection.main.head;
        if (currentPos < this.triggerPos) {
            // キャレットがトリガーよりも前に戻ったら閉じる
            this.hide();
            return;
        }
        const text = this.view.state.sliceDoc(this.triggerPos, currentPos);
        // 空白が含まれたら連続したコマンドではないとみなして閉じる
        if (/[\s\n]/.test(text)) {
            this.hide();
            return;
        }
        // スラッシュ以降の文字でフィルタリング
        this.filter(text.substring(1)); // 最初の一文字目は '/' なので飛ばす
    },

    execute(item) {
        if (!this.view || this.triggerPos === null) {
            this.hide();
            return;
        }

        const view = this.view;
        const from = this.triggerPos;
        const to = view.state.selection.main.head;

        if (item.action === 'insert') {
            view.dispatch({
                changes: { from: from, to: to, insert: item.value },
                selection: { anchor: from + item.value.length }
            });
        } else if (item.action === 'insert-toc') {
            const tocStr = `\n[TOC level=${item.level}]\n`;
            view.dispatch({
                changes: { from: from, to: to, insert: tocStr },
                selection: { anchor: from + tocStr.length }
            });
        } else if (item.action === 'insert-template') {
            let locale = (typeof I18n !== 'undefined' && typeof I18n.getLang === 'function') ? I18n.getLang() : 'ja';
            if (locale.includes('-')) locale = locale.split('-')[0];
            const source = item.source || 'md';
            let content = '';

            if (source === 'md' && typeof MD_TEMPLATES !== 'undefined' && MD_TEMPLATES[locale]) {
                const tmpl = MD_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) content = tmpl.content;
            } else if (source === 'svg' && typeof SVG_TEMPLATES !== 'undefined' && SVG_TEMPLATES[locale]) {
                const tmpl = SVG_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) content = tmpl.content;
            } else if (source === 'mermaid' && typeof MERMAID_TEMPLATES !== 'undefined' && MERMAID_TEMPLATES[locale]) {
                const tmpl = MERMAID_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) content = tmpl.content;
            }

            if (content) {
                view.dispatch({
                    changes: { from: from, to: to, insert: content },
                    selection: { anchor: from + content.length }
                });
            } else {
                console.warn(`[SlashCommand] Template not found: ${item.templateId}`);
                view.dispatch({ changes: { from: from, to: to, insert: '' } }); // ただ消すだけ
            }
        }

        this.hide();
        view.focus();
    }
};

window.SlashCommandEditor = SlashCommandEditor;

document.addEventListener('mousedown', (e) => {
    if (SlashCommandEditor.isActive && SlashCommandEditor.element && !SlashCommandEditor.element.contains(e.target)) {
        SlashCommandEditor.hide();
    }
});
