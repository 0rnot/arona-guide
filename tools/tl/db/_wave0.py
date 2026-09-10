"""節 0 の波の合図と `GroundCommandWave` を原文で出す（穴 11 の「歩く速さ」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_wave0.py [盤の名前の一部]

`GroundConditionArea` の帯（中心 z と厚み）と `Waves[]` の `WaveDelay` を並べる。
味方が帯に**入る**のは「中心 − 厚み/2」で、隊列の目印（`Formations`）は帯の中心。
"""
import glob
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def tname(o):
    return (o.get("$type") or "").split(",")[0].split(".")[-1]


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else "chesed_outdoor_elasticarmor_torment"
    for path in sorted(glob.glob(os.path.join(HERE, "boss", "*.json.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            doc = json.load(fh)
        for name, bd in (doc.get("board") or {}).items():
            if want not in name:
                continue
            print("盤", name)
            fms = [f for f in (bd.get("Formations") or []) if not f.get("IsEnemy")]
            for f in fms:
                print("   F", f.get("SectionIndex"), f.get("Index"), f.get("Position"))
            for si, sec in enumerate(bd.get("Sections") or []):
                for ev in sec.get("Events") or []:
                    cs, cm = ev.get("Conditions") or [], ev.get("Commands") or []
                    if not any(tname(c) == "GroundCommandWave" for c in cm):
                        continue
                    print("   節", si, "事象", ev.get("EventName"))
                    for c in cs:
                        print("      cond", tname(c), json.dumps(
                            {k: v for k, v in c.items() if k != "$type"}, ensure_ascii=False)[:240])
                    for c in cm:
                        if tname(c) != "GroundCommandWave":
                            continue
                        for w in c.get("Waves") or []:
                            print("      Wave", json.dumps(w, ensure_ascii=False)[:240])
            return 0
    print("見つからない:", want)
    return 1


if __name__ == "__main__":
    sys.exit(main())
