// 由本體素材 alpha 算出「玩法邊界候選」，輸出 beast_boundary.candidate.json（素材正規化座標）。遊戲不直接讀候選；確認後另存 beast_boundary.json。
// 用法：node tools/art/beast_boundary.mjs <本體 PNG> <輸出 JSON> [downsample=4]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { bodyPolygon, downsampleMask, maskArea, outerRingArea, polygonArea } from '../../src/art/polygon.ts';

const [src, out, dsArg] = process.argv.slice(2);
if (!src || !out) throw new Error('用法：node tools/art/beast_boundary.mjs <本體 PNG> <輸出 JSON> [downsample]');
const ds = Number(dsArg ?? 4), thr = 127, maxVerts = 64;
const b = await chromium.launch(); const p = await b.newPage();
const r = await p.evaluate(async (u) => { const im = new Image(); im.src = u; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const c = cv.getContext('2d'); c.drawImage(im, 0, 0); const d = c.getImageData(0, 0, im.width, im.height).data; const a = new Array(im.width * im.height); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]; return { w: im.width, h: im.height, a }; }, 'data:image/png;base64,' + readFileSync(src).toString('base64'));
await b.close();
const m = { width: r.w, height: r.h, alpha: Uint8ClampedArray.from(r.a) };
const poly = bodyPolygon(m, { thr, downsample: ds, maxVerts }), pa = polygonArea(poly), filled = outerRingArea(downsampleMask(m, ds), thr) * ds * ds, porous = maskArea(m, thr);
const cand = {
  version: 1, kind: 'candidate', source: { asset: basename(src), width: r.w, height: r.h }, params: { thr, downsample: ds, maxVerts },
  vertices: poly.map(([x, y]) => [Math.round((x / r.w) * 1e5) / 1e5, Math.round((y / r.h) * 1e5) / 1e5]),
  stats: { verts: poly.length, simplifyErrPct: Math.round((pa / filled - 1) * 1e4) / 100, vsPorousAlphaPct: Math.round((pa / porous - 1) * 1e4) / 100 },
};
writeFileSync(out, JSON.stringify(cand, null, 1) + '\n');
console.log(`寫出 ${out}：頂點 ${cand.stats.verts}、簡化誤差 ${cand.stats.simplifyErrPct}%、對含鏤空 alpha ${cand.stats.vsPorousAlphaPct}%（參考）`);
