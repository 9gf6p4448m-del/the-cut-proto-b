// TS-13 盤面張力檢查（實作前用規則引擎確認；不是好玩的證據、不是最佳策略）。用法：node tools/twinslash_boards.ts
import { aiChoose, applyCut, candidateCuts, newState, resolveCut, key } from '../src/twinslash/rules.ts';
import type { CutResult, State } from '../src/twinslash/rules.ts';
import { BOARDS } from '../src/twinslash/boards.ts';

const fmt = (r: CutResult) => `發動[${r.fired.map((k) => k.split(':')[1])}] 傷害${r.dmg} 切除[${r.severed?.split(':')[1] ?? ''}] 穿過[${r.passed.map((k) => k.split(':')[1])}] ${r.bone ? '撞骨' : ''}${r.spend ? '（用拆刀）' : ''}`;
const best = (cs: CutResult[], f: (r: CutResult) => number) => cs.reduce((x, y) => (f(y) > f(x) ? y : x));
const diff = (s: State) => s.hp.blue - s.hp.red;
function playout(s: State, bluePolicy: (s: State) => CutResult): State {
  while (!s.result) s = applyCut(s, s.turn === 'blue' ? bluePolicy(s) : aiChoose(s));
  return s;
}
const out: string[] = []; const verdict: Record<string, boolean> = {};

// 盤面一：最大即時傷害 vs 拆心
{
  const b = BOARDS[0], s0 = newState(b, 'A1', 'blue', 1);
  const cs = candidateCuts(s0, 'blue');
  const maxD = best(cs, (r) => r.dmg);
  const heart = cs.filter((r) => r.severed === key('red', '心'));
  const sevH = heart.length ? best(heart, (r) => r.dmg) : null;
  out.push(`[${b.name}] 最大傷害刀：${fmt(maxD)}`);
  out.push(`   拆心刀（拆心的刀裡傷害最高者）：${sevH ? fmt(sevH) : '沒有'}`);
  if (sevH) {
    const tA = playout(applyCut(s0, maxD), aiChoose), tB = playout(applyCut(s0, sevH), aiChoose);
    out.push(`   之後雙方貪婪打完：先打最大→血 ${tA.hp.blue}／${tA.hp.red}；先拆心→血 ${tB.hp.blue}／${tB.hp.red}`);
  }
  verdict.b1 = !!sevH && sevH.dmg < maxD.dmg && sevH !== maxD;
}
// 盤面二：先拆心是否為兩刀推演最佳
{
  const b = BOARDS[1], s0 = newState(b, 'A1', 'blue', 1);
  const cs = candidateCuts(s0, 'blue');
  const cat = (pred: (r: CutResult) => boolean) => { const f = cs.filter(pred); return f.length ? best(f, (r) => r.dmg) : null; };
  const opts: [string, CutResult | null][] = [
    ['先拆心', cat((r) => r.severed === key('red', '心'))],
    ['先拆那排的爪', cat((r) => ['爪1', '爪2', '爪3'].some((i) => r.severed === key('red', i)))],
    ['最大傷害', best(cs, (r) => r.dmg)],
  ];
  const score: Record<string, number> = {};
  for (const [lab, c] of opts) {
    if (!c) { out.push(`[${b.name}] ${lab}：沒有合法刀`); continue; }
    const s1 = applyCut(s0, c), s2 = applyCut(s1, aiChoose(s1));
    score[lab] = diff(s2);
    const fin = playout(s1, aiChoose);
    out.push(`[${b.name}] ${lab}：${fmt(c)}｜他回一刀後血差（我−他）${diff(s2)}｜打完血 ${fin.hp.blue}／${fin.hp.red}`);
  }
  const top = Math.max(...Object.values(score));
  verdict.b2 = score['先拆心'] !== undefined && score['先拆心'] < top;
}
// 盤面三（B2，AI 先手，玩家拿到拆刀後）：現在用 vs 先破骨保留
{
  const b = BOARDS[2], s0 = newState(b, 'B2', 'red', 1);
  const s1 = applyCut(s0, aiChoose(s0));
  out.push(`[${b.name}] AI 開局：血 ${s1.hp.blue}／${s1.hp.red}，我的拆刀 ${s1.charges.blue}、餘額 ${s1.meter.blue}`);
  if (s1.charges.blue < 1) { out.push('   我沒有拆刀，盤面三的前提不成立'); verdict.b3 = false; }
  else {
    const cs = candidateCuts(s1, 'blue');
    const threatLine = (() => { const t: State = { ...s1, turn: 'red' }; return aiChoose(t); })();
    const threat = threatLine.fired.filter((k) => k.includes('爪'));
    const spendNow = cs.filter((r) => r.spend && r.severed && threat.includes(r.severed));
    const S = spendNow.length ? best(spendNow, (r) => r.dmg) : null;
    const boneCuts = cs.filter((r) => !r.spend && r.bone === key('red', '骨'));
    const K = boneCuts.length ? best(boneCuts, (r) => r.dmg) : null;
    const maxD = best(cs.filter((r) => !r.spend), (r) => r.dmg);
    out.push(`   他下一刀的威脅：發動 [${threat.map((k) => k.split(':')[1])}]`);
    out.push(`   S 現在用拆刀拆威脅爪：${S ? fmt(S) : '沒有'}`);
    out.push(`   K 先破骨（不用拆刀）：${K ? fmt(K) : '沒有'}｜對照：不用拆刀的最大傷害 ${maxD.dmg}`);
    // 路線：S＝現在用，之後貪婪；K＝先打骨直到破，有拆刀且心可拆時拆心，否則貪婪
    const polK = (s: State): CutResult => {
      const c = candidateCuts(s, 'blue');
      const heart = c.filter((r) => r.spend && r.severed === key('red', '心'));
      if (heart.length) return best(heart, (r) => r.dmg);
      const bone = c.filter((r) => !r.spend && r.bone === key('red', '骨'));
      if (bone.length) return best(bone, (r) => r.dmg);
      return aiChoose(s);
    };
    if (S && K) {
      const fS = playout(applyCut(s1, S), aiChoose), fK = playout(applyCut(s1, K), polK);
      out.push(`   打完：S 路線 血 ${fS.hp.blue}／${fS.hp.red}（${fS.result!.winner}）；K 路線 血 ${fK.hp.blue}／${fK.hp.red}（${fK.result!.winner}）`);
      verdict.b3 = K.dmg < maxD.dmg && (fS.hp.blue - fS.hp.red) !== (fK.hp.blue - fK.hp.red);
    } else verdict.b3 = false;
    // 比凍結條件更嚴的附加檢查（DL-067 修正①的本意＝真取捨）：兩種先手下各打完整局，「先破骨、保留拆刀」是否至少一次優於「有拆刀就拆威脅」
    const polS = (s: State): CutResult => {
      if (s.charges.blue > 0) { const th = aiChoose({ ...s, turn: 'red' }).fired; const c = candidateCuts(s, 'blue').filter((r) => r.spend && r.severed && th.includes(r.severed)); if (c.length) return best(c, (r) => r.dmg); }
      return aiChoose(s);
    };
    const real: string[] = []; let keepWins = false;
    for (const first of ['blue', 'red'] as const) {
      const fS = playout(newState(b, 'B2', first, 1), polS), fK = playout(newState(b, 'B2', first, 1), polK);
      real.push(`${first === 'blue' ? '我先手' : 'AI 先手'}：S 血差 ${diff(fS)}｜K 血差 ${diff(fK)}`);
      if (diff(fK) > diff(fS)) keepWins = true;
    }
    out.push(`   附加（真取捨）：${real.join('；')} → ${keepWins ? '保留拆刀至少一次較好' : '保留拆刀兩種先手都較差＝沒有真取捨'}`);
    verdict.b3real = keepWins;
  }
}
console.log(out.join('\n'));
console.log(`\nTS-13 判定：盤面一 ${verdict.b1 ? '成立' : '未成立'}｜盤面二 ${verdict.b2 ? '成立' : '未成立'}｜盤面三 ${verdict.b3 ? '成立' : '未成立'}（附加・真取捨：${verdict.b3real ? '成立' : '未成立'}）`);
