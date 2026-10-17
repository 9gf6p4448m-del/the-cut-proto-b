// FUN-EXP-01 子路徑部署用的純檔案函式（tools/deploy.mjs 與 tests/node/deploy_sub.test.ts 共用）。
// 核心承諾：只替換 gh-pages 的 `<sub>/` 目錄；其餘（除 .git 外）每個檔案一個位元都不能動——部署前後逐檔 SHA-256 比對，不同就中止。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SUB_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 子路徑名稱必須是單一小寫英數與連字號的目錄名（不得為空、含斜線、點、.git）。 */
export function assertSubName(sub) {
  if (typeof sub !== 'string' || !SUB_RE.test(sub)) throw new Error(`子路徑名稱不合法：${JSON.stringify(sub)}`);
}

function walk(dir, base, skipTop, out) {
  for (const name of readdirSync(dir)) {
    const rel = base ? `${base}/${name}` : name;
    if (!base && skipTop.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, rel, skipTop, out);
    else out.set(rel, createHash('sha256').update(readFileSync(p)).digest('hex'));
  }
}

/** gh-pages 工作樹的「根目錄其餘檔案」快照：略過 .git 與 `<sub>/`；傳回 相對路徑 → SHA-256。 */
export function rootSnapshot(dir, sub) {
  assertSubName(sub);
  const out = new Map();
  walk(dir, '', new Set(['.git', sub]), out);
  return out;
}

/** 部署前後的根目錄快照必須完全相同（含檔案集合）；不同就丟錯，訊息列出差異。 */
export function assertRootUnchanged(before, after) {
  const diffs = [];
  for (const [f, h] of before) {
    if (!after.has(f)) diffs.push(`刪除 ${f}`);
    else if (after.get(f) !== h) diffs.push(`改動 ${f}`);
  }
  for (const f of after.keys()) if (!before.has(f)) diffs.push(`新增 ${f}`);
  if (diffs.length) throw new Error(`部署會動到根目錄其他檔案，中止：${diffs.slice(0, 10).join('；')}`);
}

/** 以 src 目錄完整取代 `<dir>/<sub>/`（先刪舊的）。只碰 `<sub>/`。 */
export function replaceSubdir(dir, sub, src) {
  assertSubName(sub);
  const target = join(dir, sub);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(src, target, { recursive: true });
}

/** 某個 commit 的 git 樹快照（路徑 → blob id），略過 `<sub>/`；blob id 與換行轉換設定無關，是「逐位元相同」的最終依據。 */
export function treeSnapshot(cwd, rev, sub) {
  assertSubName(sub);
  const out = new Map();
  const text = execFileSync('git', ['ls-tree', '-r', '-z', rev], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  for (const rec of text.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [, , id] = rec.slice(0, tab).split(' ');
    const path = rec.slice(tab + 1);
    if (path.startsWith(`${sub}/`)) continue;
    out.set(path, id);
  }
  return out;
}

/** --remote 是否為本機路徑（DL-070；Codex R3 MEDIUM）。URL（scheme://）與 Git 的 SCP 語法（[user@]host:path、[user@][IPv6]:path）不是本機路徑；
 *  Windows 磁碟路徑（C:\、C:/）與相對、絕對路徑是。 */
export function isLocalRemote(r) {
  if (/^[a-zA-Z]:[\\/]/.test(r)) return true;                 // Windows 磁碟路徑
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(r)) return false;        // URL
  if (/^(?:[^@\\/:]+@)?\[[^\]]+\]:/.test(r)) return false;      // SCP + IPv6：[::1]:repo、git@[::1]:repo
  const colon = r.indexOf(':'), slash = r.search(/[\\/]/);
  if (colon > 0 && (slash < 0 || colon < slash)) return false;  // SCP：host:path、user@host:path（冒號在第一個斜線之前）
  return true;
}
