// 共用型別。研究候選規則以旗標表示，任何一個都不是正式規則。
import type { OrganKey } from './content.ts';

export type Who = 'P' | 'E';
export type Side = 'L' | 'R';
export type PH = 'PH-A' | 'PH-B' | 'PH-M' | 'PH-C';
export type SO = 'SO-1' | 'SO-2' | 'SO-3';
export type HS = 'HS-1' | 'HS-2';
/** 毒囊 Incision 對非執刀者的 2 點是否可被鏡膜反射（R3-Q9 未裁定，兩種都實作） */
export type SEM = 'SEM-1' | 'SEM-2';

export interface Rules {
  ph: PH;
  so: SO;
  hs: HS;
  sem: SEM;
}

export interface Organ {
  id: number;
  key: OrganKey;
  x: number;
  y: number;
}

export type DmgKind = 'INC_DIRECT' | 'INC_POISON' | 'INC_POISON_SELF' | 'HARV_DIRECT' | 'CORE' | 'SELF_POISON' | 'REFLECT';
export const KIND_ORDER: DmgKind[] = ['INC_DIRECT', 'INC_POISON', 'INC_POISON_SELF', 'HARV_DIRECT', 'CORE', 'SELF_POISON', 'REFLECT'];

export type ChoiceReason =
  | 'SURVIVAL' | 'SO-1' | 'SO-2' | 'SO-3' | 'PREF' | 'BAND' | 'TIE-v' | 'TIE-area' | 'TIE-fixed' | 'FORCED'
  | 'OBSESSION'; // FUN-EXP-01 掛鉤 X-T1

/** 敵人設定（R2 §4.3、天賦支線、R3 INT-10）。w10＝權重×10。 */
export type EnemyConfig =
  | { kind: 'BOSS' }
  | { kind: 'BUT' | 'JUD' | 'KNG'; w10: number }
  | { kind: 'OBS_HEART' | 'OBS_AREA'; w10: number } // FUN-EXP-01 掛鉤 X-T2
  | { kind: 'TALENT'; talent: TalentKey; mode: 'weighted'; w10: number }
  | { kind: 'TALENT'; talent: TalentKey; mode: 'band'; delta: number }
  | { kind: 'CONDITIONAL'; note: string };

/** 天賦支線的 T1 噬心、T2 骨骼、T3 繁殖（與開工指令的 T0–T3 選邊模式不同，後者在本程式稱 SEL-*） */
export type TalentKey = 'heart' | 'bone' | 'breed' | 'heart+bone';

export type Ev =
  | { t: 'RS'; round: number }
  | { t: 'SPAWN'; id: number; key: OrganKey; x: number; y: number; src: 'NEW' | 'SEEDLING' | 'CORE'; side?: Side }
  | { t: 'SPAWN_FAIL'; key: OrganKey }
  | { t: 'SPAWN_CAND_OOR'; idx: number }
  | { t: 'ANCHORS'; count: number; unplaceable: number }
  | { t: 'CUT'; i: number; j: number; legal: boolean; reason?: string }
  | { t: 'PIERCE'; id: number }
  | { t: 'INC'; id: number; effect: 'SPAWN_CORES' | 'SCHEDULE_SEEDLING' | 'DESTROY' }
  | { t: 'STEP'; name: 'INCISION' | 'HARVEST' | 'ALL' | 'PLAYER' | 'ENEMY' }
  | { t: 'STEP'; name: 'TEAR' } // FUN-EXP-01 掛鉤 X-T5（只有實驗 B 撕裂會發出）
  | { t: 'SHIELD'; who: Who; n: number; organ: number }
  | { t: 'HEAL'; who: Who; raw: number; actual: number; organ: number }
  | { t: 'DMG'; src: Who; dst: Who; kind: DmgKind; raw: number; abs: number; loss: number; organ: number }
  | { t: 'REFL'; who: Who; base: number; pct: number; amount: number }
  | { t: 'DC'; pDead: boolean; eDead: boolean }
  | { t: 'CHOICE'; side: Side; reason: ChoiceReason; basis: ChoiceBasis | null }
  | { t: 'RE'; shieldP: number; shieldE: number }
  | { t: 'WOUND'; op: 'KEEP' | 'TEAR' | 'HEAL'; organs: number[]; copies?: number[] } // FUN-EXP-01 掛鉤 X-T3
  | { t: 'CAP_EXCEEDED' }
  | { t: 'END'; result: Result; sd1: boolean };

export type Result = 'WIN' | 'LOSS' | 'STALL' | 'INVALID';

export interface SideFacts {
  pLoss: number;
  eLoss: number;
  v: number; // 從 AI 角度：玩家 HP 損失 − AI HP 損失
  lethal: boolean;
  area2: number;
  pNum: number;
  pDen: number;
  U: number;
  hearts?: number; // FUN-EXP-01 掛鉤 X-T4
}

export interface ChoiceBasis {
  L: SideFacts;
  R: SideFacts;
  fixedSide: Side;
}
