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
import io, json, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "tools" / "img"
BA = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/{}.json"
# **同じリポジトリの DB/ 側。**Excel/ にも同名のファイルがあるが、
# EventContentTreasure 系は Excel/ 側が空の殻で、中身は DB/ にしか無い
BADB = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/DB/{}.json"
# **GitHub の SchaleDB/SchaleDB は 2024-08 で止まっている**（build 1723935982）。
# 生徒が 194 人しか入っておらず、実際の 274 人と 80 人ずれる。
# 本番サイトのほうは毎日更新されているので、そちらを見る（2026-08-30 に発見）。
SD = "https://schaledb.com/data/jp/{}.min.json"
SD_CFG = "https://schaledb.com/data/config.json"

CROP = (12, 0, 134, 116)      # 146×116 の中で、どの絵もはみ出さない横方向の枠
SQUARE = 122


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "arona-guide/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def get_json(url):
    return json.loads(get(url).decode("utf-8"))


def as_list(d):
    """ba-data は {"DataList": [...]}、SchaleDB は配列か id をキーにした辞書。"""
    if isinstance(d, dict):
        if "DataList" in d:
            return d["DataList"]
        return list(d.values())
    return d


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


def write_js(path, var, obj, header=""):
    p = ROOT / path
    body = header + f"window.{var} = " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    old = p.read_text(encoding="utf-8") if p.exists() else ""
    if old == body:
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
    favor = get_json(BA.format("FavorLevelExcelTable"))
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
        stu.append({"id": s["Id"], "n": s["Name"],
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
    acc = as_list(get_json(BA.format("AccountLevelExcelTable")))
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


def build_equipment():
    print("装備設計図の周回計算機")
    equip = as_list(get_json(BA.format("EquipmentExcelTable")))
    recipe_ing = as_list(get_json(BA.format("RecipeIngredientExcelTable")))
    gacha_el = as_list(get_json(BA.format("GachaElementExcelTable")))
    # **ステージのドロップは SchaleDB を正本にする。**ba-data の jp ブランチには
    # 2026-04-21 に実装された万能設計図がまだ入っていない（該当 Id が 1 件も無い）。
    # SchaleDB の stages には万能設計図も固定数・確率つきで載っている
    loc_stage = [x for x in as_list(get_json(SD.format("stages")))
                 if x.get("Category") == "Campaign"]
    # **名前は SchaleDB から。**ba-data 側は LocalizeEtcId しか持っていない。
    # ただし SchaleDB には T10 の設計図（101009 など）がまだ入っていないので、
    # 部位・Tier・レシピは ba-data を正本にして、名前だけ引く
    sd_name = {e["Id"]: e.get("Name", "") for e in as_list(get_json(SD.format("equipment"))) if e.get("Id")}

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

    def icon_of(e):
        # ba-data の Icon は "UIs/01_Common/02_Equipment/Equipment_Icon_Hat_Tier2_Piece"
        return str(e.get("Icon", "")).split("/")[-1].lower()

    # 設計図（piece）の Id → (部位, Tier)
    piece, names, max_tier = {}, {}, {}
    for e in equip:
        cat, tier = e.get("EquipmentCategory"), e.get("TierInit")
        if cat not in CAT_JA or not tier:
            continue
        max_tier[cat] = max(max_tier.get(cat, 0), tier)
        if icon_of(e).endswith("_piece"):
            piece[e["Id"]] = (cat, tier)
            if sd_name.get(e["Id"]):
                names[cat + str(tier)] = sd_name[e["Id"]]

    # **万能設計図は Tier 0 の Equipment（Id 50X000）。**ba-data に無いので SchaleDB から。
    # 部位ごとに 1 種類あって、その部位のどの Tier の設計図の代わりにもなる
    univ = {}
    for e in as_list(get_json(SD.format("equipment"))):
        if e.get("Tier") == 0 and e.get("Category") in CAT_JA and str(e.get("Icon", "")).endswith("_useall_piece"):
            univ[e["Id"]] = e["Category"]
            names[e["Category"] + "0"] = e.get("Name", "")

    # ティアアップのレシピ。**Tier N の装備が持つ RecipeId は「N → N+1」の手順。**
    # そのまま Tier N として入れると 1 段ずつずれて、T2 のぶんが丸ごと消える
    # （帽子 T1→T10 の T2 が 40 枚のはずが 25 枚になる）
    ing = {r["Id"]: r for r in recipe_ing if "Id" in r}
    recipes = {c: {} for c in CATS}
    for e in equip:
        cat, tier, rid = e.get("EquipmentCategory"), e.get("TierInit"), e.get("RecipeId")
        if cat not in CAT_JA or not rid or icon_of(e).endswith("_piece"):
            continue
        r = ing.get(rid)
        if not r:
            continue
        pairs = []
        for kind, pid, cnt in zip(r.get("IngredientParcelType", []),
                                  r.get("IngredientId", []), r.get("IngredientAmount", [])):
            if kind == "Equipment" and pid in piece:
                pairs.append([piece[pid][1], cnt])
        credit = 0
        for kind, amt in zip(r.get("CostParcelType", []), r.get("CostAmount", [])):
            if kind == "Currency":
                credit += amt
        if pairs and tier + 1 <= max_tier.get(cat, 0):
            recipes[cat][tier + 1] = {"ing": pairs, "credit": credit}

    # 箱（GachaGroup）の中身。**比率は GachaElement に出ている。**
    # 「半分ずつ」と仮定する必要はない
    boxes = {}
    for r in gacha_el:
        if r.get("ParcelType") != "Equipment":
            continue
        pid = r.get("ParcelID")
        if pid not in piece:
            continue
        boxes.setdefault(r["GachaGroupID"], []).append(
            (piece[pid], r.get("Prob", 0), (r.get("ParcelAmountMin", 1) + r.get("ParcelAmountMax", 1)) / 2.0))

    out = []
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
            elif kind_ == "GachaGroup" and pid in boxes:
                tot = sum(x[1] for x in boxes[pid]) or 1
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

    return write_js("tools/equipment/data.js", "EQUIP", {
        "cats": CATS, "catJa": CAT_JA, "maxTier": max_tier,
        "recipes": recipes, "stages": out, "names": names,
        "slots": slots, "roster": roster, "selbox": selbox, "univRate": univ_rate,
        "version": "SchaleDB jp（ステージ・ドロップ・AP・万能設計図）／ electricgoat/ba-data jp（レシピ・箱の比率）",
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
            "id": s["Id"], "n": s["Name"],
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

    def boss_stats(r):
        rows = []
        for ids in r.get("EnemyList") or []:
            e = enemies.get(str(ids[0])) if ids else None
            if not e:
                rows.append(None)
                continue
            rows.append({
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

    bosses = []
    for r in raids.get("Raid", []):
        if not r.get("Name"):
            continue
        bosses.append({
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
                "lo": floors[i] if i < len(floors) else 0,
                "hi": (floors[i + 1] - 1) if i + 1 < len(floors) else 0,
                "st": ({"hp": e.get("MaxHP1", 0), "atk": e.get("AttackPower1", 0),
                        "df": e.get("DefensePower1", 0), "acc": e.get("AccuracyPoint", 0),
                        "dg": e.get("DodgePoint", 0), "cr": e.get("CriticalPoint", 0),
                        "sp": e.get("StabilityPoint", 0), "sr": e.get("StabilityRate", 0),
                        "rg": e.get("Range", 0), "sz": e.get("Size", ""),
                        "at": e.get("ArmorType", ""), "bt": e.get("BulletType", ""),
                        "ph": []} if e else None)})
        multi.append({"id": m["Id"], "n": m["Name"], "p": m.get("PathName", ""),
                      "dev": m.get("DevName", ""), "at": m.get("ArmorType", "Normal"),
                      "tr": m.get("Terrain", []), "dur": m.get("BattleDuration", 0),
                      "secs": secs})

    stu = []
    for s in students:
        if not s.get("Name"):
            continue
        w = s.get("Weapon") or {}
        stu.append({
            "id": s["Id"], "n": s["Name"],
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
    print(f"  画像 {n} 枚を追加、ボス {len(bosses)} 体、制約解除決戦 {len(multi)} 枠")

    labels = {k: loc.get(k, {}) for k in
              ("BulletType", "ArmorType", "TacticRole", "SquadType", "School",
               "AdaptationType", "RaidDifficulty")}
    # **属性は増える。**（2026-08 に Chemical と CompositeArmor が入った）
    # ページ側で決め打ちにせず、実際に出てくるものをここから渡す
    bullets = [k for k in eff if k not in ("Normal",)]
    armors = [k for k in (eff.get("Normal") or {}) if k not in ("Normal", "Structure")]

    return write_js("tools/raid/data.js", "RAID", {
        "bosses": bosses, "elim": elim, "multi": multi, "students": stu,
        "eff": eff, "labels": labels, "bullets": bullets, "armors": armors,
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
    lv_tbl = as_list(get_json(BA.format("CharacterLevelExcelTable")))
    ing = {r["Id"]: r for r in as_list(get_json(BA.format("RecipeIngredientExcelTable")))}

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
        # 固有武器は★3 まで。データには★4・★5 の段もあるが、中身が
        # 「神名文字 1 個」の仮置きなので数えない
        wp = ([[credit[(3, i)], [[cid, stones[(3, i)]]]] for i in range(2)]
              if s.get("Weapon") else [])

        gear = s.get("Gear") or {}
        gr = [[credit[(4, i)], mats(m, a)] for i, (m, a) in
              enumerate(zip(gear.get("TierUpMaterial") or [], gear.get("TierUpMaterialAmount") or []))]

        stu.append({"id": cid, "n": s["Name"], "r": s.get("StarGrade", 1),
                    "ex": ex, "sk": sk, "tr": tr, "wp": wp, "gr": gr})
    stu.sort(key=lambda x: x["n"])

    # 素材の名前とアイコン。**神名文字だけは生徒ごとに 274 種ある**ので、
    # 絵は共通の item_icon_secretstone を使い回して名前だけ持たせる
    by_name = {s["id"]: s["n"] for s in stu}
    mat = {}
    for iid in sorted(used):
        it = item_by_id.get(iid)
        if not it:
            # **未実装の生徒は神名文字だけ items に無い。**名前は生徒から作れる
            if iid in by_name:
                mat[str(iid)] = {"n": by_name[iid] + "の神名文字",
                                 "i": "item_icon_secretstone", "s": 1,
                                 "k": "stone", "t": 0}
            else:
                print(f"    素材 {iid} が items に無い", file=sys.stderr)
            continue
        stone = it.get("Category") == "SecretStone"
        mat[str(iid)] = {"n": it["Name"].replace("\n", ""),
                         "i": "item_icon_secretstone" if stone else it["Icon"],
                         "s": 1 if stone else 0,
                         "k": mat_kind(it, stone), "t": mat_tier(it)}

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
                              "c": amt})
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

    return write_js("tools/treasure/data.js", "TREASURE_EVENTS", {
        "events": events,
        "version": "electricgoat/ba-data jp（DB/EventContentTreasure*）／ SchaleDB jp（イベント名）",
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

    def eff_name(e):
        """効果の見出し。**`Stat` があるものはそこから引ける。**
           `Regen` / `Shield` / `DamageDebuff` の 3 つだけ `Stat` を持たないので、
           そこは種別から名前を当てる（2026-08-30 に 29 種を数えて確かめた）。"""
        st = e.get("Stat") or ""
        if st:
            return statja.get(st.rsplit("_", 1)[0], st)
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

    stu = []
    for s in students:
        ex = s.get("Skills", {}).get("Ex")
        if not s.get("Name") or not isinstance(ex, dict):
            continue
        rec = {
            "id": s["Id"], "n": s["Name"],
            "sq": s.get("SquadType", ""), "ro": s.get("TacticRole", ""),
            "sc": s.get("School", "ETC"), "at": s.get("ArmorType", ""),
            "bt": s.get("BulletType", ""), "st": s.get("StarGrade", 0),
            "en": ex.get("Name", ""),
            # EX のアイコン。**82 種しかない**ので、生徒 274 人ぶんより軽い
            "ei": ex.get("Icon", ""),
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
        # EX が置いていく効果の持続。**タイムラインに帯で出すため。**
        # 持続の無い効果（即時のダメージ・回復）は帯にならないので落とす
        bf = []
        for e in ex.get("Effects") or []:
            du = int(e.get("Duration") or 0)
            if du <= 0:
                continue
            bf.append({"n": eff_name(e), "du": du, "sd": eff_side(e)})
        if bf:
            rec["bf"] = bf
        # スキルコストを下げる効果。**`Uses` 回ぶんだけ効いて、時間では切れない。**
        # `Coefficient` は 10000 分率（-5000 = 50% 引き）、`BaseAmount` は引く数そのもの
        for e in ex.get("Effects") or []:
            if e.get("Type") != "CostChange":
                continue
            sc = e.get("Scale") or []
            cc = {"u": int(e.get("Uses") or 1),
                  "vt": "coef" if e.get("ValueType") == "Coefficient" else "flat",
                  "sc": sc, "sd": eff_side(e)}
            # **効く回数が EX のレベルで変わる子がいる。**`Uses` は最大値しか
            # 持っていないので、スキル文のパラメータ側（「1回 / … / 2回」）を拾う。
            # 2026-08-30 時点でこれに当たるのはセイアだけ
            for row in ex.get("Parameters") or []:
                m = [re.fullmatch(r"(\d+)回", str(x)) for x in row]
                if row and all(m):
                    cc["up"] = [int(x.group(1)) for x in m]
                    break
            rec["cc"] = cc
            break
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
    icons = sorted({x["ei"] for x in stu if x.get("ei")})
    for ic in icons:
        n += fetch_wide("skill_" + ic.lower(),
                        f"https://schaledb.com/images/skill/{ic}.webp", width=96)
    lost = [ic for ic in icons if not (IMG / f"skill_{ic.lower()}.webp").exists()]
    if lost:
        raise SystemExit(f"EX スキルの絵が {len(lost)} 種類落ちてこない: {lost[:5]}")
    holders = [s for s in stu if "r" in s]
    print(f"  生徒 {len(stu)} 人、コスト回復力に触る子 {len(holders)} 人、アイコン {n} 枚を追加")
    if len(holders) < 15:
        raise SystemExit(f"コスト回復力持ちが {len(holders)} 人しか取れていない。データの形が変わった疑い")

    keep = ("School", "TacticRole", "BulletType", "ArmorType", "SquadType")
    return write_js("tools/cost-timeline/data.js", "TL", {
        "students": stu,
        "labels": {k: loc.get(k, {}) for k in keep},
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
            "id": s["Id"], "n": s["Name"], "sq": s.get("SquadType", ""),
            # **絵の名前は生徒の Id と一致しない。**衣装違いは元の子の武器を使い回す
            # （アズサ（水着）10021 の絵は `weapon_icon_10019`）。SchaleDB の
            # `WeaponImg` をそのまま持つ（2026-08-30。Id で組み立てて 206 人ぶん落ちた）
            "wi": s.get("WeaponImg", ""),
            "wn": w.get("Name", ""), "ad": w.get("AdaptationType", ""),
            "av": w.get("AdaptationValue", 0),
            "a": [w.get("AttackPower1", 0), w.get("AttackPower100", 0)],
            "h": [w.get("MaxHP1", 0), w.get("MaxHP100", 0)],
            "p": [w.get("HealPower1", 0), w.get("HealPower100", 0)],
            "eq": s.get("Equipment") or [],
        })
        g = s.get("Gear") or {}
        if g.get("Name"):
            gear.append({
                "id": s["Id"], "n": s["Name"], "gn": g["Name"],
                "st": g.get("StatType") or [], "sv": g.get("StatValue") or [],
            })
    if len(gear) < 40:
        raise SystemExit(f"愛用品が {len(gear)} 人ぶんしか取れない")

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
        # 部位の日本語は localization に無いので、装備の周回計算機と同じ言い方に揃える
        "catJa": {"Hat": "帽子", "Gloves": "手袋", "Shoes": "靴", "Bag": "カバン",
                  "Badge": "バッジ", "Hairpin": "ヘアピン", "Charm": "お守り",
                  "Watch": "腕時計", "Necklace": "ネックレス"},
        "labels": {k: loc.get(k, {}) for k in keep},
        "version": "SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


BUILDERS = {"bond": build_bond, "teacher-level": build_teacher_level,
            "equipment": build_equipment, "tier": build_tier, "raid": build_raid,
            "student-cost": build_student_cost, "treasure": build_treasure,
            "cost-timeline": build_cost_timeline,
            "raid-calendar": build_raid_calendar,
            "gear-stats": build_gear_stats,
            "ui": build_ui}

if __name__ == "__main__":
    want = sys.argv[1:] or list(BUILDERS)
    changed = False
    for w in want:
        if w not in BUILDERS:
            raise SystemExit(f"知らない対象: {w}（{', '.join(BUILDERS)}）")
        changed |= bool(BUILDERS[w]())
    print("変化あり" if changed else "変化なし")
