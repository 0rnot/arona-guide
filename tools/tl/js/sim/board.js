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
//     .Obstacles[]                   遮蔽（総力戦の盤には無い。大決戦にはある）
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

/** 味方の並びの原点（その節の `Formations`）。 */
export function originOf(plan, si) {
  var f = (plan && plan.formations) || [], i;
  for (i = 0; i < f.length; i++) {
    if (f[i].SectionIndex === si && !f[i].IsEnemy) { return f[i]; }
  }
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
// それ以外（`BattleEntity` / `InputBattleEntity` / `InputPosition`）は狙った先。

var U = 100;   // スキルの射程 → 盤の単位

function sub(a, b2) { return { x: (a.x || 0) - (b2.x || 0), y: (a.y || 0) - (b2.y || 0) }; }
function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y); }

/** 形の中に居る体だけ。**座標が無いものは全部通す**（盤が読めない面のため）。 */
export function inArea(area, caster, aim, list) {
  if (!area || !aim || !aim.pos || !caster || !caster.pos) { return list; }
  var self = /Invoker/.test(String(area.spawn || ''));
  var c = self ? caster.pos : aim.pos;
  if (area.off) { c = { x: c.x + area.off.x, y: c.y + area.off.y }; }
  var fwd = sub(aim.pos, caster.pos);
  var fl = len(fwd);
  if (fl > 0) { fwd = { x: fwd.x / fl, y: fwd.y / fl }; } else { fwd = { x: 0, y: 1 }; }
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
