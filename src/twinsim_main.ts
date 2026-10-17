// 「同時下刀」單場試玩（子路徑 twin-sim/）：雙方各自暗中出刀、同時揭曉。可丟棄原型，非正式規則。
// 規則全部在 src/twinsim/sim.ts（單刀路徑沿用 src/twinslash/rules.ts 的 resolveCut）；本檔只負責輸入、演出與紀錄。
import { aiPlan, BOARD_BP, cancelText, newSim, resolveRound, snapshot, ROUNDS } from './twinsim/sim.ts';
import type { AiPlan, Line, RoundResult, SimState } from './twinsim/sim.ts';
import { key, resolveCut, MIN_LEN, MAX_LEN, R } from './twinslash/rules.ts';
import type { CutResult, Side, V, Kind } from './twinslash/rules.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const W = 700, H = 1000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), info: $('info'), sha: $('sha'), round: $('round'),
  hpMe: $('hpMe'), hpFoe: $('hpFoe'), hpMeBar: $('hpMeBar'), hpFoeBar: $('hpFoeBar'),
  restart: $<HTMLButtonElement>('restart'), reduce: $<HTMLButtonElement>('reduce'), sound: $<HTMLButtonElement>('sound'), exportBtn: $<HTMLButtonElement>('exportBtn'),
  exportModal: $('exportModal'), exportBox: $<HTMLTextAreaElement>('exportBox'), exportClose: $<HTMLButtonElement>('exportClose'),
};
els.sha.textContent = BUILD_SHA;

type Phase = 'lock' | 'player' | 'reveal' | 'end';
interface SideLog { a: V; b: V; pathFired: string[]; fired: string[]; cancelled: string[]; severed: string | null; dmg: number }
interface RoundLog { n: number; blue: SideLog; red: SideLog; redSig: string; hpAfter: Record<Side, number> }
interface MatchLog { seed: number; rounds: RoundLog[]; result: SimState['result']; cancels: number; lockMs: number[] }
const G = {
  match: 0, token: 0, sim: null as unknown as SimState, phase: 'lock' as Phase,
  plan: null as AiPlan | null, planCalls: 0, lockDelay: 30, animScale: 1,
  drag: null as { id: number; a: V; b: V; max: number } | null, preview: null as CutResult | null,
  reduced: false, sound: true, msg: '', msgCls: '', msgUntil: 0,
  last: null as RoundResult | null, lastBefore: null as SimState | null, ghost: false,
  logs: [] as MatchLog[], anim: null as null | Anim, summary: '',
};
try { G.reduced = localStorage.getItem('twinsim-reduced') === '1'; G.sound = localStorage.getItem('twinsim-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }

// ---------------------------------------------------------------- 版面與座標
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
  els.canvas.width = Math.round(cw * dpr); els.canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / W, ch / H); ox = (cw - W * scale) / 2; oy = (ch - H * scale) / 2;
}
const sx = (x: number) => ox + x * scale, sy = (y: number) => oy + y * scale;
/** 拖超過最大刀長時，刀身截在最大長度（方向不變）；規則本身仍是 120～420。 */
const clampB = (a: V, p: V): V => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); return d <= MAX_LEN ? p : [a[0] + ((p[0] - a[0]) * MAX_LEN) / d, a[1] + ((p[1] - a[1]) * MAX_LEN) / d]; };
const toWorld = (cx: number, cy: number): V => { const r = els.canvas.getBoundingClientRect(); return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale]; };

// ---------------------------------------------------------------- 音效（合成，不需素材）
const audio = { ctx: null as AudioContext | null, events: [] as string[] };
function ac(): AudioContext | null {
  if (!G.sound) return null;
  try {
    if (!audio.ctx) { const C = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }); const K = C.AudioContext || C.webkitAudioContext; if (!K) return null; audio.ctx = new K(); }
    if (audio.ctx.state === 'suspended') void audio.ctx.resume();
    return audio.ctx;
  } catch { return null; }
}
function noise(c: AudioContext, dur: number, f0: number, f1: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, c.currentTime); f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
  const g = c.createGain(); g.gain.value = gain; src.connect(f); f.connect(g); g.connect(c.destination); src.start();
}
function tone(c: AudioContext, freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function sfx(kind: 'slash' | 'fire' | 'sever' | 'fizzle'): void {
  if (!G.sound) return;
  audio.events.push(kind);
  const c = ac(); if (!c) return;
  try {
    if (kind === 'slash') noise(c, 0.22, 4000, 600, 0.35);
    else if (kind === 'fire') tone(c, 660, 0.12, 0.12, 'triangle');
    else if (kind === 'sever') { noise(c, 0.18, 900, 180, 0.5, 'lowpass'); tone(c, 90, 0.2, 0.25); }
    else tone(c, 180, 0.25, 0.12, 'sawtooth');
  } catch { /* 音訊失敗不影響遊戲 */ }
}
function vibrate(p: number | number[]): void {
  if (G.reduced) return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(p); } catch { /* 略過 */ }
}

// ---------------------------------------------------------------- 演出（雙方刀光同時展開）
interface Anim { rr: RoundResult; before: SimState; t0: number; dur: number; done: () => void; fired: Set<string>; token: number }
const FX = { REVEAL: 260, SLASH: 220, STEP: 120, TAIL: 700 };
const fx = {
  shakeUntil: 0, shake: 0, flashUntil: 0,
  trail: [] as V[],
  events: [] as { type: 'fire' | 'split' | 'fizzle'; side: Side; k: string }[],
  splits: [] as { kind: Kind; side: Side; p: V; n: V; t0: number }[],
  blood: [] as { p: V; v: V; t0: number }[], pops: [] as { p: V; text: string; color: string; t0: number }[],
};
const live = (r: CutResult) => r.hits.filter((h) => h.effect !== 'after');
const T = (ms: number) => ms * G.animScale;
function hitTime(i: number): number { return T(FX.REVEAL + FX.SLASH * 0.6 + FX.STEP * i); }
function animDur(rr: RoundResult): number { const n = Math.max(live(rr.blue.path).length, live(rr.red.path).length, 1); return T(FX.REVEAL + FX.SLASH + FX.STEP * n + FX.TAIL); }
const norm = (v: V): V => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
function triggerHits(a: Anim, now: number): void {
  for (const side of ['blue', 'red'] as Side[]) {
    const o = a.rr[side], hs = live(o.path);
    hs.forEach((h, i) => {
      const id = `${side}#${h.k}#${i}`;
      if (a.fired.has(id) || now - a.t0 < hitTime(i)) return;
      a.fired.add(id);
      if (h.effect === 'fire' && o.cancelled.includes(h.k)) {
        fx.events.push({ type: 'fizzle', side, k: h.k }); sfx('fizzle');
        fx.pops.push({ p: h.p, text: '✕ 未發動', color: '#bbbbbb', t0: now });
      } else if (h.effect === 'fire') {
        fx.events.push({ type: 'fire', side, k: h.k }); sfx('fire');
        fx.pops.push({ p: h.p, text: h.kind === 'heart' ? '×2' : '+2', color: side === 'blue' ? '#8fe3ff' : '#ff9a9a', t0: now });
      } else if (h.effect === 'sever') {
        const n: V = norm([-(o.path.b[1] - o.path.a[1]), o.path.b[0] - o.path.a[0]]);
        fx.splits.push({ kind: h.kind, side: h.side, p: h.p, n, t0: now }); fx.events.push({ type: 'split', side, k: h.k });
        sfx('sever'); vibrate([18, 30, 18]);
        if (!G.reduced) { for (let k = 0; k < 14; k++) { const ang = (k / 14) * Math.PI * 2; fx.blood.push({ p: [h.p[0], h.p[1]], v: [Math.cos(ang) * (80 + (k % 4) * 40), Math.sin(ang) * (80 + (k % 3) * 50) - 60], t0: now }); } fx.shake = 6; fx.shakeUntil = now + 220; }
      }
    });
  }
  const n = Math.max(live(a.rr.blue.path).length, live(a.rr.red.path).length);
  if (now - a.t0 > hitTime(n) && !a.fired.has('dmg')) {
    a.fired.add('dmg');
    if (a.rr.blue.dmg > 0) fx.pops.push({ p: [560, 70], text: `−${a.rr.blue.dmg}`, color: '#ffd27a', t0: now });
    if (a.rr.red.dmg > 0) fx.pops.push({ p: [560, 950], text: `−${a.rr.red.dmg}`, color: '#ffd27a', t0: now });
    if (!G.reduced && a.rr.blue.dmg + a.rr.red.dmg >= 12) fx.flashUntil = now + 120;
  }
}

// ---------------------------------------------------------------- 流程
function newMatch(force?: { seed?: number }): void {
  G.match++; G.token++;
  G.sim = newSim(force?.seed ?? 1000 + G.match);
  G.drag = null; G.preview = null; G.last = null; G.lastBefore = null; G.ghost = false; G.anim = null; G.plan = null; G.planCalls = 0; G.summary = '';
  fx.trail = []; fx.splits = []; fx.blood = []; fx.pops = [];
  G.logs.push({ seed: G.sim.seed, rounds: [], result: null, cancels: 0, lockMs: [] });
  setMsg(`${BOARD_BP.name}｜同時下刀，最多 ${ROUNDS} 回合<div class="hint">${BOARD_BP.purpose}</div>`, '', 2200);
  lockAi();
}
/** AI 鎖刀：只依回合開始的盤面與種子；鎖好之後玩家才可以拖曳。 */
function lockAi(): void {
  G.phase = 'lock'; G.plan = null; refresh();
  const tok = G.token, simAtLock = G.sim;
  setTimeout(() => {
    if (tok !== G.token || G.sim !== simAtLock) return;           // 重開等操作已換局
    const t0 = performance.now();
    const plan = aiPlan(simAtLock); G.planCalls++;
    G.logs[G.logs.length - 1].lockMs.push(Math.round(performance.now() - t0));
    if (tok !== G.token) return;
    G.plan = plan; G.phase = 'player'; refresh();
  }, G.lockDelay);
}
function sideLog(o: RoundResult['blue']): SideLog { return { a: o.path.a, b: o.path.b, pathFired: o.path.fired, fired: o.fired, cancelled: o.cancelled, severed: o.path.severed, dmg: o.dmg }; }
function commit(blue: Line): void {
  if (!G.plan) return;
  const before = G.sim, rr = resolveRound(before, { blue, red: { a: G.plan.cut.a, b: G.plan.cut.b } });
  const ml = G.logs[G.logs.length - 1];
  ml.rounds.push({ n: before.round + 1, blue: sideLog(rr.blue), red: sideLog(rr.red), redSig: G.plan.sig, hpAfter: { ...rr.after.hp } });
  ml.result = rr.after.result;
  G.last = rr; G.lastBefore = before; G.phase = 'reveal'; G.preview = null; G.ghost = false;
  const tok = G.token;
  sfx('slash'); vibrate(12);
  G.anim = { rr, before, t0: performance.now(), dur: animDur(rr), fired: new Set(), token: tok, done: () => {
    if (tok !== G.token) return;
    G.sim = rr.after; G.summary = summaryHtml(rr); G.ghost = true;
    if (rr.after.result) { G.phase = 'end'; refresh(); return; }
    lockAi();
  } };
  refresh(); kick();
}
function setMsg(t: string, cls: string, ms: number): void { G.msg = t; G.msgCls = cls; G.msgUntil = performance.now() + ms; setTimeout(refresh, ms + 30); refresh(); }

// ---------------------------------------------------------------- 輸入
function capture(e: PointerEvent): void { try { els.canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ } }
els.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  if (G.phase !== 'player' || !G.plan || G.drag) return;          // AI 還沒鎖刀、揭曉中或已有一指在拖：忽略
  capture(e); const p = toWorld(e.clientX, e.clientY);
  G.drag = { id: e.pointerId, a: p, b: p, max: 0 }; fx.trail = [p]; G.preview = null; G.ghost = false; kick();
});
els.canvas.addEventListener('pointermove', (e) => {
  if (!G.drag || e.pointerId !== G.drag.id || G.phase !== 'player') return;
  const p = clampB(G.drag.a, toWorld(e.clientX, e.clientY)); G.drag.b = p;
  fx.trail.push(p); if (fx.trail.length > 120) fx.trail.shift();
  const len = Math.hypot(p[0] - G.drag.a[0], p[1] - G.drag.a[1]); G.drag.max = Math.max(G.drag.max, len);
  G.preview = len >= MIN_LEN ? resolveCut(snapshot(G.sim), 'blue', G.drag.a, p, false) : null;   // 預覽＝回合開始盤面上自己的刀路
  kick();
});
function up(e: PointerEvent, cancelled: boolean): void {
  if (!G.drag || e.pointerId !== G.drag.id) return;                          // 只處理起刀的那一指
  if (G.phase !== 'player') { G.drag = null; return; }
  const d = G.drag; G.drag = null; const p = clampB(d.a, toWorld(e.clientX, e.clientY));
  const len = Math.hypot(p[0] - d.a[0], p[1] - d.a[1]);
  G.preview = null;
  if (cancelled || len < MIN_LEN) {
    if (!cancelled && d.max >= MIN_LEN) { G.logs[G.logs.length - 1].cancels++; setMsg('已取消這一刀', 'hint', 1100); } else refresh();
    return;
  }
  const res = resolveCut(snapshot(G.sim), 'blue', d.a, p, false);
  if (!res.legal) { setMsg(`✕ ${res.reason}（沒有出刀）`, 'bad', 1400); return; }
  commit({ a: d.a, b: p });
}
els.canvas.addEventListener('pointerup', (e) => up(e, false));
els.canvas.addEventListener('pointercancel', (e) => up(e, true));
els.canvas.addEventListener('lostpointercapture', (e) => { if (G.drag && e.pointerId === G.drag.id) up(e, true); });   // 捕捉遺失＝取消，不殘留拖曳
els.restart.addEventListener('click', () => newMatch());
els.reduce.addEventListener('click', () => { G.reduced = !G.reduced; try { localStorage.setItem('twinsim-reduced', G.reduced ? '1' : '0'); } catch { /* 略過 */ } refresh(); });
els.sound.addEventListener('click', () => { G.sound = !G.sound; try { localStorage.setItem('twinsim-sound', G.sound ? '1' : '0'); } catch { /* 略過 */ } refresh(); });
els.exportBtn.addEventListener('click', () => { void copyLog(); });
els.exportClose.addEventListener('click', () => { els.exportModal.hidden = true; });
window.addEventListener('resize', () => { layout(); draw(); });
function logText(): string { return JSON.stringify({ format: 'thecut-twinsim-log/1', commit: BUILD_SHA, reduced: G.reduced, matches: G.logs }, null, 1); }
async function copyLog(): Promise<void> { const t = logText(); try { await navigator.clipboard.writeText(t); setMsg('紀錄已複製', 'hint', 1200); } catch { els.exportBox.value = t; els.exportModal.hidden = false; } }

// ---------------------------------------------------------------- 文字
const nm = (k: string) => k.split(':')[1];
function sideLine(rr: RoundResult, side: Side): string {
  const o = rr[side], who = side === 'blue' ? '你' : '他';
  const parts = [`${who}造成 <b>${o.dmg}</b>`];
  if (o.path.severed) parts.push(`切除${side === 'blue' ? '他' : '你'}的${nm(o.path.severed)}`);
  return parts.join('，');
}
function summaryHtml(rr: RoundResult): string {
  const lines = [`<div>第 ${rr.after.round} 回合揭曉：${sideLine(rr, 'blue')}｜${sideLine(rr, 'red')}</div>`];
  const c = [...rr.blue.cancelled.map((k) => cancelText(BOARD_BP, 'blue', k)), ...rr.red.cancelled.map((k) => cancelText(BOARD_BP, 'red', k))];
  if (c.length) lines.push(`<div class="warnline">${c.join('；')}</div>`);
  return lines.join('');
}
function refresh(): void {
  const st = G.anim ? G.anim.before : G.sim;
  els.hpMe.textContent = String(st.hp.blue); els.hpFoe.textContent = String(st.hp.red);
  els.hpMeBar.style.width = `${Math.max(0, st.hp.blue) / 30 * 100}%`; els.hpFoeBar.style.width = `${Math.max(0, st.hp.red) / 30 * 100}%`;
  els.round.textContent = `第 ${Math.min(ROUNDS, G.sim.round + (G.phase === 'end' ? 0 : 1))}/${ROUNDS} 回合`;
  els.reduce.setAttribute('aria-pressed', String(G.reduced)); els.sound.setAttribute('aria-pressed', String(G.sound)); els.sound.textContent = `音效：${G.sound ? '開' : '關'}`;
  const now = performance.now(); let html = '';
  if (G.msg && now < G.msgUntil) html = `<div class="${G.msgCls}">${G.msg}</div>`;
  else if (G.phase === 'end' && G.sim.result) {
    const r = G.sim.result, who = r.winner === 'draw' ? '平手' : r.winner === 'blue' ? '你贏了' : '你輸了';
    const why = r.reason === 'kill' ? '血量歸零' : r.reason === 'mutual' ? '雙方同回合歸零' : `${ROUNDS} 回合打完比血`;
    html = `${G.summary}<div class="${r.winner === 'blue' ? 'good' : r.winner === 'red' ? 'bad' : ''}">${who}（${why}）血 你 ${G.sim.hp.blue}／他 ${G.sim.hp.red}　按「重開」再來一局</div>`;
  } else if (G.phase === 'lock') html = `${G.summary}<div class="hint">他正在暗中出刀…</div>`;
  else if (G.phase === 'reveal') html = '<div>同時揭曉！</div>';
  else html = `${G.summary}<div><b>他已暗中出刀。</b>從<b>你的獸（下方藍）</b>起刀，放開＝出刀；拉回起點＝取消。</div>`;
  els.info.innerHTML = html;
  kick();
}

// ---------------------------------------------------------------- 繪圖
const COL = { blueBody: 'rgba(40,120,150,0.32)', blueEdge: '#58c4dd', redBody: 'rgba(150,40,55,0.32)', redEdge: '#e05a5a', clawFill: '#ecdfc4', heart: '#c8344e' };
function path(ctx: CanvasRenderingContext2D, pts: V[]): void { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.closePath(); }
function drawOrgan(ctx: CanvasRenderingContext2D, kind: Kind, side: Side, p: V, tired: boolean, now: number): void {
  const x = sx(p[0]), y = sy(p[1]), s = scale, edge = side === 'blue' ? COL.blueEdge : COL.redEdge, dir = side === 'blue' ? -1 : 1;
  ctx.lineWidth = 2.5; ctx.strokeStyle = edge;
  if (kind === 'claw') {
    ctx.beginPath(); ctx.moveTo(x - 16 * s, y - 10 * s * dir); ctx.quadraticCurveTo(x - 4 * s, y + 26 * s * dir, x + 4 * s, y + 30 * s * dir);
    ctx.quadraticCurveTo(x + 2 * s, y + 6 * s * dir, x + 16 * s, y - 10 * s * dir); ctx.quadraticCurveTo(x, y - 18 * s * dir, x - 16 * s, y - 10 * s * dir);
    ctx.fillStyle = COL.clawFill; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 6 * s * dir, 10 * s, 0, Math.PI * 2); ctx.fillStyle = side === 'blue' ? '#2c6d80' : '#7d2a35'; ctx.fill(); ctx.stroke();
  } else {
    const k = 1 + (G.reduced || tired ? 0 : Math.sin(now / 260) * 0.05);
    ctx.beginPath(); ctx.moveTo(x, y + 16 * s * k); ctx.bezierCurveTo(x - 28 * s * k, y - 4 * s * k, x - 12 * s * k, y - 26 * s * k, x, y - 10 * s * k);
    ctx.bezierCurveTo(x + 12 * s * k, y - 26 * s * k, x + 28 * s * k, y - 4 * s * k, x, y + 16 * s * k); ctx.fillStyle = COL.heart; ctx.fill(); ctx.stroke();
  }
  if (tired) { ctx.fillStyle = 'rgba(10,12,16,0.62)'; ctx.beginPath(); ctx.arc(x, y, R * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c9c9c9'; ctx.font = `${Math.max(10, 18 * s)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('疲', x, y); }
}
function drawPreview(ctx: CanvasRenderingContext2D, res: CutResult): void {
  const a = res.a, b = res.b, stopT = res.stop ? res.stop.t : 1;
  const m: V = [a[0] + (b[0] - a[0]) * stopT, a[1] + (b[1] - a[1]) * stopT];
  ctx.lineWidth = 4; ctx.strokeStyle = res.legal ? 'rgba(255,255,255,0.9)' : 'rgba(255,110,110,0.9)';
  ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(m[0]), sy(m[1])); ctx.stroke();
  if (stopT < 1) { ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(sx(m[0]), sy(m[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke(); ctx.setLineDash([]); }
  if (res.stop) { const n = norm([-(b[1] - a[1]), b[0] - a[0]]); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx(m[0] - n[0] * 22), sy(m[1] - n[1] * 22)); ctx.lineTo(sx(m[0] + n[0] * 22), sy(m[1] + n[1] * 22)); ctx.stroke(); }
  let order = 0;
  for (const h of res.hits) {
    const x = sx(h.p[0]), y = sy(h.p[1]), r = (R + 6) * scale;
    const style: Record<string, [string, string]> = { fire: ['#58c4dd', `${++order}`], tired: ['#777', '疲'], sever: ['#ff4d5e', '拆'], pass: ['#bbbbbb', '穿'], bone: ['#ffd27a', '擋'], after: ['rgba(255,255,255,0.18)', ''] };
    const [c, t] = style[h.effect];
    ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    if (t) { ctx.fillStyle = c; ctx.font = `bold ${Math.max(11, 20 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + r * 0.9, y - r * 0.9); }
  }
  const lab = res.legal ? `傷害 ${res.dmg}（沒被截才算）${res.severed ? `｜拆 ${nm(res.severed)}` : ''}` : `✕ ${res.reason}`;
  ctx.font = `bold ${Math.max(13, 22 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const tx = Math.min(cw - 110, Math.max(110, sx(b[0]))), ty = Math.max(30, sy(b[1]) - 30 * scale);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText(lab).width + 16; ctx.fillRect(tx - w / 2, ty - 26, w, 28);
  ctx.fillStyle = res.legal ? '#ffffff' : '#ff8a8a'; ctx.fillText(lab, tx, ty);
}
function slash(ctx: CanvasRenderingContext2D, res: CutResult, grow: number, alpha: number, side: Side): void {
  const stopT = res.stop ? res.stop.t : 1, g = grow * stopT;
  const p1: V = [res.a[0] + (res.b[0] - res.a[0]) * g, res.a[1] + (res.b[1] - res.a[1]) * g];
  ctx.globalAlpha = alpha; ctx.lineCap = 'round';
  ctx.strokeStyle = side === 'blue' ? '#bff3ff' : '#ffc2c2'; ctx.lineWidth = 9 * scale + 2; ctx.beginPath(); ctx.moveTo(sx(res.a[0]), sy(res.a[1])); ctx.lineTo(sx(p1[0]), sy(p1[1])); ctx.stroke();
  ctx.strokeStyle = side === 'blue' ? '#ffffff' : '#ffe0e0'; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}
function draw(now = performance.now()): void {
  const ctx = els.canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0E1116'; ctx.fillRect(0, 0, cw, ch);
  if (!G.reduced && now < fx.shakeUntil) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  const a = G.anim, st = a ? a.before : G.sim, b = st.board;
  for (const [side, fill, edge] of [['red', COL.redBody, COL.redEdge], ['blue', COL.blueBody, COL.blueEdge]] as [Side, string, string][]) {
    path(ctx, b.body[side]); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = edge; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `${Math.max(10, 18 * scale)}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('他的獸', sx(14), sy(14)); ctx.textBaseline = 'bottom'; ctx.fillText('你的獸（從這裡起刀）', sx(14), sy(986));
  const splitting = new Set(fx.splits.filter((s) => now - s.t0 < 900).map((s) => `${s.side}:${s.p[0]},${s.p[1]}`));
  for (const side of ['red', 'blue'] as Side[]) for (const o of b.organs[side]) {
    const k = key(side, o.id);
    if (!st.alive.includes(k)) continue;
    if (a) { const by = a.rr.blue.path.severed === k ? 'blue' : a.rr.red.path.severed === k ? 'red' : null; if (by && [...a.fired].some((f) => f.startsWith(`${by}#${k}#`))) continue; }
    if (splitting.has(`${side}:${o.p[0]},${o.p[1]}`)) continue;
    drawOrgan(ctx, o.kind, side, o.p, st.tired[side].includes(o.id), now);
  }
  fx.splits = fx.splits.filter((s) => now - s.t0 < 900);
  for (const s of fx.splits) {
    const t = (now - s.t0) / 900, off = 46 * t * scale, alpha = 1 - t;
    for (const sgn of [1, -1]) {
      ctx.save(); ctx.globalAlpha = alpha;
      const cx = sx(s.p[0]), cy = sy(s.p[1]), nx = s.n[0] * sgn, ny = s.n[1] * sgn;
      ctx.translate(nx * off, ny * off + 30 * t * t * scale); ctx.translate(cx, cy); ctx.rotate(sgn * 0.6 * t); ctx.translate(-cx, -cy);
      ctx.beginPath(); const big = 200; ctx.moveTo(cx - ny * big, cy + nx * big); ctx.lineTo(cx + ny * big, cy - nx * big); ctx.lineTo(cx + ny * big + nx * big, cy - nx * big + ny * big); ctx.lineTo(cx - ny * big + nx * big, cy + nx * big + ny * big); ctx.closePath(); ctx.clip();
      drawOrgan(ctx, s.kind, s.side, s.p, false, now);
      ctx.restore();
    }
  }
  // 上一回合雙方刀線（淡）：玩家開始拖曳就消失
  if (G.ghost && G.last && !a) { slash(ctx, G.last.blue.path, 1, 0.22, 'blue'); slash(ctx, G.last.red.path, 1, 0.22, 'red'); }
  if (G.drag && G.preview && G.phase === 'player') drawPreview(ctx, G.preview);
  else if (G.drag && G.phase === 'player') { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx(G.drag.a[0]), sy(G.drag.a[1])); ctx.lineTo(sx(G.drag.b[0]), sy(G.drag.b[1])); ctx.stroke(); }
  if (a) {
    const e = now - a.t0;
    const grow = Math.max(0, Math.min(1, (e - T(FX.REVEAL)) / T(FX.SLASH)));
    const fade = Math.max(0.25, 1 - Math.max(0, e - (a.dur - T(FX.TAIL))) / T(FX.TAIL));
    if (e < T(FX.REVEAL)) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `bold ${Math.max(18, 40 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('揭曉', cw / 2, sy(500)); }
    slash(ctx, a.rr.red.path, grow, fade, 'red'); slash(ctx, a.rr.blue.path, grow, fade, 'blue');
    triggerHits(a, now);
    if (e >= a.dur) { const d = a.done; G.anim = null; d(); }
  }
  fx.blood = fx.blood.filter((d) => now - d.t0 < 700);
  for (const d of fx.blood) { const t = (now - d.t0) / 1000; ctx.fillStyle = `rgba(170,20,35,${1 - t / 0.7})`; ctx.beginPath(); ctx.arc(sx(d.p[0] + d.v[0] * t), sy(d.p[1] + d.v[1] * t + 400 * t * t), 4, 0, Math.PI * 2); ctx.fill(); }
  fx.pops = fx.pops.filter((p) => now - p.t0 < 1100);
  for (const p of fx.pops) { const t = (now - p.t0) / 1100; ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color; ctx.font = `bold ${Math.max(14, 28 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.text, sx(p.p[0]), sy(p.p[1] - 40 * t)); ctx.globalAlpha = 1; }
  if (fx.trail.length > 1 && G.drag) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); fx.trail.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.stroke(); }
  if (!G.reduced && now < fx.flashUntil) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, cw, ch); }
}
let looping = false;
function kick(): void { if (!looping) { looping = true; requestAnimationFrame(loop); } }
function loop(): void {
  const now = performance.now();
  draw(now);
  const busy = !!G.anim || !!G.drag || fx.splits.length || fx.blood.length || fx.pops.length || now < fx.shakeUntil || (!G.reduced && G.phase === 'player');
  if (busy) requestAnimationFrame(loop); else { looping = false; draw(now); }
}

// ---------------------------------------------------------------- 測試掛勾（唯讀查詢＋操作入口；不改規則）
(window as unknown as { __sim: unknown }).__sim = {
  get sim() { return G.sim; }, get phase() { return G.phase; }, get preview() { return G.preview; }, get animActive() { return !!G.anim; },
  get locked() { return G.plan ? { a: G.plan.cut.a, b: G.plan.cut.b, sig: G.plan.sig } : null; }, get planCalls() { return G.planCalls; }, get dragId() { return G.drag ? G.drag.id : null; },
  get last() { return G.last ? { blue: sideLog(G.last.blue), red: sideLog(G.last.red), after: G.last.after } : null; },
  get log() { return JSON.parse(logText()); }, get infoText() { return els.info.innerText; }, get reduced() { return G.reduced; },
  get fx() { return { events: [...fx.events], audio: [...audio.events] }; },
  toScreen: (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + sx(x), y: r.top + sy(y) }; },
  newMatch: (force?: { seed?: number }) => newMatch(force), setTimings: (o: { lockDelay?: number; animScale?: number }) => { if (o.lockDelay !== undefined) G.lockDelay = o.lockDelay; if (o.animScale !== undefined) G.animScale = o.animScale; },
  clearFx: () => { fx.events = []; audio.events = []; },
};

// ---------------------------------------------------------------- PWA（子路徑獨立 scope）
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' });
  const ownSw = new URL('./sw.js', location.href).href;
  const hadController = navigator.serviceWorker.controller?.scriptURL === ownSw;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
layout();
newMatch();
