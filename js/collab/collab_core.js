/**
 * CollabManager - CRDT（Yjs）+ WebRTC による共同編集コアモジュール
 *
 * 依存:
 *   - window.YjsBundle  (src/lib/yjs/yjs.bundle.js)
 *   - window.YjsBundle.yCollab (src/lib/yjs/y-codemirror.bundle.js)
 *   - window.CM6        (src/lib/codemirror6/codemirror.bundle.js)
 *   - editorView        (src/js/editor/editor_core.js)
 *   - AppState, render  (globals.js, renderer.js)
 */

const CollabManager = (() => {
    // --- 内部状態 ---
    let ydoc = null;           // Y.Doc インスタンス
    let provider = null;       // WebrtcProvider インスタンス
    let persistence = null;    // IndexeddbPersistence インスタンス
    let _isActive = false;     // セッション中フラグ
    let _collabCompartment = null; // CM6 Compartment（yCollab extension 用）
    let _yText = null;         // Y.Text（'codemirror' キー）
    let _onAwarenessChange = null; // Awareness 変更コールバック
    let _onPeersChange = null;     // ピア接続の変更監視
    let _onSyncedChange = null;    // 同期状態の監視
    let _undoManager = null;   // Y.UndoManager インスタンス
    let _isAttached = false;   // yCollab 挿入状態フラグ
    let _yTextObserveHandler = null; // Y.Text 変更監視ハンドラ
    let _isSyncDialogShown = false; // 同期確認ダイアログの表示中フラグ
    let _connectionTimer = null;    // 接続タイムアウト監視用タイマー

    /**
     * 接続監視用タイマーをクリアする
     */
    function clearConnectionTimeout() {
        if (_connectionTimer) {
            clearInterval(_connectionTimer);
            _connectionTimer = null;
        }
    }

    /**
     * CM6 の Compartment を返す
     * editor_core.js が先に window._collabCompartment を生成している場合はそれを使う。
     * 未生成の場合は新規作成して window._collabCompartment に保存する。
     * @returns {object|null}
     */
    function getCollabCompartment() {
        // editor_core.js が先に生成した Compartment を共有する
        if (window._collabCompartment) {
            _collabCompartment = window._collabCompartment;
            return _collabCompartment;
        }
        // フォールバック: まだ生成されていない場合は自分で生成する
        if (!_collabCompartment && window.CM6 && window.CM6.Compartment) {
            _collabCompartment = new window.CM6.Compartment();
            window._collabCompartment = _collabCompartment;
        }
        return _collabCompartment;
    }

    /**
     * シグナリングサーバー URL を取得する
     * 設定ダイアログで変更可能（フェーズ2）
     * @returns {string[]} URL 配列
     */
    function getSignalingUrls() {
        const configured = AppState.config?.collab?.signalingUrl;
        if (configured && configured.trim()) {
            return [configured.trim()];
        }
        // デフォルトはローカルのシグナリングサーバー
        return ['ws://localhost:4444'];
    }

    /**
     * STUN/TURN 設定を取得する
     * @returns {object} RTCConfiguration
     */
    function getRtcConfig() {
        const cfg = AppState.config?.collab || {};
        const iceServers = [
            // Google STUN（デフォルト）
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];
        // カスタム TURN サーバー（フェーズ2 設定UI から）
        if (cfg.turnUrl && cfg.turnUsername && cfg.turnCredential) {
            iceServers.push({
                urls: cfg.turnUrl,
                username: cfg.turnUsername,
                credential: cfg.turnCredential,
            });
        }
        return { iceServers };
    }

    /**
     * Awareness の変更を UI に反映する
     */
    function handleAwarenessChange() {
        if (!provider) return;
        // globalThis.Array.from を使うことで esbuild シムの Array と衝突しない
        const states = globalThis.Array.from(provider.awareness.getStates().entries())
            .filter(([clientId]) => clientId !== ydoc.clientID)
            .map(([clientId, state]) => ({
                clientId,
                name: state.user?.name || `ユーザー${clientId}`,
                color: state.user?.color || '#888888',
            }));

        AppState.collab.connectedUsers = states;

        // UI 更新（collab_ui.js 経由）
        if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateUserList === 'function') {
            CollabUI.updateUserList(states);
        }

        // 他のユーザーの同期ステータス（syncStatus）を走査して編集ロックを制御
        let activeSyncOwner = null;
        let maxProgress = 0;
        
        globalThis.Array.from(provider.awareness.getStates().entries())
            .filter(([clientId]) => clientId !== ydoc.clientID)
            .forEach(([clientId, state]) => {
                if (state.syncStatus && state.syncStatus.isSyncing) {
                    activeSyncOwner = state.syncStatus.senderName || `ユーザー${clientId}`;
                    maxProgress = Math.max(maxProgress, state.syncStatus.progress || 0);
                }
            });

        if (typeof CollabUI !== 'undefined') {
            if (activeSyncOwner) {
                if (typeof CollabUI.lockEditor === 'function') {
                    CollabUI.lockEditor(activeSyncOwner, maxProgress);
                }
            } else {
                if (typeof CollabUI.unlockEditor === 'function') {
                    CollabUI.unlockEditor();
                }
            }
        }
    }

    /**
     * yCollab extension を CM6 エディタに挿入する
     */
    function attachCollabExtension() {
        if (_isAttached) return;

        const view = window.editorInstance || window.editorView;
        if (!window.YjsBundle?.yCollab || !view) {
            console.warn('[CollabManager] yCollab または editorInstance が未初期化です');
            return;
        }

        const { yCollab, Y, yUndoManagerKeymap } = window.YjsBundle;
        const compartment = getCollabCompartment();
        if (!compartment) {
            console.warn('[CollabManager] CM6 Compartment が初期化できません');
            return;
        }

        // ユーザー情報を Awareness に設定
        provider.awareness.setLocalStateField('user', {
            name: AppState.collab.userName,
            color: AppState.collab.userColor,
        });

        // [FIX 2] Y.UndoManager を使用する（CM6 標準の history() ではなく）
        // リモート変更以外のすべてのローカル変更を正しくトラッキング対象にする
        _undoManager = new (Y || window.YjsBundle.Y).UndoManager(_yText);
        console.log('[CollabManager] Y.UndoManager を初期化しました');

        const extension = [
            yCollab(_yText, provider.awareness, {
                undoManager: _undoManager, // [FIX 2] CM6 の history ではなく Y.UndoManager を使用
            }),
        ];

        if (yUndoManagerKeymap && window.CM6 && window.CM6.keymap) {
            extension.push(window.CM6.keymap.of(yUndoManagerKeymap));
            console.log('[CollabManager] Yjs UndoManager 用のキーマップを適用しました');
        } else {
            console.warn('[CollabManager] yUndoManagerKeymap または window.CM6.keymap が未定義です');
        }

        view.dispatch({
            effects: compartment.reconfigure(extension),
        });

        // CM6 標準 history の無効化
        if (window._historyCompartment && view) {
            view.dispatch({
                effects: window._historyCompartment.reconfigure([]),
            });
            console.log('[CollabManager] CM6 標準 history を無効化しました');
        }

        _isAttached = true;
        console.log('[CollabManager] yCollab extension を CM6 に挿入しました');
    }

    /**
     * yCollab extension を CM6 エディタから取り外す
     */
    function detachCollabExtension() {
        if (!_isAttached) return;

        _isAttached = false; // 早期リターン前にリセット

        const compartment = getCollabCompartment();
        const view = window.editorInstance || window.editorView;
        if (!compartment || !view) return;

        view.dispatch({
            effects: compartment.reconfigure([]),
        });

        // CM6 標準 history の有効化（復元）
        if (window._historyCompartment && view && window.CM6) {
            const { history, historyKeymap, keymap } = window.CM6;
            const extensions = [];
            if (typeof history === 'function') extensions.push(history());
            if (keymap && historyKeymap) extensions.push(keymap.of(historyKeymap));

            view.dispatch({
                effects: window._historyCompartment.reconfigure(extensions),
            });
            console.log('[CollabManager] CM6 標準 history を有効化しました');
        }
        console.log('[CollabManager] yCollab extension を CM6 から取り外しました');
    }

    // [FIX 3] observeYText は CM6 の更新と競合してカーソル飛びを起こすため削除しました。
    // Y.Text の変更は yCollab 拡張を通じて自動的に CM6 に反映され、標準の editor_sync がプレビューを更新します。

    // ===================== 公開 API =====================

    /**
     * 共同編集セッションを開始する
     * @param {string} roomName  ルーム名
     * @param {string} userName  表示名
     * @param {string} userColor カラーコード（例: '#3498db'）
     */
    function start(roomName, userName, userColor) {
        if (_isActive) {
            console.warn('[CollabManager] すでにセッション中です。先に stop() を呼んでください。');
            return;
        }

        // 同期待ちの操作競合を防ぐため、一時的にエディタへの入力をロックする
        const view = window.editorInstance || window.editorView;
        if (view && view.dom) {
            view.dom.style.pointerEvents = 'none';
            view.dom.style.opacity = '0.6';
        }

        try {
            const bundle = window.YjsBundle;
            if (!bundle?.Y || !bundle?.WebrtcProvider || !bundle?.IndexeddbPersistence) {
                console.error('[CollabManager] YjsBundle が読み込まれていません');
                if (typeof showToast === 'function') {
                    showToast('共同編集ライブラリの読み込みに失敗しました', 'error');
                }
                // エラー時は確実にロックを解除
                if (view && view.dom) {
                    view.dom.style.pointerEvents = '';
                    view.dom.style.opacity = '';
                }
                return;
            }

            const { Y, WebrtcProvider, IndexeddbPersistence } = bundle;

            console.log(`[CollabManager] セッション開始: room="${roomName}", user="${userName}"`);
            _isActive = true;

            // 1. Yjs Doc 初期化
            ydoc = new Y.Doc();
            _yText = ydoc.getText('codemirror');

            // Y.Text の変更を監視し、他ユーザーによるテキスト共有を検知して自動アタッチする
            _yTextObserveHandler = (event, transaction) => {
                // 追加: セッション切断時や破棄済み直後のイベント発火時は安全に無視する
                if (!_isActive || !_yText) return;

                // アタッチされていない（共有待機中）場合のみUIを更新し、負荷を軽減する
                if (!_isAttached) {
                    if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateShareButtonState === 'function') {
                        CollabUI.updateShareButtonState();
                    }
                }
                // 修正: リモートからの変更(!transaction.local)のみ処理する。確認ダイアログ表示中は重複実行を防止する
                // IndexedDBからの復元(persistence)による変更かどうかを判定
                const isFromPersistence = transaction && transaction.origin === persistence;
                if (transaction && !transaction.local && !isFromPersistence && !_isAttached && _yText.toString() !== '' && !_isSyncDialogShown) {
                    console.log('[CollabManager] リモートテキストを検出したため、同期処理を開始します');
                    _isSyncDialogShown = true;
                    
                    // 追加: ダイアログ表示時点のセッション情報を保存
                    const currentYdoc = ydoc;

                    // 修正: トランザクション完了後に非同期で確認ダイアログの表示とアタッチを実行（Yjs トランザクション中の confirm によるブロック防止）
                    setTimeout(() => {
                        if (!_isActive || _isAttached || !_yText || ydoc !== currentYdoc) {
                            _isSyncDialogShown = false;
                            return;
                        }

                        // 非同期に実行されるため、呼び出し時点の最新文字列で再検証
                        const currentRemote = _yText.toString();
                        const view = window.editorInstance || window.editorView;
                        const currentLocal = view?.state?.doc?.toString() ?? (AppState.text || '');

                        // データ消失リスク of 排除: ローカルに未共有のテキストがあり、リモートテキストと一致しない場合、同期確認を行う
                        if (currentLocal !== '' && currentLocal !== currentRemote) {
                            const showConfirmFn = (typeof CollabUI !== 'undefined' && typeof CollabUI.showSyncConfirm === 'function')
                                ? CollabUI.showSyncConfirm
                                : () => Promise.resolve(window.confirm('ルーム内のテキストと同期しますか？\n同期すると、現在のローカルテキストは上書きされます。'));

                            showConfirmFn().then((confirmed) => {
                                if (!confirmed) {
                                    console.log('[CollabManager] 同期がキャンセルされました。ローカルテキストを保護するためセッションを終了します。');
                                    stop(); // 同期拒否時はセッションを切断する（無限ループ防止）
                                    return;
                                }
                                proceedWithSync();
                            });
                        } else {
                            proceedWithSync();
                        }
                    }, 0);
                }
            };

            // 同期処理の実行ヘルパー
            function proceedWithSync() {
                if (!_isActive) return;

                try {
                    // 実行時点での最新のテキストを取得して同期する
                    const textToSync = _yText.toString();

                    AppState.text = textToSync;
                    if (typeof setEditorText === 'function') {
                        setEditorText(textToSync);
                    }
                    if (typeof render === 'function') render();
                    attachCollabExtension();
                } finally {
                    _isSyncDialogShown = false; // 例外発生時も確実にリセット
                }
            }
            _yText.observe(_yTextObserveHandler);

            // 2. WebRTC プロバイダ（シグナリング＋P2P接続）
            provider = new WebrtcProvider(roomName, ydoc, {
                signaling: getSignalingUrls(),
                peerOpts: {
                    config: getRtcConfig(),
                },
            });

            // アタッチ前（待機中）でもネットワーク上に自分の情報を登録し、他人に即座に伝える
            provider.awareness.setLocalStateField('user', {
                name: userName,
                color: userColor,
            });

            // 3. IndexedDB 永続化（オフライン対応）
            const persistenceKey = `md-editor-collab-${roomName}`;
            persistence = new IndexeddbPersistence(persistenceKey, ydoc);
            const currentPersistence = persistence;
            persistence.whenSynced.then(() => {
                // 別のセッションに切り替わっている、または停止している場合は中断
                if (!_isActive || !_yText || persistence !== currentPersistence) return;

                // エディタのロックを解除
                const view = window.editorInstance || window.editorView;
                if (view && view.dom) {
                    view.dom.style.pointerEvents = '';
                    view.dom.style.opacity = '';
                }

                // すでにWebRTC等のリモート更新によりアタッチ済み、または同期確認中の場合は再セットアップをスキップ（カーソルリセットの競合防止）
                if (_isAttached || _isSyncDialogShown) {
                    console.log('[CollabManager] すでにアタッチされているか、同期確認中のため、IndexedDB同期後の初期復元をスキップします');
                    return;
                }

                console.log('[CollabManager] IndexedDB から同期完了');

                // IndexedDB 復元後に AppState.text と CM6 を同期
                const restoredText = _yText.toString();
                let currentLocal = view?.state?.doc?.toString() ?? (AppState.text || '');

                if (restoredText !== '') {
                    // ローカルテキストが存在し、復元データと異なる場合は確認ダイアログを出す
                    if (currentLocal !== '' && currentLocal !== restoredText) {
                        _isSyncDialogShown = true;
                        const currentYdoc = ydoc; // セッション情報を保存
                        const showConfirmFn = (typeof CollabUI !== 'undefined' && typeof CollabUI.showSyncConfirm === 'function')
                            ? CollabUI.showSyncConfirm
                            : () => Promise.resolve(window.confirm('過去のルームデータを復元しますか？\n同期すると現在のテキストは上書きされます。'));

                        showConfirmFn().then((confirmed) => {
                            if (ydoc !== currentYdoc) return; // 競合防止ガード

                            if (!confirmed) {
                                stop(); // キャンセル時は保護のため切断
                                return;
                            }
                            proceedWithSync();
                        });
                    } else {
                        proceedWithSync();
                    }
                } else {
                    // ルームが空で、かつローカルエディタも空の場合は自動アタッチする
                    currentLocal = view?.state?.doc?.toString() ?? (AppState.text || '');
                    if (currentLocal === '') {
                        console.log('[CollabManager] ルームとローカルが共に空のため、自動アタッチします');
                        attachCollabExtension();
                    } else {
                        // 空のルームの場合はアタッチせず、手動共有ボタンを表示して待機
                        if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateShareButtonState === 'function') {
                            CollabUI.updateShareButtonState();
                        }
                    }
                }
            }).catch((err) => {
                console.error('[CollabManager] IndexedDB 同期エラー:', err);
                // 別のセッションに切り替わっている、または停止している場合は中断
                if (!_isActive || !_yText || persistence !== currentPersistence) return;

                // エラー時もエディタのロックを強制解除
                const view = window.editorInstance || window.editorView;
                if (view && view.dom) {
                    view.dom.style.pointerEvents = '';
                    view.dom.style.opacity = '';
                }
                if (typeof showToast === 'function') {
                    showToast('ローカルデータの同期に失敗しました', 'error');
                }
            });
        } catch (error) {
            console.error('[CollabManager] 初期化中にエラーが発生しました:', error);
            // エラー時は確実にロックを解除
            const view = window.editorInstance || window.editorView;
            if (view && view.dom) {
                view.dom.style.pointerEvents = '';
                view.dom.style.opacity = '';
            }
            if (typeof showToast === 'function') {
                showToast('共同編集の初期化に失敗しました', 'error');
            }

            // 部分的に割り当てられたリソースのクリーンアップ
            _isActive = false;
            if (_undoManager) {
                try {
                    _undoManager.destroy();
                } catch (e) {}
                _undoManager = null;
            }
            if (provider) {
                try {
                    provider.disconnect();
                    provider.destroy();
                } catch (e) {}
                provider = null;
            }
            if (persistence) {
                try {
                    persistence.destroy();
                } catch (e) {}
                persistence = null;
            }
            if (ydoc) {
                try {
                    ydoc.destroy();
                } catch (e) {}
                ydoc = null;
                _yText = null;
            }
            _isSyncDialogShown = false;

            if (AppState.collab) {
                AppState.collab.isActive = false;
                AppState.collab.roomName = '';
                AppState.collab.userName = '';
                AppState.collab.userColor = '';
                AppState.collab.connectedUsers = [];
            }
            if (typeof CollabUI !== 'undefined') {
                if (typeof CollabUI.updateUserList === 'function') CollabUI.updateUserList([]);
                if (typeof CollabUI.updateStatus === 'function') CollabUI.updateStatus('disconnected');
                if (typeof CollabUI.updateButtonState === 'function') CollabUI.updateButtonState();
            }
            return;
        }

        // 4. AppState を更新
        AppState.collab = AppState.collab || {};
        AppState.collab.isActive = true;
        AppState.collab.roomName = roomName;
        AppState.collab.userName = userName;
        AppState.collab.userColor = userColor;
        AppState.collab.connectedUsers = [];
        _isActive = true;

        // 5. Awareness 変更監視
        _onAwarenessChange = handleAwarenessChange;
        provider.awareness.on('change', _onAwarenessChange);
        handleAwarenessChange(); // 初期状態で自分自身のバッジを表示する

        // 6. 接続状態のモニタリング（改修版）
        // シグナリングサーバーへの接続開始時点で「待機中」とする
        if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateStatus === 'function') {
            CollabUI.updateStatus('waiting');
        }

        // 接続状態の監視タイマーの始動（Tauri環境のみ自動探索/UIステータス反映のため）
        if (window.__TAURI__) {
            clearConnectionTimeout();
            let checkCount = 0;
            const checkInterval = setInterval(() => {
                checkCount++;
                const isSignalingConnected = provider && provider.signalingConns && provider.signalingConns.some(conn => {
                    console.log(`[CollabManager] Debug conn: url=${conn.url}, connected=${conn.connected}, connecting=${conn.connecting}`);
                    return conn.connected;
                });
                console.log(`[CollabManager] Debug check #${checkCount}: isSignalingConnected=${isSignalingConnected}`);

                if (isSignalingConnected) {
                    // 接続が確立した場合
                    clearConnectionTimeout();
                    console.log('[CollabManager] シグナリングサーバーへの接続を確立しました。');
                    if (typeof CollabUI !== 'undefined' && typeof CollabUI.handleConnectionSuccess === 'function') {
                        CollabUI.handleConnectionSuccess();
                    }
                } else if (checkCount >= 10) { // 500ms * 10 = 5秒
                    // 5秒経過しても接続が確立しない場合（タイムアウト）
                    clearConnectionTimeout();
                    console.log('[CollabManager] シグナリングサーバーへの接続タイムアウト。');
                    if (typeof CollabUI !== 'undefined' && typeof CollabUI.handleConnectionTimeout === 'function') {
                        CollabUI.handleConnectionTimeout(roomName, userName, userColor);
                    }
                }
            }, 500);
            _connectionTimer = checkInterval;
        }

        _onPeersChange = (event) => {
            if (!_isActive) return;
            // event.webrtcPeers には現在接続中のピアID of 配列が入る
            const peerCount = event.webrtcPeers.length;
            console.log(`[CollabManager] WebRTC ピア接続数: ${peerCount}`);

            if (peerCount > 0) {
                clearConnectionTimeout();
            }

            // ピアが1つ以上あれば「接続中」、0なら「他のユーザーを待機中」とする
            const statusStr = peerCount > 0 ? 'connected' : 'waiting';

            if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateStatus === 'function') {
                CollabUI.updateStatus(statusStr);
            }

            // [NEW] ピア接続の SimplePeer に画像/ファイル転送用の受信ハンドラをバインド
            if (provider && provider.room && provider.room.webrtcPeers) {
                provider.room.webrtcPeers.forEach((conn, peerId) => {
                    const peer = conn.peer;
                    if (peer && !peer._fileHandlerBound) {
                        peer._fileHandlerBound = true;
                        peer.on('data', (data) => {
                            handleIncomingPeerData(data, peerId);
                        });
                    }
                });
            }
        };
        provider.on('peers', _onPeersChange);

        // 初回データ同期完了 of イベント
        _onSyncedChange = (event) => {
            console.log(`[CollabManager] P2P ネットワークとの同期状態: ${event.synced}`);
            if (event.synced) {
                clearConnectionTimeout();
            }
        };
        provider.on('synced', _onSyncedChange);

        if (typeof showToast === 'function') {
            showToast(`共同編集を開始しました: ルーム「${roomName}」`, 'info');
        }
    }

    /**
     * 共同編集セッションを終了する
     * @returns {Promise<void>}
     */
    function stop() {
        return new Promise((resolve) => {
            clearConnectionTimeout();

            if (!_isActive) {
                resolve();
                return;
            }

            console.log('[CollabManager] セッション終了');

            // 同期待ちのまま切断された場合のためにロックを強制解除
            const view = window.editorInstance || window.editorView;
            if (view && view.dom) {
                view.dom.style.pointerEvents = '';
                view.dom.style.opacity = '';
            }

            // CM6 から extension を取り外す
            detachCollabExtension();

            let destroyPromise = Promise.resolve();

            if (provider) {
                // [FIX 4] 自分のカーソルを他人の画面から即座に消去する（ゴーストカーソル対策）
                provider.awareness.setLocalState(null);

                if (_onAwarenessChange) {
                    provider.awareness.off('change', _onAwarenessChange);
                    _onAwarenessChange = null;
                }
                if (_onPeersChange) {
                    provider.off('peers', _onPeersChange);
                    _onPeersChange = null;
                }
                if (_onSyncedChange) {
                    provider.off('synced', _onSyncedChange);
                    _onSyncedChange = null;
                }

                // 送信バッファがネットワークに送られる時間を確保するため、切断と破棄を100ms遅延させる
                const tempProvider = provider;
                provider = null;
                destroyPromise = new Promise((res) => {
                    setTimeout(() => {
                        try {
                            tempProvider.disconnect();
                            tempProvider.destroy();
                        } catch (e) {
                            console.warn('[CollabManager] WebrtcProvider destroy error:', e);
                        }
                        res();
                    }, 100);
                });
            }

            _isSyncDialogShown = false;

            // 開いたままの同期確認ダイアログがあれば閉じる
            const confirmDialog = document.getElementById('dialog-collab-confirm');
            if (confirmDialog && typeof confirmDialog.close === 'function' && confirmDialog.open) {
                confirmDialog.close();
            }

            // AppState をリセット
            AppState.collab.isActive = false;
            AppState.collab.roomName = '';
            AppState.collab.userName = '';
            AppState.collab.userColor = '';
            AppState.collab.connectedUsers = [];
            _isActive = false;

            // UIを未接続状態に戻す
            if (typeof CollabUI !== 'undefined') {
                if (typeof CollabUI.updateUserList === 'function') CollabUI.updateUserList([]);
                if (typeof CollabUI.updateStatus === 'function') CollabUI.updateStatus('disconnected');
                if (typeof CollabUI.updateButtonState === 'function') CollabUI.updateButtonState();
            }

            if (typeof showToast === 'function') {
                showToast('共同編集セッションを終了しました', 'info');
            }

            const tempPersistence = persistence;
            const tempYdoc = ydoc;
            const tempUndoManager = _undoManager;

            // 変数を null にする前に、即座に変更監視を解除する
            if (_yText && _yTextObserveHandler) {
                try { _yText.unobserve(_yTextObserveHandler); } catch (e) {}
            }

            // グローバル参照を即座にリセット（直後の start() で上書きされても安全にするため）
            persistence = null;
            ydoc = null;
            _yText = null;
            _yTextObserveHandler = null;
            _undoManager = null;

            destroyPromise.then(() => {
                // 依存の末端（子要素）から順に破棄する
                if (tempUndoManager) {
                    try { tempUndoManager.destroy(); } catch (e) {}
                }
                if (tempPersistence) {
                    try { tempPersistence.destroy(); } catch (e) {}
                }
                // 親要素 (Ydoc) は一番最後に破棄
                if (tempYdoc) {
                    try { tempYdoc.destroy(); } catch (e) {}
                }
                resolve();
            });
        });
    }
    // P2P ファイル転送のバッファ用 Map (fileId -> { chunks: [], receivedCount, totalChunks, fileName, fileType })
    const incomingFileChunks = new Map();

    /**
     * ピアから受信した画像・ファイルチャンクを処理する
     * @param {string|Uint8Array} rawPayload
     * @param {string} peerId
     */
    function handleIncomingPeerData(rawPayload, peerId) {
        if (!_isActive) return;

        let payload = rawPayload;
        if (payload instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload))) {
            try {
                payload = new TextDecoder("utf-8").decode(payload);
            } catch (e) {
                return;
            }
        }

        let msg;
        try {
            msg = JSON.parse(payload);
        } catch (e) {
            return; // Yjs自身のバイナリデータ等は無視
        }

        if (msg && msg.type === 'file-chunk') {
            const { fileId, fileName, fileType, chunkIndex, totalChunks, data } = msg;

            if (!incomingFileChunks.has(fileId)) {
                incomingFileChunks.set(fileId, {
                    chunks: new Array(totalChunks),
                    receivedCount: 0,
                    totalChunks: totalChunks,
                    fileName: fileName,
                    fileType: fileType
                });
            }

            const fileInfo = incomingFileChunks.get(fileId);
            if (!fileInfo.chunks[chunkIndex]) {
                const binaryStr = atob(data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                fileInfo.chunks[chunkIndex] = bytes;
                fileInfo.receivedCount++;
            }

            if (fileInfo.receivedCount === fileInfo.totalChunks) {
                assembleAndInsertFile(fileId, fileInfo);
                incomingFileChunks.delete(fileId);
            }
        }
    }

    /**
     * 受信完了したチャンクを結合して Blob URL を作成し、エディタ内のプレースホルダーを置換する
     */
    function assembleAndInsertFile(fileId, fileInfo) {
        console.log(`[CollabManager] P2Pファイルの受信完了: ${fileInfo.fileName}`);
        
        const blob = new Blob(fileInfo.chunks, { type: fileInfo.fileType });
        const blobUrl = URL.createObjectURL(blob);

        const view = window.editorInstance || window.editorView;
        if (!view) return;

        const docText = view.state.doc.toString();
        const targetStr = `file-blob://${fileId}`;
        const index = docText.indexOf(targetStr);
        if (index !== -1) {
            view.dispatch({
                changes: { from: index, to: index + targetStr.length, insert: blobUrl }
            });
            console.log(`[CollabManager] プレースホルダーを Blob URL に置換完了`);
        } else {
            console.warn(`[CollabManager] 置換先のプレースホルダーが見つかりません: ${targetStr}`);
        }
    }

    /**
     * 大容量画像やファイルを WebRTC ピアへチャンク分割して送信する
     * @param {string} fileId
     * @param {File} file
     */
    async function sendLargeFile(fileId, file) {
        if (!_isActive || !provider || !provider.room || !provider.room.webrtcPeers) {
            return;
        }

        const peersMap = provider.room.webrtcPeers;
        if (peersMap.size === 0) {
            console.log('[CollabManager] ピアがいないため、画像転送をスキップします');
            return;
        }

        console.log(`[CollabManager] P2P 画像送信開始: ${file.name}`);

        let arrayBuffer;
        try {
            arrayBuffer = await file.arrayBuffer();
        } catch (e) {
            console.error('[CollabManager] ファイル読み込みエラー:', e);
            return;
        }

        const CHUNK_SIZE = 16384; // 16KB チャンク
        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
        const bytes = new Uint8Array(arrayBuffer);

        if (typeof CollabUI !== 'undefined' && typeof CollabUI.lockEditor === 'function') {
            CollabUI.lockEditor(AppState.collab.userName || '自分', 0);
        }

        provider.awareness.setLocalStateField('syncStatus', {
            isSyncing: true,
            progress: 0,
            senderName: AppState.collab.userName || 'ユーザー',
            fileId: fileId
        });

        for (let i = 0; i < totalChunks; i++) {
            if (!_isActive) break;

            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
            const chunkBytes = bytes.slice(start, end);

            let binaryStr = "";
            for (let j = 0; j < chunkBytes.length; j++) {
                binaryStr += String.fromCharCode(chunkBytes[j]);
            }
            const base64Data = btoa(binaryStr);

            const payload = JSON.stringify({
                type: 'file-chunk',
                fileId: fileId,
                fileName: file.name,
                fileType: file.type,
                chunkIndex: i,
                totalChunks: totalChunks,
                data: base64Data
            });

            peersMap.forEach((conn) => {
                const peer = conn.peer;
                if (peer && conn.connected) {
                    try {
                        peer.send(payload);
                    } catch (e) {
                        console.warn('[CollabManager] チャンク送信エラー:', e);
                    }
                }
            });

            if (i % 5 === 0) {
                await new Promise(res => setTimeout(res, 20));
            }

            const progress = ((i + 1) / totalChunks) * 100;
            if (typeof CollabUI !== 'undefined' && typeof CollabUI.lockEditor === 'function') {
                CollabUI.lockEditor(AppState.collab.userName || '自分', progress);
            }
            provider.awareness.setLocalStateField('syncStatus', {
                isSyncing: true,
                progress: progress,
                senderName: AppState.collab.userName || 'ユーザー',
                fileId: fileId
            });
        }

        console.log('[CollabManager] P2P 画像送信完了');

        provider.awareness.setLocalStateField('syncStatus', {
            isSyncing: false,
            progress: 100,
            senderName: AppState.collab.userName || 'ユーザー',
            fileId: fileId
        });

        if (typeof CollabUI !== 'undefined' && typeof CollabUI.unlockEditor === 'function') {
            CollabUI.unlockEditor();
        }
    }

    /**
     * ルームが空（誰もテキストを書き込んでいない）かどうかを返す
     * @returns {boolean}
     */
    function isRoomEmpty() {
        return _isActive && _yText !== null && _yText.toString() === '';
    }

    /**
     * ローカルのテキストをルーム全体に共有（プッシュ）する
     * @returns {boolean} 成功したかどうか
     */
    function pushLocalText() {
        if (!_isActive || !_yText) return false;

        // すでに誰かがテキストを書いている場合は上書きを防ぐためブロック
        if (_yText.toString() !== '') {
            console.warn('[CollabManager] すでにルームにテキストが存在するため、共有をキャンセルしました');
            return false;
        }

        const view = window.editorInstance || window.editorView;
        // エディタインスタンスから直接確実な最新文字列を取得（無ければ AppState.text を使用）
        // オプショナルチェーンを使用して、state や doc が未定義の瞬間の例外を防止
        const currentText = view?.state?.doc?.toString() ?? (AppState.text || '');

        _yText.insert(0, currentText);
        console.log('[CollabManager] ローカルテキストをルームに共有しました');

        // 共有した直後に CodeMirror にアタッチして共同編集を開始
        attachCollabExtension();
        return true;
    }

    /**
     * エディタがアタッチされているかどうかを返す
     * @returns {boolean}
     */
    function isAttached() {
        return _isAttached;
    }

    /**
     * @returns {boolean}
     */
    function isActive() {
        return _isActive;
    }

    /**
     * 接続中のユーザー一覧を返す
     * @returns {Array<{clientId: number, name: string, color: string}>}
     */
    function getConnectedUsers() {
        return AppState.collab.connectedUsers || [];
    }

    /**
     * CM6 の collab Compartment を返す（editor_core.js からの初期化用）
     * @returns {object|null}
     */
    function getCompartment() {
        return getCollabCompartment();
    }

    /**
     * 初期化（app.js の init() から呼ぶ）
     * CM6 Compartment を EditorView の extensions に事前登録するため
     */
    function init() {
        // Compartment は EditorView 初期化後に利用可能になる
        // ここでは単純にフラグをリセットするだけ
        _isActive = false;
        console.log('[CollabManager] 初期化完了');
    }

    /**
     * 指定されたシグナリングサーバーURLを設定し、再接続する
     * @param {string} url シグナリングサーバーURL
     * @param {string} roomName
     * @param {string} userName
     * @param {string} userColor
     */
    async function reconnectWithUrl(url, roomName, userName, userColor) {
        console.log(`[CollabManager] 新しいシグナリングサーバーに再接続します: ${url}`);
        
        // 設定を更新して保存
        if (AppState.config && AppState.config.collab) {
            AppState.config.collab.signalingUrl = url;
            if (typeof saveSettings === 'function') {
                saveSettings();
            }
        }

        // 一度切断して再開
        await stop();
        start(roomName, userName, userColor);
    }

    // ページ終了時のゴーストカーソル防止フェイルセーフ
    window.addEventListener('beforeunload', () => {
        if (_isActive && provider) {
            try {
                provider.awareness.setLocalState(null);
            } catch (e) {}
        }
    });

    return {
        init,
        start,
        stop,
        isActive,
        getConnectedUsers,
        getCompartment,
        isRoomEmpty,
        pushLocalText,
        isAttached,
        reconnectWithUrl,
        sendLargeFile,
    };
})();

// グローバルに公開
window.CollabManager = CollabManager;
