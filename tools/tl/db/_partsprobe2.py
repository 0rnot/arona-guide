"""カイテンジャーの部位まわりのスキル説明文を原文で出す。"""
import json

DB = '/home/pebkac/arona/tl-work/badata-repo/Excel/'


def rows(name):
    d = json.load(open(DB + name))
    if isinstance(d, list):
        return d
    for v in d.values():
        if isinstance(v, list):
            return v
    return []


csl = rows('CharacterSkillListExcelTable.json')
loc = {}
for r in rows('LocalizeSkillExcelTable.json'):
    loc[r.get('Key')] = r

want = [c for c in csl if 'KaitenFxMk0' in str(c.get('CharacterSkillListGroupId', ''))
        or 'KaitenFxMk0' in json.dumps(c)]
seen = set()
for c in want:
    for k in ('ExSkillGroupId', 'PublicSkillGroupId', 'PassiveSkillGroupId',
              'ExtraPassiveSkillGroupId', 'NormalSkillGroupId', 'HiddenPassiveSkillGroupId'):
        for g in (c.get(k) or []):
            if not g or g in seen or 'Kaiten' not in str(g):
                continue
            seen.add(g)
            l = loc.get(g)
            if not l:
                continue
            print(g, '|', l.get('NameJp') or l.get('NameKr'), '|',
                  (l.get('DescriptionJp') or l.get('DescriptionKr') or '').replace('\n', ' '))
