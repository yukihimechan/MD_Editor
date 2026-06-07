/**
 * Editor Auto Save & History Management
 */

class AutoSaveManager {
    constructor() {
        this.STORAGE_KEY = 'mdEditor_autoSaveHistory';
        this.MAX_HISTORY = 10;
        this.debounceTimer = null;
        this.AUTO_SAVE_DELAY = 2000; // 2秒
    }

    /**
     * 履歴を取得する
     * @returns {Array} 履歴データの配列
     */
    getHistory() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('[AutoSave] Failed to get history', e);
            return [];
        }
    }

    /**
     * 履歴を保存する
     */
    saveToHistory() {
        if (!AppState.documentId) {
            console.warn('[AutoSave] No documentId, skipping save');
            return;
        }

        const text = typeof getEditorText === 'function' ? getEditorText() : AppState.text;
        
        // テキストが空の場合は保存しない（初期状態など）
        if (!text || text.trim() === '') {
            return;
        }

        const currentId = AppState.documentId;
        const currentPath = AppState.fileFullPath || AppState.filePath || '新規ドキュメント';
        const now = new Date().getTime();

        const historyItem = {
            id: currentId,
            filePath: currentPath,
            timestamp: now,
            text: text
        };

        try {
            const saveStart = performance.now();
            let history = this.getHistory();
            
            // 同じ documentId があれば削除（上書きのため）
            history = history.filter(item => item.id !== currentId);
            
            // 先頭に追加
            history.unshift(historyItem);
            
            // 最大件数を超えたら削除
            if (history.length > this.MAX_HISTORY) {
                history = history.slice(0, this.MAX_HISTORY);
            }
            
            // [Perf] localStorageの5MB制限に近づくとsetItemが数秒単位でフリーズ（もっさり感の原因）するため、
            // 履歴全体のテキスト総量が一定（約1MB相当 = 50万文字）を超えないように古いものから捨てる
            const MAX_TOTAL_CHARS = 500000;
            let totalChars = 0;
            let keepCount = 0;
            for (let i = 0; i < history.length; i++) {
                totalChars += (history[i].text ? history[i].text.length : 0);
                if (totalChars > MAX_TOTAL_CHARS && i > 0) {
                    break;
                }
                keepCount++;
            }
            if (keepCount < history.length) {
                history = history.slice(0, keepCount);
            }

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
            console.log(`[AutoSave] Saved history for ${currentId} in ${(performance.now() - saveStart).toFixed(1)}ms`);
        } catch (e) {
            console.error('[AutoSave] Failed to save history', e);
        }
    }

    /**
     * テキスト変更時に呼び出し、遅延実行で保存を行う
     */
    scheduleSave() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.saveToHistory();
        }, this.AUTO_SAVE_DELAY);
    }

    /**
     * 指定されたIDの履歴を読み込み、エディタにセットする
     * @param {string} id - ドキュメントID
     */
    loadFromHistory(id) {
        const history = this.getHistory();
        const item = history.find(i => i.id === id);

        if (!item) {
            if (typeof showToast === 'function') showToast('エラー: 保存データが見つかりません', 'error');
            return;
        }

        // 未保存の変更がある場合は確認
        if (AppState.isModified) {
            const confirmMsg = '現在のドキュメントに未保存の変更があります。破棄して履歴から復元しますか？';
            if (!confirm(confirmMsg)) {
                return;
            }
        }

        // 状態のリセット
        if (typeof resetSearch === 'function') resetSearch();
        if (typeof resetEditor === 'function') {
            resetEditor(item.text);
        } else if (window.editorInstance) {
            window.editorInstance.dispatch({
                changes: { from: 0, to: window.editorInstance.state.doc.length, insert: item.text }
            });
        }

        AppState.text = item.text;
        
        // 呼び出したデータを保存する際は「必ず保存ディレクトリを確認する」仕様のため、
        // ファイル情報をクリアする。（別名保存と同等の扱いになる）
        AppState.filePath = null;
        AppState.fileFullPath = null;
        AppState.fileHandle = null;
        AppState.fileDirectory = null;
        
        // 復元したデータを上書き保存しようとすると名前を付けて保存になるが、
        // 復元直後も同じドキュメントIDを引き継ぐと編集時に元データの履歴が上書きされてしまう。
        // 「一時保存データから呼び出したデータを保存するときは別のデータとして扱う（=新規と同じ）」ため、
        // 新しいdocumentIdを生成する。
        AppState.documentId = typeof generateUUID === 'function' ? generateUUID() : crypto.randomUUID();

        AppState.isModified = true; // 復元直後は未保存状態とする（すぐに保存できるように）

        if (typeof updateEditorLineNumbers === 'function') updateEditorLineNumbers();
        if (typeof render === 'function') render();
        if (typeof updateTitle === 'function') updateTitle();
        if (typeof showToast === 'function') showToast(`一時保存から復元しました: ${item.filePath}`);
    }

    /**
     * 日時を見やすくフォーマットする
     * @param {number} timestamp 
     * @returns {string} フォーマットされた日時文字列
     */
    formatDate(timestamp) {
        const d = new Date(timestamp);
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
}

// グローバルインスタンスを作成
window.autoSaveManager = new AutoSaveManager();
