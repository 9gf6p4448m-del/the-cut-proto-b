// FT-04 紀錄內容（真實流程，≥4 局）。真值一律由「?devlog=1 的原始事件流（window.__duel6Test）＋測試自己在結算表出現時對遊戲狀態拍的快照＋測試自己知道的流程」獨立算出，
// 絕不讀 playlog 模組的值；被驗對象＝複製出的文字（JSON 區塊與摘要行）。平手局用 Node 端模擬（ft_tie.mjs）預先算好的整數座標刀線在瀏覽器真實拖曳重放，不使用 ?devtie=。
// 主 session 裁定的定義：tutorial done＝示範自然結束進提示階段（示範中被打斷＝aborted、按跳過＝skipped、直線模式第一次沒出現＝none、之前看過＝before）；
// 選怪獸畫面再按重新征途不產生局且沿用 startedVia；事件流 step＝s0.step；skill 事件在技能生效時、skillUse 在結算時含 pierceCount；cut 事件 side＝切的人。
import { advT, deepEq, driveRun, feedStroke, lineMode, openPage, parseCopy, playFree, playLineGreedy, playPassive, schedulePlayer, scr, storedRuns, tapEl } from './ft_common.mjs';
import { affineOf, findTieSeeds } from './ft_tie.mjs';

const PLAYER_LINE = async (page) => { await playLineGreedy(page); };
const PLAYER_FREE_SKILL = (page) => playFree(page, { skillFirst: true });
const PLAYER_PASSIVE = (page) => playPassive(page);

/** 事件流 → 每局 {e: run 事件, stages:[{e, ev}], tut, restarts, end}。 */
export function splitEvents(events) {
  const runs = []; let run = null, st = null;
  for (const e of events) {
    if (e.k === 'run') { run = { e, stages: [], tut: [], restarts: [], end: null }; runs.push(run); st = null; }
    else if (!run) continue;
    else if (e.k === 'stage') { st = { e, ev: [] }; run.stages.push(st); }
    else if (e.k === 'tut') run.tut.push(e);
    else if (e.k === 'restart') run.restarts.push(e);
    else if (e.k === 'runEnd') run.end = e;
    else if (st) st.ev.push(e);
  }
  return runs;
}
const countsOf = (arr) => { const o = {}; for (const k of arr) o[k] = (o[k] ?? 0) + 1; return o; };
const sortedEntries = (o) => JSON.stringify(Object.entries(o || {}).sort());
const near = (a, b, tol) => (a === null && b === null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol);

/** 一場的真值（事件流＋快照）。 */
function truthStage(stg, snap) {
  const ev = stg.ev, cuts = ev.filter((x) => x.k === 'cut'), blue = cuts.filter((x) => x.side === 'blue'), red = cuts.filter((x) => x.side === 'red');
  const strokes = ev.filter((x) => x.k === 'stroke' && !x.tap), pushes = ev.filter((x) => x.k === 'push').map((x) => x.push);
  const skill = ev.find((x) => x.k === 'skill' && x.side === 'blue'), use = ev.find((x) => x.k === 'skillUse'), fast = ev.filter((x) => x.k === 'fast');
  return {
    cutsEv: blue.length, cutByEv: red.length, firstCutSec: blue.length ? Math.min(...blue.map((x) => x.step)) / 60 : null, strokes: strokes.length,
    locks: strokes.reduce((a, x) => a + (x.locks || 0), 0), blocked: strokes.reduce((a, x) => a + (x.blocked || 0), 0),
    maxPush: Math.max(0, ...pushes), maxPushAi: Math.max(0, ...pushes.map((p) => -p)),
    skill: skill ? { sec: skill.step / 60, kind: skill.kind, pierce: use ? use.pierceCount : undefined } : null,
    fastAt: fast.length ? Math.round(fast[0].bClock) : null, fastN: fast.length, bat: ev.find((x) => x.k === 'battle'), stitchEv: ev.find((x) => x.k === 'stitch'),
    snap,
  };
}

/** 比對一頁的所有局。回傳 {bad:{類別:[訊息]}, cover:{...}}。 */
export function verifyRuns({ copyText, stored, events, scns, sha, wallSec }) {
  const bad = { json: [], via: [], result: [], tut: [], cuts: [], firstCut: [], strokes: [], push: [], battle: [], stitch: [], other: [], summary: [] };
  const push = (cat, m) => bad[cat].push(m);
  const P = parseCopy(copyText), runsEv = splitEvents(events), recs = P.json;
  const cover = { beasts: new Set(), results: new Set(), tieStages: 0, replayTies: 0, fast: 0, skipped: 0, abandonedThenRestart: 0, againAfterEnd: 0, stagesRecorded: 0, runs: 0 };
  if (P.err || !Array.isArray(recs)) { push('json', `JSON 區塊無法解析：${P.err}`); return { bad, cover }; }
  if (!P.hasFence || P.n === null) push('json', `首行或區塊格式不符：${P.head}`);
  if (P.sha !== sha) push('json', `首行 sha=${P.sha} ≠ 畫面 ${sha}`);
  if (P.n !== recs.length) push('json', `首行 N=${P.n} ≠ JSON ${recs.length} 局`);
  if (!deepEq(recs, stored)) push('json', '複製出的 JSON ≠ localStorage 內容');
  if (recs.length !== scns.length || runsEv.length !== scns.length) push('other', `局數：JSON ${recs.length}／事件流 ${runsEv.length}／腳本 ${scns.length}`);
  for (let i = 0; i < Math.min(recs.length, scns.length, runsEv.length); i++) {
    const rec = recs[i], scn = scns[i], run = runsEv[i], tag = `#${i + 1}`;
    cover.runs++; cover.beasts.add(scn.beast);
    // ---- 局層
    if (rec.runIdx !== i + 1) push('other', `${tag} runIdx=${rec.runIdx}`);
    if (rec.startedVia !== scn.via || run.e.via !== scn.via) push('via', `${tag} startedVia=${rec.startedVia} 事件=${run.e.via} 預期=${scn.via}`);
    if (rec.beast !== scn.beast || run.e.beast !== scn.beast) push('other', `${tag} beast=${rec.beast} 預期=${scn.beast}`);
    if (rec.cutSec !== 30 || run.e.cutSec !== 30) push('other', `${tag} cutSec=${rec.cutSec}`);
    if (rec.input !== run.e.input || rec.input !== scn.input) push('other', `${tag} input=${rec.input} 事件=${run.e.input}`);
    let tut = run.e.tutorialInit; for (const x of run.tut) tut = x.what === 'skip' ? 'skipped' : 'done';
    if (rec.tutorial !== tut || rec.tutorial !== scn.tut) push('tut', `${tag} tutorial=${rec.tutorial} 事件推得=${tut} 腳本預期=${scn.tut}`);
    const resTruth = run.end ? run.end.result : run.restarts.some((r) => r.ui !== 'beast' && r.ui !== 'end') ? 'abandoned' : 'playing';
    if (rec.result !== resTruth || (scn.abandon && rec.result !== 'abandoned')) push('result', `${tag} result=${rec.result} 事件推得=${resTruth} abandon預期=${!!scn.abandon}`);
    if (rec.ver !== 'duel6' || rec.sha !== sha) push('other', `${tag} ver/sha=${rec.ver}/${rec.sha}`);
    if (i === 0 ? rec.gapSec !== null : !(typeof rec.gapSec === 'number' && rec.gapSec >= 0 && rec.gapSec <= wallSec + 1)) push('other', `${tag} gapSec=${rec.gapSec}`);
    if (!(typeof rec.totalSec === 'number' && rec.totalSec > 0 && rec.totalSec <= wallSec + 1)) push('other', `${tag} totalSec=${rec.totalSec}`);
    cover.results.add(resTruth);
    if (scn.abandon && scns[i + 1]?.via === 'restart') cover.abandonedThenRestart++;
    if (scn.via === 'again' && i > 0 && ['won', 'lost'].includes(recs[i - 1].result)) cover.againAfterEnd++;
    if (rec.tutorial === 'skipped') cover.skipped++;
    // ---- 場層
    if (rec.stages.length !== scn.snaps.length) push('other', `${tag} stages=${rec.stages.length} 結算表快照=${scn.snaps.length}`);
    for (let j = 0; j < Math.min(rec.stages.length, scn.snaps.length, run.stages.length); j++) {
      const s = rec.stages[j], snap = scn.snaps[j], t = truthStage(run.stages[j], snap), tg = `${tag}場${j + 1}`;
      cover.stagesRecorded++;
      if (s.stage !== snap.stage || s.replay !== snap.replay || run.stages[j].e.stage !== snap.stage || run.stages[j].e.replay !== snap.replay) push('other', `${tg} stage/replay=${s.stage}/${s.replay} 快照=${snap.stage}/${snap.replay}`);
      if (s.cuts !== snap.sevBlue || s.cutBy !== snap.sevRed || s.cuts !== t.cutsEv || s.cutBy !== t.cutByEv) push('cuts', `${tg} cuts=${s.cuts} cutBy=${s.cutBy}｜severedN=${snap.sevBlue}:${snap.sevRed}｜事件=${t.cutsEv}:${t.cutByEv}`);
      if (!near(s.firstCutSec, t.firstCutSec, 0.1)) push('firstCut', `${tg} firstCutSec=${s.firstCutSec} 真值=${t.firstCutSec}`);
      if (s.strokes !== t.strokes) push('strokes', `${tg} strokes=${s.strokes} 事件=${t.strokes}`);
      if (scn.input === 'line' ? (s.locks !== t.locks || s.blocked !== t.blocked) : (s.locks < t.locks || s.blocked < t.blocked)) push('strokes', `${tg} locks/blocked=${s.locks}/${s.blocked} 事件=${t.locks}/${t.blocked}`);
      if (s.maxPush !== t.maxPush || s.maxPush !== snap.ft.mx || s.maxPushAi !== t.maxPushAi || s.maxPushAi !== snap.ft.ma) push('push', `${tg} maxPush=${s.maxPush}/${s.maxPushAi} 事件=${t.maxPush}/${t.maxPushAi} 逐步觀測=${snap.ft.mx}/${snap.ft.ma}`);
      const sk = t.skill;
      if (sk === null ? s.skill !== null : (!s.skill || !near(s.skill.sec, sk.sec, 0.01) || (sk.kind === 'pierce' ? s.skill.pierce !== sk.pierce : s.skill.pierce !== undefined))) push('battle', `${tg} skill=${JSON.stringify(s.skill)} 真值=${JSON.stringify(sk)}`);
      if (s.battle.winner !== snap.battle.winner || s.battle.how !== snap.battle.how || s.battle.ms !== snap.battle.endMs || !t.bat || t.bat.winner !== s.battle.winner || t.bat.ms !== s.battle.ms) push('battle', `${tg} battle=${JSON.stringify(s.battle)} 快照=${JSON.stringify(snap.battle)}`);
      if (s.battle.fastAtMs !== t.fastAt || t.fastN > 1) push('battle', `${tg} fastAtMs=${s.battle.fastAtMs} 事件=${t.fastAt}（事件數 ${t.fastN}）`);
      if (t.fastN) cover.fast++;
      const tb = snap.battle.winner === 'draw' ? { blue: snap.sevBlue, red: snap.sevRed, result: snap.sevBlue > snap.sevRed ? 'win' : snap.sevBlue < snap.sevRed ? 'loss' : 'replay' } : null;
      if (!deepEq(s.tiebreak, tb)) push('battle', `${tg} tiebreak=${JSON.stringify(s.tiebreak)} 真值=${JSON.stringify(tb)}`);
      if (tb) { cover.tieStages++; if (tb.result === 'replay') cover.replayTies++; }
      if (sortedEntries(countsOf(s.endOrgans.blue)) !== sortedEntries(snap.matchup?.me) || sortedEntries(countsOf(s.endOrgans.red)) !== sortedEntries(snap.matchup?.foe)) push('battle', `${tg} endOrgans=${JSON.stringify(s.endOrgans)} 開戰前對照=${JSON.stringify(snap.matchup)}`);
      if (s.input !== snap.input) push('other', `${tg} stage.input=${s.input} 快照=${snap.input}`);
      const stExp = snap.stitch ? { offer: snap.stitch.offer, picked: snap.stitch.picked, p: { x: snap.stitch.p[0], y: snap.stitch.p[1] } } : null;
      if (!deepEq(s.stitch, stExp) || (stExp && (!t.stitchEv || !deepEq(t.stitchEv.offer, stExp.offer) || t.stitchEv.picked !== stExp.picked))) push('stitch', `${tg} stitch=${JSON.stringify(s.stitch)} 真值=${JSON.stringify(stExp)}`);
    }
    // ---- 摘要行（數字從文字 regex 反解，與 JSON 比）
    const hi = P.summary.findIndex((l) => l.startsWith(`#${rec.runIdx} `));
    if (hi < 0) { push('summary', `${tag} 找不到摘要行`); continue; }
    const head = P.summary[hi], hm = /^#(\d+) (蛇|龍) (\S+) (\S+)｜/.exec(head);
    const gm = /間隔 ([\d.]+) 秒/.exec(head), tm = /共 ([\d.]+) 秒/.exec(head), cm = /切割期 (\d+) 秒/.exec(head);
    if (!hm || (hm[2] === '蛇') !== (rec.beast === 'snake')) push('summary', `${tag} 首行 beast：${head}`);
    if (!tm || Number(tm[1]) !== rec.totalSec || !cm || Number(cm[1]) !== rec.cutSec || (rec.gapSec === null ? !!gm : !gm || Number(gm[1]) !== rec.gapSec)) push('summary', `${tag} 首行數字≠JSON：${head}`);
    if (rec.stages.length) {
      const segs = (P.summary[hi + 1] || '').split('｜');
      if (segs.length !== rec.stages.length) push('summary', `${tag} 場數 ${segs.length}≠${rec.stages.length}`);
      rec.stages.forEach((s, j) => {
        const g = segs[j] || '', m1 = /第 (\d+) 場/.exec(g), m2 = /切 (\d+) 被切 (\d+)/.exec(g), m3 = /重打(\d+)/.exec(g), m4 = /首刀 ([\d.]+) 秒/.exec(g), m5 = /技能 ([\d.]+) 秒/.exec(g), m6 = /快轉 (\d+)ms/.exec(g), m7 = /平手比切除 (\d+)：(\d+) (勝|敗|重打)/.exec(g);
        const ok = m1 && Number(m1[1]) === s.stage && m2 && Number(m2[1]) === s.cuts && Number(m2[2]) === s.cutBy && (s.replay > 0 ? m3 && Number(m3[1]) === s.replay : !m3)
          && (s.firstCutSec === null ? !m4 : m4 && Number(m4[1]) === s.firstCutSec) && (s.skill ? m5 && Number(m5[1]) === s.skill.sec : !m5) && (s.battle.fastAtMs === null ? !m6 : m6 && Number(m6[1]) === s.battle.fastAtMs)
          && (s.tiebreak ? m7 && Number(m7[1]) === s.tiebreak.blue && Number(m7[2]) === s.tiebreak.red && m7[3] === { win: '勝', loss: '敗', replay: '重打' }[s.tiebreak.result] : !m7);
        if (!ok) push('summary', `${tag}場${j + 1} 摘要≠JSON：${g}`);
      });
    }
  }
  return { bad, cover };
}

const bootClick = async (page, beast) => { await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 }); await tapEl(page, beast === 'snake' ? '#beastSnake' : '#beastDragon'); await page.waitForFunction(() => window.__cb.ui === 'cut' && !!window.__cb.camp, null, { timeout: 8000 }); };
const startAt = (page, beast, seed) => page.evaluate(([s, b]) => window.__cb.newRun({ seed: s, beast: b }), [seed, beast]);   // 選怪獸畫面已出現（保留 pendingVia）；直接指定種子與怪獸
const copyOut = async (page) => {
  await page.evaluate(() => { window.__copied = undefined; });
  if ((await page.evaluate(() => window.__cb.ui)) === 'end') await tapEl(page, '#copyEnd'); else { await tapEl(page, '#logBtn'); await tapEl(page, '#logCopy'); }
  await page.waitForFunction(() => window.__copied !== undefined || !document.getElementById('copyFb').hidden, null, { timeout: 6000 });
  return page.evaluate(() => window.__copied ?? document.getElementById('copyTa').value);
};
const evsOf = (page) => page.evaluate(() => window.__duel6Test.events);
const setup = (page) => page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 0.05 }); });

export async function runFt04({ browser, bname, devices, url, check, sub }) {
  const tag = `[${bname}][${sub}]`, allBad = {}, cover = { beasts: new Set(), results: new Set(), tieStages: 0, replayTies: 0, fast: 0, skipped: 0, abandonedThenRestart: 0, againAfterEnd: 0, stagesRecorded: 0, runs: 0 };
  const merge = (r, label) => { for (const [k, v] of Object.entries(r.bad)) (allBad[k] = allBad[k] || []).push(...v.map((m) => `${label} ${m}`)); for (const k of ['tieStages', 'replayTies', 'fast', 'skipped', 'abandonedThenRestart', 'againAfterEnd', 'stagesRecorded', 'runs']) cover[k] += r.cover[k]; r.cover.beasts.forEach((b) => cover.beasts.add(b)); r.cover.results.forEach((b) => cover.results.add(b)); };
  const errs = [], dialogs = [];
  const finish = async (page, scns, label, t0) => {
    const text = await copyOut(page), stored = await storedRuns(page, sub), events = await evsOf(page), sha = await page.textContent('#sha');
    merge(verifyRuns({ copyText: text, stored, events, scns, sha, wallSec: (Date.now() - t0) / 1000 }), label);
    errs.push(...page.__errs); dialogs.push(...page.__dialogs);
  };
  let tieInfo = { note: '' };

  // ===== P1：直線預覽。R1 龍 seed3 貪婪打滿三場（含縫合、快轉）→ #again → R2 平手重打型 → #again → R3 平手判敗型 =====
  {
    const t0 = Date.now(), { ctx, page } = await openPage({ browser, bname, devices, url, sub, q: '?devlog=1', init: [lineMode(sub)] });
    await setup(page);
    const aff = affineOf(await scr(page, [0, 0]), await scr(page, [700, 0]));
    const ties = findTieSeeds(aff), lossLike = ties.loss ?? ties.win;
    tieInfo = { replay: ties.replay && ties.replay.seed, loss: lossLike && lossLike.seed, tried: ties.tried };
    const scns = []; let fastErr = '';
    const fastHook = async (pg, n) => {
      if (n !== 0) return;
      await pg.evaluate(() => window.__cb.setTimings({ battleScale: 0.4 }));
      try {
        await pg.waitForFunction(() => !document.getElementById('fast').disabled, null, { timeout: 10000 });
        for (let i = 0; i < 3; i++) { await pg.click('#fast'); await pg.waitForFunction((k) => document.getElementById('fast').textContent === (k % 2 === 0 ? '正常速度' : '快轉'), i, { timeout: 4000 }); }
      } catch (e) { fastErr = String(e).slice(0, 80); }
      await pg.evaluate(() => window.__cb.setTimings({ battleScale: 0.05 }));
    };
    await page.evaluate(() => window.__cb.newRun({ seed: 3 }));   // 尚無 camp：停在選怪獸畫面、只換種子；startedVia 仍是 first
    await bootClick(page, 'dragon');
    const r1 = await driveRun(page, { player: PLAYER_LINE, onBattle: fastHook });
    scns.push({ via: 'first', beast: 'dragon', tut: 'none', input: 'line', snaps: r1.snaps });
    const nextRun = async (seed, beast, player, label) => {
      const viaBtn = (await page.evaluate(() => window.__cb.ui)) === 'end' ? '#again' : '#restart';
      await tapEl(page, viaBtn); await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
      await startAt(page, beast, seed);
      const r = await driveRun(page, { player });
      scns.push({ via: viaBtn === '#again' ? 'again' : 'restart', beast, tut: 'none', input: 'line', snaps: r.snaps, label });
      return r;
    };
    const rep = ties.replay, lo = lossLike;
    const r2 = await nextRun(rep ? rep.seed : 2, 'dragon', rep ? schedulePlayer(rep.sched) : PLAYER_PASSIVE, 'tie-replay');
    const r3 = await nextRun(lo ? lo.seed : 2, 'dragon', lo ? schedulePlayer(lo.sched) : PLAYER_PASSIVE, 'tie-loss');
    // 重放一致性（前置條件：瀏覽器內的第一場必須和 Node 預測相同，否則「一次平手」的真值不成立）
    const same = (r, pred) => !!pred && !!r.snaps[0] && r.snaps[0].sevBlue === pred.sevBlue && r.snaps[0].sevRed === pred.sevRed && r.snaps[0].battle.winner === pred.winner && r.snaps[0].battle.how === pred.how;
    check(`${tag} FT-04 前置：平手局在瀏覽器重放＝Node 預測（切除數、勝負、how 逐值相同；重打型 seed ${tieInfo.replay}、判敗型 seed ${tieInfo.loss}，掃了 ${ties.tried} 個種子）`, same(r2, rep) && same(r3, lo), JSON.stringify({ r2: r2.snaps[0] && [r2.snaps[0].sevBlue, r2.snaps[0].sevRed, r2.snaps[0].battle], pred2: rep && [rep.sevBlue, rep.sevRed, rep.winner, rep.how], r3: r3.snaps[0] && [r3.snaps[0].sevBlue, r3.snaps[0].sevRed, r3.snaps[0].battle], pred3: lo && [lo.sevBlue, lo.sevRed, lo.winner, lo.how] }));
    check(`${tag} FT-04 前置：快轉鈕在戰鬥中可按且連按三次不丟例外`, fastErr === '', fastErr);
    await finish(page, scns, 'P1', t0);
    await ctx.close();
  }

  // ===== P2：即時劃刀（預設）。R1 蛇：跳過教學＋一刀後中途重新征途 → 選怪獸畫面再按重新征途（不產生局）→ R2 蛇（restart，技能＋即時劃刀打滿）→ #again → R3 龍被動 =====
  {
    const t0 = Date.now(), { ctx, page } = await openPage({ browser, bname, devices, url, sub, q: '?devlog=1' });
    await setup(page);
    const scns = [];
    await page.evaluate(() => window.__cb.newRun({ seed: 5 }));
    await bootClick(page, 'snake');
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'demo', null, { timeout: 5000 });
    await tapEl(page, '#tutSkip'); await page.waitForFunction(() => window.__cb.tut === null, null, { timeout: 3000 });
    await advT(page, 2);
    if (await feedStroke(page)) await advT(page, 8);   // 局進行中出過一刀

    await tapEl(page, '#restart'); await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    scns.push({ via: 'first', beast: 'snake', tut: 'skipped', input: 'free', snaps: [], abandon: true });
    const n0 = (await storedRuns(page, sub)).length;
    await tapEl(page, '#restart');   // 選怪獸畫面再按重新征途：不產生局、不多出 abandoned
    const idle = await page.evaluate(() => window.__cb.ui) === 'beast' && (await storedRuns(page, sub)).length === n0;
    check(`${tag} FT-04 選怪獸畫面再按「重新征途」：仍在選怪獸畫面、不產生局（局數 ${n0} 不變）`, idle);
    await startAt(page, 'snake', 7);
    const r2 = await driveRun(page, { player: PLAYER_FREE_SKILL });
    scns.push({ via: 'restart', beast: 'snake', tut: 'before', input: 'free', snaps: r2.snaps });
    const btn = (await page.evaluate(() => window.__cb.ui)) === 'end' ? '#again' : '#restart';
    await tapEl(page, btn); await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    await startAt(page, 'dragon', 2);
    const r3 = await driveRun(page, { player: PLAYER_PASSIVE });
    scns.push({ via: btn === '#again' ? 'again' : 'restart', beast: 'dragon', tut: 'before', input: 'free', snaps: r3.snaps });
    await finish(page, scns, 'P2', t0);
    await ctx.close();
  }

  // ===== P3：示範自然結束進提示階段後重新征途 → tutorial 仍是 done、result abandoned =====
  {
    const t0 = Date.now(), { ctx, page } = await openPage({ browser, bname, devices, url, sub, q: '?devlog=1' });
    await setup(page);
    await bootClick(page, 'dragon');
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'hints', null, { timeout: 12000 });
    await tapEl(page, '#restart'); await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    await finish(page, [{ via: 'first', beast: 'dragon', tut: 'done', input: 'free', snaps: [], abandon: true }], 'P3', t0);
    await ctx.close();
  }
  // ===== P4：示範進行中重新征途 → tutorial aborted、result abandoned =====
  {
    const t0 = Date.now(), { ctx, page } = await openPage({ browser, bname, devices, url, sub, q: '?devlog=1' });
    await setup(page);
    await bootClick(page, 'dragon');
    await page.waitForFunction(() => window.__cb.tut && window.__cb.tut.phase === 'demo', null, { timeout: 5000 });
    await tapEl(page, '#restart'); await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
    await finish(page, [{ via: 'first', beast: 'dragon', tut: 'aborted', input: 'free', snaps: [], abandon: true }], 'P4', t0);
    await ctx.close();
  }

  const lab = { json: '複製出的 JSON 能解析、首行 N／sha 正確、與儲存內容相同', via: 'startedVia 正確（first／again／restart；選怪獸畫面重按不產生局）', result: 'result 正確（won／lost／abandoned）', tut: 'tutorial 正確（done／skipped／aborted／none／before）', cuts: 'cuts／cutBy＝severedN（含事件流 cut 事件數，藍紅不反）', firstCut: 'firstCutSec 誤差 ≤0.1 秒', strokes: 'strokes＝玩家出刀事件數、locks／blocked 對得上', push: 'maxPush／maxPushAi＝事件流＝逐步觀測最大推進', battle: 'battle＝BattleResult、fastAtMs、tiebreak、skill、endOrgans 對得上', stitch: 'stitch＝實際縫上的器官（offer／picked／位置）；沒縫合＝null', summary: '摘要文字數字（regex 反解）＝JSON', other: '其他欄位（runIdx／ver／sha／gapSec／totalSec／stage／replay／局數／場數）' };
  for (const [k, text] of Object.entries(lab)) check(`${tag} FT-04 ${text}`, (allBad[k] || []).length === 0, (allBad[k] || []).slice(0, 4).join('；'));
  const cov = { runs: cover.runs, stagesRecorded: cover.stagesRecorded, beasts: [...cover.beasts], results: [...cover.results], tieStages: cover.tieStages, replayTies: cover.replayTies, fast: cover.fast, skipped: cover.skipped, abandonedThenRestart: cover.abandonedThenRestart, againAfterEnd: cover.againAfterEnd, tie: tieInfo };
  check(`${tag} FT-04 涵蓋（真值側統計）：≥4 局、龍和蛇、征途 won 和 lost 各至少一次、至少一次平手（非 devtie）且含重打型、一次快轉、一次跳過教學、一次中途重新征途、一次結果畫面再來一局`,
    cover.runs >= 4 && cover.beasts.has('dragon') && cover.beasts.has('snake') && cover.results.has('won') && cover.results.has('lost') && cover.tieStages >= 1 && cover.replayTies >= 1 && cover.fast >= 1 && cover.skipped >= 1 && cover.abandonedThenRestart >= 1 && cover.againAfterEnd >= 1, JSON.stringify(cov));
  check(`${tag} FT-04 全程無頁面錯誤、未出現 confirm／alert`, errs.length === 0 && dialogs.length === 0, [...errs, ...dialogs].slice(0, 3).join(' | '));
}

