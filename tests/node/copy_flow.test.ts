// duel v0.6 FT-06（Node 可驗部分）：複製流程決策純函式。計時器全用注入的假計時器，不真等 1 秒。瀏覽器的剪貼簿／iframe 部分另驗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY_TIMEOUT_DEFAULT_MS, runCopy } from '../../src/cutbattle/copy_flow.ts';

/** 假計時器：記錄排程、手動觸發。 */
function fakeTimers() {
  const q: { fn: () => void; ms: number; cleared: boolean }[] = [];
  return {
    q, setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; q.push(t); return t; },
    clearTimer: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
    fire: () => { for (const t of q) if (!t.cleared) t.fn(); },
  };
}
const flush = () => new Promise<void>((r) => setImmediate(r));

test('FT-06 writeText resolve → copied，且收掉逾時計時器；文字原樣傳入、同步呼叫', async () => {
  const ft = fakeTimers(); let got: string | null = null;
  const p = runCopy('全文\n```json\n[]\n```', { writeText: (t) => { got = t; return Promise.resolve(); }, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  assert.equal(got, '全文\n```json\n[]\n```', 'writeText 必須在呼叫當下同步執行（Safari 要求在使用者手勢內）');
  assert.equal(await p, 'copied');
  assert.equal(ft.q.length, 1); assert.equal(ft.q[0].cleared, true); assert.equal(ft.q[0].ms, COPY_TIMEOUT_DEFAULT_MS); assert.equal(COPY_TIMEOUT_DEFAULT_MS, 1000);
});
test('FT-06 writeText reject → fallback', async () => {
  const ft = fakeTimers();
  assert.equal(await runCopy('x', { writeText: () => Promise.reject(new Error('NotAllowedError')), setTimer: ft.setTimer, clearTimer: ft.clearTimer }), 'fallback');
});
test('FT-06 writeText 永不 resolve → 逾時 fallback（假計時器觸發，不真等）', { timeout: 3000 }, async () => {
  const ft = fakeTimers(); let settled: string | null = null;
  const p = runCopy('x', { writeText: () => new Promise<void>(() => { /* 永不 resolve */ }), setTimer: ft.setTimer, clearTimer: ft.clearTimer }).then((r) => { settled = r; });
  await flush(); assert.equal(settled, null, '逾時前還在等');
  ft.fire(); await p; assert.equal(settled, 'fallback');
});
test('FT-06 逾時後才 resolve 的 writeText 不會把結果翻成 copied', { timeout: 3000 }, async () => {
  const ft = fakeTimers(); let res!: () => void;
  const p = runCopy('x', { writeText: () => new Promise<void>((r) => { res = r; }), setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  ft.fire(); res(); assert.equal(await p, 'fallback');
});
test('FT-06 writeText 不存在（undefined／null／非函式）→ fallback，且不排程計時器', async () => {
  for (const w of [undefined, null, 'nope' as unknown as undefined]) {
    const ft = fakeTimers();
    assert.equal(await runCopy('x', { writeText: w, setTimer: ft.setTimer, clearTimer: ft.clearTimer }), 'fallback');
    assert.equal(ft.q.length, 0);
  }
});
test('FT-06 writeText 同步丟例外 → fallback（不拋出）', async () => {
  const ft = fakeTimers();
  assert.equal(await runCopy('x', { writeText: () => { throw new Error('SecurityError'); }, setTimer: ft.setTimer, clearTimer: ft.clearTimer }), 'fallback');
  assert.equal(ft.q[0].cleared, true);
});
test('FT-06 不傳計時器時用真的 setTimeout：永不 resolve + timeoutMs=20 → 約 20ms 後 fallback', { timeout: 3000 }, async () => {
  const t0 = Date.now();
  assert.equal(await runCopy('x', { writeText: () => new Promise<void>(() => {}), timeoutMs: 20 }), 'fallback');
  assert.ok(Date.now() - t0 < 1000);
});
test('copy_flow.ts 零 DOM：不碰 document／window／navigator', () => {
  const src = readFileSync(new URL('../../src/cutbattle/copy_flow.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\b(document|window|navigator|localStorage)\b/.test(src), false);
});
