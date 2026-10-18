// duel v0.4 前線推進（duel4/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/DUEL_V04_FRONT.md＋補述 1／2 的 FV-04、FV-05、FV-06 與 C（範圍顯示）、B（前線帶）的瀏覽器部分。
// FV-01／02／03 與 FV-05 槽位幾何在 tests/node/fv_rules.test.ts；FV-07 由 run.mjs 以 sub='duel4' 照跑 df／cb／da 測試。
import { mkdirSync } from 'node:fs';
import { newPage } from './exp_tests.mjs';
import { PLAN, regionLum } from './df_tests.mjs';

const NO_TUT = "try { localStorage.setItem('duel4-tutorial', 'done'); } catch (e) {}";
const ready = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 30000 });
const scr = (page, p) => page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p);
const evs = (S, E, t0, ms = 60) => { const out = [{ t: t0, k: 'down', p: S }]; for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [S[0] + ((E[0] - S[0]) * t) / ms, S[1] + ((E[1] - S[1]) * t) / ms] }); out.push({ t: t0 + ms, k: 'move', p: E }, { t: t0 + ms, k: 'up', p: E }); return out; };
const frames = (pg, n = 3) => pg.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

export async function runFvTests({ bname, btype, devices, url, check, shotDir = 'test-output/fv_shots' }) {
  mkdirSync(shotDir, { recursive: true });
  const browser = await btype.launch();
  const tag = `[${bname}][duel4]`;
  const open = async (init = [NO_TUT]) => { const { ctx, page } = await newPage(browser, bname, devices, 393, 852); for (const s of init) await ctx.addInitScript(s); await page.goto(url + '/duel4/'); await ready(page); return { ctx, page }; };
  const touch = async (page, p) => { const A = await scr(page, p); await page.touchscreen.tap(A.x, A.y); };

  // ===== FV-04 倒數：期間模擬時間不前進、AI 不出刀、玩家拖曳不生效；結束後開始 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    const a = await page.evaluate(() => ({ cd: window.__cb.countdown, step: window.__cb.game.step, clock: window.__cb.clock, aim: window.__cb.game.aim }));
    const plan = await page.evaluate(PLAN), A = await scr(page, plan.S), B = await scr(page, plan.E);
    await page.mouse.move(A.x, A.y); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
    await page.mouse.up();
    await page.waitForTimeout(900);
    const b = await page.evaluate(() => ({ cd: window.__cb.countdown, step: window.__cb.game.step, clock: window.__cb.clock, aim: window.__cb.game.aim, free: window.__cb.freeLog, sev: window.__cb.game.severedN, ph: document.getElementById('phase').textContent }));
    await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const c = await page.evaluate(() => ({ step: window.__cb.game.step, free: window.__cb.freeLog, alive: window.__cb.game.alive.filter(Boolean).length, n: window.__cb.game.organs.length }));
    await page.screenshot({ path: `${shotDir}/countdown_393x852.png` }).catch(() => {});
    const ok = a.cd > 2000 && a.step === 0 && b.cd > 0 && b.step === 0 && b.clock === 0 && b.aim === null && b.free.length === 0 && b.sev.blue + b.sev.red === 0 && b.ph === '準備' && c.step > 20 && c.free.length === 0 && c.alive === c.n;
    check(`${tag} FV-04 倒數 2.4 秒：期間步數與規則時鐘都是 0、AI 沒有預告、倒數中的拖曳不生效（之後也不補出刀）；倒數結束後模擬開始`, ok, JSON.stringify({ a: { cd: Math.round(a.cd), step: a.step }, b: { cd: Math.round(b.cd), step: b.step, clock: b.clock, aim: !!b.aim, free: b.free, ph: b.ph }, c }));
    await ctx.close();
  }
  // ===== FV-04 教學場：玩家第一次鎖定或切除之前 AI 出刀 0 次；之後才開始出刀 =====
  {
    const { ctx, page } = await open([]);
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'hints', null, { timeout: 8000 });
    await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 8000 });
    await page.waitForTimeout(4000);   // 一般場 1 秒內 AI 就會預告
    const idle = await page.evaluate(() => ({ step: window.__cb.game.step, aim: window.__cb.game.aim, aims: window.__cb.aimCount, hold: window.__cb.game.aiHold, sevR: window.__cb.game.severedN.red, log: window.__cb.fxLog.map((x) => x.t) }));
    const plan = await page.evaluate(PLAN);
    const c0 = await page.evaluate(() => window.__cb.clock);
    await page.evaluate((e) => window.__cb.feed(e), evs(plan.S, plan.E, c0 + 150));
    await page.waitForFunction(() => window.__cb.fxLog.some((x) => x.t === 'aiRelease'), null, { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => !!window.__cb.game.aim || window.__cb.game.severedN.red > 0, null, { timeout: 8000 }).catch(() => {});
    const after = await page.evaluate(() => ({ step: window.__cb.game.step, aim: !!window.__cb.game.aim, hold: window.__cb.game.aiHold, sevB: window.__cb.game.severedN.blue, log: window.__cb.fxLog.map((x) => x.t) }));
    const ok = idle.step > 200 && idle.aim === null && idle.aims === 0 && idle.hold === true && idle.sevR === 0 && !idle.log.includes('aiRelease') && after.log.includes('aiRelease') && after.hold === false && after.sevB >= 1 && after.aim;
    check(`${tag} FV-04 教學場：玩家出手前 AI 出刀 0 次（4 秒、>200 步都沒有預告）；玩家第一次切除後解除，AI 開始預告出刀`, ok, JSON.stringify({ idle: { ...idle, log: idle.log.slice(-3) }, after: { ...after, log: after.log.slice(-4) } }));
    await ctx.close();
  }
  // ===== B 前線推進（畫面）：切下 → push +1、前線帶往對方移動、閃己方色 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 5000 });
    const avgY = () => page.evaluate(() => { const e = window.__cb.frontEdge.filter(Number.isFinite); return e.reduce((a, b) => a + b, 0) / e.length; });
    const y0 = await avgY();
    const plan = await page.evaluate(PLAN), c0 = await page.evaluate(() => window.__cb.clock);
    // 每一幀記錄前線帶平均 y、push、幀間隔（驗 300ms 推進動畫：中間要有過渡幀、而且不卡幀；審查 H1／L5）
    await page.evaluate(() => { window.__frontRec = []; let last = performance.now(); const f = (t) => { const e = window.__cb.frontEdge.filter(Number.isFinite); window.__frontRec.push({ t, dt: t - last, push: window.__cb.push, y: e.reduce((a, b) => a + b, 0) / e.length }); last = t; if (window.__frontRec.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.evaluate((e) => window.__cb.feed(e), evs(plan.S, plan.E, c0 + 150));
    await page.waitForFunction(() => window.__cb.push !== 0, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(450);
    const r = await page.evaluate(() => ({ push: window.__cb.push, front: window.__cb.fxLog.filter((x) => x.t === 'front') }));
    const y1 = await avgY();
    const rec = await page.evaluate(() => window.__frontRec), i0 = rec.findIndex((x) => x.push === 1);
    const win = i0 >= 0 ? rec.filter((x) => x.t >= rec[i0].t - 20 && x.t <= rec[i0].t + 320) : [];
    const mid = win.filter((x) => x.y < y0 - 2 && x.y > y1 + 2).length, maxDt = win.length ? Math.max(...win.map((x) => x.dt)) : 999;
    await page.screenshot({ path: `${shotDir}/front_push1_393x852.png` });
    check(`${tag} B 前線帶：切下對方器官 → push +1、前線帶平均往對方（上方）移 >20、300ms 動畫有過渡幀且幀間隔 <100ms、有「閃己方色」事件（藍）`, r.push === 1 && y0 - y1 > 20 && mid >= 2 && maxDt < 100 && r.front.length === 1 && r.front[0].side === 'blue', JSON.stringify({ ...r, y0: Math.round(y0), y1: Math.round(y1), midFrames: mid, maxDt: Math.round(maxDt) }));
    await ctx.close();
  }
  // ===== C 範圍顯示（直線預覽，DL-087 選 A：調暗只在直線預覽）：按住時，範圍外的對方器官透明度 ≤ 範圍內的 50%；加亮集合＝範圍內（同一個判定函式）；放開後恢復 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setInput('line'); });
    let got = null;
    for (let seed = 1; seed <= 80 && !got; seed++) {
      await page.evaluate((sd) => { window.__cb.newRun({ seed: sd }); window.__cb.advance(1); }, seed);
      got = await page.evaluate(() => { const g = window.__cb.game, r = window.__cb.inRange, red = g.organs.map((o, i) => i).filter((i) => g.organs[i].side === 'red' && g.alive[i]); const out = red.filter((i) => !r[i]); return out.length && red.length > out.length ? { seed: g.seed, out: out.map((i) => g.organs[i].id), inn: red.filter((i) => r[i]).map((i) => g.organs[i].id) } : null; });
    }
    let res = null;
    if (got) {
      const S = await page.evaluate(() => { const g = window.__cb.game, body = g.mode.body.blue, R = window.__cb.R; const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; }; for (let y = 900; y > 500; y -= 10) for (let x = 100; x < 600; x += 10) if (inside([x, y], body) && !g.organs.some((q, j) => g.alive[j] && Math.hypot(q.p[0] - x, q.p[1] - y) < R + 8)) return [x, y]; return null; });
      const A = await scr(page, S);
      // 像素：器官所在方框的平均亮度（按住前／按住中）——畫面真的變暗，不只是掛勾回報的數字
      const boxOf = async (id) => { const p = await page.evaluate((x) => window.__cb.game.organs.find((o) => o.id === x).p, id), c = await scr(page, p), e = await scr(page, [p[0] + 34, p[1]]), r = e.x - c.x; return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }; };
      await frames(page, 3);
      const outB = await boxOf(got.out[0]), inB = await boxOf(got.inn[0]), out0 = await regionLum(page, outB), in0 = await regionLum(page, inB);
      await page.mouse.move(A.x, A.y); await page.mouse.down(); await frames(page, 4);
      res = await page.evaluate(() => ({ holding: window.__cb.holding, alpha: window.__cb.drawAlpha, held: window.__cb.held.map((i) => window.__cb.game.organs[i].id) }));
      res.outGain = (await regionLum(page, outB)) / out0; res.inGain = (await regionLum(page, inB)) / in0;
      await page.screenshot({ path: `${shotDir}/range_hold_393x852.png` });
      await page.mouse.up(); await frames(page, 3);
      res.after = await page.evaluate(() => ({ holding: window.__cb.holding, alpha: window.__cb.drawAlpha }));
    }
    const ok = !!got && !!res && res.holding && got.out.every((id) => res.alpha[id] <= 0.5 * Math.min(...got.inn.map((x) => res.alpha[x]))) && got.inn.every((id) => res.alpha[id] === 1)
      && JSON.stringify([...res.held].sort()) === JSON.stringify([...got.inn].sort()) && !res.after.holding && Object.values(res.after.alpha).every((a) => a === 1)
      && res.outGain < 0.85 && res.inGain >= 1;   // 方框含背景像素：透明度 0.4 約降到 0.77；未調暗約 1.00（修正前的錯誤狀態實測 1.01）
    check(`${tag} C 範圍顯示（直線預覽）：按住時範圍外的對方器官透明度 ≤ 範圍內的 50% 且像素亮度 <0.85 倍、範圍內不變暗、加亮集合＝範圍內集合；放開後全部恢復`, ok, JSON.stringify({ got, outGain: res?.outGain?.toFixed(3), inGain: res?.inGain?.toFixed(3), alpha: res && Object.fromEntries(Object.entries(res.alpha).filter(([k]) => k.startsWith('紅'))), held: res?.held }));
    await ctx.close();
  }
  // ===== FV-06 回饋：玩家切除＝裂開＋hit-stop，沒有整隻閃白；被切＝紅色事件在該器官位置；再生＝倒數圈＋長出 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 5 }); window.__cb.advance(2); });
    const plan = await page.evaluate(PLAN);
    const k0 = await page.evaluate(() => window.__cb.game.step);
    await page.evaluate(([e]) => window.__cb.feed(e), [evs(plan.S, plan.E, (k0 + 2) * (1000 / 60))]);
    await page.evaluate(() => window.__cb.advance(12)); await frames(page, 3);
    const mine = await page.evaluate(() => window.__cb.fxLog);
    // AI 出刀：推進到 AI 切下一個藍方器官為止
    let foe = null;
    for (let i = 0; i < 40 && !foe; i++) { await page.evaluate(() => window.__cb.advance(30)); await frames(page, 1); foe = await page.evaluate(() => { const l = window.__cb.fxLog; return l.some((x) => x.t === 'split' && x.side === 'blue') ? l : null; }); }
    // 再生：推進到下一拍之前畫幾幀（倒數圈），再推過節拍（長出）
    for (let i = 0; i < 30; i++) { await page.evaluate(() => window.__cb.advance(20)); await frames(page, 2); if (await page.evaluate(() => window.__cb.fxLog.some((x) => x.t === 'grow'))) break; }
    const regen = await page.evaluate(() => window.__cb.fxLog.filter((x) => x.t === 'regenRing' || x.t === 'grow'));
    const mySplit = mine.find((x) => x.t === 'split' && x.side === 'red');
    const foeSplit = foe && foe.find((x) => x.t === 'split' && x.side === 'blue'), foeRed = foe && foe.find((x) => x.t === 'redHit' && x.id === foeSplit?.id);
    const ok = !!mySplit && mySplit.flash === false && mine.some((x) => x.t === 'hitstop') && !mine.some((x) => x.t === 'redHit' && x.side === 'red')
      && !!foeSplit && !!foeRed && regen.some((x) => x.t === 'regenRing') && regen.some((x) => x.t === 'grow');
    check(`${tag} FV-06 回饋事件：玩家切除→裂開＋hit-stop、沒有整隻閃白；AI 切除→被切器官位置的紅色事件；再生→倒數圈＋長出`, ok, JSON.stringify({ mySplit, hit: mine.filter((x) => x.t === 'hitstop').length, foeSplit, foeRed, regen: regen.map((x) => `${x.t}:${x.side}`) }));
    await ctx.close();
  }
  // ===== 回歸（慢幀當掉）：4 倍 CPU 節流下 AI 切下藍方器官（被切紅光／長出動畫的進度可能為負）後，遊戲迴圈照常前進、沒有頁面錯誤（Chromium；WebKit 沒有節流 API） =====
  if (bname === 'chromium') {
    const { ctx, page } = await open();
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => window.__cb.newRun({ seed: 11 }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.waitForFunction(() => window.__cb.game.severedN.red > 0 || window.__cb.ui !== 'cut', null, { timeout: 30000 }).catch(() => {});
    const a = await page.evaluate(() => ({ step: window.__cb.game.step, sev: window.__cb.game.severedN.red, red: window.__cb.fxLog.filter((x) => x.t === 'redHit').length }));
    await page.waitForTimeout(2500);
    const b = await page.evaluate(() => ({ step: window.__cb.game.step, ui: window.__cb.ui }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach();
    check(`${tag} 回歸（慢幀當掉）：4 倍節流下 AI 切下藍方器官、紅光演出之後，2.5 秒內規則步繼續前進、沒有頁面錯誤`, a.sev > 0 && a.red > 0 && (b.step - a.step > 30 || b.ui !== 'cut') && page.__errs.length === 0, JSON.stringify({ a, b, errs: page.__errs }));
    await ctx.close();
  }
  // ===== FV-06 決定性：同一份輸入序列，演出開／關，規則結果（含 push）逐步相同；且受測行為真的發生（有切除、push 有變） =====
  {
    const sigs = [];
    for (const fxOn of [true, false]) {
      const { ctx, page } = await open();
      await page.evaluate((v) => { window.__cb.setManual(true); window.__cb.setFx(v); window.__cb.newRun({ seed: 11 }); }, fxOn);
      const plan = await page.evaluate(PLAN);
      await page.evaluate((e) => window.__cb.feed(e), [...evs(plan.S, plan.E, 500), ...evs(plan.S, [plan.S[0] + 200, plan.S[1]], 2600)]);
      for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__cb.advance(15)); await frames(page, 1); }
      sigs.push(await page.evaluate(() => ({ sig: window.__cb.stepSig, log: window.__cb.fxLog.map((x) => x.t) })));
      await ctx.close();
    }
    const same = JSON.stringify(sigs[0].sig) === JSON.stringify(sigs[1].sig) && sigs[0].sig.length >= 590;
    const live = sigs[0].sig.some((x) => x.endsWith('|1')) && sigs[0].log.includes('hitstop') && !sigs[1].log.includes('hitstop');
    check(`${tag} FV-06 決定性：同一輸入、演出開／關，600 步規則結果（含 push）逐步相同；有切除且 push 變成 1；只有開演出時有 hit-stop`, same && live, JSON.stringify({ n: sigs.map((x) => x.sig.length), pushSeen: sigs[0].sig.filter((x) => x.endsWith('|1')).length, hs: sigs.map((x) => x.log.filter((t) => t === 'hitstop').length) }));
  }
  // ===== FV-05 縫合（只用觸控）＋FV-06 結果字一次一個：打完一場 → 貢獻表 → 挑縫合 → 槽位＝規則清單 → 點槽位 40 內吸附放上 → 展示 ≥1.5 秒 → 「下一位對手」→ 倒數 =====
  {
    const { ctx, page } = await open();
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setInput('line'); window.__cb.setTimings({ battleScale: 0.05 }); });
    let seed = 0, ui = null, resultMax = 0;
    for (seed = 1; seed <= 12; seed++) {
      await page.evaluate((sd) => { window.__cb.newRun({ seed: sd }); window.__cb.resetResultMax(); }, seed);
      // 貪婪刀：每次冷卻好就用規則預覽挑一條會切的直線（只為了贏一場進縫合）
      for (let g = 0; g < 400; g++) {
        const s = await page.evaluate(() => ({ ui: window.__cb.ui, step: window.__cb.game.step, cd: window.__cb.game.cdUntil.blue }));
        if (s.ui !== 'cut') break;
        if (s.cd <= s.step) { const p = await page.evaluate(PLAN); if (p) { const A = await scr(page, p.S), B = await scr(page, [p.S[0] + (p.E[0] - p.S[0]) * 1.2, p.S[1] + (p.E[1] - p.S[1]) * 1.2]); await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.up(); } }
        await page.evaluate(() => window.__cb.advance(30));
      }
      await page.waitForFunction(() => window.__cb.ui === 'contrib', null, { timeout: 40000 });
      await frames(page, 3);
      await page.click('#contribNext');
      ui = await page.evaluate(() => window.__cb.ui);
      if (ui === 'pick') break;
    }
    resultMax = await page.evaluate(() => window.__cb.resultMax);
    const bad = [];
    if (ui !== 'pick') bad.push(`12 個種子都沒贏到縫合（${ui}）`);
    else {
      const bannerAtPick = await page.evaluate(() => ({ tip: window.__cb.tip, tut: !document.getElementById('tut').hidden }));
      if (bannerAtPick.tip || bannerAtPick.tut) bad.push(`進縫合時還有橫幅 ${JSON.stringify(bannerAtPick)}`);
      await page.click('#pick0');
      await frames(page, 3);
      const st = await page.evaluate(() => ({ slots: window.__cb.slots, rule: window.__cb.ruleSlots, camp: window.__cb.campOrgans, centers: Object.keys(window.__cb.spriteCenters), n: window.__cb.camp.stitches.length }));
      await page.screenshot({ path: `${shotDir}/stitch_slots_393x852.png` });
      if (!st.slots.length || JSON.stringify(st.slots) !== JSON.stringify(st.rule)) bad.push(`畫出的槽位 ${st.slots.length} ≠ 規則槽位 ${st.rule.length}`);
      if (!st.camp.every((o) => st.centers.includes(o.id))) bad.push('縫合時沒畫出自己身上原有的器官');
      // 40 外：找一個離所有槽位 >60、在獸身範圍內的點，觸控點擊 → 不放
      const far = await page.evaluate((sl) => { for (let y = 950; y > 450; y -= 10) for (let x = 60; x < 640; x += 10) if (sl.every((q) => Math.hypot(q[0] - x, q[1] - y) > 60)) return [x, y]; return null; }, st.slots);
      if (far) { await touch(page, far); await frames(page, 2); if ((await page.evaluate(() => window.__cb.camp.stitches.length)) !== st.n) bad.push(`點在槽位 40 外也放上了（${far}）`); }
      // 40 內：點在槽位旁 25 單位 → 吸附到該槽位
      const target = st.slots[0], tapAt = [target[0] + 25, target[1]];
      const t0 = Date.now();
      await touch(page, tapAt);
      await frames(page, 2);
      const af = await page.evaluate(() => ({ ui: window.__cb.ui, st: window.__cb.camp.stitches.at(-1), next: window.__cb.nextFoe, step: window.__cb.game.step }));
      if (af.ui !== 'showcase' || !af.st || af.st === undefined || (st.n + 1 !== (await page.evaluate(() => window.__cb.camp.stitches.length))) || Math.hypot(af.st.p[0] - tapAt[0], af.st.p[1] - tapAt[1]) > 40) bad.push(`點槽位旁沒吸附放上：${JSON.stringify(af)}`);
      if (af.st && !st.rule.some((q) => q[0] === af.st.p[0] && q[1] === af.st.p[1])) bad.push(`放上的位置 ${af.st.p} 不是槽位`);
      if (af.next) bad.push('放上後立刻出現「下一位對手」');
      await page.evaluate(() => window.__cb.setManual(false));   // 即時模式下驗「展示期間模擬不跑」（審查 L1：manual 模式下恆真）
      await page.waitForFunction(() => window.__cb.nextFoe, null, { timeout: 4000 }).catch(() => {});
      const shown = Date.now() - t0, mid = await page.evaluate(() => ({ ui: window.__cb.ui, step: window.__cb.game.step, next: window.__cb.nextFoe }));
      await page.screenshot({ path: `${shotDir}/showcase_393x852.png` });
      if (!mid.next || shown < 1400) bad.push(`展示 ${shown}ms 後才出現「下一位對手」（應 ≥1.5 秒）：${JSON.stringify(mid)}`);
      if (mid.step !== af.step || mid.ui !== 'showcase') bad.push(`展示期間模擬有前進：${af.step}→${mid.step}`);
      await page.waitForTimeout(800);
      if ((await page.evaluate(() => window.__cb.ui)) !== 'showcase') bad.push('沒按「下一位對手」就開始下一場');
      const box = await page.locator('#nextFoe').boundingBox();
      if (!box) bad.push('「下一位對手」按鈕沒有出現');
      else {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await frames(page, 2);
        const go = await page.evaluate(() => ({ ui: window.__cb.ui, cd: window.__cb.countdown, stage: window.__cb.camp.stage, step: window.__cb.game.step }));
        if (go.ui !== 'cut' || !(go.cd > 0) || go.stage !== 1 || go.step !== 0) bad.push(`按「下一位對手」後沒進入倒數：${JSON.stringify(go)}`);
      }
    }
    if (resultMax > 1) bad.push(`同時出現 ${resultMax} 個結果字`);
    check(`${tag} FV-05 縫合（只用觸控）：槽位＝規則清單逐點相同、原有器官顯示、40 外拒絕、40 內吸附放上、展示 ≥1.5 秒才出現「下一位對手」且期間不前進、按下才倒數；FV-06 結果字同時最多 1 個、進縫合前清掉橫幅`, bad.length === 0, `種子 ${seed}｜結果字最大 ${resultMax}｜${bad.join('；')}`);
    check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
}
