/**
 * PaintLibrary - 埋め込み・ポップアップ型ペイントツールライブラリ
 */
class PaintLibrary {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.width = options.width || 800;
    this.height = options.height || 600;

    this.color = options.defaultColor || '#000000';
    this.lineWidth = options.defaultLineWidth || 3;
    this.currentTool = 'brush';

    this._onToolChange = options.onToolChange || null;
    this._onHistoryChange = options.onHistoryChange || null;
    this._onColorPickerRequest = options.onColorPickerRequest || null;

    // ファイルハンドル（上書き保存用）
    this.fileHandle = null;
    // フォントサイズ
    this.fontSize = options.defaultFontSize || 20;

    // ツールバーアイテムの表示制御デフォルト設定
    const defaultItems = {
      brush: true, eraser: true, fill: true, rect: true, ellipse: true,
      'arrow-up': true, 'arrow-down': true, 'arrow-left': true, 'arrow-right': true,
      text: true, select: true, copy: true, paste: true, undo: true, redo: true,
      zoom: true, color: true, size: true, open: true, savePng: true, save: true,
      clear: true, fontSize: true
    };
    this.toolbarItems = Object.assign({}, defaultItems, options.toolbarItems || {});

    this.history = [];
    this.historyStep = -1;

    // 描画関連のフラグ
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;

    // クリップボードとフローティング状態
    this.clipboardData = null; // { imgData, w, h }
    this.selectionRect = null; // { x, y, w, h }
    this.isFloating = false;
    this.floatingImageData = null; // { canvas, x, y, w, h }

    // パン・ズーム関連の変数
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isSpaceDown = false;
    this.isPanning = false;

    this._hasToolbar = options.toolbar === true;
    this._hasStatusBar = options.statusBar !== false; // デフォルトは表示
    this._actionButtons = options.actionButtons || null;

    this.editableShapes = options.editableShapes || false;
    this.shapes = [];
    this.activeShape = null;
    this.isResizingShape = false;
    this.resizeDir = null;
    this.isMovingShape = false;
    this.shapeDragOffset = { x: 0, y: 0 };

    this._initUI();
    this._bindEvents();

    this._saveState();
  }

  _initUI() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'paint-wrapper';

    // 内蔵ツールバー
    if (this._hasToolbar) {
      this._toolbar = this._createToolbar();
      this.wrapper.appendChild(this._toolbar);
    }

    // ビューポート (キャンバスコンテナーのはみ出しを隠しパン移動の基準面となる)
    this.viewport = document.createElement('div');
    this.viewport.className = 'paint-viewport';
    this.viewport.style.width = this.width + 'px';
    this.viewport.style.height = this.height + 'px';

    // キャンバスコンテナ（Transformでまとめて動かす層）
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'paint-canvas-wrap';
    this.canvasWrap.style.width = this.width + 'px';
    this.canvasWrap.style.height = this.height + 'px';

    // メインキャンバス
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.className = 'paint-canvas';
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    // オーバーレイキャンバス
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = this.width;
    this.overlayCanvas.height = this.height;
    this.overlayCanvas.className = 'paint-overlay-canvas';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // テキスト編集用エディタ
    this.textEditor = document.createElement('div');
    this.textEditor.className = 'paint-text-editor';
    this.textEditor.contentEditable = true;
    this.textEditor.style.display = 'none';
    this.textEditor.addEventListener('blur', () => this._commitText());

    this.canvasWrap.appendChild(this.canvas);
    this.canvasWrap.appendChild(this.overlayCanvas);
    this.canvasWrap.appendChild(this.textEditor);

    // リサイズハンドルを追加
    this._addResizeHandles();

    this.viewport.appendChild(this.canvasWrap);
    this.wrapper.appendChild(this.viewport);

    // ステータスバー（下部：キャンバスサイズ表示・変更）
    if (this._hasStatusBar) {
      this._statusBar = this._createStatusBar();
      this.wrapper.appendChild(this._statusBar);
    }

    this.container.appendChild(this.wrapper);
    this._updateTransform();
  }

  _createToolbar() {
    const bar = document.createElement('div');
    bar.className = 'paint-toolbar';

    this._tbBtns = {};

    // ツールボタン生成ヘルパー
    const addTool = (id, icon, title) => {
      if (this.toolbarItems[id] === false) return;
      const btn = this._makeTbBtn(icon, 'paint-tool-btn', () => this.setTool(id));
      btn.title = title;
      this._tbBtns[id] = btn;
      bar.appendChild(btn);
    };

    // セパレーター生成ヘルパー
    const sep = () => {
      const s = document.createElement('div');
      s.className = 'paint-v-separator';
      bar.appendChild(s);
    };

    // ── グループ1: ブラシ系ツール + 色 + 太さ ──────────────────
    addTool('brush', '✏️', 'ブラシ');
    addTool('eraser', '⌫', '消しゴム');
    addTool('fill', '▨', '塗りつぶし');

    // 色ボタン（ブラシのそばに配置）
    if (this.toolbarItems.color !== false) {
      this._btnColor = document.createElement('button');
      this._btnColor.className = 'paint-color-btn';
      this._btnColor.title = '色を選択';
      this._btnColor.style.backgroundColor = this.color;
      this._btnColor.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._onColorPickerRequest) this._onColorPickerRequest(this.color, this._btnColor);
      });
      bar.appendChild(this._btnColor);
    }

    // 太さスライダー（ブラシのそばに配置）
    if (this.toolbarItems.size !== false) {
      const sizeWrap = document.createElement('label');
      sizeWrap.className = 'paint-size-wrap';
      sizeWrap.innerHTML = '<span>太さ</span>';
      this._sizeSlider = document.createElement('input');
      this._sizeSlider.type = 'range';
      this._sizeSlider.min = 1; this._sizeSlider.max = 80; this._sizeSlider.value = this.lineWidth;
      this._sizeSlider.className = 'paint-size-slider';
      this._sizeSlider.addEventListener('input', (e) => this.setLineWidth(parseInt(e.target.value, 10)));
      sizeWrap.appendChild(this._sizeSlider);
      bar.appendChild(sizeWrap);
    }

    sep();

    // ── グループ2: 図形ツール ───────────────────────────────────
    addTool('rect', '▭', '矩形');
    addTool('ellipse', '◯', '楕円');
    addTool('arrow-up', '⬆', '矢印(上)');
    addTool('arrow-down', '⬇', '矢印(下)');
    addTool('arrow-left', '⬅', '矢印(左)');
    addTool('arrow-right', '➡', '矢印(右)');

    sep();

    // ── グループ3: テキストツール + フォントサイズ ─────────────
    addTool('text', 'T', 'テキスト');

    if (this.toolbarItems.fontSize !== false) {
      const fontWrap = document.createElement('label');
      fontWrap.className = 'paint-size-wrap';
      fontWrap.innerHTML = '<span>Fサイズ</span>';
      this._fontSizeInput = document.createElement('input');
      this._fontSizeInput.type = 'number';
      this._fontSizeInput.min = 8; this._fontSizeInput.max = 200; this._fontSizeInput.value = this.fontSize;
      this._fontSizeInput.className = 'paint-size-input';
      this._fontSizeInput.style.width = '44px';
      this._fontSizeInput.addEventListener('input', (e) => this.setFontSize(parseInt(e.target.value, 10) || 20));
      fontWrap.appendChild(this._fontSizeInput);
      bar.appendChild(fontWrap);
    }

    sep();

    // ── グループ4: 選択 + コピー/ペースト ────────────────────
    addTool('select', '⬚', '矩形選択');
    if (this.toolbarItems.copy !== false) {
      // コピー: ⎘ アイコン
      this._btnCopy = this._makeTbBtn('⎘', 'paint-tool-btn', () => this.copySelection());
      this._btnCopy.title = 'コピー';
      bar.appendChild(this._btnCopy);
    }
    if (this.toolbarItems.paste !== false) {
      // ペースト: ⎗ アイコン
      this._btnPaste = this._makeTbBtn('⎗', 'paint-tool-btn', () => this.paste());
      this._btnPaste.title = 'ペースト';
      bar.appendChild(this._btnPaste);
    }

    sep();

    // ── グループ5: 元に戻す / やり直し ───────────────────────
    if (this.toolbarItems.undo !== false) {
      this._btnUndo = this._makeTbBtn('↩', 'paint-tool-btn', () => this.undo());
      this._btnUndo.title = '元に戻す';
      bar.appendChild(this._btnUndo);
    }
    if (this.toolbarItems.redo !== false) {
      this._btnRedo = this._makeTbBtn('↪', 'paint-tool-btn', () => this.redo());
      this._btnRedo.title = 'やり直す';
      bar.appendChild(this._btnRedo);
    }

    sep();

    // ── グループ6: ズーム ─────────────────────────────────────
    if (this.toolbarItems.zoom !== false) {
      const btnZoomOut = this._makeTbBtn('🔍−', 'paint-tool-btn', () => this.applyZoom(0.8));
      const btnZoomReset = this._makeTbBtn('↺', 'paint-tool-btn', () => this.resetTransform());
      const btnZoomIn = this._makeTbBtn('🔍+', 'paint-tool-btn', () => this.applyZoom(1.25));
      btnZoomOut.title = '縮小';
      btnZoomReset.title = 'ズーム/パンをリセット';
      btnZoomIn.title = '拡大';
      [btnZoomOut, btnZoomReset, btnZoomIn].forEach(b => bar.appendChild(b));
    }

    sep();

    // ── グループ7: ファイル操作 ───────────────────────────────
    if (this.toolbarItems.open !== false) {
      const fileWrap = document.createElement('label');
      fileWrap.className = 'paint-tb-btn paint-tool-btn'; fileWrap.title = '画像を開く'; fileWrap.textContent = '📂';
      this._fileInput = document.createElement('input');
      this._fileInput.type = 'file'; this._fileInput.accept = 'image/*'; this._fileInput.style.display = 'none';
      this._fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) this.loadImage(e.target.files[0]).catch(() => this._showError('画像の読み込みに失敗しました。'));
      });
      fileWrap.appendChild(this._fileInput);
      bar.appendChild(fileWrap);
    }
    if (this.toolbarItems.clear !== false) {
      const b = this._makeTbBtn('🗑', 'paint-tool-btn', () => { if (confirm(t('confirm.clearCanvas'))) this.clearCanvas(); });
      b.title = '全消去'; bar.appendChild(b);
    }
    if (this.toolbarItems.savePng !== false) {
      const b = this._makeTbBtn('💾PNG', '', () => this.downloadImage('drawing.png', 'image/png'));
      b.title = 'PNGで保存'; bar.appendChild(b);
    }
    if (this.toolbarItems.save !== false) {
      this._btnSave = this._makeTbBtn('💾保存', '', () => this.saveOverwrite());
      this._btnSave.title = '上書き保存'; bar.appendChild(this._btnSave);
    }

    this._refreshToolbarState();
    return bar;
  }

  _makeTbBtn(label, className, onClick) {
    const btn = document.createElement('button');
    btn.className = 'paint-tb-btn ' + className;
    btn.innerHTML = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _showError(msg) {
    const el = document.createElement('div'); el.className = 'paint-error'; el.textContent = msg;
    this.wrapper.appendChild(el); setTimeout(() => el.remove(), 3000);
  }

  // ─── CSS Transform 更新 ────────────────────────────────────────

  _updateTransform() {
    this.canvasWrap.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  applyZoom(multiplier, centerX = this.viewport.clientWidth / 2, centerY = this.viewport.clientHeight / 2) {
    const prevZoom = this.zoom;
    this.zoom = Math.max(0.1, Math.min(20, this.zoom * multiplier));

    // 指定したビューポート上の座標を中心にズームするためのパンオフセット調整
    this.panX = centerX - (centerX - this.panX) * (this.zoom / prevZoom);
    this.panY = centerY - (centerY - this.panY) * (this.zoom / prevZoom);
    this._updateTransform();
  }

  resetTransform() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._updateTransform();
  }

  // ─── イベントバインド ──────────────────────────────────────────

  _bindEvents() {
    // CanvasWrap に対するスケール・パン適用後の正確なピクセル座標を取得
    const getPos = (clientX, clientY) => {
      const rect = this.canvasWrap.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    // ─── キーボード (ショートカットおよびスペースパン監視) ───
    this._onKeyDown = (e) => {
      if (document.activeElement === this.textEditor) return; // テキスト入力中は無視

      // Ctrl または Command(Mac) キーの処理
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyC') {
          e.preventDefault();
          this.copySelection();
        } else if (e.code === 'KeyV') {
          e.preventDefault();
          this.paste();
        } else if (e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) this.redo();
          else this.undo();
        } else if (e.code === 'KeyY') {
          e.preventDefault();
          this.redo();
        }
      }

      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true;
        this.overlayCanvas.style.cursor = 'grab';
        e.preventDefault(); // 画面スクロール防止
      }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.editableShapes && this.activeShape && document.activeElement !== this.textEditor) {
          e.preventDefault();
          this.shapes = this.shapes.filter(s => s !== this.activeShape);
          this.activeShape = null;
          this._redrawOverlay();
          return;
        }
      }

      // ── フローティング中の矢印キー移動 (1px) ──
      if (this.isFloating && this.floatingImageData) {
        const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
        if (arrows[e.key]) {
          e.preventDefault();
          const [dx, dy] = arrows[e.key];
          this.floatingImageData.x += dx;
          this.floatingImageData.y += dy;
          this._redrawOverlay();
        }
      }
    };

    this._onKeyUp = (e) => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        if (this.isPanning) this.isPanning = false;
        this._updateCursor();
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // ─── マウス・タッチ操作 ───
    const start = (e) => {
      if (e.target === this.textEditor) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      if (this.isSpaceDown || e.button === 1 /* Middle click */) {
        this.isPanning = true;
        this.lastClientX = clientX;
        this.lastClientY = clientY;
        this.overlayCanvas.style.cursor = 'grabbing';
        return;
      }

      // 選択領域内をクリック → 選択内容をフローティング化して移動開始
      if (this.currentTool === 'select' && this.selectionRect && !this.isFloating) {
        const r = this.selectionRect;
        const p = getPos(clientX, clientY);
        if (p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h) {
          this._liftSelection();
          this.isDrawing = true;
          this.lastX = p.x; this.lastY = p.y;
          return;
        }
      }

      // フローティング確定か移動か
      if (this.isFloating) {
        const p = getPos(clientX, clientY);
        const f = this.floatingImageData;
        if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h) {
          this.isDrawing = true;
          this.startX = p.x; this.startY = p.y;
          this.lastX = p.x; this.lastY = p.y;
          return;
        } else {
          this._commitFloatingImage();
        }
      }

      this._commitText();

      const pos = getPos(clientX, clientY);

      if (this.editableShapes) {
        if (this.activeShape) {
          const handle = this._hitTestHandles(pos.x, pos.y, this.activeShape);
          if (handle) {
            this.isDrawing = true;
            this.isResizingShape = true;
            this.resizeDir = handle;
            this.lastX = pos.x; this.lastY = pos.y;
            return;
          }
          if (this._hitTestShape(pos.x, pos.y, this.activeShape)) {
            this.isDrawing = true;
            this.isMovingShape = true;
            this.shapeDragOffset = { x: pos.x - this.activeShape.x, y: pos.y - this.activeShape.y };
            return;
          }
        }

        if (this.currentTool === 'select' || ['rect', 'ellipse', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'].includes(this.currentTool)) {
          let hitShape = null;
          for (let i = this.shapes.length - 1; i >= 0; i--) {
            if (this._hitTestShape(pos.x, pos.y, this.shapes[i])) {
              hitShape = this.shapes[i];
              break;
            }
          }
          if (hitShape) {
            this.activeShape = hitShape;
            this.isDrawing = true;
            this.isMovingShape = true;
            this.shapeDragOffset = { x: pos.x - hitShape.x, y: pos.y - hitShape.y };
            this._redrawOverlay();
            return;
          }
        }

        if (this.activeShape) {
          this.activeShape = null;
          this._redrawOverlay();
        }
      }

      if (this.currentTool === 'fill') {
        this._fillArea(Math.round(pos.x), Math.round(pos.y));
        this._saveState();
        return;
      }
      if (this.currentTool === 'text') {
        this._showTextEditor(pos.x, pos.y);
        return;
      }

      this.isDrawing = true;
      this.startX = pos.x; this.startY = pos.y;
      this.lastX = pos.x; this.lastY = pos.y;

      if (this.currentTool === 'select') {
        this.selectionRect = null;
        this._clearOverlay();
        return;
      }

      if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(this.lastX + 0.01, this.lastY + 0.01);
        this._applyStrokeStyle(this.ctx);
        this.ctx.stroke();
      }
    };

    const move = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      if (this.isPanning) {
        e.preventDefault();
        const dx = clientX - this.lastClientX;
        const dy = clientY - this.lastClientY;
        this.panX += dx;
        this.panY += dy;
        this.lastClientX = clientX;
        this.lastClientY = clientY;
        this._updateTransform();
        return;
      }

      const pos = getPos(clientX, clientY);

      if (!this.isDrawing) {
        if (this.editableShapes && this.activeShape) {
          const handle = this._hitTestHandles(pos.x, pos.y, this.activeShape);
          if (handle) {
            const cursorMap = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
            this.overlayCanvas.style.cursor = cursorMap[handle];
            return;
          }
          if (this._hitTestShape(pos.x, pos.y, this.activeShape)) {
            this.overlayCanvas.style.cursor = 'move';
            return;
          }
        }
        this._updateCursor();
        return;
      }

      e.preventDefault();

      if (this.isResizingShape && this.activeShape) {
        let dx = pos.x - this.lastX;
        let dy = pos.y - this.lastY;
        const s = this.activeShape;

        if (this.resizeDir.includes('n')) {
          if (s.h - dy >= 1) { s.y += dy; s.h -= dy; }
          else { s.y += (s.h - 1); dy = s.h - 1; s.h = 1; }
        }
        if (this.resizeDir.includes('s')) {
          if (s.h + dy >= 1) { s.h += dy; }
          else { dy = 1 - s.h; s.h = 1; }
        }
        if (this.resizeDir.includes('w')) {
          if (s.w - dx >= 1) { s.x += dx; s.w -= dx; }
          else { s.x += (s.w - 1); dx = s.w - 1; s.w = 1; }
        }
        if (this.resizeDir.includes('e')) {
          if (s.w + dx >= 1) { s.w += dx; }
          else { dx = 1 - s.w; s.w = 1; }
        }

        this.lastX += dx;
        this.lastY += dy;
        this._redrawOverlay();
        return;
      }

      if (this.isMovingShape && this.activeShape) {
        this.activeShape.x = pos.x - this.shapeDragOffset.x;
        this.activeShape.y = pos.y - this.shapeDragOffset.y;
        this._redrawOverlay();
        return;
      }

      if (this.isFloating) {
        const dx = pos.x - this.lastX;
        const dy = pos.y - this.lastY;
        this.floatingImageData.x += dx;
        this.floatingImageData.y += dy;
        this.lastX = pos.x; this.lastY = pos.y;
        this._redrawOverlay();
        return;
      }

      if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(pos.x, pos.y);
        this._applyStrokeStyle(this.ctx);
        this.ctx.stroke();
        this.lastX = pos.x; this.lastY = pos.y;
      } else {
        this._redrawOverlay();
        this._drawShapePreview(this.startX, this.startY, pos.x, pos.y);
      }
    };

    const end = (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        this._updateCursor();
        return;
      }

      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.isResizingShape || this.isMovingShape) {
        this.isResizingShape = false;
        this.isMovingShape = false;
        this.isDrawing = false;
        return;
      }

      if (this.isFloating) return;

      const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      const pos = getPos(clientX, clientY);

      if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
        this._saveState();
      } else if (this.currentTool === 'select') {
        this._finalizeSelectionRect(this.startX, this.startY, pos.x, pos.y);
      } else if (['rect', 'ellipse', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'].includes(this.currentTool)) {
        if (this.editableShapes) {
          const x = Math.min(this.startX, pos.x);
          const y = Math.min(this.startY, pos.y);
          const w = Math.abs(pos.x - this.startX);
          const h = Math.abs(pos.y - this.startY);
          if (w > 0 && h > 0) {
            const shape = { type: this.currentTool, x, y, w, h, color: this.color, lineWidth: this.lineWidth };
            this.shapes.push(shape);
            this.activeShape = shape;
          }
          this._redrawOverlay();
        } else {
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.drawImage(this.overlayCanvas, 0, 0);
          this._clearOverlay();
          this._saveState();
        }
      }
    };

    // ─── ホイール操作（ズームとパン） ───
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // ズーム
        const vpRect = this.viewport.getBoundingClientRect();
        const centerX = e.clientX - vpRect.left;
        const centerY = e.clientY - vpRect.top;

        // ピンチ操作やホイールに合わせて delta 算出
        const factor = e.deltaY < 0 ? 1.1 : 0.90909;
        this.applyZoom(factor, centerX, centerY);
      } else if (e.shiftKey) {
        // 横方向のパン
        this.panX -= e.deltaY || e.deltaX;
        this._updateTransform();
      } else {
        // 縦方向・斜め方向のパン
        this.panX -= e.deltaX;
        this.panY -= e.deltaY;
        this._updateTransform();
      }
    }, { passive: false });

    // Z-Index 前面のオーバーレイに対してイベント付与
    this.overlayCanvas.addEventListener('mousedown', start, { passive: false });
    this.overlayCanvas.addEventListener('mousemove', move, { passive: false });
    
    this._onPointerEnd = end;
    window.addEventListener('mouseup', this._onPointerEnd);
    window.addEventListener('touchend', this._onPointerEnd);

    this.overlayCanvas.addEventListener('touchstart', start, { passive: false });
    this.overlayCanvas.addEventListener('touchmove', move, { passive: false });

    this.overlayCanvas.addEventListener('mouseenter', () => this._updateCursor());

    // ─── ジーニアスpasteイベント (OSクリップボードから画像を取得) ───
    this._onPaste = (e) => {
      if (document.activeElement === this.textEditor) return;
      const items = (e.clipboardData || {}).items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            this._commitFloatingImage();
            this._commitText();
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = img.naturalWidth; tmpCanvas.height = img.naturalHeight;
            tmpCanvas.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            this._pasteCanvas(tmpCanvas);
          };
          img.src = url;
          break;
        }
      }
    };
    window.addEventListener('paste', this._onPaste);
  }

  // ライブラリを破棄（DOM・イベントリスナーの片付け）
  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('paste', this._onPaste);
    if (this._onPointerEnd) {
      window.removeEventListener('mouseup', this._onPointerEnd);
      window.removeEventListener('touchend', this._onPointerEnd);
    }
    
    // Resize Observer等の片付けがあればここへ（現在不使用）

    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
  }

  _applyStrokeStyle(context) {
    context.lineWidth = this.lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (this.currentTool === 'eraser' && context === this.ctx) {
      context.globalCompositeOperation = 'destination-out';
      context.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = this.color;
      context.fillStyle = this.color;
    }
  }

  _clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
  }

  _redrawOverlay() {
    this._clearOverlay();

    if (this.editableShapes && this.shapes) {
      for (const shape of this.shapes) {
        this.overlayCtx.lineWidth = shape.lineWidth;
        this.overlayCtx.strokeStyle = shape.color;
        this.overlayCtx.fillStyle = shape.color;
        this.overlayCtx.beginPath();
        if (shape.type === 'rect') {
          this.overlayCtx.strokeRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === 'ellipse') {
          this.overlayCtx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, shape.w / 2, shape.h / 2, 0, 0, Math.PI * 2);
          this.overlayCtx.stroke();
        } else if (shape.type.startsWith('arrow-')) {
          this._drawArrowPath(this.overlayCtx, shape.x, shape.y, shape.w, shape.h, shape.type.split('-')[1]);
          this.overlayCtx.stroke();
          this.overlayCtx.fill();
        }
      }
      if (this.activeShape) {
        this.overlayCtx.strokeStyle = '#4da3ff';
        this.overlayCtx.lineWidth = 1;
        this.overlayCtx.setLineDash([4, 4]);
        this.overlayCtx.strokeRect(this.activeShape.x, this.activeShape.y, this.activeShape.w, this.activeShape.h);
        this.overlayCtx.setLineDash([]);
        this.overlayCtx.fillStyle = '#fff';
        this.overlayCtx.strokeStyle = '#2b6cb0';
        const handles = this._getHandles(this.activeShape);
        for (let h of handles) {
          this.overlayCtx.fillRect(h.x, h.y, 8, 8);
          this.overlayCtx.strokeRect(h.x, h.y, 8, 8);
        }
      }
    }

    if (this.isFloating && this.floatingImageData) {
      const f = this.floatingImageData;
      this.overlayCtx.drawImage(f.canvas, f.x, f.y);
      this.overlayCtx.strokeStyle = '#4da3ff';
      this.overlayCtx.lineWidth = 2;
      this.overlayCtx.setLineDash([6, 6]);
      this.overlayCtx.strokeRect(f.x, f.y, f.w, f.h);
      this.overlayCtx.setLineDash([]);
    } else if (this.selectionRect) {
      const r = this.selectionRect;
      this.overlayCtx.strokeStyle = 'rgba(0,0,0,0.8)';
      this.overlayCtx.lineWidth = 2;
      this.overlayCtx.setLineDash([6, 6]);
      this.overlayCtx.strokeRect(r.x, r.y, r.w, r.h);
      this.overlayCtx.strokeStyle = 'rgba(255,255,255,0.9)';
      this.overlayCtx.lineDashOffset = 6;
      this.overlayCtx.strokeRect(r.x, r.y, r.w, r.h);
      this.overlayCtx.setLineDash([]);
    }
  }

  _drawShapePreview(x1, y1, x2, y2) {
    this._applyStrokeStyle(this.overlayCtx);
    const x = Math.min(x1, x2); const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
    const t = this.currentTool;

    if (w < 1 || h < 1) return;

    if (t === 'select') {
      this.overlayCtx.strokeStyle = 'rgba(0,0,0,0.8)';
      this.overlayCtx.lineWidth = 2;
      this.overlayCtx.setLineDash([6, 6]);
      this.overlayCtx.strokeRect(x, y, w, h);
      this.overlayCtx.strokeStyle = 'rgba(255,255,255,0.9)';
      this.overlayCtx.lineDashOffset = 6;
      this.overlayCtx.strokeRect(x, y, w, h);
      this.overlayCtx.setLineDash([]);
      return;
    }

    this.overlayCtx.beginPath();
    if (t === 'rect') {
      this.overlayCtx.strokeRect(x, y, w, h);
    } else if (t === 'ellipse') {
      this.overlayCtx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.overlayCtx.stroke();
    } else if (t.startsWith('arrow-')) {
      this._drawArrowPath(this.overlayCtx, x, y, w, h, t.split('-')[1]);
      this.overlayCtx.stroke();
      this.overlayCtx.fill();
    }
  }

  _drawArrowPath(ctx, x, y, w, h, dir) {
    const headLen = dir === 'up' || dir === 'down' ? h * 0.4 : w * 0.4;
    const bodyW = dir === 'up' || dir === 'down' ? w * 0.3 : w * 0.6;
    const bodyH = dir === 'up' || dir === 'down' ? h * 0.6 : h * 0.3;

    if (dir === 'up') {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + headLen); ctx.lineTo(x + w / 2 + bodyW / 2, y + headLen);
      ctx.lineTo(x + w / 2 + bodyW / 2, y + h); ctx.lineTo(x + w / 2 - bodyW / 2, y + h);
      ctx.lineTo(x + w / 2 - bodyW / 2, y + headLen); ctx.lineTo(x, y + headLen);
    } else if (dir === 'down') {
      ctx.moveTo(x + w / 2, y + h);
      ctx.lineTo(x + w, y + h - headLen); ctx.lineTo(x + w / 2 + bodyW / 2, y + h - headLen);
      ctx.lineTo(x + w / 2 + bodyW / 2, y); ctx.lineTo(x + w / 2 - bodyW / 2, y);
      ctx.lineTo(x + w / 2 - bodyW / 2, y + h - headLen); ctx.lineTo(x, y + h - headLen);
    } else if (dir === 'left') {
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + headLen, y + h); ctx.lineTo(x + headLen, y + h / 2 + bodyH / 2);
      ctx.lineTo(x + w, y + h / 2 + bodyH / 2); ctx.lineTo(x + w, y + h / 2 - bodyH / 2);
      ctx.lineTo(x + headLen, y + h / 2 - bodyH / 2); ctx.lineTo(x + headLen, y);
    } else if (dir === 'right') {
      ctx.moveTo(x + w, y + h / 2);
      ctx.lineTo(x + w - headLen, y + h); ctx.lineTo(x + w - headLen, y + h / 2 + bodyH / 2);
      ctx.lineTo(x, y + h / 2 + bodyH / 2); ctx.lineTo(x, y + h / 2 - bodyH / 2);
      ctx.lineTo(x + w - headLen, y + h / 2 - bodyH / 2); ctx.lineTo(x + w - headLen, y);
    }
    ctx.closePath();
  }

  _finalizeSelectionRect(x1, y1, x2, y2) {
    const x = Math.min(x1, x2); const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
    if (w < 1 || h < 1) { this.selectionRect = null; this._clearOverlay(); }
    else { this.selectionRect = { x, y, w, h }; this._redrawOverlay(); }
  }

  // 選択領域の内容をフローティング画像に変換して移動可能にする
  _liftSelection() {
    if (!this.selectionRect) return;
    const r = this.selectionRect;
    // 選択領域のピクセルデータを取得
    const imgData = this.ctx.getImageData(r.x, r.y, r.w, r.h);
    // キャンバス上の選択領域をクリア
    this.ctx.clearRect(r.x, r.y, r.w, r.h);
    // フローティング用の一時キャンバスを作成
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = r.w; tmpCanvas.height = r.h;
    tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
    // フローティング状態へ移行
    this.isFloating = true;
    this.floatingImageData = { canvas: tmpCanvas, x: r.x, y: r.y, w: r.w, h: r.h };
    this.selectionRect = null;
    this._redrawOverlay();
  }

  copySelection() {
    if (!this.selectionRect) return;
    const r = this.selectionRect;
    this.clipboardData = { imgData: this.ctx.getImageData(r.x, r.y, r.w, r.h), w: r.w, h: r.h };

    // OSクリップボードへの書き込みを試行
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = r.w; srcCanvas.height = r.h;
      srcCanvas.getContext('2d').putImageData(this.clipboardData.imgData, 0, 0);

      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = r.w; tmpCanvas.height = r.h;
      const tCtx = tmpCanvas.getContext('2d');
      // mspaint等で透明部分が黒くなるのを防ぐため、白背景を敷く
      tCtx.fillStyle = '#ffffff';
      tCtx.fillRect(0, 0, r.w, r.h);
      tCtx.drawImage(srcCanvas, 0, 0);

      tmpCanvas.toBlob(blob => {
        if (!blob) return;
        const item = new ClipboardItem({ [blob.type]: blob });
        navigator.clipboard.write([item]).then(() => {
          this._showError('📄 コピーしました (他アプリでも使用可)');
        }).catch(() => {
          this._showError('📄 コピーしました (内部コピーのみ)');
        });
      }, 'image/png');
      return;
    }

    this._showError('📄 コピーしました');
  }

  paste() {
    this._commitFloatingImage();
    this._commitText();

    if (this.clipboardData) {
      // 内部クリップボードを使用
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = this.clipboardData.w; tmpCanvas.height = this.clipboardData.h;
      tmpCanvas.getContext('2d').putImageData(this.clipboardData.imgData, 0, 0);
      this._pasteCanvas(tmpCanvas);
    } else if (navigator.clipboard && navigator.clipboard.read) {
      // OSクリップボードから画像を取得（要パーミッション）
      navigator.clipboard.read().then(items => {
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            item.getType(imgType).then(blob => {
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = img.naturalWidth; tmpCanvas.height = img.naturalHeight;
                tmpCanvas.getContext('2d').drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                this._pasteCanvas(tmpCanvas);
              };
              img.src = url;
            });
            return;
          }
        }
        this._showError('クリップボードに画像がありません');
      }).catch(() => {
        this._showError('クリップボードの読み取り権限がありません。一度ツールでアクセスを許可してください。');
      });
    }
  }

  // 画像をフローティングペーストして配置する共通メソッド
  _pasteCanvas(srcCanvas) {
    const vpRect = this.viewport.getBoundingClientRect();
    const centerX = (vpRect.width / 2 - this.panX) / this.zoom;
    const centerY = (vpRect.height / 2 - this.panY) / this.zoom;

    const x = centerX - srcCanvas.width / 2;
    const y = centerY - srcCanvas.height / 2;

    this.isFloating = true;
    this.floatingImageData = { canvas: srcCanvas, x, y, w: srcCanvas.width, h: srcCanvas.height };
    this.selectionRect = null;
    this._redrawOverlay();
  }

  _commitFloatingImage() {
    if (this.isFloating && this.floatingImageData) {
      const f = this.floatingImageData;
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.drawImage(f.canvas, f.x, f.y);
      this.isFloating = false; this.floatingImageData = null;
      this._clearOverlay(); this._saveState();
    }
  }

  _showTextEditor(clickX, clickY) {
    this._commitFloatingImage();
    this.textEditor.style.display = 'block';

    // transform影響時に文字もスケールされるため、フォントサイズはピクセル直値でよい
    const fontSize = Math.max(12, this.lineWidth * 2);

    this.textEditor.style.left = clickX + 'px';
    this.textEditor.style.top = clickY + 'px';
    this.textEditor.style.color = this.color;
    this.textEditor.style.fontSize = this.fontSize + 'px';
    this.textEditor.style.fontFamily = 'sans-serif';
    this.textEditor.innerText = '';

    this.textEditor.dataset.x = clickX;
    this.textEditor.dataset.y = clickY;

    setTimeout(() => this.textEditor.focus(), 10);
  }

  _commitText() {
    if (this.textEditor.style.display === 'none') return;
    const text = this.textEditor.innerText;
    this.textEditor.style.display = 'none';
    if (text.trim() === '') return;

    const x = parseFloat(this.textEditor.dataset.x);
    const y = parseFloat(this.textEditor.dataset.y);
    const fontSize = this.fontSize;

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = this.color;
    this.ctx.font = `${fontSize}px sans-serif`;
    this.ctx.textBaseline = 'top';

    const lines = text.split('\n');
    let currentY = y;
    for (let line of lines) {
      this.ctx.fillText(line, x, currentY);
      currentY += fontSize * 1.2;
    }
    this._saveState();
  }

  _fillArea(startX, startY) {
    const w = this.canvas.width; const h = this.canvas.height;
    const imageData = this.ctx.getImageData(0, 0, w, h); const data = imageData.data;
    const idx = (x, y) => (y * w + x) * 4;
    const target = Array.from(data.slice(idx(startX, startY), idx(startX, startY) + 4));

    const clean = this.color.replace('#', '');
    const fillColor = {
      r: parseInt(clean.substring(0, 2), 16), g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16), a: clean.length === 8 ? parseInt(clean.substring(6, 8), 16) : 255
    };
    if (target[0] === fillColor.r && target[1] === fillColor.g && target[2] === fillColor.b && target[3] === fillColor.a) return;

    const isSameColor = (i) => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
    const setColor = (i) => { data[i] = fillColor.r; data[i + 1] = fillColor.g; data[i + 2] = fillColor.b; data[i + 3] = fillColor.a; };

    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h); visited[startY * w + startX] = 1;

    while (stack.length) {
      const [x, y] = stack.pop(); const i = idx(x, y);
      if (!isSameColor(i)) continue;
      setColor(i);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
          visited[ny * w + nx] = 1; stack.push([nx, ny]);
        }
      }
    }
    this.ctx.putImageData(imageData, 0, 0);
  }

  _saveState() {
    this.historyStep++; this.history.length = this.historyStep;
    this.history.push(this.canvas.toDataURL('image/png'));
    if (this.history.length > 30) { this.history.shift(); this.historyStep--; }
    this._fireHistoryChange();
  }

  _fireHistoryChange() {
    const canUndo = this.historyStep > 0; const canRedo = this.historyStep < this.history.length - 1;
    if (this._onHistoryChange) this._onHistoryChange(canUndo, canRedo);
    if (this._hasToolbar) {
      this._btnUndo.disabled = !canUndo; this._btnUndo.classList.toggle('paint-disabled', !canUndo);
      this._btnRedo.disabled = !canRedo; this._btnRedo.classList.toggle('paint-disabled', !canRedo);
    }
  }

  _restoreState() {
    const img = new Image();
    const targetStep = this.historyStep;
    img.onload = () => {
      // ユーザーが高速にUndoを連打した場合の非同期の順序入れ替わりを防ぐ
      if (this.historyStep !== targetStep) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.drawImage(img, 0, 0);
      this._fireHistoryChange();
    };
    img.src = this.history[this.historyStep];
  }

  _updateCursor() {
    if (this.isSpaceDown || this.isPanning) {
      this.overlayCanvas.style.cursor = this.isPanning ? 'grabbing' : 'grab';
      return;
    }
    if (this.isFloating) { this.overlayCanvas.style.cursor = 'move'; return; }
    if (['rect', 'ellipse', 'select'].includes(this.currentTool) || this.currentTool.startsWith('arrow-')) {
      this.overlayCanvas.style.cursor = 'crosshair';
    } else if (this.currentTool === 'text') {
      this.overlayCanvas.style.cursor = 'text';
    } else if (this.currentTool === 'eraser') {
      const s = Math.max(8, this.lineWidth); const half = Math.round(s / 2);
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><rect x='0.5' y='0.5' width='${s - 1}' height='${s - 1}' fill='rgba(255,255,255,0.7)' stroke='#555' stroke-width='1'/></svg>`;
      this.overlayCanvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, cell`;
    } else if (this.currentTool === 'fill') {
      this.overlayCanvas.style.cursor = 'cell';
    } else {
      const s = Math.max(8, this.lineWidth); const half = Math.round(s / 2);
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><circle cx='${half}' cy='${half}' r='${half - 1}' fill='rgba(0,0,0,0.15)' stroke='#333' stroke-width='1'/></svg>`;
      this.overlayCanvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, crosshair`;
    }
  }

  _refreshToolbarState() {
    if (!this._hasToolbar) return;
    Object.values(this._tbBtns).forEach(btn => btn.classList.remove('paint-active'));
    if (this._tbBtns[this.currentTool]) this._tbBtns[this.currentTool].classList.add('paint-active');
  }

  setColor(colorHex) {
    this.color = colorHex;
    if (this._hasToolbar && this._btnColor) this._btnColor.style.backgroundColor = colorHex;
    if (this.editableShapes && this.activeShape) {
      this.activeShape.color = colorHex;
      this._redrawOverlay();
    }
  }
  setLineWidth(width) {
    this.lineWidth = width;
    if (this._hasToolbar && this._sizeSlider) this._sizeSlider.value = width;
    if (this.editableShapes && this.activeShape) {
      this.activeShape.lineWidth = width;
      this._redrawOverlay();
    }
    this._updateCursor();
  }
  setFontSize(px) {
    this.fontSize = px;
    if (this._hasToolbar && this._fontSizeInput) this._fontSizeInput.value = px;
  }
  setTool(tool) {
    this._commitFloatingImage(); this._commitText();
    this.selectionRect = null; this._clearOverlay();
    this.currentTool = tool; this.ctx.globalCompositeOperation = 'source-over';
    this._updateCursor(); this._refreshToolbarState();
    if (this._onToolChange) this._onToolChange(tool);
  }
  bakeShapes() {
    if (!this.shapes || this.shapes.length === 0) return;
    this.activeShape = null;
    this.ctx.globalCompositeOperation = 'source-over';
    for (const shape of this.shapes) {
      this.ctx.lineWidth = shape.lineWidth;
      this.ctx.strokeStyle = shape.color;
      this.ctx.fillStyle = shape.color;
      this.ctx.beginPath();
      if (shape.type === 'rect') {
        this.ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      } else if (shape.type === 'ellipse') {
        this.ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, shape.w / 2, shape.h / 2, 0, 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (shape.type.startsWith('arrow-')) {
        this._drawArrowPath(this.ctx, shape.x, shape.y, shape.w, shape.h, shape.type.split('-')[1]);
        this.ctx.stroke();
        this.ctx.fill();
      }
    }
    this.shapes = [];
    this._clearOverlay();
    this._saveState();
  }

  _hitTestShape(x, y, shape) {
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  }

  _getHandles(shape) {
    const x = shape.x; const y = shape.y; const w = shape.w; const h = shape.h;
    const hf = 4;
    return [
      { dir: 'nw', x: x - hf, y: y - hf },
      { dir: 'n', x: x + w / 2 - hf, y: y - hf },
      { dir: 'ne', x: x + w - hf, y: y - hf },
      { dir: 'w', x: x - hf, y: y + h / 2 - hf },
      { dir: 'e', x: x + w - hf, y: y + h / 2 - hf },
      { dir: 'sw', x: x - hf, y: y + h - hf },
      { dir: 's', x: x + w / 2 - hf, y: y + h - hf },
      { dir: 'se', x: x + w - hf, y: y + h - hf }
    ];
  }

  _hitTestHandles(x, y, shape) {
    const handles = this._getHandles(shape);
    for (let h of handles) {
      if (x >= h.x && x <= h.x + 8 && y >= h.y && y <= h.y + 8) return h.dir;
    }
    return null;
  }

  clearCanvas() {
    if (this.editableShapes) {
      this.shapes = [];
      this.activeShape = null;
      this._clearOverlay();
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._saveState();
  }
  undo() { if (this.historyStep > 0) { this.historyStep--; this._restoreState(); } }
  redo() { if (this.historyStep < this.history.length - 1) { this.historyStep++; this._restoreState(); } }
  loadImage(source) {
    return new Promise((res, rej) => {
      const exec = (src) => {
        const img = new Image();
        img.onload = () => {
          if (this.editableShapes) {
            this.shapes = [];
            this.activeShape = null;
            this._clearOverlay();
          }
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
          this._saveState(); res();
        }; img.onerror = () => rej(new Error('')); img.src = src;
      };
      if (source instanceof File) {
        const r = new FileReader(); r.onload = e => exec(e.target.result); r.readAsDataURL(source);
      } else exec(source);
    });
  }

  // --- File System Access API 関連 ---
  async saveOverwrite() {
    if (!window.showSaveFilePicker) {
      this.downloadImage('drawing.png');
      return;
    }
    try {
      if (!this.fileHandle) {
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName: 'drawing.png',
          types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }]
        });
      }
      const writable = await this.fileHandle.createWritable();
      const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
      await writable.write(blob);
      await writable.close();
      this._showError('✅ 保存しました');
    } catch (e) {
      if (e.name !== 'AbortError') this._showError('保存中にエラーが発生しました');
    }
  }

  async openWithHandle() {
    if (!window.showOpenFilePicker) {
      if (this._fileInput) this._fileInput.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] } }]
      });
      this.fileHandle = handle;
      const file = await handle.getFile();
      await this.loadImage(file);
    } catch (e) {
      if (e.name !== 'AbortError') this._showError('ファイルを開く際にエラーが発生しました');
    }
  }

  getImageData(fmt = 'image/png') { return this.canvas.toDataURL(fmt); }
  downloadImage(name, fmt = 'image/png') {
    const a = document.createElement('a'); a.href = this.getImageData(fmt);
    a.download = name || 'drawing.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  getCanvas() { return this.canvas; }
  resizeCanvas(width, height) {
    this.width = width; this.height = height;
    this.viewport.style.width = width + 'px'; this.viewport.style.height = height + 'px';
    this.canvasWrap.style.width = width + 'px'; this.canvasWrap.style.height = height + 'px';
    this.canvas.width = width; this.canvas.height = height;
    this.overlayCanvas.width = width; this.overlayCanvas.height = height;
    // ステータスバーの入力欄も同期
    if (this._hasStatusBar && this._canvasWidthInput) {
      this._canvasWidthInput.value = width;
      this._canvasHeightInput.value = height;
    }
    this.clearCanvas();
  }

  // ── ステータスバー（キャンバスサイズ変更UI） ──────────────────────
  _createStatusBar() {
    const bar = document.createElement('div');
    bar.className = 'paint-statusbar';

    const label = document.createElement('span');
    label.className = 'paint-status-label';
    label.textContent = 'キャンバスサイズ:';

    this._canvasWidthInput = document.createElement('input');
    this._canvasWidthInput.type = 'number';
    this._canvasWidthInput.min = 50; this._canvasWidthInput.max = 16000;
    this._canvasWidthInput.value = this.width;
    this._canvasWidthInput.className = 'paint-status-input';
    this._canvasWidthInput.title = '幅 (px)';

    const xLabel = document.createElement('span');
    xLabel.textContent = '×';
    xLabel.className = 'paint-status-sep';

    this._canvasHeightInput = document.createElement('input');
    this._canvasHeightInput.type = 'number';
    this._canvasHeightInput.min = 50; this._canvasHeightInput.max = 16000;
    this._canvasHeightInput.value = this.height;
    this._canvasHeightInput.className = 'paint-status-input';
    this._canvasHeightInput.title = '高さ (px)';

    const unitLabel = document.createElement('span');
    unitLabel.textContent = 'px';
    unitLabel.className = 'paint-status-unit';

    // 適用ボタン
    const applyBtn = document.createElement('button');
    applyBtn.className = 'paint-tb-btn paint-status-apply';
    applyBtn.textContent = '適用';
    applyBtn.title = 'キャンバスサイズを変更（内容は消去されます）';
    applyBtn.addEventListener('click', () => {
      const newW = parseInt(this._canvasWidthInput.value, 10);
      const newH = parseInt(this._canvasHeightInput.value, 10);
      if (!newW || !newH || newW < 50 || newH < 50) {
        this._showError('サイズは最低50pxを指定してください');
        return;
      }
      if (newW === this.width && newH === this.height) return;
      if (confirm(t('confirm.resizeCanvas').replace('${newW}', newW).replace('${newH}', newH))) {
        this.resizeCanvas(newW, newH);
      }
    });

    bar.appendChild(label);
    bar.appendChild(this._canvasWidthInput);
    bar.appendChild(xLabel);
    bar.appendChild(this._canvasHeightInput);
    bar.appendChild(unitLabel);
    bar.appendChild(applyBtn);

    // スペーサー（右寄せ用）
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // アクションボタン（キャンセル・保存）
    if (this._actionButtons) {
      if (this._actionButtons.cancelText !== false) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'paint-tb-btn paint-status-cancel';
        cancelBtn.textContent = this._actionButtons.cancelText || 'キャンセル';
        cancelBtn.addEventListener('click', () => {
          if (this._actionButtons.onCancel) this._actionButtons.onCancel();
        });
        bar.appendChild(cancelBtn);
      }
      if (this._actionButtons.saveText !== false) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'paint-tb-btn paint-status-save';
        saveBtn.textContent = this._actionButtons.saveText || '保存';
        saveBtn.addEventListener('click', () => {
          if (this.editableShapes) this.bakeShapes();
          if (this._actionButtons.onSave) this._actionButtons.onSave(this.getImageData());
        });
        bar.appendChild(saveBtn);
      }
    }

    return bar;
  }

  // ── キャンバスリサイズハンドル ────────────────────────────────
  _addResizeHandles() {
    const container = document.createElement('div');
    container.className = 'paint-resize-handles';

    // ハンドルの種類: bottom-right, bottom-center, right-center
    const handles = [
      { cls: 'paint-resize-br', dir: 'both' },
      { cls: 'paint-resize-bm', dir: 'y' },
      { cls: 'paint-resize-rm', dir: 'x' },
    ];

    handles.forEach(({ cls, dir }) => {
      const h = document.createElement('div');
      h.className = 'paint-resize-handle ' + cls;

      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = this.canvas.width;
        const startH = this.canvas.height;

        h.setPointerCapture(e.pointerId);
        container.classList.add('paint-resizing');

        const onMove = (e) => {
          const dx = (e.clientX - startX) / this.zoom;
          const dy = (e.clientY - startY) / this.zoom;
          const newW = Math.max(50, Math.round(startW + (dir !== 'y' ? dx : 0)));
          const newH = Math.max(50, Math.round(startH + (dir !== 'x' ? dy : 0)));
          // プレビュー（キャンバス内容は変えず、枠だけ変更）
          this.viewport.style.width = newW + 'px';
          this.viewport.style.height = newH + 'px';
          this.canvasWrap.style.width = newW + 'px';
          this.canvasWrap.style.height = newH + 'px';
          // ステータスバー表示も更新
          if (this._canvasWidthInput) {
            this._canvasWidthInput.value = newW;
            this._canvasHeightInput.value = newH;
          }
        };

        const onUp = () => {
          h.removeEventListener('pointermove', onMove);
          h.removeEventListener('pointerup', onUp);
          container.classList.remove('paint-resizing');
          const finalW = parseInt(this.viewport.style.width, 10);
          const finalH = parseInt(this.viewport.style.height, 10);
          // コンテンツを維持したままリサイズ確定
          this._resizeWithContent(finalW, finalH);
        };

        h.addEventListener('pointermove', onMove);
        h.addEventListener('pointerup', onUp);
      });

      container.appendChild(h);
    });

    this.canvasWrap.appendChild(container);
  }

  // コンテンツを保持したままキャンバスをリサイズ（cropまたは拡張）
  _resizeWithContent(newW, newH) {
    // リサイズ前の描画内容を保存
    const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    this.width = newW;
    this.height = newH;
    this.canvas.width = newW;
    this.canvas.height = newH;
    this.overlayCanvas.width = newW;
    this.overlayCanvas.height = newH;
    this.viewport.style.width = newW + 'px';
    this.viewport.style.height = newH + 'px';
    this.canvasWrap.style.width = newW + 'px';
    this.canvasWrap.style.height = newH + 'px';

    // 元の内容を復元（はみ出した分はclip、拡大した部分は透明）
    this.ctx.putImageData(imgData, 0, 0);

    // ステータスバー同期
    if (this._hasStatusBar && this._canvasWidthInput) {
      this._canvasWidthInput.value = newW;
      this._canvasHeightInput.value = newH;
    }
    this._saveState();
  }
}

if (typeof window !== 'undefined') window.PaintLibrary = PaintLibrary;
