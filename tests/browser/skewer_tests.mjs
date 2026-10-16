// 串刺（core-skewer）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，不是 iPhone 實機）。由 run.mjs 逐瀏覽器呼叫。
// 涵蓋：K-2 淡影與決定性、K-3 示例路線經真實拖曳重現、K-4 預覽不給答案、K-5 點選對照組、K-6 紀錄與問卷、K-7 盤面循環、
// K-8 手機版面（iPhone 14 Pro、iPhone SE）、子路徑 PWA（scope／快取前綴／manifest 獨立）。
// R2 揮刀模式：S-1～S-8、S-11（ACCEPTANCE_SWIPE_FROZEN.md；真實滑鼠／觸控拖曳）。
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

  // ===== 揮刀模式（R2 凍結驗收 S-1～S-8、S-11；真實滑鼠／觸控拖曳，不呼叫內部結算函式） =====
  {
    const { evalLine } = await import('../../src/skewer/rules.ts');
    const isClaw = (bid, id) => boardById(bid).organs.find((o) => o.id === id)?.kind === 'claw';
    const { ctx, page } = await newPage(browser, bname, devices, 393, 852);
    await page.goto(U);
    // S-1 預設揮刀、放開即出刀（新開頁面，不呼叫 newGame）
    const m0 = await page.evaluate(() => window.__skewer.mode);
    const confirmVisible = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden' && b.textContent.includes('確認')));
    await page.evaluate(() => window.__skewer.setSkip(true));
    const s0 = await S(page);
    await dragLine(page, heartLine('A', 1)); // 放開；不點任何按鈕
    await waitIdleOrEnd(page).catch(() => {}); // 沒出刀時不中斷整組測試，交給下方判定記 FAIL
    const s1 = await S(page); const lg1 = await page.evaluate(() => window.__skewer.log);
    check(`${tag} S-1 預設揮刀：新開頁面模式＝swipe、沒有可見的確認鈕；真實拖曳放開即出刀（回合＋1、紀錄多一刀、模式欄位 swipe）`,
      m0 === 'swipe' && !confirmVisible && s0.turn === 1 && s1.turn === 2 && lg1.rounds.length === 1 && lg1.mode === 'swipe', JSON.stringify({ m0, confirmVisible, s0, s1, n: lg1.rounds.length, mode: lg1.mode }));

    // S-2 同一結算：揮刀真實拖曳重現甲-2（win、3、14）、甲-1（輸）；同一組線 draw 與 swipe 逐值相同
    const playSwipe = async (route) => {
      await page.evaluate((id) => window.__skewer.newGame(id, 'swipe'), route.board);
      for (const l of route.lines) { await dragLine(page, l); await waitIdleOrEnd(page); }
      return { st: await S(page), log: await page.evaluate(() => window.__skewer.log) };
    };
    for (const name of ['A-2', 'A-1', 'B-now', 'B-wait']) {
      const r = ROUTES[name];
      const sw = await playSwipe(r);
      const dr = await playDraw(page, r);
      check(`${tag} S-2 ${name}（揮刀）：${r.result === 'win' ? '勝' : '輸'}、第 ${r.turn} 回合、玩家 ${r.hpP}；與畫線模式同一組線結算逐值相同`,
        sw.st.result === r.result && sw.st.turn === r.turn && sw.st.hpP === r.hpP && sw.st.hpE === r.hpE && sw.st.ui === 'END' && sw.log.mode === 'swipe'
        && JSON.stringify(strip(sw.log)) === JSON.stringify(strip(dr.log)) && JSON.stringify(sw.log.rounds.map((x) => x.line)) === JSON.stringify(dr.log.rounds.map((x) => x.line)),
        JSON.stringify(sw.st));
    }

    // S-3 防誤觸：輕觸、短線 → 什麼都不算；非法線（骨板、沒穿過身體）→ 不出刀、原因文字 ≥ 1 秒
    await page.evaluate(() => window.__skewer.newGame('A', 'swipe'));
    { const p = await page.evaluate(() => window.__skewer.toScreen(500, 500)); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); }
    const tapSt = await S(page);
    await dragLine(page, [450, 500, 530, 500]); // 長 80 < 120
    const shortSt = await S(page);
    const sv = await page.evaluate(() => ({ rounds: window.__skewer.log.rounds.length, cancels: window.__skewer.cancels }));
    check(`${tag} S-3 輕觸與短線（< 120）：不出刀、回合不變、不計刀、不計取消`, tapSt.turn === 1 && tapSt.ui === 'IDLE' && shortSt.turn === 1 && shortSt.ui === 'IDLE' && sv.rounds === 0 && sv.cancels === 0, JSON.stringify({ tapSt, shortSt, sv }));
    const NOBODY = [150, 215, 280, 190];
    for (const [bid, l, label] of [['C', CLAWS_T1, '骨板'], ['A', NOBODY, '沒穿過身體']]) {
      await page.evaluate((id) => window.__skewer.newGame(id, 'swipe'), bid);
      const ev = evalLine(boardById(bid), await page.evaluate(() => window.__skewer.state), l);
      await dragLine(page, l);
      const a0 = await page.evaluate(() => ({ info: document.getElementById('info').innerText, turn: window.__skewer.state.turn, rounds: window.__skewer.log.rounds.length, ui: window.__skewer.ui }));
      await page.waitForTimeout(1000);
      const a1 = await page.evaluate(() => document.getElementById('info').innerText);
      check(`${tag} S-3 非法線（${label}）放開：不出刀、回合不變，原因文字「${ev.reason}」顯示 ≥ 1 秒`,
        !ev.legal && !!ev.reason && a0.turn === 1 && a0.rounds === 0 && a0.ui === 'IDLE' && a0.info.includes(ev.reason) && a1.includes(ev.reason), `${a0.info}｜1s後 ${a1}`);
    }

    // S-4 刀痕跟手；放開後 ≤ 400ms 淡出到 0
    await page.evaluate(() => { window.__skewer.setSkip(true); window.__skewer.newGame('A', 'swipe'); });
    const L4 = heartLine('A', 1);
    // 「最後一個 pointer 位置」取瀏覽器實際送出的最後一個 pointermove（WebKit 會把滑鼠座標取整到 CSS px），再用 toScreen 的線性關係換回棋盤座標
    await page.evaluate(() => { window.__lastPtr = null; document.getElementById('board').addEventListener('pointermove', (e) => { window.__lastPtr = [e.clientX, e.clientY]; }); });
    await dragLine(page, L4, false);
    const tr = await page.evaluate(() => window.__skewer.fx.trail);
    const last = tr[tr.length - 1] || [NaN, NaN];
    const ptrBoard = await page.evaluate(() => { const o = window.__skewer.toScreen(0, 0), q = window.__skewer.toScreen(1000, 1000), [cx, cy] = window.__lastPtr; return [(cx - o.x) * 1000 / (q.x - o.x), (cy - o.y) * 1000 / (q.y - o.y)]; });
    await page.evaluate(() => {
      window.__fadeP = new Promise((res) => {
        window.addEventListener('pointerup', () => {
          const t0 = performance.now(); let n0 = -1;
          const step = () => { const n = window.__skewer.fx.trail.length; if (n0 < 0) n0 = n; if (n === 0 && n0 >= 0) res({ ms: performance.now() - t0, n0 }); else if (performance.now() - t0 > 3000) res({ ms: 9999, n0 }); else requestAnimationFrame(step); };
          setTimeout(step, 0);
        }, { once: true, capture: true });
      });
    });
    await page.mouse.up();
    const fade = await page.evaluate(() => window.__fadeP);
    check(`${tag} S-4 拖曳中刀痕跟手（最後一點＝最後 pointer 位置，誤差 ≤ 2 單位）、放開後 ≤ 400ms 淡出到 0`,
      tr.length > 1 && Math.hypot(last[0] - ptrBoard[0], last[1] - ptrBoard[1]) <= 2 && Math.hypot(last[0] - L4[2], last[1] - L4[3]) <= 6 && fade.n0 > 0 && fade.ms <= 400, JSON.stringify({ len: tr.length, last, ptrBoard, fade }));

    // S-5 切開的回饋：碎塊＝2×摘除數、心肉閃爍、頓格 ≥ 50ms、震幅 串3 > 串1 > 空切＝0
    await page.evaluate(() => { window.__skewer.setSkip(false); window.__skewer.newGame('A', 'swipe'); });
    const fxAfter = async (l) => {
      const st = await page.evaluate(() => window.__skewer.state);
      const ev = evalLine(boardById(st.boardId), st, l);
      await dragLine(page, l);
      const f = await page.evaluate(() => window.__skewer.fx);
      await waitIdleOrEnd(page);
      return { f, hits: ev.hits, removed: ev.hits.filter((id) => isClaw(st.boardId, id)) };
    };
    const c1 = await fxAfter(heartLine('A', 1)); // 串 1（心肉）
    const c3 = await fxAfter(SKEWER3); // 串 3（兩爪＋心肉）
    await page.evaluate(() => window.__skewer.newGame('A', 'swipe'));
    const EMPTY = [650, 250, 650, 700];
    const c0 = await fxAfter(EMPTY); // 空切
    await page.evaluate(() => window.__skewer.newGame('A', 'swipe'));
    const cc = await fxAfter([250, 300, 250, 700]); // 串 1（只穿爪甲）
    const okPieces = [c1, c3, c0, cc].every((c) => c.f.pieces === 2 * c.removed.length);
    check(`${tag} S-5 演出：碎塊＝2×摘除數、心肉被穿有閃爍、頓格 ≥ 50ms、震幅 串3 > 串1 > 空切＝0`,
      c1.hits.length === 1 && c3.hits.length === 3 && c0.hits.length === 0 && cc.hits.length === 1 && cc.removed.length === 1 && c3.removed.length === 2
      && okPieces && c3.f.pieces === 4 && cc.f.pieces === 2 && c1.f.flash.includes('heart') && c3.f.flash.includes('heart') && !c0.f.flash.length
      && [c1, c3, c0, cc].every((c) => c.f.hitstopMs >= 50) && c3.f.shake > c1.f.shake && c1.f.shake > c0.f.shake && c0.f.shake === 0,
      JSON.stringify({ c1: c1.f, c3: c3.f, c0: c0.f, cc: cc.f }));

    // S-6 不拖節奏：每刀演出 ≤ 1200ms 回到 IDLE／END（不按跳過）；跳過仍有效
    await page.evaluate(() => { window.__skewer.setSkip(false); window.__skewer.newGame('A', 'swipe'); });
    const timed = async (l) => {
      await page.evaluate(() => {
        window.__animP = new Promise((res) => {
          window.addEventListener('pointerup', () => {
            const t0 = performance.now(); let sawAnim = false;
            const step = () => { const u = window.__skewer.ui; if (u === 'ANIM') sawAnim = true; if (sawAnim && (u === 'IDLE' || u === 'END')) res({ ms: performance.now() - t0, sawAnim }); else if (performance.now() - t0 > 5000) res({ ms: 9999, sawAnim }); else requestAnimationFrame(step); };
            setTimeout(step, 0);
          }, { once: true, capture: true });
        });
      });
      await dragLine(page, l);
      return page.evaluate(() => window.__animP);
    };
    const t1 = await timed(heartLine('A', 1)), t3 = await timed(SKEWER3);
    await dragLine(page, heartLine('A', 3));
    const sk = await page.evaluate(() => new Promise((res) => {
      const P = window.__skewer, was = P.ui === 'ANIM', t0 = performance.now(); let frames = 0;
      document.getElementById('skip').click();
      const step = () => { if (P.ui !== 'ANIM' || frames > 400) { res({ was, frames, ms: performance.now() - t0, ui: P.ui }); return; } frames++; requestAnimationFrame(step); };
      step();
    }));
    check(`${tag} S-6 每刀演出 ≤ 1200ms 回到可操作（串 1、串 3）；演出中按「跳過演出」立即結束`,
      t1.sawAnim && t3.sawAnim && t1.ms <= 1200 && t3.ms <= 1200 && sk.was && sk.frames <= 5 && sk.ms < 300 && sk.ui === 'END', JSON.stringify({ t1, t3, sk }));

    // S-7 預覽不給答案（K-4）＋ S-11 拖曳中提示「拉回起點放開＝取消」
    await page.evaluate(() => { window.__skewer.setSkip(true); window.__skewer.newGame('A', 'swipe'); });
    await dragLine(page, heartLine('A', 1)); await waitIdleOrEnd(page);
    await dragLine(page, SKEWER3, false);
    const dur7 = await page.evaluate(() => ({ text: document.body.innerText, html: document.body.innerHTML, prev: window.__skewer.preview, ui: window.__skewer.ui }));
    if (shotsDir && bname === 'webkit') await page.screenshot({ path: join(shotsDir, 'iPhone14Pro_揮刀模式_拖曳中.png') });
    await page.mouse.up(); await waitIdleOrEnd(page);
    const noAns7 = (t) => !t.includes('24') && !/×\s*\d/.test(t) && !t.includes('倍率');
    check(`${tag} S-7 揮刀拖曳中：高亮穿到的三顆器官，DOM 不含傷害 24 或倍率；S-11 拖曳中有提示「拉回起點放開＝取消」`,
      dur7.ui === 'DRAG' && JSON.stringify(dur7.prev.hits) === '["clawL","heart","clawR"]' && noAns7(dur7.text) && !dur7.text.includes('×') && noAns7(dur7.html) && dur7.text.includes('拉回起點放開＝取消'), dur7.text.slice(0, 160));

    // S-11 揮刀可取消：先拉出去（≥120）再拉回起點附近放開 → 不出刀、回合不變、取消＋1；接著再劃一刀正常出刀
    await page.evaluate(() => { window.__skewer.setSkip(true); window.__skewer.newGame('A', 'swipe'); });
    {
      const A0 = await page.evaluate(() => window.__skewer.toScreen(300, 560)), A1 = await page.evaluate(() => window.__skewer.toScreen(520, 560)), A2 = await page.evaluate(() => window.__skewer.toScreen(310, 565));
      await page.mouse.move(A0.x, A0.y); await page.mouse.down();
      await page.mouse.move(A1.x, A1.y, { steps: 5 });
      const midHint = await page.evaluate(() => document.getElementById('info').innerText);
      await page.mouse.move(A2.x, A2.y, { steps: 5 }); await page.mouse.up();
      const cs = await page.evaluate(() => ({ turn: window.__skewer.state.turn, ui: window.__skewer.ui, rounds: window.__skewer.log.rounds.length, cancels: window.__skewer.cancels }));
      await dragLine(page, heartLine('A', 1)); await waitIdleOrEnd(page);
      const after = await page.evaluate(() => ({ turn: window.__skewer.state.turn, rounds: window.__skewer.log.rounds.length, c0: window.__skewer.log.rounds[0]?.cancels }));
      check(`${tag} S-11 拉出去再拉回起點放開＝取消：不出刀、回合不變、取消次數＋1；之後再劃一刀正常出刀（紀錄第 1 刀 cancels＝1）`,
        midHint.includes('拉回起點放開＝取消') && cs.turn === 1 && cs.ui === 'IDLE' && cs.rounds === 0 && cs.cancels === 1 && after.turn === 2 && after.rounds === 1 && after.c0 === 1, JSON.stringify({ cs, after }));
    }
    check(`${tag} 揮刀段全程無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
    await ctx.close();
  }

  // ===== S-8 手機：iPhone 14 Pro、iPhone SE；揮刀模式版面、touch-action、觸控拖曳出刀、頁面不捲動不縮放 =====
  for (const [sname, [w, h]] of Object.entries(SIZES)) {
    const { ctx, page } = await newPage(browser, bname, devices, w, h);
    await page.goto(U);
    await page.evaluate(() => window.__skewer.setSkip(true));
    for (const id of ['A', 'C']) {
      await page.evaluate((id) => window.__skewer.newGame(id, 'swipe'), id);
      const L = await layoutCheck(page, w, h);
      check(`${tag} S-8 ${sname} 揮刀／${id}：按鈕 ≥44px、不重疊、不出界；器官與身體在畫布內、無介面遮擋、無橫向捲動`,
        L.small.length === 0 && L.overlap.length === 0 && L.out.length === 0 && L.organsOut.length === 0 && L.bodyOut === 0 && L.covered.length === 0 && L.sandwich && !L.hscroll && L.cvH >= 200, JSON.stringify(L));
    }
    await page.evaluate(() => window.__skewer.newGame('A', 'swipe'));
    const ta = await page.evaluate(() => getComputedStyle(document.getElementById('board')).touchAction);
    await page.evaluate(() => { window.__ptypes = []; document.getElementById('board').addEventListener('pointerdown', (e) => window.__ptypes.push(e.pointerType)); });
    const v0 = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, z: window.visualViewport ? window.visualViewport.scale : 1 }));
    const l = heartLine('A', 1);
    let how = 'mouse';
    if (bname === 'chromium') {
      // 真實觸控輸入（CDP Input.dispatchTouchEvent 走瀏覽器輸入管線，產生 pointerType=touch）
      how = 'touch';
      const cdp = await ctx.newCDPSession(page);
      const a = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[0], l[1]]), b = await page.evaluate(([x, y]) => window.__skewer.toScreen(x, y), [l[2], l[3]]);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
      for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      // Playwright 的 WebKit 沒有觸控拖曳 API（touchscreen 只有 tap）：改用真實滑鼠拖曳；touch-action 另以計算樣式驗證
      await dragLine(page, l);
    }
    await waitIdleOrEnd(page);
    const st = await S(page);
    const v1 = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, z: window.visualViewport ? window.visualViewport.scale : 1, types: window.__ptypes }));
    check(`${tag} S-8 ${sname}：canvas touch-action:none；${how === 'touch' ? '觸控' : '滑鼠'}拖曳可出刀（回合 2、怪物 26、你 14）；拖曳前後頁面不捲動不縮放`,
      ta === 'none' && st.turn === 2 && st.hpE === 26 && st.hpP === 14 && v0.sx === v1.sx && v0.sy === v1.sy && v0.z === v1.z && v1.types.length === 1 && v1.types[0] === how,
      JSON.stringify({ ta, st, v0, v1 }));
    check(`${tag} S-8 ${sname}：無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
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
