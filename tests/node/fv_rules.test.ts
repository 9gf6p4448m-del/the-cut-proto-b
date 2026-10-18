// duel v0.4 前線推進（the-cut docs/fusion/DUEL_V04_FRONT.md＋補述 1／2，DL-086）FV-01／FV-02／FV-03 與 FV-05 槽位的 Node 部分。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIM_STEPS, BODY, LOCK_STEPS, MAX_LEN, aiChoose, candidates, entryDist, inStartZone, inside, isLocked, isReady, newGame, resolveStrike, step } from '../../src/rtcut/rules.ts';
import type { GameEvent, GameState, Line, Mode, OrganDef, Side, V } from '../../src/rtcut/rules.ts';
import { toPieces } from '../../src/rtcut/freehand.ts';
import type { PtrEv } from '../../src/rtcut/freehand.ts';
import { reachOf } from '../../src/rtcut/reach.ts';
import { BODY2, R3 } from '../../src/cutbattle/duel3_board.ts';
import { finishStage, matchFor, newCampaign, placeCheck, snapSlot, stitchSlots } from '../../src/cutbattle/campaign.ts';

const FRONT = { unit: 60, max: 4 };
const SNAP_SPEC = 40;   // 規格值（DUEL_V04_FRONT 三-3）：寫死，不引用程式常數（常數改了測試才會紅）
// 原版四邊形盤面：藍身 y 430～980、紅身 y 20～570（上緣／下緣都是水平線，延伸區好算）
const MODE: Mode = { knockout: true, regen: false, r: R3, front: FRONT };
const org = (id: string, side: Side, p: V): OrganDef => ({ id, side, kind: 'claw', p });
const game = (organs: OrganDef[], push = 0, mode: Mode = MODE): GameState => ({ ...newGame(1, mode, organs), aiNextFire: 10 ** 9, push });
const swipe = (a: V, b: V, t0: number, ms = 200, dt = 8): PtrEv[] => {
  const out: PtrEv[] = [{ t: t0, k: 'down', p: a }];
  for (let t = dt; t < ms; t += dt) out.push({ t: t0 + t, k: 'move', p: [a[0] + ((b[0] - a[0]) * t) / ms, a[1] + ((b[1] - a[1]) * t) / ms] });
  out.push({ t: t0 + ms, k: 'move', p: b }, { t: t0 + ms, k: 'up', p: b });
  return out;
};
interface Run { s: GameState; ev: { k: number; e: GameEvent }[] }
function run(s0: GameState, blue: PtrEv[], untilStep: number, extra: { redLine?: Record<number, Line>; blueLine?: Record<number, Line> } = {}): Run {
  const qb = toPieces(blue);
  let s = s0; const ev: Run['ev'] = [];
  while (s.step < untilStep && s.phase === 'cut') {
    const k = s.step;
    let st = s;
    if (extra.redLine?.[k]) st = { ...s, aim: { line: extra.redLine[k], aimStep: k - 1, fireStep: k } };
    const out = step(st, { free: qb.get(k) ? { blue: qb.get(k) } : undefined, blue: extra.blueLine?.[k] ?? null });
    for (const e of out.events) ev.push({ k, e });
    s = out.state;
  }
  return { s, ev };
}
const ofType = <T extends GameEvent['t']>(r: Run, t: T) => r.ev.filter((x) => x.e.t === t) as { k: number; e: Extract<GameEvent, { t: T }> }[];

// 藍爪 B1 (350,640)；紅爪 R1 (350,470)、R2 (500,470)
const B1 = org('B1', 'blue', [350, 640]), R1 = org('R1', 'red', [350, 470]), R2 = org('R2', 'red', [500, 470]);

// ---------------------------------------------------------------- FV-01
test('FV-01 推進值：玩家切除 +1、AI 切除 −1、同一步雙方都切除＝淨值 0；先淨值再夾（+4 時雙方各切一個仍是 +4）；上下限 ±4', () => {
  const blueCut = swipe([350, 700], [350, 400], 0);       // 藍刀往上劃過 R1
  const r1 = run(game([B1, R1, R2]), blueCut, 40);
  assert.equal(r1.s.push, 1, '玩家切除 → +1');
  assert.deepEqual(ofType(r1, 'push').map((x) => x.e.push), [1]);
  const redLine: Line = { a: [350, 300], b: [350, 720] };  // 紅刀往下切 B1
  const r2 = run(game([B1, R1]), [], 5, { redLine: { 2: redLine } });
  assert.equal(r2.s.push, -1, 'AI 切除 → −1');
  // 同一步雙方都切除：藍直線刀切 R2、紅直線刀切 B1
  const both = (p0: number) => run(game([B1, R1, R2], p0), [], 5, { blueLine: { 2: { a: [500, 700], b: [500, 400] } }, redLine: { 2: redLine } });
  const b0 = both(0); assert.equal(b0.s.push, 0, '淨值 0'); assert.equal(ofType(b0, 'push').length, 0);
  assert.equal(both(4).s.push, 4, '+4 時雙方各切一個：先淨值（0）再夾＝+4（逐一夾會是 +3）');
  assert.equal(both(-4).s.push, -4);
  // 上限：+4 再切 → 仍 +4、沒有 push 事件；下限同理
  const up = run(game([B1, R1, R2], 4), blueCut, 40); assert.equal(up.s.push, 4); assert.equal(ofType(up, 'push').length, 0);
  const dn = run(game([B1, R1], -4), [], 5, { redLine: { 2: redLine } }); assert.equal(dn.s.push, -4);
  const dn2 = run(game([B1, R1], -3), [], 5, { redLine: { 2: redLine } }); assert.equal(dn2.s.push, -4);
});

test('FV-01 撞鎖、鎖定、再生都不改變推進值', () => {
  // 鎖定：藍刀劃過自己的 B1（不碰紅方）
  const lk = run(game([B1, R1]), swipe([250, 700], [450, 600], 0), 40);
  assert.ok(ofType(lk, 'freeLock').length > 0); assert.equal(lk.s.push, 0);
  // 撞鎖：R1 已鎖，藍刀撞上 → blocked，push 不變
  const g = game([B1, R1], 2); g.lockUntil[1] = LOCK_STEPS;
  const bl = run(g, swipe([350, 700], [350, 400], 0), 40);
  assert.equal(ofType(bl, 'freeEnd')[0].e.why, 'blocked'); assert.equal(bl.s.push, 2);
  // 再生：開再生的盤面，切下後等到再生節拍長回，push 只因切除改變一次
  const m: Mode = { ...MODE, regen: true };
  const rg = run(game([B1, R1, R2], 0, m), swipe([350, 700], [350, 400], 0), 320);
  assert.ok(ofType(rg, 'spawn').length > 0, '有再生'); assert.equal(rg.s.push, 1); assert.equal(ofType(rg, 'push').length, 1);
});

test('FV-01 新的一場從 0 開始（征途的每一場、重開都是 matchFor 產生的新狀態）', () => {
  const c = newCampaign(7, BODY2, R3, FRONT);
  assert.equal(matchFor(c).push ?? 0, 0);
  assert.ok(matchFor(c).mode.front, 'duel4 的場有前線推進');
  const won = finishStage(c, ['claw'], { winner: 'blue', how: 'ko', events: [], hp: { blue: 1, red: 0 }, maxHp: { blue: 1, red: 1 } } as never);
  assert.equal(matchFor({ ...won, stage: 1, phase: 'cut' }).push ?? 0, 0, '第二場也是 0');
  assert.equal(matchFor(newCampaign(7, BODY2, R3, FRONT)).push ?? 0, 0, '重開＝新征途，0');
  assert.equal(matchFor(newCampaign(7, BODY2, R3)).mode.front, undefined, 'duel3 的場沒有前線推進');
});

test('FV-01 起刀區：延伸區內的點 push=0 拒絕、push=1 允許；延伸區外都拒絕；AI 端鏡像（紅往下延伸）', () => {
  const P: V = [200, 400];      // 紅身內、藍身上緣（430）往上 30：在 push=1 的延伸區內
  const Q: V = [200, 350];      // 往上 80：push=1 不在、push=2 在
  const X: V = [200, 15];       // 紅身外（紅身 y≥20）
  // 規則判定（即時劃刀）：按下點的 freeReject／freeStart
  const startAt = (p: V, push: number) => { const r = run(game([B1, R1], push), swipe(p, [p[0] + 1, p[1] - 200], 0), 30); return ofType(r, 'freeStart').length ? 'ok' : ofType(r, 'freeReject')[0]?.e.reason; };
  assert.equal(startAt(P, 0), 'start', 'push=0：P 被拒');
  assert.equal(startAt(P, 1), 'ok', 'push=1：P 允許');
  assert.equal(startAt(Q, 1), 'start', 'push=1：Q（延伸區外）被拒');
  assert.equal(startAt(Q, 2), 'ok', 'push=2：Q 允許');
  assert.equal(startAt(X, 4), 'start', '紅身外永遠被拒');
  assert.equal(startAt(P, -4), 'start', 'push<0：玩家沒有延伸');
  // 直線刀（AI 用的 resolveStrike）同一個起刀區：紅方在藍身內、紅身下緣（570）往下 30 的點
  const Pr: V = [200, 600], line = (a: V): Line => ({ a, b: [a[0], a[1] + 300] });
  const red = (push: number) => resolveStrike({ ...game([B1, R1], push), cdUntil: { blue: 0, red: 0 } }, 'red', line(Pr)).reject ?? 'ok';
  assert.equal(red(0), 'start'); assert.equal(red(1), 'start'); assert.equal(red(-1), 'ok'); assert.equal(red(-4), 'ok');
  const blueLine = (push: number) => resolveStrike(game([B1, R1], push), 'blue', { a: P, b: [P[0], P[1] - 300] }).reject ?? 'ok';
  assert.equal(blueLine(0), 'start'); assert.equal(blueLine(1), 'ok');
});

test('FV-01 延伸區在凹的 BODY2 上精確＝「往自己方向 0..d 的垂直線段碰到自己獸身」（獨立逐點取樣 0.25 單位比對，3 萬點）', () => {
  const mode: Mode = { knockout: true, regen: true, r: R3, body: BODY2, front: FRONT };
  let n = 0, bad = 0, ext = 0;
  for (const push of [1, 2, 4, -1, -3]) for (const side of ['blue', 'red'] as Side[]) for (let k = 0; k < 3000; k++) {
    const p: V = [((k * 7919) % 700) + 0.37, ((k * 104729) % 1000) + 0.61];
    const d = Math.max(0, side === 'blue' ? push : -push) * 60;
    let want = inside(p, BODY2[side]);
    if (!want && d > 0 && inside(p, BODY2[side === 'blue' ? 'red' : 'blue'])) for (let t = 0; t <= d && !want; t += 0.25) want = inside([p[0], side === 'blue' ? p[1] + t : p[1] - t], BODY2[side]);
    const got = inStartZone(mode, push, side, p);
    n++; if (got !== want) bad++; if (got && !inside(p, BODY2[side])) ext++;
  }
  assert.ok(ext > 500, `有延伸區點被取樣到（${ext}）`);
  assert.ok(bad <= 3, `不一致 ${bad}/${n}（只容許取樣 0.25 單位造成的邊界誤差）`);
});

// ---------------------------------------------------------------- FV-02
test('FV-02 AI 候選起點：push<0 時有一部分在延伸區；push=0／push>0 時全部在自己獸身內；AI 不讀玩家拖曳／進行中的刀', () => {
  const c = newCampaign(11, BODY2, R3, FRONT), g0 = matchFor(c);
  for (const push of [0, 2, 4]) {
    const starts = candidates({ ...g0, push }, 'red').map((l) => l.a);
    assert.ok(starts.every((a) => inside(a, BODY2.red)), `push=${push}：全部在紅身內`);
  }
  for (const push of [-1, -4]) {
    const starts = candidates({ ...g0, push }, 'red').map((l) => l.a);
    const ext = starts.filter((a) => !inside(a, BODY2.red));
    assert.ok(ext.length > 0, `push=${push}：有延伸區起點`);
    assert.ok(ext.every((a) => inStartZone(g0.mode, push, 'red', a)), '延伸區起點都在規則的起刀區');
  }
  // AI 選刀：同一盤面，玩家拖曳線／進行中的刀不同 → 選到同一刀
  const g = { ...g0, push: -2, step: 100 };
  const a1 = aiChoose(g), a2 = aiChoose({ ...g, drag: { blue: { a: [300, 800], b: [300, 400] }, red: null }, stroke: { blue: { start: [300, 800], len: 50, seen: [], locks: [], startStep: 90 } } });
  assert.deepEqual(a1, a2);
});

test('FV-02／補述 1 第 3 條 AI 刀線在預告時固定、生效那一步用步開始狀態（含 push）重判：push 從 −1 變 0 後延伸區起點被拒', () => {
  const Pr: V = [200, 600];
  const g = { ...game([B1, R1], 0), aim: { line: { a: Pr, b: [200, 900] } as Line, aimStep: 0, fireStep: 1 }, step: 1 };
  const out = step(g, {});
  assert.ok(out.events.some((e) => e.t === 'reject' && e.side === 'red' && e.reason === 'start'));
  const ok = step({ ...g, push: -1 }, {});
  assert.ok(ok.events.some((e) => e.t === 'strike' && e.r.side === 'red'));
});

test('補述 1 第 4 條 教學場：aiHold 時 AI 不預告不出刀；玩家第一次鎖定（或切除）的那一步 L 起解除，AI 第一刀 ≥ L+60', () => {
  const g = { ...game([B1, R1]), aiNextFire: 60, aiHold: true };
  const idle = run(g, [], 400);
  assert.equal(ofType(idle, 'aim').length, 0, '沒有預告'); assert.equal(idle.s.aiHold, true);
  const lk = run(g, swipe([250, 700], [450, 600], 1000), 700);   // 第 60 步左右鎖定 B1
  const L = ofType(lk, 'aiRelease')[0].k, fire = ofType(lk, 'aim')[0];
  assert.ok(ofType(lk, 'freeLock')[0].k === L, '解除在鎖定那一步');
  assert.ok(fire && fire.e.aim.fireStep >= L + 60, `第一刀 ${fire?.e.aim.fireStep} ≥ ${L + 60}`);
  assert.ok(fire.e.aim.fireStep - fire.e.aim.aimStep >= AIM_STEPS);
});

// ---------------------------------------------------------------- FV-03
/** 獨立枚舉（不經 reach.ts）：起刀區上 8 單位網格（錯開 3、5，和 reach.ts 的 4 單位網格不重疊）的每個起點 × 角度 2.5°＋5° 的倍數（步長 5°，和 reach.ts 的 1° 不重疊）、
 * 長 420 的直線，問「有沒有一條線第一個碰到的對方器官是 ti」。只試會通過 ti 圓的角度（其他角度碰不到 ti），結果與全量枚舉相同。 */
function bruteCanHitFirst(s: GameState, side: Side, ti: number, zonePts: V[]): boolean {
  const r = s.mode.r ?? 28, c = s.organs[ti].p;
  const enemies = s.organs.map((o, i) => i).filter((i) => s.organs[i].side !== side && isReady(s, i));
  for (const [x, y] of zonePts) {
    const d = Math.hypot(c[0] - x, c[1] - y);
    if (d > MAX_LEN + r) continue;
    const th = (Math.atan2(c[1] - y, c[0] - x) * 180) / Math.PI, w = d <= r ? 180 : (Math.asin(r / d) * 180) / Math.PI;
    for (let a = Math.ceil((th - w - 2.5) / 5) * 5 + 2.5; a <= th + w; a += 5) {
      const b: V = [x + Math.cos((a * Math.PI) / 180) * MAX_LEN, y + Math.sin((a * Math.PI) / 180) * MAX_LEN];
      let best = -1, bt = Infinity;
      for (const i of enemies) { const t = entryDist([x, y], b, s.organs[i].p, r); if (t !== null && (t < bt || (t === bt && i < best))) { bt = t; best = i; } }
      if (best === ti) return true;
    }
  }
  return false;
}
const zoneGrid = (s: GameState, side: Side): V[] => { const out: V[] = []; for (let y = 5; y <= 1000; y += 8) for (let x = 3; x <= 700; x += 8) if (inStartZone(s.mode, s.push ?? 0, side, [x, y])) out.push([x, y]); return out; };
function randomState(seed: number): GameState {
  let x = seed * 2654435761 >>> 0; const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const g = matchFor({ ...newCampaign(seed, BODY2, R3, FRONT), stage: seed % 3 });
  const s: GameState = { ...g, alive: [...g.alive], lockUntil: [...g.lockUntil], push: Math.floor(rnd() * 9) - 4, step: 200 };
  for (let k = 0, n = Math.floor(rnd() * 4); k < n; k++) s.alive[Math.floor(rnd() * s.organs.length)] = false;
  for (let k = 0, n = Math.floor(rnd() * 3); k < n; k++) s.lockUntil[Math.floor(rnd() * s.organs.length)] = s.step + 100;
  return s;
}
test('FV-03 範圍一致（200 種子＋隨機 push／切除／鎖定）：標「範圍外」的器官獨立枚舉找不到一刀先碰到它；標「範圍內」的見證刀經規則確認先碰到它；錯標 0、範圍外 >0', () => {
  let outN = 0, inN = 0, wrongOut = 0, wrongIn = 0; const ex: string[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const s = randomState(seed);
    for (const side of ['blue', 'red'] as Side[]) {
      const rc = reachOf(s, side), zp = zoneGrid(s, side);
      const probe = { ...s, cdUntil: { blue: 0, red: 0 } };
      s.organs.forEach((o, i) => {
        if (o.side === side || !isReady(s, i)) return;
        if (rc.inRange[i]) {
          inN++;
          const res = resolveStrike(probe, side, rc.witness[i]!);
          if (!(res.ok && (res.severed === i || res.blocked === i))) { wrongIn++; ex.push(`in ${seed}/${side}/${o.id}`); }
        } else {
          outN++;
          if (bruteCanHitFirst(s, side, i, zp)) { wrongOut++; ex.push(`out ${seed}/${side}/${o.id} push=${s.push} locked=${isLocked(s, i)}`); }
        }
      });
    }
  }
  console.log(`[FV-03] 範圍內 ${inN}、範圍外 ${outN}（${((100 * outN) / (inN + outN)).toFixed(1)}%）；錯標：範圍外卻被枚舉找到 ${wrongOut}、範圍內見證刀不成立 ${wrongIn}`);
  assert.ok(outN > 0, '範圍外的器官數 >0');
  assert.equal(wrongOut + wrongIn, 0, ex.slice(0, 5).join('；'));
});

test('FV-03 只回報：範圍外比例 push=0 對 push=±4（200 種子、隨機切除／鎖定，同一批盤面只換 push）', () => {
  const rows: string[] = [];
  for (const side of ['blue', 'red'] as Side[]) {
    const ratio = (push: number) => { let o = 0, t = 0; for (let seed = 1; seed <= 200; seed++) { const s = { ...randomState(seed), push }, rc = reachOf(s, side); s.organs.forEach((g, i) => { if (g.side !== side && isReady(s, i)) { t++; if (!rc.inRange[i]) o++; } }); } return { o, t }; };
    const own = side === 'blue' ? 4 : -4, a = ratio(0), b = ratio(own), c = ratio(-own);
    rows.push(`${side === 'blue' ? '玩家' : 'AI'}碰不到的對方器官：push=0 ${a.o}/${a.t}（${((100 * a.o) / a.t).toFixed(1)}%）、己方推進 ${own > 0 ? '+4' : '−4'} ${b.o}/${b.t}（${((100 * b.o) / b.t).toFixed(1)}%）、對方推進 ${b.t ? (own > 0 ? '−4' : '+4') : ''} ${c.o}/${c.t}`);
    assert.ok(b.o <= a.o, '己方推進不會讓範圍外變多');
  }
  console.log('[FV-03 比例] ' + rows.join('；'));
});

/** 中盤盤面：雙方都由 AI 出刀（藍方也用 aiChoose），跑到再生至少發生一次。 */
function midState(seed: number): GameState | null {
  let s: GameState = { ...matchFor({ ...newCampaign(seed, BODY2, R3, FRONT), stage: seed % 3 }), aiNextFire: 60 };
  let spawned = 0;
  while (s.step < 1500 && s.phase === 'cut') {
    let blue: Line | null = null;
    if (s.step % 100 === 50 && s.cdUntil.blue <= s.step) { const pk = aiChoose(s, 'blue'); blue = pk.line; s = { ...s, rng: pk.rng }; }
    const out = step(s, { blue }); s = out.state; spawned += out.events.filter((e) => e.t === 'spawn').length;
    if (spawned > 0 && s.step >= 960) break;
  }
  return s.phase === 'cut' && spawned > 0 ? s : null;
}
test('FV-03 只回報（主 session 追加）：中盤（切掉又長回之後）與對方 1～3 個器官被鎖時的範圍外比例，push=0 對 ±4', () => {
  const rows: string[] = [];
  const tally = (states: GameState[], side: Side, push: number) => { let o = 0, t = 0; for (const s0 of states) { const s = { ...s0, push }, rc = reachOf(s, side); s.organs.forEach((g, i) => { if (g.side !== side && isReady(s, i)) { t++; if (!rc.inRange[i]) o++; } }); } return `${o}/${t}（${t ? ((100 * o) / t).toFixed(1) : '0'}%）`; };
  const mids: GameState[] = []; for (let seed = 1; seed <= 60 && mids.length < 40; seed++) { const m = midState(seed); if (m) mids.push(m); }
  const locked = (side: Side) => { const out: GameState[] = []; for (let seed = 1; seed <= 200; seed++) { const g = matchFor({ ...newCampaign(seed, BODY2, R3, FRONT), stage: seed % 3 }); const en = g.organs.map((o, i) => i).filter((i) => g.organs[i].side !== side); const s: GameState = { ...g, step: 200, lockUntil: [...g.lockUntil] }; for (let k = 0, n = 1 + (seed % 3); k < n; k++) s.lockUntil[en[(seed * 7 + k * 13) % en.length]] = 500; out.push(s); } return out; };
  for (const side of ['blue', 'red'] as Side[]) {
    const own = side === 'blue' ? 4 : -4, who = side === 'blue' ? '玩家' : 'AI', L = locked(side);
    rows.push(`${who}・中盤（${mids.length} 盤）push=0 ${tally(mids, side, 0)}、push=${own > 0 ? '+4' : '−4'} ${tally(mids, side, own)}`);
    rows.push(`${who}・對方 1～3 個被鎖（${L.length} 盤）push=0 ${tally(L, side, 0)}、push=${own > 0 ? '+4' : '−4'} ${tally(L, side, own)}`);
  }
  console.log('[FV-03 比例・追加] ' + rows.join('；'));
  assert.ok(mids.length > 0);
});

// ---------------------------------------------------------------- FV-05（槽位的 Node 部分）
test('FV-05 槽位：每個槽位都通過 placeCheck；每個 5 單位合法點到最近槽位 ≤40；所有槽位 40 外的點吸附失敗（拒絕）', () => {
  let slots = 0, legal = 0, worst = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const c = newCampaign(seed, BODY2, R3, FRONT), sl = stitchSlots(c);   // 槽位清單算一次，吸附判定傳同一份
    let spot = 0;
    slots += sl.length;
    for (const q of sl) assert.equal(placeCheck(c, q), null, `槽位 ${q} 合法`);
    for (let y = 0; y <= 1000; y += 5) for (let x = 0; x <= 700; x += 5) {
      const d = Math.min(...sl.map((q) => Math.hypot(q[0] - x, q[1] - y)));
      if (!placeCheck(c, [x, y])) { legal++; worst = Math.max(worst, d); assert.ok(d <= SNAP_SPEC, `合法點 ${x},${y} 到最近槽位 ${d.toFixed(1)}`); }
      if (d > SNAP_SPEC) assert.equal(snapSlot(c, [x, y], sl), null);
      else assert.ok(snapSlot(c, [x, y], sl) !== null);
      if (spot++ % 997 === 0 && spot < 5000) assert.deepEqual(snapSlot(c, [x, y]), snapSlot(c, [x, y], sl), '不傳清單時結果相同');   // 抽查 5 點（每次都會重算整份清單）
    }
  }
  console.log(`[FV-05] 20 種子：槽位 ${slots} 個、5 單位合法點 ${legal} 個、最遠 ${worst.toFixed(1)}`);
  assert.ok(slots > 0 && legal > 0);
  assert.deepEqual(BODY.blue.length > 0, true);
});
