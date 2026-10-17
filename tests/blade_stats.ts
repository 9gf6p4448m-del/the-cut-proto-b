// 刀譜難度統計（只回報，不當門檻）：v0.2 BV-05＝兩種 bot 各 N 局，每隻怪的達標率與平均被打中數；BV-02＝預告爪落在當下最高分線上的比例。
// 用法：node tests/blade_stats.ts [局數=200]。數字來自 bot，不是好玩的證據。
// - greedy（忽略反擊）：每刀選候選刀線中分數最高者。
// - aware（反擊感知）：每刀選「分數 − 預估反擊代價」最高者；代價：沒被取消的每條反擊，以本隻原門檻的 15% 計（逆鱗在身 5%）；會擊倒的刀代價為 0。
// 兩者共同：最高分 < 剩餘門檻/剩餘刀數 的一半且還有抽搐 → 先抽搐；縫合挑第一個選項、放第一個空槽（滿了換第 0 槽）。
import { applyCut, bestLine, candidateLines, chooseStitch, evaluate, has, newRun, startMonster, twitch, TUNE } from '../src/blade/rules.ts';
import type { RunState, V } from '../src/blade/rules.ts';

type Bot = 'greedy' | 'aware';
function pick(s: RunState, bot: Bot): { a: V; b: V; score: number } | null {
  if (bot === 'greedy') return bestLine(s, 'score');
  const per = s.baseThreshold * (has(s.slots, 'scale') ? TUNE.HIT_SCALE : TUNE.HIT_EMPTY);
  let best: { a: V; b: V; score: number; u: number } | null = null;
  for (const [a, b] of candidateLines(s.organs, s.slots)) {
    const e = evaluate(s, a, b); if (!e.path.ok) continue;
    const kills = s.monsterScore + e.score.score >= s.threshold;
    const missed = kills ? 0 : s.counters.filter((c) => !e.path.severed.includes(c.clawId)).length;
    const u = e.score.score - missed * per;
    if (!best || u > best.u) best = { a, b, score: e.score.score, u };
  }
  return best;
}
export function playRun(seed: number, bot: Bot): { reached: number; hitsPer: number[]; met: boolean[]; state: RunState } {
  let s = newRun(seed);
  const n = TUNE.THRESHOLDS.length, hitsPer = Array(n).fill(0), met = Array(n).fill(false);
  met[0] = true;
  for (let guard = 0; guard < 400 && (s.phase === 'aim' || s.phase === 'stitch'); guard++) {
    if (s.phase === 'stitch') { s = chooseStitch(s, s.offer[0], s.slots.includes(null) ? undefined : 0); met[s.monster] = true; continue; }
    let b = pick(s, bot);
    while (b && s.twitchesLeft > 0 && b.score < (s.threshold - s.monsterScore) / s.cutsLeft / 2) { s = twitch(s); b = pick(s, bot); }
    if (!b) break;
    const m = s.monster, r = applyCut(s, b.a, b.b);
    if (!r.record) break;
    hitsPer[m] += r.record.counterResults.filter((x) => x !== 'cancelled').length;
    s = r.state;
  }
  return { reached: s.phase === 'won' ? n : s.monster, hitsPer, met, state: s };
}
/** BV-02：每個種子的每隻怪（以前面的縫合為空的開局狀態），第一刀前的預告是否全部落在當下最高分線上。 */
export function counterOnBestRate(seeds: number): { rate: number; perMonster: number[]; n: number } {
  let hit = 0, n = 0; const per = TUNE.THRESHOLDS.map(() => 0);
  for (let seed = 1; seed <= seeds; seed++) for (let m = 0; m < TUNE.THRESHOLDS.length; m++) {
    const s = startMonster(newRun(seed), m);
    const b = bestLine(s, 'score')!;
    const sev = evaluate(s, b.a, b.b).path.severed;
    const all = s.counters.length > 0 && s.counters.every((c) => sev.includes(c.clawId));
    n++; if (all) { hit++; per[m]++; }
  }
  return { rate: hit / n, perMonster: per.map((x) => x / seeds), n };
}

if (process.argv[1]?.endsWith('blade_stats.ts')) {
  const N = Number(process.argv[2] ?? 200);
  const c = counterOnBestRate(N);
  console.log(`BV-02 預告爪全部落在當下最高分線上：${(100 * c.rate).toFixed(1)}%（${c.n} 個開局；各隻 ${c.perMonster.map((x) => (100 * x).toFixed(1) + '%').join('／')}）`);
  for (const bot of ['greedy', 'aware'] as Bot[]) {
    const n = TUNE.THRESHOLDS.length, pass = Array(n).fill(0), met = Array(n).fill(0), hits = Array(n).fill(0);
    for (let seed = 1; seed <= N; seed++) {
      const r = playRun(seed, bot);
      for (let i = 0; i < n; i++) if (r.met[i]) { met[i]++; hits[i] += r.hitsPer[i]; if (r.reached > i) pass[i]++; }
    }
    console.log(`[${bot}] ${N} 局，門檻 ${TUNE.THRESHOLDS.join('/')}：`);
    for (let i = 0; i < n; i++) console.log(`  第 ${i + 1} 隻：遇到 ${met[i]}，達標 ${pass[i]}（條件達標率 ${met[i] ? ((100 * pass[i]) / met[i]).toFixed(1) : '—'}%；全體 ${((100 * pass[i]) / N).toFixed(1)}%），平均被打中 ${met[i] ? (hits[i] / met[i]).toFixed(2) : '—'} 次`);
    console.log(`  整局勝率 ${((100 * pass[n - 1]) / N).toFixed(1)}%`);
  }
}
