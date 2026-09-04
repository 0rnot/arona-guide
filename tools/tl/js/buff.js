import { B } from './util.js';
import { SLOTS, memo, st } from './core.js';
import { diff } from './boss.js';
import { kindOf, sim } from './engine.js';
import { nsKind, nsTimes } from './ns.js';
import { altOf } from './alt.js';

// ------------------------------------------------------------ 時限のバフ・デバフ
// 置いた EX が掛けるバフは `ApplyFrame` ぶん遅れて始まり、`Duration`(ms) 続く。
// **同じ（スキルの枠, Channel）が重なったら後から掛けたほうが勝つ**
// （原則後掛け優先。Zenn 7228e2 のコラム）。常時のパッシブは先勝ちで、
// そちらは SchaleDB の扱いに合わせてある
// 置いた EX と、自動で回る NS を 1 本にまとめる（k で種類を分ける）
// **形態が変わる子は、撃つ形態でダメージもバフも別物。**engine が決めた形態
// （`fi`）で枠を選び、時刻も engine が出した「実際に出る時刻」を使う
export function exKind(fi) { return fi ? 'Ex' + fi : 'Ex'; }
/** そのスキルの候補が「撃った回数の段」で割れているなら、その段数。違えば 0。

    **段（`Group`）は撃った回数とは限らない**（2026-09-03 に説明文を全部読んで分かった）。
    マコトは「範囲内の敵の数」（4人以下／5人～9人／10人以上）、ミナは「対象の弱体状態の個数」、
    ミネ（アイドル）は「消耗したスタック」、ハスミ（体操服）・ミノリ・サツキは「払った追加コスト」。
    **撃った回数なのはトキだけ**（「EXスキル1回使用時／2回／3回」）。
    生成側（`build-tool-data.py` の `tl_group_labels`）が説明文の言葉を候補名にしてあるので、
    **「N 回使用」と書いてある枠だけ**自動で上げる。

    名前が拾えなかった枠は今までどおり「段 N」で、そちらは撃った回数として扱う
    （ネル（制服）の「1個獲得（最大5個まで重複）」がこれ）。 */
export function danMax(id, kind) {
  var a = altOf(id, kind), i, n = 0, m = 0;
  if (!a) { return 0; }
  for (i = 0; i < a.c.length; i++) {
    if (/段 \d/.test(a.c[i])) { n++; }
    if (/\d+\s*回使用/.test(a.c[i])) { m++; }
  }
  if (m && m === a.c.length) { return m; }
  return (n && n === a.c.length) ? n : 0;
}
/** 段が「範囲内の敵の数」で決まる枠なら、当たった数から段の番号（0 始まり）を出す。
    決められないなら null。**マコトの EX がこれ**（「4人以下 / 5人～9人 / 10人以上」）。
    道具は当たる数（`mc`）とボス本体に当たるか（`hb`）を持っているので、人に選ばせない。 */
export function danByCount(id, kind, n) {
  var a = altOf(id, kind), i, lo, hi, m;
  if (!a || !a.c.length || !(n > 0)) { return null; }
  var rng = [];
  for (i = 0; i < a.c.length; i++) {
    var t = String(a.c[i] || '');
    if ((m = t.match(/^(\d+)人以下$/))) { rng.push([0, +m[1]]); }
    else if ((m = t.match(/^(\d+)人[～~-](\d+)人$/))) { rng.push([+m[1], +m[2]]); }
    else if ((m = t.match(/^(\d+)人以上$/))) { rng.push([+m[1], 1e9]); }
    else { return null; }
  }
  for (i = 0; i < rng.length; i++) {
    lo = rng[i][0]; hi = rng[i][1];
    if (n >= lo && n <= hi) { return i; }
  }
  return null;
}
export function usesSorted() {
  sim();
  return memo('us', usesSorted0);
}
export function usesSorted0() {
  var out = [], i, k;
  var sm = sim(), rowOf = {};
  for (i = 0; i < sm.rows.length; i++) {
    if (sm.rows[i].e && sm.rows[i].e._ix != null) { rowOf[sm.rows[i].e._ix] = sm.rows[i]; }
  }
  // **段は「その形態で何発目か」。**形態が変わったら 1 に戻す
  var cnt = {}, lastK = {};
  for (i = 0; i < st.tl.length; i++) {
    var r0 = rowOf[i], sl0 = st.tl[i].i, kd0 = exKind(r0 ? r0.fi : 0);
    if (lastK[sl0] !== kd0) { cnt[sl0] = 0; lastK[sl0] = kd0; }
    cnt[sl0]++;
    var pk0 = st.tl[i].pk, p0 = st.party[sl0], dn = p0 ? danMax(p0.id, kd0) : 0;
    var free0 = (!pk0 || pk0[kd0] == null) &&
                !(st.slots[sl0] && st.slots[sl0].pk && st.slots[sl0].pk[kd0] != null);
    if (dn && free0) {
      pk0 = { };
      if (st.tl[i].pk) { for (k in st.tl[i].pk) { pk0[k] = st.tl[i].pk[k]; } }
      pk0[kd0] = Math.min(cnt[sl0], dn) - 1;
    } else if (free0 && p0) {
      // **段が「範囲内の敵の数」なら、当たる数から決める**（2026-09-03）
      var nHit = (st.tl[i].tg != null ? (st.tl[i].mc || 1) : 0) +
                 (st.tl[i].tg == null || st.tl[i].hb ? 1 : 0);
      var dc = danByCount(p0.id, kd0, nHit);
      if (dc != null) {
        pk0 = { };
        if (st.tl[i].pk) { for (k in st.tl[i].pk) { pk0[k] = st.tl[i].pk[k]; } }
        pk0[kd0] = dc;
      }
    }
    // **秒で書いてある行は、コスト待ちで後ろへ動かさない。**実物の TL の秒は
    // タップした時刻で、動画ではその秒に出ている。道具の計算でコストが足りなくても
    // 足りないのは道具側（回復力の取りこぼし）なので、書いてある秒に置いて、
    // 不足は読み込みの欄で知らせる（2026-09-02、大決戦ケセド QnKBiKMMUQE で
    // 6 発が 3〜9 秒後ろへずれて討伐時刻が合わなかった）
    var keepT = st.tl[i].md === 't' && r0 && r0.why && kindOf(r0) === 'cost';
    out.push({ i: sl0,
               t: (r0 && r0.at != null && !keepT) ? r0.at : st.tl[i].t,
               k: kd0, bto: st.tl[i].bto, pk: pk0,
               // **当たる先。**null ならボス本体
               tg: st.tl[i].tg == null ? null : st.tl[i].tg,
               // **何体に当たったか。**転移する部位に AoE で当てたときだけ効く
               mc: st.tl[i].mc == null ? 1 : st.tl[i].mc,
               // **部位を貫いてボス本体にも当たるか**（置くのは使う人）
               hb: st.tl[i].hb ? 1 : 0,
               // **この 1 発だけ外したボスの状態の窓**（`st.bst` の番号。2026-09-03）
               gx: st.tl[i].gx || null,
               // **盤で置いた位置**（2026-09-04）。`ax`/`ay` は狙う点、
               // `bp` は動かした体。`ix` は `st.tl` の番号（書き戻し先）
               ix: i, ax: st.tl[i].ax, ay: st.tl[i].ay, bp: st.tl[i].bp || null });
  }
  var dur = diff().dur || 240;
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    var ts = nsTimes(p.id, dur, i), kd = nsKind(p.id);
    // `no` はその子の NS が何発目か（1 始まり）。
    // **「ノーマルスキルの発動 N 回毎に」の行を間引くのに要る**（2026-09-03、ミカの隕石）
    for (k = 0; k < ts.length; k++) { out.push({ i: i, t: ts[k], k: kd, no: k + 1 }); }
  }
  return out.sort(function (a, b) { return a.t - b.t; });
}
// ステータスの日本語名（SchaleDB の localization の `Stat`）と、その増減の書き方
export function statJA(k) {
  var q = String(k).split('_');
  return (B.statJA || {})[q[0]] || q[0];
}
export function statAmt(k, v) {
  var q = String(k).split('_');
  if (q[1] === 'Coefficient') { return (v >= 0 ? '+' : '') + (v / 100).toFixed(1) + '%'; }
  return (v >= 0 ? '+' : '') + Math.round(v);
}
