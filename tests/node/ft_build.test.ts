// 對決 v0.6 平手＋紀錄子路徑建置輸出（FT-08 建置部分，duel6 步驟 2）：dist-duel6/ 的 manifest／service worker／版本字樣／SHA／儲存 key 前綴獨立，
// 其他輸出（duel5 等）不沾到 duel6 的識別。需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('FT-08 建置：dist-duel6/ 的 manifest id、SW 前綴、版本字樣、build-sha 都是 duel6 自己的，且不含 duel5 的識別', () => {
  assert.ok(existsSync(join(ROOT, 'dist-duel6', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-duel6/.build-info.json'));
  assert.equal(info.sub, 'duel6');
  const html = rd('dist-duel6/index.html'), sw = rd('dist-duel6/sw.js'), man = JSON.parse(rd('dist-duel6/manifest.webmanifest')), app = rd('dist-duel6/app.js');
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__') && !JSON.stringify(man).includes('__SUB__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('<b id="ver">v0.6 平手＋紀錄</b>'), '畫面版本字樣');
  assert.equal(man.id, 'duel6');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`const PREFIX = 'thecut-duel6-'`) && sw.includes(info.sha));
  assert.ok(!sw.includes('thecut-duel5-'), 'SW 前綴不得殘留 duel5');
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  assert.ok(app.includes('serviceWorker.register') && app.includes('./sw.js'), 'app.js 沒有註冊 ./sw.js');
  for (const k of ['duel6-beast', 'duel6-tutorial', 'duel6-input', 'duel6-sound', '__duel6AutoBeast']) assert.ok(app.includes(k), `app.js 缺 ${k}`);
  for (const k of ['duel5-', '__duel5', 'duel-cb-sound']) assert.ok(!app.includes(k), `app.js 殘留 ${k}`);
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-duel6', f)), f);
});

test('FT-08 建置：其他子路徑的輸出不含 duel6 的前綴；duel5 仍是自己的 id／前綴', () => {
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin', 'dist-sim', 'dist-rt', 'dist-rt2', 'dist-duel', 'dist-duel2', 'dist-duel3', 'dist-duel4', 'dist-duel5', 'dist-art']) {
    assert.ok(!rd(`${d}/sw.js`).includes('thecut-duel6-'), `${d}/sw.js`);
  }
  assert.equal(JSON.parse(rd('dist-duel5/manifest.webmanifest')).id, 'duel5');
  assert.ok(rd('dist-duel5/sw.js').includes(`'thecut-duel5-'`));
});
