"""戦闘の始まりから節 0 の終わりまでを 1 件ずつ並べる（穴 11 の「歩く速さ」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_walk.py <vid> [seed] [port]

`_sec1.py` と同じ入口だが、**窓を 0〜60 秒にして `moveLog` も出す。**
`Formations` の 0 番（戦闘前の置き場）を入れたら節 0 の終わりが 36.8 → 50.9 秒に
なった（歩きは 6.0 秒ぶんしか足していないのに +14.1 秒）ので、
その差がどこで生まれるかを見る。
"""
import json
import os
import sys

WORK = "/home/pebkac/arona/tl-work"
os.chdir(WORK)
sys.path.insert(0, WORK)

import recon3
import truth_score as T
from playwright.sync_api import sync_playwright

JS = r"""
async ([key, dur, seed]) => {
  const D = window.__TLDBG, st = D.st;
  const M = await import('/tools/tl/js/sim/bridge.js');
  const L = M.makeLoader('/tools/tl/db');
  const r = await M.simParty({load: L, st, pi: 0, key, dur, seed: seed || undefined,
                              probe: true});
  return {secLog: r.secLog, deaths: r.deaths, evLog: r.evLog, moveLog: r.moveLog,
          names: r.names, killLog: r.killLog};
}
"""


def main():
    vid = sys.argv[1]
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    port = sys.argv[3] if len(sys.argv) > 3 else '8777'
    lo = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    hi = float(sys.argv[5]) if len(sys.argv) > 5 else 60.0
    row = next(r for r in T.usable() if r['vid'] == vid)
    with open('cases.json', encoding='utf-8') as fh:
        cases = json.load(fh)
    c = {x['vid']: x for v in cases.values() for x in v}[vid]
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--disable-dev-shm-usage'])
        pg = b.new_page()
        pg.goto(f'http://127.0.0.1:{port}/tools/tl/?all=1', wait_until='networkidle')
        pg.evaluate("localStorage.setItem('arona-tour-tl','1')")
        pg.reload(wait_until='networkidle')
        pg.wait_for_function('!!window.__TLDBG', timeout=60000)
        opts = pg.evaluate("()=>[].slice.call(document.getElementById('i-boss').options)"
                           ".map(x=>x.textContent)")
        pg.select_option('#i-boss', index=recon3.branch(opts, row['boss'], row['ter']))
        pg.wait_for_timeout(150)
        di = pg.evaluate("(df)=>[].slice.call(document.getElementById('i-diff').options)"
                         ".findIndex(x=>x.textContent.indexOf(df)>=0)", 'Torment')
        pg.select_option('#i-diff', index=di)
        pg.wait_for_timeout(150)
        if row.get('arm'):
            ok = pg.evaluate("(a)=>[].slice.call(document.getElementById('i-armor').options)"
                             ".some(o=>o.value===a)", row['arm'])
            if ok:
                pg.select_option('#i-armor', row['arm'])
                pg.wait_for_timeout(150)
        pg.evaluate("(t)=>{const D=window.__TLDBG; const p=D.parseTL(t); D.applyTL(p); D.draw();}",
                    c['text'])
        pg.wait_for_timeout(300)
        r = pg.evaluate(JS, [row['stage'], row['dur'], seed])
        b.close()
    print('節:', r['secLog'][:12])
    print('moveLog:', json.dumps(r['moveLog'], ensure_ascii=False)[:1200])
    ev = [(e[0], 'ev', e[1], e[2] if len(e) > 2 else '') for e in (r['evLog'] or [])]
    de = [(d[0] / 1000, 'die', d[1], '') for d in (r['deaths'] or [])]
    rows = sorted(ev + de, key=lambda x: x[0])
    for t, kind, a, bb in rows:
        if lo <= t <= hi:
            print(f'{t:8.2f} {kind} {a} {bb}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
