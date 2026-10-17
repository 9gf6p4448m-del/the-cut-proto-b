// 幽光美術模組展示頁 v3（子路徑 art-kit/）：「生成圖當素材＋程式負責動態」。三個目標畫面（切割／戰鬥／縫合）各與目標圖並排，
// 另有器官 × 狀態、素材管線（染色＋自動身體多邊形）、v0.3 手感（教學虛擬手、刀痕光帶）。?only=cut|battle|stitch|feel 只全螢幕畫一個畫面（393×852 截圖與 FPS 量測用）。
// v0.3（DL-084）：切割期本體調暗（CUT_DIM）、器官改 drawOrganV3（無圓框、陣營色外光邊、半徑 ORGAN_R＝34）、切除特效 split、刀痕 drawTrail。
// v1 的程式繪製獸身展示（drawScene 等）仍在 src/art/ghostlight.ts，可在 git 歷史 06797e8 的展示頁看到。
import { CUT_DIM, ORGAN_R, bodyPolyWorld, organLayers, drawBackdrop, drawBodySprite, drawCard, drawDuelScene, drawHud, drawOrganSprite, drawOrganV3, drawSlot, drawSuture, drawTrail, loadAssets, loadLog, maskOf, pathPoint, playFx2, playTutorialSwipe, shake2, tinted } from './sprites.ts';
import type { Assets, Fx2, Kind, OrganStateV3, Rect, Side, TrailPt } from './sprites.ts';
import { bodyPolygon, maskArea, polygonArea, downsampleMask, outerRingArea } from './polygon.ts';
import type { P } from './polygon.ts';

declare const __BUILD_SHA__: string;
const SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
(document.getElementById('sha') as HTMLElement).textContent = SHA;
const ONLY = new URLSearchParams(location.search).get('only');
const FREEZE = Number(new URLSearchParams(location.search).get('t') ?? 'NaN'); // ?t=2.1：時間凍結（截圖用，讓特效停在固定時刻）
if (ONLY) document.body.classList.add('only');
const KINDS: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
const ZH: Record<Kind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨' };

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, t: number, A: Assets) => void;
interface Panel { id: string; cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number; visible: boolean; draw: Draw }
const panels: Panel[] = [];
function panel(id: string, draw: Draw): void {
  const cv = document.getElementById(id) as HTMLCanvasElement | null; if (!cv) return;
  const sec = cv.closest('section') as HTMLElement | null;
  if (ONLY && ONLY !== id) { if (sec) sec.style.display = 'none'; return; }
  const p: Panel = { id, cv, ctx: cv.getContext('2d')!, w: 0, h: 0, visible: true, draw }; panels.push(p);
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { for (const e of es) p.visible = e.isIntersecting; }).observe(cv);
}
function fit(p: Panel): void { const r = p.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(r.width), h = Math.round(r.height); if (w !== p.w || h !== p.h || p.cv.width !== Math.round(w * dpr)) { p.w = w; p.h = h; p.cv.width = Math.round(w * dpr); p.cv.height = Math.round(h * dpr); } p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
const label = (c: CanvasRenderingContext2D, s: string, x: number, y: number, size = 12, col = 'rgba(174,234,255,0.85)', align: CanvasTextAlign = 'center') => { c.font = `600 ${size}px "PingFang TC","Noto Sans TC",system-ui,sans-serif`; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); };

// 對戰版面：藍在下、紅在上（同一張本體旋轉 180°），中段交疊成前線帶。
function duelRects(w: number, h: number): Record<Side, Rect> { const bw = w * 1.18, bh = h * 0.64; return { blue: { x: (w - bw) / 2, y: h * 0.38, w: bw, h: bh }, red: { x: (w - bw) / 2, y: -h * 0.02, w: bw, h: bh } }; }
// 器官位置（相對 rect 的比例；紅方轉 180°）
const SPOTS: { kind: Kind; u: number; v: number }[] = [{ kind: 'claw', u: 0.22, v: 0.62 }, { kind: 'heart', u: 0.44, v: 0.36 }, { kind: 'eye', u: 0.42, v: 0.2 }, { kind: 'poison', u: 0.62, v: 0.48 }, { kind: 'bone', u: 0.3, v: 0.48 }, { kind: 'claw', u: 0.7, v: 0.72 }];
function spot(r: Rect, side: Side, u: number, v: number): P { const x = r.x + r.w * u, y = r.y + r.h * v; return side === 'red' ? [2 * (r.x + r.w / 2) - x, 2 * (r.y + r.h / 2) - y] : [x, y]; }
function organs(R: Record<Side, Rect>) { return (['blue', 'red'] as Side[]).flatMap((side) => SPOTS.map((s) => ({ side, kind: s.kind, p: spot(R[side], side, s.u, s.v) }))); }
function countsColumn(c: CanvasRenderingContext2D, A: Assets, x: number, side: Side, n: Record<Kind, number>, align: 1 | -1): void {
  (['claw', 'heart', 'eye', 'poison'] as Kind[]).forEach((k, i) => { const y = 92 + i * 34, im = k === 'poison' ? A.organs[k] : tinted(A.organs[k], side === 'blue' ? '#278DD1' : '#C73548', 1.05); c.drawImage(im, x - 13, y - 13, 26, 26); c.font = 'italic 300 16px Georgia,serif'; c.fillStyle = side === 'blue' ? '#AEEAFF' : '#ffb0b8'; c.textAlign = align > 0 ? 'left' : 'right'; c.textBaseline = 'middle'; c.fillText(`${n[k]}`, x + align * 20, y); });
}

// ---- 切割期（TARGET_cut）：本體調暗、器官無圓框；每 3.2 秒示範一刀：按住（範圍內的對方器官加亮）→ 劃過自己的心（鎖定）→ 切下對方的毒（裂成兩半）----
const CUT_LOOP = 3.2, HOLD: [number, number] = [0.3, 0.7], SWIPE: [number, number] = [0.7, 1.05];
function cutPath(os: ReturnType<typeof organs>): P[] { const tg = os.find((o) => o.side === 'red' && o.kind === 'poison')!.p, own = os.find((o) => o.side === 'blue' && o.kind === 'heart')!.p; return [[own[0] + 70, own[1] + 120], own, tg]; }
const drawCut: Draw = (c, w, h, t, A) => {
  const R = duelRects(w, h), r = ORGAN_R, os = organs(R), lt = ((t % CUT_LOOP) + CUT_LOOP) % CUT_LOOP, base = t - lt, path = cutPath(os), start = path[0];
  drawDuelScene(c, { w, h, body: A.body, rects: R, dim: CUT_DIM }, t);
  const at = (tt: number): P => pathPoint(path, (tt - base - SWIPE[0]) / (SWIPE[1] - SWIPE[0])), cut = lt >= SWIPE[1], holding = lt >= HOLD[0] && lt < SWIPE[0], lockAt = (SWIPE[0] + SWIPE[1]) / 2;
  os.forEach((o, i) => {
    if (cut && o.side === 'red' && o.kind === 'poison') return;
    const near = Math.hypot(o.p[0] - start[0], o.p[1] - start[1]) <= 420;
    const st: OrganStateV3 = o.side === 'blue' && o.kind === 'heart' ? (lt >= lockAt ? { mode: 'locked', k: 1 - (lt - lockAt) / 3, label: (3 - (lt - lockAt)).toFixed(1) } : { mode: 'normal' }) : i === 11 ? { mode: 'sprout' } : { mode: 'normal', cuttable: o.side === 'red', lit: o.side === 'red' && holding && near ? Math.min(1, (lt - HOLD[0]) / 0.15) : 0 };
    drawOrganV3(c, A.organs[o.kind], { kind: o.kind, side: o.side, x: o.p[0], y: o.p[1], r }, st, t);
  });
  if (lt >= SWIPE[0]) { const pts: TrailPt[] = []; for (let tt = Math.max(base + SWIPE[0], t - 0.25); tt <= Math.min(t, base + SWIPE[1]) + 1e-9; tt += 1 / 60) { const p = at(tt); pts.push({ x: p[0], y: p[1], t: tt }); } drawTrail(c, pts, t); }
  const tg = path[2], own = path[1];
  playFx2(c, { type: 'split', t0: base + SWIPE[1], im: A.organs.poison, kind: 'poison', side: 'red', x: tg[0], y: tg[1], r, angle: Math.atan2(tg[1] - own[1], tg[0] - own[0]), body: A.body, rect: R.red }, t);
  if (holding) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(174,234,255,0.5)'; c.lineWidth = 2; c.beginPath(); c.arc(start[0], start[1], 10 + 6 * Math.sin(t * 9), 0, Math.PI * 2); c.stroke(); c.restore(); }
  countsColumn(c, A, 22, 'blue', { claw: 2, heart: 1, eye: 1, poison: 1, bone: 1 }, 1); countsColumn(c, A, w - 22, 'red', { claw: 2, heart: 1, eye: 1, poison: cut ? 0 : 1, bone: 1 }, -1);
  drawHud(c, { w, timer: `0:${String(18 - Math.floor(t % 18)).padStart(2, '0')}`, hp: { blue: 92, red: 61, max: 100 } });
};
// ---- 戰鬥期（TARGET_battle）----
const drawBattle: Draw = (c, w, h, t, A) => {
  const R = duelRects(w, h), r = ORGAN_R, os = organs(R), loop = 4.8, lt = t % loop, base = t - lt;
  const P = (side: Side, kind: Kind) => os.find((o) => o.side === side && o.kind === kind)!.p;
  const fxs: Fx2[] = [
    { type: 'arcSlash', t0: base + 0.2, from: P('blue', 'claw'), to: P('red', 'eye'), side: 'blue', dmg: 4 },
    { type: 'critArc', t0: base + 1.0, from: P('blue', 'claw'), to: P('red', 'heart'), dmg: 26 },
    { type: 'hitFlash', t0: base + 1.25, body: A.body, rect: R.red, side: 'red' },
    { type: 'heal', t0: base + 2.0, at: P('red', 'heart'), amount: 3 },
    { type: 'poison', t0: base + 2.4, at: P('blue', 'poison'), stacks: 3 },
    { type: 'boneShield', t0: base + 3.2, at: P('blue', 'bone'), facing: -0.9, absorbed: 18, value: 15 },
  ];
  let sx = 0, sy = 0; for (const f of fxs) { const o = shake2(f, t); sx += o[0]; sy += o[1]; }
  c.fillStyle = '#070D19'; c.fillRect(0, 0, w, h); c.save(); c.translate(sx, sy);
  drawDuelScene(c, { w, h, body: A.body, rects: R }, t);
  os.forEach((o) => drawOrganV3(c, A.organs[o.kind], { kind: o.kind, side: o.side, x: o.p[0], y: o.p[1], r }, { mode: 'normal', lit: o.side === 'red' && o.kind === 'heart' ? Math.max(0, 1 - ((lt - 2.0 + loop) % loop) * 3) : 0 }, t));
  for (const f of fxs) playFx2(c, f, t);
  c.restore();
  drawHud(c, { w, banner: '×2 加時', hp: { blue: 74, red: 68 - Math.floor((lt / loop) * 6), max: 100 } });
};
// ---- 縫合擺放（TARGET_stitch）----
const drawStitch: Draw = (c, w, h, t, A) => {
  drawBackdrop(c, w, h);
  const rect: Rect = { x: -w * 0.02, y: h * 0.07, w: w * 1.04, h: h * 0.62 }; drawBodySprite(c, A.body, rect, 'blue', t, 0.9);
  label(c, '挑選並縫合', w / 2, h * 0.04, 18, '#E8F4FF');
  const r = Math.max(14, w * 0.045), at = (u: number, v: number): P => [rect.x + rect.w * u, rect.y + rect.h * v];
  drawOrganSprite(c, A.organs.heart, { kind: 'heart', side: 'blue', x: at(0.43, 0.33)[0], y: at(0.43, 0.33)[1], r }, { mode: 'normal' }, t);
  drawOrganSprite(c, A.organs.eye, { kind: 'eye', side: 'blue', x: at(0.4, 0.2)[0], y: at(0.4, 0.2)[1], r: r * 0.8 }, { mode: 'normal' }, t);
  for (const [u, v] of [[0.57, 0.3], [0.27, 0.42], [0.6, 0.62], [0.2, 0.62]] as [number, number][]) drawSlot(c, at(u, v)[0], at(u, v)[1], r * 0.9, 'ok', t);
  drawSlot(c, at(0.68, 0.23)[0], at(0.68, 0.23)[1], r * 0.9, 'bad', t);
  const cw = w * 0.28, ch = h * 0.2, cy = h * 0.74, cards: [Kind, string][] = [['claw', '爪'], ['eye', '眼'], ['poison', '毒']];
  cards.forEach(([k, s], i) => drawCard(c, { x: w * 0.05 + i * (cw + w * 0.035), y: cy, w: cw, h: ch }, A.organs[k], k, s, i === 2, t));
  const from: P = [w * 0.05 + 2 * (cw + w * 0.035) + cw / 2, cy + 10], to = at(0.57, 0.3); drawSuture(c, from, to, t); drawSlot(c, to[0], to[1], r * 0.9, 'hover', t);
};
// ---- 器官 × 狀態（v0.3：素材＋陣營色外光邊，無圓框）----
const COLS: { name: string; side: Side; st?: (t: number) => OrganStateV3 }[] = [
  { name: '正常藍', side: 'blue', st: () => ({ mode: 'normal' }) }, { name: '可切紅（脈動）', side: 'red', st: () => ({ mode: 'normal', cuttable: true }) },
  { name: '按住加亮', side: 'red', st: (t) => ({ mode: 'normal', cuttable: true, lit: 0.5 + 0.5 * Math.sin(t * 3) }) }, { name: '鎖定（護盾環）', side: 'blue', st: (t) => ({ mode: 'locked', k: 1 - ((t * 0.25) % 1) }) },
  { name: '萌芽（半透明）', side: 'red', st: () => ({ mode: 'sprout' }) }, { name: '切除', side: 'red' },
];
const drawOrgans: Draw = (c, w, h, t, A) => {
  drawBackdrop(c, w, h); const top = 26, left = 24, cw = (w - left) / COLS.length, rh = (h - top) / KINDS.length, R = Math.min(cw, rh) * 0.36;
  COLS.forEach((col, j) => label(c, col.name, left + cw * (j + 0.5), 12, 9));
  KINDS.forEach((k, i) => { label(c, ZH[k], 11, top + rh * (i + 0.5), 14, '#F0F7FF'); COLS.forEach((col, j) => { const x = left + cw * (j + 0.5), y = top + rh * (i + 0.5);
    if (col.st) drawOrganV3(c, A.organs[k], { kind: k, side: col.side, x, y, r: R }, col.st(t), t);
    else { const lp = 1.2, t0 = t - (((t % lp) + lp) % lp); if (t - t0 < 0.2) drawOrganV3(c, A.organs[k], { kind: k, side: col.side, x, y, r: R }, { mode: 'normal', cuttable: true }, t); else playFx2(c, { type: 'split', t0: t0 + 0.2, im: A.organs[k], kind: k, side: col.side, x, y, r: R, angle: -0.6 }, t); } }); });
};
// ---- v0.3 手感：教學虛擬手（沿路徑劃一刀，約 3 秒）＋刀痕光帶兩種樣式 ----
function curveTrail(t: number, f: (tt: number) => P, blunt: boolean): TrailPt[] { const pts: TrailPt[] = []; for (let tt = t - 0.25; tt <= t + 1e-9; tt += 1 / 60) { const p = f(tt); pts.push({ x: p[0], y: p[1], t: tt, blunt }); } return pts; }
const drawFeel: Draw = (c, w, h, t, A) => {
  drawBackdrop(c, w, h); const half = w / 2;
  label(c, '教學虛擬手（每台裝置一次）', half / 2, 14, 11); label(c, '刀痕光帶', half + half / 2, 14, 11);
  const path: P[] = [[half * 0.8, h * 0.82], [half * 0.45, h * 0.5], [half * 0.2, h * 0.22]], lp = 3.6, t0 = t - (((t % lp) + lp) % lp);
  drawOrganV3(c, A.organs.claw, { kind: 'claw', side: 'red', x: path[2][0], y: path[2][1], r: 22 }, { mode: 'normal', cuttable: true }, t);
  playTutorialSwipe(c, path, t0, t, 3);
  const fx = (y0: number) => (tt: number): P => [half + half * (0.5 + 0.36 * Math.sin(tt * 2.6)), y0 + 26 * Math.sin(tt * 5.2)];
  drawTrail(c, curveTrail(t, fx(h * 0.36), false), t); label(c, '切割中（亮）', half + half / 2, h * 0.36 + 44, 10);
  drawTrail(c, curveTrail(t, fx(h * 0.72), true), t); label(c, '鈍刀（灰暗：速度不足）', half + half / 2, h * 0.72 + 44, 10);
};
// ---- 素材管線：原圖、染藍、染紅（轉 180°）＋自動身體多邊形 ----
let pipeInfo = '';
const drawPipe: Draw = (c, w, h, t, A) => {
  drawBackdrop(c, w, h); const cw = w / 3, rect = (i: number): Rect => ({ x: i * cw + 4, y: 24, w: cw - 8, h: h - 60 });
  const raw = rect(0), f = Math.min(raw.w / A.body.width, raw.h / A.body.height); c.drawImage(A.body, raw.x + (raw.w - A.body.width * f) / 2, raw.y + (raw.h - A.body.height * f) / 2, A.body.width * f, A.body.height * f);
  drawBodySprite(c, A.body, rect(1), 'blue', t); drawBodySprite(c, A.body, rect(2), 'red', t);
  for (const [i, side] of [[1, 'blue'], [2, 'red']] as [number, Side][]) { const poly = bodyPolyWorld(A.body, rect(i), side); c.strokeStyle = '#FFD27A'; c.lineWidth = 1.2; c.beginPath(); poly.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.stroke(); for (const p of poly) { c.fillStyle = '#FFD27A'; c.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); } }
  ['素材原圖（中性銀白）', '染藍＋候選邊界', '染紅（轉 180°）＋候選邊界'].forEach((s, i) => label(c, s, i * cw + cw / 2, 12, 10));
  if (!pipeInfo) { const m = maskOf(A.body), poly = bodyPolygon(m, { downsample: 4 }), pa = polygonArea(poly), fa = outerRingArea(downsampleMask(m, 4)) * 16, ma = maskArea(m); pipeInfo = `候選邊界（未確認，遊戲不直接讀）頂點 ${poly.length}｜vs 補洞後外框 ${((pa / fa - 1) * 100).toFixed(1)}%｜vs 含鏤空 alpha ${((pa / ma - 1) * 100).toFixed(1)}%（參考）`; }
  label(c, pipeInfo, w / 2, h - 18, 10, '#FFD27A');
};

panel('cut', drawCut); panel('battle', drawBattle); panel('stitch', drawStitch); panel('organs', drawOrgans); panel('pipe', drawPipe); panel('feel', drawFeel);

// ---- 迴圈與 FPS ----
const cost: Record<string, number> = {};
const fps = { frames: 0, since: performance.now(), value: 0, samples: [] as number[] };
let assets: Assets | null = null;
// 預設正式素材；?assets=placeholder 看暫代
loadAssets(new URLSearchParams(location.search).get('assets') === 'placeholder' ? './assets/placeholder' : './assets/final').then((a) => { assets = a; }).catch((e) => showLoadError(e));
/** 素材載入全部失敗：顯示原因、[DEBUG-artkit] 嘗試紀錄，以及「重新載入」「改用暫代素材」按鈕（不再整片空白）。 */
function showLoadError(e: unknown): void {
  const box = document.getElementById('err') as HTMLElement; box.textContent = '';
  const msg = document.createElement('div'); msg.textContent = String(e instanceof Error ? e.message : e); box.appendChild(msg);
  const fails = loadLog.filter((x) => !x.ok).slice(-6);
  const dbg = document.createElement('div'); dbg.style.cssText = 'font-size:10px;opacity:.8;margin:4px 0;word-break:break-all';
  dbg.textContent = '[DEBUG-artkit] ' + fails.map((x) => `${x.url.split('/').pop()} 第${x.attempt}次 ${x.ms}ms online=${x.online} sw=${x.sw}`).join('｜') + `｜成功 ${loadLog.filter((x) => x.ok).length} 個`;
  box.appendChild(dbg);
  const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'min-height:44px;margin:4px 8px 4px 0;padding:0 14px;border-radius:10px;border:1px solid #3a4150;background:#232935;color:#F0F7FF;font-size:14px'; b.addEventListener('click', fn); box.appendChild(b); };
  btn('重新載入', () => location.reload());
  btn('改用暫代素材', () => { const u = new URL(location.href); u.searchParams.set('assets', 'placeholder'); location.href = u.toString(); });
}
function frame(now: number): void {
  const t = Number.isFinite(FREEZE) ? FREEZE : now / 1000;
  if (assets) for (const p of panels) { if (!p.visible) continue; const c0 = performance.now(); fit(p); p.draw(p.ctx, p.w, p.h, t, assets); cost[p.id] = (cost[p.id] ?? 0) * 0.9 + (performance.now() - c0) * 0.1; }
  fps.frames++;
  if (now - fps.since >= 1000) { fps.value = (fps.frames * 1000) / (now - fps.since); fps.samples.push(fps.value); if (fps.samples.length > 30) fps.samples.shift(); fps.frames = 0; fps.since = now; (document.getElementById('fps') as HTMLElement).textContent = fps.value.toFixed(0); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// v3 繪圖函式與素材也掛出來，給瀏覽器像素測試在頁面裡直接呼叫（tests/browser/artkit_tests.mjs）
(window as unknown as { __art: unknown }).__art = { fps, cost, get ready() { return !!assets; }, get assets() { return assets; }, sha: SHA, loadLog, api: { CUT_DIM, ORGAN_R, drawOrganV3, organLayers, drawDuelScene, bodyPolyWorld, drawTrail, playFx2 } };
if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('./sw.js', { scope: './' });
