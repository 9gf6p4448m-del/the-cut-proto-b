// duel v0.6 G4：平手畫面文字（純函式、零 DOM）。判定不在這裡——blue/red/result 一律來自 campaign.ts 的 tieOutcome／finishStage 的 tiebreak。
// 規格：the-cut docs/fusion/DUEL_V06_TIE_LOG.md「一、平手比切除數」畫面。
import type { Tiebreak, TieResult } from './campaign.ts';

export type TieNums = Pick<Tiebreak, 'blue' | 'red' | 'result'>;
export const TIE_NOTE = '平手時比切割期切掉的數量，一樣就重打。';
export const TIE_NOTE_KEY = 'duel6-tienote-seen';
const SUFFIX: Record<TieResult, string> = { win: '勝！', loss: '敗', replay: '重打這一場' };
/** 戰鬥結束橫幅副字；沒有平手比數＝null（畫面維持原樣）。 */
export const tieBannerSub = (t: TieNums | null | undefined): string | null => t ? `比切除數 你 ${t.blue}：${t.red} 對手` : null;
/** 結算標題；沒有平手比數＝null。 */
export const tieTitle = (t: TieNums | null | undefined): string | null => t ? `平手，切除數 ${t.blue}：${t.red}，${SUFFIX[t.result]}` : null;
/** 結算按鈕字；只有重打時換字，其餘＝null（沿用原字）。 */
export const tieButton = (t: TieNums | null | undefined): string | null => t && t.result === 'replay' ? '重打' : null;

/** ?devtie= 測試參數：只認 win／loss／replay，其他＝null（不啟用）。回傳要強制的雙方切除數。 */
export const DEV_TIE_SEV: Record<TieResult, { blue: number; red: number }> = { win: { blue: 5, red: 4 }, loss: { blue: 3, red: 4 }, replay: { blue: 4, red: 4 } };
export function parseDevTie(v: string | null | undefined): { blue: number; red: number } | null {
  return v === 'win' || v === 'loss' || v === 'replay' ? { ...DEV_TIE_SEV[v] } : null;
}

/** 第一次平手說明：每台裝置一次。讀寫都包 try/catch；丟例外＝當作沒顯示過（可再顯示）、不拋出。回傳「這次要不要顯示」。 */
export function takeTieNote(store?: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  let seen = false;
  try { seen = (store ?? localStorage).getItem(TIE_NOTE_KEY) === '1'; } catch { seen = false; }
  if (seen) return false;
  try { (store ?? localStorage).setItem(TIE_NOTE_KEY, '1'); } catch { /* 寫不進去＝下次還會顯示 */ }
  return true;
}
