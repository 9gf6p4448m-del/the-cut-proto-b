// 刀譜規則（the-cut 0233f19 docs/core-redesign-r5/BLADE_HAND_SKETCH.md BH-01～05）。作者測試。
// 預期數字依設計檔規則手算後寫死（算式寫在註解），不由被測函式推出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCut, bestLine, chooseStitch, cutPath, genMonster, inMonster, newRun, resolveCounter, scoreSeq, twitch, TUNE,
} from '../../src/blade/rules.ts';
import type { Kind, Organ, RunState, StitchId, V } from '../../src/blade/rules.ts';

const S = (seq: Kind[], st: (StitchId | null)[] = []) => scoreSeq(seq, st).score;
const O = (id: number, kind: Kind, x: number, y: number, hp = kind === 'bone' ? 2 : 1): Organ => ({ id, kind, p: [x, y], hp });
/** 測試用盤面：把一局的怪物器官換成手擺的配置（反擊與門檻沿用 newRun 的結構）。 */
function staged(organs: Organ[], over: Partial<RunState> = {}): RunState {
  return { ...newRun(1), organs, counter: null, ...over };
}

// ---------------------------------------------------------------- BH-01 計分
test('BH-01 連斬：連續 ≥3 個同類倍率 +n；2 個不成立', () => {
  assert.equal(S(['claw', 'claw', 'claw', 'eye']), 38 * (1 + 3));           // 152
  assert.equal(S(['claw', 'claw', 'claw', 'claw', 'eye']), 48 * (1 + 4));    // 240（同類 4 連不算雙對）
  assert.equal(S(['claw', 'claw', 'claw']), 30 * (1 + 3) * 2);               // 3 個同類也是回文：連斬 +3、對稱 ×2＝240
  assert.equal(S(['claw', 'claw', 'eye']), 28 * 1);                   // 28
  assert.equal(S(['eye', 'claw', 'eye', 'claw']), 36 * 1);            // 不連續不算
});
test('BH-01 雙對：連續兩組不同類對子 +3；交錯不成立', () => {
  assert.equal(S(['eye', 'eye', 'claw', 'claw']), 36 * (1 + 3));      // 144
  assert.equal(S(['poison', 'claw', 'claw', 'eye', 'eye']), 56 * 4);  // 序列中段出現也算：224
  assert.equal(S(['eye', 'claw', 'eye', 'claw']), 36);
  assert.equal(S(['eye', 'eye', 'heart', 'claw', 'claw']), 41 * (1 + 1)); // 對子之間隔了一個：不算雙對，只有心 +1＝82
});
test('BH-01 對稱：長度 ≥3 且頭尾對稱 ×2；長度 2 或不對稱不成立', () => {
  assert.equal(S(['claw', 'eye', 'claw']), 28 * 2);                   // 56
  assert.equal(S(['claw', 'eye', 'eye', 'claw']), 36 * 2 * 1);        // 回文 ×2；中間 ee 只是一對（不是雙對）＝72
  assert.equal(S(['claw', 'claw']), 20);
  assert.equal(S(['claw', 'eye', 'eye']), 26);
  // 對稱＝整條序列回文（實作解讀）：只有首尾同類而中間不對稱，不成立
  assert.equal(S(['claw', 'eye', 'heart', 'claw']), 33 * 2);           // 籌碼 33、心 +1 → 66；不是回文所以沒有 ×2
});
test('BH-01 五色：5 種不同（含骨）×3；4 種不成立', () => {
  assert.equal(S(['claw', 'heart', 'eye', 'poison', 'bone']), 43 * (1 + 1) * 3);   // 籌碼 10+5+8+20+0=43，心 +1，×3＝258
  assert.equal(S(['claw', 'heart', 'eye', 'poison']), 43 * (1 + 1));              // 86
});
test('BH-01 心：每顆倍率 +1', () => {
  assert.equal(S(['heart']), 5 * 2);
  assert.equal(S(['heart', 'eye', 'eye']), 21 * 2);                  // 眼只有一對：不加
});
test('BH-01 組合成立：先加法再乘法', () => {
  // 心 爪 爪 爪 心：籌碼 40；加法：心 2＋連斬 3＝5 → 6；乘法：對稱 ×2 → 12；480。若先乘後加會是 (1×2)+5=7 → 280
  const r = scoreSeq(['heart', 'claw', 'claw', 'claw', 'heart'], []);
  assert.deepEqual([r.chips, r.addTotal, r.mulTotal, r.mult, r.score], [40, 5, 2, 12, 480]);
  // 五色＋對稱同時：爪 心 眼 毒 骨 毒 眼 心 爪 → 籌碼 10+5+8+20+0+20+8+5+10=86；加：心 2 → 3；乘：對稱 2×五色 3＝6 → 18；1548
  const r2 = scoreSeq(['claw', 'heart', 'eye', 'poison', 'bone', 'poison', 'eye', 'heart', 'claw'], []);
  assert.deepEqual([r2.chips, r2.mult, r2.score], [86, 18, 1548]);
});

// ---------------------------------------------------------------- BH-02 刀路
test('BH-02 依距離排序；同距離取 id 小者', () => {
  const org = [O(5, 'claw', 200, 300), O(2, 'eye', 100, 300), O(3, 'claw', 150, 400)];
  assert.deepEqual(cutPath(org, [40, 300], [360, 300], []).severed, [2, 5]);
  // id 大的離起點近：只按 id 排序的實作會給 [1, 4, 9]（審查 HIGH-2 補強）
  const rev = [O(1, 'claw', 300, 300), O(4, 'heart', 200, 300), O(9, 'eye', 100, 300)];
  assert.deepEqual(cutPath(rev, [40, 300], [360, 300], []).severed, [9, 4, 1]);
  assert.equal(scoreSeq(cutPath(rev, [40, 300], [360, 300], []).severed.map((id) => rev.find((o) => o.id === id)!.kind), []).seq.join(), 'eye,heart,claw');
  const back = [O(0, 'eye', 300, 300), O(1, 'bone', 200, 300), O(2, 'claw', 100, 300)];   // 骨在 id 中間、距離也在中間；從右往左切先碰 0 號
  assert.deepEqual(cutPath(back, [360, 300], [40, 300], []).severed, [0]);
  assert.deepEqual(cutPath(back, [40, 300], [360, 300], []).severed, [2]);
  const tie = [O(3, 'claw', 150, 310), O(1, 'eye', 150, 290)];       // 對刀線上下對稱：進入距離相同
  assert.deepEqual(cutPath(tie, [40, 300], [360, 300], []).severed, [1, 3]);
});
test('BH-02 骨擋刀：碰到就停；耐久 2，第一刀 −1 不斷、第二刀斷（進序列）且刀仍停', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'bone', 180, 300), O(2, 'eye', 260, 300)];
  const p1 = cutPath(org, [40, 300], [360, 300], []);
  assert.deepEqual([p1.severed, p1.stoppedAt, p1.boneHits], [[0], 1, [{ id: 1, broke: false }]]);
  const s1 = applyCut(staged(org), [40, 300], [360, 300]).state;
  assert.equal(s1.organs.find((o) => o.id === 1)!.hp, 1);
  const r2 = applyCut(s1, [40, 300], [360, 300]);
  assert.deepEqual(r2.record!.severed.map((x) => x.id), [1]);        // 骨斷了、刀停在骨，2 號眼沒被斬
  assert.ok(r2.state.organs.some((o) => o.id === 2) && !r2.state.organs.some((o) => o.id === 1));
});
test('BH-02 長度：<120 不出刀不耗刀；>420 截斷', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 500, 300)];
  assert.equal(cutPath(org, [40, 300], [150, 300], []).ok, false);
  const s0 = staged(org);
  const r = applyCut(s0, [40, 300], [150, 300]);
  assert.equal(r.record, null); assert.equal(r.state.cutsLeft, s0.cutsLeft);
  const p = cutPath(org, [40, 300], [700, 300], []);
  assert.deepEqual([p.severed, Math.round(p.b[0])], [[0], 460]);    // 40＋420；500 的眼沒碰到
});

// ---------------------------------------------------------------- BH-03 反擊
test('BH-03 斬到預告爪→取消；沒斬到→打掉槽內器官；空槽→下一隻少 1 刀；逆鱗→失去 1 次抽搐', () => {
  const ctr = { clawId: 7, slot: 1 };
  assert.equal(resolveCounter([null, 'echo', null, null], ctr, [3, 7], 2).result, 'cancelled');
  const hit = resolveCounter([null, 'echo', null, null], ctr, [3], 2);
  assert.deepEqual([hit.result, hit.slots, hit.lost], ['slotLost', [null, null, null, null], 'echo']);
  const empty = resolveCounter([null, null, null, null], ctr, [], 2);
  assert.deepEqual([empty.result, empty.cutPenalty], ['cutLost', 1]);
  const sc = resolveCounter(['scale', 'echo', null, null], ctr, [], 2);
  assert.deepEqual([sc.result, sc.twitchesLeft, sc.slots], ['twitchLost', 1, ['scale', 'echo', null, null]]);
  const sc0 = resolveCounter(['scale', 'echo', null, null], ctr, [], 0);   // 抽搐用完時逆鱗不生效，照常打掉
  assert.equal(sc0.result, 'slotLost');
});
test('BH-03 整合：空槽被打中 → 下一隻怪只有 3 刀；斬到預告爪 → 沒懲罰', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 200, 300), O(2, 'claw', 400, 150)];
  let s = staged(org, { counter: { clawId: 2, slot: 0 }, threshold: 30 });
  s = applyCut(s, [40, 300], [165, 300]).state;                // 只斬到 0 號爪（10 分）；預告的 2 號爪沒斬到
  assert.equal(s.pendingCutPenalty, 1);
  s = applyCut({ ...s, counter: { clawId: 1, slot: 0 }, organs: [O(1, 'eye', 200, 300), O(3, 'poison', 260, 300)] }, [150, 300], [320, 300]).state; // 斬到眼(=預告爪 id)＋毒：28 分，累計 38≥30
  assert.equal(s.phase, 'stitch');
  s = chooseStitch(s, s.offer[0]);
  assert.deepEqual([s.monster, s.cutsMax, s.cutsLeft], [1, 3, 3]);
});

// ---------------------------------------------------------------- BH-04 縫合（8 種各一）
test('BH-04 鋒爪：每個爪 +10 籌碼', () => { assert.deepEqual([S(['claw', 'eye']), S(['claw', 'eye'], ['sharpClaw'])], [18, 28]); });
test('BH-04 雙心：心倍率 +2', () => { assert.deepEqual([S(['heart', 'eye']), S(['heart', 'eye'], ['twinHeart'])], [13 * 2, 13 * 3]); });
test('BH-04 獨眼：對稱 ×3', () => { assert.deepEqual([S(['claw', 'eye', 'claw']), S(['claw', 'eye', 'claw'], ['oneEye'])], [56, 84]); });
test('BH-04 骨刃：碰骨不停、直接斬斷，骨 15 籌碼', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'bone', 180, 300), O(2, 'eye', 260, 300)];
  const a: V = [40, 300], b: V = [360, 300];
  const without = applyCut(staged(org), a, b).record!, withB = applyCut(staged(org, { slots: ['boneBlade', null, null, null] }), a, b).record!;
  assert.deepEqual([without.score.score, withB.severed.map((x) => x.id), withB.score.score], [10, [0, 1, 2], 10 + 15 + 8]);
});
test('BH-04 毒脈：連斬中的每個毒倍率 +2', () => { assert.deepEqual([S(['poison', 'poison', 'poison', 'eye']), S(['poison', 'poison', 'poison', 'eye'], ['venom'])], [68 * 4, 68 * 10]); });
test('BH-04 長臂：刀長上限 560', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 540, 300)];
  const a: V = [40, 300], b: V = [690, 300];
  assert.deepEqual([applyCut(staged(org), a, b).record!.score.score, applyCut(staged(org, { slots: [null, 'longArm', null, null] }), a, b).record!.score.score], [10, 18]);
});
test('BH-04 回刃：最後一個被斬的器官籌碼再算一次', () => { assert.deepEqual([S(['claw', 'eye']), S(['claw', 'eye'], ['echo'])], [18, 26]); });
test('BH-04 逆鱗：被反擊打中時失去 1 次抽搐，縫合不被打掉', () => {
  const org = [O(0, 'claw', 100, 300), O(2, 'claw', 400, 150)];
  const base = { counter: { clawId: 2, slot: 1 }, threshold: 999 };
  const a: V = [40, 300], b: V = [200, 300];
  const no = applyCut(staged(org, { ...base, slots: [null, 'echo', null, null] }), a, b).state;
  const yes = applyCut(staged(org, { ...base, slots: ['scale', 'echo', null, null] }), a, b).state;
  assert.deepEqual([no.slots[1], no.twitchesLeft], [null, 2]);
  assert.deepEqual([yes.slots[1], yes.twitchesLeft], ['echo', 1]);
});

// ---------------------------------------------------------------- BH-05 生成
test('BH-05 同種子同配置；不同種子不同', () => {
  assert.deepEqual(genMonster(42, 0), genMonster(42, 0));
  assert.notDeepEqual(genMonster(42, 0), genMonster(43, 0));
  assert.deepEqual(newRun(9), newRun(9));
});
test('BH-05 200 個種子：14 個器官都在輪廓內、不重疊；每個配置都有合法刀線斬到 ≥4 個（腳本搜尋）', () => {
  let minBest = Infinity;
  for (let seed = 1; seed <= 200; seed++) for (let m = 0; m < 3; m++) {
    const organs = genMonster(seed, m);
    assert.equal(organs.length, TUNE.ORGANS);
    for (const o of organs) assert.ok(inMonster(o.p, TUNE.R), `seed ${seed} m${m} #${o.id} 出界`);
    for (let i = 0; i < organs.length; i++) for (let j = i + 1; j < organs.length; j++) {
      const d = Math.hypot(organs[i].p[0] - organs[j].p[0], organs[i].p[1] - organs[j].p[1]);
      assert.ok(d >= 2 * TUNE.R, `seed ${seed} m${m} 重疊 ${i}-${j}`);
    }
    const b = bestLine({ ...newRun(seed), organs }, 'count')!;
    const len = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
    assert.ok(len >= TUNE.MIN_LEN && len <= TUNE.MAX_LEN + 1e-6);
    assert.ok(b.count >= 4, `seed ${seed} m${m} 最多只斬 ${b.count}`);
    minBest = Math.min(minBest, b.count);
  }
  assert.ok(minBest >= 4);
});

// ---------------------------------------------------------------- 流程補充
test('流程：抽搐重新散布、不耗刀、最多 2 次；4 刀不達標＝敗；縫合滿槽可替換', () => {
  const s0 = newRun(5);
  const s1 = twitch(s0);
  assert.notDeepEqual(s1.organs.map((o) => o.p), s0.organs.map((o) => o.p));
  assert.deepEqual(s1.organs.map((o) => [o.id, o.kind]), s0.organs.map((o) => [o.id, o.kind]));
  assert.deepEqual([s1.cutsLeft, s1.twitchesLeft], [s0.cutsLeft, 1]);
  const s3 = twitch(twitch(s1));
  assert.equal(s3.twitchesLeft, 0); assert.equal(twitch(s3), s3);
  let lose = staged([O(0, 'eye', 100, 300)], { threshold: 9999 });
  for (let i = 0; i < 4; i++) lose = applyCut(lose, [600, 900], [600, 750]).state;   // 揮空 4 刀
  assert.equal(lose.phase, 'lost');
  const full = { ...newRun(3), phase: 'stitch' as const, slots: ['echo', 'venom', 'oneEye', 'longArm'] as (StitchId | null)[], offer: ['sharpClaw', 'scale', 'boneBlade'] as StitchId[] };
  assert.equal(chooseStitch(full, 'sharpClaw'), full);                                 // 槽滿沒指定槽：不動
  assert.deepEqual(chooseStitch(full, 'sharpClaw', 2).slots, ['echo', 'venom', 'sharpClaw', 'longArm']);
});
