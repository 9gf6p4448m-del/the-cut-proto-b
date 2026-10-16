// B 軌建置：esbuild 打包，node:crypto／node:fs 以相容層替換（研究引擎檔案不修改）。
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

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
console.log(`build ok sha=${short}`);
