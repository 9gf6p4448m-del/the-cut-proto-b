// 切割→戰鬥（子路徑 duel/）手機試玩：切割期 30 秒（rt-cut2 規則）→ 可視戰鬥期 ≤15 秒 → 3 場征途、自己擺縫合。可丟棄原型，非正式規則。
// 規則：切割期在 src/rtcut/rules.ts；戰鬥期在 src/cutbattle/battle.ts（純函式事件）；征途在 src/cutbattle/campaign.ts。本檔只負責輸入、播放事件、演出與說明。
import { BODY, COOLDOWN_STEPS, FPS, KIND_ZH, LOCK_STEPS, MIN_LEN, R, clampLine, countSide, endStep, isLocked, isReady, resolveStrike, step } from './rtcut/rules.ts';
import type { GameEvent, GameState, Kind, Line, Side, StrikeResult, V } from './rtcut/rules.ts';
import { BT, simulateBattle } from './cutbattle/battle.ts';
import type { BattleEvent, BattleResult } from './cutbattle/battle.ts';
import { CB, battleSeed, finishStage, fightersOf, matchFor, newCampaign, pickStitch, placeCheck, placeStitch } from './cutbattle/campaign.ts';
import type { Campaign, PlaceReject } from './cutbattle/campaign.ts';

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
};
els.sha.textContent = BUILD_SHA;

// ---------------------------------------------------------------- 說明文字（點器官、首次出現、選縫合共用）
export const DESC: Record<Kind, { role: string; line: string }> = {
  claw: { role: '攻擊手', line: `爪：每 ${BT.CLAW_EVERY / 1000} 秒攻擊一次，造成 ${BT.CLAW_DMG}` },
  heart: { role: '生命', line: `心：血量上限 +${BT.HEART_HP}，每 ${BT.HEART_EVERY / 1000} 秒回 ${BT.HEART_HEAL}` },
  eye: { role: '暴擊', line: `眼：我方爪暴擊率 +${BT.EYE_CRIT * 100}%（上限 ${BT.CRIT_CAP * 100}%），暴擊 ×${BT.CRIT_MULT}` },
  poison: { role: '持續傷害', line: `毒：每 ${BT.POISON_EVERY / 1000} 秒讓對手疊 1 層毒，每層每秒 1 傷害` },
  bone: { role: '護盾', line: `骨：開戰提供 ${BT.BONE_SHIELD} 護盾，先吸收傷害` },
};
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
  battle: null as BattleResult | null, bT0: 0, bClock: 0, bIdx: 0, battleScale: 1,
  disp: { blue: { hp: 0, max: 1, shield: 0, poison: 0 }, red: { hp: 0, max: 1, shield: 0, poison: 0 } },
  vis: [] as { kind: Kind | 'overtime'; ev: BattleEvent['t'] }[], tipsShown: new Set<string>(),
  pops: [] as Pop[], particles: [] as Particle[], shots: [] as Shot[], slashes: [] as { a: V; b: V; t0: number; side: Side }[],
  shakeUntil: 0, flashUntil: 0, banner: null as null | { text: string; sub: string; t0: number; life: number },
  sound: true, ghost: null as V | null, ghostOk: false, aimFirst: 0,
};
try { G.sound = localStorage.getItem('duel-cb-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }

// ---------------------------------------------------------------- 版面
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
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
function tip(text: string, ms = 2600): void {
  els.tip.textContent = text; els.tip.hidden = false;
  clearTimeout(tipTimer); tipTimer = setTimeout(() => { els.tip.hidden = true; }, ms);
}
function onceTip(key: string, text: string): void { if (G.tipsShown.has(key)) return; G.tipsShown.add(key); tip(text, 3200); }

// ---------------------------------------------------------------- 流程
function newRun(seed?: number): void {
  G.token++;
  G.camp = newCampaign(seed ?? G.seedSource());
  G.tipsShown = new Set();
  startCut();
  onceTip('open', '切割期 30 秒：從你的獸身拖一條線切對方器官（穿過自己的器官會鎖住保護它）。時間到，雙方剩下的器官自動開打。');
}
function startCut(): void {
  G.game = matchFor(G.camp); G.ui = 'cut'; G.cutByMe = []; G.drag = null; G.release = null; G.preview = null; G.battle = null; G.vis = [];
  G.acc = 0; G.lastT = null; G.pops = []; G.particles = []; G.shots = []; G.slashes = [];
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
      const o = s0.organs[r.severed]; burst(o.p, kindColor(o.kind, o.side), 22); sfx('sever');
      pop([o.p[0], o.p[1] - 30], `切下 ${KIND_ZH[o.kind]}`, o.side === 'red' ? '#AEEAFF' : '#ff8a8a', 18);
      if (r.side === 'blue') G.cutByMe.push(o.kind); else { G.shakeUntil = now + 220; vibrate([30, 30, 30]); }
    }
    if (r.blocked !== null) { const o = s0.organs[r.blocked]; burst(o.p, '#fff3c4', 10, 0.5); pop([o.p[0], o.p[1] - 30], '鎖住，擋下', '#cfe8ff', 16); sfx('block'); }
  } else if (e.t === 'aim') { if (!G.aimFirst) G.aimFirst = now; }
  else if (e.t === 'spawn') { const o = G.game.organs[e.i]; pop([o.p[0], o.p[1] - 32], `長回 ${KIND_ZH[o.kind]}`, '#9fffb0', 15); }
  else if (e.t === 'ko') { G.banner = { text: '清空！', sub: e.winner === 'blue' ? '對手器官全滅' : e.winner === 'red' ? '你的器官全滅' : '同時清空', t0: now, life: 1200 }; }
}
function startBattle(): void {
  const f = fightersOf(G.game);
  G.battle = simulateBattle(f, battleSeed(G.camp));
  G.ui = 'battle'; G.bT0 = performance.now(); G.bClock = 0; G.bIdx = 0; G.vis = []; G.release = null; G.drag = null; G.preview = null;
  const st = (G.battle.events[0] as Extract<BattleEvent, { t: 'start' }>).stats;
  G.disp = { blue: { hp: st.blue.hp, max: st.blue.maxHp, shield: st.blue.shield, poison: 0 }, red: { hp: st.red.hp, max: st.red.maxHp, shield: st.red.shield, poison: 0 } };
  if (st.blue.shield) G.vis.push({ kind: 'bone', ev: 'start' });
  if (st.red.shield) G.vis.push({ kind: 'bone', ev: 'start' });
  G.banner = { text: '戰鬥！', sub: '剩下的器官自動開打', t0: performance.now(), life: 1100 };
  onceTip('battle', '戰鬥期：每個器官自己行動。爪攻擊、心回血、眼讓爪暴擊、毒疊層、骨給護盾。點器官可看說明。');
  hud();
}
const organById = (id: string) => G.game.organs.find((o) => o.id === id);
const bodyCenter = (side: Side): V => (side === 'blue' ? [350, 760] : [350, 260]);
function targetOf(side: Side, salt: number): V {
  const foe = G.game.organs.filter((o, i) => o.side !== side && G.game.alive[i]);
  return foe.length ? foe[salt % foe.length].p : bodyCenter(side === 'blue' ? 'red' : 'blue');
}
function playBattleEvent(e: BattleEvent): void {
  const now = performance.now(), d = G.disp;
  if (e.t === 'claw') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue', to = targetOf(e.side, e.ms / 10);
    if (o) { G.shots.push({ from: o.p, to, t0: now, dur: 220 * G.battleScale, color: e.crit ? '#ffd166' : kindColor('claw', e.side), crit: e.crit, side: e.side }); glow(o.id); }
    d[foe].shield -= e.shieldHit; d[foe].hp = e.hpAfter;
    pop([to[0] + 20, to[1] - 24], e.crit ? `暴擊 ${e.raw}` : `${e.raw}`, e.crit ? '#ffd166' : foe === 'red' ? '#ffffff' : '#ff8a8a', e.crit ? 26 : 20);
    if (e.shieldHit) { pop([to[0] - 26, to[1] + 12], `護盾 −${e.shieldHit}`, '#e8e1d0', 14); G.vis.push({ kind: 'bone', ev: 'claw' }); }
    G.vis.push({ kind: 'claw', ev: 'claw' }); if (e.crit) { G.vis.push({ kind: 'eye', ev: 'claw' }); sfx('crit'); onceTip('eye', DESC.eye.line); } else sfx('claw');
    onceTip('claw', DESC.claw.line);
    if (foe === 'blue') { G.shakeUntil = now + 120; }
  } else if (e.t === 'heal') {
    const o = organById(e.id); d[e.side].hp = e.hpAfter;
    if (o) { pop([o.p[0], o.p[1] - 30], `+${e.amount}`, '#7CFF6B', 18); glow(o.id); }
    G.vis.push({ kind: 'heart', ev: 'heal' }); sfx('heal'); onceTip('heart', DESC.heart.line);
  } else if (e.t === 'poisonStack') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue'; d[foe].poison = e.stacks;
    if (o) { G.shots.push({ from: o.p, to: bodyCenter(foe), t0: now, dur: 300 * G.battleScale, color: '#7CFF6B', crit: false, side: e.side }); glow(o.id); }
    G.vis.push({ kind: 'poison', ev: 'poisonStack' }); sfx('poison'); onceTip('poison', DESC.poison.line);
  } else if (e.t === 'poisonTick') {
    d[e.side].shield -= e.shieldHit; d[e.side].hp = e.hpAfter;
    const c = bodyCenter(e.side); pop([c[0] + 90, c[1]], `毒 ${e.raw}`, '#7CFF6B', 18);
    G.vis.push({ kind: 'poison', ev: 'poisonTick' }); if (e.shieldHit) G.vis.push({ kind: 'bone', ev: 'poisonTick' });
  } else if (e.t === 'overtime') {
    G.banner = { text: '加時', sub: '所有傷害 ×2', t0: now, life: 1000 }; G.vis.push({ kind: 'overtime', ev: 'overtime' });
  } else if (e.t === 'end') {
    const win = e.winner === 'blue';
    G.banner = { text: win ? '勝！' : e.winner === 'draw' ? '平手' : '敗', sub: e.how === 'time' ? '時間到，比剩餘血量百分比' : e.how === 'empty' ? '一方沒有器官' : '血量歸零', t0: now, life: 1400 };
    sfx(win ? 'win' : 'lose'); if (!win) vibrate([60, 40, 60]);
    if (e.winner !== 'blue') burst(bodyCenter('blue'), '#ff4d4d', 60, 1.6); if (e.winner !== 'red') burst(bodyCenter('red'), '#ffd166', 60, 1.6);
  }
  hud();
}
const glowUntil = new Map<string, number>();
function glow(id: string): void { glowUntil.set(id, performance.now() + 260); }
function battleTick(now: number): void {
  if (G.ui !== 'battle' || !G.battle) return;
  G.bClock = ((now - G.bT0) / G.battleScale) * G.speed;
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
    b.innerHTML = `<b>${KIND_ZH[k]}・${DESC[k].role}</b><small>${DESC[k].line}</small>`;
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
function hud(): void {
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
  if (G.ui === 'cut' && !G.drag) els.info.innerHTML = '從<b>藍色獸身</b>拖線切紅方器官；點器官看說明。';
  else if (G.ui === 'place') els.info.innerHTML = `點獸身放下「${KIND_ZH[G.camp.picked ?? 'claw']}」。綠圈＝可放，紅圈＝不能放。`;
  else if (G.ui === 'battle') els.info.innerHTML = '戰鬥中：器官自己行動（可按「快轉」）。';
}

// ---------------------------------------------------------------- 輸入
function organAt(p: V): { kind: Kind; side: Side } | null {
  const s = G.game;
  for (let i = s.organs.length - 1; i >= 0; i--) { const o = s.organs[i]; if (s.alive[i] && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) <= R + 6) return { kind: o.kind, side: o.side }; }
  return null;
}
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  const p = toWorld(e.clientX, e.clientY);
  if (G.ui === 'place') { tryPlace(p); return; }
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
  if (!r.ok) { els.info.innerHTML = `<span class="warnc">${r.reject === 'start' ? '起點要在你的獸身上' : r.reject === 'cooldown' ? '冷卻中' : r.reject === 'short' ? '刀太短' : '不能出刀'}</span>`; return; }
  const s = G.game;
  els.info.innerHTML = `${r.locks.length ? `鎖住 ${r.locks.map((i) => KIND_ZH[s.organs[i].kind]).join('、')}　` : ''}${r.severed !== null ? `<b>切下 ${KIND_ZH[s.organs[r.severed].kind]}</b>` : r.blocked !== null ? '<span class="warnc">被鎖住的器官擋下</span>' : '揮空'}`;
}
els.sound.onclick = () => { G.sound = !G.sound; try { localStorage.setItem('duel-cb-sound', G.sound ? '1' : '0'); } catch { /* 略過 */ } hud(); };
els.fast.onclick = () => { if (G.ui === 'battle') { G.speed = G.speed === 1 ? 3 : 1; els.fast.textContent = G.speed === 1 ? '快轉' : '正常速度'; } };
els.restart.onclick = () => newRun();
els.again.onclick = () => newRun();

// ---------------------------------------------------------------- 繪製
const ctx = els.canvas.getContext('2d')!;
const COL = { bg: '#070D19', blue: '#278DD1', blueHi: '#AEEAFF', red: '#C73548', redLo: '#491C2A', bone: '#C8C0AF', poison: '#7CFF6B', eye: '#ffd166' };
function kindColor(k: Kind, side: Side): string {
  if (k === 'heart') return side === 'blue' ? '#5fc8ff' : '#ff4d6a';
  if (k === 'eye') return COL.eye; if (k === 'poison') return COL.poison; return COL.bone;
}
function pop(p: V, text: string, color: string, size = 20, life = 900): void { G.pops.push({ p: [p[0], p[1]], text, color, t0: performance.now(), life, size }); }
function burst(p: V, c: string, n: number, sp = 1): void { const now = performance.now(); for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, v = (100 + Math.random() * 240) * sp; G.particles.push({ p: [p[0], p[1]], v: [Math.cos(a) * v, Math.sin(a) * v - 60], c, t0: now, life: 450 + Math.random() * 400, r: 1.5 + Math.random() * 3 }); } }
function drawBody(side: Side, now: number): void {
  const poly = BODY[side];
  ctx.save();
  ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
  const g = ctx.createLinearGradient(0, side === 'blue' ? 430 : 20, 0, side === 'blue' ? 980 : 570);
  if (side === 'blue') { g.addColorStop(0, '#142D49cc'); g.addColorStop(1, '#0a1a2e99'); } else { g.addColorStop(0, '#491C2A99'); g.addColorStop(1, '#2a0f18cc'); }
  ctx.fillStyle = g; ctx.shadowColor = side === 'blue' ? COL.blue : COL.red; ctx.shadowBlur = 22 + 6 * Math.sin(now / 700 + (side === 'blue' ? 0 : 2));
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = side === 'blue' ? '#278DD155' : '#C7354855'; ctx.lineWidth = 2; ctx.stroke();
  // 流動纖維（幽光）
  ctx.clip(); ctx.globalAlpha = 0.18; ctx.strokeStyle = side === 'blue' ? COL.blueHi : '#ff8a9a'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const y0 = (side === 'blue' ? 470 : 60) + i * 55, ph = now / 1800 + i;
    ctx.beginPath(); for (let x = 0; x <= 700; x += 35) { const y = y0 + Math.sin(x / 90 + ph) * 14; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  }
  ctx.restore();
}
function organPath(k: Kind, r: number): void {
  ctx.beginPath();
  if (k === 'heart') { ctx.moveTo(0, r * 0.85); ctx.bezierCurveTo(-r * 1.2, 0, -r * 0.7, -r * 1.05, 0, -r * 0.4); ctx.bezierCurveTo(r * 0.7, -r * 1.05, r * 1.2, 0, 0, r * 0.85); }
  else if (k === 'eye') { ctx.moveTo(-r, 0); ctx.quadraticCurveTo(0, -r * 0.95, r, 0); ctx.quadraticCurveTo(0, r * 0.95, -r, 0); }
  else if (k === 'poison') { ctx.moveTo(0, -r); ctx.bezierCurveTo(r * 0.9, -r * 0.1, r * 0.8, r, 0, r); ctx.bezierCurveTo(-r * 0.8, r, -r * 0.9, -r * 0.1, 0, -r); }
  else if (k === 'bone') { const w = r * 0.32; ctx.rect(-r * 0.62, -w, r * 1.24, w * 2); for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.moveTo(sx * r * 0.62 + r * 0.26, sy * w * 1.15); ctx.arc(sx * r * 0.62, sy * w * 1.15, r * 0.26, 0, Math.PI * 2); } }
  else { for (let f = -1; f <= 1; f++) { ctx.moveTo(f * r * 0.45 - r * 0.15, r * 0.7); ctx.quadraticCurveTo(f * r * 0.55 + r * 0.25, 0, f * r * 0.3 + r * 0.05, -r * 0.95); ctx.quadraticCurveTo(f * r * 0.4, 0, f * r * 0.45 + r * 0.15, r * 0.7); } }
}
function drawOrgan(o: { id: string; kind: Kind; side: Side; p: V }, i: number, now: number, hl: string | null): void {
  const s = G.game, r = R * 0.95, c = kindColor(o.kind, o.side);
  const sprout = G.ui === 'cut' && !isReady(s, i), locked = G.ui === 'cut' && isLocked(s, i), lit = (glowUntil.get(o.id) ?? 0) > now;
  ctx.save(); ctx.translate(o.p[0], o.p[1]);
  ctx.globalAlpha = sprout ? 0.35 + 0.25 * Math.sin(now / 80) : 1;
  // 底座：陣營色光暈，一眼分得出敵我
  ctx.fillStyle = o.side === 'blue' ? '#278DD133' : '#C7354833'; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = o.side === 'blue' ? '#5fc8ff' : '#ff5a6e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.shadowColor = c; ctx.shadowBlur = lit ? 34 : 14;
  ctx.fillStyle = c; organPath(o.kind, lit ? r * 1.15 : r); ctx.fill();
  if (o.kind === 'eye') { ctx.shadowBlur = 0; ctx.fillStyle = '#1a1300'; ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill(); }
  ctx.shadowBlur = 0; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffffdd'; ctx.fillText(KIND_ZH[o.kind], 0, -r - 12);
  if (locked) {
    const left = (s.lockUntil[i] - s.step) / LOCK_STEPS;
    ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
  }
  if (hl) { ctx.strokeStyle = hl; ctx.lineWidth = 3; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(0, 0, r + 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore();
}
function draw(now: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cw, ch);
  let sh: V = [0, 0]; if (now < G.shakeUntil) sh = [(Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 6];
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sh[0] * scale), dpr * (oy + sh[1] * scale));
  drawBody('red', now); drawBody('blue', now);
  const s = G.game, pv = G.drag && G.preview?.ok ? G.preview : null;
  s.organs.forEach((o, i) => {
    if (!s.alive[i]) return;
    const hl = pv ? (pv.severed === i ? '#ff6b6b' : pv.locks.includes(i) ? '#cfe8ff' : pv.blocked === i ? '#ffd166' : null) : null;
    drawOrgan(o, i, now, hl);
  });
  // AI 預告
  if (G.ui === 'cut' && s.aim) {
    const a = s.aim, k = Math.min(1, (s.step - a.aimStep) / Math.max(1, a.fireStep - a.aimStep)), l = clampLine(a.line);
    ctx.save(); ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.setLineDash([12, 9]); ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 90);
    ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.a[0] + (l.b[0] - l.a[0]) * k, l.a[1] + (l.b[1] - l.a[1]) * k); ctx.stroke();
    ctx.restore();
  }
  // 我的拖曳
  if (G.drag && G.ui === 'cut') {
    const l = clampLine({ a: G.drag.a, b: G.drag.b }), ok = G.preview?.ok;
    ctx.save(); ctx.strokeStyle = ok ? '#ffffff' : '#ff7a7a'; ctx.lineWidth = 3; ctx.shadowColor = COL.blueHi; ctx.shadowBlur = 14; if (!ok) ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke(); ctx.restore();
  }
  // 刀光
  G.slashes = G.slashes.filter((x) => now - x.t0 < 320);
  for (const x of G.slashes) { const k = 1 - (now - x.t0) / 320; ctx.save(); ctx.globalAlpha = k; ctx.strokeStyle = x.side === 'blue' ? '#e6f7ff' : '#ffb3b3'; ctx.shadowColor = x.side === 'blue' ? COL.blueHi : '#ff5a5a'; ctx.shadowBlur = 24; ctx.lineWidth = 3 + 4 * k; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x.a[0], x.a[1]); ctx.lineTo(x.b[0], x.b[1]); ctx.stroke(); ctx.restore(); }
  // 戰鬥：爪痕／毒球
  G.shots = G.shots.filter((x) => now - x.t0 < x.dur + 160);
  for (const x of G.shots) {
    const k = Math.min(1, (now - x.t0) / x.dur), p: V = [x.from[0] + (x.to[0] - x.from[0]) * k, x.from[1] + (x.to[1] - x.from[1]) * k];
    ctx.save(); ctx.strokeStyle = x.color; ctx.shadowColor = x.color; ctx.shadowBlur = x.crit ? 30 : 16; ctx.lineWidth = x.crit ? 5 : 3; ctx.lineCap = 'round';
    const dx = x.to[0] - x.from[0], dy = x.to[1] - x.from[1], L = Math.hypot(dx, dy) || 1, n: V = [-dy / L, dx / L];
    for (let f = -1; f <= 1; f++) { ctx.beginPath(); ctx.moveTo(p[0] - (dx / L) * 40 + n[0] * f * 8, p[1] - (dy / L) * 40 + n[1] * f * 8); ctx.lineTo(p[0] + n[0] * f * 8, p[1] + n[1] * f * 8); ctx.stroke(); }
    ctx.restore();
  }
  // 戰鬥：毒層數、護盾
  if (G.ui === 'battle' || G.ui === 'contrib') for (const side of ['blue', 'red'] as Side[]) {
    const d = G.disp[side], c = bodyCenter(side);
    if (d.poison) { ctx.save(); ctx.fillStyle = COL.poison; ctx.shadowColor = COL.poison; ctx.shadowBlur = 14; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`☠ 毒 ×${d.poison}`, c[0] + 200, c[1] - 80); ctx.restore(); }
    if (d.shield > 0) { ctx.save(); ctx.strokeStyle = '#e8e1d0aa'; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.ellipse(c[0], c[1], 300, 190, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }
  // 擺放預覽
  if (G.ui === 'place') {
    for (const st of G.camp.stitches) { ctx.save(); ctx.strokeStyle = '#ffd166'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(st.p[0], st.p[1], R + 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    if (G.ghost && G.camp.picked) { ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = G.ghostOk ? '#7CFF6B' : '#ff4d4d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(G.ghost[0], G.ghost[1], R, 0, Math.PI * 2); ctx.stroke(); ctx.translate(G.ghost[0], G.ghost[1]); ctx.fillStyle = kindColor(G.camp.picked, 'blue'); organPath(G.camp.picked, R * 0.8); ctx.fill(); ctx.restore(); }
  }
  // 粒子與跳字
  G.particles = G.particles.filter((q) => now - q.t0 < q.life);
  for (const q of G.particles) { const k = (now - q.t0) / 1000; ctx.globalAlpha = Math.max(0, 1 - (now - q.t0) / q.life); ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.p[0] + q.v[0] * k, q.p[1] + q.v[1] * k + 280 * k * k, q.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  G.pops = G.pops.filter((q) => now - q.t0 < q.life);
  for (const q of G.pops) { const k = (now - q.t0) / q.life; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4); ctx.font = `600 ${q.size}px Georgia, "Noto Serif TC", serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000000b0'; ctx.strokeText(q.text, q.p[0], q.p[1] - 36 * k); ctx.fillStyle = q.color; ctx.fillText(q.text, q.p[0], q.p[1] - 36 * k); ctx.restore(); }
  if (G.banner && now - G.banner.t0 < G.banner.life) {
    const k = (now - G.banner.t0) / G.banner.life, sc = k < 0.15 ? 1.8 - (k / 0.15) * 0.8 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3); ctx.translate(350, 500); ctx.scale(sc, sc); ctx.textAlign = 'center';
    ctx.font = '700 64px Georgia, "Noto Serif TC", serif'; ctx.lineWidth = 7; ctx.strokeStyle = '#000'; ctx.strokeText(G.banner.text, 0, 0); ctx.fillStyle = '#F0F7FF'; ctx.fillText(G.banner.text, 0, 0);
    ctx.font = '600 22px system-ui'; ctx.lineWidth = 4; ctx.strokeText(G.banner.sub, 0, 38); ctx.fillStyle = '#AEEAFF'; ctx.fillText(G.banner.sub, 0, 38); ctx.restore();
  }
}
function frame(now: number): void {
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
  get camp() { return G.camp; }, get game() { return G.game; }, get ui() { return G.ui; }, get preview() { return G.preview; }, get lastStrike() { return G.lastStrike; },
  get battle() { return G.battle; }, get vis() { return G.vis; }, get tip() { return els.tip.hidden ? null : els.tip.textContent; }, get cutByMe() { return G.cutByMe; },
  get audio() { return audioLog; },
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
layout(); newRun();
requestAnimationFrame(frame);
