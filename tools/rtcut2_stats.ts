// 即時亂切 v2「只回報、不當門檻」統計：種子 1～30，藍方用與 AI 相同的貪婪打分＋0.5 秒反應延遲（冷卻好後再等 30 步才出刀）對 AI。不是好玩的證據。
// 用法：node tools/rtcut2_stats.ts
import { COOLDOWN_STEPS, MODE_RT2, aiChoose, newGame, step } from '../src/rtcut/rules.ts';
const N = 30, end = { ko: 0, time: 0 }, win = { blue: 0, red: 0, draw: 0 }, koWin = { blue: 0, red: 0, draw: 0 };
let severs = 0, endStep = 0, spawns = 0;
for (let seed = 1; seed <= N; seed++) {
  let s = newGame(seed, MODE_RT2), next = 30, r = (seed * 7 + 1) >>> 0;
  while (s.phase === 'cut') {
    let blue = null;
    if (s.step >= next && s.cdUntil.blue <= s.step) { const p = aiChoose({ ...s, rng: r }, 'blue'); r = p.rng; blue = p.line; next = s.step + COOLDOWN_STEPS + 30; }
    const o = step(s, { blue }); spawns += o.events.filter((e) => e.t === 'spawn').length; s = o.state;
  }
  end[s.end!.by]++; win[s.end!.winner]++; if (s.end!.by === 'ko') koWin[s.end!.winner]++;
  severs += s.severedN.blue + s.severedN.red; endStep += s.step;
}
const pct = (x: number) => `${((100 * x) / N).toFixed(1)}%`;
console.log(`種子 1～${N}，貪婪＋0.5 秒延遲（藍）對 AI（紅），v2 模式`);
console.log(`擊倒率 ${pct(end.ko)}（藍擊倒勝 ${koWin.blue}、紅擊倒勝 ${koWin.red}、同時倒下 ${koWin.draw}）；時間到 ${pct(end.time)}；平手率 ${pct(win.draw)}`);
console.log(`勝負：藍 ${win.blue}、紅 ${win.red}、平手 ${win.draw}；平均每局切除 ${(severs / N).toFixed(2)}（雙方合計）、再生 ${(spawns / N).toFixed(2)}、平均局長 ${(endStep / N / 60).toFixed(1)} 秒`);
