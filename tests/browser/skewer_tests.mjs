// 串刺（core-skewer）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，不是 iPhone 實機）。由 run.mjs 逐瀏覽器呼叫。
// 涵蓋：K-2 淡影與決定性、K-3 示例路線經真實拖曳重現、K-4 預覽不給答案、K-5 點選對照組、K-6 紀錄與問卷、K-7 盤面循環、
// K-8 手機版面（iPhone 14 Pro、iPhone SE）、子路徑 PWA（scope／快取前綴／manifest 獨立）。
// 判定來源：規則模組（src/skewer/*，與 Node 單元測試同一份）或測試自己寫死的 brief 數值；不讀畫面文字函式。
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { newPage } from './exp_tests.mjs';
import { boardById, BOARDS } from '../../src/skewer/boards.ts';
import { organPos } from '../../src/skewer/rules.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const HEART_LINE = { '500,430': [500, 330, 500, 530], '600,560': [500, 460, 700, 660], '500,660': [400, 660, 600, 660], '400,560': [300, 560, 500, 560] };
const heartLine = (id, t) => HEART_LINE[organPos(boardById(id).organs.find((o) => o.id === 'heart'), t).join(',')];
const CLAWS_T1 = [250, 450, 750, 450], SKEWER3 = [250, 370, 750, 490];
const ROUTES = {
  'A-1': { board: 'A', lines: [CLAWS_T1, heartLine('A', 2), heartLine('A', 3), heartLine('A', 4)], result: 'lose', turn: 4, hpP: 20, hpE: 10 },
  'A-2': { board: 'A', lines: [heartLine('A', 1), SKEWER3, heartLine('A', 3)], result: 'win', turn: 3, hpP: 14, hpE: -2 },
  'B-wait': { board: 'B', lines: [heartLine('B', 1), heartLine('B', 2)], result: 'lose', turn: 2, hpP: -4, hpE: 22 },
  'B-now': { board: 'B', lines: [CLAWS_T1, ...[2, 3, 4, 5, 6, 7].map((t) => heartLine('B', t))], result: 'win', turn: 7, hpP: 20, hpE: -2 },
};
const TOP_KEYS = ['format', 'commit', 'mode', 'board', 'rounds', 'result', 'loseReason', 'turnsPlayed', 'final', 'survey'].sort();
const ROUND_KEYS = ['turn', 'line', 'hits', 'sacs', 'valueSum', 'mult', 'damage', 'poisonDmg', 'clawDmg', 'hpEBefore', 'hpEAfter', 'hpPBefore', 'hpPAfter', 'thinkMs', 'cancels', 'offered', 'picked'].sort();

async function dragLine(page, l, release = true) {
  const a = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[0], l[1]]);
  const b = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[2], l[3]]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 3 });
  if (release) await page.mouse.up();
}
const S = (page) => page.evaluate(() => ({ ui: window.__skewer.ui, turn: window.__skewer.state.turn, hpE: window.__skewer.state.hpE, hpP: window.__skewer.state.hpP, result: window.__skewer.state.result }));
async function waitIdleOrEnd(page) { await page.waitForFunction(() => ['IDLE', 'END'].includes(window.__skewer.ui), null, { timeout: 8000 }); }
/** 用真實拖曳打完一條路線；回傳最終狀態與紀錄。 */
async function playDraw(page, route) {
  await page.evaluate((id) => window.__skewer.newGame(id, 'draw'), route.board);
  for (const l of route.lines) { await dragLine(page, l); await page.click('#confirm'); await waitIdleOrEnd(page); }
  return { st: await S(page), log: await page.evaluate(() => window.__skewer.log) };
}
/** 點選模式：每回合點「穿刺組合與這條路線那一刀相同」的候選線（組合由規則模組算，與畫面無關）。 */
async function playPick(page, route) {
  await page.evaluate((id) => window.__skewer.newGame(id, 'pick'), route.board);
  const counts = [];
  for (const l of route.lines) {
    const cands = await page.evaluate(() => window.__skewer.cands());
    counts.push(cands.length);
    // 這一刀在畫線模式會穿到的組合：用同一盤面、同一回合的 evalLine 求得（測試端以 rules 模組計算）
    const key = await keyOf(page, l);
    const k = cands.findIndex((c) => [...c.hits].sort().join('+') + '|' + (c.sacs.length ? 'poison' : '') === key);
    if (k < 0) return { st: await S(page), log: null, counts, missing: key };
    await page.click(`#cand${k}`); await page.click('#confirm'); await waitIdleOrEnd(page);
  }
  return { st: await S(page), log: await page.evaluate(() => window.__skewer.log), counts };
}
async function keyOf(page, l) {
  const { evalLine } = await import('../../src/skewer/rules.ts');
  const st = await page.evaluate(() => window.__skewer.state);
  const ev = evalLine(boardById(st.boardId), st, l);
  return [...ev.hits].sort().join('+') + '|' + (ev.sacs.length ? 'poison' : '');
}
const strip = (log) => log.rounds.map((r) => ({ turn: r.turn, hits: r.hits, sacs: r.sacs, valueSum: r.valueSum, mult: r.mult, damage: r.damage, poisonDmg: r.poisonDmg, clawDmg: r.clawDmg, hpEBefore: r.hpEBefore, hpEAfter: r.hpEAfter, hpPBefore: r.hpPBefore, hpPAfter: r.hpPAfter }));

async function layoutCheck(page, w, h) {
  return page.evaluate(([w, h]) => {
    const vis = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
    const boxes = [...document.querySelectorAll('button, select')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent, w: r.width, h: r.height, x: r.x, y: r.y, r: r.right, b: r.bottom }; });
    const small = boxes.filter((b) => b.w < 44 || b.h < 44).map((b) => b.id);
    const overlap = [];
    for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) { const p = boxes[a], q = boxes[c]; if (p.x < q.r - 1 && q.x < p.r - 1 && p.y < q.b - 1 && q.y < p.b - 1) overlap.push(`${p.id}/${q.id}`); }
    const out = boxes.filter((b) => b.x < 0 || b.y < 0 || b.r > w + 1 || b.b > h + 1).map((b) => b.id);
    const cv = document.getElementById('board').getBoundingClientRect();
    const head = document.querySelector('header').getBoundingClientRect(), foot = document.querySelector('footer').getBoundingClientRect();
    const inCanvas = (x, y, r = 0) => x - r >= cv.left - 0.5 && x + r <= cv.right + 0.5 && y - r >= cv.top - 0.5 && y + r <= cv.bottom + 0.5;
    const organsOut = window.__skewer.organScreen().filter((o) => !inCanvas(o.x, o.y, o.r)).map((o) => o.id);
    const bodyOut = window.__skewer.bodyScreen().filter((p) => !inCanvas(p.x, p.y)).length;
    // 有沒有任何可見的介面元素蓋在器官上（elementFromPoint 取最上層）
    const covered = window.__skewer.organScreen().filter((o) => document.elementFromPoint(o.x, o.y)?.id !== 'board').map((o) => o.id);
    return { small, overlap, out, organsOut, bodyOut, covered, sandwich: head.bottom <= cv.top + 1 && foot.top >= cv.bottom - 1, hscroll: document.documentElement.scrollWidth > w + 1, cvH: Math.round(cv.height) };
  }, [w, h]);
}

export async function runSkewerTests({ bname, btype, devices, url, check, shotsDir }) {
  const browser = await btype.launch();
  const U = url + '/core-skewer/';
  const tag = `[${bname}] 串刺`;
  const shaBuilt = readFileSync('dist-skewer/index.html', 'utf8').match(/name="build-sha" content="([^"]+)"/)[1];
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  // ===== 基本、K-3、K-4、K-5、K-6、K-7（iPhone 14 Pro 尺寸） =====
  {
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(U);
    const top = await page.textContent('#top');
    check(`${tag} 頁面顯示版本 SHA 與「研究片段」字樣（子路徑 core-skewer/）`, top.includes(shaBuilt) && top.includes('研究片段') && (await page.getAttribute('meta[name="build-sha"]', 'content')) === shaBuilt, `sha ${shaBuilt}`);

    // K-2 淡影＝下一回合位置（規則模組獨立算）
    const gh = await page.evaluate(() => window.__skewer.ghosts());
    const A = boardById('A');
    const expGh = A.organs.map((o) => ({ id: o.id, pos: [...organPos(o, 2)] }));
    check(`${tag} K-2 淡影顯示每顆器官下一回合的位置`, JSON.stringify(gh.map((g) => ({ id: g.id, pos: [...g.pos] }))) === JSON.stringify(expGh), JSON.stringify(gh));

    // K-3 示例路線（真實拖曳、跳過演出）
    await page.evaluate(() => window.__skewer.setSkip(true));
    const drawLogs = {};
    for (const [name, r] of Object.entries(ROUTES)) {
      const { st, log } = await playDraw(page, r);
      drawLogs[name] = log;
      const endShown = await page.isVisible('#endPanel');
      check(`${tag} K-3 ${name}（畫線）：${r.result === 'win' ? '勝' : '輸'}、第 ${r.turn} 回合、玩家 ${r.hpP}、怪物 ${r.hpE}`,
        st.result === r.result && st.turn === r.turn && st.hpP === r.hpP && st.hpE === r.hpE && st.ui === 'END' && endShown, JSON.stringify(st));
    }
    check(`${tag} K-3 示例甲-2 第 2 回合串 3＝24、不碰毒囊`, drawLogs['A-2'].rounds[1].damage === 24 && drawLogs['A-2'].rounds[1].mult === 3 && drawLogs['A-2'].rounds[1].sacs.length === 0, JSON.stringify(drawLogs['A-2'].rounds[1]));

    // K-2 決定性：同盤面同輸入再打一次，逐值相同（只差思考時間）
    const again = await playDraw(page, ROUTES['A-2']);
    check(`${tag} K-2 同輸入兩次結算逐值相同`, JSON.stringify(strip(again.log)) === JSON.stringify(strip(drawLogs['A-2'])) && JSON.stringify(again.log.rounds.map((r) => r.line)) === JSON.stringify(drawLogs['A-2'].rounds.map((r) => r.line)));

    // K-4 預覽不給答案：示例甲第 2 回合拖出串 3 的線（未放開、放開待確認），DOM 不含這刀的傷害或倍率
    await page.evaluate(() => window.__skewer.newGame('A', 'draw'));
    await dragLine(page, heartLine('A', 1)); await page.click('#confirm'); await waitIdleOrEnd(page);
    await page.evaluate(() => window.__skewer.setSkip(false));
    await dragLine(page, SKEWER3, false);
    const during = await page.evaluate(() => ({ text: document.body.innerText, html: document.body.innerHTML, prev: window.__skewer.preview, ui: window.__skewer.ui }));
    if (shotsDir && bname === 'webkit') await page.screenshot({ path: join(shotsDir, 'iPhone14Pro_畫線模式_拖曳中.png') });
    await page.mouse.up();
    const pend = await page.evaluate(() => ({ text: document.body.innerText, html: document.body.innerHTML, ui: window.__skewer.ui, dis: document.getElementById('confirm').disabled }));
    // 這一刀的答案＝傷害 24、倍率 ×3。DOM 原始碼不得出現 24 或「×數字」（規則面板的公式「× 串數」不是數字、且收起時不可見）；可見文字不得有 ×。
    const noAns = (t) => !t.includes('24') && !/×\s*\d/.test(t) && !t.includes('倍率');
    check(`${tag} K-4 拖曳中：高亮穿到的三顆器官，DOM 不含傷害 24 或倍率`, during.ui === 'DRAG' && JSON.stringify(during.prev.hits) === '["clawL","heart","clawR"]' && noAns(during.text) && !during.text.includes('×') && noAns(during.html), during.text.slice(0, 120));
    check(`${tag} K-4 放開待確認：DOM 仍不含傷害或倍率、確認鈕可按`, pend.ui === 'PENDING' && !pend.dis && noAns(pend.text) && !pend.text.includes('×') && noAns(pend.html));
    await page.click('#confirm');
    const anim = await page.evaluate(() => window.__skewer.ui);
    await waitIdleOrEnd(page);
    const rev = await page.textContent('#info');
    if (shotsDir && bname === 'webkit') await page.screenshot({ path: join(shotsDir, 'iPhone14Pro_結算回顧.png') });
    check(`${tag} 確認後才演出（串數→倍率），演出結束顯示結算回顧（×3＝24）`, anim === 'ANIM' && rev.includes('結算回顧') && rev.includes('(2+4+2)×3＝24'), rev);
    // 非法線：變體丙第 1 回合兩爪橫線被骨板擋住；碰毒囊提示
    await page.evaluate(() => { window.__skewer.setSkip(true); window.__skewer.newGame('C', 'draw'); });
    await dragLine(page, CLAWS_T1);
    const ill = await page.evaluate(() => ({ info: document.getElementById('info').textContent, dis: document.getElementById('confirm').disabled, legal: window.__skewer.preview.legal }));
    await page.click('#cancel');
    await dragLine(page, [600, 300, 600, 700]);
    const poi = await page.textContent('#info');
    check(`${tag} K-4 非法線顯示原因且不能確認；碰毒囊有提示`, ill.legal === false && ill.dis && ill.info.includes('骨板擋住') && poi.includes('毒囊'), `${ill.info}｜${poi}`);
    await page.click('#cancel');

    // K-5 點選對照組：同盤面、同選擇，結算與畫線模式逐值相同
    for (const name of ['A-2', 'B-now', 'A-1', 'B-wait']) {
      const r = ROUTES[name];
      const pk = await playPick(page, r);
      check(`${tag} K-5 ${name}（點選）：每回合 3～5 條候選、結算與畫線版逐值相同`,
        !pk.missing && pk.counts.every((n) => n >= 3 && n <= 5) && pk.log && JSON.stringify(strip(pk.log)) === JSON.stringify(strip(drawLogs[name])) && pk.log.mode === 'pick',
        pk.missing ? `缺組合 ${pk.missing}` : `counts ${pk.counts}`);
    }
    // 點選模式截圖（示例甲第 2 回合、選中串 3 的那條）
    await page.evaluate(() => window.__skewer.newGame('A', 'pick'));
    { const c = await page.evaluate(() => window.__skewer.cands()); await page.click(`#cand${c.findIndex((x) => x.hits.length === 0 ? false : x.hits.includes('heart') && x.hits.length === 1 && !x.sacs.length)}`); await page.click('#confirm'); await waitIdleOrEnd(page); }
    { const c = await page.evaluate(() => window.__skewer.cands()); await page.click(`#cand${c.findIndex((x) => x.hits.length === 3)}`); }
    const pickTxt = await page.evaluate(() => document.body.innerText);
    if (shotsDir && bname === 'webkit') await page.screenshot({ path: join(shotsDir, 'iPhone14Pro_點選模式.png') });
    check(`${tag} K-4 點選模式選中候選線時也不顯示傷害或倍率`, noAns(pickTxt) && !pickTxt.includes('×') && (await page.locator('#pickRow button').count()) >= 3);

    // K-6 紀錄與問卷：示例甲-2（畫線），第 1 回合先畫一次再取消
    await page.evaluate(() => window.__skewer.newGame('A', 'draw'));
    await dragLine(page, CLAWS_T1); await page.click('#cancel');
    for (const l of ROUTES['A-2'].lines) { await dragLine(page, l); await page.click('#confirm'); await waitIdleOrEnd(page); }
    await page.click('#survey input[name="q1"][value="是"]'); await page.click('#survey input[name="q2"][value="有"]'); await page.click('#survey input[name="q3"][value="差不多"]');
    await page.evaluate(() => { window.__copied = undefined; });
    await page.click('#exportBtn2'); await page.waitForTimeout(150);
    let text = await page.evaluate(() => window.__copied);
    if (!text) { text = await page.inputValue('#exportBox'); await page.click('#exportClose'); }
    let log = null; try { log = JSON.parse(text); } catch { /* 下方判定失敗 */ }
    const rk = log ? log.rounds.map((r) => Object.keys(r).sort().join(',')) : [];
    check(`${tag} K-6 匯出紀錄欄位齊全且不多收（模式、盤面、端點、穿到、傷害、HP、思考時間、取消次數、結果、問卷）`,
      !!log && JSON.stringify(Object.keys(log).sort()) === JSON.stringify(TOP_KEYS) && rk.every((k) => k === ROUND_KEYS.join(','))
      && log.mode === 'draw' && log.board.id === 'A' && log.result === 'win' && log.rounds.length === 3 && log.rounds[0].cancels === 1 && log.rounds[1].cancels === 0
      && log.rounds.every((r) => Number.isInteger(r.thinkMs) && r.thinkMs >= 0 && r.line.length === 4 && r.line.every(Number.isInteger))
      && JSON.stringify(log.survey) === JSON.stringify({ q1: '是', q2: '有', q3: '差不多' }) && log.commit === shaBuilt
      && !/userAgent|navigator|timestamp|Date|ip"|email|"name":"(?!示例|變體)/.test(text), text ? text.slice(0, 160) : '無');

    // K-7 盤面選擇與下一局循環
    const opts = await page.$$eval('#boardSel option', (o) => o.map((x) => x.value));
    await page.evaluate(() => window.__skewer.newGame('A', 'draw'));
    const cyc = [];
    for (let k = 0; k <= BOARDS.length; k++) { cyc.push(await page.evaluate(() => window.__skewer.board.id)); await page.click('#nextBtn'); }
    await page.selectOption('#boardSel', 'C');
    const sel = await page.evaluate(() => window.__skewer.board.id);
    check(`${tag} K-7 至少 4 個盤面可選、「下一局」循環`, opts.length >= 4 && cyc.join('') === 'ABCDA' && sel === 'C', `${opts} ${cyc.join('')}`);
    check(`${tag} 全程無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }

  // ===== K-8 手機版面：iPhone 14 Pro、iPhone SE；畫線與點選兩模式；拖曳切線可完成 =====
  for (const [sname, [w, h]] of Object.entries(SIZES)) {
    const { ctx, page } = await newPage(browser, bname, devices, w, h);
    await page.goto(U);
    await page.evaluate(() => window.__skewer.setSkip(true));
    for (const mode of ['draw', 'pick']) {
      for (const id of ['A', 'C']) {
        await page.evaluate(([id, mode]) => window.__skewer.newGame(id, mode), [id, mode]);
        const L = await layoutCheck(page, w, h);
        check(`${tag} K-8 ${sname} ${mode === 'draw' ? '畫線' : '點選'}／${id}：按鈕 ≥44px、不重疊、不出界；器官與身體在畫布內、無介面遮擋、無橫向捲動`,
          L.small.length === 0 && L.overlap.length === 0 && L.out.length === 0 && L.organsOut.length === 0 && L.bodyOut === 0 && L.covered.length === 0 && L.sandwich && !L.hscroll && L.cvH >= 200, JSON.stringify(L));
      }
    }
    await page.evaluate(() => window.__skewer.newGame('A', 'draw'));
    await dragLine(page, heartLine('A', 1)); await page.click('#confirm'); await waitIdleOrEnd(page);
    const st = await S(page);
    check(`${tag} K-8 ${sname}：真實拖曳切線可完成一刀`, st.turn === 2 && st.hpE === 26 && st.hpP === 14, JSON.stringify(st));
    check(`${tag} K-8 ${sname}：無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }

  // ===== 子路徑 PWA：manifest／service worker scope／快取前綴獨立（Chromium；localhost 視為安全來源） =====
  if (bname === 'chromium') {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(U);
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise((x) => setTimeout(x, 500)); return { scope: r.scope, keys: await caches.keys() }; });
    const man = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    const swSrc = readFileSync('dist-skewer/sw.js', 'utf8'), expSw = readFileSync('dist-exp/sw.js', 'utf8'), rootSw = readFileSync('dist/sw.js', 'utf8');
    const prefix = (t) => t.match(/PREFIX = '([^']+)'/)?.[1] ?? t.match(/CACHE = '([^']+?)'/)?.[1];
    check(`${tag} 子路徑 PWA：SW scope＝/core-skewer/、快取前綴 thecut-coreskewer- 與根網址／fun-exp-01 不同、manifest id＝core-skewer`,
      sw.scope.endsWith('/core-skewer/') && sw.keys.length > 0 && sw.keys.every((k) => k.startsWith('thecut-coreskewer-')) && man.id === 'core-skewer' && man.scope === './' && man.start_url === './'
      && prefix(swSrc) === 'thecut-coreskewer-' && prefix(expSw) !== prefix(swSrc) && !rootSw.includes('thecut-coreskewer-'), JSON.stringify({ sw, id: man.id, exp: prefix(expSw) }));
    await ctx.close();
  }
  await browser.close();
}
