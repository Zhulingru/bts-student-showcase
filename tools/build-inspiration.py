#!/usr/bin/env python3
"""
build-inspiration.py · 學長姐海報資料夾整理 / 索引產生工具
====================================================================

用途
----
把任意「中文人名+編號」的海報檔（.png / .jpg / .jpeg / .webp / .gif）
整理進 ../inspiration/ 資料夾，並產生 manifest.json 給網站讀。

兩種使用情境
------------
1) 第一次整理 / 加入新人：
   - 把素材丟進專案根目錄下的某個資料夾（預設找「六年級網站整理素材」），
     檔名格式：{中文姓名}{編號}.png（例如：品睿1.png、品睿2.png ...）
   - 在下方 NAMES 字典補上任何新出現的「中文 → 拼音 slug」對照
   - 在專案根目錄執行：
       python3 tools/build-inspiration.py

2) 已經有 inspiration/ 資料夾，只想重建 manifest.json：
   - 直接執行同一行指令；腳本會自動掃描 inspiration/ 內已存在的檔案。

設計細節
--------
- 為了讓網址乾淨、避免中文 URL encode 問題，網站實際讀的檔名一律是拼音 slug，
  例如 inspiration/pinrui1.png；中文姓名只用於畫面顯示。
- manifest.json 結構：
    {
      "students": [
        { "slug": "pinrui", "name": "品睿",
          "files": ["pinrui1.png", "pinrui2.png", ...] },
        ...
      ]
    }
- 檔案會「複製」過去而非搬移（保留你原本的素材夾，方便對照）。
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INSPIRATION_DIR = ROOT / "inspiration"
MANIFEST_PATH = INSPIRATION_DIR / "manifest.json"
SOURCE_CANDIDATES = [
    ROOT / "六年級網站整理素材",
    ROOT / "inspiration-source",
]

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# 中文姓名 → 拼音 slug 對照表
# 加入新學長姐時，只要在這裡補一筆即可；slug 必須是純小寫英數，且全班唯一。
NAMES: dict[str, str] = {
    "予誠": "yucheng",
    "健康": "jiankang",
    "光頎": "guangqi",
    "其蔚": "qiwei",
    "品璇": "pinxuan",
    "品睿": "pinrui",
    "國颺": "guoyang",
    "奕淇": "yiqi",
    "姸晴": "yanqing",
    "宇霈": "yupei",
    "宣妤": "xuanyu",
    "宥均": "youjun",
    "宥希": "youxi",
    "宥德": "youde",
    "宥翔": "youxiang",
    "寬伃": "kuanyu",
    "思妍": "siyan",
    "懷謙": "huaiqian",
    "星翔": "xingxiang",
    "昱心": "yuxin",
    "柏熙": "boxi",
    "畔蘆": "panlu",
    "程洵": "chengxun",
    "羿潔": "yijie",
    "荷雅": "heya",
    "語恬": "yutian",
    "鈞傑": "junjie",
}

SLUG_TO_NAME = {v: k for k, v in NAMES.items()}
FILENAME_RE_CHINESE = re.compile(r"^(.+?)(\d+)$")
FILENAME_RE_PINYIN = re.compile(r"^([a-z]+)(\d+)$")


def find_source_dir() -> Path | None:
    for p in SOURCE_CANDIDATES:
        if p.exists() and p.is_dir():
            return p
    return None


def import_from_source(source: Path) -> int:
    """把中文檔名素材複製進 inspiration/，回傳成功匯入數。"""
    INSPIRATION_DIR.mkdir(exist_ok=True)
    imported = 0
    unknown_names: set[str] = set()
    for f in sorted(source.iterdir()):
        if not f.is_file() or f.suffix.lower() not in ALLOWED_EXT:
            continue
        m = FILENAME_RE_CHINESE.match(f.stem)
        if not m:
            print(f"  - 略過（檔名不符 中文+數字 規則）: {f.name}")
            continue
        chinese, idx = m.group(1), m.group(2)
        slug = NAMES.get(chinese)
        if not slug:
            unknown_names.add(chinese)
            continue
        target = INSPIRATION_DIR / f"{slug}{int(idx)}{f.suffix.lower()}"
        if target.exists():
            print(f"  · 已存在，略過：{target.name}")
            continue
        shutil.copy2(f, target)
        print(f"  + 匯入：{f.name} → {target.name}")
        imported += 1
    if unknown_names:
        print()
        print("⚠️  以下姓名尚未登錄到 NAMES 字典（檔案未匯入）：")
        for n in sorted(unknown_names):
            print(f"   {n}")
        print('   請編輯 tools/build-inspiration.py 的 NAMES，加上 "中文": "pinyin" 後重跑。')
    return imported


def build_manifest() -> dict:
    """掃描 inspiration/ 既有檔案，產生 manifest 結構。"""
    if not INSPIRATION_DIR.exists():
        return {"students": []}

    grouped: dict[str, list[tuple[int, str]]] = {}
    for f in INSPIRATION_DIR.iterdir():
        if not f.is_file() or f.suffix.lower() not in ALLOWED_EXT:
            continue
        m = FILENAME_RE_PINYIN.match(f.stem)
        if not m:
            print(f"  ! 略過格式不符的檔案：{f.name}")
            continue
        slug, idx = m.group(1), int(m.group(2))
        grouped.setdefault(slug, []).append((idx, f.name))

    students = []
    for slug, items in grouped.items():
        items.sort(key=lambda x: x[0])
        students.append({
            "slug": slug,
            "name": SLUG_TO_NAME.get(slug, slug),
            "files": [name for _, name in items],
        })
    students.sort(key=lambda s: s["name"])
    return {"students": students}


def main() -> int:
    src = find_source_dir()
    if src:
        print(f"找到原始素材夾：{src.relative_to(ROOT)}")
        imported = import_from_source(src)
        print(f"匯入完成：{imported} 個新檔案\n")
    else:
        print("（沒有找到 ../六年級網站整理素材/，跳過匯入步驟）\n")

    print("掃描 inspiration/ 並重建 manifest.json …")
    manifest = build_manifest()
    INSPIRATION_DIR.mkdir(exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    total_files = sum(len(s["files"]) for s in manifest["students"])
    print(f"✓ 完成：{len(manifest['students'])} 位學長姐 / 共 {total_files} 張海報")
    print(f"  → {MANIFEST_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
