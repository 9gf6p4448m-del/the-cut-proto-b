// 規則行為測試（作者測試；研究引擎快照的既有行為，原型不改規則）：幾何切割、穿刺、敵人選側、SO-3、PH-M 結算順序。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalLines, newBattle, setProtoBOrganPool } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { runBattle } from '../../engine/src/replay.ts';
import { GRD, RND } from '../../engine/src/bots.ts';
import type { Ev } from '../../engine/src/types.ts';
import { CFG } from './helpers.ts';

const content = loadContent();
type Choice = Extract<Ev, { t: 'CHOICE' }>;

function battles(mode: 3 | 6, seeds: number[]): Ev[][] {
  setProtoBOrganPool(mode);
  try {
    const out: Ev[][] = [];
    for (const seed of seeds) for (const p of [GRD, RND]) out.push(runBattle({ ...CFG, seed }, p, content).events);
    return out;
  } finally { setProtoBOrganPool(6); }
}
const SEEDS = Array.from({ length: 40 }, (_, k) => 2001 + 2 * k);

for (const mode of [6, 3] as const) {
  test(`幾何與穿刺（${mode} 器官）：分區與引擎的有向線判定一致，穿刺器官離刀線 < r`, () => {
    setProtoBOrganPool(mode);
    try {
      let checked = 0;
      for (const seed of SEEDS.slice(0, 15)) {
        const s = newBattle({ ...CFG, seed }, content).state;
        const b = s.board!;
        for (const p of legalLines(s)) {
          const A = b.anchors[p.i], B = b.anchors[p.j];
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          const cr = (o: { x: number; y: number }) => (B.x - A.x) * (o.y - A.y) - (B.y - A.y) * (o.x - A.x);
          for (const o of p.pierced) assert.ok(Math.abs(cr(o)) / len < s.config.r, `穿刺器官離線太遠 seed ${seed}`);
          for (const o of p.L) { assert.ok(cr(o) > 0, 'L 側必須在有向線左邊'); assert.ok(Math.abs(cr(o)) / len >= s.config.r - 1e-9); }
          for (const o of p.R) { assert.ok(cr(o) < 0, 'R 側必須在有向線右邊'); assert.ok(Math.abs(cr(o)) / len >= s.config.r - 1e-9); }
          assert.equal(p.L.length + p.R.length + p.pierced.length, b.organs.length, '每顆器官恰好歸一類');
          assert.ok(10 * p.area2.L >= p.area2.L + p.area2.R && 10 * p.area2.R >= p.area2.L + p.area2.R, '合法線兩側面積都 ≥ 10%');
          checked++;
        }
      }
      assert.ok(checked > 500, `檢查的合法線太少：${checked}`);
    } finally { setProtoBOrganPool(6); }
  });

  test(`敵人選側與 SO-3（${mode} 器官）：求生優先、兩側致死選玩家損失小者、平常依評分`, () => {
    let survival = 0, so3 = 0, pref = 0;
    for (const evs of battles(mode, SEEDS)) for (const e of evs) {
      if (e.t !== 'CHOICE' || !e.basis) continue;
      const c = e as Choice, b = c.basis!;
      const chosen = b[c.side], other = b[c.side === 'L' ? 'R' : 'L'];
      if (b.L.lethal !== b.R.lethal) { assert.equal(c.reason, 'SURVIVAL'); assert.equal(chosen.lethal, false, '求生時必須拿不致死的一側'); survival++; }
      else if (b.L.lethal && b.R.lethal && b.L.pLoss !== b.R.pLoss) { assert.equal(c.reason, 'SO-3'); assert.ok(chosen.pLoss < other.pLoss, 'SO-3 要選玩家損失較小的一側'); so3++; }
      else if (c.reason === 'PREF') { assert.ok(chosen.U > other.U, '依偏好時選的一側評分必須較高'); pref++; }
    }
    assert.ok(survival > 0 && pref > 0, `樣本不足：survival ${survival}、pref ${pref}、so3 ${so3}`);
  });

  test(`PH-M 結算順序（${mode} 器官）：刀中效果 → 選側 → 盾與治療 → 傷害`, () => {
    let rounds = 0;
    for (const evs of battles(mode, SEEDS.slice(0, 20))) {
      let k = 0;
      while ((k = evs.findIndex((e, i) => i >= k && e.t === 'CUT')) >= 0) {
        const end = evs.findIndex((e, i) => i > k && (e.t === 'CUT' || e.t === 'RS'));
        const seg = evs.slice(k, end < 0 ? evs.length : end);
        const inc = seg.findIndex((e) => e.t === 'STEP' && e.name === 'INCISION');
        const ch = seg.findIndex((e) => e.t === 'CHOICE');
        const harv = seg.findIndex((e) => e.t === 'STEP' && e.name === 'HARVEST');
        if (ch >= 0) {
          if (inc >= 0) assert.ok(inc < ch, '刀中效果必須在選側前');
          assert.ok(harv > ch, '收割步驟必須在選側後');
          const after = seg.slice(harv);
          const firstDmg = after.findIndex((e) => e.t === 'DMG');
          const lastGain = after.reduce((m, e, i) => (e.t === 'SHIELD' || e.t === 'HEAL' ? i : m), -1);
          if (firstDmg >= 0 && lastGain >= 0) assert.ok(lastGain < firstDmg, 'PH-M＋HS-1：盾與治療在傷害之前');
          rounds++;
        }
        k = k + 1;
      }
    }
    assert.ok(rounds > 100, `回合樣本太少：${rounds}`);
  });
}
