// duel6 同步 duel5 審查修補（094fa3f：C2 穿刺連切進 cutByMe、C3 選怪獸清待開戰、倒數寫實際秒數）。Node、零 DOM、不開瀏覽器。
// 行為部分：真實 rules.ts 的 step 跑「選蛇＋穿刺連切 3 顆」，用 cut_collect.ts 收 cutByMe。靜態部分：duel6_main.ts 的接線。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, step } from '../../src/rtcut/rules.ts';
import type { GameEvent, GameState, Line, Mode, OrganDef, Side, V } from '../../src/rtcut/rules.ts';
import { toPieces } from '../../src/rtcut/freehand.ts';
import type { PtrEv } from '../../src/rtcut/freehand.ts';
import { BODY2, R3 } from '../../src/cutbattle/duel3_board.ts';
import { newCampaign, stitchOffer } from '../../src/cutbattle/campaign.ts';
import { collectCutKinds } from '../../src/cutbattle/cut_collect.ts';

const FRONT = { unit: 60, max: 4 };
const MS = 1000 / 60;
const mode: Mode = { knockout: true, regen: false, r: R3, front: FRONT, beasts: { blue: 'snake', red: 'dragon' } };
const org = (id: string, side: Side, p: V, kind: OrganDef['kind']): OrganDef => ({ id, side, kind, p });
const ORGANS = [org('B1', 'blue', [200, 700], 'claw'), org('R1', 'red', [350, 470], 'heart'), org('R2', 'red', [350, 390], 'poison'), org('R3', 'red', [350, 310], 'eye'), org('R4', 'red', [350, 230], 'bone')];
const game = (): GameState => ({ ...newGame(1, mode, ORGANS), aiNextFire: 10 ** 9, push: 0, skillUsed: { blue: false, red: false }, severedP: { blue: [], red: [] } } as GameState);
const swipe = (a: V, b: V, t0: number, ms: number): PtrEv[] => {
  const out: PtrEv[] = [{ t: t0, k: 'down', p: a }];
  for (let t = 8; t < ms; t += 8) out.push({ t: t0 + t, k: 'move', p: [a[0] + ((b[0] - a[0]) * t) / ms, a[1] + ((b[1] - a[1]) * t) / ms] });
  out.push({ t: t0 + ms, k: 'move', p: b }, { t: t0 + ms, k: 'up', p: b });
  return out;
};
function run(blue: PtrEv[], blueLine: Record<number, Line> = {}) {
  const q = toPieces(blue); let s = game(); const events: GameEvent[] = [];
  while (s.step < 60 && s.phase === 'cut') {
    const k = s.step;
    const out = step(s, { free: q.get(k) ? { blue: q.get(k) } : undefined, blue: blueLine[k] ?? null, skill: k === 2 ? { blue: true } : undefined });
    events.push(...out.events); s = out.state;
  }
  return { s, events };
}
const KINDS = ['heart', 'poison', 'eye'];

test('X2 行為：即時劃刀穿刺連切 3 顆 → cutByMe 長度＝severedN.blue＝3，縫合選項含全部三種', () => {
  const r = run(swipe([350, 700], [350, 150], 10 * MS, 150));
  const mine = collectCutKinds(r.events, ORGANS, 'blue');
  assert.equal(r.s.severedN.blue, 3);
  assert.equal(mine.length, r.s.severedN.blue);
  assert.deepEqual(mine, KINDS);
  assert.deepEqual([...stitchOffer(newCampaign(3, BODY2, R3, FRONT, { beast: 'snake' }), mine)].sort(), [...KINDS].sort());
});
test('X2 行為：直線預覽的穿刺刀（strike.pierced）連切 3 顆 → 同樣 3 顆都進 cutByMe', () => {
  const r = run([], { 5: { a: [350, 700], b: [350, 280] } });
  const mine = collectCutKinds(r.events, ORGANS, 'blue');
  assert.equal(r.s.severedN.blue, 3);
  assert.deepEqual(mine, KINDS);
});
test('X2 行為：沒有穿刺時一刀一個（收集器不多收）', () => {
  const q = toPieces(swipe([350, 700], [350, 150], 10 * MS, 150)); let s = game(); const events: GameEvent[] = [];
  while (s.step < 60 && s.phase === 'cut') { const out = step(s, { free: q.get(s.step) ? { blue: q.get(s.step) } : undefined }); events.push(...out.events); s = out.state; }
  assert.deepEqual(collectCutKinds(events, ORGANS, 'blue'), ['heart']); assert.equal(s.severedN.blue, 1);
});

// ---------------------------------------------------------------- 靜態：duel6_main.ts 接線
const SRC = readFileSync(new URL('../../src/duel6_main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function block(src: string, start: string): string {
  const i = src.indexOf(start); if (i < 0) return '';
  const m = /\n\}[);]*(?=\n)/.exec(src.slice(i)); return m ? src.slice(i, i + m.index + m[0].length) : '';
}
/** 回傳違規清單（空＝通過）。 */
function wiring(src: string): string[] {
  const bad: string[] = [];
  const cut = block(src, 'function onCutEvent('), free = block(src, 'function onFreeEvent('), pick = block(src, 'function showBeastPick(');
  for (const [n, b] of [['onCutEvent', cut], ['onFreeEvent', free], ['showBeastPick', pick]] as const) if (b.length < 150) bad.push(`抽不到 ${n}`);
  if (!/e\.t === 'freeCut'\) \{ onFreeEvent\(/.test(cut) && !/\|\| e\.t === 'freeCut'\) \{ onFreeEvent\(e, s0, now\)/.test(cut)) bad.push('onCutEvent 沒把 freeCut 轉給 onFreeEvent');
  if (!/for \(const i of cutIdxOf\(e\)\)/.test(cut)) bad.push('onCutEvent 的 strike 沒逐一處理 cutIdxOf（pierced）');
  if (!/Extract<GameEvent, \{[^}]*'freeCut'[^}]*\}>/.test(free)) bad.push('onFreeEvent 型別沒含 freeCut');
  if (!/if \(e\.t === 'freeCut'\) \{[^\n]*\n[\s\S]*?G\.cutByMe\.push\(o\.kind\); return;\n  \}/.test(free)) bad.push('onFreeEvent 的 freeCut 沒進 cutByMe');
  if (!/via: 'freeCut'/.test(free)) bad.push('onFreeEvent 沒記 DEVLOG freeCut');
  if (!/e\.t === 'freeCut'\) \{ ACC\.pierceN\+\+/.test(free)) bad.push('onFreeEvent 沒記 ACC.pierceN');
  if (!/G\.pendingBattle = 0;/.test(pick) || !/G\.matchupUntil = 0;/.test(pick) || !/G\.countdown = null;/.test(pick)) bad.push('showBeastPick 沒清 pendingBattle／matchupUntil／countdown');
  if (/CB\.CUT_SECONDS/.test(src)) bad.push('倒數仍用 CB.CUT_SECONDS');
  if (!/切割 \$\{CUT_S\} 秒/.test(src)) bad.push('倒數沒用 CUT_S');
  return bad;
}
test('X2 靜態：duel6_main.ts 的 freeCut 接線、pierced 逐一處理、showBeastPick 清待開戰、倒數用 CUT_S', () => {
  assert.deepEqual(wiring(SRC), []);
});
test('X2 突變：拿掉 freeCut 轉發／pierced 逐一處理／cutByMe／清待開戰／改回 CB.CUT_SECONDS → 必須紅', () => {
  const muts: [string, string, string][] = [
    ['freeCut 轉發', " || e.t === 'freeCut') { onFreeEvent(e, s0, now); return; }", ") { onFreeEvent(e, s0, now); return; }"],
    ['逐一 pierced', 'for (const i of cutIdxOf(e)) {', 'for (const i of (e.r.severed !== null ? [e.r.severed] : [])) {'],
    ['freeCut cutByMe', "G.cutByMe.push(o.kind); return;\n  }\n  if (e.t === 'freeLock')", "return;\n  }\n  if (e.t === 'freeLock')"],
    ['清 pendingBattle', 'G.pendingBattle = 0; G.matchupUntil = 0;', 'G.matchupUntil = 0;'],
    ['倒數秒數', '切割 ${CUT_S} 秒', '切割 ${CB.CUT_SECONDS} 秒'],
  ];
  for (const [n, a, b] of muts) { assert.ok(SRC.includes(a), `突變錨點不存在：${n}`); assert.notDeepEqual(wiring(SRC.replace(a, b)), [], `${n} 沒被抓到`); }
});
