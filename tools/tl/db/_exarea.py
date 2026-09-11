"""範囲技がどこに落ちて、誰が入って誰が外れたかを並べる（穴 11 の「節 0 の奥のドローン」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_exarea.py <vid> [who] [seed] [port] [lo] [hi]

`areaLog`（`run.js` の `probe` のときだけ積む）の 1 行を
`[刻, 撃った子, 札, 形, 置き方, 半径, 中心, 当たった体, 候補の体と座標]` の順で出す。
`who` は撃った子の鍵（`a2` など）。`-` なら全員。
"""
import json
import sys

import _wave1 as W
from playwright.sync_api import sync_playwright

JS = W.JS.replace("missLog: r.missLog}",
                  "missLog: r.missLog, areaLog: r.areaLog, moveLog: r.moveLog, allyStats: r.allyStats}")


def main():
    vid = sys.argv[1]
    who = sys.argv[2] if len(sys.argv) > 2 else '-'
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    port = sys.argv[4] if len(sys.argv) > 4 else '8777'
    lo = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    hi = float(sys.argv[6]) if len(sys.argv) > 6 else 30.0
    row = next(r for r in W.T.usable() if r['vid'] == vid)
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
        pg.select_option('#i-boss', index=W.recon3.branch(opts, row['boss'], row['ter']))
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
    # 味方の立ち位置と体の大きさ（`allyStats` の最後の欄が半径）
    for a in (r.get('allyStats') or []):
        print('味方', a)
    for m in (r.get('moveLog') or []):
        if who == '-' or m[1] == who:
            print('歩き', m)
    for a in (r.get('areaLog') or []):
        t = a[0] / 1000
        if not (lo <= t <= hi) or (who != '-' and a[1] != who):
            continue
        hit = set(a[7])
        print(f'{t:7.2f} {a[1]:3} {a[2]:34} {a[3]} {a[4]} r={a[5]} 中心 {a[6]} 当たり {len(hit)}/{len(a[8])}')
        for k, p in a[8]:
            print(f'          {"●" if k in hit else "○"} {k:16} {p}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
