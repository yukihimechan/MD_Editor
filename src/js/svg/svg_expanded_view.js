/**
 * SVGエディタ拡大画面表示機能
 * - モーダルダイアログでSVGエディタを全画面表示
 * - ウィンドウリサイズに対応して拡大率を自動調整
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
        escapeHandler: null
    };

    // SVGコンテナをダイアログ内に移動
    contentWrapper.appendChild(svgContainer);
    dialog.appendChild(contentWrapper);
    dialog.appendChild(closeBtn);
    document.body.appendChild(dialog);
    document.body.classList.add('svg-expanded-active');

    // 画面に表示 (CSSのfixedにより全画面表示される)


    // 初回の拡大率を計算・適用
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

    // [NEW] 拡大表示中は完了/拡大ボタンを非表示にするため位置更新関数を呼ぶ
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

    const { originalParent, originalNextSibling, resizeHandler, escapeHandler } = window.currentEditingSVG.expandedViewData;

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

    // ダイアログの利用可能なサイズを取得（閉じるボタン分を除く）
    const dialogRect = dialog.getBoundingClientRect();
    const closeBtnHeight = 50; // 閉じるボタンの高さ + 余白
    const padding = 40; // 余白

    const availableWidth = dialogRect.width - padding * 2;
    const availableHeight = dialogRect.height - closeBtnHeight - padding * 2;

    // SVG要素の元のサイズを取得
    const vb = svgElement.viewBox.baseVal;
    let svgWidth = vb.width;
    let svgHeight = vb.height;

    if (svgWidth === 0 || svgHeight === 0) {
        svgWidth = parseFloat(svgElement.getAttribute('width')) || 600;
        svgHeight = parseFloat(svgElement.getAttribute('height')) || 400;
    }

    // 拡大率を計算（アスペクト比を維持）
    const scaleX = availableWidth / svgWidth;
    const scaleY = availableHeight / svgHeight;
    const scale = Math.min(scaleX, scaleY, 3); // 最大3倍まで

    // スケールを適用
    svgContainer.style.transform = `scale(${scale})`;
    svgContainer.style.transformOrigin = 'center center';

    console.log(`[SVG Expand] Scale updated: ${scale.toFixed(2)}x (SVG: ${svgWidth}x${svgHeight}, Available: ${availableWidth}x${availableHeight})`);
}
window.updateExpandedViewScale = updateExpandedViewScale;
