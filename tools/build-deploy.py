#!/usr/bin/env python3
"""
build-deploy.py · 把私密名單注入 apps-script.gs,產出可直接貼到 Apps Script 編輯器的版本。

用法:
    python3 tools/build-deploy.py            # 只產生一個檔：_build/PASTE-INTO-GOOGLE-APPS-SCRIPT.gs
    python3 tools/build-deploy.py --copy     # 同上，並複製到剪貼簿 (macOS pbcopy)，一鍵貼進 Apps Script

設計理念:
    - repo 裡的 apps-script.gs 永遠是「乾淨版」(STUDENTS_PRIVATE / TEACHERS_PRIVATE 為空)
    - 真實資料只放在 private-data.local.json (已被 .gitignore 排除)
    - 部署到 Apps Script 之前先跑這支 script,把資料注入後再貼上
    - 推 GitHub 時不會洩漏個資

只會替換 apps-script.gs 裡這兩段「標記之間」的內容:
    // <<< PRIVATE_DATA_START:students
    ...
    // <<< PRIVATE_DATA_END:students

    // <<< PRIVATE_DATA_START:teachers
    ...
    // <<< PRIVATE_DATA_END:teachers
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_GS = ROOT / "apps-script.gs"
DATA_JSON = ROOT / "private-data.local.json"
EXAMPLE_JSON = ROOT / "private-data.local.example.json"
OUT_DIR = ROOT / "_build"
# 只產這一個檔：全選複製 → Apps Script 整份貼上即可（_build/ 已 .gitignore）
OUT_GS = OUT_DIR / "PASTE-INTO-GOOGLE-APPS-SCRIPT.gs"

PASTE_BANNER = """/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 這份檔 → 可直接「全選、複製」貼進 Google Apps Script 編輯器（取代整個專案程式碼即可）
 * 儲存後：部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署
 * 名單來自 private-data.local.json（勿把本檔提交到公開 GitHub）
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

"""


def fail(msg: str, code: int = 1) -> None:
    print(f"❌ {msg}", file=sys.stderr)
    sys.exit(code)


def ok(msg: str) -> None:
    print(f"✓ {msg}")


def warn(msg: str) -> None:
    print(f"⚠️  {msg}")


def fmt_student(s: dict) -> str:
    name = str(s.get("name", "")).strip()
    email = str(s.get("email", "")).strip()
    code = str(s.get("code", "")).strip()
    if not name:
        return ""
    # 用 json.dumps 處理引號跳脫 (學生姓名理論上沒特殊字元,但 email 可能會)
    return f'  {{ name: {json.dumps(name, ensure_ascii=False)}, email: {json.dumps(email, ensure_ascii=False)}, code: {json.dumps(code, ensure_ascii=False)} }},'


def fmt_teacher(t: dict) -> str:
    name = str(t.get("name", "")).strip()
    code = str(t.get("code", "")).strip()
    label = str(t.get("label", "")).strip()
    if not name:
        return ""
    parts = [f"name: {json.dumps(name, ensure_ascii=False)}", f"code: {json.dumps(code, ensure_ascii=False)}"]
    if label:
        parts.append(f"label: {json.dumps(label, ensure_ascii=False)}")
    return "  { " + ", ".join(parts) + " },"


def replace_between(src: str, start_marker: str, end_marker: str, replacement_body: str, kind: str) -> str:
    """把 START/END 標記之間(含標記行)替換成: START + 注入內容 + END。標記本身保留。"""
    pattern = re.compile(
        r"(^[ \t]*//[ \t]*" + re.escape(start_marker) + r"[^\n]*\n)"
        r"(.*?)"
        r"(^[ \t]*//[ \t]*" + re.escape(end_marker) + r"[^\n]*\n)",
        re.DOTALL | re.MULTILINE,
    )
    m = pattern.search(src)
    if not m:
        fail(
            f"找不到標記 `// {start_marker}` ... `// {end_marker}` (kind={kind})\n"
            f"請確認 apps-script.gs 沒有被改壞;若有需要重建,參考 README「老師面板」一節。"
        )
    body = (replacement_body.rstrip() + "\n") if replacement_body.strip() else ""
    new_block = m.group(1) + body + m.group(3)
    return src[: m.start()] + new_block + src[m.end():]


def load_data() -> dict:
    if not DATA_JSON.exists():
        msg = [
            f"找不到 {DATA_JSON.relative_to(ROOT)}",
            "請建立此檔(已被 .gitignore 排除,只在本機)",
        ]
        if EXAMPLE_JSON.exists():
            msg.append(f"可以複製範例: cp {EXAMPLE_JSON.relative_to(ROOT)} {DATA_JSON.relative_to(ROOT)}")
        fail("\n  ".join(msg))
    with DATA_JSON.open("r", encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    args = sys.argv[1:]
    do_copy = "--copy" in args or "-c" in args
    do_print_help = "--help" in args or "-h" in args

    if do_print_help:
        print(__doc__)
        return

    if not SRC_GS.exists():
        fail(f"找不到 {SRC_GS.relative_to(ROOT)}")

    data = load_data()
    students = [s for s in data.get("students", []) if isinstance(s, dict)]
    teachers = [t for t in data.get("teachers", []) if isinstance(t, dict)]

    src = SRC_GS.read_text(encoding="utf-8")

    student_lines = "\n".join(line for line in (fmt_student(s) for s in students) if line)
    teacher_lines = "\n".join(line for line in (fmt_teacher(t) for t in teachers) if line)

    src = replace_between(src, "<<< PRIVATE_DATA_START:students", "<<< PRIVATE_DATA_END:students", student_lines, "students")
    src = replace_between(src, "<<< PRIVATE_DATA_START:teachers", "<<< PRIVATE_DATA_END:teachers", teacher_lines, "teachers")

    final = PASTE_BANNER + src

    OUT_DIR.mkdir(exist_ok=True)
    OUT_GS.write_text(final, encoding="utf-8")
    ok(f"已輸出 {OUT_GS.relative_to(ROOT)}（僅此一份，全選複製即可）")
    print(f"  • {len(students)} 位學生")
    print(f"  • {len(teachers)} 位老師")

    if do_copy:
        try:
            subprocess.run(["pbcopy"], input=final.encode("utf-8"), check=True)
            ok("已複製到剪貼簿,直接到 Apps Script 編輯器全選貼上即可")
        except FileNotFoundError:
            warn(f"pbcopy 不存在(非 macOS?);請手動複製 {OUT_GS.relative_to(ROOT)} 內容")
        except subprocess.CalledProcessError as e:
            warn(f"pbcopy 失敗: {e};請手動複製 {OUT_GS.relative_to(ROOT)} 內容")
    else:
        print()
        print(f"  提示:加 `--copy` 會直接複製到剪貼簿。")
        print(f"  目前內容已寫在 {OUT_GS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
