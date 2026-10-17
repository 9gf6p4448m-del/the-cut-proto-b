// 刀譜（Blade Hand）手機可玩草圖（子路徑 blade/）。可丟棄原型，非正式規則。
// 規則全部在 src/blade/rules.ts；本檔只負責輸入、預覽、演出（慢動作／爆開／跳數字／音效）與流程畫面。
// 預覽與結算都呼叫同一個 evaluate()／applyCut()，所以預覽＝結算（BH-06）。
import {
  applyCut, chooseStitch, evaluate, newRun, twitch, KIND_NAME, STITCHES, TUNE, BODY_Y, SLOT_P, MONSTER_C, MONSTER_RX, MONSTER_RY, W, H, maxLen,
} from './blade/rules.ts';
import type { CutRecord, Kind, Organ, Path, RunState, Score, StitchId, V } from './blade/rules.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), sha: $('sha'), mon: $('mon'), goal: $('goal'), goalBar: $('goalBar'), cuts: $('cuts'), total: $('total'), preview: $('preview'),
  twitch: $<HTMLButtonElement>('twitch'), sound: $<HTMLButtonElement>('sound'), restart: $<HTMLButtonElement>('restart'),
  stitchModal: $('stitchModal'), stitchTitle: $('stitchTitle'), stitchOpts: $('stitchOpts'), slotHint: $('slotHint'), slotOpts: $('slotOpts'),
  endModal: $('endModal'), endTitle: $('endTitle'), endBody: $('endBody'), again: $<HTMLButtonElement>('again'),
};
els.sha.textContent = BUILD_SHA;

// ---------------------------------------------------------------- 試玩數值（演出；可調，調過記錄在作者證據）
export const FEEL = {
  SWEEP: 230,        // 刀光從起點掃到終點（ms，不含慢動作）
  SLOWMO: 120,       // 接觸器官的慢動作（ms）
  SLOWMO_RATE: 0.12, // 慢動作期間刀光前進速率
  PARTICLES: 26,
  TALLY_STEP: 280,   // 刀譜逐項跳出的間隔
  FINAL_HOLD: 900,   // 「×」結算大數字停留
  COUNTER: 650,      // 反擊演出
  SHAKE: 9,
};
const COLOR: Record<Kind, string> = { claw: '#ff6b5a', heart: '#ff3d7f', eye: '#ffd166', poison: '#7CFF6B', bone: '#e8e1d0' };

interface Particle { p: V; v: V; c: string; t0: number; life: number; r: number }
interface Pop { p: V; text: string; color: string; t0: number; size: number; life: number; tally?: boolean }
interface Anim {
  token: number; rec: CutRecord; before: Organ[]; after: RunState; t0: number;
  hitAt: { id: number; f: number; t: number; kind: Kind; p: V; chip: number }[]; boneOnly: { id: number; p: V } | null;
  stopF: number; sweepEnd: number; tally: { at: number; text: string; color: string }[]; finalAt: number; counterAt: number; doneAt: number; fired: Set<string>;
}
const G = {
  run: null as unknown as RunState, token: 0, animScale: 1,
  phase: 'aim' as 'aim' | 'anim' | 'stitch' | 'end',
  drag: null as { id: number; a: V; b: V } | null,
  preview: null as null | { a: V; b: V; ok: boolean; seqIds: number[]; seq: Kind[]; patterns: string[]; chips: number; mult: number; score: number; saves: boolean },
  last: null as CutRecord | null, anim: null as Anim | null, sound: true, pick: null as StitchId | null,
  particles: [] as Particle[], pops: [] as Pop[], shakeUntil: 0, shake: 0, flashUntil: 0, bigText: null as null | { text: string; sub: string; t0: number; life: number },
  log: [] as { seed: number; cuts: CutRecord[]; result: string }[],
};
try { G.sound = localStorage.getItem('blade-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }

// ---------------------------------------------------------------- 版面與座標
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
  els.canvas.width = Math.round(cw * dpr); els.canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / W, ch / H); ox = (cw - W * scale) / 2; oy = (ch - H * scale) * 0.3;   // 多出的高度大多留在下方，怪物靠近上緣
}
const toWorld = (cx: number, cy: number): V => { const r = els.canvas.getBoundingClientRect(); return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale]; };
const toScreen = (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + ox + x * scale, y: r.top + oy + y * scale }; };
const T = (ms: number) => ms * G.animScale;

// ---------------------------------------------------------------- 音效（WebAudio 合成）
const audio = { ctx: null as AudioContext | null, events: [] as string[] };
function ac(): AudioContext | null {
  if (!G.sound) return null;
  try {
    if (!audio.ctx) { const C = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; const K = C.AudioContext || C.webkitAudioContext; if (!K) return null; audio.ctx = new K(); }
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
function tone(c: AudioContext, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 1): void {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, c.currentTime); o.frequency.exponentialRampToValueAtTime(freq * slide, c.currentTime + dur);
  g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function sfx(kind: 'slash' | 'burst' | 'bone' | 'tick' | 'final' | 'hurt' | 'save' | 'clear', i = 0): void {
  if (!G.sound) return;
  audio.events.push(kind);
  const c = ac(); if (!c) return;
  try {
    if (kind === 'slash') noise(c, 0.2, 5200, 700, 0.32);
    else if (kind === 'burst') { noise(c, 0.16, 1400, 200, 0.45, 'lowpass'); tone(c, 220 * Math.pow(1.122, i), 0.14, 0.18, 'triangle', 1.5); }
    else if (kind === 'bone') { tone(c, 1800, 0.12, 0.12, 'square', 0.7); tone(c, 2600, 0.08, 0.08, 'sine'); }
    else if (kind === 'tick') tone(c, 520 * Math.pow(1.122, i), 0.09, 0.12, 'triangle', 1.2);
    else if (kind === 'final') { tone(c, 110, 0.5, 0.35, 'sawtooth', 0.5); noise(c, 0.35, 900, 120, 0.5, 'lowpass'); tone(c, 880, 0.35, 0.12, 'triangle', 1.5); }
    else if (kind === 'hurt') { tone(c, 140, 0.3, 0.3, 'sawtooth', 0.6); noise(c, 0.2, 600, 120, 0.4, 'lowpass'); }
    else if (kind === 'save') { tone(c, 660, 0.12, 0.15, 'triangle', 1.5); tone(c, 990, 0.18, 0.1, 'sine'); }
    else { for (let k = 0; k < 4; k++) tone(c, 330 * Math.pow(1.26, k), 0.3 + k * 0.05, 0.12, 'triangle'); }
  } catch { /* 音訊失敗不影響遊戲 */ }
}
function vibrate(p: number | number[]): void {
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(p); } catch { /* 略過 */ }
}

// ---------------------------------------------------------------- 預覽（與結算同一函式）
function makePreview(a: V, b: V): NonNullable<typeof G.preview> {
  const e = evaluate(G.run, a, b);
  const sc: Score = e.score;
  return {
    a: e.path.a, b: e.path.b, ok: e.path.ok, seqIds: e.path.severed.slice(), seq: sc.seq.slice(),
    patterns: sc.patterns.map((p) => p.label + (p.add ? ` +${p.add}` : '') + (p.mul ? ` ×${p.mul}` : '')),
    chips: sc.chips, mult: sc.mult, score: sc.score, saves: !!G.run.counter && e.path.severed.includes(G.run.counter.clawId),
  };
}
function previewHtml(p: NonNullable<typeof G.preview> | null, path?: Path): string {
  if (!p) return `<span class="hint">拖一條直線、放開出刀。刀譜：連斬／雙對／對稱／五色。斬斷發光的預告爪可取消反擊。</span>`;
  if (!p.ok) return `<span class="warnc">刀太短（至少 ${TUNE.MIN_LEN}）</span>`;
  const seq = p.seq.length ? p.seq.map((k) => KIND_NAME[k]).join(' ') : '（揮空）';
  const stop = path && path.boneHits.length && !path.boneHits[0].broke ? ' <span class="warnc">骨擋刀</span>' : '';
  return `<span class="seq">${seq}</span>${stop}　<span class="pat">${p.patterns.join('｜') || '無刀譜'}</span><br>`
    + `<span class="sc">${p.chips} × ${p.mult} = ${p.score}</span>　${G.run.counter ? (p.saves ? '<span class="save">斬斷預告爪：取消反擊</span>' : '<span class="warnc">反擊會打中</span>') : ''}`;
}

// ---------------------------------------------------------------- 流程
function newGame(force?: { seed?: number }): void {
  G.token++;
  G.run = newRun(force?.seed ?? ((Math.random() * 1e9) >>> 0) + 1);
  G.phase = 'aim'; G.drag = null; G.preview = null; G.last = null; G.anim = null; G.pick = null;
  G.particles = []; G.pops = []; G.bigText = { text: '第 1 隻', sub: `門檻 ${G.run.threshold}`, t0: performance.now(), life: T(1100) };
  G.log.push({ seed: G.run.seed, cuts: [], result: '' });
  els.stitchModal.hidden = true; els.endModal.hidden = true;
  hud();
}
function hud(): void {
  const s = G.run;
  els.mon.textContent = `${s.monster + 1}/${TUNE.THRESHOLDS.length}`;
  els.goal.textContent = `${s.monsterScore}/${s.threshold}`;
  els.goalBar.style.width = `${Math.min(100, (100 * s.monsterScore) / s.threshold)}%`;
  els.cuts.textContent = `${s.cutsLeft}/${s.cutsMax}`;
  els.total.textContent = String(s.totalScore);
  els.twitch.textContent = `抽搐（剩 ${s.twitchesLeft}）`;
  els.twitch.disabled = G.phase !== 'aim' || s.twitchesLeft <= 0;
  els.sound.textContent = `音效：${G.sound ? '開' : '關'}`; els.sound.setAttribute('aria-pressed', String(G.sound));
  if (G.phase === 'aim' && !G.drag) els.preview.innerHTML = previewHtml(null);
}
function release(a: V, b: V): void {
  const pv = makePreview(a, b);
  if (!pv.ok) { els.preview.innerHTML = previewHtml(pv); G.preview = null; return; }
  const before = G.run.organs, prevState = G.run;
  const r = applyCut(G.run, a, b);
  if (!r.record) return;
  G.last = r.record; G.log[G.log.length - 1].cuts.push(r.record);
  G.run = r.state; G.preview = pv;
  startAnim(r.record, before, prevState, r.state);
}
function startAnim(rec: CutRecord, before: Organ[], prev: RunState, after: RunState): void {
  G.phase = 'anim';
  const now = performance.now(), byId = new Map(before.map((o) => [o.id, o]));
  const path = evaluate(prev, rec.a, rec.b).path;
  const len = Math.hypot(rec.b[0] - rec.a[0], rec.b[1] - rec.a[1]) || 1;
  const touch = new Map(path.touched.map((t) => [t.id, t.d]));
  const hitAt = rec.severed.map((s, i) => {
    const f = Math.min(1, (touch.get(s.id) ?? 0) / len);
    return { id: s.id, f, t: T(FEEL.SWEEP * f + FEEL.SLOWMO * i), kind: s.kind, p: byId.get(s.id)!.p, chip: rec.score.chipsList[i] };
  });
  const bh = path.boneHits.find((h) => !h.broke);
  const boneOnly = bh ? { id: bh.id, p: byId.get(bh.id)!.p } : null;
  const stopF = path.stoppedAt !== null ? Math.min(1, (touch.get(path.stoppedAt) ?? len) / len) : 1;
  const sweepEnd = T(FEEL.SWEEP * stopF + FEEL.SLOWMO * hitAt.length) + T(80);
  const tally: Anim['tally'] = [];
  let at = sweepEnd + T(120);
  tally.push({ at, text: `籌碼 ${rec.score.chips}`, color: '#8fe3ff' }); at += T(FEEL.TALLY_STEP);
  for (const p of rec.score.patterns) { tally.push({ at, text: p.label + (p.add ? `  +${p.add}` : '') + (p.mul ? `  ×${p.mul}` : ''), color: p.mul ? '#ff7adf' : '#ffd166' }); at += T(FEEL.TALLY_STEP); }
  const finalAt = at + T(60);
  const counterAt = finalAt + T(FEEL.FINAL_HOLD * 0.6);
  const doneAt = counterAt + (rec.counterResult === 'none' || rec.counterResult === 'killed' ? T(150) : T(FEEL.COUNTER));
  G.anim = { token: G.token, rec, before, after, t0: now, hitAt, boneOnly, stopF, sweepEnd, tally, finalAt, counterAt, doneAt, fired: new Set() };
  sfx('slash'); vibrate(12);
  hud();
}
function burst(p: V, c: string, n: number, now: number, speed = 1): void {
  for (let k = 0; k < n; k++) {
    const ang = Math.random() * Math.PI * 2, sp = (120 + Math.random() * 260) * speed;
    G.particles.push({ p: [p[0], p[1]], v: [Math.cos(ang) * sp, Math.sin(ang) * sp - 80], c, t0: now, life: 500 + Math.random() * 450, r: 2 + Math.random() * 4 });
  }
}
function pop(p: V, text: string, color: string, now: number, size = 22, life = 900, tally = false): void { G.pops.push({ p: [p[0], p[1]], text, color, t0: now, size, life, tally }); }
function stepAnim(now: number): void {
  const a = G.anim; if (!a) return;
  if (a.token !== G.token) { G.anim = null; return; }
  const t = now - a.t0;
  a.hitAt.forEach((h, i) => {
    const id = `hit${i}`; if (a.fired.has(id) || t < h.t) return; a.fired.add(id);
    burst(h.p, COLOR[h.kind], FEEL.PARTICLES, now); pop([h.p[0], h.p[1] - 30], `+${h.chip}`, COLOR[h.kind], now, 24);
    sfx('burst', i); vibrate([10, 20, 10]); G.shake = FEEL.SHAKE; G.shakeUntil = now + 160;
    if (a.rec.counter && h.id === a.rec.counter.clawId && a.rec.counterResult !== 'killed') { pop([h.p[0], h.p[1] - 62], '反擊取消', '#7CFF6B', now, 20, 1200); sfx('save'); }
  });
  if (a.boneOnly && !a.fired.has('bone') && t >= a.sweepEnd - T(80)) { a.fired.add('bone'); burst(a.boneOnly.p, '#fff3c4', 12, now, 0.5); pop([a.boneOnly.p[0], a.boneOnly.p[1] - 30], '骨 −1 擋刀', '#e8e1d0', now, 18); sfx('bone'); }
  a.tally.forEach((x, i) => {
    const id = `tally${i}`; if (a.fired.has(id) || t < x.at) return; a.fired.add(id);
    pop([350, 300 + i * 40], x.text, x.color, now, i === 0 ? 26 : 30, Math.max(400, a.finalAt - x.at + T(FEEL.FINAL_HOLD * 0.5)), true); sfx('tick', i);
  });
  if (!a.fired.has('final') && t >= a.finalAt) {
    a.fired.add('final'); sfx('final'); vibrate([30, 40, 60]);
    G.bigText = { text: String(a.rec.score.score), sub: `${a.rec.score.chips} × ${a.rec.score.mult}`, t0: now, life: T(FEEL.FINAL_HOLD) + 200 };
    G.shake = FEEL.SHAKE * 1.6; G.shakeUntil = now + 260; G.flashUntil = now + 110;
    hud();
  }
  if (!a.fired.has('counter') && t >= a.counterAt) {
    a.fired.add('counter');
    const r = a.rec.counterResult, slotP = a.rec.counter ? SLOT_P[a.rec.counter.slot] : null;
    if (slotP && (r === 'slotLost' || r === 'cutLost' || r === 'twitchLost')) {
      sfx('hurt'); vibrate([60, 40, 60]); G.shake = FEEL.SHAKE * 1.3; G.shakeUntil = now + 300; burst(slotP, '#ff3b3b', 30, now);
      pop([slotP[0], slotP[1] - 50], r === 'slotLost' ? `${STITCHES[a.rec.lostStitch!].name} 被打掉` : r === 'cutLost' ? '空槽被打中：下一隻少 1 刀' : '逆鱗：失去 1 次抽搐', '#ff7a7a', now, 20, 1400);
    }
  }
  if (t >= a.doneAt) finishAnim(a, now);
}
function finishAnim(a: Anim, now: number): void {
  G.anim = null;
  const s = G.run;
  if (s.phase === 'stitch') {
    burst([MONSTER_C[0], MONSTER_C[1]], '#ff3d7f', 80, now, 1.6); sfx('clear');
    G.bigText = { text: '擊倒！', sub: `${a.rec.total} 分`, t0: now, life: T(900) };
    G.phase = 'stitch'; showStitch();
  } else if (s.phase === 'won' || s.phase === 'lost') {
    if (s.phase === 'won') { burst([MONSTER_C[0], MONSTER_C[1]], '#ffd166', 100, now, 1.8); sfx('clear'); }
    G.phase = 'end'; showEnd();
  } else G.phase = 'aim';
  hud();
}
function showStitch(): void {
  const s = G.run; G.pick = null;
  els.stitchTitle.textContent = `擊倒第 ${s.monster + 1} 隻！挑一個縫上`;
  els.stitchOpts.innerHTML = '';
  s.offer.forEach((id, i) => {
    const b = document.createElement('button'); b.id = `opt${i}`; b.dataset.stitch = id;
    b.innerHTML = `<b>${STITCHES[id].name}</b><small>${STITCHES[id].desc}</small>`;
    b.onclick = () => pickStitch(id); els.stitchOpts.appendChild(b);
  });
  els.slotHint.hidden = true; els.slotOpts.hidden = true; els.slotOpts.innerHTML = '';
  els.stitchModal.hidden = false;
}
function pickStitch(id: StitchId): void {
  const s = G.run;
  if (s.slots.includes(null)) { commitStitch(id); return; }
  G.pick = id;
  [...els.stitchOpts.children].forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.stitch === id));
  els.slotHint.hidden = false; els.slotOpts.hidden = false; els.slotOpts.innerHTML = '';
  s.slots.forEach((x, i) => { const b = document.createElement('button'); b.id = `slot${i}`; b.textContent = `換掉 ${i + 1}：${x ? STITCHES[x].name : '空'}`; b.onclick = () => commitStitch(id, i); els.slotOpts.appendChild(b); });
}
function commitStitch(id: StitchId, slot?: number): void {
  const n = chooseStitch(G.run, id, slot); if (n === G.run) return;
  G.run = n; G.phase = 'aim'; els.stitchModal.hidden = true;
  G.bigText = { text: `第 ${n.monster + 1} 隻`, sub: `門檻 ${n.threshold}${n.cutsMax < TUNE.CUTS ? `｜只有 ${n.cutsMax} 刀` : ''}`, t0: performance.now(), life: T(1100) };
  hud();
}
function showEnd(): void {
  const s = G.run, won = s.phase === 'won';
  G.log[G.log.length - 1].result = won ? 'won' : 'lost';
  els.endTitle.textContent = won ? '三隻全倒！' : `倒在第 ${s.monster + 1} 隻`;
  const st = s.slots.filter(Boolean).map((x) => STITCHES[x as StitchId].name).join('、') || '（無）';
  els.endBody.innerHTML = `<div>總分</div><div class="big" id="endTotal">${s.totalScore}</div><div>最高單刀 <b id="endBest">${s.bestCut}</b></div><div>縫合組合：<span id="endStitch">${st}</span></div><div class="hint">種子 ${s.seed}</div>`;
  els.endModal.hidden = false;
}

// ---------------------------------------------------------------- 輸入
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  if (G.phase !== 'aim' || G.drag) return;
  const p = toWorld(e.clientX, e.clientY);
  G.drag = { id: e.pointerId, a: p, b: p }; els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener('pointermove', (e) => {
  if (!G.drag || e.pointerId !== G.drag.id) return;
  G.drag.b = toWorld(e.clientX, e.clientY);
  const pv = makePreview(G.drag.a, G.drag.b); G.preview = pv;
  els.preview.innerHTML = previewHtml(pv, evaluate(G.run, G.drag.a, G.drag.b).path);
});
const endDrag = (e: PointerEvent, cancel: boolean) => {
  if (!G.drag || e.pointerId !== G.drag.id) return;
  const d = G.drag; G.drag = null;
  d.b = toWorld(e.clientX, e.clientY);
  if (cancel) { G.preview = null; hud(); return; }
  release(d.a, d.b);
};
els.canvas.addEventListener('pointerup', (e) => endDrag(e, false));
els.canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
els.twitch.onclick = () => {
  if (G.phase !== 'aim') return;
  const n = twitch(G.run); if (n === G.run) return;
  G.run = n; sfx('bone'); G.shake = FEEL.SHAKE; G.shakeUntil = performance.now() + 300; hud();
};
els.sound.onclick = () => { G.sound = !G.sound; try { localStorage.setItem('blade-sound', G.sound ? '1' : '0'); } catch { /* 略過 */ } hud(); };
els.restart.onclick = () => newGame();
els.again.onclick = () => newGame();

// ---------------------------------------------------------------- 繪製
const ctx = els.canvas.getContext('2d')!;
function drawOrgan(o: Organ, now: number, hl: number | null, dim = false): void {
  const c = COLOR[o.kind], r = TUNE.R;
  ctx.save(); ctx.translate(o.p[0], o.p[1]);
  const pulse = 1 + 0.05 * Math.sin(now / 300 + o.id);
  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.shadowColor = c; ctx.shadowBlur = 18;
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r * pulse);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, c); g.addColorStop(1, '#00000080');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#0b0d12'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(KIND_NAME[o.kind], 0, 1);
  if (o.kind === 'bone') for (let k = 0; k < o.hp; k++) { ctx.fillStyle = '#e8e1d0'; ctx.fillRect(-10 + k * 12, r + 4, 8, 4); }
  if (hl !== null) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui'; ctx.fillText(String(hl + 1), r + 6, -r - 2);
  }
  ctx.restore();
}
function draw(now: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  let sh: V = [0, 0];
  if (now < G.shakeUntil) { const k = G.shake * ((G.shakeUntil - now) / 300); sh = [(Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k]; }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sh[0] * scale), dpr * (oy + sh[1] * scale));
  const s = G.run, a = G.anim, t = a ? now - a.t0 : 0;
  // 怪物輪廓
  ctx.save();
  const mg = ctx.createRadialGradient(MONSTER_C[0], MONSTER_C[1] - 60, 30, MONSTER_C[0], MONSTER_C[1], MONSTER_RX);
  mg.addColorStop(0, '#3a1d3f'); mg.addColorStop(0.7, '#1c0f22'); mg.addColorStop(1, '#0d0710');
  ctx.fillStyle = mg; ctx.shadowColor = '#b0306a'; ctx.shadowBlur = 30 + 8 * Math.sin(now / 500);
  ctx.beginPath(); ctx.ellipse(MONSTER_C[0], MONSTER_C[1], MONSTER_RX, MONSTER_RY, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 器官（演出中用出刀前的盤面，尚未被斬到的照畫）
  const organs = a ? a.before.filter((o) => !a.hitAt.some((h, i) => h.id === o.id && a.fired.has(`hit${i}`))) : s.organs;
  const hlIds = G.drag && G.preview?.ok ? G.preview.seqIds : [];
  const ctr = a ? a.rec.counter : s.counter;
  for (const o of organs) drawOrgan(o, now, hlIds.includes(o.id) ? hlIds.indexOf(o.id) : null);
  // 反擊預告
  if (ctr && (!a || t < a.counterAt)) {
    const claw = (a ? a.before : s.organs).find((o) => o.id === ctr.clawId);
    const alive = organs.some((o) => o.id === ctr.clawId);
    if (claw && alive) {
      const sp = SLOT_P[ctr.slot];
      ctx.save(); ctx.strokeStyle = '#ff3b3b'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 120); ctx.lineWidth = 4; ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.moveTo(claw.p[0], claw.p[1]); ctx.lineTo(sp[0], sp[1] - 34); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(claw.p[0], claw.p[1], TUNE.R + 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText('反擊預告', claw.p[0], claw.p[1] - TUNE.R - 20); ctx.fillStyle = '#ff6b6b'; ctx.fillText('反擊預告', claw.p[0], claw.p[1] - TUNE.R - 20);
      ctx.restore();
    }
  }
  // 你的身體與縫合槽
  ctx.save();
  ctx.fillStyle = '#10141c'; ctx.strokeStyle = '#2b3342'; ctx.lineWidth = 2;
  ctx.beginPath(); if (typeof ctx.roundRect === 'function') ctx.roundRect(40, BODY_Y + 60, 620, 250, 40); else ctx.rect(40, BODY_Y + 60, 620, 250); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8b93a3'; ctx.font = '15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('你的身體：縫合槽', 350, BODY_Y + 95);
  SLOT_P.forEach((p, i) => {
    const st = s.slots[i], targeted = ctr && ctr.slot === i && (!a || t < a.counterAt);
    ctx.strokeStyle = targeted ? '#ff3b3b' : '#3a4150'; ctx.lineWidth = targeted ? 4 : 2; ctx.fillStyle = st ? '#2a1e33' : '#151923';
    ctx.beginPath(); ctx.arc(p[0], p[1], 46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = st ? '#ffd166' : '#555d6b'; ctx.font = 'bold 18px system-ui'; ctx.fillText(st ? STITCHES[st].name : '空', p[0], p[1] + 6);
  });
  ctx.fillStyle = '#8b93a3'; ctx.font = '14px system-ui';
  ctx.fillText(`抽搐 ${s.twitchesLeft}｜刀長上限 ${maxLen(s.slots)}${s.pendingCutPenalty ? `｜下一隻少 ${s.pendingCutPenalty} 刀` : ''}`, 350, BODY_Y + 290);
  ctx.restore();
  // 拖曳預覽線
  if (G.drag && G.preview) {
    const p = G.preview;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = p.ok ? (p.saves ? '#7CFF6B' : '#ffffff') : '#ff7a7a'; ctx.globalAlpha = 0.85; ctx.lineWidth = 4; ctx.setLineDash(p.ok ? [] : [8, 8]);
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]); ctx.stroke();
    if (p.ok) { ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.shadowBlur = 8; ctx.fillText(String(p.score), p.b[0], p.b[1] - 22); }
    ctx.restore();
  }
  // 刀光（含慢動作）
  if (a && t < a.sweepEnd + T(260)) {
    let prog = 0, slow = false;
    const hs = a.hitAt;
    let acc = 0, lastF = 0;
    for (let i = 0; i <= hs.length; i++) {
      const f = i < hs.length ? hs[i].f : 1, segT = T(FEEL.SWEEP * (f - lastF));
      if (t < acc + segT) { prog = lastF + (f - lastF) * ((t - acc) / Math.max(1, segT)); break; }
      acc += segT; prog = f;
      if (i < hs.length) { const sl = T(FEEL.SLOWMO); if (t < acc + sl) { prog = f + FEEL.SLOWMO_RATE * ((t - acc) / sl) * 0.02; slow = true; break; } acc += sl; }
      lastF = f;
    }
    prog = Math.min(prog, a.stopF);
    const A = a.rec.a, B = a.rec.b, P: V = [A[0] + (B[0] - A[0]) * prog, A[1] + (B[1] - A[1]) * prog];
    const fade = t > a.sweepEnd ? 1 - (t - a.sweepEnd) / T(260) : 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = Math.max(0, fade);
    ctx.strokeStyle = slow ? '#ffe9a8' : '#ffffff'; ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = slow ? 40 : 24; ctx.lineWidth = slow ? 10 : 7;
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(P[0], P[1]); ctx.stroke();
    ctx.restore();
    if (slow) { ctx.save(); ctx.fillStyle = '#ffffff14'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }
  // 粒子
  G.particles = G.particles.filter((q) => now - q.t0 < q.life);
  for (const q of G.particles) {
    const k = (now - q.t0) / 1000, life = 1 - (now - q.t0) / q.life;
    ctx.globalAlpha = Math.max(0, life); ctx.fillStyle = q.c;
    ctx.beginPath(); ctx.arc(q.p[0] + q.v[0] * k, q.p[1] + q.v[1] * k + 300 * k * k, q.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 跳出的數字
  G.pops = G.pops.filter((q) => now - q.t0 < q.life);
  G.pops.forEach((q) => {
    const k = (now - q.t0) / q.life, rise = 40 * k, sc = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 1.5);
    const y = q.tally ? q.p[1] : q.p[1] - rise;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3); ctx.translate(q.p[0], y); ctx.scale(sc, sc);
    ctx.font = `900 ${q.size}px system-ui`; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#000000c0'; ctx.strokeText(q.text, 0, 0);
    ctx.fillStyle = q.color; ctx.fillText(q.text, 0, 0); ctx.restore();
  });
  // 結算大數字
  if (G.bigText && now - G.bigText.t0 < G.bigText.life) {
    const k = (now - G.bigText.t0) / G.bigText.life, sc = k < 0.15 ? 2.2 - (k / 0.15) * 1.2 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.75) / 0.25); ctx.translate(350, 520); ctx.scale(sc, sc);
    ctx.textAlign = 'center'; ctx.font = '900 84px system-ui'; ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(G.bigText.text, 0, 0);
    const gg = ctx.createLinearGradient(0, -70, 0, 10); gg.addColorStop(0, '#fff6c8'); gg.addColorStop(1, '#ff9a3d'); ctx.fillStyle = gg; ctx.fillText(G.bigText.text, 0, 0);
    ctx.font = 'bold 26px system-ui'; ctx.lineWidth = 5; ctx.strokeText(G.bigText.sub, 0, 44); ctx.fillStyle = '#fff'; ctx.fillText(G.bigText.sub, 0, 44);
    ctx.restore();
  }
  if (now < G.flashUntil) { ctx.save(); ctx.fillStyle = '#ffffff55'; ctx.fillRect(-50, -50, W + 100, H + 100); ctx.restore(); }
}
function frame(now: number): void { stepAnim(now); draw(now); requestAnimationFrame(frame); }

// ---------------------------------------------------------------- 測試掛勾（作者測試讀取；不影響遊戲）
(window as unknown as { __blade: unknown }).__blade = {
  get state() { return G.run; }, get phase() { return G.phase; }, get preview() { return G.preview; }, get last() { return G.last; },
  get animActive() { return !!G.anim; }, get log() { return G.log; }, get audioEvents() { return audio.events; }, get previewText() { return els.preview.textContent; },
  toScreen, newGame: (o?: { seed?: number }) => newGame(o), setTimings: (o: { animScale?: number }) => { if (o.animScale !== undefined) G.animScale = o.animScale; },
};
window.addEventListener('resize', layout);
layout(); newGame();
requestAnimationFrame(frame);
