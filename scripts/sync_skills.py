#!/usr/bin/env python3
"""維護者工具：把本機安裝的兩個 skill 與研究專案的共用工具組成本 repository 的發布內容。

本機安裝版是正本，本 repository 只是發布版。tech.py、charts.js 與 charts.json 規格平時放在研究專案，
只在發布時複製進 skill 資料夾，讓沒有研究專案的人也能直接執行。

用法：
  python3 scripts/sync_skills.py --cfa <cfa skill 目錄> --ib <ib skill 目錄> --research-repo <研究專案根目錄>
"""
import argparse, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE = shutil.ignore_patterns("*.bak*", "__pycache__", ".DS_Store", "*.pyc")
SPEC_START, SPEC_END = "## 七、charts.json", "## 八、"
SPEC_NOTE = "# charts.json 規格\n\n> 摘自原研究專案的 `docs/研究輸出格式.md` 第七節。文中的 ADR、issue 編號與 `研究報告/` 路徑是原專案的紀錄；沒有 thesis.json 時，同層一致性檢查不適用。\n\n"


def copy_skill(src: Path, name: str) -> Path:
    if not (src / "SKILL.md").is_file():
        sys.exit(f"{src} 沒有 SKILL.md")
    dest = ROOT / "skills" / name
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src.resolve(), dest, ignore=IGNORE)
    return dest


def extract_spec(doc: Path) -> str:
    text = doc.read_text(encoding="utf-8")
    start, end = text.find(SPEC_START), text.find(SPEC_END)
    if start < 0 or end < start:
        sys.exit(f"{doc} 找不到「{SPEC_START}」到「{SPEC_END}」段落")
    body = text[start:end].strip().split("\n", 1)[1]
    body = body.replace("node tools/charts.js", "node <ib-equity-research 安裝目錄>/charts.js")
    return SPEC_NOTE + body.strip() + "\n"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--cfa", type=Path, required=True)
    p.add_argument("--ib", type=Path, required=True)
    p.add_argument("--research-repo", type=Path, required=True)
    a = p.parse_args()
    tools = a.research_repo / "tools"
    cfa = copy_skill(a.cfa, "cfa-equity-research-report")
    ib = copy_skill(a.ib, "ib-equity-research")
    shutil.copy2(tools / "tech.py", cfa / "scripts" / "tech.py")
    shutil.copy2(tools / "charts.js", ib / "charts.js")
    (ib / "charts-spec.md").write_text(extract_spec(a.research_repo / "docs" / "研究輸出格式.md"), encoding="utf-8")
    leftovers = [f for f in (ROOT / "skills").rglob("*") if ".bak" in f.name]
    if leftovers:
        sys.exit(f"仍有備份檔：{leftovers}")
    print(f"已同步到 {ROOT / 'skills'}")


if __name__ == "__main__":
    main()
