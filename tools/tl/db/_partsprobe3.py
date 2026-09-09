"""SchaleDB の raids.json から カイテンジャー（KaitenFxMk0）のスキル説明を原文で出す。"""
import json

d = json.load(open('/home/pebkac/arona/tl-work/sd/raids.json'))
keys = list(d) if isinstance(d, dict) else []
print('top:', keys if keys else type(d))


def walk(o, path=''):
    if isinstance(o, dict):
        s = json.dumps(o, ensure_ascii=False)
        if 'KaitenFxMk0' in s and len(s) < 6000:
            print('----', path)
            print(s[:3000])
            return True
        for k, v in o.items():
            if walk(v, path + '/' + str(k)):
                return True
    elif isinstance(o, list):
        for i, v in enumerate(o):
            if walk(v, path + '/%d' % i):
                return True
    return False


walk(d)
