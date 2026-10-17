// duel3 即時劃刀的輸入切片（DUEL_V03_FEEL 一「與固定步長的一致性」）。純函式，不碰 DOM。
// 把「時間戳＋座標」的指標事件序列，依所屬模擬步切成 rules.ts 的 Piece：
// - 按下／放開／取消／第二指：歸到事件時間戳所在的步。
// - 移動：和上一個點連成線段；線段跨步時在步邊界依時間內插切開，每段只屬於一步。速度＝整條原線段的長度÷時間。
// 同一條路徑用不同取樣密度（例如每 8ms 和每 16ms）餵入，只要取樣點落在同一條路徑上、等速，切出的每步幾何與速度相同（DF-02）。
import { FPS } from './rules.ts';
import type { Piece, V } from './rules.ts';

export type PtrKind = 'down' | 'move' | 'up' | 'cancel' | 'multi';
export interface PtrEv { t: number; k: PtrKind; p: V }   // t：自本局第 0 步起算的毫秒
export const STEP_MS = 1000 / FPS;
/** 時間戳所在的步（第 k 步涵蓋 [k·STEP_MS, (k+1)·STEP_MS)）。 */
export const stepOfMs = (t: number): number => Math.floor((t * FPS) / 1000 + 1e-9);

/** 逐個餵事件、把片段放進「步→片段」佇列；即時遊戲和測試共用同一份邏輯。 */
export class Slicer {
  readonly q = new Map<number, Piece[]>();
  private last: { t: number; p: V } | null = null;
  private put(k: number, pc: Piece): void { const a = this.q.get(k); if (a) a.push(pc); else this.q.set(k, [pc]); }
  private segTo(t: number, p: V): void {
    const a = this.last!; this.last = { t, p };
    const L = Math.hypot(p[0] - a.p[0], p[1] - a.p[1]);
    if (L === 0) return;
    const dt = t - a.t, v = dt > 0 ? L / dt : Infinity;
    const at = (tt: number): V => [a.p[0] + ((p[0] - a.p[0]) * (tt - a.t)) / dt, a.p[1] + ((p[1] - a.p[1]) * (tt - a.t)) / dt];
    const k0 = stepOfMs(a.t), k1 = stepOfMs(t);
    let from = a.p;
    for (let k = k0; k < k1; k++) { const q = at((k + 1) * STEP_MS); this.put(k, { k: 'seg', a: from, b: q, v }); from = q; }
    this.put(k1, { k: 'seg', a: from, b: p, v });
  }
  push(e: PtrEv): void {
    if (e.k === 'down') { this.last = { t: e.t, p: e.p }; this.put(stepOfMs(e.t), { k: 'down', p: e.p }); return; }
    if (!this.last) return;
    if (e.k === 'move' || e.k === 'up') this.segTo(e.t, e.p);
    if (e.k !== 'move') { this.put(stepOfMs(e.t), { k: 'end', why: e.k }); this.last = null; }
  }
  /** 取出第 k 步的片段（取出後刪除）。 */
  take(k: number): Piece[] { const a = this.q.get(k) ?? []; this.q.delete(k); return a; }
  /** 取出第 k 步以前（含）所有還沒處理的片段，依步序串起來：事件晚到（所屬步已經跑過）時併到第 k 步，不丟掉。 */
  takeUpTo(k: number): Piece[] {
    const ks = [...this.q.keys()].filter((x) => x <= k).sort((x, y) => x - y);
    const out: Piece[] = []; for (const x of ks) { out.push(...this.q.get(x)!); this.q.delete(x); }
    return out;
  }
}
/** 事件序列 → 每步的片段（依時間順序）。 */
export function toPieces(evs: readonly PtrEv[]): Map<number, Piece[]> {
  const sl = new Slicer(); for (const e of evs) sl.push(e); return sl.q;
}
