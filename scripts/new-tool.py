#!/usr/bin/env python3
"""新しいツールのページの骨を作る。

**2 本目を作るときに `sync-chrome.py` を用意したのと同じ理由。**
16 本目からは手で写すと必ずどこかずれるので、頭・パンくず・案内・共有・
footer をここから流し込む（2026-08-30、25 本に増やす前に用意した）。

    python3 scripts/new-tool.py <slug> "<題名>" "<説明>"

中身（`<style>` と本文と `<script>`）は空で出るので、そこだけ手で書く。
上のバーと footer は `sync-chrome.py` が別途整える。
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

TPL = '''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}｜AronaBot</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#c8892e">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://arona-bot.com/tools/{slug}/">
<meta property="og:image" content="https://arona-bot.com/images/hero-night.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../../style.css?v=17">
<link rel="stylesheet" href="../tool.css?v=13">
<style>
{style}
</style>
</head>
<body>

<!-- 上のバーと footer は scripts/sync-chrome.py が流し込む。
     **閉じタグの前に改行を入れておくこと。**あちらの正規表現は閉じタグの直前の
     改行を目印にしているので、1 行に畳むと本文まで食われる。
     **この注記に目印そのものを書かないこと。**書くと注記の中から当たる -->
<div class="topbar">
</div>
<div class="toast" id="toast-page" role="status" aria-live="polite"></div>

<header class="thero">
  <div class="thero-media" aria-hidden="true">
    <picture>
      <source srcset="../../images/hero-day.jpg" media="(prefers-color-scheme: dark)">
      <img src="../../images/hero-night.jpg" alt="" width="1600" height="400" fetchpriority="high">
    </picture>
  </div>
  <div class="thero-body">
    <h1>{title}</h1>
    <p class="thero-lead">{lead}</p>
  </div>
</header>

<div class="twrap">
  <p class="tcrumb"><a href="../../">AronaBotの使い方</a><span class="sl">/</span><a href="../">ツール</a><span class="sl">/</span>{title}</p>

{body}

      <div class="sharebar" id="sharebar"></div>

      <details class="src">
        <summary>数字の出どころ</summary>
{src}
      </details>
    </div>

  </div>
</div>

<script>window.TOUR = {tour};</script>
<script src="../tour.js?v=2"></script>

<script src="../share.js?v=3"></script>
<script src="../hint.js?v=1"></script>

<footer>
</footer>

<script src="data.js"></script>
<script>
{script}
</script>
</body>
</html>
'''


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    slug, title, desc = sys.argv[1], sys.argv[2], sys.argv[3]
    out = ROOT / "tools" / slug / "index.html"
    if out.exists():
        print(f"!! すでにある: {out}", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(TPL.format(
        slug=slug, title=title, desc=desc, lead=desc,
        style="  /* ここにこのページだけの見た目 */",
        body="  <div class=\"tcols lean\" style=\"margin-top:20px\">\n\n    <div class=\"tcol\">\n      <!-- ここに本文 -->",
        src="        <p>ここに出どころ</p>",
        tour=json.dumps({"key": slug, "steps": []}, ensure_ascii=False),
        script="  /* ここに中身 */",
    ), encoding="utf-8")
    print(f"作った: {out}")
    print("このあと scripts/sync-chrome.py で上のバーと footer を入れてください。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
