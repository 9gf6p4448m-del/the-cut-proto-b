// 「同時下刀」單場試玩（子路徑 twin-sim/）規則：純函式、完全決定性。畫面、預覽、AI、測試都呼叫這一份。研究片段，不是正式規格。
// 規則：the-cut docs/twin-sim/ACCEPTANCE_FROZEN.md「固定規則」。單刀路徑沿用 src/twinslash/rules.ts 的 resolveCut（A1），不修改它。
import { aiValue, candidateCuts, key, newState, resolveCut, HP0 } from '../twinslash/rules.ts';
import type { BoardDef, CutResult, Kind, Side, State, V } from '../twinslash/rules.ts';

export const ROUNDS = 4;
export const BAND = 2;                      // AI：最高分 −2 以內的組都可能被選

/** 盤面 B′（研究檔 TWIN_SLASH_V2_RESEARCH.md；代號對照見凍結驗收）。沒有骨。 */
export const BOARD_BP: BoardDef = {
  id: 'bp', name: '盤面 B′', purpose: '同時下刀：你要發動哪一排，還是去截他？',
  body: {
    blue: [[0, 450], [700, 450], [700, 1000], [0, 1000]],
    red: [[0, 0], [700, 0], [700, 550], [0, 550]],
  },
  organs: {
    blue: [{ id: '上爪1', kind: 'claw', p: [150, 620] }, { id: '上爪2', kind: 'claw', p: [250, 620] }, { id: '上心', kind: 'heart', p: [350, 620] },
      { id: '下爪1', kind: 'claw', p: [150, 820] }, { id: '下爪2', kind: 'claw', p: [250, 820] }, { id: '下心', kind: 'heart', p: [350, 820] }],
    red: [{ id: '爪1', kind: 'claw', p: [150, 300] }, { id: '爪2', kind: 'claw', p: [250, 300] }, { id: '心', kind: 'heart', p: [350, 300] },
      { id: '截爪1', kind: 'claw', p: [486, 380] }, { id: '截爪2', kind: 'claw', p: [444, 455] }, { id: '截爪3', kind: 'claw', p: [539, 505] }, { id: '截爪4', kind: 'claw', p: [518, 540] }],
  },
};

export interface SimResult { winner: Side | 'draw'; reason: 'kill' | 'mutual' | 'rounds' }
export interface SimState {
  board: BoardDef; seed: number; round: number;   // round＝已結算的回合數（0～4）
  hp: Record<Side, number>; alive: string[]; tired: Record<Side, string[]>;
  result: SimResult | null;
}
export function newSim(seed: number, board: BoardDef = BOARD_BP): SimState {
  const s = newState(board, 'A1', 'blue', seed);
  return { board, seed, round: 0, hp: { ...s.hp }, alive: [...s.alive], tired: { blue: [], red: [] }, result: null };
}
/** 回合開始的盤面（給 resolveCut／candidateCuts 用的狀態；A1）。 */
export function snapshot(sim: SimState): State {
  const s = newState(sim.board, 'A1', 'blue', sim.seed);
  return { ...s, hp: { ...sim.hp }, alive: [...sim.alive], tired: { blue: [...sim.tired.blue], red: [...sim.tired.red] } };
}

const kindOf = (board: BoardDef, k: string): Kind => { const [s, id] = k.split(':') as [Side, string]; return board.organs[s].find((o) => o.id === id)!.kind; };
export function dmgOf(board: BoardDef, fired: string[]): number {
  const claws = fired.filter((k) => kindOf(board, k) === 'claw').length, hearts = fired.filter((k) => kindOf(board, k) === 'heart').length;
  return 2 * claws * (1 + hearts);
}
export const KIND_NAME: Record<Kind, string> = { claw: '爪', heart: '心臟', bone: '骨' };

export interface SideOutcome { path: CutResult; fired: string[]; cancelled: string[]; dmg: number }
export interface RoundResult { blue: SideOutcome; red: SideOutcome; severed: string[]; after: SimState }
export interface Line { a: V; b: V }

/** 一回合同時結算：兩刀都依回合開始的盤面判路徑 → 同時切除 → 被切的器官不發動 → 同時扣血 → 疲勞＝實際發動。 */
export function resolveRound(sim: SimState, cuts: Record<Side, Line>): RoundResult {
  if (sim.result) throw new Error('這一局已結束');
  const snap = snapshot(sim);
  const path = { blue: resolveCut(snap, 'blue', cuts.blue.a, cuts.blue.b, false), red: resolveCut(snap, 'red', cuts.red.a, cuts.red.b, false) };
  for (const s of ['blue', 'red'] as Side[]) if (!path[s].legal) throw new Error(`${s} 的刀不合法：${path[s].reason}`);
  const out = {} as Record<Side, SideOutcome>;
  for (const s of ['blue', 'red'] as Side[]) {
    const foeSev = path[s === 'blue' ? 'red' : 'blue'].severed;
    const fired = path[s].fired.filter((k) => k !== foeSev);
    out[s] = { path: path[s], fired, cancelled: path[s].fired.filter((k) => k === foeSev), dmg: dmgOf(sim.board, fired) };
  }
  const severed = [path.blue.severed, path.red.severed].filter((k): k is string => !!k);
  const hp = { blue: sim.hp.blue - out.red.dmg, red: sim.hp.red - out.blue.dmg };
  const round = sim.round + 1;
  let result: SimResult | null = null;
  if (hp.blue <= 0 && hp.red <= 0) result = { winner: 'draw', reason: 'mutual' };
  else if (hp.blue <= 0) result = { winner: 'red', reason: 'kill' };
  else if (hp.red <= 0) result = { winner: 'blue', reason: 'kill' };
  else if (round >= ROUNDS) result = { winner: hp.blue === hp.red ? 'draw' : hp.blue > hp.red ? 'blue' : 'red', reason: 'rounds' };
  const after: SimState = {
    board: sim.board, seed: sim.seed, round, hp, alive: sim.alive.filter((k) => !severed.includes(k)),
    tired: { blue: out.blue.fired.map((k) => k.split(':')[1]), red: out.red.fired.map((k) => k.split(':')[1]) }, result,
  };
  return { blue: out.blue, red: out.red, severed, after };
}

/** 揭曉文字：被截斷的器官（措辭不暗示速度先後）。 */
export function cancelText(board: BoardDef, side: Side, k: string): string {
  return `${side === 'blue' ? '你的' : '他的'}${KIND_NAME[kindOf(board, k)]}本回合被切除，未能發動（${k.split(':')[1]}）`;
}

// ---------------- AI（首輪版本：只看回合開始的盤面與種子） ----------------
/** 分組鍵＝發動「集合」（排序後，與刀的方向無關）＋切除對象。 */
export const sigOf = (r: CutResult) => `${[...r.fired].sort().join(',')}|${r.severed ?? ''}`;
export interface Group { sig: string; lines: CutResult[]; value: number }
export function groupCuts(snap: State, side: Side): Group[] {
  const m = new Map<string, CutResult[]>();
  for (const r of candidateCuts(snap, side)) { const g = sigOf(r); if (!m.has(g)) m.set(g, []); m.get(g)!.push(r); }
  return [...m.entries()].map(([sig, lines]) => ({ sig, lines, value: aiValue(snap, lines[0]) }));
}
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }
const bySig = (x: { sig: string }, y: { sig: string }) => (x.sig < y.sig ? -1 : x.sig > y.sig ? 1 : 0);
export interface AiPlan { cut: CutResult; sig: string; model: string[]; scores: { sig: string; score: number }[]; band: string[] }
/** AI 這回合的刀：玩家模型＝玩家 aiValue 最高的 2 組各半；AI 分數＝期望血差（已扣截斷）＋切除價值；最高分 −2 以內均勻挑。 */
export function aiPlan(sim: SimState): AiPlan {
  const snap = snapshot(sim);
  const player = groupCuts(snap, 'blue').sort((x, y) => y.value - x.value || bySig(x, y)).slice(0, 2);
  const mine = groupCuts(snap, 'red');
  const scores = mine.map((g) => {
    const r = g.lines[0], sevValue = aiValue(snap, r) - r.dmg;
    let ev = 0;
    for (const p of player) {
      const p0 = p.lines[0];
      ev += dmgOf(sim.board, r.fired.filter((k) => k !== p0.severed)) - dmgOf(sim.board, p0.fired.filter((k) => k !== r.severed));
    }
    return { g, sig: g.sig, score: ev / Math.max(1, player.length) + sevValue };
  });
  const best = Math.max(...scores.map((s) => s.score));
  const band = scores.filter((s) => s.score >= best - BAND - 1e-9).sort(bySig);
  const u = rng(sim.seed * 7919 + sim.round * 104729);
  const pick = band[Math.floor(u() * band.length)];
  const cut = pick.g.lines[Math.floor(u() * pick.g.lines.length)];
  return { cut, sig: pick.sig, model: player.map((p) => p.sig), scores: scores.map((s) => ({ sig: s.sig, score: s.score })), band: band.map((s) => s.sig) };
}
export { key, HP0 };
