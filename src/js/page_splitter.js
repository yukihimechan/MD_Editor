/**
 * page_splitter.js
 * 
 * MarkdownのプレビューDOMを指定された高さ（ページサイズ）ごとに分割し、
 * コンテナの配列として出力する汎用エンジン。
 */
const PageSplitter = {
    /**
     * 指定したコンテナが実質的に空（要素がない、かつ非空白テキストがない）かを判定する
     */
    _isEffectivelyEmpty(containerOrNodes) {
        if (!containerOrNodes) return true;
        const nodes = containerOrNodes.childNodes ? Array.from(containerOrNodes.childNodes) : (Array.isArray(containerOrNodes) ? containerOrNodes : []);
        return !nodes.some(n =>
            n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)
        );
    },

    /**
     * @param {HTMLElement} sourceElement - コピー元の要素
     * @param {number} pageHeightPx - 1ページあたりの最大高さ（ピクセル）
     * @param {number} pageWidthPx - 描画基準となるDOMの幅（指定がない場合はsourceElementから取得、任意）
     * @returns {Promise<HTMLElement[]>} 分割されたページコンテナ要素の配列
     */
    async splitToPages(sourceElement, pageHeightPx, pageWidthPx = null) {
        const widthPx = pageWidthPx || sourceElement.offsetWidth || 820;
        // console.log(`[PageSplitter] splitToPages starting. Source: ${sourceElement.tagName}, PageHeight: ${pageHeightPx}px, Width: ${widthPx}px`);
        const pages = [];

        // 計測用のコンテナを配置。
        // [IMPORTANT] visibility: hidden を使うことで、表示はされないがレイアウト（高さ）の計算が行われる状態にする。
        // 計測を確実にするため、常に有効なレイアウトを持つ document.body 直下を利用。
        const measureContainer = document.createElement('div');
        measureContainer.className = sourceElement.className;
        Object.assign(measureContainer.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: `${widthPx}px`,
            height: 'auto',
            visibility: 'hidden', // layoutを維持しつつ隠す
            pointerEvents: 'none',
            zIndex: '-9999',
            padding: '0',
            margin: '0',
            display: 'block',
        });
        document.body.appendChild(measureContainer);

        try {
            let currentPage = this.createNewPageContainer(sourceElement);
            measureContainer.appendChild(currentPage);

            // 全ての子要素を配列化してループ（分割により途中で増えるためwhileを利用）
            const children = Array.from(sourceElement.childNodes);
            let loopCount = 0;
            const MAX_LOOPS = 5000;

            // 全ての DETAILS を開く（計測用）
            sourceElement.querySelectorAll('details').forEach(d => d.open = true);

            while (children.length > 0) {
                loopCount++;
                if (loopCount > MAX_LOOPS) {
                    // console.error("[PageSplitter] MAX_LOOPS exceeded. Breaking to prevent freeze.");
                    break;
                }

                // UIフリーズを避けるため定期的にメインスレッドを解放する
                if (loopCount % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                const child = children.shift(); // 先頭から取り出して処理

                // 空白のテキストノードなどは高さを増やさないためそのまま追加
                if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length === 0) {
                    currentPage.appendChild(child);
                    continue;
                }

                // --- 1. <hr> による強制改ページ判定 ---
                if (AppState.config.pageBreakOnHr && child.tagName === 'HR') {
                    const hasElements = !this._isEffectivelyEmpty(currentPage);
                    if (hasElements) {
                        pages.push(currentPage.cloneNode(true));
                        // console.log(`[PageSplitter] Page ${pages.length} fixed (HR break).`);
                        currentPage.innerHTML = '';
                    }
                    continue; // HR自体はページに入れない
                }

                currentPage.appendChild(child);

                let heightAfter = currentPage.offsetHeight;

                // [CRITICAL FALLBACK] もし offsetHeight が 0 の場合（コンテナが隠れているなど）、
                // 事前に記録した属性値（SlideManagerで付与）を利用して擬似的に高さを計算する。
                const usedFallback = (heightAfter === 0);
                if (usedFallback) {
                    heightAfter = Array.from(currentPage.childNodes).reduce((acc, node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const h = parseFloat(node.getAttribute('data-original-height') || "0") || node.offsetHeight;
                            return acc + h;
                        }
                        return acc;
                    }, 0);
                }

                // [DEBUG] 全要素の追加後高さを記録（SVG/IMG の計測が正しいか確認）
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const tag = child.tagName || '?';
                    const childOffH = child.offsetHeight;
                    const childDataH = child.getAttribute ? child.getAttribute('data-original-height') : null;
                    // console.log(\`[PageSplitter][Loop] tag=<${tag}>, childOffsetH=${childOffH}px, data-original-height=${childDataH}, heightAfter=${heightAfter.toFixed(1)}px, pageH=${pageHeightPx.toFixed(1)}px, fallback=${usedFallback}, overflow=${heightAfter > pageHeightPx}\`);
                }

                if (heightAfter > pageHeightPx) {
                    // child 自体の高さを取得（現在の DOM にある実態の高さを最優先）
                    const childH = child.offsetHeight;

                    const heightBefore = heightAfter - (childH || 0);
                    const available = Math.max(0, pageHeightPx - heightBefore);

                    // console.log(`[PageSplitter] Page overflow. HeightBefore: ${heightBefore.toFixed(1)}px, Available: ${available.toFixed(1)}px`);

                    const overflowedNode = await this.splitElement(child, available, currentPage, pageHeightPx);

                    if (overflowedNode) {
                        if (overflowedNode === child) {
                            // まるごと次ページへ送られる要素（見出し・SVG等、分割できなかった要素）
                            // シンプルに現在のページを確定し、この要素を次ページ先頭へ
                            children.unshift(overflowedNode);

                            if (!this._isEffectivelyEmpty(currentPage)) {
                                pages.push(currentPage.cloneNode(true));
                            }
                            currentPage.innerHTML = '';
                        } else {
                            // 要素の一部がこのページに残り、残りが overflowedNode として返ってきた
                            children.unshift(overflowedNode);

                            if (!this._isEffectivelyEmpty(currentPage)) {
                                pages.push(currentPage.cloneNode(true));
                                // console.log(`[PageSplitter] Page ${pages.length} fixed (split element).`);
                            }
                            currentPage.innerHTML = '';
                        }
                    } else {
                        // console.log("[PageSplitter] Element did not split, assumed to fit or error.");
                        if (!this._isEffectivelyEmpty(currentPage)) {
                            pages.push(currentPage.cloneNode(true));
                            // console.log(`[PageSplitter] Page ${pages.length} fixed (element fit after all).`);
                        }
                        currentPage.innerHTML = '';
                    }
                }
            }

            // 最後のページが空でなければ追加
            if (currentPage.childNodes.length > 0) {
                pages.push(currentPage.cloneNode(true));
            }

        } finally {
            if (measureContainer && measureContainer.parentNode) {
                measureContainer.parentNode.removeChild(measureContainer);
            }
        }

        // console.log(`[PageSplitter] Finished splitting. Total pages: ${pages.length}`);
        return pages;
    },

    createNewPageContainer(sourceElement) {
        const page = document.createElement('div');
        page.className = sourceElement.className;
        page.style.width = '100%';
        // 不要なマージンや計測誤差によるスクロールバーを徹底排除
        page.style.boxSizing = 'border-box';
        page.style.overflow = 'hidden';
        // [REVERT] ページ全体のパディングは解除し、SVG要素個別に適用する方針に変更
        page.style.paddingLeft = '0';
        page.style.paddingRight = '0';
        return page;
    },

    /**
     * ページ高さを超えた要素を分割し、現在のページに残す部分と、次ページに送る部分に分ける。
     * @param {HTMLElement} element - 分割対象の要素
     * @param {number} maxHeight - 現在のページ内で許容される最大高さ
     * @param {HTMLElement} container - 現在のページコンテナ
     * @returns {Promise<HTMLElement|null>} 次のページに送られるべき残りの要素（DOM）
     */
    async splitElement(element, maxHeight, container, pageHeightPx) {
        const tagName = element.tagName;

        // [NEW] DETAILS 要素は開いた状態で計測・分割する必要がある
        if (tagName === 'DETAILS') {
            element.open = true;
        }
        const upperTagName = tagName ? tagName.toUpperCase() : '';
        // console.log(\`[PageSplitter] splitElement: <${upperTagName}>, MaxHeight: ${maxHeight.toFixed(1)}px, containerH: ${container.offsetHeight.toFixed(1)}px / ${pageHeightPx.toFixed(1)}px\`);
        // オプショナルチェーンを使用して TypeError を回避
        const isCodeWrapper = element.classList?.contains('code-block-wrapper');

        // [NEW] コードブロックの場合、操作パネルを事前に取得しておく
        let controls = null;
        if (isCodeWrapper) {
            controls = element.querySelector('.code-controls');
        }

        // [NEW] 水平方向がページ幅を超えている場合、モードに関わらずまず横幅に収まるよう縮小する
        // ページパディングは廃止処理済みのため、ページ幅全体を利用する
        const paddingBuffer = 0;
        const pageWidth = (container.offsetWidth || 820);
        const availableWidth = pageWidth - paddingBuffer;

        let elementWidth = 0;
        if (element.nodeType === Node.ELEMENT_NODE) {
            elementWidth = element.offsetWidth || (element.getBoundingClientRect().width);
        }

        if (elementWidth > availableWidth && elementWidth > 0) {
            // console.log(`[PageSplitter] Element width (${elementWidth}px) exceeds available width (${availableWidth}px). Scaling down.`);
            // 縮小時に1.3倍等の拡大補正をかけるとページ幅を超えてクリッピングされるため、正確な縮小率のみを使用する
            const horizontalScale = Math.min((availableWidth / elementWidth), 1.0);
            
            // [FIX] P タグなどのインラインテキストが含まれる標準ブロックには transform scale を使わずに自然な折り返しを促す
            const nonScaleTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'];
            if (nonScaleTags.includes(tagName)) {
                element.style.maxWidth = '100%';
                element.style.boxSizing = 'border-box';
                element.style.overflowWrap = 'anywhere';
                element.style.wordBreak = 'break-word';
            } else {
                element.style.transformOrigin = 'top left'; // Leftに戻す（paddingで右にずれるため）
                element.style.transform = `scale(${horizontalScale})`;
                element.style.width = '100%';
                element.style.display = 'block';
            }
        }

        if (tagName === 'DETAILS') {
            return await this.splitDetails(element, maxHeight, container, pageHeightPx);
        }

        // テーブルの特別対応 (行単位で分割、thead複製)
        if (tagName === 'TABLE') {
            return await this.splitTable(element, maxHeight, container, pageHeightPx);
        }

        // リスト(UL/OL)の対応 (LI単位で分割)
        if (tagName === 'UL' || tagName === 'OL') {
            return await this.splitList(element, maxHeight, container, pageHeightPx);
        }

        // 分割不可な要素（SVG、画像を含む要素など）
        // ※ 構造要素（TABLE等の）子孫として画像が含まれる場合、ここで親ごとクリップされるのを防ぐため、
        // 構造要素の判定を優先し、その上でテキストブロックや汎用コンテナに対してこの制限をかける。
        const hasSvg = tagName === 'SVG' || element.querySelector('svg') !== null;
        const hasImg = tagName === 'IMG' || element.querySelector('img') !== null;
        if (hasSvg || hasImg) {
            // console.log(\`[PageSplitter][Image] 画像/SVG検出 -> クリッピング分割へ。tag=${upperTagName}, hasSvg=${hasSvg}, hasImg=${hasImg}, maxHeight=${maxHeight.toFixed(1)}px\`);
            // クリッピングによる分割で画像を複数ページにまたがって表示する
            return await this.splitUnbreakableElementByClipping(element, maxHeight, container, pageHeightPx);
        }

        // 一般的なブロック要素のテキスト単位での分割
        const result = await this.splitTextNodeBlock(element, maxHeight, container, pageHeightPx);

        // [CRITICAL] 修正: isCodeWrapper の場合も行番号の再構成を行う
        if ((tagName === 'PRE' || isCodeWrapper) && AppState.config.lineNumbers) {
            this.reconstructLineNumbers(element, result);
        }

        // [NEW] コードブロックの操作パネル対応
        // wrapper が分割された場合、controls を全ページに複製・維持する
        if (isCodeWrapper && controls) {
            // 1ページ目(element)に controls が無くなっていたら戻す（splitTextNodeBlockでクリアされるため）
            if (!element.querySelector('.code-controls')) {
                element.appendChild(controls.cloneNode(true));
            }
            // 2ページ目(result)にも controls を追加する
            if (result && result !== element && !result.querySelector('.code-controls')) {
                result.appendChild(controls.cloneNode(true));
            }
        }

        return result;
    },

    /**
     * 分割された（または処理された）PRE要素の行番号表示を再構成する
     */
    reconstructLineNumbers(element, result) {
        const updateGutter = (el, startNum) => {
            if (!el) return;

            // PRE要素を特定
            let pre = el;
            if (el.classList.contains('code-block-wrapper')) {
                pre = el.querySelector('pre');
            }
            if (!pre || pre.tagName !== 'PRE') return;

            // [CRITICAL] 独自描画のガターがあれば削除
            pre.querySelectorAll('.line-numbers-rows').forEach(r => r.remove());

            // Prism.js純正の行番号機能を利用するための設定
            pre.classList.add('line-numbers');
            pre.setAttribute('data-start', startNum);

            // スタイルをリセット（独自実装時のインライン指定を解除）
            pre.style.paddingLeft = '';
            pre.style.position = '';
            pre.style.overflowX = '';
            pre.style.counterReset = ''; // counter-resetもリセット

            const code = pre.querySelector('code');
            if (code && typeof Prism !== 'undefined') {
                try {
                    // Prism.js に再ハイライト（と行番号生成）を依頼
                    // ※ Prism.manual = true なので自動実行されないため手動で呼ぶ
                    Prism.highlightElement(code);
                } catch (e) {
                    // console.warn('[PageSplitter] Prism re-highlight failed:', e);
                }
            }
        };

        // 1ページ目の要素（またはwrapper）の行番号
        let preForAttr = element;
        if (element.classList.contains('code-block-wrapper')) preForAttr = element.querySelector('pre');
        const originalStart = (preForAttr && preForAttr.getAttribute('data-start')) ? parseInt(preForAttr.getAttribute('data-start'), 10) : 1;

        updateGutter(element, originalStart);

        // 2ページ目に分割された要素がある場合
        if (result && result !== element) {
            // 1ページ目の要素（またはwrapper内のpre）から行数を計算
            let pre1 = element;
            if (element.classList.contains('code-block-wrapper')) {
                pre1 = element.querySelector('pre');
            }

            const firstPageContent = (pre1 && pre1.querySelector('code')) ? pre1.querySelector('code').textContent : (pre1 ? pre1.textContent : "");
            const firstPageLines = firstPageContent.split('\n');
            if (firstPageLines.length > 0 && firstPageLines[firstPageLines.length - 1] === '') {
                firstPageLines.pop();
            }
            const nextStartNum = originalStart + firstPageLines.length;

            updateGutter(result, nextStartNum);
        }
    },

    /**
     * リスト要素の分割 (LI内テキスト分割方式)
     * LIが溢れた場合、LI内の文字単位で現在ページに収まる分だけ残し、
     * 残りを次ページのインデント付き継続テキストとして表示する。
     * ネストリスト（UL/OL）が溢れた場合は再帰的に分割する。
     */
    async splitList(element, maxHeight, container, pageHeightPx) {
        const isOl = element.tagName === 'OL';
        const items = Array.from(element.children).filter(node => node.tagName === 'LI');
        if (items.length === 0) {
            return await this.splitTextNodeBlock(element, maxHeight, container, pageHeightPx);
        }

        const nextList = element.cloneNode(false);
        // DOM階層は保持されるため、インデントの強制計算（accumulatedLeft）は二重インデントの原因となるため廃止。
        // 行頭記号スタイルのみ、念のため引き継ぐ（Markdown CSS等で指定されている場合への保険）
        if (element.parentNode) {
            const computedStyle = window.getComputedStyle(element);
            const listStyleType = computedStyle.listStyleType;
            if (listStyleType && listStyleType !== 'none') {
                nextList.style.listStyleType = listStyleType;
            }
        }
        items.forEach(li => element.removeChild(li));

        let splitIndex = 0;
        let isSplit = false;
        let liContinuation = null; // 分割されたLIの続きテキスト用要素

        for (let i = 0; i < items.length; i++) {
            if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

            const li = items[i];
            element.appendChild(li);

            if (container.offsetHeight > pageHeightPx) {
                const liHeight = li.offsetHeight || 0;
                element.removeChild(li);

                // [NEW] LI自体が1ページに収まるなら、LI内を細切れに分割せずLIごと次ページへ。
                // これによりインライン要素の泣き別れや文章の不自然な分断、改ページ線のズレを防ぐ。
                if (liHeight > 0 && liHeight <= pageHeightPx - 10) {
                    const validNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
                    if (validNodes.length <= 1 && i === 0) {
                        element.appendChild(li);
                        continue; // このLIは現在のページに留め、次の項目を処理
                    } else {
                        splitIndex = i;
                        isSplit = true;
                        for (let j = i; j < items.length; j++) {
                            nextList.appendChild(items[j]);
                        }
                        break;
                    }
                }

                // --- LIがページ高さを上回る巨大な場合のフォールバック（従来の子ノード分割）---
                const partialLi = li.cloneNode(false); // 空のLI（ガワのみ）
                element.appendChild(partialLi);
                const liChildNodes = Array.from(li.childNodes);
                let splitDone = false;

                for (let k = 0; k < liChildNodes.length; k++) {
                    const node = liChildNodes[k];
                    partialLi.appendChild(node);

                    if (container.offsetHeight > pageHeightPx) {
                        partialLi.removeChild(node);

                        if (node.nodeType === Node.TEXT_NODE && node.textContent.length > 40) {
                            // テキストノードで40文字以上なら文字単位の二分探索
                            const origText = node.textContent;
                            let left = 0, right = origText.length, bestFit = 0, loopCount = 0;
                            while (left <= right) {
                                if (++loopCount % 10 === 0) await new Promise(r => setTimeout(r, 0));
                                const mid = Math.floor((left + right) / 2);
                                node.textContent = origText.substring(0, mid);
                                partialLi.appendChild(node);
                                if (container.offsetHeight <= pageHeightPx) {
                                    bestFit = mid;
                                    left = mid + 1;
                                } else {
                                    right = mid - 1;
                                }
                                if (node.parentNode === partialLi) partialLi.removeChild(node);
                            }
                            node.textContent = origText;

                            // 継続テキスト要素を生成（マーカーなし）
                            liContinuation = document.createElement('li');
                            liContinuation.style.listStyleType = 'none';
                            liContinuation.style.marginTop = '0';
                            liContinuation.style.marginBottom = '0.5em';
                            if (bestFit > 0) {
                                partialLi.appendChild(document.createTextNode(origText.substring(0, bestFit)));
                                liContinuation.appendChild(document.createTextNode(origText.substring(bestFit)));
                            } else {
                                liContinuation.appendChild(node);
                            }
                            // 以降の子ノードも継続へ
                            for (let m = k + 1; m < liChildNodes.length; m++) {
                                liContinuation.appendChild(liChildNodes[m]);
                            }
                            splitDone = true;
                            break;

                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            // 要素ノードの場合：万能な splitElement に委譲して再帰的に分割
                            partialLi.appendChild(node);
                            const elementOverflow = await this.splitElement(node, maxHeight, container, pageHeightPx);
                            
                            if (elementOverflow) {
                                liContinuation = document.createElement('li');
                                liContinuation.style.listStyleType = 'none';
                                liContinuation.style.marginTop = '0';
                                liContinuation.style.marginBottom = '0.5em';
                                
                                if (elementOverflow !== node) {
                                    // 要素が綺麗に分割された場合
                                    liContinuation.appendChild(elementOverflow);
                                } else {
                                    // 1文字も入らず丸ごと溢れた場合
                                    if (node.parentNode === partialLi) {
                                        partialLi.removeChild(node);
                                    }
                                    liContinuation.appendChild(node);
                                }
                                
                                const remaining = liChildNodes.slice(k + 1);
                                remaining.forEach(n => liContinuation.appendChild(n));
                                
                                splitDone = true;
                                break; // 分割済み → kループを抜ける
                            }
                            // elementOverflow === null → 要素全体が収まった
                            // → kループを継続（次の兄弟ノードへ）
                            continue;
                        } else {
                            // その他の要素ノードまたは短いテキスト → マーカーなしの li に
                            liContinuation = document.createElement('li');
                            liContinuation.style.listStyleType = 'none';
                            liContinuation.style.marginTop = '0';
                            liContinuation.style.marginBottom = '0.5em';
                            liContinuation.appendChild(node);
                            // 以降の子ノードも継続へ
                            for (let m = k + 1; m < liChildNodes.length; m++) {
                                liContinuation.appendChild(liChildNodes[m]);
                            }
                        }

                        splitDone = true;
                        break;
                    }
                }

                // partialLiが空、あるいは空白テキストしか含まない場合（最初の子ノードですら入らない）→ LIごと次ページへ
                // liContinuationにLIの子ノードが移されている場合、li に戻してから nextList へ追加する
                const isVisuallyEmpty = Array.from(partialLi.childNodes).every(n => 
                    n.nodeType === Node.TEXT_NODE && n.textContent.trim() === ''
                );
                
                if (isVisuallyEmpty) {
                    // もし現在のページが空なのにこれ以上入らない場合（巨大な分割不可要素などの場合）、
                    // 無限ループを防ぐために最初の要素を限界を超えてでも強制的に1つ残す
                    const validNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
                    if (validNodes.length <= 1 && i === 0) {
                        element.appendChild(partialLi);
                        if (liChildNodes.length > 0) {
                            partialLi.appendChild(liChildNodes[0]);
                            liContinuation = document.createElement('li');
                            liContinuation.style.listStyleType = 'none';
                            liContinuation.style.marginTop = '0';
                            liContinuation.style.marginBottom = '0.5em';
                            for (let m = 1; m < liChildNodes.length; m++) {
                                liContinuation.appendChild(liChildNodes[m]);
                            }
                        }
                        splitIndex = 1;
                        isSplit = true;
                        for (let j = 1; j < items.length; j++) {
                            nextList.appendChild(items[j]);
                        }
                        break;
                    }

                    element.removeChild(partialLi);
                    // partialLiに残っていた空白ノード等を元に戻す
                    while (partialLi.firstChild) {
                        li.appendChild(partialLi.firstChild);
                    }
                    // liContinuation に移動した子ノードを li に戻す
                    if (liContinuation) {
                        while (liContinuation.firstChild) {
                            li.appendChild(liContinuation.firstChild);
                        }
                        liContinuation = null;
                    }
                    for (let j = i; j < items.length; j++) {
                        nextList.appendChild(items[j]);
                    }
                    isSplit = true;
                    splitIndex = i;
                    break;
                }

                splitIndex = i + 1;
                isSplit = true;
                for (let j = i + 1; j < items.length; j++) {
                    nextList.appendChild(items[j]);
                }
                break;
            }
        }

        // OLの場合は通し番号を維持
        if (isOl && isSplit) {
            const startVal = parseInt(element.getAttribute('start')) || 1;
            // liContinuationが存在する場合（前ページから続く項目がある場合）、
            // その継続LIが不可視のマーカーとして1つ分の番号を消費するため、開始番号を1つ戻す補正を行う
            const nextStart = liContinuation ? startVal + splitIndex - 1 : startVal + splitIndex;
            nextList.setAttribute('start', nextStart);
        }

        // 現在ページのリストが空なら丸ごと次ページへ
        // ※再帰呼び出し時は element が container の直接の子ではない場合があるため
        //   parentNode 経由で削除する
        if (element.children.length === 0) {
            items.forEach(li => element.appendChild(li));
            element.parentNode?.removeChild(element);
            return element;
        }

        if (!isSplit) return null;

        // 次ページへ返す内容を組み立て
        if (liContinuation) {
            // liContinuationはLI要素として構築されているはずなので、そのまま先頭に挿入
            nextList.insertBefore(liContinuation, nextList.firstChild);
        }
        
        return nextList;
    },


    /**
     * DETAILS要素の分割 (summaryを維持し、中身が空になる分割を防ぐ)
     */
    async splitDetails(element, maxHeight, container, pageHeightPx) {
        const summary = element.querySelector('summary');
        const contentNodes = Array.from(element.children).filter(node => node.tagName !== 'SUMMARY');

        if (contentNodes.length === 0) {
            return await this.splitTextNodeBlock(element, maxHeight, container, pageHeightPx);
        }

        // ガワとsummaryを複製
        const nextDetails = element.cloneNode(false);
        if (summary) {
            nextDetails.appendChild(summary.cloneNode(true));
        }

        // 一旦コンテンツを取り除く
        contentNodes.forEach(node => element.removeChild(node));

        let isSplit = false;

        for (let i = 0; i < contentNodes.length; i++) {
            if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

            const node = contentNodes[i];
            element.appendChild(node);

            if (container.offsetHeight > pageHeightPx) {
                element.removeChild(node);

                let wasSplitRecursively = false;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 要素自体を再帰的に分割してみる
                    element.appendChild(node);
                    const overflowChild = await this.splitElement(node, maxHeight, container, pageHeightPx);
                    if (overflowChild && overflowChild !== node) {
                        nextDetails.appendChild(overflowChild);
                        wasSplitRecursively = true;
                    } else {
                        if (node.parentNode) {
                            node.parentNode.removeChild(node);
                        }
                    }
                }

                if (!wasSplitRecursively) {
                    let forced = false;
                    // もし最初の子要素ですら入らなかった場合
                    if (i === 0) {
                        const validNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
                        // ページ自体に他の要素が無いか、直前が見出しだけの場合、強制的に最初のブロックを入れる
                        const isOnlyHeader = validNodes.length === 2 && /^H[1-6]$/.test(validNodes[0].tagName);

                        if (validNodes.length <= 1 || isOnlyHeader) {
                            element.appendChild(node);
                            forced = true; // 無限ループ回避のため1つは現在のページに置く
                        }
                    }

                    if (!forced) {
                        nextDetails.appendChild(node);
                    }
                }

                // 以降の要素は丸ごと次ページへ
                let addedToNext = wasSplitRecursively || (!wasSplitRecursively && node.parentNode !== element);
                for (let j = i + 1; j < contentNodes.length; j++) {
                    nextDetails.appendChild(contentNodes[j]);
                    addedToNext = true;
                }
                isSplit = addedToNext;
                break;
            }
        }

        // 現在のページにコンテンツが1つも残らなかった場合（summaryだけで溢れたか、次の要素が入らない場合）
        // 丸ごと次ページに送る (空のsummaryだけのページを残さないため)
        if (Array.from(element.children).filter(n => n.tagName !== 'SUMMARY').length === 0) {
            contentNodes.forEach(node => element.appendChild(node));

            // 直前の要素がH1〜H6の直下見出しだった場合、見出し単独で孤立（Widow）するのを防ぐため、
            // その見出しも巻き込んで次ページへ送る（可能であれば）
            const prevSibling = element.previousElementSibling;
            if (prevSibling && /^H[1-6]$/.test(prevSibling.tagName)) {
                // コンテナの最後の子要素が今のH2であるかの確認
                if (container.lastElementChild === element || container.lastElementChild === prevSibling) {
                    // return null して丸ごと送る処理は splitToPages で扱うには element 自体を戻すので、
                    // 見出しも抜いて兄弟として送るには一工夫必要だが、ここではシンプルに、
                    // 「見出しの後ろに改ページ」という不自然さを防ぐため要素を element と分離しない。
                    // 実際には splitToPages の中で処理するのが最適。
                }
            }

            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            return element; // 分割せず要素全体を次へ
        }

        return isSplit ? nextDetails : null;
    },

    /**
     * テーブル要素の分割 (行単位)
     */
    async splitTable(element, maxHeight, container, pageHeightPx) {
        const thead = element.querySelector('thead');
        let tbody = element.querySelector('tbody');

        // tbodyがない場合（Markdownパーサーによってはテーブル直下にTRがあるため）
        if (!tbody) {
            tbody = element;
        }

        const rows = Array.from(tbody.children).filter(node => node.tagName === 'TR');

        if (rows.length === 0) {
            return await this.splitTextNodeBlock(element, maxHeight, container, pageHeightPx);
        }

        const nextTable = element.cloneNode(false); // テーブル属性などをコピー
        if (thead) {
            nextTable.appendChild(thead.cloneNode(true)); // thead(ヘッダー)を次ページにも保持
        }

        let nextTbody = tbody !== element ? tbody.cloneNode(false) : nextTable;
        if (nextTbody !== nextTable) {
            nextTable.appendChild(nextTbody);
        }

        // データ行（TR）を一旦すべてテーブルから取り外す
        rows.forEach(tr => tbody.removeChild(tr));

        let isSplit = false;

        for (let i = 0; i < rows.length; i++) {
            if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

            const tr = rows[i];
            tbody.appendChild(tr);

            if (container.offsetHeight > pageHeightPx) {
                tbody.removeChild(tr);

                // 最初の1行目ですら現在のページに収まらなかった場合
                if (i === 0) {
                    const validNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
                    // 他にブロックが無く、テーブルしかないなら強制的に1行目を書き込む
                    if (validNodes.length <= 1) {
                        tbody.appendChild(tr);
                        i++; // この行は現在のページに残す
                    }
                }

                // 以降の行は次ページのテーブルへ
                let addedToNext = false;
                for (let j = i; j < rows.length; j++) {
                    nextTbody.appendChild(rows[j]);
                    addedToNext = true;
                }
                isSplit = addedToNext;
                break;
            }
        }

        // 現在のページのテーブル本体にデータ行が1つも残らなかった場合（theadだけで溢れた場合など）
        // 丸ごと次ページにテーブルを送る
        if (Array.from(tbody.children).filter(n => n.tagName === 'TR').length === 0) {
            rows.forEach(tr => tbody.appendChild(tr));
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            return element;
        }

        return isSplit ? nextTable : null;
    },

    /**
     * テキストを含むブロック要素を解析し、はみ出し箇所のテキストノードを二分探索で特定・分割する。
     */
    async splitTextNodeBlock(element, maxHeight, container, pageHeightPx) {
        const childNodes = Array.from(element.childNodes);
        if (childNodes.length === 0) return null;

        // [NEW] 要素が丸ごと1ページに収まる高さであれば、子ノード(テキスト)をバラバラに切り離さない
        // (途中での文章の分断やインライン要素の泣き別れを防ぎ、さらには改ページ線のズレも解消する)
        const oh = element.offsetHeight || 0;
        if (oh > 0 && oh <= pageHeightPx - 10) {
            const validNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
            if (validNodes.length <= 1) {
                // ページ上の最初のブロックならはみ出しても分割せずここに留める (無限ループ回避)
                // (nullを返して現状維持扱い)
                return null;
            } else {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
                return element; // 丸ごと次ページへ送る
            }
        }

        // --- ブロックがページ高さを上回る巨大な場合のフォールバック（文字単位分割） ---

        const nextElement = element.cloneNode(false); // ガワだけ複製
        // [FIX] テキストの分割時にも、元要素からどれだけ切り取られたかの「累積オフセット」を記録する
        // これにより、プレビュー上の改ページ線がテキストブロックの途中の正しい位置に引かれるようになる
        const currentOffset = parseFloat(element.dataset.splitOffset || '0');
        
        element.innerHTML = '';

        let isSplit = false;

        for (let i = 0; i < childNodes.length; i++) {
            if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0)); // 非同期解放

            const node = childNodes[i];
            element.appendChild(node);

            if (container.offsetHeight > pageHeightPx) {
                element.removeChild(node);

                // 次のページに持ち越すガワ要素に、新しい累積オフセットを記録する
                // （残った要素の実際の高さ (bounding rect) を加算し、サブピクセル誤差を防ぐ）
                const h = element.getBoundingClientRect().height;
                nextElement.dataset.splitOffset = String(currentOffset + h);

                // テキストノードでかつ十分な長さがある場合は文字単位での分割を試みる（二分探索）
                // ただし、見出しや強調（STRONG/B）などの意味的な塊は途中で分割しないよう除外する
                const isHeadingOrStrong = /^(H[1-6]|STRONG|B)$/.test(element.tagName);
                if (node.nodeType === Node.TEXT_NODE && node.textContent.length > 40 && !isHeadingOrStrong) {
                    const originalText = node.textContent;
                    let left = 0;
                    let right = originalText.length;
                    let bestFitLength = 0;
                    let loopCounter = 0;

                    // バイナリサーチでページ内に収まるギリギリの文字数を探す
                    while (left <= right) {
                        if (++loopCounter % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0)); // 非同期解放

                        const mid = Math.floor((left + right) / 2);
                        node.textContent = originalText.substring(0, mid);
                        element.appendChild(node);

                        if (container.offsetHeight <= pageHeightPx) {
                            // 収まった
                            bestFitLength = mid;
                            left = mid + 1;
                        } else {
                            // はみ出た
                            right = mid - 1;
                        }
                        if (node.parentNode === element) {
                            element.removeChild(node);
                        }
                    }

                    if (bestFitLength > 0) {
                        let fitText = originalText.substring(0, bestFitLength);
                        let overflowText = originalText.substring(bestFitLength);

                        const fitTextNode = document.createTextNode(fitText);
                        element.appendChild(fitTextNode);

                        // <pre>内の分割で、改行の直前で分割された場合、余分な空行（行数の増加）を防ぐため
                        // 次ページに送られる先頭の改行を1つ除去する。
                        const isPre = element.closest && element.closest('pre') !== null;
                        if (isPre) {
                            if (!container.textContent.endsWith('\n') && overflowText.startsWith('\n')) {
                                overflowText = overflowText.substring(1);
                            }
                        }

                        // 残りを次ページ用の要素の先頭に追加
                        const overflowTextNode = document.createTextNode(overflowText);
                        nextElement.appendChild(overflowTextNode);
                    } else {
                        // 1文字も収まらない場合はノードをまるごと次ページへ
                        let overflowText = originalText;
                        const isPre = element.closest && element.closest('pre') !== null;
                        if (isPre) {
                            if (!container.textContent.endsWith('\n') && overflowText.startsWith('\n')) {
                                overflowText = overflowText.substring(1);
                            }
                        }
                        node.textContent = overflowText;
                        nextElement.appendChild(node);
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // 要素自体を再帰的に分割してみる
                    element.appendChild(node);
                    const overflowChild = await this.splitElement(node, maxHeight, container, pageHeightPx);
                    if (overflowChild && overflowChild !== node) {
                        nextElement.appendChild(overflowChild);
                    } else if (node.parentNode === element) {
                        element.removeChild(node);
                        nextElement.appendChild(node);
                    }
                } else {
                    // テキストノード以外（または短いテキスト）はまるごと次ページへ
                    if (node.nodeType === Node.TEXT_NODE) {
                        const isPre = element.closest && element.closest('pre') !== null;
                        if (isPre) {
                            if (!container.textContent.endsWith('\n') && node.textContent.startsWith('\n')) {
                                node.textContent = node.textContent.substring(1);
                            }
                        }
                    }
                    nextElement.appendChild(node);
                }

                // 以降のすべての兄弟ノードを次ページ要素へ
                for (let j = i + 1; j < childNodes.length; j++) {
                    nextElement.appendChild(childNodes[j]);
                }

                isSplit = nextElement.childNodes.length > 0;
                break;
            }
        }

        if (element.childNodes.length === 0) {
            for (let i = 0; i < childNodes.length; i++) {
                element.appendChild(childNodes[i]);
            }
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            return element;
        }

        return isSplit ? nextElement : null;
    },

    /**
     * 分割不可な要素（画像・SVGなど）をクリッピング手法で複数ページに分割する。
     * overflow: hidden のラッパーで高さを制限し、translateY で表示位置をずらすことで
     * 画像の続きを次ページに表示する。
     */
    async splitUnbreakableElementByClipping(element, maxHeight, container, pageHeightPx) {
        // すでにこのメソッドでラップされている場合（2ページ目以降）
        const isAlreadyWrapped = element.classList.contains('page-split-clipping-wrapper');

        // console.log(\`[PageSplitter][Clip] splitUnbreakableElementByClipping 呼び出し。isAlreadyWrapped=${isAlreadyWrapped}, maxHeight=${maxHeight.toFixed(1)}px, tag=${element.tagName}\`);

        // ラップ済みの場合：内部の実要素を特定。未ラップの場合：要素そのもの。
        const targetElement = isAlreadyWrapped ? element.firstElementChild : element;
        if (!targetElement) {
            // console.warn('[PageSplitter][Clip] targetElement が null。element をそのまま返す。');
            return element;
        }

        // コンテンツ全体の高さを取得
        // プレビュー幅とスライド幅の違いによりSVG等のアスペクト比で高さが変わるため、現在の実際の offsetHeight を優先する
        const hAttr = targetElement.getAttribute('data-original-height');
        const offsetH = targetElement.offsetHeight || targetElement.scrollHeight || 0;
        const contentHeight = offsetH > 0 ? offsetH : (hAttr ? parseFloat(hAttr) : 0);
        
        // プレビュー側で位置を逆算（スケール）できるよう、Slide DOM での計測高さを記録する
        if (offsetH > 0) {
            targetElement.dataset.splitMeasureHeight = String(offsetH);
            // console.log(\`[PageSplitter][Clip] Measured physical Slide height: ${offsetH}px (Original Live DOM height: ${hAttr})\`);
        }

        // console.log(\`[PageSplitter][Clip] contentHeight=${contentHeight}px (hAttr=${hAttr}), offsetH=${targetElement.offsetHeight}px, scrollH=${targetElement.scrollHeight}px\`);
        if (contentHeight <= 0) {
            // 高さが計測できない場合は丸ごと次ページへ
            // console.warn('[PageSplitter][Clip] contentHeight=0 -> 丸ごと次ページへ');
            if (element.parentNode) element.parentNode.removeChild(element);
            return element;
        }

        // 今回のページで表示を開始するオフセット（2ページ目以降は targetElement の dataset に記録済み）
        const currentOffset = parseFloat(targetElement.dataset.splitOffset || '0');

        // 残り高さ = 全体 - すでに表示済みの高さ
        const remainingHeight = contentHeight - currentOffset;

        // console.log(\`[PageSplitter][Clip] currentOffset=${currentOffset}px, remainingHeight=${remainingHeight.toFixed(1)}px, maxHeight=${maxHeight.toFixed(1)}px\`);

        // 残りが今のページに収まる場合は分割不要（null を返して現状を維持）
        if (remainingHeight <= maxHeight + 1) {
            // console.log('[PageSplitter][Clip] 残りが収まる -> 分割不要 (null)');
            return null;
        }

        // console.log(\`[PageSplitter][Clip] 分割実行: offset ${currentOffset} -> ${currentOffset + maxHeight}px\`);

        // -----------------------------------------------------------
        // 1. 現在ページ用ラッパーの構築
        // -----------------------------------------------------------
        let currentWrapper;
        if (isAlreadyWrapped) {
            // すでにラッパーがある場合は高さのみ更新
            currentWrapper = element;
            currentWrapper.style.height = `${maxHeight}px`;
            currentWrapper.style.overflowY = 'hidden';
        } else {
            // 初回：ラッパーを新規作成
            currentWrapper = document.createElement('div');
            currentWrapper.className = 'page-split-clipping-wrapper';
            currentWrapper.style.overflowX = 'visible';
            currentWrapper.style.overflowY = 'hidden';
            currentWrapper.style.boxSizing = 'border-box';
            currentWrapper.style.margin = '0';
            currentWrapper.style.padding = '0';
            currentWrapper.style.border = 'none';
            currentWrapper.style.height = `${maxHeight}px`;
            currentWrapper.style.width = '100%';
            currentWrapper.style.position = 'relative';

            // 要素の元のマージンを取得してラッパーへ移譲する
            // （overflow:hiddenの性質上、中にmarginが残るとその分だけ描画領域が下に押し下げられてしまい、赤い点線の位置とズレるため）
            const computedStyle = window.getComputedStyle(targetElement);
            const originalMarginTop = computedStyle.marginTop;
            const originalMarginBottom = computedStyle.marginBottom;
            
            currentWrapper.style.marginTop = originalMarginTop;
            currentWrapper.style.marginBottom = originalMarginBottom;

            // 内部要素の display は元のまま維持する（block を強制するとSVGのアスペクト比が変わり、横幅がクロップされる原因になるため）
            targetElement.style.position = 'relative'; // position:absolute は幅計算を壊すため避ける
            targetElement.style.left = '0';
            targetElement.style.transformOrigin = 'top left';
            
            // 内部要素の余白を完全にリセットし、ラッパーの天井(Y=0)にピタッとくっつける
            targetElement.style.marginTop = '0';
            targetElement.style.marginBottom = '0';

            // 初回オフセットは 0 なので transform なし
            targetElement.style.transform = '';
            targetElement.dataset.splitOffset = '0'; // 初期値を明示記録

            // コンテナ内の element の直前にラッパーを挿入し、element をその中に移動
            if (element.parentNode) {
                element.parentNode.insertBefore(currentWrapper, element);
                currentWrapper.appendChild(element);
            } else {
                // parentNode がない場合（計測コンテナ直下への直接追加）は単純にラップ
                currentWrapper.appendChild(element);
                container.appendChild(currentWrapper);
            }
        }

        // -----------------------------------------------------------
        // 2. 次ページ用ラッパーの構築
        // -----------------------------------------------------------
        // 現在ページのラッパーを deep clone して次ページ分を作る
        const nextWrapper = currentWrapper.cloneNode(true);
        const nextInner = nextWrapper.firstElementChild;
        if (!nextInner) return null; // 安全ガード

        // 次ページの表示開始位置 = 現在までのオフセット + 今回のページ高さ
        const nextOffset = currentOffset + maxHeight;
        nextInner.dataset.splitOffset = String(nextOffset);

        // translateY で内容を上にずらして「続き」を表示
        // （position:relative + translateY はレイアウトに影響しないためスペースが生じるが、
        //  ラッパーの height と overflowY:hidden でクリップするため問題ない）
        nextInner.style.transform = `translateY(-${nextOffset}px)`;
        nextInner.style.marginTop = '0'; // 念のためリセット

        // [FIX] 次ページに送られるはみ出しコンテンツの暫定高さをセットし、隠す
        // auto や visible にすると、上に translateY された要素の実態高さが
        // 次ページのオフセット計算を狂わせ、無意味な改ページが延々と続く原因になる。
        const remainingForNext = Math.max(0, contentHeight - nextOffset);
        nextWrapper.style.height = `${remainingForNext}px`;
        nextWrapper.style.overflowY = 'hidden';

        return nextWrapper;
    },

    /**
     * [NEW] 分割不可かつページ高さを超える巨大要素を、アスペクト比を維持してページ内に収まるよう縮小する
     */
    autoScaleUnbreakableElement(element, maxHeight) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

        // 既に処理済みの場合はスキップ
        if (element.classList.contains('page-split-clipping-wrapper')) return;
        if (element.dataset.scaled === "true") return;

        // [DEBUG LOG] 全ての計測手法の値を書き出す
        const oh = element.offsetHeight;
        const sh = element.scrollHeight;
        const rect = element.getBoundingClientRect();

        // [NEW] 事前に記録された属性があれば優先的に使用
        const hAttr = element.getAttribute('data-original-height');
        const wAttr = element.getAttribute('data-original-width');

        let originalHeight = hAttr ? parseFloat(hAttr) : (oh || sh || rect.height);
        let originalWidth = wAttr ? parseFloat(wAttr) : (element.offsetWidth || rect.width);

        // console.log(`[PageSplitter] autoScale Measurement: Width=${originalWidth}px, Height=${originalHeight.toFixed(1)}px, MaxHeight=${maxHeight.toFixed(1)}px`);

        // 幅がページ幅を超えている場合、または高さがページ高さを超えている場合
        const pageWidth = element.parentElement ? element.parentElement.offsetWidth : 820;

        const needsVerticalScale = originalHeight > maxHeight && originalHeight > 0;
        const needsHorizontalScale = originalWidth > pageWidth && originalWidth > 0;

        if (!needsVerticalScale && !needsHorizontalScale && originalHeight > 0) {
            // console.log(`[PageSplitter] Auto-scale skip: Fits in page.`);
            return;
        }

        if (originalHeight === 0 || originalWidth === 0) {
            // さらに子要素を探索
            const inner = element.querySelector('svg, img, table, .code-block-wrapper');
            if (inner) {
                const ioh = inner.offsetHeight;
                const ish = inner.scrollHeight;
                const irect = inner.getBoundingClientRect();
                // console.log(`[PageSplitter] autoScale Inner Measurement: offsetHeight=${ioh}px, scrollHeight=${ish}px, BCR.height=${irect.height.toFixed(1)}px`);

                if (originalHeight === 0) originalHeight = ioh || ish || irect.height;
                if (originalWidth === 0) originalWidth = inner.offsetWidth || irect.width;
            }

            if ((originalHeight <= maxHeight && originalWidth <= pageWidth) || originalHeight === 0) {
                // console.log(`[PageSplitter] Auto-scale skip: Final ${originalWidth}x${originalHeight} fit or 0`);
                return;
            }
        }

        const targetHeight = maxHeight - 20;
        const targetWidth = pageWidth - 40; // パディング左右 20x2 分を考慮

        const scaleY = targetHeight / originalHeight;
        const scaleX = targetWidth / originalWidth;

        // アスペクト比を維持するため、より小さい方のスケールを採用する
        // (縮小率に1.3倍等の補正をかけると結局はみ出るため、厳密な縮小率(最大1.0)を利用)
        let scale = Math.min(scaleX, scaleY, 1.0);

        // console.log(`[PageSplitter] >>> AUTO-SCALING START <<<`);
        // console.log(`[PageSplitter] - Original: ${originalWidth}x${originalHeight}, Page: ${pageWidth}x${maxHeight}`);
        // console.log(`[PageSplitter] - Scale Factor: ${scale.toFixed(4)} (X:${scaleX.toFixed(2)}, Y:${scaleY.toFixed(2)})`);

        // transform で要素全体を一括して縮小
        element.style.transformOrigin = 'top left'; // [FIX] Leftに戻す（paddingでずらす）
        element.style.transform = `scale(${scale})`;

        // 外部レイアウトへの影響を最小化するためのラッパー処理（既存のロジックを継続）
        element.style.width = '100%';
        element.style.height = `${originalHeight}px`;

        // コンテナとしての高さを「縮小後」に見せるためのワークアラウンド
        const wrapper = document.createElement('div');
        wrapper.className = 'page-split-scale-wrapper';
        wrapper.style.overflow = 'hidden';
        wrapper.style.height = `${targetHeight}px`;
        wrapper.style.width = '100%';
        // [NEW] スケール時も SVG の端が切れないようパディングを付与
        wrapper.style.padding = '0 20px';
        wrapper.style.boxSizing = 'border-box';
        wrapper.style.position = 'relative';

        if (element.parentNode) {
            element.parentNode.insertBefore(wrapper, element);
            wrapper.appendChild(element);
        }

        element.dataset.scaled = "true";
        // console.log(`[PageSplitter] >>> AUTO-SCALING APPLIED <<<`);
    }
};

window.PageSplitter = PageSplitter;
