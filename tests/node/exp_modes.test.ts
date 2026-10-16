// 凍結驗收 X-4（Node 部分）、X-7、X-11（引擎端欄位）＋模式設定驗證、configHash 隔離、匯入守衛、restoreState。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { ROOT } from './helpers.ts';
import { act, InvalidAction, legalLines, newBattle, partitionOf, restoreState, runConfigOf, stateHash } from '../../engine/src/engine.ts';
import type { Action, BattleConfig, BattleState, Partition } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { hashOf } from '../../engine/src/canon.ts';
import { replay, toVector } from '../../engine/src/replay.ts';
import type { RunOutput } from '../../engine/src/replay.ts';
import { expRoundFacts, keepWoundCheck, obsessionPreview, EXP_SPEC } from '../../engine/src/experiment.ts';
import type { Ev, Organ } from '../../engine/src/types.ts';
import { assertResearchLog } from '../../tools/import_guard.ts';
import { expConfig, expHashes, playRandom } from '../browser/exp_entry.ts';
import type { ExpModeKey } from '../browser/exp_entry.ts';

const content = loadContent();
const MODES: ExpModeKey[] = ['BASELINE', 'A1', 'A2', 'B'];

// ---------------------------------------------------------------- X-4

function fullRun(cfg: BattleConfig): RunOutput {
  const r = playRandom(cfg);
  const init = newBattle(cfg, content);
  let s = init.state;
  const events = [...init.events], per = [stateHash(s)];
  for (const a of r.actions) { const o = act(s, a, content); events.push(...o.events); s = o.state; per.push(stateHash(s)); }
  return { state: s, events, actions: r.actions, perRoundStateHash: per };
}

test('X-4 決定性（Node）：四模式 × 25 seeds 打到戰鬥結束，同輸入跑兩次逐回合相同；重播向量重播兩次皆通過', () => {
  const tally: Record<string, Record<string, number>> = {};
  for (const m of MODES) {
    tally[m] = {};
    let keeps = 0;
    for (let seed = 600001; seed <= 600025; seed++) {
      const cfg = expConfig(m, seed);
      const a = playRandom(cfg), b = playRandom(cfg);
      assert.deepEqual(a, b, `${m} ${seed}`);
      assert.ok(a.result && a.result !== 'INVALID', `${m} ${seed} 沒有正常結束`);
      keeps += a.keeps;
      const v = toVector(cfg, fullRun(cfg), content);
      const v2 = JSON.parse(JSON.stringify(v));
      assert.equal(replay(v2, content).ok, true, `${m} ${seed} 重播 1`);
      assert.equal(replay(v2, content).ok, true, `${m} ${seed} 重播 2`);
      tally[m][a.result] = (tally[m][a.result] ?? 0) + 1;
    }
    if (m === 'B') assert.ok(keeps > 5, `B 模式隨機留傷口次數太少：${keeps}`);
  }
  console.log('X-4 結果分布', JSON.stringify(tally));
});

test('X-4 鑑別力：重播向量竄改 keepWound 或改模式 → 重播必須失敗', () => {
  let tampered = 0;
  for (let seed = 600001; seed <= 600025 && tampered < 3; seed++) {
    const cfg = expConfig('B', seed);
    const v = toVector(cfg, fullRun(cfg), content);
    const k = v.actions.findIndex((a: Action) => a.keepWound);
    if (k < 0) continue;
    const t = JSON.parse(JSON.stringify(v)); delete t.actions[k].keepWound;
    assert.equal(replay(t, content).ok, false, '拿掉 keepWound 後仍通過');
    const u = JSON.parse(JSON.stringify(v)); u.config.exp = { mode: 'BASELINE' }; u.runConfig = runConfigOf(u.config, content);
    assert.equal(replay(u, content).ok, false, '改成 BASELINE 後仍通過');
    tampered++;
  }
  assert.equal(tampered, 3);
});

test('X-4 相容層打包版（瀏覽器同一份程式）與 Node 原生：四模式 × 20 seeds 逐回合雜湊相同', async () => {
  mkdirSync(join(ROOT, '.tmp'), { recursive: true });
  const out = join(ROOT, '.tmp', `exp_${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [join(ROOT, 'tests/browser/exp_entry.ts')], outfile: out, bundle: true, format: 'esm', platform: 'neutral', loader: { '.json': 'text' },
    alias: { 'node:crypto': join(ROOT, 'shims/crypto.ts'), 'node:fs': join(ROOT, 'shims/fs.ts') },
    define: { 'import.meta.url': '"https://proto-b.invalid/engine/src/content.ts"' }, logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(out).href);
  const seeds = Array.from({ length: 20 }, (_, k) => 600101 + k);
  const shim = mod.expHashes(MODES, seeds), native = expHashes(MODES, seeds);
  for (const m of MODES) assert.deepEqual(shim[m], native[m], m);
  assert.notDeepEqual(native.BASELINE, native.B, '不同模式的雜湊必須不同');
});

// ---------------------------------------------------------------- 模式設定與隔離（X-3 引擎端、X-11）

test('模式設定：configHash 四模式互不相同；runConfig 帶模式與規格版本；BASELINE 不帶', () => {
  const hs = MODES.map((m) => newBattle(expConfig(m, 700001), content).state.configHash);
  assert.equal(new Set(hs).size, 4);
  assert.equal('exp' in runConfigOf(expConfig('BASELINE', 1), content), false);
  assert.deepEqual(runConfigOf(expConfig('A1', 1), content).exp, { mode: 'A', spec: EXP_SPEC.A });
  assert.deepEqual(runConfigOf(expConfig('B', 1), content).exp, { mode: 'B', spec: EXP_SPEC.B });
  assert.equal(newBattle(expConfig('B', 1), content).state.wound, null);
  for (const m of ['BASELINE', 'A1', 'A2'] as const) assert.equal('wound' in newBattle(expConfig(m, 1), content).state, false, m);
});

test('模式設定驗證：執念敵人只能在 A、A 只能用執念敵人、B 只能用 BUT w10=7、未知模式或多餘欄位拒絕', () => {
  const base = expConfig('BASELINE', 1);
  const bad: [string, unknown][] = [
    ['BASELINE＋執念', { ...base, enemy: { kind: 'OBS_HEART', w10: 7 } }],
    ['A＋BUT', { ...base, exp: { mode: 'A' } }],
    ['A＋執念 w10≠7', { ...base, enemy: { kind: 'OBS_AREA', w10: 5 }, exp: { mode: 'A' } }],
    ['B＋執念', { ...base, enemy: { kind: 'OBS_HEART', w10: 7 }, exp: { mode: 'B' } }],
    ['B＋BUT w10=6', { ...base, enemy: { kind: 'BUT', w10: 6 }, exp: { mode: 'B' } }],
    ['未知模式', { ...base, exp: { mode: 'C' } }],
    ['多餘欄位', { ...base, exp: { mode: 'B', x: 1 } }],
  ];
  for (const [name, cfg] of bad) assert.throws(() => newBattle(cfg as BattleConfig, content), RangeError, name);
});

test('X-3 引擎端：B／A 打到第 3 回合後新開 BASELINE，同 seed 狀態雜湊＝全新 BASELINE（引擎沒有跨局殘留）', () => {
  const fresh = stateHash(newBattle(expConfig('BASELINE', 700002), content).state);
  for (const m of ['A1', 'B'] as const) {
    playRandom(expConfig(m, 700002));
    assert.equal(stateHash(newBattle(expConfig('BASELINE', 700002), content).state), fresh, m);
  }
});

test('restoreState：B 狀態（含傷口）JSON 往返可恢復；BASELINE 可信設定明寫 exp=BASELINE 也可恢復', () => {
  for (let seed = 700010; seed < 700200; seed++) {
    const cfg = expConfig('B', seed);
    let s = newBattle(cfg, content).state;
    const p = legalLines(s).find((q) => keepWoundCheck(s, q).ok);
    if (!p) continue;
    s = act(s, { round: 1, actor: 'P', i: p.i, j: p.j, keepWound: true }, content).state;
    if (!s.wound) continue;
    const r = restoreState(JSON.stringify(s), cfg, content);
    assert.equal(stateHash(r), stateHash(s));
    break;
  }
  const b = newBattle(expConfig('BASELINE', 700003), content).state;
  const r2 = restoreState(JSON.stringify(b), { ...expConfig('BASELINE', 700003), exp: { mode: 'BASELINE' } }, content);
  assert.equal(stateHash(r2), stateHash(b));
});

test('keepWound 指令驗證：非布林、或非實驗 B 卻為 true → InvalidAction；BASELINE 帶 false 不影響結果', () => {
  const s = newBattle(expConfig('BASELINE', 700004), content).state, p = legalLines(s)[0];
  const a: Action = { round: 1, actor: 'P', i: p.i, j: p.j };
  assert.throws(() => act(s, { ...a, keepWound: true }, content), InvalidAction);
  assert.throws(() => act(s, { ...a, keepWound: 1 as unknown as boolean }, content), InvalidAction);
  const x = act(s, a, content), y = act(s, { ...a, keepWound: false }, content);
  assert.equal(hashOf(x.events), hashOf(y.events));
  assert.equal(stateHash(x.state), stateHash(y.state));
  const sb = newBattle(expConfig('B', 700004), content).state;
  assert.throws(() => act(sb, { round: 1, actor: 'P', i: p.i, j: p.j, keepWound: 'yes' as unknown as boolean }, content), InvalidAction);
});

// ---------------------------------------------------------------- X-7

const withBoard = (s: BattleState, organs: Organ[], hp?: { P: number; E: number }): BattleState => ({ ...s, ...(hp ? { hp } : {}), board: { ...s.board!, organs } });
/** 沿切線放器官（距線 ≤1 單位，必定被切穿）。 */
function onLine(s: BattleState, p: Partition, keys: Organ['key'][]): Organ[] {
  const A = s.board!.anchors[p.i], B = s.board!.anchors[p.j], n = keys.length + 1;
  return keys.map((key, k) => ({ id: s.board!.organs[k]?.id ?? 900 + k, key, x: A.x + Math.round(((B.x - A.x) * (k + 1)) / n), y: A.y + Math.round(((B.y - A.y) * (k + 1)) / n) }));
}
const first = (seed: number, m: ExpModeKey) => newBattle(expConfig(m, seed), content).state;
const sansWound = (evs: Ev[]) => evs.filter((e) => e.t !== 'WOUND');

test('X-7 一側 0 器官：四模式都正常結算；B（不留傷口）事件與 BASELINE 逐值相同；A 的執念預覽與結果一致', () => {
  let hit = 0;
  for (let seed = 700100; seed < 700400 && hit < 5; seed++) {
    const s0 = first(seed, 'BASELINE');
    const p = legalLines(s0).find((q) => (q.L.length === 0) !== (q.R.length === 0));
    if (!p) continue;
    const ref = act(s0, { round: 1, actor: 'P', i: p.i, j: p.j }, content);
    for (const m of MODES) {
      const s = first(seed, m);
      const out = act(s, { round: 1, actor: 'P', i: p.i, j: p.j }, content);
      assert.equal(out.legal, true);
      assert.ok(out.events.some((e) => e.t === 'RE' || e.t === 'END'), `${m} ${seed} 結算未完成`);
      if (m === 'B') assert.equal(hashOf(out.events), hashOf(ref.events), `B ${seed}`);
      const ch = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
      if (m.startsWith('A') && ch?.reason === 'OBSESSION') assert.equal(ch.side, obsessionPreview(s, partitionOf(s, p.i, p.j))!.side);
    }
    hit++;
  }
  assert.equal(hit, 5);
});

test('X-7 全部切穿：兩側都空；四模式 HP 與勝負相同（兩側同為空，選哪側都一樣）；B 不能留傷口（>2 顆）', () => {
  const s0 = first(700500, 'BASELINE');
  const p = legalLines(s0)[0];
  const keys = s0.board!.organs.map((o) => o.key);
  const ref = act(withBoard(s0, onLine(s0, p, keys)), { round: 1, actor: 'P', i: p.i, j: p.j }, content);
  for (const m of MODES) {
    const s = withBoard(first(700500, m), onLine(s0, p, keys));
    const part = partitionOf(s, p.i, p.j);
    assert.deepEqual([part.pierced.length, part.L.length, part.R.length], [keys.length, 0, 0], m);
    const out = act(s, { round: 1, actor: 'P', i: p.i, j: p.j }, content);
    assert.deepEqual([out.state.hp, out.state.result], [ref.state.hp, ref.state.result], m);
    if (m === 'B') {
      assert.deepEqual(keepWoundCheck(s, part), { ok: false, reason: 'PIERCED_TOO_MANY' });
      assert.throws(() => act(s, { round: 1, actor: 'P', i: p.i, j: p.j, keepWound: true }, content), InvalidAction);
    }
  }
});

test('X-7 最小面積合法線：四模式可結算；A2 執念指向大塊；B 事件與 BASELINE 相同', () => {
  for (const seed of [700601, 700602, 700603]) {
    const s0 = first(seed, 'BASELINE');
    const lines = legalLines(s0);
    const p = lines.reduce((a, b) => (Math.min(b.area2.L, b.area2.R) < Math.min(a.area2.L, a.area2.R) ? b : a));
    const tot = p.area2.L + p.area2.R, mn = Math.min(p.area2.L, p.area2.R);
    assert.ok(10 * mn >= tot && 10 * mn < 2 * tot, `最小面積線應接近 10% 門檻：${mn}/${tot}`);
    const ref = act(s0, { round: 1, actor: 'P', i: p.i, j: p.j }, content);
    for (const m of MODES) {
      const s = first(seed, m);
      const out = act(s, { round: 1, actor: 'P', i: p.i, j: p.j }, content);
      assert.equal(out.legal, true);
      if (m === 'B') assert.equal(hashOf(out.events), hashOf(ref.events));
      if (m === 'A2') assert.equal(obsessionPreview(s, p)!.side, p.area2.L > p.area2.R ? 'L' : 'R');
    }
  }
});

test('X-7 雙方同時歸零：四模式都判玩家敗（sd1），事件與 BASELINE 逐值相同', () => {
  const s0 = first(700700, 'BASELINE');
  const p = legalLines(s0)[0];
  const board = onLine(s0, p, ['poison']);
  const ref = act(withBoard(s0, board, { P: 2, E: 2 }), { round: 1, actor: 'P', i: p.i, j: p.j }, content);
  assert.deepEqual([ref.state.result, ref.state.sd1, ref.state.hp], ['LOSS', true, { P: 0, E: 0 }]);
  for (const m of MODES) {
    const out = act(withBoard(first(700700, m), board, { P: 2, E: 2 }), { round: 1, actor: 'P', i: p.i, j: p.j }, content);
    assert.deepEqual([out.state.result, out.state.sd1], ['LOSS', true], m);
    assert.equal(hashOf(sansWound(out.events)), hashOf(ref.events), m);
    if (m === 'B') assert.equal(out.state.wound, null);
  }
});

// ---------------------------------------------------------------- X-11（引擎端欄位）

test('X-11 引擎端紀錄欄位：模式、敵人種類、選邊理由、執念是否觸發與兩側指標、傷口留／撕／癒與撕裂 HP 變化', () => {
  let obs = 0, tears = 0, keeps = 0, heals = 0;
  for (const m of MODES) for (let seed = 700800; seed < 700840; seed++) {
    const cfg = expConfig(m, seed);
    const r = playRandom(cfg);
    let s = newBattle(cfg, content).state;
    for (const a of r.actions) {
      const part = partitionOf(s, a.i, a.j);
      const out = act(s, a, content);
      const f = expRoundFacts(s, part, out.events);
      assert.equal(f.mode, m === 'A1' || m === 'A2' ? 'A' : m);
      assert.equal(f.enemyKind, cfg.enemy.kind);
      const ch = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
      assert.equal(f.choiceReason, ch ? ch.reason : null);
      assert.equal(f.obsessionTriggered, ch?.reason === 'OBSESSION');
      if (f.obsessionTriggered) obs++;
      assert.equal(f.obsession === null, !m.startsWith('A'));
      if (m !== 'B') assert.deepEqual([f.wound, f.tearHpLoss], [[], null]);
      for (const w of f.wound) {
        if (w.op === 'KEEP') { keeps++; assert.deepEqual(w.organs, [...part.pierced].sort((x, y) => x.id - y.id).map((o) => o.key)); }
        if (w.op === 'HEAL') heals++;
        if (w.op === 'TEAR') {
          tears++;
          assert.deepEqual(w.organs, s.wound!.sealed.map((o) => o.key));
          const ids = new Set((out.events.find((e) => e.t === 'WOUND' && e.op === 'TEAR') as Extract<Ev, { t: 'WOUND' }>).copies);
          const loss = { P: 0, E: 0 };
          for (const e of out.events) if (e.t === 'DMG' && ids.has(e.organ)) loss[e.dst] += e.loss;
          assert.deepEqual(f.tearHpLoss, loss);
        }
      }
      s = out.state;
    }
  }
  console.log(`X-11 紀錄欄位樣本：執念 ${obs}、留 ${keeps}、撕 ${tears}、癒 ${heals}`);
  assert.ok(obs > 0 && keeps > 0 && tears > 0 && heals > 0);
});

test('匯入守衛：拒絕實驗 A／B 紀錄（expMode、config.exp.mode、執念敵人）；BASELINE 與舊紀錄照收', () => {
  const base = { format: 'thecut-protoB-log/1', fork: 'proto-b', protoMode: 'research6', configHash: 'x', config: expConfig('BASELINE', 1) };
  assert.doesNotThrow(() => assertResearchLog(base));
  assert.doesNotThrow(() => assertResearchLog({ ...base, expMode: 'BASELINE', config: { ...base.config, exp: { mode: 'BASELINE' } } }));
  assert.throws(() => assertResearchLog({ ...base, expMode: 'A' }), /拒絕實驗模式/);
  assert.throws(() => assertResearchLog({ ...base, expMode: 'B' }), /拒絕實驗模式/);
  assert.throws(() => assertResearchLog({ ...base, config: expConfig('B', 1) }), /拒絕實驗模式/);
  assert.throws(() => assertResearchLog({ ...base, config: expConfig('A1', 1) }), /拒絕實驗模式/);
  assert.throws(() => assertResearchLog({ ...base, config: { ...expConfig('A2', 1), exp: undefined } }), /拒絕實驗模式/);
  assert.throws(() => assertResearchLog({ ...base, expMode: undefined }), /拒絕實驗模式/);
});
