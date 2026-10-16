// 瀏覽器自動測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）：
// T-2 golden、T-8 前端不寫引擎物件、T-9 演出不改結果、T-10 取消／誤操作、T-11 重開、T-12 旋轉與重載、
// T-13 可讀性與觸控目標、T-14 版本與警告、T-15①～③ PWA；並匯出每局紀錄供 Node 的 T-5 跨環境重算。
import { chromium, webkit, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

const GOLDEN_SHA = '112d879b4a6bbaabf48bfee7fd8425f9301445ff4e00832533200362e727be74';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
mkdirSync('test-output/logs', { recursive: true });

const { srv, url } = await serve(process.cwd());
const shaBuilt = readFileSync('dist/index.html', 'utf8').match(/name="build-sha" content="([^"]+)"/)[1];

async function dragCut(page, i, j) {
  const A = await page.evaluate((k) => window.__proto.anchorScreen(k), i), B = await page.evaluate((k) => window.__proto.anchorScreen(k), j);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  await page.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 3 }); await page.mouse.move(B.x, B.y, { steps: 3 }); await page.mouse.up();
}
/** 依固定順序找第一條合法線（只看 UI 的確認鈕是否可用；不呼叫規則函式）。 */
async function findLegal(page) {
  const n = await page.evaluate(() => window.__proto.state.board.anchors.length);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    await dragCut(page, i, j);
    if (await page.evaluate(() => window.__proto.ui === 'PENDING' && !document.getElementById('confirm').disabled)) return [i, j];
    if (await page.evaluate(() => window.__proto.ui === 'PENDING')) await page.click('#cancel');
  }
  return null;
}
async function waitIdleOrEnd(page) { await page.waitForFunction(() => ['IDLE', 'END'].includes(window.__proto.ui), null, { timeout: 5000 }); }
async function playToEnd(page, skip) {
  await page.evaluate((v) => window.__proto.setSkip(v), skip);
  const cuts = [];
  for (let r = 0; r < 12; r++) {
    if (await page.evaluate(() => window.__proto.ui === 'END')) break;
    const c = await findLegal(page); if (!c) break;
    cuts.push(c); await page.click('#confirm'); await waitIdleOrEnd(page);
    await page.evaluate(() => { document.getElementById('review').hidden = true; });
  }
  return { cuts, hash: await page.evaluate(() => window.__proto.stateHash(window.__proto.state)), log: await page.evaluate(() => window.__proto.log) };
}

for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await btype.launch();
  // ---- T-2 golden ----
  {
    const page = await browser.newPage();
    await page.goto(url + '/dist-test/blank.html').catch(() => {});
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ path: 'dist-test/golden_browser.js' });
    const text = readFileSync('golden/golden_vectors.json', 'utf8');
    const r = await page.evaluate((t) => window.__runGolden(t), text);
    check(`[${bname}] T-2 golden 200/200 且檔案 SHA 相符`, r.ok === 200 && r.total === 200 && r.fileSha256 === GOLDEN_SHA, `${r.ok}/${r.total} ${r.fileSha256.slice(0, 12)}`);
    await page.close();
  }
  const ctx = await browser.newContext(bname === 'webkit' ? { ...devices['iPhone 14 Pro'] } : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  // ---- T-14 版本與警告 ----
  await page.goto(url + '/?devfreeze=1');
  const top = await page.textContent('#top');
  check(`[${bname}] T-14 常駐警告、模式、版本 SHA`, top.includes('研究原型（非正式規則、非 Gate 證據）') && top.includes(shaBuilt) && (await page.isVisible('#banner3')), `sha ${shaBuilt}`);
  // ---- T-10 誤操作與取消 ----
  const h0 = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  const box = await page.locator('#board').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 3 }); await page.mouse.up();
  const t10a = await page.evaluate(() => window.__proto.ui);
  const A0 = await page.evaluate(() => window.__proto.anchorScreen(0));
  await page.mouse.move(A0.x, A0.y); await page.mouse.down(); await page.mouse.move(A0.x + 3, A0.y + 3); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 }); await page.mouse.up();
  const t10b = await page.evaluate(() => window.__proto.ui);
  const c1 = await findLegal(page);
  await page.click('#cancel');
  const h1 = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  check(`[${bname}] T-10 起點不在錨點、放開在空處、確認前取消：狀態不變`, t10a === 'IDLE' && t10b === 'IDLE' && !!c1 && h0 === h1 && (await page.evaluate(() => window.__proto.ui)) === 'IDLE');
  // ---- T-9 演出不改結果（同 seed、同切法，跳過 vs 正常）＋ T-8 devfreeze 下全程無 TypeError ----
  const runA = await playToEnd(page, true);
  writeFileSync(`test-output/logs/${bname}_exp3_a.json`, JSON.stringify(runA.log));
  await page.click('#retry');
  const hRetry = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  check(`[${bname}] T-11 重開：新局等於同 seed 開局`, hRetry === h0);
  await page.evaluate(() => window.__proto.setSkip(false));
  for (const [i, j] of runA.cuts) {
    if (await page.evaluate(() => window.__proto.ui === 'END')) break;
    await dragCut(page, i, j); await page.click('#confirm'); await waitIdleOrEnd(page);
    await page.evaluate(() => { document.getElementById('review').hidden = true; });
  }
  const hB = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  check(`[${bname}] T-9 跳過演出與正常演出最終 stateHash 相同`, hB === runA.hash, `${runA.cuts.length} 刀`);
  check(`[${bname}] T-8 devfreeze 下全程無頁面錯誤`, errs.length === 0, errs.join(' | '));
  // ---- 六器官研究模式一局（供 T-5）＋ 模式標示 ----
  await page.evaluate(() => window.__proto.setMode('research6'));
  const research = await playToEnd(page, true);
  writeFileSync(`test-output/logs/${bname}_res6.json`, JSON.stringify(research.log));
  check(`[${bname}] 研究模式紀錄帶 format／fork／protoMode`, research.log.format === 'thecut-protoB-log/1' && research.log.fork === 'proto-b' && research.log.protoMode === 'research6' && runA.log.protoMode === 'experience3');
  check(`[${bname}] 研究模式不顯示三器官警告`, !(await page.isVisible('#banner3')));
  // ---- T-13 可讀性（三種尺寸） ----
  for (const [w, h] of [[393, 852], [430, 932], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(100);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent, w: r.width, h: r.height, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
    const small = boxes.filter((b) => b.w < 44 || b.h < 44);
    const overlap = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) { const p = boxes[a], q = boxes[b]; if (p.x < q.r - 1 && q.x < p.r - 1 && p.y < q.b - 1 && q.y < p.b - 1) overlap.push(`${p.id}/${q.id}`); }
    const out = boxes.filter((b) => b.x < 0 || b.y < 0 || b.r > w + 1 || b.b > h + 1);
    check(`[${bname}] T-13 ${w}×${h}：按鈕 ≥44px、不重疊、不出界`, small.length === 0 && overlap.length === 0 && out.length === 0, JSON.stringify({ small: small.map((s) => s.id), overlap, out: out.map((s) => s.id) }));
  }
  // ---- T-12 旋轉與重載 ----
  await page.setViewportSize({ width: 852, height: 393 }); await page.waitForTimeout(100);
  const land = await page.locator('#board').boundingBox();
  await page.setViewportSize({ width: 393, height: 852 }); await page.waitForTimeout(100);
  await page.reload(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ ui: window.__proto.ui, round: window.__proto.state.round }));
  check(`[${bname}] T-12 橫直切換不出界、重載回到開局`, land && land.x >= 0 && land.y >= 0 && land.x + land.width <= 853 && after.ui === 'IDLE' && after.round === 1);
  await ctx.close(); await browser.close();
}

// ---- T-15①～③ PWA（Chromium；localhost 視為安全來源） ----
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url + '/');
  const man = await page.evaluate(async () => { const r = await fetch('./manifest.webmanifest'); const j = await r.json(); const icons = await Promise.all(j.icons.map((i) => fetch(i.src).then((x) => x.ok))); const apple = await fetch('./icon-180.png').then((x) => x.ok); return { ok: r.ok, display: j.display, start: j.start_url, icons, apple }; });
  // 回歸：第一次造訪（service worker 首次安裝）不得重新載入頁面、打斷對局
  {
    const c2 = await browser.newContext(); const p2 = await c2.newPage(); let navs = 0;
    p2.on('framenavigated', (f) => { if (f === p2.mainFrame()) navs++; });
    await p2.goto(url + '/'); await p2.evaluate(() => navigator.serviceWorker.ready); await p2.waitForTimeout(1500);
    check('T-15 回歸：首次安裝 service worker 不重新載入頁面', navs === 1, `navigations=${navs}`);
    await c2.close();
  }
  check('T-15① manifest 合法、圖示可取得、有 180×180 apple-touch-icon', man.ok && man.display === 'standalone' && man.icons.every(Boolean) && man.apple);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForTimeout(300);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  let offlineOk = false;
  try { await page.reload(); offlineOk = (await page.evaluate(() => window.__proto && window.__proto.state.round)) === 1; } catch { offlineOk = false; }
  await ctx.setOffline(false);
  check('T-15② service worker 註冊並控制頁面、離線可重開', controlled && offlineOk);
  // ③ 更新：改寫 dist 的版本 SHA 模擬新部署，重開後應顯示新 SHA
  const files = ['dist/index.html', 'dist/sw.js'];
  const orig = files.map((f) => readFileSync(f, 'utf8'));
  files.forEach((f, k) => writeFileSync(f, orig[k].replaceAll(shaBuilt, 'zzzzzzz')));
  await page.reload(); await page.waitForTimeout(800); await page.reload(); await page.waitForTimeout(300);
  const shown = await page.textContent('#sha').catch(() => '');
  const metaSha = await page.getAttribute('meta[name="build-sha"]', 'content');
  files.forEach((f, k) => writeFileSync(f, orig[k]));
  check('T-15③ 部署新版後重開即取得新版（不卡舊快取）', metaSha === 'zzzzzzz', `meta=${metaSha} 畫面=${shown}`);
  await browser.close();
}
srv.close();
writeFileSync('test-output/browser_results.json', JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
