import subprocess, shutil
MUTS = [
 ('src/rtcut/rules.ts', 'export const FREE_MIN_SPEED = 0.6;', 'export const FREE_MIN_SPEED = 0.55;', '速度門檻 0.6 改 0.55'),
 ('src/rtcut/rules.ts', 'if (pc.v >= FREE_MIN_SPEED) {', 'if (true) {', '沒有速度門檻'),
 ('src/rtcut/rules.ts', 'if (f.ended) s.cdUntil[f.side] = k + COOLDOWN_STEPS; }', 'if (f.ended) s.cdUntil[f.side] = (s0.stroke?.[f.side]?.startStep ?? k) + COOLDOWN_STEPS; }', '冷卻從起刀那一步算'),
 ('src/rtcut/freehand.ts', "for (let k = k0; k < k1; k++) { const q = at((k + 1) * STEP_MS); this.put(k, { k: 'seg', a: from, b: q, v }); from = q; }", '', '跨步線段不切開（整段歸到事件那一步）'),
 ('src/rtcut/rules.ts', 'const rem = MAX_LEN - cur.len, cut = L0 >= rem;', 'const rem = MAX_LEN - cur.len, cut = false;', '長度 420 不截止'),
 ('src/rtcut/rules.ts', "if (!isReady(s0, i) || cur.seen.includes(i)) return;", "if (!isReady(s0, i)) return;", '同一刀同一器官重複處理'),
 ('src/rtcut/rules.ts', "const t = entryDist(a, b, o.p, rr); if (t !== null) hits.push({ i, t }); });\n      hits.sort", "const t = entryDist(a, b, o.p); if (t !== null) hits.push({ i, t }); });\n      hits.sort", '即時刀判定半徑用 28'),
 ('src/rtcut/rules.ts', "        if (isLocked(s0, h.i)) finish(cur, 'blocked'", "        if (false) finish(cur, 'blocked'", '撞鎖不停刀（照切）'),
 ('src/rtcut/rules.ts', "        : ended || s0.cdUntil[side] > k ? 'cooldown'", "        : s0.cdUntil[side] > k ? 'cooldown'", '同一步內剛結束又起刀'),
 ('src/rtcut/rules.ts', "    if (pc.k === 'end') { finish(cur, pc.why, cur.start, [0, 0]); continue; }", "    if (pc.k === 'end' && pc.why === 'up') { finish(cur, pc.why, cur.start, [0, 0]); continue; }", 'cancel／第二指不結束'),
 ('src/rtcut/rules.ts', "        : !inside(pc.p, bodyOf(s0.mode, side)) ? 'start' : null;", "        : null;", '起刀不檢查獸身'),
 ('src/rtcut/rules.ts', "  if (red) { const r = resolveStrike(s0, 'red', red);", "  if (red) { const r = resolveStrike({ ...s0, lockUntil: s0.lockUntil.map((x, i) => (input.free?.blue ?? []).length && s0.organs[i].side === 'blue' ? s0.step + 999 : x) }, 'red', red);", 'AI 刀看到同一步藍方即時刀的鎖（不是步開始狀態）'),
 ('src/cutbattle/campaign.ts', "    if (validSpot(p, side, body, r) && taken.every((q) => dist(p, q) >= 2 * r + 4)) return p;", "    if (validSpot(p, side, body) && taken.every((q) => dist(p, q) >= 2 * R + 4)) return p;", '生成仍用半徑 28'),
]
res = []
for f, a, b, name in MUTS:
    shutil.copy(f, f + '.bak')
    s = open(f, encoding='utf-8', newline='').read()
    if s.count(a) != 1: res.append((name, 'NO-MATCH')); shutil.move(f + '.bak', f); continue
    open(f, 'w', encoding='utf-8', newline='').write(s.replace(a, b))
    r = subprocess.run('node --test tests/node/df_rules.test.ts', shell=True, capture_output=True, text=True, encoding='utf-8')
    fails = [l for l in r.stdout.split('\n') if l.startswith('✖ DF')]
    res.append((name, 'RED' if r.returncode else 'green', fails[:3]))
    shutil.move(f + '.bak', f)
for x in res: print(x)
