// 部署檢查（作者測試；模擬，不是實機）：HTTPS 首頁、資產、版本 SHA、service worker、實際切一刀。
import { chromium, webkit, devices } from 'playwright';
const URL = process.argv[2], SHA = process.argv[3];
let fail = 0;
for (const [name, bt] of [['webkit-iPhone14Pro', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const ctx = await b.newContext(name.startsWith('webkit') ? { ...devices['iPhone 14 Pro'] } : {});
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  const sha = await page.textContent('#sha');
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready.then(() => 'ready'), new Promise((x) => setTimeout(() => x('timeout'), 8000))]); return r; });
  const n = await page.evaluate(() => window.__proto.state.board.anchors.length);
  let cut = false;
  for (let i = 0; i < n && !cut; i++) for (let j = i + 2; j < n && !cut; j++) {
    const A = await page.evaluate((k) => window.__proto.anchorScreen(k), i), B = await page.evaluate((k) => window.__proto.anchorScreen(k), j);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 5 }); await page.mouse.up();
    if (await page.evaluate(() => window.__proto.ui === 'PENDING' && !document.getElementById('confirm').disabled)) { await page.click('#confirm'); await page.waitForTimeout(1500); cut = await page.evaluate(() => window.__proto.state.round === 2 || window.__proto.ui === 'END'); }
    else if (await page.evaluate(() => window.__proto.ui === 'PENDING')) await page.click('#cancel');
  }
  const ok = URL.startsWith('https://') && sha === SHA && errs.length === 0 && bad.length === 0 && sw === 'ready' && cut;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${sha} sw=${sw} cut=${cut} errs=${errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
