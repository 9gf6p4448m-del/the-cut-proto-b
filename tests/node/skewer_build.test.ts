// 串刺子路徑建置輸出（K-10 準備、K-9）：dist-skewer/ 的 manifest／service worker／版本 SHA 獨立；根網址與 fun-exp-01 的輸出不含串刺。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('串刺建置：dist-skewer/ 存在，SHA 注入、研究片段字樣、manifest id／scope、SW 快取前綴獨立', () => {
  assert.ok(existsSync(join(ROOT, 'dist-skewer', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-skewer/.build-info.json'));
  assert.equal(info.sub, 'core-skewer');
  const html = rd('dist-skewer/index.html'), sw = rd('dist-skewer/sw.js'), man = JSON.parse(rd('dist-skewer/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段'));
  assert.equal(man.id, 'core-skewer');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-coreskewer-'`) && sw.includes(info.sha));
  assert.ok(!rd('dist-exp/sw.js').includes('coreskewer') && !rd('dist/sw.js').includes('coreskewer'));
  assert.ok(!rd('dist/app.js').includes('core-skewer') && !rd('dist-exp/app.js').includes('串刺'));
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-skewer', f)), f);
});
