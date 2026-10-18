// 只跑 duel4 瀏覽器測試：node tests/browser/fv_run.mjs（需先 node tools/build.mjs）。作者測試；模擬，不是實機。
// FV_ONLY=chromium 只跑一種；FV_PART=fv 只跑 fv_tests（不跑 FV-07 的 df／cb／da 照跑）。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runFvTests } from './fv_tests.mjs';
import { runDfTests, lineInit } from './df_tests.mjs';
import { runDaTests } from './da_tests.mjs';
import { runCbTests } from './cb_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const { srv, url } = await serve(process.cwd());
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.FV_ONLY || n === process.env.FV_ONLY)) {
  await runFvTests({ bname, btype, devices, url, check, shotDir: bname === 'chromium' ? 'test-output/fv_shots' : 'test-output/fv_shots/webkit' });
  if (process.env.FV_PART === 'fv') continue;
  // FV-07：v0.3 的 DF 測試在 duel4 照跑（push 起始 0）；直線預覽下照跑 duel2 的 cb／da 測試
  await runDfTests({ bname, btype, devices, url, check, sub: 'duel4', ver: 'v0.4 前線推進', shotDir: bname === 'chromium' ? 'test-output/fv_shots/df' : 'test-output/fv_shots/df/webkit' });
  await runCbTests({ bname, btype, devices, url, check, sub: 'duel4', ver: 'v0.4 前線推進', winSeed: Number(process.env.FV_WIN_SEED ?? 3), init: lineInit('duel4') });
  await runDaTests({ bname, btype, devices, url, check, sub: 'duel4', init: lineInit('duel4'), shotDir: bname === 'chromium' ? 'test-output/fv_shots/line' : undefined });
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nduel4 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
