# duel v0.5 FS 瀏覽器測試的突變驗紅：每個突變改壞 src/duel5_main.ts 一處 → 重建 → 跑 fs_tests（Chromium）→ 必須有對應項變紅（或測試程式異常結束，也算紅）；
# 改壞前先備份、跑完從同一份備份還原並重建。用法：python tests/fs_browser_mutation.py（會改寫 dist-*；不要和其他瀏覽器測試同時跑）
import subprocess, shutil, os
F = 'src/duel5_main.ts'
MUTS = [
 ('拿掉戰鬥期器官背後的深色暈影（主 session 指定）', [("g.addColorStop(0, 'rgba(7,13,25,0.9)'); g.addColorStop(0.75, 'rgba(7,13,25,0.7)'); g.addColorStop(1, 'rgba(7,13,25,0)');", "g.addColorStop(0, 'rgba(7,13,25,0)'); g.addColorStop(0.75, 'rgba(7,13,25,0)'); g.addColorStop(1, 'rgba(7,13,25,0)');")], 'FS-06 戰鬥可讀'),
 ('戰鬥期本體不調暗（回到 v0.4）', [("  const dimNow = G.ui === 'battle' || G.ui === 'contrib' ? BATTLE_DIM : G.ui === 'cut'", "  const dimNow = G.ui === 'battle' || G.ui === 'contrib' ? undefined : G.ui === 'cut'")], 'FS-06 戰鬥可讀'),
 ('開戰前對照少算一種', [("  G.matchupInfo = { me, foe, text:", "  delete (me as Record<string, number>)[Object.keys(me)[0]]; G.matchupInfo = { me, foe, text:")], 'FS-06 戰鬥可讀'),
 ('「清空！」同一步就開戰（沒有保留）', [("  if (G.game.phase === 'ko') G.pendingBattle = performance.now() + KO_HOLD_MS;", "  if (G.game.phase === 'ko') G.pendingBattle = performance.now() + 1;")], 'FS-06「清空！」'),
 ('跳字字級回到 26（約 14.6 CSS px）', [("const NUM_SIZE = 36, NUM_CRIT = 46;", "const NUM_SIZE = 26, NUM_CRIT = 46;")], 'FS-06 戰鬥可讀'),
 ('雙方跳字不錯開', [("const NUM_GAP_MS = 80;", "const NUM_GAP_MS = 0;")], 'FS-06 戰鬥可讀'),
 ('毒疊層沒有攻擊連線', [("G.lines.push({ from: [o.p[0], o.p[1]], to: [c[0], c[1]], t0: now, color: '124,255,107' }); glow(o.id); G.fxLog.push({ t: 'line', at: now, id: o.id, side: e.side });", "glow(o.id);")], 'FS-06 毒疊層'),
 ('器官行動沒有亮起紀錄', [("function glow(id: string): void { glowUntil.set(id, performance.now() + 260); G.fxLog.push({ t: 'act', at: performance.now(), id }); }", "function glow(id: string): void { glowUntil.set(id, performance.now() + 260); }")], 'FS-06 戰鬥可讀'),
 ('選擇沒有存下來（重開不記得）', [("  lastBeast = b; try { localStorage.setItem(BEAST_KEY, b); } catch { /* 略過 */ }", "  lastBeast = b;")], 'FS-05'),
 ('讀 localStorage 沒包 try（被封鎖時當掉）', [("try { const v = localStorage.getItem(BEAST_KEY); if (v === 'snake' || v === 'dragon') lastBeast = v; } catch {", "{ const v = localStorage.getItem(BEAST_KEY); if (v === 'snake' || v === 'dragon') lastBeast = v; } {")], 'FS-05'),
 ('技能鈕按了沒送進規則', [("  const skill = G.skillPress ? { blue: true } : undefined; G.skillPress = false;", "  const skill = undefined; G.skillPress = false;")], 'FS-07 技能鈕'),
 ('倒數中也能按技能', [("  b.disabled = used || !live || G.skillPress || (beast === 'dragon' && !canMolt);", "  b.disabled = used || G.skillPress || (beast === 'dragon' && !canMolt);")], 'FS-07 技能鈕'),
 ('?cut 在主程式沒作用', [("const CUT_S = parseCutSeconds(new URLSearchParams(location.search).get('cut'));", "const CUT_S = 30; void parseCutSeconds;")], '?cut=40'),
]
def run(cmd, **kw): return subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding='utf-8', **kw)
res = []
for name, pairs, pat in MUTS:
    shutil.copy(F, F + '.bak')
    try:
        s = open(F, encoding='utf-8', newline='').read(); nl = '\r\n' if '\r\n' in s else '\n'; s = s.replace('\r\n', '\n')
        bad = [a[:50] for a, b in pairs if s.count(a) != 1]
        if bad: res.append((name, 'NO-MATCH', bad)); continue
        for a, b in pairs: s = s.replace(a, b)
        open(F, 'w', encoding='utf-8', newline='').write(s.replace('\n', nl))
        b = run('node tools/build.mjs')
        if b.returncode: res.append((name, 'BUILD-FAIL', b.stderr[-300:])); continue
        r = run('node tests/browser/fs_run.mjs', env={**os.environ, 'FS_ONLY': 'chromium'}, timeout=1500)
        fails = [l[:100] for l in r.stdout.split('\n') if l.startswith('FAIL')]
        hit = [l for l in fails if pat in l]
        crashed = r.returncode != 0 and not fails
        res.append((name, 'RED' if hit else ('CRASH(測試程式異常結束，算紅)' if crashed else ('red(其他項)' if fails else 'green')), fails[:2] or [r.stderr[-200:]]))
    finally:
        shutil.move(F + '.bak', F)
run('node tools/build.mjs')
for x in res: print(x)
print('紅（對應項）', sum(1 for x in res if x[1] == 'RED'), '／異常結束', sum(1 for x in res if x[1].startswith('CRASH')), '/', len(res))
