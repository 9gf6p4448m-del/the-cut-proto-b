// 凍結驗收 X-6：實驗 B 留下傷口（EXPERIMENT_B_RULES v1 §2、§4）。作者測試。
// 盤面一律用真實引擎的 seed 搜尋（固定範圍、決定性），不手捏器官位置；10,000 局隨機模擬檢查上限與不變量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, InvalidAction, legalLines, newBattle } from '../../engine/src/engine.ts';
import type { Action, BattleState, Partition } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { chordsCross, keepWoundCheck, tearPreview, woundCrossedBy } from '../../engine/src/experiment.ts';
import { canonical } from '../../engine/src/canon.ts';
import { cross } from '../../engine/src/geom.ts';
import type { Ev } from '../../engine/src/types.ts';
import { expConfig } from '../browser/exp_entry.ts';
import { Cursor, streamState } from '../../engine/src/prng.ts';

const content = loadContent();
const bStart = (seed: number, extra: object = {}): BattleState => newBattle({ ...expConfig('B', seed), ...extra }, content).state;
const A = (s: BattleState, p: Partition, keep?: boolean): Action => ({ round: s.round, actor: 'P', i: p.i, j: p.j, ...(keep === undefined ? {} : { keepWound: keep }) });
const wev = (evs: Ev[]) => evs.filter((e): e is Extract<Ev, { t: 'WOUND' }> => e.t === 'WOUND');

/** 搜尋：第 1 回合切穿恰好一顆心臟、留傷口後戰鬥未結束；第 2 回合同時有「穿過傷口」與「不穿過」的線，且兩類各有切穿 1～2 顆的線。 */
function scenario() {
  for (let seed = 500001; seed <= 502000; seed++) {
    const s1 = bStart(seed);
    for (const p of legalLines(s1)) {
      if (p.pierced.length !== 1 || p.pierced[0].key !== 'heart') continue;
      const k = act(s1, A(s1, p, true), content);
      if (k.state.result) continue;
      const s2 = k.state, lines = legalLines(s2);
      const tear = lines.filter((q) => woundCrossedBy(s2, q.i, q.j)), heal = lines.filter((q) => !woundCrossedBy(s2, q.i, q.j));
      const tear12 = tear.find((q) => q.pierced.length >= 1 && q.pierced.length <= 2), heal12 = heal.find((q) => q.pierced.length >= 1 && q.pierced.length <= 2);
      if (tear.length && heal.length && tear12 && heal12) return { seed, s1, p1: p, keep: k, s2, tear: tear[0], heal: heal[0], tear12, heal12 };
    }
  }
  throw new Error('找不到情境 seed');
}
const S = scenario();
const heartId = S.p1.pierced[0].id;

test('X-6 可勾條件：切穿 0／1／2／3 顆 → 否／可／可／否；不可勾時 act 拋 InvalidAction', () => {
  const found = new Map<number, { s: BattleState; p: Partition }>();
  for (let seed = 500001; seed <= 503000 && found.size < 4; seed++) {
    const s = bStart(seed);
    for (const p of legalLines(s)) if (p.pierced.length <= 3 && !found.has(p.pierced.length)) found.set(p.pierced.length, { s, p });
  }
  assert.equal(found.size, 4, `0～3 顆都要找到：${[...found.keys()]}`);
  for (const [k, { s, p }] of [...found].sort((x, y) => x[0] - y[0])) {
    const c = keepWoundCheck(s, p);
    assert.equal(c.ok, k === 1 || k === 2, `${k} 顆`);
    if (k === 0) assert.equal(c.reason, 'PIERCED_NONE');
    if (k === 3) assert.equal(c.reason, 'PIERCED_TOO_MANY');
    if (c.ok) {
      const out = act(s, A(s, p, true), content);
      if (!out.state.result) assert.equal(out.state.wound!.sealed.length, k);
      assert.deepEqual(wev(out.events).map((e) => [e.op, e.organs.length]), [['KEEP', k]]);
    } else assert.throws(() => act(s, A(s, p, true), content), InvalidAction);
  }
});

test('X-6 封存不發動：留傷口時被切穿器官的刀中效果不發生、不屬於任何一側；不勾則照常發動', () => {
  const s = S.s1, p = S.p1;
  const kept = S.keep.events, plain = act(s, A(s, p), content).events;
  const touches = (evs: Ev[]) => evs.filter((e) => (e.t === 'PIERCE' && e.id === heartId) || (e.t === 'DMG' && e.organ === heartId) || (e.t === 'INC' && e.id === heartId));
  assert.ok(touches(plain).some((e) => e.t === 'DMG' && e.kind === 'INC_DIRECT' && e.raw === 3), '不勾：心臟刀中 3 傷照常發動');
  assert.deepEqual(touches(kept), [], '勾：封存的心臟沒有任何刀中事件');
  assert.deepEqual(wev(kept), [{ t: 'WOUND', op: 'KEEP', organs: [heartId] }]);
  const w = S.s2.wound!;
  assert.deepEqual(w.sealed.map((o) => o.id), [heartId]);
  assert.equal(w.round, 1);
  const ch = kept.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
  if (ch) for (const side of ['L', 'R'] as const) assert.equal((side === 'L' ? p.L : p.R).some((o) => o.id === heartId), false);
  assert.deepEqual(tearPreview(S.s2), { keys: ['heart'], times: 2 });
});

test('X-6 撕裂 ×2：穿過傷口 → 封存的刀中效果各發動 2 次（複本新 id），在選邊之前；傷口消失', () => {
  const s = S.s2, out = act(s, A(s, S.tear), content);
  const w = wev(out.events);
  assert.equal(w.length, 1);
  assert.equal(w[0].op, 'TEAR');
  assert.deepEqual(w[0].organs, [heartId]);
  assert.deepEqual(w[0].copies, [s.nextId, s.nextId + 1], '兩份複本、新 id');
  const copyDmg = out.events.filter((e) => e.t === 'DMG' && w[0].copies!.includes(e.organ));
  assert.equal(copyDmg.length, 2, '心臟刀中效果發動 2 次');
  for (const d of copyDmg) assert.deepEqual(d.t === 'DMG' && [d.kind, d.raw, d.dst], ['INC_DIRECT', 3, 'E']);
  const iChoice = out.events.findIndex((e) => e.t === 'CHOICE'), iLast = Math.max(...copyDmg.map((d) => out.events.indexOf(d)));
  if (iChoice >= 0) assert.ok(iLast < iChoice, '撕裂效果在屠夫選邊之前');
  assert.equal(out.state.wound ?? null, null);
  if (!out.state.result) assert.equal('wound' in out.state, true);
});

test('X-6 癒合作廢：沒穿過傷口 → 封存效果不發動，除了 HEAL 事件外與「沒有傷口」逐值相同；傷口消失', () => {
  const s = S.s2, out = act(s, A(s, S.heal), content);
  assert.deepEqual(wev(out.events), [{ t: 'WOUND', op: 'HEAL', organs: [heartId] }]);
  const ref = act({ ...s, wound: null }, A(s, S.heal), content);
  assert.equal(canonical(out.events.filter((e) => e.t !== 'WOUND')), canonical(ref.events));
  assert.equal(canonical(out.state), canonical(ref.state));
  assert.equal(out.state.wound ?? null, null);
});

test('X-6 撕裂回合不能留新傷口；癒合回合可以留新傷口；同時最多 1 個傷口', () => {
  const s = S.s2;
  assert.deepEqual(keepWoundCheck(s, S.tear12), { ok: false, reason: 'TEAR_ROUND' });
  assert.throws(() => act(s, A(s, S.tear12, true), content), InvalidAction);
  assert.deepEqual(keepWoundCheck(s, S.heal12), { ok: true, reason: null });
  const out = act(s, A(s, S.heal12, true), content);
  assert.deepEqual(wev(out.events).map((e) => e.op), ['HEAL', 'KEEP']);
  if (!out.state.result) {
    const w = out.state.wound!;
    assert.equal(Array.isArray(w), false, '只有一個傷口物件');
    assert.equal(w.round, 2);
    assert.deepEqual(w.sealed.map((o) => o.id), S.heal12.pierced.map((o) => o.id).sort((a, b) => a - b), '新傷口取代舊傷口');
  }
});

test('X-6 戰鬥結束清除：最後一回合（僵持）留下的傷口直接消失、不結算', () => {
  for (let seed = 500001; seed <= 501000; seed++) {
    const s = bStart(seed, { maxRounds: 1 });
    const p = legalLines(s).find((q) => keepWoundCheck(s, q).ok);
    if (!p) continue;
    const out = act(s, A(s, p, true), content);
    if (out.state.result !== 'STALL') continue;
    assert.equal(out.state.wound, null);
    assert.equal(wev(out.events).length, 1);
    return;
  }
  assert.fail('找不到僵持情境');
});

test('X-6 相交判定（純整數，周長位置）：交錯＝相交；共用端點、重合、不交錯＝不相交', () => {
  const e = (pos: number, x = pos, y = 0) => ({ x, y, pos });
  const w = { a: e(100), b: e(500) };
  assert.equal(chordsCross(w, e(300), e(700)), true, '交錯');
  assert.equal(chordsCross(w, e(700), e(300)), true, '交錯（端點順序對調）');
  assert.equal(chordsCross(w, e(50), e(300)), true, '交錯（另一端在 0 側）');
  assert.equal(chordsCross(w, e(100), e(300)), false, '共用端點');
  assert.equal(chordsCross(w, e(300), e(500)), false, '共用端點');
  assert.equal(chordsCross(w, e(500), e(100)), false, '重合');
  assert.equal(chordsCross(w, e(200), e(300)), false, '同在傷口一側');
  assert.equal(chordsCross(w, e(600), e(50)), false, '同在傷口另一側（跨越 0）');
  assert.equal(chordsCross(w, e(300, 100, 0), e(700)), false, '座標相同（不同 pos）也算共用端點');
});

test('X-6 相交判定與真實幾何一致：周長交錯 ⇔ 兩線段嚴格相交（整數叉積；端點相距 ≤1 單位者除外並計數），跨回合錨點 2,000 對以上', () => {
  let n = 0, yes = 0, nearDiff = 0;
  for (let seed = 500001; seed <= 500060; seed++) {
    let s = bStart(seed);
    const c = new Cursor(streamState(seed, 'geo'));
    const prev: Partition[] = [];
    while (!s.result && s.round <= 4) {
      const lines = legalLines(s), b = s.board!;
      for (const w of prev) for (const q of lines) {
        const W = { a: (w as any).ea, b: (w as any).eb };
        const qa = b.anchors[q.i], qb = b.anchors[q.j];
        const pc = chordsCross(W, qa, qb);
        const P = (o: { x: number; y: number }) => [o.x, o.y] as const;
        const d1 = cross(P(W.a), P(W.b), P(qa)), d2 = cross(P(W.a), P(W.b), P(qb)), d3 = cross(P(qa), P(qb), P(W.a)), d4 = cross(P(qa), P(qb), P(W.b));
        const geo = d1 * d2 < 0 && d3 * d4 < 0;
        // 錨點座標是取整後的整數點（不一定恰在邊上）；端點相距 ≤1 單位時，線段叉積與「邊界上交錯」可能不同——規格以邊界交錯為準，這類計數回報。
        const near = [qa, qb].some((q) => [W.a, W.b].some((w) => Math.max(Math.abs(q.x - w.x), Math.abs(q.y - w.y)) <= 1));
        if (pc !== geo) { assert.ok(near, `seed ${seed} r${s.round}：非相鄰端點卻不一致`); nearDiff++; }
        n++; if (pc) yes++;
      }
      prev.length = 0;
      for (const q of lines) prev.push({ ...q, ea: s.board!.anchors[q.i], eb: s.board!.anchors[q.j] } as any);
      const p = lines[c.below(lines.length)];
      s = act(s, A(s, p), content).state;
    }
  }
  console.log(`X-6 幾何對照：${n} 對，其中相交 ${yes}；端點相距 ≤1 單位而判定不同 ${nearDiff} 對（依規格以邊界交錯為準）`);
  assert.ok(n >= 2000 && yes > 100 && n - yes > 100, `樣本不足 ${n}/${yes}`);
});

/** 每個封存器官的刀中效果在撕裂時應出現的事件數（單份）。 */
const PER_COPY: Record<string, (evs: Ev[], id: number) => boolean> = {
  heart: (evs, id) => evs.filter((e) => e.t === 'DMG' && e.organ === id && e.kind === 'INC_DIRECT').length === 1,
  shield: (evs, id) => evs.filter((e) => e.t === 'SHIELD' && e.organ === id && e.n === 3).length === 1,
  poison: (evs, id) => evs.filter((e) => e.t === 'DMG' && e.organ === id && e.raw === 2).length === 2,
  fission: (evs, id) => evs.filter((e) => e.t === 'INC' && e.id === id && e.effect === 'SPAWN_CORES').length === 1,
  regen: (evs, id) => evs.filter((e) => e.t === 'INC' && e.id === id && e.effect === 'SCHEDULE_SEEDLING').length === 1,
  mirror: (evs, id) => evs.filter((e) => e.t === 'INC' && e.id === id && e.effect === 'DESTROY').length === 1,
  // 小再生腺沒有刀中效果：複本只有 PIERCE，不得有任何效果事件
  seedling: (evs, id) => evs.filter((e) => (e.t === 'DMG' || e.t === 'SHIELD' || e.t === 'HEAL') && e.organ === id).length === 0 && !evs.some((e) => e.t === 'INC' && e.id === id),
};

test('X-6 10,000 局隨機模擬（隨機合法刀＋可勾時 1/2 留傷口）：CAP_EXCEEDED／INVALID 次數與不變量', () => {
  const st = { games: 0, rounds: 0, keeps: 0, tears: 0, heals: 0, cap: 0, invalid: 0, maxEffects: 0, maxNodes: 0, over16: 0, endWithKeep: 0, tearSkipped: 0, tearByKey: {} as Record<string, number>, results: {} as Record<string, number> };
  for (let seed = 1; seed <= 10000; seed++) {
    let s = newBattle(expConfig('B', seed), content).state;
    if (s.result) { st.invalid++; continue; }
    const c = new Cursor(streamState(seed, 'x6sim'));
    while (!s.result) {
      const lines = legalLines(s);
      const p = lines[c.below(lines.length)];
      const keep = keepWoundCheck(s, p).ok && c.below(2) === 1;
      const before = s;
      const out = act(s, A(s, p, keep), content);
      s = out.state; st.rounds++;
      const w = wev(out.events);
      if (out.events.some((e) => e.t === 'CAP_EXCEEDED')) st.cap++;
      const eff = out.events.filter((e) => ['DMG', 'SHIELD', 'HEAL', 'REFL', 'INC'].includes(e.t) || (e.t === 'SPAWN' && e.src === 'CORE')).length;
      st.maxEffects = Math.max(st.maxEffects, eff);
      // 節點＝盤面器官＋撕裂複本＋刀中生成核心（引擎沒有 16 節點上限；規格 §4 提到的 16 節點只計數回報，不作斷言）
      const nodes = before.board!.organs.length + out.events.filter((e) => e.t === 'SPAWN' && e.src === 'CORE').length + (w.find((e) => e.op === 'TEAR')?.copies?.length ?? 0);
      st.maxNodes = Math.max(st.maxNodes, nodes); if (nodes > 16) st.over16++;
      // 不變量：傷口只活 1 回合、最多封存 2 顆、戰鬥結束時清除、撕裂＝每顆封存器官 2 份複本且各自完整發動
      if (before.wound) assert.equal(w[0].op === 'TEAR' || w[0].op === 'HEAL', true, `seed ${seed}：有傷口的回合必須撕裂或癒合`);
      else assert.equal(w.some((e) => e.op !== 'KEEP'), false);
      if (s.wound) { assert.equal(s.wound.round, before.round); assert.ok(s.wound.sealed.length >= 1 && s.wound.sealed.length <= 2); }
      if (s.result) { assert.equal(s.wound, null, `seed ${seed}：戰鬥結束時傷口必須清除`); if (keep) st.endWithKeep++; }
      for (const e of w) {
        if (e.op === 'KEEP') { st.keeps++; assert.equal(keep, true); }
        if (e.op === 'HEAL') st.heals++;
        if (e.op === 'TEAR') {
          st.tears++;
          assert.equal(e.copies!.length, 2 * e.organs.length);
          const tearStep = out.events.findIndex((x) => x.t === 'STEP' && x.name === 'TEAR');
          if (tearStep < 0) {
            // F-2 澄清：本刀刀中步驟已讓某方死亡（或 CAP）→ 撕裂不發動：END 已發生、複本沒有任何效果事件
            st.tearSkipped++;
            assert.ok(out.events.some((x) => x.t === 'END'), `seed ${seed}：撕裂沒發動卻沒有結束`);
            const ids = new Set(e.copies!);
            assert.equal(out.events.some((x) => ((x.t === 'DMG' || x.t === 'SHIELD' || x.t === 'HEAL') && ids.has(x.organ)) || (x.t === 'INC' && ids.has(x.id))), false, `seed ${seed}：撕裂沒發動卻有複本效果`);
          } else if (!out.events.some((x) => x.t === 'CAP_EXCEEDED')) {
            before.wound!.sealed.forEach((o, k) => {
              st.tearByKey[o.key] = (st.tearByKey[o.key] ?? 0) + 1;
              for (const id of e.copies!.slice(2 * k, 2 * k + 2)) assert.ok(PER_COPY[o.key](out.events, id), `seed ${seed}：${o.key} 複本 ${id} 的刀中效果不完整`);
            });
          }
        }
      }
    }
    st.games++;
    if (s.result === 'INVALID') st.invalid++;
    st.results[s.result!] = (st.results[s.result!] ?? 0) + 1;
  }
  console.log('X-6 模擬', JSON.stringify(st));
  assert.equal(st.games, 10000);
  assert.ok(st.keeps > 1000 && st.tears > 100 && st.heals > 100, '樣本不足');
  assert.equal(st.cap, 0, `CAP_EXCEEDED ${st.cap} 次（缺陷，不改條件）`);
  assert.equal(st.invalid, 0, `INVALID ${st.invalid} 局（缺陷，不改條件）`);
});
