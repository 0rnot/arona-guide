#!/usr/bin/env python3
"""日本語の文の途中にあるソースの改行を畳む。

**Chrome は CJK どうしの改行を消さない。**`…ありません。⏎これまでの…` と書くと、
画面には `…ありません。 これまでの…` と空白が出る（2026-08-30 に Range で実測。
116 箇所すべてが 3.2〜3.6px の幅を持っていた）。

やることは 1 つだけ。**両側が CJK の改行を消す。**
- 片側が英数字のものは残す（`SchaleDB と ba-data` の空白は日本語として正しい）
- 間に挟まってよいのは**行内のタグだけ**（`</b>` `<code>` など）。
  `</p><p>` のようなブロックの境目は、空白が描かれないので触らない
- `<script>` `<style>` の中は素通し
"""
import re
import sys
import pathlib

CJK = "、-〿぀-ヿ㐀-鿿！-｠一-鿿"
# **文の切れ目。**タグをまたいで畳んでよいのは、ここで切れているときだけ
END = "。、）」』】〉》・！？…"
INLINE = "b|i|em|strong|code|a|span|small|sup|sub|u|s|kbd|abbr|time|mark"
TAGS = f"(?:</?(?:{INLINE})\\b[^>]*>\\s*)*"
# タグを挟まない改行は、両側が CJK なら畳んでよい
PLAIN = re.compile(f"([{CJK}])[ \t]*\n[ \t]*([{CJK}])")
# **タグをまたぐときは条件を厳しくする。**`データの出どころ⏎<a>そうりきボーダー</a>` の
# ような「並べるための空白」まで消してしまうため（2026-08-30 に 2 箇所やってしまった）
TAGGED = re.compile(f"([{END}])({TAGS})[ \t]*\n[ \t]*({TAGS})([{CJK}])")
SKIP = re.compile(r"(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->)", re.S | re.I)


def fix(text):
    out = []
    for part in SKIP.split(text):
        if SKIP.fullmatch(part or ""):
            out.append(part)
            continue
        prev = None
        # 畳んだ結果また隣り合うことがあるので、変化しなくなるまで回す
        while part != prev:
            prev = part
            part = PLAIN.sub(lambda m: m.group(1) + m.group(2), part)
            part = TAGGED.sub(lambda m: m.group(1) + m.group(2).rstrip() + m.group(3).rstrip() + m.group(4), part)
        out.append(part)
    return "".join(out)


def bare(text):
    """タグと空白を全部落とした中身。**畳む前後で一致していなければ壊している。**"""
    return re.sub(r"\s+", "", re.sub(r"<[^>]*>", "", text))


def main(argv):
    dry = "--dry" in argv
    total = 0
    for p in [pathlib.Path(a) for a in argv if not a.startswith("-")]:
        src = p.read_text(encoding="utf-8")
        new = fix(src)
        if bare(src) != bare(new):
            raise SystemExit(f"{p}: 中身が変わってしまった。畳むのをやめる")
        if new == src:
            print(f"  {p} はそのまま")
            continue
        total += 1
        print(f"  {p} — 改行 {len(src) - len(new)} 個ぶんを畳んだ")
        if not dry:
            p.write_text(new, encoding="utf-8")
    print(("触ったのは " if not dry else "触る予定は ") + f"{total} ファイル")


if __name__ == "__main__":
    main(sys.argv[1:])
