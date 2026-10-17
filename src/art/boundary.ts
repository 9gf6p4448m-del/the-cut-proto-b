// 獸身「玩法邊界」資料格式（主 session 2026-10-18 定位）：由素材 alpha 算出的多邊形只是「候選」（beast_boundary.candidate.json），
// 遊戲判定只讀「已確認邊界」（beast_boundary.json，由主 session 或製作人確認候選後產生）。同一隻怪換造型時共用同一份已確認邊界。
// 座標一律為「素材正規化座標」：u＝x／素材寬、v＝y／素材高（0～1），與畫面解析度無關；放進遊戲時用 boundaryToWorld 換成世界座標。
import type { P } from './polygon.ts';

export interface BoundaryCandidate {
  version: 1; kind: 'candidate';
  source: { asset: string; width: number; height: number };
  params: { thr: number; downsample: number; maxVerts: number };
  vertices: [number, number][];              // 素材正規化座標，順時針或逆時針皆可
  stats: { verts: number; simplifyErrPct: number; vsPorousAlphaPct: number };
}
export interface BoundaryConfirmed {
  version: 1; kind: 'confirmed';
  beast: string;                             // 怪獸代號（換造型時共用同一份）
  vertices: [number, number][];              // 素材正規化座標
  confirmedBy: string; confirmedAt: string;  // 誰、何時確認（ISO 日期）
  fromCandidate?: string;                    // 由哪份候選修改而來（檔名或版本）
}

function segX(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** 檢查已確認邊界：3～64 個頂點、座標在 0～1、面積 >0、邊不自交。回傳錯誤清單（空＝合法）。不修改輸入。 */
export function validateBoundary(b: Readonly<BoundaryConfirmed>): string[] {
  const e: string[] = [], v = b.vertices as readonly P[];
  if (b.version !== 1 || b.kind !== 'confirmed') e.push('version／kind 不對');
  if (!b.beast) e.push('缺 beast');
  if (!Array.isArray(v) || v.length < 3) { e.push('頂點少於 3'); return e; }
  if (v.length > 64) e.push(`頂點 ${v.length} > 64`);
  if (v.some((p) => !Array.isArray(p) || p.length !== 2 || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1))) e.push('座標必須在 0～1');
  let s = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; s += p[0] * q[1] - q[0] * p[1]; } if (Math.abs(s) / 2 <= 0) e.push('面積為 0');
  for (let i = 0; i < v.length; i++) for (let j = i + 2; j < v.length; j++) { if (i === 0 && j === v.length - 1) continue; if (segX(v[i], v[(i + 1) % v.length], v[j], v[(j + 1) % v.length])) { e.push(`邊 ${i} 與邊 ${j} 自交`); return e; } }
  return e;
}
/** 正規化邊界 → 遊戲世界座標：素材在 rect 內等比置中（與 sprites.ts 的 drawBodySprite 同一套換算）；rotate180＝紅方。 */
export function boundaryToWorld(vertices: readonly [number, number][], assetW: number, assetH: number, rect: { x: number; y: number; w: number; h: number }, rotate180 = false): P[] {
  const s = Math.min(rect.w / assetW, rect.h / assetH), ox = rect.x + (rect.w - assetW * s) / 2, oy = rect.y + (rect.h - assetH * s) / 2, cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  return vertices.map(([u, v]) => { const x = ox + u * assetW * s, y = oy + v * assetH * s; return rotate180 ? [2 * cx - x, 2 * cy - y] as P : [x, y] as P; });
}
