// 刀譜對決 v0.1 規則（the-cut 14cc217 docs/fusion/DUEL_BLADE_V01.md DB-01～06 的 Node 部分）。作者測試。
// 預期數字依規格手算後寫死（算式寫在註解），不由被測函式推出；DB-02 另與 blade v0.2 的 scoreSeq 逐值比對。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseStitch, damageOf, finishMatch, genBoard, inside, BODY, matchFor, newCampaign, newMatch, resolveStrike, step, TUNE, other,
} from '../../src/duel/rules.ts';
import type { Kind, Line, MatchState, Organ, Side, StitchId, V } from '../../src/duel/rules.ts';
import { scoreSeq } from '../../src/blade/rules.ts';

let nid = 100;
const O = (side: Side, kind: Kind, x: number, y: number, extra: Partial<Organ> = {}): Organ => ({ id: nid++, side, kind, p: [x, y], hp: kind === 'bone' ? 2 : 1, sproutUntil: 0, lockUntil: 0, ...extra });
/** 手擺盤面：沿用 newMatch 的其餘欄位，器官換成指定的；AI 不會在這些測試的步數內出刀（aiLastEff＝null 且步數 ≠ 第一刀提交步）。 */
function staged(organs: Organ[], over: Partial<MatchState> = {}): MatchState {
  return { ...newMatch(1, 0), organs, step: 200, ...over };
}
const L = (a: V, b: V): Line => ({ a, b });
const strike = (s: MatchState, side: Side, l: Line) => resolveStrike(s, side, l);

// ---------------------------------------------------------------- DB-01 刀路
test('DB-01 自己的器官鎖住、刀繼續；敵方未鎖器官斬斷、刀繼續（不停）；依距離排序（id 大的較近也照距離）', () => {
  const own = O('blue', 'claw', 100, 650), r1 = O('red', 'eye', 100, 450), r0 = O('red', 'claw', 100, 520);
  const s = staged([r1, own, r0]);                                   // id 順序：r1 < own < r0，但距離 own < r0 < r1
  const r = strike(s, 'blue', L([100, 700], [100, 380]));
  assert.deepEqual([r.ok, r.locks, r.severed, r.seqKinds, r.blocked], [true, [own.id], [r0.id, r1.id], ['claw', 'eye'], null]);
  const out = step(s, { blue: L([100, 700], [100, 380]) }).state;
  assert.deepEqual([out.organs.map((o) => o.id), out.organs[0].lockUntil], [[own.id], 200 + TUNE.LOCK]);
});
test('DB-01 碰到敵方已鎖的器官：停刀、不斬；鎖住的器官後面的也不斬', () => {
  const a = O('red', 'claw', 100, 520, { lockUntil: 999 }), b = O('red', 'eye', 100, 450);
  const r = strike(staged([a, b]), 'blue', L([100, 700], [100, 380]));
  assert.deepEqual([r.severed, r.blocked], [[], a.id]);
});
test('DB-01 骨：耐久 2，第一刀 −1 停刀不入序列；第二刀斷、骨入序列後停刀', () => {
  const c = O('red', 'claw', 100, 540), bone = O('red', 'bone', 100, 470), e = O('red', 'eye', 100, 400);
  let s = staged([c, bone, e]);
  const l = L([100, 700], [100, 330]);
  const r1 = strike(s, 'blue', l);
  assert.deepEqual([r1.severed, r1.seqKinds, r1.boneHit], [[c.id], ['claw'], { id: bone.id, broke: false }]);
  s = step(s, { blue: l }).state;
  assert.equal(s.organs.find((o) => o.id === bone.id)!.hp, 1);
  s = { ...s, cdUntil: { blue: 0, red: 0 } };
  const r2 = strike(s, 'blue', l);
  assert.deepEqual([r2.severed, r2.seqKinds, r2.boneHit], [[bone.id], ['bone'], { id: bone.id, broke: true }]);   // 眼沒被斬
});
test('DB-01 起點要在自己獸身、長度 120～420（>420 截斷）、冷卻中不出刀', () => {
  const s = staged([O('red', 'claw', 100, 300)]);
  assert.equal(strike(s, 'blue', L([100, 300], [100, 100])).reject, 'start');
  assert.equal(strike(s, 'blue', L([100, 700], [100, 640])).reject, 'short');
  assert.equal(strike({ ...s, cdUntil: { blue: 250, red: 0 } }, 'blue', L([100, 700], [100, 400])).reject, 'cooldown');
  const far = strike(s, 'blue', L([100, 750], [100, 100]));          // 截在 750−420＝330，碰不到 y=300（半徑 26 → 326）
  assert.deepEqual([far.severed, Math.round(far.line.b[1])], [[], 330]);
});

// ---------------------------------------------------------------- DB-02 傷害＝blade v0.2 刀譜計分
test('DB-02 6 類序列的傷害＝blade v0.2 scoreSeq（並與手算值比對）', () => {
  const cases: [Kind[], number][] = [
    [['claw', 'claw', 'claw'], 30 * 4],                       // 連斬 +3：120
    [['eye', 'eye', 'claw', 'claw'], 36 * 4],                 // 雙對 +3：144
    [['claw', 'eye', 'eye', 'claw'], 36 * 2],                 // 對稱 ≥4 ×2：72
    [['claw', 'eye', 'claw'], 28],                            // 長度 3 不算對稱：28
    [['claw', 'heart', 'eye', 'poison'], 43 * 2 * 2.5],       // 四色 ×2.5＋心：215
    [['heart'], 10],                                          // 心 +1：10
    [['heart', 'claw', 'claw', 'claw', 'heart'], 480],        // 混合：40×(1+2+3)×2
  ];
  for (const [seq, want] of cases) {
    assert.equal(damageOf(seq, []).score, want, seq.join());
    assert.equal(damageOf(seq, []).score, scoreSeq(seq, []).score, `與 blade 分岔：${seq.join()}`);
  }
});
test('DB-02 一刀的傷害直接扣對手血量', () => {
  const s = staged([O('red', 'claw', 100, 520), O('red', 'claw', 100, 460), O('red', 'claw', 100, 400)]);
  const out = step(s, { blue: L([100, 700], [100, 330]) });
  assert.deepEqual([out.state.hp.red, out.events.find((e) => e.t === 'strike')!.t], [300 - 120, 'strike']);
});

// ---------------------------------------------------------------- DB-03 擊倒、時間到、突然死亡
test('DB-03 血量歸零即擊倒並結束', () => {
  const s = staged([O('red', 'claw', 100, 520)], { hp: { blue: 300, red: 10 } });
  const out = step(s, { blue: L([100, 700], [100, 400]) }).state;
  assert.deepEqual([out.phase, out.outcome, out.hp.red], ['over', { winner: 'blue', how: 'ko' }, 0]);
});
test('DB-03 同一步雙方都歸零＝平手', () => {
  const s = staged([O('red', 'claw', 100, 520), O('blue', 'claw', 600, 480)], {
    hp: { blue: 5, red: 5 }, aim: { line: L([600, 300], [600, 560]), aimStep: 158, fireStep: 200 }, aiLastEff: 100,
  });
  const out = step(s, { blue: L([100, 700], [100, 400]) }).state;
  assert.deepEqual(out.outcome, { winner: 'draw', how: 'ko' });
});
test('DB-03 時間到比血；同血進突然死亡，下一刀先造成傷害者勝', () => {
  const t1 = step(staged([], { step: TUNE.ROUND_STEPS, hp: { blue: 120, red: 90 } }), {}).state;
  assert.deepEqual(t1.outcome, { winner: 'blue', how: 'time' });
  let s = step(staged([O('red', 'claw', 100, 520)], { step: TUNE.ROUND_STEPS, hp: { blue: 100, red: 100 } }), {}).state;
  assert.deepEqual([s.phase, s.outcome], ['sudden', null]);
  s = step(s, {}).state;                                            // 突然死亡中沒人造成傷害：繼續
  assert.equal(s.phase, 'sudden');
  s = step(s, { blue: L([100, 700], [100, 400]) }).state;
  assert.deepEqual(s.outcome, { winner: 'blue', how: 'sudden' });
  // 揮空（0 傷害）不算
  const w = step(step(staged([], { step: TUNE.ROUND_STEPS, hp: { blue: 1, red: 1 } }), {}).state, { blue: L([100, 700], [100, 400]) }).state;
  assert.equal(w.phase, 'sudden');
});

// ---------------------------------------------------------------- DB-04 再生
test('DB-04 每 5 秒、未滿 10 個時補回最早被斬掉的種類；萌芽 0.5 秒不能斬、不能鎖、不擋刀；上限 10', () => {
  const base = newMatch(3, 0);
  const blue = base.organs.filter((o) => o.side === 'blue').slice(0, 8), red = base.organs.filter((o) => o.side === 'red');
  let s: MatchState = { ...base, organs: [...blue, ...red], cutQueue: { blue: ['eye', 'claw'], red: [] }, step: TUNE.REGEN_EVERY - 1 };
  let out = step(s, {});
  const g1 = out.events.find((e) => e.t === 'regen');
  assert.ok(g1 && g1.t === 'regen');
  const o1 = g1.organ;
  assert.deepEqual([o1.side, o1.kind, o1.sproutUntil], ['blue', 'eye', TUNE.REGEN_EVERY + TUNE.SPROUT]);
  assert.ok(inside(o1.p, BODY.blue));
  for (const o of out.state.organs) if (o.id !== o1.id) assert.ok(Math.hypot(o.p[0] - o1.p[0], o.p[1] - o1.p[1]) >= 2 * TUNE.R);
  // 同種子同位置
  assert.deepEqual(step(s, {}).events.find((e) => e.t === 'regen'), g1);
  // 中間的步不再生
  s = out.state;
  for (let i = 0; i < TUNE.REGEN_EVERY - 1; i++) { out = step(s, {}); assert.ok(!out.events.some((e) => e.t === 'regen'), `step ${s.step}`); s = out.state; }
  out = step(s, {});
  const g2 = out.events.find((e) => e.t === 'regen');
  assert.ok(g2 && g2.t === 'regen' && g2.organ.kind === 'claw');
  // 滿 10 個：不再生
  const full: MatchState = { ...base, cutQueue: { blue: ['eye'], red: ['eye'] }, step: TUNE.REGEN_EVERY * 2 - 1 };
  assert.ok(!step(full, {}).events.some((e) => e.t === 'regen'));
  // 萌芽中：刀穿過不斬、不鎖、不擋
  const sp = O('red', 'claw', 100, 520, { sproutUntil: 230 }), behind = O('red', 'eye', 100, 450), mine = O('blue', 'heart', 100, 650, { sproutUntil: 230 });
  const r = strike(staged([sp, behind, mine]), 'blue', L([100, 700], [100, 380]));
  assert.deepEqual([r.severed, r.locks, r.blocked], [[behind.id], [], null]);
  const r2 = strike(staged([sp, behind, mine], { step: 230 }), 'blue', L([100, 700], [100, 380]));   // 萌芽結束
  assert.deepEqual([r2.severed, r2.locks], [[sp.id, behind.id], [mine.id]]);
});

/** 獨立檢查（不呼叫被測的 circleInside／reachableBy）：圓周上 36 個點都在獸身內；對方獸身內以 10px 格點找一個起點，從那裡到圓心 ≤420＋半徑 */
function ringInside(p: V, side: Side): boolean {
  for (let i = 0; i < 36; i++) { const a = (i * Math.PI) / 18; if (!inside([p[0] + Math.cos(a) * TUNE.R, p[1] + Math.sin(a) * TUNE.R], BODY[side])) return false; }
  return true;
}
function gridReach(p: V, attacker: Side): boolean {
  for (let x = 0; x <= 700; x += 10) for (let y = 0; y <= 1000; y += 10) {
    if (!inside([x, y], BODY[attacker])) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= TUNE.MAX_LEN + TUNE.R - 1) {
      // 實際用規則畫這條刀（長度取 max(120, min(420, d))）確認碰得到
      const len = Math.max(TUNE.MIN_LEN, Math.min(TUNE.MAX_LEN, d)), u: V = d ? [(p[0] - x) / d, (p[1] - y) / d] : [1, 0];
      const probe: MatchState = { ...newMatch(1, 0), organs: [{ id: 0, side: other(attacker), kind: 'eye', p, hp: 1, sproutUntil: 0, lockUntil: 0 }], step: 200, cdUntil: { blue: 0, red: 0 } };
      const r = resolveStrike(probe, attacker, { a: [x, y], b: [x + u[0] * len, y + u[1] * len] });
      if (r.ok && r.severed.includes(0)) return true;
    }
  }
  return false;
}
test('DB-04 補述：200 個種子的再生位置都整個圓在獸身內、而且對方至少有一條合法刀線碰得到（獨立檢查）', () => {
  let n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const base = newMatch(seed, seed % 3);
    // 每方留 6 個、排 4 個待再生，連跑 4 個再生節拍
    let s: MatchState = { ...base, organs: [...base.organs.filter((o) => o.side === 'blue').slice(0, 6), ...base.organs.filter((o) => o.side === 'red').slice(0, 6)],
      cutQueue: { blue: ['claw', 'eye', 'heart', 'bone'], red: ['claw', 'eye', 'poison', 'heart'] } };
    for (let t = 1; t <= 4; t++) {
      s = { ...s, step: TUNE.REGEN_EVERY * t - 1, aim: null, aiLastEff: 0 };
      const out = step(s, {});
      for (const e of out.events) if (e.t === 'regen') {
        n++;
        assert.ok(ringInside(e.organ.p, e.organ.side), `seed ${seed} ${e.organ.side} 再生 ${e.organ.p} 圓超出獸身`);
        assert.ok(gridReach(e.organ.p, other(e.organ.side)), `seed ${seed} ${e.organ.side} 再生 ${e.organ.p} 對方碰不到`);
      }
      s = out.state;
    }
  }
  assert.ok(n >= 1500, `再生數 ${n}`);
});
test('DB-04 補述：初始盤面也守同樣的位置規則（40 種子×3 場）', () => {
  for (let seed = 1; seed <= 40; seed++) for (let stage = 0; stage < 3; stage++) for (const o of genBoard(seed, stage)) {
    assert.ok(ringInside(o.p, o.side), `seed ${seed} ${o.p}`);
  }
});

// ---------------------------------------------------------------- DB-05 AI 時序與不偷看
function runAi(seed: number, stage: number, drag: (k: number) => Line | null) {
  let s = newMatch(seed, stage);
  const aims: { aim: number; fire: number; line: Line }[] = [], fires: { k: number; d: number }[] = [];
  while (s.phase !== 'over' && s.step < 1800) {
    const k = s.step, out = step(s, { drag: drag(k) });
    for (const e of out.events) { if (e.t === 'aim') aims.push({ aim: e.aim.aimStep, fire: e.aim.fireStep, line: e.aim.line }); if (e.t === 'strike' && e.r.side === 'red') fires.push({ k, d: out.state.aiD }); }
    s = out.state;
  }
  return { aims, fires };
}
test('DB-05 AI：生效−提交＝0.7 秒；生效間隔 ≥ 1.5＋d（d 依對手 ≤0.5／0.35／0.2 秒）；第一刀 1 秒提交', () => {
  for (const stage of [0, 1, 2]) for (const seed of [1, 2, 3]) {
    const { aims, fires } = runAi(seed, stage, () => null);
    assert.ok(aims.length >= 10, `seed ${seed} stage ${stage} aims ${aims.length}`);
    assert.equal(aims[0].aim, TUNE.AI_FIRST_SUBMIT);
    for (const a of aims) assert.equal(a.fire - a.aim, TUNE.AIM);
    for (let i = 1; i < fires.length; i++) {
      const gap = fires[i].k - fires[i - 1].k, d = fires[i - 1].d;
      assert.ok(d >= 0 && d <= TUNE.AI_D[stage], `d ${d}`);
      assert.ok(gap >= TUNE.COOLDOWN + d, `seed ${seed} stage ${stage} gap ${gap} < 90+${d}`);
    }
    assert.ok(aims.some((a, i) => i > 0 && a.aim < fires[i - 1].k + TUNE.COOLDOWN), '預告要能和冷卻重疊');
  }
});
test('DB-05 不偷看：兩種不同的未提交拖曳（含一種壓在 AI 想切的器官上），AI 預告序列逐值相同', () => {
  const ref = runAi(11, 1, () => null);
  const target = ref.aims[0].line;   // 第一刀的刀線
  const A = runAi(11, 1, (k) => (k % 60 < 30 ? L([100, 700], [400, 520]) : null));
  const B = runAi(11, 1, () => ({ a: [target.b[0], Math.min(970, target.b[1] + 300)] as V, b: target.b }));
  assert.deepEqual(A.aims, ref.aims);
  assert.deepEqual(B.aims, ref.aims);
});

// ---------------------------------------------------------------- DB-06 縫合（8 種各一）與征途（Node 部分）
const withSlots = (s: MatchState, st: StitchId) => ({ ...s, slots: [st, null, null, null] as (StitchId | null)[] });
test('DB-06 鋒爪：每個爪 +6 籌碼', () => { assert.deepEqual([damageOf(['claw', 'eye'], []).score, damageOf(['claw', 'eye'], ['sharpClaw']).score], [18, 24]); });
test('DB-06 雙心：心倍率 +2', () => { assert.deepEqual([damageOf(['heart', 'eye'], []).score, damageOf(['heart', 'eye'], ['twinHeart']).score], [26, 39]); });
test('DB-06 獨眼：對稱 ×3', () => { assert.deepEqual([damageOf(['claw', 'eye', 'eye', 'claw'], []).score, damageOf(['claw', 'eye', 'eye', 'claw'], ['oneEye']).score], [72, 108]); });
test('DB-06 骨刃：碰到骨直接斬斷、不停刀（骨 0 籌碼）', () => {
  const c = O('red', 'claw', 100, 540), bone = O('red', 'bone', 100, 470), e = O('red', 'eye', 100, 400);
  const s = staged([c, bone, e]), l = L([100, 700], [100, 330]);
  const no = strike(s, 'blue', l), yes = strike(withSlots(s, 'boneBlade'), 'blue', l);
  assert.deepEqual([no.severed, yes.severed, yes.seqKinds, yes.score.chips], [[c.id], [c.id, bone.id, e.id], ['claw', 'bone', 'eye'], 18]);
});
test('DB-06 毒脈：每顆毒倍率 +2', () => { assert.deepEqual([damageOf(['poison', 'eye', 'poison'], []).score, damageOf(['poison', 'eye', 'poison'], ['venom']).score], [48, 240]); });
test('DB-06 長臂：刀長上限 560（對戰版沒有 +10 籌碼）', () => {
  const s = staged([O('red', 'claw', 100, 230)]), l = L([100, 750], [100, 150]);   // 520 處的器官：420 碰不到、560 碰得到
  const no = strike(s, 'blue', l), yes = strike(withSlots(s, 'longArm'), 'blue', l);
  assert.deepEqual([no.severed.length, yes.severed.length, yes.score.score], [0, 1, 10]);
});
test('DB-06 回刃：最後一個被斬的器官籌碼再算一次', () => { assert.deepEqual([damageOf(['claw', 'eye'], []).score, damageOf(['claw', 'eye'], ['echo']).score], [18, 26]); });
test('DB-06 硬殼：自己的器官鎖定 3 秒改為 5 秒（只對藍方）', () => {
  const own = O('blue', 'claw', 100, 650);
  const s = staged([own]), l = L([100, 700], [100, 500]);
  const a = step(s, { blue: l }).state.organs[0].lockUntil, b = step(withSlots(s, 'hardShell'), { blue: l }).state.organs[0].lockUntil;
  assert.deepEqual([a, b], [200 + 180, 200 + 300]);
});
test('DB-06 征途：勝→3 選 1 縫合（來自斬下的種類）、4 槽、下一場滿血；敗→結束；第 3 場勝＝征途勝', () => {
  let c = newCampaign(5);
  const m0 = { ...matchFor(c), outcome: { winner: 'blue' as const, how: 'ko' as const }, severedKinds: ['claw', 'eye'] as Kind[], hp: { blue: 37, red: 0 } };
  c = finishMatch(c, m0);
  assert.equal(c.phase, 'stitch'); assert.equal(c.offer.length, 3);
  const fromKinds = ['sharpClaw', 'hardShell', 'oneEye', 'longArm'];
  assert.equal(c.offer.filter((x) => fromKinds.includes(x)).length, 3);
  c = chooseStitch(c, c.offer[0]);
  const m1 = matchFor(c);
  assert.deepEqual([c.stage, c.slots.filter(Boolean).length, m1.hp.blue, m1.hp.red, m1.slots], [1, 1, 300, 400, c.slots]);
  const lost = finishMatch(c, { ...m1, outcome: { winner: 'red', how: 'time' } });
  assert.equal(lost.phase, 'lost');
  const draw = finishMatch(c, { ...m1, outcome: { winner: 'draw', how: 'ko' } });
  assert.equal(draw.phase, 'lost');
  let w = { ...c, stage: 2 };
  w = finishMatch(w, { ...m1, stage: 2, outcome: { winner: 'blue', how: 'ko' } });
  assert.equal(w.phase, 'won');
  // 槽滿：必須指定替換槽
  const full = { ...c, phase: 'stitch' as const, slots: ['echo', 'venom', 'oneEye', 'longArm'] as (StitchId | null)[], offer: ['sharpClaw', 'hardShell', 'boneBlade'] as StitchId[] };
  assert.equal(chooseStitch(full, 'sharpClaw'), full);
  assert.deepEqual(chooseStitch(full, 'sharpClaw', 2).slots, ['echo', 'venom', 'sharpClaw', 'longArm']);
});

// ---------------------------------------------------------------- 生成
test('生成：每方 10 個（爪 4 心 2 眼 2 毒 1 骨 1）、在自己獸身內、不重疊；雙方都有能一刀斬到 ≥3 個敵方器官的線；同種子同盤面', () => {
  for (let seed = 1; seed <= 40; seed++) for (let stage = 0; stage < 3; stage++) {
    const org = genBoard(seed, stage);
    for (const side of ['blue', 'red'] as Side[]) {
      const mine = org.filter((o) => o.side === side);
      assert.deepEqual(mine.map((o) => o.kind).sort(), [...TUNE.KINDS].sort());
      for (const o of mine) assert.ok(inside(o.p, BODY[side]));
    }
    for (let i = 0; i < org.length; i++) for (let j = i + 1; j < org.length; j++) assert.ok(Math.hypot(org[i].p[0] - org[j].p[0], org[i].p[1] - org[j].p[1]) >= 2 * TUNE.R);
  }
  assert.deepEqual(genBoard(9, 1), genBoard(9, 1));
  assert.notDeepEqual(genBoard(9, 1), genBoard(10, 1));
});
