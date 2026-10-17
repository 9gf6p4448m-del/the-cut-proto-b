// 幽光美術模組部署檢查（作者測試；模擬，不是實機）：HTTPS、版本 SHA、SW scope＝art-kit/、畫面有在動（FPS>0）、無水平捲動、無錯誤與 4xx/5xx。用法：node tests/browser/live_check_art.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
const URL = process.argv[2], SHA = process.argv[3]; let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch(); const ctx = await b.newContext(name === 'webkit' ? { ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 } } : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true });
  const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push(String(e))); p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await p.goto(URL, { waitUntil: 'load' }); await p.waitForTimeout(3000);
  const sha = await p.getAttribute('meta[name="build-sha"]', 'content'), text = await p.evaluate(() => document.body.innerText);
  const sw = await p.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  const fps = await p.evaluate(() => window.__art.fps.value), noHs = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && sw.endsWith('/art-kit/') && fps > 0 && noHs && errs.length === 0 && bad.length === 0;
  if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] sha=${sha} swScope=${sw} fps=${fps.toFixed(1)} noHScroll=${noHs} errs=${errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
