// 只跑 art-kit 瀏覽器測試（Chromium＋WebKit），不跑整套 tests/browser/run.mjs。先 npm run build 產生 dist-art/。用法：node tools/art/run_artkit_tests.mjs
import { chromium, webkit, devices } from 'playwright';
import { serve } from '../../tests/browser/serve.mjs';
import { runArtKitTests } from '../../tests/browser/artkit_tests.mjs';

const { srv, url } = await serve(process.cwd());
let fail = 0, pass = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `  ← ${detail}`}`); };
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]]) await runArtKitTests({ bname, btype, devices, url, check });
srv.close();
console.log(`art-kit 瀏覽器測試：${pass} 過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
