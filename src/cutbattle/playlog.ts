// duel6 試玩紀錄（G5）：純模組。不 import 任何規則層／戰鬥／征途模組，不碰 GameState 與時序；
// 只吃「事件／快照」輸入（主程式之後在場結束、局結束時呼叫）。儲存以注入的 StorageLike 提供，Node 可測。
// 寫入時機：只在 endStage／setStitch／endRun／sweep／clear 時寫，劃刀途中絕不寫（避免長幀影響即時時序）。
// 已知限制：同時開兩個分頁時，後開的分頁會把先開分頁「進行中」的局誤標為 unfinished（sweep 無法分辨）。

export const PLAYLOG_KEY = 'duel6-playlog';
export const MAX_RUNS = 50;
export const CLEAR_WINDOW_MS = 3000;

export type StartedVia = 'first' | 'again' | 'restart';
export type TutorialState = 'done' | 'skipped' | 'aborted' | 'none' | 'before';
export type RunResult = 'won' | 'lost' | 'abandoned' | 'unfinished' | 'playing';
export type InputMode = 'free' | 'line';
export type Beast = 'snake' | 'dragon';
export interface TieRec { blue: number; red: number; result: 'win' | 'loss' | 'replay'; forced?: true }
export interface StitchRec { offer: string[]; picked: string; p: { x: number; y: number } }
export interface StageRec {
  stage: number; replay: number; firstCutSec: number | null; strokes: number; cuts: number; cutBy: number;
  locks: number; blocked: number; maxPush: number; maxPushAi: number;
  skill: null | { sec: number; pierce?: number };
  endOrgans: { blue: string[]; red: string[] }; input: InputMode;
  battle: { winner: string; how: string; ms: number; fastAtMs: number | null };
  tiebreak: TieRec | null; stitch: StitchRec | null;
}
export interface RunRec {
  runIdx: number; startedVia: StartedVia; gapSec: number | null; startedAt: string; ver: 'duel6'; sha: string;
  beast: Beast; cutSec: number; input: InputMode; tutorial: TutorialState; result: RunResult; totalSec: number; stages: StageRec[];
}
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface PlaylogOpts { storage: StorageLike | null | (() => StorageLike | null); sha: string; now?: () => number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pad = (n: number) => String(n).padStart(2, '0');
export function localTimeString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 解析儲存內容；非法 JSON、非陣列、任一元素型別錯 → 回 []（當成空的），絕不丟例外。 */
export function parseRuns(raw: string | null): RunRec[] {
  if (raw == null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    for (const r of v) {
      if (!isObj(r) || typeof r.runIdx !== 'number' || typeof r.result !== 'string' || !Array.isArray(r.stages)) return [];
      for (const s of r.stages) if (!isObj(s) || typeof s.stage !== 'number') return [];
    }
    return v as RunRec[];
  } catch { return []; }
}

export interface Playlog {
  readonly runs: readonly RunRec[];
  beginRun(info: { startedVia: StartedVia; beast: Beast; cutSec: number; input: InputMode; tutorial: TutorialState }): void;
  setTutorial(t: TutorialState): void;
  endStage(s: StageRec): void;
  setStitch(st: StitchRec): void;
  endRun(result: 'won' | 'lost', totalSec?: number): void;
  /** 重新征途：本局還在進行才標 abandoned；結果畫面（已結束）按重新征途不改前一局。回傳是否真的標了。 */
  abandonIfOpen(): boolean;
  clear(): void;
  copyText(): string;
}

export function createPlaylog(o: PlaylogOpts): Playlog {
  const now = o.now ?? (() => Date.now());
  const store = (): StorageLike | null => { try { return typeof o.storage === 'function' ? o.storage() : o.storage; } catch { return null; } };
  const read = (): RunRec[] => { try { return parseRuns(store()?.getItem(PLAYLOG_KEY) ?? null); } catch { return []; } };
  let runs: RunRec[] = read();
  const persist = (): void => {
    if (runs.length > MAX_RUNS) runs = runs.slice(runs.length - MAX_RUNS); // 刪最舊，順序不變
    try { store()?.setItem(PLAYLOG_KEY, JSON.stringify(runs)); } catch { /* 儲存被封鎖：記憶體仍保有，本次開頁可複製 */ }
  };
  // 開頁掃描：遺留的進行中局補標 unfinished（已打完的場次保留）
  let dirty = false;
  for (const r of runs) if (r.result === 'playing') { r.result = 'unfinished'; dirty = true; }
  if (dirty) persist();

  let cur: RunRec | null = null;
  let curStartMs = 0;
  let pageRuns = 0;
  let lastEndMs: number | null = null;

  const finish = (result: RunResult, totalSec?: number): void => {
    if (!cur) return;
    cur.result = result;
    cur.totalSec = r2(totalSec ?? (now() - curStartMs) / 1000);
    lastEndMs = now();
    persist();
  };

  return {
    get runs() { return runs; },
    beginRun(info) {
      const t = now();
      pageRuns++;
      cur = {
        runIdx: pageRuns, startedVia: info.startedVia, gapSec: pageRuns === 1 || lastEndMs === null ? null : r2((t - lastEndMs) / 1000),
        startedAt: localTimeString(t), ver: 'duel6', sha: o.sha, beast: info.beast, cutSec: info.cutSec, input: info.input,
        tutorial: info.tutorial, result: 'playing', totalSec: 0, stages: [],
      };
      curStartMs = t;
      runs.push(cur);
      if (runs.length > MAX_RUNS) runs = runs.slice(runs.length - MAX_RUNS);
    },
    setTutorial(t) { if (cur) cur.tutorial = t; },
    endStage(s) {
      if (!cur) return;
      const c = clone(s);
      if (c.firstCutSec !== null) c.firstCutSec = r2(c.firstCutSec);
      if (c.skill) c.skill.sec = r2(c.skill.sec);
      cur.stages.push(c);
      persist();
    },
    setStitch(st) {
      if (!cur || !cur.stages.length) return;
      cur.stages[cur.stages.length - 1].stitch = clone(st);
      persist();
    },
    endRun(result, totalSec) { if (cur && cur.result === 'playing') finish(result, totalSec); },
    abandonIfOpen() {
      if (!cur || cur.result !== 'playing') return false;
      finish('abandoned');
      return true;
    },
    clear() { runs = runs.filter((r) => r === cur && r.result === 'playing'); persist(); }, // 進行中的局保留
    copyText() { return formatCopy(runs, o.sha, localTimeString(now())); },
  };
}

// ---- 清除按兩次的純狀態機（3 秒內再按才清除；不用 confirm()） ----
export type ClearState = { phase: 'idle' } | { phase: 'armed'; at: number };
export const CLEAR_IDLE: ClearState = { phase: 'idle' };
/** 按下「清除」。idle→armed；armed 且距上次 ≤3000ms→cleared（回到 idle）；逾時視同重新 armed。 */
export function pressClear(s: ClearState, nowMs: number): { state: ClearState; action: 'armed' | 'cleared' } {
  if (s.phase === 'armed' && nowMs - s.at >= 0 && nowMs - s.at <= CLEAR_WINDOW_MS) return { state: CLEAR_IDLE, action: 'cleared' };
  return { state: { phase: 'armed', at: nowMs }, action: 'armed' };
}
/** 顯示用：逾時回到 idle（按鈕文字改回「清除」）。 */
export function tickClear(s: ClearState, nowMs: number): ClearState {
  return s.phase === 'armed' && nowMs - s.at > CLEAR_WINDOW_MS ? CLEAR_IDLE : s;
}


// ---- 複製文字 ----
const VIA_ZH: Record<StartedVia, string> = { first: '首局', again: '再來一局', restart: '重新征途' };
const RES_ZH: Record<RunResult, string> = { won: '征途勝', lost: '敗', abandoned: '中途放棄', unfinished: '未完成', playing: '進行中' };
const TUT_ZH: Record<TutorialState, string> = { done: '教學看完', skipped: '教學跳過', aborted: '教學被打斷', none: '無教學', before: '教學已看過' };
const BEAST_ZH: Record<Beast, string> = { snake: '蛇', dragon: '龍' };

export function stageSummary(s: StageRec): string {
  let out: string;
  if (s.tiebreak) out = `平手比切除 ${s.tiebreak.blue}：${s.tiebreak.red} ${s.tiebreak.result === 'win' ? '勝' : s.tiebreak.result === 'loss' ? '敗' : '重打'}`;
  else out = s.battle.winner === 'blue' ? '勝' : s.battle.winner === 'red' ? '敗' : '平';
  let t = `第 ${s.stage} 場 ${out} 切 ${s.cuts} 被切 ${s.cutBy}`;
  if (s.replay > 0) t += ` 重打${s.replay}`;
  if (s.firstCutSec !== null) t += ` 首刀 ${s.firstCutSec} 秒`;
  if (s.skill) t += ` 技能 ${s.skill.sec} 秒`;
  if (s.battle.fastAtMs !== null) t += ` 快轉 ${s.battle.fastAtMs}ms`;
  return t;
}
export function runSummary(r: RunRec): string {
  const gap = r.gapSec !== null ? ` 間隔 ${r.gapSec} 秒` : '';
  const head = `#${r.runIdx} ${BEAST_ZH[r.beast]} ${VIA_ZH[r.startedVia]} ${RES_ZH[r.result]}｜${r.startedAt}｜共 ${r.totalSec} 秒${gap}｜切割期 ${r.cutSec} 秒 ${r.input === 'line' ? '直線' : '自由'} ${TUT_ZH[r.tutorial]}`;
  return r.stages.length ? `${head}\n${r.stages.map(stageSummary).join('｜')}` : head;
}
export function formatCopy(runs: readonly RunRec[], sha: string, timeStr: string): string {
  const lines = [`THE CUT 試玩紀錄 v1｜duel6 ${sha}｜${runs.length} 局｜${timeStr}`];
  for (const r of runs) lines.push(runSummary(r));
  lines.push('```json', JSON.stringify(runs, null, 1), '```');
  return lines.join('\n');
}
