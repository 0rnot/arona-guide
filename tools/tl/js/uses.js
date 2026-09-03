import { B } from './util.js';
import { SLOTS, st } from './core.js';
import { mark } from './undo.js';
import { diff } from './boss.js';
import { orderOf, simOf } from './engine.js';
import { draw } from './draw.js';

// ------------------------------------------------------------ 置いたスキル
// st.tl の 1 件は { i: 編成の枠 0-5, t: 秒 }。EX レーンにだけ置く
export function snap(t) {
  var q = st.grid / B.fps;
  return Math.max(0, +(Math.round(t / q) * q).toFixed(4));
}
// **切り上げ側の吸い付き。**自動生成で使う。四捨五入だと刻みぶん手前に落ちて
// コストが 0.02 ほど足りなくなり、置いた端から赤くなっていた（2026-09-01）
export function snapUp(t) {
  var q = st.grid / B.fps;
  return Math.max(0, +(Math.ceil(t / q - 1e-9) * q).toFixed(4));
}
export function exDur(p) { return (p && p.d) || 60; }
/** EX の効果（バフ・デバフ）が切れるまでの秒。**撃った時刻からの長さ**で、
    `ApplyFrame`（乗るまでの間）＋`Duration` のいちばん長いものを採る。無ければ 0。
    出どころは `B.buf[生徒][形態]`（`bufKeys` は
    Target / Stat / Channel / Value / Duration / ApplyFrame / Restrictions）。
    NS の `nsBuffDur` と同じ考え方で、2026-09-03 の先生の指示
    「EX スキルも NS と同じように効果時間がタイムライン上でわかるようにしてほしい」。
    **効果を持つのは 274 人中 101 人**なので、出ない子がいるのが正しい */
export function exBuffDur(id, kind) {
  var list = (B.buf[id] || {})[kind || 'Ex'] || [], i, mx = 0;
  for (i = 0; i < list.length; i++) {
    var e = list[i], du = e[4];
    if (du > 0 && du < 1000000) { mx = Math.max(mx, (e[5] || 0) / B.fps + du / 1000); }
  }
  return mx;
}
export function exCost(p) { return (p && p.c && p.c[st.lv - 1]) || 0; }
export function tlSorted() {
  // **同じ秒どうしは「置いた順」（`st.tl` の並び）で撃つ。**`Array.sort` は
  // 安定なので、比べるのを秒だけにすれば並びがそのまま残る。
  // **前は編成の枠の番号（`a.i`）で決めていた**が、TL が「即 ヒナ／即 アコ」と
  // 書いた順とは関係が無く、コストの食い合いで撃てる・撃てないが入れ替わっていた
  // （2026-09-03 の 29。表の並びと engine の並びが食い違ってもいた）
  return st.tl.slice().sort(function (a, b) { return a.t - b.t; });
}
export function addUse(i, t) {
  if (!st.party[i]) { return; }
  mark();
  var u = { i: i, t: snap(t), to: null, ov: null, f: null, bt: null, md: 't', cv: null };
  st.tl.push(u);
  st.sel = st.tl.length - 1;
  fixUse(u);
  draw();
}
// **手で置いた 1 発が「間に合わない」なら、撃てる最短の刻みへ寄せる。**
// 刻みへの吸い付きは四捨五入なので、ちょうどコストが貯まる時刻を狙うと
// 必ず 1 刻み手前に落ちて赤くなる（2026-09-01、実物の TL を写していて気づいた）。
// **読み込んだ TL は寄せない。**成立しないことがそのまま見えるようにしておく
export function fixUse(u) {
  var dur = diff().dur || 240, guard = 0;
  while (guard++ < 60) {
    var rows = simOf(orderOf(), dur).rows, me = null, k;
    for (k = 0; k < rows.length; k++) {
      if (rows[k].e && rows[k].e._ix != null && st.tl[rows[k].e._ix] === u) { me = rows[k]; }
    }
    if (!me || !me.why || me.soon == null) { return; }
    var nt = snapUp(Math.max(u.t + st.grid / B.fps * 0.5, me.soon));
    if (nt > dur || nt <= u.t) { return; }
    u.t = nt;
  }
}
// 自動生成。**編成の順に、コストが貯まった瞬間から順に置く。**
// 前の EX の演出が終わるまでは次を置かない（実際に撃てないので）
// 自動生成。**engine に「最短で撃つ」を解かせて、その時刻をそのまま置く。**
// 開始スキルで指定した順を先頭に、あとは編成の順に回す
export function autoFill() {
  var r = diff(), dur = r.dur || 240, i;
  var seq = [];
  for (i = 0; i < st.start.length; i++) {
    if (st.start[i] != null && st.party[st.start[i]]) { seq.push(st.start[i]); }
  }
  for (i = 0; i < SLOTS; i++) {
    if (st.party[i] && seq.indexOf(i) < 0 && (st.party[i].c || [])[0] != null) { seq.push(i); }
  }
  if (!seq.length) { return; }
  mark();
  // **1 発ずつ確定させる。**先に置いた 1 発を刻みへ切り上げるとコストの貯まりが
  // ずれるので、まとめて解いてから丸めると後ろが「間に合いません」になる
  var fixed = [], k = 0;
  while (fixed.length < 120) {
    var probe = fixed.concat([{ i: seq[k % seq.length], t: null, to: null, ov: null, f: null, bt: null }]);
    var rows = simOf(probe, dur).rows, last = rows[rows.length - 1];
    if (!last || !last.d || last.at == null) { break; }
    var at = snapUp(last.at);
    if (at > dur) { break; }
    // 切り上げた時刻で本当に撃てるか確かめ直す。だめならもう 1 刻み後ろへ
    var guard = 0;
    while (guard++ < 40) {
      var test = fixed.concat([{ i: last.e.i, t: at, to: null, ov: null, f: null, bt: null }]);
      var tr = simOf(test, dur).rows;
      var tl2 = tr[tr.length - 1];
      if (!tl2.why) { break; }
      at = snapUp(at + st.grid / B.fps);
      if (at > dur) { break; }
    }
    if (at > dur) { break; }
    fixed.push({ i: last.e.i, t: at, to: null, ov: null, f: null, bt: null });
    k++;
  }
  st.tl.length = 0; st.sel = null;
  for (i = 0; i < fixed.length; i++) {
    st.tl.push({ i: fixed[i].i, t: fixed[i].t, to: null, ov: null, f: null, bt: null });
  }
  draw();
}
export function delSel() {
  if (st.sel == null) { return; }
  mark();
  st.tl.splice(st.sel, 1); st.sel = null; draw();
}
