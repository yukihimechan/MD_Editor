
/**
 * SVG Editor Properties UI
 * - Property Dialog
 * - Done Button
 * - Cleanup Utils
 */

// --- Property Editor ---
// (Preserved from original but adjusted for native DOM usage if needed)
// Note: We use showPropertyEditor logic from original code.
// Since it uses DOM APIs (getAttribute, setAttribute), it works on el.node.

function showPropertyEditor(element, svgIndex, container) {
    const existingDialog = document.querySelector('.svg-property-dialog');
    if (existingDialog) {
        existingDialog.remove();
        const existingStyle = document.getElementById('svg-property-dialog-style');
        if (existingStyle) existingStyle.remove();
    }

    const dialog = document.createElement('div');
    dialog.className = 'svg-property-dialog';
    dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:25px;border:1px solid #ccc;box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10000;width:400px;height:auto;max-height:90vh;display:flex;flex-direction:column;border-radius:12px;';

    const isCanvas = element.tagName.toLowerCase() === 'svg';
    const fill = isCanvas ? (element.style.backgroundColor || 'transparent') : (element.getAttribute('fill') || '#000000');
    const stroke = element.getAttribute('stroke') || '#000000';
    const strokeWidth = element.getAttribute('stroke-width') || '1';
    const textContent = element.tagName === 'text' ? element.textContent : '';

    // [NEW] 固有プロパティの取得
    const toolId = element.getAttribute('data-tool-id');
    const radius = element.getAttribute('rx') || element.getAttribute('data-radius') || '10';
    const spikes = element.getAttribute('data-spikes') || '5';
    const sides = element.getAttribute('data-sides') || '6';
    const fontSize = element.getAttribute('font-size') || '20';

    const style = document.createElement('style');
    style.id = 'svg-property-dialog-style';
    style.textContent = `
        .svg-prop-row { margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
        .svg-prop-label { font-size: 14px; font-weight: 500; color: #333; }
        .svg-color-preview { width: 40px; height: 24px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; display: inline-block; }
        .pcr-button { width: 40px !important; height: 24px !important; border: 1px solid #ccc !important; border-radius: 4px !important; }
        .pcr-app { z-index: 15000 !important; }
    `;
    document.head.appendChild(style);

    dialog.innerHTML = `
        <h3 style="margin-top:0;margin-bottom:20px;font-size:18px;font-weight:600;">${isCanvas ? '' : ''}</h3>
        <div style="flex: 1; overflow-y: auto; margin-bottom: 20px;">
            <div class="svg-prop-row">
                <span class="svg-prop-label">${isCanvas ? '背景色' : '塗りつぶし色'}</span>
                <div id="fill-picker-trigger" class="svg-color-preview" style="background: ${fill === 'none' ? 'transparent' : fill};"></div>
            </div>
            <div class="svg-prop-row">
                <span class="svg-prop-label">枠線色</span>
                <div id="stroke-picker-trigger" class="svg-color-preview" style="background: ${stroke};"></div>
            </div>
            <div class="svg-prop-row">
                <span class="svg-prop-label">枠線幅</span>
                <input type="number" id="svg-stroke-width" value="${strokeWidth}" min="0" step="0.5" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:4px;">
            </div>
            ${element.tagName === 'text' ? `
            <div class="svg-prop-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <span class="svg-prop-label">テキスト</span>
                <input type="text" id="svg-text" value="${textContent}" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid #ddd; border-radius:4px;">
            </div>
            <div class="svg-prop-row">
                <span class="svg-prop-label">フォントサイズ</span>
                <input type="number" id="svg-font-size" value="${fontSize}" min="8" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:4px;">
            </div>` : ''}
            ${toolId === 'rounded' ? `
            <div class="svg-prop-row">
                <span class="svg-prop-label">角の半径</span>
                <input type="number" id="svg-radius" value="${radius}" min="0" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:4px;">
            </div>` : ''}
            ${toolId === 'star' ? `
            <div class="svg-prop-row">
                <span class="svg-prop-label">星の角数</span>
                <input type="number" id="svg-spikes" value="${spikes}" min="3" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:4px;">
            </div>` : ''}
            ${toolId === 'polygon' ? `
            <div class="svg-prop-row">
                <span class="svg-prop-label">多角形の辺数</span>
                <input type="number" id="svg-sides" value="${sides}" min="3" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:4px;">
            </div>` : ''}
        </div>
        <div style="text-align:right; border-top: 1px solid #eee; padding-top: 15px; display:flex; gap:12px; justify-content:flex-end;">
            <button id="svg-prop-cancel" style="padding:8px 16px; border:1px solid #ddd; background:#fff; color:#333; cursor:pointer; border-radius:4px;">取消</button>
            <button id="svg-prop-ok" style="padding:8px 16px; border:none; background:#0366d6; color:white; cursor:pointer; border-radius:4px; font-weight:500;">保存</button>
        </div>
    `;

    document.body.appendChild(dialog);
    const stopProp = (e) => e.stopPropagation();
    dialog.addEventListener('click', stopProp);
    dialog.addEventListener('mousedown', stopProp);

    let currentFill = (fill === 'none' || !fill) ? 'none' : fill;
    let currentStroke = stroke || '#000000';

    const createPickr = (elName, defaultColor, onChangeCallback) => {
        const trigger = dialog.querySelector(elName);
        if (!trigger || typeof ColorPickerUI === 'undefined') return null;

        const initialStr = defaultColor === 'none' ? 'rgba(0,0,0,0)' : defaultColor;
        trigger.style.cssText = `width: 24px; height: 24px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background-color: ${defaultColor === 'none' ? 'transparent' : initialStr};`;

        const picker = new ColorPickerUI({
            color: initialStr,
            isPopup: true,
            onChange: (color) => {
                const hex = color.toHexString(true);
                const val = color.a === 0 ? 'none' : hex;
                trigger.style.backgroundColor = val === 'none' ? 'transparent' : val;
                onChangeCallback(val);
            }
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            picker.show(trigger);
        });
        return picker;
    };

    const fillPicker = createPickr('#fill-picker-trigger', currentFill, (val) => currentFill = val);
    const strokePicker = createPickr('#stroke-picker-trigger', currentStroke, (val) => currentStroke = val);

    dialog.querySelector('#svg-prop-ok').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        try {
            window.currentEditingSVG.selectedElements.forEach(targetElObj => {
                const isTargetCanvas = targetElObj.type === 'svg';
                if (isTargetCanvas) {
                    targetElObj.node.style.backgroundColor = currentFill;
                } else {
                    targetElObj.fill(currentFill);
                    targetElObj.stroke({ color: currentStroke, width: dialog.querySelector('#svg-stroke-width').value });

                    // [NEW] 矢印マーカーの更新
                    if (window.SVGToolbar && typeof window.SVGToolbar.updateArrowMarkers === 'function') {
                        window.SVGToolbar.updateArrowMarkers(targetElObj);
                    }

                    // [NEW] 各プロパティの更新
                    const tId = targetElObj.node.getAttribute('data-tool-id');
                    if (tId === 'rounded' && dialog.querySelector('#svg-radius')) {
                        const r = parseFloat(dialog.querySelector('#svg-radius').value);
                        targetElObj.radius(r);
                    } else if (tId === 'star' && dialog.querySelector('#svg-spikes')) {
                        const s = parseInt(dialog.querySelector('#svg-spikes').value);
                        const r = parseFloat(targetElObj.node.getAttribute('data-radius') || 50);
                        targetElObj.attr('data-spikes', s);
                        targetElObj.plot(SVGUtils.calculateStarPoints(r, s));
                    } else if (tId === 'polygon' && dialog.querySelector('#svg-sides')) {
                        const s = parseInt(dialog.querySelector('#svg-sides').value);
                        const r = parseFloat(targetElObj.node.getAttribute('data-radius') || 50);
                        targetElObj.attr('data-sides', s);
                        targetElObj.plot(SVGUtils.calculatePolygonPoints(r, s));
                    }

                    if (targetElObj.type === 'text') {
                        const txt = dialog.querySelector('#svg-text').value;
                        const fz = dialog.querySelector('#svg-font-size').value;
                        targetElObj.font({ size: fz });
                        
                        // [FIX] .text() メソッドは tspan や textPath を破壊するため、直接 DOM にアクセスする
                        const textNode = targetElObj.node;
                        const innerNode = textNode.querySelector('tspan') || textNode.querySelector('textPath');
                        if (innerNode) {
                            innerNode.textContent = txt;
                        } else {
                            targetElObj.text(txt);
                        }
                    }
                }
            });
            syncChanges();
            [fillPicker, strokePicker].forEach(p => { if (p && p.destroy) p.destroy(); });
            style.remove();
            dialog.remove();
        } catch (err) { console.error('Error applying SVG properties:', err); }
    });

    dialog.querySelector('#svg-prop-cancel').addEventListener('click', () => {
        [fillPicker, strokePicker].forEach(p => { if (p && p.destroy) p.destroy(); });
        style.remove();
        dialog.remove();
    });
}
window.showPropertyEditor = showPropertyEditor;

// --- Done Button UI ---

function showDoneButton(container) {
    let btn = document.getElementById('svg-editor-done-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'svg-editor-done-btn';
        btn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.done') || '' : '';
        btn.className = 'inline-done-btn'; // Reuse inline editor style
        btn.onclick = (e) => {
            e.stopPropagation();
            if (window.currentEditingSVG) {
                console.log(`[svg_properties] Done Click - Current Zoom: ${window.currentEditingSVG.zoom}%`);
            }
            if (typeof stopSVGEdit === 'function') stopSVGEdit();
        };
        document.body.appendChild(btn);
    }

    let expandBtn = document.getElementById('svg-editor-expand-btn');
    if (!expandBtn) {
        expandBtn = document.createElement('button');
        expandBtn.id = 'svg-editor-expand-btn';
        expandBtn.textContent = typeof I18n !== 'undefined' ? I18n.translate('editor.expandView') || '拡大画面' : '拡大画面';
        expandBtn.className = 'inline-done-btn'; // Reuse inline editor style class
        expandBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof showSVGExpandedView === 'function') showSVGExpandedView();
        };
        document.body.appendChild(expandBtn);
    }

    // Show buttons
    btn.style.display = 'block';
    expandBtn.style.display = 'block';

    // [NEW] リサイズハンドルも初期化
    if (typeof showResizeHandle === 'function') showResizeHandle(container);

    // Initial position update
    updateDoneButtonPosition();

    // Add scroll/resize listeners for sticky positioning
    // We store the handler on the button element to remove it later easily, 
    // or just use a named function if we could, but closure is easier here.
    // Let's attach it to window.currentEditingSVG to be clean.
    if (window.currentEditingSVG) {
        window.currentEditingSVG.doneDetailHandler = () => updateDoneButtonPosition();
        window.addEventListener('scroll', window.currentEditingSVG.doneDetailHandler, { capture: true, passive: true });
        window.addEventListener('resize', window.currentEditingSVG.doneDetailHandler);
    }
}
window.showDoneButton = showDoneButton;

function hideDoneButton() {
    const btn = document.getElementById('svg-editor-done-btn');
    if (btn) btn.remove();

    // [NEW] 拡大画面ボタンも削除
    const expandBtn = document.getElementById('svg-editor-expand-btn');
    if (expandBtn) expandBtn.remove();

    // [NEW] リサイズハンドルも削除
    const resizer = document.getElementById('svg-editor-resizer');
    if (resizer) resizer.remove();

    if (window.currentEditingSVG && window.currentEditingSVG.doneDetailHandler) {
        window.removeEventListener('scroll', window.currentEditingSVG.doneDetailHandler, { capture: true });
        window.removeEventListener('resize', window.currentEditingSVG.doneDetailHandler);
        window.currentEditingSVG.doneDetailHandler = null;
    }
}
window.hideDoneButton = hideDoneButton;

function updateDoneButtonPosition() {
    const btn = document.getElementById('svg-editor-done-btn');
    const expandBtn = document.getElementById('svg-editor-expand-btn');
    const resizer = document.getElementById('svg-editor-resizer');
    if (!btn || !window.currentEditingSVG || !window.currentEditingSVG.container) return;

    // 拡大画面表示中はボタンを隠す
    const expandedDialog = document.getElementById('svg-expanded-dialog');
    if (expandedDialog) {
        btn.style.display = 'none';
        if (expandBtn) expandBtn.style.display = 'none';
        if (resizer) resizer.style.display = 'none';
        return;
    } else {
        btn.style.display = 'block';
        if (expandBtn) expandBtn.style.display = 'block';
        if (resizer) resizer.style.display = 'block';
    }

    // Use logic similar to table_editor.js
    btn.style.position = 'fixed';
    btn.style.right = 'auto';
    btn.style.width = 'auto';
    if (expandBtn) {
        expandBtn.style.position = 'fixed';
        expandBtn.style.right = 'auto';
        expandBtn.style.width = 'auto';
    }

    const containerRect = window.currentEditingSVG.container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Vertical Position: Sticky to Top of visible Container area
    // Just a bit of padding from the top (e.g. 60px to clear header if any)
    let top = Math.max(containerRect.top, 60);
    const limitBottom = containerRect.bottom - btnRect.height - 10;

    // If container is scrolled out of view, hide or limit?
    if (top > limitBottom) top = limitBottom;

    // Horizontal Position: Sticky to Right
    const padding = 20;
    const visibleRight = Math.min(containerRect.right, viewportWidth);
    let left = visibleRight - btnRect.width - padding;

    // Safety
    if (left < containerRect.left + padding) {
        left = Math.max(left, containerRect.left + padding);
    }

    // Apply to done button
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.style.zIndex = '10005'; // Ensure above context menu or others

    // [NEW] 拡大画面ボタンは完了ボタンの下に配置
    if (expandBtn) {
        const buttonGap = 10; // ボタン間の間隔
        expandBtn.style.top = (top + btnRect.height + buttonGap) + 'px';
        expandBtn.style.left = left + 'px';
        expandBtn.style.zIndex = '10005';
    }

    // [NEW] リサイズハンドルの位置更新
    if (resizer) {
        resizer.style.position = 'fixed';
        resizer.style.top = (containerRect.bottom - 4) + 'px';
        resizer.style.left = containerRect.left + 'px';
        resizer.style.width = containerRect.width + 'px';
    }
}

/**
 * [NEW] Show Resize Handle for Viewport (Blue/Green Dashed Frame)
 */
function showResizeHandle(container) {
    let resizer = document.getElementById('svg-editor-resizer');
    if (!resizer) {
        resizer = document.createElement('div');
        resizer.id = 'svg-editor-resizer';
        resizer.className = 'svg-editor-resizer';
        resizer.title = 'ドラッグして高さを変更';
        document.body.appendChild(resizer);

        resizer.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startY = e.clientY;
            const startHeight = (window.currentEditingSVG && window.currentEditingSVG.baseHeight) || 450;
            const containerNode = window.currentEditingSVG.container;

            const onMouseMove = (moveEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const newH = Math.max(50, startHeight + deltaY);
                updateSVGHeight(newH);

                // [NEW] リサイズ中にハンドルの位置を追従させる
                if (typeof updateDoneButtonPosition === 'function') {
                    updateDoneButtonPosition();
                }
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if (typeof syncChanges === 'function') syncChanges(false);

                // キャンバスプロキシ側の状態も同期させる（ハンドル位置の補正用）
                if (window.currentEditingSVG && window.currentEditingSVG.canvasProxy) {
                    const inst = window.currentEditingSVG.canvasProxy.remember('_shapeInstance');
                    if (inst && typeof inst.updateCanvasUI === 'function') {
                        inst.updateCanvasUI(true);
                    }
                }
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };
    }
}

/**
 * [NEW] Update SVG Root Height and Base dimensions
 */
function updateSVGHeight(newHeight) {
    const current = window.currentEditingSVG;
    if (!current) return;

    current.baseHeight = newHeight;
    const svgNode = current.draw.node;
    svgNode.setAttribute('height', newHeight);
    svgNode.setAttribute('data-paper-height', newHeight);

    // キャンバス境界枠 (青実線)
    if (current.canvasBorder) {
        current.canvasBorder.attr('height', newHeight);
    }

    // キャンバスプロキシ (透明)
    if (current.canvasProxy) {
        const inset = current.canvasInset || 4;
        current.canvasProxy.attr('height', Math.max(10, newHeight - inset * 2));
    }

    // ビューポート (viewBox) の同期
    if (current.applyZoomPan) {
        current.applyZoomPan();
    }
}
window.updateDoneButtonPosition = updateDoneButtonPosition;

/**
 * [NEW] Clean up unused marker definitions
 * @param {Element} svgElement - The cloned SVG DOM element
 */
function cleanupUnusedMarkers(svgElement) {
    const defs = svgElement.querySelector('defs');
    if (!defs) return;

    // Find all marker elements
    const markers = Array.from(defs.querySelectorAll('marker'));
    if (markers.length === 0) return;

    // Collect all marker IDs that are actually referenced
    const usedMarkerIds = new Set();
    const markerAttributes = ['marker-start', 'marker-end', 'marker-mid'];

    svgElement.querySelectorAll('*').forEach(el => {
        markerAttributes.forEach(attr => {
            const value = el.getAttribute(attr);
            if (value) {
                // Extract ID from url(#id) format
                const match = value.match(/url\(#(.+?)\)/);
                if (match) {
                    usedMarkerIds.add(match[1]);
                }
            }
        });
    });

    // Remove unused markers
    markers.forEach(marker => {
        const markerId = marker.getAttribute('id');
        if (markerId && !usedMarkerIds.has(markerId)) {
            marker.remove();
        }
    });
}
window.cleanupUnusedMarkers = cleanupUnusedMarkers;



