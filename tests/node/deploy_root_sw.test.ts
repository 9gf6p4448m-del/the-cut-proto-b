// RS-9（DL-070）：tools/deploy_root_sw.mjs 的演練接受相對路徑 --remote，結果與絕對路徑相同；只改 sw.js。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT } from './helpers.ts';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fakePages(): string {
  const d = mkdtempSync(join(tmpdir(), 'rootsw-rs9-'));
  const w = join(d, 'w'); mkdirSync(join(w, 'twin-slash'), { recursive: true });
  writeFileSync(join(w, 'index.html'), '<meta name="build-sha" content="42fdb21"><title>ROOT</title>');
  writeFileSync(join(w, 'sw.js'), '// old root sw\n');
  writeFileSync(join(w, 'twin-slash', 'index.html'), '<title>TWIN</title>');
  git(w, 'init', '-q', '-b', 'gh-pages'); git(w, 'add', '-A');
  git(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  git(d, 'clone', '-q', '--bare', 'w', 'pages.git');
  return join(d, 'pages.git');
}
const run = (remote: string) => execFileSync('node', ['tools/deploy_root_sw.mjs', '--rehearsal', '--remote', remote], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('RS-9 相對路徑 --remote 演練成功、只改 sw.js；與絕對路徑結果相同', () => {
  const relBare = fakePages(), absBare = fakePages();
  const rel = relative(ROOT, relBare);
  assert.ok(!rel.match(/^[a-zA-Z]:/), `需為相對路徑：${rel}`);
  assert.match(run(rel), /deployed root sw\.js/);
  assert.match(run(absBare), /deployed root sw\.js/);
  for (const b of [relBare, absBare]) assert.equal(git(b, 'diff', '--name-only', 'gh-pages~1', 'gh-pages'), 'sw.js');
  assert.equal(git(relBare, 'show', 'gh-pages:sw.js'), git(absBare, 'show', 'gh-pages:sw.js'));
  assert.ok(git(relBare, 'show', 'gh-pages:sw.js').includes("thecut-protob-42fdb21"), 'sw.js 以線上根頁 build-sha 產生');
  assert.match(run(rel), /已是新版/);                                         // 再跑一次：冪等
});
