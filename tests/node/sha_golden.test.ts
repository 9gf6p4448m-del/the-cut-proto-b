// 凍結驗收 T-2（Node 端）、T-3（鑑別力）：同步 SHA-256 相容層與 golden。作者測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { ROOT } from './helpers.ts';
import { sha256Bytes, toHex } from '../../shims/sha256.ts';
import { loadContent } from '../../engine/src/content.ts';
import { replay } from '../../engine/src/replay.ts';

const GOLDEN = readFileSync(join(ROOT, 'golden/golden_vectors.json'), 'utf8');
const GOLDEN_SHA = '112d879b4a6bbaabf48bfee7fd8425f9301445ff4e00832533200362e727be74';
const h = (s: string) => toHex(sha256Bytes(new TextEncoder().encode(s)));

test('SHA-256 NIST 向量', () => {
  assert.equal(h(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(h('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(h('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256 與 Node crypto 逐位元相同（含中文、跨區塊長度）', () => {
  for (let n = 0; n < 300; n++) {
    const s = '執刀者'.repeat(n % 7) + 'x'.repeat(n);
    assert.equal(h(s), createHash('sha256').update(s, 'utf8').digest('hex'), `len ${n}`);
  }
});

test('T-2 Node 原生引擎 golden 200/200、檔案 SHA 相符', () => {
  assert.equal(createHash('sha256').update(GOLDEN, 'utf8').digest('hex'), GOLDEN_SHA);
  const content = loadContent();
  const v = JSON.parse(GOLDEN);
  assert.equal(v.length, 200);
  assert.equal(v.filter((x: any) => replay(x, content).ok).length, 200);
});

let n = 0;
async function goldenWithShim(shimDir: string): Promise<{ ok: number; fileSha256: string }> {
  mkdirSync(join(ROOT, '.tmp'), { recursive: true });
  const out = join(ROOT, '.tmp', `golden_${process.pid}_${n++}.mjs`);
  await esbuild.build({
    entryPoints: [join(ROOT, 'tests/browser/golden_entry.ts')], outfile: out, bundle: true, format: 'esm', platform: 'neutral', loader: { '.json': 'text' },
    alias: { 'node:crypto': join(shimDir, 'crypto.ts'), 'node:fs': join(ROOT, 'shims/fs.ts') },
    define: { 'import.meta.url': '"https://proto-b.invalid/engine/src/content.ts"' }, logLevel: 'silent',
  });
  await import(pathToFileURL(out).href);
  return (globalThis as any).__runGolden(GOLDEN);
}

test('T-2 相容層打包版 golden 200/200、檔案 SHA 相符', async () => {
  const r = await goldenWithShim(join(ROOT, 'shims'));
  assert.equal(r.ok, 200);
  assert.equal(r.fileSha256, GOLDEN_SHA);
});

test('T-3 鑑別力：SHA-256 輪常數改 1 位元 → golden 必須紅', async () => {
  const d = join(ROOT, '.tmp', 'shim-mut');
  mkdirSync(d, { recursive: true });
  const src = readFileSync(join(ROOT, 'shims/sha256.ts'), 'utf8');
  assert.ok(src.includes('0x428a2f98'));
  writeFileSync(join(d, 'sha256.ts'), src.replace('0x428a2f98', '0x428a2f99'));
  writeFileSync(join(d, 'crypto.ts'), readFileSync(join(ROOT, 'shims/crypto.ts'), 'utf8'));
  // 紅的兩種形式都算：引擎在載入內容時就因 trig／organs 雜湊不符而拒絕（拋錯），或重播不一致
  let r: { ok: number; fileSha256: string } | null = null, err: unknown = null;
  try { r = await goldenWithShim(d); } catch (e) { err = e; }
  if (err) { assert.match(String(err), /雜湊不符/); return; }
  assert.notEqual(r!.fileSha256, GOLDEN_SHA, '突變後檔案 SHA 仍相同');
  assert.ok(r!.ok < 200, `突變後重播仍全綠：${r!.ok}`);
});
