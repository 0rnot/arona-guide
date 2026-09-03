import { B } from './util.js';
import { st } from './core.js';
import { aimOf, enemyAt } from './target.js';

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
/** 判定できる条件かどうか。**分かるものだけを通す。**
    返すのは条件の並び（`{k:…}` の配列）。知らない型が 1 つでもあれば
    `null` を返して、その子は置かない */
export function epCond(ms) {
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
    return null;
  }
  return out;
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
  if (epCond(e[8]) == null) {
    return '条件「' + ((e[8] || [])[0] || {}).t + '」を判定できません';
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
  var e = (B.ep || {})[id], c = epCond(e && e[8]), i;
  if (c == null) { return false; }
  for (i = 0; i < c.length; i++) {
    var q = c[i];
    if (q.k === 'deb' && !(enemyAt(r, t).n > 0)) { return false; }
    // **BOSS のタグは本体だけ。**部位（柱・装置・ミニオン）には付いていないとみなす
    if (q.k === 'boss' && tg != null) { return false; }
    if (q.k === 'size' && !q.v[(aimOf(r, tg) || {}).size]) { return false; }
    if (q.k === 'armor' && (aimOf(r, tg) || {}).armor !== q.v) { return false; }
  }
  return true;
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
