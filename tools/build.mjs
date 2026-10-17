// B 軌建置：esbuild 打包，node:crypto／node:fs 以相容層替換（研究引擎檔案不修改）。
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';

const sha = process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; } })();
const short = sha.slice(0, 7);
const common = {
  bundle: true, alias: { 'node:crypto': './shims/crypto.ts', 'node:fs': './shims/fs.ts' },
  loader: { '.json': 'text' }, define: { 'import.meta.url': '"https://proto-b.invalid/engine/src/content.ts"' }, target: ['es2020', 'safari15'], logLevel: 'warning',
};
mkdirSync('dist', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
await esbuild.build({ ...common, entryPoints: ['tests/browser/golden_entry.ts'], outfile: 'dist-test/golden_browser.js', format: 'iife' });
await esbuild.build({ ...common, entryPoints: ['tests/browser/golden_entry.ts'], outfile: 'dist-test/golden_shim_node.mjs', format: 'esm', platform: 'neutral' });
for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`);
// 版本 SHA 注入：index.html 與 service worker 快取名稱都帶部署 commit，確保更新後不卡舊版。
for (const f of ['index.html', 'sw.js']) writeFileSync(`dist/${f}`, readFileSync(`dist/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short));

// ---- FUN-EXP-01 實驗版（子路徑）：獨立輸出 dist-exp/，manifest／service worker／快取名稱都與根網址版本分開 ----
// 用法：node tools/build.mjs [--sub=fun-exp-01]；部署時 tools/deploy.mjs --sub 只替換 gh-pages 的該子目錄。
const sub = (process.argv.find((a) => a.startsWith('--sub=')) ?? '--sub=fun-exp-01').slice(6);
if (!/^[a-z0-9][a-z0-9-]*$/.test(sub)) throw new Error(`子路徑名稱不合法：${sub}`);
rmSync('dist-exp', { recursive: true, force: true });
mkdirSync('dist-exp', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/exp_main.ts'], outfile: 'dist-exp/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
await esbuild.build({ ...common, entryPoints: ['tests/browser/exp_entry.ts'], outfile: 'dist-test/exp_browser.js', format: 'iife' });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-exp/${f}`);
writeFileSync('dist-exp/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-exp/exp.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-exp/${f}`, readFileSync(`public-exp/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', sub));
}
writeFileSync('dist-exp/.build-info.json', JSON.stringify({ sub, sha: short }) + '\n');
// ---- 串刺研究片段（子路徑 core-skewer/）：獨立輸出 dist-skewer/；manifest／service worker 快取前綴與根網址、fun-exp-01 都分開 ----
// 部署：node tools/deploy.mjs --sub core-skewer（只替換 gh-pages 的 core-skewer/）。上面兩份輸出（dist/、dist-exp/）不受這段影響。
const SKEWER_SUB = 'core-skewer';
rmSync('dist-skewer', { recursive: true, force: true });
mkdirSync('dist-skewer', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/skewer_main.ts'], outfile: 'dist-skewer/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-skewer/${f}`);
writeFileSync('dist-skewer/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-skewer/skewer.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-skewer/${f}`, readFileSync(`public-skewer/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', SKEWER_SUB));
}
writeFileSync('dist-skewer/.build-info.json', JSON.stringify({ sub: SKEWER_SUB, sha: short }) + '\n');
// ---- 一刀雙獸研究片段（子路徑 twin-slash/）：獨立輸出 dist-twin/；快取前綴與其他子路徑都分開 ----
// 部署：node tools/deploy.mjs --sub twin-slash（只替換 gh-pages 的 twin-slash/）。上面三份輸出不受這段影響。
const TWIN_SUB = 'twin-slash';
rmSync('dist-twin', { recursive: true, force: true });
mkdirSync('dist-twin', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/twinslash_main.ts'], outfile: 'dist-twin/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-twin/${f}`);
writeFileSync('dist-twin/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-twinslash/twin.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-twin/${f}`, readFileSync(`public-twinslash/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', TWIN_SUB));
}
writeFileSync('dist-twin/.build-info.json', JSON.stringify({ sub: TWIN_SUB, sha: short }) + '\n');
// ---- 同時下刀研究片段（子路徑 twin-sim/）：獨立輸出 dist-sim/；快取前綴與其他子路徑都分開 ----
// 部署：node tools/deploy.mjs --sub twin-sim（只替換 gh-pages 的 twin-sim/）。上面四份輸出不受這段影響。
const SIM_SUB = 'twin-sim';
rmSync('dist-sim', { recursive: true, force: true });
mkdirSync('dist-sim', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/twinsim_main.ts'], outfile: 'dist-sim/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-sim/${f}`);
writeFileSync('dist-sim/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-twinsim/sim.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-sim/${f}`, readFileSync(`public-twinsim/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', SIM_SUB));
}
writeFileSync('dist-sim/.build-info.json', JSON.stringify({ sub: SIM_SUB, sha: short }) + '\n');
// ---- 即時亂切研究片段（子路徑 rt-cut/）：獨立輸出 dist-rt/；快取前綴與其他子路徑都分開 ----
// 部署：node tools/deploy.mjs --sub rt-cut（只替換 gh-pages 的 rt-cut/）。上面五份輸出不受這段影響。
const RT_SUB = 'rt-cut';
rmSync('dist-rt', { recursive: true, force: true });
mkdirSync('dist-rt', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/rtcut_main.ts'], outfile: 'dist-rt/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-rt/${f}`);
writeFileSync('dist-rt/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-rtcut/rt.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-rt/${f}`, readFileSync(`public-rtcut/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', RT_SUB));
}
writeFileSync('dist-rt/.build-info.json', JSON.stringify({ sub: RT_SUB, sha: short }) + '\n');
// ---- 即時亂切 v2（子路徑 rt-cut2/；擊倒＋再生）：同一份 src/rtcut_main.ts，以 __RT_MODE__="rt2" 建置到 dist-rt2/；快取前綴與其他子路徑都分開 ----
// 部署：node tools/deploy.mjs --sub rt-cut2（只替換 gh-pages 的 rt-cut2/）。上面六份輸出不受這段影響（rt-cut/ 不帶 __RT_MODE__＝原版）。
const RT2_SUB = 'rt-cut2';
rmSync('dist-rt2', { recursive: true, force: true });
mkdirSync('dist-rt2', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/rtcut_main.ts'], outfile: 'dist-rt2/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short), __RT_MODE__: JSON.stringify('rt2') } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-rt2/${f}`);
writeFileSync('dist-rt2/style.css', readFileSync('public/style.css', 'utf8') + readFileSync('public-rtcut2/rt.css', 'utf8'));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-rt2/${f}`, readFileSync(`public-rtcut2/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', RT2_SUB));
}
writeFileSync('dist-rt2/.build-info.json', JSON.stringify({ sub: RT2_SUB, sha: short }) + '\n');
// ---- 幽光美術模組展示（子路徑 art-kit/）：src/art/showcase.ts → dist-art/；快取前綴與其他子路徑都分開 ----
// 部署：node tools/deploy.mjs --sub art-kit（只替換 gh-pages 的 art-kit/）。上面的輸出不受這段影響。
const ART_SUB = 'art-kit';
rmSync('dist-art', { recursive: true, force: true });
mkdirSync('dist-art', { recursive: true });
await esbuild.build({ ...common, entryPoints: ['src/art/showcase.ts'], outfile: 'dist-art/app.js', format: 'iife', minify: true, define: { ...common.define, __BUILD_SHA__: JSON.stringify(short) } });
for (const f of readdirSync('public')) if (f.endsWith('.png')) copyFileSync(`public/${f}`, `dist-art/${f}`);
cpSync('public-artkit/assets', 'dist-art/assets', { recursive: true }); // 暫代／正式素材與縮小的目標圖
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  writeFileSync(`dist-art/${f}`, readFileSync(`public-artkit/${f}`, 'utf8').replaceAll('__BUILD_SHA__', short).replaceAll('__SUB__', ART_SUB));
}
writeFileSync('dist-art/.build-info.json', JSON.stringify({ sub: ART_SUB, sha: short }) + '\n');
console.log(`build ok sha=${short}`);
console.log(`build exp ok sub=${sub} sha=${short}`);
console.log(`build skewer ok sub=${SKEWER_SUB} sha=${short}`);
console.log(`build twin ok sub=${TWIN_SUB} sha=${short}`);
console.log(`build sim ok sub=${SIM_SUB} sha=${short}`);
console.log(`build rt ok sub=${RT_SUB} sha=${short}`);
console.log(`build rt2 ok sub=${RT2_SUB} sha=${short}`);
console.log(`build art ok sub=${ART_SUB} sha=${short}`);
