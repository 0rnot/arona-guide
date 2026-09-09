"""ある効果群（`LogicEffectGroupIds`）を撃つ枠を探す（2026-09-09）。

    python3 tools/tl/db/_relic6.py raid1037.json.gz Hieronymus_Insane_Relic_Public05_Effect02
"""
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
pkg = sys.argv[1] if len(sys.argv) > 1 else 'raid1037.json.gz'
want = sys.argv[2] if len(sys.argv) > 2 else 'Hieronymus_Insane_Relic_Public05_Effect02'
p = os.path.join(D, 'boss', pkg)
if not os.path.exists(p):
    p = os.path.join(D, pkg)
with gzip.open(p, 'rt', encoding='utf-8') as fh:
    pk = json.load(fh)
for bag in ('ls', 'ground', 'stage', 'board'):
    d = pk.get(bag)
    if not isinstance(d, dict):
        continue
    for k, doc in d.items():
        if want in json.dumps(doc, ensure_ascii=False):
            print(bag, k)
for bag in ('le', 'sk', 'bt', 'ent', 'st', 'phase', 'groups'):
    for i, row in enumerate(pk.get(bag) or []):
        if want in json.dumps(row, ensure_ascii=False):
            gid = row.get('GroupId') if isinstance(row, dict) else None
            print(bag, i, gid)
