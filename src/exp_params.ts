// FUN-EXP-01 研究參數（佔位）：測試盤面 seed 與實驗 A 的校準怪物 HP。
// 待第三階段數據填入：盤面 seed 由 tools/exp 以真實引擎依規格 §7／§6 的機械條件篩出（X-8），
// A1／A2 的 hpE 由 bot 校準（規格 A §5，整數 20～60）。以下只是佔位，不是篩選或校準結果。
export type ExpModeId = 'BASELINE' | 'A1' | 'A2' | 'B';

export const EXP_PARAMS = {
  /** 每個模式的測試盤面 1～3（seed）。佔位：golden 那組 2001／2003／2005。 */
  boards: {
    BASELINE: [2001, 2003, 2005],
    A1: [2001, 2003, 2005],
    A2: [2001, 2003, 2005],
    B: [2001, 2003, 2005],
  } as Record<ExpModeId, number[]>,
  /** 怪物 HP（透過引擎設定 hpE 傳入）。佔位：全部 30。 */
  hpE: { BASELINE: 30, A1: 30, A2: 30, B: 30 } as Record<ExpModeId, number>,
  /** 玩家 HP（與 Baseline 相同，不校準）。 */
  hpP: 40,
} as const;
