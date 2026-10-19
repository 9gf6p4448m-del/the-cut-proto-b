// duel v0.6 FT-01／FT-02：平手比切除數（G4）規則層。凍結規格：the-cut docs/fusion/DUEL_V06_TIE_LOG.md 一、FT-01、FT-02。
// 預期值依規格手算寫死；種子對照 49edf30 的舊公式（寫死舊值），不與新程式自己比。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleSeed, finishStage, matchFor, newCampaign, pickStitch, placeCheck, placeStitch, tieOutcome } from '../../src/cutbattle/campaign.ts';
import type { Campaign } from '../../src/cutbattle/campaign.ts';
import { simulateBattle } from '../../src/cutbattle/battle.ts';
import type { BattleResult } from '../../src/cutbattle/battle.ts';
import type { Kind, V } from '../../src/rtcut/rules.ts';

const base = simulateBattle([{ side: 'blue', id: 'b', kind: 'claw' }, { side: 'red', id: 'r', kind: 'heart' }], 1);
const mk = (winner: BattleResult['winner']): BattleResult => ({ ...base, winner });
const WIN = mk('blue'), LOSE = mk('red'), DRAW = mk('draw');
const tb = (seed = 8): Campaign => newCampaign(seed, undefined, undefined, undefined, { tieBreak: true });
const sev = (blue: number, red: number) => ({ blue, red });
/** 贏一場→挑第一個選項→擺到第一個合法點，進下一場。 */
function advance(c: Campaign): Campaign {
  c = pickStitch(finishStage(c, ['claw', 'eye', 'bone'], WIN, [], sev(1, 0)), 'claw');
  let ok: V | null = null;
  for (let y = 450; y < 960 && !ok; y += 10) for (let x = 60; x < 660 && !ok; x += 10) if (!placeCheck(c, [x, y])) ok = [x, y];
  return placeStitch(c, ok!).c;
}

test('FT-01 tieOutcome：多＝win、少＝loss、相等＝replay', () => {
  assert.deepEqual([tieOutcome(sev(5, 4)), tieOutcome(sev(3, 4)), tieOutcome(sev(4, 4)), tieOutcome(sev(0, 0))], ['win', 'loss', 'replay', 'replay']);
});
test('FT-01 平手且你多：前兩場進挑縫合、第 3 場征途勝', () => {
  for (const stage of [0, 1]) {
    const c = finishStage({ ...tb(), stage }, ['eye', 'claw'], DRAW, [], sev(5, 4));
    assert.equal(c.phase, 'pick'); assert.equal(c.offer.length, 3); assert.ok(c.offer.includes('eye') && c.offer.includes('claw'));
    assert.deepEqual(c.history[0].tiebreak, { blue: 5, red: 4, result: 'win' });
  }
  const last = finishStage({ ...tb(), stage: 2 }, ['eye'], DRAW, [], sev(5, 4));
  assert.equal(last.phase, 'won'); assert.equal(last.history[0].tiebreak?.result, 'win');
});
test('FT-01 平手且你少：征途敗（任一場）', () => {
  for (const stage of [0, 1, 2]) {
    const c = finishStage({ ...tb(), stage }, ['eye'], DRAW, [], sev(3, 4));
    assert.equal(c.phase, 'lost'); assert.deepEqual(c.history[0].tiebreak, { blue: 3, red: 4, result: 'loss' });
  }
});
test('FT-01 平手且一樣：同一場、replay+1、已縫器官不變、history 留下該場與 tiebreak', () => {
  const c1 = advance(tb());
  assert.equal(c1.stage, 1); assert.equal(c1.stitches.length, 1);
  const r = finishStage(c1, ['eye'], DRAW, ['claw'], sev(4, 4));
  assert.deepEqual([r.phase, r.stage, r.replay, r.stitches, r.blueBase], ['cut', 1, 1, c1.stitches, c1.blueBase]);
  const last = r.history[r.history.length - 1];
  assert.deepEqual([last.stage, last.replay, last.winner, last.tiebreak], [1, 0, 'draw', { blue: 4, red: 4, result: 'replay' }]);
  assert.equal(r.history.length, c1.history.length + 1);
});
test('FT-01 非平手：不論切除數，結果與舊版相同（含切除數對你不利的勝、有利的敗）', () => {
  const old = (battle: BattleResult, stage: number) => finishStage({ ...newCampaign(8), stage }, ['eye'], battle);
  for (const [n, m] of [[0, 9], [9, 0], [4, 4]] as const) for (const stage of [0, 1, 2]) for (const b of [WIN, LOSE]) {
    const a = finishStage({ ...tb(), stage }, ['eye'], b, [], sev(n, m)), o = old(b, stage);
    assert.deepEqual([a.phase, a.offer], [o.phase, o.offer]);
    assert.equal(a.history[0].tiebreak, undefined); assert.equal(a.replay, 0);
  }
});
test('FT-01 不給 tieBreak：平手仍算輸（即使給了切除數）、history 無 tiebreak', () => {
  const c0 = newCampaign(8);
  for (const s of [sev(9, 0), sev(0, 9), sev(4, 4)]) {
    const c = finishStage(c0, [], DRAW, [], s);
    assert.equal(c.phase, 'lost'); assert.equal(c.history[0].tiebreak, undefined); assert.equal(c.replay, undefined);
  }
  assert.equal(finishStage(c0, [], DRAW).phase, 'lost');
});

test('FT-02 重打場雙方器官（id、種類、位置）與原場逐值相同；已縫器官在內', () => {
  const c1 = advance(tb()), m0 = matchFor(c1);
  let c = c1;
  for (let i = 1; i <= 3; i++) {
    c = finishStage(c, [], DRAW, [], sev(2, 2));
    assert.equal(c.replay, i);
    assert.deepEqual(matchFor(c).organs, m0.organs);
  }
  assert.ok(m0.organs.some((o) => o.id.startsWith('藍縫')));
});
test('FT-02 切割期種子、戰鬥種子都與原場不同，且第 1、2 次重打彼此不同', () => {
  const c0 = tb(), c1 = finishStage(c0, [], DRAW, [], sev(1, 1)), c2 = finishStage(c1, [], DRAW, [], sev(1, 1));
  const cut = [c0, c1, c2].map((c) => matchFor(c).seed), bat = [c0, c1, c2].map(battleSeed);
  assert.equal(new Set(cut).size, 3); assert.equal(new Set(bat).size, 3);
  assert.notEqual(matchFor(c1).rng, matchFor(c0).rng);
});
test('FT-02 replay=0 時種子與 49edf30 舊公式逐值相同（寫死舊值）', () => {
  // 舊式：切割期 (seed+7919*(stage+1))>>>0；戰鬥 (seed*31+stage*1013+17)>>>0。seed 8：stage0 = 7927／265；stage1 = 15846／1278
  const c = tb(8);
  assert.deepEqual([matchFor(c).seed, battleSeed(c)], [7927, 265]);
  assert.deepEqual([matchFor({ ...c, stage: 1 }).seed, battleSeed({ ...c, stage: 1 })], [15846, 1278]);
  for (const seed of [0, 1, 3, 77, 123456, 0xffffffff]) for (const stage of [0, 1, 2]) {
    const cc = { ...tb(seed), stage }, oc = { ...newCampaign(seed), stage };
    assert.equal(matchFor(cc).seed, ((seed >>> 0) + 7919 * (stage + 1)) >>> 0);
    assert.equal(battleSeed(cc), (((seed >>> 0) * 31 + stage * 1013 + 17) >>> 0));
    assert.deepEqual([matchFor(oc).seed, battleSeed(oc)], [matchFor(cc).seed, battleSeed(cc)]);   // 不給選項的舊征途同值
  }
});
test('FT-02 重打又平手又一樣 → replay=2；重打無次數上限', () => {
  let c = tb();
  for (let i = 1; i <= 6; i++) { c = finishStage(c, [], DRAW, [], sev(3, 3)); assert.equal(c.replay, i); assert.equal(c.stage, 0); assert.equal(c.phase, 'cut'); }
  assert.deepEqual(c.history.map((h) => h.replay), [0, 1, 2, 3, 4, 5]);
});
test('FT-02 重打贏了：縫合選項取自重打場切除；進下一場 replay 歸 0', () => {
  let c = finishStage(tb(), ['claw', 'claw', 'heart'], DRAW, [], sev(2, 2));        // 原場切 claw／heart
  c = finishStage(c, ['eye', 'poison', 'bone'], DRAW, [], sev(5, 4));                // 重打場切 eye／poison／bone，平手但你多
  assert.equal(c.phase, 'pick');
  assert.deepEqual([...c.offer].sort(), (['eye', 'poison', 'bone'] as Kind[]).sort());
  assert.equal(c.history[1].replay, 1);
  let ok: V | null = null; c = pickStitch(c, c.offer[0]);
  for (let y = 450; y < 960 && !ok; y += 10) for (let x = 60; x < 660 && !ok; x += 10) if (!placeCheck(c, [x, y])) ok = [x, y];
  const n = placeStitch(c, ok!).c;
  assert.deepEqual([n.stage, n.replay, n.phase], [1, 0, 'cut']);
});
