// 對決 v0.2 美術合併部署檢查（DA-07 上線部分；作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」字樣、自己的 service worker（scope＝duel2/）、
// 真實拖曳完成 1 刀（有結算紀錄）、無錯誤與 4xx/5xx。用法：node tests/browser/live_check_duel2.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
import { greedyLine } from '../cb_stats.ts';
const URL = process.argv[2], SHA = process.argv[3];
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 40000 });
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  await page.evaluate(() => window.__cb.setManual(true));
  await page.evaluate(() => window.__cb.advance(120));
  const st = await page.evaluate(() => window.__cb.game);
  const l = greedyLine(st);
  const A = await page.evaluate(([x, y]) => window.__cb.toScreen(x, y), l.a), B = await page.evaluate(([x, y]) => window.__cb.toScreen(x, y), l.b);
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 8 }); await page.mouse.up();
  await page.evaluate(() => window.__cb.advance(1));
  const last = await page.evaluate(() => window.__cb.lastStrike);
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && text.includes('v0.2 美術合併') && typeof sw === 'string' && sw.endsWith('/duel2/')
    && last && last.ok && last.severed !== null && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ver(v0.2 美術合併)=${text.includes('v0.2 美術合併')} https=${URL.startsWith('https://')} sha=${sha} swScope=${sw} cut=${last ? (last.severed !== null ? '切下' : '未切') : 'none'} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
