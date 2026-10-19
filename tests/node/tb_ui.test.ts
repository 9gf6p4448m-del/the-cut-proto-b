// duel v0.6 FT-03（Node 可驗部分）：平手畫面文字純函式＋duel6_main.ts 靜態斷言。瀏覽器部分另驗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIE_NOTE, TIE_NOTE_KEY, parseDevTie, takeTieNote, tieBannerSub, tieButton, tieTitle } from '../../src/cutbattle/tie_text.ts';
import { finishStage, newCampaign, tieOutcome } from '../../src/cutbattle/campaign.ts';
import { simulateBattle } from '../../src/cutbattle/battle.ts';

const mkTb = (blue: number, red: number) => ({ blue, red, result: tieOutcome({ blue, red }) });
const CASES = [
  { blue: 5, red: 4, title: '平手，切除數 5：4，勝！', btn: null },
  { blue: 3, red: 4, title: '平手，切除數 3：4，敗', btn: null },
  { blue: 4, red: 4, title: '平手，切除數 4：4，重打這一場', btn: '重打' },
];
test('FT-03 橫幅副字／結算標題／按鈕字逐字符合，橫幅與標題數字相同', () => {
  for (const c of CASES) {
    const t = mkTb(c.blue, c.red);
    assert.equal(tieBannerSub(t), `比切除數 你 ${c.blue}：${c.red} 對手`);
    assert.equal(tieTitle(t), c.title);
    assert.equal(tieButton(t), c.btn);
    const nums = (s: string) => s.match(/\d+：\d+/)![0];
    assert.equal(nums(tieBannerSub(t)!), nums(tieTitle(t)!));
    assert.ok(tieBannerSub(t)!.includes('切除數') && tieTitle(t)!.includes('切除數'));
  }
});
test('FT-03 非平手回傳 null（畫面不變）：經 finishStage 實際走一遍', () => {
  const base = simulateBattle([{ side: 'blue', id: 'b', kind: 'claw' }, { side: 'red', id: 'r', kind: 'heart' }], 1);
  const c = newCampaign(8, undefined, undefined, undefined, { tieBreak: true });
  for (const w of ['blue', 'red'] as const) {
    const t = finishStage(c, [], { ...base, winner: w }, [], { blue: 4, red: 4 }).history.at(-1)!.tiebreak;
    assert.equal(t, undefined); assert.equal(tieBannerSub(t), null); assert.equal(tieTitle(t), null); assert.equal(tieButton(t), null);
  }
  const d = finishStage(c, [], { ...base, winner: 'draw' }, [], { blue: 5, red: 4 }, true).history.at(-1)!.tiebreak!;
  assert.deepEqual(d, { blue: 5, red: 4, result: 'win', forced: true });
  assert.equal(tieTitle(d), CASES[0].title);
});
test('FT-03 devtie 參數解析：只認三個值', () => {
  assert.deepEqual([parseDevTie('win'), parseDevTie('loss'), parseDevTie('replay')], [{ blue: 5, red: 4 }, { blue: 3, red: 4 }, { blue: 4, red: 4 }]);
  for (const v of [null, undefined, '', 'WIN', 'draw', 'win ']) assert.equal(parseDevTie(v), null);
  for (const k of ['win', 'loss', 'replay'] as const) { const s = parseDevTie(k)!; assert.equal(mkTb(s.blue, s.red).result, k); }
});
test('FT-03 第一次平手說明：只一次；儲存丟例外不拋出、可再顯示；key 用 duel6- 前綴', () => {
  const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(takeTieNote(st), true); assert.equal(takeTieNote(st), false); assert.ok(TIE_NOTE_KEY.startsWith('duel6-'));
  assert.equal(TIE_NOTE, '平手時比切割期切掉的數量，一樣就重打。');
  const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('y'); } };
  assert.equal(takeTieNote(bad), true); assert.equal(takeTieNote(bad), true);
  const readOk = { getItem: () => null, setItem: () => { throw new Error('y'); } };
  assert.equal(takeTieNote(readOk), true);
});

const SRC = readFileSync(new URL('../../src/duel6_main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('靜態：主程式沒有自己比切除數（無 severedN 的 > <）', () => {
  assert.equal(/severedN[^;\n]*[<>]|[<>][^;\n=]*severedN/.test(SRC.replace(/=>/g, '')), false);
  assert.equal(/\btieSev\b[^;\n]*[<>]/.test(SRC.replace(/=>/g, '')), false);
  assert.equal(/\.(blue|red)\s*[<>]=?\s*[\w.]*\.(blue|red)\b/.test(SRC.replace(/=>/g, '')), false);
});
test('靜態：devTieHits++ 只出現一次，且在 if (DEV_TIE) { 守衛內', () => {
  assert.equal((SRC.match(/devTieHits\+\+/g) ?? []).length, 1);
  assert.match(SRC, /if \(DEV_TIE\) \{\s*devTieHits\+\+;/);
});
