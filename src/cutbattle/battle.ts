// 切割→戰鬥（duel/）的戰鬥期模擬：純函式、整數毫秒的事件佇列，和畫面幀率無關（CB-03）。畫面只播放這裡產生的事件。
// 規格：the-cut 7c48d18 docs/fusion/CUT_BATTLE_V01.md「戰鬥期」。數值全部是試玩值（BT）。
import type { Kind, Side } from '../rtcut/rules.ts';
import { rand } from '../rtcut/rules.ts';

export const BT = {
  BASE_HP: 60,
  CLAW_EVERY: 1000, CLAW_DMG: 4,
  HEART_HP: 30, HEART_EVERY: 2000, HEART_HEAL: 3,
  EYE_CRIT: 0.2, CRIT_CAP: 0.6, CRIT_MULT: 2,
  POISON_EVERY: 1500, POISON_TICK: 1000,          // 每 1.5 秒疊 1 層；每 1 秒結算：每層 1 傷害
  BONE_SHIELD: 15,
  OFFSET_MAX: 300,                                  // 各器官計時起點錯開 0～0.3 秒
  OVERTIME_AT: 10000, OVERTIME_MULT: 2,
  MAX_MS: 15000,
};
export interface Fighter { side: Side; id: string; kind: Kind }
export interface SideStats { maxHp: number; hp: number; shield: number; poison: number; crit: number }
export type BattleEvent =
  | { t: 'start'; ms: 0; stats: Record<Side, SideStats> }
  | { t: 'claw'; ms: number; side: Side; id: string; crit: boolean; raw: number; shieldHit: number; hpHit: number; hpAfter: number }
  | { t: 'heal'; ms: number; side: Side; id: string; amount: number; hpAfter: number }
  | { t: 'poisonStack'; ms: number; side: Side; id: string; stacks: number }        // side＝施毒方，stacks＝對方目前層數
  | { t: 'poisonTick'; ms: number; side: Side; raw: number; shieldHit: number; hpHit: number; hpAfter: number }   // side＝受毒方
  | { t: 'overtime'; ms: number }
  | { t: 'end'; ms: number; winner: Side | 'draw'; how: 'ko' | 'time' | 'empty'; hp: Record<Side, number>; maxHp: Record<Side, number> };
export interface Contribution { damage: Record<Kind, number>; heal: number; blocked: number; critBonus: number }
export interface BattleResult { events: BattleEvent[]; winner: Side | 'draw'; how: 'ko' | 'time' | 'empty'; endMs: number; contrib: Record<Side, Contribution> }

const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
const zeroK = (): Record<Kind, number> => ({ claw: 0, heart: 0, eye: 0, poison: 0, bone: 0 });

/** 雙方存活器官 → 戰鬥事件。seed 決定各器官計時起點的錯開與暴擊。 */
export function simulateBattle(fighters: Fighter[], seed: number): BattleResult {
  let rng = (seed ^ 0x2545f491) >>> 0 || 1;
  const r = () => { const [u, n] = rand(rng); rng = n; return u; };
  const sides: Side[] = ['blue', 'red'];
  const cnt = (side: Side, k: Kind) => fighters.filter((f) => f.side === side && f.kind === k).length;
  const st = {} as Record<Side, SideStats>;
  for (const s of sides) {
    const maxHp = BT.BASE_HP + BT.HEART_HP * cnt(s, 'heart');
    st[s] = { maxHp, hp: maxHp, shield: BT.BONE_SHIELD * cnt(s, 'bone'), poison: 0, crit: Math.min(BT.CRIT_CAP, BT.EYE_CRIT * cnt(s, 'eye')) };
  }
  const contrib: Record<Side, Contribution> = { blue: { damage: zeroK(), heal: 0, blocked: 0, critBonus: 0 }, red: { damage: zeroK(), heal: 0, blocked: 0, critBonus: 0 } };
  const events: BattleEvent[] = [{ t: 'start', ms: 0, stats: { blue: { ...st.blue }, red: { ...st.red } } }];
  const end = (ms: number, winner: Side | 'draw', how: BattleResult['how']): BattleResult => {
    events.push({ t: 'end', ms, winner, how, hp: { blue: st.blue.hp, red: st.red.hp }, maxHp: { blue: st.blue.maxHp, red: st.red.maxHp } });
    return { events, winner, how, endMs: ms, contrib };
  };
  // 一方沒有器官＝直接輸（規格：以 0 器官開戰等同直接輸）；雙方都沒有＝平手
  const empty = sides.filter((s) => !fighters.some((f) => f.side === s));
  if (empty.length) return end(0, empty.length === 2 ? 'draw' : other(empty[0]), 'empty');
  // 行動排程：每個器官一個計時器（起點錯開 0～300 ms，四捨五入到 10 ms）；毒結算每方一個 1 秒計時器
  type Timer = { at: number; every: number; f?: Fighter; tick?: Side; order: number };
  const timers: Timer[] = [];
  fighters.forEach((f, i) => {
    const every = f.kind === 'claw' ? BT.CLAW_EVERY : f.kind === 'heart' ? BT.HEART_EVERY : f.kind === 'poison' ? BT.POISON_EVERY : 0;
    const off = Math.round((r() * BT.OFFSET_MAX) / 10) * 10;
    if (every) timers.push({ at: off + every, every, f, order: i });
  });
  sides.forEach((s, i) => timers.push({ at: BT.POISON_TICK, every: BT.POISON_TICK, tick: s, order: 1000 + i }));
  const hit = (target: Side, raw: number, ms: number) => {
    const mult = ms >= BT.OVERTIME_AT ? BT.OVERTIME_MULT : 1, dmg = raw * mult;
    const t = st[target], sh = Math.min(t.shield, dmg);
    t.shield -= sh; t.hp = Math.max(0, t.hp - (dmg - sh));
    contrib[target].blocked += sh;
    return { raw: dmg, shieldHit: sh, hpHit: dmg - sh };
  };
  let overtime = false;
  for (;;) {
    const next = Math.min(...timers.map((t) => t.at));
    if (next > BT.MAX_MS) break;
    if (!overtime && next >= BT.OVERTIME_AT) { overtime = true; events.push({ t: 'overtime', ms: BT.OVERTIME_AT }); }
    // 同一毫秒的行動依「器官序」處理；處理完才判勝負（同一毫秒雙方都歸零＝平手）。
    // 已歸零的一方在同一毫秒內不能再回血（血量歸零就輸，不能被排在後面的心救回來；審查 H1）。
    const down = new Set<Side>();
    for (const tm of timers.filter((t) => t.at === next).sort((a, b) => a.order - b.order)) {
      if (tm.f) {
        const f = tm.f, foe = other(f.side);
        if (f.kind === 'claw') {
          const crit = r() < st[f.side].crit;
          const raw = BT.CLAW_DMG * (crit ? BT.CRIT_MULT : 1), h = hit(foe, raw, next);
          contrib[f.side].damage.claw += h.raw;
          if (crit) contrib[f.side].critBonus += h.raw - h.raw / BT.CRIT_MULT;
          events.push({ t: 'claw', ms: next, side: f.side, id: f.id, crit, raw: h.raw, shieldHit: h.shieldHit, hpHit: h.hpHit, hpAfter: st[foe].hp });
        } else if (f.kind === 'heart') {
          if (down.has(f.side)) { tm.at += tm.every; continue; }
          const me = st[f.side], amount = Math.min(BT.HEART_HEAL, me.maxHp - me.hp);
          me.hp += amount; contrib[f.side].heal += amount;
          events.push({ t: 'heal', ms: next, side: f.side, id: f.id, amount, hpAfter: me.hp });
        } else if (f.kind === 'poison') {
          st[foe].poison++;
          events.push({ t: 'poisonStack', ms: next, side: f.side, id: f.id, stacks: st[foe].poison });
        }
      } else if (tm.tick && st[tm.tick].poison > 0) {
        const victim = tm.tick, h = hit(victim, st[victim].poison, next);
        contrib[other(victim)].damage.poison += h.raw;
        events.push({ t: 'poisonTick', ms: next, side: victim, raw: h.raw, shieldHit: h.shieldHit, hpHit: h.hpHit, hpAfter: st[victim].hp });
      }
      tm.at += tm.every;
      for (const s of sides) if (st[s].hp <= 0) down.add(s);
    }
    const dead = sides.filter((s) => st[s].hp <= 0);
    if (dead.length) return end(next, dead.length === 2 ? 'draw' : other(dead[0]), 'ko');
  }
  // 打滿 15 秒：比剩餘血量百分比（以整數交叉相乘比，避免浮點），相同平手
  const a = st.blue.hp * st.red.maxHp, b = st.red.hp * st.blue.maxHp;
  return end(BT.MAX_MS, a > b ? 'blue' : b > a ? 'red' : 'draw', 'time');
}
/** 貢獻表：由事件獨立加總（CB-04 用來和 contrib 對帳）。 */
export function contributionFromEvents(events: BattleEvent[]): Record<Side, Contribution> {
  const c: Record<Side, Contribution> = { blue: { damage: zeroK(), heal: 0, blocked: 0, critBonus: 0 }, red: { damage: zeroK(), heal: 0, blocked: 0, critBonus: 0 } };
  for (const e of events) {
    if (e.t === 'claw') { c[e.side].damage.claw += e.raw; if (e.crit) c[e.side].critBonus += e.raw - e.raw / BT.CRIT_MULT; c[other(e.side)].blocked += e.shieldHit; }
    else if (e.t === 'heal') c[e.side].heal += e.amount;
    else if (e.t === 'poisonTick') { c[other(e.side)].damage.poison += e.raw; c[e.side].blocked += e.shieldHit; }
  }
  return c;
}
