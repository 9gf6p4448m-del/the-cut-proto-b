// 幽光美術 v2 線上檢查補充：正式素材是否載入完成（__art.ready）。用法：node tests/browser/live_check_art_ready.mjs <網址>
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true });
await p.goto(process.argv[2] + '?only=cut&t=3.3'); await p.waitForFunction(() => window.__art && window.__art.ready, null, { timeout: 30000 }); await p.waitForTimeout(800);
console.log('ready', await p.evaluate(() => window.__art.ready), 'err', JSON.stringify(await p.textContent('#err'))); await p.screenshot({ path: '.tmp/live_v2_cut.png' }); await b.close();
