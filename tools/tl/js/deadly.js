import { memo, st } from './core.js';
import { usesSorted } from './buff.js';
import { PICKF, dmgOf, hitTimes, nbOf } from './dmg.js';
import { awayAt, trOf } from './carry.js';
import { bpAt, coverOfUse, dsOf, placedOf, sceneAt } from './view.js';
import { bodiesOf, coverOf, movedBodies, subIxOfCid } from './board.js';

/** **HP が半分を切ったミニオンが放つ固定ダメージ**（ペロロジラ。2026-09-05）。

    出どころは `sub[].dead`（`scripts/build-tool-data.py`）——
    `[1 回の量, しきい値（HP）, 半径（1/100 ワールド）, 最大 HP]`。
    Torment の大きなペロロミニオンは `GetHPRate() < 5000` で 1 度だけ
    `Attack_DeadlyAttack` 250,000 を半径 3.0 の `Ally_Except_Self` に入れる。
    本体は半径 7.0 でいつも円に掛かるので直に 250,000、隣のミニオンにも 250,000
    （そちらは転移で本体へ。隣も半分を切れば連鎖する）。
    先生の動画 GzfPSXaZKlU の 1 発目のマコト（水着）は、EX の 5.17M のほかに
    この連鎖が 3.75M（「250000」が 15 個）乗って、本体が 8.93M 減っていた。

    数え方:
      ・EX・NS の発ごとに、盤で当たった体（置いていなければ入力欄の「当たる数」
        だけ、いちばん多く巻き込める置き方の中心に近い体から）に、その体ぶんの
        ダメージを積む。範囲のぶんは 2 つ目以降の着弾に、1 体にしか当たらないぶん
        （`one`。マコトの 1 発目）は最初の着弾に、中心にいちばん近い体だけへ
      ・体ごとに積んで、しきい値を超えた瞬間に 1 度だけ放つ。円の中の本体には直に、
        円の中のミニオンには転移率ぶんを本体へ入れて、その体にも積む（連鎖）
      ・波（`sceneAt` の `w0`）が変われば積み直す。吸われた体は消える
    **通常攻撃がミニオンに入るぶんは数えていない**（誰がどの体を撃つかは
    データから決まらない。EX 1 発で 1 体に 0.8M 入るので、しきい値 270,500 には
    EX だけで届く）。`key` は振れ方（`min` / `avg` / `max`）——**振れ方で引き金が変わる。**
    返すのは本体に入る `[[時刻, 量], …]`。

    **同じ答えは描き直しの中で 1 回だけ計算する**（`memo`。`total0` は振れ方の鍵ごと、
    `dmgCurve0` は池ごとに呼ぶ）。鍵にはダメージが変わる入口（`PICKF`・会心率の
    差し替え・ボスの状態の窓）も入れる——`memo` は編成や置いた発が変わったときにしか
    捨てられないので */
export function deadlyPts(r, key) {
  var k = 'deadly|' + (r && r.cid) + '|' + key + '|' + PICKF + '|' +
          (st.crit == null ? '' : st.crit) + '|' + JSON.stringify(st.bst || []);
  return memo(k, function () { return deadlyPts0(r, key); });
}
function deadlyPts0(r, key) {
  var subs = (r && r.sub) || [], i, q, z, has = false;
  for (i = 0; i < subs.length; i++) { if (subs[i].dead) { has = true; break; } }
  if (!has || !r.board) { return []; }
  var us = usesSorted(), ev = [], out = [], dur = r.dur || 240, scenes = {};
  for (i = 0; i < us.length; i++) {
    var u = us[i];
    if (!st.party[u.i]) { continue; }
    if (u.t > dur + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
    var sc = sceneAt(r, u.t);
    if (!sc.wave || sc.w0 == null) { continue; }
    var wk = sc.w0 + '|' + sc.wave;
    var bp = bpAt(r, u.t, sc);
    var cv = coverOfUse(r, u, sc, bp);
    var bs = cv ? cv.bs
           : movedBodies(bodiesOf(r, sc.sec, sc.wave, sc.gg ? ['st:Groggy'] : null), bp);
    if (!bs || !bs.length) { continue; }
    scenes[wk] = bs;
    var hit = hitBodies(r, u, cv, bs, subs);
    if (!hit.length) { continue; }
    var ht = hitTimes(st.party[u.i].id, u.k, dsOf(r, u)) || [0];
    var tA = ht.length > 1 ? ht.slice(1) : ht;
    var sel = cv && cv.c ? nearest(hit, cv.c) : hit[0];
    for (z = 0; z < hit.length; z++) {
      var b = hit[z], ix = subIxOfCid(r, b.cid);
      if (ix == null || !subs[ix].dead) { continue; }
      var d = dmgOf(u.i, r, u.t, u.k, u.pk, ix, u.gx, u.no, null, nbOf(u), 0, dsOf(r, u));
      if (!d) { continue; }
      var one = d.one ? d.one[key] : 0, area = d[key] - one;
      for (q = 0; q < tA.length; q++) { ev.push([u.t + tA[q], wk, b.key, area / tA.length]); }
      if (one > 0 && b === sel) { ev.push([u.t + ht[0], wk, b.key, one]); }
    }
  }
  if (!ev.length) { return out; }
  ev.sort(function (a, b) { return a[0] - b[0]; });
  var acc = {}, fired = {};
  function bodyOf(wk2, bk) {
    var l = scenes[wk2] || [], j;
    for (j = 0; j < l.length; j++) { if (l[j].key === bk) { return l[j]; } }
    return null;
  }
  function add(t, wk2, bk, v) {
    var k = wk2 + '|' + bk;
    acc[k] = (acc[k] || 0) + v;
    if (fired[k]) { return; }
    var b = bodyOf(wk2, bk), ix = b ? subIxOfCid(r, b.cid) : null;
    var dd = ix != null ? subs[ix].dead : null;
    if (!dd || acc[k] < dd[1]) { return; }
    fired[k] = 1;
    // 放つ。円の中の本体には直に、ミニオンには転移率ぶんを本体へ。**自分は入らない**
    var nb = coverOf(['Circle', dd[2]], { x: b.x, y: b.y }, { x: 0, y: 1 }, scenes[wk2], null) || [];
    for (var j = 0; j < nb.length; j++) {
      var n = nb[j];
      if (n.key === b.key) { continue; }
      if (n.cid === r.cid) { out.push([Math.min(t, dur), dd[0]]); continue; }
      var ix2 = subIxOfCid(r, n.cid);
      if (ix2 == null) { continue; }
      var tr = trOf(r, ix2);
      if (tr) { out.push([Math.min(t, dur), dd[0] * tr]); }
      if (subs[ix2].dead) { add(t, wk2, n.key, dd[0]); }
    }
  }
  for (i = 0; i < ev.length; i++) {
    if (ev[i][0] > dur + 1e-9) { continue; }
    add(ev[i][0], ev[i][1], ev[i][2], ev[i][3]);
  }
  out.sort(function (a, b) { return a[0] - b[0]; });
  return out;
}

/** その 1 発が積む先の体。**本体を狙った発（`tg` なし）は数えない**——与ダメージの
    ほうもミニオンぶんを数えていないので、同じ扱いにする。 */
function hitBodies(r, u, cv, bs, subs) {
  var pd = placedOf(u), out = [], cand = [], i;
  if (u.tg == null || !subs[u.tg] || !subs[u.tg].dead) { return out; }
  if (pd.ax != null && pd.ay != null && cv && cv.hit) {
    for (i = 0; i < cv.hit.length; i++) { if (cv.hit[i].cid !== r.cid) { out.push(cv.hit[i]); } }
    return out;
  }
  for (i = 0; i < bs.length; i++) {
    var ix = bs[i].sum ? subIxOfCid(r, bs[i].cid) : null;
    if (ix != null && subs[ix].dead) { cand.push(bs[i]); }
  }
  var n = Math.max(1, u.mc || 1);
  if (cv && cv.c && cand.length > n) {
    cand.sort(function (a, b) { return dd2(a, cv.c) - dd2(b, cv.c); });
  }
  return cand.slice(0, n);
}
function dd2(a, c) { return (a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y); }
function nearest(list, c) {
  var best = null, bd = 0, i;
  for (i = 0; i < list.length; i++) {
    var d = dd2(list[i], c);
    if (best == null || d < bd) { best = list[i]; bd = d; }
  }
  return best;
}
