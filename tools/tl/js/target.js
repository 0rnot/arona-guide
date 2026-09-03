import { B, stu } from './util.js';
import { TE, isMain, memo, st } from './core.js';
import { boss } from './boss.js';
import { usesSorted } from './buff.js';
import { lvlOf } from './alt.js';
import { ssBuffUses } from './ep.js';

// ------------------------------------------------------------ 「味方1人」
// **何人に当たるかは説明文にしか無い。**`Effects[].Target` は `AllyMain` /
// `AllySupport` としか書いておらず、人数も「自分を含むか」も入っていない
// （2026-09-01 に `students.min.json` を直接見て確かめた）。builder が
// 説明文から `tgt[生徒][枠] = [人数, 自身を除く]` を作っている。
// **1 人だけのものは、渡す相手を選ばないと誰にも乗らない。**推測で配らない
export function tgtOf(id, kind) {
  var a = ((B.tgt || {})[id] || {})[kind];
  return a || null;
}
export function isSingle(id, kind) {
  var a = tgtOf(id, kind);
  return !!(a && a[0] === 1);
}
/** 「味方N人」の N。説明文に書いていなければ 0。 */
export function tgtN(id, kind) {
  var a = tgtOf(id, kind);
  return (a && a[0]) || 0;
}
/** 相手の指定を必ず配列にする。**1 人ぶんの数値でも入れられる**（古い保存） */
export function toList(v) {
  if (v == null) { return []; }
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var o = [], i;
    for (i = 0; i < v.length; i++) { if (v[i] != null && v[i] !== '') { o.push(+v[i]); } }
    return o;
  }
  return [+v];
}
/** その枠のスキルの、いま選んである相手。**必ず配列で返す。**
    「味方1人」は今までどおり、選ぶまで誰にも乗らない。
    **「味方2人」以上は、選んでいなければ今までどおり全員に乗る**
    （イブキ（水着）の「イブキのお友達！」が編成したストライカー 2 人まで、
    のように選べていなかった。2026-09-01 の先生の指摘） */
export function buffTo(u) {
  if (!u) { return []; }
  var sl = st.slots[u.i];
  if (u.k === 'Public' || u.k === 'GearPublic') { return toList(sl && sl.nsto); }
  // **EX でも、1 発ごとに決めていなければ枠の指定を使う。**
  // イブキ（水着）は `Ex` が「戦闘中ずっと」2 人を指定する作りで、
  // 1 発ごとではなく枠に持たせるほうが合う（2026-09-01）
  var per = toList(u.bto);
  return per.length ? per : toList(sl && sl.nsto);
}
// **相手の条件（`Restrictions`）を当てはめる。**中身は
// 「相手の Id / Size / BulletType / ArmorType / TacticRole がこうなら乗る」で、
// **どれも手元のデータで判定できる**（2026-09-01。それまで 30 件まるごと
// 飛ばしていて、イブキ（水着）の「アタッカーに会心ダメージ」も落ちていた）
export function propOf(to, r) {
  if (to === 'enemy') {
    var bs = (r && r.bs) || {};
    return { Id: null, Size: bs.size || null, BulletType: bs.bullet || null,
             ArmorType: bs.armor || null, TacticRole: null };
  }
  var p = st.party[+to.slice(4)];
  if (!p) { return null; }
  return { Id: p.id, Size: null, BulletType: p.bt, ArmorType: p.at, TacticRole: p.ro };
}
export function fits(rs, to, r) {
  if (!rs || !rs.length) { return true; }
  var pr = propOf(to, r);
  if (!pr) { return false; }
  for (var i = 0; i < rs.length; i++) {
    var q = rs[i], v = pr[q[0]], w = q[2], op = q[1], ok;
    // **分からない欄は「当たらない」。**推測で通さない
    if (v == null) { return false; }
    if (op === 'Equal') { ok = String(v) === String(w); }
    else if (op === 'NotEqual') { ok = String(v) !== String(w); }
    else if (op === 'Between') { ok = +v >= +w[0] && +v <= +w[1]; }
    else if (op === 'NotBetween') { ok = !(+v >= +w[0] && +v <= +w[1]); }
    else { return false; }
    if (!ok) { return false; }
  }
  return true;
}
// t 秒の時点で生きているバフ。to は 'ally<枠>' か 'enemy'
export function liveBuffs(t, to, r) {
  return memo('lb|' + t + '|' + to, function () { return liveBuffs0(t, to, r); });
}
export function liveBuffs0(t, to, r) {
  // **SS（`ExtraPassive`）の時限バフもここで乗せる**（2026-09-03）。
  // `ssBuffUses()` はバフ専用の擬似 use で、`usesSorted` には混ぜていない
  // （混ぜると `carry.js` / `clear.js` が SS のダメージを二重に数える）
  var us = usesSorted().concat(ssBuffUses()), out = [], i, q;
  for (i = 0; i < us.length; i++) {
    var u = us[i], p = st.party[u.i];
    if (!p) { continue; }
    var kd = u.k || 'Ex';
    var list = (B.buf[p.id] || {})[kd] || [];
    // **「味方1人」は選んだ相手だけ。**選んでいなければ誰にも乗らない。
    // **「味方2人」以上は、選んであればその人だけ**（選んでいなければ全員）
    var nT = tgtN(p.id, kd), pick = nT ? buffTo(u) : [];
    var limit = nT === 1 || (nT >= 2 && pick.length > 0);
    for (q = 0; q < list.length; q++) {
      var e = list[q], st0 = u.t + (e[5] || 0) / B.fps;
      // **固有武器パッシブの「効果時間延長」を掛ける**（味方向けは eb、
      // 敵向けは ed。2026-09-01 に足した）
      var tg0 = e[0] || [], sd0 = 'ally', z0;
      for (z0 = 0; z0 < tg0.length; z0++) { if (tg0[z0] === 'Enemy') { sd0 = 'enemy'; } }
      var wsl = st.slots[u.i] || {};
      var wlvl = (wsl.wstar >= 2 && wsl.wlv > 0) ? (wsl.plv || 0) : 0;
      var duMs = e[4] == null ? null
               : TE.extend(stu(p.id) || {}, { wp: wlvl }, e[4], sd0);
      var dur = duMs == null ? Infinity : duMs / 1000;
      if (t < st0 || t >= st0 + dur) { continue; }
      var tg = e[0] || [], hit = false, z;
      for (z = 0; z < tg.length; z++) {
        if (to === 'enemy') { if (tg[z] === 'Enemy') { hit = true; } continue; }
        var idx = +to.slice(4);
        if (tg[z] === 'Self' && u.i === idx) { hit = true; }
        if (tg[z] === 'AllyMain' && isMain(idx)) { hit = true; }
        if (tg[z] === 'AllySupport' && !isMain(idx)) { hit = true; }
      }
      if (hit && limit && tg.indexOf('Self') < 0 &&
          pick.indexOf(+to.slice(4)) < 0) { hit = false; }
      if (hit && !fits(e[6], to, r)) { hit = false; }
      if (!hit) { continue; }
      // **掛けた本人のスキルレベルで引く。**画面の共通スライダーではない
      var vals = e[3] || [], lv = Math.min(lvlOf(u.i, kd), vals.length) || 1;
      out.push({ slot: kd, ch: e[2], stat: e[1], v: vals[lv - 1] || 0, at: st0,
                 from: u.i, fromN: p.n, kind: kd });
    }
  }
  // 後掛け優先。同じ（枠, Channel）は遅く始まったほうを残す
  out.sort(function (a, b) { return b.at - a.at; });
  var seen = {}, keep = [];
  for (i = 0; i < out.length; i++) {
    var k = out[i].slot + '/' + out[i].ch;
    if (out[i].ch != null && seen[k]) { continue; }
    if (out[i].ch != null) { seen[k] = 1; }
    keep.push(out[i]);
  }
  return keep;
}
// ボスの実効ステータス。t 秒の時点で乗っているデバフを入れる
/** 当たる先。`tg` が null ならボス本体、数字なら `r.sub[tg]`（部位）。
    **部位は装甲も防御も別物**なので、ここで丸ごと差し替える
    （`DB/CharacterStatExcelTable.json` の部位の行。2026-09-01 に足した） */
export function aimOf(r, tg) {
  if (tg == null) { return r.bs || {}; }
  var x = (r.sub || [])[tg];
  return x || (r.bs || {});
}
export function aimName(r, tg) {
  if (tg == null) { return (boss() || {}).n || 'ボス'; }
  var x = (r.sub || [])[tg];
  if (!x) { return '？'; }
  // 討伐に要る池を持つ部位はそう書く（レンジャーは 5 体で 40,000,000 を共有）
  return x.n + (x.kill ? '・討伐対象' + (x.phn && x.cnt > 1 ? '（' + x.cnt + ' 体で HP 共有）' : '') : '');
}
/** **弱体状態の数で変わるギミック。**説明文の「弱体状態N～M個」だけを読む
    （2026-09-03）。データに数値の条件欄は無く、`gim` の `t` に日本語で書いてある。

      グレゴリオ  -DebuffCountGreen（弱体状態6～7個）：DamagedRatioを250%増加
      グレゴリオ  -DebuffCountYellow（弱体状態4～5個または8～9個）：DamagedRatioを100%増加/ATKを20%増加

    **人に置かせない。**弱体の数を数えているのは道具のほう（「デバフ数」のレーン）で、
    人が目で数えるより正確だから。27 通りのボスを数えて、この書き方が当たるのは
    グレゴリオだけだった（KAITEN FX Mk.0 の「この弱体状態効果は…解除されない」は
    数の条件ではないので当たらない）。**当てなかったせいで実測の 4 割しか出ていなかった**
    （`verify.py Q13QQfKEaeI` で 136.3 秒 実測 90.8% 対 道具 36.3%） */
export var GIMDEB = {};
export function gimDeb(r) {
  var key = r.cid, gl = r.gim || [], out = [], i, m;
  if (GIMDEB[key]) { return GIMDEB[key]; }
  for (i = 0; i < gl.length; i++) {
    var g = gl[i], tx = String(g.t || ''), rg = [];
    var re = /弱体状態\s*(\d+)\s*[～~〜]\s*(\d+)\s*個/g;
    while ((m = re.exec(tx))) { rg.push([+m[1], +m[2]]); }
    if (rg.length) { out.push({ k: g.k, v: g.v, rg: rg, n: g.n }); }
  }
  GIMDEB[key] = out;
  return out;
}
export function enemyAt(r, t, tg, gx) {
  var bs = aimOf(r, tg), m = {}, i;
  function set(k, v) { m[k] = [v || 0, 0, 1]; }
  set('DefensePower', bs.def); set('DodgePoint', bs.dodge);
  set('CriticalChanceResistPoint', bs.crR);
  set('CriticalDamageResistRate', bs.cdR);
  set('DamagedRatio', 10000); set('DamagedRatio2', 10000);
  var db = liveBuffs(t, 'enemy', r);
  for (i = 0; i < db.length; i++) {
    var q = String(db[i].stat).split('_'), k = q[0];
    if (!m[k]) { continue; }
    // **ケセドは「この効果以外の DamagedRatio の増加効果を無効化」**（剥き出しの玉座）。
    // 生徒の被ダメージ増加デバフはケセドに乗らない（`bs.dmgOnly`。2026-09-02）
    if (bs.dmgOnly && k === 'DamagedRatio') { continue; }
    if (q[1] === 'Coefficient') { m[k][2] += db[i].v / 10000; }
    else { m[k][1] += db[i].v; }
  }
  // **ボスの状態。**ギミックで変わるぶんを手で置いた窓（`st.bst`）。
  // 引き金（CC の累積・部位破壊・被弾回数・弱体の数）はボスごとに違って
  // データからは時刻を決められないので、**値はデータ・時刻は人**にしている
  // （2026-09-01）。`DamagedRatio` は「減らすほど食らう」向きなので、
  // 被ダメージ率 +N% は素の 10000 から N×100 を引く
  // （`(20000 − DamagedRatio) ÷ 10000`。SchaleDB `calculateDamage` 858 行）
  for (i = 0; i < (st.bst || []).length; i++) {
    var w = st.bst[i];
    if (t == null || t < w.t0 - 1e-9 || t >= w.t1) { continue; }
    // **その 1 発だけ外した窓は飛ばす**（EX の帯の「乗っているギミック」。2026-09-03）
    if (gx && gx.indexOf(i) >= 0) { continue; }
    if (w.k === 'damaged') { m.DamagedRatio[1] -= (w.v || 0) * 100; }
    else if (w.k === 'def') { m.DefensePower[2] += (w.v || 0) / 100; }
    else if (w.k === 'defAbs') { m.DefensePower[1] += (w.v || 0); }
    else if (w.k === 'crR') { m.CriticalChanceResistPoint[1] += (w.v || 0); }
    else if (w.k === 'cdR') { m.CriticalDamageResistRate[1] += (w.v || 0); }
  }
  // **弱体状態の数で決まるギミックは、道具が数えて自動で効かせる**（2026-09-03）。
  // 窓（`st.bst`）と違って時刻ではなく「いま何本かかっているか」で決まるので、
  // ここで `db.length` を見て当てる。**部位に当てた発（`tg`）には効かせない**——
  // ギミックはボス本体の被ダメージの話で、部位の被ダメージは別
  if (tg == null) {
    var gmD = gimDeb(r), gq, gz, gHit;
    for (gq = 0; gq < gmD.length; gq++) {
      gHit = false;
      for (gz = 0; gz < gmD[gq].rg.length; gz++) {
        if (db.length >= gmD[gq].rg[gz][0] && db.length <= gmD[gq].rg[gz][1]) { gHit = true; }
      }
      if (!gHit) { continue; }
      var gv = gmD[gq].v || 0;
      if (gmD[gq].k === 'damaged') { m.DamagedRatio[1] -= gv * 100; }
      else if (gmD[gq].k === 'def') { m.DefensePower[2] += gv / 100; }
      else if (gmD[gq].k === 'defAbs') { m.DefensePower[1] += gv; }
      else if (gmD[gq].k === 'crR') { m.CriticalChanceResistPoint[1] += gv; }
      else if (gmD[gq].k === 'cdR') { m.CriticalDamageResistRate[1] += gv; }
    }
  }
  function tot(k) {
    var v = m[k];
    if (!v) { return 0; }
    var r2 = Math.round(+(((v[0] + v[1]) * Math.max(v[2], 0.2)).toFixed(4)));
    return k === 'DamagedRatio' ? r2 : Math.max(r2, 0);
  }
  // **素の被ダメージ率。**`CharacterStatExcelTable` の `DamagedRatio` は ケセド 19000（＝ 0.1 倍）、
  // ホド 19000、ヒエロニムス 16000、ホバークラフト 17500、イェソド 19900 と 10000 でない
  // ボスがいる。**動画で確かめられたのはケセドだけ**（グロッキー外の通常攻撃が道具の 1/9、
  // 玉座の +900% で 1.0 倍に戻る。2026-09-02）。ホド・ヒエロニムス・イェソドは 1.0 倍の
  // 計算で実クリア TL と合っているので、素の値は **「この効果以外の増加効果を無効化」と
  // 書いてあるボス（`bs.dmgOnly`）だけ**に掛ける。他は不明のまま 1.0
  var dbase = (bs.dmgOnly && bs.damaged) ? (20000 - bs.damaged) / 10000 : 1;
  return { def: tot('DefensePower'), dodge: tot('DodgePoint'),
           crR: tot('CriticalChanceResistPoint'), cdR: tot('CriticalDamageResistRate'),
           damaged: tot('DamagedRatio'), damaged2: tot('DamagedRatio2'),
           dbase: dbase, armor: bs.armor, n: db.length };
}
