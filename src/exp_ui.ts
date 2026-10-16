// FUN-EXP-01 實驗版 UI 用純函式（文字、紀錄、問卷、localStorage）。不呼叫 act／replay／newBattle（凍結驗收 T-6 涵蓋本檔）；
// 規則判斷全部來自 engine/src/experiment.ts 的 UI 用純函式與引擎回傳的事件。
import { EXP_SPEC, TEAR_MULTIPLIER, expRoundFacts, keepWoundCheck, obsessionPreview, tearPreview, woundCrossedBy } from '../engine/src/experiment.ts';
import type { ExpRoundFacts, KeepWoundReason, ObsessionPreview } from '../engine/src/experiment.ts';
import type { BattleConfig, BattleState, Partition } from '../engine/src/engine.ts';
import type { Ev, Organ } from '../engine/src/types.ts';
import { EXP_PARAMS } from './exp_params.ts';
import type { ExpModeId } from './exp_params.ts';

export type { ExpModeId };
export const SIDE_NAME = { L: '紫側', R: '橙側' } as const;
const GLYPH: Record<string, string> = { heart: '心', shield: '盾', poison: '毒', fission: '裂', regen: '生', mirror: '鏡', core: '核', seedling: '苗' };
const INC_TEXT: Record<string, string> = { heart: '你對屠夫 3 傷', shield: '你 +3 盾', poison: '雙方各受 2 傷', fission: '兩側各長出一顆核心', regen: '下回合長出小再生腺', mirror: '鏡膜被切碎失效（無數值效果）', seedling: '無效果' };

export interface ModeDef { id: ExpModeId; top: 'BASELINE' | 'A' | 'B'; name: string; enemyName: string; blurb: string }
export const MODES: Record<ExpModeId, ModeDef> = {
  BASELINE: { id: 'BASELINE', top: 'BASELINE', name: '原版對照（BASELINE）', enemyName: '狂戰屠夫', blurb: '屠夫：70% 看哪側攻擊器官多、30% 看實際得失；求生優先：某側會讓牠死，牠就拿另一側。' },
  A1: { id: 'A1', top: 'A', name: '實驗 A：致命執念', enemyName: 'A1 狂心屠夫', blurb: '「牠只要看到心臟就失去理智。」兩側心臟數不同，牠就拿心臟多的一側；求生優先。' },
  A2: { id: 'A2', top: 'A', name: '實驗 A：致命執念', enemyName: 'A2 傲慢血王', blurb: '「牠只吃大塊的。」兩側面積差 ≥ 10%，牠就拿面積大的一側；求生優先。' },
  B: { id: 'B', top: 'B', name: '實驗 B：留下傷口', enemyName: '狂戰屠夫', blurb: '刀中效果可以「封存」成傷口；下一刀穿過傷口就加倍爆發，沒穿過就癒合作廢。（敵人同原版屠夫）' },
};

/** 以模式與種子組出引擎設定；怪物 HP 一律走 BattleConfig.hpE（不是只改畫面）。 */
export function expBattleConfig(mode: ExpModeId, seed: number): BattleConfig {
  const base = {
    seed, model: 'A', rules: { ph: 'PH-M', so: 'SO-3', hs: 'HS-1', sem: 'SEM-1' }, enemy: { kind: 'BUT', w10: 7 },
    hpP: EXP_PARAMS.hpP, hpE: EXP_PARAMS.hpE[mode], r: 160, anchorCount: 12, maxRounds: 12,
  } as unknown as BattleConfig;
  if (mode === 'A1') return { ...base, enemy: { kind: 'OBS_HEART', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'A2') return { ...base, enemy: { kind: 'OBS_AREA', w10: 7 }, exp: { mode: 'A' } };
  if (mode === 'B') return { ...base, exp: { mode: 'B' } };
  return base;
}

export const glyphOf = (key: string): string => GLYPH[key] ?? key;
export const organGlyphs = (os: { key: string }[]): string[] => os.map((o) => glyphOf(o.key));

// ---------------------------------------------------------------- 預覽文字

/** 實驗 A 預覽：兩側執念指標＋「執念會讓牠拿 X 側——除非那側會讓牠死」。純公開規則比較，不判定致死。 */
export function obsessionHtml(s: BattleState, part: Partition): string {
  const o: ObsessionPreview | null = obsessionPreview(s, part);
  if (!o) return '';
  const metric = o.metric === 'HEART'
    ? `<span class="sideL">紫側 心臟 ${o.L} 顆</span>｜<span class="sideR">橙側 心臟 ${o.R} 顆</span>`
    : `<span class="sideL">紫側 面積 ${o.pct!.L}%</span>｜<span class="sideR">橙側 面積 ${o.pct!.R}%</span>`;
  const verdict = o.side
    ? `執念會讓牠拿 <b class="${o.side === 'L' ? 'sideL' : 'sideR'}">${SIDE_NAME[o.side]}</b>——除非那側會讓牠死（求生優先）`
    : (o.metric === 'HEART' ? '兩側心臟一樣多：執念不分高下，照原版屠夫評分（求生仍優先）' : '兩側面積差不到 10%：執念不啟動，照原版屠夫評分（求生仍優先）');
  return `<div class="obs"><b>執念指標</b> ${metric}<br>${verdict}</div>`;
}

/** 實驗 B 預覽：目前切線會穿過傷口時，直接列出封存內容（不試算結算）。 */
export function tearHtml(s: BattleState, part: Partition): string {
  if (!s.wound || !part.legal || !woundCrossedBy(s, part.i, part.j)) return '';
  const t = tearPreview(s)!;
  const items = t.keys.map((k) => `${glyphOf(k)}：${INC_TEXT[k] ?? '—'} ×${t.times}`).join('；');
  return `<div class="tear"><b>這刀會撕裂傷口：＋</b>${items}</div>`;
}

/** 目前切線是否會撕裂傷口（畫面加亮用）。 */
export function crossesWound(s: BattleState, part: Partition): boolean {
  return !!s.wound && part.legal && woundCrossedBy(s, part.i, part.j);
}

/** 傷口狀態常駐說明（預覽區共用）。 */
export function woundStatusText(s: BattleState): string {
  if (!s.wound) return '目前沒有傷口';
  return `傷口：封存 ${organGlyphs(s.wound.sealed).join(' ')}（第 ${s.wound.round} 回合留下）——這刀要穿過它才會發動 ×2，沒穿過就癒合作廢`;
}

const KEEP_WHY: Record<KeepWoundReason, string> = {
  NOT_EXPERIMENT_B: '只有實驗 B 可以留傷口',
  ILLEGAL_LINE: '這條切線不合法',
  TEAR_ROUND: '不能勾：這刀會撕裂現有傷口，撕裂的那一回合不能再留新傷口',
  PIERCED_NONE: '不能勾：這刀沒有切穿任何器官，沒東西可封存',
  PIERCED_TOO_MANY: '不能勾：這刀切穿 3 顆以上，最多只能封存 1～2 顆',
};
export interface KeepUi { visible: boolean; enabled: boolean; why: string }
export function keepWoundUi(s: BattleState, part: Partition): KeepUi {
  if (s.config.exp?.mode !== 'B') return { visible: false, enabled: false, why: '' };
  const c = keepWoundCheck(s, part);
  return { visible: true, enabled: c.ok, why: c.ok ? '刀中效果延到下回合、加倍；下回合切線要穿過傷口才會發動' : (c.reason ? KEEP_WHY[c.reason] : '') };
}

// ---------------------------------------------------------------- 因果回顧文字（只解釋已發生的事件）

const NAME: Record<string, string> = { heart: '狂暴心臟', shield: '骨盾腺', poison: '劇毒膽囊', fission: '裂變魔核', regen: '再生腺', mirror: '反傷鏡膜', core: '裂變核心', seedling: '小再生腺' };
const WHO = { P: '你', E: '屠夫' } as const;
/** 把引擎回傳的事件逐條轉成回顧文字（含傷口留／撕／癒）；器官 id 由切前盤面、分區與封存內容還原名稱。 */
export function reviewLines(events: Ev[], before: BattleState, part: Partition): string[] {
  const names = new Map<number, string>();
  for (const o of [...(before.board?.organs ?? []), ...part.L, ...part.R, ...part.pierced, ...(before.wound?.sealed ?? [])]) names.set(o.id, NAME[o.key] ?? o.key);
  for (const e of events) if (e.t === 'WOUND' && e.op === 'TEAR' && e.copies) e.copies.forEach((id, k) => names.set(id, `${names.get(e.organs[Math.floor(k / TEAR_MULTIPLIER)]) ?? '封存器官'}（撕裂複本）`));
  const nm = (id: number): string => names.get(id) ?? `器官#${id}`;
  const out: string[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'PIERCE': out.push(`刀鋒穿刺：${nm(e.id)}`); break;
      case 'WOUND':
        out.push(e.op === 'KEEP' ? `留下傷口：封存 ${e.organs.map(nm).join('、')}（本回合它們的刀中效果不發動）`
          : e.op === 'TEAR' ? `撕裂傷口：封存的 ${e.organs.map(nm).join('、')} 刀中效果各發動 ${TEAR_MULTIPLIER} 次`
            : `傷口癒合：封存的 ${e.organs.map(nm).join('、')} 效果作廢`);
        break;
      case 'INC': out.push(`刀中效果：${nm(e.id)}（${e.effect === 'SPAWN_CORES' ? '兩側生成核心' : e.effect === 'SCHEDULE_SEEDLING' ? '下回合長出小再生腺' : '鏡膜被切碎'}）`); break;
      case 'STEP': if (e.name === 'INCISION') out.push('— 刀中效果 —'); else if (e.name === 'HARVEST') out.push('— 盾、治療、傷害 —'); break;
      case 'CHOICE': out.push(`屠夫拿走 ${SIDE_NAME[e.side]}（${CHOICE_TEXT[e.reason] ?? e.reason}）`); break;
      case 'SHIELD': out.push(`${WHO[e.who]}獲得 ${e.n} 盾`); break;
      case 'HEAL': out.push(`${WHO[e.who]}回復 ${e.actual}`); break;
      case 'DMG': {
        const what = e.kind === 'SELF_POISON' ? '劇毒膽囊反噬' : e.kind === 'INC_POISON' || e.kind === 'INC_POISON_SELF' ? '毒囊被切破' : e.kind === 'CORE' ? '裂變核心' : e.kind === 'REFLECT' ? '鏡膜反射' : '攻擊';
        out.push(`${what}：${WHO[e.src]} → ${WHO[e.dst]} ${e.raw} 傷（盾吸收 ${e.abs}，實扣 ${e.loss}）`); break;
      }
      case 'REFL': out.push(`${WHO[e.who]}的鏡膜反射 ${e.amount}`); break;
      case 'END': out.push(`結束：${e.result}`); break;
      default: break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 回顧與紀錄

export const CHOICE_TEXT: Record<string, string> = {
  SURVIVAL: '求生優先：另一側會讓牠死', 'SO-3': '兩側都致死：選讓你損失最小的一側（SO-3）', OBSESSION: '執念觸發：牠被執念牽著走', PREF: '依偏好評分較高', BAND: '依偏好帶',
  'TIE-v': '評分相同，比實際得失', 'TIE-area': '再相同，比面積', 'TIE-fixed': '再相同，固定側', FORCED: '只剩一側', 'SO-1': 'SO-1', 'SO-2': 'SO-2',
};
/** 選邊理由的簡短分類（回顧用）：求生／兩側致死／執念／照原版評分。 */
export function reasonKind(reason: string | null): string {
  if (!reason) return '—';
  if (reason === 'SURVIVAL') return '求生';
  if (reason.startsWith('SO-')) return '兩側致死';
  if (reason === 'OBSESSION') return '執念';
  return '照原版評分';
}

export interface RoundRecord {
  round: number; i: number; j: number; keepWound: boolean; prediction: 'L' | 'R' | null; baitIntent: boolean | null;
  sideL: string[]; sideR: string[]; pierced: string[];
  choiceSide: 'L' | 'R' | null; choiceReason: string | null; reasonKind: string;
  obsessionTriggered: boolean; obsession: ObsessionPreview | null;
  hpBefore: { P: number; E: number }; hpAfter: { P: number; E: number };
  woundBefore: string[] | null; wound: ExpRoundFacts['wound']; tearHpLoss: ExpRoundFacts['tearHpLoss'];
  stateHashAfter: string; events: Ev[];
}
export interface Survey { Q1: string; Q2: string; Q3: string; Q4: string; Q5: string; Q5_why: string }
export const SURVEY_Q: { id: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5'; text: string; kind: 'choice' | 'text' }[] = [
  { id: 'Q1', text: 'Q1 你是否理解為什麼敵人選這一側？', kind: 'choice' },
  { id: 'Q2', text: 'Q2 你有沒有故意設計陷阱？', kind: 'choice' },
  { id: 'Q3', text: 'Q3 你有沒有為下一回合做準備？', kind: 'choice' },
  { id: 'Q4', text: 'Q4 哪一次切割最有成就感？為什麼？', kind: 'text' },
  { id: 'Q5', text: 'Q5 你是否願意再玩一次？為什麼？', kind: 'choice' },
];
export const emptySurvey = (): Survey => ({ Q1: '', Q2: '', Q3: '', Q4: '', Q5: '', Q5_why: '' });

export interface ExpLog {
  format: 'thecut-funexp01-log/1';
  modeId: ExpModeId; specVersion: string; engineSpecVersion: string; engineVersion: string; commit: string;
  seed: number; board: string; hpE: number; hpP: number; configHash: string; config: BattleConfig;
  rounds: RoundRecord[]; roundsPlayed: number; result: string | null; finalStateHash: string | null;
  summary: { obsessionTriggers: number | null; woundKept: number | null; woundTorn: number | null; woundHealed: number | null };
  survey: Survey;
}

export function newLog(mode: ExpModeId, s: BattleState, board: string, commit: string): ExpLog {
  const m = MODES[mode];
  return {
    format: 'thecut-funexp01-log/1', modeId: mode,
    specVersion: m.top === 'BASELINE' ? 'BASELINE（無實驗規格）' : EXP_SPEC[m.top],
    engineSpecVersion: s.specVersion, engineVersion: s.engineVersion, commit, seed: s.config.seed, board,
    hpE: s.config.hpE, hpP: s.config.hpP, configHash: s.configHash, config: s.config,
    rounds: [], roundsPlayed: 0, result: null, finalStateHash: null,
    summary: { obsessionTriggers: null, woundKept: null, woundTorn: null, woundHealed: null },
    survey: emptySurvey(),
  };
}

/** 由切前狀態、分區、引擎回傳事件與切後狀態整理一回合紀錄（X-11；不含任何個人識別欄位）。 */
export function roundRecord(before: BattleState, part: Partition, keepWound: boolean, events: Ev[], after: BattleState, hashAfter: string, input: { prediction: 'L' | 'R' | null; baitIntent: boolean | null }): RoundRecord {
  const f = expRoundFacts(before, part, events);
  return {
    round: before.round, i: part.i, j: part.j, keepWound, prediction: input.prediction, baitIntent: input.baitIntent,
    sideL: organGlyphs(part.L), sideR: organGlyphs(part.R), pierced: organGlyphs(part.pierced),
    choiceSide: f.choiceSide, choiceReason: f.choiceReason, reasonKind: reasonKind(f.choiceReason),
    obsessionTriggered: f.obsessionTriggered, obsession: f.obsession,
    hpBefore: { P: before.hp.P, E: before.hp.E }, hpAfter: { P: after.hp.P, E: after.hp.E },
    woundBefore: before.wound ? before.wound.sealed.map((o: Organ) => glyphOf(o.key)) : null,
    wound: f.wound, tearHpLoss: f.tearHpLoss, stateHashAfter: hashAfter, events: JSON.parse(JSON.stringify(events)),
  };
}

export function finishLog(log: ExpLog, s: BattleState, hash: string): void {
  log.result = s.result; log.finalStateHash = hash; log.roundsPlayed = log.rounds.length;
  refreshSummary(log);
}
export function refreshSummary(log: ExpLog): void {
  const top = MODES[log.modeId].top;
  const ops = log.rounds.flatMap((r) => r.wound.map((w) => w.op));
  log.summary = {
    obsessionTriggers: top === 'A' ? log.rounds.filter((r) => r.obsessionTriggered).length : null,
    woundKept: top === 'B' ? ops.filter((o) => o === 'KEEP').length : null,
    woundTorn: top === 'B' ? ops.filter((o) => o === 'TEAR').length : null,
    woundHealed: top === 'B' ? ops.filter((o) => o === 'HEAL').length : null,
  };
}

const RESULT_TEXT: Record<string, string> = { WIN: '勝利（怪物倒下）', LOSS: '失敗', STALL: '僵持（12 回合未分勝負）', INVALID: '無效盤面' };
/** 戰鬥結束簡短回顧（HTML）。 */
export function summaryHtml(log: ExpLog): string {
  const m = MODES[log.modeId], su = log.summary;
  const rows: [string, string][] = [
    ['模式', `${m.name}（${m.enemyName}）`],
    ['回合數', `${log.roundsPlayed}`],
    ['結果', RESULT_TEXT[log.result ?? ''] ?? String(log.result)],
    ['執念觸發次數', su.obsessionTriggers === null ? '—（此模式沒有執念）' : `${su.obsessionTriggers}`],
    ['傷口 留／撕／癒', su.woundKept === null ? '—（此模式沒有傷口）' : `${su.woundKept}／${su.woundTorn}／${su.woundHealed}`],
  ];
  return `<table class="sum"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- 匯出與 localStorage

export function exportText(log: ExpLog): string { return JSON.stringify(log); }
const KEY = 'funexp01.recent';
const MAX_RECENT = 5;
type Stored = ExpLog & { _gid?: string };
function loadRecent(): Stored[] {
  try { const t = localStorage.getItem(KEY); const a = t ? JSON.parse(t) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
/** 只存最近 MAX_RECENT 局；同一局（gameId）更新同一筆。讀寫都包 try/catch，失敗不影響遊戲。 */
export function saveRecent(gameId: string, log: ExpLog): void {
  try {
    const all = loadRecent();
    const copy: Stored = { ...log, _gid: gameId };
    const k = all.findIndex((x) => x._gid === gameId);
    if (k >= 0) all[k] = copy; else all.push(copy);
    localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX_RECENT)));
  } catch { /* 無痕模式或被封鎖：略過 */ }
}
export function recentText(): string {
  return JSON.stringify(loadRecent().map((x) => { const { _gid, ...rest } = x; void _gid; return rest; }));
}
