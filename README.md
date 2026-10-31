# CFA Equity Research Report Skill

一個可安裝到 Codex 的公開 skill，用於產出具來源、可重算估值、情境分析、催化劑與風險矩陣的上市公司股權研究報告。預設以繁體中文、固定八章 Markdown 格式交付，可再轉成投行版式 HTML 閱讀版，並要求把已報告實績、管理層指引、外部預估、分析師假設、本研究計算與推論清楚分開。

## English summary

This repository packages a Codex skill for evidence-driven public-equity research. It guides the model through source verification, financial reconstruction, industry-appropriate valuation, Bear/Base/Bull scenarios, reverse valuation, catalysts, risks, and falsifiable recommendations. Reports are written in Traditional Chinese by default and are delivered as auditable Markdown. The skill is independent and is not affiliated with, endorsed by, or certified by CFA Institute.

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

## 外部依賴

- 預設資料入口為 ToAlpha MCP（台股 `https://toalpha.tw/mcp`、美股 `https://toalpha.tw/mcp/us`），原始申報用於關鍵核驗；細節見 `references/data-sources.md`。
- `finalize_report.py` 的 `--renderer-dir` 指向另一個 HTML 排版 skill（`ib-equity-research`），不在本 repository 內。只要 Markdown 報告時不需要它。
- `references/data-sources.md` 提到的 `tools/tech.py`（Yahoo chart API 現價與技術面）屬於研究專案，不隨本 skill 發布。
- 輸出路徑與論點檔契約以研究專案的 `AGENTS.md` 為準；在其他專案使用時，需自行定義輸出位置。

## 限制與使用邊界

- 本 skill 只提供研究流程與寫作規範，不會自動取得、購買或授權付費資料。
- 報告的即時性取決於執行環境可存取的官方申報、公司 IR、交易所／監管資料與可靠市場資料；若核心輸入缺失，報告必須標示「非決策就緒」並降低結論信心。
- `validate_report.py` 是結構與基本完整性檢查，不是財務模型、事實查核或投資績效保證。
- 不得把搜尋摘要、模型記憶或未驗證的數字當作一級證據，也不得把公司品質直接等同股票報酬。
- 這不是個人化投資、稅務、法律或交易建議；使用者仍須自行判斷並承擔決策責任。

## 安裝到 Codex

### 直接複製 skill（macOS／Linux）

在本 repository 根目錄執行：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/cfa-equity-research-report "${CODEX_HOME:-$HOME/.codex}/skills/"
```

若目的地已有同名 skill，請先確認要保留的版本，再以檔案管理工具或版本控制流程更新；不要在不確認的情況下覆蓋本機研究環境。

### 手動安裝

也可以把 `skills/cfa-equity-research-report` 整個資料夾複製到：

```text
~/.codex/skills/cfa-equity-research-report
```

若使用自訂 Codex 目錄，將 `~/.codex` 替換成 `${CODEX_HOME}` 指向的目錄。安裝後重新啟動 Codex，讓 skill metadata 重新載入。

## 使用範例

在 Codex 中直接指定 skill 與研究標的，例如：

```text
使用 $cfa-equity-research-report，為指定上市公司產出一份 CFA 等級投資研究報告；請包含 DCF（若適用）、相對估值、Reverse Valuation、Bear/Base/Bull、12/36 個月目標價、催化劑與風險矩陣。
```

```text
使用 $cfa-equity-research-report，分析 <上市地>:<TICKER>。研究基準日為最近可交易日，優先使用公司 IR、監管申報與交易所資料；若資料不足，明確標示未揭露、N/A、N/M 或非決策就緒。
```

使用尖括號時，請在實際提示中換成真實公司與 ticker；不要把尖括號佔位符留在交付報告中。

## 驗證 skill 與研究報告

### 驗證 skill metadata

需要 Python 3 與 PyYAML。從本 repository 根目錄執行 Codex skill-creator 提供的 quick validator：

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/cfa-equity-research-report
```

在 Codex 隨附的 skill-creator 目錄中，該腳本通常位於：

```text
~/.codex/skills/.system/skill-creator/scripts/quick_validate.py
```

### 驗證研究報告

若報告檔案位於 `report.md`，可使用已安裝的 skill：

```bash
SKILL_DIR="${CLAUDE_SKILL_DIR:-${CODEX_HOME:-$HOME/.codex}/skills/cfa-equity-research-report}"
[ -d "$SKILL_DIR" ] || SKILL_DIR="./skills/cfa-equity-research-report"
python3 "$SKILL_DIR/scripts/validate_report.py" report.md --strict
```

`--strict` 會要求八個章節、至少 10 個 Markdown 表格、至少 7 個資料來源／計算註記及至少 8 個可點擊外部來源；通過不代表數字已經獨立查證。

### 編譯檢查與 smoke test

在 repository 根目錄執行：

```bash
PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/cfa-equity-research-skill-pycache" \
  python3 -m py_compile skills/cfa-equity-research-report/scripts/validate_report.py
python3 skills/cfa-equity-research-report/scripts/validate_report.py --help
python3 -m pytest -q skills/cfa-equity-research-report/scripts/test_finalize_report.py
```

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
└── skills/
    └── cfa-equity-research-report/
        ├── SKILL.md
        ├── agents/openai.yaml
        ├── references/
        │   ├── report-blueprint.md
        │   ├── research-and-valuation-standards.md
        │   ├── data-sources.md
        │   ├── positioning-and-trade-plan.md
        │   ├── delivery.md
        │   ├── subagent-research-protocol.md
        │   ├── subagent-brief.md
        │   └── industry/
        └── scripts/
            ├── validate_report.py
            ├── finalize_report.py
            └── test_finalize_report.py
```

## 授權

本專案採 MIT License，詳見 [LICENSE](LICENSE)。
