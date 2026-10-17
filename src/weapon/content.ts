// 「切下就是武器」內容：手臂、前肢、兩個固定靶（可見幾何，全部武器共用；不為任何武器個別調整）。
import { DEG } from './geom.ts';
import type { LimbDef, Rig, TargetDef, V } from './geom.ts';

/** 肩點、前臂長、揮動範圍（場景座標，y 向下；角度 0＝朝右，正＝往下＝順時針）。 */
export const RIG: Rig = { shoulder: [170, 660], forearm: 90, phiStart: -80 * DEG, phiEnd: 80 * DEG, step: 0.25 * DEG };

/** 前肢（前肢座標：根部在 x=0，爪尖朝 +x）。凸多邊形。 */
export const LIMB: LimbDef = {
  poly: [[0, -95], [420, -78], [580, -42], [640, 0], [580, 42], [420, 78], [0, 95]],
  base: [0, 0],
  organs: [
    { id: 'claw', name: '爪', c: [612, 4], r: 28 },
    { id: 'carapace', name: '甲殼', c: [250, 70], r: 24 }, // v2：甲殼移到前肢中段下緣（v1 在 [450,62]）
  ],
};

export const polar = (r: number, deg: number): V => [RIG.shoulder[0] + r * Math.cos(deg * DEG), RIG.shoulder[1] + r * Math.sin(deg * DEG)];
/** 環形扇區的四邊形（半徑 r1～r2、角度 a1～a2 度），凸。 */
export const sector = (r1: number, r2: number, a1: number, a2: number): V[] => [polar(r1, a1), polar(r2, a1), polar(r2, a2), polar(r1, a2)];

export const TARGETS: TargetDef[] = [
  // v2：v1 的內側擋板對任何凸形武器都會先被接縫端的肉碰到（揮擊是繞肩旋轉），改為只有外側擋板＝考長度
  { id: 'slit', name: '夾縫', spot: { c: polar(402, 4), r: 34 }, plates: [
    { id: 'outer', poly: sector(452, 700, -10, 2) },
  ] },
  // v2：蓋板從半徑 160 起（避開所有接縫角，接縫角永遠是肉），蓋住弱點所在半徑
  // v3：弱點外移到半徑 515、半徑 30（v2 在 487、34：碎板後爪尖下緣的肉比爪先碰到弱點）；蓋板延伸到 550
  { id: 'cover', name: '蓋板', spot: { c: polar(515, 9), r: 30 }, plates: [
    { id: 'cover', poly: sector(160, 550, 0, 4) },
  ] },
];
