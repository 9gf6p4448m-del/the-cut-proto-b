// 即時亂切 v2（擊倒＋再生）規則（the-cut docs/rt-cut2/ACCEPTANCE_FROZEN.md R2-01～05 的 Node 部分）。作者測試。
// 預期值依凍結檔與盤面常數手算後寫死；刀線幾何見各案註解（同 rtcut_rules.test.ts）。設 RTCUT_RULES 可改測突變版。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const mod: typeof import('../../src/rtcut/rules.ts') = await import(process.env.RTCUT_RULES ? pathToFileURL(process.env.RTCUT_RULES).href : '../../src/rtcut/rules.ts'); // 突變驗紅時指向突變版（tests/rtcut2_mutation.mjs）
const { BODY, MODE_RT1, MODE_RT2, ORGANS, R, REGEN_STEPS, SPROUT_STEPS, aiChoose, aiScore, candidates, countSide, inside, isReady, newGame, resolveStrike, runMatch, runRandomPlayer, step } = mod;
import type { GameState, Line, Side, V } from '../../src/rtcut/rules.ts';
import { ROOT } from './helpers.ts';

const L = (a: V, b: V): Line => ({ a, b });
const idx = (id: string) => ORGANS.findIndex((o) => o.id === id);
const X0 = idx('藍爪1'), Y3 = idx('紅爪3');
const BLUE_ROW = L([60, 500], [400, 500]);       // 鎖藍爪1、切紅爪3
const RED_DOWN_X = L([100, 450], [100, 600]);    // 第一個碰到藍爪1
const withAim = (s: GameState, line: Line): GameState => ({ ...s, aim: { line, aimStep: s.step, fireStep: s.step }, aiNextFire: s.step });
/** RT2 局面：只留 keep 列出的器官，AI 不出刀（除非另外 withAim）。 */
function only(keep: number[], k = 0): GameState {
  const s = newGame(1, MODE_RT2);
  return { ...s, step: k, aiNextFire: 10 ** 9, alive: s.alive.map((_, i) => keep.includes(i)) };
}
const sides = (s: GameState) => ({ blue: countSide(s, 'blue'), red: countSide(s, 'red') });

test('R2-01 擊倒：最後一個器官被切的那一步結束、勝方正確；之後不能出刀、AI 不出刀', () => {
  const s = only([X0, Y3]);
  const o = step(s, { blue: BLUE_ROW });
  assert.equal(o.state.phase, 'ko'); assert.deepEqual(o.state.end, { by: 'ko', winner: 'blue' });
  assert.ok(o.events.some((e) => e.t === 'ko' && e.winner === 'blue'));
  assert.equal(o.state.aim, null); assert.equal(o.state.step, 1);
  // 之後：step 不改狀態、不出刀、AI 不再預告
  const again = step(withAim(o.state, RED_DOWN_X), { blue: L([100, 560], [100, 420]) });
  assert.equal(again.events.length, 0); assert.equal(again.state.alive[X0], true);
  assert.equal(resolveStrike(o.state, 'blue', BLUE_ROW).reject, 'phase');
  // 紅擊倒藍
  const r = step(withAim(only([X0, Y3, idx('紅爪2')]), RED_DOWN_X), {}).state;
  assert.deepEqual(r.end, { by: 'ko', winner: 'red' });
  // 反例：還剩器官不結束
  const n = step(only([X0, Y3, idx('紅爪2')]), { blue: BLUE_ROW }).state;
  assert.equal(n.phase, 'cut'); assert.equal(n.end, null);
  // 原版模式：清空也不結束（R2-04：原版行為不變）
  const v1 = { ...newGame(1), aiNextFire: 10 ** 9, alive: ORGANS.map((_, i) => i === X0 || i === Y3) };
  assert.equal(step(v1, { blue: BLUE_ROW }).state.phase, 'cut');
});

test('R2-01 同一步雙方清空＝平手', () => {
  // 藍刀鎖藍爪1、切紅爪3；紅刀同步切藍爪1（步開始時未鎖）→ 雙方都清空
  const o = step(withAim(only([X0, Y3]), RED_DOWN_X), { blue: BLUE_ROW });
  assert.deepEqual(sides(o.state), { blue: 0, red: 0 });
  assert.deepEqual(o.state.end, { by: 'ko', winner: 'draw' });
});

/** 從第 0 步空跑到第 n 步（不出刀、AI 停）。 */
function run(s: GameState, n: number, at: Record<number, Line> = {}) { const ev: { k: number; i: number }[] = []; while (s.step < n && s.phase === 'cut') { const k = s.step; const o = step(s, { blue: at[k] ?? null }); for (const e of o.events) if (e.t === 'spawn') ev.push({ k, i: e.i }); s = o.state; } return { s, ev }; }
const HEART_UP = L([240, 440], [240, 180]); // 由藍身 (240,440) 往上：x=240 沿線只碰紅心2(240,210)（入點 t=202）

test('R2-02 再生節拍：5／10／15 秒各長 1 個；長回最早被切的種類；滿 8 個不長', () => {
  // 第 0 步切紅爪3（爪）、第 100 步切紅心2（心）、第 200 步切紅爪2（爪）→ 佇列 爪、心、爪
  const s0 = { ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 };
  const { s, ev } = run(s0, 1000, { 0: BLUE_ROW, 100: HEART_UP, 200: L([400, 560], [400, 420]) /* 由 (400,560) 往上：x=400 只碰紅爪2(400,480) */ });
  assert.deepEqual(ev.map((e) => e.k), [REGEN_STEPS, 2 * REGEN_STEPS, 3 * REGEN_STEPS]);
  assert.deepEqual(ev.map((e) => s.organs[e.i].kind), ['claw', 'heart', 'claw']);
  assert.ok(ev.every((e) => s.organs[e.i].side === 'red'));
  assert.equal(countSide(s, 'red'), 8, '補回 8 個後第 20 秒不再長');
  // 第 299 步時還沒長
  assert.equal(run({ ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 }, REGEN_STEPS, { 0: BLUE_ROW }).ev.length, 0);
  // 滿 8 個：不長
  assert.equal(run({ ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 }, 1000).ev.length, 0);
});

test('R2-02 再生位置：在自己獸身內、與現存器官不重疊；同種子同位置', () => {
  const pos = (seed: number) => { const r = run({ ...newGame(seed, MODE_RT2), aiNextFire: 10 ** 9 }, REGEN_STEPS + 1, { 0: BLUE_ROW }); return { r, o: r.s.organs[r.ev[0].i] }; };
  const all: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { r, o } = pos(seed);
    assert.ok(inside(o.p, BODY.red), `seed ${seed} 在紅身`);
    r.s.organs.forEach((q, i) => { if (i !== r.ev[0].i && r.s.alive[i]) assert.ok(Math.hypot(q.p[0] - o.p[0], q.p[1] - o.p[1]) >= 2 * R, `seed ${seed} 與 ${q.id} 重疊`); });
    all.push(JSON.stringify(o.p));
  }
  assert.equal(JSON.stringify(pos(7).o), JSON.stringify(pos(7).o));
  assert.ok(new Set(all).size > 30, '不同種子位置不同');
});

test('R2-03 萌芽 0.5 秒：刀穿過它不切、不鎖、不擋；結束後正常', () => {
  const s = newGame(1, MODE_RT2);
  const sprout = (i: number, until: number): GameState => ({ ...s, step: 100, aiNextFire: 10 ** 9, readyAt: s.readyAt.map((v, j) => (j === i ? until : v)) });
  // 對方萌芽中：紅刀穿過藍爪1 不切（x=100 沿線沒有其他器官）
  const a = resolveStrike(sprout(X0, 101), 'red', RED_DOWN_X);
  assert.equal(a.severed, null); assert.equal(a.blocked, null);
  assert.equal(resolveStrike(sprout(X0, 100), 'red', RED_DOWN_X).severed, X0, '萌芽結束那一步起可被切');
  // 自己萌芽中：不鎖，刀繼續；對方萌芽中不擋：藍橫刀略過萌芽的紅爪3 → 鎖藍爪1、藍爪2，切紅爪2
  const b = resolveStrike(sprout(Y3, 130), 'blue', BLUE_ROW);
  assert.deepEqual(b.locks, [X0, idx('藍爪2')]); assert.equal(b.severed, idx('紅爪2'));
  const c = resolveStrike(sprout(X0, 130), 'blue', BLUE_ROW);
  assert.deepEqual(c.locks, []); assert.equal(c.severed, Y3);
  // 再生出來的器官：readyAt＝節拍＋30
  const r = run({ ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 }, REGEN_STEPS + 1, { 0: BLUE_ROW });
  assert.equal(r.s.readyAt[r.ev[0].i], REGEN_STEPS + SPROUT_STEPS);
});

test('R2-04 原版不變：原版模式下 runMatch／runRandomPlayer 與 1685a30 的規則檔逐值相同（30 種子）', async () => {
  const dir = join(ROOT, '.tmp', `rt1-orig-${process.pid}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rules.ts'), execFileSync('git', ['show', '1685a30:src/rtcut/rules.ts'], { cwd: ROOT }));
  const old: typeof import('../../src/rtcut/rules.ts') = await import(pathToFileURL(join(dir, 'rules.ts')).href);
  const sched = Array.from({ length: 20 }, (_, k) => ({ step: 20 + k * 100, line: candidates(newGame(0), 'blue')[(k * 37) % 1080] }));
  for (let seed = 1; seed <= 30; seed++) {
    assert.equal(JSON.stringify(runRandomPlayer(seed)), JSON.stringify(old.runRandomPlayer(seed)), `random ${seed}`);
    assert.equal(JSON.stringify(runMatch(seed, sched)), JSON.stringify(old.runMatch(seed, sched)), `match ${seed}`);
  }
  assert.equal(JSON.stringify(runRandomPlayer(5, MODE_RT1)), JSON.stringify(old.runRandomPlayer(5)));
});

test('R2-05 AI：對手只剩萌芽器官時不出攻擊刀（只可能出保護刀）；萌芽結束後的新器官在候選目標內', () => {
  const s = newGame(1, MODE_RT2);
  // 藍方只剩藍爪1、且在萌芽中
  const sp: GameState = { ...s, step: 100, alive: s.alive.map((v, i) => ORGANS[i].side === 'red' || i === X0), readyAt: s.readyAt.map((v, i) => (i === X0 ? 120 : v)) };
  const pick = aiChoose(sp);
  if (pick.line) { const r = resolveStrike({ ...sp, cdUntil: { blue: 0, red: 0 } }, 'red', pick.line); assert.equal(r.severed, null); assert.ok(r.locks.length > 0, '只能是保護刀'); }
  // 萌芽結束：有候選刀能切到它
  const ready = { ...sp, step: 120 };
  assert.ok(candidates(ready, 'red').some((l) => resolveStrike({ ...ready, cdUntil: { blue: 0, red: 0 } }, 'red', l).severed === X0));
  // 原版模式（對照）：同局面 AI 仍會出刀（可能無目標）——v2 的限制只在 v2 模式生效
  const v1 = { ...sp, mode: MODE_RT1 };
  assert.notEqual(aiChoose(v1).line, null);
});

// ---------------------------------------------------------------- 對抗式檢查補強（H1～H6、M3）
test('R2-02 先切先長（H3）：切「爪→心」長「爪→心」，切「心→爪」長「心→爪」', () => {
  const kinds = (at: Record<number, Line>) => { const r = run({ ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 }, 2 * REGEN_STEPS + 1, at); return r.ev.map((e) => r.s.organs[e.i].kind); };
  assert.deepEqual(kinds({ 0: BLUE_ROW, 100: HEART_UP }), ['claw', 'heart']);
  assert.deepEqual(kinds({ 0: HEART_UP, 100: BLUE_ROW }), ['heart', 'claw']);
});

test('R2-02 藍方再生位置（H4）：在藍身內、不與任何現存器官重疊（40 種子）', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s0 = { ...newGame(seed, MODE_RT2), aiNextFire: 10 ** 9 };
    const r = run(withAim(s0, RED_DOWN_X), REGEN_STEPS + 1); // 第 0 步紅刀切藍爪1
    assert.equal(r.ev.length, 1, `seed ${seed}`);
    const o = r.s.organs[r.ev[0].i];
    assert.equal(o.side, 'blue'); assert.ok(inside(o.p, BODY.blue), `seed ${seed} 在藍身`);
    r.s.organs.forEach((q, i) => { if (i !== r.ev[0].i && r.s.alive[i]) assert.ok(Math.hypot(q.p[0] - o.p[0], q.p[1] - o.p[1]) >= 2 * R, `seed ${seed} 與 ${q.id} 重疊`); });
  }
});

test('R2-01／02 擊倒與再生節拍同一步（H5）：第 300 步切掉最後一個器官 → 立即擊倒、不再生', () => {
  const s = { ...only([X0, Y3, idx('藍爪2')], REGEN_STEPS), severedQ: { blue: ['claw' as const], red: ['claw' as const, 'heart' as const] } };
  const o = step(s, { blue: BLUE_ROW });
  assert.deepEqual(o.state.end, { by: 'ko', winner: 'blue' });
  assert.equal(o.events.filter((e) => e.t === 'spawn').length, 0);
  assert.equal(o.state.organs.length, ORGANS.length);
  // 對照：同一步沒有擊倒時，節拍照常再生
  const n = step({ ...s, alive: s.alive.map((v, i) => v || i === idx('紅爪2')) }, { blue: L([300, 300], [300, 100]) /* 起點不在藍身：不出刀 */ });
  assert.ok(n.events.filter((e) => e.t === 'spawn').length >= 1);
});

test('R2-03 萌芽長度（H6）：凍結 0.5 秒＝30 步；第 300 步長出 → 第 330 步起才存在', () => {
  assert.equal(SPROUT_STEPS, 30);
  const r = run({ ...newGame(3, MODE_RT2), aiNextFire: 10 ** 9 }, REGEN_STEPS + 1, { 0: BLUE_ROW });
  const i = r.ev[0].i;
  assert.equal(r.s.readyAt[i], 330);
  assert.equal(isReady({ ...r.s, step: 329 }, i), false); assert.equal(isReady({ ...r.s, step: 330 }, i), true);
});

test('R2-05 AI 不對空出刀（H1）：你只剩萌芽器官時，200 個亂數狀態下 AI 每次選刀都只能是保護刀或不出刀', () => {
  const s = newGame(1, MODE_RT2);
  const sp: GameState = { ...s, step: 100, alive: s.alive.map((v, i) => ORGANS[i].side === 'red' || i === X0), readyAt: s.readyAt.map((v, i) => (i === X0 ? 120 : v)) };
  let picks = 0;
  for (let r = 1; r <= 200; r++) {
    const pick = aiChoose({ ...sp, rng: r * 2654435761 >>> 0 });
    if (!pick.line) continue;
    picks++;
    const res = resolveStrike({ ...sp, cdUntil: { blue: 0, red: 0 } }, 'red', pick.line);
    assert.ok(res.severed === null && res.blocked === null && res.locks.length > 0, `rng ${r}：不是保護刀 ${JSON.stringify(pick.line)}`);
  }
  assert.ok(picks > 0, '活性：這個局面 AI 會出保護刀');
  // 牠自己的器官也都還鎖著（保護刀沒有價值）→ 沒有任何有目標的刀 → AI 必須不出刀（原版模式會照樣揮一刀）
  const allLocked: GameState = { ...sp, lockUntil: sp.lockUntil.map((v, i) => (ORGANS[i].side === 'red' ? 10 ** 6 : v)) };
  for (let r = 1; r <= 50; r++) assert.equal(aiChoose({ ...allLocked, rng: (r * 2654435761) >>> 0 }).line, null, `rng ${r}`);
  assert.notEqual(aiChoose({ ...allLocked, mode: MODE_RT1 }).line, null, '對照：原版模式會出無目標的刀');
  // 整步模擬：預告在萌芽期間開始 → 預告刀線也只能是保護刀
  for (let r = 1; r <= 50; r++) {
    const o = step({ ...sp, rng: r * 40503 >>> 0, aim: null, aiNextFire: 100 + 36 }, {});
    const a = o.events.find((e) => e.t === 'aim');
    if (a && a.t === 'aim') { const res = resolveStrike({ ...o.state, cdUntil: { blue: 0, red: 0 } }, 'red', a.aim.line); assert.ok(res.severed === null && res.locks.length > 0, `step rng ${r}`); }
  }
});

test('R2-05 AI 會打再生出來的器官（H2）：藍方只剩一個再生器官（萌芽已結束），AI 打分與實際選刀都把它當目標', () => {
  // 第 0 步紅刀切藍爪1 → 第 300 步藍方再生 → 第 330 步成熟；之後只留這個再生器官
  // seed 5：再生在 (130,772)，紅方候選刀碰得到（seed 4 長在 (378,961)，任何紅刀都碰不到——另列發現）
  const r = run(withAim({ ...newGame(5, MODE_RT2), aiNextFire: 10 ** 9 }, RED_DOWN_X), 331);
  assert.deepEqual(r.s.organs[r.ev[0].i].p, [130, 772]);
  const g = r.ev[0].i;
  assert.ok(g >= ORGANS.length);
  const s: GameState = { ...r.s, alive: r.s.alive.map((v, i) => r.s.organs[i].side === 'red' ? v : i === g) };
  const pr = { ...s, cdUntil: { blue: 0, red: 0 } };
  // ① AI 打分把再生器官當成切除目標：切到它的刀，分數比同一刀不算切除時多出爪的價值 2
  const sev = candidates(pr, 'red').map((l) => resolveStrike(pr, 'red', l)).filter((x) => x.ok && x.severed === g);
  assert.ok(sev.length > 0, '有候選刀切得到');
  for (const x of sev) assert.equal(aiScore(pr, 'red', x) - aiScore(pr, 'red', { ...x, severed: null }), 2);
  // ② 實際選刀（400 個亂數狀態）確實會挑到切它的刀（原版 14 次；把再生器官價值歸零的突變只剩 2 次）
  let hits = 0;
  for (let k = 1; k <= 400; k++) { const p = aiChoose({ ...s, rng: (k * 2654435761) >>> 0 }); if (p.line && resolveStrike(pr, 'red', p.line).severed === g) hits++; }
  assert.ok(hits >= 8, `400 次中切到再生器官 ${hits} 次`);
});

test('R2-02 再生器官被切後重新排入佇列（M3）', () => {
  // 在盤面加一個紅方器官（模擬再生出來的、已成熟）於 (300,455)：藍刀由 (300,560) 往上先鎖藍爪2(300,520)，再切它
  const s0 = newGame(1, MODE_RT2), extra = { id: '紅爪7', side: 'red' as Side, kind: 'claw' as const, p: [300, 455] as V };
  const s: GameState = { ...s0, aiNextFire: 10 ** 9, organs: [...s0.organs, extra], alive: [...s0.alive, true], lockUntil: [...s0.lockUntil, 0], readyAt: [...s0.readyAt, 0] };
  const o = step(s, { blue: L([300, 560], [300, 420]) });
  assert.equal(o.state.alive[16], false); assert.deepEqual(o.state.severedQ.red, ['claw']); assert.equal(o.state.severedN.blue, 1);
});
