// 切割→戰鬥 v0.1（the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md）CB-01～03 的 Node 部分。作者測試。
// CB-01：rt-cut2 的規則在本版設定（局長 30 秒、器官組成、再生上限＝開場數、生成／再生位置規則、AI 亂數上限）下照跑；
//        原 rt-cut／rt-cut2 測試檔（rtcut_rules／rtcut2_rules）不改一字、照樣全過（證明預設模式行為沒變）。
// CB-02／03：戰鬥期純函式。預期數字依規格手算後寫死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY, COOLDOWN_STEPS, MODE_RT2, R, REGEN_STEPS, SPROUT_STEPS, aiChoose, circleInside, countSide, inside, newGame, reachableBy, resolveStrike, step,
} from '../../src/rtcut/rules.ts';
import type { GameState, Kind, Line, Mode, OrganDef, Side, V } from '../../src/rtcut/rules.ts';
import { BT, contributionFromEvents, simulateBattle } from '../../src/cutbattle/battle.ts';
import type { BattleEvent, Fighter } from '../../src/cutbattle/battle.ts';
import { CB, blueOrgans, fightersOf, genBlueBase, genRed, matchFor, modeFor, newCampaign, pickStitch, placeCheck, placeStitch, resolveStage, finishStage } from '../../src/cutbattle/campaign.ts';

const L = (a: V, b: V): Line => ({ a, b });
const MODE_CB = (nb = 9, nr = 9, jitter = 30): Mode => ({ ...MODE_RT2, cutSteps: 1800, maxPerSide: { blue: nb, red: nr }, spawnRule: 'cb', aiJitter: jitter });
const O = (id: string, side: Side, kind: Kind, p: V): OrganDef => ({ id, side, kind, p });
/** CB 局面：手擺器官、AI 不出刀（除非另外給 aim）。 */
function cb(organs: OrganDef[], k = 0, mode = MODE_CB()): GameState { return { ...newGame(1, mode, organs), step: k, aiNextFire: 10 ** 9 }; }
const withAim = (s: GameState, line: Line): GameState => ({ ...s, aim: { line, aimStep: s.step, fireStep: s.step }, aiNextFire: s.step });

// ---------------------------------------------------------------- CB-01 切割期沿用 rt-cut2
const BX = O('藍眼', 'blue', 'eye', [100, 520]), RY = O('紅毒', 'red', 'poison', [200, 480]), RZ = O('紅骨', 'red', 'bone', [400, 480]);
const ROW = L([60, 500], [460, 500]);   // 由藍身起：先碰藍眼（鎖）、再碰紅毒（切）→ 停刀，紅骨不受影響
test('CB-01 單刀：自己的器官鎖住刀繼續、切第一個對方器官就停刀（眼／毒／骨在切割期只是普通器官）', () => {
  const s = cb([BX, RY, RZ]);
  const r = resolveStrike(s, 'blue', ROW);
  assert.deepEqual([r.ok, r.locks, r.severed, r.blocked], [true, [0], 1, null]);
  const o = step(s, { blue: ROW }).state;
  assert.deepEqual([o.alive, o.lockUntil[0], o.cdUntil.blue], [[true, false, true], 300, COOLDOWN_STEPS]);
  const locked = { ...s, lockUntil: [0, 999, 0] };
  assert.deepEqual([resolveStrike(locked, 'blue', ROW).severed, resolveStrike(locked, 'blue', ROW).blocked], [null, 1]);
});
test('CB-01 同步出刀以步開始狀態判：紅切藍眼、藍同步鎖藍眼 → 藍眼被切', () => {
  const o = step(withAim(cb([BX, RY, RZ]), L([100, 450], [100, 600])), { blue: ROW }).state;
  assert.deepEqual(o.alive, [false, false, true]);
});
test('CB-01 局長 30 秒：第 1800 步起不能出刀、進戰鬥前的凍結；AI 生效在 1800 之後的不提交', () => {
  const s = cb([BX, RY, RZ], 1800);
  assert.equal(resolveStrike(s, 'blue', ROW).reject, 'phase');
  const o = step(s, { blue: ROW });
  assert.deepEqual([o.state.phase, o.events.some((e) => e.t === 'reject' && e.reason === 'phase')], ['duel', true]);
  assert.equal(step(cb([BX, RY, RZ], 1799), {}).state.phase, 'cut');
  // AI：整場空跑，所有預告的生效步 < 1800
  let g = matchFor(newCampaign(3)); const fires: number[] = [];
  while (g.phase === 'cut') { const out = step(g, {}); for (const e of out.events) if (e.t === 'aim') fires.push(e.aim.fireStep); g = out.state; }
  assert.ok(fires.length > 5 && fires.every((f) => f < 1800), `${fires.length} ${Math.max(...fires)}`);
});
test('CB-01 擊倒：一方器官全被切光那一步結束（進戰鬥時那方 0 器官）', () => {
  const o = step(cb([BX, RY]), { blue: ROW });
  assert.deepEqual([o.state.phase, o.state.end], ['ko', { by: 'ko', winner: 'blue' }]);
  const b = simulateBattle(fightersOf(o.state), 1);
  assert.deepEqual([b.winner, b.how, b.endMs], ['blue', 'empty', 0]);
});
test('CB-01 再生：每 5 秒、上限＝開場數量、補最早被切的種類、萌芽 0.5 秒不能切／鎖／擋；位置整個圓在獸身內且對方碰得到', () => {
  // 開場紅方 3 個（上限 3），切掉紅毒 → 第 300 步長回「毒」
  let s = cb([BX, RY, RZ, O('紅爪', 'red', 'claw', [600, 300])], 0, MODE_CB(1, 3));
  s = step(s, { blue: ROW }).state;
  assert.equal(countSide(s, 'red'), 2);
  s = { ...s, severedQ: { blue: [], red: [...s.severedQ.red, 'claw', 'eye'] } };   // 佇列還有種類：上限 3 應擋住第 2 次再生（預設上限 8 會再長）
  while (s.step < REGEN_STEPS) s = step(s, {}).state;
  const out = step(s, {});
  const sp = out.events.find((e) => e.t === 'spawn');
  assert.ok(sp && sp.t === 'spawn');
  const g = out.state.organs[sp.i];
  assert.deepEqual([g.side, g.kind, out.state.readyAt[sp.i]], ['red', 'poison', REGEN_STEPS + SPROUT_STEPS]);
  assert.ok(circleInside(g.p, 'red') && reachableBy(g.p, 'blue'));
  // 上限：已回到 3 個，佇列雖然還有爪、眼也不再長
  let t = out.state; while (t.step < 3 * REGEN_STEPS + 1) t = step(t, {}).state;
  assert.deepEqual([countSide(t, 'red'), t.severedQ.red], [3, ['claw', 'eye']]);
});
test('CB-01／補述：200 種子的生成與再生位置都整個圓在獸身內、對方碰得到、不重疊（獨立以圓周取樣檢查）', () => {
  const ring = (p: V, side: Side) => { for (let i = 0; i < 36; i++) { const a = (i * Math.PI) / 18; if (!inside([p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R], BODY[side])) return false; } return true; };
  let spawns = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = newCampaign(seed), blue = blueOrgans(c);
    for (let stage = 0; stage < 3; stage++) {
      const all = [...blue, ...genRed(seed, stage, blue)];
      for (const o of all) { assert.ok(ring(o.p, o.side), `seed ${seed} ${o.id}`); assert.ok(reachableBy(o.p, o.side === 'blue' ? 'red' : 'blue')); }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].p[0] - all[j].p[0], all[i].p[1] - all[j].p[1]) >= 2 * R);
    }
    // 再生：切掉紅方 3 個後跑到第 900 步
    let s = matchFor(c); s = { ...s, aiNextFire: 10 ** 9, alive: s.alive.map((a, i) => !(s.organs[i].side === 'red' && i % 3 === 0)), severedQ: { blue: [], red: ['claw', 'eye', 'bone'] } };
    while (s.step < 3 * REGEN_STEPS + 1) {
      const out = step(s, {});
      for (const e of out.events) if (e.t === 'spawn') { spawns++; const o = out.state.organs[e.i]; assert.ok(ring(o.p, o.side) && reachableBy(o.p, 'blue'), `seed ${seed} 再生 ${o.p}`); }
      s = out.state;
    }
  }
  assert.ok(spawns >= 400, `${spawns}`);
});
test('CB-01 AI 不偷看：兩種不同的拖曳（含壓在 AI 目標上），AI 預告逐值相同；AI 間隔 ≤ 冷卻＋d（0.5／0.35／0.2 秒）', () => {
  for (let stage = 0; stage < 3; stage++) {
    const run = (drag: (k: number) => Line | null) => {
      let s = matchFor({ ...newCampaign(9), stage }); const aims: unknown[] = [], fires: number[] = [];
      while (s.phase === 'cut' && s.step < 1200) { const k = s.step, out = step(s, { drag: drag(k) }); for (const e of out.events) { if (e.t === 'aim') aims.push(e.aim); if (e.t === 'strike' && e.r.side === 'red') fires.push(k); } s = out.state; }
      return { aims, fires };
    };
    const a = run(() => null), b = run((k) => (k % 50 < 25 ? L([100, 900], [400, 500]) : null)), c = run(() => L([350, 900], [350, 480]));
    assert.deepEqual(b.aims, a.aims); assert.deepEqual(c.aims, a.aims);
    for (let i = 1; i < a.fires.length; i++) assert.ok(a.fires[i] - a.fires[i - 1] >= COOLDOWN_STEPS, `stage ${stage}`);
    assert.equal(modeFor({ ...newCampaign(9), stage }, 9, 9).aiJitter, CB.AI_JITTER[stage]);
  }
  assert.deepEqual(CB.AI_JITTER, [30, 21, 12]);
});
test('CB-01 器官組成：每方 爪4 心2 眼1 毒1 骨1；對手依序多 0／1／2 個（第 2 隻偏骨、第 3 隻偏毒）', () => {
  const base = genBlueBase(1).map((o) => o.kind).sort();
  assert.deepEqual(base, [...CB.BASE_KINDS].sort());
  let bone = 0, poison = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const blue = genBlueBase(seed);
    assert.deepEqual([genRed(seed, 0, blue).length, genRed(seed, 1, blue).length, genRed(seed, 2, blue).length], [9, 10, 11]);
    if (genRed(seed, 1, blue)[9].kind === 'bone') bone++;
    poison += genRed(seed, 2, blue).slice(9).filter((o) => o.kind === 'poison').length;
  }
  assert.ok(bone >= 40 && poison >= 80, `bone ${bone}/100 poison ${poison}/200`);   // 權重 5/9≈56%
});

test('CB-01 本版設定下：冷卻內出刀被拒、刀長 <120 被拒、起點不在自己獸身被拒（與 rt-cut2 相同）', () => {
  const s = cb([BX, RY, RZ]);
  assert.equal(resolveStrike({ ...s, cdUntil: { blue: 50, red: 0 } }, 'blue', ROW).reject, 'cooldown');
  assert.equal(resolveStrike(s, 'blue', L([100, 900], [100, 800])).reject, 'short');
  assert.equal(resolveStrike(s, 'blue', L([200, 300], [200, 700])).reject, 'start');
  const o = step(s, { blue: ROW }).state;                                       // 冷卻從生效那一步起算 1.5 秒
  assert.equal(resolveStrike({ ...o, step: COOLDOWN_STEPS - 1 }, 'blue', ROW).reject, 'cooldown');
  assert.equal(resolveStrike({ ...o, step: COOLDOWN_STEPS }, 'blue', ROW).reject, undefined);
});
test('CB-01 本版設定下：萌芽中的器官不能切、不能鎖、不擋刀；萌芽結束後正常（rt-cut2 R2-03）', () => {
  const s0 = cb([BX, RY, RZ]);
  const s = { ...s0, readyAt: [30, 30, 0] };                                  // 藍眼、紅毒都在萌芽
  const r = resolveStrike(s, 'blue', ROW);
  assert.deepEqual([r.locks, r.severed, r.blocked], [[], 2, null]);           // 穿過兩個萌芽器官，切到紅骨
  const r2 = resolveStrike({ ...s, step: 30 }, 'blue', ROW);
  assert.deepEqual([r2.locks, r2.severed], [[0], 1]);
});
test('CB-01 本版設定下：AI 只出有目標的刀；對手（你）只剩萌芽器官時不出攻擊刀（rt-cut2 R2-05）', () => {
  const s0 = cb([O('藍爪', 'blue', 'claw', [350, 700]), O('紅心', 'red', 'heart', [350, 200])]);
  const s = { ...s0, readyAt: [9999, 0] };
  for (let i = 0; i < 50; i++) {
    const pick = aiChoose({ ...s, rng: (i * 2654435761) >>> 0 || 1 });
    if (!pick.line) continue;
    const r = resolveStrike({ ...s, cdUntil: { blue: 0, red: 0 } }, 'red', pick.line);
    assert.equal(r.severed, null, '不能是攻擊刀');
    assert.ok(r.locks.length > 0, '只能是保護刀');
  }
});
test('補述的位置規則：對方刀碰不到的點會被判不合法（直接測 reachableBy）；這張身體幾何下藍方「整個圓在身體內」的點全都碰得到', () => {
  assert.equal(reachableBy([350, 1600], 'red'), false);
  assert.equal(reachableBy([350, 700], 'red'), true);
  assert.equal(reachableBy([350, 980 + 420 + 40], 'red'), false);
  let n = 0;
  for (let y = 430; y <= 980; y += 5) for (let x = 20; x <= 680; x += 5) if (circleInside([x, y], 'blue')) { n++; assert.ok(reachableBy([x, y], 'red'), `${x},${y}`); }
  assert.ok(n > 5000);   // 所以擺放的「打不到」理由在這張盤面不會觸發（空條件成立；見作者證據）
});

// ---------------------------------------------------------------- CB-02 戰鬥數值
const F = (side: Side, kind: Kind, n = 1): Fighter[] => Array.from({ length: n }, (_, i) => ({ side, id: `${side}${kind}${i}`, kind }));
const of = <T extends BattleEvent['t']>(ev: BattleEvent[], t: T) => ev.filter((e): e is Extract<BattleEvent, { t: T }> => e.t === t);
test('CB-02 爪：每 1.0 秒攻擊一次、造成 4（無眼不暴擊）；起點錯開 0～0.3 秒', () => {
  const b = simulateBattle([...F('blue', 'claw'), ...F('red', 'heart', 3)], 7);
  const c = of(b.events, 'claw');
  assert.ok(c.length >= 10);
  assert.ok(c.every((e) => e.raw === (e.ms >= 10000 ? 8 : 4) && !e.crit));
  for (let i = 1; i < c.length; i++) assert.equal(c[i].ms - c[i - 1].ms, 1000);
  assert.ok(c[0].ms >= 1000 && c[0].ms <= 1300);
});
test('CB-02 心：血量上限 +30、每 2.0 秒回 3（不超過上限）', () => {
  const b = simulateBattle([...F('blue', 'heart', 2), ...F('red', 'claw')], 3);
  const st = (b.events[0] as Extract<BattleEvent, { t: 'start' }>).stats;
  assert.deepEqual([st.blue.maxHp, st.red.maxHp], [60 + 60, 60]);
  const h = of(b.events, 'heal').filter((e) => e.id === 'blueheart0');
  for (let i = 1; i < h.length; i++) assert.equal(h[i].ms - h[i - 1].ms, 2000);
  assert.ok(h.every((e) => e.amount <= 3 && e.hpAfter <= 120));
  assert.ok(h.some((e) => e.amount === 3));
  // 滿血時回 0（不超過上限）：雙方都只有心，沒人受傷
  const full = of(simulateBattle([...F('blue', 'heart'), ...F('red', 'heart')], 3).events, 'heal');
  assert.ok(full.length >= 6 && full.every((e) => e.amount === 0 && e.hpAfter === 90));
});
test('CB-02 眼：暴擊率每顆 +20%、上限 60%，暴擊 ×2', () => {
  const crit = (eyes: number) => (simulateBattle([...F('blue', 'claw'), ...F('blue', 'eye', eyes), ...F('red', 'heart', 3)], 1).events[0] as Extract<BattleEvent, { t: 'start' }>).stats.blue.crit;
  assert.deepEqual([crit(0), crit(1), crit(2), crit(3), crit(5)].map((x) => Math.round(x * 100)), [0, 20, 40, 60, 60]);
  let n = 0, k = 0;
  for (let seed = 1; seed <= 300; seed++) for (const e of of(simulateBattle([...F('blue', 'claw'), ...F('blue', 'eye', 3), ...F('red', 'heart', 3)], seed).events, 'claw')) {
    if (e.ms >= 10000) continue; n++; if (e.crit) { k++; assert.equal(e.raw, 8); } else assert.equal(e.raw, 4);
  }
  assert.ok(k / n > 0.55 && k / n < 0.65, `${k}/${n}`);
});
test('CB-02 毒：每 1.5 秒疊 1 層；每 1 秒結算，每層 1 傷害', () => {
  const b = simulateBattle([...F('blue', 'poison'), ...F('red', 'heart')], 5);
  const st = of(b.events, 'poisonStack'), tk = of(b.events, 'poisonTick');
  for (let i = 1; i < st.length; i++) assert.equal(st[i].ms - st[i - 1].ms, 1500);
  for (const t of tk) {
    const stacks = st.filter((x) => x.ms <= t.ms).length;
    assert.equal(t.raw, stacks * (t.ms >= 10000 ? 2 : 1), `ms ${t.ms}`);
    assert.equal(t.ms % 1000, 0);
  }
});
test('CB-02 骨：毒也先被護盾吸收', () => {
  const b = simulateBattle([...F('blue', 'poison'), ...F('red', 'bone')], 2);
  const tk = of(b.events, 'poisonTick');
  assert.ok(tk.length >= 3);
  assert.deepEqual([tk[0].shieldHit, tk[0].hpHit], [tk[0].raw, 0]);
  let shield = 15; for (const t of tk) { const sh = Math.min(shield, t.raw); assert.deepEqual([t.shieldHit, t.hpHit], [sh, t.raw - sh]); shield -= sh; }
});
test('CB-02 起點錯開：各器官第一次行動在 0～0.3 秒的錯開範圍內，而且不會全部同一刻', () => {
  const offs = new Set<number>(); let notAllSame = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const c = of(simulateBattle([...F('blue', 'claw', 4), ...F('red', 'heart', 4)], seed).events, 'claw');
    const first = new Map<string, number>(); for (const e of c) if (!first.has(e.id)) first.set(e.id, e.ms);
    assert.equal(first.size, 4);
    for (const ms of first.values()) { assert.ok(ms >= 1000 && ms <= 1300 && ms % 10 === 0, `${ms}`); offs.add(ms); }
    if (new Set(first.values()).size > 1) notAllSame++;
  }
  assert.ok(offs.size >= 20 && notAllSame >= 45, `${offs.size} ${notAllSame}`);
});
test('CB-02 血量歸零就輸：同一毫秒排在後面的心不能把歸零的一方救回來（審查 H1）', () => {
  // 固定案例：藍 6 爪對紅 2 心，這些種子在「歸零後同毫秒還能回血」的錯誤實作下會拖到更晚才結束（以突變版離線找出）
  for (const [seed, endMs] of [[41, 6210], [50, 6220], [61, 6090], [63, 6090], [142, 6070], [152, 6060]]) {
    const b = simulateBattle([...F('blue', 'claw', 6), ...F('red', 'heart', 2)], seed);
    assert.deepEqual([b.winner, b.how, b.endMs], ['blue', 'ko', endMs], `seed ${seed}`);
    const z = b.events.find((e) => e.t === 'claw' && e.hpAfter <= 0)!;
    assert.equal(z.ms, endMs);
    assert.ok(!b.events.some((e, i) => e.t === 'heal' && e.side === 'red' && e.ms === z.ms && e.amount > 0 && i > b.events.indexOf(z)));
  }
  let checked = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const pick = (k: number) => (['claw', 'heart', 'eye', 'poison', 'bone'] as Kind[])[k % 5];
    const fighters = [...Array.from({ length: 3 + (seed % 4) }, (_, i) => ({ side: 'blue' as Side, id: `b${i}`, kind: pick(seed * 7 + i * 3) })), ...Array.from({ length: 3 + ((seed >> 2) % 4) }, (_, i) => ({ side: 'red' as Side, id: `r${i}`, kind: pick(seed * 13 + i * 5) }))];
    const b = simulateBattle(fighters, seed);
    const firstZero = b.events.find((e) => (e.t === 'claw' || e.t === 'poisonTick') && e.hpAfter <= 0);
    if (!firstZero) continue;
    checked++;
    assert.equal(b.endMs, firstZero.ms, `seed ${seed}：${firstZero.ms} 歸零卻到 ${b.endMs} 才結束`);
    const victim: Side = firstZero.t === 'claw' ? (firstZero.side === 'blue' ? 'red' : 'blue') : firstZero.side;
    assert.ok(!b.events.some((e) => e.t === 'heal' && e.side === victim && e.ms === firstZero.ms && e.amount > 0 && b.events.indexOf(e) > b.events.indexOf(firstZero)), `seed ${seed} 歸零後回血`);
    assert.notEqual(b.winner, victim);
  }
  assert.ok(checked > 1500, `${checked}`);
});
test('CB-02 骨：開戰護盾 15、先吸收傷害', () => {
  const b = simulateBattle([...F('blue', 'claw'), ...F('red', 'bone')], 2);
  const st = (b.events[0] as Extract<BattleEvent, { t: 'start' }>).stats;
  assert.equal(st.red.shield, 15);
  const c = of(b.events, 'claw');
  assert.deepEqual(c.slice(0, 4).map((e) => [e.shieldHit, e.hpHit]), [[4, 0], [4, 0], [4, 0], [3, 1]]);
  assert.equal(c[3].hpAfter, 59);
});
test('CB-02 第 10 秒起所有傷害 ×2（爪與毒都是）', () => {
  const b = simulateBattle([...F('blue', 'claw'), ...F('blue', 'poison'), ...F('red', 'heart', 6)], 4);
  assert.ok(of(b.events, 'overtime').length === 1);
  for (const e of of(b.events, 'claw')) assert.equal(e.raw, e.ms >= 10000 ? 8 : 4);
});
test('CB-02 打滿 15 秒比剩餘血量百分比；相同平手；同一刻雙方歸零平手', () => {
  const t = simulateBattle([...F('blue', 'heart'), ...F('red', 'heart')], 1);
  assert.deepEqual([t.winner, t.how, t.endMs], ['draw', 'time', 15000]);
  const p = simulateBattle([...F('blue', 'claw'), ...F('blue', 'heart', 8), ...F('red', 'heart', 8)], 1);   // 只有藍有攻擊
  assert.deepEqual([p.winner, p.how], ['blue', 'time']);
  // 同一刻歸零：雙方各 1 爪、起點錯開相同的種子下各打 60 血；找一個雙方爪同毫秒出手的種子
  let found = false;
  for (let seed = 1; seed <= 500 && !found; seed++) {
    const b = simulateBattle([...F('blue', 'claw'), ...F('red', 'claw')], seed);
    const c = of(b.events, 'claw');
    if (c.length >= 2 && c[0].ms === c[1].ms) { assert.deepEqual([b.winner, b.how], ['draw', 'ko']); found = true; }
  }
  assert.ok(found);
});

// ---------------------------------------------------------------- CB-03 決定性
test('CB-03 同種子＋同一局切割結果 → 戰鬥逐事件相同；貢獻表＝事件加總；與時間來源無關', () => {
  const play = () => {
    let s = matchFor(newCampaign(21));
    const at: Record<number, Line> = { 40: L([100, 900], [100, 480]), 200: L([300, 900], [300, 480]), 400: L([500, 900], [500, 480]) };
    while (s.phase === 'cut') s = step(s, { blue: at[s.step] ?? null }).state;
    return simulateBattle(fightersOf(s), 99);
  };
  const realNow = Date.now, realPerf = performance.now, realRand = Math.random;
  const a = play();
  Date.now = () => 1; performance.now = () => 2; Math.random = () => 0.5;
  try { assert.deepEqual(play(), a); } finally { Date.now = realNow; performance.now = realPerf; Math.random = realRand; }
  for (let seed = 1; seed <= 50; seed++) {
    const b = simulateBattle([...F('blue', 'claw', 3), ...F('blue', 'eye'), ...F('blue', 'bone'), ...F('red', 'poison', 2), ...F('red', 'heart'), ...F('red', 'claw', 2)], seed);
    assert.deepEqual(contributionFromEvents(b.events), b.contrib);
  }
});

// ---------------------------------------------------------------- 縫合擺放與征途（Node 部分；CB-05／06 的瀏覽器部分在 cb_tests.mjs）
test('CB-05 擺放：合法位置＝整個圓在獸身內、對方刀碰得到、不和其他藍方器官重疊；下一場該器官存在且位置正確', () => {
  let c = newCampaign(4);
  c = finishStage(c, ['eye', 'eye', 'claw'], { ...simulateBattle([...F('blue', 'claw'), ...F('red', 'heart')], 1), winner: 'blue' });
  assert.equal(c.phase, 'pick'); assert.equal(c.offer.length, 3); assert.ok(c.offer.includes('eye') && c.offer.includes('claw'));
  c = pickStitch(c, c.offer[0]);
  assert.equal(placeStitch(c, [30, 960]).reject, 'outside');                        // 角落：圓超出獸身
  assert.equal(placeStitch(c, c.blueBase[0].p).reject, 'overlap');
  // 找一個合法點
  let ok: V | null = null;
  for (let y = 450; y < 960 && !ok; y += 10) for (let x = 60; x < 660 && !ok; x += 10) if (!placeCheck(c, [x, y])) ok = [x, y];
  const picked = c.picked;
  const r = placeStitch(c, ok!);
  assert.equal(r.reject, null);
  const m = matchFor(r.c);
  const st = m.organs.find((o) => o.id.startsWith('藍縫'))!;
  assert.deepEqual([st.kind, st.p, r.c.stage, m.mode.maxPerSide!.blue], [picked, ok, 1, 10]);
  // 拒絕理由與位置規則一致
  for (let y = 400; y < 1000; y += 23) for (let x = 0; x < 700; x += 23) {
    const rej = placeCheck(c, [x, y]);
    if (rej === 'outside') assert.ok(!circleInside([x, y], 'blue'));
    if (rej === null) assert.ok(circleInside([x, y], 'blue') && reachableBy([x, y], 'red'));
  }
});
test('CB-06 征途：輸或平手結束；第 3 場勝＝征途勝；新征途全部重置', () => {
  const win = { ...simulateBattle([...F('blue', 'claw'), ...F('red', 'heart')], 1), winner: 'blue' as const };
  const lose = { ...win, winner: 'red' as const }, draw = { ...win, winner: 'draw' as const };
  const c0 = newCampaign(8);
  assert.equal(finishStage(c0, [], lose).phase, 'lost');
  assert.equal(finishStage(c0, [], draw).phase, 'lost');
  assert.equal(finishStage({ ...c0, stage: 2 }, [], win).phase, 'won');
  const fresh = newCampaign(8);
  assert.deepEqual([fresh.stage, fresh.stitches, fresh.history, fresh.phase], [0, [], [], 'cut']);
  const { c } = resolveStage(c0, { ...matchFor(c0), phase: 'duel' }, ['claw']);
  assert.ok(['pick', 'lost'].includes(c.phase));
});
