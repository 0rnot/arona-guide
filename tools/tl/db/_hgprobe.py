"""1 発の掛け算の中身を、撃った子ごとに並べる（穴 11 の「HG の 2 人が AR の 10 分の 1」）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_hgprobe.py <vid> [seed] [port] [lo] [hi]

`_wave1.py` は 1 発の点数だけを出す。こちらは `probe` の最後の欄
（`eff` / `terr` / `hit` / `rate` / `crit` / `base` / `parts`）まで出して、
同じ相手に撃った 1 発のどの掛け算が小さいのかを見る。
"""
import json
import sys

import _wave1 as W
from playwright.sync_api import sync_playwright


def main():
    vid = sys.argv[1]
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    port = sys.argv[3] if len(sys.argv) > 3 else '8777'
    lo = float(sys.argv[4]) if len(sys.argv) > 4 else 8.0
    hi = float(sys.argv[5]) if len(sys.argv) > 5 else 27.0
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
        r = pg.evaluate(W.JS, [row['stage'], row['dur'], seed])
        b.close()
    seen = {}
    for p in (r['probe'] or []):
        if len(p) < 15 or isinstance(p[0], str) or not str(p[1]).startswith('a'):
            continue
        t = p[4] / 1000
        if not (lo <= t <= hi):
            continue
        k = (p[1], p[2], p[3])
        seen[k] = seen.get(k, 0) + 1
        if seen[k] > 2:
            continue
        print(f'{t:7.2f} {p[1]:3} {p[2]:6} {p[3]:34} 点 {p[0]:>7} 相手 {p[12]:14} '
              f'scale {p[5]} mul {p[6]} atk {p[7]} 比 {p[8]}')
        print('        ', json.dumps(p[14], ensure_ascii=False))
    # 窓の中で誰がどの枠で何点入れたか（相手の種類ごと）
    tot = {}
    for p in (r['probe'] or []):
        if len(p) < 14 or isinstance(p[0], str) or not str(p[1]).startswith('a'):
            continue
        if lo <= p[4] / 1000 <= hi:
            k = (p[1], p[2], str(p[12]).split('#')[0])
            n, s = tot.get(k, (0, 0))
            tot[k] = (n + 1, s + p[0])
    for k in sorted(tot):
        print(f'計 {k[0]:3} {k[1]:6} {k[2]:14} {tot[k][0]:>4} 発 {tot[k][1]:>9}')
    # 体: [key, dev, side, alive, maxHp, hp, def, atk]
    for u in (r['units'] or []):
        if str(u[0]).startswith('a') or '#' not in str(u[0]):
            print('体', u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
