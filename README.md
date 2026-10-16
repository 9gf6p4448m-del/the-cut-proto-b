# 執刀者 THE CUT 3.0 — B 軌手機研究原型

> **研究原型，可丟棄。不是正式遊戲、不是正式規則，也不是任何審查關卡的通過證據。**
> 規則、數值、敵人權重都是研究候選值，之後可能全部改掉。畫面是灰盒，不代表正式美術品質。

## 玩法

你決定怎麼切開怪物，牠決定拿走哪一半。

1. 從軀體邊緣的一個錨點拖到另一個錨點，畫出切線。
2. 看預覽：兩側各有哪些器官、刀線會穿刺哪些器官、面積比、兩側的攻擊值。
3. 按「確認切割」。被刀線穿刺的器官觸發刀中效果；狂戰屠夫依公開規則拿走一側，你拿另一側；雙方結算器官效果。
4. 把屠夫的 HP 打到 0 就勝利；你的 HP 歸零或 12 回合未分勝負則失敗或僵持。

狂戰屠夫的公開規則：70% 看哪側攻擊器官多、30% 看實際得失；**求生優先**——若某側會讓牠死，牠就拿另一側。

## 兩種模式

| 模式 | 內容 |
|---|---|
| 三器官體驗模式（預設） | 只有狂暴心臟、骨盾腺、劇毒膽囊。研究引擎外的變體，沒有經過 golden 驗證 |
| 六器官研究模式 | 研究引擎原樣（六種器官），固定種子，可與 golden 重播向量逐位元對照 |

## 技術

- TypeScript＋HTML5 Canvas，esbuild 打包，GitHub Pages 部署，可加入 iPhone 主畫面（PWA）。
- `engine/`：THE CUT 研究規則引擎 `research/cut-lab` commit `3e2b9b4` 的 `src` 與 `content` 快照（逐檔 SHA-256 見 `SNAPSHOT_3e2b9b4.sha256`）。唯一的改動見 `ENGINE_FORK.md`。
- `shims/`：瀏覽器相容層（同步 SHA-256、內嵌內容檔），讓引擎檔不必修改。
- `src/`：遊戲畫面與觸控操作。只呼叫引擎公開 API；預覽只用分區資訊，不試算結果。

## 測試

```
npm ci
npx playwright install chromium webkit
npm run build
node tests/browser/run.mjs      # Chromium＋WebKit（iPhone 14 Pro 模擬，不是實機）
node --test "tests/node/*.test.ts"
npx tsc -p tsconfig.json
```
