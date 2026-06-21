/**
 * Equal-Spacing Smart Snap Logic
 */
window.SmartSnap = {
    /**
     * Compute equal spacing snap.
     * @param {Object} movingRBox The currently moving box
     * @param {Array} cache Array of other elements' rboxes
     * @param {number} threshold Pixel threshold for snapping
     * @returns {Object|null} Snap result { dx, dy, vGuides, hGuides, spacings } or null
     */
    computeEqualSpacingSnap: function(movingRBox, cache, threshold = 5) {
        if (!cache || cache.length < 2) return null;

        const results = {
            dx: null,
            dy: null,
            vGuides: [],
            hGuides: [],
            spacings: [] // Array of { axis: 'x'|'y', x1, y1, x2, y2, gap }
        };

        let bestX = { dist: Infinity, dx: 0, vGuides: [], spacings: [] };
        let bestY = { dist: Infinity, dy: 0, hGuides: [], spacings: [] };

        const M = movingRBox;

        for (let i = 0; i < cache.length; i++) {
            for (let j = i + 1; j < cache.length; j++) {
                const A = cache[i];
                const B = cache[j];

                // ----- X Axis (Horizontal Equal Spacing) -----
                // Objects must overlap in Y axis to be considered in the same row
                if (this.rangesOverlap(A.y, A.y2, B.y, B.y2) &&
                    this.rangesOverlap(M.y, M.y2, A.y, A.y2)) {
                    
                    let left = A, right = B;
                    if (A.x > B.x) { left = B; right = A; }
                    
                    const midY = (Math.max(A.y, B.y, M.y) + Math.min(A.y2, B.y2, M.y2)) / 2;

                    // Pattern 1: M is between A and B
                    if (left.x2 < right.x) {
                        const gap = (right.x - left.x2 - M.width) / 2;
                        if (gap >= 2) {
                            const candidateX = left.x2 + gap;
                            const d = candidateX - M.x;
                            if (Math.abs(d) < threshold && Math.abs(d) < bestX.dist) {
                                bestX.dist = Math.abs(d);
                                bestX.dx = d;
                                bestX.vGuides = [left.x2, candidateX, candidateX + M.width, right.x];
                                bestX.spacings = [
                                    { axis: 'x', x1: left.x2, x2: candidateX, y1: midY, y2: midY, gap },
                                    { axis: 'x', x1: candidateX + M.width, x2: right.x, y1: midY, y2: midY, gap }
                                ];
                            }
                        }
                    }

                    // Pattern 2: M is outside (M - A - B) or (A - B - M)
                    const refGap = right.x - left.x2;
                    if (refGap >= 2) {
                        // M is to the left of A (M - A - B)
                        const candidateXLeft = left.x - refGap - M.width;
                        let dLeft = candidateXLeft - M.x;
                        if (Math.abs(dLeft) < threshold && Math.abs(dLeft) < bestX.dist) {
                            bestX.dist = Math.abs(dLeft);
                            bestX.dx = dLeft;
                            bestX.vGuides = [candidateXLeft, candidateXLeft + M.width, left.x, left.x2, right.x];
                            bestX.spacings = [
                                { axis: 'x', x1: candidateXLeft + M.width, x2: left.x, y1: midY, y2: midY, gap: refGap },
                                { axis: 'x', x1: left.x2, x2: right.x, y1: midY, y2: midY, gap: refGap }
                            ];
                        }

                        // M is to the right of B (A - B - M)
                        const candidateXRight = right.x2 + refGap;
                        let dRight = candidateXRight - M.x;
                        if (Math.abs(dRight) < threshold && Math.abs(dRight) < bestX.dist) {
                            bestX.dist = Math.abs(dRight);
                            bestX.dx = dRight;
                            bestX.vGuides = [left.x2, right.x, right.x2, candidateXRight, candidateXRight + M.width];
                            bestX.spacings = [
                                { axis: 'x', x1: left.x2, x2: right.x, y1: midY, y2: midY, gap: refGap },
                                { axis: 'x', x1: right.x2, x2: candidateXRight, y1: midY, y2: midY, gap: refGap }
                            ];
                        }
                    }
                }

                // ----- Y Axis (Vertical Equal Spacing) -----
                // Objects must overlap in X axis to be considered in the same column
                if (this.rangesOverlap(A.x, A.x2, B.x, B.x2) &&
                    this.rangesOverlap(M.x, M.x2, A.x, A.x2)) {
                    
                    let top = A, bottom = B;
                    if (A.y > B.y) { top = B; bottom = A; }
                    
                    const midX = (Math.max(A.x, B.x, M.x) + Math.min(A.x2, B.x2, M.x2)) / 2;

                    // Pattern 1: M is between A and B
                    if (top.y2 < bottom.y) {
                        const gap = (bottom.y - top.y2 - M.height) / 2;
                        if (gap >= 2) {
                            const candidateY = top.y2 + gap;
                            const d = candidateY - M.y;
                            if (Math.abs(d) < threshold && Math.abs(d) < bestY.dist) {
                                bestY.dist = Math.abs(d);
                                bestY.dy = d;
                                bestY.hGuides = [top.y2, candidateY, candidateY + M.height, bottom.y];
                                bestY.spacings = [
                                    { axis: 'y', x1: midX, x2: midX, y1: top.y2, y2: candidateY, gap },
                                    { axis: 'y', x1: midX, x2: midX, y1: candidateY + M.height, y2: bottom.y, gap }
                                ];
                            }
                        }
                    }

                    // Pattern 2: M is outside (M - A - B) or (A - B - M)
                    const refGap = bottom.y - top.y2;
                    if (refGap >= 2) {
                        // M is above A (M - A - B)
                        const candidateYTop = top.y - refGap - M.height;
                        let dTop = candidateYTop - M.y;
                        if (Math.abs(dTop) < threshold && Math.abs(dTop) < bestY.dist) {
                            bestY.dist = Math.abs(dTop);
                            bestY.dy = dTop;
                            bestY.hGuides = [candidateYTop, candidateYTop + M.height, top.y, top.y2, bottom.y];
                            bestY.spacings = [
                                { axis: 'y', x1: midX, x2: midX, y1: candidateYTop + M.height, y2: top.y, gap: refGap },
                                { axis: 'y', x1: midX, x2: midX, y1: top.y2, y2: bottom.y, gap: refGap }
                            ];
                        }

                        // M is below B (A - B - M)
                        const candidateYBottom = bottom.y2 + refGap;
                        let dBottom = candidateYBottom - M.y;
                        if (Math.abs(dBottom) < threshold && Math.abs(dBottom) < bestY.dist) {
                            bestY.dist = Math.abs(dBottom);
                            bestY.dy = dBottom;
                            bestY.hGuides = [top.y2, bottom.y, bottom.y2, candidateYBottom, candidateYBottom + M.height];
                            bestY.spacings = [
                                { axis: 'y', x1: midX, x2: midX, y1: top.y2, y2: bottom.y, gap: refGap },
                                { axis: 'y', x1: midX, x2: midX, y1: bottom.y2, y2: candidateYBottom, gap: refGap }
                            ];
                        }
                    }
                }
            }
        }

        if (bestX.dist !== Infinity) {
            results.dx = bestX.dx;
            results.vGuides = bestX.vGuides;
            results.spacings.push(...bestX.spacings);
        }
        
        if (bestY.dist !== Infinity) {
            results.dy = bestY.dy;
            results.hGuides = bestY.hGuides;
            results.spacings.push(...bestY.spacings);
        }

        return (results.dx !== null || results.dy !== null) ? results : null;
    },

    rangesOverlap: function(min1, max1, min2, max2) {
        return Math.max(min1, min2) < Math.min(max1, max2);
    }
};
