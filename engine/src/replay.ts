// 重播向量（R2 §8、§14.12；開工指令第七節；PvP AP-1–AP-3）。
import { hashOf } from './canon.ts';
import type { Content } from './content.ts';
import { act, InvalidAction, newBattle, runConfigOf, stateHash } from './engine.ts';
import type { Action, BattleConfig, BattleState } from './engine.ts';
import type { Policy } from './bots.ts';
import { streamState } from './prng.ts';
import type { Ev, Result } from './types.ts';
import { ENGINE_VERSION, SPEC_VERSION } from './version.ts';

export interface ReplayVector {
  engineVersion: string;
  specVersion: string;
  runConfig: Record<string, unknown>;
  config: BattleConfig;
  actions: Action[];
  expected: { perRoundStateHash: string[]; eventLogHash: string; result: Result | null; finalStateHash: string };
}

export interface RunOutput {
  state: BattleState;
  events: Ev[];
  actions: Action[];
  perRoundStateHash: string[];
}

export function runBattle(cfg: BattleConfig, policy: Policy, content: Content): RunOutput {
  const init = newBattle(cfg, content);
  let s = init.state;
  const events = [...init.events];
  const actions: Action[] = [];
  const perRound = [stateHash(s)];
  let rng = streamState(cfg.seed, 'bot');
  while (!s.result) {
    const d = policy(s, content, rng);
    rng = d.rng;
    const out = act(s, d.action, content);
    if (!out.legal) throw new Error(`bot 產生了非法切線：${JSON.stringify(d.action)}`);
    actions.push(d.action);
    events.push(...out.events);
    s = out.state;
    perRound.push(stateHash(s));
  }
  return { state: s, events, actions, perRoundStateHash: perRound };
}

export function toVector(cfg: BattleConfig, run: RunOutput, content: Content): ReplayVector {
  return {
    engineVersion: ENGINE_VERSION,
    specVersion: SPEC_VERSION,
    runConfig: runConfigOf(cfg, content),
    config: cfg,
    actions: run.actions,
    expected: {
      perRoundStateHash: run.perRoundStateHash,
      eventLogHash: hashOf(run.events),
      result: run.state.result,
      finalStateHash: stateHash(run.state),
    },
  };
}

export interface ReplayCheck {
  ok: boolean;
  firstStateMismatch: number | null;
  eventLogMatch: boolean;
  resultMatch: boolean;
  finalStateMatch?: boolean;
  reason?: string;
}

/** 以保存的指令重算（不呼叫 bot）；版本或執行設定不相容時明確拒絕。 */
export function replay(v: ReplayVector, content: Content): ReplayCheck {
  if (v.engineVersion !== ENGINE_VERSION || v.specVersion !== SPEC_VERSION) {
    return { ok: false, firstStateMismatch: null, eventLogMatch: false, resultMatch: false, finalStateMatch: false, reason: `版本不相容：${v.engineVersion}/${v.specVersion}` };
  }
  if (hashOf(runConfigOf(v.config, content)) !== hashOf(v.runConfig)) {
    return { ok: false, firstStateMismatch: null, eventLogMatch: false, resultMatch: false, finalStateMatch: false, reason: '執行設定或內容雜湊不符' };
  }
  const init = newBattle(v.config, content);
  let s = init.state;
  const events = [...init.events];
  const hashes = [stateHash(s)];
  for (const a of v.actions) {
    if (s.result) return { ok: false, firstStateMismatch: hashes.length, eventLogMatch: false, resultMatch: false, finalStateMatch: false, reason: '戰鬥已結束但還有指令' };
    let out: ReturnType<typeof act>;
    try {
      out = act(s, a, content);
    } catch (e) {
      if (e instanceof InvalidAction) return { ok: false, firstStateMismatch: hashes.length, eventLogMatch: false, resultMatch: false, finalStateMatch: false, reason: `拒絕指令：${e.message}` };
      throw e;
    }
    if (!out.legal) return { ok: false, firstStateMismatch: hashes.length, eventLogMatch: false, resultMatch: false, finalStateMatch: false, reason: `非法切線 ${JSON.stringify(a)}` };
    events.push(...out.events);
    s = out.state;
    hashes.push(stateHash(s));
  }
  let first: number | null = null;
  for (let k = 0; k < Math.max(hashes.length, v.expected.perRoundStateHash.length); k++) {
    if (hashes[k] !== v.expected.perRoundStateHash[k]) { first = k; break; }
  }
  const eventLogMatch = hashOf(events) === v.expected.eventLogHash;
  const resultMatch = s.result === v.expected.result;
  const finalStateMatch = stateHash(s) === v.expected.finalStateHash;
  return { ok: first === null && eventLogMatch && resultMatch && finalStateMatch, firstStateMismatch: first, eventLogMatch, resultMatch, finalStateMatch };
}
