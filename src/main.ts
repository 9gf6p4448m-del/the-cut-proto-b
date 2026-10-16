// THE CUT 3.0 B 軌研究原型（可丟棄；非正式規則、非 Gate 證據）。
// 前端只呼叫研究引擎的公開 API；預覽只用 partitionOf；act 只在玩家按「確認切割」後呼叫（凍結驗收 T-6）。
import { act, newBattle, partitionOf, setProtoBOrganPool, stateHash } from '../engine/src/engine.ts';
import type { BattleConfig, BattleState, Partition } from '../engine/src/engine.ts';
import { loadContent } from '../engine/src/content.ts';
import type { Ev, Organ } from '../engine/src/types.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';

// ---------------- 研究候選設定（P-3 甲＝golden 的一組；非正式規則） ----------------
export type ProtoMode = 'research6' | 'experience3';
const BASE: Omit<BattleConfig, 'seed'> = {
  model: 'A', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'BUT', w10: 7 },
  hpP: 40, hpE: 30, r: 160, anchorCount: 12, maxRounds: 12,
};
const RESEARCH_SEEDS = [2001, 2003, 2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025, 2027, 2029, 2031, 2033, 2035, 2037, 2039, 2041, 2043, 2045, 2047, 2049];
const content = loadContent();

const ORGAN_UI: Record<string, { name: string; glyph: string; fill: string; ring: string }> = {
  heart: { name: '狂暴心臟', glyph: '心', fill: '#8C2635', ring: '#e0485e' },
  shield: { name: '骨盾腺', glyph: '盾', fill: '#b9ab92', ring: '#E6D7BF' },
  poison: { name: '劇毒膽囊', glyph: '毒', fill: '#4f6a2a', ring: '#98B45E' },
  fission: { name: '裂變魔核', glyph: '裂', fill: '#9a5a1e', ring: '#E4A35C' },
  regen: { name: '再生腺', glyph: '生', fill: '#2f6b68', ring: '#6EA6A2' },
  mirror: { name: '反傷鏡膜', glyph: '鏡', fill: '#5a5f7a', ring: '#b8bfe6' },
  core: { name: '裂變核心', glyph: '核', fill: '#7a3d10', ring: '#E4A35C' },
  seedling: { name: '小再生腺', glyph: '苗', fill: '#2a5552', ring: '#6EA6A2' },
};
const attackOf = (key: string): number => {
  const d = (content.byKey as Record<string, { attack?: number }>)[key];
  return d && typeof d.attack === 'number' ? d.attack : 0;
};

// ---------------- 紀錄格式（規格 v2 MUST 5） ----------------
interface RoundLog { round: number; i: number; j: number; prediction: 'L' | 'R' | null; baitIntent: boolean | null; enemySide: 'L' | 'R' | null; enemyTookPoison: boolean; dwellMs: Record<string, number>; cancels: number }
interface GameLog {
  format: 'thecut-protoB-log/1'; fork: 'proto-b'; protoMode: ProtoMode; build: string;
  engineVersion: string; specVersion: string; configHash: string; config: BattleConfig; seed: number;
  actions: { round: number; actor: 'P'; i: number; j: number }[]; rounds: RoundLog[];
  result: string | null; finalStateHash: string | null;
}

// ---------------- 遊戲狀態 ----------------
type UIState = 'IDLE' | 'DRAG' | 'PENDING' | 'EXECUTE' | 'END';
const G = {
  mode: 'experience3' as ProtoMode,
  seedIdx: 0,
  expSeed: 100001,
  state: null as BattleState | null,
  prevState: null as BattleState | null,
  ui: 'IDLE' as UIState,
  from: -1, to: -1, hover: -1,
  pointer: null as { x: number; y: number } | null,
  part: null as Partition | null,
  prediction: null as 'L' | 'R' | null,
  bait: false,
  lastEvents: [] as Ev[],
  anim: null as null | { t0: number; dur: number; part: Partition; enemySide: 'L' | 'R' | null; board: BattleState },
  skipAnim: false,
  log: null as GameLog | null,
  dwellKey: '', dwellT0: 0, dwell: {} as Record<string, number>, cancels: 0,
};

// ---------------- DOM ----------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const els = {
  hpP: $('hpP'), hpE: $('hpE'), hpPBar: $('hpPBar'), hpEBar: $('hpEBar'), round: $('round'), mode: $('mode'), seed: $('seed'),
  preview: $('preview'), pending: $('pending'), confirm: $<HTMLButtonElement>('confirm'), cancel: $<HTMLButtonElement>('cancel'),
  predL: $<HTMLButtonElement>('predL'), predR: $<HTMLButtonElement>('predR'), baitRow: $('baitRow'), bait: $<HTMLInputElement>('bait'),
  review: $('review'), reviewBody: $('reviewBody'), endPanel: $('endPanel'), endTitle: $('endTitle'),
  retry: $<HTMLButtonElement>('retry'), next: $<HTMLButtonElement>('next'), skip: $<HTMLButtonElement>('skip'),
  modeBtn: $<HTMLButtonElement>('modeBtn'), exportBtn: $<HTMLButtonElement>('exportBtn'), sha: $('sha'), banner3: $('banner3'),
  hint: $('hint'), updateBtn: $<HTMLButtonElement>('updateBtn'),
};

// 凍結驗收 T-8：?devfreeze=1 時深凍結引擎回傳的狀態，前端任何寫入都會拋 TypeError。
const DEV_FREEZE = new URLSearchParams(location.search).has('devfreeze');
function deepFreeze<T>(x: T): T { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) deepFreeze(v); } return x; }
function devFreeze<T>(x: T): T { return DEV_FREEZE ? deepFreeze(x) : x; }

// ---------------- 開局 ----------------
function currentSeed(): number { return G.mode === 'research6' ? RESEARCH_SEEDS[G.seedIdx % RESEARCH_SEEDS.length] : G.expSeed; }

export function startBattle(mode: ProtoMode, seed: number): BattleState {
  setProtoBOrganPool(mode === 'experience3' ? 3 : 6); // 只在 newBattle 前設定；整局不變
  return newBattle({ ...BASE, seed }, content).state;
}

function newGame(): void {
  const seed = currentSeed();
  const s = devFreeze(startBattle(G.mode, seed));
  G.state = s; G.prevState = null; G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; G.anim = null; G.lastEvents = [];
  G.log = {
    format: 'thecut-protoB-log/1', fork: 'proto-b', protoMode: G.mode, build: BUILD_SHA,
    engineVersion: s.engineVersion, specVersion: s.specVersion, configHash: s.configHash, config: s.config as BattleConfig, seed,
    actions: [], rounds: [], result: null, finalStateHash: null,
  };
  resetRoundInputs();
  els.review.hidden = true; els.endPanel.hidden = true;
  syncHud(); layout(); updatePreview(); draw();
}

function resetRoundInputs(): void {
  G.prediction = null; G.bait = false; els.bait.checked = false; G.dwell = {}; G.dwellKey = ''; G.cancels = 0;
}

// ---------------- 版面與座標 ----------------
let scale = 1, offX = 0, offY = 0, dpr = 1, cssW = 0, cssH = 0;
function layout(): void {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  cssW = r.width; cssH = r.height;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const s = G.state;
  if (!s || s.template.length === 0) return;
  const xs = s.template.map((p) => p[0]), ys = s.template.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 26;
  scale = Math.min((cssW - 2 * pad) / (maxX - minX), (cssH - 2 * pad) / (maxY - minY));
  offX = (cssW - (maxX - minX) * scale) / 2 - minX * scale;
  offY = (cssH - (maxY - minY) * scale) / 2 - minY * scale;
}
const sx = (x: number) => x * scale + offX;
const sy = (y: number) => y * scale + offY;

// ---------------- 輸入：觸控狀態機（規格 v2 MUST 4；只改輸入層） ----------------
const SNAP_PX = 32;
function nearestAnchor(px: number, py: number, exclude = -1): number {
  const b = G.state?.board;
  if (!b) return -1;
  let best = -1, bd = SNAP_PX * SNAP_PX;
  b.anchors.forEach((a, k) => {
    if (k === exclude) return;
    const dx = sx(a.x) - px, dy = sy(a.y) - py, d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = k; }
  });
  return best;
}
function localXY(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener('pointerdown', (e) => {
  if (G.ui !== 'IDLE' && G.ui !== 'PENDING') return;
  const p = localXY(e);
  const k = nearestAnchor(p.x, p.y);
  if (k < 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (G.ui === 'PENDING') G.cancels += 1;
  els.review.hidden = true;
  G.ui = 'DRAG'; G.from = k; G.to = -1; G.hover = -1; G.pointer = p; G.part = null;
  els.pending.hidden = true;
  updatePreview(); draw();
});
canvas.addEventListener('pointermove', (e) => {
  if (G.ui !== 'DRAG') return;
  const p = localXY(e);
  G.pointer = p;
  const k = nearestAnchor(p.x, p.y, G.from);
  if (k !== G.hover) { G.hover = k; G.part = k >= 0 && G.state ? partitionOf(G.state, G.from, k) : null; noteDwell(); updatePreview(); }
  draw();
});
const endDrag = () => {
  if (G.ui !== 'DRAG') return;
  if (G.hover >= 0 && G.hover !== G.from) {
    G.to = G.hover; G.ui = 'PENDING'; G.part = partitionOf(G.state!, G.from, G.to);
    showPending();
  } else {
    G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null;
  }
  G.pointer = null; noteDwell(); updatePreview(); draw();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { if (G.ui === 'DRAG') { G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; G.pointer = null; updatePreview(); draw(); } });

function noteDwell(): void {
  const now = performance.now();
  if (G.dwellKey) G.dwell[G.dwellKey] = (G.dwell[G.dwellKey] ?? 0) + Math.round(now - G.dwellT0);
  G.dwellKey = G.part && G.part.legal ? `${G.part.i}-${G.part.j}` : '';
  G.dwellT0 = now;
}

// ---------------- 預覽（只用 partitionOf 的資訊與公開偏好） ----------------
const REASON_TEXT: Record<string, string> = {
  SAME_EDGE: '兩個錨點在同一條邊上', ANCHOR_AT_VERTEX: '錨點落在頂點上', AREA_TOO_SMALL: '有一側面積小於 10%', BAD_INDEX: '錨點不合法', NO_BOARD: '沒有盤面',
};
function organList(os: Organ[]): string {
  if (os.length === 0) return '（空）';
  const c: Record<string, number> = {};
  for (const o of os) c[o.key] = (c[o.key] ?? 0) + 1;
  return Object.entries(c).map(([k, n]) => `${ORGAN_UI[k]?.glyph ?? k}×${n}`).join(' ');
}
function attackSum(os: Organ[]): number { return os.reduce((s, o) => s + attackOf(o.key), 0); }
function updatePreview(): void {
  const p = G.part;
  if (!p) {
    els.preview.innerHTML = G.ui === 'DRAG' ? '拖到另一個錨點放開' : '從一個<b>錨點</b>拖到另一個錨點，畫出切線';
    return;
  }
  if (!p.legal) { els.preview.innerHTML = `<span class="bad">不能這樣切：${REASON_TEXT[p.reason ?? ''] ?? p.reason}</span>`; return; }
  const tot = p.area2.L + p.area2.R;
  const pl = Math.round((100 * p.area2.L) / tot);
  els.preview.innerHTML =
    `<div><span class="sideL">紫側</span> ${organList(p.L)}　面積 ${pl}%　<small>攻擊值 ${attackSum(p.L)}</small></div>` +
    `<div><span class="sideR">橙側</span> ${organList(p.R)}　面積 ${100 - pl}%　<small>攻擊值 ${attackSum(p.R)}</small></div>` +
    `<div><span class="pierce">刀中穿刺</span> ${organList(p.pierced)}</div>`;
}
function showPending(): void {
  const p = G.part!;
  els.pending.hidden = false;
  els.confirm.disabled = !p.legal;
  const hasPoison = !!G.state?.board?.organs.some((o) => o.key === 'poison');
  els.baitRow.hidden = !hasPoison || !p.legal;
  setPrediction(G.prediction);
}
function setPrediction(v: 'L' | 'R' | null): void {
  G.prediction = v;
  els.predL.classList.toggle('on', v === 'L'); els.predR.classList.toggle('on', v === 'R');
}
els.predL.onclick = () => setPrediction(G.prediction === 'L' ? null : 'L');
els.predR.onclick = () => setPrediction(G.prediction === 'R' ? null : 'R');
els.bait.onchange = () => { G.bait = els.bait.checked; };
els.cancel.onclick = () => {
  G.cancels += 1; G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; noteDwell();
  els.pending.hidden = true; updatePreview(); draw();
};

// ---------------- 執行（act 的唯一呼叫點） ----------------
els.confirm.onclick = () => {
  if (G.ui !== 'PENDING' || !G.state || !G.part || !G.part.legal) return;
  noteDwell();
  const before = G.state;
  const part = G.part;
  const action = { round: before.round, actor: 'P' as const, i: part.i, j: part.j };
  const out = act(before, action, content);
  if (!out.legal) return;
  const choice = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
  const enemySide = choice ? choice.side : null;
  const enemyOrgans = enemySide === 'L' ? part.L : enemySide === 'R' ? part.R : [];
  G.log!.actions.push(action);
  G.log!.rounds.push({
    round: before.round, i: part.i, j: part.j, prediction: G.prediction,
    baitIntent: els.baitRow.hidden ? null : G.bait, enemySide, enemyTookPoison: enemyOrgans.some((o) => o.key === 'poison'),
    dwellMs: { ...G.dwell }, cancels: G.cancels,
  });
  G.prevState = before; G.state = devFreeze(out.state); G.lastEvents = out.events;
  G.ui = 'EXECUTE'; els.pending.hidden = true;
  G.anim = { t0: performance.now(), dur: G.skipAnim ? 0 : 1100, part, enemySide, board: before };
  renderReview(out.events, part, enemySide);
  syncHud(true);
  requestAnimationFrame(tick);
};
els.skip.onclick = () => { if (G.anim) G.anim.dur = 0; };

function finishRound(): void {
  G.anim = null;
  const s = G.state!;
  if (s.result) {
    G.ui = 'END';
    G.log!.result = s.result; G.log!.finalStateHash = stateHash(s);
    els.endTitle.textContent = s.result === 'WIN' ? '勝利：怪物倒下' : s.result === 'LOSS' ? (s.sd1 ? '失敗：同時歸零（研究規則判玩家敗）' : '失敗') : '僵持：12 回合未分勝負';
    els.endPanel.hidden = false;
  } else {
    G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; resetRoundInputs();
  }
  layout(); syncHud(); updatePreview(); draw();
}
function tick(): void {
  if (!G.anim) return;
  const t = performance.now() - G.anim.t0;
  draw();
  if (t >= G.anim.dur) finishRound(); else requestAnimationFrame(tick);
}

// ---------------- 因果回顧（只解釋已發生的事件） ----------------
const WHO = { P: '你', E: '屠夫' } as const;
const CHOICE_TEXT: Record<string, string> = {
  SURVIVAL: '求生優先：另一側會讓牠死', 'SO-3': '兩側都致死：選讓你損失最小的一側（SO-3）', PREF: '依偏好評分較高', BAND: '依偏好帶', 'TIE-v': '評分相同，比實際得失', 'TIE-area': '再相同，比面積', 'TIE-fixed': '再相同，固定側', FORCED: '只剩一側', 'SO-1': 'SO-1', 'SO-2': 'SO-2',
};
function evText(e: Ev, part: Partition): string | null {
  const nm = (id: number) => { const o = [...part.L, ...part.R, ...part.pierced].find((x) => x.id === id); return o ? ORGAN_UI[o.key]?.name ?? o.key : `器官#${id}`; };
  switch (e.t) {
    case 'PIERCE': return `刀鋒穿刺：${nm(e.id)}`;
    case 'INC': return `刀中效果：${nm(e.id)}（${e.effect === 'SPAWN_CORES' ? '兩側生成核心' : e.effect === 'SCHEDULE_SEEDLING' ? '下回合長出小再生腺' : '鏡膜被切碎'}）`;
    case 'STEP': return e.name === 'INCISION' ? '— 刀中效果 —' : e.name === 'HARVEST' ? '— 盾、治療、傷害 —' : null;
    case 'CHOICE': return `屠夫拿走 ${e.side === 'L' ? '紫側' : '橙側'}（${CHOICE_TEXT[e.reason] ?? e.reason}）`;
    case 'SHIELD': return `${WHO[e.who]}獲得 ${e.n} 盾`;
    case 'HEAL': return `${WHO[e.who]}回復 ${e.actual}`;
    case 'DMG': { const what = e.kind === 'SELF_POISON' ? '劇毒膽囊反噬' : e.kind === 'INC_POISON' || e.kind === 'INC_POISON_SELF' ? '毒囊被切破' : e.kind === 'CORE' ? '裂變核心' : e.kind === 'REFLECT' ? '鏡膜反射' : '攻擊'; return `${what}：${WHO[e.src]} → ${WHO[e.dst]} ${e.raw} 傷（盾吸收 ${e.abs}，實扣 ${e.loss}）`; }
    case 'REFL': return `${WHO[e.who]}的鏡膜反射 ${e.amount}`;
    case 'END': return `結束：${e.result}`;
    default: return null;
  }
}
function renderReview(events: Ev[], part: Partition, enemySide: 'L' | 'R' | null): void {
  const lines = events.map((e) => evText(e, part)).filter((x): x is string => !!x);
  const choice = events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
  let basis = '';
  if (choice && choice.basis) {
    const b = choice.basis;
    basis = `<div class="basis">評分（屠夫視角）：紫側 U=${(b.L.U / (400 * b.L.pDen)).toFixed(2)}${b.L.lethal ? '（會致死）' : ''}；橙側 U=${(b.R.U / (400 * b.R.pDen)).toFixed(2)}${b.R.lethal ? '（會致死）' : ''}</div>`;
  }
  const yours = enemySide === 'L' ? '橙側' : enemySide === 'R' ? '紫側' : '—';
  const hpLine = G.prevState && G.state ? `<div>HP：你 ${G.prevState.hp.P}→${G.state.hp.P}，屠夫 ${G.prevState.hp.E}→${G.state.hp.E}</div>` : '';
  els.reviewBody.innerHTML = `<div>你拿到 <b>${yours}</b></div>${hpLine}${basis}<ol>${lines.map((l) => `<li>${l}</li>`).join('')}</ol>`;
  els.review.hidden = false;
}

// ---------------- HUD ----------------
function syncHud(_after = false): void {
  const s = G.state; if (!s) return;
  els.hpP.textContent = `${s.hp.P}/${s.maxHp.P}`; els.hpE.textContent = `${s.hp.E}/${s.maxHp.E}`;
  els.hpPBar.style.width = `${(100 * Math.max(0, s.hp.P)) / s.maxHp.P}%`; els.hpEBar.style.width = `${(100 * Math.max(0, s.hp.E)) / s.maxHp.E}%`;
  els.round.textContent = `第 ${s.round}／${s.config.maxRounds} 回合`;
  els.mode.textContent = G.mode === 'research6' ? '六器官研究模式' : '三器官體驗模式';
  els.seed.textContent = `seed ${currentSeed()}`;
  els.banner3.hidden = G.mode !== 'experience3';
  els.modeBtn.textContent = G.mode === 'research6' ? '切換到三器官體驗' : '切換到六器官研究';
}

// ---------------- 繪圖 ----------------
type P2 = [number, number];
function sideOf(a: P2, b: P2, c: P2): number { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
/** 只供畫面使用的多邊形切分（規則判定以引擎 partitionOf 為準）。 */
function clipHalf(poly: P2[], a: P2, b: P2, keepLeft: boolean): P2[] {
  const out: P2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const sp = sideOf(a, b, p) * (keepLeft ? 1 : -1), sq = sideOf(a, b, q) * (keepLeft ? 1 : -1);
    if (sp >= 0) out.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
  }
  return out;
}
function pathPoly(poly: P2[]): void {
  ctx.beginPath(); poly.forEach((p, k) => (k ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.closePath();
}
function drawFlesh(poly: P2[], tint: string | null, dx = 0, dy = 0, alpha = 1): void {
  ctx.save(); ctx.translate(dx, dy); ctx.globalAlpha = alpha;
  pathPoly(poly);
  const g = ctx.createRadialGradient(cssW / 2, cssH / 2, 10, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.6);
  g.addColorStop(0, '#5a1c26'); g.addColorStop(1, '#2a0d13');
  ctx.fillStyle = g; ctx.fill();
  if (tint) { ctx.fillStyle = tint; ctx.fill(); }
  ctx.lineWidth = 3; ctx.strokeStyle = '#E6D7BF55'; ctx.stroke();
  ctx.restore();
}
function drawOrgan(o: Organ, mark: 'pierce' | null, dx = 0, dy = 0, alpha = 1): void {
  const ui = ORGAN_UI[o.key] ?? { glyph: '?', fill: '#444', ring: '#999', name: o.key };
  const rr = Math.max(12, (G.state?.config.r ?? 160) * scale);
  const x = sx(o.x) + dx, y = sy(o.y) + dy;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.fillStyle = ui.fill; ctx.fill();
  ctx.lineWidth = mark === 'pierce' ? 4 : 2; ctx.strokeStyle = mark === 'pierce' ? '#ffffff' : ui.ring; ctx.stroke();
  ctx.fillStyle = '#f4ead8'; ctx.font = `bold ${Math.round(rr * 1.05)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ui.glyph, x, y + 1);
  ctx.restore();
}
function draw(): void {
  const s = G.anim ? G.anim.board : G.state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#11151B'; ctx.fillRect(0, 0, cssW, cssH);
  if (!s || !s.board || s.template.length === 0) return;
  const poly = s.template.map((p) => [p[0], p[1]] as P2);
  const b = s.board;
  const p = G.anim ? G.anim.part : G.part;
  const pierced = new Set((p?.legal ? p.pierced : []).map((o) => o.id));
  if (p && p.legal) {
    const A = b.anchors[p.i], B = b.anchors[p.j];
    const a: P2 = [A.x, A.y], bb: P2 = [B.x, B.y];
    let offL = 0, offR = 0, alphaE = 1;
    if (G.anim) {
      const t = Math.min(1, (performance.now() - G.anim.t0) / Math.max(1, G.anim.dur));
      const nx = -(bb[1] - a[1]), ny = bb[0] - a[0], nl = Math.hypot(nx, ny) || 1; // 左側法向（畫面座標）
      const sep = 18 * Math.min(1, t * 2.5);
      offL = sep; offR = -sep;
      const take = Math.max(0, (t - 0.45) / 0.55);
      if (G.anim.enemySide === 'L') { offL += 60 * take; alphaE = 1 - take; } else if (G.anim.enemySide === 'R') { offR -= 60 * take; alphaE = 1 - take; }
      const ux = nx / nl, uy = ny / nl;
      const isE = (side: 'L' | 'R') => G.anim!.enemySide === side;
      drawFlesh(clipHalf(poly, a, bb, true), '#7b4bb055', ux * offL, uy * offL, isE('L') ? alphaE : 1);
      drawFlesh(clipHalf(poly, a, bb, false), '#d07a2a44', ux * offR, uy * offR, isE('R') ? alphaE : 1);
      for (const o of p.L) drawOrgan(o, null, ux * offL, uy * offL, isE('L') ? alphaE : 1);
      for (const o of p.R) drawOrgan(o, null, ux * offR, uy * offR, isE('R') ? alphaE : 1);
      for (const o of p.pierced) drawOrgan(o, 'pierce', 0, 0, Math.max(0, 1 - t * 1.6));
      if (t < 0.35) { ctx.strokeStyle = `rgba(255,255,255,${1 - t / 0.35})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(bb[0]), sy(bb[1])); ctx.stroke(); }
      return;
    }
    drawFlesh(clipHalf(poly, a, bb, true), '#7b4bb066');
    drawFlesh(clipHalf(poly, a, bb, false), '#d07a2a55');
  } else {
    drawFlesh(poly, null);
  }
  for (const o of b.organs) drawOrgan(o, pierced.has(o.id) ? 'pierce' : null);
  // 切線
  if ((G.ui === 'DRAG' || G.ui === 'PENDING') && G.from >= 0) {
    const A = b.anchors[G.from];
    const end = G.ui === 'PENDING' ? b.anchors[G.to] : G.hover >= 0 ? b.anchors[G.hover] : null;
    ctx.save(); ctx.lineWidth = 3;
    ctx.strokeStyle = p && !p.legal ? '#ff5a5a' : '#f4ead8';
    ctx.setLineDash(G.ui === 'PENDING' ? [] : [10, 8]);
    ctx.beginPath(); ctx.moveTo(sx(A.x), sy(A.y));
    if (end) ctx.lineTo(sx(end.x), sy(end.y)); else if (G.pointer) ctx.lineTo(G.pointer.x, G.pointer.y);
    ctx.stroke(); ctx.restore();
  }
  // 錨點
  b.anchors.forEach((a, k) => {
    const sel = k === G.from || k === G.to || k === G.hover;
    ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), sel ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = sel ? '#E4A35C' : '#E6D7BF'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#11151B'; ctx.stroke();
    if (sel) { ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), SNAP_PX, 0, Math.PI * 2); ctx.strokeStyle = '#E4A35C55'; ctx.stroke(); }
  });
}

// ---------------- 其他按鈕 ----------------
els.retry.onclick = () => newGame();
els.next.onclick = () => { if (G.mode === 'research6') G.seedIdx += 1; else G.expSeed += 1; newGame(); };
els.modeBtn.onclick = () => { G.mode = G.mode === 'research6' ? 'experience3' : 'research6'; newGame(); };
els.exportBtn.onclick = async () => {
  const text = JSON.stringify(G.log);
  try { await navigator.clipboard.writeText(text); els.hint.textContent = '紀錄已複製到剪貼簿'; } catch { els.hint.textContent = '無法複製（瀏覽器不允許）'; }
};
els.sha.textContent = BUILD_SHA;
window.addEventListener('resize', () => { layout(); draw(); });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// 測試掛勾（只讀；不改規則）
(window as any).__proto = {
  get state() { return G.state; }, get ui() { return G.ui; }, get log() { return G.log; }, stateHash,
  anchorScreen: (k: number) => { const a = G.state!.board!.anchors[k]; const r = canvas.getBoundingClientRect(); return { x: r.left + sx(a.x), y: r.top + sy(a.y) }; },
  setSkip: (v: boolean) => { G.skipAnim = v; },
  setMode: (m: ProtoMode) => { G.mode = m; newGame(); },
};

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    els.updateBtn.onclick = () => { reg.update(); els.hint.textContent = '檢查更新中…'; };
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

newGame();
