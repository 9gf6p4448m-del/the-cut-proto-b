// 固定入口 play/（DL-092）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。
// 凍結驗收：the-cut docs/fusion/PLAY_LAUNCHER.md（fa22574）PL-01～05、PL-07。PL-06 在 tools/deploy_play.mjs 的演練。
// 自帶伺服器：/the-cut-proto-b/ ＝ origin/gh-pages 的內容（真正上線的 duel4/、duel3/、根 sw.js），/the-cut-proto-b/play/ ＝ public-play/。
// latest.json 可由測試改寫，且刻意回 Cache-Control: max-age=3600（沒用 no-store 的實作會讀到舊值）。
// 用法：node tests/browser/play_tests.mjs   （環境變數 PLAY_DIR 可換外殼目錄，突變測試用）
import { chromium, webkit, devices } from 'playwright';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { newPage } from './exp_tests.mjs';
import { PLAN } from './df_tests.mjs';

const PLAY = process.env.PLAY_DIR || 'public-play';
const BASE = '/the-cut-proto-b/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const pages = mkdtempSync(join(tmpdir(), 'play-pages-'));
const ghSha = execSync('git rev-parse --short=7 origin/gh-pages').toString().trim();
execSync(`git archive origin/gh-pages | tar -x -C "${pages.replace(/\\/g, '/')}"`, { shell: 'bash' });
const DEFAULT_LATEST = readFileSync(join(PLAY, 'latest.json'), 'utf8');
let latestBody = DEFAULT_LATEST, latestStatus = 200, latestHits = 0;
const setLatest = (o, status = 200) => { latestBody = typeof o === 'string' ? o : JSON.stringify(o); latestStatus = status; };
const L4 = JSON.parse(DEFAULT_LATEST);
const L3 = { version: '0.3', label: 'v0.3 手感（測試用新版）', sub: 'duel3', sha: 'test', history: [{ label: 'v0.4 前線推進', sub: 'duel4' }] };

const srv = createServer((req, rsp) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!p.startsWith(BASE)) { rsp.writeHead(404); return rsp.end(); }
  let rel = p.slice(BASE.length);
  if (rel === 'play/latest.json') { latestHits++; rsp.writeHead(latestStatus, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' }); return rsp.end(latestBody); }
  let root = pages;
  if (rel === 'play' || rel.startsWith('play/')) { root = PLAY; rel = rel.slice(5); }
  let file = normalize(join(root, rel));
  if (!file.startsWith(normalize(root))) { rsp.writeHead(403); return rsp.end(); }
  try {
    if (statSync(file).isDirectory()) { if (!p.endsWith('/')) { rsp.writeHead(301, { location: p + '/' }); return rsp.end(); } file = join(file, 'index.html'); }
    const b = readFileSync(file); rsp.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); rsp.end(b);
  } catch { rsp.writeHead(404); rsp.end('not found'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`, PLAYURL = ORIGIN + BASE + 'play/';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
// 區塊中途丟例外（例：點不到更新條、等不到指定版本）＝該區塊 FAIL 並繼續跑下一塊，不讓整支當掉而吃掉後面的判定（突變驗紅要紅在判定上）。
const guard = async (label, fn) => { try { await fn(); } catch (e) { check(`${label} 區塊中途例外`, false, String(e && e.message).split('\n')[0]); } };
const NO_TUT = "try { localStorage.setItem('duel4-tutorial', 'done'); localStorage.setItem('duel3-tutorial', 'done'); } catch (e) {}";
const THROW = "Storage.prototype.getItem = function () { throw new Error('storage blocked'); }; Storage.prototype.setItem = function () { throw new Error('storage blocked'); };";
const gameFrame = async (page) => (await page.$('#game')).contentFrame();
const ready = async (page, sub) => {
  await page.waitForFunction((s) => { const f = document.getElementById('game'); try { return f.src.endsWith('/' + s + '/') && f.contentWindow.location.pathname.endsWith('/' + s + '/') && !!f.contentWindow.__cb; } catch (e) { return false; } }, sub, { timeout: 30000 });
  const fr = await gameFrame(page);
  await fr.waitForFunction(() => window.__cb && (!('assetsReady' in window.__cb) || window.__cb.assetsReady), null, { timeout: 30000 });
  return fr;
};
const vis = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const srcOf = (page) => page.evaluate(() => document.getElementById('game').src);
const barOn = (page) => page.evaluate(() => { const b = document.getElementById('updBar'); return getComputedStyle(b).display !== 'none' ? b.textContent : null; });
const settleFetch = async (page, n0) => { for (let i = 0; i < 40 && latestHits <= n0; i++) await page.waitForTimeout(50); await page.waitForTimeout(150); };
const shotDir = 'test-output/play_shots'; mkdirSync(shotDir, { recursive: true });

for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await btype.launch();
  const tag = `[${bname}][play]`;
  const open = async (w = 393, h = 852, init = [NO_TUT]) => { const { ctx, page } = await newPage(browser, bname, devices, w, h); for (const s of init) await ctx.addInitScript(s); await page.goto(PLAYURL); return { ctx, page }; };

  // ===== PL-01 載入 latest.json 指定的子路徑 =====
  await guard(`${tag} PL-01`, async () => {
    setLatest(L4);
    const { ctx, page } = await open();
    const fr = await ready(page, 'duel4');
    const src = await srcOf(page);
    const box = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
    await fr.waitForFunction(() => !!window.__cb.camp, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const px = await fr.evaluate(() => { const c = document.getElementById('scene'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 64) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return { n, of: d.length / 64 }; });
    await page.screenshot({ path: `${shotDir}/${bname}_load_393x852.png` });
    check(`${tag} PL-01 iframe src＝latest.sub（${src.replace(ORIGIN, '')}）、遊戲就緒、畫布有內容（亮像素 ${px.n}/${px.of}）、iframe 鋪滿視窗 ${box.w}×${box.h}`,
      src === ORIGIN + BASE + 'duel4/' && px.n > px.of * 0.02 && box.x === 0 && box.y === 0 && box.w === box.iw && box.h === box.ih && page.__errs.length === 0, JSON.stringify({ box, errs: page.__errs }));
    await ctx.close();
  });

  // ===== PL-02 有新版才跳條、點了才換 =====
  await guard(`${tag} PL-02`, async () => {
    setLatest(L4);
    const { ctx, page } = await open();
    const fr = await ready(page, 'duel4');
    await fr.evaluate(() => { window.__mark = 42; });
    let n0 = latestHits; await vis(page); await settleFetch(page, n0);
    const a = await barOn(page);
    setLatest(L3);
    n0 = latestHits; await vis(page); await settleFetch(page, n0);
    const b = await barOn(page), srcB = await srcOf(page), mark = await (await gameFrame(page)).evaluate(() => window.__mark);
    await page.waitForTimeout(800);
    const srcB2 = await srcOf(page), mark2 = await (await gameFrame(page)).evaluate(() => window.__mark);
    await page.screenshot({ path: `${shotDir}/${bname}_updbar_393x852.png` });
    check(`${tag} PL-02(a) latest 未變時觸發 visibilitychange 不跳條`, a === null && n0 > 0, String(a));
    check(`${tag} PL-02(b) latest 換版後觸發 visibilitychange：跳條「${b}」；點之前 iframe 不變也沒重載`, b !== null && b.includes(L3.label) && srcB === ORIGIN + BASE + 'duel4/' && srcB2 === srcB && mark === 42 && mark2 === 42, JSON.stringify({ srcB, srcB2, mark, mark2 }));
    await page.click('#updBar', { timeout: 5000 });
    await ready(page, 'duel3');
    const c = await barOn(page), srcC = await srcOf(page);
    check(`${tag} PL-02(c) 點更新條：iframe 換成 duel3、條消失`, srcC === ORIGIN + BASE + 'duel3/' && c === null && page.__errs.length === 0, JSON.stringify({ srcC, c, errs: page.__errs }));
    await ctx.close();
  });

  // ===== PL-03 版本選單 =====
  for (const [w, h] of [[393, 852], [375, 667]]) await guard(`${tag} PL-03(a) ${w}×${h}`, async () => {
    setLatest(L4);
    const { ctx, page } = await open(w, h);
    const fr = await ready(page, 'duel4');
    await fr.waitForFunction(() => !!window.__cb.camp, null, { timeout: 30000 });
    const btn = await page.evaluate(() => { const r = document.getElementById('verBtn').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const hud = await fr.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.tagName === 'CANVAS' || el.tagName === 'MAIN' || el.tagName === 'SCRIPT') continue;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        const isHud = el.id === 'top' || el.tagName === 'BUTTON' || (el.children.length === 0 && el.textContent.trim());
        if (!isHud) continue;
        const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push({ id: el.id || el.tagName, x: r.x, y: r.y, w: r.width, h: r.height });
      }
      return out;
    });
    const hit = hud.filter((r) => r.x < btn.x + btn.w && btn.x < r.x + r.w && r.y < btn.y + btn.h && btn.y < r.y + r.h);
    await page.screenshot({ path: `${shotDir}/${bname}_verbtn_${w}x${h}.png` });
    check(`${tag} PL-03(a) ${w}×${h} 版本鈕 ${btn.w}×${btn.h}、不蓋 HUD（比對 ${hud.length} 個 HUD 元素）`, btn.w >= 44 && btn.h >= 44 && hud.length > 5 && hit.length === 0, JSON.stringify(hit.slice(0, 4)));
    await ctx.close();
  });
  await guard(`${tag} PL-03(b)`, async () => {
    setLatest(L4);
    const { ctx, page } = await open();
    await ready(page, 'duel4');
    await page.click('#verBtn');
    const items = await page.$$eval('#verMenu button', (bs) => bs.map((b) => ({ sub: b.dataset.sub, t: b.textContent })));
    await page.screenshot({ path: `${shotDir}/${bname}_menu_393x852.png` });
    await page.click('#verMenu button[data-sub="duel2"]');
    await ready(page, 'duel2');
    const s1 = await srcOf(page);
    await page.reload(); await ready(page, 'duel2');
    const s2 = await srcOf(page);
    setLatest(L3); await page.reload(); await ready(page, 'duel3');
    const s3 = await srcOf(page);
    const want = [L4.sub, ...L4.history.map((x) => x.sub)];
    check(`${tag} PL-03(b) 選單列出 ${items.map((x) => x.t).join('／')}；切 duel2、重開仍 duel2；latest 換版後重開載新 latest`,
      JSON.stringify(items.map((x) => x.sub)) === JSON.stringify(want) && s1.endsWith('/duel2/') && s2.endsWith('/duel2/') && s3.endsWith('/duel3/') && page.__errs.length === 0, JSON.stringify({ items, s1, s2, s3, errs: page.__errs }));
    await ctx.close();
  });
  await guard(`${tag} PL-03(c)`, async () => {
    setLatest(L4);
    const { ctx, page } = await open(393, 852, [THROW]);
    await ready(page, 'duel4');
    await page.click('#verBtn'); await page.click('#verMenu button[data-sub="duel3"]');
    await ready(page, 'duel3');
    const s = await srcOf(page);
    check(`${tag} PL-03(c) localStorage 一律丟例外：照常載入、選單照常切版、外殼沒有未捕捉例外`, s.endsWith('/duel3/') && page.__errs.length === 0,JSON.stringify({ s, errs: page.__errs.slice(0, 3) }));
    await ctx.close();
  });

  // ===== PL-04 不用 service worker、manifest 正確 =====
  await guard(`${tag} PL-04(a)、PL-04(c)`, async () => {
    setLatest(L4);
    const { ctx, page } = await open();
    const fr = await ready(page, 'duel4');
    await fr.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 5000))]));   // 讓 duel4 自己的 SW 先註冊完（scope＝duel4/）
    const reg = await page.evaluate(async (u) => { const r = await navigator.serviceWorker.getRegistration(u); const all = await navigator.serviceWorker.getRegistrations(); return { play: r ? r.scope : null, all: all.map((x) => x.scope) }; }, PLAYURL);
    const src = readdirSync(PLAY).filter((f) => /\.(html|js)$/.test(f)).map((f) => readFileSync(join(PLAY, f), 'utf8')).join('\n');
    check(`${tag} PL-04(a) play/ 沒有 SW（getRegistration(play/)＝${reg.play}；全部註冊：${reg.all.map((s) => s.replace(ORIGIN, '')).join('、') || '無'}）、原始碼沒有 serviceWorker.register`,
      reg.play === null && !/serviceWorker\s*\.\s*register/.test(src), JSON.stringify(reg));
    const m = await page.evaluate(async () => { const href = document.querySelector('link[rel=manifest]').href; const j = await (await fetch(href)).json(); const icons = await Promise.all([...j.icons.map((i) => new URL(i.src, href).href), document.querySelector('link[rel=apple-touch-icon]').href].map(async (u) => (await fetch(u)).status)); return { j, icons, cap: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content }; });
    check(`${tag} PL-04(c) manifest id/name/display/start_url＝${m.j.id}/${m.j.name}/${m.j.display}/${m.j.start_url}、圖示 ${m.icons.join(',')}、apple-mobile-web-app-capable=${m.cap}`,
      m.j.id === 'thecut-play' && m.j.name === '執刀者' && m.j.display === 'standalone' && m.j.start_url === './' && m.icons.length >= 2 && m.icons.every((s) => s === 200) && m.cap === 'yes');
    await ctx.close();
  });
  await guard(`${tag} PL-04(b)`, async () => {
    setLatest(L4);
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await ctx.addInitScript(NO_TUT);
    await page.goto(ORIGIN + BASE);
    const rootSw = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.scope), new Promise((r) => setTimeout(() => r(null), 8000))]));
    await page.goto(PLAYURL); await ready(page, 'duel4');
    const ctl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    setLatest(L3);
    const n0 = latestHits; await vis(page); await settleFetch(page, n0);
    const b = await barOn(page);
    check(`${tag} PL-04(b) 根 SW 生效（scope ${rootSw && rootSw.replace(ORIGIN, '')}、play/ 的 controller＝${ctl && ctl.replace(ORIGIN, '')}）時仍讀得到新 latest`, rootSw === ORIGIN + BASE && b !== null && b.includes(L3.label), JSON.stringify({ rootSw, ctl, b }));
    await ctx.close();
  });

  // ===== PL-05 不水平捲動、觸控穿得過 iframe =====
  for (const [w, h] of [[393, 852], [375, 667]]) await guard(`${tag} PL-05(a) ${w}×${h}`, async () => {
    setLatest(L4);
    const { ctx, page } = await open(w, h);
    await ready(page, 'duel4');
    const sw = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
    check(`${tag} PL-05(a) ${w}×${h} 外殼不水平捲動（scrollWidth ${sw.sw} ≤ ${sw.iw}）`, sw.sw <= sw.iw);
    await ctx.close();
  });
  await guard(`${tag} PL-05(b)`, async () => {
    setLatest(L4);
    const { ctx, page } = await open();
    const fr = await ready(page, 'duel4');
    await fr.waitForFunction(() => !!window.__cb.camp && window.__cb.ui === 'cut', null, { timeout: 30000 });
    await fr.evaluate(() => window.__cb.skipCountdown());
    await page.waitForTimeout(400);
    // 遊戲即時跑時，合成劃刀要 0.2～1.9 秒，期間 AI 出刀或起點漂移會讓結果不定（直開 duel4、沒有外殼也一樣；定位紀錄見 the-cut PLAY_LAUNCHER_EVIDENCE.md）。
    // 這條只驗「觸控穿過 iframe」，所以用遊戲的測試掛勾暫停模擬、劃完再推進；觸控事件本身仍是外殼座標的真實輸入。
    await fr.evaluate(() => window.__cb.setManual(true));
    const plan = await fr.evaluate(PLAN);
    const off = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const toShell = async (p) => { const q = await fr.evaluate(([x, y]) => window.__cb.toScreen(x, y), p); return { x: q.x + off.x, y: q.y + off.y }; };
    const A = await toShell(plan.S), B = await toShell(plan.E);
    const sev0 = await fr.evaluate(() => window.__cb.game.severedN.blue + window.__cb.game.severedN.red);
    let how;
    if (bname === 'chromium') {
      const cdp = await ctx.newCDPSession(page);
      // 遊戲用事件時間戳換算步數；不帶時間戳時 CDP 派送延遲會把一刀拉長（實測 freeStart→freeEnd 正常 24～28 步、失敗那次 49 步，目標先被 AI 鎖住）。比照 DF-02 帶硬體式時間戳（每 8ms 一點）。
      const base = Date.now() / 1000, pt = (k) => ({ x: A.x + ((B.x - A.x) * k) / 8, y: A.y + ((B.y - A.y) * k) / 8 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0)], timestamp: base });
      for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(k)], timestamp: base + (k * 8) / 1000 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: base + (8 * 8 + 1) / 1000 });
      await cdp.detach(); how = 'CDP 觸控';
    } else {
      await page.mouse.move(A.x, A.y); await page.mouse.down();
      for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 8, A.y + ((B.y - A.y) * k) / 8);
      await page.mouse.up(); how = '滑鼠 pointer（WebKit 無觸控移動 API）';
    }
    await page.waitForTimeout(300);
    await fr.evaluate(() => window.__cb.advance(60));
    const r = await fr.evaluate(() => ({ sev: window.__cb.game.severedN, last: window.__cb.lastFree && { why: window.__cb.lastFree.why, severed: window.__cb.lastFree.severed }, ids: window.__cb.game.organs.map((o) => o.id), log: window.__cb.freeLog.slice(-4), info: (document.getElementById('info') || {}).textContent }));
    const sevId = r.last && r.last.severed !== null ? r.ids[r.last.severed] : null;
    check(`${tag} PL-05(b) 在外殼座標${how}劃一刀，iframe 內切下目標器官（${plan.id}）`, r.sev.blue + r.sev.red > sev0 && sevId === plan.id, JSON.stringify({ sev0, ...r, sevId }));
    await ctx.close();
  });

  // ===== PL-07 latest.json 壞掉不白屏 =====
  for (const [name, body, status, want] of [['404', 'nope', 404, 'duel4'], ['非 JSON', '{oops', 200, 'duel4'], ['sub 不合法', { sub: '//evil.example', label: 'x' }, 200, 'duel4']]) await guard(`${tag} PL-07 ${name}`, async () => {
    setLatest(body, status);
    const { ctx, page } = await open();
    await ready(page, want);
    const s = await srcOf(page);
    check(`${tag} PL-07 latest.json ${name}：無上次紀錄時載入內建預設 ${want}、無站外網址、無例外`, s === ORIGIN + BASE + want + '/' && page.__errs.length === 0, JSON.stringify({ s, errs: page.__errs }));
    await ctx.close();
  });
  await guard(`${tag} PL-07 上次 latest`, async () => {
    setLatest(L3);
    const { ctx, page } = await open();
    await ready(page, 'duel3');
    setLatest('{oops', 200);
    await page.reload(); await ready(page, 'duel3');
    const s = await srcOf(page);
    check(`${tag} PL-07 latest.json 壞掉時載入上次成功讀到的 latest（duel3）`, s === ORIGIN + BASE + 'duel3/' && page.__errs.length === 0, JSON.stringify({ s }));
    await ctx.close();
  });
  await browser.close();
}
srv.close();
const bad = results.filter((r) => !r.ok);
console.log(`\nplay_tests：${results.length - bad.length}/${results.length} 通過（gh-pages ${ghSha}、外殼 ${PLAY}）`);
process.exit(bad.length ? 1 : 0);
