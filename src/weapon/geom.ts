// 「切下就是武器」幾何核心：純函式、完全決定性（無亂數、無時間）。研究片段，不是正式規格。
// 規則來源：the-cut docs/cut-weapon/ACCEPTANCE_FROZEN.md「固定規則」；畫面、預覽、結算、測試全部共用這一份。
export type V = [number, number];

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const len = (a: V) => Math.hypot(a[0], a[1]);
export const DEG = Math.PI / 180;

// ---------- 多邊形工具（凸多邊形；頂點順序不限） ----------
export function area(p: V[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += cross(p[i], p[(i + 1) % p.length]);
  return Math.abs(s) / 2;
}
export function centroid(p: V[]): V {
  let x = 0, y = 0;
  for (const q of p) { x += q[0]; y += q[1]; }
  return [x / p.length, y / p.length];
}
/** 保留 n·p − c ≥ 0 的一側（Sutherland–Hodgman 單一半平面）。 */
export function clipHalf(poly: V[], n: V, c: number): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const sp = dot(n, P) - c, sq = dot(n, Q) - c;
    if (sp >= 0) out.push(P);
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
  }
  return out;
}
function orient(p: V[]): number { let s = 0; for (let i = 0; i < p.length; i++) s += cross(p[i], p[(i + 1) % p.length]); return Math.sign(s) || 1; }
/** 兩個凸多邊形的交集（凸）。 */
export function intersectConvex(a: V[], b: V[]): V[] {
  let out = a;
  const o = orient(b);
  for (let i = 0; i < b.length && out.length; i++) {
    const P = b[i], Q = b[(i + 1) % b.length];
    const e = sub(Q, P);
    const n: V = o > 0 ? [-e[1], e[0]] : [e[1], -e[0]]; // 指向 b 內側
    out = clipHalf(out, n, dot(n, P));
  }
  return out;
}
/** 分離軸檢查：凸多邊形相交（含接觸）。 */
export function polysTouch(a: V[], b: V[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const ax: V = [-e[1], e[0]];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const q of a) { const d = dot(ax, q); if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const q of b) { const d = dot(ax, q); if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      if (amax < bmin || bmax < amin) return false;
    }
  }
  return true;
}
function segDist(p: V, a: V, b: V): number {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, [ab[0] * t, ab[1] * t])));
}
function inside(p: V, poly: V[]): boolean {
  const o = orient(poly);
  for (let i = 0; i < poly.length; i++) if (o * cross(sub(poly[(i + 1) % poly.length], poly[i]), sub(p, poly[i])) < 0) return false;
  return true;
}
/** 圓與凸多邊形相交（含接觸）。 */
export function circleTouch(c: V, r: number, poly: V[]): boolean {
  if (poly.length < 3) return false;
  if (inside(c, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segDist(c, poly[i], poly[(i + 1) % poly.length]) <= r) return true;
  return false;
}
export function circlePoly(c: V, r: number, k = 32): V[] {
  const out: V[] = [];
  for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}

// ---------- 前肢與切割 ----------
export type OrganId = 'claw' | 'carapace';
export interface OrganDef { id: OrganId; name: string; c: V; r: number }
export interface LimbDef { poly: V[]; base: V; organs: OrganDef[] }
export interface OrganState { id: OrganId; inWeapon: boolean; damaged: boolean }
export interface Cut {
  ok: true;
  a: V; b: V;
  /** 武器（切下塊，不含前肢根部中點那側）與剩下的前肢，皆為前肢座標。 */
  weapon: V[]; rest: V[];
  chord: [V, V];
  /** 接縫中心＝弦中點；接縫法線＝垂直切線、指向武器側（單位向量）。 */
  seamC: V; seamN: V;
  organs: OrganState[];
  /** 完好且在武器內的器官區域＝判定圓（32 邊形）∩ 武器多邊形；碰撞只用這些區域，不超出可見輪廓。 */
  regions: Partial<Record<OrganId, V[]>>;
}
export interface CutFail { ok: false; reason: string }
export const MIN_PIECE = 0.04;

export function cutLimb(limb: LimbDef, a: V, b: V): Cut | CutFail {
  const d = sub(b, a), L = len(d);
  if (L < 1e-6) return { ok: false, reason: '刀線太短' };
  const n0: V = [-d[1] / L, d[0] / L];
  const c0 = dot(n0, a);
  const sBase = dot(n0, limb.base) - c0;
  if (Math.abs(sBase) < 1) return { ok: false, reason: '切到根部' };
  const n: V = sBase > 0 ? [-n0[0], -n0[1]] : n0; // 指向武器側（不含根部）
  const c = sBase > 0 ? -c0 : c0;
  const weapon = clipHalf(limb.poly, n, c), rest = clipHalf(limb.poly, [-n[0], -n[1]], -c);
  const A0 = area(limb.poly);
  if (weapon.length < 3 || rest.length < 3) return { ok: false, reason: '沒有切過前肢' };
  if (area(weapon) < MIN_PIECE * A0 || area(rest) < MIN_PIECE * A0) return { ok: false, reason: '切下的塊太小' };
  const onLine = weapon.filter((p) => Math.abs(dot(n, p) - c) < 1e-6);
  let best: [V, V] = [onLine[0], onLine[0]], bd = -1;
  for (const p of onLine) for (const q of onLine) { const e = len(sub(p, q)); if (e > bd) { bd = e; best = [p, q]; } }
  if (bd <= 0) return { ok: false, reason: '沒有切過前肢' };
  const seamC: V = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2];
  const organs: OrganState[] = limb.organs.map((o) => ({ id: o.id, damaged: Math.abs(dot(n, o.c) - c) <= o.r, inWeapon: dot(n, o.c) - c > 0 }));
  const regions: Partial<Record<OrganId, V[]>> = {};
  for (const o of limb.organs) {
    const st = organs.find((s) => s.id === o.id)!;
    if (st.inWeapon && !st.damaged) { const reg = intersectConvex(circlePoly(o.c, o.r), weapon); if (reg.length >= 3) regions[o.id] = reg; }
  }
  return { ok: true, a, b, weapon, rest, chord: best, seamC, seamN: n, organs, regions };
}

// ---------- 裝上手臂：只旋轉＋平移 ----------
export interface Rig { shoulder: V; forearm: number; phiStart: number; phiEnd: number; step: number }
/** seamNormal：接縫中心放斷口、接縫法線對齊手臂（凍結版）。axisRoot：武器保持在前肢上的原本方向（前肢軸＝手臂方向），
 *  接合點＝弦上離前肢根部中點最近的點（比較用，未核准）。 */
export type Attach = 'seamNormal' | 'axisRoot';
/** 接合點（前肢座標）。 */
export function attachPoint(cut: Cut, base: V, mode: Attach = 'seamNormal'): V {
  if (mode === 'seamNormal') return cut.seamC;
  const [p, q] = cut.chord, pq = sub(q, p), t = Math.max(0, Math.min(1, dot(sub(base, p), pq) / (dot(pq, pq) || 1)));
  return [p[0] + pq[0] * t, p[1] + pq[1] * t];
}
/** 旋轉角：把前肢座標的方向（seamNormal＝接縫法線；axisRoot＝前肢軸 +x）轉到手臂方向 phi。 */
export function attachAngle(cut: Cut, phi: number, mode: Attach = 'seamNormal'): number {
  const dir: V = mode === 'seamNormal' ? cut.seamN : [1, 0];
  return phi - Math.atan2(dir[1], dir[0]);
}
export function stump(rig: Rig, phi: number): V { return [rig.shoulder[0] + rig.forearm * Math.cos(phi), rig.shoulder[1] + rig.forearm * Math.sin(phi)]; }
/** 前肢座標 → 場景座標：p ↦ 斷口 + R(θ)(p − 接合點)。只旋轉＋平移。 */
export function toWorld(cut: Cut, rig: Rig, phi: number, mode: Attach = 'seamNormal', base: V = [0, 0]): (p: V) => V {
  const th = attachAngle(cut, phi, mode), co = Math.cos(th), si = Math.sin(th), s = stump(rig, phi), o = attachPoint(cut, base, mode);
  return (p) => { const q = sub(p, o); return [s[0] + co * q[0] - si * q[1], s[1] + si * q[0] + co * q[1]]; };
}

// ---------- 靶與揮擊 ----------
export interface Plate { id: string; poly: V[] }
export interface TargetDef { id: 'slit' | 'cover'; name: string; spot: { c: V; r: number }; plates: Plate[] }
export type Part = 'flesh' | 'claw' | 'carapace';
export interface SwingEvent { kind: 'shatter' | 'stuck' | 'hit' | 'end'; phi: number; plate?: string; spot?: boolean; part?: Part; at?: V }
export interface Swing { phi: number; broken: string[]; done: SwingEvent | null; events: SwingEvent[]; steps: number }

export function newSwing(rig: Rig): Swing { return { phi: rig.phiStart, broken: [], done: null, events: [], steps: 0 }; }

/** 在角度 phi 的碰撞判定（接觸順序：碎板 → 卡住 → 命中；同一步卡住與命中並存時算卡住）。 */
function contactsAt(cut: Cut, rig: Rig, tgt: TargetDef, broken: Set<string>, phi: number, mode: Attach, base: V) {
  const T = toWorld(cut, rig, phi, mode, base);
  const W = cut.weapon.map(T);
  const K = cut.regions.carapace?.map(T), C = cut.regions.claw?.map(T);
  const shatter: string[] = []; const stuck: SwingEvent[] = [];
  for (const pl of tgt.plates) {
    if (broken.has(pl.id) || !polysTouch(W, pl.poly)) continue;
    if (K && polysTouch(K, pl.poly)) { shatter.push(pl.id); continue; }
    const inter = intersectConvex(W, pl.poly);
    stuck.push({ kind: 'stuck', phi, plate: pl.id, part: C && polysTouch(C, pl.poly) ? 'claw' : 'flesh', at: inter.length ? centroid(inter) : centroid(pl.poly) });
  }
  let hit: SwingEvent | null = null;
  if (circleTouch(tgt.spot.c, tgt.spot.r, W)) {
    if (C && circleTouch(tgt.spot.c, tgt.spot.r, C)) hit = { kind: 'hit', phi, spot: true, part: 'claw', at: nearestOn(tgt.spot.c, C) };
    else stuck.push({ kind: 'stuck', phi, spot: true, part: K && circleTouch(tgt.spot.c, tgt.spot.r, K) ? 'carapace' : 'flesh', at: nearestOn(tgt.spot.c, W) });
  }
  return { shatter, stuck, hit };
}
function nearestOn(c: V, poly: V[]): V {
  if (inside(c, poly)) return c;
  let best: V = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(c, a), ab) / (dot(ab, ab) || 1)));
    const p: V = [a[0] + ab[0] * t, a[1] + ab[1] * t], e = len(sub(c, p));
    if (e < bd) { bd = e; best = p; }
  }
  return best;
}

/** 手臂往前揮到 phiTarget（只能往前）：每步不超過 rig.step，與手指速度無關。回傳新狀態（不修改輸入）。 */
export function advance(sw: Swing, cut: Cut, rig: Rig, tgt: TargetDef, phiTarget: number, mode: Attach = 'seamNormal', base: V = [0, 0]): Swing {
  if (sw.done) return sw;
  const s: Swing = { phi: sw.phi, broken: [...sw.broken], done: null, events: [...sw.events], steps: sw.steps };
  const broken = new Set(s.broken);
  const goal = Math.min(phiTarget, rig.phiEnd);
  while (s.phi < goal - 1e-12) {
    const next = Math.min(s.phi + rig.step, goal);
    s.steps++;
    const { shatter, stuck, hit } = contactsAt(cut, rig, tgt, broken, next, mode, base);
    for (const id of shatter) { broken.add(id); s.broken.push(id); s.events.push({ kind: 'shatter', phi: next, plate: id, part: 'carapace' }); }
    if (stuck.length) { s.done = { ...stuck[0], phi: s.phi }; s.events.push(s.done); return s; } // 停在上一步的角度
    if (hit) { s.done = hit; s.events.push(hit); s.phi = next; return s; }
    s.phi = next;
  }
  if (s.phi >= rig.phiEnd - 1e-12) { s.done = { kind: 'end', phi: s.phi }; s.events.push(s.done); }
  return s;
}
