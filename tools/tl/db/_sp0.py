"""節 0 / 1 の湧き点と事象を原文で出す（穴 11 の「節 0 を掃く 22 秒」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_sp0.py [盤の名前の一部] [節の数]

`_wave0.py` は `GroundCommandWave` だけを出す。こちらは**湧き点そのもの**
（`CommandIdList` ／ `SpawnTemplateId` ／ 位置 ／ 遅れ）を並べる。
節 0 の波 2 が核では 24.7 → 50.9 秒かかるのに動画は 21.4 → 28.6 秒で片付く、
その差が「遅れて湧く組」なのかを見るため。
"""
import glob
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def tname(o):
    return (o.get("$type") or "").split(",")[0].split(".")[-1]


def brief(o, n=300):
    return json.dumps({k: v for k, v in o.items() if k != "$type"}, ensure_ascii=False)[:n]


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else "chesed_outdoor_elasticarmor_torment"
    nsec = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    for path in sorted(glob.glob(os.path.join(HERE, "boss", "*.json.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            doc = json.load(fh)
        for name, bd in (doc.get("board") or {}).items():
            if want not in name:
                continue
            print("盤", name)
            for si, sec in enumerate(bd.get("Sections") or []):
                if si > nsec:
                    continue
                print("=== 節", si)
                for g in sec.get("EnemySpawnPointGroupList") or []:
                    print("   組", g.get("GroupName") or g.get("Name") or "")
                    for sp in g.get("SpawnPoints") or []:
                        sd = sp.get("SpawnData") or {}
                        if not sd.get("SpawnTemplateId") and sp.get("SpawnList"):
                            sd = (sp["SpawnList"][0] or {}).get("SpawnData") or {}
                        print("      SP cmds={} dev={} delay={} appear={} pos={}".format(
                            sp.get("CommandIdList"), sd.get("SpawnTemplateId"),
                            sp.get("Delay"), sd.get("AppearAction"), sp.get("Position")))
                for ev in sec.get("Events") or []:
                    print("   EV", ev.get("EventName"))
                    for c in ev.get("Conditions") or []:
                        print("      c", tname(c), brief(c, 200))
                    for c in ev.get("Commands") or []:
                        print("      m", tname(c), brief(c, 300))
            return 0
    print("見つからない:", want)
    return 1


if __name__ == "__main__":
    sys.exit(main())
