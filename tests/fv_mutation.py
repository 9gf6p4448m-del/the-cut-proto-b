# duel v0.4 FV 規則突變驗紅（Node 部分）：每個突變改壞一處、只跑相關的測試（--test-name-pattern），必須變紅；改壞前先備份、跑完還原。
# 用法：python tests/fv_mutation.py
import subprocess, shutil
MUTS = [
 ('src/rtcut/rules.ts', "for (const r of strikes) if (r.severed !== null) net += r.side === 'blue' ? 1 : -1;", "for (const r of strikes) if (r.severed !== null) net += r.side === 'blue' ? -1 : 1;", 'FV-01 推進值', '直線刀切除的推進方向反了'),
 ('src/rtcut/rules.ts', "for (const f of frees) if (f.ended && f.ended.severed !== null) net += f.side === 'blue' ? 1 : -1;", "for (const f of frees) if (f.ended && f.ended.severed !== null) net += 0;", 'FV-01 推進值', '即時刀切除不推進'),
 ('src/rtcut/rules.ts', "const m = s.mode.front.max, p = Math.max(-m, Math.min(m, (s.push ?? 0) + net));", "const m = s.mode.front.max, p = (s.push ?? 0) + net;", 'FV-01 推進值', '沒有上下限'),
 ('src/rtcut/rules.ts', "    if (net) { const m = s.mode.front.max, p = Math.max(-m, Math.min(m, (s.push ?? 0) + net)); if (p !== (s.push ?? 0)) { s.push = p; ev.push({ t: 'push', push: p, d: net }); } }", "    { const m = s.mode.front.max, nb = strikes.filter((r) => r.severed !== null && r.side === 'blue').length + frees.filter((f) => f.side === 'blue' && f.ended && f.ended.severed !== null).length, nr = strikes.filter((r) => r.severed !== null && r.side === 'red').length + frees.filter((f) => f.side === 'red' && f.ended && f.ended.severed !== null).length, p = Math.max(-m, Math.min(m, Math.max(-m, Math.min(m, (s.push ?? 0) + nb)) - nr)); if (p !== (s.push ?? 0)) { s.push = p; ev.push({ t: 'push', push: p, d: net }); } }", 'FV-01 推進值', '逐一夾限（先加玩家的再減 AI 的，每次都夾）'),
 ('src/rtcut/rules.ts', "export const extOf = (mode: Mode, push: number, side: Side): number => (mode.front ? Math.max(0, side === 'blue' ? push : -push) * mode.front.unit : 0);", "export const extOf = (mode: Mode, push: number, side: Side): number => (mode.front ? Math.max(0, side === 'blue' ? -push : push) * mode.front.unit : 0);", 'FV-01 起刀區|FV-02', '延伸方向反了（push 給錯陣營）'),
 ('src/rtcut/rules.ts', "  return segHitsPoly(p, [p[0], side === 'blue' ? p[1] + d : p[1] - d], own);", "  return inside([p[0], side === 'blue' ? p[1] + d : p[1] - d], own);", 'FV-01 延伸區在凹', '延伸區只看平移後的端點（凹處算錯）'),
 ('src/rtcut/rules.ts', "  return segHitsPoly(p, [p[0], side === 'blue' ? p[1] + d : p[1] - d], own);", "  return segHitsPoly(p, [p[0], side === 'blue' ? p[1] - d : p[1] + d], own);", 'FV-01 起刀區|FV-01 延伸區在凹', '延伸往反方向量'),
 ('src/rtcut/rules.ts', "  if (!startOk(s, side, raw.a)) return { ...base, ok: false, reject: 'start' };", "  if (!inside(raw.a, bodyOf(s.mode, side))) return { ...base, ok: false, reject: 'start' };", 'FV-01 起刀區|FV-02', '直線刀（AI）不用延伸起刀區'),
 ('src/rtcut/rules.ts', "        : !startOk(s0, side, pc.p) ? 'start' : null;", "        : !inside(pc.p, bodyOf(s0.mode, side)) ? 'start' : null;", 'FV-01 起刀區', '即時刀不用延伸起刀區'),
 ('src/rtcut/rules.ts', "  starts.push(...anchorsOf(s.mode, side), ...extAnchors(s.mode, s.push ?? 0, side));", "  starts.push(...anchorsOf(s.mode, side));", 'FV-02 AI 候選', 'AI 候選沒有延伸區起點'),
 ('src/rtcut/rules.ts', "  if (!s.aim && !s.aiHold && s.aiNextFire - AIM_STEPS <= s.step) {", "  if (!s.aim && s.aiNextFire - AIM_STEPS <= s.step) {", '教學場', '教學場 AI 照樣出刀'),
 ('src/rtcut/rules.ts', "    s.aiHold = false; s.aiNextFire = Math.max(s.aiNextFire, k + AI_FIRST_FIRE_STEP); ev.push({ t: 'aiRelease' });", "    s.aiHold = false; ev.push({ t: 'aiRelease' });", '教學場', '解除後 AI 第一刀沒有延後 60 步'),
 ('src/rtcut/reach.ts', "        if (best !== ti) continue;\n        const line: Line = { a: [a[0], a[1]], b };\n        const res = resolveStrike(probe, side, line);\n        if (res.ok && (res.severed === ti || res.blocked === ti)) { found = line; break; }", "        if (best < 0) continue;\n        const line: Line = { a: [a[0], a[1]], b };\n        const res = resolveStrike(probe, side, line); void res;\n        { found = line; break; }", 'FV-03 範圍一致（200', '範圍判定忽略擋路（碰到任何對方器官就算範圍內）'),
 ('src/rtcut/reach.ts', "    if (found) { inRange[ti] = true; witness[ti] = found; }", "    if (found && ti % 2 === 0) { inRange[ti] = true; witness[ti] = found; }", 'FV-03 範圍一致（200', '範圍內的器官被標成範圍外'),
 ('src/cutbattle/campaign.ts', "      if (!placeCheck(c, [x, y]) && out.every((q) => dist(q, [x, y]) > SLOT_GAP)) out.push([x, y]);", "      if (x % 30 === 0 && y % 30 === 0 && !placeCheck(c, [x, y])) out.push([x, y]);", 'FV-05 槽位', '槽位用 30 格網（補述 2 前的取法）'),
 ('src/cutbattle/campaign.ts', "export const SLOT_FINE = 5, SLOT_GAP = 30, SNAP_DIST = 40;", "export const SLOT_FINE = 5, SLOT_GAP = 30, SNAP_DIST = 60;", 'FV-05 槽位', '吸附距離 60（40 外沒有拒絕）'),
 ('src/cutbattle/campaign.ts', "  if (c.front) m.front = c.front;\n", "", 'FV-01 新的一場', '征途的場沒有前線推進'),
]
res = []
for f, a, b, pat, name in MUTS:
    shutil.copy(f, f + '.bak')
    s = open(f, encoding='utf-8', newline='').read()
    s2 = s.replace('\r\n', '\n')
    if s2.count(a) != 1: res.append((name, 'NO-MATCH')); shutil.move(f + '.bak', f); continue
    nl = '\r\n' if '\r\n' in s else '\n'
    open(f, 'w', encoding='utf-8', newline='').write(s2.replace(a, b).replace('\n', nl))
    try:
        r = subprocess.run(['node', '--test', f'--test-name-pattern={pat}', 'tests/node/fv_rules.test.ts'], capture_output=True, text=True, encoding='utf-8', timeout=1800)
        fails = [l.strip() for l in r.stdout.split('\n') if l.startswith('✖ ')]
        ran = [l for l in r.stdout.split('\n') if l.startswith('ℹ tests ')]
        res.append((name, 'RED' if r.returncode else 'green', ran, fails[:2]))
    finally:
        shutil.move(f + '.bak', f)
for x in res: print(x)
print('紅', sum(1 for x in res if x[1] == 'RED'), '/', len(res))
