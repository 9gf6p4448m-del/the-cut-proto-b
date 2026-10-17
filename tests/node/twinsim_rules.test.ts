// 同時下刀單場試玩規則（the-cut docs/twin-sim/ACCEPTANCE_FROZEN.md TSIM-01～07、15 的 Node 部分）。作者測試。
// 預期數字是依凍結規則手算後寫死，不由被測函式推出；AI 規格另在本檔獨立重寫一份再逐項比對。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { aiPlan, BOARD_BP, newSim, resolveRound, snapshot, ROUNDS } from '../../src/twinsim/sim.ts';
import type { Line, RoundResult, SimState } from '../../src/twinsim/sim.ts';
import { aiValue, candidateCuts, inside, resolveCut } from '../../src/twinslash/rules.ts';
import type { BoardDef, CutResult, Side, V } from '../../src/twinslash/rules.ts';
import { ROOT } from './helpers.ts';

const L = (a: V, b: V): Line => ({ a, b });
// 研究檔 B′ 的代表刀
const UP = L([100, 620], [420, 620]), LOW = L([100, 820], [420, 820]), BLUE_EMPTY = L([600, 950], [600, 800]);
const EMAX = L([100, 300], [420, 300]), ECUT2 = L([560, 470], [350, 820]), RED_EMPTY = L([650, 50], [650, 200]);
const round = (s: SimState, blue: Line, red: Line) => resolveRound(s, { blue, red });

test('TSIM-01 盤面 B′：座標、獸身與凍結檔完全相同；器官都在自己獸身內；沒有骨', () => {
  assert.deepEqual(BOARD_BP.body, { blue: [[0, 450], [700, 450], [700, 1000], [0, 1000]], red: [[0, 0], [700, 0], [700, 550], [0, 550]] });
  assert.deepEqual(BOARD_BP.organs.blue.map((o) => [o.id, o.kind, o.p]), [
    ['上爪1', 'claw', [150, 620]], ['上爪2', 'claw', [250, 620]], ['上心', 'heart', [350, 620]],
    ['下爪1', 'claw', [150, 820]], ['下爪2', 'claw', [250, 820]], ['下心', 'heart', [350, 820]]]);
  assert.deepEqual(BOARD_BP.organs.red.map((o) => [o.id, o.kind, o.p]), [
    ['爪1', 'claw', [150, 300]], ['爪2', 'claw', [250, 300]], ['心', 'heart', [350, 300]],
    ['截爪1', 'claw', [486, 380]], ['截爪2', 'claw', [444, 455]], ['截爪3', 'claw', [539, 505]], ['截爪4', 'claw', [518, 540]]]);
  for (const s of ['blue', 'red'] as Side[]) for (const o of BOARD_BP.organs[s]) { assert.ok(inside(o.p, BOARD_BP.body[s]), `${s}:${o.id}`); assert.notEqual(o.kind, 'bone'); }
  const s = newSim(1); assert.equal(s.hp.blue, 30); assert.equal(s.hp.red, 30); assert.equal(s.round, 0); assert.equal(ROUNDS, 4);
});

test('TSIM-02 快照判刀：雙方刀路＝resolveCut(回合開始盤面)；對方的切除不改變自己的刀路判定', () => {
  const s = newSim(1), snap = snapshot(s), rr = round(s, LOW, ECUT2);
  for (const [side, ln] of [['blue', LOW], ['red', ECUT2]] as [Side, Line][]) {
    const p = resolveCut(snap, side, ln.a, ln.b, false);
    assert.deepEqual(JSON.stringify(rr[side].path), JSON.stringify(p), side);
  }
  // 紅這刀切的是藍刀路上的下心：藍的「刀路」仍含下心（判在快照上），只是實際不發動
  assert.deepEqual([...rr.blue.path.fired].sort(), ['blue:下心', 'blue:下爪1', 'blue:下爪2']);
  assert.equal(rr.red.path.severed, 'blue:下心');
  // 雙方互切：藍切掉紅刀路上的截爪3、紅切掉藍刀路上的器官——兩邊的刀路都仍判在快照上（先套用任一方都會讓這裡變紅）
  const c3 = candidateCuts(snap, 'blue').find((r) => r.severed === 'red:截爪3' && r.fired.length >= 1)!;
  const both = round(s, L(c3.a, c3.b), ECUT2);
  assert.ok(both.red.path.fired.includes('red:截爪3') && both.red.cancelled.includes('red:截爪3'), '紅刀路仍含截爪3（判在快照上），但未發動');
  assert.deepEqual(JSON.stringify(both.blue.path), JSON.stringify(resolveCut(snap, 'blue', c3.a, c3.b, false)));
  // 呼叫順序與物件鍵順序無關
  const rr2 = resolveRound(s, { red: ECUT2, blue: LOW } as Record<Side, Line>);
  assert.equal(JSON.stringify(rr2), JSON.stringify(rr));
});

// ---- 藍紅互換 ----
const sw = (k: string) => (k.startsWith('blue:') ? 'red:' + k.slice(5) : 'blue:' + k.slice(4));
function mirrorBoard(b: BoardDef): BoardDef { return { ...b, body: { blue: b.body.red, red: b.body.blue }, organs: { blue: b.organs.red, red: b.organs.blue } }; }
function mirrorSim(s: SimState, mb: BoardDef): SimState {
  return { ...s, board: mb, hp: { blue: s.hp.red, red: s.hp.blue }, alive: s.alive.map(sw), tired: { blue: [...s.tired.red], red: [...s.tired.blue] },
    result: s.result && { ...s.result, winner: s.result.winner === 'draw' ? 'draw' : s.result.winner === 'blue' ? 'red' : 'blue' } };
}
const sideView = (o: RoundResult['blue'], f: (k: string) => string) => JSON.stringify({ fired: o.fired.map(f), cancelled: o.cancelled.map(f), severed: o.path.severed && f(o.path.severed), dmg: o.dmg, path: o.path.fired.map(f) });
function lcg(seed: number) { let x = seed >>> 0 || 1; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }

test('TSIM-03 對稱：盤面藍紅互換、兩刀互換（≥200 對、含非初始盤面），結算結果剛好互換', () => {
  const mb = mirrorBoard(BOARD_BP);
  const starts: SimState[] = [newSim(1)];
  starts.push(round(starts[0], LOW, ECUT2).after, round(starts[0], UP, EMAX).after);
  const u = lcg(20261017); let n = 0, fires = 0, cancels = 0;
  for (const s of starts) {
    const snap = snapshot(s), cb = candidateCuts(snap, 'blue'), cr = candidateCuts(snap, 'red');
    for (let i = 0; i < 80; i++) {
      const b = cb[Math.floor(u() * cb.length)], r = cr[Math.floor(u() * cr.length)];
      const rr = round(s, L(b.a, b.b), L(r.a, r.b));
      const mr = resolveRound(mirrorSim(s, mb), { blue: L(r.a, r.b), red: L(b.a, b.b) });
      assert.equal(sideView(mr.blue, sw), sideView(rr.red, (k) => k), `#${n} red`);
      assert.equal(sideView(mr.red, sw), sideView(rr.blue, (k) => k), `#${n} blue`);
      assert.deepEqual(mr.after.hp, { blue: rr.after.hp.red, red: rr.after.hp.blue });
      assert.deepEqual(mr.after.alive.map(sw).sort(), [...rr.after.alive].sort());
      assert.deepEqual(mr.after.tired, { blue: rr.after.tired.red, red: rr.after.tired.blue });
      n++; fires += rr.blue.fired.length + rr.red.fired.length; cancels += rr.blue.cancelled.length + rr.red.cancelled.length;
    }
  }
  assert.ok(n >= 200 && fires > 0 && cancels > 0, `n=${n} fires=${fires} cancels=${cancels}（活性：要真的有發動與截斷）`);
});

test('TSIM-04 先切後發動：藍走下排、紅切下心 → 藍只造成 4；被切的器官離場、不算疲勞；揭曉文字', async () => {
  const rr = round(newSim(1), LOW, ECUT2);
  assert.deepEqual([...rr.blue.fired].sort(), ['blue:下爪1', 'blue:下爪2']);
  assert.deepEqual(rr.blue.cancelled, ['blue:下心']);
  assert.equal(rr.blue.dmg, 4);                                      // 2 爪 × 2 ×(1＋0 心)
  assert.ok(!rr.after.alive.includes('blue:下心'));
  assert.ok(!rr.after.tired.blue.includes('下心'));
  assert.equal(rr.after.hp.red, 26);
  const { cancelText } = await import('../../src/twinsim/sim.ts');
  const t = cancelText(BOARD_BP, 'blue', 'blue:下心');
  assert.ok(t.includes('心臟本回合被切除，未能發動'), t);
  assert.ok(!/先出手|搶先/.test(t));
});

test('TSIM-05 疲勞：第 k 回合實際發動 → k+1 略過 → k+2 可發動；被截斷而沒發動的不會疲勞（雙方）', () => {
  const r1 = round(newSim(1), LOW, RED_EMPTY);
  assert.deepEqual([...r1.after.tired.blue].sort(), ['下心', '下爪1', '下爪2']); assert.equal(r1.blue.dmg, 8);
  const r2 = round(r1.after, LOW, RED_EMPTY);
  assert.deepEqual(r2.blue.path.hits.filter((h) => h.effect !== 'after').map((h) => h.effect), ['tired', 'tired', 'tired']);
  assert.equal(r2.blue.dmg, 0); assert.deepEqual(r2.after.tired.blue, []);
  const r3 = round(r2.after, LOW, RED_EMPTY);
  assert.equal(r3.blue.dmg, 8);
  // 紅方：紅刀發動截爪3，藍這刀切掉截爪3 → 截爪3 不發動、不疲勞（離場）
  const snap = snapshot(newSim(1));
  const red = resolveCut(snap, 'red', ECUT2.a, ECUT2.b, false);
  assert.ok(red.fired.includes('red:截爪3'), `ECUT2 要發動截爪3：${red.fired}`);
  const cut3 = candidateCuts(snap, 'blue').find((r) => r.severed === 'red:截爪3' && r.fired.length >= 1)!;
  const rr = round(newSim(1), L(cut3.a, cut3.b), ECUT2);
  assert.deepEqual(rr.red.cancelled, ['red:截爪3']);
  assert.ok(!rr.after.tired.red.includes('截爪3') && rr.after.tired.red.length === rr.red.fired.length);
  assert.deepEqual(rr.after.tired.blue, rr.blue.fired.map((k) => k.split(':')[1]));
  // 藍方：下心被截斷 → 只有兩爪疲勞
  assert.deepEqual([...round(newSim(1), LOW, ECUT2).after.tired.blue].sort(), ['下爪1', '下爪2']);
});

test('TSIM-06 終局：單方歸零立即結束；雙方同回合歸零＝平手；4 回合比血、同血平手；結束後不能再結算', () => {
  const s0 = newSim(1);
  const kill = round({ ...s0, hp: { blue: 30, red: 8 } }, UP, EMAX);
  assert.deepEqual(kill.after.result, { winner: 'blue', reason: 'kill' }); assert.equal(kill.after.round, 1);
  const mutual = round({ ...s0, hp: { blue: 8, red: 8 } }, UP, EMAX);
  assert.equal(mutual.blue.dmg, 8); assert.equal(mutual.red.dmg, 8);
  assert.deepEqual(mutual.after.result, { winner: 'draw', reason: 'mutual' });
  assert.throws(() => round(mutual.after, UP, EMAX));
  let s = s0;
  for (let i = 0; i < 3; i++) { s = round(s, BLUE_EMPTY, RED_EMPTY).after; assert.equal(s.result, null, `第 ${i + 1} 回合不該結束`); }
  s = round(s, BLUE_EMPTY, RED_EMPTY).after;
  assert.deepEqual(s.result, { winner: 'draw', reason: 'rounds' }); assert.equal(s.round, 4);
  let t = s0;
  for (let i = 0; i < 3; i++) t = round(t, BLUE_EMPTY, RED_EMPTY).after;
  assert.deepEqual(round(t, UP, RED_EMPTY).after.result, { winner: 'blue', reason: 'rounds' });
});

// ---- AI 規格的獨立重寫（只用 candidateCuts、aiValue；不呼叫 sim.ts 的分組或打分） ----
function specPlan(s: SimState) {
  const snap = snapshot(s), board = s.board;
  const kind = (k: string) => board.organs[k.split(':')[0] as Side].find((o) => `${k.split(':')[0]}:${o.id}` === k)!.kind;
  const dmg = (ks: string[]) => 2 * ks.filter((k) => kind(k) === 'claw').length * (1 + ks.filter((k) => kind(k) === 'heart').length);
  const group = (side: Side) => { const m = new Map<string, CutResult[]>(); for (const r of candidateCuts(snap, side)) { const g = [...r.fired].sort().join(',') + '|' + (r.severed ?? ''); if (!m.has(g)) m.set(g, []); m.get(g)!.push(r); } return m; };
  const pg = [...group('blue').entries()].map(([g, ls]) => ({ g, r: ls[0], v: aiValue(snap, ls[0]) })).sort((x, y) => y.v - x.v || (x.g < y.g ? -1 : x.g > y.g ? 1 : 0)).slice(0, 2);
  const rg = [...group('red').entries()];
  const scores = new Map<string, number>();
  for (const [g, ls] of rg) {
    const r = ls[0];
    let ev = 0; for (const p of pg) ev += dmg(r.fired.filter((k) => k !== p.r.severed)) - dmg(p.r.fired.filter((k) => k !== r.severed));
    scores.set(g, ev / pg.length + (r.severed ? (kind(r.severed) === 'heart' ? 4 : 2) : 0));
  }
  const best = Math.max(...scores.values());
  const band = [...scores.entries()].filter(([, v]) => v >= best - 2 - 1e-9).map(([g]) => g).sort();
  const u = lcg(s.seed * 7919 + s.round * 104729), gi = band[Math.floor(u() * band.length)], ls = rg.find(([g]) => g === gi)![1];
  return { model: pg.map((p) => p.g), scores, band, sig: gi, cut: ls[Math.floor(u() * ls.length)] };
}

test('TSIM-07 AI：同盤面＋同種子→同一刀；依規格獨立重算 3 個盤面狀態，分數、候選組、選擇逐項相同；參數只有狀態', () => {
  assert.equal(aiPlan.length, 1);
  const s1 = newSim(7), s2 = round(s1, LOW, ECUT2).after, s3 = round(s2, UP, EMAX).after;
  for (const [i, s] of [s1, s2, s3].entries()) {
    const a = aiPlan(s), b = aiPlan(JSON.parse(JSON.stringify(s)));
    assert.equal(JSON.stringify([a.cut.a, a.cut.b, a.sig]), JSON.stringify([b.cut.a, b.cut.b, b.sig]), `決定性 #${i}`);
    const e = specPlan(s);
    assert.deepEqual(a.model, e.model, `玩家模型 #${i}`);
    assert.deepEqual(new Map(a.scores.map((x) => [x.sig, x.score])), e.scores, `分數 #${i}`);
    assert.deepEqual(a.band, e.band, `候選組 #${i}`); assert.equal(a.sig, e.sig, `選擇 #${i}`);
    assert.deepEqual([a.cut.a, a.cut.b], [e.cut.a, e.cut.b], `刀線 #${i}`);
    assert.ok(a.band.length >= 1 && a.scores.length > a.band.length, `活性 #${i}`);
  }
});

test('只回報：固定 50 個種子，第 1 回合 AI 選刀分布（輸出／截擊）與耗時', () => {
  let out = 0, cut = 0; const t0 = performance.now();
  for (let seed = 1; seed <= 50; seed++) { const p = aiPlan(newSim(seed)); if (p.cut.severed) cut++; else out++; }
  console.log(`[只回報] 第 1 回合 AI：輸出 ${out}、截擊 ${cut}（50 種子）；平均 ${Math.round((performance.now() - t0) / 50)} ms/次（Node）`);
});

test('TSIM-15 舊原型不變：src/twinslash/、src/twinslash_main.ts、public-twinslash/、public/ 對 58adfc5 無差異', () => {
  const d = execSync('git diff --name-only 58adfc5 -- src/twinslash src/twinslash_main.ts public-twinslash public', { cwd: ROOT }).toString().trim();
  assert.equal(d, '');
});
