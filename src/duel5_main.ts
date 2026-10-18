// duel v0.5「千節蛇」（子路徑 duel5/，the-cut docs/fusion/DUEL_V05_SNAKE.md＋補述 1，DL-089／DL-091）：以 duel4（v0.4 前線推進）為起點，
// 加上開局選怪獸（龍／千節蛇）、技能（龍＝蛻生、蛇＝穿刺）、蛇牙、戰鬥看得懂（器官保留與亮起、攻擊連線、大字級跳字、開戰前器官對照）、?cut= 切割秒數。
// 以下是 v0.4 的說明（沿用）：
// duel v0.4「前線推進」（子路徑 duel4/，the-cut docs/fusion/DUEL_V04_FRONT.md＋補述 1／2，DL-086）：以 duel3（v0.3 手感與可讀性）為起點。
// - 前線推進（B）：切下對方器官 push +1／被切 −1（±4），起刀區延伸（規則 src/rtcut/rules.ts 的 inStartZone）；前線帶跟著移動。
// - 範圍顯示（C）：按住時畫「起刀區往外 420」淡色輪廓。直線預覽另把直線碰不到（不被擋就切得到＝src/rtcut/reach.ts）的對方器官調暗；
//   即時劃刀手指能繞路，只畫輪廓、不調暗（DL-087 選 A、補述 3）。
// - 流程與回饋：開場 3-2-1 倒數、教學場 AI 等玩家先出手、再生倒數圈與長出動畫、縫合槽位與吸附、切中爽感（刀痕發光、hit-stop）、
//   敵我分色（被切只在該器官爆紅光）、結果字一次一個、縫合後展示新身體再按「下一位對手」。
// - 戰鬥期數值、器官效果、AI 打分不變。規則：切割期 src/rtcut/rules.ts；戰鬥期 src/cutbattle/battle.ts；征途 src/cutbattle/campaign.ts。
import { COOLDOWN_STEPS, FPS, FREE_MIN_SPEED, TAP_LEN, KIND_ZH, LOCK_STEPS, MAX_LEN, MIN_LEN, REGEN_STEPS, clampLine, countSide, endStep, isLocked, isReady, resolveStrike, startOk, step } from './rtcut/rules.ts';
import { reachOf, zoneOf } from './rtcut/reach.ts';
import { Slicer } from './rtcut/freehand.ts';
import type { PtrEv, PtrKind } from './rtcut/freehand.ts';
import type { Beast, GameEvent, GameState, Kind, Line, Side, StrikeResult, V } from './rtcut/rules.ts';
import { BT, simulateBattle } from './cutbattle/battle.ts';
import type { BattleEvent, BattleResult } from './cutbattle/battle.ts';
import { CB, SNAP_DIST, battleSeed, blueOrgans, parseCutSeconds, finishStage, fightersOf, matchFor, newCampaign, pickStitch, placeStitch, snapSlot, stitchSlots } from './cutbattle/campaign.ts';
import type { Campaign, PlaceReject } from './cutbattle/campaign.ts';
import { BODY2, R3, RECTS } from './cutbattle/duel3_board.ts';
import { SNAKE, SNAKE_ARC, SNAKE_POLY, snakeAt } from './cutbattle/snake_board.ts';
import type { Kind as ArtKind } from './art/sprites.ts';
import { drawBlade, drawOrganSprite, drawSlot, drawSuture, loadAssets, loadLog, playFx2, shake2, splitHalves } from './art/sprites.ts';
import type { Assets, Fx2 } from './art/sprites.ts';
import { CUT_DIM, PROVISIONAL, drawOrganV3, drawScene, drawTrail, drawTutorialHand, playSplit } from './duel3_art.ts';
import type { OrganStateV3, SplitFx, TrailPt } from './duel3_art.ts';

declare const __BUILD_SHA__: string;
const BUILD_SHA = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
const W = 700, H = 1000, STEP_MS = 1000 / FPS;
const R = R3;                                   // 判定半徑＝顯示半徑（DF-04）
const FREE_LAG_MS = 2 * STEP_MS;                // 即時劃刀：模擬晚 2 步跑，確保第 k 步的指標事件都到齊才結算（事件晚到才不會跨步，DF-02）
const SLOW_MS = 80, SLOW_RATE = 0.25;           // 切除瞬間畫面放慢（只影響畫面時鐘）
const HITSTOP_MS = 50;                          // 切中瞬間畫面停頓（只影響畫面時鐘；DUEL_V04_FRONT 三-4）
const FRONT = { unit: 60, max: 4 };             // 前線推進【試玩值】：每 1 推進延伸 60、上下限 ±4（DUEL_V04_FRONT 一）
const COUNTDOWN_MS = 2400;                      // 開場 3-2-1 倒數（三-1）
const SHOWCASE_MS = 1500;
const BATTLE_DIM = Object.freeze({ alpha: 0.2, saturation: 0.3 });   // duel5 戰鬥期本體調暗（比切割期的 CUT_DIM 0.45 更暗：戰鬥時只看器官）
const KO_HOLD_MS = 700;                         // duel5：「清空！」至少完整顯示 600ms 才進戰鬥（FS-06）
const MATCHUP_MS = 1200;                        // duel5：開戰前器官對照（FS-06）
const NUM_GAP_MS = 80;                          // duel5：雙方跳字錯開（只改畫面，FS-06）
const NUM_SIZE = 36, NUM_CRIT = 46;             // duel5：跳字世界字級（393 寬縮放 0.5614 → 約 20／26 CSS px，≥18；補述 1 第 10 條）                       // 縫合後展示新身體，之後才出現「下一位對手」（三-7）
const FRONT_ANIM_MS = 300;                      // 前線帶移動動畫（一）
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  canvas: $<HTMLCanvasElement>('scene'), sha: $('sha'), stage: $('stage'), phase: $('phase'), clock: $('clock'),
  meBar: $('meBar'), meShield: $('meShield'), meTxt: $('meTxt'), foeBar: $('foeBar'), foeShield: $('foeShield'), foeTxt: $('foeTxt'),
  cd: $('cd'), info: $('info'), tip: $('tip'), inputMode: $<HTMLButtonElement>('inputMode'), tut: $('tut'), tutText: $('tutText'), tutSkip: $<HTMLButtonElement>('tutSkip'),
  sound: $<HTMLButtonElement>('sound'), fast: $<HTMLButtonElement>('fast'), restart: $<HTMLButtonElement>('restart'),
  contrib: $('contrib'), contribTitle: $('contribTitle'), contribBody: $('contribBody'), contribNext: $<HTMLButtonElement>('contribNext'),
  pick: $('pick'), pickOpts: $('pickOpts'),
  end: $('end'), endTitle: $('endTitle'), endBody: $('endBody'), again: $<HTMLButtonElement>('again'),
  loading: $('loading'), loadErr: $('loadErr'), loadMsg: $('loadMsg'), loadLog: $('loadLog'), retry: $<HTMLButtonElement>('retry'),
  nextFoe: $<HTMLButtonElement>('nextFoe'),
  beast: $('beast'), beastDragon: $<HTMLButtonElement>('beastDragon'), beastSnake: $<HTMLButtonElement>('beastSnake'), skill: $<HTMLButtonElement>('skill'), matchup: $('matchup'),
};
els.sha.textContent = BUILD_SHA;

// ---------------------------------------------------------------- 說明文字（點器官、首次出現、選縫合共用）
export const DESC: Record<Kind, { role: string; line: string }> = {
  claw: { role: '攻擊手', line: `爪：每 ${BT.CLAW_EVERY / 1000} 秒攻擊一次，造成 ${BT.CLAW_DMG}` },
  heart: { role: '生命', line: `心：血量上限 +${BT.HEART_HP}，每 ${BT.HEART_EVERY / 1000} 秒回 ${BT.HEART_HEAL}` },
  eye: { role: '暴擊', line: `眼：我方爪暴擊率 +${BT.EYE_CRIT * 100}%（上限 ${BT.CRIT_CAP * 100}%），暴擊 ×${BT.CRIT_MULT}` },
  poison: { role: '持續傷害', line: `毒：每 ${BT.POISON_EVERY / 1000} 秒讓對手疊 1 層毒，每層每秒 1 傷害` },
  bone: { role: '護盾', line: `骨：開戰提供 ${BT.BONE_SHIELD} 護盾，先吸收傷害` },
  fang: { role: '蛇的專屬', line: '蛇牙：只要還在，己方每個毒每次疊 2 層（有幾顆都一樣）' },
};
/** 蛇牙沒有 art-kit 素材：畫面暫代用爪的圖（DUEL_V05_SNAKE 二：GPT 素材到之前用暫代）。 */
const AK = (k: Kind): ArtKind => (k === 'fang' ? 'claw' : k);
const CUT_S = parseCutSeconds(new URLSearchParams(location.search).get('cut'));   // ?cut=（DL-091）：20～60 秒，其他一律 30
const BEAST_KEY = 'duel5-beast';
const BEAST_INFO: Record<Beast, { name: string; organs: string; skill: string; style: string }> = {
  dragon: { name: '幽光龍', organs: '爪、心、眼、毒、骨（9 顆，分散在龍身）', skill: '蛻生：立刻長回 1 個被切的器官（每場一次）', style: '平衡，器官分散好防守' },
  snake: { name: '千節蛇', organs: '毒 3、爪 2、蛇牙 1、心 1、眼 1、骨 1（排成一列）', skill: '穿刺：5 秒內的下一刀最多連切 3 個（每場一次）', style: '器官排成一列、貼近前線，靠技能一刀連切' },
};
const REJECT_TEXT: Record<PlaceReject, string> = { outside: '這裡放不下：器官要整個在獸身裡', unreachable: '這裡放不下：對方的刀碰不到這裡（不能藏起來）', overlap: '這裡放不下：和其他器官重疊' };

// ---------------------------------------------------------------- 狀態
type Ui = 'beast' | 'cut' | 'battle' | 'contrib' | 'pick' | 'place' | 'showcase' | 'end';
interface Pop { p: V; text: string; color: string; t0: number; life: number; size: number; side?: Side; p0?: V }
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
  shakeUntil: 0, banner: null as null | { text: string; sub: string; t0: number; life: number },
  fx: [] as Fx2[], bursts: [] as { o: { id: string; kind: Kind; side: Side; p: V }; t0: number; ang: number }[],
  sound: true, ghost: null as V | null, ghostOk: false, placing: null as number | null, aimFirst: 0,
  // ---- duel3 ----
  input: 'free' as 'free' | 'line', clock: 0, slicer: new Slicer(),
  fp: null as null | { id: number; start: V; last: V; lastTs: number; moved: number; len: number; valid: boolean; downAt: number }, fpStart: null as V | null,
  trail: [] as TrailPt[], splits: [] as SplitFx[], fxOn: true, slowUntil: 0, dispT: 0, lastFrame: null as number | null,
  lastFree: null as Extract<GameEvent, { t: 'freeEnd' }> | null, freeLog: [] as string[], stepSig: [] as string[], slowLog: [] as { now: number; step: number; clock: number }[],
  tut: null as null | { phase: 'demo' | 'hints'; t0: number; hint: number; path: V[] },
  // ---- duel4 ----
  countdown: null as null | { t0: number },     // 開場倒數（期間規則時鐘不走、AI 不動、指標事件丟棄）
  // ---- duel5 ----
  beast: 'dragon' as Beast, pickSeed: null as number | null, skillPress: false,
  pendingBattle: 0, matchupUntil: 0, lastNum: { blue: -1e9, red: -1e9 } as Record<Side, number>, lines: [] as { from: V; to: V; t0: number; color: string }[], lastBanner: '',
  matchupInfo: null as null | { me: Record<string, number>; foe: Record<string, number>; text: string },
  showcaseT0: 0, hitstopUntil: 0, aimCount: 0, slotCache: null as null | { camp: Campaign; slots: V[] },
  cuts: [] as { side: Side; kind: Kind; p: V; step: number }[],   // 切口（傷口＋再生倒數圈的位置；長回時移除該種類最早的一個）
  grows: [] as { p: V; t0: number; side: Side }[], hurts: [] as { p: V; t0: number }[], cutGlow: [] as { a: V; b: V; t0: number }[],
  front: { from: [] as number[], to: [] as number[], t0: 0, flash: 0, flashSide: 'blue' as Side, push: 0 },
  fxLog: [] as { t: string; at: number; side?: Side; id?: string; flash?: boolean; css?: number; crit?: boolean; text?: string }[],   // 演出事件紀錄（FV-06 測試讀取）
  resultMax: 0,                                 // 同時可見的結果字最大數（FV-06）
  reach: null as null | { key: string; inRange: boolean[] },
};
try { G.sound = localStorage.getItem('duel-cb-sound') !== '0'; } catch { /* 無痕或封鎖儲存 */ }
try { G.input = localStorage.getItem('duel5-input') === 'line' ? 'line' : 'free'; } catch { /* 無痕或封鎖儲存 */ }
const dispNow = () => G.dispT;   // 畫面時鐘（秒）：切除瞬間放慢；規則時鐘 G.clock 不受影響（DF-06）

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
/** 新征途：先出現選怪獸畫面（每次新征途都顯示、預選上次的選擇；補述 1 第 10b 條）；測試可直接指定怪獸跳過畫面。 */
function newRun(seed?: number, beast?: Beast): void {
  G.token++;
  if (G.tut) tutEnd();   // 教學期間按「重新征途」：教學畫面一併結束（審查 M3）
  const auto = beast ?? (window as unknown as { __duel5AutoBeast?: Beast }).__duel5AutoBeast;   // 測試用：載入前指定怪獸（舊測試照跑時預選龍，補述 1 第 10c 條）
  if (auto) { startRun(seed, auto); return; }
  showBeastPick(seed);
}
let lastBeast: Beast = 'dragon';
try { const v = localStorage.getItem(BEAST_KEY); if (v === 'snake' || v === 'dragon') lastBeast = v; } catch { /* 無痕或封鎖儲存：照樣能玩 */ }
function showBeastPick(seed?: number): void {
  G.ui = 'beast'; G.pickSeed = seed ?? null; els.nextFoe.hidden = true;
  for (const m of [els.contrib, els.pick, els.end]) m.hidden = true;
  for (const b of ['dragon', 'snake'] as Beast[]) els[b === 'dragon' ? 'beastDragon' : 'beastSnake'].classList.toggle('sel', b === lastBeast);
  els.beast.hidden = false; drawBeastThumbs(); hud();
}
function chooseBeast(b: Beast): void {
  if (G.ui !== 'beast') return;
  lastBeast = b; try { localStorage.setItem(BEAST_KEY, b); } catch { /* 略過 */ }
  els.beast.hidden = true; startRun(G.pickSeed ?? undefined, b);
}
els.beastDragon.onclick = () => chooseBeast('dragon');
els.beastSnake.onclick = () => chooseBeast('snake');
function startRun(seed: number | undefined, beast: Beast): void {
  G.beast = beast; els.beast.hidden = true;
  G.camp = newCampaign(seed ?? G.seedSource(), BODY2, R3, FRONT, { beast, cutSeconds: CUT_S });
  G.tipsShown = new Set(); tipQueue.length = 0; tipLog.length = 0;
  startCut();
  if (G.input === 'free' && !tutDone()) { G.countdown = null; startTutorial(); }   // 教學場：示範結束後才倒數
  else {
    onceTip('open', G.input === 'free' ? `切割期 ${CUT_S} 秒：手指從你的獸身快速劃過對方器官就切下（劃過自己的器官會鎖住保護它）。時間到，雙方剩下的器官自動開打。` : `切割期 ${CUT_S} 秒：從你的獸身拖一條線切對方器官（穿過自己的器官會鎖住保護它）。時間到，雙方剩下的器官自動開打。`, 3600);
    onceTip('kinds', '五種器官：爪＝攻擊、心＝血量與回血、眼＝暴擊、毒＝持續傷害、骨＝護盾。點器官看說明。', 3200);
  }
}
// ---------------------------------------------------------------- 第一場教學（每台裝置一次、可跳過；DUEL_V03_FEEL 二）
const TUT_KEY = 'duel5-tutorial';
const TUT_HINTS = ['劃過紅色器官＝切下', '劃過自己的器官＝保護', '每刀之後要等冷卻'];
let tutSeen = false;   // localStorage 被封鎖時的後備（同一次開頁不重複出現，審查 L-5）
function tutDone(): boolean { if (tutSeen) return true; try { return localStorage.getItem(TUT_KEY) === 'done'; } catch { return false; } }
function markTut(): void { tutSeen = true; try { localStorage.setItem(TUT_KEY, 'done'); } catch { /* 略過 */ } }
function startTutorial(): void {
  markTut();   // 出現過就算（每台裝置只出現一次）
  // 示範路徑：從藍龍身內最靠近某個紅色器官的點出發，快速劃過那個器官
  const s = G.game; let best: { a: V; o: V; d: number } | null = null;
  s.organs.forEach((o, i) => { if (o.side !== 'red' || !isReady(s, i)) return; for (const a of bodyPoly('blue')) { const d = Math.hypot(a[0] - o.p[0], a[1] - o.p[1]); if (!best || d < best.d) best = { a, o: o.p, d }; } });
  const b = best as { a: V; o: V; d: number } | null;
  const cb = bodyCenter('blue'), a: V = b ? [b.a[0] + (cb[0] - b.a[0]) * 0.15, b.a[1] + (cb[1] - b.a[1]) * 0.15] : cb, o: V = b ? b.o : bodyCenter('red');
  const L = Math.hypot(o[0] - a[0], o[1] - a[1]) || 1, end: V = [o[0] + ((o[0] - a[0]) / L) * 60, o[1] + ((o[1] - a[1]) / L) * 60];
  G.tut = { phase: 'demo', t0: performance.now(), hint: -1, path: [a, end] };
  G.game = { ...G.game, aiHold: true };   // 教學場：玩家第一次鎖定或切除之前 AI 不出刀（規則層旗標，補述 1 第 4 條）
  els.tutText.textContent = '看示範：手指從你的獸身快速劃過紅色器官'; els.tut.hidden = false;
}
function tutHint(n: number): void {
  if (!G.tut || G.tut.phase !== 'hints' || n <= G.tut.hint) return;
  G.tut.hint = n; els.tutText.textContent = TUT_HINTS[n];
}
function tutEnd(): void { G.tut = null; els.tut.hidden = true; G.lastT = null; }
els.tutSkip.onclick = () => { const demo = G.tut?.phase === 'demo'; markTut(); tutEnd(); if (demo && G.ui === 'cut') startCountdown(); };
function tutTick(now: number): void {
  if (!G.tut || G.tut.phase !== 'demo') return;
  if (now - G.tut.t0 >= 3000) { G.tut = { ...G.tut, phase: 'hints' }; tutHint(0); G.lastT = null; startCountdown(); }
}
function tutOnFree(e: GameEvent): void {
  if (!G.tut || G.tut.phase !== 'hints' || !('side' in e) || e.side !== 'blue') return;
  if (e.t === 'freeEnd' && e.why === 'tap') return;   // 點擊不算一刀
  if (e.t === 'freeEnd') { if (G.tut.hint === 0) tutHint(1); else if (G.tut.hint === 1) tutHint(2); else if (G.tut.hint === 2) tutEnd(); }
  else if (e.t === 'freeLock' && G.tut.hint === 1) tutHint(2);
}
function startCut(): void {
  G.game = matchFor(G.camp); G.ui = 'cut'; G.cutByMe = []; G.drag = null; G.release = null; G.preview = null; G.battle = null; G.vis = [];
  G.acc = 0; G.lastT = null; G.pops = []; G.particles = []; G.shots = []; G.slashes = []; G.fx = []; G.bursts = [];
  G.clock = 0; lastEvT = 0; downT = 0; downTs = 0; G.slicer = new Slicer(); G.fp = null; G.trail = []; G.splits = []; G.lastFree = null; G.freeLog = []; G.stepSig = []; G.slowLog = [];
  G.pendingBattle = 0; G.matchupUntil = 0; els.matchup.hidden = true; G.lines = []; G.lastNum = { blue: -1e9, red: -1e9 }; G.matchupInfo = null;
  G.aimCount = 0; G.banner = null; G.cuts = []; G.grows = []; G.hurts = []; G.cutGlow = []; G.fxLog = []; G.reach = null; G.hitstopUntil = 0;
  for (let p = -FRONT.max; p <= FRONT.max; p++) frontEdge(p);   // 預先建好各 push 的起刀區點陣與前線帶（審查 H1：第一次推進時才建會卡幀）
  G.front = { from: frontEdge(0), to: frontEdge(0), t0: 0, flash: 0, flashSide: 'blue', push: 0 };
  for (const m of [els.contrib, els.pick, els.end]) m.hidden = true;
  els.nextFoe.hidden = true;
  startCountdown();
  hud();
}
/** 開場 3-2-1 倒數：期間規則時鐘不走、AI 不動、玩家不能出刀（指標事件丟棄）。 */
function startCountdown(): void { G.countdown = { t0: performance.now() }; G.lastT = null; G.slicer = new Slicer(); G.fp = null; G.drag = null; G.release = null; G.trail = []; }
const counting = () => G.countdown !== null && !G.manual;   // 手動推進模式（測試驅動步數，見 advance）不套用即時倒數
function stepOnce(): void {
  if (G.ui !== 'cut' || G.game.phase !== 'cut') return;
  const s0 = G.game;
  // 直線預覽＝duel2 原本的輸入（一字不改）；即時劃刀＝只吃第 k 步（含晚到）的片段，直線刀一律不送（審查 H-1：示範期間的拖線不能漏成直線刀）
  const blue = G.release; G.release = null;
  const free = G.input === 'free' ? G.slicer.takeUpTo(s0.step) : [];
  const skill = G.skillPress ? { blue: true } : undefined; G.skillPress = false;   // duel5 技能鈕（按下後的下一步送進規則）
  const out = G.input === 'free' ? step(s0, free.length ? { blue: null, drag: null, free: { blue: free }, skill } : { blue: null, drag: null, skill })
    : step(s0, { blue, drag: G.drag ? { a: G.drag.a, b: G.drag.b } : null, skill });
  G.game = out.state;
  G.stepSig.push(`${s0.step}|${G.game.alive.map(Number).join('')}|${G.game.lockUntil.join(',')}|${G.game.cdUntil.blue},${G.game.cdUntil.red}|${G.game.severedN.blue},${G.game.severedN.red}|${G.game.push ?? 0}`);
  for (const e of out.events) onCutEvent(e, s0);
  if (G.game.phase === 'ko') G.pendingBattle = performance.now() + KO_HOLD_MS;   // 「清空！」先完整顯示（原本同一步就被「戰鬥！」蓋掉）
  else if (G.game.phase !== 'cut') startBattle();
}
function severFx(o: { id?: string; kind: Kind; side: Side; p: V }, ang: number, now: number, a?: V): void {
  G.cuts.push({ side: o.side, kind: AK(o.kind), p: [o.p[0], o.p[1]], step: G.game.step });   // 傷口（再生倒數圈的位置）
  if (!ASSETS) return;
  if (o.side === 'red') {
    // 玩家切對方：裂成兩半（不傳 body／rect＝不整隻閃白，DUEL_V04_FRONT 三-5）＋刀痕加粗發光 150ms（三-4）
    G.splits.push({ type: 'split', t0: dispNow(), im: ASSETS.organs[AK(o.kind)], x: o.p[0], y: o.p[1], r: R * 1.25, angle: ang, side: o.side, kind: AK(o.kind) });
    if (a) G.cutGlow.push({ a: [a[0], a[1]], b: [o.p[0] + Math.cos(ang) * R * 2, o.p[1] + Math.sin(ang) * R * 2], t0: now });
  } else {
    // 被切：只在該器官位置爆紅光、留下傷口；裂開的兩半也用紅色（白與冷藍只留給自己的動作）
    G.hurts.push({ p: [o.p[0], o.p[1]], t0: now }); hurtSplits.push({ o: { kind: AK(o.kind), side: o.side, p: [o.p[0], o.p[1]] }, ang, t0: dispNow() });
    G.fxLog.push({ t: 'redHit', at: now, side: o.side, id: o.id });
  }
  const last = G.splits[G.splits.length - 1];
  G.fxLog.push({ t: 'split', at: now, side: o.side, id: o.id, flash: o.side === 'red' && !!last && (!!last.body || !!last.rect) });   // flash＝整隻閃白（不應出現）
  if (G.fxOn) { G.hitstopUntil = now + HITSTOP_MS; G.slowUntil = now + HITSTOP_MS + SLOW_MS; G.fxLog.push({ t: 'hitstop', at: now }); }
}
const hurtSplits: { o: { kind: Kind; side: Side; p: V }; ang: number; t0: number }[] = [];
function onCutEvent(e: GameEvent, s0: GameState): void {
  const now = performance.now();
  if (e.t === 'freeStart' || e.t === 'freeReject' || e.t === 'freeLock' || e.t === 'freeEnd') { onFreeEvent(e, s0, now); return; }
  if (e.t === 'strike') {
    const r = e.r; G.slashes.push({ a: r.line.a, b: r.end, t0: now, side: r.side }); sfx('slash');
    if (r.side === 'blue') G.lastStrike = r;
    if (r.severed !== null) {
      const o = s0.organs[r.severed]; severFx(o, Math.atan2(r.line.b[1] - r.line.a[1], r.line.b[0] - r.line.a[0]), now, r.line.a); sfx('sever');
      pop([o.p[0], o.p[1] - 30], `切下 ${KIND_ZH[o.kind]}`, o.side === 'red' ? '#AEEAFF' : '#ff8a8a', 18);
      if (r.side === 'blue') G.cutByMe.push(o.kind); else vibrate([30, 30, 30]);   // 切割期不晃畫面；被切＝該器官位置爆紅光（不整隻閃白，三-5；iPhone 沒有震動）
    }
    if (r.blocked !== null) { const o = s0.organs[r.blocked]; G.fx.push({ type: 'boneShield', t0: dispNow(), at: o.p as [number, number], facing: Math.atan2(r.line.a[1] - o.p[1], r.line.a[0] - o.p[0]) }); pop([o.p[0], o.p[1] - 30], '鎖住，擋下', '#cfe8ff', 16); sfx('block'); }
  } else if (e.t === 'aim') { if (!G.aimFirst) G.aimFirst = now; G.aimCount++; }
  else if (e.t === 'spawn') {
    const o = G.game.organs[e.i]; pop([o.p[0], o.p[1] - 32], `長回 ${KIND_ZH[o.kind]}`, '#9fffb0', 18);
    // 長回：移除該陣營同種類最早的切口，在實際長出的位置播長出動畫（≥400ms，三-2）
    const ci = G.cuts.findIndex((c) => c.side === o.side && c.kind === o.kind); if (ci >= 0) G.cuts.splice(ci, 1);
    G.grows.push({ p: [o.p[0], o.p[1]], t0: now, side: o.side }); G.fxLog.push({ t: 'grow', at: now, side: o.side, id: o.id });
  } else if (e.t === 'push') {
    // 前線帶移動（300ms 動畫）＋在前線閃一下己方陣營色（push 增加＝玩家推進＝藍；減少＝紅）
    const prev = G.front.push;
    G.front = { from: frontNow(now), to: frontEdge(e.push), t0: now, flash: now, flashSide: e.push > prev ? 'blue' : 'red', push: e.push };
    G.fxLog.push({ t: 'front', at: now, side: e.push > prev ? 'blue' : 'red' }); G.reach = null;
    pop([350, frontY(e.push) - 24], e.push > prev ? '前線推進！' : '前線後退', e.push > prev ? '#AEEAFF' : '#ff8a8a', 22, 1000);
  } else if (e.t === 'aiRelease') G.fxLog.push({ t: 'aiRelease', at: now });
  else if (e.t === 'ko') { G.banner = { text: '清空！', sub: e.winner === 'blue' ? '對手器官全滅' : e.winner === 'red' ? '你的器官全滅' : '同時清空', t0: now, life: 1200 }; }
  if (e.t === 'strike' || e.t === 'spawn' || e.t === 'push') G.reach = null;
}
function onFreeEvent(e: Extract<GameEvent, { t: 'freeStart' | 'freeReject' | 'freeLock' | 'freeEnd' }>, s0: GameState, now: number): void {
  if (e.t === 'freeStart' && e.side === 'blue') G.fpStart = [e.p[0], e.p[1]];
  if (e.t === 'freeLock' || e.t === 'freeEnd') G.reach = null;
  G.freeLog.push(`${s0.step}:${e.t}${e.t === 'freeEnd' ? `:${e.why}:${e.severed}:${e.blocked}` : e.t === 'freeLock' ? `:${e.i}` : e.t === 'freeReject' ? `:${e.reason}` : ''}`);
  tutOnFree(e);
  if (e.side !== 'blue') return;
  if (e.t === 'freeReject') { setInfo(`<span class="warnc">${e.reason === 'start' ? '起刀要從你的獸身開始' : e.reason === 'cooldown' ? '冷卻中，等藍條滿' : '不能出刀'}</span>`); if (e.reason === 'start') onceTip('freeStart', '起刀要從你的（藍色）獸身開始劃', 1800); return; }
  if (e.t === 'freeLock') { const o = s0.organs[e.i]; glow(o.id); pop([o.p[0], o.p[1] - 30], '鎖住', '#cfe8ff', 15); sfx('shield'); return; }
  if (e.t !== 'freeEnd') return;
  G.lastFree = e;
  const ang = Math.atan2(e.dir[1], e.dir[0]);
  if (e.severed !== null) {
    const o = s0.organs[e.severed]; severFx(o, ang, now, G.fpStart ?? undefined); sfx('sever'); sfx('slash');
    pop([o.p[0], o.p[1] - 30], `切下 ${KIND_ZH[o.kind]}`, '#AEEAFF', 18); G.cutByMe.push(o.kind);
  } else if (e.blocked !== null) {
    const o = s0.organs[e.blocked]; G.fx.push({ type: 'boneShield', t0: dispNow(), at: o.p as [number, number], facing: ang + Math.PI }); pop([o.p[0], o.p[1] - 30], '鎖住，擋下', '#cfe8ff', 16); sfx('block');
  } else if (e.why === 'length') setInfo(`刀走到 ${MAX_LEN} 的長度上限`);
}
function startBattle(): void {
  const f = fightersOf(G.game);
  G.battle = simulateBattle(f, battleSeed(G.camp));
  G.pops = []; G.cutGlow = []; G.trail = [];   // 切割期殘留的跳字與刀痕不帶進戰鬥
  G.ui = 'battle'; G.bT0 = performance.now(); G.bBase = 0; G.bClock = 0; G.bIdx = 0; G.speed = 1; els.fast.textContent = '快轉'; G.vis = []; G.release = null; G.drag = null; G.preview = null;
  const st = (G.battle.events[0] as Extract<BattleEvent, { t: 'start' }>).stats;
  G.disp = { blue: { hp: st.blue.hp, max: st.blue.maxHp, shield: st.blue.shield, poison: 0 }, red: { hp: st.red.hp, max: st.red.maxHp, shield: st.red.shield, poison: 0 } };
  if (st.blue.shield || st.red.shield) onceTip('bone', DESC.bone.line);
  // 開戰前 1.2 秒：雙方剩下的器官對照（資料＝戰鬥模擬的參與者 fightersOf），之後才開始回放、出「戰鬥！」
  const ORDER: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone', 'fang'], cnt = (side: Side) => Object.fromEntries(ORDER.map((k) => [k, f.filter((x) => x.side === side && x.kind === k).length]).filter(([, n]) => (n as number) > 0)) as Record<string, number>;
  const me = cnt('blue'), foe = cnt('red'), line = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${KIND_ZH[k as Kind]}${n}`).join(' ') || '（無）';
  G.matchupInfo = { me, foe, text: `你 ${line(me)} vs 敵 ${line(foe)}` };
  els.matchup.innerHTML = `<span class="me">你 ${line(me)}</span><span class="vs">vs</span><span class="foe">敵 ${line(foe)}</span>`; els.matchup.hidden = false;
  const now0 = performance.now(); G.matchupUntil = now0 + MATCHUP_MS; G.bT0 = now0 + MATCHUP_MS; G.banner = null; G.fxLog.push({ t: 'matchup', at: now0 });
  onceTip('battle', '戰鬥期：每個器官自己行動。爪攻擊、心回血、眼讓爪暴擊、毒疊層、骨給護盾。點器官可看說明。');
  hud();
}
const organById = (id: string) => G.game.organs.find((o) => o.id === id);
const centroid = (poly: V[]): V => { let a = 0, x = 0, y = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], c = p[0] * q[1] - q[0] * p[1]; a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; } return [x / (3 * a), y / (3 * a)]; };
/** 目前的獸身（選蛇時藍方＝蛇身）與重心（毒雲、縫線、教學示範用）。 */
const bodyPoly = (side: Side): V[] => G.camp?.body?.[side] ?? BODY2[side];
const centerCache = new Map<V[], V>();
const bodyCenter = (side: Side): V => { const p = bodyPoly(side); let c = centerCache.get(p); if (!c) { c = centroid(p); centerCache.set(p, c); } return c; };
function targetOf(side: Side, salt: number): V {
  const foe = G.game.organs.filter((o, i) => o.side !== side && G.game.alive[i]);
  return foe.length ? foe[salt % foe.length].p : bodyCenter(side === 'blue' ? 'red' : 'blue');
}
function playBattleEvent(e: BattleEvent): void {
  const now = performance.now(), d = G.disp;
  if (e.t === 'claw') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue', to = targetOf(e.side, e.ms / 10);
    const ts = dispNow();
    if (o) { G.fx.push(e.crit ? { type: 'critArc', t0: ts, from: o.p as [number, number], to: to as [number, number] } : { type: 'arcSlash', t0: ts, from: o.p as [number, number], to: to as [number, number], side: e.side }); glow(o.id); G.fxLog.push({ t: 'line', at: now, id: o.id, side: e.side }); }   // 攻擊連線（數字改用跳字層）
    numPop(foe, [to[0] - 30, to[1] - 10], e.crit ? `暴擊 −${e.raw}` : `−${e.raw}`, e.crit ? '#FFD27A' : foe === 'red' ? '#ff9aa6' : '#cfe8ff', e.crit);
    if (e.crit) G.game.organs.forEach((x, i) => { if (G.game.alive[i] && x.side === e.side && x.kind === 'eye') glow(x.id); });
    if (e.shieldHit) G.game.organs.forEach((x, i) => { if (G.game.alive[i] && x.side === foe && x.kind === 'bone') glow(x.id); });
    d[foe].shield -= e.shieldHit; d[foe].hp = e.hpAfter;
    if (e.hpHit > 0 && ASSETS) { if (foe === 'red') G.fx.push({ type: 'hitFlash', t0: ts, body: ASSETS.body, rect: RECTS[foe], side: foe }); else { G.hurts.push({ p: [to[0], to[1]], t0: now }); G.fxLog.push({ t: 'redHit', at: now, side: 'blue' }); } }   // 白閃只用在自己的攻擊（三-5）
    if (e.shieldHit) { G.fx.push({ type: 'boneShield', t0: ts, at: to as [number, number], facing: o ? Math.atan2(o.p[1] - to[1], o.p[0] - to[0]) : 0 }); numPop(foe, [to[0] + 34, to[1] + 30], `盾 −${e.shieldHit}`, '#E8EEF8'); G.vis.push({ kind: 'bone', ev: 'claw' }); }
    G.vis.push({ kind: 'claw', ev: 'claw' }); if (e.crit) { G.vis.push({ kind: 'eye', ev: 'claw' }); sfx('crit'); onceTip('eye', DESC.eye.line); } else sfx('claw');
    onceTip('claw', DESC.claw.line);
    if (foe === 'blue') { G.shakeUntil = now + 120; }
  } else if (e.t === 'heal') {
    const o = organById(e.id); d[e.side].hp = e.hpAfter;
    if (o) { if (e.amount > 0) { G.grows.push({ p: [o.p[0], o.p[1]], t0: now, side: e.side }); numPop(e.side, [o.p[0], o.p[1] - 40], `+${e.amount}`, '#9fffb0'); } glow(o.id); }   // 滿血回 0 只發光、不跳 +0
    G.vis.push({ kind: 'heart', ev: 'heal' }); sfx('heal'); onceTip('heart', DESC.heart.line);
  } else if (e.t === 'poisonStack') {
    const o = organById(e.id), foe: Side = e.side === 'blue' ? 'red' : 'blue'; d[foe].poison = e.stacks;
    if (o) { const c = bodyCenter(foe); G.lines.push({ from: [o.p[0], o.p[1]], to: [c[0], c[1]], t0: now, color: '124,255,107' }); glow(o.id); G.fxLog.push({ t: 'line', at: now, id: o.id, side: e.side }); numPop(foe, [c[0] - 60, c[1] - 40], `毒 ×${e.stacks}`, '#B8FF9E'); }
    G.vis.push({ kind: 'poison', ev: 'poisonStack' }); sfx('poison'); onceTip('poison', DESC.poison.line);
  } else if (e.t === 'poisonTick') {
    d[e.side].shield -= e.shieldHit; d[e.side].hp = e.hpAfter;
    const c = bodyCenter(e.side); numPop(e.side, [c[0] + 90, c[1]], `毒 −${e.raw}`, '#7CFF6B'); if (e.shieldHit) G.fx.push({ type: 'boneShield', t0: dispNow(), at: c as [number, number], facing: e.side === 'blue' ? -Math.PI / 2 : Math.PI / 2 });
    G.vis.push({ kind: 'poison', ev: 'poisonTick' }); if (e.shieldHit) G.vis.push({ kind: 'bone', ev: 'poisonTick' });
  } else if (e.t === 'overtime') {
    G.banner = { text: '加時', sub: '所有傷害 ×2', t0: now, life: 1000 }; G.vis.push({ kind: 'overtime', ev: 'overtime' });
  } else if (e.t === 'end') {
    const win = e.winner === 'blue';
    G.banner = { text: win ? '勝！' : e.winner === 'draw' ? '平手' : '敗', sub: e.how === 'time' ? '時間到，比剩餘血量百分比' : e.how === 'empty' ? '一方沒有器官' : '血量歸零', t0: now, life: 1400 };
    sfx(win ? 'win' : 'lose'); if (!win) vibrate([60, 40, 60]);
    // 不再疊 art-kit 的 KO 大字（「擊倒／你贏了」）：結果字同一時間只有一個（三-6），由上面的橫幅（勝／敗／平手＋副標）負責
    sampleResults(now);
  }
  hud();
}
const glowUntil = new Map<string, number>();
function glow(id: string): void { glowUntil.set(id, performance.now() + 260); G.fxLog.push({ t: 'act', at: performance.now(), id }); }   // 器官行動亮起約 250ms（FS-06）
/** 戰鬥跳字（FS-06）：世界字級 ≥36（約 20 CSS px）；暴擊金色大字；雙方跳字錯開至少 80ms（只改畫面時間，規則不變）。 */
function numPop(side: Side, p: V, text: string, color: string, crit = false): void {
  const now = performance.now(), other: Side = side === 'blue' ? 'red' : 'blue';
  let t0 = Math.max(now, G.lastNum[side]);
  if (Math.abs(t0 - G.lastNum[other]) < NUM_GAP_MS) t0 = G.lastNum[other] + NUM_GAP_MS;
  G.lastNum[side] = t0;
  const size = crit ? NUM_CRIT : NUM_SIZE;
  const stack = G.pops.filter((q) => q.side === side && q.p0 && q.t0 > t0 - 400 && Math.hypot(q.p0[0] - p[0], q.p0[1] - p[1]) < 90).length;   // 同一方短時間內連續跳字：往上錯開，不疊成一團
  G.pops.push({ p: [p[0], p[1] - stack * 42], p0: [p[0], p[1]], side, text, color, t0, life: 1000, size });
  G.fxLog.push({ t: 'num', at: t0, side, css: size * scale, crit, text });
}
function battleTick(now: number): void {
  if (G.ui !== 'battle' || !G.battle) return;
  G.bClock = G.bBase + ((now - G.bT0) / G.battleScale) * G.speed;   // 快轉從當下時間接著加速，不會跳到結尾（審查 M6）
  const ev = G.battle.events;
  while (G.bIdx < ev.length && ev[G.bIdx].ms <= G.bClock) playBattleEvent(ev[G.bIdx++]);
  if (G.bIdx >= ev.length && G.bClock >= G.battle.endMs + 900) showContrib();
}
/** 結果字：同一時間可見的數量（畫布橫幅中的勝負字＋art-kit 的 KO 大字＋DOM 結算標題＋結束標題；FV-06）。每幀、以及結束事件與結算表出現的當下各取樣一次（覆審 N1）。 */
function sampleResults(now: number): void {
  const RES = ['勝！', '敗', '平手', '清空！'];
  const n = (G.banner && now - G.banner.t0 < G.banner.life && RES.includes(G.banner.text) ? 1 : 0) + (els.contrib.hidden ? 0 : 1) + (els.end.hidden ? 0 : 1) + (G.fx.some((f) => f.type === 'ko') ? 1 : 0);
  G.resultMax = Math.max(G.resultMax, n);
}
function showContrib(): void {
  const b = G.battle!; G.ui = 'contrib'; G.banner = null; G.fx = G.fx.filter((f) => f.type !== 'ko');   // 結算標題出現前清掉畫布上的結果橫幅（三-6）
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
  els.contrib.hidden = false; sampleResults(performance.now());
}
els.contribNext.onclick = () => {
  if (G.ui !== 'contrib' || !G.battle) return;
  els.contrib.hidden = true;
  const endBody = fightersOf(G.game).filter((f) => f.side === 'blue').map((f) => f.kind);
  G.camp = finishStage(G.camp, G.cutByMe, G.battle, endBody);
  if (G.camp.phase === 'pick') showPick(); else showEnd();
};
function showPick(): void {
  G.ui = 'pick'; els.pickOpts.innerHTML = ''; G.banner = null; G.fx = []; els.tip.hidden = true; tipQueue.length = 0; clearTimeout(tipTimer); els.tut.hidden = true; G.tut = null; G.pops = [];   // 進入縫合前清掉所有橫幅（三-6）
  G.camp.offer.forEach((k, i) => {
    const b = document.createElement('button'); b.id = `pick${i}`; b.dataset.kind = k;
    b.innerHTML = `<img alt="" src="./assets/final/${k}.png"><span><b>${KIND_ZH[k]}・${DESC[k].role}</b><small>${DESC[k].line}</small></span>`;
    b.onclick = () => { G.camp = pickStitch(G.camp, k); els.pick.hidden = true; G.ui = 'place'; tip(`點亮著的槽位放下「${KIND_ZH[k]}」（點附近會自動吸附）`, 4000); hud(); };
    els.pickOpts.appendChild(b);
  });
  els.pick.hidden = false; hud();
}
/** 縫合：點擊位置吸附到 40 內最近的槽位（槽位＝和規則同一個 placeCheck 算出的合法點；補述 1 第 5 條、補述 2）；40 內沒有槽位就拒絕。 */
function tryPlace(p: V): void {
  const q = snapSlot(G.camp, p, G.slotCache?.camp === G.camp ? G.slotCache.slots : undefined);
  if (!q) { tip(`點亮著的槽位（${SNAP_DIST} 內會自動吸附）`); sfx('deny'); return; }
  const r = placeStitch(G.camp, q);
  if (r.reject) { tip(REJECT_TEXT[r.reject]); sfx('deny'); return; }
  G.camp = r.c; sfx('place'); showcase();
}
/** 縫合之後：先展示新身體 1.5 秒，然後出現「下一位對手」；按下後才開始下一場（倒數）。期間模擬不跑。 */
function showcase(): void {
  G.ui = 'showcase'; G.showcaseT0 = performance.now(); G.ghost = null; els.nextFoe.hidden = true; G.banner = null; els.tip.hidden = true; tipQueue.length = 0; clearTimeout(tipTimer);
  setInfo('新的身體。'); hud();
}
els.nextFoe.onclick = () => { if (G.ui === 'showcase' && !els.nextFoe.hidden) { els.nextFoe.hidden = true; startCut(); } };
function showEnd(): void {
  G.ui = 'end'; G.banner = null; els.contrib.hidden = true;
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
/** 技能鈕（DUEL_V05_SNAKE 二）：切割期才能按、倒數與教學示範中不能按；用過變灰；龍沒有可長回的器官時不能按（不算用掉）；穿刺生效中顯示剩餘秒數。 */
function skillHud(): void {
  const b = els.skill, beast = G.beast, s = G.game, name = beast === 'snake' ? '穿刺' : '蛻生';
  b.hidden = !G.camp || G.ui !== 'cut';   // 只在切割期顯示（FS：只能在切割期使用）
  if (b.hidden) return;
  const used = !!s?.skillUsed?.blue, pz = s?.pierce?.blue, live = G.ui === 'cut' && !counting() && !(G.tut && G.tut.phase === 'demo') && s?.phase === 'cut';
  const canMolt = beast === 'dragon' && !!s && s.severedQ.blue.length > 0 && countSide(s, 'blue') < (s.mode.maxPerSide?.blue ?? 8);
  const text = pz ? `${name}中 ${Math.max(0, Math.ceil((pz.until - s.step) / FPS))} 秒` : used ? `${name}（已用）` : name;
  if (b.textContent !== text) b.textContent = text;
  b.disabled = used || !live || G.skillPress || (beast === 'dragon' && !canMolt);
  b.classList.toggle('used', used && !pz); b.classList.toggle('live', !!pz);
}
els.skill.onclick = () => { if (!els.skill.disabled && G.ui === 'cut') { G.skillPress = true; ac(); skillHud(); } };
function hud(): void {
  if (!G.camp) return;
  const c = G.camp, s = G.game;
  els.stage.textContent = `對手 ${c.stage + 1}／${CB.STAGES}`;
  els.phase.textContent = G.ui === 'cut' ? (counting() ? '準備' : '切割') : G.ui === 'battle' || G.ui === 'contrib' ? '戰鬥' : G.ui === 'pick' || G.ui === 'place' || G.ui === 'showcase' ? '縫合' : '結束';
  if (G.ui === 'cut') {
    const left = Math.max(0, (endStep(s) - s.step) / FPS);
    els.clock.textContent = left.toFixed(left < 10 ? 1 : 0);
    const nb = countSide(s, 'blue'), nr = countSide(s, 'red'), mb = s.mode.maxPerSide?.blue ?? 9, mr = s.mode.maxPerSide?.red ?? 9;
    els.meTxt.textContent = `器官 ${nb}`; els.foeTxt.textContent = `器官 ${nr}　前線 ${(s.push ?? 0) > 0 ? '+' : ''}${s.push ?? 0}`;
    els.meBar.style.width = `${(100 * nb) / mb}%`; els.foeBar.style.width = `${(100 * nr) / mr}%`;
    els.meShield.style.width = '0%'; els.foeShield.style.width = '0%';
    const cd = Math.max(0, s.cdUntil.blue - s.step) / COOLDOWN_STEPS;
    els.cd.style.width = `${100 * (1 - cd)}%`; els.cd.parentElement!.classList.toggle('cool', cd > 0);
  } else if (G.ui === 'battle' || G.ui === 'contrib') {
    els.clock.textContent = (Math.max(0, Math.min(BT.MAX_MS, G.bClock)) / 1000).toFixed(1);   // 開戰前對照期間回放還沒開始（負值顯示 0）
    for (const side of ['blue', 'red'] as Side[]) {
      const d = G.disp[side], bar = side === 'blue' ? els.meBar : els.foeBar, sh = side === 'blue' ? els.meShield : els.foeShield, txt = side === 'blue' ? els.meTxt : els.foeTxt;
      bar.style.width = `${(100 * Math.max(0, d.hp)) / d.max}%`; sh.style.width = `${Math.min(100, (100 * Math.max(0, d.shield)) / d.max)}%`;
      txt.textContent = `${Math.max(0, d.hp)}/${d.max}${d.shield > 0 ? ` 盾${d.shield}` : ''}${d.poison ? ` 毒${d.poison}` : ''}`;
    }
  } else { els.clock.textContent = '—'; }
  els.sound.textContent = `音效：${G.sound ? '開' : '關'}`; els.sound.setAttribute('aria-pressed', String(G.sound));
  els.fast.disabled = G.ui !== 'battle' || G.matchupUntil > 0;
  skillHud();
  els.inputMode.textContent = `操作：${G.input === 'free' ? '即時劃刀' : '直線預覽'}`;
  if (G.ui === 'cut' && G.input === 'free' && !G.fp) setInfo('手指從<b>藍色獸身</b>快速劃過紅色器官；點器官看說明。');
  else if (G.ui === 'cut' && G.input === 'line' && !G.drag) setInfo('從<b>藍色獸身</b>拖線切紅方器官；點器官看說明。');
  else if (G.ui === 'place') setInfo(`點亮著的槽位放下「${KIND_ZH[G.camp.picked ?? 'claw']}」（${SNAP_DIST} 內自動吸附）。`);
  else if (G.ui === 'battle') setInfo('戰鬥中：器官自己行動（可按「快轉」）。');
}

// ---------------------------------------------------------------- 輸入
function organAt(p: V): { kind: Kind; side: Side } | null {
  const s = G.game;
  for (let i = s.organs.length - 1; i >= 0; i--) { const o = s.organs[i]; if (s.alive[i] && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) <= R + 6) return { kind: AK(o.kind), side: o.side }; }
  return null;
}
// 即時劃刀：事件時間戳換成本局的毫秒（規則時鐘 G.clock 在上一幀 G.lastT 的值＋事件距那一幀的時間）
const matchMs = (ts: number): number => (G.lastT === null ? G.clock : G.clock + (ts - G.lastT));
// 一刀的時間：按下時換算一次本局毫秒（downT），刀內每個事件＝downT＋（事件時間戳−按下時間戳）。
// 刀內只用事件時間戳的差，手指速度不受幀卡頓、時鐘上限、背景切換、時間軸基準影響（審查 M-1、覆審 N-1／N-2）。
let lastEvT = 0, downT = 0, downTs = 0;
function alignTs(ts: number): void {
  const d = performance.now() - ts, base = Math.abs(d) > 1000 ? ts + d : ts;   // 事件時間戳與 performance.now 不同軸（差 >1 秒）時改用現在
  // 新刀不早於上一刀最後一個事件（DL-085 A）：上一刀遇到幀卡頓（時鐘每幀最多走 250ms）時，刀內事件會跑在規則時鐘前面；
  // 下一刀若照落後的時鐘換算，會排在上一刀結束之前，按下被吞、線段接到上一刀。代價：這種情況下新刀晚一點結算。
  downT = Math.max(matchMs(base), lastEvT, 0); downTs = ts; lastEvT = downT;
}
function pushEv(k: PtrKind, p: V, ts: number): void { if (G.ui === 'cut' && !counting()) { lastEvT = Math.max(lastEvT, downT + (ts - downTs)); const ev: PtrEv = { t: lastEvT, k, p }; G.slicer.push(ev); } }
const freeActive = () => G.input === 'free' && G.ui === 'cut' && !(G.tut && G.tut.phase === 'demo') && !counting();
els.canvas.addEventListener('pointerdown', (e) => {
  ac();
  if (G.ui === 'beast' || !G.game) return;
  const p = toWorld(e.clientX, e.clientY);
  if (G.ui === 'place') { G.ghost = snapSlot(G.camp, p, G.slotCache?.camp === G.camp ? G.slotCache.slots : undefined); G.ghostOk = !!G.ghost; G.placing = e.pointerId; els.canvas.setPointerCapture(e.pointerId); return; }   // 只用按下／放開（觸控），不靠游標停留
  if (G.input === 'free' && G.ui === 'cut' && G.tut && G.tut.phase === 'demo') return;   // 示範期間不接受切割輸入（只能按「跳過教學」）
  if (G.ui === 'cut' && counting()) return;   // 倒數期間不能出刀
  if (freeActive()) {
    if (G.fp) { if (e.pointerId !== G.fp.id) { pushEv('multi', G.fp.last, e.timeStamp); G.fp = null; } return; }   // 第二根手指：刀結束
    const g = G.game, valid = g.phase === 'cut' && g.cdUntil.blue <= g.step && startOk(g, 'blue', p);   // 這次按下能不能起刀（按住提示只在能起刀時顯示，審查 L-4）
    G.fp = { id: e.pointerId, start: p, last: p, lastTs: e.timeStamp, moved: 0, len: 0, valid, downAt: performance.now() };
    alignTs(e.timeStamp); pushEv('down', p, e.timeStamp); G.trail = [{ x: p[0], y: p[1], t: performance.now() / 1000 }];
    try { els.canvas.setPointerCapture(e.pointerId); } catch { /* 略過 */ }
    return;
  }
  if (G.drag || (G.ui === 'cut' && counting())) return;
  G.drag = { id: e.pointerId, a: p, b: p, moved: 0 }; els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e.clientX, e.clientY);
  if (G.ui === 'place') { if (G.placing === e.pointerId) { G.ghost = snapSlot(G.camp, p, G.slotCache?.camp === G.camp ? G.slotCache.slots : undefined); G.ghostOk = !!G.ghost; } return; }
  if (G.fp && e.pointerId === G.fp.id) {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];   // 手機一幀內的多個取樣點（密度不影響結果：DF-02）
    for (const c of list.length ? list : [e]) {
      const q = toWorld(c.clientX, c.clientY), fp = G.fp, dt = c.timeStamp - fp.lastTs, d = Math.hypot(q[0] - fp.last[0], q[1] - fp.last[1]);
      if (d === 0) continue;
      pushEv('move', q, c.timeStamp);
      G.trail.push({ x: q[0], y: q[1], t: performance.now() / 1000, blunt: dt > 0 ? d / dt < FREE_MIN_SPEED : false });   // 畫面上的鈍刀判斷與規則同一門檻（只影響顏色）
      fp.len += d; fp.last = q; fp.lastTs = c.timeStamp; fp.moved = Math.max(fp.moved, Math.hypot(q[0] - fp.start[0], q[1] - fp.start[1]));
    }
    if (G.trail.length > 80) G.trail.splice(0, G.trail.length - 80);
    return;
  }
  if (!G.drag || e.pointerId !== G.drag.id) return;
  G.drag.b = p; G.drag.moved = Math.max(G.drag.moved, Math.hypot(p[0] - G.drag.a[0], p[1] - G.drag.a[1]));
  if (G.ui === 'cut') { G.preview = resolveStrike({ ...G.game, cdUntil: { ...G.game.cdUntil } }, 'blue', { a: G.drag.a, b: G.drag.b }); previewText(); }
});
const endDrag = (e: PointerEvent, cancel: boolean) => {
  if (G.ui === 'place' && G.placing === e.pointerId) { G.placing = null; const p = toWorld(e.clientX, e.clientY); G.ghost = null; if (!cancel) tryPlace(p); return; }
  if (G.fp && e.pointerId === G.fp.id) {
    const fp = G.fp; G.fp = null;
    if (cancel) { pushEv('cancel', fp.last, e.timeStamp); return; }
    pushEv('up', toWorld(e.clientX, e.clientY), e.timeStamp);
    if (fp.len < TAP_LEN) { const o = organAt(fp.start); if (o) tip(`${o.side === 'blue' ? '你的' : '對手的'}${DESC[o.kind].line}`); }
    hud(); return;
  }
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
els.inputMode.onclick = () => {
  if (G.fp || G.drag || G.slicer.q.size || (G.game && G.game.stroke?.blue)) return;   // 刀還沒結算完不能切換（審查 L-6）
  G.input = G.input === 'free' ? 'line' : 'free'; G.slicer = new Slicer(); G.trail = [];
  try { localStorage.setItem('duel5-input', G.input); } catch { /* 略過 */ }
  hud();
};
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
/** 器官 sprite 畫在規則座標上（顯示半徑＝判定半徑 R，DF-04）；同時記下它在螢幕上的中心（DA-04 對齊驗證用）。 */
const spriteCenters = new Map<string, { x: number; y: number }>();
/** 千節蛇的暫代畫面（DUEL_V05_SNAKE 二：GPT 素材到之前用程式畫的幽光）：蛇身多邊形填色＋邊緣光＋沿中線的纖維與骨節。a＝調暗係數。 */
function drawSnake(t: number, a: number): void {
  ctx.save(); ctx.globalAlpha = a;
  ctx.beginPath(); SNAKE_POLY.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
  const g = ctx.createLinearGradient(0, SNAKE.Y0 - SNAKE.A - SNAKE.HALF, 0, SNAKE.Y0 + SNAKE.A + SNAKE.HALF); g.addColorStop(0, '#1d4f7a'); g.addColorStop(0.5, '#123a5c'); g.addColorStop(1, '#0b2440');
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 16; ctx.strokeStyle = 'rgba(127,200,255,0.75)'; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let k = -2; k <= 2; k++) {   // 纖維：沿中線的平行光帶，緩慢流動
    ctx.strokeStyle = `rgba(127,200,255,${0.10 + 0.05 * (2 - Math.abs(k))})`; ctx.lineWidth = 2; ctx.beginPath();
    for (let s = 0; s <= SNAKE_ARC; s += 12) { const p = snakeAt(s), q = snakeAt(s + 2), nx = -(q[1] - p[1]), ny = q[0] - p[0], L = Math.hypot(nx, ny) || 1, off = k * 18 + Math.sin(s / 40 + t * 1.5 + k) * 3; const x = p[0] + (nx / L) * off, y = p[1] + (ny / L) * off; if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let s = 20; s < SNAKE_ARC - 10; s += 28) {   // 骨節
    const p = snakeAt(s), q = snakeAt(s + 2), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang); ctx.fillStyle = 'rgba(200,192,175,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, 5, SNAKE.HALF * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const head = snakeAt(SNAKE_ARC - 6);   // 蛇頭（右端）
  ctx.fillStyle = '#7FC8FF'; ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(head[0] - 14, head[1] - 10, 5, 0, Math.PI * 2); ctx.arc(head[0] - 14, head[1] + 10, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
/** 選怪獸卡片的輪廓縮圖（龍＝art-kit 本體剪影的多邊形；蛇＝蛇身多邊形）。 */
function drawBeastThumbs(): void {
  for (const [id, poly] of [['thumbDragon', BODY2.blue], ['thumbSnake', SNAKE_POLY]] as [string, V[]][]) {
    const cv = document.getElementById(id) as HTMLCanvasElement | null; if (!cv) continue;
    const c = cv.getContext('2d')!, xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const k = Math.min((cv.width - 12) / w, (cv.height - 12) / h);
    c.clearRect(0, 0, cv.width, cv.height); c.save(); c.translate((cv.width - w * k) / 2 - x0 * k, (cv.height - h * k) / 2 - y0 * k); c.scale(k, k);
    c.beginPath(); poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
    c.fillStyle = 'rgba(39,141,209,0.45)'; c.fill(); c.lineWidth = 3 / k; c.strokeStyle = '#7FC8FF'; c.stroke(); c.restore();
  }
}
let dimCv: HTMLCanvasElement | null = null;
let frameStall = 0;   // 測試掛勾 setFrameStall：每幀推進規則前空轉的毫秒數（慢幀回歸測試用；正式遊戲為 0）
function organ(o: { id: string; kind: Kind; side: Side; p: V }, st: OrganStateV3, t: number, alpha = 1): void {
  if (!ASSETS) return;
  if (alpha < 1) {
    // 調暗：art-kit 的 drawOrganV3 內部會把 globalAlpha 設成定值（蓋掉呼叫端的透明度），所以先畫到離屏小畫布、再以 alpha 貼回（審查後實測：直接設 globalAlpha 畫面沒變暗）
    const m0 = ctx.getTransform(), k = m0.a, box = R * 4.4, px = Math.ceil(box * k);   // 框要涵蓋鎖定秒數（art-kit 畫在中心上方約 49.5～62.5，覆審 N2）
    if (!dimCv) dimCv = document.createElement('canvas');
    if (dimCv.width !== px) { dimCv.width = px; dimCv.height = px; }
    const dc = dimCv.getContext('2d')!; dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, px, px);
    dc.setTransform(k, 0, 0, k, (box / 2 - o.p[0]) * k, (box / 2 - o.p[1]) * k);
    drawOrganV3(dc, ASSETS.organs[AK(o.kind)], { kind: AK(o.kind), side: o.side, x: o.p[0], y: o.p[1], r: R }, st, t);
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(dimCv, o.p[0] - box / 2, o.p[1] - box / 2, box, box); ctx.restore();
  } else drawOrganV3(ctx, ASSETS.organs[AK(o.kind)], { kind: AK(o.kind), side: o.side, x: o.p[0], y: o.p[1], r: R }, st, t);
  if (o.kind === 'fang') {   // 蛇牙暫代：紫色光圈＋「牙」（GPT 素材到之前）
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = '#c38bff'; ctx.shadowColor = '#c38bff'; ctx.shadowBlur = 12; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(o.p[0], o.p[1], R * 0.92, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.font = '700 22px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#070D19'; ctx.strokeText('牙', o.p[0], o.p[1] + R + 22); ctx.fillStyle = '#e2c8ff'; ctx.fillText('牙', o.p[0], o.p[1] + R + 22); ctx.restore();
  }
  const m = ctx.getTransform(), r = els.canvas.getBoundingClientRect();
  spriteCenters.set(o.id, { x: r.left + (m.a * o.p[0] + m.c * o.p[1] + m.e) / dpr, y: r.top + (m.b * o.p[0] + m.d * o.p[1] + m.f) / dpr });
}
let fps = { frames: 0, t0: 0, last: 0 };
let isolateId: string | null = null, sceneOnly = false, isoOpt: { clear?: boolean; st?: OrganStateV3 } = {};
/** 範圍判定（不被擋就切得到，src/rtcut/reach.ts）：盤面（存活、萌芽、鎖定、push）沒變就沿用上次結果。 */
function reachNow(): boolean[] {
  const s = G.game, key = `${s.push ?? 0}|${s.organs.length}|${s.alive.map(Number).join('')}|${s.organs.map((_, i) => (isReady(s, i) ? 1 : 0) + (isLocked(s, i) ? 2 : 0)).join('')}`;
  if (!G.reach || G.reach.key !== key) G.reach = { key, inRange: reachOf(s, 'blue').inRange };
  return G.reach.inRange;
}
/** 按住：手指按住、還沒移動、這一下能起刀。即時劃刀看 G.fp；直線預覽看 G.drag（起點在起刀區、冷卻好）。 */
const holding = (): boolean => {
  if (G.ui !== 'cut') return false;
  if (G.input === 'free') { const fp = G.fp; return !!fp && fp.valid && fp.moved < 8; }
  const d = G.drag, g = G.game; return !!d && d.moved < 8 && g.cdUntil.blue <= g.step && startOk(g, 'blue', d.a);
};
/** 輪廓內：離起刀區 ≤ 420＋半徑的存活、萌芽完成的對方器官（即時劃刀能繞路，輪廓內都切得到；DL-087 選 A）。 */
function outlineNow(): Set<number> {
  const s = G.game, z = zoneOf(s.mode, s.push ?? 0, 'blue'), out = new Set<number>(), lim = (MAX_LEN + R) ** 2;
  s.organs.forEach((o, i) => { if (o.side === 'red' && s.alive[i] && isReady(s, i) && z.pts.some((p) => (p[0] - o.p[0]) ** 2 + (p[1] - o.p[1]) ** 2 <= lim)) out.add(i); });
  return out;
}
/** 按住提示：直線預覽加亮直線碰得到（範圍內）的對方器官（和調暗同一個判定函式，補述 1 第 1／8 條）；即時劃刀加亮輪廓內的對方器官（補述 3）。 */
function holdLit(): Set<number> {
  const out = new Set<number>();
  if (!holding()) return out;
  if (G.input === 'free') return outlineNow();
  const r = reachNow(); G.game.organs.forEach((o, i) => { if (o.side === 'red' && r[i]) out.add(i); });
  return out;
}
/** 前線帶＝玩家起刀區的前緣（補述 1 第 8 條）：每 10 單位一欄，取起刀區點陣在該欄最上面的點（同一個起刀區函式）；沒有起刀區的欄＝NaN。 */
const frontCache = new Map<number, number[]>();
function frontEdge(push: number): number[] {
  let e = frontCache.get(push);
  if (!e) {
    const mode = G.game?.mode ?? matchFor(G.camp).mode, z = zoneOf(mode, push, 'blue'); e = [];
    for (let x = 0; x <= W; x += 10) { const i = Math.round((x - z.x0) / 2); let y = NaN; if (i >= 0 && i < z.w) for (let j = 0; j < z.h; j++) if (z.bits[j * z.w + i]) { y = z.y0 + j * 2; break; } e.push(y); }
    frontCache.set(push, e);
  }
  return e;
}
function frontNow(now: number): number[] {
  const f = G.front, k = Math.min(1, Math.max(0, (now - f.t0) / FRONT_ANIM_MS)), ease = 1 - (1 - k) ** 3;
  return f.to.map((y, i) => (Number.isFinite(f.from[i]) && Number.isFinite(y) ? f.from[i] + (y - f.from[i]) * ease : y));
}
const frontY = (push: number): number => { const e = frontEdge(push).filter(Number.isFinite); return e.length ? e.reduce((a, b) => a + b, 0) / e.length : 500; };
/** 範圍輪廓（起刀區往外 420）：起刀區邊界取樣點各畫半徑 420 的圓取聯集，再扣掉半徑 414 的聯集＝一圈淡色輪廓。依 push 快取成離屏圖層。 */
const rangeCache = new Map<number, HTMLCanvasElement>();
function rangeLayer(push: number): HTMLCanvasElement {
  let cv = rangeCache.get(push);
  if (!cv) {
    const k = 0.5, z = zoneOf(G.game.mode, push, 'blue'); cv = document.createElement('canvas'); cv.width = W * k; cv.height = H * k;
    const c = cv.getContext('2d')!, pts: V[] = [];
    for (let j = 0; j < z.h; j += 4) for (let i = 0; i < z.w; i += 4) { if (!z.bits[j * z.w + i]) continue; const edge = [[-4, 0], [4, 0], [0, -4], [0, 4]].some(([di, dj]) => { const ii = i + di, jj = j + dj; return ii < 0 || jj < 0 || ii >= z.w || jj >= z.h || !z.bits[jj * z.w + ii]; }); if (edge) pts.push([z.x0 + i * 2, z.y0 + j * 2]); }
    const disc = (rad: number) => { c.beginPath(); for (const p of pts) { c.moveTo(p[0] * k + rad * k, p[1] * k); c.arc(p[0] * k, p[1] * k, rad * k, 0, Math.PI * 2); } c.fill(); };
    c.fillStyle = 'rgba(174,234,255,0.06)'; disc(MAX_LEN);
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; disc(MAX_LEN - 6);
    c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(174,234,255,0.04)'; disc(MAX_LEN - 6);
    const ring = document.createElement('canvas'); ring.width = cv.width; ring.height = cv.height; const rc = ring.getContext('2d')!;
    rc.fillStyle = 'rgba(174,234,255,0.55)'; for (const p of pts) { rc.beginPath(); rc.arc(p[0] * k, p[1] * k, MAX_LEN * k, 0, Math.PI * 2); rc.fill(); }
    rc.globalCompositeOperation = 'destination-out'; for (const p of pts) { rc.beginPath(); rc.arc(p[0] * k, p[1] * k, (MAX_LEN - 4) * k, 0, Math.PI * 2); rc.fill(); }
    c.drawImage(ring, 0, 0);
    rangeCache.set(push, cv);
  }
  return cv;
}
const drawAlpha = new Map<string, number>();   // 這一幀每個器官的透明度（FV／C 測試讀取）
let drawnSlots: V[] = [];                       // 這一幀畫出的縫合槽位（FV-05：和 stitchSlots 逐點相同）
const ringLogged = new Set<string>();
function draw(now: number): void {
  // 畫面時鐘：切除瞬間放慢（只影響畫面；規則時鐘在 frame() 用真實時間推進）
  if (G.lastFrame !== null && now >= G.hitstopUntil) G.dispT += (Math.min(250, now - G.lastFrame) / 1000) * (now < G.slowUntil ? SLOW_RATE : 1);   // hit-stop：畫面停 50ms（只影響畫面時鐘）
  G.lastFrame = now;
  if (now < G.slowUntil) G.slowLog.push({ now, step: G.game ? G.game.step : 0, clock: G.clock });
  const t = G.dispT;
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
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); if (isoOpt.clear) ctx.clearRect(0, 0, els.canvas.width, els.canvas.height); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, els.canvas.width, els.canvas.height); } ctx.restore();   // clear＝透明底（DF-04／05 讀 alpha 量本體範圍）
    const i = G.game.organs.findIndex((o) => o.id === isolateId);
    if (i >= 0) organ(G.game.organs[i], isoOpt.st ?? { mode: 'normal' }, 0);   // 和正式畫面同一個 organ()（覆審：不能另寫一份繪製）
    return;
  }
  const dimNow = G.ui === 'battle' || G.ui === 'contrib' ? BATTLE_DIM : G.ui === 'cut' || G.ui === 'pick' || G.ui === 'place' || G.ui === 'showcase' ? CUT_DIM : undefined;   // 戰鬥期本體更暗，器官才看得清（FS-06／補述 1 第 10a 條）
  const snake = G.camp?.beast === 'snake';
  drawScene(ctx, { w: W, h: H, body: ASSETS.body, rects: snake ? { ...RECTS, blue: { ...RECTS.blue, x: -9999, y: -9999 } } : RECTS }, t, dimNow);
  if (snake) drawSnake(t, dimNow ? dimNow.alpha : 1);
  if (G.ui === 'battle' || G.ui === 'contrib') {   // 戰鬥期壓暗前線帶（雙方獸身重疊區的亮紋只對切割期有意義；擠在前線的器官才看得清，FS-06）
    const path = (poly: V[]) => { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
    ctx.save(); path(bodyPoly('blue')); ctx.clip(); path(bodyPoly('red')); ctx.clip(); ctx.fillStyle = 'rgba(7,13,25,0.8)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  if (!G.game || G.ui === 'beast') return;   // 選怪獸畫面：只畫場景   // 切割期與縫合時本體調暗，器官才跳出來（縫合時要看得到原有器官，三-3）
  if (sceneOnly) return;   // 測試用：只畫場景（DF-05 比較切割期與戰鬥期的本體亮度；和正式畫面同一個 drawScene 呼叫）
  const s = G.game, pv = G.drag && G.preview?.ok ? G.preview : null, held = holdLit(), hold = holding(), inR = hold && G.input === 'line' ? reachNow() : null;   // 調暗只在直線預覽（DL-087）
  spriteCenters.clear(); drawAlpha.clear();
  // 前線帶（起刀區前緣，跟著 push 移動 300ms；push 變化時閃己方陣營色）
  if (G.ui === 'cut') {
    const e = frontNow(now), fl = Math.min(1, Math.max(0, 1 - (now - G.front.flash) / 500));
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
    for (const [lw, al] of [[10, 0.12], [3, 0.55]] as [number, number][]) {
      ctx.strokeStyle = fl > 0 ? (G.front.flashSide === 'blue' ? `rgba(127,200,255,${al + 0.4 * fl})` : `rgba(255,77,106,${al + 0.4 * fl})`) : `rgba(127,200,255,${al})`;
      ctx.lineWidth = lw + 6 * fl; ctx.beginPath(); let pen = false;
      e.forEach((y, i) => { if (!Number.isFinite(y)) { pen = false; return; } if (pen) ctx.lineTo(i * 10, y); else { ctx.moveTo(i * 10, y); pen = true; } }); ctx.stroke();
    }
    ctx.restore();
  }
  // 範圍輪廓（按住時）
  if (hold) { ctx.save(); ctx.drawImage(rangeLayer(s.push ?? 0), 0, 0, W, H); ctx.restore(); }
  // 傷口與再生倒數圈：只在「下一拍真的會長回」的那個切口畫倒數圈（補述 1 第 6 條）
  if (G.ui === 'cut') {
    const next = new Set<number>();
    if (s.mode.regen) for (const side of ['blue', 'red'] as Side[]) { if (!s.severedQ[side].length || countSide(s, side) >= (s.mode.maxPerSide?.[side] ?? 8)) continue; const ci = G.cuts.findIndex((c) => c.side === side && c.kind === s.severedQ[side][0]); if (ci >= 0) next.add(ci); }
    G.cuts.forEach((c, ci) => {
      ctx.save(); ctx.translate(c.p[0], c.p[1]);
      ctx.strokeStyle = c.side === 'blue' ? 'rgba(255,90,110,0.55)' : 'rgba(174,234,255,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(14, 6); ctx.moveTo(-10, 8); ctx.lineTo(10, -4); ctx.stroke();   // 傷口
      if (next.has(ci)) {
        const k = (s.step % REGEN_STEPS) / REGEN_STEPS; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(159,255,176,0.25)'; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#9fffb0'; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#9fffb0'; ctx.font = '600 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${Math.ceil(((1 - k) * REGEN_STEPS) / FPS)}`, 0, 6);
        const key = `${c.side}${c.kind}${c.step}`; if (!ringLogged.has(key)) { ringLogged.add(key); G.fxLog.push({ t: 'regenRing', at: now, side: c.side }); }
      }
      ctx.restore();
    });
  }
  const showCamp = G.ui === 'pick' || G.ui === 'place' || G.ui === 'showcase';
  if (showCamp) for (const o of blueOrgans(G.camp)) organ(o, { mode: 'normal' }, t);   // 縫合時顯示自己身上原有的器官（三-3）
  if (!showCamp && (G.ui === 'battle' || G.ui === 'contrib')) s.organs.forEach((o, i) => {   // 戰鬥期：每顆存活器官背後墊深色暈影，擠在前線帶或鄰居旁的器官也看得清（FS-06）
    if (!s.alive[i]) return;
    const g = ctx.createRadialGradient(o.p[0], o.p[1], R * 0.6, o.p[0], o.p[1], R * 2.3); g.addColorStop(0, 'rgba(7,13,25,0.9)'); g.addColorStop(0.75, 'rgba(7,13,25,0.7)'); g.addColorStop(1, 'rgba(7,13,25,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.p[0], o.p[1], R * 2.3, 0, Math.PI * 2); ctx.fill();
  });
  if (!showCamp) s.organs.forEach((o, i) => {
    if (!s.alive[i]) return;
    const sprout = G.ui === 'cut' && !isReady(s, i), locked = G.ui === 'cut' && isLocked(s, i), lit = Math.max(0, ((glowUntil.get(o.id) ?? 0) - now) / 260);
    const st: OrganStateV3 = sprout ? { mode: 'sprout', k: Math.min(1, 1 - (s.readyAt[i] - s.step) / 30) }
      : locked ? { mode: 'locked', k: (s.lockUntil[i] - s.step) / LOCK_STEPS, label: `${Math.ceil((s.lockUntil[i] - s.step) / FPS)}` } : { mode: 'normal' };
    st.cuttable = G.ui === 'cut' && o.side === 'red' && !sprout && !locked;
    st.lit = held.has(i) ? 1 : pv && pv.locks.includes(i) ? Math.max(lit, 0.7) : lit; st.target = !!pv && (pv.severed === i || pv.blocked === i);
    const al = inR && o.side === 'red' && !inR[i] && !sprout ? 0.4 : 1;   // 直線預覽：範圍外調暗；萌芽中的不調暗（≤0.5 秒後就能切，審查 L7）   // 範圍外的對方器官調暗（透明度 ≤ 範圍內的 50%，DUEL_V04_FRONT 二）
    drawAlpha.set(o.id, al);
    organ(o, st, t, al);
  });
  // 長出動畫（≥400ms）：綠色擴散環＋光點
  G.grows = G.grows.filter((g) => now - g.t0 < 600);
  // 進度一律夾到 [0,1]：rAF 的影格時間可能早於事件發生時的 performance.now()（慢幀時差更大），負半徑會讓 canvas 丟例外、整個迴圈停下
  for (const g of G.grows) { const k = Math.max(0, (now - g.t0) / 600); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(159,255,176,${1 - k})`; ctx.lineWidth = 6 * (1 - k) + 1; ctx.beginPath(); ctx.arc(g.p[0], g.p[1], R * (0.4 + 1.4 * k), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  // 被切：該器官位置爆紅光（350ms）＋紅色裂開
  G.hurts = G.hurts.filter((h) => now - h.t0 < 350);
  for (const h of G.hurts) { const k = Math.max(0, (now - h.t0) / 350), rr = R * (1 + 1.8 * k), g = ctx.createRadialGradient(h.p[0], h.p[1], 0, h.p[0], h.p[1], rr); g.addColorStop(0, `rgba(255,60,80,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(255,60,80,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(h.p[0] - rr, h.p[1] - rr, rr * 2, rr * 2); ctx.restore(); }
  for (let j = hurtSplits.length - 1; j >= 0; j--) {
    const f = hurtSplits[j], k = Math.max(0, (t - f.t0) / 0.5); if (k >= 1 || !ASSETS) { hurtSplits.splice(j, 1); continue; }
    const hs = splitHalves({ type: 'split', t0: f.t0, im: ASSETS.organs[AK(f.o.kind)], x: f.o.p[0], y: f.o.p[1], r: R * 1.25, angle: f.ang, side: f.o.side }, f.t0 + k * 0.5), dx = Math.cos(f.ang), dy = Math.sin(f.ang), L = R * 3;
    [-1, 1].forEach((sg, i) => { ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(hs[i][0], hs[i][1]); ctx.beginPath(); const cx = f.o.p[0], cy = f.o.p[1]; ctx.moveTo(cx - dx * L, cy - dy * L); ctx.lineTo(cx + dx * L, cy + dy * L); ctx.lineTo(cx + dx * L - dy * sg * L, cy + dy * L + dx * sg * L); ctx.lineTo(cx - dx * L - dy * sg * L, cy - dy * L + dx * sg * L); ctx.closePath(); ctx.clip(); if (ASSETS) drawOrganV3(ctx, ASSETS.organs[AK(f.o.kind)], { kind: AK(f.o.kind), side: f.o.side, x: cx, y: cy, r: R }, { mode: 'normal' }, t); ctx.restore(); });
  }
  G.splits = G.splits.filter((f) => playSplit(ctx, f, t));
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
  // 切中：刀痕加粗發光 150ms（三-4）
  G.cutGlow = G.cutGlow.filter((g) => now - g.t0 < 150);
  for (const g of G.cutGlow) { const k = Math.min(1, 1 - (now - g.t0) / 150); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; for (const [lw, c] of [[22, `rgba(127,200,255,${0.35 * k})`], [10, `rgba(174,234,255,${0.8 * k})`], [4, `rgba(255,255,255,${k})`]] as [number, string][]) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(g.a[0], g.a[1]); ctx.lineTo(g.b[0], g.b[1]); ctx.stroke(); } ctx.restore(); }
  // 即時劃刀的刀痕（跟手、淡出；鈍刀灰暗）
  if (G.trail.length) { drawTrail(ctx, G.trail, now / 1000, false); if (now / 1000 - G.trail[G.trail.length - 1].t > 0.3 && !G.fp) G.trail = []; }
  // 教學示範：虛擬手沿路徑劃過（只畫面，不出刀）
  if (G.tut && G.tut.phase === 'demo') {
    const k = (now - G.tut.t0) / 3000, [a, b] = G.tut.path, u = Math.max(0, Math.min(1, (k - 0.25) / 0.45));
    const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, pressed = k > 0.15 && k < 0.8;
    if (pressed && k > 0.25) { const pts: TrailPt[] = []; for (let j = 0; j <= 12; j++) { const uu = Math.max(0, u - j * 0.03); pts.unshift({ x: a[0] + (b[0] - a[0]) * uu, y: a[1] + (b[1] - a[1]) * uu, t: now / 1000 - j * 0.02 }); } drawTrail(ctx, pts, now / 1000, false); }
    drawTutorialHand(ctx, x, y, t, pressed);
  }
  // 出刀後的刀光
  G.slashes = G.slashes.filter((x) => now - x.t0 < 260);
  for (const x of G.slashes) {
    ctx.save(); ctx.globalAlpha = 1 - (now - x.t0) / 260;
    if (x.side === 'blue') drawBlade(ctx, x.a as [number, number], x.b as [number, number], [], t, false);
    else { ctx.strokeStyle = '#ff3b4f'; ctx.shadowColor = '#ff3b4f'; ctx.shadowBlur = 14; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x.a[0], x.a[1]); ctx.lineTo(x.b[0], x.b[1]); ctx.stroke(); }
    ctx.restore();
  }
  // 戰鬥特效（art-kit Fx2）
  G.fx = G.fx.filter((f) => playFx2(ctx, f, t));
  if (G.ui === 'battle' || G.ui === 'contrib') for (const side of ['blue', 'red'] as Side[]) {
    const d = G.disp[side], c = bodyCenter(side);
    if (d.poison) { ctx.save(); ctx.fillStyle = '#7CFF6B'; ctx.shadowColor = '#7CFF6B'; ctx.shadowBlur = 14; ctx.font = '600 34px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(`毒 ×${d.poison}`, c[0] + 150, c[1] - 60); ctx.restore(); }   // 毒層數：世界字級 34（約 19 CSS px，FS-06）
  }
  // 縫合擺放：插槽（可放／不可放）＋已縫器官的縫線
  drawnSlots = [];
  if (G.ui === 'place' || G.ui === 'pick' || G.ui === 'showcase') {
    for (const st of G.camp.stitches) drawSuture(ctx, st.p as [number, number], bodyCenter('blue') as [number, number], t);
    if (G.ui === 'place') {
      if (!G.slotCache || G.slotCache.camp !== G.camp) G.slotCache = { camp: G.camp, slots: stitchSlots(G.camp) };   // 每次縫合只算一次（審查 M1）
      drawnSlots = G.slotCache.slots;
      const pulse = 0.6 + 0.4 * Math.sin(now / 220);
      for (const q of drawnSlots) { ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#9fffb0'; ctx.shadowColor = '#9fffb0'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    }
    if (G.ghost && G.camp.picked) { drawSlot(ctx, G.ghost[0], G.ghost[1], R * 1.1, 'ok', t); ctx.save(); ctx.globalAlpha = 0.75; drawOrganSprite(ctx, ASSETS.organs[AK(G.camp.picked)], { kind: AK(G.camp.picked), side: 'blue', x: G.ghost[0], y: G.ghost[1], r: R * 0.85 }, { mode: 'normal' }, t); ctx.restore(); drawSuture(ctx, G.ghost as [number, number], bodyCenter('blue') as [number, number], t); }
  }
  // duel5 毒的攻擊連線（行動器官 → 對方本體，400ms）
  G.lines = G.lines.filter((l) => now - l.t0 < 400);
  for (const l of G.lines) { const k = Math.max(0, (now - l.t0) / 400); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(${l.color},${0.85 * (1 - k)})`; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.shadowColor = `rgb(${l.color})`; ctx.shadowBlur = 12; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -k * 60; ctx.beginPath(); ctx.moveTo(l.from[0], l.from[1]); ctx.lineTo(l.to[0], l.to[1]); ctx.stroke(); ctx.restore(); }
  // 橫幅切換紀錄（FS-06：「清空！」可見時間）
  { const bt = G.banner && now - G.banner.t0 < G.banner.life ? G.banner.text : ''; if (bt !== G.lastBanner) { G.fxLog.push({ t: 'banner', at: now, id: bt }); G.lastBanner = bt; } }
  // 跳字
  G.pops = G.pops.filter((q) => now - q.t0 < q.life);
  for (const q of G.pops) { if (now < q.t0) continue; const k = (now - q.t0) / q.life; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4); ctx.font = `italic 600 ${q.size}px Georgia, "Noto Serif TC", serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#070D19cc'; ctx.strokeText(q.text, q.p[0], q.p[1] - 36 * k); ctx.fillStyle = q.color; ctx.fillText(q.text, q.p[0], q.p[1] - 36 * k); ctx.restore(); }
  if (G.banner && now - G.banner.t0 < G.banner.life) {
    const k = (now - G.banner.t0) / G.banner.life, sc = k < 0.15 ? 1.8 - (k / 0.15) * 0.8 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3); ctx.translate(350, 500); ctx.scale(sc, sc); ctx.textAlign = 'center';
    ctx.font = 'italic 600 60px Georgia, "Noto Serif TC", serif'; ctx.lineWidth = 6; ctx.strokeStyle = '#070D19'; ctx.strokeText(G.banner.text, 0, 0); ctx.fillStyle = '#F0F7FF'; ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 16; ctx.fillText(G.banner.text, 0, 0);
    ctx.shadowBlur = 0; ctx.font = '600 20px system-ui'; ctx.lineWidth = 4; ctx.strokeText(G.banner.sub, 0, 36); ctx.fillStyle = '#AEEAFF'; ctx.fillText(G.banner.sub, 0, 36); ctx.restore();
  }
  if (G.countdown && counting() && G.ui === 'cut') {
    const ms = Math.max(0, now - G.countdown.t0), n = 3 - Math.floor(ms / (COUNTDOWN_MS / 3)), k = (ms % (COUNTDOWN_MS / 3)) / (COUNTDOWN_MS / 3);
    if (n >= 1) { ctx.save(); ctx.translate(350, 500); ctx.scale(1.6 - 0.6 * Math.min(1, k * 3), 1.6 - 0.6 * Math.min(1, k * 3)); ctx.textAlign = 'center'; ctx.globalAlpha = 1 - Math.max(0, k - 0.75) * 4;
      ctx.font = 'italic 700 120px Georgia, serif'; ctx.lineWidth = 8; ctx.strokeStyle = '#070D19'; ctx.strokeText(String(n), 0, 40); ctx.fillStyle = '#F0F7FF'; ctx.shadowColor = '#7FC8FF'; ctx.shadowBlur = 20; ctx.fillText(String(n), 0, 40);
      ctx.shadowBlur = 0; ctx.font = '600 22px system-ui'; ctx.lineWidth = 4; ctx.strokeText(`對手 ${G.camp.stage + 1}／${CB.STAGES}　切割 ${CB.CUT_SECONDS} 秒`, 0, 96); ctx.fillStyle = '#AEEAFF'; ctx.fillText(`對手 ${G.camp.stage + 1}／${CB.STAGES}　切割 ${CB.CUT_SECONDS} 秒`, 0, 96); ctx.restore(); }
  }
  // 結果字：同一時間可見的數量（畫布橫幅中的勝負字＋DOM 結算標題＋結束標題；FV-06）
  sampleResults(now);
  // FPS（每秒更新）
  fps.frames++; if (now - fps.t0 >= 1000) { fps.last = (fps.frames * 1000) / (now - fps.t0); fps.frames = 0; fps.t0 = now; }
}
function frame(now: number): void {
  if (!G.camp) { draw(now); requestAnimationFrame(frame); return; }
  tutTick(now);
  if (G.countdown && now - G.countdown.t0 >= COUNTDOWN_MS) { G.countdown = null; G.lastT = null; G.fxLog.push({ t: 'go', at: now }); }
  if (G.ui === 'showcase' && els.nextFoe.hidden && now - G.showcaseT0 >= SHOWCASE_MS) els.nextFoe.hidden = false;
  if (frameStall > 0) { const t = performance.now(); while (performance.now() - t < frameStall) { /* 測試用：模擬慢裝置的長幀（事件時間晚於這一幀的 rAF 時間） */ } }
  if (G.ui === 'cut' && !G.manual && !(G.tut && G.tut.phase === 'demo') && !counting()) {
    // 規則時鐘：真實時間推進（不受畫面放慢影響）。直線預覽＝duel2 的節奏；即時劃刀晚 2 步跑，讓所屬步的事件到齊
    if (G.lastT === null) G.lastT = now;
    G.clock += Math.min(250, now - G.lastT); G.lastT = now;
    const lag = G.input === 'free' ? FREE_LAG_MS : 0;
    while (G.ui === 'cut' && (G.game.step + 1) * STEP_MS + lag <= G.clock) stepOnce();
  } else G.lastT = now;
  if (G.pendingBattle && now >= G.pendingBattle) { G.pendingBattle = 0; startBattle(); }
  if (G.matchupUntil && now >= G.matchupUntil) { G.matchupUntil = 0; els.matchup.hidden = true; G.banner = { text: '戰鬥！', sub: '剩下的器官自動開打', t0: now, life: 1100 }; }
  battleTick(now);
  if (G.ui === 'cut') hud(); else if (G.ui === 'battle') hud();
  draw(now);
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { G.lastT = null; });

// ---------------------------------------------------------------- 測試掛勾（作者測試讀取；不影響遊戲）
(window as unknown as { __cb: unknown }).__cb = {
  get spriteCenters() { return Object.fromEntries(spriteCenters); }, isolate: (id: string | null, opt: { clear?: boolean; st?: OrganStateV3 } = {}) => { isolateId = id; isoOpt = opt; }, get fps() { return fps.last; }, get assetsReady() { return !!ASSETS; }, get loadLog() { return loadLog; },
  get camp() { return G.camp; }, get game() { return G.game; }, get ui() { return G.ui; }, get preview() { return G.preview; }, get lastStrike() { return G.lastStrike; },
  get battle() { return G.battle; }, get vis() { return G.vis; }, get tip() { return els.tip.hidden ? null : els.tip.textContent; }, get cutByMe() { return G.cutByMe; },
  get audio() { return audioLog; }, get tipsShown() { return [...G.tipsShown]; }, get tipLog() { return [...tipLog]; },
  toScreen, newRun: (o?: { seed?: number; beast?: Beast }) => newRun(o?.seed, o?.beast ?? (G.camp?.beast)),   // duel5：沒指定怪獸時沿用這個征途的怪獸（舊測試的 newRun 不會跳出選擇畫面）
  setManual: (v: boolean) => { G.manual = v; }, advance: (n: number) => { G.countdown = null; for (let i = 0; i < n && G.ui === 'cut'; i++) stepOnce(); hud(); },   // 測試驅動：手動推進時倒數視為已結束
  setTimings: (o: { battleScale?: number }) => { if (o.battleScale !== undefined) G.battleScale = o.battleScale; },
  // duel3
  get input() { return G.input; }, get clock() { return G.clock; }, get lastFree() { return G.lastFree; }, get freeLog() { return [...G.freeLog]; }, get stepSig() { return [...G.stepSig]; },
  get slowLog() { return [...G.slowLog]; }, get splits() { return G.splits.length; }, get trail() { return G.trail.length; }, get tut() { return G.tut && { phase: G.tut.phase, hint: G.tut.hint, text: els.tut.hidden ? null : els.tutText.textContent }; },
  get held() { return [...holdLit()]; }, get provisionalArt() { return PROVISIONAL; }, R,
  feed: (evs: PtrEv[]) => { for (const e of evs) G.slicer.push(e); }, setFx: (v: boolean) => { G.fxOn = v; }, setSceneOnly: (v: boolean) => { sceneOnly = v; }, get dispT() { return G.dispT; },
  setInput: (m: 'free' | 'line') => { G.input = m; G.slicer = new Slicer(); hud(); }, skipTut: () => { const demo = G.tut?.phase === 'demo'; markTut(); tutEnd(); if (demo && G.ui === 'cut') startCountdown(); },
  // duel4
  get countdown() { return G.countdown ? Math.max(0, COUNTDOWN_MS - (performance.now() - G.countdown.t0)) : 0; }, skipCountdown: () => { G.countdown = null; G.lastT = null; },
  get fxLog() { return G.fxLog.map((x) => ({ ...x })); }, get resultMax() { return G.resultMax; }, resetResultMax: () => { G.resultMax = 0; },
  get slots() { return drawnSlots.map((q) => [q[0], q[1]]); }, get ruleSlots() { return stitchSlots(G.camp).map((q) => [q[0], q[1]]); }, get campOrgans() { return blueOrgans(G.camp).map((o) => ({ id: o.id, p: o.p })); },
  get push() { return G.game ? G.game.push ?? 0 : 0; }, get inRange() { return reachNow(); }, get drawAlpha() { return Object.fromEntries(drawAlpha); }, get holding() { return holding(); },
  get nextFoe() { return !els.nextFoe.hidden; },
  // duel5
  get beast() { return G.camp?.beast ?? null; }, get lastBeast() { return lastBeast; }, get matchup() { return G.matchupInfo && { ...G.matchupInfo, shown: !els.matchup.hidden }; }, get cutS() { return CUT_S; },
  get skill() { return { text: els.skill.textContent, disabled: els.skill.disabled, hidden: els.skill.hidden, used: !!G.game?.skillUsed?.blue, pierce: G.game?.pierce?.blue ?? null }; }, get canvasScale() { return scale; }, get aimCount() { return G.aimCount; }, setFrameStall: (ms: number) => { frameStall = ms; }, get frontEdge() { return frontNow(performance.now()); },
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
