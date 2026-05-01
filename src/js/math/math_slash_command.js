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
        this.triggerPos = pos;
        this.isActive = true;
        this.currentKeyword = '';

        const coords = view.coordsAtPos(pos);
        if (coords) {
            this.element.style.left = `${coords.left}px`;
            this.element.style.top = `${coords.bottom + 4}px`;
        } else {
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
            li.style.padding = '4px 8px';
            li.style.color = '#777';
            li.textContent = 'No matching symbols';
            this.listElement.appendChild(li);
            return;
        }

        this.filteredItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'cm-completionLabel';
            if (index === this.selectedIndex) {
                li.style.backgroundColor = '#3e4451';
            }
            li.style.padding = '4px 8px';
            li.style.cursor = 'pointer';
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;

            const typeSpan = document.createElement('span');
            typeSpan.textContent = item.type;
            typeSpan.style.fontSize = '10px';
            typeSpan.style.color = '#777';
            typeSpan.style.marginLeft = '8px';

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
        if (!this.view || this.filteredItems.length === 0) return;

        const item = this.filteredItems[this.selectedIndex];
        const currentPos = this.view.state.selection.main.head;

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
                  this.view.dispatch({ selection: { anchor: this.triggerPos + xIndex, head: this.triggerPos + xIndex + 1 } });
                  this.hide();
                  return;
             }
        }

        this.view.dispatch({ selection: { anchor: newCursorPos } });
        this.hide();
        this.view.focus();
    }
};

window.MathSlashCommand = MathSlashCommand;
