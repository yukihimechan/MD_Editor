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
        return ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com', 'wss://y-webrtc-signaling-us.herokuapp.com'];
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

        const { yCollab } = window.YjsBundle;
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

        // yCollab extension を動的に挿入
        // Y.Text が空でローカルエディタにテキストがある場合、Y.Text 側に初期設定を行う
        if (_yText.toString() === '' && AppState.text) {
            _yText.insert(0, AppState.text);
            console.log('[CollabManager] Y.Text をローカルのテキストで初期化しました');
        }

        const extension = yCollab(_yText, provider.awareness, {
            undoManager: false, // CM6 既存の history を使う（undoManager: false）
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

    /**
     * Y.Text の変更を監視してプレビューを更新する
     */
    function observeYText() {
        if (!_yText) return;

        _yText.observe((event, transaction) => {
            console.log(`[CollabManager] Y.Text 更新検知 (local=${transaction.local}):`, _yText.toString());
            // 自分のトランザクションは CM6 が処理済みなのでスキップ
            if (transaction.local) return;

            // 他ユーザーの変更: AppState.text を更新してプレビューをレンダリング
            const newText = _yText.toString();
            if (AppState.text !== newText) {
                AppState.text = newText;
                AppState.isModified = true;

                // デバウンスしてプレビュー更新
                clearTimeout(window._collabRenderTimer);
                window._collabRenderTimer = setTimeout(async () => {
                    if (typeof render === 'function') {
                        await render();
                    }
                }, 150);
            }
        });
    }

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
        });

        // 4. AppState を更新
        AppState.collab.isActive = true;
        AppState.collab.roomName = roomName;
        AppState.collab.userName = userName;
        AppState.collab.userColor = userColor;
        AppState.collab.connectedUsers = [];
        _isActive = true;

        // 5. CM6 に yCollab extension を挿入
        // ※ editorView の初期化後に呼ぶ必要があるため、少し遅延させる
        setTimeout(() => {
            attachCollabExtension();
        }, 100);

        // 6. Y.Text 変更の監視（他ユーザーの編集をプレビューに反映）
        observeYText();

        // 7. Awareness 変更監視
        _onAwarenessChange = handleAwarenessChange;
        provider.awareness.on('change', _onAwarenessChange);

        // 8. 接続状態のモニタリング
        provider.on('status', (event) => {
            console.log(`[CollabManager] WebRTC 状態: ${event.status}`);
            if (typeof CollabUI !== 'undefined' && typeof CollabUI.updateStatus === 'function') {
                CollabUI.updateStatus(event.status);
            }
        });

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

        // Awareness 監視解除
        if (provider && _onAwarenessChange) {
            provider.awareness.off('change', _onAwarenessChange);
            _onAwarenessChange = null;
        }

        // プロバイダの破棄
        if (provider) {
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

        // AppState をリセット
        AppState.collab.isActive = false;
        AppState.collab.roomName = '';
        AppState.collab.userName = '';
        AppState.collab.userColor = '';
        AppState.collab.connectedUsers = [];
        _isActive = false;

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
