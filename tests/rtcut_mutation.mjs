// RT-04 鑑別力（補述 1）：把 AI 改成會讀玩家拖曳線（避開拖曳線壓住的目標），RT-04 測試必須變紅；原版必須綠。
// 用法：node tests/rtcut_mutation.mjs（不改 src；突變版寫到 .tmp/rtcut_mut/rules.ts）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = readFileSync('src/rtcut/rules.ts', 'utf8');
const muts = [
  ['  const view = publicView(state);\n', '  const view = state; // 突變：AI 讀完整狀態（含拖曳線）\n'],
  ['    if (!r.ok) continue;\n', '    if (!r.ok) continue;\n    if (view.drag.blue && r.severed !== null && entryDist(view.drag.blue.a, view.drag.blue.b, ORGANS[r.severed].p) !== null) continue; // 突變：避開玩家正要鎖的器官\n'],
];
let mut = src;
for (const [a, b] of muts) { if (mut.split(a).length !== 2) throw new Error(`突變錨點不唯一或不存在：${a}`); mut = mut.replace(a, b); }
const dir = resolve('.tmp/rtcut_mut'); mkdirSync(dir, { recursive: true });
const file = join(dir, 'rules.ts'); writeFileSync(file, mut);

function run(env) {
  try { execFileSync(process.execPath, ['--test', '--test-name-pattern=RT-04', 'tests/node/rtcut_rules.test.ts'], { env: { ...process.env, ...env }, stdio: 'pipe' }); return 'green'; }
  catch (e) { const out = String(e.stdout); return /✖ RT-04/.test(out) ? 'red' : `error: ${out.slice(-400)}`; }
}
const orig = run({}), mutant = run({ RTCUT_RULES: file });
console.log(`原版 RT-04：${orig}`);
console.log(`突變版（AI 讀拖曳線）RT-04：${mutant}`);
const ok = orig === 'green' && mutant === 'red';
console.log(ok ? 'PASS 突變驗紅成立' : 'FAIL');
process.exit(ok ? 0 : 1);
