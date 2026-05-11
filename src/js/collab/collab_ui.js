/**
 * CollabUI - 共同編集機能の UI ロジック
 *
 * 依存:
 *   - CollabManager (collab_core.js)
 *   - AppState, showToast (globals.js)
 */

const CollabUI = (() => {
    // ランダムなユーザーカラーパレット
    const USER_COLORS = [
        '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
        '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
        '#e91e63', '#00bcd4', '#8bc34a', '#ff5722',
    ];

    /**
     * ランダムなカラーを返す
     * @returns {string}
     */
    function getRandomColor() {
        return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
    }

    /**
     * localStorage からユーザー設定を読み込む
     * @returns {{name: string, color: string}}
     */
    function loadUserPreferences() {
        try {
            return {
                name: localStorage.getItem('collab_userName') || `ユーザー${Math.floor(Math.random() * 1000)}`,
                color: localStorage.getItem('collab_userColor') || getRandomColor(),
            };
        } catch {
            return { name: 'ゲスト', color: getRandomColor() };
        }
    }

    /**
     * ユーザー設定を localStorage に保存する
     * @param {string} name
     * @param {string} color
     */
    function saveUserPreferences(name, color) {
        try {
            localStorage.setItem('collab_userName', name);
            localStorage.setItem('collab_userColor', color);
        } catch {}
    }

    /**
     * 共同編集ダイアログを開く
     */
    function openDialog() {
        const dialog = document.getElementById('dialog-collab');
        if (!dialog) return;

        const prefs = loadUserPreferences();

        // 現在の設定を反映
        const nameInput = document.getElementById('collab-user-name');
        const colorInput = document.getElementById('collab-user-color');
        const roomInput = document.getElementById('collab-room-name');
        const statusEl = document.getElementById('collab-status');

        if (nameInput) nameInput.value = prefs.name;
        if (colorInput) colorInput.value = prefs.color;
        if (roomInput) roomInput.value = AppState.collab?.roomName || '';

        // 接続中かどうかで表示を切り替え
        if (statusEl) {
            if (CollabManager.isActive()) {
                statusEl.textContent = `接続中: ルーム「${AppState.collab.roomName}」`;
                statusEl.className = 'collab-status collab-status--connected';
            } else {
                statusEl.textContent = '未接続';
                statusEl.className = 'collab-status collab-status--disconnected';
            }
        }

        // 接続状態でボタンの表示を切り替える
        const joinBtn = document.getElementById('btn-collab-join');
        const leaveBtn = document.getElementById('btn-collab-leave');
        if (joinBtn) joinBtn.style.display = CollabManager.isActive() ? 'none' : '';
        if (leaveBtn) leaveBtn.style.display = CollabManager.isActive() ? '' : 'none';

        dialog.showModal();
    }

    /**
     * 共同編集ダイアログを閉じる
     */
    function closeDialog() {
        const dialog = document.getElementById('dialog-collab');
        if (dialog) dialog.close();
    }

    /**
     * ツールバーの共同編集ボタンの状態を更新する
     */
    function updateButtonState() {
        const btn = document.getElementById('btn-collab');
        if (!btn) return;

        if (CollabManager.isActive()) {
            btn.classList.add('collab-active');
            btn.title = `共同編集中 (${CollabManager.getConnectedUsers().length + 1}人接続)`;
        } else {
            btn.classList.remove('collab-active');
            btn.title = '共同編集';
        }
    }

    /**
     * 接続ユーザー一覧を UI に反映する
     * @param {Array<{clientId: number, name: string, color: string}>} users
     */
    function updateUserList(users) {
        updateButtonState();

        // ユーザーバッジエリアを更新
        const badgeArea = document.getElementById('collab-user-badges');
        if (!badgeArea) return;

        // 自分を先頭に追加
        const allUsers = [
            {
                clientId: -1,
                name: AppState.collab?.userName || '自分',
                color: AppState.collab?.userColor || '#888',
                isSelf: true,
            },
            ...users.map(u => ({ ...u, isSelf: false })),
        ];

        badgeArea.innerHTML = allUsers.map(u => `
            <span class="user-badge" style="background-color: ${u.color};" title="${u.name}">
                ${u.name.charAt(0).toUpperCase()}
                ${u.isSelf ? '<span class="user-badge__self-marker">✓</span>' : ''}
            </span>
        `).join('');

        // ダイアログのユーザーリストも更新
        const listEl = document.getElementById('collab-connected-users');
        if (listEl) {
            listEl.innerHTML = allUsers.map(u => `
                <li class="collab-user-item">
                    <span class="collab-user-dot" style="background-color: ${u.color};"></span>
                    <span class="collab-user-name">${u.name}${u.isSelf ? ' (自分)' : ''}</span>
                </li>
            `).join('');
        }
    }

    /**
     * 接続状態の表示を更新する
     * @param {string} status 'connected' | 'disconnected'
     */
    function updateStatus(status) {
        const statusEl = document.getElementById('collab-status');
        if (!statusEl) return;

        if (status === 'connected') {
            statusEl.textContent = `接続中: ルーム「${AppState.collab?.roomName || ''}」`;
            statusEl.className = 'collab-status collab-status--connected';
        } else {
            statusEl.textContent = '接続を確立中...';
            statusEl.className = 'collab-status collab-status--connecting';
        }

        updateButtonState();
    }

    /**
     * イベントハンドラをバインドする
     * app.js の init() から呼ぶ
     */
    function bindEvents() {
        // 共同編集ボタン
        const btn = document.getElementById('btn-collab');
        if (btn) {
            btn.addEventListener('click', openDialog);
        }

        // ダイアログ: 接続ボタン
        const joinBtn = document.getElementById('btn-collab-join');
        if (joinBtn) {
            joinBtn.addEventListener('click', handleJoin);
        }

        // ダイアログ: 切断ボタン
        const leaveBtn = document.getElementById('btn-collab-leave');
        if (leaveBtn) {
            leaveBtn.addEventListener('click', handleLeave);
        }

        // ダイアログ: 閉じるボタン
        const closeBtn = document.getElementById('btn-collab-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeDialog);
        }

        // ダイアログ: backdrop クリックで閉じる
        const dialog = document.getElementById('dialog-collab');
        if (dialog) {
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) closeDialog();
            });
        }

        // カラーピッカーのプレビュー更新
        const colorInput = document.getElementById('collab-user-color');
        if (colorInput) {
            colorInput.addEventListener('input', () => {
                const nameInput = document.getElementById('collab-user-name');
                const preview = document.getElementById('collab-color-preview');
                if (preview) {
                    preview.style.backgroundColor = colorInput.value;
                }
            });
        }
    }

    /**
     * 「参加」ボタンのハンドラ
     */
    function handleJoin() {
        const roomInput = document.getElementById('collab-room-name');
        const nameInput = document.getElementById('collab-user-name');
        const colorInput = document.getElementById('collab-user-color');

        const roomName = roomInput?.value.trim();
        const userName = nameInput?.value.trim() || `ユーザー${Math.floor(Math.random() * 1000)}`;
        const userColor = colorInput?.value || getRandomColor();

        if (!roomName) {
            if (typeof showToast === 'function') {
                showToast('ルーム名を入力してください', 'error');
            }
            return;
        }

        // すでに接続中の場合は一度切断
        if (CollabManager.isActive()) {
            CollabManager.stop();
        }

        // ユーザー設定を保存
        saveUserPreferences(userName, userColor);

        // セッション開始
        CollabManager.start(roomName, userName, userColor);

        // UI 更新
        updateButtonState();
        closeDialog();
    }

    /**
     * 「切断」ボタンのハンドラ
     */
    function handleLeave() {
        if (!CollabManager.isActive()) return;

        CollabManager.stop();
        updateButtonState();

        // ユーザーバッジをクリア
        const badgeArea = document.getElementById('collab-user-badges');
        if (badgeArea) badgeArea.innerHTML = '';

        closeDialog();
    }

    return {
        openDialog,
        closeDialog,
        bindEvents,
        updateUserList,
        updateStatus,
        updateButtonState,
    };
})();

// グローバルに公開
window.CollabUI = CollabUI;
