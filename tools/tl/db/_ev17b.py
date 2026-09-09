"""`Event 17` の持ち主と枠を洗う。

    python3 tools/tl/db/_ev17b.py owner <名前>   # その doc を持つ csl の行
    python3 tools/tl/db/_ev17b.py count          # 束ぜんぶの Event 17 の Parameters を数える
    python3 tools/tl/db/_ev17b.py csl <cid>      # その csl の行を原文で
"""
import collections
import glob
import gzip
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))


def packs():
    seen = set()
    for p in sorted(glob.glob(os.path.join(D, 'boss', '*.json.gz'))) + \
             sorted(glob.glob(os.path.join(D, '*.json.gz'))):
        b = os.path.basename(p)
        if b in seen or b == 'common.json.gz':
            continue
        seen.add(b)
        yield p


def load(p):
    return json.load(gzip.open(p, 'rt', encoding='utf-8'))


def cmd_count():
    n = collections.Counter()
    who = collections.defaultdict(set)
    for p in packs():
        pk = load(p)
        for k, doc in (pk.get('ls') or {}).items():
            if not isinstance(doc, dict):
                continue
            t = doc.get('TriggerCondition') or {}
            if t.get('Event') == 17:
                n[str(t.get('Parameters'))] += 1
                who[str(t.get('Parameters'))].add(k)
    for k in sorted(n, key=lambda x: -n[x]):
        print(k, n[k], sorted(who[k])[:12])


def cmd_owner(want):
    for p in packs():
        pk = load(p)
        csl = pk.get('csl') or {}
        for cid, rows in csl.items():
            for row in (rows if isinstance(rows, list) else [rows]):
                if want not in json.dumps(row, ensure_ascii=False):
                    continue
                print('==', os.path.basename(p), 'csl', cid,
                      'Public', json.dumps(row.get('PublicSkillGroupId'), ensure_ascii=False),
                      'Ex', json.dumps(row.get('ExSkillGroupId'), ensure_ascii=False),
                      'Passive', json.dumps(row.get('PassiveSkillGroupId'), ensure_ascii=False))


def cmd_csl(cid):
    for p in packs():
        pk = load(p)
        row = (pk.get('csl') or {}).get(cid)
        if row:
            print('==', os.path.basename(p), 'csl', cid)
            print(json.dumps(row, ensure_ascii=False, indent=1))
            return


a = sys.argv[1:]
if a and a[0] == 'count':
    cmd_count()
elif a and a[0] == 'owner':
    cmd_owner(a[1])
elif a and a[0] == 'csl':
    cmd_csl(a[1])
else:
    print(__doc__)
