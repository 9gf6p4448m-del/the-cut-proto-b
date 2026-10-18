// 對決 切割→戰鬥（duel/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 或 cb_run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md CB-04～07（瀏覽器部分）。
// 切割期用手動推進（setManual＋advance）以免受真實時間影響；出刀一律用滑鼠真實拖曳，刀線由測試端用規則模組挑（tests/cb_stats.ts 的 greedyLine）。
import { newPage } from './exp_tests.mjs';
import { greedyLine } from '../cb_stats.ts';
import { contributionFromEvents } from '../../src/cutbattle/battle.ts';
import { placeCheck, stitchSlots } from '../../src/cutbattle/campaign.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const C = (page) => page.evaluate(() => { const c = window.__cb; return { ui: c.ui, camp: c.camp, game: c.game, tip: c.tip }; });
async function scr(page, p) { return page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p); }
async function drag(page, a, b) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 6, A.y + ((B.y - A.y) * k) / 6);
  await page.mouse.up();
}
async function tap(page, p) { const A = await scr(page, p); await page.mouse.click(A.x, A.y); }
/** 手動推進打完一場切割期：冷卻好就用貪婪刀（真實拖曳），否則推進到冷卻結束。passive＝不出刀。 */
async function playCut(page, passive = false) {
  for (let guard = 0; guard < 400; guard++) {
    const s = await page.evaluate(() => ({ ui: window.__cb.ui, g: window.__cb.game }));
    if (s.ui !== 'cut') return;
    const g = s.g;
    if (!passive && g.cdUntil.blue <= g.step) {
      const l = greedyLine(g);
      if (l) { await drag(page, l.a, l.b); await page.evaluate(() => window.__cb.advance(1)); continue; }
      await page.evaluate(() => window.__cb.advance(30)); continue;
    }
    await page.evaluate((n) => window.__cb.advance(n), passive ? 300 : Math.max(1, g.cdUntil.blue - g.step));
  }
}
const waitUi = (page, ui, timeout = 40000) => page.waitForFunction((u) => window.__cb.ui === u || (Array.isArray(u) && u.includes(window.__cb.ui)), ui, { timeout });
/** 合法擺放點：本身與周圍 8px 一圈都合法（點擊經過螢幕座標換算會有小誤差，不挑壓邊的點）。 */
function legalSpot(camp) {
  const ok = (x, y) => !placeCheck(camp, [x, y]) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !placeCheck(camp, [x + 8 * Math.cos(i * Math.PI / 4), y + 8 * Math.sin(i * Math.PI / 4)]));
  for (let y = 480; y < 950; y += 10) for (let x = 70; x < 650; x += 10) if (ok(x, y)) return [x, y];
  return null;
}

export async function runCbTests({ bname, btype, devices, url, check, sub = 'duel', ver = 'v0.1 切割→戰鬥', winSeed = 1, init = null }) {   // init：載入前執行的腳本（duel3 DF-03 用來切到直線預覽）
  const browser = await btype.launch();
  const tag = `[${bname}][${sub}]`;
  const d4 = sub === 'duel4' || sub === 'duel5';   // duel4（DUEL_V04_FRONT 三-3／三-7）：縫合改為吸附到槽位（40 外拒絕）、放下後展示新身體再按「下一位對手」
  const ready = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady !== false && !!window.__cb.camp, null, { timeout: 30000 });
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  if (init) await ctx.addInitScript(init);
  await page.goto(url + `/${sub}/`);
  await ready(page);
  await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 0.05 }); });
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} CB-07 版本 SHA、「研究片段」、畫面顯示「${ver}」`, top.includes(sha) && top.includes('研究片段') && (await page.textContent('#ver')) === ver && !sha.includes('__'), sha);

  // ===== CB-04 可讀性：5 種器官都有視覺事件；貢獻表＝事件加總；點器官有說明 =====
  {
    const bad = [];
    await page.evaluate(() => window.__cb.newRun({ seed: 3 }));
    // 點一個器官 → 說明
    const g0 = (await C(page)).game, o = g0.organs.find((x) => x.side === 'red' && x.kind === 'poison');
    await tap(page, o.p);
    const t = (await C(page)).tip;
    if (!t || !t.includes('毒：每 1.5 秒讓對手疊 1 層毒')) bad.push(`點毒的說明＝${t}`);
    const oc = g0.organs.find((x) => x.side === 'blue' && x.kind === 'claw'); await tap(page, oc.p);
    const t2 = (await C(page)).tip; if (!t2 || !t2.includes('爪：每 1 秒攻擊一次，造成 4')) bad.push(`點爪的說明＝${t2}`);
    // 這場刻意不出刀（只讓 AI 切），讓雙方都留有 5 種器官進戰鬥，才能檢查每種器官都有視覺事件
    await playCut(page, true);
    await waitUi(page, 'contrib');
    // 一次性說明：等排隊播完，檢查畫面上真的顯示過的文字（不是只看旗標；覆審 M5）
    await page.waitForFunction(() => ['open', 'kinds', 'claw', 'heart', 'eye', 'poison', 'bone'].every((k) => window.__cb.tipsShown.includes(k)), null, { timeout: 45000 }).catch(() => {});
    const tipLog = await page.evaluate(() => window.__cb.tipLog);
    const wantTip = { open: '切割期 30 秒', kinds: '五種器官', claw: '爪：每 1 秒攻擊一次', heart: '心：血量上限 +30', eye: '眼：我方爪暴擊率', poison: '毒：每 1.5 秒', bone: '骨：開戰提供 15 護盾' };
    for (const [k, txt] of Object.entries(wantTip)) if (!tipLog.some((t) => t.startsWith(txt) || t.includes(txt))) bad.push(`一次性說明 ${k} 沒真的顯示`);
    const r = await page.evaluate(() => ({ vis: window.__cb.vis, battle: window.__cb.battle, rows: [...document.querySelectorAll('#contribBody tr[data-k]')].map((tr) => ({ k: tr.dataset.k, me: Number(tr.querySelector('.me').textContent), foe: Number(tr.querySelector('.foe').textContent) })) }));
    const kinds = new Set(r.vis.map((v) => v.kind));
    for (const k of ['claw', 'heart', 'eye', 'poison', 'bone']) if (!kinds.has(k)) bad.push(`沒有 ${k} 的視覺事件`);
    // 每個模擬事件都有對應的視覺事件（數量）
    const evN = (t) => r.battle.events.filter((e) => e.t === t).length, visN = (ev) => r.vis.filter((v) => v.ev === ev).length;
    if (visN('claw') < evN('claw')) bad.push(`爪事件 ${evN('claw')} 只播了 ${visN('claw')}`);
    for (const t of ['heal', 'poisonStack', 'poisonTick']) if (visN(t) !== evN(t)) bad.push(`${t} 模擬 ${evN(t)}≠播放 ${visN(t)}`);
    const c = contributionFromEvents(r.battle.events), want = { claw: ['damage', 'claw'], poison: ['damage', 'poison'], heart: ['heal'], bone: ['blocked'], eye: ['critBonus'] };
    const val = (side, path) => Math.round(path.length === 2 ? c[side][path[0]][path[1]] : c[side][path[0]]);
    for (const row of r.rows) { const p = want[row.k]; if (row.me !== val('blue', p) || row.foe !== val('red', p)) bad.push(`貢獻表 ${row.k} 畫面 ${row.me}/${row.foe}≠事件加總 ${val('blue', p)}/${val('red', p)}`); }
    if (r.rows.length !== 5) bad.push(`貢獻表 ${r.rows.length} 列`);
    // 骨的視覺事件只在護盾真的擋下傷害時記錄：要和模擬事件的 shieldHit 對得上
    const shieldHits = r.battle.events.filter((e) => (e.t === 'claw' || e.t === 'poisonTick') && e.shieldHit > 0).length;
    if (r.vis.filter((v) => v.kind === 'bone').length !== shieldHits) bad.push(`骨視覺事件 ${r.vis.filter((v) => v.kind === 'bone').length}≠護盾擋下次數 ${shieldHits}`);
    check(`${tag} CB-04 可讀性：5 種器官都有視覺事件、貢獻表＝模擬事件加總、點器官有說明、一次性說明都出現過`, bad.length === 0, `${[...kinds].join(',')}｜${bad.slice(0, 3).join('；')}`);
  }

  // ===== CB-05 縫合擺放＋CB-06 征途勝（3 場）=====
  // 種子 1：tests/cb_stats.ts 的零延遲貪婪探針在 Node 端能三場全勝；這裡用同一套挑刀規則以真實拖曳重打
  {
    const bad = []; let placed = null, rejectSeen = false;
    await page.evaluate((sd) => window.__cb.newRun({ seed: sd }), winSeed);
    for (let stage = 0; stage < 3; stage++) {
      await playCut(page);
      await waitUi(page, 'contrib');
      await page.click('#contribNext');
      const s = await C(page);
      if (stage < 2) {
        if (s.ui !== 'pick') { bad.push(`第 ${stage + 1} 場沒進縫合（${s.ui}，${s.camp.history.at(-1)?.winner}）`); break; }
        const offer = s.camp.offer;
        if (offer.length !== 3) bad.push(`選項 ${offer.length}`);
        await page.click('#pick0');
        // 不合法：角落（圓超出獸身）→ 拒絕＋提示，仍在擺放
        await tap(page, [26, 975]);
        const r1 = await C(page);
        if (r1.ui !== 'place' || !r1.tip || !(r1.tip.includes('放不下') || (d4 && r1.tip.includes('槽位')))) bad.push(`角落沒被拒絕：ui=${r1.ui} tip=${r1.tip}`); else rejectSeen = true;
        // 不合法：壓在既有器官上
        await tap(page, r1.camp.blueBase[0].p);
        const r2 = await C(page);
        if (r2.ui !== 'place' || !(d4 ? r2.tip?.includes('槽位') : r2.tip?.includes('重疊'))) bad.push(`重疊沒被拒絕：${r2.tip}`);   // duel4：既有器官中心離所有槽位 >40（槽位與器官相距 ≥2R+4），按吸附規則拒絕
        const spot = legalSpot(r2.camp);
        await tap(page, spot);
        if (d4) {
          await waitUi(page, 'showcase', 5000);
          if (await page.evaluate(() => window.__cb.nextFoe)) bad.push('放下後立刻出現「下一位對手」（應先展示新身體）');
          await page.waitForFunction(() => window.__cb.nextFoe, null, { timeout: 5000 });
          await page.click('#nextFoe');
          await waitUi(page, 'cut', 5000);
        }
        const r3 = await C(page);
        if (r3.ui !== 'cut' || r3.camp.stage !== stage + 1) { bad.push(`擺放後沒進下一場：${r3.ui}`); break; }
        const st = r3.camp.stitches.at(-1), org = r3.game.organs.find((x) => x.id.startsWith('藍縫') && x.p[0] === st.p[0] && x.p[1] === st.p[1]);
        if (!org || org.kind !== offer[0]) bad.push(`下一場沒有縫上的 ${offer[0]}（位置 ${st?.p}）`);
        // 點擊會落在整數 CSS 像素上（WebKit）：每軸最多差約 0.5 CSS 像素（取 0.71 保守），兩軸合成 ×√2，換成世界距離；再加擺放時座標四捨五入的 0.71
        const px = await page.evaluate(() => { const a = window.__cb.toScreen(0, 0), b = window.__cb.toScreen(700, 0); return 700 / (b.x - a.x); });
        if (d4) { const sl = stitchSlots({ ...r2.camp, phase: 'place' }); if (!sl.some((q) => q[0] === st.p[0] && q[1] === st.p[1]) || Math.hypot(st.p[0] - spot[0], st.p[1] - spot[1]) > 40 + 0.71 * px * Math.SQRT2) bad.push(`位置 ${st.p} 不是點擊 ${spot} 附近 40 內的槽位`); }
        else if (Math.hypot(st.p[0] - spot[0], st.p[1] - spot[1]) > 0.71 * px * Math.SQRT2 + 0.71) bad.push(`位置 ${st.p}≠點擊 ${spot}（容許 ${(0.71 * px * Math.SQRT2 + 0.71).toFixed(2)}）`);
        if (stage === 0) placed = { kind: offer[0], p: st.p };
      }
    }
    const fin = await C(page);
    const won = fin.ui === 'end' && fin.camp.phase === 'won' && (await page.textContent('#endReach')) === '3';
    if (!won) bad.push(`征途沒勝：ui=${fin.ui} phase=${fin.camp.phase} 史=${fin.camp.history.map((h) => h.winner).join('/')}`);
    check(`${tag} CB-05 縫合擺放：挑選→擺放→下一場存在且位置正確；角落／重疊被拒絕並提示`, bad.filter((x) => !x.includes('征途')).length === 0 && rejectSeen && placed, `${placed ? `${placed.kind}@${placed.p}` : ''}｜${bad.slice(0, 3).join('；')}`);
    check(`${tag} CB-06 征途勝：打完 3 場並看到結果畫面`, won, bad.filter((x) => x.includes('征途')).join('；') || fin.camp.history.map((h) => `${h.winner}/${h.how}`).join(' '));
    // 重開：全部重置
    await page.click('#again');
    const z = await C(page);
    const reset = z.ui === 'cut' && z.camp.stage === 0 && z.camp.stitches.length === 0 && z.camp.history.length === 0 && z.camp.phase === 'cut' && z.game.step === 0 && !z.game.organs.some((o) => o.id.startsWith('藍縫')) && z.camp.seed !== winSeed;
    check(`${tag} CB-06 重開後狀態全部重置`, reset, JSON.stringify({ ui: z.ui, stage: z.camp.stage, st: z.camp.stitches.length }));
  }
  // ===== CB-06 第 1 場輸：不出刀 =====
  {
    await page.evaluate(() => window.__cb.newRun({ seed: 2 }));
    await playCut(page, true);
    await waitUi(page, 'contrib'); await page.click('#contribNext');
    const z = await C(page);
    const ok = z.ui === 'end' && z.camp.phase === 'lost' && (await page.textContent('#endReach')) === '1' && (await page.textContent('#endTitle')).includes('倒在第 1 場');
    check(`${tag} CB-06 第 1 場輸：結果畫面顯示打到第 1 場與最後身體組成`, ok && (await page.textContent('#endBodyKinds')).length > 0, `${z.ui} ${z.camp.phase} ${await page.textContent('#endBodyKinds')}`);
  }

  // ===== CB-07 手機版面（兩種尺寸；切割、戰鬥貢獻、縫合選項、結果） =====
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    const { ctx: c2, page: p } = await newPage(browser, bname, devices, w, h);
    if (init) await c2.addInitScript(init);
    await p.goto(url + `/${sub}/`); await ready(p);
    await p.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 0.05 }); window.__cb.newRun({ seed: 1 }); });
    const bad = [];
    const visible = async (sel) => p.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return `${s} 不存在`;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return `${s} 超出視窗 ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(hit === el || el.contains(hit))) return `${s} 中心被 ${hit && (hit.id || hit.tagName)} 蓋住`;
      if (el.tagName === 'BUTTON' && (r.height < 44 || r.width < 44)) return `${s} 按鈕 ${Math.round(r.width)}×${Math.round(r.height)} <44`;
      return null;
    }, sel);
    const scroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
    for (const s of ['#top', '#ver', '#clock', '#scene', '#fast', '#sound', '#restart']) { const e = await visible(s); if (e) bad.push(e); }
    const inCanvas = await p.evaluate(() => { const r = document.getElementById('scene').getBoundingClientRect(); return [[20, 20], [680, 20], [680, 980], [20, 980]].every(([x, y]) => { const q = window.__cb.toScreen(x, y); return q.x >= r.left - 1 && q.x <= r.right + 1 && q.y >= r.top - 1 && q.y <= r.bottom + 1; }); });
    if (!inCanvas) bad.push('獸身超出畫布');
    if (!(await scroll())) bad.push('水平捲動（切割）');
    await playCut(p); await p.waitForFunction(() => window.__cb.ui === 'contrib', null, { timeout: 40000 });
    for (const s of ['#contribTitle', '#contribBody', '#contribNext']) { const e = await visible(s); if (e) bad.push(e); }
    await p.click('#contribNext');
    if ((await p.evaluate(() => window.__cb.ui)) === 'pick') { for (const s of ['#pick0', '#pick1', '#pick2']) { const e = await visible(s); if (e) bad.push(e); } if (!(await scroll())) bad.push('水平捲動（縫合）'); }
    await p.evaluate(() => window.__cb.newRun({ seed: 2 })); await playCut(p, true); await p.waitForFunction(() => window.__cb.ui === 'contrib', null, { timeout: 40000 }); await p.click('#contribNext');
    for (const s of ['#endTitle', '#endBody', '#again']) { const e = await visible(s); if (e) bad.push(e); }
    if (!(await scroll())) bad.push('水平捲動（結果）');
    if (p.__errs.length) bad.push(`頁面錯誤 ${p.__errs.join(' | ')}`);
    check(`${tag} CB-07 手機 ${label} ${w}×${h}：切割／貢獻表／縫合選項／結果完整可見、按鈕 ≥44px、無水平捲動`, bad.length === 0, bad.join('；'));
    await c2.close();
  }
  check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
  await ctx.close(); await browser.close();
}
