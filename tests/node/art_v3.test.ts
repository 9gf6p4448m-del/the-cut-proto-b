// 幽光 v3（duel v0.3 手感與可讀性，DL-084）繪圖函式：凍結驗收 AV3-1、7、8（淡出）、9、10（the-cut docs/art-direction/ghostlight/cut-battle/art-kit-v3/ACCEPTANCE.md）。
// 以「會記錄呼叫」的假 canvas 代替瀏覽器：只驗純函式性質與畫了什麼（圓框、位移、淡出），像素量測（AV3-2～5、8 樣式）在 tests/browser/artkit_tests.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Call = { k: string; a: unknown[]; comp?: string; stroke?: string };
let canvasId = 0;
const LOG: Call[] = [];
function fakeCtx(w = 64, h = 64): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} }; let tr = { a: 1 };
  const t: Record<string, unknown> = {
    globalCompositeOperation: 'source-over', strokeStyle: '#000',
    createLinearGradient: () => grad, createRadialGradient: () => grad, getTransform: () => tr, setTransform: (a: number) => { tr = { a: typeof a === 'number' ? a : 1 }; },
    getImageData: (_x: number, _y: number, W: number, H: number) => ({ width: W || w, height: H || h, data: new Uint8ClampedArray((W || w) * (H || h) * 4).fill(128) }),
    createImageData: (W: number, H: number) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }), measureText: () => ({ width: 10 }),
  };
  return new Proxy(t, {
    get(o, k: string) { if (k in o) return o[k]; return (...args: unknown[]) => { for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${k} 收到非有限數值`); LOG.push({ k, a: args, comp: o.globalCompositeOperation as string, stroke: String(o.strokeStyle) }); }; },
    set(o, k: string, v) { o[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
function fakeCanvas(w = 64, h = 64) { const c = { width: w, height: h, __id: ++canvasId, getContext: () => fakeCtx(c.width, c.height) }; return c; }
(globalThis as unknown as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
(globalThis as unknown as Record<string, unknown>).HTMLImageElement = class {};
const S = await import('../../src/art/sprites.ts');
import type { Fx2, Kind, OrganStateV3, Side, TrailPt } from '../../src/art/sprites.ts';

function deepFreeze<T>(o: T): T { if (o && typeof o === 'object' && !ArrayBuffer.isView(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; }
const KINDS: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
const IM = fakeCanvas(256, 256) as unknown as HTMLCanvasElement, BODY = fakeCanvas(120, 180) as unknown as HTMLCanvasElement;
/** 這次繪製中，對「以 (x,y) 為圓心、半徑 ≥0.9r 的整圓」呼叫 stroke 的次數（＝圓框）。 */
function circleFrames(calls: Call[], x: number, y: number, r: number): number {
  let path: unknown[][] = [], n = 0;
  for (const c of calls) {
    if (c.k === 'beginPath') path = [];
    else if (c.k === 'arc') path.push(c.a);
    else if (c.k === 'stroke') for (const [ax, ay, ar, a0, a1] of path as number[][]) if (Math.hypot(ax - x, ay - y) < 1 && ar >= 0.9 * r && Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) n++;
  }
  return n;
}
const drawn = (f: () => void): Call[] => { LOG.length = 0; f(); return LOG.slice(); };

test('AV3-1 器官無圓框：normal／cuttable／lit／sprout／target 都不 stroke 半徑 ≥0.9r 的整圓；偵測器本身會抓到 v2 的圓框與 v3 的鎖定護盾環', () => {
  const o = { kind: 'heart' as Kind, side: 'red' as Side, x: 100, y: 120, r: 34 };
  const states: OrganStateV3[] = [{ mode: 'normal' }, { mode: 'normal', cuttable: true }, { mode: 'normal', cuttable: true, lit: 1 }, { mode: 'normal', lit: 0.5 }, { mode: 'sprout' }, { mode: 'normal', target: true }];
  for (const k of KINDS) for (const side of ['blue', 'red'] as Side[]) for (const st of states) for (const t of [0, 0.31, 1.7]) {
    const calls = drawn(() => S.drawOrganV3(fakeCtx(), IM, { ...o, kind: k, side }, st, t));
    assert.equal(circleFrames(calls, o.x, o.y, o.r), 0, `${k}/${side}/${JSON.stringify(st)}@${t}`);
  }
  // 鑑別力：同一個偵測器在 v2 drawOrganSprite（有雙層圓框）和 v3 鎖定（護盾環，規格允許）上要抓得到
  assert.ok(circleFrames(drawn(() => S.drawOrganSprite(fakeCtx(), IM, o, { mode: 'normal' }, 0)), o.x, o.y, o.r) >= 1, 'v2 圓框應被偵測到');
  assert.ok(circleFrames(drawn(() => S.drawOrganV3(fakeCtx(), IM, o, { mode: 'locked', k: 0.5 }, 0)), o.x, o.y, o.r) >= 1, '鎖定護盾環應被偵測到');
});

test('AV3-3 輔助：drawOrganV3 把預烤層（光邊＋本體合成）畫在 (x−half, y−half, 2·half)，half＝r＋pad（層的中心＝器官中心；像素量測見瀏覽器測試）', () => {
  for (const r of [34, 20]) {
    const L = S.organLayers(IM, 'eye', 'blue', r, 1), half = r + L.pad;
    const calls = drawn(() => S.drawOrganV3(fakeCtx(), IM, { kind: 'eye', side: 'blue', x: 150, y: 90, r }, { mode: 'normal' }, 0));
    const imgs = calls.filter((c) => c.k === 'drawImage' && c.a.length === 5);
    assert.ok(imgs.length >= 1, '有貼器官層'); for (const c of imgs) assert.deepEqual(c.a.slice(1), [150 - half, 90 - half, half * 2, half * 2]);
  }
});

test('AV3-7 切除特效：兩半垂直刀向的分量相反、隨時間分開；開始時不位移；0.6 秒後 playFx2 回傳 false', () => {
  for (const angle of [0, 0.7, -1.2, Math.PI / 2, 3]) {
    const f = deepFreeze({ type: 'split', t0: 2, im: IM, x: 100, y: 200, r: 34, angle, side: 'red' }) as Extract<Fx2, { type: 'split' }>;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    const h0 = S.splitHalves(f, 2); assert.ok(Math.hypot(...h0[0]) < 1e-9 && Math.hypot(...h0[1]) < 1e-9, '開始時不位移');
    let prev = 0;
    for (const t of [2.1, 2.3, 2.6]) {
      const [a, b] = S.splitHalves(f, t), pa = a[0] * nx + a[1] * ny, pb = b[0] * nx + b[1] * ny;
      assert.ok(pa < 0 && pb > 0, `angle=${angle} t=${t} 垂直分量應相反：${pa.toFixed(2)} / ${pb.toFixed(2)}`);
      assert.ok(pb - pa > prev, '隨時間分得更開'); prev = pb - pa;
      const da = a[0] * Math.cos(angle) + a[1] * Math.sin(angle); assert.ok(da > 0, '順著刀的方向飛出');
    }
    assert.equal(S.fx2Duration(f), 0.6);
    assert.equal(S.playFx2(fakeCtx(), f, 1.9), true); assert.equal(S.playFx2(fakeCtx(), f, 2.3), true); assert.equal(S.playFx2(fakeCtx(), f, 2.61), false);
  }
});

test('AV3-8 刀痕淡出：超過壽命或還沒發生的段不畫；壽命內的段數＝畫的段數；trailAlive 跟著變', () => {
  const pts: TrailPt[] = deepFreeze(Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 50 + i, t: i * 0.02 })));
  const segs = (now: number, life?: number) => drawn(() => S.drawTrail(fakeCtx(), pts, now, false, life)).filter((c) => c.k === 'moveTo').length / 3; // 亮刀每段 3 層
  const expect = (now: number, life = S.TRAIL_LIFE) => pts.filter((p, i) => i > 0 && now - p.t >= 0 && now - p.t <= life).length;
  for (const now of [0.1, 0.38, 0.5, 0.63, 0.7]) assert.equal(segs(now), expect(now), `now=${now}`);
  assert.equal(segs(5), 0); assert.equal(S.trailAlive(pts, 5), false); assert.equal(S.trailAlive(pts, 0.4), true);
  assert.equal(segs(0.5, 0.1), expect(0.5, 0.1));
  // 樣式：亮刀用 lighter 疊加、鈍刀用 source-over（灰）；每點的 blunt 蓋過整條設定
  const comps = (b: boolean, ps = pts) => new Set(drawn(() => S.drawTrail(fakeCtx(), ps, 0.4, b)).filter((c) => c.k === 'stroke').map((c) => c.comp));
  assert.deepEqual([...comps(false)], ['lighter']); assert.deepEqual([...comps(true)], ['source-over']);
  assert.deepEqual([...comps(false, pts.map((p) => ({ ...p, blunt: true })))], ['source-over']);
});

test('AV3-9 教學虛擬手：手沿路徑移動（15% 在起點、70% 以後在終點），播完回傳 false', () => {
  const path = deepFreeze([[300, 700], [200, 400], [80, 150]] as [number, number][]);
  const handAt = (t: number) => { const c = drawn(() => S.playTutorialSwipe(fakeCtx(), path, 1, t, 3)).filter((x) => x.k === 'translate'); return c.at(-1)?.a as number[] | undefined; };
  const near = (p: number[] | undefined, q: number[]) => !!p && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  assert.ok(near(handAt(1 + 0.15 * 3), path[0]), '15% 在起點'); assert.ok(near(handAt(1 + 0.72 * 3), path[2]), '70% 以後在終點');
  const mid = handAt(1 + 0.3 * 3)!; assert.ok(mid[1] < 700 && mid[1] > 150, '中途在路徑上');
  assert.ok(near(S.pathPoint(path, 0), path[0]) && near(S.pathPoint(path, 1), path[2]));
  const L1 = Math.hypot(100, 300), L2 = Math.hypot(120, 250); assert.ok(near(S.pathPoint(path, L1 / (L1 + L2)), path[1]), '依弧長');
  assert.equal(S.playTutorialSwipe(fakeCtx(), path, 1, 0.5, 3), true); assert.equal(S.playTutorialSwipe(fakeCtx(), path, 1, 2.5, 3), true); assert.equal(S.playTutorialSwipe(fakeCtx(), path, 1, 4.01, 3), false); assert.equal(S.playTutorialSwipe(fakeCtx(), path, 1, 1.5, -3), false, 'dur 負值＝不播'); assert.equal(S.playTutorialSwipe(fakeCtx(), path, 1, 1.5, 0), false);
  // 有畫刀痕（劃過期間）
  assert.ok(drawn(() => S.playTutorialSwipe(fakeCtx(), path, 1, 1 + 0.4 * 3, 3)).some((c) => c.k === 'moveTo'), '劃過時有刀痕');
});

test('AV3-10 不改輸入、不丟例外：v3 新函式與 drawDuelScene(dim) 在各種 t（含負值、邊界、超過時長）', () => {
  const rect = { x: 0, y: 300, w: 393, h: 500 };
  const states: OrganStateV3[] = [{ mode: 'normal' }, { mode: 'normal', cuttable: true, lit: 1 }, { mode: 'normal', lit: 9 }, { mode: 'normal', lit: -3 }, { mode: 'locked', k: 0.4, label: '2.1' }, { mode: 'locked' }, { mode: 'sprout' }, { mode: 'normal', target: true }];
  const pts: TrailPt[] = [{ x: 1, y: 2, t: 0 }, { x: 5, y: 9, t: 0.05, blunt: true }, { x: 20, y: 30, t: 0.1 }, { x: 22, y: 31, t: 0.1 }];
  const path: [number, number][] = [[10, 10], [10, 10], [200, 300]];
  for (const t of [-1, 0, 0.05, 0.3, 0.6, 3, 99]) {
    for (const k of KINDS) for (const side of ['blue', 'red'] as Side[]) for (const st of states) {
      const o = deepFreeze({ kind: k, side, x: 50, y: 60, r: 34 }), s = deepFreeze({ ...st }), b = JSON.stringify([o, s]);
      S.drawOrganV3(fakeCtx(), IM, o, s, t); assert.equal(JSON.stringify([o, s]), b);
    }
    S.drawOrganV3(fakeCtx(), IM, deepFreeze({ kind: 'eye', side: 'blue', x: 5, y: 5, r: 0 }), { mode: 'normal' }, t); // r 不合法→預設 34
    const f = Object.freeze({ type: 'split', t0: 0, im: IM, x: 10, y: 20, r: 34, angle: 1, side: 'blue', kind: 'poison', body: BODY, rect: Object.freeze({ ...rect }) }) as Fx2, fb = JSON.stringify({ ...f, im: 0, body: 0 });
    S.playFx2(fakeCtx(), f, t); S.splitHalves(f as Extract<Fx2, { type: 'split' }>, t); assert.equal(JSON.stringify({ ...f, im: 0, body: 0 }), fb);
    const fp = deepFreeze(pts.map((p) => ({ ...p }))), pb = JSON.stringify(fp);
    S.drawTrail(fakeCtx(), fp, t); S.drawTrail(fakeCtx(), fp, t, true, 0); S.drawTrail(fakeCtx(), [], t); S.trailAlive(fp, t); assert.equal(JSON.stringify(fp), pb);
    const pp = deepFreeze(path.map((p) => [...p])), ppb = JSON.stringify(pp);
    S.playTutorialSwipe(fakeCtx(), pp, 0, t, 3); S.playTutorialSwipe(fakeCtx(), [], 0, t, 3); S.playTutorialSwipe(fakeCtx(), pp, 0, t, 0); S.pathPoint(pp, t); S.pathPoint([], t); S.pathPoint(pp, NaN); assert.equal(JSON.stringify(pp), ppb);
    S.drawTutorialHand(fakeCtx(), 10, 20, t, true); S.drawTutorialHand(fakeCtx(), NaN, 20, t, false);
  }
  const view = deepFreeze({ w: 393, h: 852, body: BODY, rects: { blue: { x: -30, y: 320, w: 460, h: 545 }, red: { x: -30, y: -17, w: 460, h: 545 } }, dim: { alpha: 0.45, saturation: 0.4 } }), vb = JSON.stringify({ ...view, body: 0 });
  S.drawDuelScene(fakeCtx(393, 852), view, 1.2); S.drawDuelScene(fakeCtx(393, 852), { ...view, dim: undefined }, 1.2); S.drawDuelScene(fakeCtx(393, 852), { ...view, dim: { alpha: 2, saturation: -1 } }, 1.2);
  assert.equal(JSON.stringify({ ...view, body: 0 }), vb);
  assert.ok(Object.isFrozen(S.CUT_DIM) && S.CUT_DIM.alpha === 0.45 && S.CUT_DIM.saturation === 0.4 && S.ORGAN_R === 34);
});
