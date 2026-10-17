// 幽光 v2 素材管線的單元測試：身體多邊形（決定性、≤64 頂點、面積精度）、染色不改原圖、邊界資料格式驗證、v2 繪圖函式不丟例外不改輸入。
// 面積驗收口徑（主 session 2026-10-18 明確同意的修正 A）：①多邊形 vs「外框內補滿洞後的 alpha>0.5 面積」≤5%（簡化精度）；②實心測試圖 ≤5%（工具精度）；
// 暫代本體對「含鏤空 alpha 面積」的原始差異只列出、不當門檻。理由見 the-cut docs/art-direction/ghostlight/cut-battle/art-kit-v2/README.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { bodyPolygon, isSimple, downsampleMask, maskArea, outerRingArea, placePolygon, polygonArea, simplify, contours, tintPixels } from '../../src/art/polygon.ts';
import { boundaryToWorld, validateBoundary } from '../../src/art/boundary.ts';
import type { BoundaryConfirmed } from '../../src/art/boundary.ts';

const raw = gunzipSync(readFileSync(new URL('../fixtures/body_placeholder_alpha.bin.gz', import.meta.url)));
const BODY = { width: raw.readUInt32LE(0), height: raw.readUInt32LE(4), alpha: new Uint8ClampedArray(raw.subarray(8)) };
function solid(W: number, H: number, f: (x: number, y: number) => boolean) { const a = new Uint8ClampedArray(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x + 0.5, y + 0.5) ? 255 : 0; return { width: W, height: H, alpha: a }; }
const ELLIPSE = solid(400, 600, (x, y) => ((x - 200) / 180) ** 2 + ((y - 300) / 280) ** 2 <= 1);
const BLOBS = solid(500, 700, (x, y) => [[250, 120, 70], [200, 260, 90], [300, 380, 100], [200, 520, 80], [120, 620, 50], [380, 300, 60], [90, 300, 55]].some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r));
const pct = (a: number, b: number) => Math.abs(a / b - 1) * 100;

test('多邊形：同一張圖兩次輸出逐值相同；頂點 ≤64（也遵守較小的 maxVerts）；不自交；輸入遮罩不被修改', () => {
  const before = Buffer.from(BODY.alpha).toString('base64').length, sum = BODY.alpha.reduce((s, v) => s + v, 0);
  for (const ds of [2, 4]) {
    const a = bodyPolygon(BODY, { downsample: ds }), b = bodyPolygon(BODY, { downsample: ds });
    assert.deepEqual(a, b); assert.ok(a.length >= 3 && a.length <= 64, `ds=${ds} 頂點 ${a.length}`); assert.ok(isSimple(a), `ds=${ds} 自交`);
  }
  assert.ok(bodyPolygon(BODY, { downsample: 4, maxVerts: 16 }).length <= 16);
  assert.equal(BODY.alpha.reduce((s, v) => s + v, 0), sum); assert.equal(Buffer.from(BODY.alpha).toString('base64').length, before);
});

test('面積精度（口徑 A）：暫代本體 多邊形 vs 補洞後外框 ≤5%；實心測試圖 vs alpha 面積 ≤5%；反例：刻意簡化過頭會超過 5%', () => {
  const rows: string[] = [];
  for (const ds of [2, 4]) {
    const poly = bodyPolygon(BODY, { downsample: ds }), filled = outerRingArea(downsampleMask(BODY, ds)) * ds * ds, d = pct(polygonArea(poly), filled);
    rows.push(`暫代本體 ds=${ds}：頂點 ${poly.length}、vs 補洞後 ${d.toFixed(2)}%、vs 含鏤空 alpha ${pct(polygonArea(poly), maskArea(BODY)).toFixed(1)}%（只列出）`);
    assert.ok(d <= 5, rows.at(-1));
  }
  for (const [name, m] of [['橢圓', ELLIPSE], ['多圓聯集', BLOBS]] as const) {
    const poly = bodyPolygon(m), d = pct(polygonArea(poly), maskArea(m));
    rows.push(`${name}：頂點 ${poly.length}、vs alpha ${d.toFixed(2)}%`); assert.ok(d <= 5 && poly.length <= 64, rows.at(-1));
  }
  // 鑑別力：只保留 6 個頂點（簡化過頭）→ 兩種口徑都應超過 5%
  const ring = contours(BLOBS).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  assert.ok(pct(polygonArea(simplify(ring, 6)), maskArea(BLOBS)) > 5, '簡化過頭應被抓到');
  const bigRing = contours(downsampleMask(BODY, 4)).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  assert.ok(pct(polygonArea(simplify(bigRing, 6)), outerRingArea(downsampleMask(BODY, 4))) > 5, '補洞口徑也應抓到');
  console.log(rows.join('\n'));
});

test('placePolygon／boundaryToWorld：紅方＝以 rect 中心旋轉 180°；兩套換算一致', () => {
  const poly = bodyPolygon(ELLIPSE), rect = { x: 0, y: 400, w: 700, h: 600 };
  const blue = placePolygon(poly, 400, 600, rect), red = placePolygon(poly, 400, 600, rect, true);
  blue.forEach((p, i) => { assert.ok(Math.abs(p[0] + red[i][0] - 700) < 1e-9 && Math.abs(p[1] + red[i][1] - 1400) < 1e-9); });
  const norm = poly.map(([x, y]) => [x / 400, y / 600] as [number, number]);
  boundaryToWorld(norm, 400, 600, rect, true).forEach((p, i) => assert.ok(Math.hypot(p[0] - red[i][0], p[1] - red[i][1]) < 1e-9));
});

test('染色：不修改原圖；alpha 原樣保留；中性灰染成指定色相；極亮高光保持接近白', () => {
  const src = new Uint8ClampedArray([128, 128, 128, 200, 250, 250, 250, 255, 30, 30, 30, 40]); const copy = Uint8ClampedArray.from(src);
  const out = tintPixels(src, '#278DD1', 1); // typed array 不能 freeze：以副本比對確認未被修改
  assert.deepEqual(src, copy, '原圖不變');
  assert.notEqual(out, src); assert.equal(out[3], 200); assert.equal(out[7], 255); assert.equal(out[11], 40);
  assert.ok(out[2] > out[0] && out[1] > out[0], '中灰 → 藍色相');
  assert.ok(out[4] > 220 && out[5] > 220 && out[6] > 220, '高光保持接近白（骨頭不被染成純藍）');
  const red = tintPixels(src, '#C73548', 1); assert.ok(red[0] > red[2], '染紅');
  assert.ok(tintPixels(src, '#278DD1', 0.5)[2] < out[2], 'brightness 會調暗');
});

test('已確認邊界格式：合法通過；自交、>64 頂點、超出 0～1、缺欄位都被擋；驗證不修改輸入', () => {
  const ok: BoundaryConfirmed = { version: 1, kind: 'confirmed', beast: 'ghost-dragon', vertices: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], confirmedBy: '製作人', confirmedAt: '2026-10-18' };
  const frozen = JSON.parse(JSON.stringify(ok)); Object.freeze(frozen); frozen.vertices.forEach((v: unknown[]) => Object.freeze(v));
  assert.deepEqual(validateBoundary(frozen), []);
  assert.ok(validateBoundary({ ...ok, vertices: [[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]] }).some((e) => e.includes('自交')));
  assert.ok(validateBoundary({ ...ok, vertices: Array.from({ length: 65 }, (_, i) => [0.5 + 0.4 * Math.cos(i / 10.3), 0.5 + 0.4 * Math.sin(i / 10.3)] as [number, number]) }).some((e) => e.includes('> 64')));
  assert.ok(validateBoundary({ ...ok, vertices: [[0, 0], [1.2, 0], [1, 1]] }).some((e) => e.includes('0～1')));
  assert.ok(validateBoundary({ ...ok, beast: '' }).some((e) => e.includes('beast')));
  // 暫代本體的候選轉成已確認格式後也合法
  const cand = JSON.parse(readFileSync(new URL('../../public-artkit/assets/placeholder/beast_boundary.candidate.json', import.meta.url), 'utf8'));
  assert.equal(cand.kind, 'candidate'); assert.ok(cand.vertices.length <= 64);
  assert.deepEqual(validateBoundary({ ...ok, vertices: cand.vertices }), []);
});
