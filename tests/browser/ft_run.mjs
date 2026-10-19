// duel v0.6 FT-03～07 瀏覽器驗收：node tests/browser/ft_run.mjs（需先 node tools/build.mjs；DUEL_SUB 預設 duel6）。作者測試；模擬，不是實機。
// FT_ONLY=chromium 只跑一種瀏覽器；FT_SECTIONS=03,05 只跑指定條目（03／04／05／06／07）。單進程、依序執行（沒有平行 worker）。
// FT-06 的 (a)(c) 只在 chromium 跑（Playwright 的 WebKit 不支援 clipboard-read 權限）；(b) 兩種瀏覽器都跑。
import { chromium, webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
import { runFtTests } from './ft_tests.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const SUB = process.env.DUEL_SUB ?? 'duel6';
const sections = process.env.FT_SECTIONS ? process.env.FT_SECTIONS.split(',').map((x) => x.trim()) : null;
const { srv, url } = await serve(process.cwd());
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => !process.env.FT_ONLY || n === process.env.FT_ONLY)) {
  await runFtTests({ bname, btype, devices, url, check, sub: SUB, sections });
}
srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${SUB} FT-03～07 瀏覽器測試：${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
