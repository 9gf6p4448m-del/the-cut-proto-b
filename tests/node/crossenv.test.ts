// 凍結驗收 T-5：瀏覽器匯出的每局紀錄，在 Node 上重算。六器官研究模式用「原始 3e2b9b4 引擎」（由 fork 反推、逐檔核對快照雜湊），
// 三器官體驗模式用 B 軌 fork 引擎（原始引擎寫死 6 種，不適用）。要求勝負與最終 stateHash 一致。作者測試。
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

test('T-5 跨環境重算：瀏覽器紀錄在 Node 上結果一致', async () => {
  assert.ok(existsSync(dir), '沒有瀏覽器紀錄（先跑 node tests/browser/run.mjs）');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 4, `紀錄太少：${files.length}`);
  const od = originalEngineDir();
  const orig = await import(pathToFileURL(join(od, 'src', 'engine.ts')).href);
  const origContent = (await import(pathToFileURL(join(od, 'src', 'content.ts')).href)).loadContent();
  let r6 = 0, e3 = 0;
  for (const f of files) {
    const log = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.equal(log.format, 'thecut-protoB-log/1');
    assert.ok(log.finalStateHash, `${f} 沒有最終狀態雜湊（對局未結束）`);
    let s;
    if (log.protoMode === 'research6') {
      assertResearchLog(log);
      s = orig.newBattle(log.config, origContent).state;
      for (const a of log.actions) s = orig.act(s, a, origContent).state;
      assert.equal(orig.stateHash(s), log.finalStateHash, `${f}：原始引擎重算的最終狀態不同`);
      r6++;
    } else {
      assert.throws(() => assertResearchLog(log), /拒絕非研究模式/, '三器官紀錄必須被研究工具守衛拒絕');
      fork.setProtoBOrganPool(3);
      try {
        const c = forkContent();
        s = fork.newBattle(log.config, c).state;
        for (const a of log.actions) s = fork.act(s, a, c).state;
        assert.equal(fork.stateHash(s), log.finalStateHash, `${f}：fork 引擎重算的最終狀態不同`);
      } finally { fork.setProtoBOrganPool(6); }
      e3++;
    }
    assert.equal(s.result, log.result, `${f}：勝負不同`);
  }
  assert.ok(r6 >= 2 && e3 >= 2, `兩種模式都要有紀錄：research6 ${r6}、experience3 ${e3}`);
});
