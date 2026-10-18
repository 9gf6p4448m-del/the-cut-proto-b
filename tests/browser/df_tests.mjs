// duel v0.3 手感與可讀性（duel3/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/DUEL_V03_FEEL.md DF-03～07（瀏覽器部分）。DF-01／02／04（規則）在 tests/node/df_rules.test.ts。
// DF-03（直線預覽不變）：cb_tests.mjs／da_tests.mjs 以 sub='duel3'＋載入前切到直線預覽照跑（由 run.mjs 呼叫，不在本檔）。
// duel4（DUEL_V04_FRONT FV-07）：同一份測試以 sub='duel4' 照跑。預設參數＝duel3，duel3 的行為一字不變。
// duel4 要調整的案例（規則變更，逐條理由見 the-cut DUEL_V04_EVIDENCE）：開局等待改為「等倒數結束」（settle）；跳過教學後等倒數結束才檢查切割期開始；
// 按住提示：加亮集合改為「範圍內」、遠處改驗範圍外調暗（補述 1 第 1／8 條；其餘斷言照驗，審查 H2）。
import { mkdirSync } from 'node:fs';
import { newPage } from './exp_tests.mjs';

export const LINE_INIT = "try { localStorage.setItem('duel3-input', 'line'); } catch (e) {}";
export const lineInit = (sub) => `try { localStorage.setItem('${sub}-input', 'line'); } catch (e) {}`;
const noTut = (sub) => `try { localStorage.setItem('${sub}-tutorial', 'done'); } catch (e) {}`;
/** 開局後等 300ms；頁面有開場倒數（duel4）時再等倒數結束（duel3 沒有倒數掛勾＝只等 300ms，行為不變）。 */
const settle = async (pg) => { await pg.waitForTimeout(300); if (await pg.evaluate(() => 'countdown' in window.__cb)) await pg.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 8000 }); };
const ready = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 30000 });
const frames = (pg, n = 2) => pg.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/** 在頁面裡挑一刀：從藍龍身內出發、快速劃過一個可切的紅色器官（路上不經過其他紅色器官），回傳世界座標的起訖點與目標。 */
export const PLAN = `(() => {
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

export async function runDfTests({ bname, btype, devices, url, check, shotDir = 'test-output/df_shots', sub = 'duel3', ver = 'v0.3 手感與可讀性' }) {
  const NO_TUT = noTut(sub);
  mkdirSync(shotDir, { recursive: true });
  const browser = await btype.launch();
  const tag = `[${bname}][${sub}]`;
  const open = async (w = 393, h = 852, init = [NO_TUT]) => { const { ctx, page } = await newPage(browser, bname, devices, w, h); for (const s of init) await ctx.addInitScript(s); await page.goto(url + `/${sub}/`); await ready(page); return { ctx, page }; };

  // ===== DF-07 版本、版面（393×852／375×667）、操作切換鈕 =====
  for (const [w, h] of [[393, 852], [375, 667]]) {
    const { ctx, page } = await open(w, h);
    const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
    const v = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect(), btns = [...document.querySelectorAll('footer button')].map((b) => b.getBoundingClientRect());
      return { ver: document.getElementById('ver').textContent, top: document.getElementById('top').textContent, sw: document.scrollingElement.scrollWidth, iw: innerWidth, ih: innerHeight,
        mode: document.getElementById('inputMode').textContent, minH: Math.min(...btns.map((b) => b.height)), maxR: Math.max(...btns.map((b) => b.right)), cv: r('scene'), foot: r('inputMode').bottom };
    });
    const ok = v.ver === ver && v.top.includes(sha) && v.top.includes('研究片段') && !sha.includes('__') && v.sw <= v.iw && v.minH >= 44 && v.maxR <= v.iw && v.foot <= v.ih && v.cv.height > 300 && v.mode === '操作：即時劃刀' && page.__errs.length === 0;
    check(`${tag} DF-07 ${w}×${h} 版面：版本「${ver}」＋SHA＋研究片段、無水平捲動、按鈕 ≥44px 且在畫面內、預設「操作：即時劃刀」、無錯誤`, ok, JSON.stringify({ sha, ...v, cv: Math.round(v.cv.height), errs: page.__errs }));
    await ctx.close();
  }

  // ===== DF-07 真實觸控拖曳劃出一刀（即時模式、真實時間推進） =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    await settle(page);
    const plan = await page.evaluate(PLAN);
    const A = await scr(page, plan.S), B = await scr(page, plan.E);
    const how = await swipe(page, bname, A, B);
    await page.waitForFunction(() => !!window.__cb.lastFree, null, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(() => ({ log: window.__cb.freeLog, last: window.__cb.lastFree && { why: window.__cb.lastFree.why, severed: window.__cb.lastFree.severed }, ids: window.__cb.game.organs.map((o) => o.id) }));
    const sevId = r.last && r.last.severed !== null ? r.ids[r.last.severed] : null;
    check(`${tag} DF-07 真實拖曳（${how === 'touch' ? 'CDP 觸控' : '滑鼠 pointer，WebKit 無觸控移動 API'}）劃出一刀：起刀＋切下目標器官`, r.log.some((x) => x.endsWith(':freeStart')) && sevId === plan.id, JSON.stringify({ plan: plan.id, ...r.last, sevId, log: r.log.slice(-4) }));
    await ctx.close();
  }

  // ===== DF-02（瀏覽器鏈路）：真實指標事件經「時間戳換算→切片→晚 2 步結算」（審查 M-3）。
  // Chromium：CDP 觸控帶硬體式時間戳（快刀每 8ms 一點、慢描每 120ms 一點），CPU 1 倍與 4 倍節流下結果相同（頁面處理變慢不改變手指速度）。
  // WebKit：沒有觸控與節流 API，用滑鼠快拖／慢拖（每段停 120ms），只驗 1 倍。
  {
    const res = [];
    for (const rate of bname === 'chromium' ? [1, 4] : [1]) {
      const { ctx, page } = await open();
      const cdp = bname === 'chromium' ? await page.context().newCDPSession(page) : null;
      if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
      await settle(page);
      const go = async (gapMs) => {
        const plan = await page.evaluate(PLAN), A = await scr(page, plan.S), B = await scr(page, plan.E);
        if (cdp) {
          const base = Date.now() / 1000, pt = (k) => ({ x: A.x + ((B.x - A.x) * k) / 8, y: A.y + ((B.y - A.y) * k) / 8 });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0)], timestamp: base });
          for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(k)], timestamp: base + (k * gapMs) / 1000 });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: base + (8 * gapMs + 1) / 1000 });
        } else {
          await page.mouse.move(A.x, A.y); await page.mouse.down();
          for (let k = 1; k <= 8; k++) { await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8); if (gapMs > 50) await page.waitForTimeout(gapMs); }
          await page.mouse.up();
        }
        const n0 = await page.evaluate(() => window.__cb.freeLog.length);
        await page.waitForFunction((n) => window.__cb.freeLog.length > n && window.__cb.freeLog[window.__cb.freeLog.length - 1].includes('freeEnd'), n0, { timeout: 8000 }).catch(() => {});
        const f = await page.evaluate(() => { const x = window.__cb.lastFree; return x && { why: x.why, sev: x.severed === null ? null : window.__cb.game.organs[x.severed].id }; });
        return { plan: plan.id, ...f };
      };
      const fast = await go(8);
      await page.waitForTimeout(1800);
      const slow = await go(120);
      res.push({ rate, fast, slow });
      if (cdp) await cdp.detach();
      await ctx.close();
    }
    const ok = res.every((r) => r.fast.sev === r.fast.plan && r.slow.why === 'up' && r.slow.sev === null);
    check(`${tag} DF-02 瀏覽器鏈路：真實指標事件${bname === 'chromium' ? '（CDP 觸控＋硬體式時間戳，CPU 1 倍／4 倍）' : '（滑鼠，WebKit 無觸控／節流 API）'}：快刀都切下目標、慢描都是鈍刀`, ok, JSON.stringify(res));
  }
  // ===== DL-085 卡頓後緊接下一刀（取代沒有鑑別力的「覆審 N-1」測試）：真實指標事件，不經 feed（feed 跳過時間戳換算，測不到這個缺陷）。
  // 第一刀按下後主執行緒卡住 700ms（規則時鐘一幀最多走 250ms → 落後實際時間），放開成點擊；緊接著第二刀快劃切目標。
  // 斷言：①兩刀各自起刀、各自結束（第一刀＝點擊、第二刀＝切下目標）②第二刀的按下沒被吞（兩次 freeStart、沒有 freeReject）③第二刀的線段沒接到第一刀（第一刀沒有切到東西）。
  {
    const { ctx, page } = await open();
    const cdp = bname === 'chromium' ? await page.context().newCDPSession(page) : null;
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    await settle(page);
    const plan = await page.evaluate(PLAN), A = await scr(page, plan.S), B = await scr(page, plan.E);
    const now = () => Date.now() / 1000;
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: A.x, y: A.y }], timestamp: now() });
    else { await page.mouse.move(A.x, A.y); await page.mouse.down(); }
    const lag = await page.evaluate(async () => {
      const lag0 = performance.now() - window.__cb.clock, t = performance.now(); while (performance.now() - t < 700) { /* 卡住主執行緒 */ }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - window.__cb.clock - lag0);
    });
    if (cdp) {
      const t1 = now();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t1 });
      const t2 = t1 + 0.002, pt = (k) => ({ x: A.x + ((B.x - A.x) * k) / 8, y: A.y + ((B.y - A.y) * k) / 8 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0)], timestamp: t2 });
      for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(k)], timestamp: t2 + (k * 8) / 1000 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t2 + 0.065 });
    } else {
      await page.mouse.up();
      await page.mouse.move(A.x, A.y); await page.mouse.down();
      for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
      await page.mouse.up();
    }
    await page.waitForFunction(() => window.__cb.freeLog.filter((x) => x.includes('freeEnd')).length >= 2, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ log: window.__cb.freeLog, ids: window.__cb.game.organs.map((o) => o.id) }));
    const starts = r.log.filter((x) => x.endsWith(':freeStart')).length, rejects = r.log.filter((x) => x.includes(':freeReject')).length;
    const ends = r.log.filter((x) => x.includes(':freeEnd:')).map((x) => x.split(':'));
    const sev2 = ends[1] && ends[1][3] !== 'null' ? r.ids[+ends[1][3]] : null;   // 格式：步:freeEnd:why:severed:blocked
    const ok = lag >= 300 && starts === 2 && rejects === 0 && ends.length === 2 && ends[0][2] === 'tap' && ends[0][3] === 'null' && ends[1][2] === 'sever' && sev2 === plan.id;
    check(`${tag} DL-085 卡頓 700ms 後緊接下一刀（${cdp ? 'CDP 觸控＋時間戳' : '滑鼠 pointer'}）：兩刀各自起刀與結束、第二刀按下沒被吞、線段沒接到第一刀（第一刀＝點擊、第二刀切下目標）`, ok, JSON.stringify({ lag, plan: plan.id, starts, rejects, sev2, log: r.log }));
    if (cdp) await cdp.detach();
    await ctx.close();
  }
  // ===== 審查 H-1：教學示範期間拖線不出刀（不漏成直線刀），示範結束後盤面、冷卻不變 =====
  {
    const { ctx, page } = await open(393, 852, []);
    await page.waitForTimeout(300);
    const plan = await page.evaluate(PLAN);
    const A = await scr(page, plan.S), B = await scr(page, plan.E);
    await page.mouse.move(A.x, A.y); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
    await page.mouse.up();
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'hints', null, { timeout: 6000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ last: window.__cb.lastStrike, free: window.__cb.freeLog, cd: window.__cb.game.cdUntil.blue, cut: window.__cb.cutByMe.length }));
    check(`${tag} 審查 H-1 教學示範期間拖線：不出刀（沒有直線刀、沒有即時刀、冷卻 0）`, r.last === null && r.free.length === 0 && r.cd === 0 && r.cut === 0, JSON.stringify(r));
    await ctx.close();
  }
  // ===== DF-06 手感演出：切除時產生裂成兩半的演出事件；放慢只影響畫面時鐘，規則步照真實時間；同一輸入序列，演出開／關，規則結果相同 =====
  {
    const sigs = [];
    let splitOk = null, rate = null, clockRatio = null;
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
        const sl = st.slow; if (sl.length >= 2) { const dt = sl[sl.length - 1].now - sl[0].now; rate = dt > 0 ? ((sl[sl.length - 1].step - sl[0].step) * 1000) / dt : null; clockRatio = dt > 0 ? (sl[sl.length - 1].clock - sl[0].clock) / dt : null; }   // 規則時鐘增量÷真實時間（審查 L-1：比步數更直接）
      } else splitOk = splitOk && st.slow.length === 0;
      await ctx.close();
    }
    const same = JSON.stringify(sigs[0].sig) === JSON.stringify(sigs[1].sig) && sigs[0].sig.length >= 290;
    check(`${tag} DF-06 切除產生裂開演出、放慢 80ms 期間規則時鐘照真實時間走（增量比 0.9～1.1）、步數 40～80／秒（只放慢畫面）；演出開／關同一輸入，前 300 步規則結果逐步相同`, splitOk && rate !== null && rate > 40 && rate < 80 && clockRatio !== null && Math.abs(clockRatio - 1) < 0.1 && same, JSON.stringify({ splitOk, rate, clockRatio, same, n: sigs.map((s) => s.sig.length), log: sigs[0].log }));
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

  // ===== DF-04 顯示半徑＝判定半徑 34（像素量測）；DF-05 器官沒有圓框 =====
  // 測試模式只畫一個器官、透明底（和正式畫面同一個 organ()）。讀 alpha：本體＝alpha>127（光邊不透明度上限 0.47，量不到）。
  // 顯示半徑＝本體外框長邊÷2（素材不是正方形，art-kit v3 以長邊＝2r 擺放），換回世界單位和 34 比，誤差 ≤2；中心誤差 ≤2 CSS px。
  // 無圓框：以器官中心為圓心、半徑 1.05～1.25r 各取 72 點，alpha>127 的比例都 <60%（圓框會讓某一圈接近 100%）。locked 的護盾環規格允許，不量。
  {
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.setManual(true));
    const rows = [];
    for (const seed of [3, 5]) {
      await page.evaluate((sd) => window.__cb.newRun({ seed: sd }), seed);
      const ids = await page.evaluate(() => window.__cb.game.organs.map((o) => o.id));
      for (const id of ids) for (const st of [{ mode: 'normal' }, { mode: 'normal', cuttable: true, lit: 1 }]) {
        await page.evaluate(([i, s]) => window.__cb.isolate(i, { clear: true, st: s }), [id, st]);
        await frames(page, 2);
        rows.push(await page.evaluate((oid) => {
          const cb = window.__cb, o = cb.game.organs.find((q) => q.id === oid), cv = document.getElementById('scene'), g = cv.getContext('2d'), rc = cv.getBoundingClientRect(), k = cv.width / rc.width;
          const d = g.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height, A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(Math.round(y) * W + Math.round(x)) * 4 + 3]);
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          const c = cb.toScreen(o.p[0], o.p[1]), c2 = cb.toScreen(o.p[0] + 100, o.p[1]), wpx = ((c2.x - c.x) / 100) * k;   // 1 世界單位＝wpx 裝置像素
          const cx = (c.x - rc.left) * k, cy = (c.y - rc.top) * k, R = cb.R;
          const ring = [1.05, 1.1, 1.15, 1.2, 1.25].map((f) => { let n = 0; for (let a = 0; a < 72; a++) { const th = (a * Math.PI) / 36; if (A(cx + Math.cos(th) * f * R * wpx, cy + Math.sin(th) * f * R * wpx) > 127) n++; } return n / 72; });
          return { id: oid, kind: o.kind, rad: (Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2) / wpx, dc: Math.hypot((x0 + x1 + 1) / 2 - cx, (y0 + y1 + 1) / 2 - cy) / k, ring: Math.max(...ring) };
        }, id));
      }
    }
    await page.evaluate(() => window.__cb.isolate(null));
    const radErr = Math.max(...rows.map((r) => Math.abs(r.rad - 34))), dcMax = Math.max(...rows.map((r) => r.dc)), ringMax = Math.max(...rows.map((r) => r.ring));
    const worst = rows.slice().sort((a, b) => Math.abs(b.rad - 34) - Math.abs(a.rad - 34))[0];
    check(`${tag} DF-04 顯示半徑＝判定半徑 34：${rows.length} 次量測（2 種子全部器官 × 一般／可切加亮），本體長邊÷2 與 34 最大差 ${radErr.toFixed(2)}（≤2 世界單位）、中心最大差 ${dcMax.toFixed(2)} CSS px（≤2）`, rows.length >= 60 && radErr <= 2 && dcMax <= 2, JSON.stringify({ worst, range: [Math.min(...rows.map((r) => r.rad)).toFixed(2), Math.max(...rows.map((r) => r.rad)).toFixed(2)] }));
    check(`${tag} DF-05 器官沒有圓框：半徑 1.05～1.25r 各圈不透明點比例最大 ${(ringMax * 100).toFixed(0)}%（<60%）`, ringMax < 0.6, JSON.stringify(rows.slice().sort((a, b) => b.ring - a.ring).slice(0, 3)));
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
  // ===== DF-05 按住提示：手指按住不動時，420 內的對方器官加亮（像素差）、420 外的不變（像素對照，排除全場同步脈動）；加亮集合＝幾何算出的集合；移動後取消；起點不能起刀時不亮 =====
  // duel4（審查 H2：不得整段跳過）：加亮集合改為「範圍內」（補述 1 第 1／8 條）；「遠處」改取範圍外的器官，duel4 會把它調暗，所以改驗像素變暗（<0.9）。
  // 其餘照原條件驗：近處像素 +8% 以上、移動後取消、獸身外按住不亮。
  {
    const d4 = sub === 'duel4';
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.setManual(true));
    // 找一個起點：藍龍身內、不在器官圓內，420 內至少一個、470 外至少一個存活紅色器官（審查 M-2：沒有遠處器官就沒驗到「420 外不變」）
    let pick = null;
    for (let seed = 1; seed <= 60 && !pick; seed++) {
      await page.evaluate((sd) => window.__cb.newRun({ seed: sd }), seed);
      pick = await page.evaluate((d4) => {
        const g = window.__cb.game, R = window.__cb.R, body = g.mode.body.blue, inR = d4 ? window.__cb.inRange : null;
        const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
        for (let y = 990; y > 380; y -= 10) for (let x = 40; x < 680; x += 10) {
          const S = [x, y]; if (!inside(S, body) || g.organs.some((q, j) => g.alive[j] && Math.hypot(q.p[0] - x, q.p[1] - y) < R + 6)) continue;
          const d = g.organs.map((q, i) => (q.side === 'red' && g.alive[i] ? Math.hypot(q.p[0] - x, q.p[1] - y) : null));
          if (d4) {
            const near = d.findIndex((v, i) => v !== null && inR[i]), far = d.findIndex((v, i) => v !== null && !inR[i]);
            if (near >= 0 && far >= 0) return { S, near, far, expect: d.map((v, i) => (v !== null && inR[i] ? i : -1)).filter((i) => i >= 0), np: g.organs[near].p, fp: g.organs[far].p, R };
            continue;
          }
          const near = d.findIndex((v) => v !== null && v <= 400), far = d.findIndex((v) => v !== null && v > 470);
          if (near >= 0 && far >= 0) return { S, near, far, expect: d.map((v, i) => (v !== null && v <= 420 ? i : -1)).filter((i) => i >= 0), np: g.organs[near].p, fp: g.organs[far].p, R };
        }
        return null;
      }, d4);
    }
    let ok = false, info = { pick: !!pick };
    if (pick) {
      const boxOf = async (p) => { const c = await scr(page, p), e = await scr(page, [p[0] + pick.R, p[1]]), r = e.x - c.x; return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }; };
      await frames(page, 3);
      const nb = await regionLum(page, await boxOf(pick.np)), fb = await regionLum(page, await boxOf(pick.fp));
      const A = await scr(page, pick.S);
      await page.mouse.move(A.x, A.y); await page.mouse.down(); await frames(page, 3);
      const held = await page.evaluate(() => window.__cb.held);
      const nd = await regionLum(page, await boxOf(pick.np)), fd = await regionLum(page, await boxOf(pick.fp));
      await page.mouse.move(A.x + 40, A.y); await frames(page, 2);
      const afterMove = await page.evaluate(() => window.__cb.held.length);
      await page.mouse.up();
      // 起點在藍龍身外按住：不能起刀 → 不亮
      const out = await scr(page, [pick.S[0], 120]);
      await page.mouse.move(out.x, out.y); await page.mouse.down(); await frames(page, 2);
      const heldOutside = await page.evaluate(() => window.__cb.held.length);
      await page.mouse.up();
      const nearGain = nd / nb, farGain = fd / fb;
      ok = JSON.stringify([...held].sort((a, b) => a - b)) === JSON.stringify(pick.expect) && nearGain > 1.08 && nearGain - farGain > 0.06 && (d4 ? farGain < 0.9 : Math.abs(farGain - 1) < 0.05) && afterMove === 0 && heldOutside === 0;
      info = { S: pick.S, held, expect: pick.expect, nearGain: nearGain.toFixed(3), farGain: farGain.toFixed(3), afterMove, heldOutside };
    }
    check(d4 ? `${tag} DF-05 按住提示（duel4）：加亮集合＝範圍內的存活紅色器官、範圍內像素 +8% 以上、範圍外像素變暗（<0.9）、移動後取消、獸身外按住不亮` : `${tag} DF-05 按住提示：加亮集合＝起點 420 內的存活紅色器官、近處像素 +8% 以上且比遠處（470 外）多 6% 以上、遠處變化 <5%、移動後取消、獸身外按住不亮`, ok, JSON.stringify(info));
    await ctx.close();
  }
  // ===== DF-05 第一場教學：只出現一次、可以跳過；示範後依事件逐條出現三句提示 =====
  {
    const { ctx, page } = await open(393, 852, []);
    const t0 = await page.evaluate(() => window.__cb.tut);
    await page.waitForTimeout(600); await page.screenshot({ path: `${shotDir}/impl_tutorial_393x852.png` });
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'hints', null, { timeout: 6000 });
    const h0 = await page.evaluate(() => window.__cb.tut.text);
    if (await page.evaluate(() => 'countdown' in window.__cb)) await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 8000 });   // duel4：示範後的開場倒數結束才出刀
    const plan = await page.evaluate(PLAN);
    const feedNext = async (S, E) => { const c = await page.evaluate(() => window.__cb.clock); await page.evaluate((e) => window.__cb.feed(e), evs(S, E, c + 150)); await page.waitForTimeout(1900); return page.evaluate(() => window.__cb.tut && window.__cb.tut.text); };
    const h1 = await feedNext(plan.S, plan.E);
    const p2 = await page.evaluate(PLAN);
    const h2 = await feedNext(p2.S, p2.E);
    const h3 = await feedNext(p2.S, [p2.S[0] + 150, p2.S[1]]);
    const shown = await page.evaluate(() => !document.getElementById('tut').hidden), tlog = await page.evaluate(() => window.__cb.freeLog);   // tlog 只供失敗時歸因
    await page.reload(); await ready(page);
    const again = await page.evaluate(() => ({ tut: window.__cb.tut, hidden: document.getElementById('tut').hidden }));
    await ctx.close();
    const { ctx: c2, page: p } = await open(393, 852, []);
    const s0 = await p.evaluate(() => !document.getElementById('tut').hidden);
    await p.click('#tutSkip');
    const s1 = await p.evaluate(() => ({ hidden: document.getElementById('tut').hidden, tut: window.__cb.tut }));
    await settle(p);
    await p.waitForTimeout(100);
    const running = await p.evaluate(() => window.__cb.game.step > 0);
    await c2.close();
    const ok = t0 && t0.phase === 'demo' && h0 === '劃過紅色器官＝切下' && h1 === '劃過自己的器官＝保護' && h2 === '每刀之後要等冷卻' && h3 === null && !shown && again.tut === null && again.hidden && s0 && s1.hidden && s1.tut === null && running;
    check(`${tag} DF-05 第一場教學：示範（虛擬手）→ 三句提示依事件逐條出現 → 結束；重開不再出現；可跳過（跳過後切割期開始）`, ok, JSON.stringify({ t0, h0, h1, h2, h3, shown, again, s0, s1, running, tlog }));
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
