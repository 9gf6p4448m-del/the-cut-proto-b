// 依序跑完整流程（各步驟是獨立 node 程序，輸出到 tools/exp/results/ 或 $EXP_OUT）。
import { execFileSync } from 'node:child_process';
const steps: string[][] = [['calibrate.ts'], ['bots.ts'], ['boards.ts'], ['boards.ts', '--verify'], ['summary.ts']];
const skipSummary = process.argv.includes('--no-summary');
for (const s of steps) {
  if (skipSummary && s[0] === 'summary.ts') continue;
  console.error('>>', 'node tools/exp/' + s.join(' '));
  execFileSync(process.execPath, [new URL('./' + s[0], import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...s.slice(1)], { stdio: ['ignore', 'inherit', 'inherit'] });
}
