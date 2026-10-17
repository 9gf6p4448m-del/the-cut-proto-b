// 刀譜「只回報」統計（BLADE_HAND_SKETCH.md 只回報段）：100 個種子、貪婪 bot，每隻怪的達標率與平均最高單刀分數。
// 用法：node tests/blade_stats.ts [種子數=100]。不是好玩的證據，只用來看門檻是否合理。
// 貪婪 bot：每刀選候選刀線中分數最高者；若最高分 < 剩餘門檻/剩餘刀數 的一半且還有抽搐，先抽搐（最多把抽搐用完）；縫合挑第一個選項、放第一個空槽（滿了換第 0 槽）。
import { applyCut, bestLine, chooseStitch, newRun, twitch, TUNE } from '../src/blade/rules.ts';
import type { RunState } from '../src/blade/rules.ts';

export function greedyRun(seed: number): { reached: number; bests: number[]; state: RunState } {
  let s = newRun(seed);
  const bests = TUNE.THRESHOLDS.map(() => 0);
  for (let guard = 0; guard < 200 && (s.phase === 'aim' || s.phase === 'stitch'); guard++) {
    if (s.phase === 'stitch') { s = chooseStitch(s, s.offer[0], s.slots.includes(null) ? undefined : 0); continue; }
    let b = bestLine(s, 'score');
    while (b && s.twitchesLeft > 0 && b.score < (s.threshold - s.monsterScore) / s.cutsLeft / 2) { s = twitch(s); b = bestLine(s, 'score'); }
    if (!b) break;
    const m = s.monster;
    const r = applyCut(s, b.a, b.b);
    if (!r.record) break;
    bests[m] = Math.max(bests[m], r.record.score.score);
    s = r.state;
  }
  const reached = s.phase === 'won' ? TUNE.THRESHOLDS.length : s.monster;
  return { reached, bests, state: s };
}

if (process.argv[1]?.endsWith('blade_stats.ts')) {
  const N = Number(process.argv[2] ?? 100);
  const pass = TUNE.THRESHOLDS.map(() => 0), bestSum = TUNE.THRESHOLDS.map(() => 0), met = TUNE.THRESHOLDS.map(() => 0);
  for (let seed = 1; seed <= N; seed++) {
    const r = greedyRun(seed);
    TUNE.THRESHOLDS.forEach((_, i) => { if (r.reached > i) pass[i]++; if (r.reached >= i) { met[i]++; bestSum[i] += r.bests[i]; } });
  }
  console.log(`seeds=${N} thresholds=${TUNE.THRESHOLDS.join('/')}`);
  TUNE.THRESHOLDS.forEach((t, i) => console.log(`monster${i + 1} 門檻${t}：遇到 ${met[i]} 局，達標 ${pass[i]}（${met[i] ? Math.round((100 * pass[i]) / met[i]) : 0}% 條件達標率；全體 ${Math.round((100 * pass[i]) / N)}%），平均最高單刀 ${met[i] ? (bestSum[i] / met[i]).toFixed(1) : '—'}`));
  console.log(`整局勝率 ${Math.round((100 * pass[TUNE.THRESHOLDS.length - 1]) / N)}%`);
}
