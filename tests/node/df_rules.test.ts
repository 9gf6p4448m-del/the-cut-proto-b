// duel v0.3 手感與可讀性（the-cut docs/fusion/DUEL_V03_FEEL.md，DL-084）DF-01／DF-02／DF-04 的 Node 部分。作者測試。
// 即時劃刀的規則是純函式：餵「時間戳＋座標」事件序列（src/rtcut/freehand.ts 切片 → rules.ts step 的 free 輸入）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY, COOLDOWN_STEPS, countSide, FREE_MIN_SPEED, LOCK_STEPS, MAX_LEN, REGEN_STEPS, SPROUT_STEPS, inside, newGame, step } from '../../src/rtcut/rules.ts';
import type { GameEvent, GameState, Line, Mode, OrganDef, Side, V } from '../../src/rtcut/rules.ts';
import { STEP_MS, toPieces } from '../../src/rtcut/freehand.ts';
import type { PtrEv } from '../../src/rtcut/freehand.ts';
import { BODY2, R3 } from '../../src/cutbattle/duel3_board.ts';
import { genStats, matchFor, newCampaign, placeCheck } from '../../src/cutbattle/campaign.ts';

// ---------------------------------------------------------------- 工具
const MODE: Mode = { knockout: true, regen: false, r: R3 };   // 原版四邊形盤面（上下對稱，方便對調雙方）＋半徑 34
const org = (id: string, side: Side, p: V): OrganDef => ({ id, side, kind: 'claw', p });
const game = (organs: OrganDef[], mode: Mode = MODE): GameState => ({ ...newGame(1, mode, organs), aiNextFire: 10 ** 9 });
/** 直線等速的路徑：從 a 到 b、從 t0 起花 ms 毫秒，每 dt 毫秒取樣一次（含終點），最後放開。 */
function swipe(a: V, b: V, t0: number, ms: number, dt: number, end: 'up' | 'cancel' | 'multi' | null = 'up'): PtrEv[] {
  const out: PtrEv[] = [{ t: t0, k: 'down', p: a }];
  for (let t = dt; t < ms; t += dt) out.push({ t: t0 + t, k: 'move', p: [a[0] + ((b[0] - a[0]) * t) / ms, a[1] + ((b[1] - a[1]) * t) / ms] });
  out.push({ t: t0 + ms, k: 'move', p: b });
  if (end) out.push({ t: t0 + ms, k: end, p: b });
  return out;
}
/** 折線路徑：頂點與到達時間（各段等速，可不同速），每 dt 毫秒取樣。 */
function poly(pts: { p: V; t: number }[], dt: number): PtrEv[] {
  const out: PtrEv[] = [{ t: pts[0].t, k: 'down', p: pts[0].p }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    for (let t = a.t + dt; t < b.t - 1e-9; t += dt) { const u = (t - a.t) / (b.t - a.t); out.push({ t, k: 'move', p: [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u] }); }
    out.push({ t: b.t, k: 'move', p: b.p });
  }
  out.push({ t: pts[pts.length - 1].t, k: 'up', p: pts[pts.length - 1].p });
  return out;
}
interface Run { s: GameState; ev: { k: number; e: GameEvent }[] }
/** 把事件序列餵進固定步長模擬，跑到 untilStep（AI 不出刀；red 可另給直線刀表或即時事件）。 */
function run(s0: GameState, blue: PtrEv[], untilStep: number, extra: { redLine?: Record<number, Line>; red?: PtrEv[]; blueLine?: Record<number, Line> } = {}): Run {
  const qb = toPieces(blue), qr = toPieces(extra.red ?? []);
  let s = s0; const ev: Run['ev'] = [];
  while (s.step < untilStep && s.phase === 'cut') {
    const k = s.step;
    const free: { blue?: ReturnType<typeof qb.get>; red?: ReturnType<typeof qb.get> } = {};
    if (qb.get(k)) free.blue = qb.get(k); if (qr.get(k)) free.red = qr.get(k);
    let st = s;
    if (extra.redLine?.[k]) st = { ...s, aim: { line: extra.redLine[k], aimStep: k - 1, fireStep: k } };
    const out = step(st, { free: free as never, blue: extra.blueLine?.[k] ?? null });
    for (const e of out.events) ev.push({ k, e });
    s = out.state;
  }
  return { s, ev };
}
const ofType = <T extends GameEvent['t']>(r: Run, t: T) => r.ev.filter((x) => x.e.t === t) as { k: number; e: Extract<GameEvent, { t: T }> }[];
const stepOf = (ms: number) => Math.floor(ms / STEP_MS + 1e-9);

// 盤面：藍身 y 430～980、紅身 y 20～570（原版四邊形）。藍爪 B1 (350,640)、紅爪 R1 (350,470)、R2 (500,470)。
const B1 = org('B1', 'blue', [350, 640]), R1 = org('R1', 'red', [350, 470]), R2 = org('R2', 'red', [500, 470]);

// ---------------------------------------------------------------- DF-01
test('DF-01 起刀：按下點在自己獸身外 → 忽略（start）；冷卻中 → 忽略（cooldown）；獸身內且冷卻好 → 起刀', () => {
  const g = game([B1, R1]);
  const out = run(g, swipe([350, 300], [350, 200], 100, 100, 8), 40);   // y=300 在藍身外
  assert.deepEqual(ofType(out, 'freeReject').map((x) => x.e.reason), ['start']);
  assert.equal(ofType(out, 'freeStart').length, 0);
  assert.ok(out.s.alive.every(Boolean));
  const cd = { ...g, cdUntil: { blue: 30, red: 0 } };
  const o2 = run(cd, swipe([350, 760], [350, 380], 100, 100, 8), 40);    // 第 6 步按下，冷卻到第 30 步
  assert.deepEqual(ofType(o2, 'freeReject').map((x) => x.e.reason), ['cooldown']);
  assert.ok(o2.s.alive.every(Boolean), '冷卻中按下：整條路徑都不該有效果');
  const o3 = run(g, swipe([350, 760], [350, 380], 100, 100, 8), 40);
  assert.equal(ofType(o3, 'freeStart').length, 1);
  assert.equal(o3.s.alive[1], false, '冷卻好、獸身內起刀，快速劃過紅爪 → 切除');
});
test('DF-01 速度門檻：同一路徑快切會切、慢描不會切（鈍刀不鎖不切、長度照算）；門檻 0.6 px/ms 兩側', () => {
  const g = game([B1, R1]);
  const path = (ms: number) => swipe([350, 700], [350, 400], 50, ms, 8);   // 300px：經過 B1 再經過 R1
  const fast = run(g, path(150), 200), slow = run(g, path(1000), 200);   // 2 px/ms vs 0.3 px/ms
  assert.equal(fast.s.alive[1], false); assert.ok(fast.s.lockUntil[0] > 0, '快切：經過自己的器官要鎖');
  assert.equal(slow.s.alive[1], true); assert.equal(slow.s.lockUntil[0], 0, '慢描：不鎖不切');
  const se = ofType(slow, 'freeEnd'); assert.equal(se.length, 1); assert.equal(se[0].e.why, 'up');
  assert.ok(Math.abs(se[0].e.len - 300) < 1e-6, `鈍刀長度照算：${se[0].e.len}`);
  // 門檻兩側：300px 在 300/0.6=500ms 內劃完＝0.6（切）；502ms＝0.5976（不切）
  assert.equal(run(g, path(500), 200).s.alive[1], false);
  assert.equal(run(g, path(502), 200).s.alive[1], true);
  assert.equal(FREE_MIN_SPEED, 0.6);
  // 同一刀前段慢、後段快：只有快段有效（慢段經過 B1 不鎖，快段經過 R1 切）
  const mix = run(g, poly([{ p: [350, 760], t: 0 }, { p: [350, 560], t: 600 }, { p: [350, 400], t: 680 }], 8), 200);
  assert.equal(mix.s.lockUntil[0], 0); assert.equal(mix.s.alive[1], false);
  // 審查 M-1：慢描到 R1 圓邊外，放開事件和最後一點同時間戳（dt=0）卻跳一段：不能當成無限快
  const jump = run(g, [{ t: 0, k: 'down', p: [350, 760] }, ...Array.from({ length: 20 }, (_, i) => ({ t: 40 * (i + 1), k: 'move' as const, p: [350, 760 - 12 * (i + 1)] as V })), { t: 800, k: 'move', p: [350, 470] }, { t: 800, k: 'up', p: [350, 470] }], 200);
  assert.equal(jump.s.alive[1], true, '同時間戳的跳點沿用上一段（慢）速度＝鈍刀');
});
test('DF-01 鎖定（含刷新、同一刀同一器官只處理一次）、切除即結束、撞到已鎖的對方器官停刀', () => {
  const g = game([B1, R1, R2]);
  const o = run(g, swipe([350, 760], [350, 380], 0, 100, 8), 300);
  const lock = ofType(o, 'freeLock'), end = ofType(o, 'freeEnd');
  assert.equal(lock.length, 1); assert.equal(o.s.lockUntil[0], lock[0].k + LOCK_STEPS, '鎖定從經過那一步起算 5 秒');
  assert.equal(end[0].e.why, 'sever'); assert.equal(end[0].e.severed, 1);
  assert.deepEqual(o.s.severedQ.red, ['claw']); assert.equal(o.s.severedN.blue, 1);
  assert.ok(Math.abs(end[0].e.end[1] - (470 + R3)) < 1e-6, `刀停在 R1 的圓邊：${end[0].e.end}`);
  // 切到後同一刀不再有效果：路徑繼續往右經過 R2 也不切
  const o2 = run(g, poly([{ p: [350, 760], t: 0 }, { p: [350, 470], t: 100 }, { p: [500, 470], t: 150 }], 8), 300);
  assert.equal(o2.s.alive[1], false); assert.equal(o2.s.alive[2], true);
  // 來回穿過自己的 B1 兩次：只鎖一次
  const zig = run(g, poly([{ p: [350, 760], t: 0 }, { p: [350, 560], t: 60 }, { p: [350, 760], t: 120 }, { p: [200, 760], t: 170 }], 8), 300);
  assert.equal(ofType(zig, 'freeLock').length, 1);
  // 刷新：第一刀鎖住後，下一刀（冷卻後）再經過 → lockUntil 往後延
  const twice = run(g, [...swipe([340, 760], [340, 560], 0, 60, 8), ...swipe([340, 760], [340, 560], 2000, 60, 8)], 400);
  const lk = ofType(twice, 'freeLock'); assert.equal(lk.length, 2); assert.equal(twice.s.lockUntil[0], lk[1].k + LOCK_STEPS);
  // 撞鎖：R1 已鎖 → 停刀、沒有效果、刀結束（後面的 R2 不切）
  const lockedR1 = { ...g, lockUntil: [0, 10 ** 6, 0] };
  const b = run(lockedR1, poly([{ p: [350, 760], t: 0 }, { p: [350, 470], t: 100 }, { p: [500, 470], t: 150 }], 8), 300);
  const be = ofType(b, 'freeEnd');
  assert.equal(be[0].e.why, 'blocked'); assert.equal(be[0].e.blocked, 1);
  assert.ok(b.s.alive[1] && b.s.alive[2]);
  // 萌芽中的對方器官：不切、不擋（穿過去後面的照切）
  const sprout = { ...g, readyAt: [0, 10 ** 6, 0] };
  const sp = run(sprout, poly([{ p: [350, 760], t: 0 }, { p: [350, 470], t: 100 }, { p: [500, 470], t: 150 }], 8), 300);
  assert.ok(sp.s.alive[1]); assert.equal(sp.s.alive[2], false);
});
test('DF-01 長度 420 截止；放開、cancel、第二指都會結束；冷卻 1.5 秒從刀結束那一步起算', () => {
  const g = game([B1, R1]);
  // 一直劃不放（在藍身內來回、不碰器官）：長度到 420 結束
  const long = run(g, poly([{ p: [100, 900], t: 0 }, { p: [600, 900], t: 250 }, { p: [100, 900], t: 500 }], 8), 200);
  const le = ofType(long, 'freeEnd');
  assert.equal(le.length, 1); assert.equal(le[0].e.why, 'length'); assert.ok(Math.abs(le[0].e.len - MAX_LEN) < 1e-6);
  assert.ok(Math.abs(le[0].e.end[0] - 520) < 1e-6, `420px 截止點：${le[0].e.end}`);
  assert.equal(le[0].k, stepOf(210), '長度到的那一刻（210ms）所在的步結束');
  assert.equal(long.s.cdUntil.blue, le[0].k + COOLDOWN_STEPS);
  for (const why of ['up', 'cancel', 'multi'] as const) {
    const o = run(g, swipe([100, 900], [300, 900], 0, 100, 8, why), 200);
    const e = ofType(o, 'freeEnd');
    assert.equal(e.length, 1); assert.equal(e[0].e.why, why); assert.equal(e[0].k, stepOf(100));
    assert.equal(o.s.cdUntil.blue, stepOf(100) + COOLDOWN_STEPS);
  }
  // 冷卻：結束在第 6 步 → 第 95 步按下被拒、第 96 步可以
  const end = stepOf(100);
  const t95 = (end + COOLDOWN_STEPS - 1) * STEP_MS + 1, t96 = (end + COOLDOWN_STEPS) * STEP_MS + 1;
  const c1 = run(g, [...swipe([100, 900], [300, 900], 0, 100, 8), ...swipe([350, 760], [350, 380], t95, 100, 8)], 400);
  assert.ok(c1.s.alive[1]); assert.equal(ofType(c1, 'freeReject')[0].e.reason, 'cooldown');
  const c2 = run(g, [...swipe([100, 900], [300, 900], 0, 100, 8), ...swipe([350, 760], [350, 380], t96, 100, 8)], 400);
  assert.equal(c2.s.alive[1], false);
  // 同一步內：一刀結束後立刻再按下（還在同一個 1/60 秒內）→ 也算冷卻中
  const same = run(g, [{ t: 20, k: 'down', p: [100, 900] }, { t: 22, k: 'move', p: [140, 900] }, { t: 23, k: 'up', p: [140, 900] }, { t: 25, k: 'down', p: [350, 760] }, { t: 30, k: 'move', p: [350, 380] }, { t: 31, k: 'up', p: [350, 380] }], 40);
  assert.equal(stepOf(20), stepOf(31));
  assert.deepEqual(ofType(same, 'freeReject').map((x) => x.e.reason), ['cooldown']); assert.ok(same.s.alive[1]);
  // 補述 1：輕點（總長 <10、沒有鎖定／切除）不算一刀、不進冷卻；超過 10 或有鎖定才進冷卻
  const tapRun = run(g, [{ t: 20, k: 'down', p: [100, 900] }, { t: 40, k: 'move', p: [106, 904] }, { t: 60, k: 'up', p: [106, 904] }], 40);
  assert.deepEqual(ofType(tapRun, 'freeEnd').map((x) => x.e.why), ['tap']); assert.equal(tapRun.s.cdUntil.blue, 0, '輕點不進冷卻');
  const tapThenCut = run(g, [{ t: 20, k: 'down', p: [100, 900] }, { t: 30, k: 'up', p: [100, 900] }, ...swipe([350, 760], [350, 380], 100, 100, 8)], 40);
  assert.equal(tapThenCut.s.alive[1], false, '輕點後馬上劃刀照樣能切');
  const move11 = run(g, [{ t: 20, k: 'down', p: [100, 900] }, { t: 40, k: 'move', p: [111, 900] }, { t: 60, k: 'up', p: [111, 900] }], 40);
  assert.equal(ofType(move11, 'freeEnd')[0].e.why, 'up'); assert.equal(move11.s.cdUntil.blue, stepOf(60) + COOLDOWN_STEPS, '移動超過 10 進冷卻');
  const tapLock = run(game([org('B5', 'blue', [100, 900]), R1]), [{ t: 20, k: 'down', p: [100, 900] }, { t: 22, k: 'move', p: [104, 900] }, { t: 23, k: 'up', p: [104, 900] }], 40);
  assert.equal(ofType(tapLock, 'freeLock').length, 1); assert.equal(ofType(tapLock, 'freeEnd')[0].e.why, 'up'); assert.ok(tapLock.s.cdUntil.blue > 0, '短但有鎖定＝一刀，進冷卻');
  // 切割期結束：進行中的刀作廢
  const shortGame = game([B1, R1], { ...MODE, cutSteps: 10 });
  const pe = run(shortGame, swipe([100, 900], [300, 900], 100, 400, 8), 100);
  assert.notEqual(pe.s.phase, 'cut'); assert.equal(pe.s.stroke?.blue ?? null, null);
});

// ---------------------------------------------------------------- DF-02
test('DF-02 取樣密度：同一路徑每 8ms 與每 16ms 餵入，結果（每個事件與發生的步、最終盤面）相同；300 條隨機路徑', () => {
  let rnd = 12345; const u = () => ((rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296);
  let effects = 0;
  for (let n = 0; n < 300; n++) {
    const c = newCampaign(1 + (n % 40), BODY2, R3), g = { ...matchFor(c), aiNextFire: 10 ** 9 };
    // 起點：藍龍身內的點；之後 2～5 段，各段長度 60～260、速度 0.2～3 px/ms，頂點時間為 16 的倍數
    let p: V = [0, 0]; do p = [40 + u() * 620, 400 + u() * 580]; while (!inside(p, BODY2.blue));
    const t0 = 16 * Math.floor(u() * 20);
    const pts = [{ p, t: t0 }];
    for (let k = 0, m = 2 + Math.floor(u() * 4); k < m; k++) {
      const th = u() * 2 * Math.PI, len = 60 + u() * 200, v = 0.2 + u() * 2.8;
      const last = pts[pts.length - 1];
      pts.push({ p: [last.p[0] + Math.cos(th) * len, last.p[1] - Math.abs(Math.sin(th)) * len], t: last.t + 16 * Math.max(1, Math.round(len / v / 16)) });
    }
    const a = run(g, poly(pts, 8), 200), b = run(g, poly(pts, 16), 200);
    const sig = (r: Run) => r.ev.map(({ k, e }) => `${k}:${e.t}:${'i' in e ? e.i : ''}:${'why' in e ? e.why : ''}:${'severed' in e ? e.severed : ''}:${'blocked' in e ? e.blocked : ''}:${'reason' in e ? e.reason : ''}`);
    assert.deepEqual(sig(a), sig(b), `路徑 ${n}`);
    assert.deepEqual([a.s.alive, a.s.lockUntil, a.s.cdUntil], [b.s.alive, b.s.lockUntil, b.s.cdUntil], `路徑 ${n}`);
    const ea = ofType(a, 'freeEnd'), eb = ofType(b, 'freeEnd');
    ea.forEach((x, i) => assert.ok(Math.abs(x.e.len - eb[i].e.len) < 1e-6 && Math.hypot(x.e.end[0] - eb[i].e.end[0], x.e.end[1] - eb[i].e.end[1]) < 1e-6, `路徑 ${n} 結束點`));
    effects += ofType(a, 'freeLock').length + ea.filter((x) => x.e.severed !== null || x.e.blocked !== null).length;
  }
  assert.ok(effects >= 100, `隨機路徑至少要有 100 次鎖／切／撞（有行使到規則）：${effects}`);
});
test('DF-02 和 AI 同一步出刀：依步開始狀態判定；對調雙方（上下鏡射＋紅藍互換）結果互換', () => {
  // 盤面上下對稱：藍 B1 (350,640)／紅 R1 (350,360)；藍 B2 (500,640)／紅 R2 (500,360)
  const mirror = (p: V): V => [p[0], 1000 - p[1]];
  const organs = [org('B1', 'blue', [350, 640]), org('R1', 'red', [350, 360]), org('B2', 'blue', [500, 640]), org('R2', 'red', [500, 360])];
  const g = game(organs);
  assert.deepEqual(BODY.red.map(mirror).sort(), BODY.blue.map((p) => p).sort(), '原版四邊形上下對稱');
  // 第 k 步：藍方即時刀「經過 B1（鎖）再切 R1」；紅方直線刀同一步切 B1。步開始時 B1 未鎖 → 紅方照樣切掉 B1。
  const blue = swipe([350, 700], [350, 380], 3 * STEP_MS + 1, 10, 2);
  const kHit = stepOf(3 * STEP_MS + 1 + 10);
  const redLine: Line = { a: [350, 300], b: [350, 700] };
  const A = run(g, blue, 20, { redLine: { [kHit]: redLine } });
  assert.equal(A.s.alive[0], false, '紅方同一步切 B1：判定看步開始狀態（B1 未鎖）');
  assert.equal(A.s.alive[1], false, '藍方切 R1');
  assert.equal(ofType(A, 'freeLock').length, 1);
  // 對調：紅方即時刀（鏡射路徑），藍方直線刀（鏡射）
  const mOrgans = organs.map((o) => ({ ...o, side: (o.side === 'blue' ? 'red' : 'blue') as Side, p: mirror(o.p) }));
  const gm = game(mOrgans);
  const redFree = blue.map((e) => ({ ...e, p: mirror(e.p) }));
  const B = run(gm, [], 20, { red: redFree, blueLine: { [kHit]: { a: mirror(redLine.a), b: mirror(redLine.b) } } });
  assert.deepEqual(B.s.alive, A.s.alive, '對調後：同樣是「被即時刀切的那方」與「被直線刀切的那方」對應同一個器官');
  assert.deepEqual(B.s.severedN, { blue: A.s.severedN.red, red: A.s.severedN.blue });
  assert.deepEqual(B.s.cdUntil, { blue: A.s.cdUntil.red, red: A.s.cdUntil.blue });
});

// ---------------------------------------------------------------- DF-04（Node：判定半徑與生成）
test('DF-04 判定半徑 34：圓心距 33.9 的刀會切、34.1 不會；duel／duel2 的設定仍是 28', () => {
  const g = game([B1, org('R9', 'red', [350, 470])]);
  const at = (x: number) => run(g, swipe([x, 760], [x, 380], 0, 100, 8), 40).s.alive[1];
  assert.equal(at(350 - 33.9), false); assert.equal(at(350 - 34.1), true);
  assert.equal(newCampaign(3, BODY2).r, undefined);
  assert.equal(matchFor(newCampaign(3, BODY2)).mode.r, undefined);
  assert.equal(matchFor(newCampaign(3, BODY2, R3)).mode.r, 34);
});
test('DF-04 200 種子：初始器官（3 場）與再生位置整個圓（半徑 34）在龍身內、對方碰得到、中心距 ≥2R；回報生成失敗率', () => {
  const ring = (p: V, poly: V[]) => { for (let i = 0; i < 36; i++) { const a = (i * Math.PI) / 18; if (!inside([p[0] + Math.cos(a) * R3, p[1] + Math.sin(a) * R3], poly)) return false; } return true; };
  const reach = (p: V, attacker: Side) => { const poly = BODY2[attacker]; for (const [x, y] of poly) if (Math.hypot(p[0] - x, p[1] - y) <= MAX_LEN + R3 - 1) return true; return inside(p, poly); };
  genStats.calls = 0; genStats.first = 0; genStats.final = 0;
  let organs = 0, spawns = 0, regenTry = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = newCampaign(seed, BODY2, R3);
    for (let stage = 0; stage < 3; stage++) {
      const s = matchFor({ ...c, stage });
      s.organs.forEach((o, i) => {
        organs++;
        assert.ok(ring(o.p, BODY2[o.side]), `seed ${seed} ${o.id} 圓超出龍身`);
        assert.ok(reach(o.p, o.side === 'blue' ? 'red' : 'blue'), `seed ${seed} ${o.id} 對方碰不到`);
        s.organs.forEach((q, j) => { if (j > i) assert.ok(Math.hypot(o.p[0] - q.p[0], o.p[1] - q.p[1]) >= 2 * R3, `seed ${seed} 重疊`); });
      });
    }
    let s: GameState = { ...matchFor(c), aiNextFire: 10 ** 9 };
    s = { ...s, alive: s.alive.map((a, i) => i % 3 !== 0), severedQ: { blue: ['heart', 'poison', 'claw'], red: ['claw', 'eye', 'bone'] } };
    while (s.step < 3 * REGEN_STEPS + 1) {
      const k = s.step, out = step(s, {});
      if (k > 0 && k % REGEN_STEPS === 0) for (const side of ['blue', 'red'] as Side[]) if (countSide(s, side) < (s.mode.maxPerSide?.[side] ?? 8) && s.severedQ[side].length) regenTry++;
      for (const e of out.events) if (e.t === 'spawn') {
        spawns++; const o = out.state.organs[e.i];
        assert.ok(ring(o.p, BODY2[o.side]), `seed ${seed} 再生 ${o.p} 圓超出龍身`);
        assert.ok(out.state.organs.every((q, j) => j === e.i || !out.state.alive[j] || Math.hypot(q.p[0] - o.p[0], q.p[1] - o.p[1]) >= 2 * R3), `seed ${seed} 再生重疊`);
        assert.equal(out.state.readyAt[e.i], k + SPROUT_STEPS);
      }
      s = out.state;
    }
  }
  const regenMiss = regenTry - spawns;
  console.log(`[DF-04 生成] 初始：genRed/genBlueBase 呼叫 ${genStats.calls} 次，第一次亂數流失敗而重抽 ${genStats.first} 次（${(100 * genStats.first / genStats.calls).toFixed(2)}%），20 次都失敗 ${genStats.final} 次；再生：應長 ${regenTry} 次、實際長 ${spawns} 次（400 次取樣找不到位置 ${regenMiss} 次，${(100 * regenMiss / regenTry).toFixed(2)}%）`);
  assert.equal(genStats.final, 0);
  assert.ok(organs >= 200 * 3 * 18 && spawns >= 800, `${organs} ${spawns}`);
  // 縫合擺放用同一個半徑
  const c = newCampaign(7, BODY2, R3), pc = { ...c, phase: 'place' as const, picked: 'claw' as const };
  const o = c.blueBase[0].p;
  assert.equal(placeCheck(pc, [o[0] + 10, o[1]]), 'overlap');
  // 同一組藍方器官，只差半徑：距某器官 61 的點，半徑 28 不算重疊（≥2·28+4）、半徑 34 算重疊（<2·34+4）
  const pc28 = { ...pc, r: undefined };
  let found = 0;
  for (let k = 0; k < 72; k++) {
    const q: V = [o[0] + Math.cos((k * Math.PI) / 36) * 61, o[1] + Math.sin((k * Math.PI) / 36) * 61];
    if (placeCheck(pc28, q) !== null || placeCheck(pc, q) === 'outside' || placeCheck(pc, q) === 'unreachable') continue;   // 只比重疊這一項
    found++; assert.equal(placeCheck(pc, q), 'overlap');
  }
  assert.ok(found > 0, '找不到可比較的點');
});
