// 即時亂切規則（the-cut docs/rt-cut/ACCEPTANCE_FROZEN.md RT-01、02、04、05、06 的 Node 部分＋補述 1）。作者測試。
// 預期值依凍結規則與盤面常數手算後寫死（座標見各案註解），不由被測函式推出。
// RT-04 突變驗紅：設 RTCUT_RULES 指向突變版 rules.ts（tests/rtcut_mutation.mjs 產生），本檔改測突變版。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import type { GameState, Line, V } from '../../src/rtcut/rules.ts';

const mod: typeof import('../../src/rtcut/rules.ts') = await import(process.env.RTCUT_RULES ? pathToFileURL(process.env.RTCUT_RULES).href : '../../src/rtcut/rules.ts');
const { ORGANS, BODY, END_STEP, COOLDOWN_STEPS, LOCK_STEPS, newGame, resolveStrike, step, aiChoose, runMatch, power, duel, candidates, inside } = mod;

const L = (a: V, b: V): Line => ({ a, b });
const idx = (id: string) => ORGANS.findIndex((o) => o.id === id);
const X0 = idx('藍爪1'), Y3 = idx('紅爪3');
// 藍橫刀 y=500 由 (60,500) 往右：先碰藍爪1(100,520)（入點 x≈80.4）→ 鎖、繼續；再碰紅爪3(200,480)（入點 x≈180.4）→ 切除、停刀
const BLUE_ROW = L([60, 500], [400, 500]);
// 紅直刀 x=100 由 (100,450) 往下：第一個碰到藍爪1（入點 t=42）
const RED_DOWN_X = L([100, 450], [100, 600]);
/** 讓 AI 這一步生效指定刀線（把預告寫進狀態；生效時在當時盤面重判）。 */
const withAim = (s: GameState, line: Line): GameState => ({ ...s, aim: { line, aimStep: s.step, fireStep: s.step }, aiNextFire: s.step });
const board = (s: GameState) => JSON.stringify({ alive: s.alive, lockUntil: s.lockUntil });
/** 跳到第 k 步、AI 不出刀（把 AI 下一刀排到很後面）。 */
function at(k: number, base = newGame(1)): GameState { return { ...base, step: k, aim: null, aiNextFire: 10 ** 9 }; }

test('RT-01 盤面：每方爪 6 心 2、沒有骨；器官都在自己獸身內；交疊區 y 430～570 雙方器官交錯', () => {
  for (const side of ['blue', 'red'] as const) {
    const os = ORGANS.filter((o) => o.side === side);
    assert.equal(os.filter((o) => o.kind === 'claw').length, 6); assert.equal(os.filter((o) => o.kind === 'heart').length, 2); assert.equal(os.length, 8);
    for (const o of os) assert.ok(inside(o.p, BODY[side]), o.id);
  }
  const band = ORGANS.filter((o) => o.p[1] >= 430 && o.p[1] <= 570).sort((a, b) => a.p[0] - b.p[0]).map((o) => o.side);
  assert.deepEqual(band, ['blue', 'red', 'blue', 'red', 'blue', 'red']);
});

test('RT-01 單刀：起點不在己方獸身→不出刀；穿過己方→鎖住且刀繼續；碰對方未鎖→切除並停刀', () => {
  const s = at(0);
  const bad = resolveStrike(s, 'blue', L([300, 300], [300, 100])); // (300,300) 只在紅身
  assert.equal(bad.ok, false); assert.equal(bad.reject, 'start');
  const out = step(s, { blue: L([300, 300], [300, 100]) });
  assert.equal(board(out.state), board(s)); assert.equal(out.state.cdUntil.blue, 0, '不出刀不耗冷卻');
  const r = resolveStrike(s, 'blue', BLUE_ROW);
  assert.deepEqual(r.locks, [X0]); assert.equal(r.severed, Y3); assert.equal(r.blocked, null);
  assert.ok(Math.abs(r.end[0] - (200 - Math.sqrt(28 * 28 - 20 * 20))) < 1e-9 && r.end[1] === 500, '刀停在紅爪3 入點');
  const o2 = step(s, { blue: BLUE_ROW }).state;
  assert.equal(o2.alive[Y3], false); assert.equal(o2.lockUntil[X0], LOCK_STEPS); assert.ok(o2.alive.filter((a) => !a).length === 1, '刀停下：之後的藍爪2、紅爪2 都沒事');
});

test('RT-01 單刀：碰對方已鎖→停刀、不切除；鎖定到期後可被切；已鎖再穿過→倒數重設', () => {
  const locked = step(at(0), { blue: BLUE_ROW }).state; // 藍爪1 鎖到第 300 步
  const blk = resolveStrike(locked, 'red', RED_DOWN_X);
  assert.equal(blk.severed, null); assert.equal(blk.blocked, X0); assert.deepEqual(blk.end, [100, 492]);
  const s1 = step(withAim(locked, RED_DOWN_X)).state;
  assert.equal(s1.alive[X0], true, '已鎖擋下');
  // 第 299 步仍鎖、第 300 步到期
  assert.equal(resolveStrike({ ...locked, step: 299 }, 'red', RED_DOWN_X).blocked, X0);
  const exp = resolveStrike({ ...locked, step: 300 }, 'red', RED_DOWN_X);
  assert.equal(exp.severed, X0);
  // 第 200 步再穿過藍爪1 → 鎖到 500
  const re = step({ ...locked, step: 200, aim: null, aiNextFire: 10 ** 9 }, { blue: L([100, 560], [100, 420]) }).state; // 由 (100,560) 往上：起點在藍身，先碰藍爪1（入點 t=12），x=100 沿線沒有紅器官
  assert.equal(re.lockUntil[X0], 500);
});

test('RT-01 同步出刀：藍鎖 X、紅切 X（X 步開始時未鎖）→ X 被切；藍紅調換結果互換；切除時鎖一併消失', () => {
  const s = at(0);
  const a = step(withAim(s, RED_DOWN_X), { blue: BLUE_ROW }).state;
  assert.equal(a.alive[X0], false, 'X＝藍爪1 被切'); assert.equal(a.lockUntil[X0], 0); assert.equal(a.alive[Y3], false, '藍那刀照樣切到紅爪3');
  // 調換：紅鎖自己的 Y＝紅爪3（由 (200,440) 往上，入點 t=12）、藍切 Y（由 (200,560) 往上，入點 t=52）
  const b = step(withAim(s, L([200, 440], [200, 300])), { blue: L([200, 560], [200, 400]) }).state;
  assert.equal(b.alive[Y3], false, 'Y 被切'); assert.equal(b.lockUntil[Y3], 0);
  // 反例：步開始時 X 已鎖 → 擋下
  const pre = { ...s, lockUntil: s.lockUntil.map((v, i) => (i === X0 ? 50 : v)) };
  const c = step(withAim(pre, RED_DOWN_X), { blue: BLUE_ROW }).state;
  assert.equal(c.alive[X0], true);
});

test('RT-01 刀長：<120 不出刀、不耗冷卻；>420 截斷為 420 再判定', () => {
  const s = at(0);
  const sh = step(s, { blue: L([100, 700], [100, 819.9]) }).state;
  assert.equal(sh.cdUntil.blue, 0); assert.equal(board(sh), board(s));
  // 由 (100,980) 往上 600：截斷後終點 (100,560)，碰不到藍爪1(100,520)（圓下緣 548）——未截斷會碰到
  const r = resolveStrike(s, 'blue', L([100, 975], [100, 375]));
  assert.deepEqual(r.line.b, [100, 555]); assert.deepEqual(r.locks, []); assert.equal(r.severed, null);
});

test('RT-02 冷卻：冷卻內出刀被拒、盤面與冷卻不變；冷卻結束可出刀；雙方冷卻各自獨立', () => {
  const s0 = step(at(0), { blue: BLUE_ROW }).state; // 第 0 步出刀 → 冷卻到 90
  assert.equal(s0.cdUntil.blue, COOLDOWN_STEPS);
  const in89 = step({ ...s0, step: 89 }, { blue: L([300, 560], [300, 420]) });
  assert.ok(in89.events.some((e) => e.t === 'reject' && e.reason === 'cooldown'));
  assert.equal(board(in89.state), board(s0)); assert.equal(in89.state.cdUntil.blue, COOLDOWN_STEPS, '冷卻中放開不重置冷卻');
  const at90 = step({ ...s0, step: 90 }, { blue: L([300, 560], [300, 420]) }).state;
  // 這刀由 (300,560) 往上：碰藍爪2（入點 t=12）→ 鎖；冷卻內被拒時藍爪2 不會被鎖（上面 board 相等即驗）
  assert.equal(at90.lockUntil[idx('藍爪2')], 90 + LOCK_STEPS); assert.equal(at90.cdUntil.blue, 180);
  // 藍冷卻中，紅照樣能出刀；紅出刀不改藍的冷卻
  const red = step(withAim({ ...s0, step: 10 }, L([400, 560], [400, 400])), {}).state; // 紅由 (400,560)（交疊區）往上：碰紅爪2（入點 t=52）→ 鎖
  assert.equal(red.cdUntil.red, 10 + COOLDOWN_STEPS); assert.equal(red.cdUntil.blue, COOLDOWN_STEPS);
  assert.equal(red.lockUntil[idx('紅爪2')], 10 + LOCK_STEPS);
  // 紅冷卻中，藍冷卻好了照樣能出刀
  const blue = step({ ...red, step: 95, aim: null, aiNextFire: 10 ** 9 }, { blue: L([300, 560], [300, 420]) }).state;
  assert.equal(blue.cdUntil.blue, 95 + COOLDOWN_STEPS);
});

// 固定玩家出刀時間表：初始盤面上藍方候選刀，每 100 步取一條（與 AI 無關）
const SCHED = Array.from({ length: 20 }, (_, k) => ({ step: 20 + k * 100, line: candidates(newGame(0), 'blue')[(k * 37) % 1080] }));

test('RT-04 AI 不讀拖曳：參數是完整遊戲狀態（含拖曳線）；兩種拖曳狀態（其一壓在 AI 想切的器官上）→ AI 出刀序列逐值相同', () => {
  const s = newGame(7);
  const pick = aiChoose(s);
  const tgt = resolveStrike({ ...s, cdUntil: { blue: 0, red: 0 } }, 'red', pick.line!).severed;
  assert.notEqual(tgt, null, 'AI 第一刀要切東西（否則壓不到它想切的器官）');
  const p = ORGANS[tgt!].p, onTarget = L([p[0] - 60, p[1] + 5], [p[0] + 60, p[1] + 5]);
  // 直接呼叫：同一狀態只差拖曳線
  assert.deepEqual(aiChoose({ ...s, drag: { blue: onTarget, red: null } }), pick);
  assert.deepEqual(aiChoose({ ...s, drag: { blue: L([20, 990], [30, 990]), red: null } }), pick);
  // 整局：拖曳線在整局都壓在 AI 第一個目標上 vs 拖在角落，AI 序列逐值相同
  const ai = (m: ReturnType<typeof runMatch>) => JSON.stringify({ aims: m.aims, red: m.strikes.filter((x) => x.side === 'red') });
  const A = runMatch(7, SCHED, [{ from: 0, to: END_STEP, line: onTarget }]);
  const B = runMatch(7, SCHED, [{ from: 0, to: END_STEP, line: L([20, 990], [300, 990]) }]);
  const C = runMatch(7, SCHED, []);
  assert.ok(A.aims.length > 10);
  assert.equal(ai(A), ai(B)); assert.equal(ai(A), ai(C));
});

test('RT-05 決定性：同種子＋同玩家時間表跑兩次每一刀與結果逐值相同；換種子至少一局不同', () => {
  const a = runMatch(42, SCHED), b = runMatch(42, SCHED);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.strikes.filter((x) => x.side === 'red').length >= 15, '活性：AI 確實出刀');
  const differs = [43, 44, 45].filter((sd) => JSON.stringify(runMatch(sd, SCHED)) !== JSON.stringify(a));
  assert.ok(differs.length >= 1);
});

test('RT-06 階段：第 2400 步（剛好 40.000 秒）起不能出刀、預告作廢、進入對決；拖曳作廢', () => {
  assert.equal(END_STEP, 2400);
  const last = step(at(2399), { blue: BLUE_ROW });
  assert.equal(last.state.alive[Y3], false, '第 2399 步還能出刀');
  const s = { ...at(2400), drag: { blue: BLUE_ROW, red: null }, aim: { line: RED_DOWN_X, aimStep: 2380, fireStep: 2410 } };
  const end = step(s, { blue: BLUE_ROW });
  assert.equal(end.state.phase, 'duel'); assert.equal(end.state.aim, null); assert.equal(end.state.drag.blue, null);
  assert.equal(board(end.state), board(s), '不再切');
  assert.equal(resolveStrike(end.state, 'blue', BLUE_ROW).reject, 'phase');
  const again = step(end.state, { blue: BLUE_ROW });
  assert.equal(again.state, end.state, '對決期 step 不改狀態');
  // 整局跑完：AI 最後一刀生效步 < 2400
  const m = runMatch(3, SCHED);
  assert.ok(m.strikes.every((x) => x.step < 2400));
});

test('RT-06 戰力＝2 × 爪 × (1＋心)；爪 0＝0；相同＝平手（含雙方 0）', () => {
  assert.equal(power(6, 2), 36); assert.equal(power(3, 1), 12); assert.equal(power(1, 0), 2); assert.equal(power(0, 2), 0);
  const mk = (dead: string[]) => ({ ...newGame(1), alive: ORGANS.map((o) => !dead.includes(o.id)) });
  assert.deepEqual(duel(mk([])), { claws: { blue: 6, red: 6 }, hearts: { blue: 2, red: 2 }, power: { blue: 36, red: 36 }, winner: 'draw' });
  // 藍：爪 4 心 1 → 2×4×2＝16；紅：爪 6 心 0 → 12
  assert.deepEqual(duel(mk(['藍爪1', '藍爪2', '藍心1', '紅心1', '紅心2'])).power, { blue: 16, red: 12 });
  assert.equal(duel(mk(['藍爪1', '藍爪2', '藍心1', '紅心1', '紅心2'])).winner, 'blue');
  // 藍爪全滅（心 2）＝0；紅爪 1 心 0 ＝ 2 → 紅勝
  assert.equal(duel(mk(['藍爪1', '藍爪2', '藍爪3', '藍爪4', '藍爪5', '藍爪6', '紅爪1', '紅爪2', '紅爪3', '紅爪4', '紅爪5', '紅心1', '紅心2'])).winner, 'red');
  const zero = duel(mk(ORGANS.filter((o) => o.kind === 'claw').map((o) => o.id)));
  assert.deepEqual(zero.power, { blue: 0, red: 0 }); assert.equal(zero.winner, 'draw');
});
