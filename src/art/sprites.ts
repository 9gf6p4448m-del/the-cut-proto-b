// 幽光美術 v2：「生成圖當素材＋程式負責動態」。素材（中性銀白、透明背景）由製作人以 ChatGPT 生成；到之前用目標圖裁出的暫代素材。
// 純繪圖：輸入只有狀態與時間 t（秒），不改輸入、不碰規則。昂貴的染色與預烤都以「素材＋參數」為鍵快取。
// 繪製順序（呼叫端照這個順序呼叫）：drawBackdrop → drawBodySprite（藍、紅）→ drawFrontBand → drawOrganSprite → drawBlade → playFx2 → drawHud
import { PALETTE, drawBackdrop, rand } from './ghostlight.ts';
import { bodyPolygon, placePolygon, tintPixels } from './polygon.ts';
import type { Mask, P } from './polygon.ts';
export { drawBackdrop };
export type Side = 'blue' | 'red';
export type Kind = 'claw' | 'heart' | 'eye' | 'poison' | 'bone';
export type Ctx = CanvasRenderingContext2D;
export const SIDE_HEX: Record<Side, string> = { blue: '#278DD1', red: '#C73548' };
const RGB = { blue: '39,141,209', blueL: '174,234,255', red: '199,53,72', redL: '255,150,160', white: '240,247,255', gold: '255,206,110', poison: '120,235,120', bone: '220,212,196' };
const sideRGB = (s: Side) => (s === 'blue' ? RGB.blue : RGB.red), sideL = (s: Side) => (s === 'blue' ? RGB.blueL : RGB.redL);
const NUM = (px: number) => `italic 300 ${Math.round(px)}px Georgia, "Times New Roman", "Noto Serif TC", serif`;
const TXT = (px: number) => `600 ${Math.round(px)}px "PingFang TC", "Noto Sans TC", system-ui, sans-serif`;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x), easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
function mk(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
const dprOf = (ctx: Ctx) => { const m = ctx.getTransform ? ctx.getTransform() : null; return m && m.a > 0 ? Math.min(3, m.a) : 1; };
function polyPath(c: Ctx, poly: readonly P[]): void { c.beginPath(); poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); }
class Cache<T> { private m = new Map<string, T>(); private max: number; constructor(max: number) { this.max = max; } get(k: string, make: () => T): T { let v = this.m.get(k); if (v === undefined) { v = make(); this.m.set(k, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string); } return v; } }

// ---------------------------------------------------------------- 素材載入
export type Img = HTMLImageElement | HTMLCanvasElement;
const imgCache = new Map<string, Promise<HTMLImageElement>>();
/** 載入紀錄（[DEBUG-artkit]）：每次嘗試的結果，失敗時顯示給使用者／回報用。 */
export const loadLog: { url: string; attempt: number; ok: boolean; ms: number; w?: number; h?: number; online?: boolean; sw?: boolean }[] = [];
const RETRY_DELAYS = [0, 400, 1200]; // 共 3 次；第 2 次起加查詢參數繞過快取（2026-10-18 iOS 4G 單次失敗即整頁空白的修正）
function tryOnce(url: string, attempt: number): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image(), t0 = performance.now(), src = attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}r=${attempt}`;
    const rec = (ok: boolean) => loadLog.push({ url, attempt: attempt + 1, ok, ms: Math.round(performance.now() - t0), w: im.naturalWidth, h: im.naturalHeight, online: typeof navigator !== 'undefined' ? navigator.onLine : undefined, sw: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? !!navigator.serviceWorker.controller : undefined });
    im.onload = () => { if (im.naturalWidth > 0) { rec(true); res(im); } else { rec(false); rej(new Error('naturalWidth=0')); } };
    im.onerror = () => { rec(false); rej(new Error('onerror')); };
    im.src = src;
  });
}
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url);
  if (!p) {
    p = (async () => {
      for (let a = 0; a < RETRY_DELAYS.length; a++) {
        if (RETRY_DELAYS[a]) await new Promise((r) => setTimeout(r, RETRY_DELAYS[a]));
        try { return await tryOnce(url, a); } catch { /* 下一次 */ }
      }
      imgCache.delete(url); // 失敗不快取，重新呼叫會再試
      throw new Error(`素材載入失敗（已試 ${RETRY_DELAYS.length} 次）：${url}`);
    })();
    imgCache.set(url, p);
  }
  return p;
}
export interface Assets { body: HTMLImageElement; organs: Record<Kind, HTMLImageElement> }
/** 從 base 目錄載入本體與 5 種器官（檔名 body.png、claw.png…）。 */
export async function loadAssets(base: string): Promise<Assets> {
  const kinds: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
  const [body, ...os] = await Promise.all([loadImage(`${base}/body.png`), ...kinds.map((k) => loadImage(`${base}/${k}.png`))]);
  return { body, organs: Object.fromEntries(kinds.map((k, i) => [k, os[i]])) as Record<Kind, HTMLImageElement> };
}
const keyOf = (im: Img) => (im instanceof HTMLImageElement ? im.src : `cv${(im as unknown as { __id?: number }).__id ?? 0}`);
function pixels(im: Img): ImageData { const c = mk(im.width, im.height), x = c.getContext('2d')!; x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height); }
/** 素材的 alpha 遮罩（給 bodyPolygon）。 */
export function maskOf(im: Img): Mask { const d = pixels(im), a = new Uint8ClampedArray(d.width * d.height); for (let i = 0; i < a.length; i++) a[i] = d.data[i * 4 + 3]; return { width: d.width, height: d.height, alpha: a }; }
/** 染色後的新畫布（不改原圖；以 素材＋顏色＋亮度 快取）。 */
const tintCache = new Cache<HTMLCanvasElement>(32);
export function tinted(im: Img, hex: string, brightness = 0.85, alphaGain = 1): HTMLCanvasElement {
  return tintCache.get(`${keyOf(im)}|${hex}|${brightness}|${alphaGain}`, () => { const d = pixels(im), c = mk(d.width, d.height), x = c.getContext('2d')!; const out = x.createImageData(d.width, d.height); out.data.set(tintPixels(d.data, hex, brightness, 0.75, alphaGain)); x.putImageData(out, 0, 0); return c; });
}
/** 整個剪影塗成單色（受擊閃白用）。 */
const silCache = new Cache<HTMLCanvasElement>(8);
function silhouette(im: Img, rgb: string): HTMLCanvasElement { return silCache.get(`${keyOf(im)}|${rgb}`, () => { const c = mk(im.width, im.height), x = c.getContext('2d')!; x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, c.width, c.height); return c; }); }

// ---------------------------------------------------------------- 本體
export interface Rect { x: number; y: number; w: number; h: number }
/** 素材在 rect 內等比置中的位置（紅方以 rect 中心旋轉 180°）。與 placePolygon 同一套換算，畫面與判定多邊形對齊。 */
function fitRect(im: Img, r: Rect) { const s = Math.min(r.w / im.width, r.h / im.height); return { s, x: r.x + (r.w - im.width * s) / 2, y: r.y + (r.h - im.height * s) / 2, w: im.width * s, h: im.height * s }; }
function drawFitted(ctx: Ctx, im: Img, r: Rect, side: Side): void {
  const f = fitRect(im, r);
  if (side === 'red') { ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(Math.PI); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); ctx.drawImage(im, f.x, f.y, f.w, f.h); ctx.restore(); }
  else ctx.drawImage(im, f.x, f.y, f.w, f.h);
}
/** 身體多邊形（遊戲世界座標）：由本體素材 alpha 算出、放進 rect；紅方旋轉 180°。結果以素材＋rect 快取。 */
const polyCache = new Cache<P[]>(8);
export function bodyPolyWorld(body: Img, rect: Rect, side: Side, downsample = 4): P[] {
  return polyCache.get(`${keyOf(body)}|${rect.x},${rect.y},${rect.w},${rect.h}|${side}|${downsample}`, () => placePolygon(bodyPolygon(maskOf(body), { downsample }), body.width, body.height, rect, side === 'red'));
}
/** 本體：側色柔光底＋染色素材（brightness、alphaGain 可調）。整張預烤快取（鍵＝素材＋rect＋側＋參數＋dpr），每格只貼一次。 */
const bodyLayerCache = new Cache<{ cv: HTMLCanvasElement; x: number; y: number; w: number; h: number }>(8);
export function drawBodySprite(ctx: Ctx, body: Img, rect: Rect, side: Side, t: number, brightness = 0.8, alphaGain = 1.3): void {
  const dpr = dprOf(ctx), pad = 40;
  const L = bodyLayerCache.get(`${keyOf(body)}|${rect.x},${rect.y},${rect.w},${rect.h}|${side}|${brightness}|${alphaGain}@${dpr}`, () => {
    const f = fitRect(body, rect), x0 = Math.min(rect.x, f.x) - pad, y0 = Math.min(rect.y, f.y) - pad, w = Math.max(rect.w, f.w) + pad * 2, h = Math.max(rect.h, f.h) + pad * 2;
    const cv = mk(w * dpr, h * dpr), c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, g = c.createRadialGradient(cx, cy, 10, cx, cy, Math.max(f.w, f.h) * 0.6);
    g.addColorStop(0, `rgba(${sideRGB(side)},0.16)`); g.addColorStop(1, `rgba(${sideRGB(side)},0)`); c.fillStyle = g; c.fillRect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2);
    drawFitted(c, tinted(body, SIDE_HEX[side], brightness, alphaGain), rect, side);
    return { cv, x: x0, y: y0, w, h };
  });
  ctx.drawImage(L.cv, L.x, L.y, L.w, L.h); void t;
}

// ---------------------------------------------------------------- 前線帶（兩個多邊形的交集；非凸也可：用雙重 clip）
const frontCache = new Cache<{ cv: HTMLCanvasElement; x: number; y: number; w: number; h: number }>(6);
export function drawFrontBand(ctx: Ctx, blue: readonly P[], red: readonly P[], t: number): void {
  if (blue.length < 3 || red.length < 3) return;
  const dpr = dprOf(ctx), xs = [...blue, ...red].map((p) => p[0]), ys = [...blue, ...red].map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const L = frontCache.get(`${blue.map(String).join(';')}|${red.map(String).join(';')}@${dpr}`, () => {
    const cv = mk(w * dpr, h * dpr), c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    c.save(); polyPath(c, blue); c.clip(); polyPath(c, red); c.clip();
    c.filter = 'blur(8px)'; c.fillStyle = 'rgba(240,247,255,0.12)'; c.fillRect(x0 - 20, y0 - 20, w + 40, h + 40); c.filter = 'none'; // 前線帶提亮（柔邊）
    c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; const r = rand(7);
    for (let i = 0; i < 160; i++) { // 雙方纖維交織：藍紅斜向相反
      const bl = i % 2 === 0, px = x0 + r() * w, py = y0 + r() * h, ln = 30 + r() * 70, an = (bl ? -0.5 : 0.5) + (r() - 0.5) * 0.5;
      c.strokeStyle = `rgba(${bl ? RGB.blueL : RGB.redL},${0.10 + r() * 0.18})`; c.lineWidth = 0.6 + r() * 1.4; c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(an) * ln * 0.5 + (r() - 0.5) * 20, py + Math.sin(an) * ln * 0.5, px + Math.cos(an) * ln, py + Math.sin(an) * ln); c.stroke();
    }
    c.restore();
    return { cv, x: x0, y: y0, w, h };
  });
  ctx.drawImage(L.cv, L.x, L.y, L.w, L.h);
  // 邊界流光：藍輪廓在紅身內的那段＋紅輪廓在藍身內的那段，畫成脈動柔光；再加沿邊移動的光點（不用虛線，複雜輪廓上虛線會變成雜亂短線）
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  for (const [edge, inside, rgb] of [[blue, red, RGB.blueL], [red, blue, RGB.redL]] as [readonly P[], readonly P[], string][]) {
    ctx.save(); polyPath(ctx, inside); ctx.clip(); polyPath(ctx, edge);
    ctx.lineWidth = 7; ctx.strokeStyle = `rgba(${rgb},${0.07 + 0.06 * pulse})`; ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${rgb},${0.18 + 0.12 * pulse})`; ctx.stroke();
    // 光點：沿多邊形周長等距、隨時間前進
    const segs: [P, P, number][] = []; let per = 0; for (let i = 0; i < edge.length; i++) { const a = edge[i], b = edge[(i + 1) % edge.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); per += l; }
    for (let k = 0; k < 24; k++) { let d = ((k / 24 + t * 0.03) % 1) * per; for (const [a, b, l] of segs) { if (d <= l) { const q = d / l, x = a[0] + (b[0] - a[0]) * q, y = a[1] + (b[1] - a[1]) * q; ctx.fillStyle = `rgba(${rgb},0.9)`; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); break; } d -= l; } }
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 器官
export interface OrganView { kind: Kind; side: Side; x: number; y: number; r: number }
export interface OrganState { mode: 'normal' | 'locked' | 'sprout' | 'burst'; k?: number; lit?: number; target?: boolean; cutAngle?: number; label?: string }
const glowCache = new Cache<HTMLCanvasElement>(48);
function glow(rgb: string, a: number): HTMLCanvasElement { return glowCache.get(`${rgb}|${a}`, () => { const c = mk(128, 128), x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; }); }
function organImg(im: Img, kind: Kind, side: Side): Img { return kind === 'poison' ? im : tinted(im, SIDE_HEX[side], 1.05); } // 毒保持綠色
/**
 * 器官 sprite：自發光（背後光暈）＋雙層描邊環（側色外環＋白色細內環），跟骨架、纖維明顯分開。
 * target＝被刀線預覽命中（紅色小圈）；lit＝發動。狀態：locked（準星環＋鎖頭）、sprout（長大中）、burst（沿刀線裂開）。
 */
export function drawOrganSprite(ctx: Ctx, im: Img, o: Readonly<OrganView>, st: Readonly<OrganState>, t: number): void {
  const { kind, side, x, y, r } = o, lit = clamp01(st.lit ?? 0), k = clamp01(st.k ?? (st.mode === 'sprout' ? 1 : 0)), src = organImg(im, kind, side);
  ctx.save();
  if (st.mode === 'burst') { burst(ctx, src, o, k, st.cutAngle ?? -0.6); ctx.restore(); return; }
  let scale = 1;
  if (st.mode === 'sprout') { scale = 0.35 + 0.65 * easeOut(k); ctx.globalAlpha = 0.35 + 0.5 * k; }
  const R = r * scale, pulse = kind === 'heart' ? 1 + 0.05 * Math.sin(t * 7.5) : 1;
  const gr = R * (2.1 + 0.5 * lit); ctx.drawImage(glow(kind === 'poison' ? RGB.poison : kind === 'heart' ? (side === 'red' ? '255,90,110' : '120,190,255') : lit ? RGB.white : sideL(side), 0.7 + 0.3 * lit), x - gr, y - gr, gr * 2, gr * 2);
  ctx.strokeStyle = `rgba(${sideRGB(side)},0.9)`; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, R * 1.12, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `rgba(${RGB.white},0.55)`; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, Math.PI * 2); ctx.stroke();
  const S = R * 2.1 * pulse; ctx.drawImage(src, x - S / 2, y - S / 2, S, S);
  if (lit > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = lit * 0.6; ctx.drawImage(src, x - S / 2, y - S / 2, S, S); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  if (st.mode === 'sprout') { ctx.globalAlpha = 1; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 20; ctx.strokeStyle = `rgba(${sideL(side)},0.9)`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.font = TXT(10); ctx.fillStyle = `rgba(${sideL(side)},0.95)`; ctx.textAlign = 'center'; ctx.fillText('萌芽', x, y + r * 1.2 + 11); }
  if (st.mode === 'locked') lockReticle(ctx, x, y, r, k, t, side, st.label);
  if (st.target) { ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
/** 鎖定（照 TARGET_cut）：準星環＋四向刻度＋中央鎖頭；外圈弧＝剩餘時間。 */
function lockReticle(ctx: Ctx, x: number, y: number, r: number, k: number, t: number, side: Side, label?: string): void {
  const R = r * 1.55, lt = sideL(side);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(${lt},0.85)`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + t * 0.4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (R - 6), y + Math.sin(a) * (R - 6)); ctx.lineTo(x + Math.cos(a) * (R + 7), y + Math.sin(a) * (R + 7)); ctx.stroke(); }
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(240,247,255,0.95)'; ctx.beginPath(); ctx.arc(x, y, R + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  // 鎖頭
  const s = r * 0.32; ctx.fillStyle = 'rgba(7,13,25,0.75)'; ctx.beginPath(); ctx.arc(x, y + s * 0.6, s * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#F0F7FF'; ctx.lineWidth = s * 0.45; ctx.beginPath(); ctx.arc(x, y + s * 0.1, s * 0.75, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#F0F7FF'; ctx.fillRect(x - s * 1.05, y + s * 0.1, s * 2.1, s * 1.5);
  if (label) { ctx.font = NUM(13); ctx.fillStyle = `rgb(${lt})`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, x, y - R - 8); }
  ctx.restore();
}
function burst(ctx: Ctx, src: Img, o: Readonly<OrganView>, k: number, ang: number): void {
  const { x, y, r, side, kind } = o, e = easeOut(k), nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2), S = r * 2.1, a = 1 - k;
  for (const sg of [-1, 1]) {
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x + nx * sg * e * r * 1.5, y + ny * sg * e * r * 1.5 + e * e * r); ctx.rotate(sg * e * 0.7);
    const L = r * 3; ctx.beginPath(); ctx.moveTo(-Math.cos(ang) * L, -Math.sin(ang) * L); ctx.lineTo(Math.cos(ang) * L, Math.sin(ang) * L); ctx.lineTo(Math.cos(ang) * L + nx * sg * L, Math.sin(ang) * L + ny * sg * L); ctx.lineTo(-Math.cos(ang) * L + nx * sg * L, -Math.sin(ang) * L + ny * sg * L); ctx.closePath(); ctx.clip();
    ctx.drawImage(src, -S / 2, -S / 2, S, S);
    ctx.strokeStyle = 'rgba(255,230,235,0.9)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-Math.cos(ang) * r, -Math.sin(ang) * r); ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const R = r * (0.7 + 2.4 * e); ctx.drawImage(glow(RGB.white, 0.85 * a), x - R, y - R, R * 2, R * 2);
  const rr = rand(Math.round(x * 7 + y)), col = kind === 'poison' ? RGB.poison : side === 'red' ? RGB.red : RGB.blueL;
  for (let i = 0; i < 18; i++) { const an = rr() * Math.PI * 2, d = r * (0.4 + (1.2 + rr()) * e * 1.7); ctx.fillStyle = `rgba(${i % 3 ? col : RGB.white},${a * (0.4 + rr() * 0.6)})`; ctx.beginPath(); ctx.arc(x + Math.cos(an) * d, y + Math.sin(an) * d + e * e * r, 1 + rr() * 2.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- 刀線（照 TARGET_cut：亮白細線、前段虛線預覽、命中器官紅色小圈、起點指環）
export function drawBlade(ctx: Ctx, a: P, b: P, hits: readonly P[], t: number, preview = true): void {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, cut = preview ? 0.55 : 1, m: P = [a[0] + (b[0] - a[0]) * cut, a[1] + (b[1] - a[1]) * cut];
  ctx.strokeStyle = 'rgba(120,190,255,0.25)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(m[0], m[1]); ctx.stroke();
  ctx.strokeStyle = '#F0F7FF'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(m[0], m[1]); ctx.stroke();
  if (preview) { ctx.setLineDash([7, 7]); ctx.lineDashOffset = -t * 30; ctx.strokeStyle = 'rgba(240,247,255,0.85)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
  ctx.globalCompositeOperation = 'source-over';
  for (const h of hits) { ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h[0], h[1], 7, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(255,77,94,0.25)'; ctx.fill(); }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) { const q = ((t * 1.2 + i / 3) % 1); ctx.strokeStyle = `rgba(174,234,255,${0.8 * (1 - q)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(a[0], a[1], 6 + q * 16, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore(); void L;
}

// ---------------------------------------------------------------- 戰鬥特效 v2（照 TARGET_battle）
export type Fx2 =
  | { type: 'arcSlash'; t0: number; from: P; to: P; side: Side; dmg?: number }
  | { type: 'critArc'; t0: number; from: P; to: P; dmg?: number }
  | { type: 'heal'; t0: number; at: P; amount: number }
  | { type: 'poison'; t0: number; at: P; stacks: number }
  | { type: 'boneShield'; t0: number; at: P; facing: number; absorbed?: number; value?: number }
  | { type: 'hitFlash'; t0: number; body: Img; rect: Rect; side: Side }
  | { type: 'ko'; t0: number; w: number; h: number; winner: Side | 'draw' };
const DUR2: Record<Fx2['type'], number> = { arcSlash: 0.6, critArc: 0.9, heal: 1.1, poison: 1.2, boneShield: 1.0, hitFlash: 0.3, ko: 2.6 };
export const fx2Duration = (f: Readonly<Fx2>) => DUR2[f.type];
export function shake2(f: Readonly<Fx2>, t: number): P { const u = t - f.t0; if (u < 0 || (f.type !== 'hitFlash' && f.type !== 'critArc')) return [0, 0]; const d = f.type === 'critArc' ? 0.3 : 0.2; if (u > d) return [0, 0]; const a = (f.type === 'critArc' ? 7 : 4) * (1 - u / d); return [Math.sin(u * 90) * a, Math.cos(u * 77) * a]; }
/** 弧形斬擊：沿圓弧分段描線，寬度兩端尖、中間最寬（sin 輪廓）；先畫寬而淡的發光層，再畫亮核心。 */
function crescent(ctx: Ctx, cx: number, cy: number, R: number, a0: number, a1: number, thick: number, rgbIn: string, rgbOut: string, alpha: number): void {
  const N = 28; ctx.lineCap = 'round';
  for (const [mul, rgb, al] of [[2.6, rgbOut, 0.18], [1.4, rgbOut, 0.45], [0.55, rgbIn, 0.95]] as [number, string, number][]) {
    ctx.strokeStyle = `rgba(${rgb},${al * alpha})`;
    for (let i = 0; i < N; i++) { const u0 = i / N, u1 = (i + 1) / N, w = Math.sin(Math.PI * (u0 + u1) / 2) * thick * mul; if (w < 0.3) continue; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(cx, cy, R, a0 + (a1 - a0) * u0, a0 + (a1 - a0) * u1); ctx.stroke(); }
  }
}
function sparks(ctx: Ctx, at: P, k: number, rgb: string, n: number, spread: number, seed: number): void {
  const r = rand(seed); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) { const an = r() * Math.PI * 2, sp = spread * (0.4 + r()), d0 = sp * easeOut(k) * 0.6, d1 = d0 + 4 + r() * 10; ctx.strokeStyle = `rgba(${i % 4 ? rgb : RGB.white},${(1 - k) * (0.5 + r() * 0.5)})`; ctx.lineWidth = 1 + r() * 1.4; ctx.beginPath(); ctx.moveTo(at[0] + Math.cos(an) * d0, at[1] + Math.sin(an) * d0 + k * k * 20); ctx.lineTo(at[0] + Math.cos(an) * d1, at[1] + Math.sin(an) * d1 + k * k * 20); ctx.stroke(); }
  ctx.restore();
}
function numText(ctx: Ctx, s: string, at: P, k: number, color: string, px: number, glowRgb?: string): void {
  const a = k < 0.12 ? k / 0.12 : k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1, sc = 1 + 0.4 * Math.max(0, 1 - k / 0.12);
  ctx.save(); ctx.globalAlpha = clamp01(a); ctx.translate(at[0], at[1] - 24 * easeOut(k)); ctx.scale(sc, sc); ctx.font = NUM(px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glowRgb) { ctx.shadowColor = `rgb(${glowRgb})`; ctx.shadowBlur = 14; } ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,13,25,0.8)'; ctx.strokeText(s, 0, 0); ctx.fillStyle = color; ctx.fillText(s, 0, 0);
  ctx.restore();
}
export function playFx2(ctx: Ctx, f: Readonly<Fx2>, t: number): boolean {
  const u = t - f.t0, D = DUR2[f.type]; if (u < 0) return true; if (u > D) return false;
  const k = u / D; ctx.save();
  switch (f.type) {
    case 'arcSlash': case 'critArc': {
      const crit = f.type === 'critArc', dx = f.to[0] - f.from[0], dy = f.to[1] - f.from[1], L = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
      const sweep = easeOut(Math.min(1, k / 0.4)), fade = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6, R = L * 0.75;
      ctx.globalCompositeOperation = 'lighter';
      const n = crit ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 26, cx = f.to[0] - Math.cos(ang) * R * 0.2 + Math.cos(ang + Math.PI / 2) * o - Math.cos(ang) * R, cy = f.to[1] - Math.sin(ang) * R * 0.2 + Math.sin(ang + Math.PI / 2) * o - Math.sin(ang) * R;
        const a0 = ang - 0.55, a1 = a0 + 1.1 * sweep;
        crescent(ctx, cx, cy, R, a0, a1, crit ? 9 : 5, crit ? '255,240,200' : RGB.white, crit ? RGB.gold : f.type === 'arcSlash' ? sideL(f.side) : RGB.gold, fade);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (k > 0.3) { const q = (k - 0.3) / 0.7; sparks(ctx, f.to, q, crit ? RGB.gold : f.type === 'arcSlash' ? sideL(f.side) : RGB.gold, crit ? 26 : 12, crit ? 60 : 34, Math.round(f.to[0] + f.to[1]));
        if (crit) numText(ctx, '暴擊', [f.to[0], f.to[1] - 30], q, '#FFD27A', 18, RGB.gold);
        if (f.dmg !== undefined) numText(ctx, `−${f.dmg}`, [f.to[0] - 34, f.to[1]], q, crit ? '#FFD27A' : f.type === 'arcSlash' && f.side === 'blue' ? '#ff9aa6' : '#cfe8ff', crit ? 34 : 26); }
      break;
    }
    case 'heal': {
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,140,160,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(f.at[0], f.at[1], 18 + 26 * easeOut(k), 8 + 10 * easeOut(k), -0.2, 0, Math.PI * 2); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
      numText(ctx, `+${f.amount}`, [f.at[0] + 10, f.at[1] - 6], k, '#FFE3E8', 30, '255,120,150');
      break;
    }
    case 'poison': {
      const r = rand(Math.round(f.at[0] * 3 + f.at[1]));
      for (let i = 0; i < 12; i++) { const ph = clamp01(k * 1.3 - r() * 0.3), bx = f.at[0] + (r() - 0.5) * 44, by = f.at[1] + 10 - ph * 40; ctx.fillStyle = `rgba(${RGB.poison},${Math.sin(ph * Math.PI) * 0.35})`; ctx.strokeStyle = `rgba(190,255,180,${Math.sin(ph * Math.PI) * 0.9})`; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(bx, by, 2 + r() * 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      // 毒滴＋×N（照目標圖）
      const dx = f.at[0] + 18, dy = f.at[1] + 16; ctx.fillStyle = '#7CF07A'; ctx.beginPath(); ctx.moveTo(dx, dy - 9); ctx.quadraticCurveTo(dx + 6, dy, dx, dy + 5); ctx.quadraticCurveTo(dx - 6, dy, dx, dy - 9); ctx.fill();
      numText(ctx, `×${f.stacks}`, [dx + 22, dy + 2], Math.min(k, 0.5), '#B8FF9E', 24, RGB.poison);
      break;
    }
    case 'boneShield': {
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1, R = 70, cx = f.at[0] - Math.cos(f.facing) * R * 0.6, cy = f.at[1] - Math.sin(f.facing) * R * 0.6;
      ctx.globalCompositeOperation = 'lighter';
      crescent(ctx, cx, cy, R, f.facing - 0.9, f.facing + 0.9, 8, '230,245,255', '140,200,255', 0.8 * a);
      ctx.strokeStyle = `rgba(240,247,255,${0.7 * a})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, f.facing - 0.9, f.facing + 0.9); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      const hit: P = [cx + Math.cos(f.facing - 0.3) * R, cy + Math.sin(f.facing - 0.3) * R];
      if (f.absorbed !== undefined) { sparks(ctx, hit, clamp01(k / 0.6), '255,120,100', 22, 48, 5); numText(ctx, `−${f.absorbed}`, [hit[0] + 34, hit[1] + 8], k, '#E8EEF8', 26); }
      if (f.value !== undefined) { ctx.globalAlpha = a; ctx.font = NUM(13); ctx.fillStyle = '#E8E0D0'; ctx.textAlign = 'center'; ctx.fillText(`盾 ${f.value}`, cx + Math.cos(f.facing) * (R + 18), cy + Math.sin(f.facing) * (R + 18)); }
      break;
    }
    case 'hitFlash': {
      const a = (1 - k) ** 2; ctx.globalAlpha = 0.75 * a; ctx.globalCompositeOperation = 'lighter';
      drawFitted(ctx, silhouette(f.body, RGB.white), f.rect, f.side);
      break;
    }
    case 'ko': {
      const { w, h } = f, z = 1 + 0.8 * Math.max(0, 1 - k * 5), col = f.winner === 'blue' ? '#AEEAFF' : f.winner === 'red' ? '#ff9aa6' : '#E8E0D0';
      ctx.fillStyle = `rgba(3,6,12,${0.6 * clamp01(k * 4)})`; ctx.fillRect(0, 0, w, h);
      sparks(ctx, [w / 2, h / 2], clamp01(k * 1.5), RGB.gold, 40, Math.min(w, h) * 0.45, 9);
      ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.round(Math.min(w, h) * 0.22)}px "PingFang TC","Noto Serif TC",serif`; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(7,13,25,0.9)'; ctx.strokeText('擊倒', 0, 0); ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.fillStyle = col; ctx.fillText('擊倒', 0, 0); ctx.shadowBlur = 0;
      ctx.font = TXT(Math.min(w, h) * 0.05); ctx.fillStyle = PALETTE.white; ctx.fillText(f.winner === 'draw' ? '雙方同時倒下' : f.winner === 'blue' ? '你贏了' : '你輸了', 0, Math.min(w, h) * 0.15);
      break;
    }
  }
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------- 介面（照目標圖：頂端倒數＋雙色細血條、×2 加時、血量數字細襯線斜體）
export interface Hud { w: number; timer?: string; banner?: string; hp?: { blue: number; red: number; max: number } }
export function drawHud(ctx: Ctx, h: Readonly<Hud>): void {
  const w = h.w; ctx.save();
  if (h.hp) {
    const bar = (x: number, y: number, bw: number, frac: number, rgb: string, rgbL: string) => {
      ctx.fillStyle = 'rgba(7,13,25,0.85)'; ctx.fillRect(x - 2, y - 2, bw + 4, 9); ctx.strokeStyle = `rgba(${rgbL},0.5)`; ctx.lineWidth = 1; ctx.strokeRect(x - 2.5, y - 2.5, bw + 5, 10);
      const g = ctx.createLinearGradient(x, 0, x + bw, 0); g.addColorStop(0, `rgb(${rgb})`); g.addColorStop(1, `rgb(${rgbL})`); ctx.fillStyle = g; ctx.fillRect(x, y, bw * clamp01(frac), 5);
    };
    bar(14, 34, w * 0.36, h.hp.blue / h.hp.max, RGB.blue, RGB.blueL); bar(w - 14 - w * 0.36, 34, w * 0.36, h.hp.red / h.hp.max, RGB.red, RGB.redL);
    ctx.font = NUM(13); ctx.textBaseline = 'middle'; ctx.fillStyle = '#AEEAFF'; ctx.textAlign = 'left'; ctx.fillText(`${h.hp.blue}/${h.hp.max}`, 14, 52); ctx.fillStyle = '#ffb0b8'; ctx.textAlign = 'right'; ctx.fillText(`${h.hp.red}/${h.hp.max}`, w - 14, 52);
  }
  if (h.timer) { ctx.font = NUM(26); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#E8F4FF'; ctx.fillText(h.timer, w / 2, 37); }
  if (h.banner) { ctx.font = NUM(20); ctx.textAlign = 'center'; ctx.fillStyle = '#E8F4FF'; ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 10; ctx.fillText(h.banner, w / 2, 66); }
  ctx.restore();
}

// ---------------------------------------------------------------- 縫合擺放（照 TARGET_stitch：發光插槽、紅色不可放、縫線、器官卡）
export function drawSlot(ctx: Ctx, x: number, y: number, r: number, mode: 'ok' | 'bad' | 'hover', t: number): void {
  const rgb = mode === 'bad' ? '255,70,80' : '120,200,255', p = 0.6 + 0.4 * Math.sin(t * 3 + x);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(glow(rgb, 0.4 * p), x - r * 2, y - r * 2, r * 4, r * 4);
  ctx.strokeStyle = `rgba(${rgb},${0.9})`; ctx.lineWidth = mode === 'hover' ? 3 : 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb},0.45)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.stroke();
  if (mode === 'bad') { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(255,90,100,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - r * 0.45, y - r * 0.45); ctx.lineTo(x + r * 0.45, y + r * 0.45); ctx.moveTo(x + r * 0.45, y - r * 0.45); ctx.lineTo(x - r * 0.45, y + r * 0.45); ctx.stroke(); }
  ctx.restore();
}
export function drawSuture(ctx: Ctx, a: P, b: P, t: number): void {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 24;
  for (const [w, al] of [[6, 0.15], [2, 0.8]] as [number, number][]) { ctx.strokeStyle = `rgba(160,255,200,${al})`; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(mx, my, b[0], b[1]); ctx.stroke(); }
  for (let i = 0; i < 6; i++) { const q = (t * 0.8 + i / 6) % 1, u = 1 - q, x = u * u * a[0] + 2 * u * q * mx + q * q * b[0], y = u * u * a[1] + 2 * u * q * my + q * q * b[1]; ctx.fillStyle = 'rgba(220,255,230,0.9)'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
export function drawCard(ctx: Ctx, r: Rect, im: Img, kind: Kind, label: string, selected: boolean, t: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(10,18,34,0.92)'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = selected ? `rgba(120,200,255,${0.8 + 0.2 * Math.sin(t * 4)})` : 'rgba(174,234,255,0.35)'; ctx.lineWidth = selected ? 2.2 : 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  if (selected) { ctx.shadowColor = '#5fb4ff'; ctx.shadowBlur = 16; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); ctx.shadowBlur = 0; }
  const s = Math.min(r.w, r.h * 0.72) * 0.85, src = organImg(im, kind, 'blue'); ctx.drawImage(src, r.x + (r.w - s) / 2, r.y + 6, s, s);
  ctx.font = TXT(14); ctx.fillStyle = '#E8F4FF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h - 14);
  ctx.restore();
}

// ---------------------------------------------------------------- 整個對戰場景（效能用：背景＋兩獸本體＋前線帶靜態部分預烤成一張，每格只貼一次）
export interface DuelSceneView { w: number; h: number; body: Img; rects: Record<Side, Rect>; brightness?: number; alphaGain?: number }
const sceneCache = new Cache<{ cv: HTMLCanvasElement; blue: P[]; red: P[] }>(4);
/** 建議遊戲用這個：靜態部分快取（鍵＝尺寸＋素材＋rect＋dpr），動態只畫前線邊界上的流動光點。 */
export function drawDuelScene(ctx: Ctx, s: Readonly<DuelSceneView>, t: number): void {
  const dpr = dprOf(ctx), br = s.brightness ?? 0.8, ag = s.alphaGain ?? 1.3, R = s.rects;
  const sc = sceneCache.get(`${s.w}x${s.h}|${keyOf(s.body)}|${JSON.stringify(R)}|${br}|${ag}@${dpr}`, () => {
    const cv = mk(s.w * dpr, s.h * dpr), c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(c, s.w, s.h);
    for (const side of ['red', 'blue'] as Side[]) { const f = fitRect(s.body, R[side]), cx = R[side].x + R[side].w / 2, cy = R[side].y + R[side].h / 2, g = c.createRadialGradient(cx, cy, 10, cx, cy, Math.max(f.w, f.h) * 0.6); g.addColorStop(0, `rgba(${sideRGB(side)},0.16)`); g.addColorStop(1, `rgba(${sideRGB(side)},0)`); c.fillStyle = g; c.fillRect(f.x - 40, f.y - 40, f.w + 80, f.h + 80); drawFitted(c, tinted(s.body, SIDE_HEX[side], br, ag), R[side], side); }
    const blue = bodyPolyWorld(s.body, R.blue, 'blue'), red = bodyPolyWorld(s.body, R.red, 'red');
    drawFrontBandStatic(c, blue, red);
    return { cv, blue, red };
  });
  ctx.drawImage(sc.cv, 0, 0, s.w, s.h);
  drawFrontGlints(ctx, sc.blue, sc.red, t);
}
/** 前線帶靜態部分（提亮、纖維交織、邊界柔光）——畫進預烤層。 */
function drawFrontBandStatic(c: Ctx, blue: readonly P[], red: readonly P[]): void {
  if (blue.length < 3 || red.length < 3) return;
  const xs = [...blue, ...red].map((p) => p[0]), ys = [...blue, ...red].map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  c.save(); polyPath(c, blue); c.clip(); polyPath(c, red); c.clip();
  c.filter = 'blur(8px)'; c.fillStyle = 'rgba(240,247,255,0.12)'; c.fillRect(x0 - 20, y0 - 20, w + 40, h + 40); c.filter = 'none';
  c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; const r = rand(7);
  for (let i = 0; i < 160; i++) { const bl = i % 2 === 0, px = x0 + r() * w, py = y0 + r() * h, ln = 30 + r() * 70, an = (bl ? -0.5 : 0.5) + (r() - 0.5) * 0.5; c.strokeStyle = `rgba(${bl ? RGB.blueL : RGB.redL},${0.10 + r() * 0.18})`; c.lineWidth = 0.6 + r() * 1.4; c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(an) * ln * 0.5 + (r() - 0.5) * 20, py + Math.sin(an) * ln * 0.5, px + Math.cos(an) * ln, py + Math.sin(an) * ln); c.stroke(); }
  c.restore();
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round';
  for (const [edge, inside, rgb] of [[blue, red, RGB.blueL], [red, blue, RGB.redL]] as [readonly P[], readonly P[], string][]) { c.save(); polyPath(c, inside); c.clip(); polyPath(c, edge); c.lineWidth = 7; c.strokeStyle = `rgba(${rgb},0.10)`; c.stroke(); c.lineWidth = 1.2; c.strokeStyle = `rgba(${rgb},0.25)`; c.stroke(); c.restore(); }
  c.restore();
}
function pointIn(p: P, poly: readonly P[]): boolean { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; }
/** 前線邊界上的流動光點（只畫落在對方身體內的那段邊界；不需 clip）。 */
function drawFrontGlints(ctx: Ctx, blue: readonly P[], red: readonly P[], t: number): void {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [edge, inside, rgb] of [[blue, red, RGB.blueL], [red, blue, RGB.redL]] as [readonly P[], readonly P[], string][]) {
    let per = 0; const segs: [P, P, number][] = []; for (let i = 0; i < edge.length; i++) { const a = edge[i], b = edge[(i + 1) % edge.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); per += l; }
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    for (let k = 0; k < 40; k++) { let d = ((k / 40 + t * 0.03) % 1) * per; for (const [a, b, l] of segs) { if (d <= l) { const q = d / l, p: P = [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]; if (pointIn(p, inside)) { ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, Math.PI * 2); ctx.fill(); } break; } d -= l; } }
  }
  ctx.restore();
}
