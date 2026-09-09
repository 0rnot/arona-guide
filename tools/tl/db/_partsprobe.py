"""カイテンジャーの部位（SubParts）の材料を並べる。SetMaxHPToParts の合計と MaxHP を比べる。"""
import gzip
import json
import os

PACKS = ['raid41', 'raid44', 'raid47', 'raid1041', 'raid1047', 'raid1048',
         'elim2051107', 'elim2052107']

for name in PACKS:
    f = '/home/pebkac/arona/arona-guide/tools/tl/db/boss/%s.json.gz' % name
    if not os.path.exists(f):
        continue
    d = json.load(gzip.open(f, 'rt'))
    st = dict((s['CharacterId'], s) for s in d['st'])
    for r in d['bt']:
        if r['ExternalBehavior'] != 'SetMaxHPToParts':
            continue
        btid = r['ExternalBTId']
        hp = None
        dev = '?'
        sub = None
        for e in d['ent']:
            if e.get('ExternalBTId') == btid:
                hp = st.get(e['Id'], {}).get('MaxHP1')
                dev = e['DevName']
                sub = e.get('SubPartsCount')
        arg = [int(x) for x in r['BehaviorArgument'].split(',')]
        print(name, 'P%s' % r['AIPhase'], dev, 'SubPartsCount', sub,
              'MaxHP', hp, 'parts', arg, 'sum', sum(arg))
    for r in d['bt']:
        if r['ExternalBehavior'] in ('ChangePhase', 'ForceChangePhase') or r['ExternalBTTrigger'] == 'DestroyParts':
            print('   ', name, 'P%s' % r['AIPhase'], r['ExternalBTTrigger'],
                  r['TriggerArgument'], '->', r['ExternalBehavior'], r['BehaviorArgument'])
