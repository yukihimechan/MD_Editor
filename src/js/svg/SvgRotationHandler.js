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

            const isCanvas = this.activeElement.getAttribute('data-is-canvas') === 'true' ||
                this.activeElement.classList.contains('svg-canvas-proxy');
            const isLocked = this.activeElement.getAttribute('data-locked') === 'true' ||
                this.activeElement.getAttribute('data-locked') === true;

            if (isCanvas || isLocked) return;

            this.isRotating = true;
            try { e.target.setPointerCapture(e.pointerId); } catch(err) {}

            const root = this.activeElement && this.activeElement.ownerSVGElement;
            if (root && window.SVGUtils) {
                window.SVGUtils.startHandleScaleLoop(root, 'rotate');
            }

            this.createAngleDisplay();

            // [FIX] 接続図形の取得
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
                                    if (!shapeEl) return;
                                    if (shapeEl.tagName !== 'g' && shapeEl.parentNode) {
                                        const parentG = shapeEl.closest('g[data-tool-id="shape-text-group"]');
                                        if (parentG) shapeEl = parentG;
                                    }
                                    if (this.connectedShapes.find(s => s.el === shapeEl)) return;
                                    
                                    const wrappedShape = window.SVG ? window.SVG(shapeEl) : SVG(shapeEl);
                                    this.connectedShapes.push({
                                        el: shapeEl,
                                        startMatrix: wrappedShape.matrix()
                                    });
                                    const tId = shapeEl.getAttribute('data-associated-text-id');
                                    if (tId) { const tEl = document.getElementById(tId); if (tEl) addShape(tEl); }
                                    const sId = shapeEl.getAttribute('data-associated-shape-id');
                                    if (sId) { const sEl = document.getElementById(sId); if (sEl) addShape(sEl); }
                                };
                                addShape(target);
                            }
                        }
                    });
                } catch (e) {
                    console.error('Failed to parse data-connections for rotation', e);
                }
            }

            // [FIX] コネクタ線の場合、過去のtransformが残っていると軸がズレるため、完全にクリアして引き直す
            if (this.connectedShapes.length > 0) {
                this.activeElement.removeAttribute('transform');
                if (window.SVGConnectorManager && typeof window.SVGConnectorManager.updateConnectionsFromElement === 'function') {
                    this.connectedShapes.forEach(shape => {
                        const svgjsEl = shape.el.instance || (typeof window.SVG === 'function' ? window.SVG(shape.el) : shape.el);
                        if (svgjsEl) window.SVGConnectorManager.updateConnectionsFromElement(svgjsEl);
                    });
                }
            }

            const bbox = this.activeElement.getBBox();
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
            
            // コネクタ線の場合は0（上でクリアしたため）。単一図形の場合は既存の角度を取得
            this.startElementRotation = (this.connectedShapes.length > 0) ? 0 : this.getRotationAngle(this.activeElement);

            // [FIX] 線の初期マトリックスと回転中心を保存
            const wrappedActive = window.SVG ? window.SVG(this.activeElement) : SVG(this.activeElement);
            this.startLineMatrix = wrappedActive.matrix();
            this.globalCenter = (window.SVG ? new window.SVG.Point(localCx, localCy) : new SVG.Point(localCx, localCy)).transform(this.startLineMatrix);

            window.addEventListener('pointermove', this.handleRotationMove);
            window.addEventListener('pointerup', this.handleRotationEnd);
            window.addEventListener('pointercancel', this.handleRotationEnd);
            
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
        if (!this.isRotating || !this.activeElement) return;
        e.preventDefault();
        e.stopPropagation();

        const dx = e.clientX - this.centerPoint.x;
        const dy = e.clientY - this.centerPoint.y;

        const currentMouseAngle = Math.atan2(dy, dx);
        let deltaRad = currentMouseAngle - this.startMouseAngle;
        let deltaDeg = deltaRad * (180 / Math.PI);

        if (deltaDeg > 180) deltaDeg -= 360;
        else if (deltaDeg < -180) deltaDeg += 360;

        if (this.isFlipped) deltaDeg = -deltaDeg;

        let angleDeg = this.startElementRotation + deltaDeg;
        const shiftKey = e.shiftKey || (window.currentEditingSVG && window.currentEditingSVG.isShiftPressed);
        const isOrthogonal = this.activeElement.getAttribute('data-tool-id') === 'orthogonal_line';

        if (isOrthogonal) angleDeg = Math.round(angleDeg / 90) * 90;
        else if (shiftKey) angleDeg = Math.round(angleDeg / 15) * 15;

        const appliedDeltaDeg = angleDeg - this.startElementRotation;
        angleDeg = (angleDeg % 360 + 360) % 360;

        const hasConnectedShapes = this.connectedShapes && this.connectedShapes.length > 0;

        // [FIX] コネクタ線の場合は線自身に直接 rotate(...) を適用しない
        if (!hasConnectedShapes) {
            this.applyRotation(angleDeg);
        }

        this.updateAngleDisplay(angleDeg);
        
        // [FIX] 接続図形と線を一体としてマトリックスで回転させる
        if (hasConnectedShapes && this.globalCenter) {
            const SvgMatrix = window.SVG ? window.SVG.Matrix : SVG.Matrix;
            const rotMatrix = new SvgMatrix().rotate(appliedDeltaDeg, this.globalCenter.x, this.globalCenter.y);
            
            // 線自身を回転
            if (this.startLineMatrix) {
                const newLineMatrix = rotMatrix.multiply(this.startLineMatrix);
                this.activeElement.setAttribute('transform', `matrix(${newLineMatrix.a},${newLineMatrix.b},${newLineMatrix.c},${newLineMatrix.d},${newLineMatrix.e},${newLineMatrix.f})`);
            }

            // 接続図形を回転
            this.connectedShapes.forEach(shape => {
                const newMatrix = rotMatrix.multiply(shape.startMatrix);
                shape.el.setAttribute('transform', `matrix(${newMatrix.a},${newMatrix.b},${newMatrix.c},${newMatrix.d},${newMatrix.e},${newMatrix.f})`);
            });
        }

        const bbox = this.activeElement.getBBox();
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

            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(line, zoomVal);
                window.SVGUtils.updateHandleScaling(circle, zoomVal);
            }
        }

        if (window.currentEditingSVG) {
            if (window.currentEditingSVG.radiusHandler) window.currentEditingSVG.radiusHandler.update(this.overlayGroup, this.activeElement, bbox);
            if (window.currentEditingSVG.polylineHandler) window.currentEditingSVG.polylineHandler.update(this.overlayGroup, this.activeElement, bbox);
        }

        if (window.updateTransformToolbarValues) window.updateTransformToolbarValues();

        if (this.activeElement && this.activeElement.dispatchEvent) {
            this.activeElement.dispatchEvent(new CustomEvent('rotatemove'));
        }

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
        if (root && window.SVGUtils) window.SVGUtils.stopHandleScaleLoop(root);

        if (this._syncRaf) {
            cancelAnimationFrame(this._syncRaf);
            this._syncRaf = null;
        }

        window.removeEventListener('pointermove', this.handleRotationMove);
        window.removeEventListener('pointerup', this.handleRotationEnd);
        window.removeEventListener('pointercancel', this.handleRotationEnd);
        try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}

        if (this.angleDisplay) {
            this.angleDisplay.remove();
            this.angleDisplay = null;
        }

        if (window.currentEditingSVG) window.currentEditingSVG._isOperationInProgress = false;

        // [FIX] 回転終了時に図形の座標をBakeし、線は純粋な座標で結び直す
        if (this.connectedShapes && this.connectedShapes.length > 0) {
            this.connectedShapes.forEach(shape => {
                const svgjsEl = shape.el.instance || (typeof window.SVG === 'function' ? window.SVG(shape.el) : null);
                const inst = svgjsEl && typeof svgjsEl.remember === 'function' ? svgjsEl.remember('_shapeInstance') : null;
                if (inst && typeof inst.bakeTransformation === 'function') inst.bakeTransformation(true);
            });

            // 線自身の transform をクリアする
            if (this.activeElement) {
                this.activeElement.removeAttribute('transform');
                const svgjsEl = this.activeElement.instance || (typeof window.SVG === 'function' ? window.SVG(this.activeElement) : null);
                if (svgjsEl && svgjsEl.node) {
                    svgjsEl.node.removeAttribute('transform');
                    if (svgjsEl._matrix) svgjsEl._matrix = null;
                }
            }

            // 最後に1回だけコネクタマネージャを呼び出して線を正しい位置に引き直す
            this.connectedShapes.forEach(shape => {
                if (window.SVGConnectorManager && typeof window.SVGConnectorManager.updateConnectionsFromElement === 'function') {
                    const svgjsEl = shape.el.instance || (typeof window.SVG === 'function' ? window.SVG(shape.el) : shape.el);
                    window.SVGConnectorManager.updateConnectionsFromElement(svgjsEl);
                }
            });

            // 選択枠（青枠）の同期
            const lineSvgjsEl = this.activeElement.instance || (typeof window.SVG === 'function' ? window.SVG(this.activeElement) : null);
            const lineInst = lineSvgjsEl && typeof lineSvgjsEl.remember === 'function' ? lineSvgjsEl.remember('_shapeInstance') : null;
            if (lineInst && typeof lineInst.syncSelectionHandlers === 'function') {
                setTimeout(() => lineInst.syncSelectionHandlers(null, true), 10);
            }
        }

        if (this.syncCallback) this.syncCallback(true);
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
