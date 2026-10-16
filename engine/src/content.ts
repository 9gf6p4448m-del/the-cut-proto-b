// 研究內容載入：器官定義與三角函數表都是資料檔，載入時核對 SHA-256（R3 §16.3、PvP AP-3）。
import { readFileSync } from 'node:fs';
import { canonical, deepFreeze, isDeepFrozen, sha256 } from './canon.ts';

export const TRIG_SHA256 = '332dc41022ff0089ea1e3c9c4a2b979028646ebdcdfa7a59571b6425baa9512f';

export type OrganKey = 'heart' | 'shield' | 'poison' | 'fission' | 'regen' | 'mirror' | 'core' | 'seedling' | 'test';

export interface HarvestDef {
  damage?: number;
  kind?: 'HARV_DIRECT' | 'CORE';
  shield?: number;
  selfDamage?: number;
  heal?: number;
  reflectPct?: number;
  /** 測試專用：一次收割產生 n 筆 0 點傷害（EC-17） */
  testHits?: number;
}

export interface IncisionDef {
  damage?: number;
  kind?: 'INC_DIRECT';
  shield?: number;
  bothDamage?: number;
  spawnCores?: number;
  scheduleSeedling?: number;
  destroy?: number;
}

export interface OrganDef {
  id?: number;
  key: OrganKey;
  harvest: HarvestDef;
  incision?: IncisionDef;
  attack: number;
  inert?: boolean;
}

export interface Content {
  organs: OrganDef[]; // 依種類 ID 0–5
  byKey: Record<string, OrganDef>;
  cos: number[];
  sin: number[];
  hashes: { organs: string; trig: string };
  testOnly: boolean;
}

function readJson(rel: string): { text: string; data: any } {
  const text = readFileSync(new URL(`../content/${rel}`, import.meta.url), 'utf8');
  return { text, data: JSON.parse(text) };
}

let cached: Content | null = null;

/** 由 loadContent／withTestOrgan 建立、已深層凍結的內容物件。 */
const TRUSTED = new WeakSet<Content>();
const digestMemo = new WeakMap<Content, string>();

/**
 * 內容摘要：一律由實際資料（器官定義與三角函數表）計算，不採信物件自報的 hashes 欄位（Codex G1-R2 #1）。
 * 只有受信任（凍結）的內容物件才快取，其他物件每次重算。
 */
export function contentDigest(c: Content): string {
  const memo = TRUSTED.has(c) ? digestMemo.get(c) : undefined;
  if (memo) return memo;
  const keys = Object.keys(c.byKey).sort();
  const d = sha256(canonical({ byKey: keys.map((k) => c.byKey[k]), organs: c.organs, cos: c.cos, sin: c.sin, testOnly: c.testOnly }));
  if (TRUSTED.has(c)) digestMemo.set(c, d);
  return d;
}

export function isTrustedContent(c: Content): boolean {
  return TRUSTED.has(c);
}

function trust(c: Content): Content {
  deepFreeze(c);
  if (!isDeepFrozen(c)) throw new Error('內容沒有完全凍結，拒絕登記為受信任');
  TRUSTED.add(c);
  return c;
}

export function loadContent(): Content {
  if (cached) return cached;
  const o = readJson('organs.json');
  const t = readJson('trig.json');
  const trigHash = sha256(canonical(t.data));
  if (trigHash !== TRIG_SHA256) throw new Error(`trig.json 雜湊不符：${trigHash}`);
  const organs: OrganDef[] = o.data.organs;
  const byKey: Record<string, OrganDef> = {};
  for (const d of [...organs, ...o.data.derived]) byKey[d.key] = d;
  organs.forEach((d, i) => {
    if (d.id !== i) throw new Error(`organs.json 種類 ID 順序錯誤：${d.key}`);
  });
  cached = trust({
    organs,
    byKey,
    cos: t.data.cos,
    sin: t.data.sin,
    hashes: { organs: sha256(canonical(o.data)), trig: trigHash },
    testOnly: false,
  });
  return cached;
}

/** 測試專用內容：在研究內容上加入測試器官（EC-17）。不得用於研究模擬。 */
export function withTestOrgan(base: Content, def: OrganDef): Content {
  // 先完整複製 base（不沿用任何可能仍可變的參照），再加入測試器官，最後整份深層凍結並登記（Codex G1-R3 #1）
  const fresh = structuredClone({ organs: base.organs, byKey: base.byKey, cos: base.cos, sin: base.sin, hashes: base.hashes });
  fresh.byKey[def.key] = structuredClone(def);
  return trust({ ...fresh, testOnly: true, hashes: { ...fresh.hashes, organs: sha256(canonical({ base: fresh.hashes.organs, test: def })) } });
}
