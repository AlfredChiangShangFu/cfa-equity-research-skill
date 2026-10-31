#!/usr/bin/env python3
"""stdlib tests; optional real-renderer smoke test via CFA_RENDERER_DIR."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import finalize_report as subject


class FinalizeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = self.root / "fixture.md"
        self.config = self.root / "config.json"
        self.output = self.root / "fixture.dc.html"
        self.report.write_text("# 報告\n\n## 執行摘要\n\n完整重要內容與數字 123。\n\n[來源](https://example.com)\n", encoding="utf-8")
        self.config.write_text("{}")
        self.output.write_text("previous HTML")
        for name in subject.RUNTIME:
            (self.root / name).write_text("previous runtime")
        self.sha = subject.digest(self.report)

    def invoke(self):
        return subject.finalize(self.report, self.config, self.output, self.root, self.sha)

    def fake_run(self, command):
        if command[0] == "node":
            out = Path(command[-1])
            out.write_text('<body><h2>執行摘要</h2><p>完整重要內容與數字 123。</p><table><tr><th>日期</th><th>上行／下行</th></tr><tr><td>10/29</td><td>上行一句<br>下行一句</td></tr></table><a href="https://example.com">來源</a></body>', encoding="utf-8")
            for name in subject.RUNTIME:
                (out.parent / name).write_text("new runtime")
        return "ok"

    def assert_previous(self):
        self.assertEqual(self.output.read_text(), "previous HTML")
        for name in subject.RUNTIME:
            self.assertEqual((self.root / name).read_text(), "previous runtime")

    def test_stale_hash_refuses_all_commands(self):
        self.report.write_text("changed")
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            self.invoke()
        run.assert_not_called()
        self.assert_previous()

    def test_strict_failure_prevents_build(self):
        with patch.object(subject, "run", side_effect=ValueError("strict fail")) as run, self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(run.call_count, 1)
        self.assertIn("--strict", run.call_args.args[0])
        self.assert_previous()

    def test_success(self):
        with patch.object(subject, "run", side_effect=self.fake_run):
            result = self.invoke()
        self.assertEqual(result["status"], "published")
        self.assertEqual(subject.digest(self.report), self.sha)
        self.assertEqual(result["coverage"]["links"], 1)
        self.assertEqual((self.root / "support.js").read_text(), "new runtime")

    def test_missing_content_preserves_previous(self):
        def bad_run(command):
            self.fake_run(command)
            if command[0] == "node":
                Path(command[-1]).write_text("<body>執行摘要</body>")
        with patch.object(subject, "run", side_effect=bad_run), self.assertRaises(ValueError):
            self.invoke()
        self.assert_previous()

    def test_html_skip_blocks_and_markers_excluded(self):
        self.report.write_text(
            "# 報告\n\n## 執行摘要\n\n<!-- html:skip -->\n只給 AI 讀的基準行與版本對照。\n<!-- /html:skip -->\n\n"
            "完整重要內容與數字 123。<!-- html:skip -->（原文：舊句子）<!-- /html:skip -->\n\n"
            "| 日期 | 上行／下行 |\n|---|---|\n| 10/29 | 上行一句<br>下行一句 |\n\n"
            "<!-- html:cols -->\n\n[來源](https://example.com)\n\n<!-- /html:cols -->\n\n<!-- html:appendix quiet -->\n<!-- /html:appendix -->\n",
            encoding="utf-8")
        self.sha = subject.digest(self.report)
        with patch.object(subject, "run", side_effect=self.fake_run):
            result = self.invoke()
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["coverage"]["text_probes"], 7)  # 標題、正文句、表頭 2、表格 2、連結文字；skip 區塊與標記行不計

    def test_mermaid_skipped_and_timeline_cells_probed(self):
        self.report.write_text(
            "# 報告\n\n## 執行摘要\n\n完整重要內容與數字 123。\n\n```mermaid\nflowchart LR\n  A[\"矽智財\"] --> B[\"手機 SoC\"]\n```\n\n"
            "```timeline\n2026Q4 | TPU 8i 量產 | 公司證實第四季 | 證實\n2028 初 | TPU v9 量產 | | 報導\n```\n\n[來源](https://example.com)\n",
            encoding="utf-8")
        self.sha = subject.digest(self.report)

        def fake_run(command):
            if command[0] == "node":
                Path(command[-1]).write_text(
                    '<body><h2>執行摘要</h2><p>完整重要內容與數字 123。</p><svg><text>別的字</text></svg>'
                    '<div>2026Q4</div><div>TPU 8i 量產</div><div>公司證實第四季</div><div>2028 初</div><div>TPU v9 量產</div>'
                    '<a href="https://example.com">來源</a></body>', encoding="utf-8")
                for name in subject.RUNTIME:
                    (Path(command[-1]).parent / name).write_text("new runtime")
            return "ok"

        with patch.object(subject, "run", side_effect=fake_run):
            result = self.invoke()
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["coverage"]["mermaid_blocks"], 1)
        self.assertEqual(result["coverage"]["text_probes"], 8)  # 標題、正文句、時程軸 5 格、連結文字

    def test_missing_line_number_matches_source_after_skip_removed(self):
        self.report.write_text(
            "# 報告\n\n## 執行摘要\n\n<!-- html:skip -->\n甲\n乙\n<!-- /html:skip -->\n\n完整重要內容與數字 123。\n\n不在 HTML 的句子。\n",
            encoding="utf-8")
        self.sha = subject.digest(self.report)
        with patch.object(subject, "run", side_effect=self.fake_run), self.assertRaises(ValueError) as ctx:
            self.invoke()
        self.assertIn('"line": 12', str(ctx.exception))
        self.assert_previous()

    def test_nonempty_skip_rejected(self):
        self.config.write_text('{"skip":["1.0"]}')
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            self.invoke()
        run.assert_not_called()

    def test_output_symlink_refused(self):
        self.output.unlink()
        self.output.symlink_to(self.root / "elsewhere.dc.html")
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            self.invoke()
        run.assert_not_called()

    def test_overlapping_input_output_refused(self):
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            subject.finalize(self.output, self.config, self.output, self.root, subject.digest(self.output))
        run.assert_not_called()

    def test_runtime_input_collision_refused(self):
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            subject.finalize(self.report, self.root / "support.js", self.output, self.root, self.sha)
        run.assert_not_called()

    def test_build_mutation_refused(self):
        def mutating_run(command):
            self.fake_run(command)
            if command[0] == "node":
                self.report.write_text("changed by another process")
        with patch.object(subject, "run", side_effect=mutating_run), self.assertRaises(ValueError):
            self.invoke()
        self.assert_previous()

    def chart_run(self, count):
        def run(command):
            self.fake_run(command)
            return f"資料圖 {count}｜跳過 0" if command[0] == "node" else "ok"
        return run

    def test_charts_in_parent_of_report_dir_passed(self):
        folder = self.root / "report"
        folder.mkdir()
        for path in (self.report, self.config, self.output):
            path.replace(folder / path.name)
        self.report, self.config, self.output = (folder / p.name for p in (self.report, self.config, self.output))
        (self.root / "thesis.json").write_text('{"回填": null}', encoding="utf-8")
        (self.root / "charts.json").write_text('{"圖": [{"id": "a"}, {"id": "b"}, {"id": "c", "隱藏": true}]}', encoding="utf-8")
        with patch.object(subject, "run", side_effect=self.chart_run(2)) as run:
            result = self.invoke()
        build = run.call_args_list[-1].args[0]
        self.assertEqual(build[build.index("--charts") + 1], str((self.root / "charts.json").resolve()))
        self.assertEqual(result["charts"], 2)

    def test_chart_count_mismatch_preserves_previous(self):
        (self.root / "charts.json").write_text('{"圖": [{"id": "a"}]}', encoding="utf-8")
        with patch.object(subject, "run", side_effect=self.chart_run(0)), self.assertRaises(ValueError):
            self.invoke()
        self.assert_previous()

    def test_thesis_without_charts_refused(self):
        (self.root / "thesis.json").write_text('{"回填": null}', encoding="utf-8")
        with patch.object(subject, "run") as run, self.assertRaises(ValueError):
            self.invoke()
        run.assert_not_called()

    def test_backfilled_thesis_without_charts_allowed(self):
        (self.root / "thesis.json").write_text('{"回填": "2026-09-27"}', encoding="utf-8")
        with patch.object(subject, "run", side_effect=self.fake_run) as run:
            result = self.invoke()
        self.assertNotIn("--charts", run.call_args_list[-1].args[0])
        self.assertEqual(result["charts"], 0)

    @unittest.skipUnless(os.environ.get("CFA_RENDERER_DIR"), "set CFA_RENDERER_DIR for real renderer smoke test")
    def test_real_renderer(self):
        # 合成完整結構僅驗證工具相容性；數據並非投資研究。
        from validate_report import REQUIRED_HEADINGS
        lines = ["# 合成公司（TEST:FIXTURE）CFA 等級投資研究報告", ""]
        for index, heading in enumerate(REQUIRED_HEADINGS):
            lines.extend(["## " + heading, ""])
            if index == 0:
                lines.extend(["研究基準日：2020-01-01；評級 HOLD；現價 100；12 個月目標價 105；36 個月目標價 110。", ""])
            lines.extend(["合成測試內容：Bear、Base、Bull；Reverse Valuation；資料限制：此為測試，不能用於投資。", ""])
            for table_index in range(2):
                label = f"{index}-{table_index}"
                lines.extend(["| 指標 | 值 |", "| --- | --- |", f"| 測試指標 {label} | 12.3% |", "", f"資料來源：[合成資料 {label}](https://example.com/{label})；計算為測試值。", ""])
        lines.extend(["最終評級 HOLD。", ""])
        self.report.write_text("\n".join(lines), encoding="utf-8")
        self.sha = subject.digest(self.report)
        self.config.write_text(json.dumps({"masthead": {"name": "測試", "ticker": "TEST", "sector": "科技", "kind": "研究", "date": "2026-09-23", "exchange": "TEST", "currency": "USD", "market": "US", "assetClass": "股票"}, "rating": {"call": "HOLD", "qualifier": "測試", "cells": [], "infoRow": []}, "exhibits": {"1": "指標"}}, ensure_ascii=False), encoding="utf-8")
        cfg = json.loads(self.config.read_text())
        cfg["rating"]["cells"] = [{"label": x, "value": "123", "sub": "USD"} for x in ("現價", "12M", "36M")]
        cfg["exhibits"] = {str(i): f"合成指標 {i}" for i in range(1, 2 * len(REQUIRED_HEADINGS) + 1)}
        self.config.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        result = subject.finalize(self.report, self.config, self.output, os.environ["CFA_RENDERER_DIR"], self.sha)
        self.assertEqual(result["status"], "published")


if __name__ == "__main__":
    unittest.main()
