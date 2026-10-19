// FS-07：v0.4 的 FV（fv_tests）與 v0.3 的 DF（df_tests）、直線預覽下 duel2 的 cb／da 測試，在 duel5 選龍照跑。作者測試；模擬，不是實機。FS_ONLY=chromium 只跑一種。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runFvTests } from './fv_tests.mjs';
import { runDfTests, lineInit } from './df_tests.mjs';
import { runDaTests } from './da_tests.mjs';
import { runCbTests } from './cb_tests.mjs';
import { autoBeast } from './fs_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const { srv, url } = await serve(process.cwd());
const SUB = process.env.DUEL_SUB ?? 'duel5', VER = { duel5: 'v0.5 千節蛇', duel6: 'v0.6 平手＋紀錄' }[SUB];   // duel6：DUEL_SUB=duel6 以 duel6 為目標（FT-08）；不設＝duel5，行為不變
if (!VER) throw new Error('DUEL_SUB 只接受 duel5／duel6');
const DRAGON = autoBeast('dragon', SUB);
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.FS_ONLY || n === process.env.FS_ONLY)) {
  await runFvTests({ bname, btype, devices, url, check, sub: SUB, extraInit: [DRAGON], shotDir: bname === 'chromium' ? 'test-output/fs_shots/fv' : 'test-output/fs_shots/fv/webkit' });
  await runDfTests({ bname, btype, devices, url, check, sub: SUB, ver: VER, extraInit: [DRAGON], shotDir: bname === 'chromium' ? 'test-output/fs_shots/df' : 'test-output/fs_shots/df/webkit' });
  await runCbTests({ bname, btype, devices, url, check, sub: SUB, ver: VER, winSeed: 3, init: `${lineInit(SUB)}; ${DRAGON}` });
  await runDaTests({ bname, btype, devices, url, check, sub: SUB, init: `${lineInit(SUB)}; ${DRAGON}` });
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${SUB} FS-07 舊測試照跑：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
