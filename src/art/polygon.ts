// 由素材圖的 alpha 自動算出身體多邊形（給遊戲當獸身判定用）＋染色的純像素函式。不碰 DOM，Node 可直接測。
// 流程：alpha 遮罩 → marching squares 取外框輪廓（取面積最大的一圈）→ Ramer–Douglas–Peucker 簡化到 ≤maxVerts 頂點 → 換算到遊戲世界座標（紅方旋轉 180°）。
export type P = [number, number];
export interface Mask { width: number; height: number; alpha: ArrayLike<number> } // alpha 0～255，列優先

export function polygonArea(poly: readonly P[]): number { let s = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; }
/** alpha > thr 的像素數（每像素面積 1）。 */
export function maskArea(m: Mask, thr = 127): number { let n = 0; for (let i = 0; i < m.width * m.height; i++) if (m.alpha[i] > thr) n++; return n; }

/**
 * Marching squares：回傳所有閉合輪廓（像素邊界座標，格點在像素角）。以「像素 alpha > thr」為內側。
 * 只走格線邊界（非插值），輪廓圍出的面積＝內側像素數（扣掉內部洞），供面積驗證。
 */
export function contours(m: Mask, thr = 127): P[][] {
  const W = m.width, H = m.height, inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m.alpha[y * W + x] > thr;
  // 邊界邊：以有向邊表示（內側在左手邊），key＝起點
  const next = new Map<number, number[]>(), key = (x: number, y: number) => y * (W + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0), arr = next.get(k); if (arr) arr.push(key(x1, y1)); else next.set(k, [key(x1, y1)]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);         // 上邊（往右）
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1); // 右邊（往下）
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1); // 下邊（往左）
    if (!inside(x - 1, y)) add(x, y + 1, x, y);         // 左邊（往上）
  }
  const out: P[][] = [];
  const keys = [...next.keys()].sort((a, b) => a - b); // 決定性
  for (const start of keys) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: P[] = []; let cur = start;
      for (let guard = 0; guard < 4 * (W + 1) * (H + 1); guard++) {
        ring.push([cur % (W + 1), Math.floor(cur / (W + 1))]);
        const arr = next.get(cur)!; const nx = arr.pop()!; if (!arr.length) next.delete(cur);
        cur = nx; if (cur === start) break;
      }
      out.push(ring);
    }
  }
  return out;
}
/** 帶號面積（>0＝逆時針，在 y 向下座標系即外框）。 */
function signedArea(poly: readonly P[]): number { let s = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }

function perpDist(p: P, a: P, b: P): number { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]); return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / L; }
function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let idx = 0, dmax = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b];
  const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return [...l.slice(0, -1), ...r];
}
/** 多邊形是否「簡單」（任兩條不相鄰的邊都不相交）。 */
export function isSimple(poly: readonly P[]): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])), n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n]; if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return false; }
  return true;
}
/** 閉合多邊形簡化：從離起點最遠的點切成兩段各自 RDP；eps 由小到大，直到頂點數 ≤ maxVerts 且不自交（候選邊界必須是簡單多邊形）。 */
export function simplify(ring: readonly P[], maxVerts = 64): P[] {
  if (ring.length <= maxVerts) return ring.map((p) => [p[0], p[1]] as P);
  let far = 0, fd = -1; for (let i = 0; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  const A = ring.slice(0, far + 1) as P[], B = [...ring.slice(far), ring[0]] as P[];
  for (let eps = 0.5; ; eps *= 1.15) {
    const s = [...rdp(A, eps).slice(0, -1), ...rdp(B, eps).slice(0, -1)];
    if ((s.length <= maxVerts && isSimple(s)) || s.length <= 3) return s.map((p) => [p[0], p[1]] as P);
  }
}
export interface BodyPolyOpts { thr?: number; maxVerts?: number; downsample?: number }
/**
 * 身體多邊形（遮罩像素座標）：先把遮罩縮小 downsample 倍（區塊平均，降低纖維縫隙的破碎），取 alpha>thr 的最大外框輪廓並簡化。
 * 同一張圖輸出逐值相同（純計算、輪廓起點排序固定）。
 */
export function bodyPolygon(m: Mask, o: BodyPolyOpts = {}): P[] {
  const thr = o.thr ?? 127, ds = Math.max(1, Math.round(o.downsample ?? 1)), mv = o.maxVerts ?? 64;
  const mm = ds > 1 ? downsampleMask(m, ds) : m;
  const rings = contours(mm, thr).filter((r) => signedArea(r) > 0); // 外框（洞是反向）
  if (!rings.length) return [];
  const big = rings.reduce((x, y) => (signedArea(y) > signedArea(x) ? y : x));
  return simplify(big, mv).map((p) => [p[0] * ds, p[1] * ds] as P);
}
export function downsampleMask(m: Mask, ds: number): Mask {
  const W = Math.ceil(m.width / ds), H = Math.ceil(m.height / ds), out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0; for (let j = 0; j < ds; j++) for (let i = 0; i < ds; i++) { const X = x * ds + i, Y = y * ds + j; if (X < m.width && Y < m.height) { s += m.alpha[Y * m.width + X]; n++; } }
    out[y * W + x] = n ? Math.round(s / n) : 0;
  }
  return { width: W, height: H, alpha: out };
}
/** 遮罩座標的多邊形放進遊戲世界座標的矩形 rect（等比縮放置中）；rotate180＝紅方（以 rect 中心旋轉 180°）。 */
export function placePolygon(poly: readonly P[], maskW: number, maskH: number, rect: { x: number; y: number; w: number; h: number }, rotate180 = false): P[] {
  const s = Math.min(rect.w / maskW, rect.h / maskH), ox = rect.x + (rect.w - maskW * s) / 2, oy = rect.y + (rect.h - maskH * s) / 2, cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  return poly.map((p) => { const x = ox + p[0] * s, y = oy + p[1] * s; return rotate180 ? [2 * cx - x, 2 * cy - y] as P : [x, y] as P; });
}

// ---------------------------------------------------------------- 染色（純像素；回傳新陣列，不改來源）
export function hexRgb(hex: string): [number, number, number] { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
/**
 * 中性銀白素材 → 指定色：以亮度 L 上色。兩種像素保留原色（不染）：①暖色像素（骨頭的象牙白：R 明顯高於 B）②極亮高光。
 * 結果：纖維帶藍／紅，骨架維持骨白（目標圖的特徵）。brightness：整體亮度倍率。alphaGain：不透明度倍率（正式素材 alpha 最高 253、大多半透明，
 * 疊在深色底上偏淡時可提高；1＝原樣）。回傳新陣列，不修改來源。
 */
export function tintPixels(src: ArrayLike<number>, hex: string, brightness = 0.85, keepWhite = 0.75, alphaGain = 1): Uint8ClampedArray {
  const [cr, cg, cb] = hexRgb(hex), out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2], L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const w = Math.min(1, Math.max(0, (L - keepWhite) / (1 - keepWhite))), hi = w * w * (3 - 2 * w);
    const warm = Math.min(1, Math.max(0, ((r - b) / 255 - 0.04) / 0.08));      // 骨頭（暖白）保留
    const k = Math.max(hi, warm);
    out[i] = Math.min(255, (cr * L * 1.35 * (1 - k) + r * k) * brightness);
    out[i + 1] = Math.min(255, (cg * L * 1.35 * (1 - k) + g * k) * brightness);
    out[i + 2] = Math.min(255, (cb * L * 1.35 * (1 - k) + b * k) * brightness);
    out[i + 3] = Math.min(255, Math.round(src[i + 3] * alphaGain));
  }
  return out;
}
/** 最大外框輪廓（未簡化）的面積＝「外框內補滿洞後」alpha>thr 的像素數。用來驗簡化精度（主 session 2026-10-18 裁定的驗收口徑 A）。 */
export function outerRingArea(m: Mask, thr = 127): number {
  const rings = contours(m, thr).map((r) => signedArea(r)).filter((a) => a > 0);
  return rings.length ? Math.max(...rings) : 0;
}
