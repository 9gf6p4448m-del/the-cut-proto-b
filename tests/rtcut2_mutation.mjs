// rt-cut2 突變驗紅（對抗式檢查 H1～H6、M3）：把 src/rtcut/rules.ts 改壞成凍結檔「會讓它變紅」的樣子，對應的 rtcut2 測試必須變紅；原版必須綠。
// 用法：node tests/rtcut2_mutation.mjs（不改 src；突變版寫到 .tmp/rtcut2_mut/<名稱>/rules.ts）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = readFileSync('src/rtcut/rules.ts', 'utf8');
const one = (t, a, b) => { if (t.split(a).length !== 2) throw new Error(`錨點不唯一或不存在：${a.slice(0, 60)}`); return t.replace(a, b); };
const KO_START = '  // 擊倒：任一方器官（含萌芽中）全部被切除的那一步立即結束；同一步雙方清空＝平手\n';
const RG_START = '  // 再生：固定節拍（第 300、600…步＝5、10…秒），未滿 8 個就長回最早被切的種類，萌芽 0.5 秒\n';
const RG_END = "    ev.push({ t: 'spawn', i: s.organs.length - 1 });\n  }\n";
const MUTS = {
  'H1 AI 不再只出有目標的刀': (t) => one(t, 'const usable = state.mode.knockout || state.mode.regen ? scored.filter((c) => c.v > 0) : scored;', 'const usable = scored;'),
  'H2 AI 不把再生器官當目標': (t) => one(t, '  let v = r.severed !== null ? VALUE[s.organs[r.severed].kind] : 0;', '  let v = r.severed !== null && r.severed < 16 ? VALUE[s.organs[r.severed].kind] : 0;'),
  'H3 後切先長': (t) => one(t, 'const kind = s.severedQ[side].shift()!;', 'const kind = s.severedQ[side].pop()!;'),
  'H4 藍方用紅身取樣再生位置': (t) => one(one(one(t, 'const xs = BODY[side].map', 'const xs = BODY.red.map'), 'ys = BODY[side].map', 'ys = BODY.red.map'), 'if (!inside(p, BODY[side])) continue;', 'if (!inside(p, BODY.red)) continue;'),
  'H5 先再生再判擊倒': (t) => { const i = t.indexOf(KO_START), j = t.indexOf(RG_START), k = t.indexOf(RG_END) + RG_END.length; if (i < 0 || j < 0 || k < j) throw new Error('H5 錨點'); return t.slice(0, i) + t.slice(j, k) + t.slice(i, j) + t.slice(k); },
  'H6 萌芽 0.1 秒': (t) => one(t, 'export const SPROUT_STEPS = 30;', 'export const SPROUT_STEPS = 6;'),
  'M3 再生器官被切後不重新排入': (t) => one(t, '    s.severedQ[s.organs[r.severed].side].push(', '    if (r.severed < 16) s.severedQ[s.organs[r.severed].side].push('),
};
function run(env) {
  try { execFileSync(process.execPath, ['--test', 'tests/node/rtcut2_rules.test.ts'], { env: { ...process.env, ...env }, stdio: 'pipe' }); return { ok: true, red: [] }; }
  catch (e) { const out = String(e.stdout); return { ok: false, red: [...out.matchAll(/^✖ (R2-[^\n(]*)/gm)].map((m) => m[1].trim().slice(0, 40)) }; }
}
const base = run({});
console.log(`原版：${base.ok ? 'green' : 'RED ' + base.red.join('｜')}`);
let ok = base.ok;
for (const [name, f] of Object.entries(MUTS)) {
  const dir = resolve('.tmp/rtcut2_mut', name.split(' ')[0]); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rules.ts'), f(src));
  const r = run({ RTCUT_RULES: join(dir, 'rules.ts') });
  const uniq = [...new Set(r.red)];
  console.log(`${name}：${r.ok ? 'GREEN（未驗紅）' : 'red ← ' + uniq.join('｜')}`);
  if (r.ok) ok = false;
}
console.log(ok ? 'PASS 原版綠、7 個突變全部變紅' : 'FAIL');
process.exit(ok ? 0 : 1);
