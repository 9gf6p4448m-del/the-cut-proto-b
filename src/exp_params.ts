// FUN-EXP-01 研究參數：測試盤面 seed 與實驗 A 的校準怪物 HP（未校準研究參數，不是正式數值）。
// 盤面：tools/exp/boards.ts 以真實引擎依規格 A §7／B §6 的機械條件篩出（X-8），`node tools/exp/boards.ts --verify` 可重跑。
// HP：規格 A v1.2——以 MAXPIERCE 勝率對齊 BASELINE（GRD 在所有 HP 皆約 100%，不能用來校準）：A1＝30、A2＝39。
// BASELINE 沒有專屬盤面條件，沿用 B 的三個 seed（同一敵人，方便對照）。
export type ExpModeId = 'BASELINE' | 'A1' | 'A2' | 'B';

export const EXP_PARAMS = {
  /** 每個模式的測試盤面 1～3（seed）。 */
  boards: {
    BASELINE: [800002, 800003, 800004],
    A1: [800007, 800001, 800111],
    A2: [800004, 800173, 800748],
    B: [800002, 800003, 800004],
  } as Record<ExpModeId, number[]>,
  /** 怪物 HP（透過引擎設定 hpE 傳入）。 */
  hpE: { BASELINE: 30, A1: 30, A2: 39, B: 30 } as Record<ExpModeId, number>,
  /** 玩家 HP（與 Baseline 相同，不校準）。 */
  hpP: 40,
} as const;
