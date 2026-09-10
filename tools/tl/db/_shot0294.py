# CH0294 の通常攻撃の 1 発の取り分を見る（穴 10 の 0.070 を 1 発ずつ）
import gzip, json, sys

pk = json.loads(gzip.open('/home/pebkac/arona/arona-guide/tools/tl/db/s10122.json.gz', 'rt', encoding='utf-8').read())
what = sys.argv[1] if len(sys.argv) > 1 else 'sk'
key = sys.argv[2] if len(sys.argv) > 2 else 'CH0294Normal01'
v = pk[what]
if isinstance(v, dict):
    print('keys:', [k for k in v if key in k] or list(v)[:40])
    for k in v:
        if key in k:
            print('--', k)
            print(json.dumps(v[k], ensure_ascii=False)[:6000])
else:
    print('list len', len(v))
    for r in v:
        s = json.dumps(r, ensure_ascii=False)
        if key in s:
            print(s[:6000])
