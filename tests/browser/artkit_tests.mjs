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
        // AV3-3：本體層 alpha>127 外框長邊＝2r、中心＝層中心
        const L = X.organLayers(A.organs[k], k, 'blue', r, 1), d = px(L.body); let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < L.body.height; y++) for (let x = 0; x < L.body.width; x++) if (d[(y * L.body.width + x) * 4 + 3] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        out.radius.push({ k, long: Math.max(x1 - x0 + 1, y1 - y0 + 1), dcx: (x0 + x1 + 1) / 2 - L.body.width / 2, dcy: (y0 + y1 + 1) / 2 - L.body.height / 2 });
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
      return { ...out, dimL, fullL, sharp: trail(false), blunt: trail(true) };
    });
    check(`${tag} AV3-3 顯示半徑：本體 alpha>50% 外框長邊＝2r±2、中心偏差 ≤2px（r=34）`, m.radius.every((x) => Math.abs(x.long - 68) <= 2 && Math.abs(x.dcx) <= 2 && Math.abs(x.dcy) <= 2), JSON.stringify(m.radius));
    check(`${tag} AV3-2 陣營色外光邊：藍方光邊 B>R、紅方 R>B`, m.rim.every((x) => x.n > 50 && (x.side === 'blue' ? x.B > x.R : x.R > x.B)), JSON.stringify(m.rim.map((x) => [x.k, x.side, Math.round(x.R), Math.round(x.B), x.n])));
    check(`${tag} AV3-4 狀態：可切脈動（t 不同像素不同）、萌芽半透明、按住加亮、鎖定護盾環`, m.cuttable.every((x) => x.diff > 1000) && m.sprout.every((x) => x.sprout < 0.6 * x.normal) && m.lit.every((x) => x.lit > 1.1 * x.base) && m.locked.every((x) => x.locked > x.normal + 100), JSON.stringify({ c: m.cuttable.map((x) => x.diff), s: m.sprout.map((x) => +(x.sprout / x.normal).toFixed(2)), l: m.lit.map((x) => +(x.lit / x.base).toFixed(2)), k: m.locked.map((x) => [x.locked, x.normal]) }));
    check(`${tag} AV3-5 切割期調暗：藍方身體內平均亮度 調暗/不調暗 ≤0.75（${m.dimL.toFixed(1)}/${m.fullL.toFixed(1)}＝${(m.dimL / m.fullL).toFixed(2)}）`, m.dimL / m.fullL <= 0.75);
    check(`${tag} AV3-8 刀痕兩樣式：鈍刀比亮刀暗（亮度 ≤0.7 倍）且較灰（飽和度較低）`, m.blunt.lum <= 0.7 * m.sharp.lum && m.blunt.sat < m.sharp.sat, JSON.stringify({ sharp: m.sharp, blunt: m.blunt }));
    await b.close(); }
}
