/**
 * SVG Animation Timing Toolbar
 * タイミングおよび変形の基準点（Transform Origin）を設定するUIモジュール。
 * 十字マーカーをドラッグして「関節」の位置を視覚的にリギングできます。
 */
var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);
class SVGAnimationTimingToolbar extends SVGToolbarBase {
    constructor(container, options = {}) {
        super({
            id: options.id || 'svg-animation-timing-toolbar',
            container: container,
            borderColor: options.borderColor || '#FF5722',
            position: options.position || { top: '60px', right: '-36px' },
            isSwapped: true
        });
        this.onValueChange = options.onValueChange || (() => { });
        this.inputs = {};
        this.isSettingOrigin = false; // 基準点設定モードのフラグ
        this.markerGroup = null;     // 十字マーカーのSVG.jsグループ
        this.activeElement = null;   // 現在設定対象の要素

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
        this.toolbarElement.classList.add('svg-animation-timing-toolbar');

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
        label.textContent = t('svgEditor.animTiming.label') || 'タイミング/基点:';
        contentArea.appendChild(label);

        // 基準点設定ボタン (トグル)
        const setOriginBtn = document.createElement('button');
        setOriginBtn.innerHTML = t('svgEditor.animTiming.originBtn') || '🎯 基点設定';
        setOriginBtn.title = t('svgEditor.animTiming.originBtnTitle') || 'キャンバス上に基準点マーカーを表示して、ドラッグで位置を設定します';
        setOriginBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; cursor: pointer; border-radius: 4px; border: 1px solid var(--svg-toolbar-border);';
        setOriginBtn.addEventListener('click', () => this.toggleOriginSettingMode());
        contentArea.appendChild(setOriginBtn);
        this.inputs['setOriginBtn'] = setOriginBtn;

        // X座標
        const xWrap = document.createElement('div');
        xWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        xWrap.innerHTML = '<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">X:</span>';
        const xInput = document.createElement('input');
        xInput.type = 'number';
        xInput.style.width = '45px';
        xInput.style.textAlign = 'right';
        xInput.addEventListener('change', () => this.handleOriginCoordsChange());
        xInput.addEventListener('keydown', (e) => e.stopPropagation());
        xWrap.appendChild(xInput);
        contentArea.appendChild(xWrap);
        this.inputs['originX'] = xInput;

        // Y座標
        const yWrap = document.createElement('div');
        yWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        yWrap.innerHTML = '<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;">Y:</span>';
        const yInput = document.createElement('input');
        yInput.type = 'number';
        yInput.style.width = '45px';
        yInput.style.textAlign = 'right';
        yInput.addEventListener('change', () => this.handleOriginCoordsChange());
        yInput.addEventListener('keydown', (e) => e.stopPropagation());
        yWrap.appendChild(yInput);
        contentArea.appendChild(yWrap);
        this.inputs['originY'] = yInput;

        contentArea.appendChild(this.createSeparator());

        // 遅延 (Delay)
        const delayWrap = document.createElement('div');
        delayWrap.style.cssText = 'display:flex; align-items:center; gap:2px; margin:0 2px;';
        delayWrap.innerHTML = `<span style="color:var(--svg-toolbar-fg); font-size:10px; opacity:0.7;" title="${t('svgEditor.animTiming.delayTitle') || 'アニメーション開始の遅延（マイナス値で位相をずらせます）'}">${t('svgEditor.animTiming.delay') || '遅延:'}</span>`;
        const delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.style.width = '45px';
        delayInput.style.textAlign = 'right';
        delayInput.step = '0.1';
        delayInput.value = '0';
        delayInput.addEventListener('change', () => this.handleDelayChange());
        delayInput.addEventListener('keydown', (e) => e.stopPropagation());
        delayWrap.appendChild(delayInput);
        contentArea.appendChild(delayWrap);
        this.inputs['delay'] = delayInput;
    }

    createSeparator() {
        const sep = document.createElement('div');
        sep.className = 'svg-toolbar-separator';
        return sep;
    }

    /**
     * 基準点設定モードのトグル切り替え
     */
    toggleOriginSettingMode() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements)[0];
        if (!selected) {
            alert(t('svgEditor.animTiming.selectElementAlert') || '基準点を設定する要素を選択してください。');
            return;
        }

        this.isSettingOrigin = !this.isSettingOrigin;
        this.inputs['setOriginBtn'].classList.toggle('active', this.isSettingOrigin);

        if (this.isSettingOrigin) {
            this.activeElement = selected;
            this.showOriginMarker();
        } else {
            this.hideOriginMarker();
            this.activeElement = null;
        }
    }

    /**
     * 十字マーカーをキャンバス上に描画し、ドラッグ可能にする
     */
    showOriginMarker() {
        if (!this.activeElement || !window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        this.hideOriginMarker();

        const draw = window.currentEditingSVG.draw;
        const domNode = this.activeElement.node || this.activeElement;

        // アニメーションラッパーがあればそれを対象とする
        let wrapper = domNode.closest('[class*="anim-wrapper-"]');

        let originX, originY;
        if (wrapper && wrapper.getAttribute('data-origin-x') !== null) {
            originX = parseFloat(wrapper.getAttribute('data-origin-x'));
            originY = parseFloat(wrapper.getAttribute('data-origin-y'));
        } else if (domNode.getAttribute('data-origin-x') !== null) {
            originX = parseFloat(domNode.getAttribute('data-origin-x'));
            originY = parseFloat(domNode.getAttribute('data-origin-y'));
        } else {
            // デフォルトは要素のバウンディングボックスの中心
            try {
                const bbox = domNode.getBBox();
                originX = bbox.x + bbox.width / 2;
                originY = bbox.y + bbox.height / 2;

                // 丸め処理
                originX = Math.round(originX * 10) / 10;
                originY = Math.round(originY * 10) / 10;
            } catch (e) {
                originX = 0;
                originY = 0;
            }
        }

        this.inputs['originX'].value = originX;
        this.inputs['originY'].value = originY;

        // ワールド座標（キャンバス上の絶対位置）へ変換
        let worldPt;
        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
            // 基準座標系は activeElement の CTM を使用
            worldPt = window.SVGUtils.mapLocalToOverlay({ x: originX, y: originY }, domNode, draw.node);
        } else {
            const p = draw.node.createSVGPoint();
            p.x = originX;
            p.y = originY;
            worldPt = p.matrixTransform(domNode.getCTM());
        }

        // 十字マーカーのグループを作成
        this.markerGroup = draw.group().addClass('svg-origin-marker-group').attr('data-internal', 'true');
        this.markerGroup.node.style.pointerEvents = 'none';

        const size = 15;
        this.markerLineH = this.markerGroup.line(worldPt.x - size, worldPt.y, worldPt.x + size, worldPt.y)
            .stroke({ color: '#FF5722', width: 2 });
        this.markerLineV = this.markerGroup.line(worldPt.x, worldPt.y - size, worldPt.x, worldPt.y + size)
            .stroke({ color: '#FF5722', width: 2 });

        // 見た目のオレンジ色の円
        this.markerVisual = this.markerGroup.circle(10).center(worldPt.x, worldPt.y)
            .fill('#FF5722').stroke({ color: '#ffffff', width: 1.5 })
            .attr({ 'style': 'pointer-events:none;' });

        // ドラッグ操作用の透明な円（スケーリング縮小されても十分な当たり判定直径24pxを確保）
        this.markerCenter = this.markerGroup.circle(24).center(worldPt.x, worldPt.y)
            .fill('transparent').stroke({ color: 'transparent', width: 1 })
            .addClass('svg-origin-marker-handle')
            .attr({
                'cursor': 'move',
                'style': 'pointer-events:all;'
            });

        // ズームの影響を受けないようにスケーリング
        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
            window.SVGUtils.updateHandleScaling(this.markerLineH);
            window.SVGUtils.updateHandleScaling(this.markerLineV);
            window.SVGUtils.updateHandleScaling(this.markerVisual);
            window.SVGUtils.updateHandleScaling(this.markerCenter);
        }

        // ドラッグイベントのバインド
        this._bindMarkerDrag();
    }

    /**
     * 十字マーカーを非表示にする
     */
    hideOriginMarker() {
        if (this.markerGroup) {
            this.markerGroup.remove();
            this.markerGroup = null;
        }
    }

    _bindMarkerDrag() {
        if (!this.markerCenter) return;

        let isDragging = false;
        const centerNode = this.markerCenter.node;
        const domNode = this.activeElement.node || this.activeElement;

        // ドラッグ開始時の座標空間マッピング用の行列をキャッシュする変数
        let startScreenCTMInverse = null;
        let startCTM = null;
        const draw = window.currentEditingSVG.draw;

        const onPointerDown = (e) => {
            e.stopPropagation();
            e.preventDefault();
            isDragging = true;

            // ポインターキャプチャを設定（タッチ操作の追従性を向上）
            if (typeof centerNode.setPointerCapture === 'function') {
                centerNode.setPointerCapture(e.pointerId);
            }

            // ドラッグ開始時の CTM をキャッシュする
            // アニメーション中の変形変化（回転など）やドラッグ中の transform-origin 書き換えによる
            // 座標空間の変動（フィードバック暴走）を完全に防ぎます。
            const ctm = domNode.getScreenCTM();
            if (ctm) {
                startScreenCTMInverse = ctm.inverse();
            }
            startCTM = domNode.getCTM();

            // オーバーレイ要素の逆変換行列をキャッシュ
            let startOverlayMatrixInverse = null;
            const overlayNode = draw.node;
            if (overlayNode && typeof overlayNode.getCTM === 'function') {
                const overlayMatrix = overlayNode.getCTM();
                if (overlayMatrix) {
                    startOverlayMatrixInverse = overlayMatrix.inverse();
                }
            }

            const onPointerMove = (moveEvent) => {
                if (!isDragging || !startScreenCTMInverse || !startCTM) return;

                // スクリーン座標を対象要素のドラッグ開始時のローカル座標に逆変換する
                const svg = domNode.ownerSVGElement;
                const p = svg.createSVGPoint();
                p.x = moveEvent.clientX;
                p.y = moveEvent.clientY;

                const localPt = p.matrixTransform(startScreenCTMInverse);
                const ox = Math.round(localPt.x * 10) / 10;
                const oy = Math.round(localPt.y * 10) / 10;

                this.inputs['originX'].value = ox;
                this.inputs['originY'].value = oy;

                this.applyOriginChange(ox, oy);

                // マーカー位置の更新
                // ドラッグ開始時の CTM に基づき、移動後のローカル座標 ox, oy から overlay 座標（draw.node）に変換する
                const pt = draw.node.createSVGPoint();
                pt.x = ox;
                pt.y = oy;
                let worldPt = pt.matrixTransform(startCTM);
                if (startOverlayMatrixInverse) {
                    worldPt = worldPt.matrixTransform(startOverlayMatrixInverse);
                }

                this.markerCenter.center(worldPt.x, worldPt.y);
                if (this.markerVisual) this.markerVisual.center(worldPt.x, worldPt.y);
                this.markerLineH.plot(worldPt.x - 15, worldPt.y, worldPt.x + 15, worldPt.y);
                this.markerLineV.plot(worldPt.x, worldPt.y - 15, worldPt.x, worldPt.y + 15);

                // ズームの影響を受けないようにスケーリングを再適用
                if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                    window.SVGUtils.updateHandleScaling(this.markerCenter);
                    if (this.markerVisual) window.SVGUtils.updateHandleScaling(this.markerVisual);
                    window.SVGUtils.updateHandleScaling(this.markerLineH);
                    window.SVGUtils.updateHandleScaling(this.markerLineV);
                }
            };

            const onPointerUp = (upEvent) => {
                isDragging = false;
                if (typeof centerNode.releasePointerCapture === 'function') {
                    try {
                        centerNode.releasePointerCapture(upEvent.pointerId);
                    } catch (err) {
                        // キャプチャ解除失敗時のエラーを無視
                    }
                }
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                if (window.syncChanges) window.syncChanges();
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        };

        centerNode.addEventListener('pointerdown', onPointerDown);
    }

    /**
     * 手動の座標入力による基準点変更
     */
    handleOriginCoordsChange() {
        const ox = parseFloat(this.inputs['originX'].value) || 0;
        const oy = parseFloat(this.inputs['originY'].value) || 0;
        this.applyOriginChange(ox, oy);

        // 十字マーカーが表示されていれば再描画して位置更新
        if (this.isSettingOrigin) {
            this.showOriginMarker();
        }
    }

    /**
     * 基準点データを要素に適用する
     */
    applyOriginChange(ox, oy) {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        window.currentEditingSVG.selectedElements.forEach(el => {
            const domNode = el.node || el;

            // 適用されているアニメーションラッパーすべてに対して transform-origin を設定
            let foundWrapper = false;
            let curr = domNode;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                if (classes.includes('anim-wrapper-')) {
                    curr.setAttribute('data-origin-x', ox);
                    curr.setAttribute('data-origin-y', oy);
                    curr.style.transformOrigin = `${ox}px ${oy}px`;
                    foundWrapper = true;
                }
                curr = curr.parentNode;
            }

            // アニメーションがない場合でも、将来の適用時のために
            // 要素自体にdata-origin-*属性をメモしておく
            if (!foundWrapper) {
                domNode.setAttribute('data-origin-x', ox);
                domNode.setAttribute('data-origin-y', oy);
            }
        });
    }

    /**
     * 遅延時間の変更
     */
    handleDelayChange() {
        const delay = parseFloat(this.inputs['delay'].value) || 0;
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        window.currentEditingSVG.selectedElements.forEach(el => {
            const domNode = el.node || el;

            // すべてのアニメーションラッパーを走査して遅延を設定
            let curr = domNode;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const classes = curr.getAttribute('class') || '';
                // SMIL animateMotion は CSS animation-delay ではなく begin 属性で制御するため除外
                if (classes.includes('anim-wrapper-') && !classes.includes('anim-wrapper-motion')) {
                    curr.setAttribute('data-anim-delay', delay);
                    curr.style.animationDelay = `${delay}s`;
                }
                curr = curr.parentNode;
            }
        });

        if (window.syncChanges) window.syncChanges();
    }

    /**
     * 選択要素から現在の設定を復元してUIを更新する
     */
    updateValuesFromSelected() {
        if (!window.currentEditingSVG || !window.currentEditingSVG.selectedElements) return;

        let foundX = '';
        let foundY = '';
        let foundDelay = '0';

        const selected = Array.from(window.currentEditingSVG.selectedElements)[0];
        if (selected) {
            this.activeElement = selected;
            const domNode = selected.node || selected;

            // 1. 基準点の復元
            let curr = domNode;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const ox = curr.getAttribute('data-origin-x');
                const oy = curr.getAttribute('data-origin-y');
                if (ox !== null && oy !== null) {
                    foundX = ox;
                    foundY = oy;
                    break;
                }
                curr = curr.parentNode;
            }

            // 要素自体にもなく、ラッパーにもない場合はBBox中心を仮表示
            if (foundX === '' || foundY === '') {
                try {
                    const bbox = domNode.getBBox();
                    foundX = Math.round((bbox.x + bbox.width / 2) * 10) / 10;
                    foundY = Math.round((bbox.y + bbox.height / 2) * 10) / 10;
                } catch (e) {
                    foundX = 0;
                    foundY = 0;
                }
            }

            // 2. 遅延の復元
            curr = domNode;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const del = curr.getAttribute('data-anim-delay');
                if (del !== null) {
                    foundDelay = del;
                    break;
                }
                curr = curr.parentNode;
            }
        } else {
            this.activeElement = null;
            this.isSettingOrigin = false;
            this.inputs['setOriginBtn'].classList.remove('active');
            this.hideOriginMarker();
        }

        this.inputs['originX'].value = foundX;
        this.inputs['originY'].value = foundY;
        this.inputs['delay'].value = foundDelay;

        // モード中かつ要素が変更された場合はマーカーの表示を更新
        if (this.isSettingOrigin && this.activeElement) {
            this.showOriginMarker();
        }
    }

    destroy() {
        this.hideOriginMarker();
        if (this.toolbarElement) this.toolbarElement.remove();
    }
}

// グローバルファクトリ
window.createAnimationTimingToolbar = (container, options) => {
    return new SVGAnimationTimingToolbar(container, options);
};
