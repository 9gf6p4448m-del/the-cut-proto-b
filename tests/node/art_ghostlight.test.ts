// 幽光美術模組的單元測試：所有公開繪圖函式在各種輸入下不丟例外、不修改傳入的物件（輸入深度凍結＋前後 JSON 比對）。
// Node 沒有 Canvas：以記錄呼叫的假 2D context 與假 document.createElement('canvas') 代替；驗的是「純函式性質」，不是畫面好不好看。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls: string[] = [];
function fakeCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} };
  let tr = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
  const target: Record<string, unknown> = {
    createLinearGradient: () => grad, createRadialGradient: () => grad, getTransform: () => tr, setTransform: (a: number) => { tr = { ...tr, a: typeof a === 'number' ? a : 1 }; },
    measureText: () => ({ width: 10 }), getLineDash: () => [],
  };
  return new Proxy(target, {
    get(o, k: string) { if (k in o) return o[k]; return (...args: unknown[]) => { calls.push(k); for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${k} 收到非有限數值 ${a}`); }; },
    set(o, k: string, v) { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) };
const art = await import('../../src/art/ghostlight.ts');
import type { Fx, OrganKind, OrganState, P } from '../../src/art/ghostlight.ts';

function deepFreeze<T>(o: T): T { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; }
const KINDS: OrganKind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
const BLUE: P[] = [[16, 280], [377, 280], [389, 590], [4, 590]], RED: P[] = [[4, 10], [389, 10], [377, 330], [16, 330]];
const T = [0, 0.016, 0.5, 1.234, 7.9, 100];

test('drawScene／drawBeast／drawFrontline／drawBackdrop：不丟例外、不改輸入；不交疊時前線區為空也不丟例外', () => {
  const scene = deepFreeze({ w: 393, h: 600, blue: BLUE, red: RED }), before = JSON.stringify(scene);
  for (const t of T) { const c = fakeCtx(); art.drawScene(c, scene, t); art.drawBeast(c, scene.blue, 'blue', t); art.drawBeast(c, scene.red, 'red', t); art.drawFrontline(c, scene.blue, scene.red, t); art.drawBackdrop(c, 393, 600); }
  assert.equal(JSON.stringify(scene), before);
  const apart = deepFreeze({ blue: [[0, 500], [100, 500], [100, 600], [0, 600]] as P[], red: [[0, 0], [100, 0], [100, 100], [0, 100]] as P[] });
  assert.deepEqual(art.frontlineZone(apart.blue, apart.red), []);
  art.drawFrontline(fakeCtx(), apart.blue, apart.red, 1);
  art.drawBeast(fakeCtx(), deepFreeze([[0, 0], [1, 1]] as P[]), 'blue', 1); // 退化多邊形：不畫、不丟
  // 前線區＝兩獸交集（凸多邊形）：y 280～330
  const z = art.frontlineZone(BLUE, RED); const ys = z.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...ys) - 280) < 1e-6 && Math.abs(Math.max(...ys) - 330) < 1e-6);
});

test('drawOrgan：5 種器官 × 5 種狀態 × 兩方 × 多個時間點與邊界值，不丟例外、不改輸入', () => {
  const states: OrganState[] = [
    { mode: 'normal' }, { mode: 'normal', lit: 1 }, { mode: 'normal', lit: 0.4 },
    { mode: 'locked', k: 1, label: '5.0' }, { mode: 'locked', k: 0 }, { mode: 'sprout', k: 0 }, { mode: 'sprout', k: 1 }, { mode: 'sprout' },
    { mode: 'burst', k: 0, cutAngle: 0.3 }, { mode: 'burst', k: 1 }, { mode: 'normal', boneHp: 1 }, { mode: 'normal', lit: 5, k: -3 },
  ];
  for (const kind of KINDS) for (const side of ['blue', 'red'] as const) for (const st of states) for (const t of T) {
    const o = deepFreeze({ kind, side, x: 120, y: 200, r: 18 }), s = deepFreeze({ ...st }), b0 = JSON.stringify([o, s]);
    art.drawOrgan(fakeCtx(), o, s, t);
    assert.equal(JSON.stringify([o, s]), b0, `${kind}/${side}/${st.mode}`);
  }
});

test('playFx：7 種特效在開始前、進行中、結束後都不丟例外、不改輸入；結束後回傳 false；shakeOffset 只在受擊／暴擊期間非 0', () => {
  const fxs: Fx[] = [
    { type: 'clawShot', t0: 1, from: [10, 10], to: [200, 300], side: 'blue', dmg: 4 }, { type: 'critShot', t0: 1, from: [10, 10], to: [200, 300], side: 'red', dmg: 8 },
    { type: 'heal', t0: 1, at: [50, 50], amount: 3 }, { type: 'poison', t0: 1, at: [50, 50], stacks: 4 }, { type: 'shield', t0: 1, at: [50, 50], value: 11, max: 15, absorbed: 4 },
    { type: 'shield', t0: 1, at: [50, 50], value: 0, max: 0 }, { type: 'hitFlash', t0: 1, poly: RED, side: 'red' }, { type: 'ko', t0: 1, w: 393, h: 852, winner: 'draw' },
    { type: 'clawShot', t0: 1, from: [10, 10], to: [10, 10], side: 'blue' }, // 起終點相同
  ];
  const kinds = new Set<string>();
  for (const f of fxs) {
    const fz = deepFreeze(JSON.parse(JSON.stringify(f)) as Fx), b0 = JSON.stringify(fz), D = art.fxDuration(fz);
    kinds.add(fz.type);
    assert.equal(art.playFx(fakeCtx(), fz, 0.5), true, '尚未開始：仍在佇列中');
    for (const u of [0, 0.01, D * 0.3, D * 0.5, D * 0.99, D * 0.999]) assert.equal(art.playFx(fakeCtx(), fz, 1 + u), true, `${fz.type} @${u}`);
    assert.equal(art.playFx(fakeCtx(), fz, 1 + D + 0.01), false, `${fz.type} 播完`);
    const sh = art.shakeOffset(fz, 1.05);
    if (fz.type === 'hitFlash' || fz.type === 'critShot') assert.ok(Math.hypot(sh[0], sh[1]) > 0); else assert.deepEqual(sh, [0, 0]);
    assert.equal(JSON.stringify(fz), b0, fz.type);
  }
  assert.equal(kinds.size, 7, '7 種特效都有測到');
});

test('決定性：同樣的輸入與時間，畫布呼叫序列相同（不依賴 Math.random）', () => {
  const run = () => { calls.length = 0; const c = fakeCtx(); art.drawOrgan(c, { kind: 'poison', side: 'red', x: 50, y: 60, r: 16 }, { mode: 'burst', k: 0.4 }, 3.2); art.playFx(c, { type: 'ko', t0: 0, w: 300, h: 500, winner: 'blue' }, 0.7); return calls.join(','); };
  run(); // 暖機：第一次會預烤貼圖（快取），呼叫序列本來就多
  assert.equal(run(), run());
});
