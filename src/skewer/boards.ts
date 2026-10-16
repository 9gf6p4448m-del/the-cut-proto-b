// 串刺固定盤面（研究片段；數值為 brief §P2.2 初值與自訂變體，未校準）。座標：棋盤單位，y 軸向下。
// 盤面幾何的推導與檢查見 SKEWER_NOTES.md §2；示例甲／乙的路線由 tests/node/skewer_rules.test.ts 逐值斷言。
import type { BoardDef, OrganDef, Pt, SacDef } from './rules.ts';

const BODY: Pt[] = [[300, 200], [700, 200], [860, 330], [860, 640], [700, 760], [300, 760], [140, 640], [140, 330]];
/** 心肉的小環軌：上、右、下、左（順時針）。左右兩格壓低，讓第 1 回合「兩爪連線」碰不到心肉（見 SKEWER_NOTES.md §2）。 */
const HEART_RING: Pt[] = [[500, 430], [600, 560], [500, 660], [400, 560]];
const SAC: SacDef = { id: 'sac', name: '毒囊', pos: [600, 395], r: 40, dmg: 5 };

function claw(id: 'clawL' | 'clawR', ys: number[], attack: number): OrganDef {
  const x = id === 'clawL' ? 250 : 750;
  return { id, kind: 'claw', name: id === 'clawL' ? '爪甲' : '爪乙', value: 2, attack, r: 36, track: ys.map((y): Pt => [x, y]), mode: 'pingpong', start: 0 };
}
function heart(start: number): OrganDef {
  return { id: 'heart', kind: 'heart', name: '心肉', value: 4, attack: 0, r: 40, track: HEART_RING, mode: 'loop', start };
}

export const BOARDS: BoardDef[] = [
  {
    id: 'A', name: '示例甲', note: '第 2 回合三點共線（太平的線會擦到毒囊）', body: BODY,
    organs: [claw('clawL', [450, 370, 290], 3), heart(3), claw('clawR', [450, 490, 530], 3)],
    sacs: [SAC], plates: [], hpE: 30, hpP: 20, turnLimit: 4,
  },
  {
    id: 'B', name: '示例乙', note: '對齊到第 3 回合才出現；爪攻擊各 6', body: BODY,
    organs: [claw('clawL', [450, 410, 370], 6), heart(2), claw('clawR', [450, 470, 490], 6)],
    sacs: [SAC], plates: [], hpE: 30, hpP: 20, turnLimit: 8,
  },
  {
    id: 'C', name: '變體丙：骨板', note: '骨板擋住第 1 回合兩爪的橫線；爪攻擊各 4', body: BODY,
    organs: [claw('clawL', [450, 370, 290], 4), heart(3), claw('clawR', [450, 490, 530], 4)],
    sacs: [SAC], plates: [{ id: 'plate', name: '骨板', a: [340, 420], b: [340, 480], t: 8 }], hpE: 34, hpP: 20, turnLimit: 4,
  },
  {
    id: 'D', name: '變體丁：慢對齊', note: '對齊在第 4 回合；爪較弱（各 2）、上限 6', body: BODY,
    organs: [claw('clawL', [450, 420, 395, 370], 2), heart(1), claw('clawR', [450, 465, 480, 490], 2)],
    sacs: [SAC], plates: [], hpE: 40, hpP: 20, turnLimit: 6,
  },
];

export function boardById(id: string): BoardDef {
  const b = BOARDS.find((x) => x.id === id);
  if (!b) throw new Error(`沒有這個盤面：${id}`);
  return b;
}
/** 「下一局」循環：甲 → 乙 → 丙 → 丁 → 甲。 */
export function nextBoardId(id: string): string {
  const k = BOARDS.findIndex((x) => x.id === id);
  return BOARDS[(k + 1) % BOARDS.length].id;
}
