#!/usr/bin/env python3
"""ツールが読む data.js とアイコンを、公開データから作り直す。

    python3 scripts/build-tool-data.py            # ぜんぶ
    python3 scripts/build-tool-data.py bond       # 一部だけ

**手で data.js を書かない。** 生徒も贈り物もステージも増える。増えたときに
このスクリプトを回せば、ツール側は 1 行も直さずに追随する
（GitHub Actions が毎日回している。.github/workflows/tool-data.yml）。

出どころ:
  ba-data   https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/*.json
  SchaleDB  https://raw.githubusercontent.com/SchaleDB/SchaleDB/main/data/jp/*.min.json
            https://schaledb.com/images/...        （アイコン）

**SchaleDB の画像は 146×116 の横長。**正方形の枠に入れると 2 割ほど横に潰れるので、
落としたあと 122×122 に切り直してから置く（中身の一番外側は x 14〜134 / y 4〜116 に
収まっているのを実測して決めた枠）。切り直しには Pillow を使う。
"""
import collections, datetime, html, io, json, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "tools" / "img"
BA = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/{}.json"
# **同じリポジトリの DB/ 側。**Excel/ にも同名のファイルがあるが、
# EventContentTreasure 系は Excel/ 側が空の殻で、中身は DB/ にしか無い
# **`DB/` が今のデータ。`Excel/` は表ごとにばらばらの時点で止まっている。**
# 更新されている表もあるが、多くは 2024〜2025 年で凍っていて、しかも
# ディレクトリ全体の最終コミットは今日の日付なので、見ただけでは古さに気づけない
# （`Excel/CharacterWeaponExcelTable` は 2025-05-21 / v1.57.342698、
#  `Excel/ItemExcelTable` は 2025-05-07 / v1.56.337920、
#  `Excel/AcademyRewardExcelTable` は 2024-08-21 / v1.48.295969。
#  2026-08-31 に GitHub の commits API でファイルごとに確かめた）。
# 同じ日に、サイトが読む 37 の表を両方数えて確かめた——**20 の表で行数が違う**
# （ItemExcelTable 1434→1808、RecipeExcelTable 6335→7397、
#  CharacterWeaponExcelTable 224→275、AcademyRewardExcelTable 516→564 ほか）。
# 中身も違い、カリン（制服）の固有3 で上がる地形適性は Excel/ が 2、DB/ が 1 で、
# DB/ のほうが SchaleDB と 274 人ぜんぶ一致する。
# **`ConstCommonExcelTable` だけ `DB/` に無い（404）ので、そこだけ `BA` を使う。**
BADB = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/DB/{}.json"
# **GitHub の SchaleDB/SchaleDB は 2024-08 で止まっている**（build 1723935982）。
# 生徒が 194 人しか入っておらず、実際の 274 人と 80 人ずれる。
# 本番サイトのほうは毎日更新されているので、そちらを見る（2026-08-30 に発見）。
SD = "https://schaledb.com/data/jp/{}.min.json"
SD_CFG = "https://schaledb.com/data/config.json"
# **箱（GachaGroup）の中身。**言語に依らないので `data/jp/` ではなく直下にある。
# 中身ごとに `Chance` が入っていて、ba-data の `Prob` 比を自分で割る必要がない
SD_GROUPS = "https://schaledb.com/data/groups.min.json"

CROP = (12, 0, 134, 116)      # 146×116 の中で、どの絵もはみ出さない横方向の枠
SQUARE = 122


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "arona-guide/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        # **raw.githubusercontent.com がときどき 400 を返す。**ファイルは在って、
        # 別のパスでは 200 が返る（2026-08-31 に `DB/CharacterWeaponLevelExcelTable.json`
        # で踏んだ。3 回続けて 400、Contents API では取れた）。CDN 側の不調なので、
        # **同じ中身を GitHub の Contents API から取り直す。**こちらは 1 時間 60 回まで
        alt = raw_to_api(url)
        if e.code != 400 or not alt:
            raise
        print(f"  raw が 400。Contents API で取り直す: {url}")
        req = urllib.request.Request(alt, headers={"User-Agent": "arona-guide/1.0",
                                                   "Accept": "application/vnd.github.raw"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()


def raw_to_api(url):
    """`raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` を Contents API の URL に。"""
    m = re.match(r"https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$", url)
    if not m:
        return ""
    owner, repo, ref, path = m.groups()
    return f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}"


def get_json(url):
    return json.loads(get(url).decode("utf-8"))


def as_list(d):
    """ba-data は {"DataList": [...]}、SchaleDB は配列か id をキーにした辞書。"""
    if isinstance(d, dict):
        if "DataList" in d:
            return d["DataList"]
        return list(d.values())
    return d


# **JP には同じ `Name` の生徒が 2 組いる**（2026-08-30 に 274 人を数えて見つけた）。
#
#   10143 / 10144  どちらも「シュン（水着）」。`PersonalName` は シュン と シュエリン
#   10098 / 10099  どちらも「ホシノ（臨戦）」。`TacticRole` が Tanker と DamageDealer
#
# 名前で選ばせる画面（生徒の一覧・datalist・TL の読み込み）で、そのまま出すと
# **同じ名前が 2 つ並んで、どちらを選んだか分からない。**名前で引く実装は
# 先に見つけたほうを返すので、静かに別人になる。
# **勝手な呼び名は作らない。**ゲームのデータが持っている欄だけで割る。
def disp_names(students, loc=None):
    """`{Id: 画面に出す名前}`。ぶつかったときだけ、データにある欄で割る。"""
    role_ja = (loc or {}).get("TacticRole") or {}
    seen = {}
    for s in students:
        if s.get("Name"):
            seen.setdefault(s["Name"], []).append(s)
    out = {}
    for nm, rows in seen.items():
        if len(rows) == 1:
            out[rows[0]["Id"]] = nm
            continue
        # 1) 個人名が違うならそれで割る（シュン / シュエリン）
        pn = {r.get("PersonalName") or "" for r in rows}
        if len(pn) == len(rows) and all(pn):
            i = nm.find("（")
            tail = nm[i:] if i >= 0 else ""      # 「（水着）」はそのまま残す
            for r in rows:
                out[r["Id"]] = r["PersonalName"] + tail
            continue
        # 2) 役割が違うならそれで割る（ホシノ（臨戦）のタンクとアタッカー）
        rl = {r.get("TacticRole") or "" for r in rows}
        if len(rl) == len(rows) and all(rl):
            for r in rows:
                out[r["Id"]] = nm + "／" + (role_ja.get(r["TacticRole"]) or r["TacticRole"])
            continue
        # 3) それでも割れないときは番号を添える。**黙って重ねない**
        for r in rows:
            out[r["Id"]] = f"{nm}（{r['Id']}）"
    return out


class _Names:
    """`NAMES.get(id, 既定)` で画面に出す名前を引く。**初回だけ取りに行く。**

    12 か所の builder が同じ表を要るので、ここで 1 回だけ作って配る。"""

    def __init__(self):
        self._m = None

    def _load(self):
        if self._m is None:
            self._m = disp_names(as_list(get_json(SD.format("students"))),
                                 get_json(SD.format("localization")))
        return self._m

    def get(self, sid, default=""):
        return self._load().get(sid, default)


NAMES = _Names()


def fetch_raw(name, url, force=False):
    """切り直さずにそのまま置く（ボスの立ち絵など、正方形でない絵）。"""
    out = IMG / (name + ".webp")
    if out.exists() and not force:
        return False
    try:
        raw = get(url)
    except Exception as e:
        print(f"    落とせない {name}: {e}", file=sys.stderr)
        return False
    if len(raw) < 2000:
        print(f"    実体が無い {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im.thumbnail((520, 520))
        im.save(out, "WEBP", quality=86, method=6)
    except ImportError:
        import subprocess, shutil, tempfile
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い")
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            t.write(raw); tmp = t.name
        subprocess.run([exe, tmp, "-resize", "520x520>", "-quality", "86", str(out)], check=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
    return True


# ゲーム内 UI のアイコン。**SchaleDB の本番サイトには置かれていない**ものが多く、
# GitHub のリポジトリ（images/ui/）から取る。data と違ってこちらは画像なので
# 2024-08 で止まっていても問題にならない。
# **大半は白い単色のグリフ**なので、ページ側では mask-image で文字色に染める
# （そのまま <img> で置くと、クリーム色の地に白で見えなくなる）。
SD_UI = "https://raw.githubusercontent.com/SchaleDB/SchaleDB/main/images/ui/{}.png"

# 落としてくる UI アイコン。**増やすときはここに 1 行足す**
UI_ICONS = [
    # 装備の部位
    "Icon_Inven_Hat", "Icon_Inven_Gloves", "Icon_Inven_Shoes", "Icon_Inven_Bag",
    "Icon_Inven_Badge", "Icon_Inven_Hairpin", "Icon_Inven_Charm",
    "Icon_Inven_Watch", "Icon_Inven_Necklace",
    # 地形と属性
    "Terrain_Indoor", "Terrain_Outdoor", "Terrain_Street",
    "Type_Attack", "Type_Defense",
    # 役割
    "Role_DamageDealer", "Role_Healer", "Role_Supporter", "Role_Tanker", "Role_Vehicle",
    # 贈り物の効き目（×1〜×4）。**ゲームの中の絵と同じもの。**
    # SchaleDB も `Cafe_Interaction_Gift_0{一致タグ数+1}.png` で出している
    "Cafe_Interaction_Gift_01", "Cafe_Interaction_Gift_02",
    "Cafe_Interaction_Gift_03", "Cafe_Interaction_Gift_04",
    # 星（★1〜★3）。星上げの計算機で使う
    "Common_Icon_Formation_Star_R2", "Common_Icon_Formation_Star_R3",
    # そのほか
    "Cafe_Icon_Interaction", "Cafe_Icon_Comfort", "School_Icon_Schedule_Favor",
    "Common_Icon_Time", "Image_Compare",
    "CraftNode_Credit", "CraftNode_Favor", "CraftNode_Item",
    "CraftNode_SecretStone", "CraftNode_UltimateSkill",
    # **これだけは色付き**（金の星に数字）。mask ではなく <img> で置く
    "Common_Icon_Formation_Star_R1",
]


def fetch_ui(name, force=False, size=96):
    """ゲーム内 UI のアイコン。透過を残したまま webp にするだけで、切り抜かない。"""
    out = IMG / ("ui_" + name.lower() + ".webp")
    if out.exists() and not force:
        return False
    try:
        raw = get(SD_UI.format(name))
    except Exception as e:
        print(f"    落とせない {name}: {e}", file=sys.stderr)
        return False
    if len(raw) < 200 or raw[:4] != b"\x89PNG":
        print(f"    PNG でない {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        if max(im.size) > size:
            im.thumbnail((size, size), Image.LANCZOS)
        im.save(out, "WEBP", quality=92, method=6, lossless=True)
    except ImportError:
        import subprocess, shutil, tempfile
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い")
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            t.write(raw); tmp = t.name
        # **透過を残す。**-resize の > は「大きいときだけ縮める」
        subprocess.run([exe, tmp, "-resize", f"{size}x{size}>", "-define",
                        "webp:lossless=true", str(out)], check=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
    return True


def build_ui():
    print("ゲーム内 UI のアイコン")
    n = sum(fetch_ui(x) for x in UI_ICONS)
    print(f"  {n} 枚を追加（全 {len(UI_ICONS)} 種）")
    return bool(n)


def fetch_portrait(name, url, force=False, size=200):
    """生徒の顔。**icon（120×120）ではなく collection（200×226）を使う。**
    icon は小さくて、Tier 表のように大きく出すと粗い。collection のほうが
    画素も多く、学校の色が背景に入っていて並べたときに見分けやすい。
    上を残して正方形に切る（顔が上寄りにあるため）。"""
    out = IMG / (name + ".webp")
    if out.exists() and not force:
        return False
    try:
        raw = get(url)
    except Exception as e:
        print(f"    落とせない {name}: {e}", file=sys.stderr)
        return False
    if len(raw) < 2000:
        print(f"    実体が無い {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        im = im.crop((left, 0, left + side, side)).resize((size, size), Image.LANCZOS)
        im.save(out, "WEBP", quality=90, method=6)
    except ImportError:
        import subprocess, shutil, tempfile
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い")
        with tempfile.NamedTemporaryFile(suffix=".webp", delete=False) as t:
            t.write(raw); tmp = t.name
        subprocess.run([exe, tmp, "-resize", f"{size}x{size}^", "-gravity", "north",
                        "-extent", f"{size}x{size}", "-quality", "90", str(out)], check=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
    return True


def fetch_icon(name, url, force=False):
    """アイコンを 1 枚落として 122×122 に整える。**既にあれば触らない。**"""
    out = IMG / (name + ".webp")
    if out.exists() and not force:
        return False
    try:
        raw = get(url)
    except Exception as e:
        print(f"    落とせない {name}: {e}", file=sys.stderr)
        return False
    # **中身が画像かどうかで見る。**SchaleDB は無い画像に HTML を返すので、
    # 先頭の魔法数で弾ける。バイト数で切ると、本当に小さい絵まで一緒に捨てる
    # （buff/Buff_CostRegen.webp が 1,614 バイトだった。2026-08-30）
    if not (raw[:8] == b"\x89PNG\r\n\x1a\n" or raw[:4] == b"RIFF" or raw[:3] == b"\xff\xd8\xff"):
        print(f"    実体が無い {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    _square(raw, out)
    return True


def fetch_wide(name, url, width=260, force=False):
    """**縦横比を変えない絵。**固有武器の絵は 800×205 の横長で、
    `fetch_icon` の 122×122 に切ると刀身が消える。横幅だけ揃えて縮める。"""
    out = IMG / (name + ".webp")
    if out.exists() and not force:
        return False
    try:
        raw = get(url)
    except Exception as e:
        print(f"    落とせない {name}: {e}", file=sys.stderr)
        return False
    if not (raw[:8] == b"\x89PNG\r\n\x1a\n" or raw[:4] == b"RIFF" or raw[:3] == b"\xff\xd8\xff"):
        print(f"    実体が無い {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        if im.width > width:
            im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
        im.save(out, "WEBP", quality=86, method=6)
    except ImportError:
        import subprocess, shutil, tempfile
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い")
        with tempfile.NamedTemporaryFile(suffix=".webp", delete=False) as t:
            t.write(raw); tmp = t.name
        subprocess.run([exe, tmp, "-resize", f"{width}x>", "-quality", "86", str(out)], check=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
    return True


def _square(raw, out):
    """146×116 を 122×122 に切り直して保存する。

    **Pillow があればそれで、無ければ ImageMagick に投げる。**
    Actions では pip で Pillow を入れているが、手元で回すときに
    それが無いだけでアイコンが 1 枚も落ちてこないのは困る。"""
    try:
        from PIL import Image
    except ImportError:
        import subprocess, shutil, tempfile
        exe = shutil.which("magick") or shutil.which("convert")
        if not exe:
            raise SystemExit("Pillow も ImageMagick も無い。pip install Pillow してください")
        with tempfile.NamedTemporaryFile(suffix=".webp", delete=False) as t:
            t.write(raw); tmp = t.name
        subprocess.run([exe, tmp, "-crop", f"{CROP[2]-CROP[0]}x{CROP[3]-CROP[1]}+{CROP[0]}+{CROP[1]}",
                        "+repage", "-background", "none", "-gravity", "center",
                        "-extent", f"{SQUARE}x{SQUARE}", "-quality", "88", str(out)], check=True)
        pathlib.Path(tmp).unlink(missing_ok=True)
        return
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if im.size == (146, 116):
        im = im.crop(CROP)
    canvas = Image.new("RGBA", (SQUARE, SQUARE), (0, 0, 0, 0))
    canvas.paste(im, ((SQUARE - im.width) // 2, (SQUARE - im.height) // 2))
    canvas.save(out, "WEBP", quality=88, method=6)


# 取得日。**ページの「取得は …」がこれを出す。**
# `version` は出典の説明文で日付ではなく、すぐ上の「出典 —」と同じことを
# 二度言う形になっていた（2026-08-31 に分けた）
TODAY = datetime.date.today().isoformat()
_FETCHED_RE = re.compile(r'"fetched":"\d{4}-\d\d-\d\d",?')


def write_js(path, var, obj, header=""):
    p = ROOT / path
    if isinstance(obj, dict) and "fetched" not in obj:
        obj = dict(obj, fetched=TODAY)
    body = header + f"window.{var} = " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    old = p.read_text(encoding="utf-8") if p.exists() else ""
    # **日付だけの差では書き換えない。**毎日走らせても、中身が同じなら触らない
    if _FETCHED_RE.sub("", old) == _FETCHED_RE.sub("", body):
        print(f"  {path} はそのまま")
        return False
    p.write_text(body, encoding="utf-8")
    print(f"  {path} を更新（{len(body):,} バイト）")
    return True


def version_stamp():
    try:
        v = get_json(BA.format("../version"))
    except Exception:
        v = None
    return v


# ------------------------------------------------------------ 絆ランク

def build_bond():
    print("絆ランク計算機")
    items = as_list(get_json(SD.format("items")))
    students = as_list(get_json(SD.format("students")))
    favor = get_json(BADB.format("FavorLevelExcelTable"))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))

    # 誰にでも効く共通タグ。ConstCommon に 1 行だけある
    gen = []
    for row in const:
        for k, v in row.items():
            if k == "CommonFavorItemTags" and isinstance(v, list):
                gen = list(v)
    if not gen:
        raise SystemExit("CommonFavorItemTags が取れない")

    gifts = []
    for it in items:
        tags = it.get("Tags") or []
        exp = it.get("ExpValue") or 0
        if not tags or not exp:
            continue
        if not str(it.get("Icon", "")).startswith("item_icon_favor"):
            continue
        gifts.append({"id": it["Id"], "n": it["Name"], "e": exp, "t": tags,
                      "i": it["Icon"], "r": it.get("Rarity", "")})
    gifts.sort(key=lambda g: (-g["e"], g["id"]))

    stu = []
    for s in students:
        if not s.get("Name"):
            continue
        # **好みのタグは 2 本ある。**`FavorItemTags` が「好き」、
        # `FavorItemUniqueTags` がゲーム内の「とくに好き」で、倍率を数えるときは
        # 両方を足す。SchaleDB の `common.js` も
        # `[...FavorItemTags, ...FavorItemUniqueTags, ...genericTags]` としている。
        # **`FavorItemUniqueTags` を落としていて、237 人の倍率がずれていた**
        # （2026-08-30 に気づいた。274 人全員が持っている列）
        stu.append({"id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]),
                    "t": s.get("FavorItemTags", []) or [],
                    "u": s.get("FavorItemUniqueTags", []) or []})
    if not any(x["u"] for x in stu):
        raise SystemExit("FavorItemUniqueTags が 1 人も取れない。列名が変わった疑い")
    stu.sort(key=lambda s: s["n"])

    # need[L-1] = 絆 L から L+1 へ上がるのに要る経験値。**列の名前は ExpType。**
    need = [0] * 100
    for row in as_list(favor):
        lv = row.get("Level")
        if lv and 1 <= lv <= 100:
            v = row.get("ExpType") or row.get("Exp") or 0
            need[lv - 1] = v[0] if isinstance(v, list) else v

    n = 0
    for g in gifts:
        n += fetch_icon(g["i"], f"https://schaledb.com/images/item/icon/{g['i']}.webp")
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    print(f"  アイコン {n} 枚を追加")

    return write_js("tools/bond/data.js", "BOND", {
        "gen": gen, "gifts": gifts, "students": stu, "need": need,
        "version": "SchaleDB jp ／ electricgoat/ba-data jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 先生レベル

def build_teacher_level():
    print("先生レベル計算機")
    acc = as_list(get_json(BADB.format("AccountLevelExcelTable")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))
    mx, ratio = 90, 1
    # Lv90 のあと、AP は熟達証書（MasterCoin）に変わる。**週の上限は AP で決まる**
    coin_week, plus1, plus2 = 12000, 0, 0
    for row in const:
        if "AccountMaxLevel" in row:
            mx = row["AccountMaxLevel"]
        if "AccountExpRatio" in row:
            ratio = row["AccountExpRatio"]
        if "MaxApMasterCoinPerWeek" in row:
            coin_week = row["MaxApMasterCoinPerWeek"]
        if "PlusMaxApMasterCoinPerWeek1" in row:
            plus1 = row["PlusMaxApMasterCoinPerWeek1"]
        if "PlusMaxApMasterCoinPerWeek2" in row:
            plus2 = row["PlusMaxApMasterCoinPerWeek2"]

    # **新米先生経験値ブーストの倍率は `DB/` 側にしかない。**
    # `Excel/AccountLevelExcelTable` の列は Id / Level / Exp / APAutoChargeMax /
    # NeedReportEvent だけで、`NewbieExpRatio` が落ちている（2026-08-30 に気づいた）。
    # 値は 10000 分率で、25000 なら「獲得経験値 +250%」。月額商品ぶんの
    # PlusExpRatio1 / 2 も同じ表にある
    accdb = {r["Level"]: r for r in as_list(get_json(BADB.format("AccountLevelExcelTable")))
             if "Level" in r}
    rows = {r["Level"]: r for r in acc if "Level" in r}
    exp_to_next, ap_cap, newbie = [], [], []
    for lv in range(1, mx + 1):
        r = rows.get(lv, {})
        ap_cap.append(r.get("APAutoChargeMax", 0))
        if lv < mx:
            exp_to_next.append(r.get("Exp", 0))
            newbie.append(accdb.get(lv, {}).get("NewbieExpRatio", 0))
    if not any(newbie):
        raise SystemExit("新米先生ブーストの倍率が 1 つも取れない。DB 側の列名が変わった疑い")
    def one(key):
        vals = {r.get(key, 0) for r in accdb.values() if r.get(key)}
        if len(vals) != 1:
            raise SystemExit(f"{key} が全レベルで同じでない: {sorted(vals)}")
        return vals.pop()

    p1, p2 = one("PlusExpRatio1"), one("PlusExpRatio2")

    fetch_icon("currency_icon_ap", "https://schaledb.com/images/item/icon/currency_icon_ap.webp")
    return write_js("tools/teacher-level/data.js", "TEACHER_LEVEL", {
        "maxLevel": mx, "accountExpRatio": ratio,
        "expToNext": exp_to_next, "apCap": ap_cap, "newbie": newbie,
        "plusExp": [p1, p2],
        "coinWeek": coin_week, "coinPlus1": plus1, "coinPlus2": plus2,
        "source": "electricgoat/ba-data jp",
        "version": "electricgoat/ba-data jp（DB/AccountLevelExcelTable ほか）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 装備設計図

CAT_JA = {"Hat": "帽子", "Gloves": "手袋", "Shoes": "靴", "Bag": "カバン", "Badge": "バッジ",
          "Hairpin": "ヘアピン", "Charm": "お守り", "Watch": "腕時計", "Necklace": "ネックレス"}
CATS = list(CAT_JA)

# **設計図が入っていないと分かっている箱。**500100 は任務ノーマル・ハードの
# 250 ステージ全部に 1 個ずつ付いていて、どのステージの設計図の差にもならない。
# ba-data の `GachaElementExcelTable`（2025-05-07）には無いので、
# 番人に引っかからないよう名指しで外す（2026-08-30 に 250 件を数えて確認）
BOX_NOT_EQUIP = {500100}


def build_equipment():
    print("装備設計図の周回計算機")
    # **装備・設計図・レシピの正本は SchaleDB の本番データ。**
    # ba-data の jp ブランチは `Excel/EquipmentExcelTable.json` が
    # **2025-01-20 で止まっていて**、お守り・腕時計・ネックレスの T10 が入っていない。
    # そのせいで（1）最大 Tier が T9 に見え、（2）Area 29 の T10 設計図のドロップが
    # 設計図として認識されず**まるごと消えていた**（2026-08-30 に実測して差し替えた）。
    # `Excel/GachaElementExcelTable.json` は 2025-05-07 だが、箱の中身の比率は
    # SchaleDB に無いのでこちらを使う（下に、知らない箱が出たら止まる番人を置いた）
    sd_eq = as_list(get_json(SD.format("equipment")))
    gacha_el = as_list(get_json(BADB.format("GachaElementExcelTable")))
    loc_stage = [x for x in as_list(get_json(SD.format("stages")))
                 if x.get("Category") == "Campaign"]

    # **`IsReleased` は [Jp, Global, Cn] の順。**日本向けなので 0 番だけを見る。
    # お守り・腕時計・ネックレスの T10 は [true, true, false]（中国だけ未実装）で、
    # 「どこかが false なら未実装」と読むと、その 3 部位だけ T9 で切れる
    def released(e):
        r = e.get("IsReleased") or []
        return bool(r[0]) if r else False

    # **選択ボックスの段は数えて出す。**手で「T2〜T8」と書いていたら T9 が
    # 増えたのに気づけなかった（2026-08-30）。ba-data の `ShopExcelTable` には
    # まだ 150045 が 1 件も無いので、SchaleDB の `items` の `Shop` フラグを見る。
    # `Regions` の 0 番目が Jp
    selbox = []
    for it in as_list(get_json(SD.format("items"))):
        m = re.fullmatch(r"T(\d+)装備設計図選択ボックス", it.get("Name") or "")
        if not m:
            continue
        shop = it.get("Shop") or []
        rel = it.get("IsReleased") or []
        if (shop[0] if shop else False) and (rel[0] if rel else False):
            selbox.append(int(m.group(1)))
    selbox.sort()
    if not selbox:
        raise SystemExit("装備設計図選択ボックスが 1 つも取れない。名前の付け方が変わった疑い")

    # **万能設計図 → 設計図 の交換レート。**`Excel/` 側は空の殻（14 バイト）で、
    # 中身は `DB/` にしかない。90 行（9 部位 × 10 段）あって、どの部位も
    # 1 / 2 / 3 / 5 / 7 / 10 / 15 / 20 / 30 / 50 で同じ（2026-08-30 に数えた）。
    # それまで攻略 wiki の表を写していた
    chg = as_list(get_json(BADB.format("EquipmentChangePieceExcelTable")))
    rate = {}
    for r in chg:
        eq = r.get("ChangeEquipmentId")
        if eq is None:
            continue
        rate.setdefault(eq, []).append(r.get("ChangeAmount", 0))
    sets = {tuple(v) for v in rate.values()}
    if len(sets) != 1:
        raise SystemExit(f"万能設計図の交換レートが部位で違う: {sorted(sets)}")
    univ_rate = list(sets.pop())
    if len(univ_rate) < 10:
        raise SystemExit(f"万能設計図の交換レートが {len(univ_rate)} 段しかない")

    # **どの部位を何人が使うか。**生徒 1 人は装備欄を 3 つ持っていて、
    # その組み合わせは生徒ごとに決まっている。ここから「部位の重み」が出る
    # （帽子は多くの生徒が使い、お守りは少ない——必要数がまるで違う）
    students = as_list(get_json(SD.format("students")))
    slots, roster = {}, 0
    for st_ in students:
        eq = st_.get("Equipment") or []
        if not st_.get("Name") or not eq:
            continue
        roster += 1
        for cat in eq:
            slots[cat] = slots.get(cat, 0) + 1

    # 設計図（piece）の Id → (部位, Tier)、万能設計図（Tier 0）、装備そのもの
    piece, names, max_tier, univ = {}, {}, {}, {}
    for e in sd_eq:
        cat, tier = e.get("Category"), e.get("Tier")
        if cat not in CAT_JA or tier is None or not released(e):
            continue
        icon = str(e.get("Icon", ""))
        if icon.endswith("_useall_piece"):
            # **万能設計図は Tier 0。**部位ごとに 1 種類あって、
            # その部位のどの Tier の設計図の代わりにもなる（2026-04-21 実装）
            univ[e["Id"]] = cat
            names[cat + "0"] = e.get("Name", "")
        elif icon.endswith("_piece"):
            piece[e["Id"]] = (cat, tier)
            names[cat + str(tier)] = e.get("Name", "")
        elif tier:
            max_tier[cat] = max(max_tier.get(cat, 0), tier)

    if sorted(max_tier) != sorted(CATS):
        raise SystemExit(f"部位が 9 つそろわない: {sorted(max_tier)}")
    if set(max_tier.values()) != {10}:
        # **T10 は 9 部位すべてにある。**`config.json` の Regions[0]（Jp）が
        # "EquipmentMaxLevel": [10, 10, 10] と言っている
        raise SystemExit(f"最大 Tier が 10 でない部位がある: {max_tier}")

    # **数え上げの検査。**設計図は 9 部位 × T2〜T10 で 81 種、万能設計図は
    # 部位ごとに 1 つで 9 種。**足りないぶんは黙って 0 枚として落ちる**ので、
    # 数が合わなければここで止める。Charm / Watch / Necklace の T10 が
    # `IsReleased` の読み違いで消えたときも、この検査があれば気づけた（2026-08-30）
    want_pieces = {(c, t) for c in CATS for t in range(2, 11)}
    got_pieces = set(piece.values())
    if got_pieces != want_pieces:
        raise SystemExit(f"設計図が 81 種そろわない。欠け: {sorted(want_pieces - got_pieces)}／"
                         f"余り: {sorted(got_pieces - want_pieces)}")
    if sorted(univ.values()) != sorted(CATS):
        raise SystemExit(f"万能設計図が 9 部位そろわない: {sorted(univ.values())}")
    if len(names) != 90:
        raise SystemExit(f"設計図の名前が 90 個にならない: {len(names)} 個")

    # ティアアップのレシピ。**SchaleDB の `Recipe` は「その装備を作る」手順**で、
    # 中身は `[[設計図の Id, 枚数], …]`、クレジットは `RecipeCost`。
    # ba-data は「Tier N の装備が N→N+1 を持つ」形だったので、添字が 1 段ずれる
    recipes = {c: {} for c in CATS}
    for e in sd_eq:
        cat, tier = e.get("Category"), e.get("Tier")
        if cat not in CAT_JA or not tier or not released(e):
            continue
        if str(e.get("Icon", "")).endswith("_piece"):
            continue
        pairs = [[piece[pid][1], cnt] for pid, cnt in (e.get("Recipe") or []) if pid in piece]
        if pairs:
            recipes[cat][tier] = {"ing": pairs, "credit": e.get("RecipeCost", 0) or 0}

    # **1 個を T1 から T10 まで上げるのに要る、各 Tier の設計図の枚数。**
    # レシピを足すだけ。参考元「シャーレ装備管理室」が持っている表と
    # 一致することを確かめてある（2026-08-30。あちらの `Ne` 定数）
    per_set = {}
    for cat in CATS:
        tot = {}
        for r in recipes[cat].values():
            for tier, cnt in r["ing"]:
                tot[tier] = tot.get(tier, 0) + cnt
        per_set[cat] = tot
    ref_set = {2: 40, 3: 45, 4: 50, 5: 55, 6: 65, 7: 65, 8: 60, 9: 50, 10: 60}
    for cat in CATS:
        # **レシピは T2〜T10 の 9 段ぶんそろっていること。**1 段抜けても
        # per_set の合計だけは近い値になりうるので、段数を別に数える
        if sorted(recipes[cat]) != list(range(2, 11)):
            raise SystemExit(f"{cat} のレシピが T2〜T10 でそろわない: {sorted(recipes[cat])}")
        if per_set[cat] != ref_set:
            raise SystemExit(f"{cat} の 1 セットぶんが参考元と食い違う: {per_set[cat]}")

    # 箱（GachaGroup）の中身。**比率は GachaElement に出ている。**
    # 「半分ずつ」と仮定する必要はない。
    # **分母は箱に入っている全部で取る。**設計図以外（できあがった T1 の装備など）を
    # 先に捨ててから割ると、設計図の期待値が水増しされる。たとえば箱 601001 は
    # 「T1 の帽子 1 ／ T2 の設計図 2」の 3 枠で、T2 は 2/3 枠ぶんしか出ない。
    # 3/3 として数えていたので Area 10・11 の 10 本が 1.5 倍になっていた
    # （2026-08-30、参考元の表と 1 本ずつ突き合わせて見つけた）
    boxes, box_tot = {}, {}
    for r in gacha_el:
        gid = r.get("GachaGroupID")
        if gid is None:
            continue
        box_tot[gid] = box_tot.get(gid, 0) + r.get("Prob", 0)
        if r.get("ParcelType") != "Equipment":
            continue
        pid = r.get("ParcelID")
        if pid not in piece:
            continue
        boxes.setdefault(gid, []).append(
            (piece[pid], r.get("Prob", 0), (r.get("ParcelAmountMin", 1) + r.get("ParcelAmountMax", 1)) / 2.0))

    out, unknown_box = [], set()
    for st in loc_stage:
        sid = st.get("Id")
        # Id は 1 CC D T SS。CC=章、D=難易度(1 Normal / 2 Hard)、
        # T=種別(1 Main / 2 Sub)、SS=何番目。**T を落とすと番号が 101 になる**
        txt = str(sid)
        if len(txt) != 7 or txt[0] != "1":
            continue
        area, diff, kind, num = int(txt[1:3]), int(txt[3]), int(txt[4]), int(txt[5:])
        if diff not in (1, 2) or kind != 1:
            continue

        acc, uni = {}, {}
        def add(cat, tier, v):
            acc[(cat, tier)] = acc.get((cat, tier), 0) + v
        for r in st.get("Rewards", []):
            # FirstClear / ThreeStar は周回では出ない。**繰り返し出るぶんだけ数える**
            if r.get("RewardType"):
                continue
            pid, kind_ = r.get("Id"), r.get("Type")
            amt = r.get("Amount", 1)
            if r.get("AmountMin") is not None and r.get("AmountMax") is not None:
                amt = (r["AmountMin"] + r["AmountMax"]) / 2.0
            ev = amt * (r["Chance"] if r.get("Chance") is not None else 1.0)
            if kind_ == "Equipment" and pid in piece:
                add(piece[pid][0], piece[pid][1], ev)
            elif kind_ == "Equipment" and pid in univ:
                uni[univ[pid]] = uni.get(univ[pid], 0) + ev
            elif kind_ == "GachaGroup":
                # **知らない箱が出たら止める。**箱の中身だけは ba-data
                # （2025-05-07）に頼っていて、そこから先に増えた箱は
                # 黙って 0 枚として落ちる。落ちたことに気づけるようにする
                if pid not in boxes:
                    if pid not in BOX_NOT_EQUIP:
                        unknown_box.add(pid)
                    continue
                tot = box_tot.get(pid) or sum(x[1] for x in boxes[pid]) or 1
                for (cat, tier), prob, n_ in boxes[pid]:
                    add(cat, tier, ev * (prob / tot) * n_)
        if not acc:
            continue
        d = [[c, t, round(v, 4)] for (c, t), v in sorted(acc.items())]
        b = [[c, round(v, 3)] for c, v in sorted(uni.items())]
        ap = 0
        for cost in st.get("EntryCost", []):
            if len(cost) == 2:
                ap += cost[1]
        out.append({"id": sid, "a": area, "s": num, "h": 1 if diff == 2 else 0,
                    "n": st.get("Name", ""), "ap": ap, "d": d, "b": b})
    out.sort(key=lambda x: (x["a"], x["h"], x["s"]))
    if unknown_box:
        raise SystemExit(f"中身の分からない箱がステージに出た: {sorted(unknown_box)}。"
                         "ba-data の GachaElementExcelTable が追いついていない")

    # **数え上げの検査（ステージ側）。**2026-08-30 の実測は
    # ノーマル 90 本・ハード 54 本の 144 本。**増えるぶんには止めない**が、
    # **減ったら止める。**設計図の判定が壊れると、ステージがまるごと
    # `acc` 空で落ちて静かに消える（Area 29 の T10 がそうだった）
    n_normal = sum(1 for x in out if not x["h"])
    n_hard = len(out) - n_normal
    if n_normal < 90 or n_hard < 54:
        raise SystemExit(f"周回できるステージが減った: ノーマル {n_normal} 本"
                         f"（90 本以上のはず）／ハード {n_hard} 本（54 本以上のはず）")
    if any(x["ap"] <= 0 for x in out):
        raise SystemExit("AP が 0 のステージがある: "
                         + str([x["id"] for x in out if x["ap"] <= 0]))
    # **どの設計図も、どこかのステージから出ること。**出ないものがあると
    # 希少価値が 100 の固定値になり、その部位ばかり推される
    dropped = {(c, t) for x in out for c, t, _ in x["d"]}
    missing = sorted(want_pieces - dropped)
    if missing:
        raise SystemExit(f"どのステージからも出ない設計図がある: {missing}")
    if {c for x in out for c, _ in x["b"]} != set(CATS):
        raise SystemExit("万能設計図が出ない部位がある")

    n = 0
    for cat in CATS:
        for t in range(2, max_tier.get(cat, 0) + 1):
            nm = f"equipment_icon_{cat.lower()}_tier{t}_piece"
            n += fetch_icon(nm, f"https://schaledb.com/images/equipment/icon/{nm}.webp")
    # **選択ボックスのアイコンは、並ぶ段のぶんだけ取る。**2〜8 で決め打ちに
    # していたので、T9 が増えたときにアイコンだけ 404 になっていた（2026-08-30）
    for t in selbox:
        nm = f"equipment_icon_selection_tier{t}_piece"
        n += fetch_icon(nm, f"https://schaledb.com/images/item/icon/{nm}.webp")
    for cat in CATS:
        nm = f"equipment_icon_{cat.lower()}_useall_piece"
        n += fetch_icon(nm, f"https://schaledb.com/images/equipment/icon/{nm}.webp")
    print(f"  アイコン {n} 枚を追加、周回できるステージ {len(out)} 本")

    # **目標セット数の初期値は参考元のものをそのまま写す。**
    # 「シャーレ装備管理室」の `se` 定数（2026-08-30 に確認）。生徒の人数から
    # 機械的に出せる値ではないので、こちらで作らずに借りている
    def_sets = {"Hat": 3, "Gloves": 2, "Shoes": 4, "Bag": 2, "Badge": 2,
                "Hairpin": 4, "Charm": 1, "Watch": 4, "Necklace": 2}
    if sorted(def_sets) != sorted(CATS):
        raise SystemExit("目標セット数の初期値と部位が合わない")

    return write_js("tools/equipment/data.js", "EQUIP", {
        "cats": CATS, "catJa": CAT_JA, "maxTier": max_tier,
        "recipes": recipes, "perSet": per_set, "defSets": def_sets,
        "stages": out, "names": names,
        "slots": slots, "roster": roster, "selbox": selbox, "univRate": univ_rate,
        "version": "SchaleDB jp（装備・設計図・レシピ・ステージ・ドロップ・AP・万能設計図）／ "
                   "electricgoat/ba-data jp（万能設計図の交換レート・箱の比率）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ Tier 表

def build_tier():
    print("Tier 表メーカー")
    students = as_list(get_json(SD.format("students")))
    loc = get_json(SD.format("localization"))

    keep = ("School", "TacticRole", "BulletType", "ArmorType", "SquadType")
    labels = {k: loc.get(k, {}) for k in keep}

    stu = []
    for s in students:
        if not s.get("Name"):
            continue
        stu.append({
            "id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]),
            "sc": s.get("School", "ETC"), "ro": s.get("TacticRole", ""),
            "bt": s.get("BulletType", ""), "at": s.get("ArmorType", ""),
            "sq": s.get("SquadType", ""), "st": s.get("StarGrade", 0),
        })
    stu.sort(key=lambda x: (-x["st"], x["n"]))

    n = 0
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    print(f"  アイコン {n} 枚を追加、生徒 {len(stu)} 人")

    return write_js("tools/tier/data.js", "TIER", {
        "students": stu, "labels": labels,
        "version": "SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 総力戦の相性

# ボスの立ち絵のファイル名は **DevName**。PathName（小文字）とは別物で、
# ゲヘナ側の内部名（EN0010 など）が入っている。**当てずっぽうで探さない**
# ——2026-08-30 に EN0008 / EN0009 / EN0011 と推測して 3 体ぶん別のボスの絵を
# 出していた。schaledb.com 側も images/raid/icon/Icon_${DevName}.png で引いている。
# ------------------------------------------------------------ ボスのスキル文

# SchaleDB の `RaidSkills[].Desc` には、ゲーム内と同じ表記タグが混ざっている。
# **中身の日本語は完成していて、`{0}` のような差し込みは 1 件も無い**
# （2026-08-31 に 345 件ぜんぶを数えて確かめた）。やることはタグの読み替えだけ。
#
#   <b:ATK>   バフ    → localization の BuffName["Buff_ATK"]   = 攻撃力
#   <d:DEF>   デバフ  → BuffName["Debuff_DEF"] が無ければ Buff_DEF に落ちる
#   <c:Stunned>  行動不能 → BuffName["CC_Stunned"]      = 気絶状態
#   <s:Immortal> 特殊   → BuffName["Special_Immortal"]  = 不死身状態
#   <up>…</up>  上位難易度で強くなった箇所
#   <b>…</b> <i>…</i>  そのまま
#   <b class='ba-col-mystic'>  属性の色
#   <?1>  **SchaleDB 側に数値が入っていない箇所**（セトの憤怒など）。
#         勝手に埋めない。「？」のまま出して、出典の節で断る
RS_PREFIX = {"b": "Buff", "d": "Debuff", "c": "CC", "s": "Special"}
RS_TAG = re.compile(r"<(/?)(b|i|up)>|<([bdcs]):([A-Za-z0-9_]+)>"
                    r"|<b class='ba-col-([a-z]+)'>|<\?(\d+)>")


def raid_skill_html(desc, buffname):
    """スキルの説明を、そのまま innerHTML に入れられる形にする。
    **タグ以外は全部エスケープする。**素の `<` が来ても崩れないように。"""
    out, pos, unknown = [], 0, []
    for m in RS_TAG.finditer(desc):
        out.append(html.escape(desc[pos:m.start()]))
        pos = m.end()
        close, base, pre, nm, col, _q = (m.group(1), m.group(2), m.group(3),
                                         m.group(4), m.group(5), m.group(6))
        if base:
            tag = {"b": "b", "i": "i", "up": "em"}[base]
            cls = ' class="up"' if base == "up" and not close else ""
            out.append(f"</{tag}>" if close else f"<{tag}{cls}>")
        elif pre:
            ja = buffname.get(f"{RS_PREFIX[pre]}_{nm}") or buffname.get(f"Buff_{nm}")
            if not ja:
                unknown.append(f"<{pre}:{nm}>")
                ja = nm
            out.append(f'<span class="bf bf-{pre}">{html.escape(ja)}</span>')
        elif col:
            out.append(f'<b class="bc-{html.escape(col)}">')
        else:
            out.append('<span class="unk" title="SchaleDB のデータに数値が入っていません">？</span>')
    out.append(html.escape(desc[pos:]))
    return "".join(out).replace("\n", "<br>"), unknown


def build_raid():
    print("総力戦・大決戦の相性チェッカー")
    raids = get_json(SD.format("raids"))
    students = as_list(get_json(SD.format("students")))
    loc = get_json(SD.format("localization"))
    cfg = get_json(SD_CFG)

    eff = cfg.get("TypeEffectiveness")
    if not eff:
        raise SystemExit("TypeEffectiveness が取れない")

    # 敵 1 体ずつのステータス。**EnemyList は難易度ごとの並び**で、その先頭がボス本体
    enemies = get_json(SD.format("enemies")).get("Enemies") or {}
    if isinstance(enemies, list):
        enemies = {str(e["Id"]): e for e in enemies if e.get("Id")}

    # **同じ難易度に敵が何体も並ぶ。**先頭がボス本体で、2 体目以降は
    # パーツ・分身・雑魚（2026-08-31 に確かめた。ドラム缶ガニは 9 体、
    # イェソドは 8 体、ケセドとホバークラフトは 7 体）。
    # ここを先頭だけで読むと「ボスの中身」がまるごと落ちる
    def parts(ids):
        out = []
        for i in (ids or [])[1:]:
            e = enemies.get(str(i))
            if not e or not e.get("Name"):
                continue
            out.append({"n": e["Name"], "rk": e.get("Rank", ""),
                        "hp": e.get("MaxHP1", 0), "ic": e.get("Icon", "") or ""})
        return out

    def boss_stats(r):
        rows = []
        for ids in r.get("EnemyList") or []:
            e = enemies.get(str(ids[0])) if ids else None
            if not e:
                rows.append(None)
                continue
            rows.append({
                "en": e.get("Name", ""), "eic": e.get("Icon", "") or "",
                "pt": parts(ids),
                "hp": e.get("MaxHP1", 0), "atk": e.get("AttackPower1", 0),
                "df": e.get("DefensePower1", 0), "acc": e.get("AccuracyPoint", 0),
                "dg": e.get("DodgePoint", 0), "cr": e.get("CriticalPoint", 0),
                "sp": e.get("StabilityPoint", 0), "sr": e.get("StabilityRate", 0),
                "rg": e.get("Range", 0), "sz": e.get("Size", ""),
                "at": e.get("ArmorType", ""), "bt": e.get("BulletType", ""),
                # HP がこの値を割るとフェーズが変わる。**割合ではなく実数で入っている**
                "ph": [x.get("Argument", 0) for x in (e.get("PhaseChange") or [])
                       if x.get("Trigger") == "HPUnder"],
            })
        return rows

    # ボスのスキル。**難易度ごとに別のキーが並ぶ**（BinahExSkill01 →
    # BinahInsaneExSkill01 → BinahTormentExSkill01 → BinahLunaticExSkill01）。
    # 説明文は SchaleDB 側で日本語まで焼き込み済みで、埋める差し込みは無い
    raid_skills = raids.get("RaidSkills") or {}
    if len(raid_skills) < 300:
        raise SystemExit(f"RaidSkills が {len(raid_skills)} 件しかない。データの形が変わった疑い")
    buffname = loc.get("BuffName") or {}
    skills, unknown_tags = {}, set()

    def take_skills(lst):
        """難易度（または階層）ごとのスキルキーの並びを、そのまま返して控える。"""
        out = []
        for keys in lst or []:
            row = []
            for k in keys or []:
                sk = raid_skills.get(k)
                if not sk:
                    continue          # 通常攻撃はテキスト化されていない
                if k not in skills:
                    desc, unk = raid_skill_html(sk.get("Desc", ""), buffname)
                    unknown_tags.update(unk)
                    skills[k] = {"n": sk.get("Name", ""), "d": desc,
                                 "ty": sk.get("SkillType", ""),
                                 "atg": sk.get("ATGCost", 0)}
                row.append(k)
            out.append(row)
        return out

    # グロッキー条件。**キーはボスの DevName そのもの。**
    # 載っていないボスは「ダメージを与えると溜まる」ふつうの方式
    groggy = loc.get("GroggyCondition") or {}
    # フェーズの言い回しもゲーム内の文をそのまま使う
    phase_fmt = (loc.get("RaidChangePhase") or {}).get("HPUnder", "")

    bosses = []
    for r in raids.get("Raid", []):
        if not r.get("Name"):
            continue
        bosses.append({
            "sk": take_skills(r.get("RaidSkillList")),
            "gg": groggy.get(r.get("DevName", ""), ""),
            "id": r["Id"], "n": r["Name"], "p": r["PathName"],
            "dev": r.get("DevName", ""),
            "tr": r.get("Terrain", []),
            "bt": r.get("BulletType", "Normal"),
            "bti": r.get("BulletTypeInsane", ""),
            "at": r.get("ArmorType", "Normal"),
            "mx": (r.get("MaxDifficulty") or [6])[0],
            "dur": r.get("BattleDuration", 0),
            "st": boss_stats(r),
        })

    # 大決戦は、開催のたびに 3 つの装甲が割り当てられる。
    # **どの組み合わせが来るかは開催ごとに違う**ので、過去の実績を候補として持っておく。
    # `OpenDifficulty` は「装甲 → その装甲で開く最高難易度の番号」（6 が Torment）。
    # **RaidSeasons は 3 本入っていて中身が違う。**先頭がいちばん長いのでそれを使う
    elim = []
    seasons = raids.get("RaidSeasons") or []
    for e in (seasons[0].get("EliminateSeasons", []) if seasons else []):
        od = e.get("OpenDifficulty") or {}
        if not od:
            continue
        elim.append({"id": e.get("RaidId"), "tr": e.get("Terrain"),
                     "od": od, "t": e.get("Start", 0)})
    elim.sort(key=lambda x: -x["t"])

    # 制約解除決戦（MultiFloorRaid）。**階層で区切られていて、区間ごとに攻撃属性が変わる。**
    # 装甲は変わらないが、同じボスに装甲違いの枠が用意されている
    multi = []
    for m in raids.get("MultiFloorRaid", []):
        rel = m.get("IsReleased") or [False]
        if not rel[0] or not m.get("Name"):
            continue
        floors = m.get("DifficultyStartFloor") or []
        elist = m.get("EnemyList") or []
        secs = []
        for i, bt in enumerate(m.get("BulletType") or []):
            e = enemies.get(str(elist[i][0])) if i < len(elist) and elist[i] else None
            secs.append({
                "bt": bt,
                "pt": parts(elist[i] if i < len(elist) else None),
                "en": (e or {}).get("Name", ""), "eic": (e or {}).get("Icon", "") or "",
                "lo": floors[i] if i < len(floors) else 0,
                "hi": (floors[i + 1] - 1) if i + 1 < len(floors) else 0,
                "st": ({"hp": e.get("MaxHP1", 0), "atk": e.get("AttackPower1", 0),
                        "df": e.get("DefensePower1", 0), "acc": e.get("AccuracyPoint", 0),
                        "dg": e.get("DodgePoint", 0), "cr": e.get("CriticalPoint", 0),
                        "sp": e.get("StabilityPoint", 0), "sr": e.get("StabilityRate", 0),
                        "rg": e.get("Range", 0), "sz": e.get("Size", ""),
                        "at": e.get("ArmorType", ""), "bt": e.get("BulletType", ""),
                        "ph": []} if e else None)})
        multi.append({"sk": take_skills(m.get("RaidSkillList")),
                      "gg": groggy.get(m.get("DevName", ""), ""),
                      "id": m["Id"], "n": m["Name"], "p": m.get("PathName", ""),
                      "dev": m.get("DevName", ""), "at": m.get("ArmorType", "Normal"),
                      "tr": m.get("Terrain", []), "dur": m.get("BattleDuration", 0),
                      "secs": secs})

    stu = []
    for s in students:
        if not s.get("Name"):
            continue
        w = s.get("Weapon") or {}
        stu.append({
            "id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]),
            "bt": s.get("BulletType", ""), "at": s.get("ArmorType", ""),
            "ro": s.get("TacticRole", ""), "sq": s.get("SquadType", ""),
            "st": s.get("StarGrade", 0), "sc": s.get("School", "ETC"),
            # 地形適性。0=D 1=C 2=B 3=A 4=S 5=SS
            "ad": {"Street": s.get("StreetBattleAdaptation", 0),
                   "Outdoor": s.get("OutdoorBattleAdaptation", 0),
                   "Indoor": s.get("IndoorBattleAdaptation", 0)},
            # **専用武器を持たせると、ここに書いてある地形の適性が上がる。**
            # 見落とすと「この子は D だから外す」と間違える
            "wa": w.get("AdaptationType", ""), "wv": w.get("AdaptationValue", 0),
        })
    stu.sort(key=lambda x: (-x["st"], x["n"]))

    n = 0
    for b in bosses:
        if not b["dev"]:
            print(f"    DevName が無い: {b['n']}", file=sys.stderr)
            continue
        n += fetch_raw("boss_" + b["p"],
                       f"https://schaledb.com/images/raid/Boss_Portrait_{b['dev']}_Lobby.png")
        # 四角いアイコン。**ドラム缶ガニだけまだ用意されていない**
        fetch_icon("bossicon_" + b["p"],
                   f"https://schaledb.com/images/raid/icon/Icon_{b['dev']}.png")
    for m in multi:
        if m["dev"]:
            n += fetch_raw("boss_" + m["p"],
                           f"https://schaledb.com/images/raid/Boss_Portrait_{m['dev']}_Lobby.png")
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")

    # パーツ・分身・雑魚のアイコン。**Icon が空の敵がいる**（グレゴリオの
    # パイプオルガンなど）ので、その子は絵無しで出す
    icons = set()
    for b in bosses:
        for row in b["st"]:
            if not row:
                continue
            icons.add(row["eic"])
            icons.update(x["ic"] for x in row["pt"])
    for m in multi:
        for sec in m["secs"]:
            icons.add(sec["eic"])
            icons.update(x["ic"] for x in sec["pt"])
    icons.discard("")
    for ic in sorted(icons):
        n += fetch_icon("enemy_" + ic, f"https://schaledb.com/images/enemy/{ic}.webp")
    print(f"  画像 {n} 枚を追加、ボス {len(bosses)} 体、制約解除決戦 {len(multi)} 枠、"
          f"スキル {len(skills)} 個、敵アイコン {len(icons)} 種")
    if unknown_tags:
        print(f"    読めない表記タグ: {sorted(unknown_tags)}", file=sys.stderr)

    labels = {k: loc.get(k, {}) for k in
              ("BulletType", "ArmorType", "TacticRole", "SquadType", "School",
               "AdaptationType", "RaidDifficulty", "EnemyRank", "CharacterSize",
               "SkillType")}
    # **属性は増える。**（2026-08 に Chemical と CompositeArmor が入った）
    # ページ側で決め打ちにせず、実際に出てくるものをここから渡す
    bullets = [k for k in eff if k not in ("Normal",)]
    armors = [k for k in (eff.get("Normal") or {}) if k not in ("Normal", "Structure")]

    return write_js("tools/raid/data.js", "RAID", {
        "bosses": bosses, "elim": elim, "multi": multi, "students": stu,
        "eff": eff, "labels": labels, "bullets": bullets, "armors": armors,
        "skills": skills, "phaseFmt": phase_fmt,
        "version": "SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 生徒 1 人の育成費用

# レシピ Id は **生徒 Id × 1000 ＋ 枠 × 100 ＋ 段**。実際に確かめた並びは
#   枠 0 CharacterTranscendence  星上げ    ★1→2 …★4→5（4 段）
#   枠 1 SkillLevelUp            EX スキル  Lv1→2 …Lv4→5（4 段）
#   枠 2 SkillLevelUp            EX 以外    Lv1→2 …Lv8→9（8 段）
#   枠 3 WeaponTranscendence     固有武器   ★1→2 …（開いている段だけ）
#   枠 4 EquipmentTierUp         愛用品     T1→T2
#
# **クレジットと、星・固有武器の神名文字の数は、223 人ぜんぶで同じ値だった**ので
# ここから定数として取り出す。素材そのもの（BD・ノート・オーパーツ）は生徒ごとに違う。
#
# **素材は SchaleDB を正本にする。**ba-data の jp ブランチには 223 人ぶんしか
# レシピが入っておらず、SchaleDB の 274 人と 51 人ずれる（装備の万能設計図と同じ）。
#
# **Lv9→Lv10 だけは生徒ごとのレシピが無い。**秘伝ノート 1 冊で誰でも同じなので、
# 99999 番の共通レシピ（99999208）に 1 本だけ置いてある。
SC_LAST_SKILL = 99999 * 1000 + 2 * 100 + 8      # Lv9→Lv10。秘伝ノート


# 素材の種別。**アイコンの名前で決まる。**Category はどれも "Material" で区別が付かない
#   item_icon_material_exskill_<学校>_<段>  戦術教育 BD（EX スキル用）
#   item_icon_skillbook_<学校>_<段>         技術ノート（EX 以外のスキル用）
#   item_icon_skillbook_ultimate            秘伝ノート（Lv9→Lv10。誰でも共通）
#   item_icon_material_<名前>_<段>          オーパーツ（生徒ごとに違う。逆引きの主役）
def mat_kind(it, stone):
    if stone:
        return "stone"
    ic = it.get("Icon", "")
    if ic.startswith("item_icon_material_exskill_"):
        return "bd"
    if ic == "item_icon_skillbook_ultimate":
        return "ult"
    if ic.startswith("item_icon_skillbook_"):
        return "note"
    if ic.startswith("item_icon_favor"):
        return "gift"          # 愛用品の T1→T2 に使う贈り物
    if ic.startswith("item_icon_material_"):
        return "oopart"
    return "etc"


def mat_tier(it):
    """初級=0 …最上級=3。アイコン末尾の数字がそのまま段になっている。"""
    ic = it.get("Icon", "")
    tail = ic.rsplit("_", 1)[-1]
    return int(tail) if tail.isdigit() else 0


def build_student_cost():
    print("生徒 1 人の育成費用")
    students = as_list(get_json(SD.format("students")))
    items = as_list(get_json(SD.format("items")))
    lv_tbl = as_list(get_json(BADB.format("CharacterLevelExcelTable")))
    ing = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeIngredientExcelTable")))}

    item_by_id = {it["Id"]: it for it in items if it.get("Name")}

    # Lv n から n+1 へ要る経験値。**Lv90 の行は 0**（そこが上限）
    need = []
    for r in sorted(lv_tbl, key=lambda x: x.get("Level", 0)):
        if r.get("Level") and 1 <= r["Level"] <= 90:
            need.append(r.get("Exp", 0))
    if len(need) != 90:
        raise SystemExit(f"CharacterLevelExcelTable が 90 行でない（{len(need)}）")

    rep = []
    for it in items:
        if it.get("Category") == "CharacterExpGrowth" and it.get("ExpValue"):
            rep.append({"id": it["Id"], "n": it["Name"], "e": it["ExpValue"], "i": it["Icon"]})
    rep.sort(key=lambda x: x["e"])
    if len(rep) != 4:
        raise SystemExit(f"レポートが 4 種でない（{len(rep)}）")

    def only(vals, what):
        """全員で同じ値になっているはずのものを 1 つに畳む。**ずれていたら止める。**"""
        uniq = set(vals)
        if len(uniq) != 1:
            raise SystemExit(f"{what} が生徒ごとに違う: {sorted(uniq)[:5]}")
        return uniq.pop()

    # 段ごとのクレジットと、星・武器の神名文字の数を 223 人から取り出す
    credit, stones = {}, {}
    for slot in (0, 1, 2, 3, 4):
        for step in range(9):
            rows = [r for i, r in ing.items()
                    if 10000000 <= i < 99000000 and (i % 1000) // 100 == slot and i % 100 == step]
            if not rows:
                continue
            credit[(slot, step)] = only([tuple(r["CostAmount"]) for r in rows],
                                        f"枠 {slot} 段 {step} のクレジット")[0]
            if slot in (0, 3):
                stones[(slot, step)] = only([tuple(r["IngredientAmount"]) for r in rows],
                                            f"枠 {slot} 段 {step} の神名文字")[0]
    last = ing.get(SC_LAST_SKILL)
    if not last:
        raise SystemExit(f"共通レシピ {SC_LAST_SKILL}（Lv9→Lv10）が無い")
    credit[(2, 8)] = last["CostAmount"][0]

    # 日本で開いている固有武器の段。**`CharacterWeaponExcelTable` の `Unlock` は
    # 使わない**（224 本すべて `[true,true,true,false,false]` のままで★3 に見える）。
    # SchaleDB の `config.json` の `Regions[Jp].WeaponMaxLevel` が 60 ＝★4。
    # 固有武器の強化計算機（`build_weapon`）と同じ出どころに揃えてある
    cfg = get_json(SD_CFG)
    jp = next((r for r in cfg.get("Regions", []) if r.get("Name") == "Jp"), None)
    if not jp:
        raise SystemExit("config.json に Jp の Regions が無い")
    jp_wstar = jp["WeaponMaxLevel"] // 10 - 2
    if not 2 <= jp_wstar <= 5:
        raise SystemExit(f"日本の固有武器の段が {jp_wstar} になっている")

    def wp_stone(step):
        """★(step+1) → ★(step+2) の神名文字。

        **`Excel/` を読んでいた頃、★3→★4 だけ仮置きだった。**224 本すべてが
        `IngredientAmount = 1` で、クレジット `2000000` だけ実数が入っていて、
        実数は game8 から補っていた（`WP_STAR4_STONE`）。
        **`DB/` 側には 200 が入っているので、いまは発火しない。**保険として残す。
        """
        v = stones[(3, step)]
        if step == 2 and v == 1:
            return WP_STAR4_STONE
        return v

    used = set()

    def mats(ids, amts):
        out = []
        for iid, amt in zip(ids or [], amts or []):
            out.append([iid, amt])
            used.add(iid)
        return out

    stu = []
    for s in students:
        if not s.get("Name"):
            continue
        cid = s["Id"]
        used.add(cid)                                   # 神名文字はアイテム Id ＝ 生徒 Id

        ex = [[credit[(1, i)], mats(m, a)] for i, (m, a) in
              enumerate(zip(s.get("SkillExMaterial") or [], s.get("SkillExMaterialAmount") or []))]
        sk = [[credit[(2, i)], mats(m, a)] for i, (m, a) in
              enumerate(zip(s.get("SkillMaterial") or [], s.get("SkillMaterialAmount") or []))]
        if sk:                                          # Lv9→Lv10。**誰でも秘伝ノート 1 冊**
            sk.append([credit[(2, 8)], mats(last["IngredientId"], last["IngredientAmount"])])

        tr = [[credit[(0, i)], [[cid, stones[(0, i)]]]] for i in range(4)]
        # 固有武器は日本で開いている段まで。**`Unlock` を信じない**
        # （224 本すべて `[T,T,T,F,F]` のままで★3 に見えるが、日本はもう★4。
        # 2026-08-31 の先生の指摘で気づいた——固有武器の強化計算機と
        # 星上げの計算機は先に直していて、ここだけ取り残されていた）
        wp = ([[credit[(3, i)], [[cid, wp_stone(i)]]] for i in range(jp_wstar - 1)]
              if s.get("Weapon") else [])

        gear = s.get("Gear") or {}
        gr = [[credit[(4, i)], mats(m, a)] for i, (m, a) in
              enumerate(zip(gear.get("TierUpMaterial") or [], gear.get("TierUpMaterialAmount") or []))]

        stu.append({"id": cid, "n": NAMES.get(s["Id"], s["Name"]), "r": s.get("StarGrade", 1),
                    "ex": ex, "sk": sk, "tr": tr, "wp": wp, "gr": gr})
    stu.sort(key=lambda x: x["n"])

    # 素材の名前とアイコン。
    #
    # **`item_icon_secretstone` は「神名のカケラ」（Id 23）の絵で、神名文字ではない。**
    # 神名文字は生徒ごとに 272 種あって、`item_icon_secretstone_hoshino` のように
    # **その子の顔が入った絵が 1 人ずつ用意されている。**
    # 以前はここで共通の絵に差し替えていたが、**カケラの絵が「神名文字」として出て
    # 分かりづらかった**（2026-08-30 の先生の指摘）。その子の絵を使う。
    by_name = {s["id"]: s["n"] for s in stu}
    mat = {}
    for iid in sorted(used):
        it = item_by_id.get(iid)
        if not it:
            # **未実装の生徒は神名文字だけ items に無い。**名前は生徒から作れる
            if iid in by_name:
                mat[str(iid)] = {"n": by_name[iid] + "の神名文字",
                                 "i": "item_icon_secretstone", "s": 1,
                                 "k": "stone", "t": 0, "r": "SSR"}
            else:
                print(f"    素材 {iid} が items に無い", file=sys.stderr)
            continue
        stone = it.get("Category") == "SecretStone"
        # **レアリティは枠の色に使う**（2026-08-30 の先生の指摘——
        # 「オーパーツはレアリティの色の枠があるとわかりやすいかも」）。
        # オーパーツ・ノート・BD はどれも欠片 N → 壊れた R → 摩耗した SR → 完全な SSR
        mat[str(iid)] = {"n": it["Name"].replace("\n", ""),
                         "i": it["Icon"],
                         "s": 1 if stone else 0,
                         "k": mat_kind(it, stone), "t": mat_tier(it),
                         "r": it.get("Rarity") or "N"}

    n = 0
    for v in mat.values():
        n += fetch_icon(v["i"], f"https://schaledb.com/images/item/icon/{v['i']}.webp")
    for r in rep:
        n += fetch_icon(r["i"], f"https://schaledb.com/images/item/icon/{r['i']}.webp")
    fetch_icon("currency_icon_gold", "https://schaledb.com/images/item/icon/currency_icon_gold.webp")
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    gears = sum(1 for s in stu if s["gr"])
    print(f"  アイコン {n} 枚を追加、生徒 {len(stu)} 人・素材 {len(mat)} 種・愛用品 {gears} 人")

    # 1 経験値あたりのクレジット。**`ConstCommonExcelTable` に入っている。**
    # 2026-08-30 まで 7 を手で書いていた（値は合っていた）
    ccs = as_list(get_json(BA.format("ConstCommonExcelTable")))
    cpe = next((r["CharacterLvUpCoefficient"] for r in ccs if r.get("CharacterLvUpCoefficient")), None)
    if not cpe:
        raise SystemExit("CharacterLvUpCoefficient が取れない")

    return write_js("tools/student-cost/data.js", "COST", {
        "need": need, "rep": rep, "mat": mat, "stu": stu,
        "creditPerExp": cpe,
        "version": "SchaleDB jp（生徒・素材）／ electricgoat/ba-data jp（レシピ・経験値表）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 宝探し（在庫管理）

# **文字列の Id は XXHash32（seed 0）。**LocalizeExcelTable の Key がこれで、
# `Event_Treasure_60000_06` を引くと「ショッピングバッグ」が出る。
# 依存を増やしたくないので 30 行だけ自前で持つ（xxhash モジュールの
# 407 件の照合で一致を確認済み。2026-08-30）。
_XM = 0xFFFFFFFF
_XP1, _XP2, _XP3, _XP4, _XP5 = 0x9E3779B1, 0x85EBCA77, 0xC2B2AE3D, 0x27D4EB2F, 0x165667B1


def _rotl(x, r):
    return ((x << r) | (x >> (32 - r))) & _XM


def _xround(acc, inp):
    return (_rotl((acc + inp * _XP2) & _XM, 13) * _XP1) & _XM


def xxh32(data, seed=0):
    if isinstance(data, str):
        data = data.encode()
    n, i = len(data), 0
    if n >= 16:
        v1, v2, v3, v4 = (seed + _XP1 + _XP2) & _XM, (seed + _XP2) & _XM, seed & _XM, (seed - _XP1) & _XM
        while i + 16 <= n:
            v1 = _xround(v1, int.from_bytes(data[i:i + 4], "little")); i += 4
            v2 = _xround(v2, int.from_bytes(data[i:i + 4], "little")); i += 4
            v3 = _xround(v3, int.from_bytes(data[i:i + 4], "little")); i += 4
            v4 = _xround(v4, int.from_bytes(data[i:i + 4], "little")); i += 4
        h = (_rotl(v1, 1) + _rotl(v2, 7) + _rotl(v3, 12) + _rotl(v4, 18)) & _XM
    else:
        h = (seed + _XP5) & _XM
    h = (h + n) & _XM
    while i + 4 <= n:
        h = (_rotl((h + int.from_bytes(data[i:i + 4], "little") * _XP3) & _XM, 17) * _XP4) & _XM
        i += 4
    while i < n:
        h = (_rotl((h + data[i] * _XP5) & _XM, 11) * _XP1) & _XM
        i += 1
    h = ((h ^ (h >> 15)) * _XP2) & _XM
    h = ((h ^ (h >> 13)) * _XP3) & _XM
    return h ^ (h >> 16)


def build_treasure():
    print("宝探しの確率計算機")
    # **この 4 つは Excel/ ではなく DB/ にある。**Excel/ 側は中身が空の殻だけ
    tre = as_list(get_json(BADB.format("EventContentTreasureExcelTable")))
    rounds = as_list(get_json(BADB.format("EventContentTreasureRoundExcelTable")))
    rewards = as_list(get_json(BADB.format("EventContentTreasureRewardExcelTable")))
    season = as_list(get_json(BADB.format("EventContentSeasonExcelTable")))
    loc = {r["Key"]: r.get("Jp") for r in as_list(get_json(BADB.format("LocalizeExcelTable")))}
    names = get_json(SD_CFG.replace("config.json", "jp/localization.min.json")).get("EventName") or {}

    def jp(code, fallback=""):
        return loc.get(xxh32(code)) or fallback

    rw = {r["Id"]: r for r in rewards}

    # **備品を当てると何がもらえるかも出す**（2026-08-30 に足した）。
    # `RewardParcelType` / `RewardParcelId` / `RewardParcelAmount` の 3 本が
    # 同じ長さで並んでいる。`Item` は道具、`Equipment` は装備で、**別々の表**
    item_rows = {int(i["Id"]): i for i in as_list(get_json(SD.format("items"))) if i.get("Id")}
    equip_rows = {int(i["Id"]): i for i in as_list(get_json(SD.format("equipment"))) if i.get("Id")}
    # **復刻イベントの通貨は SchaleDB の items に無い**（85363・85373・85403 の
    # 3 つが「？（Item 85373）」で画面に出ていた。2026-08-31 に実測）。
    # ba-data の ItemExcelTable ＋ LocalizeEtc の NameJp で名前と絵を埋める。
    # 絵は schaledb.com/images/item/icon/ に実体があることを 3 つとも確かめた
    etc_nm = {x["Key"]: x.get("NameJp") for x in as_list(get_json(BADB.format("LocalizeEtcExcelTable")))}
    for r in as_list(get_json(BADB.format("ItemExcelTable"))):
        iid = r.get("Id")
        if not iid or iid in item_rows:
            continue
        nm = etc_nm.get(r.get("LocalizeEtcId"))
        if nm:
            item_rows[iid] = {"Name": nm, "Icon": r.get("Icon", "")}
    item_nm = {k: v.get("Name", "") for k, v in item_rows.items()}
    equip_nm = {k: v.get("Name", "") for k, v in equip_rows.items()}

    # 報酬のアイコン。**中身そのものではなく `p`（`I243` / `E4`）で引かせる。**
    # 報酬は延べ 1,800 行あるので、行ごとにアイコン名を書くと data.js が 7 万字
    # 太る。種類は 112 しかないので、表を 1 つ持って行には札だけ置く
    used_icons = {}

    def parcels(it):
        """その備品の中身。**名前が引けないものは落とさず「？」で出す。**"""
        ty = it.get("RewardParcelType") or []
        ids = it.get("RewardParcelId") or []
        amt = it.get("RewardParcelAmount") or []
        if not (len(ty) == len(ids) == len(amt)):
            return []
        out = []
        for t, i, a in zip(ty, ids, amt):
            row = (item_rows if t == "Item" else equip_rows).get(i)
            nm = (row or {}).get("Name", "")
            rec = {"n": nm or f"？（{t} {i}）", "c": a}
            ic = (row or {}).get("Icon")
            if ic:
                key = ("I" if t == "Item" else "E") + str(i)
                used_icons[key] = {"ic": ic.rsplit("/", 1)[-1].lower(),
                                   "kind": "item" if t == "Item" else "equipment"}
                rec["p"] = key
            out.append(rec)
        return out
    # 同じ EventContentId が何行も出るので、開催期間は 1 つに畳む
    period, origin = {}, {}
    for r in season:
        eid = r.get("EventContentId")
        if eid is not None and eid not in period:
            period[eid] = (r.get("EventContentOpenTime", ""),
                           r.get("ExtensionTime") or r.get("EventContentCloseTime", ""))
            # **復刻は元のイベント名で呼ぶ。**10847 → 847 のように親が入っている
            origin[eid] = r.get("OriginalEventContentId")

    events = []
    for e in tre:
        eid = e["EventContentId"]
        rs = sorted((r for r in rounds if r["EventContentId"] == eid),
                    key=lambda r: r.get("TreasureRound", 0))
        if not rs:
            continue
        size = rs[0].get("TreasureRoundSize") or [9, 5]
        out = []
        for r in rs:
            items = []
            for rid, amt in zip(r.get("RewardID", []), r.get("RewardAmount", [])):
                it = rw.get(rid)
                if not it:
                    continue
                items.append({"n": jp(it.get("LocalizeCodeID", ""), "？"),
                              "w": it.get("CellUnderImageWidth", 1),
                              "h": it.get("CellUnderImageHeight", 1),
                              "c": amt,
                              "rw": parcels(it)})
            if len(items) == 3:
                out.append(items)
        if not out:
            continue
        op, cl = period.get(eid, ("", ""))
        # 復刻は EventName に載っていないので、元のイベント名を借りて「（復刻）」を付ける
        nm = names.get(str(eid)) or names.get(eid)
        if not nm:
            src = origin.get(eid)
            base = names.get(str(src)) or names.get(src) if src and src != eid else None
            nm = (base + "（復刻）") if base else jp(e.get("TitleLocalize", ""), f"イベント {eid}")
        events.append({
            "id": eid,
            "n": nm,
            "open": op, "close": cl,
            "loop": e.get("LoopRound", len(out)),
            "w": size[0], "h": size[1],
            "rounds": out,
        })
    # **新しいものから並べる。**ページ側は「今開いているもの」を既定にする
    events.sort(key=lambda x: (x["open"], x["id"]), reverse=True)
    if not events:
        raise SystemExit("宝探しのイベントが 1 件も取れない")

    # 報酬のアイコンを落とす。**備品そのものの絵は取れない**——`CellUnderImagePath`
    # （`UIs/01_Common/27_EventContent/Treasure/...`）はゲーム内アセットの道で、
    # SchaleDB にも ba-data にも実体が無い（2026-08-31 に叩いて確かめた。
    # schaledb.com は無い絵にも 200 で SPA の HTML を返すので、bytes で見ること）
    n = 0
    for v in used_icons.values():
        n += fetch_icon(v["ic"], f"https://schaledb.com/images/{v['kind']}/icon/{v['ic']}.webp")
    if n:
        print(f"  アイコンを {n} 枚追加")

    return write_js("tools/treasure/data.js", "TREASURE_EVENTS", {
        "events": events,
        "icons": {k: v["ic"] for k, v in used_icons.items()
                  if (IMG / (v["ic"] + ".webp")).exists()},
        "version": "electricgoat/ba-data jp（DB/EventContentTreasure*）／ SchaleDB jp"
                   "（イベント名・報酬のアイコン）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ TL のコスト計算機

# コスト回復力に触るスキルのうち、**値が段になっているもの**（Value が 2 行以上）は
# 条件で段が変わる。段の決まり方はスキル文にしか書いていないので、ここだけ表で持つ。
# 表に無い生徒は、ページ側で段を手で選ばせる（黙って 1 段目を使わない）。
COST_COND = {
    10017: "redwinter",   # チェリノ — 同部隊のレッドウィンター生徒 1 人毎（自身を除き最大 3 人）
    10126: "heavymain",   # カノエ  — 同部隊の重装甲ストライカー 1 人毎（自身を除き最大 3 人）
}


def build_cost_timeline():
    print("TL のコスト計算機")
    students = as_list(get_json(SD.format("students")))
    loc = get_json(SD.format("localization"))

    statja = loc.get("Stat") or {}
    # **CC の日本語名はここにしかない。**`BuffName` の `CC_<Icon>`
    # （`CC_Stunned` = 気絶状態、`CC_Fear` = 恐怖状態 …）
    buffja = loc.get("BuffName") or {}

    # **スキル文の差し込み記号を、SchaleDB 自身と同じ規則で人が読める形に直す。**
    # 本番サイトのフロントエンド（`SkillText` コンポーネント。`schaledb.com` の
    # ビルド `index-993c7caa.js` が呼ぶ `TypeHelper-*.js`。2026-08-31 に実物を読んで
    # 確かめた）が `<b:X>` `<d:X>` `<c:X>` `<s:X>` を `BuffName` の
    # `Buff_X` / `Debuff_X` / `CC_X` / `Special_X` で引き、`<?N>` を
    # `Parameters[N-1]` のそのレベルの値に差し替えている。`='ラベル'` が付いていれば
    # 辞書を引かずそちらを使う（`r=/^<([bdcs]):(\w+)(?:='([^']*)')?>$/` がそれ）。
    TAG_PREFIX = {"b": "Buff", "d": "Debuff", "c": "CC", "s": "Special"}
    DESC_TAG = re.compile(r"<([bdcs]):(\w+)(?:='([^']*)')?>")
    DESC_PARAM = re.compile(r"<\?([0-9]+)>")
    # 装飾用の生 HTML（`<b class='...'>強調</b>` `<up>…</up>`）は中身だけ残す。
    # **`<b:X>` とはコロンの有無で見分けがつくので、先に剥がしても衝突しない**
    DESC_HTML = re.compile(r"</?b(?: [^>]*)?>|</?up>")
    # 引けなかったキー・レベルが決められなかった `<?N>`。**黙って隠さず、報告用に集める**
    unresolved = set()

    def desc_lines(text):
        """改行の端にある生の `/` を畳む。**行末のことも行頭のこともある**
        （ツクヨの Public は「攻撃力の…ダメージ\\n/その敵が中型の場合」と行頭に付く）。
        **行の途中の `/` は触らない**（ワカモ（水着）の「9.6%/19.2%/28.9%」はただの区切り）。"""
        lines = text.split("\n")
        for i, ln in enumerate(lines):
            ln = ln.strip()
            if i > 0 and ln.startswith("/"):
                ln = ln[1:].lstrip()
            if i < len(lines) - 1 and ln.endswith("/"):
                ln = ln[:-1].rstrip()
            lines[i] = ln
        return [ln for ln in lines if ln]

    def desc_flat(text):
        """行を 1 つの「／」でつないだ、引き金の正規表現に掛けるための 1 行。
        **`<b:X>` 等のタグはまだ残っている**（切り出す範囲を決めるのはこちらが先）。"""
        return "／".join(desc_lines(text))

    def resolve_desc(text, params, lvl):
        """1 本のスキル文を、画面にそのまま出せる日本語にする。

        **`params`/`lvl` が無い、または辞書に無いキーが来たら、元のタグをそのまま残す**
        （引けなかったことを黙って隠さない。`unresolved` に集めて後で報告する）。"""
        if not text:
            return ""
        flat = DESC_HTML.sub("", desc_flat(text))

        def sub_tag(m):
            letter, key, label = m.groups()
            if label:
                return label
            name = TAG_PREFIX[letter] + "_" + key
            val = buffja.get(name)
            if val is None:
                unresolved.add(name)
                return m.group(0)
            return val
        flat = DESC_TAG.sub(sub_tag, flat)

        def sub_param(m):
            n = int(m.group(1))
            if params and lvl is not None and 1 <= n <= len(params):
                row = params[n - 1]
                if isinstance(row, list) and 0 <= lvl < len(row):
                    return str(row[lvl])
            unresolved.add(f"<?{n}>（レベルが決められない: {text[:24]}…）")
            return m.group(0)
        return DESC_PARAM.sub(sub_param, flat)

    def eff_name(e):
        """効果の見出し。**`Stat` があるものはそこから引ける。**
           `Regen` / `Shield` / `DamageDebuff` の 3 つだけ `Stat` を持たないので、
           そこは種別から名前を当てる（2026-08-30 に 29 種を数えて確かめた）。
           CC は `Stat` を持たず `Icon` に種類が入っている。"""
        st = e.get("Stat") or ""
        if st:
            return statja.get(st.rsplit("_", 1)[0], st)
        if e.get("Type") == "CrowdControl":
            ic = e.get("Icon") or ""
            return buffja.get("CC_" + ic, ic or "CC")
        return {"Regen": "継続回復", "Shield": "シールド",
                "DamageDebuff": "持続ダメージ"}.get(e.get("Type") or "", e.get("Type") or "効果")

    def eff_side(e):
        """誰にかかるか。**Target は文字列のことも配列のこともある。**"""
        tgt = e.get("Target")
        names = [tgt] if isinstance(tgt, str) else list(tgt or [])
        if not names:
            return "enemy"          # Target が無いのは敵への設置・持続ダメージ
        if "Enemy" in names:
            return "enemy"
        if names == ["Self"]:
            return "self"
        return "ally"

    def skill_extras(sk):
        """1 つのスキルから、帯に出す持続効果とコスト減少を拾う。

        **EX 本体にも `ExtraSkills` の各形態にも同じ形で使う。**"""
        out = {}
        # 持続の無い効果（即時のダメージ・回復）は帯にならないので落とす
        #
        # **値と生の `Stat` も持たせる**（2026-08-30 の先生の指示——
        # 「攻撃力が実質何倍になっているかも確認したい」）。
        # `_Base` は足し算、`_Coefficient` は 10000 分率の掛け算で、
        # **この 2 つを混ぜると答えが変わる**ので、加工せずそのまま渡す。
        # `v` はスキルのレベルぶんの配列（EX は 5 段、NS などは 10 段）。
        # **効果が乗るまでの遅れは `ApplyFrame` に入っている。**発動そのものではなく
        # 「着弾」までの時間で、30 フレーム = 1 秒。TL を書く人たちも同じ数え方をしている
        # （「バフは基礎スペシャル2前提 1秒は30フレーム換算」
        #   https://note.com/takoyakiak47/n/nfe0f914f730d ）。
        # **持たない効果もある**ので、無いときは付けない
        # **欄が無いことと 0 であることは違う。**274 人のうち 7 人
        # （ケイ・ウタハ・エイミ（水着）・シロコ＊テラー・シロコ（ライディング）・
        #  キキョウ（水着）・レイサ（マジカル））は `ApplyFrame` を持っていない。
        # そこを 0 として扱うと「撃った瞬間に乗る」と嘘をつくので、
        # **分からないことを分からないまま渡す**（2026-08-30、先駆者の
        # 「ブルアカTLメーカー」が同じ 7 人に実測値を持っているのを見て気づいた）
        def apply_sec(e):
            af = e.get("ApplyFrame")
            if af is None:
                return None
            return round(int(af) / 30.0, 2)

        bf = []
        for e in sk.get("Effects") or []:
            du = int(e.get("Duration") or 0)
            # **CC は `Duration` を持たず、続く長さが `Scale` に入っている。**
            # 気絶 3.6 秒なら `3600`。当たる確率は `Chance`（10000 = 100%）
            if e.get("Type") == "CrowdControl":
                sc = e.get("Scale") or []
                if not sc:
                    continue
                one = {"n": eff_name(e), "du": 0, "sd": eff_side(e),
                       "ty": "CrowdControl", "cc": e.get("Icon") or "",
                       "sc": sc, "ch": int(e.get("Chance") or 10000)}
                a_ = apply_sec(e)
                if a_ is None:
                    one["afu"] = 1          # 着弾までの時間がデータに無い
                elif a_:
                    one["af"] = a_
                bf.append(one)
                continue
            if du <= 0:
                continue
            item = {"n": eff_name(e), "du": du, "sd": eff_side(e),
                    "ty": e.get("Type") or ""}
            a_ = apply_sec(e)
            if a_ is None:
                item["afu"] = 1
            elif a_:
                item["af"] = a_
            st = e.get("Stat") or ""
            if st:
                # **末尾で足し算か掛け算かが決まる。**そのまま渡して、判断は使う側で
                item["st"] = st
            val = e.get("Value") or e.get("Scale") or []
            # `Value` は [[段ごとの値]] の形。1 本だけのときは中身を出す
            if len(val) == 1 and isinstance(val[0], list):
                val = val[0]
            if val:
                item["v"] = val
            bf.append(item)
        if bf:
            out["bf"] = bf
        # スキルコストを下げる効果。**`Uses` 回ぶんだけ効いて、時間では切れない。**
        # `Coefficient` は 10000 分率（-5000 = 50% 引き）、`BaseAmount` は引く数そのもの
        for e in sk.get("Effects") or []:
            if e.get("Type") != "CostChange":
                continue
            cc = {"u": int(e.get("Uses") or 1),
                  "vt": "coef" if e.get("ValueType") == "Coefficient" else "flat",
                  "sc": e.get("Scale") or [], "sd": eff_side(e)}
            a_ = apply_sec(e)
            if a_ is None:
                cc["afu"] = 1
            elif a_:
                cc["af"] = a_
            # **効く回数が EX のレベルで変わる子がいる。**`Uses` は最大値しか
            # 持っていないので、スキル文のパラメータ側（「1回 / … / 2回」）を拾う。
            # 2026-08-30 時点でこれに当たるのはセイアだけ
            for row in sk.get("Parameters") or []:
                m = [re.fullmatch(r"(\d+)回", str(x)) for x in row]
                if row and all(m):
                    cc["up"] = [int(x.group(1)) for x in m]
                    break
            out["cc"] = cc
            break
        # **使った回数で基本コストそのものが変わる形態**（2026-09-04、61h）。
        # 一次資料は 2 つあって、どちらも同じ 4 / 6 / 10 になる。
        #
        #   ① `DB/LogicEffect_PC.json` の `TargetSlotExSkillCostOverrideEffectDAO`。
        #      **274 人中ミカ（水着）だけが持つ**（`Counter({'CH0294': 2})`）。
        #        GroupId CH0294_HiddenPassive03_Effect02  TargetExSkillSlot ["ExSkill03"]  BaseAmount 2
        #        GroupId CH0294_HiddenPassive03_Effect03  TargetExSkillSlot ["ExSkill03"]  BaseAmount 6
        #      配るのは `LevelSkill/CH0294HiddenPassive03.json`
        #      （`TriggerCondition {"Event": 3, "Parameters": "Ex"}` ＝ EX 使用時）で、
        #      段の門は `CountLogicEffectTemplateModifierDAO`（`Dummy_CH0294_ExCheck`）の
        #      `Ability02 CountMin 2 CountMax 3` ／ `Ability03 CountMin 4 CountMax 999`。
        #      `ExSkill03` は形態 1 の 3 枚目 ＝ `CH0294Ex02` で、`SkillExcelTable` の
        #      素のコストは 4。**`BaseAmount` は足し算**（4 ／ 4+2=6 ／ 4+6=10）
        #   ② その形態の説明文そのもの。**回数と額が数字で書いてある**:
        #        「使用回数によって「星の軌跡」の基本コストを変更
        #          （1～2回目：4コスト/3～4回目：6コスト/5回目以降：10コスト）」
        #
        # **読むのは ② のほう。**①（DAO）は「どの形態か」を `ExSkillGroupId` の
        # 並びでしか名指ししないので、`ExtraSkills` の何番目かへ結び付けるには
        # `CharacterSkillListExcelTable` と `SkillExcelTable` を追加で引く必要がある。
        # ② は形態の行そのものに書いてあるので取り違えようがなく、額も範囲も同じ。
        # **「N回目」は 1 始まり**で、`cs` は [その回数から, そのコスト] の並び。
        _cs, _dsc = [], sk.get("Desc") or ""
        if "基本コスト" in _dsc:
            for _m in re.finditer(r"(\d+)\s*(?:[~～]\s*\d+)?\s*回目(?:以降)?\s*[：:]\s*"
                                  r"(\d+)\s*コスト", _dsc):
                _cs.append([int(_m.group(1)), int(_m.group(2))])
        if len(_cs) > 1:
            out["cs"] = _cs
        # **追加でコストを払って威力を上げる EX**（2026-09-04、61 の 3 つ目）。
        # 原文は「追加で最大Nコストを消耗して、1コストあたりのダメージが M% 増加します。
        # （コスト増減スキルの効果は基本コストを基準として計算します）」。
        # **持っているのは 4 人だけ**（ハスミ（体操服）2 ／ ミノリ 3 ／ サツキ 3 ／
        # ノゾミ 2。`tools/tl/data.js` の `dmgalt` に「追加コスト N」の札が
        # 合わせて 14 枚出ているのがこの 4 人ぶん）。
        # **括弧の但し書きが払う順を決めている**——コスト減少は基本コストに掛けて、
        # 追加ぶんはそのあとに足す。engine の `costAfter` の外側で足すのはそのため
        _xm = re.search(r"追加で最大(\d+)コストを消耗", _dsc)
        if _xm:
            out["xc"] = int(_xm.group(1))
        # コスト回復力に触る効果。**別の形態にも付いていることがある**
        # （キサキ（水着）の「実行：ばんざい体操」が RegenCost_Base 2500）
        reg = []
        for e in sk.get("Effects") or []:
            stat = e.get("Stat") or ""
            if "RegenCost" not in stat:
                continue
            tgt = e.get("Target") or []
            reg.append({"sl": "Ex", "sn": sk.get("Name", ""),
                        "k": "c" if stat.endswith("_Coefficient") else "b",
                        "p": "party" if len(tgt) > 1 else "self",
                        "v": e.get("Value") or [],
                        "du": int(e.get("Duration") or 0), "cond": ""})
        if reg:
            out["r"] = reg
        return out

    # **ノーマルスキルなど、EX 以外のスキルも時間軸に乗せる**
    # （2026-08-30 の先生の指示——「バッファーじゃないキャラも NS バフ、デバフとか、
    # CC とかあるから、そこら辺も確認してタイムラインに乗るようにして」）。
    #
    # **発動間隔はスキル文にしか書かれていない。**ゲームのデータには欄が無く、
    # 参考元の kur-3dcg は生徒ごとに手で入れている（`characters_st.json` の
    # `nsInterval`。ストライカー 186 人のうち 41 人ぶんだけ）。
    # こちらは**原文から「N秒毎に」を読む**ので、手入力を持たずに済む。
    # 274 人中 213 人がこの書き方で、残り 61 人は「弾薬数が0になった時」
    # 「敵を倒した時」のような**条件発動**なので、時刻を置けない。
    # **そこは間隔 0 のまま、引き金の原文を添えて出す。**
    NS_IV = re.compile(r"(\d+(?:\.\d+)?)\s*秒毎に")
    # 引き金の書き出し。文の最初の読点までを原文のまま持つ
    NS_COND = re.compile(r"^([^、。\n]{2,28}?(?:時|場合|とき))[、,]")
    # **初回が戦闘開始と同時かどうかは、スキル文が書き分けている。**
    # 274 人を数えたところ「戦闘開始時とそれ以降、40秒毎に」と書く子が 2 人だけ
    # いる（レンゲ（水着）と マコト（水着））。**わざわざ書き分けているので、
    # ただの「40秒毎に」は初回も 40 秒後**と読む（2026-08-30 の先生の指摘
    # 「NS だけど、戦闘開始から何秒で発動するかは決まってる」を受けて数えた）。
    NS_AT0 = re.compile(r"戦闘開始時とそれ以降")
    # 1 回きり型。「戦闘開始時、…（戦闘中に1回のみ）」で 5 人
    NS_ONCE_AT0 = re.compile(r"戦闘開始時[、,]")
    NS_ONCE = re.compile(r"戦闘中に1回のみ")
    # **間隔の手前に条件が付く子がいる。**「HPが30%以下の時、4秒毎に」のホシノで、
    # 274 人のうちこの 1 人だけ。**初回の時刻を決められない**ので `st` を持たせず、
    # 引き金の原文を添える（数えて確かめたうえで、そう扱っている）
    NS_PRE_COND = re.compile(r"([^、。\n]{2,40}?(?:時|場合|とき))[、,]\s*$")

    def timed_skill(sk):
        """EX 以外のスキル 1 本を、時間軸に置ける形にする。

        **効果そのものは `skill_extras()` と同じ拾い方**（`bf` / `cc` / `r`）。
        ここが足すのは「いつ動くか」だけ。"""
        if not sk or not sk.get("Name"):
            return None
        de = str(sk.get("Desc") or "")
        # **ノーマル・パッシブ・サブは Lv10 が前提。**`emptySlot()` の既定値
        # （`ex: 5, sk: 10`。tl.js）と揃えている
        params = sk.get("Parameters")
        out = {"n": sk.get("Name", ""), "ei": sk.get("Icon", "")}
        # **改行の端の `/` を先に畳んでから引き金を探す。**そのまま `\n` を消すだけだと
        # （旧実装）、行の境目にあった `/` が地の文にくっついたまま残って出てしまう
        # （ミネ Public の「発動/発動時」、ツクヨ Public の「／/その敵が」）
        flat = desc_flat(de)
        m = NS_IV.search(flat)
        if m:
            out["iv"] = float(m.group(1))
            pre = NS_PRE_COND.search(flat[:m.start()])
            if pre and not NS_AT0.search(flat):
                # 引き金が先にある。初回の時刻は置けない
                out["cond"] = resolve_desc(pre.group(1), params, 9)
            else:
                # `st` = 戦闘開始から初めて発動するまでの秒数
                out["st"] = 0.0 if NS_AT0.search(flat) else out["iv"]
        elif NS_ONCE_AT0.match(flat):
            out["iv"] = 0
            out["st"] = 0.0
            out["once"] = 1
            out["cond"] = "戦闘開始時"
        else:
            out["iv"] = 0
            c = NS_COND.match(flat)
            # 条件が読めないものもある。**読めなかったことを黙って隠さない。**
            # 途中で切らない——画面にそのまま出す文なので、切ると意味が変わる
            # （**2 行目より先を丸ごと落としていたのを直した。**カノエの
            # ExtraPassive「前世の加護」は 1 行目が効果、条件は 2 行目にある）
            out["cond"] = resolve_desc(c.group(1) if c else de, params, 9)
        if NS_ONCE.search(flat):
            out["once"] = 1
        out.update(skill_extras(sk))
        # 何も乗らないなら時間軸に出す意味がない
        if not (out.get("bf") or out.get("cc") or out.get("r")):
            return None
        return out

    # **手札とコストの回り方を変える書きぶり。**どれも効果の欄には出てこず、
    # スキル文にしか書かれていないので、文から拾って**原文をそのまま持っておく**
    # （2026-08-30。画面に「こう書いてある」と出せるようにするため）。
    SP_PATS = [
        ("draw", re.compile(r"EX ?スキルを?すぐに(?:(\d+)回)?ドロー")),
        # **鉤括弧の中に鉤括弧を許さない。**許すとキサキ（水着）の
        # 「「実行：ばんざい体操」を2回使用後、「宣言：本日休業」にスキルが変更されます」で
        # 1 つ目の「から最後の」まで丸ごと拾ってしまう（2026-08-30 に踏んだ）
        ("swap", re.compile(r"「([^「」]+)」にスキルが変更")),
        ("copy", re.compile(r"EX ?スキルカードを複製")),
        ("ovl", re.compile(r"CostOverload")),
        ("back", re.compile(r"カードをデッキの最後尾に移動")),
    ]

    def special_notes(ex):
        """スキル文から、手札とコストに効く特別な書きぶりを拾う。

        **見つけた行を原文のまま `txt` に残す。**推測でフラグだけ立てない。"""
        # **EX は Lv5 が前提。**ExtraSkills も同じ 5 段（`emptySlot()` の `ex: 5`）
        lines = []
        for sk in [ex] + list(ex.get("ExtraSkills") or []):
            params = sk.get("Parameters")
            for ln in (sk.get("Desc") or "").split("\n"):
                ln = ln.strip().rstrip("/").strip()
                if ln:
                    lines.append((ln, params))
        out = {}
        for key, pat in SP_PATS:
            for ln, params in lines:
                m = pat.search(ln)
                if not m:
                    continue
                if key == "draw":
                    out["draw"] = int(m.group(1) or 1)
                    # 「〜の場合」と書いてあるものはゲージ待ちで、毎回は引けない
                    out["drawCond"] = ("場合" in ln)
                elif key == "swap":
                    out["swap"] = m.group(1)
                elif key == "ovl":
                    # 何秒続くかは効果の欄にある。**文からは読まない**
                    du = 0
                    for e in ex.get("Effects") or []:
                        du = max(du, int(e.get("Duration") or 0))
                    out["ovl"] = du
                else:
                    out[key] = True
                out.setdefault("txt", [])
                # **画面に出す原文は差し込み記号を解決したもの。**マッチ判定だけ生の文でやる
                resolved = resolve_desc(ln, params, 4)
                if resolved not in out["txt"]:
                    out["txt"].append(resolved)
                break
        return out

    stu = []
    for s in students:
        ex = s.get("Skills", {}).get("Ex")
        if not s.get("Name") or not isinstance(ex, dict):
            continue
        rec = {
            "id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]),
            "sq": s.get("SquadType", ""), "ro": s.get("TacticRole", ""),
            "sc": s.get("School", "ETC"), "at": s.get("ArmorType", ""),
            "bt": s.get("BulletType", ""), "st": s.get("StarGrade", 0),
            "en": ex.get("Name", ""),
            # EX のアイコン。**82 種しかない**ので、生徒 274 人ぶんより軽い
            "ei": ex.get("Icon", ""),
            # **開発名（`CH0280`）。**条件つきダメージの `Parameter=CH0280_Ex_01` が
            # 「誰のどのスキルが付ける印か」を持っていて、これが無いと結び付かない
            # （2026-09-01。ネル（制服）の「怪我しても知らねえからな」が
            #  対戦状態の有無で 10 通りに分かれていて、既定が「対戦状態なし・段1」＝
            #  10 通りのうち最弱を選んでいた）
            "dv": s.get("DevName", ""),
            "c": ex.get("Cost") or [],
            # **Duration はフレーム。**ゲームは 30fps なので、秒にするには 30 で割る
            "d": ex.get("Duration") or 0,
        }
        # **固有武器のパッシブで、自分がかけた効果の持続が伸びる子がいる。**
        # `ExtendBuffDuration_Base` がバフ側、`ExtendDebuffDuration_Base` が
        # デバフ側で、どちらも 10000 分率（1900 ＝ +19%）の 10 段。
        # 有志ツールはこの 2 つを混ぜて「固有 2 で ×1.19」と一括りにしているが、
        # データ上は別物なので分けて持つ（2026-08-30 に数えて 22 人と 3 人）
        for sk in (s.get("Skills") or {}).values():
            if not isinstance(sk, dict):
                continue
            for e in sk.get("Effects") or []:
                st = e.get("Stat") or ""
                key = "eb" if st.startswith("ExtendBuffDuration") else \
                      "ed" if st.startswith("ExtendDebuffDuration") else ""
                if key:
                    rec[key] = (e.get("Value") or [[]])[0]
        for k, v in skill_extras(ex).items():
            if k == "r":
                continue          # EX 本体のぶんは、下の全スキル走査でまとめて拾う
            rec[k] = v
        # **EX が 1 種類とは限らない。**撃つと次から別の EX に変わる子が居て
        # （ネル（制服）・ミカ（水着）・アリス（臨戦）ほか）、コストも持続も別物。
        # SchaleDB は `Skills.Ex.ExtraSkills[]` に入れている（2026-08-30 に 16 人）
        xs = []
        for x in ex.get("ExtraSkills") or []:
            if not x.get("Cost"):
                continue          # コストを持たない行は「別のカード」ではない
            item = {"n": x.get("Name", ""), "ei": x.get("Icon", ""),
                    "c": x.get("Cost") or [], "d": x.get("Duration") or 0}
            item.update(skill_extras(x))
            xs.append(item)
        if xs:
            rec["xs"] = xs
        # **変身 EX の周期は説明文に書いてある**（2026-09-03、60）。
        # 「形態 0 を 1 回撃つと形態 1 に変わり、N 回撃つと戻る」型で、
        # `FORM_RULE` が 'pick' の子はこれを読まないと形態 0（＝変身そのもの）が
        # 一度も置かれない。**原文はこの 2 つの言い方だけ**（全 274 人を見た）:
        #   トキ          「（<s:CH0187Mod>でEXスキル3回使用時にモード解除)」
        #   キサキ（水着）  「自身の次の2回分のEXスキルを「実行：ばんざい体操」に変更」
        # `fc` は**形態 0 のあとに形態 1 を撃つ回数**。周期は `fc + 1` 回
        if xs:
            _fd = ex.get("Desc") or ""
            _fm = (re.search(r"EXスキル\s*(\d+)\s*回使用時に(?:モード)?解除", _fd)
                   or re.search(r"次の\s*(\d+)\s*回分のEXスキルを", _fd))
            if _fm:
                rec["fc"] = int(_fm.group(1))
        sp = special_notes(ex)
        if sp:
            rec["sp"] = sp
        # **EX 以外のスキルも時間軸に乗せる。**ノーマルは「N秒毎に」で回り、
        # パッシブとサブは戦闘中ずっと効いている（＝時刻を持たない）
        ns = timed_skill((s.get("Skills") or {}).get("Public"))
        if ns:
            rec["ns"] = ns
        pv = []
        for slot in ("Passive", "ExtraPassive"):
            t = timed_skill((s.get("Skills") or {}).get(slot))
            if t:
                t["sl"] = slot
                pv.append(t)
        if pv:
            rec["pv"] = pv
        # **サブスキル（`ExtraPassive`）が配るコスト減少**（2026-09-04、61 の 2 つ目。
        # 先生の指摘「マリー（アイドル）の SS のコスト −1 が `cc` に入っていない」）。
        # `cc` は EX（と各形態）しか見ていなかったので、SS 側の `CostChange` が
        # 1 件も運ばれていなかった。**引き金はスキル文にしか書いていない。**
        #
        #   10105 マリー（アイドル）「今だけは楽しんで」
        #     <s:CH0273_ExtraPassive>を3個獲得時、自身を除く味方のスキルコストを1減少
        #     （EXスキルの使用1回分）（<s:CH0273_ExtraPassive>は初期化されます）
        #     …札を配るのは EX「溢れるハート」の「<s:CH0273_ExtraPassive>を1個獲得」
        #   10050 ココナ「梅花園の指導法」
        #     <s:Stamp>を5個獲得時、自身を除く味方のスキルコストを1減少（EXスキルの使用1回分）
        #     …EX「たいへんよくできました！」の「<s:Stamp>を1個獲得」が 1 個ぶん。
        #     **NS「次も楽しみにしてますよ！」も「味方が会心を100回成功した時」に
        #     1 個配る**が、道具は会心の回数を数えていないので **EX ぶんしか数えない**
        #     （＝実際より遅れて出る。少なめに出るほうへ倒す。`hitsOn` と同じ扱い）
        #
        # **拾うのは「EX が札を配る」形だけ。**キキョウ（札は SS 自身が 30 秒毎）と
        # レイ（札は NS の「敵を4人倒した時」）とコノカ（「回復効果を25回受ける」）は、
        # 数える手立てがデータに無いので置かない。
        ssk = (s.get("Skills") or {}).get("ExtraPassive")
        if isinstance(ssk, dict):
            _ce = next((e for e in ssk.get("Effects") or []
                        if e.get("Type") == "CostChange"), None)
            _sd = (ssk.get("Desc") or "")
            _sm = re.search(r"<s:([A-Za-z0-9_]+)>を(\d+)個獲得時", _sd)
            if _ce and _sm:
                _gain = re.search(r"<s:" + re.escape(_sm.group(1)) + r">を(\d+)個獲得",
                                  ex.get("Desc") or "")
                if _gain and int(_gain.group(1)) > 0:
                    _per = int(_gain.group(1))
                    _tgt = _ce.get("Target")
                    _names = [_tgt] if isinstance(_tgt, str) else list(_tgt or [])
                    rec["ccs"] = {
                        # EX 何回ごとに配るか（札 N 個 ÷ 1 回あたり _per 個）
                        "ev": -(-int(_sm.group(2)) // _per),
                        "u": int(_ce.get("Uses") or 1),
                        "vt": "coef" if _ce.get("ValueType") == "Coefficient" else "flat",
                        "sc": _ce.get("Scale") or [],
                        "sd": "self" if _names == ["Self"] else "ally",
                        # 「自身を除く味方の」＝ 相手を選ばず全員。「味方1人」なら 0
                        "all": 0 if "1人" in _sd else 1,
                        "sn": ssk.get("Name", ""),
                    }
        reg = []
        for slot, sk in (s.get("Skills") or {}).items():
            if not isinstance(sk, dict):
                continue
            for e in sk.get("Effects") or []:
                stat = e.get("Stat") or ""
                if "RegenCost" not in stat:
                    continue
                tgt = e.get("Target") or []
                reg.append({
                    "sl": slot, "sn": sk.get("Name", ""),
                    "k": "c" if stat.endswith("_Coefficient") else "b",
                    "p": "party" if len(tgt) > 1 else "self",
                    "v": e.get("Value") or [],
                    "du": int(e.get("Duration") or 0),
                    "cond": COST_COND.get(s["Id"], "") if len(e.get("Value") or []) > 1 else "",
                })
        if reg:
            rec["r"] = reg
        stu.append(rec)
    stu.sort(key=lambda x: (-x["st"], x["n"]))

    # **拾えた数を毎回出す。**減ったらスキル文の書き方が変わった合図
    ns_n = [x for x in stu if x.get("ns")]
    ns_iv = [x for x in ns_n if x["ns"].get("iv")]
    cc_n = [x for x in stu
            if any(b.get("ty") == "CrowdControl" for b in (x.get("bf") or []))
            or any(b.get("ty") == "CrowdControl" for b in ((x.get("ns") or {}).get("bf") or []))]
    val_n = [x for x in stu if any(b.get("v") for b in (x.get("bf") or []))]
    # **時間軸に何も乗らない NS は持たせない。**「N秒毎に」と書いてあっても
    # 中身が即時ダメージだけの子が居て（274 人中 213 人に間隔の記述があり、
    # そのうち帯・CC・コスト回復のどれかが乗るのは 150 人ほど）、
    # 空の欄を作ると画面に「何も起きない行」が並ぶ
    if len(ns_n) < 120:
        raise SystemExit(f"ノーマルスキルが {len(ns_n)} 人しか拾えていない。効果の形が変わった疑い")
    if len(ns_iv) < 110:
        raise SystemExit(f"「N秒毎に」が {len(ns_iv)} 人しか読めていない。スキル文の書き方が変わった疑い")
    print(f"  NS が時間軸に乗る子 {len(ns_n)} 人（うち発動間隔が読めたのが {len(ns_iv)} 人、"
          f"条件発動が {len(ns_n) - len(ns_iv)} 人）、"
          f"CC を持つ子 {len(cc_n)} 人、EX の帯に値が入った子 {len(val_n)} 人、"
          f"パッシブ・サブが乗る子 {len([x for x in stu if x.get('pv')])} 人")

    n = 0
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    # ツール一覧に出す絵。**スキルのアイコンは images/skill/ にある**（images/ui/ ではない）。
    # コスト回復のアイコンがそのままあるので、時計を借りずにこれを使う
    fetch_icon("skill_regencost",
               "https://raw.githubusercontent.com/SchaleDB/SchaleDB/main/images/skill/COMMON_SKILLICON_REGENCOST.webp")
    # EX スキルの絵。**種類で落とす。**82 種で 274 人ぶんをまかなえる。
    # **GitHub のミラーには新しいものが 18 種入っていない**ので本番サイトから取る。
    # 120×128 の縦長で、`fetch_icon` の 122×122 に切ると端が欠ける
    icons = sorted({x["ei"] for x in stu if x.get("ei")} |
                   {y["ei"] for x in stu for y in x.get("xs") or [] if y.get("ei")})
    for ic in icons:
        n += fetch_wide("skill_" + ic.lower(),
                        f"https://schaledb.com/images/skill/{ic}.webp", width=96)
    lost = [ic for ic in icons if not (IMG / f"skill_{ic.lower()}.webp").exists()]
    if lost:
        raise SystemExit(f"EX スキルの絵が {len(lost)} 種類落ちてこない: {lost[:5]}")
    holders = [s for s in stu if "r" in s]
    forms = [s for s in stu if s.get("xs")]
    draws = [s for s in stu if (s.get("sp") or {}).get("draw")]
    print(f"  生徒 {len(stu)} 人、コスト回復力に触る子 {len(holders)} 人、"
          f"EX が変わる子 {len(forms)} 人、カードを引く子 {len(draws)} 人、アイコン {n} 枚を追加")
    if len(holders) < 15:
        raise SystemExit(f"コスト回復力持ちが {len(holders)} 人しか取れていない。データの形が変わった疑い")
    # **拾い漏れの番人。**スキル文の書きぶりが変わったら、ここで気づける
    if len(forms) < 10:
        raise SystemExit(f"EX が変わる子が {len(forms)} 人しか取れていない。ExtraSkills の形が変わった疑い")
    if len(draws) < 6:
        raise SystemExit(f"カードを引く子が {len(draws)} 人しか取れていない。スキル文の書きぶりが変わった疑い")
    # **`<b:X>` / `<?N>` の解決漏れ。**黙って隠さず、ここで数えて出す
    if unresolved:
        print(f"  引けなかった差し込み記号 {len(unresolved)} 件: {sorted(unresolved)}",
              file=sys.stderr)
    else:
        print("  差し込み記号は全部引けた（生マークアップ 0 件）")

    # **戦闘時間はボスごとに違う。**3 分・4 分だけではなく、イェソドと
    # ドラム缶ガニとセトの憤怒が 270 秒、コクマーとティファレトが 300 秒
    # （2026-08-30 の先生の指摘「戦闘時間は3m4m以外にもある」を受けて数えた）。
    # SchaleDB の `raids.min.json` が `BattleDuration` を難易度ごとに持っている
    raids = get_json(SD.format("raids"))
    dur, seen = [], set()
    for key, kind in (("Raid", "総力戦"), ("MultiFloorRaid", "制約解除決戦"),
                      ("WorldRaid", "大決戦")):
        for r in as_list(raids.get(key) or []):
            if not (r.get("IsReleased") or [False])[0]:
                continue
            bd = r.get("BattleDuration")
            secs = sorted({int(x) for x in (bd if isinstance(bd, list) else [bd]) if x})
            if not secs:
                continue
            nm = r.get("Name") or r.get("DevName") or str(r.get("Id"))
            for v in secs:
                k = (nm, v)
                if k in seen:
                    continue
                seen.add(k)
                dur.append({"n": nm, "k": kind, "s": v})
    if not dur:
        raise SystemExit("戦闘時間が 1 件も取れない。raids.min.json の形が変わった疑い")
    secs = sorted({d["s"] for d in dur})
    print(f"  戦闘時間は {len(dur)} 通り（{secs} 秒）")

    keep = ("School", "TacticRole", "BulletType", "ArmorType", "SquadType")
    return write_js("tools/cost-timeline/data.js", "TL", {
        "students": stu,
        "labels": {k: loc.get(k, {}) for k in keep},
        # ボスごとの戦闘時間。**残り時間で TL を書くときの分母**
        "dur": dur,
        # 素の 700 は全 274 人で同じ値。**確かめたうえで定数にしている**
        "base": 700,
        "version": "SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 総力戦の開催カレンダー

def build_raid_calendar():
    print("総力戦・大決戦の開催カレンダー")
    raids = get_json(SD.format("raids"))
    loc = get_json(SD.format("localization"))

    bosses = {}
    for r in raids.get("Raid") or []:
        bosses[r["Id"]] = {
            "n": r.get("Name", ""), "p": r.get("PathName", ""), "dev": r.get("DevName", ""),
            "at": r.get("ArmorType", ""), "bt": r.get("BulletType", ""),
            "bi": r.get("BulletTypeInsane", ""),
            "tr": r.get("Terrain") or [], "md": (r.get("MaxDifficulty") or [0])[0],
            "du": (r.get("BattleDuration") or [0])[0],
        }
    # **RaidSeasons は サーバー別の 3 本。先頭が日本。**
    # 総力戦の最終シーズンが日本の開催日と合うことを確かめてから使っている
    seasons = (raids.get("RaidSeasons") or [{}])[0]

    def rows(key):
        out = []
        for s in seasons.get(key) or []:
            rid = s.get("RaidId")
            if rid not in bosses:
                continue
            out.append({
                "s": s.get("SeasonId"), "d": s.get("SeasonDisplay"),
                "b": rid, "t": s.get("Terrain", ""),
                "o": s.get("Start"), "c": s.get("End"),
                "od": s.get("OpenDifficulty") or None,
            })
        out.sort(key=lambda x: x["o"], reverse=True)
        return out

    raid_rows, elim_rows = rows("Seasons"), rows("EliminateSeasons")
    if len(raid_rows) < 50:
        raise SystemExit(f"総力戦の履歴が {len(raid_rows)} 回しか取れない。データの形が変わった疑い")

    used = {r["b"] for r in raid_rows} | {r["b"] for r in elim_rows}
    n = 0
    for bid in sorted(used):
        b = bosses[bid]
        n += fetch_icon("bossicon_" + b["p"],
                        f"https://schaledb.com/images/raid/icon/Icon_{b['dev']}.png")
        # **新しいボスはアイコンがまだ無い。**（ドラム缶ガニ＝EN0022 が
        # 2026-08-30 の時点でそう）。無いときは立ち絵のほうを使う
        if (IMG / f"bossicon_{b['p']}.webp").exists():
            b["ic"] = "bossicon_" + b["p"]
        else:
            n += fetch_portrait(f"boss_{b['p']}",
                                f"https://schaledb.com/images/raid/Boss_Portrait_{b['dev']}_Lobby.png")
            b["ic"] = "boss_" + b["p"]
    print(f"  総力戦 {len(raid_rows)} 回、大決戦 {len(elim_rows)} 回、ボス {len(used)} 体、絵 {n} 枚を追加")

    keep = ("ArmorType", "BulletType", "RaidDifficulty")
    # **難易度は並び順そのものが意味を持つ。**大決戦の OpenDifficulty は
    # この並びの添字で、6 なら Torment まで挑める
    diffs = ["Normal", "Hard", "VeryHard", "HardCore", "Extreme", "Insane", "Torment", "Lunatic"]
    return write_js("tools/raid-calendar/data.js", "CAL", {
        "bosses": {str(k): v for k, v in bosses.items() if k in used},
        "raid": raid_rows, "elim": elim_rows, "diffs": diffs,
        "labels": {k: loc.get(k, {}) for k in keep},
        "version": "SchaleDB jp（raids.min.json の RaidSeasons）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")



# ------------------------------------------------------------ 装備・愛用品・固有武器の効果

def build_gear_stats():
    print("装備・愛用品・固有武器の効果早見")
    eq = as_list(get_json(SD.format("equipment")))
    students = as_list(get_json(SD.format("students")))
    loc = get_json(SD.format("localization"))

    # **設計図と万能設計図を落とす。**同じ表に混ざっているが、
    # ステータスを持たないので StatType の有無で分けられる
    cats = {}
    for e in eq:
        if not e.get("StatType") or not e.get("Name"):
            continue
        c = e.get("Category", "")
        cats.setdefault(c, []).append({
            "t": e.get("Tier", 0), "n": e["Name"], "i": e.get("Icon", ""),
            "st": e.get("StatType") or [], "sv": e.get("StatValue") or [],
            "ml": e.get("MaxLevel", 0),
            "rc": e.get("RecipeCost", 0), "rp": e.get("Recipe") or [],
        })
    for c in cats:
        cats[c].sort(key=lambda x: x["t"])
    if len(cats) != 9:
        raise SystemExit(f"装備の部位が {len(cats)} 種類しか取れない（9 のはず）")

    gear, weap = [], []
    for s in students:
        if not s.get("Name"):
            continue
        w = s.get("Weapon") or {}
        weap.append({
            "id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]), "sq": s.get("SquadType", ""),
            # **絵の名前は生徒の Id と一致しない。**衣装違いは元の子の武器を使い回す
            # （アズサ（水着）10021 の絵は `weapon_icon_10019`）。SchaleDB の
            # `WeaponImg` をそのまま持つ（2026-08-30。Id で組み立てて 206 人ぶん落ちた）
            "wi": s.get("WeaponImg", ""),
            "wn": w.get("Name", ""), "ad": w.get("AdaptationType", ""),
            "av": w.get("AdaptationValue", 0),
            "a": [w.get("AttackPower1", 0), w.get("AttackPower100", 0)],
            "h": [w.get("MaxHP1", 0), w.get("MaxHP100", 0)],
            "p": [w.get("HealPower1", 0), w.get("HealPower100", 0)],
            # **伸び方の型。**SchaleDB の計算では Standard / LateBloom / Premature の
            # どれもレベルに対して直線（`(Lv - 1) / 99`）で、TimeAttack だけ段付き。
            # 型そのものを持たせておいて、あとで別の型が増えたら気づけるようにする
            "lu": w.get("StatLevelUpType", "Standard"),
            "eq": s.get("Equipment") or [],
        })
        g = s.get("Gear") or {}
        if g.get("Name"):
            gear.append({
                "id": s["Id"], "n": NAMES.get(s["Id"], s["Name"]), "gn": g["Name"],
                "st": g.get("StatType") or [], "sv": g.get("StatValue") or [],
            })
    if len(gear) < 40:
        raise SystemExit(f"愛用品が {len(gear)} 人ぶんしか取れない")

    # **固有武器の段ごとのレベル上限。**275 本ぶんを数えて全部同じことを確かめる
    # （2026-08-30。それまでこのツールは Lv1 → Lv100 と出していたが、
    # **Lv100 には届かない。**日本の上限は固有4 の Lv60）。
    wlv = {}
    # **固有4 で増えるぶんもこの表に入っている**（`StatType[3]` / `StatValue[3]`。
    # 2026-08-31 に気づいた。止まっている `Excel/` 側は `None` のままで、
    # それまでこのページは「データに入っていない」と書いて game8 の記述を出していた）
    w4 = {}
    for r in as_list(get_json(BADB.format("CharacterWeaponExcelTable"))):
        wlv[tuple(r["MaxLevel"])] = wlv.get(tuple(r["MaxLevel"]), 0) + 1
        w4[r["Id"]] = ((r["StatType"][3] or "").replace("_Base", ""), r["StatValue"][3])
    # **1 人ずつ突き合わせる。**ストライカー（`Main`）は自分の攻撃属性の
    # `Enhance<属性>Rate` が `1000`（＝ 特効 ＋10%）、スペシャル（`Support`）は
    # `MaxCostIncrease` が `5000`（＝ コスト上限 ＋0.5）。**1 人でも外れたら止まる**
    bt_by = {x["Id"]: x.get("BulletType") for x in students}
    for r in weap:
        r["f4"], r["f4v"] = w4.get(r["id"], ("", 0))
        if not r["f4"]:
            continue
        want = ("MaxCostIncrease", 5000) if r["sq"] == "Support" \
            else (f"Enhance{bt_by.get(r['id'])}Rate", 1000)
        if (r["f4"], r["f4v"]) != want:
            raise SystemExit(f"固有4 の内容が想定と違う: {r['n']} {r['f4']} {r['f4v']}（{want} のはず）")
    if len(wlv) != 1:
        raise SystemExit(f"固有武器のレベル上限が生徒ごとに割れている: {sorted(wlv.items())[:3]}")
    wmax = list(list(wlv)[0])
    lu = {}
    for r in weap:
        lu[r["lu"]] = lu.get(r["lu"], 0) + 1
    if set(lu) - {"Standard", "LateBloom", "Premature"}:
        raise SystemExit(f"固有武器に知らない伸び方の型がある: {sorted(lu)}")

    # 日本で開いている固有の段。SchaleDB の config が持っている
    cfg = get_json(SD_CFG)
    jp = [r for r in cfg["Regions"] if r.get("Name") == "Jp"]
    if not jp:
        raise SystemExit("config.json に Jp が無い")
    # **`WeaponMaxLevel / 10 - 2` が開いている固有の段。**SchaleDB 本体が
    # `WeaponStarGrade` をこの式で頭打ちにしている（`assets/index-*.js`）
    wstar = jp[0]["WeaponMaxLevel"] // 10 - 2
    if not 1 <= wstar <= 5:
        raise SystemExit(f"固有の段が {wstar} になっている")
    print(f"  固有武器のレベル上限 {wmax[:wstar]}（日本は固有{wstar} まで）、伸び方 {lu}")

    n = 0
    for c in cats:
        for e in cats[c]:
            if e["i"]:
                n += fetch_icon(e["i"], f"https://schaledb.com/images/equipment/icon/{e['i']}.webp")
    for s in weap:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    # 愛用品そのものの絵。**生徒の顔と同じ 146×116 なので `fetch_icon` でよい**
    for s in gear:
        n += fetch_icon(f"gear_{s['id']}", f"https://schaledb.com/images/gear/icon/{s['id']}.webp")
    # 固有武器の絵。**800×205 の横長。**四角に切ると刀身が消えるので幅だけ揃える。
    # 衣装違いは同じ絵を指すので、名前で重複を落としてから落とす
    for wi in sorted({s["wi"] for s in weap if s["wi"]}):
        n += fetch_wide(wi, f"https://schaledb.com/images/weapon/{wi}.webp")
    lost = [s["n"] for s in weap if s["wi"] and not (IMG / f"{s['wi']}.webp").exists()]
    if lost:
        raise SystemExit(f"固有武器の絵が {len(lost)} 人ぶん落ちてこない: {lost[:5]}")
    print(f"  部位 {len(cats)} × 段、愛用品 {len(gear)} 人、固有武器 {len(weap)} 人、絵 {n} 枚を追加")

    keep = ("Stat", "StatTooltip", "AdaptationType", "SquadType")
    return write_js("tools/gear-stats/data.js", "GEAR", {
        "eq": cats, "gear": gear, "weapon": weap,
        # 固有1〜固有N のレベル上限と、日本で開いている段の数
        "wlv": wmax[:wstar], "wstar": wstar,
        # 部位の日本語は localization に無いので、装備の周回計算機と同じ言い方に揃える
        "catJa": {"Hat": "帽子", "Gloves": "手袋", "Shoes": "靴", "Bag": "カバン",
                  "Badge": "バッジ", "Hairpin": "ヘアピン", "Charm": "お守り",
                  "Watch": "腕時計", "Necklace": "ネックレス"},
        "labels": {k: loc.get(k, {}) for k in keep},
        "version": "SchaleDB jp（生徒・装備・愛用品・固有武器）／ electricgoat/ba-data jp（固有武器のレベル上限）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 総力戦のスコア

def build_raid_score():
    print("総力戦・大決戦のスコア計算機")
    raids = get_json(SD.format("raids"))
    loc = get_json(SD.format("localization"))
    # **`Excel/` ではなく `DB/` を読む。**`Excel/` 側は取り残されていて、
    # 日本ではもう出ているイェソド（EN0013）とドラム缶ガニ（EN0022）が入っていない。
    # 実測 2026-08-31: Excel/RaidStageExcelTable は 144 行・ボス 12 体、
    # DB/RaidStageExcelTable は 168 行・ボス 14 体。大決戦も 504 → 532 行で
    # ゲブラ（EN0010）が増える。列は 9 つとも同じ（先生の指摘で気づいた）
    stages = as_list(get_json(BADB.format("RaidStageExcelTable")))
    elim = as_list(get_json(BADB.format("EliminateRaidStageExcelTable")))

    # ボスの日本語名。**`RaidStageExcelTable` は開発名（`Binah`）しか持たない**
    name = {}
    icons = {}
    for kind in ("Raid", "EliminateRaid"):
        for r in raids.get(kind) or []:
            dev = r.get("DevName") or ""
            if not dev:
                continue
            name[dev] = r.get("Name", dev)
            icons[dev] = r.get("PathName", "")

    # **開発名の大文字小文字が表ごとに揃っていない**（`ShiroKuro` と `Shirokuro`）。
    # 小文字にして引く
    lname = {k.lower(): v for k, v in name.items()}
    licon = {k.lower(): v for k, v in icons.items()}
    # **同じボスが表ごとに別の開発名で出てくる。**大決戦の表だけこの 2 つがずれる
    # （2026-08-30 に 648 行を数えて見つけた）
    for alias, real in (("kaitenger", "kaitenfxmk0"), ("hovercraft", "raidhovercraft")):
        lname.setdefault(alias, lname.get(real, alias))
        licon.setdefault(alias, licon.get(real, ""))
    # 大決戦の `RaidBossGroup` は「ボス_地形_装甲」の 3 つ組
    TR_JA = {"street": "市街地", "outdoor": "屋外", "indoor": "屋内"}
    AR_JA = {"lightarmor": "軽装備", "heavyarmor": "重装甲", "unarmed": "特殊装甲",
             "elasticarmor": "弾力装甲", "normalarmor": "通常装甲"}

    def split(dev):
        """開発名を ボス / 地形 / 装甲 に割る。**総力戦は 1 つ目だけ。**"""
        parts = dev.split("_")
        base = parts[0]
        tr = ar = ""
        for x in parts[1:]:
            if x.lower() in TR_JA:
                tr = TR_JA[x.lower()]
            elif x.lower() in AR_JA:
                ar = AR_JA[x.lower()]
        return base, tr, ar

    def rows(src, kind):
        out = []
        for r in src:
            dev = r.get("RaidBossGroup") or ""
            if not dev or not r.get("DefaultClearScore"):
                continue
            base, tr, ar = split(dev)
            out.append({
                "k": kind, "b": base,
                "n": lname.get(base.lower(), base),
                "ic": licon.get(base.lower(), ""),
                "tr": tr, "ar": ar,
                "d": r.get("Difficulty", ""),
                # クリアしたときに必ずもらえるぶん
                "cl": r["DefaultClearScore"],
                # HP をぜんぶ削ったときのぶん
                "hp": r.get("HPPercentScore", 0),
                # 1 秒あたり減るぶんと、その満額
                "ps": r.get("PerSecondMinusScore", 0),
                "mx": r.get("MaximumScore", 0),
                "lo": r.get("MinimumAcquisitionScore", 0),
                "hi": r.get("MaximumAcquisitionScore", 0),
                "du": (r.get("BattleDuration") or 0) // 1000,
            })
        return out

    all_rows = rows(stages, "raid") + rows(elim, "elim")
    if len(all_rows) < 100:
        raise SystemExit(f"スコアの行が {len(all_rows)} しか取れない")
    lost = sorted({r["b"] for r in all_rows if r["n"] == r["b"]})
    if lost:
        raise SystemExit(f"日本語名が引けないボス: {lost}")

    # **式が合っているかを、全行で機械に確かめさせる。**
    #   いちばん低い ＝ クリアぶん ＋ HP ぶん（時間を使い切ったとき）
    #   いちばん高い ＝ それ ＋ 時間ぶんの満額（0 秒で倒したとき）
    for r in all_rows:
        if r["lo"] and r["cl"] + r["hp"] != r["lo"]:
            raise SystemExit(f"最低スコアが合わない: {r['dev']} {r['d']}")
        if r["hi"] and r["lo"] + r["mx"] != r["hi"]:
            raise SystemExit(f"最高スコアが合わない: {r['dev']} {r['d']}")

    # 時間ぶんが 0 になるまでの秒数。**全行で同じなら定数にできる**
    #
    # **`PerSecondMinusScore` をそのまま 1 秒あたりの減点として使ってはいけない。**
    # 割ると 360 になるが、これだと 3 分ボスを 2 凸しただけで時間ぶんが 0 になり、
    # 誰でも同じ点になってしまう。実際は **1/10 が 1 秒あたりの減点**で、
    # 時間ぶんが尽きるのは 3600 秒（＝部隊の合計戦闘時間 1 時間）ぶん。
    # kina-ko-m-ochi.net/score/ の `script.js` が
    # `timeScore = (3600 - clearSeconds) * multiplier` としていて、その
    # `multiplier` が難易度ごとに 120/240/480/960/1440/1920/2400/2880 ——
    # **こちらの `PerSecondMinusScore` のちょうど 1/10** で全段一致する。
    # あちらの `baseScores` も `DefaultClearScore + HPPercentScore` と
    # 3 分ボス・4 分ボスの両方で一致した（2026-08-30 に突き合わせた）。
    spans = {r["mx"] // r["ps"] for r in all_rows if r["ps"]}
    if len(spans) != 1:
        raise SystemExit(f"時間ぶんが尽きる秒数が揃わない: {sorted(spans)}")
    raw_span = spans.pop()
    if raw_span != 360:
        raise SystemExit(f"時間ぶんが尽きる目盛りが 360 でない: {raw_span}")
    span = raw_span * 10                      # 3600 秒
    for r in all_rows:
        if r["ps"] % 10:
            raise SystemExit(f"PerSecondMinusScore が 10 で割り切れない: {r['dev']} {r['ps']}")
        r["ps"] //= 10

    # **スコアは地形と装甲では変わらない。**大決戦は「ボス_地形_装甲」で 504 行
    # あるが、同じボス・同じ難易度なら中身が 1 種類しかない（2026-08-30 に確認）。
    # 畳んで、選べる地形と装甲の組だけ別に持つ
    packed = {}
    for r in all_rows:
        key = (r["k"], r["b"], r["d"])
        got = (r["cl"], r["hp"], r["ps"], r["mx"], r["du"])
        if key in packed and packed[key]["v"] != got:
            raise SystemExit(f"同じボス・難易度で値が割れている: {key}")
        packed.setdefault(key, {"v": got, "r": r})
    rows_out = []
    for (kind, base, diff), x in packed.items():
        r = x["r"]
        rows_out.append({"k": kind, "b": base, "n": r["n"], "ic": r["ic"], "d": diff,
                         "cl": r["cl"], "hp": r["hp"], "ps": r["ps"], "mx": r["mx"], "du": r["du"]})
    print(f"  {len(all_rows)} 行を {len(rows_out)} 行に畳んだ")

    n = 0
    for dev, p_ in icons.items():
        if not p_:
            continue
        if not fetch_portrait(f"bossicon_{p_}", f"https://schaledb.com/images/raid/icon/Boss_Portrait_{p_}_Lobby.png"):
            n += fetch_portrait(f"boss_{p_}", f"https://schaledb.com/images/raid/Boss_Portrait_{p_}_Lobby.png")
        else:
            n += 1
    # **どちらの前置きで取れたかをデータに書く。**ページ側で `bossicon_` を
    # 決め打ちして外れたら `boss_` に落とす作りにしていたが、外れた 1 回ぶんの
    # 404 がコンソールに残る（ドラム缶ガニ。2026-08-31）。取れたほうを持たせる
    for r in rows_out:
        base = r["ic"]
        if not base:
            continue
        r["ic"] = f"bossicon_{base}" if (IMG / f"bossicon_{base}.webp").exists() else f"boss_{base}"
        if not (IMG / f"{r['ic']}.webp").exists():
            raise SystemExit(f"ボスの絵が無い: {base}")

    print(f"  {len(all_rows)} 行（総力戦 {len(rows(stages, 'raid'))} ／ 大決戦 {len(rows(elim, 'elim'))}）、"
          f"時間ぶんが尽きるのは {span} 秒、絵 {n} 枚を追加")

    return write_js("tools/raid-score/data.js", "RSCORE", {
        "rows": rows_out, "span": span,
        # **地形と装甲はスコアに効かない**ので持たない。総力戦にも大決戦にも
        # 「ボス_地形_装甲」の行があるが、同じボス・同じ難易度なら中身は 1 種類だった
        "kinds": {"raid": "総力戦", "elim": "大決戦"},
        "diffJa": loc.get("RaidDifficulty", {}),
        "version": "electricgoat/ba-data jp（RaidStage・EliminateRaidStage）／ SchaleDB jp（ボスの名前と絵）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------- 星上げ（神名文字）

def build_eleph():
    print("星上げ（神名文字）の計算機")
    students = as_list(get_json(SD.format("students")))
    items = as_list(get_json(SD.format("items")))
    tr = {x["CharacterId"]: x for x in as_list(get_json(BADB.format("CharacterTranscendenceExcelTable")))}
    rec = {x["Id"]: x for x in as_list(get_json(BADB.format("RecipeExcelTable")))}
    ing = {x["Id"]: x for x in as_list(get_json(BADB.format("RecipeIngredientExcelTable")))}
    iname = {int(i["Id"]): i.get("Name", "") for i in items if i.get("Id")}
    # **神名文字の絵は生徒ごとに違う。**`item_icon_secretstone` は
    # 「神名のカケラ」（Id 23）の絵で、神名文字ではない
    # （2026-08-30 の先生の指摘——「神名文字なのに画像が神名の欠片 分かりづらい」）
    iicon = {int(i["Id"]): i.get("Icon", "") for i in items if i.get("Id")}

    def steps_of(cid):
        """★1→2, 2→3, 3→4, 4→5 の 4 段。**中身は (クレジット, 神名文字の Id, 個数)**"""
        t = tr.get(cid)
        if not t or not t.get("RecipeId"):
            return None
        out = []
        for r in t["RecipeId"]:
            R = rec.get(r)
            I = ing.get(R["RecipeIngredientId"]) if R else None
            if not I or not I.get("IngredientId") or not I.get("CostAmount"):
                return None
            out.append((I["CostAmount"][0], I["IngredientId"][0], I["IngredientAmount"][0]))
        return out if len(out) == 4 else None

    stu, pats, bonus, favors = [], {}, {}, {}
    for s_ in students:
        cid = s_["Id"]
        st = steps_of(cid)
        # **神名のカケラ（Id 23）を 999 個要求する行は仮置き。**中身が入っていない
        if not st or st[0][1] == 23:
            continue
        t = tr[cid]
        pats.setdefault(tuple((c, a) for c, _i, a in st), 0)
        pats[tuple((c, a) for c, _i, a in st)] += 1
        bonus.setdefault((tuple(t["StatBonusRateAttack"]), tuple(t["StatBonusRateHP"]),
                          tuple(t["StatBonusRateHeal"])), 0)
        bonus[(tuple(t["StatBonusRateAttack"]), tuple(t["StatBonusRateHP"]),
               tuple(t["StatBonusRateHeal"]))] += 1
        favors.setdefault(tuple(t["MaxFavorLevel"]), 0)
        favors[tuple(t["MaxFavorLevel"])] += 1
        stu.append({"id": cid, "n": NAMES.get(s_["Id"], s_["Name"]), "s": s_.get("StarGrade", 1),
                    "e": st[0][1], "en": iname.get(st[0][1], ""),
                    "si": iicon.get(st[0][1], "")})

    if not stu:
        raise SystemExit("星上げのレシピが 1 人も取れない。列名が変わった疑い")
    # **全員同じ値かどうかを毎回数える。**違う子が出たら、そのときは表を持つ形に直す
    if len(pats) != 1:
        raise SystemExit(f"必要数が生徒ごとに割れている: {sorted(pats.items())[:4]}")
    if len(bonus) != 1:
        raise SystemExit(f"星の上がり幅が生徒ごとに割れている: {len(bonus)} 通り")
    if len(favors) != 1:
        raise SystemExit(f"絆ランクの上限が生徒ごとに割れている: {len(favors)} 通り")
    need = list(pats)[0]
    atk, hp, heal = list(bonus)[0]
    fav = list(favors)[0]

    steps = []
    for i in range(4):
        steps.append({"to": i + 2, "cr": need[i][0], "el": need[i][1],
                      # StatBonusRate は 10000 分率。**★1 のぶんは 0** なので 1 つずらす
                      "atk": atk[i + 1], "hp": hp[i + 1], "heal": heal[i + 1],
                      # 絆の上限は ★1 から順に 10 / 10 / 20 / 30 / 100。
                      # **★4 は 20 から 30 に上がっている**（`Excel/` は 20 のまま）。
                      # `DB/CharacterTranscendenceExcelTable` の 817 行のうち 810 行が
                      # この並びで、最終更新は 2026-08-26 / v1.72.452186（2026-08-31 に実測）
                      "fav": fav[i + 1]})

    # ---- ここから限界解放（固有武器の星）。**★5 が上限ではない**
    #
    # 2026-08-30 の先生の指摘。★5 のあとに 固有1 → 固有2 → 固有3 → 固有4 と続く。
    # ★の方を「神秘解放」、固有武器の方を「限界解放」と呼び分ける
    # （ブルアカ攻略 Wiki の「神秘解放/限界解放」）。
    #
    # **`Excel/` ではなく `DB/` を読む。**`Excel/CharacterWeaponExcelTable` は
    # 2025-05-21（v1.57.342698）で止まっていて 224 行、`Unlock` は全員
    # `[T,T,T,F,F]`（固有4 が未実装に見える）。`DB/` は 275 行で
    # `[T,T,T,T,F]`、固有4 の枠（`StatType[3]` / `StatValue[3]`）も埋まっている。
    # **`StatValue[2]`（固有3 で上がる地形適性）も 224 行すべてで違っていて、**
    # 例えばカリン（制服）26014 は Excel/ が 2、DB/ が 1。DB/ は SchaleDB の
    # `Weapon.AdaptationValue` と 274 人ぜんぶ一致する（2026-08-31 に実測）。
    # 段の上限は SchaleDB の `config.json` `Regions[Jp].WeaponMaxLevel` が正本。
    weap = {x["Id"]: x for x in as_list(get_json(BADB.format("CharacterWeaponExcelTable")))}

    # **固有3→4 の神名文字だけ、ba-data に実数が入っていない。**
    # `IngredientAmount` が 1 の仮置きで、クレジット 2,000,000 のほうは正しい。
    # 実数は game8 の「固有武器★4の解放必要素材」から取った（2026-08-30 に取得）:
    #   固有★3→固有★4 … 神名文字 200 個 / クレジット 200 万
    # 裏取り: 同記事の累計「★1→固有★4 = 830」が、
    #   ★1→★5 の 330（30+80+100+120、ブルアカ攻略 Wiki と ba-data が一致）
    #   ＋120＋180＋200 = 830 とぴたり合う。
    #
    # **2026-08-31 追記。`DB/` 側にはもう実数の 200 が入っている。**
    # 下の差し替えは `Excel/` を読んでいた頃の名残で、いまは一度も発火しない。
    # 発火したときだけ `src` に印を付けるようにしてあるので、
    # **画面の「外から取った」表示も自動で消える。**data.js を見れば分かる
    WEAPON_EL_FALLBACK = {2: 200}          # 添字は「何段目の遷移か」（0 起点）
    WEAPON_EL_SRC = "https://game8.jp/blue-archive/706922"
    used_fallback = set()                  # 実際に差し替えが起きた段だけ入る

    def weapon_steps(cid):
        """固有1→2, 2→3, 3→4 の 3 段。4 段目（固有4→5）は日本では未実装。"""
        w = weap.get(cid)
        if not w or not w.get("RecipeId"):
            return None
        out = []
        for k, r in enumerate(w["RecipeId"][:3]):
            R = rec.get(r)
            I = ing.get(R["RecipeIngredientId"]) if R else None
            if not I or not I.get("CostAmount"):
                return None
            amt = I["IngredientAmount"][0] if I.get("IngredientAmount") else 0
            # 仮置き（1 個）は外の出どころで置き換える
            if amt <= 1 and k in WEAPON_EL_FALLBACK:
                amt = WEAPON_EL_FALLBACK[k]
                used_fallback.add(k)
            out.append((I["CostAmount"][0], amt))
        return tuple(out) if len(out) == 3 else None

    wpats, wlv, wskill = {}, {}, {}
    sq_by = {x["Id"]: x.get("SquadType") for x in students}
    bt_by = {x["Id"]: x.get("BulletType") for x in students}
    for r in stu:
        w = weap.get(r["id"])
        ws = weapon_steps(r["id"])
        if not w or not ws:
            continue
        wpats[ws] = wpats.get(ws, 0) + 1
        wlv[tuple(w["MaxLevel"])] = wlv.get(tuple(w["MaxLevel"]), 0) + 1
        wskill[tuple(w["LearnSkillSlot"])] = wskill.get(tuple(w["LearnSkillSlot"]), 0) + 1
        # 固有3 で上がる地形適性。**+1 の子と +2 の子がいる**ので生徒ごとに持つ
        r["ad"] = (w["StatType"][2] or "").replace("BattleAdaptation_Base", "")
        r["av"] = w["StatValue"][2]
        r["sq"] = sq_by.get(r["id"]) or "Main"
        # **固有4 で増えるぶんもゲームのデータに入っている**（2026-08-31 に気づいた。
        # `Excel/` 側は `StatType[3]` が `None` のままで、長らく「データに無い」と
        # 書いていた）。ストライカーは自分の攻撃属性の特効、スペシャルはコスト上限
        r["f4"] = (w["StatType"][3] or "").replace("_Base", "")
        r["f4v"] = w["StatValue"][3]

    if len(wpats) != 1:
        raise SystemExit(f"限界解放の必要数が生徒ごとに割れている: {sorted(wpats.items())[:4]}")
    if len(wlv) != 1:
        raise SystemExit(f"固有武器のレベル上限が生徒ごとに割れている: {len(wlv)} 通り")
    if len(wskill) != 1:
        raise SystemExit(f"固有武器で覚えるスキル枠が生徒ごとに割れている: {len(wskill)} 通り")
    wneed = list(wpats)[0]
    wmax = list(wlv)[0]
    if wmax[:4] != (30, 40, 50, 60):
        raise SystemExit(f"固有武器のレベル上限が {wmax} に変わっている")
    if list(wskill)[0][1] != "Passive01":
        raise SystemExit("固有2 でパッシブを覚えるという前提が崩れた")

    # **固有4 のぶんを 1 人ずつ突き合わせる。**ストライカー（`Main`）は
    # `Enhance<攻撃属性>Rate_Base` が `1000`（＝ 特効 ＋10%）、スペシャル（`Support`）は
    # `MaxCostIncrease_Base` が `5000`（＝ コスト上限 ＋0.5）。
    # game8 と ブルアカ攻略 Wiki の「ST:〇〇特効加算+10%、SP:最大コスト0.5増加」と
    # 一致する。**1 人でも外れたらここで止まる**
    for r in stu:
        if not r.get("f4"):
            continue
        if r["sq"] == "Support":
            want = ("MaxCostIncrease", 5000)
        else:
            want = (f"Enhance{bt_by.get(r['id'])}Rate", 1000)
        if (r["f4"], r["f4v"]) != want:
            raise SystemExit(f"固有4 の内容が想定と違う: {r['n']} {r['f4']} {r['f4v']}（{want} のはず）")

    # 固有1 は ★5 になった時点で使えるので、費用は 0
    wsteps = [{"to": 1, "cr": 0, "el": 0, "lv": wmax[0], "gain": "unlock"}]
    for i, (cr, el) in enumerate(wneed):
        wsteps.append({"to": i + 2, "cr": cr, "el": el, "lv": wmax[i + 1],
                       "gain": ["passive", "adapt", "final"][i],
                       # 実数がゲームのデータに無く、外の出どころで埋めた段には印を付ける。
                       # **実際に差し替えが起きた段だけ。**入っていれば印は付かない
                       "src": WEAPON_EL_SRC if i in used_fallback else ""})

    adapt = {}
    for r in stu:
        if r.get("ad"):
            adapt[(r["ad"], r["av"])] = adapt.get((r["ad"], r["av"]), 0) + 1
    n = 0
    for r in stu:
        if r.get("si"):
            n += fetch_icon(r["si"], f"https://schaledb.com/images/item/icon/{r['si']}.webp")
    print(f"  神名文字の絵 {n} 枚を追加")
    print(f"  {len(stu)} 人ぶん、必要な神名文字は {[x['el'] for x in steps]}、"
          f"クレジットは {[x['cr'] for x in steps]}")
    print(f"  限界解放は {[x['el'] for x in wsteps]} 文字 / {[x['cr'] for x in wsteps]} クレジット、"
          f"レベル上限 {list(wmax[:4])}、地形の伸び {sorted(adapt.items())}")
    return write_js("tools/eleph/data.js", "ELEPH", {
        "steps": steps,
        "wsteps": wsteps,
        "fav1": fav[0],
        "stu": sorted(stu, key=lambda x: x["id"]),
        "version": "electricgoat/ba-data jp（CharacterTranscendence・CharacterWeapon・Recipe・RecipeIngredient）／ SchaleDB jp（生徒と道具の名前）／ game8（固有3→4 の神名文字）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------- 贈り物の逆引き

def build_gift_search():
    """**絆ランク計算機の裏返し。**あちらは「生徒 → 効く贈り物」、こちらは
    「贈り物 → 効く生徒」。式は同じ（`ExpValue ×（一致タグ数 ＋ 1）`、一致は 3 で頭打ち）
    なので、データも同じところから作る。"""
    print("贈り物の逆引き")
    items = as_list(get_json(SD.format("items")))
    students = as_list(get_json(SD.format("students")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))
    loc = get_json(SD.format("localization"))

    gen = []
    for c in const:
        if c.get("CommonFavorItemTags"):
            gen = list(c["CommonFavorItemTags"])
            break
    if not gen:
        raise SystemExit("CommonFavorItemTags が取れない")

    gifts = []
    for i in items:
        if i.get("Category") != "Favor" or not i.get("Tags"):
            continue
        gifts.append({"id": i["Id"], "n": i.get("Name", ""), "e": i.get("ExpValue", 0),
                      "t": list(i["Tags"]), "i": i.get("Icon", ""), "r": i.get("Rarity", "")})
    if not gifts:
        raise SystemExit("贈り物が 1 つも取れない")

    school = loc.get("School", {})
    role = loc.get("TacticRole", {})
    stu = []
    for s_ in students:
        stu.append({"id": s_["Id"], "n": NAMES.get(s_["Id"], s_["Name"]),
                    "t": s_.get("FavorItemTags", []) or [],
                    "u": s_.get("FavorItemUniqueTags", []) or [],
                    "sc": school.get(s_.get("School", ""), s_.get("School", "")),
                    "ro": role.get(s_.get("TacticRole", ""), s_.get("TacticRole", "")),
                    "st": s_.get("StarGrade", 1)})
    if not any(x["u"] for x in stu):
        raise SystemExit("FavorItemUniqueTags が 1 人も取れない。列名が変わった疑い")

    # **ここで一度数えておく。**ページ側でも同じ式で数えるが、
    # 作る側で数えておかないと「本当に全員に ×4 の贈り物があるか」を確かめられない
    def mult(g, s_):
        allt = set(s_["t"]) | set(s_["u"]) | set(gen)
        return min(sum(1 for t in g["t"] if t in allt), 3) + 1

    best = {s_["id"]: max(mult(g, s_) for g in gifts) for s_ in stu}
    if min(best.values()) < 4:
        bad = [x["n"] for x in stu if best[x["id"]] < 4]
        raise SystemExit(f"×4 の贈り物が無い生徒がいる: {bad[:5]}")
    top = sorted(gifts, key=lambda g: -sum(1 for s_ in stu if mult(g, s_) == 4))
    print(f"  贈り物 {len(gifts)} 種、生徒 {len(stu)} 人。"
          f"いちばん広いのは「{top[0]['n']}」で ×4 が "
          f"{sum(1 for s_ in stu if mult(top[0], s_) == 4)} 人")

    n = 0
    for g in gifts:
        if g["i"]:
            n += fetch_icon(g["i"], f"https://schaledb.com/images/item/icon/{g['i']}.webp")
    print(f"  絵 {n} 枚を追加")

    return write_js("tools/gift-search/data.js", "GIFTX", {
        "gen": gen, "gifts": sorted(gifts, key=lambda g: (-g["e"], g["id"])),
        "stu": sorted(stu, key=lambda x: x["id"]),
        "version": "SchaleDB jp（贈り物・生徒・学校名）／ electricgoat/ba-data jp（共通タグ）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# --------------------------------------------- 攻撃属性・装甲・地形の倍率

def build_matchup():
    """**倍率表そのもの。**攻撃属性 × 装甲と、地形適性の 6 段。

    表は 2 か所から取って突き合わせる。SchaleDB の `config.json` が
    `TypeEffectiveness`（6 攻撃属性 × 7 装甲 = 42 升）、`DB/BulletArmorDamageFactorExcelTable`
    が 56 升（8 × 7。`Siege` と `None` のぶんが多い）。
    **止まっている `Excel/` 側は 42 行しか無く、分解と複合装甲が入っていない**
    （2026-08-30 にそれを見て「ba-data のほうが古い」と書いていた。
    `DB/` に切り替えた 2026-08-31 に解消）。
    重なっている升は 1 つずつ照合して、食い違ったら止まる。"""
    print("攻撃属性・装甲・地形の倍率")
    cfg = get_json(SD_CFG)
    loc = get_json(SD.format("localization"))
    students = as_list(get_json(SD.format("students")))
    fac = as_list(get_json(BADB.format("BulletArmorDamageFactorExcelTable")))
    terr = as_list(get_json(BADB.format("TerrainAdaptationFactorExcelTable")))

    eff = cfg.get("TypeEffectiveness")
    if not eff:
        raise SystemExit("config.json に TypeEffectiveness が無い")

    # **重なっている升を 1 つずつ照合する。**SchaleDB 側に無い升
    # （`Siege` と `None`）は飛ばして、あるぶんだけ数える
    checked = 0
    for r in fac:
        b, a, v = r["BulletType"], r["ArmorType"], r["DamageRate"]
        if b not in eff or a not in eff[b]:
            continue
        if eff[b][a] != v:
            raise SystemExit(f"倍率が食い違う: {b}×{a} SchaleDB {eff[b][a]} / ba-data {v}")
        checked += 1
    missing = sorted({(b, a) for b in eff for a in eff[b]} -
                     {(r["BulletType"], r["ArmorType"]) for r in fac})
    print(f"  重なる {checked} 升は一致。ba-data 側に無いのは {len(missing)} 升"
          f"（{', '.join(b + '×' + a for b, a in missing[:4])}…）")

    # 地形適性。**3 つの地形で値が同じ**なら 1 本の表にできる
    grades = ["SS", "S", "A", "B", "C", "D"]
    tt = {}
    for r in terr:
        tt.setdefault(r["TerrainAdaptationStat"], set()).add(
            (r["ShotFactor"], r["BlockFactor"], r["AccuracyFactor"],
             r["DodgeFactor"], r["AttackPowerFactor"]))
    for g, v in tt.items():
        if len(v) != 1:
            raise SystemExit(f"地形で値が割れている: {g} {v}")
    if sorted(tt) != sorted(grades):
        raise SystemExit(f"地形適性の段が想定と違う: {sorted(tt)}")
    trows = []
    for g in grades:
        shot, block, acc, dodge, atk = list(tt[g])[0]
        trows.append({"g": g, "shot": shot, "block": block, "atk": atk,
                      "acc": acc, "dodge": dodge})

    # 生徒。**地形適性は 0〜5 の数字**で、0 が D、5 が SS
    school, role = loc.get("School", {}), loc.get("TacticRole", {})
    stu = []
    for s_ in students:
        stu.append({"id": s_["Id"], "n": NAMES.get(s_["Id"], s_["Name"]),
                    "b": s_.get("BulletType", ""), "a": s_.get("ArmorType", ""),
                    "ro": role.get(s_.get("TacticRole", ""), s_.get("TacticRole", "")),
                    "sc": school.get(s_.get("School", ""), s_.get("School", "")),
                    "sq": s_.get("SquadType", ""),
                    "ad": [s_.get("StreetBattleAdaptation", 0),
                           s_.get("OutdoorBattleAdaptation", 0),
                           s_.get("IndoorBattleAdaptation", 0)]})
    if max(max(x["ad"]) for x in stu) > 5 or min(min(x["ad"]) for x in stu) < 0:
        raise SystemExit("地形適性が 0〜5 の外に出ている")

    bullets = ["Explosion", "Pierce", "Mystic", "Sonic", "Chemical", "Normal"]
    armors = ["LightArmor", "HeavyArmor", "Unarmed", "ElasticArmor",
              "CompositeArmor", "Structure", "Normal"]
    for b in bullets:
        if b not in eff:
            raise SystemExit(f"攻撃属性 {b} が表に無い")

    return write_js("tools/matchup/data.js", "MATCH", {
        "eff": {b: {a: eff[b].get(a) for a in armors if a in eff[b]} for b in bullets},
        "bullets": bullets, "armors": armors,
        "bJa": loc.get("BulletType", {}), "aJa": loc.get("ArmorType", {}),
        "grades": grades, "terr": trows,
        "trJa": loc.get("AdaptationType", {}),
        # **効き方の呼び名はゲームの表記に合わせる。**日本のゲーム内でも
        # `Weak` / `Effective` / `Resist` / `Normal` と英語のまま出る
        # （SchaleDB の `localization` の `DamageAttribute` も訳していない。
        # 2026-08-30 の先生の指示——「weak とかでいい、弱点じゃなくて／ゲーム内表記に合わせて」）
        "dJa": loc.get("DamageAttribute", {}),
        "stu": sorted(stu, key=lambda x: x["id"]),
        "checked": checked,
        "version": "SchaleDB config.json（TypeEffectiveness）／ electricgoat/ba-data jp（BulletArmorDamageFactor・TerrainAdaptationFactor）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------- 潜在能力解放（ポテンシャル）

def build_potential():
    """**段の表は「今の段 → 次の段」で引く。**

    `SchaleDB config.json` の `PotentialMaterial` は 25 要素の配列だが、
    **`[i]` は「レベル `i` に到達するぶん」ではなく「`i` から `i+1` へ上げるぶん」。**
    到達レベルで引くと 5 / 10 / 15 / 20 の境目が全部 1 段ずれる（60 群 × 25 段の
    うち 300 手順が食い違う。1 つずらすと 1515 手順すべて一致した。2026-08-30 に実測）。
    SchaleDB 本体の `assets/StudentView-*.js` も
    `for (g = 1; g <= 表示段; g++) { … E[g-1].CostAmount … }` と `g-1` で引いている。

    もう一つ。**`PotentialLevel = 25` の行に付く `RecipeId` は存在しない**
    （群 10010 なら `100100026`）。25 段目を「次へ上げる手順」として読まないこと。
    """
    print("潜在能力解放の計算機")
    cfg = get_json(SD_CFG)
    students = as_list(get_json(SD.format("students")))
    items = as_list(get_json(SD.format("items")))
    loc = get_json(SD.format("localization"))
    pot = as_list(get_json(BADB.format("CharacterPotentialExcelTable")))
    pstat = as_list(get_json(BADB.format("CharacterPotentialStatExcelTable")))
    rec = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeExcelTable")))}
    ing = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeIngredientExcelTable")))}
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))

    mats = cfg.get("PotentialMaterial") or []
    if len(mats) != 25:
        raise SystemExit(f"PotentialMaterial が {len(mats)} 段しかない（25 のはず）")

    # 上限と開放条件。**手で 25 と書かない。**表から取って、食い違ったら止める
    cc = next((c for c in const if c.get("PotentialOpenConditionCharacterLevel")), None)
    if not cc:
        raise SystemExit("PotentialOpenConditionCharacterLevel が取れない")
    caps = {cc.get("PotentialBonusStatMaxLevelMaxHP"),
            cc.get("PotentialBonusStatMaxLevelAttackPower"),
            cc.get("PotentialBonusStatMaxLevelHealPower")}
    if caps != {25}:
        raise SystemExit(f"段の上限が 25 で揃っていない: {sorted(caps)}")

    # 生徒 → 群。**下 2 桁が枠**（10 最大 HP / 20 攻撃力 / 30 治癒力）
    SUF = {10: "MaxHP", 20: "AttackPower", 30: "HealPower"}
    by_cid = {}
    for r in pot:
        by_cid.setdefault(r["Id"], {})[r["PotentialStatBonusRateType"]] = r
    used = {r["PotentialStatGroupId"] for r in pot}

    groups = {}
    for r in pstat:
        groups.setdefault(r["PotentialStatGroupId"], {})[r["PotentialLevel"]] = r
    # **どの生徒からも指されていない群はダミー。**29997〜29999 の 3 つで、
    # 中身が全段同じ仮置きになっている。数えるほうに混ぜると 60 手順が食い違う
    dummy = sorted(set(groups) - used)
    if len(dummy) != 3:
        raise SystemExit(f"生徒から指されていない群が {len(dummy)} 個ある: {dummy}")

    books, arts, ok = {}, {}, 0
    for gid, lv in groups.items():
        if gid not in used:
            continue
        if sorted(lv) != list(range(26)):
            raise SystemExit(f"群 {gid} の段が 0〜25 で揃っていない")
        if rec.get(lv[25]["RecipeId"]):
            raise SystemExit(f"群 {gid} の 25 段目にレシピがある。上限が伸びた疑い")
        suf = gid % 100
        if suf not in SUF:
            raise SystemExit(f"群 {gid} の下 2 桁が {suf}。枠の割り当てが変わった疑い")
        base = gid // 100
        for l in range(25):
            R = rec.get(lv[l]["RecipeId"])
            I = ing.get(R["RecipeIngredientId"]) if R else None
            if not I:
                raise SystemExit(f"群 {gid} 段 {l} のレシピが引けない")
            m = mats[l]
            if (I["CostAmount"][0] != m["CostAmount"]
                    or I["IngredientAmount"][0] != m["ArtifactAmount"]
                    or I["IngredientAmount"][1] != m["BookAmount"]):
                raise SystemExit(
                    f"段 {l} の中身が config と食い違う（群 {gid}）: "
                    f"{I['CostAmount'][0]}/{I['IngredientAmount']} と {m}")
            if I["IngredientId"][0] != base + m["ArtifactGrade"]:
                raise SystemExit(f"群 {gid} 段 {l} のオーパーツが {I['IngredientId'][0]}。"
                                 f"{base} + {m['ArtifactGrade']} のはず")
            books.setdefault(SUF[suf], set()).add(I["IngredientId"][1])
            arts.setdefault(base, set()).add(I["IngredientId"][0])
            # 伸び幅は 1 段 20（10000 分率）。**ここも数えて確かめる**
            if lv[l + 1]["StatBonusRate"] != (l + 1) * 20:
                raise SystemExit(f"群 {gid} 段 {l+1} の StatBonusRate が "
                                 f"{lv[l+1]['StatBonusRate']}（{(l+1)*20} のはず）")
            ok += 1
    if ok != len(used) * 25:
        raise SystemExit(f"数えた手順が {ok}。{len(used)} 群 × 25 のはず")
    for k, v in books.items():
        if len(v) != 1:
            raise SystemExit(f"{k} の WB が 1 種類でない: {sorted(v)}")
    for k, v in arts.items():
        if v != {k, k + 1}:
            raise SystemExit(f"オーパーツ {k} の段が {sorted(v)}。{k} と {k+1} のはず")

    iname = {i["Id"]: i for i in items if i.get("Id")}

    def item(iid):
        it = iname.get(iid)
        if not it:
            raise SystemExit(f"道具 {iid} が SchaleDB の items に無い")
        return {"n": (it.get("Name") or "").replace("\n", ""), "i": it.get("Icon", "")}

    # **短い呼び名は `localization` の `ArtifactClass`。**「ネブラディスクの欠片」から
    # 「の欠片」を削っても「ヴォルフスエックの鉄鉱石」のような子は短くならない
    cls = loc.get("ArtifactClass", {})
    art_out = {}
    for base in sorted(arts):
        key = str(base // 10)
        if key not in cls:
            raise SystemExit(f"オーパーツ {base} の呼び名が localization に無い（キー {key}）")
        art_out[str(base)] = {"a": item(base), "b": item(base + 1), "c": cls[key]}
    book_out = {k: dict(item(list(v)[0]), id=list(v)[0]) for k, v in books.items()}

    school, role = loc.get("School", {}), loc.get("TacticRole", {})
    stu = []
    for s_ in students:
        cid = s_.get("Id")
        row = by_cid.get(cid)
        if not row or not s_.get("Name"):
            continue
        bases = {r["PotentialStatGroupId"] // 100 for r in row.values()}
        if len(bases) != 1:
            raise SystemExit(f"生徒 {cid} の群が枠ごとに違う: {sorted(bases)}")
        base = bases.pop()
        # **SchaleDB 側の `PotentialMaterial` と突き合わせる。**274 人全員一致した
        if s_.get("PotentialMaterial") != base:
            raise SystemExit(f"生徒 {cid} のオーパーツが食い違う: "
                             f"ba-data {base} / SchaleDB {s_.get('PotentialMaterial')}")
        stu.append({
            "id": cid, "n": NAMES.get(s_["Id"], s_["Name"]), "a": base, "st": s_.get("StarGrade", 1),
            "sc": school.get(s_.get("School", ""), s_.get("School", "")),
            "ro": role.get(s_.get("TacticRole", ""), s_.get("TacticRole", "")),
            # **要らない枠**（治癒力を使わない子など）。ゲームのデータが持っている
            "un": [bool(row[k]["IsUnnecessaryStat"]) for k in ("MaxHP", "AttackPower", "HealPower")],
            # Lv1 と Lv100 の 2 点。伸びはここから出す
            "b": [[s_.get("MaxHP1", 0), s_.get("MaxHP100", 0)],
                  [s_.get("AttackPower1", 0), s_.get("AttackPower100", 0)],
                  [s_.get("HealPower1", 0), s_.get("HealPower100", 0)]],
        })
    if len(stu) < 250:
        raise SystemExit(f"生徒が {len(stu)} 人しか取れない")
    un = sum(1 for s_ in stu if s_["un"][2])
    print(f"  生徒 {len(stu)} 人、オーパーツ {len(art_out)} 種、手順 {ok} 件を突き合わせて一致"
          f"（治癒力が不要な子は {un} 人）")

    n = 0
    for v in art_out.values():
        for k in ("a", "b"):
            n += fetch_icon(v[k]["i"], f"https://schaledb.com/images/item/icon/{v[k]['i']}.webp")
    for v in book_out.values():
        n += fetch_icon(v["i"], f"https://schaledb.com/images/item/icon/{v['i']}.webp")
    fetch_icon("currency_icon_gold", "https://schaledb.com/images/item/icon/currency_icon_gold.webp")
    for s_ in stu:
        n += fetch_portrait(f"student_{s_['id']}",
                            f"https://schaledb.com/images/student/collection/{s_['id']}.webp")
    print(f"  絵 {n} 枚を追加")

    return write_js("tools/potential/data.js", "POT", {
        # **添字は「今の段」。**steps[0] が 0 → 1
        "steps": [{"cr": m["CostAmount"], "g": m["ArtifactGrade"],
                   "an": m["ArtifactAmount"], "bk": m["BookAmount"]} for m in mats],
        "max": 25,
        "openLv": cc["PotentialOpenConditionCharacterLevel"],
        "rate": 20,                      # 1 段あたりの伸び（10000 分率）
        "arts": art_out, "books": book_out,
        "statJa": {"MaxHP": "最大 HP", "AttackPower": "攻撃力", "HealPower": "治癒力"},
        "stu": sorted(stu, key=lambda x: x["id"]),
        "checked": ok,
        "version": "SchaleDB config.json（PotentialMaterial）／ electricgoat/ba-data jp"
                   "（CharacterPotential・CharacterPotentialStat・Recipe・RecipeIngredient・ConstCommon）"
                   "／ SchaleDB jp（生徒・道具の名前と絵）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------- 固有武器の強化

# **★3→★4 の神名文字だけ、ゲームデータが仮置きのまま。**
# 224 本すべてが `IngredientAmount = 1` で、クレジット `2000000` だけ実数が入っている。
# 実際は 200 個（game8「固有4のおすすめキャラと必要数」——
# https://game8.jp/blue-archive/706922 の「★3→★4の必要素材／神名文字：200個／
# クレジット：200万／神名のカケラ換算 1000」）。クレジットが表と一致しているので、
# 個数だけ外から補う。**表の値が 1 でなくなったら、この差し替えを外す**
WP_STAR4_STONE = 200
WP_STAR4_SRC = "game8"


def build_weapon():
    """固有武器のレベルと★。

    **`TotalExp` は「その行のレベルに到達するまで」ではなく「次のレベルまで」の累計。**
    行 `Level: 49` の `TotalExp` が 26280 で、これが Lv1 → Lv50 のぶん
    （game8「経験値テーブル一覧」の「固有武器1つのレベルを1から最大の50まで育てるには、
    26,280の経験値が必要」と一致。https://game8.jp/blue-archive/687342）。
    → **a から b へは `TotalExp[b-1] - TotalExp[a-1]`。**

    **武器パーツは `ItemExcelTable` に 1 件も無い。**`SchaleDB` の `equipment` 側に
    `Category = WeaponExpGrowthA / B / C / Z` として入っている（Id 10〜43）。
    Item として探すと 0 件で「JP に無い機能」と読み違える。

    **★の上限を `Unlock` で決めない。**224 本すべて `[true, true, true, false, false]`
    で ★3 までに見えるが、JP はもう ★4（`config.json` の `Regions[Jp].WeaponMaxLevel`
    が 60 ＝ SchaleDB の数え方で ★4）。ba-data の jp ブランチが古い。
    """
    print("固有武器の強化計算機")
    cfg = get_json(SD_CFG)
    students = as_list(get_json(SD.format("students")))
    equip = as_list(get_json(SD.format("equipment")))
    items = as_list(get_json(SD.format("items")))
    loc = get_json(SD.format("localization"))
    lv_tbl = as_list(get_json(BADB.format("CharacterWeaponLevelExcelTable")))
    bonus_tbl = as_list(get_json(BADB.format("CharacterWeaponExpBonusExcelTable")))
    weapons = as_list(get_json(BADB.format("CharacterWeaponExcelTable")))
    rec = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeExcelTable")))}
    ing = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeIngredientExcelTable")))}
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))

    # 経験値の表。**tot[i] は「Lv(i+1) から Lv(i+2) へ」までの累計**
    rows = sorted(lv_tbl, key=lambda x: x.get("Level", 0))
    if len(rows) != 70 or rows[0]["Level"] != 1 or rows[-1]["Level"] != 70:
        raise SystemExit(f"武器の経験値表が 70 行 (1〜70) でない（{len(rows)} 行）")
    if rows[-1]["Exp"] != 0:
        raise SystemExit("最終行の Exp が 0 でない。上限が伸びた疑い")
    tot = [r["TotalExp"] for r in rows]
    for a, b in zip(tot, tot[1:]):
        if b < a:
            raise SystemExit("TotalExp が単調でない")
    # **添字の付け替え。**`TotalExp` の行 `Level: N` は「Lv1 から Lv(N+1) まで」なので、
    # そのまま持たせるとページ側で 2 つずれる。`cum[L]` ＝ Lv1 から Lv L までに
    # 変えてから渡す（`cum[1] = 0`、`cum[50] = 26280`、`cum[70] = 83980`）
    cum = [0, 0] + tot[:-1]
    if len(cum) != 71:
        raise SystemExit(f"累計の表が {len(cum)} 個（71 のはず）")
    # **外の数字と突き合わせる見張り。**game8 の 26,280（Lv1→50）と合わなくなったら止める
    if cum[50] != 26280:
        raise SystemExit(f"Lv1→50 の経験値が {cum[50]}。game8 の 26,280 と食い違う")
    if cum[70] != tot[-1]:
        raise SystemExit("累計の付け替えがずれている")

    # ★ごとのレベル上限
    caps = {tuple(w["MaxLevel"]) for w in weapons}
    if len(caps) != 1:
        raise SystemExit(f"★ごとのレベル上限が武器で割れている: {sorted(caps)[:3]}")
    max_lv = list(caps.pop())
    jp = next((r for r in cfg.get("Regions", []) if r.get("Name") == "Jp"), None)
    if not jp:
        raise SystemExit("config.json に Jp の Regions が無い")
    jp_lv = jp["WeaponMaxLevel"]
    if jp_lv not in max_lv:
        raise SystemExit(f"Jp の WeaponMaxLevel {jp_lv} が {max_lv} に無い")
    jp_star = max_lv.index(jp_lv) + 1        # 60 → ★4

    # ★上げのレシピ。**全 224 本で同じ値であることを数えて確かめる**
    #
    # **神名文字は「その武器の Id」とは限らない。**224 本のうち 1 本だけ、
    # ホシノ（臨戦）の 10099 が 10098 の神名文字を使う（形態違いの片割れ。
    # 2026-08-30 に 224 本すべてを数えて見つけた）。どの子の神名文字かは
    # 生徒ごとに持たせる
    sd_ids = {x["Id"] for x in students if x.get("Name")}
    # **神名文字の絵は 1 人ずつ違う。**共通の `item_icon_secretstone` は
    # 「神名のカケラ」（Id 23）の絵なので、そちらを出すと別物になる
    # （2026-08-30 の先生の指摘——「神名文字なのに画像が神名の欠片 分かりづらい」）
    stone_icon = {int(i["Id"]): i.get("Icon", "") for i in items if i.get("Id")}
    sets, stone_of = set(), {}
    # **まだ出ていない生徒の武器を数に入れない。**`DB/CharacterWeaponExcelTable`
    # は 275 行あって、SchaleDB に載っていない 1 人ぶんだけレシピの形が違う。
    # 混ぜると「★上げの中身が武器で割れている」で止まる（2026-08-31 に実測）
    weapons = [w for w in weapons if w["Id"] in sd_ids]
    for w in weapons:
        row = []
        ids = set()
        for rid in w.get("RecipeId") or []:
            R = rec.get(rid)
            I = ing.get(R["RecipeIngredientId"]) if R else None
            if not I:
                row.append(None)
                continue
            ids.add(I["IngredientId"][0])
            row.append((I["CostAmount"][0], I["IngredientAmount"][0]))
        if len(ids) > 1:
            raise SystemExit(f"武器 {w['Id']} の★上げが段ごとに違う神名文字を使う: {sorted(ids)}")
        if ids:
            sid = ids.pop()
            if sid not in sd_ids:
                raise SystemExit(f"武器 {w['Id']} の神名文字 {sid} が生徒に無い")
            stone_of[w["Id"]] = sid
        sets.add(tuple(row))
    if len(sets) != 1:
        raise SystemExit(f"★上げの中身が武器で割れている: {len(sets)} 通り")
    # **固有4 で増えるぶん。**`StatType[3]` / `StatValue[3]` に入っている
    # （2026-08-31 に気づいた。止まっている `Excel/` 側は `None` のまま）
    w4 = {w["Id"]: ((w["StatType"][3] or "").replace("_Base", ""), w["StatValue"][3])
          for w in weapons}
    raw = list(sets.pop())
    star = []
    for i, v in enumerate(raw[:jp_star - 1]):        # ★1→2 … ★(jp_star-1)→jp_star
        if not v:
            raise SystemExit(f"★{i+1}→{i+2} のレシピが引けない")
        cr, el = v
        src = "data"
        if el == 1:
            # **仮置きの行。**★3→★4 だけ外の出典で補う
            if i != 2 or cr != 2000000:
                raise SystemExit(f"仮置きの段が ★{i+1}→{i+2}（クレジット {cr}）。想定と違う")
            el, src = WP_STAR4_STONE, WP_STAR4_SRC
        star.append({"to": i + 2, "cr": cr, "el": el, "src": src})
    if len(star) != 3:
        raise SystemExit(f"★の段が {len(star)} 段。JP は ★{jp_star} まで")

    # 武器パーツ。**equipment の側にいる**
    PART_ORDER = ["A", "B", "C", "Z"]
    cat_ja = loc.get("ItemCategory", {})
    parts = []
    for e in equip:
        c = e.get("Category") or ""
        if not c.startswith("WeaponExpGrowth"):
            continue
        k = c[len("WeaponExpGrowth"):]
        if k not in PART_ORDER:
            raise SystemExit(f"知らない武器パーツの系統: {c}")
        if not e.get("LevelUpFeedExp"):
            raise SystemExit(f"{e.get('Name')} に LevelUpFeedExp が無い")
        parts.append({"k": k, "id": e["Id"], "n": e.get("Name", ""),
                      "i": e.get("Icon", ""), "e": e["LevelUpFeedExp"],
                      "r": e.get("Rarity", ""),
                      "sh": [{"c": s.get("ShopCategory", ""), "a": s.get("Amount", 0),
                              "ct": s.get("CostType", ""), "ci": s.get("CostId", 0),
                              "ca": s.get("CostAmount", 0)} for s in (e.get("Shops") or [])]})
    if len(parts) != 16:
        raise SystemExit(f"武器パーツが {len(parts)} 種（4 系統 × 4 段 = 16 のはず）")
    feeds = {}
    for p in parts:
        feeds.setdefault(p["k"], []).append(p["e"])
    for k, v in feeds.items():
        if sorted(v) != [10, 50, 200, 1000]:
            raise SystemExit(f"{k} の経験値が {sorted(v)}（10/50/200/1000 のはず）")
    parts.sort(key=lambda p: (PART_ORDER.index(p["k"]), p["e"]))

    # 系統ごとの 1.5 倍。**値は 10000 か 15000 の 2 つだけ**
    bonus, seen = {}, set()
    for r in bonus_tbl:
        wt = r["WeaponType"]
        row = {}
        for k in PART_ORDER:
            v = r["WeaponExpGrowth" + k]
            seen.add(v)
            row[k] = v
        bonus[wt] = row
    if seen - {10000, 15000}:
        raise SystemExit(f"経験値の倍率に 10000 / 15000 以外がある: {sorted(seen)}")

    # 生徒。**固有武器を持っている子だけ**
    wp_by_id = {w["Id"]: w for w in weapons}
    ad_ja = {"Street": "市街地", "Outdoor": "屋外", "Indoor": "屋内"}
    school = loc.get("School", {})
    stu = []
    for s_ in students:
        w = s_.get("Weapon") or {}
        if not s_.get("Name") or not w.get("Name"):
            continue
        wt = s_.get("WeaponType", "")
        if wt not in bonus:
            raise SystemExit(f"{s_['Name']} の武器種 {wt} が倍率の表に無い")
        raw_w = wp_by_id.get(s_["Id"]) or {}
        # ★3 で開く地形適性。**28 本だけ ＋2**
        av = 0
        ad = w.get("AdaptationType", "")
        for t_, v_ in zip(raw_w.get("StatType") or [], raw_w.get("StatValue") or []):
            if t_ and t_ != "None":
                av = v_
        stu.append({"id": s_["Id"], "n": NAMES.get(s_["Id"], s_["Name"]), "wt": wt,
                    "wn": w.get("Name", ""), "wi": s_.get("WeaponImg", ""),
                    "st": s_.get("StarGrade", 1),
                    # **神名文字の持ち主。**ふつうは自分だが 1 人だけ例外がいる
                    "es": stone_of.get(s_["Id"], s_["Id"]),
                    # **その神名文字の絵。**共通の `item_icon_secretstone` は
                    # 「神名のカケラ」の絵なので使わない（2026-08-30 の先生の指摘）
                    "si": stone_icon.get(stone_of.get(s_["Id"], s_["Id"]), ""),
                    "sc": school.get(s_.get("School", ""), s_.get("School", "")),
                    "ad": ad_ja.get(ad, ad),
                    "av": w.get("AdaptationValue", av),
                    "f4": w4.get(s_["Id"], ("", 0))[0],
                    "f4v": w4.get(s_["Id"], ("", 0))[1]})
    if len(stu) < 200:
        raise SystemExit(f"固有武器を持つ生徒が {len(stu)} 人しか取れない")

    coef = next((r["WeaponLvUpCoefficient"] for r in const if r.get("WeaponLvUpCoefficient")), None)
    if not coef:
        raise SystemExit("WeaponLvUpCoefficient が取れない")

    print(f"  生徒 {len(stu)} 人、武器種 {len(bonus)} 種、パーツ {len(parts)} 種、"
          f"★は JP で {jp_star} まで（Lv{jp_lv}）、Lv1→50 は {cum[50]:,} 経験値")

    n = 0
    for p in parts:
        n += fetch_icon(p["i"], f"https://schaledb.com/images/equipment/icon/{p['i']}.webp")
    for r in stu:
        if r.get("si"):
            n += fetch_icon(r["si"], f"https://schaledb.com/images/item/icon/{r['si']}.webp")
    fetch_icon("currency_icon_gold", "https://schaledb.com/images/item/icon/currency_icon_gold.webp")
    for s_ in stu:
        n += fetch_portrait(f"student_{s_['id']}",
                            f"https://schaledb.com/images/student/collection/{s_['id']}.webp")
    for wi in sorted({s_["wi"] for s_ in stu if s_["wi"]}):
        n += fetch_wide(wi, f"https://schaledb.com/images/weapon/{wi}.webp")
    print(f"  絵 {n} 枚を追加")

    return write_js("tools/weapon/data.js", "WEAP", {
        "cum": cum, "maxLv": max_lv, "jpLv": jp_lv, "jpStar": jp_star,
        "star": star, "parts": parts, "partOrder": PART_ORDER,
        "partJa": {k: cat_ja.get("WeaponExpGrowth" + k, k) for k in PART_ORDER},
        "partTx": loc.get("WeaponPartExpBonus", {}),
        "bonus": bonus, "coef": coef,
        "stu": sorted(stu, key=lambda x: x["id"]),
        # **差し替えが起きた段があるときだけ印を出す。**データに実数が入れば空になる
        "star4Src": WP_STAR4_SRC if any(x["src"] != "data" for x in star) else "",
        "version": "electricgoat/ba-data jp（CharacterWeaponLevel・CharacterWeaponExpBonus・"
                   "CharacterWeapon・Recipe・RecipeIngredient・ConstCommon）／ "
                   "SchaleDB jp（武器パーツ・生徒・絵）／ SchaleDB config.json（JP の★上限）"
                   "／ game8（★3→★4 の神名文字 200 個。いまはデータ側にも入っている）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ スケジュール

def build_schedule():
    """**ランクの段は「そのランク以上」で引く。**`AcademyRewardExcelTable` の
    `LocationRank` は 1 / 4 / 7 / 10 / 11 / 12 の 6 段しかなく、ランク 5 なら
    4 の行、ランク 9 なら 7 の行が効く（86 群 × 6 段 = 516 行ちょうど）。

    **`Location` 列は韓国語のまま**（`"샬레 업무관"`）。日本語名は
    `DB/LocalizeEtcExcelTable` の `NameJp` を `LocalizeEtcId` で引く。
    `Excel/` 側には `NameJp` が無い。

    **追加報酬の同じ道具が 2 行に分かれることがある。**ランク 11 の学校ゾーンは
    `[3030, 4030, 4030]` のように 3 本目が 2 本目の続き（2 本目が 100% で
    頭打ちになったぶんの上乗せ）。期待値は道具ごとに足し合わせる。
    """
    print("スケジュールの期待値")
    rw = as_list(get_json(BADB.format("AcademyRewardExcelTable")))
    zn = as_list(get_json(BADB.format("AcademyZoneExcelTable")))
    lc = as_list(get_json(BADB.format("AcademyLocationExcelTable")))
    lr = as_list(get_json(BADB.format("AcademyLocationRankExcelTable")))
    tk = as_list(get_json(BADB.format("AcademyTicketExcelTable")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))
    etc = {x["Key"]: x for x in as_list(get_json(BADB.format("LocalizeEtcExcelTable")))}
    items = {x["Id"]: x for x in as_list(get_json(BADB.format("ItemExcelTable")))}

    TIERS = [1, 4, 7, 10, 11, 12]
    # **行数を決め打ちしない。**場所は増える——`Excel/` には 11 か所しか無かったが、
    # `DB/` にはワイルドハント学園（Id 20）が入っていて 12 か所ある（2026-08-31）。
    # 「場所ごとに段の数で割り切れる行がある」ことだけを確かめる
    per = collections.Counter(x["Location"] for x in rw)
    if len(per) < 11:
        raise SystemExit(f"AcademyReward の場所が {len(per)} か所しかない")
    bad = {k: v for k, v in per.items() if v % len(TIERS)}
    if bad:
        raise SystemExit(f"場所ごとの行数が段の数で割り切れない: {bad}")
    if sorted({x["LocationRank"] for x in rw}) != TIERS:
        raise SystemExit(f"LocationRank の段が {sorted({x['LocationRank'] for x in rw})}")
    if {tuple(x["RewardParcelType"]) for x in rw} != {("LocationExp",)}:
        raise SystemExit("RewardParcelType が LocationExp だけではない")
    amts = {tuple(x["RewardAmount"]) for x in rw}
    if amts != {(100,)}:
        raise SystemExit(f"RewardAmount が {amts}（(100,) のはず）。1 回 100 の前提が崩れた")
    RUN_EXP = 100
    if {x["SecretStoneAmount"] for x in rw} != {1}:
        raise SystemExit("SecretStoneAmount が 1 で揃っていない")
    for x in rw:
        for p in [x["SecretStoneProb"], x["ExtraFavorExpProb"]] + list(x["ExtraRewardProb"]):
            if not (0 < p <= 10000):
                raise SystemExit(f"確率が 10000 分率に収まらない: {p}（群 {x['ScheduleGroupId']}）")

    # 群 → 段
    grp = {}
    for x in rw:
        grp.setdefault(x["ScheduleGroupId"], {})[x["LocationRank"]] = x
    # **種類の数を決め打ちしない。**場所が増えれば群も増える
    # （`Excel/` の 86 種に対し `DB/` は 94 種。2026-08-31）。
    # 下で「ゾーンと報酬群が 1 対 1」を数えているので、そちらで足りる
    if len(grp) < 86:
        raise SystemExit(f"ScheduleGroupId が {len(grp)} 種しかない")
    for gid, tiers in grp.items():
        if sorted(tiers) != TIERS:
            raise SystemExit(f"群 {gid} の段が {sorted(tiers)}")

    # **段ごとの絆経験値と神名文字は 86 群すべてで同じ。**違う群があれば止める
    base = {}
    for t in TIERS:
        vals = {(g[t]["FavorExp"], g[t]["ExtraFavorExp"], g[t]["ExtraFavorExpProb"],
                 g[t]["SecretStoneProb"]) for g in grp.values()}
        if len(vals) != 1:
            raise SystemExit(f"段 {t} の絆・神名文字が群ごとに違う: {sorted(vals)}")
        f, ef, ep, sp = vals.pop()
        base[t] = {"r": t, "favor": f, "exFavor": ef, "exProb": ep, "ssProb": sp}

    # ゾーン。**RewardGroupId が 0 のものは執務室**（スケジュールを送れない）
    fz = next((c.get("AcademyFavorZoneId") for c in const if c.get("AcademyFavorZoneId")), None)
    zmap = {}
    for z in zn:
        if not z["RewardGroupId"]:
            if z["Id"] != fz:
                raise SystemExit(f"報酬群を持たないゾーンが {z['Id']}"
                                 f"（AcademyFavorZoneId {fz} のはず）")
            continue
        zmap[z["RewardGroupId"]] = z
    if set(zmap) != set(grp):
        raise SystemExit(f"ゾーンと報酬群が 1 対 1 でない: {sorted(set(zmap) ^ set(grp))}")

    def name_of(key):
        v = etc.get(key)
        if not v or not v.get("NameJp"):
            raise SystemExit(f"LocalizeEtcId {key} の日本語名が引けない")
        return v["NameJp"].replace("\n", "").strip()

    # 追加報酬の道具
    used_items = {}
    for x in rw:
        for i in x["ExtraRewardParcelId"]:
            used_items[i] = None
    for i in list(used_items):
        v = items.get(i)
        if not v:
            raise SystemExit(f"追加報酬の道具 {i} が ItemExcelTable に無い")
        used_items[i] = {"nm": name_of(v["LocalizeEtcId"]),
                         "ic": v["Icon"].rsplit("/", 1)[-1].lower(),
                         "rr": v.get("Rarity", "N")}

    # **場所の学校マーク。**`AcademyLocationExcelTable` の `OpenCondition` に
    # 学校名が 1 つだけ入っている場所がある（11=Gehenna・12=Abydos・13=Millennium・
    # 14=Trinity・15=RedWinter・16=Hyakkiyako・18=Shanhaijing。2026-08-31 に確認）。
    # 開放条件の学校であって「その場所の学校」の欄ではないので、**場所の日本語名に
    # その学校の日本語名が入っていることを突き合わせてから**マークを付ける
    # （「ゲヘナ学園・中央区」に ゲヘナ、のように 7 か所すべて一致する）。
    # 片方でも崩れたらここで止まる——黙って違う学校の紋を出すよりよい
    school_ja = get_json(SD.format("localization")).get("School") or {}
    loc_school = {}
    for l_ in lc:
        cond = [c for c in (l_.get("OpenCondition") or []) if c and c != "None"]
        if len(cond) != 1 or cond[0] not in school_ja:
            continue
        sc = cond[0]
        nm = name_of(l_["LocalizeEtcId"])
        if school_ja[sc] not in nm:
            raise SystemExit(f"場所 {l_['Id']}「{nm}」の開放条件 {sc}"
                             f"（{school_ja[sc]}）が名前と合わない。紋は付けられない")
        loc_school[l_["Id"]] = sc

    locs = []
    for l_ in sorted(lc, key=lambda x: x["Id"]):
        zs = []
        for z in sorted([z for z in zn if z["LocationId"] == l_["Id"] and z["RewardGroupId"]],
                        key=lambda x: (x["LocationRankForUnlock"], x["Id"])):
            tiers = []
            for t in TIERS:
                x = grp[z["RewardGroupId"]][t]
                # **同じ道具が 2 行に分かれる。**足し合わせて 1 本にする
                merged, order = {}, []
                for i, a, p in zip(x["ExtraRewardParcelId"], x["ExtraRewardAmount"],
                                   x["ExtraRewardProb"]):
                    if i not in merged:
                        merged[i] = 0.0
                        order.append(i)
                    merged[i] += a * p / 10000.0
                tiers.append([[i, round(merged[i], 4)] for i in order])
            zs.append({"id": z["Id"], "nm": name_of(z["LocalizeEtcId"]),
                       "u": z["LocationRankForUnlock"], "rw": tiers})
        if not zs:
            raise SystemExit(f"ロケーション {l_['Id']} にゾーンが無い")
        rec = {"id": l_["Id"], "nm": name_of(l_["LocalizeEtcId"]), "z": zs}
        if l_["Id"] in loc_school:
            rec["sc"] = loc_school[l_["Id"]].lower()
        locs.append(rec)
    # **場所の数を決め打ちしない。**`Excel/` は 11 か所で止まっていたが、
    # `DB/` にはワイルドハント学園（Id 20、ゾーン 8・報酬 48 行）が入っていて
    # 12 か所ある。日本には所属の生徒が 6 人いる（2026-08-31 に実測）。
    # 画面の「N か所」も data.js から出しているので、増えれば勝手に追いつく
    if len(locs) < 11:
        raise SystemExit(f"ロケーションが {len(locs)} か所しかない")

    rank = [{"r": x["Rank"], "exp": x["RankExp"], "tot": x["TotalExp"]}
            for x in sorted(lr, key=lambda x: x["Rank"])]
    if [x["r"] for x in rank] != list(range(1, len(rank) + 1)):
        raise SystemExit("ランクが 1 から連番でない")
    if rank[-1]["exp"] != 0:
        raise SystemExit(f"最終ランク {rank[-1]['r']} の RankExp が {rank[-1]['exp']}（0 のはず）")
    for i in range(len(rank)):
        if rank[i]["tot"] != sum(x["exp"] for x in rank[:i + 1]):
            raise SystemExit(f"TotalExp が RankExp の累計と合わない（ランク {rank[i]['r']}）")

    tic = sorted([[x["LocationRankSum"], x["ScheduleTicktetMax"]] for x in tk])
    if not tic or tic[0][0] != 1:
        raise SystemExit(f"チケットの段が {tic}")

    print(f"  {len(locs)} か所・{sum(len(x['z']) for x in locs)} エリア、"
          f"段 {TIERS}、最大ランク {rank[-1]['r']}（累計 {rank[-1]['tot']:,} 経験値 ＝ "
          f"{rank[-1]['tot'] // RUN_EXP} 回）")

    n = 0
    for v in used_items.values():
        n += fetch_icon(v["ic"], f"https://schaledb.com/images/item/icon/{v['ic']}.webp")
    n += fetch_icon("item_icon_secretstone",
                    "https://schaledb.com/images/item/icon/item_icon_secretstone.webp")
    n += fetch_icon("item_icon_favor_0",
                    "https://schaledb.com/images/item/icon/item_icon_favor_0.webp")
    # 学校の紋。**168×152 の色付き PNG**なので、切り抜かない `fetch_raw` で置く
    for sc in sorted(set(loc_school.values())):
        n += fetch_raw(f"schoolicon_{sc.lower()}",
                       f"https://schaledb.com/images/schoolicon/{sc}.png")
    if n:
        print(f"  アイコンを {n} 枚追加")

    return write_js("tools/schedule/data.js", "SCH", {
        "tiers": TIERS,
        "base": [base[t] for t in TIERS],
        "rank": rank,
        "ticket": tic,
        "runExp": RUN_EXP,
        "loc": locs,
        "item": {str(k): v for k, v in used_items.items()},
        "version": "electricgoat/ba-data jp（AcademyReward・AcademyZone・AcademyLocation・"
                   "AcademyLocationRank・AcademyTicket・ConstCommon／DB の LocalizeEtc・Item）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ カフェ

def build_cafe():
    """**時給は 10000 で割る。**`(ParcelProductionCoefficient × 快適度
    + ParcelProductionCorrectionValue) / 10000` が 1 時間ぶん。割り忘れると
    ランク 1 で 1875 万クレジット/時になる。

    **裏取り**: 快適度を各ランクの `ComfortMax` に置いたとき、クレジット 20 行
    すべてで `ParcelStorageMax ÷ 時給` が 24.000（23.998〜24.000）。
    `CafeAutoChargePeriodInMsc = 3600000`（1 時間）とも合う。
    AP の 10 行は倉庫上限が丸められていて 23.45〜24.02 に散るので、
    こちらには「倉庫 = 24 時間ぶん」と書かない。
    """
    print("カフェの収入計算機")
    prod = as_list(get_json(BADB.format("CafeProductionExcelTable")))
    crank = as_list(get_json(BADB.format("CafeRankExcelTable")))
    info = as_list(get_json(BADB.format("CafeInfoExcelTable")))
    rec = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeExcelTable")))}
    ing = {r["Id"]: r for r in as_list(get_json(BADB.format("RecipeIngredientExcelTable")))}
    fgrp = as_list(get_json(BADB.format("FurnitureGroupExcelTable")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))
    etc = {x["Key"]: x for x in as_list(get_json(BADB.format("LocalizeEtcExcelTable")))}
    items = {x["Id"]: x for x in as_list(get_json(BADB.format("ItemExcelTable")))}
    furn = as_list(get_json(SD.format("furniture")))
    loc = get_json(SD.format("localization"))

    if len(prod) != 30:
        raise SystemExit(f"CafeProduction が {len(prod)} 行（30 のはず）")
    if len(crank) != 20:
        raise SystemExit(f"CafeRank が {len(crank)} 行（20 のはず）")
    cm = {(x["CafeId"], x["Rank"]): x for x in crank}
    for cid in (1, 2):
        got = [cm[(cid, r)]["ComfortMax"] for r in range(1, 11)]
        if got != [1000 + 500 * i for i in range(10)]:
            raise SystemExit(f"カフェ {cid} の ComfortMax が {got}")

    # **これが決め手。**クレジット行 20 本で「倉庫 = 24 時間ぶん」を確かめる
    checked = 0
    for p in prod:
        c = cm[(p["CafeId"], p["Rank"])]["ComfortMax"]
        hour = (p["ParcelProductionCoefficient"] * c
                + p["ParcelProductionCorrectionValue"]) / 10000.0
        if hour <= 0:
            raise SystemExit(f"時給が 0 以下: {p}")
        if p["CafeProductionParcelId"] == 1:      # クレジット
            h = p["ParcelStorageMax"] / hour
            if abs(h - 24) > 0.01:
                raise SystemExit(
                    f"カフェ {p['CafeId']} ランク {p['Rank']} の倉庫が {h:.3f} 時間ぶん"
                    "（24 のはず）。10000 の割り方が変わった合図")
            checked += 1
    if checked != 20:
        raise SystemExit(f"クレジット行が {checked} 本（20 のはず）")

    par = {}
    for p in prod:
        par.setdefault(p["CafeId"], {}).setdefault(p["CafeProductionParcelId"], {})[p["Rank"]] = {
            "co": p["ParcelProductionCoefficient"],
            "cv": p["ParcelProductionCorrectionValue"],
            "st": p["ParcelStorageMax"],
        }
    if set(par[1]) != {1, 5} or set(par[2]) != {1}:
        raise SystemExit(f"生産する物が {sorted(par[1])} / {sorted(par[2])}"
                         "（1 号店 = クレジット + AP、2 号店 = クレジットのはず）")

    def name_of(key):
        v = etc.get(key)
        if not v or not v.get("NameJp"):
            raise SystemExit(f"LocalizeEtcId {key} の日本語名が引けない")
        return v["NameJp"].replace("\n", "").strip()

    # ランクアップ。**`CafeRank` の行 N に付く `RecipeId` は「N から N+1 へ」。**
    # ランク 10 の行にもレシピが付いているが、上限が 10 なので使い道が無い
    # （潜在能力の 25 段目と同じ形）
    up = {}
    for cid in (1, 2):
        rows = []
        for r in range(1, 10):
            R = rec.get(cm[(cid, r)]["RecipeId"])
            I_ = ing.get(R["RecipeIngredientId"]) if R else None
            if not I_:
                raise SystemExit(f"カフェ {cid} ランク {r} のレシピが引けない")
            if R["RecipeType"] != "CafeRankUp":
                raise SystemExit(f"レシピ {R['Id']} が CafeRankUp でない: {R['RecipeType']}")
            if I_["CostParcelType"] != ["Currency"] or I_["CostId"] != [1]:
                raise SystemExit(f"ランクアップの費用が クレジット でない: {I_['CostParcelType']}")
            mats = [{"nm": name_of(items[i]["LocalizeEtcId"]),
                     "ic": items[i]["Icon"].rsplit("/", 1)[-1].lower(), "n": a}
                    for i, a in zip(I_["IngredientId"], I_["IngredientAmount"])]
            rows.append({"to": r + 1, "cr": I_["CostAmount"][0], "mat": mats})
        up[cid] = rows
    if [x["cr"] for x in up[1]] != [x["cr"] for x in up[2]]:
        raise SystemExit("ランクアップのクレジットが 1 号店と 2 号店で違う")

    # セットボーナス。**20 セットすべて同じ段でなければ、セットごとに持つ形へ直す**
    steps = {(tuple(g["RequiredFurnitureCount"]), tuple(g["ComfortBonus"])) for g in fgrp}
    if len(steps) != 1:
        raise SystemExit(f"セットボーナスの段がセットごとに違う: {sorted(steps)}")
    need, bonus = steps.pop()
    known = {g["Id"] for g in fgrp}

    # 家具。**ba-data の FurnitureGroup は 20 セットしか無い**が、SchaleDB は
    # 25 セット（100〜124）持っている。名前は SchaleDB から引き、ボーナスの段が
    # ba-data で裏取りできているかは `ok` で持って画面で分ける
    setname = loc.get("FurnitureSet", {})
    fl, bysets = [], {}
    for f in furn:
        cb = f.get("ComfortBonus") or 0
        if cb <= 0:
            raise SystemExit(f"快適度 0 の家具がある: {f['Id']} {f.get('Name')}")
        sg = f.get("SetGroupId") or 0
        sz = f.get("Size") or [1, 1]
        fl.append({"id": f["Id"], "nm": (f.get("Name") or "?").replace("\n", ""), "c": cb,
                   "w": sz[0], "h": sz[1], "sc": f.get("SubCategory") or "",
                   "ca": f.get("Category") or "", "rr": f.get("Rarity") or "N", "g": sg})
        if sg:
            bysets[sg] = bysets.get(sg, 0) + 1
    sets = [{"id": g, "nm": setname.get(str(g), f"セット{g}"), "n": bysets[g],
             "ok": g in known} for g in sorted(bysets)]
    fl.sort(key=lambda x: (-x["c"], x["nm"]))

    cc = next(iter(const))
    apply_n = cc.get("CafeSetGroupApplyCount")
    period = cc.get("CafeAutoChargePeriodInMsc")
    if apply_n is None or period != 3600000:
        raise SystemExit(f"CafeSetGroupApplyCount={apply_n} / "
                         f"CafeAutoChargePeriodInMsc={period}")

    print(f"  カフェ {len(info)} 店・ランク {len(crank) // len(info)} 段、家具 {len(fl)} 個、"
          f"セット {len(sets)} 個（うち ba-data で段が確かめられたのは {sum(1 for s in sets if s['ok'])} 個）、"
          f"倉庫 = 24 時間ぶんをクレジット {checked} 行で確認")

    n = 0
    for nm in ("currency_icon_gold", "currency_icon_ap", "ui_cafe_icon_comfort"):
        n += fetch_icon(nm, f"https://schaledb.com/images/item/icon/{nm}.webp")
    for cid in (1, 2):
        for row in up[cid]:
            for m in row["mat"]:
                n += fetch_icon(m["ic"], f"https://schaledb.com/images/item/icon/{m['ic']}.webp")
    if n:
        print(f"  アイコンを {n} 枚追加")

    return write_js("tools/cafe/data.js", "CAFE", {
        "cafe": [{"id": x["CafeId"], "def": bool(x["IsDefault"])}
                 for x in sorted(info, key=lambda x: x["CafeId"])],
        "rank": [{"c": x["CafeId"], "r": x["Rank"], "cm": x["ComfortMax"],
                  "tag": x["TagCountMax"], "vmin": x["CharacterVisitMin"],
                  "vmax": x["CharacterVisitMax"]}
                 for x in sorted(crank, key=lambda x: (x["CafeId"], x["Rank"]))],
        "prod": {str(c): {str(p): [par[c][p][r] for r in range(1, 11)] for p in par[c]}
                 for c in par},
        "up": {str(c): up[c] for c in up},
        "setStep": list(need), "setBonus": list(bonus), "setMax": apply_n,
        "sets": sets, "furn": fl, "period": period,
        "version": "electricgoat/ba-data jp（CafeProduction・CafeRank・CafeInfo・Recipe・"
                   "RecipeIngredient・FurnitureGroup・ConstCommon／DB の LocalizeEtc・Item）"
                   "／ SchaleDB jp（家具 1091 個・セット名）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 素材の掘り場

# **中身が空（Chance が全部 0）の箱。**SchaleDB 本体も名指しで外している
# （`assets/ItemView-*.js` の `g=[5e5,500001,500100]`）。500100 は任務 250 本
# すべてに 1 個ずつ付いていて、`groups.min.json` でも全項目 `"Chance": 0` かつ
# `"Recursive": true`。数えると全ステージが同じだけ水増しされる（2026-08-30）
BOX_EMPTY = {500000, 500001, 500100}

# 素材の分け方。**キーは `SD/items` の `(Category, SubCategory)`。**
MAT_GROUP = {
    ("Material", "Artifact"): "オーパーツ",
    ("Material", "BookItem"): "技術ノート",
    ("Material", "CDItem"): "戦術教育BD",
    ("CharacterExpGrowth", None): "レポート",
    ("SecretStone", None): "神名文字",
    ("Coin", None): "コイン",
}
MAT_ORDER = ["オーパーツ", "技術ノート", "戦術教育BD", "レポート",
             "武器パーツ", "神名文字", "コイン"]


def build_farm():
    print("素材の掘り場")
    # **箱の中身は SchaleDB の `groups.min.json` から取る。**
    # ba-data の `GachaElementExcelTable`（2025-05-07）は **学校ごと 1 種類ずつ
    # 足りない**。たとえば箱 10314 は ba-data では百鬼夜行・トリニティ・アリウスの
    # 3 種で各 1/3 だが、実際はオデュッセイアが入って 4 種で各 0.25。
    # ワイルドハント（箱 10318 ほか）も同じ。**素材の期待値が 1.33 倍に膨らむ。**
    # 100 箱を突き合わせて、中身が同じ 83 箱では確率が 0.002 以内で一致し、
    # 残り 16 箱は SchaleDB 側にだけ新しい学校が入っていた（2026-08-30 に実測）
    stages = as_list(get_json(SD.format("stages")))
    items = {x["Id"]: x for x in as_list(get_json(SD.format("items")))}
    equips = {x["Id"]: x for x in as_list(get_json(SD.format("equipment")))}
    groups = {int(k): v for k, v in get_json(SD_GROUPS).items()}
    loc = get_json(SD.format("localization"))
    st_type, st_title = loc.get("StageType") or {}, loc.get("StageTitle") or {}

    def clean(s):
        # **`SD/items` の名前には改行が入っている。**「初級戦術教育BD\n（百鬼夜行）」
        return re.sub(r"\s+", "", str(s or ""))

    def material(kind, pid):
        """素材なら (キー, 表示名, アイコン, 群, 段) を返す。そうでなければ None。"""
        if kind == "Item":
            it = items.get(pid)
            if not it:
                return None
            g = MAT_GROUP.get((it.get("Category"), it.get("SubCategory")))
            if not g:
                return None
            return (f"I{pid}", clean(it.get("Name")), it.get("Icon"), g,
                    it.get("Quality") or 0)
        if kind == "Equipment":
            e = equips.get(pid)
            if e and str(e.get("Category") or "").startswith("WeaponExpGrowth"):
                return (f"E{pid}", clean(e.get("Name")), e.get("Icon"), "武器パーツ",
                        int(str(e.get("Icon"))[-1]) + 1)
        return None

    # ---- ステージ 1 本ぶんの期待個数
    mats, drops, cur_ids = {}, {}, set()
    st_out, unknown_box = [], set()
    for s in stages:
        acc = {}
        for r in s.get("Rewards") or []:
            # **FirstClear / ThreeStar は周回では出ない。**繰り返し出るぶんだけ数える
            if r.get("RewardType"):
                continue
            kind, pid = r.get("Type"), r.get("Id")
            # **`Amount` と `AmountMin/Max` は掛け算。**SchaleDB 本体も
            # `(_.Amount??1)*(_.AmountMin??1)` と掛けている
            n = r.get("Amount") or 1
            if r.get("AmountMin") is not None and r.get("AmountMax") is not None:
                n = n * (r["AmountMin"] + r["AmountMax"]) / 2.0
            ev = n * (r["Chance"] if r.get("Chance") is not None else 1.0)
            if kind == "GachaGroup":
                if pid in BOX_EMPTY:
                    continue
                g = groups.get(pid)
                if not g:
                    unknown_box.add(pid)
                    continue
                for it in g.get("Items") or []:
                    m = material(it.get("Type"), it.get("Id"))
                    if not m:
                        continue
                    amt = ((it.get("AmountMin") or 1) + (it.get("AmountMax") or 1)) / 2.0
                    acc[m[0]] = acc.get(m[0], 0) + ev * (it.get("Chance") or 0) * amt
                    mats[m[0]] = m
            else:
                m = material(kind, pid)
                if m:
                    acc[m[0]] = acc.get(m[0], 0) + ev
                    mats[m[0]] = m
        if not acc:
            continue

        # **入場料は通貨ごとに分ける。**AP（5）・指名手配券（22）・交流会券（23）を
        # 一列に並べると桁が変わる。学園交流会は券と AP の 2 本立て
        ap, tk, tn = 0, 0, 0
        for cost in s.get("EntryCost") or []:
            if len(cost) != 2:
                continue
            cid, amt = cost
            cur_ids.add(cid)
            if cid == 5:
                ap += amt
            else:
                tk, tn = cid, tn + amt
        cat, ty = s.get("Category"), s.get("Type") or ""
        name = s.get("Name") or ""
        if not name:
            tpl = st_title.get(ty)
            if not tpl:
                raise SystemExit(f"ステージ {s['Id']}（{cat}/{ty}）の名前が作れない。"
                                 "localization の StageTitle にひな型が無い")
            name = tpl.replace("{0}", str(s.get("Stage") or ""))
        idx = len(st_out)
        st_out.append({"i": s["Id"], "c": cat, "t": ty,
                       "tj": st_type.get(ty) or st_type.get(cat) or cat,
                       "n": name, "a": s.get("Area") or 0, "s": s.get("Stage") or 0,
                       "h": 1 if (s.get("Difficulty") or 0) else 0,
                       "ap": ap, "tk": tk, "tn": tn})
        for k, v in acc.items():
            drops.setdefault(k, []).append([idx, round(v, 5)])

    # ---- 番人
    if unknown_box:
        raise SystemExit(f"中身の分からない箱がステージに出た: {sorted(unknown_box)}。"
                         "SchaleDB の groups.min.json が追いついていない")
    if cur_ids != {5, 22, 23}:
        raise SystemExit(f"入場料の通貨が 5 / 22 / 23 以外に出た: {sorted(cur_ids)}。"
                         "単位を取り違える前に止める")
    item_st = {p[0] for k, v in drops.items() if k[0] == "I" for p in v}
    item_pairs = sum(len(v) for k, v in drops.items() if k[0] == "I")
    if len(item_st) < 190:
        raise SystemExit(f"アイテムを落とすステージが {len(item_st)} 本しかない（190 本以上のはず）")
    if item_pairs < 1400:
        raise SystemExit(f"(素材, ステージ) の組が {item_pairs} 件しかない（1400 件以上のはず）")
    n_camp = sum(1 for x in st_out if x["c"] == "Campaign")
    if any(not x["n"] for x in st_out):
        raise SystemExit("名前の付かないステージが残った")
    if not n_camp:
        raise SystemExit("任務のステージが 1 本も残らなかった")
    for k, v in drops.items():
        if not v:
            raise SystemExit(f"{k} がどのステージからも出ない")
    got = {m[3] for m in mats.values()}
    if not got <= set(MAT_ORDER):
        raise SystemExit(f"知らない素材の群が出た: {sorted(got - set(MAT_ORDER))}")

    # ---- アイコン
    n = 0
    for k, (_, _, icon, g, _q) in mats.items():
        base = ("https://schaledb.com/images/equipment/icon/" if k[0] == "E"
                else "https://schaledb.com/images/item/icon/")
        n += fetch_icon(icon, base + icon + ".webp")
    print(f"  アイコン {n} 枚を追加、素材 {len(mats)} 種／ステージ {len(st_out)} 本／"
          f"組 {sum(len(v) for v in drops.values())} 件")

    # **初期表示の素材は「いちばん多くのステージから出るもの」。**
    # 手で決めると、その素材が消えたときに空の画面になる
    default = max(sorted(drops), key=lambda k: (len(drops[k]), k))

    ml = [{"k": k, "n": m[1], "i": m[2], "g": m[3], "q": m[4]}
          for k, m in sorted(mats.items(), key=lambda kv: (MAT_ORDER.index(kv[1][3]), kv[0]))]
    return write_js("tools/farm/data.js", "FARM", {
        "groups": [g for g in MAT_ORDER if g in got],
        "mats": ml, "stages": st_out, "drops": drops, "def": default,
        "itemStages": len(item_st), "itemPairs": item_pairs,
        "version": "SchaleDB jp（ステージ・報酬・入場料・箱の中身・素材の名前とアイコン）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 装備の強化珠

def build_equip_level():
    print("装備の強化珠計算機")
    # **`TotalExp` は「その行のレベルから次へ上がるところまで」の累計。**
    # 行 `Level: 9` の 381 が Lv1 → Lv10 ぶんで、`SD/equipment` の T1 の
    # `MaxLevel = 10` と一致する。到達レベルで引くと 1 段ずれる
    lv = sorted(as_list(get_json(BADB.format("EquipmentLevelExcelTable"))),
                key=lambda r: r["Level"])
    sd_eq = as_list(get_json(SD.format("equipment")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))

    if [r["Level"] for r in lv] != list(range(1, 71)):
        raise SystemExit(f"装備レベルの表が Lv1〜70 でそろわない: {len(lv)} 行")
    for r in lv:
        if len(r["TotalExp"]) != 10 or len(r["TierLevelExp"]) != 10:
            raise SystemExit(f"Lv{r['Level']} の TotalExp / TierLevelExp が 10 要素でない")

    # 部位ごとの Tier 上限。**設計図（StatType が空）を混ぜない。**混ぜると 1 が出る
    per_cat = {}
    for e in sd_eq:
        cat, tier = e.get("Category"), e.get("Tier")
        if cat not in CAT_JA or not tier or not e.get("StatType"):
            continue
        per_cat.setdefault(cat, {})[tier] = e.get("MaxLevel")
    if sorted(per_cat) != sorted(CATS):
        raise SystemExit(f"部位が 9 つそろわない: {sorted(per_cat)}")
    tiers = sorted(per_cat[CATS[0]])
    if tiers != list(range(1, 11)):
        raise SystemExit(f"Tier が 1〜10 でそろわない: {tiers}")
    max_lv = [per_cat[CATS[0]][t] for t in tiers]
    for cat in CATS:
        if [per_cat[cat][t] for t in tiers] != max_lv:
            raise SystemExit(f"{cat} のレベル上限が他の部位と違う: {per_cat[cat]}。"
                             "部位ごとに持つ形へ直すこと")
    if max_lv != [10, 20, 30, 40, 45, 50, 55, 60, 65, 70]:
        raise SystemExit(f"レベル上限の並びが変わった: {max_lv}")

    # `cum[T][L]` = その Tier で Lv1 から Lv L まで上げるのに要る累計経験値
    cum = {}
    for ti, t in enumerate(tiers):
        c = [0] * 71
        for l in range(2, 71):
            c[l] = lv[l - 2]["TotalExp"][ti]
        if any(c[i] > c[i + 1] for i in range(1, 70)):
            raise SystemExit(f"T{t} の累計経験値が減る行がある")
        m = max_lv[ti]
        if len(set(c[m:71])) != 1:
            raise SystemExit(f"T{t} は Lv{m} で頭打ちのはずだが、その先でも増えている。"
                             "MaxLevel の読み方が間違っている")
        if c[m] <= 0:
            raise SystemExit(f"T{t} の必要経験値が 0")
        cum[t] = c[:max_lv[ti] + 1]

    # 強化珠 4 種と、その日替わりセット
    gems = sorted([e for e in sd_eq if e.get("Category") == "Exp"], key=lambda e: e["Id"])
    if [g["LevelUpFeedExp"] for g in gems] != [90, 360, 1440, 5760]:
        raise SystemExit(f"強化珠が (90, 360, 1440, 5760) にならない: "
                         f"{[(g['Id'], g.get('LevelUpFeedExp')) for g in gems]}")
    # **セットは値段でまとまる。**「強化珠バンドルα」のように 2 種類が
    # 1 つの値段に入っているものがあり、`Shops` はそれを種類ごとの行に割っている。
    # 同じ `CostAmount` の行を集め直すと、ゲーム内の 12 個の品物に戻る
    bundles = {}
    for g in gems:
        for sh in g.get("Shops") or []:
            if sh.get("CostType") != "Currency" or sh.get("CostId") != 1:
                raise SystemExit(f"クレジット払いでない強化珠のセットがある: {sh}")
            bundles.setdefault(sh["CostAmount"], []).append([g["Id"], sh["Amount"]])
    if not bundles:
        raise SystemExit("強化珠のショップが 1 件も取れない")
    exp_of = {g["Id"]: g["LevelUpFeedExp"] for g in gems}
    bl = [{"c": c, "it": sorted(v), "e": sum(exp_of[i] * a for i, a in v)}
          for c, v in sorted(bundles.items())]
    day_credit = sum(b["c"] for b in bl)
    day_exp = sum(b["e"] for b in bl)
    # **参考元と突き合わせる。**ブルアカ Wiki「経験値表/装備」の
    # 「通常アイテムショップで1日に購入可能な強化珠セット/バンドル」の合計が
    # 「初級×30 中級×45 上級×23 最上級×7／2,052,000／92,340」（2026-08-30 に確認）
    if len(bl) != 12 or day_credit != 2052000 or day_exp != 92340:
        raise SystemExit(f"ショップの品ぞろえが参考元と食い違う: {len(bl)} 個／"
                         f"{day_credit} クレジット／{day_exp} EXP。"
                         "参考元 https://bluearchive.wikiru.jp/?経験値表/装備 は "
                         "12 個／2,052,000／92,340")

    # 設計図を溶かしたときの経験値。**端数を埋めるのに使う。**
    pieces = []
    for e in sd_eq:
        icon = str(e.get("Icon") or "")
        if e.get("LevelUpFeedExp") is None or e.get("Category") == "Exp":
            continue
        if icon.endswith("_useall_piece"):
            pieces.append([0, e["LevelUpFeedExp"]])
        elif icon.endswith("_piece"):
            pieces.append([e.get("Tier"), e["LevelUpFeedExp"]])
    pieces = sorted({tuple(p) for p in pieces})
    if [p[0] for p in pieces] != [0] + list(range(2, 11)):
        raise SystemExit(f"設計図の経験値が 万能 + T2〜T10 でそろわない: {pieces}")

    coef = next((r["EquipmentLvUpCoefficient"] for r in const
                 if r.get("EquipmentLvUpCoefficient")), None)
    if coef != 4:
        raise SystemExit(f"EquipmentLvUpCoefficient が 4 でない: {coef}。"
                         "参考元（ブルアカ Wiki「経験値表/装備」）は「1EXPあたり4クレジット」")

    # **T1 から T10 まで通しの合計。**参考元の「総経験値は246680」と突き合わせる
    all_tiers = sum(cum[t][max_lv[i]] for i, t in enumerate(tiers))
    if all_tiers != 246680:
        raise SystemExit(f"T1→T10 の総経験値が参考元と食い違う: {all_tiers}（246680 のはず）")

    n = 0
    for g in gems:
        n += fetch_icon(g["Icon"], f"https://schaledb.com/images/equipment/icon/{g['Icon']}.webp")
    print(f"  アイコン {n} 枚を追加、T1→T10 通しで {all_tiers:,} EXP／"
          f"ショップ {len(bl)} 個で 1 日 {day_exp:,} EXP")

    return write_js("tools/equip-level/data.js", "EQLV", {
        "cats": CATS, "catJa": CAT_JA, "tiers": tiers, "maxLv": max_lv,
        "cum": {str(t): cum[t] for t in tiers},
        "gems": [{"id": g["Id"], "n": g["Name"], "i": g["Icon"], "e": g["LevelUpFeedExp"]}
                 for g in gems],
        "bundles": bl, "dayCredit": day_credit, "dayExp": day_exp,
        "pieces": [list(p) for p in pieces], "coef": coef, "allTiers": all_tiers,
        "version": "electricgoat/ba-data jp（レベルごとの経験値・クレジット係数）／ "
                   "SchaleDB jp（Tier ごとのレベル上限・強化珠・ショップ・設計図の経験値）",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ カフェの家具配置

# **床と壁の広さは、家具そのもののサイズから読める。**`SubCategory` が
# `Floor` の 26 個のうち 8 個が `Size: [20, 20]`、`Wallpaper` の 26 個のうち
# 2 個が `Size: [20, 7]`。どちらも部屋いっぱいに敷く 1 枚物なので、
# **その大きさが部屋の広さそのもの**になる（2026-08-30 に数えた）。
#
# 裏取りその 2。公式の家具テンプレート 20 個（`FurnitureTemplateElement`）を
# この枠に置き直すと、**2,817 マスが 1 マスもはみ出さず、重なりも 0**。
# 壁も 20 × 7 で 2,221 マスが同じく 0。
CL_FLOOR = [20, 20]
CL_WALL = [20, 7]

# 置く面。**公式テンプレート 20 個の `Location` 欄から決めた。**
# 下の検算で「この分け方から外れる行が 1 つでもあれば止まる」ようにしてある
CL_PLANE = {
    "Bed": "f", "Chair": "f", "Closet": "f", "FloorDecoration": "f",
    "HomeAppliance": "f", "Prop": "f", "Table": "f",
    "WallDecoration": "w",
    "Floor": "fm", "Wallpaper": "wp", "Background": "bg",
}
# **テンプレートに 1 度も出てこない 2 種類。**置ける面が確かめられないので、
# 盤には載せず、画面でも「確かめられていない」と書く
CL_UNKNOWN = {"Trophy", "FurnitureEtc"}
# 床の上では、カーペットの上に家具を置ける。**重なりの検査から外す唯一の種類**
CL_UNDER = "FloorDecoration"


def build_cafe_layout():
    """**このツールだけは「床の広さ」を持っている。**カフェの収入計算機
    （`build_cafe`）は「床の広さがデータのどこにも無い」と書いているが、
    それは `CafeInfo` / `CafeRank` を見た話で、実際には
    **家具の `Size` と公式テンプレートの座標**の 2 か所から読める。

    **座標は家具の中心。**`FurnitureTemplateElement.PositionX/Y` は
    左上ではなく中心で、幅が奇数なら .5 が付く。1,037 行のうち 1,034 行で
    「幅が奇数 ⇔ 座標に .5 が付く」が成り立った（外れる 3 行は下で名指し）。
    左上のマスは `round(Position − サイズ / 2)`。
    """
    print("カフェの家具配置")
    furn = get_json(SD.format("furniture"))
    loc = get_json(SD.format("localization"))
    fgrp = as_list(get_json(BADB.format("FurnitureGroupExcelTable")))
    crank = as_list(get_json(BADB.format("CafeRankExcelTable")))
    const = as_list(get_json(BA.format("ConstCommonExcelTable")))
    tpl = as_list(get_json(BADB.format("FurnitureTemplateExcelTable")))
    tel = as_list(get_json(BADB.format("FurnitureTemplateElementExcelTable")))
    etc = {x["Key"]: x for x in as_list(get_json(BADB.format("LocalizeEtcExcelTable")))}

    fl_all = list(furn.values()) if isinstance(furn, dict) else furn
    fmap = {f["Id"]: f for f in fl_all}

    # ---- 1. 部屋の広さ。**1 枚物の床材と壁紙のサイズから取る** ----
    whole_floor = sorted(f["Id"] for f in fl_all
                         if f.get("SubCategory") == "Floor" and list(f.get("Size") or []) == CL_FLOOR)
    whole_wall = sorted(f["Id"] for f in fl_all
                        if f.get("SubCategory") == "Wallpaper" and list(f.get("Size") or []) == CL_WALL)
    if not whole_floor:
        raise SystemExit(f"Size が {CL_FLOOR} の床材が 1 つも無い。床の広さの根拠が消えた")
    if not whole_wall:
        raise SystemExit(f"Size が {CL_WALL} の壁紙が 1 つも無い。壁の広さの根拠が消えた")
    for f in fl_all:
        sz = list(f.get("Size") or [1, 1])
        if max(sz) > max(CL_FLOOR):
            raise SystemExit(f"床より大きい家具がある: {f['Id']} {f.get('Name')} {sz}")

    # ---- 2. 置く面。**テンプレートの Location と突き合わせる** ----
    LOCP = {"Floor": "f", "WallLeft": "w", "WallRight": "w"}
    for e in tel:
        sc = fmap[e["FurnitureId"]]["SubCategory"]
        want = CL_PLANE.get(sc)
        if want is None:
            raise SystemExit(f"面を決めていない SubCategory がテンプレートに出た: {sc}")
        if want in ("fm", "wp", "bg"):
            continue          # 部屋そのものの化粧。マス目には乗らない
        if want != LOCP[e["Location"]]:
            raise SystemExit(f"{sc} が {e['Location']} に置かれている"
                             f"（面の分け方が変わった合図。家具 {e['FurnitureId']}）")
    seen_sc = {f.get("SubCategory") for f in fl_all}
    if seen_sc - set(CL_PLANE) - CL_UNKNOWN:
        raise SystemExit(f"知らない SubCategory: {sorted(seen_sc - set(CL_PLANE) - CL_UNKNOWN)}")

    # ---- 3. テンプレートを左上のマスへ直す。**はみ出しと重なりを 0 で確かめる** ----
    def title_of(key):
        v = etc.get(key)
        if not v or not v.get("NameJp"):
            raise SystemExit(f"テンプレートの題名 {key} が引けない")
        return v["NameJp"].replace("\n", "").strip()

    by_t = {}
    for e in tel:
        by_t.setdefault(e["FurnitureTemplateId"], []).append(e)
    # **数を決め打ちしない。**手本は増える（`Excel/` の 20 個に対し `DB/` は 26 個。
    # 2026-08-31）。「手本と中身が 1 対 1」であることだけ確かめる
    if not tpl or set(by_t) != {t["FurnitureTemplateId"] for t in tpl}:
        raise SystemExit(f"テンプレートが {len(tpl)} 個／中身は {len(by_t)} 個ぶんで噛み合わない")

    half = []          # 左上が半端なマスに来る行。**丸めて載せるが、数は出す**
    out_tpl, cells, overlaps, oob = [], 0, 0, 0
    rows_n = 0         # マス目に乗せた行の数（床材・壁紙・背景を除く）
    for t in sorted(tpl, key=lambda x: x["FurnitureTemplateId"]):
        tid = t["FurnitureTemplateId"]
        # **左の壁と右の壁は別の面。**1 つの集合にまとめると、同じ (x, y) が
        # 両方の壁にあるだけで「重なり」に見える（実測 511 件）
        rows, occ = [], {0: set(), 1: set(), 2: set()}
        room = {}
        for e in sorted(by_t[tid], key=lambda x: x["Order"]):
            f = fmap[e["FurnitureId"]]
            pl = CL_PLANE[f["SubCategory"]]
            if pl in ("fm", "wp", "bg"):
                if pl in room:
                    raise SystemExit(f"テンプレート {tid} に {f['SubCategory']} が 2 枚ある")
                room[pl] = e["FurnitureId"]
                continue
            w, h = (f.get("Size") or [1, 1])[0], (f.get("Size") or [1, 1])[1]
            rot = int(e["Rotation"]) // 90 % 4
            if rot % 2:
                w, h = h, w
            fx, fy = e["PositionX"] - w / 2.0, e["PositionY"] - h / 2.0
            if abs(fx - round(fx)) > 1e-9 or abs(fy - round(fy)) > 1e-9:
                half.append((tid, e["FurnitureId"], f.get("Name")))
            x0, y0 = int(round(fx)), int(round(fy))
            lim = CL_FLOOR if pl == "f" else CL_WALL
            if x0 < 0 or y0 < 0 or x0 + w > lim[0] or y0 + h > lim[1]:
                oob += 1
            # 面の番号。0 = 床、1 = 左の壁、2 = 右の壁
            side = 1 if e["Location"] == "WallLeft" else (2 if e["Location"] == "WallRight" else 0)
            # **カーペットの上には家具を置ける。**重なりの検査から外す
            if f["SubCategory"] != CL_UNDER:
                for i in range(w):
                    for j in range(h):
                        c = (x0 + i, y0 + j)
                        cells += 1
                        if c in occ[side]:
                            overlaps += 1
                        occ[side].add(c)
            rows.append([e["FurnitureId"], side, x0, y0, rot])
            rows_n += 1
        if len(room) != 3:
            raise SystemExit(f"テンプレート {tid} の床材・壁紙・背景がそろっていない: {sorted(room)}")
        out_tpl.append({"id": tid, "nm": title_of(t["FunitureTemplateTitle"]),
                        "fm": room["fm"], "wp": room["wp"], "bg": room["bg"], "it": rows})
    if oob:
        raise SystemExit(f"公式テンプレートが {oob} 個はみ出した。20×20 / 20×7 の前提が崩れた")
    if overlaps:
        raise SystemExit(f"公式テンプレートに重なりが {overlaps} 個。中心座標の読み方が違う")
    # **左上が半マスずれる行が 8 つある。**1,057 行のうち 8 行で、
    # 「幅が奇数 ⇔ 座標に .5」から外れる。いちばん近いマスへ丸めて載せているが、
    # **丸めても はみ出し 0・重なり 0 のまま**なので、置き場所は変わっていない。
    # マッサージチェア（6200）は SchaleDB が 1×3、ba-data が 1×2 で食い違う
    if len(half) > 12:
        raise SystemExit(f"左上が半端になる行が {len(half)} 行（既知は 8 行）: {half[:8]}")

    # ---- 4. セットボーナス ----
    steps = {(tuple(g["RequiredFurnitureCount"]), tuple(g["ComfortBonus"])) for g in fgrp}
    if len(steps) != 1:
        raise SystemExit(f"セットボーナスの段がセットごとに違う: {sorted(steps)}")
    need, bonus = steps.pop()
    known = {g["Id"] for g in fgrp}
    cc = next(iter(const))
    apply_n = cc.get("CafeSetGroupApplyCount")
    if not apply_n:
        raise SystemExit(f"CafeSetGroupApplyCount が {apply_n}")

    # ---- 5. 快適度の上限 ----
    cm = {(x["CafeId"], x["Rank"]): x["ComfortMax"] for x in crank}
    for cid in (1, 2):
        got = [cm[(cid, r)] for r in range(1, 11)]
        if got != [1000 + 500 * i for i in range(10)]:
            raise SystemExit(f"カフェ {cid} の ComfortMax が {got}")

    # ---- 6. 家具の一覧 ----
    setname = loc.get("FurnitureSet", {})
    fl, bysets = [], {}
    for f in sorted(fl_all, key=lambda x: x["Id"]):
        cb = f.get("ComfortBonus") or 0
        if cb <= 0:
            raise SystemExit(f"快適度 0 の家具がある: {f['Id']} {f.get('Name')}")
        sc = f.get("SubCategory") or ""
        sz = f.get("Size") or [1, 1]
        sg = f.get("SetGroupId") or 0
        fl.append({"id": f["Id"], "nm": (f.get("Name") or "?").replace("\n", ""),
                   "c": cb, "w": sz[0], "h": sz[1], "sc": sc,
                   "pl": CL_PLANE.get(sc, "?"), "rr": f.get("Rarity") or "N", "g": sg,
                   "ic": f.get("Icon") or ""})
        if sg:
            bysets[sg] = bysets.get(sg, 0) + 1
    sets = [{"id": g, "nm": setname.get(str(g), f"セット{g}"), "n": bysets[g],
             "ok": g in known} for g in sorted(bysets)]
    # **種類の日本語は `ItemCategory` にまとまっている。**`Category` と
    # `SubCategory` の両方がここに入っている（"Prop": "小物" など）。
    # 家具に出てくる語がすべて引けることを確かめてから渡す
    item_ja = loc.get("ItemCategory", {}) or {}
    want = {f.get("Category") or "" for f in fl_all} | {f.get("SubCategory") or "" for f in fl_all}
    lack = sorted(w for w in want if w and w not in item_ja)
    if lack:
        raise SystemExit(f"日本語名が引けない種類: {lack}")
    sub_ja = {k: v for k, v in item_ja.items() if k in want}

    npl = {}
    for f in fl:
        npl[f["pl"]] = npl.get(f["pl"], 0) + 1
    print(f"  家具 {len(fl)} 個（床 {npl.get('f', 0)}／壁 {npl.get('w', 0)}／"
          f"床材 {npl.get('fm', 0)}・壁紙 {npl.get('wp', 0)}・背景 {npl.get('bg', 0)}／"
          f"面が不明 {npl.get('?', 0)}）、セット {len(sets)} 個")
    print(f"  床 {CL_FLOOR[0]}×{CL_FLOOR[1]}（1 枚物の床材 {len(whole_floor)} 個の Size）、"
          f"壁 {CL_WALL[0]}×{CL_WALL[1]}（1 枚物の壁紙 {len(whole_wall)} 個の Size）")
    print(f"  公式テンプレート {len(out_tpl)} 個・{cells:,} マスを置き直して、"
          f"はみ出し {oob}・重なり {overlaps}・左上が半端 {len(half)}")

    # 一覧に出すツールの絵。**他の 25 本と被らない色付きのもの**
    n = int(fetch_icon("furniture_icon_sofaset",
                    "https://schaledb.com/images/furniture/icon/my_gehennaparty_01_sofaset_01.webp"))
    # 家具そのものの絵。**「家具を選ぶ」一覧と盤に出す**（2026-08-31 に追加。
    # SchaleDB の furniture/icon/ は `Icon` 名でも `Id` でも引けるが、
    # 上の sofaset と同じく `Icon` 名で引く）。146×116 で生徒の顔と同じ枠なので
    # `fetch_icon` がそのまま使える。**盤に載せない Trophy と FurnitureEtc
    # （面が不明の 104 個）は取らない。**絵の名前は 1,091 個すべて一意で、
    # `tools/img/` の既存ファイルとも被らないことを確かめた
    for f in fl:
        if f["pl"] != "?" and f["ic"]:
            n += fetch_icon(f["ic"], f"https://schaledb.com/images/furniture/icon/{f['ic']}.webp")
    if n:
        print(f"  絵を {n} 枚追加")

    return write_js("tools/cafe-layout/data.js", "CLAY", {
        "floor": CL_FLOOR, "wall": CL_WALL,
        "wholeFloor": whole_floor, "wholeWall": whole_wall,
        "rank": [{"c": c, "r": r, "cm": cm[(c, r)]} for c in (1, 2) for r in range(1, 11)],
        "setStep": list(need), "setBonus": list(bonus), "setMax": apply_n,
        "sets": sets, "furn": fl, "tpl": out_tpl,
        "subJa": sub_ja,
        "half": [{"t": t, "id": i, "nm": nm} for t, i, nm in half],
        "cells": cells, "rows": rows_n,
        "version": "SchaleDB jp（家具 %d 個・サイズ・快適度・セット名）／ "
                   "electricgoat/ba-data jp（FurnitureTemplate・FurnitureTemplateElement・"
                   "Furniture・FurnitureGroup・CafeRank・ConstCommon／DB の LocalizeEtc）"
                   % len(fl),
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")

def build_gacha():
    """募集の天井計算機。**data.js を持たない**（確率と天井は index.html 側の
    定数で、出どころはページの「数字の出どころ」欄）。ここでは絵だけ落とす。
    10 連募集チケット（Item Id 6999「10回募集チケット」。募集回数特典でもらえる
    もので、SchaleDB の items の `Icon` が `item_icon_recruitticket_normal_10`）。"""
    print("募集の天井計算機（絵だけ）")
    n = int(fetch_icon("item_icon_recruitticket_normal_10",
            "https://schaledb.com/images/item/icon/item_icon_recruitticket_normal_10.webp"))
    if n:
        print(f"  絵を {n} 枚追加")
    return bool(n)


# ------------------------------------------------------------ TL エディタ（ボスの行動）

# **ボスがいつ EX を撃つかは `DB/BossExternalBTExcelTable` のビヘイビアツリー。**
# 2026-08-31 に見つけた。引き金と振る舞いの組で書かれていて、総力戦で効くのは 3 つ。
#
#   UseNormalSkill N       → UseSelectExSkill i   通常スキル N 発目のあとに EX の i 番
#   CheckPeriod ms         → AddActiveGauge v     ms ごとにゲージが v たまる
#   CheckActiveGaugeOver t → UseSelectExSkill i   ゲージが t を超えたら EX の i 番
#   HPUnder hp             → ChangePhase p        HP が hp を切ったらフェーズ p へ
#
# **`UseSelectExSkill` の添字は `DB/CharacterSkillListExcelTable` の
# `ExSkillGroupId` の並び。**SchaleDB の `RaidSkillList` の並びではない。
#
# **通常スキル 1 発の長さは 2 通りの入り方をする。**
#   通常攻撃の型   `AnimationFrames` の `AttackIngDuration`（`Duration` は 2147483647）
#   Timeline の型  トップレベルの `Duration` がそのまま 1 周期
#
# `EnemyStartCoolTime` / `EnemyCoolTime`（`DB/SkillExcelTable`）で動くボスもいる。
# 0 のボスが多いので、そちらは上のツリーで動く。両方を出しておく。
BALS = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/LevelSkill/{}.json"
TL_FPS = 30.0
TL_DIFF = ["Normal", "Hard", "VeryHard", "Hardcore", "Extreme", "Insane", "Torment", "Lunatic"]


def cond_label(c):
    """`Condition` を 1 行にする。**訳さない。**データにある欄をそのまま並べる。"""
    if not isinstance(c, dict):
        return str(c)
    out = []
    for k in ("Type", "Parameter", "Operand", "Value", "Stat", "Target"):
        v = c.get(k)
        if v is not None and v != "":
            out.append(f"{k}={v}")
    return " ".join(out) or json.dumps(c, ensure_ascii=False)


# **説明文だけが「どちらか一方」と言っているダメージがある。**
# マコト（水着）の EX「遥かなる水平線を目指して！」は
# 「円形範囲内の敵の数によって、範囲内の敵に対してダメージ／2人以下：<?2>／3人以上：<?3>」
# で、この 2 件は `Condition` も `Group` も持たない。データの形だけを見ると
# 3 件とも足すことになり、EX Lv5 の 1 発が 1359%（275＋321＋762）になる。
# 実際に乗るのはどちらか一方で、総力戦の 1 体相手なら 596%（275＋321）。
#
# **拾うのは説明文の「N人以下：」「N人以上：」の行だけ。**行頭が「…：」で
# `<?n>` をちょうど 1 つ含み、その `n` が `DescParamId` と結び付く効果を
# 択一の候補にする。**ほかの言い回しには手を出さない**——「その他の敵に対して」
# 「ただし重複して受けたダメージは」などは、同時に乗るのか択一なのかが
# 説明文からは決まらない（2026-09-03 に 13 組を目で見て決めた）。
DESC_EXCL = re.compile(r"^([^：\n]*?\d+\s*人(?:以下|以上))\s*：")


def tl_group_labels(sk):
    """`Group` の段が**何で決まるか**を、説明文の原文から拾う（2026-09-03）。

    `Group` は「撃った回数の段」とは限らない。実物を並べるとこうなっている。

        20033 マコト        4人以下 / 5人～9人 / 10人以上         … 範囲内の敵の数
        10062 トキ          EXスキル1回使用時 / 2回 / 3回          … 撃った回数
        10070 ミナ          3個 / 4個 / 5個以上                   … 対象の弱体状態の数
        16016 ミネ（アイドル） 消耗なし / 10個 / 20個 / 30個          … 消耗したスタック
        16011 ハスミ（体操服） 追加で最大2コストを消耗                 … 払った追加コスト
        20026 ミノリ / 20040 サツキ  追加で最大3コストを消耗

    **「段 N」と書いてしまうと、道具が「撃った回数」だと決めつけて自動で上げてしまう。**
    説明文にある言葉をそのまま候補名にして、機械が決めてよいものだけを残す。

    返すのは段の番号（0 始まり）→ 名前 の辞書。読めなければ空。
    """
    desc = sk.get("Desc") or ""
    # 1. 「◯◯：…」の行が並んでいる形。行頭の見出しをそのまま採る
    labs = []
    for line in desc.split("\n"):
        line = line.strip()
        if "：" not in line:
            continue
        head = line.split("：")[0].strip()
        # `<s:CH0275_Public>10個` のようなタグは落とす
        head = re.sub(r"<[^>]*>", "", head).strip()
        if head and len(head) <= 24:
            labs.append(head)
    if labs:
        return {i: labs[i] for i in range(len(labs))}
    # 2. 「追加で最大 N コストを消耗して、1コストあたりのダメージが M% 増加」の形。
    #    段は**払った追加コスト**なので、0 から順に振る
    m = re.search(r"追加で最大(\d+)コストを消耗", desc)
    if m:
        return {i: f"追加コスト {i}" for i in range(int(m.group(1)) + 1)}
    return {}


def tl_excl_desc(sk):
    """`DescParamId` → 択一の見出し。択一だと読めないスキルは空の辞書。"""
    out = {}
    for line in (sk.get("Desc") or "").split("\n"):
        m = DESC_EXCL.match(line.strip())
        if not m:
            continue
        ids = re.findall(r"<\?(\d+)>", line)
        if len(ids) != 1:
            continue
        out[int(ids[0])] = m.group(1)
    return out if len(out) >= 2 else {}


# **答え合わせの済み・未済**（2026-09-03）。`~/arona/tl-work/cards/<ボス>.md` の
# `verify.py` の判定を人が読んで写したもの。**キーはボスの `DevName`** で、
# 屋内・屋外・市街地をまとめて 1 件にしてある（模型が同じなので）。
#   "ok"   … 動画と突き合わせて「幅の中」で閉じた
#   "part" … 突き合わせたが、まだ実測に届いていない
#   "none" … まだ突き合わせていない
# **画面に出すのは印だけ**で、この文は丸に i の吹き出しの中にだけ入る
# （2026-09-03 の先生の指示「注釈とかマジでいらないから全箇所」）。
TL_VERIFY = {
    "Binah": ("ok", "動画 2 本と突き合わせ済み"),
    "Hieronymus": ("ok", "動画 2 本と突き合わせ済み"),
    "HOD": ("ok", "動画 2 本と突き合わせ済み"),
    "RaidHoverCraft": ("ok", "動画 2 本と突き合わせ済み"),
    "Chesed": ("part", "突き合わせ 2 本のうち 1 本だけ合っています"),
    "Shirokuro": ("part", "突き合わせ 1 本。終盤が実測に届きません"),
    "EN0022": ("part", "突き合わせ 1 本。削る形が実測と違います"),
    "EN0013": ("part", "突き合わせ 1 本。実測の半分ほどしか出ません"),
    "KaitenFxMk0": ("none", "まだ突き合わせていません"),
    "EN0005": ("none", "まだ突き合わせていません"),
    "EN0006": ("none", "まだ突き合わせていません"),
    "EN0010": ("none", "まだ突き合わせていません"),
    "Goz": ("none", "まだ突き合わせていません"),
    "Perorozilla": ("none", "まだ突き合わせていません"),
}


def summon_count(ex_names, cache):
    """**1 回の湧きで何体出るか。**`LevelSkill/<スキル名>.json` の `MainEntityData`
    （`$type` が `SummonGroupSpawnerDAO`）→ `SummonGroups[].SummonEntities[]` を数える。

    2026-09-03 に見つけた。`SkillExcelTable` にも `raids.json` にも体数は無く、
    ここにだけある。屋内ペロロジラ Torment の `Perorozilla01TormentEx03` は 6 件で、
    同じファイルの `EntityTimeline` にある湧き位置のマーカー
    （`CircleAreaEntityDAO`、`Radius: 10`）も 6 個、座標も一致する。

    **同じ `UniqueName` が 2 回入ることがある**（Ex03 の `MiddleSize05` は位置違いで 2 件）
    ので、体数は要素の数で数える。返すのは {湧く体の UniqueName: 1 回の体数}。
    """
    out = {}
    for nm in (ex_names or []):
        if nm not in cache:
            try:
                cache[nm] = get_json(BALS.format(nm))
            except Exception:
                cache[nm] = {}
        me = (cache[nm] or {}).get("MainEntityData") or {}
        if "SummonGroupSpawner" not in str(me.get("$type") or ""):
            continue
        for g in (me.get("SummonGroups") or []):
            ents = g.get("SummonEntities") or []
            for e in ents:
                u = e.get("UniqueName")
                if u:
                    out[u] = max(out.get(u, 0), len(ents))
    return out


# ---- **盤**（2026-09-04、第 1 段）。
# 「1 発が何体に当たるか」は今まで人が入れていた（`uses[].mc`、既定 1）。
# **座標はデータに全部ある**ので、形と大きさ（`area`）と突き合わせれば計算できる。
#
#   生徒の陣形     `Stage/<StageFileName>.json` の `Formations[]`（`SectionIndex` ごと）
#   敵の湧き点     同じファイルの `Sections[].EnemySpawnPointGroupList[].SpawnPoints[]`
#                  **`Active: false` の点は最初は盤に居ない**（`CommandIdList` で湧く）
#   召喚の座標     `LevelSkill/<Ex>.json` の `MainEntityData.SummonGroups[].SummonEntities[]`
#                  の `SpawnWorldPosition`
#   体の大きさ     `CharacterExcelTable.BodyRadius`、射程は `CharacterStatExcelTable.Range`
#
# **単位は 1 : 100。**`BodyRadius: 700`（ボス）が 7.0 ワールド、
# スキルの `Radius: 3000` が 30.0 ワールドで、`Stage` の座標はワールド側
# （2026-09-04 に転移の円 3000 と大きなペロロ 6 体の最小包含円 3.64 で確かめた）。
BASTG = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Stage/{}.json"
_stage_cache = {}


def tl_stage(name):
    """`Stage/<名前>.json`。引けなければ空の辞書。"""
    if not name:
        return {}
    if name not in _stage_cache:
        try:
            _stage_cache[name] = get_json(BASTG.format(name))
        except Exception as e:
            print(f"  Stage が引けない: {name} ({e})")
            _stage_cache[name] = {}
    return _stage_cache[name] or {}


def _xy(p):
    """`{"x": .., "y": ..}` を `[x, y]` に。無ければ None。"""
    if not isinstance(p, dict):
        return None
    x, y = p.get("x"), p.get("y")
    if x is None or y is None:
        return None
    return [round(float(x), 3), round(float(y), 3)]


def _find_all(o, key):
    """入れ子ごとたどって、`key` を持つ辞書を全部返す。"""
    out = []
    if isinstance(o, dict):
        if key in o:
            out.append(o)
        for k, v in o.items():
            if k != "$type":
                out += _find_all(v, key)
    elif isinstance(o, list):
        for v in o:
            out += _find_all(v, key)
    return out


# **湧き点の名前は `CharacterExcelTable.DevName` と 1 語ずれることがある。**
# ペロロジラの盤は `Perorozilla_Lunatic_Peroro_MiddleSize01_Move` だが、
# `DevName` は `Perorozilla_Lunatic_MiddleSize01_Move`（`Peroro` が余分）。
# 対応表は DB のどこにも無い（`CharacterExcelTable` と
# `CharacterSettingExcelTable` を全文検索して不在を確かめた。2026-09-04）。
# **だから「`_` 区切りの語を 1 つだけ落として、当たりが 1 つだけなら採る」。**
# 2 つ以上当たったら諦める——静かに別の体を掴むほうが危ない。
def _dev_cid(name, by_dev):
    cid = by_dev.get(name)
    if cid is not None:
        return cid
    hit = []
    q = name.split("_")
    for i in range(len(q)):
        c = by_dev.get("_".join(q[:i] + q[i + 1:]))
        if c is not None and c not in hit:
            hit.append(c)
    return hit[0] if len(hit) == 1 else None


def tl_board(stage_name, ex_names, ls_cache, ch_all, stat):
    """盤の座標。引けなければ None。

    返す形（`data.js` の `d[].board`）:

      u    … スキル単位 : ワールド座標（100）
      bcn  … 生徒の陣形ビーコン `[[SectionIndex, Index, x, y], …]`
      spw  … 敵の湧き点 `[[SectionIndex, SpawnTemplateId, x, y, 最初から居るか, [CommandId…]], …]`
      smn  … 召喚の座標 `{Ex 名: [[UniqueName, x, y], …]}`
      bd   … 体の素性 `{DevName: [CharacterId, BodyRadius, Range]}`
    """
    st_j = tl_stage(stage_name)
    if not st_j:
        return None
    bcn, spw, names = [], [], set()
    for f in (st_j.get("Formations") or []):
        if f.get("IsEnemy"):
            continue
        p = _xy(f.get("Position"))
        if p:
            bcn.append([f.get("SectionIndex", 0), f.get("Index", 0), p[0], p[1]])
    for si, sec in enumerate(st_j.get("Sections") or []):
        for grp0 in (sec.get("EnemySpawnPointGroupList") or []):
            for sp in (grp0.get("SpawnPoints") or []):
                nm = ((sp.get("SpawnData") or {}).get("SpawnTemplateId"))
                p = _xy(sp.get("Position"))
                if not nm or not p:
                    continue
                names.add(nm)
                spw.append([si, nm, p[0], p[1], 1 if sp.get("Active") else 0,
                            list(sp.get("CommandIdList") or [])])
    smn = {}
    for nm in (ex_names or []):
        if nm not in ls_cache:
            try:
                ls_cache[nm] = get_json(BALS.format(nm))
            except Exception:
                ls_cache[nm] = {}
        rows = []
        # **`SummonGroups` は `MainEntityData` のこともあれば
        # `EntityTimeline[…].Entity` のこともある**（2026-09-04）。丸ごとたどる
        for sg0 in _find_all(ls_cache[nm] or {}, "SummonGroups"):
            for g in (sg0.get("SummonGroups") or []):
                for e in (g.get("SummonEntities") or []):
                    q = _xy(e.get("SpawnWorldPosition"))
                    if e.get("UniqueName") and q:
                        rows.append([e["UniqueName"], q[0], q[1]])
                        names.add(e["UniqueName"])
        # **同じ組が 2 度出てくる**（`MainEntityData` と `EntityTimeline` の両方に
        # 同じ `SummonGroups` が入っている）。名前と座標の三つ組で重複を落とす。
        # **名前だけで落としてはいけない**——Lunatic Ex03 の `MiddleSize05` は
        # (3.5, 30) と (2.0, 30) の 2 体で、これは別の体
        if rows:
            seen_r, uniq = set(), []
            for r in rows:
                k = (r[0], r[1], r[2])
                if k in seen_r:
                    continue
                seen_r.add(k)
                uniq.append(r)
            smn[nm] = uniq
    by_dev = {}
    for cid, cr in ch_all.items():
        dv = cr.get("DevName")
        if dv:
            by_dev[dv] = cid
    bd = {}
    for nm in sorted(names):
        cid = _dev_cid(nm, by_dev)
        if cid is None:
            continue
        cr, sr = ch_all.get(cid) or {}, stat.get(cid) or {}
        bd[nm] = [cid, cr.get("BodyRadius"), sr.get("Range")]
    if not (bcn or spw or smn):
        return None
    return {"u": 100, "bcn": bcn, "spw": spw, "smn": smn, "bd": bd}


# ---- **範囲の中心と狙い方**（2026-09-04、第 1 段 1-2）。
# SchaleDB の `Skills.<枠>.Radius` は**形と大きさ**しか持っていない
# （`Type` / `Radius` / `Degree` / `Width` / `Height` / `ExcludeRadius`）。
# **その形がどこに出るか**と**誰を狙うか**は `LevelSkill/<枠>.json` にある。
#
#   実体の `SpawnPositionType`   Invoker（撃った子の足元）/ InputPosition（狙った点）/
#                                InputBattleEntity（狙った相手に貼り付く）/
#                                BattleEntity / AliveAllyCenter / SkillCommandSelectedTarget
#   根の `EssentialCandidateRule` TargetingType（Target＝相手を狙う / Position＝地面の点）
#                                TargetSide（Enemy / Ally / Ally_Except_Self / Self）
#                                MaxTargetCount（**狙う相手の数**であって、
#                                範囲に入った体の数ではない）
#   根の `TargetSortRule`         どの相手を選ぶか（SortCriteria / OrderBy）
#   根の `Range`                  届く距離
#   実体の `HitFrames`            当たるフレーム（多段はここが複数）
#
# **範囲の実体のほうには `MaxTargetCount` が無い**（`Radius` を持つ 232 枠を数えて
# 全部 None。2026-09-04）。つまり**形の中に居る体は全部当たる**。
# だから「何体に当たるか」は数ではなく幾何で決まる——盤を作れば数えられる。
#
# **範囲の実体は入れ子の奥にあることがある。** アルの EX は
# `MainEntityData` が `TargetProjectileEntityDAO` で、実際の円は
# `MainEntityData.SplashAreaEntityData`。イオリは
# `MainEntityData.AreaSpawnerData.EntityTimeline[0].AreaData`。
# だから**丸ごと深さ優先でたどって、最初に見つかった `*AreaEntityDAO` /
# `*AuraEntityDAO` を採る**。232 枠のうち 206 枠が取れる（89%）。
# 取れない 26 枠は `Bounce`（跳ねる弾。円でも扇でもない）が主で、
# そこは今までどおり画面側の既定に任せる。
_geom_cache = {}


def _find_area(o):
    """入れ子ごと全部たどって、最初に見つかった範囲の実体を返す。

    返すのは `(実体, 型名)`。無ければ None。
    """
    if isinstance(o, dict):
        t = str(o.get("$type") or "").split(",")[0].split(".")[-1]
        if t.endswith(("AreaEntityDAO", "AuraEntityDAO")):
            return o, t[:-9]
        for k, v in o.items():
            if k == "$type":
                continue
            r = _find_area(v)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = _find_area(v)
            if r:
                return r
    return None


def _ls_geom(group):
    """`LevelSkill/<枠>.json` から中心・狙い方・届く距離・当たるフレーム。

    返すのは
    `[SpawnPositionType, TargetingType, TargetSide, MaxTargetCount, Range,
      [HitFrames…], 範囲の型, [ずれ x, ずれ y], AngleOffset, SpawnDirectionType]`。
    引けなければ None。末尾の空欄は落とす。

    **`PositionOffset` を落とすと矩形が半分うしろに出る。**アリスの EX は
    `Width 200 × Height 2000`（＝ 2.0 × 20.0 ワールド）で
    `PositionOffset {"x": 0.0, "y": 10.0}`——**中心が足元ではなく 10.0 前**で、
    ちょうど長さの半分。これを無視すると光線が背中側 10.0 まで伸びる。
    ただし**常に長さの半分ではない**（アスナ 200×200 は 0、ヒフミ 600×250 は 0、
    CH0079 は −2.0）ので、計算では出せない。**運ぶしかない。**
    `PositionOffset` はワールド、`Width` / `Height` / `Radius` は 1/100 ワールド。
    """
    if not group:
        return None
    if group in _geom_cache:
        return _geom_cache[group]
    try:
        d = get_json(BALS.format(group)) or {}
    except Exception as e:
        # **範囲が引けないのは致命ではない。**画面側は今までどおり既定で数える
        print(f"  LevelSkill が引けない: {group} ({e})")
        d = {}
    got = None
    r = _find_area(d)
    if r:
        area, base = r
        ecr = d.get("EssentialCandidateRule") or {}
        po = area.get("PositionOffset") or {}
        off = [round(float(po.get("x") or 0), 3), round(float(po.get("y") or 0), 3)]
        got = [area.get("SpawnPositionType"), ecr.get("TargetingType"),
               ecr.get("TargetSide"), ecr.get("MaxTargetCount"),
               d.get("Range"), list(area.get("HitFrames") or []), base,
               off if (off[0] or off[1]) else None,
               area.get("AngleOffset") or None,
               area.get("SpawnDirectionType")]
        while len(got) > 7 and got[-1] in (None, 0, 0.0):
            got.pop()
    _geom_cache[group] = got
    return got


# **生徒の枠 → `LevelSkill` の名札**（`DB/CharacterSkillListExcelTable`）。
# 行は `(MinimumTierCharacterGear, FormIndex)` ごとに 1 本ずつあり、
# **`EmptySkill` でない最初の 1 枚**を取る（オトギ・トキで踏んだ形。6425 行の注を参照）。
def _skill_gid(rows, kind):
    if not rows:
        return None
    def first(lst):
        for v in (lst or []):
            if v and v != "EmptySkill":
                return v
        return None
    if kind == "ExtraPassive":
        for r in rows:
            v = first(r.get("ExtraPassiveSkillGroupId"))
            if v:
                return v
        return None
    fi, gear = 0, 0
    if kind == "Ex":
        fld = "ExSkillGroupId"
    elif kind[:2] == "Ex" and kind[2:].isdigit():
        fld, fi = "ExSkillGroupId", int(kind[2:])
    elif kind == "Normal":
        fld = "NormalSkillGroupId"
    elif kind == "NormalF":
        fld, fi = "NormalSkillGroupId", 1
    elif kind == "Public":
        fld = "PublicSkillGroupId"
    elif kind == "GearPublic":
        fld, gear = "PublicSkillGroupId", 2
    else:
        return None
    cand = [r for r in rows if (r.get("FormIndex") or 0) == fi
            and (r.get("MinimumTierCharacterGear") or 0) == gear]
    if not cand:
        cand = [r for r in rows if (r.get("FormIndex") or 0) == fi]
    for r in cand:
        v = first(r.get(fld))
        if v:
            return v
    return None


# ---- **敵側の効果**（`DB/LogicEffect_NPC.json`、4,231,686 バイト・4,625 件）。
# 2026-09-04 に足した。それまでこの表は 1 度も読んでおらず、読んでいたのは
# `DB/LogicEffect_PC.json`（生徒側）だけだった。
#
# 中身は「1 つの効果」の定義で、`$type` が種類、`GroupId` が名札。
# **誰がいつ配るかはこの表に無い。**配るのは `LevelSkill/<スキル名>.json` の
# `EntityTimeline[].Entity.Abilities[].LogicEffectGroupIds` で、そのスキルを
# 持っている体は `DB/CharacterSkillListExcelTable.json` から引ける。
# **この 3 段を辿って初めて「どのボスのどの状態で効くか」が決まる。**
#
# 例（ケセド。2026-09-04 に実物で確かめた）:
#   LogicEffect_NPC  {"$type": "...StatChangeEffectDAO", "StatType": 39,
#                     "BaseAmount": -9000, "Channel": 527,
#                     "GroupId": "Chesed_Passive01_Effect01",
#                     "TemplateId": "Debuff_StatChange_DamagedRatio_Self"}
#   LevelSkill/ChesedPassive01.json
#                    "TriggerCondition": {"Event": 301,
#                     "ConditionExpression": "GetCurrentBehavior() == [BehaviorType.Groggy]"}
#                    "EntityTimeline[0].Entity.Abilities[0].LogicEffectGroupIds":
#                     ["Chesed_Passive01_Effect01"]
#   CharacterSkillList 7301100 の `PassiveSkillGroupId` に `ChesedPassive01`
#
# **`StatType` は数字。**名前は `TemplateId` の `Buff|Debuff_StatChange_<名前>` から
# 割り出した（PC/NPC 両方の 3,000 件近くを数えて、1 対 1 に決まったものだけ採った）。
#   39 DamagedRatio / 61・62 DamagedRatio2 / 65・66 ExDamagedRatio
#   88 ReduceWeakDamagedRate / 89 WeakDamagedRatio
_NPC_STAT = {39: "damaged", 61: "damaged2", 62: "damaged2",
             65: "exDamaged", 66: "exDamaged",
             88: "weakDamaged", 89: "weakDamaged"}
# 被ダメージの出方そのものを変える種類。**PC 側には 1 件も無い。**
_NPC_DAO = {"DamagedLimitEffectDAO": "limit",
            "OverrideBulletArmorDamageFactorEffectDAO": "override",
            "DamageTransferEffectDAO": "transfer",
            "DamagedMultiplierbyDamageOverTimeEffectDAO": "dotMul"}
_NPC_LE = None
_NPC_LS = {}


def npc_effects():
    """`GroupId` → [(種類, DAO 名, 行)]。**被ダメージ率に効くものだけ。**"""
    global _NPC_LE
    if _NPC_LE is not None:
        return _NPC_LE
    out = {}
    for r in as_list(get_json(BADB.format("LogicEffect_NPC"))):
        dao = str(r.get("$type") or "").split(",")[0].split(".")[-1]
        k = None
        if dao == "StatChangeEffectDAO":
            k = _NPC_STAT.get(r.get("StatType"))
        elif dao in _NPC_DAO:
            k = _NPC_DAO[dao]
        elif dao == "ImmuneEffectDAO":
            # **`DamagedRatio` の弱体そのものを無効にする札。**ケセドの
            # 「この効果以外の DamagedRatio の増加効果を無効化」の実体
            tp = [r.get("TargetLogicEffectTemplateId%02d" % i) or "" for i in range(13)]
            if any("DamagedRatio" in t for t in tp):
                k = "immune"
        if not k or not r.get("GroupId"):
            continue
        out.setdefault(r["GroupId"], []).append((k, dao, r))
    _NPC_LE = out
    return out


def npc_skill_index(names):
    """スキル名 → (配る GroupId の集合, Event, ConditionExpression)。
       **落とせなかったファイルは黙って飛ばす**（大決戦だけの枝は 404 が返る）。"""
    import concurrent.futures as _cf
    todo = [n for n in names if n not in _NPC_LS]

    def _one(n):
        try:
            return n, get_json(BALS.format(n))
        except Exception:
            return n, None
    if todo:
        with _cf.ThreadPoolExecutor(8) as ex:
            for n, d in ex.map(_one, todo):
                _NPC_LS[n] = d
    out = {}
    for n in names:
        d = _NPC_LS.get(n)
        if not d:
            continue
        gs = set()

        def walk(o):
            if isinstance(o, dict):
                for g in (o.get("LogicEffectGroupIds") or []):
                    gs.add(g)
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(d)
        tc = d.get("TriggerCondition") or {}
        out[n] = (gs, tc.get("Event"), tc.get("ConditionExpression") or "")
    return out


def _summon_tail(u):
    """`Perorozilla_Torment_Peroro_MiddleSize01_Move` と
    `Perorozilla_Torment_MiddleSize01_Move` を同じものとして突き合わせる鍵。
    **湧く側には役どころの名前が 1 つ多く入る。**"""
    ps = str(u or "").split("_")
    if not ps:
        return ""
    return "_".join(ps[-2:]) if ps[-1] in ("Move", "Fix") else ps[-1]


def tl_frames(group, cache):
    """通常スキル 1 発ぶんのフレーム数。引けなければ None。"""
    if group in cache:
        return cache[group]
    try:
        d = get_json(BALS.format(group))
    except Exception:
        d = {}
    v = None
    for a in (d.get("AnimationFrames") or []):
        if a.get("Key") == "AttackIngDuration" and a.get("Frame"):
            v = a["Frame"]
    if not v:
        dur = d.get("Duration")
        if isinstance(dur, int) and 0 < dur < 100000:
            v = dur
    cache[group] = v
    return v


def tl_names(ex, idxs):
    """`BehaviorArgument` の添字を `ExSkillGroupId` の名前に。**訳さない。**"""
    return "・".join(ex[i] if i < len(ex) else f"?{i}" for i in idxs)


def tl_idxs(arg):
    """`BehaviorArgument` は "2" のほか "2,0" のように複数入ることがある。"""
    return [int(x) for x in str(arg).split(",") if x.strip().lstrip("-").isdigit()]


def tl_base_id(cid):
    """制約解除決戦の敵 ID は `<ボス5桁>0<難易度1桁><部位2桁>`。Normal 版に落とす。
    例: 614130201（Hard の本体）→ 614130101（Normal の本体）。総力戦の 7 桁は対象外。"""
    c = int(cid)
    if c < 100000000:
        return None
    d = c // 100 % 10
    return c - (d - 1) * 100 if d > 1 else None


def tl_twins(bt, csl, stat):
    """`{木の無い敵: 中身が同じで木のある敵}`。

    **難易度ぶんの木が丸ごと抜けていることがある。**ヒエロニムス（屋内）の
    Torment `7303700` は `DB/BossExternalBTExcelTable` に 1 行も無い
    （2026-09-02 に 10,868 行・ボス 411 体を数えて確かめた）。地形違いの
    同じ難易度、市街地 Torment `7403700` は

        NormalSkillGroupId  ['HieronymusInsaneNormal01']
        ExSkillGroupId      ['HieronymusInsaneEx01', 'HieronymusInsaneEx02',
                             'HieronymusInsaneEx03', 'HieronymusInsaneEx04']
        MaxHP1              42000000

    が 1 文字も違わない（`7403700` の木の `HPUnder` は 21000000 ＝ その HP の
    ちょうど半分で、ヒエロニムスの他の難易度と同じ組み方）。

    **3 つが全部一致して、候補が 1 体だけのときしか埋めない。**部位のように
    `NormalSkillGroupId` も `ExSkillGroupId` も空の敵は HP だけで何体にも
    当たるので、先に外す。この条件で総力戦・大決戦を全部あたって、当たるのは
    `7303700` → `7403700` の 1 件だけだった（2026-09-02）。
    """
    def key(c):
        r = csl.get(c) or {}
        return (tuple(r.get("NormalSkillGroupId") or []),
                tuple(r.get("ExSkillGroupId") or []),
                (stat.get(c) or {}).get("MaxHP1"))

    def usable(k):
        return bool(k[2]) and bool(k[0] or k[1])

    by_key = {}
    for c in bt:
        k = key(c)
        if usable(k):
            by_key.setdefault(k, []).append(c)
    out = {}
    for c in set(csl) | set(stat):
        if c in bt:
            continue
        k = key(c)
        if not usable(k):
            continue
        cand = by_key.get(k) or []
        if len(cand) == 1:
            out[c] = cand[0]
    return out


# **通常スキルを数え直す木は、その 1 周を繰り返す。**
# `UseNormalSkill C → ClearNormalSkill` が入っているフェーズは、C 発目で
# 数えが 0 に戻るので、表に並んでいる 1 周ぶんがそのまま繰り返される。
# 1 周の長さは「C 発ぶんの通常スキル ＋ その周で撃つ EX のモーション」。
#
# **動画 2 本で確かめた**（ヒエロニムス Torment、`UseNormalSkill 4` で
# `ClearNormalSkill`、EX は `HieronymusInsaneEx02`＝ウルガータ・`Duration` 300
# フレーム＝10.0 秒。1 周 ＝ 4 × 3.333 ＋ 10.0 ＝ 23.333 秒）。
#   yuZnCpRh2YU  戦闘 11.033 秒（03:48.967）まだ無い／12.733 秒（03:47.267）
#                 と 14.433 秒（03:45.567）で足元に金の魔法陣／27.700 秒
#                 （03:32.300）には無い／36.633 秒（03:23.367）でまた出る
#   qReSK-B24ts  戦闘 36.733 秒（03:23.267）で金の魔法陣
# 1 発目 13.333 秒・2 発目 36.667 秒。**13.333 秒ごとに繰り返すだけの形では
# 26.667〜36.667 秒が EX の最中になり、27.700 秒のコマと合わない。**
TL_EV_LIMIT = 300.0


def tl_one(cid, bt, csl, stat, fcache, ch_appear, twin=None):
    """敵 1 体ぶんの行動。出せなければ None。

    **難易度ぶんの木が無いときは Normal の木で埋める**（`fb` に残す）。
    HP のしきい値を無視して木を比べると、ペロロジラ・グレゴリオ・クロカゲ・
    ゲブラ・ドラム缶ガニは全難易度で同じ形をしていた。スキル名と HP は
    その難易度の表から取り直すので、埋めても名前と HP は正しい。

    `twin` は「中身が同じ敵」の対応表（`tl_twins` が作る）。地形違いで木が
    片方にしか無いときに使う。
    """
    fb = []
    rows = bt.get(cid)
    if not rows:
        b = tl_base_id(cid)
        if b and bt.get(b):
            rows, _ = bt[b], fb.append("bt=" + str(b))
    if not rows and (twin or {}).get(cid):
        rows, _ = bt[twin[cid]], fb.append("bt=" + str(twin[cid]))
    if not rows:
        return None
    sl = csl.get(cid)
    if not sl:
        b = tl_base_id(cid)
        if b and csl.get(b):
            sl, _ = csl[b], fb.append("skills=" + str(b))
    if not sl:
        return None
    ex = sl.get("ExSkillGroupId") or []
    ns = (sl.get("NormalSkillGroupId") or [None])[0]
    nf = tl_frames(ns, fcache) if ns else None
    # EX 1 発のモーション。**トップレベルの `Duration` がそのまま入っている。**
    # 1 周の長さを出すのに要るので、ここで引いておく（呼び出し側の `exd` と同じ）
    exd = [tl_frames(g, fcache) for g in ex]
    st = stat.get(cid, {})
    spd = (st.get("NormalAttackSpeed") or 10000) / 10000.0
    per = (nf / TL_FPS / spd) if nf else None
    ph = {}
    # **秒に直せなかった引き金**。画面のレーンを空にしないための言い訳を残す
    why = []
    if not per:
        why.append(
            f"通常スキルの長さが引けない（NormalSkillGroupId={ns} / AttackIngDuration も "
            "Duration も無い）ので、UseNormalSkill N の EX を秒に直せない")
    for p in sorted({r["AIPhase"] for r in rows}):
        rs = [r for r in rows if r["AIPhase"] == p]
        ev = sorted(([int(r["TriggerArgument"]),
                      round(int(r["TriggerArgument"]) * per, 3) if per else None,
                      tl_idxs(r["BehaviorArgument"])]
                     for r in rs
                     if r["ExternalBTTrigger"] == "UseNormalSkill"
                     and r["ExternalBehavior"] == "UseSelectExSkill"), key=lambda x: x[0])
        # 数え直し（`UseNormalSkill C → ClearNormalSkill`）。上の TL_EV_LIMIT の
        # コメントに、動画で確かめた中身を書いてある
        clr = sorted({int(r["TriggerArgument"]) for r in rs
                      if r["ExternalBTTrigger"] == "UseNormalSkill"
                      and r["ExternalBehavior"] == "ClearNormalSkill"})
        # **数え直しの書き方は 2 通りある**（2026-09-04、64）。
        # `UseNormalSkill C → ClearNormalSkill`（C 発目で 0 に戻る）のほかに、
        # **`CheckPeriod 1 → ClearNormalSkill`** がある（`CheckPeriod` の
        # `TriggerArgument` は 1 が 1,015 件で「いつでも真」＝木の落ち穂拾いの枝。
        # 全 10,868 行のうち 367 件・木でいうと 141 / 411 本が持っている）。
        # こちらは戻る数が書いていないので、**台本そのものの長さ
        # （`UseNormalSkill` の引数の最大）を 1 周とする。**
        #
        # ペロロジラがこれで、**直す前は 72.0 秒で終わっていた**。
        # 先生がくれた録画（`Wgg-i9aPPxs`）でボスの EX は
        # 戦闘 12.0 / 76.8 / 168.5 / 233.2 秒に出ていて、72 秒より後にも出る。
        # `AIPhase` が `CheckActiveGaugeOver 301 → ChangePhase` で 0→1→2→0 と
        # 輪になって回り、入るたびにこの行で数えが 0 に戻る（2026-09-04 に動画で確かめた）
        if not clr and any(r["ExternalBTTrigger"] == "CheckPeriod"
                           and r["ExternalBehavior"] == "ClearNormalSkill" for r in rs):
            _uns = [int(r["TriggerArgument"]) for r in rs
                    if r["ExternalBTTrigger"] == "UseNormalSkill"]
            if _uns:
                clr = [max(_uns)]
        # **その数でフェーズが変わるなら繰り返さない。**ペロロジラの
        # フェーズ 12 は `UseNormalSkill 6` に `ClearNormalSkill` と
        # `ChangePhase 11` の両方がぶら下がっていて、1 周でフェーズが終わる
        ns_ph = any(r["ExternalBTTrigger"] == "UseNormalSkill"
                    and r["ExternalBehavior"].startswith(("ChangePhase",
                                                          "ForceChangePhase"))
                    for r in rs)
        # **EX のモーションが 1 つでも引けなければ、1 周の長さが出ない。**
        # 足りないぶんを 0 で埋めると「EX が通常スキルを止めない」形になって、
        # 動画と合わない（上の TL_EV_LIMIT のコメント参照）
        exok = all(exd[i] for e in ev for i in e[2] if i < len(exd))
        if (per and ev and len(clr) == 1 and ev[-1][0] <= clr[0]
                and not ns_ph and exok):
            span = clr[0] * per + sum((exd[i] or 0) for e in ev for i in e[2]) / TL_FPS
            if span > 0:
                # **足すのは丸める前の値。**丸めた 13.333 に足すと 2 周目が
                # 36.666 になって、動画の 36.667 秒と 1 ミリ秒ずれる
                base, t = list(ev), span
                while base[0][0] * per + t <= TL_EV_LIMIT:
                    ev += [[e[0], round(e[0] * per + t, 3), e[2]] for e in base]
                    t += span
                ev.sort(key=lambda x: x[1])
        elif clr:
            _c = "・".join(str(c) for c in clr)
            _r = ("そこでフェーズが変わる" if ns_ph
                  else "EX のモーション（LevelSkill の Duration）が引けない" if not exok
                  else "通常スキルの長さが引けない" if not per
                  else "戻る数が 1 通りでない" if len(clr) > 1
                  else "EX を撃つ数のほうが大きい")
            why.append(f"フェーズ {p + 1} は通常スキル {_c} 発目で数えが 0 に戻る"
                       f"（UseNormalSkill → ClearNormalSkill）が、{_r} ので"
                       "繰り返しを出していない")
        add = [r for r in rs if r["ExternalBTTrigger"] == "CheckPeriod"
               and r["ExternalBehavior"] == "AddActiveGauge"]
        over = [r for r in rs if r["ExternalBTTrigger"] == "CheckActiveGaugeOver"]
        g = None
        if add and over:
            step, amt = int(add[0]["TriggerArgument"]), int(add[0]["BehaviorArgument"])
            if amt:
                g = [round(int(over[0]["TriggerArgument"]) / amt * (step / 1000.0), 3),
                     tl_idxs(over[0]["BehaviorArgument"])]
                # **しきい値が 2 つ以上あるボスがいる**（ケセドは 50 で
                # `ChesedInsaneExSkill02`、100 で `ChesedInsaneExSkill03`）。
                # 画面は `g` を 1 本しか描かないので、残りは理由に落とす
                for r in over[1:]:
                    _g = tl_names(ex, tl_idxs(r["BehaviorArgument"]))
                    why.append(
                        f"フェーズ {p + 1} はゲージ {r['TriggerArgument']} でも EX を撃つ"
                        f"（{r['ExternalBehavior']} → {_g}）が、画面はしきい値 "
                        f"{over[0]['TriggerArgument']} の 1 本しか出していない")
            # **ゲージの周期より EX のモーションのほうが長いことがある。**
            # ビナー（屋外）Torment はゲージ 8.333 秒に対して
            # `BinahInsaneExSkill03`（浄化の嵐）が 327 フレーム＝10.9 秒。
            # 画面は周期ぶんだけ帯を並べるので、そのままだと帯が重なる。
            # **どちらが正しいかは動画で確かめられていない**（2026-09-02、
            # IrVUx0ywuyo の 戦闘 5.633 秒・9.0 秒のコマでは、ボスの HP バーの
            # 上の四角が灰色のままで、ゲージかどうかも読めなかった）
            for i in (g[1] if g else []):
                if i < len(exd) and exd[i] and exd[i] / TL_FPS > g[0]:
                    why.append(
                        f"フェーズ {p + 1} はゲージの周期 {g[0]} 秒より "
                        f"{ex[i] if i < len(ex) else '?'} のモーション "
                        f"{exd[i]} フレーム（{round(exd[i] / TL_FPS, 3)} 秒）の"
                        "ほうが長い。画面の帯は重なって出る")
        elif over:
            _t = "・".join(r["TriggerArgument"] for r in over)
            why.append(f"フェーズ {p + 1} はゲージのしきい値（CheckActiveGaugeOver {_t}）"
                       "はあるが、貯まり方（CheckPeriod → AddActiveGauge）が無い")
        hp = [[int(r["TriggerArgument"]), r["BehaviorArgument"]] for r in rs
              if r["ExternalBTTrigger"] == "HPUnder"
              and r["ExternalBehavior"].startswith(("ChangePhase", "ForceChangePhase"))]
        # **HP を切ったら EX、という行がある**（ホドのフェーズ 3 は 9000000 から
        # 100000 刻みで 8100000 まで 10 行）。HP は時刻に直せないので理由に落とす
        for r in rs:
            if (r["ExternalBTTrigger"] == "HPUnder"
                    and r["ExternalBehavior"] == "UseSelectExSkill"):
                _g = tl_names(ex, tl_idxs(r["BehaviorArgument"]))
                why.append(f"フェーズ {p + 1} は HP {r['TriggerArgument']} を切ったら "
                           f"{_g}（HP は時刻に直せない）")
            elif r["ExternalBTTrigger"] == "None":
                # Selector の外れ枝（`ExternalBTNodeType` が `SubNode`）。
                # 親の `BehaviorRate` が 10000 のときは出ない
                why.append(f"フェーズ {p + 1} は Selector の外れ枝"
                           f"（SubNode・BehaviorRate {r['BehaviorRate']}）で "
                           f"{r['ExternalBehavior']} {r['BehaviorArgument']} "
                           "を撃つことがある（時刻に直せない）")
            elif (r["ExternalBTTrigger"] not in
                  ("UseNormalSkill", "CheckPeriod", "CheckActiveGaugeOver", "HPUnder")
                  and r["ExternalBehavior"] in ("UseSelectExSkill", "ChangePhase",
                                                "ForceChangePhase")):
                why.append(f"フェーズ {p + 1} は {r['ExternalBTTrigger']} "
                           f"{r['TriggerArgument']} で {r['ExternalBehavior']} "
                           f"{r['BehaviorArgument']}（時刻に直せない）")
        # **上の 3 つで拾えなかった行は、そのまま残す。**
        # `OnSpawned` `ApplyGroggy` `DestroyParts` `CheckSummonCharacterCountUnder`
        # `CheckHallucinationCountOver` などは、時刻に直せないが画面には出したい
        taken = {"UseNormalSkill", "CheckPeriod", "CheckActiveGaugeOver", "HPUnder"}
        raw = [[r["ExternalBTNodeType"], r["ExternalBTTrigger"], r["TriggerArgument"],
                r["BehaviorRate"], r["ExternalBehavior"], r["BehaviorArgument"]]
               for r in rs if r["ExternalBTTrigger"] not in taken]
        if not (ev or g or hp or raw):
            continue
        ph[str(p)] = {"ev": ev, "g": g, "hp": hp, "raw": raw}
    if not ph:
        return None
    # **グロッキーで何が起きるかはボスごとに違う**（2026-09-01 の先生の指摘
    # 「各ボスグロッキー時の状態は変わる」）。木の `ApplyGroggy` に入っている。
    #   AddActiveGauge  … EX ゲージを引く（-100 / -900 / -999）
    #   ChangePhase     … グロッキー専用のフェーズへ移る（シロ&クロは 6 / 7）
    #   ClearNormalSkill… 通常攻撃を止める
    # **被ダメージが増える指定はどのボスにも無い**（`CharacterStatExcelTable` /
    # `ConstCombatExcelTable` / `logiceffectdata` / `SkillExcelTable` を
    # 2026-09-01 に全部見た。あるのは `GroggyGauge` と `GroggyTime` だけ）
    gg = [[r["AIPhase"], r["ExternalBehavior"], r["BehaviorArgument"]]
          for r in rows if r["ExternalBTTrigger"] == "ApplyGroggy"]
    seen_why, uniq_why = set(), []
    for w in why:
        if w not in seen_why:
            seen_why.add(w)
            uniq_why.append(w)
    return {"cid": cid, "hp": st.get("MaxHP1"), "ns": ns, "nf": nf,
            "spd": st.get("NormalAttackSpeed") or 10000,
            "ap": ch_appear.get(cid), "gg": gg,
            # 秒に直せなかった引き金の言い分。**レーンを空にしないため**
            "exWhy": uniq_why,
            "per": round(per, 3) if per else None, "ex": ex, "ph": ph, "fb": fb}


# ---- **グロッキーゲージが「ボス自身の EX」で埋まるボス**（2026-09-04）。
# ペロロジラがこれで、`raids.json` の `GroggyCondition` は
# 「気絶状態のペロロミニオンを吸い込むと増加する。」としか書いていない。
# **その「吸い込む」は 3 つの表に数字で入っている。**
#
#   ① 増分  `DB/LogicEffect_NPC.json` の `GroggyGaugeEffectDAO`。
#      **`Amount` は 0 で、値は `CasterCoefficientAmount` に入っている**（ここを
#      見落としていたのが 2026-09-04 まで「貯まり方が無い」と書いていた理由）。
#      {"$type": "MX.GameData.DAO.Battle.GroggyGaugeEffectDAO, BlueArchive",
#       "Amount": 0, "TargetCoefficientAmount": 0, "CasterCoefficientAmount": 834,
#       "GroupId": "Perorozilla01_Torment_Ex09_Effect05",
#       "TemplateId": "Debuff_AddGroggyGauge", "Channel": 90001}
#      **1/10000 が満杯**（`CharacterStatExcelTable.GroggyGauge` に対する割合）。
#      834 は SchaleDB の本文の「グロッキーゲージが 1/12 上昇」と一致する
#      （1/12 = 833.3…）。Insane は 1000 = 1/10、それ以下は 1430 = 1/7
#
#   ② どの段が選ばれるか  `LevelSkill/<Ex09>.json` の
#      `EntityTimeline[1].Entity.Abilities[]` に並ぶ
#      {"$type": "MX.GameData.DAO.Battle.CountLogicEffectTemplateModifierDAO, BlueArchive",
#       "TemplateId": "Dummy_Perorozilla_MiddleSize_CrowdControl_StatusAdd_Stunned",
#       "CountMin": 6, "CountMax": 6, "IncludeType": 1, "CheckTarget": 2}
#      **盤に居る「転倒した大きなペロロミニオン」の数がそのまま段。**
#      Lunatic / Torment は 0〜6 の 7 段、Insane は 0〜5、それ以下は 0〜4
#
#   ③ 誰がその札を貼るか  **プレイヤーではない。**大きなペロロミニオン自身の
#      `LevelSkill/Perorozilla01MiddleSize01Passive02.json` が
#      `"TriggerCondition": {"Event": 301, "ConditionExpression": "GetHPRate() < 5000"}`
#      で `Perorozilla_MiddleSize_Passive02_Effect01`
#      （`StatusAddEffectData`・`TargetStatus: "Stunned"`・`Duration: -1`・Channel 160001）を
#      自分に貼る。**HP を 50% 以下にすると転倒して永続 Stunned になる**、が全文。
#      大きなペロロミニオンは `Perorozilla_MiddleSize_Passive01_Effect01`
#      （`TargetStatus: "Immortal"`・`Duration: -1`）で死なないので、
#      「何体を 50% 以下にしたか」だけが効く
#
# 貯める EX を何発目の通常攻撃で撃つかは木にある（`UseNormalSkill N →
# UseSelectExSkill`）。**フェーズが終わる発数も木から出る**——
#   `CharacterStatExcelTable.ActiveGauge` = 301（上限）
#   `Perorozilla01_Ex09_Effect03`（`AddCurrentATGEffectDAO`・`Amount: 150`）が EX 1 発ぶん
#   木の `UseNormalSkill 10/19/28/37 → AddActiveGauge 1`、`11/20/29/38 → AddActiveGauge -1`
#   ⇒ 150 × 2 + 1 = 301 で `CheckActiveGaugeOver 301 → ChangePhase` が立つ。
#   **19 発目でフェーズが終わり、その前に吸収は 2 回**（9 発目と 18 発目）。
#   上限体数のとき 5004 × 2 = 10008 ≧ 10000 なので、**2 回目の吸収でちょうど満ちる。**
_GGE = None


def _gg_effects():
    """`GroupId` → ("groggy", Amount, TargetCoefficientAmount, CasterCoefficientAmount)
       か ("atg", Amount, 0, 0)。`DB/LogicEffect_NPC.json` から 2 種類だけ引く。"""
    global _GGE
    if _GGE is not None:
        return _GGE
    out = {}
    for r in as_list(get_json(BADB.format("LogicEffect_NPC"))):
        dao = str(r.get("$type") or "").split(",")[0].split(".")[-1]
        g = r.get("GroupId")
        if not g:
            continue
        if dao == "GroggyGaugeEffectDAO":
            out[g] = ("groggy", r.get("Amount") or 0,
                      r.get("TargetCoefficientAmount") or 0,
                      r.get("CasterCoefficientAmount") or 0)
        elif dao == "AddCurrentATGEffectDAO":
            out[g] = ("atg", r.get("Amount") or 0, 0, 0)
    _GGE = out
    return out


def _gg_walk(o, path, out, pred):
    if isinstance(o, dict):
        if pred(o):
            out.append((path, o))
        for k, v in o.items():
            _gg_walk(v, path + "/" + k, out, pred)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            _gg_walk(v, path + "[%d]" % i, out, pred)


def tl_groggy(ex, stat_row, ph, ls_cache):
    """ボス自身の EX でグロッキーゲージが埋まるなら、その貯まり方を返す。無ければ None。

    **どのボスにも当たる形で書いてある。**探すのは「`GroggyGaugeEffectDAO` を配る
    Ability を持つ EX」で、ペロロジラを名指ししていない。
    """
    eff = _gg_effects()
    need_gauge = (stat_row or {}).get("GroggyGauge") or 0
    if not need_gauge:
        return None
    for i, nm in enumerate(ex or []):
        if nm not in ls_cache:
            try:
                ls_cache[nm] = get_json(BALS.format(nm))
            except Exception:
                ls_cache[nm] = {}
        d = ls_cache[nm] or {}
        hits = []
        _gg_walk(d, "", hits,
                 lambda o: str(o.get("$type") or "").endswith("AbilityDAO, BlueArchive"))
        lad, atg, tpl = [], None, None
        for p, ab in hits:
            # `MainEntityData` は `EntityTimeline[0]` の写し。二重に数えない
            if p.startswith("/MainEntityData"):
                continue
            gg = None
            for g in (ab.get("LogicEffectGroupIds") or []):
                e = eff.get(g)
                if not e:
                    continue
                if e[0] == "groggy":
                    gg = e[3] if e[3] else (e[1] or e[2])
                elif e[0] == "atg":
                    atg = e[1]
            if gg is None:
                continue
            cnt = None
            for m in (ab.get("Modifiers") or []):
                if "CountLogicEffectTemplateModifierDAO" in str(m.get("$type") or ""):
                    cnt, tpl = m.get("CountMin"), m.get("TemplateId")
            lad.append([cnt, gg])
        if not lad:
            continue
        lad = [x for x in lad if x[0] is not None]
        if not lad:
            continue
        lad.sort(key=lambda x: x[0])
        cap = max(x[0] for x in lad)
        step = next((v for c, v in lad if c == 1), None)
        # 貯める EX を撃つ通常攻撃の数（フェーズごと）
        # **`ev` は 1 周ぶんを繰り返して並べてある**（`TL_EV_LIMIT`）ので、
        # 同じ発数が何度も出る。数だけ要るので畳む
        at = {}
        for k, p2 in (ph or {}).items():
            ns = sorted({e[0] for e in (p2.get("ev") or []) if i in (e[2] or [])})
            if ns:
                at[k] = ns
        return {"ex": nm, "exi": i, "tpl": tpl, "lad": lad, "cap": cap, "step": step,
                "atg": atg, "atgMax": (stat_row or {}).get("ActiveGauge"),
                "need": 10000, "gauge": need_gauge,
                "sec": ((stat_row or {}).get("GroggyTime") or 0) / 1000.0,
                "at": at,
                "hit": (int(-(-10000 // (step * cap))) if step and cap else None)}
    return None


# **`DamageByHit`（攻撃を受ける度に出る追加ダメージ）の上限回数。**
# SchaleDB の `Effects` は `Icon: "DamageByHit_Damaged"` を持つだけで回数を持たない。
# 一次資料は `DB/LogicEffect_PC.json` の `DamageByHitEffectDAO` で、
# `RemoveCondition: 3` と対の `RemoveConditionArgument` がその回数。
# **`Duration` と `BonusRateFirst`（＝`Scale` の 1 段目）の対で結び付く**
# （2026-09-03 に 6 枠すべて 1 対 1 で当たることを確かめた。
#  ミユ Ex 120 ／ ミユ GearPublic 50 ／ メル Ex 480 ／ キララ GearPublic 100 ／
#  ノア（パジャマ）Ex 240 ／ スミレ（アルバイト）Ex 240。説明文の
#  「最大N回分まで適用されます」とも全部一致した）
_DBH = {}


def dbh_cap(e):
    """`DamageByHit` の上限回数。当たらなければ None。"""
    if "DamageByHit" not in str(e.get("Icon") or ""):
        return None
    if not _DBH:
        for r in as_list(get_json(BADB.format("LogicEffect_PC"))):
            if "DamageByHit" not in str(r.get("$type") or ""):
                continue
            if r.get("RemoveCondition") != 3 or not r.get("RemoveConditionArgument"):
                continue
            _DBH[(r.get("Duration"), r.get("BonusRateFirst"))] = r["RemoveConditionArgument"]
    sc = e.get("Scale") or []
    return _DBH.get((e.get("Duration"), sc[0] if sc else None))


# **蓄積（`Accumulation`）。**ワカモ（`CH0111`）とカンナ（`CH0170`）の 2 人だけ。
# SchaleDB の `Effects` は `{"Type": "Accumulation", "Scale": [...]}` しか持たず、
# **溜める秒数も取り込む割合も入っていない。**一次資料は `DB/LogicEffect_PC.json` の
#   `AccumulateEffectDAO`      … `Duration`（ms）・`AccumulateRate`（1 万分率）・
#                                 `LimitSourceStatRate`（＝ `Scale`。攻撃力に対する上限）
#   `AccumulateDamageEffectDAO` … 出すほうの弾。`BulletType: 5`（神秘）・
#                                 `CriticalCheck: 1`（会心なし）・`ApplyDefense` 無し
#                                 （`DefensePenetrationRate: 10000` ＝ 防御を全部貫く）
# で、`LimitSourceStatRate` が `Scale` と 1 対 1 に当たる（2026-09-03 に数えて確かめた）:
#   ワカモ  10 秒・100% ・上限 1017.21% / 1169.78% / 1322.34%
#   カンナ  15 秒・30〜50%・上限 2070% / 2380.5% / 2691%
_ACC = {}
_BT = {1: "Explosion", 2: "Pierce", 3: "Mystic", 4: "Sonic", 5: "Mystic"}


def acc_info(e):
    """`Accumulation` の [溜める ms, 段ごとの取り込み割合, 弾種]。当たらなければ None。"""
    if e.get("Type") != "Accumulation":
        return None
    if not _ACC:
        for r in as_list(get_json(BADB.format("LogicEffect_PC"))):
            ty = str(r.get("$type") or "")
            if "AccumulateEffectDAO" not in ty:
                continue
            if not r.get("LimitSourceStatRate"):
                continue
            _ACC[r["LimitSourceStatRate"]] = [r.get("Duration"), r.get("AccumulateRate")]
    sc = e.get("Scale") or []
    if not sc or sc[0] not in _ACC:
        return None
    dur, rates = _ACC[sc[0]][0], []
    for v in sc:
        rates.append((_ACC.get(v) or [None, 10000])[1] or 10000)
    # **弾種は出すほうの弾（`AccumulateDamageEffectDAO`）の `BulletType`。**
    # ワカモもカンナも 5（神秘）。カンナ自身は貫通なので、ここで上書きしないと外れる
    return [dur, rates, "Mystic"]


# **変身がいつ切れるか**（2026-09-04、61f）。`Skills.Normal.FormChange` は
# 効果とフレームを持っているが、**「いつからいつまでその形か」を持っていない。**
# 一次資料は `DB/LogicEffect_PC.json` の `FormConversionEffectDAO` で、
# `FormConversionEndCondition` が切れ方、`EndConditionArgument` がその値:
#   1 … 時間（ms）    シュン 30000 / ツルギ（水着）20000〜30000 / ウタハ（応援団）90000 /
#                     キララ 40000 / シロコ＊テラー 40000 / スバル 10000 /
#                     エイミ（臨戦）30000 / オトギ 35000 / ココロ -1（切れない）
#   2 … リロード回数  ツルギ 1〜2 / モモイ（メイド）1 / コトネ 1
#   3 … 装弾数       ノノミ（水着）100
#   5 … EX の使用回数 トキ 3  ← **60 で説明文から出した `fc = 3` と一致する**
# 行は `GroupId` が `<DevName>_Ex01_Effect0N` で、`Level` 1〜10。
# **EX のレベル N ＝ `Level` N**（ツルギ（水着）の説明文パラメータ
# `['20秒','20秒','25秒','25秒','30秒']` と 1〜5 が一致する）
_FCV = {}
# **通常スキルを使うと変身が終わる子**（2026-09-04、50b-3）。`fchg_of` の 3 番目。
# 見ているのは `DispelLogicEffectGroupIdEffectDAO` の `LogicEffectGroupIdToDispel` が
# その子の `FormConversionEffectDAO` の `GroupId` を指していて、**それを配っている
# スキルの `TriggerCondition` が `Event 3` ＋ `Parameters "Public"`（＝ NS 使用時）**
# のもの。**変身を消す行は全部で 3 本しか無く、当たるのは 1 人だけ**（2026-09-04 に数えた）:
#   CH0173     クルミ        CH0173_Ex01_Effect06        ← CH0173HiddenPassive04  Event 22 "Buff_TacticalShield"
#   CH0258_01  ホシノ（臨戦） CH0258_01_HiddenPassive01_Effect04 ← 同 HiddenPassive01  引き金なし
#   CH0337     エイミ（臨戦） CH0337_Ex01_Effect01        ← CH0337HiddenPassive02  Event 3 "Public"  ★
# エイミ（臨戦）の EX の説明文「ノーマルスキルの使用時、精密照準体勢を解除」がこれ。
# **`EndConditionArgument` は 30000（30 秒）のままだが、実際は NS で終わる。**
_FCNS = {}


def fchg_of(dev):
    """変身の切れ方 [条件, 段 1〜5 の値, NS で終わるか]。持っていなければ None。"""
    if not dev:
        return None
    if not _FCV:
        _le, _grp = as_list(get_json(BADB.format("LogicEffect_PC"))), {}
        for r in _le:
            if "FormConversionEffectDAO" not in str(r.get("$type") or ""):
                continue
            m = re.match(r"^(.*?)_(?:Ex|Public|HiddenPassive)\d+_Effect\d+$",
                         str(r.get("GroupId") or ""))
            if not m or not r.get("Level"):
                continue
            _grp[r["GroupId"]] = m.group(1)
            _FCV.setdefault(m.group(1), {})[int(r["Level"])] = [
                r.get("FormConversionEndCondition"), r.get("EndConditionArgument")]
        # **消す側は `_grp` が埋まってから。**変身を消す行は全部で 3 本しか無い
        for r in _le:
            if "DispelLogicEffectGroupIdEffectDAO" not in str(r.get("$type") or ""):
                continue
            tgt = r.get("LogicEffectGroupIdToDispel")
            if tgt not in _grp:
                continue
            m2 = _NS_SLOT.match(str(r.get("GroupId") or ""))
            if not m2 or m2.group(1) != _grp[tgt]:
                continue
            # **ホシノ（臨戦）の `CH0258_01HiddenPassive01` は 404**（枠の名前と
            # ファイル名が一致しない子がいる）。引けない札は「引き金なし」と同じ
            try:
                sk = get_json(BALS.format(m2.group(1) + m2.group(2) + m2.group(3))) or {}
            except urllib.error.HTTPError:
                continue
            tc = sk.get("TriggerCondition") or {}
            if tc.get("Event") == 3 and str(tc.get("Parameters") or "") == "Public":
                _FCNS[_grp[tgt]] = 1
    rows = _FCV.get(dev)
    if rows is None:
        for k in _FCV:
            if k.lower() == dev.lower():
                rows = _FCV[k]
                break
    if not rows:
        return None
    cond = rows.get(1, [None, None])[0]
    return [cond, [(rows.get(i) or [None, None])[1] for i in range(1, 6)],
            _FCNS.get(dev, 0)]


# **「特定の効果が乗ったとき」の NS を、通常攻撃の回数へ解く**（2026-09-04、50b-2）。
# `AutoUseRule` の `ConditionType` が `HitLogicEffectTemplateId` /
# `HitLogicEffectGroupId` のものは、**引き金が札の名前なので周期が出ない。**
# 12 行あるうち、**「変身している間の通常攻撃 N 発目」に解けるのは 1 行だけ**
# （エイミ（臨戦）`CH0337Public01`。2026-09-04 に 12 行すべてを辿って数えた）。
#
# 辿り方は 3 段:
#   ① `LogicEffect_PC.json` の `TemplateId` → `GroupId`
#      （`Dummy_CH0337_UsePublicCheck` → `CH0337_HiddenPassive01_Effect06`）
#   ② `GroupId` の形 `<DevName>_<枠><NN>_Effect<MM>` から
#      `LevelSkill/<DevName><枠><NN>.json` を開く
#   ③ その `EntityTimeline[].Entity.Abilities` のうち `LogicEffectGroupIds` に
#      `GroupId` を持つものの `CountLogicEffectTemplateModifierDAO.CountMin` が回数
#
# **採るのは `TriggerCondition.Event` が 34（通常攻撃ごと）で
# `ConditionExpression` に `GetFormIndex()` があるものだけ。**エイミ（臨戦）は
# `Event 34` ＋ `"GetFormIndex() = 1"` ＋ `CountMin 4` で、スキル文の
# 「精密照準体勢を維持したまま通常攻撃4回時」と合う。
# 残り 11 行の内訳（**どれも時刻が決まらないので None のまま**）:
#   ウイ（水着）    `CH0204ExtraPassive01`   Event 3  CountMin 無し
#   ヒカリ          `CH0242ExtraPassive01`   Event 24 CountMin 無し
#   キキョウ（水着） `CH0300Ex01`             Event 無し
#   レイサ（マジカル）`CH0326Ex01`             Event 無し（CountMin 0）
#   ヤクモ          `CH0228HiddenPassive01`  Event 24 CountMin 0（お金の数）
#   ケイ            `CH0335Ex01`             Event 無し（札は 1000ms の Dummy）
#   クルミ          `CH0173HiddenPassive02`  Event 301 `GetCurrentBehavior() ==
#                                            [BehaviorType.ReleaseFormConversion]`
#   エリカ          `CH0076HiddenPassive02`  Event 24 CountMin 無し
#   オトギ          `CH0174_DummyValueToNotTrigger`（発動しない札。50c で外した）
_NSC = {}
_NSC_TPL = {}
_NS_SLOT = re.compile(r"^(.+?)_(Ex|Public|GearPublic|HiddenPassive|ExtraPassive"
                      r"|Passive|WeaponPassive)(\d*)_Effect")


def ns_count(dev, ct, arg):
    """「変身している間の通常攻撃 N 発目」。解けなければ None。"""
    if not dev or not arg or "LogicEffect" not in str(ct or ""):
        return None
    key = (dev, arg)
    if key in _NSC:
        return _NSC[key]
    if not _NSC_TPL:
        for r in as_list(get_json(BADB.format("LogicEffect_PC"))):
            t = r.get("TemplateId")
            if t:
                _NSC_TPL.setdefault(t, set()).add(r.get("GroupId"))
    out = None
    for g in sorted(y for y in (_NSC_TPL.get(arg) or {arg}) if y):
        m = _NS_SLOT.match(g)
        if not m or m.group(1) != dev:
            continue
        try:
            sk = get_json(BALS.format(m.group(1) + m.group(2) + m.group(3))) or {}
        except urllib.error.HTTPError:
            continue
        tg = sk.get("TriggerCondition") or {}
        if tg.get("Event") != 34:
            continue
        if "GetFormIndex" not in str(tg.get("ConditionExpression") or ""):
            continue
        for ent in (sk.get("EntityTimeline") or []):
            for ab in ((ent.get("Entity") or {}).get("Abilities") or []):
                if g not in (ab.get("LogicEffectGroupIds") or []):
                    continue
                for md in (ab.get("Modifiers") or []):
                    if "CountLogicEffectTemplateModifier" not in str(md.get("$type") or ""):
                        continue
                    if (md.get("CountMin") or 0) > 0:
                        out = md["CountMin"]
    _NSC[key] = out
    return out


# LevelSkill の中身を 1 回だけ落とすための入れ物（湧く体の数を数えるのに使う）
_ls_cache = {}
# 「味方N人」の相手選びの規則を 1 回だけ落とすための入れ物（2026-09-04）
_tsel_cache = {}


def build_tl():
    """TL エディタが読むボスの行動。**いまは総力戦だけ**（大決戦とワールドレイドは
    ID の付き方が違って、ビヘイビアツリーが引けない枠が多い。2026-08-31 の判断）。"""
    print("TL エディタ（ボスの行動）")
    bt = {}
    for r in as_list(get_json(BADB.format("BossExternalBTExcelTable"))):
        bt.setdefault(r["ExternalBTId"], []).append(r)
    csl_rows = as_list(get_json(BADB.format("CharacterSkillListExcelTable")))
    csl = {r["CharacterSkillListGroupId"]: r for r in csl_rows}
    # **生徒は 1 人につき最大 8 行ある**（愛用品の段と固有武器の星で分かれる）。
    # 通常スキル(NS)の周期を引くのに、行ごとの Public を全部拾う
    csl_all = {}
    for r in csl_rows:
        csl_all.setdefault(r["CharacterSkillListGroupId"], []).append(r)
    stat = {r["CharacterId"]: r
            for r in as_list(get_json(BADB.format("CharacterStatExcelTable")))}
    # 固有武器の星ごとの追加ステータス（★3 が地形適性、★4 がその他）
    _cweapon = {r["Id"]: r
                for r in as_list(get_json(BADB.format("CharacterWeaponExcelTable")))}
    # **登場に 20 フレームかかる**（ビナー。`AppearFrame`）。実物の TL の時刻と
    # 突き合わせると、これを足したほうが 1 本目の 29.0 秒に近づいた（2026-08-31）
    appear = {r["Id"]: r.get("AppearFrame")
              for r in as_list(get_json(BADB.format("CharacterExcelTable")))}
    cool = {}
    for r in as_list(get_json(BADB.format("SkillExcelTable"))):
        g = r.get("GroupId")
        if not g or g in cool:
            continue
        a, c = r.get("EnemyStartCoolTime") or 0, r.get("EnemyCoolTime") or 0
        if a or c:
            cool[g] = [a, c]
    raids = get_json(SD.format("raids"))
    rsk = raids.get("RaidSkills") or {}
    # グロッキーゲージの溜まり方（ボスごとの文）。キーはボスの DevName
    _groggy_loc = (get_json(SD.format("localization")).get("GroggyCondition") or {})
    # ステータスの日本語名。**画面で「誰の何のバフか」を出すのに使う**（2026-09-01）
    stat_ja = get_json(SD.format("localization")).get("Stat") or {}
    # ---- ダメージ計算に要る表。**どれも DB/ の実物から取る**（2026-09-01）
    ch_all = {r["Id"]: r for r in as_list(get_json(BADB.format("CharacterExcelTable")))}
    # 特効（弾種 × 装甲）。DamageFactorGroupId は "default" だけ
    bam = {}
    for r in as_list(get_json(BADB.format("BulletArmorDamageFactorExcelTable"))):
        if r.get("DamageFactorGroupId") != "default":
            continue
        bam.setdefault(r["BulletType"], {})[r["ArmorType"]] = [
            r["DamageRate"], r.get("MinDamageRate") or 0, r.get("MaxDamageRate") or 0]
    # 地形適性。Street/Outdoor/Indoor の 3 つとも同じ値なので 1 枚に畳む
    ter, ter_same = {}, True
    for r in as_list(get_json(BADB.format("TerrainAdaptationFactorExcelTable"))):
        v = [r["ShotFactor"], r["BlockFactor"], r["AttackPowerFactor"]]
        k = r["TerrainAdaptationStat"]
        if k in ter and ter[k] != v:
            ter_same = False
        ter[k] = v
    if not ter_same:
        raise SystemExit("TerrainAdaptationFactorExcelTable が地形ごとに違う値になった。畳めない")
    # 総力戦の支援値（SPECIAL → STRIKER）。万分率
    trans = {}
    for r in as_list(get_json(BADB.format("CharacterStatsTransExcelTable"))):
        if r.get("StatTransType") != "SpecialTransStat":
            continue
        trans.setdefault(r.get("EchelonExtensionType") or "Base", {})[
            r["TransSupportStats"]] = r["TransSupportStatsFactor"]
    # 敵のレベル（レベル差補正に要る）。RaidStage の GroundId → Ground の LevelBoss
    ground = {r["Id"]: r for r in as_list(get_json(BADB.format("GroundExcelTable")))}
    # **総力戦は「ボス × 地形」で別物。**同じボスでも屋内と市街地では敵の ID も HP も
    # 違い、地形適性でダメージが変わる。2026-09-01 まで SchaleDB の `Raid.EnemyList`
    # から作っていて、**ヒエロニムスが Insane まで屋内・Torment から市街地**という
    # ちぐはぐな並びになっていた（EnemyList に両方が入っていて、先に引けたほうを
    # 採っていた）。ビナー市街地・ケセド屋外・ホド屋内・シロクロ屋内・ゴズ屋外・
    # ペロロジラ屋外・カイテンジャー屋内は**丸ごと選べなかった。**
    # `RaidBossGroup` で割ると 14 体 → 22 通りになる
    TER_JA = {"Street": "市街地", "Outdoor": "屋外", "Indoor": "屋内"}
    # **大決戦は「装甲を選べる総力戦」。**表は別（`EliminateRaidStageExcelTable`）で
    # `RaidBossGroup` が `Binah_Outdoor_HeavyArmor` の形。
    # **中身は装甲以外まったく同じ**——`DevName` の「素の名前＋難易度」で束ねて
    # 1,168 組・1,100 回突き合わせて**不一致 0**（HP・攻撃・防御・会心抵抗・
    # 会心ダメージ抵抗・グロッキー・安定・命中・回避・地形適性・防御貫通抵抗）。
    # スコアの 4 定数も同じ（2026-09-01 に確かめた）。
    # だから枝は「ボス × 地形」のまま増やさず、**装甲だけを選べるようにする**。
    # 地形の組み合わせは大決戦のほうが多い（ケセド屋内・カイテンジャー屋外・
    # シロクロ市街地・ペロロジラ屋内・ゴズ屋内は大決戦にしか無い）
    ARMORS = ["LightArmor", "HeavyArmor", "Unarmed", "ElasticArmor"]
    TERRS = ("Street", "Outdoor", "Indoor")

    def _grp_base(g0):
        """`RaidBossGroup` から装甲と地形を落として「ボスの素の名前」を返す。"""
        q = (g0 or "").split("_")
        if len(q) > 1 and q[-1] in ARMORS:
            q = q[:-1]
        if len(q) > 1 and q[-1] in TERRS:
            q = q[:-1]
        return "_".join(q)

    stage_rows = as_list(get_json(BADB.format("RaidStageExcelTable")))
    elim_rows = as_list(get_json(BADB.format("EliminateRaidStageExcelTable")))
    grp, grp_arm = {}, {}
    for _rows, _elim in ((stage_rows, False), (elim_rows, True)):
        for r in _rows:
            g0 = r.get("RaidBossGroup")
            if not g0:
                continue
            g = ground.get(r.get("GroundId")) or {}
            env = g.get("StageTopography")
            # **枝の名前は「素の名前＋地形」に揃える。**総力戦の `Binah` と
            # 大決戦の `Binah_Outdoor` は同じ枝
            key = _grp_base(g0) + ("_" + env if env else "")
            df = r.get("Difficulty", "")
            cids = [c for c in ([r.get("RaidCharacterId")]
                                + list(r.get("BossCharacterId") or [])) if c]
            if _elim:
                # 装甲だけ覚える。ステータスは総力戦と同じなので枝は増やさない
                arm = (g0.split("_") or [""])[-1]
                if arm in ARMORS:
                    grp_arm.setdefault(key, {}).setdefault(df, {})[arm] = cids
            # **同じ枝に同じ難易度が 2 度来ることがある**（総力戦の `Goz` と
            # `Goz_Outdoor` は `RaidCharacterId` まで同じ）。先に来たほうを使う
            if key in grp and any(x["df"] == df for x in grp[key]):
                continue
            # スコア。**1 秒あたりの減点は `PerSecondMinusScore` の 1/10**
            # （根拠は build_raid_score のコメント。同じ表・同じ列を読んでいる）
            ps_raw = r.get("PerSecondMinusScore") or 0
            if ps_raw % 10:
                raise SystemExit(f"PerSecondMinusScore が 10 で割り切れない: {r.get('Id')} {ps_raw}")
            sc = None
            if r.get("DefaultClearScore"):
                sc = [r["DefaultClearScore"], r.get("HPPercentScore") or 0,
                      ps_raw // 10, r.get("MaximumScore") or 0]
            grp.setdefault(key, []).append({
                "df": df, "cids": cids,
                # **枝にボスが 2 体いることがある**（シロ＆クロ、カイテンジャー、
                # ホバークラフトの前半・後半）。`RaidCharacterId` がその 2 体と
                # 別 id なら、それは HP を合算した「集計」の行
                "boss": [c for c in (r.get("BossCharacterId") or []) if c],
                "agg": (r.get("RaidCharacterId")
                        if r.get("RaidCharacterId") not in (r.get("BossCharacterId") or [])
                        else None),
                "lv": g.get("LevelBoss"), "env": env,
                "ext": r.get("EchelonExtensionType") or "Base", "sc": sc,
                "dur": (r.get("BattleDuration") or 0) // 1000,
                # **盤のファイル**（2026-09-04、第 1 段）。`StageFileName` は
                # 3 本（素・`_start2phase`・`_start3phase`）で、
                # **座標は 3 本とも同じ**なので先頭だけを見る
                "stage": ((g.get("StageFileName") or [None]) or [None])[0],
            })
    # `RaidBossGroup` の綴りは Raid の DevName と揃っていない
    # （カイテンジャー・ホバークラフトで外れる。build_raid_score と同じ）
    GRP_ALIAS = {"kaitenger": "kaitenfxmk0", "hovercraft": "raidhovercraft"}
    raid_by_dev = {}
    for r in raids.get("Raid") or []:
        if r.get("DevName"):
            raid_by_dev[r["DevName"].lower()] = r
    grp_base = {}
    for g0 in grp:
        b0 = g0.split("_")[0].lower()
        grp_base[g0] = raid_by_dev.get(GRP_ALIAS.get(b0, b0)) or raid_by_dev.get(b0)
    lost = sorted(g for g0, v in grp_base.items() if not v for g in [g0])
    if lost:
        raise SystemExit(f"Raid の DevName に結び付かない RaidBossGroup: {lost}")
    # 同じボスの枝が 2 つ以上あるときだけ、名前に地形を添える
    n_of_base = {}
    for g0, rd in grp_base.items():
        n_of_base[rd["Id"]] = n_of_base.get(rd["Id"], 0) + 1
    # SchaleDB の Raid の並び（＝実装順）を保って、その中で枝を並べる
    grp_order = []
    for rd in raids.get("Raid") or []:
        for g0 in sorted(grp, key=lambda x: (len(x), x)):
            if grp_base[g0] is rd:
                grp_order.append(g0)
    print(f"  特効 {sum(len(v) for v in bam.values())} 組／地形 {len(ter)} 段／"
          f"支援値 {len(trans)} 種／ボスの枝 {len(grp)} 通り "
          f"（{sum(len(v) for v in grp.values())} 段）")

    # ---- 部位（パーツ）。**同じ Ground の中で、ボス以外の行**
    # id は「Ground の 7 桁 ＋ 通し 2 桁」なので、下 2 桁を落とすと同じ枝が並ぶ
    # （総力戦は 7 桁 ＝ 5 桁＋2 桁）。名前は `LocalizeEtcExcelTable` の `NameJp`、
    # `LocalizeError` のときは SchaleDB の `enemies` に同じ役どころの行があれば
    # そちらの日本語名を使う（ホドの柱＝インベイドピラーがこれ）
    _loc_etc = {r.get("Key"): r for r in
                as_list(get_json(BADB.format("LocalizeEtcExcelTable")))}
    _by_pre = {}
    for _cid in stat:
        _by_pre.setdefault(str(_cid)[:-2], []).append(_cid)
    # **部位の出どころは `raids.json` の `EnemyList`**（LOOP.md 63、2026-09-03）。
    # 難易度ごとの並びで、**先頭が本体・2 体目以降が部位**。
    # id の頭で引く `_by_pre` は、本体と部位で頭が違う枝を拾えない
    # （Lunatic ペロロジラは 本体 `7405800` に対してミニオンが `7305801` `7305890`）。
    # ここを正本にすると、prefix の当て推量に頼らずに済む
    _elist, _bodies = {}, set()
    for _r in ((raids.get("Raid") or []) + (raids.get("MultiFloorRaid") or [])):
        for _ids in (_r.get("EnemyList") or []):
            if _ids:
                _elist.setdefault(_ids[0], []).extend(_ids[1:])
                _bodies.add(_ids[0])
    # **`EnemyList` の並びは難易度の順。**`EnemyList[i][0]` の `DevName` が
    # i 番目の難易度で終わることを、`Raid` 14 本・110 段ぜんぶで数えて確かめた
    # （2026-09-04。外れ 0 件）。
    # **同じ Raid でも地形の枝が違うと本体の id が違う**ので、本体の id では引けない。
    #   ペロロジラ屋外 Hard は `7405200 Perorozilla_Outdoor_Hard`、
    #   `EnemyList[1]` の先頭は `7305200 Perorozilla_default_Hard`
    # `7405xxx` の枝には**部位の行が 1 つも無い**（8 段のボス本体だけ。
    # `CharacterExcelTable` を数えた）ので、部位は `7305xxx` から借りるしかない。
    # 難易度で引けるようにして、prefix の当て推量に頼らずに済ませる
    _EL_DIFF = ["Normal", "Hard", "VeryHard", "HardCore", "Extreme",
                "Insane", "Torment", "Lunatic"]
    _elist_df = {}
    for _r in (raids.get("Raid") or []):
        for _i, _ids in enumerate(_r.get("EnemyList") or []):
            if _ids and _i < len(_EL_DIFF):
                _elist_df.setdefault((_r.get("Id"), _EL_DIFF[_i].lower()),
                                     []).extend(_ids[1:])

    def _el_cand(ids):
        """`EnemyList` の部位の id を、同じ prefix の兄弟ごと候補にする。
           **同じ番号帯には別難易度のボス本体も並んでいる**ので、
           `EnemyList` の先頭に出てくる id は全部よける（`_bodies`）。"""
        out = []
        for _eid in ids:
            for _k in (_by_pre.get(str(_eid)[:-2], []) or [_eid]):
                if _k not in _bodies:
                    out.append(_k)
        return out

    def _dev_role(dn):
        """`Hod_TemporaryTower_Summon_HeavyArmor_Torment` → `hod_temporarytower_summon`"""
        q = [x for x in (dn or "").split("_")
             if x not in ARMORS and x not in TERRS
             and x not in ("Normal", "Hard", "VeryHard", "Hardcore", "Extreme",
                           "Insane", "Torment", "Lunatic", "default")]
        return "_".join(q).lower()

    _enemies = get_json(SD.format("enemies")).get("Enemies") or {}
    if isinstance(_enemies, list):
        _enemies = {str(e["Id"]): e for e in _enemies if e.get("Id")}
    _sd_name = {}
    for _e in (_enemies or {}).values():
        if _e.get("Name") and _e.get("DevName"):
            _sd_name.setdefault(_dev_role(_e["DevName"]), _e["Name"])
    # **末尾の役どころを 1 つ落とした形も引けるようにする。**
    # `en0005_choir_center` は enemies にあるが `_left` `_right` は無い。
    # **同じ短縮形に別の名前がぶら下がるときは登録しない**（取り違えるので）
    _sd_short = {}
    for _k, _v in _sd_name.items():
        _q = _k.split("_")
        if len(_q) > 1:
            _sd_short.setdefault("_".join(_q[:-1]), set()).add(_v)
    for _k, _v in _sd_short.items():
        if len(_v) == 1 and _k not in _sd_name:
            _sd_name[_k] = next(iter(_v))

    # 末尾に付く役どころの言い換え。**当てはまらない語はそのまま出す**
    _SUF_JA = {"summon": "召喚", "left": "左", "right": "右", "center": "中央",
               "cannon": "砲台", "railgun": "レールガン", "move": "移動",
               "boss": "本体", "front": "前", "back": "後"}

    def _pname(cid):
        c = ch_all.get(cid) or {}
        # SchaleDB の enemies は敵 Id そのものが鍵で、部位名（「フンドシ（フェーズ1）」
        # 「インベイドピラー」）まで入っている。DevName 経由より当たりが良いので先に見る
        nm = (_enemies.get(str(cid)) or {}).get("Name")
        if nm:
            return nm
        l = _loc_etc.get(c.get("LocalizeEtcId")) or {}
        nm = l.get("NameJp")
        if nm and nm != "LocalizeError":
            return nm
        _r = _dev_role(c.get("DevName"))
        nm = (_sd_name.get(_r) or _sd_name.get(re.sub(r"\d+$", "", _r))
              or _sd_name.get(re.sub(r"\d+$", "", _r) + "01"))
        if nm:
            return nm
        # **末尾の役どころを 1 つずつ落として引き直す。**
        # `EN0005_choir_Torment_Left` は enemies に無いが `_Center` はあり、
        # 中身は同じ聖歌隊。落とした語は括弧で添えて、どれか分かるようにする
        q = _r.split("_")
        tail = []
        # **落とすのは末尾 2 つまで。**それ以上削ると
        # `en0005_choir_left` が `en0005`（グレゴリオ本体）に化ける
        while len(q) > 1 and len(tail) < 2:
            tail.insert(0, q.pop())
            base = "_".join(q)
            nm = (_sd_name.get(base) or _sd_name.get(re.sub(r"\d+$", "", base))
                  or _sd_name.get(re.sub(r"\d+$", "", base) + "01"))
            if nm:
                lab = "・".join(_SUF_JA.get(t.lower(), t) for t in tail)
                return nm + "（" + lab + "）"
        return c.get("DevName") or str(cid)

    def _subs_df(cid, df, skip):
        """**難易度ごとに別の枝へ並んでいる部位。**グレゴリオのパイプオルガンは
        `EN0005_Subpipe_Torment` = 7309126 で、Normal の番号（73091xx）に 8 難易度ぶんが
        並んでいる。Torment の枝（73097xx）を prefix で引く `_subs` からは見えず、
        **オルガンを撃ったぶんがボス本体への直撃として満額数えられていた**
        （2026-09-03、TL の「(オルガン+1体)」「（オルガン抜き）」で気づいた）。
        DevName が同じ頭で始まり `_<難易度>` で終わるものだけを足す。"""
        dev0 = ((ch_all.get(cid) or {}).get("DevName") or "").split("_")[0]
        if not dev0:
            return []
        out = []
        for k, c in ch_all.items():
            if k in skip or k == cid:
                continue
            dn = c.get("DevName") or ""
            if not dn.startswith(dev0 + "_") or not dn.endswith("_" + df):
                continue
            # **同じボスの番号の family だけ**（先頭 4 桁）。これが無いと
            # 「DevName の頭が同じで難易度が同じ」だけで別地形・別装甲の枝まで
            # 拾い、部位の行が 920 → 1,802 に倍増した（2026-09-03 に実測）
            if str(k)[:4] != str(cid)[:4]:
                continue
            if not (stat.get(k) or {}).get("MaxHP1"):
                continue
            out.append(k)
        return out

    def _subs_extra(cid, skip, cand):
        """`_subs_df` が拾った候補のうち、**その枝にまだ無い役どころだけ**を残す。
        これが無いと、同じ役どころの別装甲・別地形の行まで並んで部位が倍増する
        （2026-09-03、クロカゲ 24 → 96 行になった）。グレゴリオのパイプオルガンの
        ように「その枝に 1 行も無い部位」だけを足すのが目的"""
        have = set()
        for k in _by_pre.get(str(cid)[:-2], []):
            if k in skip or k == cid:
                continue
            have.add(re.sub(r"\d+$", "",
                            _dev_role((ch_all.get(k) or {}).get("DevName"))))
        out = []
        for k in cand:
            r0 = re.sub(r"\d+$", "", _dev_role((ch_all.get(k) or {}).get("DevName")))
            if r0 and r0 not in have:
                out.append(k)
        return out

    def _subs(cid, skip, extra=()):
        """その枝の部位。`skip` はボス本体と集計行の id。
           **同じ中身の行は畳む**（ペロロジラの中型 30 体は 1 行にする）
           `extra` は難易度ごとに別の枝へ並んでいる部位（`_subs_df`）"""
        out, seen = [], {}
        for k in sorted(set(_by_pre.get(str(cid)[:-2], [])) | set(extra)):
            if k in skip or k == cid:
                continue
            c = ch_all.get(k) or {}
            sr = stat.get(k) or {}
            if not sr.get("MaxHP1"):
                continue
            # **畳むのは「同じ役どころの連番」だけ。**末尾の数字を落とした
            # 役どころ名まで見ないと、ドラム缶ガニのフンドシと船体のように
            # HP と防御がたまたま同じ別物まで 1 行になる
            _role = re.sub(r"\d+$", "", _dev_role(c.get("DevName")))
            _key = (_role, sr.get("MaxHP1"), sr.get("DefensePower1"),
                    c.get("ArmorType"), c.get("TacticEntityType"))
            if _key in seen:
                _p = out[seen[_key]]
                _p["cnt"] = _p.get("cnt", 1) + 1
                # 日本語名が後から出てきたらそちらを採る
                if _p["n"] == _p["dn"]:
                    _nm = _pname(k)
                    if _nm != c.get("DevName"):
                        _p["n"] = _nm
                continue
            seen[_key] = len(out)
            out.append({
                "id": k, "n": _pname(k), "dn": c.get("DevName"),
                "k": c.get("TacticEntityType") or "", "hp": sr.get("MaxHP1"),
                "def": sr.get("DefensePower1"), "armor": c.get("ArmorType"),
                # **部位にも素の被ダメージ率がある**（2026-09-04）。本体では
                # `bs.damaged` として読んでいたのに、部位では落ちていた。
                # `DB/CharacterStatExcelTable.json` の `DamagedRatio` そのもの。
                #   Hieronymus_HolyRelic_Torment      2000（＝ 1.8 倍）
                #   Hod_TemporaryTower_*             18000（＝ 0.2 倍）
                #   EN0013_Original_RightHand01_*    19900（＝ 0.01 倍）
                #   Resort_Outdoor_HeavyArmor_*      20000（＝ 0.0 倍）
                #   EN0022_Original_01_Body_*_Torment 15000（＝ 0.5 倍）
                # **画面の計算には掛けていない**（`dmg.js` の `dbase` は本体と同じく
                # `dmgOnly` のボスだけ）。ホド・ヒエロニムス・イェソドの本体で
                # 素の値が効いていない理由が分かっていないのと同じ理由で、
                # 部位だけ先に掛けると辻褄が合わなくなる
                "damaged": sr.get("DamagedRatio"),
                "size": c.get("Size") or (_enemies.get(str(k)) or {}).get("Size"),
                "stab": sr.get("StabilityPoint"), "stabR": sr.get("StabilityRate"),
                "dodge": sr.get("DodgePoint"),
                "crR": sr.get("CriticalResistPoint"),
                "cdR": sr.get("CriticalDamageResistRate"),
                "defpr": sr.get("DefensePenetrationResist1") or 0,
                "ad": [sr.get("StreetBattleAdaptation"),
                       sr.get("OutdoorBattleAdaptation"),
                       sr.get("IndoorBattleAdaptation")],
            })
        return out

    # 同じボスの別地形。**部位が片方の枝にしか無いことがある**
    # （ホドのインベイドピラーは市街地の番号にしか無いが、屋内の TL も柱を撃つ）
    _sib = {}
    for _g in grp:
        _sib.setdefault(_grp_base(_g), []).append(_g)

    # ---- ギミックの候補。**ボスの被ダメージ率などを動かす行を、説明文から拾う**
    # （2026-09-01）。`Raid[].RaidSkillList[難易度]` がスキル名の並びで、
    # 実体は `RaidSkills`（名前が鍵）。`<d:DamagedRatio>が300%増加（30秒間）` の形を
    # 読んで「ボスの状態」の窓に入れる候補にする。**自動では効かせない。**
    # いつ入るかは TL 次第なので、秒は画面で先生が指定する
    GIM_K = {"DamagedRatio": "damaged",
             "CriticalChanceResistPoint": "crR",
             "CriticalDamageResistRate": "cdR",
             "DEF": "def"}
    # **`<d:DamagedRatio>` のようなタグが値そのもの**なので、先に中身を残して開く。
    # 素朴に全部のタグを消すと `が300%増加` だけが残って何のことか分からなくなる
    _gim_stat = re.compile(r"<[bdcs]:([A-Za-z_]+)>")
    _gim_tag = re.compile(r"<[^>]*>")
    _gim_pat = re.compile(
        r"(DamagedRatio|CriticalChanceResistPoint|CriticalDamageResistRate|DEF)"
        r"[をがはのにより、\s]*([\d,]+)\s*(%?)\s*(増加|減少)")
    _gim_dur = re.compile(r"[（(](\d+)秒間[）)]")
    _gim_cache = {}

    def _dmg_only(rd, df):
        """「この効果以外の DamagedRatio の増加効果を無効化」を持つか（ケセドの剥き出しの玉座）。"""
        lst = rd.get("RaidSkillList") or []
        di = next((i for i, x in enumerate(TL_DIFF) if x.lower() == (df or "").lower()), None)
        if di is None or di >= len(lst):
            return False
        for nm in lst[di] or []:
            desc = (rsk.get(nm) or {}).get("Desc") or ""
            if "この効果以外" in desc and "DamagedRatio" in desc and "無効" in desc:
                return True
        return False

    # **味方側の「段階」バフ。**イェソドの「啓示」だけが持つ形で、灯火を壊すたびに
    # 分析段階が 1 上がり、1 段階ごとに味方ストライカーの ATK が増える。
    # `_gim` はボス側の窓しか拾わない（味方あての行は捨てる）ので、別に取る。
    # **取るのは原文に数字で書いてある分だけ**（憶測で埋めない）。画面側はこれを
    # 「ボスの被ダメージ率」の窓で代用する（味方側の窓が道具に無いため。2026-09-03）
    _stg_atk = re.compile(r"1段階ごとに.{0,60}?ATKを(\d+)%増加")
    _stg_max = re.compile(r"最大(\d+)段階")
    _stg_cr = re.compile(r"会心率を(\d+)%増加")

    def _stg(rd, df):
        lst = rd.get("RaidSkillList") or []
        di = next((i for i, x in enumerate(TL_DIFF) if x.lower() == (df or "").lower()), None)
        if di is None or di >= len(lst):
            return None
        for nm in lst[di] or []:
            sk = rsk.get(nm) or {}
            for ln in (sk.get("Desc") or "").split("\n"):
                txt = _gim_tag.sub("", _gim_stat.sub(r"\1", ln)).strip()
                ma = _stg_atk.search(txt)
                if not ma:
                    continue
                mx = _stg_max.search(txt)
                mc = _stg_cr.search(txt)
                return {"n": "分析段階" if "分析段階" in (sk.get("Desc") or "") else "段階",
                        "sk": sk.get("Name") or nm, "atk": int(ma.group(1)),
                        "cr": int(mc.group(1)) if mc else 0,
                        "max": int(mx.group(1)) if mx else 5, "t": txt}
        return None

    # **グロッキー中にボスが複数体に分かれる。**2026-09-03 に未検証の 5 体を測ったら
    # 全部が同じ向き（道具が 10〜25 倍低い）に外れていて、`RaidSkills` の本文を読んだら
    # 同じ仕組みだった。**範囲攻撃がその全部に当たり、被ダメージが 100% 本体へ移る。**
    #
    #   ペロロジラ  グロッキー状態になると、小さなペロロミニオンを5体召喚
    #               小さなペロロミニオンはImmortalでその被ダメージの100%分をペロロジラに転移
    #   クロカゲ    クロカゲの領域内でグロッキー状態になればクロカゲは4つの片鱗に別れ、
    #               それぞれ攻撃を受けることになり、その間はすべての味方の会心率が最大値まで増加
    #   ゴズ        自身と同じ動きをする分身2体と共に登場（こちらはグロッキーではなく EX）
    #
    # **体数は本文に書いてある**ので、人に置かせない。ここでは数だけ出して、
    # 画面側が「グロッキー中は当たる数が N」として使う。
    _SPL = [
        re.compile(r"(\d+)\s*体召喚"),
        re.compile(r"(\d+)\s*つの[^、。]{0,8}に別れ"),
        re.compile(r"分身\s*(\d+)\s*体"),
    ]

    def _gspl(rd, df):
        """`{"n": 体数, "gg": グロッキー中か, "t": 原文}` か None。"""
        lst = rd.get("RaidSkillList") or []
        di = next((i for i, x in enumerate(TL_DIFF) if x.lower() == (df or "").lower()), None)
        if di is None or di >= len(lst):
            return None
        best = None
        for nm in lst[di] or []:
            sk = rsk.get(nm) or {}
            for ln in (sk.get("Desc") or "").split("\n"):
                txt = _gim_tag.sub("", _gim_stat.sub(r"\1", ln)).strip()
                if not txt:
                    continue
                for rx in _SPL:
                    m = rx.search(txt)
                    if not m:
                        continue
                    n = int(m.group(1))
                    if not (2 <= n <= 12):
                        continue
                    gg = "グロッキー" in txt
                    # **グロッキー中のほうを採る。**分身のように常時のものより、
                    # 削りに効くのはグロッキー中に分かれるほう
                    if best is None or (gg and not best["gg"]):
                        best = {"n": n, "gg": gg, "t": txt[:120]}
        return best

    def _gim(rd, df):
        """そのボス・その難易度で、ボス側の被ダメージ率などを動かす行を返す。"""
        lst = rd.get("RaidSkillList") or []
        di = next((i for i, x in enumerate(TL_DIFF) if x.lower() == (df or "").lower()), None)
        if di is None or di >= len(lst):
            return []
        ck = (id(rd), di)
        if ck in _gim_cache:
            return _gim_cache[ck]
        out, seen = [], set()
        bnm = rd.get("Name") or ""
        for nm in lst[di] or []:
            sk = rsk.get(nm) or {}
            # **「味方1人に対して…／また DEF を 9,999 減少」のように、行をまたいで
            # 相手が続くことがある。**（ペロロジラの白熱眼光・ビナーの浄化の嵐）。
            # 味方が出てきたら、ボスの名前が出てくるまでその説明は味方あて扱いにする
            ally = False
            # **色は行をまたいで効いている。**ヒエロニムスの「不浄なる光」は
            # 「紫色の聖遺物の場合、…」の次の行に「さらに、ヒエロニムスのDEFを1,500減少」
            # と続く。色を覚えておかないと、緑の壺と紫の壺のどちらの窓かが分からない
            # （2026-09-03、総力戦ヒエロニムス。TL の「(緑壺)」「(紫壺)」から窓を置くのに要る）
            col = None
            for ln in (sk.get("Desc") or "").split("\n"):
                txt = _gim_tag.sub("", _gim_stat.sub(r"\1", ln)).strip()
                if not txt:
                    continue
                mcol = re.search(r"([緑紫赤青黄白黒])色", txt)
                if mcol:
                    col = mcol.group(1)
                # **ボスの名前は「シロ＆クロ」のように 2 体ぶんが 1 つになっている。**
                # 片方の名前（「シロに跳ね返り」「クロ自身が」）が出てもボスあてに戻す
                # （2026-09-02。シロクロの被ダメージ率 +50% が gim に出ていなかった）
                if bnm and (bnm in txt or any(p and p in txt for p in re.split(r"[＆&・/／]", bnm))):
                    ally = False
                if "自身" in txt:
                    ally = False
                if any(w in txt for w in ("味方", "チーム", "生徒", "レイバー")):
                    ally = True
                    continue
                if ally:
                    continue
                for m in _gim_pat.finditer(txt):
                    k = GIM_K.get(m.group(1))
                    if not k:
                        continue
                    v = int(m.group(2).replace(",", ""))
                    if m.group(4) == "減少":
                        v = -v
                    # **秒はすぐ後ろに書いてある**（「300%増加（30秒間）」）。
                    # 離れたところの秒は別の効果のものなので拾わない
                    d = _gim_dur.match(txt[m.end():m.end() + 12].lstrip("、/ "))
                    dur = int(d.group(1)) if d else 0
                    sig = (k, v, dur, txt)
                    if sig in seen:
                        continue
                    seen.add(sig)
                    g1 = {"n": sk.get("Name") or nm, "k": k, "v": v,
                          "d": dur, "t": txt}
                    if col:
                        g1["c"] = col
                    out.append(g1)
        _gim_cache[ck] = out
        return out

    # ---- ダメージの転移。**部位に当てたぶんがボスの HP から減るボスがいる**
    # （2026-09-01）。ペロロジラのミニオン・グレゴリオの聖歌隊・ホバークラフトの
    # ミサイル誘導装置・クロカゲの片鱗がそれで、**これを入れないと TL が
    # 桁で足りなくなる**（グレゴリオは実測の 22 分の 1 しか出なかった）。
    # 説明文の 3 通りの書き方だけを読む。**読めなかったら転移なし**（憶測しない）
    _TR_PATS = [
        re.compile(r"(.+?)(?:は|の).*?被ダメージの(\d+)%分を(.+?)に転移"),
        re.compile(r"(.+?)に与えたダメージの(\d+)%分が(.+?)に転移"),
        re.compile(r"([^、。は]+)はダメージを受けると(.+?)に転移"),
    ]

    def _trans(rd, df):
        """[(部位の名前に含まれる語, 率, 出典の文)] を返す。宛先がボス本人のときだけ。"""
        lst = rd.get("RaidSkillList") or []
        di = next((i for i, x in enumerate(TL_DIFF) if x.lower() == (df or "").lower()), None)
        if di is None or di >= len(lst):
            return []
        bnm, out, seen = rd.get("Name") or "", [], set()
        for nm in lst[di] or []:
            sk = rsk.get(nm) or {}
            for ln in (sk.get("Desc") or "").split("\n"):
                txt = _gim_tag.sub("", _gim_stat.sub(r"\1", ln)).strip()
                if "転移" not in txt:
                    continue
                for pi, pat in enumerate(_TR_PATS):
                    m = pat.search(txt)
                    if not m:
                        continue
                    if pi == 2:
                        src, rate, dst = m.group(1), 100, m.group(2)
                    else:
                        src, rate, dst = m.group(1), int(m.group(2)), m.group(3)
                    # **宛先がボス本人でなければ拾わない。**味方どうしの転移もある
                    if not bnm or bnm not in dst:
                        break
                    if (src, rate) in seen:
                        break
                    seen.add((src, rate))
                    out.append((src, rate, txt))
                    break
        return out

    fcache = {}
    # 木の無い敵を、中身が同じ敵の木で埋める（`tl_twins` の docstring に根拠）
    twin = tl_twins(bt, csl, stat)
    bosses, ok, half, ng = [], 0, 0, []
    for g0 in grp_order:
        b = grp_base[g0]
        # **1 つの枝にボスが 2 体以上いることがある。**シロ＆クロ、
        # カイテンジャー（レンジャー隊と FX Mk.0）、ホバークラフト（前半と後半）、
        # イェソド。TL も前半・後半で別に書くので、**枝を分ける**
        nb = 1
        for sg in grp[g0]:
            nb = max(nb, len(sg.get("boss") or []))
        _seen_cid = set()
        for bx in range(nb):
            rows = []
            for sg in grp[g0]:
                bl = sg.get("boss") or []
                got, cid0 = None, (bl[bx] if bx < len(bl) else None)
                if cid0:
                    got = tl_one(cid0, bt, csl, stat, fcache, appear, twin)
                if not got and bx == 0:
                    # **集計の行しか引けないことがある。**そのときは並び順に落とす
                    for cid in sg["cids"]:
                        got = tl_one(cid, bt, csl, stat, fcache, appear, twin)
                        if got:
                            break
                df = sg["df"]
                if not got:
                    if bx == 0:
                        ng.append(f"{b.get('Name')} {g0} {df}")
                    continue
                got["df"] = df
                got["dur"] = sg["dur"]
                got["cool"] = {g: cool[g] for g in got["ex"] if g in cool}
                # EX 1 発の長さ（フレーム）。**帯の幅に使う。**
                # 通常スキルと違って、こちらはトップレベルの `Duration` が
                # そのまま入っている
                got["exd"] = [tl_frames(g, fcache) for g in got["ex"]]
                # ---- ボス側の素の値。ダメージ計算はここから引く
                sr = stat.get(got["cid"]) or {}
                cr = ch_all.get(got["cid"]) or {}
                got["lv"] = sg.get("lv")
                got["env"] = sg.get("env")
                got["ext"] = sg.get("ext") or "Base"
                got["sc"] = sg.get("sc")
                got["bs"] = {
                    "armor": cr.get("ArmorType"), "bullet": cr.get("BulletType"),
                    # **`Size` はバフの `Restrictions` が見る**（ツクヨ・ミネ）。
                    # 2026-09-01 に足した
                    # **`CharacterExcelTable` には `Size` が無い。**SchaleDB の enemies に
                    # ある（グレゴリオ Large）。無いままだとミネ EX の
                    # `Size NotEqual Medium` が「分からない欄」で棄却されて敵デバフが
                    # 全時刻 0 になっていた（2026-09-02、ゼリーの報告）
                    "size": cr.get("Size") or (_enemies.get(str(got["cid"])) or {}).get("Size"),
                    "groggy": sr.get("GroggyGauge"), "groggyT": sr.get("GroggyTime"),
                    "hp": sr.get("MaxHP1"), "atk": sr.get("AttackPower1"),
                    "def": sr.get("DefensePower1"),
                    "defpr": sr.get("DefensePenetrationResist1") or 0,
                    "stab": sr.get("StabilityPoint"), "stabR": sr.get("StabilityRate"),
                    "dodge": sr.get("DodgePoint"), "acc": sr.get("AccuracyPoint"),
                    "crR": sr.get("CriticalResistPoint"),
                    "cdR": sr.get("CriticalDamageResistRate"),
                    "ad": [sr.get("StreetBattleAdaptation"),
                           sr.get("OutdoorBattleAdaptation"),
                           sr.get("IndoorBattleAdaptation")],
                    # **素の被ダメージ率**（`DamagedRatio`。10000 が 1.0 倍、19000 が 0.1 倍）。
                    # ケセド 19000・ホド 19000・ヒエロニムス 16000・ホバークラフト 17500・
                    # イェソド 19900。**画面側で掛けるのは `dmgOnly` のボスだけ**（ケセド。
                    # 「この効果以外の DamagedRatio の増加効果を無効化」と書いてある）。
                    # ホド・ヒエロニムス・イェソドは 1.0 倍の計算で実クリア TL と合っていて、
                    # 素の値が効いていない理由は不明（2026-09-02、ケセドの動画で見つけた）
                    "damaged": sr.get("DamagedRatio"),
                    "dmgOnly": _dmg_only(b, df),
                }
                # **選べる装甲**（大決戦がある枝だけ）。中身は総力戦と同じなので
                # 変えるのは `armor` の字だけ
                got["gim"] = _gim(b, df)
                _sp = _gspl(b, df)
                if _sp:
                    got["gspl"] = _sp
                # **ボス自身の EX でグロッキーゲージが埋まるなら、その貯まり方**
                # （2026-09-04。出どころは `tl_groggy` の上の注記）
                _gga = tl_groggy(got.get("ex"), stat.get(got["cid"]),
                                 got.get("ph"), _ls_cache)
                if _gga:
                    # **フェーズが終わる通常攻撃の数**。木の `AddActiveGauge` の
                    # `+1` が 2 度目に立つところで `CheckActiveGaugeOver` を越える
                    _btr = [r for r in (bt.get(got["cid"]) or []) if r["AIPhase"] == 0]
                    _plus = sorted(int(r["TriggerArgument"]) for r in _btr
                                   if r["ExternalBTTrigger"] == "UseNormalSkill"
                                   and r["ExternalBehavior"] == "AddActiveGauge"
                                   and int(r["BehaviorArgument"]) > 0)
                    _over = sorted(int(r["TriggerArgument"]) for r in _btr
                                   if r["ExternalBTTrigger"] == "CheckActiveGaugeOver")
                    if _gga["atg"] and _over:
                        _n = int(-(-_over[0] // _gga["atg"]))       # EX 何発で越えるか
                        _gga["end"] = (_plus[_n - 1] if 0 < _n <= len(_plus)
                                       and _gga["atg"] * _n < _over[0] else None)
                        _gga["per"] = len([c for c in (_gga["at"].get("0") or [])
                                           if _gga["end"] and c <= _gga["end"]]) or None
                    got["gga"] = _gga
                _sg = _stg(b, df)
                if _sg:
                    got["stg"] = _sg
                # **盤**（2026-09-04、第 1 段）。座標・湧き点・召喚位置・体の大きさ。
                # 「1 発が何体に当たるか」を人の入力ではなく計算で出すために要る
                _bd = tl_board(sg.get("stage"), got.get("ex"), _ls_cache, ch_all, stat)
                if _bd:
                    got["board"] = _bd
                got["arm"] = sorted((grp_arm.get(g0, {}).get(df) or {}).keys(),
                                    key=lambda a: ARMORS.index(a))
                # **部位。**この枝の Ground → 大決戦の枝 → 同じボスの別地形 の順に探す
                _skip = set(sg["cids"])
                _own = _subs(got["cid"], _skip,
                             _subs_extra(got["cid"], _skip,
                                         _subs_df(got["cid"], df, _skip)))
                got["sub"] = _own
                # **本体の枝に無ければ `EnemyList` を引く**（LOOP.md 63）。
                # 借り物ではなくその難易度の実物なので、装甲の付け替えも要らない
                if not got["sub"]:
                    # **同じ番号帯には別難易度のボス本体も並んでいる。**
                    # `EnemyList` の先頭に出てくる id は全部よけないと、
                    # ペロロジラ（屋内）Hard の部位に「ペロロジラ（屋内戦）
                    # hp380000」＝ Normal の本体が入る（2026-09-03 に実測）
                    _cand = _el_cand(_elist.get(got["cid"], []))
                    if _cand:
                        got["sub"] = _subs(got["cid"], _skip, _cand)
                        _own = got["sub"]
                if not got["sub"]:
                    for _a in got["arm"]:
                        _ac = (grp_arm.get(g0, {}).get(df) or {}).get(_a) or []
                        if _ac:
                            got["sub"] = _subs(_ac[0], set(_ac))
                        if got["sub"]:
                            break
                if not got["sub"]:
                    for _sg2 in _sib.get(_grp_base(g0), []):
                        if _sg2 == g0:
                            continue
                        for _row2 in grp[_sg2]:
                            if _row2["df"] != df:
                                continue
                            got["sub"] = _subs((_row2.get("boss") or _row2["cids"])[0],
                                               set(_row2["cids"]))
                            if got["sub"]:
                                break
                        if got["sub"]:
                            break
                # **それでも空なら、その Raid の同じ難易度の `EnemyList` を引く。**
                # ペロロジラ屋外の Hard〜Extreme がこれ。本体が `7405200`〜`7405500`
                # なのに `7405xxx` には部位の行が 1 つも無く、`EnemyList[1..4]` は
                # 屋内の本体 `7305200`〜`7305500` を先頭に置いて部位に
                # `7305101 Perorozilla_MiddleSize01` と `7305190 Perorozilla_SmallSize01`
                # を並べている。屋内の枝も `73052x` には部位が無く、
                # ここと同じ `EnemyList` から借りている（＝借り先は同じ実物）。
                # **借りるのは `TacticEntityType` がボスでない行だけ。**シロクロは
                # `EnemyList` の 2 体目が相方のボス（`7302101 Kuro_default_Normal`
                # `TacticEntityType: Boss`）で、そのまま借りると屋内の枝に
                # 別地形のシロ・クロ・集計の 3 体が部位として並ぶ（2026-09-04 に実測）。
                # 相方は下の「討伐の池」が枝の実物で足す
                if not got["sub"]:
                    _cand = [k for k in _el_cand(
                        _elist_df.get((b.get("Id"), (df or "").lower()), []))
                        if (ch_all.get(k) or {}).get("TacticEntityType") != "Boss"]
                    if _cand:
                        got["sub"] = _subs(got["cid"], _skip, _cand)
                # **借りた部位の装甲は本体に揃える。**大決戦の枝から借りると、
                # その枝の装甲（並びの先頭＝LightArmor）が付いてくる。ペロロジラ屋外と
                # ケセド屋外がそれで、本体が Unarmed／HeavyArmor なのに部位だけ
                # LightArmor だった（2026-09-02）。部位の中身は装甲で変わらない
                if got["sub"] and not _own:
                    for _x in got["sub"]:
                        _x["armor"] = got["bs"]["armor"]
                # **本体の HP の写しを部位の HP にしない。**ドラム缶ガニの操作盤・フンドシ・
                # 錆びたドラム缶は `MaxHP1` が本体と同じ 240,000,000 で、画面に「操作盤 HP
                # 240,000,000」と出ていた。動画の赤ゲージは 6,000,000／12,000,000 で、
                # どの表とも一致しない（出どころ不明）。写しは null にして「不明」と出す
                # （2026-09-02、グミの報告）
                for _x in got["sub"] or []:
                    if not _x.get("pool") and _x.get("hp") and _x["hp"] == got["bs"].get("hp"):
                        _x["hp"] = None; _x["hpCopy"] = True
                # ---- **討伐の池。**同じ段にボスが 2 体以上いるとき（`BossCharacterId` が
                # 2 つ: シロ＆クロ、レンジャー隊＋FX Mk.0、ワカモ前半＋ホバー後半）、
                # 相手の体を `sub` に足して `pool`（HP を 1 本持つ相手の id）と `kill: 1`
                # （討伐に要る）を付ける。`korder` は `BossCharacterId` の並びで、
                # 通常攻撃と NS はその順で「生きている最初の池」へ向く。
                # `ConnectCharacterToDummy`（BT）を持つ体は、ダミーが HP を 1 本持ち
                # 繋がった体がそれを共有する（レンジャー 5 体 = 7304701 の 40,000,000。
                # 集計 70,000,000 = 40,000,000 + FX 30,000,000 で辻褄が合う。
                # 2026-09-02、plana の設計）。**順に出るか同時にいるかはデータに無い**
                _bl = [c for c in (sg.get("boss") or []) if c]
                got["korder"] = list(_bl)
                for _oc in _bl:
                    if _oc == got["cid"]:
                        continue
                    _conn = [int(x["BehaviorArgument"]) for x in bt.get(_oc, [])
                             if x.get("ExternalBehavior") == "ConnectCharacterToDummy"
                             and str(x.get("BehaviorArgument", "")).isdigit()]
                    if _conn:
                        _hit = False
                        for _x in got["sub"]:
                            if _x["id"] in _conn:
                                _x["pool"] = _oc; _x["kill"] = 1
                                _x["phn"] = (stat.get(_oc) or {}).get("MaxHP1")
                                _hit = True
                        if _hit:
                            continue
                    _sr2, _cr2 = stat.get(_oc) or {}, ch_all.get(_oc) or {}
                    if not _sr2.get("MaxHP1"):
                        continue
                    got["sub"].append({
                        "id": _oc, "n": _pname(_oc), "dn": _cr2.get("DevName"),
                        "k": _cr2.get("TacticEntityType") or "", "hp": _sr2.get("MaxHP1"),
                        "def": _sr2.get("DefensePower1"), "armor": got["bs"]["armor"],
                        "damaged": _sr2.get("DamagedRatio"),
                        "size": _cr2.get("Size") or (_enemies.get(str(_oc)) or {}).get("Size"),
                        "stab": _sr2.get("StabilityPoint"), "stabR": _sr2.get("StabilityRate"),
                        "dodge": _sr2.get("DodgePoint"), "crR": _sr2.get("CriticalResistPoint"),
                        "cdR": _sr2.get("CriticalDamageResistRate"),
                        "defpr": _sr2.get("DefensePenetrationResist1") or 0,
                        "ad": [_sr2.get("StreetBattleAdaptation"),
                               _sr2.get("OutdoorBattleAdaptation"),
                               _sr2.get("IndoorBattleAdaptation")],
                        "pool": _oc, "kill": 1, "phn": _sr2.get("MaxHP1")})
                # **転移**。説明文の「◯◯」が部位の名前に入っていたら、その率を乗せる
                for _src, _rate, _why in _trans(b, df):
                    for _x in got["sub"]:
                        _n = (_x.get("n") or "").split("（")[0]
                        if len(_n) >= 2 and (_n in _src or _src in _n):
                            _x["tr"] = _rate
                            _x["trw"] = _why
                # **部位の数。**データには無く、攻略サイトの記述から。クロカゲの片鱗は 6 個
                # （AppMedia https://appmedia.jp/blue_archive/78191660 「目に見えない片鱗が6個浮遊」）。
                # 範囲 EX は本体＋片鱗 6 の 7 体に当たり、片鱗のぶんは 100% 本体へ転移する。
                # これが無いとホシノ（臨戦）の EX が動画の 1/5.6 だった（2026-09-02、Plana の調査）
                for _x in got["sub"] or []:
                    if _x.get("id") in (611140703, 611140704):
                        _x["spn"] = 6
                        _x["spnw"] = "AppMedia の攻略記事（片鱗 6 個）"
                # **湧く体の数は LevelSkill にある**（2026-09-03）。`cnt` は
                # 「同じ役どころの行を何本畳んだか」（名簿の数）で、盤に出る数ではない。
                # ペロロジラは名簿 30・1 回の湧き 6 で、混ぜると 21 体に当たることになる
                _sm = summon_count(got.get("ex"), _ls_cache)
                if _sm:
                    _smt = {}
                    for _u, _n in _sm.items():
                        _t = _summon_tail(_u)
                        _smt[_t] = max(_smt.get(_t, 0), _n)
                    for _x in got["sub"] or []:
                        _n2 = _smt.get(_summon_tail(_x.get("dn")))
                        if _n2 and _n2 > 1:
                            _x["spn"] = _n2
                            _x["spnw"] = "LevelSkill の SummonGroups（SummonEntities %d 件）" % _n2
                rows.append(got)
                ok += 1 if got["per"] else 0
                half += 0 if got["per"] else 1
            if not rows:
                continue
            # **同じ体を 2 度出さない。**カイテンジャーのレンジャー隊は
            # 行動のデータが引けず、落とし先が FX Mk.0 と同じになる
            if rows[0]["cid"] in _seen_cid:
                continue
            _seen_cid.add(rows[0]["cid"])
            # グロッキーゲージの溜まり方。**ゲーム内の文をそのまま出す**
            _gc = _groggy_loc.get(b.get("DevName") or "", "")
            _wk = b.get("BulletType") or ""
            _ter = TER_JA.get(rows[0].get("env") or "", "")
            _nm = b.get("Name")
            if nb > 1:
                # ボスが 2 体以上の枝は、その体の名前で呼ぶ
                _nm = _pname(rows[0]["cid"]) or _nm
            if n_of_base.get(b["Id"], 1) > 1 and _ter:
                _nm = f"{_nm}（{_ter}）"
            bosses.append({"id": b["Id"], "g": g0 if bx == 0 else f"{g0}#{bx}",
                           "n": _nm, "dev": b.get("DevName"),
                           "path": b.get("PathName"), "gc": _gc, "gwk": _wk, "d": rows})

    # ---- **敵側の効果を行に付ける**（`DB/LogicEffect_NPC.json`。2026-09-04）。
    # 出どころと辿り方は `npc_effects()` の注記。ここでやるのは 3 つ。
    #
    #   ① `d[].npc` … その体（本体・部位）に実際に付く「被ダメージ率に効く効果」。
    #      **自動では効かせない。**引き金（グロッキー・被弾・段階）は時刻に解けないので、
    #      `gim` と同じく画面のチップにして、秒は人が置く
    #   ② `d[].bs.dmgImm` … `DamagedRatio` の弱体を無効にする札（`ImmuneEffectDAO`）。
    #      **`dmgOnly` の一次資料版。**今の `dmgOnly` は `RaidSkills` の日本語
    #      （「この効果以外」「DamagedRatio」「無効」）を読んでいるだけだった
    #   ③ 食い違ったら画面に出す。**黙って直さない**
    #
    # `pc` は「被ダメージ率 +N%」に直した値。**画面の窓と同じ単位にする**ための換算で、
    # 式は道具の中の関係から出る。`dmg.js` は `(20000 − DamagedRatio) ÷ 10000` を使い、
    # 窓は `DamagedRatio` から `N×100` を引く。素の値 D0 の相手に BaseAmount δ が
    # 乗ったときの倍率は `(20000 − D0 − δ)/10000`、窓 N% を置いたときは
    # `(1 + N/100) × (20000 − D0)/10000` なので `N = −δ × 100 ÷ (20000 − D0)`。
    #   ケセド  δ=−9000, D0=19000 → N=900   ゲーム内の「DamagedRatioが900%増加」と一致
    #   シロクロ δ=−5000, D0=10000 → N=50    ゲーム内の「被ダメージ率+50%」と一致
    # **D0 は道具が実際に掛けている値**（`dmgOnly` のボスだけ素の値、他は 10000）。
    # 掛かり方が「係数」の行（`TargetCoefficientAmount`）は窓で表せないので `pc` を出さない
    _npc_le = npc_effects()
    _npc_want, _npc_who = set(), {}
    for _b in bosses:
        for _r in _b["d"]:
            _npc_who.setdefault(_r["cid"], "本体")
            for _x in (_r.get("sub") or []):
                _npc_who.setdefault(_x["id"], _x.get("n") or str(_x["id"]))
    _CSL_SLOT = ("NormalSkillGroupId", "ExSkillGroupId", "PublicSkillGroupId",
                 "PassiveSkillGroupId", "LeaderSkillGroupId",
                 "ExtraPassiveSkillGroupId", "HiddenPassiveSkillGroupId")
    _npc_cs = {}
    for _c in _npc_who:
        _nm = []
        for _row in (csl_all.get(_c) or []):
            for _k in _CSL_SLOT:
                for _g in (_row.get(_k) or []):
                    # **スキル名と効果の名札は頭が揃わない。**`ShiroKuro_Debuff_DamagedRatio`
                    # を配るのは `ShiroInsaneEx04`、`Wakamo_HoverCraft_GrogyBonus` を
                    # 配るのは `HoverCraftWakamo01Ex05` で、頭で絞ると落ちる
                    # （2026-09-04 に実物で確かめた）。**絞らずに全部引く**
                    if _g and _g not in _nm:
                        _nm.append(_g)
        if _nm:
            _npc_cs[_c] = _nm
            _npc_want |= set(_nm)
    _npc_idx = npc_skill_index(sorted(_npc_want))
    _npc_by = {}
    for _n, (_gs, _ev, _cx) in _npc_idx.items():
        for _g in _gs:
            if _g in _npc_le:
                _npc_by.setdefault(_g, []).append((_n, _ev, _cx))
    _npc_n, _npc_imm, _npc_bad = 0, 0, []
    for _b in bosses:
        for _r in _b["d"]:
            _lst, _seen = [], set()
            _bs = _r["bs"]
            _d0b = _bs.get("damaged") if _bs.get("dmgOnly") else 10000
            _tgts = [(_r["cid"], "本体", _d0b)]
            for _x in (_r.get("sub") or []):
                _tgts.append((_x["id"], _x.get("n") or str(_x["id"]), 10000))
            for _cid2, _who, _d0 in _tgts:
                for _n in (_npc_cs.get(_cid2) or []):
                    _gs = (_npc_idx.get(_n) or (set(), None, ""))[0]
                    for _g in sorted(_gs):
                        for _k, _dao, _e in (_npc_le.get(_g) or []):
                            _sig = (_g, _cid2, _k)
                            if _sig in _seen:
                                continue
                            _seen.add(_sig)
                            _q = {"g": _g, "tpl": _e.get("TemplateId"), "dao": _dao,
                                  "k": _k, "who": _who, "id": _cid2,
                                  "ch": _e.get("Channel"),
                                  # **配るスキルは、その体が持っているものだけ挙げる。**
                                  # `ShiroKuro_Debuff_DamagedRatio` はシロもクロも配るので、
                                  # 全部並べるとシロの行に `KuroInasneEx03` が出る
                                  "sk": sorted(_n2 for _n2 in (_npc_cs.get(_cid2) or [])
                                               if _g in (_npc_idx.get(_n2)
                                                         or (set(),))[0]),
                                  "ev": (_npc_idx.get(_n) or (None, None, ""))[1],
                                  "cx": (_npc_idx.get(_n) or (None, None, ""))[2]}
                            if _dao == "StatChangeEffectDAO":
                                _q["v"] = _e.get("BaseAmount")
                                _q["cf"] = _e.get("TargetCoefficientAmount")
                                _ms = _e.get("EndConditionArgumentFirst")
                                try:
                                    _ms = int(_ms)
                                except (TypeError, ValueError):
                                    _ms = -1
                                _q["d"] = 0 if _ms is None or _ms < 0 else _ms // 1000
                                if _k == "damaged" and _q["v"] and not _q["cf"] \
                                        and (20000 - (_d0 or 10000)):
                                    _q["pc"] = round(-_q["v"] * 100.0 /
                                                     (20000 - (_d0 or 10000)), 2)
                            elif _dao == "DamageTransferEffectDAO":
                                _q["v"] = _e.get("TransferRatio")
                                _ms = _e.get("Duration") or -1
                                _q["d"] = 0 if _ms < 0 else _ms // 1000
                            elif _dao == "OverrideBulletArmorDamageFactorEffectDAO":
                                _q["v"] = _e.get("DamageRate")
                                _q["bt"] = _e.get("CheckBulletType")
                                _q["at"] = _e.get("CheckArmorType")
                                _q["da"] = _e.get("DamageAttribute")
                            elif _dao == "DamagedLimitEffectDAO":
                                _q["v"] = _e.get("LimitAmount")
                            elif _dao == "DamagedMultiplierbyDamageOverTimeEffectDAO":
                                _q["v"] = _e.get("AddRate")
                                _q["tpl2"] = _e.get("ApplyLogicEffectTemplateId")
                            elif _dao == "ImmuneEffectDAO":
                                _q["im"] = [_e.get("TargetLogicEffectTemplateId%02d" % _i)
                                            for _i in range(13)
                                            if _e.get("TargetLogicEffectTemplateId%02d" % _i)]
                            _lst.append(_q)
            if _lst:
                _r["npc"] = _lst
                _npc_n += len(_lst)
            _im = sorted({_t for _q in _lst if _q["k"] == "immune"
                          and _q["who"] == "本体" for _t in (_q.get("im") or [])
                          if "DamagedRatio" in _t})
            if _im:
                _bs["dmgImm"] = _im
                _npc_imm += 1
            if bool(_im) != bool(_bs.get("dmgOnly")):
                _npc_bad.append("%s %s 説明文=%s / ImmuneEffect=%s"
                                % (_b["g"], _r.get("df"), _bs.get("dmgOnly"), _im))
    print(f"  敵側の効果（LogicEffect_NPC）{_npc_n} 件を {len(_npc_want)} スキルから引いた"
          f"／DamagedRatio の弱体を無効にする体 {_npc_imm} 行")
    if _npc_bad:
        print("  ※ `dmgOnly`（説明文）と `ImmuneEffect`（一次資料）が食い違う行 "
              + str(len(_npc_bad)) + " 本:")
        for _x in _npc_bad[:12]:
            print("     " + _x)
    # **生徒の素ステータスとダメージ倍率。**`tools/cost-timeline/data.js` には
    # バフと着弾しか入っていないので、ダメージを出すのに要るぶんだけここに足す。
    # ページは両方の data.js を読む（変数は `TL` と `TLBOSS` で分けてある）。
    #   st  … [攻撃1, 攻撃100, HP1, HP100, 防御1, 防御100, 安定値, 命中, 会心, 会心ダメージ率, 射程]
    #   dmg … スキルの種類ごとに [倍率5段, ヒット配分, 会心判定, ブロック]
    # `Scale` は万分率（27438 = 274.38%）。`Hits` は 1 発の中の配分（10000 = 100%）
    SD_STAT = ["AttackPower1", "AttackPower100", "MaxHP1", "MaxHP100",
               "DefensePower1", "DefensePower100", "StabilityPoint",
               "AccuracyPoint", "CriticalPoint", "CriticalDamageRate", "Range",
               "DodgePoint", "HealPower1", "HealPower100"]
    # SchaleDB は地形適性を 0〜5 の数字で持つ。ボスの表は "D"〜"SS" の字なので字に揃える
    ADAPT = ["D", "C", "B", "A", "S", "SS"]
    stu = as_list(get_json(SD.format("students")))
    st_out, dmg_out, ndmg, sinfo, build = {}, {}, 0, {}, {}
    ncond = nstack = 0
    buf_out, nbuf, nskip, ncond, nrst, novr, nstk = {}, 0, 0, 0, 0, 0, 0
    # **範囲を持つ枠**（生徒 → スキルの枠 → [形, 半径]）
    area_out = {}
    # **範囲の中心と狙い方**（生徒 → 枠 → `_ls_geom` の 7 つ組）と**届く距離**
    geo_out, ngeo, rng_out = {}, 0, {}
    na_out, nna = {}, 0
    naf_out = {}
    nform = 0
    alt_out = {}
    ns_out, nns = {}, 0
    ep_out, nep = {}, 0
    # サブスキルの条件が指す `Dummy_*` の札。あとで LogicEffect_PC から引く
    ep_tid = {}
    skname = {}
    tgt_out = {}
    tsel_out = {}
    fchg_out = {}
    # 装備。段ごとの効果。**値は SchaleDB と同じく `StatValue[i][1]`（その段の上限レベル）**
    eqp_out = {}
    for e in as_list(get_json(SD.format("equipment"))):
        c, t = e.get("Category"), e.get("Tier")
        # **同じ段が 2 行ある**（Id 101xxx は強化素材側で `StatType` が空）。
        # 空のほうが後から来て上書きしていた（2026-09-01 に気づいた）
        if not c or not t or not e.get("StatType"):
            continue
        eqp_out.setdefault(c, {})[str(t)] = [
            [k, (e["StatValue"][i] or [0, 0])[1]]
            for i, k in enumerate(e.get("StatType") or [])]
    for x in stu:
        sid = str(x["Id"])
        # **`StabilityRate` と `DefensePenetration` は SchaleDB に無い。**
        # ba-data の `DB/CharacterStatExcelTable` から足す（生徒は一律 2000／0）
        dbs = stat.get(x["Id"]) or {}
        st_out[sid] = [x.get(k) for k in SD_STAT] + [
            dbs.get("StabilityRate", 2000), dbs.get("DefensePenetration1", 0),
            dbs.get("DefensePenetration100", 0)]
        # ---- 通常スキル(NS)の自動発動。**`LevelSkill/<PublicSkillGroupId>.json` の
        # `AutoUseRule`**。`ConditionType: "Interval"` なら `ConditionArgument` が
        # フレーム（750 = 25 秒）。`Duration` が 1 発の長さ（フレーム）。
        # 愛用品 T2 で別のスキルに変わる子がいるので、要る段ごとに入れる
        # **`PublicSkillGroupId` は形態ごとの札の並びで、使わない枠は `EmptySkill`。**
        # 先頭を無条件に取っていたので、形態 1 の行では `EmptySkill` を見ていた
        # （2026-09-03、50c）。オトギは
        #   FormIndex 0  ['CH0174Public01', 'EmptySkill']      TriggerRate 0（発動しない）
        #   FormIndex 1  ['EmptySkill', 'CH0174Public02']      ダメージはこちら
        # の 2 行で、トキも同じ形（T2 の行は
        # `['CH0187GearPublic01', 'EmptySkill', 'CH0187GearPublic03', 'CH0187GearPublic04']`
        # のように 3 枚目・4 枚目が続くので、**「何番目か」ではなく
        # 「`EmptySkill` でない最初の 1 枚」**で取る）。
        # 行は `(愛用品の段, FormIndex)` ごとに 1 本ずつ持つ
        seen_g = {}
        for row in csl_all.get(x["Id"], []):
            pg = None
            for _pg in (row.get("PublicSkillGroupId") or []):
                if _pg and _pg != "EmptySkill":
                    pg = _pg
                    break
            if not pg:
                continue
            mg = row.get("MinimumTierCharacterGear") or 0
            fi = row.get("FormIndex") or 0
            if (mg, fi) in seen_g:
                continue
            d = get_json(BALS.format(pg)) or {}
            au = d.get("AutoUseRule") or {}
            arg = au.get("ConditionArgument")
            try:
                arg = int(arg)
            except (TypeError, ValueError):
                arg = None
            # **`MaxTriggerCount` と `CoolTimeNotTrigger` を捨てていた**（2026-09-03）。
            # `Interval` には 3 通りある。`ConditionArgument > 1` が周期のもの（267 件）、
            # `ConditionArgument` が 1 で `CoolTimeNotTrigger` が周期のもの（2 件）、
            # `MaxTriggerCount: 1` の「戦闘中に 1 回のみ」（5 件）。
            # **5 件を周期と読んでいたので、シロコ（水着）と ミチル（ドレス）は
            # 1 秒ごとに 240 回発動して 60 秒バフが切れなくなっていた**（過大）。
            # 逆にシュン・ヒナ（ドレス）・シュン（水着）は 1 回も置かれなかった（過小）
            # `TryCount` は `OnAttackIng` の「通常攻撃 N 回毎に」の N。
            # **スキルの説明文に N が書いてある 22 件すべてで `TryCount` と一致した**
            # （2026-09-03。`ConditionArgument` のほうは "" / "0" / "1" しか入っておらず
            # 回数と相関しない）。`TriggerRate` は 1 万分率で、10000 以外は確率
            #   fi … その行の形態（`FormIndex`）。**発動しない札を見ないため**に要る
            #   need … **その形態のときだけ発動する**（2026-09-04、50b）。
            #     `AutoUseRule.TryToUseSkillModifiers` の
            #     `FormIndexCheckModifierDAO.FormIndex`。オトギの
            #     `CH0174Public02`（`AmmoCountUnder 0`）は FormIndex 1 で、
            #     **指定射撃姿勢の 35 秒の間だけ**弾切れで出る。
            #     エイミ（臨戦）`CH0337Public01` も 1、クルミ `CH0173Public01` は 0
            _need = None
            for _md in (au.get("TryToUseSkillModifiers") or []):
                if "FormIndexCheckModifier" in str(_md.get("$type") or ""):
                    _need = _md.get("FormIndex")
                    break
            #   cnt … **変身している間の通常攻撃 N 発目**（2026-09-04、50b-2）。
            #     引き金が札の名前（`HitLogicEffect*`）のものを辿って出す。
            #     解けるのはエイミ（臨戦）の 4 発だけ（`ns_count` の頭を見て）
            seen_g[(mg, fi)] = [mg, au.get("ConditionType"), arg, d.get("Duration"),
                                au.get("MaxTriggerCount"), au.get("CoolTimeNotTrigger"),
                                au.get("TryCount"), au.get("TriggerRate"), fi, _need,
                                ns_count(x.get("DevName"), au.get("ConditionType"),
                                         au.get("ConditionArgument"))]
            nns += 1
        ns_out[sid] = [seen_g[k] for k in sorted(seen_g)]
        # ---- サブスキル（SS）の引き金。**`LevelSkill/<ExtraPassiveSkillGroupId>.json`
        # の `TriggerCondition`**（2026-09-03）。NS の `AutoUseRule` は
        # ダメージを持つ 40 人とも空で、**SS は周期では出ない。**
        # `Event` が引き金の種類。全生徒の記述文と突き合わせて確かめた対応は
        #   1=常時 / 2=通常攻撃時 / 3=スキル発動と同時 / 11=被弾 / 13=会心 /
        #   15=撃破時 / 16=リロード時 / 17=スキル使用時 / 18=内部効果 /
        #   21=攻撃時 / 105=N 秒毎（`Parameters` がフレーム） / 301=状態条件つき常時
        # `ExtraPassive` は愛用品の段で変わらないので、先頭の 1 本だけ取る
        ep = None
        for row in csl_all.get(x["Id"], []):
            eg = (row.get("ExtraPassiveSkillGroupId") or [None])[0]
            if not eg:
                continue
            ed = get_json(BALS.format(eg)) or {}
            tc = ed.get("TriggerCondition") or {}
            ep = [tc.get("Event"), tc.get("Parameters"), tc.get("ConditionExpression"),
                  tc.get("TriggerRate"), ed.get("MaxTriggerCount"), ed.get("TryCount"),
                  ed.get("CoolTimeNotTrigger"), ed.get("Duration")]
            break
        # **条件は `TriggerCondition` ではなく `EntityTimeline[0].Entity.Abilities[]`
        # の `Modifiers[]` に入っている**（2026-09-03。`ConditionExpression` は
        # 40 人とも空、`students.min.json` の `Condition` も `None` だった）。
        # 型をそのまま運ぶ。**道具が知らない型が 1 つでもあれば、その子は置かない**
        if ep and ep[0] is not None:
            # **アビリティごとに分ける。**同じアビリティの中は「かつ」、
            # 別のアビリティどうしは「または」（レンゲは `Public` 版と
            # `GearPublic` 版が別のアビリティに分かれていて、
            # 平らにすると「両方立っているとき」になってしまう。2026-09-03）
            mods = []
            for tl in (ed.get("EntityTimeline") or []):
                for ab in (((tl.get("Entity") or {}).get("Abilities")) or []):
                    one = []
                    for m in (ab.get("Modifiers") or []):
                        one.append(dict(
                            [("t", m["$type"].split(".")[-1].split(",")[0])] +
                            [(k, v) for k, v in m.items() if k != "$type"]))
                    mods.append(one)
            ep.append(mods)
            ep_out[sid] = ep
            nep += 1
            for _ab in mods:
                for _m in _ab:
                    if _m.get("TemplateId"):
                        ep_tid.setdefault(sid, []).append(_m["TemplateId"])
        # ---- 育成の中身。**適用の仕方は SchaleDB の CharacterStats そのまま**
        #   eqp … 装備の枠 3 つ（Hat / Hairpin / Watch など）
        #   wp  … 固有武器 [攻撃1, 攻撃100, HP1, HP100, 治癒1, 治癒100, 伸び方, 地形, 段数]
        #   gr  … 愛用品 [[効果, T2 の値], …]（未実装の生徒は空）
        #   fav … 絆 [[統計1, 統計2], 区切りごとの伸び]
        w = x.get("Weapon") or {}
        # **固有武器★4 の追加ステータス**は SchaleDB の students.min.json に無い。
        # `DB/CharacterWeaponExcelTable.json` の `StatType` / `StatValue` の
        # 4 番目（★4 のぶん）から取る。ネル（制服）は `EnhancePierceRate_Base`
        # 1000、リオ・イブキ（水着）は `MaxCostIncrease_Base` 5000。
        # 3 番目は地形適性 +1 で、そちらは SchaleDB の AdaptationType/Value と同じ
        _wr = _cweapon.get(int(sid)) or {}
        _w4t = (_wr.get("StatType") or [None] * 5)[3]
        _w4v = (_wr.get("StatValue") or [0] * 5)[3]
        build[sid] = {
            "eqp": x.get("Equipment") or [],
            "wp": [w.get("AttackPower1"), w.get("AttackPower100"), w.get("MaxHP1"),
                   w.get("MaxHP100"), w.get("HealPower1"), w.get("HealPower100"),
                   w.get("StatLevelUpType"), w.get("AdaptationType"),
                   w.get("AdaptationValue"),
                   _w4t if _w4t and _w4t != "None" else None, _w4v] if w else None,
            "gr": [[t, (x["Gear"]["StatValue"][i] or [0, 0])[1]]
                   for i, t in enumerate((x.get("Gear") or {}).get("StatType") or [])],
            "fav": [x.get("FavorStatType") or [], x.get("FavorStatValue") or []],
            "star": x.get("StarGrade") or 1,
        }
        sinfo[sid] = [x.get("BulletType"), x.get("ArmorType"), x.get("SquadType")] + [
            ADAPT[x.get(k)] if isinstance(x.get(k), int) and 0 <= x.get(k) < 6 else x.get(k)
            for k in ("StreetBattleAdaptation", "OutdoorBattleAdaptation",
                      "IndoorBattleAdaptation")]
        # **EX が途中で変わる子は、形態ごとにダメージもバフも別物。**
        # SchaleDB は `Skills.Ex.ExtraSkills[]` に持っている。ネル（制服）の
        # 「怪我しても知らねえからな」は倍率 1983%・46 ヒットで、この編成の主砲。
        # **採番は `tools/cost-timeline/data.js` の `xs` と同じ**（コストを持つ行だけ
        # 数えて、1 番目が `Ex1`）。engine の `forms()` が `[本体, xs[0], …]` なので
        # 形態 `fi` の枠は `fi ? "Ex" + fi : "Ex"` で引ける（2026-09-01）
        skills_map = dict(x.get("Skills") or {})
        # **変身後の通常攻撃**（2026-09-04、61f）。`Skills.Normal.FormChange` に
        # 効果もフレームも丸ごと入っている（14 人）。`NormalF` という別の枠で持つ
        _nf = (skills_map.get("Normal") or {}).get("FormChange")
        if isinstance(_nf, dict):
            skills_map["NormalF"] = _nf
        _ex = skills_map.get("Ex")
        # **形態が変わる EX の「変わった先」は、変わる引き金の `Special` が
        # 必ず付いている。**本体 `Ex` が配る `Special` の `Key` を控えておいて、
        # 形態側のダメージ条件がその Key の有無を見ているときは決着が付く
        # （2026-09-01。ネル（制服）の Ex1 が `CH0280_Ex_01` の有無 2 通り ×
        # 段 5 通りの 10 候補になっていて、既定が「無いとき」＝ 1 発 12% 低い
        # ほうだった。形態 `Ex1` を撃てている時点で `CH0280_Ex_01` はある）
        _form_keys = set()
        if isinstance(_ex, dict):
            for _e in (_ex.get("Effects") or []):
                if _e.get("Type") == "Special" and _e.get("Key"):
                    _form_keys.add(_e["Key"])
            _fi = 0
            for _xs in (_ex.get("ExtraSkills") or []):
                if not _xs.get("Cost"):
                    continue
                _fi += 1
                skills_map["Ex" + str(_fi)] = _xs
                nform += 1

        def _form_cond(kind, c):
            """形態側スキルの条件を「決着済み(True/False)」か「不明(None)」で返す。"""
            if not (isinstance(c, dict) and re.match(r"^Ex\d+$", kind or "")):
                return None
            if c.get("Type") != "Special" or c.get("Operand") != "Exists":
                return None
            if c.get("Parameter") not in _form_keys:
                return None
            return bool(c.get("Value"))
        per_skill, per_buff, per_alt = {}, {}, {}
        for kind, sk in skills_map.items():
            if not isinstance(sk, dict):
                continue
            # **同じスキルに `Condition` つきのダメージが並ぶことがある。**
            # ネル（制服）の通常攻撃は「EX の状態でないとき 100%／であるとき 120%」の
            # 2 件で、全部足すと 2.2 倍になっていた（2026-09-01 に実物の TL を
            # 写していて気づいた）。
            #
            #   条件なしのぶん → `dmg` に入れて**全部足す**
            #   条件つきのぶん → `dmgalt` に**候補として並べる**。画面で 1 つ選ぶ
            #
            # **推測で条件を判定しない。**条件の中身は原文のまま持って画面にも出す
            # （2026-09-01 の先生の指示「幅がある場合は、バーで倍率を選択できるように」）
            # **`Accumulation` も入れる**（2026-09-03、56c）。`Type` が `Damage` で
            # 始まらないので、今まで `_row` に入る前に落ちていた
            dmg_all = [e for e in (sk.get("Effects") or [])
                       if str(e.get("Type", "")).startswith("Damage")
                       or e.get("Type") == "Accumulation"]
            # 形態側スキルで決着の付く条件は、ここで畳む。
            # False（有り得ない）は捨て、True（必ず成り立つ）は条件なし扱い
            dmg_all = [e for e in dmg_all
                       if _form_cond(kind, e.get("Condition")) is not False]
            plain = [e for e in dmg_all if not e.get("Condition")
                     or _form_cond(kind, e.get("Condition")) is True]
            cond = [e for e in dmg_all if e.get("Condition")
                    and _form_cond(kind, e.get("Condition")) is None]
            # **説明文の行ごとの「N 回毎に」**。`<?K>` が入っている行を
            # `DescParamId` K の行として結び付ける
            _every = {}
            for _seg in re.split(r"[/\n]", sk.get("Desc") or ""):
                _mm = re.search(r"スキルの発動(\d+)回毎に", _seg)
                if not _mm:
                    continue
                for _pm in re.finditer(r"<\?(\d+)>", _seg):
                    _every[int(_pm.group(1))] = int(_mm.group(1))
            def _row(e):
                # **6〜8 番目は 2026-09-01 に足した。**
                #   Period/Duration … `DamageDebuff` は継続ダメージ。
                #     `Duration / Period` 回ぶん出る。1 回ぶんしか数えていなくて、
                #     ヒビキ（応援団）で 30 分の 1 になっていた
                #   IgnoreDef … 防御無視。写し元の
                #     `getDefenseDamageReductionMod(base, rate)` の第 2 引数
                #   HitFrames … 「1 秒毎に N 秒間」型。**その配列の長さだけフル発が出る。**
                #     チセ・サヤ・サヤ（私服）・チェリノ（温泉）・メグの 5 人 6 枠で、
                #     落としていて 1 発ぶんしか数えていなかった（2026-09-01 の全キャラ照合）
                #   Zone … 範囲が居座るもの（ミサキ EX）。
                #     `ZoneDuration / ZoneHitInterval` 回、`Hits` の数だけ範囲がある
                #   Stab … `ApplyStability` が false のものは
                #     **安定値のばらつきを受けず、いつも最大ダメージ**
                #     （説明文が「この攻撃は安定値に影響されず最大ダメージが適用される」）。
                #     運んでいなかったので、その発が 1.26 倍ぶん少なく出ていた。
                #     **SchaleDB の students に 3 件だけある**（ヒナ（ドレス）の
                #     CH0230Ex02/03/04。2026-09-02 に全件数えて確かめた）
                return [e.get("Scale"), e.get("Hits"), e.get("CriticalCheck"),
                        e.get("Block"), e.get("Period"), e.get("Duration"),
                        e.get("IgnoreDef"), e.get("HitFrames"),
                        [e["ZoneDuration"], e["ZoneHitInterval"]]
                        if e.get("ZoneDuration") else None,
                        0 if e.get("ApplyStability") is False else None,
                        #   Mul … 倍率が別のものに比例する（イズミの `InvokerCurrentHP`、
                        #     ジュンコの `InvokerLostHP`）。**運んでいなかった。**
                        #     `MultiplierConstant` と対で、無ければ両方 null
                        e.get("MultiplySource"), e.get("MultiplierConstant"),
                        #   Type … 効果の型。**持続ダメージ（`DamageDebuff`）を
                        #     見分けるため**（2026-09-03）。`Period` の有無では
                        #     足りない。メルの `DamageByHit` も原文は `DamageDebuff`
                        #     なのに `Period` を持たない
                        #   ApplyFrame … 効果が始まるまでのフレーム。持続ダメージを
                        #     時間に散らすのに要る（サオリ（水着）2F・アズサ（水着）66F・メル 152F）
                        e.get("Type"), e.get("ApplyFrame"),
                        #   NsEvery … 「ノーマルスキルの発動 N 回毎に」（2026-09-03）。
                        #     ミカの隕石（339%）がこれで、毎回数えると NS の出力が
                        #     1.8 倍になる。**機械で読める欄が無い**ので説明文の行から拾う。
                        #     全 274 人で当たるのは 2 件だけ（ミカ・ウミカ。後者はダメージ無し）
                        _every.get(e.get("DescParamId")),
                    #   HitCap … `DamageByHit` の上限回数（2026-09-03）。
                    #     「その敵が攻撃を受ける度に」出るぶんで、いま 1 回ぶんしか
                    #     数えていない。出どころは `dbh_cap` の注記
                    dbh_cap(e),
                    #   StatMod … 撃つ子の能力でダメージが変わるもの（2026-09-03、56a）。
                    #     `Source` は全件 `Caster`（274 人を数えた。中身は
                    #     `EnhanceExDamageRate` と `AttackSpeed` の 2 種類だけ）。
                    #     その能力が `MinStatValue`〜`MaxStatValue` の間を動くと
                    #     倍率が `MultiplierMin`〜`MultiplierMax`（1 万分率）に伸びる。
                    #       オトギ Normal/Public  EnhanceExDamageRate 10000〜20000 → 1.0〜2.0 倍
                    #       エイミ（臨戦）Public   AttackSpeed 10000〜25000 → 1.0〜2.4 倍
                    ([e["StatModifier"].get("Stat"),
                      e["StatModifier"].get("MinStatValue"),
                      e["StatModifier"].get("MaxStatValue"),
                      e["StatModifier"].get("MultiplierMin"),
                      e["StatModifier"].get("MultiplierMax")]
                     if e.get("StatModifier") else None),
                    #   HpRate … 当たる先の HP でダメージが変わるもの（2026-09-03、56b）。
                    #     8 行 7 人。`MinHpRate` は全件 0、`MaxHpRate` は全件 10000 で、
                    #     倍率は HP の割合 h で
                    #     `MultiplierMin + (MultiplierMax − MultiplierMin) × h`。
                    #       カリン（制服）Ex/Public  3 → 1     ＝ 3 − 2h（前に読んだ値と一致）
                    #       ヒビキ GearPublic        2 → 1
                    #       アスナ・フィーナ（ガイド）  1.5 → 1
                    #       ミカ Ex                1 → 2
                    #       ナグサ Ex               1 → 3
                    ([e["TargetHpRateModifier"].get("MinHpRate"),
                      e["TargetHpRateModifier"].get("MaxHpRate"),
                      e["TargetHpRateModifier"].get("MultiplierMin"),
                      e["TargetHpRateModifier"].get("MultiplierMax")]
                     if e.get("TargetHpRateModifier") else None),
                    #   Acc … 蓄積（2026-09-03、56c）。出どころは `acc_info` の注記
                    acc_info(e)]
            # **`Group` は「何段目か」で、足すものではなく択一。**
            # ネル（制服）の Ex1 は Group 0〜4 × 条件 2 通りの 10 件あって、
            # 全部足すと 1 発 5,727,546（ボス HP の 25%）になっていた。
            # 正しくは 1 つだけ乗る（2026-09-01。先生の実測「ネル後ボス HP 15.3M」
            # と 2 倍以上ずれていたのを追って見つけた）。
            # 写し元の SchaleDB も `stackEffectIndex[key][stackCount-1]` で
            # **1 つだけ出している**（common.js 2820 行）。
            #
            #   条件も段も無い  → `dmg`。**必ず乗るぶん**
            #   どちらかがある  → `dmgalt`。**画面のバーで 1 つ選ぶ**
            # **説明文が「どちらか一方」と言っているぶんを抜く**（2026-09-03）。
            # `Condition` も `Group` も持たないので、ここで抜かないと足してしまう
            _excl = tl_excl_desc(sk)
            xcand = ([e for e in plain
                      if e.get("Group") is None and _excl.get(e.get("DescParamId"))]
                     if _excl else [])
            _xid = set()
            if len(xcand) < 2:
                xcand = []
            else:
                _xid = {id(e) for e in xcand}
                plain = [e for e in plain if id(e) not in _xid]
            plain0 = [e for e in plain if e.get("Group") is None]
            stack = [e for e in plain if e.get("Group") is not None]
            eff = [_row(e) for e in plain0]
            if eff:
                per_skill[kind] = eff
                ndmg += len(eff)
            if cond or stack or xcand:
                # **同じ（条件, 段）のものは 1 つの候補にまとめて足す。**
                # 1 発の中で同時に出るぶんは足すのが正しい。
                # **条件や段をまたいで足さない**
                order, group = [], {}
                _glab = tl_group_labels(sk)
                for e in xcand + cond + stack:
                    lab = (cond_label(e.get("Condition"))
                           if e.get("Condition")
                           and _form_cond(kind, e.get("Condition")) is None else "")
                    if id(e) in _xid:
                        lab = _excl[e["DescParamId"]]
                    if e.get("Group") is not None:
                        _gl = _glab.get(e["Group"])
                        lab = ((lab + " / " if lab else "") +
                               (_gl or f"段 {e['Group'] + 1}"))
                    if lab not in group:
                        order.append(lab)
                        group[lab] = []
                    group[lab].append(_row(e))
                per_alt[kind] = {"c": order, "v": [group[l] for l in order]}
                ncond += len(cond) + len(stack)
                if stack:
                    nstack += 1
            # ---- バフ・デバフ。
            # **`Restrictions` は飛ばさない。**中身は「相手の Id / Size /
            # BulletType / ArmorType / TacticRole がこうなら乗る」という条件で、
            # **どれも手元のデータで判定できる**（2026-09-01 に 30 件すべてを
            # 目で確かめた。イブキ（水着）の「アタッカーの味方に会心ダメージ」も
            # これで、飛ばしていたぶんそのまま損をしていた）。7 番目に原文を
            # そのまま渡して、画面側で当てはめる。
            # **`Condition` と `Period` は今までどおり飛ばす。**こちらは戦闘中の
            # 状態（HP・スタック・経過）で、データからは決められない
            # **範囲を持つ枠に印を付ける**（2026-09-03）。
            # `Radius` は「どのくらいの広さに当たるか」で、**そこに何体いるかは
            # データに無い**（2026-09-03 に確かめ直した）。それでも
            # 「1 人だけに当たる発」と「範囲の発」は分けられるので、
            # 転移する部位が盤に居るボス（ペロロジラの大きなペロロミニオンなど）で
            # 当たる数の既定を決めるのに使う
            _rad = sk.get("Radius")
            if _rad:
                _r0 = _rad[0] or {}
                # **形は SchaleDB の 6 欄をそのまま。**末尾の空欄は落とす
                _ar = [_r0.get("Type"), _r0.get("Radius"), _r0.get("Degree"),
                       _r0.get("Width"), _r0.get("Height"), _r0.get("ExcludeRadius")]
                while len(_ar) > 2 and _ar[-1] is None:
                    _ar.pop()
                area_out.setdefault(sid, {})[kind] = _ar
                # **中心と狙い方は `LevelSkill` から。**引けない枠は載せない
                _gm = _ls_geom(_skill_gid(csl_all.get(x["Id"]), kind))
                if _gm:
                    geo_out.setdefault(sid, {})[kind] = _gm
                    ngeo += 1
            # **届く距離**（SchaleDB の `Range`。506 枠が持っている）。
            # どの生徒がどの体に届くかは、これが無いと決まらない
            if sk.get("Range"):
                rng_out.setdefault(sid, {})[kind] = sk["Range"]
            bl = []
            for e in (sk.get("Effects") or []):
                if e.get("Type") != "Buff" or not e.get("Stat"):
                    continue
                if e.get("Condition") or e.get("Period"):
                    nskip += 1
                    continue
                v = e.get("Value") or []
                if not v or not isinstance(v[0], list):
                    nskip += 1
                    continue
                # **`Target` は文字列のことがある**（"Self" / "Ally"）。
                # そのまま渡すと画面側で 1 文字ずつに割れる（2026-09-01 に踏んだ）
                tg = e.get("Target") or []
                if isinstance(tg, str):
                    tg = [tg]
                row = [tg, e["Stat"], e.get("Channel"),
                       v[0], e.get("Duration"), e.get("ApplyFrame") or 0]
                rs = e.get("Restrictions")
                if rs:
                    row.append([[r.get("Property"), r.get("Operand"), r.get("Value")]
                                for r in rs])
                    nrst += 1
                # **`OverrideSlot` は Channel の重なりを見る枠を差し替える**
                # （`common.js:7706`。2026-09-03 に足した。全 274 人で 8 件だけ
                # あって、効くのは クルミ の `ExtraPassive` ch30 → `Ex`。
                # 同じ ch30 の `Ex` のバフと重なる）。**7 番目は空でも埋める**
                ov = e.get("OverrideSlot")
                if ov:
                    while len(row) < 7:
                        row.append(None)
                    row.append(ov)
                    novr += 1
                # **`Value` の 2 本目以降は「段（スタック）ごとの値」**
                # （`common.js:1219` の `getEffectValue`）。
                #   `StackSame` あり … `Value[0][Lv-1] * 段数`（上限が `StackSame`）
                #   なし             … `Value[min(段-1, 本数-1)][Lv-1]`
                # 4 番目には今までどおり 1 段目を入れてある（既定が動かないように）。
                # 全 274 人で 2 本以上が 44 件・`StackSame` が 12 件（2026-09-03）
                ss = e.get("StackSame")
                if ss or len(v) > 1:
                    while len(row) < 8:
                        row.append(None)
                    row.append(v if len(v) > 1 else None)
                    row.append(ss)
                    nstk += 1
                bl.append(row)
                nbuf += 1
            if bl:
                per_buff[kind] = bl
        if per_skill:
            dmg_out[sid] = per_skill
        if per_alt:
            alt_out[sid] = per_alt
        if per_buff:
            buf_out[sid] = per_buff
        # ---- 通常攻撃（オートアタック）。**周期は `Skills.Normal.Frames`。**
        # SchaleDB の `students.min.json` が `LevelSkill/<NormalSkillGroupId>.json` の
        # `AnimationFrames` をそのまま持っているので、ここから引ける（274 人ぶん
        # LevelSkill を叩き直さなくてよい。2026-09-01 に確かめた）。
        #   AttackEnterDuration        構えるまで（戦闘開始と、動いたあとの 1 回）
        #   AttackStartDuration        撃ち始め
        #   AttackIngDuration          **1 回の攻撃**。この中で `Hits` のぶんが飛ぶ
        #   AttackEndDuration          撃ち終わり
        #   AttackBurstRoundOverDelay  弾倉を撃ち切ったあとの待ち
        #   AttackReloadDuration       リロード
        # 弾倉 1 本で撃てる回数は `AmmoCount / AmmoCost`（ネル（制服）は 60/12 = 5 回）。
        # `NormalAttackSpeed` は `DB/CharacterStatExcelTable`（10000 = 等倍）。
        # **`Skills.Normal` が無い生徒は通常攻撃をしない**（SPECIAL に多い）
        nsk = (x.get("Skills") or {}).get("Normal")
        if isinstance(nsk, dict) and (nsk.get("Frames") or {}).get("AttackIngDuration"):
            fr = nsk["Frames"]
            na_out[sid] = {
                "ing": fr.get("AttackIngDuration"),
                "ent": fr.get("AttackEnterDuration"),
                "st": fr.get("AttackStartDuration"),
                "end": fr.get("AttackEndDuration"),
                "brd": fr.get("AttackBurstRoundOverDelay"),
                "rel": fr.get("AttackReloadDuration"),
                "ammo": x.get("AmmoCount"), "cost": x.get("AmmoCost"),
                "spd": dbs.get("NormalAttackSpeed") or 10000,
                "n": nsk.get("Name") or "通常攻撃",
            }
            nna += 1
            # **変身後の撃ち方**（2026-09-04、61f の残り）。`Normal.FormChange.Frames` に
            # 別の値が入っている。**14 人のうち実際に違うのは 4 人だけ**（残り 10 人は
            # 素と同じ値なので、入れても撃ち方は変わらない）:
            #   10062 トキ        AttackIngDuration 24 → 56（2.3 倍おそい）
            #   10100 シロコ＊テラー                30 → 35
            #   10130 スバル                      28 → 12（2.3 倍はやい。フルオート）
            #   10136 エイミ（臨戦）               42 → 60、**`FixedFrameRate` 10000 つき**
            # `naf` として `na` と同じ形で持つ。`fix` は `FixedFrameRate`（1 万分率）で、
            # **その間は攻撃速度のバフで速くならない**（エイミ（臨戦）の
            # 「攻撃速度が100%に固定される代わりに…」がこれ）
            _nfc = nsk.get("FormChange")
            if isinstance(_nfc, dict) and (_nfc.get("Frames") or {}).get("AttackIngDuration"):
                _ff = _nfc["Frames"]
                naf_out[sid] = {
                    "ing": _ff.get("AttackIngDuration"),
                    "ent": _ff.get("AttackEnterDuration"),
                    "st": _ff.get("AttackStartDuration"),
                    "end": _ff.get("AttackEndDuration"),
                    "brd": _ff.get("AttackBurstRoundOverDelay"),
                    "rel": _ff.get("AttackReloadDuration"),
                    "ammo": x.get("AmmoCount"), "cost": x.get("AmmoCost"),
                    "spd": dbs.get("NormalAttackSpeed") or 10000,
                    "fix": _nfc.get("FixedFrameRate"),
                    "n": (nsk.get("Name") or "通常攻撃") + "（変身後）",
                }
        # スキルの名前（EX・ノーマル・ノーマル＋・サブ）。レーンの札に使う
        nm = {}
        for kind, sk2 in skills_map.items():
            if isinstance(sk2, dict) and sk2.get("Name"):
                nm[kind] = sk2["Name"]
        if nm:
            skname[sid] = nm
        # **「味方 N 人」は説明文にしか無い。**`Effects[].Target` は
        # `AllyMain` / `AllySupport` としか書いておらず、**何人に当たるかも、
        # 自分を含むかも入っていない**（2026-09-01 に `students.min.json` を
        # 直接見て確かめた）。SchaleDB の画面もこの説明文を出している。
        # ここで拾うのは 2 つだけで、**訳さず、数だけ取る**。
        #   tg … 「味方 N 人」の N。書いていなければ None（範囲・全体・自分だけ）
        #   sx … 「自身を除く」と書いてあれば 1
        # 画面はこれを見て、1 人だけのものに「渡す相手」を選ばせる
        #
        # **人数が別の枠に書いてあることがある**（2026-09-01 の先生の指摘
        # 「イブキのお友達！は対象を 2 体選択するけど、選択できなくない？」）。
        # イブキ（水着）は `Ex` が「編成したストライカーの味方2人まで
        # <s:CH0347_Ex_03>に指定」で、**バフ本体は形態違いの `Ex1`** の
        # 「<s:CH0347_Ex_03>の生徒の会心ダメージ率を増加」。
        # 目印（`<s:…>`）で結んで、人数を借りる
        marks = {}
        for _k, _sk in skills_map.items():
            if not isinstance(_sk, dict):
                continue
            for _m in re.finditer(r"(\d+)人まで<s:([A-Za-z0-9_]+)>", _sk.get("Desc") or ""):
                marks[_m.group(2)] = int(_m.group(1))
        tg = {}
        for kind, sk2 in skills_map.items():
            if not isinstance(sk2, dict):
                continue
            ds = sk2.get("Desc") or ""
            eff2 = sk2.get("Effects") or []
            if not any(t in ("AllyMain", "AllySupport")
                       for e in eff2 for t in (e.get("Target") or [])):
                continue
            m = re.search(r"味方(\d+)人", ds)
            n_ally = int(m.group(1)) if m else None
            if n_ally is None:
                for _mk, _n in marks.items():
                    if ("<s:%s>" % _mk) in ds:
                        n_ally = _n
                        break
            tg[kind] = [n_ally, 1 if "自身を除" in ds else 0]
        if tg:
            tgt_out[sid] = tg
        # **「誰に配るか」の規則は `LevelSkill/<DevName><枠>01.json` の根にある**
        # （2026-09-04）。スキルの根に 3 つ並んでいて、意味はこう:
        #
        #   EssentialCandidateRule … 必須の絞り込み。`TargetSide`（Self /
        #     Ally / Ally_Except_Self / All_Except_Self / Enemy / …）、
        #     `TargetingType`（**Target = 撃つときに相手を指定する**／
        #     Position = 位置を指定する／None）、`MaxTargetCount`（-1 は全員）
        #   OptionalCandidateRule … 13 個の制約。**生徒の味方向けスキル 151 枠では
        #     全部が既定値**（2026-09-04 に数えた）ので、ここでは持ち出さない
        #   TargetSortRule … 並べ替え。`SortCriteria` と `OrderBy`
        #
        # **`SortCriteria` は説明文と 1 対 1 で合う。**
        #   カエデ  `CH0116Public01`  Stat/Highest SortStat 3   「防御力が最も高い味方1人」
        #   トモエ（チーパオ）`CH0271Public01` Stat/Highest SortStat 2 「攻撃力が最も高い味方1人」
        #   ヤクモ  `CH0228Public01`  Stat/Highest SortStat 12  「会心ダメージ率が最も高い味方1人」
        #   シグレ  `CH0122Public01`  AttackPower/Highest       「自身を除く攻撃力が最も高い味方1人」
        #   フウカ  `FuukaPublic01`   MaxHP/Highest             「最大HPが最も高い味方1人」
        #   マリー（体操服）`CH0186Public01` DefensePower/Highest 「自身を除く防御力が最も高い味方1人」
        #   レナ    `CH0305Public01`  HPRate/Lowest             「自身を除くHPが最も低い味方1人」
        #   レナ    `CH0305Ex01`      DebuffCount/Highest       「自身を除く味方1人の弱体状態を1つ解除」
        #
        # **`Distance/Lowest` は「いちばん近い味方」で、説明文が「味方1人」としか
        # 書かないものが全部これ。**位置は道具に無いので決まらない——つまり
        # **撃つときに人が指定する枠**。ヒマリ（臨戦）`CH0332Public01` の説明文が
        # 「（EXスキルの使用時に**指定した味方**を優先とします）」と書いていて、
        # 「指定」が実在の仕掛けであることの裏づけになっている
        for kind in tg:
            if kind not in ("Ex", "Public", "GearPublic", "ExtraPassive"):
                continue
            # **名札は `CharacterSkillListExcelTable` から引く**（2026-09-04）。
            # `DevName + 枠 + "01"` の当てずっぽうは、愛用品の段や形態で
            # 名前が変わる子で静かに外れる（Lunatic の大ペロロが
            # `Perorozilla01**Insane**MiddleSize01Passive01` を持っていたのと同じ穴）
            key = _skill_gid(csl_all.get(x["Id"]), kind)
            if not key:
                continue
            if key in _tsel_cache:
                d_ls = _tsel_cache[key]
            else:
                try:
                    d_ls = get_json(BALS.format(key))
                except urllib.error.HTTPError:
                    d_ls = {}
                _tsel_cache[key] = d_ls
            ess = (d_ls or {}).get("EssentialCandidateRule") or {}
            srt = (d_ls or {}).get("TargetSortRule") or {}
            if not ess.get("TargetSide"):
                continue
            tsel_out.setdefault(sid, {})[kind] = [
                ess.get("TargetSide"), ess.get("TargetingType"),
                ess.get("MaxTargetCount"), srt.get("SortCriteria"),
                srt.get("OrderBy"), srt.get("SortStat")]
        # **変身後の通常攻撃の切れ方**（2026-09-04、61f）。出どころは `fchg_of` の注記
        if (x.get("Skills") or {}).get("Normal", {}).get("FormChange"):
            _fv = fchg_of(x.get("DevName"))
            if _fv:
                fchg_out[sid] = _fv
    print(f"  生徒 {len(st_out)} 人 / ダメージを持つ生徒 {len(dmg_out)} 人・効果 {ndmg} 件")
    print(f"  バフ {nbuf} 件（条件つき・周期ものを {nskip} 件外した／"
          f"相手の条件つき {nrst} 件は判定して乗せる／"
          f"枠を差し替える OverrideSlot {novr} 件／"
          f"段（スタック）を持つ {nstk} 件）")
    print(f"  条件つき・段つきのダメージ {ncond} 件を候補にした（生徒 {len(alt_out)} 人・"
          f"スキル {sum(len(v) for v in alt_out.values())} 枠／うち段つき {nstack} 枠）")
    print(f"  通常攻撃（オートアタック）が引けた生徒 {nna} 人 / {len(st_out)} 人")
    _nar = sum(len(v) for v in area_out.values())
    print(f"  範囲を持つ枠 {_nar} 個 / 中心と狙い方が引けた枠 {ngeo} 個"
          f"、届く距離 {sum(len(v) for v in rng_out.values())} 個")
    print(f"  EX の形態違い {nform} 件（Skills.Ex.ExtraSkills）")
    _one = sum(1 for v in tgt_out.values() for r in v.values() if r[0] == 1)
    print(f"  味方に効くスキル {sum(len(v) for v in tgt_out.values())} 枠 / "
          f"うち「味方1人」が {_one} 枠（説明文から）")
    import collections as _c
    import re as _re
    _tsc = _c.Counter(r[3] for v in tsel_out.values() for r in v.values())
    print(f"  相手選びの規則 {sum(len(v) for v in tsel_out.values())} 枠"
          f"（LevelSkill の根の EssentialCandidateRule / TargetSortRule）/ "
          + " ".join(f"{k}={n}" for k, n in _tsc.most_common()))
    print("  NS の自動発動 " + str(nns) + " 件 / 内訳 "
          + str(_c.Counter(v[1] for l in ns_out.values() for v in l).most_common()))
    print("  SS の引き金 " + str(nep) + " 人 / Event の内訳 "
          + str(_c.Counter(v[0] for v in ep_out.values()).most_common(8)))

    # ---- サブスキルの条件が指す `Dummy_*` を、**誰のどのスキルが付けるか**へ解く。
    # 出どころは `DB/LogicEffect_PC.json`（26,273 件）。`TemplateId` で引くと
    # `GroupId` が `<DevName>_<枠><NN>_Effect<NN>` の形で入っていて、
    # **その札を付けるスキルの枠が読める**（2026-09-03）。
    # `EndConditionArgument` が持続（ミリ秒）、`StackSameEffectCount` が重ねられる数。
    # **本人のスキルが付けるぶんだけ採る。**マリナ（チーパオ）の毒はミドリ・ジュリ・
    # サヤも付けるが、他人ぶんは時刻が決まらないので入れない
    ep_tpl, ntpl = {}, 0
    if ep_tid:
        _le = as_list(get_json(BADB.format("LogicEffect_PC")))
        _by = {}
        for _r in _le:
            _t = _r.get("TemplateId")
            if _t:
                _by.setdefault(_t, []).append(_r)
        _dev = {str(x["Id"]): (x.get("DevName") or "") for x in stu}
        _sk = {str(x["Id"]): (x.get("Skills") or {}) for x in stu}
        # **`StackSameEffectCount` は「同じ札を何枚まで重ねられるか」の内部の上限で、
        # プレイヤーが数える個数とは限らない**（2026-09-04。段を持つ 8 件を全部読んだ）。
        # 数える札は、付ける枠の説明文に必ず個数が書いてある。原文:
        #   ハレ（キャンプ）Ex    さらに自身に<s:CH0233_ExtraPassive>を5個付与（最大15個まで重複）
        #   カズサ（バンド）Ex    さらに、自身に<s:CH0220_Public>を<?2>付与（40秒間）（最大2個まで）
        #   ヒカリ ExtraPassive  <s:CH0242_ExtraPassive_01>を1つ獲得
        #                        （<s:CH0242_ExtraPassive_01>は最大3つまで重複）
        # **レンゲ（10082）だけは個数がどこにも出てこない。**原文:
        #   Public      30秒毎に、<s:CH0224_Public>状態を付与。<b:ATK>を<?1>増加（22秒間）
        #   GearPublic  30秒毎に、<s:CH0224_Public>状態を付与。<b:ATK>を<?1>増加（22秒間）/
        #               <s:CH0224_Public>状態でのEXスキルは敵の防御力を35%無視します。
        #   ExtraPassive <s:CH0224_Public>状態での攻撃時、攻撃力の<?1>分の追加ダメージ
        # あれは**「状態」で、数えるものではない**（`LogicEffect_PC` の 50 は貼り直しの
        # 内部の上限）。数えるものだと運んでいたので、道具が「段は数えられない」と
        # 判じてレンゲのサブスキルを 1 発も置いていなかった。
        # **説明文がある枠で個数が 1 つも出てこないときは 0 にする。**
        # 説明文が無い枠（ヨシミ（バンド）の `HiddenPassive`）はそのまま
        _num = _re.compile(r"(?:\d+|<\?\d+>)\s*[個つ]")
        # 1 回で付く個数と、サブスキル 1 発で減る個数。**説明文にしか無い**
        # （`LogicEffect_PC` の `StackSameEffectApplied` は真偽値で、枚数を持たない）。
        #   ハレ（キャンプ）  付く 5（EX の「5個付与」）／
        #                     減る 1（SS の「さらに自身の<s:CH0233_ExtraPassive>が1個減少」）
        _gain = _re.compile(r"を(\d+)\s*[個つ](?:付与|獲得)")
        _lose = _re.compile(r"が(\d+)\s*[個つ]減少")
        _slot = _re.compile(r"^(.+?)_(Ex|Public|GearPublic|HiddenPassive|ExtraPassive|Passive|WeaponPassive)\d*_")
        for _sid, _tids in ep_tid.items():
            for _t in _tids:
                _rows = _by.get(_t) or []
                _hit = None
                for _r in _rows:
                    _m2 = _slot.match(_r.get("GroupId") or "")
                    if not _m2 or _m2.group(1) != _dev.get(_sid):
                        continue
                    _du = _r.get("EndConditionArgument")
                    if _hit is None or (_du or 0) > (_hit[1] or 0):
                        _hit = [_m2.group(2), _du, _r.get("StackSameEffectCount") or 0]
                if _hit:
                    _d = ((_sk.get(_sid) or {}).get(_hit[0]) or {}).get("Desc")
                    if _hit[2] and _d and not _num.search(_d):
                        _hit[2] = 0
                    _g = _gain.search(_d or "")
                    _l = _lose.search(
                        ((_sk.get(_sid) or {}).get("ExtraPassive") or {}).get("Desc") or "")
                    _hit += [int(_g.group(1)) if (_g and _hit[2]) else None,
                             int(_l.group(1)) if (_l and _hit[2]) else None]
                    ep_tpl.setdefault(_sid, {})[_t] = _hit
                    ntpl += 1
        print("  SS の条件の札 " + str(ntpl) + " 件を解いた（生徒 "
              + str(len(ep_tpl)) + " 人）／内訳 "
              + str(_c.Counter(v[0] for m in ep_tpl.values() for v in m.values()).most_common()))

    used = sorted({g for x in bosses for r in x["d"] for g in r["ex"]}
                  | {r["ns"] for x in bosses for r in x["d"] if r["ns"]})
    skills = {g: {"n": rsk[g].get("Name"), "d": rsk[g].get("Desc")}
              for g in used if g in rsk}
    print(f"  ボス {len(bosses)} 体 / 秒つき {ok} 件・ゲージのみ {half} 件・出せない {len(ng)} 件")
    if ng:
        print("    出せない: " + ", ".join(ng))
    (ROOT / "tools" / "tl").mkdir(parents=True, exist_ok=True)
    # **変数名は `TLBOSS`。**`tools/cost-timeline/data.js` が既に `window.TL` を使っている
    # ので、同じ名前にすると後から読んだほうが前を消す（2026-08-31 に気づいた）
    return write_js("tools/tl/data.js", "TLBOSS", {
        "fps": TL_FPS, "bosses": bosses, "skills": skills,
        "stats": st_out,
        "statKeys": SD_STAT + ["StabilityRate", "DefensePenetration1",
                               "DefensePenetration100"],
        "dmg": dmg_out,
        "dmgKeys": ["Scale", "Hits", "CriticalCheck", "Block", "Period",
                    "Duration", "IgnoreDef", "HitFrames", "Zone", "Stab",
                    "MultiplySource", "MultiplierConstant", "Type", "ApplyFrame",
                    "NsEvery(ノーマルスキルの発動 N 回毎に)"],
        # 条件でダメージが変わるもの。**画面のバーで 1 つ選ぶ。**
        # `c` は条件の原文、`v[i]` はその候補ぶんの効果（`dmg` と同じ並び）
        "dmgalt": alt_out,
        # 答え合わせの済み・未済。**キーはボスの `DevName`**、値は [印, 一言]。
        # 表は `TL_VERIFY`（このファイルの上）にある。画面に出るのは印だけ
        "vfy": {k: list(v) for k, v in TL_VERIFY.items()},
        "sinfo": sinfo,
        "sinfoKeys": ["BulletType", "ArmorType", "SquadType",
                      "StreetBattleAdaptation", "OutdoorBattleAdaptation",
                      "IndoorBattleAdaptation"],
        "bam": bam, "ter": ter, "trans": trans,
        "build": build, "eqp": eqp_out, "buf": buf_out,
        "ns": ns_out, "skname": skname, "tgt": tgt_out, "tsel": tsel_out,
        "tselKeys": ["TargetSide", "TargetingType", "MaxTargetCount",
                     "SortCriteria", "OrderBy", "SortStat"],
        "fchg": fchg_out, "statJA": stat_ja,
        # 通常攻撃。**フレームは 30fps。`spd` は 10000 が等倍**
        "na": na_out, "naf": naf_out,
        "nsKeys": ["MinimumTierCharacterGear", "ConditionType",
                   "ConditionArgument(フレーム)", "Duration(フレーム)",
                   "MaxTriggerCount(-1 は無制限、1 は戦闘中1回のみ)",
                   "CoolTimeNotTrigger(フレーム。ConditionArgument が 1 のときはこちらが周期)",
                   "TryCount(OnAttackIng の「通常攻撃 N 回毎に」の N)",
                   "TriggerRate(1万分率。10000 以外は確率)",
                   "FormIndex(その行の形態)",
                   "FormIndexCheck(この形態のときだけ発動する)",
                   "cnt(変身している間の通常攻撃 N 発目。ns_count が辿れたものだけ)"],
        # サブスキルの引き金。**ダメージ・効果の時刻はここからしか出ない**
        "ep": ep_out,
        "epKeys": ["Event", "Parameters", "ConditionExpression", "TriggerRate",
                   "MaxTriggerCount", "TryCount", "CoolTimeNotTrigger", "Duration",
                   "Modifiers(アビリティごと [[{t: 型, …}], …]。中は かつ・間は または)"],
        # サブスキルの条件が指す札 →
        #   [付けるスキルの枠, 持続(ms。-1 は時間で切れない),
        #    数える個数（説明文に個数が書いてあるときだけ。書いていなければ 0）,
        #    1 回で付く個数, サブスキル 1 発で減る個数]
        # **4 番目・5 番目は説明文からしか出ない**（`LogicEffect_PC` は真偽値しか持たない）
        "eptl": ep_tpl,
        # **範囲の形と半径**（`Skills.<枠>.Radius`）。**何体いるかは入っていない**
        "area": area_out,
        "geo": geo_out,
        "geoKeys": ["SpawnPositionType", "TargetingType", "TargetSide",
                    "MaxTargetCount", "Range", "HitFrames", "AreaDAO",
                    "PositionOffset(ワールド)", "AngleOffset", "SpawnDirectionType"],
        "rng": rng_out,
        "areaKeys": ["Type(Circle/Fan/Obb/Donut/Bounce)", "Radius",
                     "Degree", "Width", "Height", "ExcludeRadius"],
        "bufKeys": ["Target", "Stat", "Channel", "Value", "Duration", "ApplyFrame",
                    "Restrictions([Property,Operand,Value])",
                    "OverrideSlot(Channel の重なりを見る枠の差し替え)",
                    "Value全部(段ごと。2 本以上あるときだけ)",
                    "StackSame(1 段ぶんの値に段数を掛ける型。上限の段数)"],
        # 星の伸び。SchaleDB の CharacterStats の既定値（生徒別の Transcendence は
        # jp のデータに 1 件も無いことを 2026-09-01 に確かめた）
        "tc": [[0, 1000, 1200, 1400, 1700], [0, 500, 700, 900, 1400],
               [0, 750, 1000, 1200, 1500]],
        "maxbond": [10, 10, 20, 20, 50],
        # ダメージの定数。**出典は Excel/ConstCombatExcelTable.json**（DB/ に無いので
        # v1.57 凍結の値。2026-08-31 に確かめた）と、SchaleDB js/common.js の式
        "const": {"defA": 10000, "defC": 6000, "accA": 10000, "accC": 3000,
                  "crtA": 4000, "crtC": 6000,
                  "stabK": 1000, "lvStep": 200, "lvCap": 30,
                  "cdBase": 20000, "cdResistBase": 5000, "coverBase": 3000},
        "version": "ba-data jp DB/ + SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


BUILDERS = {"bond": build_bond, "teacher-level": build_teacher_level,
            "equipment": build_equipment, "tier": build_tier, "raid": build_raid,
            "student-cost": build_student_cost, "treasure": build_treasure,
            "cost-timeline": build_cost_timeline,
            "raid-calendar": build_raid_calendar,
            "gear-stats": build_gear_stats,
            "raid-score": build_raid_score,
            "eleph": build_eleph,
            "gift-search": build_gift_search,
            "matchup": build_matchup,
            "potential": build_potential,
            "weapon": build_weapon,
            "farm": build_farm,
            "equip-level": build_equip_level,
            "schedule": build_schedule,
            "cafe": build_cafe,
            "cafe-layout": build_cafe_layout,
            "gacha": build_gacha,
            "tl": build_tl,
            "ui": build_ui}

if __name__ == "__main__":
    want = sys.argv[1:] or list(BUILDERS)
    changed = False
    for w in want:
        if w not in BUILDERS:
            raise SystemExit(f"知らない対象: {w}（{', '.join(BUILDERS)}）")
        changed |= bool(BUILDERS[w]())
    print("変化あり" if changed else "変化なし")
