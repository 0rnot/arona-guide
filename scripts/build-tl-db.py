# -*- coding: utf-8 -*-
"""TL 道具が回すための **DB の原文** を、生徒 1 人 1 ファイルに束ねる。

2026-09-06、先生「DB を必要な箇所をそのまま丸ごと持ってきて実装することはできない？」。

`build-tool-data.py` は DB を読んで「1 行 22 欄」に**要約**して `data.js` に焼く。
要約に入らない性質（位置の変化・体ごとの状態・形態の時間切れ・ゲージ・札）は
そこで消えて、後から欄を足しても入らない。監査 43 人 113 件のうち 63 件がこれだった。

**こちらは要約しない。**`LevelSkill/<枠>.json` の木と、そこから参照されている
`LogicEffect_PC` の行を、**原文のまま**運ぶ。要約する場所を焼き出しから実行時へ移して、
条件（形態・ゲージ・札・相手の装甲・当たる人数）は**状態が分かる実行時に**決める。

量は測ってある（2026-09-06）:

  274 人ぶん 1,787 枠   生 27,979,939 バイト / gzip   876,792
  編成 6 人ぶん  39 枠   生    754,197 バイト / gzip    20,260
  いまの data.js                2,038,648 バイト / gzip  182,196

**倍率も DB にある。**`LogicEffect_PC` の `DamageEffectDAO` は `Amount 0` だが、
本体は `BonusSourceFirst`（2 ＝ 攻撃力）と `BonusRateFirst`（1 万分率）で、
`Level` 1〜10 の 10 行に分かれている。マキ EX は 67617 → 179192 で、
今 `data.js` が SchaleDB から取っている `Scale` と 1 の位まで一致する。
**SchaleDB は倍率について DB の写しでしかない。**

使い方:

    python3 scripts/build-tl-db.py            # 274 人ぶん
    python3 scripts/build-tl-db.py 10007 10099  # その id だけ

原本は `~/arona/tl-work/` の写し（`badata-git/LevelSkill`・`badb/DB`）を先に見て、
無ければ ba-data から取る。
"""
import gzip
import io
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "tl" / "db"
MIRROR = pathlib.Path(os.path.expanduser("~/arona/tl-work"))
BALS = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/LevelSkill/{}.json"
BADB = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/DB/{}.json"

# **画面の飾りだけの欄は落とす。**戦闘の中身に効くものは 1 つも落とさない
# （落としてよいと言い切れるものだけをここに並べる。迷ったら残す）
DROP = {"IconName", "LocalizeSkillId", "LocalizeEtcId", "TextureSkillCardForFormConversion",
        "SkillCardLabelPath", "VisualDataKey", "AdditionalToolTipId",
        "SelectExSkillToolTipId", "IsShowInfo", "IsShowSpeechbubble",
        "PublicSpeechDuration", "RequireLevelUpMaterial", "RequireCharacterLevel"}

SKILL_KEYS = ("ExSkillGroupId", "PublicSkillGroupId", "NormalSkillGroupId",
              "PassiveSkillGroupId", "ExtraPassiveSkillGroupId",
              "HiddenPassiveSkillGroupId", "WeaponPassiveSkillGroupId",
              "LeaderSkillGroupId")


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "arona-guide/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def db(table):
    """`DB/<table>.json` を行の配列で。写しがあればそちら。"""
    for p in (MIRROR / "badb" / "DB" / f"{table}.json",
              MIRROR / "badb" / f"{table}.json"):
        if p.exists():
            d = json.loads(io.open(p, encoding="utf-8").read())
            return d["DataList"] if isinstance(d, dict) and "DataList" in d else d
    d = _get(BADB.format(table))
    return d["DataList"] if isinstance(d, dict) and "DataList" in d else d


_ls_miss = set()


def level_skill(group):
    """`LevelSkill/<group>.json` の原文。無ければ None。"""
    p = MIRROR / "badata-git" / "LevelSkill" / f"{group}.json"
    if p.exists():
        return json.loads(io.open(p, encoding="utf-8").read())
    try:
        return _get(BALS.format(group))
    except Exception:
        _ls_miss.add(group)
        return None


def strip(o):
    """飾りの欄だけ落とす。**構造は変えない。**"""
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in DROP}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


def effect_ids(node, out):
    """木の中で参照されている `LogicEffectGroupIds` を全部。**入れ子の奥まで。**"""
    if isinstance(node, dict):
        for key in ("Abilities", "AreaAbilities"):
            for a in (node.get(key) or []):
                if isinstance(a, dict):
                    for g in (a.get("LogicEffectGroupIds") or []):
                        out.add(g)
        # **消す側・条件側も札の名前で他の効果を指す**（`LogicEffectGroupIdToDispel` ほか）
        for k in ("LogicEffectGroupIdToDispel", "LogicEffectGroupId"):
            v = node.get(k)
            if isinstance(v, str) and v:
                out.add(v)
            elif isinstance(v, list):
                out.update(x for x in v if isinstance(x, str))
        for k, v in node.items():
            if k != "$type":
                effect_ids(v, out)
    elif isinstance(node, list):
        for v in node:
            effect_ids(v, out)


def main(argv):
    want = set(argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)

    print("DB を読む …")
    csl = db("CharacterSkillListExcelTable")
    sk_tbl = db("SkillExcelTable")
    le_tbl = db("LogicEffect_PC")
    chars = db("CharacterExcelTable")

    # **道具が持っている生徒だけ。**`data.js` の `stats` の並びをそのまま使う
    src = io.open(ROOT / "tools" / "tl" / "data.js", encoding="utf-8").read()
    m = re.search(r"window\.TLBOSS\s*=\s*", src)
    ids = list(json.loads(src[m.end():].rstrip().rstrip(";"))["stats"].keys())
    if want:
        ids = [i for i in ids if i in want]
    print(f"  生徒 {len(ids)} 人")

    dev = {str(c.get("Id")): c.get("DevName") for c in chars if c.get("Id")}
    csl_by = {}
    for r in csl:
        csl_by.setdefault(str(r.get("CharacterSkillListGroupId")), []).append(r)
    sk_by = {}
    for r in sk_tbl:
        sk_by.setdefault(r.get("GroupId"), []).append(r)
    le_by = {}
    for r in le_tbl:
        le_by.setdefault(r.get("GroupId"), []).append(r)

    index, tot_raw, tot_gz, tot_grp = {}, 0, 0, 0
    for sid in ids:
        rows = csl_by.get(sid) or []
        groups = []
        for r in rows:
            for k in SKILL_KEYS:
                v = r.get(k)
                for x in (v if isinstance(v, list) else [v]):
                    if x and x != "EmptySkill" and x not in groups:
                        groups.append(str(x))
        ls, eids = {}, set()
        for g in groups:
            d = level_skill(g)
            if d is None:
                continue
            ls[g] = strip(d)
            effect_ids(d, eids)
        le = []
        for g in sorted(eids):
            le.extend(strip(r) for r in (le_by.get(g) or []))
        sk = []
        for g in groups:
            sk.extend(strip(r) for r in (sk_by.get(g) or []))
        pack = {"id": int(sid), "dev": dev.get(sid), "groups": groups,
                "ls": ls, "le": le, "csl": [strip(r) for r in rows], "sk": sk}
        raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode()
        gz = gzip.compress(raw, 9)
        io.open(OUT / f"s{sid}.json.gz", "wb").write(gz)
        index[sid] = {"g": len(ls), "e": len(le), "b": len(gz)}
        tot_raw += len(raw)
        tot_gz += len(gz)
        tot_grp += len(ls)
        if len(index) % 40 == 0:
            print(f"  {len(index)}/{len(ids)} 人 … {tot_gz:,} バイト")

    io.open(OUT / "index.json", "w", encoding="utf-8").write(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"\n書いた: {OUT}")
    print(f"  生徒 {len(index)} 人 ／ 枠 {tot_grp} ／ 生 {tot_raw:,} バイト ／ gzip {tot_gz:,} バイト")
    if _ls_miss:
        print(f"  取れなかった枠 {len(_ls_miss)}: {sorted(_ls_miss)[:8]}")


if __name__ == "__main__":
    main(sys.argv)
