"""1 本の流れを節・グロッキー・ボスの残り HP・味方ごとの与ダメージで並べる（穴 11。ケセド 3 本の差）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_chesflow.py <vid> [seed] [port]
"""
import json
import sys

import _wave1 as W
from playwright.sync_api import sync_playwright

JS = r"""
async ([key, dur, seed]) => {
  const D = window.__TLDBG, st = D.st;
  const M = await import('/tools/tl/js/sim/bridge.js');
  const L = M.makeLoader('/tools/tl/db');
  const r = await M.simParty({load: L, st, pi: 0, key, dur, seed: seed || undefined, probe: true});
  const boss = {};
  (r.probe || []).forEach(function (p) {
    if (typeof p[0] !== 'number' || !/^a/.test(String(p[1]))) { return; }
    const k = String(p[12] || '');
    if (!/^e/.test(k)) { return; }
    const b = Math.floor(p[4] / 10000) * 10;
    boss[k] = boss[k] || {};
    boss[k][b] = (boss[k][b] || 0) + p[0];
  });
  return {secLog: r.secLog, groggy: r.groggy, ggLog: r.ggLog, killAt: r.killAt,
          maxHp: r.maxHp, bossKeys: r.bossKeys, byAlly: r.byAlly, downAt: r.downAt,
          hp: (r.hp || []).filter(function (h, i) { return i % 20 === 0; }).slice(0, 40),
          castLog: r.castLog, deaths: r.deaths, units: r.units, miss: r.miss, missBy: r.missBy, missT: r.missT, missWhy: r.missWhy, missLog: r.missLog,
          boss: boss};
}
"""


def main():
    vid = sys.argv[1]
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    port = sys.argv[3] if len(sys.argv) > 3 else '8777'
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
    print(vid, '実測', row['sec'], '秒 ／ killAt', r['killAt'], '／ maxHp', r['maxHp'], r['bossKeys'])
    print('節:', json.dumps(r['secLog'], ensure_ascii=False)[:800])
    print('グロッキー:', json.dumps(r['groggy'], ensure_ascii=False)[:600])
    print('ggLog:', json.dumps(r['ggLog'], ensure_ascii=False)[:1500])
    print('倒れた:', r['downAt'])
    print('byAlly:', json.dumps(r['byAlly'], ensure_ascii=False)[:800])
    print('hp:', json.dumps(r['hp'], ensure_ascii=False)[:1200])
    bosskeys = [k for k in r['boss'] if k.startswith('e6022407') and k.split('#')[0].endswith('01')]
    for k in bosskeys:
        print('本体', k, {int(t): round(v) for t, v in sorted(r['boss'][k].items(), key=lambda x: float(x[0]))})
    json.dump(r, open(f'/tmp/flow_{vid}.json', 'w'), ensure_ascii=False)
    print('castLog:', json.dumps(r['castLog'], ensure_ascii=False)[:3000])


if __name__ == '__main__':
    main()
