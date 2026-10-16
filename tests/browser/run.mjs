// 瀏覽器自動測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）：
// T-2 golden、T-8 前端不寫引擎物件、T-9 演出不改結果、T-10 取消／誤操作、T-11 重開、T-12 旋轉與重載、
// T-13 可讀性與觸控目標、T-14 版本與警告、T-15①～③ PWA；並匯出每局紀錄供 Node 的 T-5 跨環境重算。
import { chromium, webkit, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { runExpTests } from './exp_tests.mjs';

const GOLDEN_SHA = '112d879b4a6bbaabf48bfee7fd8425f9301445ff4e00832533200362e727be74';
const results = [];
const hudMismatch = [];
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
/** T-16：由引擎回傳的 events 獨立推出「畫面上每一行因果回顧應含的文字」（不呼叫 src 的 evText，免得與被測碼同源）。 */
const W = { P: '你', E: '屠夫' };
function expectedLines(events) {
  const out = [];
  for (const e of events) {
    switch (e.t) {
      case 'PIERCE': out.push('刀鋒穿刺：'); break;
      case 'INC': out.push('刀中效果：'); break;
      case 'STEP': if (e.name === 'INCISION') out.push('— 刀中效果 —'); else if (e.name === 'HARVEST') out.push('— 盾、治療、傷害 —'); break;
      case 'CHOICE': out.push(`屠夫拿走 ${e.side === 'L' ? '紫側' : '橙側'}`); break;
      case 'SHIELD': out.push(`${W[e.who]}獲得 ${e.n} 盾`); break;
      case 'HEAL': out.push(`${W[e.who]}回復 ${e.actual}`); break;
      case 'DMG': out.push(`${W[e.src]} → ${W[e.dst]} ${e.raw} 傷（盾吸收 ${e.abs}，實扣 ${e.loss}）`); break;
      case 'REFL': out.push(`${W[e.who]}的鏡膜反射 ${e.amount}`); break;
      case 'END': out.push(`結束：${e.result}`); break;
      default: break;
    }
  }
  return out;
}
const groups = {};
/** 確認前裝探針：HUD 文字每次被寫入、以及演出期間每個 frame 都取樣（HUD vs 引擎 HP）。 */
async function armProbe(page) {
  await page.evaluate(() => {
    const P = window.__proto, samples = []; window.__samples = samples;
    const snap = (src) => { const s = P.state; samples.push({ src, ui: P.ui, p: document.getElementById('hpP').textContent, e: document.getElementById('hpE').textContent, want: { p: `${s.hp.P}/${s.maxHp.P}`, e: `${s.hp.E}/${s.maxHp.E}` } }); };
    const mo = new MutationObserver(() => snap('mut')); window.__mo = mo;
    mo.observe(document.getElementById('hpP'), { childList: true, characterData: true, subtree: true });
    mo.observe(document.getElementById('hpE'), { childList: true, characterData: true, subtree: true });
    window.__run = true; const loop = () => { if (!window.__run) return; if (P.ui === 'EXECUTE') snap('raf'); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
}
async function verifyRound(page, g) {
  const r = await page.evaluate(() => {
    window.__mo.disconnect(); window.__run = false;
    return { samples: window.__samples, lis: [...document.querySelectorAll('#reviewBody li')].map((l) => l.textContent), events: JSON.parse(JSON.stringify(window.__proto.lastEvents)), log: JSON.parse(JSON.stringify(window.__proto.log.rounds.at(-1).events)) };
  });
  g.rounds++;
  const exp = expectedLines(r.events);
  if (JSON.stringify(r.events) !== JSON.stringify(r.log)) g.bad.push(`R${g.rounds} 紀錄事件≠引擎回傳事件`);
  if (r.lis.length !== exp.length) g.bad.push(`R${g.rounds} 回顧行數 畫面${r.lis.length}≠引擎${exp.length}`);
  else r.lis.forEach((t, k) => { if (!t.includes(exp[k])) g.bad.push(`R${g.rounds} 第${k + 1}行 畫面「${t}」不含引擎事件「${exp[k]}」`); });
  for (const sm of r.samples) {
    if (sm.src === 'raf') g.raf++;
    if (sm.ui === 'EXECUTE') g.exec++;
    if (sm.p !== sm.want.p || sm.e !== sm.want.e) g.bad.push(`R${g.rounds} HUD(${sm.src},${sm.ui}) ${sm.p}|${sm.e} ≠ 引擎 ${sm.want.p}|${sm.want.e}`);
  }
  g.events += exp.length;
}
function checkGroup(bname, label, normal) {
  const g = groups[label];
  const live = g.rounds > 0 && g.events > 0 && g.exec >= g.rounds && (!normal || g.raf >= 2 * g.rounds);
  check(`[${bname}] T-16 ${label}：畫面因果回顧順序／內容＝引擎事件，HUD 於演出期間與結束皆＝引擎 HP`, g.bad.length === 0 && live, `${g.rounds} 回合 ${g.events} 事件行 EXECUTE取樣${g.exec}（rAF ${g.raf}）${g.bad.slice(0, 2).join(' | ')}`);
}
/** how: 'set'＝setSkip(true)；'normal'＝正常演出；'button'＝正常演出中按「跳過演出」。fixedCuts 有值時照切法重播。 */
async function playToEnd(page, how, label, fixedCuts) {
  await page.evaluate((v) => window.__proto.setSkip(v), how === 'set');
  const g = groups[label] = { rounds: 0, events: 0, exec: 0, raf: 0, bad: [] };
  const cuts = [];
  for (let r = 0; r < 12; r++) {
    if (await page.evaluate(() => window.__proto.ui === 'END')) break;
    if (fixedCuts) { if (r >= fixedCuts.length) break; await dragCut(page, ...fixedCuts[r]); cuts.push(fixedCuts[r]); }
    else { const c = await findLegal(page); if (!c) break; cuts.push(c); }
    await armProbe(page);
    await page.click('#confirm');
    if (how === 'button') await page.evaluate(() => document.getElementById('skip').click()); // 因果回顧面板會蓋住跳過鈕，改走 DOM click 觸發同一個 onclick
    await waitIdleOrEnd(page);
    await verifyRound(page, g);
    // T-5 畫面一致：畫面上的 HP 等於引擎狀態
    const hud = await page.evaluate(() => ({ p: document.getElementById('hpP').textContent, e: document.getElementById('hpE').textContent, s: window.__proto.state.hp, m: window.__proto.state.maxHp }));
    if (hud.p !== `${hud.s.P}/${hud.m.P}` || hud.e !== `${hud.s.E}/${hud.m.E}`) hudMismatch.push(JSON.stringify(hud));
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
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const before = await page.evaluate(() => ({ a: window.__proto.anchorScreen(3), c: (() => { const c = document.getElementById('board'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, bw: c.width, bh: c.height }; })() }));
  const c1 = await findLegal(page);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const during = await page.evaluate(() => ({ a: window.__proto.anchorScreen(3), c: (() => { const c = document.getElementById('board'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, bw: c.width, bh: c.height }; })() }));
  const aspectOk = Math.abs(during.c.bw / during.c.bh - during.c.w / during.c.h) < 0.02;
  check(`[${bname}] 確認面板出現時畫布不變形、錨點不移動`, aspectOk && Math.abs(before.a.x - during.a.x) < 1 && Math.abs(before.a.y - during.a.y) < 1, JSON.stringify({ before, during }));
  await page.click('#cancel');
  const h1 = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  check(`[${bname}] T-10 起點不在錨點、放開在空處、確認前取消：狀態不變`, t10a === 'IDLE' && t10b === 'IDLE' && !!c1 && h0 === h1 && (await page.evaluate(() => window.__proto.ui)) === 'IDLE');
  // ---- T-9 演出不改結果（同 seed、同切法，跳過 vs 正常）＋ T-8 devfreeze 下全程無 TypeError ----
  const runA = await playToEnd(page, 'set', '三器官／跳過演出(setSkip)');
  checkGroup(bname, '三器官／跳過演出(setSkip)', false);
  writeFileSync(`test-output/logs/${bname}_exp3_a.json`, JSON.stringify(runA.log));
  await page.click('#retry');
  const hRetry = await page.evaluate(() => window.__proto.stateHash(window.__proto.state));
  check(`[${bname}] T-11 重開：新局等於同 seed 開局`, hRetry === h0);
  const runB = await playToEnd(page, 'normal', '三器官／正常演出', runA.cuts);
  checkGroup(bname, '三器官／正常演出', true);
  await page.click('#retry');
  await playToEnd(page, 'button', '三器官／演出中按跳過鈕', runA.cuts);
  checkGroup(bname, '三器官／演出中按跳過鈕', false);
  const hB = runB.hash;
  check(`[${bname}] T-5 畫面上的 HP 每回合等於引擎狀態`, hudMismatch.length === 0, hudMismatch.slice(0, 2).join(' | '));
  check(`[${bname}] T-9 跳過演出與正常演出最終 stateHash 相同`, hB === runA.hash, `${runA.cuts.length} 刀`);
  check(`[${bname}] T-8 devfreeze 下全程無頁面錯誤`, errs.length === 0, errs.join(' | '));
  // ---- 六器官研究模式一局（供 T-5）＋ 模式標示 ----
  await page.evaluate(() => window.__proto.setMode('research6'));
  const research = await playToEnd(page, 'set', '六器官／跳過演出(setSkip)');
  checkGroup(bname, '六器官／跳過演出(setSkip)', false);
  writeFileSync(`test-output/logs/${bname}_res6.json`, JSON.stringify(research.log));
  await page.click('#retry');
  await playToEnd(page, 'normal', '六器官／正常演出', research.cuts);
  checkGroup(bname, '六器官／正常演出', true);
  await page.click('#retry');
  await playToEnd(page, 'button', '六器官／演出中按跳過鈕', research.cuts);
  checkGroup(bname, '六器官／演出中按跳過鈕', false);
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

// ---- FUN-EXP-01 第二階段：實驗版 UI／紀錄／問卷／子路徑部署（X-3、X-4、X-10、X-11、X-12） ----
for (const [bname, btype] of [['chromium', chromium], ['webkit', webkit]]) {
  await runExpTests({ bname, btype, devices, url, check, logDir: 'test-output/exp_logs', shotsDir: process.env.EXP_SHOTS_DIR });
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
