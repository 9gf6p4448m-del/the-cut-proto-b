// 同時下刀（twin-sim/）瀏覽器測試（作者測試；Chromium＋WebKit 模擬，**不是 iPhone 實機**）。由 run.mjs 逐瀏覽器呼叫。
// 凍結驗收：the-cut docs/twin-sim/ACCEPTANCE_FROZEN.md TSIM-08～13（UI 部分）。挑線用的候選刀由規則模組在測試端算出；判定讀 window.__sim。
import { newPage } from './exp_tests.mjs';
import { candidateCuts, resolveCut } from '../../src/twinslash/rules.ts';
import { snapshot } from '../../src/twinsim/sim.ts';

const SIZES = { iPhone14Pro: [393, 852], iPhoneSE: [375, 667] };
const S = (page) => page.evaluate(() => { const t = window.__sim; return { phase: t.phase, anim: t.animActive, round: t.sim.round, hp: t.sim.hp, alive: t.sim.alive.length, tired: t.sim.tired, seed: t.sim.seed, result: t.sim.result, locked: t.locked, planCalls: t.planCalls, rounds: t.log.matches.at(-1).rounds.length }; });
const waitPlayer = (page) => page.waitForFunction(() => window.__sim.phase === 'player' && !window.__sim.animActive && !!window.__sim.locked, null, { timeout: 30000 });
const waitSettled = (page) => page.waitForFunction(() => ['player', 'end'].includes(window.__sim.phase) && !window.__sim.animActive && (window.__sim.phase === 'end' || !!window.__sim.locked), null, { timeout: 30000 });
async function scr(page, p) { return page.evaluate(([x, y]) => window.__sim.toScreen(x, y), p); }
async function drag(page, a, b, release = true) {
  const A = await scr(page, a), B = await scr(page, b);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(A.x + ((B.x - A.x) * k) / 6, A.y + ((B.y - A.y) * k) / 6);
  if (release) await page.mouse.up();
}
const sim = (page) => page.evaluate(() => window.__sim.sim);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;

export async function runTwinSimTests({ bname, btype, devices, url, check }) {
  const browser = await btype.launch();
  const tag = `[${bname}][sim]`;
  const { ctx, page } = await newPage(browser, bname, devices, ...SIZES.iPhone14Pro);
  await page.goto(url + '/twin-sim/');
  await page.waitForFunction(() => !!window.__sim);
  await page.evaluate(() => window.__sim.setTimings({ lockDelay: 0, animScale: 0.15 }));
  const sha = await page.getAttribute('meta[name="build-sha"]', 'content');
  const top = await page.textContent('#top');
  check(`${tag} 版本 SHA 與「研究片段」字樣`, top.includes(sha) && top.includes('研究片段') && sha && !sha.includes('__'), sha);

  // ===== TSIM-08 鎖刀不受玩家影響（同局 2 回合＋同種子換一種玩法） =====
  {
    const bad = [];
    await page.evaluate(() => window.__sim.newMatch({ seed: 4242 })); await waitPlayer(page);
    const lock1 = (await S(page)).locked, st0 = await sim(page);
    // 誤操作：拉出去再拉回（取消）
    const A = await scr(page, [120, 700]), B = await scr(page, [120, 980]);
    await page.mouse.move(A.x, A.y); await page.mouse.down(); await page.mouse.move(B.x, B.y, { steps: 5 }); await page.mouse.move(A.x, A.y + 5, { steps: 5 }); await page.mouse.up();
    const cb = candidateCuts(snapshot(st0), 'blue'), l1 = cb.find((r) => r.fired.length >= 3) ?? cb[0];
    await drag(page, l1.a, l1.b); await waitSettled(page);
    let s = await S(page); const last1 = await page.evaluate(() => window.__sim.last);
    if (!(near(last1.red.a, lock1.a) && near(last1.red.b, lock1.b))) bad.push('r1 揭曉≠鎖定');
    if (s.planCalls !== 2) bad.push(`planCalls=${s.planCalls}`);                     // 第 1 回合 1 次＋第 2 回合 1 次
    const lock2 = s.locked, st1 = await sim(page);
    await drag(page, [600, 200], [600, 450]);                                         // 從他的獸身起刀：不合法，不出刀
    const s2 = await S(page); if (s2.round !== 1 || !same(s2.locked, lock2)) bad.push('不合法起刀改變了狀態');
    const cb2 = candidateCuts(snapshot(st1), 'blue'), l2 = cb2.find((r) => r.severed) ?? cb2[0];
    await drag(page, l2.a, l2.b); await waitSettled(page);
    const last2 = await page.evaluate(() => window.__sim.last);
    if (!(near(last2.red.a, lock2.a) && near(last2.red.b, lock2.b))) bad.push('r2 揭曉≠鎖定');
    // 同種子新局、換一條完全不同的刀：第 1 回合的 AI 刀線不變
    await page.evaluate(() => window.__sim.newMatch({ seed: 4242 })); await waitPlayer(page);
    const lock1b = (await S(page)).locked;
    if (!same(lock1b, lock1)) bad.push('同種子鎖刀不同');
    const l1b = cb.find((r) => r.severed && !same(r.fired, l1.fired)) ?? cb.at(-1);
    await drag(page, l1b.a, l1b.b); await waitSettled(page);
    const last1b = await page.evaluate(() => window.__sim.last);
    if (!(near(last1b.red.a, lock1.a) && near(last1b.red.b, lock1.b))) bad.push('換玩法後 AI 刀不同');
    check(`${tag} TSIM-08 拖曳前已鎖刀；揭曉＝鎖定（2 回合）；同種子換玩法 AI 不變`, bad.length === 0, bad.join('；') || `lock1=${lock1.sig}`);
  }

  // ===== TSIM-09 預覽＝自己的刀路（≥10 條真實拖曳）＋ TSIM-10 揭曉文字 =====
  {
    const bad = []; let n = 0, sawCancelText = false, bothSides = false;
    for (let m = 0; m < 4 && n < 12; m++) {
      await page.evaluate((sd) => window.__sim.newMatch({ seed: sd }), 900 + m); await waitPlayer(page);
      for (let r = 0; r < 4; r++) {
        const s = await S(page); if (s.phase === 'end') break;
        const st = await sim(page), snap = snapshot(st), cb = candidateCuts(snap, 'blue');
        const redPath = resolveCut(snap, 'red', s.locked.a, s.locked.b, false);
        // 輪流挑：會被 AI 截斷的刀、會切除的刀、多發動的刀、什麼都沒碰的刀
        const pref = [cb.find((x) => redPath.severed && x.fired.includes(redPath.severed)), cb.find((x) => x.severed), cb.find((x) => x.fired.length >= 3), cb.find((x) => x.hits.length === 0)];
        const line = pref[(m + r) % 4] ?? pref.find(Boolean) ?? cb[0];
        await page.evaluate(() => window.__sim.clearFx());
        await drag(page, line.a, line.b, false);
        const prev = await page.evaluate(() => window.__sim.preview);
        await page.mouse.up(); await waitSettled(page);
        const last = await page.evaluate(() => window.__sim.last), info = await page.evaluate(() => window.__sim.infoText), ev = await page.evaluate(() => window.__sim.fx.events);
        const exp = resolveCut(snap, 'blue', prev.a, prev.b, false);
        const f = (x) => JSON.stringify({ fired: x.fired, severed: x.severed, stop: x.stop && x.stop.by, stopP: x.stop && x.stop.p.map((v) => Math.round(v)), dmg: x.dmg });
        if (f(prev) !== f(exp) || !same(prev.fired, last.blue.pathFired) || prev.severed !== last.blue.severed || !near(prev.a, last.blue.a) || !near(prev.b, last.blue.b)) bad.push(`#${n} 預覽≠刀路`);
        if (last.blue.cancelled.length || last.red.cancelled.length) { if (info.includes('本回合被切除，未能發動')) sawCancelText = true; else bad.push(`#${n} 有截斷但沒說明：${info}`); }
        if (ev.some((e) => e.side === 'blue') && ev.some((e) => e.side === 'red')) bothSides = true;
        if (/先出手|搶先/.test(info)) bad.push(`#${n} 速度字眼`);
        n++;
      }
    }
    check(`${tag} TSIM-09 預覽＝自己的刀路（${n} 條真實拖曳）`, n >= 10 && bad.filter((b) => b.includes('預覽')).length === 0, bad.join('；'));
    check(`${tag} TSIM-10 揭曉：雙方刀路都有演出；截斷時顯示「本回合被切除，未能發動」`, sawCancelText && bothSides && bad.filter((b) => !b.includes('預覽')).length === 0, `sawCancel=${sawCancelText} both=${bothSides} ${bad.join('；')}`);
  }

  // ===== TSIM-11 取消與誤操作 =====
  {
    const bad = [];
    await page.evaluate(() => window.__sim.newMatch({ seed: 77 })); await waitPlayer(page);
    const s0 = await S(page);
    const ok = async (what) => { const s = await S(page); if (s.round !== 0 || s.phase !== 'player' || !same(s.locked, s0.locked) || s.planCalls !== s0.planCalls || s.rounds !== 0) bad.push(what); };
    await drag(page, [200, 700], [260, 720]); await ok('太短');
    await drag(page, [200, 300], [200, 700]); await ok('獸身外起刀');
    await drag(page, [150, 600], [500, 900], false);
    await page.evaluate(() => { const id = window.__sim.dragId; document.getElementById('scene').dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true })); });
    await page.mouse.up(); await ok('pointercancel');
    await drag(page, [150, 600], [170, 640], false);                                  // 第一指停在短距離
    const P = await scr(page, [100, 820]), Q = await scr(page, [500, 820]);
    await page.evaluate(([p, q]) => { const c = document.getElementById('scene'); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 99, clientX: x, clientY: y, bubbles: true })); ev('pointerdown', p.x, p.y); ev('pointermove', q.x, q.y); ev('pointerup', q.x, q.y); }, [P, Q]);
    await page.mouse.up(); await ok('第二指');
    check(`${tag} TSIM-11 太短、獸身外、pointercancel、第二指：不出刀、回合不前進、AI 鎖刀不變`, bad.length === 0, bad.join('；'));
  }

  // ===== TSIM-12 重開（等 AI、拖曳中、揭曉中、終局） =====
  {
    const bad = [];
    const fresh = async (what, prevSeed) => {
      await waitPlayer(page); await page.waitForTimeout(400);
      const s = await S(page);
      if (s.round !== 0 || s.hp.blue !== 30 || s.hp.red !== 30 || s.alive !== 13 || s.tired.blue.length || s.tired.red.length || s.seed === prevSeed || !s.locked || s.planCalls !== 1 || s.rounds !== 0 || s.result) bad.push(`${what}:${JSON.stringify(s)}`);
      return s.seed;
    };
    let seed = (await S(page)).seed;
    await page.evaluate(() => window.__sim.setTimings({ lockDelay: 400 }));
    await page.evaluate(() => window.__sim.newMatch());
    if ((await S(page)).phase !== 'lock') bad.push('沒有等 AI 階段');
    await page.click('#restart'); await page.evaluate(() => window.__sim.setTimings({ lockDelay: 0 }));
    seed = await fresh('等AI', seed);
    await drag(page, [150, 600], [500, 900], false);
    await page.evaluate(() => document.getElementById('restart').click()); await page.mouse.up();
    seed = await fresh('拖曳中', seed);
    const st = await sim(page), l = candidateCuts(snapshot(st), 'blue')[0];
    await page.evaluate(() => window.__sim.setTimings({ animScale: 1 }));
    await drag(page, l.a, l.b);
    if (!(await page.evaluate(() => window.__sim.phase === 'reveal' && window.__sim.animActive))) bad.push('沒進揭曉');
    await page.click('#restart'); await page.evaluate(() => window.__sim.setTimings({ animScale: 0.15 }));
    seed = await fresh('揭曉中', seed);
    for (let r = 0; r < 4; r++) { const s = await S(page); if (s.phase === 'end') break; const st2 = await sim(page), c = candidateCuts(snapshot(st2), 'blue'); const x = c.find((y) => y.fired.length >= 2) ?? c[0]; await drag(page, x.a, x.b); await waitSettled(page); }
    if ((await S(page)).phase !== 'end') bad.push('沒打到終局');
    const endInfo = await page.evaluate(() => window.__sim.infoText);
    if (!/(你贏了|你輸了|平手)（/.test(endInfo)) bad.push(`終局沒顯示原因：${endInfo}`);
    await page.click('#restart');
    await fresh('終局', seed);
    check(`${tag} TSIM-12 四個階段重開都回到乾淨的第 1 回合並重新鎖刀；舊局計時器不寫入新局`, bad.length === 0, bad.join('；'));
  }
  const lockMs = (await page.evaluate(() => window.__sim.log.matches.flatMap((m) => m.lockMs)));
  check(`${tag} 無頁面錯誤`, page.__errs.length === 0, page.__errs.join(' | '));
  await ctx.close();

  // ===== TSIM-13 手機版面 =====
  {
    const bad = [];
    for (const [name, [w, h]] of Object.entries(SIZES)) {
      const { ctx: c2, page: p2 } = await newPage(browser, bname, devices, w, h);
      await p2.goto(url + '/twin-sim/'); await p2.waitForFunction(() => window.__sim && window.__sim.phase === 'player', null, { timeout: 30000 });
      const m = await p2.evaluate(() => {
        const cv = document.getElementById('scene').getBoundingClientRect();
        const btns = [...document.querySelectorAll('footer button')].map((b) => Math.round(b.getBoundingClientRect().height));
        return { cv: [cv.top, cv.bottom, cv.left, cv.right, cv.height], vw: innerWidth, vh: innerHeight, sw: document.scrollingElement.scrollWidth, btns };
      });
      if (m.cv[0] < 0 || m.cv[1] > m.vh + 0.5 || m.cv[2] < 0 || m.cv[3] > m.vw + 0.5 || m.cv[4] < 200) bad.push(`${name} 畫布 ${m.cv}`);
      if (m.btns.some((x) => x < 44)) bad.push(`${name} 按鈕 ${m.btns}`);
      if (m.sw > m.vw) bad.push(`${name} 水平捲動 ${m.sw}>${m.vw}`);
      await c2.close();
    }
    check(`${tag} TSIM-13 393×852、375×667：畫布完整、按鈕 ≥44px、無水平捲動`, bad.length === 0, bad.join('；'));
    console.log(`[只回報] ${tag} AI 鎖刀耗時 ms：${lockMs.join(',')}`);
  }
  await browser.close();
}
