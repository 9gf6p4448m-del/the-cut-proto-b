// 根網址 service worker 相容性修復的部署（DL-069）：只替換 gh-pages 根目錄的 sw.js 一個檔案。
// 不用 tools/deploy.mjs 的根網址模式：那個模式會以 dist/ 取代 gh-pages 全部內容，連子路徑目錄（fun-exp-01/、core-skewer/、twin-slash/）都會被刪。
// sw.js 由 public/sw.js 產生，__BUILD_SHA__ 換成「線上根頁 index.html 的 build-sha」，讓預先快取的檔案名稱與線上根頁一致；根頁其他檔案一個位元都不動。
// 檢查：提交差異的檔名清單必須恰好是 ["sw.js"]；其餘所有檔案（含子目錄）的 git blob id 部署前後相同；推送後重新 clone 再驗一次。
// 用法：node tools/deploy_root_sw.mjs            （正式：推 origin 的 gh-pages）
//       node tools/deploy_root_sw.mjs --rehearsal --remote <本機 bare repo>   （演練）
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRootUnchanged, treeSnapshot } from './deploy_lib.mjs';

const sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString().trim();
const argv = process.argv.slice(2);
const rehearsal = argv.includes('--rehearsal');
const ri = argv.indexOf('--remote'), remoteOpt = ri >= 0 ? argv[ri + 1] : null;
const origin = sh('git remote get-url origin');
if (rehearsal && (!remoteOpt || remoteOpt === origin)) throw new Error('--rehearsal 必須搭配不是 origin 的 --remote');
if (remoteOpt && !rehearsal) throw new Error('--remote 只能和 --rehearsal 一起用');
const url = rehearsal ? remoteOpt : origin;
const head = sh('git rev-parse --short=7 HEAD'), branch = sh('git rev-parse --abbrev-ref HEAD');
if (!rehearsal) {
  if (sh('git status --porcelain -- public/sw.js tools')) throw new Error('public/sw.js 或 tools 有未提交的變更');
  if (sh(`git ls-remote origin refs/heads/${branch}`).slice(0, 7) !== head) throw new Error(`HEAD ${head} 尚未推送`);
}
const NONE = 'zz-no-sub';   // treeSnapshot 需要一個要略過的子目錄名；用不存在的名稱＝整棵樹都比
const dir = mkdtempSync(join(tmpdir(), 'protob-rootsw-'));
sh(`git clone -q -c core.autocrlf=false --depth 1 --branch gh-pages "${url}" .`, { cwd: dir });
const liveSha = readFileSync(join(dir, 'index.html'), 'utf8').match(/name="build-sha" content="([^"]+)"/)[1];
const before = treeSnapshot(dir, 'HEAD', NONE);
writeFileSync(join(dir, 'sw.js'), readFileSync('public/sw.js', 'utf8').replaceAll('__BUILD_SHA__', liveSha));
sh('git add -A', { cwd: dir });
const touched = sh('git diff --cached --name-only', { cwd: dir }).split('\n').filter(Boolean);
if (touched.length === 0) { console.log('sw.js 已是新版，不部署'); process.exit(0); }
if (JSON.stringify(touched) !== '["sw.js"]') throw new Error(`本次提交會動到 sw.js 以外的檔案，中止：${touched.join('、')}`);
const an = sh('git log -1 --format=%an', { cwd: dir }), ae = sh('git log -1 --format=%ae', { cwd: dir });
sh(`git -c user.name="${an}" -c user.email="${ae}" commit -q -m "部署 根網址 sw.js 相容性修復（DL-069）：來源 ${head}，根頁 build-sha ${liveSha} 不變"`, { cwd: dir });
const check = (snap) => { const a = new Map(before), b = new Map(snap); a.delete('sw.js'); b.delete('sw.js'); assertRootUnchanged(a, b); };
check(treeSnapshot(dir, 'HEAD', NONE));
sh('git push -q origin gh-pages', { cwd: dir });
const dir2 = mkdtempSync(join(tmpdir(), 'protob-rootsw-verify-'));
sh(`git clone -q -c core.autocrlf=false --depth 1 --branch gh-pages "${url}" .`, { cwd: dir2 });
const after = treeSnapshot(dir2, 'HEAD', NONE);
check(after);
if (after.get('sw.js') === before.get('sw.js')) throw new Error('推送後 sw.js 沒有改變');
console.log(`deployed root sw.js（來源 ${head}；根頁 build-sha ${liveSha} 不變；其餘 ${before.size - 1} 個檔案 blob id 前後相同；遠端 gh-pages ${sh('git rev-parse --short=7 HEAD', { cwd: dir2 })}）`);
