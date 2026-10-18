// duel4 範圍顯示（DUEL_V04_FRONT 二＋補述 1 第 1 條）：一個對方器官「在範圍內」＝存在一條合法直線刀，
// 起點在起刀區、刀長 ≤420、這個器官是刀路上第一個碰到的對方器官（可切的或已鎖的都算擋路；自己的器官只鎖不擋；萌芽中的不參與）。
// 找法：起刀區上 4 單位網格的每個點 × 每 1° 一條會通過目標圓的直線，算第一個碰到的對方器官（命中順序同規則：進入距離小的先、同距離索引小的先）；
// 找到候選後用規則的 resolveStrike 確認（確認過的那一刀＝見證刀）。純函式，不碰 DOM。
import { MAX_LEN, bodyOf, endStep, entryDist, inStartZone, isReady, radOf, resolveStrike } from './rules.ts';
import type { GameState, Line, Mode, Side, V } from './rules.ts';

const CELL = 2, PT_STEP = 4, ANG_STEP = 1;
interface Zone { x0: number; y0: number; w: number; h: number; bits: Uint8Array; pts: V[] }
const zoneCache = new WeakMap<object, Map<string, Zone>>();   // 以獸身多邊形為鍵：同一份獸身跨場共用
/** 起刀區點陣（座標為 CELL 的倍數；每格存「該點在起刀區內」的精確判定）＋起刀區上 PT_STEP 網格的點。依模式＋推進值＋陣營快取。 */
export function zoneOf(mode: Mode, push: number, side: Side): Zone {
  const bk = mode.body ?? zoneCache; let m = zoneCache.get(bk); if (!m) { m = new Map(); zoneCache.set(bk, m); }
  const key = `${side}:${push}:${mode.front?.unit ?? 0}`;
  let z = m.get(key);
  if (!z) {
    const all = [...bodyOf(mode, 'blue'), ...bodyOf(mode, 'red')], xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) / PT_STEP) * PT_STEP, y0 = Math.floor(Math.min(...ys) / PT_STEP) * PT_STEP;
    const w = Math.ceil((Math.max(...xs) - x0) / CELL) + 1, h = Math.ceil((Math.max(...ys) - y0) / CELL) + 1;
    const bits = new Uint8Array(w * h), pts: V[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p: V = [x0 + i * CELL, y0 + j * CELL];
      if (!inStartZone(mode, push, side, p)) continue;
      bits[j * w + i] = 1;
      if (p[0] % PT_STEP === 0 && p[1] % PT_STEP === 0) pts.push(p);
    }
    z = { x0, y0, w, h, bits, pts }; m.set(key, z);
  }
  return z;
}

export interface Reach { inRange: boolean[]; witness: (Line | null)[] }
/** side 的刀碰得到哪些對方器官（只算存活且萌芽完成的對方器官；其他索引為 false）。 */
export function reachOf(s: GameState, side: Side): Reach {
  const n = s.organs.length, inRange: boolean[] = new Array(n).fill(false), witness: (Line | null)[] = new Array(n).fill(null);
  const r = radOf(s.mode), push = s.push ?? 0, z = zoneOf(s.mode, push, side);
  // 用規則確認：判定時把冷卻視為已好、相位視為切割期（只看起點、命中順序）
  const probe: GameState = { ...s, phase: 'cut', cdUntil: { ...s.cdUntil, [side]: 0 }, step: Math.min(s.step, endStep(s) - 1) };
  const enemies: number[] = [];
  s.organs.forEach((o, i) => { if (o.side !== side && isReady(probe, i)) enemies.push(i); });
  for (const ti of enemies) {
    const c = s.organs[ti].p;
    let found: Line | null = null;
    for (const a of z.pts) {
      const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (d > MAX_LEN + r) continue;
      const th = (Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI, half = d <= r ? 180 : (Math.asin(r / d) * 180) / Math.PI;
      for (let ang = Math.ceil((th - half) / ANG_STEP) * ANG_STEP; ang <= th + half; ang += ANG_STEP) {
        const rad = (ang * Math.PI) / 180, b: V = [a[0] + Math.cos(rad) * MAX_LEN, a[1] + Math.sin(rad) * MAX_LEN];
        let best = -1, bt = Infinity;
        for (const i of enemies) { const t = entryDist(a, b, s.organs[i].p, r); if (t !== null && (t < bt || (t === bt && i < best))) { bt = t; best = i; } }
        if (best !== ti) continue;
        const line: Line = { a: [a[0], a[1]], b };
        const res = resolveStrike(probe, side, line);
        if (res.ok && (res.severed === ti || res.blocked === ti)) { found = line; break; }
      }
      if (found) break;
    }
    if (found) { inRange[ti] = true; witness[ti] = found; }
  }
  return { inRange, witness };
}
