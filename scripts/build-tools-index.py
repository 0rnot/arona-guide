#!/usr/bin/env python3
"""tools/tools.json から tools/index.html のカード一覧を組み立てる。

**ツールは増える。** 一覧を手で書き足していると、種類の絞り込みと数が必ずずれる。
正本は tools/tools.json。ここを直して

    python3 scripts/build-tools-index.py

を走らせると、tools/index.html の <!-- TOOLS:START --> と <!-- TOOLS:END --> の
あいだだけが置き換わる。それ以外は 1 バイトも触らない。
"""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
IDX = ROOT / "tools" / "index.html"
TOP = ROOT / "index.html"
SRC = ROOT / "tools" / "tools.json"

ARROW = ('<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
         '<path d="M13.5 5.5 12.1 6.9l4.1 4.1H4v2h12.2l-4.1 4.1 1.4 1.4 6.5-6.5z"/></svg>')

def esc(s):
    return html.escape(s, quote=True)

def icon(t, prefix="", size=66):
    """カードの差し色になるゲーム内アイコン。**無ければ何も置かない。**
    width/height は CSS と揃える（ずれると読み込み中に行がガタつく）。"""
    if not t.get("img"):
        return ""
    return (f'<img class="ticon" src="{prefix}img/{esc(t["img"])}.webp" alt="" '
            f'width="{size}" height="{size}" loading="lazy">')

def card(t):
    cats = "|".join(t["cat"])
    return f'''    <a class="tcard" href="{esc(t['slug'])}/" data-cat="{esc(cats)}">
      {icon(t)}
      <div class="cat">{esc(' · '.join(t['cat']))}</div>
      <h2>{esc(t['name'])}</h2>
      <p>{esc(t['desc'])}</p>
      <span class="go">つかう {ARROW}</span>
    </a>'''

def soon(s):
    return f'''    <div class="tcard soon" data-cat="{esc(s['cat'])}">
      <div class="cat">{esc(s['cat'])}</div>
      <h2>{esc(s['name'])}</h2>
      <p>{esc(s['desc'])}</p>
    </div>'''

def band(t):
    """本編に置く帯のカード。**一覧のカードとは別の形。**"""
    return f'''        <a class="toolband-card" href="tools/{esc(t['slug'])}/">
          {icon(t, "tools/", 54)}
          <div class="cat">{esc(' · '.join(t['cat']))}</div>
          <h3>{esc(t['name'])}</h3>
          <p>{esc(t['desc'])}</p>
        </a>'''

def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    blocks = [card(t) for t in data.get("tools", [])]
    blocks += [soon(s) for s in data.get("soon", [])]
    body = "<!-- TOOLS:START -->\n" + "\n\n".join(blocks) + "\n<!-- TOOLS:END -->"

    s = IDX.read_text(encoding="utf-8")
    new, n = re.subn(r"<!-- TOOLS:START -->.*?<!-- TOOLS:END -->", lambda m: body, s, count=1, flags=re.S)
    if n == 0:
        print("!! TOOLS:START / TOOLS:END の目印が見つからない", file=sys.stderr)
        return 1
    if new != s:
        IDX.write_text(new, encoding="utf-8")
        print(f"tools/index.html を更新（ツール {len(data.get('tools', []))} 本）")
    else:
        print("tools/index.html はそのまま")

    # 本編の帯。**新しい順に 3 本だけ**出す（多すぎると本編の流れを止める）
    picks = list(reversed(data.get("tools", [])))[:3]
    body2 = "<!-- BAND:START -->\n" + "\n\n".join(band(t) for t in picks) + "\n<!-- BAND:END -->"
    t = TOP.read_text(encoding="utf-8")
    new2, n2 = re.subn(r"<!-- BAND:START -->.*?<!-- BAND:END -->", lambda m: body2, t, count=1, flags=re.S)
    if n2 == 0:
        print("!! index.html の BAND:START / BAND:END が見つからない", file=sys.stderr)
        return 1
    if new2 != t:
        TOP.write_text(new2, encoding="utf-8")
        print(f"index.html の帯を更新（{len(picks)} 枚）")
    else:
        print("index.html の帯はそのまま")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
