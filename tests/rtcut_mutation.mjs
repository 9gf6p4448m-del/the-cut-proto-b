// 突變驗紅：① RT-04（補述 1）把 AI 改成會讀玩家拖曳線（避開拖曳線壓住的目標）→ RT-04 必須變紅；
// ② RT-01 同步出刀（對抗式檢查 F1）把同步套用改成「紅刀先鎖、再判藍刀」→ 同步出刀測試必須變紅。原版兩者都必須綠。
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

function run(env, pat = 'RT-04') {
  try { execFileSync(process.execPath, ['--test', `--test-name-pattern=${pat}`, 'tests/node/rtcut_rules.test.ts'], { env: { ...process.env, ...env }, stdio: 'pipe' }); return 'green'; }
  catch (e) { const out = String(e.stdout); return new RegExp(`✖ [^\n]*${pat}`).test(out) ? 'red' : `error: ${out.slice(-400)}`; }
}
const orig = run({}), mutant = run({ RTCUT_RULES: file });
console.log(`原版 RT-04：${orig}`);
console.log(`突變版（AI 讀拖曳線）RT-04：${mutant}`);
// ② 同步出刀
const syncA = "  if (input.blue) { const r = resolveStrike(s0, 'blue', input.blue);";
if (src.split(syncA).length !== 2) throw new Error('同步突變錨點不唯一');
const sync = src.replace(syncA, "  const s0r = red ? (() => { const r0 = resolveStrike(s0, 'red', red); const c = { ...s0, lockUntil: [...s0.lockUntil] }; if (r0.ok) for (const i of r0.locks) c.lockUntil[i] = k + LOCK_STEPS; return c; })() : s0; // 突變：紅先鎖\n  if (input.blue) { const r = resolveStrike(s0r, 'blue', input.blue);");
const sdir = resolve('.tmp/rtcut_mut_sync'); mkdirSync(sdir, { recursive: true }); writeFileSync(join(sdir, 'rules.ts'), sync);
const syncO = run({}, '同步出刀'), syncM = run({ RTCUT_RULES: join(sdir, 'rules.ts') }, '同步出刀');
console.log(`原版 RT-01 同步出刀：${syncO}`);
console.log(`突變版（紅刀先鎖再判藍）RT-01 同步出刀：${syncM}`);
const ok = orig === 'green' && mutant === 'red' && syncO === 'green' && syncM === 'red';
console.log(ok ? 'PASS 突變驗紅成立' : 'FAIL');
process.exit(ok ? 0 : 1);
