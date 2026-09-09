"""シロクロ（穴 10）が盤のどこで止まっているかを見る。

    ./venv/bin/python tools/tl/db/_skprobe.py <vid> [--seed 0]

出すもの: `secLog`（入った節と刻）、体ごとの残り HP、`used` の枠、`miss`。
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
async ([key, dur, seed]) => {
  const D = window.__TLDBG, st = D.st;
  const M = await import('/tools/tl/js/sim/bridge.js');
  const L = M.makeLoader('/tools/tl/db');
  const r = await M.simParty({load: L, st, pi: 0, key: key, dur: dur, seed: seed, probe: true});
  return {killAt: r.killAt, maxHp: r.maxHp,
          hpEnd: r.hp.length ? r.hp[r.hp.length - 1] : null,
          secLog: r.secLog || null,
          bossKeys: r.bossKeys || null,
          bossErr: r.bossErr || null,
          bodies: (r.units || []).filter(u => u[2] === 'enemy'),
          aliveEnd: r.aliveEnd || null,
          used: (r.used || []).map(u => u.gid),
          miss: r.miss || null, missBy: r.missBy || null, missWhy: r.missWhy || null,
          missT: r.missT || null,
          allyHp: r.allyHp || null, enemyPos: r.enemyPos || null,
          total: r.total, byAlly: r.byAlly || null, deaths: r.deaths || null,
          castLog: r.castLog || null, allyStats: r.allyStats || null,
          bossLog: r.bossLog || null,
          hits: (r.probe || []).filter(x => typeof x[0] === 'number'
                 && /^a/.test(String(x[12] || ''))).map(
                 x => [x[0], x[4], x[3], x[12], x[13], x[14]]).slice(0, 30)};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('vid')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--grep', default='')
    ap.add_argument('--url', default=recon3.URL)
    A = ap.parse_args()
    row = {r['vid']: r for r in T.usable()}[A.vid]
    with open('/home/pebkac/arona/tl-work/cases.json', encoding='utf-8') as fh:
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
        opts = pg.evaluate("()=>[].slice.call(document.getElementById('i-boss')"
                           ".options).map(x=>x.textContent)")
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
        m = pg.evaluate(JS, [row['stage'], row['dur'], A.seed])
        b.close()

    print(f"{A.vid} {row['stage']} killAt {m['killAt']} 残り {m['hpEnd']} / {m['maxHp']}")
    print('bossKeys:', m['bossKeys'])
    print('bossErr:', m['bossErr'])
    print('secLog:', m['secLog'])
    print('bodies:', json.dumps(m['bodies'], ensure_ascii=False)[:2000])
    print('aliveEnd:', json.dumps(m['aliveEnd'], ensure_ascii=False)[:800])
    cnt = {}
    for g in m['used']:
        if A.grep in str(g):
            cnt[g] = cnt.get(g, 0) + 1
    print(f"used のうち {A.grep!r} を含む枠:", cnt)
    print('miss:', json.dumps(m['miss'], ensure_ascii=False)[:1500])
    print('missBy:', json.dumps(m['missBy'], ensure_ascii=False)[:2500])
    print('missT:', json.dumps(m['missT'], ensure_ascii=False)[:1500])
    print('missWhy:', json.dumps(m['missWhy'], ensure_ascii=False)[:1500])
    print('allyHp:', json.dumps(m['allyHp'], ensure_ascii=False)[:1200])
    print('enemyPos:', json.dumps(m['enemyPos'], ensure_ascii=False)[:800])
    print('total:', m['total'])
    print('byAlly:', json.dumps(m['byAlly'], ensure_ascii=False)[:1200])
    print('deaths:', json.dumps(m['deaths'], ensure_ascii=False)[:1200])
    print('castLog:', json.dumps(m['castLog'], ensure_ascii=False)[:1500])
    print('allyStats:', json.dumps(m['allyStats'], ensure_ascii=False)[:900])
    print('bossLog:', json.dumps(m['bossLog'], ensure_ascii=False)[:3000])
    for h in m['hits']:
        print('  hit', h[0], 'at', h[1], h[2], '->', h[3], 'hp', h[4],
              json.dumps(h[5], ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
