"""`BossCharacterId` が 2 つある面で、2 本目の木も回っているか見る。

    ./venv/bin/python _treechk.py B7GPFRbI1vk --grep Kuro

出すもの: `used` のうち名前に `--grep` を含む枠と、`bossErr`。
"""
import argparse
import json
import os
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.path.insert(0, '/home/pebkac/arona/tl-work')

import recon3
import truth_score as T
from playwright.sync_api import sync_playwright

JS = r"""
async ([key, dur]) => {
  const D = window.__TLDBG, st = D.st;
  const M = await import('/tools/tl/js/sim/bridge.js');
  const L = M.makeLoader('/tools/tl/db');
  const r = await M.simParty({load: L, st, pi: 0, key: key, dur: dur, seed: 0});
  const n = {};
  for (const u of (r.used || [])) { n[u.gid] = (n[u.gid] || 0) + 1; }
  return {killAt: r.killAt, miss: r.miss, used: n, maxHp: r.maxHp,
          bossErr: r.bossErr, bossKeys: r.bossKeys,
          end: r.hp.length ? r.hp[r.hp.length - 1][1] : null};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('vid')
    ap.add_argument('--grep', default='')
    ap.add_argument('--url', default=recon3.URL)
    A = ap.parse_args()
    row = {r['vid']: r for r in T.usable()}[A.vid]
    with open('cases.json', encoding='utf-8') as fh:
        cases = json.load(fh)
    c = {x['vid']: x for v in cases.values() for x in v}[A.vid]
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--disable-dev-shm-usage'])
        pg = b.new_page()
        pg.goto(A.url, wait_until='networkidle')
        pg.evaluate("localStorage.setItem('arona-tour-tl','1')")
        pg.reload(wait_until='networkidle')
        pg.wait_for_function('!!window.__TLDBG', timeout=60000)
        pg.wait_for_timeout(400)
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
        p = pg.evaluate("(t)=>{const D=window.__TLDBG; const q=D.parseTL(t);"
                        " if(q.err) return q; D.applyTL(q); D.draw(); return q;}", c['text'])
        if p.get('err'):
            print('TL が読めない:', p['err'])
            return 1
        pg.wait_for_timeout(300)
        m = pg.evaluate(JS, [row['stage'], row['dur']])
        b.close()
    print(f"{A.vid} {row['stage']} killAt {m['killAt']} 残り {m['end']} / {m['maxHp']}")
    print('bossKeys:', m.get('bossKeys'))
    print('bossErr:', m.get('bossErr'))
    used = m['used'] or {}
    hit = {k: v for k, v in used.items() if not A.grep or A.grep in k}
    print(f"used のうち {A.grep!r} を含む枠:", hit)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
