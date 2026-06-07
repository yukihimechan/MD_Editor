/**
 * Math Slash Command Editor
 * Suggestion box specifically for the MathInlineEditor triggered by '\'.
 */

const MathSlashCommand = {
    element: null,
    listElement: null,
    items: [],
    filteredItems: [],
    selectedIndex: 0,
    isActive: false,
    view: null,
    triggerPos: null,
    currentKeyword: '',
    mathField: null,       // MathLive の math-field 要素（MathLive 経由時）

    init() {
        if (this.element) return;

        this.element = document.createElement('div');
        this.element.className = 'cm-tooltip cm-tooltip-autocomplete slash-command-preview math-slash-command';
        this.element.style.display = 'none';
        this.element.style.position = 'absolute';
        this.element.style.zIndex = '10001';

        this.listElement = document.createElement('ul');
        this.listElement.className = 'cm-tooltip-autocomplete-list';
        this.element.appendChild(this.listElement);

        document.body.appendChild(this.element);

        this.initItems();

        // スクロール時にサジェストを自動で閉じる
        window.addEventListener('scroll', () => {
            if (this.isActive) {
                this.hide();
            }
        }, true); // キャプチャフェーズで監視し、任意の要素（プレビュー等）のスクロールも検知する
    },

    initItems() {
        // Define common LaTeX symbols based on Mathcha's documentation and standard KaTeX
        const mathItems = [
            { label: '\\alpha', value: '\\alpha', type: 'symbol', keywords: ['alpha', 'a', 'アルファ'] },
            { label: '\\beta', value: '\\beta', type: 'symbol', keywords: ['beta', 'b', 'ベータ'] },
            { label: '\\gamma', value: '\\gamma', type: 'symbol', keywords: ['gamma', 'g', 'ガンマ'] },
            { label: '\\delta', value: '\\delta', type: 'symbol', keywords: ['delta', 'd', 'デルタ'] },
            { label: '\\epsilon', value: '\\epsilon', type: 'symbol', keywords: ['epsilon', 'e', 'イプシロン'] },
            { label: '\\zeta', value: '\\zeta', type: 'symbol', keywords: ['zeta', 'z', 'ゼータ'] },
            { label: '\\eta', value: '\\eta', type: 'symbol', keywords: ['eta', 'e', 'イータ'] },
            { label: '\\theta', value: '\\theta', type: 'symbol', keywords: ['theta', 't', 'シータ'] },
            { label: '\\iota', value: '\\iota', type: 'symbol', keywords: ['iota', 'i', 'イオタ'] },
            { label: '\\kappa', value: '\\kappa', type: 'symbol', keywords: ['kappa', 'k', 'カッパ'] },
            { label: '\\lambda', value: '\\lambda', type: 'symbol', keywords: ['lambda', 'l', 'ラムダ'] },
            { label: '\\mu', value: '\\mu', type: 'symbol', keywords: ['mu', 'm', 'ミュー'] },
            { label: '\\nu', value: '\\nu', type: 'symbol', keywords: ['nu', 'n', 'ニュー'] },
            { label: '\\xi', value: '\\xi', type: 'symbol', keywords: ['xi', 'x', 'グサイ'] },
            { label: '\\pi', value: '\\pi', type: 'symbol', keywords: ['pi', 'p', 'パイ'] },
            { label: '\\rho', value: '\\rho', type: 'symbol', keywords: ['rho', 'r', 'ロー'] },
            { label: '\\sigma', value: '\\sigma', type: 'symbol', keywords: ['sigma', 's', 'シグマ'] },
            { label: '\\tau', value: '\\tau', type: 'symbol', keywords: ['tau', 't', 'タウ'] },
            { label: '\\upsilon', value: '\\upsilon', type: 'symbol', keywords: ['upsilon', 'u', 'ウプシロン'] },
            { label: '\\phi', value: '\\phi', type: 'symbol', keywords: ['phi', 'f', 'ファイ'] },
            { label: '\\chi', value: '\\chi', type: 'symbol', keywords: ['chi', 'c', 'カイ'] },
            { label: '\\psi', value: '\\psi', type: 'symbol', keywords: ['psi', 'p', 'プサイ'] },
            { label: '\\omega', value: '\\omega', type: 'symbol', keywords: ['omega', 'o', 'オメガ'] },

            // Layout & Operators
            { label: '\\frac{x}{y}', value: '\\frac{x}{y}', type: 'layout', keywords: ['frac', 'fraction', '分数'] },
            { label: '\\sqrt{x}', value: '\\sqrt{x}', type: 'layout', keywords: ['sqrt', 'square root', 'ルート', '平方根'] },
            { label: '\\int', value: '\\int_{a}^{b}', type: 'operator', keywords: ['int', 'integral', '積分'] },
            { label: '\\sum', value: '\\sum_{i=0}^{n}', type: 'operator', keywords: ['sum', 'summation', 'シグマ', '和'] },
            { label: '\\prod', value: '\\prod', type: 'operator', keywords: ['prod', 'product', '積'] },
            { label: '\\lim', value: '\\lim_{x \\to \\infty}', type: 'operator', keywords: ['lim', 'limit', '極限'] },

            // Arrays & Matrices
            { label: '\\matrix', value: '\\begin{matrix}\n a & b \\\\\n c & d \n\\end{matrix}', type: 'layout', keywords: ['matrix', '行列'] },
            { label: '\\pmatrix', value: '\\begin{pmatrix}\n a & b \\\\\n c & d \n\\end{pmatrix}', type: 'layout', keywords: ['pmatrix', '行列'] },
            { label: '\\bmatrix', value: '\\begin{bmatrix}\n a & b \\\\\n c & d \n\\end{bmatrix}', type: 'layout', keywords: ['bmatrix', '行列'] },
            { label: '\\cases', value: '\\begin{cases}\n a & \\text{if } x = 0 \\\\\n b & \\text{if } x > 0 \n\\end{cases}', type: 'layout', keywords: ['cases', '条件'] },
            { label: '\\aligned', value: '\\begin{aligned}\n a &= b + c \\\\\n &= d + e \n\\end{aligned}', type: 'layout', keywords: ['aligned', 'align'] },

            // Fonts
            { label: '\\mathbb', value: '\\mathbb{R}', type: 'font', keywords: ['bb', 'mathbb', 'blackboard'] },
            { label: '\\mathcal', value: '\\mathcal{A}', type: 'font', keywords: ['cal', 'mathcal', 'calligraphy'] },
            { label: '\\mathbf', value: '\\mathbf{A}', type: 'font', keywords: ['bf', 'mathbf', 'bold'] },
            { label: '\\text', value: '\\text{plain text}', type: 'font', keywords: ['text', 'テキスト'] }
        ];

        this.items = mathItems;
    },

    show(view, pos) {
        if (!this.element) this.init();

        this.view = view;
        this.mathField = null;
        this.triggerPos = pos;
        this.isActive = true;
        this.currentKeyword = '';

        this.coords = view.coordsAtPos(pos);
        
        this.element.style.display = 'block';
        this.filter('');
    },

    /**
     * MathLive のエディタからサジェストを表示する
     */
    showForMathLive(mf, coords) {
        if (!this.element) this.init();

        this.view = null;
        this.mathField = mf;
        this.triggerPos = null;
        this.isActive = true;
        this.currentKeyword = '';

        this.coords = coords;

        this.element.style.display = 'block';
        this.filter('');
    },

    hide() {
        if (!this.element) return;
        this.isActive = false;
        this.element.style.display = 'none';
        this.view = null;
        this.mathField = null;
    },

    updateKeyword(keyword) {
        this.currentKeyword = keyword.toLowerCase();
        this.filter(this.currentKeyword);
    },

    filter(keyword) {
        if (!keyword) {
            this.filteredItems = this.items.slice();
        } else {
            this.filteredItems = this.items.filter(item => {
                const labelMatch = item.label.toLowerCase().includes(keyword);
                const keywordMatch = item.keywords && item.keywords.some(k => k.includes(keyword));
                return labelMatch || keywordMatch;
            });
        }

        this.selectedIndex = 0;
        this.render();
    },

    render() {
        this.listElement.innerHTML = '';

        if (this.filteredItems.length === 0) {
            const li = document.createElement('li');
            li.className = 'math-slash-command-item';
            li.style.color = 'var(--fg)';
            li.style.opacity = '0.5';
            li.textContent = 'No matching symbols';
            this.listElement.appendChild(li);
            return;
        }

        this.filteredItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'math-slash-command-item';
            if (index === this.selectedIndex) {
                li.classList.add('selected');
            }

            const labelSpan = document.createElement('span');
            labelSpan.className = 'math-slash-command-item-label';
            labelSpan.textContent = item.label;

            const typeSpan = document.createElement('span');
            typeSpan.className = 'math-slash-command-item-desc';
            typeSpan.textContent = item.type;

            li.appendChild(labelSpan);
            li.appendChild(typeSpan);

            li.addEventListener('mouseenter', () => {
                this.selectedIndex = index;
                this.render();
            });

            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.applySelection();
            });

            this.listElement.appendChild(li);
        });

        // 位置の調整：画面の範囲内に収める
        if (this.coords) {
            this.element.style.left = `${this.coords.left}px`;
            this.element.style.top = `${this.coords.bottom + 4}px`;
            // max-height をリセット
            this.element.style.maxHeight = '';
            
            // 描画後に高さを計算
            const rect = this.element.getBoundingClientRect();

            if (rect.bottom > window.innerHeight) {
                // 下にはみ出る → 上に表示を試みる
                const topPos = this.coords.top - rect.height - 4;
                if (topPos >= 0) {
                    // 上に十分なスペースがある
                    this.element.style.top = `${topPos}px`;
                } else {
                    // 上にもはみ出る → 画面上端にクランプし、高さを制限
                    this.element.style.top = '4px';
                    this.element.style.maxHeight = `${this.coords.top - 8}px`;
                }
            }
        } else {
            this.element.style.left = '50%';
            this.element.style.top = '50%';
        }
    },

    moveSelection(delta) {
        if (this.filteredItems.length === 0) return;
        this.selectedIndex += delta;
        if (this.selectedIndex < 0) this.selectedIndex = this.filteredItems.length - 1;
        if (this.selectedIndex >= this.filteredItems.length) this.selectedIndex = 0;
        this.render();

        // Scroll into view
        const selectedLi = this.listElement.children[this.selectedIndex];
        if (selectedLi) {
            const containerBox = this.element.getBoundingClientRect();
            const liBox = selectedLi.getBoundingClientRect();
            if (liBox.bottom > containerBox.bottom) {
                this.element.scrollTop += liBox.bottom - containerBox.bottom;
            } else if (liBox.top < containerBox.top) {
                this.element.scrollTop -= containerBox.top - liBox.top;
            }
        }
    },

    applySelection() {
        console.log('[MathSlashCommand] applySelection() called. view:', !!this.view, 'mathField:', !!this.mathField, 'items:', this.filteredItems.length);
        if ((!this.view && !this.mathField) || this.filteredItems.length === 0) return;

        const item = this.filteredItems[this.selectedIndex];
        console.log('[MathSlashCommand] Selected item:', item);

        // MathLive 経由の場合
        if (this.mathField) {
            this._applyToMathLive(item);
            return;
        }

        // CodeMirror 経由の場合（従来処理）
        const currentPos = this.view.state.selection.main.head;
        console.log('[MathSlashCommand] Dispatching changes. from:', this.triggerPos, 'to:', currentPos, 'insert:', item.value);

        // Insert the chosen LaTeX command, replacing the typed slash and keyword
        this.view.dispatch({
            changes: {
                from: this.triggerPos,
                to: currentPos,
                insert: item.value
            }
        });

        // Set cursor inside braces if applicable
        const insertedLength = item.value.length;
        let newCursorPos = this.triggerPos + insertedLength;
        const braceIndex = item.value.indexOf('{');
        
        if (braceIndex !== -1 && item.value.endsWith('}')) {
             newCursorPos = this.triggerPos + braceIndex + 1;

             // If there's an 'x' or inside braces, select it
             if (item.value.includes('{x}')) {
                  const xIndex = item.value.indexOf('{x}') + 1;
                  console.log('[MathSlashCommand] Dispatching selection for {x} at:', this.triggerPos + xIndex);
                  this.view.dispatch({ selection: { anchor: this.triggerPos + xIndex, head: this.triggerPos + xIndex + 1 } });
                  this.view.focus();
                  this.hide();
                  return;
             }
        }

        console.log('[MathSlashCommand] Setting final cursor pos:', newCursorPos);
        this.view.dispatch({ selection: { anchor: newCursorPos, head: newCursorPos } });
        this.view.focus();
        this.hide();
    },

    /**
     * MathLive のエディタに選択した記号を挿入する
     */
    _applyToMathLive(item) {
        const mf = this.mathField;
        console.log('[MathSlashCommand] Applying to MathLive:', item.value);

        // "\" キーは keydown で preventDefault されているため、
        // MathLive のコマンドモードには入っていない。直接挿入する。
        mf.executeCommand(['insert', item.value]);
        mf.focus();

        this.hide();
    }
};

window.MathSlashCommand = MathSlashCommand;
