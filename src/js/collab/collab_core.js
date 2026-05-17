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
    let _onStatusChange = null;    // WebRTC ステータス変更コールバック
    let _undoManager = null;   // Y.UndoManager インスタンス

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
        // デフォルト: y-webrtc 公式テストサーバー
        // 稼働していない Heroku サーバーを削除し、接続遅延を防止
        return ['wss://signaling.yjs.dev'];
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
    }

    /**
     * yCollab extension を CM6 エディタに挿入する
     */
    function attachCollabExtension() {
        if (!window.YjsBundle?.yCollab || !window.editorInstance) {
            console.warn('[CollabManager] yCollab または editorInstance が未初期化です');
            return;
        }

        const { yCollab, Y } = window.YjsBundle;
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

        // [FIX 1] IndexedDB/WebRTC 同期完了後に初期テキスト判定を行うため、
        // ここでは同期済みの _yText が空かつローカルに内容がある場合のみ投入する。
        // この関数は必ず persistence.whenSynced.then() の後から呼ぶこと。
        if (_yText.toString() === '' && AppState.text) {
            _yText.insert(0, AppState.text);
            console.log('[CollabManager] Y.Text をローカルのテキストで初期化しました（ファーストピア）');
        } else {
            console.log('[CollabManager] Y.Text にリモートデータあり。ローカルの上書きをスキップしました');
        }

        // [FIX 2] Y.UndoManager を使用する（CM6 標準の history() ではなく）
        // 自分のクライアントIDの変更のみを追跡し、他ユーザーの変更はUndoしない
        _undoManager = new (Y || window.YjsBundle.Y).UndoManager(_yText, {
            trackedOrigins: new Set([ydoc.clientID]),
        });
        console.log('[CollabManager] Y.UndoManager を初期化しました（clientID:', ydoc.clientID, '）');

        const extension = yCollab(_yText, provider.awareness, {
            undoManager: _undoManager, // [FIX 2] CM6 の history ではなく Y.UndoManager を使用
        });

        window.editorInstance.dispatch({
            effects: compartment.reconfigure(extension),
        });

        console.log('[CollabManager] yCollab extension を CM6 に挿入しました');
    }

    /**
     * yCollab extension を CM6 エディタから取り外す
     */
    function detachCollabExtension() {
        const compartment = getCollabCompartment();
        if (!compartment || !window.editorInstance) return;

        window.editorInstance.dispatch({
            effects: compartment.reconfigure([]),
        });

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

        const bundle = window.YjsBundle;
        if (!bundle?.Y || !bundle?.WebrtcProvider || !bundle?.IndexeddbPersistence) {
            console.error('[CollabManager] YjsBundle が読み込まれていません');
            if (typeof showToast === 'function') {
                showToast('共同編集ライブラリの読み込みに失敗しました', 'error');
            }
            return;
        }

        const { Y, WebrtcProvider, IndexeddbPersistence } = bundle;

        console.log(`[CollabManager] セッション開始: room="${roomName}", user="${userName}"`);

        // 1. Yjs Doc 初期化
        ydoc = new Y.Doc();
        _yText = ydoc.getText('codemirror');

        // 2. WebRTC プロバイダ（シグナリング＋P2P接続）
        provider = new WebrtcProvider(roomName, ydoc, {
            signaling: getSignalingUrls(),
            peerOpts: {
                config: getRtcConfig(),
            },
        });

        // 3. IndexedDB 永続化（オフライン対応）
        const persistenceKey = `md-editor-collab-${roomName}`;
        persistence = new IndexeddbPersistence(persistenceKey, ydoc);
        persistence.whenSynced.then(() => {
            console.log('[CollabManager] IndexedDB から同期完了');
            // IndexedDB 復元後に AppState.text と CM6 を同期
            const restoredText = _yText.toString();
            if (restoredText && restoredText !== AppState.text) {
                AppState.text = restoredText;
                if (typeof setEditorText === 'function') {
                    setEditorText(restoredText);
                }
                if (typeof render === 'function') render();
            }

            // [FIX 1] IndexedDB 同期完了後に CM6 へ extension を挿入する。
            // これにより「同期前に _yText が空のままローカルテキストで上書きする」
            // レースコンディションを解消する。
            attachCollabExtension();
        });

        // 4. AppState を更新
        AppState.collab.isActive = true;
        AppState.collab.roomName = roomName;
        AppState.collab.userName = userName;
        AppState.collab.userColor = userColor;
        AppState.collab.connectedUsers = [];
        _isActive = true;

        // 5. Awareness 変更監視
        _onAwarenessChange = handleAwarenessChange;
        provider.awareness.on('change', _onAwarenessChange);

        // 6. 接続状態のモニタリング（リスナー解除用に変数へ保持）
        _onStatusChange = (event) => {
            console.log(`[CollabManager] WebRTC 状態: ${event.status}`);
            if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateStatus === 'function') {
                CollabUI.updateStatus(event.status);
            }
        };
        provider.on('status', _onStatusChange);

        // [追加] WebRTC デバッグ用ログ
        provider.on('peers', (event) => {
            console.log(`[CollabManager WebRTC Debug] Peers changed. 追加:`, event.added, ` 削除:`, event.removed, ` 現在のPeers:`, event.webrtcPeers);
        });
        provider.on('synced', (event) => {
            console.log(`[CollabManager WebRTC Debug] Synced event:`, event);
        });
        
        // 5秒おきにシグナリングサーバーへの接続状態を出力 (ログスパムになるため削除)
        // const signalingDebugInterval = setInterval(() => { ... }, 5000);

        if (typeof showToast === 'function') {
            showToast(`共同編集を開始しました: ルーム「${roomName}」`, 'info');
        }
    }

    /**
     * 共同編集セッションを終了する
     */
    function stop() {
        if (!_isActive) return;

        console.log('[CollabManager] セッション終了');

        // CM6 から extension を取り外す
        detachCollabExtension();

        if (provider) {
            // [FIX 4] 自分のカーソルを他人の画面から即座に消去する（ゴーストカーソル対策）
            provider.awareness.setLocalState(null);

            if (_onAwarenessChange) {
                provider.awareness.off('change', _onAwarenessChange);
                _onAwarenessChange = null;
            }
            if (_onStatusChange) {
                provider.off('status', _onStatusChange);
                _onStatusChange = null;
            }

            provider.disconnect();
            provider.destroy();
            provider = null;
        }

        // 永続化の破棄
        if (persistence) {
            persistence.destroy();
            persistence = null;
        }

        // Doc の破棄
        if (ydoc) {
            ydoc.destroy();
            ydoc = null;
            _yText = null;
        }

        // UndoManager のリセット
        if (_undoManager) {
            _undoManager.destroy();
            _undoManager = null;
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
    }

    /**
     * 現在共同編集セッション中かを返す
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

    return {
        init,
        start,
        stop,
        isActive,
        getConnectedUsers,
        getCompartment,
    };
})();

// グローバルに公開
window.CollabManager = CollabManager;
