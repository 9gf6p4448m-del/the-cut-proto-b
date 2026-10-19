// 重現：即時（非手動）打到「清空！」後是否卡住。node tests/browser/ko_repro.mjs [seed]
import { chromium, devices } from 'playwright';
import { serve } from './serve.mjs';
import { newPage } from './exp_tests.mjs';
import { PLAN } from './df_tests.mjs';
const seed = Number(process.argv[2] ?? 9);
const { srv, url } = await serve(process.cwd());
const b = await chromium.launch();
const { ctx, page } = await newPage(b, 'chromium', devices, 393, 852);
await ctx.addInitScript("try { localStorage.setItem('duel5-tutorial', 'done'); } catch (e) {}; window.__duel5AutoBeast='snake';");
await page.goto(url + '/' + (process.env.SUB ?? 'duel5') + '/?cut=60');
await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 30000 });
await page.evaluate((s) => { window.__cb.newRun({ seed: s, beast: 'snake' }); window.__cb.skipCountdown(); }, seed);
const evs = (S, E, t0, ms = 60) => { const out = [{ t: t0, k: 'down', p: S }]; for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [S[0] + ((E[0] - S[0]) * t) / ms, S[1] + ((E[1] - S[1]) * t) / ms] }); out.push({ t: t0 + ms, k: 'move', p: E }, { t: t0 + ms, k: 'up', p: E }); return out; };
let ko = null;
for (let i = 0; i < 200; i++) {
  const st = await page.evaluate(() => ({ ph: window.__cb.game.phase, ui: window.__cb.ui, k: window.__cb.game.step }));
  if (st.ph !== 'cut' || st.ui !== 'cut') { ko = st; break; }
  const plan = await page.evaluate(PLAN);
  if (plan) await page.evaluate(([e]) => window.__cb.feed(e), [evs(plan.S, plan.E, (st.k + 4) * (1000 / 60))]);
  await page.waitForTimeout(350);
}
console.log('reached', JSON.stringify(ko));
for (const ms of [300, 1000, 2500]) {
  await new Promise((r) => setTimeout(r, ms));
  const r = await Promise.race([page.evaluate(() => ({ ph: window.__cb.game.phase, ui: window.__cb.ui })), new Promise((r) => setTimeout(() => r('HUNG(evaluate 無回應)'), 3000))]);
  console.log('after', ms, JSON.stringify(r));
}
await b.close(); srv.close(); process.exit(0);
