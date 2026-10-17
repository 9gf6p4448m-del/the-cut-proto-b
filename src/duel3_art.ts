// duel3 的美術介面（DL-084 分工：美術模組由 The cut2 在 art/ghostlight-kit 做，6292e09 已合併）。
// 這裡只做轉接：器官、場景調暗、刀痕、教學手、切除特效都用 src/art/sprites.ts 的 art-kit v3 函式。
import { CUT_DIM, drawDuelScene, drawOrganV3, drawTrail, drawTutorialHand, playFx2 } from './art/sprites.ts';
import type { Ctx, Dim, DuelSceneView, Fx2 } from './art/sprites.ts';

export type { OrganStateV3, TrailPt } from './art/sprites.ts';
export type SplitFx = Extract<Fx2, { type: 'split' }>;
export const PROVISIONAL = false;   // 已改用 art-kit v3 正式版本
export { CUT_DIM, drawOrganV3, drawTrail, drawTutorialHand };
/** 場景；dim＝切割期調暗本體（art-kit v3 的 DuelSceneView.dim）。 */
export function drawScene(ctx: Ctx, s: Readonly<DuelSceneView>, t: number, dim?: Readonly<Dim>): void {
  drawDuelScene(ctx, dim ? { ...s, dim } : s, t);
}
/** 切除：沿刀方向裂成兩半飛出（傳 body／rect 時一併本體閃白）。播完回傳 false。 */
export function playSplit(ctx: Ctx, f: Readonly<SplitFx>, t: number): boolean { return playFx2(ctx, f, t); }
