# duel v0.5 FS 規則突變驗紅（Node 部分）：每個突變改壞一處、只跑相關測試（--test-name-pattern），必須變紅；改壞前先備份、跑完從同一份備份還原。
# 用法：python tests/fs_mutation.py
import subprocess, shutil
MUTS = [
 ('src/rtcut/rules.ts', "export const PIERCE_STEPS = 300, PIERCE_MAX = 3;", "export const PIERCE_STEPS = 300, PIERCE_MAX = 4;", 'FS-01', '穿刺最多連切 4 個'),
 ('src/rtcut/rules.ts', "        if (cur.pierce && !isLocked(s0, h.i)) {", "        if (cur.pierce) {", 'FS-01', '穿刺撞到已鎖的器官也照切'),
 ('src/rtcut/rules.ts', "    if (used || expired) { const rest:", "    if (expired) { const rest:", 'FS-01', '穿刺出刀後沒有用掉（可連續使用）'),
 ('src/rtcut/rules.ts', "    const expired = !used && k + 1 >= pz.until && !s.stroke?.[side]?.pierce;", "    const expired = false;", 'FS-01', '穿刺 5 秒內沒出刀也不失效'),
 ('src/rtcut/rules.ts', "      if (pz && k < pz.until) { st.pierce = true; st.cuts = []; }", "      st.pierce = true; st.cuts = [];", 'FS-01', '沒有按技能也帶穿刺'),
 ('src/rtcut/rules.ts', "    if (s.skillUsed?.[side]) { ev.push({ t: 'skillReject', side, why: 'used' }); continue; }", "    if (false) { ev.push({ t: 'skillReject', side, why: 'used' }); continue; }", 'FS-01|FS-02', '技能每場不只一次'),
 ('src/rtcut/rules.ts', "  const kind = s.severedQ[side].shift()!;\n  if (s.severedP) s.severedP[side].shift();", "  const kind = s.severedQ[side].pop()!;\n  if (s.severedP) s.severedP[side].pop();", 'FS-02|FS-04', '蛻生／再生取 FIFO 隊尾'),
 ('src/rtcut/rules.ts', "      if (i === null) { ev.push({ t: 'skillReject', side, why: 'none' }); continue; }   // 沒有可長回的器官：不能用、不算用掉", "      if (i === null) { s.skillUsed = { blue: true, red: true }; ev.push({ t: 'skillReject', side, why: 'none' }); continue; }", 'FS-02', '沒有可長回的器官也算用掉'),
 ('src/rtcut/rules.ts', "s.startN && 2 * countSide(s, 'red') <= s.startN.red) {", "s.startN && countSide(s, 'red') <= s.startN.red) {", 'FS-02', 'AI 蛻生門檻錯（存活 ≤ 開局數就用）'),
 ('src/rtcut/rules.ts', "  if (red && s.mode.beasts?.red === 'dragon' && !s.skillUsed?.red &&", "  if (s.mode.beasts?.red === 'dragon' && !s.skillUsed?.red &&", 'FS-02', 'AI 蛻生不等出刀生效那一步'),
 ('src/cutbattle/battle.ts', "          st[foe].poison += cnt(f.side, 'fang') > 0 ? 2 : 1;", "          st[foe].poison += 1;", 'FS-03', '蛇牙沒有效果'),
 ('src/cutbattle/battle.ts', "          st[foe].poison += cnt(f.side, 'fang') > 0 ? 2 : 1;", "          st[foe].poison += 1 + cnt(f.side, 'fang');", 'FS-03', '多顆蛇牙疊加'),
 ('src/rtcut/rules.ts', "  if (s.mode.originRegen?.includes(side) && s.severedP?.[side].length) {", "  if (false) {", 'FS-04', '蛇再生不長回原位（隨機重抽）'),
 ('src/cutbattle/snake_board.ts', "SNAKE_GAP_MIN + Math.floor(r() * 4)", "SNAKE_GAP_MIN - 6 + Math.floor(r() * 4)", 'FS-04', '蛇器官間距低於 74'),
 ('src/cutbattle/campaign.ts', "      if (d >= SNAKE_GAP_MIN && d <= SNAKE_GAP_MAX && out.every((q) => dist(q, p) > SLOT_GAP)) out.push(p);", "      if (out.every((q) => dist(q, p) > SLOT_GAP)) out.push(p);", 'FS-04', '蛇的縫合槽位不看間距'),
 ('src/cutbattle/campaign.ts', "  return Number.isInteger(n) && n >= 20 && n <= 60 ? n : CB.CUT_SECONDS;", "  return Number.isInteger(n) && n >= 19 && n <= 60 ? n : CB.CUT_SECONDS;", '補述 1 第 11', '?cut 接受 19'),
 ('src/cutbattle/campaign.ts', "  const m: Mode = { ...MODE_RT2, cutSteps: (c.cutSeconds ?? CB.CUT_SECONDS) * 60,", "  const m: Mode = { ...MODE_RT2, cutSteps: CB.CUT_SECONDS * 60,", '補述 1 第 11', '?cut 沒有作用'),
 ('src/rtcut/rules.ts', "if (cur.len < TAP_LEN && cur.locks.length === 0 && !cur.cuts?.length) {", "if (cur.len < TAP_LEN && cur.locks.length === 0) {", 'FS-01', '穿刺切中後短放開被當點擊（審查 C1）'),
 ('src/rtcut/rules.ts', "    const used = frees.some((f) => f.side === side && f.pierceUsed) || strikes.some((r) => r.side === side && r.pierced !== undefined);", "    const used = frees.some((f) => f.side === side && f.pierceUsed);", 'FS-01', '直線刀出手不算用掉穿刺（審查 H3）'),
 ('src/rtcut/rules.ts', "    const expired = !used && k + 1 >= pz.until && !s.stroke?.[side]?.pierce;", "    const expired = !used && k + 1 >= pz.until;", 'FS-01', '穿刺到期不管進行中的刀（審查 H3）'),
 ('src/rtcut/rules.ts', "    if (s.organs.some((o, i) => s.alive[i] && Math.hypot(o.p[0] - p![0], o.p[1] - p![1]) < 2 * rr)) return null;", "", 'FS-04', '再生不檢查原位有沒有被佔（審查 H3）'),
 ('src/rtcut/rules.ts', "    if (SIDES.some((o) => o !== side && s.mode.originRegen?.includes(o) && s.severedP?.[o].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2 * rr))) continue;", "", 'FS-04', '紅方再生可佔蛇的原位（審查 H1）'),
]
res = []
for f, a, b, pat, name in MUTS:
    shutil.copy(f, f + '.bak')
    try:
        s = open(f, encoding='utf-8', newline='').read(); nl = '\r\n' if '\r\n' in s else '\n'; s2 = s.replace('\r\n', '\n')
        if s2.count(a) != 1: res.append((name, 'NO-MATCH', s2.count(a))); continue
        open(f, 'w', encoding='utf-8', newline='').write(s2.replace(a, b).replace('\n', nl))
        r = subprocess.run(['node', '--test', f'--test-name-pattern={pat}', 'tests/node/fs_rules.test.ts'], capture_output=True, text=True, encoding='utf-8', timeout=1200)
        fails = [l.strip()[:90] for l in r.stdout.split('\n') if l.startswith('✖ ')]
        res.append((name, 'RED' if r.returncode else 'green', fails[:2]))
    finally:
        shutil.move(f + '.bak', f)
for x in res: print(x)
print('紅', sum(1 for x in res if x[1] == 'RED'), '/', len(res))
