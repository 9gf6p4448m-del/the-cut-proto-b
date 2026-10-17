// 刀譜（blade/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 或 blade_run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut 0233f19 docs/core-redesign-r5/BLADE_HAND_SKETCH.md BH-06～08；v0.2（068ca72 同檔檔尾）：4 隻怪、版本字樣 v0.2（BV-06）。
// 挑線：測試端用規則模組（bestLine／candidateLines）從畫面上的盤面狀態算出刀線，再用滑鼠真實拖曳；判定讀 window.__blade 與 DOM。
import { newPage } from './exp_tests.mjs';
import { bestLine, candidateLines, evaluate } from '../../src/blade/rules.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const B = (page) => page.evaluate(() => { const b = window.__blade; return { phase: b.phase, anim: b.animActive, state: b.state, preview: b.preview, last: b.last, previewText: b.previewText }; });
const settled = (page) => page.waitForFunction(() => !window.__blade.animActive && ['aim', 'stitch', 'end'].includes(window.__blade.phase), null, { timeout: 30000 });
async function drag(page, a, b, { release = true } = {}) {
  const A = await page.evaluate(([x, y]) => window.__blade.toScreen(x, y), a), Bp = await page.evaluate(([x, y]) => window.__blade.toScreen(x, y), b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(A.x + ((Bp.x - A.x) * k) / 8, A.y + ((Bp.y - A.y) * k) / 8);
  const before = await B(page);
  if (release) await page.mouse.up();
  return before;
}
/** 元素在視窗內且沒被蓋住時回傳其文字，否則 null。 */
const visibleText = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width === 0 || r.bottom > innerHeight || r.right > innerWidth || r.top < 0) return null; const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === el || el.contains(h) ? el.textContent : null; }, sel);
/** 縫合畫面：照貪婪 bot 的規則挑第一個選項；槽滿就換第 0 槽。 */
async function pickFirst(page) {
  await page.click('#opt0');
  if (await page.isVisible('#slot0')) await page.click('#slot0');
  await page.waitForFunction(() => window.__blade.phase === 'aim');
}

export async function runBladeTests({ bname, btype, devices, url, check }) {
  const browser = await btype.launch();
  const tag = `[${bname}][blade]`;
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  await page.goto(url + '/blade/');
  await page.waitForFunction(() => !!window.__blade);
  await page.evaluate(() => window.__blade.setTimings({ animScale: 0.08 }));
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} 版本 SHA 與「研究片段」字樣；BV-06 畫面看得到 v0.2`, top.includes(sha) && top.includes('研究片段') && top.includes('v0.2') && (await visibleText(page, '#ver')) === 'v0.2' && sha && !sha.includes('__'), sha);

  // ===== BH-06 預覽＝結算（≥10 條真實拖曳） =====
  {
    const bad = []; let n = 0, multi = 0, patSeen = new Set();
    for (let g = 0; g < 6 && n < 14; g++) {
      await page.evaluate((sd) => window.__blade.newGame({ seed: sd }), 300 + g); await settled(page);
      for (let k = 0; k < 4 && n < 14; k++) {
        const s0 = await B(page); if (s0.phase !== 'aim') break;
        const lines = candidateLines(s0.state.organs, s0.state.slots);
        // 輪流取：最高分線、最多斬斷線、以及依序抽出的一般候選線（含會撞骨、揮空的）
        const pick = k % 3 === 0 ? bestLine(s0.state, 'score') : k % 3 === 1 ? bestLine(s0.state, 'count') : (() => { const l = lines[(n * 37) % lines.length]; return { a: l[0], b: l[1] }; })();
        const pre = await drag(page, pick.a, pick.b);
        await settled(page);
        const after = await B(page), rec = after.last, pv = pre.preview;
        n++;
        if (!pv || !rec) { bad.push(`#${n} 沒有預覽或結算`); continue; }
        const pvIds = pv.seqIds, recIds = evaluate(s0.state, rec.a, rec.b).path.seqIds;   // v0.2：序列含未斷的骨，以出刀前盤面獨立重算
        if (JSON.stringify(pv.seq) !== JSON.stringify(rec.seq)) bad.push(`#${n} 器官種類序列 預覽${pv.seq}≠結算${rec.seq}`);
        if (JSON.stringify(rec.severed.map((x) => x.id)) !== JSON.stringify(pvIds.filter((id) => rec.severed.some((x) => x.id === id)))) bad.push(`#${n} 斬斷器官與預覽序列不一致`);
        const recPat = rec.score.patterns.map((p) => p.label + (p.add ? ` +${p.add}` : '') + (p.mul ? ` ×${p.mul}` : ''));
        if (JSON.stringify(pvIds) !== JSON.stringify(recIds)) bad.push(`#${n} 器官序列 預覽${pvIds}≠結算${recIds}`);
        if (JSON.stringify(pv.patterns) !== JSON.stringify(recPat)) bad.push(`#${n} 刀譜 預覽${pv.patterns}≠結算${recPat}`);
        if (pv.score !== rec.score.score || pv.chips !== rec.score.chips || pv.mult !== rec.score.mult) bad.push(`#${n} 分數 預覽${pv.chips}×${pv.mult}=${pv.score}≠結算${rec.score.chips}×${rec.score.mult}=${rec.score.score}`);
        // 畫面上的預覽文字（放開前那一刻）要寫出同一個算式
        if (!pre.previewText.includes(`${rec.score.chips} × ${rec.score.mult} = ${rec.score.score}`)) bad.push(`#${n} 預覽文字「${pre.previewText}」沒有結算算式`);
        // 獨立重算：用放開前的盤面以規則函式重算這條刀線（結算刀線取紀錄的端點）
        const re = evaluate(s0.state, rec.a, rec.b);
        if (re.score.score !== rec.score.score) bad.push(`#${n} 重算 ${re.score.score}≠${rec.score.score}`);
        // v0.2：預覽寫的「N 條反擊會打中／取消全部」要等於結算（會擊倒的刀反擊不發動）
        if (!rec.cleared) {
          const hitsRec = rec.counterResults.filter((x) => x !== 'cancelled').length, hitsPv = pv.counters - pv.saves;
          if (hitsRec !== hitsPv) bad.push(`#${n} 反擊 預覽打中 ${hitsPv}≠結算 ${hitsRec}`);
          if (hitsPv > 0 && !pre.previewText.includes(`${hitsPv} 條反擊會打中`)) bad.push(`#${n} 預覽文字沒寫 ${hitsPv} 條反擊會打中`);
        }
        if (recIds.length >= 3) multi++;
        rec.score.patterns.forEach((p) => patSeen.add(p.key));
        if (after.phase === 'stitch') await pickFirst(page);
        if (after.phase === 'end') break;
      }
    }
    check(`${tag} BH-06 預覽＝結算：真實拖曳 ${n} 條，器官序列／刀譜／分數與畫面算式逐項相同`, bad.length === 0 && n >= 10 && multi >= 3, `${n} 條（≥3 器官 ${multi} 條；出現刀譜 ${[...patSeen].join(',')}）${bad.slice(0, 3).join('；')}`);
  }

  // ===== BH-07 整局：勝一局（v0.2：4 隻）＋敗一局（4 刀不達標）＋再來一局重置 =====
  // 勝局種子 167：tests/blade_stats.ts 的貪婪 bot 200 局中唯一全勝的種子；下面的拖曳策略與該 bot 相同。
  {
    const bad = [];
    await page.evaluate(() => window.__blade.newGame({ seed: 167 })); await settled(page);
    let cuts = 0, twitches = 0;
    for (let guard = 0; guard < 60; guard++) {
      const s = await B(page);
      if (s.phase === 'end') break;
      if (s.phase === 'stitch') { await pickFirst(page); continue; }
      let st = s.state, b = bestLine(st, 'score');
      while (b && st.twitchesLeft > 0 && b.score < (st.threshold - st.monsterScore) / st.cutsLeft / 2) {
        await page.click('#twitch'); twitches++; st = (await B(page)).state; b = bestLine(st, 'score');
      }
      await drag(page, b.a, b.b); cuts++; await settled(page);
    }
    const w = await B(page);
    const endVisible = await page.isVisible('#endModal');
    const endTitle = await page.textContent('#endTitle'), endTotal = await page.textContent('#endTotal');
    if (!(w.phase === 'end' && w.state.phase === 'won' && endVisible && endTitle.includes('4 隻全倒') && (await page.textContent('#endReach')) === '4' && endTotal === String(w.state.totalScore))) bad.push(`勝局：phase=${w.phase}/${w.state.phase} 標題=${endTitle}`);
    const wonSummary = `勝：${cuts} 刀 抽搐 ${twitches} 總分 ${w.state.totalScore} 最高 ${w.state.bestCut} 縫合 ${w.state.slots.filter(Boolean).join('/')}`;
    // 敗局：同一頁新局，在身體區揮空 4 刀
    await page.evaluate(() => window.__blade.newGame({ seed: 77 })); await settled(page);
    for (let i = 0; i < 4; i++) { await drag(page, [600, 980], [600, 840]); await settled(page); }
    const l = await B(page);
    const lostTitle = await page.textContent('#endTitle');
    if (!(l.phase === 'end' && l.state.phase === 'lost' && l.state.history.length === 4 && lostTitle.includes('倒在第 1 隻') && (await page.textContent('#endReach')) === '1')) bad.push(`敗局：phase=${l.phase}/${l.state.phase} 刀=${l.state.history.length} 標題=${lostTitle}`);
    // 再來一局：重置全部狀態、換種子
    const oldSeed = l.state.seed;
    await page.click('#again'); await settled(page);
    const r = await B(page);
    const reset = r.phase === 'aim' && r.state.phase === 'aim' && r.state.monster === 0 && r.state.cutsLeft === 4 && r.state.cutsMax === 4 && r.state.twitchesLeft === 2
      && r.state.slots.every((x) => x === null) && r.state.totalScore === 0 && r.state.bestCut === 0 && r.state.history.length === 0
      && r.state.threshold === 150 && r.state.baseThreshold === 150 && r.state.hits === 0 && r.state.counters.length === 1
      && r.state.monsterScore === 0 && r.state.seed !== oldSeed && r.state.organs.length === 14 && !(await page.isVisible('#endModal')) && !(await page.isVisible('#stitchModal'));
    if (!reset) bad.push(`再來一局沒有完全重置：${JSON.stringify({ phase: r.phase, m: r.state.monster, c: r.state.cutsLeft, t: r.state.totalScore, seed: r.state.seed, old: oldSeed })}`);
    // 再來一局後仍可出刀
    const b2 = bestLine(r.state, 'score'); await drag(page, b2.a, b2.b); await settled(page);
    if ((await B(page)).state.history.length !== 1) bad.push('重開後出刀失敗');
    check(`${tag} BH-07 整局：勝一局（4 隻）、敗一局（4 刀不達標）、再來一局重置全部狀態並換種子`, bad.length === 0, `${wonSummary}｜${bad.join('；')}`);
  }

  // ===== BH-08 手機版面（兩種尺寸；含縫合與結果畫面） =====
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    const { ctx: c2, page: p } = await newPage(browser, bname, devices, w, h);
    await p.goto(url + '/blade/'); await p.waitForFunction(() => !!window.__blade);
    await p.evaluate(() => window.__blade.setTimings({ animScale: 0.08 }));
    const bad = [];
    const visible = async (sel) => p.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return `${s} 不存在`;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return `${s} 超出視窗 ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(hit === el || el.contains(hit))) return `${s} 中心被 ${hit && (hit.id || hit.tagName)} 蓋住`;
      if (el.tagName === 'BUTTON' && (r.height < 44 || r.width < 44)) return `${s} 按鈕 ${Math.round(r.width)}×${Math.round(r.height)} <44`;
      return null;
    }, sel);
    const scroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
    for (const s of ['#top', '#preview', '#scene', '#twitch', '#sound', '#restart']) { const e = await visible(s); if (e) bad.push(e); }
    // 畫布裡的縫合槽與怪物都在畫布可見範圍內
    const inCanvas = await p.evaluate(() => { const r = document.getElementById('scene').getBoundingClientRect(); const pts = [[350, 25], [350, 605], [35, 315], [665, 315], [140, 886], [560, 886]]; return pts.every(([x, y]) => { const q = window.__blade.toScreen(x, y); return q.x >= r.left && q.x <= r.right && q.y >= r.top && q.y <= r.bottom; }); });
    if (!inCanvas) bad.push('怪物或縫合槽超出畫布');
    if (!(await scroll())) bad.push('水平捲動（主畫面）');
    // 縫合畫面
    await p.evaluate(() => window.__blade.newGame({ seed: 1 })); await settled(p);
    const s = (await B(p)).state, b = bestLine(s, 'score');
    await drag(p, b.a, b.b); await settled(p);
    if ((await B(p)).phase === 'stitch') { for (const sel of ['#opt0', '#opt1', '#opt2']) { const e = await visible(sel); if (e) bad.push(e); } if (!(await scroll())) bad.push('水平捲動（縫合）'); await pickFirst(p); }
    else bad.push('第一刀沒有進縫合畫面');
    // 結果畫面
    await p.evaluate(() => window.__blade.newGame({ seed: 77 })); await settled(p);
    for (let i = 0; i < 4; i++) { await drag(p, [600, 980], [600, 840]); await settled(p); }
    for (const sel of ['#endTitle', '#endTotal', '#again']) { const e = await visible(sel); if (e) bad.push(e); }
    if (!(await scroll())) bad.push('水平捲動（結果）');
    if (p.__errs.length) bad.push(`頁面錯誤 ${p.__errs.join(' | ')}`);
    check(`${tag} BH-08 手機 ${label} ${w}×${h}：主畫面／縫合／結果完整可見、按鈕 ≥44px、無水平捲動`, bad.length === 0, bad.join('；'));
    await c2.close();
  }
  check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
  await ctx.close(); await browser.close();
}
