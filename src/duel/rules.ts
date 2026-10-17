// 刀譜對決（合體版）v0.1（子路徑 duel/）的全部規則：純函式＋可序列化狀態，不碰 DOM。可丟棄原型，非正式規則。
// 規格：the-cut 14cc217 docs/fusion/DUEL_BLADE_V01.md（DB-01～08，DL-080）。
// 即時對戰骨架（固定步長、同步出刀以步開始狀態判、鎖定、冷卻、AI 預告與不偷看）移植自 proto-b experiment/rt-cut 1685a30 的 src/rtcut/rules.ts；
// 刀譜計分直接呼叫 src/blade/rules.ts 的 scoreSeq（blade v0.2 刀譜：連斬、雙對、對稱 ≥4、四色、心）。
import { scoreSeq, rngFor } from '../blade/rules.ts';
import type { Kind, Score, StitchId as BladeStitch } from '../blade/rules.ts';

export type V = [number, number];
export type Side = 'blue' | 'red';
export type { Kind, Score };
export interface Line { a: V; b: V }
export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

// ---------------------------------------------------------------- 試玩數值（可調；調了寫進作者證據）
export const TUNE = {
  FPS: 60,
  ROUND_STEPS: 60 * 60,          // 局長 60 秒
  COOLDOWN: 90,                  // 1.5 秒，從生效那一步起算
  LOCK: 180, LOCK_SHELL: 300,    // 鎖 3 秒；硬殼 5 秒
  AIM: 42,                       // AI 預告 0.7 秒
  AI_EVAL: 12,                   // AI 每 0.2 秒評估一次（只在可提交時）
  AI_FIRST_SUBMIT: 60,           // 開場 1 秒 AI 第一刀提交
  AI_D: [30, 21, 12],            // d 上限（步）：0.5／0.35／0.2 秒，依對手序
  AI_NEAR: 0.9,                  // 「最高分附近」＝評分 ≥ 最高分×0.9，以種子亂數挑
  AI_PROTECT: 6,                 // 保護價值：每鎖住一個「生效時沒鎖、在交疊帶內」的己方器官 +6
  REGEN_EVERY: 300, SPROUT: 30,  // 每 5 秒再生 1 個；萌芽 0.5 秒
  MAX_ORGANS: 10,
  HP_PLAYER: 300, HP_ENEMY: [300, 400, 500],
  MIN_LEN: 120, MAX_LEN: 420, LONG_ARM_LEN: 560, R: 26, BONE_HP: 2,
  KINDS: ['claw', 'claw', 'claw', 'claw', 'heart', 'heart', 'eye', 'eye', 'poison', 'bone'] as Kind[],
  SLOTS: 4,
};

// ---------------------------------------------------------------- 縫合（對戰版 8 種）
export type StitchId = 'sharpClaw' | 'twinHeart' | 'oneEye' | 'boneBlade' | 'venom' | 'longArm' | 'echo' | 'hardShell';
export const STITCHES: Record<StitchId, { name: string; desc: string }> = {
  sharpClaw: { name: '鋒爪', desc: '每個爪 +6 籌碼' },
  twinHeart: { name: '雙心', desc: '心的倍率改為 +2' },
  oneEye: { name: '獨眼', desc: '對稱改為 ×3' },
  boneBlade: { name: '骨刃', desc: '碰到骨直接斬斷、不停刀' },
  venom: { name: '毒脈', desc: '每顆毒倍率 +2' },
  longArm: { name: '長臂', desc: '刀長上限 560' },
  echo: { name: '回刃', desc: '每刀最後一個被斬的器官，籌碼再算一次' },
  hardShell: { name: '硬殼', desc: '自己的器官鎖定 3 秒改為 5 秒' },
};
export const STITCH_IDS = Object.keys(STITCHES) as StitchId[];
export const KIND_STITCH: Record<Kind, StitchId[]> = {
  claw: ['sharpClaw', 'hardShell'], heart: ['twinHeart', 'echo'], eye: ['oneEye', 'longArm'], bone: ['boneBlade'], poison: ['venom'],
};
/** 只有影響計分的縫合交給 blade 的 scoreSeq（鋒爪 +6、雙心、獨眼、毒脈、回刃）；骨刃、長臂、硬殼在刀路／鎖定處理（對戰版長臂沒有 +10 籌碼、骨刃沒有 15 籌碼）。 */
const SCORE_STITCHES: StitchId[] = ['sharpClaw', 'twinHeart', 'oneEye', 'venom', 'echo'];
export function damageOf(seq: Kind[], stitches: (StitchId | null)[], echoIdx = seq.length - 1): Score {
  const st = stitches.filter((x): x is StitchId => !!x && SCORE_STITCHES.includes(x)) as unknown as BladeStitch[];
  return scoreSeq(seq, st, echoIdx);
}

// ---------------------------------------------------------------- 盤面
export const W = 700, H = 1000, BAND: [number, number] = [430, 570];   // 交疊帶
export const BODY: Record<Side, V[]> = {
  blue: [[40, 430], [660, 430], [680, 980], [20, 980]],
  red: [[20, 20], [680, 20], [660, 570], [40, 570]],
};
export const DECO_P: V[] = [[160, 930], [290, 935], [410, 935], [540, 930]];   // 縫合裝飾位置（藍方獸身底部，不參與戰鬥）
export function inside(p: V, poly: V[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** 圓與線段相交時，回傳進入點距起點的距離（起點在圓內＝0）；不相交回傳 null。（移植自 rt-cut entryDist） */
export function entryDist(a: V, b: V, c: V, r = TUNE.R): number | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L === 0) return null;
  const u: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], w: V = [c[0] - a[0], c[1] - a[1]];
  const proj = w[0] * u[0] + w[1] * u[1], perp2 = w[0] * w[0] + w[1] * w[1] - proj * proj;
  if (perp2 > r * r) return null;
  const half = Math.sqrt(r * r - perp2), t0 = proj - half, t1 = proj + half;
  if (t1 < 0 || t0 > L) return null;
  return Math.max(t0, 0);
}

// ---------------------------------------------------------------- 狀態
export interface Organ { id: number; side: Side; kind: Kind; p: V; hp: number; sproutUntil: number; lockUntil: number }
export interface Aim { line: Line; aimStep: number; fireStep: number }
export interface Outcome { winner: Side | 'draw'; how: 'ko' | 'time' | 'sudden' }
export interface MatchState {
  seed: number; stage: number; step: number;
  phase: 'fight' | 'sudden' | 'over';
  organs: Organ[]; nextId: number;
  cutQueue: Record<Side, Kind[]>;          // 被斬掉的種類（先進先出，再生用）
  regenNo: Record<Side, number>;
  hp: Record<Side, number>; hpMax: Record<Side, number>;
  cdUntil: Record<Side, number>;
  slots: (StitchId | null)[];              // 藍方（玩家）的縫合；紅方沒有
  drag: Line | null;                       // 玩家拖曳中的線（完整狀態的一部分；AI 不得讀）
  aim: Aim | null; aiLastEff: number | null; aiD: number; aiRng: number;
  severedKinds: Kind[];                    // 這場玩家斬下的種類（縫合選項來源）
  bestHit: number;
  outcome: Outcome | null;
}
export const isLocked = (o: Organ, k: number) => o.lockUntil > k;
export const sprouting = (o: Organ, k: number) => o.sproutUntil > k;
export const lockSteps = (s: MatchState, side: Side) => (side === 'blue' && s.slots.includes('hardShell') ? TUNE.LOCK_SHELL : TUNE.LOCK);
export const maxLen = (s: MatchState, side: Side) => (side === 'blue' && s.slots.includes('longArm') ? TUNE.LONG_ARM_LEN : TUNE.MAX_LEN);
export function rand(x: number): [number, number] {
  const n = (x + 0x6d2b79f5) >>> 0;
  let t = n; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, n];
}

// ---------------------------------------------------------------- 位置合法性（DB-04 補述：整個圓在獸身內、對方至少有一條合法刀線碰得到）
function segPointDist(p: V, a: V, b: V): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** 圓心在獸身內，且圓心到每條邊的距離 ≥ 半徑＋1（整個圓在獸身內，不壓邊）。 */
export function circleInside(p: V, side: Side, r = TUNE.R): boolean {
  const poly = BODY[side];
  if (!inside(p, poly)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segPointDist(p, poly[j], poly[i]) < r + 1) return false;   // 留 1px，圓周不壓在邊上
  return true;
}
/** 對方獸身內存在一個起點，從那裡畫一條長度 ≤420 的刀線能碰到這個圓：圓心到對方獸身的距離 ≤ 420＋半徑（在對方獸身內＝0）。
 *  （對方刀長至少 120 的限制不影響：起點太近時沿同方向延長即可，刀線仍經過圓。） */
export function reachableBy(p: V, attacker: Side, r = TUNE.R): boolean {
  const poly = BODY[attacker];
  if (inside(p, poly)) return true;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segPointDist(p, poly[j], poly[i]));
  return d <= TUNE.MAX_LEN + r - 1;
}
export const validSpot = (p: V, side: Side) => circleInside(p, side) && reachableBy(p, other(side));

// ---------------------------------------------------------------- 生成（每方 10 個，在自己獸身內；保證雙方都有能一刀斬到 ≥3 個敵方器官的線）
function freeAt(p: V, organs: { p: V }[]): boolean { return organs.every((o) => Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) >= 2 * TUNE.R + 6); }
function randomIn(side: Side, rnd: () => number, organs: { p: V }[], band: boolean): V | null {
  for (let t = 0; t < 400; t++) {
    const p: V = band ? [70 + rnd() * 560, BAND[0] + 15 + rnd() * (BAND[1] - BAND[0] - 30)] : side === 'blue' ? [60 + rnd() * 580, 440 + rnd() * 470] : [60 + rnd() * 580, 40 + rnd() * 520];
    const q: V = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    if (validSpot(q, side) && freeAt(q, organs)) return q;
  }
  return null;
}
export function genBoard(seed: number, stage: number): Organ[] {
  for (let attempt = 0; ; attempt++) {
    if (attempt > 2000) throw new Error(`genBoard：seed ${seed} stage ${stage} 找不到合格盤面`);
    const rnd = rngFor(seed, `duel-board${stage}#${attempt}`);
    const organs: Organ[] = [];
    let ok = true;
    for (const side of ['blue', 'red'] as Side[]) {
      const kinds = TUNE.KINDS.slice();
      for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
      kinds.forEach((kind, i) => {
        if (!ok) return;
        const p = randomIn(side, rnd, organs, i < 4);   // 每方前 4 個放在交疊帶
        if (!p) { ok = false; return; }
        organs.push({ id: organs.length, side, kind, p, hp: kind === 'bone' ? TUNE.BONE_HP : 1, sproutUntil: 0, lockUntil: 0 });
      });
    }
    if (!ok) continue;
    const probe = newMatchWith(seed, stage, organs, []);
    if (bestEnemyCount(probe, 'blue') >= 3 && bestEnemyCount(probe, 'red') >= 3) return organs;
  }
}
export function bestEnemyCount(s: MatchState, side: Side): number {
  let best = 0;
  for (const l of candidates(s, side)) { const r = resolveStrike({ ...s, cdUntil: { blue: 0, red: 0 } }, side, l); if (r.ok) best = Math.max(best, r.severed.length); }
  return best;
}
function newMatchWith(seed: number, stage: number, organs: Organ[], slots: (StitchId | null)[]): MatchState {
  return {
    seed, stage, step: 0, phase: 'fight', organs, nextId: organs.length, cutQueue: { blue: [], red: [] }, regenNo: { blue: 0, red: 0 },
    hp: { blue: TUNE.HP_PLAYER, red: TUNE.HP_ENEMY[stage] }, hpMax: { blue: TUNE.HP_PLAYER, red: TUNE.HP_ENEMY[stage] },
    cdUntil: { blue: 0, red: 0 }, slots, drag: null, aim: null, aiLastEff: null, aiD: 0, aiRng: (seed ^ (0x51ed270b * (stage + 1))) >>> 0 || 1,
    severedKinds: [], bestHit: 0, outcome: null,
  };
}
export function newMatch(seed: number, stage: number, slots: (StitchId | null)[] = Array(TUNE.SLOTS).fill(null)): MatchState {
  return newMatchWith(seed, stage, genBoard(seed, stage), slots.slice());
}

// ---------------------------------------------------------------- 單刀判定（在「步開始時」的狀態上判）
export type Reject = 'phase' | 'cooldown' | 'short' | 'start';
export interface StrikeResult {
  ok: boolean; reject?: Reject; side: Side; line: Line;
  locks: number[]; severed: number[]; seqKinds: Kind[]; boneHit: { id: number; broke: boolean } | null;
  blocked: number | null; end: V; score: Score; cuts: { id: number; p: V; d: number }[];
}
export function clampLine(l: Line, max: number): Line {
  const d = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  if (d <= max) return l;
  return { a: l.a, b: [l.a[0] + ((l.b[0] - l.a[0]) * max) / d, l.a[1] + ((l.b[1] - l.a[1]) * max) / d] };
}
/** 刀沿線依距離（同距取 id 小者）：自己的器官鎖住、刀繼續；敵方未鎖非骨器官斬斷入序列、刀繼續；敵方已鎖器官停刀；
 *  敵方骨：耐久 −1，歸零才斷（斷的那刀骨入序列後停刀）；骨刃：碰骨直接斬斷、不停刀。萌芽中的器官完全略過。 */
export function resolveStrike(s: MatchState, side: Side, raw: Line): StrikeResult {
  const empty: Score = damageOf([], []);
  const base = { side, line: raw, locks: [] as number[], severed: [] as number[], seqKinds: [] as Kind[], boneHit: null, blocked: null, end: raw.b, score: empty, cuts: [] };
  if (s.phase === 'over' || (s.phase === 'fight' && s.step >= TUNE.ROUND_STEPS)) return { ...base, ok: false, reject: 'phase' };
  if (Math.hypot(raw.b[0] - raw.a[0], raw.b[1] - raw.a[1]) < TUNE.MIN_LEN) return { ...base, ok: false, reject: 'short' };
  if (s.cdUntil[side] > s.step) return { ...base, ok: false, reject: 'cooldown' };
  if (!inside(raw.a, BODY[side])) return { ...base, ok: false, reject: 'start' };
  const line = clampLine(raw, maxLen(s, side)), k = s.step;
  const L = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  const at = (t: number): V => [line.a[0] + ((line.b[0] - line.a[0]) * t) / L, line.a[1] + ((line.b[1] - line.a[1]) * t) / L];
  const hits = s.organs.filter((o) => !sprouting(o, k)).map((o) => ({ o, t: entryDist(line.a, line.b, o.p) }))
    .filter((h): h is { o: Organ; t: number } => h.t !== null).sort((x, y) => x.t - y.t || x.o.id - y.o.id);
  const locks: number[] = [], severed: number[] = [], seqKinds: Kind[] = [], cuts: { id: number; p: V; d: number }[] = [];
  let boneHit: StrikeResult['boneHit'] = null, blocked: number | null = null, end = line.b;
  const blade = side === 'blue' && s.slots.includes('boneBlade');
  for (const h of hits) {
    const o = h.o;
    if (o.side === side) { locks.push(o.id); continue; }
    if (isLocked(o, k)) { blocked = o.id; end = at(h.t); break; }
    if (o.kind === 'bone' && !blade) {
      const broke = o.hp - 1 <= 0;
      boneHit = { id: o.id, broke };
      if (broke) { severed.push(o.id); seqKinds.push('bone'); cuts.push({ id: o.id, p: o.p, d: h.t }); }
      end = at(h.t); break;
    }
    severed.push(o.id); seqKinds.push(o.kind); cuts.push({ id: o.id, p: o.p, d: h.t });
  }
  const score = side === 'blue' ? damageOf(seqKinds, s.slots) : damageOf(seqKinds, []);
  return { ok: true, side, line, locks, severed, seqKinds, boneHit, blocked, end, score, cuts };
}

// ---------------------------------------------------------------- 再生
/** 每 5 秒的整數倍步（不含 0），器官數（含萌芽）未滿 10 就長回最早被斬掉的種類；位置以種子＋方＋再生序決定，在自己獸身內不與其他器官重疊。 */
function regen(s: MatchState, side: Side): Organ | null {
  const count = s.organs.filter((o) => o.side === side).length;
  if (count >= TUNE.MAX_ORGANS || !s.cutQueue[side].length) return null;
  const kind = s.cutQueue[side].shift()!;
  const rnd = rngFor(s.seed, `duel-regen${s.stage}.${side}.${s.regenNo[side]}`);
  s.regenNo[side]++;
  const p = randomIn(side, rnd, s.organs, false);
  if (!p) { s.cutQueue[side].unshift(kind); return null; }
  const o: Organ = { id: s.nextId++, side, kind, p, hp: kind === 'bone' ? TUNE.BONE_HP : 1, sproutUntil: s.step + TUNE.SPROUT, lockUntil: 0 };
  s.organs.push(o);
  return o;
}

// ---------------------------------------------------------------- AI（只讀公開狀態）
export const AI_ANCHORS: Record<Side, V[]> = {
  red: [[80, 450], [260, 450], [440, 450], [620, 450], [120, 545], [330, 545], [540, 545]],
  blue: [[80, 550], [260, 550], [440, 550], [620, 550], [120, 455], [330, 455], [540, 455]],
};
export const AI_ANGLES = 24, AI_LENGTHS = [160, 280, 420];
/** 候選刀：起點＝己方可互動器官中心＋7 個錨點；角度每 15°；長度 160／280／420（長臂時加 560）。 */
export function candidates(s: MatchState, side: Side): Line[] {
  const starts: V[] = s.organs.filter((o) => o.side === side && !sprouting(o, s.step)).map((o) => o.p);
  starts.push(...AI_ANCHORS[side]);
  const lens = maxLen(s, side) > TUNE.MAX_LEN ? [...AI_LENGTHS, maxLen(s, side)] : AI_LENGTHS;
  const out: Line[] = [];
  for (const a of starts) for (let i = 0; i < AI_ANGLES; i++) {
    const th = (i * 2 * Math.PI) / AI_ANGLES;
    for (const len of lens) out.push({ a, b: [Math.round((a[0] + Math.cos(th) * len) * 100) / 100, Math.round((a[1] + Math.sin(th) * len) * 100) / 100] });
  }
  return out;
}
/** AI 只看得到的部分：玩家拖曳中的線一律清空。 */
export function publicView(s: MatchState): MatchState { return { ...s, drag: null }; }
/** 評分＝預估刀譜傷害＋保護價值（每鎖住一個「生效時沒鎖、在交疊帶內」的己方器官 +AI_PROTECT）。判定時把冷卻視為已好、時刻視為生效步。 */
export function aiChoose(state: MatchState, fireStep: number): { line: Line | null; rng: number } {
  const view = publicView(state);
  const probe: MatchState = { ...view, step: Math.min(fireStep, view.phase === 'fight' ? TUNE.ROUND_STEPS - 1 : fireStep), cdUntil: { ...view.cdUntil, red: 0 } };
  let best = -Infinity; const scored: { l: Line; v: number }[] = [];
  for (const l of candidates(probe, 'red')) {
    const r = resolveStrike(probe, 'red', l);
    if (!r.ok) continue;
    let v = r.score.score;
    for (const id of r.locks) { const o = probe.organs.find((x) => x.id === id)!; if (!isLocked(o, fireStep) && o.p[1] >= BAND[0] - 40 && o.p[1] <= BAND[1] + 40) v += TUNE.AI_PROTECT; }
    scored.push({ l, v }); if (v > best) best = v;
  }
  if (!scored.length) return { line: null, rng: state.aiRng };
  const pool = scored.filter((c) => c.v >= best * TUNE.AI_NEAR);
  const [u, n] = rand(state.aiRng);
  return { line: pool[Math.min(pool.length - 1, Math.floor(u * pool.length))].l, rng: n };
}

// ---------------------------------------------------------------- 一步（雙方同步）
export type MatchEvent =
  | { t: 'strike'; r: StrikeResult; dmg: number }
  | { t: 'reject'; side: Side; reason: Reject }
  | { t: 'aim'; aim: Aim }
  | { t: 'regen'; organ: Organ }
  | { t: 'sudden' }
  | { t: 'over'; outcome: Outcome };
export interface StepInput { blue?: Line | null; drag?: Line | null }
function clone(s: MatchState): MatchState {
  return { ...s, organs: s.organs.map((o) => ({ ...o })), cutQueue: { blue: [...s.cutQueue.blue], red: [...s.cutQueue.red] }, regenNo: { ...s.regenNo },
    hp: { ...s.hp }, hpMax: { ...s.hpMax }, cdUntil: { ...s.cdUntil }, slots: [...s.slots], aim: s.aim && { ...s.aim }, severedKinds: [...s.severedKinds] };
}
export function step(s0: MatchState, input: StepInput = {}): { state: MatchState; events: MatchEvent[] } {
  const ev: MatchEvent[] = [];
  if (s0.phase === 'over') return { state: s0, events: ev };
  const s = clone(s0), k = s.step;
  // 時間到：比血；同血進突然死亡（拖曳中的刀、已提交未生效的 AI 刀作廢）
  if (s.phase === 'fight' && k >= TUNE.ROUND_STEPS) {
    s.drag = null; s.aim = null;
    if (input.blue) ev.push({ t: 'reject', side: 'blue', reason: 'phase' });
    if (s.hp.blue !== s.hp.red) { s.phase = 'over'; s.outcome = { winner: s.hp.blue > s.hp.red ? 'blue' : 'red', how: 'time' }; ev.push({ t: 'over', outcome: s.outcome }); return { state: s, events: ev }; }
    s.phase = 'sudden'; ev.push({ t: 'sudden' });
    s.step = k + 1; return { state: s, events: ev };
  }
  s.drag = input.drag ?? null;
  let red: Line | null = null;
  if (s.aim && s.aim.fireStep === k) { red = s.aim.line; s.aim = null; }
  const strikes: StrikeResult[] = [];
  if (input.blue) { const r = resolveStrike(s0, 'blue', input.blue); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'blue', reason: r.reject! }); }
  if (red) { const r = resolveStrike(s0, 'red', red); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'red', reason: r.reject! }); }
  const byId = new Map(s.organs.map((o) => [o.id, o]));
  // 套用：先鎖、骨耐久，再斬（同步時以步開始狀態判，已斬的器官鎖不住）
  for (const r of strikes) {
    for (const id of r.locks) byId.get(id)!.lockUntil = k + lockSteps(s, r.side);
    s.cdUntil[r.side] = k + TUNE.COOLDOWN;
    if (r.boneHit && !r.boneHit.broke) byId.get(r.boneHit.id)!.hp -= 1;
  }
  const dead = new Set<number>();
  for (const r of strikes) for (const id of r.severed) dead.add(id);
  if (dead.size) {
    for (const o of s.organs) if (dead.has(o.id)) s.cutQueue[o.side].push(o.kind);
    s.organs = s.organs.filter((o) => !dead.has(o.id));
  }
  const dmg: Record<Side, number> = { blue: 0, red: 0 };
  for (const r of strikes) {
    dmg[r.side] = r.score.score;
    s.hp[other(r.side)] = Math.max(0, s.hp[other(r.side)] - r.score.score);
    if (r.side === 'blue') { s.severedKinds.push(...r.seqKinds); s.bestHit = Math.max(s.bestHit, r.score.score); }
    ev.push({ t: 'strike', r, dmg: r.score.score });
  }
  if (red) { s.aiLastEff = k; const [u, n] = rand(s.aiRng); s.aiRng = n; s.aiD = Math.floor(u * (TUNE.AI_D[s.stage] + 1)); }
  // 結束判定：擊倒（同步雙方歸零＝平手）；突然死亡中先造成傷害者勝（同步都造成傷害：傷害高者勝，同傷害平手）
  const ko = { blue: s.hp.blue <= 0, red: s.hp.red <= 0 };
  if (ko.blue || ko.red) s.outcome = { winner: ko.blue && ko.red ? 'draw' : ko.red ? 'blue' : 'red', how: 'ko' };
  else if (s.phase === 'sudden' && (dmg.blue > 0 || dmg.red > 0)) s.outcome = { winner: dmg.blue > dmg.red ? 'blue' : dmg.red > dmg.blue ? 'red' : 'draw', how: 'sudden' };
  if (s.outcome) { s.phase = 'over'; s.aim = null; s.drag = null; ev.push({ t: 'over', outcome: s.outcome }); return { state: s, events: ev }; }
  s.step = k + 1;
  // 再生（每 5 秒）
  if (s.step % TUNE.REGEN_EVERY === 0) for (const side of ['blue', 'red'] as Side[]) { const o = regen(s, side); if (o) ev.push({ t: 'regen', organ: o }); }
  // AI 提交：每 0.2 秒評估；第一刀 1 秒提交；生效＝提交＋0.7 秒且 ≥ 上一刀生效＋1.5＋d；生效落在時間到之後的不提交
  if (!s.aim) {
    const kk = s.step, fire = kk + TUNE.AIM;
    const can = s.aiLastEff === null ? kk === TUNE.AI_FIRST_SUBMIT : kk % TUNE.AI_EVAL === 0 && fire >= s.aiLastEff + TUNE.COOLDOWN + s.aiD;
    if (can && (s.phase === 'sudden' || fire < TUNE.ROUND_STEPS)) {
      const pick = aiChoose(s, fire); s.aiRng = pick.rng;
      if (pick.line) { s.aim = { line: pick.line, aimStep: kk, fireStep: fire }; ev.push({ t: 'aim', aim: s.aim }); }
    }
  }
  return { state: s, events: ev };
}

// ---------------------------------------------------------------- 征途
export interface Campaign { seed: number; stage: number; slots: (StitchId | null)[]; phase: 'fight' | 'stitch' | 'won' | 'lost'; offer: StitchId[]; wins: number; history: { stage: number; outcome: Outcome; hpLeft: number; bestHit: number }[] }
export function newCampaign(seed: number): Campaign {
  return { seed, stage: 0, slots: Array(TUNE.SLOTS).fill(null), phase: 'fight', offer: [], wins: 0, history: [] };
}
/** 一場結束：勝→縫合（最後一場勝＝征途勝利）；敗或平手→征途結束。 */
export function finishMatch(c: Campaign, m: MatchState): Campaign {
  const o = m.outcome!;
  const history = [...c.history, { stage: c.stage, outcome: o, hpLeft: m.hp.blue, bestHit: m.bestHit }];
  if (o.winner !== 'blue') return { ...c, phase: 'lost', history };
  if (c.stage === TUNE.HP_ENEMY.length - 1) return { ...c, phase: 'won', wins: c.wins + 1, history };
  return { ...c, phase: 'stitch', wins: c.wins + 1, history, offer: stitchOffer(c, m.severedKinds) };
}
export function stitchOffer(c: Campaign, severedKinds: Kind[]): StitchId[] {
  const rnd = rngFor(c.seed, `duel-offer${c.stage}`);
  const owned = new Set(c.slots.filter(Boolean));
  const pool = [...new Set(severedKinds.flatMap((k) => KIND_STITCH[k]))].filter((x) => !owned.has(x));
  const rest = STITCH_IDS.filter((x) => !owned.has(x) && !pool.includes(x));
  const take = (arr: StitchId[], n: number) => { const a = arr.slice(), out: StitchId[] = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  const out = take(pool, 3);
  return [...out, ...take(rest, 3 - out.length)];
}
/** 挑 1 個縫上（槽滿時必須指定替換槽），進下一場；血量回滿（新場以滿血開始）。 */
export function chooseStitch(c: Campaign, pick: StitchId, slot?: number): Campaign {
  if (c.phase !== 'stitch' || !c.offer.includes(pick)) return c;
  const target = slot ?? c.slots.findIndex((x) => x === null);
  if (target < 0 || target >= TUNE.SLOTS) return c;
  const slots = c.slots.slice(); slots[target] = pick;
  return { ...c, slots, stage: c.stage + 1, phase: 'fight', offer: [] };
}
export const matchFor = (c: Campaign) => newMatch(c.seed, c.stage, c.slots);
