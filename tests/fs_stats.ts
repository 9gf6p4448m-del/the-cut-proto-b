// duel v0.5「只回報、不當門檻」（DUEL_V05_SNAKE 只回報段）：30 個種子、AI（龍）對隨機腳本，玩家分別用龍和蛇：
// 勝負、平均切除數、平均被切數、穿刺平均連切數、戰鬥時長。不是平衡或好玩的證據。用法：node tests/fs_stats.ts
import { candidates, rand, step } from '../src/rtcut/rules.ts';
import type { Beast, GameState, Line } from '../src/rtcut/rules.ts';
import { BODY2, R3 } from '../src/cutbattle/duel3_board.ts';
import { battleSeed, fightersOf, matchFor, newCampaign } from '../src/cutbattle/campaign.ts';
import { simulateBattle } from '../src/cutbattle/battle.ts';

const FRONT = { unit: 60, max: 4 };
/** 隨機腳本：冷卻好之後隨機等 0～60 步，從藍方候選刀（同一個起刀區函式）隨機挑一條；在隨機的一步（120～900）按一次技能。 */
function playMatch(seed: number, beast: Beast): { winner: string; cutBy: number; cutOf: number; pierce: number | null; battleMs: number } {
  const c = newCampaign(seed, BODY2, R3, FRONT, { beast });
  let s: GameState = matchFor(c), r = (seed * 2654435761) >>> 0, wait = 0, u: number;
  [u, r] = rand(r); const skillAt = 120 + Math.floor(u * 780);
  let pierce: number | null = null;
  while (s.phase === 'cut') {
    let blue: Line | null = null;
    if (s.cdUntil.blue <= s.step) {
      if (wait <= 0) { [u, r] = rand(r); wait = Math.floor(u * 60); }
      else if (--wait === 0) { const cs = candidates(s, 'blue'); [u, r] = rand(r); blue = cs[Math.floor(u * cs.length)]; }
    }
    const out = step(s, { blue, skill: s.step === skillAt ? { blue: true } : undefined });
    for (const e of out.events) if (e.t === 'strike' && e.r.side === 'blue' && e.r.pierced) pierce = e.r.pierced.length;
    s = out.state;
  }
  const res = s.phase === 'ko' ? null : simulateBattle(fightersOf(s), battleSeed(c));
  return { winner: String(s.phase === 'ko' ? s.end?.winner ?? 'draw' : res!.winner), cutBy: s.severedN.blue, cutOf: s.severedN.red, pierce, battleMs: res ? res.endMs : 0 };
}
for (const beast of ['dragon', 'snake'] as Beast[]) {
  const rows = Array.from({ length: 30 }, (_, i) => playMatch(2000 + i, beast));
  const win: Record<string, number> = {}; for (const x of rows) win[x.winner] = (win[x.winner] ?? 0) + 1;
  const avg = (f: (x: typeof rows[number]) => number) => (rows.reduce((a, x) => a + f(x), 0) / rows.length).toFixed(2);
  const ps = rows.filter((x) => x.pierce !== null).map((x) => x.pierce!);
  const bt = rows.filter((x) => x.battleMs > 0).map((x) => x.battleMs);
  console.log(`[${beast === 'dragon' ? '玩家用龍' : '玩家用蛇'}] 30 場：勝負 ${JSON.stringify(win)}；平均切除 ${avg((x) => x.cutBy)}、平均被切 ${avg((x) => x.cutOf)}；`
    + (beast === 'snake' ? `穿刺有出刀的場次 ${ps.length}/30、平均連切 ${ps.length ? (ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(2) : '—'}；` : '')
    + `戰鬥時長（有進戰鬥的 ${bt.length} 場）平均 ${bt.length ? (bt.reduce((a, b) => a + b, 0) / bt.length / 1000).toFixed(1) : '—'} 秒`);
}
