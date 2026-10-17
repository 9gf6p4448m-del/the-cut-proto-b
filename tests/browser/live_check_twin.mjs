// 一刀雙獸部署檢查（作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」字樣、自己的 service worker（scope＝twin-slash/）、
// 三個盤面都能進入、A1 與 B2 各用真實拖曳完成一刀（預覽＝結果）、無錯誤與 4xx/5xx。用法：node tests/browser/live_check_twin.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
import { candidateCuts } from '../../src/twinslash/rules.ts';
const URL = process.argv[2], SHA = process.argv[3];
const settle = (page) => page.waitForFunction(() => ['player', 'end'].includes(window.__twin.phase) && !window.__twin.animActive, null, { timeout: 30000 });
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__twin);
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  await page.evaluate(() => window.__twin.setAiDelay(20));
  const res = [];
  for (const [btn, bd, md] of [['#bd1', 'b1', 'A1'], ['#bd2', 'b2', 'B2'], ['#bd3', 'b3', 'B2']]) {
    await page.click(md === 'A1' ? '#mA1' : '#mB2'); await page.click(btn); await settle(page);
    const st = await page.evaluate(() => window.__twin.st);
    if (st.turn !== 'blue') { res.push(`${bd}:not-blue`); continue; }
    const l = candidateCuts(st, 'blue').find((r) => r.fired.length >= 1 && (md === 'A1' ? r.severed : r.passed.length)) ?? candidateCuts(st, 'blue').find((r) => r.fired.length);
    const A = await page.evaluate(([x, y]) => window.__twin.toScreen(x, y), l.a), B = await page.evaluate(([x, y]) => window.__twin.toScreen(x, y), l.b);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 6 });
    const prev = await page.evaluate(() => JSON.stringify([window.__twin.preview.fired, window.__twin.preview.severed, window.__twin.preview.passed, window.__twin.preview.dmg]));
    await page.mouse.up();
    const last = await page.evaluate(() => JSON.stringify([window.__twin.last.fired, window.__twin.last.severed, window.__twin.last.passed, window.__twin.last.dmg]));
    await settle(page);
    const s = await page.evaluate(() => ({ b: window.__twin.st.board.id, m: window.__twin.st.mode, c: window.__twin.st.cuts }));
    res.push(`${s.b}/${s.m}:${prev === last && s.b === bd && s.m === md && s.c >= 2 ? 'ok' : 'bad'}`);
  }
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && typeof sw === 'string' && sw.endsWith('/twin-slash/')
    && res.length === 3 && res.every((r) => r.endsWith(':ok')) && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${sha} swScope=${sw} boards=${res.join(',')} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
