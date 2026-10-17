// 切割→戰鬥「只回報」統計（CUT_BATTLE_V01.md 只回報段）：貪婪＋0.5 秒延遲探針對 AI，3 個對手各 N 場。
// 用法：node tests/cb_stats.ts [場數=100]。數字來自 bot，不是好玩的證據。
// 探針：冷卻好後再等 0.5 秒，從藍方候選刀中選「切掉的對方器官價值最高」的一條（價值同 AI：爪 2、心 4、眼 3、毒 3、骨 2）；不縫合（各對手以基礎 9 個器官開局）。
import { candidates, resolveStrike, step, VALUE } from '../src/rtcut/rules.ts';
import type { GameState, Kind, Line } from '../src/rtcut/rules.ts';
import { simulateBattle } from '../src/cutbattle/battle.ts';
import type { BattleResult } from '../src/cutbattle/battle.ts';
import { battleSeed, fightersOf, matchFor, newCampaign } from '../src/cutbattle/campaign.ts';
import type { Campaign } from '../src/cutbattle/campaign.ts';

export function greedyLine(s: GameState): Line | null {
  let best: { l: Line; v: number } | null = null;
  for (const l of candidates(s, 'blue')) {
    const r = resolveStrike(s, 'blue', l); if (!r.ok) continue;
    const v = (r.severed !== null ? VALUE[s.organs[r.severed].kind] * 10 : 0) + r.locks.length;
    if (!best || v > best.v) best = { l, v };
  }
  return best && best.v > 0 ? best.l : null;
}
/** 打一場切割期（delay＝冷卻後的反應延遲步數），回傳結束狀態與我切下的種類。 */
export function playCut(c: Campaign, delay: number): { end: GameState; cut: Kind[] } {
  let s = matchFor(c), readyAt = delay; const cut: Kind[] = [];
  while (s.phase === 'cut') {
    let blue: Line | null = null;
    if (s.step >= readyAt && s.cdUntil.blue <= s.step) blue = greedyLine(s);
    const out = step(s, { blue });
    for (const e of out.events) if (e.t === 'strike' && e.r.side === 'blue') { readyAt = out.state.cdUntil.blue + delay; if (e.r.severed !== null) cut.push(s.organs[e.r.severed].kind); }
    if (blue && !out.events.some((e) => e.t === 'strike' && e.r.side === 'blue')) readyAt = s.step + 30;
    s = out.state;
  }
  return { end: s, cut };
}
export function playStage(c: Campaign, delay: number): { battle: BattleResult; end: GameState; cut: Kind[] } {
  const { end, cut } = playCut(c, delay);
  return { battle: simulateBattle(fightersOf(end), battleSeed(c)), end, cut };
}
if (process.argv[1]?.endsWith('cb_stats.ts')) {
  const N = Number(process.argv[2] ?? 100);
  const kinds: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
  for (let stage = 0; stage < 3; stage++) {
    let win = 0, draw = 0, ms = 0, ko = 0;
    const dmg: Record<Kind, number> = { claw: 0, heart: 0, eye: 0, poison: 0, bone: 0 };
    let heal = 0, blocked = 0, critBonus = 0;
    for (let seed = 1; seed <= N; seed++) {
      const { battle } = playStage({ ...newCampaign(seed), stage }, 30);
      if (battle.winner === 'blue') win++; if (battle.winner === 'draw') draw++; if (battle.how === 'ko' || battle.how === 'empty') ko++;
      ms += battle.endMs;
      for (const k of kinds) dmg[k] += battle.contrib.blue.damage[k];
      heal += battle.contrib.blue.heal; blocked += battle.contrib.blue.blocked; critBonus += battle.contrib.blue.critBonus;
    }
    const tot = dmg.claw + dmg.poison;
    console.log(`對手 ${stage + 1}：${N} 場，探針勝率 ${(100 * win / N).toFixed(0)}%，平手 ${(100 * draw / N).toFixed(0)}%，戰鬥平均 ${(ms / N / 1000).toFixed(1)} 秒（擊倒／空方 ${(100 * ko / N).toFixed(0)}%）`);
    console.log(`  我方傷害占比：爪 ${(100 * dmg.claw / tot).toFixed(0)}%（其中眼的暴擊加成 ${(100 * critBonus / tot).toFixed(0)}%）、毒 ${(100 * dmg.poison / tot).toFixed(0)}%；每場平均 心補血 ${(heal / N).toFixed(1)}、骨擋下 ${(blocked / N).toFixed(1)}、總傷害 ${(tot / N).toFixed(1)}`);
  }
}
