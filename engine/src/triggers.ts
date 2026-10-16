// 觸發圖靜態檢查（R2 EC-16、Block 0-5）：內容中「某事件發生時 → 產生另一事件」的反應式觸發不得成環。
// 研究內容只有一條反應式觸發：鏡膜「受到可反射傷害 → 反射傷害」，而反射傷害不再觸發鏡膜。
export interface ReactiveTrigger {
  owner: string;
  on: string;
  emits: string;
}

export const RESEARCH_TRIGGERS: ReactiveTrigger[] = [{ owner: 'mirror', on: 'DAMAGE_REFLECTABLE', emits: 'DAMAGE_REFLECT' }];

export class TriggerCycle extends Error {
  nodes: string[];
  constructor(nodes: string[]) {
    super(`觸發圖有環：${nodes.join(' → ')}`);
    this.nodes = nodes;
  }
}

/** 有環就丟出 TriggerCycle（含環上的節點）；否則傳回拓撲順序。 */
export function checkTriggerGraph(triggers: ReactiveTrigger[]): string[] {
  const adj = new Map<string, string[]>();
  for (const t of triggers) {
    if (!adj.has(t.on)) adj.set(t.on, []);
    if (!adj.has(t.emits)) adj.set(t.emits, []);
    adj.get(t.on)!.push(t.emits);
  }
  const state = new Map<string, number>(); // 0 未訪、1 進行中、2 完成
  const stack: string[] = [];
  const order: string[] = [];
  const visit = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) throw new TriggerCycle([...stack.slice(stack.indexOf(m)), m]);
      if (!state.get(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
    order.push(n);
  };
  for (const n of [...adj.keys()].sort()) if (!state.get(n)) visit(n);
  return order.reverse();
}
