// 單回合結算（R2-SPEC §4.2、§5.3、§14.2；R3-SPEC §5.1–§5.3、§16.9）。
// 輸入是「已經分好側的器官」，所以可以不經幾何直接用邊界案例的 fixture 測試。
import type { Content } from './content.ts';
import { choose, preference, scoreU, w10Of } from './enemy.ts';
import { KIND_ORDER } from './types.ts';
import { obsFactsOf } from './experiment.ts'; // FUN-EXP-01 掛鉤 X-R1
import type { DmgKind, EnemyConfig, Ev, Organ, Result, Rules, Side, SideFacts, Who } from './types.ts';

export const EFFECT_CAP = 64;

export interface RoundInput {
  hp: { P: number; E: number };
  maxHp: { P: number; E: number };
  pierced: Organ[];
  L: Organ[];
  R: Organ[];
  area2: { L: number; R: number };
  fixedSide: Side;
  rules: Rules;
  enemy: EnemyConfig;
  content: Content;
  nextId: number;
  forcedChoice?: Side;
  /** 本回合在結算前已發生的效果事件數（回合開始時生成的小再生腺 SPAWN，R3 §16.9；Codex G1-R1 #2） */
  effectBase?: number;
}

export interface RoundOutput {
  events: Ev[];
  hp: { P: number; E: number };
  choice: Side | null;
  result: Result | null;
  sd1: boolean;
  /** 下一回合要生成的小再生腺數量（每顆被刺穿的再生腺各一顆；Codex G1-R1 #1） */
  seedlings: number;
  nextId: number;
  /** 玩家實際取得那側的器官（資源帳本用；結算後離開盤面） */
  playerSide: Organ[];
  enemySide: Organ[];
}

class CapExceeded extends Error {}

const opp = (w: Who): Who => (w === 'P' ? 'E' : 'P');
const whoOrder = (w: Who): number => (w === 'P' ? 0 : 1);

interface DmgSpec { src: Who; dst: Who; kind: DmgKind; raw: number; organ: number }
interface GainSpec { t: 'SHIELD' | 'HEAL'; who: Who; n: number; organ: number }

function reflectable(kind: DmgKind, sem: Rules['sem']): boolean {
  if (kind === 'INC_DIRECT' || kind === 'HARV_DIRECT' || kind === 'CORE') return true;
  if (kind === 'INC_POISON') return sem === 'SEM-1';
  return false;
}

export function resolveRound(inp: RoundInput): RoundOutput {
  const events: Ev[] = [];
  let effectCount = inp.effectBase ?? 0;
  const emit = (e: Ev, effect: boolean): void => {
    if (effect) {
      effectCount += 1;
      if (effectCount > EFFECT_CAP) throw new CapExceeded();
    }
    events.push(e);
  };
  const hp = { P: inp.hp.P, E: inp.hp.E };
  const shield = { P: 0, E: 0 };
  let nextId = inp.nextId;
  const L = [...inp.L], R = [...inp.R];
  const pierced = [...inp.pierced].sort((a, b) => a.id - b.id);
  let seedlings = 0;
  let result: Result | null = null;
  let sd1 = false;
  let choice: Side | null = null;
  const mirrorActive = { P: false, E: false };
  const def = (o: Organ) => inp.content.byKey[o.key];

  const finish = (): RoundOutput => {
    const playerSide = choice === null ? [] : choice === 'L' ? R : L;
    const enemySide = choice === null ? [] : choice === 'L' ? L : R;
    return { events, hp, choice, result, sd1, seedlings, nextId, playerSide, enemySide };
  };

  const deathCheck = (): boolean => {
    const pDead = hp.P <= 0, eDead = hp.E <= 0;
    emit({ t: 'DC', pDead, eDead }, false);
    if (pDead || eDead) {
      result = pDead ? 'LOSS' : 'WIN';
      sd1 = pDead && eDead;
      emit({ t: 'END', result, sd1 }, false);
      return true;
    }
    return false;
  };

  const applyDmg = (d: DmgSpec, reflRaw: { P: number; E: number }): void => {
    const abs = Math.min(shield[d.dst], d.raw);
    shield[d.dst] -= abs;
    const loss = Math.min(d.raw - abs, hp[d.dst]);
    hp[d.dst] -= loss;
    if (mirrorActive[d.dst] && reflectable(d.kind, inp.rules.sem)) reflRaw[d.dst] += d.raw;
    emit({ t: 'DMG', src: d.src, dst: d.dst, kind: d.kind, raw: d.raw, abs, loss, organ: d.organ }, true);
  };

  const sortDmg = (a: DmgSpec, b: DmgSpec): number =>
    whoOrder(a.dst) - whoOrder(b.dst) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.organ - b.organ;
  const sortGain = (a: GainSpec, b: GainSpec): number => whoOrder(a.who) - whoOrder(b.who) || a.organ - b.organ;

  const applyGain = (g: GainSpec): void => {
    if (g.t === 'SHIELD') {
      shield[g.who] += g.n;
      emit({ t: 'SHIELD', who: g.who, n: g.n, organ: g.organ }, true);
    } else {
      const actual = Math.min(g.n, inp.maxHp[g.who] - hp[g.who]);
      hp[g.who] += actual;
      emit({ t: 'HEAL', who: g.who, raw: g.n, actual, organ: g.organ }, true);
    }
  };

  /** 一個步驟：盾與治療 → 傷害 → 反射 → 死亡判定（HS-2：治療移到死亡判定之後）。傳回是否結束。 */
  const runStep = (name: 'INCISION' | 'HARVEST' | 'ALL' | 'PLAYER' | 'ENEMY', gains: GainSpec[], dmgs: DmgSpec[], mirrors: { P: number; E: number }): boolean => {
    emit({ t: 'STEP', name }, false);
    const g = [...gains].sort(sortGain);
    const early = inp.rules.hs === 'HS-1' ? g : g.filter((x) => x.t === 'SHIELD');
    const late = inp.rules.hs === 'HS-1' ? [] : g.filter((x) => x.t === 'HEAL');
    for (const x of early) applyGain(x);
    const reflRaw = { P: 0, E: 0 };
    for (const d of [...dmgs].sort(sortDmg)) applyDmg(d, reflRaw);
    const reflDmg: DmgSpec[] = [];
    for (const w of ['P', 'E'] as Who[]) {
      if (!mirrorActive[w] || mirrors[w] === 0) continue;
      const pct = Math.min(100, 50 * mirrors[w]);
      const amount = Math.floor((reflRaw[w] * pct) / 100);
      emit({ t: 'REFL', who: w, base: reflRaw[w], pct, amount }, true);
      if (amount > 0) reflDmg.push({ src: w, dst: opp(w), kind: 'REFLECT', raw: amount, organ: -1 });
    }
    const dummy = { P: 0, E: 0 };
    for (const d of reflDmg.sort(sortDmg)) applyDmg(d, dummy);
    if (deathCheck()) return true;
    for (const x of late) applyGain(x);
    return false;
  };

  try {
    // ---- Incision 的無數值效果（選邊前可見；PH-A 也在選邊前生成核心） ----
    const incGains: GainSpec[] = [];
    const incDmgs: DmgSpec[] = [];
    const nonNumeric: Ev[] = [];
    for (const o of pierced) emit({ t: 'PIERCE', id: o.id }, false);
    for (const o of pierced) {
      const inc = def(o).incision;
      if (!inc) continue;
      if (inc.damage) incDmgs.push({ src: 'P', dst: 'E', kind: 'INC_DIRECT', raw: inc.damage, organ: o.id });
      if (inc.shield) incGains.push({ t: 'SHIELD', who: 'P', n: inc.shield, organ: o.id });
      if (inc.bothDamage) {
        incDmgs.push({ src: 'P', dst: 'P', kind: 'INC_POISON_SELF', raw: inc.bothDamage, organ: o.id });
        incDmgs.push({ src: 'P', dst: 'E', kind: 'INC_POISON', raw: inc.bothDamage, organ: o.id });
      }
      if (inc.spawnCores) {
        nonNumeric.push({ t: 'INC', id: o.id, effect: 'SPAWN_CORES' });
        const cl: Organ = { id: nextId++, key: 'core', x: 0, y: 0 };
        const cr: Organ = { id: nextId++, key: 'core', x: 0, y: 0 };
        L.push(cl);
        R.push(cr);
        nonNumeric.push({ t: 'SPAWN', id: cl.id, key: 'core', x: 0, y: 0, src: 'CORE', side: 'L' });
        nonNumeric.push({ t: 'SPAWN', id: cr.id, key: 'core', x: 0, y: 0, src: 'CORE', side: 'R' });
      }
      if (inc.scheduleSeedling) { nonNumeric.push({ t: 'INC', id: o.id, effect: 'SCHEDULE_SEEDLING' }); seedlings += 1; }
      if (inc.destroy) nonNumeric.push({ t: 'INC', id: o.id, effect: 'DESTROY' });
    }
    const ph = inp.rules.ph;
    const separateIncision = ph !== 'PH-A' && pierced.length > 0;
    if (separateIncision) {
      // INCISION 步驟：無數值效果（INC、核心 SPAWN）先發，再結算盾與傷害，最後死亡判定
      emit({ t: 'STEP', name: 'INCISION' }, false);
      for (const e of nonNumeric) emit(e, e.t === 'INC' || e.t === 'SPAWN');
      if (runStepNoHeader(incGains, incDmgs)) return finish();
    } else {
      for (const e of nonNumeric) emit(e, e.t === 'INC' || e.t === 'SPAWN');
    }

    // ---- 選邊 ----
    const holdingOf = (side: Side) => ({ E: side === 'L' ? L : R, P: side === 'L' ? R : L });
    if (inp.forcedChoice) {
      choice = inp.forcedChoice;
      emit({ t: 'CHOICE', side: choice, reason: 'FORCED', basis: null }, false);
    } else {
      const facts = (side: Side): SideFacts => {
        const sim = resolveRound({ ...inp, forcedChoice: side });
        const pLoss = inp.hp.P - sim.hp.P, eLoss = inp.hp.E - sim.hp.E;
        const v = pLoss - eLoss;
        const keep = holdingOf(side).E;
        const a2 = inp.area2[side];
        const [pNum, pDen] = preference(inp.enemy, keep, a2, inp.area2.L + inp.area2.R, inp.content);
        return { pLoss, eLoss, v, lethal: sim.hp.E <= 0, area2: a2, pNum, pDen, U: scoreU(w10Of(inp.enemy), pNum, pDen, v), ...obsFactsOf(inp.enemy, keep) }; // FUN-EXP-01 掛鉤 X-R2
      };
      const c = choose(inp.enemy, inp.rules.so, facts('L'), facts('R'), inp.fixedSide);
      choice = c.side;
      emit({ t: 'CHOICE', side: c.side, reason: c.reason, basis: c.basis }, false);
    }
    const hold = holdingOf(choice);

    // ---- 收割 ----
    const harvestOf = (who: Who): { gains: GainSpec[]; dmgs: DmgSpec[] } => {
      const gains: GainSpec[] = [], dmgs: DmgSpec[] = [];
      for (const o of [...hold[who]].sort((a, b) => a.id - b.id)) {
        const h = def(o).harvest;
        if (h.damage) dmgs.push({ src: who, dst: opp(who), kind: h.kind ?? 'HARV_DIRECT', raw: h.damage, organ: o.id });
        if (h.shield) gains.push({ t: 'SHIELD', who, n: h.shield, organ: o.id });
        if (h.heal) gains.push({ t: 'HEAL', who, n: h.heal, organ: o.id });
        if (h.selfDamage) dmgs.push({ src: who, dst: who, kind: 'SELF_POISON', raw: h.selfDamage, organ: o.id });
        if (h.testHits) for (let k = 0; k < h.testHits; k++) dmgs.push({ src: who, dst: opp(who), kind: 'HARV_DIRECT', raw: 0, organ: o.id });
      }
      return { gains, dmgs };
    };
    const mirrors = {
      P: hold.P.filter((o) => def(o).harvest.reflectPct).length,
      E: hold.E.filter((o) => def(o).harvest.reflectPct).length,
    };
    const hp_ = harvestOf('P'), he = harvestOf('E');
    if (ph === 'PH-M') {
      mirrorActive.P = mirrorActive.E = true;
      if (runStep('HARVEST', [...hp_.gains, ...he.gains], [...hp_.dmgs, ...he.dmgs], mirrors)) return finish();
    } else if (ph === 'PH-A') {
      mirrorActive.P = mirrorActive.E = true;
      if (runStep('ALL', [...incGains, ...hp_.gains, ...he.gains], [...incDmgs, ...hp_.dmgs, ...he.dmgs], mirrors)) return finish();
    } else {
      const order: Who[] = ph === 'PH-B' ? ['P', 'E'] : ['E', 'P'];
      for (const w of order) {
        mirrorActive[w] = true;
        const h = w === 'P' ? hp_ : he;
        if (runStep(w === 'P' ? 'PLAYER' : 'ENEMY', h.gains, h.dmgs, mirrors)) return finish();
      }
    }
    emit({ t: 'RE', shieldP: shield.P, shieldE: shield.E }, false);
    return finish();
  } catch (err) {
    if (err instanceof CapExceeded) {
      events.push({ t: 'CAP_EXCEEDED' });
      result = 'INVALID';
      events.push({ t: 'END', result, sd1: false });
      return finish();
    }
    throw err;
  }

  // INCISION 步驟本體（STEP 標頭已由呼叫端發出）
  function runStepNoHeader(gains: GainSpec[], dmgs: DmgSpec[]): boolean {
    for (const x of [...gains].sort(sortGain)) applyGain(x);
    const reflRaw = { P: 0, E: 0 };
    for (const d of [...dmgs].sort(sortDmg)) applyDmg(d, reflRaw);
    return deathCheck();
  }
}
