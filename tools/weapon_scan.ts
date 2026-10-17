// W-04 幾何可行掃描（凍結驗收 docs/cut-weapon/ACCEPTANCE_FROZEN.md）：對切線（角度 θ × 位移 s）逐一切割、裝上、揮擊，看兩個靶的結果。
// 用法：node tools/weapon_scan.ts [seamNormal|axisRoot]
import { advance, cutLimb, newSwing } from '../src/weapon/geom.ts';
import type { Attach, Cut, V } from '../src/weapon/geom.ts';
import { LIMB, RIG, TARGETS } from '../src/weapon/content.ts';

const mode = (process.argv[2] ?? 'seamNormal') as Attach;
const TH = Array.from({ length: 180 }, (_, i) => i);           // 1°
const SS = Array.from({ length: 211 }, (_, i) => -420 + 4 * i); // 4 單位
const TOL_T = 2, TOL_S = 3;                                     // ±2°、±12 單位
const CEN: V = [320, 0];
type Cell = { ok: boolean; carapace: boolean; res: Record<string, string> };
const grid: Cell[][] = [];
let valid = 0;
for (const t of TH) {
  const row: Cell[] = [];
  const n: V = [Math.cos(t * Math.PI / 180), Math.sin(t * Math.PI / 180)], d: V = [-n[1], n[0]];
  for (const s of SS) {
    const p: V = [CEN[0] + n[0] * s, CEN[1] + n[1] * s];
    const c = cutLimb(LIMB, [p[0] - d[0] * 900, p[1] - d[1] * 900], [p[0] + d[0] * 900, p[1] + d[1] * 900]);
    if (!c.ok) { row.push({ ok: false, carapace: false, res: {} }); continue; }
    valid++;
    const cut = c as Cut;
    const claw = cut.organs.find((o) => o.id === 'claw')!, car = cut.organs.find((o) => o.id === 'carapace')!;
    const res: Record<string, string> = {};
    for (const tg of TARGETS) {
      if (!claw.inWeapon || claw.damaged) { res[tg.id] = 'noclaw'; continue; }
      const sw = advance(newSwing(RIG), cut, RIG, tg, RIG.phiEnd, mode, LIMB.base);
      const e = sw.done!;
      res[tg.id] = e.kind === 'hit' ? `hit${sw.broken.length ? '+shatter' : ''}` : e.kind === 'stuck' ? `stuck:${e.plate ?? 'spot'}:${e.part}` : e.kind;
    }
    row.push({ ok: true, carapace: car.inWeapon && !car.damaged, res });
  }
  grid.push(row);
}
const hit = (c: Cell, id: string) => c.ok && c.res[id]?.startsWith('hit');
function robust(i: number, j: number, id: string): boolean {
  for (let a = -TOL_T; a <= TOL_T; a++) for (let b = -TOL_S; b <= TOL_S; b++) {
    const ii = (i + a + 180) % 180, jj = j + b; // θ 跨 180° 時線相同、位移變號
    const c = i + a < 0 || i + a >= 180 ? grid[ii][SS.length - 1 - jj] : grid[ii]?.[jj];
    if (!c || !hit(c, id)) return false;
  }
  return true;
}
function clusters(cells: [number, number][]): number {
  const key = (p: [number, number]) => `${p[0]},${p[1]}`, set = new Set(cells.map(key)), seen = new Set<string>(); let k = 0;
  for (const c of cells) {
    if (seen.has(key(c))) continue; k++; const st = [c];
    while (st.length) { const [i, j] = st.pop()!; const kk = `${i},${j}`; if (seen.has(kk) || !set.has(kk)) continue; seen.add(kk); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) st.push([i + a, j + b]); }
  }
  return k;
}
console.log(`接法 ${mode}｜有效切線 ${valid}`);
const tally: Record<string, Record<string, number>> = {};
for (const row of grid) for (const c of row) if (c.ok) for (const [id, r] of Object.entries(c.res)) { tally[id] ??= {}; tally[id][r] = (tally[id][r] ?? 0) + 1; }
for (const tg of TARGETS) {
  const all: [number, number][] = [], rob: [number, number][] = [];
  grid.forEach((row, i) => row.forEach((c, j) => { if (hit(c, tg.id)) { all.push([i, j]); if (robust(i, j, tg.id)) rob.push([i, j]); } }));
  const robNoCar = rob.filter(([i, j]) => !grid[i][j].carapace), robCar = rob.filter(([i, j]) => grid[i][j].carapace && grid[i][j].res[tg.id] === 'hit+shatter');
  const top = Object.entries(tally[tg.id]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`  ${tg.name}：命中 ${all.length}（容錯成功 ${rob.length}，群數 ${clusters(rob)}；其中不含完好甲殼 ${robNoCar.length}、含甲殼且碎板 ${robCar.length}）｜結果分布 ${top}`);
  const ex = rob[Math.floor(rob.length / 2)];
  if (ex) console.log(`    例：θ=${TH[ex[0]]}° s=${SS[ex[1]]} 甲殼=${grid[ex[0]][ex[1]].carapace} 結果=${grid[ex[0]][ex[1]].res[tg.id]}`);
}
let both = 0; grid.forEach((row) => row.forEach((c) => { if (hit(c, 'slit') && hit(c, 'cover')) both++; }));
console.log(`  同時命中兩靶的切線：${both}`);
