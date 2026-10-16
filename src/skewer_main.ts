// 串刺（core-skewer）研究片段入口：畫面、觸控、演出、紀錄。研究原型，非正式規則。
// 規則只在 src/skewer/rules.ts；預覽只呼叫 evalLine（穿到誰、碰不碰毒囊、合不合法），不算傷害（凍結驗收 K-4）。
// 結算一律走 commitCut → resolveTurn：揮刀（放開即出刀）、畫線（按「確認這一刀」）、點選（按確認）三模式共用同一個 resolveTurn（K-5、S-2）。
import { BOARDS, boardById, nextBoardId } from './skewer/boards.ts';
import { clampLine, evalLine, liveOrgans, newGame, organPos, pickCandidates, resolveTurn, MIN_LEN } from './skewer/rules.ts';
import type { BoardDef, Candidate, GameState, Line, LineEval, Pt, TurnRecord } from './skewer/rules.ts';
import { SURVEY_Q, exportText, newLog, reviewLine, roundLog, withRound } from './skewer/log.ts';
import type { PlayMode, SkewerLog } from './skewer/log.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  sha: $('sha'), modeSwipe: $<HTMLButtonElement>('modeSwipe'), modeDraw: $<HTMLButtonElement>('modeDraw'), actions: $('actions'), modePick: $<HTMLButtonElement>('modePick'), boardSel: $<HTMLSelectElement>('boardSel'),
  nextBtn: $<HTMLButtonElement>('nextBtn'), hpP: $('hpP'), hpE: $('hpE'), hpPBar: $('hpPBar'), hpEBar: $('hpEBar'), turn: $('turn'), info: $('info'),
  canvas: $<HTMLCanvasElement>('board'), pickRow: $('pickRow'), cancel: $<HTMLButtonElement>('cancel'), confirm: $<HTMLButtonElement>('confirm'),
  skip: $<HTMLButtonElement>('skip'), rulesBtn: $<HTMLButtonElement>('rulesBtn'), rules: $('rules'), rulesBoard: $('rulesBoard'), rulesClose: $<HTMLButtonElement>('rulesClose'),
  exportBtn: $<HTMLButtonElement>('exportBtn'), endPanel: $('endPanel'), endTitle: $('endTitle'), endSummary: $('endSummary'), survey: $<HTMLFormElement>('survey'),
  retry: $<HTMLButtonElement>('retry'), next2: $<HTMLButtonElement>('next2'), exportBtn2: $<HTMLButtonElement>('exportBtn2'),
  exportModal: $('exportModal'), exportBox: $<HTMLTextAreaElement>('exportBox'), exportClose: $<HTMLButtonElement>('exportClose'),
};
els.sha.textContent = BUILD_SHA;

const COLORS = { claw: '#d9822b', clawRing: '#ffb15e', heart: '#b8323f', heartRing: '#ff6b7a', sac: '#5f8a26', sacRing: '#b8e06a', plate: '#cfc3ad', body: '#3a2329', bodyEdge: '#7a4450' };
const GLYPH: Record<string, string> = { claw: '爪', heart: '心' };
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

type UI = 'IDLE' | 'DRAG' | 'PENDING' | 'ANIM' | 'END';
interface Anim { rec: TurnRecord; before: GameState; after: GameState; t0: number; dur: number }

const G = {
  mode: 'swipe' as PlayMode,
  board: BOARDS[0] as BoardDef,
  state: newGame(BOARDS[0]),
  ui: 'IDLE' as UI,
  line: null as Line | null,
  ev: null as LineEval | null,
  cands: [] as Candidate[],
  pick: -1,
  turnStart: 0,
  cancels: 0,
  log: newLog(BOARDS[0], 'swipe', BUILD_SHA),
  anim: null as Anim | null,
  lastRec: null as TurnRecord | null,
  skipAnim: false,
  /** 揮刀：起點與拖曳過程中的最大線長平方（判斷「拉回起點＝取消」與「輕觸＝什麼都不算」）。 */
  swipe: null as { a: Pt; max2: number } | null,
  /** 資訊欄暫留訊息（非法線原因、已取消）：顯示到 until。 */
  msg: null as { html: string; until: number } | null,
};
const MODE_NAME: Record<PlayMode, string> = { swipe: '揮刀模式', draw: '畫線模式', pick: '點選模式' };
/** 揮刀出刀的最短線長（棋盤單位；凍結驗收 S-3）。比規則的 MIN_LEN 長，防誤觸。 */
const SWIPE_MIN = 120;

// ---------------------------------------------------------------- 演出狀態（只影響畫面；不影響結算）
interface Piece { x: number; y: number; r: number; color: string; ang: number; side: 1 | -1; vx: number; vy: number; spin: number }
const FX_CFG = { HITSTOP_MS: 70, STEP_MS: 150, TAIL_MS: 600, MAX_MS: 1150, TRAIL_FADE_MS: 280, SLASH_MS: 260, SHAKE_MS: 300, PIECE_LIFE_MS: 700, FLASH_MS: 420 };
/** 震幅（CSS px）：空切 0，串 N＝4＋4N（S-5：串 3 > 串 1 > 空切）。 */
const shakeOf = (n: number) => (n === 0 ? 0 : 4 + 4 * n);
const fx = {
  trail: [] as Pt[], trailFade: null as number | null,
  parts: [] as Piece[], cutT0: 0,
  pieces: 0, flash: [] as string[], hitstopMs: 0, shake: 0,
};
function resetFx(): void { fx.trail = []; fx.trailFade = null; fx.parts = []; fx.pieces = 0; fx.flash = []; fx.hitstopMs = 0; fx.shake = 0; }

// ---------------------------------------------------------------- 座標轉換（棋盤 ↔ 畫面）
let dpr = 1, cw = 0, ch = 0, scale = 1, ox = 0, oy = 0;
function layout(): void {
  const r = els.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
  els.canvas.width = Math.round(cw * dpr); els.canvas.height = Math.round(ch * dpr);
  const xs = G.board.body.map((v) => v[0]), ys = G.board.body.map((v) => v[1]);
  const M = 24, x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, y0 = Math.min(...ys) - M, y1 = Math.max(...ys) + M;
  scale = Math.min(cw / (x1 - x0), ch / (y1 - y0));
  ox = (cw - (x1 - x0) * scale) / 2 - x0 * scale; oy = (ch - (y1 - y0) * scale) / 2 - y0 * scale;
}
const sx = (x: number) => ox + x * scale, sy = (y: number) => oy + y * scale;
const toBoard = (cx: number, cy: number): Pt => { const r = els.canvas.getBoundingClientRect(); return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale]; };

/** 無限直線在身體（凸多邊形）內的那一段（只供繪圖；浮點）。 */
function clipToBody(l: Line): [number, number, number, number] | null {
  const ax = l[0], ay = l[1], dx = l[2] - l[0], dy = l[3] - l[1];
  let lo = -Infinity, hi = Infinity;
  const body = G.board.body, n = body.length;
  // 求凸多邊形每條邊的半平面（頂點順序可為任意繞向，先判斷繞向）
  let area = 0; for (let i = 0; i < n; i++) { const p = body[i], q = body[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const sgn = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = body[i], q = body[(i + 1) % n];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    // 內側：sgn * cross(e, X - p) >= 0
    const c0 = sgn * (ex * (ay - p[1]) - ey * (ax - p[0])), c1 = sgn * (ex * dy - ey * dx);
    if (Math.abs(c1) < 1e-12) { if (c0 < 0) return null; continue; }
    const t = -c0 / c1;
    if (c1 > 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
  }
  if (!(lo < hi)) return null;
  return [ax + dx * lo, ay + dy * lo, ax + dx * hi, ay + dy * hi];
}

// ---------------------------------------------------------------- 繪圖
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void { ctx.beginPath(); ctx.arc(sx(x), sy(y), r * scale, 0, Math.PI * 2); }

function drawLine(ctx: CanvasRenderingContext2D, l: Line, style: string, width: number, dash: number[] = []): void {
  const seg = clipToBody(l);
  const p = seg ?? [l[0], l[1], l[2], l[3]];
  ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx(p[0]), sy(p[1])); ctx.lineTo(sx(p[2]), sy(p[3])); ctx.stroke(); ctx.restore();
}

function draw(now = performance.now()): void {
  const ctx = els.canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // 畫面震動（出刀頓格之後；震幅隨串數）
  const st = now - fx.cutT0 - fx.hitstopMs;
  if (fx.shake > 0 && st >= 0 && st < FX_CFG.SHAKE_MS) {
    const k = fx.shake * (1 - st / FX_CFG.SHAKE_MS);
    ctx.translate(Math.sin(st * 0.11) * k, Math.cos(st * 0.17) * k * 0.7);
  }
  const b = G.board;
  const s = G.anim ? G.anim.before : G.state;
  // 身體
  ctx.beginPath(); b.body.forEach((v, i) => (i ? ctx.lineTo(sx(v[0]), sy(v[1])) : ctx.moveTo(sx(v[0]), sy(v[1])))); ctx.closePath();
  ctx.fillStyle = COLORS.body; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = COLORS.bodyEdge; ctx.stroke();
  // 軌道與下一步淡影（只畫還活著的器官）
  const live = liveOrgans(b, s);
  for (const o of live) {
    if (o.track.length > 1) {
      ctx.save(); ctx.strokeStyle = o.kind === 'claw' ? '#d9822b55' : '#ff6b7a55'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
      ctx.beginPath(); o.track.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      if (o.mode === 'loop') ctx.closePath();
      ctx.stroke(); ctx.restore();
      for (const p of o.track) { ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 2.5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff40'; ctx.fill(); }
    }
    if (!s.result && s.turn < b.turnLimit) {
      const nx = organPos(o, s.turn + 1), cur = organPos(o, s.turn);
      if (nx[0] !== cur[0] || nx[1] !== cur[1]) {
        ctx.save(); ctx.globalAlpha = 0.35; circle(ctx, nx[0], nx[1], o.r); ctx.fillStyle = o.kind === 'claw' ? COLORS.claw : COLORS.heart; ctx.fill();
        ctx.globalAlpha = 0.8; ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
        ctx.save(); ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx(cur[0]), sy(cur[1])); ctx.lineTo(sx(nx[0]), sy(nx[1])); ctx.stroke(); ctx.restore();
      }
    }
  }
  // 骨板
  for (const p of b.plates) {
    ctx.save(); ctx.strokeStyle = COLORS.plate; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(6, p.t * 2 * scale);
    ctx.beginPath(); ctx.moveTo(sx(p.a[0]), sy(p.a[1])); ctx.lineTo(sx(p.b[0]), sy(p.b[1])); ctx.stroke();
    ctx.fillStyle = '#11151B'; ctx.font = `bold ${Math.max(10, 13 * scale * 2)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('骨', sx((p.a[0] + p.b[0]) / 2), sy((p.a[1] + p.b[1]) / 2)); ctx.restore();
  }
  // 候選線（點選模式）
  const pend = G.ui === 'DRAG' || G.ui === 'PENDING';
  if (G.mode === 'pick' && !G.anim && !s.result) {
    G.cands.forEach((c, k) => {
      const on = k === G.pick;
      drawLine(ctx, c.line, on ? '#ffffff' : '#ffffff59', on ? 3 : 1.5, on ? [] : [6, 5]);
      const seg = clipToBody(c.line);
      if (seg) {
        const tx = sx(seg[0]) + (sx(seg[2]) - sx(seg[0])) * 0.06, ty = sy(seg[1]) + (sy(seg[3]) - sy(seg[1])) * 0.06;
        ctx.save(); ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.fillStyle = on ? '#ffffff' : '#232935'; ctx.fill(); ctx.strokeStyle = '#ffffffaa'; ctx.stroke();
        ctx.fillStyle = on ? '#11151B' : '#E6D7BF'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(LETTERS[k], tx, ty); ctx.restore();
      }
    });
  }
  // 拖曳中／待確認的線
  if (G.mode === 'draw' && pend && G.line) {
    const bad = G.ev && !G.ev.legal;
    drawLine(ctx, G.line, bad ? '#ff5a5a' : '#ffffff', 3, bad ? [8, 6] : []);
  }
  // 揮刀：實際會切的直線（細虛線）；刀痕另外畫在最上層
  if (G.mode === 'swipe' && G.ui === 'DRAG' && G.line && G.ev) {
    drawLine(ctx, G.line, G.ev.legal ? '#ffffff66' : '#ff5a5aaa', 1.5, [6, 6]);
  }
  const hits = new Set(pend && G.ev ? G.ev.hits : []);
  const sacHit = new Set(pend && G.ev ? G.ev.sacs : []);
  // 毒囊
  for (const x of b.sacs) {
    circle(ctx, x.pos[0], x.pos[1], x.r); ctx.fillStyle = COLORS.sac; ctx.fill();
    ctx.lineWidth = sacHit.has(x.id) ? 4 : 2; ctx.strokeStyle = sacHit.has(x.id) ? '#ff3b3b' : COLORS.sacRing; ctx.stroke();
    label(ctx, x.pos, '毒', `碰到傷你${x.dmg}`, x.r);
  }
  // 器官
  const a = G.anim;
  const lit = a ? litCount(a, now) : 0;
  const at = a ? now - a.t0 : -1;
  for (const o of live) {
    // 被這一刀摘除的爪：頓格後改畫成兩片碎塊（drawPieces）
    if (a && at >= fx.hitstopMs && a.rec.removed.includes(o.id)) continue;
    const p = organPos(o, s.turn);
    circle(ctx, p[0], p[1], o.r); ctx.fillStyle = o.kind === 'claw' ? COLORS.claw : COLORS.heart; ctx.fill();
    // 受擊閃爍：頓格中所有被穿到的器官全白；之後心肉（未摘除）閃爍
    const hitNow = !!a && a.rec.hits.includes(o.id) && at >= 0 && (at < fx.hitstopMs || (fx.flash.includes(o.id) && at < FX_CFG.FLASH_MS && Math.floor(at / 70) % 2 === 0));
    if (hitNow) { ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = '#ffffff'; circle(ctx, p[0], p[1], o.r); ctx.fill(); ctx.restore(); }
    const k = a ? a.rec.hits.indexOf(o.id) : -1;
    const on = hits.has(o.id) || (k >= 0 && k < lit);
    ctx.lineWidth = on ? 5 : 2; ctx.strokeStyle = on ? '#ffffff' : o.kind === 'claw' ? COLORS.clawRing : COLORS.heartRing; ctx.stroke();
    label(ctx, p, GLYPH[o.kind], o.kind === 'claw' ? `值${o.value}·攻${o.attack}` : `值${o.value}`, o.r);
    if (k >= 0 && k < lit) {
      ctx.save(); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(k + 1), sx(p[0]) + o.r * scale, sy(p[1]) - o.r * scale); ctx.restore();
    }
  }
  drawPieces(ctx, now);
  if (a) drawAnimOverlay(ctx, a, now, lit);
  drawTrail(ctx, now);
}

/** 跟手的刀痕：實際 pointer 軌跡（棋盤座標），越新越粗；放開後 TRAIL_FADE_MS 內淡出。 */
function drawTrail(ctx: CanvasRenderingContext2D, now: number): void {
  const t = fx.trail; if (t.length < 2) return;
  const alpha = fx.trailFade === null ? 1 : Math.max(0, 1 - (now - fx.trailFade) / FX_CFG.TRAIL_FADE_MS);
  if (alpha <= 0) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#ffffff';
  for (let i = 1; i < t.length; i++) {
    const k = i / (t.length - 1);
    ctx.globalAlpha = alpha * (0.25 + 0.75 * k); ctx.lineWidth = 1 + 7 * k;
    ctx.beginPath(); ctx.moveTo(sx(t[i - 1][0]), sy(t[i - 1][1])); ctx.lineTo(sx(t[i][0]), sy(t[i][1])); ctx.stroke();
  }
  ctx.restore();
}
/** 被摘除的爪沿刀線裂成兩半，頓格後往刀線兩側飛散、受重力下墜、淡出。 */
function drawPieces(ctx: CanvasRenderingContext2D, now: number): void {
  const t = now - fx.cutT0 - fx.hitstopMs;
  if (!fx.parts.length || t >= FX_CFG.PIECE_LIFE_MS) return;
  const u = Math.max(0, t);
  for (const q of fx.parts) {
    const x = q.x + q.vx * u, y = q.y + q.vy * u + 0.0012 * u * u;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - u / FX_CFG.PIECE_LIFE_MS);
    ctx.translate(sx(x), sy(y)); ctx.rotate(q.ang + q.spin * u);
    // 半圓：side=1 在刀線法線正側（局部 y>0），side=-1 在負側
    ctx.beginPath(); ctx.arc(0, 0, q.r * scale, q.side === 1 ? 0 : Math.PI, q.side === 1 ? Math.PI : Math.PI * 2); ctx.closePath();
    ctx.fillStyle = q.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#ffffffcc'; ctx.stroke();
    ctx.restore();
  }
}

function label(ctx: CanvasRenderingContext2D, p: Pt, glyph: string, sub: string, r: number): void {
  ctx.save(); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(11, Math.round(r * scale * 0.9))}px system-ui, "PingFang TC"`; ctx.fillText(glyph, sx(p[0]), sy(p[1]));
  ctx.font = '10px system-ui, "PingFang TC"'; ctx.fillStyle = '#E6D7BFcc'; ctx.textBaseline = 'top'; ctx.fillText(sub, sx(p[0]), sy(p[1]) + r * scale + 2); ctx.restore();
}

// ---------------------------------------------------------------- 演出（出刀後；可跳過，不影響結果）
// 時間軸：出刀瞬間沿整條線一道刀光＋頓格 HITSTOP_MS → 碎塊飛散、心肉閃爍、畫面震動 → 器官依序亮起「串 N」→「×N」→ 傷害。總長 ≤ MAX_MS（S-6）。
const stepOf = (n: number) => Math.min(FX_CFG.STEP_MS, (FX_CFG.MAX_MS - FX_CFG.HITSTOP_MS - FX_CFG.TAIL_MS) / Math.max(1, n));
const animDur = (n: number) => Math.min(FX_CFG.MAX_MS, FX_CFG.HITSTOP_MS + Math.max(1, n) * stepOf(n) + FX_CFG.TAIL_MS);
function litCount(a: Anim, now: number): number {
  const t = now - a.t0 - fx.hitstopMs; if (t < 0) return 0;
  return Math.min(a.rec.hits.length, Math.floor(t / stepOf(a.rec.hits.length)) + 1);
}
/** 出刀當下建立本刀的演出紀錄（fx.pieces／flash／hitstopMs／shake，供測試讀取）。 */
function startFx(rec: TurnRecord, before: GameState, t0: number): void {
  const l = rec.line; const dx = l[2] - l[0], dy = l[3] - l[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, ang = Math.atan2(dy, dx);
  fx.cutT0 = t0; fx.hitstopMs = FX_CFG.HITSTOP_MS; fx.shake = shakeOf(rec.hits.length);
  fx.parts = [];
  for (const id of rec.removed) {
    const o = G.board.organs.find((x) => x.id === id)!; const p = organPos(o, before.turn);
    for (const side of [1, -1] as const) {
      // 往刀線法線兩側彈開 0.42 單位/ms、沿刀線方向帶 0.12、略往上 0.15；旋轉 ±0.006 rad/ms；重力 0.0012 單位/ms²
      fx.parts.push({ x: p[0], y: p[1], r: o.r, color: COLORS.claw, ang, side, vx: nx * side * 0.42 + ux * 0.12, vy: ny * side * 0.42 + uy * 0.12 - 0.15, spin: side * 0.006 });
    }
  }
  fx.pieces = fx.parts.length;
  fx.flash = rec.hits.filter((id) => !rec.removed.includes(id));
}
function drawAnimOverlay(ctx: CanvasRenderingContext2D, a: Anim, now: number, lit: number): void {
  const t0 = now - a.t0;
  // 刀光：頓格中最亮最粗，之後收細淡出，最後留一條細線
  const sl = t0 < fx.hitstopMs ? 1 : Math.max(0, 1 - (t0 - fx.hitstopMs) / FX_CFG.SLASH_MS);
  if (sl > 0) { ctx.save(); ctx.globalAlpha = sl; drawLine(ctx, a.rec.line as unknown as Line, '#fff6d6', 4 + 12 * sl); ctx.restore(); drawLine(ctx, a.rec.line as unknown as Line, '#ffffff', 3); }
  else drawLine(ctx, a.rec.line as unknown as Line, '#ffffffaa', 2);
  const t = t0 - fx.hitstopMs, n = a.rec.hits.length, STEP_MS = stepOf(n);
  if (t < 0) return;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px system-ui, "PingFang TC"';
  const txt = n === 0 ? '空切' : `串 ${lit}`;
  ctx.fillText(txt, cw / 2, 6);
  if (n > 0 && t >= n * STEP_MS) {
    ctx.font = 'bold 28px system-ui'; ctx.fillStyle = '#ffd166'; ctx.fillText(`×${a.rec.mult}`, cw / 2, 32);
  }
  if (t >= n * STEP_MS + 300) {
    ctx.font = 'bold 20px system-ui, "PingFang TC"'; ctx.fillStyle = '#ff8a8a';
    ctx.fillText(`怪物 −${a.rec.damage}${a.rec.poisonDmg ? `　毒囊 你 −${a.rec.poisonDmg}` : ''}${a.rec.clawDmg ? `　爪 你 −${a.rec.clawDmg}` : ''}`, cw / 2, 64);
  }
  ctx.restore();
}
let looping = false;
function kick(): void { if (!looping) { looping = true; requestAnimationFrame(loop); } }
function loop(): void {
  const now = performance.now();
  if (G.anim && (G.skipAnim || now - G.anim.t0 >= G.anim.dur)) finishAnim();
  if (fx.trailFade !== null && now - fx.trailFade >= FX_CFG.TRAIL_FADE_MS) { fx.trail = []; fx.trailFade = null; }
  draw(now);
  const partsAlive = fx.parts.length > 0 && now - fx.cutT0 - fx.hitstopMs < FX_CFG.PIECE_LIFE_MS;
  const shaking = fx.shake > 0 && now - fx.cutT0 - fx.hitstopMs < FX_CFG.SHAKE_MS;
  if (G.anim || fx.trailFade !== null || partsAlive || shaking) requestAnimationFrame(loop); else looping = false;
}
/** 刀痕淡出：rAF 畫漸淡；計時器保底清空（rAF 暫停時也不會殘留）。 */
function fadeTrail(): void {
  const t = performance.now(); fx.trailFade = t; kick();
  setTimeout(() => { if (fx.trailFade === t) { fx.trail = []; fx.trailFade = null; draw(); } }, FX_CFG.TRAIL_FADE_MS + 10);
}
function finishAnim(): void {
  const a = G.anim; if (!a) return;
  G.anim = null; G.state = a.after; G.lastRec = a.rec;
  if (G.state.result) { G.ui = 'END'; showEnd(); }
  else startTurn();
  refresh();
}

// ---------------------------------------------------------------- 回合流程
function startTurn(): void {
  G.ui = 'IDLE'; G.line = null; G.ev = null; G.pick = -1; G.cancels = 0; G.turnStart = performance.now();
  G.cands = G.mode === 'pick' ? pickCandidates(G.board, G.state) : [];
  renderPickRow();
}
function newGameUI(boardId = G.board.id, mode = G.mode): void {
  G.board = boardById(boardId); G.mode = mode; G.state = newGame(G.board); G.anim = null; G.lastRec = null; G.swipe = null; G.msg = null; resetFx();
  G.log = newLog(G.board, G.mode, BUILD_SHA);
  els.endPanel.hidden = true; els.endTitle.textContent = ''; els.endSummary.innerHTML = ''; els.survey.innerHTML = ''; // 上一局的結算不能留在 DOM（K-4）
  els.boardSel.value = G.board.id;
  els.modeSwipe.setAttribute('aria-pressed', String(mode === 'swipe')); els.modeDraw.setAttribute('aria-pressed', String(mode === 'draw')); els.modePick.setAttribute('aria-pressed', String(mode === 'pick'));
  els.actions.style.display = mode === 'swipe' ? 'none' : ''; // 揮刀模式沒有確認／取消鈕（S-1）
  layout(); startTurn(); refresh();
}
function setPending(line: Line | null, ev: LineEval | null, ui: UI): void { G.line = line; G.ev = ev; G.ui = ui; refresh(); }

/** 唯一的出刀路徑：三模式都在這裡呼叫 resolveTurn（S-2）。 */
function commitCut(line: Line): void {
  const before = G.state;
  const { state, rec } = resolveTurn(G.board, before, line);
  const offered = G.mode === 'pick' ? G.cands.map((c) => c.line) : null;
  const t0 = performance.now();
  G.log = withRound(G.log, roundLog(rec, t0 - G.turnStart, G.cancels, offered, G.mode === 'pick' ? G.pick : null), state);
  startFx(rec, before, t0);
  G.anim = { rec, before, after: state, t0, dur: animDur(rec.hits.length) };
  G.ui = 'ANIM'; refresh();
  if (G.skipAnim) finishAnim(); else kick();
}
function confirmCut(): void {
  if (G.ui !== 'PENDING' || !G.line || !G.ev || !G.ev.legal) return;
  commitCut(G.line);
}
function cancelCut(): void {
  if (G.ui !== 'PENDING') return;
  G.cancels++; G.pick = -1; setPending(null, null, 'IDLE'); renderPickRow();
}

// ---------------------------------------------------------------- 文字（不含傷害或倍率：K-4）
const nameOf = (id: string) => G.board.organs.find((o) => o.id === id)?.name ?? G.board.sacs.find((x) => x.id === id)?.name ?? id;
function esc(t: string): string { return t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!); }
function infoHtml(): string {
  const s = G.state;
  const prev = G.lastRec ? `<div class="rev">結算回顧｜${esc(reviewLine(G.board, G.lastRec))}</div>` : '';
  if (G.ui === 'ANIM') return '<div>結算中…（可按「跳過演出」）</div>';
  if (G.ui === 'END') return prev;
  const msg = G.msg && performance.now() < G.msg.until ? G.msg.html : '';
  if (G.mode === 'swipe' && G.ui === 'DRAG') {
    const hint = '<div class="hint">拉回起點放開＝取消</div>';
    const sw = G.swipe;
    if (!G.ev) return sw && sw.max2 >= SWIPE_MIN * SWIPE_MIN ? `<div class="rev">放開＝取消這一刀</div>${hint}` : `<div>劃長一點再放開</div>${hint}`;
    if (!G.ev.legal) return `<div class="bad">✕ ${esc(G.ev.reason ?? '非法線')}（放開不會出刀）</div>${hint}`;
    const hits = G.ev.hits.length ? `穿到：<span class="hit">${G.ev.hits.map(nameOf).join('、')}</span>` : '空切：沒有穿到器官';
    const sac = G.ev.sacs.length ? '<div class="poison">⚠ 會碰到毒囊（在你身上爆開）</div>' : '';
    return `<div>${hits}</div>${sac}${hint}`;
  }
  if ((G.ui === 'DRAG' || G.ui === 'PENDING') && G.ev) {
    if (!G.ev.legal) return `<div class="bad">✕ ${esc(G.ev.reason ?? '非法線')}</div>`;
    const hits = G.ev.hits.length ? `穿到：<span class="hit">${G.ev.hits.map(nameOf).join('、')}</span>` : '空切：沒有穿到器官';
    const sac = G.ev.sacs.length ? '<div class="poison">⚠ 會碰到毒囊（在你身上爆開）</div>' : '';
    return `<div>${hits}</div>${sac}`;
  }
  const how = G.mode === 'swipe' ? '手指劃過怪物、放開就出刀（可空切）。淡影＝下一步位置。'
    : G.mode === 'draw' ? '拖一條直線貫穿身體（可空切）。淡影＝下一步位置。' : '從下方選一條線，再按確認。淡影＝下一步位置。';
  return `${msg}${prev}<div>第 ${s.turn} 回合：${how}</div>`;
}
function renderPickRow(): void {
  els.pickRow.innerHTML = '';
  if (G.mode !== 'pick') {
    const d = document.createElement('div'); d.className = 'hintTxt';
    d.textContent = G.mode === 'swipe' ? '像切水果一樣劃過怪物，放開就切下去（不用按確認）；拉回起點放開＝取消。' : '在怪物身上按住拖曳畫線；放開後確認或取消。';
    els.pickRow.appendChild(d); return;
  }
  G.cands.forEach((c, k) => {
    const bt = document.createElement('button'); bt.id = `cand${k}`; bt.textContent = `線 ${LETTERS[k]}`;
    bt.className = k === G.pick ? 'on' : '';
    bt.onclick = () => {
      if (G.ui !== 'IDLE' && G.ui !== 'PENDING') return;
      if (G.ui === 'PENDING' && G.pick !== k) G.cancels++;
      G.pick = k; setPending(c.line, c.ev, 'PENDING'); renderPickRow();
    };
    els.pickRow.appendChild(bt);
  });
}
function refresh(): void {
  const s = G.anim ? G.anim.before : G.state;
  els.hpP.textContent = `${Math.max(0, s.hpP)}/${G.board.hpP}`; els.hpE.textContent = `${Math.max(0, s.hpE)}/${G.board.hpE}`;
  els.hpPBar.style.width = `${Math.max(0, (100 * s.hpP) / G.board.hpP)}%`; els.hpEBar.style.width = `${Math.max(0, (100 * s.hpE) / G.board.hpE)}%`;
  els.turn.textContent = `回合 ${s.turn}/${G.board.turnLimit}`;
  els.info.innerHTML = infoHtml();
  els.confirm.disabled = !(G.ui === 'PENDING' && G.ev && G.ev.legal);
  els.cancel.disabled = G.ui !== 'PENDING';
  els.skip.disabled = G.ui !== 'ANIM';
  els.rulesBoard.textContent = `本盤「${G.board.name}」：怪物 HP ${G.board.hpE}、你 HP ${G.board.hpP}、回合上限 ${G.board.turnLimit}。`
    + G.board.organs.map((o) => `${o.name} 值 ${o.value}${o.attack ? `、攻 ${o.attack}` : ''}`).join('；') + '；'
    + G.board.sacs.map((x) => `${x.name} 碰到傷你 ${x.dmg}`).join('；') + (G.board.plates.length ? '；骨板擋線。' : '。');
  draw();
}

// ---------------------------------------------------------------- 結束、問卷、紀錄
function showEnd(): void {
  const s = G.state;
  els.endTitle.textContent = s.result === 'win' ? `勝利（第 ${s.turn} 回合，你剩 ${s.hpP}）` : s.loseReason === 'turns' ? `失敗：回合用完（怪物剩 ${s.hpE}）` : '失敗：你倒下了';
  const rows = s.history.map((r) => `<tr><td>${r.turn}</td><td>${r.hits.length ? r.hits.map(nameOf).join('→') : '空切'}</td><td>${r.hits.length ? `(${r.valueSum})×${r.mult}＝${r.damage}` : '0'}</td><td>${Math.max(0, r.hpEAfter)}</td><td>${Math.max(0, r.hpPAfter)}</td></tr>`).join('');
  els.endSummary.innerHTML = `<p class="basis">${esc(G.board.name)}・${MODE_NAME[G.mode]}</p><table class="sum"><thead><tr><th>回合</th><th>穿到</th><th>傷害</th><th>怪物</th><th>你</th></tr></thead><tbody>${rows}</tbody></table>`;
  els.survey.innerHTML = SURVEY_Q.map((q) => `<fieldset><legend>${esc(q.text)}</legend><div class="opts">${q.opts.map((o) => `<label class="opt"><input type="radio" name="${q.id}" value="${esc(o)}">${esc(o)}</label>`).join('')}</div></fieldset>`).join('');
  els.endPanel.hidden = false;
}
els.survey.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t && (t.name === 'q1' || t.name === 'q2' || t.name === 'q3')) G.log = { ...G.log, survey: { ...G.log.survey, [t.name]: t.value } };
});
async function copyLog(): Promise<void> {
  const text = exportText(G.log);
  try { await navigator.clipboard.writeText(text); els.info.innerHTML = '<div class="rev">紀錄已複製到剪貼簿。</div>'; }
  catch { els.exportBox.value = text; els.exportModal.hidden = false; }
}

// ---------------------------------------------------------------- 事件
// ---- 揮刀（S-1～S-4、S-11）：按下開始、移動更新刀痕與預覽高亮、放開即出刀；不經 PENDING
function swipeLineTo(p: Pt): { l: Line; d2: number } {
  const a = G.swipe!.a; const l = clampLine([a[0], a[1], p[0], p[1]]);
  return { l, d2: (l[2] - l[0]) ** 2 + (l[3] - l[1]) ** 2 };
}
function swipeDown(e: PointerEvent): void {
  if (G.ui !== 'IDLE') return;
  els.canvas.setPointerCapture(e.pointerId);
  const p = toBoard(e.clientX, e.clientY);
  G.swipe = { a: p, max2: 0 }; G.msg = null;
  fx.trail = [p]; fx.trailFade = null;
  setPending(null, null, 'DRAG');
}
function swipeMove(e: PointerEvent): void {
  if (G.ui !== 'DRAG' || !G.swipe) return;
  const p = toBoard(e.clientX, e.clientY);
  fx.trail.push(p); if (fx.trail.length > 160) fx.trail.shift();
  const { l, d2 } = swipeLineTo(p);
  G.swipe.max2 = Math.max(G.swipe.max2, d2);
  if (d2 < SWIPE_MIN * SWIPE_MIN) setPending(null, null, 'DRAG');
  else setPending(l, evalLine(G.board, G.state, l), 'DRAG');
}
function swipeUp(e: PointerEvent, cancelled: boolean): void {
  if (G.ui !== 'DRAG' || !G.swipe) return;
  const p = toBoard(e.clientX, e.clientY);
  const { l, d2 } = swipeLineTo(p);
  const max2 = Math.max(G.swipe.max2, d2);
  G.swipe = null; fadeTrail();
  const now = performance.now();
  if (cancelled || d2 < SWIPE_MIN * SWIPE_MIN) {
    // 曾劃到 ≥ SWIPE_MIN 再拉回＝取消（記一次，S-11）；從頭到尾都很短（輕觸、抖動）＝什麼都不算（S-3）
    if (!cancelled && max2 >= SWIPE_MIN * SWIPE_MIN) { G.cancels++; G.msg = { html: '<div class="rev">已取消這一刀</div>', until: now + 1200 }; setTimeout(refresh, 1250); }
    setPending(null, null, 'IDLE'); return;
  }
  const ev = evalLine(G.board, G.state, l);
  if (!ev.legal) {
    G.msg = { html: `<div class="bad">✕ ${esc(ev.reason ?? '非法線')}（沒有出刀）</div>`, until: now + 1500 }; setTimeout(refresh, 1550);
    setPending(null, null, 'IDLE'); return;
  }
  G.line = l; G.ev = ev;
  commitCut(l);
}
els.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false }); // 舊版 iOS Safari 保險：拖曳時不捲動（canvas 另有 touch-action:none）
els.canvas.addEventListener('pointerdown', (e) => {
  if (G.mode === 'swipe') { swipeDown(e); return; }
  if (G.mode !== 'draw' || (G.ui !== 'IDLE' && G.ui !== 'PENDING')) return;
  if (G.ui === 'PENDING') G.cancels++;
  els.canvas.setPointerCapture(e.pointerId);
  const p = toBoard(e.clientX, e.clientY);
  G.line = clampLine([p[0], p[1], p[0], p[1]]); G.ev = null; G.ui = 'DRAG'; refresh();
});
els.canvas.addEventListener('pointermove', (e) => {
  if (G.mode === 'swipe') { swipeMove(e); return; }
  if (G.ui !== 'DRAG' || !G.line) return;
  const p = toBoard(e.clientX, e.clientY);
  const l = clampLine([G.line[0], G.line[1], p[0], p[1]]);
  const short = (l[2] - l[0]) ** 2 + (l[3] - l[1]) ** 2 < MIN_LEN * MIN_LEN;
  setPending(l, short ? null : evalLine(G.board, G.state, l), 'DRAG');
});
const endDrag = () => {
  if (G.ui !== 'DRAG') return;
  if (!G.line || !G.ev) { setPending(null, null, 'IDLE'); return; }
  setPending(G.line, G.ev, 'PENDING');
};
els.canvas.addEventListener('pointerup', (e) => { if (G.mode === 'swipe') swipeUp(e, false); else endDrag(); });
els.canvas.addEventListener('pointercancel', (e) => { if (G.mode === 'swipe') swipeUp(e, true); else endDrag(); });
// 用 addEventListener：既有 fork.test.ts T-6 以確認鈕的 onclick 指派辨識研究引擎入口檔（要求恰一個引擎 act 呼叫）；串刺不用研究引擎，改走該測試的「非入口檔」分支（仍檢查不得呼叫 act／replay／newBattle）
els.confirm.addEventListener('click', confirmCut);
els.cancel.onclick = cancelCut;
els.skip.onclick = () => { if (G.anim) finishAnim(); };
els.modeSwipe.onclick = () => newGameUI(G.board.id, 'swipe');
els.modeDraw.onclick = () => newGameUI(G.board.id, 'draw');
els.modePick.onclick = () => newGameUI(G.board.id, 'pick');
for (const b of BOARDS) { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; els.boardSel.appendChild(o); }
els.boardSel.onchange = () => newGameUI(els.boardSel.value);
els.nextBtn.onclick = () => newGameUI(nextBoardId(G.board.id));
els.next2.onclick = () => newGameUI(nextBoardId(G.board.id));
els.retry.onclick = () => newGameUI(G.board.id);
els.rulesBtn.onclick = () => { els.rules.hidden = !els.rules.hidden; };
els.rulesClose.onclick = () => { els.rules.hidden = true; };
els.exportBtn.onclick = () => { void copyLog(); };
els.exportBtn2.onclick = () => { void copyLog(); };
els.exportClose.onclick = () => { els.exportModal.hidden = true; };
window.addEventListener('resize', () => { layout(); draw(); });

// ---------------------------------------------------------------- 測試掛勾（唯讀查詢＋跳過演出開關）
(window as unknown as { __skewer: unknown }).__skewer = {
  get state() { return G.state; }, get ui() { return G.ui; }, get mode() { return G.mode; }, get board() { return G.board; },
  get log() { return G.log; }, get preview() { return G.ev; }, get line() { return G.line; }, get cancels() { return G.cancels; },
  /** 演出紀錄（S-4、S-5）：trail＝目前刀痕點（棋盤座標）；其餘為最近一刀的數值。 */
  get fx() { return { trail: fx.trail.map((p) => [p[0], p[1]]), pieces: fx.pieces, flash: [...fx.flash], hitstopMs: fx.hitstopMs, shake: fx.shake }; },
  cands: () => G.cands.map((c) => ({ line: [...c.line], hits: [...c.ev.hits], sacs: [...c.ev.sacs] })),
  toScreen: (x: number, y: number) => { const r = els.canvas.getBoundingClientRect(); return { x: r.left + sx(x), y: r.top + sy(y) }; },
  organScreen: () => { const r = els.canvas.getBoundingClientRect(); return liveOrgans(G.board, G.state).map((o) => { const p = organPos(o, G.state.turn); return { id: o.id, x: r.left + sx(p[0]), y: r.top + sy(p[1]), r: o.r * scale }; }); },
  ghosts: () => (G.state.result || G.state.turn >= G.board.turnLimit ? [] : liveOrgans(G.board, G.state).map((o) => ({ id: o.id, pos: organPos(o, G.state.turn + 1) }))),
  bodyScreen: () => { const r = els.canvas.getBoundingClientRect(); return G.board.body.map((v) => ({ x: r.left + sx(v[0]), y: r.top + sy(v[1]) })); },
  setSkip: (v: boolean) => { G.skipAnim = v; },
  newGame: (id: string, mode: PlayMode) => newGameUI(id, mode),
};

// ---------------------------------------------------------------- PWA（子路徑獨立 scope）
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./sw.js', { scope: './' });
  const ownSw = new URL('./sw.js', location.href).href;
  const hadController = navigator.serviceWorker.controller?.scriptURL === ownSw;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}

newGameUI(BOARDS[0].id, 'swipe');
