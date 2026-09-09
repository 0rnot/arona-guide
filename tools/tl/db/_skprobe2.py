"""シロクロ Torment の EX の格子（`ShiroTormentEx01` / `Ex02`）の体を並べる。"""
import gzip
import json
import re
import sys

KEY = sys.argv[1] if len(sys.argv) > 1 else 'ShiroTormentEx01'
with gzip.open('/home/pebkac/arona/arona-guide/tools/tl/db/boss/elim2023407.json.gz') as fh:
    d = json.load(fh)
s = json.dumps(d['ls'][KEY], ensure_ascii=False)

FIELDS = ('"$type"', '"name"', '"EntityName"', '"Radius"', '"Width"', '"Height"',
          '"SpawnPositionType"', '"SpawnWorldPosition"', '"PositionOffset"',
          '"TargetingType"', '"MaxTargetCount"', '"ApplyEntityType"', '"TargetSide"',
          '"OverrideTargetingRule"', '"HitFrames"', '"Duration"', '"StartDelay"')

for m in re.finditer(r'"LogicEffectGroupIds": \["Shiro_Torment_Ex_Effect01_Step01"', s):
    seg = s[max(0, m.start() - 1800):m.start() + 2600]
    print('===', m.start())
    for f in FIELDS:
        for mm in re.finditer(re.escape(f) + r': [^,}]*[}]?', seg):
            print('  ', mm.group(0)[:140])
