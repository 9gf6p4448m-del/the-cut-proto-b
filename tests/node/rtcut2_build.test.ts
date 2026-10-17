// 即時亂切 v2 子路徑建置輸出（R2-07 建置部分）：dist-rt2/ 的 manifest／service worker／版本 SHA 獨立；rt-cut 原版建置不帶 v2 模式。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('R2-07 建置：dist-rt2/ 存在，SHA 注入、研究片段字樣、manifest id＝rt-cut2／scope、SW 快取前綴 thecut-rtcut2-；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-rt2', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-rt2/.build-info.json'));
  assert.equal(info.sub, 'rt-cut2');
  const html = rd('dist-rt2/index.html'), sw = rd('dist-rt2/sw.js'), man = JSON.parse(rd('dist-rt2/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段') && html.includes('v2'));
  assert.equal(man.id, 'rt-cut2'); assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-rtcut2-'`) && sw.includes(info.sha));
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'));
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin', 'dist-sim', 'dist-rt']) assert.ok(!rd(`${d}/sw.js`).includes('rtcut2'), `${d}/sw.js`);
  // 模式：rt2 建置定義了 __RT_MODE__（壓縮後常數摺疊、不留識別字）；原版 dist-rt 未定義（保留 typeof __RT_MODE__ 判斷＝RT2 為 false）。瀏覽器另驗 __rt.RT2
  const app2 = rd('dist-rt2/app.js'), app1 = rd('dist-rt/app.js');
  assert.ok(!app2.includes('__RT_MODE__'), 'rt2 建置應已代入模式常數');
  assert.ok(app1.includes('__RT_MODE__'), 'rt-cut 原版建置不得代入 v2 模式');
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-rt2', f)), f);
});

test('R2-07 rt-cut 原版的公開檔不變：public-rtcut/ 對 1685a30 diff 為空', () => {
  assert.equal(execFileSync('git', ['diff', '--name-only', '1685a30', '--', 'public-rtcut'], { cwd: ROOT, encoding: 'utf8' }).trim(), '');
});
