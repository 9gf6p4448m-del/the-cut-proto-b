import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}
export function snapshot(): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(join(ROOT, 'SNAPSHOT_3e2b9b4.sha256'), 'utf8').trim().split('\n')) {
    const mm = /^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line.trim());
    if (mm) m.set(mm[2], mm[1]);
  }
  return m;
}
export const FORK_OLD = 'content.organs[st.below(6)].key';
export const FORK_NEW = 'content.organs[st.below(PROTO_B_ORGAN_POOL)].key';
export const FORK_ADD = '/** B 軌 fork（proto-b）：每顆器官從前 N 種抽（預設 6＝研究引擎原樣；3＝三器官體驗模式）。只能在 newBattle 前設定。 */\nexport let PROTO_B_ORGAN_POOL = 6;\nexport function setProtoBOrganPool(n: 3 | 6): void { PROTO_B_ORGAN_POOL = n; }\n';

/**
 * 掛鉤登記表（ENGINE_FORK.md 逐條列出同一組 id）：每條＝在某檔把 old 換成 new。T-1 要求每條 new 在現檔恰好出現一次，
 * 且把全部掛鉤撤銷（new→old）後，每檔逐位元組等於 3e2b9b4 快照——所以登記表以外的任何改動都會讓 T-1 紅。
 * PB-1／PB-2＝B 軌原有 fork（三器官池）；X-*＝FUN-EXP-01 實驗掛鉤（BASELINE 行為不變由 X-1 差分測試證明，不由本表證明）。
 */
export interface Hook { id: string; file: string; old: string; new: string }
const C = ' // FUN-EXP-01 掛鉤 ';
export const FORK_HOOKS: Hook[] = [
  { id: 'PB-1', file: 'src/engine.ts', old: '', new: FORK_ADD },
  { id: 'PB-2', file: 'src/engine.ts', old: FORK_OLD, new: FORK_NEW },
  { id: 'X-T1', file: 'src/types.ts', old: "| 'TIE-fixed' | 'FORCED';", new: "| 'TIE-fixed' | 'FORCED'\n  | 'OBSESSION';" + C + 'X-T1' },
  { id: 'X-T2', file: 'src/types.ts', old: "  | { kind: 'BUT' | 'JUD' | 'KNG'; w10: number }\n", new: "  | { kind: 'BUT' | 'JUD' | 'KNG'; w10: number }\n  | { kind: 'OBS_HEART' | 'OBS_AREA'; w10: number }" + C + 'X-T2\n' },
  { id: 'X-T3', file: 'src/types.ts', old: "  | { t: 'CAP_EXCEEDED' }\n", new: "  | { t: 'WOUND'; op: 'KEEP' | 'TEAR' | 'HEAL'; organs: number[]; copies?: number[] }" + C + "X-T3\n  | { t: 'CAP_EXCEEDED' }\n" },
  { id: 'X-T4', file: 'src/types.ts', old: '  U: number;\n}', new: '  U: number;\n  hearts?: number;' + C + 'X-T4\n}' },
  { id: 'X-T5', file: 'src/types.ts', old: "  | { t: 'STEP'; name: 'INCISION' | 'HARVEST' | 'ALL' | 'PLAYER' | 'ENEMY' }\n", new: "  | { t: 'STEP'; name: 'INCISION' | 'HARVEST' | 'ALL' | 'PLAYER' | 'ENEMY' }\n  | { t: 'STEP'; name: 'TEAR' }" + C + 'X-T5（只有實驗 B 撕裂會發出）\n' },
  { id: 'X-E1', file: 'src/enemy.ts', old: 'import type { ChoiceBasis,', new: "import { obsessionSide } from './experiment.ts';" + C + 'X-E1\nimport type { ChoiceBasis,' },
  { id: 'X-E2', file: 'src/enemy.ts', old: "    case 'BUT':\n      return [keep.reduce", new: "    case 'BUT':\n    case 'OBS_HEART': case 'OBS_AREA':" + C + 'X-E2\n      return [keep.reduce' },
  { id: 'X-E3', file: 'src/enemy.ts', old: '  const r = normalChain(enemy, L, R, fixed);\n  return { side: r.side, reason: r.reason, basis };',
    new: '  const obs = !L.lethal && !R.lethal ? obsessionSide(enemy, L, R) : null;' + C + "X-E3\n  if (obs) return { side: obs, reason: 'OBSESSION', basis };\n  const r = normalChain(enemy, L, R, fixed);\n  return { side: r.side, reason: r.reason, basis };" },
  { id: 'X-R1', file: 'src/resolve.ts', old: "import { KIND_ORDER } from './types.ts';", new: "import { KIND_ORDER } from './types.ts';\nimport { obsFactsOf } from './experiment.ts';" + C + 'X-R1' },
  { id: 'X-R2', file: 'src/resolve.ts', old: 'U: scoreU(w10Of(inp.enemy), pNum, pDen, v) };', new: 'U: scoreU(w10Of(inp.enemy), pNum, pDen, v), ...obsFactsOf(inp.enemy, keep) };' + C + 'X-R2' },
  { id: 'X-R3', file: 'src/resolve.ts', old: '  effectBase?: number;\n}\n', new: '  effectBase?: number;\n  /** 實驗 B 撕裂：封存器官的複本（各 TEAR_MULTIPLIER 份），在本刀刀中步驟之後另起 TEAR 步驟結算' + C + 'X-R3 */\n  tear?: Organ[];\n}\n' },
  { id: 'X-R4', file: 'src/resolve.ts', old: "    for (const o of pierced) emit({ t: 'PIERCE', id: o.id }, false);\n",
    new: '    const tear = [...(inp.tear ?? [])].sort((a, b) => a.id - b.id);' + C + "X-R4（非實驗 B 為空）\n    for (const o of pierced) emit({ t: 'PIERCE', id: o.id }, false);\n" },
  { id: 'X-R5', file: 'src/resolve.ts', old: '    for (const o of pierced) {\n      const inc = def(o).incision;\n',
    new: '    const incOf = (list: Organ[], incGains: GainSpec[], incDmgs: DmgSpec[], nonNumeric: Ev[]): void => { for (const o of list) {' + C + 'X-R5\n      const inc = def(o).incision;\n' },
  { id: 'X-R6', file: 'src/resolve.ts', old: "      if (inc.destroy) nonNumeric.push({ t: 'INC', id: o.id, effect: 'DESTROY' });\n    }\n",
    new: "      if (inc.destroy) nonNumeric.push({ t: 'INC', id: o.id, effect: 'DESTROY' });\n    } };\n    incOf(pierced, incGains, incDmgs, nonNumeric);" + C + 'X-R6\n' },
  { id: 'X-R7', file: 'src/resolve.ts', old: '    // ---- 選邊 ----\n',
    new: '    if (tear.length > 0) {' + C + "X-R7：撕裂＝第二個刀中步驟（本刀刀中已結算完、且無人死亡時才發動）\n      const tg: GainSpec[] = [], td: DmgSpec[] = [], tn: Ev[] = [];\n      incOf(tear, tg, td, tn);\n      emit({ t: 'STEP', name: 'TEAR' }, false);\n      for (const o of tear) emit({ t: 'PIERCE', id: o.id }, false);\n      for (const e of tn) emit(e, e.t === 'INC' || e.t === 'SPAWN');\n      if (runStepNoHeader(tg, td)) return finish();\n    }\n    // ---- 選邊 ----\n" },
  { id: 'X-G1', file: 'src/engine.ts', old: "import { ENGINE_VERSION, SPEC_VERSION } from './version.ts';\n",
    new: "import { ENGINE_VERSION, SPEC_VERSION } from './version.ts';\nimport { expActionError, expInitState, expRunConfigOf, normalizeConfig, woundPrepare } from './experiment.ts';" + C + "X-G1\nimport type { ExpConfig, Wound } from './experiment.ts';\n" },
  { id: 'X-G2', file: 'src/engine.ts', old: '  maxRounds: number;\n}\n', new: '  maxRounds: number;\n  exp?: ExpConfig;' + C + 'X-G2\n}\n' },
  { id: 'X-G3', file: 'src/engine.ts', old: '  stats: { templateAttempts: number; spawnFail: number; candOOR: number; anchorUnplaceable: number };\n}\n',
    new: '  stats: { templateAttempts: number; spawnFail: number; candOOR: number; anchorUnplaceable: number };\n  wound?: Wound | null;' + C + 'X-G3（只有實驗 B 有此欄位）\n}\n' },
  { id: 'X-G4', file: 'src/engine.ts', old: '  j: number;\n}\n\nexport interface Partition', new: '  j: number;\n  keepWound?: boolean;' + C + 'X-G4\n}\n\nexport interface Partition' },
  { id: 'X-G5', file: 'src/engine.ts', old: '    contentDigest: contentDigest(content), testOnlyContent: content.testOnly,\n  };',
    new: '    contentDigest: contentDigest(content), testOnlyContent: content.testOnly,\n    ...expRunConfigOf(cfg),' + C + 'X-G5\n  };' },
  { id: 'X-G6', file: 'src/engine.ts', old: '    stats: { templateAttempts: tr.attempts, spawnFail: 0, candOOR: 0, anchorUnplaceable: 0 },\n  };',
    new: '    stats: { templateAttempts: tr.attempts, spawnFail: 0, candOOR: 0, anchorUnplaceable: 0 },\n    ...expInitState(cfg),' + C + 'X-G6\n  };' },
  { id: 'X-G7', file: 'src/engine.ts', old: '錨點索引不合法：${k}`);\n', new: '錨點索引不合法：${k}`);\n  const xe = expActionError(s, a); if (xe) throw new InvalidAction(xe);' + C + 'X-G7\n' },
  { id: 'X-G8', file: 'src/engine.ts', old: '  const c = deepFreeze(structuredClone(cfg));', new: '  const c = deepFreeze(structuredClone(normalizeConfig(cfg)));' + C + 'X-G8' },
  { id: 'X-G9', file: 'src/engine.ts',
    old: "  if (!p.legal) return { state: s, events, legal: false };\n  const out = resolveRound({\n    hp: s.hp, maxHp: s.maxHp, pierced: p.pierced, L: p.L, R: p.R, area2: p.area2, fixedSide: 'R',\n    rules: s.config.rules, enemy: s.config.enemy, content, nextId: s.nextId, effectBase: s.board!.effectsAtStart,\n  });\n  events.push(...out.events);\n  let ns: BattleState = { ...s, hp: out.hp, nextId: out.nextId, seedlingsPending: out.seedlings, board: null };\n",
    new: "  if (!p.legal) return { state: s, events, legal: false };\n  const xw = woundPrepare(s, p, a);" + C + "X-G9（非實驗 B 為 null）\n  if (xw?.error) throw new InvalidAction(xw.error);\n  if (xw) events.push(...xw.events);\n  const out = resolveRound({\n    hp: s.hp, maxHp: s.maxHp, pierced: xw ? xw.pierced : p.pierced, L: p.L, R: p.R, area2: p.area2, fixedSide: 'R',\n    rules: s.config.rules, enemy: s.config.enemy, content, nextId: xw ? xw.nextId : s.nextId, effectBase: s.board!.effectsAtStart, ...(xw ? { tear: xw.tear } : {}),\n  });\n  events.push(...out.events);\n  let ns: BattleState = { ...s, hp: out.hp, nextId: out.nextId, seedlingsPending: out.seedlings, board: null };\n  if (xw) ns = { ...ns, wound: out.result || ns.round >= s.config.maxRounds ? null : xw.wound }; // 戰鬥結束時傷口直接消失\n" },
  { id: 'X-G10', file: 'src/engine.ts', old: "  if (canonical(s.config) !== canonical(trusted)) throw new Error('快照的設定與可信設定不同');\n",
    new: "  if (canonical(s.config) !== canonical(normalizeConfig(trusted))) throw new Error('快照的設定與可信設定不同');" + C + 'X-G10\n' },
];
/** fork 新增、快照中沒有的檔案（實驗掛鉤本體）。 */
export const FORK_NEW_FILES = ['src/experiment.ts'];

/** 撤銷某檔的全部登記掛鉤（逆序；用 split/join 而非 replace，避免 `$` 特殊替換字元）。 */
export function undoHooks(rel: string, text: string): string {
  let t = text;
  for (const h of [...FORK_HOOKS].reverse()) if (h.file === rel) t = t.split(h.new).join(h.old);
  return t;
}

/** 由 fork 反推原始 3e2b9b4 引擎（撤銷全部登記掛鉤、略過 fork 新增檔），放到暫存目錄；回傳目錄。 */
export function originalEngineDir(): string {
  const dst = join(ROOT, '.tmp', `orig-engine-${process.pid}`); // 每個測試行程各自一份，避免並行測試互相覆寫
  for (const f of walk(join(ROOT, 'engine'))) {
    const rel = relative(join(ROOT, 'engine'), f).replace(/\\/g, '/');
    if (FORK_NEW_FILES.includes(rel)) continue;
    const to = join(dst, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (FORK_HOOKS.some((h) => h.file === rel)) writeFileSync(to, undoHooks(rel, readFileSync(f, 'utf8')));
    else copyFileSync(f, to);
  }
  return dst;
}

export const CFG = { model: 'A' as const, rules: { ph: 'PH-M' as const, so: 'SO-3' as const, hs: 'HS-1' as const, sem: 'SEM-1' as const }, enemy: { kind: 'BUT' as const, w10: 7 }, hpP: 40, hpE: 30, r: 160, anchorCount: 12, maxRounds: 12 };
