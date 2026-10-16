# 引擎 fork 紀錄

來源：THE CUT `research/cut-lab` commit `3e2b9b4de0572cf86a73234172452a12c2fd77fe` 的 `src/`、`content/`（換行為 LF，與 git blob 逐位元組相同；`SNAPSHOT_3e2b9b4.sha256`）。

**唯一改動**（`engine/src/engine.ts`，預先凍結於驗收 T-1）：

```diff
 const ORGANS_PER_ROUND = 6;
+/** B 軌 fork（proto-b）：每顆器官從前 N 種抽（預設 6＝研究引擎原樣；3＝三器官體驗模式）。只能在 newBattle 前設定。 */
+export let PROTO_B_ORGAN_POOL = 6;
+export function setProtoBOrganPool(n: 3 | 6): void { PROTO_B_ORGAN_POOL = n; }
 ...
-  const types = Array.from({ length: ORGANS_PER_ROUND }, () => content.organs[st.below(6)].key);
+  const types = Array.from({ length: ORGANS_PER_ROUND }, () => content.organs[st.below(PROTO_B_ORGAN_POOL)].key);
```

- 設為 6 時與研究引擎逐位元一致（golden 200／200，Node、Chromium、WebKit）。
- 設為 3 時每顆器官只從 heart、shield、poison 抽（`organs.json` 前三項）。這是研究引擎外的變體。
- 已知限制：fork 沿用研究引擎的 `engineVersion` 與 `configHash`，器官池參數不在 `configHash` 中；所以每局紀錄另帶 `protoMode` 與 `fork: "proto-b"`，研究工具匯入守衛（`tools/import_guard.ts`）拒絕三器官紀錄。

本 repo 的任何程式不得回寫到 THE CUT 研究引擎。
