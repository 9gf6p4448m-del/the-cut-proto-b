// duel2（v0.2 美術合併，DL-083）的盤面幾何：已確認獸身邊界 → 世界座標多邊形；與畫面上素材的放置用同一個 rect 與同一套換算（boundaryToWorld），所以邊界與畫面對齊。
import { boundaryToWorld } from '../art/boundary.ts';
import type { Side, V } from '../rtcut/rules.ts';
import { BEAST_BOUNDARY } from './beast_boundary.ts';

export const ASSET_W = 768, ASSET_H = 1152;      // 正式本體素材尺寸（與 1024×1536 等比例，正規化座標相同）
/** 兩獸素材放置的矩形（世界座標 700×1000）：藍在下、紅在上；紅方以 rect 中心旋轉 180°；中段 y 360～640 交疊。 */
export const RECTS: Record<Side, { x: number; y: number; w: number; h: number }> = {
  blue: { x: 30, y: 360, w: 640, h: 640 },
  red: { x: 30, y: 0, w: 640, h: 640 },
};
export const BODY2: Record<Side, V[]> = {
  blue: boundaryToWorld(BEAST_BOUNDARY.vertices, ASSET_W, ASSET_H, RECTS.blue) as V[],
  red: boundaryToWorld(BEAST_BOUNDARY.vertices, ASSET_W, ASSET_H, RECTS.red, true) as V[],
};
