#!/usr/bin/env python3
"""驗證 CFA 式上市公司研究報告的必要結構與基本完整性。"""

from __future__ import annotations

import argparse
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


def validate(text: str, strict: bool) -> tuple[list[str], list[str]]:
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
        errors.append("七個必要 H2 的順序不正確。")

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

    if len(text.split()) < 1200:
        warnings.append("報告文字偏短，可能未達完整深度研究的分析密度。")

    return errors, warnings


def main() -> int:
    args = parse_args()
    if not args.report.is_file():
        print(f"錯誤：找不到檔案：{args.report}", file=sys.stderr)
        return 2

    text = args.report.read_text(encoding="utf-8")
    errors, warnings = validate(text, args.strict)

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
