// 對決 切割→戰鬥子路徑建置輸出（CB-07 建置部分）：dist-duel/ 的 manifest／service worker／版本 SHA 獨立；其他輸出不含 duel。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('CB-07 建置：dist-duel/ 存在，SHA 注入、研究片段字樣、manifest id／scope、SW 快取前綴 thecut-duel- 獨立；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-duel', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-duel/.build-info.json'));
  assert.equal(info.sub, 'duel');
  const html = rd('dist-duel/index.html'), sw = rd('dist-duel/sw.js'), man = JSON.parse(rd('dist-duel/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__') && !JSON.stringify(man).includes('__SUB__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段') && html.includes('v0.1 切割→戰鬥'));
  assert.equal(man.id, 'duel');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-duel-'`) && sw.includes(info.sha));
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin', 'dist-sim', 'dist-rt', 'dist-rt2']) {
    assert.ok(!rd(`${d}/sw.js`).includes('thecut-duel-'), `${d}/sw.js`);
    assert.ok(!rd(`${d}/app.js`).includes('duel-cb-sound'), `${d}/app.js`);
  }
  // 頁面必須真的註冊自己的 service worker（只有 sw.js 檔不夠）
  const app = rd('dist-duel/app.js');
  assert.ok(app.includes('serviceWorker.register') && app.includes('./sw.js'), 'app.js 沒有註冊 ./sw.js');
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-duel', f)), f);
});
