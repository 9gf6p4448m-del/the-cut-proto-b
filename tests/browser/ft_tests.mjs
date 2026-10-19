// duel v0.6「平手＋紀錄」瀏覽器驗收 FT-03～07（子路徑 duel6/；the-cut docs/fusion/DUEL_V06_TIE_LOG.md）。作者測試；Chromium＋WebKit 模擬，不是 iPhone 實機。
// 用法：node tests/browser/ft_run.mjs（需先 node tools/build.mjs）。FT_ONLY=chromium 只跑一種；FT_SECTIONS=03,05 只跑指定條目。單進程、依序執行。
// 等待一律用事件／狀態輪詢加上限（waitForFunction），不靠 sleep／retry 讓測試變穩定；紅燈就是紅燈。
//
// 「什麼樣的實作會讓它變紅」逐條（每條對應的斷言見 check 字串的 FT 編號；行號對照表在 scratchpad/ft_assertion_map.md）：
// FT-03 平手畫面（393×852、觸控）
//   - 橫幅／結算標題文字缺漏（缺「切除數」、缺「平手」、仍顯示「平手（算輸）」）→ title／sub 逐字比對 WANT
//   - 橫幅與標題數字對不上、與強制的切除數不同 → 兩處 regex 反解數字互比，再比預期
//   - win／loss／replay 狀態錯（勝的進不了縫合、敗的沒結束、重打的沒回切割期）→ 按鈕字、按下後的 ui／camp 斷言
//   - replay 重打跳到下一場、器官配置不同（id／種類／位置）、重打次數沒累加 → camp.stage／replay＋organs 逐值比對，連打兩輪
//   - 重打不倒數 → __cb.countdown 在按下後 >1500
//   - 說明重複出現、或第一次沒出現 → #tieNote 第一次存在、同局第二次與重新開頁都不存在；localStorage 丟例外不當掉（pageerror＝0、流程走完）
//   - 強制值寫回規則狀態 → 切割期結束時與結算時的 game.severedN 逐值相同
//   - ?devtie 洩漏到正常遊戲 → 不帶參數／帶非法值：devTie＝null、devTieHits＝0；10 個種子每個都打到戰鬥結束（reached＝10，避免恆真）；
//     另以 ?devtie= 的場次證明計數器會增加（hits≥1，避免永遠 0 的假計數器）
//   - 橫幅文字畫出畫布 → 攔截 fillText 取得每個橫幅字串的左右邊界，必須在畫布寬度內
// FT-04 紀錄內容：見 ft04_tests.mjs 檔頭（真值來自事件流＋結算表快照＋逐步觀測；缺欄位、多算少算一、藍紅弄反、重打場漏記、摘要≠JSON 各有對應斷言）。
// FT-05 儲存與清除
//   - 重新整理後遺失 → 重載前後 localStorage 逐字相同、按鈕計數相同
//   - 超量沒刪／刪錯／順序變 → 預填 50 局，第 51 局開始時恰剩 50、runIdx 序列＝去掉最舊一筆再加新局
//   - 儲存丟例外就當掉／複製內容缺本次開頁的局 → getItem／setItem 全丟例外仍打完一局，複製文字含該局
//   - 損壞 JSON 當掉或沒當空 → 四種壞資料載入無 pageerror、計數＝0、打一局後儲存是合法陣列且只有新局
//   - 中途關頁整局不見、已打完的場次遺失、沒標 unfinished → 打完一場關頁／選怪獸關頁，重開後結果＝unfinished 且 stages 數正確
//   - 按一次就清除、逾時沒還原、第二次不清除 → 單按資料不變且文字變「再按一次清除」；等逾時還原後再按仍只是 armed；連按兩次才清空
//   - 用了 confirm()／alert() → 所有頁面掛 dialog 監聽，出現即紅
// FT-06 複製路徑
//   - (a) 剪貼簿內容≠產生的文字／被截斷 → clipboard.readText＝writeText 收到的文字，且首行 N／sha、JSON 區塊＝localStorage
//   - (b) 剪貼簿不存在／拒絕／永不 resolve 時沒反應、沒顯示 textarea、內容截斷、沒全選、卻顯示「已複製」→ 三種覆寫各一個頁面逐項斷言
//   - (c) iframe 內失效 → 同源包裝頁（allow 含／不含 clipboard-write）連按三次，每次 (a) 或 (b) 至少成立
//   - 按了沒反應 → 每次按下前清空 toast／fb，按下後必須出現「已複製」或 textarea
// FT-07 紀錄不改規則
//   - 記錄動到規則或時序 → 30 個種子、同一腳本輸入，紀錄關／開：stepSig（逐步規則軌跡）、severedN、戰鬥結果（含事件雜湊）逐值相同
//   - 兩輪其實都沒在記錄（恆真）→ 關：寫入 0；開：每局 begin／stage 寫入次數精確、結束時局數＝30；軌跡有切除（事件數>0）
//   - 劃刀途中寫儲存 → 切割期每次劃刀／推進後 playlogWrites 恆等於局開始後的值；整局寫入＝局開始＋場結束＋縫合＋局結束
// 版面（393×852）：複製面板、textarea 後備、結算表與平手說明、橫幅 → scrollWidth<=clientWidth、getBoundingClientRect 在視窗內、橫幅字串在畫布內
import { deepEq, driveRun, layoutBad, lineMode, noTut, openPage, parseCopy, playLineGreedy, playPassive, fakeRun, seedLog, storedRaw, storedRuns, tapEl, waitUi } from './ft_common.mjs';
import { runFt04 } from './ft04_tests.mjs';

const THROW_STORAGE = "(() => { const f = function () { throw new Error('blocked'); }; Storage.prototype.getItem = f; Storage.prototype.setItem = f; Storage.prototype.removeItem = f; })();";
const TIE_NOTE = '平手時比切割期切掉的數量，一樣就重打。';
const WANT = {
  win: { blue: 5, red: 4, title: '平手，切除數 5：4，勝！', sub: '比切除數 你 5：4 對手', btn: null },   // 切除數贏時按鈕字規格未訂（主程式現為「看結果」但實際進縫合選項，見回報缺口）：不斷言
  loss: { blue: 3, red: 4, title: '平手，切除數 3：4，敗', sub: '比切除數 你 3：4 對手', btn: '看結果' },
  replay: { blue: 4, red: 4, title: '平手，切除數 4：4，重打這一場', sub: '比切除數 你 4：4 對手', btn: '重打' },
};
const nums = (t) => { const m = /(\d+)：(\d+)/.exec(t || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
const manual = (page, scale = 0.5) => page.evaluate((s) => { window.__cb.setManual(true); window.__cb.setTimings({ battleScale: s }); }, scale);
const PLAYER_PASSIVE = (page) => playPassive(page);
const orgsOf = (page) => page.evaluate(() => window.__cb.game.organs.map((o) => [o.id, o.kind, o.p[0], o.p[1]]));
const bannerBad = (texts, strs) => strs.filter((s) => !texts[s] || texts[s].minL < -0.5 || texts[s].maxR > texts[s].cw + 0.5);

export async function runFtTests({ bname, btype, devices, url, check, sub = 'duel6', sections = null }) {
  const tag = `[${bname}][${sub}]`, on = (id) => !sections || sections.includes(id);
  const browser = await btype.launch();
  const dialogs = [];
  const safe = async (name, fn) => { try { await fn(); } catch (e) { check(`${tag} ${name} 測試程式例外（視為未通過）`, false, String(e).slice(0, 300)); } };
  const open = (o) => openPage({ browser, bname, devices, url, sub, ...o });
  const done = (page) => { dialogs.push(...page.__dialogs); };

  // ===================================================== FT-03
  if (on('03')) await safe('FT-03', async () => {
    for (const kind of ['win', 'loss', 'replay']) {
      const W = WANT[kind], { ctx, page } = await open({ q: `?devtie=${kind}`, init: [noTut(sub)] });
      await manual(page);
      await page.evaluate(() => window.__cb.newRun({ seed: 2, beast: 'dragon' }));
      const org0 = await orgsOf(page);
      await playPassive(page);
      const sev0 = await page.evaluate(() => ({ ...window.__cb.game.severedN }));
      await waitUi(page, 'contrib', 180000);
      const s = await page.evaluate(() => ({ title: document.getElementById('contribTitle').textContent, btn: document.getElementById('contribNext').textContent, note: document.getElementById('tieNote') ? document.getElementById('tieNote').textContent : null, tie: window.__cb.tie, devTie: window.__cb.devTie, hits: window.__cb.devTieHits, winner: window.__cb.battle.winner, sev: { ...window.__cb.game.severedN }, texts: Object.fromEntries([...window.__texts]) }));
      const tn = nums(s.title), bn = nums(Object.keys(s.texts).find((k) => k.startsWith('比切除數')));
      check(`${tag} FT-03[${kind}] 結算標題逐字＝「${W.title}」、橫幅副字逐字＝「${W.sub}」且主字「平手」畫出；兩處數字相同且＝強制值`,
        s.title === W.title && !!s.texts[W.sub] && !!s.texts['平手'] && deepEq(tn, bn) && deepEq(tn, [W.blue, W.red]), JSON.stringify({ title: s.title, tn, bn, subDrawn: Object.keys(s.texts).filter((k) => k.includes('切除')) }));
      check(`${tag} FT-03[${kind}] 狀態：tie＝{${W.blue}:${W.red},${kind}}、戰鬥勝負被強制為 draw、devTie 與強制值相同、計數器 hits≥1；強制值沒寫回規則狀態（severedN 前後相同）；按鈕字${W.btn === null ? '（win 不斷言）' : `＝「${W.btn}」`}`,
        !!s.tie && s.tie.blue === W.blue && s.tie.red === W.red && s.tie.result === kind && s.winner === 'draw' && deepEq(s.devTie, { blue: W.blue, red: W.red }) && s.hits >= 1 && deepEq(s.sev, sev0) && (W.btn === null || s.btn === W.btn), JSON.stringify({ tie: s.tie, winner: s.winner, devTie: s.devTie, hits: s.hits, sev0, sev: s.sev, btn: s.btn }));
      check(`${tag} FT-03[${kind}] 第一次平手說明出現且文字正確（#tieNote＝「${TIE_NOTE}」）`, s.note === TIE_NOTE, String(s.note));
      const lay = await layoutBad(page, ['#contrib .box', '#contribTitle', '#contribBody', '#tieNote', '#contribNext']);
      check(`${tag} 版面 393×852（FT-03[${kind}] 結算表＋平手說明不溢出；橫幅主副字在畫布內）`, lay.length === 0 && bannerBad(s.texts, ['平手', W.sub]).length === 0, lay.join('；') + ' ' + JSON.stringify(bannerBad(s.texts, ['平手', W.sub])));
      if (kind === 'win') {
        await tapEl(page, '#contribNext'); await waitUi(page, 'pick', 6000);
        const r = await page.evaluate(() => ({ stage: window.__cb.camp.stage, tb: window.__cb.camp.history.at(-1).tiebreak }));
        check(`${tag} FT-03[win] 按「挑縫合」→ 進縫合選項、history 留下 tiebreak.result＝win`, r.stage === 0 && r.tb && r.tb.result === 'win', JSON.stringify(r));
      } else if (kind === 'loss') {
        await tapEl(page, '#contribNext'); await waitUi(page, 'end', 6000);
        const t = await page.textContent('#endTitle');
        check(`${tag} FT-03[loss] 按「看結果」→ 征途結束、標題含「倒在第 1 場」`, t.includes('倒在第 1 場'), t);
      } else {
        const rows = [];
        for (let round = 1; round <= 2; round++) {
          if (round === 2) { await playPassive(page); await waitUi(page, 'contrib', 180000); }
          const mid = await page.evaluate(() => ({ title: document.getElementById('contribTitle').textContent, note: !!document.getElementById('tieNote'), rep: window.__cb.camp.replay ?? 0 }));
          await tapEl(page, '#contribNext'); await waitUi(page, 'cut', 6000);
          const after = await page.evaluate(() => ({ stage: window.__cb.camp.stage, rep: window.__cb.camp.replay ?? 0, stageTxt: document.getElementById('stage').textContent, cd: window.__cb.countdown, step: window.__cb.game.step, stitches: window.__cb.camp.stitches.length }));
          rows.push({ round, mid, after, same: deepEq(await orgsOf(page), org0) });
        }
        const ok = rows.every((r) => r.mid.title === W.title && r.after.stage === 0 && r.after.rep === r.round && r.after.stageTxt === '對手 1／3' && r.after.cd > 1500 && r.after.step === 0 && r.after.stitches === 0 && r.same) && rows[0].mid.note === true && rows[1].mid.note === false;
        check(`${tag} FT-03[replay] 按「重打」兩輪：回到同一場（stage 不變、replay＝1、2、步數 0）、器官 id／種類／位置與原場逐值相同、照常倒數；說明只在第一次出現`, ok, JSON.stringify(rows));
      }
      check(`${tag} FT-03[${kind}] 無頁面錯誤、無 confirm／alert`, page.__errs.length === 0 && page.__dialogs.length === 0, page.__errs.join(' | '));
      if (kind === 'replay') {   // 說明「每台裝置一次」：同一 context 重新開頁，不再出現；storage 有記號
        const { page: p2 } = await open({ ctx, q: '?devtie=loss' });
        await manual(p2, 0.05); await p2.evaluate(() => window.__cb.newRun({ seed: 2, beast: 'dragon' })); await playPassive(p2); await waitUi(p2, 'contrib', 180000);
        const n2 = await p2.evaluate(() => ({ note: !!document.getElementById('tieNote'), seen: localStorage.getItem('duel6-tienote-seen') }));
        check(`${tag} FT-03 第一次平手說明每台裝置只一次：重新開頁後不再出現（localStorage 記號＝1）`, !n2.note && n2.seen === '1', JSON.stringify(n2));
        done(p2);
      }
      done(page); await ctx.close();
    }
    {   // localStorage getItem／setItem 全丟例外：平手畫面照常、不當掉
      const { ctx, page } = await open({ q: '?devtie=loss', init: [THROW_STORAGE] });
      await manual(page, 0.05);
      await page.evaluate(() => { window.__cb.newRun({ seed: 2, beast: 'dragon' }); window.__cb.skipTut(); });
      await playPassive(page); await waitUi(page, 'contrib', 180000);
      const t = await page.textContent('#contribTitle');
      await tapEl(page, '#contribNext'); await waitUi(page, 'end', 6000);
      check(`${tag} FT-03 localStorage 的 getItem／setItem 丟例外：平手畫面照常（標題＝「${WANT.loss.title}」）、走到結果畫面、無頁面錯誤`, t === WANT.loss.title && page.__errs.length === 0, JSON.stringify({ t, errs: page.__errs }));
      done(page); await ctx.close();
    }
    {   // 不帶參數：10 個種子每個都打到戰鬥結束，devtie 路徑一次都沒走到；非法值同樣無效
      const { ctx, page } = await open({ init: [noTut(sub)] });
      await manual(page, 0.05);
      let reached = 0; const wins = [];
      for (let seed = 1; seed <= 10; seed++) {
        await page.evaluate((sd) => window.__cb.newRun({ seed: sd, beast: 'dragon' }), seed);
        await playPassive(page); await waitUi(page, 'contrib', 120000);
        const b = await page.evaluate(() => window.__cb.battle); if (b && b.events.length > 0) reached++; wins.push(b.winner[0]);
      }
      const z = await page.evaluate(() => ({ hits: window.__cb.devTieHits, dt: window.__cb.devTie }));
      check(`${tag} FT-03 不帶參數跑 10 個種子：每個都打到戰鬥結束（reached＝10）、devTieHits＝0、devTie＝null`, reached === 10 && z.hits === 0 && z.dt === null, JSON.stringify({ reached, wins: wins.join(''), ...z }));
      const bad = [];
      for (const v of ['', 'WIN', 'win ', 'draw', 'replay2']) {
        await page.goto(`${url}/${sub}/?devtie=${encodeURIComponent(v)}`); await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady, null, { timeout: 30000 });
        const q = await page.evaluate(() => ({ hits: window.__cb.devTieHits, dt: window.__cb.devTie })); if (q.hits !== 0 || q.dt !== null) bad.push(`${v}:${JSON.stringify(q)}`);
      }
      check(`${tag} FT-03 ?devtie= 非法值（空、WIN、"win "、draw、replay2）一律無效：devTie＝null、hits＝0`, bad.length === 0, bad.join(' '));
      done(page); await ctx.close();
    }
  });

  // ===================================================== FT-04
  if (on('04')) await safe('FT-04', () => runFt04({ browser, bname, devices, url, check, sub }));

  // ===================================================== FT-05
  if (on('05')) await safe('FT-05', async () => {
    const quick = async (page, seed = 2) => { await page.evaluate((s) => window.__cb.newRun({ seed: s, beast: 'dragon' }), seed); return driveRun(page, { player: PLAYER_PASSIVE }); };
    {   // 重新整理後紀錄還在
      const { ctx, page } = await open({ init: [noTut(sub)] }); await manual(page, 0.05);
      const r = await quick(page); const before = await storedRaw(page, sub);
      await page.reload(); await page.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && window.__cb.ui === 'beast', null, { timeout: 30000 });
      const after = await storedRaw(page, sub), label = await page.textContent('#logBtn'), arr = JSON.parse(before);
      check(`${tag} FT-05 重新整理後紀錄還在：localStorage 逐字相同、按鈕「試玩紀錄（1）」`, r.ended && arr.length === 1 && arr[0].stages.length >= 1 && before === after && label === '試玩紀錄（1）', JSON.stringify({ ended: r.ended, n: arr.length, same: before === after, label }));
      done(page); await ctx.close();
    }
    {   // 第 51 局存入後剩 50 局、刪最舊、順序不變
      const fakes = Array.from({ length: 50 }, (_, i) => fakeRun(1001 + i));
      const { ctx, page } = await open({ init: [noTut(sub), seedLog(sub, fakes)] }); await manual(page, 0.05);
      const l0 = await page.textContent('#logBtn');
      await page.evaluate(() => window.__cb.newRun({ seed: 2, beast: 'dragon' }));
      const a = await storedRuns(page, sub), idxA = a.map((r) => r.runIdx), want = [...Array.from({ length: 49 }, (_, i) => 1002 + i), 1];
      const lbl = await page.textContent('#logBtn');
      const r = await driveRun(page, { player: PLAYER_PASSIVE }); const b = await storedRuns(page, sub);
      check(`${tag} FT-05 預填 50 局，第 51 局存入後剩 50 局、刪掉最舊（#1001）、其餘順序不變（runIdx＝1002…1050、新局）；打完後仍 50 局且前 49 局不變`,
        l0 === '試玩紀錄（50）' && deepEq(idxA, want) && lbl === '試玩紀錄（50）' && r.ended && b.length === 50 && deepEq(b.slice(0, 49).map((x) => x.runIdx), want.slice(0, 49)) && b[49].result !== 'playing', JSON.stringify({ l0, idxA: [idxA[0], idxA.length, idxA.at(-1)], lbl, n: b.length, last: b[49].result }));
      done(page); await ctx.close();
    }
    {   // getItem／setItem 丟例外：遊戲照玩、複製內容含這次開頁的局
      const { ctx, page } = await open({ init: [THROW_STORAGE] }); await manual(page, 0.05);
      await page.evaluate(() => { window.__cb.newRun({ seed: 2, beast: 'dragon' }); window.__cb.skipTut(); });
      const r = await driveRun(page, { player: PLAYER_PASSIVE });
      await page.evaluate(() => { window.__copied = undefined; }); await tapEl(page, '#copyEnd');
      await page.waitForFunction(() => window.__copied !== undefined || !document.getElementById('copyFb').hidden, null, { timeout: 6000 });
      const text = await page.evaluate(() => window.__copied ?? document.getElementById('copyTa').value), P = parseCopy(text);
      check(`${tag} FT-05 localStorage 的 getItem／setItem 丟例外：整局照玩到結果畫面，複製內容含這次開頁的局（1 局、有場次、結果非 playing）`, r.ended && P.n === 1 && Array.isArray(P.json) && P.json.length === 1 && P.json[0].stages.length >= 1 && P.json[0].result !== 'playing' && page.__errs.length === 0, JSON.stringify({ ended: r.ended, n: P.n, err: P.err, errs: page.__errs }));
      done(page); await ctx.close();
    }
    for (const raw of ['{not json', '[{"runIdx":"x"}]', 'null', '12345']) {   // 損壞資料當空的
      const { ctx, page } = await open({ init: [noTut(sub), `try { localStorage.setItem('${sub}-playlog', ${JSON.stringify(raw)}); } catch (e) {}`] }); await manual(page, 0.05);
      const label = await page.textContent('#logBtn'); let ended = null, s = null;
      if (raw === '{not json' || raw === '[{"runIdx":"x"}]') { const r = await (async () => { await page.evaluate(() => window.__cb.newRun({ seed: 2, beast: 'dragon' })); return driveRun(page, { player: PLAYER_PASSIVE }); })(); ended = r.ended; s = await storedRuns(page, sub); }
      check(`${tag} FT-05 儲存內容損壞（${raw}）當成空的：載入不當掉、按鈕「試玩紀錄（0）」${s !== null ? '、打一局後儲存是只含新局的合法陣列' : ''}`, label === '試玩紀錄（0）' && page.__errs.length === 0 && (s === null || (ended && Array.isArray(s) && s.length === 1 && s[0].runIdx === 1)), JSON.stringify({ label, errs: page.__errs, ended, n: Array.isArray(s) ? s.length : s }));
      done(page); await ctx.close();
    }
    {   // 打完一場就關頁；選怪獸就關頁；沒選就關頁
      const { ctx, page } = await open({ init: [noTut(sub), lineMode(sub)] }); await manual(page, 0.05);
      await page.evaluate(() => window.__cb.newRun({ seed: 3, beast: 'dragon' })); await playLineGreedy(page); await waitUi(page, 'contrib', 120000);
      done(page); await page.close();
      const p2 = (await open({ ctx })).page; const a = await storedRuns(p2, sub);
      check(`${tag} FT-05 打完第 1 場就關頁：重開後該局標 unfinished、已打完的場次（1 場，含勝負與切除數）都在`, a.length === 1 && a[0].result === 'unfinished' && a[0].stages.length === 1 && a[0].stages[0].stage === 1 && !!a[0].stages[0].battle, JSON.stringify(a.map((r) => [r.result, r.stages.length])));
      await manual(p2, 0.05);
      await p2.evaluate(() => window.__cb.newRun({ seed: 3, beast: 'dragon' }));   // 第二局：選了怪獸、還沒打完任何一場就關頁
      done(p2); await p2.close();
      const p3 = (await open({ ctx })).page; const b = await storedRuns(p3, sub);
      check(`${tag} FT-05 選了怪獸就關頁：重開後留下 unfinished 局、stages 為空（前一局保持 unfinished）`, b.length === 2 && b[1].result === 'unfinished' && b[1].stages.length === 0 && b[0].result === 'unfinished' && b[0].stages.length === 1, JSON.stringify(b.map((r) => [r.result, r.stages.length])));
      done(p3); await p3.close();
      const p4 = (await open({ ctx })).page; done(p4); await p4.close();   // 只開頁不選怪獸就關：不多出局
      const p5 = (await open({ ctx })).page; const c = await storedRuns(p5, sub);
      check(`${tag} FT-05 只開頁沒選怪獸就關頁：不多出任何局（仍 2 局）`, c.length === 2, String(c.length));
      done(p5); await ctx.close();
    }
    {   // 清除：單按資料不變；逾時還原；3 秒內連按才清空；全程無 confirm
      const { ctx, page } = await open({ init: [seedLog(sub, [fakeRun(1001), fakeRun(1002), fakeRun(1003)])] });
      await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 });
      await tapEl(page, '#logBtn'); await page.waitForFunction(() => !document.getElementById('logPanel').hidden, null, { timeout: 3000 });
      const lay = await layoutBad(page, ['#logPanel .box', '#logCopy', '#logClear', '#logClose']);
      check(`${tag} 版面 393×852（FT-05 試玩紀錄面板不溢出）`, lay.length === 0, lay.join('；'));
      const txt = () => page.textContent('#logClear'), raw0 = await storedRaw(page, sub), log = [];
      await tapEl(page, '#logClear'); log.push(['按1', await txt(), (await storedRaw(page, sub)) === raw0]);
      await page.waitForFunction(() => document.getElementById('logClear').textContent === '清除', null, { timeout: 4500 }); log.push(['逾時還原', await txt(), (await storedRaw(page, sub)) === raw0]);
      await tapEl(page, '#logClear'); log.push(['還原後再按', await txt(), (await storedRaw(page, sub)) === raw0]);
      await tapEl(page, '#logClear'); const raw1 = await storedRaw(page, sub); log.push(['連按第二下', await txt(), raw1]);
      check(`${tag} FT-05 清除：只按一次文字變「再按一次清除」且資料不變；逾時（3 秒）自動還原；還原後的第一下仍只是預備（資料不變）；連按第二下才清空（儲存＝[]、計數 0）；全程無 confirm`,
        log[0][1] === '再按一次清除' && log[0][2] && log[1][1] === '清除' && log[1][2] && log[2][1] === '再按一次清除' && log[2][2] && JSON.parse(raw1).length === 0 && (await page.textContent('#logTitle')).includes('（0 局）') && page.__dialogs.length === 0, JSON.stringify(log));
      done(page); await ctx.close();
    }
    check(`${tag} FT-05 全程不得觸發 confirm()／alert()（所有頁面掛 dialog 監聽）`, dialogs.length === 0, dialogs.join(' | '));
  });

  // ===================================================== FT-06
  if (on('06')) await safe('FT-06', async () => {
    const fakes = [fakeRun(1001), fakeRun(1002), fakeRun(1003)], seed = seedLog(sub, fakes);
    const tapIn = async (page, scope, sel) => { const b = await scope.locator(sel).boundingBox(); if (!b) return false; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; };
    const press = async (page, scope, sel) => {
      await scope.evaluate(() => { window.__copied = undefined; const t = document.getElementById('copyToast'); t.hidden = true; t.textContent = ''; document.getElementById('copyFb').hidden = true; });
      await tapIn(page, scope, sel);
      try { await scope.waitForFunction(() => (!document.getElementById('copyToast').hidden && /^已複製/.test(document.getElementById('copyToast').textContent)) || !document.getElementById('copyFb').hidden, null, { timeout: 4000 }); } catch { return { responded: false }; }
      return scope.evaluate(() => { const ta = document.getElementById('copyTa'), t = document.getElementById('copyToast'), r = ta.getBoundingClientRect(); return { responded: true, toast: t.hidden ? null : t.textContent, fb: !document.getElementById('copyFb').hidden, val: ta.value, ss: ta.selectionStart, se: ta.selectionEnd, rect: { w: r.width, h: r.height, l: r.left, r: r.right }, vw: innerWidth, copied: window.__copied === undefined ? null : window.__copied }; });
    };
    const textOk = (text, stored, sha) => { const P = parseCopy(text); return !!P.json && P.n === 3 && P.sha === sha && deepEq(P.json, stored); };
    const taOk = (o, stored, sha) => o.fb && o.val.length > 0 && textOk(o.val, stored, sha) && o.ss === 0 && o.se === o.val.length && o.rect.w > 0 && o.rect.h > 0 && o.rect.l >= -0.5 && o.rect.r <= o.vw + 0.5;
    const openPanel = async (page) => { await page.waitForFunction(() => window.__cb.ui === 'beast', null, { timeout: 8000 }); await tapEl(page, '#logBtn'); await page.waitForFunction(() => !document.getElementById('logPanel').hidden, null, { timeout: 3000 }); };
    if (bname === 'chromium') {   // (a) 授予剪貼簿權限
      const { ctx, page } = await open({ init: [seed] }); await openPanel(page);
      const stored = await storedRuns(page, sub), sha = await page.textContent('#sha'); await page.bringToFront();
      const o = await press(page, page, '#logCopy'); const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR:' + e);
      check(`${tag} FT-06(a) 允許剪貼簿：顯示「已複製 3 局」、剪貼簿內容＝交給 writeText 的文字（完全相同）、文字的首行 N／sha 與 JSON 區塊＝儲存內容`, o.responded && o.toast === '已複製 3 局' && !o.fb && o.copied !== null && clip === o.copied && textOk(clip, stored, sha), JSON.stringify({ responded: o.responded, toast: o.toast, fb: o.fb, same: clip === o.copied, clipHead: String(clip).slice(0, 60) }));
      done(page); await ctx.close();
    }
    for (const [name, ov] of [['clipboard 不存在', "try { Object.defineProperty(navigator, 'clipboard', { get() { return undefined; }, configurable: true }); } catch (e) {}"], ['writeText 拒絕', "try { navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); } catch (e) {}"], ['writeText 永不 resolve', "try { navigator.clipboard.writeText = () => new Promise(() => {}); } catch (e) {}"]]) {
      const { ctx, page } = await open({ init: [seed, ov] }); await openPanel(page);
      const stored = await storedRuns(page, sub), sha = await page.textContent('#sha'), o = await press(page, page, '#logCopy');
      const lay = o.fb ? await layoutBad(page, ['#copyFb .box', '#copyTa', '#copyFbClose']) : ['無 textarea 面板'];
      check(`${tag} FT-06(b) ${name}：有反應、textarea 可見且在視窗內、內容完整（首行 N／sha、JSON＝儲存）、已全選（selectionStart＝0、selectionEnd＝長度）、沒有謊稱「已複製」`, o.responded && taOk(o, stored, sha) && !(o.toast || '').startsWith('已複製'), JSON.stringify({ responded: o.responded, fb: o.fb, toast: o.toast, ss: o.ss, se: o.se, len: o.val && o.val.length, rect: o.rect }));
      check(`${tag} 版面 393×852（FT-06(b) ${name} 的 textarea 面板不溢出）`, lay.length === 0, lay.join('；'));
      done(page); await ctx.close();
    }
    if (bname === 'chromium') {   // (c) 同源 iframe（play/ 現況：allow 不含 clipboard-write；另測含 clipboard-write）
      for (const allow of ['fullscreen; autoplay', 'clipboard-write; fullscreen; autoplay']) {
        const { ctx, page } = await open({ init: [seed], goto: false, ready: false });
        await ctx.route('**/ft-wrap.html', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe id="g" src="/${sub}/" allow="${allow}"></iframe>` }));
        await page.goto(`${url}/ft-wrap.html`);
        const frame = await (await page.waitForSelector('#g')).contentFrame();
        await frame.waitForFunction(() => !!window.__cb && window.__cb.assetsReady && window.__cb.ui === 'beast', null, { timeout: 30000 });
        await tapIn(page, frame, '#logBtn'); await frame.waitForFunction(() => !document.getElementById('logPanel').hidden, null, { timeout: 3000 });
        const stored = await storedRuns(page, sub), sha = await frame.textContent('#sha'), rows = [];
        for (let i = 0; i < 3; i++) {
          const o = await press(page, frame, '#logCopy');
          const okA = o.responded && /^已複製/.test(o.toast || '') && o.copied !== null && textOk(o.copied, stored, sha), okB = o.responded && taOk(o, stored, sha);
          rows.push({ i, responded: o.responded, a: okA, b: okB, toast: o.toast, fb: o.fb });
        }
        check(`${tag} FT-06(c) 同源 iframe（allow="${allow}"）連按三次：每次都有反應（「已複製」或 textarea），且 (a)［toast＋交給 writeText 的文字完整］或 (b)［textarea 完整且全選］至少成立一種`, rows.every((r) => r.responded && (r.a || r.b)), JSON.stringify(rows));
        done(page); await ctx.close();
      }
    }
  });

  // ===================================================== FT-07
  if (on('07')) await safe('FT-07', async () => {
    const { ctx, page } = await open({ q: '?cut=20', init: [noTut(sub), lineMode(sub)] }); await manual(page, 0.05);
    const harvest = () => page.evaluate(() => {
      const c = window.__cb, b = c.battle, fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
      return { sig: fnv(JSON.stringify(c.stepSig)), nSig: c.stepSig.length, sevB: c.game.severedN.blue, sevR: c.game.severedN.red, bat: b && { w: b.winner, how: b.how, ms: b.endMs, n: b.events.length, h: fnv(JSON.stringify(b.events)) }, writes: c.playlogWrites };
    });
    const once = async (seed, logOn, prevOpen) => {
      await page.evaluate((v) => window.__cb.setLog(v), logOn);
      const w0 = await page.evaluate(() => window.__cb.playlogWrites);
      await page.evaluate((sd) => window.__cb.newRun({ seed: sd, beast: 'dragon' }), seed);
      const w1 = await page.evaluate(() => window.__cb.playlogWrites), samples = new Set();
      await playLineGreedy(page, async () => { samples.add(await page.evaluate(() => window.__cb.playlogWrites)); });
      await waitUi(page, 'contrib', 180000);
      const h = await harvest();
      return { ...h, wBegin: w1 - w0, wStage: h.writes - w1, samples: [...samples], w1, label: await page.textContent('#logBtn') };
    };
    const bad = [], badLive = [], badW = [];
    let prevOpen = false, last = null;
    for (let seed = 1; seed <= 30; seed++) {
      const off = await once(seed, false, prevOpen), onn = await once(seed, true, prevOpen);
      if (off.sig !== onn.sig || off.nSig !== onn.nSig || off.sevB !== onn.sevB || off.sevR !== onn.sevR || !deepEq(off.bat, onn.bat)) bad.push(`seed ${seed}: sig ${off.sig}/${onn.sig} sev ${off.sevB}:${off.sevR}/${onn.sevB}:${onn.sevR} bat ${JSON.stringify(off.bat && [off.bat.w, off.bat.how, off.bat.ms, off.bat.h])}/${JSON.stringify(onn.bat && [onn.bat.w, onn.bat.how, onn.bat.ms, onn.bat.h])}`);
      if (!(onn.nSig >= 100 && onn.sevB + onn.sevR > 0 && onn.bat && onn.bat.n > 0 && off.sevB + off.sevR > 0)) badLive.push(`seed ${seed}: nSig=${onn.nSig} sev=${onn.sevB}:${onn.sevR} bat=${onn.bat && onn.bat.n}`);
      if (off.wBegin !== 0 || off.wStage !== 0 || off.samples.some((x) => x !== off.w1) || onn.wBegin !== (prevOpen ? 2 : 1) || onn.wStage !== 1 || onn.samples.some((x) => x !== onn.w1)) badW.push(`seed ${seed}: 關 begin/stage=${off.wBegin}/${off.wStage}；開 begin/stage=${onn.wBegin}/${onn.wStage}（預期 ${prevOpen ? 2 : 1}/1）劃刀途中寫入值 ${JSON.stringify(onn.samples)} vs ${onn.w1}`);
      prevOpen = true; last = onn;
    }
    check(`${tag} FT-07 30 個種子、同一腳本輸入：紀錄關／開，逐步規則軌跡（stepSig）、severedN、戰鬥結果（勝負／how／ms／事件雜湊）逐值相同`, bad.length === 0, bad.slice(0, 3).join('；'));
    check(`${tag} FT-07 活性證據：每個種子規則軌跡 ≥100 步、有切除（事件數>0）、戰鬥事件數>0；開啟時確實寫出 30 局（按鈕「試玩紀錄（30）」），關閉時寫入 0`, badLive.length === 0 && last.label === '試玩紀錄（30）', JSON.stringify({ badLive: badLive.slice(0, 3), label: last && last.label }));
    check(`${tag} FT-07 寫入次數：關＝0；開＝局開始（＋上一局未結束的放棄 1 次）＋場結束 1 次，且切割期每次劃刀／推進後 playlogWrites 恆不變（不隨劃刀事件增加）`, badW.length === 0, badW.slice(0, 3).join('；'));
    {   // 整局寫入＝局開始＋場結束＋縫合＋局結束（流程計數由測試自己數）
      await page.evaluate(() => window.__cb.setLog(true));
      await page.evaluate(() => window.__cb.newRun({ seed: 3, beast: 'dragon' }));
      const w1 = await page.evaluate(() => window.__cb.playlogWrites);
      const r = await driveRun(page, { player: async (pg) => { await playLineGreedy(pg); } });
      const w2 = await page.evaluate(() => window.__cb.playlogWrites), stitches = r.snaps.filter((s) => s.stitch).length, want = r.snaps.length + stitches + (r.ended ? 1 : 0);
      check(`${tag} FT-07 整局寫入次數＝場結束（${r.snaps.length}）＋縫合（${stitches}）＋局結束（${r.ended ? 1 : 0}）＝${want}（局開始的那次在 newRun 內、已先扣除）`, w2 - w1 === want && r.snaps.length >= 1, `w1=${w1} w2=${w2}`);
    }
    done(page); await ctx.close();
  });

  check(`${tag} FT-03～07 所有頁面無 confirm／alert`, dialogs.length === 0, dialogs.join(' | '));
  await browser.close();
}
