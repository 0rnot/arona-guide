import { B } from './util.js';
import { st } from './core.js';
import { aimOf, enemyAt } from './target.js';
import { diff } from './boss.js';
import { nsTimes } from './ns.js';

// ------------------------------------------------------------ サブスキル（SS）のダメージ
// **道具は長いあいだ `ExtraPassive` のダメージを 1 発も数えていなかった**
// （2026-09-03、先生の「ケイの SS のダメージ、換算されてないけど大丈夫？」から）。
// `B.dmg` には 40 人ぶん入っている。**SchaleDB の common.js も扱っていない**
// （`ExtraPassive` が 0 件）ので、写せる実装が無い。
//
// **引き金は `B.ep`**（`LevelSkill/<ExtraPassiveSkillGroupId>.json` の
// `TriggerCondition`）。NS の `AutoUseRule` は 40 人とも空で、周期では出ない。
//   [Event, Parameters, ConditionExpression, TriggerRate,
//    MaxTriggerCount, TryCount, CoolTimeNotTrigger, Duration, Modifiers]
//
// **条件は `Modifiers`**（`EntityTimeline[0].Entity.Abilities[].Modifiers[]`）。
// `ConditionExpression` は 40 人とも空で、`students.min.json` の `Condition` も
// `None` だった。**ここを開かずに「決まらない」と切り捨てないこと。**
export var EPEV = { 1: '常時', 2: '通常攻撃時', 3: 'スキル発動と同時', 11: '被弾',
             13: '会心', 15: '撃破時', 16: 'リロード時', 17: 'スキル使用時',
             18: '内部効果', 21: '攻撃時', 24: '条件つき', 105: 'N 秒毎',
             301: '状態条件つき常時' };
// **タグと装甲の番号は、説明文と突き合わせて確かめた**（2026-09-03）。
// 表が見つからないので、原文の並びから引いた。
//   [29, 67] 中型 ／ [26, 68] 大型 ／ [30, 69] 超大型 ／ [288] BOSS
//     「攻撃時、中型の敵に対して」ネル（バニーガール）・ヒナタ・コハル（水着）
//     「攻撃時、大型の敵に対して」ハスミ（体操服）
//     「攻撃時、大型と超大型の敵に対して」モエ（水着）＝[68, 69, 26, 30]
//     「BOSSへの攻撃時に」ワカモ＝[288]
//   ArmorType 0 軽装備 ／ 1 重装甲 ／ 2 特殊装甲
//     「防御タイプが軽装備の敵を攻撃時」「〜重装甲〜」「〜特殊装甲〜」の 3 通りが
//     そのまま 0 / 1 / 2 に並んでいた。**3（ElasticArmor）は実例が無いので入れない**
export var TAGSZ = { 29: 'Medium', 67: 'Medium', 26: 'Large', 68: 'Large',
              30: 'XLarge', 69: 'XLarge' };
export var TAGBOSS = 288;
export var ARMN = { 0: 'LightArmor', 1: 'HeavyArmor', 2: 'Unarmed' };
// **`Modifiers` はアビリティごとに分かれている**（2026-09-03）。
// 同じアビリティの中は「かつ」、別のアビリティどうしは「または」。
// レンゲは `Dummy_CH0224_Effect_Zeal`（`Public` 版）と
// `..._GearPublicZeal`（`GearPublic` 版）が別のアビリティに分かれていて、
// 平らにして「かつ」で読むと「両方立っているとき」になってしまう。
// **`dmg.ExtraPassive` はどの子も 1 行だけ**なので、または で読んでも二重には出ない。
/** 判定できる条件かどうか。**分かるものだけを通す。**
    返すのは条件の並び（`{k:…}` の配列）。知らない型が 1 つでもあれば
    `null` を返す（そのアビリティは読めない） */
export function epCond(id, ms) {
  var out = [], i, k;
  for (i = 0; i < (ms || []).length; i++) {
    var m = ms[i];
    // 「弱体状態の敵への攻撃時に」。**道具はこれを「デバフ数」レーンで既に数えている**
    if (m.t === 'LogicEffectCategoryModifierDAO' && m.LogicEffectCategory === 4 &&
        m.IncludeType === 1 && m.CheckTarget === 1) { out.push({ k: 'deb' }); continue; }
    if (m.t === 'TagConditionalModifierDAO' && m.IncludeType === 1 && m.CheckTarget === 1) {
      var tg = m.TagConstraintsInt || [], sz = {}, boss1 = false, bad = false;
      for (k = 0; k < tg.length; k++) {
        if (tg[k] === TAGBOSS) { boss1 = true; }
        else if (TAGSZ[tg[k]]) { sz[TAGSZ[tg[k]]] = 1; }
        else { bad = true; }
      }
      if (bad || (!boss1 && !Object.keys(sz).length)) { return null; }
      out.push(boss1 ? { k: 'boss' } : { k: 'size', v: sz });
      continue;
    }
    if (m.t === 'ArmorConditionModifierDAO' && m.IncludeType === 1 && m.CheckTarget === 1) {
      if (!ARMN[m.ArmorType]) { return null; }
      out.push({ k: 'armor', v: ARMN[m.ArmorType] });
      continue;
    }
    // 自前の札（`Dummy_*`）。**その子が自分のスキルで自分に貼る**ので、
    // 窓は「そのスキルを撃った時刻 〜 ＋持続」。札の出どころと持続は
    // `B.eptl`（`DB/LogicEffect_PC.json` を引いたもの）にある。
    //   [貼る側のスロット, 持続(ms), 必要なスタック数]
    // **`CheckTarget: 1`（敵に貼る札）は入れない。**どの体に貼ったかを
    // 道具は持っていない（マキ・ノノミ（水着）がこれ）。
    // **スタックが要るものも入れない**（レンゲ 50・ハレ（キャンプ）15）。
    if (m.t === 'LogicEffectTemplateModifierDAO' && m.IncludeType === 1 &&
        m.CheckTarget === 0) {
      var tp = ((B.eptl || {})[id] || {})[m.TemplateId];
      if (!tp || !(tp[1] > 0) || tp[2] ||
          (tp[0] !== 'Ex' && tp[0] !== 'Public' && tp[0] !== 'GearPublic')) {
        return null;
      }
      out.push({ k: 'tmpl', v: { slot: tp[0], du: tp[1] / 1000 } });
      continue;
    }
    return null;
  }
  return out;
}
/** アビリティごとに読んで、読めたものだけ返す。**1 つも読めなければ null** */
export function epConds(id, abs) {
  if (!abs || !abs.length) { return [[]]; }
  var out = [], i, g;
  for (i = 0; i < abs.length; i++) {
    g = epCond(id, abs[i]);
    if (g != null) { out.push(g); }
  }
  return out.length ? out : null;
}
/** その札が貼られている窓（開始時刻の並び）。編成に居ないときは空 */
function tmplAt(id, slot) {
  var i, idx = -1;
  for (i = 0; i < st.party.length; i++) {
    if (st.party[i] && st.party[i].id === id) { idx = i; break; }
  }
  if (idx < 0) { return []; }
  if (slot === 'Ex') {
    var out = [];
    for (i = 0; i < st.tl.length; i++) {
      if (st.tl[i].i === idx) { out.push(st.tl[i].t); }
    }
    return out;
  }
  return nsTimes(id, diff().dur || 240, idx);
}
/** 置けない理由。置けるなら null。**画面の「読み込み」の欄に出す** */
export function epWhy(id) {
  if (!((B.dmg[id] || {}).ExtraPassive || []).length) { return null; }
  var e = (B.ep || {})[id];
  if (!e) { return '引き金のデータがありません'; }
  if (e[0] !== 21 && e[0] !== 2) {
    return '引き金が ' + (EPEV[e[0]] || ('Event ' + e[0])) + ' です';
  }
  // `Parameters` が `Ex` / `Public` のものはスキルに相乗りする。通常攻撃では出ない
  if (e[1] && e[1] !== 'Normal') { return '引き金が ' + e[1] + ' に相乗りします'; }
  if (e[3] !== 10000) { return '発動が確率です（' + (e[3] / 100) + '%）'; }
  var rows = (B.dmg[id] || {}).ExtraPassive || [], i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i][10]) { return '倍率が ' + rows[i][10] + ' に比例します'; }
    if (rows[i][4]) { return '持続ダメージです'; }
  }
  if (epConds(id, e[8]) == null) {
    return '条件「' + (((e[8] || [])[0] || [])[0] || {}).t + '」を判定できません';
  }
  return null;
}
export function epOn(id) {
  return !!((B.dmg[id] || {}).ExtraPassive || []).length && epWhy(id) == null;
}
/** 何発に 1 度出るか。**`TryCount` がその数**（メルの `3` はスキル文の
    「通常攻撃3回毎に強化弾を発射し」と合う。`dmg` 側の `Block` も 3 で一致） */
export function epEvery(id) {
  var e = (B.ep || {})[id];
  return (e && e[5] > 1) ? e[5] : 1;
}
/** その時刻・その相手で条件が立っているか。`tg` は当たる先（null ならボス本体） */
export function epOkAt(id, r, t, tg) {
  var e = (B.ep || {})[id], cs = epConds(id, e && e[8]), i, j;
  if (cs == null) { return false; }
  // **アビリティどうしは「または」。**1 つでも全部立てば出る
  for (j = 0; j < cs.length; j++) {
    var c = cs[j], ok = true;
    for (i = 0; i < c.length && ok; i++) {
      var q = c[i];
      if (q.k === 'deb' && !(enemyAt(r, t).n > 0)) { ok = false; }
      // **BOSS のタグは本体だけ。**部位（柱・装置・ミニオン）には付いていないとみなす
      if (q.k === 'boss' && tg != null) { ok = false; }
      if (q.k === 'size' && !q.v[(aimOf(r, tg) || {}).size]) { ok = false; }
      if (q.k === 'armor' && (aimOf(r, tg) || {}).armor !== q.v) { ok = false; }
      if (q.k === 'tmpl') {
        var ws = tmplAt(id, q.v.slot), k, hit = false;
        for (k = 0; k < ws.length; k++) {
          if (t >= ws[k] - 1e-9 && t <= ws[k] + q.v.du + 1e-9) { hit = true; break; }
        }
        if (!hit) { ok = false; }
      }
    }
    if (ok) { return true; }
  }
  return false;
}
/** 置ける子の一覧（枠の番号）。編成に居るぶんだけ */
export function epSlots() {
  var out = [], i;
  for (i = 0; i < st.party.length; i++) {
    var p = st.party[i];
    if (p && epOn(p.id)) { out.push(i); }
  }
  return out;
}
