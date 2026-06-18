/**
 * AnnotationCommentPanel - 吹き出し注釈のコメントパネル
 *
 * 右サイドパネルに吹き出し（bubble）図形の一覧を表示し、
 * 未読/既読・未対応/対応済みのステータス管理とコメント入力を提供する。
 */
window.AnnotationCommentPanel = (function () {

    const PANEL_ID   = 'comment-panel';
    const CONTENT_ID = 'comment-panel-content';

    let _panel   = null;
    let _content = null;

    // --- 初期化 ---

    function init() {
        _panel   = document.getElementById(PANEL_ID);
        _content = document.getElementById(CONTENT_ID);
        if (!_panel || !_content) {
            console.warn('[AnnotationCommentPanel] パネル要素が見つかりません。');
            return;
        }

        console.log('[AnnotationCommentPanel] 初期化完了');
    }

    // --- パネルのトグル ---

    function toggle() {
        if (!_panel) init();
        if (!_panel) return;

        const isVisible = _panel.classList.contains('visible');
        if (isVisible) {
            _hide();
        } else {
            _show();
        }
    }

    function _show() {
        // SVG一覧パネルと排他
        const svgListPanel = document.getElementById('svg-list-panel');
        if (svgListPanel && svgListPanel.classList.contains('visible')) {
            svgListPanel.classList.remove('visible');
            document.body.classList.remove('svg-list-visible');
        }

        _panel.classList.add('visible');
        document.body.classList.add('comment-panel-visible');
        refresh();
    }

    function _hide() {
        _panel.classList.remove('visible');
        document.body.classList.remove('comment-panel-visible');
    }

    // --- パネル内容の再構築 ---

    function refresh() {
        if (!_panel || !_panel.classList.contains('visible')) return;
        if (typeof window.AnnotationLayer === 'undefined') return;

        const bubbles = window.AnnotationLayer.getBubbleList();
        _buildContent(bubbles);
    }

    function _buildContent(bubbles) {
        if (!_content) return;
        _content.innerHTML = '';

        // --- サマリー更新 ---
        const unreadCount  = bubbles.filter(b => b.readStatus   === 'unread').length;
        const pendingCount = bubbles.filter(b => b.actionStatus === 'pending').length;
        const unreadEl  = document.getElementById('comment-unread-count');
        const pendingEl = document.getElementById('comment-pending-count');
        if (unreadEl)  unreadEl.textContent  = `未読 ${unreadCount}件`;
        if (pendingEl) pendingEl.textContent  = `未対応 ${pendingCount}件`;

        if (bubbles.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'comment-empty';
            empty.textContent = '吹き出し注釈がありません';
            _content.appendChild(empty);
            return;
        }

        bubbles.forEach((bubble, idx) => {
            const item = _buildItem(bubble, idx + 1);
            _content.appendChild(item);
        });
    }

    function _buildItem(bubble, index) {
        const item = document.createElement('div');
        item.className = 'comment-item';
        item.dataset.shapeId = bubble.id;

        // --- ヘッダー行 ---
        const header = document.createElement('div');
        header.className = 'comment-item-header';

        // ラベル（クリックでジャンプ）
        const label = document.createElement('span');
        label.className = 'comment-label';
        
        let innerText = '';
        if (bubble.shapeEl && bubble.shapeEl.node) {
            let targetNode = bubble.shapeEl.node;
            if (targetNode.parentNode && targetNode.parentNode.tagName.toLowerCase() === 'g') {
                if (!targetNode.parentNode.hasAttribute('data-status-icon')) {
                    targetNode = targetNode.parentNode;
                }
            }
            const texts = targetNode.querySelectorAll ? targetNode.querySelectorAll('text, tspan') : [];
            if (texts && texts.length > 0) {
                let t = [];
                texts.forEach(txt => {
                    // ステータスアイコン内のテキストは除外
                    if (txt.closest && txt.closest('[data-status-icon="true"]')) return;
                    const textVal = (txt.textContent || '').trim();
                    if (textVal) {
                        t.push(textVal);
                    }
                });
                innerText = t.join(' ').replace(/\s+/g, ' ').trim();
            } else {
                // Do not fallback to targetNode.textContent to prevent extracting UI strings
                innerText = '';
            }
        }
        
        if (innerText) {
            if (innerText.length > 15) {
                innerText = innerText.substring(0, 15) + '...';
            }
            label.textContent = `💬 ${innerText}`;
        } else {
            label.textContent = `💬 吹き出し ${index}`;
        }
        
        label.title = 'クリックして移動';
        label.addEventListener('click', () => _jumpToShape(bubble));
        header.appendChild(label);

        // ステータスボタン群
        const statusBtns = document.createElement('div');
        statusBtns.className = 'comment-status-btns';

        // 既読ボタン
        const readBtn = document.createElement('button');
        readBtn.className = 'btn-status btn-read-status';
        readBtn.title = bubble.readStatus === 'read' ? '既読（クリックで未読に戻す）' : '未読（クリックで既読にする）';
        readBtn.innerHTML = bubble.readStatus === 'read'
            ? '<span style="color:#888">⭕</span>'
            : '<span style="color:#e74c3c">🔴</span>';
        readBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newStatus = bubble.readStatus === 'read' ? 'unread' : 'read';
            bubble.readStatus = newStatus;
            window.AnnotationLayer.setReadStatus(bubble.id, newStatus);
            refresh();
        });

        // 対応ステータスボタン
        const actionBtn = document.createElement('button');
        actionBtn.className = 'btn-status btn-action-status';
        actionBtn.title = bubble.actionStatus === 'done' ? '対応済（クリックで未対応に戻す）' : '未対応（クリックで対応済にする）';
        actionBtn.innerHTML = bubble.actionStatus === 'done'
            ? '<span>✅</span>'
            : '<span style="color:#e67e22">⚠️</span>';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newStatus = bubble.actionStatus === 'done' ? 'pending' : 'done';
            bubble.actionStatus = newStatus;
            window.AnnotationLayer.setActionStatus(bubble.id, newStatus);
            refresh();
        });

        statusBtns.appendChild(readBtn);
        statusBtns.appendChild(actionBtn);
        header.appendChild(statusBtns);
        item.appendChild(header);

        // --- アンカーテキストプレビュー ---
        if (bubble.paragraphText) {
            const preview = document.createElement('div');
            preview.className = 'comment-anchor-preview';
            preview.textContent = bubble.paragraphText.slice(0, 40) + (bubble.paragraphText.length > 40 ? '…' : '');
            item.appendChild(preview);
        }

        // --- コメント折り畳み ---
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'comment-toggle-btn';
        toggleBtn.textContent = bubble.comment ? '▼ コメントを表示' : '▼ コメントを追加';
        item.appendChild(toggleBtn);

        const body = document.createElement('div');
        body.className = 'comment-body collapsed';

        const textarea = document.createElement('textarea');
        textarea.className = 'comment-textarea';
        textarea.placeholder = 'コメントを入力...';
        textarea.value = bubble.comment || '';
        textarea.rows = 3;

        // デバウンスして保存
        let saveTimer = null;
        textarea.addEventListener('input', () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                window.AnnotationLayer.setComment(bubble.id, textarea.value);
                // ラベル更新
                toggleBtn.textContent = textarea.value ? '▼ コメントを表示' : '▼ コメントを追加';
            }, 500);
        });

        body.appendChild(textarea);
        item.appendChild(body);

        // 折り畳みトグル
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = body.classList.contains('collapsed');
            body.classList.toggle('collapsed', !isCollapsed);
            toggleBtn.textContent = isCollapsed
                ? (textarea.value ? '▲ コメントを閉じる' : '▲ コメントを閉じる')
                : (textarea.value ? '▼ コメントを表示' : '▼ コメントを追加');
            if (isCollapsed) textarea.focus();
        });

        return item;
    }

    // --- ジャンプ ---

    function _jumpToShape(bubble) {
        if (!bubble.shapeEl) return;

        // プレビューペインをスクロール
        const previewPane = document.getElementById('preview-pane');
        const svgEl = document.getElementById('annotation-svg-layer');
        if (!previewPane || !svgEl) return;

        try {
            const bbox = bubble.shapeEl.bbox();
            const currentTransform = bubble.shapeEl.node.getAttribute('transform') || '';
            let ty = 0;
            const trMatch = currentTransform.match(/translate\s*\(\s*[+-]?[\d.]+(?:\s*,\s*([+-]?[\d.]+))?\s*\)/);
            if (trMatch) {
                ty = parseFloat(trMatch[1]) || 0;
            } else {
                const matMatch = currentTransform.match(/matrix\s*\(\s*[+-]?[\d.]+\s*,\s*[+-]?[\d.]+\s*,\s*[+-]?[\d.]+\s*,\s*[+-]?[\d.]+\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*\)/);
                if (matMatch) {
                    ty = parseFloat(matMatch[2]) || 0; // matrixの6番目の値(インデックス2)がty
                }
            }

            const svgRect     = svgEl.getBoundingClientRect();
            const paneRect    = previewPane.getBoundingClientRect();
            const shapeTopAbs = svgRect.top + bbox.y + ty;
            const targetScroll = previewPane.scrollTop + (shapeTopAbs - paneRect.top) - 80;

            previewPane.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });

            // ハイライト（一時的な選択）
            if (typeof window.selectElement === 'function') {
                window.selectElement(bubble.shapeEl);
                setTimeout(() => {
                    if (typeof window.deselectAll === 'function') window.deselectAll();
                }, 1500);
            }
        } catch (e) {
            console.warn('[AnnotationCommentPanel] ジャンプ失敗:', e);
        }
    }

    // --- 公開API ---

    return { init, toggle, refresh };

})();

// DOMContentLoaded で初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.AnnotationCommentPanel.init());
} else {
    window.AnnotationCommentPanel.init();
}
