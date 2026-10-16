// 凍結驗收 X-5：實驗 A 執念規則（EXPERIMENT_A_RULES v1 §2–§4）。作者測試。
// 單元：直接以 SideFacts 呼叫 choose（每個案例都讓「執念」與「原版評分鏈」指向不同側，否則無法分辨）。
// 整合：resolveRound（切穿心臟不計）與真實引擎對局（每次 OBSESSION 的前提都成立、該觸發時一定觸發）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose } from '../../engine/src/enemy.ts';
import { resolveRound } from '../../engine/src/resolve.ts';
import { loadContent } from '../../engine/src/content.ts';
import { obsessionPick, obsessionPreview } from '../../engine/src/experiment.ts';
import { partitionOf } from '../../engine/src/engine.ts';
import type { EnemyConfig, Ev, Organ, SideFacts } from '../../engine/src/types.ts';
import { expConfig, playRandom } from '../browser/exp_entry.ts';
import { newBattle, act, legalLines } from '../../engine/src/engine.ts';

const content = loadContent();
const HEART: EnemyConfig = { kind: 'OBS_HEART', w10: 7 };
const AREA: EnemyConfig = { kind: 'OBS_AREA', w10: 7 };
const BUT: EnemyConfig = { kind: 'BUT', w10: 7 };
const F = (o: Partial<SideFacts>): SideFacts => ({ pLoss: 0, eLoss: 0, v: 0, lethal: false, area2: 50, pNum: 0, pDen: 20, U: 0, ...o });

test('X-5 A1 執念觸發：兩側都不致死、心臟數不同 → 拿心臟多的一側（即使原版評分偏好另一側）', () => {
  const L = F({ hearts: 2, U: 10 }), R = F({ hearts: 1, U: 900 });
  assert.equal(choose(BUT, 'SO-3', L, R, 'R').side, 'R', '前提：原版評分鏈選 R');
  const c = choose(HEART, 'SO-3', L, R, 'R');
  assert.deepEqual([c.side, c.reason], ['L', 'OBSESSION']);
});

test('X-5 A1 單側致死 → SURVIVAL（求生優先於執念）', () => {
  const L = F({ hearts: 3, lethal: true, U: 900 }), R = F({ hearts: 0, U: 10 });
  const c = choose(HEART, 'SO-3', L, R, 'R');
  assert.deepEqual([c.side, c.reason], ['R', 'SURVIVAL']);
  const c2 = choose(HEART, 'SO-3', F({ hearts: 0 }), F({ hearts: 2, lethal: true }), 'R');
  assert.deepEqual([c2.side, c2.reason], ['L', 'SURVIVAL']);
});

test('X-5 A1 兩側致死 → SO-3 選玩家損失小的一側（執念不參與）', () => {
  const L = F({ hearts: 3, lethal: true, pLoss: 9, U: 900 }), R = F({ hearts: 0, lethal: true, pLoss: 2, U: 10 });
  const c = choose(HEART, 'SO-3', L, R, 'R');
  assert.deepEqual([c.side, c.reason], ['R', 'SO-3']);
});

test('X-5 A1 兩側致死且玩家損失相同 → 與 Baseline 相同（評分鏈），不走執念', () => {
  const L = F({ hearts: 3, lethal: true, pLoss: 4, U: 10 }), R = F({ hearts: 0, lethal: true, pLoss: 4, U: 900 });
  const b = choose(BUT, 'SO-3', L, R, 'R');
  const c = choose(HEART, 'SO-3', L, R, 'R');
  assert.deepEqual([c.side, c.reason], [b.side, b.reason]);
  assert.equal(c.side, 'R');
});

test('X-5 A1 心臟數平手（含兩側都 0）→ 完全照 Baseline 屠夫評分鏈（U → v → 面積 → 固定側）', () => {
  const cases: [Partial<SideFacts>, Partial<SideFacts>][] = [
    [{ hearts: 1, U: 300 }, { hearts: 1, U: 200 }],
    [{ hearts: 0, U: 200, v: 1 }, { hearts: 0, U: 200, v: 3 }],
    [{ hearts: 2, area2: 70 }, { hearts: 2, area2: 30 }],
    [{ hearts: 0 }, { hearts: 0 }],
  ];
  const seen = new Set<string>();
  for (const [l, r] of cases) {
    const L = F(l), R = F(r);
    const b = choose(BUT, 'SO-3', L, R, 'R'), c = choose(HEART, 'SO-3', L, R, 'R');
    assert.deepEqual([c.side, c.reason], [b.side, b.reason]);
    seen.add(c.reason);
  }
  assert.deepEqual([...seen].sort(), ['PREF', 'TIE-area', 'TIE-fixed', 'TIE-v']);
});

test('X-5 A1 切穿的心臟不計入任何一側（resolveRound 整合）', () => {
  const o = (id: number, key: Organ['key']): Organ => ({ id, key, x: 0, y: 0 });
  const out = resolveRound({
    hp: { P: 40, E: 30 }, maxHp: { P: 40, E: 30 }, pierced: [o(1, 'heart'), o(2, 'heart')], L: [o(3, 'heart')], R: [o(4, 'fission'), o(5, 'fission')],
    area2: { L: 500, R: 500 }, fixedSide: 'R', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: HEART, content, nextId: 10,
  });
  const ch = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE')!;
  assert.equal(ch.basis!.L.hearts, 1, 'L 側心臟數只算 L 的 1 顆');
  assert.equal(ch.basis!.R.hearts, 0, 'R 側心臟數 0（兩顆切穿的不算）');
  assert.deepEqual([ch.side, ch.reason], ['L', 'OBSESSION']);
  const base = resolveRound({
    hp: { P: 40, E: 30 }, maxHp: { P: 40, E: 30 }, pierced: [o(1, 'heart'), o(2, 'heart')], L: [o(3, 'heart')], R: [o(4, 'fission'), o(5, 'fission')],
    area2: { L: 500, R: 500 }, fixedSide: 'R', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: BUT, content, nextId: 10,
  });
  const bch = base.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE')!;
  assert.equal(bch.side, 'R', '前提：Baseline 屠夫選 R（兩顆裂變攻擊 8 > 心臟 6），所以執念有分辨力');
  assert.equal('hearts' in bch.basis!.L, false, 'Baseline 的 CHOICE 不含 hearts 欄位');
});

test('X-5 A2 門檻邊界：剛好 10%（10×|ΔA| = A_total）觸發；差 1 單位（10×|ΔA| = A_total − 1）不觸發', () => {
  // 剛好：L=11、R=9，10×2 = 20 = 總 20
  const L = F({ area2: 11, U: 10 }), R = F({ area2: 9, U: 900 });
  assert.equal(choose(BUT, 'SO-3', L, R, 'R').side, 'R');
  assert.deepEqual([choose(AREA, 'SO-3', L, R, 'R').side, choose(AREA, 'SO-3', L, R, 'R').reason], ['L', 'OBSESSION']);
  // 差 1 單位：L=17、R=14，10×3 = 30 = 總 31 − 1
  const L2 = F({ area2: 17, U: 10 }), R2 = F({ area2: 14, U: 900 });
  const b2 = choose(BUT, 'SO-3', L2, R2, 'R'), c2 = choose(AREA, 'SO-3', L2, R2, 'R');
  assert.deepEqual([c2.side, c2.reason], [b2.side, b2.reason]);
  assert.deepEqual([c2.side, c2.reason], ['R', 'PREF']);
  // 實際尺度：總 1000，差 100 觸發；差 98 不觸發；差很大一定觸發
  assert.equal(obsessionPick('OBS_AREA', { L: 0, R: 0 }, { L: 450, R: 550 }), 'R');
  assert.equal(obsessionPick('OBS_AREA', { L: 0, R: 0 }, { L: 451, R: 549 }), null);
  assert.equal(obsessionPick('OBS_AREA', { L: 0, R: 0 }, { L: 800, R: 200 }), 'L');
  const c3 = choose(AREA, 'SO-3', F({ area2: 800, U: 10 }), F({ area2: 200, U: 900 }), 'R');
  assert.deepEqual([c3.side, c3.reason], ['L', 'OBSESSION']);
});

test('X-5 A2 求生優先：面積大的一側致死 → SURVIVAL 拿小的；兩側致死 → SO-3', () => {
  const c = choose(AREA, 'SO-3', F({ area2: 800, lethal: true }), F({ area2: 200 }), 'R');
  assert.deepEqual([c.side, c.reason], ['R', 'SURVIVAL']);
  const c2 = choose(AREA, 'SO-3', F({ area2: 800, lethal: true, pLoss: 9 }), F({ area2: 200, lethal: true, pLoss: 1 }), 'L');
  assert.deepEqual([c2.side, c2.reason], ['R', 'SO-3']);
});

test('X-5 真實引擎（A1、A2 各 150 局隨機合法刀）：每次 OBSESSION 前提成立；兩側不致死且執念分得出高下時一定是 OBSESSION', () => {
  for (const mode of ['A1', 'A2'] as const) {
    let obs = 0, survival = 0, chain = 0;
    for (let seed = 400001; seed <= 400150; seed++) {
      const cfg = expConfig(mode, seed);
      let s = newBattle(cfg, content).state;
      const run = playRandom(cfg);
      for (const a of run.actions) {
        const part = partitionOf(s, a.i, a.j);
        const out = act(s, a, content);
        const ch = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
        if (ch && ch.basis) {
          const { L, R } = ch.basis;
          const pick = obsessionPick(mode === 'A1' ? 'OBS_HEART' : 'OBS_AREA', { L: L.hearts ?? -1, R: R.hearts ?? -1 }, { L: L.area2, R: R.area2 });
          if (mode === 'A1') {
            assert.equal(L.hearts, part.L.filter((o) => o.key === 'heart').length, 'L 心臟數＝分區 L 的心臟');
            assert.equal(R.hearts, part.R.filter((o) => o.key === 'heart').length, 'R 心臟數＝分區 R 的心臟');
          }
          if (ch.reason === 'OBSESSION') { obs++; assert.ok(!L.lethal && !R.lethal); assert.equal(ch.side, pick); }
          else if (!L.lethal && !R.lethal) { assert.equal(pick, null, `seed ${seed}：執念分得出高下卻是 ${ch.reason}`); chain++; }
          else survival++;
          const pv = obsessionPreview(s, part)!;
          assert.equal(pv.side, pick, '預覽的執念側＝規則');
        }
        s = out.state;
      }
    }
    console.log(`X-5 ${mode}：OBSESSION ${obs}、求生/兩側致死 ${survival}、照原版評分 ${chain}`);
    assert.ok(obs > 50 && chain > 0 && survival > 0, `${mode} 樣本不足`);
  }
});

test('X-5 legalLines 與執念無關（A 只換選邊函式，盤面與合法線同 Baseline）', () => {
  for (let seed = 400001; seed <= 400020; seed++) {
    const b = newBattle(expConfig('BASELINE', seed), content).state, a = newBattle(expConfig('A1', seed), content).state;
    assert.deepEqual(legalLines(a), legalLines(b));
    assert.deepEqual(a.board, b.board);
  }
});
