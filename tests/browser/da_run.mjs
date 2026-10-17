// 只跑 duel2 瀏覽器測試：node tests/browser/da_run.mjs [截圖目錄]（需先 node tools/build.mjs）。作者測試；模擬，不是實機。DA_ONLY=chromium 只跑一種。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runDaTests } from './da_tests.mjs';
import { runCbTests } from './cb_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const { srv, url } = await serve(process.cwd());
const shotDir = process.argv[2];
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.DA_ONLY || n === process.env.DA_ONLY)) {
  await runDaTests({ bname, btype, devices, url, check, shotDir: bname === 'chromium' ? shotDir : undefined });
  if (!process.env.DA_SKIP_CB) await runCbTests({ bname, btype, devices, url, check, sub: 'duel2', ver: 'v0.2 美術合併', winSeed: Number(process.env.DA_WIN_SEED ?? 2) });
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nduel2 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
