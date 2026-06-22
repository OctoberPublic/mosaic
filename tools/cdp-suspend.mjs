// 実アプリで 中断→一覧追加→再開 の通し検証。実行前に Chrome を 9238 で起動しておく。
import { writeFileSync } from 'node:fs';
const url = process.argv[2];
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t = await (await fetch('http://127.0.0.1:9238/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__e=[];addEventListener("error",e=>__e.push(String(e.message)));addEventListener("unhandledrejection",e=>__e.push("rej:"+String(e.reason)));' });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };

await send('Page.navigate', { url });
await sleep(13000);
console.log('1) 初期生成後:', await ev("JSON.stringify({loadingHidden:document.getElementById('loading').classList.contains('hidden'), susp:JSON.parse(localStorage.getItem('mm.suspended')||'[]').length, shown:document.querySelector('canvas')?1:0, err:window.__e})"));

// 中断ボタン(メニュー内)を押す → 一覧へ保存し新しい問題を開始
await ev("document.getElementById('suspendBtn').click()");
await sleep(13000);
console.log('2) 中断+新規生成後:', await ev("JSON.stringify({loadingHidden:document.getElementById('loading').classList.contains('hidden'), susp:JSON.parse(localStorage.getItem('mm.suspended')||'[]').length, err:window.__e})"));

// メニューを開いて一覧描画 → 件数確認
await ev("document.getElementById('menuBtn').click()");
await sleep(400);
console.log('3) メニューの一覧件数:', await ev("document.querySelectorAll('#suspendedList .susp-item').length"));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (out && shot.result && shot.result.data) { writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('   screenshot:', out); }

// 再開ボタンを押す
await ev("document.querySelector('#suspendedList .susp-actions .primary').click()");
await sleep(1500);
console.log('4) 再開後:', await ev("JSON.stringify({loadingHidden:document.getElementById('loading').classList.contains('hidden'), susp:JSON.parse(localStorage.getItem('mm.suspended')||'[]').length, menuHidden:document.getElementById('menu').classList.contains('hidden'), err:window.__e})"));

ws.close();
process.exit(0);
