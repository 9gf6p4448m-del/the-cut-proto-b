// 幽光美術展示頁（art-kit/）瀏覽器測試（作者測試；WebKit＋Chromium 模擬，不是 iPhone 實機）。
// 重現製作人回報（2026-10-18 iOS 4G：「素材載入失敗：./assets/final/body.png」、實作欄空白）：素材請求單次失敗時頁面必須自動重試並載入成功；
// 全部重試都失敗時要顯示失敗細節（[DEBUG-artkit]）與「重新載入」「改用暫代素材」兩個按鈕，而不是整片空白。

// route 情境封鎖 service worker：SW 接手後的請求不經過 Playwright 的頁面路由，攔不到就驗不到重試（測試本身會空轉）
async function open(btype, bname, devices, url, route) {
  const b = await btype.launch();
  const opt = bname === 'webkit' ? { ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 } } : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const ctx = await b.newContext({ ...opt, serviceWorkers: route ? 'block' : 'allow' }); const page = await ctx.newPage(); page.__errs = []; page.on('pageerror', (e) => page.__errs.push(String(e)));
  if (route) await route(page);
  await page.goto(url + '/art-kit/?only=cut&t=3.3');
  await page.waitForFunction(() => (window.__art && window.__art.ready) || (document.getElementById('err').textContent || '').length > 0, null, { timeout: 40000 });
  return { b, ctx, page };
}
export async function runArtKitTests({ bname, btype, devices, url, check }) {
  const tag = `[${bname}][art]`;
  { const { b, page } = await open(btype, bname, devices, url);
    check(`${tag} 正式素材載入完成、無頁面錯誤`, await page.evaluate(() => window.__art.ready) && page.__errs.length === 0, page.__errs.join('|')); await b.close(); }
  { // body.png 第一次請求中斷（模擬 4G 單次失敗）→ 應自動重試並成功
    let n = 0; const { b, page } = await open(btype, bname, devices, url, (p) => p.route('**/assets/final/body.png*', (r) => (n++ === 0 ? r.abort('failed') : r.continue())));
    const st = await page.evaluate(() => ({ ready: window.__art.ready, err: document.getElementById('err').textContent }));
    check(`${tag} 素材單次載入失敗會自動重試並成功（請求 ${n} 次）`, st.ready === true && st.err === '' && n >= 2, JSON.stringify(st)); await b.close(); }
  { // body.png 每次都失敗 → 顯示細節＋重新載入＋改用暫代素材，不是空白
    const { b, page } = await open(btype, bname, devices, url, (p) => p.route('**/assets/final/body.png*', (r) => r.abort('failed')));
    const st = await page.evaluate(() => ({ ready: window.__art.ready, err: document.getElementById('err').innerText, btns: [...document.querySelectorAll('#err button')].map((x) => x.textContent) }));
    check(`${tag} 素材全部重試失敗：顯示 [DEBUG-artkit] 細節與「重新載入」「改用暫代素材」按鈕`, !st.ready && st.err.includes('[DEBUG-artkit]') && st.err.includes('body.png') && st.btns.includes('重新載入') && st.btns.includes('改用暫代素材'), JSON.stringify(st)); await b.close(); }
  { // v3（duel v0.3，DL-084）像素量測：AV3-2 陣營色光邊、AV3-3 顯示半徑、AV3-4 狀態差異、AV3-5 切割期調暗、AV3-8 刀痕兩樣式
    const { b, page } = await open(btype, bname, devices, url);
    const m = await page.evaluate(() => {
      const A = window.__art.assets, X = window.__art.api, r = 34, KINDS = ['claw', 'heart', 'eye', 'poison', 'bone'];
      const mkc = (w, h, bg) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); } return [c, x]; };
      const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const organ = (k, side, st, t = 0, bg) => { const [c, x] = mkc(200, 200, bg); X.drawOrganV3(x, A.organs[k], { kind: k, side, x: 100, y: 100, r }, st, t); return c; };
      const out = { radius: [], rim: [], cuttable: [], sprout: [], lit: [], locked: [] };
      for (const k of KINDS) {
        // AV3-3：量 drawOrganV3 實際畫出來的像素（含外光邊；整合端量的就是這個）——透明底 alpha>127 外框長邊＝2r、中心＝器官中心；正常／可切脈動最亮時／按住加亮 × dpr 1、2 × 兩側
        const L = X.organLayers(A.organs[k], k, 'blue', r, 1);
        for (const dpr of [1, 2]) for (const side of ['blue', 'red']) for (const [sn, st, t] of [['normal', { mode: 'normal' }, 0], ['cuttable', { mode: 'normal', cuttable: true }, 0.3125], ['lit', { mode: 'normal', cuttable: true, lit: 1 }, 0]]) {
          const [c, x] = mkc(200 * dpr, 200 * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0); X.drawOrganV3(x, A.organs[k], { kind: k, side, x: 100, y: 100, r }, st, t);
          const d = px(c), W = 200 * dpr; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < W; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4 + 3] > 127) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          out.radius.push({ k, dpr, side, sn, long: Math.max(x1 - x0 + 1, y1 - y0 + 1) / dpr, dcx: ((x0 + x1 + 1) / 2) / dpr - 100, dcy: ((y0 + y1 + 1) / 2) / dpr - 100 });
        }
        // AV3-2：本體以外、可見的像素（光邊）平均色
        for (const side of ['blue', 'red']) {
          const o = px(organ(k, side, { mode: 'normal' })), Lb = px(X.organLayers(A.organs[k], k, side, r, 1).body), half = r + L.pad, off = 100 - half; let R = 0, B = 0, n = 0;
          for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) { const i = (y * 200 + x) * 4, bx = x - off, by = y - off, ba = bx >= 0 && by >= 0 && bx < L.body.width && by < L.body.height ? Lb[(by * L.body.width + bx) * 4 + 3] : 0; if (o[i + 3] > 40 && ba < 5) { R += o[i]; B += o[i + 2]; n++; } }
          out.rim.push({ k, side, R: R / n, B: B / n, n });
        }
        // AV3-4
        const a = px(organ(k, 'red', { mode: 'normal', cuttable: true }, 0)), b2 = px(organ(k, 'red', { mode: 'normal', cuttable: true }, 0.3)); let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b2[i]); out.cuttable.push({ k, diff });
        const meanA = (c) => { const d2 = px(c); let s = 0; for (let i = 3; i < d2.length; i += 4) s += d2[i]; return s / (d2.length / 4); };
        out.sprout.push({ k, sprout: meanA(organ(k, 'red', { mode: 'sprout' })), normal: meanA(organ(k, 'red', { mode: 'normal' })) });
        const lum = (c) => { const d2 = px(c); let s = 0; for (let i = 0; i < d2.length; i += 4) s += 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2]; return s / (d2.length / 4); };
        out.lit.push({ k, lit: lum(organ(k, 'red', { mode: 'normal', lit: 1 }, 0, '#000')), base: lum(organ(k, 'red', { mode: 'normal' }, 0, '#000')) });
        const ring = (c) => { const d2 = px(c); let n = 0; for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) { const q = Math.hypot(x + 0.5 - 100, y + 0.5 - 100); if (q >= 1.15 * r && q <= 1.3 * r && d2[(y * 200 + x) * 4 + 3] > 40) n++; } return n; };
        out.locked.push({ k, locked: ring(organ(k, 'blue', { mode: 'locked', k: 1 })), normal: ring(organ(k, 'blue', { mode: 'normal' })) });
      }
      // AV3-5：393×852，藍方身體多邊形內（扣掉和紅方重疊的前線帶）平均亮度，調暗 vs 不調暗
      const w = 393, h = 852, bw = w * 1.18, bh = h * 0.64, R2 = { blue: { x: (w - bw) / 2, y: h * 0.38, w: bw, h: bh }, red: { x: (w - bw) / 2, y: -h * 0.02, w: bw, h: bh } };
      const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
      const bp = X.bodyPolyWorld(A.body, R2.blue, 'blue'), rp = X.bodyPolyWorld(A.body, R2.red, 'red');
      const sceneLum = (dim) => { const [c, x] = mkc(w, h); X.drawDuelScene(x, { w, h, body: A.body, rects: R2, dim }, 1); const d2 = px(c); let s = 0, n = 0; for (let y = 0; y < h; y += 2) for (let xx = 0; xx < w; xx += 2) if (inside([xx + 0.5, y + 0.5], bp) && !inside([xx + 0.5, y + 0.5], rp)) { const i = (y * w + xx) * 4; s += 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2]; n++; } return s / n; };
      const dimL = sceneLum(X.CUT_DIM), fullL = sceneLum(undefined);
      // AV3-8：同一串點，亮刀 vs 鈍刀（黑底）
      const pts = Array.from({ length: 13 }, (_, i) => ({ x: 20 + i * 13, y: 100 + Math.sin(i) * 8, t: i * 0.016 }));
      const trail = (blunt) => { const [c, x] = mkc(200, 200, '#000'); X.drawTrail(x, pts, 0.2, blunt); const d2 = px(c); let L = 0, S = 0, n = 0; for (let i = 0; i < d2.length; i += 4) { const l = 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2]; if (l > 8) { L += l; S += Math.max(d2[i], d2[i + 1], d2[i + 2]) - Math.min(d2[i], d2[i + 1], d2[i + 2]); n++; } } return { lum: L / 40000, sat: n ? S / n : 0 }; };
      // AV3-7（實際畫面）：刀水平（angle 0）切 r=34 的心，刀上側那半往上、下側那半往下（垂直刀向分開）、整體順刀向往前；中線一帶裂開；淡出；傳 body＋rect 時本體閃白
      const split = (t, extra = {}, rr = r, at = [100, 100]) => { const [c, x] = mkc(200, 200); X.playFx2(x, { type: 'split', t0: 0, im: A.organs.heart, kind: 'heart', side: 'red', x: at[0], y: at[1], r: rr, angle: 0, ...extra }, t); return px(c); };
      const stat = (d) => { let up = 0, upY = 0, dn = 0, dnY = 0, band = 0, sx = 0, n = 0, sum = 0; for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) { const a = d[(y * 200 + x) * 4 + 3]; sum += a; if (a <= 140) continue; n++; sx += x; if (y < 100) { up++; upY += y; } else { dn++; dnY += y; } if (Math.abs(y + 0.5 - 100) < r * 0.2) band++; } return { upY: upY / up, dnY: dnY / dn, band, cx: sx / n, sum, n }; };
      const s0 = stat(split(0)), s1 = stat(split(0.2)), sEnd = stat(split(0.59));
      const flashRegion = (d) => { let s2 = 0; for (let y = 130; y < 200; y++) for (let x = 0; x < 200; x++) s2 += d[(y * 200 + x) * 4 + 3]; return s2; };
      const flashOn = flashRegion(split(0.02, { body: A.body, rect: { x: 0, y: 0, w: 200, h: 200 } }, 10, [100, 30])), flashOff = flashRegion(split(0.02, {}, 10, [100, 30]));
      // AV3-2（截圖口徑，第二輪覆審 HIGH）：器官疊在實際對戰場景上（切割期調暗／戰鬥期不調暗），本體外緣 2～8px 環帶平均色：藍方 B>R、紅方 R>B。
      // 可切取脈動最暗相位（t=0.9375）。環帶＝本體層 alpha<5、但 2～8px 內 16 個方向有本體 alpha>127 的像素。
      const rimScene = [];
      for (const dim of [X.CUT_DIM, undefined]) for (const k of KINDS) for (const side of ['blue', 'red']) for (const [sn, st, t] of [['normal', { mode: 'normal' }, 0], ['cuttable', { mode: 'normal', cuttable: side === 'red' }, 0.9375]]) {
        const rc = R2[side], u = 0.44, v = 0.36, ox = rc.x + rc.w * u, oy = rc.y + rc.h * v, cx = Math.round(side === 'red' ? 2 * (rc.x + rc.w / 2) - ox : ox), cy = Math.round(side === 'red' ? 2 * (rc.y + rc.h / 2) - oy : oy);
        const [c, x] = mkc(w, h); X.drawDuelScene(x, { w, h, body: A.body, rects: R2, dim }, 1); X.drawOrganV3(x, A.organs[k], { kind: k, side, x: cx, y: cy, r }, st, t);
        const Lb = X.organLayers(A.organs[k], k, side, r, 1), B = px(Lb.body), BW = Lb.body.width, half = r + Lb.pad, bodyA = (xx, yy) => { const bx = xx - (cx - half), by = yy - (cy - half); return bx >= 0 && by >= 0 && bx < BW && by < BW ? B[(by * BW + bx) * 4 + 3] : 0; };
        const d = x.getImageData(cx - half, cy - half, 2 * half, 2 * half).data; let R = 0, Bl = 0, n = 0;
        for (let yy = cy - half; yy < cy + half; yy++) for (let xx = cx - half; xx < cx + half; xx++) {
          if (bodyA(xx, yy) >= 5) continue; let near = false;
          for (let dd = 2; dd <= 8 && !near; dd += 2) for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; if (bodyA(Math.round(xx + Math.cos(an) * dd), Math.round(yy + Math.sin(an) * dd)) > 127) { near = true; break; } }
          if (!near) continue; const i = ((yy - (cy - half)) * 2 * half + (xx - (cx - half))) * 4; R += d[i]; Bl += d[i + 2]; n++;
        }
        rimScene.push({ dim: !!dim, k, side, sn, R: Math.round(R / n), B: Math.round(Bl / n), n });
      }
      // AV3-2 多位置掃描（主 session 2026-10-18 裁定現在修：前線帶不得偏色）：器官放在自己身體多邊形內每 24px 一點（含前線帶＝也在對方身體內），每個位置 5 種器官都量。
      // 戰鬥期（不調暗、normal）與切割期（調暗；紅方可切取脈動最暗相位 t=0.9375、藍方 normal）；dpr 2（手機畫布上限）；環帶＝本體外 2～8 CSS px（16 方向取樣）。
      const sweep = { cut: { blue: [], red: [] }, battle: { blue: [], red: [] } }, D2 = 2;
      for (const [scene, dim] of [['battle', undefined], ['cut', X.CUT_DIM]]) {
        const [S, sx] = mkc(w * D2, h * D2); sx.setTransform(D2, 0, 0, D2, 0, 0); X.drawDuelScene(sx, { w, h, body: A.body, rects: R2, dim }, 1);
        for (const side of ['blue', 'red']) {
          const own = side === 'blue' ? bp : rp, other = side === 'blue' ? rp : bp;
          for (let cy = 40; cy < h - 40; cy += 24) for (let cx = 40; cx < w - 40; cx += 24) {
            if (!inside([cx, cy], own)) continue;
            for (const k of KINDS) {
              const st = scene === 'cut' && side === 'red' ? { mode: 'normal', cuttable: true } : { mode: 'normal' }, t = scene === 'cut' ? 0.9375 : 0;
              const Lb = X.organLayers(A.organs[k], k, side, r, D2), half = r + Lb.pad, BW = Lb.body.width, B = (Lb.__a ??= px(Lb.body));
              if (!Lb.__ring) { Lb.__ring = []; const ba = (bx, by) => (bx >= 0 && by >= 0 && bx < BW && by < BW ? B[(by * BW + bx) * 4 + 3] : 0); for (let by = 0; by < BW; by++) for (let bx = 0; bx < BW; bx++) { if (ba(bx, by) >= 5) continue; let near = false; for (let dd = 4; dd <= 16 && !near; dd += 2) for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; if (ba(Math.round(bx + Math.cos(an) * dd), Math.round(by + Math.sin(an) * dd)) > 127) { near = true; break; } } if (near) Lb.__ring.push(by * BW + bx); } }
              const [c, x] = mkc(BW, BW); x.drawImage(S, (cx - half) * D2, (cy - half) * D2, BW, BW, 0, 0, BW, BW); x.setTransform(D2, 0, 0, D2, (half - cx) * D2, (half - cy) * D2); X.drawOrganV3(x, A.organs[k], { kind: k, side, x: cx, y: cy, r }, st, t);
              const d = px(c); let R = 0, Bl = 0; for (const i of Lb.__ring) { R += d[i * 4]; Bl += d[i * 4 + 2]; }
              const n = Lb.__ring.length; sweep[scene][side].push({ x: cx, y: cy, k, front: inside([cx, cy], other), m: side === 'blue' ? (Bl - R) / n : (R - Bl) / n });
            }
          }
        }
      }
      // 審查 MEDIUM 回歸：dim 為 NaN、r 為 Infinity 不丟例外；兩張不同的畫布（沒帶 __id）當器官圖不會共用快取
      const errs = []; const tryDo = (n, fn) => { try { fn(); } catch (e) { errs.push(`${n}: ${e}`); } };
      tryDo('dimNaN', () => { const [, x] = mkc(w, h); X.drawDuelScene(x, { w, h, body: A.body, rects: R2, dim: { alpha: NaN, saturation: NaN } }, 1); });
      tryDo('rInf', () => { const [, x] = mkc(200, 200); X.drawOrganV3(x, A.organs.eye, { kind: 'eye', side: 'blue', x: 100, y: 100, r: Infinity }, { mode: 'normal' }, 0); });
      const cvImg = (W, H) => { const [c, x] = mkc(W, H, '#fff'); return c; }, tall = (im) => { const [c, x] = mkc(200, 200); X.drawOrganV3(x, im, { kind: 'claw', side: 'blue', x: 100, y: 100, r: 20 }, { mode: 'normal' }, 0); const d = px(c); let y0 = 1e9, y1 = -1; for (let y = 0; y < 200; y++) for (let xx = 0; xx < 200; xx++) if (d[(y * 200 + xx) * 4 + 3] > 127) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return y1 - y0 + 1; };
      const hSquare = tall(cvImg(100, 100)), hFlat = tall(cvImg(100, 20));
      return { ...out, dimL, fullL, sharp: trail(false), blunt: trail(true), sp: { s0, s1, sEnd, flashOn, flashOff }, errs, hSquare, hFlat, rimScene, sweep };
    });
    { const bad = m.radius.filter((x) => !(Math.abs(x.long - 68) <= 2 && Math.abs(x.dcx) <= 2 && Math.abs(x.dcy) <= 2)); check(`${tag} AV3-3 顯示半徑（drawOrganV3 實際輸出，含光邊）：alpha>50% 外框長邊＝2r±2、中心偏差 ≤2px（r=34；5 種×正常／可切最亮／加亮×dpr1、2×兩側＝${m.radius.length} 例；長邊 ${Math.min(...m.radius.map((x) => x.long))}～${Math.max(...m.radius.map((x) => x.long))}）`, bad.length === 0, JSON.stringify(bad.slice(0, 6))); }
    { const bad = m.rimScene.filter((x) => !(x.n > 50 && (x.side === 'blue' ? x.B > x.R : x.R > x.B))); check(`${tag} AV3-2 陣營色外光邊（疊在對戰場景上、切割期調暗與戰鬥期、可切取最暗相位，${m.rimScene.length} 例）：藍方外緣 B>R、紅方 R>B（最小差 藍 ${Math.min(...m.rimScene.filter((x) => x.side === 'blue').map((x) => x.B - x.R))}、紅 ${Math.min(...m.rimScene.filter((x) => x.side === 'red').map((x) => x.R - x.B))}）`, bad.length === 0, JSON.stringify(bad.slice(0, 8))); }
    for (const scene of ['battle', 'cut']) for (const side of ['blue', 'red']) { const a = m.sweep[scene][side], fr = a.filter((x) => x.front), bad = a.filter((x) => !(x.m > 5)), mn = (v) => (v.length ? Math.min(...v.map((x) => x.m)).toFixed(1) : '—');
      check(`${tag} AV3-2 多位置掃描 ${scene === 'battle' ? '戰鬥期' : '切割期'}${side === 'blue' ? '藍方' : '紅方'}：${a.length} 個位置（前線帶 ${fr.length}）全部偏陣營色、色差 >5（最小差 全體 ${mn(a)}、前線帶 ${mn(fr)}）`, a.length > 50 && fr.length > 10 && bad.length === 0, `${bad.length} 個偏色：` + JSON.stringify(bad.slice(0, 5).map((x) => [x.x, x.y, x.k, x.front, +x.m.toFixed(1)]))); }
    check(`${tag} AV3-2 陣營色外光邊（透明底單獨量）：藍方光邊 B>R、紅方 R>B`, m.rim.every((x) => x.n > 50 && (x.side === 'blue' ? x.B > x.R : x.R > x.B)), JSON.stringify(m.rim.map((x) => [x.k, x.side, Math.round(x.R), Math.round(x.B), x.n])));
    check(`${tag} AV3-4 狀態：可切脈動（t 不同像素不同）、萌芽半透明、按住加亮、鎖定護盾環`, m.cuttable.every((x) => x.diff > 1000) && m.sprout.every((x) => x.sprout < 0.6 * x.normal) && m.lit.every((x) => x.lit > 1.1 * x.base) && m.locked.every((x) => x.locked > x.normal + 100), JSON.stringify({ c: m.cuttable.map((x) => x.diff), s: m.sprout.map((x) => +(x.sprout / x.normal).toFixed(2)), l: m.lit.map((x) => +(x.lit / x.base).toFixed(2)), k: m.locked.map((x) => [x.locked, x.normal]) }));
    check(`${tag} AV3-5 切割期調暗：藍方身體內平均亮度 調暗/不調暗 ≤0.75（${m.dimL.toFixed(1)}/${m.fullL.toFixed(1)}＝${(m.dimL / m.fullL).toFixed(2)}）`, m.dimL / m.fullL <= 0.75);
    check(`${tag} AV3-8 刀痕兩樣式：鈍刀比亮刀暗（亮度 ≤0.7 倍）且較灰（飽和度較低）`, m.blunt.lum <= 0.7 * m.sharp.lum && m.blunt.sat < m.sharp.sat, JSON.stringify({ sharp: m.sharp, blunt: m.blunt }));
    { const { s0, s1, sEnd, flashOn, flashOff } = m.sp;
      check(`${tag} AV3-7 切除特效（實際畫面）：上半往上、下半往下（各 ≥0.3r）、往刀向前進、中線裂開（兩半合計不超過原本 1.4 倍＝真的是一分為二）、淡出、本體閃白（t=0.2s）`, s1.upY < s0.upY - 0.3 * 34 && s1.dnY > s0.dnY + 0.3 * 34 && s1.cx > s0.cx + 0.2 * 34 && s1.band < 0.5 * s0.band && s1.n < 1.4 * s0.n && sEnd.sum < 0.15 * s0.sum && flashOn > flashOff * 1.5 + 1000, JSON.stringify(m.sp)); }
    check(`${tag} AV3-10 邊界：dim NaN、r=Infinity 不丟例外；不同畫布不共用器官快取（正方 ${m.hSquare}px、扁 ${m.hFlat}px）`, m.errs.length === 0 && Math.abs(m.hSquare - 40) <= 2 && m.hFlat < 15, m.errs.join('|'));
    await b.close(); }
}
