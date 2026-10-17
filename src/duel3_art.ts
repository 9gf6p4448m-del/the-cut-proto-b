// duel3 的美術介面（DL-084 分工：美術模組由 The cut2 在 art/ghostlight-kit 做，介面雙方已約定）。
// 這裡先放暫用版本讓流程跑得起來；美術分支合併後改成直接轉出 src/art/sprites.ts 的同名函式。
import { drawDuelScene, drawOrganSprite } from './art/sprites.ts';
import type { Ctx, DuelSceneView, Img, Kind, OrganView, Side } from './art/sprites.ts';

export interface OrganStateV3 { mode: 'normal' | 'locked' | 'sprout'; cuttable?: boolean; lit?: number; target?: boolean; k?: number; label?: string }
export interface Dim { alpha: number; saturation: number }
export interface TrailPt { x: number; y: number; t: number; blunt?: boolean }
export interface SplitFx { type: 'split'; t0: number; im: Img; x: number; y: number; r: number; angle: number; side: Side; kind?: Kind }
export const PROVISIONAL = true;   // 暫用版本（美術合併後改 false）

/** 器官：素材本身＋陣營色外光邊（暫用：沿用 v2 sprite，不含圓框的版本待美術模組）。 */
export function drawOrganV3(ctx: Ctx, im: Img, o: Readonly<OrganView>, st: Readonly<OrganStateV3>, t: number): void {
  drawOrganSprite(ctx, im, { ...o, r: o.r / 1.05 }, { mode: st.mode, k: st.k, lit: st.lit, target: st.target, label: st.label }, t);
}
/** 場景；dim＝切割期調暗本體（暫用：降低亮度）。 */
export function drawScene(ctx: Ctx, s: Readonly<DuelSceneView>, t: number, dim?: Dim): void {
  drawDuelScene(ctx, dim ? { ...s, brightness: 0.8 * dim.alpha } : s, t);
}
/** 跟手的刀痕光帶：舊點淡出；鈍刀（blunt）灰暗。 */
export function drawTrail(ctx: Ctx, pts: readonly TrailPt[], now: number, blunt: boolean, life = 0.25): void {
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], age = now - b.t; if (age > life) continue;
    const k = 1 - age / life, bl = b.blunt ?? blunt;
    ctx.strokeStyle = bl ? `rgba(150,150,160,${0.45 * k})` : `rgba(240,247,255,${0.95 * k})`; ctx.lineWidth = (bl ? 3 : 6) * k + 1;
    if (!bl) { ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.restore();
}
export const SPLIT_DUR = 0.6;
export function splitHalves(f: Readonly<SplitFx>, t: number): [[number, number], [number, number]] {
  const k = Math.min(1, Math.max(0, (t - f.t0) / SPLIT_DUR)), e = 1 - (1 - k) * (1 - k), nx = Math.cos(f.angle + Math.PI / 2), ny = Math.sin(f.angle + Math.PI / 2), d = e * f.r * 1.6;
  return [[-nx * d, -ny * d + e * e * f.r], [nx * d, ny * d + e * e * f.r]];
}
/** 切除：沿刀方向裂成兩半飛出（暫用：沿用 v2 的 burst）。播完回傳 false。 */
export function playSplit(ctx: Ctx, f: Readonly<SplitFx>, t: number): boolean {
  const k = (t - f.t0) / SPLIT_DUR; if (k >= 1) return false; if (k < 0) return true;
  drawOrganSprite(ctx, f.im, { kind: f.kind ?? 'claw', side: f.side, x: f.x, y: f.y, r: f.r / 1.05 }, { mode: 'burst', k, cutAngle: f.angle }, t);
  return true;
}
/** 教學用的虛擬手（暫用：光點＋指尖圈）。 */
export function drawTutorialHand(ctx: Ctx, x: number, y: number, t: number, pressed: boolean): void {
  ctx.save();
  ctx.fillStyle = pressed ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
  ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(x, y, pressed ? 14 : 18, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 26 + 4 * Math.sin(t * 8), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
