// 部署：以目前 HEAD 建置（SHA 注入頁面）的輸出，作為 gh-pages 分支的一個新 commit 推送（不改寫歷史）。
// 先決條件：工作樹乾淨、HEAD 已推送、測試已在同一個建置上跑過。
//
// 兩種模式：
//   node tools/deploy.mjs                          根網址版本：以 dist/ 取代 gh-pages 全部內容（原行為，未改動）
//   node tools/deploy.mjs --sub fun-exp-01         FUN-EXP-01 實驗版：只替換 gh-pages 的 fun-exp-01/ 目錄（來源 dist-exp/）；
//   node tools/deploy.mjs --sub core-skewer        串刺研究片段：只替換 gh-pages 的 core-skewer/ 目錄（來源 dist-skewer/）；規則同上
//   node tools/deploy.mjs --sub twin-slash         一刀雙獸研究片段：只替換 gh-pages 的 twin-slash/ 目錄（來源 dist-twin/）；規則同上
//   node tools/deploy.mjs --sub twin-sim           同時下刀研究片段：只替換 gh-pages 的 twin-sim/ 目錄（來源 dist-sim/）；規則同上
//   node tools/deploy.mjs --sub rt-cut             即時亂切研究片段：只替換 gh-pages 的 rt-cut/ 目錄（來源 dist-rt/）；規則同上
//   node tools/deploy.mjs --sub rt-cut2            即時亂切 v2 研究片段：只替換 gh-pages 的 rt-cut2/ 目錄（來源 dist-rt2/）；規則同上
//   node tools/deploy.mjs --sub duel               對決 切割→戰鬥研究片段：只替換 gh-pages 的 duel/ 目錄（來源 dist-duel/）；規則同上
//   node tools/deploy.mjs --sub duel2              對決 v0.2 美術合併研究片段：只替換 gh-pages 的 duel2/ 目錄（來源 dist-duel2/）；規則同上
//   node tools/deploy.mjs --sub art-kit            幽光美術模組展示：只替換 gh-pages 的 art-kit/ 目錄（來源 dist-art/）；規則同上
//                                                  根目錄其他檔案一個位元都不能動——部署前後逐檔 SHA-256 比對，不同就中止（推送前、推送後各驗一次）
//   --rehearsal --remote <url-or-path>             演練：改推到指定遠端（不得是 origin），略過「工作樹乾淨／HEAD 已推送／建置 SHA 相符」檢查；測試用
import { execSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRootUnchanged, assertSubName, replaceSubdir, rootSnapshot, treeSnapshot } from './deploy_lib.mjs';

const sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString().trim();
const argv = process.argv.slice(2);
const opt = (name) => { const k = argv.findIndex((a) => a === name || a.startsWith(`${name}=`)); if (k < 0) return null; return argv[k].includes('=') ? argv[k].split('=').slice(1).join('=') : argv[k + 1]; };
const sub = opt('--sub');
const rehearsal = argv.includes('--rehearsal');
const remoteOpt = opt('--remote');

const origin = sh('git remote get-url origin');
if (rehearsal && (!remoteOpt || remoteOpt === origin)) throw new Error('--rehearsal 必須搭配不是 origin 的 --remote');
if (remoteOpt && !rehearsal) throw new Error('--remote 只能和 --rehearsal 一起用');
const url = rehearsal ? remoteOpt : origin;
const head = sh('git rev-parse --short=7 HEAD');
const branch = sh('git rev-parse --abbrev-ref HEAD');

if (!rehearsal) {
  if (sh(`git status --porcelain -- src public${sub ? ' public-exp public-skewer public-twinslash public-twinsim public-rtcut public-rtcut2 public-duel public-duel2 public-artkit' : ''} shims engine tools`)) throw new Error('工作樹有未提交的變更');
  const remote = sh(`git ls-remote origin refs/heads/${sub ? branch : 'proto-b'}`).slice(0, 7);
  if (remote !== head) throw new Error(`HEAD ${head} 尚未推送（遠端 ${remote}）`);
}

const dir = mkdtempSync(join(tmpdir(), 'protob-pages-'));
sh(`git clone -q ${sub ? '-c core.autocrlf=false ' : ''}--depth 1 --branch gh-pages "${url}" .`, { cwd: dir });
const an = sh('git log -1 --format=%an'), ae = sh('git log -1 --format=%ae');

if (!sub) {
  // ---- 根網址版本（原行為）----
  for (const f of readdirSync(dir)) if (f !== '.git') rmSync(join(dir, f), { recursive: true, force: true });
  cpSync('dist', dir, { recursive: true });
  writeFileSync(join(dir, '.nojekyll'), '');
  sh('git add -A', { cwd: dir });
  sh(`git -c user.name="${an}" -c user.email="${ae}" commit -q -m "部署 proto-b ${head}"`, { cwd: dir });
  sh('git push -q origin gh-pages', { cwd: dir });
  console.log(`deployed ${head}`);
} else {
  // ---- 實驗版子路徑 ----
  assertSubName(sub);
  const src = { 'core-skewer': 'dist-skewer', 'twin-slash': 'dist-twin', 'twin-sim': 'dist-sim', 'rt-cut': 'dist-rt', 'rt-cut2': 'dist-rt2', duel: 'dist-duel', duel2: 'dist-duel2', 'art-kit': 'dist-art' }[sub] ?? 'dist-exp'; // 研究片段各有自己的建置輸出
  if (!existsSync(`${src}/.build-info.json`)) throw new Error(`找不到 ${src}/（先跑 node tools/build.mjs）`);
  const info = JSON.parse(readFileSync(`${src}/.build-info.json`, 'utf8'));
  if (info.sub !== sub) throw new Error(`${src} 是為子路徑 ${info.sub} 建置的，不是 ${sub}`);
  if (!rehearsal && info.sha !== head) throw new Error(`${src} 建置 SHA ${info.sha} ≠ HEAD ${head}：請在目前 HEAD 重新建置並重跑測試`);
  const before = rootSnapshot(dir, sub);
  const beforeTree = treeSnapshot(dir, 'HEAD', sub);
  replaceSubdir(dir, sub, src);
  assertRootUnchanged(before, rootSnapshot(dir, sub)); // 推送前：工作樹的根目錄檔案必須逐位元相同
  sh('git add -A', { cwd: dir });
  const touched = sh('git diff --cached --name-only', { cwd: dir }).split('\n').filter(Boolean);
  const outside = touched.filter((f) => !f.startsWith(`${sub}/`));
  if (outside.length) throw new Error(`本次提交會動到 ${sub}/ 以外的檔案，中止：${outside.slice(0, 10).join('、')}`);
  if (touched.length === 0) { console.log('沒有變更，不部署'); process.exit(0); }
  sh(`git -c user.name="${an}" -c user.email="${ae}" commit -q -m "部署 ${{ 'core-skewer': '串刺研究片段', 'twin-slash': '一刀雙獸研究片段', 'twin-sim': '同時下刀研究片段', 'rt-cut': '即時亂切研究片段', 'rt-cut2': '即時亂切 v2 研究片段', duel: '對決 切割→戰鬥研究片段', duel2: '對決 v0.2 美術合併研究片段', 'art-kit': '幽光美術模組展示' }[sub] ?? 'FUN-EXP-01 實驗版'} ${sub}/ ${head}"`, { cwd: dir });
  assertRootUnchanged(beforeTree, treeSnapshot(dir, 'HEAD', sub)); // 提交後：git blob id 逐檔相同（與換行轉換無關）
  sh('git push -q origin gh-pages', { cwd: dir });
  // 推送後：重新 clone 遠端 gh-pages，再比對一次根目錄
  const dir2 = mkdtempSync(join(tmpdir(), 'protob-pages-verify-'));
  sh(`git clone -q -c core.autocrlf=false --depth 1 --branch gh-pages "${url}" .`, { cwd: dir2 });
  assertRootUnchanged(beforeTree, treeSnapshot(dir2, 'HEAD', sub));
  assertRootUnchanged(before, rootSnapshot(dir2, sub));
  console.log(`deployed ${sub}/ ${head}（根目錄 ${before.size} 個檔案部署前後逐位元相同；遠端 gh-pages ${sh('git rev-parse --short=7 HEAD', { cwd: dir2 })}）`);
}
