// 幽光 v2 繪圖函式（src/art/sprites.ts）：各種輸入下不丟例外、不修改傳入物件；特效播完回傳 false。以假 canvas 代替瀏覽器（只驗純函式性質，不驗好不好看）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

let canvasId = 0;
function fakeCtx(w = 64, h = 64): CanvasRenderingContext2D {
  const grad = { addColorStop: () => {} }; let tr = { a: 2 };
  const t: Record<string, unknown> = {
    createLinearGradient: () => grad, createRadialGradient: () => grad, getTransform: () => tr, setTransform: (a: number) => { tr = { a: typeof a === 'number' ? a : 1 }; },
    getImageData: (_x: number, _y: number, W: number, H: number) => ({ width: W || w, height: H || h, data: new Uint8ClampedArray((W || w) * (H || h) * 4).fill(128) }),
    createImageData: (W: number, H: number) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }), measureText: () => ({ width: 10 }),
  };
  return new Proxy(t, { get(o, k: string) { if (k in o) return o[k]; return (...args: unknown[]) => { for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${k} 收到非有限數值`); }; }, set(o, k: string, v) { o[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
}
function fakeCanvas(w = 64, h = 64) { const c = { width: w, height: h, __id: ++canvasId, getContext: () => fakeCtx(c.width, c.height) }; return c; }
(globalThis as unknown as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
(globalThis as unknown as Record<string, unknown>).HTMLImageElement = class {};
const S = await import('../../src/art/sprites.ts');
import type { Fx2, Kind, OrganState, Side } from '../../src/art/sprites.ts';

function deepFreeze<T>(o: T): T { if (o && typeof o === 'object' && !ArrayBuffer.isView(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; }
const KINDS: Kind[] = ['claw', 'heart', 'eye', 'poison', 'bone'];
const BODY = fakeCanvas(120, 180) as unknown as HTMLCanvasElement;
const BLUE: [number, number][] = [[10, 200], [380, 200], [380, 600], [10, 600]], RED: [[number, number], [number, number], [number, number], [number, number]] = [[10, 0], [380, 0], [380, 300], [10, 300]];

test('本體、前線帶、器官（5 種 × 狀態 × 兩方）、刀線、HUD、縫合元件：不丟例外、不改輸入', () => {
  const rect = deepFreeze({ x: 0, y: 300, w: 393, h: 500 }), polys = deepFreeze({ BLUE, RED }), b0 = JSON.stringify([rect, polys]);
  for (const t of [0, 0.5, 3.3, 99]) {
    const c = fakeCtx();
    S.drawBodySprite(c, BODY, rect, 'blue', t); S.drawBodySprite(c, BODY, rect, 'red', t, 0.5);
    S.drawFrontBand(c, polys.BLUE, polys.RED, t); S.drawFrontBand(c, [], polys.RED, t);
    S.drawBlade(c, [300, 700], [80, 200], deepFreeze([[200, 400]]) as [number, number][], t, true); S.drawBlade(c, [300, 700], [300, 700], [], t, false);
    S.drawHud(c, deepFreeze({ w: 393, timer: '0:18', banner: '×2 加時', hp: { blue: 74, red: 0, max: 100 } }));
    S.drawSlot(c, 100, 100, 14, 'ok', t); S.drawSlot(c, 100, 100, 14, 'bad', t); S.drawSlot(c, 100, 100, 14, 'hover', t);
    S.drawSuture(c, [10, 10], [200, 300], t);
    for (const k of KINDS) S.drawCard(c, deepFreeze({ x: 10, y: 600, w: 110, h: 170 }), BODY, k, '爪', k === 'poison', t);
  }
  assert.equal(JSON.stringify([rect, polys]), b0);
  const states: OrganState[] = [{ mode: 'normal' }, { mode: 'normal', lit: 1, target: true }, { mode: 'locked', k: 0.5, label: '3.0' }, { mode: 'locked', k: 0 }, { mode: 'sprout', k: 0 }, { mode: 'sprout' }, { mode: 'burst', k: 0 }, { mode: 'burst', k: 1, cutAngle: 1.2 }, { mode: 'normal', lit: 9, k: -2 }];
  for (const k of KINDS) for (const side of ['blue', 'red'] as Side[]) for (const st of states) {
    const o = deepFreeze({ kind: k, side, x: 50, y: 60, r: 16 }), s = deepFreeze({ ...st }), b = JSON.stringify([o, s]);
    S.drawOrganSprite(fakeCtx(), BODY, o, s, 1.7); assert.equal(JSON.stringify([o, s]), b, `${k}/${side}/${st.mode}`);
  }
});

test('戰鬥特效 v2：7 種在開始前／進行中／結束後都不丟例外、不改輸入；結束後回傳 false；震動只在受擊與暴擊', () => {
  const rect = { x: 0, y: 0, w: 393, h: 500 };
  const fxs: Fx2[] = [
    { type: 'arcSlash', t0: 1, from: [50, 600], to: [200, 200], side: 'blue', dmg: 4 }, { type: 'arcSlash', t0: 1, from: [50, 50], to: [50, 50], side: 'red' },
    { type: 'critArc', t0: 1, from: [50, 600], to: [200, 200], dmg: 26 }, { type: 'heal', t0: 1, at: [100, 100], amount: 3 }, { type: 'poison', t0: 1, at: [100, 100], stacks: 3 },
    { type: 'boneShield', t0: 1, at: [100, 300], facing: -0.9, absorbed: 18, value: 15 }, { type: 'boneShield', t0: 1, at: [100, 300], facing: 2 },
    { type: 'hitFlash', t0: 1, body: BODY, rect, side: 'red' }, { type: 'ko', t0: 1, w: 393, h: 852, winner: 'blue' },
  ];
  const seen = new Set<string>();
  for (const f of fxs) {
    const fz = (f.type === 'hitFlash' ? Object.freeze({ ...f, rect: Object.freeze({ ...rect }) }) : deepFreeze(JSON.parse(JSON.stringify(f)))) as Fx2, D = S.fx2Duration(fz), b0 = JSON.stringify({ ...fz, body: undefined });
    seen.add(fz.type);
    assert.equal(S.playFx2(fakeCtx(), fz, 0.2), true);
    for (const u of [0, 0.02, D * 0.3, D * 0.6, D * 0.999]) assert.equal(S.playFx2(fakeCtx(), fz, 1 + u), true, `${fz.type}@${u}`);
    assert.equal(S.playFx2(fakeCtx(), fz, 1 + D + 0.01), false);
    const sh = S.shake2(fz, 1.05); if (fz.type === 'hitFlash' || fz.type === 'critArc') assert.ok(Math.hypot(sh[0], sh[1]) > 0); else assert.deepEqual(sh, [0, 0]);
    assert.equal(JSON.stringify({ ...fz, body: undefined }), b0);
  }
  assert.equal(seen.size, 7);
});
