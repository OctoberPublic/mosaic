// game.js のロジック検証(塗り/エラー/アンドゥ・リドゥ/ヒント/クリア)。
// 実行: node tools/test-game.mjs
import { Game } from '../js/game.js';
import { UNKNOWN, FILLED, EMPTY } from '../js/solver.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// 小さなテスト用パズルを作る
function makePuzzle(W, H, solArr) {
  const N = W * H;
  const mask = new Uint8Array(N).fill(1);
  const solution = Uint8Array.from(solArr);
  const clues = new Int8Array(N).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (solution[ny * W + nx]) c++;
    }
    clues[y * W + x] = c;
  }
  return { width: W, height: H, mask, clues, solution, difficulty: 'normal' };
}

// 3x3: 中央十字を塗る解
const puzzle = makePuzzle(3, 3, [
  0, 1, 0,
  1, 1, 1,
  0, 1, 0,
]);

let cleared = false;
const game = new Game({ onChange: () => {}, onClear: () => { cleared = true; } });
game.setPuzzle(puzzle);

check('初期 solutionFills=5', game.solutionFills === 5);
check('初期はクリアでない', !game.isClear());
check('初期は完了ヒントなし', !game.done.some((d) => d === 1));

// エラー表示: セル0(角,ヒント値3)の近傍は 0,1,3,4。
// 必要なマスを×で潰して到達不能にすると赤(エラー)になる。
game.setTool('cross');
game.tap(1, false); game.tap(3, false); game.tap(4, false); // ×印を3つ
check('到達不能でエラー表示が出る', game.errors[0] === 1);
game.undo(); game.undo(); game.undo();
check('アンドゥでエラーが解消する', game.errors[0] === 0);

// タップでトグル(塗る→消す)
game.setTool('fill');
game.tap(0, false); // (0,0) は解では空白 → 誤り
check('セル0が塗られた', game.marks[0] === FILLED);
check('誤りで wrongFills=1', game.wrongFills === 1);
game.tap(0, false); // もう一度 → 消える
check('セル0が消えた', game.marks[0] === UNKNOWN);
check('wrongFills=0 に戻る', game.wrongFills === 0);

// アンドゥ/リドゥ
game.tap(1, false); // (1,0) 解で塗り
check('セル1塗り', game.marks[1] === FILLED && game.correctFills === 1);
game.undo();
check('アンドゥでセル1が戻る', game.marks[1] === UNKNOWN && game.correctFills === 0);
game.redo();
check('リドゥでセル1が塗り直し', game.marks[1] === FILLED && game.correctFills === 1);

// ×印ツール
game.tap(0, true); // 空白マークを付ける(解でも空白)
check('×印が付く', game.marks[0] === EMPTY);

// ヒントで残りを埋めてクリアまで
let guard = 0;
while (!game.isClear() && guard++ < 50) game.hint();
check('ヒント連打でクリアできる', game.isClear());
check('onClear が呼ばれた', cleared);
check('correctFills == solutionFills', game.correctFills === game.solutionFills);
check('wrongFills == 0', game.wrongFills === 0);

// 完了(done)状態: 全マスを正しく確定させると全ヒントが完了になる
game.setPuzzle(puzzle);
check('再初期化で完了なし', !game.done.some((d) => d === 1));
game.setTool('fill');
for (let i = 0; i < 9; i++) {
  if (puzzle.solution[i]) game.tap(i, false); // 塗る
  else game.tap(i, true);                     // ×
}
check('完了:中央ヒント(塗りマス)が完了', game.done[4] === 1 && game.marks[4] === FILLED);
check('完了:角ヒント(印マス)が完了', game.done[0] === 1 && game.marks[0] === EMPTY);
check('完了:全ヒントが完了', game.done.every((d, i) => puzzle.clues[i] < 0 || d === 1));
check('完了:エラーなし', !game.errors.some((e) => e === 1));
// 1マス消すと、その周囲のヒントは完了解除
game.tap(4, false); // 中央を消す(FILLED→UNKNOWN)
check('1マス消すと中央ヒントの完了が解除', game.done[4] === 0);

// 間違い周辺リセット(直す)
game.setPuzzle(puzzle);
check('初期は間違いなし', !game.hasErrors());
game.setTool('cross');
game.tap(1, false); game.tap(3, false); game.tap(4, false); // 角ヒント0を到達不能に
check('間違い発生で hasErrors=true', game.hasErrors());
const clearedN = game.resetAroundErrors();
check('リセットでマスが消える', clearedN > 0);
check('リセット後は間違いなし', !game.hasErrors());
check('リセットでマークが未確定化', game.marks[1] === UNKNOWN && game.marks[3] === UNKNOWN && game.marks[4] === UNKNOWN);
check('リセットはアンドゥ可能', game.canUndo());
game.undo();
check('アンドゥでリセット前に戻る', game.marks[1] === EMPTY && game.hasErrors());

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
