// FUN-EXP-01（X-4）：三模式以固定種子的隨機合法刀（B 模式含隨機留傷口）打到戰鬥結束，傳回逐回合「狀態＋事件」雜湊。
// Node 原生、相容層打包版（與下一階段的 Chromium／WebKit）共用同一份程式，比對逐回合雜湊。
import { hashOf } from '../../engine/src/canon.ts';
import { loadContent } from '../../engine/src/content.ts';
import { act, legalLines, newBattle, stateHash } from '../../engine/src/engine.ts';
import type { Action, BattleConfig } from '../../engine/src/engine.ts';
import { keepWoundCheck } from '../../engine/src/experiment.ts';
import { Cursor, streamState } from '../../engine/src/prng.ts';
import type { Result } from '../../engine/src/types.ts';

const BASE = { model: 'A', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'BUT', w10: 7 }, hpP: 40, hpE: 30, r: 160, anchorCount: 12, maxRounds: 12 } as const;

export type ExpModeKey = 'BASELINE' | 'A1' | 'A2' | 'B';
export function expConfig(mode: ExpModeKey, seed: number): BattleConfig {
  const b = structuredClone(BASE) as unknown as BattleConfig;
  if (mode === 'A1') return { ...b, seed, enemy: { kind: 'OBS_HEART', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'A2') return { ...b, seed, enemy: { kind: 'OBS_AREA', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'B') return { ...b, seed, exp: { mode: 'B' } };
  return { ...b, seed };
}

export interface RandomRun { actions: Action[]; perRound: string[]; result: Result | null; rounds: number; keeps: number }

/** 隨機合法刀（`x4` 串流，與規則狀態分開）；B 模式在可勾時以 1/2 機率留傷口。 */
export function playRandom(cfg: BattleConfig): RandomRun {
  const content = loadContent();
  const init = newBattle(cfg, content);
  let s = init.state;
  const perRound = [stateHash(s) + ':' + hashOf(init.events)];
  const actions: Action[] = [];
  const c = new Cursor(streamState(cfg.seed, 'x4'));
  let keeps = 0;
  while (!s.result) {
    const lines = legalLines(s);
    const p = lines[c.below(lines.length)];
    const a: Action = { round: s.round, actor: 'P', i: p.i, j: p.j };
    if (cfg.exp?.mode === 'B' && keepWoundCheck(s, p).ok && c.below(2) === 1) { a.keepWound = true; keeps++; }
    const out = act(s, a, content);
    actions.push(a);
    s = out.state;
    perRound.push(stateHash(s) + ':' + hashOf(out.events));
  }
  return { actions, perRound, result: s.result, rounds: s.round, keeps };
}

export function expHashes(modes: ExpModeKey[], seeds: number[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of modes) out[m] = seeds.map((seed) => playRandom(expConfig(m, seed)).perRound.join(','));
  return out;
}
(globalThis as any).__expHashes = expHashes;
