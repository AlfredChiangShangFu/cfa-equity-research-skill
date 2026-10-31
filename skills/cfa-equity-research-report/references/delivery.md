# MD 完成後接續 HTML

## 分工與品質

MD 是獨立可交付、內容完整的研究正文。HTML 保留 MD 未標記隱藏的全文、表格、數字、連結、警語與限制；要在 HTML 隱藏只用 MD 的 `html:skip` 與 charts.json 的 `隱藏`，不得因排版改寫或刪減研究。

主筆在寫 MD 的同一階段，從同一模型輸出準備 config：頭部數值、`tagline`／`taglineSub`／`infoRow`、Exhibit 標題、`sideExhibits`、`chartBesideTable`、`chartNotes`（欄位見 `ib-equity-research` 的 BUILD.md）；版式細節直到排版階段才讀該 skill 的 SKILL.md，不必重新研究一次。

檔案目錄、SUMMARY.md／valuation_summary.json 等契約以專案 AGENTS.md 的適用系統規則為準；不可把 Claude 專屬規則強加到 Codex。寫入限自己的系統目錄。

專案沒有 AGENTS.md，或 AGENTS.md 沒規定研究產出路徑時，一份研究一個資料夾 `research/<代號>/<研究基準日>/`：報告 MD、`config.json`、`charts.json` 與 HTML 同層，原始回應放 `data/`，估值模型放 `model/`。不產生 thesis.json、SUMMARY.md 與 valuation_summary.json；validator 提示跳過產物檢查屬正常。

## 交付程序

1. 主代理完成財經推理審閱，核對數據來源、模型、情境、評級及最強反證；允許讀回與修改。對 MD 的審閱是實質工作，不是產生 hash 就代表已完成。
2. 從相同模型與 MD 核對 config 的公司、日期、幣別、評級、現價、12／36 個月目標價及 Exhibit 標題。`config.exhibits` 的鍵只數 HTML 可見的 MD 表格、流程圖與時程軸，缺號時 renderer 會回報錯誤。`skip` 必須省略或空陣列，不用頭部重複為由刪去正文。先讀 renderer 的 BUILD.md，確認支援該 MD 語法。
3. MD 審閱完成後取得 SHA-256（`shasum -a 256 <MD>`），將當時的 hash 傳入下列程序。不得在 hook 裡自動取得最新 hash 以繞過審閱；MD 改動即重新審閱。

```sh
python3 <本skill絕對路徑>/scripts/finalize_report.py \
  <報告.md> <config.json> '<同層>/<代號> Equity Research.dc.html' \
  --renderer-dir <ib-equity-research絕對路徑> \
  --reviewed-sha256 <已審閱MD的SHA256>
```

程序依序執行 hash 核對、既有 `validate_report.py --strict`（同層有 thesis.json 時不再要求 SUMMARY.md 與 valuation_summary.json）、暫存 HTML 建置、文字與連結覆蓋檢查（剝掉 `html:skip` 區塊與標記行、忽略儲存格內 `<br>`、時程軸逐格比對、mermaid 區塊不比對只計數），再發布 HTML 及 runtime。失敗不以新 HTML 覆蓋舊產物；同一輸出資料夾不可同時發布。回傳 JSON，無 LLM 呼叫。若只需 MD，執行 validator 與主代理審閱，不呼叫排版。

renderer 由呼叫者傳 `ib-equity-research` 的安裝路徑（Claude Code 預設 `~/.claude/skills/ib-equity-research`，Codex 預設 `~/.codex/skills/ib-equity-research`，該處沒有 build.js 時改用 Claude Code 的路徑；Codex 呼叫 Claude 的安裝版不表示寫入 Claude 報告資料夾）；不得假設其他同名安裝版本內容相同。

4. 用實際瀏覽器檢查 HTML 的頭部、側欄並排、附錄、最後一章、來源與警語是否可見；未做就明寫尚未完成視覺 QA。程式文字覆蓋不是視覺 QA，也不驗證財經邏輯；JSON 的 `published` 只表示建置發布完成。
5. 交付 MD、HTML 及必要模型／證據；排版失敗只報告排版缺口，保留合格 MD，修 renderer／config 後重試，不刪研究內容求通過。

## 圖文排版（使用者2026-10-26指定）

- 摘要快照的項目欄用短標籤；金額欄將幣別、金額單位、每股或倍數寫在數值旁，例如 `US$68.50bn`、`US$20.31／股`、`28.50倍`。不要把單位塞入項目名稱而留下無單位數字。
- 摘要表若在側欄反覆換行、比鄰文高出一大截，就展開成全寬；多個短指標可用「項目／金額數值」雙組四欄縮短列數。可設定 `splitFirstChapter:false`，不為保留預設2:1而硬擠。
- 半欄圖應錨定在解讀該圖的完整段落，以文字左、圖右、頂部對齊。只錨定小標，或無錨點直接丟到章末，常會生成單獨半寬圖與空白半頁，須實際檢查。
- 一章內穿插圖與對應文字。側表或半欄圖的鄰文不足、兩側高度差太大時，重選段落或改全寬；不用空白段落、固定高度、硬換頁或縮小字級湊對齊。來源註跟著對應圖表。
- 視覺QA同時看欄寬、項目折行、金額單位、圖文對應、頂部對齊與大塊空洞；「可見／不溢出」不足以代表排版合格。手機退回單欄，寬表僅在表內橫向捲動。
- 把本次選定的具體版面寫入報告MD的隱藏排版註記，並由config／charts的錨點與版面實際實現，不能只記規則而不修交付檔。

- 同主題且可在半欄清楚閱讀的圖可左右並列；圖軸標籤須縮短但保留期間含義。章首先給導讀文字，再安排圖或圖文並排，不把圖插在導讀之前。交付版面修訂時以明確版別識別，且核實本次修改的檔案，不把舊分頁截圖當成新版驗收。

## 已知邊界

- 既有 renderer 以 masthead 取代 H1，H1 不納入文字覆蓋，主代理核對公司識別與標題。
- 覆蓋檢查拒絕圖片與 reference link；mermaid 流程圖只計數（JSON `mermaid_blocks`），節點與連線的圖義靠第 4 步視覺 QA 逐項對照。
- 覆蓋檢查只是文字、儲存格與連結的存在檢查，不保證順序、隱藏 CSS 或圖義正確；視覺 QA 由代理逐項回報，研究審閱由主代理完成。
- 多檔發布不是跨檔案原子交易；避免同目錄並行發布。

## Hook 邊界

`Stop` 只是一回合結束，Write／Edit 也不代表 MD 完稿，都不等於研究通過審閱。本版由 skill 的交付步驟明確呼叫上述程序，不安裝全域 hook，勿聲稱已自動監聽。日後若接原生 hook，由主代理審閱完成後提供工作項（路徑、已審 hash、config、renderer），需去重、禁止同時發布、失敗回報且避免無限重試。
