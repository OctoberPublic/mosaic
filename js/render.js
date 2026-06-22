// render.js — Canvas 描画とジェスチャ(ピンチズーム/パン/ドラッグ塗り)
import { UNKNOWN, FILLED, EMPTY } from './solver.js';

const COLORS = {
  bg: '#0f1117',
  cellUnknown: '#e9edf3',
  cellFilled: '#1b2430',
  cellEmpty: '#cfd6e0',
  grid: '#b8c0cc',
  gridMajor: '#7f8a9c',
  clue: '#1b2430',
  clueOnFilled: '#eef2f8',
  clueError: '#e53935',
  clueErrorOnFilled: '#ff8a80',
  cross: '#9aa4b2',
  clearFilled: '#10203a',
  clearEmpty: '#f4f7fb',
};

export class Renderer {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers; // { onPaintStart, onPaintMove, onPaintEnd }

    this.width = 0; this.height = 0;
    this.mask = null; this.marks = null; this.clues = null;
    this.errors = null; this.solution = null;
    this.revealClear = false;

    this.scale = 16;       // 1セルのCSSピクセル
    this.originX = 0; this.originY = 0; // セル(0,0)左上のCSS座標
    this.minScale = 4; this.maxScale = 64;

    this.panMode = false;
    this._pointers = new Map();
    this._painting = false;
    this._lastCell = -1;
    this._pinchDist = 0; this._pinchMid = null;
    this._drawScheduled = false;

    this.cssW = 0; this.cssH = 0; this.dpr = 1;

    this._bindEvents();
    this.resize();
  }

  setPuzzle(p) {
    this.width = p.width; this.height = p.height;
    this.mask = p.mask; this.clues = p.clues; this.solution = p.solution;
    this.revealClear = false;
    this.fit();
  }
  setMarks(marks) { this.marks = marks; }
  setErrors(errors) { this.errors = errors; }
  setPanMode(on) { this.panMode = on; }
  setRevealClear(on) { this.revealClear = on; this.requestDraw(); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.requestDraw();
  }

  // 盤面全体が収まるように合わせる
  fit() {
    if (!this.width) return;
    const margin = 12;
    const sx = (this.cssW - margin * 2) / this.width;
    const sy = (this.cssH - margin * 2) / this.height;
    let s = Math.min(sx, sy);
    s = Math.max(this.minScale, Math.min(this.maxScale, s));
    this.scale = s;
    this.originX = (this.cssW - this.width * s) / 2;
    this.originY = (this.cssH - this.height * s) / 2;
    this.requestDraw();
  }

  zoomBy(factor, cx, cy) {
    if (cx == null) { cx = this.cssW / 2; cy = this.cssH / 2; }
    const ns = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    const k = ns / this.scale;
    // (cx,cy) を固定点としてズーム
    this.originX = cx - (cx - this.originX) * k;
    this.originY = cy - (cy - this.originY) * k;
    this.scale = ns;
    this.requestDraw();
  }

  _clientToCss(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _cssToCell(x, y) {
    const cx = Math.floor((x - this.originX) / this.scale);
    const cy = Math.floor((y - this.originY) / this.scale);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return -1;
    const i = cy * this.width + cx;
    if (!this.mask || !this.mask[i]) return -1;
    return i;
  }

  _bindEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this._clientToCss(e);
      this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
    }, { passive: false });
    window.addEventListener('resize', () => this.resize());
  }

  _onDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._clientToCss(e);
    this._pointers.set(e.pointerId, p);

    if (this._pointers.size >= 2) {
      // 2本指: パン/ズームへ。塗り中なら中断。
      if (this._painting) { this._painting = false; this.handlers.onPaintEnd?.(); }
      this._startPinch();
      return;
    }

    // マウス右ボタンは「×」塗り、左/タッチは現在ツール
    const useCross = e.pointerType === 'mouse' && e.button === 2;
    if (this.panMode) { this._panning = true; this._panLast = p; return; }

    const cell = this._cssToCell(p.x, p.y);
    this._painting = true;
    this._lastCell = cell;
    if (cell >= 0) this.handlers.onPaintStart?.(cell, useCross);
  }

  _onMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const p = this._clientToCss(e);
    this._pointers.set(e.pointerId, p);

    if (this._pointers.size >= 2) { this._updatePinch(); return; }

    if (this._panning) {
      this.originX += p.x - this._panLast.x;
      this.originY += p.y - this._panLast.y;
      this._panLast = p;
      this.requestDraw();
      return;
    }

    if (this._painting) {
      const cell = this._cssToCell(p.x, p.y);
      if (cell >= 0 && cell !== this._lastCell) {
        this._lastCell = cell;
        this.handlers.onPaintMove?.(cell);
      }
    }
  }

  _onUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) { this._pinchDist = 0; this._pinchMid = null; }
    if (this._pointers.size === 0) {
      if (this._painting) { this._painting = false; this.handlers.onPaintEnd?.(); }
      this._panning = false;
    }
  }

  _twoPointers() {
    const it = this._pointers.values();
    const a = it.next().value, b = it.next().value;
    return [a, b];
  }
  _startPinch() {
    const [a, b] = this._twoPointers();
    if (!a || !b) return;
    this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this._pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this._painting = false; this._panning = false;
  }
  _updatePinch() {
    const [a, b] = this._twoPointers();
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this._pinchDist > 0) {
      const factor = dist / this._pinchDist;
      const ns = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
      const k = ns / this.scale;
      this.originX = mid.x - (mid.x - this.originX) * k;
      this.originY = mid.y - (mid.y - this.originY) * k;
      this.scale = ns;
      // 中点移動分のパン
      this.originX += mid.x - this._pinchMid.x;
      this.originY += mid.y - this._pinchMid.y;
    }
    this._pinchDist = dist;
    this._pinchMid = mid;
    this.requestDraw();
  }

  requestDraw() {
    if (this._drawScheduled) return;
    this._drawScheduled = true;
    requestAnimationFrame(() => { this._drawScheduled = false; this.draw(); });
  }

  draw() {
    const ctx = this.ctx;
    const { dpr, cssW, cssH, scale } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!this.width || !this.mask) return;

    const W = this.width, H = this.height;
    // 可視範囲のセルだけ描く
    let x0 = Math.floor((-this.originX) / scale) - 1;
    let y0 = Math.floor((-this.originY) / scale) - 1;
    let x1 = Math.ceil((cssW - this.originX) / scale) + 1;
    let y1 = Math.ceil((cssH - this.originY) / scale) + 1;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(W, x1); y1 = Math.min(H, y1);

    const showNum = scale >= 11 && !this.revealClear;
    const showGrid = scale >= 6;
    const fs = Math.min(scale * 0.62, scale - 2);
    if (showNum) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${fs}px system-ui, sans-serif`; }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        if (!this.mask[i]) continue;
        const px = this.originX + x * scale;
        const py = this.originY + y * scale;
        const m = this.marks ? this.marks[i] : UNKNOWN;

        if (this.revealClear) {
          ctx.fillStyle = this.solution && this.solution[i] ? COLORS.clearFilled : COLORS.clearEmpty;
          ctx.fillRect(px, py, scale, scale);
          continue;
        }

        // セル背景
        if (m === FILLED) ctx.fillStyle = COLORS.cellFilled;
        else if (m === EMPTY) ctx.fillStyle = COLORS.cellEmpty;
        else ctx.fillStyle = COLORS.cellUnknown;
        ctx.fillRect(px, py, scale, scale);

        // ×印
        if (m === EMPTY && scale >= 9) {
          ctx.strokeStyle = COLORS.cross;
          ctx.lineWidth = Math.max(1, scale * 0.06);
          const pad = scale * 0.28;
          ctx.beginPath();
          ctx.moveTo(px + pad, py + pad); ctx.lineTo(px + scale - pad, py + scale - pad);
          ctx.moveTo(px + scale - pad, py + pad); ctx.lineTo(px + pad, py + scale - pad);
          ctx.stroke();
        }

        // ヒント数字
        if (showNum) {
          const v = this.clues[i];
          if (v >= 0) {
            const err = this.errors && this.errors[i];
            if (m === FILLED) ctx.fillStyle = err ? COLORS.clueErrorOnFilled : COLORS.clueOnFilled;
            else ctx.fillStyle = err ? COLORS.clueError : COLORS.clue;
            ctx.fillText(String(v), px + scale / 2, py + scale / 2 + scale * 0.04);
          }
        }
      }
    }

    if (showGrid) this._drawGrid(ctx, x0, y0, x1, y1, scale);
  }

  _drawGrid(ctx, x0, y0, x1, y1, scale) {
    const W = this.width, H = this.height;
    // 細グリッド
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const px = Math.round(this.originX + x * scale) + 0.5;
      ctx.moveTo(px, this.originY + y0 * scale);
      ctx.lineTo(px, this.originY + y1 * scale);
    }
    for (let y = y0; y <= y1; y++) {
      const py = Math.round(this.originY + y * scale) + 0.5;
      ctx.moveTo(this.originX + x0 * scale, py);
      ctx.lineTo(this.originX + x1 * scale, py);
    }
    ctx.stroke();
    // 5マスごとの太線
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      if (x % 5 !== 0 && x !== W) continue;
      const px = Math.round(this.originX + x * scale) + 0.5;
      ctx.moveTo(px, this.originY + y0 * scale);
      ctx.lineTo(px, this.originY + y1 * scale);
    }
    for (let y = y0; y <= y1; y++) {
      if (y % 5 !== 0 && y !== H) continue;
      const py = Math.round(this.originY + y * scale) + 0.5;
      ctx.moveTo(this.originX + x0 * scale, py);
      ctx.lineTo(this.originX + x1 * scale, py);
    }
    ctx.stroke();
  }
}
