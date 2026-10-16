// 以 B 軌相容層計算多個 seed 的開局與數刀後狀態雜湊（Codex 審查指出：只靠 golden 固定種子，相容層的 seed 字串處理壞掉仍可能全綠）。
import { act, legalLines, newBattle, setProtoBOrganPool, stateHash } from '../../engine/src/engine.ts';
import { loadContent } from '../../engine/src/content.ts';
export function seedHashes(cfgBase: any, seeds: number[], pool: 3 | 6): string[] {
  const content = loadContent();
  setProtoBOrganPool(pool);
  try {
    return seeds.map((seed) => {
      let s = newBattle({ ...cfgBase, seed }, content).state;
      const hs = [stateHash(s)];
      for (let k = 0; k < 3 && !s.result; k++) { const p = legalLines(s)[0]; if (!p) break; s = act(s, { round: s.round, actor: 'P', i: p.i, j: p.j }, content).state; hs.push(stateHash(s)); }
      return hs.join(',');
    });
  } finally { setProtoBOrganPool(6); }
}
(globalThis as any).__seedHashes = seedHashes;
