/**
 * SVG Marquee (Rubber-band) Selection
 * - Shift+ドラッグ（選択中の図形がゼロのとき）で範囲選択を開始する。
 * - 当たり判定は Contain（完全内包）方式：マーキー矩形に外接矩形が完全に収まる図形のみ選択。
 * - 図形の上からドラッグを開始しても範囲選択になる（要件③「背景が図形でもOK」）。
 * - 移動の無い純粋なクリックは、カーソル下の図形を選択に追加する（要件①を再現）。
 */
(function () {
    'use strict';

    // 内部UI要素（選択枠・グリッド・ハンドル・ヒットエリア等）の判定
    function isInternalNode(node) {
        if (!node || node.nodeType !== 1) return true;
        if (node.getAttribute && node.getAttribute('data-internal') === 'true') return true;
        const cls = (node.getAttribute && node.getAttribute('class')) || '';
        return /svg-canvas-proxy|svg-canvas-border|svg-grid|svg_select|svg-select|svg-marquee|svg-interaction-hitarea|svg-snap-guides|svg-spacing|svg-control-marker|handle-group|svg-ruler/.test(cls);
    }

    // world座標系のAABBを取得
    function worldBox(el) {
        const b = el.bbox().transform(el.matrix());
        return { x: b.x, y: b.y, x2: b.x + b.width, y2: b.y + b.height };
    }

    // ★ Contain判定：マーキー矩形に完全内包される図形だけを選択
    function selectShapesInBox(draw, box) {
        draw.children().forEach((child) => {
            const node = child.node;
            if (isInternalNode(node)) return;
            const tag = node.tagName.toLowerCase();
            if (['defs', 'style', 'marker', 'symbol', 'metadata', 'title', 'desc'].includes(tag)) return;

            let b;
            try { b = worldBox(child); } catch (e) { return; }
            if ((b.x2 - b.x) <= 0 && (b.y2 - b.y) <= 0) return;

            const contained = (b.x >= box.x && b.x2 <= box.x2 && b.y >= box.y && b.y2 <= box.y2);
            if (contained) {
                if (typeof makeInteractive === 'function') makeInteractive(child);
                if (typeof selectElement === 'function') selectElement(child, true);
            }
        });
    }

    // 純粋なクリック（移動なし）時に、カーソル下の最前面の図形（ルート直下の選択単位）を解決
    function pickShapeAt(clientX, clientY, draw) {
        const stack = document.elementsFromPoint(clientX, clientY);
        for (const node of stack) {
            if (!draw.node.contains(node)) continue;
            if (isInternalNode(node)) continue;
            // ルート直下の要素（＝選択単位）まで遡上
            let n = node;
            while (n && n.parentNode !== draw.node && n !== draw.node) n = n.parentNode;
            if (n && n.parentNode === draw.node && !isInternalNode(n)) {
                return (typeof SVG === 'function') ? SVG(n) : null;
            }
        }
        return null;
    }

    function initMarqueeSelect(current, draw) {
        if (!current || !draw || !draw.node) return;

        const start = { x: 0, y: 0 };
        let active = false, moved = false, rect = null, downEvt = null;
        let wasDeselectedOnDown = false; // mousedown時に即時解除されたかどうかのフラグ


        const move = (e) => {
            if (!active) return;
            const cur = window.currentEditingSVG;
            const zoom = (cur && cur.zoom) || 100;
            const p = draw.point(e.clientX, e.clientY);
            console.log('[Marquee Debug] move: active=' + active + ' moved=' + moved + ' px=' + p.x.toFixed(1) + ' py=' + p.y.toFixed(1) + ' clientX=' + e.clientX + ' clientY=' + e.clientY);
            // 微小移動はクリック扱い（しきい値：画面上 約3px）
            if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3 * (100 / zoom)) return;
            moved = true;

            const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
            const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
            if (!rect) {
                rect = draw.rect(w, h).attr({
                    'class': 'svg-marquee-selection',
                    'data-internal': 'true',
                    'fill': '#2196F3',
                    'fill-opacity': 0.1,
                    'stroke': '#2196F3',
                    'stroke-dasharray': '4,4',
                    'stroke-width': 1,
                    'vector-effect': 'non-scaling-stroke',
                    'pointer-events': 'none'
                }).front();
            }
            rect.move(x, y).size(w, h);
        };

        const up = () => {
            console.log('[Marquee Debug] up: active=' + active + ' moved=' + moved + ' hasRect=' + (!!rect));
            window.removeEventListener('mousemove', move, true);
            window.removeEventListener('mouseup', up, true);
            if (!active) return;
            active = false;

            if (moved && rect) {
                // 範囲選択を確定（Contain）→ 要件③
                const box = {
                    x: rect.x(), y: rect.y(),
                    x2: rect.x() + rect.width(), y2: rect.y() + rect.height()
                };
                if (typeof deselectAll === 'function') deselectAll(); // 念のため初期化
                selectShapesInBox(draw, box);
            } else if (downEvt) {
                // mousedown時に選択解除された図形の場合は再選択しない
                if (!wasDeselectedOnDown) {
                    // 純粋なクリック → カーソル下の図形を選択に追加（要件①の再現。選択ゼロので実質「単一選択」）
                    const shape = pickShapeAt(downEvt.clientX, downEvt.clientY, draw);
                    if (shape) {
                        if (typeof makeInteractive === 'function') makeInteractive(shape);
                        if (typeof selectElement === 'function') selectElement(shape, true);
                    }
                }
            }

            if (rect) { rect.remove(); rect = null; }
            downEvt = null;
            wasDeselectedOnDown = false;
        };

        const down = (e) => {
            const cur = window.currentEditingSVG;
            console.log('[Marquee Debug] down: hasCur=' + (!!cur) + ' tool=' + (typeof window.SVGToolbar !== 'undefined' ? window.SVGToolbar.currentTool : 'undefined') + ' button=' + e.button + ' shift=' + e.shiftKey + ' ctrl=' + e.ctrlKey + ' size=' + (cur?.selectedElements ? cur.selectedElements.size : 'null') + ' target=' + (e.target ? e.target.tagName + '#' + e.target.id : 'null'));
            if (!cur) return;
            if (typeof window.SVGToolbar !== 'undefined' && window.SVGToolbar.currentTool !== 'select') return;
            if (e.button !== 0 || !e.shiftKey || e.ctrlKey) return;
            if (cur.isSpacePressed || cur.isPanning) return;

            wasDeselectedOnDown = false;

            // 選択状態で Shift＋マウスボタンダウン が発生した場合、即座に選択解除する
            if (cur.selectedElements.size > 0) {
                if (e.target.closest && e.target.closest('.svg-toolbar, .svg-inline-editor')) return;
                
                // クリック位置にある最前面の本物の図形要素を取得
                const clickedShape = pickShapeAt(e.clientX, e.clientY, draw);
                if (clickedShape) {
                    // その図形がすでに選択されているかどうかをチェック
                    let targetSelection = null;
                    for (const sel of cur.selectedElements) {
                        if (sel && sel.node === clickedShape.node) {
                            targetSelection = sel;
                            break;
                        }
                    }

                    if (targetSelection) {
                        // 選択済みの図形をクリックした場合は、即座に選択解除する
                        if (typeof deselectElement === 'function') {
                            deselectElement(targetSelection);
                        }
                        
                        wasDeselectedOnDown = true; // フラグをセット

                        // イベントの伝播やデフォルト動作を完全に遮断
                        e.preventDefault();
                        e.stopPropagation();

                        // 範囲選択をそのまま開始するための登録
                        const p = draw.point(e.clientX, e.clientY);
                        start.x = p.x; start.y = p.y;
                        active = true; moved = false; downEvt = e;
                        window.addEventListener('mousemove', move, true);
                        window.addEventListener('mouseup', up, true);
                        return;
                    }
                }
                
                // 最前面の図形が未選択の図形である場合、あるいは図形が無い（背景など）場合は、
                // 即時選択解除は行わず、イベントを伝播させて通常の Shift+クリック（追加選択）が走るようにする
                return;
            }

            if (cur.selectedElements.size !== 0) return;               // 要件④：選択ありなら起動しない
            if (e.target.closest && e.target.closest('.svg-toolbar, .svg-inline-editor')) return;

            // 図形の選択・ドラッグ起動を確実に抑止（要件③：背景が図形でもOK）
            e.preventDefault();
            e.stopPropagation();

            const p = draw.point(e.clientX, e.clientY);
            start.x = p.x; start.y = p.y;
            active = true; moved = false; downEvt = e;
            window.addEventListener('mousemove', move, true);
            window.addEventListener('mouseup', up, true);
        };

        draw.node.addEventListener('mousedown', down, true); // キャプチャ登録
        current._marqueeDownHandler = down;                  // stopSVGEdit でクリーンアップ
    }

    window.initMarqueeSelect = initMarqueeSelect;
})();
