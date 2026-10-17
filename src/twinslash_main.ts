// 「一刀雙獸」研究片段（子路徑 twin-slash/）：同一刀穿過兩頭交纏的獸——發動自己的器官、拆對方的器官。可丟棄原型，非正式規則。
// 規則全部在 src/twinslash/rules.ts（預覽、出刀、AI、測試共用）；本檔只負責輸入、演出與紀錄。
import { aiChoose, applyCut, newState, resolveCut, key, FOE, MIN_LEN, MAX_LEN, R, CHARGE_CAP, HURT_PER_CHARGE, CUTS_TOTAL } from './twinslash/rules.ts';
import type { CutResult, Mode, Side, State, V, Kind } from './twinslash/rules.ts';
import { BOARDS, boardById } from './twinslash/boards.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const W = 700, H = 1000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), info: $('info'), sha: $('sha'),
  bd: [$<HTMLButtonElement>('bd1'), $<HTMLButtonElement>('bd2'), $<HTMLButtonElement>('bd3')],
  mA1: $<HTMLButtonElement>('mA1'), mB2: $<HTMLButtonElement>('mB2'),
  hpMe: $('hpMe'), hpFoe: $('hpFoe'), hpMeBar: $('hpMeBar'), hpFoeBar: $('hpFoeBar'),
  sever: $<HTMLButtonElement>('sever'), replay: $<HTMLButtonElement>('replay'), restart: $<HTMLButtonElement>('restart'),
  reduce: $<HTMLButtonElement>('reduce'), sound: $<HTMLButtonElement>('sound'), exportBtn: $<HTMLButtonElement>('exportBtn'),
  exportModal: $('exportModal'), exportBox: $<HTMLTextAreaElement>('exportBox'), exportClose: $<HTMLButtonElement>('exportClose'),
};
els.sha.textContent = BUILD_SHA;

type Phase = 'player' | 'anim' | 'ai' | 'end';
interface CutLog {
  n: number; side: Side; a: V; b: V; useSever: boolean; fired: string[]; dmg: number; severed: string | null; passed: string[];
  stopBy: 'organ' | 'bone' | 'none'; chargesBefore: number; chargesAfter: number; meterBefore: number; meterAfter: number;
  foeChargesAfter: number; foeMeterAfter: number;
}
interface MatchLog { board: string; mode: Mode; first: Side; seed: number; cuts: CutLog[]; result: State['result']; cancels: number }
const G = {
  boardId: 'b1', mode: 'A1' as Mode, match: 0, st: null as unknown as State, phase: 'player' as Phase,
  drag: null as { id: number; a: V; b: V; max: number } | null, preview: null as CutResult | null, toggle: false,
  reduced: false, sound: true, msg: '', msgCls: '', msgUntil: 0, aiDelay: 550,
  last: null as null | { before: State; res: CutResult }, display: null as State | null,
  logs: [] as MatchLog[], anim: null as null | Anim,
};
try { G.reduced = localStorage.getItem('twinslash-reduced') === '1'; G.sound = localStorage.getItem('twinslash-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }

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
function sfx(kind: 'slash' | 'fire' | 'sever' | 'clang'): void {
  if (!G.sound) return;
  audio.events.push(kind);
  const c = ac(); if (!c) return;
  try {
    if (kind === 'slash') noise(c, 0.22, 4000, 600, 0.35);
    else if (kind === 'fire') tone(c, 660, 0.12, 0.12, 'triangle');
    else if (kind === 'sever') { noise(c, 0.18, 900, 180, 0.5, 'lowpass'); tone(c, 90, 0.2, 0.25); }
    else { tone(c, 1240, 0.35, 0.14, 'square'); tone(c, 1870, 0.28, 0.08); noise(c, 0.08, 5000, 3000, 0.2); }
  } catch { /* 音訊失敗不影響遊戲 */ }
}
function vibrate(p: number | number[]): void {
  if (G.reduced) return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(p); fx.vibrations++; } catch { /* 略過 */ }
}

// ---------------------------------------------------------------- 演出
interface Anim { res: CutResult; before: State; t0: number; dur: number; done: () => void; fired: Set<string> }
const FX = { HITSTOP: 70, SLASH: 200, STEP: 110, TAIL: 520 };
const fx = {
  hitstopUntil: 0, hitstopMs: 0, shakeUntil: 0, shake: 0, flashUntil: 0, flashes: 0, vibrations: 0, shakes: 0, bloodSpawned: 0,
  trail: [] as V[], trailFade: 0,
  events: [] as { type: 'fire' | 'split' | 'spark'; k?: string; at: V; t: number }[],
  splits: [] as { kind: Kind; side: Side; p: V; n: V; t0: number }[],
  blood: [] as { p: V; v: V; t0: number }[], sparks: [] as { p: V; t0: number }[], pops: [] as { p: V; text: string; color: string; t0: number }[],
};
function animDur(res: CutResult): number { const n = res.hits.filter((h) => h.effect !== 'after').length; return FX.HITSTOP + FX.SLASH + FX.STEP * Math.max(1, n) + FX.TAIL; }
function hitTime(res: CutResult, i: number): number { return FX.HITSTOP + FX.SLASH * 0.6 + FX.STEP * i; }
function startAnim(before: State, res: CutResult, done: () => void): void {
  const now = performance.now();
  fx.hitstopMs = FX.HITSTOP; fx.hitstopUntil = now + FX.HITSTOP;
  sfx('slash'); vibrate(12);
  G.anim = { res, before, t0: now, dur: animDur(res), done, fired: new Set() };
  kick();
}
function triggerHits(a: Anim, now: number): void {
  const live = a.res.hits.filter((h) => h.effect !== 'after');
  live.forEach((h, i) => {
    const id = `${h.k}#${i}`;
    if (a.fired.has(id) || now - a.t0 < hitTime(a.res, i)) return;
    a.fired.add(id);
    if (h.effect === 'fire') {
      fx.events.push({ type: 'fire', k: h.k, at: h.p, t: now }); sfx('fire');
      fx.pops.push({ p: h.p, text: h.kind === 'heart' ? '×2' : '+2', color: h.side === 'blue' ? '#8fe3ff' : '#ff9a9a', t0: now });
    } else if (h.effect === 'sever') {
      const n: V = norm([-(a.res.b[1] - a.res.a[1]), a.res.b[0] - a.res.a[0]]);
      fx.splits.push({ kind: h.kind, side: h.side, p: h.p, n, t0: now }); fx.events.push({ type: 'split', k: h.k, at: h.p, t: now });
      sfx('sever'); vibrate([18, 30, 18]);
      fx.hitstopMs = Math.max(fx.hitstopMs, 60); fx.hitstopUntil = now + 60;
      if (!G.reduced) { for (let k = 0; k < 16; k++) { const ang = (k / 16) * Math.PI * 2; fx.blood.push({ p: [h.p[0], h.p[1]], v: [Math.cos(ang) * (80 + (k % 4) * 40), Math.sin(ang) * (80 + (k % 3) * 50) - 60], t0: now }); fx.bloodSpawned++; } fx.shake = 7; fx.shakeUntil = now + 240; fx.shakes++; }
    } else if (h.effect === 'bone') {
      fx.sparks.push({ p: a.res.stop!.p, t0: now }); fx.events.push({ type: 'spark', k: h.k, at: a.res.stop!.p, t: now }); sfx('clang'); vibrate(25);
      if (!G.reduced) { fx.shake = 5; fx.shakeUntil = now + 180; fx.shakes++; }
    }
  });
  if (a.res.dmg > 0 && now - a.t0 > hitTime(a.res, live.length) && !a.fired.has('dmg')) {
    a.fired.add('dmg'); const tgt: V = a.res.side === 'blue' ? [560, 70] : [560, 950];
    fx.pops.push({ p: tgt, text: `−${a.res.dmg}`, color: '#ffd27a', t0: now });
    if (!G.reduced && a.res.dmg >= 8) { fx.flashes++; fx.flashUntil = now + 120; }
  }
}
const norm = (v: V): V => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// ---------------------------------------------------------------- 流程
function newMatch(boardId = G.boardId, mode = G.mode, force?: { first?: Side; seed?: number }): void {
  G.boardId = boardId; G.mode = mode; G.match++;
  const first: Side = force?.first ?? (G.match % 2 === 1 ? 'blue' : 'red');
  G.st = newState(boardById(boardId), mode, first, force?.seed ?? 1000 + G.match);
  G.phase = 'player'; G.drag = null; G.preview = null; G.toggle = false; G.last = null; G.display = null; G.anim = null;
  fx.trail = []; fx.splits = []; fx.blood = []; fx.sparks = []; fx.pops = [];
  G.logs.push({ board: boardId, mode, first, seed: G.st.seed, cuts: [], result: null, cancels: 0 });
  setMsg(`${boardById(boardId).name}｜${mode === 'A1' ? 'A1 直接拆' : 'B2 拆刀次數'}｜${first === 'blue' ? '你先手' : '他先手'}<div class="hint">${boardById(boardId).purpose}</div>`, '', 2200);
  if (first === 'red') aiTurn();
}
function logCut(before: State, res: CutResult, after: State): void {
  const side = res.side, foe = FOE[side];
  G.logs[G.logs.length - 1].cuts.push({
    n: before.cuts + 1, side, a: res.a, b: res.b, useSever: res.useSever, fired: res.fired, dmg: res.dmg, severed: res.severed, passed: res.passed,
    stopBy: res.stop ? res.stop.by : 'none', chargesBefore: before.charges[side], chargesAfter: after.charges[side],
    meterBefore: before.meter[side], meterAfter: after.meter[side], foeChargesAfter: after.charges[foe], foeMeterAfter: after.meter[foe],
  });
  G.logs[G.logs.length - 1].result = after.result;
}
function commit(res: CutResult): void {
  const before = G.st, after = applyCut(before, res);
  logCut(before, res, after);
  G.last = { before, res }; G.display = before; G.phase = 'anim'; G.toggle = false; G.preview = null;
  startAnim(before, res, () => {
    G.st = after; G.display = null;
    if (after.result) { G.phase = 'end'; refresh(); return; }
    if (after.turn === 'red') aiTurn(); else { G.phase = 'player'; refresh(); }
  });
  refresh();
}
function aiTurn(): void {
  G.phase = 'ai'; refresh();
  const stAtLock = G.st;
  setTimeout(() => {
    if (G.st !== stAtLock || G.phase !== 'ai') return;              // 重開等操作已換局
    const res = aiChoose(stAtLock);                                 // 只依已結算的盤面（不讀任何玩家輸入）
    fx.trail = [res.a, res.b]; fx.trailFade = 0;
    commit(res);
  }, G.aiDelay);
}
function setMsg(t: string, cls: string, ms: number): void { G.msg = t; G.msgCls = cls; G.msgUntil = performance.now() + ms; setTimeout(refresh, ms + 30); refresh(); }

// ---------------------------------------------------------------- 輸入
function capture(e: PointerEvent): void { try { els.canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ } }
els.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  if (G.phase !== 'player' || G.st.turn !== 'blue' || G.drag) return;      // 已有一指在拖：其他指標一律忽略
  capture(e); const p = toWorld(e.clientX, e.clientY);
  G.drag = { id: e.pointerId, a: p, b: p, max: 0 }; fx.trail = [p]; fx.trailFade = 0; G.preview = null; kick();
});
els.canvas.addEventListener('pointermove', (e) => {
  if (!G.drag || e.pointerId !== G.drag.id || G.phase !== 'player') return;
  const p = clampB(G.drag.a, toWorld(e.clientX, e.clientY)); G.drag.b = p;
  fx.trail.push(p); if (fx.trail.length > 120) fx.trail.shift();
  const len = Math.hypot(p[0] - G.drag.a[0], p[1] - G.drag.a[1]); G.drag.max = Math.max(G.drag.max, len);
  G.preview = len >= MIN_LEN ? resolveCut(G.st, 'blue', G.drag.a, p, G.toggle) : null;
  kick();
});
function up(e: PointerEvent, cancelled: boolean): void {
  if (!G.drag || e.pointerId !== G.drag.id) return;                          // 只處理起刀的那一指
  if (G.phase !== 'player') { G.drag = null; return; }
  const d = G.drag; G.drag = null; const p = clampB(d.a, toWorld(e.clientX, e.clientY));
  const len = Math.hypot(p[0] - d.a[0], p[1] - d.a[1]);
  fx.trailFade = performance.now(); G.preview = null;
  if (cancelled || len < MIN_LEN) {
    if (!cancelled && d.max >= MIN_LEN) { G.logs[G.logs.length - 1].cancels++; setMsg('已取消這一刀', 'hint', 1100); } else refresh();
    return;
  }
  const res = resolveCut(G.st, 'blue', d.a, p, G.toggle);
  if (!res.legal) { setMsg(`✕ ${res.reason}（沒有出刀）`, 'bad', 1400); return; }
  commit(res);
}
els.canvas.addEventListener('pointerup', (e) => up(e, false));
els.canvas.addEventListener('pointercancel', (e) => up(e, true));
els.bd.forEach((b, i) => b.addEventListener('click', () => newMatch(BOARDS[i].id, G.mode)));
els.mA1.addEventListener('click', () => newMatch(G.boardId, 'A1'));
els.mB2.addEventListener('click', () => newMatch(G.boardId, 'B2'));
els.restart.addEventListener('click', () => newMatch());
els.sever.addEventListener('click', () => { if (G.st.mode === 'B2' && G.st.charges.blue > 0 && G.phase === 'player') { G.toggle = !G.toggle; if (G.drag) { const len = Math.hypot(G.drag.b[0] - G.drag.a[0], G.drag.b[1] - G.drag.a[1]); G.preview = len >= MIN_LEN ? resolveCut(G.st, 'blue', G.drag.a, G.drag.b, G.toggle) : null; } refresh(); } });   // 拖曳中切換：用同一組刀路重算預覽
els.replay.addEventListener('click', () => {
  if (!G.last || G.phase === 'anim' || G.phase === 'ai') return;
  const keep = G.phase; const cur = G.st; G.display = G.last.before; G.phase = 'anim';
  fx.trail = []; startAnim(G.last.before, G.last.res, () => { G.display = null; G.st = cur; G.phase = keep; refresh(); });
  refresh();
});
els.reduce.addEventListener('click', () => { G.reduced = !G.reduced; try { localStorage.setItem('twinslash-reduced', G.reduced ? '1' : '0'); } catch { /* 略過 */ } refresh(); });
els.sound.addEventListener('click', () => { G.sound = !G.sound; try { localStorage.setItem('twinslash-sound', G.sound ? '1' : '0'); } catch { /* 略過 */ } refresh(); });
els.exportBtn.addEventListener('click', () => { void copyLog(); });
els.exportClose.addEventListener('click', () => { els.exportModal.hidden = true; });
window.addEventListener('resize', () => { layout(); draw(); });
function logText(): string { return JSON.stringify({ format: 'thecut-twinslash-log/1', commit: BUILD_SHA, reduced: G.reduced, matches: G.logs }, null, 1); }
async function copyLog(): Promise<void> { const t = logText(); try { await navigator.clipboard.writeText(t); setMsg('紀錄已複製', 'hint', 1200); } catch { els.exportBox.value = t; els.exportModal.hidden = false; } }

// ---------------------------------------------------------------- 文字
const name = (k: string) => k.split(':')[1];
function refresh(): void {
  const st = G.display ?? G.st;
  els.bd.forEach((b, i) => b.setAttribute('aria-pressed', String(BOARDS[i].id === G.boardId)));
  els.mA1.setAttribute('aria-pressed', String(G.mode === 'A1')); els.mB2.setAttribute('aria-pressed', String(G.mode === 'B2'));
  els.hpMe.textContent = String(st.hp.blue); els.hpFoe.textContent = String(st.hp.red);
  els.hpMeBar.style.width = `${Math.max(0, st.hp.blue) / 30 * 100}%`; els.hpFoeBar.style.width = `${Math.max(0, st.hp.red) / 30 * 100}%`;
  const b2 = G.st.mode === 'B2';
  els.sever.hidden = !b2;
  els.sever.disabled = !(b2 && G.st.charges.blue > 0 && G.phase === 'player');
  els.sever.setAttribute('aria-pressed', String(G.toggle));
  els.sever.textContent = b2 ? `拆刀 ${'●'.repeat(G.st.charges.blue)}${'○'.repeat(CHARGE_CAP - G.st.charges.blue)} ${G.st.meter.blue}/${HURT_PER_CHARGE}${G.toggle ? ' 開' : ''}` : '拆刀';
  els.reduce.setAttribute('aria-pressed', String(G.reduced)); els.sound.setAttribute('aria-pressed', String(G.sound)); els.sound.textContent = `音效：${G.sound ? '開' : '關'}`;
  const now = performance.now(); let html = '';
  const board = boardById(G.boardId);
  if (G.msg && now < G.msgUntil) html = `<div class="${G.msgCls}">${G.msg}</div>`;
  else if (G.phase === 'end' && G.st.result) {
    const r = G.st.result, who = r.winner === 'draw' ? '平手' : r.winner === 'blue' ? '你贏了' : '你輸了';
    html = `<div class="${r.winner === 'blue' ? 'good' : r.winner === 'red' ? 'bad' : ''}">${who}（${r.reason === 'kill' ? '一刀致命' : `${CUTS_TOTAL} 刀用完比血`}）血 你 ${G.st.hp.blue}／他 ${G.st.hp.red}</div><div class="hint">按「重開」再來一局（先後手會交換）。</div>`;
  } else if (G.phase === 'ai') html = '<div>他正在出刀…</div>';
  else if (G.phase === 'anim') html = '<div>　</div>';
  else html = `<div>${board.name}｜第 ${G.st.cuts + 1}/${CUTS_TOTAL} 刀｜${G.st.first === 'blue' ? '你先手' : '他先手'}</div><div class="hint">從<b>你的獸（下方藍）</b>身上起刀劃過去，放開出刀；拉回起點＝取消。${G.mode === 'B2' ? '沒開拆刀時，刀會穿過他的器官。' : '刀砍進他的第一個器官就卡住。'}</div>`;
  els.info.innerHTML = html;
  kick();
}

// ---------------------------------------------------------------- 繪圖
const COL = { blueBody: 'rgba(40,120,150,0.42)', blueEdge: '#58c4dd', redBody: 'rgba(150,40,55,0.42)', redEdge: '#e05a5a', boneFill: '#d8d0bf', clawFill: '#ecdfc4', heart: '#c8344e' };
function path(ctx: CanvasRenderingContext2D, pts: V[]): void { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.closePath(); }
function drawOrgan(ctx: CanvasRenderingContext2D, kind: Kind, side: Side, p: V, tired: boolean, boneHp: number, now: number): void {
  const x = sx(p[0]), y = sy(p[1]), s = scale, edge = side === 'blue' ? COL.blueEdge : COL.redEdge, dir = side === 'blue' ? -1 : 1;
  ctx.lineWidth = 2.5; ctx.strokeStyle = edge;
  if (kind === 'claw') {
    ctx.beginPath(); ctx.moveTo(x - 16 * s, y + 10 * s * dir * -1 + 0); ctx.quadraticCurveTo(x - 4 * s, y + 26 * s * dir, x + 4 * s, y + 30 * s * dir);
    ctx.quadraticCurveTo(x + 2 * s, y + 6 * s * dir, x + 16 * s, y - 10 * s * dir); ctx.quadraticCurveTo(x, y - 18 * s * dir, x - 16 * s, y + 10 * s * dir * -1);
    ctx.fillStyle = COL.clawFill; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 6 * s * dir, 10 * s, 0, Math.PI * 2); ctx.fillStyle = side === 'blue' ? '#2c6d80' : '#7d2a35'; ctx.fill(); ctx.stroke();
  } else if (kind === 'heart') {
    const k = 1 + (G.reduced || tired ? 0 : Math.sin(now / 260) * 0.05), r = 13 * s * k;
    ctx.beginPath(); ctx.moveTo(x, y + 16 * s * k); ctx.bezierCurveTo(x - 28 * s * k, y - 4 * s * k, x - 12 * s * k, y - 26 * s * k, x, y - 10 * s * k);
    ctx.bezierCurveTo(x + 12 * s * k, y - 26 * s * k, x + 28 * s * k, y - 4 * s * k, x, y + 16 * s * k); ctx.fillStyle = COL.heart; ctx.fill(); ctx.stroke();
    void r;
  } else {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35);
    ctx.beginPath(); const w = 34 * s, h = 9 * s; ctx.moveTo(-w, -h); ctx.lineTo(w, -h); ctx.arc(w, 0, h, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-w, h); ctx.arc(-w, 0, h, Math.PI / 2, Math.PI * 1.5);
    ctx.fillStyle = COL.boneFill; ctx.fill(); ctx.strokeStyle = '#8f877a'; ctx.stroke();
    if (boneHp < 2) { ctx.strokeStyle = '#3b3530'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-4 * s, -h); ctx.lineTo(3 * s, 0); ctx.lineTo(-2 * s, h); ctx.stroke(); }
    ctx.restore();
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
    ctx.strokeStyle = c; ctx.lineWidth = 3; if (h.effect === 'pass') ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (t) { ctx.fillStyle = c; ctx.font = `bold ${Math.max(11, 20 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + r * 0.9, y - r * 0.9); }
  }
  const lab = res.legal ? `傷害 ${res.dmg}${res.severed ? `｜拆 ${name(res.severed)}` : ''}${res.spend ? '｜扣拆刀 1' : ''}${res.passed.length ? `｜穿過 ${res.passed.length}` : ''}` : `✕ ${res.reason}`;
  ctx.font = `bold ${Math.max(13, 24 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const tx = Math.min(cw - 90, Math.max(90, sx(b[0]))), ty = Math.max(30, sy(b[1]) - 30 * scale);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText(lab).width + 16; ctx.fillRect(tx - w / 2, ty - 26, w, 28);
  ctx.fillStyle = res.legal ? '#ffffff' : '#ff8a8a'; ctx.fillText(lab, tx, ty);
}
function draw(now = performance.now()): void {
  const ctx = els.canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0E1116'; ctx.fillRect(0, 0, cw, ch);
  if (!G.reduced && now < fx.shakeUntil) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  const st = G.display ?? G.st, b = st.board;
  // 兩頭獸（紅在上、藍在下，局部交纏）
  for (const [side, fill, edge] of [['red', COL.redBody, COL.redEdge], ['blue', COL.blueBody, COL.blueEdge]] as [Side, string, string][]) {
    path(ctx, b.body[side]); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = edge; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `${Math.max(10, 18 * scale)}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('他的獸', sx(b.body.red[4][0]), sy(b.body.red[4][1]) + 6); ctx.textBaseline = 'bottom'; ctx.fillText('你的獸（從這裡起刀）', sx(b.body.blue[4][0]), sy(b.body.blue[4][1]) - 6);
  // 動畫期間：已被切除的器官改由「分離」畫出
  const a = G.anim, splitting = new Set(fx.splits.filter((s) => now - s.t0 < 900).map((s) => `${s.side}:${s.p[0]},${s.p[1]}`));
  for (const side of ['red', 'blue'] as Side[]) for (const o of b.organs[side]) {
    const k = key(side, o.id);
    if (!st.alive.includes(k)) continue;
    if (a && a.res.severed === k && a.fired.has(`${k}#${a.res.hits.filter((h) => h.effect !== 'after').findIndex((h) => h.k === k)}`)) continue;
    if (splitting.has(`${side}:${o.p[0]},${o.p[1]}`)) continue;
    drawOrgan(ctx, o.kind, side, o.p, st.tired[side].includes(o.id), st.boneHp[k] ?? 2, now);
  }
  // 切除分離：器官沿刀線分成兩半往兩側飛開
  fx.splits = fx.splits.filter((s) => now - s.t0 < 900);
  for (const s of fx.splits) {
    const t = (now - s.t0) / 900, off = 46 * t * scale, alpha = 1 - t;
    for (const sgn of [1, -1]) {
      ctx.save(); ctx.globalAlpha = alpha;
      const cx = sx(s.p[0]), cy = sy(s.p[1]), nx = s.n[0] * sgn, ny = s.n[1] * sgn;
      ctx.translate(nx * off, ny * off + 30 * t * t * scale); ctx.translate(cx, cy); ctx.rotate(sgn * 0.6 * t); ctx.translate(-cx, -cy);
      ctx.beginPath(); const big = 200; ctx.moveTo(cx - ny * big, cy + nx * big); ctx.lineTo(cx + ny * big, cy - nx * big); ctx.lineTo(cx + ny * big + nx * big, cy - nx * big + ny * big); ctx.lineTo(cx - ny * big + nx * big, cy + nx * big + ny * big); ctx.closePath(); ctx.clip();
      drawOrgan(ctx, s.kind, s.side, s.p, false, 2, now);
      ctx.strokeStyle = G.reduced ? '#bbb' : '#ff5a6a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - ny * 30 * scale, cy + nx * 30 * scale); ctx.lineTo(cx + ny * 30 * scale, cy - nx * 30 * scale); ctx.stroke();
      ctx.restore();
    }
  }
  // 拖曳預覽
  if (G.drag && G.preview && G.phase === 'player') drawPreview(ctx, G.preview);
  else if (G.drag && G.phase === 'player') { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx(G.drag.a[0]), sy(G.drag.a[1])); ctx.lineTo(sx(G.drag.b[0]), sy(G.drag.b[1])); ctx.stroke(); }
  // 出刀刀光
  if (a) {
    const e = now - a.t0, res = a.res, stopT = res.stop ? res.stop.t : 1;
    const grow = Math.max(0, Math.min(1, (e - FX.HITSTOP) / FX.SLASH)) * stopT;
    const p0 = res.a, p1: V = [res.a[0] + (res.b[0] - res.a[0]) * grow, res.a[1] + (res.b[1] - res.a[1]) * grow];
    const fade = Math.max(0, 1 - Math.max(0, e - (a.dur - FX.TAIL)) / FX.TAIL);
    ctx.globalAlpha = fade; ctx.lineCap = 'round';
    ctx.strokeStyle = res.side === 'blue' ? '#bff3ff' : '#ffc2c2'; ctx.lineWidth = 9 * scale + 2; ctx.beginPath(); ctx.moveTo(sx(p0[0]), sy(p0[1])); ctx.lineTo(sx(p1[0]), sy(p1[1])); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    if (now >= fx.hitstopUntil) triggerHits(a, now);
    if (e >= a.dur) { const d = a.done; G.anim = null; d(); }
  }
  // 火花、血、跳字
  fx.sparks = fx.sparks.filter((s) => now - s.t0 < 450);
  for (const s of fx.sparks) { const t = (now - s.t0) / 450; for (let i = 0; i < 10; i++) { const ang = i * 0.63; ctx.fillStyle = `rgba(255,220,120,${1 - t})`; ctx.beginPath(); ctx.arc(sx(s.p[0] + Math.cos(ang) * 50 * t), sy(s.p[1] + Math.sin(ang) * 50 * t), 3, 0, Math.PI * 2); ctx.fill(); } }
  fx.blood = fx.blood.filter((d) => now - d.t0 < 700);
  for (const d of fx.blood) { const t = (now - d.t0) / 1000; ctx.fillStyle = `rgba(170,20,35,${1 - t / 0.7})`; ctx.beginPath(); ctx.arc(sx(d.p[0] + d.v[0] * t), sy(d.p[1] + d.v[1] * t + 400 * t * t), 4, 0, Math.PI * 2); ctx.fill(); }
  fx.pops = fx.pops.filter((p) => now - p.t0 < 900);
  for (const p of fx.pops) { const t = (now - p.t0) / 900; ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color; ctx.font = `bold ${Math.max(14, 30 * scale)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.text, sx(p.p[0]), sy(p.p[1] - 40 * t)); ctx.globalAlpha = 1; }
  // 拖曳刀痕
  if (fx.trail.length > 1 && G.drag) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); fx.trail.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.stroke(); }
  if (!G.reduced && now < fx.flashUntil) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, cw, ch); }
}
let looping = false;
function kick(): void { if (!looping) { looping = true; requestAnimationFrame(loop); } }
function loop(): void {
  const now = performance.now();
  if (now >= fx.hitstopUntil) draw(now);
  const busy = !!G.anim || !!G.drag || fx.splits.length || fx.blood.length || fx.sparks.length || fx.pops.length || now < fx.hitstopUntil || now < fx.shakeUntil || (!G.reduced && G.phase === 'player');
  if (busy) requestAnimationFrame(loop); else { looping = false; draw(now); }
}

// ---------------------------------------------------------------- 測試掛勾（唯讀查詢＋操作入口；不改規則）
(window as unknown as { __twin: unknown }).__twin = {
  get st() { return G.st; }, get phase() { return G.phase; }, get preview() { return G.preview; }, get toggle() { return G.toggle; }, get last() { return G.last?.res ?? null; },
  get log() { return JSON.parse(logText()); }, get reduced() { return G.reduced; }, get animActive() { return !!G.anim; }, get sound() { return G.sound; },
  get fx() { const now = performance.now(); return { hitstopMs: fx.hitstopMs, hitstopActive: now < fx.hitstopUntil, shakeActive: now < fx.shakeUntil, flashes: fx.flashes, vibrations: fx.vibrations, blood: fx.blood.length, bloodSpawned: fx.bloodSpawned, shakes: fx.shakes, events: fx.events.map((e) => ({ type: e.type, k: e.k, at: e.at })), audio: [...audio.events] }; },
  toScreen: (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + sx(x), y: r.top + sy(y) }; },
  newMatch: (boardId: string, mode: Mode, force?: { first?: Side; seed?: number }) => newMatch(boardId, mode, force), setAiDelay: (ms: number) => { G.aiDelay = ms; }, clearFx: () => { fx.events = []; audio.events = []; },
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
newMatch('b1', 'A1');
