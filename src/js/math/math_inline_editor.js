/**
 * Math Inline Editor Module
 * MathLive ベースの WYSIWYG 数式エディタ。
 * プレビュー上の数式をクリックすると、MathLive の <math-field> で編集できる。
 * "\" キー入力時は既存の MathSlashCommand サジェストを表示する。
 */

const MathInlineEditor = {
    activeWrapper: null,
    activeMathField: null,   // MathLive の math-field 要素
    activeEditorView: null,  // ガード互換用（MathLive 起動中に truthy になる）
    dataLine: -1,
    overlayElement: null,

    init() {
        if (!DOM.preview) return;
        this.bindEvents();

        // MathLive のキー入力音を無効化 (ローカルファイルシステムでの Invalid URL エラー防止)
        if (window.MathfieldElement) {
            try {
                window.MathfieldElement.soundsDirectory = null;
                window.MathfieldElement.keypressSound = null;
                window.MathfieldElement.plonkSound = null;
            } catch (e) {
                console.warn('[MathInlineEditor] Failed to set MathfieldElement sound options:', e.message);
            }
        }
    },

    bindEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;

        // KaTeX 要素のクリックで編集開始
        DOM.preview.addEventListener('click', (e) => {
            const mathElement = e.target.closest('.katex-html') || e.target.closest('eq');
            if (mathElement) {
                if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'svg') return;

                const blockContainer = mathElement.closest('[data-line]');
                if (blockContainer) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.startEdit(mathElement, blockContainer);
                }
            }
        });

        // エディタ外クリックで保存・終了
        document.addEventListener('click', (e) => {
            if (this.activeMathField && this.overlayElement &&
                e.target && typeof e.target.closest === 'function' &&
                !this.overlayElement.contains(e.target) &&
                !e.target.closest('.katex-html') &&
                !e.target.closest('.math-slash-command') &&
                !e.target.closest('.ML__keyboard') &&
                !e.target.closest('[data-ml-keyboard]')) {
                this.saveAndExit();
            }
        });
    },

    startEdit(mathElement, blockContainer) {
        if (this.activeMathField) {
            this.saveAndExit();
        }

        this.dataLine = parseInt(blockContainer.getAttribute('data-line'), 10);
        const dataLineEnd = blockContainer.getAttribute('data-line-end');
        this.dataLineEnd = dataLineEnd ? parseInt(dataLineEnd, 10) : this.dataLine;
        this.activeWrapper = mathElement;

        // クリックされた数式要素が、blockContainer（この要素）の中で何番目の数式要素かを取得する
        // ※ .katex-html や eq から一番外側の .katex 要素（または eq）を取得
        const katexEl = mathElement.closest('.katex') || mathElement.querySelector('.katex') || mathElement;
        const allKatexEls = Array.from(blockContainer.querySelectorAll('.katex'));
        const mathIndex = allKatexEls.indexOf(katexEl);

        // MarkdownソースからLaTeXを抽出
        const doc = window.editorInstance.state.doc;
        let rawLatex = '';
        this.originalMatch = null;

        if (this.dataLineEnd > this.dataLine) {
            // ブロック数式（複数行）
            const startLine = doc.line(this.dataLine);
            const endLineNum = Math.min(this.dataLineEnd, doc.lines);
            const endLine = doc.line(endLineNum);
            const blockText = doc.sliceString(startLine.from, endLine.to);

            // インデックスに基づいてマッチを特定する
            const regex = /\$\$([\s\S]*?)\$\$|\$([^$]+?)\$/g;
            let match;
            let currentIndex = 0;
            let foundMatch = null;
            while ((match = regex.exec(blockText)) !== null) {
                if (currentIndex === mathIndex) {
                    foundMatch = match;
                    break;
                }
                currentIndex++;
            }

            if (foundMatch) {
                const isBlock = foundMatch[1] !== undefined;
                rawLatex = isBlock ? foundMatch[1] : foundMatch[2];
                if (isBlock) {
                    rawLatex = rawLatex.trim();
                }
                this.originalMatch = {
                    text: foundMatch[0],
                    isBlock: isBlock,
                    isMultiLine: true,
                    index: foundMatch.index
                };
            } else {
                // マッチしなかった場合のフォールバック（従来処理に近い形）
                const blockRegex = /\$\$([\s\S]*?)\$\$/;
                const fallbackMatch = blockRegex.exec(blockText);
                if (fallbackMatch) {
                    rawLatex = fallbackMatch[1].trim();
                    this.originalMatch = { text: fallbackMatch[0], isBlock: true, isMultiLine: true, index: fallbackMatch.index };
                } else {
                    rawLatex = blockText;
                    this.originalMatch = { text: blockText, isBlock: true, isMultiLine: true, index: 0 };
                }
            }
        } else {
            // インライン数式（1行）
            const lineStr = doc.line(this.dataLine).text;

            // インデックスに基づいてマッチを特定する
            const regex = /\$\$([\s\S]*?)\$\$|\$([^$]+?)\$/g;
            let match;
            let currentIndex = 0;
            let foundMatch = null;
            while ((match = regex.exec(lineStr)) !== null) {
                if (currentIndex === mathIndex) {
                    foundMatch = match;
                    break;
                }
                currentIndex++;
            }

            if (foundMatch) {
                const isBlock = foundMatch[1] !== undefined;
                rawLatex = isBlock ? foundMatch[1] : foundMatch[2];
                this.originalMatch = {
                    text: foundMatch[0],
                    isBlock: isBlock,
                    isMultiLine: false,
                    index: foundMatch.index
                };
            } else {
                // フォールバック
                const blockRegex = /\$\$([\s\S]*?)\$\$/g;
                const inlineRegex = /\$([^$]+?)\$/g;
                let fallbackMatch = blockRegex.exec(lineStr);
                if (fallbackMatch) {
                    rawLatex = fallbackMatch[1];
                    this.originalMatch = { text: fallbackMatch[0], isBlock: true, isMultiLine: false, index: fallbackMatch.index };
                } else {
                    fallbackMatch = inlineRegex.exec(lineStr);
                    if (fallbackMatch) {
                        rawLatex = fallbackMatch[1];
                        this.originalMatch = { text: fallbackMatch[0], isBlock: false, isMultiLine: false, index: fallbackMatch.index };
                    } else {
                        rawLatex = lineStr;
                        this.originalMatch = { text: lineStr, isBlock: false, isMultiLine: false, index: 0 };
                    }
                }
            }
        }

        this.createOverlay(mathElement, rawLatex, blockContainer);
    },

    createOverlay(targetElement, initialText, blockContainer) {
        // コンテナ作成
        this.overlayElement = document.createElement('div');
        this.overlayElement.className = 'math-inline-editor-overlay math-editor-mathlive';

        // 位置決め
        const rect = targetElement.getBoundingClientRect();
        const containerRect = blockContainer.getBoundingClientRect();

        Object.assign(this.overlayElement.style, {
            position: 'absolute',
            top: `${rect.top - containerRect.top}px`,
            left: `${Math.max(0, rect.left - containerRect.left - 10)}px`,
            zIndex: '1000'
        });

        // --- MathLive <math-field> の作成 ---
        const mf = document.createElement('math-field');
        mf.className = 'math-editor-field';
        mf.value = initialText;

        // MathLiveの設定
        mf.mathVirtualKeyboardPolicy = 'manual';   // バーチャルキーボード非表示
        mf.smartFence = true;                       // 括弧の自動補完
        mf.smartSuperscript = true;                 // 上付き文字の自動処理

        // --- ヘッダー行: ⌨ キーボードボタン + ≡ メニューボタン ---
        const header = this._createHeader(mf);
        this.overlayElement.appendChild(header);

        // --- メイン行: MathField + ボタンパネルの横並び ---
        const editorRow = document.createElement('div');
        editorRow.className = 'math-editor-row';

        editorRow.appendChild(mf);

        // --- ボタンパネル ---
        const toolbar = this._createToolbar(mf);
        editorRow.appendChild(toolbar);

        this.overlayElement.appendChild(editorRow);
        blockContainer.appendChild(this.overlayElement);

        // 状態を保存
        this.activeMathField = mf;
        this.activeEditorView = mf; // ガード互換

        // フォーカス設定 + DOMマウント後の設定（エディタが閉じていないことを確認）
        requestAnimationFrame(() => {
            if (this.activeMathField === mf && mf.isConnected) {
                mf.focus();
            }
        });

        // イベントリスナー
        this._bindMathFieldEvents(mf);

        // 表示位置の調整：画面下にはみ出る場合は上にずらす
        setTimeout(() => {
            if (this.overlayElement && this.overlayElement.isConnected) {
                const overlayRect = this.overlayElement.getBoundingClientRect();
                if (overlayRect.bottom > window.innerHeight) {
                    const overflow = overlayRect.bottom - window.innerHeight;
                    const currentTop = parseFloat(this.overlayElement.style.top || 0);
                    this.overlayElement.style.top = `${currentTop - overflow - 10}px`;
                }
            }
        }, 50);
    },

    /**
     * MathField のイベントをバインドする
     */
    _bindMathFieldEvents(mf) {
        // サジェスト用のキーワードバッファ
        this._slashBuffer = '';
        this._slashActive = false;

        mf.addEventListener('keydown', (e) => {
            // --- MathSlashCommand が開いている場合は専用のキー処理 ---
            if (this._slashActive && window.MathSlashCommand && window.MathSlashCommand.isActive) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this._slashActive = false;
                    this._slashBuffer = '';
                    window.MathSlashCommand.hide();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.MathSlashCommand.applySelection();
                    this._slashActive = false;
                    this._slashBuffer = '';
                    return;
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.MathSlashCommand.moveSelection(1);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.MathSlashCommand.moveSelection(-1);
                    return;
                }
                if (e.key === 'Backspace') {
                    // バッファから1文字削除
                    if (this._slashBuffer.length > 0) {
                        this._slashBuffer = this._slashBuffer.slice(0, -1);
                        window.MathSlashCommand.updateKeyword(this._slashBuffer);
                        e.preventDefault();
                        e.stopPropagation();
                    } else {
                        // バッファが空 → サジェスト閉じる
                        this._slashActive = false;
                        window.MathSlashCommand.hide();
                    }
                    return;
                }
                // 英字入力: バッファに追加してフィルタ更新
                if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._slashBuffer += e.key.toLowerCase();
                    window.MathSlashCommand.updateKeyword(this._slashBuffer);
                    return;
                }
                // それ以外のキー → サジェスト閉じる
                if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
                    this._slashActive = false;
                    this._slashBuffer = '';
                    window.MathSlashCommand.hide();
                }
            }

            // --- "\" キーで MathSlashCommand を開く ---
            if (e.key === '\\' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                if (window.MathSlashCommand) {
                    this._slashActive = true;
                    this._slashBuffer = '';
                    const rect = mf.getBoundingClientRect();
                    window.MathSlashCommand.showForMathLive(mf, {
                        left: rect.left + 20,
                        bottom: rect.bottom + 4,
                        top: rect.top
                    });
                }
                return;
            }

            // --- Escape で保存・終了 ---
            if (e.key === 'Escape') {
                e.preventDefault();
                this.saveAndExit();
                return;
            }
            // --- Ctrl+Enter で保存・終了 ---
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.saveAndExit();
                return;
            }
        });

        // MathLive の 'move-out' イベント（カーソルがフィールド外に出た場合）
        mf.addEventListener('move-out', (e) => {
            // 何もしない（フィールド内に留まる）
        });
    },

    /**
     * MathLive が付加するラッパーやゴミを除去する
     */
    _cleanLatex(latex) {
        if (!latex) return latex;

        // \displaylines{...} ラッパーを除去
        // MathLive は内部的に改行を \displaylines + \\ で表現する
        const displaylinesMatch = latex.match(/^\\displaylines\{([\s\S]*)\}$/);
        if (displaylinesMatch) {
            latex = displaylinesMatch[1];
        }

        // 末尾の \\ を除去（MathLive が改行として付加する）
        latex = latex.replace(/\\\\[\s]*$/, '');

        // 前後の空白を除去
        latex = latex.trim();

        return latex;
    },

    /**
     * ヘッダー行（⌨ キーボード + ≡ メニュー）を作成する
     */
    _createHeader(mf) {
        const header = document.createElement('div');
        header.className = 'math-editor-header';

        // ⌨ バーチャルキーボード切替ボタン
        const kbBtn = document.createElement('button');
        kbBtn.className = 'math-header-btn';
        kbBtn.textContent = '⌨';
        kbBtn.title = 'キーボード表示/非表示';
        kbBtn.tabIndex = -1;
        kbBtn.addEventListener('mousedown', (e) => e.preventDefault());
        kbBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.activeMathField) {
                const vk = window.mathVirtualKeyboard;
                if (vk && vk.visible) {
                    vk.hide();
                    kbBtn.classList.remove('active');
                } else {
                    this.activeMathField.mathVirtualKeyboardPolicy = 'manual';
                    if (vk) vk.show();
                    kbBtn.classList.add('active');
                }
                this.activeMathField.focus();
            }
        });
        header.appendChild(kbBtn);

        // ≡ メニュー（MathLive組み込みメニュー表示）
        const menuBtn = document.createElement('button');
        menuBtn.className = 'math-header-btn';
        menuBtn.innerHTML = '&#9776;';  // ≡
        menuBtn.title = 'メニュー';
        menuBtn.tabIndex = -1;
        menuBtn.addEventListener('mousedown', (e) => e.preventDefault());
        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.activeMathField) {
                // シャドウDOM内のコンテンツ領域（part="content"）を取得
                let targetEl = this.activeMathField;
                if (this.activeMathField.shadowRoot) {
                    targetEl = this.activeMathField.shadowRoot.querySelector('[part="content"]') || this.activeMathField;
                }

                // コンテンツ領域の中央の座標を計算
                const rect = targetEl.getBoundingClientRect();
                const ev = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                });
                
                // イベントをディスパッチ
                targetEl.dispatchEvent(ev);
            }
        });
        header.appendChild(menuBtn);

        return header;
    },

    /**
     * 記号ボタンパネルを作成する
     */
    _createToolbar(mf) {
        const toolbar = document.createElement('div');
        toolbar.className = 'math-editor-toolbar';

        // ボタン定義: [ラベル, 挿入するLaTeX, ツールチップ]
        const buttons = [
            ['⅟', '\\frac{#0}{#1}', '分数'],
            ['√', '\\sqrt{#0}', '平方根'],
            ['∫', '\\int_{#0}^{#1}', '積分'],
            ['Σ', '\\sum_{#0}^{#1}', '総和'],
            ['x²', '^{#0}', '上付き'],
            ['x₂', '_{#0}', '下付き'],
            ['∞', '\\infty', '無限大'],
            ['±', '\\pm', 'プラスマイナス'],
            ['≠', '\\neq', '等しくない'],
            ['≤', '\\leq', '以下'],
            ['≥', '\\geq', '以上'],
            ['α', '\\alpha', 'アルファ'],
            ['β', '\\beta', 'ベータ'],
            ['π', '\\pi', 'パイ'],
            ['θ', '\\theta', 'シータ'],
            ['()', '\\left(#0\\right)', '括弧'],
            ['[ ]', '\\begin{bmatrix} #0 \\end{bmatrix}', '行列'],
        ];

        buttons.forEach(([label, latex, tooltip]) => {
            const btn = document.createElement('button');
            btn.className = 'math-toolbar-btn';
            btn.textContent = label;
            btn.title = tooltip;
            btn.tabIndex = -1;
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.activeMathField) {
                    this.activeMathField.executeCommand(['insert', latex]);
                    this.activeMathField.focus();
                }
            });
            toolbar.appendChild(btn);
        });

        return toolbar;
    },

    saveAndExit() {
        if (!this.activeMathField || !this.overlayElement) return;

        if (window.MathSlashCommand && window.MathSlashCommand.isActive) {
            window.MathSlashCommand.hide();
        }

        // バーチャルキーボードを閉じる
        const vk = window.mathVirtualKeyboard;
        if (vk && vk.visible) {
            vk.hide();
        }

        // MathLive からLaTeXを取得（DOMに接続されている場合のみ）
        let newLatex = '';
        const mf = this.activeMathField;
        try {
            if (mf.isConnected) {
                newLatex = mf.getValue('latex');
            } else {
                // DOMから切断済みの場合はvalueプロパティから取得を試みる
                newLatex = mf.value || '';
            }
        } catch (e) {
            console.warn('[MathInlineEditor] getValue failed:', e.message);
            newLatex = mf.value || '';
        }

        // MathLive が付加するラッパーをクリーンアップ
        newLatex = this._cleanLatex(newLatex);

        // math-field を安全にクリーンアップ
        try {
            if (mf.isConnected) {
                mf.blur();
            }
        } catch (e) {
            // MathLive 内部エラーを抑制
        }

        // 明示的に MathLive 要素の中身を空にする、および破棄メソッドがあれば呼ぶ (メモリリーク防止)
        try {
            if (typeof mf.dispose === 'function') {
                mf.dispose();
            } else if (typeof mf.destroy === 'function') {
                mf.destroy();
            }
            mf.value = '';
            mf.innerHTML = '';
        } catch (e) {
            console.warn('[MathInlineEditor] MathfieldElement disposal error:', e.message);
        }

        // UI クリーンアップ
        this.activeMathField = null;
        this.activeEditorView = null;

        // DOM からオーバーレイを除去（MathLive の内部エラーを抑制）
        try {
            if (this.overlayElement && this.overlayElement.parentNode) {
                this.overlayElement.parentNode.removeChild(this.overlayElement);
            }
        } catch (e) {
            console.warn('[MathInlineEditor] overlay removal error:', e.message);
        }
        this.overlayElement = null;

        // メインの CodeMirror ドキュメントに変更を適用
        if (this.dataLine > 0 && window.editorInstance) {
            const doc = window.editorInstance.state.doc;
            let startLineObj = doc.line(this.dataLine);
            let endLineObj = this.dataLineEnd > this.dataLine ? doc.line(Math.min(this.dataLineEnd, doc.lines)) : startLineObj;

            if (this.originalMatch && this.originalMatch.isMultiLine) {
                const blockText = doc.sliceString(startLineObj.from, endLineObj.to);
                const trimmedNewLatex = newLatex.trim();
                const replacementText = `$$\n${trimmedNewLatex}\n$$`;
                
                let newBlockText;
                if (this.originalMatch.index !== undefined) {
                    // インデックスに基づいてピンポイントで置換（バグ防止）
                    const before = blockText.slice(0, this.originalMatch.index);
                    const after = blockText.slice(this.originalMatch.index + this.originalMatch.text.length);
                    newBlockText = before + replacementText + after;
                } else {
                    newBlockText = blockText.replace(this.originalMatch.text, () => replacementText);
                }

                window.editorInstance.dispatch({
                    changes: {
                        from: startLineObj.from,
                        to: endLineObj.to,
                        insert: newBlockText
                    }
                });
            } else {
                let newLineText = startLineObj.text;
                if (this.originalMatch) {
                    const replacementText = this.originalMatch.isBlock ? `$$${newLatex}$$` : `$${newLatex}$`;
                    
                    if (this.originalMatch.index !== undefined) {
                        // インデックスに基づいてピンポイントで置換（バグ防止）
                        const before = newLineText.slice(0, this.originalMatch.index);
                        const after = newLineText.slice(this.originalMatch.index + this.originalMatch.text.length);
                        newLineText = before + replacementText + after;
                    } else {
                        newLineText = newLineText.replace(this.originalMatch.text, () => replacementText);
                    }
                } else {
                    newLineText = newLatex;
                }

                window.editorInstance.dispatch({
                    changes: {
                        from: startLineObj.from,
                        to: startLineObj.to,
                        insert: newLineText
                    }
                });
            }
        }
    }
};

window.MathInlineEditor = MathInlineEditor;
