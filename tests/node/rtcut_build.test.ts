// 即時亂切子路徑建置輸出（RT-09 建置部分）：dist-rt/ 的 manifest／service worker／版本 SHA 獨立；其他輸出不含 rtcut。
// 需要先跑 node tools/build.mjs；沒有輸出時失敗，不得靜默略過。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const rd = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('RT-09 建置：dist-rt/ 存在，SHA 注入、研究片段字樣、manifest id＝rt-cut／scope、SW 快取前綴 thecut-rtcut-；其他輸出不受影響', () => {
  assert.ok(existsSync(join(ROOT, 'dist-rt', 'index.html')), '先跑 node tools/build.mjs');
  const info = JSON.parse(rd('dist-rt/.build-info.json'));
  assert.equal(info.sub, 'rt-cut');
  const html = rd('dist-rt/index.html'), sw = rd('dist-rt/sw.js'), man = JSON.parse(rd('dist-rt/manifest.webmanifest'));
  assert.ok(!html.includes('__BUILD_SHA__') && !sw.includes('__BUILD_SHA__'));
  assert.match(html, new RegExp(`name="build-sha" content="${info.sha}"`));
  assert.ok(html.includes('研究片段'));
  assert.equal(man.id, 'rt-cut');
  assert.equal(man.scope, './');
  assert.ok(sw.includes(`'thecut-rtcut-'`) && sw.includes(info.sha));
  assert.ok(sw.includes('k.startsWith(PREFIX) && k !== CACHE'), '清舊快取只能清自己前綴的');
  for (const d of ['dist', 'dist-exp', 'dist-skewer', 'dist-twin', 'dist-sim']) {
    assert.ok(!rd(`${d}/sw.js`).includes('rtcut'), `${d}/sw.js`);
    assert.ok(!rd(`${d}/app.js`).includes('__rt'), `${d}/app.js`);
  }
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'style.css', 'app.js']) assert.ok(existsSync(join(ROOT, 'dist-rt', f)), f);
});

test('RT-09 舊原型不變：src/twinslash*、src/twinsim*、public*/（public-rtcut/ 除外）對 a330c98 diff 為空', () => {
  const out = execFileSync('git', ['diff', '--name-only', 'a330c98', '--', 'src/twinslash', 'src/twinslash_main.ts', 'src/twinsim', 'src/twinsim_main.ts', 'public', 'public-exp', 'public-skewer', 'public-twinslash', 'public-twinsim'], { cwd: ROOT, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src/twinslash', 'src/twinsim', 'public', 'public-exp', 'public-skewer', 'public-twinslash', 'public-twinsim'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out.trim() + untracked.trim(), '');
  const dirs = execFileSync('git', ['ls-files', '--', 'public*'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.split('/')[0]);
  assert.deepEqual([...new Set(dirs)].sort(), ['public', 'public-exp', 'public-rtcut', 'public-rtcut2' /* rt-cut2 新增（R2-07 授權的新子路徑） */, 'public-duel' /* 對決 切割→戰鬥新增（DL-081 授權的新子路徑 duel/）；舊原型目錄照樣逐一檢查 */, 'public-artkit' /* 幽光美術模組展示頁（主 session 美術派工授權的新子路徑 art-kit/） */, 'public-skewer', 'public-twinslash', 'public-twinsim'].filter((d) => dirs.includes(d)).sort());
});
