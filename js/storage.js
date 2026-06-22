// storage.js — localStorage への保存(設定・統計・現在の進捗・中断ゲーム一覧)
const K_SETTINGS = 'mm.settings';
const K_STATS = 'mm.stats';
const K_SAVE = 'mm.save';
const K_SUSPENDED = 'mm.suspended';

export const DEFAULT_SETTINGS = { difficulty: 'oni', tool: 'fill' };
export const DEFAULT_STATS = { playSec: 0, played: 0, cleared: 0, hints: 0 };

function getJSON(key, def) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return { ...def };
    return { ...def, ...JSON.parse(s) };
  } catch (_) { return { ...def }; }
}
function setJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* 容量超過等は無視 */ }
}

export function loadSettings() { return getJSON(K_SETTINGS, DEFAULT_SETTINGS); }
export function saveSettings(s) { setJSON(K_SETTINGS, s); }

export function loadStats() { return getJSON(K_STATS, DEFAULT_STATS); }
export function saveStats(s) { setJSON(K_STATS, s); }

// 一意なゲームID
export function genId() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

// --- 型付き配列 <-> base64 ---
function bytesToB64(u8) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(bin);
}
function b64ToBytes(str) {
  const bin = atob(str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function u8(arr) { return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); }

// ゲーム状態 <-> 保存オブジェクト
// state = { id, puzzle, marks, elapsedMs, savedAt, progress }
export function encodeGame(state) {
  const p = state.puzzle;
  return {
    id: state.id,
    w: p.width, h: p.height, difficulty: p.difficulty, seed: p.seed, shownCount: p.shownCount,
    elapsedMs: state.elapsedMs | 0,
    savedAt: state.savedAt || 0,
    progress: state.progress || 0,
    mask: bytesToB64(u8(p.mask)),
    clues: bytesToB64(u8(p.clues)),
    solution: bytesToB64(u8(p.solution)),
    marks: bytesToB64(u8(state.marks)),
  };
}
export function decodeGame(d) {
  const N = d.w * d.h;
  const maskB = b64ToBytes(d.mask);
  const cluesB = b64ToBytes(d.clues);
  const solB = b64ToBytes(d.solution);
  const marksB = b64ToBytes(d.marks);
  return {
    id: d.id,
    puzzle: {
      width: d.w, height: d.h, difficulty: d.difficulty, seed: d.seed, shownCount: d.shownCount,
      mask: new Uint8Array(maskB.buffer, 0, N),
      clues: new Int8Array(cluesB.buffer, 0, N),
      solution: new Uint8Array(solB.buffer, 0, N),
    },
    marks: new Int8Array(marksB.buffer, 0, N),
    elapsedMs: d.elapsedMs | 0,
    savedAt: d.savedAt || 0,
    progress: d.progress || 0,
  };
}

// 現在の進捗(1件・自動セーブ)
export function saveGame(state) { setJSON(K_SAVE, encodeGame(state)); }
export function loadGame() {
  let d;
  try { const s = localStorage.getItem(K_SAVE); if (!s) return null; d = JSON.parse(s); } catch (_) { return null; }
  try { return decodeGame(d); } catch (_) { return null; }
}
export function clearGame() { try { localStorage.removeItem(K_SAVE); } catch (_) {} }

// 中断ゲーム一覧(複数件)
export function loadSuspended() {
  try { const s = localStorage.getItem(K_SUSPENDED); return s ? JSON.parse(s) : []; } catch (_) { return []; }
}
export function saveSuspended(arr) { setJSON(K_SUSPENDED, arr); }
// state を一覧に追加(同一idは置き換え)。新しいものが先頭。
export function suspendGame(state, cap = 40) {
  const entry = encodeGame(state);
  const arr = loadSuspended().filter((e) => e.id !== entry.id);
  arr.unshift(entry);
  if (arr.length > cap) arr.length = cap;
  saveSuspended(arr);
  return entry;
}
export function getSuspended(id) { return loadSuspended().find((e) => e.id === id) || null; }
export function removeSuspended(id) { saveSuspended(loadSuspended().filter((e) => e.id !== id)); }
