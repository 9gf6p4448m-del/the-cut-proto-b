// 從目標圖裁出「暫代素材」（正式素材由製作人用 ChatGPT 生成後替換）：怪獸本體（中性銀白、透明背景）＋5 種器官，以及 showcase 用的縮小目標圖。
// 用法：node tools/art/make_placeholders.mjs <the-cut 的 docs/art-direction/ghostlight/cut-battle 路徑>
// 做法：在 Chromium 的 canvas 裡逐像素處理——以亮度去背（暗底→透明），本體與中性器官去飽和成銀白；毒保持綠色。輸出到 public-artkit/assets/。
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('需要目標圖資料夾路徑');
const OUT = 'public-artkit/assets'; mkdirSync(join(OUT, 'placeholder'), { recursive: true }); mkdirSync(join(OUT, 'targets'), { recursive: true });
const img = (f) => 'data:image/png;base64,' + readFileSync(join(SRC, f)).toString('base64');
// 裁切框（目標圖像素座標）。neutral＝去飽和成銀白；lo/hi＝亮度去背門檻（0～1）
// vignette：器官用圓形淡出遮罩，去掉裁切的方形邊（1＝套用）
const JOBS = [
  { name: 'body', file: 'TARGET_stitch.png', box: [18, 128, 728, 1130], neutral: 1, lo: 0.10, hi: 0.42, vignette: 2 }, // 右緣裁掉持毒的手；vignette 2＝四邊淡出（去掉裁切直邊）
  { name: 'claw', file: 'TARGET_stitch.png', box: [56, 1385, 220, 225], neutral: 1, lo: 0.12, hi: 0.45 , vignette: 1 },
  { name: 'eye', file: 'TARGET_stitch.png', box: [322, 1385, 215, 225], neutral: 1, lo: 0.12, hi: 0.45 , vignette: 1 },
  { name: 'poison', file: 'TARGET_stitch.png', box: [588, 1380, 215, 230], neutral: 0, lo: 0.10, hi: 0.40 , vignette: 1 },
  { name: 'heart', file: 'TARGET_battle.png', box: [455, 360, 120, 125], neutral: 1, lo: 0.14, hi: 0.5 , vignette: 1 },
  { name: 'bone', file: 'TARGET_battle.png', box: [470, 1205, 260, 300], neutral: 1, lo: 0.16, hi: 0.5 , vignette: 1 },
];
const b = await chromium.launch(); const p = await b.newPage();
for (const j of JOBS) {
  const url = await p.evaluate(async ({ src, box, neutral, lo, hi, vignette }) => {
    const im = new Image(); im.src = src; await im.decode();
    const [x, y, w, h] = box, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.drawImage(im, x, y, w, h, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const r = a[i] / 255, g = a[i + 1] / 255, bb = a[i + 2] / 255, L = 0.2126 * r + 0.7152 * g + 0.0722 * bb, mx = Math.max(r, g, bb);
      const t = Math.min(1, Math.max(0, (mx - lo) / (hi - lo))), al = t * t * (3 - 2 * t);
      if (neutral) { const v = Math.min(1, 0.25 + 0.95 * mx * 0.6 + L * 0.5); a[i] = v * 238; a[i + 1] = v * 242; a[i + 2] = v * 250; }
      let vg = 1; if (vignette === 2) { const px = (i / 4) % w, py = Math.floor(i / 4 / w), e = Math.min(px, w - px, py, h - py) / (Math.min(w, h) * 0.08); vg = Math.max(0, Math.min(1, e)); } else if (vignette) { const px = (i / 4) % w, py = Math.floor(i / 4 / w), dd = Math.hypot(px - w / 2, py - h / 2) / (Math.min(w, h) / 2); vg = Math.max(0, Math.min(1, (1 - dd) / 0.25)); }
      a[i + 3] = Math.round(al * vg * 255);
    }
    c.putImageData(d, 0, 0); return cv.toDataURL('image/png');
  }, { src: img(j.file), box: j.box, neutral: j.neutral, lo: j.lo, hi: j.hi, vignette: j.vignette });
  writeFileSync(join(OUT, 'placeholder', `${j.name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('placeholder', j.name);
}
for (const f of ['TARGET_cut.png', 'TARGET_battle.png', 'TARGET_stitch.png']) {
  const url = await p.evaluate(async (src) => { const im = new Image(); im.src = src; await im.decode(); const w = 393, h = Math.round((im.height / im.width) * w), cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(im, 0, 0, w, h); return cv.toDataURL('image/jpeg', 0.82); }, img(f));
  writeFileSync(join(OUT, 'targets', f.replace('.png', '.jpg')), Buffer.from(url.split(',')[1], 'base64'));
  console.log('target', f);
}
await b.close();
