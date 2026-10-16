// 凍結驗收 X-1（Node 部分）：本分支 BASELINE 對 b18a218 原引擎（git show 匯出到 .tmp）逐回合差分。
// 每一步比對：configHash、runConfigOf、開局／每刀後狀態雜湊與正規 JSON（＝狀態形狀）、事件雜湊、合法切線集合。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, CFG, FORK_HOOKS } from './helpers.ts';
import * as N from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { canonical, hashOf } from '../../engine/src/canon.ts';
import { Cursor, streamState } from '../../engine/src/prng.ts';

const REF = 'b18a218';

/** 以 git show 匯出 b18a218 的 engine/（原始位元組），回傳目錄。 */
function exportRef(): string {
  const dst = join(ROOT, '.tmp', `${REF}-engine-${process.pid}`);
  const files = execSync(`git ls-tree -r --name-only ${REF} engine`, { cwd: ROOT }).toString().split('\n').filter(Boolean);
  assert.ok(files.length >= 15, `匯出檔案太少：${files.length}`);
  for (const f of files) {
    const to = join(dst, f.slice('engine/'.length));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, execSync(`git show ${REF}:${f}`, { cwd: ROOT, maxBuffer: 1 << 26 }));
  }
  return dst;
}

const dir = exportRef();
const O = await import(pathToFileURL(join(dir, 'src', 'engine.ts')).href);
const oContent = (await import(pathToFileURL(join(dir, 'src', 'content.ts')).href)).loadContent();
const oCanon = await import(pathToFileURL(join(dir, 'src', 'canon.ts')).href);
const nContent = loadContent();

test('X-1 前提：匯出的 b18a218 引擎＝本分支撤銷 X-* 掛鉤（登記表涵蓋對 b18a218 的全部差異）', () => {
  for (const f of ['src/engine.ts', 'src/enemy.ts', 'src/resolve.ts', 'src/types.ts']) {
    let t = readFileSync(join(ROOT, 'engine', f), 'utf8');
    for (const h of [...FORK_HOOKS].reverse()) if (h.file === f && h.id.startsWith('X-')) t = t.split(h.new).join(h.old);
    assert.equal(t, readFileSync(join(dir, f), 'utf8'), f);
  }
});

interface Stat { battles: number; steps: number; results: Record<string, number> }

/** 同一組隨機合法刀（取自本分支的合法切線，並核對兩邊合法切線集合相同）同時餵給兩個引擎，逐步比對。 */
function diffBattle(cfgN: N.BattleConfig, cfgO: unknown, stat: Stat, NE: any = N): void {
  const seed = cfgN.seed;
  assert.equal(hashOf(NE.runConfigOf(cfgN, nContent)), oCanon.hashOf(O.runConfigOf(cfgO, oContent)), `runConfig ${seed}`);
  const a = NE.newBattle(cfgN, nContent), b = O.newBattle(cfgO, oContent);
  let sN = a.state, sO = b.state;
  assert.equal(sN.configHash, sO.configHash, `configHash ${seed}`);
  assert.equal(canonical(sN), oCanon.canonical(sO), `開局狀態 ${seed}`);
  assert.equal(hashOf(a.events), oCanon.hashOf(b.events), `開局事件 ${seed}`);
  assert.equal('wound' in sN, false, '狀態不得有 wound 欄位');
  assert.equal('exp' in sN.config, false, '狀態內設定不得有 exp 欄位');
  const c = new Cursor(streamState(seed, 'x1'));
  while (!sN.result) {
    const lines = NE.legalLines(sN);
    assert.equal(canonical(lines), oCanon.canonical(O.legalLines(sO)), `合法切線 ${seed} r${sN.round}`);
    const p = lines[c.below(lines.length)];
    const act = { round: sN.round, actor: 'P' as const, i: p.i, j: p.j };
    const x = NE.act(sN, act, nContent), y = O.act(sO, act, oContent);
    assert.equal(hashOf(x.events), oCanon.hashOf(y.events), `事件 ${seed} r${sN.round}`);
    assert.equal(NE.stateHash(x.state), O.stateHash(y.state), `狀態雜湊 ${seed} r${sN.round}`);
    assert.equal(canonical(x.state), oCanon.canonical(y.state), `狀態形狀 ${seed} r${sN.round}`);
    sN = x.state; sO = y.state; stat.steps++;
  }
  assert.equal(sN.result, sO.result);
  assert.equal('wound' in sN, false);
  stat.battles++; stat.results[sN.result!] = (stat.results[sN.result!] ?? 0) + 1;
}

test('X-1 BASELINE（未設定 exp）：240 seeds × 隨機合法刀，事件與狀態雜湊逐回合等於 b18a218', () => {
  const st: Stat = { battles: 0, steps: 0, results: {} };
  for (let seed = 310001; seed <= 310240; seed++) diffBattle({ ...CFG, seed } as N.BattleConfig, { ...CFG, seed }, st);
  console.log('X-1 未設定 exp', JSON.stringify(st));
  assert.equal(st.battles, 240);
  assert.ok(st.steps >= 240 * 2, `步數太少：${st.steps}`);
  assert.ok(Object.keys(st.results).length >= 2, `結果種類太少：${JSON.stringify(st.results)}`);
});

test('X-1 BASELINE（exp.mode=BASELINE 明寫）：240 seeds，與 b18a218（無 exp）逐值相同', () => {
  const st: Stat = { battles: 0, steps: 0, results: {} };
  for (let seed = 310001; seed <= 310240; seed++) diffBattle({ ...CFG, seed, exp: { mode: 'BASELINE' } } as N.BattleConfig, { ...CFG, seed }, st);
  console.log('X-1 exp=BASELINE', JSON.stringify(st));
  assert.equal(st.battles, 240);
});

test('X-1 共用結算路徑：其他規則旗標、敵人與三器官池也逐值相同（每種 20 seeds）', () => {
  const variants = [
    { rules: { ph: 'PH-A', so: 'SO-1', hs: 'HS-2', sem: 'SEM-2' }, enemy: { kind: 'BOSS' } },
    { rules: { ph: 'PH-B', so: 'SO-2', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'KNG', w10: 5 } },
    { rules: { ph: 'PH-C', so: 'SO-3', hs: 'HS-2', sem: 'SEM-2' }, enemy: { kind: 'JUD', w10: 3 } },
    { rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'TALENT', talent: 'heart', mode: 'band', delta: 3 } },
  ];
  const st: Stat = { battles: 0, steps: 0, results: {} };
  variants.forEach((v, k) => {
    for (let seed = 320001 + 100 * k; seed < 320021 + 100 * k; seed++) diffBattle({ ...CFG, ...v, seed } as N.BattleConfig, { ...CFG, ...v, seed }, st);
  });
  for (const pool of [3, 6] as const) {
    N.setProtoBOrganPool(pool); O.setProtoBOrganPool(pool);
    try { for (let seed = 330001; seed <= 330020; seed++) diffBattle({ ...CFG, seed } as N.BattleConfig, { ...CFG, seed }, st); }
    finally { N.setProtoBOrganPool(6); O.setProtoBOrganPool(6); }
  }
  console.log('X-1 變體', JSON.stringify(st));
  assert.equal(st.battles, 120);
});

/** 複製本分支引擎到 .tmp 並套用一處突變，載入成獨立模組（不動 repo 內的引擎檔）。 */
async function mutant(name: string, file: string, from: string, to: string): Promise<any> {
  const d = join(ROOT, '.tmp', `x1-mut-${name}-${process.pid}`);
  const tracked = execSync('git ls-files engine', { cwd: ROOT }).toString().split(/\r?\n/).filter(Boolean);
  for (const f of [...new Set([...tracked, 'engine/src/experiment.ts'])]) {
    const to2 = join(d, f.slice('engine/'.length));
    mkdirSync(dirname(to2), { recursive: true });
    writeFileSync(to2, readFileSync(join(ROOT, f)));
  }
  const src = readFileSync(join(d, file), 'utf8');
  assert.equal(src.split(from).length - 1, 1, `突變點 ${name} 必須恰好一處`);
  writeFileSync(join(d, file), src.split(from).join(to));
  return import(pathToFileURL(join(d, 'src', 'engine.ts')).href);
}

test('X-1 鑑別力：同一驅動器對三種「壞實作」必須報不同（且不是靠設定雜湊，是行為差異）', async () => {
  const cases: [string, string, string, string][] = [
    ['but-choice', 'src/enemy.ts', "return [keep.reduce((s, o) => s + content.byKey[o.key].attack, 0), 20];", "return [keep.reduce((s, o) => s + content.byKey[o.key].attack, 0), 19];"],
    ['wound-leak', 'src/experiment.ts', "return expModeOf(cfg) === 'B' ? { wound: null } : {};", "return { wound: null };"],
    ['shared-settle', 'src/resolve.ts', 'const loss = Math.min(d.raw - abs, hp[d.dst]);', "const loss = Math.min(d.raw - abs + (d.kind === 'CORE' ? 1 : 0), hp[d.dst]);"],
  ];
  for (const [name, file, from, to] of cases) {
    const M = await mutant(name, file, from, to);
    let differ = 0;
    const msgs = new Set<string>();
    for (let seed = 310001; seed <= 310040; seed++) {
      try { diffBattle({ ...CFG, seed } as N.BattleConfig, { ...CFG, seed }, { battles: 0, steps: 0, results: {} }, M); }
      catch (e) { if (e instanceof assert.AssertionError) { differ++; msgs.add(String(e.message).split(' ')[0]); } else throw e; }
    }
    console.log(`X-1 突變 ${name}：${differ}/40 局被抓到，首個不同處＝${[...msgs].join('、')}`);
    assert.ok(differ >= 1, `突變 ${name} 沒被抓到`);
    assert.equal([...msgs].some((m) => /^(runConfig|configHash)/.test(m)), false, `突變 ${name} 是靠設定雜湊被抓到，不是行為`);
  }
});
