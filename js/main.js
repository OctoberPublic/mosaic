// main.js — アプリのエントリ。UI配線・画面遷移・タイマー・統計。
import { Game } from './game.js';
import { Renderer } from './render.js';
import { PuzzleSource } from './puzzleSource.js';
import { DIFFICULTY } from './generator.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  diffLabel: $('diffLabel'), timer: $('timer'),
  menuBtn: $('menuBtn'), statsBtn: $('statsBtn'),
  board: $('board'),
  loading: $('loading'), loadingText: $('loadingText'),
  clear: $('clear'), clearInfo: $('clearInfo'), nextBtn: $('nextBtn'),
  toolFill: $('toolFill'), toolCross: $('toolCross'), panBtn: $('panBtn'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), hintBtn: $('hintBtn'),
  zoomOutBtn: $('zoomOutBtn'), zoomInBtn: $('zoomInBtn'), fitBtn: $('fitBtn'),
  menu: $('menu'), diffOptions: $('diffOptions'),
  newBtn: $('newBtn'), resetBtn: $('resetBtn'), closeMenuBtn: $('closeMenuBtn'),
  statsModal: $('statsModal'),
  stPlay: $('stPlay'), stPlayed: $('stPlayed'), stCleared: $('stCleared'), stHints: $('stHints'),
  closeStatsBtn: $('closeStatsBtn'),
};

let settings = store.loadSettings();
let stats = store.loadStats();
let selectedDiff = settings.difficulty;

const source = new PuzzleSource();

const game = new Game({
  onChange: () => { renderer.requestDraw(); updateUndoRedo(); scheduleSave(); },
  onClear: () => onClear(),
});

const renderer = new Renderer(el.board, {
  onPaintStart: (cell, useCross) => game.startPaint(cell, useCross),
  onPaintMove: (cell) => game.paintMove(cell),
  onPaintEnd: () => { game.endPaint(); },
});

let elapsedMs = 0;
let loading = false;

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
function updateTimer() { el.timer.textContent = fmtClock(elapsedMs); }
function updateUndoRedo() {
  el.undoBtn.disabled = !game.canUndo();
  el.redoBtn.disabled = !game.canRedo();
}

function applyPuzzleToView(puzzle, marks) {
  game.setPuzzle(puzzle, marks);
  renderer.setPuzzle(puzzle);
  renderer.setMarks(game.marks);
  renderer.setErrors(game.errors);
  renderer.setRevealClear(false);
  el.diffLabel.textContent = (DIFFICULTY[puzzle.difficulty] || {}).label || puzzle.difficulty;
  updateUndoRedo();
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
  store.saveGame({ puzzle: game.puzzle, marks: game.marks, elapsedMs });
  store.saveStats(stats);
}

// ---- 生成 ----
async function startNewPuzzle(difficulty) {
  showLoading(true);
  try {
    const puzzle = await source.next(difficulty);
    elapsedMs = 0;
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

// ---- ツール ----
function setTool(t) {
  game.setTool(t);
  el.toolFill.classList.toggle('active', t === 'fill');
  el.toolCross.classList.toggle('active', t === 'cross');
  settings.tool = t; store.saveSettings(settings);
  if (renderer.panMode) setPan(false);
}
function setPan(on) {
  renderer.setPanMode(on);
  el.panBtn.classList.toggle('active', on);
}

// ---- モーダル ----
function openMenu() {
  selectedDiff = game.puzzle ? game.puzzle.difficulty : settings.difficulty;
  buildDiffOptions();
  el.menu.classList.remove('hidden');
}
function closeMenu() { el.menu.classList.add('hidden'); }
function buildDiffOptions() {
  el.diffOptions.innerHTML = '';
  const descs = {
    normal: '30×30 長方形 / ヒント多め',
    hard: '35×35 長方形 / ヒント少なめ',
    oni: '40×40 いびつな形 / 最小ヒント',
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
el.toolFill.addEventListener('click', () => setTool('fill'));
el.toolCross.addEventListener('click', () => setTool('cross'));
el.panBtn.addEventListener('click', () => setPan(!renderer.panMode));
el.undoBtn.addEventListener('click', () => game.undo());
el.redoBtn.addEventListener('click', () => game.redo());
el.hintBtn.addEventListener('click', () => {
  const cell = game.hint();
  if (cell >= 0) { stats.hints++; store.saveStats(stats); }
});
el.zoomInBtn.addEventListener('click', () => renderer.zoomBy(1.25));
el.zoomOutBtn.addEventListener('click', () => renderer.zoomBy(1 / 1.25));
el.fitBtn.addEventListener('click', () => renderer.fit());

el.menuBtn.addEventListener('click', openMenu);
el.closeMenuBtn.addEventListener('click', closeMenu);
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
  setTool(settings.tool || 'fill');
  const saved = store.loadGame();
  if (saved && saved.puzzle) {
    elapsedMs = saved.elapsedMs || 0;
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
