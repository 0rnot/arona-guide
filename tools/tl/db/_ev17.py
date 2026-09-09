"""`Event 17`（撃ったとき）の引き金を束から数える。

    python3 tools/tl/db/_ev17.py            # 束ぜんぶの Event 17 を数える
    python3 tools/tl/db/_ev17.py <名前>      # その名前の doc を原文で出す
"""
import glob
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))


def packs():
    for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) or []:
        yield p
    for p in sorted(glob.glob(os.path.join(D, '*.json.gz'))):
        yield p


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else None
    if want is None:
        p0 = next(packs())
        pk = json.load(gzip.open(p0, 'rt', encoding='utf-8'))
        print('pack', os.path.basename(p0), 'keys', sorted(pk.keys())[:40])
        return
    for p in packs():
        pk = json.load(gzip.open(p, 'rt', encoding='utf-8'))
        for k in ('ls', 'sk', 'csl', 'le', 'ent', 'groups', 'bt', 'st'):
            t = pk.get(k)
            if isinstance(t, dict) and want in t:
                print('==', os.path.basename(p), k, want)
                print(json.dumps(t[want], ensure_ascii=False, indent=1))
                return
    print('見つからない', want)


main()
