# CFA Equity Research Report Skill

給 Claude Code 與 Codex 用的上市公司股權研究 skill。報告有可追溯的來源，估值可以重算，含情境分析、籌碼與事件交易計畫、催化劑與風險矩陣。預設以繁體中文、固定八章的 Markdown 交付，可以再轉成投行版式的 HTML 閱讀版。報告要求把已報告實績、管理層指引、外部預估、分析師假設、本研究計算與推論分開標示。

## English summary

This repository packages two skills for Claude Code and Codex. `cfa-equity-research-report` produces evidence-driven public-equity research: source verification, financial reconstruction, industry-specific valuation, Bear/Base/Bull scenarios, reverse valuation, positioning and a 30-day event plan, and falsifiable recommendations, delivered as an eight-chapter Traditional Chinese Markdown report. `ib-equity-research` renders that Markdown into a printable investment-bank style HTML page. Both work without the author's private research project; the optional ToAlpha MCP improves Taiwan and US data coverage. The skills are independent and are not affiliated with, endorsed by, or certified by CFA Institute.

## 包含兩個 skill

| skill | 做什麼 | 什麼時候需要 |
|---|---|---|
| `cfa-equity-research-report` | 取數、建模、估值、寫八章 Markdown 報告並驗證 | 一定要裝 |
| `ib-equity-research` | 把 Markdown 報告轉成投行版式 HTML，可再印成 PDF | 要 HTML 閱讀版時才需要 |

## 快速開始

### 1. 準備環境

- Python 3.9 以上：跑驗證、技術面與交付腳本，只用標準庫。
- Node.js：只有產出 HTML 時需要，只用內建模組，不必 `npm install`。

### 2. 安裝

在本 repository 根目錄執行。兩個 skill 要裝在同一個 skills 目錄。

Claude Code：

```bash
mkdir -p ~/.claude/skills && cp -R skills/cfa-equity-research-report skills/ib-equity-research ~/.claude/skills/
```

Codex：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills" && cp -R skills/cfa-equity-research-report skills/ib-equity-research "${CODEX_HOME:-$HOME/.codex}/skills/"
```

目的地已有同名 skill 時，先備份再覆蓋。裝好後重新啟動 Claude Code 或 Codex，讓 skill 清單重新載入。

### 3. 選用：連接 ToAlpha MCP

[ToAlpha](https://toalpha.tw) 是第三方資料服務，提供整理好的台股與美股財報、法人籌碼與分析師共識。要用的話自行在 Claude Code 或 Codex 加入 MCP 伺服器：台股 `https://toalpha.tw/mcp`，美股 `https://toalpha.tw/mcp/us`。使用條款以 ToAlpha 官網為準。

不接也能跑，差別如下：

| 項目 | 接 ToAlpha | 不接 |
|---|---|---|
| 財報、月營收、申報 | 標準化數據，原始申報做關鍵核驗 | 直接抓 SEC EDGAR、公開資訊觀測站、TWSE OpenAPI，取數較慢 |
| 三大法人、內部人、13F | 有 | 台股三大法人用 TWSE；美股由 SEC 申報清單定位 |
| 分析師共識 | 有 | 標「無可比共識」，不拿搜尋摘要替代 |
| 現價與技術面 | 不用 ToAlpha，固定走 Yahoo chart API（`scripts/tech.py`） | 同左 |

備援入口的完整網址寫在 `skills/cfa-equity-research-report/references/data-sources.md` 的「未接 ToAlpha 時」。

### 4. 開始研究

直接對 Claude Code 或 Codex 說：

```text
用 cfa-equity-research-report 研究 2454.TW，交付 MD 與 HTML。
```

```text
用 cfa-equity-research-report 更新 NVDA 的研究，研究基準日為最近收盤日，只要 MD。
```

## 產出放在哪

專案根目錄沒有 `AGENTS.md`，或 `AGENTS.md` 沒規定研究產出路徑時，一份研究一個資料夾：

```text
research/<代號>/<研究基準日>/
├── <報告>.md                         八章完整研究
├── config.json                        HTML 頭部、Exhibit 標題等版面設定
├── charts.json                        資料圖的數字，規格見 ib-equity-research/charts-spec.md
├── <代號> Equity Research.dc.html     HTML 閱讀版與其 runtime
├── data/                              原始回應、技術面 JSON、證據帳本
└── model/                             估值模型
```

專案有 `AGENTS.md` 時，路徑與檔案契約照它。完整範例在 `skills/ib-equity-research/reference-2454/`：2026-10-10 的聯發科報告，含 MD、config、charts.json 與成品 HTML。

## 依作者環境設定的預設值

以下是作者自己工作流的預設值，別人照用也能跑，要改的話直接改對應檔案：

- **子代理分工**：取數交 Claude `haiku`、長文與視覺檢查交 `sonnet`，Codex 交 GPT-6 Luna，寫在 `SKILL.md`。沒有對應模型時，改成你能用的模型。
- **專案工具優先**：專案有 `tools/tech.py` 或 `tools/charts.js` 時，skill 優先用專案的版本，沒有才用 skill 隨附的版本。
- **論點檔**：`thesis.json`、`SUMMARY.md` 是作者研究專案的索引格式，沒有 `AGENTS.md` 要求時不產生。

## 功能

- 固定八章的上市公司研究報告結構。
- 同一研究基準日的市場資料、財報與估值輸入。
- 一級來源優先的證據帳本與鄰近引用要求。
- 至少一個主估值法、交叉檢查、Bear／Base／Bull 情境、敏感度與 Reverse Valuation。
- 12 個月與 36 個月目標價，內在價值與偏貴提醒價雙軌；催化劑、風險矩陣與 thesis falsifiers。
- 籌碼與未來 30 天事件交易計畫（`references/positioning-and-trade-plan.md`）。
- 九個產業模板（晶圓代工、IC 設計、記憶體、光通訊、被動元件、軟體 SaaS、網路平台、金融、加密資產），含 KPI 與估值方法選擇（`references/industry/`）。
- 子代理分工協定與派工簡報（`references/subagent-research-protocol.md`、`references/subagent-brief.md`）。
- `validate_report.py` 結構、表格、來源註記、評級與報酬一致性及不可交付引用檢查。
- `finalize_report.py` 驗證已審閱 MD 的 SHA-256 後產出 HTML，並做文字覆蓋檢查（`references/delivery.md`）。
- `tech.py` 從 Yahoo chart API 取日線，算均線、RSI、MACD、布林、ATR 與相對大盤報酬。

## 限制與使用邊界

- 本 skill 只提供研究流程與寫作規範，不會自動取得、購買或授權付費資料。
- 報告的即時性取決於執行環境可存取的官方申報、公司 IR、交易所／監管資料與可靠市場資料；若核心輸入缺失，報告必須標示「非決策就緒」並降低結論信心。
- `validate_report.py` 是結構與基本完整性檢查，不是財務模型、事實查核或投資績效保證。
- 不得把搜尋摘要、模型記憶或未驗證的數字當作一級證據，也不得把公司品質直接等同股票報酬。
- 這不是個人化投資、稅務、法律或交易建議；使用者仍須自行判斷並承擔決策責任。

## 驗證 skill 與研究報告

### 驗證研究報告

```bash
python3 ~/.claude/skills/cfa-equity-research-report/scripts/validate_report.py report.md --strict
```

Codex 把路徑換成 `~/.codex/skills/...`。`--strict` 會要求八個章節、至少 10 個 Markdown 表格、至少 7 個資料來源／計算註記及至少 8 個可點擊外部來源；通過不代表數字已經獨立查證。報告不在作者專案的資料夾結構下時，會提示跳過產物檢查，屬正常。

### 產出 HTML

```bash
python3 ~/.claude/skills/cfa-equity-research-report/scripts/finalize_report.py \
  report.md config.json "<與 MD 同一資料夾>/<代號> Equity Research.dc.html" \
  --renderer-dir ~/.claude/skills/ib-equity-research \
  --reviewed-sha256 "$(shasum -a 256 report.md | cut -d' ' -f1)"
```

Linux 沒有 `shasum` 時改用 `sha256sum report.md`。輸出必須與 MD 在同一資料夾。程序依序做 hash 核對、strict 驗證、建置與文字覆蓋檢查，成功時回傳 `"status": "published"`。文字覆蓋不等於視覺檢查，版面仍要用瀏覽器看過。

### 測試腳本

在 repository 根目錄執行：

```bash
python3 skills/cfa-equity-research-report/scripts/test_finalize_report.py
```

## 維護者：發布新版

作者本機安裝的 skill 是正本，本 repository 是發布版。`tech.py`、`charts.js` 與 charts.json 規格平時放在作者的研究專案，只在發布時複製進 skill 資料夾：

```bash
python3 scripts/sync_skills.py --cfa ~/.codex/skills/cfa-equity-research-report --ib ~/.claude/skills/ib-equity-research --research-repo <研究專案根目錄>
```

腳本會排除 `*.bak*` 備份檔，跑完檢查 `git diff` 再提交並打版本標籤。

## 資料來源需求

研究時應以同一基準日鎖定市場資料，並優先使用：

1. 監管申報、交易所／監管機關資料、公司正式 IR、法說稿與經審計財報。
2. 公司正式產品、定價、交易、永續、治理與法律公告。
3. 各同業自己的申報與一級來源。
4. 政府、央行、法院、產業監管者與國際組織。
5. 方法透明的市場資料庫、信用評等、研究機構與高品質媒體。

每個重要數字都應能追溯到來源或公式，並揭露期間、幣別、GAAP／IFRS 與 non-GAAP 定義、基本／完全稀釋股數、淨負債、SBC、ADR 比率及資料不可比限制。若沒有足夠的當期價格、財報、股數或估值輸入，不應把結果標示為可供決策。

## CFA Institute 聲明

「CFA」在本 repository 中描述的是研究深度、可稽核性與估值紀律。本專案與 CFA Institute、其附屬機構或任何認證課程**沒有隸屬、授權、認證、贊助或背書關係**。CFA Institute 名稱與相關商標歸其各自權利人所有。

## 非投資建議聲明

本專案與由它產出的內容僅供教育、研究與資訊整理用途，不構成個人化投資、財務、稅務、法律或交易建議，也不保證任何價格、目標價、評級或投資結果。投資前請查閱原始文件，評估自身目標、風險承受度與適用法規，必要時諮詢具資格的專業人士。

## Repository 結構

```text
cfa-equity-research-skill/
├── README.md
├── LICENSE
├── .gitignore
├── scripts/sync_skills.py              維護者發布工具
└── skills/
    ├── cfa-equity-research-report/
    │   ├── SKILL.md
    │   ├── agents/openai.yaml
    │   ├── references/
    │   │   ├── report-blueprint.md
    │   │   ├── research-and-valuation-standards.md
    │   │   ├── data-sources.md
    │   │   ├── positioning-and-trade-plan.md
    │   │   ├── delivery.md
    │   │   ├── subagent-research-protocol.md
    │   │   ├── subagent-brief.md
    │   │   └── industry/
    │   └── scripts/
    │       ├── validate_report.py
    │       ├── finalize_report.py
    │       ├── test_finalize_report.py
    │       └── tech.py
    └── ib-equity-research/
        ├── SKILL.md
        ├── BUILD.md
        ├── build.js
        ├── charts.js
        ├── charts-spec.md
        ├── build-helpers.js、doc-page.js、support.js   HTML runtime
        ├── config-example.json、config-RKLB.json       舊版 config 範例
        ├── reference-2454/                             完整範例報告
        └── reference-AVGO.dc.html                      舊版 HTML 範例
```

## 授權

本專案採 MIT License，詳見 [LICENSE](LICENSE)。
