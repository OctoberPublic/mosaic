// generator.js — Fill-a-Pix パズルのランダム生成(唯一解保証)
import { prepare, solveActive } from './solver.js';

// 難易度設定
//   size         : 盤面の一辺
//   irregular    : 歪な形にするか
//   density      : 解の塗り密度
//   maxTier      : 最小化に使うソルバーの強さ(1=基本 / 2=重なり推論)
//   keepFraction : 最小化後に戻すヒントの割合(大きいほど簡単)
//   timeBudgetMs : 最小化の時間上限
//   maxAttempts  : 解ける盤面が出るまでの再生成回数上限
// size 固定 / もしくは sizeMin..sizeMax の範囲からランダムに選ぶ。最低は20×20。
export const DIFFICULTY = {
  normal: { label: 'ふつう',     sizeMin: 20, sizeMax: 30, irregular: false, density: 0.50, maxTier: 2, keepFraction: 0.55, timeBudgetMs: 5000, maxAttempts: 12 },
  hard:   { label: 'むずかしい', sizeMin: 20, sizeMax: 35, irregular: false, density: 0.50, maxTier: 2, keepFraction: 0.25, timeBudgetMs: 7000, maxAttempts: 12 },
  oni:    { label: '鬼',         sizeMin: 20, sizeMax: 40, irregular: true,  density: 0.50, maxTier: 2, keepFraction: 0.00, timeBudgetMs: 10000, maxAttempts: 14 },
};

// 再現可能な乱数 (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let s = arr.length - 1; s > 0; s--) {
    const r = (rng() * (s + 1)) | 0;
    const t = arr[s]; arr[s] = arr[r]; arr[r] = t;
  }
  return arr;
}

const nowMs = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

// 領域(マスク)を作る。irregular の場合は連結したいびつな形。
function generateRegion(width, height, rng, irregular) {
  const N = width * height;
  const mask = new Uint8Array(N);
  if (!irregular) { mask.fill(1); return mask; }

  const targetArea = Math.floor(N * (0.70 + rng() * 0.14)); // 70〜84%
  const start = (height >> 1) * width + (width >> 1);
  mask[start] = 1;
  let area = 1;
  const frontier = [start];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (area < targetArea && frontier.length) {
    const fi = (rng() * frontier.length) | 0;
    const cell = frontier[fi];
    const cx = cell % width, cy = (cell / width) | 0;
    shuffle(dirs, rng);
    let added = false;
    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (mask[ni]) continue;
      mask[ni] = 1; area++; frontier.push(ni); added = true; break;
    }
    if (!added) { frontier[fi] = frontier[frontier.length - 1]; frontier.pop(); }
  }
  return mask;
}

function fillSolution(N, mask, rng, density) {
  const sol = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (mask[i] && rng() < density) sol[i] = 1;
  return sol;
}

// 全領域内マスのヒント(3x3内の塗りマス数)を計算
function computeClues(width, height, mask, sol) {
  const N = width * height;
  const clues = new Int8Array(N).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= width) continue;
          const ni = ny * width + nx;
          if (mask[ni] && sol[ni]) c++;
        }
      }
      clues[i] = c;
    }
  }
  return clues;
}

// パズルを生成する。
// opts: { difficulty, seed, onProgress }
// 戻り値: { width, height, mask, clues, solution, difficulty, seed, shownCount }
export function generatePuzzle(opts = {}) {
  const difficulty = opts.difficulty || 'oni';
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.oni;
  let seed = opts.seed;
  if (seed === undefined) seed = (Math.random() * 4294967296) >>> 0;
  const rng = makeRng(seed);
  // opts.size 指定(主にテスト用) / サイズ範囲があれば毎回ランダム(最低20) / 固定size
  const size = opts.size != null
    ? opts.size
    : (cfg.sizeMin != null
      ? cfg.sizeMin + ((rng() * (cfg.sizeMax - cfg.sizeMin + 1)) | 0)
      : cfg.size);
  const width = size, height = size;

  let fallback = null;
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const mask = generateRegion(width, height, rng, cfg.irregular);
    const sol = fillSolution(width * height, mask, rng, cfg.density);
    const fullClues = computeClues(width, height, mask, sol);

    // 全ヒントの制約を一度だけ構築(以降は active を切り替えて再利用)
    const prep = prepare(width, height, mask, fullClues);
    const nc = prep.constraints.length;
    const allActive = new Uint8Array(nc).fill(1);

    // 全ヒントで論理的に解けること = 唯一解の保証。解けなければ作り直す。
    if (solveActive(prep, cfg.maxTier, allActive).status !== 'solved') {
      fallback = { mask, sol, fullClues };
      continue;
    }

    // 最小化: ヒント(制約)を解ける限り無効化していく
    const active = new Uint8Array(nc).fill(1);
    const order = Array.from({ length: nc }, (_, c) => c);
    shuffle(order, rng);
    const removed = [];
    const start = nowMs();
    for (let k = 0; k < order.length; k++) {
      if (cfg.timeBudgetMs && nowMs() - start > cfg.timeBudgetMs) break;
      const c = order[k];
      active[c] = 0;
      if (solveActive(prep, cfg.maxTier, active).status === 'solved') removed.push(c);
      else active[c] = 1;
    }

    // keepFraction 分のヒントを戻して難易度を緩める
    if (cfg.keepFraction > 0 && removed.length) {
      shuffle(removed, rng);
      const addBack = Math.floor(removed.length * cfg.keepFraction);
      for (let k = 0; k < addBack; k++) active[removed[k]] = 1;
    }

    // active な制約のみヒントとして残す
    const clues = new Int8Array(width * height).fill(-1);
    let shownCount = 0;
    for (let c = 0; c < nc; c++) {
      if (active[c]) { clues[prep.centerCell[c]] = prep.constraints[c].value; shownCount++; }
    }
    return { width, height, mask, clues, solution: sol, difficulty, seed, shownCount };
  }

  // フォールバック: 解ける全ヒント盤面が得られなかった場合
  if (fallback) {
    let shownCount = 0;
    for (let i = 0; i < fallback.fullClues.length; i++) if (fallback.fullClues[i] >= 0) shownCount++;
    return { width, height, mask: fallback.mask, clues: fallback.fullClues, solution: fallback.sol, difficulty, seed, shownCount };
  }
  const mask = generateRegion(width, height, rng, false);
  const sol = fillSolution(width * height, mask, rng, cfg.density);
  const fullClues = computeClues(width, height, mask, sol);
  return { width, height, mask, clues: fullClues, solution: sol, difficulty, seed, shownCount: fullClues.length };
}
