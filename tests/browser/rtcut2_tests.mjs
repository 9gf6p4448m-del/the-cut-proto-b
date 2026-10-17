// 即時亂切 v2（rt-cut2/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut docs/rt-cut2/ACCEPTANCE_FROZEN.md R2-05、06、07（瀏覽器部分）。判定讀 window.__rt；testSever 只用來佈局，擊倒一律由真實拖曳觸發。
import { newPage } from './exp_tests.mjs';
import { ORGANS } from '../../src/rtcut/rules.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const idx = (id) => ORGANS.findIndex((o) => o.id === id);
const RED = ORGANS.map((o, i) => (o.side === 'red' ? i : -1)).filter((i) => i >= 0), BLUE = ORGANS.map((o, i) => (o.side === 'blue' ? i : -1)).filter((i) => i >= 0);
const TIME_SEED = 9001; // 玩家不出刀時以「時間到」結束的種子（node 端 runMatch(9001, [], [], MODE_RT2) 驗得 time@2400）
async function scr(page, p) { return page.evaluate(([x, y]) => window.__rt.toScreen(x, y), p); }
async function drag(page, a, b) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 5, A.y + ((B.y - A.y) * k) / 5);
  await page.mouse.up();
}
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return `${s} 不存在`;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return `${s} 大小為 0`;
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return `${s} 超出視窗`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || !(hit === el || el.contains(hit))) return `${s} 中心被 ${hit && (hit.id || hit.className || hit.tagName)} 蓋住`;
  return '';
}, sel);
const big = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width >= 44 && r.height >= 44 ? '' : `${s} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`; }, sel);
const rows = (page) => page.$$eval('#resTable tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
const restartWith = (page, seed) => page.evaluate((sd) => { window.__rt.setSeedSource(() => sd); window.__rt.restart(); }, seed);
/** 直接推進到第 n 步（測試掛鉤，無玩家輸入）。 */
const advanceTo = (page, n) => page.evaluate((k) => window.__rt.advance(k - window.__rt.state.step), n);

export async function runRtCut2Tests({ bname, btype, devices, url, check }) {
  const browser = await btype.launch();
  const tag = `[${bname}][rt2]`;
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  const bad4xx = []; page.on('response', (r) => { if (r.status() >= 400) bad4xx.push(`${r.status()} ${r.url()}`); });
  await page.goto(url + '/rt-cut2/');
  await page.waitForFunction(() => !!window.__rt);
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} 版本 SHA、「研究片段」與 v2 字樣、建置模式＝rt2`, top.includes(sha) && top.includes('研究片段') && top.includes('v2') && (await page.evaluate(() => window.__rt.RT2)) === true, sha);

  // ===== R2-06 擊倒勝：佈局只留紅爪3，真實拖曳橫刀切掉它 → 擊倒演出 ≤3 秒 → 結果 =====
  {
    let ko = null;
    for (let tries = 0; tries < 6 && !ko; tries++) {
      await restartWith(page, 7000 + tries);
      await page.waitForTimeout(120);
      await page.evaluate((ids) => window.__rt.testSever(ids), RED.filter((i) => i !== idx('紅爪3')));
      await page.waitForFunction((y) => { const s = window.__rt.state; return s.cdUntil.blue <= s.step && s.lockUntil[y] <= s.step; }, idx('紅爪3'), { timeout: 5000 });
      await drag(page, [60, 500], [400, 500]);
      try { await page.waitForFunction(() => window.__rt.ui === 'ko', null, { timeout: 2000 }); ko = await page.evaluate(() => ({ end: window.__rt.state.end, t: performance.now(), n: window.__rt.events.filter((e) => e.e.t === 'strike').length, all: window.__rt.events.length })); } catch { /* 被擋或被 AI 鎖住：重來 */ }
      // 擊倒演出期間真實拖曳一刀：不得出刀。註：這是煙霧測試——擊倒後不收刀由 rules.ts step() 的 phase 早退結構保證（Node R2-01 驗），
      // 本斷言對 UI 層守門（ui==='cut'）沒有鑑別力（第 3 輪覆審 L3：拿掉 UI 守門仍綠），不作為 UI 守門的證據。
      if (ko) { await drag(page, [100, 560], [100, 420]); ko.n2 = await page.evaluate(() => window.__rt.events.filter((e) => e.e.t === 'strike').length); ko.all2 = await page.evaluate(() => window.__rt.events.length); } // all／all2 連被拒事件一起算：擊倒後輸入不得再進入規則步（覆審 L3）
    }
    await page.waitForFunction(() => window.__rt.ui === 'end', null, { timeout: 6000 });
    const koMs = (await page.evaluate(() => performance.now())) - (ko ? ko.t : 0);
    const r = await rows(page), title = await page.textContent('#resTitle');
    const endRow = r.find((x) => x[0] === '結束方式'), cutRow = r.find((x) => x[0] === '總切除數');
    const ok = ko && ko.end.by === 'ko' && ko.end.winner === 'blue' && title === '擊倒勝' && endRow && endRow[1] === '擊倒' && cutRow && cutRow[1] === '1' && koMs <= 3300 && ko.n >= 1 && ko.n2 === ko.n && ko.all2 === ko.all;
    check(`${tag} R2-06 擊倒勝：真實拖曳切掉最後一個器官 → 擊倒演出（${Math.round(koMs)}ms，期間拖曳不出刀）→ 結果寫「擊倒勝／結束方式 擊倒／總切除數」`, ok, JSON.stringify({ end: ko && ko.end, title, endRow, cutRow, koMs: Math.round(koMs) }));
    const KO_MS = await page.evaluate(() => window.__rt.KO_MS);
    check(`${tag} R2-01 擊倒演出 ≤3 秒（設定 ${KO_MS}ms）`, KO_MS <= 3000);
  }

  // ===== R2-06 時間到：固定種子、玩家不出刀 → 第 2400 步結算 =====
  {
    await restartWith(page, TIME_SEED);
    await advanceTo(page, 2400);
    await page.waitForFunction(() => window.__rt.ui === 'end', null, { timeout: 15000 });
    const end = await page.evaluate(() => window.__rt.state.end), r = await rows(page);
    const res = await page.evaluate(() => window.__rt.result);
    const want = res.winner === 'draw' ? '平手' : res.winner === 'blue' ? '你贏了' : '你輸了';
    const ok = end.by === 'time' && (await page.textContent('#resTitle')) === want && r.some((x) => x[0] === '結束方式' && x[1] === '時間到') && r.some((x) => x[0] === '戰力' && x[1] === `${res.power.blue}`);
    check(`${tag} R2-06 時間到：照戰力結算，結果寫「結束方式 時間到」`, ok, JSON.stringify({ end, rows: r }));
  }

  // ===== R2-06 重開完全重置（含再生節拍） =====
  {
    await restartWith(page, 7100);
    await page.evaluate((ids) => window.__rt.testSever(ids), [idx('紅爪3'), idx('紅心1')]);
    await advanceTo(page, 320);
    const before = await page.evaluate(() => ({ n: window.__rt.state.organs.length, q: window.__rt.state.severedQ }));
    await page.click('#restart');
    const s = await page.evaluate(() => ({ ...window.__rt.state, ui: window.__rt.ui }));
    const ok = before.n >= 17 && before.q.red.length + before.q.blue.length >= 1 && s.ui === 'cut' && s.organs.length === 16 && s.readyAt.every((v) => v === 0) && s.severedQ.blue.length === 0 && s.severedQ.red.length === 0 && s.severedN.blue === 0 && s.severedN.red === 0 && s.end === null && s.step < 30 && s.alive.every(Boolean);
    // 重開後第 5 秒的再生只能來自新局內被切的器官（舊局佇列不得殘留）：每方長出數 ≤ 新局內該方被切數（且 ≤1）
    await advanceTo(page, 330);
    const after = await page.evaluate(() => { const s = window.__rt.state, cut = { blue: 0, red: 0 }, grown = { blue: 0, red: 0 };
      for (const e of window.__rt.events) if (e.e.t === 'strike' && e.e.r.severed !== null && e.step <= 301) cut[s.organs[e.e.r.severed].side]++;
      s.organs.slice(16).forEach((o) => grown[o.side]++); return { cut, grown }; });
    const okAfter = ['blue', 'red'].every((sd) => after.grown[sd] <= Math.min(1, after.cut[sd]));
    check(`${tag} R2-06 重開：器官表、萌芽、再生佇列、切除數、結束狀態全部重置；新局的再生只來自新局內的切除`, ok && okAfter, JSON.stringify({ before, len: s.organs.length, after }));
  }

  // ===== R2-05 AI 不對空出刀 =====
  {
    const bad = [];
    // (a) 牠（紅）只剩萌芽器官：之後生效的每一刀都要有目標（切除、被擋或鎖住己方）
    await restartWith(page, 7200);
    await advanceTo(page, 299);
    await page.evaluate((ids) => { const s = window.__rt.state; window.__rt.testSever(ids.filter((i) => s.alive[i]).slice(1)); }, RED);
    await advanceTo(page, 301); // 第 300 步長出萌芽
    await page.evaluate(() => { const s = window.__rt.state; const keep = s.organs.map((o, i) => (o.side === 'red' && s.alive[i] && s.step < s.readyAt[i] ? i : -1)).filter((i) => i >= 0); const rest = s.organs.map((o, i) => (o.side === 'red' && s.alive[i] && !keep.includes(i) ? i : -1)).filter((i) => i >= 0); if (keep.length) window.__rt.testSever(rest); });
    const a0 = await page.evaluate(() => ({ step: window.__rt.state.step, onlySprout: window.__rt.state.organs.every((o, i) => o.side !== 'red' || !window.__rt.state.alive[i] || window.__rt.state.step < window.__rt.state.readyAt[i]) }));
    if (!a0.onlySprout) bad.push('(a) 佈局失敗：紅方不是只剩萌芽');
    await page.waitForTimeout(2500);
    const aStr = await page.evaluate((k) => window.__rt.events.filter((e) => e.e.t === 'strike' && e.e.r.side === 'red' && e.step > k).map((e) => e.e.r), a0.step);
    for (const r of aStr) if (r.severed === null && r.blocked === null && r.locks.length === 0) bad.push(`(a) 紅刀無目標 ${JSON.stringify(r.line)}`);
    // (b) 你（藍）只剩萌芽器官：萌芽期內 AI 新的預告不得是攻擊刀
    await restartWith(page, 7300);
    await advanceTo(page, 299);
    await page.evaluate((ids) => { const s = window.__rt.state; window.__rt.testSever(ids.filter((i) => s.alive[i]).slice(1)); }, BLUE);
    await advanceTo(page, 301);
    const b0 = await page.evaluate(() => { const s = window.__rt.state; const keep = s.organs.map((o, i) => (o.side === 'blue' && s.alive[i] && s.step < s.readyAt[i] ? i : -1)).filter((i) => i >= 0); const rest = s.organs.map((o, i) => (o.side === 'blue' && s.alive[i] && !keep.includes(i) ? i : -1)).filter((i) => i >= 0); if (!keep.length) return null; window.__rt.testSever(rest); return { step: s.step, ready: window.__rt.state.readyAt[keep[0]] }; });
    if (!b0) bad.push('(b) 佈局失敗：藍方沒有萌芽器官');
    else {
      await page.waitForFunction((r) => window.__rt.state.step >= r || window.__rt.ui !== 'cut', b0.ready, { timeout: 5000 });
      const aims = await page.evaluate(([k, r]) => window.__rt.aimVis.filter((v) => v.aimStep >= k && v.aimStep < r), [b0.step, b0.ready]);
      const strikes = await page.evaluate((k) => window.__rt.events.filter((e) => e.e.t === 'strike' && e.e.r.side === 'red' && e.step > k).map((e) => ({ step: e.step, r: e.e.r })), b0.step);
      for (const a of aims) { const s = strikes.find((x) => x.step === a.fireStep + 1); if (s && (s.r.severed !== null || s.r.locks.length === 0)) bad.push(`(b) 萌芽期間預告的刀不是保護刀 ${JSON.stringify(s.r)}`); }
    }
    // 註：(b) 視當局預告時刻，萌芽窗內可能沒有新預告（對抗式檢查 H1）；「只出保護刀或不出刀」的鑑別力由 Node rtcut2_rules.test.ts 的 H1 案與突變驗紅負責
    check(`${tag} R2-05 AI 不對空出刀（瀏覽器實測）：(a) 牠只剩萌芽時每刀都有目標；(b) 你只剩萌芽時窗內的預告不是攻擊刀`, bad.length === 0, bad.join('；') + ` (a)紅刀 ${aStr.length} 刀`);
  }

  // ===== R2-07 手機版面 =====
  for (const [nm, [w, h]] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: w, height: h });
    await restartWith(page, TIME_SEED);
    await page.waitForTimeout(200);
    const errs = [];
    for (const s of ['#scene', '#timer', '#cdMe', '#cdFoe', '#cntMe', '#cntFoe', '#restart', '#reduce']) { const e = await visible(page, s); if (e) errs.push(e); }
    for (const s of ['#restart', '#reduce']) { const e = await big(page, s); if (e) errs.push(e); }
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) errs.push('遊戲中有水平捲動');
    await advanceTo(page, 2400);
    await page.waitForFunction(() => window.__rt.ui === 'end', null, { timeout: 15000 });
    for (const s of ['#resTitle', '#resTable', '#resRestart', '#restart']) { const e = await visible(page, s); if (e) errs.push(`結果：${e}`); }
    for (const s of ['#resRestart', '#restart']) { const e = await big(page, s); if (e) errs.push(`結果：${e}`); }
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) errs.push('結果畫面有水平捲動');
    check(`${tag} R2-07 ${nm} ${w}×${h}：畫布、計時、冷卻、結果（含結束方式與切除數）完整可見，按鈕 ≥44px，無水平捲動`, errs.length === 0, errs.join('；'));
  }
  await page.setViewportSize({ width: SIZES.iPhone14Pro[0], height: SIZES.iPhone14Pro[1] });

  if (bname === 'chromium') {
    const man = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    const scope = await page.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
    const keys = await page.evaluate(() => caches.keys());
    check(`${tag} R2-07 manifest id＝rt-cut2、SW scope＝/rt-cut2/、快取前綴 thecut-rtcut2-`, man.id === 'rt-cut2' && scope.endsWith('/rt-cut2/') && keys.length > 0 && keys.every((k) => !k.startsWith('thecut-') || k.startsWith('thecut-rtcut2-')), `id=${man.id} scope=${scope} keys=${keys.join(',')}`);
  }
  // R2-04：同一份 UI 程式碼，rt-cut/ 原版建置仍是原版模式
  {
    const p2 = await ctx.newPage(); await p2.goto(url + '/rt-cut/'); await p2.waitForFunction(() => !!window.__rt);
    const v = await p2.evaluate(() => ({ rt2: window.__rt.RT2, mode: window.__rt.state.mode, top: document.getElementById('top').textContent }));
    check(`${tag} R2-04 rt-cut/ 原版頁面仍是原版模式（無擊倒、無再生）`, v.rt2 === false && !v.mode.knockout && !v.mode.regen && !v.top.includes('v2'), JSON.stringify(v.mode));
    await p2.close();
  }
  check(`${tag} 無頁面錯誤、無 4xx/5xx`, page.__errs.length === 0 && bad4xx.length === 0, [...page.__errs, ...bad4xx].join(' | '));
  await ctx.close();
  await browser.close();
}
