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
import io, json, pathlib, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "tools" / "img"
BA = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/{}.json"
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
    if len(raw) < 2000:          # SchaleDB は無い画像に小さなプレースホルダを返す
        print(f"    実体が無い {name}（{len(raw)} バイト）", file=sys.stderr)
        return False
    IMG.mkdir(parents=True, exist_ok=True)
    _square(raw, out)
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
        stu.append({"id": s["Id"], "n": s["Name"], "t": s.get("FavorItemTags", []) or []})
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
    for row in const:
        if "AccountMaxLevel" in row:
            mx = row["AccountMaxLevel"]
        if "AccountExpRatio" in row:
            ratio = row["AccountExpRatio"]

    rows = {r["Level"]: r for r in acc if "Level" in r}
    exp_to_next, ap_cap = [], []
    for lv in range(1, mx + 1):
        r = rows.get(lv, {})
        ap_cap.append(r.get("APAutoChargeMax", 0))
        if lv < mx:
            exp_to_next.append(r.get("Exp", 0))

    fetch_icon("currency_icon_ap", "https://schaledb.com/images/item/icon/currency_icon_ap.webp")
    return write_js("tools/teacher-level/data.js", "TEACHER_LEVEL", {
        "maxLevel": mx, "accountExpRatio": ratio,
        "expToNext": exp_to_next, "apCap": ap_cap,
        "source": "electricgoat/ba-data jp",
        "version": "electricgoat/ba-data jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


# ------------------------------------------------------------ 装備設計図

CAT_JA = {"Hat": "帽子", "Gloves": "手袋", "Shoes": "靴", "Bag": "カバン", "Badge": "バッジ",
          "Hairpin": "ヘアピン", "Charm": "お守り", "Watch": "腕時計", "Necklace": "ネックレス"}
CATS = list(CAT_JA)


def build_equipment():
    print("装備設計図の周回計算機")
    equip = as_list(get_json(BA.format("EquipmentExcelTable")))
    recipe_ing = as_list(get_json(BA.format("RecipeIngredientExcelTable")))
    stages = as_list(get_json(BA.format("CampaignStageExcelTable")))
    rewards = as_list(get_json(BA.format("CampaignStageRewardExcelTable")))
    gacha_el = as_list(get_json(BA.format("GachaElementExcelTable")))
    # **SchaleDB の stages は id をキーにした平らな辞書。**欲しいのは Campaign だけ
    loc_stage = [x for x in as_list(get_json(SD.format("stages")))
                 if x.get("Category") == "Campaign"]
    # **名前は SchaleDB から。**ba-data 側は LocalizeEtcId しか持っていない。
    # ただし SchaleDB には T10 の設計図（101009 など）がまだ入っていないので、
    # 部位・Tier・レシピは ba-data を正本にして、名前だけ引く
    sd_name = {e["Id"]: e.get("Name", "") for e in as_list(get_json(SD.format("equipment"))) if e.get("Id")}

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

    sname = {s["Id"]: s.get("Name", "") for s in loc_stage if s.get("Id")}

    rw = {}
    for r in rewards:
        if r.get("RewardTag") != "Default":
            continue
        rw.setdefault(r["GroupId"], []).append(r)

    out = []
    for st in stages:
        sid, gid = st.get("Id"), st.get("CampaignStageRewardId")
        if not sid or gid not in rw or st.get("Deprecated"):
            continue
        acc = {}
        def add(cat, tier, v):
            acc[(cat, tier)] = acc.get((cat, tier), 0) + v
        for r in rw[gid]:
            pid, kind = r.get("StageRewardId"), r.get("StageRewardParcelType")
            ev = (r.get("StageRewardProb", 0) / 10000.0) * r.get("StageRewardAmount", 0)
            if kind == "Equipment" and pid in piece:
                add(piece[pid][0], piece[pid][1], ev)
            elif kind == "GachaGroup" and pid in boxes:
                tot = sum(x[1] for x in boxes[pid]) or 1
                for (cat, tier), prob, amt in boxes[pid]:
                    add(cat, tier, ev * (prob / tot) * amt)
        if not acc:
            continue
        d = [[c, t, round(v, 4)] for (c, t), v in sorted(acc.items())]
        # Id は 1 CC D T SS。CC=章、D=難易度(1 Normal / 2 Hard)、
        # T=種別(1 Main / 2 Sub)、SS=何番目。**T を落とすと番号が 101 になる**
        txt = str(sid)
        area, diff, kind, num = int(txt[1:3]), int(txt[3]), int(txt[4]), int(txt[5:])
        if diff not in (1, 2) or kind != 1:
            continue
        out.append({"id": sid, "a": area, "s": num, "h": 1 if diff == 2 else 0,
                    "n": sname.get(sid, ""), "ap": st.get("StageEnterCostAmount", 0),
                    "d": d, "b": []})
    out.sort(key=lambda x: (x["a"], x["h"], x["s"]))

    n = 0
    for cat in CATS:
        for t in range(2, max_tier.get(cat, 0) + 1):
            nm = f"equipment_icon_{cat.lower()}_tier{t}_piece"
            n += fetch_icon(nm, f"https://schaledb.com/images/equipment/icon/{nm}.webp")
    for t in range(2, 9):
        nm = f"equipment_icon_selection_tier{t}_piece"
        n += fetch_icon(nm, f"https://schaledb.com/images/item/icon/{nm}.webp")
    print(f"  アイコン {n} 枚を追加、周回できるステージ {len(out)} 本")

    return write_js("tools/equipment/data.js", "EQUIP", {
        "cats": CATS, "catJa": CAT_JA, "maxTier": max_tier,
        "recipes": recipes, "stages": out, "names": names,
        "version": "electricgoat/ba-data jp（ドロップ・AP・箱の比率）／ SchaleDB jp（ステージ名・設計図の名前）",
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

# ボスの立ち絵のファイル名。**PathName（小文字）とは一致しない。**
# 実際に叩いて確かめた対応表（2026-08-30）。新しいボスが増えたら
# 下の候補で当たらなければログに出るので、そのとき足す
BOSS_IMG = {
    "binah": "Binah", "chesed": "Chesed", "shirokuro": "Shirokuro",
    "hieronymus": "Hieronymus", "kaiten": "KaitenFxMk0", "perorodzilla": "Perorozilla",
    "hod": "HOD", "goz": "Goz", "gregorius": "EN0005", "hovercraft": "RaidHoverCraft",
    "kurokage": "EN0006", "geburah": "EN0008", "yesod": "EN0009", "drumbarka": "EN0011",
}


def boss_image(path_name):
    """立ち絵の実ファイル名を探す。**当たらなければ None。**"""
    cands = []
    if path_name in BOSS_IMG:
        cands.append(BOSS_IMG[path_name])
    cands += [path_name[:1].upper() + path_name[1:], path_name.upper(), path_name]
    for c in cands:
        url = f"https://schaledb.com/images/raid/Boss_Portrait_{c}_Lobby.png"
        try:
            req = urllib.request.Request(url, method="HEAD",
                                         headers={"User-Agent": "arona-guide/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                if int(r.headers.get("Content-Length") or 0) > 3000:
                    return url
        except Exception:
            continue
    print(f"    立ち絵が見つからない: {path_name}", file=sys.stderr)
    return None


def build_raid():
    print("総力戦・大決戦の相性チェッカー")
    raids = get_json(SD.format("raids"))
    students = as_list(get_json(SD.format("students")))
    loc = get_json(SD.format("localization"))
    cfg = get_json(SD_CFG)

    eff = cfg.get("TypeEffectiveness")
    if not eff:
        raise SystemExit("TypeEffectiveness が取れない")

    bosses = []
    for r in raids.get("Raid", []):
        if not r.get("Name"):
            continue
        bosses.append({
            "id": r["Id"], "n": r["Name"], "p": r["PathName"],
            "tr": r.get("Terrain", []),
            "bt": r.get("BulletType", "Normal"),
            "bti": r.get("BulletTypeInsane", ""),
            "at": r.get("ArmorType", "Normal"),
            "mx": (r.get("MaxDifficulty") or [6])[0],
        })

    # 大決戦は、開催のたびに 3 つの装甲が割り当てられる。
    # **どの組み合わせが来るかは季節ごとに違う**ので、過去の実績を候補として持っておく
    elim = []
    seen = set()
    for season in raids.get("RaidSeasons", []):
        for e in season.get("EliminateSeasons", []):
            key = (e.get("RaidId"), tuple(e.get("ArmorTypes", [])), e.get("TormentArmorType"))
            if key in seen:
                continue
            seen.add(key)
            elim.append({"id": e.get("RaidId"), "tr": e.get("Terrain"),
                         "ats": e.get("ArmorTypes", []), "tat": e.get("TormentArmorType", "")})

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
        out = IMG / ("boss_" + b["p"] + ".webp")
        if out.exists():
            continue
        url = boss_image(b["p"])
        if url:
            n += fetch_raw("boss_" + b["p"], url)
    for s in stu:
        n += fetch_portrait(f"student_{s['id']}", f"https://schaledb.com/images/student/collection/{s['id']}.webp")
    print(f"  画像 {n} 枚を追加、ボス {len(bosses)} 体")

    labels = {k: loc.get(k, {}) for k in
              ("BulletType", "ArmorType", "TacticRole", "SquadType", "School",
               "AdaptationType", "RaidDifficulty")}
    # **属性は増える。**（2026-08 に Chemical と CompositeArmor が入った）
    # ページ側で決め打ちにせず、実際に出てくるものをここから渡す
    bullets = [k for k in eff if k not in ("Normal",)]
    armors = [k for k in (eff.get("Normal") or {}) if k not in ("Normal", "Structure")]

    return write_js("tools/raid/data.js", "RAID", {
        "bosses": bosses, "elim": elim, "students": stu,
        "eff": eff, "labels": labels, "bullets": bullets, "armors": armors,
        "version": "SchaleDB jp",
    }, header="/* scripts/build-tool-data.py が吐く。**手で直さない。** */\n")


BUILDERS = {"bond": build_bond, "teacher-level": build_teacher_level,
            "equipment": build_equipment, "tier": build_tier, "raid": build_raid}

if __name__ == "__main__":
    want = sys.argv[1:] or list(BUILDERS)
    changed = False
    for w in want:
        if w not in BUILDERS:
            raise SystemExit(f"知らない対象: {w}（{', '.join(BUILDERS)}）")
        changed |= bool(BUILDERS[w]())
    print("変化あり" if changed else "変化なし")
