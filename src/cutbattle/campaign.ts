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
function placeOne(side: Side, rnd: () => number, taken: V[], body?: Record<Side, V[]>, r = R): V {
  const poly = body?.[side] ?? BODY[side], xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let t = 0; t < 4000; t++) {
    const p: V = [Math.round(x0 + rnd() * (x1 - x0)), Math.round(y0 + rnd() * (y1 - y0))];
    if (validSpot(p, side, body, r) && taken.every((q) => dist(p, q) >= 2 * r + 4)) return p;
  }
  throw new Error(`placeOne：${side} 找不到合法位置`);
}
/** 藍方基礎 9 個器官：整個征途固定（玩家擺縫合時要避開它們）。 */
export function genBlueBase(seed: number, body?: Record<Side, V[]>, r = R): OrganDef[] {
  return retry((attempt) => {
    const rnd = stream(seed, 1 + 1000 * attempt), taken: V[] = [];
    return CB.BASE_KINDS.map((kind, i) => { const p = placeOne('blue', rnd, taken, body, r); taken.push(p); return { id: `藍${KIND_ZH[kind]}${i + 1}`, side: 'blue', kind, p }; });
  });
}
/** 生成統計（duel3 半徑 34 時回報生成失敗率用）：first＝第一次就失敗、換亂數流重抽的次數；final＝20 次都失敗。 */
export const genStats = { calls: 0, first: 0, final: 0 };
/** 依序擺放時可能把後面的器官擠到沒位置（半徑 34 的窄龍身較常見）：整組換一個確定的亂數流重抽，最多 20 次。
 *  第一次（attempt 0）的亂數流與舊版相同，所以 duel／duel2（半徑 28，從未失敗）的盤面一字不變。 */
function retry<T>(gen: (attempt: number) => T): T {
  genStats.calls++;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { return gen(attempt); } catch (e) { if (attempt === 0) genStats.first++; if (attempt === 19) { genStats.final++; throw e; } }
  }
  throw new Error('unreachable');
}
/** 對手：基礎 9 個＋第 2／3 場額外 1／2 個（第 2 隻偏骨、第 3 隻偏毒）；避開藍方所有器官。 */
export function genRed(seed: number, stage: number, blue: OrganDef[], body?: Record<Side, V[]>, r = R): OrganDef[] {
  return retry((attempt) => {
    const rnd = stream(seed, 100 + stage + 1000 * attempt), taken: V[] = blue.map((o) => o.p);
  const kinds = [...CB.BASE_KINDS];
  const w = CB.EXTRA_WEIGHTS[stage];
  for (let i = 0; i < CB.EXTRA[stage] && w; i++) {
    let t = rnd() * ALL_KINDS.reduce((s, k) => s + w[k], 0);
    kinds.push(ALL_KINDS.find((k) => (t -= w[k]) < 0) ?? 'claw');
  }
  return kinds.map((kind, i) => { const p = placeOne('red', rnd, taken, body, r); taken.push(p); return { id: `紅${KIND_ZH[kind]}${i + 1}`, side: 'red', kind, p }; });
  });
}

export interface Stitch { kind: Kind; p: V }
export interface StageLog { stage: number; winner: Side | 'draw'; how: string; cutByMe: Kind[]; battle: BattleResult; endBody: Kind[] }
export interface Campaign {
  seed: number; stage: number; blueBase: OrganDef[]; stitches: Stitch[];
  body?: Record<Side, V[]>;                         // duel2：獸身多邊形（不給＝BODY，duel v0.1）
  r?: number;                                       // duel3：器官判定半徑 34（不給＝R）
  front?: { unit: number; max: number };            // duel4：前線推進（不給＝沒有）
  phase: 'cut' | 'battle' | 'pick' | 'place' | 'won' | 'lost';
  offer: Kind[]; picked: Kind | null; history: StageLog[];
}
export function newCampaign(seed: number, body?: Record<Side, V[]>, r?: number, front?: { unit: number; max: number }): Campaign {
  const c: Campaign = { seed: seed >>> 0, stage: 0, blueBase: genBlueBase(seed, body, r ?? R), stitches: [], phase: 'cut', offer: [], picked: null, history: [] };
  if (body) c.body = body;
  if (r !== undefined) c.r = r;
  if (front) c.front = front;
  return c;
}
export const blueOrgans = (c: Campaign): OrganDef[] => [
  ...c.blueBase, ...c.stitches.map((s, i) => ({ id: `藍縫${KIND_ZH[s.kind]}${i + 1}`, side: 'blue' as Side, kind: s.kind, p: s.p })),
];
export function modeFor(c: Campaign, nBlue: number, nRed: number): Mode {
  const m: Mode = { ...MODE_RT2, cutSteps: CB.CUT_SECONDS * 60, maxPerSide: { blue: nBlue, red: nRed }, spawnRule: 'cb', aiJitter: CB.AI_JITTER[c.stage] };
  if (c.body) m.body = c.body;
  if (c.r !== undefined) m.r = c.r;
  if (c.front) m.front = c.front;
  return m;
}
/** 這一場的切割期起始狀態（rt-cut2 規則＋本版設定）。 */
export function matchFor(c: Campaign): GameState {
  const blue = blueOrgans(c), red = genRed(c.seed, c.stage, blue, c.body, c.r ?? R);
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
  const r = c.r ?? R;
  if (!circleInside(p, 'blue', r, c.body)) return 'outside';
  if (!reachableBy(p, 'red', r, c.body)) return 'unreachable';
  if (blueOrgans(c).some((o) => dist(o.p, p) < 2 * r + 4)) return 'overlap';
  return null;
}
/** duel4 縫合槽位（補述 1 第 5 條、補述 2）：5 單位網格上所有通過 placeCheck 的點，依 y、x 排序做貪婪覆蓋——
 * 和已選槽位都相距 >SLOT_GAP 的點就選為槽位。每個槽位都合法；每個 5 單位合法點到最近槽位 ≤SLOT_GAP（<SNAP_DIST）。畫面與吸附都用這份清單。 */
export const SLOT_FINE = 5, SLOT_GAP = 30, SNAP_DIST = 40;
export function stitchSlots(c: Campaign): V[] {
  const poly = c.body?.blue ?? BODY.blue, xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), out: V[] = [];
  for (let y = Math.ceil(Math.min(...ys) / SLOT_FINE) * SLOT_FINE; y <= Math.max(...ys); y += SLOT_FINE)
    for (let x = Math.ceil(Math.min(...xs) / SLOT_FINE) * SLOT_FINE; x <= Math.max(...xs); x += SLOT_FINE)
      if (!placeCheck(c, [x, y]) && out.every((q) => dist(q, [x, y]) > SLOT_GAP)) out.push([x, y]);
  return out;
}
/** 點擊位置吸附到最近的槽位（距離 ≤ SNAP_DIST）；40 單位內沒有槽位＝null（拒絕）。 */
export function snapSlot(c: Campaign, p: V, slots: V[] = stitchSlots(c)): V | null {
  let best: V | null = null, bd = SNAP_DIST;
  for (const q of slots) { const d = dist(p, q); if (d <= bd) { bd = d; best = q; } }
  return best;
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
