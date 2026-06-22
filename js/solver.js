// solver.js — Fill-a-Pix (Mosaic) の論理ソルバーと唯一解判定
//
// セル状態
export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

// 盤面表現:
//   width, height        : 盤面のサイズ
//   mask  : Uint8Array    : 1 ならそのマスは領域内(存在する)
//   clues : Int8Array     : 0..9 = 表示ヒント / -1 = ヒント無し
//
// 各ヒントは「そのマスを中心とした最大3x3の領域内マスのうち塗るマス数」を表す。

// 表示中ヒントから制約リストと付随インデックスを構築する。
export function prepare(width, height, mask, clues) {
  const N = width * height;
  const constraints = []; // { value, cells:[セルindex...] }
  const centerCell = [];  // constraints[c] の中心セル
  const cellToCon = new Int32Array(N).fill(-1); // 中心セル -> 制約index
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const v = clues[i];
      if (v < 0) continue;
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const ni = ny * width + nx;
          if (!mask[ni]) continue;
          cells.push(ni);
        }
      }
      cellToCon[i] = constraints.length;
      centerCell.push(i);
      constraints.push({ value: v, cells });
    }
  }
  const nc = constraints.length;

  // セル -> そのセルを含む制約index一覧
  const cellCons = new Array(N);
  for (let c = 0; c < nc; c++) {
    const cells = constraints[c].cells;
    for (let k = 0; k < cells.length; k++) {
      const ci = cells[k];
      (cellCons[ci] || (cellCons[ci] = [])).push(c);
    }
  }

  // 各制約の「重なり相手」(共有セルを持つ制約)を列挙(重なり推論で使用)
  const partnerSets = Array.from({ length: nc }, () => new Set());
  for (let i = 0; i < N; i++) {
    const cs = cellCons[i];
    if (!cs || cs.length < 2) continue;
    for (let a = 0; a < cs.length; a++) {
      for (let b = a + 1; b < cs.length; b++) {
        partnerSets[cs[a]].add(cs[b]);
        partnerSets[cs[b]].add(cs[a]);
      }
    }
  }
  const partners = partnerSets.map((s) => Int32Array.from(s));

  let inRegion = 0;
  for (let i = 0; i < N; i++) if (mask[i]) inRegion++;

  return {
    N, width, height, mask, constraints, cellCons, partners,
    centerCell, cellToCon, inRegion,
    // propagate 用の再利用スクラッチ(毎回確保しないことで高速化)
    _dirty: new Uint8Array(nc),
    _queue: new Int32Array(nc),
    _stamp: new Int32Array(N),
    _stampId: 0,
    _u1: new Int32Array(9), _u2: new Int32Array(9),
    _A: new Int32Array(9), _B: new Int32Array(9), _C: new Int32Array(9),
  };
}

// 与えられた grid を破壊的に伝播する。
// 戻り値: 'solved' | 'partial' | 'contradiction'
// maxTier: 1=基本ルールのみ / 2=基本+重なり推論
// active : Uint8Array(制約数) — 1の制約だけ使う(省略時は全制約)
export function propagate(prep, grid, maxTier = 2, active = null) {
  const { N, constraints, cellCons, partners, mask } = prep;
  const nc = constraints.length;
  const dirty = prep._dirty;   // 直前のクリーン終了後は全0
  const queue = prep._queue;
  let qlen = 0;
  for (let c = 0; c < nc; c++) {
    if (active && !active[c]) continue;
    queue[qlen++] = c; dirty[c] = 1;
  }

  let contradiction = false;

  // 重なり推論用スクラッチ(1制約のセルは最大9個)
  // stampId は呼び出しをまたいで単調増加させ、stamp のクリアを不要にする
  const stamp = prep._stamp;
  let stampId = prep._stampId;
  if (stampId > 2000000000) { stamp.fill(0); stampId = 0; } // 桁あふれ防止
  const u1 = prep._u1, u2 = prep._u2;
  const A = prep._A, B = prep._B, C = prep._C;

  function setCell(i, val) {
    const g = grid[i];
    if (g === val) return 0;
    if (g !== UNKNOWN) { contradiction = true; return -1; }
    grid[i] = val;
    const cs = cellCons[i];
    if (cs) for (let j = 0; j < cs.length; j++) {
      const c = cs[j];
      if ((!active || active[c]) && !dirty[c]) { dirty[c] = 1; queue[qlen++] = c; }
    }
    return 1;
  }

  // 制約 c の基本ルール。矛盾なら false。
  function basicRule(c) {
    const con = constraints[c];
    const cells = con.cells;
    let f = 0, u = 0;
    for (let k = 0; k < cells.length; k++) {
      const g = grid[cells[k]];
      if (g === FILLED) f++; else if (g === UNKNOWN) u++;
    }
    if (f > con.value || f + u < con.value) { contradiction = true; return false; }
    if (u === 0) return true;
    if (f === con.value) {
      for (let k = 0; k < cells.length; k++) {
        if (grid[cells[k]] === UNKNOWN && setCell(cells[k], EMPTY) < 0) return false;
      }
    } else if (f + u === con.value) {
      for (let k = 0; k < cells.length; k++) {
        if (grid[cells[k]] === UNKNOWN && setCell(cells[k], FILLED) < 0) return false;
      }
    }
    return true;
  }

  // 制約 c1,c2 の重なり推論。未確定セルを A(c1のみ)/B(共有)/C(c2のみ) に分け、
  // 塗り数の連立から各集合の範囲を絞って確定セルを導く。矛盾なら false。
  function pairRule(c1, c2) {
    const con1 = constraints[c1], con2 = constraints[c2];
    let f1 = 0, u1n = 0;
    const cells1 = con1.cells;
    for (let k = 0; k < cells1.length; k++) {
      const g = grid[cells1[k]];
      if (g === FILLED) f1++; else if (g === UNKNOWN) u1[u1n++] = cells1[k];
    }
    if (u1n === 0) return true;
    let f2 = 0, u2n = 0;
    const cells2 = con2.cells;
    for (let k = 0; k < cells2.length; k++) {
      const g = grid[cells2[k]];
      if (g === FILLED) f2++; else if (g === UNKNOWN) u2[u2n++] = cells2[k];
    }
    if (u2n === 0) return true;

    const r1 = con1.value - f1;
    const r2 = con2.value - f2;

    stampId++;
    for (let k = 0; k < u1n; k++) stamp[u1[k]] = stampId;
    let bN = 0, cN = 0;
    for (let k = 0; k < u2n; k++) {
      if (stamp[u2[k]] === stampId) B[bN++] = u2[k]; else C[cN++] = u2[k];
    }
    if (bN === 0) return true; // 未確定セルの重なりなし
    stampId++;
    for (let k = 0; k < u2n; k++) stamp[u2[k]] = stampId;
    let aN = 0;
    for (let k = 0; k < u1n; k++) if (stamp[u1[k]] !== stampId) A[aN++] = u1[k];

    const fBlo = Math.max(0, r1 - aN, r2 - cN);
    const fBhi = Math.min(bN, r1, r2);
    if (fBlo > fBhi) { contradiction = true; return false; }
    if (fBlo === bN) { for (let k = 0; k < bN; k++) if (setCell(B[k], FILLED) < 0) return false; }
    else if (fBhi === 0) { for (let k = 0; k < bN; k++) if (setCell(B[k], EMPTY) < 0) return false; }

    const fClo = Math.max(0, r2 - fBhi);
    const fChi = Math.min(cN, r2 - fBlo);
    if (fClo > fChi) { contradiction = true; return false; }
    if (fClo === cN) { for (let k = 0; k < cN; k++) if (setCell(C[k], FILLED) < 0) return false; }
    else if (fChi === 0) { for (let k = 0; k < cN; k++) if (setCell(C[k], EMPTY) < 0) return false; }

    const fAlo = Math.max(0, r1 - fBhi);
    const fAhi = Math.min(aN, r1 - fBlo);
    if (fAlo > fAhi) { contradiction = true; return false; }
    if (fAlo === aN) { for (let k = 0; k < aN; k++) if (setCell(A[k], FILLED) < 0) return false; }
    else if (fAhi === 0) { for (let k = 0; k < aN; k++) if (setCell(A[k], EMPTY) < 0) return false; }
    return true;
  }

  // ワークリスト: 取り出した制約に対し基本ルールと(tier2なら)重なり推論を適用。
  // セルが変化すると、そのセルを含む制約が再キューされる。
  const pair = maxTier >= 2;
  while (qlen && !contradiction) {
    const c = queue[--qlen];
    dirty[c] = 0;
    if (!basicRule(c)) break;
    if (pair) {
      const ps = partners[c];
      for (let j = 0; j < ps.length; j++) {
        const p = ps[j];
        if (active && !active[p]) continue;
        if (!pairRule(c, p)) break;
      }
    }
  }

  prep._stampId = stampId;

  if (contradiction) {
    // 中断で残った dirty を掃除して次回呼び出しに備える
    for (let k = 0; k < qlen; k++) dirty[queue[k]] = 0;
    return 'contradiction';
  }
  // 正常終了時は queue が空 = dirty は全0
  for (let i = 0; i < N; i++) if (mask[i] && grid[i] === UNKNOWN) return 'partial';
  return 'solved';
}

function freshGrid(prep) {
  const grid = new Int8Array(prep.N);
  for (let i = 0; i < prep.N; i++) grid[i] = prep.mask[i] ? UNKNOWN : EMPTY;
  return grid;
}

// 表示ヒントだけで論理的に解けるか判定。 戻り値: { status, grid }
export function solveLogical(width, height, mask, clues, maxTier = 2, initialGrid = null) {
  const prep = prepare(width, height, mask, clues);
  const grid = freshGrid(prep);
  if (initialGrid) {
    for (let i = 0; i < prep.N; i++) {
      if (mask[i] && initialGrid[i] !== UNKNOWN) grid[i] = initialGrid[i];
    }
  }
  const status = propagate(prep, grid, maxTier);
  return { status, grid };
}

// 準備済み prep + active マスクで論理的に解く(生成の最小化で使用)。
export function solveActive(prep, maxTier, active) {
  const grid = freshGrid(prep);
  const status = propagate(prep, grid, maxTier, active);
  return { status, grid };
}

// バックトラッキングで解の個数を数える(最大 limit まで)。唯一解検証用。
export function countSolutions(width, height, mask, clues, limit = 2, maxTier = 2) {
  const prep = prepare(width, height, mask, clues);
  let count = 0;
  function rec(g) {
    if (count >= limit) return;
    const res = propagate(prep, g, maxTier);
    if (res === 'contradiction') return;
    if (res === 'solved') { count++; return; }
    let idx = -1;
    for (let i = 0; i < prep.N; i++) if (mask[i] && g[i] === UNKNOWN) { idx = i; break; }
    if (idx < 0) { count++; return; }
    const g1 = g.slice(); g1[idx] = FILLED; rec(g1);
    if (count >= limit) return;
    const g2 = g.slice(); g2[idx] = EMPTY; rec(g2);
  }
  rec(freshGrid(prep));
  return count;
}
