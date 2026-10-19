// duel6 複製流程決策（純函式、零 DOM）：clipboard.writeText 成功＝'copied'；拒絕／不存在／逾時（Promise 永不 resolve）／同步丟例外＝'fallback'（主程式改出唯讀 textarea）。
// 計時器可注入（Node 測試不真等 1 秒）。writeText 必須由呼叫端在使用者手勢內同步呼叫——本函式一進來就呼叫它，中間沒有任何 await。
export type CopyOutcome = 'copied' | 'fallback';
export interface CopyFlowOpts {
  writeText: ((text: string) => Promise<void>) | null | undefined;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}
export const COPY_TIMEOUT_DEFAULT_MS = 1000;
export function runCopy(text: string, o: CopyFlowOpts): Promise<CopyOutcome> {
  const w = o.writeText;
  if (typeof w !== 'function') return Promise.resolve('fallback');
  const set = o.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clr = o.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  return new Promise<CopyOutcome>((resolve) => {
    let done = false;
    const fin = (r: CopyOutcome): void => { if (done) return; done = true; clr(timer); resolve(r); };
    const timer = set(() => fin('fallback'), o.timeoutMs ?? COPY_TIMEOUT_DEFAULT_MS);
    let p: Promise<void>;
    try { p = w(text); } catch { fin('fallback'); return; }
    Promise.resolve(p).then(() => fin('copied'), () => fin('fallback'));
  });
}
