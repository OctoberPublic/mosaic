// 依存なしで PWA 用アイコン PNG を生成する。実行: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// --- CRC32 / PNG エンコード ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 各行先頭にフィルタ種別(0)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- 図柄 ---
const BG = [15, 17, 23, 255];
const ACCENT = [79, 140, 255, 255];
const WHITE = [233, 237, 243, 255];
const PANEL = [31, 36, 48, 255];
// 5x5 のモザイク模様 (0=パネル,1=アクセント,2=白)
const PAT = [
  0, 1, 1, 1, 0,
  1, 1, 2, 1, 1,
  1, 2, 2, 2, 1,
  1, 1, 2, 1, 1,
  0, 1, 1, 1, 0,
];

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // 背景
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = BG[0]; rgba[i * 4 + 1] = BG[1]; rgba[i * 4 + 2] = BG[2]; rgba[i * 4 + 3] = 255;
  }
  const pad = Math.round(size * 0.14);
  const area = size - pad * 2;
  const cell = area / 5;
  const gap = Math.max(1, Math.round(cell * 0.12));
  const put = (x, y, col) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
  };
  for (let gy = 0; gy < 5; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      const v = PAT[gy * 5 + gx];
      const col = v === 1 ? ACCENT : v === 2 ? WHITE : PANEL;
      const x0 = Math.round(pad + gx * cell + gap);
      const y0 = Math.round(pad + gy * cell + gap);
      const x1 = Math.round(pad + (gx + 1) * cell - gap);
      const y1 = Math.round(pad + (gy + 1) * cell - gap);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, col);
    }
  }
  return rgba;
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = encodePNG(size, size, drawIcon(size));
  writeFileSync(new URL('../icons/' + name, import.meta.url), png);
  console.log('wrote icons/' + name, size + 'x' + size, png.length + ' bytes');
}
