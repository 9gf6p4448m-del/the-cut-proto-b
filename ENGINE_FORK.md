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

## FUN-EXP-01 實驗掛鉤（分支 `experiment/fun-exp-01`，起點 `b18a218`）

規格：THE CUT `docs/fun-exp-01/EXPERIMENT_A_RULES.md`、`EXPERIMENT_B_RULES.md`（configHash 內 `exp.spec` 為 v1.2）。做法是「模式設定＋策略注入」，不複製第二套引擎：
規則本體全在新增檔 `src/experiment.ts`，既有檔只加下表的掛鉤。逐字登記在 `tests/node/helpers.ts` 的 `FORK_HOOKS`；
T-1 要求每條掛鉤恰好出現一次、撤銷全部掛鉤後每檔逐位元組等於 3e2b9b4 快照，且下表必須列出每個 id（未列入即紅）。

| id | 檔案 | 掛鉤 | BASELINE 時的效果 |
|---|---|---|---|
| `PB-1` | src/engine.ts | B 軌器官池宣告 `PROTO_B_ORGAN_POOL`／`setProtoBOrganPool`（上節） | 預設 6，與研究引擎相同 |
| `PB-2` | src/engine.ts | 抽器官種類改用 `PROTO_B_ORGAN_POOL`（上節） | 同上 |
| `X-T1` | src/types.ts | `ChoiceReason` 加 `'OBSESSION'` | 只是型別 |
| `X-T2` | src/types.ts | `EnemyConfig` 加 `{ kind: 'OBS_HEART' \| 'OBS_AREA'; w10 }` | 只是型別；BASELINE 設定拒絕執念敵人 |
| `X-T3` | src/types.ts | `Ev` 加 `{ t: 'WOUND'; op: 'KEEP' \| 'TEAR' \| 'HEAL'; organs; copies? }` | 只是型別；只有實驗 B 會發出 |
| `X-T4` | src/types.ts | `SideFacts` 加可選 `hearts` | 只有 OBS_HEART 會填，其他敵人的 CHOICE 事件不含此欄 |
| `X-T5` | src/types.ts | `Ev` 的 `STEP` 加 `name: 'TEAR'` | 只是型別；只有實驗 B 撕裂會發出 |
| `X-E1` | src/enemy.ts | 匯入 `obsessionSide` | — |
| `X-E2` | src/enemy.ts | `preference`：OBS_HEART／OBS_AREA 與 BUT 同一偏好（執念平手時走屠夫評分鏈） | 不經過 |
| `X-E3` | src/enemy.ts | `choose`：求生底線（SURVIVAL、兩側致死 SO-*）之後、評分鏈之前，兩側都不致死時問 `obsessionSide`；非執念敵人一律 null | `obsessionSide` 傳回 null，走原評分鏈 |
| `X-R1` | src/resolve.ts | 匯入 `obsFactsOf` | — |
| `X-R2` | src/resolve.ts | 選邊模擬的 `SideFacts` 展開 `obsFactsOf`（只有 OBS_HEART 加 `hearts`＝敵人拿走那側的心臟數，切穿的不算） | 展開空物件 |
| `X-R3` | src/resolve.ts | `RoundInput.tear?: Organ[]`（撕裂複本） | 未設定 |
| `X-R4` | src/resolve.ts | 讀取並依 id 排序 `tear` | `tear` 為空 |
| `X-R5` | src/resolve.ts | 把「刀中效果收集」迴圈包成 `incOf(list, …)`，本刀與撕裂共用同一份刀中結算（不另寫第二套） | 只對本刀切穿呼叫一次，結果相同 |
| `X-R6` | src/resolve.ts | `incOf` 結尾＋對本刀切穿呼叫一次 | 同上 |
| `X-R7` | src/resolve.ts | 本刀 INCISION 步驟（盾、傷害、死亡判定）完整結算後，若 `tear` 非空另起 `STEP TEAR`：複本的 PIERCE、無數值效果、盾、傷害、死亡判定（沿用 `runStepNoHeader`），之後才選邊（B 規格 §2.4）。本刀已有人死亡時直接結束、撕裂不發動 | `tear` 為空，不經過 |
| `X-G1` | src/engine.ts | 匯入實驗函式與型別 | — |
| `X-G2` | src/engine.ts | `BattleConfig.exp?: { mode: 'BASELINE' \| 'A' \| 'B' }` | 未設定或 BASELINE |
| `X-G3` | src/engine.ts | `BattleState.wound?: Wound \| null`（只有實驗 B 有此欄位） | 欄位不存在 |
| `X-G4` | src/engine.ts | `Action.keepWound?: boolean` | 未設定 |
| `X-G5` | src/engine.ts | `runConfigOf` 展開 `expRunConfigOf`：A／B 加 `exp: { mode, spec }`（進 configHash，三模式與規格版本不混用） | 展開空物件，configHash 不變 |
| `X-G6` | src/engine.ts | `newBattle` 初始狀態展開 `expInitState`（B：`wound: null`） | 展開空物件 |
| `X-G7` | src/engine.ts | `validateAction`：`keepWound` 非布林、或非實驗 B 卻為 true → `InvalidAction` | 未設定時不拋 |
| `X-G8` | src/engine.ts | `trustedConfig` 先 `normalizeConfig`：驗證模式與敵人搭配（實驗 B 另拒絕 PH-A：撕裂時序無法成立）；BASELINE 移除 `exp` 欄位 | 狀態內的 config 與 b18a218 逐值相同 |
| `X-G9` | src/engine.ts | `act`：合法切線後呼叫 `woundPrepare`（B：撕裂產生封存器官複本各 2 份，以 `tear` 傳給 `resolveRound` 另起 TEAR 步驟結算（X-R7）、留傷口把封存器官移出切穿清單、癒合作廢；不合法的 keepWound 拋 `InvalidAction`）；結算後寫回 `wound`，戰鬥結束（勝敗、僵持、INVALID）時為 null | `woundPrepare` 傳回 null，走原路徑 |
| `X-G10` | src/engine.ts | `restoreState` 比對設定時先正規化可信設定 | BASELINE 正規化＝移除 `exp` |

新增檔：`src/experiment.ts`（模式設定與驗證、A 執念規則、B 傷口規則、UI 用純函式 `obsessionPreview`／`woundCrossedBy`／`keepWoundCheck`／`tearPreview`、紀錄欄位 `expRoundFacts`）。

- BASELINE 不變的證明不靠本表，而是 X-1 差分測試（`tests/node/exp_baseline.test.ts`：本分支 BASELINE 對 `git show b18a218` 匯出的原引擎，事件與狀態雜湊逐回合相同）與 golden 200/200。
- `engineVersion`／`specVersion` 不變（否則 BASELINE 狀態雜湊會變）；實驗版本以 configHash 內的 `exp.spec` 區分。
- 研究工具匯入守衛（`tools/import_guard.ts`）拒絕 `expMode` 或 `config.exp.mode` 不是 BASELINE、或敵人是執念種類的紀錄。
