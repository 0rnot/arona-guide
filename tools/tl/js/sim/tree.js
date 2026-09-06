// ------------------------------------------------------------ 木を歩いて事象を出す
/* **要約する場所を焼き出しから実行時へ移す**（2026-09-06、先生の指示）。
   ここは `LevelSkill/<枠>.json` の原文をそのまま受け取って、
   「発動から何コマ後に、どの札が、誰に、どの範囲で、弾に乗って届くか」を並べる。

   今までは `build-tool-data.py` が同じ木を歩いて `imp`（着弾コマ）・`prj`（弾）・
   `geo`（中心と狙い方）・`dmg`（倍率の行）に**分けて**焼いていた。分けた時点で
   「この着弾はこの範囲のこの相手選びで来た」という結び付きが切れて、
   実行時に条件（形態・札・当たる人数）で選び直せなくなっていた。
   **1 つの事象に全部くっつけたまま返すのが、この関数の仕事。**

   出す形（`events`）:

     f       発動からのコマ（30 コマ = 1 秒）
     gid     効果の札（`LogicEffect_PC` の `GroupId`）
     sel     誰に  `{side, type, max, sort, order, apply}`
     area    範囲  `{kind, r, deg, w, h, exr, off, angle, spawn, dir}` ／ 単体なら null
     prj     弾    `{speed, kind}`（`kind` は `c` 相手を追う ／ `p` 置いた点へ）／ 無ければ null
     dist    その発の取り分（`DamageDistributeRate`。1 万分率）／ 無ければ null
     single  1 体にしか入らないか
     mods    そのアビリティの条件（`Modifiers`）。**畳まずにそのまま**

   コマの数え方（`build-tool-data.py` の `_ls_frames` から引き継いだ実測ずみの決め）:

   - `EntityTimeline[].Frame` を足しながら下りる
   - `Abilities[].StartDelay` を足す
   - `AreaAbilities` は範囲の `HitFrames` の数だけ出る。ただし
     `AllowDuplicateHit: false` なら**先頭だけ**（2026-09-06 の監査。チェリノの EX は
     73/93/113/133 の円がそれぞれ `HitFrames [1,4,7]` で、DB の 4 発が 12 点になっていた）
   - `SplashAreaEntityData` は `SplashDelayFrame` を足してから下りる
   - `FixedFrameTargetProjectileEntityDAO` は `FireDelayFrame` ＋ `FrameToHit`（レイの EX の 18 発目）
   - `BattleItemEntityDAO` は `ActiveDelayInFrame`（ムツキの NS の地雷）
   - `MainEntityData` は**宣言でもある**。同じ体が `EntityTimeline` にも並んでいたら
     そちらが本当の発射時刻なので、二重に数えない
*/

/** `$type` の短い名前。**跳ねる弾の節は `$type` を持たない**ので形で判る */
export function typeOf(e) {
  var t = String((e && e.$type) || '').split(',')[0].split('.').pop();
  if (!t && e && e.BounceRadius != null) { return 'BounceProjectileEntity'; }
  // **`ChainBeams` の中の帯は `$type` を持たない**（2026-09-06、ペロロジラ Torment
  // の EX01。親の帯だけ `BeamEntityDAO` で、繋がる 2 本は型なし）
  if (!t && e && e.ExpansionDuration != null && e.ObbWidth != null) {
    return 'BeamEntityDAO';
  }
  return t;
}

var AREA = { CircleAreaEntityDAO: 'Circle', FanAreaEntityDAO: 'Fan',
             ObbAreaEntityDAO: 'Obb', DonutAreaEntityDAO: 'Donut',
             CircleAuraEntityDAO: 'CircleAura',
             // **敵側だけに出る型**（2026-09-06、ペロロジラ Torment の EX01 で見つけた）。
             // 線の帯。`ObbWidth` が幅で、伸び 10 コマ・維持 310 コマ・消え 10 コマ
             BeamEntityDAO: 'Beam' };

/** 範囲の形。範囲の体でなければ null。単位は 1/100 ワールド（`PositionOffset` だけワールド） */
export function shapeOf(e) {
  var k = AREA[typeOf(e)];
  if (!k) { return null; }
  var po = e.PositionOffset || {};
  return { kind: k, r: e.Radius != null ? e.Radius : null,
           deg: e.Degree != null ? e.Degree : null,
           w: e.Width != null ? e.Width : (e.ObbWidth != null ? e.ObbWidth : null),
           h: e.Height != null ? e.Height : null,
           exr: e.ExcludeRadius || null,
           off: (po.x || po.y) ? { x: po.x || 0, y: po.y || 0 } : null,
           angle: e.AngleOffset || null,
           spawn: e.SpawnPositionType || null,
           dir: e.SpawnDirectionType || null };
}

/** 相手の選び方。`EssentialCandidateRule` と `TargetSortRule` をひとまとめに */
export function selOf(ecr, sort) {
  ecr = ecr || {};
  var s = (sort && sort.IsValid) ? sort : null;
  return { side: ecr.TargetSide || null, type: ecr.TargetingType || null,
           max: ecr.MaxTargetCount != null ? ecr.MaxTargetCount : null,
           apply: ecr.ApplyEntityType != null ? ecr.ApplyEntityType : null,
           sort: s ? (s.SortCriteria || null) : null,
           order: s ? (s.OrderBy || null) : null,
           dup: s ? !!s.AllowDuplicate : false };
}

/** `TargetSide` は文字列 `"None"` のことがある（チェリノの EX の円）。空と同じ扱い */
function hasSide(ecr) {
  var v = ecr && ecr.TargetSide;
  return !!v && v !== 'None';
}

/** 弾に乗るか。`Speed` と `ProjectileType` を持つ体から下は、着弾してからの相対 */
function prjOf(e) {
  if (!e.Speed || !e.ProjectileType) { return null; }
  return { speed: e.Speed, kind: e.ProjectileType === 'TargetCharacter' ? 'c' : 'p' };
}

/** **1 体にしか入らないか。**`Target…Entity` の `Abilities`（範囲ではないほう）で
    配られて、効いている相手選びの `MaxTargetCount` が 1 のものだけ。
    `AreaAbilities` は範囲なので必ず偽 */
function singleOf(typ, key, sel) {
  if (key !== 'Abilities') { return false; }
  if (!(typ.indexOf('Target') === 0 || typ.indexOf('Bounce') === 0)) { return false; }
  return sel.max === 1;
}

/** `doc` は `LevelSkill/<枠>.json` の原文。返すのはコマ順に並べた事象の配列 */
export function skillEvents(doc) {
  if (!doc) { return []; }
  var out = [];
  var root = selOf(doc.EssentialCandidateRule, doc.TargetSortRule);
  var names = {};

  function collectNames(node, dep) {
    if (!node || typeof node !== 'object' || dep > 8) { return; }
    var tl = node.EntityTimeline;
    var i, e, k, sub;
    for (i = 0; tl && i < tl.length; i++) {
      e = tl[i] && (tl[i].Entity || tl[i].AreaData);
      if (!e || typeof e !== 'object') { continue; }
      if (e.EntityName) { names[e.EntityName] = 1; }
      for (k = 0; k < NEST.length; k++) {
        sub = e[NEST[k]];
        if (!sub || typeof sub !== 'object') { continue; }
        if (Array.isArray(sub)) {
          for (var bq = 0; bq < sub.length; bq++) {
            if (sub[bq] && sub[bq].EntityName) { names[sub[bq].EntityName] = 1; }
            collectNames(sub[bq], dep + 1);
          }
          continue;
        }
        if (sub.EntityName) { names[sub.EntityName] = 1; }
        collectNames(sub, dep + 1);
      }
      collectNames(e, dep + 1);
    }
  }

  /** **`…_Lv07` のようにレベルを名前に持つ群。**同じアビリティに `_Lv01` 〜 `_Lv10` が
      並ぶことがあり（274 人で 18 枠）、効くのは**その子のスキル段の 1 本だけ**。
      どの枠の段かは名前の途中が言う（`CH0124_ExtraPassive01_Effect01_Lv07` なら
      サブスキルの 7 段目）。全部撃つと 10 本ぶん入る（CH0124 の通常攻撃が 20.6 倍だった）。
      返すのは `{n, slot}` ／ レベルを持たない名前なら null */
  function lvPickOf(gid) {
    var m = /_Lv0?(\d{1,2})$/i.exec(gid);
    if (!m) { return null; }
    var k = /_(GearPublic|ExtraPassive|HiddenPassive|WeaponPassive|Passive|Public|Ex|Normal)\d*_/
      .exec(gid);
    var src = k ? k[1] : null;
    var slot = src === 'GearPublic' ? 'Public'
      : (src === 'WeaponPassive' || src === 'HiddenPassive') ? 'Passive' : src;
    return { n: +m[1], slot: slot };
  }

  function ability(node, key, ctx, typ) {
    var list = node[key] || [], i, j, q, a, gids, base, hits;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || typeof a !== 'object') { continue; }
      gids = a.LogicEffectGroupIds || [];
      if (!gids.length) { continue; }
      base = ctx.at + (a.StartDelay || 0);
      hits = [0];
      if (key === 'AreaAbilities') {
        hits = (node.HitFrames && node.HitFrames.length) ? node.HitFrames.slice() : [0];
        if (node.AllowDuplicateHit === false) { hits = hits.slice(0, 1); }
      }
      for (j = 0; j < gids.length; j++) {
        for (q = 0; q < hits.length; q++) {
          out.push({ f: base + hits[q], gid: gids[j], sel: ctx.sel, lvPick: null,
                     share: ctx.share != null ? ctx.share : null,
                     area: key === 'AreaAbilities' ? ctx.area : null,
                     prj: ctx.prj || null, dist: ctx.dist != null ? ctx.dist : null,
                     single: singleOf(typ, key, ctx.sel),
                     mods: (a.Modifiers && a.Modifiers.length) ? a.Modifiers : null });
        }
      }
    }
  }

  /** **3 つめの容れ物。**`IntervalAbilities` は `{Phase, Frame, Abilities:[…]}` の配列で、
      1 本の帯が決まったコマごとに効果を落とす（ペロロジラ Torment の EX01 が
      30 コマおき）。`Abilities` / `AreaAbilities` と違って**もう一段深い。** */
  function interval(node, ctx, typ) {
    var list = node.IntervalAbilities || [], i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e || typeof e !== 'object' || !e.Abilities) { continue; }
      ability({ Abilities: e.Abilities }, 'Abilities',
              { at: ctx.at + (e.Frame || 0), sel: ctx.sel, prj: ctx.prj,
                area: ctx.area, dist: ctx.dist, rootEcr: ctx.rootEcr }, typ);
    }
  }

  // **下に体が吊れる欄。**全 274 人の木を総当たりで歩いて、
  // `LogicEffectGroupIds` に届く道を数えて出した並び（2026-09-06 の `_abilscan.mjs`）。
  // `Initial*` の 3 つと `BundledMainEntityDatas` / `EntityList` はここに無くて
  // **59 群が事象に出ていなかった。**
  var NEST = ['SplashAreaEntityData', 'BounceProjectileEntity',
              'SkillEntitySpawnerData', 'AreaSpawnerData',
              'InEffectRadiusAreaSpawnerEntity', 'InEffectRadiusSkillEntitySpawnerEntity',
              'InitialAreaSpawnerEntity', 'InitialSkillEntitySpawnerData',
              'InitialEntitySpawner', 'BundledMainEntityDatas'];

  function entity(e, ctx, dep) {
    if (!e || typeof e !== 'object' || dep > 8) { return; }
    var typ = typeOf(e), at = ctx.at, sel = ctx.sel, prj = ctx.prj, k, sub;
    // **決まったコマで届く弾**（レイの EX の 18 発目。80 コマで撃って `FrameToHit` 7 で 88）。
    // 速さではなくコマ数なので、盤の距離ぶんを足さない
    if (typ.indexOf('FixedFrameTargetProjectile') === 0) {
      at += (e.FireDelayFrame || 0) + (e.FrameToHit || 0);
    } else if (!prj) {
      prj = prjOf(e) || null;
    }
    // **置いた物が動き出すまでの待ち**（ムツキの NS の地雷。`ActiveDelayInFrame` 30）
    if (typ === 'BattleItemEntityDAO') { at += (e.ActiveDelayInFrame || 0); }
    // **自前の相手選びを持つ体はそちらで見る**（ヒナタの跳ねる弾は
    // `OverrideTargetingRule: true` で `MaxTargetCount 1`。コハルの EX は根が回復の円の
    // 規則で、ダメージの円のほうが `TargetSide: Enemy`）
    if (hasSide(e.EssentialCandidateRule) &&
        (e.OverrideTargetingRule || !hasSide(ctx.rootEcr))) {
      sel = selOf(e.EssentialCandidateRule, e.TargetSortRule || null);
    } else if (e.OverrideTargetingRule && e.EssentialCandidateRule) {
      sel = selOf(e.EssentialCandidateRule, e.TargetSortRule || null);
    }
    var area = shapeOf(e) || ctx.area || null;
    var c2 = { at: at, sel: sel, prj: prj, area: area, dist: ctx.dist,
               rootEcr: ctx.rootEcr, share: ctx.share };
    ability(e, 'Abilities', c2, typ);
    ability(e, 'AreaAbilities', c2, typ);
    // **湧いた瞬間に落ちるアビリティ。**並びは `Abilities` と同じ
    ability(e, 'InitialAbilities', c2, typ);
    interval(e, c2, typ);
    // **順番に配るアビリティ。**`[{Ability: {…}}]` の包み（CH0193 の EX）
    if (Array.isArray(e.AbilitiesInOrderOfInteraction)) {
      var wr = [], wq;
      for (wq = 0; wq < e.AbilitiesInOrderOfInteraction.length; wq++) {
        var w0 = e.AbilitiesInOrderOfInteraction[wq];
        if (w0 && w0.Ability) { wr.push(w0.Ability); }
      }
      if (wr.length) { ability({ Abilities: wr }, 'Abilities', c2, typ); }
    }
    // **その節自身が 1 つのアビリティのことがある**（`LogicEffectGroupIds` を直に持つ）。
    // `MainEntityData` と時系列の体で 14 例（CH0115 の EX ほか）
    if (Array.isArray(e.LogicEffectGroupIds) && e.LogicEffectGroupIds.length) {
      ability({ Abilities: [e] }, 'Abilities', c2, typ);
    }
    // **相手に直接落とす欄**（CH0258_02 と CH0297 の EX）。**配列**
    if (Array.isArray(e.ApplyLogicEffectToTarget) && e.ApplyLogicEffectToTarget.length) {
      ability({ Abilities: e.ApplyLogicEffectToTarget }, 'Abilities', c2, typ);
    } else if (e.ApplyLogicEffectToTarget &&
               typeof e.ApplyLogicEffectToTarget === 'object') {
      ability({ Abilities: [e.ApplyLogicEffectToTarget] }, 'Abilities', c2, typ);
    }
    // **弾の一覧**（`EntityList: [{ProjectileData: {…}}]`。CH0194 の NS）
    if (Array.isArray(e.EntityList)) {
      for (var el = 0; el < e.EntityList.length; el++) {
        var ed = e.EntityList[el];
        if (ed && ed.ProjectileData) { entity(ed.ProjectileData, c2, dep + 1); }
        else if (ed && typeof ed === 'object' && ed.$type) { entity(ed, c2, dep + 1); }
      }
    }
    for (k = 0; k < NEST.length; k++) {
      sub = e[NEST[k]];
      if (!sub || typeof sub !== 'object') { continue; }
      // **束ねた体は配列**（`BundledMainEntityDatas`。CH0347 の EX）
      if (Array.isArray(sub)) {
        for (var bn = 0; bn < sub.length; bn++) {
          if (sub[bn] && typeof sub[bn] === 'object') { entity(sub[bn], c2, dep + 1); }
        }
        continue;
      }
      if (NEST[k] === 'SplashAreaEntityData') {
        entity(sub, { at: at + (e.SplashDelayFrame || 0), sel: sel, prj: prj,
                      area: null, dist: ctx.dist, rootEcr: ctx.rootEcr }, dep + 1);
      } else if (NEST[k] === 'SkillEntitySpawnerData' || NEST[k] === 'AreaSpawnerData') {
        timeline(sub, c2, dep + 1);
      } else {
        entity(sub, c2, dep + 1);
      }
    }
    // **通常攻撃の弾は `ShotFrames` に入っている**（2026-09-06）。
    // `[{Frame, DamageDistributeRate, Entity:{…弾…}}]` で、`Entity` が本体。
    // ここを歩かないと**通常攻撃のダメージが 1 発も出ない**（アルの
    // `AruNormal01` は事象 0 だった）。`DamageDistributeRate` は 1 発の取り分
    if (Array.isArray(e.ShotFrames)) {
      for (k = 0; k < e.ShotFrames.length; k++) {
        var sf = e.ShotFrames[k];
        if (!sf || !sf.Entity) { continue; }
        entity(sf.Entity, { at: at + (sf.Frame || 0), sel: sel, prj: prj,
                            area: area, dist: ctx.dist, rootEcr: ctx.rootEcr,
                            share: (sf.DamageDistributeRate != null
                                    ? sf.DamageDistributeRate : 10000) / 10000 },
               dep + 1);
      }
    }
    // **繋がる帯は包みに入って配列で吊られている**（ペロロジラ Torment の EX01）。
    // `ChainBeams: [{Phase, MaxBranchCount, AllowParentTargetDupilication,
    //                CheckTargetRadiusToSpawn, BeamEntityData: {…帯…}}]`
    // で、包みの中の `BeamEntityData` が本体。**それぞれ別の効果を落とす。**
    if (Array.isArray(e.ChainBeams)) {
      for (k = 0; k < e.ChainBeams.length; k++) {
        var cw = e.ChainBeams[k];
        if (cw && cw.BeamEntityData) { entity(cw.BeamEntityData, c2, dep + 1); }
      }
    }
    timeline(e, c2, dep + 1);
  }

  function timeline(node, ctx, dep) {
    if (!node || typeof node !== 'object' || dep > 8) { return; }
    var tl = node.EntityTimeline || [], i, et, e;
    for (i = 0; i < tl.length; i++) {
      et = tl[i];
      if (!et || typeof et !== 'object') { continue; }
      e = et.Entity || et.AreaData || et;
      entity(e, { at: ctx.at + (et.Frame || 0), sel: ctx.sel, prj: ctx.prj,
                  area: ctx.area,
                  dist: et.DamageDistributeRate != null ? et.DamageDistributeRate : ctx.dist,
                  rootEcr: ctx.rootEcr }, dep + 1);
    }
  }

  collectNames(doc, 0);
  // **根の `ShotFrames` の体は `MainEntityData` と同じ弾の宣言**（2026-09-06）。
  // 名前を控えておかないと、同じ弾を 2 回歩いて**通常攻撃が 1 発多く出る**
  // （アリスは 28 コマの 1 発なのに [0, 28] の 2 発になっていた）
  for (var s1 = 0; s1 < (doc.ShotFrames || []).length; s1++) {
    var en = doc.ShotFrames[s1] && doc.ShotFrames[s1].Entity;
    if (en && en.EntityName) { names[en.EntityName] = 1; }
  }
  var me = doc.MainEntityData;
  if (me && typeof me === 'object') {
    var k2, sub2;
    for (k2 = 0; k2 < NEST.length; k2++) {
      sub2 = me[NEST[k2]];
      if (sub2 && typeof sub2 === 'object') { collectNames(sub2, 1); }
    }
    // **`MainEntityData` は宣言でもある。**同じ体が時系列にも並んでいたら数えない
    if (!names[me.EntityName]) {
      entity(me, { at: 0, sel: root, prj: null, area: null, dist: null,
                   rootEcr: doc.EssentialCandidateRule }, 0);
    }
  }
  timeline(doc, { at: 0, sel: root, prj: null, area: null, dist: null,
                  rootEcr: doc.EssentialCandidateRule }, 0);
  // **通常攻撃は根に `ShotFrames` を持つ**（`NormalAttackSkillActionDAO`）。
  // 体の中ではなく文書の直下なので、ここでも歩く。
  // 落としていて**通常攻撃のダメージが 1 発も出ていなかった**（2026-09-06）
  if (Array.isArray(doc.ShotFrames)) {
    for (var s0 = 0; s0 < doc.ShotFrames.length; s0++) {
      var sf0 = doc.ShotFrames[s0];
      if (!sf0 || !sf0.Entity) { continue; }
      entity(sf0.Entity, { at: sf0.Frame || 0, sel: root, prj: null, area: null,
                           dist: null, rootEcr: doc.EssentialCandidateRule,
                           share: (sf0.DamageDistributeRate != null
                                   ? sf0.DamageDistributeRate : 10000) / 10000 }, 0);
    }
  }

  // **段を名前に持つ群は、同じコマに一族が並ぶ。**（`_Lv01` 〜 `_Lv10`）
  // 別々のアビリティに分かれていることがあるので、**出し終わってから**数える
  var famN = {}, fi, fe, fp, fk;
  for (fi = 0; fi < out.length; fi++) {
    fp = lvPickOf(out[fi].gid);
    if (!fp) { continue; }
    fk = String(out[fi].gid).replace(/_Lv0?\d{1,2}$/i, '') + '@' + out[fi].f;
    famN[fk] = (famN[fk] || 0) + 1;
  }
  for (fi = 0; fi < out.length; fi++) {
    fe = out[fi];
    fp = lvPickOf(fe.gid);
    if (!fp) { continue; }
    fk = String(fe.gid).replace(/_Lv0?\d{1,2}$/i, '') + '@' + fe.f;
    if (famN[fk] > 1) { fe.lvPick = fp; }
  }

  out.sort(function (a, b) { return a.f - b.f; });
  return out;
}

/** その枠の届く距離（`Range`）。無ければ null */
export function rangeOf(doc) { return (doc && doc.Range) || null; }

/** **その枠が呼ぶ実体。**`SummonGroups[].SummonEntities[]` の `CharacterEntityDAO`。

    ペロロジラの Ex03（吸い込みの前に湧かせるほう）はここに中サイズのペロロミニオンを
    並べている。**グロッキーの鎖の 1 本目**で、ここが無いと吸うものが無く、
    ゲージが溜まらず、分裂も起きない（2026-09-06）。

    返すのは `{f, name, dur}`。`f` は発動からのコマ（`SpawnDelay`）。 */
export function summonsOf(doc) {
  var out = [];
  function walk(o, delay) {
    if (!o || typeof o !== 'object') { return; }
    if (Array.isArray(o)) {
      for (var q = 0; q < o.length; q++) { walk(o[q], delay); }
      return;
    }
    var d2 = o.SpawnDelay != null ? o.SpawnDelay : delay;
    var gs = o.SummonGroups;
    if (Array.isArray(gs)) {
      for (var i = 0; i < gs.length; i++) {
        var es = (gs[i] || {}).SummonEntities || [];
        for (var j = 0; j < es.length; j++) {
          var e = es[j];
          if (e && e.UniqueName) {
            out.push({ f: d2 || 0, name: e.UniqueName, dur: e.Duration || 0 });
          }
        }
      }
    }
    for (var k in o) {
      if (k === '$type' || k === 'SummonGroups') { continue; }
      walk(o[k], d2);
    }
  }
  walk(doc, 0);
  return out;
}

/** 木の `UniqueName` を束の `DevName` に当てる。**綴りが一致しない。**
    `build-tl-db.py` の `resolve_dev` と同じ規則（木は `_Peroro` を挟む）。 */
export function resolveDev(name, byDev) {
  if (byDev[name]) { return name; }
  var alt = name.replace('_Peroro_', '_').replace('_Peroro', '_').replace('__', '_');
  if (byDev[alt]) { return alt; }
  var parts = name.split('_');
  var tail = /_Move$/.test(name) ? parts.slice(-2).join('_') : parts.slice(-1).join('_');
  var head = parts[0], keys = Object.keys(byDev), cand = [], i;
  for (i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(head) === 0 && keys[i].slice(-tail.length) === tail) {
      cand.push(keys[i]);
    }
  }
  return cand.length === 1 ? cand[0] : null;
}
