// 安全整數運算（R3-SPEC §5.4 INT-2–INT-4）。所有規則運算只能用這裡的函式做除法、開根號與取整。
export const SAFE = Number.MAX_SAFE_INTEGER;

export class IntOverflow extends Error {}

export function assertSafe(x: number, what = 'value'): number {
  if (!Number.isSafeInteger(x)) throw new IntOverflow(`${what} 不是安全整數: ${x}`);
  return x;
}

export function mul(a: number, b: number): number {
  const r = a * b;
  if (!Number.isSafeInteger(r) || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new IntOverflow(`乘法溢位: ${a} * ${b}`);
  }
  return r;
}

/** INT-2：⌊N/D⌋，D > 0；浮點估計後以整數乘法修正。 */
export function idiv(n: number, d: number): number {
  assertSafe(n, 'idiv.n');
  assertSafe(d, 'idiv.d');
  if (d <= 0) throw new RangeError(`idiv 的除數必須 > 0: ${d}`);
  let q = Math.floor(n / d);
  // 浮點估計可能偏差 1；先把 q·d 拉回安全範圍，再用餘數修正（不計算 (q+1)·d，避免靠近上限時溢位）
  while (!Number.isSafeInteger(q * d)) q += q > 0 ? -1 : 1;
  let r = n - q * d;
  while (r < 0) { q -= 1; r += d; }
  while (r >= d) { q += 1; r -= d; }
  return q;
}

/** INT-3：round(N/D) = ⌊(2N + D)/(2D)⌋（半數進位），D > 0。 */
export function roundDiv(n: number, d: number): number {
  return idiv(assertSafe(2 * n + d, 'roundDiv.num'), assertSafe(2 * d, 'roundDiv.den'));
}

/** INT-4：⌊√n⌋，0 ≤ n < 2^53。 */
export function isqrt(n: number): number {
  assertSafe(n, 'isqrt.n');
  if (n < 0) throw new RangeError(`isqrt 的參數必須 ≥ 0: ${n}`);
  let s = Math.floor(Math.sqrt(n));
  while (!Number.isSafeInteger(s * s) || s * s > n) s -= 1;
  // (s+1)² ≤ n ⇔ 2s+1 ≤ n − s²（不直接計算 (s+1)²）
  while (2 * s + 1 <= n - s * s) s += 1;
  return s;
}

export function clip(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
