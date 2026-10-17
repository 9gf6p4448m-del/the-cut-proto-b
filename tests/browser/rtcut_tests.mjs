// 即時亂切（rt-cut/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut docs/rt-cut/ACCEPTANCE_FROZEN.md RT-03、06（畫面）、07、08 與子路徑 PWA。判定讀 window.__rt；挑線用規則模組在測試端算。
import { newPage } from './exp_tests.mjs';
import { ORGANS, entryDist, clampLine } from '../../src/rtcut/rules.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
async function scr(page, p) { return page.evaluate(([x, y]) => window.__rt.toScreen(x, y), p); }
async function drag(page, a, b) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 5, A.y + ((B.y - A.y) * k) / 5);
  await page.mouse.up();
}
/** 元素邊界框完全在視窗內，且中心點 elementFromPoint 抽中自己或子元素（補述 1）。 */
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return `${s} 不存在`;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return `${s} 大小為 0`;
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return `${s} 超出視窗 ${JSON.stringify([r.left, r.top, r.right, r.bottom])}`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || !(hit === el || el.contains(hit))) return `${s} 中心被 ${hit && (hit.id || hit.className || hit.tagName)} 蓋住`;
  return '';
}, sel);
const big = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width >= 44 && r.height >= 44 ? '' : `${s} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`; }, sel);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
const toEnd = async (page) => { await page.evaluate(() => window.__rt.advance(3000)); await page.waitForFunction(() => window.__rt.ui === 'end', null, { timeout: 15000 }); };

export async function runRtCutTests({ bname, btype, devices, url, check }) {
  const browser = await btype.launch();
  const tag = `[${bname}][rt]`;
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  const bad4xx = []; page.on('response', (r) => { if (r.status() >= 400) bad4xx.push(`${r.status()} ${r.url()}`); });
  await page.goto(url + '/rt-cut/');
  await page.waitForFunction(() => !!window.__rt);
  await page.evaluate(() => { let n = 5000; window.__rt.setSeedSource(() => ++n); }); // 注入固定種子來源：每次重開回傳 5001、5002…
  await page.evaluate(() => window.__rt.restart());
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} 版本 SHA 與「研究片段」字樣`, top.includes(sha) && top.includes('研究片段') && sha && !sha.includes('__'), sha);

  // ===== RT-03 AI 預告：每一刀生效前瞄準線在畫面上 ≥0.5 秒；預告期間鎖住刀線上第一個藍器官 → 那刀不切除 =====
  {
    await page.waitForFunction(() => window.__rt.aimVis.filter((v) => v.fired !== null).length >= 4, null, { timeout: 20000 });
    const vis = await page.evaluate(() => window.__rt.aimVis.filter((v) => v.fired !== null));
    const durs = vis.map((v) => (v.firstDraw >= 0 ? v.fired - v.firstDraw : -1));
    const fires = await page.evaluate(() => window.__rt.events.filter((e) => e.e.t === 'strike' && e.e.r.side === 'red').length);
    check(`${tag} RT-03 AI 每一刀生效前預告 ≥500ms（實測最短 ${Math.min(...durs).toFixed(0)}ms，共 ${durs.length} 刀）`, durs.length >= 4 && durs.every((d) => d >= 500) && fires === vis.length, `durs=${durs.map((d) => d.toFixed(0)).join(',')} redStrikes=${fires}`);
    // 後半：找一個預告，其刀線上第一個會碰到的器官是藍方存活器官 → 趁預告去鎖
    let done = null;
    for (let tries = 0; tries < 12 && !done; tries++) {
      await page.evaluate(() => window.__rt.restart());
      await page.waitForFunction(() => { const s = window.__rt.state; return !!s.aim && s.aim.fireStep - s.step >= 28 && s.cdUntil.blue <= s.step; }, null, { timeout: 20000 });
      const st = await page.evaluate(() => window.__rt.state);
      const l = clampLine(st.aim.line);
      const hits = ORGANS.map((o, i) => ({ i, o, t: st.alive[i] ? entryDist(l.a, l.b, o.p) : null })).filter((h) => h.t !== null).sort((a, b) => a.t - b.t || a.i - b.i);
      const firstEnemy = hits.find((h) => h.o.side === 'blue');
      if (!firstEnemy) continue;
      const p = firstEnemy.o.p;
      await drag(page, p, [p[0], Math.min(970, p[1] + 160)]); // 由該器官中心往下 160：起點在藍身，先穿過它 → 鎖
      const fireStep = st.aim.fireStep, aimStep = st.aim.aimStep;
      await page.waitForFunction((f) => window.__rt.state.step > f, fireStep, { timeout: 10000 });
      const res = await page.evaluate(([f, i]) => {
        const ev = window.__rt.events.filter((e) => e.e.t === 'strike');
        const red = ev.find((e) => e.e.r.side === 'red' && e.step === f + 1), blue = ev.filter((e) => e.e.r.side === 'blue').at(-1);
        return { red: red && red.e.r, blueLocked: !!blue && blue.e.r.locks.includes(i), blueStep: blue && blue.step, alive: window.__rt.state.alive[i] };
      }, [fireStep, firstEnemy.i]);
      done = { ...res, organ: firstEnemy.o.id, aimStep, fireStep };
    }
    const ok = done && done.blueLocked && done.blueStep <= done.fireStep && done.red && done.red.severed === null && done.red.blocked !== null && done.alive;
    check(`${tag} RT-03 預告期間鎖住目標 → AI 那一刀不切除（被擋）`, ok, JSON.stringify(done && { organ: done.organ, blueStep: done.blueStep, fire: done.fireStep, severed: done.red && done.red.severed, blocked: done.red && done.red.blocked }));
  }

  // ===== RT-08 手機版面（兩種尺寸、遊戲中與結果畫面） =====
  for (const [nm, [w, h]] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => window.__rt.restart());
    await page.waitForTimeout(200);
    const errs = [];
    for (const s of ['#scene', '#timer', '#cdMe', '#cdFoe', '#cdMeTxt', '#cdFoeTxt', '#cntMe', '#cntFoe', '#restart', '#reduce']) { const e = await visible(page, s); if (e) errs.push(e); }
    for (const s of ['#restart', '#reduce']) { const e = await big(page, s); if (e) errs.push(e); }
    if (!(await noHScroll(page))) errs.push('遊戲中有水平捲動');
    await toEnd(page);
    for (const s of ['#resTitle', '#resTable', '#resRestart', '#restart']) { const e = await visible(page, s); if (e) errs.push(`結果：${e}`); }
    for (const s of ['#resRestart', '#restart']) { const e = await big(page, s); if (e) errs.push(`結果：${e}`); }
    if (!(await noHScroll(page))) errs.push('結果畫面有水平捲動');
    check(`${tag} RT-08 ${nm} ${w}×${h}：畫布、計時、冷卻、結果完整可見，按鈕 ≥44px，無水平捲動`, errs.length === 0, errs.join('；'));
  }
  await page.setViewportSize({ width: SIZES.iPhone14Pro[0], height: SIZES.iPhone14Pro[1] });

  // ===== RT-06 畫面：40 秒後不能再出刀；結果畫面寫出雙方剩餘爪、心、戰力與勝負 =====
  {
    await page.evaluate(() => window.__rt.restart());
    await page.evaluate(() => window.__rt.advance(2399)); // 停在第 2399 步
    await page.waitForTimeout(100);
    const n0 = await page.evaluate(() => window.__rt.events.filter((e) => e.e.t === 'strike' && e.e.r.side === 'blue').length);
    await page.waitForFunction(() => window.__rt.ui !== 'cut', null, { timeout: 5000 });
    await drag(page, [60, 500], [400, 500]); // 時間到之後拖曳
    await page.waitForTimeout(150);
    const n1 = await page.evaluate(() => window.__rt.events.filter((e) => e.e.t === 'strike' && e.e.r.side === 'blue').length);
    await page.waitForFunction(() => window.__rt.ui === 'end', null, { timeout: 15000 });
    const r = await page.evaluate(() => window.__rt.result);
    const cells = await page.$$eval('#resTable tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
    const title = await page.textContent('#resTitle');
    const want = [['', '你', '牠'], ['剩餘爪', `${r.claws.blue}`, `${r.claws.red}`], ['剩餘心', `${r.hearts.blue}`, `${r.hearts.red}`], ['戰力', `${r.power.blue}`, `${r.power.red}`]];
    const pw = (c, h) => 2 * c * (1 + h);
    const okPw = r.power.blue === pw(r.claws.blue, r.hearts.blue) && r.power.red === pw(r.claws.red, r.hearts.red);
    const wantTitle = r.power.blue > r.power.red ? '你贏了' : r.power.red > r.power.blue ? '你輸了' : '平手';
    check(`${tag} RT-06 時間到後不能出刀；結果畫面顯示雙方剩餘爪、心、戰力與勝負`, n1 === n0 && okPw && title === wantTitle && JSON.stringify(cells.slice(0, 4)) === JSON.stringify(want), `blueStrikes ${n0}→${n1} title=${title} cells=${JSON.stringify(cells.slice(0, 4))}`);
    const duelMs = await page.evaluate(() => window.__rt.DUEL_MS);
    check(`${tag} RT-06 對決演出 ≤12 秒（${duelMs}ms）`, duelMs <= 12000);
  }

  // ===== RT-07 重開：亂切中、對決演出中、結果畫面三個階段 =====
  {
    const bad = [];
    const clean = async (label, prevSeed) => {
      const s = await page.evaluate(() => ({ ...window.__rt.state, ui: window.__rt.ui, timer: document.getElementById('timer').textContent, hidden: document.getElementById('result').hidden, aimVis: window.__rt.aimVis.length }));
      if (s.ui !== 'cut' || !s.hidden) bad.push(`${label}：ui=${s.ui} 結果畫面 hidden=${s.hidden}`);
      if (s.step > 30) bad.push(`${label}：step=${s.step}`);
      if (s.timer !== '40.0' && !s.timer.startsWith('39.')) bad.push(`${label}：計時 ${s.timer}`);
      if (!s.alive.every(Boolean)) bad.push(`${label}：器官沒全回`);
      if (!s.lockUntil.every((v) => v === 0)) bad.push(`${label}：鎖沒清`);
      if (s.cdUntil.blue !== 0 || s.cdUntil.red !== 0) bad.push(`${label}：冷卻沒清 ${JSON.stringify(s.cdUntil)}`);
      // AI 預告：新局第一個預告在第 24 步才出現（第 60 步生效）；舊局預告不得殘留（對抗式檢查 F2）
      if (s.aim !== null && s.aim.aimStep !== 24) bad.push(`${label}：殘留舊預告 ${JSON.stringify(s.aim)}`);
      if (s.aimVis > 1) bad.push(`${label}：預告紀錄沒清 ${s.aimVis}`);
      if (s.seed === prevSeed) bad.push(`${label}：種子沒換`);
      return s.seed;
    };
    // 亂切中：先出一刀（鎖＋切＋冷卻）
    await page.evaluate(() => window.__rt.restart());
    await page.waitForTimeout(300);
    await drag(page, [60, 500], [400, 500]);
    await page.waitForFunction(() => window.__rt.state.cdUntil.blue > window.__rt.state.step && window.__rt.state.lockUntil.some((v) => v > 0), null, { timeout: 5000 });
    // 等到舊局紅方也在冷卻中、且有預告進行中，再按重開
    await page.waitForFunction(() => { const s = window.__rt.state; return s.cdUntil.red > s.step && !!s.aim; }, null, { timeout: 10000 });
    let seed = await page.evaluate(() => window.__rt.state.seed);
    await page.click('#restart');
    await page.waitForTimeout(50);
    seed = await clean('亂切中', seed);
    // 對決演出中重開：舊局的結果計時器不得寫入新局
    await page.evaluate(() => window.__rt.restart());
    await page.evaluate(() => window.__rt.advance(2400));
    await page.waitForFunction(() => window.__rt.ui === 'duel', null, { timeout: 5000 });
    seed = await page.evaluate(() => window.__rt.state.seed);
    await page.click('#restart');
    seed = await clean('對決演出中', seed);
    const duelMs = await page.evaluate(() => window.__rt.DUEL_MS);
    await page.waitForTimeout(duelMs + 600);
    const after = await page.evaluate(() => ({ ui: window.__rt.ui, hidden: document.getElementById('result').hidden, result: window.__rt.result }));
    if (after.ui !== 'cut' || !after.hidden || after.result !== null) bad.push(`舊局計時器寫入新局：${JSON.stringify(after)}`);
    // 結果畫面：底部重開與「再來一局」都可
    await toEnd(page);
    seed = await page.evaluate(() => window.__rt.state.seed);
    await page.click('#resRestart');
    seed = await clean('結果畫面（再來一局）', seed);
    await toEnd(page);
    await page.click('#restart');
    await clean('結果畫面（底部重開）', seed);
    check(`${tag} RT-07 任何階段重開：計時歸 40、器官全回、鎖與冷卻清空、新種子；舊局計時器不寫入新局`, bad.length === 0, bad.join('；'));
  }

  // ===== 補述 1 計時：分頁切到背景就暫停（對抗式檢查 F3；以覆寫 document.hidden＋visibilitychange 模擬，不是真的切背景） =====
  {
    await page.evaluate(() => window.__rt.restart());
    await page.waitForTimeout(300);
    const s0 = await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); return window.__rt.state.step; });
    await page.waitForTimeout(1500);
    const s1 = await page.evaluate(() => window.__rt.state.step);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(500);
    const s2 = await page.evaluate(() => window.__rt.state.step);
    check(`${tag} 補述 1 背景分頁暫停：隱藏 1.5 秒步數不動、恢復後不補跑累積時間`, s1 === s0 && s2 > s1 && s2 - s1 <= 45, `step ${s0}→${s1}（隱藏）→${s2}（恢復 0.5 秒）`);
  }

  // ===== 子路徑 PWA（RT-09 建置隔離的瀏覽器部分） =====
  if (bname === 'chromium') {
    const man = await page.evaluate(async () => { const r = await fetch('./manifest.webmanifest'); return r.json(); });
    const scope = await page.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
    const keys = await page.evaluate(() => caches.keys());
    check(`${tag} RT-09 manifest id＝rt-cut、SW scope＝/rt-cut/、快取前綴 thecut-rtcut-`, man.id === 'rt-cut' && scope.endsWith('/rt-cut/') && keys.length > 0 && keys.every((k) => !k.startsWith('thecut-') || k.startsWith('thecut-rtcut-')), `id=${man.id} scope=${scope} keys=${keys.join(',')}`);
  }
  check(`${tag} 無頁面錯誤、無 4xx/5xx`, page.__errs.length === 0 && bad4xx.length === 0, [...page.__errs, ...bad4xx].join(' | '));
  await ctx.close();
  await browser.close();
}
