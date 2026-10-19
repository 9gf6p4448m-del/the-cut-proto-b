// duel6 試玩紀錄（G5）純模組的單元測試：50 局上限、儲存例外、損壞資料、關頁補標、清除狀態機、複製文字一致性、與規則層解耦。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPlaylog, parseRuns, pressClear, tickClear, CLEAR_IDLE, PLAYLOG_KEY, MAX_RUNS,
  type StorageLike, type StageRec, type RunRec, type ClearState,
} from '../../src/cutbattle/playlog.ts';

function memStore(init?: string): StorageLike & { data: Map<string, string>; sets: number } {
  const data = new Map<string, string>();
  if (init !== undefined) data.set(PLAYLOG_KEY, init);
  const s = { data, sets: 0, getItem: (k: string) => data.get(k) ?? null, setItem(k: string, v: string) { s.sets++; data.set(k, v); } };
  return s;
}
const stage = (n: number, o: Partial<StageRec> = {}): StageRec => ({
  stage: n, replay: 0, firstCutSec: 4.2166667, strokes: 9, cuts: 5, cutBy: 3, locks: 2, blocked: 1, maxPush: 3, maxPushAi: 1,
  skill: { sec: 12.0333, pierce: 2 }, endOrgans: { blue: ['爪', '毒'], red: ['牙'] }, input: 'free',
  battle: { winner: 'blue', how: 'ko', ms: 41234, fastAtMs: null }, tiebreak: null, stitch: null, ...o,
});
const info = (o: Partial<Parameters<ReturnType<typeof createPlaylog>['beginRun']>[0]> = {}) =>
  ({ startedVia: 'first' as const, beast: 'snake' as const, cutSec: 20, input: 'free' as const, tutorial: 'before' as const, ...o });
const mk = (storage: StorageLike | null, t = { v: 1_700_000_000_000 }) => ({ t, log: createPlaylog({ storage, sha: 'abc1234', now: () => t.v }) });
function playRun(log: ReturnType<typeof createPlaylog>, t: { v: number }, result: 'won' | 'lost' = 'won') {
  log.beginRun(info()); t.v += 1000; log.endStage(stage(1)); t.v += 1000; log.endRun(result);
}

// 驗收 1：超量刪最舊、順序不變
test('50 局上限：第 51 局存入後剩 50 局，刪最舊，其餘順序不變', () => {
  const seed: RunRec[] = [];
  const { t, log: seedLog } = mk(memStore());
  void seedLog; void t;
  const st = memStore();
  for (let i = 1; i <= MAX_RUNS; i++) seed.push({ ...(JSON.parse(JSON.stringify({ runIdx: i, startedVia: 'again', gapSec: null, startedAt: 'x', ver: 'duel6', sha: 's', beast: 'snake', cutSec: 20, input: 'free', tutorial: 'before', result: 'won', totalSec: i, stages: [] })) as RunRec) });
  st.data.set(PLAYLOG_KEY, JSON.stringify(seed));
  const m = mk(st);
  playRun(m.log, m.t); // 本次開頁的第 1 局（runIdx=1），變成第 51 筆
  const saved = JSON.parse(st.data.get(PLAYLOG_KEY)!) as RunRec[];
  assert.equal(saved.length, 50);
  assert.deepEqual(saved.slice(0, 49).map((r) => r.totalSec), Array.from({ length: 49 }, (_, i) => i + 2), '最舊(1)被刪、其餘 2..50 順序不變');
  assert.equal(saved[49].runIdx, 1);
  assert.equal(saved[49].result, 'won');
});

// 驗收 2：getItem／setItem 丟例外
test('getItem／setItem 丟例外：不當掉，複製內容含本次開頁的局', () => {
  const boom: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const m = mk(boom);
  assert.doesNotThrow(() => { playRun(m.log, m.t); playRun(m.log, m.t, 'lost'); m.log.setStitch({ offer: ['a'], picked: 'a', p: { x: 1, y: 2 } }); });
  const txt = m.log.copyText();
  assert.match(txt.split('\n')[0], /｜2 局｜/);
  const runs = extractJson(txt);
  assert.deepEqual(runs.map((r) => r.runIdx), [1, 2]);
  // storage 工廠本身丟例外、或 null 也一樣
  const m2 = mk(null); assert.doesNotThrow(() => playRun(m2.log, m2.t));
  const m3 = createPlaylog({ storage: () => { throw new Error('x'); }, sha: 's' }); assert.doesNotThrow(() => m3.beginRun(info()));
});

// 驗收 3：損壞資料當空
for (const bad of ['{not json', '{}', '[1,"x",null]', '"str"', '[{"runIdx":1,"result":"won","stages":[1]}]', 'null']) {
  test(`損壞資料當空處理：${bad}`, () => {
    assert.deepEqual(parseRuns(bad), []);
    const st = memStore(bad);
    let m!: ReturnType<typeof mk>;
    assert.doesNotThrow(() => { m = mk(st); playRun(m.log, m.t); });
    assert.equal(m.log.runs.length, 1);
    assert.equal((JSON.parse(st.data.get(PLAYLOG_KEY)!) as RunRec[]).length, 1);
  });
}

// 驗收 4：局中關頁
test('局中關頁：重開後該局標 unfinished，已打完的第 1 場保留', () => {
  const st = memStore();
  const a = mk(st);
  a.log.beginRun(info()); a.t.v += 5000; a.log.endStage(stage(1)); // 此後直接「關頁」
  const b = mk(st, { v: a.t.v + 100000 }); // 新模組實例讀同一份儲存
  assert.equal(b.log.runs.length, 1);
  assert.equal(b.log.runs[0].result, 'unfinished');
  assert.equal(b.log.runs[0].stages.length, 1);
  assert.equal((JSON.parse(st.data.get(PLAYLOG_KEY)!) as RunRec[])[0].result, 'unfinished', '補標也寫回儲存');
  // 已結束的局不被改標
  const c = mk(st); playRun(c.log, c.t, 'lost');
  const d = mk(st);
  assert.deepEqual(d.log.runs.map((r) => r.result), ['unfinished', 'lost']);
});

test('beginRun 後不 endStage 直接關頁：重開為 unfinished、stages 空、N 局計入', () => {
  const st = memStore();
  const a = mk(st); a.log.beginRun(info());
  const b = mk(st);
  assert.equal(b.log.runs.length, 1);
  assert.equal(b.log.runs[0].result, 'unfinished');
  assert.deepEqual(b.log.runs[0].stages, []);
  assert.match(b.log.copyText().split('\n')[0], /｜1 局｜/);
});

// 局欄位：runIdx／gapSec／abandoned 語意／寫入時機
test('局欄位與寫入時機：gapSec、abandonIfOpen、劃刀途中不寫', () => {
  const st = memStore();
  const { t, log } = mk(st);
  log.beginRun(info());
  assert.equal(st.sets, 1, 'beginRun 寫一次');
  t.v += 3000; log.endStage(stage(1)); assert.equal(st.sets, 2);
  t.v += 2000; assert.equal(log.abandonIfOpen(), true);
  assert.equal(log.runs[0].result, 'abandoned'); assert.equal(log.runs[0].totalSec, 5);
  assert.equal(log.runs[0].gapSec, null, 'runIdx=1 gapSec=null');
  t.v += 7000; log.beginRun(info({ startedVia: 'again' }));
  assert.equal(log.runs[1].gapSec, 7); assert.equal(log.runs[1].runIdx, 2);
  t.v += 1000; log.endStage(stage(1)); log.endRun('lost');
  // 結果畫面按重新征途：前一局已結束，不得改成 abandoned
  assert.equal(log.abandonIfOpen(), false);
  assert.equal(log.runs[1].result, 'lost');
  // 選怪獸前按重新征途（沒 beginRun）不產生紀錄局
  const n = log.runs.length; assert.equal(log.abandonIfOpen(), false); assert.equal(log.runs.length, n);
  // 縫合放下後更新同一筆場紀錄
  const before = st.sets;
  log.beginRun(info({ startedVia: 'restart' })); log.endStage(stage(1)); log.setStitch({ offer: ['爪', '牙'], picked: '牙', p: { x: 3, y: 4 } });
  assert.equal(log.runs[2].stages.length, 1); assert.equal(log.runs[2].stages[0].stitch?.picked, '牙');
  assert.equal(st.sets, before + 3);
});

// 驗收 5：清除狀態機
test('清除狀態機：一次不清、3 秒內兩次才清、3.001 秒不算、逾時回 idle', () => {
  let r = pressClear(CLEAR_IDLE, 1000);
  assert.equal(r.action, 'armed');
  const r2 = pressClear(r.state, 1000 + 3000);
  assert.equal(r2.action, 'cleared'); assert.deepEqual(r2.state, CLEAR_IDLE);
  const r3 = pressClear(r.state, 1000 + 3001);
  assert.equal(r3.action, 'armed', '3.001 秒不算');
  assert.deepEqual(r3.state, { phase: 'armed', at: 4001 }, '逾時那一按重新 armed');
  assert.deepEqual(tickClear(r.state, 1000 + 3000), r.state);
  assert.deepEqual(tickClear(r.state, 1000 + 3001), CLEAR_IDLE);
  // 只按一次資料不變；兩次才清（經 playlog.clear）
  const st = memStore(); const m = mk(st); playRun(m.log, m.t);
  let s: ClearState = CLEAR_IDLE; let rr = pressClear(s, 0); s = rr.state;
  if (rr.action === 'cleared') m.log.clear();
  assert.equal(m.log.runs.length, 1);
  rr = pressClear(s, 2999); if (rr.action === 'cleared') m.log.clear();
  assert.equal(rr.action, 'cleared'); assert.equal(m.log.runs.length, 0);
  assert.deepEqual(JSON.parse(st.data.get(PLAYLOG_KEY)!), []);
});

// 驗收 6：複製文字
function extractJson(txt: string): RunRec[] {
  const m = /```json\n([\s\S]*?)\n```\s*$/.exec(txt);
  assert.ok(m, '要有 ```json 區塊');
  return JSON.parse(m![1]) as RunRec[];
}
test('複製文字：第一行格式、JSON 可解析、N 正確、摘要數字從文字反解後與 JSON 逐值一致', () => {
  const { t, log } = mk(memStore());
  log.beginRun(info({ beast: 'snake' })); t.v += 1000;
  log.endStage(stage(1, { cuts: 5, cutBy: 3 })); log.setStitch({ offer: ['爪', '牙'], picked: '爪', p: { x: 1, y: 2 } });
  log.endStage(stage(2, { tiebreak: { blue: 3, red: 4, result: 'loss' }, battle: { winner: 'red', how: 'time', ms: 9000, fastAtMs: 1234 }, firstCutSec: null, skill: null }));
  t.v += 2000; log.endRun('lost');
  t.v += 4500; log.beginRun(info({ startedVia: 'again', beast: 'dragon', cutSec: 15, input: 'line', tutorial: 'none' }));
  log.endStage(stage(1, { replay: 2, tiebreak: { blue: 7, red: 7, result: 'replay' }, skill: { sec: 3.5 } })); t.v += 800; log.abandonIfOpen();
  t.v += 10; log.beginRun(info({ startedVia: 'restart' })); // 進行中的局也要能複製（零場）
  const txt = log.copyText();
  const lines = txt.split('\n');
  assert.match(lines[0], /^THE CUT 試玩紀錄 v1｜duel6 abc1234｜3 局｜\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const runs = extractJson(txt);
  assert.equal(runs.length, 3);
  const heads = lines.filter((l) => l.startsWith('#'));
  assert.equal(heads.length, 3);
  const VIA: Record<string, string> = { 首局: 'first', 再來一局: 'again', 重新征途: 'restart' };
  const BEAST: Record<string, string> = { 蛇: 'snake', 龍: 'dragon' };
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const h = /^#(\d+) (蛇|龍) (首局|再來一局|重新征途) (\S+)｜(.+?)｜共 ([\d.]+) 秒(?: 間隔 ([\d.]+) 秒)?｜切割期 ([\d.]+) 秒 /.exec(heads[i]);
    assert.ok(h, heads[i]);
    assert.equal(Number(h![1]), r.runIdx); assert.equal(BEAST[h![2]], r.beast); assert.equal(VIA[h![3]], r.startedVia);
    assert.equal(h![5], r.startedAt); assert.equal(Number(h![6]), r.totalSec);
    assert.equal(h![7] === undefined ? null : Number(h![7]), r.gapSec); assert.equal(Number(h![8]), r.cutSec);
    const idx = lines.indexOf(heads[i]);
    const next = lines[idx + 1];
    const stageLine = next !== undefined && !next.startsWith('#') && !next.startsWith('```') ? next : '';
    const parts = stageLine ? stageLine.split('｜') : [];
    assert.equal(parts.length, r.stages.length, '每場一段');
    parts.forEach((p, j) => {
      const s = r.stages[j];
      const m = /^第 (\d+) 場 (.+?) 切 (\d+) 被切 (\d+)(?: 重打(\d+))?(?: 首刀 ([\d.]+) 秒)?(?: 技能 ([\d.]+) 秒)?(?: 快轉 (\d+)ms)?$/.exec(p);
      assert.ok(m, p);
      assert.equal(Number(m![1]), s.stage); assert.equal(Number(m![3]), s.cuts); assert.equal(Number(m![4]), s.cutBy);
      assert.equal(m![5] === undefined ? 0 : Number(m![5]), s.replay);
      assert.equal(m![6] === undefined ? null : Number(m![6]), s.firstCutSec);
      assert.equal(m![7] === undefined ? null : Number(m![7]), s.skill ? s.skill.sec : null);
      assert.equal(m![8] === undefined ? null : Number(m![8]), s.battle.fastAtMs);
      const tb = /^平手比切除 (\d+)：(\d+) (勝|敗|重打)$/.exec(m![2]);
      if (s.tiebreak) {
        assert.ok(tb, m![2]);
        assert.equal(Number(tb![1]), s.tiebreak.blue); assert.equal(Number(tb![2]), s.tiebreak.red);
        assert.equal(tb![3], { win: '勝', loss: '敗', replay: '重打' }[s.tiebreak.result]);
      } else {
        assert.equal(tb, null); assert.equal(m![2], { blue: '勝', red: '敗' }[s.battle.winner] ?? '平');
      }
    });
  }
  // 確實行使過：有首刀小數、有技能、有快轉、有重打、有平手
  assert.ok(runs.some((r) => r.stages.some((s) => s.firstCutSec === 4.22)));
  assert.ok(runs.some((r) => r.stages.some((s) => s.battle.fastAtMs === 1234)));
  assert.ok(runs.some((r) => r.stages.some((s) => s.replay === 2 && s.tiebreak?.result === 'replay')));
  assert.equal(runs[1].gapSec, 4.5);
});

// 驗收 7：與規則層解耦
test('playlog 模組不 import rules／battle／campaign（以 import 行為斷言）', () => {
  const src = readFileSync(new URL('../../src/cutbattle/playlog.ts', import.meta.url), 'utf8');
  const importLines = src.split('\n').filter((l) => /^\s*(import\b|export\s+.*\bfrom\b)/.test(l) || /\bimport\s*\(/.test(l) || /\brequire\s*\(/.test(l));
  assert.deepEqual(importLines, [], `playlog 不得有任何 import：${importLines.join(' / ')}`);
  for (const l of importLines) assert.doesNotMatch(l, /rules|battle|campaign/);
  // 活性：偵測規則本身有效——對一段含 campaign import 的假內容會抓到
  const fake = "import { x } from './campaign.ts';\nconst a = 1;";
  assert.equal(fake.split('\n').filter((l) => /^\s*(import\b|export\s+.*\bfrom\b)/.test(l) && /rules|battle|campaign/.test(l)).length, 1);
});
