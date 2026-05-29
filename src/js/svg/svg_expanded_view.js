/**
 * SVGエディタ拡大画面表示機能
 * - モーダルダイアログでSVGエディタを全画面表示
 * - ウィンドウ横幅いっぱいにフィットさせる（SVGリスト表示時はパネル幅を除く）
 * - ウィンドウリサイズ・SVGリストパネルの開閉に対応して拡大率を自動調整
 */

/**
 * SVGエディタを拡大画面で表示
 */
function showSVGExpandedView() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.container) {
        console.warn('[SVG Expand] No active SVG editor found');
        return;
    }

    // 既存のダイアログを削除
    const existingDialog = document.getElementById('svg-expanded-dialog');
    if (existingDialog) {
        existingDialog.remove();
    }

    // <div>要素としてモーダルレイヤーを作成
    const dialog = document.createElement('div');
    dialog.id = 'svg-expanded-dialog';
    dialog.className = 'svg-expanded-dialog';

    // 閉じるボタンを作成
    const closeBtn = document.createElement('button');
    closeBtn.className = 'svg-expanded-close-btn';
    closeBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.close') || '閉じる' : '閉じる';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeSVGExpandedView();
    };

    // SVGコンテナのラッパーを作成
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'svg-expanded-content';

    // SVGコンテナを一時保存して移動
    const svgContainer = window.currentEditingSVG.container;
    const originalParent = svgContainer.parentElement;
    const originalNextSibling = svgContainer.nextSibling;

    // 元の位置情報を保存
    window.currentEditingSVG.expandedViewData = {
        originalParent,
        originalNextSibling,
        resizeHandler: null,
        escapeHandler: null,
        mutationObserver: null
    };

    // SVGコンテナをダイアログ内に移動
    contentWrapper.appendChild(svgContainer);
    dialog.appendChild(contentWrapper);
    dialog.appendChild(closeBtn);
    document.body.appendChild(dialog);
    document.body.classList.add('svg-expanded-active');

    // スケールをリセットした状態でコンテナの自然サイズを記録する
    svgContainer.style.transform = '';
    svgContainer.style.transformOrigin = '';
    window.currentEditingSVG.expandedViewData.naturalWidth = svgContainer.offsetWidth;
    window.currentEditingSVG.expandedViewData.naturalHeight = svgContainer.offsetHeight;

    // --- 診断: ツールバーがコンテナ左外にどれだけはみ出しているか計測 ---
    {
        const cRect = svgContainer.getBoundingClientRect();
        let toolbarMinLeft = 0; // コンテナ左端(0)からの相対位置（負なら外にはみ出し）
        svgContainer.querySelectorAll('.svg-toolbar').forEach(tb => {
            const tbRect = tb.getBoundingClientRect();
            const rel = tbRect.left - cRect.left;
            if (rel < toolbarMinLeft) toolbarMinLeft = rel;
        });
        const fullVisualWidth = cRect.width + Math.abs(toolbarMinLeft);
        window.currentEditingSVG.expandedViewData.toolbarMinLeft = toolbarMinLeft;
        console.log(
            `[SVG Expand 診断] window.innerWidth: ${window.innerWidth}px` +
            ` / container.offsetWidth (naturalWidth): ${svgContainer.offsetWidth}px` +
            ` / container.getBCR.width: ${cRect.width.toFixed(0)}px` +
            ` / toolbarの左端オーバーフロー: ${toolbarMinLeft.toFixed(0)}px` +
            ` / フル視覚幅(枠+ドラッグアイコン): ${fullVisualWidth.toFixed(0)}px`
        );
    }

    // 初回のスケールを計算・適用
    updateExpandedViewScale();

    // ウィンドウリサイズ時の処理を登録
    const resizeHandler = () => {
        if (document.getElementById('svg-expanded-dialog')) {
            updateExpandedViewScale();
        }
    };
    window.currentEditingSVG.expandedViewData.resizeHandler = resizeHandler;
    window.addEventListener('resize', resizeHandler);

    // Escapeキーでも閉じる
    const escapeHandler = (e) => {
        if (e.key === 'Escape' && document.getElementById('svg-expanded-dialog')) {
            e.preventDefault();
            closeSVGExpandedView();
        }
    };
    window.currentEditingSVG.expandedViewData.escapeHandler = escapeHandler;
    dialog.addEventListener('keydown', escapeHandler);

    // SVGリストパネルのclassの変化を監視して自動でスケールを再計算
    const svgListPanel = document.getElementById('svg-list-panel');
    if (svgListPanel) {
        const mutationObserver = new MutationObserver(() => {
            if (document.getElementById('svg-expanded-dialog')) {
                updateExpandedViewScale();
            }
        });
        mutationObserver.observe(svgListPanel, { attributes: true, attributeFilter: ['class'] });
        window.currentEditingSVG.expandedViewData.mutationObserver = mutationObserver;
    }

    // 拡大表示中は完了/拡大ボタンを非表示にするため位置更新関数を呼ぶ
    if (typeof updateDoneButtonPosition === 'function') {
        updateDoneButtonPosition();
    }

    console.log('[SVG Expand] Expanded view displayed');
}
window.showSVGExpandedView = showSVGExpandedView;

/**
 * 拡大画面を閉じる
 */
function closeSVGExpandedView() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.expandedViewData) {
        return;
    }

    const dialog = document.getElementById('svg-expanded-dialog');
    if (!dialog) return;

    const { originalParent, originalNextSibling, resizeHandler, escapeHandler, mutationObserver } = window.currentEditingSVG.expandedViewData;

    // SVGコンテナを元の位置に戻す
    const svgContainer = window.currentEditingSVG.container;

    // スケールをリセット
    svgContainer.style.transform = '';
    svgContainer.style.transformOrigin = '';

    // 元の位置に挿入
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(svgContainer, originalNextSibling);
    } else {
        originalParent.appendChild(svgContainer);
    }

    // イベントリスナーを削除
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
    }
    if (escapeHandler) {
        dialog.removeEventListener('keydown', escapeHandler);
    }

    // MutationObserverを解除
    if (mutationObserver) {
        mutationObserver.disconnect();
    }

    // ダイアログ要素（div）を削除
    dialog.remove();
    document.body.classList.remove('svg-expanded-active');

    // データをクリア
    window.currentEditingSVG.expandedViewData = null;

    // ボタンの位置を更新
    if (typeof updateDoneButtonPosition === 'function') {
        updateDoneButtonPosition();
    }

    console.log('[SVG Expand] Expanded view closed');
}
window.closeSVGExpandedView = closeSVGExpandedView;

/**
 * 拡大画面のスケールを更新
 * - SVGをウィンドウ横幅いっぱいにフィットさせる
 * - SVGリストパネル表示中はそのパネル幅を除いた幅に収める
 */
function updateExpandedViewScale() {
    if (!window.currentEditingSVG || !window.currentEditingSVG.container) {
        return;
    }

    const dialog = document.getElementById('svg-expanded-dialog');
    if (!dialog) return;

    const svgContainer = window.currentEditingSVG.container;
    const svgElement = svgContainer.querySelector('svg');
    if (!svgElement) return;

    // SVGリストパネルが表示されているか確認
    const svgListPanel = document.getElementById('svg-list-panel');
    const svgListVisible = svgListPanel && svgListPanel.classList.contains('visible');
    const svgListWidth = svgListVisible
        ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-svg-list-width')) || 280)
        : 0;

    // 利用可能なサイズを計算（閉じるボタン分・余白を除く）
    const closeBtnHeight = 50; // 閉じるボタンの高さ + 余白
    const padding = 40;        // 余白

    // 横幅はウィンドウ幅からSVGリストパネル幅とパディングを引く
    const availableWidth = window.innerWidth - svgListWidth - padding * 2;
    const availableHeight = window.innerHeight - closeBtnHeight - padding * 2;

    // コンテナの自然サイズを取得（初回表示時に記録済み）
    // ツールバー等を含む .split-cell 全体の実寸を基準にスケールを計算する
    const expandedData = window.currentEditingSVG.expandedViewData;
    let naturalWidth = expandedData ? expandedData.naturalWidth : 0;
    let naturalHeight = expandedData ? expandedData.naturalHeight : 0;

    // 自然サイズが未記録の場合は一時的にスケールをリセットして計測する
    if (!naturalWidth || !naturalHeight) {
        svgContainer.style.transform = '';
        svgContainer.style.transformOrigin = '';
        naturalWidth = svgContainer.offsetWidth;
        naturalHeight = svgContainer.offsetHeight;
        if (expandedData) {
            expandedData.naturalWidth = naturalWidth;
            expandedData.naturalHeight = naturalHeight;
        }
    }

    if (!naturalWidth || !naturalHeight) return;

    // ツールバーのコンテナ外オーバーフロー量を取得（初回計測済み）
    // 正の値に変換: ツールバーが左に38pxはみ出している → toolbarOverflow = 38
    const toolbarOverflow = expandedData ? Math.abs(expandedData.toolbarMinLeft || 0) : 0;

    // フル視覚幅（SVGキャンバス + コンテナ左外のツールバー分）
    const fullVisualWidth = naturalWidth + toolbarOverflow;

    // フル視覚幅を基準にスケール計算（上限なし）
    const totalWidth = window.innerWidth - svgListWidth;
    const totalHeight = window.innerHeight;
    const scaleX = availableWidth / fullVisualWidth;
    const scaleY = availableHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    // スケール後の実寸
    const scaledFullWidth = fullVisualWidth * scale;
    const scaledHeight = naturalHeight * scale;

    // 視覚コンテンツ全体を画面中央に配置する
    // ・視覚的な左マージン = (totalWidth - scaledFullWidth) / 2
    // ・コンテナ自体はツールバーより右にあるため toolbarOverflow*scale だけ加算
    const visualLeftMargin = (totalWidth - scaledFullWidth) / 2;
    const tx = visualLeftMargin + toolbarOverflow * scale;
    const ty = (totalHeight - scaledHeight) / 2;

    svgContainer.style.transformOrigin = '0 0';
    svgContainer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

    console.log(
        `[SVG Expand] Scale: ${scale.toFixed(2)}x` +
        `, Translate: (${tx.toFixed(0)}, ${ty.toFixed(0)})` +
        `, FullVisualWidth: ${fullVisualWidth}(${naturalWidth}+${toolbarOverflow})` +
        `, ScaledFull: ${scaledFullWidth.toFixed(0)}x${scaledHeight.toFixed(0)}` +
        `, SVGList: ${svgListVisible ? svgListWidth + 'px' : 'hidden'}`
    );
}
window.updateExpandedViewScale = updateExpandedViewScale;
