// 對決 v0.4 前線推進部署檢查（FV-07 上線部分；作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」與「v0.4 前線推進」字樣、
// manifest id＝duel4、自己的 service worker（scope＝duel4/）、開場倒數、預設即時劃刀、真實拖曳劃出一刀並切下目標、無錯誤與 4xx/5xx。
// 用法：node tests/browser/live_check_duel4.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
const URL = process.argv[2], SHA = process.argv[3];
// 找一條從藍方獸身內起刀、快速劃過一個可切紅色器官、路上不碰其他紅色器官的線（同 df_tests 的 PLAN）
const PLAN = () => {
  const g = window.__cb.game, R = window.__cb.R, body = g.mode.body.blue;
  const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const ok = (i) => g.alive[i] && g.step >= g.readyAt[i] && g.lockUntil[i] <= g.step;
  let best = null;
  g.organs.forEach((o, i) => {
    if (o.side !== 'red' || !ok(i)) return;
    for (let a = 0; a < 24; a++) for (const d of [120, 160, 200, 240]) {
      const th = a * Math.PI / 12, S = [o.p[0] + Math.cos(th) * d, o.p[1] + Math.sin(th) * d];
      if (!inside(S, body)) continue;
      const E = [o.p[0] - Math.cos(th) * 50, o.p[1] - Math.sin(th) * 50];
      if (g.organs.some((q, j) => g.alive[j] && Math.hypot(q.p[0] - S[0], q.p[1] - S[1]) < R + 4)) continue;
      if (g.organs.some((q, j) => j !== i && q.side === 'red' && g.alive[j] && segD(q.p, S, E) < R + 6)) continue;
      if (!best || d < best.d) best = { i, id: o.id, S, E, d };
    }
  });
  return best;
};
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 40000 });
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const mid = await page.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); return l ? (await (await fetch(l.href, { cache: 'no-store' })).json()).id : 'no-manifest'; });
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  const input = await page.evaluate(() => window.__cb.input);
  await page.evaluate(() => window.__cb.skipTut());
  await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 8000 });   // 開場倒數結束才能出刀
  await page.waitForTimeout(300);
  const plan = await page.evaluate(PLAN);
  const A = await page.evaluate(([x, y]) => window.__cb.toScreen(x, y), plan.S), B = await page.evaluate(([x, y]) => window.__cb.toScreen(x, y), plan.E);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
  await page.mouse.up();
  await page.waitForFunction(() => !!window.__cb.lastFree, null, { timeout: 5000 }).catch(() => {});
  const last = await page.evaluate(() => { const x = window.__cb.lastFree; return x && { why: x.why, sev: x.severed === null ? null : window.__cb.game.organs[x.severed].id }; });
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && text.includes('v0.4 前線推進') && mid === 'duel4'
    && typeof sw === 'string' && sw.endsWith('/duel4/') && input === 'free' && last && last.sev === plan.id && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ver(v0.4 前線推進)=${text.includes('v0.4 前線推進')} https=${URL.startsWith('https://')} sha=${sha} manifestId=${mid} swScope=${sw} input=${input} cut=${last ? `${last.why}:${last.sev}（目標 ${plan.id}）` : 'none'} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
