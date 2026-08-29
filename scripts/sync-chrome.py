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
    return f'''<div class="topbar">
  <div class="topbar-inner">
    <a class="topbar-name" href="{up}">AronaBotの使い方</a>
    <a class="topbar-tools" href="{tools_href}"{cur}>
      {WRENCH}
      ツール
    </a>
    <nav class="topbar-nav">
      <a href="{up}#can">機能</a>
      <a href="{up}#start">つかいはじめる</a>
      <a href="{up}#message">メッセージから</a>
      <a href="{up}#faq">よくある質問</a>
    </nav>
  </div>
</div>'''

def footer(up: str, tools_href: str) -> str:
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
      <span>不具合・要望は <b>@0r.not</b> まで</span>
    </p>
    <p class="disclaimer">
      このページはファンによる非公式のものです。
      <small>「ブルーアーカイブ」は Nexon Games / Yostar の作品で、当ページとは関係ありません。</small>
    </p>
  </div>
</footer>'''

TOPBAR_RE = re.compile(r'<div class="topbar">.*?\n</div>', re.S)
FOOTER_RE = re.compile(r'<footer>.*?\n</footer>', re.S)

def sync(path: pathlib.Path, up: str, tools_href: str, current: bool) -> bool:
    s = path.read_text(encoding="utf-8")
    out = s
    if TOPBAR_RE.search(out):
        out = TOPBAR_RE.sub(lambda m: topbar(up, tools_href, current), out, count=1)
    else:
        print(f"  !! topbar が見つからない: {path}", file=sys.stderr)
    if FOOTER_RE.search(out):
        out = FOOTER_RE.sub(lambda m: footer(up, tools_href), out, count=1)
    else:
        print(f"  !! footer が見つからない: {path}", file=sys.stderr)
    if out != s:
        path.write_text(out, encoding="utf-8")
        return True
    return False

def main() -> int:
    targets = []
    idx = ROOT / "tools" / "index.html"
    if idx.exists():
        targets.append((idx, "../", "./", True))
    for p in sorted((ROOT / "tools").glob("*/index.html")):
        targets.append((p, "../../", "../", False))

    changed = 0
    for path, up, href, cur in targets:
        rel = path.relative_to(ROOT)
        if sync(path, up, href, cur):
            print(f"  更新 {rel}")
            changed += 1
        else:
            print(f"  そのまま {rel}")
    print(f"{len(targets)} ページ中 {changed} 件を更新")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
