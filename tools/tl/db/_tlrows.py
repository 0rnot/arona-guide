"""TL の行が核へ渡る刻（`pt.tl` の `t` / `i` / `to` / `f`）を並べる。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_tlrows.py <vid> [port]

TL の「即」「敵出現」が何秒に置かれたかを、核を回さずに見る。
"""
import json
import sys

import _wave1 as W
from playwright.sync_api import sync_playwright


def main():
    vid = sys.argv[1]
    port = sys.argv[2] if len(sys.argv) > 2 else '8777'
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
        pg.evaluate("(t)=>{const D=window.__TLDBG; const p=D.parseTL(t); D.applyTL(p); D.draw();}",
                    c['text'])
        pg.wait_for_timeout(300)
        r = pg.evaluate("""()=>{const D=window.__TLDBG, st=D.st, pt=st.parties?st.parties[0]:st;
          const names=(pt.slots||pt.party||[]).map(s=>s&&(s.name||s.id||s.key));
          return {keys:Object.keys(pt), names, tl:(pt.tl||[]).map(r=>Object.assign({},r))};}""")
        b.close()
    print('keys:', r['keys'])
    print('names:', r['names'])
    for x in sorted(r['tl'], key=lambda x: x.get('t', 0)):
        print(json.dumps(x, ensure_ascii=False)[:300])
    return 0


if __name__ == '__main__':
    sys.exit(main())
