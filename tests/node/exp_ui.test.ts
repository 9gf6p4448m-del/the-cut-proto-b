// FUN-EXP-01 第二階段（Node 側）：X-11 瀏覽器紀錄逐回合重算、localStorage 只存最近幾局、X-12 建置輸出（manifest／SW／根網址版本不受影響）。作者測試。
// 前兩項需要先跑 node tests/browser/run.mjs（產生 test-output/exp_logs）；沒有紀錄時失敗，不得靜默略過。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORK_HOOKS, FORK_NEW_FILES, ROOT, sha, snapshot, undoHooks } from './helpers.ts';
import { act, newBattle, partitionOf, setProtoBOrganPool, stateHash } from '../../engine/src/engine.ts';
import type { Action } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { expRoundFacts } from '../../engine/src/experiment.ts';
import { EXP_PARAMS } from '../../src/exp_params.ts';
import { expBattleConfig, glyphOf, recentText, saveRecent } from '../../src/exp_ui.ts';
import type { ExpLog, ExpModeId } from '../../src/exp_ui.ts';

const content = loadContent();
const dir = join(ROOT, 'test-output', 'exp_logs');

/** 逐回合重算一份實驗版紀錄；傳回所有不一致（空陣列＝一致）。 */
function verifyLog(log: ExpLog): string[] {
  const bad: string[] = [];
  setProtoBOrganPool(6);
  let s = newBattle(log.config, content).state;
  if (s.configHash !== log.configHash) bad.push('configHash 不同');
  log.rounds.forEach((r, k) => {
    const a: Action = r.keepWound ? { round: s.round, actor: 'P', i: r.i, j: r.j, keepWound: true } : { round: s.round, actor: 'P', i: r.i, j: r.j };
    const part = partitionOf(s, r.i, r.j);
    const before = s;
    const tag = `R${k + 1}`;
    let out: ReturnType<typeof act>;
    try { out = act(s, a, content); } catch (e) { bad.push(`${tag} 引擎拒絕：${String(e)}`); return; }
    if (!out.legal) bad.push(`${tag} 不合法`);
    if (JSON.stringify(out.events) !== JSON.stringify(r.events)) bad.push(`${tag} 事件不同`);
    s = out.state;
    if (r.stateHashAfter !== stateHash(s)) bad.push(`${tag} 狀態雜湊不同`);
    if (r.hpBefore.P !== before.hp.P || r.hpBefore.E !== before.hp.E || r.hpAfter.P !== s.hp.P || r.hpAfter.E !== s.hp.E) bad.push(`${tag} HP 前後不同`);
    if (JSON.stringify(r.sideL) !== JSON.stringify(part.L.map((o) => glyphOf(o.key))) || JSON.stringify(r.sideR) !== JSON.stringify(part.R.map((o) => glyphOf(o.key)))) bad.push(`${tag} 兩側器官不同`);
    const f = expRoundFacts(before, part, out.events);
    if (r.choiceSide !== f.choiceSide || r.choiceReason !== f.choiceReason || r.obsessionTriggered !== f.obsessionTriggered) bad.push(`${tag} 選邊／執念欄位不同`);
    if (JSON.stringify(r.wound) !== JSON.stringify(f.wound)) bad.push(`${tag} 傷口欄位不同`);
  });
  if (log.finalStateHash !== stateHash(s)) bad.push('最終雜湊不同');
  if (log.result !== s.result) bad.push('勝負不同');
  if (log.roundsPlayed !== log.rounds.length) bad.push('回合數不同');
  return bad;
}

function loadLogs(): { f: string; log: ExpLog }[] {
  assert.ok(existsSync(dir), '沒有實驗版紀錄（先跑 node tests/browser/run.mjs）');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, log: JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExpLog }));
}

test('X-11 實驗版瀏覽器紀錄（Chromium＋WebKit × 四模式）在 Node 逐回合重算一致，竄改必紅', () => {
  const logs = loadLogs();
  const modes = new Set(logs.map((l) => l.log.modeId));
  assert.deepEqual([...modes].sort(), ['A1', 'A2', 'B', 'BASELINE']);
  assert.ok(logs.length >= 8, `紀錄太少：${logs.length}`);
  for (const { f, log } of logs) assert.deepEqual(verifyLog(log), [], f);
  // 鑑別力：竄改一刀的錨點／傷口旗標／事件，重算必須回報不一致
  const base = logs.find((l) => l.log.modeId === 'B')!.log;
  const t1 = structuredClone(base); t1.rounds[0].j = t1.rounds[0].j === 0 ? 1 : t1.rounds[0].j - 1;
  assert.ok(verifyLog(t1).length > 0, '竄改 j 沒被發現');
  const t2 = structuredClone(base); t2.rounds[0].keepWound = !t2.rounds[0].keepWound;
  assert.ok(verifyLog(t2).length > 0, '竄改 keepWound 沒被發現');
  const t3 = structuredClone(base); t3.rounds[0].hpAfter.E += 1;
  assert.ok(verifyLog(t3).length > 0, '竄改 HP 沒被發現');
});

test('X-11 紀錄內容的設定與 exp_params 一致（HP 走引擎設定、盤面 seed 取自 exp_params）', () => {
  for (const { f, log } of loadLogs()) {
    const m = log.modeId as ExpModeId;
    assert.equal(log.config.hpE, EXP_PARAMS.hpE[m], f);
    assert.deepEqual(log.config, JSON.parse(JSON.stringify(expBattleConfig(m, log.seed))), f);
    assert.equal(log.seed, EXP_PARAMS.boards[m][1], `${f} 盤面 2 應為 exp_params 的第二個 seed`);
  }
});

// ---------------------------------------------------------------- localStorage

function fakeStorage(throwing = false) {
  const m = new Map<string, string>();
  return { getItem: (k: string) => { if (throwing) throw new Error('blocked'); return m.has(k) ? m.get(k)! : null; }, setItem: (k: string, v: string) => { if (throwing) throw new Error('blocked'); m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const sampleLog = (n: number): ExpLog => ({ ...(loadLogs()[0].log), seed: n });

test('localStorage：只存最近 5 局、同一局更新同一筆、讀寫全包 try/catch、匯出最近紀錄不含內部 id', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const prev = g.localStorage;
  try {
    g.localStorage = fakeStorage();
    for (let k = 1; k <= 7; k++) saveRecent(`g${k}`, sampleLog(k));
    let arr = JSON.parse(recentText()) as ExpLog[];
    assert.deepEqual(arr.map((x) => x.seed), [3, 4, 5, 6, 7]);
    const upd = sampleLog(7); upd.survey = { ...upd.survey, Q1: '是' };
    saveRecent('g7', upd);
    arr = JSON.parse(recentText()) as ExpLog[];
    assert.equal(arr.length, 5);
    assert.equal(arr.at(-1)!.survey.Q1, '是');
    assert.equal(JSON.stringify(arr).includes('_gid'), false);
    g.localStorage = fakeStorage(true);
    assert.doesNotThrow(() => saveRecent('x', sampleLog(1)));
    assert.equal(recentText(), '[]');
    delete g.localStorage;
    assert.doesNotThrow(() => saveRecent('x', sampleLog(1)));
  } finally { g.localStorage = prev; }
});

// ---------------------------------------------------------------- X-12 建置輸出

const PHASE1_HEAD = '54caa02';
test('X-12 實驗版建置輸出：manifest／service worker／註冊 scope／快取名稱與根網址版本獨立', () => {
  assert.ok(existsSync(join(ROOT, 'dist-exp', 'index.html')), '先跑 node tools/build.mjs');
  const man = JSON.parse(readFileSync(join(ROOT, 'dist-exp/manifest.webmanifest'), 'utf8'));
  const rootMan = JSON.parse(readFileSync(join(ROOT, 'dist/manifest.webmanifest'), 'utf8'));
  const info = JSON.parse(readFileSync(join(ROOT, 'dist-exp/.build-info.json'), 'utf8'));
  assert.equal(man.start_url, './'); assert.equal(man.scope, './');
  assert.equal(man.id, info.sub); assert.notEqual(man.id, rootMan.id); assert.notEqual(man.name, rootMan.name);
  assert.ok(String(man.name).includes('實驗'));
  const sw = readFileSync(join(ROOT, 'dist-exp/sw.js'), 'utf8'), rootSw = readFileSync(join(ROOT, 'dist/sw.js'), 'utf8');
  assert.ok(sw.includes(`'thecut-funexp01-'`) && sw.includes(`CACHE = PREFIX + '${info.sha}'`), '快取名稱要帶實驗版前綴與 SHA');
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  assert.ok(rootSw.includes(`'thecut-protob-${info.sha}'`) && !rootSw.includes('funexp01'));
  const app = readFileSync(join(ROOT, 'dist-exp/app.js'), 'utf8');
  assert.ok(/register\(["']\.\/sw\.js["'],\{scope:["']\.\/["']\}\)/.test(app), 'SW 註冊要明確指定子路徑 scope');
  const html = readFileSync(join(ROOT, 'dist-exp/index.html'), 'utf8');
  assert.ok(html.includes(`name="build-sha" content="${info.sha}"`) && html.includes('實驗版'));
  assert.equal(html.includes('__BUILD_SHA__') || sw.includes('__BUILD_SHA__') || JSON.stringify(man).includes('__SUB__'), false, '佔位符沒被取代');
  // 根網址版本的建置來源與程式不受第二階段影響
  assert.equal(readFileSync(join(ROOT, 'dist/app.js'), 'utf8').includes('funexp01'), false, '根網址 app.js 不該含實驗版程式');
  // DL-069（製作人核准根 SW 相容性修復）：public/sw.js 是唯一獲准改動的根網址檔案，其餘 public/ 與 src/main.ts 仍須與第一階段逐位元相同
  execSync(`git diff --quiet ${PHASE1_HEAD} -- public ":(exclude)public/sw.js" src/main.ts`, { cwd: ROOT });
  assert.ok(readFileSync(join(ROOT, 'public/sw.js'), 'utf8').includes('相容性修復（DL-069）'), 'public/sw.js 的改動只能是 DL-069 的根 SW 相容性修復');
  // 引擎：Codex F-2 修正必須改 resolve.ts（撕裂獨立步驟），所以不能再要求 engine 與第一階段逐位元相同；
  // 改為「第一階段之後的引擎差異只能是已登記掛鉤或 fork 新增檔」：每個變動檔撤銷全部登記掛鉤後，逐位元等於 3e2b9b4 快照。
  // （BASELINE 行為不變另由 X-1 差分與 golden 200/200 證明。）
  const snap = snapshot();
  const changed = execSync(`git diff --name-only ${PHASE1_HEAD} -- engine`, { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  assert.ok(changed.length > 0, '鑑別前提：F-2 之後引擎確實有變動');
  for (const f of changed) {
    const rel = f.replace(/^engine\//, '');
    if (FORK_NEW_FILES.includes(rel)) continue;
    assert.ok(FORK_HOOKS.some((h) => h.file === rel), `引擎檔 ${f} 在第一階段後有變動，但不是登記掛鉤的檔案`);
    assert.equal(sha(undoHooks(rel, readFileSync(join(ROOT, f), 'utf8'))), snap.get(rel), `引擎檔 ${f} 有登記表以外的改動`);
  }
});
