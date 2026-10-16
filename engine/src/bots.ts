// Gate 1 的基準 bot：RND、GRD（R2 §7；R3 §16.6 的平手規則：最後一律取 (i, j) 字典序最小）。
// bot 的亂數（`bot` 串流）屬於決策者，不屬於規則狀態，所以由呼叫端保管、不寫進 BattleState。
// LA2／LA3 等前瞻 bot 屬於 Gate 2。
import type { Content } from './content.ts';
import { act, legalLines } from './engine.ts';
import type { Action, BattleState } from './engine.ts';
import { Cursor } from './prng.ts';
import type { PrngState } from './prng.ts';

export type Policy = (s: BattleState, content: Content, rng: PrngState) => { action: Action; rng: PrngState };

export const RND: Policy = (s, _content, rng) => {
  const lines = legalLines(s);
  if (lines.length === 0) throw new Error('沒有合法切線');
  const c = new Cursor(rng);
  const p = lines[c.below(lines.length)];
  return { action: { round: s.round, actor: 'P', i: p.i, j: p.j }, rng: c.state };
};

/** GRD：能斬殺的線優先；否則最大化本回合玩家淨值（敵人 HP 損失 − 玩家 HP 損失）；平手取 (i, j) 最小。 */
export const GRD: Policy = (s, content, rng) => {
  const lines = legalLines(s);
  if (lines.length === 0) throw new Error('沒有合法切線');
  let best: { win: number; net: number; i: number; j: number } | null = null;
  for (const p of lines) {
    const out = act(s, { round: s.round, actor: 'P', i: p.i, j: p.j }, content);
    const win = out.state.result === 'WIN' ? 1 : 0;
    const net = (s.hp.E - out.state.hp.E) - (s.hp.P - out.state.hp.P);
    if (!best || win > best.win || (win === best.win && net > best.net)) best = { win, net, i: p.i, j: p.j };
  }
  return { action: { round: s.round, actor: 'P', i: best!.i, j: best!.j }, rng };
};
