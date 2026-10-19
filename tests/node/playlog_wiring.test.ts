// duel v0.6 步驟 6：duel6_main.ts 與試玩紀錄的接線——靜態行為斷言（Node、零 DOM）。每條斷言都附「拔掉守衛的突變必須紅」。
// 瀏覽器才能驗的部分（FT-04 逐欄對帳、FT-05 重新整理／關頁、FT-06 剪貼簿與 iframe、FT-07 開關比對）不在這裡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/duel6_main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HTML = readFileSync(new URL('../../public-duel6/index.html', import.meta.url), 'utf8');

/** 劃刀事件處理路徑：stepOnce／事件處理函式／指標輸入處理／startBattle（stepOnce 會呼叫它）。 */
const STROKE_STARTS = [
  'function stepOnce(', 'function severFx(', 'function onCutEvent(', 'function onFreeEvent(', 'function tutOnFree(', 'function startBattle(',
  'function alignTs(', 'function pushEv(', "els.canvas.addEventListener('pointerdown'", "els.canvas.addEventListener('pointermove'", 'const endDrag = ',
];
/** 取出自 start 起、到第一個「行首的 }」收尾（本檔函式本體縮排兩格，結尾 } 在行首）的整段文字。 */
function block(src: string, start: string): string {
  const i = src.indexOf(start); if (i < 0) return '';
  const m = /\n\}[);]*(?=\n)/.exec(src.slice(i)); return m ? src.slice(i, i + m.index + m[0].length) : '';
}
const FORBID = /localStorage|sessionStorage|setItem\b|getItem\b|\bplaylog\b|createPlaylog|\bbeginRun\b|\bendStage\b|\bsetStitch\b|\bendRun\b|\babandonIfOpen\b|\bpersist\b/;
/** 回傳違規清單：劃刀路徑函式缺失／太短（抽取失敗＝恆真保護）或含儲存／紀錄寫入。 */
function strokePathViolations(src: string): string[] {
  const bad: string[] = [];
  for (const s of STROKE_STARTS) {
    const b = block(src, s);
    if (b.length < 150) { bad.push(`抽不到函式本體：${s}`); continue; }
    const m = FORBID.exec(b); if (m) bad.push(`${s} 內含 ${m[0]}`);
  }
  return bad;
}
test('靜態：劃刀事件處理路徑內沒有 localStorage／setItem／playlog 寫入呼叫', () => {
  assert.deepEqual(strokePathViolations(SRC), []);
});
test('突變：在 stepOnce／onFreeEvent／pointermove 裡塞寫入呼叫 → 必須被抓到（紅）', () => {
  const inject = (start: string, code: string) => { const i = SRC.indexOf(start); assert.ok(i >= 0, start); const j = SRC.indexOf('\n', i); return SRC.slice(0, j + 1) + `  ${code}\n` + SRC.slice(j + 1); };
  for (const [start, code] of [
    ['function stepOnce(', 'playlog.endStage(null as never);'], ['function onFreeEvent(', "localStorage.setItem('x', 'y');"],
    ["els.canvas.addEventListener('pointermove'", 'playlog.setStitch(null as never);'], ['function onCutEvent(', "try { localStorage.getItem('k'); } catch { /* */ }"],
  ] as const) assert.notDeepEqual(strokePathViolations(inject(start, code)), [], `${start} 塞 ${code} 沒被抓到`);
  assert.notDeepEqual(strokePathViolations(SRC.replace('function stepOnce(', 'function stepOnceX(')), [], '抽取失敗必須算違規（防恆真）');
});
test('靜態：紀錄的寫入型呼叫各只在預期的一處（beginRun／endStage／setStitch／endRun／abandonIfOpen）', () => {
  const count = (re: RegExp) => (SRC.match(re) ?? []).length;
  for (const m of ['beginRun', 'endStage', 'setStitch', 'endRun', 'abandonIfOpen', 'clear']) assert.equal(count(new RegExp(`playlog\\.${m}\\(`, 'g')), 1, m);
  assert.equal(count(/playlog\.setTutorial\(/g), 3);   // 示範自然結束、按跳過（按鈕／測試掛勾）
});
test('靜態：confirm() 不出現（主程式與頁面）；清除走 pressClear／tickClear 狀態機', () => {
  assert.equal(/\bconfirm\s*\(/.test(SRC), false); assert.equal(/\bconfirm\s*\(/.test(HTML), false);
  assert.equal(/\bconfirm\s*\(/.test(SRC.replace('function stepOnce(', 'confirm("x"); function stepOnce(')), true, '突變：塞進 confirm( 必須被偵測到');
  assert.match(SRC, /pressClear\(clearSt/); assert.match(SRC, /tickClear\(clearSt/);
});

/** 從 s[open]（必須是 '(' 或 '{'）起找到配對的收尾位置（回傳收尾字元的索引；找不到＝-1）。字串內的括號不特別處理（本檔 push 內容沒有不成對括號）。 */
function matchEnd(s: string, open: number): number {
  const o = s[open], c = o === '(' ? ')' : '}'; let d = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === o) d++; else if (s[i] === c && --d === 0) return i; }
  return -1;
}
const PUSH = /DEVLOG!?\.push\(/g;
/** devlog 守衛：__duel6Test 只賦值一次、且該行以 if (DEVLOG) 起頭；每個 DEVLOG.push 都直接受同一行的 if (DEVLOG…) 守衛（緊接或在其 { } 區塊內）；devlog 參數 === '1'；push 的引數不經 playlog。 */
function devlogViolations(src: string): string[] {
  const bad: string[] = [];
  const assigns = src.split('\n').filter((l) => /__duel6Test\s*[:=]/.test(l) && !/^\s*\/\//.test(l));
  if (assigns.length !== 1) bad.push(`__duel6Test 賦值行數 ${assigns.length}（應為 1）`);
  else if (!/^\s*if \(DEVLOG\) /.test(assigns[0])) bad.push('__duel6Test 賦值沒有 if (DEVLOG) 守衛');
  let n = 0;
  for (const l of src.split('\n')) {
    for (const m of l.matchAll(PUSH)) {
      n++; const at = m.index!;
      let g = -1; for (const gm of l.slice(0, at).matchAll(/if \((?:[^()]*&&\s*)?DEVLOG\b/g)) g = gm.index!;   // if (DEVLOG) 或 if (... && DEVLOG)
      let ok = false;
      if (g >= 0) {
        const ce = matchEnd(l, g + 3);   // if 條件的收尾 )
        if (ce >= 0 && ce < at) {
          const rem = l.slice(ce + 1, at).trim();
          const bal = (rem.match(/\{/g) ?? []).length - (rem.match(/\}/g) ?? []).length;
          ok = rem === '' || (rem.startsWith('{') && bal > 0);
        }
      }
      if (!ok) bad.push(`無守衛的 DEVLOG.push：${l.trim().slice(0, 70)}`);
      const pe = matchEnd(l, at + m[0].length - 1);
      if (pe >= 0 && /playlog/.test(l.slice(at, pe))) bad.push(`事件流經過 playlog：${l.trim().slice(0, 70)}`);
    }
  }
  if (n < 15) bad.push(`DEVLOG.push 共 ${n} 處，太少，抽取可能失敗`);
  if (!/const DEVLOG: DevEv\[\] \| null = new URLSearchParams\(location\.search\)\.get\('devlog'\) === '1' \? \[\] : null;/.test(src)) bad.push('DEVLOG 沒有只在 ?devlog=1 建立');
  return bad;
}
test('靜態：__duel6Test 事件流只在 ?devlog=1 守衛內建立、每個 push 都有守衛、不經 playlog', () => {
  assert.deepEqual(devlogViolations(SRC), []);
});
test('突變：拿掉守衛／放寬 devlog 條件／push 改經 playlog → 必須被抓到（紅）', () => {
  const mut = (a: string, b: string) => { assert.ok(SRC.includes(a), a); return SRC.replace(a, b); };
  assert.notDeepEqual(devlogViolations(mut('if (DEVLOG) (window as unknown as { __duel6Test', '(window as unknown as { __duel6Test')), [], '拿掉建立處的守衛');
  assert.notDeepEqual(devlogViolations(mut("get('devlog') === '1' ? [] : null", "get('devlog') === '1' ? [] : []")), [], 'DEVLOG 變成恆建立');
  assert.notDeepEqual(devlogViolations(mut("DEVLOG.push({ k: 'fast', bClock: G.bClock })", "DEVLOG.push({ k: 'fast', bClock: playlog.runs.length })")), [], 'push 行混入 playlog');
  assert.notDeepEqual(devlogViolations(mut("if (DEVLOG) DEVLOG.push({ k: 'restart'", "DEVLOG!.push({ k: 'restart'")), [], '某個 push 沒守衛');
});
test('靜態：選怪獸／結果畫面按鈕與 textarea 後備存在（頁面與主程式）', () => {
  for (const id of ['copyEnd', 'logBtn', 'logPanel', 'logCopy', 'logClear', 'copyFb', 'copyTa', 'copyToast']) assert.match(HTML, new RegExp(`id="${id}"`), id);
  assert.match(HTML, /<textarea id="copyTa" readonly/);
  assert.match(SRC, /setSelectionRange\(0, ta\.value\.length\)/); assert.match(SRC, /已複製 \$\{n\} 局/); assert.match(SRC, /再按一次清除/);
});
