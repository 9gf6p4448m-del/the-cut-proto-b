// 「即時亂切」研究片段（子路徑 rt-cut/）的全部規則：盤面常數、單刀判定、固定步長模擬、AI、對決戰力。純函式，不碰 DOM。
// 規格：the-cut docs/rt-cut/ACCEPTANCE_FROZEN.md（RT-01～09＋補述 1）。可丟棄原型，非正式規則。
// 切割→戰鬥（duel/，the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md）以 Mode 的選填欄位沿用本檔：局長、器官組成、再生上限、生成位置規則、AI 亂數上限。
// 選填欄位不給時（MODE_RT1／MODE_RT2）行為與 rt-cut／rt-cut2 完全相同。
export type V = [number, number];
export type Side = 'blue' | 'red';
export type Kind = 'claw' | 'heart' | 'eye' | 'poison' | 'bone' | 'fang';   // 眼／毒／骨只出現在切割→戰鬥；切割期它們只是普通器官
export interface Line { a: V; b: V }
export interface OrganDef { id: string; side: Side; kind: Kind; p: V }
export const SIDES: Side[] = ['blue', 'red'];
export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

// ---------------------------------------------------------------- 數值（標【試玩數值】者可調，調了寫進作者證據）
export const FPS = 60;                       // 固定步長 1/60 秒（補述 1）
export const CUT_SECONDS = 40;               // 亂切期【試玩數值】
export const END_STEP = CUT_SECONDS * FPS;   // 第 END_STEP 步起（剛好 40.000 秒）不能再出刀
export const COOLDOWN_STEPS = 90;            // 1.5 秒【試玩數值】
export const LOCK_STEPS = 300;               // 5 秒【試玩數值】
export const AIM_STEPS = 36;                 // AI 預告 0.6 秒（凍結下限 0.5 秒）【試玩數值】
export const AI_JITTER_STEPS = 54;           // 出刀間隔＝冷卻＋0～0.9 秒
export const AI_FIRST_FIRE_STEP = 60;        // 開場 1 秒後 AI 第一刀生效【試玩數值】
export const MIN_LEN = 120, MAX_LEN = 420, R = 28;
export const VALUE: Record<Kind, number> = { claw: 2, heart: 4, eye: 3, poison: 3, bone: 2, fang: 3 };   // fang＝duel5 蛇牙（試玩值，DUEL_V05_SNAKE 補述 1 第 5 條：權重不改的明文例外）   // 眼／毒／骨的 AI 切除價值是切割→戰鬥的試玩值
// rt-cut2（擊倒＋再生）：以模式參數開關；預設 MODE_RT1＝原版行為不變（R2-04）
export interface Mode {
  knockout: boolean; regen: boolean;
  // ---- 切割→戰鬥（CB）專用，選填 ----
  cutSteps?: number;                         // 局長（步）；不給＝END_STEP（40 秒）
  maxPerSide?: Record<Side, number>;         // 再生上限；不給＝MAX_PER_SIDE（8）
  spawnRule?: 'cb';                          // 'cb'＝再生位置另須整個圓在獸身內、對方刀碰得到（DUEL_BLADE_V01 補述 1）
  aiJitter?: number;                         // AI 出刀間隔＝冷卻＋0～aiJitter 步；不給＝AI_JITTER_STEPS
  body?: Record<Side, V[]>;                  // 獸身多邊形（duel2：由已確認的 beast_boundary.json 換成世界座標）；不給＝BODY
  r?: number;                                // 器官判定半徑（duel3：34，DUEL_V03_FEEL 二）；不給＝R（28）
  front?: { unit: number; max: number };     // duel4 前線推進（DUEL_V04_FRONT 一）：每 1 推進值延伸 unit 世界單位、推進值上下限 ±max；不給＝沒有推進
  beasts?: Record<Side, Beast>;              // duel5：雙方的怪獸（決定技能：龍＝蛻生、蛇＝穿刺）；不給＝沒有技能
  originRegen?: Side[];                      // duel5：這些陣營再生時長回原位（蛇，DUEL_V05_SNAKE 補述 1 第 3 條）；其他陣營照 spawnPoint
}
export type Beast = 'dragon' | 'snake';
export const PIERCE_STEPS = 300, PIERCE_MAX = 3;   // 穿刺：按下後 300 步（5 秒）內的下一刀，最多連切 3 個（DUEL_V05_SNAKE 二、補述 1 第 7／8 條）
/** 這一局的器官判定半徑。 */
export const radOf = (mode: { r?: number }): number => mode.r ?? R;
/** 這一局的獸身多邊形（起刀、再生、位置規則都用它）。 */
export const bodyOf = (mode: { body?: Record<Side, V[]> }, side: Side): V[] => mode.body?.[side] ?? BODY[side];
export const MODE_RT1: Mode = { knockout: false, regen: false };
export const MODE_RT2: Mode = { knockout: true, regen: true };
export const REGEN_STEPS = 300;              // 每 5 秒一個再生節拍【試玩數值】
export const SPROUT_STEPS = 30;              // 萌芽 0.5 秒
export const MAX_PER_SIDE = 8;               // 未滿 8 個才再生

// ---------------------------------------------------------------- 盤面（固定一張；單一常數表，索引＝同距離時的先後）
// 藍在下、紅在上，中段 y 430～570 交疊；交疊區 y≈500 一列雙方爪交錯（藍 100/300/500、紅 200/400/600），一條橫刀可穿過好幾顆。
export const BODY: Record<Side, V[]> = {
  blue: [[40, 430], [660, 430], [680, 980], [20, 980]],
  red: [[20, 20], [680, 20], [660, 570], [40, 570]],
};
export const ORGANS: OrganDef[] = [
  { id: '藍爪1', side: 'blue', kind: 'claw', p: [100, 520] },
  { id: '藍爪2', side: 'blue', kind: 'claw', p: [300, 520] },
  { id: '藍爪3', side: 'blue', kind: 'claw', p: [500, 520] },
  { id: '藍爪4', side: 'blue', kind: 'claw', p: [140, 660] },
  { id: '藍爪5', side: 'blue', kind: 'claw', p: [350, 640] },
  { id: '藍爪6', side: 'blue', kind: 'claw', p: [560, 660] },
  { id: '藍心1', side: 'blue', kind: 'heart', p: [240, 790] },
  { id: '藍心2', side: 'blue', kind: 'heart', p: [460, 790] },
  { id: '紅爪1', side: 'red', kind: 'claw', p: [600, 480] },
  { id: '紅爪2', side: 'red', kind: 'claw', p: [400, 480] },
  { id: '紅爪3', side: 'red', kind: 'claw', p: [200, 480] },
  { id: '紅爪4', side: 'red', kind: 'claw', p: [560, 340] },
  { id: '紅爪5', side: 'red', kind: 'claw', p: [350, 360] },
  { id: '紅爪6', side: 'red', kind: 'claw', p: [140, 340] },
  { id: '紅心1', side: 'red', kind: 'heart', p: [460, 210] },
  { id: '紅心2', side: 'red', kind: 'heart', p: [240, 210] },
];

// ---------------------------------------------------------------- 幾何
export function inside(p: V, poly: V[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** 器官圓與線段相交時，回傳沿線第一個交點距起點的距離（起點在圓內＝0）；不相交回傳 null。 */
export function entryDist(a: V, b: V, c: V, r = R): number | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L === 0) return null;
  const u: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], w: V = [c[0] - a[0], c[1] - a[1]];
  const proj = w[0] * u[0] + w[1] * u[1], perp2 = w[0] * w[0] + w[1] * w[1] - proj * proj;
  if (perp2 > r * r) return null;
  const half = Math.sqrt(r * r - perp2), t0 = proj - half, t1 = proj + half;
  if (t1 < 0 || t0 > L) return null;
  return Math.max(t0, 0);
}
/** >MAX_LEN 截斷為 MAX_LEN（方向不變）。 */
export function clampLine(l: Line): Line {
  const d = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  if (d <= MAX_LEN) return l;
  return { a: l.a, b: [l.a[0] + ((l.b[0] - l.a[0]) * MAX_LEN) / d, l.a[1] + ((l.b[1] - l.a[1]) * MAX_LEN) / d] };
}

/** 本局切割期的結束步。 */
export const endStep = (s: { mode: Mode }) => s.mode.cutSteps ?? END_STEP;

// ---------------------------------------------------------------- 位置規則（CB；DUEL_BLADE_V01 補述 1）
function segPointDist(p: V, a: V, b: V): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** 圓心在獸身內，且到每條邊 ≥ 半徑＋1（整個圓在獸身內，不壓邊）。body 不給＝BODY。 */
export function circleInside(p: V, side: Side, r = R, body?: Record<Side, V[]>): boolean {
  const poly = body?.[side] ?? BODY[side];
  if (!inside(p, poly)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segPointDist(p, poly[j], poly[i]) < r + 1) return false;
  return true;
}
/** 攻擊方獸身內存在一個起點，長度 ≤ MAX_LEN 的刀碰得到這個圓（圓心到攻擊方獸身距離 ≤ MAX_LEN＋R−1）。 */
export function reachableBy(p: V, attacker: Side, r = R, body?: Record<Side, V[]>): boolean {
  const poly = body?.[attacker] ?? BODY[attacker];
  if (inside(p, poly)) return true;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segPointDist(p, poly[j], poly[i]));
  return d <= MAX_LEN + r - 1;
}
export const validSpot = (p: V, side: Side, body?: Record<Side, V[]>, r = R) => circleInside(p, side, r, body) && reachableBy(p, other(side), r, body);
/** 線段 ab 與線段 cd 相交（含端點接觸）。 */
function segCross(a: V, b: V, c: V, d: V): boolean {
  const o = (p: V, q: V, r: V) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: V, q: V, r: V) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}
/** 線段 ab 碰到多邊形（端點在內，或與任一邊相交）。 */
export function segHitsPoly(a: V, b: V, poly: V[]): boolean {
  if (inside(a, poly) || inside(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segCross(a, b, poly[j], poly[i])) return true;
  return false;
}
/** duel4 前線延伸長度（世界單位）：玩家（藍）在 push>0、AI（紅）在 push<0 時延伸 |push|×unit；沒有前線推進＝0。 */
export const extOf = (mode: Mode, push: number, side: Side): number => (mode.front ? Math.max(0, side === 'blue' ? push : -push) * mode.front.unit : 0);
/**
 * 起刀區（DUEL_V04_FRONT 一＋補述 1 第 2 條）：自己的獸身，加上延伸區。
 * 延伸區＝對方獸身內、往自己方向（藍往下、紅往上）0..延伸長度的垂直線段碰到自己獸身的點
 * ＝「自己獸身朝對方平移 0..延伸長度的聯集 ∩ 對方獸身」（凹多邊形也精確）。沒有前線推進的模式＝原本的「獸身內」。
 */
export function inStartZone(mode: Mode, push: number, side: Side, p: V): boolean {
  const own = bodyOf(mode, side);
  if (inside(p, own)) return true;
  const d = extOf(mode, push, side);
  if (d <= 0 || !inside(p, bodyOf(mode, other(side)))) return false;
  return segHitsPoly(p, [p[0], side === 'blue' ? p[1] + d : p[1] - d], own);
}
export const startOk = (s: GameState, side: Side, p: V): boolean => inStartZone(s.mode, s.push ?? 0, side, p);

// ---------------------------------------------------------------- 狀態
export type Phase = 'cut' | 'duel' | 'ko';
export interface Aim { line: Line; aimStep: number; fireStep: number }
export interface GameState {
  seed: number;
  step: number;                       // 下一個要跑的步（時間＝step/FPS 秒）
  phase: Phase;
  alive: boolean[];                   // 依 ORGANS 索引
  lockUntil: number[];                // 步開始時 lockUntil > step ＝已鎖
  cdUntil: Record<Side, number>;      // 步開始時 cdUntil > step ＝冷卻中
  drag: Record<Side, Line | null>;    // 拖曳中的線（完整遊戲狀態的一部分；AI 不得讀）
  aim: Aim | null;                    // AI 預告中的刀
  aiNextFire: number;                 // AI 下一刀預定生效的步
  rng: number;                        // AI 亂數狀態（mulberry32）
  result: DuelResult | null;
  // ---- rt-cut2 起新增（原版模式下 organs＝ORGANS、readyAt 全 0、其餘不動） ----
  mode: Mode;
  organs: OrganDef[];                 // 盤面器官表（原版＝ORGANS；再生的器官接在後面）
  readyAt: number[];                  // 萌芽結束的步：step < readyAt ＝萌芽中（不能被切、鎖、也不擋刀）
  severedQ: Record<Side, Kind[]>;     // 各方被切掉的器官種類（先切先長）
  severedN: Record<Side, number>;     // 各方切掉對方的總數
  regenRng: number;                   // 再生位置亂數（與 AI 亂數分開）
  end: { by: 'ko' | 'time'; winner: Side | 'draw' } | null;
  // ---- duel3 即時劃刀：進行中的刀（只有用到即時劃刀時才出現；其他模式沒有這個欄位） ----
  stroke?: Partial<Record<Side, Stroke | null>>;
  // ---- duel4 前線推進（只有 mode.front 的模式才出現） ----
  push?: number;                      // 推進值：玩家切除 +1、AI 切除 −1，同一步先算淨值再夾到 ±front.max；每場從 0 開始
  aiHold?: boolean;                   // 教學場：玩家第一次鎖定或切除之前 AI 不出刀（補述 1 第 4 條）
  // ---- duel5 技能（只有 mode.beasts 的模式才出現） ----
  skillUsed?: Record<Side, boolean>;  // 每場一次
  pierce?: Partial<Record<Side, { until: number }>>;   // 穿刺生效中：until 之前按下的刀帶穿刺
  startN?: Record<Side, number>;      // 這一場開局的器官數（AI 蛻生門檻：2×存活 ≤ 開局數）
  severedP?: Record<Side, V[]>;       // 被切器官的原位（和 severedQ 同序；長回原位用）
}
export interface DuelResult { claws: Record<Side, number>; hearts: Record<Side, number>; power: Record<Side, number>; winner: Side | 'draw' }

export function newGame(seed: number, mode: Mode = MODE_RT1, organs: OrganDef[] = ORGANS): GameState {
  return {
    seed: seed >>> 0, step: 0, phase: 'cut', alive: organs.map(() => true), lockUntil: organs.map(() => 0),
    cdUntil: { blue: 0, red: 0 }, drag: { blue: null, red: null }, aim: null, aiNextFire: AI_FIRST_FIRE_STEP,
    rng: (seed >>> 0) || 0x9e3779b9, result: null,
    mode, organs, readyAt: organs.map(() => 0), severedQ: { blue: [], red: [] }, severedN: { blue: 0, red: 0 },
    regenRng: ((seed ^ 0x5bd1e995) >>> 0) || 1, end: null,
  };
}
function clone(s: GameState): GameState {
  const c: GameState = { ...s, alive: [...s.alive], lockUntil: [...s.lockUntil], cdUntil: { ...s.cdUntil }, drag: { ...s.drag }, aim: s.aim && { ...s.aim }, result: s.result,
    organs: s.organs, readyAt: [...s.readyAt], severedQ: { blue: [...s.severedQ.blue], red: [...s.severedQ.red] }, severedN: { ...s.severedN } };
  if (s.stroke) c.stroke = { ...s.stroke };
  if (s.severedP) c.severedP = { blue: [...s.severedP.blue], red: [...s.severedP.red] };
  return c;
}
/** mulberry32：回傳 [0,1) 與新狀態。 */
export function rand(x: number): [number, number] {
  const n = (x + 0x6d2b79f5) >>> 0;
  let t = n;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, n];
}
export const isLocked = (s: GameState, i: number) => s.lockUntil[i] > s.step;
/** 存在＝沒被切除且萌芽已結束。 */
export const isReady = (s: GameState, i: number) => s.alive[i] && s.step >= s.readyAt[i];
/** 一方目前的器官數（含萌芽中）。 */
export const countSide = (s: GameState, side: Side) => s.organs.reduce((n, o, i) => n + (o.side === side && s.alive[i] ? 1 : 0), 0);

// ---------------------------------------------------------------- 單刀判定（在「步開始時」的狀態上判）
export type Reject = 'phase' | 'cooldown' | 'short' | 'start';
export interface StrikeResult {
  ok: boolean; reject?: Reject; side: Side; line: Line;
  locks: number[]; severed: number | null; blocked: number | null; end: V;
  pierced?: number[];                 // duel5 穿刺：這一刀連切下的器官（依序；severed＝第一個）
}
export function resolveStrike(s: GameState, side: Side, raw: Line): StrikeResult {
  const base = { side, line: raw, locks: [] as number[], severed: null, blocked: null, end: raw.b };
  if (s.phase !== 'cut' || s.step >= endStep(s)) return { ...base, ok: false, reject: 'phase' };
  if (Math.hypot(raw.b[0] - raw.a[0], raw.b[1] - raw.a[1]) < MIN_LEN) return { ...base, ok: false, reject: 'short' };
  if (s.cdUntil[side] > s.step) return { ...base, ok: false, reject: 'cooldown' };
  if (!startOk(s, side, raw.a)) return { ...base, ok: false, reject: 'start' };
  const line = clampLine(raw);
  const hits: { i: number; t: number }[] = [];
  const rr = radOf(s.mode);
  s.organs.forEach((o, i) => { if (!isReady(s, i)) return; const t = entryDist(line.a, line.b, o.p, rr); if (t !== null) hits.push({ i, t }); });
  hits.sort((x, y) => x.t - y.t || x.i - y.i);
  const locks: number[] = [];
  const L = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  const at = (t: number): V => [line.a[0] + ((line.b[0] - line.a[0]) * t) / L, line.a[1] + ((line.b[1] - line.a[1]) * t) / L];
  const pz = s.pierce?.[side], pierce = !!pz && s.step < pz.until, cut: number[] = [];   // duel5 穿刺：直線刀也連切（補述 1 第 7 條）
  for (const h of hits) {
    if (s.organs[h.i].side === side) { locks.push(h.i); continue; }
    if (isLocked(s, h.i)) return { ok: true, side, line, locks, severed: cut[0] ?? null, blocked: h.i, end: at(h.t), ...(pierce ? { pierced: cut } : {}) };
    if (!pierce) return { ok: true, side, line, locks, severed: h.i, blocked: null, end: at(h.t) };
    cut.push(h.i);
    if (cut.length >= PIERCE_MAX) return { ok: true, side, line, locks, severed: cut[0], blocked: null, end: at(h.t), pierced: cut };
  }
  return { ok: true, side, line, locks, severed: cut[0] ?? null, blocked: null, end: line.b, ...(pierce ? { pierced: cut } : {}) };
}

// ---------------------------------------------------------------- 一步（雙方同步：都在步開始狀態上判，再一起套用）
export type GameEvent =
  | { t: 'strike'; r: StrikeResult }
  | { t: 'reject'; side: Side; reason: Reject }
  | { t: 'aim'; aim: Aim }
  | { t: 'duel'; result: DuelResult }
  | { t: 'ko'; winner: Side | 'draw'; result: DuelResult }
  | { t: 'spawn'; i: number }
  | { t: 'freeStart'; side: Side; p: V }
  | { t: 'freeReject'; side: Side; reason: Reject }
  | { t: 'freeLock'; side: Side; i: number }
  | { t: 'freeEnd'; side: Side; why: FreeEndWhy; locks: number[]; severed: number | null; blocked: number | null; end: V; dir: V; len: number }
  | { t: 'push'; push: number; d: number }     // duel4：推進值改變（d＝這一步的淨值，夾限前）
  | { t: 'aiRelease' }                         // duel4 教學場：玩家第一次鎖定或切除，AI 開始出刀
  | { t: 'freeCut'; side: Side; i: number }    // duel5 穿刺：連切中切下一個（當步生效）
  | { t: 'skill'; side: Side; kind: 'pierce' | 'molt'; i?: number }   // duel5 技能生效（蛻生 i＝長回的器官）
  | { t: 'skillReject'; side: Side; why: 'used' | 'phase' | 'none' }  // duel5 技能按了但不能用（none＝沒有可長回的器官；不算用掉）
  | { t: 'pierceEnd'; side: Side; why: 'used' | 'expired' };          // duel5 穿刺結束（出刀用掉／5 秒內沒出刀失效）
export interface StepInput { blue?: Line | null; drag?: Line | null; free?: Partial<Record<Side, Piece[]>>; skill?: Partial<Record<Side, boolean>> }   // skill＝duel5 這一步按下技能鈕
export interface StepOut { state: GameState; events: GameEvent[] }

/** 再生位置：獸身多邊形內、與所有現存器官（含萌芽中、含對方）中心距 ≥2R；用再生亂數流取樣，最多 400 次。改寫 s.regenRng。 */
function spawnPoint(s: GameState, side: Side): V | null {
  const poly = bodyOf(s.mode, side), xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let tries = 0; tries < 400; tries++) {
    let u: number, v: number;
    [u, s.regenRng] = rand(s.regenRng); [v, s.regenRng] = rand(s.regenRng);
    const p: V = [Math.round(x0 + u * (x1 - x0)), Math.round(y0 + v * (y1 - y0))];
    if (!inside(p, poly)) continue;
    const rr = radOf(s.mode);
    if (s.mode.spawnRule === 'cb' && !validSpot(p, side, s.mode.body, rr)) continue;
    if (s.organs.some((o, i) => s.alive[i] && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 2 * rr)) continue;
    // 不長到對方（蛇）還沒長回的原位上：被佔住的話蛇的 FIFO 隊首永遠長不回來（審查 H1）
    if (SIDES.some((o) => o !== side && s.mode.originRegen?.includes(o) && s.severedP?.[o].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2 * rr))) continue;
    return p;
  }
  return null;
}
/** 長回一個器官（FIFO 隊首的種類）：未達上限、隊列不空才長；位置＝spawnPoint，或 mode.originRegen 的陣營長回「該顆的原位」（蛇）。萌芽 0.5 秒。
 * 長不出來回傳 null（隊列空、已滿、找不到位置、原位被佔）。改寫 s。 */
export function regrowOne(s: GameState, side: Side, k: number): number | null {
  if (countSide(s, side) >= (s.mode.maxPerSide?.[side] ?? MAX_PER_SIDE) || !s.severedQ[side].length) return null;
  let p: V | null;
  if (s.mode.originRegen?.includes(side) && s.severedP?.[side].length) {
    p = s.severedP[side][0];
    const rr = radOf(s.mode);
    if (s.organs.some((o, i) => s.alive[i] && Math.hypot(o.p[0] - p![0], o.p[1] - p![1]) < 2 * rr)) return null;
  } else p = spawnPoint(s, side);
  if (!p) return null;
  const kind = s.severedQ[side].shift()!;
  if (s.severedP) s.severedP[side].shift();
  const n = s.organs.filter((o) => o.side === side && o.kind === kind).length + 1;
  s.organs = [...s.organs, { id: `${side === 'blue' ? '藍' : '紅'}${KIND_ZH[kind]}${n}`, side, kind, p: [p[0], p[1]] }];
  s.alive.push(true); s.lockUntil.push(0); s.readyAt.push(k + SPROUT_STEPS);
  return s.organs.length - 1;
}
export const KIND_ZH: Record<Kind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨', fang: '牙' };
export function step(s0: GameState, input: StepInput = {}): StepOut {
  const ev: GameEvent[] = [];
  if (s0.phase !== 'cut') return { state: s0, events: ev };
  const s = clone(s0);
  const k = s.step;
  if (k >= endStep(s)) {
    // 剛好達局長（原版 40 秒）：凍結盤面、拖曳作廢、預告作廢、進入對決
    s.phase = 'duel'; s.drag = { blue: null, red: null }; s.aim = null; s.result = duel(s); s.end = { by: 'time', winner: s.result.winner };
    if (s.stroke) s.stroke = { blue: null, red: null };   // 進行中的即時刀作廢（切割期已結束）
    if (input.blue) ev.push({ t: 'reject', side: 'blue', reason: 'phase' });
    ev.push({ t: 'duel', result: s.result });
    return { state: s, events: ev };
  }
  s.drag.blue = input.drag ?? null;
  // duel5 技能：按下的那一步處理（DUEL_V05_SNAKE 二）。蛇＝穿刺（設定有效期，刀在之後的步帶上）；龍＝蛻生（立刻長回 FIFO 隊首）
  if (s.mode.beasts && input.skill) for (const side of SIDES) {
    if (!input.skill[side]) continue;
    if (s.skillUsed?.[side]) { ev.push({ t: 'skillReject', side, why: 'used' }); continue; }
    if (s.mode.beasts[side] === 'snake') {
      s.pierce = { ...(s.pierce ?? {}), [side]: { until: k + PIERCE_STEPS } }; s.skillUsed = { blue: s.skillUsed?.blue ?? false, red: s.skillUsed?.red ?? false, [side]: true };
      ev.push({ t: 'skill', side, kind: 'pierce' });
    } else {
      const i = regrowOne(s, side, k);
      if (i === null) { ev.push({ t: 'skillReject', side, why: 'none' }); continue; }   // 沒有可長回的器官：不能用、不算用掉
      s.skillUsed = { blue: s.skillUsed?.blue ?? false, red: s.skillUsed?.red ?? false, [side]: true };
      ev.push({ t: 'skill', side, kind: 'molt', i }, { t: 'spawn', i });
    }
  }
  // AI：到了預告時刻就用「目前狀態」選刀並固定刀線
  let red: Line | null = null;
  if (s.aim && s.aim.fireStep === k) { red = s.aim.line; s.aim = null; }
  // 雙方都在步開始狀態 s0 上判（拖曳線只寫進 s，不影響判定）
  const strikes: StrikeResult[] = [];
  if (input.blue) { const r = resolveStrike(s0, 'blue', input.blue); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'blue', reason: r.reject! }); }
  if (red) { const r = resolveStrike(s0, 'red', red); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'red', reason: r.reject! }); }
  // duel3 即時劃刀：本步的輸入片段同樣在步開始狀態 s0 上判（鎖、切、撞鎖都看 s0），結果和直線刀一起套用
  const frees: FreeOut[] = [];
  for (const side of SIDES) {
    const pcs = input.free?.[side];
    if (!pcs || !pcs.length) continue;
    const out = freeStep(s0, side, s.stroke?.[side] ?? null, pcs, k);
    s.stroke = { ...(s.stroke ?? {}), [side]: out.stroke };
    frees.push(out);
  }
  // 套用：先鎖、後切（同步時切除以步開始狀態判，故已切的器官鎖不住）
  for (const r of strikes) { for (const i of r.locks) s.lockUntil[i] = k + LOCK_STEPS; s.cdUntil[r.side] = k + COOLDOWN_STEPS; }
  for (const f of frees) { for (const i of f.locks) s.lockUntil[i] = k + LOCK_STEPS; if (f.ended) s.cdUntil[f.side] = k + COOLDOWN_STEPS; }   // 冷卻從刀結束那一步起算
  const sever = (i: number, by: Side) => {
    s.alive[i] = false; s.lockUntil[i] = 0;
    s.severedQ[s.organs[i].side].push(s.organs[i].kind); s.severedN[by]++;
    if (s.severedP) s.severedP[s.organs[i].side].push([s.organs[i].p[0], s.organs[i].p[1]]);   // 原位（和 severedQ 同序）
  };
  // 這一步的切除：直線刀（穿刺時可連切）、即時刀結束時的一刀、即時刀穿刺的連切（都在這一步生效）
  const cutList: { i: number; by: Side }[] = [];
  for (const r of strikes) for (const i of r.pierced ?? (r.severed !== null ? [r.severed] : [])) cutList.push({ i, by: r.side });
  for (const f of frees) { for (const i of f.cuts) cutList.push({ i, by: f.side }); if (f.ended && f.ended.severed !== null) cutList.push({ i: f.ended.severed, by: f.side }); }
  for (const c of cutList) sever(c.i, c.by);
  // duel5 穿刺：帶穿刺的刀結束（不是點擊）或直線刀出手＝用掉；有效期過了而且沒有進行中的穿刺刀＝失效（仍算用過）
  for (const side of SIDES) {
    const pz = s.pierce?.[side];
    if (!pz) continue;
    const used = frees.some((f) => f.side === side && f.pierceUsed) || strikes.some((r) => r.side === side && r.pierced !== undefined);
    const expired = !used && k + 1 >= pz.until && !s.stroke?.[side]?.pierce;
    if (used || expired) { const rest: Partial<Record<Side, { until: number }>> = { ...s.pierce }; delete rest[side]; s.pierce = rest; ev.push({ t: 'pierceEnd', side, why: used ? 'used' : 'expired' }); }
  }
  // duel4 前線推進：同一步先算淨值，再夾到 ±max（撞鎖、鎖定、再生都不算）
  if (s.mode.front) {
    let net = 0;
    for (const c of cutList) net += c.by === 'blue' ? 1 : -1;
    if (net) { const m = s.mode.front.max, p = Math.max(-m, Math.min(m, (s.push ?? 0) + net)); if (p !== (s.push ?? 0)) { s.push = p; ev.push({ t: 'push', push: p, d: net }); } }
  }
  // duel4 教學場：玩家第一次鎖定或切除的那一步起永久解除，AI 第一刀不早於這一步＋60
  if (s.aiHold && (strikes.some((r) => r.side === 'blue' && (r.locks.length > 0 || r.severed !== null)) || frees.some((f) => f.side === 'blue' && (f.locks.length > 0 || f.cuts.length > 0 || (f.ended !== null && f.ended.severed !== null))))) {
    s.aiHold = false; s.aiNextFire = Math.max(s.aiNextFire, k + AI_FIRST_FIRE_STEP); ev.push({ t: 'aiRelease' });
  }
  for (const r of strikes) ev.push({ t: 'strike', r });
  for (const f of frees) ev.push(...f.events);
  // 擊倒：任一方器官（含萌芽中）全部被切除的那一步立即結束；同一步雙方清空＝平手
  if (s.mode.knockout) {
    const b0 = countSide(s, 'blue') === 0, r0 = countSide(s, 'red') === 0;
    if (b0 || r0) {
      s.phase = 'ko'; s.drag = { blue: null, red: null }; s.aim = null; s.result = duel(s);
      if (s.stroke) s.stroke = { blue: null, red: null };
      const winner: Side | 'draw' = b0 && r0 ? 'draw' : b0 ? 'red' : 'blue';
      s.end = { by: 'ko', winner }; s.step = k + 1;
      ev.push({ t: 'ko', winner, result: s.result });
      return { state: s, events: ev };
    }
  }
  // 再生：固定節拍（第 300、600…步＝5、10…秒），未滿 8 個就長回最早被切的種類，萌芽 0.5 秒
  if (s.mode.regen && k > 0 && k % REGEN_STEPS === 0) for (const side of SIDES) {
    const i = regrowOne(s, side, k);
    if (i !== null) ev.push({ t: 'spawn', i });
  }
  // duel5 AI 蛻生：龍、還沒用過、2×存活 ≤ 這場開局數，在 AI 這一刀生效的那一步執行（不動亂數與出刀排程；補述 1 第 9 條）
  if (red && s.mode.beasts?.red === 'dragon' && !s.skillUsed?.red && s.startN && 2 * countSide(s, 'red') <= s.startN.red) {
    const i = regrowOne(s, 'red', k);
    if (i !== null) { s.skillUsed = { blue: s.skillUsed?.blue ?? false, red: true }; ev.push({ t: 'skill', side: 'red', kind: 'molt', i }, { t: 'spawn', i }); }
  }
  if (red) {
    // 下一刀生效時刻＝這刀＋冷卻＋0～0.9 秒種子亂數
    const [u, n] = rand(s.rng); s.rng = n;
    s.aiNextFire = k + COOLDOWN_STEPS + Math.floor(u * ((s.mode.aiJitter ?? AI_JITTER_STEPS) + 1));
  }
  s.step = k + 1;
  // 預告開始：下一步起算 AIM_STEPS 步後生效；選刀看的是本步套用後的公開狀態
  if (!s.aim && !s.aiHold && s.aiNextFire - AIM_STEPS <= s.step) {
    const fireStep = Math.max(s.aiNextFire, s.step + AIM_STEPS);
    if (fireStep < endStep(s)) {
      const pick = aiChoose(s); s.rng = pick.rng;
      if (pick.line) { s.aim = { line: pick.line, aimStep: s.step, fireStep }; ev.push({ t: 'aim', aim: s.aim }); }
      else s.aiNextFire = s.step + 30; // 沒有合法刀時半秒後再看
    }
  }
  return { state: s, events: ev };
}

// ---------------------------------------------------------------- AI（首版；參數是完整遊戲狀態，只讀公開部分）
// 候選刀：起點＝己方存活器官中心＋固定 7 個錨點；角度每 15°（24 向）；長度 160／280／420。
// 打分：切除價值（爪 2、心 4）＋鎖住受威脅己方器官（交疊區 +1、其餘 +0.5；生效時仍會鎖著者不算）。
// 「最高分附近」＝分數 ≥ 最高分 − 2 的候選，以種子亂數均勻挑一條。
export const AI_ANCHORS: Record<Side, V[]> = {
  red: [[80, 450], [260, 450], [440, 450], [620, 450], [120, 545], [330, 545], [540, 545]],
  blue: [[80, 550], [260, 550], [440, 550], [620, 550], [120, 455], [330, 455], [540, 455]],
};
export const AI_ANGLES = 24, AI_LENGTHS = [160, 280, 420], AI_NEAR = 2;
/** 交疊帶與 AI 錨點：原版（沒給 body）＝固定的 y 430～570 與 AI_ANCHORS；給了 body（duel2）就由兩個多邊形算出（審查 HIGH-2：
 *  錨點若沿用舊四邊形座標，落在龍身外會被起刀規則拒絕，AI 候選刀變少、實力變弱）。同一份 body 只算一次。 */
const derived = new WeakMap<Record<Side, V[]>, { band: [number, number]; anchors: Record<Side, V[]> }>();
function derive(body: Record<Side, V[]>): { band: [number, number]; anchors: Record<Side, V[]> } {
  let d = derived.get(body); if (d) return d;
  const ys = (side: Side) => body[side].map((p) => p[1]);
  const band: [number, number] = [Math.min(...ys('blue')), Math.max(...ys('red'))];   // 藍在下、紅在上：藍的最高點～紅的最低點
  const anchors = {} as Record<Side, V[]>;
  for (const side of SIDES) {
    const pts: V[] = [];
    for (let y = Math.ceil(band[0] / 10) * 10; y <= band[1]; y += 10) for (let x = 0; x <= 700; x += 10) if (inside([x, y], body[side])) pts.push([x, y]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    anchors[side] = pts.length <= 7 ? pts : Array.from({ length: 7 }, (_, i) => pts[Math.round((i * (pts.length - 1)) / 6)]);
  }
  d = { band, anchors }; derived.set(body, d); return d;
}
export const bandOf = (mode: { body?: Record<Side, V[]> }): [number, number] => (mode.body ? derive(mode.body).band : [430, 570]);
export const anchorsOf = (mode: { body?: Record<Side, V[]> }, side: Side): V[] => (mode.body ? derive(mode.body).anchors[side] : AI_ANCHORS[side]);
// ---------------------------------------------------------------- duel3 即時劃刀（DUEL_V03_FEEL 一）
// 輸入：依所屬模擬步切好的片段（src/rtcut/freehand.ts 把「時間戳＋座標」序列切成片段；跨步的線段在步邊界依時間內插切開）。
// 每步在步開始狀態 s0 上判：起刀看 s0 的冷卻與獸身；鎖／切／撞鎖看 s0 的存活、萌芽、鎖定。
export const FREE_MIN_SPEED = 0.6;           // px/ms：低於這個速度是鈍刀（不鎖不切，長度照算）【試玩數值】
export type Piece = { k: 'down'; p: V } | { k: 'seg'; a: V; b: V; v: number } | { k: 'end'; why: 'up' | 'cancel' | 'multi' };
export type FreeEndWhy = 'up' | 'cancel' | 'multi' | 'length' | 'sever' | 'blocked' | 'tap';
export const TAP_LEN = 10;                  // 補述 1：放開時路徑總長 <10 且沒有鎖定／切除＝點擊，不算一刀、不進冷卻
export interface Stroke { start: V; len: number; seen: number[]; locks: number[]; startStep: number; pierce?: boolean; cuts?: number[] }   // pierce＝這一刀帶穿刺；cuts＝已連切的器官
export interface FreeOut {
  cuts: number[];                     // duel5 穿刺：這一步連切下的器官（當步生效）
  pierceUsed: boolean;                // duel5：帶穿刺的刀在這一步結束（不是點擊）＝穿刺用掉
  side: Side; stroke: Stroke | null; locks: number[]; events: GameEvent[];
  ended: { why: FreeEndWhy; severed: number | null; blocked: number | null } | null;
}
export function freeStep(s0: GameState, side: Side, stroke0: Stroke | null, pieces: Piece[], k: number): FreeOut {
  let st: Stroke | null = stroke0 && { ...stroke0, seen: [...stroke0.seen], locks: [...stroke0.locks] };
  const locks: number[] = [], events: GameEvent[] = [], cuts: number[] = [];
  let ended: FreeOut['ended'] = null, pierceUsed = false;
  const rr = radOf(s0.mode);
  const finish = (cur: Stroke, why: FreeEndWhy, end: V, dir: V, severed: number | null = null, blocked: number | null = null) => {
    ended = { why, severed, blocked };
    if (cur.pierce) pierceUsed = true;
    events.push({ t: 'freeEnd', side, why, locks: cur.locks, severed, blocked, end, dir, len: cur.len });
    st = null;
  };
  for (const pc of pieces) {
    if (pc.k === 'down') {
      if (st) continue;   // 進行中的刀不會再按下（第二指另以 multi 結束）
      const reason: Reject | null = s0.phase !== 'cut' || k >= endStep(s0) ? 'phase'
        : ended || s0.cdUntil[side] > k ? 'cooldown'          // 同一步內剛結束的刀也算冷卻中
        : !startOk(s0, side, pc.p) ? 'start' : null;
      if (reason) { events.push({ t: 'freeReject', side, reason }); continue; }
      st = { start: pc.p, len: 0, seen: [], locks: [], startStep: k };
      const pz = s0.pierce?.[side];
      if (pz && k < pz.until) { st.pierce = true; st.cuts = []; }   // 穿刺有效期內按下的刀帶穿刺
      events.push({ t: 'freeStart', side, p: pc.p });
      continue;
    }
    const cur: Stroke | null = st;
    if (!cur) continue;
    if (pc.k === 'end') {
      if (cur.len < TAP_LEN && cur.locks.length === 0 && !cur.cuts?.length) { events.push({ t: 'freeEnd', side, why: 'tap', locks: [], severed: null, blocked: null, end: cur.start, dir: [0, 0], len: cur.len }); st = null; continue; }   // 點擊：不進冷卻（ended 不設）
      finish(cur, pc.why, cur.start, [0, 0]); continue;
    }
    // 線段：先依剩餘長度截斷
    const a = pc.a;
    const L0 = Math.hypot(pc.b[0] - a[0], pc.b[1] - a[1]);
    if (L0 === 0) continue;
    const dir: V = [(pc.b[0] - a[0]) / L0, (pc.b[1] - a[1]) / L0];
    const rem = MAX_LEN - cur.len, cut = L0 >= rem;
    const L = cut ? rem : L0;
    const b: V = cut ? [a[0] + dir[0] * L, a[1] + dir[1] * L] : pc.b;
    if (pc.v >= FREE_MIN_SPEED) {
      const hits: { i: number; t: number }[] = [];
      s0.organs.forEach((o, i) => { if (!isReady(s0, i) || cur.seen.includes(i)) return; const t = entryDist(a, b, o.p, rr); if (t !== null) hits.push({ i, t }); });
      hits.sort((x, y) => x.t - y.t || x.i - y.i);
      let stop = false;
      for (const h of hits) {
        cur.seen.push(h.i);
        if (s0.organs[h.i].side === side) { cur.locks.push(h.i); locks.push(h.i); events.push({ t: 'freeLock', side, i: h.i }); continue; }
        const at: V = [a[0] + dir[0] * h.t, a[1] + dir[1] * h.t];
        if (cur.pierce && !isLocked(s0, h.i)) {
          // 穿刺：切下、當步生效，刀繼續；切到第 PIERCE_MAX 個就停（補述 1 第 8 條）
          cur.cuts = [...(cur.cuts ?? []), h.i]; cuts.push(h.i); events.push({ t: 'freeCut', side, i: h.i });
          if (cur.cuts.length >= PIERCE_MAX) { cur.len += h.t; finish(cur, 'sever', at, dir, null, null); stop = true; break; }
          continue;
        }
        cur.len += h.t;
        if (isLocked(s0, h.i)) finish(cur, 'blocked', at, dir, null, h.i); else finish(cur, 'sever', at, dir, h.i, null);
        stop = true; break;
      }
      if (stop) continue;
    }
    cur.len += L;
    if (cut) finish(cur, 'length', b, dir);
  }
  return { side, stroke: st, locks, events, ended, cuts, pierceUsed };
}

/** duel4：延伸區的 AI 錨點（10 單位網格上的延伸區點，依 x、y 排序均勻取 7 個；同一個起刀區函式）。沒有延伸＝空。 */
const extCache = new Map<string, V[]>();
export function extAnchors(mode: Mode, push: number, side: Side): V[] {
  const d = extOf(mode, push, side);
  if (d <= 0) return [];
  const key = `${side}:${d}:${bodyOf(mode, 'blue').length}:${bodyOf(mode, 'red').length}:${bodyOf(mode, side)[0].join(',')}`;
  let a = extCache.get(key);
  if (!a) {
    const own = bodyOf(mode, side), pts: V[] = [];
    for (let y = 0; y <= 1000; y += 10) for (let x = 0; x <= 700; x += 10) if (!inside([x, y], own) && inStartZone(mode, push, side, [x, y])) pts.push([x, y]);
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    a = pts.length <= 7 ? pts : Array.from({ length: 7 }, (_, i) => pts[Math.round((i * (pts.length - 1)) / 6)]);
    extCache.set(key, a);
  }
  return a;
}
export function candidates(s: GameState, side: Side): Line[] {
  const starts: V[] = [];
  s.organs.forEach((o, i) => { if (o.side === side && isReady(s, i)) starts.push(o.p); });
  starts.push(...anchorsOf(s.mode, side), ...extAnchors(s.mode, s.push ?? 0, side));
  const out: Line[] = [];
  for (const a of starts) for (let k = 0; k < AI_ANGLES; k++) {
    const th = (k * 2 * Math.PI) / AI_ANGLES;
    for (const len of AI_LENGTHS) out.push({ a, b: [Math.round((a[0] + Math.cos(th) * len) * 100) / 100, Math.round((a[1] + Math.sin(th) * len) * 100) / 100] });
  }
  return out;
}
export function aiScore(s: GameState, side: Side, r: StrikeResult): number {
  let v = r.severed !== null ? VALUE[s.organs[r.severed].kind] : 0;
  const [b0, b1] = bandOf(s.mode);
  for (const i of r.locks) if (s.lockUntil[i] <= s.step + AIM_STEPS) v += s.organs[i].p[1] >= b0 && s.organs[i].p[1] <= b1 ? 1 : 0.5;
  return v;
}
export function aiChoose(state: GameState, side: Side = 'red'): { line: Line | null; rng: number } {
  const view = publicView(state);
  // 判定用「預告當下」的狀態，但把冷卻視為已好（生效時才出刀）
  const probe: GameState = { ...view, cdUntil: { ...view.cdUntil, [side]: 0 } };
  let best = -Infinity; const scored: { l: Line; v: number }[] = [];
  for (const l of candidates(probe, side)) {
    const r = resolveStrike(probe, side, l);
    if (!r.ok) continue;
    const v = aiScore(probe, side, r);
    scored.push({ l, v }); if (v > best) best = v;
  }
  // rt-cut2：只出有目標的刀（切除或保護得分 >0）；沒有就不出刀（R2-05，不做無目標的空揮）
  const usable = state.mode.knockout || state.mode.regen ? scored.filter((c) => c.v > 0) : scored;
  if (!usable.length) return { line: null, rng: state.rng };
  if (usable !== scored) best = Math.max(...usable.map((c) => c.v));
  const pool = usable.filter((c) => c.v >= best - AI_NEAR);
  const [u, n] = rand(state.rng);
  return { line: pool[Math.min(pool.length - 1, Math.floor(u * pool.length))].l, rng: n };
}
/** AI 只看得到的部分：盤面、鎖定、冷卻、步數。拖曳中的線一律清空。 */
export function publicView(s: GameState): GameState {
  return { ...s, drag: { blue: null, red: null }, aim: null };
}

// ---------------------------------------------------------------- 對決
export const power = (claws: number, hearts: number) => 2 * claws * (1 + hearts);
export function duel(s: GameState): DuelResult {
  const claws = { blue: 0, red: 0 }, hearts = { blue: 0, red: 0 };
  s.organs.forEach((o, i) => { if (s.alive[i] && o.kind === 'claw') claws[o.side]++; else if (s.alive[i] && o.kind === 'heart') hearts[o.side]++; });
  const pw = { blue: power(claws.blue, hearts.blue), red: power(claws.red, hearts.red) };
  return { claws, hearts, power: pw, winner: pw.blue > pw.red ? 'blue' : pw.red > pw.blue ? 'red' : 'draw' };
}

// ---------------------------------------------------------------- 模擬器（固定種子＋玩家出刀時間表 → 整局）
export interface ScheduledStrike { step: number; line: Line }
export interface DragFrame { from: number; to: number; line: Line | null }
export interface MatchLog { strikes: { step: number; side: Side; line: Line; locks: number[]; severed: number | null; blocked: number | null }[]; aims: Aim[]; rejects: { step: number; side: Side; reason: Reject }[]; result: DuelResult; spawns?: { step: number; i: number; id: string; p: V }[]; end?: GameState['end']; endStep?: number }
export function runMatch(seed: number, schedule: ScheduledStrike[], drags: DragFrame[] = [], mode: Mode = MODE_RT1): MatchLog {
  let s = newGame(seed, mode);
  const log: MatchLog = { strikes: [], aims: [], rejects: [], result: null as unknown as DuelResult };
  const at = new Map<number, Line>(); for (const x of schedule) at.set(x.step, x.line);
  while (s.phase === 'cut') {
    const k = s.step, d = drags.find((f) => k >= f.from && k < f.to);
    const out = step(s, { blue: at.get(k) ?? null, drag: d ? d.line : null });
    for (const e of out.events) {
      if (e.t === 'strike') log.strikes.push({ step: k, side: e.r.side, line: e.r.line, locks: e.r.locks, severed: e.r.severed, blocked: e.r.blocked });
      else if (e.t === 'aim') log.aims.push(e.aim);
      else if (e.t === 'reject') log.rejects.push({ step: k, side: e.side, reason: e.reason });
      else if (e.t === 'spawn') (log.spawns ??= []).push({ step: k, i: e.i, id: out.state.organs[e.i].id, p: out.state.organs[e.i].p });
    }
    s = out.state;
  }
  log.result = s.result!;
  if (mode.knockout || mode.regen) { log.end = s.end; log.endStep = s.step; }
  return log;
}
/** 隨機玩家腳本（只供 30 種子統計）：每次冷卻好後再等 0～1 秒，從藍方候選刀中均勻亂挑一條。玩家時間表與 AI 無關，先由獨立亂數決定出刀時刻，刀線在出刀時依當下盤面挑。 */
export function runRandomPlayer(seed: number, mode: Mode = MODE_RT1): MatchLog {
  let s = newGame(seed, mode), pr = (seed ^ 0xa5a5a5a5) >>> 0 || 1;
  const log: MatchLog = { strikes: [], aims: [], rejects: [], result: null as unknown as DuelResult };
  let next = 30;
  while (s.phase === 'cut') {
    const k = s.step;
    let blue: Line | null = null;
    if (k === next) {
      const c = candidates(s, 'blue'); let u: number; [u, pr] = rand(pr); blue = c[Math.floor(u * c.length)];
      [u, pr] = rand(pr); next = k + COOLDOWN_STEPS + Math.floor(u * 61);
    }
    const out = step(s, { blue });
    for (const e of out.events) {
      if (e.t === 'strike') log.strikes.push({ step: k, side: e.r.side, line: e.r.line, locks: e.r.locks, severed: e.r.severed, blocked: e.r.blocked });
      else if (e.t === 'aim') log.aims.push(e.aim);
      else if (e.t === 'reject') log.rejects.push({ step: k, side: e.side, reason: e.reason });
      else if (e.t === 'spawn') (log.spawns ??= []).push({ step: k, i: e.i, id: out.state.organs[e.i].id, p: out.state.organs[e.i].p });
    }
    s = out.state;
  }
  log.result = s.result!;
  if (mode.knockout || mode.regen) { log.end = s.end; log.endStep = s.step; }
  return log;
}
