// 整數幾何（R2-SPEC §4.1、§14.1；R3-SPEC §5.4、§16.3）。座標 y 軸向上，多邊形逆時針。
import { assertSafe, idiv, isqrt, roundDiv, sign, mul } from './int.ts';
import { Cursor } from './prng.ts';
import type { Content } from './content.ts';

export type Pt = readonly [number, number];
export const COORD_MAX = 4096;

export function cross(o: Pt, a: Pt, b: Pt): number {
  return assertSafe((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), 'cross');
}

/** 有號面積的兩倍（逆時針為正）。 */
export function area2(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return assertSafe(s, 'area2');
}

export function inBounds(p: Pt): boolean {
  return p[0] >= 0 && p[0] <= COORD_MAX && p[1] >= 0 && p[1] <= COORD_MAX;
}

/** 0 號頂點：y 最小，同 y 取 x 最小。 */
export function rotateToVertex0(poly: Pt[]): Pt[] {
  let k = 0;
  for (let i = 1; i < poly.length; i++) {
    if (poly[i][1] < poly[k][1] || (poly[i][1] === poly[k][1] && poly[i][0] < poly[k][0])) k = i;
  }
  return [...poly.slice(k), ...poly.slice(0, k)];
}

/** 凸包（逆時針、移除共線點），再轉到 0 號頂點。 */
export function convexHull(pts: readonly Pt[]): Pt[] {
  const u = [...new Map(pts.map((p) => [`${p[0]},${p[1]}`, p] as const)).values()];
  u.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (u.length < 3) return u;
  const lo: Pt[] = [], up: Pt[] = [];
  for (const p of u) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = u.length - 1; i >= 0; i--) {
    const p = u[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return rotateToVertex0([...lo.slice(0, -1), ...up.slice(0, -1)]);
}

export function isStrictlyConvexCCW(poly: readonly Pt[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) if (cross(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]) <= 0) return false;
  return true;
}

export function len2(a: Pt, b: Pt): number {
  return assertSafe((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2, 'len2');
}

/** 點 p 到線段 ab 的距離是否 ≥ m（整數判定）。 */
export function distAtLeast(p: Pt, a: Pt, b: Pt, m: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const wx = p[0] - a[0], wy = p[1] - a[1];
  const dot = wx * dx + wy * dy;
  const L2 = dx * dx + dy * dy;
  const m2 = m * m;
  if (dot <= 0) return wx * wx + wy * wy >= m2;
  if (dot >= L2) return len2(p, b) >= m2;
  const c = wx * dy - wy * dx;
  return mul(c, c) >= mul(m2, L2);
}

/** p 在凸多邊形內部，且與每條邊的距離 ≥ m。 */
export function insideWithMargin(poly: readonly Pt[], p: Pt, m: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (cross(a, b, p) <= 0) return false;
    if (!distAtLeast(p, a, b, m)) return false;
  }
  return true;
}

// ---------------- 範本（R3-SPEC §16.3） ----------------
export interface TemplateResult {
  poly: Pt[] | null;
  attempts: number;
}

export function generateTemplate(cur: Cursor, content: Content): TemplateResult {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const pts: Pt[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (((360 * k + cur.below(229) - 114) % 3600) + 3600) % 3600;
      const rho = 7500 + cur.below(2501);
      const x = 2048 + roundDiv(1500 * rho * content.cos[a], 10000 * 65536);
      const y = 2048 + roundDiv(1200 * rho * content.sin[a], 10000 * 65536);
      pts.push([x, y]);
    }
    const hull = convexHull(pts);
    const okCount = hull.length >= 8 && hull.length <= 10;
    let okEdges = true;
    for (let i = 0; i < hull.length; i++) if (len2(hull[i], hull[(i + 1) % hull.length]) < 100 * 100) okEdges = false;
    if (okCount && okEdges) return { poly: hull, attempts: attempt };
  }
  return { poly: null, attempts: 50 };
}

// ---------------- 錨點（R2 §4.1、§14.1；R3 INT-8） ----------------
export interface Anchor {
  x: number;
  y: number;
  edge: number;
  pos: number; // 周長定點位置（1/256 單位）
}

export interface AnchorResult {
  anchors: Anchor[];
  unplaceable: number;
}

export function edgeLengthsFixed(poly: readonly Pt[]): number[] {
  return poly.map((p, i) => isqrt(len2(p, poly[(i + 1) % poly.length]) * 65536));
}

export function placeAnchors(poly: readonly Pt[], jitterU32: number, count: number): AnchorResult {
  const n = poly.length;
  const L = edgeLengthsFixed(poly);
  const P = L.reduce((s, x) => s + x, 0);
  const start: number[] = [];
  let acc = 0;
  for (const l of L) { start.push(acc); acc += l; }
  const spacing = idiv(P, count);
  const offset = Math.floor(assertSafe(jitterU32 * spacing, 'anchor.offset') / 4294967296);
  const onePct = idiv(P + 99, 100);
  const out: Anchor[] = [];
  let unplaceable = 0;
  const edgeAt = (s: number): number => {
    let e = n - 1;
    for (let i = 0; i < n; i++) if (s >= start[i] && s < start[i] + L[i]) { e = i; break; }
    return e;
  };
  for (let k = 0; k < count; k++) {
    let s = (offset + idiv(k * P, count)) % P;
    let placed: Anchor | null = null;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      const e = edgeAt(s);
      const a = poly[e], b = poly[(e + 1) % n];
      if (50 * L[e] < P) {
        placed = { x: roundDiv(a[0] + b[0], 2), y: roundDiv(a[1] + b[1], 2), edge: e, pos: start[e] + idiv(L[e], 2) };
        break;
      }
      const d0 = s - start[e], d1 = start[e] + L[e] - s;
      if (100 * d0 < P) { s = start[e] + onePct; continue; }
      if (100 * d1 < P) { s = (start[(e + 1) % n] + onePct) % P; continue; }
      let x = a[0] + roundDiv((b[0] - a[0]) * d0, L[e]);
      let y = a[1] + roundDiv((b[1] - a[1]) * d0, L[e]);
      if (x === a[0] && y === a[1]) { x += sign(b[0] - a[0]); y += sign(b[1] - a[1]); }
      if (x === b[0] && y === b[1]) { x += sign(a[0] - b[0]); y += sign(a[1] - b[1]); }
      placed = { x, y, edge: e, pos: s };
    }
    if (placed) out.push(placed); else unplaceable += 1;
  }
  out.sort((p, q) => p.pos - q.pos);
  const dedup: Anchor[] = [];
  for (const a of out) if (!dedup.some((d) => d.x === a.x && d.y === a.y)) dedup.push(a);
  return { anchors: dedup, unplaceable };
}

export function isVertex(poly: readonly Pt[], p: Pt): boolean {
  return poly.some((v) => v[0] === p[0] && v[1] === p[1]);
}

// ---------------- 切割（R3 INT-5） ----------------
export interface Split {
  left: Pt[];
  right: Pt[];
  a2L: number;
  a2R: number;
  a2Total: number;
}

function intersect(p: Pt, q: Pt, sp: number, sq: number): Pt {
  let den = sp - sq;
  let nx = q[0] * sp - p[0] * sq;
  let ny = q[1] * sp - p[1] * sq;
  if (den < 0) { den = -den; nx = -nx; ny = -ny; }
  return [roundDiv(assertSafe(nx, 'ix'), den), roundDiv(assertSafe(ny, 'iy'), den)];
}

function dedupe(poly: Pt[]): Pt[] {
  const r: Pt[] = [];
  for (const p of poly) {
    const last = r[r.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) r.push(p);
  }
  while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

/** 以有向直線 a→b 切開凸多邊形：left＝cross>0 的一側。交點先取整（INT-5）。 */
export function splitByLine(poly: readonly Pt[], a: Pt, b: Pt): Split {
  const s = poly.map((v) => cross(a, b, v));
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const p = poly[i], q = poly[j], sp = s[i], sq = s[j];
    if (sp >= 0) left.push(p);
    if (sp <= 0) right.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const x = intersect(p, q, sp, sq);
      left.push(x);
      right.push(x);
    }
  }
  const L = dedupe(left), R = dedupe(right);
  const a2L = L.length >= 3 ? area2(L) : 0;
  const a2R = R.length >= 3 ? area2(R) : 0;
  return { left: L, right: R, a2L, a2R, a2Total: a2L + a2R };
}

/** 器官相對有向線 a→b 的位置：穿刺（d < r）／左／右（R2 §4.1）。 */
export function classify(a: Pt, b: Pt, c: Pt, r: number): 'P' | 'L' | 'R' {
  const dir2 = len2(a, b);
  const cr = cross(a, b, c);
  if (mul(cr, cr) < mul(r * r, dir2)) return 'P';
  return cr > 0 ? 'L' : 'R';
}

// ---------------- 正規化座標（R3 INT-6、INT-7） ----------------
export function centroid(poly: readonly Pt[]): Pt {
  const A2 = area2(poly);
  let sx = 0, sy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p[0] * q[1] - q[0] * p[1];
    sx += (p[0] + q[0]) * c;
    sy += (p[1] + q[1]) * c;
  }
  return [roundDiv(assertSafe(sx, 'cx'), 3 * A2), roundDiv(assertSafe(sy, 'cy'), 3 * A2)];
}

export function farthestVector(poly: readonly Pt[], c: Pt): Pt {
  let best = -1, f: Pt = [0, 0];
  for (const v of poly) {
    const d = len2(c, v);
    if (d > best) { best = d; f = [v[0] - c[0], v[1] - c[1]]; }
  }
  return f;
}

/** 候選點：C＋u·f＋v·f⊥，u＝(2k−2^32)/2^32、v＝(2m−2^32)/2^32。 */
export function candidatePoint(c: Pt, f: Pt, k: number, m: number): Pt {
  const D = 4294967296;
  const uk = 2 * k - D, vm = 2 * m - D;
  const nx = assertSafe(uk * f[0] - vm * f[1], 'cand.x');
  const ny = assertSafe(uk * f[1] + vm * f[0], 'cand.y');
  return [c[0] + roundDiv(nx, D), c[1] + roundDiv(ny, D)];
}
