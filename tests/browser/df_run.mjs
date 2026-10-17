// 只跑 duel3 瀏覽器測試：node tests/browser/df_run.mjs [截圖目錄]（需先 node tools/build.mjs）。作者測試；模擬，不是實機。
// DF_ONLY=chromium 只跑一種；DF_SKIP_LINE=1 不跑 DF-03（直線預覽下照跑 duel2 的 cb／da 測試）。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runDfTests, LINE_INIT } from './df_tests.mjs';
import { runDaTests } from './da_tests.mjs';
import { runCbTests } from './cb_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const { srv, url } = await serve(process.cwd());
const shotDir = process.argv[2] ?? 'test-output/df_shots';
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.DF_ONLY || n === process.env.DF_ONLY)) {
  await runDfTests({ bname, btype, devices, url, check, shotDir: bname === 'chromium' ? shotDir : `${shotDir}/webkit` });
  if (!process.env.DF_SKIP_LINE) {
    await runCbTests({ bname, btype, devices, url, check, sub: 'duel3', ver: 'v0.3 手感與可讀性', winSeed: Number(process.env.DF_WIN_SEED ?? 3), init: LINE_INIT });
    await runDaTests({ bname, btype, devices, url, check, sub: 'duel3', init: LINE_INIT, shotDir: bname === 'chromium' ? `${shotDir}/line` : undefined });
  }
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nduel3 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
