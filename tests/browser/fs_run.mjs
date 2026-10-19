// 只跑 duel5 瀏覽器測試：node tests/browser/fs_run.mjs（需先 node tools/build.mjs）。作者測試；模擬，不是實機。FS_ONLY=chromium 只跑一種。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runFsTests } from './fs_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const SUB = process.env.DUEL_SUB ?? 'duel5';   // duel6：DUEL_SUB=duel6 以 duel6 為目標（FT-08）；不設＝duel5
const { srv, url } = await serve(process.cwd());
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.FS_ONLY || n === process.env.FS_ONLY)) {
  await runFsTests({ bname, btype, devices, url, check, sub: SUB, shotDir: bname === 'chromium' ? 'test-output/fs_shots' : 'test-output/fs_shots/webkit' });
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nduel5 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
