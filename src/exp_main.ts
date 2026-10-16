// THE CUT FUN-EXP-01 實驗版（研究原型；非正式規則、非 Gate 證據）。
// 前端只呼叫研究引擎的公開 API；預覽只用 partitionOf 與 experiment.ts 的 UI 純函式；act 只在玩家按「確認切割」後呼叫（凍結驗收 T-6）。
import { act, newBattle, partitionOf, setProtoBOrganPool, stateHash } from '../engine/src/engine.ts';
import type { BattleState, Partition } from '../engine/src/engine.ts';
import { loadContent } from '../engine/src/content.ts';
import type { Ev, Organ } from '../engine/src/types.ts';
import { EXP_PARAMS } from './exp_params.ts';
import {
  MODES, SIDE_NAME, SURVEY_Q, crossesWound, exportText, expBattleConfig, finishLog, glyphOf, keepWoundUi, newLog, obsessionHtml, recentText,
  refreshSummary, reviewLines, roundRecord, saveRecent, summaryHtml, tearHtml, woundStatusText,
} from './exp_ui.ts';
import type { ExpLog, ExpModeId } from './exp_ui.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
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

// ---------------- 遊戲狀態 ----------------
type UIState = 'IDLE' | 'DRAG' | 'PENDING' | 'EXECUTE' | 'END';
type BoardKey = 'free' | '1' | '2' | '3';
const G = {
  modeId: 'BASELINE' as ExpModeId,
  board: 'free' as BoardKey,
  freeSeed: 0,
  gameId: '',
  gameSeq: 0,
  state: null as BattleState | null,
  prevState: null as BattleState | null,
  ui: 'IDLE' as UIState,
  from: -1, to: -1, hover: -1,
  pointer: null as { x: number; y: number } | null,
  part: null as Partition | null,
  keep: false,
  lastEvents: [] as Ev[],
  reviewHtml: '',
  anim: null as null | { t0: number; dur: number; part: Partition; enemySide: 'L' | 'R' | null; board: BattleState },
  skipAnim: false,
  log: null as ExpLog | null,
};

// ---------------- DOM ----------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const els = {
  hpP: $('hpP'), hpE: $('hpE'), hpPBar: $('hpPBar'), hpEBar: $('hpEBar'), round: $('round'), seed: $('seed'), enemyName: $('enemyName'),
  modeName: $('modeName'), blurb: $('blurb'), notice: $('notice'), variantWrap: $('variantWrap'), variantSel: $<HTMLSelectElement>('variantSel'), boardSel: $<HTMLSelectElement>('boardSel'),
  preview: $('preview'), pending: $('pending'), confirm: $<HTMLButtonElement>('confirm'), cancel: $<HTMLButtonElement>('cancel'),
  predL: $<HTMLButtonElement>('predL'), predR: $<HTMLButtonElement>('predR'), baitRow: $('baitRow'), bait: $<HTMLInputElement>('bait'),
  keepRow: $('keepRow'), keep: $<HTMLInputElement>('keepWound'), keepWhy: $('keepWhy'),
  endPanel: $('endPanel'), endTitle: $('endTitle'), endSummary: $('endSummary'), survey: $('survey'),
  retry: $<HTMLButtonElement>('retry'), next: $<HTMLButtonElement>('next'), skip: $<HTMLButtonElement>('skip'),
  exportBtn: $<HTMLButtonElement>('exportBtn'), exportBtn2: $<HTMLButtonElement>('exportBtn2'), exportRecent: $<HTMLButtonElement>('exportRecent'),
  exportModal: $('exportModal'), exportBox: $<HTMLTextAreaElement>('exportBox'), exportClose: $<HTMLButtonElement>('exportClose'),
  sha: $('sha'), hint: $('hint'), updateBtn: $<HTMLButtonElement>('updateBtn'),
};

// 凍結驗收 T-8：?devfreeze=1 時深凍結引擎回傳的狀態，前端任何寫入都會拋 TypeError。
const DEV_FREEZE = new URLSearchParams(location.search).has('devfreeze');
function deepFreeze<T>(x: T): T { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) deepFreeze(v); } return x; }
function devFreeze<T>(x: T): T { return DEV_FREEZE ? deepFreeze(x) : x; }

// 確認面板放在固定高度的槽位（.pending-slot）：出現與消失都不改變畫布尺寸，避免器官變形、觸控座標漂移
function setPending(show: boolean): void { els.pending.hidden = !show; }

// ---------------- 開局與模式切換 ----------------
function randomSeed(): number { return 100000 + Math.floor(Math.random() * 900000); }
function currentSeed(): number {
  if (G.board === 'free') return G.freeSeed;
  return EXP_PARAMS.boards[G.modeId][Number(G.board) - 1];
}

export function startBattle(mode: ExpModeId, seed: number): BattleState {
  setProtoBOrganPool(6); // 實驗版三模式都用六器官研究內容
  return newBattle(expBattleConfig(mode, seed), content).state;
}

function newGame(): void {
  const seed = currentSeed();
  const s = devFreeze(startBattle(G.modeId, seed));
  G.state = s; G.prevState = null; G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; G.anim = null; G.lastEvents = []; G.reviewHtml = '';
  G.gameId = `${++G.gameSeq}`;
  G.log = newLog(G.modeId, s, G.board, BUILD_SHA);
  resetRoundInputs();
  els.endPanel.hidden = true; els.exportModal.hidden = true; resetSurveyUi();
  syncHud(); layout(); updatePreview(); draw();
}

function resetRoundInputs(): void { G.keep = false; els.bait.checked = false; els.keep.checked = false; predictionSet(null); }
let prediction: 'L' | 'R' | null = null;
function predictionSet(v: 'L' | 'R' | null): void { prediction = v; els.predL.classList.toggle('on', v === 'L'); els.predR.classList.toggle('on', v === 'R'); }

/** 切換模式／變體／盤面：一律重新初始化戰鬥並提示（凍結驗收 X-3）。 */
function switchTo(mode: ExpModeId, board: BoardKey): void {
  G.modeId = mode; G.board = board;
  if (board === 'free') G.freeSeed = randomSeed();
  newGame();
  els.notice.textContent = '已切換模式，戰鬥重新開始';
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

// ---------------- 輸入：觸控狀態機 ----------------
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
  G.reviewHtml = '';
  G.ui = 'DRAG'; G.from = k; G.to = -1; G.hover = -1; G.pointer = p; G.part = null;
  setPending(false);
  updatePreview(); draw();
});
canvas.addEventListener('pointermove', (e) => {
  if (G.ui !== 'DRAG') return;
  const p = localXY(e);
  G.pointer = p;
  const k = nearestAnchor(p.x, p.y, G.from);
  if (k !== G.hover) { G.hover = k; G.part = k >= 0 && G.state ? partitionOf(G.state, G.from, k) : null; updatePreview(); }
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
  G.pointer = null; updatePreview(); draw();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { if (G.ui === 'DRAG') { G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null; G.pointer = null; updatePreview(); draw(); } });

// ---------------- 預覽（只用 partitionOf 的資訊、公開規則與 experiment.ts 的 UI 純函式） ----------------
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
type Def = { harvest?: Record<string, number | string>; incision?: Record<string, number | string> };
const defOf = (key: string): Def => ((content.byKey as unknown as Record<string, Def>)[key] ?? {}) as Def;
/** 落側效果（持有者得到）：只把內容檔數值換成文字並加總，不模擬結算。 */
function holdText(os: Organ[]): string {
  const sum: Record<string, number> = {};
  for (const o of os) { const h = defOf(o.key).harvest ?? {}; for (const [k, v] of Object.entries(h)) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v; }
  const parts: string[] = [];
  if (sum.damage) parts.push(`對對手 ${sum.damage} 傷`);
  if (sum.shield) parts.push(`+${sum.shield} 盾`);
  if (sum.heal) parts.push(`回復 ${sum.heal}`);
  if (sum.selfDamage) parts.push(`<span class="bad">自己受 ${sum.selfDamage} 傷</span>`);
  if (sum.reflectPct) parts.push(`反彈直接傷害 ${sum.reflectPct}%`);
  return parts.length ? parts.join('、') : '沒有效果';
}
const INC_TEXT: Record<string, string> = { heart: '你對屠夫 3 傷', shield: '你 +3 盾', poison: '雙方各受 2 傷', fission: '兩側各長出一顆核心', regen: '下回合長出小再生腺', mirror: '鏡膜被切碎失效' };
function incText(os: Organ[]): string {
  if (os.length === 0) return '沒有';
  return os.map((o) => `${ORGAN_UI[o.key]?.glyph ?? o.key}→${INC_TEXT[o.key] ?? '—'}`).join('；');
}
function updatePreview(): void {
  const p = G.part, s = G.state;
  const woundLine = s && s.wound !== undefined ? `<div class="wound-status">${woundStatusText(s)}</div>` : '';
  if (!p) {
    if (G.ui === 'DRAG') { els.preview.innerHTML = '拖到另一個錨點放開'; return; }
    els.preview.innerHTML = (G.reviewHtml ? `<div id="reviewBody">${G.reviewHtml}</div>` : '<b>你切一刀 → 屠夫先挑走一半 → 剩下那一半歸你。</b><br>從一個白點拖到另一個白點開始。') + woundLine;
    return;
  }
  if (!p.legal) { els.preview.innerHTML = `<span class="bad">不能這樣切：${REASON_TEXT[p.reason ?? ''] ?? p.reason}</span>`; return; }
  const tot = p.area2.L + p.area2.R;
  const pl = Math.round((100 * p.area2.L) / tot);
  els.preview.innerHTML =
    (s ? obsessionHtml(s, p) + tearHtml(s, p) : '') +
    `<div><span class="sideL">紫側</span> ${organList(p.L)}　<small>面積 ${pl}%・攻擊值 ${attackSum(p.L)}</small><br><small>拿到的人：${holdText(p.L)}</small></div>` +
    `<div><span class="sideR">橙側</span> ${organList(p.R)}　<small>面積 ${100 - pl}%・攻擊值 ${attackSum(p.R)}</small><br><small>拿到的人：${holdText(p.R)}</small></div>` +
    `<div><span class="pierce">刀中穿刺（切下去立刻發生）</span> ${incText(p.pierced)}</div>` + woundLine +
    `<div class="who">屠夫會先挑一側拿走，<b>另一側歸你</b></div>`;
}
function showPending(): void {
  const p = G.part!, s = G.state!;
  setPending(true);
  els.confirm.disabled = !p.legal;
  const hasPoison = !!s.board?.organs.some((o) => o.key === 'poison');
  els.baitRow.hidden = !hasPoison || !p.legal;
  els.bait.checked = false;
  const k = keepWoundUi(s, p);
  G.keep = false; els.keep.checked = false;
  els.keepRow.hidden = !k.visible; els.keep.disabled = !k.enabled; els.keepWhy.textContent = k.why;
  els.keepRow.classList.toggle('off', !k.enabled);
  predictionSet(prediction);
}
els.predL.onclick = () => predictionSet(prediction === 'L' ? null : 'L');
els.predR.onclick = () => predictionSet(prediction === 'R' ? null : 'R');
els.keep.onchange = () => { G.keep = els.keep.checked && !els.keep.disabled; };
els.cancel.onclick = () => {
  G.ui = 'IDLE'; G.from = G.to = G.hover = -1; G.part = null;
  setPending(false); updatePreview(); draw();
};

// ---------------- 執行（act 的唯一呼叫點） ----------------
els.confirm.onclick = () => {
  if (G.ui !== 'PENDING' || !G.state || !G.part || !G.part.legal) return;
  const before = G.state;
  const part = G.part;
  const keepWound = G.keep;
  const action = keepWound ? { round: before.round, actor: 'P' as const, i: part.i, j: part.j, keepWound: true } : { round: before.round, actor: 'P' as const, i: part.i, j: part.j };
  let out: ReturnType<typeof act>;
  try { out = act(before, action, content); } catch (e) { els.hint.textContent = `引擎拒絕這一刀：${String(e)}`; return; }
  if (!out.legal) return;
  const choice = out.events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
  const enemySide = choice ? choice.side : null;
  G.log!.rounds.push(roundRecord(before, part, keepWound, out.events, out.state, stateHash(out.state), { prediction, baitIntent: els.baitRow.hidden ? null : els.bait.checked }));
  G.prevState = before; G.state = devFreeze(out.state); G.lastEvents = out.events;
  G.ui = 'EXECUTE'; setPending(false); els.notice.textContent = '';
  G.anim = { t0: performance.now(), dur: G.skipAnim ? 0 : 1100, part, enemySide, board: before };
  renderReview(out.events, before, part, enemySide);
  syncHud();
  requestAnimationFrame(tick);
};
els.skip.onclick = () => { if (G.anim) G.anim.dur = 0; };

function finishRound(): void {
  G.anim = null;
  const s = G.state!;
  if (s.result) {
    G.ui = 'END';
    finishLog(G.log!, s, stateHash(s));
    els.endTitle.textContent = s.result === 'WIN' ? '勝利：怪物倒下' : s.result === 'LOSS' ? (s.sd1 ? '失敗：同時歸零（研究規則判玩家敗）' : '失敗') : '僵持：12 回合未分勝負';
    els.endSummary.innerHTML = summaryHtml(G.log!);
    saveRecent(G.gameId, G.log!);
    els.endPanel.hidden = false;
    els.endPanel.scrollTop = 0;
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

// ---------------- 因果回顧（只解釋已發生的事件；顯示在預覽槽，不蓋住畫布） ----------------
function renderReview(events: Ev[], before: BattleState, part: Partition, enemySide: 'L' | 'R' | null): void {
  const lines = reviewLines(events, before, part);
  const choice = events.find((e): e is Extract<Ev, { t: 'CHOICE' }> => e.t === 'CHOICE');
  let basis = '';
  if (choice && choice.basis) {
    const b = choice.basis;
    basis = `<div class="basis">評分（屠夫視角）：紫側 U=${(b.L.U / (400 * b.L.pDen)).toFixed(2)}${b.L.lethal ? '（會致死）' : ''}；橙側 U=${(b.R.U / (400 * b.R.pDen)).toFixed(2)}${b.R.lethal ? '（會致死）' : ''}</div>`;
  }
  const yours = enemySide === 'L' ? SIDE_NAME.R : enemySide === 'R' ? SIDE_NAME.L : '—';
  const after = G.state!;
  G.reviewHtml = `<div>你拿到 <b>${yours}</b>　HP：你 ${before.hp.P}→${after.hp.P}，屠夫 ${before.hp.E}→${after.hp.E}</div>${basis}<ol>${lines.map((l) => `<li>${l}</li>`).join('')}</ol>`;
  updatePreview();
}

// ---------------- HUD ----------------
function syncHud(): void {
  const s = G.state; if (!s) return;
  const m = MODES[G.modeId];
  els.hpP.textContent = `${s.hp.P}/${s.maxHp.P}`; els.hpE.textContent = `${s.hp.E}/${s.maxHp.E}`;
  els.hpPBar.style.width = `${(100 * Math.max(0, s.hp.P)) / s.maxHp.P}%`; els.hpEBar.style.width = `${(100 * Math.max(0, s.hp.E)) / s.maxHp.E}%`;
  els.round.textContent = `第 ${s.round}／${s.config.maxRounds} 回合`;
  els.seed.textContent = `seed ${currentSeed()}`;
  els.modeName.textContent = m.name;
  els.enemyName.textContent = m.enemyName;
  els.blurb.textContent = m.blurb;
  els.variantWrap.hidden = m.top !== 'A';
  els.variantSel.value = G.modeId === 'A2' ? 'A2' : 'A1';
  els.boardSel.value = G.board;
  document.querySelectorAll<HTMLButtonElement>('#modeRow button').forEach((b) => { const on = b.dataset.top === m.top; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
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
/** 傷口線（實驗 B）：金色點線＋深色底襯，旁邊畫封存器官小圖示；與白色切線、器官圓不同樣式。tear＝目前切線會撕裂它時加亮。 */
const WOUND_RGB: [number, number, number] = [255, 209, 102];
/** 傷口在畫布上的幾何（畫面座標）：兩端點與封存器官圖示中心。畫圖與測試掛勾共用。 */
function woundGeom(w: NonNullable<BattleState['wound']>) {
  const ax = sx(w.a.x), ay = sy(w.a.y), bx = sx(w.b.x), by = sy(w.b.y);
  const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
  const n = w.sealed.length;
  const icons = w.sealed.map((o, k) => { const off = (k - (n - 1) / 2) * 26; return { key: o.key, x: mx + ux * off, y: my + uy * off }; });
  return { ax, ay, bx, by, icons };
}
function drawWound(s: BattleState, tear: boolean): void {
  const w = s.wound;
  if (!w) return;
  const { ax, ay, bx, by, icons } = woundGeom(w);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([]); ctx.strokeStyle = '#000000aa'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([2, 9]); ctx.strokeStyle = tear ? '#ff5a5a' : `rgb(${WOUND_RGB.join(',')})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([]);
  icons.forEach((ic) => {
    const x = ic.x, y = ic.y;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = '#2a1a05'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = tear ? '#ff5a5a' : `rgb(${WOUND_RGB.join(',')})`; ctx.stroke();
    ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyphOf(ic.key), x, y + 1);
  });
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
      drawWound(s, false);
      if (t < 0.35) { ctx.strokeStyle = `rgba(255,255,255,${1 - t / 0.35})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(bb[0]), sy(bb[1])); ctx.stroke(); }
      return;
    }
    drawFlesh(clipHalf(poly, a, bb, true), '#7b4bb066');
    drawFlesh(clipHalf(poly, a, bb, false), '#d07a2a55');
  } else {
    drawFlesh(poly, null);
  }
  for (const o of b.organs) drawOrgan(o, pierced.has(o.id) ? 'pierce' : null);
  // 傷口線（跨回合留存；目前切線會撕裂它時加亮成紅色）
  drawWound(s, !!(p && crossesWound(s, p)));
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

// ---------------- 模式、盤面、其他按鈕 ----------------
document.querySelectorAll<HTMLButtonElement>('#modeRow button').forEach((btn) => {
  btn.onclick = () => {
    const top = btn.dataset.top;
    const mode: ExpModeId = top === 'A' ? (els.variantSel.value === 'A2' ? 'A2' : 'A1') : top === 'B' ? 'B' : 'BASELINE';
    switchTo(mode, G.board);
  };
});
els.variantSel.onchange = () => switchTo(els.variantSel.value === 'A2' ? 'A2' : 'A1', G.board);
els.boardSel.onchange = () => switchTo(G.modeId, els.boardSel.value as BoardKey);
els.retry.onclick = () => { newGame(); els.notice.textContent = ''; };
els.next.onclick = () => {
  if (G.board === 'free') G.freeSeed = randomSeed(); else G.board = String((Number(G.board) % 3) + 1) as BoardKey;
  newGame(); els.notice.textContent = '';
};

function showExportBox(text: string): void { els.exportBox.value = text; els.exportModal.hidden = false; els.exportBox.focus(); els.exportBox.select(); }
async function copyOrShow(text: string, okMsg: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); els.hint.textContent = okMsg; }
  catch { els.hint.textContent = '瀏覽器不允許自動複製：請從視窗中手動複製'; showExportBox(text); }
}
const currentExport = (): string => { if (G.log) refreshSummary(G.log); return exportText(G.log!); };
els.exportBtn.onclick = () => { void copyOrShow(currentExport(), '紀錄已複製到剪貼簿'); };
els.exportBtn2.onclick = () => { void copyOrShow(currentExport(), '紀錄已複製到剪貼簿'); };
els.exportRecent.onclick = () => { void copyOrShow(recentText(), '最近幾局紀錄已複製到剪貼簿'); };
els.exportClose.onclick = () => { els.exportModal.hidden = true; };
els.sha.textContent = BUILD_SHA;

// 問卷：Q1～Q3、Q5 單選，Q4 與 Q5 理由為文字；答案隨時併入目前這局的紀錄並存進最近紀錄。
function buildSurvey(): void {
  const choices = ['是', '部分', '否'];
  els.survey.innerHTML = SURVEY_Q.map((q) => {
    if (q.kind === 'text') return `<fieldset><legend>${q.text}</legend><textarea id="q4" data-q="Q4" rows="3" maxlength="500"></textarea></fieldset>`;
    const opts = (q.id === 'Q5' ? ['是', '否'] : choices).map((c) => `<label class="opt"><input type="radio" name="${q.id}" value="${c}" data-q="${q.id}"> ${c}</label>`).join('');
    const why = q.id === 'Q5' ? '<textarea id="q5why" data-q="Q5_why" rows="2" maxlength="500" placeholder="為什麼？"></textarea>' : '';
    return `<fieldset><legend>${q.text}</legend><div class="opts">${opts}</div>${why}</fieldset>`;
  }).join('');
  els.survey.addEventListener('input', onSurvey);
  els.survey.addEventListener('change', onSurvey);
}
function onSurvey(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  const q = t.dataset.q as keyof ExpLog['survey'] | undefined;
  if (!q || !G.log) return;
  G.log.survey[q] = t.value;
  saveRecent(G.gameId, G.log);
}
function resetSurveyUi(): void {
  els.survey.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((r) => { r.checked = false; });
  els.survey.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((t) => { t.value = ''; });
}
buildSurvey();

const legendBtn = document.getElementById('legendBtn');
const legend = document.getElementById('legend');
if (legendBtn && legend) {
  legend.querySelector('tbody')!.innerHTML = ['heart', 'shield', 'poison', 'fission', 'regen', 'mirror'].map((k) =>
    `<tr><td><b>${ORGAN_UI[k].glyph}</b> ${ORGAN_UI[k].name}</td><td>${holdText([{ id: 0, key: k as Organ['key'], x: 0, y: 0 }])}</td><td>${INC_TEXT[k]}</td></tr>`).join('');
  legendBtn.onclick = () => { legend.hidden = !legend.hidden; };
}
window.addEventListener('resize', () => { layout(); draw(); });
if ('ResizeObserver' in window) new ResizeObserver(() => { layout(); draw(); }).observe(canvas);
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// 測試掛勾（只讀；不改規則）
(window as any).__proto = {
  get state() { return G.state; }, get ui() { return G.ui; }, get log() { return G.log; }, get lastEvents() { return G.lastEvents; }, stateHash,
  get modeId() { return G.modeId; }, get board() { return G.board; },
  anchorScreen: (k: number) => { const a = G.state!.board!.anchors[k]; const r = canvas.getBoundingClientRect(); return { x: r.left + sx(a.x), y: r.top + sy(a.y) }; },
  woundScreen: () => { const w = G.state?.wound; if (!w) return null; const g = woundGeom(w); return { a: { x: g.ax, y: g.ay }, b: { x: g.bx, y: g.by }, icons: g.icons, dpr, rgb: WOUND_RGB }; },
  partition: (i: number, j: number) => partitionOf(G.state!, i, j),
  organScreen: () => { const r = canvas.getBoundingClientRect(); return (G.state?.board?.organs ?? []).map((o) => ({ id: o.id, key: o.key, x: r.left + sx(o.x), y: r.top + sy(o.y) })); },
  exportText: () => currentExport(),
  setSkip: (v: boolean) => { G.skipAnim = v; },
  setMode: (m: ExpModeId, board: BoardKey = G.board) => switchTo(m, board),
};

// ---------------- PWA（子路徑獨立 scope） ----------------
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    els.updateBtn.onclick = () => { void reg.update(); els.hint.textContent = '檢查更新中…'; };
  });
  // 只在「已有舊版控制頁面、換成新版」時重新載入；第一次安裝時不重載，避免打斷正在進行的對局
  // 只認「自己的」service worker：同源若已裝了根網址版本的 SW（範圍較大、會先控制本頁），它被換掉不算本頁的更新，不重載
  const ownSw = new URL('./sw.js', location.href).href;
  const hadController = navigator.serviceWorker.controller?.scriptURL === ownSw;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}

G.freeSeed = randomSeed();
newGame();
