#!/usr/bin/env python3
"""驗證 CFA 式上市公司研究報告的必要結構與基本完整性。"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path


REQUIRED_HEADINGS = [
    "執行摘要",
    "公司、商業模式與策略定位",
    "市場規模與競爭格局",
    "財務品質、單位經濟與客戶指標",
    "風險、監管與 ESG",
    "估值、情境與敏感度",
    "籌碼與交易計畫",
    "投資論點、催化劑與最終建議",
]

PLACEHOLDER_PATTERNS = [
    r"\bTODO\b",
    r"\bTBD\b",
    r"待補",
    r"待確認",
    r"\{(?:公司|法定公司名|交易所|Ticker|ticker|日期|現價|目標價|currency|period)\}",
]

INTERNAL_REFERENCE_PATTERNS = [
    r"turn\d+(?:view|search|finance)\d+",
    r"sandbox:/mnt/data/",
    r"cite",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="要驗證的 Markdown 報告")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="提高來源、表格與資料註記的最低門檻",
    )
    return parser.parse_args()


def validate(
    text: str, strict: bool, report_path: Path | None = None
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not re.search(r"^# .+（.+:.+\）CFA 等級投資研究報告\s*$", text, re.M):
        errors.append("H1 必須含公司名、交易所、Ticker 與『CFA 等級投資研究報告』。")

    positions: list[int] = []
    for heading in REQUIRED_HEADINGS:
        match = re.search(rf"^## {re.escape(heading)}\s*$", text, re.M)
        if not match:
            errors.append(f"缺少必要 H2：{heading}")
        else:
            positions.append(match.start())

    if len(positions) == len(REQUIRED_HEADINGS) and positions != sorted(positions):
        errors.append("八個必要 H2 的順序不正確。")

    actual_headings = re.findall(r"^## (.+?)\s*$", text, re.M)
    if actual_headings != REQUIRED_HEADINGS:
        errors.append("報告必須依序使用固定的八個 H2，且不得新增其他 H2。")

    summary_match = re.search(
        r"^## 執行摘要\s*$([\s\S]*?)(?=^## )", text, re.M
    )
    summary = summary_match.group(1) if summary_match else ""
    for item in ("研究基準日", "評級", "現價", "12 個月", "36 個月"):
        if item not in summary:
            errors.append(f"執行摘要缺少：{item}")

    if not re.search(r"最終評級[^\n]*(?:BUY|HOLD|SELL|Outperform|Neutral|Underperform)", text, re.I):
        errors.append("缺少可辨識的最終評級。")

    scenario_groups = [
        ("Bear", "Base", "Bull"),
        ("悲觀", "基本", "樂觀"),
    ]
    if not any(all(label in text for label in group) for group in scenario_groups):
        errors.append("缺少完整的 Bear／Base／Bull 或悲觀／基本／樂觀情境。")

    if "Reverse" not in text and "反推" not in text:
        errors.append("缺少 Reverse Valuation 或市場隱含要求。")

    for pattern in PLACEHOLDER_PATTERNS:
        if re.search(pattern, text, re.I):
            errors.append(f"仍有未完成佔位符：{pattern}")

    for pattern in INTERNAL_REFERENCE_PATTERNS:
        if re.search(pattern, text, re.I):
            errors.append(f"含不可交付的內部引用或路徑：{pattern}")

    first_para = re.split(r"\n\s*\n", summary.strip(), maxsplit=1)[0] if summary.strip() else ""

    date_match = re.search(
        r"研究基準日[^\d\n]{0,12}(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?", summary
    )
    if date_match:
        try:
            base_date = dt.date(*(int(g) for g in date_match.groups()))
            if base_date > dt.date.today():
                errors.append(f"研究基準日 {base_date} 晚於今天。")
        except ValueError:
            errors.append(f"研究基準日無法解析：{date_match.group(0)}")
    else:
        errors.append("執行摘要找不到研究基準日（YYYY-MM-DD 或 YYYY 年 M 月 D 日）。")

    number = r"([\d,]+(?:\.\d+)?)"

    # 評級可依 Base 總報酬或機率加權總報酬，report 須標示用的是哪一種。
    # 有標示機率加權時直接拿該數字對 standards 門檻，不必經由 Base 目標價換算。
    weighted = re.search(
        r"最終評級[^\n]*?機率加權[^\n]*?總報酬\s*([+\-−])?\s*([\d.]+)\s*%", text
    )
    if weighted:
        ret = float(weighted.group(2)) / 100
        if weighted.group(1) in ("-", "−"):
            ret = -ret
        rating_w = re.search(r"最終評級[^\n]*?\b(BUY|HOLD|SELL)\b", text, re.I)
        if rating_w:
            call = rating_w.group(1).upper()
            if call == "BUY" and ret < 0.15:
                errors.append(
                    f"評級 BUY 但機率加權 12 個月總報酬 {ret:+.1%} 未達 standards 門檻 +15%。"
                )
            if call == "SELL" and ret > -0.10:
                errors.append(
                    f"評級 SELL 但機率加權 12 個月總報酬 {ret:+.1%} 未達 standards 門檻 −10%。"
                )
            if call == "HOLD" and not (-0.10 < ret < 0.15):
                errors.append(
                    f"評級 HOLD 但機率加權 12 個月總報酬 {ret:+.1%} 落在 HOLD 區間之外。"
                )

    rating_match = None if weighted else re.search(r"\b(BUY|HOLD|SELL)\b", first_para)
    price_match = re.search(r"(?:現價|收盤價)[^\d\n]{0,16}" + number, first_para)
    target_match = re.search(r"12 個月[^\n\d]{0,24}目標價[^\d\n]{0,16}" + number, first_para)
    if rating_match and price_match and target_match:
        price = float(price_match.group(1).replace(",", ""))
        target = float(target_match.group(1).replace(",", ""))
        rating = rating_match.group(1)
        if price > 0:
            upside = target / price - 1
            # standards 門檻用總報酬，本檢查只能算價格報酬，差額是股息，故留 5pp 緩衝帶
            if rating == "BUY" and upside < 0.10:
                errors.append(
                    f"評級 BUY 但 12 個月目標價隱含價格報酬僅 {upside:+.1%}，"
                    "股息無法補到 standards 要求的總報酬 +15%。"
                )
            elif rating == "BUY" and upside < 0.15:
                warnings.append(
                    f"評級 BUY 的價格報酬 {upside:+.1%} 低於 +15%，"
                    "報告須寫明股息貢獻使總報酬達標。"
                )
            if rating == "SELL" and upside > -0.10:
                errors.append(
                    f"評級 SELL 但 12 個月目標價隱含價格報酬 {upside:+.1%}，"
                    "未達 standards 要求的總報酬 ≤ −10%（股息只會使總報酬更高）。"
                )
            if rating == "HOLD" and upside >= 0.15:
                errors.append(
                    f"評級 HOLD 但 12 個月目標價隱含價格報酬 {upside:+.1%}，已達 BUY 門檻。"
                )
            elif rating == "HOLD" and upside <= -0.15:
                warnings.append(
                    f"評級 HOLD 但 12 個月目標價隱含價格報酬 {upside:+.1%}，接近或已過 SELL 門檻。"
                )
    elif not weighted:
        warnings.append("執行摘要首段無法同時抽出評級、現價與 12 個月目標價，跳過評級方向檢查。")

    table_count = len(
        re.findall(r"^\|(?:\s*:?-{3,}:?\s*\|){2,}\s*$", text, re.M)
    )
    source_note_count = len(re.findall(r"資料來源[：:]", text))
    link_count = len(re.findall(r"\[[^\]]+\]\(https?://[^)]+\)", text))

    if table_count < 6:
        errors.append(f"Markdown 表格不足：目前 {table_count}，至少需要 6。")
    if source_note_count < 4:
        errors.append(f"資料來源／計算註記不足：目前 {source_note_count}，至少需要 4。")
    if link_count < 5:
        warnings.append(f"可點擊外部來源偏少：目前 {link_count}，建議至少 5。")

    if strict:
        if table_count < 10:
            errors.append(f"嚴格模式要求至少 10 個表格，目前 {table_count}。")
        if source_note_count < 7:
            errors.append(f"嚴格模式要求至少 7 個資料來源／計算註記，目前 {source_note_count}。")
        if link_count < 8:
            errors.append(f"嚴格模式要求至少 8 個可點擊外部來源，目前 {link_count}。")
        if not re.search(r"(?:N/A|N/M|未揭露|限制)", text):
            warnings.append("未見資料限制或不可得資料標示，請確認是否過度完整。")

    if len(text) < 12000:
        warnings.append("報告文字偏短，可能未達完整深度研究的分析密度。")

    if report_path is not None:
        check_artifacts(report_path, text, errors, warnings)

    return errors, warnings


def check_artifacts(
    report_path: Path, text: str, errors: list[str], warnings: list[str]
) -> None:
    """檢查同一份研究的下游產物。

    build_research_index.js 讀 <AI 目錄>/SUMMARY.md 與 <AI 目錄>/model/valuation_summary.json；
    缺檔時該筆研究會從索引靜默消失，不會有任何錯誤訊息。
    """
    ai_dir = None
    for parent in report_path.resolve().parents:
        # 只認 研究報告/<標的>/<派工日>/<claude|codex>/，避免外人路徑剛好有同名資料夾
        if parent.name in ("claude", "codex") and parent.parts[-4:-3] == ("研究報告",):
            ai_dir = parent
            break
    if ai_dir is None:
        warnings.append(
            "報告不在 研究報告/<標的>/<派工日>/claude/ 之下，跳過產物與索引檢查。"
        )
        return

    summary_path = ai_dir / "SUMMARY.md"
    valuation_path = ai_dir / "model" / "valuation_summary.json"
    thesis_path = ai_dir / "thesis.json"

    if thesis_path.is_file():
        # 2026-09-26 起索引只讀論點檔（AGENTS.md）；SUMMARY.md 與 valuation_summary.json 是舊格式，不再要求。
        try:
            thesis = json.loads(thesis_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"thesis.json 不是合法 JSON：{exc}")
            return
        report_rating = re.search(r"最終評級[^\n]*?\b(BUY|HOLD|SELL)\b", text, re.I)
        thesis_rating = str(thesis.get("評級", "")).upper()
        if report_rating and thesis_rating and report_rating.group(1).upper() != thesis_rating:
            errors.append(f"thesis.json 評級 {thesis_rating} 與報告最終評級 {report_rating.group(1).upper()} 不一致。")
        if not list(report_path.parent.glob("*.dc.html")):
            warnings.append("報告同層沒有 .dc.html，未產出投行版式 HTML。")
        return

    if not summary_path.is_file():
        errors.append(f"缺少 {summary_path.name}，本筆研究不會進入 RESEARCH_INDEX。")
    else:
        summary_text = summary_path.read_text(encoding="utf-8")
        if not re.search(r"評等[：:]", summary_text):
            errors.append("SUMMARY.md 缺少『評等：』欄位，索引的評等欄會是空的。")
        else:
            report_rating = re.search(
                r"最終評級[^\n]*?\b(BUY|HOLD|SELL)\b", text, re.I
            )
            summary_rating = re.search(
                r"評等[：:]\s*[^\n]*?\b(BUY|HOLD|SELL)\b", summary_text, re.I
            )
            if (
                report_rating
                and summary_rating
                and report_rating.group(1).upper() != summary_rating.group(1).upper()
            ):
                errors.append(
                    f"SUMMARY.md 評等 {summary_rating.group(1).upper()} "
                    f"與報告最終評級 {report_rating.group(1).upper()} 不一致。"
                )

    if not valuation_path.is_file():
        errors.append(
            "缺少 model/valuation_summary.json，本筆研究不會進入 RESEARCH_INDEX。"
        )
    else:
        try:
            data = json.loads(valuation_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"model/valuation_summary.json 不是合法 JSON：{exc}")
            return
        for field in ("fair_value_range", "conclusion"):
            if data.get(field) in (None, "", []):
                errors.append(f"valuation_summary.json 缺少必要欄位 {field}。")
        target = data.get("target_12m")
        if target is None:
            warnings.append(
                "valuation_summary.json 未提供 target_12m，"
                "無法機械比對模型目標價與報告目標價。"
            )
        else:
            summary_block = re.search(r"^## 執行摘要\s*$([\s\S]*?)(?=^## )", text, re.M)
            head = summary_block.group(1) if summary_block else ""
            first_para = re.split(r"\n\s*\n", head.strip(), maxsplit=1)[0] if head.strip() else ""
            match = re.search(
                r"12 個月[^\n\d]{0,24}目標價[^\d\n]{0,16}([\d,]+(?:\.\d+)?)", first_para
            )
            if match:
                reported = float(match.group(1).replace(",", ""))
                if reported > 0 and abs(reported - float(target)) / reported > 0.005:
                    errors.append(
                        f"模型 target_12m {target} 與報告 12 個月目標價 {reported} 不一致。"
                    )

    html = list((report_path.parent).glob("*.dc.html"))
    if not html:
        warnings.append("報告同層沒有 .dc.html，未產出投行版式 HTML。")

def main() -> int:
    args = parse_args()
    if not args.report.is_file():
        print(f"錯誤：找不到檔案：{args.report}", file=sys.stderr)
        return 2

    text = args.report.read_text(encoding="utf-8")
    errors, warnings = validate(text, args.strict, args.report)

    for warning in warnings:
        print(f"警告：{warning}")
    for error in errors:
        print(f"錯誤：{error}")

    if errors:
        print(f"驗證失敗：{len(errors)} 個錯誤，{len(warnings)} 個警告。")
        return 1

    print(f"驗證通過：0 個錯誤，{len(warnings)} 個警告。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
