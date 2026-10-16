import { webkit, devices } from 'playwright';
import { serve } from './serve.mjs';
const out = process.argv[2];
const { srv, url } = await serve(process.cwd());
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url + '/');
const n = await page.evaluate(() => window.__proto.state.board.anchors.length);
let done = false;
for (let i = 0; i < n && !done; i++) for (let j = i + 2; j < n && !done; j++) {
  const A = await page.evaluate((k) => window.__proto.anchorScreen(k), i), B = await page.evaluate((k) => window.__proto.anchorScreen(k), j);
  await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 4 }); await page.mouse.move(B.x, B.y, { steps: 4 }); await page.mouse.up();
  const ok = await page.evaluate(() => !document.getElementById('confirm').disabled && window.__proto.ui === 'PENDING');
  if (ok) { done = true; await page.screenshot({ path: `${out}_pending.png` }); await page.click('#confirm'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}_anim.png` }); await page.waitForTimeout(900); await page.screenshot({ path: `${out}_after.png` }); }
  else { await page.click('#cancel').catch(() => {}); }
}
console.log(JSON.stringify({ errs, done, round: await page.evaluate(() => window.__proto.state.round) }));
await b.close(); srv.close();
