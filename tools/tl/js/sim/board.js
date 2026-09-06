// ------------------------------------------------------------ 盤（Stage/*.json）を読む
//
// **敵がいつ・どこに湧くかは盤の台本に書いてある。**`GroundExcelTable.StageFileName` が
// 指すファイルで、束ねるときに `pack.board` へ原文のまま入れてある。
//
//   Sections[]                       節。フェーズが変わると次の節へ移る
//     .EnemySpawnPointGroupList[]
//       .SpawnPoints[]               湧き点。`SpawnData.SpawnTemplateId` が実体の DevName
//                                    `CommandIdList` がこの点を起こす合図の名前
//     .Events[]                      `Conditions[]`（いつ）と `Commands[]`（何をする）の組
//     .Obstacles[]                   遮蔽。**総力戦の盤にもある**（2026-09-07 に数えた）
//   Formations[]                     味方の並びの原点。`SectionIndex` ごとに 1 つ
//
// 読み方は `build-tool-data.py` の `_spawn_when` と同じ形にしてある（あちらは
// 画面に「いつ湧くか」を出すため、こちらは実際に湧かせるため）。

function typeOf(o) {
  return String((o && o.$type) || '').split(',')[0].split('.').pop();
}

/** その事象の条件を短い札にする。`start` / `st:Groggy` / `ph:1` など。 */
function tagsOf(ev) {
  var cs = ev.Conditions || [], out = [], i;
  for (i = 0; i < cs.length; i++) {
    var c = cs[i], t = typeOf(c).replace('GroundCondition', '');
    // **`BattleStarted` も「最初から居る」。**ビナーとグレゴリオがこちら
    if (t === 'SectionStarted' || t === 'BattleStarted') { out.push('start'); }
    else if (c.StatusToCheck) { out.push('st:' + c.StatusToCheck); }
    else if (t === 'CharacterPhaseChanged') { out.push('ph:' + c.Phase); }
    else { out.push(t); }
  }
  return out;
}

/** 盤 1 枚を、回すのに要る形へ。 */
export function boardPlan(doc) {
  var secs = (doc && doc.Sections) || [], out = [], i, j, k, m;
  for (i = 0; i < secs.length; i++) {
    var sec = secs[i], points = [];
    var gl = sec.EnemySpawnPointGroupList || [];
    for (j = 0; j < gl.length; j++) {
      var sp = gl[j].SpawnPoints || [];
      for (k = 0; k < sp.length; k++) {
        var p = sp[k], sd = p.SpawnData || {};
        points.push({
          dev: sd.SpawnTemplateId || null,
          cmds: p.CommandIdList || [],
          pos: p.Position || null,
          tile: [p.TileX, p.TileY],
          active: p.Active !== false,
        });
      }
    }
    // 合図 → その合図で湧く実体
    var byTag = {}, waits = {}, next = {};
    var evs = sec.Events || [];
    for (j = 0; j < evs.length; j++) {
      var tags = tagsOf(evs[j]), cmds = evs[j].Commands || [];
      var ids = [], wait = 0, starts = false;
      for (k = 0; k < cmds.length; k++) {
        var ct = typeOf(cmds[k]);
        if (ct.indexOf('SpawnEntity') >= 0 && cmds[k].CommandID) {
          ids.push(cmds[k].CommandID);
        } else if (ct.indexOf('WaitSeconds') >= 0) {
          wait += cmds[k].Seconds || cmds[k].Milliseconds || cmds[k].Value || 0;
        } else if (ct.indexOf('StartSection') >= 0) {
          starts = true;
        }
      }
      for (k = 0; k < tags.length; k++) {
        if (ids.length) {
          var devs = byTag[tags[k]] || (byTag[tags[k]] = []);
          for (m = 0; m < points.length; m++) {
            var pt = points[m], hit = false, q;
            for (q = 0; q < ids.length; q++) {
              if (pt.cmds.indexOf(ids[q]) >= 0) { hit = true; }
            }
            if (hit && pt.dev) { devs.push(pt); }
          }
        }
        // **節が進む合図と、その前の待ち。**フェーズ移行の 8 秒がこれ
        if (starts) {
          next[tags[k]] = 1;
          if (wait > 0) { waits[tags[k]] = Math.max(waits[tags[k]] || 0, wait); }
        }
      }
    }
    out.push({ i: i, points: points, byTag: byTag, waits: waits, next: next,
               obstacles: sec.Obstacles || [] });
  }
  return { sections: out, formations: (doc && doc.Formations) || [] };
}

/** その節で合図 `tag` を出したときに湧く湧き点。 */
export function spawnFor(plan, si, tag) {
  var s = plan && plan.sections[si];
  return (s && s.byTag[tag]) || [];
}

/** 味方の並びの原点（その節の `Formations`）。

    **同じ節に複数あるときは `Index` がいちばん大きいもの**（2026-09-07）。
    その節を進みきった場所で、`GroundCommandForceMoveToFormationBeacon` が
    味方を運ぶ先。ケセドの節 3 は `Index 0` が y 55.74（入口）・`Index 1` が y 125.0 で、
    ボスの湧き点は y 143。入口のままだと 87 も離れていて、どの射程にも入らない。
    節 0 にボスが居る面（ほかの 12 面）は `Index 0` しか無いので今までと同じ。 */
export function originOf(plan, si) {
  var f = (plan && plan.formations) || [], i, best = null;
  for (i = 0; i < f.length; i++) {
    if (f[i].SectionIndex === si && !f[i].IsEnemy) {
      if (!best || (f[i].Index || 0) > (best.Index || 0)) { best = f[i]; }
    }
  }
  if (best) { return best; }
  for (i = 0; i < f.length; i++) { if (!f[i].IsEnemy) { return f[i]; } }
  return null;
}

/** 味方 1 人ぶんの座標。`form` は `FormationLocationExcelTable` の 1 行
    （`SlotX` / `SlotZ` が 8 枠ぶん）。原点にその枠のずれを足す。 */
export function slotPos(origin, form, slot) {
  var ox = (origin && origin.Position && origin.Position.x) || 0;
  var oy = (origin && origin.Position && origin.Position.y) || 0;
  if (!form || !form.SlotX || slot >= form.SlotX.length) { return { x: ox, y: oy }; }
  return { x: ox + form.SlotX[slot], y: oy + (form.SlotZ[slot] || 0) };
}

/** 2 点の距離。**盤の単位はスキルの射程の 1/100**（2026-09-05 に確かめた）。 */
export function dist(a, b) {
  if (!a || !b) { return 0; }
  var dx = (a.x || 0) - (b.x || 0), dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

// ---- 当たる形の判定。**盤の単位は 1、スキルの射程は 1/100。**
//
// 形は `tree.js:shapeOf` が出す `{kind, r, deg, w, h, exr, off, angle, spawn, dir}`。
// `kind` は Circle / Fan / Obb / Donut / CircleAura / Beam の 6 つ。
// **範囲の中心は `spawn` で決まる** —— `Invoker` なら撃った子、
// `WorldPosition` なら盤の絶対座標（`SpawnWorldPosition`）、
// それ以外（`BattleEntity` / `InputBattleEntity` / `InputPosition`）は狙った先。

var U = 100;   // スキルの射程 → 盤の単位

function sub(a, b2) { return { x: (a.x || 0) - (b2.x || 0), y: (a.y || 0) - (b2.y || 0) }; }
function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }

/** 形の中に居る体だけ。**座標が無いものは全部通す**（盤が読めない面のため）。 */
export function inArea(area, caster, aim, list) {
  if (!area) { return list; }
  // **`WorldPosition` の範囲は盤の絶対座標に置く。**狙った先には付いてこない
  var wp = (String(area.spawn || '') === 'WorldPosition' && area.wp) ? area.wp : null;
  if (!wp && (!aim || !aim.pos || !caster || !caster.pos)) { return list; }
  var self = /Invoker/.test(String(area.spawn || ''));
  var c = wp || (self ? caster.pos : aim.pos);
  if (area.off) { c = { x: c.x + area.off.x, y: c.y + area.off.y }; }
  var fwd = { x: 0, y: 1 }, fl = 0;
  if (aim && aim.pos && caster && caster.pos) {
    fwd = sub(aim.pos, caster.pos);
    fl = len(fwd);
    if (fl > 0) { fwd = { x: fwd.x / fl, y: fwd.y / fl }; } else { fwd = { x: 0, y: 1 }; }
  }
  var out = [], i;
  for (i = 0; i < list.length; i++) {
    var v = list[i];
    if (!v.pos) { out.push(v); continue; }
    var d = sub(v.pos, c), dd = len(d);
    var br = (v.radius || 0) / U;          // **体の大きさぶんは当たり判定が広がる**
    var ok = false;
    if (area.kind === 'Circle' || area.kind === 'CircleAura') {
      ok = dd - br <= (area.r || 0) / U;
    } else if (area.kind === 'Donut') {
      ok = dd - br <= (area.r || 0) / U && dd + br >= (area.exr || 0) / U;
    } else if (area.kind === 'Fan') {
      if (dd - br <= (area.r || 0) / U) {
        var cs = dd > 0 ? (d.x * fwd.x + d.y * fwd.y) / dd : 1;
        var ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
        ok = ang <= (area.deg || 360) / 2;
      }
    } else if (area.kind === 'Obb' || area.kind === 'Beam') {
      // 撃つ子から狙う先へ伸びる帯。長さ `h`（無ければ狙う先まで）、幅 `w`
      var along = d.x * fwd.x + d.y * fwd.y;
      var side = Math.abs(-d.x * fwd.y + d.y * fwd.x);
      var hh = area.h != null ? (area.h / U) : fl;
      ok = along >= -br && along <= hh + br && side - br <= (area.w || 0) / (2 * U);
    } else {
      ok = true;
    }
    if (ok) { out.push(v); }
  }
  return out;
}

// ---- 遮蔽（`Sections[].Obstacles[]`）
//
// **「総力戦の盤には遮蔽が無い」は思い込みだった**（2026-09-07 に数えた）。
// 束 700 面のうち **185 面に 8,831 個**あって、ビナー街路 Torment の
// `201107_raid_binah_street_torment` は 節 0 に 12 個・節 1 に 5 個・節 3 に 5 個。
//
// 形は `Battle/obstacledata`（`common.obstacle`、433 個）。**盤の側は面ごとの
// 別名を使う**（`Common_CarWhite_Low_Binah`）ので、いちばん長い前置きで引く。
// 束で使われている 39 通りのうち **26 が丸ごと一致・13 が前置き一致・引けないもの 0**。
// 遮蔽率は `ObstacleStatExcelTable.BlockRate`（`NameHash` → `StringID`。
// 433 個のうち 427 個が繋がる）。車もバリケードも 3000（＝ 30%）。
//
// **座標の軸が湧き点と違う。**`Obstacles[].Position` / `Forward` は 3 次元で
// `y` が高さ、盤の平面は (x, z)。湧き点と `Formations` は 2 次元 `{x, y}` で、
// その `y` がこの `z` にあたる（ビナーの節 3 の陣形 z = -100.65 と
// 遮蔽 z = -102.85 が並ぶので確かめられる）。

/** その名前の形。**いちばん長い前置きで引く。** */
function shapeOf(common, name) {
  var lst = (common && common.obstacle) || [], best = null, i;
  for (i = 0; i < lst.length; i++) {
    var u = lst[i].UniqueName;
    if (u && name.indexOf(u) === 0 && (!best || u.length > best.UniqueName.length)) {
      best = lst[i];
    }
  }
  return best;
}

/** その節に置いてある遮蔽を、線を遮る箱の並びにする。 */
export function obstacleBoxes(plan, si, common) {
  var s = plan && plan.sections[si];
  if (!s || !(s.obstacles || []).length) { return []; }
  var stat = {}, sl = (common && common.obstacleStat) || [], i;
  for (i = 0; i < sl.length; i++) { stat[sl[i].StringID] = sl[i]; }
  var out = [];
  for (i = 0; i < s.obstacles.length; i++) {
    var o = s.obstacles[i];
    if (o.IsDummy) { continue; }
    var sh = shapeOf(common, String(o.UniqueName || ''));
    if (!sh) { continue; }
    var p = o.Position || {}, f = o.Forward || {};
    var fx = f.x || 0, fy = f.z != null ? f.z : (f.y || 0);
    var fl = Math.sqrt(fx * fx + fy * fy);
    if (fl > 0) { fx /= fl; fy /= fl; } else { fx = 0; fy = 1; }
    // 局所は（右, 前）。右は前の直交で `(fy, -fx)`
    var of = sh.Offset || { x: 0, y: 0 };
    var ox = of.x || 0, oy = of.y || 0;
    var cx = (p.x || 0) + ox * fy + oy * fx;
    var cy = (p.z != null ? p.z : (p.y || 0)) + ox * (-fx) + oy * fy;
    var sc = sh.Scale || { x: 1, y: 1 }, sz = sh.Size || { x: 0, y: 0 };
    var st = stat[sh.NameHash];
    out.push({
      c: { x: cx, y: cy }, f: { x: fx, y: fy },
      hw: Math.abs((sz.x || 0) * (sc.x == null ? 1 : sc.x)) / 2,
      hh: Math.abs((sz.y || 0) * (sc.y == null ? 1 : sc.y)) / 2,
      block: (st && st.BlockRate) || 0,
    });
  }
  return out;
}

/** 線分が箱を横切るか（局所に移してから 2 軸で挟む）。 */
function segBox(p0, p1, b2) {
  var rx = b2.f.y, ry = -b2.f.x;
  function loc(p) {
    var dx = p.x - b2.c.x, dy = p.y - b2.c.y;
    return { x: dx * rx + dy * ry, y: dx * b2.f.x + dy * b2.f.y };
  }
  var a = loc(p0), c2 = loc(p1);
  var ds = [c2.x - a.x, c2.y - a.y], ps = [a.x, a.y], hs = [b2.hw, b2.hh];
  var t0 = 0, t1 = 1, k;
  for (k = 0; k < 2; k++) {
    var dd = ds[k], pp = ps[k], h = hs[k];
    if (Math.abs(dd) < 1e-9) {
      if (pp < -h || pp > h) { return false; }
    } else {
      var ta = (-h - pp) / dd, tb = (h - pp) / dd, tt;
      if (ta > tb) { tt = ta; ta = tb; tb = tt; }
      if (ta > t0) { t0 = ta; }
      if (tb < t1) { t1 = tb; }
      if (t0 > t1) { return false; }
    }
  }
  return true;
}

/** `from` から `to` への線を遮っている箱のうち、いちばん高い `BlockRate`（1/10000）。
    遮っているものが無ければ 0。
    **狙われる側の体の大きさぶんは手前で切る。**`ObstacleFireLineCheckExcelTable` は
    `EmptyObstacleFireLineCheck` だけが真＝**線を遮るのは遮蔽だけで、体は遮らない。**
    体の大きいボスは中心が車の裏にあっても縁が出ているので、これで陰に入らない。 */
export function coverRate(from, to, boxes, radius) {
  if (!from || !to || !boxes || !boxes.length) { return 0; }
  var d = sub(to, from), dl = len(d);
  var cut = (radius || 0) / U;
  if (dl <= cut) { return 0; }
  var t1 = (dl - cut) / dl;
  var end = { x: from.x + d.x * t1, y: from.y + d.y * t1 };
  var best = 0, i;
  for (i = 0; i < boxes.length; i++) {
    if (boxes[i].block > best && segBox(from, end, boxes[i])) { best = boxes[i].block; }
  }
  return best;
}

/** 距離で並べ替える。`sel.sort` が `Distance` のときだけ。 */
export function sortByRule(caster, list, sel) {
  if (!sel || sel.sort !== 'Distance' || !caster || !caster.pos) { return list; }
  var arr = list.slice(), lo = sel.order !== 'Highest';
  arr.sort(function (a, b2) {
    if (!a.pos) { return 1; }
    if (!b2.pos) { return -1; }
    var da = len(sub(a.pos, caster.pos)) - (a.radius || 0) / U;
    var db = len(sub(b2.pos, caster.pos)) - (b2.radius || 0) / U;
    return lo ? da - db : db - da;
  });
  return arr;
}
