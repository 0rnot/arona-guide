"""raid1037（ヒエロニムス Torment）の壺 2 体の枠と、その `AutoUseRule` を並べる（2026-09-09）。

`Debuff_Relic02` を配るのがどの枠かを突き止めるために足した。

    python3 tools/tl/db/_relic5.py [束]
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

for cid, rows in (pk.get('csl') or {}).items():
    for r in (rows if isinstance(rows, list) else [rows]):
        print(cid, r.get('FormIndex'), 'NS', r.get('NormalSkillGroupId'),
              'PS', r.get('PublicSkillGroupId'), 'PASSIVE', r.get('PassiveSkillGroupId'))
print()
for k, doc in (pk.get('ls') or {}).items():
    r = (doc or {}).get('AutoUseRule')
    print(k, json.dumps(r, ensure_ascii=False) if isinstance(r, dict) and r.get('IsValid') else '-')
print()
for row in pk.get('le') or []:
    if isinstance(row, dict) and 'Relic02' in str(row.get('TemplateId')):
        print('le', row.get('GroupId'), row.get('TemplateId'), row.get('$type'))
