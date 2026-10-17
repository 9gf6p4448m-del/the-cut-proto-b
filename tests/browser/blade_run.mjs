// 只跑刀譜（blade/）瀏覽器測試：node tests/browser/blade_run.mjs（需先 node tools/build.mjs）。作者測試；模擬，不是實機。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runBladeTests } from './blade_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const { srv, url } = await serve(process.cwd());
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.BLADE_ONLY || n === process.env.BLADE_ONLY)) await runBladeTests({ bname, btype, devices, url, check });
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nblade 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
