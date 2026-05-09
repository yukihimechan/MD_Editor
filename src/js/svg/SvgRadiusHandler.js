/**
 * SVG Radius Handler
 * Handles the graphical adjustment of rounded corner radius (rx/ry) for rect elements.
 */
class SvgRadiusHandler {
    constructor(container, syncCallback) {
        this.container = container;
        this.syncCallback = syncCallback;
        this.svg = container.querySelector('svg');
        this.activeElement = null; // The rect element
        this.overlayGroup = null;
        this.handleGroup = null;
        this.handle = null;
        this.isDragging = false;
        this.startPos = { x: 0, y: 0 };
        this.startRadius = 0;

        // Bindings
        this.onDragStart = this.onDragStart.bind(this);
        this.onDragMove = this.onDragMove.bind(this);
        this.onDragEnd = this.onDragEnd.bind(this);
    }

    /**
     * Create or update the radius adjustment handle
     * @param {SVGElement} overlayGroup - The selection overlay group
     * @param {SVGElement} targetElement - The actual rect element
     * @param {Object} bbox - BBox of targetElement
     */
    update(overlayGroup, targetElement, bbox) {
        // [GUARD] Only valid for rects
        if (!targetElement || targetElement.tagName.toLowerCase() !== 'rect') {
            this.hide();
            return;
        }

        this.activeElement = targetElement;
        this.overlayGroup = overlayGroup;

        // [FIX] Reuse existing handle instead of hiding/recreating every time
        // This makes real-time updates (during rotation) much smoother.
        const isUpdateOnly = !!this.handle;

        // [FIX] Robust rx retrieval
        let rx = 0;
        const rxAttr = targetElement.getAttribute('rx') || targetElement.getAttribute('data-radius');
        if (rxAttr) {
            rx = parseFloat(rxAttr);
            if (isNaN(rx)) rx = 0;
        }


        // Create Handle Group First if not exists
        let g = this.handleGroup;
        if (!g) {
            g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'radius-handle-group');
            g.style.cursor = 'ew-resize';
            this.handleGroup = g;
        }

        // [FIX] Use ScreenCTM composition to calculate coordinates relative to the overlay group
        // This ensures the handle stays on the corner even when rotated or scaled
        const svgPoint = this.svg.createSVGPoint();
        svgPoint.x = bbox.x + rx;
        svgPoint.y = bbox.y;

        const nodeMatrix = targetElement.getScreenCTM();
        const overlayMatrix = overlayGroup.getScreenCTM();

        let handlePos;
        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
            handlePos = window.SVGUtils.mapLocalToOverlay({ x: bbox.x + rx, y: bbox.y }, targetElement, overlayGroup);
        } else {
            // Screen to Screen calculation composition if utils missing
            const nodeMatrix = targetElement.getScreenCTM();
            const overlayMatrix = overlayGroup.getScreenCTM();
            const svgPoint = this.svg.createSVGPoint();
            svgPoint.x = bbox.x + rx; svgPoint.y = bbox.y;

            if (nodeMatrix && overlayMatrix) {
                const screenP = svgPoint.matrixTransform(nodeMatrix);
                handlePos = screenP.matrixTransform(overlayMatrix.inverse());
            } else {
                handlePos = svgPoint.matrixTransform(targetElement.getCTM());
            }
        }


        // Create or Update Circle
        let circle = this.handle;
        if (!circle) {
            circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', '6');
            circle.setAttribute('fill', '#FFDD00');
            circle.setAttribute('stroke', '#000000');
            circle.setAttribute('stroke-width', '1.5');
            circle.setAttribute('class', 'radius-handle'); // [CSS Target]
            circle.style.pointerEvents = 'all';
            g.appendChild(circle);
            this.handle = circle;

            // [NEW] Dynamic Scaling for radius handle
            if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                window.SVGUtils.updateHandleScaling(circle);
            }

            overlayGroup.appendChild(g);
            g.addEventListener('pointerdown', this.onDragStart);
        }

        circle.setAttribute('cx', handlePos.x);
        circle.setAttribute('cy', handlePos.y);

        // [FIX] Ensure the handle group is still in the overlay (library might have cleared it)
        if (this.handleGroup && !this.handleGroup.parentNode) {
            this.overlayGroup.appendChild(this.handleGroup);
        }

        // [REMOVED] refreshHandleSizes is now a no-op handled by CSS
    }

    hide() {
        if (this.handleGroup) {
            this.handleGroup.remove();
            this.handleGroup = null;
            this.handle = null;
        }
    }

    onDragStart(e) {
        e.preventDefault();
        e.stopPropagation();

        if (!this.activeElement) return;

        // [LOCK GUARD]
        if (this.activeElement.getAttribute('data-locked') === 'true' || this.activeElement.getAttribute('data-locked') === true) {
            console.warn(`[RADIUS GUARD] Blocked for ${this.activeElement.id()}`);
            return;
        }

        this.isDragging = true;
        this.container.setPointerCapture(e.pointerId);

        // Screen to SVG coordinate mapping
        const ctm = this.activeElement.getScreenCTM();
        const p = this.svg.createSVGPoint();
        p.x = e.clientX;
        p.y = e.clientY;
        const svgP = p.matrixTransform(ctm.inverse());

        this.startPos = { x: svgP.x, y: svgP.y };

        let rx = 0;
        const rxAttr = this.activeElement.getAttribute('rx') || this.activeElement.getAttribute('data-radius');
        if (rxAttr) {
            rx = parseFloat(rxAttr);
            if (isNaN(rx)) rx = 0;
        }
        this.startRadius = rx;

        document.addEventListener('pointermove', this.onDragMove);
        document.addEventListener('pointerup', this.onDragEnd);
        document.addEventListener('pointercancel', this.onDragEnd);
    }

    onDragMove(e) {
        if (!this.isDragging || !this.activeElement) return;

        const ctm = this.activeElement.getScreenCTM();
        const p = this.svg.createSVGPoint();
        p.x = e.clientX;
        p.y = e.clientY;
        const svgP = p.matrixTransform(ctm.inverse());

        const dx = svgP.x - this.startPos.x;
        const bbox = this.activeElement.getBBox();
        const rectW = bbox.width;

        // Calculate new rx
        let newRx = this.startRadius + dx;

        // [NEW] Snap to grid on Alt Key
        const isAlt = SVGUtils.isSnapEnabled(e);
        if (isAlt) {
            const gridConfig = (typeof AppState !== 'undefined' && AppState.config.grid) || { size: 15 };
            const snapSize = gridConfig.size || 15;
            newRx = Math.round(newRx / snapSize) * snapSize;
        }

        // Constraints: 0 <= rx <= width/2
        const maxRx = rectW / 2;
        newRx = Math.max(0, Math.min(maxRx, newRx));

        // Update target
        this.activeElement.setAttribute('rx', newRx);
        this.activeElement.setAttribute('ry', newRx);

        // Metadata update
        this.activeElement.setAttribute('data-radius', newRx);

        // Update handle visual position using updated CTM composition
        if (this.handle) {
            const currentBbox = this.activeElement.getBBox();
            const svgPoint = this.svg.createSVGPoint();
            svgPoint.x = currentBbox.x + newRx;
            svgPoint.y = currentBbox.y;

            const nodeMatrix = this.activeElement.getScreenCTM();
            const overlayMatrix = this.overlayGroup.getScreenCTM();

            if (nodeMatrix && overlayMatrix) {
                const screenP = svgPoint.matrixTransform(nodeMatrix);
                const handlePos = screenP.matrixTransform(overlayMatrix.inverse());
                this.handle.setAttribute('cx', handlePos.x);
                this.handle.setAttribute('cy', handlePos.y);

                // [NEW] Update Scaling during drag 
                if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
                    window.SVGUtils.updateHandleScaling(this.handle);
                }
            }
        }
    }

    onDragEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;

        document.removeEventListener('pointermove', this.onDragMove);
        document.removeEventListener('pointerup', this.onDragEnd);
        document.removeEventListener('pointercancel', this.onDragEnd);
        this.container.releasePointerCapture(e.pointerId);

        if (this.syncCallback) {
            this.syncCallback();
        }
    }

}

window.SvgRadiusHandler = SvgRadiusHandler;
