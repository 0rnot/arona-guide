import { B, S, rowVals } from './util.js';
import { MAIN_MAX, SLOTS, isMain, live, memo, mkSlot, slotOf, st } from './core.js';
import { diff } from './boss.js';
import { ENVI, SI, clamp, mkStats } from './stats.js';
import { fits, liveBuffs } from './target.js';

// ------------------------------------------------------------ 常時のパッシブ
// **効かせ方は SchaleDB の statpreview に合わせる**。
//   ・パッシブは常に効く（レベルは共通の 1 本で持つ）
//   ・固有武器パッシブは 固有武器★2 以上のときだけ
//   ・同じ（スキルの枠, Channel）が 2 回来たら**先に来たほうが勝つ**
//     （common.js 7723 行。あとから来たものは discount される）
//   ・ExtraPassive は SchaleDB の preview が触っていないので**乗せていない**
// **`ExtraPassive` がサブスキル（SS）**。SchaleDB の localization.min.json の
// `SkillType` がそう言っている（Ex=EXスキル / Public=ノーマルスキル /
// Passive=パッシブスキル / WeaponPassive=パッシブスキル＋ / ExtraPassive=サブスキル）
export var PASS = ['Passive', 'WeaponPassive', 'ExtraPassive'];
export function passiveList() {
  var out = [], i, k, q;
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    var sl0 = slotOf(i);
    var bk = B.buf[p.id];
    if (!bk) { continue; }
    for (k = 0; k < PASS.length; k++) {
      var slot = PASS[k];
      if (slot === 'WeaponPassive' && !(sl0.wstar >= 2 && sl0.wlv > 0)) { continue; }
      var list = bk[slot] || [];
      for (q = 0; q < list.length; q++) {
        var e = list[q];
        var rv = rowVals(e, (sl0.stk || {})[slot] || 0), vals = rv.v;
        // **持続時間があるものは常時ではない**（何かで発動する）。乗せない
        if (e[4] != null) { continue; }
        var mx = slot === 'ExtraPassive' ? sl0.sslv : sl0.plv;
        var lv = Math.min(mx, vals.length) || 1;
        out.push({ owner: i, slot: slot, tg: e[0] || [], stat: e[1],
                   ch: e[2], v: (vals[lv - 1] || 0) * rv.mul, rs: e[6] || null,
                   ov: e[7] || null });
      }
    }
  }
  return out;
}
// サブスキル（SS）の内訳。[常時 効いている本数, 発動して効く本数]
export function ssCount(idx) {
  var p = st.party[idx];
  if (!p) { return [0, 0]; }
  var list = (B.buf[p.id] || {}).ExtraPassive || [], on = 0, off = 0;
  for (var q = 0; q < list.length; q++) {
    if (list[q][4] == null) { on++; } else { off++; }
  }
  return [on, off];
}
// idx 番の枠に効く常時バフだけを取り出す
export function passiveFor(idx) {
  var all = passiveList(), out = [], i;
  var want = isMain(idx) ? 'AllyMain' : 'AllySupport';
  for (i = 0; i < all.length; i++) {
    var e = all[i], hit = false, q;
    // **常時パッシブも同じ**（`target.js` の `liveBuffs0` に根拠を書いた）。
    // サクラコ（アイドル）は「自分は ch 11・味方は ch 111」と対になっていて、
    // 今は本人に 2 本とも乗っていた
    var mine = e.owner === idx, alsoSelf = e.tg.indexOf('Self') >= 0;
    for (q = 0; q < e.tg.length; q++) {
      if (e.tg[q] === want && (!mine || alsoSelf)) { hit = true; }
      if (e.tg[q] === 'Self' && mine) { hit = true; }
    }
    if (!e.tg.length && e.owner === idx) { hit = true; }
    // **常時パッシブも条件を見る**（2026-09-03）。時限バフ側（`liveBuffs0`）は
    // 前から `fits()` を当てていたが、こちらは `Restrictions` を落としていた。
    // ナギサの「**爆発タイプの**味方の会心ダメージ率 +24.2%」が弾種に関係なく
    // 全員に乗っていて、ノゾミ（Sonic）の EX が 1.249 倍に膨らんでいた。
    // データ全体で 6 行（弾種 4・クラス 1・ほか）
    if (hit && !fits(e.rs, 'ally' + idx, diff())) { hit = false; }
    if (hit) { out.push(e); }
  }
  return out;
}
// **固有武器のレベル上限は星で決まる**（★1→Lv30、★2→40、★3→50、★4→60）。
// SchaleDB の `changeStatPreviewStars`（common.js 9269 行）が
// `let level = 20 + (weaponstars*10)` をスライダーの max にしている。
// 上限は `config.min.json` の `WeaponMaxLevel: 60`（Jp）と揃う。
// **2026-09-01 まで星に関係なく Lv50 で計算していました**（固有1 の子は
// 20 段ぶん過大、固有4 の子は 10 段ぶん過小）
export function wlvMax(ws) { return (ws || 0) > 0 ? 20 + (ws || 0) * 10 : 0; }
// 潜在能力。**枠は [HP, 攻撃, 治癒] の 3 本**で、古い保存は数値 1 つのことがある
export function potOf(b) {
  var v = b ? b.pot : null;
  if (v == null) { return [0, 0, 0]; }
  if (typeof v === 'number') { return [v, v, v]; }
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}
export function buildOpt(idx) {
  var b = (idx == null ? null : slotOf(idx)) || mkSlot();
  // **装備は 3 枠それぞれ段が違うことがある**（貼った TL の「t6/10/10」）。
  // 画面の選択は 1 つなので数値で入るが、読み込みからは配列で入る
  return { lv: b.lv, star: b.star, wlv: Math.min(b.wlv, wlvMax(b.wstar)),
           wstar: b.wstar || 0,
           eq: (b.eq && b.eq.length === 3) ? b.eq.slice() : [b.eq, b.eq, b.eq],
           gear: b.gear > 0, bond: b.bond, pot: potOf(b) };
}
export var _sc = {};
// **鍵は `JSON.stringify(o)` だった**（o には効いているバフが丸ごと入る）。
// 1 回の描き直しで 9 万回引くので、その文字列を作るだけで重かった（2026-09-03）。
// 覚えている答えは 編成・育成・置いた 1 発・ボス が変わったら捨てるので、
// 同じ (生徒, 枠, 時刻) なら中身も同じ
export function statsOf(id, idx, at) {
  return memo('sf|' + id + '|' + idx + '|' + at, function () {
    var o = buildOpt(idx);
    o.extra = idx == null ? [] : passiveFor(idx);
    if (idx != null && at != null) {
      o.extra = o.extra.concat(liveBuffs(at, 'ally' + idx, diff()));
    }
    return mkStats(id, o);
  });
}
export function sinf(id, key) {
  var a = B.sinfo[id];
  return a ? a[SI[key]] : null;
}
export var GRADE = ['D', 'C', 'B', 'A', 'S', 'SS'];
export function terrGrade(id, env, cs) {
  var k = ['StreetBattleAdaptation', 'OutdoorBattleAdaptation', 'IndoorBattleAdaptation'];
  var e = ENVI[env] == null ? 1 : ENVI[env];
  var g = sinf(id, k[e]) || 'D', i = GRADE.indexOf(g);
  if (i < 0) { i = 0; }
  // 固有武器は地形適性を上げる（SchaleDB の AdaptationType / AdaptationValue）
  if (cs && cs.adapt) { i += cs.adapt[['Street', 'Outdoor', 'Indoor'][e]] || 0; }
  return GRADE[clamp(i, 0, 5)];
}
export function terrMod(id, env, cs) {
  var g = B.ter[terrGrade(id, env, cs)];
  return g ? g[2] / 10000 : 1;
}
// **弱点のときだけ「◯◯特効増加」が乗る**（SchaleDB common.js 910 行の getEffectiveMod）。
// 爆発→軽装甲・貫通→重装甲・神秘→非武装・振動→弾力装甲 の 4 組だけ
export var ENH = { Explosion: 'LightArmor', Pierce: 'HeavyArmor',
            Mystic: 'Unarmed', Sonic: 'ElasticArmor' };
// **「◯◯特効増加」は特効の倍率に掛ける。足さない**（2026-09-05）。
// SchaleDB の getEffectiveMod は `effMod += EnhanceRate - 10000`（2.0 + 1.4327 = 3.4327）
// だが、先生の動画 GzfPSXaZKlU（ペロロジラ Torment 屋内、マコト（水着））の
// 1 発目（275.51%、単体）は 2 発目の発動で 149,312、3 発目で 528,565（会心）。
// 足し算だと非会心の上限が 107,383、会心の上限が 464,688 で、どちらも出ない。
// 掛け算（2.0 × 2.4327 = 4.865）なら 152,140 と 658,634 の中に入る（0.981 / 0.803）。
// 「攻撃、会心ダメ、特攻は全て乗算」という検証勢の記述とも合う
export function effMod(id, armor, cs) {
  if (armor === 'Structure') { return 1; }
  var bt = sinf(id, 'BulletType'), t = B.bam[bt], v = t && t[armor];
  var e = v ? v[0] : 10000;
  if (cs && ENH[bt] === armor) { e = e * cs.get('Enhance' + bt + 'Rate') / 10000; }
  return e / 10000;
}
// 支援値。SPECIAL（編成の 5・6 枠）の最終値に万分率を掛けて切り捨て、STRIKER に乗る。
// **元になるのはスキルのパッシブを乗せる前の値**（2026-09-01 に確かめた）。
// 貼った TL の見出しにある「支援値：HP13753　攻撃1143　防御58　治癒898」と、
// パッシブ抜きなら HP13667・攻撃1135・防御58・治癒893 で 4 つとも合う。
// パッシブ込みだと攻撃 1583・治癒 993 で、攻撃だけ 4 割ずれていた
export function support(stat, lv, r) {
  var f = (B.trans[r.ext || 'Base'] || B.trans.Base || {})[stat] || 0, sum = 0;
  for (var i = MAIN_MAX; i < SLOTS; i++) {
    if (!live(i)) { continue; }
    var p0 = st.party[i];
    if (!p0) { continue; }
    var o0 = buildOpt(i);
    o0.extra = [];
    var k0 = 'sup|' + p0.id + '|' + JSON.stringify(o0);
    if (!_sc[k0]) { _sc[k0] = mkStats(p0.id, o0); }
    var cs = _sc[k0];
    if (cs) { sum += Math.floor(cs.get(stat) * f / 10000); }
  }
  return sum;
}

// `_sc` は passive.js の持ち物。core.js の `bump()` から捨てるための窓口
export function clearStats() { _sc = {}; }
