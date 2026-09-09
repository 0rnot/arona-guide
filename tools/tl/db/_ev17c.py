"""名前を束ぜんぶから探す（どの表に居るか分からないとき）。

    python3 tools/tl/db/_ev17c.py <名前> [--pack raid1036]
"""
import glob
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
want = sys.argv[1]
only = None
if '--pack' in sys.argv:
    only = sys.argv[sys.argv.index('--pack') + 1]

for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
         sorted(glob.glob(os.path.join(D, '*.json.gz'))):
    b = os.path.basename(p)
    if only and only not in b:
        continue
    pk = json.load(gzip.open(p, 'rt', encoding='utf-8'))
    for tbl, t in pk.items():
        if isinstance(t, dict) and want in t:
            print('==', b, tbl, want)
            print(json.dumps(t[want], ensure_ascii=False, indent=1)[:6000])
            sys.exit(0)
print('見つからない', want, '／ 表の一覧は', sorted(pk.keys()) if 'pk' in dir() else '')
