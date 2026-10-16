// node:crypto 的最小替身（只支援研究引擎實際用到的 createHash('sha256').update(text,'utf8').digest(...)）。
import { sha256Bytes, toHex } from './sha256.ts';

class Digest extends Uint8Array {
  readUInt32LE(off: number): number { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(off, true); }
}

export function createHash(alg: string) {
  if (alg !== 'sha256') throw new Error(`shim 只支援 sha256：${alg}`);
  const parts: Uint8Array[] = [];
  const api = {
    update(text: string, enc?: string) {
      if (enc !== undefined && enc !== 'utf8') throw new Error(`shim 只支援 utf8：${enc}`);
      parts.push(new TextEncoder().encode(text));
      return api;
    },
    digest(fmt?: string): any {
      const n = parts.reduce((s, p) => s + p.length, 0);
      const all = new Uint8Array(n);
      let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      const h = sha256Bytes(all);
      if (fmt === 'hex') return toHex(h);
      if (fmt === undefined) { const d = new Digest(32); d.set(h); return d; }
      throw new Error(`shim 不支援 digest 格式：${fmt}`);
    },
  };
  return api;
}
