// duel v0.2 美術合併「只回報」：同一套探針在 v0.1 四邊形與 duel2 龍身邊界下的三場征途全勝率（看邊界變更是否改變難度）。
// 用法：node tests/da_stats.ts [種子數=60]。探針＝tests/cb_stats.ts 的貪婪挑刀；縫合挑第一個選項、放在第一個「周圍 8px 都合法」的點。
import { playStage } from './cb_stats.ts';
import { finishStage, newCampaign, pickStitch, placeCheck, placeStitch } from '../src/cutbattle/campaign.ts';
import type { Campaign } from '../src/cutbattle/campaign.ts';
import { BODY2 } from '../src/cutbattle/duel2_board.ts';
import type { Side, V } from '../src/rtcut/rules.ts';

function spot(c: Campaign): V | null {
  const ok = (x: number, y: number) => !placeCheck(c, [x, y]) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !placeCheck(c, [x + 8 * Math.cos((i * Math.PI) / 4), y + 8 * Math.sin((i * Math.PI) / 4)]));
  for (let y = 480; y < 950; y += 10) for (let x = 70; x < 650; x += 10) if (ok(x, y)) return [x, y];
  return null;
}
export function campaignWin(seed: number, delay: number, body?: Record<Side, V[]>): { won: boolean; reached: number } {
  let c = newCampaign(seed, body);
  for (let st = 0; st < 3; st++) {
    const r = playStage(c, delay); c = finishStage(c, r.cut, r.battle);
    if (c.phase === 'lost') return { won: false, reached: st + 1 };
    if (c.phase === 'pick') { c = pickStitch(c, c.offer[0]); c = placeStitch(c, spot(c)!).c; }
  }
  return { won: c.phase === 'won', reached: 3 };
}
if (process.argv[1]?.endsWith('da_stats.ts')) {
  const N = Number(process.argv[2] ?? 60);
  for (const [name, body] of [['v0.1 四邊形', undefined], ['duel2 龍身邊界', BODY2]] as [string, Record<Side, V[]> | undefined][]) {
    for (const delay of [0, 30]) {
      let w = 0; for (let s = 1; s <= N; s++) if (campaignWin(s, delay, body).won) w++;
      console.log(`${name}，探針延遲 ${delay / 60} 秒：三場全勝 ${w}/${N}＝${((100 * w) / N).toFixed(0)}%`);
    }
  }
}
