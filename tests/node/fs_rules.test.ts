// duel v0.5 千節蛇（the-cut docs/fusion/DUEL_V05_SNAKE.md＋補述 1，DL-089／DL-091）FS-01～04 與 ?cut= 的 Node 部分。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_STEPS, PIERCE_STEPS, REGEN_STEPS, SPROUT_STEPS, candidates, countSide, isReady, newGame, rand, step } from '../../src/rtcut/rules.ts';
import type { GameEvent, GameState, Line, Mode, OrganDef, Side, V } from '../../src/rtcut/rules.ts';
import { toPieces } from '../../src/rtcut/freehand.ts';
import type { PtrEv } from '../../src/rtcut/freehand.ts';
import { simulateBattle } from '../../src/cutbattle/battle.ts';
import type { Fighter } from '../../src/cutbattle/battle.ts';
import { BODY2, R3 } from '../../src/cutbattle/duel3_board.ts';
import { blueOrgans, matchFor, newCampaign, parseCutSeconds, placeCheck, placeStitch, pickStitch, stitchSlots } from '../../src/cutbattle/campaign.ts';
import { SNAKE_GAP_MAX, SNAKE_GAP_MIN, SNAKE_KINDS, SNAKE_POLY, polyCentroid, selfIntersects, snakeAt, SNAKE_ARC } from '../../src/cutbattle/snake_board.ts';

const FRONT = { unit: 60, max: 4 };
// 原版四邊形盤面：藍身 y 430～980、紅身 y 20～570。藍方用蛇的技能（穿刺）或龍（蛻生）
const mode = (blue: 'dragon' | 'snake', extra: Partial<Mode> = {}): Mode => ({ knockout: true, regen: false, r: R3, front: FRONT, beasts: { blue, red: 'dragon' }, ...extra });
const org = (id: string, side: Side, p: V, kind: OrganDef['kind'] = 'claw'): OrganDef => ({ id, side, kind, p });
const game = (organs: OrganDef[], m: Mode, push = 0): GameState => ({ ...newGame(1, m, organs), aiNextFire: 10 ** 9, push, skillUsed: { blue: false, red: false }, severedP: { blue: [], red: [] }, startN: { blue: organs.filter((o) => o.side === 'blue').length, red: organs.filter((o) => o.side === 'red').length } });
const swipe = (a: V, b: V, t0: number, ms = 200, dt = 8): PtrEv[] => {
  const out: PtrEv[] = [{ t: t0, k: 'down', p: a }];
  for (let t = dt; t < ms; t += dt) out.push({ t: t0 + t, k: 'move', p: [a[0] + ((b[0] - a[0]) * t) / ms, a[1] + ((b[1] - a[1]) * t) / ms] });
  out.push({ t: t0 + ms, k: 'move', p: b }, { t: t0 + ms, k: 'up', p: b });
  return out;
};
interface Run { s: GameState; ev: { k: number; e: GameEvent }[] }
function run(s0: GameState, blue: PtrEv[], untilStep: number, extra: { skill?: Record<number, Partial<Record<Side, boolean>>>; blueLine?: Record<number, Line>; redLine?: Record<number, Line> } = {}): Run {
  const qb = toPieces(blue);
  let s = s0; const ev: Run['ev'] = [];
  while (s.step < untilStep && s.phase === 'cut') {
    const k = s.step;
    let st = s;
    if (extra.redLine?.[k]) st = { ...s, aim: { line: extra.redLine[k], aimStep: k - 1, fireStep: k } };
    const out = step(st, { free: qb.get(k) ? { blue: qb.get(k) } : undefined, blue: extra.blueLine?.[k] ?? null, skill: extra.skill?.[k] });
    for (const e of out.events) ev.push({ k, e });
    s = out.state;
  }
  return { s, ev };
}
const ofType = <T extends GameEvent['t']>(r: Run, t: T) => r.ev.filter((x) => x.e.t === t) as { k: number; e: Extract<GameEvent, { t: T }> }[];
const MS = 1000 / 60;

// 一列紅色器官（直線上，x＝350，y＝470／390／310／230）；藍方從 (350,700) 往上劃
const B1 = org('B1', 'blue', [200, 700]);
const reds = [470, 390, 310, 230].map((y, i) => org(`R${i + 1}`, 'red', [350, y]));
const up = (t0: number) => swipe([350, 700], [350, 280], t0, 120);   // 長度 420

// ---------------------------------------------------------------- FS-01 穿刺
test('FS-01 穿刺：一刀依序連切 3 個 → 切到第 3 個就停（第 4 個還在），push +3；每切一個都在碰到的那一步生效', () => {
  const g = game([B1, ...reds], mode('snake'));
  const r = run(g, swipe([350, 700], [350, 150], 10 * MS, 150), 60, { skill: { 2: { blue: true } } });
  const cuts = ofType(r, 'freeCut').map((x) => x.e.i);
  assert.deepEqual(cuts.map((i) => g.organs[i].id), ['R1', 'R2', 'R3']);
  assert.equal(r.s.alive[4], true, '第 4 個沒被切');
  assert.equal(r.s.push, 3);
  assert.deepEqual(ofType(r, 'push').map((x) => x.e.push), [1, 2, 3], '每切一個 push 在那一步各 +1');
  const ks = ofType(r, 'freeCut').map((x) => x.k); assert.ok(ks[0] < ks[2], '依序在不同步生效');
  assert.equal(ofType(r, 'freeEnd')[0].e.why, 'sever');
  assert.equal(ofType(r, 'pierceEnd')[0].e.why, 'used');
});
test('FS-01 穿刺途中撞到已鎖的器官 → 停下，不切那一個；途中劃過自己的器官照常鎖定、刀繼續', () => {
  const own = org('B2', 'blue', [350, 600]);
  const g = game([B1, own, ...reds], mode('snake')); g.lockUntil[3] = LOCK_STEPS;   // R2（索引 3）已鎖
  const r = run(g, swipe([350, 700], [350, 150], 10 * MS, 150), 60, { skill: { 2: { blue: true } } });
  assert.deepEqual(ofType(r, 'freeLock').map((x) => g.organs[x.e.i].id), ['B2'], '自己的器官被鎖、刀繼續');
  assert.deepEqual(ofType(r, 'freeCut').map((x) => g.organs[x.e.i].id), ['R1']);
  assert.equal(ofType(r, 'freeEnd')[0].e.why, 'blocked'); assert.equal(r.s.alive[4], true);
});
test('FS-01 穿刺受刀長 420 限制；萌芽中的對方器官不能切、不算連切數', () => {
  const g = game([B1, ...reds], mode('snake')); g.readyAt[2] = 10 ** 6;   // R2 萌芽中
  const r = run(g, swipe([350, 700], [350, 150], 10 * MS, 150), 60, { skill: { 2: { blue: true } } });
  assert.deepEqual(ofType(r, 'freeCut').map((x) => g.organs[x.e.i].id), ['R1', 'R3'], '萌芽中的 R2 跳過；R4（y＝230）在 420 外');
  assert.equal(ofType(r, 'freeEnd')[0].e.why, 'length');
});
test('FS-01 穿刺 5 秒（300 步）內沒有出刀 → 失效，而且算已使用（再按被拒）；點擊不算出刀', () => {
  const g = game([B1, ...reds], mode('snake'));
  const tap: PtrEv[] = [{ t: 50 * MS, k: 'down', p: [200, 650] }, { t: 50 * MS + 30, k: 'up', p: [200, 650] }];
  const r = run(g, tap, PIERCE_STEPS + 20, { skill: { 2: { blue: true }, [PIERCE_STEPS + 10]: { blue: true } } });
  const pe = ofType(r, 'pierceEnd'); assert.equal(pe.length, 1); assert.equal(pe[0].e.why, 'expired'); assert.ok(pe[0].k >= 2 + PIERCE_STEPS - 1);
  assert.equal(r.s.skillUsed?.blue, true);
  assert.equal(ofType(r, 'skillReject')[0].e.why, 'used', '每場一次');
  // 過期後的刀只切一個
  const r2 = run(r.s, up(r.s.step * MS + 20), r.s.step + 60);
  assert.equal(ofType(r2, 'freeCut').length, 0); assert.equal(ofType(r2, 'freeEnd')[0].e.why, 'sever');
});
test('FS-01 沒有穿刺時維持一刀一個；新的一場重置（matchFor 的 skillUsed 全 false、沒有穿刺）', () => {
  const r = run(game([B1, ...reds], mode('snake')), swipe([350, 700], [350, 150], 10 * MS, 150), 60);
  assert.equal(ofType(r, 'freeCut').length, 0); assert.equal(r.s.alive.filter((a, i) => !a).length, 1); assert.equal(r.s.push, 1);
  const c = newCampaign(3, BODY2, R3, FRONT, { beast: 'snake' }), m0 = matchFor(c), m1 = matchFor({ ...c, stage: 1 });
  for (const m of [m0, m1]) { assert.deepEqual(m.skillUsed, { blue: false, red: false }); assert.equal(m.pierce, undefined); assert.equal(m.mode.beasts?.blue, 'snake'); }
});
test('FS-01 直線預覽的刀也套用穿刺：一刀連切 3 個、push +3', () => {
  const g = game([B1, ...reds], mode('snake'));
  const r = run(g, [], 20, { skill: { 2: { blue: true } }, blueLine: { 5: { a: [350, 700], b: [350, 280] } } });
  const s = ofType(r, 'strike')[0].e.r;
  assert.deepEqual((s.pierced ?? []).map((i) => g.organs[i].id), ['R1', 'R2', 'R3']); assert.equal(r.s.push, 3);
});

test('FS-01 穿刺切中後馬上放開（路徑 <10）不是點擊：進冷卻、穿刺用掉，下一刀被冷卻擋下（審查 C1）', () => {
  const g = game([B1, ...reds], mode('snake'));
  const flick = (y: number, t0: number): PtrEv[] => { const a: V = [350, y + 34 + 5], b: V = [350, y + 34 - 4]; return [{ t: t0, k: 'down', p: a }, { t: t0 + 6, k: 'move', p: b }, { t: t0 + 6, k: 'up', p: b }]; };
  const r = run(g, [...flick(470, 20 * MS + 1), ...flick(390, 40 * MS + 1)], 60, { skill: { 2: { blue: true } } });
  assert.deepEqual(ofType(r, 'freeCut').map((x) => g.organs[x.e.i].id), ['R1']);
  assert.notEqual(ofType(r, 'freeEnd')[0].e.why, 'tap', '切下了東西就不是點擊');
  assert.equal(ofType(r, 'pierceEnd')[0]?.e.why, 'used'); assert.equal(r.s.pierce?.blue, undefined);
  assert.deepEqual(ofType(r, 'freeReject').map((x) => x.e.reason), ['cooldown'], '第二刀在冷卻中');
  assert.equal(r.s.alive[2], true); assert.equal(r.s.push, 1);
});
test('FS-01 直線刀出手就用掉穿刺：同一個 5 秒內的第二刀直線只切一個（審查 H3）', () => {
  const col2 = [470, 390, 310].map((y, i) => org(`S${i + 1}`, 'red', [550, y]));
  const g = game([B1, ...reds.slice(0, 3), ...col2, org('X', 'red', [100, 100])], mode('snake'));
  const r = run(g, [], 120, { skill: { 2: { blue: true } }, blueLine: { 5: { a: [350, 700], b: [350, 280] }, 100: { a: [550, 700], b: [550, 280] } } });
  const st = ofType(r, 'strike').map((x) => x.e.r);
  assert.equal(st.length, 2); assert.equal(st[0].pierced?.length, 3);
  assert.equal(st[1].pierced, undefined, '第二刀沒有穿刺'); assert.equal(g.organs[st[1].severed!].id, 'S1');
  assert.equal(r.s.push, 4);
});
test('FS-01 穿刺有效期內按下的刀，有效期過了還在劃也照樣連切（不因到期中斷）', () => {
  const g = game([B1, ...reds], mode('snake'));
  const k0 = 2 + PIERCE_STEPS - 2;   // 有效期最後幾步內按下，碰到器官時已過期
  const r = run(g, swipe([350, 700], [350, 150], k0 * MS + 1, 150), k0 + 40, { skill: { 2: { blue: true } } });
  const cuts = ofType(r, 'freeCut');
  assert.ok(cuts.length >= 2 && cuts[0].k > 2 + PIERCE_STEPS, `過期後仍連切：${cuts.map((x) => x.k)}`);
  assert.equal(ofType(r, 'pierceEnd')[0].e.why, 'used');
});
// ---------------------------------------------------------------- FS-02 蛻生
test('FS-02 蛻生：按下立刻長回 FIFO 隊首（萌芽 0.5 秒）；沒有可長回的器官時不能按也不算用掉；每場一次', () => {
  const B2 = org('B2', 'blue', [500, 700], 'heart'), B3 = org('B3', 'blue', [350, 800], 'poison');
  const g = game([B1, B2, B3, ...reds], { ...mode('dragon'), maxPerSide: { blue: 3, red: 4 } });
  const none = run(g, [], 5, { skill: { 2: { blue: true } } });
  assert.equal(ofType(none, 'skillReject')[0].e.why, 'none'); assert.equal(none.s.skillUsed?.blue, false, '空用不算用掉');
  // 紅刀先切 B2（心）再切 B3（毒）→ FIFO 隊首＝心
  const r = run(none.s, [], 130, { redLine: { 10: { a: [500, 300], b: [500, 720] }, 110: { a: [350, 380], b: [350, 790] } } });   // 兩刀間隔 >90 步（紅方冷卻）
  assert.deepEqual(r.s.severedQ.blue, ['heart', 'poison']);
  const m = run(r.s, [], r.s.step + 3, { skill: { [r.s.step + 1]: { blue: true } } });
  const sk = ofType(m, 'skill')[0];
  assert.equal(sk.e.kind, 'molt'); assert.equal(m.s.organs[sk.e.i!].kind, 'heart', '長回隊首（心）');
  assert.equal(m.s.readyAt[sk.e.i!], sk.k + SPROUT_STEPS); assert.deepEqual(m.s.severedQ.blue, ['poison']);
  const again = run(m.s, [], m.s.step + 3, { skill: { [m.s.step + 1]: { blue: true } } });
  assert.equal(ofType(again, 'skillReject')[0].e.why, 'used');
});
test('FS-02 AI 蛻生：只在 2×存活 ≤ 開局數時、在 AI 出刀生效的那一步用，每場最多一次；不動 AI 亂數', () => {
  const blues = [org('B1', 'blue', [350, 700])];
  const rs = [org('R1', 'red', [150, 470]), org('R2', 'red', [300, 470]), org('R3', 'red', [450, 470]), org('R4', 'red', [600, 470])];
  const g = game([...blues, ...rs], mode('dragon'));
  const redFire = (k: number): Record<number, Line> => ({ [k]: { a: [100, 200], b: [100, 300] } });   // AI 揮空的一刀（只用來觸發「出刀生效那一步」）
  const calm = (s: GameState): GameState => ({ ...s, aiNextFire: 10 ** 9, aim: null });   // 每段之間關掉 AI 自己的出刀（只用注入的那一刀觸發）
  const cut1 = run(g, swipe([150, 700], [150, 400], 10 * MS, 120), 40, { redLine: redFire(30) });   // 切 1 個：存活 3，2×3 > 4 → 不用
  assert.equal(ofType(cut1, 'skill').length, 0);
  const cut2 = run(calm(cut1.s), swipe([300, 700], [300, 400], 200 * MS, 120), 230, { redLine: redFire(225) });   // 存活 2：2×2 ≤ 4 → 下一刀生效那一步用
  const sk = ofType(cut2, 'skill');
  assert.equal(sk.length, 1); assert.equal(sk[0].e.side, 'red'); assert.equal(sk[0].k, 225);
  const noMolt = run(calm({ ...cut1.s, skillUsed: { blue: false, red: true } }), swipe([300, 700], [300, 400], 200 * MS, 120), 230, { redLine: redFire(225) });
  assert.equal(cut2.s.rng, noMolt.s.rng, '用不用蛻生，AI 亂數相同');
  assert.equal(cut2.s.aiNextFire, noMolt.s.aiNextFire, '出刀排程相同');
  const later = run(calm(cut2.s), swipe([450, 700], [450, 400], 400 * MS, 120), 430, { redLine: redFire(425) });
  assert.equal(ofType(later, 'skill').length, 0, '每場最多一次');
  // 「出刀生效」之外的步不會用（條件成立但 AI 沒出刀）
  const idle = run(calm(cut1.s), swipe([300, 700], [300, 400], 200 * MS, 120), 300);
  assert.equal(ofType(idle, 'skill').length, 0);
});

// ---------------------------------------------------------------- FS-03 蛇牙
const fighters = (blue: string[], red: string[]): Fighter[] => [...blue.map((k, i) => ({ side: 'blue' as Side, id: `b${i}`, kind: k as Fighter['kind'] })), ...red.map((k, i) => ({ side: 'red' as Side, id: `r${i}`, kind: k as Fighter['kind'] }))];
const stackSteps = (res: ReturnType<typeof simulateBattle>, side: Side) => { const ev = res.events.filter((e) => e.t === 'poisonStack' && e.side === side) as Extract<typeof res.events[number], { t: 'poisonStack' }>[]; return ev.map((e, i) => e.stacks - (i ? ev[i - 1].stacks : 0)); };
test('FS-03 蛇牙：戰鬥期有蛇牙時每個毒每次疊 2 層；沒有蛇牙 1 層；2 顆蛇牙仍是 2 層；縫到龍身（藍方任何身體）效果相同', () => {
  const base = ['poison', 'poison', 'claw', 'heart'], foe = ['claw', 'claw', 'heart', 'bone'];
  const with1 = simulateBattle(fighters([...base, 'fang'], foe), 7), none = simulateBattle(fighters(base, foe), 7), with2 = simulateBattle(fighters([...base, 'fang', 'fang'], foe), 7);
  assert.ok(stackSteps(with1, 'blue').length > 3 && stackSteps(with1, 'blue').every((d) => d === 2));
  assert.ok(stackSteps(none, 'blue').every((d) => d === 1));
  assert.ok(stackSteps(with2, 'blue').every((d) => d === 2), '多顆不疊加');
  // 蛇牙被切掉之後（不在戰鬥參與者裡）恢復 1 層：同一盤面、蛇牙存活與否
  const dmg = (r: ReturnType<typeof simulateBattle>) => r.contrib.blue.damage.poison;
  console.log(`[FS-03 只回報] 同盤面毒造成的總傷害：有蛇牙 ${dmg(with1)}、沒蛇牙 ${dmg(none)}（戰鬥時長 ${with1.endMs}／${none.endMs} ms）`);
  // 紅方（對手）的蛇牙也只影響紅方自己的毒
  const redFang = simulateBattle(fighters(base, ['poison', 'claw', 'fang']), 7);
  assert.ok(stackSteps(redFang, 'blue').every((d) => d === 1) && stackSteps(redFang, 'red').every((d) => d === 2));
});

// ---------------------------------------------------------------- FS-04 蛇身與生成
test('FS-04 蛇身：多邊形不自交、重心 y ≤593、中線全程 y ≤600；200 種子初始器官都在蛇身內（整個圓）、相鄰間距 74～88、沿中線順序固定', () => {
  assert.equal(selfIntersects(SNAKE_POLY), false);
  assert.ok(polyCentroid(SNAKE_POLY)[1] <= 593);
  for (let s = 0; s <= SNAKE_ARC; s += 5) assert.ok(snakeAt(s)[1] <= 600);
  let n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = newCampaign(seed, BODY2, R3, FRONT, { beast: 'snake' }), g = matchFor(c), blue = g.organs.filter((o) => o.side === 'blue');
    assert.deepEqual(blue.map((o) => o.kind), SNAKE_KINDS, '排列順序固定');
    for (let i = 0; i < blue.length; i++) {
      assert.equal(placeCheck({ ...c, blueBase: [], stitches: [] }, blue[i].p) === 'outside', false, `seed ${seed} ${blue[i].id} 整個圓在蛇身內`);
      if (i) { const d = Math.hypot(blue[i].p[0] - blue[i - 1].p[0], blue[i].p[1] - blue[i - 1].p[1]); assert.ok(d >= SNAKE_GAP_MIN && d <= SNAKE_GAP_MAX, `seed ${seed} 間距 ${d.toFixed(1)}`); }
      n++;
    }
  }
  assert.equal(n, 1800);
});
test('FS-04 蛇的再生長回原位：200 次再生全部和鄰居間距在 74～88、在蛇身內、依 FIFO 種類；選蛇時紅方生成 200 種子 × 3 場失敗 0', () => {
  let ok = 0, total = 0, genFail = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = newCampaign(seed, BODY2, R3, FRONT, { beast: 'snake' });
    for (let st = 0; st < 3; st++) { try { matchFor({ ...c, stage: st }); } catch { genFail++; } }
    if (total >= 200) continue;
    // 紅刀切掉藍蛇的第 2、5 顆（間隔一顆），再推到再生節拍：長回 FIFO 隊首到它的原位
    let g: GameState = { ...matchFor(c), aiNextFire: 10 ** 9 };
    const blueIdx = g.organs.map((o, i) => i).filter((i) => g.organs[i].side === 'blue');
    const order = [blueIdx[1 + (seed % 7)], blueIdx[(seed * 3) % 9]].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) { const s = { ...g, alive: [...g.alive], lockUntil: [...g.lockUntil], severedQ: { blue: [...g.severedQ.blue, g.organs[i].kind], red: [...g.severedQ.red] }, severedP: { blue: [...g.severedP!.blue, g.organs[i].p], red: [] } }; s.alive[i] = false; g = s; }
    const before = order.map((i) => g.organs[i]);
    while (g.step <= 300) g = step(g, {}).state;
    const grown = g.organs.slice(-1)[0];
    total++;
    const neigh = g.organs.filter((o, i) => o.side === 'blue' && g.alive[i] && o !== grown).map((o) => Math.hypot(o.p[0] - grown.p[0], o.p[1] - grown.p[1]));
    const near = Math.min(...neigh);
    if (grown.kind === before[0].kind && grown.p[0] === before[0].p[0] && grown.p[1] === before[0].p[1] && near >= SNAKE_GAP_MIN && near <= SNAKE_GAP_MAX && placeCheck({ ...c, blueBase: [], stitches: [] }, grown.p) !== 'outside') ok++;
  }
  console.log(`[FS-04] 蛇再生 ${ok}/${total} 次和鄰居間距在 74～88、長回原位；紅方生成失敗 ${genFail}/600`);
  assert.equal(ok, 200); assert.equal(genFail, 0);
});
test('FS-04 真實對局（AI 開著）：蛇的原位不會被紅方再生的器官佔住，FIFO 隊首每個再生節拍都長得回來；長回時不和任何存活器官重疊（審查 H1）', () => {
  let games = 0, stall = 0, overlap = 0, regrown = 0;
  for (let seed = 1; seed <= 40; seed++) for (let stage = 0; stage < 2; stage++) {
    const c = { ...newCampaign(seed, BODY2, R3, FRONT, { beast: 'snake', cutSeconds: 60 }), stage };
    let s = matchFor(c), r = (seed * 2654435761 + stage) >>> 0, u: number, wait = 0;
    games++;
    while (s.phase === 'cut') {
      let blue: Line | null = null;
      if (s.cdUntil.blue <= s.step) { if (wait <= 0) { [u, r] = rand(r); wait = Math.floor(u * 40); } else if (--wait === 0) { const cs = candidates(s, 'blue'); [u, r] = rand(r); blue = cs[Math.floor(u * cs.length)] ?? null; } }
      const k = s.step, out = step(s, { blue }), ns = out.state;
      for (const e of out.events) if (e.t === 'spawn') {
        const o = ns.organs[e.i]; if (o.side === 'blue') regrown++;
        if (ns.organs.some((q, i) => i !== e.i && ns.alive[i] && Math.hypot(q.p[0] - o.p[0], q.p[1] - o.p[1]) < 2 * R3)) overlap++;
      }
      if (ns.phase === 'cut' && k > 0 && k % REGEN_STEPS === 0 && s.severedQ.blue.length && countSide(s, 'blue') < (s.mode.maxPerSide?.blue ?? 8)
        && !out.events.some((e) => e.t === 'spawn' && ns.organs[e.i].side === 'blue')) stall++;
      s = ns;
    }
  }
  console.log(`[FS-04] 真實對局 ${games} 場：蛇長回 ${regrown} 次、該長卻沒長 ${stall} 次、長回時重疊 ${overlap} 次`);
  assert.ok(regrown > 0); assert.equal(stall, 0); assert.equal(overlap, 0);
});
test('FS-04 原位被存活器官佔住時不長回去（不重疊）', () => {
  const c = newCampaign(1, BODY2, R3, FRONT, { beast: 'snake' });
  let g: GameState = { ...matchFor(c), aiNextFire: 10 ** 9 };
  const bi = g.organs.findIndex((o) => o.id === '藍心1'), slot = g.organs[bi].p;
  g = { ...g, alive: [...g.alive], lockUntil: [...g.lockUntil, 0], readyAt: [...g.readyAt, 0], organs: [...g.organs, org('紅爪X', 'red', [slot[0], slot[1] - 40])], severedQ: { blue: ['heart'], red: [] }, severedP: { blue: [slot], red: [] } };
  g.alive[bi] = false; g.alive.push(true);
  while (g.step <= 2 * REGEN_STEPS + 1) g = step(g, {}).state;
  const n = g.organs.length;
  assert.ok(!g.organs.slice(n - 3).some((o, j) => o.side === 'blue' && o.kind === 'heart' && g.alive[n - 3 + j] && Math.hypot(o.p[0] - slot[0], o.p[1] - slot[1] + 40) < 2 * R3), '沒有長在被佔的位置上');
});
test('FS-04 蛇的縫合槽位：每個種子 ≥1 個、都在中線上、通過 placeCheck、和最近己方器官間距 74～88；連縫兩次都有槽位', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let c = { ...newCampaign(seed, BODY2, R3, FRONT, { beast: 'snake' }), phase: 'pick' as const, offer: ['claw' as const, 'heart' as const, 'eye' as const] };
    for (let k = 0; k < 2; k++) {
      c = pickStitch({ ...c, phase: 'pick', offer: ['claw', 'heart', 'eye'] }, 'claw') as typeof c;
      const sl = stitchSlots(c);
      assert.ok(sl.length >= 1, `seed ${seed} 第 ${k + 1} 次縫合有槽位`);
      for (const q of sl) {
        assert.equal(placeCheck(c, q), null);
        const d = Math.min(...blueOrgans(c).map((o) => Math.hypot(o.p[0] - q[0], o.p[1] - q[1])));
        assert.ok(d >= SNAKE_GAP_MIN && d <= SNAKE_GAP_MAX);
      }
      const r = placeStitch(c, sl[0]); assert.equal(r.reject, null); c = { ...r.c } as typeof c;
    }
  }
});
test('FS-04 蛇身作為起刀區：用 v0.4 的起刀區函式，push 延伸照常（蛇身內允許、上方 30 處 push=0 拒絕／push=1 允許）', async () => {
  const { inStartZone } = await import('../../src/rtcut/rules.ts');
  const c = newCampaign(5, BODY2, R3, FRONT, { beast: 'snake' }), m = matchFor(c).mode;
  const p: V = [402, 400], top: V = [402, 310];   // 波峰（x＝12＋3λ/4，中線 y＝400、斜率 0）；正上方 90＝蛇身上緣再往上 30，在紅龍身內
  assert.equal(inStartZone(m, 0, 'blue', p), true);
  assert.equal(inStartZone(m, 0, 'blue', top), false);
  assert.equal(inStartZone(m, 1, 'blue', top), true);
  assert.equal(countSide(matchFor(c), 'blue'), 9); assert.ok(isReady(matchFor(c), 0));
});

// ---------------------------------------------------------------- ?cut=（DL-091）
test('補述 1 第 11 條 ?cut= 解析：20～60 的整數有效；19、61、abc、40.5、空值、null 都回 30；40 秒的切割期在第 2400 步結束', () => {
  assert.equal(parseCutSeconds('40'), 40); assert.equal(parseCutSeconds('20'), 20); assert.equal(parseCutSeconds('60'), 60);
  for (const v of ['19', '61', 'abc', '40.5', '', ' ', '-30', '1e2', null, undefined]) assert.equal(parseCutSeconds(v as string | null | undefined), 30, String(v));
  const c = newCampaign(1, BODY2, R3, FRONT, { beast: 'dragon', cutSeconds: 40 });
  assert.equal(matchFor(c).mode.cutSteps, 2400);
  let g: GameState = { ...matchFor(c), aiNextFire: 10 ** 9 };
  while (g.phase === 'cut' && g.step < 2400) g = step(g, {}).state;
  assert.equal(g.phase, 'cut', '第 2399 步還在切割期');
  g = step(g, {}).state; assert.equal(g.phase, 'duel');
  assert.equal(matchFor(newCampaign(1, BODY2, R3, FRONT, { beast: 'dragon' })).mode.cutSteps, 1800, '不給＝30 秒');
});
