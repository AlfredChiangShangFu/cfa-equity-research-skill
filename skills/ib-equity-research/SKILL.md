---
name: ib-equity-research
description: "把已寫好的 CFA／股票研究報告 Markdown 轉成投行版式、可列印的 HTML（.dc.html），並在需要時匯出 PDF。當使用者要求研究報告的版面、投行版式、HTML 交件檔、.dc.html、報告排版色票字級調整、或把報告印成 PDF 時使用。撰寫報告內容、估值與投資論點請用 cfa-equity-research-report，不要用本 skill。"
---

# SKILL：投行風格投資研究報告 HTML 模板（白藍基底）

把 CFA 等級的 Markdown 研究報告轉成可列印、可存 PDF 的投行版式 HTML。
**輸出**：一個 `<公司代號> Equity Research.dc.html`，呈現 MD 未標記隱藏的全部內容，不刪不改不縮寫。

---

## 1. 檔案與範例

| 檔案 | 用途 |
|---|---|
| `build.js`、`BUILD.md` | MD + config.json + charts.json → `.dc.html`，決定性、無 AI 介入；用法與 config 欄位見 BUILD.md |
| `build-helpers.js`、`doc-page.js`、`support.js` | runtime，`build.js` 自動複製到輸出資料夾 |
| `reference-2454/` | 範例：封版的 2454 聯發科報告（MD、config、charts.json、.dc.html），版面分級與頭部寫法的標準；對照用 `grep -n` 抽段落 |
| `reference-AVGO.dc.html` | 舊範例，評級條四格已過時 |

---

## 2. 產生流程

Claude Code 走 BUILD.md 的 `build.js`。Claude Design 環境沒有它：`copy_starter_component({kind:"doc_page.js"})`，`run_script` 載入 helpers 依章節組裝（`H.section`／`H.p`／`H.label`／`H.table`／`H.src`），照 MD 的 `html:skip`／`html:appendix`／`html:cols` 標記與 config 的 `sideExhibits` 手工處理，頭部手寫，`saveFile` 後 `ready_for_verification`；PDF 另存 `-print.dc.html`（`omelette-print-source` meta、`print-color-adjust:exact`、動畫凍結）交 `show_pdf_export_dialog`，不自寫 `@page`。`d_props_json` 只留 `showTemplateGuide`（Design 版的對應表附錄）。

---

## 3. 視覺規格（不可自行更動）

**色票**
```
#0A2440 深海軍藍 規線、評級字、表格上下規線、pull quote 底
#123A63 中藍 目標價數字、表頭字、次級標題
#1B6AA8 品牌藍 Exhibit 標籤、章號、連結、callout 左邊條
#C7D6E4 淺藍 實績柱；熱圖中階 #9DB9D5 #6F97C0；河流帶 #BDD3E6
#F1F5F9 極淺藍灰 callout／highlight 底；熱圖最淺階，最深到 #7FA3C8
#E4EAF0 #D6DEE7 細規線
#10203A 墨藍 標題與粗體字
#24364F 正文
#3C506B 來源註、輔助字（最淡只到這裡，不用更淺的灰）
#17624A 正報酬 #A32A1D 負報酬；日 K 台式紅漲綠跌，現價線 #D7263D 2.5px
```

**字體**
- 標題／正文：`'Crimson Pro','Noto Serif TC',serif`
- 標籤／表頭／來源註：`'Noto Sans TC',sans-serif`
- **所有數字**：`'IBM Plex Sans','Noto Sans TC',sans-serif` + `font-variant-numeric:tabular-nums`（設在 body）。**不用等寬 mono。**

**字級下限**：正文 13.5px、表格 11.5–12px、標籤 10.5–11.5px、來源註 11px。**不得出現 8.5–10px 的淡小字。**

**硬規則**
- 無漸層、無圓角、無陰影、無 emoji。
- 字距上限 0.07em（標籤），正文 0。
- 正文段落首行縮排 `text-indent:2em`；表格、清單、圖說、來源註不縮排。
- 正文**單欄**，`max-width:54em`；不使用 `column-count` 分欄。
- 頁眉／頁腳與資訊列：**容器 `flex-wrap:wrap`，個別項目 `white-space:nowrap`**；整行 nowrap 會撐寬紙面造成列印偏右。
- 同一資訊只出現一次（頁眉有的，正文不重複）。

**表格**（journal style）
- 2.5px 上規線、1px 表頭線、2.5px 末列下規線；無垂直線、無斑馬紋。
- **逐欄**判斷對齊：整欄皆數字才右對齊 + 數字字體；表頭跟隨同欄對齊。任一欄連表頭每格不超過 8 字就不斷行；第 1 章表首欄不超過 10 字不斷行。
- 每張表下必附 `src()` 來源註：來源名稱、期間、單位與口徑警語，不夾檔案路徑。

**圖表**：由 `charts.json` 產生 SVG（繪圖程式見 BUILD.md），預估柱 `#E4EAF0` + `#1B6AA8` 虛線上緣；**未揭露的數列不繪製**。圖下只留一列「圖例｜單位｜資料來源名稱」，口徑留在 charts.json 給 AI 讀。熱圖單一色相深淺、只用一種字色；散佈圖極端值以 `y上限` 截斷並在頂端標實際值。

**Exhibit 兩級**：主線是結論文字，每張先判定是論點還是查數字用。
- 全寬：本身是論點或需逐列橫向比對的，例如投資快照、日 K、事業別表、估值區間、三情境目標價、催化劑表、交易決策表。
- 側欄小表（`config.sideExhibits`）：查數字用的表，3 欄以內、每格短字，例如資本配置、監管規則、估值倍數；與相鄰正文 2:1 並排，表後緊接的段落都進左欄（表後不是正文就併前一段）；完整版留 MD 隱藏區。側欄表約 360px 高時左欄要有約 15 行正文，不足就改段落順序或補讀圖數字，不縮字。
- 半欄圖（charts.json `版面: 半欄`）與錨點段落並排；加了 `config.chartNotes` 註記的圖（常見是 `組成` 圓餅圖）改成「圖｜註記」一列，不與正文並排。同一組數字的表與圖用 `config.chartBesideTable` 並排（表左、半欄圖右）。
- 正反並列的清單用 `<!-- html:cols -->` 雙欄；逐期完整報表、參數明細、驗證性表格用 `<!-- html:appendix -->` 進文末附錄（A1、A2…）。
- 並排一律 `display:flex;flex-wrap:wrap;gap:24px`，Exhibit 側 `flex:0 1 <寬度>;min-width:220px`，窄螢幕自動落回單欄。

---

## 4. 版面骨架（順序固定）

1. **頁眉 slot**：**深藍底 `#0A2440` 白字**品牌條（`padding:7px 12px`，9.5px／字距 0.03em）；左「Equity Research · 公司 (代號)」白字，右「產業 · Initiation · 日期」用 `#BDD3E6` 淺藍區分。
2. **Masthead**：公司名 38px Crimson Pro + 代號徽章（**外框式**：`border:1px solid #0A2440`、深藍字，不用實底）+ 右側評級（SELL 等，30px Crimson Pro `#0A2440`）。
3. **標語區（減重版）**：淡藍底 `#EAF1F7` + **4px 深藍左側粗規線**，不用整塊深藍實底。兩層：第一行 `tagline` 19px 深藍粗斜體（`font-weight:600;font-style:italic;color:#0A2440`），一眼看到產品面題材與評級方向；第二行 `taglineSub` 15px 中藍斜體 `#123A63`，先講產品，再一句「評級 X：理由」，不放目標價與本益比。
4. **評級條**：2.5px 上下規線包住的**三格**：現價｜12M 目標｜36M 目標，格下小字放市值與預期總報酬；下方資訊列**靠左依序排**，只放 4 項白話：研究基準日、評級可信度、12 個月三情境目標價、目標價算法。模型參數（WACC、β、終端成長）留附錄。
5. **第 1 章：執行摘要 + 投資快照 2:1 並排**：左 `flex:2 1 400px` 放 3 到 5 點編號要點，右 `flex:1 1 220px` 放 Exhibit 1（11.5px，每格一個數字，不重複刊頭），兩欄等高；日 K 全寬接在其後。
6. **後續章節**：`H.section('02','…', […])`，正文單欄，Exhibit 依第 3 節兩級決定全寬、側欄或並排。
7. **Pull quote**：全篇最多一次，放結論前；此處才用深藍實底白字斜體。
8. **附錄：完整報表**：`html:appendix` 收集的表格與來源註，編號 A1、A2…。
9. **頁腳 slot**：研究基準日 + 代號，不放免責聲明；1px 上規線、`#3C506B`、可換行容器。

**深色用量上限**：整份只有「頁眉條、pull quote、表格上下規線、敏感度主情境交叉格」四處深藍。

---

## 5. 內容忠實度（最重要）

- MD 未標記隱藏的**每一段、每一張表、每一條註、每個連結**都要出現；不摘要、不合併、不改寫數字。隱藏只靠 MD 的 `<!-- html:skip -->` 與 charts.json 的 `隱藏`，不用 `config.skip`。
- MD 的 `**粗體**`、`[文字](連結)`、行內程式碼由 `inline()` 自動轉換；「附錄 A3」「Exhibit 12」「第 4 章」自動成頁內連結。
- 「未揭露」「不是公司指引」「兩口徑不可相加」這類口徑警語必須原樣保留。
- 章節標題保留 MD 原文（含中英並列），只加兩位數章號。

---

## 6. 匯出 PDF

HTML 是主要交付，PDF 只在需要時匯出：Claude Code 用 headless Chrome（BUILD.md），Claude Design 走第 2 節的 print 檔流程。印出偏右時回第 3 節換行規則。
