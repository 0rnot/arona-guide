import { B } from './util.js';
import { st } from './core.js';
import { aimOf, enemyAt } from './target.js';
import { diff } from './boss.js';
import { nsTimes } from './ns.js';
import { naShotsRaw } from './na.js';

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
    // **「弱体の数が N 個のとき」。**上と同じ「デバフ数」レーンで数える（2026-09-04）。
    // ミサキ（10041）がこれで、5 つのアビリティが `CountMin` / `CountMax` だけ違う。原文:
    //   {"t":"CountListLogicEffectCategoryModifierDAO","CountMin":1,"CountMax":1,
    //    "IncludeType":1,"LogicEffectCategoryList":[4],"CheckTarget":1}
    //   …（`CountMin` 2/2・3/3・4/4 と続き、最後が `CountMin":5,"CountMax":-1`）
    // **`CountMax` の `-1` は「上限なし」。**`dmgalt` 側の候補も
    // `["段 1","段 2","段 3","段 4","段 5"]` で 5 つあり、並びが 1 対 1 で対応する
    if (m.t === 'CountListLogicEffectCategoryModifierDAO' && m.IncludeType === 1 &&
        m.CheckTarget === 1 && (m.LogicEffectCategoryList || []).length === 1 &&
        m.LogicEffectCategoryList[0] === 4 && m.CountMin > 0) {
      out.push({ k: 'debn', lo: m.CountMin,
                 hi: (m.CountMax == null || m.CountMax < 0) ? Infinity : m.CountMax });
      continue;
    }
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
    // **「自前の札が N 個のとき」**（2026-09-04）。上と同じ札で、数を見るだけ違う。
    // カズサ（バンド、10091）がこれで、原文は
    //   {"t":"CountLogicEffectTemplateModifierDAO","TemplateId":"Dummy_Melody_Check01",
    //    "CountMin":1,"CountMax":1,"IncludeType":1,"CheckTarget":0}
    //   {"t":"CountLogicEffectTemplateModifierDAO","TemplateId":"Dummy_Melody_Check01",
    //    "CountMin":2,"CountMax":999,"IncludeType":1,"CheckTarget":0}
    // `B.eptl[10091]` は `{"Dummy_Melody_Check01":["Ex",40000,2,null,null]}` ＝
    // **自分の EX を撃つたびに 1 個付き、40 秒で切れ、最大 2 個**。
    // 数え方は「その時刻に窓が開いている EX の本数」。上限（`tp[2]`）で頭を打つ。
    // **`CheckTarget: 1`（敵に貼る札）と、持続が無限（`tp[1] < 0`）のものは入れない**
    if (m.t === 'CountLogicEffectTemplateModifierDAO' && m.IncludeType === 1 &&
        m.CheckTarget === 0 && m.CountMin > 0) {
      var tn = ((B.eptl || {})[id] || {})[m.TemplateId];
      if (!tn || !(tn[1] > 0) ||
          (tn[0] !== 'Ex' && tn[0] !== 'Public' && tn[0] !== 'GearPublic')) {
        return null;
      }
      out.push({ k: 'tmpln',
                 v: { slot: tn[0], du: tn[1] / 1000, cap: tn[2] > 0 ? tn[2] : 0 },
                 lo: m.CountMin,
                 hi: (m.CountMax == null || m.CountMax < 0) ? Infinity : m.CountMax });
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
/** その時刻に窓が開いている札の数。**上限（`cap`）で頭を打つ** */
function tmplCount(id, v, t) {
  var ws = tmplAt(id, v.slot), k, n = 0;
  for (k = 0; k < ws.length; k++) {
    if (t >= ws[k] - 1e-9 && t <= ws[k] + v.du + 1e-9) { n++; }
  }
  return v.cap > 0 ? Math.min(n, v.cap) : n;
}
function inRange(n, lo, hi) { return n >= lo && n <= hi; }
/** 置けない理由。置けるなら null。**画面の「読み込み」の欄に出す** */
/** SS のダメージの行。**条件つきのぶん（`dmgalt`）も数える**（2026-09-03）。
    ノノミの「大型の敵に対して +12.8%」は `Condition` 付きなので `dmg` が空で、
    `epOn` が偽になり大型ボスでも 1 度も数えられていなかった */
function epRows(id) {
  var rows = ((B.dmg[id] || {}).ExtraPassive || []).slice();
  var a = ((B.dmgalt || {})[id] || {}).ExtraPassive, i;
  if (a && a.v) { for (i = 0; i < a.v.length; i++) { rows = rows.concat(a.v[i] || []); } }
  return rows;
}
export function epWhy(id) {
  if (!epRows(id).length) { return null; }
  var e = (B.ep || {})[id];
  if (!e) { return '引き金のデータがありません'; }
  if (e[0] !== 21 && e[0] !== 2) {
    return '引き金が ' + (EPEV[e[0]] || ('Event ' + e[0])) + ' です';
  }
  // `Parameters` が `Ex` / `Public` のものはスキルに相乗りする。通常攻撃では出ない
  if (e[1] && e[1] !== 'Normal') { return '引き金が ' + e[1] + ' に相乗りします'; }
  if (e[3] !== 10000) { return '発動が確率です（' + (e[3] / 100) + '%）'; }
  var rows = epRows(id), i;
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
  return !!epRows(id).length && epWhy(id) == null;
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
      if (q.k === 'debn') {
        var dn = enemyAt(r, t).n || 0;
        if (!(dn >= q.lo && dn <= q.hi)) { ok = false; }
      }
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
      if (q.k === 'tmpln') { if (!inRange(tmplCount(id, q.v, t), q.lo, q.hi)) { ok = false; } }
    }
    if (ok) { return true; }
  }
  return false;
}
/** **どのアビリティで立ったか。**`-1` は「1 つも立たない」（2026-09-04）。
    ミサキのように**アビリティの並びと `dmgalt` の候補の並びが 1 対 1 で対応する**
    子は、これがそのまま候補の番号になる。対応していない子には使わない
    （`epTierPick` が本数を見て判じる） */
export function epTierAt(id, r, t, tg) {
  var e = (B.ep || {})[id], cs = epConds(id, e && e[8]), i, j;
  if (cs == null) { return -1; }
  for (j = 0; j < cs.length; j++) {
    var c = cs[j], ok = true;
    for (i = 0; i < c.length && ok; i++) {
      var q = c[i];
      if (q.k === 'deb' && !(enemyAt(r, t).n > 0)) { ok = false; }
      if (q.k === 'debn') {
        var dn = enemyAt(r, t).n || 0;
        if (!(dn >= q.lo && dn <= q.hi)) { ok = false; }
      }
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
      if (q.k === 'tmpln') { if (!inRange(tmplCount(id, q.v, t), q.lo, q.hi)) { ok = false; } }
    }
    if (ok) { return j; }
  }
  return -1;
}
/** **その 1 発で使う候補の番号を `dmgOf` の `upk` の形で返す。**対応が取れないときは
    `null`（＝枠の既定のまま。今までどおり）。**渡していいのは、アビリティの本数と
    `dmgalt` の候補の本数が一致していて、かつ 2 本以上あるときだけ。**
    1 本しかない子に 0 を渡すと、先生が枠で選んだ候補を上書きしてしまう */
export function epTierPick(id, r, t, tg) {
  var e = (B.ep || {})[id], abs = (e && e[8]) || [];
  var a = ((B.dmgalt || {})[id] || {}).ExtraPassive;
  if (!a || !a.v || a.v.length < 2 || a.v.length !== abs.length) { return null; }
  var j = epTierAt(id, r, t, tg);
  return j < 0 ? null : { ExtraPassive: j };
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

// ------------------------------------------------------------ SS の時限バフ
// **`ExtraPassive` の時限バフは、長いあいだ誰にも乗っていなかった**（2026-09-03）。
// `passive.js` の `passiveList` は持続つき（`e[4] != null`）を外し、`liveBuffs0` が読む枠は
// `usesSorted0` が作る `Ex` / `ExN` / `Public` / `GearPublic` だけ。**どちらの経路にも
// 入らない穴に落ちていた。**全 274 人で 87 件（ケイの会心値 +22.3%、御坂美琴の攻撃力 +21.46%、
// ハナコ（水着）の +38.3% など）。
//
// **ここはバフ専用。**ダメージの側は `epOn` / `epOkAt` が別に見ているので、
// これを `usesSorted` に混ぜてはいけない（二重に数える）。
//
// **引き金が確定で読めるものだけ返す。**`Event` が 3（スキル発動と同時）か
// 17（スキル使用時）で、`TriggerRate` が 10000（100%）で、`Parameters` が
// `Ex` / `Public` / `GearPublic`（複数はカンマ区切り）のもの。79 人中 30 人。
// **確率つき（20%・30% など）と、Event 1・2・13・16・18・21・24・105 は入れない。**
export function ssBuffUses() {
  var out = [], i, j, k;
  for (i = 0; i < st.party.length; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    var list = (B.buf[p.id] || {}).ExtraPassive || [], timed = false;
    for (j = 0; j < list.length; j++) { if (list[j][4] != null) { timed = true; } }
    if (!timed) { continue; }
    var e = (B.ep || {})[p.id];
    if (!e || e[3] !== 10000) { continue; }
    var ts = [], bad = false, dur9 = diff().dur || 240;
    // **Event 2（通常攻撃時）と 21（攻撃時）は通常攻撃の並びに乗る。**
    // 条件つきのもの（`Modifiers` が空でない）は、当たる先で立ったり立たなかったり
    // するので入れない。`naShotsRaw` を使うのは輪を切るため（`na.js` の注記）
    if (e[0] === 2 || e[0] === 21) {
      var ab9 = e[8] || [];
      if (ab9.length !== 1 || (ab9[0] || []).length) { continue; }
      var sh9 = naShotsRaw(i, dur9);
      for (j = 0; j < sh9.length; j++) { ts.push(sh9[j].t); }
    } else if (e[0] === 3 || e[0] === 17) {
      var pr = String(e[1] || '').split(',');
      for (k = 0; k < pr.length; k++) {
        if (pr[k] === 'Ex') {
          for (j = 0; j < st.tl.length; j++) {
            if (st.tl[j].i === i) { ts.push(st.tl[j].t); }
          }
        } else if (pr[k] === 'Public' || pr[k] === 'GearPublic') {
          ts = ts.concat(nsTimes(p.id, dur9, i));
        } else { bad = true; }
      }
    } else { continue; }
    if (bad || !ts.length) { continue; }
    ts.sort(function (a, b) { return a - b; });
    // **`TryCount` は「N 回に 1 度」**（`epEvery`）。1 なら毎回
    var ev = epEvery(p.id);
    for (j = ev - 1; j < ts.length; j += ev) {
      out.push({ i: i, t: ts[j], k: 'ExtraPassive' });
    }
  }
  return out;
}
