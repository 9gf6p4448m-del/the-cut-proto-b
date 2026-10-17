// 「即時亂切」手機試玩：rt-cut/（原版）與 rt-cut2/（＋擊倒＋再生）共用本檔，建置時以 __RT_MODE__ 切換；雙方 40 秒內即時互切。可丟棄原型，非正式規則。
// 規則全部在 src/rtcut/rules.ts（純函式、固定步長）；本檔只負責輸入、即時迴圈、演出與結果畫面。
import { BODY, CUT_SECONDS, COOLDOWN_STEPS, END_STEP, FPS, LOCK_STEPS, MIN_LEN, MAX_LEN, MODE_RT1, MODE_RT2, R, SPROUT_STEPS, clampLine, countSide, duel, inside, isLocked, isReady, newGame, power, resolveStrike, step } from './rtcut/rules.ts';
import type { DuelResult, GameEvent, GameState, Line, Side, StrikeResult, V } from './rtcut/rules.ts';

declare const __BUILD_SHA__: string;
declare const __RT_MODE__: string;
const RT2 = typeof __RT_MODE__ === 'string' && __RT_MODE__ === 'rt2'; // rt-cut2：擊倒＋再生
const MODE = RT2 ? MODE_RT2 : MODE_RT1;
const KO_MS = 2600; // 擊倒演出長度（凍結上限 3 秒）【試玩數值】
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const W = 700, H = 1000, STEP_MS = 1000 / FPS;
const DUEL_MS = 4200; // 對決演出長度（凍結上限 12 秒）【試玩數值】
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), info: $('info'), sha: $('sha'), timer: $('timer'),
  cdMe: $('cdMe'), cdFoe: $('cdFoe'), cdMeTxt: $('cdMeTxt'), cdFoeTxt: $('cdFoeTxt'), cntMe: $('cntMe'), cntFoe: $('cntFoe'),
  restart: $<HTMLButtonElement>('restart'), reduce: $<HTMLButtonElement>('reduce'),
  result: $('result'), resTitle: $('resTitle'), resTable: $('resTable'), resRestart: $<HTMLButtonElement>('resRestart'),
};
els.sha.textContent = BUILD_SHA;

type UiPhase = 'cut' | 'duel' | 'ko' | 'end';
interface AimVis { aimStep: number; fireStep: number; firstDraw: number; fired: number | null }
const G = {
  token: 0, state: null as unknown as GameState, ui: 'cut' as UiPhase,
  seedSource: (): number => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, // 可注入（測試注入固定來源）
  acc: 0, lastT: null as number | null,
  drag: null as { id: number; a: V; b: V } | null, release: null as Line | null,
  reduced: false, msg: '', msgCls: '', duelT0: 0, duelTimer: 0 as unknown as ReturnType<typeof setTimeout>,
  aimVis: [] as AimVis[], events: [] as { step: number; e: GameEvent }[], result: null as DuelResult | null,
};
try { G.reduced = localStorage.getItem('rtcut-reduced') === '1'; } catch { /* 無痕或封鎖儲存 */ }

// ---------------------------------------------------------------- 版面與座標
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
  els.canvas.width = Math.round(cw * dpr); els.canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / W, ch / H); ox = (cw - W * scale) / 2; oy = (ch - H * scale) / 2;
}
const sx = (x: number) => ox + x * scale, sy = (y: number) => oy + y * scale;
const toWorld = (cx: number, cy: number): V => { const r = els.canvas.getBoundingClientRect(); return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale]; };
const toScreen = (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + sx(x), y: r.top + sy(y) }; };

// ---------------------------------------------------------------- 音效與震動（合成，不需素材）
let actx: AudioContext | null = null;
function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  try {
    if (!actx) { const C = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; const K = C.AudioContext || C.webkitAudioContext; if (!K) return; actx = new K(); }
    if (actx.state === 'suspended') void actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch { /* 音訊失敗不影響遊戲 */ }
}
function vibrate(p: number | number[]): void {
  if (G.reduced) return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') { try { nav.vibrate(p); } catch { /* 略過 */ } }
}

// ---------------------------------------------------------------- 演出
const fx = {
  slashes: [] as { side: Side; a: V; b: V; t0: number }[],
  pops: [] as { p: V; text: string; color: string; t0: number }[],
  bits: [] as { p: V; v: V; color: string; t0: number }[],
  shakeUntil: 0,
};
const COLOR: Record<Side, string> = { blue: '#58c4dd', red: '#e05a5a' };
const name = (i: number) => G.state.organs[i].id.slice(1);
function say(text: string, cls = ''): void { G.msg = text; G.msgCls = cls; }
function onEvents(evs: GameEvent[], now: number): void {
  for (const e of evs) {
    G.events.push({ step: G.state.step, e });
    if (e.t === 'aim') G.aimVis.push({ aimStep: e.aim.aimStep, fireStep: e.aim.fireStep, firstDraw: -1, fired: null });
    else if (e.t === 'reject' && e.side === 'blue') {
      say({ cooldown: '冷卻中，這刀沒出', short: `刀太短（至少 ${MIN_LEN}），沒出刀`, start: '要從你的獸身（下方藍色）起刀', phase: '時間到，不能再出刀' }[e.reason], 'bad');
    } else if (e.t === 'strike') strikeFx(e.r, now);
    else if (e.t === 'duel') startDuel(e.result, now);
    else if (e.t === 'ko') startKo(e.result, now);
    else if (e.t === 'spawn') { const o = G.state.organs[e.i]; fx.pops.push({ p: o.p, text: '再生', color: o.side === 'blue' ? '#8fe3ff' : '#ff9a9a', t0: now }); }
  }
}
function strikeFx(r: StrikeResult, now: number): void {
  fx.slashes.push({ side: r.side, a: r.line.a, b: r.end, t0: now });
  if (r.side === 'red') { const v = G.aimVis.find((x) => x.fireStep === G.state.step - 1 && x.fired === null); if (v) v.fired = now; }
  for (const i of r.locks) fx.pops.push({ p: G.state.organs[i].p, text: '鎖', color: '#ffe08a', t0: now });
  const who = r.side === 'blue' ? '你' : '牠';
  const parts: string[] = [];
  if (r.locks.length) parts.push(`鎖住 ${r.locks.map(name).join('、')}`);
  if (r.severed !== null) {
    const o = G.state.organs[r.severed];
    parts.push(`切掉${r.side === 'blue' ? '牠的' : '你的'}${name(r.severed)}`);
    fx.pops.push({ p: o.p, text: '切除', color: '#fff', t0: now });
    if (!G.reduced) { for (let k = 0; k < 12; k++) { const ang = (k / 12) * Math.PI * 2; fx.bits.push({ p: [o.p[0], o.p[1]], v: [Math.cos(ang) * 180, Math.sin(ang) * 180 - 80], color: COLOR[o.side], t0: now }); } fx.shakeUntil = now + 200; }
    tone(120, 0.2, 0.25); vibrate([15, 25, 15]);
  } else if (r.blocked !== null) {
    parts.push(`被${name(r.blocked)}的護盾擋下`);
    fx.pops.push({ p: G.state.organs[r.blocked].p, text: '擋', color: '#ffe08a', t0: now }); tone(900, 0.08, 0.1, 'square');
  } else tone(500, 0.06, 0.06, 'triangle');
  say(`${who}${parts.length ? parts.join('，') : '揮空'}`, r.side === 'blue' ? (r.severed !== null ? 'good' : '') : (r.severed !== null ? 'bad' : ''));
}

// ---------------------------------------------------------------- 對決與結果
function startDuel(res: DuelResult, now: number): void {
  G.ui = 'duel'; G.result = res; G.drag = null; G.release = null; G.duelT0 = now;
  say('時間到！剩下的器官對打', '');
  const tk = G.token;
  G.duelTimer = setTimeout(() => { if (tk === G.token) showResult(res); }, DUEL_MS);
}
function startKo(res: DuelResult, now: number): void {
  G.ui = 'ko'; G.result = res; G.drag = null; G.release = null; G.duelT0 = now;
  const w = G.state.end?.winner;
  say(w === 'draw' ? '雙方同時倒下！' : w === 'blue' ? '擊倒！牠的器官被你切光了' : '你被擊倒了', w === 'blue' ? 'good' : 'bad');
  tone(70, 0.6, 0.35); vibrate([30, 40, 60]);
  const tk = G.token;
  G.duelTimer = setTimeout(() => { if (tk === G.token) showResult(res); }, KO_MS);
}
function showResult(res: DuelResult): void {
  G.ui = 'end';
  const end = G.state.end, w = end ? end.winner : res.winner;
  els.resTitle.textContent = end && end.by === 'ko' ? (w === 'draw' ? '同時倒下・平手' : w === 'blue' ? '擊倒勝' : '被擊倒') : w === 'draw' ? '平手' : w === 'blue' ? '你贏了' : '你輸了';
  els.resTable.innerHTML = '';
  const rows: [string, string, string][] = [['', '你', '牠'], ['剩餘爪', `${res.claws.blue}`, `${res.claws.red}`], ['剩餘心', `${res.hearts.blue}`, `${res.hearts.red}`], ['戰力', `${res.power.blue}`, `${res.power.red}`]];
  if (RT2) rows.push(['結束方式', end && end.by === 'ko' ? '擊倒' : '時間到', ''], ['總切除數', `${G.state.severedN.blue}`, `${G.state.severedN.red}`]);
  for (const [k, a, b] of rows) { const tr = document.createElement('tr'); for (const t of [k, a, b]) { const td = document.createElement(k ? 'td' : 'th'); td.textContent = t; tr.appendChild(td); } els.resTable.appendChild(tr); }
  const note = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 3; td.textContent = '戰力＝2 × 爪 × (1＋心)'; td.style.fontSize = '12px'; td.style.opacity = '.75'; note.appendChild(td); els.resTable.appendChild(note);
  els.result.hidden = false;
}

// ---------------------------------------------------------------- 重開
function restart(): void {
  G.token++; clearTimeout(G.duelTimer);
  G.state = newGame(G.seedSource(), MODE);
  G.ui = 'cut'; G.acc = 0; G.lastT = null; G.drag = null; G.release = null; G.result = null;
  G.aimVis = []; G.events = [];
  fx.slashes = []; fx.pops = []; fx.bits = []; fx.shakeUntil = 0;
  els.result.hidden = true;
  say('從下方藍色獸身拖一條線，放開出刀。刀穿過自己的器官＝鎖住；碰到牠的器官＝切掉。');
  hud(); // 重開當下就把計時、冷卻、數量寫回初始值（不等下一幀）
}
els.restart.addEventListener('click', restart);
els.resRestart.addEventListener('click', restart);
els.reduce.addEventListener('click', () => { G.reduced = !G.reduced; els.reduce.setAttribute('aria-pressed', String(G.reduced)); try { localStorage.setItem('rtcut-reduced', G.reduced ? '1' : '0'); } catch { /* 略過 */ } });
els.reduce.setAttribute('aria-pressed', String(G.reduced));

// ---------------------------------------------------------------- 輸入
const dragLine = (): Line | null => (G.drag ? { a: G.drag.a, b: G.drag.b } : null);
els.canvas.addEventListener('pointerdown', (e) => {
  if (G.ui !== 'cut' || G.drag) return;
  els.canvas.setPointerCapture?.(e.pointerId);
  const p = toWorld(e.clientX, e.clientY);
  G.drag = { id: e.pointerId, a: p, b: p };
});
els.canvas.addEventListener('pointermove', (e) => { if (G.drag && e.pointerId === G.drag.id) G.drag.b = toWorld(e.clientX, e.clientY); });
els.canvas.addEventListener('pointerup', (e) => {
  if (!G.drag || e.pointerId !== G.drag.id) return;
  G.drag.b = toWorld(e.clientX, e.clientY);
  if (G.ui === 'cut') G.release = { a: G.drag.a, b: G.drag.b };
  G.drag = null;
});
els.canvas.addEventListener('pointercancel', (e) => { if (G.drag && e.pointerId === G.drag.id) G.drag = null; });

// ---------------------------------------------------------------- 即時迴圈（模擬時間；背景分頁暫停）
document.addEventListener('visibilitychange', () => { G.lastT = null; });
function frame(now: number): void {
  if (!document.hidden && G.ui === 'cut') {
    if (G.lastT !== null) G.acc += Math.min(now - G.lastT, 100);
    G.lastT = now;
    while (G.acc >= STEP_MS && G.ui === 'cut') {
      G.acc -= STEP_MS;
      const rel = G.release; G.release = null;
      const out = step(G.state, { blue: rel, drag: dragLine() });
      G.state = out.state;
      onEvents(out.events, now);
    }
  }
  render(now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- 繪製
function poly(ctx: CanvasRenderingContext2D, pts: V[]): void { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.closePath(); }
function organ(ctx: CanvasRenderingContext2D, i: number, now: number): void {
  const o = G.state.organs[i], x = sx(o.p[0]), y = sy(o.p[1]), r = R * scale;
  ctx.save();
  if (!isReady(G.state, i)) {
    const k = 1 - (G.state.readyAt[i] - G.state.step) / SPROUT_STEPS;
    ctx.globalAlpha = 0.35 + 0.4 * k; ctx.strokeStyle = COLOR[o.side]; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLOR[o.side]; ctx.font = `bold ${Math.max(11, Math.round(r * 0.6))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('萌', x, y);
    ctx.restore(); return;
  }
  ctx.fillStyle = o.side === 'blue' ? '#2f7f95' : '#a8323f'; ctx.strokeStyle = COLOR[o.side]; ctx.lineWidth = 2;
  if (o.kind === 'heart') {
    const beat = 1 + 0.06 * Math.sin(now / 160 + i);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9 * beat, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(r * 0.9)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('心', x, y + 1);
  } else {
    const dir = o.side === 'blue' ? -1 : 1; // 爪尖朝向對方
    ctx.beginPath(); ctx.moveTo(x, y + dir * r); ctx.lineTo(x + r * 0.85, y - dir * r * 0.6); ctx.lineTo(x, y - dir * r * 0.2); ctx.lineTo(x - r * 0.85, y - dir * r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (isLocked(G.state, i)) {
    const left = (G.state.lockUntil[i] - G.state.step) / LOCK_STEPS;
    ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    ctx.fillStyle = '#ffe08a'; ctx.font = `bold ${Math.max(11, Math.round(r * 0.6))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((G.state.lockUntil[i] - G.state.step) / FPS).toFixed(1), x, y - r - 12);
  }
  ctx.restore();
}
function render(realNow: number): void {
  const now = G.ui === 'ko' ? G.duelT0 + (realNow - G.duelT0) * 0.25 : realNow; // 擊倒慢動作
  layout();
  const ctx = els.canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  if (now < fx.shakeUntil) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  ctx.fillStyle = 'rgba(224,90,90,0.16)'; ctx.strokeStyle = 'rgba(224,90,90,0.6)'; ctx.lineWidth = 1.5; poly(ctx, BODY.red); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(88,196,221,0.16)'; ctx.strokeStyle = 'rgba(88,196,221,0.6)'; poly(ctx, BODY.blue); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('牠的獸身', sx(30), sy(28)); ctx.textBaseline = 'bottom'; ctx.fillText('你的獸身（從這裡起刀）', sx(30), sy(972));
  const s = G.state;
  G.state.organs.forEach((_, i) => { if (s.alive[i]) organ(ctx, i, now); });
  // AI 預告：刀線在預告開始時固定
  if (s.aim && G.ui === 'cut') {
    const a = s.aim, prog = Math.min(1, (s.step - a.aimStep) / (a.fireStep - a.aimStep));
    const v = G.aimVis.find((x) => x.aimStep === a.aimStep && x.fireStep === a.fireStep); if (v && v.firstDraw < 0) v.firstDraw = now;
    const l = clampLine(a.line);
    ctx.save(); ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(255,120,120,0.95)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx(l.a[0]), sy(l.a[1])); ctx.lineTo(sx(l.b[0]), sy(l.b[1])); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx(l.a[0]), sy(l.a[1])); ctx.lineTo(sx(l.a[0] + (l.b[0] - l.a[0]) * prog), sy(l.a[1] + (l.b[1] - l.a[1]) * prog)); ctx.stroke();
    ctx.fillStyle = '#ff8080'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('牠瞄準', sx(l.a[0]), sy(l.a[1]) - 8);
    ctx.restore();
  }
  // 玩家拖曳預覽
  if (G.drag && G.ui === 'cut') {
    const l = clampLine({ a: G.drag.a, b: G.drag.b }), len = Math.hypot(G.drag.b[0] - G.drag.a[0], G.drag.b[1] - G.drag.a[1]);
    const okStart = inside(G.drag.a, BODY.blue), cd = s.cdUntil.blue > s.step, short = len < MIN_LEN;
    ctx.save(); ctx.lineWidth = 5; ctx.strokeStyle = !okStart ? '#ff7a7a' : cd || short ? '#8a8f99' : '#bff2ff';
    ctx.beginPath(); ctx.moveTo(sx(l.a[0]), sy(l.a[1])); ctx.lineTo(sx(l.b[0]), sy(l.b[1])); ctx.stroke();
    if (okStart && !short) {
      const pv = resolveStrike({ ...s, cdUntil: { ...s.cdUntil, blue: 0 } }, 'blue', l);
      for (const i of pv.locks) { ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx(G.state.organs[i].p[0]), sy(G.state.organs[i].p[1]), R * scale + 9, 0, Math.PI * 2); ctx.stroke(); }
      const tgt = pv.severed ?? pv.blocked;
      if (tgt !== null) { ctx.strokeStyle = pv.severed !== null ? '#ffffff' : '#ffe08a'; ctx.lineWidth = 3; const p = G.state.organs[tgt].p, d = R * scale; ctx.beginPath(); ctx.moveTo(sx(p[0]) - d, sy(p[1]) - d); ctx.lineTo(sx(p[0]) + d, sy(p[1]) + d); ctx.moveTo(sx(p[0]) + d, sy(p[1]) - d); ctx.lineTo(sx(p[0]) - d, sy(p[1]) + d); ctx.stroke(); }
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(!okStart ? '要從藍色獸身起刀' : cd ? '冷卻中' : short ? '再長一點' : len > MAX_LEN ? '最長 420' : '', sx(l.b[0]), sy(l.b[1]) - 10);
    ctx.restore();
  }
  // 刀光、粒子、字
  fx.slashes = fx.slashes.filter((f) => now - f.t0 < 320);
  for (const f of fx.slashes) { const k = 1 - (now - f.t0) / 320; ctx.save(); ctx.globalAlpha = k; ctx.strokeStyle = f.side === 'blue' ? '#dff8ff' : '#ffd0d0'; ctx.lineWidth = 7 * k + 1; ctx.beginPath(); ctx.moveTo(sx(f.a[0]), sy(f.a[1])); ctx.lineTo(sx(f.b[0]), sy(f.b[1])); ctx.stroke(); ctx.restore(); }
  fx.bits = fx.bits.filter((b) => now - b.t0 < 600);
  for (const b of fx.bits) { const t = (now - b.t0) / 1000; ctx.fillStyle = b.color; ctx.globalAlpha = 1 - t / 0.6; ctx.fillRect(sx(b.p[0] + b.v[0] * t) - 3, sy(b.p[1] + b.v[1] * t + 400 * t * t) - 3, 6, 6); ctx.globalAlpha = 1; }
  fx.pops = fx.pops.filter((p) => now - p.t0 < 800);
  for (const p of fx.pops) { const t = (now - p.t0) / 800; ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.text, sx(p.p[0]), sy(p.p[1]) - 30 - t * 30); ctx.globalAlpha = 1; }
  if (G.ui === 'ko') koFx(ctx, realNow);
  else if (G.ui !== 'cut' && G.result) duelFx(ctx, now);
  ctx.restore();
  hud();
}
function koFx(ctx: CanvasRenderingContext2D, now: number): void {
  const t = Math.min(1, (now - G.duelT0) / KO_MS), w = G.state.end?.winner;
  ctx.fillStyle = `rgba(14,17,22,${0.5 * Math.min(1, t * 3)})`; ctx.fillRect(0, 0, cw, ch);
  const z = 1 + 0.6 * Math.max(0, 1 - t * 4);
  ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(z, z);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${Math.round(Math.min(cw, ch) * 0.2)}px system-ui`;
  ctx.fillStyle = w === 'blue' ? '#8fe3ff' : w === 'red' ? '#ff8a8a' : '#e6d7bf'; ctx.fillText('擊倒', 0, 0);
  ctx.font = `bold ${Math.round(Math.min(cw, ch) * 0.05)}px system-ui`; ctx.fillStyle = '#fff';
  ctx.fillText(w === 'draw' ? '同時倒下' : w === 'blue' ? '你贏了' : '你輸了', 0, Math.min(cw, ch) * 0.14);
  ctx.restore();
}
function duelFx(ctx: CanvasRenderingContext2D, now: number): void {
  const t = Math.min(1, (now - G.duelT0) / DUEL_MS), res = G.result!;
  ctx.fillStyle = `rgba(14,17,22,${0.35 * t})`; ctx.fillRect(0, 0, cw, ch);
  // 雙方剩下的爪輪流朝對方中線出擊
  G.state.organs.forEach((o, i) => {
    if (!G.state.alive[i] || o.kind !== 'claw') return;
    const ph = ((now - G.duelT0) / 600 + i * 0.37) % 1, ty = o.side === 'blue' ? 300 : 700;
    const y = o.p[1] + (ty - o.p[1]) * Math.sin(ph * Math.PI) * 0.5;
    ctx.strokeStyle = COLOR[o.side]; ctx.lineWidth = 3; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(sx(o.p[0]), sy(o.p[1])); ctx.lineTo(sx(o.p[0]), sy(y)); ctx.stroke(); ctx.globalAlpha = 1;
  });
  const k = Math.min(1, t * 1.6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${Math.round(46 * scale + 14)}px system-ui`;
  ctx.fillStyle = COLOR.red; ctx.fillText(`${Math.round(res.power.red * k)}`, sx(350), sy(240));
  ctx.fillStyle = COLOR.blue; ctx.fillText(`${Math.round(res.power.blue * k)}`, sx(350), sy(760));
  ctx.font = `bold ${Math.round(18 * scale + 10)}px system-ui`; ctx.fillStyle = '#fff'; ctx.fillText('對決', sx(350), sy(500));
}
function hud(): void {
  const s = G.state, left = Math.max(0, (END_STEP - s.step) / FPS);
  els.timer.textContent = left.toFixed(1); els.timer.classList.toggle('low', left <= 10);
  for (const [side, bar, txt] of [['blue', els.cdMe, els.cdMeTxt], ['red', els.cdFoe, els.cdFoeTxt]] as [Side, HTMLElement, HTMLElement][]) {
    const rem = Math.max(0, s.cdUntil[side] - s.step);
    bar.style.width = `${(100 * (COOLDOWN_STEPS - rem)) / COOLDOWN_STEPS}%`;
    txt.textContent = s.phase !== 'cut' ? '—' : rem ? (rem / FPS).toFixed(1) : '好了';
    bar.parentElement!.parentElement!.classList.toggle('wait', rem > 0);
  }
  const d = duel(s);
  els.cntMe.textContent = `你：爪 ${d.claws.blue}　心 ${d.hearts.blue}　戰力 ${power(d.claws.blue, d.hearts.blue)}`;
  els.cntFoe.textContent = `牠：爪 ${d.claws.red}　心 ${d.hearts.red}　戰力 ${power(d.claws.red, d.hearts.red)}`;
  const html = G.msgCls ? `<span class="${G.msgCls}">${G.msg}</span>` : G.msg;
  if (els.info.innerHTML !== html) els.info.innerHTML = html;
}

// ---------------------------------------------------------------- 測試掛鉤（只讀；可注入種子來源與時間推進，供自動測試）
const hook = {
  get state() { return G.state; }, get ui() { return G.ui; }, get aimVis() { return G.aimVis; }, get events() { return G.events; }, get result() { return G.result; },
  get drag() { return G.drag; }, toScreen, restart, CUT_SECONDS, DUEL_MS, KO_MS, RT2,
  /** 測試用（rt-cut2）：直接把指定器官判為已切（照規則記入再生佇列與切除數），至少留 1 個給真實刀路觸發擊倒；正常遊玩不會呼叫。 */
  testSever(ids: number[]) { const s = { ...G.state, alive: [...G.state.alive], lockUntil: [...G.state.lockUntil], severedQ: { blue: [...G.state.severedQ.blue], red: [...G.state.severedQ.red] } }; for (const i of ids) { if (!s.alive[i]) continue; s.alive[i] = false; s.lockUntil[i] = 0; s.severedQ[s.organs[i].side].push(s.organs[i].kind); } if (countSide(s, 'blue') === 0 || countSide(s, 'red') === 0) throw new Error('testSever 不得清空一方'); G.state = s; },
  setSeedSource(f: () => number) { G.seedSource = f; },
  /** 測試用：直接推進 n 步（不出刀），用來快轉到時間尾端；正常遊玩不會呼叫。 */
  advance(n: number) { for (let i = 0; i < n && G.ui === 'cut'; i++) { const out = step(G.state, { drag: dragLine() }); G.state = out.state; onEvents(out.events, performance.now()); } },
};
(window as unknown as { __rt: typeof hook }).__rt = hook;

restart();
requestAnimationFrame(frame);
// PWA（子路徑獨立 scope；沿用 twin-sim 的更新方式：已有自己的 SW 控制時，新版接手才重載一次）
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' });
  const ownSw = new URL('./sw.js', location.href).href;
  const hadController = navigator.serviceWorker.controller?.scriptURL === ownSw;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
