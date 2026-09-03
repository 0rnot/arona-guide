import { $ } from './util.js';
import { SLOTS, st } from './core.js';
import { naPool, poolHp, poolOf, poolOrder, subIxOfPool } from './pool.js';
import { awayAt, carryIn, ggSolve, partyCalc, trOf } from './carry.js';
import { clamp } from './stats.js';
import { naTimes } from './na.js';
import { usesSorted } from './buff.js';
import { PICKF, dmgOf, setPICKF } from './dmg.js';

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
    for (i = 0; i < us.length; i++) {
      var u = us[i], tr = trOf(r, u.tg), mc = u.mc || 1, pp = u.tg == null ? (naPool(r, u.t, deadAt) || r.cid) : poolOf(r, u.tg);
      if (pp !== pid && !(pid === r.cid && u.tg != null && tr)) { continue; }
      if (u.t > (r.dur || 240) + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
      // **よその池へ回った発は、その池の相手で引く**（2026-09-03。`dmgCurve0` と同じ）
      var d = dmgOf(u.i, r, u.t, u.k, u.pk,
                    u.tg == null && pp !== r.cid ? subIxOfPool(r, pp) : u.tg, u.gx);
      if (!d) { continue; }
      n++;
      if (u.tg != null && pp !== pid) {
        // **範囲攻撃は当たった数だけ別々に振られる。**平均は ×mc、分散も ×mc。
        // 転移率は定数なので分散は 2 乗で効く
        mu += d.avg * tr * mc;
        va += (d.va || 0) * tr * tr * mc;
      } else {
        mu += d.avg; va += d.va || 0;
      }
    }
    var dur = r.dur || 240, STEP = 5;
    for (i = 0; i < SLOTS; i++) {
      if (!st.party[i]) { continue; }
      var ts = naTimes(i, dur);
      if (!ts.length) { continue; }
      var bucket = {};
      for (q = 0; q < ts.length; q++) {
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
  var ex = zero(), ns = zero(), na = zero(), all = zero(), us = usesSorted(), i, k, q;
  // 池が 2 つ以上あるボスは、前の池が生きている間の通常攻撃はそちらへ向く
  var deadAt = {};
  if (poolOrder(r).length > 1) {
    var pk0 = partyCalc(st.pi).pools;
    for (i = 0; i < pk0.length; i++) { deadAt[pk0[i].pid] = pk0[i].kill; }
  }
  for (i = 0; i < us.length; i++) {
    var u = us[i];
    var tr2 = trOf(r, u.tg) * (u.mc || 1);
    if (u.tg != null && !tr2) { continue; }
    if (u.t > (r.dur || 240) + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
    var d = dmgOf(u.i, r, u.t, u.k, u.pk, u.tg, u.gx);
    if (!d) { continue; }
    if (tr2) {
      d = { min: d.min * tr2, avg0: d.avg0 * tr2, avg: d.avg * tr2,
            avgC: d.avgC * tr2, max: d.max * tr2 };
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
  }
  all.ex = ex; all.ns = ns; all.na = na;
  return all;
}
