/**
 * CollabUI - 共同編集機能の UI ロジック
 *
 * 依存:
 *   - CollabManager (collab_core.js)
 *   - AppState, showToast (globals.js)
 */

var t = t || ((key, params) => typeof I18n !== 'undefined' ? I18n.translate(key, params) : key);

const CollabUI = (() => {
    // ランダムなユーザーカラーパレット
    const USER_COLORS = [
        '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
        '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
        '#e91e63', '#00bcd4', '#8bc34a', '#ff5722',
    ];

    let colorPickerInst = null;
    let isReconnectingFromScan = false;
    let lockTimeoutTimer = null;

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
                name: localStorage.getItem('collab_userName') || `${t('collab.defaultUserName') || 'ユーザー'}${Math.floor(Math.random() * 1000)}`,
                color: localStorage.getItem('collab_userColor') || getRandomColor(),
            };
        } catch {
            return { name: t('collab.guest') || 'ゲスト', color: getRandomColor() };
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
     * XSS対策用のHTMLエスケープ関数
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        if (str == null || str === '') return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
        if (roomInput) roomInput.value = AppState.collab?.roomName || '';
        
        if (colorInput) colorInput.value = prefs.color;
        const previewEl = document.getElementById('collab-color-preview');
        if (previewEl) previewEl.style.backgroundColor = prefs.color;

        // ColorPickerUI の表示色も同期する
        if (colorPickerInst && colorPickerInst.color && typeof colorPickerInst.color.parse === 'function') {
            colorPickerInst.color.parse(prefs.color);
            if (typeof colorPickerInst.updateView === 'function') colorPickerInst.updateView(true);
        }

        // 接続中かどうかで表示を切り替え
        if (statusEl) {
            if (CollabManager.isActive()) {
                statusEl.textContent = t('collab.status.connectedRoom', { roomName: AppState.collab.roomName }) || `接続中: ルーム「${AppState.collab.roomName}」`;
                statusEl.className = 'collab-status collab-status--connected';
            } else {
                statusEl.textContent = t('collab.status.disconnected') || '未接続';
                statusEl.className = 'collab-status collab-status--disconnected';
            }
        }

        // 接続状態でボタンの表示を切り替える
        const joinBtn = document.getElementById('btn-collab-join');
        const leaveBtn = document.getElementById('btn-collab-leave');
        if (joinBtn) joinBtn.style.display = CollabManager.isActive() ? 'none' : '';
        if (leaveBtn) leaveBtn.style.display = CollabManager.isActive() ? '' : 'none';
        updateShareButtonState();

        if (!dialog.open) {
            dialog.showModal();
        }
    }

    /**
     * 共同編集ダイアログを閉じる
     */
    function closeDialog() {
        const dialog = document.getElementById('dialog-collab');
        if (dialog) dialog.close();
    }

    /**
     * エディタを一時的にロックし、同期中インジケータを表示する
     * @param {string} senderName 同期を実行しているユーザー名
     * @param {number} progress 進捗状況 (0-100)
     */
    function lockEditor(senderName, progress = 0) {
        let overlay = document.getElementById('collab-lock-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'collab-lock-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                zIndex: '99999',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontFamily: 'sans-serif',
                backdropFilter: 'blur(3px)',
                transition: 'opacity 0.2s ease-in-out'
            });

            const content = document.createElement('div');
            content.className = 'collab-lock-content';
            Object.assign(content.style, {
                backgroundColor: 'var(--header-bg, #2d3748)',
                padding: '24px 32px',
                borderRadius: '8px',
                border: '1px solid var(--border, #4a5568)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                textAlign: 'center',
                maxWidth: '400px',
                width: '90%'
            });

            const title = document.createElement('div');
            title.id = 'collab-lock-title';
            title.style.fontWeight = 'bold';
            title.style.fontSize = '16px';
            title.style.marginBottom = '16px';
            content.appendChild(title);

            const barOuter = document.createElement('div');
            Object.assign(barOuter.style, {
                width: '100%',
                height: '8px',
                backgroundColor: '#4a5568',
                borderRadius: '4px',
                overflow: 'hidden',
                marginBottom: '8px'
            });
            const barInner = document.createElement('div');
            barInner.id = 'collab-lock-progress-bar';
            Object.assign(barInner.style, {
                width: '0%',
                height: '100%',
                backgroundColor: 'var(--primary, #3182ce)',
                transition: 'width 0.1s ease-out'
            });
            barOuter.appendChild(barInner);
            content.appendChild(barOuter);

            const percent = document.createElement('div');
            percent.id = 'collab-lock-percent';
            percent.style.fontSize = '12px';
            percent.style.color = '#cbd5e0';
            content.appendChild(percent);

            overlay.appendChild(content);
            document.body.appendChild(overlay);
        }

        const titleEl = document.getElementById('collab-lock-title');
        const barInnerEl = document.getElementById('collab-lock-progress-bar');
        const percentEl = document.getElementById('collab-lock-percent');

        if (titleEl) titleEl.textContent = t('collab.editorLock.title', { senderName }) || `${senderName} さんが大容量ファイルを同期中です...`;
        if (barInnerEl) barInnerEl.style.width = `${progress}%`;
        if (percentEl) percentEl.textContent = t('collab.editorLock.progress', { progress: Math.round(progress) }) || `同期中: ${Math.round(progress)}%`;

        if (typeof window.setEditorReadOnly === 'function') {
            window.setEditorReadOnly(true);
        }

        clearTimeout(lockTimeoutTimer);
        lockTimeoutTimer = setTimeout(() => {
            console.warn('[CollabUI] 同期ロックがタイムアウトしたため、強制解除します。');
            unlockEditor();
        }, 10000);
    }

    /**
     * エディタのロックを解除する
     */
    function unlockEditor() {
        clearTimeout(lockTimeoutTimer);
        lockTimeoutTimer = null;

        const overlay = document.getElementById('collab-lock-overlay');
        if (overlay) {
            overlay.remove();
        }

        if (typeof window.setEditorReadOnly === 'function') {
            window.setEditorReadOnly(false);
        }
    }

    /**
     * ツールバーの共同編集ボタンの状態を更新する
     */
    function updateButtonState() {
        const btn = document.getElementById('btn-collab');
        if (!btn) return;

        if (CollabManager.isActive()) {
            btn.classList.add('collab-active');
            btn.title = t('toolbar.collabActiveTitle', { count: CollabManager.getConnectedUsers().length + 1 }) || `共同編集中 (${CollabManager.getConnectedUsers().length + 1}人接続)`;
        } else {
            btn.classList.remove('collab-active');
            btn.title = t('toolbar.collabTitle') || '共同編集';
        }
    }

    /**
     * 接続ユーザー一覧を UI に反映する
     * @param {Array<{clientId: number, name: string, color: string}>} users
     */
    function updateUserList(users) {
        updateButtonState();
        updateShareButtonState();

        // ユーザーバッジエリアを更新
        const badgeArea = document.getElementById('collab-user-badges');
        if (!badgeArea) return;

        // 未接続状態ならリストを完全に空にして終了する
        if (typeof CollabManager !== 'undefined' && !CollabManager.isActive()) {
            badgeArea.innerHTML = '';
            const listEl = document.getElementById('collab-connected-users');
            if (listEl) listEl.innerHTML = '';
            return;
        }

        // 自分を先頭に追加
        const allUsers = [
            {
                clientId: -1,
                name: AppState.collab?.userName || t('collab.self') || '自分',
                color: AppState.collab?.userColor || '#888',
                isSelf: true,
            },
            ...users.map(u => ({ ...u, isSelf: false })),
        ];

        badgeArea.innerHTML = allUsers.map(u => {
            const initialChar = Array.from(String(u.name || ''))[0] || '?';
            const initialCharEscaped = escapeHtml(initialChar.toUpperCase());
            const safeColor = /^#[0-9A-Fa-f]{3,8}$/i.test(u.color) ? u.color : '#888888';
            return `
                <span class="user-badge" style="background-color: ${safeColor};" title="${escapeHtml(u.name)}">
                    ${initialCharEscaped}
                    ${u.isSelf ? '<span class="user-badge__self-marker">✓</span>' : ''}
                </span>
            `;
        }).join('');

        // ダイアログのユーザーリストも更新
        const listEl = document.getElementById('collab-connected-users');
        if (listEl) {
            listEl.innerHTML = allUsers.map(u => {
                const safeColor = /^#[0-9A-Fa-f]{3,8}$/i.test(u.color) ? u.color : '#888888';
                return `
                    <li class="collab-user-item">
                        <span class="collab-user-dot" style="background-color: ${safeColor};"></span>
                        <span class="collab-user-name">${escapeHtml(u.name)}${u.isSelf ? ` (${t('collab.self') || '自分'})` : ''}</span>
                    </li>
                `;
            }).join('');
        }
    }

    /**
     * 接続状態の表示を更新する
     * @param {string} status 'connected' | 'waiting' | 'disconnected'
     */
    function updateStatus(status) {
        const statusEl = document.getElementById('collab-status');
        if (!statusEl) return;

        if (status === 'connected') {
            statusEl.textContent = t('collab.status.connectedRoom', { roomName: AppState.collab?.roomName || '' }) || `接続中: ルーム「${AppState.collab?.roomName || ''}」`;
            statusEl.className = 'collab-status collab-status--connected';
        } else if (status === 'waiting') {
            statusEl.textContent = t('collab.status.waitingRoom', { roomName: AppState.collab?.roomName || '' }) || `待機中: ルーム「${AppState.collab?.roomName || ''}」 (他のユーザーを待っています)`;
            statusEl.className = 'collab-status collab-status--waiting';
        } else if (status === 'disconnected') {
            statusEl.textContent = t('collab.status.offline') || '未接続 / オフライン';
            statusEl.className = 'collab-status collab-status--disconnected';
        } else {
            statusEl.textContent = t('collab.status.connecting') || '接続を確立中...';
            statusEl.className = 'collab-status collab-status--connecting';
        }

        updateButtonState();
        updateShareButtonState();
    }

    /**
     * ダイアログの外側（backdrop）クリック時のハンドラ
     * @param {MouseEvent} e
     */
    function handleDialogBackdropClick(e) {
        const dialog = document.getElementById('dialog-collab');
        if (dialog && e.target === dialog) {
            closeDialog();
        }
    }

    /**
     * カラープレビュークリック時のハンドラ
     * @param {MouseEvent} e
     */
    function handleColorPreviewClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const previewEl = document.getElementById('collab-color-preview');
        if (previewEl && colorPickerInst) {
            colorPickerInst.show(previewEl);
        }
    }

    /**
     * イベントハンドラをバインドする
     * app.js の init() から呼ぶ
     */
    function bindEvents() {
        // 共同編集ボタン
        const btn = document.getElementById('btn-collab');
        if (btn) {
            btn.removeEventListener('click', openDialog);
            btn.addEventListener('click', openDialog);
        }

        // ダイアログ: 共有ボタン
        const shareBtn = document.getElementById('btn-collab-share');
        if (shareBtn) {
            shareBtn.removeEventListener('click', handleShareText);
            shareBtn.addEventListener('click', handleShareText);
        }

        // ダイアログ: 接続ボタン
        const joinBtn = document.getElementById('btn-collab-join');
        if (joinBtn) {
            joinBtn.removeEventListener('click', handleJoin);
            joinBtn.addEventListener('click', handleJoin);
        }

        // ダイアログ: 切断ボタン
        const leaveBtn = document.getElementById('btn-collab-leave');
        if (leaveBtn) {
            leaveBtn.removeEventListener('click', handleLeave);
            leaveBtn.addEventListener('click', handleLeave);
        }

        // ダイアログ: 閉じるボタン
        const closeBtn = document.getElementById('btn-collab-close');
        if (closeBtn) {
            closeBtn.removeEventListener('click', closeDialog);
            closeBtn.addEventListener('click', closeDialog);
        }

        // ダイアログ: backdrop クリックで閉じる
        const dialog = document.getElementById('dialog-collab');
        if (dialog) {
            dialog.removeEventListener('click', handleDialogBackdropClick);
            dialog.addEventListener('click', handleDialogBackdropClick);
        }

        // 探索ダイアログ: キャンセルボタン
        const scanCancelBtn = document.getElementById('btn-collab-scan-cancel');
        if (scanCancelBtn) {
            scanCancelBtn.removeEventListener('click', closeScanDialog);
            scanCancelBtn.addEventListener('click', closeScanDialog);
        }

        // 探索ダイアログ: 再スキャンボタン
        const scanRetryBtn = document.getElementById('btn-collab-scan-retry');
        if (scanRetryBtn) {
            scanRetryBtn.removeEventListener('click', handleScanRetry);
            scanRetryBtn.addEventListener('click', handleScanRetry);
        }

        // 探索ダイアログ: backdrop クリックで閉じる
        const scanDialog = document.getElementById('dialog-collab-scan');
        if (scanDialog) {
            scanDialog.removeEventListener('click', handleScanDialogBackdropClick);
            scanDialog.addEventListener('click', handleScanDialogBackdropClick);
        }

        // Color-PickerUI の初期化
        const colorInput = document.getElementById('collab-user-color');
        const previewEl = document.getElementById('collab-color-preview');
        
        if (colorInput && previewEl && typeof ColorPickerUI !== 'undefined') {
            if (!colorPickerInst) {
                colorPickerInst = new ColorPickerUI({
                    color: colorInput.value || '#3498db',
                    isPopup: true,
                    layout: 'vertical',
                    appendTo: document.getElementById('dialog-collab'),
                    onChange: (color) => {
                        let colorStr = color;
                        if (typeof color.toHexString === 'function') {
                            colorStr = color.toHexString(true);
                        }
                        const currentInput = document.getElementById('collab-user-color');
                        const currentPreview = document.getElementById('collab-color-preview');
                        if (currentInput) currentInput.value = colorStr;
                        if (currentPreview) currentPreview.style.backgroundColor = colorStr;
                    }
                });
            }

            // クリックで表示
            previewEl.removeEventListener('click', handleColorPreviewClick);
            previewEl.addEventListener('click', handleColorPreviewClick);
        }
    }

    /**
     * ローカルのテキストをルームに共有するボタンのハンドラ
     */
    function handleShareText() {
        if (!CollabManager.isActive()) return;

        const success = CollabManager.pushLocalText();
        if (success) {
            if (typeof showToast === 'function') {
                showToast(t('collab.toast.sharedText') || '現在のテキストをルームに共有しました', 'success');
            }
            updateShareButtonState();
        } else {
            if (typeof showToast === 'function') {
                showToast(t('collab.toast.roomNotEmpty') || 'すでにルームにテキストが存在します', 'warning');
            }
        }
    }

    /**
     * 共有ボタンの表示/非表示を切り替える
     */
    function updateShareButtonState() {
        const shareBtn = document.getElementById('btn-collab-share');
        if (!shareBtn) return;

        if (CollabManager.isActive() && !CollabManager.isAttached() && CollabManager.isRoomEmpty()) {
            shareBtn.style.display = '';
        } else {
            shareBtn.style.display = 'none';
        }
    }

    /**
     * リモートテキストとの同期確認モーダルを表示する（非同期）
     * @returns {Promise<boolean>}
     */
    function showSyncConfirm() {
        return new Promise((resolve) => {
            const dialog = document.getElementById('dialog-collab-confirm');
            const okBtn = document.getElementById('btn-collab-confirm-ok');
            const cancelBtn = document.getElementById('btn-collab-confirm-cancel');
            
            if (!dialog || !okBtn || !cancelBtn) {
                // DOMが存在しない場合はフォールバックとして confirm を使用する
                resolve(!!window.confirm(t('collab.confirm.syncText') || 'ルーム内のテキストと同期しますか？\n同期すると、現在のローカルテキストは上書きされます。'));
                return;
            }

            const cleanup = () => {
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                dialog.removeEventListener('close', onCancel);
            };

            const onOk = () => {
                cleanup();
                if (dialog.open) dialog.close();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                if (dialog.open) dialog.close();
                resolve(false);
            };

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            dialog.addEventListener('close', onCancel);

            if (!dialog.open) {
                dialog.showModal();
            }
        });
    }

    /**
     * 「参加」ボタンのハンドラ
     */
    async function handleJoin() {
        const roomInput = document.getElementById('collab-room-name');
        const nameInput = document.getElementById('collab-user-name');
        const colorInput = document.getElementById('collab-user-color');
        const joinBtn = document.getElementById('btn-collab-join');

        const roomName = (roomInput?.value || '').trim();
        const userName = (nameInput?.value || '').trim() || `${t('collab.defaultUserName') || 'ユーザー'}${Math.floor(Math.random() * 1000)}`;
        const userColor = colorInput?.value || getRandomColor();

        if (!roomName) {
            if (typeof showToast === 'function') {
                showToast(t('collab.toast.inputRoomName') || 'ルーム名を入力してください', 'error');
            }
            return;
        }

        // ボタンの連打防止
        if (joinBtn) {
            joinBtn.disabled = true;
        }

        // ユーザー設定を保存
        saveUserPreferences(userName, userColor);

        try {
            // すでに接続中の場合は一度切断し、古い WebRTC インスタンスの非同期破棄(100ms遅延)の完了を待ってから開始する
            if (CollabManager.isActive()) {
                await CollabManager.stop();
            }
            // 新規または再接続を開始
            CollabManager.start(roomName, userName, userColor);
        } finally {
            if (joinBtn) joinBtn.disabled = false;
        }
        
        // UI 更新
        updateButtonState();
        closeDialog();
    }

    /**
     * 「切断」ボタンのハンドラ
     */
    async function handleLeave() {
        if (!CollabManager.isActive()) return;

        await CollabManager.stop();
        updateButtonState();

        // ユーザーバッジをクリア
        const badgeArea = document.getElementById('collab-user-badges');
        if (badgeArea) badgeArea.innerHTML = '';

        closeDialog();
    }

    let scanTargetInfo = null; // スキャン時に接続しようとしていたルーム名などを保持する

    /**
     * サーバー自動検出を開始する
     * @param {string} roomName
     * @param {string} userName
     * @param {string} userColor
     */
    function startServerScan(roomName, userName, userColor) {
        scanTargetInfo = { roomName, userName, userColor };
        isReconnectingFromScan = false; // フラグをリセット

        const dialog = document.getElementById('dialog-collab-scan');
        const messageEl = document.getElementById('collab-scan-message');
        const loaderEl = document.getElementById('collab-scan-loader');
        const resultsEl = document.getElementById('collab-scan-results');
        const retryBtn = document.getElementById('btn-collab-scan-retry');

        if (!dialog) return;

        // UIをスキャン中状態に初期化
        messageEl.textContent = t('collab.scan.searching') || '設定されたサーバーに接続できません。ローカルネットワーク上のサーバーを探索しています...';
        loaderEl.style.display = 'block';
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        retryBtn.style.display = 'none';

        if (!dialog.open) {
            dialog.showModal();
        }

        // Tauriコマンドの呼び出し
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            window.__TAURI__.core.invoke('discover_signaling_servers')
                .then((servers) => {
                    loaderEl.style.display = 'none';
                    retryBtn.style.display = 'block';

                    if (servers && servers.length > 0) {
                        messageEl.textContent = t('collab.scan.found') || '利用可能なシグナリングサーバーが見つかりました。接続先を選択してください：';
                        resultsEl.style.display = 'block';

                        resultsEl.innerHTML = servers.map(srv => {
                            const safeName = escapeHtml(srv.name);
                            const safeUrl = escapeHtml(srv.url);
                            return `
                                <li class="collab-scan-item" data-url="${safeUrl}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid #eee; cursor:pointer; transition:background-color 0.2s;">
                                    <span class="collab-scan-name" style="font-weight:600; font-size:13px; color:#333;">${safeName}</span>
                                    <span class="collab-scan-url" style="font-size:11px; color:#666; background:#f5f5f5; padding:2px 6px; border-radius:4px;">${safeUrl}</span>
                                </li>
                            `;
                        }).join('');

                        // リスト内の各アイテムのクリックイベントを設定
                        const items = resultsEl.querySelectorAll('.collab-scan-item');
                        items.forEach(item => {
                            item.addEventListener('click', () => {
                                const url = item.getAttribute('data-url');
                                const safeName = item.querySelector('.collab-scan-name')?.textContent || t('collab.scan.defaultServerName') || 'シグナリングサーバー';
                                
                                // ダイアログは閉じず、接続試行中の表示に切り替える
                                messageEl.textContent = t('collab.scan.connectingToServer', { name: safeName, url }) || `「${safeName}」(${url}) に接続を試みています...`;
                                loaderEl.style.display = 'block';
                                resultsEl.style.display = 'none';
                                retryBtn.style.display = 'none';
                                
                                isReconnectingFromScan = true;
                                reconnectToScannedServer(url);
                            });
                        });
                    } else {
                        messageEl.textContent = t('collab.scan.notFound') || '同一ネットワーク上に利用可能なシグナリングサーバーが見つかりませんでした。';
                    }
                })
                .catch((err) => {
                    console.error('[CollabUI] サーバー探索エラー:', err);
                    loaderEl.style.display = 'none';
                    retryBtn.style.display = 'block';
                    messageEl.textContent = t('collab.scan.error') || '探索中にエラーが発生しました。再試行してください。';
                });
        } else {
            loaderEl.style.display = 'none';
            messageEl.textContent = t('collab.scan.notSupported') || 'この環境ではサーバー探索機能を利用できません。';
        }
    }

    /**
     * 検出されたサーバーへ再接続する
     * @param {string} url
     */
    function reconnectToScannedServer(url) {
        if (!scanTargetInfo) return;
        const { roomName, userName, userColor } = scanTargetInfo;
        
        // 再接続を実行
        if (typeof CollabManager !== 'undefined' && typeof CollabManager.reconnectWithUrl === 'function') {
            CollabManager.reconnectWithUrl(url, roomName, userName, userColor);
        }
    }

    /**
     * スキャンダイアログを閉じる
     */
    function closeScanDialog() {
        isReconnectingFromScan = false;
        const dialog = document.getElementById('dialog-collab-scan');
        if (dialog) {
            dialog.close();
        }
        // 探索キャンセル時は接続も停止する
        if (typeof CollabManager !== 'undefined' && typeof CollabManager.stop === 'function') {
            CollabManager.stop();
        }
    }

    /**
     * 接続成功時のハンドラ（CollabManagerから呼ばれる）
     */
    function handleConnectionSuccess() {
        if (isReconnectingFromScan) {
            isReconnectingFromScan = false;
            const dialog = document.getElementById('dialog-collab-scan');
            if (dialog && dialog.open) {
                dialog.close();
            }
            if (typeof showToast === 'function') {
                showToast(t('collab.toast.connectSuccess') || 'シグナリングサーバーに正常に接続しました', 'success');
            }
        }
    }

    /**
     * 接続タイムアウト時のハンドラ（CollabManagerから呼ばれる）
     * @param {string} roomName
     * @param {string} userName
     * @param {string} userColor
     */
    function handleConnectionTimeout(roomName, userName, userColor) {
        if (isReconnectingFromScan) {
            isReconnectingFromScan = false;
            
            const messageEl = document.getElementById('collab-scan-message');
            const loaderEl = document.getElementById('collab-scan-loader');
            const retryBtn = document.getElementById('btn-collab-scan-retry');

            if (messageEl) {
                messageEl.textContent = t('collab.scan.connectFailed') || '接続に失敗しました。サーバーが停止しているか、ファイアウォール設定等のネットワーク設定を確認してください。';
            }
            if (loaderEl) loaderEl.style.display = 'none';
            if (retryBtn) retryBtn.style.display = 'block';
        } else {
            // 通常の初回接続失敗時は自動スキャンへ
            startServerScan(roomName, userName, userColor);
        }
    }

    function handleScanRetry() {
        if (scanTargetInfo) {
            const { roomName, userName, userColor } = scanTargetInfo;
            startServerScan(roomName, userName, userColor);
        }
    }

    function handleScanDialogBackdropClick(e) {
        const dialog = document.getElementById('dialog-collab-scan');
        if (dialog && e.target === dialog) {
            closeScanDialog();
        }
    }

    return {
        openDialog,
        closeDialog,
        bindEvents,
        updateUserList,
        updateStatus,
        updateButtonState,
        updateShareButtonState,
        showSyncConfirm,
        startServerScan,
        closeScanDialog,
        handleConnectionSuccess,
        handleConnectionTimeout,
        lockEditor,
        unlockEditor,
    };
})();

// グローバルに公開
window.CollabUI = CollabUI;
