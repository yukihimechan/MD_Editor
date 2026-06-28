/**
 * SVG Animation List Toolbar
 * アニメーションの連続再生リストを管理するツールバー。
 * 図形をリストに追加し、順番にアニメーションを再生する機能を提供します。
 * - 自動連続再生モード: リスト順にDelay を自動計算して一斉再生
 * - ステップ再生モード: スペースキー/クリックで1つずつ進める
 */
var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);

class SVGAnimationListToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-list-toolbar',
            container: container,
            borderColor: options.borderColor || '#E65100',
            position: options.position || { top: '90px', right: '-36px' },
            isSwapped: true
        });

        /** @type {Array<{id: string, node: SVGElement}>} リスト内の図形参照 */
        this.sequenceList = [];
        /** @type {boolean} true: 自動連続再生, false: ステップ再生 */
        this.isAutoMode = true;
        /** @type {boolean} 再生中フラグ */
        this.isPlaying = false;
        /** @type {number} ステップ再生時の現在位置 */
        this.stepIndex = 0;
        /** @type {Function|null} スペースキーハンドラ参照（クリーンアップ用） */
        this._keyHandler = null;
        /** @type {number|null} 再生中ハイライト用タイマー */
        this._playTimer = null;

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
        this.toolbarElement.classList.add('svg-animation-list-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';

        // ===== ツール1: 再生モード切替ボタン =====
        const modeBtn = document.createElement('button');
        modeBtn.className = 'svg-anim-list-mode-btn';
        modeBtn.title = t('svgEditor.animList.modeBtnTitle') || '再生モード切替（自動/ステップ）';
        modeBtn.innerHTML = this.isAutoMode
            ? (t('svgEditor.animList.modeAuto') || '▶ 連続')
            : (t('svgEditor.animList.modeStep') || '⏭ ステップ');
        modeBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 4px; border: 1px solid var(--svg-toolbar-border); white-space: nowrap;';
        modeBtn.addEventListener('click', () => this.toggleMode());
        contentArea.appendChild(modeBtn);
        this._modeBtn = modeBtn;

        // ===== ツール2: 再生/停止トグルボタン =====
        const playBtn = document.createElement('button');
        playBtn.className = 'svg-anim-list-play-btn';
        playBtn.title = t('svgEditor.animList.playBtnTitle') || '連続再生の開始/停止';
        playBtn.innerHTML = this.isPlaying
            ? (t('svgEditor.animList.stop') || '⏹ 停止')
            : (t('svgEditor.animList.play') || '▶ 再生');
        playBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 4px; border: 1px solid var(--svg-toolbar-border); white-space: nowrap;';
        if (this.isPlaying) {
            playBtn.style.background = 'rgba(230, 81, 0, 0.15)';
            playBtn.style.color = '#E65100';
        }
        playBtn.addEventListener('click', () => this.togglePlay());
        contentArea.appendChild(playBtn);
        this._playBtn = playBtn;

        // ===== 全クリアボタン =====
        const clearBtn = document.createElement('button');
        clearBtn.title = t('svgEditor.animList.clearBtnTitle') || 'リストを全てクリア';
        clearBtn.innerHTML = '🗑';
        clearBtn.style.cssText = 'padding: 2px 4px; font-size: 10px; cursor: pointer; border-radius: 4px; border: 1px solid var(--svg-toolbar-border); white-space: nowrap;';
        clearBtn.addEventListener('click', () => this.clearAll());
        contentArea.appendChild(clearBtn);

        // ===== 区切り =====
        contentArea.appendChild(this._createSeparator());

        // ===== リスト内の図形アイテム =====
        this._listContainer = document.createElement('div');
        this._listContainer.style.cssText = 'display: flex; align-items: center; gap: 2px; flex-wrap: nowrap;';
        contentArea.appendChild(this._listContainer);

        this._renderListItems();
    }

    /**
     * リスト内の図形サムネイルを描画する
     */
    _renderListItems() {
        if (!this._listContainer) return;
        this._listContainer.innerHTML = '';

        if (this.sequenceList.length === 0) {
            const emptyLabel = document.createElement('span');
            emptyLabel.style.cssText = 'color: var(--svg-toolbar-fg); font-size: 9px; opacity: 0.5; white-space: nowrap;';
            emptyLabel.textContent = t('svgEditor.animList.empty') || '(図形を右クリックで追加)';
            this._listContainer.appendChild(emptyLabel);
            return;
        }

        this.sequenceList.forEach((item, index) => {
            const itemEl = this._createListItem(item, index);
            this._listContainer.appendChild(itemEl);
        });
    }

    /**
     * 個別の図形サムネイルアイテムを作成する
     */
    _createListItem(item, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'svg-anim-list-item';
        wrapper.setAttribute('data-seq-index', index);
        wrapper.setAttribute('draggable', 'true');
        wrapper.style.cssText = `
            position: relative; display: flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 4px; cursor: grab;
            border: 1px solid var(--svg-toolbar-border, #ccc);
            background: var(--svg-toolbar-bg, #fff);
            flex-shrink: 0;
        `;

        // サムネイルSVGの生成
        const thumbSvg = this._createThumbnail(item.node);
        wrapper.appendChild(thumbSvg);

        // 右上の番号バッジ
        const badge = document.createElement('span');
        badge.className = 'svg-anim-list-badge';
        badge.textContent = (index + 1).toString();
        badge.style.cssText = `
            position: absolute; top: -5px; right: -5px;
            min-width: 14px; height: 14px; line-height: 14px;
            font-size: 9px; font-weight: bold; text-align: center;
            background: #E65100; color: white;
            border-radius: 7px; padding: 0 2px;
            pointer-events: none;
        `;
        wrapper.appendChild(badge);

        // ツールチップ
        const tagName = item.node.tagName ? item.node.tagName.toLowerCase() : '?';
        const elemId = item.node.id || '';
        wrapper.title = `#${index + 1}: ${tagName}${elemId ? ' (' + elemId + ')' : ''}`;

        // クリックで対象図形をハイライト/選択
        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            this._highlightElement(item.node);
        });

        // 右クリックでリストから削除メニュー
        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showItemContextMenu(e, index);
        });

        // ドラッグ並び替え
        this._bindDragReorder(wrapper, index);

        return wrapper;
    }

    /**
     * 図形のサムネイルSVGを生成する
     */
    _createThumbnail(node) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '22');
        svg.style.pointerEvents = 'none';
        svg.style.overflow = 'visible';

        try {
            // アニメーションラッパーを除去して元の図形だけをクローンする
            let targetNode = node;
            // 親方向にanim-wrapperがある場合はそのまま使用
            const clone = targetNode.cloneNode(true);
            // アニメーション属性を除去
            clone.style.animation = 'none';
            clone.style.transform = 'none';
            clone.removeAttribute('data-anim-type');

            const bbox = targetNode.getBBox();
            if (bbox.width > 0 && bbox.height > 0) {
                const padding = 2;
                svg.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`);
            }

            svg.appendChild(clone);
        } catch (e) {
            // BBox取得に失敗した場合はフォールバック
            const fallback = document.createElementNS(svgNS, 'rect');
            fallback.setAttribute('x', '2');
            fallback.setAttribute('y', '2');
            fallback.setAttribute('width', '18');
            fallback.setAttribute('height', '18');
            fallback.setAttribute('rx', '3');
            fallback.setAttribute('fill', '#ddd');
            fallback.setAttribute('stroke', '#999');
            fallback.setAttribute('stroke-width', '1');
            svg.appendChild(fallback);
        }

        return svg;
    }

    /**
     * 対象の図形をハイライトする
     */
    _highlightElement(node) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;

        // SVG.js のインスタンスを取得して選択する
        const svgJsEl = node.instance || (typeof SVG === 'function' ? SVG(node) : null);
        if (svgJsEl && typeof selectElement === 'function') {
            selectElement(svgJsEl, false, true);
        }
    }

    /**
     * 区切り線を作成する
     */
    _createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    // ===== 再生モード切替 =====
    toggleMode() {
        this.isAutoMode = !this.isAutoMode;
        if (this._modeBtn) {
            this._modeBtn.innerHTML = this.isAutoMode
                ? (t('svgEditor.animList.modeAuto') || '▶ 連続')
                : (t('svgEditor.animList.modeStep') || '⏭ ステップ');
        }
        
        // [FIX] モードを切り替えたらSVGの属性に保存する
        this._saveToSvg();
    }

    // ===== 再生/停止トグル =====
    togglePlay() {
        if (this.isPlaying) {
            this.stopPlay();
        } else {
            this.startPlay();
        }
    }

    /**
     * 再生を開始する
     */
    startPlay() {
        if (this.sequenceList.length === 0) return;
        this.isPlaying = true;
        this.stepIndex = 0;
        this._updatePlayButton();

        const previewEl = document.getElementById('preview');
        if (previewEl) previewEl.classList.add('playing-sequence');

        if (this.isAutoMode) {
            this._playAutoSequence();
        } else {
            this._playStepSequence();
        }
    }

    /**
     * 再生を停止する
     */
    stopPlay() {
        this.isPlaying = false;
        this.stepIndex = 0;
        this._updatePlayButton();
        this._unbindSpaceKey();
        this._clearHighlights();

        const previewEl = document.getElementById('preview');
        if (previewEl) previewEl.classList.remove('playing-sequence');

        if (this._playTimer) {
            clearTimeout(this._playTimer);
            this._playTimer = null;
        }
        if (this._autoStopTimer) {
            clearTimeout(this._autoStopTimer);
            this._autoStopTimer = null;
        }

        // 全てのリスト図形のアニメーションをリセットする
        this._resetAllAnimations();
    }

    /**
     * 再生ボタンの表示を更新する
     */
    _updatePlayButton() {
        if (!this._playBtn) return;
        this._playBtn.innerHTML = this.isPlaying
            ? (t('svgEditor.animList.stop') || '⏹ 停止')
            : (t('svgEditor.animList.play') || '▶ 再生');
        this._playBtn.style.background = this.isPlaying ? 'rgba(230, 81, 0, 0.15)' : '';
        this._playBtn.style.color = this.isPlaying ? '#E65100' : '';
    }

    /**
     * リスト順に基づいて各図形のDelayを計算し、DOMに適用する
     * @param {boolean} refreshStyles - trueの場合、アニメーションを再起動するためにスタイルをリフレッシュする
     * @returns {number} 全体の累積時間
     */
    _updateDomDelays(refreshStyles = false) {
        if (!window.SvgAnimationManager) return 0;
        let cumulativeDelay = 0;
        this.sequenceList.forEach((item) => {
            const node = item.node;
            if (!node || !node.isConnected) return;
            const animData = SvgAnimationManager.getAnimationData(node);
            const types = Object.keys(animData);
            if (types.length === 0) return;
            const firstType = types[0];
            const data = animData[firstType];
            if (!data) return;
            const dur = data.dur || 1;

            let curr = node;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                if (classes.includes('anim-wrapper-') && !classes.includes('anim-wrapper-motion')) {
                    curr.setAttribute('data-anim-delay', cumulativeDelay);
                    curr.style.animationDelay = `${cumulativeDelay}s`;
                    if (refreshStyles) {
                        const currentAnimation = curr.style.animation;
                        curr.style.animation = 'none';
                        void curr.getBoundingClientRect();
                        curr.style.animation = currentAnimation;
                        curr.style.animationDelay = `${cumulativeDelay}s`;
                    }
                }
                curr = curr.parentNode;
            }
            cumulativeDelay += dur;
        });
        return cumulativeDelay;
    }

    /**
     * 自動連続再生モードの実行
     * 各図形のDuration + Delay を計算して、次の図形のDelayを自動設定する
     */
    _playAutoSequence() {
        const totalDelay = this._updateDomDelays(true);

        this.sequenceList.forEach((item, index) => {
            const node = item.node;
            if (!node || !node.isConnected) return;
            let delay = 0;
            let curr = node;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                if (classes.includes('anim-wrapper-') && !classes.includes('anim-wrapper-motion')) {
                    delay = parseFloat(curr.getAttribute('data-anim-delay') || '0');
                    break;
                }
                curr = curr.parentNode;
            }
            this._highlightBadge(index, delay);
        });

        // 全てのアニメーションが完了したら自動で停止状態に戻す
        if (totalDelay > 0) {
            this._autoStopTimer = setTimeout(() => {
                if (this.isPlaying) this.stopPlay();
            }, totalDelay * 1000);
        }
    }

    /**
     * ステップ再生モードの実行（スペースキー/クリックで進める）
     */
    _playStepSequence() {
        this._bindSpaceKey();
        // 最初の図形のアニメーションを発火
        this._fireStepAnimation(this.stepIndex);
    }

    /**
     * 指定インデックスの図形のアニメーションを発火させる
     */
    _fireStepAnimation(index) {
        if (index < 0 || index >= this.sequenceList.length) {
            this.stopPlay();
            return;
        }

        const item = this.sequenceList[index];
        const node = item.node;
        if (!node || !node.isConnected) {
            this.stepIndex++;
            this._fireStepAnimation(this.stepIndex);
            return;
        }

        // アニメーションラッパーにフォーカスを当てて発火する（click trigger対応）
        let wrapper = node.closest('[class*="anim-wrapper-"]');
        if (wrapper) {
            // CSS Trigger方式: フォーカスを当てる
            if (wrapper.getAttribute('tabindex') !== null) {
                wrapper.focus();
            }
            let curr = node;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                if (classes.includes('anim-wrapper-') && !classes.includes('anim-wrapper-motion')) {
                    // 通常再生方式: アニメーションをリスタート
                    const currentAnimation = curr.style.animation;
                    curr.style.animation = 'none';
                    // 強制リフロー (SVG要素にoffsetHeightは無いためgetBoundingClientRectを使用)
                    void curr.getBoundingClientRect();
                    curr.style.animation = currentAnimation;
                    curr.style.animationDelay = '0s'; // ステップ再生時は即時開始
                }
                curr = curr.parentNode;
            }
        }

        // ツールバー上のハイライト更新
        this._clearHighlights();
        this._highlightBadge(index, 0);
    }

    /**
     * スペースキーでステップ送りするためのキーイベントバインド
     */
    _bindSpaceKey() {
        this._unbindSpaceKey();
        this._keyHandler = (e) => {
            if (!this.isPlaying || this.isAutoMode) return;
            // テキスト入力中は無視
            const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
            if (isInput) return;
            // インラインテキスト編集中は無視
            if (window.currentEditingSVG && window.currentEditingSVG.isInlineEditing) return;

            if (e.code === 'Space' || e.code === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                this.stepIndex++;
                if (this.stepIndex >= this.sequenceList.length) {
                    this.stopPlay();
                } else {
                    this._fireStepAnimation(this.stepIndex);
                }
            }
        };
        document.addEventListener('keydown', this._keyHandler, true);
    }

    _unbindSpaceKey() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = null;
        }
    }

    /**
     * 指定バッジをハイライト表示する
     */
    _highlightBadge(index, delaySeconds) {
        const items = this._listContainer?.querySelectorAll('.svg-anim-list-item');
        if (!items || !items[index]) return;

        const highlight = () => {
            items[index].style.outline = '2px solid #E65100';
            items[index].style.outlineOffset = '1px';
        };

        if (delaySeconds > 0) {
            this._playTimer = setTimeout(highlight, delaySeconds * 1000);
        } else {
            highlight();
        }
    }

    /**
     * 全てのバッジハイライトをクリアする
     */
    _clearHighlights() {
        const items = this._listContainer?.querySelectorAll('.svg-anim-list-item');
        if (!items) return;
        items.forEach(item => {
            item.style.outline = '';
            item.style.outlineOffset = '';
        });
    }

    /**
     * 全図形のアニメーションをリセット（元のDelay値に復元）
     */
    _resetAllAnimations() {
        this.sequenceList.forEach(item => {
            const node = item.node;
            if (!node || !node.isConnected) return;

            let curr = node;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                if (classes.includes('anim-wrapper-') && !classes.includes('anim-wrapper-motion')) {
                    const originalDelay = curr.getAttribute('data-anim-delay') || '0';
                    curr.style.animationDelay = `${originalDelay}s`;
                }
                curr = curr.parentNode;
            }
        });
    }

    // ===== リスト管理 =====

    /**
     * 図形をリストに追加する
     * @param {SVGElement} node - 追加する図形のDOMノード
     */
    addToSequence(node) {
        if (!node) return;

        // アニメーションが設定されているか確認
        const animData = window.SvgAnimationManager
            ? SvgAnimationManager.getAnimationData(node)
            : {};
        if (Object.keys(animData).length === 0) {
            const msg = t('svgEditor.animList.noAnimWarning') || 'この図形にはアニメーションが設定されていません。\n先にアニメーションを設定してから追加してください。';
            alert(msg);
            return;
        }

        // 図形にIDがなければ自動付与
        if (!node.id || node.id.startsWith('Svgjs')) {
            const randId = 'anim-seq-' + Math.random().toString(36).substring(2, 8);
            node.setAttribute('id', randId);
        }

        // 既に登録済みでないか確認
        const exists = this.sequenceList.some(item => item.id === node.id);
        if (exists) {
            console.log('[AnimList] Element already in sequence:', node.id);
            return;
        }

        this.sequenceList.push({ id: node.id, node: node });
        this._renderListItems();
        this._saveToSvg();
        this._updateVisibility();
    }

    /**
     * リストから指定インデックスの図形を削除する
     */
    removeFromSequence(index) {
        if (index < 0 || index >= this.sequenceList.length) return;
        this.sequenceList.splice(index, 1);
        this._renderListItems();
        this._saveToSvg();
        this._updateVisibility();
    }

    /**
     * リストを全てクリアする
     */
    clearAll() {
        if (this.sequenceList.length === 0) return;
        const msg = t('svgEditor.animList.clearConfirm') || 'アニメーションリストを全てクリアしますか？';
        if (!confirm(msg)) return;

        this.sequenceList = [];
        this._renderListItems();
        this._saveToSvg();
        this._updateVisibility();
    }

    /**
     * ツールバーの表示/非表示を更新する
     */
    _updateVisibility() {
        // リストが空でも常に表示（追加方法の案内がある）
        if (this.toolbarElement) {
            this.toolbarElement.style.display = 'flex';
        }
    }

    // ===== ドラッグ並び替え =====
    _bindDragReorder(element, index) {
        element.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index.toString());
            e.dataTransfer.effectAllowed = 'move';
            element.style.opacity = '0.5';
        });

        element.addEventListener('dragend', () => {
            element.style.opacity = '1';
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            element.style.borderColor = '#E65100';
        });

        element.addEventListener('dragleave', () => {
            element.style.borderColor = '';
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.style.borderColor = '';
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;
            if (fromIndex === toIndex || isNaN(fromIndex)) return;

            // 配列の並び替え
            const [moved] = this.sequenceList.splice(fromIndex, 1);
            this.sequenceList.splice(toIndex, 0, moved);

            this._renderListItems();
            this._saveToSvg();
        });
    }

    // ===== 右クリックメニュー =====
    _showItemContextMenu(e, index) {
        if (typeof hideSVGContextMenu === 'function') {
            hideSVGContextMenu();
        }

        const menu = document.createElement('div');
        menu.className = 'svg-context-menu';
        menu.style.cssText = `
            position: fixed;
            background: var(--svg-toolbar-bg);
            border: 1px solid var(--svg-toolbar-border);
            box-shadow: 0 4px 15px var(--svg-toolbar-shadow);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 10001;
            border-radius: 8px;
            padding: 4px 0;
            font-size: 13px;
            min-width: 150px;
            font-family: sans-serif;
            color: var(--svg-toolbar-fg);
        `;

        const removeItem = document.createElement('div');
        removeItem.textContent = t('svgEditor.animList.removeFromList') || 'リストから削除';
        removeItem.style.cssText = 'padding: 6px 16px; cursor: pointer; color: var(--svg-toolbar-fg);';
        removeItem.addEventListener('mouseenter', () => removeItem.style.background = 'var(--svg-toolbar-btn-hover-bg)');
        removeItem.addEventListener('mouseleave', () => removeItem.style.background = 'transparent');
        removeItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.removeFromSequence(index);
            menu.remove();
        });
        menu.appendChild(removeItem);

        document.body.appendChild(menu);

        // 位置調整
        if (typeof adjustMenuPosition === 'function') {
            adjustMenuPosition(menu, e.clientX, e.clientY);
        } else {
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
        }

        // メニュー外クリックで閉じる
        const cleanup = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('pointerdown', cleanup, true);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', cleanup, true), 0);
    }

    // ===== 永続化（SVG属性への保存/読み込み） =====

    /**
     * リストデータをSVGのルート要素に保存する
     */
    _saveToSvg() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const svgNode = window.currentEditingSVG.draw.node;

        const ids = this.sequenceList.map(item => item.id);
        if (ids.length > 0) {
            svgNode.setAttribute('data-anim-sequence', JSON.stringify(ids));
        } else {
            svgNode.removeAttribute('data-anim-sequence');
        }

        // 再生モードも保存
        svgNode.setAttribute('data-anim-sequence-mode', this.isAutoMode ? 'auto' : 'step');

        // [FIX] リスト順やモードが変わった時はDelayを再計算してDOMに保存する
        this._updateDomDelays(false);

        if (window.syncChanges) window.syncChanges(true);
    }

    /**
     * SVGのルート要素からリストデータを読み込む
     */
    loadFromSvg() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const svgNode = window.currentEditingSVG.draw.node;

        const seqAttr = svgNode.getAttribute('data-anim-sequence');
        const modeAttr = svgNode.getAttribute('data-anim-sequence-mode');

        this.isAutoMode = modeAttr !== 'step';
        this.sequenceList = [];

        if (seqAttr) {
            try {
                const ids = JSON.parse(seqAttr);
                ids.forEach(id => {
                    const node = svgNode.querySelector('#' + CSS.escape(id));
                    if (node) {
                        this.sequenceList.push({ id, node });
                    }
                });
            } catch (e) {
                console.warn('[AnimListToolbar] Failed to parse data-anim-sequence:', e);
            }
        }

        this.renderContents();
        this._updateVisibility();
    }

    /**
     * 図形が削除された場合にリストから自動除外する
     */
    syncWithDom() {
        const before = this.sequenceList.length;
        this.sequenceList = this.sequenceList.filter(item => {
            return item.node && item.node.isConnected;
        });

        if (this.sequenceList.length !== before) {
            this._renderListItems();
            this._saveToSvg();
        }
    }

    destroy() {
        this._unbindSpaceKey();
        if (this._playTimer) {
            clearTimeout(this._playTimer);
            this._playTimer = null;
        }
        if (this.toolbarElement) this.toolbarElement.remove();
    }

    resetPosition() {
        super.resetPosition();
    }
}

// グローバルファクトリ
window.createAnimationListToolbar = (container, options) => {
    return new SVGAnimationListToolbar(container, options);
};
