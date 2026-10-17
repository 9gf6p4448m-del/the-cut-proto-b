// 一刀雙獸（twin-slash/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut docs/twin-slash/ACCEPTANCE_FROZEN.md TS-04、TS-05(UI)、TS-07、TS-08(UI)、TS-09、TS-10、TS-11、TS-12、TS-15。
// 挑線用的候選刀由規則模組（與 Node 單元測試同一份）在測試端算出；判定都讀 window.__twin 的狀態，不讀畫面文字函式。
import { newPage } from './exp_tests.mjs';
import { aiChoose, applyCut, candidateCuts, newState } from '../../src/twinslash/rules.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const T = (page) => page.evaluate(() => { const t = window.__twin; return { phase: t.phase, cuts: t.st.cuts, turn: t.st.turn, hp: t.st.hp, charges: t.st.charges, meter: t.st.meter, toggle: t.toggle, result: t.st.result, mode: t.st.mode, first: t.st.first, board: t.st.board.id }; });
const settle = (page) => page.waitForFunction(() => ['player', 'end'].includes(window.__twin.phase) && !window.__twin.animActive, null, { timeout: 20000 });
async function scr(page, p) { return page.evaluate(([x, y]) => window.__twin.toScreen(x, y), p); }
/** 真實滑鼠拖曳（產生 pointer 事件）；release=false 時停在終點不放開。 */
async function drag(page, a, b, release = true) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 6, A.y + ((B.y - A.y) * k) / 6);
  if (release) await page.mouse.up();
}
const pick = (c, cat) => ({
  sever: c.find((r) => r.severed && r.fired.length >= 1), pass: c.find((r) => r.passed.length >= 1 && r.fired.length >= 1), bone: c.find((r) => r.bone && r.fired.length >= 1),
  multi: c.find((r) => r.fired.length >= 3), none: c.find((r) => r.hits.length === 0), any: c.find((r) => r.fired.length >= 1),
}[cat] ?? c.find((r) => r.fired.length >= 1) ?? c[0]);
const fields = (r) => r && JSON.stringify({ fired: r.fired, severed: r.severed, passed: r.passed, bone: r.bone, dmg: r.dmg, spend: r.spend, stop: r.stop && r.stop.by, effects: r.hits.map((h) => h.k + ':' + h.effect) });

export async function runTwinTests({ bname, btype, devices, url, check }) {
  const browser = await btype.launch();
  const tag = `[${bname}][twin]`;
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  await page.goto(url + '/twin-slash/');
  await page.waitForFunction(() => !!window.__twin);
  await page.evaluate(() => window.__twin.setAiDelay(20));
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} 版本 SHA 與「研究片段」字樣`, top.includes(sha) && top.includes('研究片段') && sha && !sha.includes('__'), sha);

  // ===== TS-07 預覽＝結果（真實拖曳 ≥10 條線；A1、B2 關閉、B2 開啟拆刀；含停刀、穿過、撞骨） =====
  {
    const bad = [], seen = { sever: 0, pass: 0, bone: 0, spend: 0, fired: 0 }; let n = 0;
    const plan = [['b1', 'A1', ['sever', 'multi', 'bone', 'none', 'any']], ['b2', 'B2', ['pass', 'sever', 'multi', 'bone', 'any']], ['b3', 'B2', ['pass', 'sever', 'bone', 'multi', 'any']]];
    for (const [bd, mode, cats] of plan) {
      await page.evaluate(([b, m]) => window.__twin.newMatch(b, m), [bd, mode]); await settle(page);
      for (const cat of cats) {
        let s = await T(page); if (s.phase === 'end') break;
        const st = await page.evaluate(() => window.__twin.st);
        let useT = false;
        if (mode === 'B2' && st.charges.blue > 0 && cat === 'sever') { await page.click('#sever'); useT = true; }
        const c = candidateCuts(st, 'blue').filter((r) => r.useSever === useT);
        const line = pick(c, cat);
        await drag(page, line.a, line.b, false);
        const prev = await page.evaluate(() => window.__twin.preview);
        await page.mouse.up();
        const last = await page.evaluate(() => window.__twin.last);
        if (!last || last.side !== 'blue') { bad.push(`${bd}/${mode}/${cat}: 沒有出刀（${await page.textContent('#info')}）`); await settle(page); continue; }
        n++;
        if (!prev || fields(prev) !== fields(last)) bad.push(`${bd}/${mode}/${cat}: 預覽 ${fields(prev)} ≠ 結果 ${fields(last)}`);
        if (last.severed) seen.sever++; if (last.passed.length) seen.pass++; if (last.bone) seen.bone++; if (last.spend) seen.spend++; seen.fired += last.fired.length;
        // 紀錄（TS-15）也要與結果一致
        const lg = await page.evaluate(() => window.__twin.log.matches.at(-1).cuts.filter((x) => x.side === 'blue').at(-1));
        if (JSON.stringify([lg.fired, lg.severed, lg.passed, lg.dmg]) !== JSON.stringify([last.fired, last.severed, last.passed, last.dmg])) bad.push(`${bd}/${cat}: 紀錄≠結果`);
        await settle(page);
        s = await T(page);
        if (useT && s.toggle) bad.push(`${bd}: 出刀後拆刀未自動關閉`);
      }
    }
    // 活性：真的行使過切除、穿過、撞骨、扣次數與發動（不然「全部相等」可能只是共同什麼都沒發生）
    check(`${tag} TS-07 預覽＝結果：真實拖曳 ${n} 條線，發動／切除／穿過／撞骨／停刀／傷害／扣次數逐項相同；紀錄同結果`, n >= 10 && bad.length === 0 && seen.sever && seen.pass && seen.bone && seen.spend && seen.fired >= 10, `${JSON.stringify(seen)} ${bad.slice(0, 2).join(' | ')}`);
  }

  // ===== TS-07 回歸（Codex THECUT-TWINSLASH-R1 兩項 HIGH）：拖曳中切換拆刀、多指 =====
  {
    const bad = [];
    // ① 拖曳中切換拆刀：預覽必須跟著變，放開結果＝切換後的預覽
    await page.evaluate(() => window.__twin.newMatch('b1', 'B2', { first: 'red' })); await settle(page);
    const st = await page.evaluate(() => window.__twin.st);
    const l = candidateCuts(st, 'blue').find((r) => !r.useSever && r.passed.length && r.fired.length);
    if (st.charges.blue < 1 || !l) bad.push(`前提不成立 charges=${st.charges.blue} line=${!!l}`);
    else {
      await drag(page, l.a, l.b, false);
      const p0 = await page.evaluate(() => window.__twin.preview);
      await page.evaluate(() => document.getElementById('sever').click());      // 另一指點拆刀（刀端不動）
      const p1 = await page.evaluate(() => window.__twin.preview);
      await page.mouse.up();
      const r = await page.evaluate(() => window.__twin.last);
      if (!(p0.passed.length && !p0.spend)) bad.push('切換前預覽應為穿過');
      if (!(p1.severed && p1.spend)) bad.push(`切換後預覽未更新 ${fields(p1)}`);
      if (fields(p1) !== fields(r)) bad.push(`切換後預覽≠結果 ${fields(p1)} / ${fields(r)}`);
      await settle(page);
    }
    // ② 多指：第二指的按下／移動／放開一律忽略，結果＝第一指的刀
    await page.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(page);
    const st2 = await page.evaluate(() => window.__twin.st);
    const c = candidateCuts(st2, 'blue'), l1 = c.find((r) => r.severed), l2 = c.find((r) => r.fired.length && !r.severed && r.a.join() !== l1.a.join());
    const P = async (pts) => page.evaluate((pts) => { const cv = document.getElementById('scene'); for (const [t, id, q] of pts) cv.dispatchEvent(new PointerEvent(t, { clientX: q.x, clientY: q.y, pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true })); }, pts);
    const A1 = await scr(page, l1.a), B1 = await scr(page, l1.b), A2 = await scr(page, l2.a), B2 = await scr(page, l2.b);
    await P([['pointerdown', 1, A1], ['pointermove', 1, B1], ['pointerdown', 2, A2], ['pointermove', 2, B2]]);
    const pv = await page.evaluate(() => window.__twin.preview);
    await P([['pointerup', 2, B2]]);
    const mid = (await T(page)).cuts;
    await P([['pointerup', 1, B1]]);
    const r2 = await page.evaluate(() => window.__twin.last);
    if (mid !== 0) bad.push('第二指放開就出刀了');
    if (!r2 || r2.side !== 'blue' || fields(pv) !== fields(r2) || r2.severed !== l1.severed) bad.push(`多指：預覽 ${fields(pv)} 結果 ${fields(r2)}`);
    await settle(page);
    check(`${tag} TS-07 回歸：拖曳中切換拆刀會重算預覽且預覽＝結果；多指時只認起刀那一指`, bad.length === 0, bad.join(' | '));
    // RS-5（DL-069）：pointercancel、重開、換模式之後不殘留拖曳；下一刀正常
    const bad5 = [];
    const nextCutOk = async (lab) => {
      const stx = await page.evaluate(() => window.__twin.st);
      if (stx.turn !== 'blue') { bad5.push(`${lab}: 不是玩家回合`); return; }
      const lx = candidateCuts(stx, 'blue').find((r) => r.fired.length), c0 = stx.cuts;
      const a = await scr(page, lx.a), b = await scr(page, lx.b);
      await P([['pointerdown', 5, a], ['pointermove', 5, b], ['pointerup', 5, b]]);
      const r = await page.evaluate(() => window.__twin.last);
      await settle(page);                                                              // 狀態在演出結束才套用
      if (!r || r.side !== 'blue' || JSON.stringify(r.a.map(Math.round)) !== JSON.stringify(lx.a.map(Math.round)) || (await T(page)).cuts < c0 + 1) bad5.push(`${lab}: 下一刀異常 ${JSON.stringify({ side: r && r.side, a: r && r.a, want: lx.a, cuts: (await T(page)).cuts, c0 })}`);
    };
    const half = async () => { const stx = await page.evaluate(() => window.__twin.st); const lx = candidateCuts(stx, 'blue').find((r) => r.fired.length); await P([['pointerdown', 4, await scr(page, lx.a)], ['pointermove', 4, await scr(page, lx.b)]]); };
    await page.evaluate(() => window.__twin.newMatch('b2', 'A1', { first: 'blue' })); await settle(page);
    await half(); const pc = await T(page);
    await P([['pointercancel', 4, { x: 10, y: 10 }]]);
    if (await page.evaluate(() => window.__twin.preview) !== null || (await T(page)).cuts !== pc.cuts) bad5.push('pointercancel 後殘留預覽或出了刀');
    await nextCutOk('pointercancel');
    await page.evaluate(() => window.__twin.newMatch('b2', 'A1', { first: 'blue' })); await settle(page);
    await half(); await page.evaluate(() => document.getElementById('restart').click()); await settle(page);
    await page.evaluate(() => window.__twin.newMatch('b2', 'A1', { first: 'blue' })); await settle(page);
    await P([['pointerup', 4, { x: 100, y: 700 }]]);                                   // 舊指頭放開：不得對新局出刀
    if ((await T(page)).cuts !== 0) bad5.push('重開後舊拖曳仍出刀');
    await nextCutOk('重開');
    await page.evaluate(() => window.__twin.newMatch('b3', 'A1', { first: 'blue' })); await settle(page);
    await half(); await page.evaluate(() => document.getElementById('mB2').click()); await settle(page);
    if ((await T(page)).turn === 'blue') { const cm = (await T(page)).cuts; await P([['pointerup', 4, { x: 100, y: 700 }]]); if ((await T(page)).cuts !== cm) bad5.push('換模式後舊拖曳仍出刀'); await nextCutOk('換模式'); }
    check(`${tag} RS-5 pointercancel／重開／換模式之後不殘留拖曳，下一刀正常`, bad5.length === 0, bad5.join(' | '));
  }

  // ===== TS-04 取消；TS-05 UI（切換鈕可用性、A1 不顯示次數） =====
  {
    await page.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(page);
    const s0 = await T(page);
    const st = await page.evaluate(() => window.__twin.st);
    const line = pick(candidateCuts(st, 'blue'), 'sever');
    const c0 = await page.evaluate(() => window.__twin.log.matches.at(-1).cancels);
    // ≥120 再拉回起點附近放開＝取消
    const A = await scr(page, line.a), B = await scr(page, line.b);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.move(A.x + 2, A.y + 2, { steps: 6 }); await page.mouse.up();
    const s1 = await T(page), c1 = await page.evaluate(() => window.__twin.log.matches.at(-1).cancels);
    // 拖不到 120 就放開：什麼都不發生（不算取消）
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(A.x + 20, A.y + 10, { steps: 3 }); await page.mouse.up();
    const s2 = await T(page), c2 = await page.evaluate(() => window.__twin.log.matches.at(-1).cancels);
    const a1Hidden = await page.isHidden('#sever');
    check(`${tag} TS-04 取消：拖到 ≥120 再拉回＝取消（不出刀、不換回合、資源不變）；不到 120＝無事`, JSON.stringify(s0) === JSON.stringify(s1) && JSON.stringify(s1) === JSON.stringify(s2) && c1 === c0 + 1 && c2 === c1 && s1.phase === 'player', `${c0}→${c1}→${c2}`);
    // B2：0 次時切換鈕不可用；有次數後可開，取消不改切換狀態
    await page.evaluate(() => window.__twin.newMatch('b1', 'B2', { first: 'blue' })); await settle(page);
    const dis0 = (await T(page)).charges.blue === 0 && await page.isDisabled('#sever');
    let guard = 0;
    while ((await T(page)).charges.blue < 1 && guard++ < 8) {
      const s = await T(page); if (s.phase === 'end') { await page.evaluate(() => window.__twin.newMatch('b1', 'B2')); await settle(page); continue; }
      const stx = await page.evaluate(() => window.__twin.st);
      const l = pick(candidateCuts(stx, 'blue'), 'none'); await drag(page, l.a, l.b); await settle(page);
    }
    const ch = await T(page);
    let toggleOk = false, cancelKeep = false;
    if (ch.charges.blue >= 1 && ch.phase === 'player') {
      await page.click('#sever'); toggleOk = (await T(page)).toggle === true;
      const stx = await page.evaluate(() => window.__twin.st), l = pick(candidateCuts(stx, 'blue'), 'sever');
      const A2 = await scr(page, l.a), B2 = await scr(page, l.b);
      await page.mouse.move(A2.x, A2.y); await page.mouse.down(); await page.mouse.move(B2.x, B2.y, { steps: 6 }); await page.mouse.move(A2.x + 1, A2.y + 1, { steps: 6 }); await page.mouse.up();
      const after = await T(page); cancelKeep = after.toggle === true && after.charges.blue === ch.charges.blue && after.cuts === ch.cuts;
    }
    check(`${tag} TS-05 UI：A1 不顯示拆刀；B2 0 次時不可用；有次數可開啟；取消不改切換與次數`, a1Hidden && dis0 && toggleOk && cancelKeep, JSON.stringify({ a1Hidden, dis0, charges: ch.charges.blue, toggleOk, cancelKeep }));
  }

  // ===== TS-10 AI 不偷看：AI 回合中拖曳無效；AI 刀＝aiChoose(玩家出刀後的已結算盤面)，與拖曳無關 =====
  {
    const runs = [];
    for (const wiggle of [false, true]) {
      await page.evaluate(() => window.__twin.newMatch('b2', 'A1', { first: 'blue', seed: 4242 })); await settle(page);
      await page.evaluate(() => window.__twin.setAiDelay(900));
      const st = await page.evaluate(() => window.__twin.st);
      const l = pick(candidateCuts(st, 'blue'), 'multi');
      await drag(page, l.a, l.b);
      await page.waitForFunction(() => window.__twin.phase === 'ai', null, { timeout: 8000 });
      const locked = await page.evaluate(() => window.__twin.st);
      if (wiggle) { const o = candidateCuts(locked, 'red')[5]; await drag(page, [o.a[0], o.a[1] + 400], [o.b[0], o.b[1] + 300]); await drag(page, [200, 800], [500, 600]); }
      const midCuts = (await T(page)).cuts;
      await settle(page);
      const ai = await page.evaluate(() => window.__twin.last);
      const want = aiChoose(locked);
      runs.push({ same: JSON.stringify([ai.a, ai.b, ai.fired, ai.severed]) === JSON.stringify([want.a, want.b, want.fired, want.severed]), side: ai.side, midCuts, lockedCuts: locked.cuts, a: ai.a.join(',') });
      await page.evaluate(() => window.__twin.setAiDelay(20));
    }
    check(`${tag} TS-10 AI 刀路＝aiChoose(已結算盤面)；AI 回合中玩家拖曳不產生效果（有無拖曳逐值相同）`, runs.every((r) => r.same && r.side === 'red' && r.midCuts === r.lockedCuts) && runs[0].a === runs[1].a, JSON.stringify(runs));
  }

  // ===== TS-11 切割回饋事件；減少模式；TS-08 結算畫面 =====
  {
    await page.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(page);
    if (await page.evaluate(() => window.__twin.reduced)) await page.click('#reduce');
    await page.evaluate(() => window.__twin.setAiDelay(5000));                      // 只看玩家這一刀的事件
    const st = await page.evaluate(() => window.__twin.st);
    const l = pick(candidateCuts(st, 'blue'), 'sever');
    await page.evaluate(() => window.__twin.clearFx());
    const g0 = await page.evaluate(() => window.__twin.fx);
    await drag(page, l.a, l.b);
    const at = await page.evaluate(() => ({ hs: window.__twin.fx.hitstopMs, act: window.__twin.fx.hitstopActive, anim: window.__twin.animActive }));
    await page.waitForFunction(() => !window.__twin.animActive, null, { timeout: 8000 });
    const fx = await page.evaluate(() => window.__twin.fx), res = await page.evaluate(() => window.__twin.last);
    const fires = fx.events.filter((e) => e.type === 'fire').map((e) => e.k), splits = fx.events.filter((e) => e.type === 'split').map((e) => e.k);
    const okSever = at.hs >= 50 && at.anim && JSON.stringify(fires) === JSON.stringify(res.fired) && JSON.stringify(splits) === JSON.stringify([res.severed]) && fx.audio[0] === 'slash' && fx.audio.includes('fire') && fx.audio.includes('sever');
    check(`${tag} TS-11 放開即頓格 ≥50ms＋刀光；依命中順序點燃；切除沿刀線分離；揮刀／發動／切肉音效`, okSever && fx.bloodSpawned > g0.bloodSpawned && fx.shakes > g0.shakes && !fx.hitstopActive, JSON.stringify({ at, fires, fired: res.fired, splits, severed: res.severed, audio: fx.audio }));
    // 撞骨：火花＋撞骨聲
    await page.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(page);
    const st2 = await page.evaluate(() => window.__twin.st), lb = pick(candidateCuts(st2, 'blue'), 'bone');
    await page.evaluate(() => window.__twin.clearFx()); await drag(page, lb.a, lb.b);
    await page.waitForFunction(() => !window.__twin.animActive, null, { timeout: 8000 });
    const fb = await page.evaluate(() => window.__twin.fx), rb = await page.evaluate(() => window.__twin.last);
    check(`${tag} TS-11 撞骨：停刀點火花＋撞骨聲`, !!rb.bone && fb.events.some((e) => e.type === 'spark' && e.k === rb.bone) && fb.audio.includes('clang'), JSON.stringify({ bone: rb.bone, audio: fb.audio }));
    // 減少模式：不閃白、不震、不噴血、不呼叫震動
    await page.click('#reduce');
    await page.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(page);
    const st3 = await page.evaluate(() => window.__twin.st);
    const big = candidateCuts(st3, 'blue').filter((r) => r.severed).sort((x, y) => y.dmg - x.dmg)[0];
    const f0 = await page.evaluate(() => window.__twin.fx);
    await drag(page, big.a, big.b);
    await page.waitForFunction(() => !window.__twin.animActive, null, { timeout: 8000 });
    const f1 = await page.evaluate(() => window.__twin.fx);
    const red = await page.evaluate(() => window.__twin.reduced);
    check(`${tag} TS-11 減少閃爍震動血腥：不閃白、不震、不噴血、不呼叫震動；仍有切除分離`, red && !!big && f1.flashes === f0.flashes && f1.vibrations === f0.vibrations && f1.bloodSpawned === f0.bloodSpawned && f1.shakes === f0.shakes && f1.events.some((e) => e.type === 'split'), JSON.stringify({ flashes: [f0.flashes, f1.flashes], vib: [f0.vibrations, f1.vibrations], blood: [f0.bloodSpawned, f1.bloodSpawned], shakes: [f0.shakes, f1.shakes], dmg: big.dmg }));
    await page.click('#reduce');
    await page.evaluate(() => window.__twin.setAiDelay(20)); await settle(page);
    // 打完一局：結算畫面
    let g = 0;
    while ((await T(page)).phase !== 'end' && g++ < 10) { const s = await page.evaluate(() => window.__twin.st); const x = pick(candidateCuts(s, 'blue'), 'multi'); await drag(page, x.a, x.b); await settle(page); }
    const end = await T(page), info = await page.textContent('#info');
    const want = end.result && (end.result.winner === 'draw' ? '平手' : end.result.winner === 'blue' ? '你贏了' : '你輸了');
    check(`${tag} TS-08 結算畫面顯示勝負與原因`, end.phase === 'end' && info.includes(want) && info.includes(end.result.reason === 'kill' ? '一刀致命' : '8 刀用完比血'), info.slice(0, 60));
    // 重播上一刀：不改狀態
    const before = JSON.stringify(await page.evaluate(() => window.__twin.st));
    await page.click('#replay'); const replaying = await page.evaluate(() => window.__twin.animActive);
    await page.waitForFunction(() => !window.__twin.animActive, null, { timeout: 8000 });
    check(`${tag} 重播上一刀：播放演出、狀態不變`, replaying && JSON.stringify(await page.evaluate(() => window.__twin.st)) === before && (await T(page)).phase === 'end');

    // ===== TS-09 重開交換先後手；重開、換模式、換盤面後狀態乾淨 =====
    const bad = [];
    const clean = async (lab, bd, md) => {
      const s = await page.evaluate(() => ({ st: window.__twin.st, toggle: window.__twin.toggle, m: window.__twin.log.matches.at(-1) }));
      // 期望＝規則引擎的全新開局（他先手時再加上 AI 的第一刀），整個狀態逐值比對
      let want = newState(s.st.board, md, s.st.first, s.st.seed);
      if (s.st.first === 'red') want = applyCut(want, aiChoose(want));
      if (s.st.board.id !== bd || s.st.mode !== md) bad.push(`${lab}: 盤面／模式 ${s.st.board.id}/${s.st.mode}`);
      if (JSON.stringify(s.st) !== JSON.stringify(want)) bad.push(`${lab}: 狀態≠全新開局`);
      if (s.toggle || s.m.cuts.length !== want.cuts || s.m.cancels !== 0 || s.m.board !== bd || s.m.mode !== md) bad.push(`${lab}: 切換鈕／紀錄殘留`);
      return s.st.first;
    };
    const f1st = (await T(page)).first;
    await page.click('#restart'); await settle(page);
    const f2 = await clean('重開', 'b1', 'A1');
    await page.click('#mB2'); await settle(page); await clean('換模式', 'b1', 'B2');
    await page.click('#bd3'); await settle(page); await clean('換盤面', 'b3', 'B2');
    const nMatches = await page.evaluate(() => window.__twin.log.matches.length);
    check(`${tag} TS-09 重開交換先後手；重開／換模式／換盤面後狀態乾淨、紀錄分局`, f2 !== f1st && bad.length === 0 && nMatches >= 4, `${f1st}→${f2} ${bad.slice(0, 2).join(' | ')}`);

    // ===== TS-15 紀錄欄位＋複製 =====
    const log = await page.evaluate(() => window.__twin.log);
    const all = log.matches.flatMap((m) => m.cuts), cut = all.find((c) => c.passed.length) ?? all[0];
    const KEYS = ['n', 'side', 'a', 'b', 'useSever', 'fired', 'dmg', 'severed', 'passed', 'stopBy', 'chargesBefore', 'chargesAfter', 'meterBefore', 'meterAfter', 'foeChargesAfter', 'foeMeterAfter'].sort();
    const topOk = log.format === 'thecut-twinslash-log/1' && log.commit === sha && log.matches.every((m) => m.board && m.mode && m.first && Array.isArray(m.cuts));
    await page.click('#exportBtn'); await page.waitForTimeout(150);
    const copied = await page.evaluate(() => window.__copied ?? null), modal = await page.isVisible('#exportModal');
    const txt = copied ?? (modal ? await page.inputValue('#exportBox') : '');
    if (modal) await page.click('#exportClose');
    check(`${tag} TS-15 每刀紀錄欄位齊全（穿過與切除分開）；一鍵複製（${copied ? '剪貼簿' : '備援文字框'}）`, topOk && JSON.stringify(Object.keys(cut).sort()) === JSON.stringify(KEYS) && Array.isArray(cut.passed) && 'severed' in cut && txt.includes('thecut-twinslash-log/1'), JSON.stringify(Object.keys(cut)));
    check(`${tag} 全程無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
  }
  await ctx.close();

  // ===== TS-12 手機：兩種尺寸版面；觸控出刀與取消；拖曳不捲動 =====
  for (const [sname, [w, h]] of Object.entries(SIZES)) {
    const { ctx: c2, page: p } = await newPage(browser, bname, devices, w, h);
    await p.goto(url + '/twin-slash/'); await p.waitForFunction(() => !!window.__twin);
    await p.evaluate(() => window.__twin.setAiDelay(20));
    await p.evaluate(() => window.__twin.newMatch('b1', 'A1', { first: 'blue' })); await settle(p);
    const lay = await p.evaluate(([w, h]) => {
      const vis = (e) => e.offsetParent !== null && !e.hidden;
      const boxes = [...document.querySelectorAll('button')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, w: r.width, h: r.height, x: r.x, y: r.y, r: r.right, b: r.bottom }; });
      const overlap = []; for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) { const P = boxes[a], Q = boxes[c]; if (P.x < Q.r - 1 && Q.x < P.r - 1 && P.y < Q.b - 1 && Q.y < P.b - 1) overlap.push(`${P.id}/${Q.id}`); }
      const cv = document.getElementById('scene').getBoundingClientRect();
      return { small: boxes.filter((b) => b.w < 44 || b.h < 44).map((b) => b.id), overlap, out: boxes.filter((b) => b.x < 0 || b.y < 0 || b.r > w + 1 || b.b > h + 1).map((b) => b.id), hscroll: document.documentElement.scrollWidth > w + 1, cvH: Math.round(cv.height), ta: getComputedStyle(document.getElementById('scene')).touchAction };
    }, [w, h]);
    const st = await p.evaluate(() => window.__twin.st), l = pick(candidateCuts(st, 'blue'), 'sever');
    const A = await scr(p, l.a), B = await scr(p, l.b);
    const y0 = await p.evaluate(() => [scrollX, scrollY, visualViewport ? visualViewport.scale : 1].join(','));
    let how;
    const touchDrag = async (pts) => {
      if (bname === 'chromium') {
        const cdp = await c2.newCDPSession(p);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
        for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q.x, y: q.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        how = '觸控（CDP）';
      } else {
        // Playwright 的 WebKit 沒有觸控拖曳 API：在畫布上派送 pointerType=touch 的合成 PointerEvent（走同一組處理器）
        await p.evaluate((pts) => { const cv = document.getElementById('scene'); const ev = (t, q) => cv.dispatchEvent(new PointerEvent(t, { clientX: q.x, clientY: q.y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true })); ev('pointerdown', pts[0]); for (const q of pts.slice(1, -1)) ev('pointermove', q); ev('pointermove', pts.at(-1)); ev('pointerup', pts.at(-1)); }, pts);
        how = '合成觸控 PointerEvent';
      }
    };
    const path = (P, Q, n = 8) => Array.from({ length: n + 1 }, (_, k) => ({ x: P.x + ((Q.x - P.x) * k) / n, y: P.y + ((Q.y - P.y) * k) / n }));
    const s0 = await T(p);
    await touchDrag([...path(A, B), ...path(B, { x: A.x + 1, y: A.y + 1 })]);         // 觸控取消
    const s1 = await T(p);
    await touchDrag(path(A, B));                                                         // 觸控出刀
    await settle(p);
    const s2 = await T(p);
    const y1 = await p.evaluate(() => [scrollX, scrollY, visualViewport ? visualViewport.scale : 1].join(','));
    const layOk = lay.small.length === 0 && lay.overlap.length === 0 && lay.out.length === 0 && !lay.hscroll && lay.cvH >= 300 && lay.ta === 'none';
    check(`${tag} TS-12 ${sname} ${w}×${h}：按鈕 ≥44px 不重疊不出界、無橫捲、畫布 touch-action:none；${how}可取消、可出刀；頁面不捲動不縮放`,
      layOk && s1.cuts === s0.cuts && s1.phase === 'player' && s2.cuts >= s0.cuts + 1 && y0 === y1 && p.__errs.length === 0, JSON.stringify({ lay, cuts: [s0.cuts, s1.cuts, s2.cuts], y0, y1 }));
    await c2.close();
  }

  // ===== 子路徑 PWA：manifest／service worker 範圍與快取前綴獨立 =====
  if (bname === 'chromium') {
    const c3 = await browser.newContext(); const p = await c3.newPage();
    await p.goto(url + '/twin-slash/');
    const r = await p.evaluate(async () => { const reg = await navigator.serviceWorker.ready; const m = await (await fetch('./manifest.webmanifest')).json(); const keys = await caches.keys(); return { scope: reg.scope, id: m.id, mscope: m.scope, keys }; });
    check(`${tag} 子路徑 PWA：SW 範圍＝/twin-slash/、manifest id＝twin-slash、快取前綴 thecut-twinslash-`, r.scope.endsWith('/twin-slash/') && r.id === 'twin-slash' && r.mscope === './' && r.keys.length > 0 && r.keys.every((k) => k.startsWith('thecut-twinslash-')), JSON.stringify(r));
    await c3.close();
  }
  await browser.close();
}
