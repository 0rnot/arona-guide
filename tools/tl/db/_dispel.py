"""`DispelLogicEffectTemplateEffectDAO` の欄を束ぜんぶで数える。

    python3 tools/tl/db/_dispel.py
"""
import collections
import glob
import gzip
import json
import os

D = os.path.dirname(os.path.abspath(__file__))
n = 0
fields = collections.Counter()
vals = collections.Counter()
seen = set()
for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
         sorted(glob.glob(os.path.join(D, '*.json.gz'))):
    b = os.path.basename(p)
    if b in seen or b == 'common.json.gz':
        continue
    seen.add(b)
    pk = json.load(gzip.open(p, 'rt', encoding='utf-8'))
    for e in (pk.get('le') or []):
        if not isinstance(e, dict):
            continue
        if 'DispelLogicEffectTemplate' not in str(e.get('$type')):
            continue
        n += 1
        for k in e:
            fields[k] += 1
        vals[(e.get('GroupId'), e.get('LogicEffectTemplateToDispel'),
              e.get('DispelCount'), e.get('TemplateId'))] += 1
print('件数', n)
print('欄', dict(fields))
print()
for k in sorted(vals):
    print(k, vals[k])
