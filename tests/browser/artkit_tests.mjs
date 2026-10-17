// 幽光美術展示頁（art-kit/）瀏覽器測試（作者測試；WebKit＋Chromium 模擬，不是 iPhone 實機）。
// 重現製作人回報（2026-10-18 iOS 4G：「素材載入失敗：./assets/final/body.png」、實作欄空白）：素材請求單次失敗時頁面必須自動重試並載入成功；
// 全部重試都失敗時要顯示失敗細節（[DEBUG-artkit]）與「重新載入」「改用暫代素材」兩個按鈕，而不是整片空白。

// route 情境封鎖 service worker：SW 接手後的請求不經過 Playwright 的頁面路由，攔不到就驗不到重試（測試本身會空轉）
async function open(btype, bname, devices, url, route) {
  const b = await btype.launch();
  const opt = bname === 'webkit' ? { ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 } } : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const ctx = await b.newContext({ ...opt, serviceWorkers: route ? 'block' : 'allow' }); const page = await ctx.newPage(); page.__errs = []; page.on('pageerror', (e) => page.__errs.push(String(e)));
  if (route) await route(page);
  await page.goto(url + '/art-kit/?only=cut&t=3.3');
  await page.waitForFunction(() => (window.__art && window.__art.ready) || (document.getElementById('err').textContent || '').length > 0, null, { timeout: 40000 });
  return { b, ctx, page };
}
export async function runArtKitTests({ bname, btype, devices, url, check }) {
  const tag = `[${bname}][art]`;
  { const { b, page } = await open(btype, bname, devices, url);
    check(`${tag} 正式素材載入完成、無頁面錯誤`, await page.evaluate(() => window.__art.ready) && page.__errs.length === 0, page.__errs.join('|')); await b.close(); }
  { // body.png 第一次請求中斷（模擬 4G 單次失敗）→ 應自動重試並成功
    let n = 0; const { b, page } = await open(btype, bname, devices, url, (p) => p.route('**/assets/final/body.png*', (r) => (n++ === 0 ? r.abort('failed') : r.continue())));
    const st = await page.evaluate(() => ({ ready: window.__art.ready, err: document.getElementById('err').textContent }));
    check(`${tag} 素材單次載入失敗會自動重試並成功（請求 ${n} 次）`, st.ready === true && st.err === '' && n >= 2, JSON.stringify(st)); await b.close(); }
  { // body.png 每次都失敗 → 顯示細節＋重新載入＋改用暫代素材，不是空白
    const { b, page } = await open(btype, bname, devices, url, (p) => p.route('**/assets/final/body.png*', (r) => r.abort('failed')));
    const st = await page.evaluate(() => ({ ready: window.__art.ready, err: document.getElementById('err').innerText, btns: [...document.querySelectorAll('#err button')].map((x) => x.textContent) }));
    check(`${tag} 素材全部重試失敗：顯示 [DEBUG-artkit] 細節與「重新載入」「改用暫代素材」按鈕`, !st.ready && st.err.includes('[DEBUG-artkit]') && st.err.includes('body.png') && st.btns.includes('重新載入') && st.btns.includes('改用暫代素材'), JSON.stringify(st)); await b.close(); }
}
