"""`le`（効果の並び）から名前で引く（2026-09-09）。`le` は dict ではなく list。

    python3 tools/tl/db/_hpover4.py raid1037.json.gz Hieronymus_Relic_Public01_Effect
"""
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
pkg = sys.argv[1] if len(sys.argv) > 1 else 'raid1037.json.gz'
want = sys.argv[2] if len(sys.argv) > 2 else 'Hieronymus_Relic_Public01_Effect'
p = os.path.join(D, 'boss', pkg)
if not os.path.exists(p):
    p = os.path.join(D, pkg)
with gzip.open(p, 'rt', encoding='utf-8') as fh:
    pk = json.load(fh)
for bag in ('le', 'sk', 'ent', 'st', 'bt'):
    for row in pk.get(bag) or []:
        s = json.dumps(row, ensure_ascii=False)
        if want in s:
            print('==', bag, (row.get('GroupId') if isinstance(row, dict) else None))
            print(s[:900])
