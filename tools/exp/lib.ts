// FUN-EXP-01 P3：bot 與統計共用函式庫。只用引擎公開函式（newBattle／act／legalLines／partitionOf）與 experiment.ts 的純函式。
// 不改 engine/、src/、tests/、public/。所有亂數都是 prng.ts 的固定種子串流；沒有 Math.random／Date。
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../../engine/src/content.ts';
import { act, legalLines, newBattle, partitionOf } from '../../engine/src/engine.ts';
import type { Action, BattleConfig, BattleState, Partition } from '../../engine/src/engine.ts';
import { expRoundFacts, keepWoundCheck, obsessionPick, woundCrossedBy } from '../../engine/src/experiment.ts';
import { Cursor, streamState } from '../../engine/src/prng.ts';
import type { Ev } from '../../engine/src/types.ts';

export const content = loadContent();

/** 輸出目錄：預設 tools/exp/results/；環境變數 EXP_OUT 可改（determinism.ts 用來跑兩份獨立輸出比對）。 */
export function outUrl(name: string): URL {
  const d = process.env.EXP_OUT;
  return d ? new URL(name, pathToFileURL(resolve(d) + sep)) : new URL('./results/' + name, import.meta.url);
}


export type ModeKey = 'BASELINE' | 'A1' | 'A2' | 'B';
export type BotName = 'RND' | 'GRD' | 'MAXPIERCE' | 'SAFE' | 'LOOK2' | 'LOOK2NK' | 'BAIT' | 'KEEPHOLD';

const BASE = { model: 'A', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'BUT', w10: 7 }, hpP: 40, hpE: 30, r: 160, anchorCount: 12, maxRounds: 12 } as const;

/** 與 tests/browser/exp_entry.ts 的 expConfig 同參數（hpP 40、hpE 30、12 回合），另可調 hpE（只給實驗 A 校準用）。 */
export function makeConfig(mode: ModeKey, seed: number, hpE = 30): BattleConfig {
  const b = structuredClone(BASE) as unknown as BattleConfig;
  const c = { ...b, seed, hpE };
  if (mode === 'A1') return { ...c, enemy: { kind: 'OBS_HEART', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'A2') return { ...c, enemy: { kind: 'OBS_AREA', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'B') return { ...c, exp: { mode: 'B' } };
  return c;
}

// ---------------------------------------------------------------- 試算

export interface Trial { p: Partition; keep: boolean; state: BattleState; events: Ev[]; net: number; myLoss: number; enLoss: number; val: number }

/** 在狀態複本上試算一條線（引擎 act 是純函式，不改輸入狀態）。net＝敵損−我損（本回合實扣 HP）。 */
export function trial(s: BattleState, p: Partition, keep = false): Trial {
  const a: Action = { round: s.round, actor: 'P', i: p.i, j: p.j };
  if (keep) a.keepWound = true;
  const out = act(s, a, content);
  const enLoss = s.hp.E - out.state.hp.E, myLoss = s.hp.P - out.state.hp.P;
  const net = enLoss - myLoss;
  return { p, keep, state: out.state, events: out.events, net, myLoss, enLoss, val: valOf(out.state, net) };
}

/** 排序用數值：勝 +1000、敗（含雙亡）／INVALID −1000，其餘就是淨收益。 */
function valOf(ns: BattleState, net: number): number {
  return ns.result === 'WIN' ? 1000 + net : ns.result === 'LOSS' || ns.result === 'INVALID' ? -1000 + net : net;
}

const better = (a: number, b: number): boolean => a > b;

/** 從試算結果挑最大 val；平手取 (i,j) 字典序最小、同線時不留傷口優先（legalLines 已依 i,j 排序，故嚴格大於才換）。 */
function argmax(ts: Trial[], key: (t: Trial) => number): Trial {
  let best = ts[0];
  let bk = key(best);
  for (let k = 1; k < ts.length; k++) {
    const v = key(ts[k]);
    if (better(v, bk)) { best = ts[k]; bk = v; }
  }
  return best;
}

/** 可勾傷口的線（實驗 B 且符合 keepWoundCheck）。 */
export const keepable = (s: BattleState, p: Partition): boolean => keepWoundCheck(s, p).ok;

/** 一個狀態下 GRD 會挑的最佳 val（LOOK2 第二回合用）；沒有合法線傳回 0。 */
export function bestGreedyVal(s: BattleState): number {
  const ls = legalLines(s);
  if (ls.length === 0) return 0;
  let best = -Infinity;
  for (const p of ls) { const t = trial(s, p); if (t.val > best) best = t.val; }
  return best;
}

// ---------------------------------------------------------------- bot

export interface BotCtx { rng: Cursor; mode: ModeKey }
export type Bot = (s: BattleState, ctx: BotCtx) => { i: number; j: number; keep: boolean };

const pick = (t: Trial) => ({ i: t.p.i, j: t.p.j, keep: t.keep });

const RND: Bot = (s, ctx) => {
  const ls = legalLines(s);
  const p = ls[ctx.rng.below(ls.length)];
  const keep = ctx.mode === 'B' && keepable(s, p) && ctx.rng.below(2) === 1;
  return { i: p.i, j: p.j, keep };
};

/** GRD：當回合 val（勝優先、敗最後、其餘敵損−我損）最大；不留傷口。 */
const GRD: Bot = (s) => pick(argmax(legalLines(s).map((p) => trial(s, p)), (t) => t.val));

/** MAXPIERCE：切穿最多顆器官；平手取 GRD 的 val；不留傷口。 */
const MAXPIERCE: Bot = (s) => pick(argmax(legalLines(s).map((p) => trial(s, p)), (t) => t.p.pierced.length * 1e6 + t.val));

/** SAFE：我方 HP 損失最小（敗的線排最後）；平手取敵損大者。 */
const SAFE: Bot = (s) => pick(argmax(legalLines(s).map((p) => trial(s, p)), (t) =>
  (t.state.result === 'LOSS' || t.state.result === 'INVALID' ? -1e9 : 0) - t.myLoss * 1e4 + t.enLoss));

/** LOOK2：本回合每條線（B 含留／不留）× 下一回合 GRD 最佳 val。 */
const look2 = (allowKeep: boolean): Bot => (s, ctx) => {
  const ts: Trial[] = [];
  for (const p of legalLines(s)) {
    ts.push(trial(s, p, false));
    if (allowKeep && ctx.mode === 'B' && keepable(s, p)) ts.push(trial(s, p, true));
  }
  const score = (t: Trial): number => (t.state.result ? t.val : t.net + bestGreedyVal(t.state));
  return pick(argmax(ts, score));
};
const LOOK2 = look2(true);
/** LOOK2NK（對照）：同 LOOK2 但不准留傷口——用來隔離「留傷口」本身的價值。 */
const LOOK2NK = look2(false);

/** 該線的公開誘餌：實驗 A 的執念側（公開規則）是否含毒囊。 */
export function baitSideHasPoison(s: BattleState, p: Partition): boolean {
  const e = s.config.enemy;
  if (e.kind !== 'OBS_HEART' && e.kind !== 'OBS_AREA') return false;
  const hearts = { L: p.L.filter((o) => o.key === 'heart').length, R: p.R.filter((o) => o.key === 'heart').length };
  const side = obsessionPick(e.kind, hearts, p.area2);
  if (!side) return false;
  return (side === 'L' ? p.L : p.R).some((o) => o.key === 'poison');
}

/** BAIT：實驗 A 一律優先選「毒囊在執念側」的線（其中取 GRD val 最大），沒有就 GRD。 */
const BAIT: Bot = (s) => {
  const ts = legalLines(s).map((p) => trial(s, p));
  const bait = ts.filter((t) => baitSideHasPoison(s, t.p));
  return pick(argmax(bait.length ? bait : ts, (t) => t.val));
};

/** KEEPHOLD（壓力測試）：B 模式盡量連續留傷口——優先選「可勾且不穿過現有傷口」的線（val 最大），沒有就 GRD。 */
const KEEPHOLD: Bot = (s) => {
  const ts: Trial[] = [];
  for (const p of legalLines(s)) if (keepable(s, p)) ts.push(trial(s, p, true));
  return ts.length ? pick(argmax(ts, (t) => t.val)) : GRD(s, null as unknown as BotCtx);
};

export const BOTS: Record<BotName, Bot> = { RND, GRD, MAXPIERCE, SAFE, LOOK2, LOOK2NK, BAIT, KEEPHOLD };

// ---------------------------------------------------------------- 一局

export interface GameRec {
  seed: number; result: string; rounds: number;
  net: number; myLoss: number; enLoss: number;
  zeroLossRounds: number; zeroAvailRounds: number;
  obsTrig: number; reasons: Record<string, number>;
  keeps: number; tears: number; heals: number;
  tearRounds: number; tearNetSum: number; tearEnHp: number; tearMyHp: number;
  nonTearRounds: number; nonTearNetSum: number;
  maxKeepStreak: number; woundAgeViolations: number;
  baitAvail: number; baitTaken: number; baitSuccess: number;
}

export function playGame(mode: ModeKey, bot: BotName, seed: number, hpE = 30): GameRec {
  const cfg = makeConfig(mode, seed, hpE);
  let s = newBattle(cfg, content).state;
  const ctx: BotCtx = { rng: new Cursor(streamState(seed, 'p3bot')), mode };
  const g: GameRec = {
    seed, result: '', rounds: 0, net: 0, myLoss: 0, enLoss: 0, zeroLossRounds: 0, zeroAvailRounds: 0,
    obsTrig: 0, reasons: {}, keeps: 0, tears: 0, heals: 0, tearRounds: 0, tearNetSum: 0, tearEnHp: 0, tearMyHp: 0,
    nonTearRounds: 0, nonTearNetSum: 0, maxKeepStreak: 0, woundAgeViolations: 0, baitAvail: 0, baitTaken: 0, baitSuccess: 0,
  };
  let streak = 0;
  while (!s.result) {
    if (s.wound && s.wound.round !== s.round - 1) g.woundAgeViolations++;
    const lines = legalLines(s);
    // 本回合是否存在我損為 0 的線（SAFE「永遠有安全區」的前提；只計數，不影響 bot）
    if (lines.some((p) => trial(s, p).myLoss === 0)) g.zeroAvailRounds++;
    const c = BOTS[bot](s, ctx);
    const part = partitionOf(s, c.i, c.j);
    const baitAvailNow = (mode === 'A1' || mode === 'A2') && lines.some((p) => baitSideHasPoison(s, p));
    const out = act(s, { round: s.round, actor: 'P', i: c.i, j: c.j, ...(c.keep ? { keepWound: true } : {}) }, content);
    const f = expRoundFacts(s, part, out.events);
    const enLoss = s.hp.E - out.state.hp.E, myLoss = s.hp.P - out.state.hp.P, net = enLoss - myLoss;
    g.rounds++; g.net += net; g.myLoss += myLoss; g.enLoss += enLoss;
    if (myLoss === 0) g.zeroLossRounds++;
    if (f.choiceReason) g.reasons[f.choiceReason] = (g.reasons[f.choiceReason] ?? 0) + 1;
    if (f.obsessionTriggered) g.obsTrig++;
    if (baitAvailNow) {
      g.baitAvail++;
      if (baitSideHasPoison(s, part)) {
        g.baitTaken++;
        const side = f.choiceSide;
        if (f.obsessionTriggered && side && (side === 'L' ? part.L : part.R).some((o) => o.key === 'poison')) g.baitSuccess++;
      }
    }
    let tore = false;
    for (const w of f.wound) {
      if (w.op === 'KEEP') g.keeps++;
      else if (w.op === 'TEAR') { g.tears++; tore = true; }
      else g.heals++;
    }
    if (tore) {
      g.tearRounds++; g.tearNetSum += net;
      if (f.tearHpLoss) { g.tearEnHp += f.tearHpLoss.E; g.tearMyHp += f.tearHpLoss.P; }
    } else { g.nonTearRounds++; g.nonTearNetSum += net; }
    if (c.keep) { streak++; if (streak > g.maxKeepStreak) g.maxKeepStreak = streak; } else streak = 0;
    s = out.state;
  }
  g.result = s.result!;
  return g;
}

export { woundCrossedBy, legalLines, partitionOf, act, newBattle };

// ---------------------------------------------------------------- 統計

export interface Agg {
  n: number; wins: number; losses: number; stalls: number; invalid: number;
  winRate: number; winCI95: [number, number]; avgRounds: number; netPerRound: number;
  myLossPerRound: number; enLossPerRound: number; zeroLossRoundRate: number; zeroLossAvailRate: number;
  obsTriggerRate: number | null;
  keepRate: number | null; keepsPerGame: number | null; tearRatePerWound: number | null; healRatePerWound: number | null;
  tearRounds: number | null; tearNetPerTearRound: number | null; tearCopyNetPerTear: number | null; nonTearNetPerRound: number | null;
  maxKeepStreak: number | null; woundAgeViolations: number;
  baitAvailRate: number | null; baitTakenRate: number | null; baitSuccessRate: number | null;
  reasons: Record<string, number>;
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const div = (a: number, b: number): number => (b === 0 ? 0 : r6(a / b));

export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [r6(c - h), r6(c + h)];
}

export function aggregate(mode: ModeKey, bot: BotName, gs: GameRec[]): Agg {
  const sum = (f: (g: GameRec) => number): number => gs.reduce((a, g) => a + f(g), 0);
  const n = gs.length, rounds = sum((g) => g.rounds);
  const wins = gs.filter((g) => g.result === 'WIN').length;
  const isA = mode === 'A1' || mode === 'A2', isB = mode === 'B';
  const keeps = sum((g) => g.keeps), tears = sum((g) => g.tears), heals = sum((g) => g.heals);
  const reasons: Record<string, number> = {};
  for (const g of gs) for (const [k, v] of Object.entries(g.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
  const tr = sum((g) => g.tearRounds);
  return {
    n, wins, losses: gs.filter((g) => g.result === 'LOSS').length, stalls: gs.filter((g) => g.result === 'STALL').length,
    invalid: gs.filter((g) => g.result === 'INVALID').length,
    winRate: div(wins, n), winCI95: wilson(wins, n), avgRounds: div(rounds, n), netPerRound: div(sum((g) => g.net), rounds),
    myLossPerRound: div(sum((g) => g.myLoss), rounds), enLossPerRound: div(sum((g) => g.enLoss), rounds),
    zeroLossRoundRate: div(sum((g) => g.zeroLossRounds), rounds), zeroLossAvailRate: div(sum((g) => g.zeroAvailRounds), rounds),
    obsTriggerRate: isA ? div(sum((g) => g.obsTrig), rounds) : null,
    keepRate: isB ? div(keeps, rounds) : null, keepsPerGame: isB ? div(keeps, n) : null,
    tearRatePerWound: isB ? div(tears, tears + heals) : null, healRatePerWound: isB ? div(heals, tears + heals) : null,
    tearRounds: isB ? tr : null, tearNetPerTearRound: isB ? div(sum((g) => g.tearNetSum), tr) : null,
    tearCopyNetPerTear: isB ? div(sum((g) => g.tearEnHp - g.tearMyHp), tr) : null,
    nonTearNetPerRound: isB ? div(sum((g) => g.nonTearNetSum), sum((g) => g.nonTearRounds)) : null,
    maxKeepStreak: isB ? Math.max(0, ...gs.map((g) => g.maxKeepStreak)) : null, woundAgeViolations: sum((g) => g.woundAgeViolations),
    baitAvailRate: isA ? div(sum((g) => g.baitAvail), rounds) : null,
    baitTakenRate: isA && bot === 'BAIT' ? div(sum((g) => g.baitTaken), sum((g) => g.baitAvail)) : null,
    baitSuccessRate: isA && bot === 'BAIT' ? div(sum((g) => g.baitSuccess), sum((g) => g.baitTaken)) : null,
    reasons,
  };
}

/** 精確二項檢定（McNemar 的離散對）：雙尾 p 值；b、c 為兩種不一致配對數。 */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  // P(X<=k), X~Bin(n,0.5)，用對數避免溢位
  const lf = [0];
  for (let i = 1; i <= n; i++) lf.push(lf[i - 1] + Math.log(i));
  let p = 0;
  for (let i = 0; i <= k; i++) p += Math.exp(lf[n] - lf[i] - lf[n - i] - n * Math.LN2);
  return Math.min(1, 2 * p);
}
