// xoshiro128**（R2-SPEC §14.12；R3 INT-11：32 位元乘法一律 Math.imul，結果 >>> 0）。
import { createHash } from 'node:crypto';

export type PrngState = [number, number, number, number];

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** 初始狀態＝SHA-256(名稱字串) 的前 16 位元組（4 個 little-endian uint32）；全零時改用 [1,2,3,4]。 */
export function seedState(name: string): PrngState {
  const h = createHash('sha256').update(name, 'utf8').digest();
  const s: PrngState = [h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)];
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) return [1, 2, 3, 4];
  return s;
}

/** 串流名稱：`${seed}:${stream}`（seed 為十進位字串）。 */
export function streamState(seed: number, stream: string): PrngState {
  return seedState(`${seed}:${stream}`);
}

/** 傳回 [uint32 輸出, 新狀態]；狀態不可變。 */
export function next(s: PrngState): [number, PrngState] {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  let s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3];
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  return [result, [s0, s1, s2, s3]];
}

/** floor(u·n)，u＝k/2^32：以整數計算（k·n < 2^53）。 */
export function below(k: number, n: number): number {
  return Math.floor((k * n) / 4294967296);
}

/** 可變的游標包裝，只在單一純函式內部使用，結束時取回 state。 */
export class Cursor {
  state: PrngState;
  count = 0;
  constructor(s: PrngState) {
    this.state = s;
  }
  u32(): number {
    const [v, ns] = next(this.state);
    this.state = ns;
    this.count += 1;
    return v;
  }
  below(n: number): number {
    return below(this.u32(), n);
  }
}
