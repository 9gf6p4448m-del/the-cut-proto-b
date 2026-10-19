// duel v0.6 FT-03～07 瀏覽器測試的共用工具（作者測試；Chromium＋WebKit 模擬，不是 iPhone 實機）。
// 只提供：開頁（含 dialog 監聽）、真實拖曳／觸控、切割期玩家（直線貪婪／被動／即時劃刀／重放排程）、流程驅動、
// 假資料、複製文字解析。不 import src/cutbattle/playlog.ts（FT-04 要求真值不得讀紀錄模組的值）。
import { newPage } from './exp_tests.mjs';
import { PLAN } from './df_tests.mjs';
import { greedyLine } from '../cb_stats.ts';
import { placeCheck } from '../../src/cutbattle/campaign.ts';

export const SIZE = [393, 852];
export const noTut = (sub) => `try { localStorage.setItem('${sub}-tutorial', 'done'); } catch (e) {}`;
export const lineMode = (sub) => `try { localStorage.setItem('${sub}-input', 'line'); } catch (e) {}`;
/** 記錄畫布上畫過的文字（橫幅主副字只畫在 canvas、DOM 讀不到）：text → {minL, maxR, cw, n}；包住原函式、行為不變。 */
export const CAP_TEXT = `(() => { const M = window.__texts = new Map(); const o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...r) { try { const s = String(t), m = this.measureText(s).width, tr = this.getTransform(), al = this.textAlign, l0 = al === 'center' ? x - m / 2 : al === 'right' ? x - m : x, xs = [l0, l0 + m].map((v) => tr.a * v + tr.c * y + tr.e), e = M.get(s) || { minL: 1e9, maxR: -1e9, cw: this.canvas.width, n: 0 }; e.minL = Math.min(e.minL, ...xs); e.maxR = Math.max(e.maxR, ...xs); e.n++; M.set(s, e); } catch (e) {} return o.call(this, t, x, y, ...r); }; })();`;
/** 記錄交給剪貼簿的文字（呼叫仍轉給真實 API）。newPage 也有同樣的包法，重複包無害。 */
export const CLIP_WRAP = `(() => { try { const c = navigator.clipboard; if (c && c.writeText) { const o = c.writeText.bind(c); c.writeText = (x) => { window.__copied = x; return o(x); }; } } catch (e) {} })();`;

export async function openPage({ browser, bname, devices, url, sub, q = '', init = [], ctx: ctx0 = null, ready = true, goto = true }) {
  let ctx = ctx0, page;
  if (ctx) { page = await ctx.newPage(); page.__errs = []; page.on('pageerror', (e) => page.__errs.push(String(e))); }
  else { ({ ctx, page } = await newPage(browser, bname, devices, SIZE[0], SIZE[1])); await ctx.addInitScript(CAP_TEXT); await ctx.addInitScript(CLIP_WRAP); for (const s of init) await ctx.addInitScript(s); }
  page.__dialogs = [];
  page.on('dialog', (d) => { page.__dialogs.push(`${d.type()}:${d.message()}`); d.dismiss().catch(() => {}); });   // confirm()／alert() 一出現就記錄（FT-05：不得觸發）
  if (goto) await page.goto(`${url}/${sub}/${q}`);
  if (ready && goto) await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady, null, { timeout: 30000 });
  return { ctx, page };
}
export const C = (page) => page.evaluate(() => { const c = window.__cb; return { ui: c.ui, camp: c.camp, game: c.game, tip: c.tip }; });
export const scr = (page, p) => page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p);
export const waitUi = (page, ui, timeout = 60000) => page.waitForFunction((u) => window.__cb.ui === u, ui, { timeout });
export const frames = (pg, n = 3) => pg.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
export async function tapEl(page, sel) { const b = await page.locator(sel).boundingBox(); if (!b) return false; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; }
/** 測試端自己的出刀計數（FT-04 strokes 的獨立真值，不經主程式任何事件處理函式）：
 *  sent＝實際送出、非 tap 的刀（直線模式＝一次完整拖曳；即時劃刀＝一次 feed 的完整刀，路徑長 >> TAP_LEN）；
 *  voided＝送出後因時間到被作廢而排除的刀（排除依據：feed 後推進 8 步，若切割期已結束或距結束 ≤2 步，該刀在規則層不會有 freeEnd，
 *  規則 rules.ts 時間到作廢進行中的刀）。每場開始（driveRun）歸零。直線模式只在冷卻好、起點合法時才拖，且拖完立即推進 1 步，不會被作廢。 */
export const tally = { sent: 0, voided: 0 };
export async function dragScreen(page, A, B) {
  tally.sent++;
  await page.mouse.move(A[0], A[1]); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(A[0] + ((B[0] - A[0]) * k) / 6, A[1] + ((B[1] - A[1]) * k) / 6);
  await page.mouse.up();
}
export async function drag(page, a, b) { await dragScreen(page, Object.values(await scr(page, a)), Object.values(await scr(page, b))); }
export async function tapWorld(page, p) { const A = await scr(page, p); await page.mouse.click(A.x, A.y); }
/** 合法擺放點：本身與周圍 8px 一圈都合法（同 cb_tests）。 */
export function legalSpot(camp) {
  const ok = (x, y) => !placeCheck(camp, [x, y]) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !placeCheck(camp, [x + 8 * Math.cos(i * Math.PI / 4), y + 8 * Math.sin(i * Math.PI / 4)]));
  for (let y = 480; y < 950; y += 10) for (let x = 70; x < 650; x += 10) if (ok(x, y)) return [x, y];
  return null;
}
/** 手動推進 n 步，同時在頁面內「每一步」讀 push，記錄觀測到的最大推進／最大後退（FT-04 maxPush 的獨立觀測）。 */
export const advT = (page, n) => page.evaluate((k) => { const c = window.__cb, f = (window.__ft = window.__ft || { mx: 0, ma: 0 }); for (let i = 0; i < k && c.ui === 'cut'; i++) { c.advance(1); const p = c.push; if (p > f.mx) f.mx = p; if (-p > f.ma) f.ma = -p; } }, n);
export const resetFt = (page) => page.evaluate(() => { window.__ft = { mx: 0, ma: 0 }; });

// ---------------------------------------------------------------- 切割期玩家（page 必須已 setManual(true)）
const cutState = (page) => page.evaluate(() => ({ ui: window.__cb.ui, g: window.__cb.game }));
/** 直線預覽：冷卻好就用貪婪刀（真實拖曳），否則推進到冷卻結束。回傳實際拖曳次數。 */
export async function playLineGreedy(page, onTick = null) {
  let drags = 0;
  for (let guard = 0; guard < 600; guard++) {
    const s = await cutState(page);
    if (s.ui !== 'cut' || s.g.phase !== 'cut') return drags;
    if (s.g.cdUntil.blue <= s.g.step) {
      const l = greedyLine(s.g);
      if (l) { await drag(page, l.a, l.b); drags++; await advT(page, 1); if (onTick) await onTick(); continue; }
      await advT(page, 30); if (onTick) await onTick(); continue;
    }
    await advT(page, Math.max(1, s.g.cdUntil.blue - s.g.step)); if (onTick) await onTick();
  }
  return drags;
}
/** 不出刀：每次推進 300 步到切割期結束。 */
export async function playPassive(page) {
  for (let guard = 0; guard < 200; guard++) { const s = await cutState(page); if (s.ui !== 'cut' || s.g.phase !== 'cut') return; await advT(page, 300); }
}
const evsOf = (S, E, t0, ms = 60) => { const out = [{ t: t0, k: 'down', p: S }]; for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [S[0] + ((E[0] - S[0]) * t) / ms, S[1] + ((E[1] - S[1]) * t) / ms] }); out.push({ t: t0 + ms, k: 'move', p: E }, { t: t0 + ms, k: 'up', p: E }); return out; };
/** 餵一刀即時劃刀（PLAN 挑刀；沒有可切的刀回 false）。 */
export async function feedStroke(page) {
  const plan = await page.evaluate(PLAN);
  if (!plan) return false;
  const step = await page.evaluate(() => window.__cb.game.step);
  await page.evaluate((e) => window.__cb.feed(e), evsOf(plan.S, plan.E, (step + 1) * (1000 / 60)));
  tally.sent++;
  return true;
}
/** 即時劃刀：PLAN 挑刀、__cb.feed 餵事件（同 fs_tests 的作法）；skillFirst＝第一刀前先按技能鈕（真實觸控）。回傳餵出的刀數。 */
export async function playFree(page, { skillFirst = false } = {}) {
  let fed = 0, skillDone = !skillFirst;
  for (let guard = 0; guard < 400; guard++) {
    const s = await page.evaluate(() => ({ ui: window.__cb.ui, ph: window.__cb.game.phase, step: window.__cb.game.step, cd: window.__cb.game.cdUntil.blue }));
    if (s.ui !== 'cut' || s.ph !== 'cut') return fed;
    if (s.cd > s.step) { await advT(page, Math.max(1, s.cd - s.step)); continue; }
    if (!skillDone) { await tapEl(page, '#skill'); await advT(page, 1); skillDone = true; continue; }
    if (!(await feedStroke(page))) { await advT(page, 20); continue; }
    fed++; await advT(page, 8);
    const e = await page.evaluate(() => ({ ph: window.__cb.game.phase, ui: window.__cb.ui, step: window.__cb.game.step, end: window.__cb.cutS * 60 }));
    if (e.ui !== 'cut' || e.ph !== 'cut' || e.step >= e.end - 2) { tally.sent--; tally.voided++; }
  }
  return fed;
}
/** 重放排程（Node 預先算好的整數螢幕座標刀線）：推進到該步 → 真實拖曳 → 推進 1 步。 */
export function schedulePlayer(sched, aff0 = null) {
  return async (page, info) => {
    if (!sched || info.stage !== 0 || info.replay !== 0) return playPassive(page);
    for (const e of sched) {
      const st = await page.evaluate(() => ({ ui: window.__cb.ui, step: window.__cb.game.step }));
      if (st.ui !== 'cut') return;
      if (e.step > st.step) await advT(page, e.step - st.step);
      // 版面位移補償：aff0 是 Node 預測時用的螢幕座標系（頁面開頭量到的）。畫布會因提示／資訊列換行而整數像素位移（實測 y 差 4px），
      // 位移後同一組整數螢幕座標對應的世界座標就不同、起點被判「起點要在你的獸身上」。拖曳前重量原點，整數位移原樣補回，世界座標與預測逐位元相同。
      const o = aff0 ? await scr(page, [0, 0]) : null, dx = o ? Math.round(o.x - aff0.ax) : 0, dy = o ? Math.round(o.y - aff0.ay) : 0;
      await dragScreen(page, [e.sa[0] + dx, e.sa[1] + dy], [e.sb[0] + dx, e.sb[1] + dy]); await advT(page, 1);
    }
    return playPassive(page);
  };
}

/** 流程驅動：從目前畫面一路打到結果畫面（或回到選怪獸畫面）。每個「結算表出現」記一份快照（獨立於紀錄模組）。
 *  player(page, {stage, replay}) 負責切割期；onBattle(page, snapNo) 在每場戰鬥開始時呼叫。 */
export async function driveRun(page, { player, onBattle = null, maxLoops = 300 } = {}) {
  const snaps = []; let hooked = false;
  await resetFt(page); tally.sent = 0; tally.voided = 0;
  for (let guard = 0; guard < maxLoops; guard++) {
    const ui = await page.evaluate(() => window.__cb.ui);
    if (ui === 'end') return { snaps, ended: true };
    if (ui === 'beast') return { snaps, ended: false };
    if (ui === 'cut') {
      const info = await page.evaluate(() => ({ stage: window.__cb.camp.stage, replay: window.__cb.camp.replay ?? 0 }));
      await player(page, info);
      await page.waitForFunction(() => window.__cb.ui !== 'cut', null, { timeout: 30000 }); continue;
    }
    if (ui === 'battle') {
      if (!hooked) { hooked = true; if (onBattle) await onBattle(page, snaps.length); }
      await page.waitForFunction(() => window.__cb.ui !== 'battle', null, { timeout: 180000 }); continue;
    }
    if (ui === 'contrib') {
      const s = await page.evaluate(() => { const c = window.__cb, g = c.game, b = c.battle; return { stage: c.camp.stage + 1, replay: c.camp.replay ?? 0, sevBlue: g.severedN.blue, sevRed: g.severedN.red, battle: b && { winner: b.winner, how: b.how, endMs: b.endMs }, tie: c.tie ? { ...c.tie } : null, input: c.input, matchup: c.matchup && { me: c.matchup.me, foe: c.matchup.foe }, ft: { ...(window.__ft || { mx: 0, ma: 0 }) }, title: document.getElementById('contribTitle').textContent, btn: document.getElementById('contribNext').textContent }; });
      s.strokesSent = tally.sent; s.voided = tally.voided;
      snaps.push(s); hooked = false;
      await page.click('#contribNext'); await resetFt(page); tally.sent = 0; tally.voided = 0; continue;
    }
    if (ui === 'pick') {
      const offer = await page.evaluate(() => [...window.__cb.camp.offer]);
      await page.click('#pick0');
      const r = await C(page), spot = legalSpot(r.camp);
      if (!spot) return { snaps, ended: false, err: 'no legal spot' };
      await tapWorld(page, spot); await waitUi(page, 'showcase', 6000);
      await page.waitForFunction(() => window.__cb.nextFoe, null, { timeout: 8000 });
      const st = await page.evaluate(() => { const s = window.__cb.camp.stitches, l = s[s.length - 1]; return { kind: l.kind, p: [l.p[0], l.p[1]] }; });
      snaps[snaps.length - 1].stitch = { offer, picked: st.kind, p: st.p };
      await page.click('#nextFoe'); await waitUi(page, 'cut', 6000); continue;
    }
    await page.waitForFunction(() => !['place', 'showcase'].includes(window.__cb.ui), null, { timeout: 8000 });   // place／showcase 之外的意外狀態不會走到這；保險
  }
  return { snaps, ended: false, err: 'loop guard' };
}

// ---------------------------------------------------------------- 假資料與解析
export const fakeStage = (over = {}) => ({ stage: 1, replay: 0, firstCutSec: 3.5, strokes: 4, cuts: 2, cutBy: 1, locks: 0, blocked: 0, maxPush: 1, maxPushAi: 0, skill: null, endOrgans: { blue: ['claw'], red: ['claw'] }, input: 'line', battle: { winner: 'blue', how: 'time', ms: 30000, fastAtMs: null }, tiebreak: null, stitch: null, ...over });
export const fakeRun = (idx, over = {}) => ({ runIdx: idx, startedVia: 'again', gapSec: 5, startedAt: `2026-01-01 00:${String(Math.floor(idx / 60) % 60).padStart(2, '0')}:${String(idx % 60).padStart(2, '0')}`, ver: 'duel6', sha: 'fake', beast: 'dragon', cutSec: 30, input: 'line', tutorial: 'before', result: 'won', totalSec: 120, stages: [fakeStage()], ...over });
export const seedLog = (sub, runs) => `try { if (!sessionStorage.getItem('__ftSeeded')) { localStorage.setItem('${sub}-playlog', ${JSON.stringify(JSON.stringify(runs))}); sessionStorage.setItem('__ftSeeded', '1'); } } catch (e) {}`;
export const storedRuns = (page, sub) => page.evaluate((k) => { try { const raw = localStorage.getItem(k); return raw === null ? null : JSON.parse(raw); } catch (e) { return 'ERR:' + e; } }, `${sub}-playlog`);
export const storedRaw = (page, sub) => page.evaluate((k) => localStorage.getItem(k), `${sub}-playlog`);
/** 拆複製文字：首行、摘要行、```json 區塊（JSON.parse 失敗 → json=null、err）。 */
export function parseCopy(text) {
  const lines = String(text).split('\n'), i = lines.indexOf('```json'), j = lines.lastIndexOf('```');
  let json = null, err = null;
  try { json = JSON.parse(lines.slice(i + 1, j).join('\n')); } catch (e) { err = String(e); }
  const m = /^THE CUT 試玩紀錄 v1｜duel6 (\S+)｜(\d+) 局｜(.+)$/.exec(lines[0] || '');
  return { head: lines[0], sha: m && m[1], n: m && Number(m[2]), time: m && m[3], summary: i > 0 ? lines.slice(1, i) : [], json, err, hasFence: i >= 0 && j > i };
}
export const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 版面：元素不溢出（scrollWidth<=clientWidth）且 getBoundingClientRect 在視窗內；回傳違規清單。 */
export const layoutBad = (page, sels) => page.evaluate((list) => {
  const bad = [];
  for (const s of list) {
    const el = document.querySelector(s); if (!el) { bad.push(`${s} 不存在`); continue; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) bad.push(`${s} 尺寸 0`);
    if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${s} 超出視窗寬 ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (el.scrollWidth > el.clientWidth + 1) bad.push(`${s} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
  }
  if (document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth) bad.push('頁面水平捲動');
  return bad;
}, sels);
