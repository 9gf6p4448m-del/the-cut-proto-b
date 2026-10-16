// X-9 策略反證：bot × 模式 × 500 個固定種子（評估種子集 700001..700500）打到戰鬥結束。
// 實驗 A 同時跑未校準（hpE=30）與校準後（calibration.json 的 chosen）兩組。輸出 results/bots.json。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runPool } from './pool.ts';
import type { Task } from './pool.ts';
import { aggregate, mcnemarExact, outUrl } from './lib.ts';
import type { Agg, BotName, GameRec, ModeKey } from './lib.ts';

export const EVAL_SEEDS: [number, number] = [700001, 700500];
const cal = JSON.parse(readFileSync(outUrl('calibration.json'), 'utf8')) as { chosen: Record<string, { hpE: number | null }> };

interface Cell { key: string; mode: ModeKey; bot: BotName; hpE: number; calibrated: boolean }
const cells: Cell[] = [];
const add = (mode: ModeKey, hpE: number, calibrated: boolean, bots: BotName[]): void => { for (const bot of bots) cells.push({ key: `${mode}|hpE${hpE}|${bot}`, mode, bot, hpE, calibrated }); };
const COMMON: BotName[] = ['RND', 'GRD', 'MAXPIERCE', 'SAFE', 'LOOK2'];
add('BASELINE', 30, false, COMMON);
for (const m of ['A1', 'A2'] as const) {
  add(m, 30, false, [...COMMON, 'BAIT']);
  // 規格 A v1.2：--hp=A1:30,A2:39 覆寫 calibration.json（GRD 飽和，改以 MAXPIERCE 對齊）
  const hpArg = process.argv.find((x) => x.startsWith('--hp='));
  const ov = hpArg ? Object.fromEntries(hpArg.slice(5).split(',').map((kv) => kv.split(':'))) as Record<string, string> : {};
  const h = ov[m] !== undefined ? Number(ov[m]) : cal.chosen[m].hpE;
  if (h !== null && h !== 30) add(m, h, true, [...COMMON, 'BAIT']);
}
add('B', 30, false, [...COMMON, 'LOOK2NK', 'KEEPHOLD']);

const tasks: Task[] = cells.map((c) => ({ mode: c.mode, bot: c.bot, hpE: c.hpE, seed0: EVAL_SEEDS[0], seed1: EVAL_SEEDS[1] }));
const t0 = Date.now();
const res = await runPool(tasks);

const out: Record<string, { mode: ModeKey; bot: BotName; hpE: number; calibrated: boolean; agg: Agg; perSeed: number[][] }> = {};
cells.forEach((c, k) => {
  out[c.key] = {
    mode: c.mode, bot: c.bot, hpE: c.hpE, calibrated: c.calibrated, agg: aggregate(c.mode, c.bot, res[k]),
    // [seed, 勝(1/0), 回合數, 總淨收益, 我方總損血]
    perSeed: res[k].map((g: GameRec) => [g.seed, g.result === 'WIN' ? 1 : 0, g.rounds, g.net, g.myLoss]),
  };
});

// ---- 配對檢定（同一組種子、同模式同 hpE）
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
function paired(a: string, b: string): { winsA: number; winsB: number; onlyA: number; onlyB: number; pExact: number; dRounds: [number, number]; dMyLoss: [number, number]; dNet: [number, number] } {
  const A = out[a].perSeed, B = out[b].perSeed;
  let onlyA = 0, onlyB = 0;
  const dr: number[] = [], dl: number[] = [], dn: number[] = [];
  for (let k = 0; k < A.length; k++) {
    if (A[k][0] !== B[k][0]) throw new Error('種子不對齊');
    if (A[k][1] === 1 && B[k][1] === 0) onlyA++;
    if (A[k][1] === 0 && B[k][1] === 1) onlyB++;
    dr.push(A[k][2] - B[k][2]); dl.push(A[k][4] - B[k][4]); dn.push(A[k][3] / A[k][2] - B[k][3] / B[k][2]);
  }
  const ci = (xs: number[]): [number, number] => {
    const m = mean(xs), v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    const h = 1.96 * Math.sqrt(v / xs.length);
    return [Math.round(m * 1e4) / 1e4, Math.round(h * 1e4) / 1e4]; // [平均差, 95% 半寬]
  };
  return { winsA: out[a].agg.wins, winsB: out[b].agg.wins, onlyA, onlyB, pExact: Math.round(mcnemarExact(onlyA, onlyB) * 1e6) / 1e6, dRounds: ci(dr), dMyLoss: ci(dl), dNet: ci(dn) };
}
const analysis: Record<string, unknown> = {};
// 固定誘餌：A 各 (模式, hpE) 下 BAIT 對其他每個 bot
for (const m of ['A1', 'A2']) {
  for (const hp of [...new Set(cells.filter((c) => c.mode === m).map((c) => c.hpE))]) {
    const bait = `${m}|hpE${hp}|BAIT`;
    const row: Record<string, unknown> = {};
    for (const b of [...COMMON]) row[`BAIT_vs_${b}`] = paired(bait, `${m}|hpE${hp}|${b}`);
    analysis[`${m}|hpE${hp}`] = row;
  }
}
// B：LOOK2 對 GRD
analysis['B|LOOK2_vs_GRD'] = paired('B|hpE30|LOOK2', 'B|hpE30|GRD');
analysis['B|LOOK2_vs_LOOK2NK'] = paired('B|hpE30|LOOK2', 'B|hpE30|LOOK2NK');
analysis['BASELINE|LOOK2_vs_GRD'] = paired('BASELINE|hpE30|LOOK2', 'BASELINE|hpE30|GRD');
// 校準檢查：評估集上 GRD 的 A 與 BASELINE 勝率差（pp）
const calCheck: Record<string, number> = {};
for (const c of cells) if (c.bot === 'GRD' && c.mode !== 'BASELINE') calCheck[c.key] = Math.round((out[c.key].agg.winRate - out['BASELINE|hpE30|GRD'].agg.winRate) * 1e6) / 1e4;
analysis['GRD_vs_BASELINE_pp_on_eval_seeds'] = calCheck;

mkdirSync(outUrl('.'), { recursive: true });
writeFileSync(outUrl('bots.json'), JSON.stringify({ seeds: EVAL_SEEDS, cells: out, analysis }, null, 1) + '\n');
console.error(`bots.ts 完成：${cells.length} 格 × ${EVAL_SEEDS[1] - EVAL_SEEDS[0] + 1} 局，${Math.round((Date.now() - t0) / 1000)} 秒`);
for (const c of cells) { const a = out[c.key].agg; console.log(c.key.padEnd(24), a.winRate, a.avgRounds, a.netPerRound, a.invalid); }
