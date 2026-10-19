// duel6：從切割期事件取出「這個事件切下的器官索引」——零 DOM 的純函式，主程式與 Node 測試共用（審查 C2 / X2：穿刺連切的每一個都要進 cutByMe）。
import type { GameEvent, Kind, OrganDef, Side } from '../rtcut/rules.ts';

/** strike：穿刺時 pierced 的每一個（依序），否則 severed 一個；freeCut：e.i；其餘（含 freeEnd，它另走 e.severed）＝空。 */
export function cutIdxOf(e: GameEvent): number[] {
  if (e.t === 'strike') return e.r.pierced ?? (e.r.severed !== null ? [e.r.severed] : []);
  if (e.t === 'freeCut') return [e.i];
  return [];
}
/** 把一串事件收成 side 方切下的器官種類（＝主程式 G.cutByMe 的邏輯：strike／freeCut 經 cutIdxOf，freeEnd 加 severed）。 */
export function collectCutKinds(events: GameEvent[], organs: OrganDef[], side: Side): Kind[] {
  const out: Kind[] = [];
  for (const e of events) {
    if (e.t === 'strike') { if (e.r.side === side) for (const i of cutIdxOf(e)) out.push(organs[i].kind); }
    else if (e.t === 'freeCut') { if (e.side === side) out.push(organs[e.i].kind); }
    else if (e.t === 'freeEnd' && e.side === side && e.severed !== null) out.push(organs[e.severed].kind);
  }
  return out;
}
