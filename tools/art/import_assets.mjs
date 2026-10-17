// 匯入製作人交付的正式素材（the-cut docs/art-direction/ghostlight/cut-battle/assets/），等比縮小供手機載入，保留 RGBA；不修改原檔。
// 用法：node tools/art/import_assets.mjs <assets 資料夾>  → public-artkit/assets/final/{body,claw,heart,eye,poison,bone}.png
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2]; if (!SRC) throw new Error('需要素材資料夾路徑');
const OUT = 'public-artkit/assets/final'; mkdirSync(OUT, { recursive: true });
const JOBS = [['beast_body.png', 'body.png', 768], ['organ_claw.png', 'claw.png', 256], ['organ_heart.png', 'heart.png', 256], ['organ_eye.png', 'eye.png', 256], ['organ_poison.png', 'poison.png', 256], ['organ_bone.png', 'bone.png', 256]];
const b = await chromium.launch(); const p = await b.newPage();
for (const [src, dst, W] of JOBS) {
  const r = await p.evaluate(async ({ u, W }) => {
    const im = new Image(); im.src = u; await im.decode();
    const w = W, h = Math.round((im.height / im.width) * W), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(im, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h).data; let mx = 0, op = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > mx) mx = d[i]; if (d[i] > 127) op++; }
    return { url: cv.toDataURL('image/png'), w, h, src: [im.width, im.height], alphaMax: mx, over50: op / (w * h) };
  }, { u: 'data:image/png;base64,' + readFileSync(join(SRC, src)).toString('base64'), W });
  writeFileSync(join(OUT, dst), Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(`${src} ${r.src.join('×')} → ${dst} ${r.w}×${r.h}，alpha 最大 ${r.alphaMax}，alpha>50% 像素 ${(r.over50 * 100).toFixed(1)}%`);
}
await b.close();
