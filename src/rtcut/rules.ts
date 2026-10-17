// 「即時亂切」研究片段（子路徑 rt-cut/）的全部規則：盤面常數、單刀判定、固定步長模擬、AI、對決戰力。純函式，不碰 DOM。
// 規格：the-cut docs/rt-cut/ACCEPTANCE_FROZEN.md（RT-01～09＋補述 1）。可丟棄原型，非正式規則。
// 切割→戰鬥（duel/，the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md）以 Mode 的選填欄位沿用本檔：局長、器官組成、再生上限、生成位置規則、AI 亂數上限。
// 選填欄位不給時（MODE_RT1／MODE_RT2）行為與 rt-cut／rt-cut2 完全相同。
export type V = [number, number];
export type Side = 'blue' | 'red';
export type Kind = 'claw' | 'heart' | 'eye' | 'poison' | 'bone';   // 眼／毒／骨只出現在切割→戰鬥；切割期它們只是普通器官
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
export const VALUE: Record<Kind, number> = { claw: 2, heart: 4, eye: 3, poison: 3, bone: 2 };   // 眼／毒／骨的 AI 切除價值是切割→戰鬥的試玩值
// rt-cut2（擊倒＋再生）：以模式參數開關；預設 MODE_RT1＝原版行為不變（R2-04）
export interface Mode {
  knockout: boolean; regen: boolean;
  // ---- 切割→戰鬥（CB）專用，選填 ----
  cutSteps?: number;                         // 局長（步）；不給＝END_STEP（40 秒）
  maxPerSide?: Record<Side, number>;         // 再生上限；不給＝MAX_PER_SIDE（8）
  spawnRule?: 'cb';                          // 'cb'＝再生位置另須整個圓在獸身內、對方刀碰得到（DUEL_BLADE_V01 補述 1）
  aiJitter?: number;                         // AI 出刀間隔＝冷卻＋0～aiJitter 步；不給＝AI_JITTER_STEPS
}
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
/** 圓心在獸身內，且到每條邊 ≥ 半徑＋1（整個圓在獸身內，不壓邊）。 */
export function circleInside(p: V, side: Side, r = R): boolean {
  const poly = BODY[side];
  if (!inside(p, poly)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segPointDist(p, poly[j], poly[i]) < r + 1) return false;
  return true;
}
/** 攻擊方獸身內存在一個起點，長度 ≤ MAX_LEN 的刀碰得到這個圓（圓心到攻擊方獸身距離 ≤ MAX_LEN＋R−1）。 */
export function reachableBy(p: V, attacker: Side, r = R): boolean {
  const poly = BODY[attacker];
  if (inside(p, poly)) return true;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segPointDist(p, poly[j], poly[i]));
  return d <= MAX_LEN + r - 1;
}
export const validSpot = (p: V, side: Side) => circleInside(p, side) && reachableBy(p, other(side));

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
  return { ...s, alive: [...s.alive], lockUntil: [...s.lockUntil], cdUntil: { ...s.cdUntil }, drag: { ...s.drag }, aim: s.aim && { ...s.aim }, result: s.result,
    organs: s.organs, readyAt: [...s.readyAt], severedQ: { blue: [...s.severedQ.blue], red: [...s.severedQ.red] }, severedN: { ...s.severedN } };
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
}
export function resolveStrike(s: GameState, side: Side, raw: Line): StrikeResult {
  const base = { side, line: raw, locks: [] as number[], severed: null, blocked: null, end: raw.b };
  if (s.phase !== 'cut' || s.step >= endStep(s)) return { ...base, ok: false, reject: 'phase' };
  if (Math.hypot(raw.b[0] - raw.a[0], raw.b[1] - raw.a[1]) < MIN_LEN) return { ...base, ok: false, reject: 'short' };
  if (s.cdUntil[side] > s.step) return { ...base, ok: false, reject: 'cooldown' };
  if (!inside(raw.a, BODY[side])) return { ...base, ok: false, reject: 'start' };
  const line = clampLine(raw);
  const hits: { i: number; t: number }[] = [];
  s.organs.forEach((o, i) => { if (!isReady(s, i)) return; const t = entryDist(line.a, line.b, o.p); if (t !== null) hits.push({ i, t }); });
  hits.sort((x, y) => x.t - y.t || x.i - y.i);
  const locks: number[] = [];
  const L = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  const at = (t: number): V => [line.a[0] + ((line.b[0] - line.a[0]) * t) / L, line.a[1] + ((line.b[1] - line.a[1]) * t) / L];
  for (const h of hits) {
    if (s.organs[h.i].side === side) { locks.push(h.i); continue; }
    if (isLocked(s, h.i)) return { ok: true, side, line, locks, severed: null, blocked: h.i, end: at(h.t) };
    return { ok: true, side, line, locks, severed: h.i, blocked: null, end: at(h.t) };
  }
  return { ok: true, side, line, locks, severed: null, blocked: null, end: line.b };
}

// ---------------------------------------------------------------- 一步（雙方同步：都在步開始狀態上判，再一起套用）
export type GameEvent =
  | { t: 'strike'; r: StrikeResult }
  | { t: 'reject'; side: Side; reason: Reject }
  | { t: 'aim'; aim: Aim }
  | { t: 'duel'; result: DuelResult }
  | { t: 'ko'; winner: Side | 'draw'; result: DuelResult }
  | { t: 'spawn'; i: number };
export interface StepInput { blue?: Line | null; drag?: Line | null }
export interface StepOut { state: GameState; events: GameEvent[] }

/** 再生位置：獸身多邊形內、與所有現存器官（含萌芽中、含對方）中心距 ≥2R；用再生亂數流取樣，最多 400 次。改寫 s.regenRng。 */
function spawnPoint(s: GameState, side: Side): V | null {
  const xs = BODY[side].map((p) => p[0]), ys = BODY[side].map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let tries = 0; tries < 400; tries++) {
    let u: number, v: number;
    [u, s.regenRng] = rand(s.regenRng); [v, s.regenRng] = rand(s.regenRng);
    const p: V = [Math.round(x0 + u * (x1 - x0)), Math.round(y0 + v * (y1 - y0))];
    if (!inside(p, BODY[side])) continue;
    if (s.mode.spawnRule === 'cb' && !validSpot(p, side)) continue;
    if (s.organs.some((o, i) => s.alive[i] && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 2 * R)) continue;
    return p;
  }
  return null;
}
export const KIND_ZH: Record<Kind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨' };
export function step(s0: GameState, input: StepInput = {}): StepOut {
  const ev: GameEvent[] = [];
  if (s0.phase !== 'cut') return { state: s0, events: ev };
  const s = clone(s0);
  const k = s.step;
  if (k >= endStep(s)) {
    // 剛好達局長（原版 40 秒）：凍結盤面、拖曳作廢、預告作廢、進入對決
    s.phase = 'duel'; s.drag = { blue: null, red: null }; s.aim = null; s.result = duel(s); s.end = { by: 'time', winner: s.result.winner };
    if (input.blue) ev.push({ t: 'reject', side: 'blue', reason: 'phase' });
    ev.push({ t: 'duel', result: s.result });
    return { state: s, events: ev };
  }
  s.drag.blue = input.drag ?? null;
  // AI：到了預告時刻就用「目前狀態」選刀並固定刀線
  let red: Line | null = null;
  if (s.aim && s.aim.fireStep === k) { red = s.aim.line; s.aim = null; }
  // 雙方都在步開始狀態 s0 上判（拖曳線只寫進 s，不影響判定）
  const strikes: StrikeResult[] = [];
  if (input.blue) { const r = resolveStrike(s0, 'blue', input.blue); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'blue', reason: r.reject! }); }
  if (red) { const r = resolveStrike(s0, 'red', red); if (r.ok) strikes.push(r); else ev.push({ t: 'reject', side: 'red', reason: r.reject! }); }
  // 套用：先鎖、後切（同步時切除以步開始狀態判，故已切的器官鎖不住）
  for (const r of strikes) { for (const i of r.locks) s.lockUntil[i] = k + LOCK_STEPS; s.cdUntil[r.side] = k + COOLDOWN_STEPS; }
  for (const r of strikes) if (r.severed !== null) {
    s.alive[r.severed] = false; s.lockUntil[r.severed] = 0;
    s.severedQ[s.organs[r.severed].side].push(s.organs[r.severed].kind); s.severedN[r.side]++;
  }
  for (const r of strikes) ev.push({ t: 'strike', r });
  // 擊倒：任一方器官（含萌芽中）全部被切除的那一步立即結束；同一步雙方清空＝平手
  if (s.mode.knockout) {
    const b0 = countSide(s, 'blue') === 0, r0 = countSide(s, 'red') === 0;
    if (b0 || r0) {
      s.phase = 'ko'; s.drag = { blue: null, red: null }; s.aim = null; s.result = duel(s);
      const winner: Side | 'draw' = b0 && r0 ? 'draw' : b0 ? 'red' : 'blue';
      s.end = { by: 'ko', winner }; s.step = k + 1;
      ev.push({ t: 'ko', winner, result: s.result });
      return { state: s, events: ev };
    }
  }
  // 再生：固定節拍（第 300、600…步＝5、10…秒），未滿 8 個就長回最早被切的種類，萌芽 0.5 秒
  if (s.mode.regen && k > 0 && k % REGEN_STEPS === 0) for (const side of SIDES) {
    if (countSide(s, side) >= (s.mode.maxPerSide?.[side] ?? MAX_PER_SIDE) || !s.severedQ[side].length) continue;
    const p = spawnPoint(s, side);
    if (!p) continue;
    const kind = s.severedQ[side].shift()!;
    const n = s.organs.filter((o) => o.side === side && o.kind === kind).length + 1;
    s.organs = [...s.organs, { id: `${side === 'blue' ? '藍' : '紅'}${KIND_ZH[kind]}${n}`, side, kind, p }];
    s.alive.push(true); s.lockUntil.push(0); s.readyAt.push(k + SPROUT_STEPS);
    ev.push({ t: 'spawn', i: s.organs.length - 1 });
  }
  if (red) {
    // 下一刀生效時刻＝這刀＋冷卻＋0～0.9 秒種子亂數
    const [u, n] = rand(s.rng); s.rng = n;
    s.aiNextFire = k + COOLDOWN_STEPS + Math.floor(u * ((s.mode.aiJitter ?? AI_JITTER_STEPS) + 1));
  }
  s.step = k + 1;
  // 預告開始：下一步起算 AIM_STEPS 步後生效；選刀看的是本步套用後的公開狀態
  if (!s.aim && s.aiNextFire - AIM_STEPS <= s.step) {
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
export function candidates(s: GameState, side: Side): Line[] {
  const starts: V[] = [];
  s.organs.forEach((o, i) => { if (o.side === side && isReady(s, i)) starts.push(o.p); });
  starts.push(...AI_ANCHORS[side]);
  const out: Line[] = [];
  for (const a of starts) for (let k = 0; k < AI_ANGLES; k++) {
    const th = (k * 2 * Math.PI) / AI_ANGLES;
    for (const len of AI_LENGTHS) out.push({ a, b: [Math.round((a[0] + Math.cos(th) * len) * 100) / 100, Math.round((a[1] + Math.sin(th) * len) * 100) / 100] });
  }
  return out;
}
export function aiScore(s: GameState, side: Side, r: StrikeResult): number {
  let v = r.severed !== null ? VALUE[s.organs[r.severed].kind] : 0;
  for (const i of r.locks) if (s.lockUntil[i] <= s.step + AIM_STEPS) v += s.organs[i].p[1] >= 430 && s.organs[i].p[1] <= 570 ? 1 : 0.5;
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
