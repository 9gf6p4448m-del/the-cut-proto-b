// 串刺 K-1 突變驗紅（作者測試工具，不在一般測試流程內）：每個突變先備份 src/skewer/rules.ts，套用單點改動，
// 跑 tests/node/skewer_rules.test.ts，要求「該條規則的專屬測試（expect）失敗，而且失敗原因是 assert 行為斷言（ERR_ASSERTION），
// 不是型別、語法或例外」；其他測試連帶失敗只列出、不計；
// 驗完用備份還原並逐位元組比對（cmp）。用法：node tests/skewer_mutation.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = 'src/skewer/rules.ts';
const M = [
  { rule: '直線貫穿全身', name: '只算線段、不延伸', expect: 'K-1 直線貫穿全身', from: 'const hit = liveOrgans(board, s).filter((o) => lineTouchesCircle(a, b, organPos(o, s.turn), o.r));',
    to: 'const hit = liveOrgans(board, s).filter((o) => lineTouchesCircle(a, b, organPos(o, s.turn), o.r) && along(organPos(o, s.turn)) >= 0 && along(organPos(o, s.turn)) <= dx * dx + dy * dy);' },
  { rule: '爪被穿＝摘除', name: '爪不摘除', expect: 'K-1 爪被穿＝摘除', from: "export function removedOnHit(o: OrganDef): boolean { return o.kind === 'claw'; }", to: 'export function removedOnHit(o: OrganDef): boolean { return false; }' },
  { rule: '心肉受傷不摘除', name: '心肉被摘除', expect: 'K-1 心肉被穿', from: "export function removedOnHit(o: OrganDef): boolean { return o.kind === 'claw'; }", to: 'export function removedOnHit(o: OrganDef): boolean { return true; }' },
  { rule: '傷害＝總和×串數', name: '倍率不乘串數', expect: 'K-1 傷害＝', from: 'return { sum, mult, damage: sum * mult };', to: 'return { sum, mult, damage: sum };' },
  { rule: '毒囊被碰＝玩家受傷', name: '毒囊不扣血', expect: 'K-1 毒囊', from: 'let hpP = s.hpP - poisonDmg;', to: 'let hpP = s.hpP;' },
  { rule: '骨板擋住＝非法線', name: '骨板可穿', expect: 'K-1 骨板', from: 'if (board.plates.some((p) => lineTouchesPlate(a, b, p)))', to: 'if (false && board.plates.some((p) => lineTouchesPlate(a, b, p)))' },
  { rule: '可空切', name: '空切判非法', expect: 'K-1 可空切', from: 'return { legal: true, reason: null, hits: hit.map((o) => o.id), sacs };',
    to: "return hit.length === 0 ? { legal: false, reason: '不能空切', hits: [], sacs: [] } : { legal: true, reason: null, hits: hit.map((o) => o.id), sacs };" },
  { rule: '回合末剩下的爪攻擊', name: '被摘除的爪仍攻擊', expect: 'K-1 回合末剩下的爪攻擊', from: "board.organs.filter((o) => o.kind === 'claw' && !removed.includes(o.id))", to: "board.organs.filter((o) => o.kind === 'claw')" },
  { rule: '回合末剩下的爪攻擊', name: '爪不攻擊', expect: 'K-1 回合末剩下的爪攻擊', from: '    hpP -= clawDmg;\n', to: '\n' },
  { rule: '回合上限', name: '上限多給一回合', expect: 'K-1 回合上限', from: 'else if (s.turn >= board.turnLimit)', to: 'else if (s.turn > board.turnLimit)' },
  { rule: '勝負判定', name: '怪物要打到負數才勝', expect: 'K-1 勝負判定', from: "if (hpEAfter <= 0) result = 'win';", to: "if (hpEAfter < 0) result = 'win';" },
  { rule: '勝負判定', name: '玩家 HP 0 不算輸', expect: 'K-1 勝負判定', from: "    if (hpP <= 0) { result = 'lose'; loseReason = 'hp'; }\n    else if", to: "    if (hpP < 0) { result = 'lose'; loseReason = 'hp'; }\n    else if" },
  { rule: '勝負判定', name: '毒囊致死優先於勝利', expect: 'K-1 勝負判定', from: "  if (hpEAfter <= 0) result = 'win';\n  else if (hpP <= 0) { result = 'lose'; loseReason = 'hp'; }",
    to: "  if (hpP <= 0) { result = 'lose'; loseReason = 'hp'; }\n  else if (hpEAfter <= 0) result = 'win';" },
  { rule: '節律（K-2）', name: '往返軌改成跳回起點', expect: 'K-2 節律', from: 'return k < n ? k : period - k;', to: 'return k % n;' },
  { rule: '節律（K-2）', name: '每回合走兩格', expect: 'K-2 節律', from: 'const step = o.start + (turn - 1);', to: 'const step = o.start + 2 * (turn - 1);' },
];

const bak = join(mkdtempSync(join(tmpdir(), 'skewer-mut-')), 'rules.ts.bak');
copyFileSync(FILE, bak);
const orig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
try {
  for (const m of M) {
    const n = orig.split(m.from).length - 1;
    if (n !== 1) { console.log(`ERROR [${m.rule}] ${m.name}：原始碼片段出現 ${n} 次（應為 1）`); bad++; continue; }
    writeFileSync(FILE, orig.replace(m.from, m.to));
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/node/skewer_rules.test.ts'], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const blocks = out.split(/^(?=(?:not )?ok \d+ - )/m);
    const fails = blocks.filter((b) => b.startsWith('not ok')).map((b) => b.split('\n')[0].replace(/^not ok \d+ - /, ''));
    const target = blocks.find((b) => b.startsWith('not ok') && b.includes(m.expect));
    const assertion = !!target && /code: 'ERR_ASSERTION'/.test(target) && !/TypeError|ReferenceError|SyntaxError/.test(target);
    if (!assertion) bad++;
    console.log(`${assertion ? 'RED ' : 'MISS'} [${m.rule}] ${m.name}：專屬測試「${m.expect}…」${target ? (assertion ? '紅在 ERR_ASSERTION' : '紅但不是行為斷言') : '沒有紅'}；全套共 ${fails.length} 項失敗`);
    copyFileSync(bak, FILE);
  }
} finally {
  copyFileSync(bak, FILE);
}
const same = Buffer.compare(readFileSync(FILE), readFileSync(bak)) === 0;
const cmp = spawnSync('cmp', [FILE, bak], { encoding: 'utf8' });
console.log(`還原：Buffer 比對${same ? '相同' : '不同'}；cmp 結束碼 ${cmp.status ?? 'n/a'}（0＝相同）`);
console.log(`${M.length - bad}/${M.length} 突變驗紅`);
process.exit(bad || !same ? 1 : 0);
