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
/** そのスキルの候補が「段」だけで割れているなら、その段数。違えば 0。
    **段は撃った回数**で、スキルの説明文にそう書いてある（ネル（制服）の
    「怪我しても知らねえからな」は「1個獲得（最大5個まで重複）」「スキルが
    『かかって来いよ』に変更されると初期化されます」）。条件と混ざっている枠は
    自動で決めない（2026-09-01） */
export function danMax(id, kind) {
  var a = altOf(id, kind), i, n = 0;
  if (!a) { return 0; }
  for (i = 0; i < a.c.length; i++) { if (/段 \d/.test(a.c[i])) { n++; } }
  return (n && n === a.c.length) ? n : 0;
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
    if (dn && (!pk0 || pk0[kd0] == null) &&
        !(st.slots[sl0] && st.slots[sl0].pk && st.slots[sl0].pk[kd0] != null)) {
      pk0 = { };
      if (st.tl[i].pk) { for (k in st.tl[i].pk) { pk0[k] = st.tl[i].pk[k]; } }
      pk0[kd0] = Math.min(cnt[sl0], dn) - 1;
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
               gx: st.tl[i].gx || null });
  }
  var dur = diff().dur || 240;
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    var ts = nsTimes(p.id, dur, i), kd = nsKind(p.id);
    for (k = 0; k < ts.length; k++) { out.push({ i: i, t: ts[k], k: kd }); }
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
