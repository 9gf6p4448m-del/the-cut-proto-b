// 敵人選邊（R2 §4.3、§14.13；R3 INT-10；天賦支線 TALENT_SELECTION_RESEARCH §4）。
// 可替換的策略：BOSS（理性）、性格加權（BUT/JUD/KNG）、天賦加權、天賦執念帶；條件式天賦只留接口。
import { clip } from './int.ts';
import type { Content } from './content.ts';
import type { ChoiceBasis, ChoiceReason, EnemyConfig, Organ, SO, Side, SideFacts, TalentKey } from './types.ts';

export class NotImplemented extends Error {}

const TALENT_TYPES: Record<TalentKey, string[]> = {
  heart: ['heart', 'regen'],
  bone: ['shield', 'mirror'],
  breed: ['regen', 'fission', 'core'],
  'heart+bone': ['heart', 'regen', 'shield', 'mirror'],
};

/** 偏好的分子與分母（兩側共用分母）。 */
export function preference(enemy: EnemyConfig, keep: Organ[], area2: number, area2Total: number, content: Content): [number, number] {
  switch (enemy.kind) {
    case 'BOSS':
      return [0, 1];
    case 'BUT':
      return [keep.reduce((s, o) => s + content.byKey[o.key].attack, 0), 20];
    case 'JUD':
      return [keep.length % 2 === 0 ? 1 : 0, 1];
    case 'KNG':
      return [area2, area2Total];
    case 'TALENT': {
      const types = TALENT_TYPES[enemy.talent];
      const n = keep.filter((o) => types.includes(o.key)).length;
      return [n, enemy.talent === 'heart+bone' ? 4 : 2];
    }
    case 'CONDITIONAL':
      throw new NotImplemented(`條件式天賦尚未定義：${enemy.note}`);
  }
}

export function w10Of(enemy: EnemyConfig): number {
  if (enemy.kind === 'BOSS') return 0;
  if (enemy.kind === 'TALENT') return enemy.mode === 'weighted' ? enemy.w10 : 0;
  if (enemy.kind === 'CONDITIONAL') return 0;
  return enemy.w10;
}

/** INT-10：U = w10·40·min(p_num,p_den) + (10−w10)·p_den·clip(v+20,0,40)。 */
export function scoreU(w10: number, pNum: number, pDen: number, v: number): number {
  if (!Number.isInteger(w10) || w10 < 0 || w10 > 10) throw new RangeError(`w10 必須是 0–10 的整數：${w10}`);
  return w10 * 40 * Math.min(pNum, pDen) + (10 - w10) * pDen * clip(v + 20, 0, 40);
}

export interface ChoiceResult {
  side: Side;
  reason: ChoiceReason;
  basis: ChoiceBasis;
}

function cmp(a: number, b: number): number {
  return a > b ? 1 : a < b ? -1 : 0;
}

/** 平常的評分鏈：主鍵 → v → 面積 → 固定側。 */
function normalChain(enemy: EnemyConfig, L: SideFacts, R: SideFacts, fixed: Side): { side: Side; reason: ChoiceReason } {
  if (enemy.kind === 'TALENT' && enemy.mode === 'band') {
    if (Math.abs(L.v - R.v) <= enemy.delta) {
      const c = cmp(L.pNum, R.pNum);
      if (c !== 0) return { side: c > 0 ? 'L' : 'R', reason: 'BAND' };
      const cv = cmp(L.v, R.v);
      if (cv !== 0) return { side: cv > 0 ? 'L' : 'R', reason: 'TIE-v' };
    } else {
      return { side: L.v > R.v ? 'L' : 'R', reason: 'PREF' };
    }
  } else {
    const cu = cmp(L.U, R.U);
    if (cu !== 0) return { side: cu > 0 ? 'L' : 'R', reason: 'PREF' };
    const cv = cmp(L.v, R.v);
    if (cv !== 0) return { side: cv > 0 ? 'L' : 'R', reason: 'TIE-v' };
  }
  const ca = cmp(L.area2, R.area2);
  if (ca !== 0) return { side: ca > 0 ? 'L' : 'R', reason: 'TIE-area' };
  return { side: fixed, reason: 'TIE-fixed' };
}

/** 求生覆寫（R2 §5.3、§14.13）＋評分鏈。 */
export function choose(enemy: EnemyConfig, so: SO, L: SideFacts, R: SideFacts, fixed: Side): ChoiceResult {
  const basis: ChoiceBasis = { L, R, fixedSide: fixed };
  if (L.lethal !== R.lethal) return { side: L.lethal ? 'R' : 'L', reason: 'SURVIVAL', basis };
  if (L.lethal && R.lethal) {
    if (so === 'SO-1') return { side: normalChain(enemy, L, R, fixed).side, reason: 'SO-1', basis };
    const c = cmp(L.pLoss, R.pLoss);
    if (c !== 0) {
      const wantMax = so === 'SO-2';
      return { side: (c > 0) === wantMax ? 'L' : 'R', reason: so, basis };
    }
  }
  const r = normalChain(enemy, L, R, fixed);
  return { side: r.side, reason: r.reason, basis };
}
