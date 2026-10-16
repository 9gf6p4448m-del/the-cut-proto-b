// 凍結驗收 T-1、T-4、T-6、T-7、ISO-3、規格 v2 MUST 5（匯入守衛）。作者測試（AUTHOR_EVIDENCE）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { ROOT, sha, walk, snapshot, FORK_OLD, FORK_NEW, FORK_ADD, originalEngineDir, CFG } from './helpers.ts';
import { newBattle, setProtoBOrganPool } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
import { assertResearchLog } from '../../tools/import_guard.ts';

const snap = snapshot();

test('T-1 引擎快照：除凍結登記的一處外逐位元組相同', () => {
  const files = walk(join(ROOT, 'engine')).map((f) => relative(join(ROOT, 'engine'), f).replace(/\\/g, '/'));
  assert.deepEqual(files.sort(), [...snap.keys()].sort(), '檔案集合與快照不同');
  for (const f of files) {
    const b = readFileSync(join(ROOT, 'engine', f));
    if (f === 'src/engine.ts') {
      const t = b.toString('utf8');
      assert.equal(t.split(FORK_NEW).length - 1, 1, 'fork 呼叫點必須恰好一處');
      assert.equal(t.includes(FORK_ADD), true, 'fork 宣告必須存在');
      assert.equal(sha(t.replace(FORK_ADD, '').replace(FORK_NEW, FORK_OLD)), snap.get(f), '撤銷 fork 後必須等於 3e2b9b4 原檔');
    } else assert.equal(sha(b), snap.get(f), `${f} 與 3e2b9b4 不同`);
  }
});

test('T-1 反推的原始引擎與快照相同（供 T-5 跨環境重算）', () => {
  const d = originalEngineDir();
  for (const [f, h] of snap) assert.equal(sha(readFileSync(join(d, f))), h, f);
});

test('T-7 內容檔與 3e2b9b4 相同；前端不匯入 restoreState', () => {
  assert.equal(sha(readFileSync(join(ROOT, 'engine/content/trig.json'))), snap.get('content/trig.json'));
  assert.equal(sha(readFileSync(join(ROOT, 'engine/content/organs.json'))), snap.get('content/organs.json'));
  for (const f of walk(join(ROOT, 'src'))) assert.equal(/restoreState/.test(readFileSync(f, 'utf8')), false, f);
});

test('T-4 三器官模式：每回合只出現心臟、骨盾、毒囊；設回 6 時出現多種器官', () => {
  const content = loadContent();
  try {
    setProtoBOrganPool(3);
    for (let seed = 100001; seed <= 100200; seed++) {
      const s = newBattle({ ...CFG, seed }, content).state;
      for (const o of s.board!.organs) assert.ok(['heart', 'shield', 'poison'].includes(o.key), `${seed}: ${o.key}`);
    }
    setProtoBOrganPool(6);
    const keys = new Set<string>();
    for (let seed = 100001; seed <= 100200; seed++) for (const o of newBattle({ ...CFG, seed }, content).state.board!.organs) keys.add(o.key);
    assert.ok(keys.size >= 5, `六器官模式應出現多種器官：${[...keys]}`);
  } finally { setProtoBOrganPool(6); }
});

test('T-6 前端只匯入允許清單；act 只有一個呼叫點且在確認處理器內；預覽不試算', () => {
  // setProtoBOrganPool：模式設定，不是規則計算（規格 v2 修訂紀錄：T-1 要求它存在、T-4 要求前端能切換模式，T-6 原清單漏列，三者不可能同時成立）
  const ALLOW = new Set(['act', 'newBattle', 'partitionOf', 'legalLines', 'stateHash', 'toVector', 'replay', 'loadContent', 'setProtoBOrganPool', 'BattleConfig', 'BattleState', 'Partition', 'Ev', 'Organ']);
  const FORBIDDEN_MOD = /from '\.\.\/engine\/src\/(resolve|enemy|geom|int|prng|triggers|bots|canon)\.ts'/;
  for (const f of walk(join(ROOT, 'src'))) {
    const t = readFileSync(f, 'utf8');
    assert.equal(FORBIDDEN_MOD.test(t), false, `${f} 匯入引擎內部模組`);
    for (const m of t.matchAll(/import (?:type )?\{([^}]*)\} from '\.\.\/engine\/src\/[a-z]+\.ts'/g)) {
      for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(ALLOW.has(n), `${f} 匯入不在允許清單：${n}`);
    }
    const calls = [...t.matchAll(/[^.\w]act\(/g)].length;
    assert.equal(calls, 1, `act 呼叫點應恰好 1 個，實際 ${calls}`);
    const prev = t.slice(t.indexOf('function updatePreview'), t.indexOf('function showPending'));
    assert.equal(/\bact\(|replay\(|newBattle\(/.test(prev), false, '預覽路徑呼叫了試算函式');
    const confirmBlock = t.slice(t.indexOf('els.confirm.onclick'), t.indexOf('els.skip.onclick'));
    assert.ok(/[^.\w]act\(/.test(confirmBlock), 'act 必須只在確認按鈕處理器內');
  }
});

test('MUST 5 匯入守衛：拒絕三器官與格式不符的紀錄，不看 configHash', () => {
  const base = { format: 'thecut-protoB-log/1', fork: 'proto-b', protoMode: 'research6', configHash: 'x' };
  assert.doesNotThrow(() => assertResearchLog(base));
  assert.throws(() => assertResearchLog({ ...base, protoMode: 'experience3' }), /拒絕非研究模式/);
  assert.throws(() => assertResearchLog({ ...base, fork: 'other' }), /fork/);
  assert.throws(() => assertResearchLog({ ...base, format: 'v0' }), /格式/);
  assert.throws(() => assertResearchLog({ ...base, protoMode: undefined }), /拒絕非研究模式/);
});

test('ISO-3 B 軌 repo 不含審查文件、決策紀錄、Codex 輸出或憑證樣式檔', () => {
  if (!existsSync(join(ROOT, '.git'))) return;
  const files = execSync('git ls-files', { cwd: ROOT }).toString().split('\n').filter(Boolean);
  for (const f of files) assert.equal(/^docs\/reviews\/|DECISION_LOG|codex_output|CODEX_.*RAW|\.env$|_api_key|\.pfx$|token\.txt/i.test(f), false, f);
});
