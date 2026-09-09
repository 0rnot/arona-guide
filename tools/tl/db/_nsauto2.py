"""束ぜんぶの `AutoUseRule.ConditionType` を数える（通常スキルの自動発動）。

    python3 tools/tl/db/_nsauto2.py
    python3 tools/tl/db/_nsauto2.py HpUnder     # その型の中身を並べる
"""
import collections
import glob
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
want = sys.argv[1] if len(sys.argv) > 1 else None

n = collections.Counter()
rows = []
seen = set()
for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
         sorted(glob.glob(os.path.join(D, '*.json.gz'))):
    b = os.path.basename(p)
    if b in seen or b == 'common.json.gz':
        continue
    seen.add(b)
    pk = json.load(gzip.open(p, 'rt', encoding='utf-8'))
    for k, doc in (pk.get('ls') or {}).items():
        if not isinstance(doc, dict):
            continue
        r = doc.get('AutoUseRule')
        if not isinstance(r, dict) or not r.get('IsValid'):
            continue
        ct = str(r.get('ConditionType'))
        n[ct] += 1
        if want and ct == want and k not in [x[0] for x in rows]:
            rows.append((k, b, r.get('ConditionArgument'), r.get('ConditionCheckTarget'),
                         r.get('TryCount'), r.get('MaxTriggerCount'), r.get('TriggerRate')))

for k in sorted(n, key=lambda x: -n[x]):
    print(k, n[k])
if want:
    print()
    print('名前 / 束 / ConditionArgument / CheckTarget / TryCount / MaxTriggerCount / TriggerRate')
    for r in rows:
        print(' '.join(str(x) for x in r))
