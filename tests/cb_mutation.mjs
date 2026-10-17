// 對決 切割→戰鬥突變驗證（作者證據用）：逐一把規則改壞、跑 tests/node/cb_rules.test.ts，應該變紅；每次跑完一定還原。
// 用法：node tests/cb_mutation.mjs（工作樹的規則檔必須是乾淨的已提交版本）
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const M = [
  ['src/cutbattle/battle.ts', 'CB-02 暴擊沒有上限', 'crit: Math.min(BT.CRIT_CAP, BT.EYE_CRIT * cnt(s, \'eye\'))', "crit: BT.EYE_CRIT * cnt(s, 'eye')"],
  ['src/cutbattle/battle.ts', 'CB-02 加時不加倍', 'const mult = ms >= BT.OVERTIME_AT ? BT.OVERTIME_MULT : 1', 'const mult = 1'],
  ['src/cutbattle/battle.ts', 'CB-02 護盾不先吸收', 'const t = st[target], sh = Math.min(t.shield, dmg);', 'const t = st[target], sh = 0;'],
  ['src/cutbattle/battle.ts', 'CB-02 毒每次只扣 1', 'const victim = tm.tick, h = hit(victim, st[victim].poison, next);', 'const victim = tm.tick, h = hit(victim, 1, next);'],
  ['src/cutbattle/battle.ts', 'CB-02 心回血不設上限', 'amount = Math.min(BT.HEART_HEAL, me.maxHp - me.hp)', 'amount = BT.HEART_HEAL'],
  ['src/cutbattle/battle.ts', 'CB-02 同時歸零判藍勝', "return end(next, dead.length === 2 ? 'draw' : other(dead[0]), 'ko');", "return end(next, dead.length === 2 ? 'blue' : other(dead[0]), 'ko');"],
  ['src/cutbattle/battle.ts', 'CB-03 用 Math.random 決定暴擊', 'const crit = r() < st[f.side].crit;', 'const crit = Math.random() < st[f.side].crit;'],
  ['src/cutbattle/battle.ts', 'CB-02 歸零後同毫秒還能回血（審查 H1）', 'if (down.has(f.side)) { tm.at += tm.every; continue; }', ''],
  ['src/cutbattle/battle.ts', 'CB-02 毒直接穿過護盾（審查 M1②）', 'const victim = tm.tick, h = hit(victim, st[victim].poison, next);', 'const victim = tm.tick, h = (() => { const mult = next >= BT.OVERTIME_AT ? BT.OVERTIME_MULT : 1, dmg = st[victim].poison * mult; st[victim].hp = Math.max(0, st[victim].hp - dmg); return { raw: dmg, shieldHit: 0, hpHit: dmg }; })();'],
  ['src/cutbattle/battle.ts', 'CB-02 起點不錯開（審查 M1③）', 'const off = Math.round((r() * BT.OFFSET_MAX) / 10) * 10;', 'const off = (r(), 0);'],
  ['src/rtcut/rules.ts', 'CB-01 局長不套用（仍 40 秒）', 'export const endStep = (s: { mode: Mode }) => s.mode.cutSteps ?? END_STEP;', 'export const endStep = (s: { mode: Mode }) => END_STEP;'],
  ['src/rtcut/rules.ts', 'CB-01 再生位置只看圓心', "    if (s.mode.spawnRule === 'cb' && !validSpot(p, side)) continue;", ''],
  ['src/rtcut/rules.ts', 'CB-01 再生上限不看開場數', '(s.mode.maxPerSide?.[side] ?? MAX_PER_SIDE)', 'MAX_PER_SIDE'],
];
let bad = 0;
for (const [file, name, from, to] of M) {
  const orig = readFileSync(file, 'utf8');
  if (!orig.includes(from)) { console.log(`SKIP ${name}：找不到原文`); bad++; continue; }
  try {
    writeFileSync(file, orig.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', 'tests/node/cb_rules.test.ts'], { encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const fail = /ℹ fail (\d+)/.exec(out)?.[1] ?? (r.error ? 'timeout' : '?');
    if (fail === '0') bad++;
    console.log(`${fail !== '0' ? 'RED  ' : 'GREEN'} ${name}：fail=${fail}`);
  } finally { writeFileSync(file, orig); }
}
console.log(bad ? `有 ${bad} 個突變沒被抓到` : '全部突變都被抓到');
process.exit(bad ? 1 : 0);
