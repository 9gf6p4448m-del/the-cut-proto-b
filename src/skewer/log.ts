// 串刺紀錄與問卷（純函式，不碰 DOM）。只收研究需要的欄位：不含名字、裝置、時間戳等個人識別資訊。
import type { BoardDef, GameState, Line, LoseReason, Result, TurnRecord } from './rules.ts';

export type PlayMode = 'swipe' | 'draw' | 'pick';
export const LOG_FORMAT = 'thecut-skewer-log/1';

export const SURVEY_Q: { id: 'q1' | 'q2' | 'q3'; text: string; opts: string[] }[] = [
  { id: 'q1', text: '① 找到「串起多顆的那條線」時，你是否覺得這刀切得漂亮？', opts: ['是', '說不上', '否'] },
  { id: 'q2', text: '② 你是否真的猶豫過「現在拆威脅，還是等對齊」？', opts: ['有', '一點點', '沒有'] },
  { id: 'q3', text: '③ 畫線版是否比點選版更想再玩？', opts: ['畫線版', '差不多', '點選版', '只玩過一種'] },
];
export type Survey = { q1: string | null; q2: string | null; q3: string | null };

export interface RoundLog {
  turn: number;
  /** 這一刀的兩個端點（棋盤單位）。 */
  line: number[];
  hits: string[];
  sacs: string[];
  valueSum: number;
  mult: number;
  damage: number;
  poisonDmg: number;
  clawDmg: number;
  hpEBefore: number;
  hpEAfter: number;
  hpPBefore: number;
  hpPAfter: number;
  /** 從回合開始到按下確認的毫秒數。 */
  thinkMs: number;
  /** 本回合取消次數（按「取消」或在待確認時重畫）。 */
  cancels: number;
  /** 點選模式：本回合提供的候選線與選中的索引；畫線模式為 null。 */
  offered: number[][] | null;
  picked: number | null;
}

export interface SkewerLog {
  format: string;
  commit: string;
  mode: PlayMode;
  board: { id: string; name: string; hpE: number; hpP: number; turnLimit: number };
  rounds: RoundLog[];
  result: Result;
  loseReason: LoseReason;
  turnsPlayed: number;
  final: { hpE: number; hpP: number };
  survey: Survey;
}

export function newLog(board: BoardDef, mode: PlayMode, commit: string): SkewerLog {
  return {
    format: LOG_FORMAT, commit, mode,
    board: { id: board.id, name: board.name, hpE: board.hpE, hpP: board.hpP, turnLimit: board.turnLimit },
    rounds: [], result: null, loseReason: null, turnsPlayed: 0, final: { hpE: board.hpE, hpP: board.hpP },
    survey: { q1: null, q2: null, q3: null },
  };
}

export function roundLog(rec: TurnRecord, thinkMs: number, cancels: number, offered: readonly Line[] | null, picked: number | null): RoundLog {
  return {
    turn: rec.turn, line: [...rec.line], hits: [...rec.hits], sacs: [...rec.sacs], valueSum: rec.valueSum, mult: rec.mult, damage: rec.damage,
    poisonDmg: rec.poisonDmg, clawDmg: rec.clawDmg, hpEBefore: rec.hpEBefore, hpEAfter: rec.hpEAfter, hpPBefore: rec.hpPBefore, hpPAfter: rec.hpPAfter,
    thinkMs: Math.max(0, Math.round(thinkMs)), cancels, offered: offered ? offered.map((l) => [...l]) : null, picked,
  };
}

export function withRound(log: SkewerLog, r: RoundLog, s: GameState): SkewerLog {
  return { ...log, rounds: [...log.rounds, r], result: s.result, loseReason: s.loseReason, turnsPlayed: log.rounds.length + 1, final: { hpE: s.hpE, hpP: s.hpP } };
}

export function exportText(log: SkewerLog): string { return JSON.stringify(log); }

/** 結算回顧的一行文字（確認後才顯示；預覽不用）。 */
export function reviewLine(board: BoardDef, r: TurnRecord): string {
  const nm = (id: string) => board.organs.find((o) => o.id === id)?.name ?? id;
  const vals = r.hits.map((id) => board.organs.find((o) => o.id === id)!.value);
  const cut = r.hits.length === 0 ? '空切，沒有傷害' : `串 ${r.mult}（${r.hits.map(nm).join('→')}）：(${vals.join('+')})×${r.mult}＝${r.damage}`;
  const poison = r.poisonDmg > 0 ? `毒囊爆開，你受 ${r.poisonDmg}` : '沒碰毒囊';
  const claws = r.clawDmg > 0 ? `剩下的爪打你 ${r.clawDmg}` : '沒有爪攻擊';
  return `第 ${r.turn} 回合：${cut}。${poison}。${claws}。`;
}
