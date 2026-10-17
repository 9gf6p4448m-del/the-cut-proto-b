// 刀譜對決「只回報」統計（DUEL_BLADE_V01.md 只回報段）：貪婪＋0.5 秒延遲的探針對 AI，3 個對手各 N 場。
// 用法：node tests/duel_stats.ts [場數=100]。不是好玩的證據。
// 探針：冷卻好之後再等 0.5 秒（反應延遲），從藍方候選刀中選「當下傷害最高」的一條出刀；不縫合（每個對手獨立、以空槽開局）。
import { candidates, newMatch, resolveStrike, step, TUNE } from '../src/duel/rules.ts';
import type { Line, MatchState } from '../src/duel/rules.ts';

const DELAY = 30;
export function greedyLine(s: MatchState): Line | null {
  let best: { l: Line; v: number } | null = null;
  for (const l of candidates(s, 'blue')) { const r = resolveStrike(s, 'blue', l); if (r.ok && (!best || r.score.score > best.v)) best = { l, v: r.score.score }; }
  return best && best.v > 0 ? best.l : best?.l ?? null;
}
export function playProbe(seed: number, stage: number): MatchState {
  let s = newMatch(seed, stage);
  let readyAt = DELAY;
  for (let guard = 0; guard < TUNE.ROUND_STEPS * 3 && s.phase !== 'over'; guard++) {
    let blue: Line | null = null;
    if (s.step >= readyAt && s.cdUntil.blue <= s.step && (s.phase === 'sudden' || s.step < TUNE.ROUND_STEPS)) { blue = greedyLine(s); }
    const out = step(s, { blue });
    if (out.events.some((e) => e.t === 'strike' && e.r.side === 'blue')) readyAt = out.state.cdUntil.blue + DELAY;
    s = out.state;
  }
  return s;
}
if (process.argv[1]?.endsWith('duel_stats.ts')) {
  const N = Number(process.argv[2] ?? 100);
  for (let stage = 0; stage < TUNE.HP_ENEMY.length; stage++) {
    let win = 0, ko = 0, time = 0, sudden = 0, steps = 0, maxHit = 0, draw = 0;
    for (let seed = 1; seed <= N; seed++) {
      const s = playProbe(seed, stage), o = s.outcome!;
      if (o.winner === 'blue') win++; if (o.winner === 'draw') draw++;
      if (o.how === 'ko') ko++; else if (o.how === 'time') time++; else sudden++;
      steps += s.step; maxHit = Math.max(maxHit, s.bestHit);
    }
    console.log(`對手 ${stage + 1}（血 ${TUNE.HP_ENEMY[stage]}、d≤${(TUNE.AI_D[stage] / 60).toFixed(2)}s）${N} 場：探針勝率 ${(100 * win / N).toFixed(0)}%（平手 ${draw}），平均每場 ${(steps / N / 60).toFixed(1)} 秒，擊倒 ${(100 * ko / N).toFixed(0)}%、時間到 ${(100 * time / N).toFixed(0)}%、突然死亡 ${(100 * sudden / N).toFixed(0)}%，探針最高單刀傷害 ${maxHit}`);
  }
}
