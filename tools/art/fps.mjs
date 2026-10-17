// art-kit FPS 量測（Chromium 無頭模擬，不是 iPhone 實機）：393×852、dpr 3（畫布上限 2）、CPU 節流 N 倍，取最後 5 秒的每秒 FPS 平均；連跑多次。
// 用法：node tools/art/fps.mjs [query=?only=cut] [runs=5] [throttle=4]   （先 npm run build 產生 dist-art/）
import { chromium } from 'playwright';
import { serve } from '../../tests/browser/serve.mjs';

const [q = '?only=cut', runsArg = '5', thrArg = '4'] = process.argv.slice(2);
const { srv, url } = await serve(process.cwd());
const b = await chromium.launch(), out = [];
for (let i = 0; i < Number(runsArg); i++) {
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(thrArg) });
  await p.goto(`${url}/art-kit/${q}`); await p.waitForFunction(() => window.__art && window.__art.ready, null, { timeout: 60000 });
  await p.waitForTimeout(8000);
  const s = await p.evaluate(() => window.__art.fps.samples.slice(-5));
  out.push(s.reduce((a, x) => a + x, 0) / s.length); await ctx.close();
}
await b.close(); srv.close();
const med = [...out].sort((a, b) => a - b)[Math.floor(out.length / 2)];
console.log(`${q} 節流${thrArg}x：${out.map((x) => x.toFixed(1)).join('、')}｜中位數 ${med.toFixed(1)}`);
