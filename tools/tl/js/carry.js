import { $ } from './util.js';
import { SLOTS, _pv, st } from './core.js';
import { usePartyRef } from './undo.js';
import { boss, diff, has } from './boss.js';
import { scenIx } from './scen.js';
import { dmgCurve, naPool, poolBodies, poolKills, poolOf, subIxOfPool, valueAt } from './pool.js';
import { naTimes } from './na.js';
import { usesSorted } from './buff.js';
import { dmgOf, dotTimes } from './dmg.js';
import { epEvery, epOkAt, epOn } from './ep.js';

// ------------------------------------------------------------ 部隊の持ち越し
// **部隊 k の結果**（終了時刻・撃破時刻・池ごとに削った量）。前の部隊が削ったぶんを
// 引いて求める。**終了時刻は撃破なら撃破時刻、人が置けばそれ、「ギブアップ」の TL なら
// 最後の EX の演出が終わる時刻、それ以外は制限時間**（2026-09-02）
export var _pcV = {};
export function partyCalc(k) {
  var r = diff(), dur = r.dur || 240, p = st.parties[k];
  if (!p) { return { end: 0, kill: null, dealt: {}, pools: [] }; }
  var key = [_pv, st.bi, st.di, st.arm, scenIx(), st.crit, k, p.end, JSON.stringify(p.tl),
             JSON.stringify(p.bst), JSON.stringify(p.slots)].join('|');
  if (_pcV[key]) { return _pcV[key]; }
  var save = st.pi, gsp = GGSP, gbz = GGBUSY, hsp = HPSP, out;
  st.pi = k; usePartyRef(); GGSP = null; GGBUSY = false; HPSP = null;
  try {
    var carry = carryIn(k);
    ggSolve(r);
    var pk = poolKills(r, carry), i, kill = 0, end, dealt = {};
    for (i = 0; i < pk.length; i++) {
      if (pk[i].kill == null) { kill = null; break; }
      kill = Math.max(kill, pk[i].kill);
    }
    if (kill != null) { end = kill; }
    else if (p.end != null && isFinite(p.end)) { end = Math.max(0, Math.min(+p.end, dur)); }
    // **ギブアップした部隊の終わりは、置いていなければ制限時間。**最後の EX の演出終わりに
    // していたが、実測より 50 秒早かった（BPnnoHtwrYA P1: 道具 211 秒・実測 261 秒。
    // 2026-09-02、グミの報告）。本当の時刻は TL に無いので「終わり」の欄に置いてもらう
    else { end = dur; }
    for (i = 0; i < pk.length; i++) {
      dealt[pk[i].pid] = Math.max(0, Math.min(pk[i].need, valueAt(pk[i].cv, end)));
    }
    out = { end: end, kill: kill, dealt: dealt, pools: pk, gu: !!p.gu, manual: p.end != null };
  } finally { st.pi = save; usePartyRef(); GGSP = gsp; GGBUSY = gbz; HPSP = hsp; }
  _pcV[key] = out;
  return out;
}
export function carryIn(k) {
  var c = {}, j, pid;
  for (j = 0; j < k; j++) {
    var d = partyCalc(j).dealt;
    for (pid in d) { if (has(d, pid)) { c[pid] = (c[pid] || 0) + d[pid]; } }
  }
  return c;
}
/** その部位に当てたぶんが、ボスの HP から何 % 減るか（0 なら減らない）。
    **ペロロジラのミニオン・グレゴリオの聖歌隊・ホバークラフトのミサイル誘導装置・
    クロカゲの片鱗**は、部位の被ダメージがそのままボスへ転移する。
    出どころは `raids.min.json` の `RaidSkills` の説明文で、
    `d[].sub[].trw` にその一文がそのまま入っている（2026-09-01）。 */
export function trOf(r, tg) {
  if (tg == null) { return 0; }
  var sb = (r.sub || [])[tg];
  return (sb && sb.tr) ? sb.tr / 100 : 0;
}
/** **ボスに当たらない区間**（`st.bst` の `away`）。雑魚処理や移動でボスが盤に
    居ない間は、EX・NS・通常攻撃のどれもボスの HP から引かない。
    ケセドは 152 秒のうち 121 秒がこれで、無いと EX を全部雑魚に向けても
    136% になる（2026-09-02）。**区間を置くのは使う人**（当たる先と同じ扱い） */
export function awayAt(t, na, gx) {
  var i, w;
  for (i = 0; i < (st.bst || []).length; i++) {
    w = st.bst[i];
    if (gx && gx.indexOf(i) >= 0) { continue; }
    if ((w.k === 'away' || (na && w.k === 'mob')) && t >= w.t0 - 1e-9 && t < w.t1) { return true; }
  }
  return false;
}
/** 区間に入って数えなかった発数と、区間の合計秒 */
export function awayDrop(r) {
  var o = { sec: 0, ex: 0, ns: 0, na: 0 }, i, q, dur = r.dur || 240;
  for (i = 0; i < (st.bst || []).length; i++) {
    var w = st.bst[i];
    if (w.k === 'away' || w.k === 'mob') { o.sec += Math.max(0, Math.min(w.t1, dur) - w.t0); }
  }
  if (!o.sec) { return o; }
  var us = usesSorted();
  for (i = 0; i < us.length; i++) {
    if (!awayAt(us[i].t, !/^Ex\d*$/.test(us[i].k), us[i].gx)) { continue; }
    // ダメージの無い EX（バフ役）は数えない。総量の表と同じ数え方にする
    if (!dmgOf(us[i].i, r, us[i].t, us[i].k, us[i].pk, us[i].tg, us[i].gx,
               us[i].no)) { continue; }
    if (/^Ex\d*$/.test(us[i].k)) { o.ex++; } else { o.ns++; }
  }
  for (i = 0; i < SLOTS; i++) {
    if (!st.party[i]) { continue; }
    var ts = naTimes(i, dur);
    for (q = 0; q < ts.length; q++) { if (awayAt(ts[q], true)) { o.na++; } }
  }
  return o;
}
export function dmgCurve0(r, key, pid, deadAt) {
  var pts = [], us = usesSorted(), i, q;
  if (pid == null) { pid = r.cid; }
  if (!deadAt) { deadAt = {}; }
  for (i = 0; i < us.length; i++) {
    var u = us[i];
    // **部位（柱・装置・聖遺物…）に当てた発は、ボスの HP から引かない。**
    // ただし転移する部位だけは、その率のぶんボスへ入れる。
    // **池を持つ部位（レンジャー・クロ・ホバー後半）に当てた発は、その池へ**
    // **当たる先の無い発は、その時刻に生きている池へ**（シロが死んだあとの EX はクロへ。
    // 通常攻撃の `naPool` と同じ。2026-09-02、大決戦シロクロで 8 発がシロの池に残っていた）
    var tr = trOf(r, u.tg) * (u.mc || 1), pp = u.tg == null ? (naPool(r, u.t, deadAt) || r.cid) : poolOf(r, u.tg);
    if (pp !== pid && !(pid === r.cid && u.tg != null && tr)) { continue; }
    if (u.t > (r.dur || 240) + 1e-9 || awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
    // **当たる先を書いていない発をよその池へ回すときは、その池の相手で引く**（2026-09-03）
    var aim = u.tg == null && pp !== r.cid ? subIxOfPool(r, pp) : u.tg;
    var d = dmgOf(u.i, r, u.t, u.k, u.pk, aim, u.gx, u.no);
    // **同じ池を分け合う体に当てた発は、当たった数だけ池へ入る**（2026-09-03）。
    // 転移（`tr`）のほうは前から `mc` が効いていたが、**HP を共有している池
    // （カイテンジャーの 5 体で 40,000,000）は 1 体ぶんしか数えていなかった**
    var mcp = (u.tg != null && pp === pid && (u.mc || 1) > 1)
      ? Math.min(u.mc, poolBodies(r, pid)) : 1;
    var v0 = d ? (tr && pp !== pid ? d[key] * tr : d[key] * mcp) : 0;
    // **直線に伸びる攻撃は、部位を貫いてボス本体にも当たる**（ヒナ（ドレス）の
    // 射撃など）。当たるかどうかは盤の上の話でデータから決まらないので、
    // **置くのは使う人**（帯の「ボス本体にも当たる」。2026-09-02 の先生の見立て）。
    // ボスと部位で防御が違うことがあるので、本体ぶんは本体の数字で出す
    if (d && u.tg != null && u.hb) {
      var db = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no);
      if (db) { v0 += db[key]; }
    }
    // **継続ダメージ（DoT）は撃った瞬間ではなく `Period` ごとに入る**（2026-09-03）。
    // 曲線・討伐時刻・HP のゲート・スコアがその分だけ早くずれていた。
    // 合計は変えない（`total()` は触っていない）——**置く時刻だけを割る**
    if (d) {
      var tsD = dotTimes(u.i, r, u.t, u.k, u.pk, aim);
      if (tsD.length) {
        var dNow = dmgOf(u.i, r, u.t, u.k, u.pk, aim, u.gx, u.no, 'now');
        var dDot = dmgOf(u.i, r, u.t, u.k, u.pk, aim, u.gx, u.no, 'dot');
        var vN = dNow ? (tr && pp !== pid ? dNow[key] * tr : dNow[key] * mcp) : 0;
        var vD = dDot ? (tr && pp !== pid ? dDot[key] * tr : dDot[key] * mcp) : 0;
        if (d && u.tg != null && u.hb) {
          var dbN = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, 'now');
          var dbD = dmgOf(u.i, r, u.t, u.k, u.pk, null, u.gx, u.no, 'dot');
          if (dbN) { vN += dbN[key]; }
          if (dbD) { vD += dbD[key]; }
        }
        if (vN) { pts.push([u.t, vN]); }
        for (q = 0; q < tsD.length; q++) { pts.push([tsD[q], vD / tsD.length]); }
      } else { pts.push([u.t, v0]); }
    }
  }
  var dur = r.dur || 240, STEP = 5;
  for (i = 0; i < SLOTS; i++) {
    if (!st.party[i]) { continue; }
    var ts = naTimes(i, dur), bucket = {}, bk;
    if (!ts.length) { continue; }
    for (q = 0; q < ts.length; q++) {
      if (awayAt(ts[q], true) || naPool(r, ts[q], deadAt) !== pid) { continue; }
      var at0 = Math.min(ts[q], dur), b = Math.floor(at0 / STEP);
      if (!bucket[b]) { bucket[b] = []; }
      bucket[b].push(at0);
    }
    for (bk in bucket) {
      var dn = dmgOf(i, r, (+bk + 0.5) * STEP, 'Normal', null, subIxOfPool(r, pid));
      if (!dn) { break; }
      for (q = 0; q < bucket[bk].length; q++) { pts.push([bucket[bk][q], dn[key]]); }
    }
    // **サブスキル（SS）は通常攻撃に相乗りする**（2026-09-03）。同じ束から
    // `TryCount` に 1 度ずつ出す（メルは 3 発に 1 度）
    if (epOn(st.party[i].id)) {
      var ev3 = epEvery(st.party[i].id), bs3;
      for (bs3 in bucket) {
        var at3 = Math.min((+bs3 + 0.5) * STEP, dur);
        var cn3 = Math.floor(bucket[bs3].length / ev3);
        if (!cn3 || !epOkAt(st.party[i].id, r, at3, subIxOfPool(r, pid))) { continue; }
        var ds3 = dmgOf(i, r, at3, 'ExtraPassive', null, subIxOfPool(r, pid));
        if (!ds3) { break; }
        for (q = 0; q < cn3; q++) { pts.push([bucket[bs3][q * ev3], ds3[key]]); }
      }
    }
  }
  pts.sort(function (a, b) { return a[0] - b[0]; });
  var acc = 0, out = [];
  for (i = 0; i < pts.length; i++) { acc += pts[i][1]; out.push([pts[i][0], acc]); }
  return out;
}
/** ボスの HP をぜんぶ削り切る時刻。届かないなら null。 */
export function killAt(r) {
  if (!((r.bs && r.bs.hp) || 0)) { return null; }
  return partyCalc(st.pi).kill;
}
/** そのタイムで倒しきったときのスコア。**式は総力戦スコア計算機と同じ**——
    `DefaultClearScore + HPPercentScore + max(0, MaximumScore - 経過秒 × PerSecondMinusScore/10)`。
    ぱちみさんの TL Planner の 39,297,782.96 ⇔ 174.2571 秒とぴたり合う（2026-08-30 に確認）。
    **1 部隊で倒しきったときの数字**で、実際は全部隊の合計秒で減る。 */
export function scoreOf(r, sec) {
  var s0 = r.sc;
  if (!(s0 && s0.length === 4)) { return null; }
  return s0[0] + s0[1] + Math.max(0, s0[3] - sec * s0[2]);
}
export function secLab(t) {
  var m = Math.floor(t / 60), x = t - m * 60;
  return m + ':' + (x < 10 ? '0' : '') + x.toFixed(2);
}
/** フェーズの区間。`[{ p, t0, t1, need }]`。**手で固定したときはその 1 本だけ。** */
export function phaseSpans(r) {
  var dur = r.dur || 240;
  if (st.phFix != null && r.ph[String(st.phFix)]) {
    return [{ p: String(st.phFix), t0: 0, t1: dur, need: null, fix: true }];
  }
  var hp0 = (r.bs && r.bs.hp) || 0, cur = '0', out = [], t0 = 0, guard = 0;
  if (!hp0 || !r.ph[cur]) { return [{ p: '0', t0: 0, t1: dur, need: null }]; }
  var cv = dmgCurve(r), carry0 = (carryIn(st.pi)[r.cid] || 0);
  while (guard++ < 12) {
    var list = ((r.ph[cur] || {}).hp) || [];
    if (!list.length) { break; }
    // 前の部隊が削ったぶんは、この部隊の 0 秒時点で既に減っている
    var need = hp0 - list[0][0] - carry0, at = null, acc = 0, i;
    if (need <= 0) {
      var nx0 = list[0][1], q0;
      for (q0 = 0; q0 < list.length; q0++) { if (hp0 - list[q0][0] - carry0 <= 0) { nx0 = list[q0][1]; } }
      cur = String(nx0);
      if (!r.ph[cur]) { break; }
      continue;
    }
    for (i = 0; i < cv.length; i++) { if (cv[i][1] >= need) { at = cv[i][0]; acc = cv[i][1]; break; } }
    if (at == null || at > dur) {
      out.push({ p: cur, t0: t0, t1: dur, need: need, miss: true });
      return out;
    }
    // **同じ瞬間に出たぶんは全部いっしょに数える。**`dmgCurve` は 1 発ごとに
    // 点を置くので、同時刻の点が続く（複製カードと本体が重なるときがこれ）
    for (; i + 1 < cv.length && cv[i + 1][0] <= at + 1e-9; i++) { acc = cv[i + 1][1]; }
    // **1 発で 2 段ぶん削ったら、間のフェーズは飛ばす**（2026-09-01 の先生の指摘
    // 「動画だとフェーズ2をスキップしてフェーズ1からフェーズ3に行ってる」）。
    // いちばん深く越えた境目を採る
    var nx = list[0][1], deep = need, q;
    for (q = 0; q < list.length; q++) {
      var nd = hp0 - list[q][0];
      if (acc >= nd && nd >= deep) { nx = list[q][1]; deep = nd; }
    }
    out.push({ p: cur, t0: t0, t1: at, need: need,
               skip: String(nx) !== String(list[0][1]) });
    cur = String(nx); t0 = at;
    if (!r.ph[cur]) { break; }
  }
  out.push({ p: cur, t0: t0, t1: dur, need: null });
  return out;
}

/* **グロッキーの貯まり方はボスごとに違う**（2026-09-01 の先生の指摘）。
   `gc`（`GroggyCondition` の原文）が空のボスだけ「ダメージで貯まる」ので、
   そこだけ線を引く。**書いてあるボスは追わない**——「自律兵器が破壊されると
   増加する」「EXスキルが中断されると増加する」のような、この道具が持っていない
   出来事が引き金だから。ゲージの大きさと条文はそのまま出す。 */
export function ggMode(r) {
  var b = boss(), bs = r.bs || {};
  if (!bs.groggy) { return { kind: 'なし' }; }
  if (b.gc) { return { kind: '条件つき', why: b.gc, need: bs.groggy, sec: (bs.groggyT || 0) / 1000 }; }
  if (bs.hp && bs.groggy > bs.hp * 20) { return { kind: '実質なし', need: bs.groggy }; }
  return { kind: 'ダメージ', need: bs.groggy, sec: (bs.groggyT || 0) / 1000 };
}
/** ダメージで貯まるボスの、ゲージの折れ線と、たまり切った時刻。 */
export function ggRuns(r) {
  var g = ggMode(r);
  if (g.kind !== 'ダメージ') { return { g: g, pts: [], hits: [] }; }
  // **グロッキーの間はゲージが貯まらない扱いにしている**（2026-09-01 の
  // 先生の疑問「グロッキーしながらグロッキー貯まる？」）。**これはデータに
  // 書いていない。**ゲームの表にあるのは `GroggyGauge` と `GroggyTime` の
  // 2 つだけで、その間の貯まり方は入っていない（`DB/` の 456 表を見た）。
  // 貯め続ける作りにすると帯が重なって連続でグロッキーになるので、
  // 「グロッキー中に入れたぶんは次のゲージに数えない」を既定にした
  var cv = dmgCurve(r), base = 0, pts = [[0, 0]], hits = [], i, until = -1;
  for (i = 0; i < cv.length; i++) {
    var t = cv[i][0];
    if (t < until) { base = cv[i][1]; pts.push([t, 0]); continue; }
    var v = cv[i][1] - base;
    if (v >= g.need) {
      pts.push([t, g.need]);
      hits.push({ t: t, until: t + g.sec });
      until = t + g.sec;
      base = cv[i][1];
      pts.push([t, 0]);
    } else {
      pts.push([t, v]);
    }
  }
  return { g: g, pts: pts, hits: hits, base: base };
}
/* **グロッキーの間は会心が確定する。**
   出典（どれもボス個別の攻略記事で、ゲームの表には無い）——
     kamigame クロカゲ https://kamigame.jp/bluearchive/page/291958223466948853.html
       「グロッキー状態中は全ての敵の会心率が最大となる。」
     gamerch クロカゲ 「グロッキー中はこちらの攻撃すべてが確定会心となる」
   **グローバルな定数表には無い**（`Excel/ConstCombatExcelTable.json` の
   `CriticalConstA〜D` に groggy の分岐は 1 つも無く、SchaleDB の
   `getCriticalRate` にも無い。2026-09-01 に全文を見た）。
   手元の実測もこれを指している——大決戦ビナー Torment の録画で、
   累計ダメージがゲージ 6,500,000 に届く 55 秒あたりを境に、
   実測が「平均」から「全会心平均」の線へ乗り換わる（49.2 秒で 平均 −1.1%、
   59.6 秒で 全会心平均 +3.0%）。
   **ゲージはダメージで貯まり、ダメージは会心で変わるので、堂々巡りになる。**
   グロッキー無しで 1 度引いてから、出た区間を入れて引き直す、を繰り返す */
export var GGSP = null, GGBUSY = false;
/* **当たる先の HP でダメージが変わるものがある**（2026-09-03、56b。
   カリン（制服）は `3 − 2h`、ミカは `1 + h`）。**ここもグロッキーと同じ堂々巡り**で、
   HP はダメージで減り、ダメージは HP で変わる。**同じ解き方に相乗りする**——
   `ggSolve` が 4 周まわす、そのついでに累計ダメージの曲線を覚えておいて、
   次の周がそれを見る。1 周目は HP 満タン（倍率 1 ぶん）から始まる。
   **見ているのは本体の池だけ**（部位ごとの HP は追っていない）。 */
export var HPSP = null;
export function ggCritAt(t) {
  if (t == null) { return false; }
  for (var g = 0; g < (st.bst || []).length; g++) {
    var wg = st.bst[g];
    if (wg.k === 'groggy' && t >= wg.t0 - 1e-9 && t < wg.t1) { return true; }
  }
  if (!GGSP || !GGSP.length) { return false; }
  for (var i = 0; i < GGSP.length; i++) {
    if (t >= GGSP[i][0] - 1e-9 && t < GGSP[i][1]) { return true; }
  }
  return false;
}
/** その時刻での当たる先の HP 割合（0〜1）。**解けていなければ 1（満タン）。** */
export function hpRateAt(t) {
  if (t == null || !HPSP || !(HPSP.hp0 > 0)) { return 1; }
  var cv = HPSP.cv, i, acc = 0;
  for (i = 0; i < cv.length; i++) { if (cv[i][0] > t) { break; } acc = cv[i][1]; }
  return Math.max(0, Math.min(1, (HPSP.hp0 - HPSP.carry - acc) / HPSP.hp0));
}
export function ggSolve(r) {
  if (GGBUSY || !r) { return; }
  GGBUSY = true;
  try {
    var pass, i, prev = null;
    GGSP = null; HPSP = null;
    var hp0 = (r.bs && r.bs.hp) || 0, carry0 = (carryIn(st.pi)[r.cid] || 0);
    for (pass = 0; pass < 4; pass++) {
      var hits = ggRuns(r).hits, ns = [], same = !!prev && prev.length === hits.length;
      // **累計ダメージの曲線を覚える**（56b）。`ggRuns` が引いたばかりのものと
      // 同じで、`dmgCurve` は同じ状態なら覚えているので引き直しにはならない
      if (hp0 > 0) { HPSP = { hp0: hp0, carry: carry0, cv: dmgCurve(r) }; }
      for (i = 0; i < hits.length; i++) { ns.push([hits[i].t, hits[i].until]); }
      if (same) {
        for (i = 0; i < ns.length; i++) {
          if (Math.abs(prev[i][0] - ns[i][0]) > 1e-6) { same = false; }
        }
      }
      prev = ns;
      GGSP = ns;
      if (same) { break; }
    }
  } finally { GGBUSY = false; }
}
/** ある時刻でゲージがどれだけ貯まっているか。**先生が見たいのはこれ。** */
export function ggAt(runs, t) {
  if (!runs.pts.length) { return null; }
  // **ちょうど貯まり切った時刻では、0 に戻る前の値を返す。**
  // フェーズの移り目とグロッキーは同じダメージで動くので必ず重なる
  var v = 0, i;
  for (i = 0; i < runs.pts.length; i++) {
    if (runs.pts[i][0] > t) { break; }
    v = runs.pts[i][0] === t ? Math.max(v, runs.pts[i][1]) : runs.pts[i][1];
  }
  return v;
}


// `_pcV` は carry.js の持ち物。core.js の `bump()` から捨てるための窓口
export function clearPartyCalc() { _pcV = {}; }
