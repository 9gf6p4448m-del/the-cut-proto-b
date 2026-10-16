// Codex F-2 回歸測試：實驗 B 撕裂必須在「本刀自己的刀中效果完整結算之後」另起一步（B 規格 §2.4）。
// 舊碼（781507a）把撕裂複本併入同一個 INCISION 步驟：撕裂骨盾先入帳、吸收本刀毒囊 → seed=1 案例 P34（應 P32）。
// 盤面一律用真實引擎產生（seed 與錨點對），不手捏器官。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, legalLines, newBattle, partitionOf } from '../../engine/src/engine.ts';
import type { Action, BattleState, Partition } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { keepWoundCheck, woundCrossedBy } from '../../engine/src/experiment.ts';
import type { Ev } from '../../engine/src/types.ts';
import { expConfig } from '../browser/exp_entry.ts';

const content = loadContent();
const A = (s: BattleState, p: { i: number; j: number }, keep?: boolean): Action => ({ round: s.round, actor: 'P', i: p.i, j: p.j, ...(keep ? { keepWound: true } : {}) });
const tearOf = (evs: Ev[]) => evs.find((e): e is Extract<Ev, { t: 'WOUND' }> => e.t === 'WOUND' && e.op === 'TEAR');

test('F-2 Codex seed=1：R1 切 [2,7] 封存骨盾、R2 切 [4,10] 切穿毒囊並撕裂 → 本刀毒先扣（P34→32），撕裂盾不吸收本刀毒', () => {
  let s = newBattle(expConfig('B', 1), content).state;
  const r1 = act(s, A(s, { i: 2, j: 7 }, true), content);
  s = r1.state;
  assert.deepEqual(s.wound!.sealed.map((o) => o.key), ['shield']);
  assert.deepEqual(s.hp, { P: 34, E: 14 });
  const p2 = partitionOf(s, 4, 10);
  assert.deepEqual(p2.pierced.map((o) => o.key), ['poison']);
  const out = act(s, A(s, p2), content);
  const ev = out.events;
  // 行為：本刀毒囊對自己的 2 傷沒有被撕裂盾吸收
  const selfPoison = ev.find((e): e is Extract<Ev, { t: 'DMG' }> => e.t === 'DMG' && e.kind === 'INC_POISON_SELF' && e.organ === p2.pierced[0].id)!;
  assert.deepEqual({ abs: selfPoison.abs, loss: selfPoison.loss }, { abs: 0, loss: 2 }, '本刀毒不得被撕裂盾吸收');
  assert.equal(out.state.hp.P, 32, 'R2 結束玩家 HP 依規格為 32（舊碼 34）');
  // 時序：INCISION（含死亡判定）→ TEAR（撕裂盾）→ CHOICE
  const iInc = ev.findIndex((e) => e.t === 'STEP' && e.name === 'INCISION');
  const iDc = ev.findIndex((e, k) => k > iInc && e.t === 'DC');
  const iTear = ev.findIndex((e) => e.t === 'STEP' && (e.name as string) === 'TEAR');
  const iChoice = ev.findIndex((e) => e.t === 'CHOICE');
  assert.ok(iInc >= 0 && iInc < iDc && iDc < iTear && iTear < iChoice, `步驟順序 ${iInc} ${iDc} ${iTear} ${iChoice}`);
  const copies = tearOf(ev)!.copies!;
  for (const id of copies) {
    const k = ev.findIndex((e) => e.t === 'SHIELD' && e.organ === id);
    assert.ok(k > iTear && k < iChoice, `撕裂盾 ${id} 在 TEAR 步驟內入帳`);
  }
});

test('F-2 反方向：本刀骨盾吸收撕裂毒（盾在同一回合內延續；撕裂步驟沿用同一份刀中結算）', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const s1 = newBattle(expConfig('B', seed), content).state;
    for (const p of legalLines(s1)) {
      if (p.pierced.length !== 1 || p.pierced[0].key !== 'poison' || !keepWoundCheck(s1, p).ok) continue;
      const k = act(s1, A(s1, p, true), content);
      if (k.state.result) continue;
      const s2 = k.state;
      const q = legalLines(s2).find((x) => woundCrossedBy(s2, x.i, x.j) && x.pierced.length === 1 && x.pierced[0].key === 'shield');
      if (!q) continue;
      const out = act(s2, A(s2, q), content);
      const copies = new Set(tearOf(out.events)!.copies!);
      const own = out.events.find((e) => e.t === 'SHIELD' && e.organ === q.pierced[0].id);
      assert.ok(own, '本刀骨盾入帳');
      const tearSelf = out.events.filter((e): e is Extract<Ev, { t: 'DMG' }> => e.t === 'DMG' && e.kind === 'INC_POISON_SELF' && copies.has(e.organ));
      assert.equal(tearSelf.length, 2, '撕裂毒 ×2 對自己');
      assert.equal(tearSelf.reduce((a, d) => a + d.abs, 0), 3, `seed ${seed}：本刀 3 盾吸收撕裂毒 2＋2 中的 3`);
      assert.equal(tearSelf.reduce((a, d) => a + d.loss, 0), 1, '撕裂毒對自己只實扣 1');
      return;
    }
  }
  assert.fail('找不到「封存毒囊、下回合撕裂且只切穿骨盾」情境');
});

test('F-2 澄清（主 session 記錄）：本刀刀中已讓某方死亡 → 撕裂不發動、直接結束；結果與「沒有傷口」相同', () => {
  let found = 0;
  for (let seed = 1; seed <= 3000 && found < 3; seed++) {
    let s = newBattle(expConfig('B', seed), content).state;
    for (let guard = 0; guard < 12 && !s.result; guard++) {
      const lines = legalLines(s);
      if (s.wound) {
        const kill = lines.find((x) => woundCrossedBy(s, x.i, x.j) && (() => {
          const ref = act({ ...s, wound: null }, A(s, x), content);
          const iInc = ref.events.findIndex((e) => e.t === 'STEP' && e.name === 'INCISION');
          return iInc >= 0 && ref.events.some((e, k) => k > iInc && e.t === 'DC' && (e.pDead || e.eDead) && !ref.events.slice(0, k).some((y) => y.t === 'CHOICE'));
        })());
        if (kill) {
          const out = act(s, A(s, kill), content);
          const ref = act({ ...s, wound: null }, A(s, kill), content);
          const ids = new Set(tearOf(out.events)!.copies!);
          assert.equal(out.events.some((e) => e.t === 'STEP' && (e.name as string) === 'TEAR'), false, '沒有 TEAR 步驟');
          assert.equal(out.events.some((e) => (e.t === 'PIERCE' && ids.has(e.id)) || ((e.t === 'DMG' || e.t === 'SHIELD' || e.t === 'HEAL') && ids.has(e.organ)) || (e.t === 'INC' && ids.has(e.id))), false, '複本沒有任何事件');
          assert.deepEqual(out.state.hp, ref.state.hp);
          assert.equal(out.state.result, ref.state.result);
          assert.equal(out.state.wound, null);
          found++;
          break;
        }
      }
      const p: Partition = lines.find((x) => keepWoundCheck(s, x).ok) ?? lines[0];
      s = act(s, A(s, p, keepWoundCheck(s, p).ok), content).state;
    }
  }
  assert.ok(found >= 1, `找到 ${found} 個情境`);
});
