// 切割→戰鬥（duel/）的盤面生成、縫合擺放與征途流程。純函式，不碰 DOM。
// 規格：the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md「切割期」「征途與縫合」。切割期規則本身全在 src/rtcut/rules.ts（rt-cut2 2ba45fb）。
import { BODY, R, KIND_ZH, MODE_RT2, circleInside, newGame, rand, reachableBy, validSpot } from '../rtcut/rules.ts';
import type { GameState, Kind, Mode, OrganDef, Side, V } from '../rtcut/rules.ts';
import { simulateBattle } from './battle.ts';
import type { BattleResult, Fighter } from './battle.ts';

export const CB = {
  CUT_SECONDS: 30,
  BASE_KINDS: ['claw', 'claw', 'claw', 'claw', 'heart', 'heart', 'eye', 'poison', 'bone'] as Kind[],
  AI_JITTER: [30, 21, 12],                          // AI 的 d：0.5／0.35／0.2 秒
  EXTRA: [0, 1, 2],                                 // 對手額外器官數
  EXTRA_WEIGHTS: [null, { bone: 5, claw: 1, heart: 1, eye: 1, poison: 1 }, { poison: 5, claw: 1, heart: 1, eye: 1, bone: 1 }] as (Record<Kind, number> | null)[],
  STAGES: 3,
};
export const ALL_KINDS: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
/** 亂數流：同種子同用途同序列（mulberry32 疊代）。 */
function stream(seed: number, salt: number): () => number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0 || 1;
  return () => { const [u, n] = rand(x); x = n; return u; };
}
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function placeOne(side: Side, rnd: () => number, taken: V[]): V {
  const xs = BODY[side].map((p) => p[0]), ys = BODY[side].map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let t = 0; t < 4000; t++) {
    const p: V = [Math.round(x0 + rnd() * (x1 - x0)), Math.round(y0 + rnd() * (y1 - y0))];
    if (validSpot(p, side) && taken.every((q) => dist(p, q) >= 2 * R + 4)) return p;
  }
  throw new Error(`placeOne：${side} 找不到合法位置`);
}
/** 藍方基礎 9 個器官：整個征途固定（玩家擺縫合時要避開它們）。 */
export function genBlueBase(seed: number): OrganDef[] {
  const rnd = stream(seed, 1), taken: V[] = [];
  return CB.BASE_KINDS.map((kind, i) => { const p = placeOne('blue', rnd, taken); taken.push(p); return { id: `藍${KIND_ZH[kind]}${i + 1}`, side: 'blue', kind, p }; });
}
/** 對手：基礎 9 個＋第 2／3 場額外 1／2 個（第 2 隻偏骨、第 3 隻偏毒）；避開藍方所有器官。 */
export function genRed(seed: number, stage: number, blue: OrganDef[]): OrganDef[] {
  const rnd = stream(seed, 100 + stage), taken: V[] = blue.map((o) => o.p);
  const kinds = [...CB.BASE_KINDS];
  const w = CB.EXTRA_WEIGHTS[stage];
  for (let i = 0; i < CB.EXTRA[stage] && w; i++) {
    let t = rnd() * ALL_KINDS.reduce((s, k) => s + w[k], 0);
    kinds.push(ALL_KINDS.find((k) => (t -= w[k]) < 0) ?? 'claw');
  }
  return kinds.map((kind, i) => { const p = placeOne('red', rnd, taken); taken.push(p); return { id: `紅${KIND_ZH[kind]}${i + 1}`, side: 'red', kind, p }; });
}

export interface Stitch { kind: Kind; p: V }
export interface StageLog { stage: number; winner: Side | 'draw'; how: string; cutByMe: Kind[]; battle: BattleResult; endBody: Kind[] }
export interface Campaign {
  seed: number; stage: number; blueBase: OrganDef[]; stitches: Stitch[];
  phase: 'cut' | 'battle' | 'pick' | 'place' | 'won' | 'lost';
  offer: Kind[]; picked: Kind | null; history: StageLog[];
}
export function newCampaign(seed: number): Campaign {
  return { seed: seed >>> 0, stage: 0, blueBase: genBlueBase(seed), stitches: [], phase: 'cut', offer: [], picked: null, history: [] };
}
export const blueOrgans = (c: Campaign): OrganDef[] => [
  ...c.blueBase, ...c.stitches.map((s, i) => ({ id: `藍縫${KIND_ZH[s.kind]}${i + 1}`, side: 'blue' as Side, kind: s.kind, p: s.p })),
];
export function modeFor(c: Campaign, nBlue: number, nRed: number): Mode {
  return { ...MODE_RT2, cutSteps: CB.CUT_SECONDS * 60, maxPerSide: { blue: nBlue, red: nRed }, spawnRule: 'cb', aiJitter: CB.AI_JITTER[c.stage] };
}
/** 這一場的切割期起始狀態（rt-cut2 規則＋本版設定）。 */
export function matchFor(c: Campaign): GameState {
  const blue = blueOrgans(c), red = genRed(c.seed, c.stage, blue);
  return newGame((c.seed + 7919 * (c.stage + 1)) >>> 0, modeFor(c, blue.length, red.length), [...blue, ...red]);
}
/** 切割期結束時雙方存活的器官（含萌芽中）→ 戰鬥參與者。 */
export function fightersOf(s: GameState): Fighter[] {
  return s.organs.map((o, i) => ({ o, i })).filter((x) => s.alive[x.i]).map(({ o }) => ({ side: o.side, id: o.id, kind: o.kind }));
}
export const battleSeed = (c: Campaign) => (c.seed * 31 + c.stage * 1013 + 17) >>> 0;
/** 一場打完：勝→給 3 個縫合選項（這場你切下的種類，不足 3 種由其他種類補）；最後一場勝＝征途勝；敗或平手＝結束。 */
export function finishStage(c: Campaign, cutByMe: Kind[], battle: BattleResult, endBody: Kind[] = []): Campaign {
  const log: StageLog = { stage: c.stage, winner: battle.winner, how: battle.how, cutByMe, battle, endBody };
  const history = [...c.history, log];
  if (battle.winner !== 'blue') return { ...c, phase: 'lost', history };
  if (c.stage === CB.STAGES - 1) return { ...c, phase: 'won', history };
  return { ...c, phase: 'pick', history, offer: stitchOffer(c, cutByMe) };
}
export function stitchOffer(c: Campaign, cutByMe: Kind[]): Kind[] {
  const rnd = stream(c.seed, 500 + c.stage);
  const pool = [...new Set(cutByMe)], rest = ALL_KINDS.filter((k) => !pool.includes(k));
  const take = (arr: Kind[], n: number) => { const a = arr.slice(), out: Kind[] = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  const out = take(pool, 3);
  return [...out, ...take(rest, 3 - out.length)];
}
export function pickStitch(c: Campaign, k: Kind): Campaign {
  if (c.phase !== 'pick' || !c.offer.includes(k)) return c;
  return { ...c, phase: 'place', picked: k };
}
export type PlaceReject = 'outside' | 'unreachable' | 'overlap';
/** 擺放合法性：整個圓在獸身內、對方刀碰得到（與切割期生成／再生同一套規則）、不和其他藍方器官重疊。 */
export function placeCheck(c: Campaign, p: V): PlaceReject | null {
  if (!circleInside(p, 'blue')) return 'outside';
  if (!reachableBy(p, 'red')) return 'unreachable';
  if (blueOrgans(c).some((o) => dist(o.p, p) < 2 * R + 4)) return 'overlap';
  return null;
}
export function placeStitch(c: Campaign, p: V): { c: Campaign; reject: PlaceReject | null } {
  if (c.phase !== 'place' || !c.picked) return { c, reject: null };
  const rej = placeCheck(c, p);
  if (rej) return { c, reject: rej };
  const q: V = [Math.round(p[0]), Math.round(p[1])];
  if (placeCheck(c, q)) return { c, reject: placeCheck(c, q) };
  return { c: { ...c, stitches: [...c.stitches, { kind: c.picked, p: q }], picked: null, offer: [], stage: c.stage + 1, phase: 'cut' }, reject: null };
}
/** 便利：用切割期結束狀態直接跑戰鬥並結算本場。 */
export function resolveStage(c: Campaign, end: GameState, cutByMe: Kind[]): { c: Campaign; battle: BattleResult } {
  const f = fightersOf(end), battle = simulateBattle(f, battleSeed(c));
  return { c: finishStage(c, cutByMe, battle, f.filter((x) => x.side === 'blue').map((x) => x.kind)), battle };
}
