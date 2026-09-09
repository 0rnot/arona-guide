"""`HieronymusInsaneRelicPublic01` の中身を原文で出す（2026-09-09）。

    python3 tools/tl/db/_hpover2.py [束] [枠名]
"""
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
pkg = sys.argv[1] if len(sys.argv) > 1 else 'raid1037.json.gz'
key = sys.argv[2] if len(sys.argv) > 2 else 'HieronymusInsaneRelicPublic01'
p = os.path.join(D, 'boss', pkg)
if not os.path.exists(p):
    p = os.path.join(D, pkg)
with gzip.open(p, 'rt', encoding='utf-8') as fh:
    pk = json.load(fh)
doc = (pk.get('ls') or {}).get(key)
print(json.dumps(doc, ensure_ascii=False, indent=1))
