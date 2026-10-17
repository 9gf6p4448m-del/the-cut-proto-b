// 刀譜規則（the-cut 0233f19 docs/core-redesign-r5/BLADE_HAND_SKETCH.md BH-01～05；v0.2 變更 068ca72 同檔檔尾 BV-01～04）。作者測試。
// 標【v0.2】／【v0.3】的斷言是依新規則更新或新增的（逐條列在 the-cut docs/core-redesign-r5/BLADE_AUTHOR_EVIDENCE.md 的 v0.2／v0.3 段）。
// v0.3 變更：0857472 同檔檔尾 BW-01～05（反擊搶分取代門檻上升）。
// 預期數字依設計檔規則手算後寫死（算式寫在註解），不由被測函式推出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCut, bestLine, chooseStitch, cutPath, evaluate, genMonster, inMonster, newRun, resolveCounters, scoreSeq, startMonster, twitch, TUNE,
} from '../../src/blade/rules.ts';
import type { Kind, Organ, RunState, StitchId, V } from '../../src/blade/rules.ts';

const S = (seq: Kind[], st: (StitchId | null)[] = []) => scoreSeq(seq, st).score;
const O = (id: number, kind: Kind, x: number, y: number, hp = kind === 'bone' ? 2 : 1): Organ => ({ id, kind, p: [x, y], hp });
/** 測試用盤面：把一局的怪物器官換成手擺的配置（反擊與門檻沿用 newRun 的結構）。 */
function staged(organs: Organ[], over: Partial<RunState> = {}): RunState {
  return { ...newRun(1), organs, counters: [], ...over };
}

// ---------------------------------------------------------------- BH-01 計分
test('BH-01 連斬：連續 ≥3 個同類倍率 +n；2 個不成立', () => {
  assert.equal(S(['claw', 'claw', 'claw', 'eye']), 38 * (1 + 3));           // 152
  assert.equal(S(['claw', 'claw', 'claw', 'claw', 'eye']), 48 * (1 + 4));    // 240（同類 4 連不算雙對）
  assert.equal(S(['claw', 'claw', 'claw']), 30 * (1 + 3));                   // 【v0.2】長度 3 不再算對稱：120（v0.1 是 240）
  assert.equal(S(['claw', 'claw', 'eye']), 28 * 1);                   // 28
  assert.equal(S(['eye', 'claw', 'eye', 'claw']), 36 * 1);            // 不連續不算
});
test('BH-01 雙對：連續兩組不同類對子 +3；交錯不成立', () => {
  assert.equal(S(['eye', 'eye', 'claw', 'claw']), 36 * (1 + 3));      // 144
  assert.equal(S(['poison', 'claw', 'claw', 'eye', 'eye']), 56 * 4);  // 序列中段出現也算：224
  assert.equal(S(['eye', 'claw', 'eye', 'claw']), 36);
  assert.equal(S(['eye', 'eye', 'heart', 'claw', 'claw']), 41 * (1 + 1)); // 對子之間隔了一個：不算雙對，只有心 +1＝82
});
test('BH-01／BV-03 對稱：長度 ≥4 且整條回文 ×2；長度 3、長度 2 或不對稱不成立', () => {
  assert.equal(S(['claw', 'eye', 'claw']), 28);                       // 【v0.2】長度 3 不成立（v0.1 是 56）
  assert.equal(S(['claw', 'eye', 'eye', 'claw']), 36 * 2);            // 長度 4 回文 ×2＝72
  assert.equal(S(['claw', 'claw']), 20);
  assert.equal(S(['claw', 'eye', 'eye']), 26);
  // 對稱＝整條序列回文（實作解讀）：只有首尾同類而中間不對稱，不成立
  assert.equal(S(['claw', 'eye', 'heart', 'claw']), 33 * 2);           // 籌碼 33、心 +1 → 66；不是回文所以沒有 ×2
});
test('BH-01／BV-03 四色：4 種以上不同 ×2.5；3 種不成立', () => {
  // 【v0.2】五色 ×3 改為四色 ×2.5
  assert.equal(S(['claw', 'heart', 'eye', 'poison']), 43 * (1 + 1) * 2.5);        // 籌碼 43，心 +1 → 2，×2.5＝215（v0.1：4 種不成立＝86）
  assert.equal(S(['claw', 'heart', 'eye', 'poison', 'bone']), 43 * 2 * 2.5);       // 5 種也只乘一次 2.5＝215（v0.1 ×3＝258）
  assert.equal(S(['claw', 'heart', 'eye']), 23 * 2);                              // 3 種不成立＝46
  assert.equal(S(['claw', 'eye', 'poison', 'eye', 'heart']), Math.floor(51 * 2 * 2.5)); // 籌碼 10+8+20+8+5=51 → 255
  assert.equal(S(['claw', 'eye', 'poison', 'heart', 'heart']), Math.floor(48 * 3 * 2.5)); // 心 2 → 3；×2.5＝360
  assert.equal(S(['eye', 'poison', 'heart', 'claw', 'claw', 'heart', 'eye']), Math.floor(66 * 3 * 2.5)); // 7 長不對稱：495
  assert.equal(S(['eye', 'heart', 'poison', 'heart', 'eye']), 46 * 3 * 2);       // 3 種：無四色；長度 5 回文 ×2；籌碼 46、心 2 → 3：276
});
test('BH-01 心：每顆倍率 +1', () => {
  assert.equal(S(['heart']), 5 * 2);
  assert.equal(S(['heart', 'eye', 'eye']), 21 * 2);                  // 眼只有一對：不加
});
test('BH-01 組合成立：先加法再乘法', () => {
  // 心 爪 爪 爪 心：籌碼 40；加法：心 2＋連斬 3＝5 → 6；乘法：對稱 ×2 → 12；480。若先乘後加會是 (1×2)+5=7 → 280
  const r = scoreSeq(['heart', 'claw', 'claw', 'claw', 'heart'], []);
  assert.deepEqual([r.chips, r.addTotal, r.mulTotal, r.mult, r.score], [40, 5, 2, 12, 480]);
  // 【v0.2】四色＋對稱同時：爪 心 眼 毒 骨 毒 眼 心 爪 → 籌碼 86；加：心 2 → 3；乘：對稱 2×四色 2.5＝5 → 15；1290（v0.1 五色 ×3：1548）
  const r2 = scoreSeq(['claw', 'heart', 'eye', 'poison', 'bone', 'poison', 'eye', 'heart', 'claw'], []);
  assert.deepEqual([r2.chips, r2.mult, r2.score], [86, 15, 1290]);
  // 四色 ×2.5 遇到奇數乘積時無條件捨去：毒 眼 爪 心 → 籌碼 43 × (1+1) × 2.5＝215；眼 爪 毒 骨 → 籌碼 38 × 1 × 2.5＝95；爪 眼 心 骨 → 23 × 2 × 2.5＝115；眼 爪 骨（3 種）＝18
  assert.equal(S(['eye', 'claw', 'poison', 'bone']), 95);
  // 乘積不是整數時無條件捨去：心 爪 爪 爪 眼 毒 → 籌碼 63；加：心 1＋連斬 3 → 5；×四色 2.5 → 12.5；63×12.5＝787.5 → 787
  assert.equal(S(['heart', 'claw', 'claw', 'claw', 'eye', 'poison']), 787);
  assert.equal(S(['claw', 'heart', 'eye', 'eye', 'bone']), 155);     // 籌碼 31、心 +1 → 2、4 種 ×2.5

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
test('BH-02／BV-03 骨擋刀：碰到就停；耐久 2，第一刀 −1 不斷（v0.2：仍進序列最後一位）、第二刀斷（進序列）且刀仍停', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'bone', 180, 300), O(2, 'eye', 260, 300)];
  const p1 = cutPath(org, [40, 300], [360, 300], []);
  assert.deepEqual([p1.severed, p1.stoppedAt, p1.boneHits], [[0], 1, [{ id: 1, broke: false }]]);
  assert.deepEqual(p1.seqIds, [0, 1]);                                // 【v0.2】骨沒斷也進序列最後一位（v0.1 序列只有 [0]）
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

// ---------------------------------------------------------------- BH-03／BV-01 反擊（v0.2 多重反擊）
test('BH-03／BV-01／BW-01 每條獨立：斬到該爪→取消；沒斬到→依序各搶當下累積分數的 20%（捨去），該槽有縫合一併打掉；門檻不參與', () => {
  // 【v0.3】取代 v0.2 的「空槽門檻 +15%／打掉縫合」：一律搶分，有縫合同時打掉
  const ctr = [{ clawId: 7, slot: 1 }, { clawId: 8, slot: 2 }, { clawId: 9, slot: 1 }];
  // 只斬到 8：7 搶 20%（1000→800）並打掉槽 1 的回刃；9 也指向槽 1（已空）再搶 20%（800→640）
  const r = resolveCounters([null, 'echo', 'venom', null], ctr, [3, 8], 1000);
  assert.deepEqual([r.results, r.slots, r.lost, r.steals, r.stealLost, r.score, r.hits], [['stolen', 'cancelled', 'stolen'], [null, null, 'venom', null], ['echo'], [200, 160], ['echo', null], 640, 2]);
  // 全部取消：不搶
  const c = resolveCounters([null, 'echo', null, null], ctr, [7, 8, 9], 1000);
  assert.deepEqual([c.results, c.steals, c.score], [['cancelled', 'cancelled', 'cancelled'], [], 1000]);
  // 三條全中：1000→800→640→512
  assert.deepEqual(resolveCounters([null, null, null, null], ctr, [], 1000).steals, [200, 160, 128]);
  // 捨去：99 → 搶 floor(19.8)=19 → 80 → 搶 16 → 64
  const f = resolveCounters([null, null, null, null], ctr.slice(0, 2), [], 99);
  assert.deepEqual([f.steals, f.score], [[19, 16], 64]);
  // 0 分時被搶 0
  assert.deepEqual(resolveCounters([null, null, null, null], ctr.slice(0, 1), [], 0).steals, [0]);
});
test('BW-02 逆鱗：被打中只搶 10%（捨去），縫合都不掉', () => {
  const ctr = [{ clawId: 7, slot: 1 }, { clawId: 8, slot: 2 }, { clawId: 9, slot: 1 }];
  const sc = resolveCounters(['scale', 'echo', 'venom', null], ctr, [8], 1000);
  assert.deepEqual([sc.results, sc.slots, sc.steals, sc.score], [['scaleStolen', 'cancelled', 'scaleStolen'], ['scale', 'echo', 'venom', null], [100, 90], 810]);
  assert.deepEqual(resolveCounters(['scale', null, null, null], ctr.slice(0, 1), [], 55).steals, [5]);   // floor(5.5)
});
test('BV-01 每隻怪的預告數量依序 1／2／3／3（爪不重複）', () => {
  assert.deepEqual(TUNE.COUNTERS, [1, 2, 3, 3]);
  assert.deepEqual(TUNE.THRESHOLDS, [150, 400, 800, 1600]);            // 【v0.3】900／1800 → 800／1600
  for (const seed of [1, 2, 3, 50, 99]) for (let m = 0; m < 4; m++) {
    const s = startMonster(newRun(seed), m);
    const claws = s.organs.filter((o) => o.kind === 'claw').length;
    assert.ok(claws >= 3, `seed ${seed} m${m} 爪 ${claws}`);
    assert.equal(s.counters.length, [1, 2, 3, 3][m], `seed ${seed} m${m}`);
    assert.equal(new Set(s.counters.map((c) => c.clawId)).size, s.counters.length);
    for (const c of s.counters) assert.equal(s.organs.find((o) => o.id === c.clawId)!.kind, 'claw');
  }
});
test('BW-01 整合：先把本刀分數加進累積，再搶分（本刀分數同樣被搶）；門檻不變；擊倒那一刀反擊不發動；下一隻重置', () => {
  // 【v0.3】取代 v0.2 的「門檻 400→520」與「跨刀 150→195」兩個整合案例
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 200, 300), O(2, 'claw', 400, 150), O(3, 'claw', 500, 150)];
  let s = staged(org, { counters: [{ clawId: 2, slot: 0 }, { clawId: 3, slot: 1 }], threshold: 400, monsterScore: 90, slots: [null, 'oneEye', null, null] });   // 用不影響這刀分數的縫合（回刃會改籌碼）
  const r1 = applyCut(s, [40, 300], [165, 300]);                     // 只斬 0 號爪（10 分）：90＋10＝100 → 兩條沒取消 → 100→80→64；槽 1 獨眼打掉
  s = r1.state;
  assert.deepEqual([r1.record!.scoreBeforeSteal, r1.record!.steals, r1.record!.stealLost, s.monsterScore, s.threshold, s.hits, s.stolen, s.slots[1]], [100, [20, 16], [null, 'oneEye'], 64, 400, 2, 36, null]);
  assert.equal(s.totalScore, newRun(1).totalScore + 10 - 36);        // 總分也扣掉被搶的
  const r = applyCut({ ...s, monsterScore: 395, counters: [{ clawId: 2, slot: 0 }] }, [150, 300], [320, 300]);   // 斬眼 8 分 → 403 ≥ 400 擊倒
  assert.deepEqual([r.record!.cleared, r.record!.counterResults, r.record!.steals, r.state.monsterScore, r.state.phase], [true, [], [], 403, 'stitch']);
  const n = chooseStitch(r.state, r.state.offer[0]);
  assert.deepEqual([n.monster, n.threshold, n.monsterScore, n.hits, n.stolen, n.cutsMax], [1, 400, 0, 0, 0, 4]);
});
test('BW-01 跨刀：每刀都以「當下累積」為準搶分，門檻始終不變', () => {
  // 【v0.3】取代 v0.2 的「跨刀門檻累加 150→195」
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 100, 500), O(2, 'claw', 400, 150)];
  let s = staged(org, { counters: [{ clawId: 2, slot: 0 }], threshold: 150 });
  s = applyCut(s, [40, 300], [165, 300]).state;                      // 0＋10＝10 → 搶 2 → 8
  assert.deepEqual([s.monsterScore, s.threshold], [8, 150]);
  s = applyCut({ ...s, counters: [{ clawId: 2, slot: 3 }] }, [40, 500], [165, 500]).state;   // 8＋8＝16 → 搶 3 → 13
  assert.deepEqual([s.monsterScore, s.threshold, s.hits, s.stolen], [13, 150, 2, 5]);
});

// ---------------------------------------------------------------- BH-04 縫合（8 種各一）
test('BH-04／BV-04 鋒爪：每個爪 +6 籌碼', () => { assert.deepEqual([S(['claw', 'eye']), S(['claw', 'eye'], ['sharpClaw'])], [18, 24]); });   // 【v0.2】+10 → +6（v0.1：28）
test('BH-04 雙心：心倍率 +2', () => { assert.deepEqual([S(['heart', 'eye']), S(['heart', 'eye'], ['twinHeart'])], [13 * 2, 13 * 3]); });
test('BH-04 獨眼：對稱 ×3', () => { assert.deepEqual([S(['claw', 'eye', 'eye', 'claw']), S(['claw', 'eye', 'eye', 'claw'], ['oneEye'])], [72, 108]); });   // 【v0.2】改用長度 4 的回文（長度 3 已不算對稱）
test('BH-04 骨刃：碰骨不停、直接斬斷，骨 15 籌碼', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'bone', 180, 300), O(2, 'eye', 260, 300)];
  const a: V = [40, 300], b: V = [360, 300];
  const without = applyCut(staged(org), a, b).record!, withB = applyCut(staged(org, { slots: ['boneBlade', null, null, null] }), a, b).record!;
  assert.deepEqual([without.seq, without.score.score, withB.severed.map((x) => x.id), withB.score.score], [['claw', 'bone'], 10, [0, 1, 2], 10 + 15 + 8]);   // 【v0.2】沒骨刃時序列是 爪 骨（骨 0 籌碼）
});
test('BH-04／BV-04 毒脈：每顆毒倍率 +2，不需連斬', () => {
  // 【v0.2】不需連斬：毒 眼 毒 → 籌碼 48；沒毒脈 ×1；有毒脈 1+4＝5（v0.1 不在連斬中＝沒效果）
  assert.deepEqual([S(['poison', 'eye', 'poison']), S(['poison', 'eye', 'poison'], ['venom'])], [48, 48 * 5]);
  assert.deepEqual([S(['poison', 'poison', 'poison', 'eye']), S(['poison', 'poison', 'poison', 'eye'], ['venom'])], [68 * 4, 68 * 10]);   // 連斬中照樣每顆 +2
});
test('BH-04／BV-04 長臂：刀長上限 560，每刀籌碼 +10', () => {
  const org = [O(0, 'claw', 100, 300), O(1, 'eye', 540, 300)];
  const a: V = [40, 300], b: V = [690, 300];
  assert.deepEqual([applyCut(staged(org), a, b).record!.score.score, applyCut(staged(org, { slots: [null, 'longArm', null, null] }), a, b).record!.score.score], [10, 18 + 10]);   // 【v0.2】另加每刀籌碼 +10（v0.1：18）
  assert.equal(applyCut(staged(org, { slots: [null, 'longArm', null, null] }), [600, 980], [600, 840]).record!.score.score, 0);   // 揮空不加
});
test('BH-04 回刃：最後一個被斬的器官籌碼再算一次', () => { assert.deepEqual([S(['claw', 'eye']), S(['claw', 'eye'], ['echo'])], [18, 26]); });
test('BH-04／BW-02 逆鱗：被反擊打中時只搶 10%，縫合不被打掉', () => {
  // 【v0.3】v0.2 為「門檻 +5%」
  const org = [O(0, 'claw', 100, 300), O(2, 'claw', 400, 150)];
  const base = { counters: [{ clawId: 2, slot: 1 }], threshold: 400, monsterScore: 190 };
  const a: V = [40, 300], b: V = [200, 300];
  const no = applyCut(staged(org, { ...base, slots: [null, 'oneEye', null, null] }), a, b).state;     // 190＋10＝200 → 搶 40 → 160，獨眼掉
  const yes = applyCut(staged(org, { ...base, slots: ['scale', 'oneEye', null, null] }), a, b).state;  // 200 → 搶 20 → 180，獨眼保留
  assert.deepEqual([no.slots[1], no.monsterScore, no.threshold], [null, 160, 400]);
  assert.deepEqual([yes.slots[1], yes.monsterScore, yes.threshold], ['oneEye', 180, 400]);
});

// ---------------------------------------------------------------- BH-05 生成
test('BH-05 同種子同配置；不同種子不同', () => {
  assert.deepEqual(genMonster(42, 0), genMonster(42, 0));
  assert.notDeepEqual(genMonster(42, 0), genMonster(43, 0));
  assert.deepEqual(newRun(9), newRun(9));
});
test('BH-05 200 個種子×4 隻：14 個器官都在輪廓內、不重疊；每個配置都有合法刀線斬到 ≥4 個（腳本搜尋）', () => {
  let minBest = Infinity;
  for (let seed = 1; seed <= 200; seed++) for (let m = 0; m < TUNE.THRESHOLDS.length; m++) {   // 【v0.2】涵蓋 4 隻
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

// ---------------------------------------------------------------- BV-02 預告選法
test('BV-02 選爪規則：線外的爪夠用時，預告爪一隻都不在當下最高分線上；線外的非血脈爪夠用時，預告爪都不在血脈上', () => {
  // 審查 HIGH-1：只看比例 ≤20% 時，純亂數挑爪（約 17.6%）也會過；這裡直接守選法本身。開局與每一刀之前的狀態都檢查。
  let checked = 0, veinChecked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let s = newRun(seed);
    for (let guard = 0; guard < 30 && (s.phase === 'aim' || s.phase === 'stitch'); guard++) {
      if (s.phase === 'stitch') { s = chooseStitch(s, s.offer[0], s.slots.includes(null) ? undefined : 0); continue; }
      const b = bestLine({ ...s, counters: [] }, 'score'); if (!b) break;   // 盤面剩不到兩個器官時沒有候選線
      const on = new Set(evaluate(s, b.a, b.b).path.severed);
      const claws = s.organs.filter((o) => o.kind === 'claw');
      const off = claws.filter((o) => !on.has(o.id)), offPlain = off.filter((o) => !o.vein);
      const chosen = s.counters.map((c) => s.organs.find((o) => o.id === c.clawId)!);
      if (off.length >= s.counters.length) { checked++; for (const o of chosen) assert.ok(!on.has(o.id), `seed ${seed} m${s.monster} cut${s.cutNo} 爪 ${o.id} 在最高分線上`); }
      if (offPlain.length >= s.counters.length) { veinChecked++; for (const o of chosen) assert.ok(!o.vein, `seed ${seed} m${s.monster} cut${s.cutNo} 爪 ${o.id} 在血脈上`); }
      s = applyCut(s, b.a, b.b).state;
    }
  }
  assert.ok(checked > 100 && veinChecked > 50, `${checked}/${veinChecked}`);
});
test('BV-02 200 種子×4 隻：「當下最高分線同時斬斷全部預告爪」比例 ≤20%（報告實際值）', () => {
  let all = 0, n = 0;
  for (let seed = 1; seed <= 200; seed++) for (let m = 0; m < 4; m++) {
    const s = startMonster(newRun(seed), m);
    const b = bestLine(s, 'score')!;
    const sev = evaluate(s, b.a, b.b).path.severed;
    n++; if (s.counters.length && s.counters.every((c) => sev.includes(c.clawId))) all++;
  }
  console.log(`BV-02 實際值：${all}/${n}＝${((100 * all) / n).toFixed(1)}%`);
  assert.ok(all / n <= 0.2, `${all}/${n}`);
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
