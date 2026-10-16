// 部署：以目前 HEAD 建置（SHA 注入頁面）的 dist/，作為 gh-pages 分支的一個新 commit 推送（不改寫歷史）。
// 先決條件：工作樹乾淨、HEAD 已推送、測試已在同一個建置上跑過。
import { execSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString().trim();
if (sh('git status --porcelain -- src public shims engine tools')) throw new Error('工作樹有未提交的變更');
const head = sh('git rev-parse --short=7 HEAD');
const remote = sh('git ls-remote origin refs/heads/proto-b').slice(0, 7);
if (remote !== head) throw new Error(`HEAD ${head} 尚未推送（遠端 ${remote}）`);
const url = sh('git remote get-url origin');
const dir = mkdtempSync(join(tmpdir(), 'protob-pages-'));
sh(`git clone -q --depth 1 --branch gh-pages ${url} .`, { cwd: dir });
for (const f of readdirSync(dir)) if (f !== '.git') rmSync(join(dir, f), { recursive: true, force: true });
cpSync('dist', dir, { recursive: true });
writeFileSync(join(dir, '.nojekyll'), '');
const an = sh('git log -1 --format=%an'), ae = sh('git log -1 --format=%ae');
sh('git add -A', { cwd: dir });
sh(`git -c user.name="${an}" -c user.email="${ae}" commit -q -m "部署 proto-b ${head}"`, { cwd: dir });
sh('git push -q origin gh-pages', { cwd: dir });
console.log(`deployed ${head}`);
