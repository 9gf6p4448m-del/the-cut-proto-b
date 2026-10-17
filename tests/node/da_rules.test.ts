// duel v0.2 美術合併（the-cut docs/fusion/DUEL_ART_V02.md，DL-083）DA-01／DA-02 的 Node 部分。作者測試。
// DA-01：規則與數值不變——cut-battle 原有測試（cb_rules／cb_build、rtcut_rules／rtcut2_rules）不改一字照跑全過；這裡另驗 duel2 設定下只有獸身多邊形不同。
// DA-02：已確認邊界合法、與候選一致；200 種子的初始器官與再生位置都整個圓在邊界內且對方碰得到（獨立檢查）；起刀用新邊界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BODY, COOLDOWN_STEPS, LOCK_STEPS, R, REGEN_STEPS, bodyOf, inside, resolveStrike, step } from '../../src/rtcut/rules.ts';
import type { GameState, Line, Side, V } from '../../src/rtcut/rules.ts';
import { validateBoundary, boundaryToWorld } from '../../src/art/boundary.ts';
import { BEAST_BOUNDARY } from '../../src/cutbattle/beast_boundary.ts';
import { ASSET_H, ASSET_W, BODY2, RECTS } from '../../src/cutbattle/duel2_board.ts';
import { CB, blueOrgans, matchFor, modeFor, newCampaign, placeCheck } from '../../src/cutbattle/campaign.ts';
import { ROOT } from './helpers.ts';

const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
const ring = (p: V, poly: V[]) => { for (let i = 0; i < 36; i++) { const a = (i * Math.PI) / 18; if (!inside([p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R], poly)) return false; } return true; };
/** 獨立檢查「對方碰得到」：對方多邊形內 10px 格點中有一點到圓心 ≤420＋R−1，並實際用規則畫刀確認切得到。 */
function gridReach(p: V, attacker: Side, s0: GameState): boolean {
  const poly = BODY2[attacker], xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
  for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x += 10) for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y += 10) {
    if (!inside([x, y], poly)) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d > 420 + R - 1) continue;
    const len = Math.max(120, Math.min(420, d + 1)), u: V = d ? [(p[0] - x) / d, (p[1] - y) / d] : [1, 0];
    const probe: GameState = { ...s0, organs: [{ id: 'X', side: other(attacker), kind: 'eye', p }], alive: [true], lockUntil: [0], readyAt: [0], cdUntil: { blue: 0, red: 0 }, step: 10 };
    const r = resolveStrike(probe, attacker, { a: [x, y], b: [x + u[0] * len, y + u[1] * len] });
    if (r.ok && r.severed === 0) return true;
  }
  return false;
}

test('DA-02 已確認邊界：通過 validateBoundary、58 頂點、與 art-kit-v2 候選逐值相同；public 的 JSON 與程式內的資料相同', () => {
  assert.deepEqual(validateBoundary(BEAST_BOUNDARY), []);
  assert.equal(BEAST_BOUNDARY.vertices.length, 58);
  assert.equal(BEAST_BOUNDARY.kind, 'confirmed');
  const cand = JSON.parse(readFileSync(join(ROOT, 'public-artkit/assets/final/beast_boundary.candidate.json'), 'utf8'));
  assert.deepEqual(BEAST_BOUNDARY.vertices, cand.vertices);
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, 'public-duel2/assets/beast_boundary.json'), 'utf8')), BEAST_BOUNDARY);
  // 世界座標：藍＝boundaryToWorld(rect.blue)，紅＝同一份旋轉 180°（對紅 rect 中心點對稱）
  assert.deepEqual(BODY2.blue, boundaryToWorld(BEAST_BOUNDARY.vertices, ASSET_W, ASSET_H, RECTS.blue));
  const cx = RECTS.red.x + RECTS.red.w / 2, cy = RECTS.red.y + RECTS.red.h / 2;
  const unrot = boundaryToWorld(BEAST_BOUNDARY.vertices, ASSET_W, ASSET_H, RECTS.red);
  BODY2.red.forEach((p, i) => { assert.ok(Math.abs(p[0] - (2 * cx - unrot[i][0])) < 1e-9 && Math.abs(p[1] - (2 * cy - unrot[i][1])) < 1e-9); });
});
test('DA-02 起刀用新邊界：舊四邊形內但龍身外的點不能起刀；龍身內可以', () => {
  const c = newCampaign(3, BODY2), s = { ...matchFor(c), aiNextFire: 10 ** 9 };
  assert.deepEqual(bodyOf(s.mode, 'blue'), BODY2.blue);
  // 找一個「在舊藍身四邊形內、但在龍身多邊形外」的點
  let outside: V | null = null, insideP: V | null = null;
  for (let y = 450; y < 970 && !(outside && insideP); y += 7) for (let x = 40; x < 660; x += 7) {
    if (!outside && inside([x, y], BODY.blue) && !inside([x, y], BODY2.blue)) outside = [x, y];
    if (!insideP && inside([x, y], BODY2.blue)) insideP = [x, y];
  }
  const l = (a: V): Line => ({ a, b: [a[0], a[1] - 300] });
  assert.equal(resolveStrike(s, 'blue', l(outside!)).reject, 'start');
  assert.notEqual(resolveStrike(s, 'blue', l(insideP!)).reject, 'start');
  // duel v0.1（沒給 body）仍用舊四邊形：同一點可以起刀
  const s1 = { ...matchFor(newCampaign(3)), aiNextFire: 10 ** 9 };
  assert.equal(s1.mode.body, undefined);
  assert.notEqual(resolveStrike(s1, 'blue', l(outside!)).reject, 'start');
});
test('DA-02 200 種子：初始器官（3 場）與再生位置都整個圓在龍身內、對方碰得到、不重疊（獨立檢查）', () => {
  let spawns = 0, organs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = newCampaign(seed, BODY2);
    for (let stage = 0; stage < 3; stage++) {
      const s = matchFor({ ...c, stage });
      s.organs.forEach((o, i) => {
        organs++;
        assert.ok(ring(o.p, BODY2[o.side]), `seed ${seed} stage ${stage} ${o.id} ${o.p} 圓超出龍身`);
        assert.ok(gridReach(o.p, other(o.side), s), `seed ${seed} ${o.id} 對方碰不到`);   // 審查 LOW-7：200 種子全驗
        s.organs.forEach((q, j) => { if (j > i) assert.ok(Math.hypot(o.p[0] - q.p[0], o.p[1] - q.p[1]) >= 2 * R, `seed ${seed} 重疊`); });
      });
    }
    let s: GameState = { ...matchFor(c), aiNextFire: 10 ** 9 };
    s = { ...s, alive: s.alive.map((a, i) => i % 3 !== 0), severedQ: { blue: ['heart', 'poison', 'claw'], red: ['claw', 'eye', 'bone'] } };   // 雙方都再生
    while (s.step < 3 * REGEN_STEPS + 1) {
      const out = step(s, {});
      for (const e of out.events) if (e.t === 'spawn') {
        spawns++; const o = out.state.organs[e.i];
        assert.ok(ring(o.p, BODY2[o.side]), `seed ${seed} 再生 ${o.p} 圓超出龍身`);
        assert.ok(gridReach(o.p, other(o.side), out.state), `seed ${seed} ${o.side} 再生 ${o.p} 對方碰不到`);
      }
      s = out.state;
    }
  }
  assert.ok(organs >= 200 * 3 * 18 && spawns >= 800, `${organs} ${spawns}`);
});
test('DA-01 duel2 設定下只有獸身多邊形不同：局長、冷卻、鎖定、再生上限、AI d、器官組成都與 v0.1 相同', () => {
  const c1 = newCampaign(5), c2 = newCampaign(5, BODY2);
  for (let stage = 0; stage < 3; stage++) {
    const m1 = modeFor({ ...c1, stage }, 9, 9), m2 = modeFor({ ...c2, stage }, 9, 9);
    const { body, ...rest } = m2;
    assert.deepEqual(rest, m1);
    assert.deepEqual(body, BODY2);
  }
  assert.deepEqual(blueOrgans(c2).map((o) => o.kind).sort(), [...CB.BASE_KINDS].sort());
  const s = matchFor(c2);
  assert.deepEqual([s.mode.cutSteps, COOLDOWN_STEPS, LOCK_STEPS], [1800, 90, 300]);
  // 擺放：龍身外（例如舊四邊形內的空隙）判 outside；龍身內合法點可放
  const pc = { ...c2, phase: 'place' as const, picked: 'claw' as const };
  let gap: V | null = null, ok: V | null = null;
  for (let y = 450; y < 970 && !(gap && ok); y += 5) for (let x = 40; x < 660; x += 5) {
    if (!gap && inside([x, y], BODY.blue) && !inside([x, y], BODY2.blue)) gap = [x, y];
    if (!ok && !placeCheck(pc, [x, y])) ok = [x, y];
  }
  assert.equal(placeCheck(pc, gap!), 'outside');
  assert.ok(ok && ring(ok, BODY2.blue));
});
test('DA-01 AI 錨點與交疊帶：沒給 body 時仍是原版常數（rt-cut／rt-cut2／duel 不變）；duel2 由龍身邊界推出、錨點都在自己龍身內（審查 HIGH-2）', async () => {
  const { AI_ANCHORS, anchorsOf, bandOf } = await import('../../src/rtcut/rules.ts');
  assert.deepEqual([anchorsOf({}, 'blue'), anchorsOf({}, 'red'), bandOf({})], [AI_ANCHORS.blue, AI_ANCHORS.red, [430, 570]]);
  const m = { body: BODY2 };
  for (const side of ['blue', 'red'] as Side[]) {
    const a = anchorsOf(m, side);
    assert.equal(a.length, 7);
    for (const p of a) assert.ok(inside(p, BODY2[side]), `${side} ${p}`);
    // 舊錨點在龍身內的只有少數：這就是要改的原因
    assert.ok(AI_ANCHORS[side].filter((p) => inside(p, BODY2[side])).length <= 3);
  }
  const [b0, b1] = bandOf(m);
  assert.ok(Math.abs(b0 - Math.min(...BODY2.blue.map((p) => p[1]))) < 1e-9 && Math.abs(b1 - Math.max(...BODY2.red.map((p) => p[1]))) < 1e-9);
});
