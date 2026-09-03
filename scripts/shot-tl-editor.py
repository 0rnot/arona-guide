# -*- coding: utf-8 -*-
"""AronaBot のページに載せる TL エディタの参考画像を撮り直す。

**画面を変えたら回す**（2026-09-03 の先生の指示「参考画像は随時更新してって」）。
出力は `images/tl-editor.webp`。

    cd /home/pebkac/arona/arona-guide && python3 -m http.server 8777 &
    /home/pebkac/arona/tl-work/venv/bin/python scripts/shot-tl-editor.py

playwright と ImageMagick（`magick`）が要る。venv は tl-work のものを使う。
"""
import json, io, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = '/home/pebkac/arona/tl-work/cases.json'
URL = os.environ.get('TL_URL', 'http://127.0.0.1:8777/tools/tl/')
OUT = os.path.join(ROOT, 'images', 'tl-editor.webp')


def main():
    from playwright.sync_api import sync_playwright
    c = json.load(io.open(CASES, encoding='utf-8'))
    # **屋内ペロロジラ**（2026-09-03。エディタがペロロジラしか出さない）
    _per = [x for x in (c.get('ペロロジラ') or []) if x.get('vid') == 'a68El3B6QRc']
    tl = (_per or c.get('ビナー'))[0].get('text')
    png = os.path.join(tempfile.gettempdir(), 'tl-editor-shot.png')
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 1500, 'height': 950}, device_scale_factor=2)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until='networkidle')
        # 案内のふきだしは出さない
        pg.evaluate("localStorage.setItem('arona-tour-tl','1')")
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(500)
        # **サイトの帯（`.topbar`）を外してから撮る**（2026-09-03 の先生の指摘
        # 「画像がエディターのヘッダーと被ってる」）。帯は `position:fixed` で
        # 道具の上に重なるので、要素を切り取っても写り込む
        pg.evaluate("document.querySelectorAll('.topbar').forEach(function (e) "
                    "{ e.remove(); });")
        pg.evaluate("(t)=>{const D=window.__TLDBG;D.applyTL(D.parseTL(t));}", tl)
        pg.wait_for_timeout(1200)
        el = pg.query_selector('.tlapp')
        (el or pg).screenshot(path=png)
        b.close()
        if errs:
            print('画面にエラーが出た:', errs[:3])
            return 1
    subprocess.run(['magick', png, '-resize', '1200x', '-quality', '82', OUT], check=True)
    size = subprocess.run(['identify', '-format', '%wx%h %b', OUT],
                          capture_output=True, text=True).stdout
    print('撮った', OUT, size)
    print('**`index.html` の width / height も合わせること**')
    return 0


if __name__ == '__main__':
    sys.exit(main())
