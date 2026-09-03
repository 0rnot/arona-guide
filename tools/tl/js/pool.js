import { st } from './core.js';
import { boss } from './boss.js';
import { scen } from './scen.js';
import { carryIn, dmgCurve0, ggSolve } from './carry.js';
import { PICKF, setPICKF } from './dmg.js';

// ------------------------------------------------------------ 討伐の池
// **HP を 1 本持つ相手を「池」と呼ぶ。**ふつうはボス本体の 1 つだが、
// カイテンジャー（レンジャー 5 体で 40,000,000 を共有 → FX Mk.0 30,000,000）、
// シロ＆クロ、ワカモ前半 → ホバークラフト後半 は 2 つ。討伐は全部の池が 0。
// 出どころは `RaidStageExcelTable` の `BossCharacterId` の並び（`d[].korder`）と
// BT の `ConnectCharacterToDummy`（`sub[].pool` / `.phn`）。**順に出るか同時に
// いるかはデータに無い**ので、通常攻撃と NS は「並びの中で生きている最初の池」へ
// 向ける既定にして、EX の当たる先は使う人が置く（2026-09-02、plana の設計）
export function poolOrder(r) {
  var o = (r.korder || []).slice();
  if (o.indexOf(r.cid) < 0) { o.unshift(r.cid); }
  return o;
}
export function poolOf(r, tg) {
  if (tg == null) { return r.cid; }
  var sb = (r.sub || [])[tg];
  return sb && sb.pool ? sb.pool : null;
}
export function poolHp(r, pid) {
  if (pid === r.cid) { return (r.bs && r.bs.hp) || 0; }
  var i, sb = r.sub || [];
  for (i = 0; i < sb.length; i++) { if (sb[i].pool === pid) { return sb[i].phn || sb[i].hp || 0; } }
  return 0;
}
/** その池に属する部位の番号（`sub` の添字）。**当たる先を書いていない発を
    その池へ回すとき、ダメージはボス本体ではなく「その池の相手」で引く**
    （2026-09-03。それまでボス本体の装甲・防御・回避で引いていた。
    カイテンジャーは本体もレンジャーも軽装甲なので差が出なかったが、
    シロ＆クロやワカモ→ホバークラフトのように装甲が違う組は素通りで外れる）。
    同じ池に複数の部位がいるときは先頭を代表にする */
export function subIxOfPool(r, pid) {
  if (pid == null || pid === r.cid) { return null; }
  var sb = r.sub || [], i;
  for (i = 0; i < sb.length; i++) { if (sb[i].pool === pid) { return i; } }
  return null;
}
export function poolName(r, pid) {
  if (pid === r.cid) { return (boss() || {}).n || 'ボス'; }
  var i, sb = r.sub || [], ns = [];
  for (i = 0; i < sb.length; i++) { if (sb[i].pool === pid) { ns.push(sb[i].n); } }
  return ns.length > 1 ? ns[0] + ' ほか ' + ns.length + ' 体（HP 共有）' : (ns[0] || '？');
}
/** その時刻に通常攻撃・NS が向く池。並びの中で、前が全部死んでいて自分が生きている最初 */
export function naPool(r, t, deadAt) {
  var o = poolOrder(r), i;
  for (i = 0; i < o.length; i++) {
    var d = deadAt ? deadAt[o[i]] : null;
    if (d == null || t < d) { return o[i]; }
  }
  return null;
}
export function dmgCurveWith(r, sc, pid, deadAt) {
  var sv = PICKF;
  setPICKF(sc.pf);
  try { return dmgCurve0(r, sc.key, pid, deadAt); } finally { setPICKF(sv); }
}
export function valueAt(cv, t) {
  var v = 0, i;
  for (i = 0; i < cv.length; i++) { if (cv[i][0] <= t + 1e-9) { v = cv[i][1]; } else { break; } }
  return v;
}
/** 池を並びの順に解く。[{ pid, cv, kill, need, hp }]。`carry` は前の部隊が削ったぶん */
export function poolKills(r, carry) {
  var o = poolOrder(r), deadAt = {}, out = [], i, q, sc = scen(), dur = r.dur || 240;
  for (i = 0; i < o.length; i++) {
    var cv = dmgCurveWith(r, sc, o[i], deadAt);
    var hp1 = poolHp(r, o[i]), need = hp1 - ((carry || {})[o[i]] || 0), kill = null;
    if (need <= 0) { kill = 0; }
    else { for (q = 0; q < cv.length; q++) { if (cv[q][1] >= need) { kill = cv[q][0]; break; } } }
    if (kill != null && kill > dur) { kill = null; }
    deadAt[o[i]] = kill;
    out.push({ pid: o[i], cv: cv, kill: kill, need: need, hp: hp1 });
  }
  return out;
}
/** いまの部隊で、本体の池に入る累計。**フェーズ・グロッキー・描画が使う** */
export function dmgCurve(r) {
  ggSolve(r);
  if (poolOrder(r).length <= 1 && st.pi === 0) { return dmgCurveWith(r, scen(), r.cid, {}); }
  var pk = poolKills(r, carryIn(st.pi)), i;
  for (i = 0; i < pk.length; i++) { if (pk[i].pid === r.cid) { return pk[i].cv; } }
  return [];
}
