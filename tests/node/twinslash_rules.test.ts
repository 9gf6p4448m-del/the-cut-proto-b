// 一刀雙獸規則引擎（the-cut docs/twin-slash/ACCEPTANCE_FROZEN.md TS-01～06、08、10 的引擎部分）。作者測試。
// 人工直線盤面：藍身（下）與紅身（上）在 y=450～550 交疊，器官排在 y=500 的水平線上，刀從 (100,500) 往右劃。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiChoose, applyCut, newState, resolveCut, key } from '../../src/twinslash/rules.ts';
import type { BoardDef, CutResult, Kind, Mode, Side, State, V } from '../../src/twinslash/rules.ts';
import { BOARDS } from '../../src/twinslash/boards.ts';

function line(items: [Side, Kind, number][]): BoardDef {
  const organs: BoardDef['organs'] = { blue: [], red: [] };
  items.forEach(([s, k, x], i) => organs[s].push({ id: `${k}${i}`, kind: k, p: [x, 500] }));
  return { id: 't', name: 't', purpose: 't', body: { blue: [[0, 450], [700, 450], [700, 1000], [0, 1000]], red: [[0, 0], [700, 0], [700, 550], [0, 550]] }, organs };
}
const A: V = [100, 500], B: V = [500, 500];
const ids = (ks: string[]) => ks.map((k) => k);
const blueTurn = (s: State): State => ({ ...s, turn: 'blue' });
const nullCut = (s: State): CutResult => resolveCut(s, s.turn, s.turn === 'blue' ? [50, 950] : [50, 50], s.turn === 'blue' ? [50, 800] : [50, 200], false);

test('TS-01 命中順序與停刀：A1 切除第一個敵方器官後停刀；B2 關閉穿過；B2 開啟同 A1 並扣次數', () => {
  const b = line([['blue', 'claw', 150], ['red', 'claw', 250], ['blue', 'claw', 350]]);
  const a1 = resolveCut(newState(b, 'A1', 'blue'), 'blue', A, B, false);
  assert.deepEqual(a1.hits.map((h) => h.effect), ['fire', 'sever', 'after']);
  assert.deepEqual(ids(a1.fired), ['blue:claw0']); assert.equal(a1.severed, 'red:claw1'); assert.equal(a1.dmg, 2); assert.equal(a1.spend, false);
  assert.equal(a1.stop?.by, 'organ'); assert.ok(Math.abs(a1.stop!.p[0] - 250) < 1e-9);
  const offS = newState(b, 'B2', 'blue');
  const off = resolveCut(offS, 'blue', A, B, false);
  assert.deepEqual(off.hits.map((h) => h.effect), ['fire', 'pass', 'fire']);
  assert.deepEqual(off.passed, ['red:claw1']); assert.equal(off.severed, null); assert.equal(off.dmg, 4); assert.equal(off.stop, null);
  const noCharge = resolveCut(offS, 'blue', A, B, true);                       // 0 次時開啟無效：照樣穿過
  assert.deepEqual(noCharge.passed, ['red:claw1']); assert.equal(noCharge.spend, false);
  const onS: State = { ...offS, charges: { blue: 1, red: 0 } };
  const on = resolveCut(onS, 'blue', A, B, true);
  assert.deepEqual(on.hits.map((h) => h.effect), ['fire', 'sever', 'after']); assert.equal(on.spend, true); assert.equal(on.dmg, 2);
  const after = applyCut(onS, on);
  assert.equal(after.charges.blue, 0); assert.ok(!after.alive.includes('red:claw1')); assert.ok(after.alive.includes('blue:claw2'));
  assert.deepEqual(after.tired.blue, ['claw0']);                                 // 停刀之後的器官沒有發動，所以也沒有疲勞
});

test('TS-02 骨：敵骨在所有模式擋刀、扣耐久、不扣次數；耐久 0 移除後可通過；自己的骨不擋', () => {
  const b = line([['blue', 'claw', 150], ['red', 'bone', 250], ['blue', 'claw', 350]]);
  for (const [mode, use, ch] of [['A1', false, 0], ['B2', false, 0], ['B2', true, 1]] as [Mode, boolean, number][]) {
    const s: State = { ...newState(b, mode, 'blue'), charges: { blue: ch, red: 0 } };
    const r = resolveCut(s, 'blue', A, B, use);
    assert.deepEqual(r.hits.map((h) => h.effect), ['fire', 'bone', 'after'], `${mode} ${use}`);
    assert.equal(r.bone, 'red:bone1'); assert.equal(r.spend, false); assert.equal(r.stop?.by, 'bone'); assert.equal(r.dmg, 2);
    const s1 = applyCut(s, r);
    assert.equal(s1.boneHp['red:bone1'], 1); assert.equal(s1.charges.blue, ch, '撞骨不扣次數');
    // 同一刀路再砍一次：骨破（耐久 0、移除），這一刀仍被它擋下
    const s2 = blueTurn({ ...s1, tired: { blue: [], red: [] } });
    const r2 = resolveCut(s2, 'blue', A, B, use);
    assert.deepEqual(r2.hits.map((h) => h.effect), ['fire', 'bone', 'after']);
    const s3 = applyCut(s2, r2);
    assert.ok(!s3.alive.includes('red:bone1'));
    const r3 = resolveCut(blueTurn({ ...s3, tired: { blue: [], red: [] } }), 'blue', A, B, use);
    assert.deepEqual(r3.hits.map((h) => h.effect), ['fire', 'fire']); assert.equal(r3.dmg, 4);
  }
  const own = line([['blue', 'claw', 150], ['blue', 'bone', 250], ['blue', 'claw', 350]]);
  const r = resolveCut(newState(own, 'A1', 'blue'), 'blue', A, B, false);
  assert.equal(r.stop, null); assert.equal(r.dmg, 4); assert.deepEqual(r.fired, ['blue:claw0', 'blue:claw2']);
});

test('TS-03 疲勞：第 k 刀發動的器官第 k+1 刀略過、第 k+2 刀恢復；疲勞中仍可被對方切除', () => {
  const b = line([['blue', 'claw', 150], ['blue', 'claw', 350]]);
  let s = newState(b, 'A1', 'blue');
  s = applyCut(s, resolveCut(s, 'blue', A, [250, 500], false));                 // 第 1 刀只發動 claw0
  assert.deepEqual(s.tired.blue, ['claw0']);
  s = applyCut(s, nullCut(s));
  const k2 = resolveCut(s, 'blue', A, B, false);
  assert.deepEqual(k2.hits.map((h) => h.effect), ['tired', 'fire']); assert.equal(k2.dmg, 2);
  s = applyCut(s, k2);                                                           // 第 2 刀發動 claw1 → claw0 恢復、claw1 疲勞
  assert.deepEqual(s.tired.blue, ['claw1']);
  s = applyCut(s, nullCut(s));
  const k3 = resolveCut(s, 'blue', A, B, false);
  assert.deepEqual(k3.hits.map((h) => h.effect), ['fire', 'tired']);
  // 疲勞中的 claw1 被紅方由上往下切除
  const red = resolveCut({ ...s, turn: 'red' }, 'red', [350, 300], [350, 520], false);
  assert.equal(red.severed, 'blue:claw1');
});

test('TS-05 次數收支：每 6 傷 1 次、餘額保留、上限 2 時作廢但餘額照算', () => {
  const b = line([['blue', 'claw', 150]]);
  const hurt = (s: State, dmg: number) => applyCut({ ...s, turn: 'red' }, { ...nullCut({ ...s, turn: 'red' }), dmg });
  let s = newState(b, 'B2', 'red');
  s = hurt(s, 5); assert.deepEqual([s.charges.blue, s.meter.blue], [0, 5]);
  s = hurt(s, 4); assert.deepEqual([s.charges.blue, s.meter.blue], [1, 3]);
  s = hurt({ ...s, charges: { blue: 2, red: 0 } }, 12); assert.deepEqual([s.charges.blue, s.meter.blue], [2, 3]);
  const a1 = hurt(newState(b, 'A1', 'red'), 12); assert.deepEqual([a1.charges.blue, a1.meter.blue], [0, 0], 'A1 不累積');
});

test('TS-06 傷害＝爪×2×(1＋心)；只有心＝0；停刀後的爪不算', () => {
  const st = (it: [Side, Kind, number][]) => newState(line(it), 'A1', 'blue');
  assert.equal(resolveCut(st([['blue', 'claw', 150], ['blue', 'heart', 250], ['blue', 'claw', 350]]), 'blue', A, B, false).dmg, 8);
  assert.equal(resolveCut(st([['blue', 'claw', 150], ['blue', 'claw', 250], ['blue', 'claw', 350]]), 'blue', A, B, false).dmg, 6);
  assert.equal(resolveCut(st([['blue', 'heart', 250]]), 'blue', A, B, false).dmg, 0);
  assert.equal(resolveCut(st([['blue', 'claw', 150], ['red', 'heart', 250], ['blue', 'claw', 350]]), 'blue', A, B, false).dmg, 2);
});

test('TS-07（引擎部分）resolveCut 不改狀態、同輸入逐值相同；非法刀不結算', () => {
  const s = newState(line([['blue', 'claw', 150], ['red', 'claw', 250]]), 'B2', 'blue');
  const before = JSON.stringify(s);
  assert.deepEqual(resolveCut(s, 'blue', A, B, false), resolveCut(s, 'blue', A, B, false));
  assert.equal(JSON.stringify(s), before);
  for (const [a, b, why] of [[A, [200, 500], '刀太短'], [A, [600, 600], '刀太長'], [[100, 100], [100, 400], '要從自己的獸身上起刀']] as [V, V, string][]) {
    const r = resolveCut(s, 'blue', a, b, false); assert.equal(r.legal, false); assert.equal(r.reason, why);
    assert.equal(applyCut(s, r), s);
  }
});

test('TS-08 終局：致死立即結束且之後的刀無效；8 刀比血；同血平手', () => {
  const b = line([['blue', 'claw', 150]]);
  const s0: State = { ...newState(b, 'A1', 'blue'), hp: { blue: 30, red: 2 } };
  const k = applyCut(s0, resolveCut(s0, 'blue', A, B, false));
  assert.deepEqual(k.result, { winner: 'blue', reason: 'kill' }); assert.equal(k.cuts, 1);
  assert.equal(applyCut(k, nullCut(k)), k, '結束後不再結算');
  let s = newState(b, 'A1', 'red');
  for (let i = 0; i < 7; i++) { s = applyCut(s, nullCut(s)); assert.equal(s.result, null); }
  s = applyCut(s, nullCut(s)); assert.deepEqual(s.result, { winner: 'draw', reason: 'cuts' }); assert.equal(s.cuts, 8);
  let w = newState(b, 'A1', 'blue');
  w = applyCut(w, resolveCut(w, 'blue', A, B, false));
  for (let i = 0; i < 7; i++) w = applyCut(w, nullCut(w));
  assert.deepEqual(w.result, { winner: 'blue', reason: 'cuts' }); assert.deepEqual(w.hp, { blue: 30, red: 28 });
});

test('TS-09（引擎部分）newState 每次都是全新初始狀態', () => {
  for (const bd of BOARDS) for (const m of ['A1', 'B2'] as Mode[]) {
    const s = newState(bd, m, 'red', 7);
    assert.deepEqual([s.hp, s.cuts, s.turn, s.charges, s.meter, s.tired, s.result], [{ blue: 30, red: 30 }, 0, 'red', { blue: 0, red: 0 }, { blue: 0, red: 0 }, { blue: [], red: [] }, null]);
    assert.equal(s.alive.length, bd.organs.blue.length + bd.organs.red.length);
    for (const side of ['blue', 'red'] as Side[]) for (const o of bd.organs[side]) if (o.kind === 'bone') assert.equal(s.boneHp[key(side, o.id)], 2);
  }
});

test('TS-10（引擎部分）AI 只依已結算盤面：同狀態兩次選刀逐值相同、刀路合法且從紅身起刀', () => {
  const s = newState(BOARDS[0], 'B2', 'red', 1003);
  const x = aiChoose(s), y = aiChoose(s);
  assert.deepEqual(x, y); assert.equal(x.legal, true); assert.equal(x.side, 'red');
});
