// X-8 測試盤面：依 EXPERIMENT_A_RULES §7、EXPERIMENT_B_RULES §6 的機械條件，用真實引擎掃 seed 篩出。
//   node tools/exp/boards.ts            搜尋並寫 results/boards.json
//   node tools/exp/boards.ts --verify   讀 results/boards.json，逐盤面重算條件並比對數字；任何一個不符 exit 1
// 條件以第 1 回合盤面的「全部合法切線」計算；net＝該回合敵損−我損（引擎 act 在狀態複本上實算）。找不到就寫未找到，不放寬條件。
// 有歧義的字句採「較嚴」讀法並在 note 寫明（見各 board 函式註解）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { act, keepable, legalLines, makeConfig, newBattle, outUrl, trial, content, woundCrossedBy } from './lib.ts';
import type { ModeKey, Trial } from './lib.ts';
import { obsessionPick } from '../../engine/src/experiment.ts';
import type { BattleState } from '../../engine/src/engine.ts';

export const SEARCH_FROM = 800001;
export const SEARCH_TO = 830000;
type Anchor = { round: number; i: number; j: number; keep?: boolean; net: number; note: string };
interface BoardResult { pass: boolean; numbers: Record<string, number | string | boolean>; good: Anchor | null; trap: Anchor | null; note: string }
type Judge = (s: BattleState) => BoardResult;

const fail: BoardResult = { pass: false, numbers: {}, good: null, trap: null, note: '' };
const byIJ = (a: Trial, b: Trial): number => a.p.i - b.p.i || a.p.j - b.p.j;
const maxNet = (ts: Trial[]): number => Math.max(...ts.map((t) => t.net));
const anchor = (round: number, t: Trial, note: string): Anchor => ({ round, i: t.p.i, j: t.p.j, ...(t.keep ? { keep: true } : {}), net: t.net, note });
/** 一個狀態下下一回合 GRD（淨收益最大）的淨收益；沒有合法線傳回 0。 */
const greedyNet2 = (s: BattleState): number => { const ls = legalLines(s); return ls.length ? Math.max(...ls.map((p) => trial(s, p).net)) : 0; };
const total2g = (t: Trial): number => (t.state.result ? t.net : t.net + greedyNet2(t.state));

// ---------------------------------------------------------------- 實驗 A

interface LineInfo { t: Trial; triggered: boolean; side: 'L' | 'R'; reason: string; chosenPoison: boolean; obsSide: 'L' | 'R' | null; poisonOnObs: boolean }
function infoA(s: BattleState): LineInfo[] {
  const e = s.config.enemy;
  if (e.kind !== 'OBS_HEART' && e.kind !== 'OBS_AREA') throw new Error('infoA 只用於實驗 A');
  return legalLines(s).map((p) => {
    const t = trial(s, p);
    const ch = t.events.find((x): x is Extract<typeof x, { t: 'CHOICE' }> => x.t === 'CHOICE');
    const hearts = { L: p.L.filter((o) => o.key === 'heart').length, R: p.R.filter((o) => o.key === 'heart').length };
    const obsSide = obsessionPick(e.kind, hearts, p.area2);
    const side = ch ? ch.side : 'L';
    return {
      t, triggered: ch ? ch.reason === 'OBSESSION' : false, side, reason: ch ? ch.reason : 'NONE',
      chosenPoison: (side === 'L' ? p.L : p.R).some((o) => o.key === 'poison'),
      obsSide, poisonOnObs: obsSide !== null && (obsSide === 'L' ? p.L : p.R).some((o) => o.key === 'poison'),
    };
  });
}

/** A-盤面 1「清楚的誘惑與代價」：存在誘餌線（執念側含毒囊、敵人因執念拿走、淨收益>0），且它的淨收益 ≥ 所有合法線（較嚴：不只不輸給「不觸發」的線，連觸發線也不輸）。 */
const boardA1: Judge = (s) => {
  const L = infoA(s);
  const mx = maxNet(L.map((x) => x.t));
  const bait = L.filter((x) => x.triggered && x.chosenPoison && x.poisonOnObs && x.side === x.obsSide && x.t.net > 0);
  const good = bait.filter((x) => x.t.net === mx).sort((a, b) => byIJ(a.t, b.t))[0];
  const failedBait = L.filter((x) => x.poisonOnObs && !bait.includes(x)).sort((a, b) => b.t.net - a.t.net || byIJ(a.t, b.t))[0];
  const numbers = { lines: L.length, maxNet: mx, baitLines: bait.length, bestBaitNet: bait.length ? maxNet(bait.map((x) => x.t)) : 'n/a',
    nonTriggeringHigherThanBait: good ? L.filter((x) => !x.triggered && x.t.net > good.t.net).length : 'n/a' };
  if (!good) return { ...fail, numbers, note: '沒有「淨收益=全場最大」的誘餌線' };
  return { pass: true, numbers, good: anchor(1, good.t, `誘餌好刀：敵人因執念拿走含毒囊側（reason=${good.reason}）`),
    trap: failedBait ? anchor(1, failedBait.t, `陷阱刀：執念側有毒囊的線但不划算（reason=${failedBait.reason}，敵人${failedBait.triggered && failedBait.chosenPoison ? '被誘到卻讓你淨收益 ≤0' : '沒有拿走含毒囊側'}）`) : null,
    note: failedBait ? '' : '本盤面沒有「執念側有毒囊但不划算」的線，陷阱刀未找到' };
};

/** A-盤面 2「犧牲立即收益才能誘導」：立即淨收益最大的所有線都不觸發執念；存在觸發線（未結束戰鬥）淨收益較低但 2 回合貪婪總淨收益 > 立即最佳線們的 2 回合貪婪總淨收益（取其最大者，較嚴）。 */
const boardA2: Judge = (s) => {
  const L = infoA(s);
  const mx = maxNet(L.map((x) => x.t));
  const M = L.filter((x) => x.t.net === mx);
  if (M.some((x) => x.triggered)) return { ...fail, numbers: { maxNet: mx, maxLinesTriggering: M.filter((x) => x.triggered).length }, note: '立即最佳線觸發執念' };
  const cand = L.filter((x) => x.triggered && x.t.net < mx && !x.t.state.result);
  if (!cand.length) return { ...fail, numbers: { maxNet: mx, triggeringLowerNetLines: 0 }, note: '沒有淨收益較低的觸發線' };
  const gTot = Math.max(...M.map((x) => total2g(x.t)));
  const scored = cand.map((x) => ({ x, tot: total2g(x.t) })).sort((a, b) => b.tot - a.tot || byIJ(a.x.t, b.x.t));
  const best = scored[0];
  const numbers = { maxNet: mx, immediateBestTotal2g: gTot, triggeringBestNet: best.x.t.net, triggeringBestTotal2g: best.tot, triggeringLowerNetLines: cand.length };
  if (!(best.tot > gTot)) return { ...fail, numbers, note: '觸發線的 2 回合總淨收益不高於立即最佳線' };
  return { pass: true, numbers, good: anchor(1, best.x.t, `誘導好刀：第 1 回合淨收益較低但觸發執念（2 回合貪婪總淨收益 ${best.tot}）`),
    trap: anchor(1, M.sort((a, b) => byIJ(a.t, b.t))[0].t, `貪婪陷阱：立即淨收益最大（${mx}）但 2 回合貪婪總淨收益只有 ${gTot}`), note: '' };
};

/** A-盤面 3「常見誘餌失效」：執念側含毒囊的每條線，都是「敵人因求生底線拿另一側」或「淨收益 ≤0」；且存在不屬於這類的線淨收益 >0。 */
const boardA3: Judge = (s) => {
  const L = infoA(s);
  const P = L.filter((x) => x.poisonOnObs);
  if (!P.length) return { ...fail, numbers: { poisonObsLines: 0 }, note: '沒有執念側含毒囊的線' };
  const bad = P.filter((x) => !((x.reason === 'SURVIVAL' && x.side !== x.obsSide) || x.t.net <= 0));
  const others = L.filter((x) => !x.poisonOnObs && x.t.net > 0);
  const numbers = { poisonObsLines: P.length, poisonObsLinesNotFailing: bad.length, survivalDeflected: P.filter((x) => x.reason === 'SURVIVAL' && x.side !== x.obsSide).length,
    poisonObsMaxNet: maxNet(P.map((x) => x.t)), otherPositiveLines: others.length };
  if (bad.length) return { ...fail, numbers, note: '有毒囊誘餌線仍然有效' };
  if (!others.length) return { ...fail, numbers, note: '沒有淨收益>0 的其他線' };
  const good = others.sort((a, b) => b.t.net - a.t.net || byIJ(a.t, b.t))[0];
  const trap = [...P].sort((a, b) => b.t.net - a.t.net || byIJ(a.t, b.t))[0];
  return { pass: true, numbers, good: anchor(1, good.t, '非誘餌的正收益好刀'), trap: anchor(1, trap.t, `常見誘餌失效：執念側放毒囊（reason=${trap.reason}，淨收益 ${trap.t.net}）`), note: '' };
};

// ---------------------------------------------------------------- 實驗 B（前 2 回合）

function bLines(s: BattleState): { keep: Trial[]; nokeep: Trial[] } {
  const keep: Trial[] = [], nokeep: Trial[] = [];
  for (const p of legalLines(s)) { nokeep.push(trial(s, p)); if (keepable(s, p)) keep.push(trial(s, p, true)); }
  return { keep, nokeep };
}

/** B-盤面 1「立即傷害較好」：有可留傷口的線，且所有「第 1 回合留傷口」線的 2 回合貪婪總淨收益 < 立即淨收益最大的不留傷口線（取 (i,j) 最小者）的 2 回合貪婪總淨收益（較嚴）。 */
const boardB1: Judge = (s) => {
  const { keep, nokeep } = bLines(s);
  if (!keep.length) return { ...fail, numbers: { keepLines: 0 }, note: '沒有可留傷口的線' };
  const g = [...nokeep].sort((a, b) => b.net - a.net || byIJ(a, b))[0];
  const gTot = total2g(g);
  const ks = keep.map((t) => ({ t, tot: total2g(t) })).sort((a, b) => b.tot - a.tot || byIJ(a.t, b.t));
  const numbers = { keepLines: keep.length, immediateBestNet1: g.net, immediateBestTotal2g: gTot, bestKeepTotal2g: ks[0].tot, bestNoKeepTotal2g: Math.max(...nokeep.map(total2g)) };
  if (!(ks[0].tot < gTot)) return { ...fail, numbers, note: '有留傷口的線 2 回合貪婪總淨收益不低於立即最佳線' };
  return { pass: true, numbers, good: anchor(1, g, `立即發動的好刀（2 回合貪婪總淨收益 ${gTot}）`),
    trap: anchor(1, ks[0].t, `留傷口的陷阱（最佳留傷口線，2 回合貪婪總淨收益只有 ${ks[0].tot}）`), note: '' };
};

/** B-盤面 2「保留傷口收益更高」：存在「第 1 回合留傷口＋第 2 回合撕裂」組合，其 2 回合總淨收益 > 任何「第 1 回合不留傷口」的 2 回合組合（第 2 回合任選合法線，窮舉；戰鬥在第 1 回合結束者只算該回合）。 */
const boardB2: Judge = (s) => {
  const { keep, nokeep } = bLines(s);
  let bestNo = -Infinity, bestNoT: Trial | null = null;
  for (const t of nokeep) {
    const v = t.state.result ? t.net : t.net + Math.max(...legalLines(t.state).map((p) => trial(t.state, p).net));
    if (v > bestNo) { bestNo = v; bestNoT = t; }
  }
  let bestKT = -Infinity, k1: Trial | null = null, k2: Trial | null = null, combos = 0;
  for (const t of keep) {
    if (t.state.result) continue;
    for (const p of legalLines(t.state)) {
      if (!woundCrossedBy(t.state, p.i, p.j)) continue;
      combos++;
      const t2 = trial(t.state, p);
      const v = t.net + t2.net;
      if (v > bestKT) { bestKT = v; k1 = t; k2 = t2; }
    }
  }
  const numbers = { keepTearCombos: combos, bestKeepTearTotal: combos ? bestKT : 'n/a', bestNoKeepTotal: bestNo };
  if (!combos || !k1 || !k2 || !(bestKT > bestNo)) return { ...fail, numbers, note: combos ? '留傷口＋撕裂的最佳組合不高於不留傷口組合' : '沒有「留傷口＋撕裂」組合' };
  return { pass: true, numbers,
    good: { ...anchor(1, k1, `留傷口（封存 ${k1.p.pierced.map((o) => o.key).join('+')}）`), note: `第 1 回合留傷口；第 2 回合撕裂刀 anchor ${k2.p.i}/${k2.p.j}（淨收益 ${k2.net}），2 回合總淨收益 ${bestKT}` },
    trap: anchor(1, bestNoT!, `不留傷口的最佳 2 回合組合只有總淨收益 ${bestNo}`), note: '' };
};

/** B-盤面 3「保留傷口有風險」：第 1 回合有可封存毒囊的留傷口線；留下後第 2 回合所有撕裂線的淨收益都 < 某條避開傷口線的淨收益（同時兩類線都存在）。取差距最大的那條留傷口線。 */
const boardB3: Judge = (s) => {
  const { keep } = bLines(s);
  const cands = keep.filter((t) => t.p.pierced.some((o) => o.key === 'poison') && !t.state.result);
  let best: { t: Trial; tear: Trial; avoid: Trial; margin: number; nTear: number; nAvoid: number } | null = null;
  let tested = 0;
  for (const t of cands) {
    tested++;
    const ts = legalLines(t.state).map((p) => ({ tr: trial(t.state, p), tear: woundCrossedBy(t.state, p.i, p.j) }));
    const tears = ts.filter((x) => x.tear).map((x) => x.tr), avoids = ts.filter((x) => !x.tear).map((x) => x.tr);
    if (!tears.length || !avoids.length) continue;
    const bt = [...tears].sort((a, b) => b.net - a.net || byIJ(a, b))[0], ba = [...avoids].sort((a, b) => b.net - a.net || byIJ(a, b))[0];
    const margin = ba.net - bt.net;
    if (margin > 0 && (!best || margin > best.margin)) best = { t, tear: bt, avoid: ba, margin, nTear: tears.length, nAvoid: avoids.length };
  }
  const numbers = { poisonKeepLines: cands.length, tested, ...(best ? { round2BestTearNet: best.tear.net, round2BestAvoidNet: best.avoid.net, margin: best.margin, tearLines: best.nTear, avoidLines: best.nAvoid } : {}) };
  if (!best) return { ...fail, numbers, note: cands.length ? '封存毒囊後，第 2 回合沒有「避開傷口的線淨收益 > 所有撕裂線」' : '第 1 回合沒有可封存毒囊的留傷口線' };
  return { pass: true, numbers,
    good: { round: 2, i: best.avoid.p.i, j: best.avoid.p.j, net: best.avoid.net, note: `第 2 回合避開傷口讓它癒合（第 1 回合留傷口刀 anchor ${best.t.p.i}/${best.t.p.j}，封存 ${best.t.p.pierced.map((o) => o.key).join('+')}，keep=true）` },
    trap: { round: 2, i: best.tear.p.i, j: best.tear.p.j, net: best.tear.net, note: '第 2 回合最佳撕裂線（毒囊 ×2）' }, note: '' };
};

const JUDGES: Record<string, { mode: ModeKey; board: number; judge: Judge }> = {
  'A1-1': { mode: 'A1', board: 1, judge: boardA1 }, 'A1-2': { mode: 'A1', board: 2, judge: boardA2 }, 'A1-3': { mode: 'A1', board: 3, judge: boardA3 },
  'A2-1': { mode: 'A2', board: 1, judge: boardA1 }, 'A2-2': { mode: 'A2', board: 2, judge: boardA2 }, 'A2-3': { mode: 'A2', board: 3, judge: boardA3 },
  'B-1': { mode: 'B', board: 1, judge: boardB1 }, 'B-2': { mode: 'B', board: 2, judge: boardB2 }, 'B-3': { mode: 'B', board: 3, judge: boardB3 },
};

function startState(mode: ModeKey, seed: number, hpE: number): BattleState {
  return newBattle(makeConfig(mode, seed, hpE), content).state;
}

interface Found { id: string; mode: ModeKey; board: number; seed: number | null; hpE: number; result: BoardResult | null; search: { from: number; to: number; scanned: number; note: string } }

function search(hp: Record<string, number>): Found[] {
  const found: Found[] = [];
  for (const m of ['A1', 'A2', 'B'] as ModeKey[]) {
    const used = new Set<number>();
    for (const id of Object.keys(JUDGES).filter((k) => JUDGES[k].mode === m)) {
      const { board, judge } = JUDGES[id];
      let hit: { seed: number; r: BoardResult } | null = null;
      let scanned = 0;
      for (let seed = SEARCH_FROM; seed <= SEARCH_TO; seed++) {
        if (used.has(seed)) continue;
        scanned++;
        const r = judge(startState(m, seed, hp[m]));
        // 條件本身不變；另要求能同時給出「好刀」與「陷阱刀」（產出需求，不是放寬或加嚴判定條件）
        if (r.pass && r.good && r.trap) { hit = { seed, r }; break; }
      }
      if (hit) used.add(hit.seed);
      found.push({ id, mode: m, board, seed: hit ? hit.seed : null, hpE: hp[m], result: hit ? hit.r : null,
        search: { from: SEARCH_FROM, to: hit ? hit.seed : SEARCH_TO, scanned, note: hit ? `第 ${scanned} 個被掃描的 seed 命中` : `掃描 ${SEARCH_FROM}..${SEARCH_TO} 全部 ${scanned} 個 seed，未找到` } });
      console.log(id, hit ? `seed=${hit.seed}（掃描 ${scanned} 個）` : '未找到');
    }
  }
  return found;
}

const file = outUrl('boards.json');
if (process.argv.includes('--verify')) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { boards: Found[] };
  let bad = 0;
  for (const b of saved.boards) {
    if (b.seed === null) { console.log(`${b.id}\t未找到（${b.search.note}）`); continue; }
    const r = JUDGES[b.id].judge(startState(b.mode, b.seed, b.hpE));
    const same = r.pass && r.good !== null && r.trap !== null &&JSON.stringify(r.numbers) === JSON.stringify(b.result!.numbers) && JSON.stringify(r.good) === JSON.stringify(b.result!.good) && JSON.stringify(r.trap) === JSON.stringify(b.result!.trap);
    if (!same) bad++;
    console.log(`${b.id}\tseed=${b.seed}\thpE=${b.hpE}\t${same ? 'PASS' : 'FAIL'}\t${JSON.stringify(r.numbers)}`);
  }
  // 對照組：條件不是恆真——每種盤面在被選中 seed 之前的 40 個 seed 中通過率
  for (const id of Object.keys(JUDGES)) {
    const b = saved.boards.find((x) => x.id === id)!;
    const hp = b.hpE;
    let pass = 0, n = 0;
    for (let seed = SEARCH_FROM; seed < SEARCH_FROM + 40; seed++) { n++; if (JUDGES[id].judge(startState(JUDGES[id].mode, seed, hp)).pass) pass++; }
    console.log(`control ${id}: seeds ${SEARCH_FROM}..${SEARCH_FROM + 39} 通過 ${pass}/${n}`);
  }
  console.log(bad === 0 ? 'VERIFY: 全部通過' : `VERIFY: ${bad} 個不符`);
  process.exit(bad === 0 ? 0 : 1);
} else {
  const cal = JSON.parse(readFileSync(outUrl('calibration.json'), 'utf8')) as { chosenV12: Record<'A1' | 'A2', number> };
  const hp = { A1: cal.chosenV12.A1, A2: cal.chosenV12.A2, B: 30 } as Record<string, number>;
  // 規格 A v1.2：預設採 calibration.json 的 chosenV12（MAXPIERCE 對齊，GRD 飽和不能校準）；--hp=A1:…,A2:… 可手動覆寫
  const hpArg = process.argv.find((x) => x.startsWith('--hp='));
  if (hpArg) for (const kv of hpArg.slice(5).split(',')) { const [m, v] = kv.split(':'); hp[m] = Number(v); }
  const boards = search(hp);
  mkdirSync(outUrl('.'), { recursive: true });
  writeFileSync(file, JSON.stringify({ range: [SEARCH_FROM, SEARCH_TO], hpE: hp, boards }, null, 1) + '\n');
  const params: Record<string, unknown> = {};
  for (const m of ['A1', 'A2'] as const) params[m] = { hpE: hp[m], boards: boards.filter((b) => b.mode === m).map((b) => b.seed) };
  params.B = { boards: boards.filter((b) => b.mode === 'B').map((b) => b.seed) };
  writeFileSync(outUrl('exp_params.json'), JSON.stringify(params, null, 1) + '\n');
}
void act;
