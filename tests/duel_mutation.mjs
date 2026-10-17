// 刀譜對決規則突變驗證（作者證據用）：逐一把 src/duel/rules.ts 改壞、跑 tests/node/duel_rules.test.ts，應該變紅；每次跑完一定還原。
// 用法：node tests/duel_mutation.mjs（工作樹的 src/duel/rules.ts 必須是乾淨的已提交版本）
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const F = 'src/duel/rules.ts', orig = readFileSync(F, 'utf8');
const M = [
  ['DB-01 斬斷就停', '    severed.push(o.id); seqKinds.push(o.kind); cuts.push({ id: o.id, p: o.p, d: h.t });\n  }', '    severed.push(o.id); seqKinds.push(o.kind); cuts.push({ id: o.id, p: o.p, d: h.t }); break;\n  }'],
  ['DB-01 鎖不擋', '    if (isLocked(o, k)) { blocked = o.id; end = at(h.t); break; }', ''],
  ['DB-01 骨不擋', "    if (o.kind === 'bone' && !blade) {", "    if (false) {"],
  ['DB-03 同血判平手不進突然死亡', "    s.phase = 'sudden'; ev.push({ t: 'sudden' });", "    s.phase = 'over'; s.outcome = { winner: 'draw', how: 'time' }; ev.push({ t: 'over', outcome: s.outcome }); return { state: s, events: ev };"],
  ['DB-04 再生節拍 4 秒', '  if (s.step % TUNE.REGEN_EVERY === 0) for', '  if (s.step % 240 === 0) for'],
  ['DB-04 補回最新而非最早', '  const kind = s.cutQueue[side].shift()!;', '  const kind = s.cutQueue[side].pop()!;'],
  ['DB-04 補述 只看圓心', 'export const validSpot = (p: V, side: Side) => circleInside(p, side) && reachableBy(p, other(side));', 'export const validSpot = (p: V, side: Side) => inside(p, BODY[side]);'],
  ['DB-05 AI 讀拖曳', 'export function publicView(s: MatchState): MatchState { return { ...s, drag: null }; }', 'export function publicView(s: MatchState): MatchState { return { ...s }; }\nconst __peek = true;'],
  ['DB-06 硬殼無效', "export const lockSteps = (s: MatchState, side: Side) => (side === 'blue' && s.slots.includes('hardShell') ? TUNE.LOCK_SHELL : TUNE.LOCK);", 'export const lockSteps = (s: MatchState, side: Side) => TUNE.LOCK;'],
];
// 「AI 讀拖曳」需要真的用到拖曳：在選刀時優先挑終點最接近拖曳終點的候選
const PEEK_FROM = '  const pool = scored.filter((c) => c.v >= best * TUNE.AI_NEAR);';
const PEEK_TO = '  let pool = scored.filter((c) => c.v >= best * TUNE.AI_NEAR);\n  if (view.drag) { const d = view.drag; pool = pool.slice().sort((x, y) => Math.hypot(x.l.b[0] - d.b[0], x.l.b[1] - d.b[1]) - Math.hypot(y.l.b[0] - d.b[0], y.l.b[1] - d.b[1])).slice(0, 1); }';
let bad = 0;
try {
  for (const [name, from, to] of M) {
    if (!orig.includes(from)) { console.log(`SKIP ${name}：找不到原文`); bad++; continue; }
    let src = orig.replace(from, to);
    if (name.includes('讀拖曳')) src = src.replace(PEEK_FROM, PEEK_TO);
    writeFileSync(F, src);
    const r = spawnSync(process.execPath, ['--test', 'tests/node/duel_rules.test.ts'], { encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const fail = /ℹ fail (\d+)/.exec(out)?.[1] ?? (r.error ? 'timeout' : '?');
    const red = fail !== '0';
    if (!red) bad++;
    console.log(`${red ? 'RED  ' : 'GREEN'} ${name}：fail=${fail}`);
  }
} finally { writeFileSync(F, orig); }
console.log(bad ? `有 ${bad} 個突變沒被抓到` : '全部突變都被抓到');
process.exit(bad ? 1 : 0);
