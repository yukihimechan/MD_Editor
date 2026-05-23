/**
 * PointerDragManager
 * HTML5 Native Drag & Drop (draggable="true") の代替として、
 * Pointer Events (pointerdown, pointermove, pointerup) を利用して
 * 要素のドラッグ＆ドロップ（並べ替え）を共通管理するユーティリティ。
 * Tauri 2 Windows環境での fileDropEnabled 競合問題を回避するために使用する。
 */
class PointerDragManager {
    constructor(options = {}) {
        this.container = options.container || document.body;
        this.itemSelector = options.itemSelector;
        this.handleSelector = options.handleSelector || options.itemSelector;
        
        // Callbacks
        this.onDragStart = options.onDragStart || null;      // (dragElement, startEvent) => data
        this.onDragMove = options.onDragMove || null;        // (data, moveEvent, ghostInfo) => void
        this.onDragEnd = options.onDragEnd || null;          // (data, endEvent) => void
        this.onDrop = options.onDrop || null;                // (data, dropTarget, endEvent) => void
        
        // CSS classes
        this.draggingClass = options.draggingClass || 'dragging';
        this.dropTargetClass = options.dropTargetClass || 'drop-target';
        
        // State
        this.isDragging = false;
        this.dragElement = null;
        this.ghostElement = null;
        this.currentDropTarget = null;
        this.startX = 0;
        this.startY = 0;
        this.dragData = null;
        this.pointerId = null;
        
        this._bindEvents();
    }

    _bindEvents() {
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        this.container.addEventListener('pointerdown', this._onPointerDown);
    }

    destroy() {
        this.container.removeEventListener('pointerdown', this._onPointerDown);
        this._cleanup();
    }

    _onPointerDown(e) {
        // Only accept primary button (usually left click)
        if (e.button !== 0 || !e.isPrimary) return;
        
        const handle = e.target.closest(this.handleSelector);
        if (!handle) return;
        
        const item = e.target.closest(this.itemSelector);
        if (!item) return;

        // Ensure we're in the container
        if (!this.container.contains(item)) return;

        this.dragElement = item;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.isDragging = false;
        this.pointerId = e.pointerId;
        
        this.dragData = this.onDragStart ? this.onDragStart(item, e) : { element: item };
        
        document.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerUp);
    }

    _onPointerMove(e) {
        if (!this.dragElement || e.pointerId !== this.pointerId) return;

        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;

        if (!this.isDragging) {
            // Drag threshold
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.isDragging = true;
                this.dragElement.classList.add(this.draggingClass);
                
                // Prevent scrolling during drag
                document.body.style.userSelect = 'none';
                
                this._createGhost();
            } else {
                return;
            }
        }

        e.preventDefault(); // Prevent text selection/scrolling

        // Move ghost
        if (this.ghostElement) {
            this.ghostElement.style.transform = `translate(${dx}px, ${dy}px)`;
        }

        // Find drop target under cursor
        const target = this._findDropTarget(e.clientX, e.clientY);
        this._updateDropTarget(target, e.clientX, e.clientY);

        if (this.onDragMove) {
            this.onDragMove(this.dragData, e, { dx, dy, target, dropBefore: this.dropBefore });
        }
    }

    _onPointerUp(e) {
        if (!this.dragElement || e.pointerId !== this.pointerId) return;

        if (this.isDragging) {
            // Ensure we use coordinates from the event to find the target
            const dropTarget = this._findDropTarget(e.clientX, e.clientY);
            
            if (dropTarget && this.onDrop && dropTarget !== this.dragElement) {
                this.onDrop(this.dragData, dropTarget, e, this.dropBefore);
            }
            if (this.onDragEnd) {
                this.onDragEnd(this.dragData, e);
            }
        }

        this._cleanup();
    }

    _createGhost() {
        const rect = this.dragElement.getBoundingClientRect();
        this.ghostElement = this.dragElement.cloneNode(true);
        // Setup ghost styles to follow pointer exactly
        this.ghostElement.style.position = 'fixed';
        this.ghostElement.style.top = `${rect.top}px`;
        this.ghostElement.style.left = `${rect.left}px`;
        this.ghostElement.style.width = `${rect.width}px`;
        this.ghostElement.style.height = `${rect.height}px`;
        this.ghostElement.style.margin = '0';
        this.ghostElement.style.opacity = '0.7';
        this.ghostElement.style.pointerEvents = 'none'; // CRITICAL: So elementFromPoint works
        this.ghostElement.style.zIndex = '100000';
        this.ghostElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        this.ghostElement.classList.add('pointer-drag-ghost');
        
        document.body.appendChild(this.ghostElement);
    }

    _findDropTarget(x, y) {
        // Since ghost has pointer-events: none, elementFromPoint will get the underlying element
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        
        const item = el.closest(this.itemSelector);
        if (item && item !== this.dragElement && this.container.contains(item)) {
            return item;
        }
        return null;
    }

    _updateDropTarget(target, x, y) {
        if (this.currentDropTarget !== target) {
            if (this.currentDropTarget) {
                this.currentDropTarget.classList.remove(this.dropTargetClass);
            }
            this.currentDropTarget = target;
            if (this.currentDropTarget) {
                this.currentDropTarget.classList.add(this.dropTargetClass);
            }
        }

        // Drop Indicator Line rendering
        if (!this.dropIndicator) {
            this.dropIndicator = document.createElement('div');
            this.dropIndicator.className = 'pointer-drag-indicator';
            this.dropIndicator.style.position = 'fixed';
            this.dropIndicator.style.backgroundColor = '#2196F3';
            this.dropIndicator.style.zIndex = '100000';
            this.dropIndicator.style.pointerEvents = 'none';
            document.body.appendChild(this.dropIndicator);
        }

        if (!target) {
            this.dropIndicator.style.display = 'none';
            this.dropBefore = false;
            return;
        }

        const rect = target.getBoundingClientRect();
        
        // Determine orientation based on drag element
        const isHorizontalDrag = this.dragElement && (this.dragElement.tagName === 'TH' || this.dragElement.tagName === 'TD' || this.dragElement.classList.contains('drag-handle-col'));

        this.dropIndicator.style.display = 'block';

        if (isHorizontalDrag) {
            // Vertical Line (Horizontal Drag)
            this.dropIndicator.style.width = '4px';
            this.dropIndicator.style.height = `${rect.height}px`;
            this.dropIndicator.style.top = `${rect.top}px`;
            
            this.dropBefore = (x - rect.left) < (rect.width / 2);
            if (this.dropBefore) {
                this.dropIndicator.style.left = `${rect.left - 2}px`;
            } else {
                this.dropIndicator.style.left = `${rect.right - 2}px`;
            }
        } else {
            // Horizontal Line (Vertical Drag)
            this.dropIndicator.style.height = '4px';
            this.dropIndicator.style.width = `${rect.width}px`;
            this.dropIndicator.style.left = `${rect.left}px`;
            
            this.dropBefore = (y - rect.top) < (rect.height / 2);
            if (this.dropBefore) {
                this.dropIndicator.style.top = `${rect.top - 2}px`;
            } else {
                this.dropIndicator.style.top = `${rect.bottom - 2}px`;
            }
        }
    }

    _cleanup() {
        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);
        
        document.body.style.userSelect = '';
        
        if (this.dragElement) {
            this.dragElement.classList.remove(this.draggingClass);
            this.dragElement = null;
        }
        if (this.ghostElement) {
            this.ghostElement.remove();
            this.ghostElement = null;
        }
        if (this.currentDropTarget) {
            this.currentDropTarget.classList.remove(this.dropTargetClass);
            this.currentDropTarget = null;
        }
        if (this.dropIndicator) {
            this.dropIndicator.style.display = 'none';
        }
        
        this.isDragging = false;
        this.dragData = null;
        this.pointerId = null;
        this.dropBefore = false;
    }
}
window.PointerDragManager = PointerDragManager;
