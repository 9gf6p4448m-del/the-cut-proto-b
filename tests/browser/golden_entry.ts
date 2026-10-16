// 瀏覽器（與 Node 打包版）共用：以 B 軌相容層重播 golden 200 筆（凍結驗收 T-2）。
import { sha256 } from '../../engine/src/canon.ts';
import { loadContent } from '../../engine/src/content.ts';
import { replay } from '../../engine/src/replay.ts';
import type { ReplayVector } from '../../engine/src/replay.ts';

export function runGolden(text: string) {
  const fileSha256 = sha256(text);
  const vectors = JSON.parse(text) as ReplayVector[];
  const content = loadContent();
  let ok = 0; const bad: string[] = [];
  for (const v of vectors) { const r = replay(v, content); if (r.ok) ok++; else bad.push(`${v.config?.seed}/${v.config?.rules?.ph}`); }
  return { ok, total: vectors.length, bad: bad.slice(0, 5), fileSha256 };
}
(globalThis as any).__runGolden = runGolden;
