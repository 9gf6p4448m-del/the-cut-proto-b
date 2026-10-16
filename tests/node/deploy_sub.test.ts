// FUN-EXP-01 X-12（部署腳本準備）：子路徑部署只替換 gh-pages 的 fun-exp-01/，根目錄其他檔案一個位元都不動。
// 以本機暫存的 bare repo 演練（--rehearsal --remote），不連 origin、不推任何遠端。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';
import { assertRootUnchanged, assertSubName, replaceSubdir, rootSnapshot } from '../../tools/deploy_lib.mjs';

const NUL = String.fromCharCode(0), TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function walkAll(d: string, base = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of readdirSync(d)) {
    if (!base && n === '.git') continue;
    const p = join(d, n), rel = base ? `${base}/${n}` : n;
    if (statSync(p).isDirectory()) for (const [k, v] of walkAll(p, rel)) out.set(k, v); else out.set(rel, sha(readFileSync(p)));
  }
  return out;
}

function makeRemote(): { bare: string; rootFiles: Map<string, string> } {
  const tmp = mkdtempSync(join(tmpdir(), 'deploy-sub-test-'));
  const bare = join(tmp, 'bare.git'), work = join(tmp, 'work');
  mkdirSync(bare); git(bare, 'init', '--bare', '-q'); git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/gh-pages');
  mkdirSync(work); git(work, 'init', '-q', '-b', 'gh-pages');
  writeFileSync(join(work, 'index.html'), '<html>root app</html>' + NL);
  writeFileSync(join(work, 'app.js'), 'console.log("root");' + NL);
  writeFileSync(join(work, 'sw.js'), "const CACHE='thecut-protob-aaaaaaa';" + NL);
  writeFileSync(join(work, '.nojekyll'), '');
  mkdirSync(join(work, 'assets')); writeFileSync(join(work, 'assets', 'x.bin'), Buffer.from([0, 1, 2, 3, 254, 255]));
  mkdirSync(join(work, 'fun-exp-01')); writeFileSync(join(work, 'fun-exp-01', 'old.txt'), 'stale experimental file' + NL);
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'seed gh-pages');
  git(work, 'push', '-q', bare, 'gh-pages');
  const rootFiles = new Map([...walkAll(work)].filter(([k]) => !k.startsWith('fun-exp-01/')));
  return { bare, rootFiles };
}
const cloneOf = (bare: string): string => { const d = mkdtempSync(join(tmpdir(), 'deploy-sub-clone-')); git(d, 'clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'gh-pages', bare, '.'); return d; };
const deploy = (bare: string, ...extra: string[]) => spawnSync('node', ['tools/deploy.mjs', '--sub', 'fun-exp-01', '--rehearsal', '--remote', bare, ...extra], { cwd: ROOT, encoding: 'utf8' });

/** bare repo 某 rev 的 git 樹（路徑 → blob id）；blob id 與換行轉換設定無關。 */
function tree(bare: string, rev: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '-z', rev]).toString().split(NUL).filter(Boolean)) {
    const tab = line.indexOf(TAB); m.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]);
  }
  return m;
}
const blobId = (file: string): string => execFileSync('git', ['hash-object', '--no-filters', file]).toString().trim();

test('X-12 子路徑部署演練：只換 fun-exp-01/，根目錄檔案逐位元相同，舊檔清除，提交只含 fun-exp-01/，重跑為無變更', () => {
  assert.ok(existsSync(join(ROOT, 'dist-exp', 'index.html')), '先跑 node tools/build.mjs');
  const { bare, rootFiles } = makeRemote();
  assert.ok(rootFiles.size >= 5);
  const t0 = tree(bare, 'gh-pages');
  const r = deploy(bare);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const t1 = tree(bare, 'gh-pages');
  const root0 = [...t0].filter(([k]) => !k.startsWith('fun-exp-01/')).sort(), root1 = [...t1].filter(([k]) => !k.startsWith('fun-exp-01/')).sort();
  assert.deepEqual(root1, root0, '根目錄檔案（git blob id）部署前後必須逐位元相同');
  const dist = walkAll(join(ROOT, 'dist-exp'));
  const subIds = new Map([...t1].filter(([k]) => k.startsWith('fun-exp-01/')).map(([k, v]) => [k.slice('fun-exp-01/'.length), v]));
  const distIds = new Map([...dist.keys()].map((k) => [k, blobId(join(ROOT, 'dist-exp', k))]));
  assert.deepEqual([...subIds].sort(), [...distIds].sort(), 'fun-exp-01/ 內容必須等於 dist-exp/（舊檔 old.txt 已清除）');
  assert.equal(t1.has('fun-exp-01/old.txt'), false);
  assert.equal(git(bare, 'rev-list', '--count', 'gh-pages'), '2');
  const names = git(bare, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'gh-pages').split(NL).filter(Boolean);
  assert.ok(names.length > 0 && names.every((n) => n.startsWith('fun-exp-01/')), `提交含 fun-exp-01/ 以外的檔案：${names}`);
  assert.match(r.stdout, /逐位元相同/);
  // 重跑：沒有變更就不產生新提交
  const r2 = deploy(bare);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /沒有變更/);
  assert.equal(git(bare, 'rev-list', '--count', 'gh-pages'), '2');
});

test('X-12 部署腳本護欄：--remote 必須搭配 --rehearsal；--rehearsal 不得指向 origin；不合法子路徑被拒', () => {
  const { bare } = makeRemote();
  const a = spawnSync('node', ['tools/deploy.mjs', '--sub', 'fun-exp-01', '--remote', bare], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(a.status, 0); assert.match(a.stderr, /--remote 只能和 --rehearsal/);
  const origin = git(ROOT, 'remote', 'get-url', 'origin');
  const b = spawnSync('node', ['tools/deploy.mjs', '--sub', 'fun-exp-01', '--rehearsal', '--remote', origin], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(b.status, 0); assert.match(b.stderr, /不是 origin/);
  for (const bad of ['', '.', '..', '../x', 'a/b', 'Root', 'fun exp', '.git', '-x']) assert.throws(() => assertSubName(bad), /不合法/, JSON.stringify(bad));
  assert.doesNotThrow(() => assertSubName('fun-exp-01'));
});

test('X-12 根目錄比對鑑別力：改一個位元、刪檔、新增檔，assertRootUnchanged 都必須中止；只改子目錄不中止', () => {
  const { bare } = makeRemote();
  const d = cloneOf(bare);
  const before = rootSnapshot(d, 'fun-exp-01');
  assert.ok(before.size >= 4);
  writeFileSync(join(d, 'fun-exp-01', 'new.txt'), 'x'); // 只動子目錄：不算
  assert.doesNotThrow(() => assertRootUnchanged(before, rootSnapshot(d, 'fun-exp-01')));
  writeFileSync(join(d, 'assets', 'x.bin'), Buffer.from([0, 1, 2, 3, 254, 254])); // 最後一個位元組差 1
  assert.throws(() => assertRootUnchanged(before, rootSnapshot(d, 'fun-exp-01')), /改動 assets\/x\.bin/);
  writeFileSync(join(d, 'assets', 'x.bin'), Buffer.from([0, 1, 2, 3, 254, 255]));
  assert.doesNotThrow(() => assertRootUnchanged(before, rootSnapshot(d, 'fun-exp-01')));
  writeFileSync(join(d, 'extra.txt'), 'x');
  assert.throws(() => assertRootUnchanged(before, rootSnapshot(d, 'fun-exp-01')), /新增 extra\.txt/);
  const m = new Map(before); m.set('gone.txt', 'h');
  assert.throws(() => assertRootUnchanged(m, before), /刪除 gone\.txt/);
  // replaceSubdir 只碰子目錄
  const d2 = cloneOf(bare), b2 = rootSnapshot(d2, 'fun-exp-01');
  replaceSubdir(d2, 'fun-exp-01', join(ROOT, 'dist-exp'));
  assert.doesNotThrow(() => assertRootUnchanged(b2, rootSnapshot(d2, 'fun-exp-01')));
  assert.throws(() => replaceSubdir(d2, '..', join(ROOT, 'dist-exp')), /不合法/);
});
