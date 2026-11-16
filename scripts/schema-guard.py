#!/usr/bin/env python3
"""ツールが読んでいる公開データの「形」を見張る。**値ではなく形。**

    python3 scripts/schema-guard.py          # 比べて、変わっていれば記録を書き足す
    python3 scripts/schema-guard.py --init   # 今の形を基準として保存するだけ

**なぜ要るか。** 2026-10-28 のゲーム更新で ba-data の `GroundExcelTable.StageTopography` が
文字列から配列になり、`build-tool-data.py` が 19 日間落ち続けた。さらに配列の中身は部屋（フェーズ）
ごとの地形で、悪夢急行だけ途中で地形が変わる——**落ちなければ誰も気づかない種類の仕様変更**だった。
数字が合っているかは builder の検査が見ている。ここが見るのは、その検査が想定していない変化:

- 欄が増えた・消えた（`ExtraRoomLifeTime` が足された、など）
- 欄の型が変わった（文字列 → 配列、など）
- 列挙の値が増えた・消えた（`ArmorType` に新しい装甲、`SubCategory` に新しい家具の種類、など）。
  英字の識別子だけで、種類が 40 以下の欄を列挙とみなす

行数は見ない（生徒や家具は毎回増えるので、知らせても意味が無い）。

**読む先は build-tool-data.py から機械的に拾う**（`BADB.format("…")` `BA.format("…")` `SD.format("…")`
と `SD_CFG` `SD_GROUPS`）。builder が読む表を増やせば、ここも勝手に追随する。

結果:
- `scripts/schema.json` — 今の形（次回の比較の基準）
- `scripts/schema-changes.md` — 変わったときだけ、日付つきで先頭に書き足す。
  **毎日の利用レポート（クラウドの arona-usage-report）がこの先頭を読んで知らせる**
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "build-tool-data.py"
SNAP = ROOT / "scripts" / "schema.json"
LOG = ROOT / "scripts" / "schema-changes.md"

BA = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/{}.json"
BADB = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/DB/{}.json"
SD = "https://schaledb.com/data/jp/{}.min.json"
SD_CFG = "https://schaledb.com/data/config.json"
SD_GROUPS = "https://schaledb.com/data/groups.min.json"

ENUM_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
ENUM_MAX = 40
# 数字だけの鍵（SchaleDB の students は `{"10000": {...}}` の形）は 1 つにまとめる
NUMKEY = re.compile(r"^-?\d+$")


def sources():
    s = SRC.read_text(encoding="utf-8")
    out = {}
    for t in sorted(set(re.findall(r'BADB\.format\("([A-Za-z0-9]+)"\)', s))):
        out["DB/" + t] = BADB.format(t)
    for t in sorted(set(re.findall(r'\bBA\.format\("([A-Za-z0-9]+)"\)', s))):
        out["Excel/" + t] = BA.format(t)
    for t in sorted(set(re.findall(r'\bSD\.format\("([A-Za-z0-9_-]+)"\)', s))):
        out["SchaleDB/" + t] = SD.format(t)
    out["SchaleDB/config"] = SD_CFG
    out["SchaleDB/groups"] = SD_GROUPS
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "arona-guide-schema-guard"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def shape(data):
    """{パス: {"t": [型...], "e": [列挙の値...] or None}}"""
    types, strs = {}, {}

    def walk(v, p):
        if isinstance(v, dict):
            types.setdefault(p, set()).add("obj")
            for k, x in v.items():
                walk(x, p + "." + ("#" if NUMKEY.match(str(k)) else str(k)))
        elif isinstance(v, list):
            types.setdefault(p, set()).add("list")
            for x in v:
                walk(x, p + "[]")
        else:
            t = "null" if v is None else type(v).__name__
            types.setdefault(p, set()).add(t)
            if isinstance(v, str):
                strs.setdefault(p, set()).add(v)

    walk(data, "")
    out = {}
    for p, ts in types.items():
        e = None
        vs = strs.get(p)
        if vs and len(vs) <= ENUM_MAX and all(ENUM_RE.match(x) for x in vs):
            e = sorted(vs)
        # null は「欄はあるが空」なので、他の型と並んでいるときは数えない（空の行が増減するたびに鳴る）
        t = sorted(ts - {"null"}) or ["null"]
        out[p] = {"t": t, "e": e}
    return out


def diff(old, new):
    lines = []
    for p in sorted(set(new) - set(old)):
        lines.append(f"欄が増えた `{p}`（{'/'.join(new[p]['t'])}）")
    for p in sorted(set(old) - set(new)):
        lines.append(f"欄が消えた `{p}`")
    for p in sorted(set(old) & set(new)):
        a, b = old[p], new[p]
        if a["t"] != b["t"] and "null" not in a["t"] + b["t"]:
            lines.append(f"型が変わった `{p}`: {'/'.join(a['t'])} → {'/'.join(b['t'])}")
        if a["e"] is not None and b["e"] is not None:
            add = sorted(set(b["e"]) - set(a["e"]))
            rem = sorted(set(a["e"]) - set(b["e"]))
            if add:
                lines.append(f"値が増えた `{p}`: {', '.join(add)}")
            if rem:
                lines.append(f"値が消えた `{p}`: {', '.join(rem)}")
    return lines


def main():
    init = "--init" in sys.argv
    old = json.loads(SNAP.read_text(encoding="utf-8")) if SNAP.exists() else {}
    new, report, failed = {}, [], []
    for name, url in sources().items():
        try:
            new[name] = shape(fetch(url))
        except Exception as e:  # noqa: BLE001 — 取れないものは前の形を残す（取れなかっただけで「消えた」と言わない）。通信も JSON も何で落ちても扱いは同じ
            failed.append(f"{name}: {e}")
            if name in old:
                new[name] = old[name]
            continue
        if not init and name in old:
            d = diff(old[name], new[name])
            if d:
                report.append((name, d))
        elif not init and name not in old and old:
            report.append((name, ["新しく読むようになった表（基準なし）"]))
    SNAP.write_text(json.dumps(new, ensure_ascii=False, sort_keys=True, indent=0) + "\n", encoding="utf-8")
    for f in failed:
        print(f"::warning::schema-guard: 取れなかった {f}")
    if init or not report:
        print(f"schema-guard: {len(new)} 個の形を確かめた。変化なし" + ("（基準を保存）" if init else ""))
        return
    today = datetime.date.today().isoformat()
    body = [f"## {today}", ""]
    n = 0
    for name, d in report:
        body.append(f"- **{name}**")
        for x in d:
            body.append(f"  - {x}")
            n += 1
    body.append("")
    head = "# ツールが読むデータの形の変化\n\n新しいものが上。`scripts/schema-guard.py` が書く。**変化を見たら、その表を読む builder と画面を確かめる。**\n\n"
    prev = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    prev = prev.split("\n## ", 1)
    rest = ("## " + prev[1]) if len(prev) > 1 else ""
    LOG.write_text(head + "\n".join(body) + "\n" + rest, encoding="utf-8")
    print(f"::warning::schema-guard: データの形が {n} か所変わった（scripts/schema-changes.md）")
    for name, d in report:
        for x in d:
            print(f"  {name}: {x}")


if __name__ == "__main__":
    main()
