"""束 1 つの袋の名前と大きさを出す（2026-09-09）。

    python3 tools/tl/db/_bags.py [束]
"""
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
pkg = sys.argv[1] if len(sys.argv) > 1 else 'raid1037.json.gz'
p = os.path.join(D, 'boss', pkg)
if not os.path.exists(p):
    p = os.path.join(D, pkg)
with gzip.open(p, 'rt', encoding='utf-8') as fh:
    pk = json.load(fh)
for k, v in pk.items():
    print(k, type(v).__name__, len(v) if hasattr(v, '__len__') else v)
