// FUN-EXP-01 第二階段瀏覽器測試（作者測試；Chromium＋WebKit 模擬，不是 iPhone 實機）。由 run.mjs 逐瀏覽器呼叫。
// 涵蓋：X-3 模式隔離、X-4 瀏覽器決定性（與 Node 逐回合雜湊相同）、X-10 各 UI 可操作與不重疊（iPhone 14 Pro、iPhone SE 尺寸）、
// X-11 紀錄欄位、X-12 子路徑部署（scope／快取／manifest 獨立）。
// 判定來源一律是「引擎回傳的狀態／事件」或測試自己獨立算的值，不呼叫 src 的文字函式。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const SIZES = { 'iPhone14Pro': [393, 852], 'iPhoneSE': [375, 667] };
const SURVEY_TEXT = [
  'Q1 你是否理解為什麼敵人選這一側？', 'Q2 你有沒有故意設計陷阱？', 'Q3 你有沒有為下一回合做準備？',
  'Q4 哪一次切割最有成就感？為什麼？', 'Q5 你是否願意再玩一次？為什麼？',
];
const TOP_KEYS = ['modeId', 'specVersion', 'commit', 'seed', 'board', 'hpE', 'hpP', 'rounds', 'roundsPlayed', 'result', 'summary', 'survey', 'format', 'engineSpecVersion', 'engineVersion', 'configHash', 'config', 'finalStateHash'];
const ROUND_KEYS = ['round', 'i', 'j', 'keepWound', 'prediction', 'baitIntent', 'sideL', 'sideR', 'pierced', 'choiceSide', 'choiceReason', 'reasonKind', 'obsessionTriggered', 'obsession', 'hpBefore', 'hpAfter', 'woundBefore', 'wound', 'tearHpLoss', 'stateHashAfter', 'events'];
const MODE_BTN = { BASELINE: '#modeBASELINE', A1: '#modeA', A2: '#modeA', B: '#modeB' };

// ---------------------------------------------------------------- 共用操作

export async function newPage(browser, bname, devices, w, h) {
  const opt = bname === 'webkit' ? { ...devices['iPhone 14 Pro'], viewport: { width: w, height: h } }
    : { viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] };
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage();
  // 記錄寫入剪貼簿的文字（WebKit 無法讀剪貼簿；呼叫仍轉給真實 API，不改變被測行為）
  await page.addInitScript(() => { const c = navigator.clipboard; if (c && c.writeText) { const o = c.writeText.bind(c); c.writeText = (x) => { window.__copied = x; return o(x); }; } });
  page.__errs = [];
  page.on('pageerror', (e) => page.__errs.push(String(e)));
  return { ctx, page };
}
export async function selectMode(page, mode, board) {
  await page.click(MODE_BTN[mode]);
  if (mode === 'A1' || mode === 'A2') await page.selectOption('#variantSel', mode);
  if (board) await page.selectOption('#boardSel', board);
}
async function centerBoard(page) { await page.evaluate(() => document.getElementById('board').scrollIntoView({ block: 'center' })); }
export async function drag(page, i, j) {
  await centerBoard(page);
  const A = await page.evaluate((k) => window.__proto.anchorScreen(k), i), B = await page.evaluate((k) => window.__proto.anchorScreen(k), j);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  await page.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 3 }); await page.mouse.move(B.x, B.y, { steps: 3 }); await page.mouse.up();
}
/** 全部合法線與其公開資訊（由 partition 掛勾取得；測試用來挑線，不是被測碼的判斷）。 */
export async function linesInfo(page) {
  return page.evaluate(() => {
    const P = window.__proto, s = P.state, n = s.board.anchors.length, lines = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const p = P.partition(i, j);
      if (p.legal) lines.push({ i, j, pierced: p.pierced.map((o) => o.key), L: p.L.map((o) => o.key), R: p.R.map((o) => o.key), area2: p.area2 });
    }
    return { lines, pos: s.board.anchors.map((a) => a.pos), wound: s.wound ? { a: s.wound.a, b: s.wound.b, sealed: s.wound.sealed.map((o) => o.key), round: s.wound.round } : null, round: s.round, mode: s.config.exp ? s.config.exp.mode : 'BASELINE', enemy: s.config.enemy.kind };
  });
}
/** 測試自己的弦相交判定（周長位置交錯、共用端點不算）；與引擎實作獨立。 */
export function crosses(info, l) {
  const w = info.wound; if (!w) return false;
  const lo = Math.min(w.a.pos, w.b.pos), hi = Math.max(w.a.pos, w.b.pos), pa = info.pos[l.i], pb = info.pos[l.j];
  if ([pa, pb].some((p) => p === w.a.pos || p === w.b.pos)) return false;
  const inside = (p) => lo < p && p < hi;
  return inside(pa) !== inside(pb);
}
export const heartsOf = (keys) => keys.filter((k) => k === 'heart').length;
/** 獨立推出「執念會讓牠拿哪側」：A1 心臟多的一側；A2 面積差 ≥10% 取大側；否則 null。 */
export function expectedObsession(enemy, l) {
  if (enemy === 'OBS_HEART') { const a = heartsOf(l.L), b = heartsOf(l.R); return a === b ? null : a > b ? 'L' : 'R'; }
  const tot = l.area2.L + l.area2.R;
  return 10 * Math.abs(l.area2.L - l.area2.R) >= tot && l.area2.L !== l.area2.R ? (l.area2.L > l.area2.R ? 'L' : 'R') : null;
}
export async function waitIdleOrEnd(page) { await page.waitForFunction(() => ['IDLE', 'END'].includes(window.__proto.ui), null, { timeout: 8000 }); }
export async function cut(page, i, j, keep = false) {
  await drag(page, i, j);
  const st = await page.evaluate(() => ({ ui: window.__proto.ui, dis: document.getElementById('confirm').disabled }));
  if (st.ui !== 'PENDING' || st.dis) throw new Error(`切 ${i}-${j} 未進入可確認狀態 ${JSON.stringify(st)}`);
  if (keep) await page.click('#keepRow label');
  await page.click('#confirm');
  await waitIdleOrEnd(page);
}
/** 自動打完一局。A：優先挑「執念指標分得出高下」的線；B：交替撕裂／癒合／再留傷口。回傳每回合的選線摘要。 */
export async function autoPlay(page, opts = {}) {
  await page.evaluate((v) => window.__proto.setSkip(v), !opts.animate);
  const trail = []; let woundSeen = 0;
  for (let r = 0; r < 14; r++) {
    if (await page.evaluate(() => window.__proto.ui === 'END')) break;
    const info = await linesInfo(page);
    let pick = null, keep = false;
    if (info.mode === 'B') {
      if (info.wound) {
        const cr = info.lines.filter((l) => crosses(info, l)), non = info.lines.filter((l) => !crosses(info, l));
        pick = woundSeen++ % 2 === 0 ? (cr[0] ?? non[0]) : (non[0] ?? cr[0]);
      } else { pick = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2); keep = !!pick; }
    } else if (info.mode === 'A') {
      const pref = info.lines.filter((l) => expectedObsession(info.enemy, l));
      pick = (pref.length ? pref : info.lines)[(r * 3) % (pref.length ? pref.length : info.lines.length)];
    }
    pick ??= info.lines[(r * 5) % info.lines.length];
    trail.push({ i: pick.i, j: pick.j, keep });
    await cut(page, pick.i, pick.j, keep);
  }
  return trail;
}
const hashNow = (page) => page.evaluate(() => window.__proto.stateHash(window.__proto.state));

// ---------------------------------------------------------------- 版面探針（X-10）

async function layoutProbe(page) {
  return page.evaluate(() => {
    const sxo = scrollX, syo = scrollY;
    const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
    const rc = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + sxo, y: r.top + syo, r: r.right + sxo, b: r.bottom + syo, w: r.width, h: r.height }; };
    const name = (el) => el.id || el.className || el.tagName;
    const canvasEl = document.getElementById('board'), cv = rc(canvasEl);
    const interactive = [...document.querySelectorAll('header button, header select, header label, footer button, footer label, #pending button')].filter(vis);
    const checks = [...document.querySelectorAll('footer input[type=checkbox]')].filter(vis);
    const blocks = [...document.querySelectorAll('#preview, #pending, #notice, #blurb, .titleRow, .hud, .warn, .tools, #hint, .pending-slot, #modeRow, .cfg')].filter(vis);
    const small = interactive.filter((el) => { const r = rc(el); return r.h < 44 - 0.5 || (el.tagName === 'BUTTON' && r.w < 44 - 0.5); }).map((el) => `${name(el)}:${Math.round(rc(el).w)}x${Math.round(rc(el).h)}`);
    const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
    const overCanvas = [...interactive, ...checks, ...blocks].filter((el) => hit(rc(el), cv)).map(name);
    const pairs = [];
    for (let a = 0; a < interactive.length; a++) for (let b = a + 1; b < interactive.length; b++) {
      if (interactive[a].contains(interactive[b]) || interactive[b].contains(interactive[a])) continue;
      if (hit(rc(interactive[a]), rc(interactive[b]))) pairs.push(`${name(interactive[a])}/${name(interactive[b])}`);
    }
    const W = innerWidth;
    const outX = [...interactive, ...checks, ...blocks].filter((el) => { const r = rc(el); return r.x < -0.5 || r.r > W + 0.5; }).map(name);
    // 畫布上的錨點、器官、（待確認時）切線中點：最上層元素必須是畫布本身（沒有被別的 UI 蓋住）
    canvasEl.scrollIntoView({ block: 'center' });
    const P = window.__proto, s = P.state, pts = [];
    if (s && s.board) {
      s.board.anchors.forEach((_, k) => pts.push(['anchor' + k, P.anchorScreen(k)]));
      P.organScreen().forEach((o) => pts.push(['organ' + o.id, o]));
    }
    const covered = pts.filter(([, p]) => p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight && document.elementFromPoint(p.x, p.y) !== canvasEl).map(([n]) => n);
    const cvVis = canvasEl.getBoundingClientRect();
    const slot = document.querySelector('.pending-slot').getBoundingClientRect(), pend = document.getElementById('pending');
    const pendingEscapes = vis(pend) && pend.getBoundingClientRect().bottom > slot.bottom + 1;
    const overlays = ['legend', 'endPanel', 'exportModal'].filter((id) => !document.getElementById(id).hidden);
    return { small, overCanvas, pairs, outX, covered, ptsN: pts.length, canvasInView: cvVis.top >= -1 && cvVis.bottom <= innerHeight + 1, docOverflowX: document.documentElement.scrollWidth > W + 1, pendingEscapes, overlays, cv };
  });
}
function probeOk(p) {
  return p.small.length === 0 && p.overCanvas.length === 0 && p.pairs.length === 0 && p.outX.length === 0 && p.covered.length === 0 && p.ptsN > 0
    && p.canvasInView && !p.docOverflowX && !p.pendingEscapes && p.overlays.length === 0;
}
const probeDetail = (p) => JSON.stringify({ small: p.small, overCanvas: p.overCanvas, pairs: p.pairs, outX: p.outX, covered: p.covered.slice(0, 4), ptsN: p.ptsN, canvasInView: p.canvasInView, docOverflowX: p.docOverflowX, pendingEscapes: p.pendingEscapes, overlays: p.overlays });

async function woundPixels(page) {
  return page.evaluate(() => {
    const w = window.__proto.woundScreen(); if (!w) return null;
    const c = document.getElementById('board'), g = c.getContext('2d', { willReadFrequently: true });
    const near = (px, q, rgb, tol) => Math.abs(px[q] - rgb[0]) <= tol && Math.abs(px[q + 1] - rgb[1]) <= tol && Math.abs(px[q + 2] - rgb[2]) <= tol;
    let hits = 0; const total = 38;
    for (let k = 1; k <= total; k++) {
      const t = k / (total + 1), x = w.a.x + (w.b.x - w.a.x) * t, y = w.a.y + (w.b.y - w.a.y) * t;
      const px = g.getImageData(Math.max(0, Math.round((x - 4) * w.dpr)), Math.max(0, Math.round((y - 4) * w.dpr)), Math.round(8 * w.dpr), Math.round(8 * w.dpr)).data;
      for (let q = 0; q < px.length; q += 4) if (near(px, q, w.rgb, 28)) { hits++; break; }
    }
    // 封存器官圖示：圖示圓底色（#2a1a05）出現在圖示中心附近
    let iconOk = 0;
    for (const ic of w.icons) {
      const px = g.getImageData(Math.round((ic.x - 9) * w.dpr), Math.round((ic.y - 9) * w.dpr), Math.round(18 * w.dpr), Math.round(18 * w.dpr)).data;
      let n = 0; for (let q = 0; q < px.length; q += 4) if (near(px, q, [42, 26, 5], 10)) n++;
      if (n > 12) iconOk++;
    }
    return { hits, total, icons: w.icons.length, iconOk };
  });
}

// ---------------------------------------------------------------- 主流程

export async function runExpTests({ bname, btype, devices, url, check, logDir, shotsDir }) {
  mkdirSync(logDir, { recursive: true });
  const browser = await btype.launch();
  const E = url + '/fun-exp-01/';
  const tag = `[${bname}]`;

  // ===== X-10 基本：版本／實驗版字樣／三模式名稱常駐／預覽與執念說明（14 Pro 尺寸） =====
  {
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(E + '?devfreeze=1');
    const shaBuilt = readFileSync('dist-exp/index.html', 'utf8').match(/name="build-sha" content="([^"]+)"/)[1];
    const top = await page.textContent('#top');
    check(`${tag} X-10 實驗版字樣、版本 SHA、三模式按鈕`, top.includes('實驗版') && top.includes(shaBuilt) && (await page.locator('#modeRow button').count()) === 3, `sha ${shaBuilt}`);
    const names = {};
    for (const m of ['BASELINE', 'A1', 'A2', 'B']) { await selectMode(page, m); names[m] = { name: await page.textContent('#modeName'), blurb: await page.textContent('#blurb'), enemy: await page.textContent('#enemyName'), cfg: await page.evaluate(() => window.__proto.state.config) }; }
    check(`${tag} X-10 模式名稱與敵人說明常駐（A1 心臟、A2 面積、B 傷口、BASELINE 原版）`,
      names.BASELINE.name.includes('原版') && names.A1.name.includes('實驗 A：致命執念') && names.A1.blurb.includes('心臟') && names.A1.enemy.includes('狂心屠夫')
      && names.A2.name.includes('實驗 A：致命執念') && names.A2.blurb.includes('面積') && names.A2.enemy.includes('傲慢血王') && names.B.name.includes('實驗 B：留下傷口') && names.B.blurb.includes('傷口'), JSON.stringify(Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.name + '|' + v.enemy]))));
    check(`${tag} X-10 引擎設定：HP 透過 hpE 傳入、六器官、敵人種類與實驗模式對應`,
      names.A1.cfg.enemy.kind === 'OBS_HEART' && names.A2.cfg.enemy.kind === 'OBS_AREA' && names.B.cfg.enemy.kind === 'BUT' && names.B.cfg.exp.mode === 'B' && names.BASELINE.cfg.exp === undefined
      && names.A1.cfg.hpE === 30 && (await page.evaluate(() => window.__proto.state.maxHp.E)) === 30);
    // 盤面選擇：測試盤面 1～3 對應 exp_params 的 seed；自由為隨機 seed
    const seeds = [];
    for (const b of ['1', '2', '3']) { await page.selectOption('#boardSel', b); seeds.push(await page.evaluate(() => window.__proto.state.config.seed)); }
    await page.selectOption('#boardSel', 'free'); const f1 = await page.evaluate(() => window.__proto.state.config.seed);
    await selectMode(page, 'B', 'free'); const f2 = await page.evaluate(() => window.__proto.state.config.seed);
    check(`${tag} X-10 盤面選擇：測試盤面 1～3 ＝ 2001／2003／2005，自由為隨機 seed`, JSON.stringify(seeds) === '[2001,2003,2005]' && f1 >= 100000 && f2 >= 100000 && f1 !== 2001, `${seeds} free ${f1},${f2}`);
    check(`${tag} X-10 全程無頁面錯誤（devfreeze）`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }

  // ===== X-3 模式隔離 =====
  {
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(E);
    await selectMode(page, 'BASELINE', '1'); const h0 = await hashNow(page);
    const res = [];
    for (const m of ['A1', 'A2', 'B']) {
      await selectMode(page, m, '1');
      const trail = [];
      for (let r = 0; r < 2; r++) {
        const info = await linesInfo(page);
        let pick = info.lines[r + 2], keep = false;
        if (m === 'B' && r === 0) { pick = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2); keep = true; }
        await cut(page, pick.i, pick.j, keep); trail.push(pick.i + '-' + pick.j);
      }
      const mid = await page.evaluate(() => ({ round: window.__proto.state.round, wound: window.__proto.state.wound ?? null, logRounds: window.__proto.log.rounds.length }));
      await page.click(MODE_BTN.BASELINE);
      const after = await page.evaluate(() => ({ h: window.__proto.stateHash(window.__proto.state), round: window.__proto.state.round, wound: window.__proto.state.wound, exp: window.__proto.state.config.exp, mode: window.__proto.log.modeId, logRounds: window.__proto.log.rounds.length, notice: document.getElementById('notice').textContent, ui: window.__proto.ui, endHidden: document.getElementById('endPanel').hidden }));
      res.push({ m, mid, after, same: after.h === h0 });
    }
    check(`${tag} X-3 A1／A2／B 各玩到第 3 回合切回 BASELINE：同 seed 狀態雜湊＝全新 BASELINE`,
      res.every((r) => r.mid.round === 3 && r.same && r.after.round === 1 && r.after.wound === undefined && r.after.exp === undefined && r.after.mode === 'BASELINE' && r.after.logRounds === 0 && r.after.ui === 'IDLE'),
      JSON.stringify(res.map((r) => [r.m, r.mid.round, r.same, r.mid.wound ? 'wound' : '-'])));
    check(`${tag} X-3 切換時畫面出現「已切換模式，戰鬥重新開始」`, res.every((r) => r.after.notice === '已切換模式，戰鬥重新開始'));
    // B 中途有傷口時切到 A 再切回 B：新局沒有殘留傷口
    await selectMode(page, 'B', '1');
    const info = await linesInfo(page); const k = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2);
    await cut(page, k.i, k.j, true);
    const hadWound = await page.evaluate(() => !!window.__proto.state.wound);
    await page.click(MODE_BTN.A1); await page.click(MODE_BTN.B);
    const w2 = await page.evaluate(() => ({ wound: window.__proto.state.wound, round: window.__proto.state.round }));
    check(`${tag} X-3 B 留有傷口時離開再回來：傷口清空、回合重置`, hadWound && w2.wound === null && w2.round === 1);
    await ctx.close();
  }

  // ===== A 預覽（X-10 執念指標＋「執念會讓牠拿 X 側」）與預覽不改引擎狀態 =====
  {
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(E);
    const stat = { sided: 0, even: 0, bad: [] };
    for (const m of ['A1', 'A2']) for (const b of ['1', '2', '3']) {
      await selectMode(page, m, b);
      const info = await linesInfo(page);
      const h0 = await hashNow(page);
      const sample = info.lines.filter((_, k) => k % 3 === 0).slice(0, 14);
      for (const l of sample) {
        await drag(page, l.i, l.j);
        const txt = await page.textContent('#preview');
        const exp = expectedObsession(info.enemy, l);
        const tot = l.area2.L + l.area2.R, pl = Math.round((100 * l.area2.L) / tot);
        const metric = info.enemy === 'OBS_HEART' ? `紫側 心臟 ${heartsOf(l.L)} 顆｜橙側 心臟 ${heartsOf(l.R)} 顆` : `紫側 面積 ${pl}%｜橙側 面積 ${100 - pl}%`;
        const flat = txt.replace(/\s+/g, ' ');
        const okMetric = flat.replace(/\s*\|\s*/g, '｜').includes(metric) || flat.includes(metric.replace('｜', ' ｜ ')) || flat.replace(/[｜|]/g, '').replace(/\s+/g, '').includes(metric.replace(/[｜|]/g, '').replace(/\s+/g, ''));
        const okVerdict = exp ? flat.includes(`執念會讓牠拿 ${exp === 'L' ? '紫側' : '橙側'}——除非那側會讓牠死`) : (flat.includes('不分高下') || flat.includes('不啟動')) && !flat.includes('執念會讓牠拿');
        if (exp) stat.sided++; else stat.even++;
        if (!okMetric || !okVerdict) stat.bad.push(`${m}/${b}/${l.i}-${l.j} exp=${exp} metric=${okMetric} verdict=${okVerdict} 「${flat.slice(0, 90)}」`);
        await page.click('#cancel');
      }
      const h1 = await hashNow(page);
      if (h0 !== h1) stat.bad.push(`${m}/${b} 預覽改變了引擎狀態`);
    }
    check(`${tag} X-10 A：預覽顯示兩側執念指標與「執念會讓牠拿 X 側——除非那側會讓牠死」（與獨立算法逐線一致，預覽不改狀態）`, stat.bad.length === 0 && stat.sided > 0 && stat.even > 0, `有分高下 ${stat.sided} 線、不分高下 ${stat.even} 線；${stat.bad.slice(0, 2).join(' || ')}`);
    // BASELINE／B 不得出現執念預覽；A 不得出現傷口勾選
    await selectMode(page, 'BASELINE', '1'); let info = await linesInfo(page); await drag(page, info.lines[3].i, info.lines[3].j);
    const baseTxt = await page.textContent('#preview'); const keepBase = await page.isVisible('#keepRow'); await page.click('#cancel');
    await selectMode(page, 'A1', '1'); info = await linesInfo(page); await drag(page, info.lines[3].i, info.lines[3].j);
    const keepA = await page.isVisible('#keepRow'); await page.click('#cancel');
    check(`${tag} X-10 BASELINE 沒有執念提示與傷口勾選；A 沒有傷口勾選`, !baseTxt.includes('執念') && !keepBase && !keepA);
    await ctx.close();
  }

  // ===== B：傷口勾選／原因／傷口線／封存圖示／撕裂預覽／癒合（X-10） =====
  {
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(E);
    await selectMode(page, 'B', '1');
    await page.evaluate(() => window.__proto.setSkip(true));
    // 勾選面板：0 顆不能勾（附原因）、1～2 顆可勾（附說明）、≥3 顆不能勾
    let info = await linesInfo(page);
    const zero = info.lines.find((l) => l.pierced.length === 0), keepable = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2), many = info.lines.find((l) => l.pierced.length >= 3);
    const panel = async (l) => { await drag(page, l.i, l.j); const r = await page.evaluate(() => ({ vis: !document.getElementById('keepRow').hidden, dis: document.getElementById('keepWound').disabled, why: document.getElementById('keepWhy').textContent })); await page.click('#cancel'); return r; };
    const pz = zero ? await panel(zero) : null, pk = await panel(keepable), pm = many ? await panel(many) : null;
    check(`${tag} X-10 B 確認面板：留下傷口勾選＋說明＋不能勾的原因`,
      pk.vis && !pk.dis && pk.why.includes('刀中效果延到下回合、加倍；下回合切線要穿過傷口才會發動') && (!pz || (pz.dis && pz.why.includes('沒有切穿'))) && (!many || (pm.dis && pm.why.includes('3 顆以上'))),
      JSON.stringify({ zero: pz, keepable: pk, many: pm }));
    // 留傷口 → 傷口線與圖示
    const sealedKeys = keepable.pierced;
    await cut(page, keepable.i, keepable.j, true);
    const st1 = await page.evaluate(() => ({ wound: window.__proto.state.wound, round: window.__proto.state.round, rev: document.getElementById('preview').textContent, log: window.__proto.log.rounds[0] }));
    const px = await woundPixels(page);
    check(`${tag} X-10 B 留下傷口：軀體上畫傷口線（金色點線）＋封存器官小圖示，狀態＝封存 ${sealedKeys.length} 顆`,
      !!st1.wound && st1.wound.sealed.length === sealedKeys.length && px && px.hits >= px.total * 0.4 && px.iconOk === px.icons && px.icons === sealedKeys.length, JSON.stringify({ px, sealed: st1.wound && st1.wound.sealed.map((o) => o.key) }));
    check(`${tag} X-10 B 回顧寫出「留下傷口」，紀錄 keepWound=true`, st1.rev.includes('留下傷口') && st1.log.keepWound === true && st1.log.wound.some((w) => w.op === 'KEEP'), st1.rev.slice(0, 80));
    // 預覽：穿過傷口的線顯示「這刀會撕裂傷口：＋…」，不穿過的不顯示；穿過時不能再留新傷口
    info = await linesInfo(page);
    const cr = info.lines.find((l) => crosses(info, l)), non = info.lines.find((l) => !crosses(info, l));
    await drag(page, cr.i, cr.j);
    const tearView = await page.evaluate(() => ({ txt: document.getElementById('preview').textContent, dis: document.getElementById('keepWound').disabled, why: document.getElementById('keepWhy').textContent }));
    const pxTear = await woundPixels(page);
    await page.click('#cancel');
    await drag(page, non.i, non.j);
    const nonView = await page.evaluate(() => ({ txt: document.getElementById('preview').textContent }));
    await page.click('#cancel');
    check(`${tag} X-10 B 預覽：穿過傷口顯示「這刀會撕裂傷口：＋…」並列出封存內容，撕裂回合不能再留傷口；沒穿過不顯示`,
      tearView.txt.includes('這刀會撕裂傷口：＋') && sealedKeys.every((k) => tearView.txt.includes({ heart: '心', shield: '盾', poison: '毒', fission: '裂', regen: '生', mirror: '鏡' }[k])) && tearView.txt.includes('×2') && tearView.dis && tearView.why.includes('撕裂')
      && !nonView.txt.includes('這刀會撕裂傷口') && !!pxTear, JSON.stringify({ cr: [cr.i, cr.j], non: [non.i, non.j], tear: tearView.txt.slice(0, 120) }));
    // 撕裂結算（回顧與紀錄）
    await cut(page, cr.i, cr.j);
    const st2 = await page.evaluate(() => ({ wound: window.__proto.state.wound, rev: document.getElementById('preview').textContent, ev: window.__proto.lastEvents.filter((e) => e.t === 'WOUND').map((e) => e.op), rec: window.__proto.log.rounds[1] }));
    // 癒合：再留一次，下一刀不穿過
    info = await linesInfo(page);
    const k2 = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2);
    await cut(page, k2.i, k2.j, true);
    info = await linesInfo(page);
    const non2 = info.lines.find((l) => !crosses(info, l));
    await cut(page, non2.i, non2.j);
    const st3 = await page.evaluate(() => ({ wound: window.__proto.state.wound, rev: document.getElementById('preview').textContent, ev: window.__proto.lastEvents.filter((e) => e.t === 'WOUND').map((e) => e.op), rec: window.__proto.log.rounds[3] }));
    check(`${tag} X-10 B 回顧與紀錄：撕裂／癒合各寫出，傷口清除`,
      st2.ev[0] === 'TEAR' && st2.rev.includes('撕裂傷口') && st2.wound === null && st2.rec.wound.some((w) => w.op === 'TEAR') && st2.rec.tearHpLoss !== undefined
      && st3.ev[0] === 'HEAL' && st3.rev.includes('傷口癒合') && st3.wound === null && st3.rec.wound.some((w) => w.op === 'HEAL'), JSON.stringify({ st2: st2.ev, st3: st3.ev }));
    check(`${tag} X-10 B 全程無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }

  // ===== X-10 版面：三種狀態 × iPhone 14 Pro／SE 尺寸 × A1／B =====
  for (const [sizeName, [w, h]] of Object.entries(SIZES)) for (const m of ['A1', 'B']) {
    const { ctx, page } = await newPage(browser, bname, devices, w, h);
    await page.goto(E);
    await selectMode(page, m, '1');
    const probes = {};
    probes.IDLE = await layoutProbe(page);
    // DRAG 中
    const info = await linesInfo(page);
    const A = await page.evaluate((k) => window.__proto.anchorScreen(k), info.lines[0].i);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(A.x + 40, A.y + 30, { steps: 3 });
    const inDrag = await page.evaluate(() => window.__proto.ui);
    probes.DRAG = await layoutProbe(page);
    await page.mouse.up();
    await page.evaluate(() => { window.__proto.setSkip(false); });
    const line = m === 'B' ? info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2) : info.lines[4];
    await drag(page, line.i, line.j);
    probes.PENDING = await layoutProbe(page);
    if (m === 'B') await page.click('#keepRow label');
    await page.click('#confirm');
    await page.waitForFunction(() => window.__proto.ui === 'EXECUTE', null, { timeout: 3000 }).catch(() => {});
    probes.EXECUTE = await layoutProbe(page);
    await waitIdleOrEnd(page);
    probes.AFTER = await layoutProbe(page);
    if (m === 'B') { const px = await woundPixels(page); probes.AFTER.woundDrawn = !!px && px.hits > 0; }
    const bad = Object.entries(probes).filter(([, p]) => !probeOk(p) || p.woundDrawn === false);
    check(`${tag} X-10 版面 ${sizeName} ${w}×${h} ${m}：待機／拖曳／待確認／演出／回合後，新 UI 不遮擋畫布（錨點、器官皆在最上層）、按鈕與選單 ≥44px、不重疊、不出界`,
      inDrag === 'DRAG' && bad.length === 0, bad.map(([k, p]) => k + probeDetail(p)).join(' ').slice(0, 600));
    await ctx.close();
  }

  // ===== 完整一局：回顧、問卷 Q1～Q5、紀錄匯出（X-10 / X-11）；每模式兩種尺寸之一 =====
  let obsTotal = 0;
  for (const [m, sizeName] of [['BASELINE', 'iPhone14Pro'], ['A1', 'iPhone14Pro'], ['A2', 'iPhoneSE'], ['B', 'iPhoneSE']]) {
    const [w, h] = SIZES[sizeName];
    const { ctx, page } = await newPage(browser, bname, devices, w, h);
    await page.goto(E);
    await selectMode(page, m, 'free');
    // 自由盤面 seed 隨機：改用固定盤面 2 讓每次可重現
    await page.selectOption('#boardSel', '2');
    const trail = await autoPlay(page);
    const endVisible = await page.isVisible('#endPanel');
    const logFull = await page.evaluate(() => JSON.parse(window.__proto.exportText()));
    const evAll = logFull.rounds.flatMap((r) => r.events);
    const obsIndep = evAll.filter((e) => e.t === 'CHOICE' && e.reason === 'OBSESSION').length;
    const wIndep = evAll.filter((e) => e.t === 'WOUND').reduce((a, e) => { a[e.op] = (a[e.op] ?? 0) + 1; return a; }, {});
    obsTotal += obsIndep;
    // 摘要
    const sumTxt = await page.textContent('#endSummary'); const title = await page.textContent('#endTitle');
    const kind = m.startsWith('A') ? 'A' : m;
    const sumOk = sumTxt.includes('回合數') && sumTxt.includes(String(logFull.roundsPlayed)) && sumTxt.includes('結果')
      && (kind === 'A' ? sumTxt.replace(/\s/g, '').includes(`執念觸發次數${obsIndep}`) : sumTxt.includes('執念觸發次數') && sumTxt.includes('沒有執念'))
      && (kind === 'B' ? sumTxt.replace(/\s/g, '').includes(`傷口留／撕／癒${wIndep.KEEP ?? 0}／${wIndep.TEAR ?? 0}／${wIndep.HEAL ?? 0}`) : sumTxt.includes('沒有傷口'));
    check(`${tag} X-10 ${m} 戰鬥結束簡短回顧（模式、回合數、結果、執念觸發次數、傷口留／撕／癒）與獨立統計相符`, endVisible && sumOk && title.length > 0, `${logFull.roundsPlayed} 回合 結果 ${logFull.result} 執念 ${obsIndep} 傷口 ${JSON.stringify(wIndep)}｜${sumTxt.replace(/\s+/g, ' ').slice(0, 110)}`);
    // 問卷：題目文字與可操作（用真實點擊；選項標籤 ≥44px）
    const qs = await page.$$eval('#survey legend', (ls) => ls.map((l) => l.textContent.trim()));
    const sizes = await page.$$eval('#endPanel button, #endPanel .opt, #endPanel textarea', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, x: r.left, r: r.right }; }));
    const sizeBad = sizes.filter((s) => s.h < 43.5 || s.x < -0.5 || s.r > w + 0.5).length;
    await page.click('.opt:has(input[name="Q1"][value="部分"])');
    await page.click('.opt:has(input[name="Q2"][value="是"])');
    await page.click('.opt:has(input[name="Q3"][value="否"])');
    await page.fill('#q4', '第三刀；因為牠被執念牽著走');
    await page.click('.opt:has(input[name="Q5"][value="是"])');
    await page.fill('#q5why', '想試另一種切法');
    const ans = await page.evaluate(() => JSON.parse(window.__proto.exportText()).survey);
    check(`${tag} X-10 ${m} 問卷 Q1～Q5 文字照凍結令、可操作，答案併入紀錄`,
      JSON.stringify(qs) === JSON.stringify(SURVEY_TEXT) && sizeBad === 0 && ans.Q1 === '部分' && ans.Q2 === '是' && ans.Q3 === '否' && ans.Q4 === '第三刀；因為牠被執念牽著走' && ans.Q5 === '是' && ans.Q5_why === '想試另一種切法', JSON.stringify({ qs: qs.length, sizeBad, ans }));
    // 匯出：點「複製本局紀錄」；Chromium 讀剪貼簿、WebKit 走手動複製視窗；內容必須＝匯出文字
    await page.click('#exportBtn2');
    await page.waitForTimeout(150);
    const exp = await page.evaluate(() => window.__proto.exportText());
    let copied = null;
    if (await page.isVisible('#exportModal')) { copied = await page.inputValue('#exportBox'); await page.click('#exportClose'); }
    else if (bname === 'chromium') copied = await page.evaluate(() => navigator.clipboard.readText());
    else copied = await page.evaluate(() => window.__copied ?? null);
    check(`${tag} X-10 ${m} 匯出紀錄：複製（或手動複製視窗）內容＝本局紀錄＋問卷答案`, copied === exp && JSON.parse(copied).survey.Q5_why === '想試另一種切法', `copied=${copied === null ? 'null' : copied.length} exp=${exp.length}`);
    // localStorage：最近紀錄含本局與問卷
    const ls = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('funexp01.recent')); } catch (e) { return String(e); } });
    check(`${tag} X-11 ${m} localStorage 只存最近幾局（≤5）且含本局問卷答案、不含個人識別`, Array.isArray(ls) && ls.length >= 1 && ls.length <= 5 && ls.at(-1).survey.Q1 === '部分' && !/email|userAgent|deviceId|ip"/i.test(JSON.stringify(ls)));
    // X-11 欄位
    const lg = JSON.parse(exp);
    const topKeys = Object.keys(lg).sort(), expTop = [...TOP_KEYS].sort();
    const fieldsOk = JSON.stringify(topKeys) === JSON.stringify(expTop) && lg.rounds.length === lg.roundsPlayed && lg.rounds.length >= 1
      && lg.rounds.every((r, k) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify([...ROUND_KEYS].sort())
        && Number.isInteger(r.i) && Number.isInteger(r.j) && Array.isArray(r.sideL) && Array.isArray(r.sideR) && typeof r.obsessionTriggered === 'boolean' && Array.isArray(r.wound)
        && typeof r.hpBefore.P === 'number' && typeof r.hpAfter.E === 'number' && typeof r.keepWound === 'boolean' && r.round === k + 1
        && r.choiceReason === (r.events.find((e) => e.t === 'CHOICE')?.reason ?? null) && r.choiceSide === (r.events.find((e) => e.t === 'CHOICE')?.side ?? null)
        && r.obsessionTriggered === (r.choiceReason === 'OBSESSION') && (k === 0 ? r.hpBefore.E === lg.hpE && r.hpBefore.P === lg.hpP : JSON.stringify(r.hpBefore) === JSON.stringify(lg.rounds[k - 1].hpAfter)))
      && lg.modeId === m && typeof lg.commit === 'string' && lg.commit.length >= 7 && lg.seed === 2003 && typeof lg.specVersion === 'string' && lg.specVersion.length > 0 && (m === 'BASELINE' || lg.specVersion.includes('FUN-EXP-01'))
      && ['WIN', 'LOSS', 'STALL'].includes(lg.result);
    const pii = /email|useragent|deviceid|"ip"|name":|userid|phone|cookie|fingerprint/i.test(JSON.stringify(Object.keys(lg)) + JSON.stringify(lg.rounds.map((r) => Object.keys(r))));
    check(`${tag} X-11 ${m} 紀錄欄位齊全（模式、規格版本、commit、seed、每回合 i/j、兩側器官、選邊理由、HP 前後、執念、傷口、結果、回合數）且不含個人識別欄位`, fieldsOk && !pii, `keys=${topKeys.length}`);
    // B：傷口留／撕／癒 在紀錄中與事件一致
    if (m === 'B') check(`${tag} X-11 B 紀錄 wound 欄位與引擎 WOUND 事件逐回合一致（留／撕／癒）`, lg.rounds.every((r) => JSON.stringify(r.wound.map((x) => x.op)) === JSON.stringify(r.events.filter((e) => e.t === 'WOUND').map((e) => e.op))) && (wIndep.KEEP ?? 0) >= 1 && (wIndep.TEAR ?? 0) >= 1, JSON.stringify(wIndep));
    if (m === 'B') {
      // 剪貼簿被拒絕時的備援：跳出可手動複製的文字視窗，內容＝本局紀錄
      await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
      await page.click('#exportBtn2'); await page.waitForTimeout(150);
      const shown = await page.isVisible('#exportModal') ? await page.inputValue('#exportBox') : null;
      check(`${tag} X-10 B 剪貼簿被拒絕時：自動跳出手動複製視窗，內容＝本局紀錄`, shown === exp, `shown=${shown === null ? 'null' : shown.length}`);
      if (shown !== null) await page.click('#exportClose');
    }
    writeFileSync(`${logDir}/${bname}_${m}.json`, exp);
    check(`${tag} X-10 ${m} 整局無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }
  check(`${tag} X-5/X-10 A 模式實際出現執念觸發（OBSESSION 事件 > 0，回顧統計不是恆 0）`, obsTotal > 0, `OBSESSION 事件 ${obsTotal}`);

  // ===== X-4 瀏覽器決定性：與 Node 逐回合雜湊相同、同輸入兩次相同 =====
  {
    const { expHashes } = await import('./exp_entry.ts');
    const seeds = Array.from({ length: 24 }, (_, k) => 800001 + k), modes = ['BASELINE', 'A1', 'A2', 'B'];
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ path: 'dist-test/exp_browser.js' });
    const b1 = await page.evaluate(([m, s]) => window.__expHashes(m, s), [modes, seeds]);
    const b2 = await page.evaluate(([m, s]) => window.__expHashes(m, s), [modes, seeds]);
    const n1 = expHashes(modes, seeds);
    const diff = [], sizes = [];
    for (const m of modes) { sizes.push(`${m}:${b1[m].length}局`); b1[m].forEach((h, k) => { if (h !== n1[m][k]) diff.push(`${m}/${seeds[k]}`); if (h !== b2[m][k]) diff.push(`${m}/${seeds[k]}(重播)`); }); }
    const rounds = modes.map((m) => b1[m].reduce((a, h) => a + h.split(',').length, 0));
    check(`${tag} X-4 瀏覽器決定性：四模式 × ${seeds.length} seeds 到戰鬥結束，逐回合（狀態＋事件）雜湊與 Node 相同，同輸入重播兩次相同`, diff.length === 0 && rounds.every((r) => r > seeds.length * 3), `${sizes} 回合雜湊數 ${rounds} 差異 ${diff.slice(0, 3)}`);
    await page.close();
  }

  // ===== X-12 子路徑部署準備：scope／快取／manifest 與根網址版本互不干擾 =====
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    const sw = async (p, base) => p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active && r.active.scriptURL }; });
    await page.goto(url + '/'); const rootSw = await sw(page);
    const rootMan = await page.evaluate(async () => { const j = await (await fetch('./manifest.webmanifest')).json(); return { start: new URL(j.start_url, location.href).pathname, scope: new URL(j.scope, location.href).pathname, id: j.id }; });
    await page.goto(E); const expSw = await sw(page);
    const expMan = await page.evaluate(async () => { const j = await (await fetch('./manifest.webmanifest')).json(); return { start: new URL(j.start_url, location.href).pathname, scope: new URL(j.scope, location.href).pathname, id: j.id, name: j.name }; });
    await page.reload(); await page.waitForTimeout(500);
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    const keys = await page.evaluate(() => caches.keys());
    const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope).sort());
    const u = new URL(url);
    check(`${tag} X-12 子路徑：manifest start_url／scope／id 與根網址版本不同；SW scope 為子路徑；兩個 SW 同時存在`,
      rootMan.start === '/' && rootMan.scope === '/' && expMan.start === '/fun-exp-01/' && expMan.scope === '/fun-exp-01/' && expMan.id !== rootMan.id && expMan.id.length > 0
      && rootSw.scope === `${u.origin}/` && expSw.scope === `${u.origin}/fun-exp-01/` && expSw.script.endsWith('/fun-exp-01/sw.js') && regs.length === 2 && ctl, JSON.stringify({ rootMan, expMan, rootSw, expSw, regs }));
    check(`${tag} X-12 子路徑：快取名稱獨立（thecut-funexp01-* 與 thecut-protob-* 並存，互不覆蓋）`, keys.some((k) => k.startsWith('thecut-funexp01-')) && keys.some((k) => k.startsWith('thecut-protob-')), JSON.stringify(keys));
    if (bname === 'chromium') {
      await ctx.setOffline(true);
      let off = false;
      try { await page.reload(); off = (await page.evaluate(() => window.__proto && window.__proto.state.round)) === 1; } catch { off = false; }
      await ctx.setOffline(false);
      check(`${tag} X-12 子路徑：離線可重開（實驗版 SW 快取有效）`, off);
    }
    check(`${tag} X-12 子路徑頁面無錯誤`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ===== 截圖（iPhone 14 Pro 尺寸，三模式各一張：待確認狀態） =====
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(E);
    for (const [m, file] of [['BASELINE', 'baseline'], ['A1', 'expA_A1'], ['B', 'expB']]) {
      await selectMode(page, m, '1');
      if (m === 'B') { let info = await linesInfo(page); const k = info.lines.find((l) => l.pierced.length >= 1 && l.pierced.length <= 2); await page.evaluate(() => window.__proto.setSkip(true)); await cut(page, k.i, k.j, true); }
      const info = await linesInfo(page);
      const l = m === 'B' ? info.lines.find((x) => crosses(info, x)) : m === 'A1' ? (info.lines.find((x) => expectedObsession(info.enemy, x)) ?? info.lines[4]) : info.lines[4];
      await drag(page, l.i, l.j);
      await page.screenshot({ path: `${shotsDir}/${bname}_${file}_14pro.png` });
      await page.click('#cancel');
    }
    await ctx.close();
  }
  await browser.close();
}
