// 固定入口 play/（DL-092）部署：把 public-play/（純靜態，不經 build.mjs）放到 gh-pages 的 play/，其他檔案一個位元都不能動。
// 不改 tools/deploy.mjs 的既有行為；根目錄比對重用 tools/deploy_lib.mjs（推送前、提交後、推送後重新 clone 各驗一次）。
// 另列部署前後每個子路徑 index.html 的 build-sha，逐一比對（PL-06）。
//
//   node tools/deploy_play.mjs                                  正式部署到 origin（工作樹乾淨、HEAD 已推送）
//   node tools/deploy_play.mjs --rehearsal --remote <路徑或網址>  演練：推到指定遠端（不得是 origin）
//   演練時加 --sabotage：故意在 play/ 以外多寫一個檔，驗證腳本會中止（不推送）
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRootUnchanged, replaceSubdir, rootSnapshot, treeSnapshot } from './deploy_lib.mjs';

const SUB = 'play', SRC = 'public-play';
const sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString().trim();
const argv = process.argv.slice(2);
const opt = (name) => { const k = argv.findIndex((a) => a === name || a.startsWith(`${name}=`)); if (k < 0) return null; return argv[k].includes('=') ? argv[k].split('=').slice(1).join('=') : argv[k + 1]; };
const rehearsal = argv.includes('--rehearsal'), sabotage = argv.includes('--sabotage'), remoteOpt = opt('--remote');
const origin = sh('git remote get-url origin');
if (rehearsal && (!remoteOpt || remoteOpt === origin)) throw new Error('--rehearsal 必須搭配不是 origin 的 --remote');
if (remoteOpt && !rehearsal) throw new Error('--remote 只能和 --rehearsal 一起用');
if (sabotage && !rehearsal) throw new Error('--sabotage 只能在演練用');
const url = rehearsal ? remoteOpt : origin;
const head = sh('git rev-parse --short=7 HEAD'), branch = sh('git rev-parse --abbrev-ref HEAD');

if (!rehearsal) {
  if (sh(`git status --porcelain -- ${SRC} tools`)) throw new Error('工作樹有未提交的變更');
  const remote = sh(`git ls-remote origin refs/heads/${branch}`).slice(0, 7);
  if (remote !== head) throw new Error(`HEAD ${head} 尚未推送（遠端 ${remote}）`);
}
const latest = JSON.parse(readFileSync(join(SRC, 'latest.json'), 'utf8'));   // 格式錯就在這裡中止
if (!/^[a-z0-9][a-z0-9-]*$/.test(latest.sub)) throw new Error(`latest.json 的 sub 不合法：${latest.sub}`);

/** gh-pages 工作樹裡每個子路徑 index.html 的 build-sha（play/ 除外）。 */
const buildShas = (dir) => Object.fromEntries(readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '.git' && d.name !== SUB && existsSync(join(dir, d.name, 'index.html')))
  .map((d) => [d.name, (readFileSync(join(dir, d.name, 'index.html'), 'utf8').match(/name="build-sha" content="([^"]+)"/) || [])[1] ?? '（無）']));

const dir = mkdtempSync(join(tmpdir(), 'protob-play-'));
sh(`git clone -q -c core.autocrlf=false --depth 1 --branch gh-pages "${url}" .`, { cwd: dir });
if (!existsSync(join(dir, latest.sub, 'index.html'))) throw new Error(`gh-pages 上沒有 ${latest.sub}/，latest.json 會指到不存在的版本`);
const an = sh('git log -1 --format=%an', { cwd: dir }), ae = sh('git log -1 --format=%ae', { cwd: dir }), ghBefore = sh('git rev-parse --short=7 HEAD', { cwd: dir });
const shaBefore = buildShas(dir), before = rootSnapshot(dir, SUB), beforeTree = treeSnapshot(dir, 'HEAD', SUB);
replaceSubdir(dir, SUB, SRC);
writeFileSync(join(dir, SUB, '.build-info.json'), JSON.stringify({ sub: SUB, sha: head, latest: latest.sub }) + '\n');
if (sabotage) writeFileSync(join(dir, 'sabotage.txt'), 'x');
assertRootUnchanged(before, rootSnapshot(dir, SUB));
sh('git add -A', { cwd: dir });
const touched = sh('git diff --cached --name-only', { cwd: dir }).split('\n').filter(Boolean);
const outside = touched.filter((f) => !f.startsWith(`${SUB}/`));
if (outside.length) throw new Error(`本次提交會動到 ${SUB}/ 以外的檔案，中止：${outside.slice(0, 10).join('、')}`);
if (touched.length === 0) { console.log('沒有變更，不部署'); process.exit(0); }
sh(`git -c user.name="${an}" -c user.email="${ae}" commit -q -m "部署 固定入口 ${SUB}/（latest＝${latest.sub}）${head}"`, { cwd: dir });
assertRootUnchanged(beforeTree, treeSnapshot(dir, 'HEAD', SUB));
sh('git push -q origin gh-pages', { cwd: dir });
const dir2 = mkdtempSync(join(tmpdir(), 'protob-play-verify-'));
sh(`git clone -q -c core.autocrlf=false --depth 1 --branch gh-pages "${url}" .`, { cwd: dir2 });
assertRootUnchanged(beforeTree, treeSnapshot(dir2, 'HEAD', SUB));
assertRootUnchanged(before, rootSnapshot(dir2, SUB));
const shaAfter = buildShas(dir2);
const shaDiff = Object.keys({ ...shaBefore, ...shaAfter }).filter((k) => shaBefore[k] !== shaAfter[k]);
if (shaDiff.length) throw new Error(`子路徑 build-sha 部署前後不同：${shaDiff.join('、')}`);
console.log('子路徑 build-sha（部署前＝部署後）：' + Object.entries(shaAfter).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`deployed ${SUB}/ ${head}（latest＝${latest.sub}；play/ 以外 ${before.size} 個檔案部署前後逐位元相同；gh-pages ${ghBefore} → ${sh('git rev-parse --short=7 HEAD', { cwd: dir2 })}）`);
