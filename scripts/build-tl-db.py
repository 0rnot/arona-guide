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
BAEX = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Excel/{}.json"
BABT = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Battle/{}.json"
BAST = "https://raw.githubusercontent.com/electricgoat/ba-data/jp/Stage/{}.json"

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


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.loads(f.read())


def db(table):
    """`DB/<table>.json` を行の配列で。写しがあればそちら。"""
    for p in (MIRROR / "badb" / "DB" / f"{table}.json",
              MIRROR / "badb" / f"{table}.json"):
        if p.exists():
            d = _read_json(p)
            return d["DataList"] if isinstance(d, dict) and "DataList" in d else d
    d = _get(BADB.format(table))
    return d["DataList"] if isinstance(d, dict) and "DataList" in d else d


def ex(table):
    """`Excel/<table>.json`。**`DB/` とは 100 個ちがう別の棚。**"""
    p = MIRROR / "baex" / f"{table}.json"
    if p.exists():
        d = _read_json(p)
    else:
        d = _get(BAEX.format(table))
    return d["DataList"] if isinstance(d, dict) and "DataList" in d else d


def battle(name):
    """`Battle/<name>.json`。遮蔽の形はここ。"""
    p = MIRROR / "baex" / f"{name}.json"
    if p.exists():
        d = _read_json(p)
    else:
        d = _get(BABT.format(name))
    return d["DataList"] if isinstance(d, dict) and "DataList" in d else d


def stage(name):
    """`Stage/<name>.json` = **盤の実体**（2026-09-06、先生「DB 以外のディレクトリに
    あるんじゃない？」）。`GroundExcelTable.StageFileName` が指す。中身は:

      Formations[]                  味方の並びの原点（節ごとに x, y と向き）
      Sections[].EnemySpawnPointGroupList[].SpawnPoints[]
                                    敵の湧き位置（`Position` / `TileX` / `TileY` /
                                    `Direction` / `SpawnTemplateId`）と湧く合図
      Sections[].Events[]           節の台本。`Conditions` と `Commands` の対で、
                                    フェーズの移り・グロッキー時のミニオン・
                                    無敵の窓・待ち秒（ペロロジラ Torment は
                                    `GroundConditionCharacterPhaseChanged Phase 1` →
                                    `SetStatusImmune ImmuneGroggyGaugeAdd` →
                                    `WaitSeconds 8000`）
      Sections[].Obstacles[]        置いてある遮蔽（`Battle/obstacledata` の実体を指す）

    **今まで動画から読んでいた「8 秒の間」や「ミニオンはいつ湧くか」がここにある。**
    ペロロジラ Torment は生 39,218 バイト・gzip 2,420 バイトなので、束に入れて構わない。
    """
    # **倉庫のファイル名は全部小文字。**`GroundExcelTable` は
    # `6011107_eliminateRaid_...`（R が大文字）と書いてあるが、実物は
    # `6011107_eliminateraid_...`。raw.githubusercontent は大小を区別するので、
    # そのまま取ると大決戦 532 面ぶんが丸ごと 404 になる（2026-09-06）
    cands = [name]
    if name.lower() != name:
        cands.append(name.lower())
    for nm in cands:
        for pdir in (MIRROR / "badata-git" / "Stage", MIRROR / "badata" / "Stage"):
            q = pdir / f"{nm}.json"
            if q.exists():
                return _read_json(q)
    d = None
    for nm in cands:
        try:
            d = _get(BAST.format(nm))
            name = nm
            break
        except Exception:  # noqa: BLE001,S112 - 大小の綴りを 2 通り試すだけ。無ければ次へ
            continue
    if d is None:
        return None
    # **取ったものは写しに残す。**700 面 × 最大 3 本を毎回取り直さない
    out = MIRROR / "badata-git" / "Stage"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / f"{name}.json", "w", encoding="utf-8") as f:
        f.write(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    return d


def entity_names(node, out):
    """木の中の `CharacterEntityDAO.UniqueName`。**ミニオンはこの名前で呼ばれる。**"""
    if isinstance(node, dict):
        t = str(node.get("$type", "")).split(",")[0].split(".")[-1]
        if t == "CharacterEntityDAO":
            v = node.get("UniqueName")
            if isinstance(v, str) and v:
                out.add(v)
        for k, v in node.items():
            if k != "$type":
                entity_names(v, out)
    elif isinstance(node, list):
        for v in node:
            entity_names(v, out)


def resolve_dev(name, by_dev):
    """木の `UniqueName` を `CharacterExcelTable.DevName` に当てる。

    **綴りが一致しない。**2026-09-06 に実物で確かめた例:

        木   Perorozilla_Torment_Peroro_MiddleSize01_Move
        DB   Perorozilla_Torment_MiddleSize01_Move

    間に `_Peroro` が挟まっている。総力戦の盤ファイル（`Stage/` に**無い**）が
    持っていた名前の名残りらしい。落とす綴りを増やすときはここに 1 行足す。
    """
    if name in by_dev:
        return by_dev[name]
    for drop in ("_Peroro", "_Peroro_"):
        alt = name.replace(drop, "_").replace("__", "_")
        if alt in by_dev:
            return by_dev[alt]
    # 末尾（MiddleSize01_Move など）で当てる。**同じ難度の中だけ**
    tail = name.split("_")[-2:] if name.endswith("_Move") else name.split("_")[-1:]
    tail = "_".join(tail)
    head = name.split("_")[0]
    cand = [d for d in by_dev if d.startswith(head) and d.endswith(tail)]
    return by_dev[cand[0]] if len(cand) == 1 else None


_ls_miss = set()
_dev_miss = set()


def level_skill(group):
    """`LevelSkill/<group>.json` の原文。無ければ None。"""
    p = MIRROR / "badata-git" / "LevelSkill" / f"{group}.json"
    if p.exists():
        return _read_json(p)
    try:
        return _get(BALS.format(group))
    except Exception:  # noqa: BLE001 — 取れない枠は名前を控えて先へ進む（1 枠で止めない）
        _ls_miss.add(group)
        return None



# **ボスの素の被ダメージ率を掛けてよいか**（`dmgOnly`。2026-09-06）。
#
# `CharacterStatExcelTable.DamagedRatio` は ケセド 19000（＝ 0.1 倍）・ホド 19000・
# ヒエロニムス 16000・ホバークラフト 17500・イェソド 19900 と 10000 でないボスがいるが、
# **画面側がその素の値を掛けているのは「この効果以外の `DamagedRatio` の増加効果を
# 無効化」と書いてあるボスだけ**（ケセドの剥き出しの玉座。`js/target.js:414`）。
# 動画で確かめられたのもケセドだけで、ホド・ヒエロニムス・イェソドは 1.0 倍の計算で
# 実クリア TL と合う。判定は `build-tool-data.py:_dmg_only` と同じ本文の照合。
_DMG_ONLY = None


def dmg_only_groups():
    """素の被ダメージ率を掛けるボス群の名前（小文字）。"""
    global _DMG_ONLY
    if _DMG_ONLY is not None:
        return _DMG_ONLY
    _DMG_ONLY = set()
    p = MIRROR / "raids.json"
    if not p.exists():
        return _DMG_ONLY
    d = _read_json(p)
    rsk = d.get("RaidSkills") or {}
    named = {nm for nm, sk in rsk.items()
             if "この効果以外" in (sk.get("Desc") or "")
             and "DamagedRatio" in (sk.get("Desc") or "")
             and "無効" in (sk.get("Desc") or "")}
    for r in (d.get("Raid") or []):
        for names in (r.get("RaidSkillList") or []):
            if any(nm in named for nm in (names or [])):
                _DMG_ONLY.add(str(r.get("PathName") or "").lower())
    return _DMG_ONLY


def strip(o):
    """飾りの欄だけ落とす。**構造は変えない。**"""
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in DROP}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


def effect_ids(node, out):
    """木の中で参照されている `LogicEffectGroupIds` を全部。**入れ子の奥まで。**

    **容れ物の名前で拾わない**（2026-09-06）。`Abilities` / `AreaAbilities` /
    `IntervalAbilities` の 3 つだけを見ていて、`InitialAbilities`・
    `AbilitiesInOrderOfInteraction`・`ApplyLogicEffectToTarget`・
    節が直に持つ `LogicEffectGroupIds` を落としていた（274 人で 59 群。
    CH0165 の EX はそれで効果が 1 つも束に入っていなかった）。
    どの階層でも `LogicEffectGroupIds` を見たら拾う。
    """
    if isinstance(node, dict):
        for g in (node.get("LogicEffectGroupIds") or []):
            if isinstance(g, str):
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


def build_common(out_dir):
    """**全部の編成で同じもの。**戦闘の定数・式の係数・上限・陣形・遮蔽・装備。

    ここに置くのは「生徒にもボスにも依らない表」だけ。生徒ぶん・ボスぶんとは別に
    1 回だけ落として、画面はこれを 1 度読めばよい。
    """
    pack = {
        # **戦闘の定数。**手札 3 枚・コスト上限 10・回復の遅れ 2000ms・
        # 防御 / 命中 / 会心 の式の係数・時間の倍率（通常 1.3 / 倍速 1.7）
        "const": (ex("ConstCombatExcelTable") or [{}])[0],
        "constCommon": (ex("ConstCommonExcelTable") or [{}])[0],
        # 式の係数
        "ba": db("BulletArmorDamageFactorExcelTable"),
        "terrain": db("TerrainAdaptationFactorExcelTable"),
        "lvdiff": db("BattleLevelFactorExcelTable"),
        "lvstat": db("CharacterLevelStatFactorExcelTable"),
        "statInterp": db("StatLevelInterpolationExcelTable"),
        # 上限
        "statLimit": db("CharacterStatLimitExcelTable"),
        "calcLimit": db("CharacterCalculationLimitExcelTable"),
        "statsTrans": db("CharacterStatsTransExcelTable"),
        # 盤
        "form": db("FormationLocationExcelTable"),
        "fireLine": db("ObstacleFireLineCheckExcelTable"),
        "obstacleStat": db("ObstacleStatExcelTable"),
        "obstacle": battle("obstacledata"),
        # 内容ごとの決まり
        "fever": db("ContentsFeverExcelTable"),
        "hpbar": db("HpBarAbbreviationExcelTable"),
        # 装備（生徒ぶんに入れると 274 回重複する）
        "eq": [strip(r) for r in db("EquipmentExcelTable")],
        "eqstat": [strip(r) for r in db("EquipmentStatExcelTable")],
    }
    raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode()
    gz = gzip.compress(raw, 9)
    with open(out_dir / "common.json.gz", "wb") as f:
        f.write(gz)
    return len(raw), len(gz)


# **札の行そのものが、別の札を名前で指すことがある**（2026-09-06）。
# 木から辿れるのは 1 段目だけなので、束ねた行をもう一度なめて閉じる。
# ペロロジラの `DamageTransferEffectDAO` は
# `TransferredDamageEffectGroupId: "Perorozilla01_TransferredDamage_Effect01"` を持つが、
# その行は木のどこにも書いていないので束から丸ごと落ちていた
# （`LogicEffect_NPC` を数えて出した欄。多い順）
_LE_REFS = ("MaxGaugeLogicEffectGroupIdList", "LogicEffectGroupIdToDispel",
            "CheckLogicEffectGroupId", "AlarmEffectGroupIdList",
            "TransferredDamageEffectGroupId",
            "ChangeSkillCardToCCToCasterLogicEffectGroupId",
            "ApplyLogicEffectGroupIdWhenTriggered", "CapOverDeadlyAttackGroupId",
            "EachAlarmEffectGroupIdList", "CombinedAlarmEffectGroupIdList",
            "StackCountGroupId", "ApplyLogicEffectGroupId01")


def close_effects(eids, npc_by, pc_by, rounds=4):
    """束ねる札の名前を、行が指している先まで広げる。**同じ名前は 1 回だけ。**"""
    seen = set(eids)
    frontier = set(eids)
    for _ in range(rounds):
        nxt = set()
        for g in frontier:
            for r in (npc_by.get(g) or []) + (pc_by.get(g) or []):
                for k in _LE_REFS:
                    v = r.get(k)
                    for x in (v if isinstance(v, list) else [v]):
                        if isinstance(x, str) and x and x not in seen:
                            nxt.add(x)
        if not nxt:
            break
        seen |= nxt
        frontier = nxt
    return seen


def take_ent(c, ents, csl_rows, groups, ph_by, csl_by):
    """敵を 1 体束に入れて、**その子の枠の名前を `groups` に足す。**

    枠は `CharacterSkillListExcelTable` の行から取る。木の `UseSelectExSkill k` が
    指すのは `ExSkillGroupId[k]` で、`RaidSkillDescriptionList`（画面の説明）とは別物。
    """
    cid = c.get("Id")
    if cid in ents:
        return
    ents[cid] = c
    for pr in ph_by.get(cid, []):
        g = pr.get("NormalAttackSkillUniqueName")
        if g and g not in groups:
            groups.append(g)
    rows = csl_by.get(cid) or []
    if rows:
        csl_rows[cid] = [strip(r) for r in rows]
    for r in rows:
        for fld in ("ExSkillGroupId", "NormalSkillGroupId", "PassiveSkillGroupId",
                    "ExtraPassiveSkillGroupId", "PublicSkillGroupId",
                    "HiddenSkillGroupId"):
            v = r.get(fld)
            for g in (v if isinstance(v, list) else [v]):
                if g and g != "EmptySkill" and g not in groups:
                    groups.append(g)


def build_bosses(out_dir, chars, st_by, le_npc_by, le_pc_by, sk_by, want):
    """**総力戦と大決戦のボス 1 面 1 ファイル。**原文のまま。

    辿り方（2026-09-06 にペロロジラ Torment で端から端まで確かめた）:
      RaidStage → BossCharacterId / GroundId
                → CharacterExcelTable（ExternalBTId / CharacterAIId）
                → BossExternalBT（段と行動）/ BossPhase（段ごとの通常と使う EX 枠）
                → RaidSkillDescriptionList（枠の GroupId）→ LevelSkill の木
                → 木の `CharacterEntityDAO.UniqueName` → DevName でミニオンの実体と素の値
    """
    ground = {r.get("Id"): r for r in db("GroundExcelTable")}
    # **敵の枠は `CharacterSkillListExcelTable` にある。**キーは `CharacterId` ではなく
    # `CharacterSkillListGroupId` で、ボスとミニオンはそこに実 ID がそのまま入る。
    # 木の `UseSelectExSkill k` はこの行の `ExSkillGroupId[k]`（10 枠）を指す。
    # `RaidSkillDescriptionList` の並びは画面に出す説明で、**枠とは別物**
    # （ペロロジラは説明が 6 本しか無く、Ex04〜Ex08 が束から丸ごと抜けていた）
    csl_by = {}
    for r in db("CharacterSkillListExcelTable"):
        csl_by.setdefault(r.get("CharacterSkillListGroupId"), []).append(r)
    bt_by, ph_by = {}, {}
    for r in db("BossExternalBTExcelTable"):
        bt_by.setdefault(r.get("ExternalBTId"), []).append(r)
    for r in ex("BossPhaseExcelTable"):
        ph_by.setdefault(r.get("Id"), []).append(r)
    desc = {}
    for r in db("RaidSkillDescriptionListExcelTable"):
        desc[(r.get("BossGroup"), r.get("Difficulty"))] = r
    by_dev = {}
    for c in chars:
        if c.get("DevName"):
            by_dev[c["DevName"]] = c

    stages = [("raid", r) for r in db("RaidStageExcelTable")]
    stages += [("elim", r) for r in db("EliminateRaidStageExcelTable")]
    (out_dir / "boss").mkdir(parents=True, exist_ok=True)

    index, tot_raw, tot_gz, n = {}, 0, 0, 0
    for kind, sr in stages:
        key = f"{kind}{sr.get('Id')}"
        if want and key not in want and str(sr.get("Id")) not in want:
            continue
        d = desc.get((sr.get("RaidBossGroup"), sr.get("Difficulty")))
        groups = list((d or {}).get("SkillGroupId") or [])
        ents, csl_rows = {}, {}
        for cid in (sr.get("BossCharacterId") or []):
            c = chars_by_id.get(cid)
            if c:
                take_ent(c, ents, csl_rows, groups, ph_by, csl_by)
        # **盤の湧き点が名指ししている実体も束に入れる**（2026-09-06）。
        # 木からしか拾っていなくて、グロッキー中に湧く
        # `Perorozilla_Torment_Peroro_SmallSize01`〜`05`（被ダメージを本体へ転移する
        # Immortal の子）が丸ごと入っていなかった
        gr_pre = ground.get(sr.get("GroundId")) or {}
        board = {}
        for nm in (gr_pre.get("StageFileName") or []):
            sd = stage(nm)
            if sd:
                board[nm] = sd
        # **盤が撃つ技も束に入れる**（`GroundCommandUseSkill.SkillGroupId`。2026-09-07）。
        # ホドの節 3 は地面の体 18001002 が `HODGroundEx02` を本体に撃って、形態 1 と
        # 段を進める札を貼る。ここが無いと本体は最後まで狙えないまま
        for sd in board.values():
            for sec in (sd.get("Sections") or []) + [sd.get("Global") or {}]:
                for ev in (sec.get("Events") or []):
                    for cm in (ev.get("Commands") or []):
                        if "UseSkill" in str(cm.get("$type") or "") and cm.get("SkillGroupId"):
                            g = str(cm["SkillGroupId"])
                            if g not in groups:
                                groups.append(g)
        for sd in board.values():
            for sec in (sd.get("Sections") or []):
                for gl in (sec.get("EnemySpawnPointGroupList") or []):
                    for sp in (gl.get("SpawnPoints") or []):
                        # **`RandomSpawnPoint` は `SpawnList[].SpawnData` に体を持つ**（2026-09-07）。
                        # ケセド屋外 Torment の波（71 点）がこれで、`ChesedDroid_…_AR_Torment` 5 種が
                        # 束に入らず、波は何も湧かないまま本体だけを 0 秒から殴っていた
                        tids = [((sp.get("SpawnData") or {}).get("SpawnTemplateId") or "")]
                        for sl in (sp.get("SpawnList") or []):
                            tids.append(((sl.get("SpawnData") or {}).get("SpawnTemplateId") or ""))
                        for tid in tids:
                            if not tid:
                                continue
                            c = resolve_dev(tid, by_dev)
                            if c:
                                take_ent(c, ents, csl_rows, groups, ph_by, csl_by)
                            else:
                                _dev_miss.add(tid)
        # **木を歩いて、出てきた実体の枠もまた歩く。**ミニオンは自分でも撃つので、
        # 1 周で止めると湧いた子の通常攻撃と EX が束に入らない
        ls, eids, names, walked = {}, set(), set(), set()
        for _ in range(4):
            todo = [g for g in groups if g not in walked]
            if not todo:
                break
            for g in todo:
                walked.add(g)
                t = level_skill(g)
                if t is None:
                    continue
                ls[g] = strip(t)
                effect_ids(t, eids)
                entity_names(t, names)
            for nm in sorted(names):
                c = resolve_dev(nm, by_dev)
                if c:
                    take_ent(c, ents, csl_rows, groups, ph_by, csl_by)
                else:
                    _dev_miss.add(nm)
        le = []
        for g in sorted(close_effects(eids, le_npc_by, le_pc_by)):
            rows = le_npc_by.get(g) or le_pc_by.get(g) or []
            le.extend(strip(r) for r in rows)
        sk = []
        for g in groups:
            sk.extend(strip(r) for r in (sk_by.get(g) or []))
        # **盤**は上で読んである（`StageFileName` は 1〜3 本。
        # 本編・2 フェーズ開始・3 フェーズ開始）
        gr0 = gr_pre
        pack = {
            "kind": kind, "stage": strip(sr),
            # **素の被ダメージ率を掛けるボスか**（ケセドだけ）
            "dmgOnly": str(sr.get("RaidBossGroupType") or "").lower() in dmg_only_groups(),
            "ground": strip(gr0),
            "board": board,
            "groups": groups, "csl": csl_rows, "ls": ls, "le": le, "sk": sk,
            "bt": [strip(r) for cid in ents for r in bt_by.get(
                (ents[cid] or {}).get("ExternalBTId"), [])],
            "phase": [strip(r) for cid in ents for r in ph_by.get(cid, [])],
            "ent": [strip(c) for c in ents.values()],
            "st": [strip(st_by[c["Id"]]) for c in ents.values() if c["Id"] in st_by],
        }
        raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode()
        gz = gzip.compress(raw, 9)
        with open(out_dir / "boss" / f"{key}.json.gz", "wb") as f:
            f.write(gz)
        # **索引は「どの面か」を引ける形にする**（2026-09-06）。画面は
        # ボス群・難易度・装甲しか持っていないので、それで 1 面に絞れないと
        # ファイル名が決まらない。`cid` は 51 組が重なる（同じボスが 2 期）ので
        # 群・難易度・装甲で引き、同じものが 2 つあれば新しい面（大きい Id）を採る
        gr = ground.get(sr.get("GroundId")) or {}
        index[key] = {"g": len(ls), "e": len(le), "n": len(ents), "b": len(gz),
                      "cid": (sr.get("BossCharacterId") or [None])[0],
                      # **本体が 2 体以上いる面がある**（カイテンジャーは
                      # `BossCharacterId` が複数）。画面が渡す `cid` が先頭とは
                      # 限らないので、全部並べておく（2026-09-06。
                      # `面が引けない cid=7404700` で 2 本落ちていた）
                      "cids": list(sr.get("BossCharacterId") or []),
                      "grp": sr.get("RaidBossGroup"), "df": sr.get("Difficulty"),
                      "dur": sr.get("BattleDuration"),
                      "arm": gr.get("EnemyArmorType"), "bul": gr.get("EnemyBulletType"),
                      "ter": gr.get("StageTopography"), "lvb": gr.get("LevelBoss")}
        tot_raw += len(raw)
        tot_gz += len(gz)
        n += 1
        if n % 20 == 0:
            print(f"  ボス {n} 面 … {tot_gz:,} バイト")
    if _dev_miss:
        print(f"  当てられなかった実体名 {len(_dev_miss)}: {sorted(_dev_miss)[:6]}")
    return index, tot_raw, tot_gz


chars_by_id = {}


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    only = {a for a in argv[1:] if a.startswith("--")}
    want = set(args)
    OUT.mkdir(parents=True, exist_ok=True)

    print("DB を読む …")
    csl = db("CharacterSkillListExcelTable")
    sk_tbl = db("SkillExcelTable")
    le_tbl = db("LogicEffect_PC")
    le_npc = db("LogicEffect_NPC")
    chars = db("CharacterExcelTable")
    stats = db("CharacterStatExcelTable")
    chars_by_id.update({c.get("Id"): c for c in chars})
    st_by = {r.get("CharacterId"): r for r in stats}

    sk_by, le_by, le_npc_by = {}, {}, {}
    for r in sk_tbl:
        sk_by.setdefault(r.get("GroupId"), []).append(r)
    for r in le_tbl:
        le_by.setdefault(r.get("GroupId"), []).append(r)
    for r in le_npc:
        le_npc_by.setdefault(r.get("GroupId"), []).append(r)

    if not only or "--common" in only:
        raw, gz = build_common(OUT)
        print(f"  common.json.gz  生 {raw:,} ／ gzip {gz:,} バイト")

    if not only or "--boss" in only:
        print("ボスを束ねる …")
        bidx, braw, bgz = build_bosses(OUT, chars, st_by, le_npc_by, le_by, sk_by, want)
        with open(OUT / "boss" / "index.json", "w", encoding="utf-8") as f:
            f.write(json.dumps(bidx, ensure_ascii=False, separators=(",", ":")))
        print(f"  ボス {len(bidx)} 面 ／ 生 {braw:,} ／ gzip {bgz:,} バイト")

    if only and "--students" not in only:
        return

    # **道具が持っている生徒だけ。**`data.js` の `stats` の並びをそのまま使う
    with open(ROOT / "tools" / "tl" / "data.js", encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"window\.TLBOSS\s*=\s*", src)
    ids = list(json.loads(src[m.end():].rstrip().rstrip(";"))["stats"].keys())
    if want:
        ids = [i for i in ids if i in want]
    print(f"生徒 {len(ids)} 人")

    # 育成の表。**生徒ぶんに切って入れる**（画面が引き直さずに済む）
    tr_by, pot_by, potst_by, gear_by, wp_by, fav_by = {}, {}, {}, {}, {}, {}
    for r in db("CharacterTranscendenceExcelTable"):
        tr_by.setdefault(str(r.get("CharacterId")), []).append(r)
    for r in db("CharacterPotentialExcelTable"):
        pot_by.setdefault(str(r.get("Id")), []).append(r)
    for r in db("CharacterPotentialStatExcelTable"):
        potst_by.setdefault(r.get("PotentialStatGroupId"), []).append(r)
    for r in db("CharacterGearExcelTable"):
        gear_by.setdefault(str(r.get("CharacterId")), []).append(r)
    for r in db("CharacterWeaponExcelTable"):
        wp_by.setdefault(str(r.get("Id")), []).append(r)
    for r in db("FavorLevelRewardExcelTable"):
        fav_by.setdefault(str(r.get("CharacterId")), []).append(r)
    ai_by = {r.get("Id"): r for r in db("CharacterAIExcelTable")}

    dev = {str(c.get("Id")): c.get("DevName") for c in chars if c.get("Id")}
    csl_by = {}
    for r in csl:
        csl_by.setdefault(str(r.get("CharacterSkillListGroupId")), []).append(r)

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
        for g in sorted(close_effects(eids, le_npc_by, le_by)):
            le.extend(strip(r) for r in (le_by.get(g) or le_npc_by.get(g) or []))
        sk = []
        for g in groups:
            sk.extend(strip(r) for r in (sk_by.get(g) or []))
        ch = chars_by_id.get(int(sid))
        pots = pot_by.get(sid) or []
        pack = {"id": int(sid), "dev": dev.get(sid), "groups": groups,
                "ls": ls, "le": le, "csl": [strip(r) for r in rows], "sk": sk,
                # **実体と素の値。**画面が別表を引かずに済むよう 1 人ぶんだけ切って入れる
                "ch": strip(ch) if ch else None,
                "st": strip(st_by.get(int(sid))) if int(sid) in st_by else None,
                "ai": strip(ai_by.get((ch or {}).get("CharacterAIId"))) if ch else None,
                "tr": [strip(r) for r in (tr_by.get(sid) or [])],
                "pot": [strip(r) for r in pots],
                "potst": [strip(r) for p in pots
                          for r in (potst_by.get(p.get("PotentialStatGroupId")) or [])],
                "gear": [strip(r) for r in (gear_by.get(sid) or [])],
                "wp": [strip(r) for r in (wp_by.get(sid) or [])],
                "favor": [strip(r) for r in (fav_by.get(sid) or [])]}
        raw = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode()
        gz = gzip.compress(raw, 9)
        with open(OUT / f"s{sid}.json.gz", "wb") as f:
            f.write(gz)
        index[sid] = {"g": len(ls), "e": len(le), "b": len(gz)}
        tot_raw += len(raw)
        tot_gz += len(gz)
        tot_grp += len(ls)
        if len(index) % 40 == 0:
            print(f"  {len(index)}/{len(ids)} 人 … {tot_gz:,} バイト")

    with open(OUT / "index.json", "w", encoding="utf-8") as f:

        f.write(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"\n書いた: {OUT}")
    print(f"  生徒 {len(index)} 人 ／ 枠 {tot_grp} ／ 生 {tot_raw:,} バイト ／ gzip {tot_gz:,} バイト")
    if _ls_miss:
        print(f"  取れなかった枠 {len(_ls_miss)}: {sorted(_ls_miss)[:8]}")


if __name__ == "__main__":
    main(sys.argv)
