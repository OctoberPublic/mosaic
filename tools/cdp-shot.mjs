// 最小 CDP ドライバ: about:blank で開いてエラー監視を注入→遷移→実時間待機→probe取得→スクショ。
// 実行: node tools/cdp-shot.mjs <url> <outPng> <waitMs>
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'shot.png';
const waitMs = Number(process.argv[4] || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); });
}
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.__errors=[];addEventListener("error",e=>window.__errors.push(String((e.error&&e.error.stack)||e.message)));addEventListener("unhandledrejection",e=>window.__errors.push("reject:"+String(e.reason&&e.reason.stack||e.reason)));',
});
await send('Page.navigate', { url });
await sleep(waitMs);

const pre = process.argv[5];
if (pre) { await send('Runtime.evaluate', { expression: pre }); await sleep(300); }

const probe = `JSON.stringify({
  title: document.title,
  loadingHidden: (document.getElementById('loading')||{}).classList ? document.getElementById('loading').classList.contains('hidden') : null,
  diff: (document.getElementById('diffLabel')||{}).textContent || null,
  timer: (document.getElementById('timer')||{}).textContent || null,
  appVersion: (document.getElementById('appVersion')||{}).textContent || null,
  errors: window.__errors || []
})`;
const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
console.log('PROBE:', r.result && r.result.result && r.result.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result && shot.result.data) { writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('wrote', out); }
else console.log('screenshot failed', JSON.stringify(shot).slice(0, 300));
ws.close();
process.exit(0);
