// 刀譜（Blade Hand）可玩草圖規則（子路徑 blade/）。可丟棄原型，非正式規則。
// 設計與凍結驗收：the-cut 0233f19 docs/core-redesign-r5/BLADE_HAND_SKETCH.md（BH-01～09）；v0.2 變更：the-cut 068ca72 同檔檔尾（BV-01～06，DL-078）。
// 本檔全部是純函式＋可序列化狀態：幾何、刀路、刀譜計分、生成、反擊、縫合、整局流程。UI 只呼叫這裡。

export type V = [number, number];
export type Kind = 'claw' | 'heart' | 'eye' | 'poison' | 'bone';
export type StitchId = 'sharpClaw' | 'twinHeart' | 'oneEye' | 'boneBlade' | 'venom' | 'longArm' | 'echo' | 'scale';
export interface Organ { id: number; kind: Kind; p: V; hp: number; vein?: boolean }   // hp 只對骨有意義（耐久）；vein＝生成時放在血脈上

// ---------------------------------------------------------------- 試玩數值（可調；調過要記錄在作者證據）
export const TUNE = {
  R: 26,                       // 器官判定半徑
  MIN_LEN: 120, MAX_LEN: 420, LONG_ARM_LEN: 560,
  ORGANS: 14, BONE_HP: 2,
  CUTS: 4, TWITCHES: 2,
  THRESHOLDS: [150, 400, 900, 1800],            // v0.2：4 隻怪
  COUNTERS: [1, 2, 3, 3],                       // v0.2：每隻怪每刀的預告數
  HIT_EMPTY: 0.15, HIT_SCALE: 0.05,             // v0.2：空槽被打中門檻 +15%；逆鱗改 +5%（皆以本隻原門檻計、可累加）
  SYM_MIN: 4, FOUR_COLOR: 2.5,                  // v0.2：對稱長度 ≥4；四色 ×2.5
  SHARP_CLAW: 6, VENOM: 2, LONG_ARM_CHIPS: 10,  // v0.2：鋒爪 +6、毒脈每顆毒 +2、長臂每刀籌碼 +10
  SLOTS: 4,
  KIND_WEIGHTS: { claw: 4, eye: 3, heart: 2, poison: 2, bone: 2 } as Record<Kind, number>,
  MIN_CLAWS: 4,                                 // v0.2：預告最多 3 隻，保證至少多 1 隻爪
  VEINS: [2, 3] as [number, number], VEIN_ORGANS: [4, 5] as [number, number], VEIN_GAP: [62, 80] as [number, number], VEIN_JITTER: 8,
};
export const CHIPS: Record<Kind, number> = { claw: 10, heart: 5, eye: 8, poison: 20, bone: 0 };
export const KINDS: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
export const KIND_NAME: Record<Kind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨' };
export const STITCHES: Record<StitchId, { name: string; desc: string }> = {
  sharpClaw: { name: '鋒爪', desc: '每個爪籌碼 +6' },
  twinHeart: { name: '雙心', desc: '心的倍率改為 +2' },
  oneEye: { name: '獨眼', desc: '對稱改為 ×3' },
  boneBlade: { name: '骨刃', desc: '碰骨不停、直接斬斷，骨算 15 籌碼' },
  venom: { name: '毒脈', desc: '每顆毒，倍率 +2' },
  longArm: { name: '長臂', desc: '刀長上限 560，每刀籌碼 +10' },
  echo: { name: '回刃', desc: '最後一個被斬的器官，籌碼再算一次' },
  scale: { name: '逆鱗', desc: '被反擊打中時，門檻改 +5%，縫合不掉' },
};
export const STITCH_IDS = Object.keys(STITCHES) as StitchId[];
/** 縫合選項來源：這隻怪被斬下的器官種類 → 可出現的縫合。 */
export const KIND_STITCH: Record<Kind, StitchId[]> = {
  claw: ['sharpClaw', 'scale'], heart: ['twinHeart', 'echo'], eye: ['oneEye', 'longArm'], bone: ['boneBlade'], poison: ['venom'],
};

// ---------------------------------------------------------------- 盤面幾何（世界座標 700×1000，直式）
export const W = 700, H = 1000;
export const MONSTER_C: V = [350, 315], MONSTER_RX = 315, MONSTER_RY = 290;   // 怪物輪廓：橢圓（上方約 65%）
export const BODY_Y = 660;                                                    // 你的身體區（下方）
export const SLOT_P: V[] = [[140, 840], [280, 840], [420, 840], [560, 840]];
export function inMonster(p: V, margin = 0): boolean {
  const dx = (p[0] - MONSTER_C[0]) / (MONSTER_RX - margin), dy = (p[1] - MONSTER_C[1]) / (MONSTER_RY - margin);
  return dx * dx + dy * dy <= 1;
}

// ---------------------------------------------------------------- 亂數（可重現）
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** 每個用途一條獨立亂數流：同種子同用途永遠同序列，彼此不互相干擾。 */
export const rngFor = (seed: number, tag: string) => mulberry32(hashStr(`${seed}|${tag}`));
const pickW = <T extends string>(rnd: () => number, w: Record<T, number>): T => {
  const ks = Object.keys(w) as T[]; let t = rnd() * ks.reduce((s, k) => s + w[k], 0);
  for (const k of ks) { t -= w[k]; if (t < 0) return k; } return ks[ks.length - 1];
};
const randInt = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------------------------------------------------------------- 刀路（線段×圓、依距離排序）
/** 線段 a→b 與圓（c, r）相交時，回傳進入點距起點的距離（起點在圓內＝0）；不相交回傳 null。 */
export function segCircle(a: V, b: V, c: V, r: number): number | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c[0], fy = a[1] - c[1];
  const L2 = dx * dx + dy * dy;
  if (fx * fx + fy * fy <= r * r) return 0;
  if (L2 === 0) return null;
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r, disc = B * B - 4 * L2 * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * L2);
  return t >= 0 && t <= 1 ? t * Math.sqrt(L2) : null;
}
export const has = (stitches: (StitchId | null)[], id: StitchId) => stitches.includes(id);
export const maxLen = (stitches: (StitchId | null)[]) => (has(stitches, 'longArm') ? TUNE.LONG_ARM_LEN : TUNE.MAX_LEN);

export interface Path {
  ok: boolean;                 // 刀長不足＝不出刀
  a: V; b: V;                  // 截斷後的刀線
  touched: { id: number; d: number }[];  // 依距離排序的接觸（同距離取 id 小者）
  severed: number[];           // 被斬斷（離場）的器官 id（依序）
  seqIds: number[];            // 刀譜序列：被斬斷的器官，加上被碰到但沒斷的骨（v0.2：放在最後一位）
  boneHits: { id: number; broke: boolean }[];
  stoppedAt: number | null;    // 刀停下的骨 id
}
/** 一刀的刀路：<120 不出刀；超過上限截斷；沿線依距離斬斷；骨擋刀（耐久 −1，歸零才斷；斷了刀也停在這裡；v0.2：沒斷也進序列最後一位）；骨刃：碰骨不停、直接斬斷。 */
export function cutPath(organs: Organ[], a: V, bRaw: V, stitches: (StitchId | null)[]): Path {
  const len = Math.hypot(bRaw[0] - a[0], bRaw[1] - a[1]);
  const lim = maxLen(stitches);
  if (len < TUNE.MIN_LEN) return { ok: false, a, b: bRaw, touched: [], severed: [], seqIds: [], boneHits: [], stoppedAt: null };
  const b: V = len > lim ? [a[0] + ((bRaw[0] - a[0]) * lim) / len, a[1] + ((bRaw[1] - a[1]) * lim) / len] : bRaw;
  const touched = organs.map((o) => ({ id: o.id, d: segCircle(a, b, o.p, TUNE.R) })).filter((t): t is { id: number; d: number } => t.d !== null)
    .sort((x, y) => x.d - y.d || x.id - y.id);
  const severed: number[] = [], boneHits: { id: number; broke: boolean }[] = [];
  const blade = has(stitches, 'boneBlade');
  let stoppedAt: number | null = null;
  const byId = new Map(organs.map((o) => [o.id, o]));
  for (const t of touched) {
    const o = byId.get(t.id)!;
    if (o.kind === 'bone' && !blade) {
      const broke = o.hp - 1 <= 0;
      boneHits.push({ id: o.id, broke });
      if (broke) severed.push(o.id);
      stoppedAt = o.id;
      break;
    }
    severed.push(o.id);
  }
  const seqIds = boneHits.length && !boneHits[0].broke ? [...severed, boneHits[0].id] : severed.slice();
  return { ok: true, a, b, touched, severed, seqIds, boneHits, stoppedAt };
}

// ---------------------------------------------------------------- 刀譜計分
export interface Pattern { key: 'chain' | 'twoPair' | 'symmetry' | 'fourColor' | 'heart' | 'venom'; label: string; add?: number; mul?: number }
export interface Score { seq: Kind[]; chipsList: number[]; chips: number; patterns: Pattern[]; addTotal: number; mulTotal: number; mult: number; score: number }
/** 連續同類的段落（start, len）。 */
function runs(seq: Kind[]): { k: Kind; start: number; len: number }[] {
  const out: { k: Kind; start: number; len: number }[] = [];
  for (let i = 0; i < seq.length;) { let j = i; while (j < seq.length && seq[j] === seq[i]) j++; out.push({ k: seq[i], start: i, len: j - i }); i = j; }
  return out;
}
/** 雙對：序列中某處連續出現 XXYY（X≠Y）。只加一次。 */
export function hasTwoPair(seq: Kind[]): boolean {
  for (let i = 0; i + 3 < seq.length; i++) if (seq[i] === seq[i + 1] && seq[i + 2] === seq[i + 3] && seq[i + 1] !== seq[i + 2]) return true;
  return false;
}
export const isSymmetric = (seq: Kind[]) => seq.length >= TUNE.SYM_MIN && seq.every((k, i) => k === seq[seq.length - 1 - i]);
/** 結算：先加總籌碼 → 套用所有加法倍率（基礎 1）→ 套用乘法倍率。分數＝籌碼×倍率（四色 ×2.5 可能出現小數，分數無條件捨去）。
 *  echoIdx：回刃要重算的那一個（最後一個被斬斷的器官在序列中的位置；未斷的骨不算「被斬」）。預設＝序列最後一個。 */
export function scoreSeq(seq: Kind[], stitches: (StitchId | null)[], echoIdx: number = seq.length - 1): Score {
  const chipsList = seq.map((k) => CHIPS[k] + (k === 'claw' && has(stitches, 'sharpClaw') ? TUNE.SHARP_CLAW : 0) + (k === 'bone' && has(stitches, 'boneBlade') ? 15 : 0));
  if (has(stitches, 'echo') && echoIdx >= 0 && echoIdx < seq.length) chipsList.push(chipsList[echoIdx]);
  if (has(stitches, 'longArm') && seq.length) chipsList.push(TUNE.LONG_ARM_CHIPS);   // 長臂：每刀籌碼 +10（揮空不算）
  const chips = chipsList.reduce((s, c) => s + c, 0);
  const patterns: Pattern[] = [];
  const hearts = seq.filter((k) => k === 'heart').length;
  if (hearts) patterns.push({ key: 'heart', label: `心 ×${hearts}`, add: hearts * (has(stitches, 'twinHeart') ? 2 : 1) });
  for (const r of runs(seq)) {
    if (r.len < 3) continue;
    patterns.push({ key: 'chain', label: `連斬 ${KIND_NAME[r.k]}×${r.len}`, add: r.len });
  }
  const poisons = seq.filter((k) => k === 'poison').length;
  if (poisons && has(stitches, 'venom')) patterns.push({ key: 'venom', label: `毒脈 ×${poisons}`, add: TUNE.VENOM * poisons });
  if (hasTwoPair(seq)) patterns.push({ key: 'twoPair', label: '雙對', add: 3 });
  if (isSymmetric(seq)) patterns.push({ key: 'symmetry', label: '對稱', mul: has(stitches, 'oneEye') ? 3 : 2 });
  if (new Set(seq).size >= 4) patterns.push({ key: 'fourColor', label: '四色', mul: TUNE.FOUR_COLOR });
  const addTotal = patterns.reduce((s, p) => s + (p.add ?? 0), 0);
  const mulTotal = patterns.reduce((s, p) => s * (p.mul ?? 1), 1);
  const mult = (1 + addTotal) * mulTotal;
  return { seq, chipsList, chips, patterns, addTotal, mulTotal, mult, score: Math.floor(chips * mult) };
}

// ---------------------------------------------------------------- 生成
/** 怪物：14 個器官，沿 2～3 條隱藏「血脈」直線聚集（血脈上不放骨，保證有能一刀斬到 ≥4 個的線），其餘隨機散布在輪廓內，不重疊。 */
export function genMonster(seed: number, idx: number): Organ[] {
  for (let attempt = 0; ; attempt++) {
    const rnd = rngFor(seed, `monster${idx}#${attempt}`);
    const out = tryGen(rnd);
    if (out) return out;
  }
}
function tryGen(rnd: () => number): Organ[] | null {
  const R = TUNE.R, minD = 2 * R + 6;
  const pts: { p: V; vein: boolean }[] = [];
  const free = (p: V) => inMonster(p, R + 4) && pts.every((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) >= minD);
  const nVeins = randInt(rnd, ...TUNE.VEINS);
  for (let v = 0; v < nVeins; v++) {
    let placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const n = randInt(rnd, ...TUNE.VEIN_ORGANS), gap = TUNE.VEIN_GAP[0] + rnd() * (TUNE.VEIN_GAP[1] - TUNE.VEIN_GAP[0]);
      const ang = rnd() * Math.PI, dir: V = [Math.cos(ang), Math.sin(ang)], nrm: V = [-dir[1], dir[0]];
      const c: V = [MONSTER_C[0] + (rnd() * 2 - 1) * MONSTER_RX * 0.5, MONSTER_C[1] + (rnd() * 2 - 1) * MONSTER_RY * 0.5];
      const cand: V[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * gap, j = (rnd() * 2 - 1) * TUNE.VEIN_JITTER;
        cand.push([c[0] + dir[0] * t + nrm[0] * j, c[1] + dir[1] * t + nrm[1] * j]);
      }
      const ok = cand.every((p, i) => free(p) && cand.slice(0, i).every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= minD));
      if (ok) { for (const p of cand) pts.push({ p, vein: true }); placed = true; }
    }
    if (!placed) return null;
  }
  for (let tries = 0; pts.length < TUNE.ORGANS && tries < 4000; tries++) {
    const p: V = [MONSTER_C[0] + (rnd() * 2 - 1) * MONSTER_RX, MONSTER_C[1] + (rnd() * 2 - 1) * MONSTER_RY];
    if (free(p)) pts.push({ p, vein: false });
  }
  if (pts.length < TUNE.ORGANS) return null;
  const sel = pts.slice(0, TUNE.ORGANS);
  const kinds = sel.map((s) => { const w = { ...TUNE.KIND_WEIGHTS }; if (s.vein) w.bone = 0; return pickW(rnd, w); });
  // 爪至少 MIN_CLAWS 個（反擊需要爪）：不足就把非骨的器官改成爪，先改非血脈的、再改血脈上的（審查 LOW-7）
  const fixOrder = sel.map((x, i) => i).sort((i, j) => Number(sel[i].vein) - Number(sel[j].vein) || i - j);
  for (const i of fixOrder) { if (kinds.filter((k) => k === 'claw').length >= TUNE.MIN_CLAWS) break; if (kinds[i] !== 'claw' && kinds[i] !== 'bone') kinds[i] = 'claw'; }
  return sel.map((s, i) => ({ id: i, kind: kinds[i], p: [Math.round(s.p[0] * 10) / 10, Math.round(s.p[1] * 10) / 10] as V, hp: kinds[i] === 'bone' ? TUNE.BONE_HP : 1, vein: s.vein }));
}
/** 抽搐：剩下的器官重新散布（種類與骨耐久保留，id 不變），依種子與次數決定。 */
export function scatter(organs: Organ[], seed: number, tag: string): Organ[] {
  for (let attempt = 0; ; attempt++) {
    const rnd = rngFor(seed, `${tag}#${attempt}`), R = TUNE.R, minD = 2 * R + 6, pts: V[] = [];
    for (let tries = 0; pts.length < organs.length && tries < 4000; tries++) {
      const p: V = [MONSTER_C[0] + (rnd() * 2 - 1) * MONSTER_RX, MONSTER_C[1] + (rnd() * 2 - 1) * MONSTER_RY];
      if (inMonster(p, R + 4) && pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= minD)) pts.push(p);
    }
    if (pts.length === organs.length) return organs.map((o, i) => ({ ...o, p: [Math.round(pts[i][0] * 10) / 10, Math.round(pts[i][1] * 10) / 10] as V }));
  }
}

// ---------------------------------------------------------------- 整局狀態
export interface Counter { clawId: number; slot: number }
export type CounterResult = 'cancelled' | 'slotLost' | 'thresholdUp' | 'scaleUp';
export interface CutRecord {
  monster: number; cutNo: number; a: V; b: V; severed: { id: number; kind: Kind }[]; seq: Kind[]; score: Score;
  counters: Counter[]; counterResults: CounterResult[];  // 與 counters 同序；擊倒那一刀反擊不發動（counterResults 為空）
  lostStitches: StitchId[]; thresholdAfter: number; total: number; cleared: boolean;
}
export interface RunState {
  seed: number; monster: number; organs: Organ[];
  cutsLeft: number; cutsMax: number; twitchesLeft: number; twitchNo: number; cutNo: number;
  monsterScore: number; threshold: number; baseThreshold: number; thresholdAdd: number; hits: number;   // threshold＝ceil(base＋累積加成)
  slots: (StitchId | null)[]; counters: Counter[];
  severedKinds: Kind[];       // 這隻怪被斬下的器官種類（縫合選項來源）
  phase: 'aim' | 'stitch' | 'won' | 'lost';
  offer: StitchId[]; totalScore: number; bestCut: number; history: CutRecord[];
}
export function newRun(seed: number): RunState {
  const s: RunState = {
    seed, monster: 0, organs: [], cutsLeft: 0, cutsMax: 0, twitchesLeft: 0, twitchNo: 0, cutNo: 0, monsterScore: 0, threshold: 0, baseThreshold: 0, thresholdAdd: 0, hits: 0,
    slots: Array(TUNE.SLOTS).fill(null), counters: [], severedKinds: [], phase: 'aim', offer: [], totalScore: 0, bestCut: 0, history: [],
  };
  return startMonster(s, 0);
}
export function startMonster(s: RunState, idx: number): RunState {
  const n: RunState = { ...s, monster: idx, organs: genMonster(s.seed, idx), cutsLeft: TUNE.CUTS, cutsMax: TUNE.CUTS, twitchesLeft: TUNE.TWITCHES, twitchNo: 0, cutNo: 0,
    monsterScore: 0, threshold: TUNE.THRESHOLDS[idx], baseThreshold: TUNE.THRESHOLDS[idx], thresholdAdd: 0, hits: 0, severedKinds: [], phase: 'aim', offer: [], counters: [] };
  return withCounters(n);
}
const segDist = (p: V, a: V, b: V) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** v0.2 預告選法：每刀前，依怪物序號預告 1／2／3／3 隻爪（不重複；爪不夠就有幾隻用幾隻），每條各指向一個槽（可同槽）。
 *  選爪：不挑「當下分數最高那條線」會斬到的爪；其餘依「非血脈優先 → 離最高分線遠」排序；同序用種子亂數。最高分線上的爪只在不夠時補上。 */
function withCounters(s: RunState): RunState {
  const claws = s.organs.filter((o) => o.kind === 'claw');
  const want = Math.min(TUNE.COUNTERS[s.monster], claws.length);
  if (!want) return { ...s, counters: [] };
  const rnd = rngFor(s.seed, `counter${s.monster}.${s.cutNo}`);
  const best = bestLine({ ...s, counters: [] }, 'score');
  const onBest = new Set(best ? evaluate(s, best.a, best.b).path.severed : []);
  const keyed = claws.map((o) => ({ o, r: rnd(), d: best ? segDist(o.p, best.a, best.b) : 0 }));
  const order = (x: typeof keyed[number], y: typeof keyed[number]) => Number(!!x.o.vein) - Number(!!y.o.vein) || y.d - x.d || x.r - y.r;
  const off = keyed.filter((k) => !onBest.has(k.o.id)).sort(order), on = keyed.filter((k) => onBest.has(k.o.id)).sort((x, y) => x.r - y.r);
  const chosen = [...off, ...on].slice(0, want);
  return { ...s, counters: chosen.map((k) => ({ clawId: k.o.id, slot: Math.floor(rnd() * TUNE.SLOTS) })) };
}
/** 預覽與結算共用同一個函式：給盤面與刀線，回傳刀路與刀譜分數。 */
export function evaluate(s: RunState, a: V, b: V): { path: Path; score: Score } {
  const path = cutPath(s.organs, a, b, s.slots);
  const byId = new Map(s.organs.map((o) => [o.id, o]));
  const lastSev = path.severed.length ? path.seqIds.indexOf(path.severed[path.severed.length - 1]) : -1;
  return { path, score: scoreSeq(path.seqIds.map((id) => byId.get(id)!.kind), s.slots, lastSev) };
}
/** 反擊結算（純函式，v0.2）：每條各自判定。斬到該爪→取消；沒斬到→逆鱗在身：門檻 +5%（縫合不掉）；否則打掉該槽縫合；槽已空→門檻 +15%。
 *  同一刀多條指向同一槽時依序處理（第一條打掉縫合後，第二條遇到空槽）。門檻增加以本隻原門檻計、可累加。 */
export function resolveCounters(slots: (StitchId | null)[], counters: Counter[], severed: number[], base: number):
  { results: CounterResult[]; slots: (StitchId | null)[]; thresholdAdd: number; lost: StitchId[]; hits: number } {
  let ns = slots.slice(), add = 0, hits = 0;
  const lost: StitchId[] = [], results: CounterResult[] = [];
  for (const c of counters) {
    if (severed.includes(c.clawId)) { results.push('cancelled'); continue; }
    hits++;
    if (has(ns, 'scale')) { add += base * TUNE.HIT_SCALE; results.push('scaleUp'); continue; }
    const cur = ns[c.slot];
    if (cur) { ns = ns.slice(); ns[c.slot] = null; lost.push(cur); results.push('slotLost'); }
    else { add += base * TUNE.HIT_EMPTY; results.push('thresholdUp'); }
  }
  return { results, slots: ns, thresholdAdd: add, lost, hits };
}
/** 出一刀。刀長不足回傳原狀態（不耗刀）。達到門檻＝這隻怪倒下（反擊不發動）→ 縫合或勝利；刀用完沒達標＝敗。 */
export function applyCut(s: RunState, a: V, b: V): { state: RunState; record: CutRecord | null } {
  if (s.phase !== 'aim') return { state: s, record: null };
  const { path, score } = evaluate(s, a, b);
  if (!path.ok) return { state: s, record: null };
  const byId = new Map(s.organs.map((o) => [o.id, o]));
  const sevSet = new Set(path.severed);
  let organs = s.organs.filter((o) => !sevSet.has(o.id));
  organs = organs.map((o) => (path.boneHits.some((h) => h.id === o.id && !h.broke) ? { ...o, hp: o.hp - 1 } : o));
  const monsterScore = s.monsterScore + score.score;
  const cleared = monsterScore >= s.threshold;
  let slots = s.slots, threshold = s.threshold, thresholdAdd = s.thresholdAdd, hits = s.hits, results: CounterResult[] = [], lost: StitchId[] = [];
  if (!cleared) {
    const r = resolveCounters(s.slots, s.counters, path.severed, s.baseThreshold);
    thresholdAdd += r.thresholdAdd;                                  // 以本隻原門檻計、跨刀累加（不複利）；最後才無條件進位一次
    slots = r.slots; threshold = Math.ceil(s.baseThreshold + thresholdAdd - 1e-9); hits += r.hits; results = r.results; lost = r.lost;
  }
  const severedKinds = [...s.severedKinds, ...path.severed.map((id) => byId.get(id)!.kind)];
  const record: CutRecord = { monster: s.monster, cutNo: s.cutNo, a: path.a, b: path.b, severed: path.severed.map((id) => ({ id, kind: byId.get(id)!.kind })), seq: score.seq, score,
    counters: s.counters, counterResults: results, lostStitches: lost, thresholdAfter: threshold, total: s.totalScore + score.score, cleared };
  let n: RunState = { ...s, organs, slots, threshold, thresholdAdd, hits, monsterScore, severedKinds, cutsLeft: s.cutsLeft - 1, cutNo: s.cutNo + 1,
    totalScore: s.totalScore + score.score, bestCut: Math.max(s.bestCut, score.score), history: [...s.history, record] };
  if (cleared) {
    if (s.monster === TUNE.THRESHOLDS.length - 1) n = { ...n, phase: 'won', counters: [] };
    else n = { ...n, phase: 'stitch', counters: [], offer: stitchOffer(n) };
  } else if (n.cutsLeft <= 0) n = { ...n, phase: 'lost', counters: [] };
  else n = withCounters(n);
  return { state: n, record };
}
/** 抽搐（棄牌）：剩下的器官重新散布；不耗刀；預告維持同樣的爪與槽（爪還在就照樣瞄準）。 */
export function twitch(s: RunState): RunState {
  if (s.phase !== 'aim' || s.twitchesLeft <= 0) return s;
  return { ...s, organs: scatter(s.organs, s.seed, `twitch${s.monster}.${s.twitchNo}`), twitchesLeft: s.twitchesLeft - 1, twitchNo: s.twitchNo + 1 };
}
/** 縫合選項：這隻怪被斬下的器官種類對應的縫合（排除已縫的），隨機 3 個；不足 3 個由其餘縫合補。 */
export function stitchOffer(s: RunState): StitchId[] {
  const rnd = rngFor(s.seed, `offer${s.monster}`);
  const owned = new Set(s.slots.filter(Boolean));
  const pool = [...new Set(s.severedKinds.flatMap((k) => KIND_STITCH[k]))].filter((x) => !owned.has(x));
  const rest = STITCH_IDS.filter((x) => !owned.has(x) && !pool.includes(x));
  const take = (arr: StitchId[], n: number) => { const a = arr.slice(), out: StitchId[] = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  const out = take(pool, 3);
  return [...out, ...take(rest, 3 - out.length)];
}
/** 挑 1 個縫上：放進指定槽（槽滿時必須指定要替換的槽；不指定就放第一個空槽）。之後進下一隻怪。 */
export function chooseStitch(s: RunState, pick: StitchId, slot?: number): RunState {
  if (s.phase !== 'stitch' || !s.offer.includes(pick)) return s;
  const target = slot ?? s.slots.findIndex((x) => x === null);
  if (target < 0 || target >= TUNE.SLOTS) return s;
  const slots = s.slots.slice(); slots[target] = pick;
  return startMonster({ ...s, slots }, s.monster + 1);
}

// ---------------------------------------------------------------- 搜線（BH-05 與貪婪 bot 共用）
/** 候選刀線：每對器官中心連線，往兩側延伸、以 3 種偏移與數種長度取樣。回傳最高分或最多斬斷數的那條。 */
export function candidateLines(organs: Organ[], stitches: (StitchId | null)[]): [V, V][] {
  const out: [V, V][] = [], L = maxLen(stitches);
  for (let i = 0; i < organs.length; i++) for (let j = i + 1; j < organs.length; j++) {
    const p = organs[i].p, q = organs[j].p, d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d > L) continue;
    const u: V = [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
    for (const back of [TUNE.R + 2, 60, 120]) {
      for (const dir of [1, -1]) {
        const s0 = dir === 1 ? p : q, uu: V = dir === 1 ? u : [-u[0], -u[1]];
        const a: V = [s0[0] - uu[0] * back, s0[1] - uu[1] * back];
        out.push([a, [a[0] + uu[0] * L, a[1] + uu[1] * L]]);
      }
    }
  }
  return out;
}
export function bestLine(s: RunState, by: 'score' | 'count'): { a: V; b: V; score: number; count: number } | null {
  let best: { a: V; b: V; score: number; count: number } | null = null;
  for (const [a, b] of candidateLines(s.organs, s.slots)) {
    const e = evaluate(s, a, b); if (!e.path.ok) continue;
    const v = by === 'score' ? e.score.score : e.path.severed.length, bv = best ? (by === 'score' ? best.score : best.count) : -1;
    if (v > bv) best = { a, b, score: e.score.score, count: e.path.severed.length };
  }
  return best;
}
