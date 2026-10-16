// 正規 JSON（RFC 8785 的整數子集）與 SHA-256。規則狀態只允許整數、字串、布林、null、陣列、物件。
import { createHash } from 'node:crypto';

export function canonical(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`正規 JSON 只接受安全整數：${v}`);
    return Object.is(v, -0) ? '0' : String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  throw new TypeError(`正規 JSON 不接受的型別：${typeof v}`);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashOf(v: unknown): string {
  return sha256(canonical(v));
}

/** 深層凍結（原地），傳回同一個物件。即使父物件已經凍結，也一律遞迴到所有子物件（Codex G1-R3 #1）。 */
export function deepFreeze<T>(x: T, seen: WeakSet<object> = new WeakSet()): T {
  if (x && typeof x === 'object' && !seen.has(x as object)) {
    seen.add(x as object);
    for (const v of Object.values(x as object)) deepFreeze(v, seen);
    Object.freeze(x);
  }
  return x;
}

/** 是否每一層都已凍結。 */
export function isDeepFrozen(x: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (!x || typeof x !== 'object' || seen.has(x as object)) return true;
  seen.add(x as object);
  if (!Object.isFrozen(x)) return false;
  return Object.values(x as object).every((v) => isDeepFrozen(v, seen));
}
