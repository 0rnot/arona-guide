#!/usr/bin/env python3
"""共有カード（OGP 画像）を 1 ツールにつき 1 枚つくる。

**なぜ要るか。**Discord や X にツールの URL を貼ると、そこに出る絵は
`og:image` で決まる。2026-08-30 まで 26 本すべてが `hero-night.jpg` を
指していて、**どのツールを貼っても同じ絵**が出ていた。貼られた側からは
何のツールか分からない。

つくり方は、サイトと同じ配色の 1200×630 を Chromium で描いて JPEG で保存する。
絵はツール一覧で使っているアイコンをそのまま流用する（`tools.json` の `img`）。

    <playwright の入った python> scripts/build-og-cards.py

**第 2 段として、各ツールの `<head>` の og/twitter 系も書き直す。**
何度走らせても同じ結果になる（既にある行は置き換え、無い行は足す）。

要るもの: Playwright（`venv/bin/python` から使う）とローカルの静的サーバ。
サーバはこのスクリプトが自分で立てる。
"""
import http.server
import json
import pathlib
import re
import socketserver
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "og"
SITE = "https://arona-bot.com"
PORT = 8788

# **配色は style.css の暗い側からそのまま。**サイトを見たあとに共有カードを
# 見ても同じ色でいるように
BG, CARD, LINE, FG, MUTE, GOLD = "#0f1620", "#16202c", "#24303f", "#e8eef5", "#9aa8b8", "#e2c061"

TPL = """<!doctype html><html><head><meta charset="utf-8"><style>
* {{ margin: 0; box-sizing: border-box; }}
html, body {{ width: 1200px; height: 630px; }}
body {{
  background: {BG};
  font-family: "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", sans-serif;
  color: {FG}; position: relative; overflow: hidden;
}}
/* **右上の琥珀。**面で置くと絵が煩いので、うっすら光らせるだけ */
.glow {{ position: absolute; right: -180px; top: -240px; width: 760px; height: 760px;
         border-radius: 50%; background: radial-gradient(circle, rgba(226,192,97,.17), rgba(226,192,97,0) 68%); }}
.in {{ position: relative; padding: 76px 88px; height: 100%; display: flex; flex-direction: column; }}
.brand {{ display: flex; align-items: center; gap: 14px; font-size: 25px; color: {MUTE}; letter-spacing: .09em; }}
.brand i {{ width: 11px; height: 11px; border-radius: 50%; background: {GOLD}; display: block; }}
.mid {{ flex: 1; display: flex; align-items: center; gap: 44px; margin-top: 34px; }}
.tile {{ width: 168px; height: 168px; flex: none; border-radius: 30px; background: {CARD};
         border: 1px solid {LINE}; display: flex; align-items: center; justify-content: center; }}
.tile img {{ width: 112px; height: 112px; object-fit: contain; }}
.tx {{ min-width: 0; }}
/* **日本語を語のまん中で折らない。**`auto-phrase` が無いと
   「戦術対抗戦コ／インの収支」のように切れる（Chromium で描いているので効く） */
h1 {{ font-size: {TSIZE}px; font-weight: 800; line-height: 1.24; letter-spacing: .01em;
      text-wrap: balance; word-break: auto-phrase; }}
p {{ margin-top: 18px; font-size: 26px; line-height: 1.6; color: {MUTE}; word-break: auto-phrase;
     display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }}
.foot {{ display: flex; align-items: center; gap: 20px; font-size: 26px; color: {MUTE}; }}
.foot b {{ width: 56px; height: 6px; border-radius: 3px; background: {GOLD}; display: block; }}
</style></head><body>
<div class="glow"></div>
<div class="in">
  <div class="brand"><i></i>AronaBot のツール</div>
  <div class="mid">
    <div class="tile"><img src="{ICON}"></div>
    <div class="tx"><h1>{NAME}</h1><p>{DESC}</p></div>
  </div>
  <div class="foot"><b></b>arona-bot.com</div>
</div></body></html>"""


# 見出しに使える横幅。1200 から左右の余白 88×2、絵の 168、間の 44 を引いたもの
TITLE_W = 1200 - 88 * 2 - 168 - 44


def title_size(name):
    """見出しの文字の大きさ。**入るいちばん大きいものを選ぶ。**

    決め打ちの文字数で決めていた頃は「戦術対抗戦コ／インの収支」のように
    語のまん中で折れていた（2026-08-31）。全角は 1 文字ぶん、半角は 0.5 文字ぶんで
    幅を見積もって、1 行に収まる大きさを上から探す。**それでも入らない長い題は
    2 行になってよい**——文になっている題（一覧のカード）がそれ。
    """
    w = sum(1.0 if ord(c) > 0x2E80 else 0.5 for c in name)
    for px in (76, 70, 64, 58, 52):
        if w * px <= TITLE_W:
            return px
    return 52


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def og(html, prop):
    """`<head>` から og:xxx の中身を 1 つ取る。無ければ None。"""
    m = re.search(r'<meta property="%s" content="([^"]*)"' % re.escape(prop), html)
    return m.group(1) if m else None


def icon_path(img):
    for ext in ("webp", "png", "jpg"):
        p = ROOT / "tools" / "img" / ("%s.%s" % (img, ext))
        if p.exists():
            return "tools/img/%s.%s" % (img, ext)
    raise SystemExit("アイコンが見つかりません: %s" % img)


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), H)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main(patch_only=False):
    tools = json.loads((ROOT / "tools" / "tools.json").read_text(encoding="utf-8"))["tools"]
    if patch_only:
        # **絵はそのままで `<head>` だけ直す。**他の作業と同時に走らせるとき用
        patch(tools)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    httpd = serve()

    from playwright.sync_api import sync_playwright
    jobs = []
    for t in tools:
        p = ROOT / "tools" / t["slug"] / "index.html"
        html = p.read_text(encoding="utf-8")
        name = og(html, "og:title") or t["name"]
        desc = og(html, "og:description") or t["desc"]
        jobs.append((t["slug"], name, desc, icon_path(t["img"])))
    # 一覧そのものにも 1 枚
    idx = (ROOT / "tools" / "index.html").read_text(encoding="utf-8")
    jobs.append(("index", og(idx, "og:title"), og(idx, "og:description"),
                 "tools/img/currency_icon_ap.webp"))

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1200, "height": 630},
                        device_scale_factor=1)
        for slug, name, desc, icon in jobs:
            tsize = title_size(name)
            pg.set_content(TPL.format(BG=BG, CARD=CARD, LINE=LINE, FG=FG, MUTE=MUTE,
                                      GOLD=GOLD, TSIZE=tsize,
                                      ICON="http://127.0.0.1:%d/%s" % (PORT, icon),
                                      NAME=esc(name), DESC=esc(desc)),
                           wait_until="networkidle")
            pg.screenshot(path=str(OUT / ("%s.jpg" % slug)), type="jpeg", quality=88)
            print("  %-14s %s" % (slug, (OUT / ("%s.jpg" % slug)).stat().st_size))
        b.close()
    httpd.shutdown()
    print("共有カードを %d 枚つくりました" % len(jobs))
    patch(tools)


def patch(tools):
    """各ツールの `<head>` の og / twitter を、決まった順に組み直す。

    **足すのではなく丸ごと書き直す。**継ぎ足していくと `og:image:width` が
    `og:image` より前に出るなど順番が崩れるし、何度も走らせると増えていく。
    OGP の仕様では `og:image:*` は `og:image` の**後ろ**でないと、どの絵に
    かかる指定なのかが決まらない。
    """
    pages = [("tools/%s/index.html" % t["slug"], t["slug"]) for t in tools]
    pages.append(("tools/index.html", "index"))
    n = 0
    for rel, slug in pages:
        p = ROOT / rel
        html = p.read_text(encoding="utf-8")
        name = og(html, "og:title") or ""
        desc = og(html, "og:description") or ""
        url = og(html, "og:url") or ""
        img = "%s/images/og/%s.jpg" % (SITE, slug)
        block = "\n".join([
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="AronaBot">',
            '<meta property="og:locale" content="ja_JP">',
            '<meta property="og:url" content="%s">' % esc(url),
            '<meta property="og:title" content="%s">' % esc(name),
            '<meta property="og:description" content="%s">' % esc(desc),
            '<meta property="og:image" content="%s">' % esc(img),
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            '<meta property="og:image:alt" content="%s — AronaBot のツール">' % esc(name),
            '<meta name="twitter:card" content="summary_large_image">',
            '<meta name="twitter:title" content="%s">' % esc(name),
            '<meta name="twitter:description" content="%s">' % esc(desc),
            '<meta name="twitter:image" content="%s">' % esc(img),
        ])
        # **今ある og/twitter の行をひとかたまりとして取り除く。**
        # 間に他の行が挟まっていないことは、置き換えたあとに数えて確かめる
        lines = html.split("\n")
        keep, first = [], None
        for i, ln in enumerate(lines):
            if re.match(r'\s*<meta (property="og:|name="twitter:)', ln):
                if first is None:
                    first = len(keep)
                continue
            keep.append(ln)
        if first is None:
            raise SystemExit("og の行が 1 つも無い: %s" % rel)
        keep[first:first] = block.split("\n")
        out = "\n".join(keep)
        if out != html:
            p.write_text(out, encoding="utf-8")
            n += 1
    print("<head> を書き直したページ: %d" % n)


if __name__ == "__main__":
    import sys
    main(patch_only="--patch-only" in sys.argv)
