// main.js — アプリのエントリ。UI配線・画面遷移・タイマー・統計。
import { Game } from './game.js';
import { Renderer } from './render.js';
import { PuzzleSource } from './puzzleSource.js';
import { DIFFICULTY } from './generator.js';
import * as store from './storage.js';

// アプリのバージョン(sw.js の CACHE と揃える。デプロイのたびに更新)
const APP_VERSION = 'v14';

const $ = (id) => document.getElementById(id);

const el = {
  diffLabel: $('diffLabel'), timer: $('timer'),
  menuBtn: $('menuBtn'), statsBtn: $('statsBtn'),
  board: $('board'),
  loading: $('loading'), loadingText: $('loadingText'),
  clear: $('clear'), clearInfo: $('clearInfo'), nextBtn: $('nextBtn'),
  toolFill: $('toolFill'), toolCross: $('toolCross'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), hintBtn: $('hintBtn'),
  fixBtn: $('fixBtn'), fitBtn: $('fitBtn'),
  menu: $('menu'), diffOptions: $('diffOptions'),
  newBtn: $('newBtn'), suspendBtn: $('suspendBtn'), resetBtn: $('resetBtn'), closeMenuBtn: $('closeMenuBtn'),
  suspendedList: $('suspendedList'),
  statsModal: $('statsModal'),
  stPlay: $('stPlay'), stPlayed: $('stPlayed'), stCleared: $('stCleared'), stHints: $('stHints'),
  closeStatsBtn: $('closeStatsBtn'),
  appVersion: $('appVersion'),
};

if (el.appVersion) el.appVersion.textContent = APP_VERSION;

let settings = store.loadSettings();
let stats = store.loadStats();
let selectedDiff = settings.difficulty;

const source = new PuzzleSource();

const game = new Game({
  onChange: () => { renderer.requestDraw(); updateUndoRedo(); updateFixButton(); scheduleSave(); },
  onClear: () => onClear(),
});

const renderer = new Renderer(el.board, {
  onPaintStart: (cell, useCross) => game.startPaint(cell, useCross),
  onPaintMove: (cell) => game.paintMove(cell),
  onPaintEnd: () => { game.endPaint(); },
});

let elapsedMs = 0;
let loading = false;
let currentId = null;

// ---- 表示ユーティリティ ----
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function fmtDuration(totalSec) {
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  if (h > 0) return `${h}時間 ${m}分 ${s}秒`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function gameProgress() {
  return game.solutionFills ? Math.round((100 * game.correctFills) / game.solutionFills) : 0;
}
function gameHasMarks() {
  if (!game.marks) return false;
  for (let i = 0; i < game.marks.length; i++) if (game.marks[i] !== 0) return true;
  return false;
}
function updateTimer() { el.timer.textContent = fmtClock(elapsedMs); }
function updateUndoRedo() {
  el.undoBtn.disabled = !game.canUndo();
  el.redoBtn.disabled = !game.canRedo();
}
// 間違いがあるときだけ「直す」(周辺5x5リセット)ボタンを表示
function updateFixButton() {
  el.fixBtn.classList.toggle('invisible', !game.hasErrors());
}

function applyPuzzleToView(puzzle, marks) {
  game.setPuzzle(puzzle, marks);
  renderer.setPuzzle(puzzle);
  renderer.setMarks(game.marks);
  renderer.setErrors(game.errors);
  renderer.setDone(game.done);
  renderer.setRevealClear(false);
  el.diffLabel.textContent = (DIFFICULTY[puzzle.difficulty] || {}).label || puzzle.difficulty;
  updateUndoRedo();
  updateFixButton();
  renderer.requestDraw();
}

// ---- 保存(スロットル) ----
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 1500);
}
function saveNow() {
  if (!game.puzzle) return;
  store.saveGame({ id: currentId, puzzle: game.puzzle, marks: game.marks, elapsedMs, savedAt: Date.now(), progress: gameProgress() });
  store.saveStats(stats);
}

// ---- 生成 ----
async function startNewPuzzle(difficulty) {
  showLoading(true);
  try {
    const puzzle = await source.next(difficulty);
    elapsedMs = 0;
    currentId = store.genId();
    applyPuzzleToView(puzzle, null);
    stats.played++;
    store.saveStats(stats);
    saveNow();
  } catch (err) {
    el.loadingText.textContent = '生成に失敗しました。もう一度お試しください。';
    console.error(err);
    return;
  }
  showLoading(false);
}

function showLoading(on) {
  loading = on;
  el.loading.classList.toggle('hidden', !on);
  if (on) el.loadingText.textContent = 'パズルを生成中…';
}

// ---- クリア ----
function onClear() {
  stats.cleared++;
  store.saveStats(stats);
  store.clearGame();
  renderer.setRevealClear(true);
  el.clearInfo.textContent =
    `難易度: ${(DIFFICULTY[game.puzzle.difficulty] || {}).label || ''} ／ タイム: ${fmtClock(elapsedMs)}`;
  el.clear.classList.remove('hidden');
}

// ---- タイマー ----
setInterval(() => {
  if (loading || game.cleared || !game.puzzle) return;
  if (document.visibilityState !== 'visible') return;
  elapsedMs += 1000;
  stats.playSec += 1;
  updateTimer();
}, 1000);

// ---- ツール(押している間だけ塗る/印。離すと盤面移動) ----
const held = new Set();
function refreshToolButtons() {
  el.toolFill.classList.toggle('active', held.has('fill'));
  el.toolCross.classList.toggle('active', held.has('cross'));
}
function pressTool(tool, e, btn) {
  e.preventDefault();
  held.add(tool);
  renderer.setActiveTool(tool);
  refreshToolButtons();
  try { btn.setPointerCapture(e.pointerId); } catch (_) {}
}
function releaseTool(tool) {
  if (!held.has(tool)) return;
  held.delete(tool);
  renderer.setActiveTool(held.size ? [...held][held.size - 1] : null);
  refreshToolButtons();
}
function bindHold(btn, tool) {
  btn.addEventListener('pointerdown', (e) => pressTool(tool, e, btn));
  btn.addEventListener('pointerup', () => releaseTool(tool));
  btn.addEventListener('pointercancel', () => releaseTool(tool));
  btn.addEventListener('lostpointercapture', () => releaseTool(tool));
}

// ---- モーダル ----
function openMenu() {
  selectedDiff = game.puzzle ? game.puzzle.difficulty : settings.difficulty;
  buildDiffOptions();
  renderSuspendedList();
  el.menu.classList.remove('hidden');
}
function closeMenu() { el.menu.classList.add('hidden'); }

// --- 中断ゲーム ---
// 今のゲームを一覧へ退避する(進行中で未クリアのときのみ)
function stashCurrent() {
  if (!game.puzzle || game.cleared || !gameHasMarks()) return;
  store.suspendGame({ id: currentId || store.genId(), puzzle: game.puzzle, marks: game.marks, elapsedMs, savedAt: Date.now(), progress: gameProgress() });
}
// 中断して保存 → 新しい問題を開始
function suspendCurrent() {
  if (!game.puzzle) return;
  store.suspendGame({ id: currentId || store.genId(), puzzle: game.puzzle, marks: game.marks, elapsedMs, savedAt: Date.now(), progress: gameProgress() });
  closeMenu();
  startNewPuzzle(settings.difficulty);
}
function resumeSuspended(id) {
  const entry = store.getSuspended(id);
  if (!entry) return;
  stashCurrent();          // 今のゲームを失わないよう退避
  const decoded = store.decodeGame(entry);
  store.removeSuspended(id);
  currentId = decoded.id || store.genId();
  elapsedMs = decoded.elapsedMs || 0;
  applyPuzzleToView(decoded.puzzle, decoded.marks);
  updateTimer();
  showLoading(false);
  saveNow();
  closeMenu();
}
function deleteSuspended(id) {
  store.removeSuspended(id);
  renderSuspendedList();
}
function renderSuspendedList() {
  const arr = store.loadSuspended();
  el.suspendedList.innerHTML = '';
  if (!arr.length) {
    el.suspendedList.innerHTML = '<p class="empty">中断中のゲームはありません</p>';
    return;
  }
  for (const e of arr) {
    const label = (DIFFICULTY[e.difficulty] || {}).label || e.difficulty;
    const item = document.createElement('div');
    item.className = 'susp-item';
    const info = document.createElement('div');
    info.className = 'susp-info';
    info.innerHTML = `<div class="susp-title">${label} ${e.w}×${e.h}・${e.progress || 0}%</div>` +
      `<div class="susp-sub">${fmtClock(e.elapsedMs)} ・ ${fmtDate(e.savedAt)}</div>`;
    const actions = document.createElement('div');
    actions.className = 'susp-actions';
    const resume = document.createElement('button');
    resume.className = 'btn small primary';
    resume.textContent = '再開';
    resume.addEventListener('click', () => resumeSuspended(e.id));
    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = '削除';
    del.addEventListener('click', () => deleteSuspended(e.id));
    actions.append(resume, del);
    item.append(info, actions);
    el.suspendedList.appendChild(item);
  }
}
function buildDiffOptions() {
  el.diffOptions.innerHTML = '';
  const descs = {
    normal: '20〜30 長方形 / ヒント多め',
    hard: '20〜35 長方形 / ヒント少なめ',
    oni: '20〜40 いびつな形 / 最小ヒント',
  };
  for (const key of Object.keys(DIFFICULTY)) {
    const d = document.createElement('div');
    d.className = 'diff-opt' + (key === selectedDiff ? ' active' : '');
    d.innerHTML = `<div><div class="d-name">${DIFFICULTY[key].label}</div>` +
      `<div class="d-desc">${descs[key] || ''}</div></div>`;
    d.addEventListener('click', () => {
      selectedDiff = key;
      buildDiffOptions();
    });
    el.diffOptions.appendChild(d);
  }
}
function openStats() {
  el.stPlay.textContent = fmtDuration(stats.playSec);
  el.stPlayed.textContent = `${stats.played} 問`;
  el.stCleared.textContent = `${stats.cleared} 問`;
  el.stHints.textContent = `${stats.hints} 回`;
  el.statsModal.classList.remove('hidden');
}

// ---- イベント配線 ----
bindHold(el.toolFill, 'fill');
bindHold(el.toolCross, 'cross');
el.undoBtn.addEventListener('click', () => game.undo());
el.redoBtn.addEventListener('click', () => game.redo());
el.hintBtn.addEventListener('click', () => {
  const cell = game.hint();
  if (cell >= 0) { stats.hints++; store.saveStats(stats); }
});
el.fixBtn.addEventListener('click', () => { game.resetAroundErrors(); });
el.fitBtn.addEventListener('click', () => renderer.fit());

el.menuBtn.addEventListener('click', openMenu);
el.closeMenuBtn.addEventListener('click', closeMenu);
el.suspendBtn.addEventListener('click', suspendCurrent);
el.newBtn.addEventListener('click', () => {
  settings.difficulty = selectedDiff; store.saveSettings(settings);
  closeMenu();
  startNewPuzzle(selectedDiff);
});
el.resetBtn.addEventListener('click', () => {
  if (!game.puzzle) return;
  applyPuzzleToView(game.puzzle, null);
  saveNow();
  closeMenu();
});

el.statsBtn.addEventListener('click', openStats);
el.closeStatsBtn.addEventListener('click', () => el.statsModal.classList.add('hidden'));
el.nextBtn.addEventListener('click', () => {
  el.clear.classList.add('hidden');
  renderer.setRevealClear(false);
  startNewPuzzle(settings.difficulty);
});

// モーダル背景クリックで閉じる
for (const m of [el.menu, el.statsModal]) {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
window.addEventListener('pagehide', saveNow);

// ---- 初期化 ----
function init() {
  game.setTool('fill'); // 塗りは fill 固定。×印は長押し時に useCross で指定。
  refreshToolButtons();
  const saved = store.loadGame();
  if (saved && saved.puzzle) {
    elapsedMs = saved.elapsedMs || 0;
    currentId = saved.id || store.genId();
    applyPuzzleToView(saved.puzzle, saved.marks);
    updateTimer();
    showLoading(false);
    source.prefetch(settings.difficulty);
  } else {
    startNewPuzzle(settings.difficulty);
  }

  // Service Worker 登録(オフライン対応)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
    });
  }
}
init();
