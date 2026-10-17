// 根網址 service worker 相容性（DL-069，凍結 RS-1～RS-4）：真實瀏覽器（Playwright），模擬 gh-pages 結構 /the-cut-proto-b/{根, fun-exp-01/, core-skewer/, twin-slash/}。
// 同一組情境分別以「舊根 SW（fcfd1d2 的 public/sw.js）」與「新根 SW（目前 dist/sw.js）」執行：舊版應重現問題、新版應修好。作者測試；不是 iPhone 實機。
// 用法：node tests/browser/root_sw_tests.mjs（需先 node tools/build.mjs）；也由 run.mjs 呼叫 runRootSwTests。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const MOUNT = { '': 'dist', 'fun-exp-01/': 'dist-exp', 'core-skewer/': 'dist-skewer', 'twin-slash/': 'dist-twin' };
const BASE = '/the-cut-proto-b/';
const SUBS = { 'twin-slash/': 'thecut-twinslash-', 'core-skewer/': 'thecut-coreskewer-', 'fun-exp-01/': 'thecut-funexp01-' };
const titleOf = (dir) => readFileSync(join(dir, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/)[1];

/** 模擬站台：根 sw.js 由 state.rootSw 提供（可隨時換版），其餘檔案取自各建置輸出。 */
function site(root) {
  const state = { rootSw: '' };
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!p.startsWith(BASE)) { rsp.writeHead(404); return rsp.end(); }
      p = p.slice(BASE.length);
      if (p === 'sw.js') { rsp.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }); return rsp.end(state.rootSw); }
      const sub = Object.keys(MOUNT).filter((k) => k && p.startsWith(k))[0] ?? '';
      let rest = p.slice(sub.length); if (rest === '') rest = 'index.html';
      if (sub === '' && rest.includes('/')) { rsp.writeHead(404); return rsp.end(); }
      try { const b = await readFile(join(root, MOUNT[sub], rest)); rsp.writeHead(200, { 'content-type': TYPES[extname(rest)] || 'application/octet-stream', 'cache-control': 'no-cache' }); rsp.end(b); }
      catch { rsp.writeHead(404); rsp.end('nf'); }
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, state, url: `http://127.0.0.1:${srv.address().port}${BASE}` }));
  });
}
// 子頁的 SW 接手時頁面可能自行重載：遇到執行環境被換掉就等載入完再讀一次
async function keys(page) { for (let i = 0; ; i++) { try { return await page.evaluate(() => caches.keys()); } catch (e) { if (i > 5) throw e; await page.waitForLoadState('load').catch(() => {}); await page.waitForTimeout(200); } } }
async function waitKeys(page, pred, ms = 8000) { const t = Date.now(); for (;;) { const k = await keys(page); if (pred(k)) return k; if (Date.now() - t > ms) return k; await page.waitForTimeout(150); } }
/** 進入某頁並等它自己的 SW 啟用、快取建立。 */
async function visit(page, url, prefix) {
  await page.goto(url, { waitUntil: 'load' });
  await waitKeys(page, (k) => k.some((x) => x.startsWith(prefix)));
  await page.evaluate(async (u) => { for (let i = 0; i < 60; i++) { const r = await navigator.serviceWorker.getRegistration(u); if (r && r.active) return; await new Promise((z) => setTimeout(z, 100)); } }, url);
}
async function offlineTitle(ctx, page, url) {
  await ctx.setOffline(true);
  let t; try { await page.goto(url, { waitUntil: 'load', timeout: 8000 }); t = await page.title(); } catch (e) { t = `（離線開啟失敗：${String(e).split('\n')[0].slice(0, 60)}）`; }
  await ctx.setOffline(false);
  return t;
}

export async function runRootSwTests({ check, root = process.cwd() }) {
  const sha = readFileSync(join(root, 'dist/index.html'), 'utf8').match(/name="build-sha" content="([^"]+)"/)[1];
  const OLD = execSync('git show fcfd1d2:public/sw.js', { cwd: root }).toString().replaceAll('__BUILD_SHA__', sha);
  const NEW = readFileSync(join(root, 'dist/sw.js'), 'utf8');
  const bump = (s) => s.replaceAll(sha, 'zzzzzzz');
  const T = { root: titleOf(join(root, 'dist')), 'twin-slash/': titleOf(join(root, 'dist-twin')), 'core-skewer/': titleOf(join(root, 'dist-skewer')), 'fun-exp-01/': titleOf(join(root, 'dist-exp')) };
  const { srv, state, url } = await site(root);
  const browser = await chromium.launch();
  const fresh = async () => { const ctx = await browser.newContext(); return { ctx, page: await ctx.newPage() }; };
  const out = {};
  for (const [lab, sw] of [['舊', OLD], ['新', NEW]]) {
    // RS-1：先裝根 SW → 首次在線進 twin-slash/ → 離線開根網址
    { state.rootSw = sw; const { ctx, page } = await fresh();
      await visit(page, url, 'thecut-protob-'); await page.reload();
      await visit(page, url + 'twin-slash/', 'thecut-twinslash-'); await page.waitForTimeout(300);
      out[`${lab}-RS1`] = await offlineTitle(ctx, page, url); await ctx.close(); }
    // RS-2：根與三個子頁快取都在 → 根 SW 換版 → 子頁快取是否還在
    { state.rootSw = sw; const { ctx, page } = await fresh();
      await visit(page, url, 'thecut-protob-'); await page.reload();
      for (const [s, pre] of Object.entries(SUBS)) await visit(page, url + s, pre);
      const before = await keys(page);
      state.rootSw = bump(sw);
      await page.goto(url); await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('./'); await r.update(); });
      const after = await waitKeys(page, (k) => k.some((x) => x.includes('zzzzzzz')));
      await page.waitForTimeout(500);
      out[`${lab}-RS2`] = { before, after: await keys(page) }; await ctx.close(); }
  }
  // RS-3：舊 SW 先汙染 → 換成新 SW → (a) 線上開根網址 (b) 只開雙獸頁（觸發根註冊更新）→ 離線開根網址
  for (const via of ['根網址', '雙獸頁']) {
    state.rootSw = OLD; const { ctx, page } = await fresh();
    await visit(page, url, 'thecut-protob-'); await page.reload();
    await visit(page, url + 'twin-slash/', 'thecut-twinslash-'); await page.waitForTimeout(300);
    const polluted = await offlineTitle(ctx, page, url);
    state.rootSw = NEW;
    await page.goto(via === '根網址' ? url : url + 'twin-slash/', { waitUntil: 'load' });
    if (via === '根網址') await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('./'); await r.update(); });
    // 等新根 SW 接手（scriptURL 相同，以「作用中的 SW 內容含新版字樣」判斷），再讀所有根快取裡的 ./index.html
    await page.evaluate(async () => { for (let i = 0; i < 80; i++) { const r = await navigator.serviceWorker.getRegistration('../'); const t = r && r.active ? await (await fetch(r.active.scriptURL, { cache: 'no-store' })).text() : ''; if (t.includes('DL-069') && r.active && !r.installing && !r.waiting) return; await new Promise((z) => setTimeout(z, 100)); } }).catch(() => {});
    await page.waitForTimeout(800);
    const idx = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) if (k.startsWith('thecut-protob-')) { const c = await caches.open(k); const r = await c.match('./index.html') || await c.match(new URL('../index.html', location.href).href) || await c.match(new URL('/the-cut-proto-b/index.html', location.href).href); out[k] = r ? ((await r.text()).match(/<title>([^<]*)/) || [])[1] : null; } return out; });
    out[`RS3-${via}`] = { polluted, rootCaches: idx, offline: await offlineTitle(ctx, page, url) }; await ctx.close();
  }
  // RS-4：新根 SW 下四頁都能離線開
  { state.rootSw = NEW; const { ctx, page } = await fresh();
    await visit(page, url, 'thecut-protob-'); await page.reload();
    for (const [s, pre] of Object.entries(SUBS)) { await visit(page, url + s, pre); await page.reload(); }
    const r = {};
    for (const s of ['', ...Object.keys(SUBS)]) r[s || 'root'] = await offlineTitle(ctx, page, url + s);
    out.RS4 = r; await ctx.close(); }
  await browser.close(); srv.close();

  const subKept = (o) => Object.values(SUBS).every((p) => o.after.some((k) => k.startsWith(p)));
  check('[chromium][rootsw] RS-1 舊根 SW 重現 HIGH #3（離線根網址顯示雙獸頁）', out['舊-RS1'] === T['twin-slash/'], out['舊-RS1']);
  check('[chromium][rootsw] RS-1 新根 SW：首次進雙獸頁後離線開根網址＝根頁', out['新-RS1'] === T.root, out['新-RS1']);
  check('[chromium][rootsw] RS-2 舊根 SW 重現 MEDIUM #4（換版刪掉子頁快取）', !subKept(out['舊-RS2']), JSON.stringify(out['舊-RS2'].after));
  check('[chromium][rootsw] RS-2 新根 SW 換版：三個子頁快取全保留，只清 thecut-protob- 舊版', subKept(out['新-RS2']) && out['新-RS2'].after.filter((k) => k.startsWith('thecut-protob-')).length === 1 && out['新-RS2'].after.some((k) => k.includes('zzzzzzz')), JSON.stringify(out['新-RS2']));
  for (const via of ['根網址', '雙獸頁']) {
    const o = out[`RS3-${via}`];
    // §2.1 例外修正（原「汙染舊快取已刪除」與既有 X-12「根快取名稱＝thecut-protob-<sha>」在線上 SHA 不變時不可能同時成立）：
    // 改判「所有根快取裡的首頁都不再是雙獸頁、且至少一份是根頁」——仍汙染的實作照樣紅
    const vals = Object.values(o.rootCaches);
    check(`[chromium][rootsw] RS-3 已汙染→經${via}換上新 SW：根快取不再含雙獸頁、離線根網址＝根頁`, o.polluted === T['twin-slash/'] && o.offline === T.root && vals.length >= 1 && vals.every((t) => t !== T['twin-slash/']) && vals.includes(T.root), JSON.stringify(o));
  }
  check('[chromium][rootsw] RS-4 新根 SW 下根頁與三個子頁都能離線開啟', out.RS4.root === T.root && Object.keys(SUBS).every((s) => out.RS4[s] === T[s]), JSON.stringify(out.RS4));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
  await runRootSwTests({ check });
  process.exit(fail ? 1 : 0);
}
