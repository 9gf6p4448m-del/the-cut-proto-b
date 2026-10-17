// 一刀雙獸子路徑建置輸出（TS-14 準備）：dist-twin/ 的 manifest／service worker／版本 SHA 獨立；其他三份輸出不含一刀雙獸。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('一刀雙獸建置：dist-twin/ 存在，SHA 注入、研究片段字樣、manifest id／scope、SW 快取前綴獨立；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-twin', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-twin/.build-info.json'));
  assert.equal(info.sub, 'twin-slash');
  const html = rd('dist-twin/index.html'), sw = rd('dist-twin/sw.js'), man = JSON.parse(rd('dist-twin/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段'));
  assert.equal(man.id, 'twin-slash');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-twinslash-'`) && sw.includes(info.sha));
  for (const d of ['dist', 'dist-exp', 'dist-skewer']) {
    assert.ok(!rd(`${d}/sw.js`).includes('twinslash'), `${d}/sw.js`);
    assert.ok(!rd(`${d}/app.js`).includes('thecut-twinslash-log'), `${d}/app.js`);
  }
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-twin', f)), f);
});
