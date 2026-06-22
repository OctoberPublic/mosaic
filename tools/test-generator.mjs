// 生成エンジンの検証: 各難易度でパズルを生成し
//   (a) 論理ソルバー(tier2)で完全に解け、解が solution と一致するか
//   (b) 解が唯一か (countSolutions == 1)
//   (c) 生成時間とヒント数
// を確認する。  実行: node tools/test-generator.mjs
import { generatePuzzle, DIFFICULTY } from '../js/generator.js';
import { solveLogical, countSolutions, FILLED, EMPTY } from '../js/solver.js';

const COUNT = Number(process.argv[2] || 3);

function gridMatchesSolution(grid, sol, mask) {
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const want = sol[i] ? FILLED : EMPTY;
    if (grid[i] !== want) return false;
  }
  return true;
}

let allOk = true;
for (const diff of Object.keys(DIFFICULTY)) {
  console.log(`\n=== 難易度: ${diff} (${DIFFICULTY[diff].label}) ===`);
  for (let n = 0; n < COUNT; n++) {
    const t0 = performance.now();
    const p = generatePuzzle({ difficulty: diff, seed: 1000 + n });
    const genMs = performance.now() - t0;

    // (a) 論理可解 + 一致
    const res = solveLogical(p.width, p.height, p.mask, p.clues, DIFFICULTY[diff].maxTier);
    const logical = res.status === 'solved' && gridMatchesSolution(res.grid, p.solution, p.mask);

    // (b) 唯一解 (バックトラッキング, tier2 propagation併用)
    const tc0 = performance.now();
    const sols = countSolutions(p.width, p.height, p.mask, p.clues, 2, DIFFICULTY[diff].maxTier);
    const checkMs = performance.now() - tc0;

    const inRegion = p.mask.reduce((a, b) => a + b, 0);
    const ok = logical && sols === 1;
    if (!ok) allOk = false;
    console.log(
      `  #${n} ${p.width}x${p.height} 領域${inRegion} ヒント${p.shownCount}(${(p.shownCount / inRegion * 100).toFixed(0)}%) ` +
      `生成${genMs.toFixed(0)}ms 検証${checkMs.toFixed(0)}ms ` +
      `論理可解:${logical ? 'OK' : 'NG'} 解の数:${sols} => ${ok ? 'PASS' : 'FAIL'}`
    );
  }
}

// 最低サイズ 20x20 の生成確認(全難易度)
console.log('\n=== 最低サイズ 20x20 ===');
for (const diff of Object.keys(DIFFICULTY)) {
  for (let n = 0; n < 2; n++) {
    const p = generatePuzzle({ difficulty: diff, seed: 5000 + n, size: 20 });
    const res = solveLogical(p.width, p.height, p.mask, p.clues, DIFFICULTY[diff].maxTier);
    const logical = res.status === 'solved' && gridMatchesSolution(res.grid, p.solution, p.mask);
    const sols = countSolutions(p.width, p.height, p.mask, p.clues, 2, DIFFICULTY[diff].maxTier);
    const ok = p.width === 20 && p.height === 20 && logical && sols === 1;
    if (!ok) allOk = false;
    console.log(`  ${diff} ${p.width}x${p.height} ヒント${p.shownCount} 論理:${logical ? 'OK' : 'NG'} 解:${sols} => ${ok ? 'PASS' : 'FAIL'}`);
  }
}

console.log(`\n総合: ${allOk ? 'ALL PASS' : 'FAIL あり'}`);
process.exit(allOk ? 0 : 1);
