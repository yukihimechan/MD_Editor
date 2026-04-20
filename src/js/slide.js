/**
 * スライド機能モジュール
 * PDFと同様のページ分割ロジックを使用してプレビューをスライド表示する
 */

/**
 * [SHARED] スライド表示の1ページ高さをpx単位で返す共有ユーティリティ関数。
 * SlideManager.buildSlides() とプレビュー改ページ表示の両方が参照し、
 * 同一の計算式でページ高さを算出することで改ページ位置の一致を保証する。
 * @returns {number} 1ページあたりの高さ (px)
 */
window.getSlidePageHeightPx = function() {
    const orientation = (typeof AppState !== 'undefined' && AppState.config && AppState.config.slideOrientation) || 'landscape';
    const PAGE_WIDTH_PT  = orientation === 'portrait' ? 595.28 : 841.89;
    const PAGE_HEIGHT_PT = orientation === 'portrait' ? 841.89 : 595.28;

    const margins = (typeof AppState !== 'undefined' && AppState.config && AppState.config.pdfMargins)
        || { top: 10, bottom: 10, left: 10, right: 10 };

    // pt → px 換算 (1pt ≒ 2.83465px @ 96dpi / 72dpi = 1.3333...)
    // ※ SlideManagerと同じ変換係数を使用
    const marginTop    = margins.top    * 2.83465;
    const marginBottom = margins.bottom * 2.83465;
    const marginLeft   = margins.left   * 2.83465;
    const marginRight  = margins.right  * 2.83465;

    const elementWidthPx = (typeof AppState !== 'undefined' && AppState.config && AppState.config.previewWidth) || 820;
    const contentWidthPt  = PAGE_WIDTH_PT  - marginLeft - marginRight;
    const contentHeightPt = PAGE_HEIGHT_PT - marginTop  - marginBottom;

    // スケール係数: 1px が何pt か
    const scalePxToPt = contentWidthPt / elementWidthPx;

    // コンテンツ領域の高さ (px)
    return contentHeightPt / scalePxToPt;
};

/**
 * [SHARED] プレビューの改ページ位置（y座標）の配列を返す共有関数。
 *
 * buildSlides() と全く同じフロー（stamp → clone → PageSplitter）で動作するため
 * 実際のスライド表示と完全に一致した改ページ位置が得られる。
 *
 * [仕組み]
 * 1. ライブプレビューの全要素に data-original-top (offsetTop) を記録
 * 2. プレビューをクローンして PageSplitter.splitToPages() に渡す
 * 3. ページ2以降の先頭要素が保持する data-original-top をライブDOMの位置として返す
 *    ※ PageSplitterが要素を分割しても、移動した子要素が data-original-top を保持する
 *
 * @param {Element} element - DOM.preview 要素（ライブDOM）
 * @param {number}  pageHeightPx   - getSlidePageHeightPx() の値
 * @param {number}  elementWidthPx - コンテンツ幅 (px)
 * @returns {Promise<number[]>} 各改ページのy座標配列（#preview 基点の offsetTop 値）
 */
window.getPageBreakTopPositions = async function(element, pageHeightPx, elementWidthPx) {
    if (!element || element.scrollHeight === 0) return [];

    /**
     * 要素の #preview 基点の絶対 top 座標を計算する。
    /**
     * ページ内で要素の正確な絶対 Y 座標を取得する。
     * offsetTop ではネストされたコンテナや flex、マージン相殺によりズレが生じるため
     * getBoundingClientRect() を用いてサブピクセル精度で計算する。
     */
    function getAbsoluteTop(el) {
        if (!el || !element) return 0;
        const elRect = el.getBoundingClientRect();
        const containerRect = element.getBoundingClientRect();
        // containerからの相対位置＋現在のスクロール量（element自体がスクロールコンテナの場合）
        return (elRect.top - containerRect.top) + element.scrollTop;
    }

    // [CRITICAL] クローン前にライブDOMで計測し属性として記録（buildSlides と同じ）
    let countTopSet = 0;
    element.querySelectorAll('*').forEach(el => {
        const h = el.offsetHeight || el.scrollHeight;
        const w = el.offsetWidth || el.scrollWidth;
        if (h > 0) el.setAttribute('data-original-height', h);
        if (w > 0) el.setAttribute('data-original-width', w);
        // [FIX] offsetParentを遡った絶対座標を記録（table内のtr/td対応）
        const topVal = getAbsoluteTop(el);
        el.setAttribute('data-original-top', topVal);
        countTopSet++;
    });
    // console.log(`[getPageBreakTopPositions] Assigned data-original-top to ${countTopSet} elements`);

    const cloned = element.cloneNode(true);
    const pages = await PageSplitter.splitToPages(cloned, pageHeightPx, elementWidthPx);
    // console.log(`[getPageBreakTopPositions] splitToPages returned ${pages.length} pages`);

    /**
     * ページの「開始位置」を示す要素を返す。
     *
     * [背景] PageSplitter はテーブルやリストを分割する際に
     * nextTable/nextList をコンテナとして cloneNode(false) で生成する。
     * これらは元の要素の data-original-top（テーブル先頭の座標）を
     * そのまま引き継ぐため、テーブルの途中で改ページした場合でも
     * querySelector('[data-original-top]') がテーブル先頭位置を返してしまう。
     *
     * 対策: ページ先頭要素がコンテナ（TABLE/UL/OL）なら、
     * 分割で実際に移動された最初の「行/項目」要素を探す。
     */
    function findBreakStartElement(page) {
        const firstEl = page.firstElementChild;
        if (!firstEl) return null;

        // テーブル分割の場合: tbody の最初の TR（thead 行を除く）
        if (firstEl.tagName === 'TABLE') {
            const tbody = firstEl.querySelector('tbody');
            if (tbody) {
                const firstBodyRow = tbody.querySelector('tr[data-original-top]');
                if (firstBodyRow) return firstBodyRow;
            }
            // tbody なし（直下にTRがある）場合は thead 行を除いた最初の TR
            const theadRows = new Set(
                Array.from(firstEl.querySelectorAll('thead tr'))
            );
            for (const row of firstEl.querySelectorAll('tr[data-original-top]')) {
                if (!theadRows.has(row)) return row;
            }
        }

        // リスト分割の場合: 最初の LI
        if (firstEl.tagName === 'UL' || firstEl.tagName === 'OL') {
            const firstLi = firstEl.querySelector('li[data-original-top]');
            if (firstLi) return firstLi;
        }

        // DETAILS分割の場合: SUMMARY以外の最初の要素
        if (firstEl.tagName === 'DETAILS') {
            // もし DETAILS がクリッピングのラッパーを含んでいれば、それを返す
            const wrapper = firstEl.querySelector('.page-split-clipping-wrapper');
            if (wrapper) {
                const inner = wrapper.querySelector('[data-original-top]');
                if (inner) return inner;
            }
            
            // それ以外の場合はSUMMARY以外の最初の要素
            for (const child of firstEl.children) {
                if (child.tagName !== 'SUMMARY') {
                    const inner = child.querySelector('[data-original-top]');
                    if (inner) return inner;
                    if (child.hasAttribute('data-original-top')) return child;
                }
            }
        }

        // ラッパー直下の場合
        if (firstEl.classList.contains('page-split-clipping-wrapper')) {
            const inner = firstEl.querySelector('[data-original-top]');
            if (inner) return inner;
        }

        // その他: 最初の [data-original-top] 要素
        return page.querySelector('[data-original-top]');
    }

    // ページ2以降について、先頭要素の data-original-top を収集
    const positions = [];
    for (let i = 1; i < pages.length; i++) {
        const page = pages[i];
        const startEl = findBreakStartElement(page);
        if (startEl) {
            let top = parseFloat(startEl.getAttribute('data-original-top'));
            
            // [FIX] クリッピング分割されている要素の場合、分割されたオフセット分を足す
            if (startEl.dataset && startEl.dataset.splitOffset) {
                let offset = parseFloat(startEl.dataset.splitOffset);
                if (!isNaN(offset)) {
                    // スライド用コンテナで幅が変わってスケールされた画像のオフセットを、
                    // Live DOM（現在のプレビュー表示）の比率に合わせて逆算する
                    let scaleDebug = "No scale";
                    if (startEl.dataset.originalHeight && startEl.dataset.splitMeasureHeight) {
                        const originalH = parseFloat(startEl.dataset.originalHeight); // Live DOM (preview) height
                        const measureH = parseFloat(startEl.dataset.splitMeasureHeight); // Slide DOM height
                        if (measureH > 0 && originalH > 0 && originalH !== measureH) {
                            const ratio = originalH / measureH;
                            scaleDebug = `Scaled ${offset} * ${ratio.toFixed(3)} = ${offset * ratio}`;
                            offset = offset * ratio;
                        } else {
                            scaleDebug = `Identical H (${originalH} vs ${measureH})`;
                        }
                    }
                    // console.log(`[Slide Offset] Page=${i+1}, tagName=${startEl.tagName}, origTop=${top}, baseOffset=${startEl.dataset.splitOffset}, ${scaleDebug}, finalOffset=${offset}`);
                    top += offset;
                }
            } else {
                // console.log(`[Slide Offset] Page=${i+1}, tagName=${startEl.tagName}, origTop=${top}, No splitOffset attached.`);
            }

            if (!isNaN(top) && top >= 0) {
                positions.push(top);
            } else {
                console.warn(`[Slide Offset] Page=${i+1} INVALID top: ${top}`);
            }
        } else {
            // console.warn(`[Slide Offset] Page=${i+1} findBreakStartElement returned NULL! page.innerHTML starts with ${page.innerHTML.substring(0, 50)}`);
        }
    }
    // console.log(`[getPageBreakTopPositions] returning ${positions.length} positions:`, positions);
    return positions;
};

const SlideManager = {
    overlay: null,
    container: null,
    content: null,
    pageInfo: null,

    slides: [],
    currentIndex: 0,
    isActive: false,
    lastWheelTime: 0, // マウスホイールの連続発火を防ぐためのタイムスタンプ

    // A4横サイズ (単位: pt) -> 841.89 x 595.28 pt
    PAGE_WIDTH_PT: 841.89,
    PAGE_HEIGHT_PT: 595.28,

    init() {
        this.createDOM();
        this.bindEvents();
    },

    createDOM() {
        // オーバーレイ作成
        this.overlay = document.createElement('div');
        this.overlay.id = 'slideshow-overlay';
        this.overlay.className = 'slideshow-overlay hidden';

        // ナビゲーション（前）
        const navPrev = document.createElement('button');
        navPrev.className = 'slideshow-nav prev';
        navPrev.innerHTML = '&#10094;';
        navPrev.onclick = (e) => { e.stopPropagation(); this.prevSlide(); };
        navPrev.title = "前のページ (←, Backspace)";

        // スライドコンテナ
        this.container = document.createElement('div');
        this.container.id = 'slideshow-container';
        this.container.className = 'slideshow-container';

        // スライドコンテンツ
        this.content = document.createElement('div');
        this.content.id = 'slideshow-content';
        this.content.className = 'slideshow-content md-preview';
        this.container.appendChild(this.content);

        // ナビゲーション（次）
        const navNext = document.createElement('button');
        navNext.className = 'slideshow-nav next';
        navNext.innerHTML = '&#10095;';
        navNext.onclick = (e) => { e.stopPropagation(); this.nextSlide(); };
        navNext.title = "次のページ (→, Space, Enter)";

        // 閉じるボタン
        const closeBtn = document.createElement('button');
        closeBtn.id = 'slideshow-close-btn';
        closeBtn.innerHTML = '✖ <span data-i18n="dialog.close">閉じる</span>';
        closeBtn.onclick = (e) => { e.stopPropagation(); this.closeSlideshow(); };
        closeBtn.title = "閉じる (Esc)";

        // ページ番号
        this.pageInfo = document.createElement('div');
        this.pageInfo.id = 'slideshow-page-info';

        // 組み立て
        this.overlay.appendChild(navPrev);
        this.overlay.appendChild(this.container);
        this.overlay.appendChild(navNext);
        this.overlay.appendChild(closeBtn);
        this.overlay.appendChild(this.pageInfo);

        document.body.appendChild(this.overlay);

        // コンテナクリックで次へ進む
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                // 背景クリックでも次へ進むようにするか（今回は何もしない）
            } else {
                this.nextSlide();
            }
        });

        // 右クリックで次へ進む
        this.overlay.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.nextSlide();
        });

        // マウスホイールで前後のページへ移動する
        this.overlay.addEventListener('wheel', (e) => {
            if (!this.isActive) return;

            const now = Date.now();
            // 連続スクロールで一気にページが飛ぶのを防ぐためのクールタイム (300ms)
            if (now - this.lastWheelTime < 300) return;

            if (e.deltaY > 0) {
                // 下スクロール -> 次のページ
                this.nextSlide();
                this.lastWheelTime = now;
            } else if (e.deltaY < 0) {
                // 上スクロール -> 前のページ
                this.prevSlide();
                this.lastWheelTime = now;
            }
        });

        // 画面リサイズに対応
        window.addEventListener('resize', () => {
            if (this.isActive) this.updateLayout();
        });
    },

    bindEvents() {
        // キーボード操作は isActive 時のみ capture フェーズでフック
        document.addEventListener('keydown', (e) => {
            if (!this.isActive) return;

            // スライド操作に関連するキーのリスト
            const isSlideKey = ['Escape', 'ArrowRight', 'Space', 'Enter', 'ArrowLeft', 'Backspace'].includes(e.code);
            
            if (isSlideKey) {
                e.preventDefault();
                e.stopImmediatePropagation();

                switch (e.code) {
                    case 'Escape':
                        this.closeSlideshow();
                        return;
                    case 'ArrowRight':
                    case 'Space':
                    case 'Enter':
                        this.nextSlide();
                        break;
                    case 'ArrowLeft':
                    case 'Backspace':
                        this.prevSlide();
                        break;
                }
            }
        }, true);

        // ブラウザのフルスクリーン状態の変更（Escキーによるネイティブな解除など）を監視
        document.addEventListener('fullscreenchange', () => {
            if (this.isActive && !document.fullscreenElement) {
                // フルスクリーンが解除されたらスライドショーも終了する（通常画面に戻る）
                this.closeSlideshow();
            }
        });
    },

    /**
     * スライドショーを開始する
     * @param {boolean} fullscreen - 全画面表示（OSレベル最大化またはHTML5 Fullscreen API）
     */
    async openSlideshow(fullscreen = false) {
        console.log(`[SlideManager] openSlideshow called. Fullscreen: ${fullscreen}`);
        if (!DOM.preview) {
            console.error("[SlideManager] DOM.preview is missing!");
            return;
        }

        // 1. 直ちに Fullscreen API の呼び出しと 初期UI の構築を行う
        // （ユーザーアクション[F10]から1秒以上経過するとFullscreen権限が期限切れになるため）
        if (fullscreen) {
            if (window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow) {
                try {
                    const currentWindow = window.__TAURI__.window.getCurrentWindow();
                    await currentWindow.setFullscreen(true);
                } catch (e) {
                    console.warn("Tauri setFullscreen failed:", e);
                }
            } else if (document.documentElement.requestFullscreen) {
                try {
                    await document.documentElement.requestFullscreen();
                } catch (e) {
                    console.warn("Fullscreen API failed:", e);
                }
            }
        }

        this.isActive = true;
        document.body.classList.add('slideshow-active');
        document.documentElement.classList.add('slideshow-active');
        this.overlay.classList.remove('hidden');

        // ウィンドウモードでもコンテナサイズを確定させるため先にレイアウト更新
        this.updateLayout();

        // ローディング（砂時計）表示の反映
        document.body.style.cursor = 'wait';
        const contentContainer = document.getElementById('slideshow-content');
        if (contentContainer) {
            contentContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#888; font-size:24px;">スライドを生成中...お待ちください</div>';
        }

        // UIの反映を確実にするため少しだけ非同期待機（ペイントを許容）
        await new Promise(resolve => setTimeout(resolve, 50));

        // 2. スライドデータの生成
        console.time("[SlideManager] BuildSlides Time");

        // スライドの向きを反映 (A4縦: 595.28 x 841.89 pt, A4横: 841.89 x 595.28 pt)
        const orientation = (typeof AppState !== 'undefined' && AppState.config && AppState.config.slideOrientation) || 'landscape';
        if (orientation === 'portrait') {
            this.PAGE_WIDTH_PT = 595.28;
            this.PAGE_HEIGHT_PT = 841.89;
        } else {
            this.PAGE_WIDTH_PT = 841.89;
            this.PAGE_HEIGHT_PT = 595.28;
        }

        try {
            await this.buildSlides();
        } catch (err) {
            console.error("[SlideManager] Critical error in buildSlides:", err);
            document.body.style.cursor = '';
            if (typeof showToast === 'function') showToast("スライド生成中にエラーが発生しました", "error");
            this.closeSlideshow();
            return;
        }
        console.timeEnd("[SlideManager] BuildSlides Time");

        document.body.style.cursor = ''; // ローディング終了

        if (this.slides.length === 0) {
            console.warn("[SlideManager] No slides generated.");
            if (typeof showToast === 'function') showToast("スライドするコンテンツがありません", "warning");
            this.closeSlideshow();
            return;
        }

        console.log(`[SlideManager] ${this.slides.length} slides ready.`);
        this.currentIndex = 0;

        // 3. UI表示
        this.updateLayout();
        this.renderCurrentSlide();
    },

    /**
     * スライドショーを終了する
     */
    async closeSlideshow() {
        if (!this.isActive) return;

        this.isActive = false;
        document.body.classList.remove('slideshow-active');
        document.documentElement.classList.remove('slideshow-active');
        this.overlay.classList.add('hidden');
        this.content.innerHTML = ''; // クリア

        // Fullscreen解除
        if (document.fullscreenElement) {
            try {
                // ブラウザ側のフルスクリーン解除
                await document.exitFullscreen();
            } catch (e) {
                console.warn("Exit Fullscreen API failed:", e);
            }
        } else if (window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow) {
            try {
                // Tauri側の全画面解除
                const currentWindow = window.__TAURI__.window.getCurrentWindow();
                const isFullscreen = await currentWindow.isFullscreen();
                if (isFullscreen) {
                    await currentWindow.setFullscreen(false);
                }
            } catch (e) {
                console.warn("Tauri setFullscreen(false) failed:", e);
            }
        }
    },

    /**
     * PDFのページ分割ロジックを流用してスライドDOMの配列を生成する
     */
    async buildSlides() {
        this.slides = [];
        const element = DOM.preview;
        if (!element) return;

        const totalHeightPx = element.scrollHeight;
        console.log(`[SlideManager] buildSlides: scrollHeight=${totalHeightPx}px, children=${element.children.length}`);
        if (totalHeightPx === 0) return;

        // [REFACTORED] ページ高さの計算を共有関数に委譲（プレビュー改ページ表示との一致を保証）
        const elementWidthPx = AppState.config.previewWidth || element.offsetWidth || 820;
        const pageHeightPx = window.getSlidePageHeightPx();

        // 共通エンジン(PageSplitter)でページごとにDOM要素を分割
        // ※ PageSplitterは内部で要素の移動（破壊的変更）を行うため、必ずプレビューの複製を渡す

        // [CRITICAL] クローン前（ライブ状態）に各要素の高さを計測し、属性として記録。
        // これによりPageSplitter側で計測不能（0pxなど）になるのを防ぐ。
        // ネストされた要素（DETAILSの中など）にも対応するため、全子孫を対象とする。
        element.querySelectorAll('*').forEach(el => {
            const h = el.offsetHeight || el.scrollHeight;
            const w = el.offsetWidth || el.scrollWidth;
            if (h > 0) el.setAttribute('data-original-height', h);
            if (w > 0) el.setAttribute('data-original-width', w);
        });

        const clonedPreview = element.cloneNode(true);
        console.log(`[SlideManager] Starting PageSplitter.splitToPages... PageHeight: ${pageHeightPx.toFixed(2)}px`);
        this.slides = await PageSplitter.splitToPages(clonedPreview, pageHeightPx, elementWidthPx);
        console.log(`[SlideManager] PageSplitter finished. Created ${this.slides.length} slides.`);

        // 分割時に利用したDOM幅とページ高さを保存（レイアウト計算用）
        this.elementWidthPx = elementWidthPx;
        this.pageHeightPx = pageHeightPx;

        if (this.slides.length === 0) {
            // 最低1ページは確保
            const emptyPage = document.createElement('div');
            emptyPage.className = element.className;
            this.slides.push(emptyPage);
        }
    },

    updateLayout() {
        if (!this.isActive) return;

        // ブラウザのウィンドウ・画面サイズアスペクト比に合わせてコンテナを最大化
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        console.log(`[SlideManager] updateLayout: Window ${windowWidth}x${windowHeight}`);

        // A4横の比率
        const targetRatio = this.PAGE_WIDTH_PT / this.PAGE_HEIGHT_PT;
        const windowRatio = windowWidth / windowHeight;

        let containerW, containerH;

        // 10%のパディングを画面周囲に設ける（全画面なら少し小さくてもOK）
        const padding = 40;
        const availableW = windowWidth - padding * 2;
        const availableH = windowHeight - padding * 2;

        if (windowRatio > targetRatio) {
            // Container height constrained by window height
            containerH = availableH;
            containerW = containerH * targetRatio;
        } else {
            // Container width constrained by window width
            containerW = availableW;
            containerH = containerW / targetRatio;
        }

        this.container.style.width = `${containerW}px`;
        this.container.style.height = `${containerH}px`;
        this.container.style.position = 'relative';

        // マージンを取得 (pt単位)
        const margins = AppState.config.pdfMargins || { top: 10, bottom: 10, left: 10, right: 10 };
        const mTop = margins.top * 2.83465;
        const mBottom = margins.bottom * 2.83465;
        const mLeft = margins.left * 2.83465;
        const mRight = margins.right * 2.83465;

        // スケール変換係数の逆算（1pxが何ptか）: buildSlidesのロジックと同じ
        const contentWidthPt = this.PAGE_WIDTH_PT - mLeft - mRight;
        const scalePxToPt = contentWidthPt / this.elementWidthPx;

        // 紙全体のDOM座標系でのピクセルサイズ (論理ピクセル)
        const paperWidthPx = this.PAGE_WIDTH_PT / scalePxToPt;
        const paperHeightPx = this.PAGE_HEIGHT_PT / scalePxToPt;

        // マージンのDOM座標系での論理ピクセルサイズ
        const pxLeft = mLeft / scalePxToPt;
        const pxTop = mTop / scalePxToPt;

        // コンテナ領域(containerW/H) に紙を表すDIV(paperWidthPx/HeightPx)をぴったり合わせるためのスケール
        const paperScale = containerW / paperWidthPx;

        // 紙全体のコンテナに対するスタイル適用
        Object.assign(this.content.style, {
            width: `${paperWidthPx}px`,  // 紙の論理幅
            height: `${paperHeightPx}px`, // 紙の論理高さ
            position: 'absolute',
            top: '0',
            left: '0',
            transformOrigin: 'top left',
            transform: `scale(${paperScale})`, // 画面サイズに合わせて拡縮
            background: 'var(--bg)', // 背景色
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)', // 紙のような影
            boxSizing: 'border-box'
        });

        // スライド内の子要素（md-previewコンテナ）を紙の中のマージン開始位置に配置
        const slideDOM = this.slides[this.currentIndex];
        if (slideDOM) {
            Object.assign(slideDOM.style, {
                width: `${this.elementWidthPx}px`,
                height: `${this.pageHeightPx}px`,
                position: 'absolute',
                top: `${pxTop}px`,
                left: `${pxLeft}px`,
                transform: 'none', // 内側要素に対する更なるスケール補正は不要
                transformOrigin: 'top left',
                boxSizing: 'border-box'
            });
        }
    },

    renderCurrentSlide() {
        if (!this.isActive || this.slides.length === 0) return;

        // ページDOMの差し替え
        this.content.innerHTML = ''; // クリア
        const slideDOM = this.slides[this.currentIndex];
        if (slideDOM) {
            this.content.appendChild(slideDOM);
        }

        // レイアウト更新（スケールと表示位置再計算、ここでslideDOMにもスタイルが当たる）
        this.updateLayout();

        // ページ番号更新
        this.pageInfo.textContent = `${this.currentIndex + 1} / ${this.slides.length}`;
    },

    nextSlide() {
        if (this.currentIndex < this.slides.length - 1) {
            this.currentIndex++;
            this.renderCurrentSlide();
        }
    },

    prevSlide() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.renderCurrentSlide();
        }
    }
};

// 初期化（DOMContentLoaded内などで呼ばれる想定）
document.addEventListener('DOMContentLoaded', () => {
    SlideManager.init();
});

// グローバル公開
window.openSlideshow = (fullscreen) => SlideManager.openSlideshow(fullscreen);
window.closeSlideshow = () => SlideManager.closeSlideshow();
