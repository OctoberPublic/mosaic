// game.js — ゲーム状態と操作ロジック(塗り/アンドゥ/リドゥ/ヒント/エラー/クリア判定)
import { UNKNOWN, FILLED, EMPTY } from './solver.js';

export class Game {
  constructor(handlers = {}) {
    this.handlers = handlers; // { onChange, onClear }
    this.puzzle = null;
    this.marks = null;
    this.errors = null;
    this.tool = 'fill'; // 'fill' | 'cross'

    this.undoStack = [];
    this.redoStack = [];
    this._stroke = null;
    this._strokeTarget = FILLED;
    this._strokeErase = false;

    this.solutionFills = 0;
    this.correctFills = 0;
    this.wrongFills = 0;
    this.cleared = false;
  }

  setTool(t) { this.tool = t; }

  setPuzzle(puzzle, marks = null) {
    this.puzzle = puzzle;
    const N = puzzle.width * puzzle.height;
    this.marks = marks && marks.length === N ? marks : new Int8Array(N);
    this.errors = new Uint8Array(N);
    this.undoStack = [];
    this.redoStack = [];
    this._stroke = null;
    this.cleared = false;
    this._recomputeAll();
  }

  _recomputeAll() {
    const p = this.puzzle;
    let sFills = 0, correct = 0, wrong = 0;
    for (let i = 0; i < this.marks.length; i++) {
      if (!p.mask[i]) continue;
      if (p.solution[i]) sFills++;
      if (this.marks[i] === FILLED) {
        if (p.solution[i]) correct++; else wrong++;
      }
    }
    this.solutionFills = sFills;
    this.correctFills = correct;
    this.wrongFills = wrong;
    // 全ヒントのエラー再計算
    for (let i = 0; i < this.marks.length; i++) {
      if (p.mask[i] && p.clues[i] >= 0) this.errors[i] = this._clueViolated(i) ? 1 : 0;
      else this.errors[i] = 0;
    }
  }

  // ヒント j が現在のマークと矛盾しているか
  _clueViolated(j) {
    const p = this.puzzle;
    const v = p.clues[j];
    const W = p.width, H = p.height;
    const jx = j % W, jy = (j / W) | 0;
    let pf = 0, pu = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = jy + dy; if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = jx + dx; if (nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (!p.mask[ni]) continue;
        const m = this.marks[ni];
        if (m === FILLED) pf++;
        else if (m === UNKNOWN) pu++;
      }
    }
    return pf > v || pf + pu < v;
  }

  _updateErrorsAround(i) {
    const p = this.puzzle;
    const W = p.width, H = p.height;
    const ix = i % W, iy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = iy + dy; if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ix + dx; if (nx < 0 || nx >= W) continue;
        const j = ny * W + nx;
        if (p.mask[j] && p.clues[j] >= 0) this.errors[j] = this._clueViolated(j) ? 1 : 0;
      }
    }
  }

  // 低レベルのマーク変更(カウンタ・エラーを更新)。変化したら true。
  _setCell(i, val) {
    const p = this.puzzle;
    const old = this.marks[i];
    if (old === val) return false;
    if (old === FILLED) { if (p.solution[i]) this.correctFills--; else this.wrongFills--; }
    this.marks[i] = val;
    if (val === FILLED) { if (p.solution[i]) this.correctFills++; else this.wrongFills++; }
    this._updateErrorsAround(i);
    return true;
  }

  // --- ドラッグ塗り ---
  startPaint(cell, useCross) {
    const target = useCross ? EMPTY : (this.tool === 'fill' ? FILLED : EMPTY);
    this._strokeTarget = target;
    this._strokeErase = this.marks[cell] === target; // 同じなら消す
    this._stroke = [];
    this._applyStroke(cell);
    this.handlers.onChange?.();
  }
  paintMove(cell) {
    if (!this._stroke) return;
    if (this._applyStroke(cell)) this.handlers.onChange?.();
  }
  _applyStroke(cell) {
    const val = this._strokeErase ? UNKNOWN : this._strokeTarget;
    const old = this.marks[cell];
    if (old === val) return false;
    this._stroke.push({ i: cell, prev: old, next: val });
    this._setCell(cell, val);
    return true;
  }
  endPaint() {
    if (this._stroke && this._stroke.length) {
      this.undoStack.push(this._stroke);
      this.redoStack.length = 0;
    }
    this._stroke = null;
    this._afterChange();
  }

  // タップ1回(ドラッグなし)も startPaint→endPaint で表現できる
  tap(cell, useCross) { this.startPaint(cell, useCross); this.endPaint(); }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    for (let k = s.length - 1; k >= 0; k--) this._setCell(s[k].i, s[k].prev);
    this.redoStack.push(s);
    this._afterChange();
    return true;
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return false;
    for (let k = 0; k < s.length; k++) this._setCell(s[k].i, s[k].next);
    this.undoStack.push(s);
    this._afterChange();
    return true;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  // ヒント: 間違っているマスがあれば1つ修正、なければ未確定の正解マスを1つ開示。
  // 戻り値: 開示したセルindex / 既に完成なら -1
  hint() {
    const p = this.puzzle;
    const N = this.marks.length;
    // まず間違い(塗ったが解と不一致 / ×なのに塗るべき)を探す
    let wrong = -1, blankFill = -1, blankCross = -1;
    // 走査開始位置をずらして毎回同じ箇所にならないようにする
    const start = (this._hintCursor || 0) % N;
    for (let s = 0; s < N; s++) {
      const i = (start + s) % N;
      if (!p.mask[i]) continue;
      const correct = p.solution[i] ? FILLED : EMPTY;
      const m = this.marks[i];
      if (m !== UNKNOWN && m !== correct) { wrong = i; break; }
      if (m === UNKNOWN) {
        if (correct === FILLED && blankFill < 0) blankFill = i;
        else if (correct === EMPTY && blankCross < 0) blankCross = i;
      }
    }
    const target = wrong >= 0 ? wrong : (blankFill >= 0 ? blankFill : blankCross);
    if (target < 0) return -1;
    this._hintCursor = target + 1;
    const correct = p.solution[target] ? FILLED : EMPTY;
    const stroke = [{ i: target, prev: this.marks[target], next: correct }];
    this._setCell(target, correct);
    this.undoStack.push(stroke);
    this.redoStack.length = 0;
    this._afterChange();
    return target;
  }

  _afterChange() {
    this.handlers.onChange?.();
    if (!this.cleared && this.correctFills === this.solutionFills && this.wrongFills === 0) {
      this.cleared = true;
      this.handlers.onClear?.();
    }
  }

  isClear() { return this.correctFills === this.solutionFills && this.wrongFills === 0; }
}
