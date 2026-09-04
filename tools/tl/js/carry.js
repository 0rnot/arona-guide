import { $ } from './util.js';
import { SLOTS, _pv, st } from './core.js';
import { usePartyRef } from './undo.js';
import { boss, diff, has } from './boss.js';
import { scen, scenIx } from './scen.js';
import { dmgCurve, naPool, poolBodies, poolKills, poolOf, subIxOfPool, valueAt } from './pool.js';
import { naTimes } from './na.js';
import { usesSorted } from './buff.js';
import { PICKF, dmgOf, dotTimes, setPICKF } from './dmg.js';
import { epEvery, epOkAt, epOn, epTierPick } from './ep.js';

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
        // **段で分かれる子は、その時刻の段で候補を決める**（2026-09-04。`clear.js` と同じ）
        var ds3 = dmgOf(i, r, at3, 'ExtraPassive',
                        epTierPick(st.party[i].id, r, at3, subIxOfPool(r, pid)),
                        subIxOfPool(r, pid));
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
    var cph = r.ph[cur] || {}, list = cph.hp || [];
    // **ゲージでフェーズが変わるボス**（2026-09-04）。HP ではなく通常攻撃の数で回る。
    // ペロロジラは `CheckActiveGaugeOver 301 → ChangePhase` が 19 発目で立って
    // 0→1→2→0 と輪になる（`build-tool-data.py` が `ph[].atg` に
    // `[通常攻撃の数, 秒, 次のフェーズ]` で入れる）。
    // **前は `hp` が空なので帯が 1 本のまま**で、吸収の予定が 72 秒で尽きていた。
    // 240 秒のうちグロッキーが 1 回も立たない TL があったのはこれが原因
    if (!list.length && cph.atg && cph.atg[1] > 0 && r.ph[String(cph.atg[2])]) {
      var t1a = t0 + cph.atg[1];
      if (t1a >= dur) { break; }
      out.push({ p: cur, t0: t0, t1: t1a, need: null, atg: true });
      cur = String(cph.atg[2]); t0 = t1a;
      continue;
    }
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

/** **「フェーズ N ではグロッキーゲージが増加しない」型の条文**（2026-09-04）。
    これは「この道具が持っていない出来事」ではなく、**フェーズが分かれば追える**。
    クロカゲ（`EN0006`）の `gc` は「フェーズ1ではグロッキーゲージが増加しない。」で、
    その実体はステージ側にある——
      `Stage/en0006_lunatic.json`
        `Sections[0]`（`SectionID: 1`＝フェーズ 1）の `Events[3]`（`"EventName": "StayArea"`）
          `{"$type": "MX.Logic.Battles.GroundCommandSetStatusImmune, BlueArchive",
            "heroStatus": "ImmuneGroggyGaugeAdd", "isAdd": true, "CommandID": "EN0006"}`
        `Sections[2]`（`SectionID: 3`＝フェーズ 2）の `Events[1]`（`"EventName": "StayArea"`）
          `{"$type": "MX.Logic.Battles.GroundCommandSetStatusImmune, BlueArchive",
            "heroStatus": "ImmuneGroggyGaugeAdd", "isAdd": false, "CommandID": "EN0006"}`
    **付けるのがフェーズ 1、外すのがフェーズ 2 で、そのあと付け直す行は無い**
    （`ImmuneGroggyGaugeAdd` はこのファイル中に 2 件しか無い）。つまり
    「フェーズ 1 の間だけゲージが増えない／それ以外はダメージで貯まる」。
    返すのは増えないフェーズの添字（`r.ph` の鍵。**ゲーム内の「フェーズ1」が `'0'`**）。
    **1 行でも別の型が混ざっていたら null**——追えない引き金が残るので丸ごと人に任せる。 */
export function ggFreezePh(gc) {
  var lines = String(gc || '').split(/\n+/), out = [], i, ln, m;
  for (i = 0; i < lines.length; i++) {
    ln = lines[i].trim();
    if (!ln) { continue; }
    m = /^フェーズ([0-9０-９]+)ではグロッキーゲージが増加しない/.exec(ln);
    if (!m) { return null; }
    out.push(String(+m[1].replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    }) - 1));
  }
  return out.length ? out : null;
}
/* **グロッキーの貯まり方はボスごとに違う**（2026-09-01 の先生の指摘）。
   `gc`（`GroggyCondition` の原文）が空のボスだけ「ダメージで貯まる」ので、
   そこだけ線を引く。**書いてあるボスは追わない**——「自律兵器が破壊されると
   増加する」「EXスキルが中断されると増加する」のような、この道具が持っていない
   出来事が引き金だから。ゲージの大きさと条文はそのまま出す。
   **例外はフェーズを名指しした条文だけ**（`ggFreezePh`）。そちらは引き金が
   「ダメージ」のままで、増えない区間がフェーズで決まるので追える。 */
export function ggMode(r) {
  var b = boss(), bs = r.bs || {};
  if (!bs.groggy) { return { kind: 'なし' }; }
  var fz = b.gc ? ggFreezePh(b.gc) : null;
  // **貯まり方が DB から出るボス**（`d[].gga`。2026-09-04）。`gc` の
  // 「気絶状態のペロロミニオンを吸い込むと増加する。」の中身が数字で入っている。
  // **窓は今までどおり人が置く**——ボスの何発目の通常攻撃かは分かっても、
  // その発が何秒に来るかは道具が持っていない（`ph[].ev` の秒は通常攻撃だけを
  // 数えた時計で、EX のモーションぶんが入っていない）。ここで返すのは
  // 「どこに置けばよいか」を画面に出すための材料
  if (r.gga) {
    // **`need` は吸収のゲージのほう**（`gga.need` ＝ 10000。2026-09-04）。
    // `bs.groggy`（1,000,000,000）はダメージで貯めるときの目盛りで、
    // 吸収では使わない。折れ線と割合はこちらの目盛りで描く
    return { kind: '吸収', why: b.gc || '', need: r.gga.need || bs.groggy,
             sec: (bs.groggyT || 0) / 1000, gga: r.gga };
  }
  if (b.gc && !fz) { return { kind: '条件つき', why: b.gc, need: bs.groggy, sec: (bs.groggyT || 0) / 1000 }; }
  if (bs.hp && bs.groggy > bs.hp * 20) { return { kind: '実質なし', need: bs.groggy }; }
  return { kind: 'ダメージ', need: bs.groggy, sec: (bs.groggyT || 0) / 1000,
           freeze: fz, why: fz ? b.gc : '' };
}
/** ゲージが増えないフェーズの区間 `[[t0, t1], …]`。名指しが無ければ空。 */
export function ggFreezeSpans(r, g) {
  if (!g || !g.freeze || !g.freeze.length) { return []; }
  var sp = phaseSpans(r), out = [], i;
  for (i = 0; i < sp.length; i++) {
    if (g.freeze.indexOf(String(sp[i].p)) >= 0) { out.push([sp[i].t0, sp[i].t1]); }
  }
  return out;
}
function inSpans(sp, t) {
  for (var i = 0; i < sp.length; i++) {
    if (t >= sp[i][0] - 1e-9 && t < sp[i][1]) { return true; }
  }
  return false;
}
/** **フェーズが移る瞬間にグロッキーが強制解除されるボス**（2026-09-04）。
    クロカゲ（`EN0006`）だけ。`gc` にも `RaidSkills` の説明文にも書いていないので
    ここに置く。出どころは**ステージの命令**で、Torment と Lunatic の両方に同じ形で在る——
      `Stage/en0006_torment.json` `Sections[2]`（`SectionID: 3`）`Events[2]`
      `Stage/en0006_lunatic.json` `Sections[2]`（`SectionID: 3`）`Events[2]`
        `{"EventName": "BossHpRateUnder", "Operator": 0,
          "Conditions": [{"$type": "MX.Logic.Battles.GroundConditionCharacterHPChanged, BlueArchive",
                          "TriggerRateUnder": 1000, "TriggerRateOver": -1,
                          "TriggerMaxCount": 1, "ConditionID": "EN0006"}],
          "Commands": [{"$type": "MX.Logic.Battles.GroundCommandWaitSeconds, BlueArchive",
                        "Milliseconds": 100, "CommandID": "EN0006", "WaitExecuteEnd": false},
                       {"$type": "MX.Logic.Battles.GroundCommandSetStatus, BlueArchive",
                        "heroStatus": "Groggy", "isAdd": false, "CommandID": "EN0006",
                        "WaitExecuteEnd": false}]}`
    **`TriggerRateUnder: 1000` は最大 HP の 10.00%。**同じ境目が
    `DB/BossExternalBTExcelTable.json` に数字で入っている——
      `{"ExternalBTId": 611140701, "AIPhase": 1, "ExternalBTNodeType": "Instant",
        "ExternalBTTrigger": "HPUnder", "TriggerArgument": "7000000", "BehaviorRate": 10000,
        "ExternalBehavior": "ChangePhase", "BehaviorArgument": "2"}`（7,000,000 / 70,000,000）
      `{"ExternalBTId": 611140801, "AIPhase": 1, "ExternalBTNodeType": "Instant",
        "ExternalBTTrigger": "HPUnder", "TriggerArgument": "15960000", "BehaviorRate": 10000,
        "ExternalBehavior": "ChangePhase", "BehaviorArgument": "2"}`（15,960,000 / 159,600,000）
    どちらもちょうど 10.00% で、**道具のフェーズ表の `'1' → '2'` と同じ点**
    （`r.ph['1'].hp` が `[[7000000, "2"], [3, "2"]]`）。
    同じことを言う条文がスキル側にもある——`LevelSkill/EN0006ExtraPassive03.json` の
    `EntityTimeline[1]`（`Frame: 5`）が `EN0006_ExtraPassive03_Effect04`
    （`DB/LogicEffect_NPC.json` の `StatusRemoveEffectDAO`・`"TargetStatus": "Groggy"`）を
      `{"$type": "MX.GameData.DAO.Battle.LogicEffectTemplateModifierDAO, BlueArchive",
        "TemplateId": "Dummy_FormConversion_Dispellable", "IncludeType": 1, "CheckTarget": 0}`
      `{"$type": "MX.GameData.DAO.Battle.HpRateModifierDAO, BlueArchive",
        "Operator": 2, "HpRate": 1000, "IncludeType": 1, "CheckTarget": 0}`
    の 2 条件つきで撃つ（`HpRate: 1000` も 10.00%）。
    **100 ミリ秒の待ちも原文どおり入れる**（`GroundCommandWaitSeconds`）。
    `ph` はその「移った先」の鍵で、**ゲーム内の「フェーズ3」が `'2'`**。 */
export var GGCUT = { EN0006: { ph: '2', sec: 0.1 } };
/** グロッキーが強制解除される時刻。無ければ null。 */
export function ggCutAt(r) {
  var c = GGCUT[(boss() || {}).dev];
  if (!c) { return null; }
  var sp = phaseSpans(r), i;
  for (i = 0; i < sp.length; i++) {
    if (sp[i].fix) { return null; }
    if (String(sp[i].p) === c.ph && sp[i].t0 > 0) { return sp[i].t0 + c.sec; }
  }
  return null;
}
/** **吸収でゲージが貯まるボスの窓**（2026-09-04。42 の続き）。
    材料はすべて DB から出ている（`d[].gga`。出どころは `build-tool-data.py` の `tl_groggy`）——

      吸収する EX      `gga.exi`（ペロロジラは `Perorozilla01TormentEx09` ペロロミニオン吸収）
      吸収する時刻     `ph[].ev` の中でその EX が出る点（Torment はフェーズの頭から 18/36/54/72 秒）
      1 体あたりの増分 `gga.step`（Torment 834 / 10000。SchaleDB の「1/12 上昇」と一致）
      数える上限体数   `gga.cap`（6。`CountLogicEffectTemplateModifierDAO` の `CountMin` の梯子）
      満杯            `gga.need`（10000）
      グロッキーの長さ `GroggyTime`（20 秒）

    **数えるのは「気絶している大きなペロロミニオン」だけ**（`gc` の
    「気絶状態のペロロミニオンを吸い込むと増加する。」。札を貼るのは体そのもので、
    条件は `GetHPRate() < 5000` ＝ **HP 50% 未満**）。だから
    **吸収と吸収のあいだに 1 体が受けたダメージが最大 HP の半分に届いた回だけ**数に入る。
    1 体ぶんのダメージは `mc`（当たる数）を掛ける前の値で、当たった体数は `mc` を `cap` で頭打ちにしたもの。

    **満杯にならない周は 0 のまま持ち越す**（吸われた体は消えるので、
    ダメージのほうは窓ごとに数え直す）。**グロッキー中に吸ったぶんは次のゲージに数えない**——
    ダメージで貯まるボス（`ggRuns`）と同じ扱いで、そこはデータに書いていない。 */
export function ggAbsorbRuns(r, g) {
  var gg = g.gga, out = { g: g, pts: [], hits: [] };
  if (!gg || !gg.step || !gg.cap || !gg.need) { return out; }
  var dur = r.dur || 240, sp = phaseSpans(r), subs = r.sub || [], i, q, k;
  // 吸収の時刻（フェーズの頭からの秒 ＋ そのフェーズが始まった時刻）
  var ts = [];
  for (i = 0; i < sp.length; i++) {
    var pd = r.ph[sp[i].p] || {}, ev = pd.ev || [], lim = Math.min(sp[i].t1, dur);
    for (q = 0; q < ev.length; q++) {
      if (ev[q][1] == null || (ev[q][2] || []).indexOf(gg.exi) < 0) { continue; }
      var tv = sp[i].t0 + ev[q][1];
      if (tv > lim + 1e-9 || tv > dur) { continue; }
      ts.push(tv);
    }
  }
  ts.sort(function (a, b) { return a - b; });
  // 吸われる体（本体へ転移する湧き）。`parse-tl.js` の範囲攻撃の既定と同じ選び方
  var ix = -1;
  for (i = 0; i < subs.length; i++) { if (subs[i].tr && subs[i].spn > 1) { ix = i; break; } }
  if (ix < 0 || !ts.length || !(subs[ix].hp > 0)) { return out; }
  var half = subs[ix].hp / 2;
  // 1 体ぶんのダメージ（`mc` を掛けない）
  var sc = scen(), sv = PICKF, hd = [];
  setPICKF(sc.pf);
  try {
    var us = usesSorted();
    for (i = 0; i < us.length; i++) {
      var u = us[i];
      if (u.tg !== ix || u.t > dur + 1e-9) { continue; }
      if (awayAt(u.t, !/^Ex\d*$/.test(u.k), u.gx)) { continue; }
      var d = dmgOf(u.i, r, u.t, u.k, u.pk, u.tg, u.gx, u.no);
      if (!d) { continue; }
      hd.push([u.t, d[sc.key] || 0, Math.min(u.mc || 1, gg.cap)]);
    }
  } finally { setPICKF(sv); }
  var gauge = 0, prev = 0, until = -1;
  out.pts.push([0, 0]);
  for (k = 0; k < ts.length; k++) {
    // **段を決めるのは「転倒した体の数」**（`CountLogicEffectTemplateModifierDAO`）。
    // 1 体は HP を半分まで削ると転倒する（`Perorozilla01MiddleSize01Passive02` の
    // `GetHPRate() < 5000`）。**前は「いちばん広い 1 発の当たる数」を段にしていた**が、
    // それだと 1 発で覆えない体は 18 秒かけて何発当てても数に入らない。
    // 吸収から吸収までに部位へ入った総ダメージを、体の HP の半分で割って段を出す
    // （2026-09-04。ペロロジラの大きなペロロは HP 210,000・半分 105,000 で、
    //  当てさえすれば 1 発で転倒する。屋外の TL が 1 度もグロッキーにならなかった原因）
    var t = ts[k], pool = 0;
    for (i = 0; i < hd.length; i++) {
      if (hd[i][0] <= prev + 1e-9 || hd[i][0] > t + 1e-9) { continue; }
      pool += hd[i][1] * hd[i][2];
    }
    prev = t;
    if (t < until) { continue; }
    var bodies = half > 0 ? Math.min(gg.cap, Math.floor(pool / half)) : 0;
    gauge += bodies * gg.step;
    out.pts.push([t, Math.min(gauge, gg.need)]);
    if (gauge >= gg.need) {
      var un = Math.min(t + (g.sec || 0), dur);
      out.hits.push({ t: t, until: un });
      until = un; gauge = 0;
      out.pts.push([t, 0]);
    }
  }
  return out;
}
/** ダメージで貯まるボスの、ゲージの折れ線と、たまり切った時刻。 */
export function ggRuns(r) {
  var g = ggMode(r);
  // **吸収で貯まるボスは別の解き方**（`ggAbsorbRuns`。2026-09-04）
  if (g.kind === '吸収') { return ggAbsorbRuns(r, g); }
  if (g.kind !== 'ダメージ') { return { g: g, pts: [], hits: [] }; }
  // **グロッキーの間はゲージが貯まらない扱いにしている**（2026-09-01 の
  // 先生の疑問「グロッキーしながらグロッキー貯まる？」）。**これはデータに
  // 書いていない。**ゲームの表にあるのは `GroggyGauge` と `GroggyTime` の
  // 2 つだけで、その間の貯まり方は入っていない（`DB/` の 456 表を見た）。
  // 貯め続ける作りにすると帯が重なって連続でグロッキーになるので、
  // 「グロッキー中に入れたぶんは次のゲージに数えない」を既定にした
  // **名指しされたフェーズの間は貯まらない**（2026-09-04。`ggFreezePh` の出典を見る）。
  // グロッキー中と同じ扱いで、その間に入れたぶんは次のゲージに数えない
  var fz = ggFreezeSpans(r, g), cut = ggCutAt(r);
  var cv = dmgCurve(r), base = 0, pts = [[0, 0]], hits = [], i, until = -1;
  for (i = 0; i < cv.length; i++) {
    var t = cv[i][0];
    if (inSpans(fz, t)) { base = cv[i][1]; pts.push([t, 0]); continue; }
    if (t < until) { base = cv[i][1]; pts.push([t, 0]); continue; }
    var v = cv[i][1] - base;
    if (v >= g.need) {
      // **フェーズが移る瞬間に切れるボスは、そこで終わり**（`ggCutAt` の出典）
      var un = t + g.sec;
      if (cut != null && t < cut - 1e-9 && un > cut) { un = cut; }
      pts.push([t, g.need]);
      hits.push({ t: t, until: un });
      until = un;
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
/** その時刻までに本体の池へ入った累計。**解けていなければ 0。** */
export function accAt(t) {
  if (t == null || !HPSP) { return 0; }
  var cv = HPSP.cv, i, acc = 0;
  for (i = 0; i < cv.length; i++) { if (cv[i][0] > t) { break; } acc = cv[i][1]; }
  return acc;
}
/** `t0` から `sec` 秒のあいだに入ったぶん（蓄積。2026-09-03、56c）。 */
export function accIn(t0, sec) {
  if (t0 == null || !HPSP) { return 0; }
  return Math.max(0, accAt(t0 + sec) - accAt(t0));
}
/** その時刻での当たる先の HP 割合（0〜1）。**解けていなければ 1（満タン）。** */
export function hpRateAt(t) {
  if (t == null || !HPSP || !(HPSP.hp0 > 0)) { return 1; }
  return Math.max(0, Math.min(1, (HPSP.hp0 - HPSP.carry - accAt(t)) / HPSP.hp0));
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
