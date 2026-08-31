#!/usr/bin/env python3
"""tools/ 以下のページの上部バーと footer を 1 か所から揃える。

静的サイトなので取り込みの仕組みが無い。**ツールが増えるたびに手で直すと必ずずれる**
ので、この 1 本を正本にして流し込む（2026-08-30、2 本目を作る前に用意した）。

    python3 scripts/sync-chrome.py

対象は tools/index.html と tools/*/index.html。
置き換えるのは <div class="topbar">…</div> と <footer>…</footer> の中身だけで、
それ以外は 1 バイトも触らない。
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

WRENCH = ('<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">\n'
          '        <path d="M21.7 18.3l-6-6a5.5 5.5 0 0 0-7-7l3.1 3.1-2.1 2.1L6.6 7.3'
          'a5.5 5.5 0 0 0 7 7l6 6a1 1 0 0 0 1.4 0l.7-.7a1 1 0 0 0 0-1.3z"/>\n'
          '      </svg>')

def topbar(up: str, tools_href: str, current: bool) -> str:
    cur = ' aria-current="page"' if current else ''
    # **一覧に居るときは「ツール」、道具の中に居るときは「ツール一覧」。**
    # 中に居るとき「ツール」とだけ出ていると、それが戻り道だと分からない
    label = "ツール" if current else "ツール一覧"
    return f'''<div class="topbar">
  <div class="topbar-inner">
    <a class="topbar-name" href="{up}">AronaBotの使い方</a>
    <a class="topbar-tools" href="{tools_href}"{cur}>
      {WRENCH}
      {label}
    </a>
    <nav class="topbar-nav">
      <a href="{up}#can">機能</a>
      <a href="{up}#start">つかいはじめる</a>
      <a href="{up}#message">メッセージから</a>
      <a href="{up}#faq">よくある質問</a>
    </nav>
    <!-- 共有。**AronaBot 本体と同じ位置に置く。**押した先は環境で変える -->
    <span class="share-nudge" aria-hidden="true">使えそうな人に、ぜひ</span>
    <a class="share" id="share-page" target="_blank" rel="noopener" aria-label="このページを共有する"
       href="https://x.com/intent/post?url=https%3A%2F%2Farona-bot.com%2Ftools%2F">
      <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/>
      </svg>
      <span class="share-label">共有</span>
    </a>
  </div>
</div>
<div class="toast" id="toast-page" role="status" aria-live="polite"></div>
<script>
/* 共有ボタン。**そのページ自身の URL を配る。**
   1. スマホ（navigator.share）→ OS の共有シート
   2. PC（クリップボード）→ URL をコピーして帯で伝える
   3. どちらも無い → <a href> のまま X の共有ページへ */
(function () {{
  var btn = document.getElementById('share-page'), toast = document.getElementById('toast-page');
  if (!btn) return;
  /* **`#` を落とさない。**TL のように状態をハッシュに入れているツールでは、
     ここを削ると相手の画面に同じ結果が出ない（2026-08-30）。

     **読み込み時に 1 回だけ取らない。**そのあと入力を変えてハッシュが
     書き換わっても、古い URL を配ってしまう（2026-08-31 にサブエージェント
     2 体が別々に見つけた）。`share.js` の X ボタンと同じく、押される直前に
     読み直す。`window.shareUrl` を持つツールでは、そちらを先に呼ぶ。 */
  function url() {{
    try {{
      if (typeof window.shareUrl === 'function') {{
        var h = window.shareUrl();
        if (h) return location.href.split('#')[0] + h;
      }}
    }} catch (e) {{ /* ツール側が転んでも共有は動かす */ }}
    return location.href;
  }}
  var name = document.title.split('｜')[0];
  var text = name + '（AronaBot のツール）';
  function refresh() {{
    btn.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) +
               '&url=' + encodeURIComponent(url());
  }}
  refresh();
  ['focus', 'pointerdown'].forEach(function (ev) {{ btn.addEventListener(ev, refresh); }});
  var timer = null;
  function say(t) {{
    if (!toast) return;
    toast.textContent = t; toast.classList.add('shown');
    clearTimeout(timer); timer = setTimeout(function () {{ toast.classList.remove('shown'); }}, 2000);
  }}
  btn.addEventListener('click', function (e) {{
    refresh();
    var u = url();
    if (navigator.share) {{
      e.preventDefault();
      navigator.share({{ title: name, text: text, url: u }}).catch(function () {{}});
      return;
    }}
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      e.preventDefault();
      navigator.clipboard.writeText(u).then(function () {{ say('リンクをコピーしました'); }},
        function () {{ window.open(btn.href, '_blank', 'noopener'); }});
    }}
  }});
}})();
</script>'''

# **要望と不具合の投げ口。**`0rnot/arona-guide` は Public でリポジトリの Issues も
# 有効なので、サーバーを持たずに誰でも投げられる（2026-08-30 の先生の指示——
# 「各ツールページに要望・修正依頼[Issue]が誰でも投げられるようにできる？？？」）。
# **フォームの `id` にそのまま値を入れられる**ので、ツール名を埋めた状態で開く。
# GitHub のアカウントが無い人向けに、Discord も並べたままにしておく
ISSUE_NEW = "https://github.com/0rnot/arona-guide/issues/new"


def issue_link(tool_name: str) -> str:
    from urllib.parse import quote
    q = ("template=tool-feedback.yml"
         f"&title={quote('[' + tool_name + '] ')}"
         f"&tool={quote(tool_name)}")
    return f"{ISSUE_NEW}?{q}"


def footer(up: str, tools_href: str, tool_name: str = "") -> str:
    fb = (f'''<a href="{issue_link(tool_name)}" target="_blank" rel="noopener">このツールへの要望・不具合</a>
      <span class="sep">/</span>
      ''' if tool_name else "")
    return f'''<footer>
  <div class="foot-inner">
    <p class="foot-name">AronaBotの使い方</p>
    <p class="foot-links">
      <a href="{up}">AronaBot のページ</a>
      <span class="sep">/</span>
      <a href="{tools_href}">ツール一覧</a>
      <span class="sep">/</span>
      <a href="https://x.com/pe6cak" target="_blank" rel="noopener">制作者の X（@pe6cak）</a>
      <span class="sep">/</span>
      {fb}<span>Discord なら <b>@0r.not</b> まで</span>
    </p>
    <p class="disclaimer">
      <b>このサイトはファンが作った非公式のものです。</b>運営とは関係ありません。
      <small>掲載しているゲーム内の画像・アイコン・名称・数値は、Nexon Games / Yostar の
      「ブルーアーカイブ」から引用したもので、著作権はすべて権利者に帰属します。
      ツールの計算に使うデータは <a href="https://schaledb.com/" target="_blank" rel="noopener">SchaleDB</a> と
      <a href="https://github.com/electricgoat/ba-data" target="_blank" rel="noopener">ba-data</a> から取得しています。
      権利者の方でご指摘があれば <b>@0r.not</b> までご連絡ください。</small>
    </p>
  </div>
</footer>'''

# **toast と共有のスクリプトまでを 1 かたまりとして差し替える。**
# 古い版（topbar だけ）にも当たるように、後ろの 2 つは任意にしてある
TOPBAR_RE = re.compile(
    r'<div class="topbar">.*?\n</div>'
    r'(?:\n<div class="toast" id="toast(?:-page)?".*?</div>)?'
    r'(?:\n<script>\n/\* 共有ボタン。.*?\n</script>)?', re.S)
FOOTER_RE = re.compile(r'<footer>.*?\n</footer>', re.S)

def sync(path: pathlib.Path, up: str, tools_href: str, current: bool,
         tool_name: str = "") -> bool:
    s = path.read_text(encoding="utf-8")
    out = s
    m = TOPBAR_RE.search(out)
    if m:
        # **食いすぎていないかを見る。**この正規表現は `\n</div>` まで貪欲でない
        # だけなので、閉じタグが 1 行に畳まれていると本文まで飲み込む
        # （2026-08-30、16 本目の骨を作ったときに実際に本文が消えた）
        if len(m.group(0)) > 4000:
            print(f"  !! topbar の当たりが広すぎる（{len(m.group(0))} 文字）: {path}", file=sys.stderr)
            return False
        out = TOPBAR_RE.sub(lambda mm: topbar(up, tools_href, current), out, count=1)
    else:
        print(f"  !! topbar が見つからない: {path}", file=sys.stderr)
    if FOOTER_RE.search(out):
        out = FOOTER_RE.sub(lambda m: footer(up, tools_href, tool_name), out, count=1)
    else:
        print(f"  !! footer が見つからない: {path}", file=sys.stderr)
    if out != s:
        path.write_text(out, encoding="utf-8")
        return True
    return False

def main() -> int:
    # ツール名は tools.json が正本。**slug から引く**
    names = {}
    tj = ROOT / "tools" / "tools.json"
    if tj.exists():
        import json
        for t in json.loads(tj.read_text(encoding="utf-8")).get("tools", []):
            names[t["slug"]] = t["name"]

    targets = []
    idx = ROOT / "tools" / "index.html"
    if idx.exists():
        targets.append((idx, "../", "./", True, ""))
    for p in sorted((ROOT / "tools").glob("*/index.html")):
        targets.append((p, "../../", "../", False, names.get(p.parent.name, p.parent.name)))

    changed = 0
    for path, up, href, cur, nm in targets:
        rel = path.relative_to(ROOT)
        if sync(path, up, href, cur, nm):
            print(f"  更新 {rel}")
            changed += 1
        else:
            print(f"  そのまま {rel}")
    print(f"{len(targets)} ページ中 {changed} 件を更新")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
