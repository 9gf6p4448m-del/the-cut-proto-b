// 研究工具匯入守衛（規格 v2 MUST 5）：只接受 B 軌六器官研究模式紀錄；不得以 configHash 判斷模式。
export function assertResearchLog(x: unknown): void {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new Error('不是紀錄物件');
  if (o.format !== 'thecut-protoB-log/1') throw new Error(`格式版本不符：${String(o.format)}`);
  if (o.fork !== 'proto-b') throw new Error(`fork 標記不符：${String(o.fork)}`);
  if (o.protoMode !== 'research6') throw new Error(`拒絕非研究模式紀錄：${String(o.protoMode)}（三器官體驗模式不得進入研究工具）`);
}
