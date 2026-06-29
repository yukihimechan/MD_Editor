/**
 * SvgAnimationManager.js
 * SVG要素のアニメーション（CSS/SMIL）を管理するコアクラス
 * 外部ライブラリに依存せず、非破壊的な入れ子 <g> ラッパー構造とカスタム属性を用いて、
 * 単体で動作するアニメーション付きSVGの出力を実現します。
 */
class SvgAnimationManager {
    /**
     * アニメーション用のスタイルタグを確保、または生成する
     * @param {SVGElement} svgNode - SVGのルートノード
     * @returns {SVGStyleElement} styleタグ
     */
    static getOrCreateStyleTag(svgNode) {
        let style = svgNode.querySelector('#svg-animations');
        if (!style) {
            style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.id = 'svg-animations';
            // defsタグがあればその中に、なければルートの先頭に配置
            const defs = svgNode.querySelector('defs');
            if (defs) {
                defs.appendChild(style);
            } else {
                svgNode.insertBefore(style, svgNode.firstChild);
            }
        }
        return style;
    }

    /**
     * 動的に生成された@keyframesルールを更新・追加する
     * @param {SVGElement} svgNode - SVGのルートノード
     * @param {string} animationName - キーフレーム名
     * @param {string} keyframesCss - キーフレームの定義（@keyframes 名 { ... }）
     */
    static updateKeyframes(svgNode, animationName, keyframesCss) {
        const style = this.getOrCreateStyleTag(svgNode);
        let content = style.textContent || '';

        // 既存の同名キーフレームがあれば置換、なければ追加 (ネストされた中括弧に対応)
        const regex = new RegExp(`@keyframes\\s+${animationName}\\s*\\{([^{}]*|\\{[^{}]*\\})*\\}`, 'g');
        if (regex.test(content)) {
            content = content.replace(regex, keyframesCss);
        } else {
            content += '\n' + keyframesCss;
        }

        // Trigger制御用の共通クラスがなければ追加
        if (!content.includes('.anim-paused')) {
            content += '\n.anim-paused { animation-play-state: paused !important; }';
        }
        if (!content.includes('.anim-running')) {
            content += '\n.anim-running { animation-play-state: running !important; }';
        }

        style.textContent = content.trim();
    }

    /**
     * トリガー専用のCSSクラスを動的に更新・追加する
     * @param {SVGElement} svgNode - SVGのルートノード
     * @param {string} className - クラス名
     * @param {string} animationCss - animationプロパティの値
     */
    static updateTriggerClass(svgNode, className, newRuleText) {
        const style = this.getOrCreateStyleTag(svgNode);
        let content = style.textContent || '';
        const regex = new RegExp(`[^{}]*\\.${className}\\b[^{]*\\{[^}]*\\}`, 'g');
        if (content.includes(`.${className}`)) {
            content = content.replace(regex, '');
        }
        content += '\n' + newRuleText;
        style.textContent = content.trim();
        console.log(`[Animation] Generated CSS for ${className}: \n`, newRuleText);
    }

    /**
     * 不要になった@keyframesルールを削除する
     * @param {SVGElement} svgNode - SVGのルートノード
     * @param {string} animationName - キーフレーム名
     */
    static removeKeyframes(svgNode, animationName) {
        const style = svgNode.querySelector('#svg-animations');
        if (!style) return;
        let content = style.textContent || '';
        // ネストされた中括弧に対応
        const regex = new RegExp(`@keyframes\\s+${animationName}\\s*\\{([^{}]*|\\{[^{}]*\\})*\\}\\s*`, 'g');
        content = content.replace(regex, '');
        style.textContent = content.trim();
    }

    /**
     * アニメーションの種類に応じたキーフレーム定義を取得する
     * @param {string} animName - 一意のキーフレーム名
     * @param {string} type - アニメーションの種類
     * @param {number} amount - 変化量
     * @returns {string} @keyframes文字列
     */
    static generateKeyframeCss(animName, type, amount) {
        if (amount === undefined || amount === null) {
            console.warn(`[SvgAnimationManager] Invalid amount: ${amount}`);
            return '';
        }
        const isStringAmountType = ['color-fill', 'color-line', 'slide-in', 'slide-out', 'fade-in', 'fade-out', 'flash'].includes(type);
        if (!isStringAmountType && isNaN(amount)) {
            console.warn(`[SvgAnimationManager] Invalid numeric amount for ${type}: ${amount}`);
            return '';
        }
        switch (type) {
            case 'spin':
                return `@keyframes ${animName} {
  from { transform: rotate(0deg); }
  to { transform: rotate(${amount}deg); }
}`;
            case 'swing':
                const halfAngle = amount / 2;
                return `@keyframes ${animName} {
  0% { transform: rotate(${-halfAngle}deg); }
  50% { transform: rotate(${halfAngle}deg); }
  100% { transform: rotate(${-halfAngle}deg); }
}`;
            case 'bounce':
                return `@keyframes ${animName} {
  0% { transform: translateY(0px); }
  50% { transform: translateY(${-amount}px); }
  100% { transform: translateY(0px); }
}`;
            case 'pulse':
                return `@keyframes ${animName} {
  0% { transform: scale(1); }
  50% { transform: scale(${amount}); }
  100% { transform: scale(1); }
}`;
            case 'shake':
                return `@keyframes ${animName} {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-${amount}px); }
  75% { transform: translateX(${amount}px); }
}`;
            case 'float':
                return `@keyframes ${animName} {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-${amount}px); }
}`;
            case 'flip':
                return `@keyframes ${animName} {
  from { transform: perspective(400px) rotateY(0deg); }
  to { transform: perspective(400px) rotateY(${amount}deg); }
}`;
            case 'jelly':
                const squeeze = (1 / amount).toFixed(2);
                return `@keyframes ${animName} {
  0%, 100% { transform: scale(1, 1); }
  25% { transform: scale(${amount}, ${squeeze}); }
  50% { transform: scale(1, 1); }
  75% { transform: scale(${squeeze}, ${amount}); }
}`;
            // --- スタイルアニメーション ---
            case 'slide-in':
            case 'slide-out':
                // amount には方向（'left', 'top-right' など）が入る
                let dist = 50; // デフォルトの移動距離(px)
                let tx = 0, ty = 0;
                if (amount === 'left') tx = -dist;
                else if (amount === 'right') tx = dist;
                else if (amount === 'top') ty = -dist;
                else if (amount === 'bottom') ty = dist;
                else if (amount === 'top-left') { tx = -dist; ty = -dist; }
                else if (amount === 'top-right') { tx = dist; ty = -dist; }
                else if (amount === 'bottom-left') { tx = -dist; ty = dist; }
                else if (amount === 'bottom-right') { tx = dist; ty = dist; }
                else if (amount === 'center') { tx = 0; ty = 0; }
                else { tx = -dist; } // デフォルトは左から
                
                if (type === 'slide-in') {
                    return `@keyframes ${animName} {
  0% { transform: translate(${-tx}px, ${-ty}px); opacity: 0; }
  100% { transform: translate(0, 0); opacity: 1; }
}`;
                } else {
                    return `@keyframes ${animName} {
  0% { transform: translate(0, 0); opacity: 1; }
  100% { transform: translate(${tx}px, ${ty}px); opacity: 0; }
}`;
                }
            case 'fade-in':
                return `@keyframes ${animName} {
  0% { opacity: 0; }
  100% { opacity: 1; }
}`;
            case 'fade-out':
                return `@keyframes ${animName} {
  0% { opacity: 1; }
  100% { opacity: 0; }
}`;
            case 'flash':
                return `@keyframes ${animName} {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}`;
            case 'color-fill':
                return `@keyframes ${animName} {
  100% { fill: ${amount}; }
}`;
            case 'color-line':
                return `@keyframes ${animName} {
  100% { stroke: ${amount}; }
}`;
            case 'dash-draw':
                return `@keyframes ${animName} {
  0% { stroke-dashoffset: ${amount}; }
  100% { stroke-dashoffset: 0; }
}`;
            default:
                return '';
        }
    }

    /**
     * 指定した要素にCSSアニメーションを適用する。
     * 既存の要素をラッパー <g> で包み、そのラッパーに対してアニメーションを設定する。
     * @param {SVGElement|Object} element - アニメーションを付与する要素 (SVG.js オブジェクトまたはDOM要素)
     * @param {Object} params - アニメーションパラメータ
     * @param {string} params.type - 'spin' | 'swing' | 'bounce' | 'pulse' | 'shake' | 'float' | 'flip' | 'jelly'
     * @param {number} params.amount - 変化量 (角度, ピクセル, スケール)
     * @param {number} params.dur - 再生時間 (秒)
     * @param {number} [params.delay=0] - 遅延時間 (秒)
     * @param {string} [params.easing='ease-in-out'] - イージング
     * @param {number} [params.originX] - 基準点X座標
     * @param {number} [params.originY] - 基準点Y座標
     */
    static applyCssAnimation(element, params) {
        const domNode = element.node || element;
        const svgNode = domNode.ownerSVGElement;
        if (!svgNode) return;

        const { type, amount, dur, delay = 0, easing = 'ease-in-out', originX, originY, repeat = 'infinite', trigger = 'auto', step = 1 } = params;

        // すでに該当の種類でラップされているか確認
        let wrapper = domNode.closest(`.anim-wrapper-${type}`);
        let isNewWrapper = false;

        if (!wrapper) {
            // 新規ラッパー作成（この時点ではDOMには追加しない）
            wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.setAttribute('class', `anim-wrapper-${type}`);
            isNewWrapper = true;
        }

        // [NEW] dash-draw の場合、パスの長さを計算して stroke-dasharray を設定
        let actualAmount = amount;
        if (type === 'dash-draw') {
            if (!actualAmount || actualAmount === '') {
                try {
                    actualAmount = domNode.getTotalLength ? domNode.getTotalLength() : 1000;
                    actualAmount = Math.ceil(actualAmount);
                } catch(e) {
                    actualAmount = 1000;
                }
            }
            // domNode自身にstroke-dasharrayを設定する（ラッパーではない）
            domNode.style.strokeDasharray = actualAmount;
        }

        // 一意のアニメーション名（キーフレーム名）を決定
        let animName = wrapper.getAttribute('data-anim-name');
        if (!animName) {
            const randId = Math.random().toString(36).substring(2, 8);
            animName = `anim-${type}-${randId}`;
            wrapper.setAttribute('data-anim-name', animName);
        }

        // キーフレーム定義を作成してSVG内のstyleに反映
        const keyframes = this.generateKeyframeCss(animName, type, actualAmount);
        this.updateKeyframes(svgNode, animName, keyframes);

        // ラッパーにパラメータをカスタムメタデータとして保存
        wrapper.setAttribute('data-anim-type', type);
        wrapper.setAttribute('data-anim-dur', dur);
        wrapper.setAttribute('data-anim-amount', actualAmount);
        wrapper.setAttribute('data-anim-delay', delay);
        wrapper.setAttribute('data-anim-easing', easing);
        wrapper.setAttribute('data-anim-repeat', repeat);
        wrapper.setAttribute('data-anim-trigger', trigger);
        wrapper.setAttribute('data-anim-step', step);

        // 基準点（originX, originY）の解決
        let resolvedX = originX;
        let resolvedY = originY;

        // 1. パラメータが未定義の場合、既存のラッパーや要素自体に保存されている値を遡って探す
        if (resolvedX === undefined || resolvedY === undefined || isNaN(resolvedX) || isNaN(resolvedY)) {
            let curr = domNode;
            while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                const ox = curr.getAttribute('data-origin-x');
                const oy = curr.getAttribute('data-origin-y');
                if (ox !== null && oy !== null) {
                    resolvedX = parseFloat(ox);
                    resolvedY = parseFloat(oy);
                    break;
                }
                curr = curr.parentNode;
            }
        }

        // 2. それでも解決しない場合は、要素のBBox中心をデフォルト値として適用
        // (domNode はまだ元のDOMツリーに属しているので、安全に getBBox() が呼べます)
        if (resolvedX === undefined || resolvedY === undefined || isNaN(resolvedX) || isNaN(resolvedY)) {
            try {
                const bbox = domNode.getBBox();
                resolvedX = Math.round((bbox.x + bbox.width / 2) * 10) / 10;
                resolvedY = Math.round((bbox.y + bbox.height / 2) * 10) / 10;
            } catch (e) {
                resolvedX = 0;
                resolvedY = 0;
            }
        }

        // 基準点の保存・適用
        if (resolvedX !== undefined && resolvedY !== undefined && !isNaN(resolvedX) && !isNaN(resolvedY)) {
            wrapper.setAttribute('data-origin-x', resolvedX);
            wrapper.setAttribute('data-origin-y', resolvedY);
            wrapper.style.transformOrigin = `${resolvedX}px ${resolvedY}px`;
            
            // 将来的にアニメーション種類をアンラップ/切り替える時のために、子要素自体にもマーク
            if (domNode !== wrapper) {
                domNode.setAttribute('data-origin-x', resolvedX);
                domNode.setAttribute('data-origin-y', resolvedY);
            }
        } else {
            wrapper.removeAttribute('data-origin-x');
            wrapper.removeAttribute('data-origin-y');
            wrapper.style.transformOrigin = '';
        }

        const isStyleAnimation = ['fade-in', 'fade-out', 'slide-in', 'slide-out', 'flash', 'color-fill', 'color-line', 'dash-draw'].includes(type);
        const fillMode = (isStyleAnimation && repeat !== 'infinite') ? ' both' : '';

        // Triggerの処理
        if (trigger === 'click') {
            wrapper.style.animation = ''; // 通常時はインラインアニメーションを適用しない
            wrapper.setAttribute('tabindex', '0'); // フォーカス可能にしてクリック検知
            wrapper.style.outline = 'none';
            wrapper.style.cursor = 'pointer';
            
            // ラッパーにIDがなければ生成
            if (!wrapper.id) {
                const randId = Math.random().toString(36).substring(2, 8);
                wrapper.id = `anim-wrap-${type}-${randId}`;
            }

            const animStyle = `${animName} ${dur}s ${easing} ${delay ? delay + 's ' : ''}${repeat === 'infinite' ? 'infinite' : repeat}${fillMode}`;
            const triggerClassName = `anim-trigger-${animName}`;

            const newRule = `.${triggerClassName} { animation: none !important; outline: none; }
.${triggerClassName}:focus { animation: ${animStyle} !important; outline: none; }
.${triggerClassName}:active { animation: none !important; outline: none; }
#slideshow-content .${triggerClassName} { animation: ${animStyle} !important; outline: none; }`;
            this.updateTriggerClass(svgNode, triggerClassName, newRule);

            const baseClass = wrapper.getAttribute('class').replace(new RegExp(`\\b${triggerClassName}\\b`, 'g'), '').replace('anim-paused', '').replace('anim-running', '').trim();
            wrapper.setAttribute('class', `${baseClass} ${triggerClassName}`);

            // 調査用ログ
            wrapper.addEventListener('focus', () => console.log(`[Animation] ${triggerClassName} received focus (click trigger)`));
            wrapper.addEventListener('blur', () => console.log(`[Animation] ${triggerClassName} lost focus (click trigger)`));

            // 古い <set> タグが残っていれば削除
            Array.from(wrapper.children).forEach(child => {
                if (child.tagName.toLowerCase() === 'set') {
                    child.remove();
                }
            });
        } else {
            const animStyle = `${animName} ${dur}s ${easing} ${delay ? delay + 's ' : ''}${repeat === 'infinite' ? 'infinite' : repeat}${fillMode}`;
            const triggerClassName = `anim-trigger-${animName}`;
            
            const newRule = `#preview:not(.playing-sequence) svg:not(.svg-block-focused) .${triggerClassName}:not(:focus) { animation-play-state: paused !important; outline: none; }`;
            this.updateTriggerClass(svgNode, triggerClassName, newRule);

            const baseClass = wrapper.getAttribute('class').replace(new RegExp(`\\b${triggerClassName}\\b`, 'g'), '').replace('anim-paused', '').replace('anim-running', '').trim();
            wrapper.setAttribute('class', `${baseClass} ${triggerClassName}`);
            
            wrapper.setAttribute('tabindex', '0'); // プレビューでフォーカス可能にする
            wrapper.style.outline = 'none';
            wrapper.style.cursor = 'pointer'; // クリックできることを示す
            wrapper.style.animation = animStyle;
            
            // 調査用ログ
            wrapper.addEventListener('focus', () => console.log(`[Animation] ${triggerClassName} received focus (auto trigger)`));
            wrapper.addEventListener('blur', () => console.log(`[Animation] ${triggerClassName} lost focus (auto trigger)`));

            Array.from(wrapper.children).forEach(child => {
                if (child.tagName.toLowerCase() === 'set') {
                    child.remove();
                }
            });
        }

        // 新規ラッパーの場合、ここで初めてDOMツリーに挿入して対象要素を包む
        if (isNewWrapper) {
            domNode.parentNode.insertBefore(wrapper, domNode);
            wrapper.appendChild(domNode);
        }

        // SVG.jsなどのエディタ側状態更新のために通知
        if (window.syncChanges) window.syncChanges();
        return wrapper;
    }

    /**
     * 指定した要素にモーションパスアニメーションを適用する
     * @param {SVGElement|Object} element - 対象要素
     * @param {Object} params
     * @param {string} params.pathId - 移動レールのパス要素のID（例：'#track-path'）
     * @param {number} params.dur - 1周の時間（秒）
     * @param {boolean} [params.autoRotate=true] - 自動回転するか
     */
    static applyMotionPathAnimation(element, params) {
        const domNode = element.node || element;
        const svgNode = domNode.ownerSVGElement;
        if (!svgNode) return;

        const { pathId, dur, autoRotate = true, step = 1 } = params;

        let wrapper = domNode.closest('.anim-wrapper-motion');
        let shiftGroup = null;
        let animateMotion = null;
        let mpath = null;

        // 図形の中心を計算してオフセットを相殺する
        let cx = 0;
        let cy = 0;
        try {
            const bbox = domNode.getBBox();
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
        } catch (e) {
            // BBoxの取得に失敗した場合は0とする
        }

        if (!wrapper) {
            wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.setAttribute('class', 'anim-wrapper-motion');
            
            // 図形の中心座標分だけ逆向きにシフトさせる中間のグループを作成
            shiftGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            shiftGroup.setAttribute('class', 'anim-motion-shift');
            shiftGroup.setAttribute('transform', `translate(${-cx}, ${-cy})`);

            domNode.parentNode.insertBefore(wrapper, domNode);
            shiftGroup.appendChild(domNode);
            wrapper.appendChild(shiftGroup);
        } else {
            shiftGroup = wrapper.querySelector('.anim-motion-shift');
            if (shiftGroup) {
                shiftGroup.setAttribute('transform', `translate(${-cx}, ${-cy})`);
            } else {
                shiftGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                shiftGroup.setAttribute('class', 'anim-motion-shift');
                shiftGroup.setAttribute('transform', `translate(${-cx}, ${-cy})`);
                
                // 子要素を移行
                const children = Array.from(wrapper.childNodes).filter(node => {
                    const tag = node.tagName ? node.tagName.toLowerCase() : '';
                    return tag !== 'animatemotion' && tag !== 'style';
                });
                children.forEach(child => shiftGroup.appendChild(child));
                wrapper.appendChild(shiftGroup);
            }
        }

        // 既存の <animateMotion> タグを探すか作成する
        animateMotion = wrapper.querySelector('animateMotion');
        if (!animateMotion) {
            animateMotion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
            animateMotion.setAttribute('repeatCount', 'indefinite');
            wrapper.insertBefore(animateMotion, wrapper.firstChild);
        }

        // <mpath> の構築
        mpath = animateMotion.querySelector('mpath');
        if (!mpath) {
            mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
            animateMotion.appendChild(mpath);
        }

        // パラメータの設定
        animateMotion.setAttribute('dur', `${dur}s`);
        animateMotion.setAttribute('rotate', autoRotate ? 'auto' : '0');
        mpath.setAttribute('href', pathId);
        mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', pathId);

        // メタデータの保存
        wrapper.setAttribute('data-anim-type', 'motion');
        wrapper.setAttribute('data-anim-dur', dur);
        wrapper.setAttribute('data-motion-path', pathId);
        wrapper.setAttribute('data-motion-rotate', autoRotate ? 'auto' : 'none');
        wrapper.setAttribute('data-anim-step', step);

        if (window.syncChanges) window.syncChanges();
        return wrapper;
    }

    /**
     * 要素から特定の種類のアニメーション（ラッパー）を削除する
     * @param {SVGElement|Object} element - アニメーション設定された要素またはラッパー
     * @param {string} type - 'spin' | 'swing' | 'bounce' | 'pulse' | 'shake' | 'float' | 'flip' | 'jelly' | 'motion'
     * @returns {void}
     */
    static removeAnimation(element, type) {
        const domNode = element.node || element;
        const svgNode = domNode.ownerSVGElement;
        if (!svgNode) return;

        const wrapper = domNode.closest(`.anim-wrapper-${type}`);
        if (!wrapper) return;

        const animName = wrapper.getAttribute('data-anim-name');
        if (animName) {
            this.removeKeyframes(svgNode, animName);
        }

        // ラッパーの中身を親要素に引き上げ、ラッパーを削除（アンラップ）
        const parent = wrapper.parentNode;
        while (wrapper.firstChild) {
            const child = wrapper.firstChild;
            const tagName = child.tagName ? child.tagName.toLowerCase() : '';
            if (tagName === 'animatemotion') {
                wrapper.removeChild(child);
            } else if (child.classList && child.classList.contains('anim-motion-shift')) {
                // シフト用のグループが挟まっている場合は、その中身をさらに引き上げる
                while (child.firstChild) {
                    parent.insertBefore(child.firstChild, wrapper);
                }
                wrapper.removeChild(child);
            } else {
                parent.insertBefore(child, wrapper);
            }
        }
        parent.removeChild(wrapper);

        if (window.syncChanges) window.syncChanges();
    }

    /**
     * 要素に設定されているすべてのアニメーションパラメータを取得する
     * @param {SVGElement|Object} element - 対象の要素
     * @returns {Object} 取得できたパラメータマップ
     */
    static getAnimationData(element) {
        const domNode = element.node || element;
        const result = {};

        // 入れ子の全ラッパーをチェック
        let curr = domNode;
        while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
            const classes = curr.getAttribute('class') || '';
            const match = classes.match(/anim-wrapper-([a-z-]+)/);
            if (match) {
                const type = match[1];
                const step = parseInt(curr.getAttribute('data-anim-step')) || 1;
                if (type === 'motion') {
                    result['motion'] = {
                        pathId: curr.getAttribute('data-motion-path'),
                        dur: parseFloat(curr.getAttribute('data-anim-dur')),
                        autoRotate: curr.getAttribute('data-motion-rotate') === 'auto',
                        step: step
                    };
                } else {
                    const rawAmount = curr.getAttribute('data-anim-amount');
                    const isStringAmount = ['color-fill', 'color-line', 'slide-in', 'slide-out'].includes(type);
                    result[type] = {
                        type: type,
                        amount: isStringAmount ? rawAmount : parseFloat(rawAmount),
                        dur: parseFloat(curr.getAttribute('data-anim-dur')),
                        delay: parseFloat(curr.getAttribute('data-anim-delay') || 0),
                        easing: curr.getAttribute('data-anim-easing') || 'ease-in-out',
                        originX: parseFloat(curr.getAttribute('data-origin-x')),
                        originY: parseFloat(curr.getAttribute('data-origin-y')),
                        repeat: curr.getAttribute('data-anim-repeat') || 'infinite',
                        trigger: curr.getAttribute('data-anim-trigger') || 'auto',
                        step: step
                    };
                }
            }
            curr = curr.parentNode;
        }

        return result;
    }

    /**
     * 親要素の変形（移動/拡大縮小など）に伴い、
     * メタデータ（data-origin-*）に紐づく基準点（transform-origin）を再計算・更新する
     * @param {SVGElement} element - アニメーションラッパー、または対象の要素
     * @param {number} dx - X軸移動差分
     * @param {number} dy - Y軸移動差分
     * @param {number} scaleX - X軸拡大率
     * @param {number} scaleY - Y軸拡大率
     */
    static updateTransformOriginOnElementChange(element, dx, dy, scaleX = 1, scaleY = 1) {
        const domNode = element.node || element;
        
        // 自身または親階層にあるアニメーションラッパーを走査
        let curr = domNode;
        while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
            const classes = curr.getAttribute('class') || '';
            if (classes.includes('anim-wrapper-')) {
                const oxStr = curr.getAttribute('data-origin-x');
                const oyStr = curr.getAttribute('data-origin-y');
                
                if (oxStr !== null && oyStr !== null) {
                    let ox = parseFloat(oxStr);
                    let oy = parseFloat(oyStr);
                    
                    // 座標の再計算（移動の加算とスケール適用）
                    ox = ox * scaleX + dx;
                    oy = oy * scaleY + dy;
                    
                    // 丸め処理
                    ox = Math.round(ox * 10) / 10;
                    oy = Math.round(oy * 10) / 10;

                    curr.setAttribute('data-origin-x', ox);
                    curr.setAttribute('data-origin-y', oy);
                    curr.style.transformOrigin = `${ox}px ${oy}px`;
                    
                    console.log(`[AnimationOrigin] Updated Transform Origin to (${ox}, ${oy}) for wrapper:`, curr.className);
                }
            }
            curr = curr.parentNode;
        }
    }
}

// グローバル公開
window.SvgAnimationManager = SvgAnimationManager;
