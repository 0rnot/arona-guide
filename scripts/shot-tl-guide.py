# -*- coding: utf-8 -*-
"""説明ページ `/tl/` に載せる参考画像を、まとめて撮り直す。

**画面を変えたら回す**（2026-09-03 の先生の指示「参考画像は随時更新してって」）。
出力は `images/tlg-*.webp` で、1 コマンドで全部撮り直る。

    cd /home/pebkac/arona/arona-guide && python3 -m http.server 8777 &
    /home/pebkac/arona/tl-work/venv/bin/python scripts/shot-tl-guide.py

    # 1 枚だけ撮り直す
    /home/pebkac/arona/tl-work/venv/bin/python scripts/shot-tl-guide.py band lanes

playwright と ImageMagick（`magick`）が要る。venv は tl-work のものを使う。
`scripts/shot-tl-editor.py`（トップページ用の 1 枚）と作りをそろえてある。

**`tl/index.html` の width / height は、この道具が自分で書き換える。**
道具の見た目が変わると絵の縦横も変わるので、手で直していると必ず取り残しが出る
（そこが古いと、読み込み中にページが跳ねる）。
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'tl', 'index.html')
CASES = '/home/pebkac/arona/tl-work/cases.json'
URL = os.environ.get('TL_URL', 'http://127.0.0.1:8777/tools/tl/')
OUT = os.path.join(ROOT, 'images')
TMP = tempfile.gettempdir()

# **撮る画面は屋内ペロロジラ Torment で固定する**（2026-09-03。先生の指示で
# エディタがペロロジラしか出さなくなったので、ビナーでは撮れない）。
# `cases.json` の `a68El3B6QRc`（nktt、40,033,921）を使う。
CASE_BOSS = 'ペロロジラ'
CASE_VID = 'a68El3B6QRc'

# タイムラインの段（`#side` の子の並び）。**行の名前で探す。**
# 段が増減しても添字を書き直さずに済む。名前が重なる段（生徒名は EX・NS・SS で
# 3 回出る）があるので、終わりだけは添字（負なら末尾から）で指定する。
BAND_ROWS = ({'t': '時間軸'}, {'t': 'コスト'})    # 上の帯 — 時間軸からコストの山まで
LANE_ROWS = ({'after': 'コスト'}, {'i': -1})      # 生徒ごとの段 — コストの次から最後まで

# **読み込みの窓（`import` / `imform`）はページに貼っていない。**
# `tools/tl/index.html:210` の `.sheet .card { background:var(--bg1) }` が、
# 変数を宣言している `.tlapp`（51 行）の外にあり、窓は `import-ui.js` が
# `document.body` へ足すので、背景が透けたまま出る（2026-09-03 に実測）。
# **直ったら撮り直して `tl/index.html` に貼ること。**


def _shell(el_or_page, path):
    el_or_page.screenshot(path=path)


def clip_rows(pg, first, last):
    """`#side` の行から、タイムラインの切り取り範囲を出す。

    行の指定は `{'t': '名前'}`（先頭一致の 1 つ目）、`{'after': '名前'}`（その次の行）、
    `{'i': n}`（添字。負なら末尾から）の 3 通り。
    横はステージ全体（左の名前の列＋盤）、縦は first の上端から last の下端まで。
    """
    return pg.evaluate(
        """([a, b]) => {
          const rows = [...document.querySelectorAll('#side > *')];
          const ix = (s) => {
            if (s.i != null) return s.i < 0 ? rows.length + s.i : s.i;
            const t = s.t || s.after;
            const n = rows.findIndex(e => e.textContent.trim().startsWith(t));
            return n < 0 ? -1 : (s.after ? n + 1 : n);
          };
          const f = rows[ix(a)], l = rows[ix(b)];
          if (!f || !l) return null;
          const st = document.getElementById('stage').getBoundingClientRect();
          const fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect();
          return { x: st.x, y: fr.y, width: st.width, height: lr.bottom - fr.y };
        }""", [first, last])


def clip_els(pg, sels):
    """複数の要素をまとめて囲む範囲。**縦に並んだ枠を 1 枚にする**ときに使う。"""
    return pg.evaluate(
        """(ss) => {
          const es = ss.map(s => document.querySelector(s)).filter(Boolean);
          if (!es.length) return null;
          const rs = es.map(e => e.getBoundingClientRect());
          const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
          return { x, y,
                   width: Math.max(...rs.map(r => r.right)) - x,
                   height: Math.max(...rs.map(r => r.bottom)) - y };
        }""", sels)


def pane(pg, title):
    """左右の列にある枠を、見出しの文字から引く。"""
    return pg.evaluate(
        """(t) => {
          const ps = [...document.querySelectorAll('.tlleft > .pane, .tlright > .pane')];
          const p = ps.find(e => {
            const h = e.querySelector('h2');
            return h && h.textContent.trim().startsWith(t);
          });
          if (!p) return null;
          const r = p.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }""", title)


def pad(c, n=6):
    """枠の影が切れないように少しだけ広げる。**マイナスに落とさない。**"""
    if not c:
        return None
    return {'x': max(0, c['x'] - n), 'y': max(0, c['y'] - n),
            'width': c['width'] + n * 2, 'height': c['height'] + n * 2}


def pick_boss(pg, c):
    """相手を `cases.json` の 1 本に合わせる。**やり方は `tl-work/verify.py` と同じ。**

    TL の文章には相手が書いていないので、ここで選ばないと既定の総力戦のまま撮れて、
    画像と説明文の食い違いになる。
    """
    opts = pg.evaluate(
        "()=>[].slice.call(document.getElementById('i-boss').options).map(x=>x.textContent)")
    name, ter = c['bossName'], c.get('ter')
    bi = -1
    if ter:
        bi = next((i for i, o in enumerate(opts)
                   if o.startswith(name) and ('（' + ter + '）') in o), -1)
    if bi < 0:
        bi = next((i for i, o in enumerate(opts) if o.startswith(name)), -1)
    if bi < 0:
        raise SystemExit('ボスが見つからない: ' + name)
    pg.select_option('#i-boss', index=bi)
    pg.wait_for_timeout(250)
    df = c.get('df') or 'Torment'
    di = pg.evaluate(
        "(d)=>[].slice.call(document.getElementById('i-diff').options)"
        ".findIndex(x=>x.textContent.indexOf(d)>=0)", df)
    if di >= 0:
        pg.select_option('#i-diff', index=di)
        pg.wait_for_timeout(250)
    # 装甲を選べるのは大決戦だけ
    if c.get('arm') and c.get('elim'):
        ok = pg.evaluate("(a)=>[].slice.call(document.getElementById('i-armor').options)"
                         ".some(o=>o.value===a)", c['arm'])
        if ok:
            pg.select_option('#i-armor', value=c['arm'])
            pg.wait_for_timeout(250)
        else:
            print('装甲 %s はこの枝に無い（そのまま）' % c['arm'])


# ---------------------------------------------------------------- 1 枚ずつ

def shot_all(pg, png):
    _shell(pg.query_selector('.tlapp') or pg, png)


def shot_kpi(pg, png):
    # **帯を丸ごとではなく、左の数字だけ。**丸ごとだと 1 枚が横長になりすぎて、
    # 1200px に落とした時点で添え書きが読めない
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['#kpi .kboss', '#kpi .kres'])))


def shot_cond(pg, png):
    # 動かす前から決まっている数字（帯のいちばん右）
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['#kpi .kcond']), 8))


def shot_ord(pg, png):
    # **手札が 1 周したあとを撮る。**開始直後だと開始 SET が並んでいるだけで、
    # 「使った札が下へ回って、控えの先頭が空いた枠に入る」が絵に出ない。
    # 右の大きい札（撃っている 1 発）も、演出の中に入っていないと出ない
    box = pg.evaluate("""() => {
      const r = document.getElementById('view').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    hit = False
    f = 0.10
    while f < 0.95:
        pg.mouse.move(box['x'] + box['w'] * f, box['y'] + box['h'] * 0.5)
        pg.wait_for_timeout(60)
        if pg.evaluate("()=>!!document.querySelector('#kord .ocard')"):
            hit = True
            break
        f += 0.01
    if not hit:
        print('スキル順: 撃っている 1 発の上にカーソルを置けなかった')
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['#kord']), 10))
    # **カーソルの線を盤に残さない。**このあと帯と段を撮る
    pg.mouse.move(2, 2)
    pg.wait_for_timeout(200)


def shot_crew(pg, png):
    pg.screenshot(path=png, clip=pad(pane(pg, '編成')))


def shot_build(pg, png):
    pg.screenshot(path=png, clip=pad(pane(pg, '育成')))


def shot_err(pg, png):
    pg.screenshot(path=png, clip=pad(pane(pg, '気をつけること')))


def shot_boss(pg, png):
    pg.screenshot(path=png, clip=pad(pane(pg, '相手')))


def shot_rate(pg, png):
    pg.screenshot(path=png, clip=pad(pane(pg, 'シナリオ別達成率')))


def shot_band(pg, png):
    pg.screenshot(path=png, clip=pad(clip_rows(pg, *BAND_ROWS), 2))


def shot_lanes(pg, png):
    # 生徒ごとの段。**コストの山の次の行から、最後の SS の行まで。**
    pg.screenshot(path=png, clip=pad(clip_rows(pg, *LANE_ROWS), 4))


def shot_rows(pg, png):
    """「入力」の行表。開いて撮って、また閉じる。"""
    pg.click('[data-act="rows"]')
    pg.wait_for_timeout(500)
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['#rowpane'])))
    pg.click('[data-act="rows"]')
    pg.wait_for_timeout(300)


def _open_import(pg, tl):
    pg.click('[data-act="import"]')
    pg.wait_for_timeout(300)
    pg.fill('.sheet textarea', tl)
    pg.click('.sheet [data-x="ok"]')
    pg.wait_for_timeout(900)


def shot_import(pg, png, tl=''):
    """読み込みの窓。**文章を貼って、読み取りの結果まで出した状態。**"""
    _open_import(pg, tl)
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['.sheet .card'])))
    pg.click('.sheet [data-x="no"]')
    pg.wait_for_timeout(300)


def shot_imform(pg, png, tl=''):
    """読み込みの窓の「画面から組む」。**文章を貼ったあとの中身が入る。**"""
    _open_import(pg, tl)
    pg.click('.sheet [data-im="tab"][data-v="1"]')
    pg.wait_for_timeout(500)
    pg.screenshot(path=png, clip=pad(clip_els(pg, ['.sheet .card'])))
    pg.click('.sheet [data-x="no"]')
    pg.wait_for_timeout(300)


# **既定では撮らない 2 枚。**名前を指定したときだけ撮る。
# 読み込みの窓は背景が透けたまま出るので（上の注記）、ページには貼っていない。
# 直ったら `shot-tl-guide.py import imform` で撮って、`tl/index.html` に足す。
DRAFT = ('import', 'imform')

SHOTS = [
    ('all',    shot_all),
    ('kpi',    shot_kpi),
    ('cond',   shot_cond),
    ('crew',   shot_crew),
    ('build',  shot_build),
    ('import', shot_import),
    ('imform', shot_imform),
    ('rows',   shot_rows),
    ('band',   shot_band),
    ('lanes',  shot_lanes),
    ('boss',   shot_boss),
    ('rate',   shot_rate),
    ('err',    shot_err),
    # **スキル順はいちばん最後。**盤の上にカーソルを置いて撮るので、
    # 赤い縦線が残る。前に置くと、そのあとの帯と段の絵に線が写り込む
    ('ord',    shot_ord),
]


def fix_size(name, w, h):
    """説明ページの `<img>` の width / height を、撮った絵に合わせる。

    書き換えるのは `images/tlg-*.webp` を指している 1 枚だけ。
    ページに貼っていない絵なら、何もせず False を返す。
    """
    try:
        with open(PAGE, encoding='utf-8') as f:
            src = f.read()
    except OSError:
        return False
    pat = re.compile(
        r'(<img src="\.\./images/tlg-' + re.escape(name) + r'\.webp"'
        r'(?:[^>]*?))width="\d+" height="\d+"')
    out, n = pat.subn(r'\g<1>width="%s" height="%s"' % (w, h), src, count=1)
    if not n:
        return False   # ページに貼っていない絵（`DRAFT` のもの）
    with open(PAGE, 'w', encoding='utf-8') as f:
        f.write(out)
    return True


def main(argv):
    from playwright.sync_api import sync_playwright
    want = [a for a in argv if not a.startswith('-')]
    todo = [s for s in SHOTS
            if (s[0] in want if want else s[0] not in DRAFT)]
    if not todo:
        print('そんな名前は無い。ある名前:', ' '.join(s[0] for s in SHOTS))
        return 1

    cases = json.load(io.open(CASES, encoding='utf-8'))
    case_ = [x for x in cases[CASE_BOSS] if x['vid'] == CASE_VID][0]
    tl = case_['text']
    made = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        # **横は 1900。**1500 だと上の数字の帯（`#kpi`）の添え書きが
        # 「3 発がコスト不足…」のように途中で切れる（2026-09-03 に両方で撮って比べた）。
        # 盤も広いほど 1 秒あたりの画素が増えて、帯の中の字が読める。
        # **縦は道具の全景が 1 画面に収まる高さ。**切り取りは画面の座標で出しているので、
        # 途中でスクロールが要ると外れる。`device_scale_factor=2` で撮って 1200 に落とす
        pg = b.new_page(viewport={'width': 1900, 'height': 1320}, device_scale_factor=2)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until='networkidle')
        # 案内のふきだしは出さない
        pg.evaluate("localStorage.setItem('arona-tour-tl','1')")
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(600)
        # **サイトの帯（`.topbar`）を外してから撮る**（2026-09-03 の先生の指摘
        # 「画像がエディターのヘッダーと被ってる」）。帯は `position:fixed` で
        # 道具の上に重なるので、要素を切り取っても写り込む
        pg.evaluate("document.querySelectorAll('.topbar').forEach(function (e) "
                    "{ e.remove(); });")
        pick_boss(pg, case_)
        pg.evaluate("(t)=>{const D=window.__TLDBG;D.applyTL(D.parseTL(t));}", tl)
        pg.wait_for_timeout(1500)

        for name, fn in todo:
            png = os.path.join(TMP, 'tlg-%s.png' % name)
            if fn in (shot_import, shot_imform):
                fn(pg, png, tl)
            else:
                fn(pg, png)
            made.append((name, png))
        b.close()
        if errs:
            print('画面にエラーが出た:', errs[:3])
            return 1

    print('name                 file                              size  縦横')
    for name, png in made:
        webp = os.path.join(OUT, 'tlg-%s.webp' % name)
        # **`>` を付けて、小さいものは引き伸ばさない。**枠 1 つを切った絵は
        # 2 倍で撮っても 1200px に届かないことがあり、伸ばすとぼやける
        subprocess.run(['magick', png, '-resize', '1200x>', '-quality', '82', webp],
                       check=True)
        wh = subprocess.run(['identify', '-format', '%w %h %b', webp],
                            capture_output=True, text=True).stdout.split()
        mark = '→ tl/index.html も直した' if fix_size(name, wh[0], wh[1]) else ''
        print('%-20s %-29s %8s  %sx%s %s' %
              (name, os.path.relpath(webp, ROOT), wh[2], wh[0], wh[1], mark))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
