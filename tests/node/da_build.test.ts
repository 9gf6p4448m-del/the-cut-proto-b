// 對決 v0.2 美術合併子路徑建置輸出（DA-07 建置部分）：dist-duel2/ 的 manifest／service worker／版本 SHA 獨立；其他輸出不含 duel2；素材與已確認邊界都在輸出內。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('DA-07 建置：dist-duel2/ 存在，SHA 注入、研究片段字樣、manifest id／scope、SW 快取前綴 thecut-duel2- 獨立；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-duel2', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-duel2/.build-info.json'));
  assert.equal(info.sub, 'duel2');
  const html = rd('dist-duel2/index.html'), sw = rd('dist-duel2/sw.js'), man = JSON.parse(rd('dist-duel2/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__') && !JSON.stringify(man).includes('__SUB__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段') && html.includes('v0.2 美術合併'));
  assert.equal(man.id, 'duel2');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-duel2-'`) && sw.includes(info.sha));
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin', 'dist-sim', 'dist-rt', 'dist-rt2', 'dist-duel', 'dist-art']) {
    assert.ok(!rd(`${d}/sw.js`).includes('thecut-duel2-'), `${d}/sw.js`);
    assert.ok(!rd(`${d}/index.html`).includes('v0.2 美術合併'), `${d}/index.html`);
  }
  // 頁面必須真的註冊自己的 service worker（只有 sw.js 檔不夠）
  const app = rd('dist-duel2/app.js');
  assert.ok(app.includes('serviceWorker.register') && app.includes('./sw.js'), 'app.js 沒有註冊 ./sw.js');
  for (const f of ['assets/final/body.png', 'assets/final/claw.png', 'assets/final/heart.png', 'assets/final/eye.png', 'assets/final/poison.png', 'assets/final/bone.png', 'assets/beast_boundary.json']) assert.ok(existsSync(join(ROOT, 'dist-duel2', f)), f);
  assert.deepEqual(JSON.parse(rd('dist-duel2/assets/beast_boundary.json')), JSON.parse(rd('public-duel2/assets/beast_boundary.json')));
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-duel2', f)), f);
});
