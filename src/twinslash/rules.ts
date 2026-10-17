// 「一刀雙獸」規則引擎：純函式、完全決定性。畫面、預覽、AI、測試都呼叫這一份（唯一來源）。研究片段，不是正式規格。
// 規則：the-cut docs/twin-slash/ACCEPTANCE_FROZEN.md「固定規則」。
export type V = [number, number];
export type Side = 'blue' | 'red';
export type Kind = 'claw' | 'heart' | 'bone';
export type Mode = 'A1' | 'B2';
export const FOE: Record<Side, Side> = { blue: 'red', red: 'blue' };
export const R = 28, MIN_LEN = 120, MAX_LEN = 420, HP0 = 30, CLAW_DMG = 2, BONE_HP = 2, CUTS_TOTAL = 8, HURT_PER_CHARGE = 6, CHARGE_CAP = 2;

export interface OrganDef { id: string; kind: Kind; p: V }
export interface BoardDef {
  id: string; name: string; purpose: string;
  body: Record<Side, V[]>;
  organs: Record<Side, OrganDef[]>;
}
export const key = (side: Side, id: string) => `${side}:${id}`;

export interface State {
  board: BoardDef; mode: Mode; first: Side; turn: Side; cuts: number; seed: number;
  hp: Record<Side, number>;
  alive: string[];                       // 還在的器官 key
  boneHp: Record<string, number>;
  tired: Record<Side, string[]>;         // 疲勞中的器官 id（只限下一刀）
  charges: Record<Side, number>; meter: Record<Side, number>;
  result: null | { winner: Side | 'draw'; reason: 'kill' | 'cuts' };
}
export function newState(board: BoardDef, mode: Mode, first: Side, seed = 1): State {
  const alive: string[] = [], boneHp: Record<string, number> = {};
  for (const side of ['blue', 'red'] as Side[]) for (const o of board.organs[side]) { alive.push(key(side, o.id)); if (o.kind === 'bone') boneHp[key(side, o.id)] = BONE_HP; }
  return { board, mode, first, turn: first, cuts: 0, seed, hp: { blue: HP0, red: HP0 }, alive, boneHp, tired: { blue: [], red: [] }, charges: { blue: 0, red: 0 }, meter: { blue: 0, red: 0 }, result: null };
}

export function inside(pt: V, poly: V[]): boolean {
  let pos = 0, neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    if (c > 0) pos++; else if (c < 0) neg++;
  }
  return pos === 0 || neg === 0;
}

export type Effect = 'fire' | 'tired' | 'sever' | 'pass' | 'bone' | 'after';
export interface Hit { k: string; side: Side; id: string; kind: Kind; t: number; p: V; effect: Effect }
export interface CutResult {
  legal: boolean; reason?: string;
  a: V; b: V; side: Side; useSever: boolean;
  hits: Hit[];                 // 全部碰到的器官（依刀的方向排序），含停刀後的（effect＝after）
  fired: string[]; severed: string | null; passed: string[]; bone: string | null;
  stop: { t: number; p: V; by: 'organ' | 'bone' } | null;
  dmg: number; spend: boolean;
}
function lerp(a: V, b: V, t: number): V { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
/** 一刀的完整結算（不改狀態）：預覽與出刀共用。useSever＝B2 拆刀開啟（A1 忽略此參數，永遠切除）。 */
export function resolveCut(st: State, side: Side, a: V, b: V, useSever: boolean): CutResult {
  const out: CutResult = { legal: false, a, b, side, useSever, hits: [], fired: [], severed: null, passed: [], bone: null, stop: null, dmg: 0, spend: false };
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < MIN_LEN) { out.reason = '刀太短'; return out; }
  if (len > MAX_LEN + 1e-9) { out.reason = '刀太長'; return out; }
  if (!inside(a, st.board.body[side])) { out.reason = '要從自己的獸身上起刀'; return out; }
  out.legal = true;
  const sever = st.mode === 'A1' || (useSever && st.charges[side] > 0);
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const cand: Hit[] = [];
  for (const s of ['blue', 'red'] as Side[]) for (const o of st.board.organs[s]) {
    const k = key(s, o.id);
    if (!st.alive.includes(k)) continue;
    const t = Math.max(0, Math.min(1, ((o.p[0] - a[0]) * dx + (o.p[1] - a[1]) * dy) / L2));
    const q = lerp(a, b, t);
    if (Math.hypot(o.p[0] - q[0], o.p[1] - q[1]) <= R) cand.push({ k, side: s, id: o.id, kind: o.kind, t, p: o.p, effect: 'after' });
  }
  cand.sort((x, y) => x.t - y.t || (x.side === side ? -1 : 1));
  let stopped = false;
  for (const h of cand) {
    if (stopped) { h.effect = 'after'; out.hits.push(h); continue; }
    if (h.side === side) {
      if (h.kind === 'bone') { out.hits.push({ ...h, effect: 'pass' }); continue; }       // 自己的骨不擋自己的刀
      if (st.tired[side].includes(h.id)) { h.effect = 'tired'; out.hits.push(h); continue; }
      h.effect = 'fire'; out.fired.push(h.k); out.hits.push(h); continue;
    }
    if (h.kind === 'bone') { h.effect = 'bone'; out.bone = h.k; out.stop = { t: h.t, p: lerp(a, b, h.t), by: 'bone' }; stopped = true; out.hits.push(h); continue; }
    if (sever) { h.effect = 'sever'; out.severed = h.k; out.stop = { t: h.t, p: lerp(a, b, h.t), by: 'organ' }; stopped = true; out.hits.push(h); continue; }
    h.effect = 'pass'; out.passed.push(h.k); out.hits.push(h);
  }
  const kindOf = (k: string) => st.board.organs[k.split(':')[0] as Side].find((o) => key(k.split(':')[0] as Side, o.id) === k)!.kind;
  const claws = out.fired.filter((k) => kindOf(k) === 'claw').length, hearts = out.fired.filter((k) => kindOf(k) === 'heart').length;
  out.dmg = CLAW_DMG * claws * (1 + hearts);
  out.spend = st.mode === 'B2' && sever && out.severed !== null;
  return out;
}

/** 套用一刀（回傳新狀態，不改輸入）。 */
export function applyCut(st: State, res: CutResult): State {
  if (!res.legal || st.result || res.side !== st.turn) return st;
  const side = res.side, foe = FOE[side];
  const s: State = JSON.parse(JSON.stringify({ ...st, board: null }));
  s.board = st.board;
  s.hp[foe] -= res.dmg;
  if (res.severed) s.alive = s.alive.filter((k) => k !== res.severed);
  if (res.bone) { s.boneHp[res.bone] -= 1; if (s.boneHp[res.bone] <= 0) s.alive = s.alive.filter((k) => k !== res.bone); }
  s.tired[side] = res.fired.map((k) => k.split(':')[1]);
  if (s.mode === 'B2') {
    if (res.spend) s.charges[side] -= 1;
    s.meter[foe] += res.dmg;
    while (s.meter[foe] >= HURT_PER_CHARGE) { s.meter[foe] -= HURT_PER_CHARGE; s.charges[foe] = Math.min(CHARGE_CAP, s.charges[foe] + 1); }
  }
  s.cuts += 1;
  if (s.hp[foe] <= 0) s.result = { winner: side, reason: 'kill' };
  else if (s.cuts >= CUTS_TOTAL) s.result = { winner: s.hp.blue === s.hp.red ? 'draw' : s.hp.blue > s.hp.red ? 'blue' : 'red', reason: 'cuts' };
  s.turn = foe;
  return s;
}

// ---------------- AI：貪婪一步（傷害＋切除價值），同分以種子決定 ----------------
const VALUE: Record<Kind, number> = { claw: 2, heart: 4, bone: 1 };
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }
export function aiValue(st: State, r: CutResult): number {
  const kindOf = (k: string) => st.board.organs[k.split(':')[0] as Side].find((o) => key(k.split(':')[0] as Side, o.id) === k)!.kind;
  return r.dmg + (r.severed ? VALUE[kindOf(r.severed)] : 0) + (r.bone ? VALUE.bone : 0) - (r.spend ? 0.5 : 0);
}
/** 候選刀路：起點為自己身上的格點，終點為各角度、各長度。只依 st（已結算盤面）計算。 */
export function candidateCuts(st: State, side: Side): CutResult[] {
  const out: CutResult[] = [];
  const body = st.board.body[side];
  const xs = body.map((p) => p[0]), ys = body.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 30) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 30) {
    const a: V = [x, y];
    // 起點離邊界至少 6：避免落在頂點／邊上，畫面座標往返的浮點誤差就判成「不在身上」（只影響 AI 與測試的候選，不影響玩家判定）
    if (![[0, 0], [6, 6], [-6, 6], [6, -6], [-6, -6]].every(([u, v]) => inside([x + u, y + v], body))) continue;
    for (let deg = 0; deg < 360; deg += 6) for (let len = 140; len <= MAX_LEN; len += 40) {
      const b: V = [x + len * Math.cos((deg * Math.PI) / 180), y + len * Math.sin((deg * Math.PI) / 180)];
      if (b[0] < 0 || b[0] > 700 || b[1] < 0 || b[1] > 1000) continue;
      out.push(resolveCut(st, side, a, b, false));
      if (st.mode === 'B2' && st.charges[side] > 0) out.push(resolveCut(st, side, a, b, true));
    }
  }
  return out.filter((r) => r.legal);
}
export function aiChoose(st: State): CutResult {
  const cands = candidateCuts(st, st.turn);
  let best = -Infinity; const top: CutResult[] = [];
  for (const c of cands) { const v = aiValue(st, c); if (v > best + 1e-9) { best = v; top.length = 0; top.push(c); } else if (Math.abs(v - best) <= 1e-9) top.push(c); }
  const r = rng(st.seed * 7919 + st.cuts * 104729)();
  return top[Math.floor(r * top.length)];
}
