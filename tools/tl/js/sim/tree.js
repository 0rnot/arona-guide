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
        if (sub && typeof sub === 'object') {
          if (sub.EntityName) { names[sub.EntityName] = 1; }
          collectNames(sub, dep + 1);
        }
      }
      collectNames(e, dep + 1);
    }
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
          out.push({ f: base + hits[q], gid: gids[j], sel: ctx.sel,
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

  var NEST = ['SplashAreaEntityData', 'BounceProjectileEntity',
              'SkillEntitySpawnerData', 'AreaSpawnerData',
              'InEffectRadiusAreaSpawnerEntity', 'InEffectRadiusSkillEntitySpawnerEntity'];

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
               rootEcr: ctx.rootEcr };
    ability(e, 'Abilities', c2, typ);
    ability(e, 'AreaAbilities', c2, typ);
    interval(e, c2, typ);
    for (k = 0; k < NEST.length; k++) {
      sub = e[NEST[k]];
      if (!sub || typeof sub !== 'object') { continue; }
      if (NEST[k] === 'SplashAreaEntityData') {
        entity(sub, { at: at + (e.SplashDelayFrame || 0), sel: sel, prj: prj,
                      area: null, dist: ctx.dist, rootEcr: ctx.rootEcr }, dep + 1);
      } else if (NEST[k] === 'SkillEntitySpawnerData' || NEST[k] === 'AreaSpawnerData') {
        timeline(sub, c2, dep + 1);
      } else {
        entity(sub, c2, dep + 1);
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

  out.sort(function (a, b) { return a.f - b.f; });
  return out;
}

/** その枠の届く距離（`Range`）。無ければ null */
export function rangeOf(doc) { return (doc && doc.Range) || null; }
