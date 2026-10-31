#!/usr/bin/env python3
"""驗證已審閱 MD，再產出同層 HTML；文字覆蓋檢查不等同視覺 QA。"""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

RUNTIME = ("support.js", "doc-page.js", "build-helpers.js")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self.hidden = [], set(), 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.hidden += 1
        if tag == "a":
            self.links.add(dict(attrs).get("href", ""))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def compact(value):
    return re.sub(r"\s+", "", html.unescape(value))


def check_coverage(markdown, rendered):
    """完整逐行／逐表格儲存格文字與 inline 連結覆蓋；不檢查版面或語意。"""
    parsed = VisibleText()
    parsed.feed(rendered)
    text = compact("".join(parsed.parts))
    checked, missing, links, excluded, mermaid_blocks = 0, [], set(), 0, 0
    fenced = False  # False | "code" | "mermaid" | "timeline"
    # MD 的 <!-- html:skip --> 區塊只給 AI 讀、HTML 不顯示；<!-- html:* --> 標記行本身也不進 HTML（研究輸出格式第八節）。
    # 剝除時保留換行數，錯誤訊息的行號才對得上原檔。
    markdown = re.sub(r"<!-- html:skip -->[\s\S]*?<!-- /html:skip -->\n?", lambda m: "\n" * m.group(0).count("\n"), markdown)
    for number, raw in enumerate(markdown.splitlines(), 1):
        line = raw.strip()
        if re.fullmatch(r"<!-- /?html:[a-z]+( quiet)? -->", line):
            continue
        if line.startswith("```"):
            if fenced:
                fenced = False
            else:
                lang = line[3:].strip().lower()
                fenced = "mermaid" if lang == "mermaid" else "timeline" if lang == "timeline" else "code"
                mermaid_blocks += fenced == "mermaid"
            continue
        if fenced == "mermaid":
            continue  # renderer 畫成 SVG 分層圖，節點文字不逐字比對，圖義由視覺 QA 確認
        if not line or re.fullmatch(r"([-*_])\1{2,}", line):
            continue
        if line.startswith("# ") and not fenced:
            excluded += 1  # renderer 以 masthead 取代 H1；明確揭露不納入覆蓋
            continue
        if not fenced:
            if re.match(r"^\|[\s:|\-]+\|?$", line):
                continue
            if re.search(r"!?\[[^\]]*\]\[|^\[[^\]]+\]:|!\[", line):
                raise ValueError(f"第 {number} 行含未支援的圖片／reference link，需人工處理。")
            for match in re.finditer(r"\[([^\]]+)\]\(([^\s)]+)\)", line):
                links.add(html.unescape(match.group(2)))
            line = re.sub(r"\[([^\]]+)\]\(([^\s)]+)\)", r"\1", line)
            line = re.sub(r"^(?:#{2,6}\s+|>\s*|[-*]\s+|\d+\.\s+)", "", line)
            line = line.replace("**", "").replace("`", "")
            line = re.sub(r"<br\s*/?>", "", line)  # 儲存格內的分行標籤在 HTML 是標籤，不是文字
        if fenced == "timeline":
            # 時程軸每行「時點 | 事件 | 說明 | 證實或報導」，前三格是 HTML 文字，末格只決定點的樣式
            probes = [c.strip() for c in line.split("|")]
            if probes and re.fullmatch(r"證實|報導", probes[-1]):
                probes.pop()
        else:
            probes = line.strip("|").split("|") if line.startswith("|") and not fenced else [line]
        for probe in probes:
            probe = compact(probe)
            if probe:
                checked += 1
                if probe not in text:
                    missing.append({"line": number, "text": probe[:100]})
    absent_links = sorted(links - parsed.links)
    if missing or absent_links:
        raise ValueError("文字／連結覆蓋失敗：" + json.dumps({"missing": missing[:12], "links": absent_links[:12]}, ensure_ascii=False))
    return {"text_probes": checked, "links": len(links), "h1_replaced_by_masthead": excluded,
            "mermaid_blocks": mermaid_blocks, "visual_qa": "not_performed", "semantic_qa": "not_performed"}


def chart_source(report):
    """暫存建置看不到原位置，依 build.js 規則找 charts.json（MD 在 report/ 時含上一層）後明確傳入。"""
    roots = [report.parent] + ([report.parent.parent] if report.parent.name == "report" else [])
    for root in roots:
        if (root / "charts.json").is_file():
            charts = json.loads((root / "charts.json").read_text(encoding="utf-8"))
            return root / "charts.json", sum(1 for c in charts.get("圖", []) if not c.get("隱藏"))
    for root in roots:
        thesis = root / "thesis.json"
        if thesis.is_file() and json.loads(thesis.read_text(encoding="utf-8")).get("回填") is None:
            raise ValueError(f"{thesis} 非回填卻沒有同層 charts.json；新格式個股報告必須附圖表資料檔。")
    return None, 0


def run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError(f"{Path(command[0]).name} 執行失敗：" + (result.stdout + result.stderr)[-3500:])
    return result.stdout


def finalize(report, config, output, renderer_dir, reviewed_sha256):
    if Path(output).expanduser().is_symlink():
        raise ValueError("output 不得為符號連結。")
    report, config, output, renderer_dir = [Path(p).expanduser().resolve() for p in (report, config, output, renderer_dir)]
    inputs_outputs = [report, config, output]
    for index, path in enumerate(inputs_outputs):
        for other in inputs_outputs[index + 1:]:
            if path == other or (path.exists() and other.exists() and path.samefile(other)):
                raise ValueError("report、config、output 路徑不得重疊。")
    for name in RUNTIME:
        target = report.parent / name
        for source in (report, config):
            if source == target or (source.exists() and target.exists() and source.samefile(target)):
                raise ValueError("runtime 發布路徑不得與輸入重疊。")
    if output.parent != report.parent or not output.name.endswith(".dc.html"):
        raise ValueError("output 必須是 MD 同層的 .dc.html。")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", reviewed_sha256) or digest(report) != reviewed_sha256.lower():
        raise ValueError("MD 與已審閱 SHA-256 不一致；請重新審閱，不能自動更新 hash。")
    cfg = json.loads(config.read_text(encoding="utf-8"))
    if not isinstance(cfg, dict) or cfg.get("skip") not in (None, []):
        raise ValueError("config.skip 必須省略或為空陣列，禁止略過段落。")
    charts_file, expected_charts = chart_source(report)
    run([sys.executable, str(Path(__file__).with_name("validate_report.py")), str(report), "--strict"])
    if digest(report) != reviewed_sha256.lower():
        raise ValueError("驗證期間 MD 已變更。")
    with tempfile.TemporaryDirectory(prefix=".cfa-build-", dir=report.parent) as tmp:
        stage = Path(tmp)
        snapshot = stage / "source.md"
        snapshot.write_bytes(report.read_bytes())
        if digest(snapshot) != reviewed_sha256.lower():
            raise ValueError("MD 快照與已審閱 hash 不一致。")
        frozen_config = stage / "config.json"
        frozen_config.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        built = stage / output.name
        log = run(["node", str(renderer_dir / "build.js")] + (["--charts", str(charts_file)] if charts_file else [])
                  + [str(snapshot), str(frozen_config), str(built)])
        found = re.search(r"資料圖 (\d+)", log or "")
        charts = int(found.group(1)) if found else 0
        if charts != expected_charts:
            raise ValueError(f"資料圖 {charts} 張，charts.json 未隱藏的圖為 {expected_charts} 張。")
        if digest(snapshot) != reviewed_sha256.lower() or digest(report) != reviewed_sha256.lower():
            raise ValueError("建置期間 MD 已變更。")
        coverage = check_coverage(snapshot.read_text(encoding="utf-8"), built.read_text(encoding="utf-8"))
        sources = [stage / name for name in RUNTIME] + [built]
        if any(not source.is_file() for source in sources):
            raise ValueError("renderer 未產出完整 HTML runtime。")
        backups = stage / "previous"
        backups.mkdir()
        if digest(report) != reviewed_sha256.lower():
            raise ValueError("發布前 MD 已變更。")
        changed = []
        try:
            for source in sources:
                target = report.parent / source.name
                old = backups / source.name
                if target.exists():
                    if not target.is_file() or target.is_symlink():
                        raise ValueError("發布目標不是普通檔案：" + str(target))
                    shutil.copy2(target, old)
                changed.append((target, old))
                source.replace(target)
        except Exception:
            for target, old in reversed(changed):
                if old.exists():
                    old.replace(target)
                else:
                    target.unlink(missing_ok=True)
            raise
    return {"status": "published", "markdown": str(report), "sha256": reviewed_sha256.lower(),
            "html": str(output), "charts": charts, "coverage": coverage}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report")
    parser.add_argument("config")
    parser.add_argument("output")
    parser.add_argument("--renderer-dir", required=True)
    parser.add_argument("--reviewed-sha256", required=True)
    args = parser.parse_args()
    try:
        result = finalize(args.report, args.config, args.output, args.renderer_dir, args.reviewed_sha256)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
