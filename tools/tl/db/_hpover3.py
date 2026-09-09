"""束のどこに（どのファイルのどの袋に）その名前があるかを探す（2026-09-09）。

`Hieronymus_Relic_Public01_Effect01` を探したときに `ls` に無いと分かったので足した。
**袋は dict とは限らない**——`ls` / `ground` / `stage` / `board` / `csl` は dict、
`le`（効果）／ `sk` / `bt` / `ent` / `st` / `phase` / `groups` は list（`_bags.py`）。

    python3 tools/tl/db/_hpover3.py Hieronymus_Relic_Public01_Effect
"""
import glob
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
want = sys.argv[1] if len(sys.argv) > 1 else 'Hieronymus_Relic_Public01_Effect'

seen = set()
for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
         sorted(glob.glob(os.path.join(D, '*.json.gz'))):
    b = os.path.basename(p)
    if b in seen:
        continue
    seen.add(b)
    with gzip.open(p, 'rt', encoding='utf-8') as fh:
        pk = json.load(fh)
    for bag, d in pk.items():
        if isinstance(d, dict):
            hit = [k for k in d if want in str(k)]
            if hit:
                print(b, bag, sorted(hit)[:8])
        elif isinstance(d, list):
            hit = [(row.get('GroupId') or row.get('name'))
                   for row in d
                   if isinstance(row, dict) and want in json.dumps(row, ensure_ascii=False)]
            if hit:
                print(b, bag, hit[:8])
