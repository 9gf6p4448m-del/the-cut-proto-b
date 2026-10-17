// 幽光美術模組（DL-071「幽光」；目標圖 the-cut docs/art-direction/ghostlight/）。純繪圖：輸入只有「要畫的東西的狀態」與時間 t（秒），
// 不讀不改任何遊戲規則，也不修改傳入的物件。座標一律是呼叫端畫布的 CSS px（呼叫端自行把世界座標換成螢幕座標）。
// 昂貴的部分（背景煙霧、獸身纖維、前線區、器官本體）預烤進離屏畫布並快取；快取以「幾何／外觀參數」為鍵，不存任何遊戲狀態。
//
// 介面（給 cut-battle 整合）：
//   drawBackdrop(ctx, w, h)                         背景（黑藍底＋煙霧＋星塵）
//   drawBeast(ctx, poly, side, t)                    半透明發光獸身＋流動纖維＋沿纖維移動的光點
//   drawFrontline(ctx, bluePoly, redPoly, t)         兩獸交疊的「前線區」：區內較亮、邊界流光、雙方纖維交織
//   drawScene(ctx, scene, t)                         上面三者一次畫完（整張預烤，最省；建議遊戲用這個）
//   drawOrgan(ctx, organ, state, t)                  5 種器官 × 狀態（正常／發動／鎖定／萌芽／爆開）
//   playFx(ctx, fx, t) → boolean                     7 種戰鬥特效；回傳 false＝這個特效已播完，呼叫端可丟棄
//   fxDuration(fx)、shakeOffset(fx, t)                特效長度、受擊震動位移（給呼叫端平移畫布用）
export type ArtSide = 'blue' | 'red';
export type OrganKind = 'claw' | 'heart' | 'eye' | 'poison' | 'bone';
export type P = [number, number];
export type Ctx = CanvasRenderingContext2D;

export interface OrganView { kind: OrganKind; side: ArtSide; x: number; y: number; r: number }
/** 器官外觀狀態。k：鎖定＝剩餘比例 1→0；萌芽＝成長 0→1；爆開＝進度 0→1。lit：發動亮度 0～1（戰鬥中行動時給 1 再遞減）。 */
export interface OrganState { mode: 'normal' | 'locked' | 'sprout' | 'burst'; k?: number; lit?: number; boneHp?: number; cutAngle?: number; label?: string }
export interface SceneView { w: number; h: number; blue: P[]; red: P[] }
export type Fx =
  | { type: 'clawShot'; t0: number; from: P; to: P; side: ArtSide; dmg?: number }
  | { type: 'critShot'; t0: number; from: P; to: P; side: ArtSide; dmg?: number }
  | { type: 'heal'; t0: number; at: P; amount: number }
  | { type: 'poison'; t0: number; at: P; stacks: number }
  | { type: 'shield'; t0: number; at: P; value: number; max: number; absorbed?: number }
  | { type: 'hitFlash'; t0: number; poly: P[]; side: ArtSide }
  | { type: 'ko'; t0: number; w: number; h: number; winner: ArtSide | 'draw' };

// ---------------------------------------------------------------- 色票（README）
export const PALETTE = { bg0: '#070D19', bg1: '#142D49', blue: '#278DD1', blueL: '#AEEAFF', redD: '#491C2A', red: '#C73548', bone: '#C8C0AF', white: '#F0F7FF', gold: '#FFD27A', poison: '#62E38A', eye: '#F2C14E' };
const RGB = { blue: '39,141,209', blueL: '174,234,255', red: '199,53,72', redL: '255,150,160', bone: '200,192,175', white: '240,247,255', gold: '255,210,122', poison: '98,227,138', eye: '242,193,78', heal: '150,255,200' };
const sideRGB = (s: ArtSide) => (s === 'blue' ? RGB.blue : RGB.red);
const sideLight = (s: ArtSide) => (s === 'blue' ? RGB.blueL : RGB.redL);
const NUM_FONT = 'italic 300 {px}px Georgia, "Times New Roman", "Noto Serif TC", serif'; // README：數字用細襯線字體
const TXT_FONT = '600 {px}px "PingFang TC", "Noto Sans TC", system-ui, sans-serif';
const font = (tpl: string, px: number) => tpl.replace('{px}', String(Math.round(px)));

// ---------------------------------------------------------------- 小工具
export function rand(seed: number): () => number { let x = seed >>> 0 || 1; return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
function polyPath(c: Ctx, poly: readonly P[]): void { c.beginPath(); poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); }
/** 圓角多邊形（獸身用；角半徑 rad）。 */
function roundPath(c: Ctx, poly: readonly P[], rad: number): void { const n = poly.length; c.beginPath(); for (let i = 0; i < n; i++) { const a = poly[(i + n - 1) % n], b = poly[i], d = poly[(i + 1) % n]; const m0: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (i === 0) c.moveTo(m0[0], m0[1]); c.arcTo(b[0], b[1], (b[0] + d[0]) / 2, (b[1] + d[1]) / 2, rad); } c.closePath(); }
function centroid(poly: readonly P[]): P { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
function bounds(poly: readonly P[], pad = 0): [number, number, number, number] { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]); const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad; return [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0]; }
const polyKey = (poly: readonly P[]) => poly.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(';');
/** 凸多邊形交集（Sutherland–Hodgman；clip 須為凸多邊形）。 */
export function intersectPoly(subject: readonly P[], clip: readonly P[]): P[] {
  let out: P[] = subject.map((p) => [p[0], p[1]] as P);
  const area = clip.reduce((s, p, i) => { const q = clip[(i + 1) % clip.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0), sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out; out = [];
    const side = (p: P) => sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const cross = (p: P, q: P): P => { const A1 = q[1] - p[1], B1 = p[0] - q[0], C1 = A1 * p[0] + B1 * p[1], A2 = b[1] - a[1], B2 = a[0] - b[0], C2 = A2 * a[0] + B2 * a[1], D = A1 * B2 - A2 * B1; return D ? [(B2 * C1 - B1 * C2) / D, (A1 * C2 - A2 * C1) / D] : p; };
    for (let j = 0; j < inp.length; j++) { const p = inp[j], q = inp[(j + 1) % inp.length]; if (side(q)) { if (!side(p)) out.push(cross(p, q)); out.push(q); } else if (side(p)) out.push(cross(p, q)); }
  }
  return out;
}

// ---------------------------------------------------------------- 離屏畫布（瀏覽器用 canvas；測試環境由測試注入的 document 提供）
interface Layer { cv: HTMLCanvasElement; x: number; y: number; w: number; h: number }
function makeCanvas(w: number, h: number): HTMLCanvasElement { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h)); return cv; }
const dprOf = (ctx: Ctx) => { const m = ctx.getTransform ? ctx.getTransform() : null; return m && m.a > 0 ? Math.min(3, m.a) : 1; };
function bake(x: number, y: number, w: number, h: number, dpr: number, paint: (c: Ctx) => void): Layer {
  const cv = makeCanvas(w * dpr, h * dpr), c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr); paint(c); return { cv, x, y, w, h };
}
const blit = (ctx: Ctx, L: Layer) => ctx.drawImage(L.cv, L.x, L.y, L.w, L.h);
/** 快取上限：超過就清掉最舊的（避免尺寸一直變時無限長大）。 */
class Cache<T> { private m = new Map<string, T>(); private max: number; constructor(max: number) { this.max = max; } get(k: string, make: () => T): T { let v = this.m.get(k); if (v === undefined) { v = make(); this.m.set(k, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string); } return v; } }

// ---------------------------------------------------------------- 背景
function paintBackdrop(c: Ctx, w: number, h: number): void {
  const g = c.createRadialGradient(w * 0.5, h * 0.48, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, PALETTE.bg1); g.addColorStop(0.55, '#0b1628'); g.addColorStop(1, PALETTE.bg0); c.fillStyle = g; c.fillRect(0, 0, w, h);
  const r = rand(41);
  for (let i = 0; i < 46; i++) { const x = r() * w, y = r() * h, rad = 30 + r() * 120, dark = r() < 0.55, sg = c.createRadialGradient(x, y, 0, x, y, rad); sg.addColorStop(0, dark ? 'rgba(3,6,12,0.34)' : 'rgba(40,80,130,0.10)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = sg; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); }
  for (let i = 0; i < 110; i++) { c.fillStyle = `rgba(174,234,255,${0.04 + r() * 0.16})`; c.beginPath(); c.arc(r() * w, r() * h, 0.4 + r() * 1.1, 0, Math.PI * 2); c.fill(); }
}
const bgCache = new Cache<Layer>(4);
export function drawBackdrop(ctx: Ctx, w: number, h: number): void { const dpr = dprOf(ctx); blit(ctx, bgCache.get(`${w}x${h}@${dpr}`, () => bake(0, 0, w, h, dpr, (c) => paintBackdrop(c, w, h)))); }

// ---------------------------------------------------------------- 獸身（半透明＋纖維），光點沿纖維流動
interface Body { base: Layer; fibers: P[][] }
function axisOf(poly: readonly P[]): [P, P] { let best = 0, A = poly[0], B = poly[1]; for (const p of poly) for (const q of poly) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; A = p; B = q; } } return A[1] < B[1] ? [A, B] : [B, A]; }
function fiberCurves(poly: readonly P[], side: ArtSide, n: number, seed: number): P[][] {
  const [x0, y0, w, h] = bounds(poly), [A, B] = axisOf(poly), ax = B[0] - A[0], ay = B[1] - A[1], al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al;
  // 藍紅纖維斜向相反：交疊區裡兩組纖維自然交織、方向也分得出是誰的
  const tilt = side === 'blue' ? 0.55 : -0.55, dx = ux * Math.cos(tilt) - uy * Math.sin(tilt), dy = ux * Math.sin(tilt) + uy * Math.cos(tilt), L = Math.max(w, h), r = rand(seed), out: P[][] = [];
  for (let i = 0; i < n; i++) {
    const ln = L * (0.25 + r() * 0.45), jt = (r() - 0.5) * 0.6, ddx = dx * Math.cos(jt) - dy * Math.sin(jt), ddy = dx * Math.sin(jt) + dy * Math.cos(jt);
    const cx0 = x0 + r() * w, cy0 = y0 + r() * h, sx = cx0 - (ddx * ln) / 2, sy = cy0 - (ddy * ln) / 2, bend = (r() - 0.5) * ln * 0.6;
    out.push([[sx, sy], [sx + ddx * ln * 0.33 - ddy * bend, sy + ddy * ln * 0.33 + ddx * bend], [sx + ddx * ln * 0.66 + ddy * bend * 0.6, sy + ddy * ln * 0.66 - ddx * bend * 0.6], [sx + ddx * ln, sy + ddy * ln]]);
  }
  return out;
}
function strokeFibers(c: Ctx, curves: P[][], side: ArtSide, seed: number, boost = 1): void {
  const r = rand(seed), rgb = sideRGB(side), lt = sideLight(side);
  c.lineCap = 'round';
  for (const [p0, p1, p2, p3] of curves) { c.strokeStyle = `rgba(${r() < 0.3 ? lt : rgb},${(0.05 + r() * 0.13) * boost})`; c.lineWidth = 0.6 + r() * 1.6; c.beginPath(); c.moveTo(p0[0], p0[1]); c.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); c.stroke(); }
}
function paintBody(c: Ctx, poly: readonly P[], side: ArtSide, curves: P[][]): void {
  const rgb = sideRGB(side), lt = sideLight(side), c0 = centroid(poly), [x0, y0, w, h] = bounds(poly), r = rand(side === 'blue' ? 101 : 202), [A, B] = axisOf(poly);
  // 外鬚：沿外緣長出捲曲的光纖（像目標圖的鬃毛／尾焰），給方正的獸身輪廓生命感；朝向對方（前線區）的那一邊不長，免得干擾前線區
  c.lineCap = 'round';
  const ccw = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1;
    const onx = (ey / el) * ccw, ony = (-ex / el) * ccw; // 外法線
    if ((side === 'blue' && ony < -0.7) || (side === 'red' && ony > 0.7)) continue;
    const n = Math.round(el / 9);
    for (let k = 0; k < n; k++) {
      const tt = r(), px = a[0] + ex * tt, py = a[1] + ey * tt, len = 18 + r() * r() * 70, curl = (r() - 0.5) * 1.6, tx = ex / el, ty = ey / el;
      const mx = px + onx * len * 0.55 + tx * len * curl * 0.5, my = py + ony * len * 0.55 + ty * len * curl * 0.5, qx = px + onx * len + tx * len * curl, qy = py + ony * len + ty * len * curl;
      c.strokeStyle = `rgba(${r() < 0.35 ? lt : rgb},${0.05 + r() * 0.12})`; c.lineWidth = 0.6 + r() * 1.8;
      c.beginPath(); c.moveTo(px - onx * 8, py - ony * 8); c.quadraticCurveTo(mx, my, qx, qy); c.stroke();
    }
  }
  // 邊緣柔化：由外而內多層寬筆、低透明（輪廓不再是硬邊盒子）
  const RAD = 46; c.lineJoin = 'round';
  for (const [lw, a] of [[44, 0.035], [30, 0.05], [18, 0.07]] as [number, number][]) { c.lineWidth = lw; c.strokeStyle = `rgba(${rgb},${a})`; roundPath(c, poly, RAD); c.stroke(); }
  // 半透明本體
  const g = c.createRadialGradient(c0[0], c0[1], 10, c0[0], c0[1], Math.max(w, h) * 0.6); g.addColorStop(0, `rgba(${rgb},0.32)`); g.addColorStop(0.7, `rgba(${rgb},0.16)`); g.addColorStop(1, `rgba(${rgb},0.06)`);
  roundPath(c, poly, RAD); c.fillStyle = g; c.fill();
  c.save(); roundPath(c, poly, RAD); c.clip();
  // 體內脊椎影（裝飾，本色低透明；刻意不用骨白，避免和骨器官混淆）
  const ax = B[0] - A[0], ay = B[1] - A[1], al = Math.hypot(ax, ay) || 1, nx = -ay / al, ny = ax / al, sp: P[] = [];
  for (let k = 0; k <= 22; k++) { const t = k / 22; sp.push([A[0] + ax * t + nx * Math.sin(t * Math.PI * 1.6) * 24, A[1] + ay * t + ny * Math.sin(t * Math.PI * 1.6) * 24]); }
  c.strokeStyle = `rgba(${RGB.bone},0.16)`; c.lineWidth = 3; c.beginPath(); sp.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  for (let k = 1; k < 22; k++) { const dx = sp[k + 1 > 22 ? 22 : k + 1][0] - sp[k - 1][0], dy = sp[k + 1 > 22 ? 22 : k + 1][1] - sp[k - 1][1], an = Math.atan2(dy, dx); c.fillStyle = `rgba(${RGB.bone},0.13)`; c.beginPath(); c.ellipse(sp[k][0], sp[k][1], 6, 4, an, 0, Math.PI * 2); c.fill(); c.strokeStyle = `rgba(${RGB.bone},0.07)`; c.lineWidth = 1.5; c.beginPath(); c.moveTo(sp[k][0], sp[k][1]); c.quadraticCurveTo(sp[k][0] + Math.cos(an + 1.6) * 22, sp[k][1] + Math.sin(an + 1.6) * 22, sp[k][0] + Math.cos(an + 2.2) * 34, sp[k][1] + Math.sin(an + 2.2) * 34); c.moveTo(sp[k][0], sp[k][1]); c.quadraticCurveTo(sp[k][0] + Math.cos(an - 1.6) * 22, sp[k][1] + Math.sin(an - 1.6) * 22, sp[k][0] + Math.cos(an - 2.2) * 34, sp[k][1] + Math.sin(an - 2.2) * 34); c.stroke(); } // 脊椎＋肋影（骨白、低透明）
  c.globalCompositeOperation = 'lighter'; strokeFibers(c, curves, side, side === 'blue' ? 7 : 8); c.globalCompositeOperation = 'source-over';
  c.lineWidth = 18; c.strokeStyle = 'rgba(4,8,16,0.30)'; roundPath(c, poly, RAD); c.stroke();
  c.restore();
  c.lineJoin = 'round'; c.lineWidth = 9; c.strokeStyle = `rgba(${rgb},0.16)`; roundPath(c, poly, RAD); c.stroke(); c.lineWidth = 1.4; c.strokeStyle = `rgba(${lt},0.6)`; c.stroke();
  void x0; void y0;
}
const bodyCache = new Cache<Body>(8);
function bodyOf(poly: readonly P[], side: ArtSide, dpr: number): Body {
  return bodyCache.get(`${side}|${polyKey(poly)}@${dpr}`, () => {
    const curves = fiberCurves(poly, side, 240, side === 'blue' ? 11 : 12), [x0, y0, w, h] = bounds(poly, 30);
    return { base: bake(x0, y0, w, h, dpr, (c) => paintBody(c, poly, side, curves)), fibers: curves.slice(0, 16) };
  });
}
/** 光點沿纖維流動（每側 16 顆）；只用時間 t，不存狀態。 */
function drawGlints(ctx: Ctx, fibers: P[][], side: ArtSide, t: number, seed: number): void {
  const r = rand(seed), lt = sideLight(side);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [p0, p1, p2, p3] of fibers) {
    const ph = r(), sp = 0.12 + r() * 0.15, u = (ph + t * sp) % 1, v = 1 - u;
    const x = v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], y = v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1];
    ctx.fillStyle = `rgba(${lt},${Math.sin(u * Math.PI) * 0.6})`; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
export function drawBeast(ctx: Ctx, poly: readonly P[], side: ArtSide, t: number): void {
  if (poly.length < 3) return;
  const b = bodyOf(poly, side, dprOf(ctx)); blit(ctx, b.base); drawGlints(ctx, b.fibers, side, t, side === 'blue' ? 21 : 22);
}

// ---------------------------------------------------------------- 前線區（兩獸交疊）：區內較亮、雙方纖維交織、邊界流光
interface Front { layer: Layer | null; zone: P[] }
function paintFront(c: Ctx, zone: P[], blue: readonly P[], red: readonly P[]): void {
  const [x0, y0, w, h] = bounds(zone), c0 = centroid(zone);
  c.save(); polyPath(c, zone); c.clip();
  // 區內提亮：中線最亮的帶狀光
  const g = c.createLinearGradient(x0, y0, x0, y0 + h); g.addColorStop(0, 'rgba(240,247,255,0.03)'); g.addColorStop(0.5, 'rgba(240,247,255,0.10)'); g.addColorStop(1, 'rgba(240,247,255,0.03)');
  c.fillStyle = g; c.fillRect(x0, y0, w, h);
  // 雙方纖維交織：在區內各加一組較亮、斜向相反的纖維
  c.globalCompositeOperation = 'lighter';
  strokeFibers(c, fiberCurves(zone, 'blue', 70, 31), 'blue', 33, 1.8);
  strokeFibers(c, fiberCurves(zone, 'red', 70, 32), 'red', 34, 1.8);
  // 交織結點：兩色小光點
  const r = rand(35); for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${r() < 0.5 ? RGB.blueL : RGB.redL},${0.15 + r() * 0.25})`; c.beginPath(); c.arc(x0 + r() * w, y0 + r() * h, 0.8 + r() * 1.4, 0, Math.PI * 2); c.fill(); }
  c.restore();
  void c0; void blue; void red;
}
const frontCache = new Cache<Front>(6);
function frontOf(blue: readonly P[], red: readonly P[], dpr: number): Front {
  return frontCache.get(`${polyKey(blue)}|${polyKey(red)}@${dpr}`, () => {
    const zone = intersectPoly(blue, red);
    if (zone.length < 3) return { layer: null, zone };
    const [x0, y0, w, h] = bounds(zone, 2);
    return { layer: bake(x0, y0, w, h, dpr, (c) => paintFront(c, zone, blue, red)), zone };
  });
}
/** 邊界流光：沿前線區外框跑的光段（lineDashOffset 隨時間），加上兩條「前線」字樣旁的弱脈動。 */
function drawFrontFlow(ctx: Ctx, zone: P[], t: number): void {
  if (zone.length < 3) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  polyPath(ctx, zone); ctx.lineWidth = 6; ctx.strokeStyle = `rgba(240,247,255,${0.05 + 0.04 * pulse})`; ctx.stroke();
  ctx.setLineDash([26, 54]); ctx.lineDashOffset = -t * 60; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(240,247,255,0.55)'; ctx.stroke();
  ctx.lineDashOffset = -t * 60 + 40; ctx.strokeStyle = 'rgba(255,210,122,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
}
export function drawFrontline(ctx: Ctx, blue: readonly P[], red: readonly P[], t: number): void {
  const f = frontOf(blue, red, dprOf(ctx)); if (f.layer) blit(ctx, f.layer); drawFrontFlow(ctx, f.zone, t);
}
/** 前線區多邊形（給呼叫端放標籤或判斷用）；兩獸不交疊時為空陣列。 */
export function frontlineZone(blue: readonly P[], red: readonly P[]): P[] { return intersectPoly(blue, red); }

// ---------------------------------------------------------------- 整個場景（背景＋兩獸＋前線區靜態部分預烤成一張）
const sceneCache = new Cache<{ layer: Layer; bodies: Record<ArtSide, Body>; front: Front }>(4);
export function drawScene(ctx: Ctx, s: SceneView, t: number): void {
  const dpr = dprOf(ctx);
  const sc = sceneCache.get(`${s.w}x${s.h}|${polyKey(s.blue)}|${polyKey(s.red)}@${dpr}`, () => {
    const bodies = { red: bodyOf(s.red, 'red', dpr), blue: bodyOf(s.blue, 'blue', dpr) }, front = frontOf(s.blue, s.red, dpr);
    const layer = bake(0, 0, s.w, s.h, dpr, (c) => { paintBackdrop(c, s.w, s.h); blit(c, bodies.red.base); blit(c, bodies.blue.base); if (front.layer) blit(c, front.layer); });
    return { layer, bodies, front };
  });
  blit(ctx, sc.layer);
  drawGlints(ctx, sc.bodies.red.fibers, 'red', t, 22); drawGlints(ctx, sc.bodies.blue.fibers, 'blue', t, 21);
  drawFrontFlow(ctx, sc.front.zone, t);
}

// ---------------------------------------------------------------- 器官
// 辨識：形狀＋顏色＋圖示各不相同——爪＝骨白彎爪（三道爪紋）、心＝紅心（＋）、眼＝金色杏眼（瞳孔）、毒＝綠色泡囊（氣泡）、骨＝骨白方塊椎骨（盾紋）。
// 所屬方：背後光暈與外圈細線用藍／紅。
function glowSprite(rgb0: string, a0: number, rgb1: string, a1: number): HTMLCanvasElement {
  return glowCache.get(`${rgb0}|${a0}|${rgb1}|${a1}`, () => { const cv = makeCanvas(128, 128), c = cv.getContext('2d')!; const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, `rgba(${rgb0},${a0})`); g.addColorStop(0.45, `rgba(${rgb1},${a1})`); g.addColorStop(1, `rgba(${rgb1},0)`); c.fillStyle = g; c.fillRect(0, 0, 128, 128); return cv; });
}
const glowCache = new Cache<HTMLCanvasElement>(64);
function clawShape(c: Ctx, x: number, y: number, s: number, dir: number): void {
  c.beginPath(); c.moveTo(x - 9 * s, y + 8 * s * dir); c.quadraticCurveTo(x - 14 * s, y - 14 * s * dir, x + 2 * s, y - 24 * s * dir);
  c.quadraticCurveTo(x + 14 * s, y - 28 * s * dir, x + 16 * s, y - 20 * s * dir); c.quadraticCurveTo(x + 4 * s, y - 16 * s * dir, x + 2 * s, y - 2 * s * dir);
  c.quadraticCurveTo(x + 2 * s, y + 8 * s * dir, x + 8 * s, y + 12 * s * dir); c.lineTo(x - 9 * s, y + 8 * s * dir); c.closePath();
}
function heartShape(c: Ctx, x: number, y: number, s: number): void {
  c.beginPath(); c.moveTo(x, y + 15 * s); c.bezierCurveTo(x - 22 * s, y + 2 * s, x - 18 * s, y - 18 * s, x, y - 8 * s); c.bezierCurveTo(x + 18 * s, y - 18 * s, x + 22 * s, y + 2 * s, x, y + 15 * s); c.closePath();
}
function eyeShape(c: Ctx, x: number, y: number, s: number): void { c.beginPath(); c.moveTo(x - 20 * s, y); c.quadraticCurveTo(x, y - 17 * s, x + 20 * s, y); c.quadraticCurveTo(x, y + 17 * s, x - 20 * s, y); c.closePath(); }
function poisonShape(c: Ctx, x: number, y: number, s: number): void { c.beginPath(); c.moveTo(x, y - 19 * s); c.bezierCurveTo(x + 17 * s, y - 6 * s, x + 16 * s, y + 15 * s, x, y + 16 * s); c.bezierCurveTo(x - 16 * s, y + 15 * s, x - 17 * s, y - 6 * s, x, y - 19 * s); c.closePath(); }
function boneShape(c: Ctx, x: number, y: number, s: number): void {
  const w = 15 * s, h = 13 * s, k = 5 * s;
  c.beginPath(); c.moveTo(x - w + k, y - h); c.lineTo(x + w - k, y - h); c.quadraticCurveTo(x + w + k, y - h - k, x + w, y - h + k); c.lineTo(x + w, y + h - k); c.quadraticCurveTo(x + w + k, y + h + k, x + w - k, y + h);
  c.lineTo(x - w + k, y + h); c.quadraticCurveTo(x - w - k, y + h + k, x - w, y + h - k); c.lineTo(x - w, y - h + k); c.quadraticCurveTo(x - w - k, y - h - k, x - w + k, y - h); c.closePath();
}
export function organShape(c: Ctx, kind: OrganKind, x: number, y: number, s: number, side: ArtSide): void {
  if (kind === 'claw') clawShape(c, x, y, s, side === 'blue' ? -1 : 1); else if (kind === 'heart') heartShape(c, x, y, s); else if (kind === 'eye') eyeShape(c, x, y, s); else if (kind === 'poison') poisonShape(c, x, y, s); else boneShape(c, x, y, s);
}
/** 器官本體（不含光暈、狀態疊層）。lit＝0～1 發動亮度。 */
function paintOrganBody(c: Ctx, kind: OrganKind, side: ArtSide, x: number, y: number, s: number, lit: number, boneHp: number, t: number): void {
  const lt = sideLight(side), L = lit > 0.5;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (kind === 'claw') {
    const dir = side === 'blue' ? -1 : 1;
    clawShape(c, x, y, s, dir); const g = c.createLinearGradient(x - 14 * s, y - 20 * s * dir, x + 8 * s, y + 12 * s * dir);
    if (L) { g.addColorStop(0, PALETTE.white); g.addColorStop(1, `rgb(${lt})`); } else { g.addColorStop(0, '#f2ecdf'); g.addColorStop(0.55, PALETTE.bone); g.addColorStop(1, '#6e665a'); }
    c.fillStyle = g; c.fill(); c.lineWidth = 1.4; c.strokeStyle = L ? `rgb(${lt})` : '#2a2620'; c.stroke();
    // 圖示：三道爪紋
    c.strokeStyle = L ? `rgba(${lt},0.9)` : 'rgba(60,52,42,0.75)'; c.lineWidth = 1.3 * s;
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(x - 6 * s + i * 4 * s, y + 4 * s * dir); c.lineTo(x - 2 * s + i * 4 * s, y - 8 * s * dir); c.stroke(); }
  } else if (kind === 'heart') {
    const k = 1 + 0.06 * Math.sin(t * 7.5) * (L ? 1.6 : 1); heartShape(c, x, y, s * k);
    const g = c.createRadialGradient(x - 5 * s, y - 6 * s, 1, x, y, 22 * s);
    if (side === 'red') { g.addColorStop(0, L ? '#ffe3e6' : '#ff8a98'); g.addColorStop(0.45, L ? '#ff6474' : PALETTE.red); g.addColorStop(1, PALETTE.redD); }
    else { g.addColorStop(0, L ? PALETTE.white : '#ff9aa6'); g.addColorStop(0.45, L ? '#ff7d8c' : '#d84a5c'); g.addColorStop(1, '#3a1830'); } // 心永遠是紅色（種類色），所屬方看光暈
    c.fillStyle = g; c.fill(); c.lineWidth = 1.3; c.strokeStyle = '#2a0810'; c.stroke();
    c.strokeStyle = `rgba(255,220,225,${L ? 1 : 0.7})`; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x - 2 * s, y - 6 * s); c.quadraticCurveTo(x - 9 * s, y + 1 * s, x - 3 * s, y + 9 * s); c.moveTo(x + 4 * s, y - 6 * s); c.quadraticCurveTo(x + 10 * s, y + 1 * s, x + 4 * s, y + 7 * s); c.stroke();
    // 圖示：十字
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2 * s; c.beginPath(); c.moveTo(x, y - 3 * s); c.lineTo(x, y + 5 * s); c.moveTo(x - 4 * s, y + 1 * s); c.lineTo(x + 4 * s, y + 1 * s); c.stroke();
  } else if (kind === 'eye') {
    eyeShape(c, x, y, s); const g = c.createLinearGradient(x, y - 14 * s, x, y + 14 * s); g.addColorStop(0, '#fff6dc'); g.addColorStop(1, '#c9b48a'); c.fillStyle = g; c.fill(); c.lineWidth = 1.4; c.strokeStyle = '#3a2a10'; c.stroke();
    const look = Math.sin(t * 1.3) * 2.5 * s, ir = c.createRadialGradient(x + look, y, 0, x + look, y, 9 * s); ir.addColorStop(0, L ? '#fff3c4' : PALETTE.eye); ir.addColorStop(0.7, L ? PALETTE.eye : '#b07a10'); ir.addColorStop(1, '#5a3a06');
    c.fillStyle = ir; c.beginPath(); c.arc(x + look, y, 8.5 * s, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#100a02'; c.beginPath(); c.ellipse(x + look, y, 2.2 * s, 6 * s, 0, 0, Math.PI * 2); c.fill(); // 縱向瞳孔
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(x + look - 3 * s, y - 3 * s, 1.6 * s, 0, Math.PI * 2); c.fill();
  } else if (kind === 'poison') {
    poisonShape(c, x, y, s); const g = c.createRadialGradient(x - 4 * s, y - 6 * s, 1, x, y, 20 * s); g.addColorStop(0, L ? '#eaffef' : '#b8ffcc'); g.addColorStop(0.5, PALETTE.poison); g.addColorStop(1, '#0f4a26');
    c.fillStyle = g; c.fill(); c.lineWidth = 1.3; c.strokeStyle = '#06301a'; c.stroke();
    // 圖示：體內上浮氣泡
    for (let i = 0; i < 4; i++) { const ph = (t * 0.6 + i * 0.25) % 1, bx = x + Math.sin(i * 2.1) * 6 * s, by = y + 10 * s - ph * 22 * s; c.strokeStyle = `rgba(230,255,235,${0.8 * Math.sin(ph * Math.PI)})`; c.lineWidth = 1; c.beginPath(); c.arc(bx, by, (1.5 + i * 0.5) * s, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.ellipse(x - 5 * s, y - 8 * s, 2.5 * s, 4 * s, -0.5, 0, Math.PI * 2); c.fill();
  } else {
    boneShape(c, x, y, s); const g = c.createLinearGradient(x, y - 13 * s, x, y + 13 * s);
    if (L) { g.addColorStop(0, PALETTE.white); g.addColorStop(1, `rgb(${lt})`); } else { g.addColorStop(0, '#f4eee2'); g.addColorStop(0.5, PALETTE.bone); g.addColorStop(1, '#7d7465'); }
    c.fillStyle = g; c.fill(); c.lineWidth = 2; c.strokeStyle = '#140a06'; c.stroke();
    // 圖示：盾紋（擋刀）
    c.strokeStyle = 'rgba(40,30,20,0.75)'; c.lineWidth = 1.4 * s; c.beginPath(); c.moveTo(x, y - 8 * s); c.lineTo(x + 7 * s, y - 5 * s); c.lineTo(x + 6 * s, y + 3 * s); c.quadraticCurveTo(x + 3 * s, y + 8 * s, x, y + 9 * s); c.quadraticCurveTo(x - 3 * s, y + 8 * s, x - 6 * s, y + 3 * s); c.lineTo(x - 7 * s, y - 5 * s); c.closePath(); c.stroke();
    if (boneHp < 2) { c.strokeStyle = '#1a0c06'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x - 4 * s, y - 13 * s); c.lineTo(x + 3 * s, y - 1 * s); c.lineTo(x - 2 * s, y + 13 * s); c.stroke(); }
  }
}
const KIND_GLOW: Record<OrganKind, string> = { claw: RGB.bone, heart: '255,110,130', eye: RGB.eye, poison: RGB.poison, bone: RGB.bone };
/** 器官本體貼圖（正常、未發動）快取；發動與心跳等動態才逐格畫。 */
const organCache = new Cache<HTMLCanvasElement>(240);
function organSprite(kind: OrganKind, side: ArtSide, r: number, boneHp: number, dpr: number, lit = 0): HTMLCanvasElement {
  const S = Math.ceil(r * 3.2);
  return organCache.get(`${kind}|${side}|${r.toFixed(1)}|${boneHp}|${lit}@${dpr}`, () => { const cv = makeCanvas(S * dpr, S * dpr), c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); paintOrganBody(c, kind, side, S / 2, S / 2, r / 26, lit, boneHp, 0); return cv; });
}
export function drawOrgan(ctx: Ctx, o: Readonly<OrganView>, st: Readonly<OrganState>, t: number): void {
  const { kind, side, x, y, r } = o, s = r / 26, lit = clamp01(st.lit ?? 0), boneHp = st.boneHp ?? 2, mode = st.mode, k = clamp01(st.k ?? (mode === 'sprout' ? 1 : 0));
  ctx.save();
  if (mode === 'burst') { drawBurst(ctx, o, k, st.cutAngle ?? -0.6, t); ctx.restore(); return; }
  if (mode === 'sprout') {
    // 萌芽：種子核心＋虛線外框逐漸長大，透明；長到 1 才是實體
    const g = easeOut(k); ctx.globalAlpha = 0.35 + 0.45 * g;
    ctx.drawImage(glowSprite(KIND_GLOW[kind], 0.35, sideRGB(side), 0.1), x - r * 1.3 * g, y - r * 1.3 * g, r * 2.6 * g, r * 2.6 * g);
    ctx.setLineDash([3, 4]); ctx.lineDashOffset = -t * 20; ctx.strokeStyle = `rgba(${sideLight(side)},0.9)`; ctx.lineWidth = 1.4;
    organShape(ctx, kind, x, y, s * (0.35 + 0.65 * g), side); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${KIND_GLOW[kind]},0.9)`; ctx.beginPath(); ctx.arc(x, y, 3 + 3 * g, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${sideLight(side)},0.9)`; ctx.font = font(TXT_FONT, 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('萌芽', x, y + r + 8);
    ctx.restore(); return;
  }
  // 光暈（所屬方色＋種類色）
  const R0 = r * (1.55 + 0.4 * lit), dpr = dprOf(ctx);
  ctx.drawImage(glowSprite(lit > 0 ? RGB.white : KIND_GLOW[kind], 0.28 + 0.45 * lit, sideRGB(side), 0.16 + 0.2 * lit), x - R0, y - R0, R0 * 2, R0 * 2);
  ctx.strokeStyle = `rgba(${sideRGB(side)},0.55)`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, Math.PI * 2); ctx.stroke(); // 所屬方外圈
  {
    const S = Math.ceil(r * 3.2), lq = Math.round(lit * 3) / 3, beat = kind === 'heart' ? 1 + 0.06 * Math.sin(t * 7.5) * (1 + lq) : 1, D = S * beat;
    ctx.drawImage(organSprite(kind, side, r, boneHp, dpr, lq), x - D / 2, y - D / 2, D, D);
    if (kind === 'poison') for (let i = 0; i < 2; i++) { const ph = (t * 0.6 + i * 0.5) % 1; ctx.strokeStyle = `rgba(230,255,235,${0.8 * Math.sin(ph * Math.PI)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + (i ? 5 : -4) * s, y + 9 * s - ph * 20 * s, (1.6 + i) * s, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (lit > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(${RGB.white},${lit})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * (1.1 + 0.5 * (1 - lit)), 0, Math.PI * 2); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
  if (mode === 'locked') drawLock(ctx, x, y, r, k, t, st.label);
  ctx.restore();
}
/** 鎖定：金色六角護盾環，緩慢旋轉；外圈弧＝剩餘時間。 */
function drawLock(ctx: Ctx, x: number, y: number, r: number, k: number, t: number, label?: string): void {
  const R = r * 1.3, rot = t * 0.8;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,224,138,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = rot + (i * Math.PI) / 3, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
  ctx.fillStyle = 'rgba(255,224,138,0.10)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,240,190,0.95)'; ctx.beginPath(); ctx.arc(x, y, R + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  if (label) { ctx.font = font(NUM_FONT, 13); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#FFE08A'; ctx.fillText(label, x, y - R - 7); }
  ctx.restore();
}
/** 被切除爆開：器官沿切線分成兩半往兩側飛開＋剖面亮邊＋碎光與血霧。k：0→1。 */
function drawBurst(ctx: Ctx, o: Readonly<OrganView>, k: number, ang: number, t: number): void {
  const { kind, side, x, y, r } = o, s = r / 26, e = easeOut(k), nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2), a = 1 - k;
  for (const sg of [-1, 1]) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.translate(x + nx * sg * e * r * 1.4, y + ny * sg * e * r * 1.4 + e * e * r * 0.8); ctx.rotate(sg * e * 0.6);
    // 半邊裁切：以切線為界
    ctx.beginPath(); const L = r * 3; ctx.moveTo(-Math.cos(ang) * L, -Math.sin(ang) * L); ctx.lineTo(Math.cos(ang) * L, Math.sin(ang) * L); ctx.lineTo(Math.cos(ang) * L + nx * sg * L, Math.sin(ang) * L + ny * sg * L); ctx.lineTo(-Math.cos(ang) * L + nx * sg * L, -Math.sin(ang) * L + ny * sg * L); ctx.closePath(); ctx.clip();
    paintOrganBody(ctx, kind, side, 0, 0, s, 0, 2, t);
    ctx.strokeStyle = kind === 'heart' ? '#ffd0d6' : kind === 'poison' ? '#d8ffe2' : kind === 'eye' ? '#fff0c0' : '#bfe8ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-Math.cos(ang) * r, -Math.sin(ang) * r); ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const R = r * (0.6 + 2.2 * e); ctx.drawImage(glowSprite(RGB.white, 0.8 * a, sideRGB(side), 0.25 * a), x - R, y - R, R * 2, R * 2);
  const rr = rand(Math.round(x * 7 + y)); const col = kind === 'poison' ? RGB.poison : kind === 'eye' ? RGB.eye : kind === 'heart' ? RGB.red : sideLight(side);
  for (let i = 0; i < 16; i++) { const an = rr() * Math.PI * 2, d = r * (0.4 + (1.2 + rr()) * e * 1.6); ctx.fillStyle = `rgba(${i % 3 ? col : RGB.white},${a * (0.4 + rr() * 0.6)})`; ctx.beginPath(); ctx.arc(x + Math.cos(an) * d, y + Math.sin(an) * d + e * e * r, 1 + rr() * 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- 戰鬥特效
const DUR: Record<Fx['type'], number> = { clawShot: 0.55, critShot: 0.9, heal: 1.1, poison: 1.2, shield: 1.2, hitFlash: 0.32, ko: 2.6 };
export function fxDuration(fx: Readonly<Fx>): number { return DUR[fx.type]; }
/** 受擊震動位移（hitFlash／critShot 期間給呼叫端平移畫布；其他特效為 0）。決定性：只由 t 決定。 */
export function shakeOffset(fx: Readonly<Fx>, t: number): P {
  const u = t - fx.t0; if (u < 0 || (fx.type !== 'hitFlash' && fx.type !== 'critShot')) return [0, 0];
  const d = fx.type === 'critShot' ? 0.3 : 0.22; if (u > d) return [0, 0];
  const amp = (fx.type === 'critShot' ? 7 : 4) * (1 - u / d); return [Math.sin(u * 90) * amp, Math.cos(u * 77) * amp];
}
function clawStreaks(ctx: Ctx, from: P, to: P, k: number, rgb: string, lt: string, width: number, n: number): P {
  const e = easeOut(Math.min(1, k / 0.45)), dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const head: P = [from[0] + dx * e, from[1] + dy * e], tail = Math.max(0, e - 0.35), fade = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * width * 1.6, bend = Math.sin((i + 1) * 1.7) * 8;
    const ax = from[0] + dx * tail + nx * off, ay = from[1] + dy * tail + ny * off, bx = head[0] + nx * off, by = head[1] + ny * off, mx = (ax + bx) / 2 + nx * bend, my = (ay + by) / 2 + ny * bend;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.strokeStyle = `rgba(${rgb},${0.25 * fade})`; ctx.lineWidth = width * 3; ctx.stroke();
    ctx.strokeStyle = `rgba(${lt},${0.75 * fade})`; ctx.lineWidth = width; ctx.stroke();
    ctx.strokeStyle = `rgba(${RGB.white},${0.9 * fade})`; ctx.lineWidth = Math.max(1, width * 0.35); ctx.stroke();
  }
  ctx.restore(); void ux; void uy;
  return head;
}
function impact(ctx: Ctx, at: P, k: number, rgb: string, size: number): void {
  const a = 1 - k; ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const R = size * (0.5 + k); ctx.drawImage(glowSprite(RGB.white, 0.9 * a, rgb, 0.4 * a), at[0] - R, at[1] - R, R * 2, R * 2);
  const r = rand(Math.round(at[0] * 3 + at[1])); for (let i = 0; i < 10; i++) { const an = r() * Math.PI * 2, d = size * (0.3 + k * (0.8 + r())); ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(at[0] + Math.cos(an) * d * 0.5, at[1] + Math.sin(an) * d * 0.5); ctx.lineTo(at[0] + Math.cos(an) * d, at[1] + Math.sin(an) * d); ctx.stroke(); }
  ctx.restore();
}
function floatText(ctx: Ctx, text: string, at: P, k: number, color: string, px: number, tpl = NUM_FONT): void {
  const a = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1, sc = 1 + 0.35 * Math.max(0, 1 - k / 0.15);
  ctx.save(); ctx.globalAlpha = clamp01(a); ctx.translate(at[0], at[1] - 26 - 30 * easeOut(k)); ctx.scale(sc, sc);
  ctx.font = font(tpl, px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(7,13,25,0.85)'; ctx.strokeText(text, 0, 0); ctx.fillStyle = color; ctx.fillText(text, 0, 0);
  ctx.restore();
}
/** 播一個特效。t：現在時間（秒，同 fx.t0 的時間軸）。回傳 false＝已播完。不修改 fx。 */
export function playFx(ctx: Ctx, fx: Readonly<Fx>, t: number): boolean {
  const u = t - fx.t0, D = DUR[fx.type]; if (u < 0) return true; if (u > D) return false;
  const k = u / D;
  ctx.save();
  switch (fx.type) {
    case 'clawShot': {
      const head = clawStreaks(ctx, fx.from, fx.to, k, sideRGB(fx.side), sideLight(fx.side), 2.4, 3);
      if (k >= 0.4) { impact(ctx, fx.to, (k - 0.4) / 0.6, sideRGB(fx.side), 26); if (fx.dmg !== undefined) floatText(ctx, `${fx.dmg}`, fx.to, (k - 0.4) / 0.6, PALETTE.white, 22); }
      void head; break;
    }
    case 'critShot': {
      clawStreaks(ctx, fx.from, fx.to, k * 1.4, RGB.gold, '255,236,170', 4, 3);
      if (k >= 0.3) {
        const q = (k - 0.3) / 0.7; impact(ctx, fx.to, q, RGB.gold, 44);
        floatText(ctx, '暴擊', [fx.to[0], fx.to[1] - 22], q, PALETTE.gold, 20, TXT_FONT);
        if (fx.dmg !== undefined) floatText(ctx, `${fx.dmg}`, fx.to, q, PALETTE.gold, 34);
      }
      break;
    }
    case 'heal': {
      const [x, y] = fx.at; ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${RGB.heal},${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 12 + 30 * easeOut(k), 0, Math.PI * 2); ctx.stroke();
      const r = rand(Math.round(x + y * 3)); for (let i = 0; i < 10; i++) { const px = x + (r() - 0.5) * 36, py = y + 10 - (k + r() * 0.3) * 50; ctx.fillStyle = `rgba(${RGB.heal},${(1 - k) * (0.4 + r() * 0.6)})`; ctx.font = font(TXT_FONT, 9 + r() * 5); ctx.textAlign = 'center'; ctx.fillText('+', px, py); }
      ctx.globalCompositeOperation = 'source-over'; floatText(ctx, `+HP ${fx.amount}`, fx.at, k, '#9CFFC8', 18, TXT_FONT);
      break;
    }
    case 'poison': {
      const [x, y] = fx.at, r = rand(Math.round(x * 5 + y));
      for (let i = 0; i < 12; i++) { const ph = clamp01(k * 1.3 - r() * 0.3), bx = x + (r() - 0.5) * 40, by = y + 14 - ph * 46; ctx.strokeStyle = `rgba(${RGB.poison},${Math.sin(ph * Math.PI) * 0.9})`; ctx.fillStyle = `rgba(${RGB.poison},${Math.sin(ph * Math.PI) * 0.25})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(bx, by, 2 + r() * 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      // 層數徽章：綠色圓章＋數字，疊上去時跳一下
      const bump = 1 + 0.3 * Math.max(0, 1 - k / 0.2), bx = x + 22, by = y - 20, R = 11 * bump;
      ctx.fillStyle = 'rgba(10,40,22,0.9)'; ctx.strokeStyle = PALETTE.poison; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d8ffe2'; ctx.font = font(TXT_FONT, 11 * bump); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`毒${fx.stacks}`, bx, by + 0.5);
      break;
    }
    case 'shield': {
      const [x, y] = fx.at, w = 58, h = 8, frac = fx.max > 0 ? clamp01(fx.value / fx.max) : 0, a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      ctx.globalAlpha = a;
      // 骨白護盾條：分節＋流光；被吸收時閃一下
      ctx.fillStyle = 'rgba(7,13,25,0.8)'; ctx.fillRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4);
      const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, '#f4eee2'); g.addColorStop(1, PALETTE.bone); ctx.fillStyle = g; ctx.fillRect(x - w / 2, y - h / 2, w * frac, h);
      ctx.strokeStyle = 'rgba(20,10,6,0.8)'; ctx.lineWidth = 1; for (let i = 1; i < 5; i++) { const sx = x - w / 2 + (w * i) / 5; ctx.beginPath(); ctx.moveTo(sx, y - h / 2); ctx.lineTo(sx, y + h / 2); ctx.stroke(); }
      const sh = ((t * 0.9) % 1) * w; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - w / 2 + sh - 6, y - h / 2, 8, h * frac > 0 ? h : 0);
      if (fx.absorbed) { const q = clamp01(k / 0.35); ctx.strokeStyle = `rgba(255,240,200,${1 - q})`; ctx.lineWidth = 3; ctx.strokeRect(x - w / 2 - 4 - q * 6, y - h / 2 - 4 - q * 6, w + 8 + q * 12, h + 8 + q * 12); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#F0E8D6'; ctx.font = font(NUM_FONT, 13); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(`護盾 ${Math.round(fx.value)}`, x, y - h / 2 - 4);
      if (fx.absorbed) floatText(ctx, `擋 ${fx.absorbed}`, [x, y - 6], k, '#F0E8D6', 15, TXT_FONT);
      break;
    }
    case 'hitFlash': {
      const a = (1 - k) ** 2; if (fx.poly.length >= 3) { ctx.globalCompositeOperation = 'lighter'; polyPath(ctx, fx.poly); ctx.fillStyle = `rgba(240,247,255,${0.55 * a})`; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.stroke(); }
      break;
    }
    case 'ko': {
      const { w, h } = fx, z = 1 + 0.8 * Math.max(0, 1 - k * 5), col = fx.winner === 'blue' ? PALETTE.blueL : fx.winner === 'red' ? '#ff9aa6' : PALETTE.bone;
      ctx.fillStyle = `rgba(3,6,12,${0.6 * clamp01(k * 4)})`; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const r = rand(99); for (let i = 0; i < 28; i++) { const an = (i / 28) * Math.PI * 2 + r() * 0.1, d0 = Math.min(w, h) * 0.12, d1 = d0 + Math.min(w, h) * (0.2 + 0.4 * easeOut(k)) * (0.6 + r() * 0.4); ctx.strokeStyle = `rgba(${RGB.gold},${0.5 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(an) * d0, h / 2 + Math.sin(an) * d0); ctx.lineTo(w / 2 + Math.cos(an) * d1, h / 2 + Math.sin(an) * d1); ctx.stroke(); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font('900 {px}px "PingFang TC", "Noto Serif TC", serif', Math.min(w, h) * 0.22); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(7,13,25,0.9)'; ctx.strokeText('擊倒', 0, 0);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.fillText('擊倒', 0, 0); ctx.shadowBlur = 0;
      ctx.font = font(TXT_FONT, Math.min(w, h) * 0.05); ctx.fillStyle = PALETTE.white; ctx.fillText(fx.winner === 'draw' ? '雙方同時倒下' : fx.winner === 'blue' ? '你贏了' : '你輸了', 0, Math.min(w, h) * 0.15);
      ctx.restore();
      break;
    }
  }
  ctx.restore();
  return true;
}
