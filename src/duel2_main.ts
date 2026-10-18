// duel v0.2「美術合併」（子路徑 duel2/，the-cut docs/fusion/DUEL_ART_V02.md，DL-083）：切割→戰鬥（duel/ v0.1）的玩法原封不動，畫面改用幽光美術模組 v2（src/art/sprites.ts）。
// 唯一的規則面差異：獸身多邊形改用已確認邊界（src/cutbattle/duel2_board.ts 的 BODY2），由 Campaign.body → Mode.body 傳進規則。
// 規則：切割期 src/rtcut/rules.ts；戰鬥期 src/cutbattle/battle.ts；征途 src/cutbattle/campaign.ts。本檔只負責輸入、播放事件、演出與說明（流程沿用 src/cutbattle_main.ts）。
import type { Kind as ArtKind } from './art/sprites.ts';   // 只用於型別斷言（duel5 加了蛇牙後，rules 的 Kind 比 art-kit 多一種）
import { COOLDOWN_STEPS, FPS, KIND_ZH, LOCK_STEPS, MIN_LEN, R, clampLine, countSide, endStep, isLocked, isReady, resolveStrike, step } from './rtcut/rules.ts';
import type { GameEvent, GameState, Kind, Line, Side, StrikeResult, V } from './rtcut/rules.ts';
import { BT, simulateBattle } from './cutbattle/battle.ts';
import type { BattleEvent, BattleResult } from './cutbattle/battle.ts';
import { CB, battleSeed, finishStage, fightersOf, matchFor, newCampaign, pickStitch, placeCheck, placeStitch } from './cutbattle/campaign.ts';
import type { Campaign, PlaceReject } from './cutbattle/campaign.ts';
import { BODY2, RECTS } from './cutbattle/duel2_board.ts';
import { drawBlade, drawDuelScene, drawOrganSprite, drawSlot, drawSuture, loadAssets, loadLog, playFx2, shake2 } from './art/sprites.ts';
import type { Assets, Fx2, OrganState } from './art/sprites.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const W = 700, H = 1000, STEP_MS = 1000 / FPS;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), sha: $('sha'), stage: $('stage'), phase: $('phase'), clock: $('clock'),
  meBar: $('meBar'), meShield: $('meShield'), meTxt: $('meTxt'), foeBar: $('foeBar'), foeShield: $('foeShield'), foeTxt: $('foeTxt'),
  cd: $('cd'), info: $('info'), tip: $('tip'),
  sound: $<HTMLButtonElement>('sound'), fast: $<HTMLButtonElement>('fast'), restart: $<HTMLButtonElement>('restart'),
  contrib: $('contrib'), contribTitle: $('contribTitle'), contribBody: $('contribBody'), contribNext: $<HTMLButtonElement>('contribNext'),
  pick: $('pick'), pickOpts: $('pickOpts'),
  end: $('end'), endTitle: $('endTitle'), endBody: $('endBody'), again: $<HTMLButtonElement>('again'),
  loading: $('loading'), loadErr: $('loadErr'), loadMsg: $('loadMsg'), loadLog: $('loadLog'), retry: $<HTMLButtonElement>('retry'),
};
els.sha.textContent = BUILD_SHA;

// ---------------------------------------------------------------- 說明文字（點器官、首次出現、選縫合共用）
export const DESC = {
  claw: { role: '攻擊手', line: `爪：每 ${BT.CLAW_EVERY / 1000} 秒攻擊一次，造成 ${BT.CLAW_DMG}` },
  heart: { role: '生命', line: `心：血量上限 +${BT.HEART_HP}，每 ${BT.HEART_EVERY / 1000} 秒回 ${BT.HEART_HEAL}` },
  eye: { role: '暴擊', line: `眼：我方爪暴擊率 +${BT.EYE_CRIT * 100}%（上限 ${BT.CRIT_CAP * 100}%），暴擊 ×${BT.CRIT_MULT}` },
  poison: { role: '持續傷害', line: `毒：每 ${BT.POISON_EVERY / 1000} 秒讓對手疊 1 層毒，每層每秒 1 傷害` },
  bone: { role: '護盾', line: `骨：開戰提供 ${BT.BONE_SHIELD} 護盾，先吸收傷害` },
} as Record<Kind, { role: string; line: string }>;   // 型別斷言：rules 的 Kind 含 duel5 的蛇牙，本版不會出現
const REJECT_TEXT: Record<PlaceReject, string> = { outside: '這裡放不下：器官要整個在獸身裡', unreachable: '這裡放不下：對方的刀碰不到這裡（不能藏起來）', overlap: '這裡放不下：和其他器官重疊' };

// ---------------------------------------------------------------- 狀態
type Ui = 'cut' | 'battle' | 'contrib' | 'pick' | 'place' | 'end';
interface Pop { p: V; text: string; color: string; t0: number; life: number; size: number }
interface Particle { p: V; v: V; c: string; t0: number; life: number; r: number }
interface Shot { from: V; to: V; t0: number; dur: number; color: string; crit: boolean; side: Side }
const G = {
  token: 0, camp: null as unknown as Campaign, game: null as unknown as GameState, ui: 'cut' as Ui,
  seedSource: (): number => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
  manual: false, acc: 0, lastT: null as number | null, speed: 1,
  drag: null as { id: number; a: V; b: V; moved: number } | null, release: null as Line | null,
  preview: null as StrikeResult | null, cutByMe: [] as Kind[], lastStrike: null as StrikeResult | null,
  battle: null as BattleResult | null, bT0: 0, bBase: 0, bClock: 0, bIdx: 0, battleScale: 1,
  disp: { blue: { hp: 0, max: 1, shield: 0, poison: 0 }, red: { hp: 0, max: 1, shield: 0, poison: 0 } },
  vis: [] as { kind: Kind | 'overtime'; ev: BattleEvent['t'] }[], tipsShown: new Set<string>(),
  pops: [] as Pop[], particles: [] as Particle[], shots: [] as Shot[], slashes: [] as { a: V; b: V; t0: number; side: Side }[],
  shakeUntil: 0, flashUntil: 0, banner: null as null | { text: string; sub: string; t0: number; life: number },
  fx: [] as Fx2[], bursts: [] as { o: { id: string; kind: Kind; side: Side; p: V }; t0: number; ang: number }[],
  sound: true, ghost: null as V | null, ghostOk: false, placing: null as number | null, aimFirst: 0,
};
try { G.sound = localStorage.getItem('duel-cb-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }

// ---------------------------------------------------------------- 版面
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1); cw = r.width; ch = r.height;   // 解析度上限 2（DA-06 降級措施）
  els.canvas.width = Math.round(cw * dpr); els.canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / W, ch / H); ox = (cw - W * scale) / 2; oy = (ch - H * scale) / 2;
}
const toWorld = (cx: number, cy: number): V => { const r = els.canvas.getBoundingClientRect(); return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale]; };
const toScreen = (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + ox + x * scale, y: r.top + oy + y * scale }; };

// ---------------------------------------------------------------- 音效
let actx: AudioContext | null = null;
const audioLog: string[] = [];
function ac(): AudioContext | null {
  if (!G.sound) return null;
  try { if (!actx) { const C = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; const K = C.AudioContext || C.webkitAudioContext; if (!K) return null; actx = new K(); } if (actx.state === 'suspended') void actx.resume(); return actx; } catch { return null; }
}
function tone(f: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 1): void {
  const c = ac(); if (!c) return;
  try { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime); o.frequency.exponentialRampToValueAtTime(f * slide, c.currentTime + dur); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur); } catch { /* 略過 */ }
}
function noise(dur: number, f0: number, f1: number, gain: number): void {
  const c = ac(); if (!c) return;
  try { const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(f0, c.currentTime); f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur); const g = c.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(c.destination); s.start(); } catch { /* 略過 */ }
}
function sfx(k: 'slash' | 'sever' | 'block' | 'claw' | 'crit' | 'heal' | 'poison' | 'shield' | 'win' | 'lose' | 'place' | 'deny'): void {
  if (!G.sound) return;
  audioLog.push(k);
  if (k === 'slash') noise(0.2, 5200, 700, 0.3);
  else if (k === 'sever') { noise(0.18, 1200, 200, 0.45); tone(110, 0.2, 0.2); }
  else if (k === 'block') tone(1700, 0.1, 0.12, 'square', 0.7);
  else if (k === 'claw') noise(0.09, 3000, 900, 0.18);
  else if (k === 'crit') { tone(880, 0.16, 0.14, 'triangle', 1.6); noise(0.12, 4000, 1200, 0.25); }
  else if (k === 'heal') tone(660, 0.18, 0.08, 'sine', 1.3);
  else if (k === 'poison') tone(220, 0.15, 0.08, 'sawtooth', 0.8);
  else if (k === 'shield') tone(1200, 0.08, 0.08, 'square', 0.9);
  else if (k === 'win') [0, 1, 2, 3].forEach((i) => setTimeout(() => tone(330 * Math.pow(1.26, i), 0.3, 0.12, 'triangle'), i * 90));
  else if (k === 'lose') tone(160, 0.6, 0.2, 'sawtooth', 0.5);
  else if (k === 'place') tone(520, 0.15, 0.12, 'triangle', 1.5);
  else tone(150, 0.2, 0.12, 'square');
}
function vibrate(p: number | number[]): void { const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }; if (typeof nav.vibrate === 'function') try { nav.vibrate(p); } catch { /* 略過 */ } }

// ---------------------------------------------------------------- 提示
let tipTimer = 0 as unknown as ReturnType<typeof setTimeout>;
const tipQueue: { text: string; ms: number; key?: string }[] = [];
const tipLog: string[] = [];                 // 實際顯示過的說明文字（測試用）
let tipBusyUntil = 0;
/** 即時提示（拒絕、點器官說明）：立刻顯示；排隊中的一次性說明保留，之後照樣播（覆審 M5）。 */
function tip(text: string, ms = 2600): void { showTip(text, ms); }
function showTip(text: string, ms: number, key?: string): void {
  els.tip.textContent = text; els.tip.hidden = false; tipBusyUntil = performance.now() + ms; tipLog.push(text);
  if (key) G.tipsShown.add(key);             // 真的顯示了才算「出現過」
  clearTimeout(tipTimer); tipTimer = setTimeout(() => { els.tip.hidden = true; const n = tipQueue.shift(); if (n) showTip(n.text, n.ms, n.key); }, ms);
}
/** 一次性說明：排隊依序顯示，不互相覆蓋（審查 M5）。 */
function onceTip(key: string, text: string, ms = 2400): void {
  if (G.tipsShown.has(key) || tipQueue.some((q) => q.key === key)) return;
  if (performance.now() < tipBusyUntil || tipQueue.length) tipQueue.push({ text, ms, key }); else showTip(text, ms, key);
}

// ---------------------------------------------------------------- 流程
function newRun(seed?: number): void {
  G.token++;
  G.camp = newCampaign(seed ?? G.seedSource(), BODY2);
  G.tipsShown = new Set(); tipQueue.length = 0; tipLog.length = 0;
  startCut();
  onceTip('open', '切割期 30 秒：從你的獸身拖一條線切對方器官（穿過自己的器官會鎖住保護它）。時間到，雙方剩下的器官自動開打。', 3600);
  onceTip('kinds', '五種器官：爪＝攻擊、心＝血量與回血、眼＝暴擊、毒＝持續傷害、骨＝護盾。點器官看說明。', 3200);
}
function startCut(): void {
  G.game = matchFor(G.camp); G.ui = 'cut'; G.cutByMe = []; G.drag = null; G.release = null; G.preview = null; G.battle = null; G.vis = [];
  G.acc = 0; G.lastT = null; G.pops = []; G.particles = []; G.shots = []; G.slashes = []; G.fx = []; G.bursts = [];
  G.banner = { text: `對手 ${G.camp.stage + 1}／${CB.STAGES}`, sub: `切割 ${CB.CUT_SECONDS} 秒`, t0: performance.now(), life: 1500 };
  for (const m of [els.contrib, els.pick, els.end]) m.hidden = true;
  hud();
}
function stepOnce(): void {
  if (G.ui !== 'cut' || G.game.phase !== 'cut') return;
  const s0 = G.game, blue = G.release; G.release = null;
  const out = step(s0, { blue, drag: G.drag ? { a: G.drag.a, b: G.drag.b } : null });
  G.game = out.state;
  for (const e of out.events) onCutEvent(e, s0);
  if (G.game.phase !== 'cut') startBattle();
}
function onCutEvent(e: GameEvent, s0: GameState): void {
  const now = performance.now();
  if (e.t === 'strike') {
    const r = e.r; G.slashes.push({ a: r.line.a, b: r.end, t0: now, side: r.side }); sfx('slash');
    if (r.side === 'blue') G.lastStrike = r;
    if (r.severed !== null) {
      const o = s0.organs[r.severed]; G.bursts.push({ o, t0: now, ang: Math.atan2(r.line.b[1] - r.line.a[1], r.line.b[0] - r.line.a[0]) }); sfx('sever');
      pop([o.p[0], o.p[1] - 30], `切下 ${KIND_ZH[o.kind]}`, o.side === 'red' ? '#AEEAFF' : '#ff8a8a', 18);
      if (r.side === 'blue') G.cutByMe.push(o.kind); else { vibrate([30, 30, 30]); if (ASSETS) G.fx.push({ type: 'hitFlash', t0: now / 1000, body: ASSETS.body, rect: RECTS.blue, side: 'blue' }); }   // 切割期不晃畫面，改閃白（iPhone 沒有震動）
    }
    if (r.blocked !== null) { const o = s0.organs[r.blocked]; G.fx.push({ type: 'boneShield', t0: now / 1000, at: o.p as [number, number], facing: Math.atan2(r.line.a[1] - o.p[1], r.line.a[0] - o.p[0]) }); pop([o.p[0], o.p[1] - 30], '鎖住，擋下', '#cfe8ff', 16); sfx('block'); }
  } else if (e.t === 'aim') { if (!G.aimFirst) G.aimFirst = now; }
  else if (e.t === 'spawn') { const o = G.game.organs[e.i]; pop([o.p[0], o.p[1] - 32], `長回 ${KIND_ZH[o.kind]}`, '#9fffb0', 15); }
  else if (e.t === 'ko') { G.banner = { text: '清空！', sub: e.winner === 'blue' ? '對手器官全滅' : e.winner === 'red' ? '你的器官全滅' : '同時清空', t0: now, life: 1200 }; }
}
function startBattle(): void {
  const f = fightersOf(G.game);
  G.battle = simulateBattle(f, battleSeed(G.camp));
  G.ui = 'battle'; G.bT0 = performance.now(); G.bBase = 0; G.bClock = 0; G.bIdx = 0; G.speed = 1; els.fast.textContent = '快轉'; G.vis = []; G.release = null; G.drag = null; G.preview = null;
  const st = (G.battle.events[0] as Extract<BattleEvent, { t: 'start' }>).stats;
  G.disp = { blue: { hp: st.blue.hp, max: st.blue.maxHp, shield: st.blue.shield, poison: 0 }, red: { hp: st.red.hp, max: st.red.maxHp, shield: st.red.shield, poison: 0 } };
  if (st.blue.shield || st.red.shield) onceTip('bone', DESC.bone.line);
  G.banner = { text: '戰鬥！', sub: '剩下的器官自動開打', t0: performance.now(), life: 1100 };
  onceTip('battle', '戰鬥期：每個器官自己行動。爪攻擊、心回血、眼讓爪暴擊、毒疊層、骨給護盾。點器官可看說明。');
  hud();
}
const organById = (id: string) => G.game.organs.find((o) => o.id === id);
const centroid = (poly: V[]): V => { let a = 0, x = 0, y = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], c = p[0] * q[1] - q[0] * p[1]; a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; } return [x / (3 * a), y / (3 * a)]; };
const CENTER: Record<Side, V> = { blue: centroid(BODY2.blue), red: centroid(BODY2.red) };
const bodyCenter = (side: Side): V => CENTER[side];
function targetOf(side: Side, salt: number): V {
  const foe = G.game.organs.filter((o, i) => o.side !== side && G.game.alive[i]);
  return foe.length ? foe[salt % foe.length].p : bodyCenter(side === 'blue' ? 'red' : 'blue');
}
function playBattleEvent(e: BattleEvent): void {
  const now = performance.now(), d = G.disp;
  if (e.t === 'claw') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue', to = targetOf(e.side, e.ms / 10);
    const ts = now / 1000;
    if (o) { G.fx.push(e.crit ? { type: 'critArc', t0: ts, from: o.p as [number, number], to: to as [number, number], dmg: e.raw } : { type: 'arcSlash', t0: ts, from: o.p as [number, number], to: to as [number, number], side: e.side, dmg: e.raw }); glow(o.id); }
    d[foe].shield -= e.shieldHit; d[foe].hp = e.hpAfter;
    if (e.hpHit > 0 && ASSETS) G.fx.push({ type: 'hitFlash', t0: ts, body: ASSETS.body, rect: RECTS[foe], side: foe });
    if (e.shieldHit) { G.fx.push({ type: 'boneShield', t0: ts, at: to as [number, number], facing: o ? Math.atan2(o.p[1] - to[1], o.p[0] - to[0]) : 0, absorbed: e.shieldHit, value: Math.max(0, d[foe].shield) }); G.vis.push({ kind: 'bone', ev: 'claw' }); }
    G.vis.push({ kind: 'claw', ev: 'claw' }); if (e.crit) { G.vis.push({ kind: 'eye', ev: 'claw' }); sfx('crit'); onceTip('eye', DESC.eye.line); } else sfx('claw');
    onceTip('claw', DESC.claw.line);
    if (foe === 'blue') { G.shakeUntil = now + 120; }
  } else if (e.t === 'heal') {
    const o = organById(e.id); d[e.side].hp = e.hpAfter;
    if (o) { if (e.amount > 0) G.fx.push({ type: 'heal', t0: now / 1000, at: o.p as [number, number], amount: e.amount }); glow(o.id); }   // 滿血回 0 只發光、不跳 +0
    G.vis.push({ kind: 'heart', ev: 'heal' }); sfx('heal'); onceTip('heart', DESC.heart.line);
  } else if (e.t === 'poisonStack') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue'; d[foe].poison = e.stacks;
    if (o) { G.fx.push({ type: 'poison', t0: now / 1000, at: bodyCenter(foe) as [number, number], stacks: e.stacks }); glow(o.id); }
    G.vis.push({ kind: 'poison', ev: 'poisonStack' }); sfx('poison'); onceTip('poison', DESC.poison.line);
  } else if (e.t === 'poisonTick') {
    d[e.side].shield -= e.shieldHit; d[e.side].hp = e.hpAfter;
    const c = bodyCenter(e.side); pop([c[0] + 90, c[1]], `毒 ${e.raw}`, '#7CFF6B', 18); if (e.shieldHit) G.fx.push({ type: 'boneShield', t0: now / 1000, at: c as [number, number], facing: e.side === 'blue' ? -Math.PI / 2 : Math.PI / 2, absorbed: e.shieldHit, value: Math.max(0, d[e.side].shield) });
    G.vis.push({ kind: 'poison', ev: 'poisonTick' }); if (e.shieldHit) G.vis.push({ kind: 'bone', ev: 'poisonTick' });
  } else if (e.t === 'overtime') {
    G.banner = { text: '加時', sub: '所有傷害 ×2', t0: now, life: 1000 }; G.vis.push({ kind: 'overtime', ev: 'overtime' });
  } else if (e.t === 'end') {
    const win = e.winner === 'blue';
    G.banner = { text: win ? '勝！' : e.winner === 'draw' ? '平手' : '敗', sub: e.how === 'time' ? '時間到，比剩餘血量百分比' : e.how === 'empty' ? '一方沒有器官' : '血量歸零', t0: now, life: 1400 };
    sfx(win ? 'win' : 'lose'); if (!win) vibrate([60, 40, 60]);
    G.fx.push({ type: 'ko', t0: now / 1000, w: W, h: H, winner: e.winner });
  }
  hud();
}
const glowUntil = new Map<string, number>();
function glow(id: string): void { glowUntil.set(id, performance.now() + 260); }
function battleTick(now: number): void {
  if (G.ui !== 'battle' || !G.battle) return;
  G.bClock = G.bBase + ((now - G.bT0) / G.battleScale) * G.speed;   // 快轉從當下時間接著加速，不會跳到結尾（審查 M6）
  const ev = G.battle.events;
  while (G.bIdx < ev.length && ev[G.bIdx].ms <= G.bClock) playBattleEvent(ev[G.bIdx++]);
  if (G.bIdx >= ev.length && G.bClock >= G.battle.endMs + 900) showContrib();
}
function showContrib(): void {
  const b = G.battle!; G.ui = 'contrib';
  const c = b.contrib, row = (label: string, me: number, foe: number, key: string) => `<tr data-k="${key}"><th>${label}</th><td class="me">${Math.round(me)}</td><td class="foe">${Math.round(foe)}</td></tr>`;
  els.contribTitle.textContent = b.winner === 'blue' ? `勝！對手 ${G.camp.stage + 1}／${CB.STAGES}` : b.winner === 'draw' ? '平手（算輸）' : '敗';
  els.contribBody.innerHTML = `<table class="ct"><thead><tr><th>本場貢獻</th><th>你</th><th>對手</th></tr></thead><tbody>`
    + row('爪 傷害', c.blue.damage.claw, c.red.damage.claw, 'claw')
    + row('　其中 眼 暴擊加成', c.blue.critBonus, c.red.critBonus, 'eye')
    + row('毒 傷害', c.blue.damage.poison, c.red.damage.poison, 'poison')
    + row('心 補血', c.blue.heal, c.red.heal, 'heart')
    + row('骨 擋下', c.blue.blocked, c.red.blocked, 'bone')
    + `</tbody></table><p class="hint">${b.how === 'time' ? `時間到：你剩 ${Math.round((100 * G.disp.blue.hp) / G.disp.blue.max)}%、對手剩 ${Math.round((100 * G.disp.red.hp) / G.disp.red.max)}%` : b.how === 'empty' ? '一方開戰時沒有器官' : `${(b.endMs / 1000).toFixed(1)} 秒分出勝負`}</p>`;
  els.contribNext.textContent = b.winner === 'blue' ? (G.camp.stage === CB.STAGES - 1 ? '看結果' : '挑縫合') : '看結果';
  els.contrib.hidden = false;
}
els.contribNext.onclick = () => {
  if (G.ui !== 'contrib' || !G.battle) return;
  els.contrib.hidden = true;
  const endBody = fightersOf(G.game).filter((f) => f.side === 'blue').map((f) => f.kind);
  G.camp = finishStage(G.camp, G.cutByMe, G.battle, endBody);
  if (G.camp.phase === 'pick') showPick(); else showEnd();
};
function showPick(): void {
  G.ui = 'pick'; els.pickOpts.innerHTML = '';
  G.camp.offer.forEach((k, i) => {
    const b = document.createElement('button'); b.id = `pick${i}`; b.dataset.kind = k;
    b.innerHTML = `<img alt="" src="./assets/final/${k}.png"><span><b>${KIND_ZH[k]}・${DESC[k].role}</b><small>${DESC[k].line}</small></span>`;
    b.onclick = () => { G.camp = pickStitch(G.camp, k); els.pick.hidden = true; G.ui = 'place'; tip(`點你的獸身放下「${KIND_ZH[k]}」：要整個在獸身裡、不能和器官重疊、對方刀要碰得到`, 4000); hud(); };
    els.pickOpts.appendChild(b);
  });
  els.pick.hidden = false; hud();
}
function tryPlace(p: V): void {
  const r = placeStitch(G.camp, p);
  if (r.reject) { tip(REJECT_TEXT[r.reject]); sfx('deny'); return; }
  G.camp = r.c; sfx('place'); startCut();
}
function showEnd(): void {
  G.ui = 'end';
  const c = G.camp, won = c.phase === 'won';
  const body = c.history.length ? c.history[c.history.length - 1].endBody : [];
  const count = (['claw', 'heart', 'eye', 'poison', 'bone'] as Kind[]).map((k) => [k, body.filter((x) => x === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${KIND_ZH[k]}×${n}`).join('、') || '（沒有器官）';
  els.endTitle.textContent = won ? '征途完成！三場全勝' : `倒在第 ${c.stage + 1} 場`;
  els.endBody.innerHTML = `<div>打到第 <b id="endReach">${won ? CB.STAGES : c.stage + 1}</b>／${CB.STAGES} 場</div><div>最後的身體：<span id="endBodyKinds">${count}</span></div><div>縫上的器官：${c.stitches.map((s) => KIND_ZH[s.kind]).join('、') || '（無）'}</div><div class="hint">種子 ${c.seed}</div>`;
  els.end.hidden = false; sfx(won ? 'win' : 'lose'); hud();
}

// ---------------------------------------------------------------- HUD
let infoHtml = '';
function setInfo(h: string): void { if (h !== infoHtml) { infoHtml = h; els.info.innerHTML = h; } }   // 內容變了才寫 DOM（DA-06 降級措施）
function hud(): void {
  if (!G.camp) return;
  const c = G.camp, s = G.game;
  els.stage.textContent = `對手 ${c.stage + 1}／${CB.STAGES}`;
  els.phase.textContent = G.ui === 'cut' ? '切割' : G.ui === 'battle' || G.ui === 'contrib' ? '戰鬥' : G.ui === 'pick' || G.ui === 'place' ? '縫合' : '結束';
  if (G.ui === 'cut') {
    const left = Math.max(0, (endStep(s) - s.step) / FPS);
    els.clock.textContent = left.toFixed(left < 10 ? 1 : 0);
    const nb = countSide(s, 'blue'), nr = countSide(s, 'red'), mb = s.mode.maxPerSide?.blue ?? 9, mr = s.mode.maxPerSide?.red ?? 9;
    els.meTxt.textContent = `器官 ${nb}`; els.foeTxt.textContent = `器官 ${nr}`;
    els.meBar.style.width = `${(100 * nb) / mb}%`; els.foeBar.style.width = `${(100 * nr) / mr}%`;
    els.meShield.style.width = '0%'; els.foeShield.style.width = '0%';
    const cd = Math.max(0, s.cdUntil.blue - s.step) / COOLDOWN_STEPS;
    els.cd.style.width = `${100 * (1 - cd)}%`; els.cd.parentElement!.classList.toggle('cool', cd > 0);
  } else if (G.ui === 'battle' || G.ui === 'contrib') {
    els.clock.textContent = (Math.min(BT.MAX_MS, G.bClock) / 1000).toFixed(1);
    for (const side of ['blue', 'red'] as Side[]) {
      const d = G.disp[side], bar = side === 'blue' ? els.meBar : els.foeBar, sh = side === 'blue' ? els.meShield : els.foeShield, txt = side === 'blue' ? els.meTxt : els.foeTxt;
      bar.style.width = `${(100 * Math.max(0, d.hp)) / d.max}%`; sh.style.width = `${Math.min(100, (100 * Math.max(0, d.shield)) / d.max)}%`;
      txt.textContent = `${Math.max(0, d.hp)}/${d.max}${d.shield > 0 ? ` 盾${d.shield}` : ''}${d.poison ? ` 毒${d.poison}` : ''}`;
    }
  } else { els.clock.textContent = '—'; }
  els.sound.textContent = `音效：${G.sound ? '開' : '關'}`; els.sound.setAttribute('aria-pressed', String(G.sound));
  els.fast.disabled = G.ui !== 'battle';
  if (G.ui === 'cut' && !G.drag) setInfo('從<b>藍色獸身</b>拖線切紅方器官；點器官看說明。');
  else if (G.ui === 'place') setInfo(`點獸身放下「${KIND_ZH[G.camp.picked ?? 'claw']}」。綠圈＝可放，紅圈＝不能放。`);
  else if (G.ui === 'battle') setInfo('戰鬥中：器官自己行動（可按「快轉」）。');
}

// ---------------------------------------------------------------- 輸入
function organAt(p: V): { kind: Kind; side: Side } | null {
  const s = G.game;
  for (let i = s.organs.length - 1; i >= 0; i--) { const o = s.organs[i]; if (s.alive[i] && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) <= R + 6) return { kind: o.kind as ArtKind, side: o.side }; }
  return null;
}
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  const p = toWorld(e.clientX, e.clientY);
  if (G.ui === 'place') { G.ghost = p; G.ghostOk = !placeCheck(G.camp, p); G.placing = e.pointerId; els.canvas.setPointerCapture(e.pointerId); return; }
  if (G.drag) return;
  G.drag = { id: e.pointerId, a: p, b: p, moved: 0 }; els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e.clientX, e.clientY);
  if (G.ui === 'place') { G.ghost = p; G.ghostOk = !placeCheck(G.camp, p); return; }
  if (!G.drag || e.pointerId !== G.drag.id) return;
  G.drag.b = p; G.drag.moved = Math.max(G.drag.moved, Math.hypot(p[0] - G.drag.a[0], p[1] - G.drag.a[1]));
  if (G.ui === 'cut') { G.preview = resolveStrike({ ...G.game, cdUntil: { ...G.game.cdUntil } }, 'blue', { a: G.drag.a, b: G.drag.b }); previewText(); }
});
const endDrag = (e: PointerEvent, cancel: boolean) => {
  if (G.ui === 'place' && G.placing === e.pointerId) { G.placing = null; const p = toWorld(e.clientX, e.clientY); G.ghost = p; G.ghostOk = !placeCheck(G.camp, p); if (!cancel) tryPlace(p); return; }
  if (!G.drag || e.pointerId !== G.drag.id) return;
  const d = G.drag; G.drag = null; d.b = toWorld(e.clientX, e.clientY);
  if (cancel) { G.preview = null; hud(); return; }
  if (d.moved < 12) { const o = organAt(d.a); if (o) tip(`${o.side === 'blue' ? '你的' : '對手的'}${DESC[o.kind].line}`); G.preview = null; hud(); return; }
  if (G.ui !== 'cut') return;
  const line = { a: d.a, b: d.b };
  if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < MIN_LEN) { tip(`刀太短（至少 ${MIN_LEN}）`, 1200); G.preview = null; return; }
  G.release = line; G.preview = null;
  if (G.manual) { /* 測試模式：由 advance() 推進 */ }
};
els.canvas.addEventListener('pointerup', (e) => endDrag(e, false));
els.canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
function previewText(): void {
  const r = G.preview; if (!r) return;
  if (!r.ok) { setInfo(`<span class="warnc">${r.reject === 'start' ? '起點要在你的獸身上' : r.reject === 'cooldown' ? '冷卻中' : r.reject === 'short' ? '刀太短' : '不能出刀'}</span>`); return; }
  const s = G.game;
  setInfo(`${r.locks.length ? `鎖住 ${r.locks.map((i) => KIND_ZH[s.organs[i].kind]).join('、')}　` : ''}${r.severed !== null ? `<b>切下 ${KIND_ZH[s.organs[r.severed].kind]}</b>` : r.blocked !== null ? '<span class="warnc">被鎖住的器官擋下</span>' : '揮空'}`);
}
els.sound.onclick = () => { G.sound = !G.sound; try { localStorage.setItem('duel-cb-sound', G.sound ? '1' : '0'); } catch { /* 略過 */ } hud(); };
els.fast.onclick = () => { if (G.ui === 'battle') { const now = performance.now(); G.bBase = G.bClock; G.bT0 = now; G.speed = G.speed === 1 ? 3 : 1; els.fast.textContent = G.speed === 1 ? '快轉' : '正常速度'; } };
els.restart.onclick = () => newRun();
els.again.onclick = () => newRun();

// ---------------------------------------------------------------- 繪製（幽光美術模組 v2）
const ctx = els.canvas.getContext('2d')!;
let ASSETS: Assets | null = null;
function kindColor(k: Kind, side: Side): string {
  if (k === 'heart') return side === 'blue' ? '#5fc8ff' : '#ff4d6a';
  if (k === 'eye') return '#ffd166'; if (k === 'poison') return '#7CFF6B'; return '#C8C0AF';
}
function pop(p: V, text: string, color: string, size = 20, life = 900): void { G.pops.push({ p: [p[0], p[1]], text, color, t0: performance.now(), life, size }); }
function burst(p: V, c: string, n: number, sp = 1): void { const now = performance.now(); for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, v = (100 + Math.random() * 240) * sp; G.particles.push({ p: [p[0], p[1]], v: [Math.cos(a) * v, Math.sin(a) * v - 60], c, t0: now, life: 450 + Math.random() * 400, r: 1.5 + Math.random() * 3 }); } }
void burst;
/** 器官 sprite 畫在規則座標上；同時記下它在螢幕上的中心（DA-04 對齊驗證用）。 */
const spriteCenters = new Map<string, { x: number; y: number }>();
function organ(o: { id: string; kind: Kind; side: Side; p: V }, st: OrganState, t: number): void {
  if (!ASSETS) return;
  drawOrganSprite(ctx, ASSETS.organs[o.kind as ArtKind], { kind: o.kind as ArtKind, side: o.side, x: o.p[0], y: o.p[1], r: R * 0.95 }, st, t);
  const m = ctx.getTransform(), r = els.canvas.getBoundingClientRect();
  spriteCenters.set(o.id, { x: r.left + (m.a * o.p[0] + m.c * o.p[1] + m.e) / dpr, y: r.top + (m.b * o.p[0] + m.d * o.p[1] + m.f) / dpr });
}
let fps = { frames: 0, t0: 0, last: 0 };
let isolateId: string | null = null;
function draw(now: number): void {
  const t = now / 1000;
  // 畫布的 CSS 尺寸會因上方文字換行等版面變動而改變（不一定觸發 resize）；尺寸一變就重算換算與緩衝區，否則畫面和觸控會錯位（DA-04，WebKit 實測 4px）
  { const r = els.canvas.getBoundingClientRect(); if (Math.abs(r.width - cw) > 0.5 || Math.abs(r.height - ch) > 0.5) layout(); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#070D19'; ctx.fillRect(0, 0, cw, ch);
  if (!ASSETS) return;
  // 畫面震動只在戰鬥期：切割期玩家正在拖線，整個畫面一晃，刀線和器官就會短暫錯位（DA-04 對齊）；切割期的受擊改用器官裂開＋手機震動
  let sh: V = [0, 0];
  if (G.ui !== 'cut') {
    for (const f of G.fx) { const q = shake2(f, t); sh = [sh[0] + q[0], sh[1] + q[1]]; }
    if (now < G.shakeUntil) sh = [sh[0] + (Math.random() * 2 - 1) * 5, sh[1] + (Math.random() * 2 - 1) * 5];
  }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sh[0] * scale), dpr * (oy + sh[1] * scale));
  // 測試用：只畫一個器官（黑底），讓測試直接讀像素量 sprite 實際畫在哪（DA-04；審查 HIGH-1：用變換矩陣推算的中心沒有鑑別力）
  if (isolateId) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, els.canvas.width, els.canvas.height); ctx.restore();
    const i = G.game.organs.findIndex((o) => o.id === isolateId);
    if (i >= 0) organ(G.game.organs[i], { mode: 'normal' }, 0);   // 和正式畫面同一個 organ()（覆審：不能另寫一份繪製）
    return;
  }
  drawDuelScene(ctx, { w: W, h: H, body: ASSETS.body, rects: RECTS }, t);
  const s = G.game, pv = G.drag && G.preview?.ok ? G.preview : null;
  spriteCenters.clear();
  s.organs.forEach((o, i) => {
    if (!s.alive[i]) return;
    const sprout = G.ui === 'cut' && !isReady(s, i), locked = G.ui === 'cut' && isLocked(s, i), lit = Math.max(0, ((glowUntil.get(o.id) ?? 0) - now) / 260);
    const st: OrganState = sprout ? { mode: 'sprout', k: Math.min(1, 1 - (s.readyAt[i] - s.step) / 30) }
      : locked ? { mode: 'locked', k: (s.lockUntil[i] - s.step) / LOCK_STEPS, label: `${Math.ceil((s.lockUntil[i] - s.step) / FPS)}` } : { mode: 'normal' };
    st.lit = pv && pv.locks.includes(i) ? Math.max(lit, 0.7) : lit; st.target = !!pv && (pv.severed === i || pv.blocked === i);   // 刀會鎖住的己方器官提亮
    organ(o, st, t);
  });
  G.bursts = G.bursts.filter((b) => now - b.t0 < 520);
  for (const b of G.bursts) drawOrganSprite(ctx, ASSETS.organs[b.o.kind as ArtKind], { kind: b.o.kind as ArtKind, side: b.o.side, x: b.o.p[0], y: b.o.p[1], r: R * 0.95 }, { mode: 'burst', k: (now - b.t0) / 520, cutAngle: b.ang }, t);
  // AI 預告：紅色虛線＋實線前進
  if (G.ui === 'cut' && s.aim) {
    const a = s.aim, k = Math.min(1, (s.step - a.aimStep) / Math.max(1, a.fireStep - a.aimStep)), l = clampLine(a.line);
    ctx.save(); ctx.strokeStyle = '#ff3b4f'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.globalAlpha = 0.5 + 0.4 * Math.sin(now / 90);
    ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.shadowColor = '#ff3b4f'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.a[0] + (l.b[0] - l.a[0]) * k, l.a[1] + (l.b[1] - l.a[1]) * k); ctx.stroke();
    ctx.restore();
  }
  // 我的刀線預覽：art-kit 刀線＋命中紅圈（命中＝規則預覽會切／擋的器官）
  if (G.drag && G.ui === 'cut') {
    const l = clampLine({ a: G.drag.a, b: G.drag.b }), r = G.preview;
    const hits: [number, number][] = r && r.ok ? [r.severed, r.blocked].filter((x): x is number => x !== null).map((i) => s.organs[i].p as [number, number]) : [];
    drawBlade(ctx, l.a as [number, number], l.b as [number, number], hits, t, true);
    if (r && !r.ok) { ctx.save(); ctx.strokeStyle = '#ff7a7a'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke(); ctx.restore(); }
  }
  // 出刀後的刀光
  G.slashes = G.slashes.filter((x) => now - x.t0 < 260);
  for (const x of G.slashes) { ctx.save(); ctx.globalAlpha = 1 - (now - x.t0) / 260; drawBlade(ctx, x.a as [number, number], x.b as [number, number], [], t, false); ctx.restore(); }
  // 戰鬥特效（art-kit Fx2）
  G.fx = G.fx.filter((f) => playFx2(ctx, f, t));
  if (G.ui === 'battle' || G.ui === 'contrib') for (const side of ['blue', 'red'] as Side[]) {
    const d = G.disp[side], c = bodyCenter(side);
    if (d.poison) { ctx.save(); ctx.fillStyle = '#7CFF6B'; ctx.shadowColor = '#7CFF6B'; ctx.shadowBlur = 14; ctx.font = '600 20px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(`毒 ×${d.poison}`, c[0] + 170, c[1] - 60); ctx.restore(); }
  }
  // 縫合擺放：插槽（可放／不可放）＋已縫器官的縫線
  if (G.ui === 'place' || G.ui === 'pick') {
    for (const st of G.camp.stitches) drawSuture(ctx, st.p as [number, number], CENTER.blue as [number, number], t);
    if (G.ghost && G.camp.picked) { drawSlot(ctx, G.ghost[0], G.ghost[1], R * 1.1, G.ghostOk ? 'ok' : 'bad', t); ctx.save(); ctx.globalAlpha = 0.75; drawOrganSprite(ctx, ASSETS.organs[G.camp.picked as ArtKind], { kind: G.camp.picked as ArtKind, side: 'blue', x: G.ghost[0], y: G.ghost[1], r: R * 0.85 }, { mode: 'normal' }, t); ctx.restore(); if (G.ghostOk) drawSuture(ctx, G.ghost as [number, number], CENTER.blue as [number, number], t); }
  }
  // 跳字
  G.pops = G.pops.filter((q) => now - q.t0 < q.life);
  for (const q of G.pops) { const k = (now - q.t0) / q.life; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4); ctx.font = `italic 600 ${q.size}px Georgia, "Noto Serif TC", serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#070D19cc'; ctx.strokeText(q.text, q.p[0], q.p[1] - 36 * k); ctx.fillStyle = q.color; ctx.fillText(q.text, q.p[0], q.p[1] - 36 * k); ctx.restore(); }
  if (G.banner && now - G.banner.t0 < G.banner.life) {
    const k = (now - G.banner.t0) / G.banner.life, sc = k < 0.15 ? 1.8 - (k / 0.15) * 0.8 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3); ctx.translate(350, 500); ctx.scale(sc, sc); ctx.textAlign = 'center';
    ctx.font = 'italic 600 60px Georgia, "Noto Serif TC", serif'; ctx.lineWidth = 6; ctx.strokeStyle = '#070D19'; ctx.strokeText(G.banner.text, 0, 0); ctx.fillStyle = '#F0F7FF'; ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 16; ctx.fillText(G.banner.text, 0, 0);
    ctx.shadowBlur = 0; ctx.font = '600 20px system-ui'; ctx.lineWidth = 4; ctx.strokeText(G.banner.sub, 0, 36); ctx.fillStyle = '#AEEAFF'; ctx.fillText(G.banner.sub, 0, 36); ctx.restore();
  }
  // FPS（每秒更新）
  fps.frames++; if (now - fps.t0 >= 1000) { fps.last = (fps.frames * 1000) / (now - fps.t0); fps.frames = 0; fps.t0 = now; }
}
function frame(now: number): void {
  if (!G.camp) { draw(now); requestAnimationFrame(frame); return; }
  if (G.ui === 'cut' && !G.manual) {
    if (G.lastT === null) G.lastT = now;
    G.acc += Math.min(250, now - G.lastT); G.lastT = now;
    while (G.acc >= STEP_MS && G.ui === 'cut') { G.acc -= STEP_MS; stepOnce(); }
  } else G.lastT = now;
  battleTick(now);
  if (G.ui === 'cut') hud(); else if (G.ui === 'battle') hud();
  draw(now);
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { G.lastT = null; });

// ---------------------------------------------------------------- 測試掛勾（作者測試讀取；不影響遊戲）
(window as unknown as { __cb: unknown }).__cb = {
  get spriteCenters() { return Object.fromEntries(spriteCenters); }, isolate: (id: string | null) => { isolateId = id; }, get fps() { return fps.last; }, get assetsReady() { return !!ASSETS; }, get loadLog() { return loadLog; },
  get camp() { return G.camp; }, get game() { return G.game; }, get ui() { return G.ui; }, get preview() { return G.preview; }, get lastStrike() { return G.lastStrike; },
  get battle() { return G.battle; }, get vis() { return G.vis; }, get tip() { return els.tip.hidden ? null : els.tip.textContent; }, get cutByMe() { return G.cutByMe; },
  get audio() { return audioLog; }, get tipsShown() { return [...G.tipsShown]; }, get tipLog() { return [...tipLog]; },
  toScreen, newRun: (o?: { seed?: number }) => newRun(o?.seed),
  setManual: (v: boolean) => { G.manual = v; }, advance: (n: number) => { for (let i = 0; i < n && G.ui === 'cut'; i++) stepOnce(); hud(); },
  setTimings: (o: { battleScale?: number }) => { if (o.battleScale !== undefined) G.battleScale = o.battleScale; },
};
// ---------------------------------------------------------------- PWA（子路徑獨立 scope）
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' });
  const ownSw = new URL('./sw.js', location.href).href;
  const hadController = navigator.serviceWorker.controller?.scriptURL === ownSw;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
window.addEventListener('resize', layout);
// 素材載入（DA-05）：art-kit 的 loadImage 已含 3 次重試；全部失敗時顯示錯誤與「重試」，不整頁空白
function boot(base: string): void {
  els.loadErr.hidden = true; els.loading.hidden = false;
  loadAssets(base).then((a) => { ASSETS = a; els.loading.hidden = true; if (!G.camp) newRun(); }).catch((e: unknown) => {
    els.loading.hidden = true; els.loadErr.hidden = false;
    els.loadMsg.textContent = `素材載入失敗：${e instanceof Error ? e.message : String(e)}`;
    els.loadLog.textContent = loadLog.filter((x) => !x.ok).map((x) => `[DEBUG-artkit] ${x.url} 第${x.attempt}次 失敗 ${x.ms}ms online=${x.online} sw=${x.sw}`).join('\n');
  });
}
els.retry.onclick = () => boot('./assets/final');
layout(); boot('./assets/final');   // 只用正式素材：暫代素材的身形和已確認邊界不同，會讓畫面與判定不一致（審查 M6）
requestAnimationFrame(frame);
