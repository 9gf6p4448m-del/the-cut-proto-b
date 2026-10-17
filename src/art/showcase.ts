// 幽光美術模組展示頁（子路徑 art-kit/）：①對戰場景（兩獸＋前線區＋器官＋特效輪播）②5 種器官 × 狀態 ③7 種戰鬥特效 ④前線區特寫。只用 src/art/ghostlight.ts 的公開函式。
import { drawBackdrop, drawBeast, drawFrontline, drawOrgan, drawScene, frontlineZone, fxDuration, playFx, shakeOffset } from './ghostlight.ts';
import type { ArtSide, Fx, OrganKind, OrganState, OrganView, P } from './ghostlight.ts';

declare const __BUILD_SHA__: string;
const SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
(document.getElementById('sha') as HTMLElement).textContent = SHA;
const KINDS: OrganKind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
const ZH: Record<OrganKind, string> = { claw: '爪', heart: '心', eye: '眼', poison: '毒', bone: '骨' };

interface Panel { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number; visible: boolean; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void }
const panels: Panel[] = [];
function panel(id: string, aspect: number, draw: Panel['draw']): void {
  const cv = document.getElementById(id) as HTMLCanvasElement, ctx = cv.getContext('2d')!;
  const only = new URLSearchParams(location.search).get('only'); // ?only=scene：只畫指定區塊（量測單一區塊 FPS 用）
  if (only && only !== id) { cv.style.display = 'none'; const h = cv.previousElementSibling as HTMLElement | null; if (h) h.style.display = 'none'; return; }
  const p: Panel = { cv, ctx, w: 0, h: 0, visible: true, draw }; panels.push(p); void aspect;
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { for (const e of es) p.visible = e.isIntersecting; }).observe(cv); // 畫面外的區塊不畫
}
function fit(p: Panel): void {
  const r = p.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), // 畫布解析度上限 2 倍（3 倍螢幕上肉眼差異小、像素量少一半以上）
    w = Math.round(r.width), h = Math.round(r.height);
  if (w !== p.w || h !== p.h || p.cv.width !== Math.round(w * dpr)) { p.w = w; p.h = h; p.cv.width = Math.round(w * dpr); p.cv.height = Math.round(h * dpr); }
  p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const label = (c: CanvasRenderingContext2D, s: string, x: number, y: number, size = 12, col = 'rgba(174,234,255,0.85)', align: CanvasTextAlign = 'center') => { c.font = `600 ${size}px "PingFang TC","Noto Sans TC",system-ui,sans-serif`; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); };

// 盤面：rt-cut 系列的獸身（700×1000 世界座標）縮放到畫布
const BODY_W = { blue: [[40, 430], [660, 430], [680, 980], [20, 980]], red: [[20, 20], [680, 20], [660, 570], [40, 570]] } as Record<ArtSide, P[]>;
const ORG_W: { kind: OrganKind; side: ArtSide; p: P }[] = [
  { kind: 'claw', side: 'blue', p: [100, 520] }, { kind: 'bone', side: 'blue', p: [300, 525] }, { kind: 'claw', side: 'blue', p: [500, 520] }, { kind: 'heart', side: 'blue', p: [240, 790] }, { kind: 'eye', side: 'blue', p: [460, 690] }, { kind: 'poison', side: 'blue', p: [140, 680] }, { kind: 'claw', side: 'blue', p: [560, 840] },
  { kind: 'claw', side: 'red', p: [600, 480] }, { kind: 'poison', side: 'red', p: [400, 475] }, { kind: 'claw', side: 'red', p: [200, 480] }, { kind: 'heart', side: 'red', p: [460, 210] }, { kind: 'bone', side: 'red', p: [350, 340] }, { kind: 'eye', side: 'red', p: [160, 300] }, { kind: 'claw', side: 'red', p: [560, 340] },
];
function sceneTransform(w: number, h: number) { const s = Math.min(w / 700, h / 1000), ox = (w - 700 * s) / 2, oy = (h - 1000 * s) / 2; return { s, f: (p: P): P => [ox + p[0] * s, oy + p[1] * s] }; }

// ---- ① 對戰場景：靜態場景整張預烤＋器官＋特效輪播（每 4.8 秒一輪） ----
panel('scene', 0.65, (c, w, h, t) => {
  const T = sceneTransform(w, h), blue = BODY_W.blue.map(T.f), red = BODY_W.red.map(T.f), R = 26 * T.s * 1.3;
  const org = ORG_W.map((o) => ({ ...o, q: T.f(o.p) }));
  const loop = 4.8, lt = t % loop, base = t - lt;
  const fxs: Fx[] = [
    { type: 'clawShot', t0: base + 0.2, from: org[0].q, to: org[10].q, side: 'blue', dmg: 4 },
    { type: 'critShot', t0: base + 1.0, from: org[2].q, to: org[11].q, side: 'blue', dmg: 8 },
    { type: 'hitFlash', t0: base + 1.3, poly: red, side: 'red' },
    { type: 'heal', t0: base + 1.9, at: org[3].q, amount: 3 },
    { type: 'poison', t0: base + 2.5, at: org[10].q, stacks: 1 + Math.floor((t / loop) % 4) },
    { type: 'clawShot', t0: base + 3.0, from: org[7].q, to: org[1].q, side: 'red', dmg: 4 },
    { type: 'shield', t0: base + 3.2, at: [org[1].q[0], org[1].q[1] + R * 1.9], value: 11, max: 15, absorbed: 4 },
  ];
  let sx = 0, sy = 0; for (const f of fxs) { const o = shakeOffset(f, t); sx += o[0]; sy += o[1]; }
  c.save(); c.translate(sx, sy);
  drawScene(c, { w, h, blue, red }, t);
  const zone = frontlineZone(blue, red); if (zone.length) { const ys = zone.map((p) => p[1]); label(c, '前線區', w - 8, (Math.min(...ys) + Math.max(...ys)) / 2, 11, 'rgba(255,210,122,0.9)', 'right'); }
  org.forEach((o, i) => {
    const st: OrganState = i === 4 ? { mode: 'locked', k: 1 - ((t * 0.2) % 1), label: (5 - ((t * 1) % 5)).toFixed(1) } : i === 13 ? { mode: 'sprout', k: (t * 0.5) % 1 } : { mode: 'normal', lit: i === 0 || i === 2 ? Math.max(0, 1 - ((t - 0.2) % 1.6) * 3) : i === 3 ? Math.max(0, 1 - ((lt - 1.9 + loop) % loop) * 3) : 0 };
    drawOrgan(c, { kind: o.kind, side: o.side, x: o.q[0], y: o.q[1], r: R }, st, t);
  });
  for (const f of fxs) playFx(c, f, t);
  c.restore();
  // 血條（README：上方兩條細血條）
  const bar = (x: number, frac: number, col: string, dir: 1 | -1) => { c.fillStyle = 'rgba(7,13,25,0.8)'; c.fillRect(x, 10, w * 0.42, 6); c.fillStyle = col; c.fillRect(dir > 0 ? x : x + w * 0.42 * (1 - frac), 10, w * 0.42 * frac, 6); };
  bar(8, 0.82, '#5fc4ff', 1); bar(w - 8 - w * 0.42, 0.58 - 0.1 * ((t / loop) % 1), '#e0485c', -1);
});

// ---- ② 器官 × 狀態 ----
const COLS: { name: string; st: (t: number) => OrganState; side: ArtSide }[] = [
  { name: '正常（藍）', side: 'blue', st: () => ({ mode: 'normal' }) },
  { name: '正常（紅）', side: 'red', st: () => ({ mode: 'normal' }) },
  { name: '發動', side: 'blue', st: (t) => ({ mode: 'normal', lit: Math.max(0, 1 - (t % 1.4) * 1.6) }) },
  { name: '鎖定', side: 'blue', st: (t) => ({ mode: 'locked', k: 1 - ((t * 0.25) % 1) }) },
  { name: '萌芽', side: 'blue', st: (t) => ({ mode: 'sprout', k: (t * 0.45) % 1 }) },
  { name: '被切除爆開', side: 'red', st: (t) => ({ mode: 'burst', k: (t * 0.7) % 1, cutAngle: -0.6 }) },
];
panel('organs', 1, (c, w, h, t) => {
  drawBackdrop(c, w, h);
  const top = 30, left = 26, cw = (w - left) / COLS.length, rh = (h - top) / KINDS.length, R = Math.min(cw, rh) * 0.27;
  COLS.forEach((col, j) => label(c, col.name, left + cw * (j + 0.5), 14, 10));
  KINDS.forEach((k, i) => {
    label(c, ZH[k], 13, top + rh * (i + 0.5), 14, 'rgba(240,247,255,0.9)');
    COLS.forEach((col, j) => drawOrgan(c, { kind: k, side: col.side, x: left + cw * (j + 0.5), y: top + rh * (i + 0.5), r: R }, { ...col.st(t), boneHp: k === 'bone' && j === 1 ? 1 : 2 }, t));
  });
});

// ---- ③ 7 種戰鬥特效 ----
const FX_TILES: { name: string; make: (cx: number, cy: number, tw: number, th: number, t0: number) => Fx }[] = [
  { name: '爪痕射擊', make: (cx, cy, tw, th, t0) => ({ type: 'clawShot', t0, from: [cx - tw * 0.35, cy + th * 0.25], to: [cx + tw * 0.3, cy - th * 0.15], side: 'blue', dmg: 4 }) },
  { name: '暴擊（金色爪痕）', make: (cx, cy, tw, th, t0) => ({ type: 'critShot', t0, from: [cx - tw * 0.35, cy + th * 0.25], to: [cx + tw * 0.3, cy - th * 0.1], side: 'blue', dmg: 8 }) },
  { name: '心回血 +HP', make: (cx, cy, _tw, _th, t0) => ({ type: 'heal', t0, at: [cx, cy + 8], amount: 3 }) },
  { name: '毒疊層', make: (cx, cy, _tw, _th, t0) => ({ type: 'poison', t0, at: [cx - 10, cy + 6], stacks: 3 }) },
  { name: '骨護盾條', make: (cx, cy, _tw, _th, t0) => ({ type: 'shield', t0, at: [cx, cy + 4], value: 11, max: 15, absorbed: 4 }) },
  { name: '受擊閃白', make: (cx, cy, tw, th, t0) => ({ type: 'hitFlash', t0, poly: [[cx - tw * 0.35, cy - th * 0.25], [cx + tw * 0.35, cy - th * 0.3], [cx + tw * 0.3, cy + th * 0.28], [cx - tw * 0.32, cy + th * 0.3]], side: 'red' }) },
  { name: '擊倒演出', make: (cx, cy, tw, th, t0) => ({ type: 'ko', t0, w: tw, h: th, winner: 'blue' }) },
];
panel('fx', 1, (c, w, h, t) => {
  drawBackdrop(c, w, h);
  const cols = 2, rows = Math.ceil(FX_TILES.length / cols), tw = w / cols, th = h / rows;
  FX_TILES.forEach((tile, i) => {
    const x0 = (i % cols) * tw, y0 = Math.floor(i / cols) * th, cx = x0 + tw / 2, cy = y0 + th / 2 + 6;
    c.save(); c.beginPath(); c.rect(x0 + 2, y0 + 2, tw - 4, th - 4); c.clip();
    c.strokeStyle = 'rgba(174,234,255,0.18)'; c.strokeRect(x0 + 2.5, y0 + 2.5, tw - 5, th - 5);
    if (tile.name === '受擊閃白') drawBeast(c, [[cx - tw * 0.35, cy - th * 0.25], [cx + tw * 0.35, cy - th * 0.3], [cx + tw * 0.3, cy + th * 0.28], [cx - tw * 0.32, cy + th * 0.3]], 'red', t);
    if (tile.name === '爪痕射擊' || tile.name === '暴擊（金色爪痕）') { drawOrgan(c, { kind: 'claw', side: 'blue', x: cx - tw * 0.35, y: cy + th * 0.25, r: 14 }, { mode: 'normal' }, t); drawOrgan(c, { kind: 'heart', side: 'red', x: cx + tw * 0.3, y: cy - th * 0.15, r: 14 }, { mode: 'normal' }, t); }
    if (tile.name === '心回血 +HP') drawOrgan(c, { kind: 'heart', side: 'blue', x: cx, y: cy + 8, r: 15 }, { mode: 'normal', lit: 0.6 }, t);
    if (tile.name === '毒疊層') drawOrgan(c, { kind: 'claw', side: 'red', x: cx - 10, y: cy + 6, r: 15 }, { mode: 'normal' }, t);
    if (tile.name === '骨護盾條') drawOrgan(c, { kind: 'bone', side: 'blue', x: cx, y: cy + 28, r: 14 }, { mode: 'normal' }, t);
    const fx = tile.make(x0, y0, tw, th, 0), period = fxDuration(fx) + 0.5, t0 = t - (t % period);
    const f2 = tile.make(cx, cy, tw, th, t0);
    if (f2.type === 'ko') { c.translate(x0, y0); playFx(c, { ...f2, w: tw, h: th }, t); c.translate(-x0, -y0); } else playFx(c, f2, t);
    c.restore();
    label(c, tile.name, x0 + 8, y0 + 14, 11, 'rgba(240,247,255,0.9)', 'left');
  });
});

// ---- ④ 前線區特寫：交疊區放大＋說明 ----
panel('front', 0.6, (c, w, h, t) => {
  drawBackdrop(c, w, h);
  const blue: P[] = [[16, h * 0.42], [w - 16, h * 0.42], [w - 6, h + 30], [6, h + 30]], red: P[] = [[6, -30], [w - 6, -30], [w - 16, h * 0.62], [16, h * 0.62]];
  drawBeast(c, red, 'red', t); drawBeast(c, blue, 'blue', t); drawFrontline(c, blue, red, t);
  label(c, '前線區：比兩側亮、邊界流光、雙方纖維交織', w / 2, h * 0.52, 12, 'rgba(255,210,122,0.95)');
  drawOrgan(c, { kind: 'claw', side: 'blue', x: w * 0.3, y: h * 0.55, r: 16 }, { mode: 'normal' }, t);
  drawOrgan(c, { kind: 'claw', side: 'red', x: w * 0.7, y: h * 0.49, r: 16 }, { mode: 'normal' }, t);
});

// ---- 迴圈與 FPS ----
const cost: Record<string, number> = {}; // 各區塊每格繪製毫秒（指數平均；量測用）
const fps = { frames: 0, since: performance.now(), value: 0, samples: [] as number[] };
function frame(now: number): void {
  const t = now / 1000;
  for (const p of panels) { if (!p.visible) continue; const c0 = performance.now(); fit(p); p.draw(p.ctx, p.w, p.h, t); cost[p.cv.id] = (cost[p.cv.id] ?? 0) * 0.9 + (performance.now() - c0) * 0.1; }
  fps.frames++;
  if (now - fps.since >= 1000) { fps.value = (fps.frames * 1000) / (now - fps.since); fps.samples.push(fps.value); if (fps.samples.length > 30) fps.samples.shift(); fps.frames = 0; fps.since = now; (document.getElementById('fps') as HTMLElement).textContent = fps.value.toFixed(0); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __art: unknown }).__art = { fps, cost, panels: panels.length, sha: SHA };
if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('./sw.js', { scope: './' });
