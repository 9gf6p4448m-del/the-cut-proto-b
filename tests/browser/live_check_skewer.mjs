// 串刺部署檢查（作者測試；模擬，不是實機）：子路徑 HTTPS、版本 SHA、「研究片段」字樣、自己的 service worker（scope＝core-skewer/）、
// 畫線模式以真實拖曳打完示例甲路線甲-2（第 3 回合勝、玩家剩 14），點選模式完成一刀。用法：node tests/browser/live_check_skewer.mjs <網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage } from './exp_tests.mjs';
import { boardById } from '../../src/skewer/boards.ts';
import { organPos } from '../../src/skewer/rules.ts';
const URL = process.argv[2], SHA = process.argv[3];
const HEART_LINE = { '500,430': [500, 330, 500, 530], '600,560': [500, 460, 700, 660], '500,660': [400, 660, 600, 660], '400,560': [300, 560, 500, 560] };
const heartLine = (t) => HEART_LINE[organPos(boardById('A').organs.find((o) => o.id === 'heart'), t).join(',')];
const A2 = [heartLine(1), [250, 370, 750, 490], heartLine(3)];
const idle = (page) => page.waitForFunction(() => ['IDLE', 'END'].includes(window.__skewer.ui), null, { timeout: 8000 });
async function drag(page, l) {
  const a = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[0], l[1]]);
  const b = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[2], l[3]]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up();
}
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const text = await page.evaluate(() => document.body.innerText);
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'no-sw-api'; const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r ? r.scope : 'timeout'; });
  await page.evaluate(() => { window.__skewer.setSkip(true); window.__skewer.newGame('A', 'draw'); });
  for (const l of A2) { await drag(page, l); await page.click('#confirm'); await idle(page); }
  const draw = await page.evaluate(() => ({ r: window.__skewer.state.result, t: window.__skewer.state.turn, p: window.__skewer.state.hpP }));
  await page.evaluate(() => window.__skewer.newGame('A', 'pick'));
  const n = await page.evaluate(() => window.__skewer.cands().length);
  await page.click('#cand0'); await page.click('#confirm'); await idle(page);
  const pickTurn = await page.evaluate(() => window.__skewer.state.turn);
  const drawOk = draw.r === 'win' && draw.t === 3 && draw.p === 14;
  const ok = URL.startsWith('https://') && sha === SHA && text.includes(SHA) && text.includes('研究片段') && typeof sw === 'string' && sw.endsWith('/core-skewer/')
    && drawOk && n >= 3 && n <= 5 && pickTurn === 2 && page.__errs.length === 0 && bad.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${sha} swScope=${sw} draw=${JSON.stringify(draw)} pickCands=${n} pickTurn=${pickTurn} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
