// duel v0.4「只回報、不當門檻」（DUEL_V04_FRONT 只回報段）：30 個種子、AI（紅）對隨機腳本（藍），每場最大 |push| 分布、push 達上限的場次比例、
// 勝負分布（和 duel3 對照）、每場平均切除數。不是好玩的證據。用法：node tests/fv_stats.ts
import { candidates, rand, step } from '../src/rtcut/rules.ts';
import type { GameState, Line } from '../src/rtcut/rules.ts';
import { BODY2, R3 } from '../src/cutbattle/duel3_board.ts';
import { battleSeed, fightersOf, matchFor, newCampaign } from '../src/cutbattle/campaign.ts';
import { simulateBattle } from '../src/cutbattle/battle.ts';

const FRONT = { unit: 60, max: 4 };
/** 隨機腳本：冷卻好之後隨機等 0～60 步，從藍方候選刀（同一個起刀區函式）隨機挑一條。 */
function playMatch(seed: number, front: boolean): { maxAbs: number; hitCap: boolean; severs: { blue: number; red: number }; winner: string; endPush: number } {
  const c = newCampaign(seed, BODY2, R3, front ? FRONT : undefined);
  let s: GameState = matchFor(c), r = (seed * 2654435761) >>> 0, wait = 0, maxAbs = 0;
  while (s.phase === 'cut') {
    let blue: Line | null = null;
    if (s.cdUntil.blue <= s.step) {
      if (wait <= 0) { let u: number; [u, r] = rand(r); wait = Math.floor(u * 60); }
      else if (--wait === 0) { const cs = candidates(s, 'blue'); let u: number; [u, r] = rand(r); blue = cs[Math.floor(u * cs.length)]; }
    }
    s = step(s, { blue }).state;
    maxAbs = Math.max(maxAbs, Math.abs(s.push ?? 0));
  }
  const winner = s.phase === 'ko' ? (s.end?.winner ?? 'draw') : simulateBattle(fightersOf(s), battleSeed(c)).winner;
  return { maxAbs, hitCap: maxAbs >= FRONT.max, severs: { ...s.severedN }, winner: String(winner), endPush: s.push ?? 0 };
}
for (const front of [false, true]) {
  const rows = Array.from({ length: 30 }, (_, i) => playMatch(1000 + i, front));
  const dist: Record<number, number> = {}; for (const x of rows) dist[x.maxAbs] = (dist[x.maxAbs] ?? 0) + 1;
  const win: Record<string, number> = {}; for (const x of rows) win[x.winner] = (win[x.winner] ?? 0) + 1;
  const avg = (f: (x: typeof rows[number]) => number) => (rows.reduce((a, x) => a + f(x), 0) / rows.length).toFixed(2);
  console.log(`[${front ? 'duel4 前線推進' : 'duel3 對照'}] 30 場：勝負 ${JSON.stringify(win)}；每場平均切除 玩家 ${avg((x) => x.severs.blue)}、AI ${avg((x) => x.severs.red)}`
    + (front ? `；每場最大 |push| 分布 ${JSON.stringify(dist)}；達上限 ±4 的場次 ${rows.filter((x) => x.hitCap).length}/30；結束時 push 平均 ${avg((x) => x.endPush)}` : ''));
}
