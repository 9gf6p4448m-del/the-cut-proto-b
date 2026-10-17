// duel v0.2 美術合併（duel2/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/DUEL_ART_V02.md DA-03～07（瀏覽器部分）。流程類（征途、縫合、可讀性、版面）由 cb_tests.mjs 以 sub='duel2' 照跑。
import { mkdirSync, readFileSync } from 'node:fs';
import { newPage } from './exp_tests.mjs';
import { greedyLine } from '../cb_stats.ts';
import { candidates, resolveStrike } from '../../src/rtcut/rules.ts';

const D = (page) => page.evaluate(() => { const c = window.__cb; return { ui: c.ui, game: c.game, camp: c.camp, preview: c.preview, last: c.lastStrike, centers: c.spriteCenters, ready: c.assetsReady }; });
async function scr(page, p) { return page.evaluate(([x, y]) => window.__cb.toScreen(x, y), p); }
async function dragTo(page, a, b, release = true) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 6, A.y + ((B.y - A.y) * k) / 6);
  if (release) await page.mouse.up();
}
const ready = (page) => page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 40000 });

export async function runDaTests({ bname, btype, devices, url, check, shotDir }) {
  const browser = await btype.launch();
  const tag = `[${bname}][duel2]`;
  const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
  await page.goto(url + '/duel2/'); await ready(page);
  await page.evaluate(() => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: 0.05 }); window.__cb.newRun({ seed: 4 }); });
  await page.waitForTimeout(400);

  // ===== DA-05 素材載入：全部成功；失敗時顯示可重試的錯誤，不整頁空白 =====
  {
    const log = await page.evaluate(() => window.__cb.loadLog);
    const urls = ['body', 'claw', 'heart', 'eye', 'poison', 'bone'].map((k) => `./assets/final/${k}.png`);
    const okAll = urls.every((u) => log.some((x) => x.url === u && x.ok));
    // 失敗路徑：攔截 body.png（含重試）→ 錯誤提示可見、畫面不空白；放行後按「重試載入」成功
    // service worker 會讓第 2 次以後的請求繞過 page.route，所以這個情境封鎖 SW，確保 3 次都失敗
    const c2 = await browser.newContext({ ...(bname === 'webkit' ? devices['iPhone 14 Pro'] : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }), viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    const p2 = await c2.newPage();
    await p2.route('**/assets/final/body.png*', (r) => r.abort());
    await p2.goto(url + '/duel2/');
    await p2.waitForFunction(() => !document.getElementById('loadErr').hidden, null, { timeout: 20000 });
    const err = await p2.evaluate(() => ({ msg: document.getElementById('loadMsg').textContent, retryVisible: (() => { const r = document.getElementById('retry').getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.bottom <= innerHeight; })(), top: document.getElementById('top').innerText.length, attempts: window.__cb.loadLog.filter((x) => x.url.endsWith('body.png')).length }));
    const debugShown = await p2.evaluate(() => document.getElementById('loadLog').textContent.includes('[DEBUG-artkit]'));
    await p2.unroute('**/assets/final/body.png*');
    await p2.click('#retry');
    await p2.waitForFunction(() => window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 20000 });
    const recovered = await p2.evaluate(() => document.getElementById('loadErr').hidden);
    await c2.close();
    // 只有第一次失敗（iOS 4G 單次失敗的情境）：重試後照常載入、body.png 請求 ≥2 次、不出現錯誤提示
    const c5 = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
    const p5 = await c5.newPage(); let bodyReq = 0;
    await p5.route('**/assets/final/body.png*', (r) => (++bodyReq === 1 ? r.abort() : r.continue()));
    await p5.goto(url + '/duel2/');
    await p5.waitForFunction(() => window.__cb && window.__cb.assetsReady && !!window.__cb.camp, null, { timeout: 20000 });
    const once = { req: bodyReq, errHidden: await p5.evaluate(() => document.getElementById('loadErr').hidden) };
    await c5.close();
    check(`${tag} DA-05 單次失敗：body.png 第 1 次失敗後重試成功（請求 ${once.req} 次）、不出現錯誤提示`, once.req >= 2 && once.errHidden, JSON.stringify(once));
    check(`${tag} DA-05 素材載入：正式素材 6 張全部成功；body.png 失敗時（重試 ${err.attempts} 次）顯示錯誤與「重試載入」、畫面不空白，重試後恢復`,
      okAll && err.msg.includes('素材載入失敗') && err.retryVisible && err.top > 10 && err.attempts >= 3 && recovered && debugShown, `${okAll ? '6/6 載入' : '有素材沒載入'}｜${err.msg}`);
  }

  // ===== DA-04 對齊：讀畫面像素量器官 sprite 實際中心 vs 規則座標（≤2 CSS px）；觸控換算：刀線端點＝手指位置；刀線預覽命中＝結算命中（≥10 條實拖） =====
  // 量測位置＝使用者看到的像素：測試模式下只畫一個器官（黑底），讀整張畫布，取「亮像素」（RGB 和 >300：雙層描邊環與器官圖本體，排除淡光暈）外框的中心；環是以器官中心對稱的圓，器官圖若偏離中心會撐大外框而被量到。
  {
    const bad = []; let n = 0, maxErr = 0, checked = 0, maxTouch = 0;
    const pixelCenter = (id) => page.evaluate(async (oid) => {
      window.__cb.isolate(oid);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cv = document.getElementById('scene'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const k = (y * cv.width + x) * 4; if (d[k] + d[k + 1] + d[k + 2] > 300) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      window.__cb.isolate(null);
      const r = cv.getBoundingClientRect(), sx = r.width / cv.width, sy = r.height / cv.height;
      return x1 < 0 ? null : { x: r.left + ((x0 + x1 + 1) / 2) * sx, y: r.top + ((y0 + y1 + 1) / 2) * sy };
    }, id);
    const alignCheck = async (max = 99) => {
      const s = await D(page); let k = 0;
      for (const [i, o] of s.game.organs.entries()) {
        if (!s.game.alive[i] || k++ >= max) continue;
        const c = await pixelCenter(o.id); if (!c) { bad.push(`${o.id} 畫面上找不到`); continue; }
        const q = await scr(page, o.p), e = Math.hypot(c.x - q.x, c.y - q.y);
        maxErr = Math.max(maxErr, e); checked++; if (e > 2) bad.push(`${o.id} 像素中心誤差 ${e.toFixed(2)}px`);
      }
    };
    await alignCheck();
    for (let g = 0; g < 4 && n < 12; g++) {
      await page.evaluate((sd) => window.__cb.newRun({ seed: sd }), 40 + g); await page.waitForTimeout(80);
      for (let k = 0; k < 8 && n < 12; k++) {
        const s = await D(page); if (s.ui !== 'cut') break;
        if (s.game.cdUntil.blue > s.game.step) { await page.evaluate((m) => window.__cb.advance(m), s.game.cdUntil.blue - s.game.step); continue; }
        const cs = candidates(s.game, 'blue').filter((l) => resolveStrike(s.game, 'blue', l).ok);
        const l = k % 2 ? greedyLine(s.game) ?? cs[0] : cs[(n * 53) % cs.length];
        const A = await scr(page, l.a), B = await scr(page, l.b);
        await page.mouse.move(A.x, A.y); await page.mouse.down();
        for (let j = 1; j <= 6; j++) await page.mouse.move(A.x + ((B.x - A.x) * j) / 6, A.y + ((B.y - A.y) * j) / 6);
        await page.waitForTimeout(60);
        const pre = await D(page);
        if (n < 3) await alignCheck(4);
        await page.mouse.up();
        await page.evaluate(() => window.__cb.advance(1));
        const post = await D(page); n++;
        const pv = pre.preview, rec = post.last;
        if (!pv || !rec) { bad.push(`#${n} 沒有預覽或結算`); continue; }
        // 觸控換算：結算刀線的起點（世界座標）換回螢幕，要落在手指按下的位置
        const a2 = await scr(page, rec.line.a), te = Math.hypot(a2.x - A.x, a2.y - A.y); maxTouch = Math.max(maxTouch, te);
        if (te > 2) bad.push(`#${n} 刀線起點和手指差 ${te.toFixed(2)}px`);
        const key = (r) => JSON.stringify([r.severed, r.blocked, r.locks]);
        if (key(pv) !== key(rec)) bad.push(`#${n} 預覽 ${key(pv)}≠結算 ${key(rec)}`);
      }
    }
    check(`${tag} DA-04 對齊：器官 sprite 的像素中心與規則座標誤差 ≤2 CSS px、刀線起點＝手指位置；刀線預覽命中＝結算命中（實拖 ${n} 條）`, bad.length === 0 && n >= 10 && checked >= 30, `像素中心最大誤差 ${maxErr.toFixed(2)}px（${checked} 個）、觸控最大誤差 ${maxTouch.toFixed(2)}px｜${bad.slice(0, 3).join('；')}`);
  }

  // ===== DA-03 畫面：三個畫面都由 art-kit 繪製；393×852 截圖與目標圖並排存檔 =====
  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    await page.evaluate(() => { window.__cb.setTimings({ battleScale: 1 }); window.__cb.newRun({ seed: 1 }); });
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.__cb.advance(240));
    const g = (await D(page)).game, l = greedyLine(g);
    await dragTo(page, l.a, l.b, false); await page.waitForTimeout(250);
    await page.screenshot({ path: `${shotDir}/impl_cut_393x852.png` });
    await page.mouse.up(); await page.evaluate(() => window.__cb.advance(1));
    // 打完切割期
    for (let i = 0; i < 300; i++) {
      const s = await D(page); if (s.ui !== 'cut') break;
      if (s.game.cdUntil.blue <= s.game.step) { const q = greedyLine(s.game); if (q) await dragTo(page, q.a, q.b); await page.evaluate(() => window.__cb.advance(1)); }
      else await page.evaluate((m) => window.__cb.advance(m), s.game.cdUntil.blue - s.game.step);
    }
    await page.waitForTimeout(2300); await page.screenshot({ path: `${shotDir}/impl_battle_393x852.png` });
    await page.evaluate(() => window.__cb.setTimings({ battleScale: 0.05 }));
    await page.waitForFunction(() => window.__cb.ui === 'contrib', null, { timeout: 40000 }); await page.click('#contribNext');
    if ((await D(page)).ui === 'pick') {
      await page.click('#pick0'); await page.waitForTimeout(2800);   // 等擊倒演出淡出
      const P = await scr(page, (await D(page)).camp.blueBase[0].p);
      await page.mouse.move(P.x + 40, P.y - 30); await page.mouse.down(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${shotDir}/impl_stitch_393x852.png` }); await page.mouse.up();
    }
    // 並排：目標圖｜實作
    const { ctx: c3, page: p3 } = await newPage(browser, bname, devices, 820, 900);
    for (const k of ['cut', 'battle', 'stitch']) {
      const b64 = (f, mime) => `data:${mime};base64,${readFileSync(f).toString('base64')}`;
      await p3.setContent(`<html><body style="margin:0;background:#070D19;display:flex;gap:10px;padding:10px;font:14px system-ui;color:#AEEAFF">
        <figure style="margin:0"><img src="${b64(`public-artkit/assets/targets/TARGET_${k}.jpg`, 'image/jpeg')}" style="width:393px;height:852px;object-fit:contain;background:#000"><figcaption>目標 TARGET_${k}</figcaption></figure>
        <figure style="margin:0"><img src="${b64(`${shotDir}/impl_${k}_393x852.png`, 'image/png')}" style="width:393px;height:852px"><figcaption>duel2 實作 393×852</figcaption></figure></body></html>`);
      await p3.waitForTimeout(300);
      await p3.screenshot({ path: `${shotDir}/pair_${k}.png`, fullPage: true });
    }
    await c3.close();
    const s = await D(page);
    check(`${tag} DA-03 畫面：切割／戰鬥／縫合由 art-kit 繪製（素材已載入、器官 sprite 已畫）；393×852 截圖與目標圖並排存檔`, s.ready && Object.keys(s.centers).length > 0, `${shotDir}/pair_{cut,battle,stitch}.png`);
  }

  // ===== DA-06 效能：Chromium 4 倍 CPU 節流，切割期 FPS（只回報） =====
  if (bname === 'chromium') {
    const { ctx: c4, page: p4 } = await newPage(browser, bname, devices, 393, 852);
    await p4.goto(url + '/duel2/'); await ready(p4);
    await p4.evaluate(() => window.__cb.newRun({ seed: 6 }));
    const cdp = await c4.newCDPSession(p4); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p4.waitForTimeout(1500);
    const fps = await p4.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 5000) requestAnimationFrame(f); else res((n * 1000) / (t - t0)); }; requestAnimationFrame(f); }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await c4.close();
    check(`${tag} DA-06 效能（只回報）：393×852、4 倍 CPU 節流、切割期 ${fps.toFixed(1)} FPS（目標 ≥24）`, true, `${fps.toFixed(1)} FPS${fps < 24 ? '（未達 24，見作者證據的降級措施）' : ''}`);
  }
  check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
  await ctx.close(); await browser.close();
}
