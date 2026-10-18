# duel v0.4 FV 瀏覽器測試的突變驗紅：每個突變改壞 src/duel4_main.ts 一處（或幾處）→ 重建 → 跑 fv_tests（Chromium）→ 必須有對應項變紅；改壞前先備份、跑完還原並重建。
# 用法：python tests/fv_browser_mutation.py（會改寫 dist-*；不要和其他瀏覽器測試同時跑）
import subprocess, shutil
F = 'src/duel4_main.ts'
MUTS = [
 ('倒數期間指標事件照收（玩家可出刀）', [("function pushEv(k: PtrKind, p: V, ts: number): void { if (G.ui === 'cut' && !counting()) {", "function pushEv(k: PtrKind, p: V, ts: number): void { if (G.ui === 'cut') {"), ("const freeActive = () => G.input === 'free' && G.ui === 'cut' && !(G.tut && G.tut.phase === 'demo') && !counting();", "const freeActive = () => G.input === 'free' && G.ui === 'cut' && !(G.tut && G.tut.phase === 'demo');"), ("  if (G.ui === 'cut' && counting()) return;   // 倒數期間不能出刀\n", "")], 'FV-04 倒數'),
 ('倒數期間規則時鐘照走', [("  if (G.ui === 'cut' && !G.manual && !(G.tut && G.tut.phase === 'demo') && !counting()) {", "  if (G.ui === 'cut' && !G.manual && !(G.tut && G.tut.phase === 'demo')) {")], 'FV-04 倒數'),
 ('教學場沒有讓 AI 等待', [("  G.game = { ...G.game, aiHold: true };", "  void 0;")], 'FV-04 教學場'),
 ('玩家切除時整隻閃白（傳 body／rect）', [("side: o.side, kind: o.kind });\n    if (a) G.cutGlow", "side: o.side, kind: o.kind, body: ASSETS.body, rect: RECTS[o.side] });\n    if (a) G.cutGlow")], 'FV-06 回饋事件'),
 ('被切沒有紅色事件', [("    G.fxLog.push({ t: 'redHit', at: now, side: o.side, id: o.id });\n", "")], 'FV-06 回饋事件'),
 ('沒有 hit-stop', [("  if (G.fxOn) { G.hitstopUntil = now + HITSTOP_MS; G.slowUntil = now + HITSTOP_MS + SLOW_MS; G.fxLog.push({ t: 'hitstop', at: now }); }", "  if (G.fxOn) { G.slowUntil = now + SLOW_MS; }")], 'FV-06 回饋事件'),
 ('hit-stop 改到規則時間（演出開時多停 3 步）', [("  if (G.fxOn) { G.hitstopUntil = now + HITSTOP_MS;", "  if (G.fxOn) { G.game = { ...G.game, cdUntil: { ...G.game.cdUntil, blue: G.game.cdUntil.blue + 3 } }; G.hitstopUntil = now + HITSTOP_MS;")], 'FV-06 決定性'),
 ('沒有再生倒數圈', [("if (ci >= 0) next.add(ci); }", "if (ci >= 0 && ci < 0) next.add(ci); }")], 'FV-06 回饋事件'),
 ('放上後直接開下一場（沒有展示與按鈕）', [("  G.camp = r.c; sfx('place'); showcase();", "  G.camp = r.c; sfx('place'); startCut();")], 'FV-05 縫合'),
 ('展示只有 0.3 秒', [("const SHOWCASE_MS = 1500;", "const SHOWCASE_MS = 300;")], 'FV-05 縫合'),
 ('畫出的槽位少一個', [("      drawnSlots = stitchSlots(G.camp);", "      drawnSlots = stitchSlots(G.camp).slice(1);")], 'FV-05 縫合'),
 ('吸附不限距離（40 外也放）', [("  const q = snapSlot(G.camp, p);\n  if (!q) {", "  const q = snapSlot(G.camp, p) ?? stitchSlots(G.camp)[0];\n  if (!q) {")], 'FV-05 縫合'),
 ('結算標題出現時沒清畫布橫幅', [("  const b = G.battle!; G.ui = 'contrib'; G.banner = null;", "  const b = G.battle!; G.ui = 'contrib';")], 'FV-05 縫合'),
 ('範圍外只調暗到 0.6', [("const al = inR && o.side === 'red' && !inR[i] ? 0.4 : 1;", "const al = inR && o.side === 'red' && !inR[i] ? 0.6 : 1;")], 'C 範圍顯示'),
 ('按住加亮仍用「按下點 420 內」', [("  const r = reachNow(); G.game.organs.forEach((o, i) => { if (o.side === 'red' && r[i]) out.add(i); });", "  const fp = G.fp!; G.game.organs.forEach((o, i) => { if (o.side === 'red' && G.game.alive[i] && Math.hypot(o.p[0] - fp.start[0], o.p[1] - fp.start[1]) <= MAX_LEN) out.add(i); });")], 'C 範圍顯示'),
 ('慢幀時演出進度沒夾（負半徑丟例外，迴圈停住）', [("  for (const h of G.hurts) { const k = Math.max(0, (now - h.t0) / 350),", "  for (const h of G.hurts) { const k = (now - h.t0) / 350,"), ("  for (const g of G.grows) { const k = Math.max(0, (now - g.t0) / 600);", "  for (const g of G.grows) { const k = (now - g.t0) / 600;")], '回歸（慢幀當掉）'),
 ('前線帶不跟著 push 移動', [("    G.front = { from: frontNow(now), to: frontEdge(e.push), t0: now, flash: now, flashSide: e.push > prev ? 'blue' : 'red', push: e.push };", "    G.front = { ...G.front, flash: now, flashSide: e.push > prev ? 'blue' : 'red', push: e.push };")], 'B 前線帶'),
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
        r = run('node tests/browser/fv_run.mjs', env={**__import__('os').environ, 'FV_ONLY': 'chromium', 'FV_PART': 'fv'}, timeout=900)
        fails = [l[:90] for l in r.stdout.split('\n') if l.startswith('FAIL')]
        hit = [l for l in fails if pat in l]
        crashed = r.returncode != 0 and not fails
        res.append((name, 'RED' if hit else ('CRASH(測試程式異常結束，算紅)' if crashed else ('red(其他項)' if fails else 'green')), fails[:3] or [r.stderr[-200:]]))
    finally:
        shutil.move(F + '.bak', F)
run('node tools/build.mjs')
for x in res: print(x)
print('紅（對應項）', sum(1 for x in res if x[1] == 'RED'), '／異常結束', sum(1 for x in res if x[1].startswith('CRASH')), '/', len(res))
