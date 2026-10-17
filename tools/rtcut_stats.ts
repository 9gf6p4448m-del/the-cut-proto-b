// 即時亂切「只回報、不當門檻」統計：固定 30 個種子（1～30），AI 對隨機玩家腳本（runRandomPlayer）。不是好玩的證據。
// 用法：node tools/rtcut_stats.ts
import { runRandomPlayer } from '../src/rtcut/rules.ts';
const N = 30, sum = { blue: { strikes: 0, severs: 0, blockedBy: 0, locks: 0 }, red: { strikes: 0, severs: 0, blockedBy: 0, locks: 0 } }, win = { blue: 0, red: 0, draw: 0 };
const pw: Record<'blue' | 'red', number[]> = { blue: [], red: [] };
for (let seed = 1; seed <= N; seed++) {
  const m = runRandomPlayer(seed);
  for (const s of m.strikes) { const t = sum[s.side]; t.strikes++; if (s.severed !== null) t.severs++; if (s.blocked !== null) t.blockedBy++; t.locks += s.locks.length; }
  win[m.result.winner]++; pw.blue.push(m.result.power.blue); pw.red.push(m.result.power.red);
}
const avg = (x: number) => (x / N).toFixed(2);
console.log(`種子 1～${N}，AI（紅）對隨機玩家（藍）`);
for (const side of ['blue', 'red'] as const) {
  const t = sum[side];
  console.log(`${side === 'blue' ? '藍（隨機玩家）' : '紅（AI）'}：平均出刀 ${avg(t.strikes)}、切除 ${avg(t.severs)}、被對方鎖住擋下 ${avg(t.blockedBy)}、鎖住己方器官次數 ${avg(t.locks)}、平均終局戰力 ${avg(pw[side].reduce((a, b) => a + b, 0))}`);
}
console.log(`勝負：藍勝 ${win.blue}、紅勝 ${win.red}、平手 ${win.draw}`);
