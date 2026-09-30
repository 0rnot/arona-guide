#!/usr/bin/env python3
"""Discord の Arona が読める形の生徒アイコンを作る。**JPEG に落とすだけ。**

    python3 scripts/build-discord-icons.py            # 足りないぶんだけ
    python3 scripts/build-discord-icons.py --force    # 全部作り直す

出どころは `tools/img/student_<id>.webp`（`build-tool-data.py` が置いたもの）。
出す先は `tools/img/dc/student_<id>.jpg`（160×160・品質 86）。

**なぜ JPEG をもう 1 組持つのか。** Discord の Arona（Java）は 10 連の結果を
1 枚の画像にするのに生徒アイコンを読む。ところが **Java 標準の ImageIO には
WebP のデコーダが無い**（JDK 21 の `ImageIO.getReaderFormatNames()` は
JPG/PNG/BMP/GIF/TIFF/WBMP だけ）。しかも `tools/img/student_*.webp` の中身は
可逆の VP8L ではなく **非可逆の `VP8 `** なので、自前で読むのも現実的でない。
Java 側に新しい依存ライブラリを足すより、**読める形をここに 1 組置くほうが安い**
（JNI を使う webp-imageio は ARM の本番機で動く保証が無い、という理由もある）。

**透過は捨ててよい。** collection の切り抜きは不透明な正方形（`Channels: 3.0`）で、
アルファを持っていない。だから PNG（1 枚 32KB）ではなく JPEG（1 枚 8KB）で足りる。

**作り直すのを忘れても壊れない。** Arona はアイコンが取れなかった生徒を
名前だけのカードで描く。欠けるのは絵だけ。
"""
import io
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "tools" / "img"
OUT = IMG / "dc"
SIZE = 160
QUALITY = 86


def convert(src: pathlib.Path, dst: pathlib.Path) -> None:
    raw = src.read_bytes()
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=False)
    except ImportError:
        import shutil
        import subprocess
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い")
        subprocess.run([exe, str(src), "-resize", f"{SIZE}x{SIZE}!",
                        "-background", "white", "-alpha", "remove", "-alpha", "off",
                        "-interlace", "none", "-quality", str(QUALITY), str(dst)], check=True)


def main() -> int:
    force = "--force" in sys.argv
    if not IMG.is_dir():
        print("tools/img が無い。先に build-tool-data.py を回すこと", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    srcs = sorted(p for p in IMG.glob("student_*.webp") if re.fullmatch(r"student_\d+", p.stem))
    made = skipped = failed = 0
    for src in srcs:
        dst = OUT / (src.stem + ".jpg")
        if dst.exists() and not force and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        try:
            convert(src, dst)
            made += 1
        except Exception as e:                      # noqa: BLE001 — 1 枚の失敗で全部止めない
            print(f"    作れない {src.name}: {e}", file=sys.stderr)
            failed += 1

    # **元が消えた生徒のぶんは片付ける。**（SchaleDB から消えることは稀だが、
    # 残しておくと「あるはずのアイコン」として Arona が取りに行って 404 を食う）
    alive = {p.stem for p in srcs}
    removed = 0
    for old in OUT.glob("student_*.jpg"):
        if old.stem not in alive:
            old.unlink()
            removed += 1

    print(f"Discord 用アイコン: 作った {made} / 据え置き {skipped}"
          f" / 失敗 {failed} / 片付け {removed} （{OUT.relative_to(ROOT)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
