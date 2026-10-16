// 凍結驗收 T-5：瀏覽器匯出的每局紀錄，在 Node 上逐回合重算。六器官研究模式用「原始 3e2b9b4 引擎」（由 fork 反推、逐檔核對快照雜湊），
// 三器官體驗模式用 B 軌 fork 引擎（原始引擎寫死 6 種，不適用）。每回合比對：狀態雜湊、HP、完整有序事件、紀錄的選側與毒囊結果；最後比對勝負。
// Codex 限定審查 F-1（MEDIUM）指出前一版只比最終狀態；本版逐回合比對，並以竄改紀錄的對照組證明會紅。作者測試。
// 需要先跑 tests/browser/run.mjs 產生 test-output/logs；沒有紀錄時本測試失敗（不得靜默略過）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, originalEngineDir } from './helpers.ts';
import * as fork from '../../engine/src/engine.ts';
import { loadContent as forkContent } from '../../engine/src/content.ts';
import { assertResearchLog } from '../../tools/import_guard.ts';

const dir = join(ROOT, 'test-output', 'logs');

async function engines() {
  const od = originalEngineDir();
  const orig = await import(pathToFileURL(join(od, 'src', 'engine.ts')).href);
  const origContent = (await import(pathToFileURL(join(od, 'src', 'content.ts')).href)).loadContent();
  return { orig, origContent };
}

/** 逐回合重算一份紀錄；任何不一致都拋出。 */
function verifyLog(log: any, E: any, content: any): void {
  let s = E.newBattle(log.config, content).state;
  assert.equal(log.actions.length, log.rounds.length, '指令數與回合紀錄數不同');
  log.actions.forEach((a: any, k: number) => {
    const rec = log.rounds[k];
    const part = E.partitionOf(s, a.i, a.j);
    const out = E.act(s, a, content);
    assert.equal(out.legal, true, `第 ${k + 1} 刀不合法`);
    assert.deepEqual(rec.events, JSON.parse(JSON.stringify(out.events)), `第 ${k + 1} 刀事件（含順序）不同`);
    const ch = out.events.find((e: any) => e.t === 'CHOICE');
    assert.equal(rec.enemySide, ch ? ch.side : null, `第 ${k + 1} 刀紀錄的屠夫選側不同`);
    const taken = rec.enemySide === 'L' ? part.L : rec.enemySide === 'R' ? part.R : [];
    assert.equal(rec.enemyTookPoison, taken.some((o: any) => o.key === 'poison'), `第 ${k + 1} 刀紀錄的毒囊結果不同`);
    s = out.state;
    assert.deepEqual(rec.hpAfter, { P: s.hp.P, E: s.hp.E }, `第 ${k + 1} 刀後 HP 不同`);
    assert.equal(rec.stateHashAfter, E.stateHash(s), `第 ${k + 1} 刀後狀態雜湊不同`);
  });
  assert.equal(E.stateHash(s), log.finalStateHash, '最終狀態雜湊不同');
  assert.equal(s.result, log.result, '勝負不同');
}

function withMode<T>(log: any, f: () => T): T {
  if (log.protoMode !== 'experience3') return f();
  fork.setProtoBOrganPool(3);
  try { return f(); } finally { fork.setProtoBOrganPool(6); }
}

function loadLogs(): { f: string; log: any }[] {
  assert.ok(existsSync(dir), '沒有瀏覽器紀錄（先跑 node tests/browser/run.mjs）');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, log: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

test('T-5 跨環境逐回合重算：瀏覽器紀錄在 Node 上事件、HP、選側、雜湊、勝負一致', async () => {
  const logs = loadLogs();
  assert.ok(logs.length >= 4, `紀錄太少：${logs.length}`);
  const { orig, origContent } = await engines();
  let r6 = 0, e3 = 0;
  for (const { f, log } of logs) {
    assert.equal(log.format, 'thecut-protoB-log/1', f);
    assert.ok(log.finalStateHash, `${f} 沒有最終狀態雜湊（對局未結束）`);
    if (log.protoMode === 'research6') { assertResearchLog(log); verifyLog(log, orig, origContent); r6++; }
    else { assert.throws(() => assertResearchLog(log), /拒絕非研究模式/); withMode(log, () => verifyLog(log, fork, forkContent())); e3++; }
  }
  assert.ok(r6 >= 2 && e3 >= 2, `兩種模式都要有紀錄：research6 ${r6}、experience3 ${e3}`);
});

test('T-5 鑑別力：竄改紀錄的選側、毒囊結果、中途 HP、事件順序，各自都必須被抓到', async () => {
  const { log } = loadLogs().find((x) => x.log.protoMode === 'research6')!;
  const { orig, origContent } = await engines();
  const tamper: [string, (l: any) => void][] = [
    ['選側', (l) => { l.rounds[0].enemySide = l.rounds[0].enemySide === 'L' ? 'R' : 'L'; }],
    ['毒囊結果', (l) => { l.rounds[0].enemyTookPoison = !l.rounds[0].enemyTookPoison; }],
    ['中途 HP', (l) => { l.rounds[0].hpAfter.P += 1; }],
    ['事件順序', (l) => { const e = l.rounds[0].events; if (e.length > 2) [e[1], e[2]] = [e[2], e[1]]; }],
  ];
  assert.doesNotThrow(() => verifyLog(log, orig, origContent), '健康紀錄必須通過');
  for (const [name, mut] of tamper) {
    const l = JSON.parse(JSON.stringify(log));
    mut(l);
    assert.throws(() => verifyLog(l, orig, origContent), undefined, `竄改${name}後仍通過`);
  }
});
