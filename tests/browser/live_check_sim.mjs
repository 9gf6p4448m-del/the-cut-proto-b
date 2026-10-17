// 同時下刀部署檢查（TSIM-14 上線部分；作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」字樣、自己的 service worker（scope＝twin-sim/）、
// 真實拖曳完成 1 回合（揭曉的 AI 刀＝拖曳前鎖定的刀）、無錯誤與 4xx/5xx。用法：node tests/browser/live_check_sim.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
import { candidateCuts } from '../../src/twinslash/rules.ts';
import { snapshot } from '../../src/twinsim/sim.ts';
const URL = process.argv[2], SHA = process.argv[3];
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__sim);
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  await page.waitForFunction(() => window.__sim.phase === 'player' && !!window.__sim.locked, null, { timeout: 30000 });
  const lock = await page.evaluate(() => window.__sim.locked), st = await page.evaluate(() => window.__sim.sim);
  const l = candidateCuts(snapshot(st), 'blue').find((r) => r.fired.length >= 2);
  const A = await page.evaluate(([x, y]) => window.__sim.toScreen(x, y), l.a), B = await page.evaluate(([x, y]) => window.__sim.toScreen(x, y), l.b);
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => window.__sim.sim.round === 1 && !window.__sim.animActive, null, { timeout: 30000 });
  const last = await page.evaluate(() => window.__sim.last);
  const sameLock = Math.hypot(last.red.a[0] - lock.a[0], last.red.a[1] - lock.a[1]) < 1.5 && Math.hypot(last.red.b[0] - lock.b[0], last.red.b[1] - lock.b[1]) < 1.5;
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && typeof sw === 'string' && sw.endsWith('/twin-sim/')
    && sameLock && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${sha} swScope=${sw} round1=${sameLock ? 'ok' : 'bad'} blueDmg=${last.blue.dmg} redDmg=${last.red.dmg} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
