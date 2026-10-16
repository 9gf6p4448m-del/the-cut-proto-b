// 決定性檢查：同一指令（run_all --no-summary）獨立跑兩次到暫存目錄，與已提交的 results/ 三方比對 sha256。
// 用法：node tools/exp/determinism.ts [暫存根目錄]（預設 os.tmpdir()/exp-det）。結果寫 results/determinism.json。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = ['calibration.json', 'bots.json', 'boards.json', 'exp_params.json'];
const root = resolve(process.argv[2] ?? join(tmpdir(), 'exp-det'));
const here = fileURLToPath(new URL('.', import.meta.url));
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const dirs = [join(root, 'run1'), join(root, 'run2')];
for (const d of dirs) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  console.error('>> run_all --no-summary →', d);
  execFileSync(process.execPath, [join(here, 'run_all.ts'), '--no-summary'], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, EXP_OUT: d } });
}
const runs = [...dirs, join(here, 'results')].map((d) => Object.fromEntries(files.map((f) => [f, sha(join(d, f))])));
const identical = files.every((f) => runs[0][f] === runs[1][f] && runs[1][f] === runs[2][f]);
writeFileSync(join(here, 'results', 'determinism.json'), JSON.stringify({ identical, files, runs, note: 'runs[0]、runs[1]＝兩次獨立輸出；runs[2]＝提交的 results/' }, null, 1) + '\n');
console.log(identical ? 'DETERMINISM: 三份 sha256 全部相同' : 'DETERMINISM: 不同！', JSON.stringify(runs, null, 1));
process.exit(identical ? 0 : 1);
