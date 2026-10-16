import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}
export function snapshot(): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(join(ROOT, 'SNAPSHOT_3e2b9b4.sha256'), 'utf8').trim().split('\n')) {
    const mm = /^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line.trim());
    if (mm) m.set(mm[2], mm[1]);
  }
  return m;
}
export const FORK_OLD = 'content.organs[st.below(6)].key';
export const FORK_NEW = 'content.organs[st.below(PROTO_B_ORGAN_POOL)].key';
export const FORK_ADD = '/** B 軌 fork（proto-b）：每顆器官從前 N 種抽（預設 6＝研究引擎原樣；3＝三器官體驗模式）。只能在 newBattle 前設定。 */\nexport let PROTO_B_ORGAN_POOL = 6;\nexport function setProtoBOrganPool(n: 3 | 6): void { PROTO_B_ORGAN_POOL = n; }\n';

/** 由 fork 反推原始 3e2b9b4 引擎（只撤銷凍結登記的那一處），放到暫存目錄；回傳目錄。 */
export function originalEngineDir(): string {
  const dst = join(ROOT, '.tmp', 'orig-engine');
  for (const f of walk(join(ROOT, 'engine'))) {
    const rel = relative(join(ROOT, 'engine'), f);
    const to = join(dst, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (rel.replace(/\\/g, '/') === 'src/engine.ts') writeFileSync(to, readFileSync(f, 'utf8').replace(FORK_ADD, '').replace(FORK_NEW, FORK_OLD));
    else copyFileSync(f, to);
  }
  return dst;
}

export const CFG = { model: 'A' as const, rules: { ph: 'PH-M' as const, so: 'SO-3' as const, hs: 'HS-1' as const, sem: 'SEM-1' as const }, enemy: { kind: 'BUT' as const, w10: 7 }, hpP: 40, hpE: 30, r: 160, anchorCount: 12, maxRounds: 12 };
