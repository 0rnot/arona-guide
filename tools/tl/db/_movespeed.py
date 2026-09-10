"""`MoveSpeed` の分母（1/100）を束で確かめる（穴 11 の「歩く速さ」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_movespeed.py

2026-09-11 00:5x の「次の一手」が挙げた 3 か所を当たる。

  1. `Battle/` に移動の定数があるか
  2. `Excel/Const*ExcelTable` に速さの分母があるか
  3. 盤の側（`GroundCommandLocateCamera.MaxCameraSpeed` は float のワールド単位/秒）と
     `RootMotionMoveWithSpeedDAO.MoveSpeed`（int）を突き合わせる

最後に、ケセド大決戦 Torment の「戦闘の始まり → 節 0 の波」の時刻を
`MoveSpeed 200 / 100` ＝ 2.0 単位/秒 で計算して出す。核の実測と比べる用。
"""
import glob
import gzip
import json
import os
import re

WORK = "/home/pebkac/arona/tl-work"
HERE = os.path.dirname(os.path.abspath(__file__))
LEN_RE = re.compile(r"Distance|Range|Speed|Scale|Height|Size|Radius", re.IGNORECASE)


def tname(o):
    return (o.get("$type") or "").split(",")[0].split(".")[-1]


def const_rows():
    for name in ("ConstCombatExcelTable", "ConstCommonExcelTable"):
        p = os.path.join(WORK, "badb", "Excel", f"{name}.json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            doc = json.load(fh)
        for r in doc.get("DataList") or []:
            yield name, r


def main():
    tree = os.path.join(WORK, "badb", "_tree.json")
    with open(tree, encoding="utf-8") as fh:
        paths = [t["path"] for t in json.load(fh).get("tree", [])]
    print("1. 倉庫の `Battle/` にあるファイル:")
    for p in sorted(p for p in paths if p.startswith("Battle/")):
        print("   ", p)
    print()

    print("2. `Const*ExcelTable` の長さ・速さに関わる欄:")
    for name, r in const_rows():
        for k in sorted(r):
            if LEN_RE.search(k):
                print(f"   {name[:24]:24s} {k:34s} {r[k]}")
    print()

    speeds = {}
    cams = {}
    for path in sorted(glob.glob(os.path.join(HERE, "boss", "*.json.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            doc = json.load(fh)

        def walk(o):
            if isinstance(o, dict):
                t = tname(o)
                if t == "RootMotionMoveWithSpeedDAO" and o.get("MoveSpeed") is not None:
                    speeds[o["MoveSpeed"]] = speeds.get(o["MoveSpeed"], 0) + 1
                if t == "GroundCommandLocateCamera" and o.get("MaxCameraSpeed") is not None:
                    cams[o["MaxCameraSpeed"]] = cams.get(o["MaxCameraSpeed"], 0) + 1
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)

        walk(doc)

    print("3. `RootMotionMoveWithSpeedDAO.MoveSpeed`（int）:",
          sorted(speeds.items(), key=lambda kv: -kv[1]))
    print("   `GroundCommandLocateCamera.MaxCameraSpeed`（float・ワールド単位/秒）:",
          sorted(cams.items(), key=lambda kv: -kv[1]))
    print()

    walk_len = 17.905 - 6.0
    print("4. ケセド大決戦 Torment（`Formations` 0 番 y 6.0 → 節 0 の目印 y 17.905）")
    print(f"   歩き {walk_len:.3f} 単位。分母ごとの「節 0 の波が湧く時刻」"
          "（歩き終わり ＋ `GroundCommandWave.WaveDelay` 3000 ms）:")
    for div in (25, 50, 100, 400):
        sp = 200 / float(div)
        print("   分母 {:3d} → {:.1f} 単位/秒 ／ 歩き終わり {:5.2f} 秒 ／ 波 {:5.2f} 秒{}".format(
            div, sp, walk_len / sp, walk_len / sp + 3.0,
            "  ← いまの読み" if div == 100 else ""))


if __name__ == "__main__":
    main()
