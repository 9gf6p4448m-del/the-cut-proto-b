// 同時下刀子路徑建置輸出（TSIM-14 建置部分、TSIM-10 字眼部分）：dist-sim/ 的 manifest／service worker／版本 SHA 獨立；其他輸出不含 twinsim。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('TSIM-14 建置：dist-sim/ 存在，SHA 注入、研究片段字樣、manifest id／scope、SW 快取前綴獨立；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-sim', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-sim/.build-info.json'));
  assert.equal(info.sub, 'twin-sim');
  const html = rd('dist-sim/index.html'), sw = rd('dist-sim/sw.js'), man = JSON.parse(rd('dist-sim/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段'));
  assert.equal(man.id, 'twin-sim');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-twinsim-'`) && sw.includes(info.sha));
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin']) {
    assert.ok(!rd(`${d}/sw.js`).includes('twinsim'), `${d}/sw.js`);
    assert.ok(!rd(`${d}/app.js`).includes('thecut-twinsim-log'), `${d}/app.js`);
  }
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-sim', f)), f);
});

test('TSIM-10 字眼：建置出的 app.js、index.html 不含「先出手」「搶先」，含「本回合被切除，未能發動」', () => {
  // esbuild 會把中文轉成 \uXXXX：先解碼再比對，否則「不含」恆真
  const dec = (t: string) => t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const app = dec(rd('dist-sim/app.js')), html = dec(rd('dist-sim/index.html'));
  for (const w of ['先出手', '搶先']) { assert.ok(!app.includes(w), `app.js 含 ${w}`); assert.ok(!html.includes(w), `index.html 含 ${w}`); }
  assert.ok(app.includes('本回合被切除，未能發動'));
});
