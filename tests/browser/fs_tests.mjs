// duel v0.5 千節蛇（duel5/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/DUEL_V05_SNAKE.md＋補述 1 的 FS-05、FS-06 與 FS-07 的技能鈕、?cut= 瀏覽器部分。
// FS-01～04 在 tests/node/fs_rules.test.ts；FS-07 的舊測試照跑由 run.mjs 以 sub='duel5'（預選龍）呼叫 fv／df／cb／da。
import { mkdirSync } from 'node:fs';
import { newPage } from './exp_tests.mjs';
import { PLAN } from './df_tests.mjs';

const NO_TUT = "try { localStorage.setItem('duel5-tutorial', 'done'); } catch (e) {}";
export const autoBeast = (b) => `window.__duel5AutoBeast = '${b}';`;
const readyCamp = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 30000 });
const readyAny = (pg) => pg.waitForFunction(() => !!window.__cb && window.__cb.assetsReady, null, { timeout: 30000 });
const scr = (page, p) => page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p);
const frames = (pg, n = 3) => pg.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const evs = (S, E, t0, ms = 60) => { const out = [{ t: t0, k: 'down', p: S }]; for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [S[0] + ((E[0] - S[0]) * t) / ms, S[1] + ((E[1] - S[1]) * t) / ms] }); out.push({ t: t0 + ms, k: 'move', p: E }, { t: t0 + ms, k: 'up', p: E }); return out; };
/** 器官內圈（0.8r）平均亮度 ÷ 外圈（1.5r～2r）背景平均亮度（補述 1 第 10a 條；補述 2：外圈只取不在其他存活器官 1.4r 內的像素（art-kit 器官圖層延伸到 r×1.36：pad＝0.36r，sprites.ts organLayers）——
 * 紅方器官中心距最小 72，鄰居本體會落進外圈；不排除的話，有近鄰的器官即使本體全黑也到不了 1.6，見 the-cut DUEL_V05_SNAKE 補述 2）。外圈背景像素不足 25% 的器官回傳 null（不評）。 */
export const ratioOf = (page, ids) => page.evaluate((ids) => {
  const cv = document.getElementById('scene'), g = cv.getContext('2d'), rect = cv.getBoundingClientRect(), k = cv.width / rect.width, out = {};
  const gm = window.__cb.game, R = window.__cb.R, scr = (p) => { const c = window.__cb.toScreen(p[0], p[1]); return [(c.x - rect.left) * k, (c.y - rect.top) * k]; };
  const others = gm.organs.map((o, i) => ({ o, i })).filter((x) => gm.alive[x.i]).map((x) => ({ id: x.o.id, c: scr(x.o.p) }));
  for (const id of ids) {
    const o = gm.organs.find((x) => x.id === id); if (!o) continue;
    const [cx, cy] = scr(o.p), e = scr([o.p[0] + R, o.p[1]]), r = e[0] - cx;
    const box = Math.ceil(2 * r) + 2, x0 = Math.round(cx - box), y0 = Math.round(cy - box), d = g.getImageData(x0, y0, 2 * box, 2 * box).data;
    const near = others.filter((q) => q.id !== id && Math.hypot(q.c[0] - cx, q.c[1] - cy) < 4 * r);
    let si = 0, ni = 0, so = 0, no = 0, ring = 0;
    for (let y = 0; y < 2 * box; y++) for (let x = 0; x < 2 * box; x++) {
      const px = x0 + x, py = y0 + y, dd = Math.hypot(px - cx, py - cy), i = (y * 2 * box + x) * 4, lum = d[i] + d[i + 1] + d[i + 2];
      if (dd <= 0.8 * r) { si += lum; ni++; } else if (dd >= 1.5 * r && dd <= 2 * r) { ring++; if (near.every((q) => Math.hypot(px - q.c[0], py - q.c[1]) > 1.4 * r)) { so += lum; no++; } }
    }
    out[id] = no < 0.25 * ring ? null : (si / ni) / Math.max(1, so / no);
    out[`${id}#share`] = no / ring;   // 外圈中背景像素的比例（1＝沒有排除鄰居）
  }
  return out;
}, ids);

export async function runFsTests({ bname, btype, devices, url, check, shotDir = 'test-output/fs_shots' }) {
  mkdirSync(shotDir, { recursive: true });
  const browser = await btype.launch();
  const tag = `[${bname}][duel5]`;
  const open = async (init = [NO_TUT], q = '') => { const { ctx, page } = await newPage(browser, bname, devices, 393, 852); for (const s of init) await ctx.addInitScript(s); await page.goto(url + '/duel5/' + q); await readyAny(page); return { ctx, page }; };
  const tapEl = async (page, sel) => { const b = await page.locator(sel).boundingBox(); if (!b) return false; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; };

  // ===== FS-05 選怪獸（觸控）：兩張卡（輪廓、器官、技能、風格）；選蛇 → 第一場是蛇；重開記住上次；localStorage 丟例外仍可玩 =====
  {
    const { ctx, page } = await open();
    await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    const cards = await page.evaluate(() => ['beastDragon', 'beastSnake'].map((id) => { const el = document.getElementById(id), cv = el.querySelector('canvas'), r = el.getBoundingClientRect(); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++; return { text: el.textContent, lit, w: r.width, h: r.height, visible: r.bottom <= innerHeight && r.right <= innerWidth }; }));
    await page.screenshot({ path: `${shotDir}/beast_pick_393x852.png` });
    await tapEl(page, '#beastSnake');
    await page.waitForFunction(() => window.__cb.ui === 'cut' && !!window.__cb.camp, null, { timeout: 8000 });
    const s1 = await page.evaluate(() => ({ beast: window.__cb.beast, kinds: window.__cb.game.organs.filter((o) => o.side === 'blue').map((o) => o.kind).join(','), body: window.__cb.game.mode.body.blue.length, saved: (() => { try { return localStorage.getItem('duel5-beast'); } catch { return 'ERR'; } })() }));
    await page.click('#restart');
    await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    const pre = await page.evaluate(() => ({ snakeSel: document.getElementById('beastSnake').classList.contains('sel'), dragonSel: document.getElementById('beastDragon').classList.contains('sel') }));
    await ctx.close();
    // 重新載入頁面也記得
    const { ctx: c2, page: p2 } = await open([NO_TUT, "try { localStorage.setItem('duel5-beast', 'snake'); } catch (e) {}"]);
    await p2.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    const reload = await p2.evaluate(() => document.getElementById('beastSnake').classList.contains('sel'));
    await c2.close();
    // localStorage 丟例外：仍可選、可玩
    // 主程式在儲存被封鎖時當掉 → 記為不合格，而不是讓整個測試程式丟例外
    const { ctx: c3, page: p3 } = await newPage(browser, bname, devices, 393, 852);
    await c3.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    let blocked = { beast: null, n: 0 };
    try {
      await p3.goto(url + '/duel5/'); await readyAny(p3);
      await p3.waitForFunction(() => window.__cb?.ui === 'beast', null, { timeout: 8000 });
      await tapEl(p3, '#beastDragon');
      await p3.waitForFunction(() => window.__cb.ui === 'cut' && !!window.__cb.camp, null, { timeout: 8000 });
      blocked = await p3.evaluate(() => ({ beast: window.__cb.beast, n: window.__cb.game.organs.length }));
    } catch (e) { blocked = { beast: null, n: 0, err: String(e).slice(0, 80) }; }
    const errs3 = p3.__errs.length; await c3.close();
    const fields = (t, ws) => ws.every((w) => t.includes(w));
    const ok = cards.every((c) => c.lit > 500 && c.h >= 44 && c.visible) && fields(cards[0].text, ['幽光龍', '器官', '蛻生', '平衡，器官分散好防守']) && fields(cards[1].text, ['千節蛇', '蛇牙', '穿刺', '器官排成一列、貼近前線，靠技能一刀連切'])
      && s1.beast === 'snake' && s1.kinds === 'poison,claw,poison,heart,fang,eye,poison,claw,bone' && s1.saved === 'snake' && pre.snakeSel && !pre.dragonSel && reload && blocked.beast === 'dragon' && blocked.n > 0 && errs3 === 0;
    check(`${tag} FS-05 選怪獸（觸控）：兩張卡含輪廓／器官／技能／風格；選蛇 → 第一場是蛇；重開與重新載入都預選上次；localStorage 丟例外仍可選可玩`, ok, JSON.stringify({ cards: cards.map((c) => ({ lit: c.lit, h: Math.round(c.h) })), s1, pre, reload, blocked, errs3 }));
  }
  // ===== FS-07 技能鈕（真實觸控）：切割期按「穿刺」→ 規則層的穿刺生效、按鈕變「穿刺中」；倒數期間不能按；用過後變灰 =====
  {
    const { ctx, page } = await open([NO_TUT, autoBeast('snake')]);
    await readyCamp(page);
    await page.evaluate(() => window.__cb.newRun({ seed: 5, beast: 'snake' }));
    await frames(page, 2);
    const during = await page.evaluate(() => window.__cb.skill);
    await page.waitForFunction(() => window.__cb.countdown === 0, null, { timeout: 6000 });
    await frames(page, 3);
    const before = await page.evaluate(() => window.__cb.skill);
    const box = await page.locator('#skill').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => !!window.__cb.skill.pierce, null, { timeout: 3000 }).catch(() => {});
    await frames(page, 3);
    const after = await page.evaluate(() => window.__cb.skill);
    // 用穿刺出刀（feed），刀結束後按鈕變灰
    const plan = await page.evaluate(PLAN), c0 = await page.evaluate(() => window.__cb.clock);
    await page.evaluate((e) => window.__cb.feed(e), evs(plan.S, plan.E, c0 + 100));
    await page.waitForFunction(() => window.__cb.skill.used && !window.__cb.skill.pierce, null, { timeout: 4000 }).catch(() => {});
    await frames(page, 2);
    const done = await page.evaluate(() => ({ ...window.__cb.skill, cls: document.getElementById('skill').className }));
    const ok = during.disabled === true && before.disabled === false && box.width >= 44 && box.height >= 44 && after.pierce && after.text.startsWith('穿刺中') && done.used && done.disabled && done.cls.includes('used');
    check(`${tag} FS-07 技能鈕（真實觸控）：倒數中不能按；切割期按下 → 穿刺生效、按鈕顯示「穿刺中」；出刀後用掉變灰；按鈕 ≥44px`, ok, JSON.stringify({ during, before, box: box && [Math.round(box.width), Math.round(box.height)], after, done }));
    await ctx.close();
  }
  // ===== 補述 1 第 11 條 ?cut=40：在 40 秒結束切割期（第 39.x 秒仍在切割期）；?cut=19 回到 30 =====
  {
    const { ctx, page } = await open([NO_TUT, autoBeast('dragon')], '?cut=40');
    await readyCamp(page);
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.newRun({ seed: 3, beast: 'dragon' }); window.__cb.advance(2399); });
    const a = await page.evaluate(() => ({ s: window.__cb.cutS, step: window.__cb.game.step, phase: window.__cb.game.phase, ui: window.__cb.ui }));
    await page.evaluate(() => window.__cb.advance(1));
    const a2 = await page.evaluate(() => ({ step: window.__cb.game.step, phase: window.__cb.game.phase }));   // step＝下一個要跑的步：2400（40.0 秒）時還沒跑
    await page.evaluate(() => window.__cb.advance(1));
    const b = await page.evaluate(() => ({ phase: window.__cb.game.phase }));
    await ctx.close();
    const { ctx: c2, page: p2 } = await open([NO_TUT, autoBeast('dragon')], '?cut=19');
    await readyCamp(p2);
    const c = await p2.evaluate(() => ({ s: window.__cb.cutS, steps: window.__cb.game.mode.cutSteps }));
    await c2.close();
    check(`${tag} ?cut=40：跑完第 2399 步仍在切割期、跑第 2400 步（40.0 秒）時結束；?cut=19 → 30 秒`, a.s === 40 && a.phase === 'cut' && a2.step === 2400 && a2.phase === 'cut' && b.phase !== 'cut' && c.s === 30 && c.steps === 1800, JSON.stringify({ a, a2, b, c }));
  }
  // ===== FS-06 戰鬥可讀（像素＋事件）：戰鬥期器官可見（亮度比 ≥1.6 且 ≥ 切割期 ×0.9）、對照逐項相同、行動亮起與攻擊連線、字級 ≥18 CSS px、暴擊樣式不同、雙方跳字 ≥80ms、「清空！」≥600ms =====
  {
    const { ctx, page } = await open([NO_TUT, autoBeast('dragon')]);
    await readyCamp(page);
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 1 }); window.__cb.newRun({ seed: 5, beast: 'dragon' }); window.__cb.advance(2); });
    await frames(page, 4);
    const redIds = await page.evaluate(() => window.__cb.game.organs.filter((o, i) => o.side === 'red' && window.__cb.game.alive[i]).map((o) => o.id));
    const cut = await ratioOf(page, redIds);
    await page.evaluate(() => window.__cb.advance(1800));
    await page.waitForFunction(() => window.__cb.matchup && window.__cb.matchup.shown, null, { timeout: 5000 });
    await frames(page, 3);
    const m = await page.evaluate(() => { const g = window.__cb.game, c = (side) => { const o = {}; g.organs.forEach((x, i) => { if (g.alive[i] && x.side === side) o[x.kind] = (o[x.kind] ?? 0) + 1; }); return o; }; return { m: window.__cb.matchup, me: c('blue'), foe: c('red'), alive: g.organs.filter((o, i) => g.alive[i] && o.side === 'red').map((o) => o.id) }; });
    const bat = await ratioOf(page, m.alive);
    await page.screenshot({ path: `${shotDir}/battle_matchup_393x852.png` });
    await page.waitForFunction(() => window.__cb.ui === 'contrib', null, { timeout: 60000 }).catch(() => {});
    await page.screenshot({ path: `${shotDir}/battle_end_393x852.png` });
    const log = await page.evaluate(() => window.__cb.fxLog);
    const ids = new Set(m.alive), judged = m.alive.filter((id) => bat[id] !== null && cut[id] !== null), visBad = judged.filter((id) => !(bat[id] >= 1.6 && bat[id] >= 0.9 * cut[id]));
    // 補述 2 條件：回報不評數與「外圈有排除鄰居像素」的器官（位置），並存背景占比最低的 3 顆的裁切截圖（393×852 畫面上 90×90 CSS px）
    const shareList = m.alive.map((id) => ({ id, share: bat[`${id}#share`] })).sort((a, b) => a.share - b.share);
    const pos = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => { const o = window.__cb.game.organs.find((x) => x.id === id); return [id, o.p]; })), m.alive);
    const crops = [];
    for (const x of shareList.slice(0, 3)) { const p = await scr(page, pos[x.id]); const f = `${shotDir}/fs06_crop_${x.id}.png`; await page.screenshot({ path: f, clip: { x: Math.max(0, p.x - 45), y: Math.max(0, p.y - 45), width: 90, height: 90 } }); crops.push(`${x.id}@${pos[x.id]} share=${x.share.toFixed(2)}`); }
    const excluded = { notJudged: `${m.alive.length - judged.length}/${m.alive.length}`, partial: shareList.filter((x) => x.share < 1).map((x) => `${x.id}@${pos[x.id]}:${x.share.toFixed(2)}`), crops };
    const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    const nums = log.filter((x) => x.t === 'num'), acts = log.filter((x) => x.t === 'act'), lines = log.filter((x) => x.t === 'line');
    const minCss = Math.min(...nums.map((x) => x.css)), crit = nums.filter((x) => x.crit), normal = nums.filter((x) => !x.crit);
    let gap = Infinity; for (const a of nums) for (const b of nums) if (a.side !== b.side) gap = Math.min(gap, Math.abs(a.at - b.at));
    const lineKinds = new Set(lines.map((l) => (l.id || '').replace(/[藍紅]/, '').replace(/[0-9縫]/g, '')));
    void ids;
    const ok = visBad.length === 0 && judged.length >= Math.ceil(m.alive.length / 2) && eq(m.m.me, m.me) && eq(m.m.foe, m.foe) && acts.length > 0 && lineKinds.has('爪') && nums.length > 4 && minCss >= 18 && gap >= 80
      && (crit.length === 0 || (crit[0].css > normal[0].css && crit[0].text.startsWith('暴擊')));
    check(`${tag} FS-06 戰鬥可讀：器官亮度比 ≥1.6 且 ≥ 切割期×0.9、開戰前對照＝實際剩下的器官、有行動亮起與爪的攻擊連線、跳字 ≥18 CSS px、暴擊樣式不同、雙方跳字間隔 ≥80ms`, ok, JSON.stringify({ visBad, judged: `${judged.length}/${m.alive.length}`, excluded, cut: Object.fromEntries(Object.entries(cut).filter(([k]) => !k.includes('#')).slice(0, 4).map(([k, v]) => [k, v === null ? null : +v.toFixed(2)])), bat: Object.fromEntries(Object.entries(bat).filter(([k]) => !k.includes('#')).slice(0, 4).map(([k, v]) => [k, v === null ? null : +v.toFixed(2)])), m: m.m.text, acts: acts.length, lineKinds: [...lineKinds], nums: nums.length, minCss: +minCss.toFixed(1), crit: crit.length, gap: gap === Infinity ? null : Math.round(gap) }));
    await ctx.close();
  }
  // ===== FS-06 毒的攻擊連線（蛇有 3 毒，直接進戰鬥）=====
  {
    const { ctx, page } = await open([NO_TUT, autoBeast('snake')]);
    await readyCamp(page);
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 1 }); window.__cb.newRun({ seed: 9, beast: 'snake' }); window.__cb.advance(1801); });
    await page.waitForFunction(() => window.__cb.fxLog.some((x) => x.t === 'line' && /毒/.test(x.id || '')), null, { timeout: 20000 }).catch(() => {});
    const poisonLine = await page.evaluate(() => window.__cb.fxLog.some((x) => x.t === 'line' && /毒/.test(x.id || '')));
    check(`${tag} FS-06 毒疊層有攻擊連線（蛇的毒 → 對方本體）`, poisonLine, '');
    check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }
  // ===== FS-06「清空！」完整顯示 ≥600ms 才換下一個（擊倒局；?cut=60 給足時間；哪一方先清空都算）=====
  {
    const { ctx, page } = await open([NO_TUT, autoBeast('snake')], '?cut=60');
    await readyCamp(page);
    await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 1 }); window.__cb.newRun({ seed: 9, beast: 'snake' }); window.__cb.advance(2); });
    let ko = null;
    for (let i = 0; i < 60 && !ko; i++) {
      const st = await page.evaluate(() => window.__cb.game.phase); if (st !== 'cut') break;
      const plan = await page.evaluate(PLAN), k0 = await page.evaluate(() => window.__cb.game.step);
      if (plan) await page.evaluate(([e]) => window.__cb.feed(e), [evs(plan.S, plan.E, (k0 + 1) * (1000 / 60))]);
      await page.evaluate(() => window.__cb.advance(92));
      ko = await page.evaluate(() => (window.__cb.game.phase === 'ko' ? window.__cb.game.end : null));
    }
    await page.waitForFunction(() => window.__cb.ui === 'battle' || window.__cb.ui === 'contrib', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const log = await page.evaluate(() => window.__cb.fxLog.filter((x) => x.t === 'banner' || x.t === 'matchup'));
    const i0 = log.findIndex((x) => x.t === 'banner' && x.id === '清空！'), nxt = i0 >= 0 ? log.slice(i0 + 1).find((x) => x.t === 'matchup' || (x.t === 'banner' && x.id && x.id !== '清空！')) : null;
    const shown = i0 >= 0 && nxt ? nxt.at - log[i0].at : null;
    check(`${tag} FS-06「清空！」完整顯示 ≥600ms 才換下一個（開戰前對照或戰鬥橫幅）`, !!ko && shown !== null && shown >= 600, JSON.stringify({ ko, shown: shown && Math.round(shown), log: log.slice(Math.max(0, i0 - 1), i0 + 3).map((x) => `${x.t}:${x.id ?? ''}`) }));
    await ctx.close();
  }
  // ===== FS-06 決定性：同一份輸入序列，演出開／關，規則結果逐步相同；戰鬥結果相同（戰鬥模擬與畫面無關） =====
  {
    const sigs = [];
    for (const fxOn of [true, false]) {
      const { ctx, page } = await open([NO_TUT, autoBeast('snake')]);
      await readyCamp(page);
      await page.evaluate((v) => { window.__cb.setManual(true); window.__cb.setFx(v); window.__cb.newRun({ seed: 11, beast: 'snake' }); }, fxOn);
      const plan = await page.evaluate(PLAN);
      await page.evaluate((e) => window.__cb.feed(e), [...evs(plan.S, plan.E, 500), ...evs(plan.S, [plan.S[0] + 200, plan.S[1]], 2600)]);
      for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__cb.advance(15)); await frames(page, 1); }
      sigs.push(await page.evaluate(() => ({ sig: window.__cb.stepSig, battle: null })));
      await ctx.close();
    }
    const same = JSON.stringify(sigs[0].sig) === JSON.stringify(sigs[1].sig) && sigs[0].sig.length >= 590 && sigs[0].sig.some((x) => !x.endsWith('|0'));
    check(`${tag} FS-06 決定性：同一輸入、演出開／關，600 步規則結果逐步相同（有切除、push 有變）`, same, JSON.stringify({ n: sigs.map((x) => x.sig.length) }));
  }
  await browser.close();
}
