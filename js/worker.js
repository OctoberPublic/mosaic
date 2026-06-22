// worker.js — パズル生成をメインスレッドから切り離して実行する Web Worker
import { generatePuzzle } from './generator.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.cmd !== 'generate') return;
  const { id, difficulty, seed } = msg;
  try {
    const p = generatePuzzle({ difficulty, seed });
    // 型付き配列は転送(コピーを避ける)
    self.postMessage(
      {
        id,
        ok: true,
        puzzle: {
          width: p.width,
          height: p.height,
          mask: p.mask,
          clues: p.clues,
          solution: p.solution,
          difficulty: p.difficulty,
          seed: p.seed,
          shownCount: p.shownCount,
        },
      },
      [p.mask.buffer, p.clues.buffer, p.solution.buffer]
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
