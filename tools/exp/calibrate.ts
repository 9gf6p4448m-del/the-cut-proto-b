// 實驗 A 的 HP 校準。規格 A v1.2（§9）：GRD 勝率飽和（≈100%），v1 §5 的「GRD 勝率差 ≤5pp」恆真、無鑑別力，
// 改以 MAXPIERCE 為參考 bot，取 A 勝率與 BASELINE（hpE=30）最接近的怪物 HP（平手取小）→ `chosenV12`（bots／boards 預設採用）。
// 下方 GRD 表與 `chosen` 保留為 v1 判準（已棄用）的飽和證據。只調怪物 HP（整數 20～60）。
// 校準種子集 710001..710500（500 局）；與 bots.ts 的評估種子集 700001..700500 分開，避免對評估集過擬合。
// 選值規則（寫死、不看結果調整）：在 |勝率差| ≤ 0.05 的 HP 中取「勝率差絕對值最小」者；
// 平手（勝率飽和時常見）再取「平均回合數差絕對值最小」，再平手取較小 HP。
import { mkdirSync, writeFileSync } from 'node:fs';
import { runPool } from './pool.ts';
import { aggregate, outUrl } from './lib.ts';
import type { Agg, ModeKey } from './lib.ts';

export const CAL_SEEDS: [number, number] = [710001, 710500];
const HPS = Array.from({ length: 41 }, (_, k) => 20 + k);
const MODES: ('A1' | 'A2')[] = ['A1', 'A2'];

const tasks = [{ mode: 'BASELINE' as ModeKey, bot: 'GRD' as const, hpE: 30, seed0: CAL_SEEDS[0], seed1: CAL_SEEDS[1] }];
for (const m of MODES) for (const hp of HPS) tasks.push({ mode: m, bot: 'GRD', hpE: hp, seed0: CAL_SEEDS[0], seed1: CAL_SEEDS[1] });
const res = await runPool(tasks);
const base = aggregate('BASELINE', 'GRD', res[0]);
const table: Record<string, { hpE: number; agg: Agg; diffPP: number }[]> = { A1: [], A2: [] };
tasks.forEach((t, k) => {
  if (k === 0) return;
  const agg = aggregate(t.mode, 'GRD', res[k]);
  table[t.mode].push({ hpE: t.hpE, agg, diffPP: Math.round((agg.winRate - base.winRate) * 1e6) / 1e4 });
});
const chosen: Record<string, { hpE: number | null; ok: boolean; reason: string }> = {};
for (const m of MODES) {
  const ok = table[m].filter((r) => Math.abs(r.diffPP) <= 5);
  if (ok.length === 0) {
    const best = [...table[m]].sort((a, b) => Math.abs(a.diffPP) - Math.abs(b.diffPP) || a.hpE - b.hpE)[0];
    chosen[m] = { hpE: null, ok: false, reason: `20～60 內沒有勝率差 ≤5pp 的 HP；最接近 hpE=${best.hpE}（差 ${best.diffPP}pp）` };
    continue;
  }
  ok.sort((a, b) => Math.abs(a.diffPP) - Math.abs(b.diffPP)
    || Math.abs(a.agg.avgRounds - base.avgRounds) - Math.abs(b.agg.avgRounds - base.avgRounds) || a.hpE - b.hpE);
  chosen[m] = { hpE: ok[0].hpE, ok: true, reason: `${ok.length} 個 HP 落在 ±5pp 內（${ok[0].hpE === ok[ok.length - 1].hpE ? '' : '最小 ' + Math.min(...ok.map((r) => r.hpE)) + '～最大 ' + Math.max(...ok.map((r) => r.hpE))}）；依選值規則取 ${ok[0].hpE}` };
}
// 補充（非 §5 判準，只給製作人參考）：GRD 勝率飽和（≈100%）時 §5 的 ±5pp 無鑑別力，所以另以較弱的 bot 看 HP 敏感度。
const SUPP_BOTS = ['RND', 'MAXPIERCE', 'SAFE'] as const;
const supTasks = [] as { mode: ModeKey; bot: (typeof SUPP_BOTS)[number]; hpE: number; seed0: number; seed1: number }[];
for (const b of SUPP_BOTS) {
  supTasks.push({ mode: 'BASELINE', bot: b, hpE: 30, seed0: CAL_SEEDS[0], seed1: CAL_SEEDS[1] });
  for (const m of MODES) for (const hp of HPS) supTasks.push({ mode: m, bot: b, hpE: hp, seed0: CAL_SEEDS[0], seed1: CAL_SEEDS[1] });
}
const supRes = await runPool(supTasks);
const supplementary: Record<string, { baseline: { winRate: number; avgRounds: number; netPerRound: number }; A1: unknown[]; A2: unknown[]; closestWinRate: Record<string, number> }> = {};
supTasks.forEach((t, k) => {
  const a = aggregate(t.mode, t.bot, supRes[k]);
  const slim = { hpE: t.hpE, winRate: a.winRate, avgRounds: a.avgRounds, netPerRound: a.netPerRound };
  if (t.mode === 'BASELINE') supplementary[t.bot] = { baseline: slim, A1: [], A2: [], closestWinRate: {} };
  else supplementary[t.bot][t.mode].push(slim);
});
for (const b of SUPP_BOTS) for (const m of MODES) {
  const bw = supplementary[b].baseline.winRate;
  const rows = supplementary[b][m] as { hpE: number; winRate: number }[];
  supplementary[b].closestWinRate[m] = [...rows].sort((x, y) => Math.abs(x.winRate - bw) - Math.abs(y.winRate - bw) || x.hpE - y.hpE)[0].hpE;
}
// 規格 A v1.2 的現行值：MAXPIERCE 勝率最接近 BASELINE 的 HP
const chosenV12 = { ref: 'MAXPIERCE', A1: supplementary.MAXPIERCE.closestWinRate.A1, A2: supplementary.MAXPIERCE.closestWinRate.A2 };
mkdirSync(outUrl('.'), { recursive: true });
writeFileSync(outUrl('calibration.json'), JSON.stringify({ seeds: CAL_SEEDS, baselineGRD: base, table, chosen, chosenV12, supplementary }, null, 1) + '\n');
console.log('chosenV12（規格 A v1.2，現行）', JSON.stringify(chosenV12));
for (const b of SUPP_BOTS) console.log('supp', b, JSON.stringify(supplementary[b].baseline), JSON.stringify(supplementary[b].closestWinRate));
console.log('BASELINE GRD', base.winRate, base.avgRounds, base.netPerRound);
for (const m of MODES) {
  console.log(m, JSON.stringify(chosen[m]));
  console.log(table[m].map((r) => `${r.hpE}:${r.agg.winRate}`).join(' '));
}
