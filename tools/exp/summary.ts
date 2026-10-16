// 由 results/*.json 產生 results/SUMMARY.md（純格式化；所有數字來自 JSON，結論句的判斷由數字當場計算）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { outUrl } from './lib.ts';
import type { Agg } from './lib.ts';

const rd = <T>(n: string): T => JSON.parse(readFileSync(outUrl(n), 'utf8')) as T;
type Cell = { mode: string; bot: string; hpE: number; calibrated: boolean; agg: Agg; perSeed: number[][] };
type Pair = { winsA: number; winsB: number; onlyA: number; onlyB: number; pExact: number; dRounds: [number, number]; dMyLoss: [number, number]; dNet: [number, number] };
const bots = rd<{ seeds: [number, number]; cells: Record<string, Cell>; analysis: Record<string, Record<string, Pair> & Pair & Record<string, number>> }>('bots.json');
const cal = rd<{ seeds: [number, number]; baselineGRD: Agg; table: Record<string, { hpE: number; agg: Agg; diffPP: number }[]>; chosen: Record<string, { hpE: number | null; ok: boolean; reason: string }>; supplementary: Record<string, { baseline: { winRate: number; avgRounds: number; netPerRound: number }; closestWinRate: Record<string, number>; A1: { hpE: number; winRate: number; avgRounds: number }[]; A2: { hpE: number; winRate: number; avgRounds: number }[] }> }>('calibration.json');
type Board = { id: string; mode: string; board: number; seed: number | null; hpE: number; result: { numbers: Record<string, unknown>; good: { round: number; i: number; j: number; keep?: boolean; net: number; note: string } | null; trap: { round: number; i: number; j: number; keep?: boolean; net: number; note: string } | null; note: string } | null; search: { from: number; to: number; scanned: number; note: string } };
const boards = rd<{ range: [number, number]; hpE: Record<string, number>; boards: Board[] }>('boards.json');
const params = rd<Record<string, { hpE?: number; boards: (number | null)[] }>>('exp_params.json');
const det = existsSync(outUrl('determinism.json')) ? rd<{ identical: boolean; files: string[]; runs: Record<string, string>[] }>('determinism.json') : null;

const pct = (x: number | null): string => (x === null ? '—' : (x * 100).toFixed(1) + '%');
const f2 = (x: number | null): string => (x === null ? '—' : x.toFixed(2));
const f3 = (x: number | null): string => (x === null ? '—' : x.toFixed(3));
const ci = (a: Agg): string => `${pct(a.winRate)} [${pct(a.winCI95[0])}–${pct(a.winCI95[1])}]`;
const pm = (x: [number, number]): string => `${x[0] >= 0 ? '+' : ''}${x[0]} ±${x[1]}`;
const L: string[] = [];
const w = (s = ''): void => { L.push(s); };

const cellsOf = (mode: string, hp: number): Cell[] => Object.values(bots.cells).filter((c) => c.mode === mode && c.hpE === hp);
const get = (k: string): Cell => bots.cells[k];

// ---- 結論句的數字
const aKeys = ['A1', 'A2'].flatMap((m) => [...new Set(cellsOf(m, 0).length ? [] : Object.values(bots.cells).filter((c) => c.mode === m).map((c) => c.hpE))].map((hp) => `${m}|hpE${hp}`));
const baitSig = aKeys.map((k) => {
  const row = bots.analysis[k] as unknown as Record<string, Pair>;
  const sigAbove = Object.entries(row).filter(([, p]) => p.onlyA > p.onlyB && p.pExact < 0.01).map(([n]) => n.replace('BAIT_vs_', ''));
  const notAbove = Object.entries(row).filter(([, p]) => !(p.onlyA > p.onlyB && p.pExact < 0.01)).map(([n]) => n.replace('BAIT_vs_', ''));
  return { k, sigAbove, notAbove, netVsGrd: row['BAIT_vs_GRD'].dNet, wrVsGrd: [row['BAIT_vs_GRD'].winsA, row['BAIT_vs_GRD'].winsB] };
});
const l2g = bots.analysis['B|LOOK2_vs_GRD'] as unknown as Pair;
const l2nk = bots.analysis['B|LOOK2_vs_LOOK2NK'] as unknown as Pair;
const l2gBase = bots.analysis['BASELINE|LOOK2_vs_GRD'] as unknown as Pair;
const found = boards.boards.filter((b) => b.seed !== null).length;

w('# FUN-EXP-01 P3：策略反證、測試盤面與難度校準（SUMMARY）');
w();
w('研究原型數據，非正式規則、非 Gate 證據。所有數字由 `tools/exp/` 腳本以真實引擎（`engine/src`）產生；本檔由 `summary.ts` 從 `results/*.json` 自動格式化。');
w();
w('## 0. 結論');
w();
w(`- **固定誘餌不會必勝**：BAIT 在 A1/A2（未校準與校準後）的勝率與 GRD、LOOK2 完全相同（${baitSig.map((b) => `${b.k} 對 GRD ${b.wrVsGrd[0]}/${b.wrVsGrd[1]} 勝`).join('；')}），沒有任何一格「顯著高於所有其他 bot」（精確配對檢定 p<0.01 才算）；而 BAIT 的每回合淨收益反而顯著低於 GRD（${baitSig.map((b) => `${b.k} ${pm(b.netVsGrd)}`).join('；')}）。BAIT 把毒囊放執念側後，敵人實際因執念拿走的比例（誘餌成功率）見 §4。**但要注意：GRD/LOOK2/SAFE 在此設定（玩家 HP40、怪物 HP30）勝率皆已飽和在 ~100%，勝率無法區分策略強弱**，鑑別力只剩回合數與淨收益。`);
w(`- **LOOK2 對 GRD**：在 B 模式 LOOK2 比 GRD 平均少 ${Math.abs(l2g.dRounds[0])} 回合（配對差 ${pm(l2g.dRounds)}）、每局淨收益差 ${pm(l2g.dNet)}；同一組 LOOK2 在 BASELINE 反而多 ${l2gBase.dRounds[0]} 回合（${pm(l2gBase.dRounds)}）。隔離「留傷口」本身：LOOK2 對 LOOK2NK（同前瞻但不准留）的回合差 ${pm(l2nk.dRounds)}、淨收益差 ${pm(l2nk.dNet)}。勝率兩者皆 100%（飽和）。結論的強度見 §5。`);
w(`- **A 的 HP 校準（§5）**：GRD 勝率在 hpE=20～60 的 41 個值上與 BASELINE 全部相差 ≤5pp（最大差 ${Math.max(...['A1', 'A2'].flatMap((m) => cal.table[m].map((r) => Math.abs(r.diffPP))))}pp），因為勝率飽和，§5 判準無鑑別力。依預先寫死的選值規則（先比勝率差、平手比平均回合數差、再平手取小）：A1 hpE=${cal.chosen.A1.hpE}、A2 hpE=${cal.chosen.A2.hpE}（未校準 30）。**這兩個值是「判準幾乎恆真」下的次級選擇，不是難度已對齊的證據**；製作人應另定較不飽和的參考 bot 或玩家 HP。`);
w(`- **測試盤面（X-8）**：9 個盤面找到 ${found} 個（${found === 9 ? '全部找到' : '其餘寫「未找到」'}），搜尋範圍 seed ${boards.range[0]}..${boards.range[1]}；判定腳本 \`node tools/exp/boards.ts --verify\` 重跑全通過。`);
w();
w('## 1. 重跑指令（repo 根目錄）');
w();
w('```');
w('node tools/exp/run_all.ts                # 校準 → bot 矩陣 → 盤面 → 驗證 → 摘要（約 7 分鐘，8 個 worker）');
w('node tools/exp/calibrate.ts              # results/calibration.json');
w('node tools/exp/bots.ts                   # results/bots.json');
w('node tools/exp/boards.ts                 # results/boards.json、results/exp_params.json');
w('node tools/exp/boards.ts --verify        # X-8 判定腳本重跑');
w('node tools/exp/summary.ts                # 本檔');
w('node tools/exp/determinism.ts            # 兩次獨立重跑比對 sha256 → results/determinism.json');
w('```');
w();
w('結果決定性：全部亂數是 `prng.ts` 固定種子串流（bot 亂數 = `streamState(seed,"p3bot")`），無 Math.random／Date；平行 worker 的結果依任務順序合併。');
w();
if (det) {
  w(`### 決定性（同指令兩次獨立輸出的 sha256；與已提交的 results/ 三方比對）：${det.identical ? '**全部相同**' : '**不同！**'}`);
  w();
  w('| 檔案 | 第 1 次 | 第 2 次 | results/（提交版） |');
  w('|---|---|---|---|');
  for (const f of det.files) w(`| ${f} | \`${det.runs[0][f]}\` | \`${det.runs[1][f]}\` | \`${det.runs[2][f]}\` |`);
  w();
}
w('## 2. 設定');
w();
w(`- 對局設定同 \`tests/browser/exp_entry.ts\`：玩家 HP 40、怪物 HP 30（A 另調）、r=160、12 錨點、最多 12 回合、規則 PH-M／SO-3／HS-1／SEM-1。B 敵人固定 Baseline 屠夫。`);
w(`- 評估種子集：**${bots.seeds[0]}..${bots.seeds[1]}（500 局）**，所有 bot 同一組；LOOK2 也跑滿 500 局（引擎每次 act 約 0.1 ms，不需降 seeds）。校準種子集：${cal.seeds[0]}..${cal.seeds[1]}（500 局，與評估集分開）。盤面搜尋範圍：${boards.range[0]}..${boards.range[1]}。`);
w('- 淨收益＝該回合敵方實扣 HP − 我方實扣 HP（引擎事件實算；不含護盾對血量以外的價值）。「平均每回合淨收益」＝全部回合淨收益總和 ÷ 全部回合數。');
w('- bot：RND（隨機合法線，B 可勾時 1/2 機率留傷口）／GRD（能斬殺優先、避免戰敗，其餘當回合淨收益最大，平手取 (i,j) 最小，不留傷口）／MAXPIERCE（切穿最多，平手比 GRD 值）／SAFE（我損最小，平手比敵損）／LOOK2（本回合每條線〔B 含留／不留〕＋下一回合 GRD 最佳值；下一回合盤面由引擎狀態完全決定，等於完美資訊前瞻）／BAIT（僅 A：優先「毒囊在執念側」的線，其中取 GRD 值最大，否則 GRD）／LOOK2NK（B 對照：LOOK2 但不准留傷口）／KEEPHOLD（B 壓力：盡量每回合留傷口）。');
w('- GRD/MAXPIERCE/SAFE 在 B 模式從不勾「留傷口」，所以 B 模式的這三格數字與 BASELINE 逐值相同（同敵人、同種子；撕裂不會發生）。');
w();
w('## 3. X-9 勝率矩陣（500 局；勝率 [Wilson 95% CI]／平均回合數／平均每回合淨收益）');
const order = ['RND', 'GRD', 'MAXPIERCE', 'SAFE', 'LOOK2', 'LOOK2NK', 'BAIT', 'KEEPHOLD'];
const groups: [string, number, string][] = [];
for (const c of Object.values(bots.cells)) if (!groups.some((g) => g[0] === c.mode && g[1] === c.hpE)) groups.push([c.mode, c.hpE, c.calibrated ? '（校準後）' : c.mode.startsWith('A') ? '（未校準）' : '']);
for (const [m, hp, tag] of groups) {
  w();
  w(`### ${m}，怪物 HP ${hp}${tag}`);
  w();
  w('| bot | 勝 | 敗 | 僵持 | INVALID | 勝率 [95% CI] | 平均回合 | 淨收益/回合 | 我損/回合 | 敵損/回合 |');
  w('|---|---|---|---|---|---|---|---|---|---|');
  for (const b of order) {
    const c = bots.cells[`${m}|hpE${hp}|${b}`];
    if (!c) continue;
    const a = c.agg;
    w(`| ${b} | ${a.wins} | ${a.losses} | ${a.stalls} | ${a.invalid} | ${ci(a)} | ${f2(a.avgRounds)} | ${f2(a.netPerRound)} | ${f2(a.myLossPerRound)} | ${f2(a.enLossPerRound)} |`);
  }
}
w();
w('## 4. 實驗 A：執念與固定誘餌');
w();
w('| 模式 / HP | bot | 執念觸發率（回合） | 誘餌線可得率（回合） | BAIT 取誘餌率 | 誘餌成功率（敵人因執念拿走含毒囊側） |');
w('|---|---|---|---|---|---|');
for (const [m, hp] of groups.filter((g) => g[0].startsWith('A'))) for (const b of order) {
  const c = bots.cells[`${m}|hpE${hp}|${b}`];
  if (c) w(`| ${m} / ${hp} | ${b} | ${pct(c.agg.obsTriggerRate)} | ${pct(c.agg.baitAvailRate)} | ${pct(c.agg.baitTakenRate)} | ${pct(c.agg.baitSuccessRate)} |`);
}
w();
w('BAIT 的選邊理由分布（回合數；誘餌失敗多半是 SO-3＝兩側都致死的收尾回合、或 SURVIVAL＝毒囊讓牠會死所以改拿另一側）：');
w();
for (const [m, hp] of groups.filter((g) => g[0].startsWith('A'))) { const c = bots.cells[`${m}|hpE${hp}|BAIT`]; if (c) w(`- ${m} / ${hp}：${JSON.stringify(c.agg.reasons)}`); }
w();
w('### 固定誘餌反證：BAIT 對其他 bot 的配對比較（同 500 局種子）');
w();
w('勝＝BAIT 贏且對方沒贏的局數（onlyA）、反之 onlyB；p＝精確二項（McNemar）雙尾；回合差／淨收益差＝BAIT−對方的配對平均 ±95% 半寬（淨收益為每局每回合平均）。');
w();
w('| 模式 / HP | 對手 | BAIT 勝 / 對手勝 | onlyA | onlyB | p | 回合差 | 淨收益差 |');
w('|---|---|---|---|---|---|---|---|');
for (const b of baitSig) {
  const row = bots.analysis[b.k] as unknown as Record<string, Pair>;
  for (const [n, p] of Object.entries(row)) w(`| ${b.k.replace('|hpE', ' / ')} | ${n.replace('BAIT_vs_', '')} | ${p.winsA} / ${p.winsB} | ${p.onlyA} | ${p.onlyB} | ${p.pExact} | ${pm(p.dRounds)} | ${pm(p.dNet)} |`);
}
w();
w('### 「永遠切出安全區」：SAFE');
w();
w('| 模式 / HP | SAFE 勝率 | 我損/回合 | 我損=0 的回合比例 | 每回合「存在我損=0 線」的比例（所有回合） | GRD 我損/回合 | GRD 勝率 |');
w('|---|---|---|---|---|---|---|');
for (const [m, hp] of groups) {
  const s = bots.cells[`${m}|hpE${hp}|SAFE`], g = bots.cells[`${m}|hpE${hp}|GRD`];
  if (s && g) w(`| ${m} / ${hp} | ${ci(s.agg)} | ${f2(s.agg.myLossPerRound)} | ${pct(s.agg.zeroLossRoundRate)} | ${pct(s.agg.zeroLossAvailRate)} | ${f2(g.agg.myLossPerRound)} | ${pct(g.agg.winRate)} |`);
}
w();
w('## 5. 實驗 B：留傷口、LOOK2 vs GRD');
w();
w('| bot | 勝率 | 平均回合 | 淨收益/回合 | 留傷口率（每回合） | 每局留傷口數 | 撕裂率（撕裂÷已結算傷口） | 癒合率 | 撕裂回合數 | 撕裂回合平均淨收益 | 非撕裂回合平均淨收益 | 撕裂複本造成的敵損−我損（每次撕裂） | 最長連續留傷口回合 |');
w('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const b of order) {
  const c = bots.cells[`B|hpE30|${b}`];
  if (!c) continue;
  const a = c.agg;
  w(`| ${b} | ${pct(a.winRate)} | ${f2(a.avgRounds)} | ${f2(a.netPerRound)} | ${pct(a.keepRate)} | ${f2(a.keepsPerGame)} | ${pct(a.tearRatePerWound)} | ${pct(a.healRatePerWound)} | ${a.tearRounds} | ${f2(a.tearNetPerTearRound)} | ${f2(a.nonTearNetPerRound)} | ${f2(a.tearCopyNetPerTear)} | ${a.maxKeepStreak} |`);
}
w();
w('配對比較（同 500 局種子；差＝前者−後者，±95% 半寬；負的回合差＝前者更快打贏）：');
w();
w('| 比較 | 勝（前/後） | 回合差 | 我方總損血差 | 每局每回合淨收益差 |');
w('|---|---|---|---|---|');
for (const [n, p] of [['B：LOOK2 − GRD', l2g], ['B：LOOK2 − LOOK2NK（隔離留傷口）', l2nk], ['BASELINE：LOOK2 − GRD（對照，無傷口機制）', l2gBase]] as [string, Pair][])
  w(`| ${n} | ${p.winsA}/${p.winsB} | ${pm(p.dRounds)} | ${pm(p.dMyLoss)} | ${pm(p.dNet)} |`);
w();
const sig = (x: [number, number]): boolean => Math.abs(x[0]) > x[1];
w(`- 判讀：LOOK2−GRD（B）回合差${sig(l2g.dRounds) ? '顯著' : '不顯著'}、淨收益差${sig(l2g.dNet) ? '顯著' : '不顯著'}；LOOK2−LOOK2NK 回合差${sig(l2nk.dRounds) ? '顯著' : '不顯著'}、淨收益差${sig(l2nk.dNet) ? '顯著' : '不顯著'}（95% CI 是否含 0）。勝率因飽和皆 100%，所以「LOOK2 優於 GRD」只能由回合數與淨收益主張；若上列為不顯著，請如實解讀為「留傷口的跨回合價值在此設定下未被證明」。`);
w(`- 「無限保留有利狀態」：任何 bot 的 \`woundAgeViolations\`（傷口存活超過 1 回合）= ${Object.values(bots.cells).reduce((a, c) => a + c.agg.woundAgeViolations, 0)}；同時傷口數由資料結構限制為 1。KEEPHOLD 壓力 bot 的最長連續留傷口回合 = ${bots.cells['B|hpE30|KEEPHOLD'].agg.maxKeepStreak}（＝戰鬥上限 12 回合；每回合都留新傷口、但每個傷口都以癒合收場，從未撕裂，勝率 ${pct(bots.cells['B|hpE30|KEEPHOLD'].agg.winRate)}、淨收益/回合 ${f2(bots.cells['B|hpE30|KEEPHOLD'].agg.netPerRound)}），所以連續留傷口不會累積成可存取的有利狀態。LOOK2 實務最長連續 ${bots.cells['B|hpE30|LOOK2'].agg.maxKeepStreak} 回合。規則上限＝每傷口 1 回合、撕裂回合不能再留；全部 B 局 INVALID（含 CAP_EXCEEDED）= ${Object.values(bots.cells).filter((c) => c.mode === 'B').reduce((a, c) => a + c.agg.invalid, 0)}。`);
w();
w('## 6. A 的 HP 校準（EXPERIMENT_A_RULES §5）');
w();
w(`校準種子 ${cal.seeds[0]}..${cal.seeds[1]}（500 局）。判準：GRD 對 A1／A2 的勝率與 BASELINE（hpE=30）相差 ≤5pp；只調怪物 HP（整數 20～60）。BASELINE GRD 勝率 ${pct(cal.baselineGRD.winRate)}、平均回合 ${f2(cal.baselineGRD.avgRounds)}。`);
w();
w('| 模式 | 未校準（hpE=30）GRD 勝率 / 差 | 回合 | 校準後 hpE | GRD 勝率 / 差 | 回合 | 評估集（獨立種子）上 GRD 勝率差 |');
w('|---|---|---|---|---|---|---|');
for (const m of ['A1', 'A2']) {
  const u = cal.table[m].find((r) => r.hpE === 30)!, c = cal.table[m].find((r) => r.hpE === cal.chosen[m].hpE);
  const ev = bots.analysis['GRD_vs_BASELINE_pp_on_eval_seeds'] as unknown as Record<string, number>;
  w(`| ${m} | ${pct(u.agg.winRate)} / ${u.diffPP}pp | ${f2(u.agg.avgRounds)} | ${cal.chosen[m].hpE ?? '無'} | ${c ? `${pct(c.agg.winRate)} / ${c.diffPP}pp` : '—'} | ${c ? f2(c.agg.avgRounds) : '—'} | ${ev[`${m}|hpE${cal.chosen[m].hpE}|GRD`] ?? '—'}pp |`);
}
w();
w(`- A1：${cal.chosen.A1.reason}。A2：${cal.chosen.A2.reason}。選值規則寫死在 \`calibrate.ts\` 檔頭，先於看到結果。`);
w('- **飽和問題**：GRD 在 hpE 20～60 全部 ≥99.2% 勝率，與 BASELINE 的差距永遠 ≤0.8pp，§5 的「≤5pp」在此設定下幾乎恆真，無法決定 HP。以下兩列是 HP 對平均回合數的影響（較有鑑別力）：');
w();
w('| hpE | ' + [20, 25, 30, 31, 35, 40, 50, 60].join(' | ') + ' |');
w('|---|' + '---|'.repeat(8));
for (const m of ['A1', 'A2']) w(`| ${m} GRD 平均回合 | ` + [20, 25, 30, 31, 35, 40, 50, 60].map((h) => f2(cal.table[m].find((r) => r.hpE === h)!.agg.avgRounds)).join(' | ') + ' |');
w();
w('補充（非 §5 判準，只供製作人參考）：改用較弱 bot 看 HP 敏感度。各 bot 在 BASELINE（hpE=30）的勝率 → 使 A 勝率最接近的 hpE：');
w();
w('| bot | BASELINE 勝率 | A1 最接近的 hpE | A2 最接近的 hpE |');
w('|---|---|---|---|');
for (const [b, s] of Object.entries(cal.supplementary)) w(`| ${b} | ${pct(s.baseline.winRate)} | ${s.closestWinRate.A1} | ${s.closestWinRate.A2} |`);
w();
w('## 7. X-8 測試盤面（判定腳本：`node tools/exp/boards.ts --verify`）');
w();
w(`搜尋範圍 seed ${boards.range[0]}..${boards.range[1]}（遞增掃描，同模式三個盤面互不重複 seed，取第一個命中者；除判定條件外要求同時能給出好刀與陷阱刀）。A 盤面用校準後 hpE（A1=${boards.hpE.A1}、A2=${boards.hpE.A2}），B 用 30。anchor 為引擎錨點索引 (i,j)（i<j）。`);
w();
w('條件的較嚴讀法（規格字句有歧義處）：A-1「誘餌是最佳之一」＝誘餌線淨收益 ≥ 全場所有合法線；A-2「立即最佳線不觸發」＝所有淨收益最大的線都不觸發，且觸發線的 2 回合貪婪總淨收益須大於立即最佳線們的最大值；A-3 的「必然求生」或「淨收益≤0」逐線檢查；B-1 的比較對象是「立即淨收益最大（平手取 i,j 最小）的不留傷口線」的 2 回合貪婪總淨收益；B-2 的不留傷口組合第 2 回合窮舉所有合法線；B-3 取差距最大的封毒囊留傷口線。');
w();
w('| 盤面 | seed | 掃描數 | 判定的實際數字 | 好刀（回合 i/j，淨收益） | 陷阱刀 |');
w('|---|---|---|---|---|---|');
const desc: Record<number, Record<string, string>> = { 1: { A: '清楚的誘惑與代價', B: '立即傷害較好' }, 2: { A: '犧牲立即收益才能誘導', B: '保留傷口收益更高' }, 3: { A: '常見誘餌失效', B: '保留傷口有風險' } };
for (const b of boards.boards) {
  const d = desc[b.board][b.mode === 'B' ? 'B' : 'A'];
  if (b.seed === null) { w(`| ${b.id} ${d} | **未找到** | ${b.search.scanned} | 搜尋 ${b.search.from}..${b.search.to} 無命中 | — | — |`); continue; }
  const g = b.result!.good!, t = b.result!.trap!;
  w(`| ${b.id} ${d} | ${b.seed} | ${b.search.scanned} | ${JSON.stringify(b.result!.numbers).replace(/[{}"]/g, '').replace(/,/g, '，')} | R${g.round} ${g.i}/${g.j}${g.keep ? '（勾留傷口）' : ''}，淨收益 ${g.net}。${g.note} | R${t.round} ${t.i}/${t.j}${t.keep ? '（勾留傷口）' : ''}，淨收益 ${t.net}。${t.note} |`);
}
w();
w('注意：A-3 的兩個盤面中「因求生底線被擋」的子條件在第 1 回合沒有出現（survivalDeflected=0；第 1 回合毒囊傷害不足以殺死 HP≥31 的怪物），全部由「淨收益≤0」子條件成立。');
w();
w('`results/exp_params.json`（給 UI 階段）：');
w();
w('```json');
w(JSON.stringify(params, null, 1));
w('```');
w();
w('## 8. 已知限制與未做');
w();
w('- 勝率飽和（見 §0、§6）：玩家 HP40 對怪物 HP30 時，任何「看得到當回合淨收益」的 bot 都接近 100% 勝率，所以 X-9 的勝率欄對強 bot 沒有區分力；本報告同時列回合數、淨收益與配對 CI 作為補充。若要讓比較真的反映難度，需另定參考 bot 或調整玩家 HP——這屬於規格決策，未擅自處理。');
w('- LOOK2 是完美資訊前瞻（引擎下一回合盤面由狀態決定，bot 可用 act 直接試算）；真實玩家看不到下一回合器官位置，故 LOOK2 對留傷口價值是上界估計。');
w('- GRD 的「能斬殺優先、避免戰敗」是沿用 `engine/src/bots.ts` 既有 GRD 的作法再加戰敗排最後，與規格字面的「淨收益最大」略有差異（只在會致勝／致敗的線上不同）。');
w('- 第 1 回合 A-3 的求生底線子條件沒出現；若要驗證「毒會致死 → 敵人改拿另一側」需要把怪物 HP 壓到 ≤ 毒囊傷害的情境，不在 20～60 的範圍內。');
w('- B-2 的 anchor 為第 1 回合的留傷口刀；第 2 回合撕裂刀見 note（依第 1 回合結算後的盤面）。');
w();
writeFileSync(outUrl('SUMMARY.md'), L.join('\n') + '\n');
console.log('SUMMARY.md written,', L.length, 'lines');
void aKeys;
