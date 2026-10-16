// 研究工具匯入守衛（規格 v2 MUST 5）：只接受 B 軌六器官研究模式紀錄；不得以 configHash 判斷模式。
// FUN-EXP-01：另拒絕實驗模式（A／B）紀錄——`expMode` 欄位、`config.exp.mode` 任一不是 BASELINE，或敵人是執念種類，都拒絕。
export function assertResearchLog(x: unknown): void {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new Error('不是紀錄物件');
  if (o.format !== 'thecut-protoB-log/1') throw new Error(`格式版本不符：${String(o.format)}`);
  if (o.fork !== 'proto-b') throw new Error(`fork 標記不符：${String(o.fork)}`);
  if (o.protoMode !== 'research6') throw new Error(`拒絕非研究模式紀錄：${String(o.protoMode)}（三器官體驗模式不得進入研究工具）`);
  const cfg = o.config as { exp?: { mode?: unknown }; enemy?: { kind?: unknown } } | undefined;
  const modes = [o.expMode, cfg?.exp?.mode];
  if ('expMode' in o && o.expMode === undefined) throw new Error('拒絕實驗模式紀錄：expMode 欄位存在但無值');
  if (cfg && 'exp' in cfg && (cfg.exp === undefined || cfg.exp === null)) throw new Error('拒絕實驗模式紀錄：config.exp 存在但無值');
  for (const m of modes) if (m !== undefined && m !== 'BASELINE') throw new Error(`拒絕實驗模式紀錄：${String(m)}（FUN-EXP-01 實驗紀錄不得進入研究工具）`);
  const kind = cfg?.enemy?.kind;
  if (kind === 'OBS_HEART' || kind === 'OBS_AREA') throw new Error(`拒絕實驗模式紀錄：執念敵人 ${kind}`);
}
