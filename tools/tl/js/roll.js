import { SLOTS, st } from './core.js';
import { naPool, poolBodies, poolHp, poolOf, poolOrder, subIxOfPool } from './pool.js';
import { awayAt, carryIn, partyCalc, trOf } from './carry.js';
import { naTimes } from './na.js';
import { usesSorted } from './buff.js';
import { WANTU, dmgCap, dmgOf, nbOf, repUnits, setWANTU } from './dmg.js';
import { deadlyPts } from './deadly.js';
import { epEvery, epOkAt, epOn, epTierPick } from './ep.js';
import { lastUseAt } from './clear.js';

/** **第 3 段 —— 生徒を 1 発ずつ回す**（2026-09-04）。

    ここまでの突破率は「1 発ごとの平均と分散を足して、合計を正規分布とみなす」
    近似だった（`clear.js` の注記）。**同じバフの乗り外れでまとめて動くぶんが
    入らない**のと、**討伐の時刻が出せない**のが限界。

    この段でやるのは 2 つ。

      1. 置いた発・通常攻撃・サブスキルを**時刻順の 1 本の列**にする（`shotsOf`）
      2. その列を頭から回して、**1 単位ごとに乱数を 2 つ引く**（`rollRun`）——
         倍率の幅（`sN`〜1 の一様）と会心（確率 `cr`）。命中が 1 未満のときだけ
         3 つ目を引く

    **確かめ方**は `rollCheck`。乱数を固定すると、今の道具の数字と一致する。

      ・全部 `u = 1`・会心あり・命中 → `total0(r).max`
      ・全部 `u = sN`・会心なし・命中 → `total0(r).min`

    **`avg` とは一致しない。**今の平均は `dmgCap((上限を通す前の平均))` で、
    こちらは `平均(dmgCap(1 発ごと))` だから——**上限に当たっている発があると
    シミュレータのほうが小さく出る**。上限に当たっていなければ一致する。 */

/** 種を渡せる乱数（xorshift32）。同じ種なら同じ結果になる */
export function rngOf(seed) {
  var x = (seed | 0) || 0x9e3779b9;
  return function () {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    return ((x >>> 0) + 1) / 4294967297;
  };
}

/** **時刻順の 1 本の列にする。**返すのは `[{t, i, k, nm, u:[単位]}, …]`。

    並べ方は `clear.js` の `total0` / `clearStat1` と同じ絞り込み。`opt` で切り替える。

      `pid`    … その池だけ数える（省くと本体の池＝`total0` と同じ）
      `deadAt` … 池ごとの討伐時刻（通常攻撃の向き先を決める）
      `cut`    … ここより後ろを数えない（省くと戦闘時間の終わりまで）

    **通常攻撃は 5 秒ごとに 1 回だけ計算して、その束の中の発を実時刻に置く。**
    ダメージの引き直しは今までどおり 5 秒刻み（`na.js` の実測が 401 発あるので、
    1 発ずつ引き直すと重い）。置く時刻だけ実際の発の時刻を使う。 */
export function shotsOf(r, opt) {
  var o = opt || {}, dur = (r && r.dur) || 240, ev = [], i, q;
  var pid = o.pid == null ? r.cid : o.pid;
  var one = o.pid == null;
  var cut = o.cut == null ? dur : o.cut;
  var deadAt = o.deadAt;
  if (!deadAt) {
    deadAt = {};
    if (poolOrder(r).length > 1) {
      var pk0 = partyCalc(st.pi).pools;
      for (i = 0; i < pk0.length; i++) { deadAt[pk0[i].pid] = pk0[i].kill; }
    }
  }
  var sv = WANTU;
  setWANTU(1);
  try {
    var us = usesSorted();
    for (i = 0; i < us.length; i++) {
      var u = us[i], tr2 = trOf(r, u.tg) * (u.mc || 1);
      var pp2 = u.tg == null ? null : poolOf(r, u.tg);
      var mcp2 = (u.tg != null && !tr2 && (u.mc || 1) > 1)
        ? Math.min(u.mc, poolBodies(r, pp2)) : 1;
      if (u.t > dur + 1e-9 || u.t > cut + 1e-9) { continue; }
      if (awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
      if (one) {
        // `total0` と同じ形——本体の池にまとめて足す
        if (u.tg != null && !tr2 && mcp2 <= 1) { continue; }
        var d = dmgOf(u.i, r, u.t, u.k, u.pk, u.tg, u.gx, u.no, null, nbOf(u));
        if (!d || !d.u) { continue; }
        // **1 体にしか当たらない単位は体の数では増えない**（2026-09-05。`repUnits` の `m1`）。
        // 転移なら転移率だけ。本体だけのぶん（`hb`）にはその単位は入らない
        push(u, d, (tr2 || mcp2 > 1) ? (tr2 || mcp2) : 1, tr2 ? trOf(r, u.tg) : 1);
        if (u.tg != null && u.hb) {
          var dbh = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, null, nbOf(u), 1);
          if (dbh && dbh.u) { push(u, dbh, 1, 0); }
        }
      } else {
        // `clearStat1` と同じ形——池ごとに分ける
        var trp = trOf(r, u.tg), mc = u.mc || 1;
        var pp = u.tg == null ? (naPool(r, u.t, deadAt) || r.cid) : poolOf(r, u.tg);
        if (pp !== pid && !(pid === r.cid && u.tg != null && trp)) { continue; }
        var d2 = dmgOf(u.i, r, u.t, u.k, u.pk,
                       u.tg == null && pp !== r.cid ? subIxOfPool(r, pp) : u.tg,
                       u.gx, u.no, null, nbOf(u));
        if (!d2 || !d2.u) { continue; }
        if (u.tg != null && pp !== pid) {
          push(u, d2, trp * mc, trp);
          if (u.hb) {
            var dbb = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, null, nbOf(u), 1);
            if (dbb && dbb.u) { push(u, dbb, 1, 0); }
          }
        } else {
          push(u, d2, (u.tg != null && mc > 1) ? Math.min(mc, poolBodies(r, pid)) : 1);
        }
      }
    }
    // **ミニオンの固定ダメージ**（`deadly.js`。2026-09-05）。振れは無い
    // （`sN 1`・会心なし・必中）。引き金は平均の振れ方で決める——`rollCheck` の
    // 「全部 1 で `total0(r).max`」は、ペロロジラではこのぶんだけ揃わない
    if (pid === r.cid) {
      var dlp = deadlyPts(r, 'avg');
      for (q = 0; q < dlp.length; q++) {
        if (dlp[q][0] > cut + 1e-9) { continue; }
        ev.push({ t: dlp[q][0], i: -1, k: 'Deadly', nm: '自傷',
                  u: [{ b: dlp[q][1], sN: 1, cr: 0, cm: 1, hit: 1 }] });
      }
    }
    // **通常攻撃とサブスキル。**5 秒ごとに引き直して、束の中の発は実時刻に置く
    var STEP = 5;
    for (i = 0; i < SLOTS; i++) {
      if (!st.party[i]) { continue; }
      var ts = naTimes(i, dur);
      if (!ts.length) { continue; }
      var bucket = {};
      for (q = 0; q < ts.length; q++) {
        if (ts[q] > cut + 1e-9) { continue; }
        if (awayAt(ts[q], true) || naPool(r, ts[q], deadAt) !== pid) { continue; }
        var b = Math.floor(ts[q] / STEP);
        (bucket[b] = bucket[b] || []).push(ts[q]);
      }
      var sub = one ? null : subIxOfPool(r, pid), bk;
      for (bk in bucket) {
        var at = Math.min((+bk + 0.5) * STEP, dur);
        var dn = dmgOf(i, r, at, 'Normal', null, sub);
        if (!dn || !dn.u) { break; }
        for (q = 0; q < bucket[bk].length; q++) {
          ev.push({ t: bucket[bk][q], i: i, k: 'Normal', nm: dn.name, u: dn.u });
        }
      }
      if (epOn(st.party[i].id)) {
        var ev1 = epEvery(st.party[i].id), bs1;
        for (bs1 in bucket) {
          var at1 = Math.min((+bs1 + 0.5) * STEP, dur);
          var cn1 = Math.floor(bucket[bs1].length / ev1);
          if (!cn1 || !epOkAt(st.party[i].id, r, at1, sub)) { continue; }
          var ds1 = dmgOf(i, r, at1, 'ExtraPassive',
                          epTierPick(st.party[i].id, r, at1, sub), sub);
          if (!ds1 || !ds1.u) { break; }
          for (q = 0; q < cn1; q++) {
            ev.push({ t: bucket[bs1][q * ev1 + ev1 - 1] || at1, i: i,
                      k: 'ExtraPassive', nm: ds1.name, u: ds1.u });
          }
        }
      }
    }
  } finally { setWANTU(sv); }
  ev.sort(function (a, b) { return a.t - b.t; });
  return ev;

  function push(u, d, m, m1) {
    ev.push({ t: u.t, i: u.i, k: u.k, nm: d.name, u: repUnits(d.u, m, m1) });
  }
}

/** **1 発ぶんの単位を、回しやすい形に潰す**（2026-09-04）。
    切り分けを束ねた `{w, sl}` は入れ子なので、**そのまま何百周も回すと重い**
    （ペロロジラの TL 1 本で 4,325 単位 × 1,000 周）。葉を 1 本の並びにして、
    `ui` に「どの単位の葉か」を持たせる。**乱数は単位に 1 組**なので、
    同じ `ui` の葉は同じ組を見る。 */
function flatten(us) {
  var n = 0, i, z;
  for (i = 0; i < us.length; i++) { n += us[i].sl ? us[i].sl.length : 1; }
  var f = { b: new Float64Array(n), sN: new Float64Array(n), cr: new Float64Array(n),
            cm: new Float64Array(n), hit: new Float64Array(n), w: new Float64Array(n),
            ui: new Int32Array(n), nu: us.length, n: n }, k = 0;
  for (i = 0; i < us.length; i++) {
    var u = us[i], sl = u.sl || [u], ww = u.sl ? u.w : 1;
    for (z = 0; z < sl.length; z++) {
      f.b[k] = sl[z].b; f.sN[k] = sl[z].sN; f.cr[k] = sl[z].cr;
      f.cm[k] = sl[z].cm; f.hit[k] = sl[z].hit; f.w[k] = ww; f.ui[k] = i; k++;
    }
  }
  return f;
}
function flatOf(e) { return e.f || (e.f = flatten(e.u)); }

/** **列を頭から回す。**`rnd` は 0〜1 を返す関数（省くと `Math.random`）。
    `hp` を渡すと、越えた時刻を `killAt` に入れる。返すのは
    `{tot, killAt, curve}`——`curve` は `[時刻, その時点の累計]`。 */
var _R0 = null, _RC = null, _RH = null;
export function rollRun(ev, hp, rnd, out) {
  var g = rnd || Math.random, tot = 0, killAt = null, cv = out ? [] : null, i, j, k, mx = 0;
  for (i = 0; i < ev.length; i++) { if (flatOf(ev[i]).nu > mx) { mx = ev[i].f.nu; } }
  if (!_R0 || _R0.length < mx) {
    _R0 = new Float64Array(mx); _RC = new Float64Array(mx); _RH = new Float64Array(mx);
  }
  for (i = 0; i < ev.length; i++) {
    var f = ev[i].f, add = 0;
    // **乱数は単位に 1 組**（倍率の幅・会心・命中）。切り分けは同じ 1 発を
    // バフ違いで見ているだけなので、同じ組で引いて重みで足す
    for (j = 0; j < f.nu; j++) { _R0[j] = g(); _RC[j] = g(); _RH[j] = g(); }
    for (k = 0; k < f.n; k++) {
      j = f.ui[k];
      if (f.hit[k] < 1 && _RH[j] >= f.hit[k]) { continue; }
      var cm = (f.cr[k] > 0 && (f.cr[k] >= 1 || _RC[j] < f.cr[k])) ? f.cm[k] : 1;
      add += f.w[k] * dmgCap(f.b[k] * (f.sN[k] + (1 - f.sN[k]) * _R0[j]) * cm);
    }
    tot += add;
    if (cv) { cv.push([ev[i].t, tot]); }
    if (killAt == null && hp > 0 && tot >= hp) { killAt = ev[i].t; }
  }
  return { tot: tot, killAt: killAt, curve: cv };
}

/** **乱数を固定して回す。**`mode` は `'max'`（幅は 1・会心あり・命中）か
    `'min'`（幅は安定値・**会心なし**・命中）。第 3 段の確かめ方に使う。

    `min` で確定会心（`cr = 1`）まで無視するのは、今の道具の `min` が
    `capS(sN)` で会心を一切見ていないのに合わせるため。ふだんの振り
    （`rollRun`）ではグロッキー中の確定会心はそのまま効く。 */
export function rollFixed(ev, mode) {
  var hi = mode !== 'min', tot = 0, i, k;
  for (i = 0; i < ev.length; i++) {
    var f = flatOf(ev[i]);
    for (k = 0; k < f.n; k++) {
      tot += f.w[k] * dmgCap(f.b[k] * (hi ? 1 : f.sN[k]) * (hi ? f.cm[k] : 1));
    }
  }
  return tot;
}

/** **第 4 段 —— 突破率をモンテカルロで出す**（2026-09-04）。

    `clear.js` の `clearStat` と**同じ絞り込み・同じ池の分け方**で、
    正規分布の近似の代わりに `n` 回まわして数える。**1 周ごとに全部の池を
    同じ周で解いて、全部の池を削り切れた周だけを数える**（近似のほうは
    池ごとの確率を掛けていた）。

    返すのは本体の池の `{p, mu, sd, n, hp, kill, killP, lo, hi}`。
    `kill` は削り切れた周の**討伐時刻の中央値**、`lo` / `hi` は残ダメージの
    5% / 95% 点。**「入れたスキルの最後で倒し切れる確率」**という定義は
    そのまま（`cut` は `lastUseAt`）。 */
export function rollStat(r, n, seed) {
  var N = n || 400, i, q;
  var pk = partyCalc(st.pi).pools, deadAt = {}, carry = carryIn(st.pi);
  for (i = 0; i < pk.length; i++) { deadAt[pk[i].pid] = pk[i].kill; }
  var ord = poolOrder(r), cut = lastUseAt(r);
  if (cut == null) { cut = r.dur || 240; }
  var lists = [], hps = [];
  for (i = 0; i < ord.length; i++) {
    lists.push(shotsOf(r, { pid: ord[i], deadAt: deadAt, cut: cut }));
    hps.push(Math.max(0, poolHp(r, ord[i]) - (carry[ord[i]] || 0)));
  }
  var main = ord.indexOf(r.cid), tots = [], kills = [], ok = 0;
  var f = rngOf(seed || 0x5f3759df);
  for (q = 0; q < N; q++) {
    var all = 1, mt = 0, mk = null;
    for (i = 0; i < lists.length; i++) {
      var run = rollRun(lists[i], hps[i], f);
      if (run.tot < hps[i]) { all = 0; }
      if (i === main) { mt = run.tot; mk = run.killAt; }
    }
    ok += all;
    tots.push(mt);
    if (mk != null) { kills.push(mk); }
  }
  var mu = 0, va = 0;
  for (q = 0; q < tots.length; q++) { mu += tots[q]; }
  mu /= Math.max(1, tots.length);
  for (q = 0; q < tots.length; q++) { va += (tots[q] - mu) * (tots[q] - mu); }
  va /= Math.max(1, tots.length - 1);
  var srt = tots.slice().sort(function (a, b) { return a - b; });
  kills.sort(function (a, b) { return a - b; });
  return { p: ok / N, mu: mu, sd: Math.sqrt(Math.max(0, va)), n: N,
           hp: main >= 0 ? hps[main] : 0, cut: cut,
           lo: srt[Math.floor(N * 0.05)], hi: srt[Math.min(N - 1, Math.floor(N * 0.95))],
           kill: kills.length ? kills[Math.floor(kills.length / 2)] : null,
           killP: kills.length / N };
}
