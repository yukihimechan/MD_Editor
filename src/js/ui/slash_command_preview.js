/**
 * Slash Command (Preview Area)
 * プレビューエリア（インライン編集など）で動作するカスタムフローティングメニュー
 */

const SlashCommandPreview = {
    element: null,
    listElement: null,
    items: [],
    filteredItems: [],
    selectedIndex: 0,
    isActive: false,
    triggerRange: null, // 発火時のRangeオブジェクト
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

        // スタイルの注入 (CM6のテーマに寄せる)
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
                .slash-command-preview ul {
                    list-style: none;
                    margin: 0;
                    padding: 0;
                }
                .slash-command-preview li {
                    padding: 4px 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                }
                .slash-command-preview li.is-selected {
                    background-color: #2c313a;
                    color: #fff;
                }
                .slash-command-preview li:hover {
                    background-color: #2c313a;
                }
                .slash-command-preview .type-icon {
                    margin-right: 8px;
                    color: #c678dd;
                    font-size: 11px;
                    width: 14px;
                    text-align: center;
                }
            `;
            document.head.appendChild(style);
        }

        // 初期データのロード
        this.items = window.getSlashCommandItems ? window.getSlashCommandItems(typeof I18n !== 'undefined' ? I18n.getLang() : 'ja') : [];
    },

    show(x, y, range) {
        console.log(`[SlashCommandPreview] show() called. x=${x}, y=${y}`);
        if (!this.element) this.init();
        
        // データ再ロード（言語変更に対応）
        this.items = window.getSlashCommandItems ? window.getSlashCommandItems(typeof I18n !== 'undefined' ? I18n.getLang() : 'ja') : [];

        this.triggerRange = range;
        this.currentKeyword = '';
        this.isActive = true;
        this.originalCoords = { top: y, left: x };
        this.element.style.display = 'block';
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y + 20}px`; // 行の下に表示
        
        this.filter('');
    },

    hide() {
        console.log(`[SlashCommandPreview] hide() called. isActive was: ${this.isActive}`);
        if (!this.element) return;
        this.isActive = false;
        this.element.style.display = 'none';
        this.triggerRange = null;
        this.currentKeyword = '';
    },

    filter(keyword) {
        console.log(`[SlashCommandPreview] filter() called. keyword='${keyword}'`);
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
            if (index === this.selectedIndex) {
                li.className = 'is-selected';
            }
            
            // アイコン部分（CM6のCompletionTypeに似せる）
            const typeSpan = document.createElement('span');
            typeSpan.className = 'type-icon';
            typeSpan.textContent = item.type ? item.type.charAt(0).toUpperCase() : 'T';
            li.appendChild(typeSpan);
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            li.appendChild(labelSpan);

            li.onmousedown = (e) => {
                e.preventDefault(); // フォーカスを奪わない
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

        // Reset to original downward position first to measure natural height
        if (this.originalCoords) {
            this.element.style.top = `${this.originalCoords.top + 20}px`;
        }

        const rect = this.element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // If it overflows the bottom of the viewport
        if (rect.bottom > viewportHeight && this.originalCoords) {
            let newTop = this.originalCoords.top - rect.height - 10;
            // Ensure it doesn't go off the top of the screen
            if (newTop < 4) newTop = 4;
            this.element.style.top = `${newTop}px`;
        }
    },

    handleKeyDown(e) {
        if (!this.isActive) return false;
        
        console.log(`[SlashCommandPreview] handleKeyDown: key=${e.key}`);

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
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.filteredItems[this.selectedIndex]) {
                this.execute(this.filteredItems[this.selectedIndex]);
            }
            return true;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            return true;
        }

        // 入力をそのまま通すが、後続のinput/keyupイベントでfilterを呼び出せるようにする
        return false;
    },

    execute(item) {
        console.log(`[SlashCommandPreview] execute() called. action=${item.action}, templateId=${item.templateId || 'none'}`);

        // フォーカスモードからのスラッシュコマンド: triggerRange不要でそのまま委譲
        const isFocusModeInsert = window.PreviewInlineEdit && window.PreviewInlineEdit._focusModeInsertSource;

        if (!isFocusModeInsert) {
            if (!this.triggerRange) {
                console.warn(`[SlashCommandPreview] execute failed: triggerRange is missing.`);
                this.hide();
                return;
            }

            const sel = window.getSelection();
            if (!sel.rangeCount) {
                this.hide();
                return;
            }

            const currentRange = sel.getRangeAt(0);
            
            // トリガーとなった '/' から現在のカーソル位置までを削除
            const deleteRange = document.createRange();
            // triggerRange.startContainer と currentRange.endContainer が同じテキストノード前提
            if (this.triggerRange.startContainer === currentRange.endContainer) {
                deleteRange.setStart(this.triggerRange.startContainer, this.triggerRange.startOffset);
                deleteRange.setEnd(currentRange.endContainer, currentRange.endOffset);
                deleteRange.deleteContents();
            }
        }

        // 挿入すべきコンテンツを組み立てる
        let contentToInsert = '';
        if (item.action === 'insert') {
            contentToInsert = item.value;
        } else if (item.action === 'insert-toc') {
            contentToInsert = `\n[TOC level=${item.level}]\n`;
        } else if (item.action === 'insert-template') {
            let locale = (typeof I18n !== 'undefined' && typeof I18n.getLang === 'function') ? I18n.getLang() : 'ja';
            if (locale.includes('-')) locale = locale.split('-')[0];
            const source = item.source || 'md';

            if (source === 'md' && typeof MD_TEMPLATES !== 'undefined' && MD_TEMPLATES[locale]) {
                const tmpl = MD_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) contentToInsert = tmpl.content;
            } else if (source === 'svg' && typeof SVG_TEMPLATES !== 'undefined' && SVG_TEMPLATES[locale]) {
                const tmpl = SVG_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) contentToInsert = tmpl.content;
            } else if (source === 'mermaid' && typeof MERMAID_TEMPLATES !== 'undefined' && MERMAID_TEMPLATES[locale]) {
                const tmpl = MERMAID_TEMPLATES[locale].find(t => t.id === item.templateId);
                if (tmpl) contentToInsert = tmpl.content;
            }

            if (!contentToInsert) {
                console.warn(`[SlashCommandPreview] Template not found: ${item.templateId}`);
            }
        }

        this.hide();

        // プレビューのInline Edit側に、Markdownへの直接挿入とフォーカス復帰処理を委譲する
        if (contentToInsert && typeof window.PreviewInlineEdit !== 'undefined' && typeof window.PreviewInlineEdit.applySlashCommandAction === 'function') {
            console.log(`[SlashCommandPreview] delegating insertion to PreviewInlineEdit.applySlashCommandAction`);
            window.PreviewInlineEdit.applySlashCommandAction(contentToInsert, item.action, item);
        } else {
            console.warn(`[SlashCommandPreview] cannot delegate insertion. contentToInsert: ${!!contentToInsert}, PreviewInlineEdit available: ${typeof window.PreviewInlineEdit !== 'undefined'}`);
        }
    }

};

window.SlashCommandPreview = SlashCommandPreview;

// グローバルイベントでクリックなどで閉じる
document.addEventListener('mousedown', (e) => {
    if (SlashCommandPreview.isActive && SlashCommandPreview.element && !SlashCommandPreview.element.contains(e.target)) {
        SlashCommandPreview.hide();
    }
});
