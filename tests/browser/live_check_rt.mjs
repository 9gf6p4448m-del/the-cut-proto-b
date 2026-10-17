// 即時亂切部署檢查（RT-09 上線部分；作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」字樣、自己的 service worker（scope＝rt-cut/）、
// 真實拖曳出一刀（藍橫刀 y=500：鎖藍爪1、切紅爪3）、無錯誤與 4xx/5xx。用法：node tests/browser/live_check_rt.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
const URL = process.argv[2], SHA = process.argv[3];
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__rt);
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  await page.evaluate(() => window.__rt.restart());
  await page.waitForTimeout(150);
  const A = await page.evaluate(() => window.__rt.toScreen(60, 500)), B = await page.evaluate(() => window.__rt.toScreen(400, 500));
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => window.__rt.events.some((e) => e.e.t === 'strike' && e.e.r.side === 'blue'), null, { timeout: 10000 });
  const r = await page.evaluate(() => window.__rt.events.find((e) => e.e.t === 'strike' && e.e.r.side === 'blue').e.r);
  const cut = r.locks.includes(0) && (r.severed === 10 || r.blocked === 10);
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && typeof sw === 'string' && sw.endsWith('/rt-cut/')
    && cut && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${sha} swScope=${sw} strike=locks${JSON.stringify(r.locks)}/severed=${r.severed}/blocked=${r.blocked} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
