// FUN-EXP-01 部署檢查（作者測試；模擬，不是實機）：實驗版子路徑 HTTPS、版本 SHA、自己的 service worker（scope＝子路徑）、
// 四個模式（BASELINE／A1／A2／B）各實際切一刀並確認結算；B 另外勾一次「留下傷口」。用法：node tests/browser/live_check_exp.mjs <實驗版網址> <SHA>
import { chromium, webkit, devices } from 'playwright';
import { newPage, selectMode, drag, waitIdleOrEnd } from './exp_tests.mjs';
const URL = process.argv[2], SHA = process.argv[3];
let fail = 0;
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const { page } = await newPage(b, name, devices, 393, 852);
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  const shaBuilt = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-api';
    const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]);
    return r ? r.scope : 'timeout';
  });
  const res = {};
  for (const m of ['BASELINE', 'A1', 'A2', 'B']) {
    await selectMode(page, m, '1');
    const n = await page.evaluate(() => window.__proto.state.board.anchors.length);
    let done = false, kept = false;
    for (let i = 0; i < n && !done; i++) for (let j = i + 2; j < n && !done; j++) {
      await drag(page, i, j);
      const st = await page.evaluate(() => ({ ui: window.__proto.ui, dis: document.getElementById('confirm').disabled, keep: !!document.querySelector('#keepRow input:not([disabled])') && !document.getElementById('keepRow').hidden }));
      if (st.ui === 'PENDING' && !st.dis && (m !== 'B' || st.keep)) {
        if (m === 'B') { await page.click('#keepRow label'); kept = true; }
        await page.click('#confirm'); await waitIdleOrEnd(page);
        done = await page.evaluate(() => window.__proto.state.round >= 2 || window.__proto.ui === 'END');
      } else if (st.ui === 'PENDING') await page.click('#cancel');
    }
    const wound = m === 'B' ? await page.evaluate(() => !!window.__proto.state.wound) : null;
    res[m] = done && (m !== 'B' || (kept && wound));
  }
  const ok = URL.startsWith('https://') && shaBuilt === SHA && top.includes(SHA) && top.includes('實驗版') && page.__errs.length === 0 && bad.length === 0
    && typeof sw === 'string' && sw.endsWith('/fun-exp-01/') && Object.values(res).every(Boolean);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] https=${URL.startsWith('https://')} sha=${shaBuilt} swScope=${sw} modes=${JSON.stringify(res)} errs=${page.__errs.length} bad=${bad.join(',')}`);
  await b.close();
}
process.exit(fail ? 1 : 0);
