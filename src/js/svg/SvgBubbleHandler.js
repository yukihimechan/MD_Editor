// SvgBubbleHandler.js
class SvgBubbleHandler {
    constructor(container, onUpdate) {
        this.container = container;
        this.onUpdate = onUpdate;
        this.handleGroup = null;
        this.activeNode = null;
        this.overlayGroup = null;
    }

    update(overlayGroup, node, bbox) {
        if (!node || node.getAttribute('data-tool-id') !== 'bubble') {
            this.hide();
            return;
        }

        this.activeNode = node;
        this.overlayGroup = overlayGroup || this.overlayGroup;
        bbox = bbox || this.activeNode.getBBox();

        if (!this.overlayGroup) return;

        if (!this.handleGroup) {
            this.handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            this.handleGroup.setAttribute('class', 'bubble-handle-group');
            this.overlayGroup.appendChild(this.handleGroup);
        }

        while (this.handleGroup.firstChild) {
            this.handleGroup.removeChild(this.handleGroup.firstChild);
        }

        const opts = this.getTailOptions();

        // Calculate world coordinates for handles
        const rootPt = this.calculateRootPoint(opts, bbox);
        const endPt = this.calculateEndPoint(opts, bbox);

        // Map to overlay coordinates
        const handleRootPt = this.getHandlePoint([rootPt.x, rootPt.y]);
        const handleEndPt = this.getHandlePoint([endPt.x, endPt.y]);

        // Calculate Width Handle position (edge of tail root)
        const widthPt = this.calculateWidthPoint(opts, bbox);
        const handleWidthPt = this.getHandlePoint([widthPt.x, widthPt.y]);

        // Draw Width Handle (Orange)
        const widthCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        widthCircle.setAttribute('r', '5');
        widthCircle.setAttribute('fill', '#FF8C00'); // Orange
        widthCircle.setAttribute('stroke', '#000000');
        widthCircle.setAttribute('stroke-width', '1');
        widthCircle.setAttribute('cursor', 'ew-resize');
        if (opts.side === 'left' || opts.side === 'right') widthCircle.setAttribute('cursor', 'ns-resize');
        widthCircle.setAttribute('class', 'bubble-width-handle'); // [CSS Target]
        widthCircle.setAttribute('data-type', 'bubble-width');
        widthCircle.setAttribute('cx', handleWidthPt.x);
        widthCircle.setAttribute('cy', handleWidthPt.y);
        this.handleGroup.appendChild(widthCircle);

        // Draw Root Handle
        const rootCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        rootCircle.setAttribute('r', '6');
        rootCircle.setAttribute('fill', '#FFDD00');
        rootCircle.setAttribute('stroke', '#000000');
        rootCircle.setAttribute('stroke-width', '1.5');
        rootCircle.setAttribute('cursor', 'pointer');
        rootCircle.setAttribute('class', 'bubble-root-handle'); // [CSS Target]
        rootCircle.setAttribute('data-type', 'bubble-root');
        rootCircle.setAttribute('cx', handleRootPt.x);
        rootCircle.setAttribute('cy', handleRootPt.y);
        this.handleGroup.appendChild(rootCircle);

        // Draw End Handle
        const endCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        endCircle.setAttribute('r', '6');
        endCircle.setAttribute('fill', '#FFDD00');
        endCircle.setAttribute('stroke', '#000000');
        endCircle.setAttribute('stroke-width', '1.5');
        endCircle.setAttribute('cursor', 'move');
        endCircle.setAttribute('class', 'bubble-end-handle'); // [CSS Target]
        endCircle.setAttribute('data-type', 'bubble-end');
        endCircle.setAttribute('cx', handleEndPt.x);
        endCircle.setAttribute('cy', handleEndPt.y);
        this.handleGroup.appendChild(endCircle);

        // Add visual link line between root and end
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', handleRootPt.x);
        line.setAttribute('y1', handleRootPt.y);
        line.setAttribute('x2', handleEndPt.x);
        line.setAttribute('y2', handleEndPt.y);
        line.setAttribute('stroke', '#FFDD00');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '2,2');

        // [NEW] Dynamic Scaling for all bubble handles
        if (window.SVGUtils && window.SVGUtils.updateHandleScaling) {
            window.SVGUtils.updateHandleScaling(widthCircle);
            window.SVGUtils.updateHandleScaling(rootCircle);
            window.SVGUtils.updateHandleScaling(endCircle);
            window.SVGUtils.updateHandleScaling(line);
        }

        this.handleGroup.insertBefore(line, this.handleGroup.firstChild);

        this.bindRootDrag(rootCircle);
        this.bindEndDrag(endCircle);
        this.bindWidthDrag(widthCircle);

        if (this.handleGroup.parentNode !== this.overlayGroup) {
            this.overlayGroup.appendChild(this.handleGroup);
        }
    }

    getTailOptions() {
        return {
            side: this.activeNode.getAttribute('data-tail-side') || 'bottom',
            pos: parseFloat(this.activeNode.getAttribute('data-tail-pos')) || 20,
            tailW: parseFloat(this.activeNode.getAttribute('data-tail-width') || 10),
            tx: this.activeNode.hasAttribute('data-tail-tx') && this.activeNode.getAttribute('data-tail-tx') !== 'undefined' ? parseFloat(this.activeNode.getAttribute('data-tail-tx')) : undefined,
            ty: this.activeNode.hasAttribute('data-tail-ty') && this.activeNode.getAttribute('data-tail-ty') !== 'undefined' ? parseFloat(this.activeNode.getAttribute('data-tail-ty')) : undefined
        };
    }

    calculateRootPoint(opts, bbox) {
        let tailW = opts.tailW || 10;
        let w = parseFloat(this.activeNode.getAttribute('data-width'));
        if (isNaN(w)) w = bbox.width || 100;
        let h = parseFloat(this.activeNode.getAttribute('data-height'));
        if (isNaN(h)) h = bbox.height || 100;
        let rx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
        if (isNaN(rx)) rx = bbox.x || 0;
        let ry = parseFloat(this.activeNode.getAttribute('data-rect-y'));
        if (isNaN(ry)) ry = bbox.y || 0;

        let pos = isNaN(opts.pos) ? 20 : opts.pos;
        let lx = 0, ly = 0;

        if (opts.side === 'top') {
            lx = pos + tailW / 2; ly = 0;
        } else if (opts.side === 'bottom') {
            lx = pos + tailW / 2; ly = h;
        } else if (opts.side === 'left') {
            lx = 0; ly = pos + tailW / 2;
        } else if (opts.side === 'right') {
            lx = w; ly = pos + tailW / 2;
        }

        return new SVG.Point(lx + rx, ly + ry);
    }

    calculateEndPoint(opts, bbox) {
        let tailW = opts.tailW || 10;
        let w = parseFloat(this.activeNode.getAttribute('data-width'));
        if (isNaN(w)) w = bbox.width || 100;
        let h = parseFloat(this.activeNode.getAttribute('data-height'));
        if (isNaN(h)) h = bbox.height || 100;
        let rx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
        if (isNaN(rx)) rx = bbox.x || 0;
        let ry = parseFloat(this.activeNode.getAttribute('data-rect-y'));
        if (isNaN(ry)) ry = bbox.y || 0;

        let pos = isNaN(opts.pos) ? 20 : opts.pos;
        let tx = opts.tx;
        let ty = opts.ty;

        if (tx === undefined || isNaN(tx) || ty === undefined || isNaN(ty)) {
            if (opts.side === 'bottom') {
                tx = pos + tailW / 2 - 5; ty = h + 15;
            } else if (opts.side === 'top') {
                tx = pos + tailW / 2 - 5; ty = -15;
            } else if (opts.side === 'left') {
                tx = -15; ty = pos + tailW / 2 - 5;
            } else if (opts.side === 'right') {
                tx = w + 15; ty = pos + tailW / 2 - 5;
            }
        }

        return new SVG.Point(tx + rx, ty + ry);
    }

    calculateWidthPoint(opts, bbox) {
        let tailW = opts.tailW || 10;
        let w = parseFloat(this.activeNode.getAttribute('data-width'));
        if (isNaN(w)) w = bbox.width || 100;
        let h = parseFloat(this.activeNode.getAttribute('data-height'));
        if (isNaN(h)) h = bbox.height || 100;
        let rx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
        if (isNaN(rx)) rx = bbox.x || 0;
        let ry = parseFloat(this.activeNode.getAttribute('data-rect-y'));
        if (isNaN(ry)) ry = bbox.y || 0;

        let pos = isNaN(opts.pos) ? 20 : opts.pos;
        let lx = 0, ly = 0;

        // Position the handle at the "end" side of the tail root
        if (opts.side === 'top') {
            lx = pos + tailW; ly = 0;
        } else if (opts.side === 'bottom') {
            lx = pos + tailW; ly = h;
        } else if (opts.side === 'left') {
            lx = 0; ly = pos + tailW;
        } else if (opts.side === 'right') {
            lx = w; ly = pos + tailW;
        }

        return new SVG.Point(lx + rx, ly + ry);
    }

    getHandlePoint(ptArr) {
        if (window.SVGUtils && window.SVGUtils.mapLocalToOverlay) {
            return window.SVGUtils.mapLocalToOverlay(ptArr, this.activeNode, this.overlayGroup);
        }

        try {
            const svg = this.activeNode.ownerSVGElement || document.querySelector('svg.svg-editable');
            if (!svg) return { x: ptArr[0], y: ptArr[1] };

            const p = svg.createSVGPoint();
            p.x = ptArr[0];
            p.y = ptArr[1];

            const nodeMatrix = this.activeNode.getCTM();
            const overlayMatrix = this.overlayGroup ? this.overlayGroup.getCTM() : null;

            if (nodeMatrix) {
                const worldP = p.matrixTransform(nodeMatrix);
                if (overlayMatrix) {
                    try {
                        return worldP.matrixTransform(overlayMatrix.inverse());
                    } catch (err) {
                        return worldP;
                    }
                }
                return worldP;
            }
            return p;
        } catch (e) {
            console.warn('[SvgBubbleHandler] getHandlePoint failed:', e);
            return { x: ptArr[0], y: ptArr[1] };
        }
    }

    getLocalPoint(e) {
        if (window.SVGUtils && window.SVGUtils.getLocalPoint) {
            return window.SVGUtils.getLocalPoint(e, this.activeNode);
        }

        // Fallback
        const svg = this.activeNode.ownerSVGElement || document.querySelector('svg.svg-editable');
        if (!svg) return { x: e.clientX, y: e.clientY };

        const p = svg.createSVGPoint();
        p.x = e.clientX;
        p.y = e.clientY;

        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: e.clientX, y: e.clientY };

        return p.matrixTransform(ctm.inverse());
    }

    bindWidthDrag(handle) {
        let isDragging = false;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const bbox = this.activeNode.getBBox();

            let w = parseFloat(this.activeNode.getAttribute('data-width'));
            if (isNaN(w)) w = bbox.width || 100;
            let h = parseFloat(this.activeNode.getAttribute('data-height'));
            if (isNaN(h)) h = bbox.height || 100;
            let bx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
            if (isNaN(bx)) bx = bbox.x || 0;
            let by = parseFloat(this.activeNode.getAttribute('data-rect-y'));
            if (isNaN(by)) by = bbox.y || 0;

            const localPt = this.getLocalPoint(e);
            const relX = localPt.x - bx;
            const relY = localPt.y - by;

            const opts = this.getTailOptions();
            const r = 10;
            let newWidth = 10;

            if (opts.side === 'top' || opts.side === 'bottom') {
                newWidth = Math.max(5, relX - opts.pos);
                // Clamp to not exceed the rectangle
                newWidth = Math.min(newWidth, w - r - opts.pos);
            } else {
                newWidth = Math.max(5, relY - opts.pos);
                newWidth = Math.min(newWidth, h - r - opts.pos);
            }

            this.activeNode.setAttribute('data-tail-width', newWidth);
            this.redrawBubble(w, h, bx, by);
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[BUBBLE GUARD] Width drag blocked for ${this.activeNode.id()}`);
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindRootDrag(handle) {
        let isDragging = false;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const bbox = this.activeNode.getBBox();

            let w = parseFloat(this.activeNode.getAttribute('data-width'));
            if (isNaN(w)) w = bbox.width || 100;
            let h = parseFloat(this.activeNode.getAttribute('data-height'));
            if (isNaN(h)) h = bbox.height || 100;
            let bx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
            if (isNaN(bx)) bx = bbox.x || 0;
            let by = parseFloat(this.activeNode.getAttribute('data-rect-y'));
            if (isNaN(by)) by = bbox.y || 0;

            const localPt = this.getLocalPoint(e);

            // Relative coordinates from the rectangle's top-left
            const relX = localPt.x - bx;
            const relY = localPt.y - by;

            const r = 10;
            const tailW = parseFloat(this.activeNode.getAttribute('data-tail-width') || 10);

            const distTop = Math.abs(relY - 0);
            const distBottom = Math.abs(relY - h);
            const distLeft = Math.abs(relX - 0);
            const distRight = Math.abs(relX - w);

            const minDist = Math.min(distTop, distBottom, distLeft, distRight);
            let side = 'bottom';
            let pos = 20;

            if (minDist === distTop) { side = 'top'; pos = relX - tailW / 2; }
            else if (minDist === distBottom) { side = 'bottom'; pos = relX - tailW / 2; }
            else if (minDist === distLeft) { side = 'left'; pos = relY - tailW / 2; }
            else if (minDist === distRight) { side = 'right'; pos = relY - tailW / 2; }

            if (side === 'top' || side === 'bottom') {
                pos = Math.max(r, Math.min(pos, w - r - tailW));
            } else {
                pos = Math.max(r, Math.min(pos, h - r - tailW));
            }

            this.activeNode.setAttribute('data-tail-side', side);
            this.activeNode.setAttribute('data-tail-pos', pos);

            this.redrawBubble(w, h, bx, by);
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[BUBBLE GUARD] Root drag blocked for ${this.activeNode.id()}`);
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bindEndDrag(handle) {
        let isDragging = false;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const bbox = this.activeNode.getBBox();

            let w = parseFloat(this.activeNode.getAttribute('data-width'));
            if (isNaN(w)) w = bbox.width || 100;
            let h = parseFloat(this.activeNode.getAttribute('data-height'));
            if (isNaN(h)) h = bbox.height || 100;
            let bx = parseFloat(this.activeNode.getAttribute('data-rect-x'));
            if (isNaN(bx)) bx = bbox.x || 0;
            let by = parseFloat(this.activeNode.getAttribute('data-rect-y'));
            if (isNaN(by)) by = bbox.y || 0;

            const localPt = this.getLocalPoint(e);

            // Relative coordinates from the rectangle's top-left
            const relX = localPt.x - bx;
            const relY = localPt.y - by;

            this.activeNode.setAttribute('data-tail-tx', relX);
            this.activeNode.setAttribute('data-tail-ty', relY);

            this.redrawBubble(w, h, bx, by);
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', (e) => {
            // [LOCK GUARD]
            if (this.activeNode.getAttribute('data-locked') === 'true' || this.activeNode.getAttribute('data-locked') === true) {
                console.warn(`[BUBBLE GUARD] End drag blocked for ${this.activeNode.id()}`);
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            isDragging = true;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    redrawBubble(w, h, bx, by) {
        if (!window.SVGToolbar) return;

        const opts = this.getTailOptions();
        if (isNaN(opts.pos)) opts.pos = 20;

        const d = window.SVGToolbar.getBubblePath(w, h, opts);

        // Shift absolute M manually
        const shiftedPath = d.replace(/^M\s*([\d.-]+)\s*([\d.-]+)/i, (match, p1, p2) => {
            return "M " + (parseFloat(p1) + bx) + " " + (parseFloat(p2) + by);
        });

        const svgEl = SVG(this.activeNode);
        if (svgEl) {
            svgEl.plot(shiftedPath);
        } else {
            this.activeNode.setAttribute('d', shiftedPath);
        }

        this.update(this.overlayGroup, this.activeNode, null);
        if (this.onUpdate) this.onUpdate();
    }

    hide() {
        if (this.handleGroup) {
            this.handleGroup.remove();
            this.handleGroup = null;
        }
        this.activeNode = null;
    }
}

window.SvgBubbleHandler = SvgBubbleHandler;
