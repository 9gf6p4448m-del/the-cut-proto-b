// 戰鬥引擎（Gate 1：只有模型 A＝每回合固定範本＋6 顆新器官）。純函式：輸入狀態不會被修改。
import { canonical, deepFreeze, hashOf } from './canon.ts';
import { contentDigest, isTrustedContent } from './content.ts';
import type { Content } from './content.ts';
import {
  candidatePoint, centroid, classify, farthestVector, generateTemplate, inBounds, insideWithMargin, isVertex,
  len2, placeAnchors, splitByLine,
} from './geom.ts';
import type { Anchor, Pt } from './geom.ts';
import { Cursor, streamState } from './prng.ts';
import type { PrngState } from './prng.ts';
import { resolveRound } from './resolve.ts';
import type { EnemyConfig, Ev, Organ, Result, Rules, Side } from './types.ts';
import { ENGINE_VERSION, SPEC_VERSION } from './version.ts';

export interface BattleConfig {
  seed: number;
  model: 'A';
  rules: Rules;
  enemy: EnemyConfig;
  hpP: number;
  hpE: number;
  r: number;
  anchorCount: number;
  maxRounds: number;
}

export interface Board {
  anchors: Anchor[];
  organs: Organ[];
  /** 回合開始時已發生的效果事件數（小再生腺 SPAWN） */
  effectsAtStart: number;
}

export interface Streams {
  anchorJitter: PrngState;
  spawnType: PrngState;
  spawnPos: PrngState;
}

export interface BattleState {
  engineVersion: string;
  specVersion: string;
  configHash: string;
  config: BattleConfig;
  round: number;
  hp: { P: number; E: number };
  maxHp: { P: number; E: number };
  template: Pt[];
  streams: Streams;
  nextId: number;
  /** 下一回合要先放置的小再生腺數量 */
  seedlingsPending: number;
  board: Board | null;
  result: Result | null;
  sd1: boolean;
  stats: { templateAttempts: number; spawnFail: number; candOOR: number; anchorUnplaceable: number };
}

export interface Action {
  round: number;
  actor: 'P';
  i: number;
  j: number;
}

export interface Partition {
  i: number;
  j: number;
  legal: boolean;
  reason?: string;
  pierced: Organ[];
  L: Organ[];
  R: Organ[];
  area2: { L: number; R: number };
}

export function runConfigOf(cfg: BattleConfig, content: Content): Record<string, unknown> {
  return {
    engineVersion: ENGINE_VERSION, specVersion: SPEC_VERSION, model: cfg.model, rules: cfg.rules, enemy: cfg.enemy,
    hpP: cfg.hpP, hpE: cfg.hpE, r: cfg.r, anchorCount: cfg.anchorCount, maxRounds: cfg.maxRounds,
    contentDigest: contentDigest(content), testOnlyContent: content.testOnly,
  };
}

const ORGANS_PER_ROUND = 6;
/** B 軌 fork（proto-b）：每顆器官從前 N 種抽（預設 6＝研究引擎原樣；3＝三器官體驗模式）。只能在 newBattle 前設定。 */
export let PROTO_B_ORGAN_POOL = 6;
export function setProtoBOrganPool(n: 3 | 6): void { PROTO_B_ORGAN_POOL = n; }
const CANDIDATES = 96;
const PER_ORGAN_SCAN = 16; // IMPL-1：每顆器官從共用指標往後最多掃 16 個候選點（GATE0_LOCK.md）

export interface Placement {
  organs: Organ[];
  events: Ev[];
  nextId: number;
  candOOR: number;
  spawnFail: number;
  seedlingSpawns: number;
  pointer: number;
}

/** 器官放置（R2 §4.2、IMPL-1）：小再生腺先放，再依序放前 k 個新種類，共用一個候選指標。純函式，可注入候選序列（EC-32）。 */
export function placeOrgans(poly: readonly Pt[], cands: readonly Pt[], types: readonly Organ['key'][], seedlings: number, r: number, startId: number): Placement {
  const organs: Organ[] = [];
  const events: Ev[] = [];
  let nextId = startId, ptr = 0, candOOR = 0, spawnFail = 0, seedlingSpawns = 0;
  const want: { key: Organ['key']; src: 'NEW' | 'SEEDLING' }[] = [];
  for (let k = 0; k < Math.min(seedlings, ORGANS_PER_ROUND); k++) want.push({ key: 'seedling', src: 'SEEDLING' });
  for (let k = 0; want.length < ORGANS_PER_ROUND; k++) want.push({ key: types[k], src: 'NEW' });
  for (const w of want) {
    let at: Pt | null = null;
    const end = Math.min(cands.length, ptr + PER_ORGAN_SCAN);
    while (ptr < end && !at) {
      const p = cands[ptr];
      ptr += 1;
      if (!inBounds(p)) { candOOR += 1; events.push({ t: 'SPAWN_CAND_OOR', idx: ptr - 1 }); continue; }
      if (!insideWithMargin(poly, p, r + 40)) continue;
      if (organs.some((q) => 25 * len2([q.x, q.y], p) < 121 * r * r)) continue;
      at = p;
    }
    if (!at) { spawnFail += 1; events.push({ t: 'SPAWN_FAIL', key: w.key }); continue; }
    const org: Organ = { id: nextId++, key: w.key, x: at[0], y: at[1] };
    organs.push(org);
    if (w.src === 'SEEDLING') seedlingSpawns += 1;
    events.push({ t: 'SPAWN', id: org.id, key: org.key, x: org.x, y: org.y, src: w.src });
  }
  return { organs, events, nextId, candOOR, spawnFail, seedlingSpawns, pointer: ptr };
}

/** 生成一回合的盤面：固定消耗 anchorJitter 1、spawnType 6、spawnPos 192 個亂數（R2 §4.2、§6.1）。 */
function startRound(s: BattleState, content: Content, events: Ev[]): BattleState {
  const round = s.round + 1;
  events.push({ t: 'RS', round });
  const aj = new Cursor(s.streams.anchorJitter);
  const ar = placeAnchors(s.template, aj.u32(), s.config.anchorCount);
  events.push({ t: 'ANCHORS', count: ar.anchors.length, unplaceable: ar.unplaceable });
  const st = new Cursor(s.streams.spawnType);
  const types = Array.from({ length: ORGANS_PER_ROUND }, () => content.organs[st.below(PROTO_B_ORGAN_POOL)].key);
  const sp = new Cursor(s.streams.spawnPos);
  const c = centroid(s.template), f = farthestVector(s.template, c);
  const cands: Pt[] = [];
  for (let k = 0; k < CANDIDATES; k++) {
    const ku = sp.u32(), mu = sp.u32();
    cands.push(candidatePoint(c, f, ku, mu));
  }
  const placed = placeOrgans(s.template, cands, types, s.seedlingsPending, s.config.r, s.nextId);
  events.push(...placed.events);
  const nextId = placed.nextId, organs = placed.organs, candOOR = placed.candOOR, spawnFail = placed.spawnFail;
  return {
    ...s,
    round,
    nextId,
    seedlingsPending: 0,
    board: { anchors: ar.anchors, organs, effectsAtStart: placed.seedlingSpawns },
    streams: { ...s.streams, anchorJitter: aj.state, spawnType: st.state, spawnPos: sp.state },
    stats: { ...s.stats, candOOR: s.stats.candOOR + candOOR, spawnFail: s.stats.spawnFail + spawnFail, anchorUnplaceable: s.stats.anchorUnplaceable + ar.unplaceable },
  };
}

export function newBattle(cfg0: BattleConfig, content: Content): { state: BattleState; events: Ev[] } {
  const cfg = trustedConfig(cfg0);
  const tc = new Cursor(streamState(cfg.seed, 'template'));
  const tr = generateTemplate(tc, content);
  const base: BattleState = {
    engineVersion: ENGINE_VERSION,
    specVersion: SPEC_VERSION,
    configHash: hashOf(runConfigOf(cfg, content)),
    config: cfg,
    round: 0,
    hp: { P: cfg.hpP, E: cfg.hpE },
    maxHp: { P: cfg.hpP, E: cfg.hpE },
    template: tr.poly ?? [],
    streams: {
      anchorJitter: streamState(cfg.seed, 'anchorJitter'),
      spawnType: streamState(cfg.seed, 'spawnType'),
      spawnPos: streamState(cfg.seed, 'spawnPos'),
    },
    nextId: 1,
    seedlingsPending: 0,
    board: null,
    result: null,
    sd1: false,
    stats: { templateAttempts: tr.attempts, spawnFail: 0, candOOR: 0, anchorUnplaceable: 0 },
  };
  const events: Ev[] = [];
  if (!tr.poly) {
    events.push({ t: 'END', result: 'INVALID', sd1: false });
    return { state: { ...base, result: 'INVALID' }, events };
  }
  return { state: startRound(base, content, events), events };
}

/** 一條切線的分區（i < j；有向線 a_i→a_j，L＝左側，固定側＝R＝從 i 逆時針走到 j 的弧那側）。 */
export function partitionOf(s: BattleState, i0: number, j0: number): Partition {
  const i = Math.min(i0, j0), j = Math.max(i0, j0);
  const empty = { pierced: [], L: [], R: [], area2: { L: 0, R: 0 } };
  const b = s.board;
  if (!b) return { i, j, legal: false, reason: 'NO_BOARD', ...empty };
  if (i === j || i < 0 || j >= b.anchors.length) return { i, j, legal: false, reason: 'BAD_INDEX', ...empty };
  const A = b.anchors[i], B = b.anchors[j];
  if (A.edge === B.edge) return { i, j, legal: false, reason: 'SAME_EDGE', ...empty };
  const a: Pt = [A.x, A.y], bb: Pt = [B.x, B.y];
  if (isVertex(s.template, a) || isVertex(s.template, bb)) return { i, j, legal: false, reason: 'ANCHOR_AT_VERTEX', ...empty };
  const sp = splitByLine(s.template, a, bb);
  if (10 * sp.a2L < sp.a2Total || 10 * sp.a2R < sp.a2Total) return { i, j, legal: false, reason: 'AREA_TOO_SMALL', ...empty, area2: { L: sp.a2L, R: sp.a2R } };
  const pierced: Organ[] = [], L: Organ[] = [], R: Organ[] = [];
  for (const o of b.organs) {
    const c = classify(a, bb, [o.x, o.y], s.config.r);
    (c === 'P' ? pierced : c === 'L' ? L : R).push(o);
  }
  return { i, j, legal: true, pierced, L, R, area2: { L: sp.a2L, R: sp.a2R } };
}

export function legalLines(s: BattleState): Partition[] {
  if (!s.board) return [];
  const out: Partition[] = [];
  const n = s.board.anchors.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const p = partitionOf(s, i, j);
    if (p.legal) out.push(p);
  }
  return out;
}

/** 提交一刀。非法切線：只產生 CUT 事件，狀態不變。 */
export class InvalidAction extends Error {}

/** 指令格式驗證（PvP AP-1）：actor 必須是當回合執刀者（Gate 1 只有 P）、round 等於目前回合、錨點索引是範圍內的整數。 */
export function validateAction(s: BattleState, a: Action): void {
  if (!a || typeof a !== 'object') throw new InvalidAction('指令不是物件');
  if (a.actor !== 'P') throw new InvalidAction(`actor 必須是 P：${String(a.actor)}`);
  if (a.round !== s.round) throw new InvalidAction(`回合不符：指令 ${a.round}，目前 ${s.round}`);
  const n = s.board ? s.board.anchors.length : 0;
  for (const k of [a.i, a.j]) if (!Number.isInteger(k) || k < 0 || k >= n) throw new InvalidAction(`錨點索引不合法：${k}`);
}

/** 狀態與內容的綁定（PvP AP-3）：狀態的 configHash 必須等於以可信設定與目前內容重算的值。 */
/** 由 newBattle／restoreState 建立、已深層凍結的設定物件。 */
const TRUSTED_CONFIG = new WeakSet<BattleConfig>();
const bindingMemo = new WeakMap<Content, WeakMap<BattleConfig, string>>();

export function trustedConfig(cfg: BattleConfig): BattleConfig {
  const c = deepFreeze(structuredClone(cfg));
  TRUSTED_CONFIG.add(c);
  return c;
}

export function assertBinding(s: BattleState, content: Content): void {
  // 只有「凍結的受信任設定」且「凍結的受信任內容」才使用快取；其他設定物件（例如 structuredClone 出來的狀態）每次重算，
  // 所以驗證結果不會因快取歷史而不同（Codex G1-R2 #1）。內容摘要由 contentDigest 依實際資料計算。
  let h: string | undefined;
  if (TRUSTED_CONFIG.has(s.config) && isTrustedContent(content)) {
    let m = bindingMemo.get(content);
    if (!m) { m = new WeakMap(); bindingMemo.set(content, m); }
    h = m.get(s.config);
    if (h === undefined) { h = hashOf(runConfigOf(s.config, content)); m.set(s.config, h); }
  } else {
    h = hashOf(runConfigOf(s.config, content));
  }
  if (h !== s.configHash) throw new InvalidAction(`設定或內容雜湊不符：狀態 ${s.configHash.slice(0, 12)}…，重算 ${h.slice(0, 12)}…`);
}

export function act(s: BattleState, a: Action, content: Content): { state: BattleState; events: Ev[]; legal: boolean } {
  if (s.result) throw new InvalidAction('戰鬥已結束');
  validateAction(s, a);
  assertBinding(s, content);
  const p = partitionOf(s, a.i, a.j);
  const events: Ev[] = [{ t: 'CUT', i: p.i, j: p.j, legal: p.legal, reason: p.reason }];
  if (!p.legal) return { state: s, events, legal: false };
  const out = resolveRound({
    hp: s.hp, maxHp: s.maxHp, pierced: p.pierced, L: p.L, R: p.R, area2: p.area2, fixedSide: 'R',
    rules: s.config.rules, enemy: s.config.enemy, content, nextId: s.nextId, effectBase: s.board!.effectsAtStart,
  });
  events.push(...out.events);
  let ns: BattleState = { ...s, hp: out.hp, nextId: out.nextId, seedlingsPending: out.seedlings, board: null };
  if (out.result) return { state: { ...ns, result: out.result, sd1: out.sd1 }, events, legal: true };
  if (ns.round >= s.config.maxRounds) {
    events.push({ t: 'END', result: 'STALL', sd1: false });
    return { state: { ...ns, result: 'STALL' }, events, legal: true };
  }
  ns = startRound(ns, content, events);
  return { state: ns, events, legal: true };
}

export function stateHash(s: BattleState): string {
  return hashOf(s);
}

export function canonicalState(s: BattleState): string {
  return canonical(s);
}

/** 回合邊界快照的恢復：版本相同，而且快照中的設定必須等於呼叫端提供的可信設定，雜湊必須能以可信設定與內容重算（Codex G1-R1 #5）。 */
export function restoreState(text: string, trusted: BattleConfig, content: Content): BattleState {
  const s = JSON.parse(text) as BattleState;
  if (s.engineVersion !== ENGINE_VERSION || s.specVersion !== SPEC_VERSION) {
    throw new Error(`版本不相容：快照 ${s.engineVersion}/${s.specVersion}，引擎 ${ENGINE_VERSION}/${SPEC_VERSION}`);
  }
  if (canonical(s.config) !== canonical(trusted)) throw new Error('快照的設定與可信設定不同');
  const h = hashOf(runConfigOf(trusted, content));
  if (s.configHash !== h) throw new Error('快照的設定雜湊與可信設定、內容重算的值不同');
  if (s.board && s.result) throw new Error('快照狀態不一致：戰鬥已結束卻仍有盤面');
  return { ...s, config: trustedConfig(trusted) };
}

export type FixedSide = Side;
