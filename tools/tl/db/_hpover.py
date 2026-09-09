"""`AutoUseRule.ConditionType == 'HpOver'` の全実体を並べる（2026-09-09）。

    python3 tools/tl/db/_hpover.py
"""
import collections
import glob
import gzip
import json
import os

D = os.path.dirname(os.path.abspath(__file__))
seen = set()
rows = collections.defaultdict(list)
docs = {}
for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
         sorted(glob.glob(os.path.join(D, '*.json.gz'))):
    b = os.path.basename(p)
    if b in seen or b == 'common.json.gz':
        continue
    seen.add(b)
    with gzip.open(p, 'rt', encoding='utf-8') as fh:
        pk = json.load(fh)
    for k, doc in (pk.get('ls') or {}).items():
        if not isinstance(doc, dict):
            continue
        r = doc.get('AutoUseRule')
        if isinstance(r, dict) and r.get('IsValid') and str(r.get('ConditionType')) == 'HpOver':
            rows[k].append(b)
            docs.setdefault(k, doc)

for k in sorted(rows):
    d = docs[k]
    print(k, len(rows[k]), rows[k][:4])
    print('   AutoUseRule', json.dumps(d.get('AutoUseRule'), ensure_ascii=False))
    print('   keys', sorted(x for x in d if x != 'AutoUseRule'))
