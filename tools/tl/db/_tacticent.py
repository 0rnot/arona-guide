"""`TacticEntityConditionalModifierDAO` を束ぜんぶで数える（2026-09-09）。

`TacticEntity` の番号が何を指すのかを、**その門が付いている枠の飛び先**と
突き合わせて決めるための道具。

    python3 tools/tl/db/_tacticent.py
"""
import collections
import glob
import gzip
import json
import os

D = os.path.dirname(os.path.abspath(__file__))

cnt = collections.Counter()
where = collections.defaultdict(list)
kinds = collections.Counter()


def walk(node, path, pkg):
    if isinstance(node, dict):
        t = str(node.get('$type') or '')
        if 'TacticEntityConditionalModifierDAO' in t:
            c = node.get('Constraint') or {}
            key = (c.get('TacticEntity'), c.get('IncludeType'), node.get('CheckTarget'))
            cnt[key] += 1
            if len(where[key]) < 6:
                where[key].append('%s %s' % (pkg, path))
        for k, v in node.items():
            walk(v, path + '/' + k if len(path) < 120 else path, pkg)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, path, pkg)


for p in sorted(glob.glob(os.path.join(D, '*.json.gz')) + glob.glob(os.path.join(D, 'boss', '*.json.gz'))):
    with gzip.open(p, 'rt', encoding='utf-8') as fh:
        pk = json.load(fh)
    name = os.path.basename(p).replace('.json.gz', '')
    for bag in ('ls', 'ground', 'stage', 'board', 'le', 'sk', 'bt', 'ent', 'st', 'phase', 'groups'):
        d = pk.get(bag)
        if isinstance(d, dict):
            for k, doc in d.items():
                walk(doc, bag + ':' + k, name)
        elif isinstance(d, list):
            for row in d:
                walk(row, bag, name)
    for row in pk.get('ent') or []:
        if isinstance(row, dict) and row.get('TacticEntityType'):
            kinds[row['TacticEntityType']] += 1

print('TacticEntity / IncludeType / CheckTarget  → 件数')
for key, n in cnt.most_common():
    print('  %s  %d' % (key, n))
    for w in where[key]:
        print('       ', w)
print('')
print('束に出てくる TacticEntityType（体の側）:', dict(kinds))
