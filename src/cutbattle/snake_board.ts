// duel5 千節蛇（the-cut docs/fusion/DUEL_V05_SNAKE.md 二＋補述 1 第 1～4 條）：蛇身＝沿中線的橫向波浪帶，玩家（藍方）選蛇時取代藍龍的身體。
// 中線 y＝Y0＋A·sin(2π(x−XL)/λ)，x∈[XL,XR]；參數由探勘選定（test-output/v05/geo4.ts）：最小曲率半徑 λ²/(4π²A)＝68.5 ≥60（帶寬 ±60 的多邊形不自交）、
// 用整數座標、直線距離逐顆排「空槽位＋9 顆器官＋空槽位」（10 個間距都 74）後還剩 49 的弧長，可容納 74～77 的隨機間距；中線全程 y ≤600、重心 ≤593。
// 註：read-back 建議的 A≈45、λ≈350（弧長約 800）實測放不下兩端空槽位（直線距離比弧長短），改用這組。
import { R, inside } from '../rtcut/rules.ts';
import type { Kind, OrganDef, V } from '../rtcut/rules.ts';

export const SNAKE = { XL: 12, XR: 688, Y0: 500, A: 100, LAMBDA: 520, HALF: 60 } as const;
/** 蛇的器官序列（沿中線由左到右；補述 1 第 4 條：排列順序固定）。毒 3、爪 2、蛇牙 1、心 1、眼 1、骨 1。 */
export const SNAKE_KINDS: Kind[] = ['poison', 'claw', 'poison', 'heart', 'fang', 'eye', 'poison', 'claw', 'bone'];
export const SNAKE_GAP_MIN = 74, SNAKE_GAP_MAX = 88;   // 2R＋6～2R＋20（R＝34）

const cy = (x: number): number => SNAKE.Y0 + SNAKE.A * Math.sin((2 * Math.PI * (x - SNAKE.XL)) / SNAKE.LAMBDA);
const dy = (x: number): number => ((2 * Math.PI * SNAKE.A) / SNAKE.LAMBDA) * Math.cos((2 * Math.PI * (x - SNAKE.XL)) / SNAKE.LAMBDA);
// 弧長表：每 0.5 單位 x 一格
const XS: number[] = [], SS: number[] = [];
{ let s = 0, px = SNAKE.XL, py = cy(SNAKE.XL); for (let x = SNAKE.XL; x <= SNAKE.XR + 1e-9; x += 0.5) { s += Math.hypot(x - px, cy(x) - py); XS.push(x); SS.push(s); px = x; py = cy(x); } }
export const SNAKE_ARC = SS[SS.length - 1];
/** 中線上弧長 s 處的點（世界座標，四捨五入到整數）。 */
export function snakeAt(s: number): V {
  const t = Math.max(0, Math.min(SNAKE_ARC, s));
  let lo = 0, hi = SS.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SS[m] < t) lo = m; else hi = m; }
  const u = SS[hi] === SS[lo] ? 0 : (t - SS[lo]) / (SS[hi] - SS[lo]), x = XS[lo] + (XS[hi] - XS[lo]) * u;
  return [Math.round(x), Math.round(cy(x))];
}
/** 蛇身多邊形：中線兩側沿法線各偏移 HALF，上緣由左到右、下緣由右到左；兩端平切。 */
export const SNAKE_POLY: V[] = (() => {
  const up: V[] = [], dn: V[] = [];
  for (let x = SNAKE.XL; x <= SNAKE.XR + 1e-9; x += 5) {
    const d = dy(x), n = Math.hypot(1, d), nx = -d / n, ny = 1 / n;   // 法線（朝下）
    up.push([Math.round(x - nx * SNAKE.HALF), Math.round(cy(x) - ny * SNAKE.HALF)]);
    dn.push([Math.round(x + nx * SNAKE.HALF), Math.round(cy(x) + ny * SNAKE.HALF)]);
  }
  return [...up, ...dn.reverse()];
})();
/** 多邊形面積重心。 */
export function polyCentroid(poly: V[]): V {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], c = p[0] * q[1] - q[0] * p[1]; a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; }
  return [x / (3 * a), y / (3 * a)];
}
/** 兩條線段是否相交（不含共用端點的相鄰邊）。用於驗「多邊形不自交」。 */
export function selfIntersects(poly: V[]): boolean {
  const o = (p: V, q: V, r: V) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
  }
  return false;
}
/** 種子決定的間距（直線距離 74～77；補述 1 第 2 條：實際可行約 74～80）與起點：
 * 沿中線依序放「左空槽位、9 顆器官、右空槽位」，相鄰兩點的直線距離＝間距（空槽位到相鄰器官＝74）；兩端點與端切口距 ≥R＋10。起點在可行範圍內由種子決定。 */
function rnd(seed: number): () => number { let x = (seed ^ 0x9e3779b9) >>> 0 || 1; return () => ((x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32); }
export interface SnakeLayout { organS: number[]; slotS: number[] }
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 從弧長 t 往前找第一個和 snakeAt(t) 直線距離 ≥g 的弧長。 */
function stepChord(t: number, g: number): number { const a = snakeAt(t); let u = t; while (u < SNAKE_ARC && dist(snakeAt(u), a) < g) u += 0.5; return u; }
function placeFrom(t0: number, gaps: number[]): number[] { const out = [t0]; for (const g of gaps) out.push(stepChord(out[out.length - 1], g)); return out; }
export function snakeLayout(seed: number): SnakeLayout {
  const r = rnd(seed), gaps = [SNAKE_GAP_MIN, ...Array.from({ length: 8 }, () => SNAKE_GAP_MIN + Math.floor(r() * 4)), SNAKE_GAP_MIN];   // 空槽位—器官 74；器官之間 74～77
  const lo = R + 10, probe = placeFrom(lo, gaps), spare = SNAKE_ARC - (R + 10) - probe[probe.length - 1];   // 兩端各留 R＋10（端切口附近帶緣取樣較粗）
  let t0 = lo + Math.floor(r() * Math.max(1, spare)), all = placeFrom(t0, gaps);
  while (all[10] > SNAKE_ARC - (R + 10) && t0 > lo) { t0 -= 1; all = placeFrom(t0, gaps); }   // 直線距離排列佔用的弧長隨彎曲處而變：超出右端就把起點往回退
  return { organS: all.slice(1, 10), slotS: [all[0], all[10]] };
}
/** 藍方蛇的初始器官（id：藍毒1、藍爪1…，同種類依序編號）。 */
export function genSnakeBase(seed: number): OrganDef[] {
  const { organS } = snakeLayout(seed), n: Partial<Record<Kind, number>> = {};
  const ZH: Record<Kind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨', fang: '牙' };
  return SNAKE_KINDS.map((kind, i) => { n[kind] = (n[kind] ?? 0) + 1; return { id: `藍${ZH[kind]}${n[kind]}`, side: 'blue', kind, p: snakeAt(organS[i]) }; });
}
export const onSnake = (p: V): boolean => inside(p, SNAKE_POLY);
