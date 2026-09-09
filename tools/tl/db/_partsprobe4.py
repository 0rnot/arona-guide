"""SchaleDB raids.json の RaidSkills から カイテンジャーの技の説明を原文で出す。"""
import json

d = json.load(open('/home/pebkac/arona/tl-work/sd/raids.json'))
sk = d['RaidSkills']
print(type(sk), len(sk))
for r in (sk if isinstance(sk, list) else sk.values()):
    s = json.dumps(r, ensure_ascii=False)
    if 'Kaiten' in s:
        print(s[:1200])
        print()
