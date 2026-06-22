// puzzleSource.js — パズル生成の供給源。Web Worker で生成し、次の問題を先読みする。
// Worker が使えない環境ではメインスレッドで同期生成にフォールバックする。

export class PuzzleSource {
  constructor() {
    this.worker = null;
    this.reqId = 0;
    this.pending = new Map();      // id -> {resolve, reject}
    this.prefetched = new Map();   // difficulty -> Promise<puzzle>
    this._fallbackGen = null;      // 動的 import した generatePuzzle
    this._initWorker();
  }

  _initWorker() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { id, ok, puzzle, error } = e.data || {};
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (ok) p.resolve(puzzle); else p.reject(new Error(error || 'generation failed'));
      };
      this.worker.onerror = () => { /* 個別 reject はタイムアウトに任せ、以降はフォールバック */ this.worker = null; };
    } catch (_) {
      this.worker = null;
    }
  }

  _generateViaWorker(difficulty, seed) {
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ cmd: 'generate', id, difficulty, seed });
    });
  }

  async _generateFallback(difficulty, seed) {
    if (!this._fallbackGen) {
      const mod = await import('./generator.js');
      this._fallbackGen = mod.generatePuzzle;
    }
    // メインスレッドを完全には固めないように次フレームへ
    await new Promise((r) => setTimeout(r, 0));
    return this._fallbackGen({ difficulty, seed });
  }

  _generate(difficulty, seed) {
    if (this.worker) {
      return this._generateViaWorker(difficulty, seed).catch(() => this._generateFallback(difficulty, seed));
    }
    return this._generateFallback(difficulty, seed);
  }

  // 次の問題を取得(先読み済みがあればそれを使い、さらに次を先読み)。
  next(difficulty) {
    let p;
    if (this.prefetched.has(difficulty)) {
      p = this.prefetched.get(difficulty);
      this.prefetched.delete(difficulty);
    } else {
      p = this._generate(difficulty);
    }
    this.prefetch(difficulty);
    return p;
  }

  // 指定難易度の問題を1つだけ裏で先読みしておく。
  prefetch(difficulty) {
    if (this.prefetched.has(difficulty)) return;
    const p = this._generate(difficulty).catch((err) => {
      this.prefetched.delete(difficulty);
      throw err;
    });
    this.prefetched.set(difficulty, p);
  }
}
