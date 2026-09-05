import { $ } from './util.js';
import { SLOTS, st } from './core.js';
import { naPool, poolBodies, poolHp, poolOf, poolOrder, subIxOfPool } from './pool.js';
import { awayAt, carryIn, ggSolve, partyCalc, trOf } from './carry.js';
import { clamp } from './stats.js';
import { naTimes } from './na.js';
import { usesSorted } from './buff.js';
import { PICKF, dmgOf, hitTimes, nbOf, setPICKF } from './dmg.js';
import { deadlyPts } from './deadly.js';
import { epEvery, epOkAt, epOn, epTierPick } from './ep.js';
import { dsOf } from './view.js';

/** **突破率。**置いた TL で、ボスの HP を削り切れる確率。
    1 発ごとの平均と分散（`dmgAt` の `va`）を足し合わせて、
    **合計ダメージを正規分布とみなして** `P(合計 ≥ HP)` を返す。
    発数が数十〜数百あるので中心極限定理が効く（ビナーの TL で EX 21 発＋
    通常攻撃 401 発）。**独立と見なしているので、同じバフの乗り外れで
    まとめて動くぶんは入っていない。**
    戦闘時間内に TL が成立するかどうかは別の話で、ここには入れていない。 */
export function erf(x) {
  // Abramowitz & Stegun 7.1.26（絶対誤差 1.5e-7）
  var s = x < 0 ? -1 : 1, a = Math.abs(x);
  var t = 1 / (1 + 0.3275911 * a);
  var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
/** **置いた最後の発の時刻。**置いた発が 1 つも無ければ `null`。

    突破率は「**入れたスキルの最後で倒し切れる確率**」（2026-09-04 の先生の定義）なので、
    ここより後ろの通常攻撃・サブスキルは数えない。**置いた発そのものは全部数える**
    （最後の 1 発の着弾も含めて「その発で倒し切れたか」を見るため）。
    置いた発が無いときは TL が無いということなので、今までどおり戦闘時間の終わりまで数える。 */
export function lastUseAt(r) {
  var us = usesSorted(), dur = (r && r.dur) || 240, i, t = null;
  for (i = 0; i < us.length; i++) {
    // **`no` が付いているのは自動で出るノーマルスキル**（`usesSorted0` が
    // `nsTimes` から足している行）。人が置いた発ではないので数えない
    if (us[i].no != null) { continue; }
    if (us[i].t > dur + 1e-9) { continue; }
    // **最後の着弾まで。**「入れたスキルの最後で倒し切れる確率」（先生の定義）の
    // 「最後」は撃った瞬間ではなく、その発のダメージが入り終わる時刻
    var ht = hitTimes((st.party[us[i].i] || {}).id, us[i].k, dsOf(r, us[i])) || [0];
    var e = Math.min(us[i].t + ht[ht.length - 1], dur);
    if (t == null || e > t) { t = e; }
  }
  return t;
}
export function clearStat(r, pf) {
  // **池ごとに出して掛け合わせる。**mu/sd/n は本体の池の値（表示用）
  var pk = partyCalc(st.pi).pools, deadAt = {}, carry = carryIn(st.pi), i, out = null, p = 1;
  for (i = 0; i < pk.length; i++) { deadAt[pk[i].pid] = pk[i].kill; }
  var o = poolOrder(r);
  for (i = 0; i < o.length; i++) {
    var c1 = clearStat1(r, pf, o[i], deadAt, (poolHp(r, o[i]) - (carry[o[i]] || 0)));
    p *= c1.p;
    if (o[i] === r.cid) { out = c1; }
  }
  if (!out) { return { mu: 0, sd: 0, n: 0, hp: 0, p: 0 }; }
  out.p = clamp(p, 0, 1);
  return out;
}
export function clearStat1(r, pf, pid, deadAt, hpNeed) {
  var sv = PICKF;
  ggSolve(r);
  setPICKF(pf || 0);
  try {
    var mu = 0, va = 0, n = 0, us = usesSorted(), i, q;
    // **「置いた最後の発」で切る**（2026-09-04、第 0 段）。先生の定義
    // 「突破率は入れたスキルの最後で倒し切れる確率」。ここより後ろの
    // 自動のノーマルスキル・通常攻撃・サブスキルは数えない。
    // 置いた発が 1 つも無ければ TL が無いということなので、戦闘時間の終わりまで
    var cut = lastUseAt(r);
    if (cut == null) { cut = r.dur || 240; }
    for (i = 0; i < us.length; i++) {
      var u = us[i], tr = trOf(r, u.tg), mc = u.mc || 1, pp = u.tg == null ? (naPool(r, u.t, deadAt) || r.cid) : poolOf(r, u.tg);
      if (pp !== pid && !(pid === r.cid && u.tg != null && tr)) { continue; }
      if (u.t > cut + 1e-9) { continue; }
      if (u.t > (r.dur || 240) + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
      // **よその池へ回った発は、その池の相手で引く**（2026-09-03。`dmgCurve0` と同じ）
      var d = dmgOf(u.i, r, u.t, u.k, u.pk,
                    u.tg == null && pp !== r.cid ? subIxOfPool(r, pp) : u.tg, u.gx, u.no,
                    null, nbOf(u), 0, dsOf(r, u));
      if (!d) { continue; }
      n++;
      if (u.tg != null && pp !== pid) {
        // **範囲攻撃は当たった数だけ別々に振られる。**平均は ×mc、分散も ×mc。
        // 転移率は定数なので分散は 2 乗で効く。
        // **1 体にしか当たらないぶん（`one`）は ×mc しない**（2026-09-05。分散はそのまま）
        var o1 = d.one ? d.one.avg : 0;
        mu += (d.avg - o1) * tr * mc + o1 * tr;
        va += (d.va || 0) * tr * tr * mc;
        // **直線に伸びる攻撃は部位を貫いて本体にも当たる**（帯の「ボス本体にも」）。
        // `dmgCurve0` は数えていたのに、突破率と与ダメージが数えていなかった
        // （2026-09-03。画面で選んでも上の数字が動かない）
        if (u.hb) {
          var dbb = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, null, nbOf(u), 1, dsOf(r, u));
          if (dbb) { mu += dbb.avg - (dbb.one ? dbb.one.avg : 0); va += dbb.va || 0; }
        }
      } else {
        // **同じ池を分け合う体に当てた発は、当たった数だけ池へ入る**（2026-09-03）
        var mcp1 = (u.tg != null && (u.mc || 1) > 1)
          ? Math.min(u.mc, poolBodies(r, pid)) : 1;
        var o3 = d.one ? d.one.avg : 0;
        mu += (d.avg - o3) * mcp1 + o3; va += (d.va || 0) * mcp1;
      }
    }
    // **ミニオンの固定ダメージ**（`deadly.js`。2026-09-05）。振れは無いので平均にだけ足す
    if (pid === r.cid) {
      var dlp = deadlyPts(r, 'avg');
      for (q = 0; q < dlp.length; q++) { if (dlp[q][0] <= cut + 1e-9) { mu += dlp[q][1]; n++; } }
    }
    var dur = r.dur || 240, STEP = 5;
    for (i = 0; i < SLOTS; i++) {
      if (!st.party[i]) { continue; }
      var ts = naTimes(i, dur);
      if (!ts.length) { continue; }
      var bucket = {};
      for (q = 0; q < ts.length; q++) {
        if (ts[q] > cut + 1e-9) { continue; }
        if (awayAt(ts[q], true) || naPool(r, ts[q], deadAt) !== pid) { continue; }
        var b = Math.floor(ts[q] / STEP);
        bucket[b] = (bucket[b] || 0) + 1;
      }
      for (var bk in bucket) {
        var dn = dmgOf(i, r, Math.min((+bk + 0.5) * STEP, dur), 'Normal', null,
                       subIxOfPool(r, pid));
        if (!dn) { break; }
        // 通常攻撃は 1 発ずつ別々に振られるので、分散も発数ぶん足す
        mu += dn.avg * bucket[bk];
        va += (dn.va || 0) * bucket[bk];
        n += bucket[bk];
      }
      // **サブスキル（SS）は通常攻撃に相乗りする**（2026-09-03）。同じ束で数える
      if (epOn(st.party[i].id)) {
        var ev1 = epEvery(st.party[i].id), bs1;
        for (bs1 in bucket) {
          var at1 = Math.min((+bs1 + 0.5) * STEP, dur);
          var cn1 = Math.floor(bucket[bs1] / ev1);
          if (!cn1 || !epOkAt(st.party[i].id, r, at1, subIxOfPool(r, pid))) { continue; }
          // **段で分かれる子は、その時刻の段で候補を決める**（2026-09-04。ミサキ）。
          // 対応が取れない子は `null` が返るので、今までどおり枠の既定を使う
          var ds1 = dmgOf(i, r, at1, 'ExtraPassive',
                          epTierPick(st.party[i].id, r, at1, subIxOfPool(r, pid)),
                          subIxOfPool(r, pid));
          if (!ds1) { break; }
          mu += ds1.avg * cn1;
          va += (ds1.va || 0) * cn1;
          n += cn1;
        }
      }
    }
    var hp = hpNeed == null ? ((r.bs && r.bs.hp) || 0) : hpNeed, sd = Math.sqrt(Math.max(0, va));
    var p = (hp <= 0) ? 1 : ((sd <= 0) ? (mu >= hp ? 1 : 0) : 1 - normCdf((hp - mu) / sd));
    return { mu: mu, sd: sd, n: n, hp: hp, p: clamp(p, 0, 1) };
  } finally { setPICKF(sv); }
}
// 置いた EX を全部足す
export var KS = ['min', 'avg0', 'avg', 'avgC', 'max'];
export function zero() { return { min: 0, avg0: 0, avg: 0, avgC: 0, max: 0, n: 0 }; }
// `pf` は倍率の幅の振り方（`PICKF`）。表の行ごとに差し替える
export function total(r, pf) {
  var sv = PICKF;
  ggSolve(r);
  setPICKF(pf || 0);
  try { return total0(r); } finally { setPICKF(sv); }
}
export function total0(r) {
  var ex = zero(), ns = zero(), na = zero(), ss = zero(), all = zero(), us = usesSorted(), i, k, q;
  // 池が 2 つ以上あるボスは、前の池が生きている間の通常攻撃はそちらへ向く
  var deadAt = {};
  if (poolOrder(r).length > 1) {
    var pk0 = partyCalc(st.pi).pools;
    for (i = 0; i < pk0.length; i++) { deadAt[pk0[i].pid] = pk0[i].kill; }
  }
  for (i = 0; i < us.length; i++) {
    var u = us[i];
    var tr2 = trOf(r, u.tg) * (u.mc || 1);
    // **転移しない部位でも、池を分け合っているなら当たった数だけ入る**（2026-09-03）
    var pp2 = u.tg == null ? null : poolOf(r, u.tg);
    var mcp2 = (u.tg != null && !tr2 && (u.mc || 1) > 1)
      ? Math.min(u.mc, poolBodies(r, pp2)) : 1;
    if (u.tg != null && !tr2 && mcp2 <= 1) { continue; }
    if (u.t > (r.dur || 240) + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
    var d = dmgOf(u.i, r, u.t, u.k, u.pk, u.tg, u.gx, u.no, null, nbOf(u), 0, dsOf(r, u));
    if (!d) { continue; }
    if (tr2 || mcp2 > 1) {
      // **1 体にしか当たらないぶん（`one`）には体の数を掛けない**（2026-09-05。
      // マコト（水着）の 1 発目 275.51%）。転移なら転移率だけ掛ける
      var f2 = tr2 || mcp2, f1 = tr2 ? trOf(r, u.tg) : 1, o1 = d.one || zero();
      d = { min: (d.min - o1.min) * f2 + o1.min * f1,
            avg0: (d.avg0 - o1.avg0) * f2 + o1.avg0 * f1,
            avg: (d.avg - o1.avg) * f2 + o1.avg * f1,
            avgC: (d.avgC - o1.avgC) * f2 + o1.avgC * f1,
            max: (d.max - o1.max) * f2 + o1.max * f1 };
    }
    // **「ボス本体にも当たる」を与ダメージにも数える**（2026-09-03。
    // `dmgCurve0` だけが数えていて、上の「与ダメージ」は素通りしていた）
    if (u.tg != null && u.hb) {
      var dbh = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, null, nbOf(u), 1, dsOf(r, u));
      if (dbh) {
        // 1 体にしか当たらないぶんは選んだ体に入っていて、本体には入らない
        var o2 = dbh.one || zero();
        d = { min: d.min + dbh.min - o2.min, avg0: d.avg0 + dbh.avg0 - o2.avg0,
              avg: d.avg + dbh.avg - o2.avg, avgC: d.avgC + dbh.avgC - o2.avgC,
              max: d.max + dbh.max - o2.max };
      }
    }
    // **形態違いは `Ex1` / `Ex2`。**`=== 'Ex'` で比べると NS 側に入っていた
    var box = /^Ex\d*$/.test(u.k) ? ex : ns;
    box.n++; all.n++;
    for (k = 0; k < KS.length; k++) { box[KS[k]] += d[KS[k]]; all[KS[k]] += d[KS[k]]; }
  }
  // **通常攻撃（オートアタック）。**発ごとにステータスを引き直すと重いので、
  // 5 秒ごとに 1 回だけ計算して、その間の発数を掛ける（バフの出入りは追える）
  var dur = r.dur || 240, STEP = 5;
  for (i = 0; i < SLOTS; i++) {
    if (!st.party[i]) { continue; }
    var ts = naTimes(i, dur);
    if (!ts.length) { continue; }
    var bucket = {};
    for (q = 0; q < ts.length; q++) {
      if (awayAt(ts[q], true) || naPool(r, ts[q], deadAt) !== r.cid) { continue; }
      var b = Math.floor(ts[q] / STEP);
      bucket[b] = (bucket[b] || 0) + 1;
    }
    for (var bk in bucket) {
      var at = (+bk + 0.5) * STEP;
      var dn = dmgOf(i, r, Math.min(at, dur), 'Normal');
      if (!dn) { break; }
      na.n += bucket[bk]; all.n += bucket[bk];
      for (k = 0; k < KS.length; k++) {
        na[KS[k]] += dn[KS[k]] * bucket[bk];
        all[KS[k]] += dn[KS[k]] * bucket[bk];
      }
    }
    // **サブスキル（SS）。**箱は別にする（画面の「EX ・NS ・通常 」に混ぜない）
    if (epOn(st.party[i].id)) {
      var ev2 = epEvery(st.party[i].id), bs2;
      for (bs2 in bucket) {
        var at2 = Math.min((+bs2 + 0.5) * STEP, dur);
        var cn2 = Math.floor(bucket[bs2] / ev2);
        if (!cn2 || !epOkAt(st.party[i].id, r, at2, null)) { continue; }
        var ds2 = dmgOf(i, r, at2, 'ExtraPassive',
                        epTierPick(st.party[i].id, r, at2, null));
        if (!ds2) { break; }
        ss.n += cn2; all.n += cn2;
        for (k = 0; k < KS.length; k++) {
          ss[KS[k]] += ds2[KS[k]] * cn2;
          all[KS[k]] += ds2[KS[k]] * cn2;
        }
      }
    }
  }
  // **HP が半分を切ったミニオンの固定ダメージ**（`deadly.js`。2026-09-05）。
  // 振れ方ごとに引き金が変わるので、鍵ごとに数え直す
  var dl = zero(), dp;
  for (k = 0; k < KS.length; k++) {
    dp = deadlyPts(r, KS[k]);
    for (q = 0; q < dp.length; q++) { dl[KS[k]] += dp[q][1]; all[KS[k]] += dp[q][1]; }
    if (KS[k] === 'avg') { dl.n = dp.length; all.n += dp.length; }
  }
  all.ex = ex; all.ns = ns; all.na = na; all.ss = ss; all.dl = dl;
  return all;
}
