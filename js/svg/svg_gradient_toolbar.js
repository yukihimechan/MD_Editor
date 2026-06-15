/**
 * SVG Gradient Toolbar
 * フリーフォーム・グラデーション（グラデーションメッシュ風表現）を設定・編集するツールバー
 */
class SVGGradientToolbar extends SVGToolbarBase {
    constructor(container, svgToolbar, options = {}) {
        super({
            id: options.id || 'svg-gradient-toolbar',
            container: container,
            borderColor: options.borderColor || '#E74BA8', // ピンク・マゼンタ系カラー
            position: options.position || { top: '230px', left: '-37px' }
        });
        this.svgToolbar = svgToolbar;
        this.isEditing = false;
        this.colorIndicatorsContainer = null;
        this.targetGroup = null; // 現在編集対象のグラデーショングループ (SVG.js オブジェクト)
        this.controlUiGroup = null; // キャンバス上の制御UI表示用一時グループ (SVG.js オブジェクト)
        this.activeColorPicker = null;
        this.selectedPathId = null; // 選択中のグラデーションパス（色）のID

        this.createToolbar();
        this.addGlobalClickClose();
    }

    createToolbar() {
        const { toolbar, contentArea } = this.createBaseToolbar({
            id: this.id,
            borderColor: this.config.borderColor,
            position: this.config.position
        });
        this.toolbarElement = toolbar;
        this.contentArea = contentArea;

        this.toolbarElement.classList.add('svg-gradient-toolbar');

        this.renderContents();

        if (this.container) {
            this.container.appendChild(this.toolbarElement);
        }
    }

    renderContents() {
        const contentArea = this.contentArea;
        contentArea.innerHTML = '';
        contentArea.style.display = 'flex';
        contentArea.style.alignItems = 'center';
        contentArea.style.gap = '4px';

        // 1. 編集ON/OFFボタン (トグル式)
        this.toggleEditBtn = document.createElement('button');
        this.toggleEditBtn.title = 'グラデーション編集 ON/OFF';
        this.toggleEditBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z" fill="currentColor" fill-opacity="0.3"/>
            </svg>
        `;
        this.toggleEditBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleEditMode();
        };
        contentArea.appendChild(this.toggleEditBtn);

        // 2. 区切り線
        const sep1 = document.createElement('div');
        sep1.className = 'svg-toolbar-separator';
        contentArea.appendChild(sep1);

        // 3. カラーインジケータ・コンテナ
        this.colorIndicatorsContainer = document.createElement('div');
        this.colorIndicatorsContainer.className = 'svg-gradient-indicators';
        this.colorIndicatorsContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 20px;
            max-width: 150px;
            overflow-x: auto;
            padding: 2px 0;
        `;
        this.colorIndicatorsContainer.style.scrollbarWidth = 'none';
        contentArea.appendChild(this.colorIndicatorsContainer);

        // 4. 区切り線
        const sep2 = document.createElement('div');
        sep2.className = 'svg-toolbar-separator';
        contentArea.appendChild(sep2);

        // 5. 色追加ボタン
        this.addColorBtn = document.createElement('button');
        this.addColorBtn.title = 'グラデーションに色（パス）を追加';
        this.addColorBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        `;
        this.addColorBtn.onclick = (e) => {
            e.stopPropagation();
            this.activateAddColorTool();
        };
        this.addColorBtn.disabled = true;
        contentArea.appendChild(this.addColorBtn);

        // 6. 区切り線
        const sep3 = document.createElement('div');
        sep3.className = 'svg-toolbar-separator';
        contentArea.appendChild(sep3);

        // 7. ぼかし量（太さ）スライダーのコンテナ
        const thicknessContainer = document.createElement('div');
        thicknessContainer.className = 'svg-gradient-thickness-container';
        thicknessContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            color: #666;
            font-size: 12px;
        `;

        const label = document.createElement('span');
        label.textContent = 'ぼかし量:';
        thicknessContainer.appendChild(label);

        this.thicknessSlider = document.createElement('input');
        this.thicknessSlider.type = 'range';
        this.thicknessSlider.className = 'svg-gradient-thickness-slider';
        this.thicknessSlider.min = '10';
        this.thicknessSlider.max = '250';
        this.thicknessSlider.step = '1';
        this.thicknessSlider.value = '30';
        this.thicknessSlider.disabled = true;
        this.thicknessSlider.style.width = '80px';
        this.thicknessSlider.oninput = (e) => {
            this.handleThicknessChange(parseInt(e.target.value, 10));
        };
        thicknessContainer.appendChild(this.thicknessSlider);

        this.thicknessValueLabel = document.createElement('span');
        this.thicknessValueLabel.className = 'svg-gradient-thickness-value';
        this.thicknessValueLabel.textContent = '30px';
        this.thicknessValueLabel.style.width = '35px';
        thicknessContainer.appendChild(this.thicknessValueLabel);

        contentArea.appendChild(thicknessContainer);
    }

    addGlobalClickClose() {
        // 必要に応じてグローバルクリックイベントのハンドリング
    }

    // 編集モードON/OFF切り替え
    toggleEditMode() {
        if (!window.currentEditingSVG) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements || []);
        if (selected.length === 0 && !this.isEditing) {
            console.debug('[SVGGradientToolbar] 編集対象の図形が選択されていません。');
            return;
        }

        this.isEditing = !this.isEditing;

        if (this.isEditing) {
            let shape = selected[0];
            if (!shape) {
                this.isEditing = false;
                return;
            }

            // 元の図形をグラデーショングループへ変換（未変換の場合）と古い構造のマイグレーション
            this._isConverting = true;
            this.targetGroup = this.convertToGradientGroup(shape);
            if (this.targetGroup) {
                this.targetGroup = this.migrateGradientGroup(this.targetGroup);
            }
            this._isConverting = false;
            if (!this.targetGroup) {
                this.isEditing = false;
                return;
            }

            this.toggleEditBtn.classList.add('active');
            this.addColorBtn.disabled = false;

            // すりガラス効果の展開
            this.applyBackdropBlur(true);

            // 対象図形のトランスフォーム変形ロック
            window.currentEditingSVG._inGradientEditMode = true;
            if (window.currentEditingSVG.selectedShapeObj) {
                // SvgShapeインスタンスがあればハンドル表示を隠す
                window.currentEditingSVG.selectedShapeObj.hideHandles();
            }

            // 制御UIの可視化
            this.renderControlHandles();
            
            // インジケータの同期
            this.syncIndicatorsFromMeta();
        } else {
            this.toggleEditBtn.classList.remove('active');
            this.addColorBtn.disabled = true;
            this.addColorBtn.classList.remove('active');

            // すりガラス効果解除
            this.applyBackdropBlur(false);

            // 対象図形の変形ロック解除
            window.currentEditingSVG._inGradientEditMode = false;
            if (window.currentEditingSVG.selectedShapeObj) {
                // SvgShapeインスタンスがあればハンドル表示を復元
                window.currentEditingSVG.selectedShapeObj.showHandles();
            }

            // 制御UIの隠蔽（クリーンアップ）
            this.clearControlHandles();

            // ツールを select に戻す
            if (this.svgToolbar) {
                this.svgToolbar.setTool('select');
            }

            // 編集モード終了時にリサイズマーカーを強制再描画・復元
            if (this.targetGroup && window.selectElement) {
                window.selectElement(this.targetGroup, false, false, true); // force=true
            }

            this.targetGroup = null;

            // 描画内容の保存・同期
            if (window.syncChanges) window.syncChanges();
        }
    }

    // 他の図形のすりガラス効果 (blur + opacity + pointer-events: none)
    applyBackdropBlur(enable) {
        if (!this.targetGroup || !window.currentEditingSVG || !window.currentEditingSVG.draw) return;
        const draw = window.currentEditingSVG.draw;
        const targetNode = this.targetGroup.node;

        draw.children().forEach(child => {
            const node = child.node;
            if (node === targetNode) return;

            // 除外対象のタグ
            const tagName = node.tagName.toLowerCase();
            if (['defs', 'style', 'marker', 'symbol'].includes(tagName)) return;

            // 制御UIなどの内部ツール要素も除外
            if (child.hasClass('svg-grad-control-ui') || 
                child.hasClass('svg-canvas-proxy') || 
                child.hasClass('svg-canvas-border')) return;

            if (enable) {
                child.addClass('svg-grad-blur-back');
                node.style.filter = 'blur(4px) opacity(0.5)';
                node.style.pointerEvents = 'none';
            } else {
                child.removeClass('svg-grad-blur-back');
                node.style.filter = '';
                node.style.pointerEvents = '';
            }
        });
    }

    // 図形をグラデーション対応グループに変換する
    convertToGradientGroup(shape) {
        if (shape.attr('data-has-gradient') === 'true') {
            return shape;
        }

        // すでにグループだが data-has-gradient を持たない、あるいは単体図形である場合
        // グループに変換する。
        // 単体図形: rect, circle, ellipse, path, polygon, polyline など
        const tagName = shape.node.tagName.toLowerCase();
        if (['g', 'defs', 'style', 'marker', 'symbol', 'text'].includes(tagName)) {
            if (tagName !== 'g') {
                console.warn('[SVGGradientToolbar] この要素はグラデーションに変換できません:', tagName);
                return null;
            }
        }

        const draw = shape.parent();
        if (!draw) return null;

        const originalId = shape.id();
        const toolId = shape.attr('data-tool-id') || tagName;
        const originalFill = shape.attr('fill') || '#ffffff';

        // 1. 新しいグループを作成
        const group = draw.group();
        const groupId = 'grad_group_' + Date.now();
        group.id(originalId); // 元のIDをグループが引き継ぐ
        group.attr({
            'data-tool-id': toolId,
            'data-has-gradient': 'true'
        });

        // 2. 元の図形を複製してベースおよびクリップパス用にする
        const baseShapeId = originalId + '_base';
        shape.id(baseShapeId); // 元の図形のIDを変更

        // 元の位置にグループを挿入するため、元の図形の前にグループを挿入し、元の図形を削除する
        shape.before(group);
        shape.remove();

        // defs を作成
        const defs = group.defs();
        
        // clipPath を作成
        const clipPath = defs.element('clipPath');
        const clipId = 'clip_' + originalId;
        clipPath.id(clipId);
        
        // 元の図形を clipPath に複製して入れる。fill は不透明色（白色）にする。
        const clipShape = shape.clone();
        clipShape.attr({
            'fill': '#ffffff',
            'stroke': 'none',
            'id': originalId + '_clip'
        });
        clipPath.add(clipShape);

        // filter を作成
        const filter = defs.element('filter');
        const filterId = 'filter_' + originalId;
        filter.id(filterId);
        filter.attr({
            'x': '-50%',
            'y': '-50%',
            'width': '200%',
            'height': '200%'
        });
        // feGaussianBlur効果を追加
        const blur = filter.element('feGaussianBlur');
        blur.attr({
            'stdDeviation': '15',
            'result': 'blur'
        });

        // 3. 描画用グループを二重構造で作成
        // 外側: クリップ用グループ
        const clipGroup = group.group();
        clipGroup.attr({
            'clip-path': `url(#${clipId})`
        });

        // 内側: ぼかしフィルター用グループ
        const filterGroup = clipGroup.group();
        filterGroup.attr({
            'filter': `url(#${filterId})`
        });

        // ベース背景 (元の塗りつぶし色)
        // bboxをカバーするために十分な大きさの矩形
        const bbox = shape.bbox();
        const bgRect = filterGroup.rect(bbox.width * 3, bbox.height * 3);
        bgRect.center(bbox.cx, bbox.cy);
        bgRect.attr('fill', originalFill === 'none' ? '#ffffff' : originalFill);

        // 境界線（輪郭線）を維持するための要素を作成
        const strokeShape = shape.clone();
        strokeShape.addClass('svg-gradient-stroke');
        strokeShape.attr({
            'fill': 'none',
            'id': originalId + '_stroke'
        });
        group.add(strokeShape);

        // 4. メタデータ用グループを作成
        const metaGroup = group.group();
        metaGroup.addClass('svg-gradient-meta');
        metaGroup.node.style.display = 'none';
        metaGroup.attr('data-target-shape', baseShapeId);

        // 5. 元の図形の実体を defs に退避（再編集・属性取得用として保持）
        defs.add(shape);

        // 再選択
        if (window.selectElement) {
            window.selectElement(group);
        }

        return group;
    }

    // 色追加ツールの有効化
    activateAddColorTool() {
        if (!this.isEditing || !this.targetGroup) return;
        if (this.svgToolbar) {
            this.svgToolbar.setTool('gradient_add');
            this.addColorBtn.classList.add('active');
        }
    }

    // キャンバス上の制御UIを描画
    renderControlHandles() {
        this.clearControlHandles(true); // 選択状態を維持したままハンドルUIのみ再生成する
        if (!this.targetGroup || !window.currentEditingSVG || !window.currentEditingSVG.draw) return;

        const draw = window.currentEditingSVG.draw;
        this.controlUiGroup = draw.group();
        this.controlUiGroup.addClass('svg-grad-control-ui');

        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        this.polylineHandlers = this.polylineHandlers || [];

        metaGroup.children().forEach((pathEl, idx) => {
            const color = pathEl.attr('data-color') || '#FF0000';
            const isSelected = (pathEl.id() === this.selectedPathId);

            // 各色パスに対して SvgPolylineHandler を作成
            const handler = new SvgPolylineHandler(window.currentEditingSVG.container, () => {
                // 頂点移動やハンドル変更時のコールバック
                const newD = pathEl.attr('d');
                // レンダリング用描画グループの対応パスも更新
                this.updateRenderingPath(idx, newD);

                // インジケータ（ツールバーの四角）を同期
                this.syncIndicatorsFromMeta();

                // 変更をエディタに同期
                if (window.syncChanges) window.syncChanges();
            }, {
                customColor: color, // カスタムの描画色
                handleClass: 'svg-grad-control-handle', // テストや互換性のためのカスタムクラス
                disableConnectors: true, // グラデーション点移動時はコネクタ接続を無効化
                onVertexClick: (e, vertexIdx) => {
                    // 頂点クリック時はColorPickerは表示せず、選択状態にするだけにする
                    this.selectPath(pathEl.id());
                },
                enableSkeleton: true,
                isSelected: isSelected, // 選択中かどうかを渡す
                onSkeletonDrag: (dx, dy) => {
                    // 骨組み線をドラッグしたときに、選択している色の図形（PATH）をローカル平行移動させる
                    if (this.targetGroup) {
                        const currentD = pathEl.attr('d');
                        const coords = this.parsePathCoords(currentD);
                        if (coords.length > 0) {
                            const newCoords = coords.map(pt => ({
                                x: pt.x + dx,
                                y: pt.y + dy
                            }));
                            const newD = newCoords.map((pt, i) => (i === 0 ? 'M' : 'L') + ` ${pt.x} ${pt.y}`).join(' ');
                            pathEl.attr('d', newD);

                            // レンダリング用描画グループの対応パスも更新
                            this.updateRenderingPath(idx, newD);

                            // インジケータ（ツールバーの四角）を同期
                            this.syncIndicatorsFromMeta();

                            // 変更をエディタに同期
                            if (window.syncChanges) window.syncChanges();
                        }
                    }
                },
                onSkeletonDragEnd: () => {
                    this.renderControlHandles();
                }
            });

            this.polylineHandlers.push(handler);

            const bbox = pathEl.bbox();
            // ハンドルUIの描画を起動
            handler.update(this.controlUiGroup.node, pathEl.node, bbox);
        });
    }

    // 制御UIのクリア
    clearControlHandles(keepSelection = false) {
        if (!keepSelection) {
            this.clearSelection();
        }
        if (this.polylineHandlers) {
            this.polylineHandlers.forEach(h => {
                try { h.hide(); } catch (e) {}
            });
            this.polylineHandlers = [];
        }
        if (this.controlUiGroup) {
            this.controlUiGroup.remove();
            this.controlUiGroup = null;
        }
        if (this.activeColorPicker) {
            try {
                this.activeColorPicker.destroy();
            } catch (e) {}
            this.activeColorPicker = null;
        }
    }

    // パスのd属性から座標を配列で取得するヘルパー
    parsePathCoords(d) {
        if (!d) return [];
        const matches = d.match(/([ML])\s*([\d.-]+)\s+([\d.-]+)/gi);
        if (!matches) return [];
        return matches.map(m => {
            const parts = m.trim().split(/\s+/);
            return {
                x: parseFloat(parts[1]),
                y: parseFloat(parts[2])
            };
        });
    }

    // レンダリング用描画グループ内のパス座標更新
    updateRenderingPath(index, d) {
        if (!this.targetGroup) return;
        // クリップ用グループを取得
        const clipGroup = this.targetGroup.findOne('[clip-path]');
        if (!clipGroup) return;
        
        // フィルター用グループを取得
        const filterGroup = clipGroup.findOne('g');
        if (!filterGroup) return;

        // 背景矩形の次からが描画パス。インデックスに対応するパスを取得
        // (0番目は背景の矩形のため、 index + 1)
        const paths = filterGroup.children();
        const renderPath = paths[index + 1];
        if (renderPath) {
            renderPath.attr('d', d);
        }
    }

    // メタデータからツールバーのインジケータ（□）を同期再構築
    syncIndicatorsFromMeta() {
        if (!this.colorIndicatorsContainer) return;
        this.colorIndicatorsContainer.innerHTML = '';

        if (!this.targetGroup) return;
        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        metaGroup.children().forEach((pathEl, idx) => {
            const color = pathEl.attr('data-color') || '#FF0000';

            const indicator = document.createElement('div');
            indicator.className = 'svg-gradient-indicator-item';
            indicator.style.cssText = `
                width: 16px;
                height: 16px;
                background-color: ${color};
                border: 1px solid #ccc;
                border-radius: 2px;
                cursor: pointer;
                position: relative;
                flex-shrink: 0;
            `;
            
            // ホバー時の「×」削除ボタン
            const deleteBtn = document.createElement('span');
            deleteBtn.innerHTML = '&times;';
            deleteBtn.style.cssText = `
                display: none;
                position: absolute;
                top: -6px;
                right: -6px;
                background: red;
                color: white;
                border-radius: 50%;
                width: 12px;
                height: 12px;
                font-size: 9px;
                line-height: 10px;
                text-align: center;
                cursor: pointer;
                font-weight: bold;
            `;
            indicator.appendChild(deleteBtn);

            indicator.onmouseover = () => deleteBtn.style.display = 'block';
            indicator.onmouseout = () => deleteBtn.style.display = 'none';

            // 左クリックで再編集
            indicator.onclick = (e) => {
                e.stopPropagation();
                this.showPickerForPath(pathEl, indicator);
            };

            // 右クリックまたは「×」で削除
            const removeAction = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.removePath(idx);
            };
            deleteBtn.onclick = removeAction;
            indicator.oncontextmenu = removeAction;

            this.colorIndicatorsContainer.appendChild(indicator);
        });

        // 追加：インジケータのハイライトを更新
        this.updateIndicatorHighlight();
    }

    // 特定のコントロールパスに対するカラーピッカー表示
    showPickerForPath(pathEl, triggerEl) {
        if (this.activeColorPicker) {
            try { this.activeColorPicker.destroy(); } catch (e) {}
        }

        const pathId = pathEl.id(); // IDを取得して保持
        const currentColor = pathEl.attr('data-color') || '#FF0000';
        
        // 追加：このパスを選択状態にする
        this.selectPath(pathId);
        
        if (typeof ColorPickerUI === 'undefined') return;

        this.activeColorPicker = new ColorPickerUI({
            color: currentColor,
            isPopup: true,
            skipInitialChange: true,
            onChange: (color) => {
                const hex = typeof color.toHexString === 'function' ? color.toHexString(true) : color;
                
                // 現在の最新のDOMからパス要素を取得
                if (!this.targetGroup) return;
                const currentPathEl = this.targetGroup.findOne('#' + pathId);
                if (currentPathEl) {
                    // メタデータのパス色更新
                    currentPathEl.attr('data-color', hex);
                }

                // ツールバーの枠線色とトグルボタンの色を更新
                if (this.selectedPathId === pathId) {
                    if (this.toolbarElement) {
                        this.toolbarElement.style.setProperty('border-color', hex, 'important');
                    }
                    if (this.toggleEditBtn) {
                        this.toggleEditBtn.style.setProperty('background', hex, 'important');
                    }
                }

                // レンダリング用パスとコントロールハンドルの色更新
                this.syncColorToPathAndHandle(pathId, hex);

                // ツールバーのインジケータも同期更新
                this.syncIndicatorsFromMeta();

                // 変更をMarkdownエディタソースに同期する
                if (window.syncChanges) window.syncChanges();
            }
        });

        this.activeColorPicker.show(triggerEl);
    }

    selectPath(pathId) {
        if (!this.targetGroup) return;
        const pathEl = this.targetGroup.findOne('#' + pathId);
        if (!pathEl) {
            this.clearSelection();
            return;
        }

        const prevSelectedId = this.selectedPathId;
        this.selectedPathId = pathId;
        const color = pathEl.attr('data-color') || '#FF0000';
        const thickness = parseInt(pathEl.attr('data-thickness') || '30', 10);

        // ツールバーの枠線色とトグルボタンの色を同期
        if (this.toolbarElement) {
            this.toolbarElement.style.setProperty('border-color', color, 'important');
        }
        if (this.toggleEditBtn) {
            this.toggleEditBtn.style.setProperty('background', color, 'important');
            this.toggleEditBtn.style.setProperty('color', '#fff', 'important');
        }

        // スライダーの更新
        if (this.thicknessSlider) {
            this.thicknessSlider.value = thickness;
            this.thicknessSlider.disabled = false;
        }
        if (this.thicknessValueLabel) {
            this.thicknessValueLabel.textContent = `${thickness}px`;
        }

        // インジケータの表示更新（アクティブ枠線の適用）
        this.updateIndicatorHighlight();

        // 選択されたパスが変わった場合のみ、制御UIハンドルを再描画する
        if (prevSelectedId !== pathId) {
            this.renderControlHandles();
        }
    }

    clearSelection() {
        const prevSelectedId = this.selectedPathId;
        this.selectedPathId = null;

        // 枠線とトグルボタンの色をデフォルトに戻す
        if (this.toolbarElement) {
            this.toolbarElement.style.setProperty('border-color', this.config.borderColor || '#E74BA8', 'important');
        }
        if (this.toggleEditBtn) {
            this.toggleEditBtn.style.removeProperty('background');
            this.toggleEditBtn.style.removeProperty('color');
        }

        // スライダーのリセットと非活性化
        if (this.thicknessSlider) {
            this.thicknessSlider.disabled = true;
            this.thicknessSlider.value = '30';
        }
        if (this.thicknessValueLabel) {
            this.thicknessValueLabel.textContent = '30px';
        }

        this.updateIndicatorHighlight();

        // 選択が解除された場合のみ、制御UIハンドルを再描画する
        if (prevSelectedId !== null) {
            this.renderControlHandles();
        }
    }

    updateIndicatorHighlight() {
        if (!this.colorIndicatorsContainer) return;
        const items = this.colorIndicatorsContainer.querySelectorAll('.svg-gradient-indicator-item');
        if (!this.targetGroup) return;
        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        metaGroup.children().forEach((pathEl, idx) => {
            const item = items[idx];
            if (!item) return;
            if (this.selectedPathId === pathEl.id()) {
                item.style.border = '2px solid #000';
                item.style.boxShadow = '0 0 4px rgba(0,0,0,0.5)';
                item.style.transform = 'scale(1.1)';
            } else {
                item.style.border = '1px solid #ccc';
                item.style.boxShadow = 'none';
                item.style.transform = 'none';
            }
        });
    }

    handleThicknessChange(thickness) {
        if (!this.selectedPathId || !this.targetGroup) return;

        // 1. メタデータパスの data-thickness を更新
        const metaPath = this.targetGroup.findOne('#' + this.selectedPathId);
        if (!metaPath) return;

        metaPath.attr('data-thickness', thickness);

        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        // 2. 描画パスの stroke-width を更新
        const index = metaGroup.children().findIndex(child => child.id() === this.selectedPathId);
        if (index !== -1) {
            const clipGroup = this.targetGroup.findOne('[clip-path]');
            if (clipGroup) {
                const filterGroup = clipGroup.findOne('g');
                if (filterGroup) {
                    const renderPath = filterGroup.children()[index + 1]; // 0番目は背景
                    if (renderPath) {
                        renderPath.attr('stroke-width', thickness);
                    }
                }
            }
        }

        // 3. フィルター領域および stdDeviation の自動拡張（全パスの最大値に基づく）
        let maxThickness = thickness;
        metaGroup.children().forEach(child => {
            const t = parseInt(child.attr('data-thickness') || '30', 10);
            if (t > maxThickness) {
                maxThickness = t;
            }
        });

        const svgNode = this.targetGroup.node.ownerSVGElement;
        const defsNode = svgNode ? svgNode.querySelector('defs') : null;
        if (defsNode) {
            // 現在のグラデーション対応グループが使用しているフィルターIDを一意に特定する
            let filterId = null;
            const clipGroup = this.targetGroup.findOne('[clip-path]');
            if (clipGroup) {
                const filterGroup = clipGroup.findOne('g');
                if (filterGroup) {
                    const filterAttr = filterGroup.attr('filter');
                    if (filterAttr) {
                        filterId = filterAttr.replace(/url\(#([^)]+)\)/, '$1');
                    }
                }
            }
            const filterEl = filterId ? defsNode.querySelector('#' + filterId) : defsNode.querySelector('filter');
            if (filterEl) {
                // ぼかし量 stdDeviation も太さに応じて滑らかに拡張する (最小15)
                const stdDev = Math.max(15, Math.round(maxThickness * 0.4));
                const gaussianBlur = filterEl.querySelector('feGaussianBlur, fegaussianblur');
                if (gaussianBlur) {
                    gaussianBlur.setAttribute('stdDeviation', stdDev);
                }
                // クリッピングを防ぐため、太さに比例して計算領域を拡張する
                const pad = Math.max(50, Math.round((maxThickness / 30) * 50));
                filterEl.setAttribute('x', `-${pad}%`);
                filterEl.setAttribute('y', `-${pad}%`);
                filterEl.setAttribute('width', `${100 + pad * 2}%`);
                filterEl.setAttribute('height', `${100 + pad * 2}%`);
            }
        }

        // ラベルの更新
        if (this.thicknessValueLabel) {
            this.thicknessValueLabel.textContent = `${thickness}px`;
        }

        // 変更をMarkdownエディタソースに同期する
        if (window.syncChanges) window.syncChanges();
    }

    // メタデータパスの変更を、実際の描画パスおよびキャンバス上のハンドルに反映
    syncColorToPathAndHandle(pathId, color) {
        console.debug('[SVGGradientToolbar] syncColorToPathAndHandle starting. color:', color, 'pathId:', pathId);
        if (!this.targetGroup) return;

        // 最新のDOMツリーから要素を再取得する（非同期レンダリングによる参照Stale化対策）
        const currentPathEl = this.targetGroup.findOne('#' + pathId);
        if (!currentPathEl) {
            console.warn('[SVGGradientToolbar] syncColorToPathAndHandle failed: path not found for id', pathId);
            return;
        }

        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        const index = metaGroup.children().findIndex(child => child.id() === pathId);
        console.debug('[SVGGradientToolbar] indexOf currentPathEl:', index);
        if (index === -1) return;

        // 1. 描画用パスの更新
        const clipGroup = this.targetGroup.findOne('[clip-path]');
        if (clipGroup) {
            const filterGroup = clipGroup.findOne('g');
            if (filterGroup) {
                const paths = filterGroup.children();
                const renderPath = paths[index + 1]; // 0番目は背景
                if (renderPath) {
                    renderPath.attr('stroke', color);
                    console.debug('[SVGGradientToolbar] stroke attribute successfully updated to:', color);
                }
            }
        }

        // 2. キャンバス上の一時的なハンドルUIの更新
        if (this.polylineHandlers) {
            const handler = this.polylineHandlers[index];
            if (handler && handler.handleGroup) {
                const handles = handler.handleGroup.querySelectorAll('.svg-grad-control-handle');
                handles.forEach(h => {
                    h.setAttribute('fill', color);
                });
            }
        }
    }

    // パス（色）の削除
    removePath(index) {
        if (!this.targetGroup) return;

        const metaGroup = this.targetGroup.findOne('.svg-gradient-meta');
        if (!metaGroup) return;

        const metaPaths = metaGroup.children();
        const pathEl = metaPaths[index];
        if (pathEl) {
            if (this.selectedPathId === pathEl.id()) {
                this.clearSelection();
            }
            pathEl.remove();
        }

        // 描画用パスの削除
        const clipGroup = this.targetGroup.findOne('[clip-path]');
        if (clipGroup) {
            const filterGroup = clipGroup.findOne('g');
            if (filterGroup) {
                const renderPath = filterGroup.children()[index + 1];
                if (renderPath) {
                    renderPath.remove();
                }
            }
        }

        // UIの再描画と同期
        this.renderControlHandles();
        this.syncIndicatorsFromMeta();

        if (window.syncChanges) window.syncChanges();
    }

    // メタデータから描画パスへ色と太さと形状を復元同期するヘルパー
    restoreColorsFromMeta(group) {
        if (!group) return;
        const metaGroup = group.findOne('.svg-gradient-meta');
        const clipGroup = group.findOne('[clip-path]');
        if (!metaGroup || !clipGroup) return;

        const filterGroup = clipGroup.findOne('g');
        if (!filterGroup) return;

        const renderPaths = filterGroup.children(); // 0番目は背景矩形
        metaGroup.children().forEach((pathEl, idx) => {
            const color = pathEl.attr('data-color') || '#ff0000';
            const thickness = pathEl.attr('data-thickness') || 30;
            const d = pathEl.attr('d');
            const renderPath = renderPaths[idx + 1];
            if (renderPath) {
                renderPath.attr({
                    'd': d,
                    'fill': 'none',
                    'stroke': color,
                    'stroke-width': thickness
                });
            }
        });
    }

    // 古い一重構造のグラデーショングループを自動的に新しい二重構造へ移行する
    migrateGradientGroup(group) {
        if (!group || group.attr('data-has-gradient') !== 'true') return group;

        const clipPathAttr = group.attr('clip-path');
        const filterAttr = group.attr('filter');

        // もし外側グループに clip-path と filter の両属性が設定されている場合 (古い一重構造)
        if (clipPathAttr && filterAttr) {
            const clipId = clipPathAttr.replace(/url\(#([^)]+)\)/, '$1');
            const filterId = filterAttr.replace(/url\(#([^)]+)\)/, '$1');

            // 1. 親グループから属性を解除
            group.attr({
                'clip-path': null,
                'filter': null
            });

            // 2. クリップ用グループとフィルター用グループを二重で作成
            const clipGroup = group.group();
            clipGroup.attr('clip-path', `url(#${clipId})`);

            const filterGroup = clipGroup.group();
            filterGroup.attr('filter', `url(#${filterId})`);

            // 3. メタデータや defs を除く描画要素を filterGroup へ移動
            const childrenToMove = [];
            group.children().forEach(child => {
                if (child === clipGroup) return;
                const tagName = child.node.tagName.toLowerCase();
                if (tagName === 'defs' || 
                    child.hasClass('svg-gradient-meta') || 
                    child.hasClass('svg-gradient-stroke')) return;
                childrenToMove.push(child);
            });

            childrenToMove.forEach(child => {
                filterGroup.add(child);
            });
        }

        // すでに二重構造になっている場合も、clip-path 内の要素が fill="none" になっていないかチェック・修復
        const clipGroup = group.findOne('[clip-path]');
        if (clipGroup) {
            const clipPathAttr2 = clipGroup.attr('clip-path');
            if (clipPathAttr2) {
                const clipId = clipPathAttr2.replace(/url\(#([^)]+)\)/, '$1');
                const svgNode = group.node.ownerSVGElement;
                const defsNode = svgNode ? svgNode.querySelector('defs') : null;
                if (defsNode) {
                    const clipPathEl = defsNode.querySelector(`#${clipId}`);
                    if (clipPathEl) {
                        Array.from(clipPathEl.children).forEach(child => {
                            if (child.getAttribute('fill') === 'none') {
                                child.setAttribute('fill', '#ffffff');
                            }
                        });
                    }
                }
            }
        }

        // メタデータから色情報を復元
        this.restoreColorsFromMeta(group);

        return group;
    }

    // 外部（選択時など）からインジケータを同期するためのメソッド
    updateFromSelection() {
        if (this._isConverting) return;
        if (!window.currentEditingSVG) return;
        const selected = Array.from(window.currentEditingSVG.selectedElements || []);
        if (selected.length === 0) {
            if (this.isEditing) {
                this.toggleEditMode(); // 選択解除されたら編集モード終了
            }
            this.targetGroup = null;
            if (this.colorIndicatorsContainer) this.colorIndicatorsContainer.innerHTML = '';
            return;
        }

        const shape = selected[0];
        if (shape.attr('data-has-gradient') === 'true') {
            this.targetGroup = this.migrateGradientGroup(shape);
            this.restoreColorsFromMeta(this.targetGroup);
            this.syncIndicatorsFromMeta();
        } else {
            if (this.isEditing) {
                // グラデーション編集モード中に別の非グラデーション図形を選択した場合、
                // モードを解除するか、あるいはその図形をグラデーション化するか？
                // 通常は別の図形が選択されたら、一度編集モードをOFFにするのが安全。
                this.toggleEditMode();
            }
            this.targetGroup = null;
            if (this.colorIndicatorsContainer) this.colorIndicatorsContainer.innerHTML = '';
        }
    }

    show() { if (this.toolbarElement) this.toolbarElement.style.display = 'flex'; }
    hide() { if (this.toolbarElement) this.toolbarElement.style.display = 'none'; }

    destroy() {
        if (this.isEditing) {
            this.toggleEditMode();
        }
        if (this.toolbarElement) this.toolbarElement.remove();
    }
}

// グローバルファクトリ
window.createGradientToolbar = (container, svgToolbar, options) => {
    return new SVGGradientToolbar(container, svgToolbar, options);
};
