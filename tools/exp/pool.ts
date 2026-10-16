// worker_threads 平行池。結果依任務順序（不是完成順序）合併，所以輸出與並行度無關（決定性）。
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { playGame } from './lib.ts';
import type { BotName, GameRec, ModeKey } from './lib.ts';

export interface Task { mode: ModeKey; bot: BotName; hpE: number; seed0: number; seed1: number }

const CHUNK = 20;
export const WORKERS = 8;

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on('message', (t: Task) => {
    const out: GameRec[] = [];
    for (let seed = t.seed0; seed <= t.seed1; seed++) out.push(playGame(t.mode, t.bot, seed, t.hpE));
    port.postMessage(out);
  });
}

/** 把每個 (mode, bot, hpE, 種子範圍) 拆成 CHUNK 局一塊，平行跑，依序合併回每個原任務的 GameRec[]（依 seed 遞增）。 */
export async function runPool(tasks: Task[]): Promise<GameRec[][]> {
  const chunks: { ti: number; task: Task }[] = [];
  tasks.forEach((t, ti) => { for (let a = t.seed0; a <= t.seed1; a += CHUNK) chunks.push({ ti, task: { ...t, seed0: a, seed1: Math.min(t.seed1, a + CHUNK - 1) } }); });
  const results: GameRec[][] = new Array(chunks.length);
  let next = 0;
  const workers: Worker[] = [];
  await new Promise<void>((resolve, reject) => {
    let done = 0;
    const feed = (w: Worker): void => {
      if (next >= chunks.length) { w.terminate(); return; }
      const idx = next++;
      w.once('message', (r: GameRec[]) => { results[idx] = r; done++; if (done === chunks.length) resolve(); else feed(w); });
      w.postMessage(chunks[idx].task);
    };
    if (chunks.length === 0) resolve();
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(new URL(import.meta.url));
      w.on('error', reject);
      workers.push(w);
      feed(w);
    }
  });
  await Promise.all(workers.map((w) => w.terminate()));
  const out: GameRec[][] = tasks.map(() => []);
  chunks.forEach((c, k) => out[c.ti].push(...results[k]));
  return out;
}
