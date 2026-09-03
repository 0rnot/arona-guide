import { S } from './util.js';
import { TE, clearMemo, st } from './core.js';
import { snapUp, tlSorted } from './uses.js';
import { diff } from './boss.js';
import { buffTo } from './target.js';

// ------------------------------------------------------------ エンジンへの入力
// **画面の状態を tools/tl-engine.js が読む形にするだけ。**式はここに書かない
// **固有武器パッシブの「効果時間延長」は `slot.wp` を見ている。**
// TL エディタの枠にはその欄が無くて、engine でも画面でも延長が効いていなかった
// （2026-09-01。カンナ（水着）のデバフが 20 秒のまま。本当は +19% で 23.8 秒）
export function wpSlots() {
  var out = [], i, k;
  for (i = 0; i < st.slots.length; i++) {
    var a = st.slots[i], o = {};
    for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { o[k] = a[k]; } }
    o.wp = (a.wstar >= 2 && a.wlv > 0) ? (a.plv || 0) : 0;
    out.push(o);
  }
  return out;
}
export function engIn(order, span) {
  var IN = { D: S, mode: st.mode, slots: wpSlots(), order: order || [], gims: [],
             base: S.base, gb: 0, gc: 0, show: { ex: 1, ns: 0, pv: 0 }, span: span || 240 };
  IN.cap = TE.capNow(IN);
  var sb = TE.startBonus(IN);
  IN.start = sb ? sb.amt : 0;
  IN._sb = sb;
  return IN;
}
export function simOf(order, span) {
  var IN = engIn(order, span);
  var sim = TE.simulate(IN);
  sim.IN = IN;
  return sim;
}
/** オーバーコストの渡し先。**選んでいなければ、そのバフの渡し先と同じ人。**
    ナギサ（水着）の EX は「味方1人」に会心ダメージとオーバーコストの両方を配るのに、
    渡し先の欄が別々になっていて、片方だけ選ぶと engine に `ov` が渡らず、
    オーバーコストが立たなかった（2026-09-03 の先生の指摘「水着ナギサの
    コストオーバー効いてなくてスキル打てないって言われる」）。
    **engine（`tools/tl-engine.js`）は直していない。**あちらの
    `ovWin` / `floorAt` は `ov` さえ渡れば正しく −5 まで沈める。
    **相手が 1 人に決まらないときは渡さない**（推測で決めない） */
export function ovOf(u) {
  if (u.ov != null) { return u.ov; }
  var p = st.party[u.i];
  if (!p || !TE.ovlMs(p)) { return null; }
  var to = buffTo(u);
  return to.length === 1 ? to[0] : null;
}
// 1 件を engine の order 行にする
export function ordRow(u, t) {
  return { i: u.i, t: t, to: u.to == null ? null : u.to, ov: ovOf(u),
           f: u.f == null ? null : u.f, bt: u.bt == null ? null : u.bt,
           // **1 発ごとに選んだ候補の段**（2026-09-04）。engine の `addCost` が
           // 「追加で最大 N コストを消耗して」の払う数として読む。
           // 無ければ枠の既定（`slots[].pk`）に落ちる
           pk: u.pk || null,
           // **engine は使わないが、画面が「渡し先」を引くのに要る**
           bto: u.bto == null ? null : u.bto,
           _ix: st.tl.indexOf(u) };
}
// コストが target に届く最初の時刻。**after より後ろだけ見る。**
// engine の segs は最後の EX で止まるので、そこから先は上限まで外挿する
export function costReach(sm, target, after, dur) {
  var g = sm.segs, i, a, b;
  for (i = 1; i < g.length; i++) {
    a = g[i - 1]; b = g[i];
    if (b.t <= after + 1e-9) { continue; }
    if (b.c >= target - 1e-9 && b.c > a.c) {
      var k = (target - a.c) / (b.c - a.c);
      return Math.max(after, a.t + (b.t - a.t) * k);
    }
    if (b.c >= target - 1e-9 && b.t > after) { return Math.max(after, b.t); }
  }
  var last = g[g.length - 1] || { t: 0, c: 0, r: 0 };
  var rate = sm.rate;
  if (last.c >= target - 1e-9) { return Math.max(after, last.t); }
  if (!(rate > 0) || target > sm.cap + 1e-9) { return null; }
  var tt = last.t + (target - last.c) / rate;
  return tt > dur ? null : Math.max(after, tt);
}
// **置いた 1 件ずつタイミングを決める。**「コストで指定」は、それより前の
// ぶんだけを走らせてコスト曲線を出し、届く時刻を読む（2026-09-01 の先生の指示）
export function orderOf() {
  var dur = diff().dur || 240, rows = tlSorted(), out = [], i, prev = -1;
  for (i = 0; i < rows.length; i++) {
    var u = rows[i], t = u.t;
    if (u.md === 'e') { t = null; }
    else if (u.md === 'c') {
      var got = costReach(simOf(out, dur), +u.cv || 0, prev, dur);
      t = got == null ? null : snapUp(got);
      u._rt = t;
    }
    if (t != null && t > prev) { prev = t; }
    out.push(ordRow(u, t));
    // **最速の行も「ここまで進んだ」に数える。**数えていないと、そのあとの
    // コスト指定が最速の行より前の時刻に解けて、順番が入れ替わる
    // （2026-09-01。先生の TL で最後の「②カンナ」が 75.8 秒に解けて、
    //  87.7 秒のネルより前に回っていた）
    var rr = simOf(out, dur).rows, last = rr[rr.length - 1];
    if (last && last.at != null && last.at > prev) { prev = last.at; }
    // **「最短」の行にも解けた時刻を残す**（2026-09-03 の 34。コスト指定だけに
    // 入れていたので、最短の行は時刻の欄が「—」のまま、並びも `u.t` のままだった）
    if (u.md === 'e' || u.md === 'c') {
      if (last && last.at != null) { u._rt = last.at; }
    }
  }
  return out;
}
// **「間に合いません」の理由を分ける。**コストが足りないのか、前の EX の
// 演出が終わっていないのか。実物の TL を写すと、詰まるのはほとんど後者だった
// （2026-09-01。総力戦の TL は「タップした時刻」で書かれているので、
//  演出を直列に積むこちらとは 1 発ごとにずれる）
// 置いた時刻に出せなかったとき、理由は 2 通り。
//   over … コストの上限を超えていて、どう待っても撃てない
//   cost … コストがまだ貯まっていない（待てば撃てる）
// **「前の EX の演出待ち」は無い**（2026-09-01 の先生の指摘
// 「コストさえあれば、EX は連続で発動できる／前の EX の演出を待つ必要はない」）。
// それまで engine が演出を全員ぶん直列に積んでいて、実物の TL を写すと
// 11 発中 8 発が後ろにずれていた
export function kindOf(row) {
  if (!row || !row.why) { return ''; }
  if (row.why.indexOf('上限') >= 0) { return 'over'; }
  // **同じ子が演出中で撃てない**（2026-09-01 に engine へ入れた枠ごとの待ち）
  if (row.why.indexOf('演出') >= 0) { return 'busy'; }
  return 'cost';
}
export function whyOf(row) {
  var k = kindOf(row);
  if (!k) { return ''; }
  if (k === 'over') { return 'コスト上限超え'; }
  return (k === 'busy' ? '演出中' : 'コスト不足') + ' \u2192 ' + TE.n1(row.at) + ' 秒';
}
export var _simC = null, _simK = '';
export function sim() {
  var dur = diff().dur || 240;
  var k = JSON.stringify([st.mode, st.pi, st.slots, st.tl, dur]);
  if (k !== _simK) { _simC = simOf(orderOf(), dur); _simK = k; clearMemo(); }
  return _simC;
}
export function recPower() { return Math.round(TE.pool(engIn([], 240)).total); }
