// FT-04 平手局的重放排程（Node 端、純規則模擬，不開瀏覽器）。
// 政策＝v06_readback.md B9 的目標化腳本：直線刀只切對方的爪和毒，冷卻好且 step%6===0 時取 candidates 的第一條可行刀。
// 為了讓瀏覽器重放與 Node 預測逐值相同，所有刀線端點先換成「整數 CSS 螢幕座標」再換回世界座標後才拿去模擬（瀏覽器的滑鼠事件就是整數座標，
// toWorld 是它的線性反函數）。因此已知平手種子（168、67、99、210、252、287、289）在這個取整政策下不保證仍平手：
// findTieSeeds 先試已知種子、再掃 1..SCAN_MAX，直到找到「重打型」與「判敗型」各一個；找不到就回報缺口（FT-04 平手項 FAIL），不放寬。
import { candidates, resolveStrike, step } from '../../src/rtcut/rules.ts';
import { BODY2, R3 } from '../../src/cutbattle/duel3_board.ts';
import { battleSeed, fightersOf, matchFor, newCampaign } from '../../src/cutbattle/campaign.ts';
import { simulateBattle } from '../../src/cutbattle/battle.ts';

const FRONT = { unit: 60, max: 4 };
export const KNOWN_TIE_SEEDS = [168, 67, 99, 210, 252, 287, 289];
export const SCAN_MAX = 400;

/** aff＝{ax, ay, k}：螢幕座標 = a + 世界座標 × k（由頁面的 toScreen 取兩點得到）。 */
export const affineOf = (p0, p1) => ({ ax: p0.x, ay: p0.y, k: (p1.x - p0.x) / 700 });
const toScreenInt = (aff, w) => [Math.round(aff.ax + w[0] * aff.k), Math.round(aff.ay + w[1] * aff.k)];
const toWorld = (aff, s) => [(s[0] - aff.ax) / aff.k, (s[1] - aff.ay) / aff.k];

export function simSeed(seed, aff, beast = 'dragon', cutSeconds = 30) {
  const c = newCampaign(seed, BODY2, R3, FRONT, { beast, cutSeconds, tieBreak: true });
  let s = matchFor(c); const sched = [];
  while (s.phase === 'cut') {
    let blue = null;
    if (s.cdUntil.blue <= s.step && s.step % 6 === 0) {
      for (const l of candidates(s, 'blue')) {
        const sa = toScreenInt(aff, l.a), sb = toScreenInt(aff, l.b), rl = { a: toWorld(aff, sa), b: toWorld(aff, sb) };
        const r = resolveStrike(s, 'blue', rl);
        if (r.ok && r.severed !== null && ['claw', 'poison'].includes(s.organs[r.severed].kind)) { blue = rl; sched.push({ step: s.step, sa, sb }); break; }
      }
    }
    s = step(s, { blue }).state;
  }
  const b = simulateBattle(fightersOf(s), battleSeed(c));
  const sevBlue = s.severedN.blue, sevRed = s.severedN.red;
  const tie = b.winner === 'draw' ? (sevBlue > sevRed ? 'win' : sevBlue < sevRed ? 'loss' : 'replay') : null;
  return { seed, sched, sevBlue, sevRed, winner: b.winner, how: b.how, tie };
}
/** 找「重打型」與「判敗型」平手種子各一個（找不到的型別＝null）。 */
export function findTieSeeds(aff) {
  const found = { replay: null, loss: null, win: null, tried: 0 };
  const order = [...KNOWN_TIE_SEEDS]; for (let i = 1; i <= SCAN_MAX; i++) if (!KNOWN_TIE_SEEDS.includes(i)) order.push(i);
  for (const seed of order) {
    if (found.replay && found.loss) break;
    found.tried++;
    const r = simSeed(seed, aff);
    if (r.tie && !found[r.tie]) found[r.tie] = r;
  }
  return found;
}
