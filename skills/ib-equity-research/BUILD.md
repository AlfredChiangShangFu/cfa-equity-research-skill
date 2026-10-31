# 在 Claude Code 產出報告（Design 環境外的路徑）

skill 安裝在全域 skills 目錄（Claude Code 預設 `~/.claude/skills/ib-equity-research/`，Codex 預設 `~/.codex/skills/ib-equity-research/`），所有專案可用。Claude Code 沒有 Claude Design 的工具，改走 `build.js`；視覺規格（SKILL.md 第 3–5 節）完全不變。

## 檔案

| 檔案 | 說明 |
|---|---|
| `build.js` | MD + config.json + charts.json → `.dc.html` |
| `support.js`、`doc-page.js`、`build-helpers.js` | runtime，`build.js` 自動從 skill 資料夾複製到輸出資料夾（已存在且大小相同則跳過） |
| `reference-2454/config.json`、`charts.json` | 完整範例；`config-example.json`（AVGO）、`config-RKLB.json` 為舊範例 |

## 用法

**輸出一律放在來源 MD 的同一個資料夾**，整包可搬移。

```
node <skill 安裝目錄>/build.js <報告.md> <config.json> "<MD 所在資料夾>/<代號> Equity Research.dc.html"
```

MD 在 `report/` 時自動讀 AI 資料夾根層的 `charts.json`（或 `--charts <檔>`），繪圖程式優先用研究 repo 的 `tools/charts.js`，找不到時用 skill 同層的 `charts.js`，兩者都沒有就中止。charts.json 欄位規格在研究 repo 的 `docs/研究輸出格式.md` 第七節，公開版附在 `charts-spec.md`。

### 檢視

用 Chrome 或 Safari 直接開檔案：`open "<MD 所在資料夾>/<代號> Equity Research.dc.html"`。**不要用 Claude app 的內建瀏覽器**：它會把本機檔案轉成 `data:` URL 靜態快照，`./support.js` 與 `./doc-page.js` 的相對路徑失效，畫面全白。

### 匯出 PDF（選配）

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=20000 \
  --print-to-pdf=<輸出.pdf> "file://<絕對路徑>/<輸出.dc.html>"
```

`--virtual-time-budget` 要夠長，否則 Google Fonts 未載入完成就出圖。

## config 欄位

- `masthead`：`name` `ticker` `sector` `kind` `date` `exchange` `assetClass` `currency` `market`
- `rating`：`call` `qualifier`、`cells`（固定三格，各含 `label` `value` `sub`，可選 `color`；`reference-AVGO` 的四格過時）、`infoRow`（字串陣列，靠左依序排，4 項白話）
- `tagline` / `taglineSub`：標語區兩層，寫法見 SKILL.md 4.3
- `exhibits`：`{"1":"投資快照", …}`，**必填**。鍵只數 HTML 可見的 MD 表格、flowchart 與 timeline（`html:skip` 內的不算，`html:appendix` 內的算）；資料圖佔 Exhibit 編號但不佔鍵。未指定時自動用表頭拼接，品質不可用；缺號或多號非零退出。
- `sideExhibits`：編號陣列，與 `exhibits` 同一套鍵（流程圖、時程軸、附錄表都佔號），列入的表縮成側欄小表與相鄰正文 2:1 並排
- `chartBesideTable`：圖 id 陣列，錨點在表格來源註的圖改與該表並排（表左、半欄圖右）
- `chartNotes`：`{"<圖 id>": ["**名稱**：內容", …]}`，有註記的圖改成「圖｜註記」一列
- `skip` 必須省略或空陣列；`callout` / `quote` 以 `"章.塊"` 索引指定（章從 1 起、塊從 0 起）
- `splitFirstChapter`：預設 true，第 1 章正文與 Exhibit 1 並排；第 1 章第一張表之前有圖時不並排
- `footerNote`：頁腳文字

## 自動化邊界

`build.js` 處理章節、`###` 小標、段落、表格、清單、來源註、粗體、連結、行內程式碼、mermaid `flowchart`／`graph`（SVG 分層圖）、```timeline（橫向時程軸，實心點＝公司證實、空心點＝報導）、`html:skip`／`html:appendix`／`html:cols` 標記、charts.json 資料圖、交叉引用頁內連結；MD 標記規格見研究 repo `docs/研究輸出格式.md` 第八節，charts.json 見第七節。其他 code fence 落回 `H.formula()` 等寬區塊。仍須人工：Exhibit 標題、頭部數值、側欄與並排的選擇、callout 與 pull quote 位置。

### 三種標題層級

| 層級 | 來源 | 樣式 |
|---|---|---|
| 章標題 | `## ` | Crimson Pro 23px＋章號＋深藍下規線（`H.h2`） |
| 小標 | `### ` | Crimson Pro 17px＋深藍左側短規線（`subhead()`） |
| Exhibit 標籤 | 表格／圖表前自動加 | Noto Sans TC 11.5px 大寫藍（`H.label`） |

三者樣式互不相同，否則小標與 Exhibit 標籤無法區分。

## 忠實度驗證

每次產出後用 `cfa-equity-research-report` 的覆蓋檢查對照原始 MD（先剝掉 `html:skip` 區塊與標記行，再逐行、逐儲存格、逐連結比對）；完整交付走該 skill 的 `finalize_report.py`，只跑 build.js 時：

```
python3 -c "import sys,importlib.util as u;s=u.spec_from_file_location('f',sys.argv[3]);m=u.module_from_spec(s);s.loader.exec_module(m);print(m.check_coverage(open(sys.argv[1]).read(),open(sys.argv[2]).read()))" <report.md> <輸出.dc.html> <cfa-equity-research-report 安裝目錄>/scripts/finalize_report.py
```

遺失任何一行都是 bug；mermaid 區塊只計數不比對（結果 `mermaid_blocks`），流程圖的節點與連線用瀏覽器逐項對照。
