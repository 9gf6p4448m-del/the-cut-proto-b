// FUN-EXP-01 實驗掛鉤（研究候選，非正式規則）：模式設定、實驗 A 執念選邊、實驗 B 傷口。
// 規格：the-cut docs/fun-exp-01/EXPERIMENT_A_RULES.md、EXPERIMENT_B_RULES.md（v1）。
// 原則：BASELINE（未設定 exp 或 mode='BASELINE'）時，本檔所有掛鉤都不改變設定雜湊、狀態形狀與事件序列（凍結驗收 X-1）。
// 本檔只依賴型別，不依賴引擎的執行期程式（避免循環匯入）；InvalidAction 由 engine.ts 依本檔傳回的原因丟出。
import type { OrganKey } from './content.ts';
import type { Action, BattleConfig, BattleState, Partition } from './engine.ts';
import type { EnemyConfig, Ev, Organ, Side, SideFacts } from './types.ts';

export type ExpMode = 'BASELINE' | 'A' | 'B';
export interface ExpConfig { mode: ExpMode }

/** 進入 configHash 的規格版本字串；規格變更時一併改字串，三模式與不同版本的紀錄不得混用。 */
export const EXP_SPEC: Record<'A' | 'B', string> = { A: 'FUN-EXP-01/EXPERIMENT_A_RULES/v1', B: 'FUN-EXP-01/EXPERIMENT_B_RULES/v1' };
/** 實驗 A 執念平手時沿用的 Baseline 屠夫權重（BUT w10=7）。 */
export const OBS_FALLBACK_W10 = 7;
/** A2：10 × |A_L − A_R| ≥ A_total 時觸發執念。 */
export const AREA_OBSESSION_FACTOR = 10;
/** B：撕裂時每個封存器官的刀中效果發動次數。 */
export const TEAR_MULTIPLIER = 2;
/** B：可留傷口的切穿顆數範圍。 */
export const WOUND_MIN_PIERCED = 1;
export const WOUND_MAX_PIERCED = 2;

export function expModeOf(cfg: BattleConfig): ExpMode {
  return cfg.exp ? cfg.exp.mode : 'BASELINE';
}

function isObs(enemy: EnemyConfig): boolean {
  return enemy.kind === 'OBS_HEART' || enemy.kind === 'OBS_AREA';
}

/**
 * 設定正規化與驗證（newBattle／restoreState 經 trustedConfig 呼叫）。
 * BASELINE：移除 exp 欄位（狀態中的 config 與 b18a218 逐值相同）；執念敵人只能出現在實驗 A；實驗 B 敵人固定 Baseline 屠夫。
 */
export function normalizeConfig(cfg: BattleConfig): BattleConfig {
  const { exp, ...rest } = cfg;
  if (exp !== undefined) {
    if (!exp || typeof exp !== 'object' || Object.keys(exp).join(',') !== 'mode') throw new RangeError(`實驗設定格式不符：${JSON.stringify(exp)}`);
    if (exp.mode !== 'BASELINE' && exp.mode !== 'A' && exp.mode !== 'B') throw new RangeError(`未知的實驗模式：${String(exp.mode)}`);
  }
  const mode: ExpMode = exp ? exp.mode : 'BASELINE';
  const e = rest.enemy;
  if (mode === 'BASELINE') {
    if (isObs(e)) throw new RangeError('執念敵人（OBS_HEART／OBS_AREA）只能用於實驗 A');
    return rest as BattleConfig;
  }
  if (mode === 'A') {
    if (!isObs(e) || (e as { w10: number }).w10 !== OBS_FALLBACK_W10) throw new RangeError(`實驗 A 的敵人必須是 OBS_HEART／OBS_AREA 且 w10=${OBS_FALLBACK_W10}`);
  } else if (e.kind !== 'BUT' || e.w10 !== 7) {
    throw new RangeError('實驗 B 的敵人必須是 Baseline 屠夫（BUT w10=7）');
  }
  return { ...rest, exp: { mode } } as BattleConfig;
}

/** runConfigOf 的實驗欄位：BASELINE 傳回空物件（configHash 與 b18a218 相同），否則含模式與規格版本。 */
export function expRunConfigOf(cfg: BattleConfig): Record<string, unknown> {
  const mode = expModeOf(cfg);
  return mode === 'BASELINE' ? {} : { exp: { mode, spec: EXP_SPEC[mode] } };
}

/** newBattle 的初始實驗狀態：只有實驗 B 有 wound 欄位（初值 null）；Baseline 與 A 不出現此欄位。 */
export function expInitState(cfg: BattleConfig): { wound?: Wound | null } {
  return expModeOf(cfg) === 'B' ? { wound: null } : {};
}

// ---------------------------------------------------------------- 實驗 A：執念

/** 選邊模擬的附加欄位：A1 計算該側（敵人拿走那側）的心臟數；其他敵人不加欄位（CHOICE 事件與 Baseline 相同）。 */
export function obsFactsOf(enemy: EnemyConfig, keep: Organ[]): { hearts?: number } {
  return enemy.kind === 'OBS_HEART' ? { hearts: keep.filter((o) => o.key === 'heart').length } : {};
}

/** 執念規則本體（公開規則，不需結算）：A1 心臟多的一側；A2 面積差 ≥ 10% 時面積大的一側；否則 null。 */
export function obsessionPick(kind: 'OBS_HEART' | 'OBS_AREA', hearts: { L: number; R: number }, area2: { L: number; R: number }): Side | null {
  if (kind === 'OBS_HEART') return hearts.L === hearts.R ? null : hearts.L > hearts.R ? 'L' : 'R';
  const total = area2.L + area2.R;
  if (area2.L === area2.R) return null;
  return AREA_OBSESSION_FACTOR * Math.abs(area2.L - area2.R) >= total ? (area2.L > area2.R ? 'L' : 'R') : null;
}

/** enemy.ts choose 的執念掛鉤：只在兩側都不致死時由 choose 呼叫；非執念敵人一律 null。 */
export function obsessionSide(enemy: EnemyConfig, L: SideFacts, R: SideFacts): Side | null {
  if (enemy.kind !== 'OBS_HEART' && enemy.kind !== 'OBS_AREA') return null;
  if (enemy.kind === 'OBS_HEART' && (L.hearts === undefined || R.hearts === undefined)) throw new Error('OBS_HEART 缺少心臟數');
  return obsessionPick(enemy.kind, { L: L.hearts ?? 0, R: R.hearts ?? 0 }, { L: L.area2, R: R.area2 });
}

export interface ObsessionPreview {
  metric: 'HEART' | 'AREA';
  /** A1：落側心臟數；A2：面積（引擎整數單位 area2） */
  L: number;
  R: number;
  /** A2 才有：兩側面積百分比（四捨五入整數，僅供顯示；門檻以整數 area2 判定） */
  pct?: { L: number; R: number };
  /** 若兩側都不致死，執念會讓牠拿的一側；null＝執念不分高下（照原版評分） */
  side: Side | null;
}

/** UI 預覽（不呼叫選邊函式、不試算結算）：兩側執念指標與「執念會讓牠拿哪側」。非實驗 A 或非法切線傳回 null。 */
export function obsessionPreview(s: BattleState, part: Partition): ObsessionPreview | null {
  const e = s.config.enemy;
  if (!part.legal || (e.kind !== 'OBS_HEART' && e.kind !== 'OBS_AREA')) return null;
  const hearts = { L: part.L.filter((o) => o.key === 'heart').length, R: part.R.filter((o) => o.key === 'heart').length };
  const side = obsessionPick(e.kind, hearts, part.area2);
  if (e.kind === 'OBS_HEART') return { metric: 'HEART', L: hearts.L, R: hearts.R, side };
  const total = part.area2.L + part.area2.R;
  const pctL = Math.round((100 * part.area2.L) / total);
  return { metric: 'AREA', L: part.area2.L, R: part.area2.R, pct: { L: pctL, R: 100 - pctL }, side };
}

// ---------------------------------------------------------------- 實驗 B：傷口

export interface WoundEnd { x: number; y: number; pos: number }
export interface Wound {
  /** 留下傷口的回合 */
  round: number;
  a: WoundEnd;
  b: WoundEnd;
  /** 封存的器官（1～2 顆，id 遞增） */
  sealed: Organ[];
}

/**
 * 兩條弦是否相交：端點在軀體邊界上交錯（以錨點的周長定點位置 pos 判定，純整數）。
 * 共用端點（pos 或座標相同）或重合不算相交。
 */
export function chordsCross(w: { a: WoundEnd; b: WoundEnd }, a: WoundEnd, b: WoundEnd): boolean {
  const lo = Math.min(w.a.pos, w.b.pos), hi = Math.max(w.a.pos, w.b.pos);
  const same = (p: WoundEnd, q: WoundEnd): boolean => p.pos === q.pos || (p.x === q.x && p.y === q.y);
  for (const p of [a, b]) if (same(p, w.a) || same(p, w.b)) return false;
  const inside = (p: WoundEnd): boolean => lo < p.pos && p.pos < hi;
  return inside(a) !== inside(b);
}

function endsOf(s: BattleState, i: number, j: number): [WoundEnd, WoundEnd] | null {
  const b = s.board;
  if (!b || !Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= b.anchors.length || j >= b.anchors.length) return null;
  const A = b.anchors[Math.min(i, j)], B = b.anchors[Math.max(i, j)];
  return [{ x: A.x, y: A.y, pos: A.pos }, { x: B.x, y: B.y, pos: B.pos }];
}

/** UI：目前切線（i, j）是否穿過傷口（＝撕裂）。沒有傷口或非實驗 B 傳回 false。 */
export function woundCrossedBy(s: BattleState, i: number, j: number): boolean {
  if (!s.wound) return false;
  const e = endsOf(s, i, j);
  return e !== null && chordsCross(s.wound, e[0], e[1]);
}

export type KeepWoundReason = 'NOT_EXPERIMENT_B' | 'ILLEGAL_LINE' | 'TEAR_ROUND' | 'PIERCED_NONE' | 'PIERCED_TOO_MANY';

/** UI 與引擎共用：這條切線可不可以勾「留下傷口」，不行時的原因。 */
export function keepWoundCheck(s: BattleState, part: Partition): { ok: boolean; reason: KeepWoundReason | null } {
  if (expModeOf(s.config) !== 'B') return { ok: false, reason: 'NOT_EXPERIMENT_B' };
  if (!part.legal) return { ok: false, reason: 'ILLEGAL_LINE' };
  if (woundCrossedBy(s, part.i, part.j)) return { ok: false, reason: 'TEAR_ROUND' };
  if (part.pierced.length < WOUND_MIN_PIERCED) return { ok: false, reason: 'PIERCED_NONE' };
  if (part.pierced.length > WOUND_MAX_PIERCED) return { ok: false, reason: 'PIERCED_TOO_MANY' };
  return { ok: true, reason: null };
}

/** UI：若這刀撕裂傷口，會發動的封存器官（每顆 ×TEAR_MULTIPLIER）。直接列出封存內容，不試算結算。 */
export function tearPreview(s: BattleState): { keys: OrganKey[]; times: number } | null {
  return s.wound ? { keys: s.wound.sealed.map((o) => o.key), times: TEAR_MULTIPLIER } : null;
}

/** validateAction 的掛鉤：keepWound 必須是布林；非實驗 B 不得為 true。傳回錯誤訊息或 null。 */
export function expActionError(s: BattleState, a: Action): string | null {
  if (a.keepWound === undefined) return null;
  if (typeof a.keepWound !== 'boolean') return `keepWound 必須是布林：${String(a.keepWound)}`;
  if (a.keepWound && expModeOf(s.config) !== 'B') return '只有實驗 B 可以留下傷口';
  return null;
}

export interface WoundPrep {
  error: string | null;
  events: Ev[];
  /** 交給 resolveRound 的切穿清單（留傷口時移除封存器官；撕裂時加入封存器官複本各兩份） */
  pierced: Organ[];
  nextId: number;
  /** 本回合留下的新傷口（戰鬥在本回合結束時由 act 清為 null） */
  wound: Wound | null;
}

/** act 的掛鉤（合法切線、結算前）：實驗 B 的撕裂／癒合／留傷口。非實驗 B 傳回 null（act 走原路徑）。 */
export function woundPrepare(s: BattleState, p: Partition, a: Action): WoundPrep | null {
  if (expModeOf(s.config) !== 'B') return null;
  const events: Ev[] = [];
  const keep = a.keepWound === true;
  const check = keepWoundCheck(s, p);
  if (keep && !check.ok) return { error: `不能留下傷口：${check.reason}`, events, pierced: p.pierced, nextId: s.nextId, wound: null };
  let nextId = s.nextId;
  const copies: Organ[] = [];
  const w = s.wound ?? null;
  if (w) {
    if (woundCrossedBy(s, p.i, p.j)) {
      for (const o of w.sealed) for (let k = 0; k < TEAR_MULTIPLIER; k++) copies.push({ ...o, id: nextId++ });
      events.push({ t: 'WOUND', op: 'TEAR', organs: w.sealed.map((o) => o.id), copies: copies.map((o) => o.id) });
    } else {
      events.push({ t: 'WOUND', op: 'HEAL', organs: w.sealed.map((o) => o.id) });
    }
  }
  let wound: Wound | null = null;
  if (keep) {
    const e = endsOf(s, p.i, p.j)!;
    const sealed = [...p.pierced].sort((x, y) => x.id - y.id);
    wound = { round: s.round, a: e[0], b: e[1], sealed };
    events.push({ t: 'WOUND', op: 'KEEP', organs: sealed.map((o) => o.id) });
  }
  return { error: null, events, pierced: [...(keep ? [] : p.pierced), ...copies], nextId, wound };
}

// ---------------------------------------------------------------- 紀錄（X-11 引擎端欄位）

export interface ExpRoundFacts {
  mode: ExpMode;
  enemyKind: EnemyConfig['kind'];
  choiceSide: Side | null;
  choiceReason: string | null;
  obsessionTriggered: boolean;
  /** 實驗 A：兩側執念指標（以切前盤面計） */
  obsession: ObsessionPreview | null;
  /** 實驗 B：本回合傷口事件（依發生順序：先撕裂／癒合，再留下） */
  wound: { op: 'KEEP' | 'TEAR' | 'HEAL'; organs: OrganKey[] }[];
  /** 實驗 B：撕裂複本造成的實扣 HP（DMG 事件 loss 加總；鏡膜反射 organ=-1 無法歸因，不計） */
  tearHpLoss: { P: number; E: number } | null;
}

/** 由切前狀態、該刀的分區（partitionOf）與 act 事件整理一回合的實驗紀錄欄位（純函式，不重算結算）。 */
export function expRoundFacts(before: BattleState, part: Partition, events: Ev[]): ExpRoundFacts {
  const mode = expModeOf(before.config);
  const choice = events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE') ?? null;
  const keyOf = new Map<number, OrganKey>();
  for (const o of before.board?.organs ?? []) keyOf.set(o.id, o.key);
  for (const o of before.wound?.sealed ?? []) keyOf.set(o.id, o.key);
  const wound: ExpRoundFacts['wound'] = [];
  let tearHpLoss: { P: number; E: number } | null = null;
  for (const e of events) {
    if (e.t !== 'WOUND') continue;
    wound.push({ op: e.op, organs: e.organs.map((id) => keyOf.get(id)!) });
    if (e.op === 'TEAR') {
      const ids = new Set(e.copies ?? []);
      tearHpLoss = { P: 0, E: 0 };
      for (const d of events) if (d.t === 'DMG' && ids.has(d.organ)) tearHpLoss[d.dst] += d.loss;
    }
  }
  return {
    mode,
    enemyKind: before.config.enemy.kind,
    choiceSide: choice ? choice.side : null,
    choiceReason: choice ? choice.reason : null,
    obsessionTriggered: choice ? choice.reason === 'OBSESSION' : false,
    obsession: obsessionPreview(before, part),
    wound,
    tearHpLoss,
  };
}
