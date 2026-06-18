/**
 * SVG Animation Path Toolbar
 * モーションパスアニメーション（<animateMotion> + <mpath>）を設定するUIモジュール。
 * 描画されたパスをガイドレールにして要素を移動させることができます。
 */
var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);
class SVGAnimationPathToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-path-toolbar',
            container: container,
            borderColor: options.borderColor || '#FF5722',
            position: options.position || { top: '100px', right: '-45px' },
            isSwapped: true
        });
        this.onValueChange = options.onValueChange || (() => { });
        this.inputs = {};
        this.isSelectingPath = false;  // パス選択モードフラグ
        this.activeElement = null;     // アニメーションを付与する対象
        this._canvasClickHandler = null;

        this.createToolbar();
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;
        this.toolbarElement.classList.add('svg-animation-path-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        // ツールバーラベル
        const label = document.createElement('span');
        label.style.cssText = 'color:var(--svg-toolbar-fg); font-size:10px; font-weight:bold; margin:0 4px;';
        label.textContent = t('svgEditor.animPath.label') || 'パス移動:';
        contentArea.appendChild(label);

        // パス選択紐付けボタン
        const selectPathBtn = document.createElement('button');
        selectPathBtn.innerHTML = t('svgEditor.animPath.linkBtn') || '🔗 パス紐付け';
        selectPathBtn.title = t('svgEditor.animPath.linkBtnTitle') || 'ボタンを押した後、レールにしたいキャンバス上のパス要素をクリックして紐付けます';
        selectPathBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 4px; border: 1px solid var(--svg-toolbar-border);';
        selectPathBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePathSelectionMode();
        });
        contentArea.appendChild(selectPathBtn);
        this.inputs['selectPathBtn'] = selectPathBtn;

        // パスID表示（読み取り専用）
        const pathIdLabel = document.createElement('span');
        pathIdLabel.style.cssText = 'color:var(--svg-toolbar-fg); font-size: 10px; opacity: 0.7; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        pathIdLabel.textContent = t('svgEditor.animPath.notSet') || '(未設定)';
        contentArea.appendChild(pathIdLabel);
        this.inputs['pathIdLabel'] = pathIdLabel;

        // 自動追従 (Auto-Rotate)
        const rotateLabel = document.createElement('label');
        rotateLabel.style.cssText = 'display:flex; align-items:center; gap:2px; font-size:10px; color:var(--svg-toolbar-fg); cursor:pointer; margin:0 2px;';
        const rotateCheck = document.createElement('input');
        rotateCheck.type = 'checkbox';
        rotateCheck.checked = true;
        rotateCheck.addEventListener('change', () => this.handleParamsChange());
        rotateLabel.appendChild(rotateCheck);
        rotateLabel.appendChild(document.createTextNode(t('svgEditor.animPath.rotate') || '回転'));
        contentArea.appendChild(rotateLabel);
        this.inputs['autoRotate'] = rotateCheck;

        // 再生時間 (Duration)
        const durWrap = document.createElement('div');
        durWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        durWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">${t('svgEditor.animPath.seconds') || '秒:'}</span>`;
        const durInput = document.createElement('input');
        durInput.type = 'number';
        durInput.style.width = '45px';
        durInput.style.textAlign = 'right';
        durInput.value = '4.0';
        durInput.step = '0.5';
        durInput.min = '0.5';
        durInput.addEventListener('change', () => this.handleParamsChange());
        durInput.addEventListener('keydown', (e) => e.stopPropagation());
        durWrap.appendChild(durInput);
        contentArea.appendChild(durWrap);
        this.inputs['dur'] = durInput;

        // 解除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = t('svgEditor.animPath.removeBtn') || '❌ 解除';
        removeBtn.style.cssText = 'padding: 2px 4px; font-size: 10px; cursor: pointer; color: #f44336; border-radius: 4px; border: 1px solid var(--svg-toolbar-border);';
        removeBtn.addEventListener('click', () => this.handleRemovePath());
        contentArea.appendChild(removeBtn);
    }

    /**
     * パス選択モードのトグル
     */
    togglePathSelectionMode(forceState) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        // すでに解除状態かつ、さらに強制解除（forceState = false）しようとしている場合は即座に終了
        if (forceState === false && !this.isSelectingPath) {
            return;
        }

        const selected = Array.from(window.currentEditingSVG.selectedElements)[0];
        if (!selected) {
            // 要素が選択されていない状態でのトグル起動または有効化時のみ警告を出す
            if (forceState === undefined || forceState === true) {
                alert(t('svgEditor.animPath.selectElementAlert') || 'アニメーションを設定する要素を選択してください。');
            }
            // 強制解除（あるいは警告後）のクリーンアップ処理
            this.isSelectingPath = false;
            this.inputs['selectPathBtn'].classList.remove('active');
            if (window.currentEditingSVG && window.currentEditingSVG.draw) {
                const svg = window.currentEditingSVG.draw.node;
                if (this._canvasClickHandler) {
                    svg.removeEventListener('mousedown', this._canvasClickHandler, true);
                    svg.removeEventListener('click', this._canvasClickHandler, true);
                    this._canvasClickHandler = null;
                }
                svg.style.cursor = '';
                if (window.currentEditingSVG.container) {
                    window.currentEditingSVG.container.style.cursor = '';
                }
            }
            this.activeElement = null;
            return;
        }

        const nextState = forceState !== undefined ? forceState : !this.isSelectingPath;
        if (this.isSelectingPath === nextState) return;

        this.isSelectingPath = nextState;
        this.inputs['selectPathBtn'].classList.toggle('active', this.isSelectingPath);

        const svg = window.currentEditingSVG.draw.node;

        if (this.isSelectingPath) {
            this.activeElement = selected;
            // キャンバス上の mousedown および click イベントをキャプチャして、通常選択処理などを一旦インターセプトする
            this._canvasClickHandler = (e) => this.handleCanvasClick(e);
            svg.addEventListener('mousedown', this._canvasClickHandler, true);
            svg.addEventListener('click', this._canvasClickHandler, true);
            
            // CSSによるホバーハイライト用のクラスを付与
            svg.classList.add('selecting-motion-path');
            
            // ユーザービリティ向上のためにカーソルを変更
            svg.style.cursor = 'cell';
            if (window.currentEditingSVG.container) {
                window.currentEditingSVG.container.style.cursor = 'cell';
            }
        } else {
            if (this._canvasClickHandler) {
                svg.removeEventListener('mousedown', this._canvasClickHandler, true);
                svg.removeEventListener('click', this._canvasClickHandler, true);
                this._canvasClickHandler = null;
            }
            
            // ホバーハイライト用クラスの削除
            svg.classList.remove('selecting-motion-path');
            
            svg.style.cursor = '';
            if (window.currentEditingSVG && window.currentEditingSVG.container) {
                window.currentEditingSVG.container.style.cursor = '';
            }
            this.activeElement = null;
        }
    }

    /**
     * パス選択モード中にキャンバス上の要素をクリックした際のハンドラ
     */
    handleCanvasClick(e) {
        if (!this.isSelectingPath) return;

        // 通常エディタ側のmousedownやclick選択が走るのを防ぐためにイベントを完全に遮断する
        e.stopPropagation();
        e.preventDefault();

        // パス要素（且つアニメーション対象自身や内部要素でないもの）がクリックされたか判定
        let target = e.target;
        
        // 階層を上にたどってpathタグを探す
        while (target && target !== e.currentTarget) {
            const tagName = target.tagName ? target.tagName.toLowerCase() : '';
            if (tagName === 'path' && !window.isSVGInternalElement(target) && target !== (this.activeElement.node || this.activeElement)) {
                break;
            }
            target = target.parentNode;
        }

        if (target && target.tagName && target.tagName.toLowerCase() === 'path') {
            // IDがなければ自動付与
            let id = target.getAttribute('id');
            if (!id) {
                const randId = Math.random().toString(36).substring(2, 8);
                id = `track-path-${randId}`;
                target.setAttribute('id', id);
            }

            const pathId = '#' + id;
            this.inputs['pathIdLabel'].textContent = pathId;
            this.inputs['pathIdLabel'].title = pathId;

            // アニメーション適用
            this.applyPathAnimation(pathId);

            // アクティブ要素を退避（togglePathSelectionMode内でnullにクリアされるため）
            const activeEl = this.activeElement;

            // パス選択モードの解除と再選択の実行を非同期（10ms後）に遅延させて、
            // 同一クリック操作に伴うすべてのmousedown / clickイベントが通常エディタに伝播するのを防ぐ
            setTimeout(() => {
                this.togglePathSelectionMode(false);
                
                // 選択状態の同期 (ラップによって親子構造が変わっているため、DOM Node自体を渡して再選択させる)
                if (window.selectElement && activeEl) {
                    const domNode = activeEl.node || activeEl;
                    window.selectElement(domNode, true);
                }
            }, 10);
        } else {
            // パス以外をクリックした場合はモードを解除する
            setTimeout(() => {
                this.togglePathSelectionMode(false);
            }, 10);
        }
    }

    applyPathAnimation(pathId) {
        if (!this.activeElement) return;

        const dur = parseFloat(this.inputs['dur'].value) || 4.0;
        const autoRotate = this.inputs['autoRotate'].checked;

        // モーションパス適用
        SvgAnimationManager.applyMotionPathAnimation(this.activeElement, {
            pathId,
            dur,
            autoRotate
        });
    }

    /**
     * 回転チェックボックスや秒数入力変更時の反映
     */
    handleParamsChange() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        window.currentEditingSVG.selectedElements.forEach(el => {
            const domNode = el.node || el;
            const wrapper = domNode.closest('.anim-wrapper-motion');
            if (wrapper) {
                const pathId = wrapper.getAttribute('data-motion-path');
                if (pathId) {
                    this.applyPathAnimation(pathId);
                }
            }
        });
    }

    /**
     * パス移動アニメーションの解除
     */
    handleRemovePath() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        window.currentEditingSVG.selectedElements.forEach(el => {
            SvgAnimationManager.removeAnimation(el, 'motion');
            if (window.selectElement) window.selectElement(el, true);
        });

        this.inputs['pathIdLabel'].textContent = t('svgEditor.animPath.notSet') || '(未設定)';
        this.inputs['pathIdLabel'].title = '';
    }

    /**
     * 選択要素から現在の設定を復元してUIを更新する
     */
    updateValuesFromSelected() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        
        let foundPath = t('svgEditor.animPath.notSet') || '(未設定)';
        let foundDur = '4.0';
        let foundRotate = true;

        const selected = Array.from(window.currentEditingSVG.selectedElements)[0];
        if (selected) {
            this.activeElement = selected;
            const animData = SvgAnimationManager.getAnimationData(selected);
            if (animData['motion']) {
                const data = animData['motion'];
                foundPath = data.pathId;
                foundDur = data.dur;
                foundRotate = data.autoRotate;
            }
        } else {
            this.activeElement = null;
            this.togglePathSelectionMode(false);
        }

        this.inputs['pathIdLabel'].textContent = foundPath;
        this.inputs['pathIdLabel'].title = foundPath;
        this.inputs['dur'].value = foundDur;
        this.inputs['autoRotate'].checked = foundRotate;
    }

    destroy() {
        this.togglePathSelectionMode(false);
        if (this.toolbarElement) this.toolbarElement.remove();
    }
}

// グローバルファクトリ
window.createAnimationPathToolbar = (container, options) => {
    return new SVGAnimationPathToolbar(container, options);
};
