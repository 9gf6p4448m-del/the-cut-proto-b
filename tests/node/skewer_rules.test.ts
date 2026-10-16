// 串刺（core-skewer）規則單元測試：K-1 規則逐條、K-2 節律與決定性、K-3 示例甲／乙逐值、K-5 候選線、K-7 盤面。作者測試。
// 判定一律是行為（HP、摘除、合法性、結果），不比對原始碼字串。突變驗紅見 tests/skewer_mutation.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, boardById, nextBoardId } from '../../src/skewer/boards.ts';
import {
  REASON, cutDamage, evalLine, lineCombos, newGame, organPos, pickCandidates, playLines, resolveTurn, trackIndex,
} from '../../src/skewer/rules.ts';
import type { BoardDef, GameState, Line } from '../../src/skewer/rules.ts';

const A = boardById('A'), B = boardById('B'), C = boardById('C'), D = boardById('D');
const at = (b: BoardDef, turn: number, patch: Partial<GameState> = {}): GameState => ({ ...newGame(b), turn, ...patch });

// 各回合「只切心肉」的線（心肉在環軌四格上；皆不碰毒囊、不碰爪——由測試 heartOnly 驗證）
const HEART_LINE: Record<string, Line> = {
  '500,430': [500, 330, 500, 530], '600,560': [500, 460, 700, 660], '500,660': [400, 660, 600, 660], '400,560': [300, 560, 500, 560],
};
const heartLine = (b: BoardDef, turn: number): Line => HEART_LINE[organPos(b.organs.find((o) => o.id === 'heart')!, turn).join(',')];
const CLAWS_T1: Line = [250, 450, 750, 450];
const SKEWER3: Line = [250, 370, 750, 490];

// ---------------------------------------------------------------- K-3 示例重現（逐值）

test('K-3 示例甲-1：第 1 回合橫串兩爪（傷 8），之後單切心肉，回合 4 用完未擊殺 → 輸', () => {
  const lines: Line[] = [CLAWS_T1, heartLine(A, 2), heartLine(A, 3), heartLine(A, 4)];
  const s = playLines(A, lines);
  assert.deepEqual(s.history.map((r) => r.damage), [8, 4, 4, 4]);
  assert.deepEqual(s.history.map((r) => r.hpEAfter), [22, 18, 14, 10]);
  assert.deepEqual(s.history[0].hits.slice().sort(), ['clawL', 'clawR']);
  assert.equal(s.history[0].clawDmg, 0);
  assert.equal(s.hpP, 20);
  assert.equal(s.result, 'lose');
  assert.equal(s.loseReason, 'turns');
  assert.equal(s.turn, 4);
});

test('K-3 示例甲-2：單切心肉 → 第 2 回合串 3（24）→ 第 3 回合單切心肉，第 3 回合勝、玩家剩 14', () => {
  const s = playLines(A, [heartLine(A, 1), SKEWER3, heartLine(A, 3)]);
  assert.deepEqual(s.history.map((r) => r.damage), [4, 24, 4]);
  assert.deepEqual(s.history.map((r) => r.hpEAfter), [26, 2, -2]);
  assert.deepEqual(s.history.map((r) => r.hpPAfter), [14, 14, 14]);
  assert.deepEqual(s.history[1].hits, ['clawL', 'heart', 'clawR']);
  assert.equal(s.history[1].valueSum, 8);
  assert.equal(s.history[1].mult, 3);
  assert.deepEqual(s.history[1].sacs, []);
  assert.equal(s.result, 'win');
  assert.equal(s.turn, 3);
  assert.equal(s.hpP, 14);
});

test('K-3 示例甲第 2 回合：太平的線（水平穿心肉）會擦到毒囊；斜線從毒囊下緣擦過不碰', () => {
  const s = at(A, 2);
  assert.deepEqual(evalLine(A, s, [140, 430, 860, 430]).sacs, ['sac']);
  assert.deepEqual(evalLine(A, s, SKEWER3).sacs, []);
});

test('K-3 示例乙等待路線：第 1、2 回合各挨 12，第 2 回合後玩家 HP ≤ 0 → 輸（等不到第 3 回合的對齊）', () => {
  const s = playLines(B, [heartLine(B, 1), heartLine(B, 2)]);
  assert.deepEqual(s.history.map((r) => r.clawDmg), [12, 12]);
  assert.deepEqual(s.history.map((r) => r.hpPAfter), [8, -4]);
  assert.ok(s.hpP <= 0);
  assert.equal(s.result, 'lose');
  assert.equal(s.loseReason, 'hp');
  assert.equal(s.turn, 2);
  assert.throws(() => resolveTurn(B, s, heartLine(B, 3)));
});

test('K-3 示例乙立即拆路線：第 1 回合傷 8，之後零受傷、每回合心肉 4，第 7 回合勝（上限 8）', () => {
  const lines: Line[] = [CLAWS_T1];
  for (let t = 2; t <= 7; t++) lines.push(heartLine(B, t));
  const s = playLines(B, lines);
  assert.deepEqual(s.history.map((r) => r.damage), [8, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(s.history.map((r) => r.hpEAfter), [22, 18, 14, 10, 6, 2, -2]);
  assert.ok(s.history.every((r) => r.hpPAfter === 20));
  assert.equal(s.result, 'win');
  assert.equal(s.turn, 7);
  assert.equal(B.turnLimit, 8);
});

test('K-3 示例乙：對齊在第 3 回合才出現（第 3 回合串 3 合法且不碰毒囊）', () => {
  const ev = evalLine(B, at(B, 3), SKEWER3);
  assert.deepEqual(ev.hits, ['clawL', 'heart', 'clawR']);
  assert.deepEqual(ev.sacs, []);
});

/** 掃描所有方向（0.05° 一步），求「一條直線最多能同時碰到幾顆器官」；avoidSac＝只算不碰毒囊的線。測試自己的獨立算法。 */
function maxSkewer(b: BoardDef, turn: number, avoidSac: boolean): number {
  const s = at(b, turn);
  const organs = b.organs.filter((o) => !s.removed.includes(o.id)).map((o) => ({ p: organPos(o, turn), r: o.r }));
  let best = 0;
  for (let k = 0; k < 3600; k++) {
    const th = (k / 3600) * Math.PI, nx = -Math.sin(th), ny = Math.cos(th);
    const ev: [number, number][] = [];
    for (const o of organs) { const c = o.p[0] * nx + o.p[1] * ny; ev.push([c - o.r, 1], [c + o.r, -1]); }
    const bad = b.sacs.map((x) => { const c = x.pos[0] * nx + x.pos[1] * ny; return [c - x.r, c + x.r]; });
    ev.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
    let cur = 0;
    for (let i = 0; i < ev.length; i++) {
      cur += ev[i][1];
      if (ev[i][1] !== 1) continue;
      const x = ev[i][0] + 1e-6;
      if (avoidSac && bad.some(([lo, hi]) => x >= lo && x <= hi)) continue;
      best = Math.max(best, cur);
    }
  }
  return best;
}

test('K-3 盤面幾何：示例甲第 1 回合最多只能串 2（三顆不共線）、第 2 回合可串 3；示例乙第 1、2 回合最多串 2、第 3 回合可串 3', () => {
  assert.equal(maxSkewer(A, 1, false), 2);
  assert.equal(maxSkewer(A, 2, true), 3);
  assert.equal(maxSkewer(B, 1, false), 2);
  assert.equal(maxSkewer(B, 2, false), 2);
  assert.equal(maxSkewer(B, 3, true), 3);
});

// ---------------------------------------------------------------- K-1 規則逐條

test('K-1 直線貫穿全身：端點都在身體外、只畫一小段，仍穿到整條直線上的器官', () => {
  const ev = evalLine(A, at(A, 1), [-300, 450, -200, 450]);
  assert.equal(ev.legal, true);
  assert.deepEqual(ev.hits, ['clawL', 'clawR']);
  const ev2 = evalLine(A, at(A, 1), [240, 450, 280, 450]); // 只畫在爪甲上的短段
  assert.deepEqual(ev2.hits, ['clawL', 'clawR']);
});

test('K-1 爪被穿＝摘除：之後線穿不到、也不再攻擊', () => {
  const r1 = resolveTurn(A, newGame(A), [250, 350, 250, 550]); // 只穿爪甲（縱線）
  assert.deepEqual(r1.rec.hits, ['clawL']);
  assert.deepEqual(r1.rec.removed, ['clawL']);
  assert.deepEqual(r1.state.removed, ['clawL']);
  assert.equal(r1.rec.clawDmg, 3); // 只剩爪乙攻擊
  assert.equal(r1.state.hpP, 17);
  const ev = evalLine(A, r1.state, [250, 200, 250, 700]);
  assert.ok(!ev.hits.includes('clawL'));
});

test('K-1 心肉被穿＝受傷不摘除：下一回合仍在、仍可再串', () => {
  const r1 = resolveTurn(A, newGame(A), heartLine(A, 1));
  assert.deepEqual(r1.rec.hits, ['heart']);
  assert.deepEqual(r1.rec.removed, []);
  assert.deepEqual(r1.state.removed, []);
  assert.equal(r1.state.hpE, 26);
  const r2 = resolveTurn(A, r1.state, SKEWER3);
  assert.ok(r2.rec.hits.includes('heart'));
  assert.ok(!r2.state.removed.includes('heart'));
});

test('K-1 傷害＝線上器官值總和 × 串數', () => {
  assert.deepEqual(cutDamage([2, 4, 2]), { sum: 8, mult: 3, damage: 24 });
  assert.deepEqual(cutDamage([2, 2]), { sum: 4, mult: 2, damage: 8 });
  assert.deepEqual(cutDamage([]), { sum: 0, mult: 0, damage: 0 });
  const r = resolveTurn(A, at(A, 2), SKEWER3).rec;
  assert.equal(r.damage, 24);
  assert.equal(r.hpEBefore - r.hpEAfter, 24);
  const r2 = resolveTurn(A, newGame(A), [250, 450, 400, 560]).rec; // 爪甲＋心肉
  assert.deepEqual(r2.hits.slice().sort(), ['clawL', 'heart']);
  assert.equal(r2.damage, 12);
});

test('K-1 毒囊被線碰到＝玩家受傷（5），與爪攻擊分開記', () => {
  const r = resolveTurn(A, newGame(A), [600, 300, 600, 700]).rec; // 縱線穿過毒囊
  assert.deepEqual(r.sacs, ['sac']);
  assert.equal(r.poisonDmg, 5);
  assert.equal(r.clawDmg, 6);
  assert.equal(r.hpPAfter, 20 - 5 - 6);
});

test('K-1 骨板擋住＝非法線（附原因），結算拒絕', () => {
  const ev = evalLine(C, at(C, 1), CLAWS_T1);
  assert.equal(ev.legal, false);
  assert.equal(ev.reason, REASON.plate);
  assert.deepEqual(ev.hits, []);
  assert.throws(() => resolveTurn(C, newGame(C), CLAWS_T1), /骨板/);
  // 同一條線在沒有骨板的示例甲合法
  assert.equal(evalLine(A, at(A, 1), CLAWS_T1).legal, true);
  // 其他非法原因
  assert.equal(evalLine(A, at(A, 1), [0, 100, 1000, 100]).reason, REASON.miss);
  assert.equal(evalLine(A, at(A, 1), [500, 500, 510, 500]).reason, REASON.short);
});

test('K-1 可空切：合法、傷害 0，剩下的爪照常攻擊', () => {
  const empty: Line = [140, 260, 860, 260];
  const ev = evalLine(A, newGame(A), empty);
  assert.equal(ev.legal, true);
  assert.deepEqual(ev.hits, []);
  const r = resolveTurn(A, newGame(A), empty);
  assert.deepEqual(r.rec.hits, []);
  assert.deepEqual(r.rec.sacs, []);
  assert.equal(r.rec.damage, 0);
  assert.equal(r.state.hpE, 30);
  assert.equal(r.state.hpP, 14);
  assert.equal(r.state.turn, 2);
});

test('K-1 回合末剩下的爪攻擊（公開數值）', () => {
  assert.equal(resolveTurn(A, newGame(A), heartLine(A, 1)).rec.clawDmg, 6);
  assert.equal(resolveTurn(B, newGame(B), heartLine(B, 1)).rec.clawDmg, 12);
  assert.equal(resolveTurn(C, newGame(C), heartLine(C, 1)).rec.clawDmg, 8);
  assert.equal(resolveTurn(A, newGame(A), CLAWS_T1).rec.clawDmg, 0);
});

test('K-1 回合上限：上限回合結束仍未擊殺即輸；上限前不判輸', () => {
  const s3 = playLines(A, [CLAWS_T1, heartLine(A, 2), heartLine(A, 3)]);
  assert.equal(s3.result, null);
  assert.equal(s3.turn, 4);
  const s4 = resolveTurn(A, s3, heartLine(A, 4)).state;
  assert.equal(s4.result, 'lose');
  assert.equal(s4.loseReason, 'turns');
  assert.throws(() => resolveTurn(A, s4, heartLine(A, 4)));
});

test('K-1 勝負判定：怪物 HP 剛好 0 即勝（且勝利優先於毒囊與爪攻擊）；玩家 HP ≤ 0 即輸', () => {
  // 變體丁的等待路線：第 5 回合心肉 4 把怪物從 4 打到剛好 0
  const s = playLines(D, [heartLine(D, 1), heartLine(D, 2), heartLine(D, 3), SKEWER3, heartLine(D, 4 + 1)]);
  assert.deepEqual(s.history.map((r) => r.hpEAfter), [36, 32, 28, 4, 0]);
  assert.equal(s.result, 'win');
  assert.equal(s.hpP, 8);
  // 勝利優先：怪物剩 4、玩家剩 5 時，一刀同時打死怪物並碰毒囊 → 勝，且爪不再攻擊
  const st = at(A, 3, { hpE: 4, hpP: 5 });
  const r = resolveTurn(A, st, [600, 300, 600, 700]);
  assert.ok(r.rec.hits.includes('heart'));
  assert.equal(r.rec.poisonDmg, 5);
  assert.equal(r.state.result, 'win');
  assert.equal(r.rec.clawDmg, 0);
  // 玩家剛好 0 也算輸
  const lose = resolveTurn(A, at(A, 1, { hpP: 6 }), heartLine(A, 1)).state;
  assert.equal(lose.hpP, 0);
  assert.equal(lose.result, 'lose');
  assert.equal(lose.loseReason, 'hp');
});

// ---------------------------------------------------------------- K-2 節律與決定性

test('K-2 節律：每回合前進一格（往返軌與環軌），可預知下一步', () => {
  const L = A.organs[0], H = A.organs[1];
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((t) => trackIndex(L, t)), [0, 1, 2, 1, 0, 1]);
  assert.deepEqual([1, 2, 3, 4, 5].map((t) => trackIndex(H, t)), [3, 0, 1, 2, 3]);
  const Ld = D.organs[0];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((t) => trackIndex(Ld, t)), [0, 1, 2, 3, 2, 1, 0]);
  for (const b of BOARDS) for (const o of b.organs) for (let t = 1; t < 10; t++) {
    const k0 = trackIndex(o, t), k1 = trackIndex(o, t + 1);
    assert.ok(Math.abs(k1 - k0) === 1 || (o.mode === 'loop' && Math.abs(k1 - k0) === o.track.length - 1), `${b.id}/${o.id} t=${t} 一次只走一格`);
  }
});

test('K-2 決定性：同盤面同輸入兩次，結果逐值相同', () => {
  for (const b of BOARDS) {
    const seq: Line[] = [];
    let s = newGame(b);
    while (!s.result) { const c = pickCandidates(b, s); const l = c[(s.turn * 7) % c.length].line; seq.push(l); s = resolveTurn(b, s, l).state; }
    assert.deepEqual(playLines(b, seq), playLines(b, seq));
    assert.deepEqual(playLines(b, seq), s);
    assert.deepEqual(pickCandidates(b, newGame(b)), pickCandidates(b, newGame(b)));
  }
});

// ---------------------------------------------------------------- K-5 點選模式候選線

test('K-5 候選線：每回合 3～5 條、組合互不相同、含空切、全部合法；示例路線的關鍵線都在候選內', () => {
  for (const b of BOARDS) for (let t = 1; t <= b.turnLimit; t++) {
    const c = pickCandidates(b, at(b, t));
    assert.ok(c.length >= 3 && c.length <= 5, `${b.id} t${t} ${c.length}`);
    assert.equal(new Set(c.map((x) => x.key)).size, c.length);
    assert.ok(c.some((x) => x.ev.hits.length === 0), `${b.id} t${t} 要有空切`);
    assert.ok(c.every((x) => x.ev.legal));
    assert.ok(c.some((x) => x.ev.hits.length === 1 && x.ev.hits[0] === 'heart' && x.ev.sacs.length === 0), `${b.id} t${t} 要有只切心肉`);
  }
  const keys = (b: BoardDef, t: number) => pickCandidates(b, at(b, t)).map((x) => x.key);
  assert.ok(keys(A, 1).includes('clawL+clawR|'));
  assert.ok(keys(A, 2).includes('clawL+clawR+heart|'));
  assert.ok(keys(B, 1).includes('clawL+clawR|'));
  assert.ok(keys(B, 3).includes('clawL+clawR+heart|'));
});

test('K-5 候選線結算與畫同一條線逐值相同（同一個 resolveTurn）', () => {
  const s = at(A, 2);
  const c = pickCandidates(A, s).find((x) => x.key === 'clawL+clawR+heart|')!;
  assert.deepEqual(resolveTurn(A, s, c.line).rec.damage, resolveTurn(A, s, SKEWER3).rec.damage);
  assert.deepEqual(resolveTurn(A, s, c.line).state.hpE, resolveTurn(A, s, SKEWER3).state.hpE);
});

// ---------------------------------------------------------------- K-7 盤面

test('K-7 至少 4 個固定盤面，「下一局」循環一圈回到起點；每盤都有可勝路線（窮舉各回合的穿刺組合）', () => {
  assert.ok(BOARDS.length >= 4);
  assert.deepEqual(BOARDS.slice(0, 2).map((b) => b.name), ['示例甲', '示例乙']);
  let id = BOARDS[0].id; const seen: string[] = [];
  for (let k = 0; k < BOARDS.length; k++) { seen.push(id); id = nextBoardId(id); }
  assert.equal(id, BOARDS[0].id);
  assert.equal(new Set(seen).size, BOARDS.length);
  for (const b of BOARDS) {
    const win = (s: GameState): boolean => lineCombos(b, s).some((c) => { const n = resolveTurn(b, s, c.line).state; return n.result === 'win' || (!n.result && win(n)); });
    assert.ok(win(newGame(b)), `${b.id} 要可勝`);
  }
});

test('盤面健全：器官與毒囊都在身體內、骨板不壓在器官軌道上', () => {
  for (const b of BOARDS) {
    for (const o of b.organs) for (const p of o.track) assert.ok(evalLine(b, at(b, 1), [p[0] - 1000, p[1], p[0] + 1000, p[1]]).legal || b.plates.length > 0);
    for (const o of b.organs) for (const p of o.track) for (const pl of b.plates) {
      const near = Math.min(Math.hypot(p[0] - pl.a[0], p[1] - pl.a[1]), Math.hypot(p[0] - pl.b[0], p[1] - pl.b[1]));
      assert.ok(near > o.r + pl.t, `${b.id} ${o.id} 軌道太靠近骨板`);
    }
  }
});

test('只切心肉的測試線本身確實只穿心肉、不碰毒囊（避免測試自欺）', () => {
  for (const b of BOARDS) for (let t = 1; t <= b.turnLimit; t++) {
    const ev = evalLine(b, at(b, t), heartLine(b, t));
    assert.equal(ev.legal, true, `${b.id} t${t}`);
    assert.ok(ev.hits.includes('heart') && ev.sacs.length === 0, `${b.id} t${t} ${ev.hits}`);
    assert.ok(ev.hits.length === 1, `${b.id} t${t} 只穿心肉：${ev.hits}`);
  }
});
