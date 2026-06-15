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
        const pages = [];
        // [FIX 5] 元のDOMを破壊しないようクローンを作成して操作する
        const workElement = sourceElement.cloneNode(true);

        // 計測用のコンテナを配置。
        // visibility: hidden を使うことで、表示はされないがレイアウト計算が行われる状態にする。
        const measureContainer = document.createElement('div');
        measureContainer.className = workElement.className;
        Object.assign(measureContainer.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: `${widthPx}px`,
            height: 'auto',
            visibility: 'hidden', 
            pointerEvents: 'none',
            zIndex: '-9999',
            padding: '0',
            margin: '0',
            display: 'block',
        });
        document.body.appendChild(measureContainer);

        try {
            workElement.querySelectorAll('details').forEach(d => d.open = true);

            // [FIX] content-visibility: auto はパフォーマンス最適化のために
            // ビューポート外の要素の高さを contain-intrinsic-size で代替するが、
            // 計測コンテナ（visibility:hidden）内ではSVGの実際の高さが反映されず、
            // ページ分割が正しく行われない。分割処理前に無効化して正確な高さ計測を保証する。
            workElement.querySelectorAll('.svg-view-wrapper').forEach(el => {
                el.style.contentVisibility = 'visible';
                el.style.containIntrinsicSize = 'none';
            });

            let remainingChildren = Array.from(workElement.childNodes);
            let loopCount = 0;
            const MAX_LOOPS = 5000;

            while (remainingChildren.length > 0) {
                loopCount++;
                if (loopCount > MAX_LOOPS) {
                    console.error("[PageSplitter] MAX_LOOPS exceeded.");
                    // 無限ループ時は残りを最後のページとして救済
                    const emergencyPage = this.createNewPageContainer(workElement);
                    remainingChildren.forEach(child => emergencyPage.appendChild(child));
                    pages.push(emergencyPage);
                    break;
                }

                if (loopCount % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                // ページ先頭の空テキストやHRをスキップ
                while (remainingChildren.length > 0) {
                    const first = remainingChildren[0];
                    if (first.nodeType === Node.TEXT_NODE && first.textContent.trim().length === 0) {
                        remainingChildren.shift();
                    } else if (globalThis.AppState?.config?.pageBreakOnHr && first.nodeType === Node.ELEMENT_NODE && first.tagName === 'HR') {
                        remainingChildren.shift();
                    } else {
                        break;
                    }
                }
                if (remainingChildren.length === 0) break;

                const currentPage = this.createNewPageContainer(workElement);
                measureContainer.appendChild(currentPage);

                // 【改善ポイント: チャンク・インサート方式】
                // 全要素を一気に入れるとO(N^2)になり激重になるため、ページ高さを超える「必要十分な数」だけを追加する
                let estimatedHeight = 0;
                let insertedCount = 0;

                for (let i = 0; i < remainingChildren.length; i++) {
                    const child = remainingChildren[i];
                    currentPage.appendChild(child);
                    // 追加直後に横幅のフィット処理を実行
                    this.fitElementWidth(child, widthPx);
                    insertedCount++;
                    
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        estimatedHeight += parseFloat(child.getAttribute('data-original-height') || "0") || 0;
                    }
                    
                    if (globalThis.AppState?.config?.pageBreakOnHr && child.nodeType === Node.ELEMENT_NODE && child.tagName === 'HR') {
                        break;
                    }

                    // ページ高さの1.5倍まで入れたら一旦ストップ（確実にページを溢れさせる）
                    if (estimatedHeight > pageHeightPx * 1.5) {
                        break;
                    }
                }

                let containerRect = currentPage.getBoundingClientRect();
                let containerHeight = containerRect.height;
                let containerTop = containerRect.top;

                // [フェイルセーフ] もし見積もりが甘く、実際の高さがページに満たない場合は超えるまで追加
                while (containerHeight <= pageHeightPx && insertedCount < remainingChildren.length) {
                    const nextChild = remainingChildren[insertedCount];
                    if (globalThis.AppState?.config?.pageBreakOnHr && nextChild.nodeType === Node.ELEMENT_NODE && nextChild.tagName === 'HR') {
                        currentPage.appendChild(nextChild);
                        this.fitElementWidth(nextChild, widthPx);
                        insertedCount++;
                        break;
                    }
                    currentPage.appendChild(nextChild);
                    this.fitElementWidth(nextChild, widthPx);
                    insertedCount++;
                    
                    containerRect = currentPage.getBoundingClientRect();
                    containerHeight = containerRect.height;
                    
                    if (containerHeight === 0) {
                        containerHeight = Array.from(currentPage.childNodes).reduce((acc, node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                return acc + (parseFloat(node.getAttribute('data-original-height') || "0") || node.getBoundingClientRect().height);
                            }
                            return acc;
                        }, 0);
                    }
                }

                // --- 境界要素のスキャン ---
                const childNodes = Array.from(currentPage.childNodes);
                let overflowIndex = -1;
                let overflowChild = null;
                let isHrBreak = false;

                for (let i = 0; i < childNodes.length; i++) {
                    const child = childNodes[i];
                    if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length === 0) continue;

                    if (globalThis.AppState?.config?.pageBreakOnHr && child.nodeType === Node.ELEMENT_NODE && child.tagName === 'HR') {
                        overflowIndex = i;
                        overflowChild = child;
                        isHrBreak = true;
                        break;
                    }

                    let bottomRelative = 0;
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        bottomRelative = child.getBoundingClientRect().bottom - containerTop;
                    } else {
                        const range = document.createRange();
                        range.selectNodeContents(child);
                        bottomRelative = range.getBoundingClientRect().bottom - containerTop;
                    }

                    if (bottomRelative > pageHeightPx) {
                        overflowIndex = i;
                        overflowChild = child;
                        break;
                    }
                }

                if (overflowIndex === -1) {
                    overflowIndex = childNodes.length - 1;
                    overflowChild = childNodes[overflowIndex];
                }

                // currentPage から溢れた要素を取り外す
                for (let i = childNodes.length - 1; i > overflowIndex; i--) {
                    currentPage.removeChild(childNodes[i]);
                }

                let nextRemaining = [];
                const uninsertedChildren = remainingChildren.slice(insertedCount);

                if (isHrBreak) {
                    currentPage.removeChild(overflowChild);
                    nextRemaining = remainingChildren.slice(overflowIndex + 1);
                } else if (containerHeight <= pageHeightPx) {
                    // 全て収まった（最後のページ等）
                    nextRemaining = uninsertedChildren;
                } else {
                    // 要素の分割処理
                    let heightBefore = 0;
                    if (overflowChild.nodeType === Node.ELEMENT_NODE) {
                        heightBefore = Math.max(0, overflowChild.getBoundingClientRect().top - containerTop);
                    } else {
                        const range = document.createRange();
                        range.selectNodeContents(overflowChild);
                        heightBefore = Math.max(0, range.getBoundingClientRect().top - containerTop);
                    }
                    const available = Math.max(0, pageHeightPx - heightBefore);

                    let overflowedNode = null;
                    if (overflowChild.nodeType === Node.ELEMENT_NODE) {
                        overflowedNode = await this.splitElement(overflowChild, available, currentPage, pageHeightPx);
                    } else {
                        overflowedNode = overflowChild.cloneNode(true);
                        currentPage.removeChild(overflowChild);
                    }

                    let leftoverChildren = remainingChildren.slice(overflowIndex + 1);

                    if (overflowedNode) {
                        if (overflowedNode === overflowChild) {
                            const hasMeaningfulBefore = childNodes.slice(0, overflowIndex).some(n =>
                                n.nodeType === Node.ELEMENT_NODE ||
                                (n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)
                            );
                            if (!hasMeaningfulBefore) {
                                // ページ先頭なら強制的に残す
                                if (!overflowChild.parentNode || overflowChild.parentNode !== currentPage) {
                                    currentPage.appendChild(overflowChild);
                                }
                                nextRemaining = leftoverChildren;
                            } else {
                                if (overflowChild.parentNode === currentPage) {
                                    currentPage.removeChild(overflowChild);
                                }
                                nextRemaining = [overflowedNode, ...leftoverChildren];
                            }
                        } else {
                            nextRemaining = [overflowedNode, ...leftoverChildren];
                        }
                    } else {
                         nextRemaining = leftoverChildren;
                    }
                }

                // --- 孤立見出し（Widow）防止処理 ---
                if (nextRemaining.length > 0) {
                    const currentChildren = Array.from(currentPage.childNodes);
                    if (currentChildren.length > 0) {
                        const lastChild = currentChildren[currentChildren.length - 1];
                        if (lastChild && lastChild.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(lastChild.tagName)) {
                            const hasOtherContent = currentChildren.slice(0, -1).some(n => 
                                n.nodeType === Node.ELEMENT_NODE || 
                                (n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)
                            );
                            if (hasOtherContent) {
                                currentPage.removeChild(lastChild);
                                nextRemaining.unshift(lastChild);
                            }
                        }
                    }
                }

                if (!this._isEffectivelyEmpty(currentPage)) {
                    pages.push(currentPage.cloneNode(true));
                }

                remainingChildren = nextRemaining;

                if (currentPage.parentNode === measureContainer) {
                    measureContainer.removeChild(currentPage);
                }
            }

        } finally {
            if (measureContainer && measureContainer.parentNode) {
                measureContainer.parentNode.removeChild(measureContainer);
            }
        }

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
     * 要素の横幅がコンテナの幅を超えている場合、スケール縮小処理を適用する
     * @param {Node} node - 対象ノード
     * @param {number} availableWidth - 許容される最大幅
     */
    fitElementWidth(node, availableWidth) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

        const tagName = node.tagName.toUpperCase();
        
        // Pタグなどのインラインテキストが含まれる標準ブロックには自然な折り返しを促す
        const nonScaleTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'];
        if (nonScaleTags.includes(tagName)) {
            node.style.maxWidth = '100%';
            node.style.boxSizing = 'border-box';
            node.style.overflowWrap = 'anywhere';
            node.style.wordBreak = 'break-word';
            return;
        }

        // すでにクリッピングラッパーで囲まれているか、またはクリッピングラッパー自身である場合
        let targetElement = node;
        if (node.classList.contains('page-split-clipping-wrapper')) {
            targetElement = node.firstElementChild;
            if (!targetElement) return;
        }

        // 要素の横幅を測定
        const elementWidth = targetElement.offsetWidth || targetElement.getBoundingClientRect().width;

        if (elementWidth > availableWidth && elementWidth > 0) {
            const horizontalScale = Math.min((availableWidth / elementWidth), 1.0);
            
            targetElement.style.transformOrigin = 'top left';
            targetElement.style.transform = `scale(${horizontalScale})`;
            targetElement.style.width = `${elementWidth}px`; // 100%ではなく元の幅を維持
            targetElement.style.display = 'block';

            // スケールによって生じた下部の「見えない余白」をマイナスマージンで相殺
            if (!node.classList.contains('page-split-clipping-wrapper')) {
                const originalHeight = targetElement.offsetHeight || targetElement.getBoundingClientRect().height;
                const reducedHeight = originalHeight * (1 - horizontalScale);
                targetElement.style.marginBottom = `-${reducedHeight}px`; // 直下の要素を引き上げる
            }
        }
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
        const isCodeWrapper = element.classList?.contains('code-block-wrapper');

        // [NEW] コードブロックの場合、操作パネルを事前に取得しておく
        let controls = null;
        if (isCodeWrapper) {
            controls = element.querySelector('.code-controls');
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
        if ((tagName === 'PRE' || isCodeWrapper) && globalThis.AppState?.config?.lineNumbers) {
            this.reconstructLineNumbers(element, result);
        }

        // [NEW] コードブロックの操作パネル対応
        // wrapper が分割された場合、controls を全ページに複製・維持する
        if (isCodeWrapper && controls) {
            // 1ページ目(element)に controls が無くなっていたら戻す（splitTextNodeBlockでクリアされるため）
            if (!element.querySelector('.code-controls')) {
                element.prepend(controls.cloneNode(true));
            }
            // 2ページ目(result)にも controls を追加する
            if (result && result !== element && !result.querySelector('.code-controls')) {
                result.prepend(controls.cloneNode(true));
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

            let pre = el;
            if (el.classList && el.classList.contains('code-block-wrapper')) {
                pre = el.querySelector('pre');
            }
            if (!pre || pre.tagName !== 'PRE') return;

            pre.querySelectorAll('.line-numbers-rows').forEach(r => r.remove());

            pre.classList.add('line-numbers');
            pre.setAttribute('data-start', startNum);

            pre.style.paddingLeft = '';
            pre.style.position = '';
            pre.style.overflowX = '';
            pre.style.counterReset = '';

            const code = pre.querySelector('code');
            if (code && typeof Prism !== 'undefined') {
                try {
                    Prism.highlightElement(code);
                } catch (e) {}
            }
        };

        let preForAttr = element;
        if (element.classList && element.classList.contains('code-block-wrapper')) {
            preForAttr = element.querySelector('pre');
        }
        const originalStart = (preForAttr && preForAttr.getAttribute('data-start')) ? parseInt(preForAttr.getAttribute('data-start'), 10) : 1;

        updateGutter(element, originalStart);

        if (result && result !== element) {
            let pre1 = element;
            if (element.classList && element.classList.contains('code-block-wrapper')) {
                pre1 = element.querySelector('pre');
            }

            let firstPageContent = (pre1 && pre1.querySelector('code')) ? pre1.querySelector('code').textContent : (pre1 ? pre1.textContent : "");
            
            // [FIX 5] 末尾の余分な改行（\n）を正規表現で完全に除去してから行数を数える
            firstPageContent = firstPageContent.replace(/[\r\n]+$/, '');
            const firstPageLines = firstPageContent ? firstPageContent.split('\n') : [];
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

                // --- LI内の子ノードを分割してページ末尾まで書き、続きを次ページへ ---
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
                            // テキストノードで40文字以上なら文字単位の二分探索（サロゲートペア対応）
                            const textArr = [...node.textContent];
                            let left = 0, right = textArr.length, bestFit = 0, loopCount = 0;
                            while (left <= right) {
                                if (++loopCount % 10 === 0) await new Promise(r => setTimeout(r, 0));
                                const mid = Math.floor((left + right) / 2);
                                node.textContent = textArr.slice(0, mid).join('');
                                partialLi.appendChild(node);
                                if (container.offsetHeight <= pageHeightPx) {
                                    bestFit = mid;
                                    left = mid + 1;
                                } else {
                                    right = mid - 1;
                                }
                                if (node.parentNode === partialLi) partialLi.removeChild(node);
                            }
                            node.textContent = textArr.join('');

                            // 継続テキスト要素を生成（マーカーなし）
                            liContinuation = document.createElement('li');
                            liContinuation.style.listStyleType = 'none';
                            liContinuation.style.marginTop = '0';
                            liContinuation.style.marginBottom = '0.5em';
                            if (bestFit > 0) {
                                partialLi.appendChild(document.createTextNode(textArr.slice(0, bestFit).join('')));
                                liContinuation.appendChild(document.createTextNode(textArr.slice(bestFit).join('')));
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
                            const containerTop = container.getBoundingClientRect().top;
                            const nodeTop = node.getBoundingClientRect().top;
                            const childAvailable = Math.max(0, pageHeightPx - (nodeTop - containerTop));
                            const elementOverflow = await this.splitElement(node, childAvailable, container, pageHeightPx);
                            
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
        const contentNodes = Array.from(element.childNodes).filter(node => node.nodeName.toUpperCase() !== 'SUMMARY');

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
                    const containerTop = container.getBoundingClientRect().top;
                    const nodeTop = node.getBoundingClientRect().top;
                    const childAvailable = Math.max(0, pageHeightPx - (nodeTop - containerTop));
                    const overflowChild = await this.splitElement(node, childAvailable, container, pageHeightPx);
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
                // Widows: ヘッダーが見出し単独でページ末尾にある場合は、一緒に次ページへ送る
                const isHeadingOnly = element.parentNode.lastElementChild === element || 
                                     (element.nextElementSibling?.tagName.startsWith('H'));
                if (isHeadingOnly) {
                    const parent = element.parentNode;
                    parent.insertBefore(element, prevSibling);
                    return prevSibling;
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
        
        // colgroup を複製して次ページのテーブルに追加
        element.querySelectorAll('colgroup').forEach(cg => {
            nextTable.appendChild(cg.cloneNode(true));
        });

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

        const nextElement = element.cloneNode(false);
        const currentOffset = parseFloat(element.dataset.splitOffset || '0');

        // [FIX 1] コードブロックの場合はパディングを維持し、水平スクロールバーが文字に被るのを防ぐ
        const isCodeBlock = element.closest ? element.closest('.code-block-wrapper, pre, code') !== null : false;

        if (!isCodeBlock) {
            nextElement.style.paddingTop = '0';
            element.style.paddingBottom = '0';
        }

        nextElement.style.marginTop = '0';
        nextElement.style.borderTop = 'none';

        element.style.marginBottom = '0';
        element.style.borderBottom = 'none';
        
        // CSSによる高さ固定を解除して正確に計測させる
        element.style.maxHeight = 'none';
        nextElement.style.maxHeight = 'none';

        element.innerHTML = '';

        let isSplit = false;
        
        // [FIX 2] スクロールバーの出現（約17px）や再ハイライトによる高さブレを考慮し、マージンを大きめに確保
        const tolerance = isCodeBlock ? 40 : 0; 

        for (let i = 0; i < childNodes.length; i++) {
            if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0)); // 非同期解放

            const node = childNodes[i];
            element.appendChild(node);

            if (container.getBoundingClientRect().height > (pageHeightPx - tolerance)) {
                element.removeChild(node);

                const isHeadingOrStrong = /^(H[1-6]|STRONG|B)$/.test(element.tagName);
                // [FIX 3] コードブロックの場合は短いテキストでも分割対象にし、改行でのスナップを効かせる
                if (node.nodeType === Node.TEXT_NODE && (node.textContent.length > 40 || isCodeBlock) && !isHeadingOrStrong) {
                    const textArr = [...node.textContent];
                    let left = 0;
                    let right = textArr.length;
                    let bestFitLength = 0;
                    let loopCounter = 0;

                    while (left <= right) {
                        if (++loopCounter % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));

                        const mid = Math.floor((left + right) / 2);
                        node.textContent = textArr.slice(0, mid).join('');
                        element.appendChild(node);

                        if (container.getBoundingClientRect().height <= (pageHeightPx - tolerance)) {
                            bestFitLength = mid;
                            left = mid + 1;
                        } else {
                            right = mid - 1;
                        }
                        if (node.parentNode === element) {
                            element.removeChild(node);
                        }
                    }

                    if (bestFitLength > 0) {
                        if (isCodeBlock && bestFitLength < textArr.length) {
                            const lastNewline = textArr.slice(0, bestFitLength).lastIndexOf('\n');
                            if (lastNewline >= 0) { // [FIX 4] 先頭が改行の場合（0）も正しく処理する
                                bestFitLength = lastNewline + 1;
                            }
                            // 改行が無い場合は元の bestFitLength をそのまま採用する
                        }

                        if (bestFitLength > 0) {
                            let fitText = textArr.slice(0, bestFitLength).join('');
                            let overflowText = textArr.slice(bestFitLength).join('');

                            element.appendChild(document.createTextNode(fitText));
                            
                            // [CRITICAL FIX] 改行を削除するロジック（substring(1)）はソースコードを破壊し
                            // 行を結合させてしまう原因だったため、完全撤廃しました。
                            nextElement.appendChild(document.createTextNode(overflowText));
                        } else {
                            node.textContent = textArr.join('');
                            nextElement.appendChild(node);
                        }
                    } else {
                        node.textContent = textArr.join('');
                        nextElement.appendChild(node);
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    element.appendChild(node);
                    const containerTop = container.getBoundingClientRect().top;
                    const nodeTop = node.getBoundingClientRect().top;
                    const childAvailable = Math.max(0, pageHeightPx - (nodeTop - containerTop) - tolerance);
                    const overflowChild = await this.splitElement(node, childAvailable, container, pageHeightPx);
                    
                    if (overflowChild && overflowChild !== node) {
                        nextElement.appendChild(overflowChild);
                    } else {
                        // 【追加】もし縮小等によって完全に収まるようになった場合はループを継続
                        if (!overflowChild && container.getBoundingClientRect().height <= (pageHeightPx - tolerance)) {
                            continue;
                        }
                        
                        // [CRITICAL FIX] 1文字も入らなかった要素が虚空に消滅するバグを修正。
                        // 条件を外し、確実に次ページ (nextElement) へ移動させます。
                        if (node.parentNode === element) {
                            element.removeChild(node);
                        }
                        nextElement.appendChild(node);
                    }
                } else {
                    nextElement.appendChild(node);
                }

                for (let j = i + 1; j < childNodes.length; j++) nextElement.appendChild(childNodes[j]);

                const h = element.getBoundingClientRect().height;
                nextElement.dataset.splitOffset = String(currentOffset + h);

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

        // 既存の transform から translateY(...) 部分を除去したベースの transform を取得する（scale 等を消さないため）
        let baseTransform = targetElement.style.transform || '';
        baseTransform = baseTransform.replace(/translateY\([^)]+\)/gi, '').trim();

        // 【追加】スケール率（Y軸）の抽出
        let scaleY = 1.0;
        const scaleMatch = baseTransform.match(/scale\(([^,)]+)(?:,\s*([^)]+))?\)/);
        if (scaleMatch) {
            const sx = parseFloat(scaleMatch[1]);
            const sy = scaleMatch[2] ? parseFloat(scaleMatch[2]) : sx;
            if (!isNaN(sy) && sy > 0) scaleY = sy;
        }

        // [FIX No.5(B)] コンテンツ全体の高さを取得
        // data-computed-height 属性が存在する場合（processSVGBlocksで計算済みのSVG等）は
        // それを優先使用して offsetHeight の呼び出し（Layout Thrashing）を回避する。
        // offsetHeight は呼び出し時にブラウザの強制リフローを発生させるため、
        // SVGのような動的サイズ要素をループ内で計測すると深刻なフリーズの原因になる。
        const hAttr = targetElement.getAttribute('data-original-height');
        const computedH = element.getAttribute('data-computed-height') ||
                          targetElement.getAttribute('data-computed-height');
        let rawContentHeight;
        if (computedH) {
            // 事前計算済みの高さを使用（リフローゼロ）
            rawContentHeight = parseFloat(computedH);
        } else {
            // フォールバック: 従来通りoffsetHeightを読み取る（SVG以外の要素）
            const offsetH = targetElement.offsetHeight || targetElement.scrollHeight || 0;
            rawContentHeight = offsetH > 0 ? offsetH : (hAttr ? parseFloat(hAttr) : 0);
            if (offsetH > 0) {
                targetElement.dataset.splitMeasureHeight = String(offsetH);
            }
        }

        // 【修正】高さを画面上の視覚的ピクセルに変換
        const contentHeight = rawContentHeight * scaleY;

        // console.log(`[PageSplitter][Clip] contentHeight=${contentHeight}px (hAttr=${hAttr}), offsetH=${targetElement.offsetHeight}px, scrollH=${targetElement.scrollHeight}px`);
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

            // 既存のベース transform を維持する（scale 等の縮尺を消さないため）
            targetElement.style.transform = baseTransform;
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

        // 【追加】2ページ目以降の先頭に元の marginTop が引き継がれて隙間ができるのを防ぐ
        nextWrapper.style.marginTop = '0';

        // 次ページの表示開始位置 = 現在までのオフセット + 今回のページ高さ
        const nextOffset = currentOffset + maxHeight;
        nextInner.dataset.splitOffset = String(nextOffset);

        // 【修正】translateY はスケール率で割り戻してローカル座標で指定する
        const localTranslateY = nextOffset / scaleY;
        nextInner.style.transform = `${baseTransform} translateY(-${localTranslateY}px)`.trim();
        nextInner.style.marginTop = '0'; // 念のためリセット

        // [FIX] 次ページに送られるはみ出しコンテンツの暫定高さをセットし、隠す
        // auto や visible にすると、上に translateY された要素の実態高さが
        // 次ページのオフセット計算を狂わせ、無意味な改ページが延々と続く原因になる。
        const remainingForNext = Math.max(0, contentHeight - nextOffset);
        nextWrapper.style.height = `${remainingForNext}px`;
        nextWrapper.style.overflowY = 'hidden';

        return nextWrapper;
    }
};

window.PageSplitter = PageSplitter;

