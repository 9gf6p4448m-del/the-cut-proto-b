// node:fs 的最小替身：研究引擎只用 readFileSync 讀 content/organs.json 與 content/trig.json；改為打包時內嵌原文。
import organsText from '../engine/content/organs.json';
import trigText from '../engine/content/trig.json';

const FILES: Record<string, string> = { 'organs.json': organsText as unknown as string, 'trig.json': trigText as unknown as string };

export function readFileSync(p: unknown, enc?: string): string {
  if (enc !== 'utf8') throw new Error('shim 只支援 utf8');
  const s = String(p instanceof URL ? p.pathname : p);
  const name = s.slice(s.lastIndexOf('/') + 1);
  const t = FILES[name];
  if (t === undefined) throw new Error(`shim 沒有這個檔案：${name}`);
  return t;
}
