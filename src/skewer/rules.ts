// 串刺（core-skewer）規則核心：純函式、整數幾何、完全決定性（無亂數、無時間）。研究片段，不是正式規格。
// 規則來源：CORE_REDESIGN_CHOICE_BRIEF.md §P2.1；設計決定見 SKEWER_NOTES.md。
// 重用 engine/src/geom.ts 的 cross／len2（安全整數檢查）；不修改 engine/。
import { cross, len2 } from '../../engine/src/geom.ts';
import type { Pt } from '../../engine/src/geom.ts';

export type { Pt };
export type OrganKind = 'claw' | 'heart';

export interface OrganDef {
  id: string;
  kind: OrganKind;
  name: string;
  /** 刀中值（傷害公式的加總項）。 */
  value: number;
  /** 回合末攻擊力（只有爪 > 0）。 */
  attack: number;
  /** 判定半徑（棋盤單位）。 */
  r: number;
  /** 節律軌道：格點序列；每回合前進一格。 */
  track: Pt[];
  mode: 'loop' | 'pingpong';
  /** 第 1 回合所在的步數（0 起算）。 */
  start: number;
}
export interface SacDef { id: string; name: string; pos: Pt; r: number; dmg: number }
/** 骨板：線段 a–b 加上半厚度 t 的膠囊形。 */
export interface PlateDef { id: string; name: string; a: Pt; b: Pt; t: number }
export interface BoardDef {
  id: string;
  name: string;
  note: string;
  /** 身體輪廓（凸多邊形，y 軸向下的畫面座標）。 */
  body: Pt[];
  organs: OrganDef[];
  sacs: SacDef[];
  plates: PlateDef[];
  hpE: number;
  hpP: number;
  turnLimit: number;
}

/** 一刀＝兩個端點決定的直線（無限延伸，貫穿全身）。 */
export type Line = readonly [number, number, number, number];

export interface LineEval {
  legal: boolean;
  reason: string | null;
  /** 穿到的器官 id（依線的方向由端點 1 往端點 2 排序）。 */
  hits: string[];
  /** 碰到的毒囊 id。 */
  sacs: string[];
}

export interface TurnRecord {
  turn: number;
  line: number[];
  hits: string[];
  sacs: string[];
  valueSum: number;
  mult: number;
  damage: number;
  poisonDmg: number;
  clawDmg: number;
  removed: string[];
  hpEBefore: number;
  hpEAfter: number;
  hpPBefore: number;
  hpPAfter: number;
}

export type Result = null | 'win' | 'lose';
export type LoseReason = null | 'hp' | 'turns';

export interface GameState {
  boardId: string;
  turn: number;
  hpE: number;
  hpP: number;
  removed: string[];
  result: Result;
  loseReason: LoseReason;
  history: TurnRecord[];
}

/** 拖曳端點的合法範圍（棋盤單位）；超出就夾回，確保所有乘積都是安全整數。 */
export const COORD_LO = -400;
export const COORD_HI = 1400;
/** 兩端點最短距離（棋盤單位）；太短的線方向不穩定，判為非法。 */
export const MIN_LEN = 30;

export const REASON = {
  short: '線太短',
  miss: '線沒有穿過身體',
  plate: '骨板擋住，畫不出這條線',
} as const;

// ---------------------------------------------------------------- 節律

/** 第 turn 回合（1 起算）時，軌道上的格點索引。 */
export function trackIndex(o: OrganDef, turn: number): number {
  const n = o.track.length;
  if (n <= 1) return 0;
  const step = o.start + (turn - 1);
  if (o.mode === 'loop') return step % n;
  const period = 2 * (n - 1);
  const k = step % period;
  return k < n ? k : period - k;
}
export function organPos(o: OrganDef, turn: number): Pt { return o.track[trackIndex(o, turn)]; }

export function newGame(board: BoardDef): GameState {
  return { boardId: board.id, turn: 1, hpE: board.hpE, hpP: board.hpP, removed: [], result: null, loseReason: null, history: [] };
}
export function liveOrgans(board: BoardDef, s: GameState): OrganDef[] { return board.organs.filter((o) => !s.removed.includes(o.id)); }

// ---------------------------------------------------------------- 幾何判定

export function clampPt(x: number, y: number): Pt {
  const c = (v: number) => Math.min(COORD_HI, Math.max(COORD_LO, Math.round(v)));
  return [c(x), c(y)];
}
export function clampLine(l: readonly number[]): Line {
  const a = clampPt(l[0], l[1]), b = clampPt(l[2], l[3]);
  return [a[0], a[1], b[0], b[1]];
}

/** 圓心 c、半徑 r 的圓是否碰到（含相切）通過 a、b 的無限直線。整數判定：cross² ≤ r²·|ab|²。 */
export function lineTouchesCircle(a: Pt, b: Pt, c: Pt, r: number): boolean {
  const k = cross(a, b, c);
  return k * k <= r * r * len2(a, b);
}

/** 直線是否碰到骨板（線段＋半厚度 t 的膠囊）。 */
export function lineTouchesPlate(a: Pt, b: Pt, p: PlateDef): boolean {
  const c1 = cross(a, b, p.a), c2 = cross(a, b, p.b);
  if (c1 === 0 || c2 === 0 || (c1 < 0) !== (c2 < 0)) return true;
  const m = Math.min(Math.abs(c1), Math.abs(c2));
  return m * m <= p.t * p.t * len2(a, b);
}

/** 直線是否穿過身體內部（凸多邊形頂點分居兩側）。 */
export function lineCrossesBody(a: Pt, b: Pt, body: readonly Pt[]): boolean {
  let pos = false, neg = false;
  for (const v of body) { const k = cross(a, b, v); if (k > 0) pos = true; else if (k < 0) neg = true; }
  return pos && neg;
}

/** 評估一條線（預覽與結算共用）：合法性、穿到的器官、碰到的毒囊。不計算傷害。 */
export function evalLine(board: BoardDef, s: GameState, line: Line): LineEval {
  const a: Pt = [line[0], line[1]], b: Pt = [line[2], line[3]];
  if (len2(a, b) < MIN_LEN * MIN_LEN) return { legal: false, reason: REASON.short, hits: [], sacs: [] };
  if (!lineCrossesBody(a, b, board.body)) return { legal: false, reason: REASON.miss, hits: [], sacs: [] };
  if (board.plates.some((p) => lineTouchesPlate(a, b, p))) return { legal: false, reason: REASON.plate, hits: [], sacs: [] };
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const along = (p: Pt) => (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
  const hit = liveOrgans(board, s).filter((o) => lineTouchesCircle(a, b, organPos(o, s.turn), o.r));
  hit.sort((p, q) => along(organPos(p, s.turn)) - along(organPos(q, s.turn)) || (p.id < q.id ? -1 : 1));
  const sacs = board.sacs.filter((x) => lineTouchesCircle(a, b, x.pos, x.r)).map((x) => x.id);
  return { legal: true, reason: null, hits: hit.map((o) => o.id), sacs };
}

// ---------------------------------------------------------------- 結算

/** 傷害＝線上器官值總和 × 串數。 */
export function cutDamage(values: readonly number[]): { sum: number; mult: number; damage: number } {
  const sum = values.reduce((x, y) => x + y, 0);
  const mult = values.length;
  return { sum, mult, damage: sum * mult };
}

/** 被穿到時是否摘除：爪摘除；心肉只受傷、不摘除。 */
export function removedOnHit(o: OrganDef): boolean { return o.kind === 'claw'; }

/**
 * 結算一刀（確認後才呼叫；預覽不呼叫）。順序：刀中傷害與毒囊同時生效 → 怪物 HP ≤ 0 即勝（優先）→ 玩家 HP ≤ 0 即輸
 * → 剩下的爪攻擊 → 玩家 HP ≤ 0 即輸 → 回合上限用完即輸 → 進入下一回合（器官前進一格）。
 */
export function resolveTurn(board: BoardDef, s: GameState, line: Line): { state: GameState; rec: TurnRecord } {
  if (s.result) throw new Error('對局已結束');
  const ev = evalLine(board, s, line);
  if (!ev.legal) throw new Error(`非法線：${ev.reason}`);
  const byId = (id: string) => board.organs.find((o) => o.id === id)!;
  const hitOrgans = ev.hits.map(byId);
  const { sum, mult, damage } = cutDamage(hitOrgans.map((o) => o.value));
  const poisonDmg = ev.sacs.reduce((t, id) => t + board.sacs.find((x) => x.id === id)!.dmg, 0);
  const removedNow = hitOrgans.filter(removedOnHit).map((o) => o.id);
  const removed = [...s.removed, ...removedNow];
  const hpEAfter = s.hpE - damage;
  let hpP = s.hpP - poisonDmg;
  let result: Result = null, loseReason: LoseReason = null, clawDmg = 0;
  if (hpEAfter <= 0) result = 'win';
  else if (hpP <= 0) { result = 'lose'; loseReason = 'hp'; }
  else {
    clawDmg = board.organs.filter((o) => o.kind === 'claw' && !removed.includes(o.id)).reduce((t, o) => t + o.attack, 0);
    hpP -= clawDmg;
    if (hpP <= 0) { result = 'lose'; loseReason = 'hp'; }
    else if (s.turn >= board.turnLimit) { result = 'lose'; loseReason = 'turns'; }
  }
  const rec: TurnRecord = {
    turn: s.turn, line: [...line], hits: ev.hits, sacs: ev.sacs, valueSum: sum, mult, damage, poisonDmg, clawDmg, removed: removedNow,
    hpEBefore: s.hpE, hpEAfter, hpPBefore: s.hpP, hpPAfter: hpP,
  };
  const state: GameState = {
    boardId: s.boardId, turn: result ? s.turn : s.turn + 1, hpE: hpEAfter, hpP, removed, result, loseReason, history: [...s.history, rec],
  };
  return { state, rec };
}

/** 依序結算一串線（測試與重算用）。 */
export function playLines(board: BoardDef, lines: readonly Line[]): GameState {
  let s = newGame(board);
  for (const l of lines) s = resolveTurn(board, s, l).state;
  return s;
}

// ---------------------------------------------------------------- 點選模式候選線

export interface Candidate { line: Line; ev: LineEval; key: string }

const DIRS: Pt[] = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [1, -2], [3, 1], [1, 3], [3, -1], [1, -3]];
const comboKey = (ev: LineEval) => `${[...ev.hits].sort().join('+')}|${ev.sacs.length ? 'poison' : ''}`;

/** 本回合所有「不同穿刺組合」的代表線（決定性順序）。依序嘗試：兩器官圓心連線、單器官多角度、空切掃描。 */
export function lineCombos(board: BoardDef, s: GameState): Candidate[] {
  const live = liveOrgans(board, s);
  const pts = live.map((o) => organPos(o, s.turn));
  const tries: Line[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) tries.push([pts[i][0], pts[i][1], pts[j][0], pts[j][1]]);
  for (const p of pts) for (const d of DIRS) tries.push([p[0] - d[0] * 100, p[1] - d[1] * 100, p[0] + d[0] * 100, p[1] + d[1] * 100]);
  const xs = board.body.map((v) => v[0]), ys = board.body.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let y = y0 + 20; y < y1; y += 20) tries.push([x0, y, x1, y]);
  for (let x = x0 + 20; x < x1; x += 20) tries.push([x, y0, x, y1]);
  const seen = new Map<string, Candidate>();
  for (const t of tries) {
    const line = clampLine(t);
    const ev = evalLine(board, s, line);
    if (!ev.legal) continue;
    const key = comboKey(ev);
    if (!seen.has(key)) seen.set(key, { line, ev, key });
  }
  return [...seen.values()];
}

/**
 * 點選模式的 3～5 條候選線：①串數最多（不碰毒囊優先）②空切 ③只切心肉 ④其餘依串數多到少補滿。
 * 只依穿刺組合挑選，不依傷害排序；顯示順序依線的角度（不透露優劣）。
 */
export function pickCandidates(board: BoardDef, s: GameState, max = 5): Candidate[] {
  const all = lineCombos(board, s);
  const rank = [...all].sort((p, q) => q.ev.hits.length - p.ev.hits.length || p.ev.sacs.length - q.ev.sacs.length || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  const out: Candidate[] = [];
  const add = (c: Candidate | undefined) => { if (c && !out.includes(c) && out.length < max) out.push(c); };
  add(rank.find((c) => c.ev.hits.length > 0));
  add(rank.find((c) => c.ev.hits.length === 0 && c.ev.sacs.length === 0) ?? rank.find((c) => c.ev.hits.length === 0));
  const kindOf = (id: string) => board.organs.find((o) => o.id === id)!.kind;
  add(rank.find((c) => c.ev.hits.length === 1 && kindOf(c.ev.hits[0]) === 'heart' && c.ev.sacs.length === 0));
  for (const c of rank) add(c);
  // 依方向角排序（整數：方向正規化到上半平面後以叉積比較，避免各瀏覽器浮點差異）
  const dir = (c: Candidate): Pt => { const dx = c.line[2] - c.line[0], dy = c.line[3] - c.line[1]; return dy < 0 || (dy === 0 && dx < 0) ? [-dx, -dy] : [dx, dy]; };
  return out.sort((p, q) => { const k = cross([0, 0], dir(q), dir(p)); return k !== 0 ? k : p.key < q.key ? -1 : 1; });
}
