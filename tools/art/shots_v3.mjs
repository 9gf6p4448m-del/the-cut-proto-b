// art-kit v3 截圖（Chromium 無頭、393×852、dpr 2）：?only=cut|battle|feel 與整頁器官區塊，凍結時間 ?t=。用法：node tools/art/shots_v3.mjs <輸出資料夾>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serve } from '../../tests/browser/serve.mjs';

const OUT = process.argv[2] ?? 'test-output/art-v3'; mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve(process.cwd());
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
for (const [q, name] of [['?only=cut&t=0.5', 'cut_hold'], ['?only=cut&t=0.9', 'cut_swipe'], ['?only=cut&t=1.15', 'cut_split'], ['?only=cut&t=2.5', 'cut_after'], ['?only=battle&t=3.3', 'battle'], ['?only=feel&t=1.6', 'feel'], ['?only=organs&t=0.55', 'organs']]) {
  await p.goto(`${url}/art-kit/${q}`); await p.waitForFunction(() => window.__art && window.__art.ready, null, { timeout: 60000 }); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${name}.png` });
}
console.log(`截圖 → ${OUT}；頁面錯誤 ${errs.length}${errs.length ? '：' + errs.join('|') : ''}`);
await b.close(); srv.close();
