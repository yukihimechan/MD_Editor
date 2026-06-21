/**
 * SVG Rotation Handler
 * Handles rotation logic, handle creation, and coordinate transformations for SVG elements.
 */
class SvgRotationHandler {
    constructor(container, syncCallback) {
        this.container = container;
        this.syncCallback = syncCallback;
        this.svg = container.querySelector('svg');
        this.activeElement = null;
        this.overlayGroup = null;
        this.rotationHandle = null;
        this.angleDisplay = null;
        this.isRotating = false;

        // Bind methods
        this.handleRotationStart = this.handleRotationStart.bind(this);
        this.handleRotationMove = this.handleRotationMove.bind(this);
        this.handleRotationEnd = this.handleRotationEnd.bind(this);
    }

    /**
     * Get current rotation angle of an element
     */
    getRotationAngle(element) {
        if (!element) return 0;
        const transform = element.getAttribute('transform') || '';
        const match = transform.match(/rotate\(([-\d.]+)/);
        return match ? parseFloat(match[1]) : 0;
    }

    /**
     * Update rotation handle and overlay for the selected element
     * @param {SVGElement} overlayGroup - The selection overlay group
     * @param {SVGElement} targetElement - The actual selected element (or group)
     * @param {Object} bbox - Bounding box of the target element {x, y, width, height}
     */
    update(overlayGroup, targetElement, bbox) {
        this.overlayGroup = overlayGroup;
        this.activeElement = targetElement;

        // [NEW] Disable rotation for Root SVG or Canvas Proxy (Absolute Guard)
        // This is called by StandardShape (shows handle) or CanvasShape (hides handle)
        const isCanvas = !targetElement ||
            targetElement.tagName.toLowerCase() === 'svg' ||
            targetElement.getAttribute('data-is-canvas') === 'true' ||
            targetElement.classList.contains('svg-canvas-proxy');

        if (isCanvas) {
            this.hide();
            return;
        }

        // Remove existing handle if any
        if (this.rotationHandle) {
            this.rotationHandle.remove();
            this.rotationHandle = null;
        }
        // [FIX] Thorough cleanup of any rotation handles (custom or library-generated)
        const orphanCustom = overlayGroup.querySelectorAll('.rotation-handle-group');
        orphanCustom.forEach(h => h.remove());

        // Also try to hide library's internal rotation handle if it exists
        const libRot = overlayGroup.querySelector('.svg_select_handle_rot, .svg-select-handle-rot');
        if (libRot) {
            libRot.setAttribute('display', 'none');
            libRot.style.display = 'none';
        }

        if (this.angleDisplay) this.angleDisplay.remove();

        // Get current rotation
        const currentAngle = this.getRotationAngle(targetElement);

        // Apply rotation to the overlay group to match the element
        // We rotate around the center of the bounding box
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;

        // Update overlay transformation to match target's rotation
        // This makes the 8-point markers rotate with the object
        // Note: targetElement already has the rotation transform. 
        // If we are drawing markers based on UNROTATED BBox (which getCombinedBBox usually returns for geometric bounds),
        // then applying rotation to the overlay group is correct.
        // However, if getCombinedBBox returns the axis-aligned bbox of the ALREADY ROTATED element, we shouldn't double-rotate.
        // *Assumption*: getCombinedBBox (standard getBBox()) returns local coordinate box for a single element,
        // but for a group or multiple selection, we might need careful handling.
        // For single element (or <g>), getBBox() is in local user space (untransformed).
        // So we apply the same transform to the overlay.


        // Calculate Absolute Positions using getCTM
        const ctm = targetElement.getCTM();
        const svg = this.svg;

        // [FIX] Transform local point to Screen, then back to Overlay's local space
        // This is necessary because the selection overlay might have its own transform
        const toOverlayLocal = (lx, ly) => {
            if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
                return window.SVGUtils.mapLocalToOverlay({ x: lx, y: ly }, targetElement, overlayGroup);
            }
            // Fallback
            const p = svg.createSVGPoint();
            p.x = lx;
            p.y = ly;
            return p.matrixTransform(targetElement.getCTM()); // Fallback
        };

        const absCenter = toOverlayLocal(cx, bbox.y + bbox.height / 2); // Center of rotation (local)
        // Wait, the center should be relative to the BBox center in local space
        const localCx = bbox.x + bbox.width / 2;
        const localCy = bbox.y + bbox.height / 2;
        const absBoxCenter = toOverlayLocal(localCx, localCy);

        // [FIX] 従来の SVG 上の回転ハンドルの描画を無効化し、フローティングツールバーの独立ハンドルに委譲する
        // 以前のロジック（ハンドルと線の描画）はコメントアウトするか実行しないようにします。
        /*
        // [FIX] Dynamic handle distance based on zoom
        const zoomVal = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
        const handleDistance = 25 * (100 / zoomVal);

        const absTopCenter = toOverlayLocal(localCx, bbox.y);
        const absHandlePos = toOverlayLocal(localCx, bbox.y - handleDistance);

        // Create Handle Group
        const handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        handleGroup.setAttribute('class', 'rotation-handle-group');
        handleGroup.style.cursor = 'grab';

        // 1. Connection Line (Use absolute points)
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', absTopCenter.x);
        line.setAttribute('y1', absTopCenter.y);
        line.setAttribute('x2', absHandlePos.x);
        line.setAttribute('y2', absHandlePos.y);
        line.setAttribute('stroke', '#0366d6');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '3 3');

        handleGroup.appendChild(line);

        // 2. Handle Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', absHandlePos.x);
        circle.setAttribute('cy', absHandlePos.y);
        circle.setAttribute('r', '6');
        circle.setAttribute('fill', 'white');
        circle.setAttribute('stroke', '#0366d6');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('class', 'rotation-handle'); // [CSS Target]

        handleGroup.appendChild(circle);

        // Add to overlay
        overlayGroup.appendChild(handleGroup);
        this.rotationHandle = handleGroup;

        // [NEW] DOMマウント後にサイズ補正を適用（getScreenCTMを機能させるため）
        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
            window.SVGUtils.updateHandleScaling(line);
            window.SVGUtils.updateHandleScaling(circle);
        }

        // Attach Event Listeners
        // Use pointer events for broad support
        handleGroup.addEventListener('pointerdown', this.handleRotationStart);
        */
    }

    /**
     * Forcefully hide and destroy rotation UI
     */
    hide() {
        if (this.overlayGroup) {
            const existingHandles = this.overlayGroup.querySelectorAll('.rotation-handle-group');
            existingHandles.forEach(h => h.remove());
            this.overlayGroup.setAttribute('transform', '');
        }

        if (this.rotationHandle) {
            this.rotationHandle.remove();
            this.rotationHandle = null;
        }
        if (this.angleDisplay) {
            this.angleDisplay.remove();
            this.angleDisplay = null;
        }
        this.activeElement = null; // Block further actions
    }

    handleRotationStart(e) {
        e.preventDefault();
        e.stopPropagation();

        try {
            if (!this.activeElement) return;

            if (window.currentEditingSVG) {
                window.currentEditingSVG._isOperationInProgress = true;
                if (typeof window.startSVGUndoTracking === 'function') window.startSVGUndoTracking();
            }

            // [GUARD] Double check if it's canvas or locked
            const isCanvas = this.activeElement.getAttribute('data-is-canvas') === 'true' ||
                this.activeElement.classList.contains('svg-canvas-proxy');
            const isLocked = this.activeElement.getAttribute('data-locked') === 'true' ||
                this.activeElement.getAttribute('data-locked') === true;

            if (isCanvas || isLocked) {
                console.warn('[ROTATION GUARD] Prevented start on canvas or locked element.');
                return;
            }

            this.isRotating = true;
            try { e.target.setPointerCapture(e.pointerId); } catch(err) {}

            const root = this.activeElement && this.activeElement.ownerSVGElement;
            if (root && window.SVGUtils) {
                window.SVGUtils.startHandleScaleLoop(root, 'rotate');
            }

            // Show Angle Display
            this.createAngleDisplay();

            // Calculate Center Point (Global coordinates)
            const svgRect = this.svg.getBoundingClientRect();
            const bbox = this.activeElement.getBBox();

            // Convert local SVG coordinates to client coordinates
            const ctm = this.activeElement.getScreenCTM();
            const localCx = bbox.x + bbox.width / 2;
            const localCy = bbox.y + bbox.height / 2;

            this.centerPoint = {
                x: localCx * ctm.a + localCy * ctm.c + ctm.e,
                y: localCx * ctm.b + localCy * ctm.d + ctm.f
            };

            this.isFlipped = false;
            if (ctm) {
                const det = ctm.a * ctm.d - ctm.b * ctm.c;
                this.isFlipped = det < 0;
            }

            const dx = e.clientX - this.centerPoint.x;
            const dy = e.clientY - this.centerPoint.y;
            this.startMouseAngle = Math.atan2(dy, dx);
            this.startElementRotation = this.getRotationAngle(this.activeElement);

            // [NEW] 線の回転中心をグローバル座標系で保存
            const lineMatrix = window.SVG ? new window.SVG.Matrix(this.activeElement) : new SVG.Matrix(this.activeElement);
            this.globalCenter = (window.SVG ? new window.SVG.Point(localCx, localCy) : new SVG.Point(localCx, localCy)).transform(lineMatrix);

            // [NEW] 接続図形とその初期マトリックスを記録
            this.connectedShapes = [];
            const connStr = this.activeElement.getAttribute('data-connections');
            if (connStr) {
                try {
                    const conns = JSON.parse(connStr);
                    conns.forEach(c => {
                        if (c.targetId) {
                            const target = document.getElementById(c.targetId);
                            if (target) {
                                const addShape = (shapeEl) => {
                                    if (this.connectedShapes.find(s => s.el === shapeEl)) return;
                                    this.connectedShapes.push({
                                        el: shapeEl,
                                        startMatrix: window.SVG ? new window.SVG.Matrix(shapeEl) : new SVG.Matrix(shapeEl)
                                    });
                                    const tId = shapeEl.getAttribute('data-associated-text-id');
                                    if (tId) {
                                        const tEl = document.getElementById(tId);
                                        if (tEl) addShape(tEl);
                                    }
                                    const sId = shapeEl.getAttribute('data-associated-shape-id');
                                    if (sId) {
                                        const sEl = document.getElementById(sId);
                                        if (sEl) addShape(sEl);
                                    }
                                };
                                addShape(target);
                            }
                        }
                    });
                } catch (e) {
                    console.error('Failed to parse data-connections for rotation', e);
                }
            }

            // Bind move/up listeners to window
            window.addEventListener('pointermove', this.handleRotationMove);
            window.addEventListener('pointerup', this.handleRotationEnd);
            window.addEventListener('pointercancel', this.handleRotationEnd);
            
            console.log('[SvgRotationHandler] handleRotationStart completed successfully.');
        } catch (error) {
            console.error('[SvgRotationHandler] Error in handleRotationStart:', error);
            this.isRotating = false;
        }
    }

    createAngleDisplay() {
        if (this.angleDisplay) this.angleDisplay.remove();

        this.angleDisplay = document.createElement('div');
        this.angleDisplay.className = 'rotation-angle-display';
        this.angleDisplay.style.position = 'absolute';
        this.angleDisplay.style.background = 'rgba(0, 0, 0, 0.7)';
        this.angleDisplay.style.color = 'white';
        this.angleDisplay.style.padding = '4px 8px';
        this.angleDisplay.style.borderRadius = '4px';
        this.angleDisplay.style.fontSize = '12px';
        this.angleDisplay.style.pointerEvents = 'none';
        this.angleDisplay.style.zIndex = '10000';
        this.container.appendChild(this.angleDisplay);

        this.updateAngleDisplay(this.getRotationAngle(this.activeElement));
    }

    updateAngleDisplay(angle) {
        if (this.angleDisplay) {
            // Position display near the mouse or center?
            // Usually near the cursor is good, but we update in move handler
            this.angleDisplay.textContent = `${Math.round(angle)}°`;
        }
    }

    handleRotationMove(e) {
        if (!this.isRotating || !this.activeElement) {
            return;
        }
        e.preventDefault();
        
        console.log('[SvgRotationHandler] handleRotationMove', e.clientX, e.clientY);
        e.stopPropagation();

        const dx = e.clientX - this.centerPoint.x;
        const dy = e.clientY - this.centerPoint.y;

        // [FIX] Calculate relative angle change from the start of the drag
        const currentMouseAngle = Math.atan2(dy, dx);
        let deltaRad = currentMouseAngle - this.startMouseAngle;
        let deltaDeg = deltaRad * (180 / Math.PI);

        // Normalize delta to -180...180 range to handle PI boundary crossings smoothly
        if (deltaDeg > 180) deltaDeg -= 360;
        else if (deltaDeg < -180) deltaDeg += 360;

        // [FIX] 反転している場合はドラッグ角度変化の方向を反転させる
        if (this.isFlipped) {
            deltaDeg = -deltaDeg;
        }

        let angleDeg = this.startElementRotation + deltaDeg;

        const shiftKey = e.shiftKey || (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed);
        const isOrthogonal = this.activeElement.getAttribute('data-tool-id') === 'orthogonal_line';

        if (isOrthogonal) {
            // [NEW] 直角折れ線は90度単位でのみ回転可能にする
            angleDeg = Math.round(angleDeg / 90) * 90;
        } else if (shiftKey) {
            // Snap to 15 degree increments
            angleDeg = Math.round(angleDeg / 15) * 15;
        }

        // Normalize 0-360 for display and attribute consistency
        angleDeg = (angleDeg % 360 + 360) % 360;
        
        // [NEW] スナップ処理後の実際の回転変化量を算出（接続図形の回転用）
        const appliedDeltaDeg = angleDeg - this.startElementRotation;

        // Update Element Transform
        this.applyRotation(angleDeg);

        // Update Display
        this.updateAngleDisplay(angleDeg);
        
        // [NEW] 接続図形に、線の中心を軸にした回転を適用する
        if (this.connectedShapes && this.connectedShapes.length > 0 && this.globalCenter) {
            const rotMatrix = new SVG.Matrix().rotate(appliedDeltaDeg, this.globalCenter.x, this.globalCenter.y);
            this.connectedShapes.forEach(shape => {
                const newMatrix = rotMatrix.multiply(shape.startMatrix);
                shape.el.setAttribute('transform', `matrix(${newMatrix.a},${newMatrix.b},${newMatrix.c},${newMatrix.d},${newMatrix.e},${newMatrix.f})`);
            });
        }

        // Retrieve latest center (local) for rotate transform
        // We assume center doesn't move during rotation
        const bbox = this.activeElement.getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;

        // [FIX] Refresh handle position relative to overlay during rotation
        const localCx = bbox.x + bbox.width / 2;
        const zoomVal = (window.currentEditingSVG && window.currentEditingSVG.zoom) || 100;
        const handleDistance = 25 * (100 / zoomVal);

        const nodeMatrix = this.activeElement.getScreenCTM();
        const overlayMatrix = this.overlayGroup.getScreenCTM();

        if (this.rotationHandle && nodeMatrix && overlayMatrix) {
            const invOverlay = overlayMatrix.inverse();

            const pTop = this.svg.createSVGPoint();
            pTop.x = localCx;
            pTop.y = bbox.y;
            const absTop = pTop.matrixTransform(nodeMatrix).matrixTransform(invOverlay);

            const pHandle = this.svg.createSVGPoint();
            pHandle.x = localCx;
            pHandle.y = bbox.y - handleDistance;
            const absHandle = pHandle.matrixTransform(nodeMatrix).matrixTransform(invOverlay);

            const line = this.rotationHandle.querySelector('line');
            const circle = this.rotationHandle.querySelector('circle');
            if (line) {
                line.setAttribute('x1', absTop.x);
                line.setAttribute('y1', absTop.y);
                line.setAttribute('x2', absHandle.x);
                line.setAttribute('y2', absHandle.y);
            }
            if (circle) {
                circle.setAttribute('cx', absHandle.x);
                circle.setAttribute('cy', absHandle.y);
            }

            // [NEW] Update Scaling during rotation 
            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(line, zoomVal);
                window.SVGUtils.updateHandleScaling(circle, zoomVal);
            }
        }

        // [NEW] Real-time sync for radius handler
        if (window.currentEditingSVG && window.currentEditingSVG.radiusHandler) {
            window.currentEditingSVG.radiusHandler.update(this.overlayGroup, this.activeElement, bbox);
        }

        // [NEW] Sync radius and polyline handlers in real-time if they exist
        if (window.currentEditingSVG) {
            if (window.currentEditingSVG.radiusHandler) {
                window.currentEditingSVG.radiusHandler.update(this.overlayGroup, this.activeElement, bbox);
            }
            if (window.currentEditingSVG.polylineHandler) {
                window.currentEditingSVG.polylineHandler.update(this.overlayGroup, this.activeElement, bbox);
            }
        }

        if (window.updateTransformToolbarValues) window.updateTransformToolbarValues();

        // [NEW] 接続されている線をリアルタイムに更新
        if (window.SVGConnectorManager) {
            window.SVGConnectorManager.updateConnectionsFromElement(this.activeElement);
        }

        // [NEW] 矢印ツールなどのマーカー追従用のイベントを発火
        if (this.activeElement && this.activeElement.dispatchEvent) {
            this.activeElement.dispatchEvent(new CustomEvent('rotatemove'));
        }

        // [FIX] 回転ドラッグ中に8点リサイズハンドルも図形に追従させる
        // rAF で間引いてパフォーマンスへの影響を最小化する
        if (!this._syncRaf) {
            this._syncRaf = requestAnimationFrame(() => {
                this._syncRaf = null;
                if (!this.activeElement) return;
                const svgjsEl = this.activeElement.instance ||
                    (typeof window.SVG === 'function' ? window.SVG(this.activeElement) : null);
                const shape = svgjsEl && svgjsEl.remember &&
                    svgjsEl.remember('_shapeInstance');
                if (shape && typeof shape.syncSelectionHandlers === 'function') {
                    shape.syncSelectionHandlers(null, true);
                }
            });
        }
    }

    handleRotationEnd(e) {
        this.isRotating = false;

        const root = this.activeElement && this.activeElement.ownerSVGElement;
        if (root && window.SVGUtils) {
            window.SVGUtils.stopHandleScaleLoop(root);
        }

        // [FIX] 回転中のrAF間引き同期をキャンセル
        if (this._syncRaf) {
            cancelAnimationFrame(this._syncRaf);
            this._syncRaf = null;
        }

        // Cleanup listeners
        window.removeEventListener('pointermove', this.handleRotationMove);
        window.removeEventListener('pointerup', this.handleRotationEnd);
        window.removeEventListener('pointercancel', this.handleRotationEnd);
        try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}

        // Remove Display
        if (this.angleDisplay) {
            this.angleDisplay.remove();
            this.angleDisplay = null;
        }

        if (window.currentEditingSVG) {
            window.currentEditingSVG._isOperationInProgress = false;
        }

        // Sync to editor
        if (this.syncCallback) {
            this.syncCallback();
        }
    }

    applyRotation(angle) {
        const el = this.activeElement;
        if (!el) return;

        // [GUARD] No rotation for canvas
        const isCanvas = el.getAttribute('data-is-canvas') === 'true' ||
            el.classList.contains('svg-canvas-proxy');
        if (isCanvas) return;

        // Get center
        const bbox = el.getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;

        // Construct transform string
        // Preserve other transforms? (e.g. translate)
        // Current implementation often overwrites transform or appends.
        // Robust approach: Manage transform list, but string parsing is easier for now.

        let transform = el.getAttribute('transform') || '';

        // Remove existing rotate
        transform = transform.replace(/rotate\([^)]+\)/g, '').trim();

        // Add new rotate
        const newRotate = `rotate(${angle}, ${cx}, ${cy})`;

        // Determine order: typically translate then rotate for local rotation
        // But SVG transform order implies coordinate system changes.
        // If we want to rotate around center IN PLACE, the rotate(a, cx, cy) shorthand works well
        // regardless of existing translations if cx/cy are local coordinates.
        // Simply appending it usually works if cx/cy are correct local BBox centers.

        if (transform) {
            el.setAttribute('transform', `${transform} ${newRotate}`);
        } else {
            el.setAttribute('transform', newRotate);
        }
    }

}

// Export for use in app.js
if (typeof window !== 'undefined') {
    window.SvgRotationHandler = SvgRotationHandler;
}
