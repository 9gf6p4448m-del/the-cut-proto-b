// duel v0.3 手感與可讀性（duel3/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/DUEL_V03_FEEL.md DF-03～07（瀏覽器部分）。DF-01／02／04（規則）在 tests/node/df_rules.test.ts。
// DF-03（直線預覽不變）：cb_tests.mjs／da_tests.mjs 以 sub='duel3'＋載入前切到直線預覽照跑（由 run.mjs 呼叫，不在本檔）。
import { mkdirSync } from 'node:fs';
import { newPage } from './exp_tests.mjs';

export const LINE_INIT = "try { localStorage.setItem('duel3-input', 'line'); } catch (e) {}";
const NO_TUT = "try { localStorage.setItem('duel3-tutorial', 'done'); } catch (e) {}";
const ready = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 30000 });
const frames = (pg, n = 2) => pg.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/** 在頁面裡挑一刀：從藍龍身內出發、快速劃過一個可切的紅色器官（路上不經過其他紅色器官），回傳世界座標的起訖點與目標。 */
const PLAN = `(() => {
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
      // 起點不在任何器官圓內；路上不碰其他紅色器官
      if (g.organs.some((q, j) => g.alive[j] && Math.hypot(q.p[0] - S[0], q.p[1] - S[1]) < R + 4)) continue;
      if (g.organs.some((q, j) => j !== i && q.side === 'red' && g.alive[j] && segD(q.p, S, E) < R + 6)) continue;
      if (!best || d < best.d) best = { i, id: o.id, S, E, d };
    }
  });
  return best;
})()`;
async function scr(page, p) { return page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p); }
/** 真實觸控拖曳：Chromium 用 CDP 送 touchStart／Move／End（瀏覽器產生 pointerType=touch 的 pointer 事件）；WebKit 的 Playwright 沒有觸控移動 API，改用滑鼠拖曳（pointer 事件，同一套輸入程式）。 */
async function swipe(page, bname, A, B, n = 8) {
  if (bname === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: A.x, y: A.y }] });
    for (let k = 1; k <= n; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: A.x + ((B.x - A.x) * k) / n, y: A.y + ((B.y - A.y) * k) / n }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return 'touch';
  }
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= n; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / n, A.y + ((B.y - A.y) * k) / n);
  await page.mouse.up();
  return 'mouse';
}
/** 時間戳＋座標的事件序列（本局毫秒）：從 S 到 E 等速劃過，ms 毫秒，每 8ms 一點。 */
function evs(S, E, t0, ms = 60) {
  const out = [{ t: t0, k: 'down', p: S }];
  for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [S[0] + ((E[0] - S[0]) * t) / ms, S[1] + ((E[1] - S[1]) * t) / ms] });
  out.push({ t: t0 + ms, k: 'move', p: E }, { t: t0 + ms, k: 'up', p: E });
  return out;
}
/** 畫布上一塊區域的平均亮度（R+G+B）。 */
const regionLum = (page, box) => page.evaluate((b) => {
  const cv = document.getElementById('scene'), g = cv.getContext('2d'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const x = Math.max(0, Math.round((b.x - r.left) * k)), y = Math.max(0, Math.round((b.y - r.top) * k)), w = Math.max(1, Math.round(b.w * k)), h = Math.max(1, Math.round(b.h * k));
  const d = g.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4);
}, box);

export async function runDfTests({ bname, btype, devices, url, check, shotDir = 'test-output/df_shots' }) {
  mkdirSync(shotDir, { recursive: true });
  const browser = await btype.launch();
  const tag = `[${bname}][duel3]`;
  const open = async (w = 393, h = 852, init = [NO_TUT]) => { const { ctx, page } = await newPage(browser, bname, devices, w, h); for (const s of init) await ctx.addInitScript(s); await page.goto(url + '/duel3/'); await ready(page); return { ctx, page }; };

  // ===== DF-07 版本、版面（393×852／375×667）、操作切換鈕 =====
  for (const [w, h] of [[393, 852], [375, 667]]) {
    const { ctx, page } = await open(w, h);
    const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
    const v = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect(), btns = [...document.querySelectorAll('footer button')].map((b) => b.getBoundingClientRect());
      return { ver: document.getElementById('ver').textContent, top: document.getElementById('top').textContent, sw: document.scrollingElement.scrollWidth, iw: innerWidth, ih: innerHeight,
        mode: document.getElementById('inputMode').textContent, minH: Math.min(...btns.map((b) => b.height)), maxR: Math.max(...btns.map((b) => b.right)), cv: r('scene'), foot: r('inputMode').bottom };
    });
    const ok = v.ver === 'v0.3 手感與可讀性' && v.top.includes(sha) && v.top.includes('研究片段') && !sha.includes('__') && v.sw <= v.iw && v.minH >= 44 && v.maxR <= v.iw && v.foot <= v.ih && v.cv.height > 300 && v.mode === '操作：即時劃刀' && page.__errs.length === 0;
    check(`${tag} DF-07 ${w}×${h} 版面：版本「v0.3 手感與可讀性」＋SHA＋研究片段、無水平捲動、按鈕 ≥44px 且在畫面內、預設「操作：即時劃刀」、無錯誤`, ok, JSON.stringify({ sha, ...v, cv: Math.round(v.cv.height), errs: page.__errs }));
    await ctx.close();
  }

  // ===== DF-07 真實觸控拖曳劃出一刀（即時模式、真實時間推進） =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    await page.waitForTimeout(300);
    const plan = await page.evaluate(PLAN);
    const A = await scr(page, plan.S), B = await scr(page, plan.E);
    const how = await swipe(page, bname, A, B);
    await page.waitForFunction(() => !!window.__cb.lastFree, null, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(() => ({ log: window.__cb.freeLog, last: window.__cb.lastFree && { why: window.__cb.lastFree.why, severed: window.__cb.lastFree.severed }, ids: window.__cb.game.organs.map((o) => o.id) }));
    const sevId = r.last && r.last.severed !== null ? r.ids[r.last.severed] : null;
    check(`${tag} DF-07 真實拖曳（${how === 'touch' ? 'CDP 觸控' : '滑鼠 pointer，WebKit 無觸控移動 API'}）劃出一刀：起刀＋切下目標器官`, r.log.some((x) => x.endsWith(':freeStart')) && sevId === plan.id, JSON.stringify({ plan: plan.id, ...r.last, sevId, log: r.log.slice(-4) }));
    await ctx.close();
  }

  // ===== DF-06 手感演出：切除時產生裂成兩半的演出事件；放慢只影響畫面時鐘，規則步照真實時間；同一輸入序列，演出開／關，規則結果相同 =====
  {
    const sigs = [];
    let splitOk = null, rate = null;
    for (const fxOn of [true, false]) {
      const { ctx, page } = await open();
      await page.evaluate(() => window.__cb.newRun({ seed: 11 }));
      await page.evaluate((v) => window.__cb.setFx(v), fxOn);
      const plan = await page.evaluate(PLAN);
      const c0 = await page.evaluate(() => window.__cb.clock);
      const t0 = Math.ceil((c0 + 400) / 100) * 100;   // 時間戳固定在本局 t0（兩次相同）；之後再一刀
      await page.evaluate((e) => window.__cb.feed(e), [...evs(plan.S, plan.E, 1200), ...evs(plan.S, [plan.S[0] + 200, plan.S[1]], 3000)]);
      void t0;
      await page.waitForFunction(() => window.__cb.game.step >= 300 || window.__cb.ui !== 'cut', null, { timeout: 20000 });
      const st = await page.evaluate(() => ({ sig: window.__cb.stepSig.slice(0, 300), log: window.__cb.freeLog, slow: window.__cb.slowLog, splits: window.__cb.splits }));
      sigs.push(st);
      if (fxOn) {
        splitOk = st.log.some((x) => x.includes(':freeEnd:sever:'));
        // 放慢期間：規則步數÷真實時間 ≈ 60 步／秒（畫面時鐘才放慢）
        const sl = st.slow; if (sl.length >= 2) { const dt = sl[sl.length - 1].now - sl[0].now; rate = dt > 0 ? ((sl[sl.length - 1].step - sl[0].step) * 1000) / dt : null; }
      } else splitOk = splitOk && st.slow.length === 0;
      await ctx.close();
    }
    const same = JSON.stringify(sigs[0].sig) === JSON.stringify(sigs[1].sig) && sigs[0].sig.length >= 290;
    check(`${tag} DF-06 切除產生裂開演出、放慢 ${80}ms 期間規則步照 60 步／秒（只放慢畫面）；演出開／關同一輸入，前 300 步規則結果逐步相同`, splitOk && rate !== null && rate > 40 && rate < 80 && same, JSON.stringify({ splitOk, rate, same, n: sigs.map((s) => s.sig.length), log: sigs[0].log }));
  }
  // ===== DF-06 切除當下產生裂開演出（手動推進，直接數 split 物件） =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 11 }); });
    const plan = await page.evaluate(PLAN);
    await page.evaluate((e) => window.__cb.feed(e), evs(plan.S, plan.E, 100));
    await page.evaluate(() => window.__cb.advance(12));
    await frames(page, 1);
    const r = await page.evaluate(() => ({ splits: window.__cb.splits, log: window.__cb.freeLog, audio: window.__cb.audio.slice(-3) }));
    check(`${tag} DF-06 切除瞬間：裂成兩半的演出物件＋切割音效`, r.splits >= 1 && r.log.some((x) => x.includes(':sever:')) && r.audio.includes('sever'), JSON.stringify(r));
    await ctx.close();
  }

  // ===== DF-05 切割期本體亮度低於戰鬥期（只畫場景，像素平均） =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 3 }); window.__cb.setSceneOnly(true); window.__cb.setTimings({ battleScale: 50 }); });
    await frames(page, 3);
    const box = await page.evaluate(() => { const r = document.getElementById('scene').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const cut = await regionLum(page, box);
    await page.evaluate(() => window.__cb.advance(2000));
    await page.waitForFunction(() => window.__cb.ui === 'battle', null, { timeout: 5000 });
    await frames(page, 3);
    const battle = await regionLum(page, box);
    check(`${tag} DF-05 切割期本體調暗：切割期場景平均亮度 < 戰鬥期（比值 < 0.85）`, cut < battle * 0.85, JSON.stringify({ cut: cut.toFixed(1), battle: battle.toFixed(1), ratio: (cut / battle).toFixed(3) }));
    await ctx.close();
  }
  // ===== DF-05 按住提示：手指按住不動時，420 內的對方器官加亮（像素差）；移動後取消 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 5 }); });
    const plan = await page.evaluate(PLAN);
    const info = await page.evaluate(([S, id]) => { const g = window.__cb.game, o = g.organs.find((q) => q.id === id), far = g.organs.find((q, i) => q.side === 'red' && g.alive[i] && Math.hypot(q.p[0] - S[0], q.p[1] - S[1]) > 470); return { o: o.p, far: far && far.p, R: window.__cb.R }; }, [plan.S, plan.id]);
    const boxOf = async (p) => { const c = await scr(page, p), e = await scr(page, [p[0] + info.R, p[1]]), r = e.x - c.x; return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }; };
    await frames(page, 3);
    const before = await regionLum(page, await boxOf(info.o)), farBefore = info.far ? await regionLum(page, await boxOf(info.far)) : null;
    const A = await scr(page, plan.S);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await frames(page, 3);
    const held = await page.evaluate(() => window.__cb.held);
    const during = await regionLum(page, await boxOf(info.o)), farDuring = info.far ? await regionLum(page, await boxOf(info.far)) : null;
    await page.mouse.move(A.x + 40, A.y); await frames(page, 2);
    const afterMove = await page.evaluate(() => window.__cb.held.length);
    await page.mouse.up();
    const ok = during > before * 1.08 && afterMove === 0 && (farBefore === null || Math.abs(farDuring - farBefore) < farBefore * 0.05);
    check(`${tag} DF-05 按住提示：按住未移動時 420 內的對方器官變亮（像素平均 +8% 以上）、420 外的不變、移動後取消`, ok, JSON.stringify({ before: before.toFixed(1), during: during.toFixed(1), farBefore, farDuring, held: held.length, afterMove }));
    await ctx.close();
  }
  // ===== DF-05 第一場教學：只出現一次、可以跳過；示範後依事件逐條出現三句提示 =====
  {
    const { ctx, page } = await open(393, 852, []);
    const t0 = await page.evaluate(() => window.__cb.tut);
    await page.waitForTimeout(600); await page.screenshot({ path: `${shotDir}/impl_tutorial_393x852.png` });
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'hints', null, { timeout: 6000 });
    const h0 = await page.evaluate(() => window.__cb.tut.text);
    const plan = await page.evaluate(PLAN);
    const feedNext = async (S, E) => { const c = await page.evaluate(() => window.__cb.clock); await page.evaluate((e) => window.__cb.feed(e), evs(S, E, c + 150)); await page.waitForTimeout(1900); return page.evaluate(() => window.__cb.tut && window.__cb.tut.text); };
    const h1 = await feedNext(plan.S, plan.E);
    const p2 = await page.evaluate(PLAN);
    const h2 = await feedNext(p2.S, p2.E);
    const h3 = await feedNext(p2.S, [p2.S[0] + 150, p2.S[1]]);
    const shown = await page.evaluate(() => !document.getElementById('tut').hidden);
    await page.reload(); await ready(page);
    const again = await page.evaluate(() => ({ tut: window.__cb.tut, hidden: document.getElementById('tut').hidden }));
    await ctx.close();
    const { ctx: c2, page: p } = await open(393, 852, []);
    const s0 = await p.evaluate(() => !document.getElementById('tut').hidden);
    await p.click('#tutSkip');
    const s1 = await p.evaluate(() => ({ hidden: document.getElementById('tut').hidden, tut: window.__cb.tut }));
    await p.waitForTimeout(400);
    const running = await p.evaluate(() => window.__cb.game.step > 0);
    await c2.close();
    const ok = t0 && t0.phase === 'demo' && h0 === '劃過紅色器官＝切下' && h1 === '劃過自己的器官＝保護' && h2 === '每刀之後要等冷卻' && h3 === null && !shown && again.tut === null && again.hidden && s0 && s1.hidden && s1.tut === null && running;
    check(`${tag} DF-05 第一場教學：示範（虛擬手）→ 三句提示依事件逐條出現 → 結束；重開不再出現；可跳過（跳過後切割期開始）`, ok, JSON.stringify({ t0, h0, h1, h2, h3, shown, again, s0, s1, running }));
  }

  // ===== 393×852 截圖（切割期即時劃刀中、戰鬥期、縫合） =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 5 }); window.__cb.advance(90); });
    const plan = await page.evaluate(PLAN);
    const A = await scr(page, plan.S), B = await scr(page, plan.E);
    await page.mouse.move(A.x, A.y); await page.mouse.down();
    for (let k = 1; k <= 5; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
    await frames(page, 1); await page.screenshot({ path: `${shotDir}/impl_cut_393x852.png` });
    await page.mouse.up();
    await page.evaluate(() => { window.__cb.setTimings({ battleScale: 1 }); window.__cb.advance(2000); });
    await page.waitForTimeout(1600); await page.screenshot({ path: `${shotDir}/impl_battle_393x852.png` });
    check(`${tag} DF-05 截圖 393×852：切割期（劃刀中）、戰鬥期、教學`, true, shotDir);
    await ctx.close();
  }
  await browser.close();
}
