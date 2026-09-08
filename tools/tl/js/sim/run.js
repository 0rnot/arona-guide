// ------------------------------------------------------------ 事象で 240 秒を回す核
/* **ここが「回す」層。**これまでの 4 つを繋ぐ。

     tree.js    木を歩いて「いつ・どの札が・どこへ」を出す
     effect.js  その札が何なのか（`LogicEffect_PC` / `_NPC` の行）
     cond.js    その瞬間に条件が立っているか
     state.js   盤の今（体・札・コスト）
     hit.js     一撃ぶんのダメージ（式は `dmg.js` の写し。24 万件で一致を確認済み）

   今の `tl-engine.js` は「曲線を足し上げる」作りで、**順番の依存を持てない**。
   ここは待ち行列で 1 つずつ処理するので、
   「札が 3 つ乗っているときだけ倍率が変わる」が素直に書ける。

   ## まだ入っていないもの（**憶測で埋めない**）

   - **盤の位置と移動。**当たる体の数は呼ぶ側が `mc` で渡す。第 2 段で入れる
   - **`Hits` の取り分**（ヒビキの愛用品の 10000/5500/1000/1000/1000）。
     いまは木が出す 1 事象 = 1 発として扱う
   - **手札とコストの引き当て。**EX を撃つ時刻は呼ぶ側（TL）が決める。
     コストが足りるかは `tl-engine.js` が既に見ているのでそちらに任せる
   - **ステータスの育ち**（星・装備・固有武器・絆・潜在）。呼ぶ側が `stats` で渡す
   - 敵の攻撃で味方が倒れること。ボスの札とフェーズは動かすが、味方は減らない

   ## 出すもの

     { hp: [[秒, 残り HP], …], total, killAt, used, unknown, log }

     `unknown` は**条件が判定できなかった回数**。ここが 0 でないうちは
     「再現できた」と言わない。
*/
import { skillEvents, summonsOf, resolveDev } from './tree.js';
import { readAll, atLevel, kindOfList, isDamage } from './effect.js';
import { all as condAll, mulOf, unknownOf, expr as condExpr } from './cond.js';
import { makeBoard, makeUnit, add, living, ctxOf, applyMark, expire, dispel, tickCost }
  from './state.js';
import { once as hitOnce, roll as hitRoll, capsOf } from './hit.js';
import { bossPlan, phaseWaits, driveBoss } from './boss.js';
import { boardPlan, spawnFor, originOf, slotPos, inArea, sortByRule,
         obstacleBoxes, coverRate, coverBox, coverPoints } from './board.js';

var FPS = 30;

/** **その瞬間のステータス。**素の値に、いま乗っている `stat` の札を畳む。

    畳み方は `js/stats.js:mkStats` と同じ:
      `_Coefficient` は係数へ足す（1 万分率）／`_Base` は固定値へ足す／
      `_BaseOuter` は係数を掛けたあとに足す（会心値だけ）。
      仕上げは `max(0, round((素 + 固定) × max(係数, 0.2)) + 別枠)`。

    敵の素の値は `CharacterStatExcelTable` の行そのままなので、
    `MaxHP100` のような 100 の欄と、`DefensePower1` / `DefensePower100` の
    両方があるときは 100 のほうを素として使う（敵はレベルで伸びない）。 */
export function statsNow(u) {
  var base = u.base || {}, acc = {}, i, k;
  function slot(name) {
    if (!acc[name]) {
      // **係数を畳む前の形から始める**（`grow.js` の `__raw`。2026-09-07）。
      // 装備の係数（帽子の攻撃 +50%）とバフの係数は同じ溜まりで足してから掛ける。
      // 畳んだ値に掛け直すと装備ぶんが 2 度掛かる（旧い道 `stats.js:mkStats` と同じ形に）
      var rw = base.__raw && base.__raw[name];
      acc[name] = rw ? rw.slice() : [pick(name), 0, 1, 0];
    }
    return acc[name];
  }
  // **素の行に無い「率」の欄は 0 ではなく 10000。**
  //
  // 2026-09-06 に踏んだ大穴。`EnhanceBasicsDamageRate` は生徒の素の行に無く、
  // 制服ネル（CH0280）のパッシブが `Coefficient`（掛け算）で触る。素を 0 と
  // 読むと `(0 + 0) × 倍率 = 0` になって、**通常攻撃のダメージが丸ごと 0** になる
  // （`hit.js:once` の `baM` が 0 になる）。21 発撃って与ダメージ 0 だった。
  // 率・割合・長さ・速さの欄は、素の行に無ければ 10000（＝ 1 倍）が既定
  function pick(name) {
    if (base[name] != null) { return base[name]; }
    if (base[name + '100'] != null) { return base[name + '100']; }
    // 末尾に番号が付くもの（`DamageRatio2`）まで含める
    if (/(Rate|Ratio|Duration|Speed)\d*$/.test(name)) { return 10000; }
    return 0;
  }
  for (i = 0; i < u.eff.length; i++) {
    var m = u.eff[i];
    if (m.kind !== 'stat' || !m.raw || !m.raw.stat) { continue; }
    var q = String(m.raw.stat).split('_'), amt = m.raw.amt || 0;
    var v = slot(q[0]);
    if (q[1] === 'Coefficient') { v[2] += amt / 10000; }
    else if (q[1] === 'BaseOuter') { v[3] += amt; }
    else { v[1] += amt; }
  }
  var out = {};
  for (k in base) { out[k] = base[k]; }
  for (k in acc) {
    var a = acc[k];
    out[k] = Math.max(0, Math.round((a[0] + a[1]) * Math.max(a[2], 0.2)) + a[3]);
  }
  // 既定が 10000 の欄（素の行に無いことがある）
  var DEF = ['DamageRatio', 'DamageRatio2', 'EnhanceExDamageRate', 'EnhanceBasicsDamageRate'];
  for (i = 0; i < DEF.length; i++) { if (out[DEF[i]] == null) { out[DEF[i]] = 10000; } }
  // **敵の素の行は `X1` / `X100` の 2 本立てで、素の名前を持っていない。**
  // ここを埋めるまで、ボスの `AttackPower` が `undefined` → 一撃が 0 になっていた
  // （2026-09-06。ボスは 32 発殴っていたのに味方が 1 人も減らなかった）。
  // 生徒の側は `grow.js` が素の名前で返すので、この輪は空回りする
  for (k in base) {
    if (k.length > 3 && k.slice(-3) === '100') {
      var bare = k.slice(0, -3);
      if (out[bare] == null && base[bare + '1'] != null) { out[bare] = base[k]; }
    }
  }
  return out;
}

/** `AutoUseRule` から通常スキルの周期（ms）。**`Interval` だけが周期で置ける。**
    `ConditionArgument` はフレーム（750 = 25 秒）。ほかの型は null（置かない） */
export function nsInterval(doc) {
  var r = doc && doc.AutoUseRule;
  if (!r || r.ConditionType !== 'Interval') { return null; }
  var f = r.ConditionArgument;
  if (f == null || !(+f > 0)) { return null; }
  return +f / FPS * 1000;
}

/** **通常スキルの自動発動の読み方。**`AutoUseRule.ConditionType` ごと。

    `Interval`     `ConditionArgument` がコマ（750 = 25 秒）。**周期**
    `OnAttackIng`  通常攻撃 `TryCount` 発ごと（CH0194 は 21 発ごと）。**回数**
    それ以外（`HpUnder` ほか）は盤の状態が要るので、まだ置けない。
      274 人ぶんの内訳は `_nsauto.mjs` が数える。

    返り値: `{kind: 'interval'|'shots', ms, shots, rate, max}` ／ 置けなければ null */
export function nsAuto(doc) {
  var r = doc && doc.AutoUseRule;
  if (!r || !r.IsValid) { return null; }
  var rate = r.TriggerRate == null ? 10000 : r.TriggerRate;
  var max = r.MaxTriggerCount == null ? -1 : r.MaxTriggerCount;
  if (r.ConditionType === 'Interval') {
    var f = r.ConditionArgument;
    if (f == null || !(+f > 0)) { return null; }
    // **`CoolTimeNotTrigger` は「使ってからこのコマ数は撃たない」。**`ConditionArgument` が
    // 1 コマの子（`CH0344Public01`: 1 / 900、`CH0302Public01`: 1 / 1200）はこちらが周期
    // （旧い道 `ns.js` と同じ読み方。最初の 1 発もその周期の満期）。
    // **`MaxTriggerCount` は戦闘中に撃てる回数**（-1 は無制限）。ヒナ（ドレス）
    // `CH0230Public01` は 1 コマ・1 回で、回数を見ずに周期として回すと、演出 4.5 秒の
    // 明けるたびに撃ち続けて、EX のタップまで演出待ちで 4 秒遅れていた（2026-09-07、pJGNXB2CqNc）
    var cool = r.CoolTimeNotTrigger == null ? 0 : +r.CoolTimeNotTrigger;
    return { kind: 'interval', ms: Math.max(+f, cool) / FPS * 1000, rate: rate, max: max };
  }
  if (r.ConditionType === 'OnAttackIng') {
    var n = r.TryCount == null ? 0 : +r.TryCount;
    if (!(n > 0)) { return null; }
    return { kind: 'shots', shots: n, rate: rate, max: max };
  }
  // **`RemoveLogicEffectTemplateId`: 自分に付いた札（`ConditionArgument` の TemplateId）が
  // 切れた瞬間に撃つ**（2026-09-07）。イブキ（水着）`CH0347Public01` がこれで、札は
  // 隠しパッシブが NS の発動と同時に貼る `Dummy_CH0347_HiddenPassive03_PublicDummy`
  // （`CH0347_HiddenPassive03_Effect01`、30,000 ms）。説明文は「「イブキのお友達！」
  // 使用後30秒毎に」。**札の長さを周期として置く**（長さは `setupAlly` が札の行から引く）。
  // `CH0347_HiddenPassive04_Effect01`（Event 17、25,000 ms）も同じ札を貼るが、
  // 「無いときだけ」（IncludeType 2）なので Event 3 の 30 秒が先に立って効かない
  if (r.ConditionType === 'RemoveLogicEffectTemplateId' && r.ConditionArgument) {
    return { kind: 'onRemove', tmpl: String(r.ConditionArgument), rate: rate, max: max };
  }
  return null;
}

/** **サブスキル（SS）の引き金。**`LevelSkill/<枠>.json` の `TriggerCondition`。

    `Event` の対応は `build-tool-data.py` が全生徒の記述文と突き合わせて確かめたもの:
      1=常時 ／ 2=通常攻撃時 ／ 3=スキル発動と同時 ／ 11=被弾 ／ 13=会心 ／
      15=撃破時 ／ 16=リロード時 ／ 17=スキル使用時 ／ 18=内部効果 ／ 21=攻撃時 ／
      105=N コマ毎 ／ 301=状態条件つき常時

    274 人の内訳（2026-09-06 に数えた）:
      1 が 118 人・21 が 56 人・3 が 19 人・17 が 18 人・301 が 15 人。
      残り 48 人は 24/2/18/16/13/15/105/302/23/30/7/8/11/12/19/37 に散る。

    ここで置けるのは **1・301（常時）／ 2・21（攻撃）／ 3・17（スキル）／
    105（周期）／ 16（リロード）** の 5 通り。**残りは盤の出来事が要るので置かない。**

    **2 と 21 の違いはデータから決まらない。**どちらも「通常攻撃 1 発ごと」として扱う
    （2 は 7 人、21 は 56 人）。決まったら分ける。 */
export function ssTrig(doc) {
  var t = doc && doc.TriggerCondition;
  if (!t) { return null; }
  var ev = +t.Event;
  var o = { ev: ev, param: t.Parameters || '', rate: t.TriggerRate == null ? 10000 : t.TriggerRate,
            max: doc.MaxTriggerCount == null ? -1 : doc.MaxTriggerCount,
            tries: doc.TryCount == null ? 1 : (+doc.TryCount || 1),
            cool: doc.CoolTimeNotTrigger ? (+doc.CoolTimeNotTrigger / FPS * 1000) : 0,
            when: null };
  if (ev === 1 || ev === 301) { o.when = 'always'; }
  else if (ev === 2 || ev === 21) { o.when = 'attack'; }
  else if (ev === 3 || ev === 17) { o.when = 'cast'; }
  else if (ev === 105) { o.when = 'every'; o.ms = (+o.param || 0) / FPS * 1000; }
  else if (ev === 16) { o.when = 'reload'; }
  // **30 = 札が貼られたとき**（`Parameters` がその札の GroupId。2026-09-07）。
  // ヒナ（ドレス）「想いをここに」は 起動の札 `CH0230_Ex01_Effect01` が付いた瞬間に
  // 特効 +63.51%（説明文「集中射撃体勢中」。剥がすのは `syncForm` が形態 0 に戻すとき）
  else if (ev === 30) { o.when = 'apply'; }
  return o;
}

/** **ボス・雑魚の常時札の引き金。**同じ `TriggerCondition` だが、生徒のサブスキルと
    出てくる `Event` の並びが違う（2026-09-06 に総力戦の束ぜんぶで数えた）:

      1536  1    常時
       859  301  状態条件つき常時（`ConditionExpression` を毎コマ見る）
       852  14   ／ 716  18 ／ 213  25 ／ 175  22 ／ 55  23 ／ 54  31 …
       343  105  N コマ毎

    **ここまで引き金を丸ごと見ずに、湧いた瞬間に全部撃っていた。**ゲブラのヒーターは
    `Passive05`（HP ≧ 70%）・`Passive06`（HP < 30%）・`Passive07`（30〜70%）の
    3 枚が同時に乗り、`Passive08` / `Passive09`（別の体が死んだとき）まで 0 秒に出ていた。

    置けるのは **1（常時）／ 301（条件つき常時）／ 105（周期）／ 14（自分が死んだとき）**
    の 4 通り。**残りは盤の出来事が要るので置かない**——0 秒に撃つより、
    撃たないほうが原文に近い。`null` を返したぶんは `R.miss['psEv:<番号>']` に数える。

    **`14` は「自分が死んだとき」**（2026-09-07 に足した）。束ぜんぶで 45 群あり、
    **どれも `Parameters` が空・`MaxTriggerCount: 1`・`TargetSide: Self`・
    `AliveState: 0`（死んだ体も可）**で揃っている。ケセドがこれで動く——
    雑魚 6 種がぜんぶ「死んだら `Debuff_AddGroggyGauge` を、
    味方のうち攻撃力がいちばん高い 1 体（＝ボス本体）へ」を持っていて、
    ボスの `GroggyGauge` 1,000,000,000 に対して
    `ChesedDroid` 22,727,300 ／ `ChesedGoliath` 16,529,000 ／
    `ChesedGuardTower` 42,355,400 を積む。満タンでグロッキーに入ると
    `ChesedInsanePassive01`（`Event 301`・`GetCurrentBehavior() == [BehaviorType.Groggy]`）が
    `DamagedRatio −9000` を自分に掛けて、**素の 19000（0.1 倍）が 10000（1.0 倍）に戻る。**
    これを置くまでケセドは 240 秒ずっと 0.1 倍で、残り 96% で終わっていた。

    **`18` は「その札が自分に付いたとき」**（2026-09-08 に足した）。`Parameters` が
    札の `LogicEffectTemplateId` で、`LevelSkill/` を数えると 112 本ある。中身は揃っていて、
    **`TriggerSourceFindRule.EssentialCandidate.TargetSide` が `Self` 108 本・
    `Ally` 2 本・`Ally_Except_Self` 2 本／`ConditionExpression` が付くのは 1 本だけ／
    `MaxTriggerCount` は −1 が 96 本・1 が 14 本・4 が 1 本・0 が 1 本。**
    置くのは `Self` の 108 本だけで、`Ally` 系 4 本は「誰に付いたか」を配る先が
    別の体なので置かない（今までどおり `R.miss['psEv:18']` に数える）。
    ホドの `HODGuardTower_*Passive01` / `HODTemporaryTowerExtraPassive01`〜`06` が
    これで動く。`R.onApply` から `R.fireApplied` を呼ぶ。

    まだ置けないもの: `22`（16 本）・`23`（`Parameters` が `CrowdControl`、19 本）・
    `25`（30 本）・`31`（19 本）。**`31` の `Parameters` も札の名前**で、
    `Buff_Shield` / `Debuff_DamageOverTime_Chill` / `EN0011_isGroggyDummy` /
    `EN0010_PhaseChange_Dummy` のように 18 と同じ形をしている（「別の体の名前＝
    その体が死んだら」と書いてあったのは読み違い。2026-09-08 に数え直した）。
    **18 と 31 のどちらが「付いたとき」でどちらが「消えたとき」かは、
    束から決められなかった**——両方に出る札は `Debuff_DamageOverTime_Chill` 1 つだけで、
    その 2 本（`Enemy_Damage_AddLogicEffectTemplate_Chill_PassiveSkill01` と
    `844Challenge01BehemothPanPanPassive03`）を読んでも向きが決まらない。
    18 の読みは記録に残っていたものをそのまま採り、31 は置かない。 */
function psTrig(doc) {
  var t = doc && doc.TriggerCondition;
  // 引き金の欄そのものが無い札は常時（雑魚の素の札にある）
  if (!t) { return { when: 'always', expr: '' }; }
  var ev = +t.Event, ex = String(t.ConditionExpression || '').trim();
  if (ev === 1) { return ex ? { when: 'cond', expr: ex } : { when: 'always', expr: '' }; }
  if (ev === 301) { return { when: 'cond', expr: ex }; }
  if (ev === 14) { return { when: 'dead', expr: ex }; }
  if (ev === 18) {
    var side18 = ((doc.TriggerSourceFindRule || {}).EssentialCandidate || {}).TargetSide;
    var tm18 = String(t.Parameters || '');
    if (side18 !== 'Self' || !tm18) { return null; }
    return { when: 'applied', tmpl: tm18, expr: ex,
             max: doc.MaxTriggerCount == null ? -1 : +doc.MaxTriggerCount };
  }
  if (ev === 105) {
    return { when: 'every', ms: (+t.Parameters || 0) / FPS * 1000, expr: ex };
  }
  return null;
}

/** 通常攻撃の刻み。**`AnimationFrames` は `[{Key, Frame}]` の配列**で、
    `AttackIngDuration` / `AttackEnterDuration` / `AttackBurstRoundOverDelay` /
    `AttackReloadDuration` が入っている（アルは 42 / 45 / 50 / 70）。

    **周期は `AttackIngDuration` 1 本**（`js/na.js` と同じ扱い）。
    `AttackStartDuration` と `AttackEndDuration` が 1 発ごとか弾倉ごとかは
    データから決められないので入れない。入れると 1 発 1.4 秒が 2.4 秒になる。

    弾倉は `AmmoCount ÷ AmmoCost`、撃ち切ったら
    `AttackBurstRoundOverDelay + AttackReloadDuration` 待つ。
    `spd` は `NormalAttackSpeed`（1 万分率）で、**フレーム数のほうを割る。** */
export function naInfo(doc, spd, ammo, cost) {
  if (!doc || !doc.AnimationFrames) { return null; }
  var fr = {}, i, a = doc.AnimationFrames;
  for (i = 0; i < a.length; i++) { fr[a[i].Key] = a[i].Frame; }
  var ing = fr.AttackIngDuration;
  if (!(ing > 0)) { return null; }
  var sp = (spd || 10000) / 10000;
  return {
    per: ing / FPS * 1000 / sp,
    ent: (fr.AttackEnterDuration || 0) / FPS * 1000 / sp,
    rel: ((fr.AttackBurstRoundOverDelay || 0) + (fr.AttackReloadDuration || 0)) / FPS * 1000 / sp,
    mag: Math.max(1, Math.floor((ammo || 1) / (cost || 1))),
  };
}

/** 待ち行列。**二分ヒープ。**同じ時刻なら入れた順（`PriorityWhenSameFrame` は第 5 段）。

    最初は毎回なめる作りだった（O(n²)）。1 戦 276 ms で、**1 万回まわすと 46 分**。
    ヒープにして 1 戦あたりの取り出しが log n になる。
    処理の途中で新しい事象が入る（技が技を呼ぶ）ので、
    並べ替えて添字で進める作りにはできない。 */
/** 式に使う定数。**`Excel/ConstCombatExcelTable` と
    `DB/CharacterLevelStatFactorExcelTable` を 1 つに。**後者は全 200 行で同じ値
    （`DefenceFactor 1000` / `AccuracyFactor 200` / `CriticalFactor 1000` /
    `StabilityFactor 1000`）なので、レベルでは引かず先頭の行を使う。 */
function constOf(common) {
  var C = {}, k, src = common.const || {}, lv = (common.lvstat || [])[0] || {};
  for (k in src) { C[k] = src[k]; }
  for (k in lv) { if (k !== 'Level') { C[k] = lv[k]; } }
  return C;
}

function queue() {
  var a = [], seq = 0;
  function less(x, y) { return x.t < y.t || (x.t === y.t && x.i < y.i); }
  function up(k) {
    while (k > 0) {
      var p = (k - 1) >> 1;
      if (!less(a[k], a[p])) { break; }
      var t = a[k]; a[k] = a[p]; a[p] = t; k = p;
    }
  }
  function down(k) {
    for (;;) {
      var l = k * 2 + 1, r = l + 1, m = k;
      if (l < a.length && less(a[l], a[m])) { m = l; }
      if (r < a.length && less(a[r], a[m])) { m = r; }
      if (m === k) { return; }
      var t = a[k]; a[k] = a[m]; a[m] = t; k = m;
    }
  }
  return {
    push: function (t, fn, tag) { a.push({ t: t, fn: fn, tag: tag, i: seq++ }); up(a.length - 1); },
    drain: function (until, guard) {
      var n = 0;
      while (a.length && a[0].t <= until) {
        var e = a[0], last = a.pop();
        if (a.length) { a[0] = last; down(0); }
        e.fn(e.t);
        n++;
        if (guard && n > guard) { return n; }
      }
      return n;
    },
    size: function () { return seq; },
  };
}

/** 木の 1 事象を実際に当てる。**返すのは入ったダメージ。** */
function fire(R, ev, caster, target, lvl, at, mc) {
  if (R.fireN) {
    var fk0 = caster.key + '/' + (ev.slot || '?');
    R.fireN[fk0] = (R.fireN[fk0] || 0) + 1;
  }
  var list = R.eff[ev.gid];
  if (!list) { R.miss[ev.gid] = (R.miss[ev.gid] || 0) + 1; return 0; }
  var r = atLevel(list, lvl);
  if (!r) { return 0; }

  // **レベルを名前に持つ群は、その子の段の 1 本だけ。**
  // 同じアビリティに `_Lv01` 〜 `_Lv10` が並ぶ（`tree.js:lvPickOf`）
  if (ev.lvPick) {
    var want = (caster.skillLv && ev.lvPick.slot)
      ? (caster.skillLv[ev.lvPick.slot] || 1) : 1;
    if (ev.lvPick.n !== want) { return 0; }
  }

  // ---- 条件。**`null`（判定できない）は数えて、当てない**
  if (ev.mods && ev.mods.length) {
    var ok = condAll(ev.mods, R.ctx, caster, target);
    if (ok == null) {
      R.unknown++;
      var u = unknownOf(ev.mods, R.ctx, caster, target);
      for (var q = 0; q < u.length; q++) {
        R.unknownBy[u[q]] = (R.unknownBy[u[q]] || 0) + 1;
      }
      return 0;
    }
    if (!ok) { return 0; }
  }
  var mul = ev.mods ? mulOf(ev.mods, R.ctx, caster, target) : 1;
  // **1 発の取り分**（`ShotFrames[].DamageDistributeRate`）。
  // CH0155 の通常攻撃は 7 発 × 14.28% で 1 周
  if (ev.share != null) { mul *= ev.share; }
  // **時系列の側の取り分**（`EntityTimeline[].DamageDistributeRate`）。
  // これが `data.js` の `Hits` の正体（2026-09-06）。ズンコの EX は同じ札が 4 回出て
  // 取り分がそれぞれ 2500 で、合わせて 1 発ぶん。**掛けていなくて 4 倍になっていた。**
  // 木は前から `dist` として運んでいたのに、ここで使っていなかった
  //
  // **かかるのは「量」の効果だけ。**欄の名前どおり `Damage` の取り分で、
  // ゲージ（グロッキー・EX）のような数え上げには掛けない（2026-09-07）。
  // ケセドの雑魚が死んで積む `Debuff_AddGroggyGauge` は
  // `ActionRelease` の取り分が `0` で、掛けると 227 が 0 になり、
  // **44 体倒してもグロッキーに入らなかった。**束ぜんぶで 0 と正の値が混ざる札は
  // 13,483 本中 8,108 本あり、そのうち 3,790 本は 0 の側にも体がある
  // （`BinahExSkill03` は `[0(体あり), 10000(体あり), 0(体なし)]`）ので、
  // 「0 は指定なし」と読むほうは採れない
  //
  // **回復と盾には掛けない**（2026-09-07）。回復・盾を運ぶ時系列の取り分は 97 本中 71 本が 0
  // （エイミの EX 回復・ホシノの NS が 0、ホシノのサブスキルは 10000）で、掛けると
  // 回復が 0 になる。イブキ（水着）`CH0295Public01` の回復（治癒力 10,220 × 103.9%）が
  // 0 で入っていて、ビナーで味方が回復なしに倒れていた
  var dist = (ev.dist != null && isDamage(r.kind)) ? ev.dist / 10000 : 1;

  // ---- 回復。**味方が生き延びるかはここで決まる。**
  // ボスが殴るようになるまで要らなかったので置いていなかった（2026-09-06）。
  // 焼き出しの道具は味方をそもそも持っていないので、ここに手本は無い。
  // 式は `LogicEffectData` の欄そのまま: 撃つ子の `BonusSource` の値 ×
  // `BonusRate` ÷ 10000。受け手の `HealEffectivenessRate` が掛かる
  // ---- 形態が変わる（`FormConversion`）。**枠がまるごと入れ替わる**
  //
  // `FormIndex` が新しい形態の番号で、`CharacterSkillListExcelTable` の
  // `FormIndex` の行に切り替わる。終わり方は `FormConversionEndCondition`——
  // **1 が時間**（`EndConditionArgument` ミリ秒。`-1` は戻らない）で 303 行中 218 行。
  //
  // **2（リロード）・3（装弾数）・5（EX の回数）も数える**（2026-09-08。それまでは
  // 「戻らない」扱いだった）。束ぜんぶで 61 行しか無く、持ち主は 7 人に決まっている:
  //
  //   2 リロード   Tsurugi_default（1 と 2）・CH0201（1）・CH0369（1）
  //   3 装弾数     CH0092（100）
  //   5 EX の回数  CH0187（3）・CH0285（1）・CH0356（1）
  //
  // 数え始めるのは札が貼られた瞬間で、`EndConditionArgument` に達したらその札を切る
  // （`m.until = now` → `expire` → `syncForm`）。**3 は「消費した弾数」と読む**——
  // CH0092 は `AmmoCount` 50・`AmmoCost` 5（1 弾倉 10 発）で、100 は 2 弾倉ぶん。
  // 発数と読むと 10 弾倉（100 発）になって、変身が戦闘の終わりまで続く。
  // `AddCurrentAmmo` で弾をもらう行はこの生徒には無い（束を数えた）
  if (r.kind === 'form') {
    if (target.side === 'ally' && R.syncForm) {
      var pp = R.partyOf(target);
      if (pp) {
        // **札として貼る**（2026-09-07）。Channel（16000）の押し出し・解除
        // （`Buff_Dispel_LogicEffectTemplate`）・時間切れが、ほかの札と同じ道を通る。
        // ヒナ（ドレス）は 起動（形態 1）→ 1 射目（2）→ 2 射目（3）→ 終演（解除で 0）で、
        // 各段が 10,500 ms。以前は時計を札と別に積んでいたので、起動の時計が 3 射目の
        // 途中で形態を 0 に戻し、終演の解除は読んでいなかった（pJGNXB2CqNc）
        var rf = Object.assign({}, r, { slot: ev.slot,
          dur: (r.endKind === 1 && r.endArg != null && r.endArg > 0) ? r.endArg : null });
        applyMark(target, rf, caster.key, at, lvl);
        if (R.onApply) { R.onApply(target, rf.tmpl, at, R.curCast); }
        if (target._fireSS) { target._fireSS(at, 'apply', rf.gid); }
        R.syncForm(target, at, false);
        if (rf.dur != null) {
          R.q.push(at + rf.dur, function (now) { R.syncForm(target, now, false); });
        }
        // 回数で終わる形態（2 / 3 / 5）。貼った札を控えて、数え終わったら切る
        if ((r.endKind === 2 || r.endKind === 3 || r.endKind === 5) &&
            r.endArg != null && r.endArg > 0 && R.formEndWatch) {
          R.formEndWatch(target, rf.gid, r.endKind, r.endArg, at);
        }
      }
    }
    // **敵の形態**（2026-09-07）。ホドは盤の `HODGroundEx02` が `FormConversion`（形態 1・
    // 戻らない）を貼り、形態 1 の枠は `HODInsaneNormal02` と本物の `HODEx03_Torment`。
    // 形態の札は貼っておき、`u.form` を `boss.js` が読む
    if (target.side === 'enemy') {
      var rf2 = Object.assign({}, r, { slot: ev.slot,
        dur: (r.endKind === 1 && r.endArg != null && r.endArg > 0) ? r.endArg : null });
      applyMark(target, rf2, caster.key, at, lvl);
      if (R.onApply) { R.onApply(target, rf2.tmpl, at, R.curCast); }
      var fi2 = r.formIndex != null ? r.formIndex : 1;
      target.form = fi2;
      if (R.onForm) { R.onForm(target, fi2, at); }
      if (rf2.dur != null) {
        R.q.push(at + rf2.dur, function (now) {
          var live2 = false, z2;
          for (z2 = 0; z2 < target.eff.length; z2++) {
            var m2 = target.eff[z2];
            if (m2.raw && m2.raw.kind === 'form' && (m2.until == null || m2.until > now + 1e-6)) { live2 = true; }
          }
          if (!live2 && target.form) { target.form = 0; if (R.onForm) { R.onForm(target, 0, now); } }
        });
      }
    }
    return 0;
  }
  // ---- 解除。**札の種類（TemplateId）・GroupId・区分（Category）で剥がす**（2026-09-07）。
  // `Dispellable` が偽の札は残る（`state.js:dispel`）。形態の札が剥がれたら形態も戻す
  if (r.kind === 'dispel' || r.kind === 'dispelGid' || r.kind === 'dispelCat') {
    var nd = 0, cz;
    if (r.kind === 'dispel') { nd = dispel(target, { tmpls: r.templates || [] }); }
    else if (r.kind === 'dispelGid') { nd = dispel(target, { gids: r.gids || [] }); }
    else if (r.cats && r.cats.length) {
      for (cz = 0; cz < r.cats.length; cz++) { nd += dispel(target, { cat: r.cats[cz] }); }
    } else { R.miss['dispel:区分なし'] = (R.miss['dispel:区分なし'] || 0) + 1; }
    if (nd > 0 && target.side === 'ally' && R.syncForm) { R.syncForm(target, at, true); }
    return 0;
  }
  // ---- 最大 HP を越える回復（`MaxHpOverHeal`）。溢れたぶんは仮の HP
  if (r.kind === 'overheal') {
    var os2 = statsNow(caster), or2 = statsNow(target);
    var oa = (os2[r.src || 'HealPower'] || 0) * (r.rate || 0) / 10000 * mul * dist;
    oa *= (or2.HealEffectivenessRate != null ? or2.HealEffectivenessRate : 10000) / 10000;
    if (target.hp > 0 && oa > 0) {
      var w2 = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + oa);
      R.heal += target.hp - w2;
      var over = oa - (target.hp - w2);
      if (over > 0) {
        var cap = target.maxHp * ((r.tmpLimit == null ? 5000 : r.tmpLimit) / 10000);
        var add = over * ((r.tmpRate == null ? 10000 : r.tmpRate) / 10000);
        target.shield = Math.min(cap, (target.shield || 0) + add);
      }
    }
    return 0;
  }
  if (r.kind === 'heal' || r.kind === 'hot') {
    var hs = statsNow(caster), rs = statsNow(target);
    var amt = (hs[r.src || 'HealPower'] || 0) * (r.rate || 0) / 10000 * mul * dist;
    amt *= (rs.HealEffectivenessRate != null ? rs.HealEffectivenessRate : 10000) / 10000;
    var ht = 1;
    if (r.kind === 'hot' && r.period && r.dur) {
      ht = Math.max(0, Math.min(Math.floor(r.dur / r.period),
                                Math.floor((R.durMs - at) / r.period)));
    }
    amt *= ht;
    if (R.probe) { R.probe.push(['heal', caster.key, target.key, Math.round(amt), Math.round(at), ev.gid, hs[r.src || 'HealPower'] || 0, r.rate]); }
    if (target.side === 'ally' && amt > 0 && R.byAlly) {
      var hk9 = 'heal:' + caster.key + '>' + target.key + ':' + ev.gid;
      R.byAlly[hk9] = (R.byAlly[hk9] || 0) + amt;
    }
    if (target.hp > 0 && amt > 0) {
      var was = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amt);
      R.heal += target.hp - was;
    }
    return 0;
  }
  // ---- ボスの EX ゲージ・グロッキーゲージ。**盤の状態そのもの**
  if (r.kind === 'atg') {
    target.atg = (target.atg || 0) + (r.amt || 0);
    if (R.onAtg) { R.onAtg(target, at); }
    return 0;
  }
  if (r.kind === 'groggy') {
    // **ゲージは 1 万分率で持つ。**満タンが 10000。
    // 吸って溜めるボス（ペロロジラ）は `CasterCoefficientAmount` がそのまま目盛りで、
    // 気絶した中サイズのペロロミニオンを何体吸ったかで
    // 0 / 834 / 1668 / 2502 / 3336 / 4170 / 5004 と段が変わる（6 体で 5004、2 回で満タン）。
    //
    // **`Amount` だけは絶対値で、目盛りは受ける側の `GroggyGauge`**
    // （2026-09-07）。ケセドの雑魚が死ぬと `Debuff_AddGroggyGauge` の
    // `Amount` 22,727,300 が積まれ、ボスの `GroggyGauge` 1,000,000,000 で満タン
    // ＝ 44 体。1 万分率に直してから足す。`CasterCoefficientAmount` の側とは
    // 物差しが違うので、ここで揃えないと 22,727,300 が 2,272 回ぶんになる
    var need0 = (target.base && target.base.GroggyGauge) || 0;
    var gv = (r.amt || 0) + (r.tamt || 0);
    if (r.flat && need0 > 0) { gv += r.flat / need0 * 10000; }
    gv *= mul;
    if (R.ggLog) { R.ggLog.push([Math.round(at / 100) / 10, r.gid, Math.round(gv), target.dev, need0]); }
    if (!target.ggImmune && gv > 0) {
      target.gg = (target.gg || 0) + gv;
      if (R.onGroggy) { R.onGroggy(target, at); }
    }
    return 0;
  }
  // ---- 被ダメージの転移。**受けたぶんを別の体へ流す札**
  if (r.kind === 'transfer') {
    applyMark(target, r, caster.key, at, lvl);
    if (R.onApply) { R.onApply(target, r.tmpl, at, R.curCast); }
    target.xfer = { ratio: r.ratio == null ? 10000 : r.ratio, to: caster.key };
    return 0;
  }
  // ---- 固定ダメージ（`DeadlyAttackEffectDAO`）。**`Amount` をそのまま引く。**
  // 防御も装甲も地形も通らないし、盾も食わない。ペロロの中サイズが HP 半分で
  // 撒く 250,000、ケセドの 999,999、ゴズの 99,999,999 がこれ（2026-09-07）
  if (r.kind === 'deadly') {
    var dq = (r.amt || 0) * mul;
    if (dq > 0 && target.hp > 0) {
      var dfl = 0, dz;
      for (dz = 0; dz < target.eff.length; dz++) {
        if (/Immortal/.test(String(target.eff[dz].tmpl || ''))) { dfl = 1; break; }
      }
      target.hp = Math.max(dfl, target.hp - dq);
      R.by[caster.key + '/固定'] = (R.by[caster.key + '/固定'] || 0) + dq;
      if (R.probe) { R.probe.push(['deadly', caster.key, target.key, Math.round(dq), Math.round(at), ev.gid]); }
      if (target.side === 'enemy') { R.total += dq; }
      if (R.onDamaged && target.side === 'enemy') { R.onDamaged(target, dq, at); }
    }
    return 0;
  }
  // ---- 即死（`ImmediateKillEffectDAO`）。`IgnoreImmortal` が真なら不死身も倒す
  if (r.kind === 'kill') {
    if (target.hp > 0) {
      var kfl = 0, kz;
      if (!r.ignoreImmortal) {
        for (kz = 0; kz < target.eff.length; kz++) {
          if (/Immortal/.test(String(target.eff[kz].tmpl || ''))) { kfl = 1; break; }
        }
      }
      if (target.side === 'enemy') { R.total += target.hp - kfl; }
      target.hp = kfl;
      if (R.killLog) { R.killLog.push([Math.round(at), caster.key, target.key, ev.gid, ev.slot || '?']); }
    }
    return 0;
  }
  if (r.kind === 'immune') {
    // **名指しの札は貼れない**（`ImmuneEffectDAO` の `TargetLogicEffectTemplateId00..`。
    // 名前は丸ごと一致。ケセドの `Debuff_StatChange_DamagedRatio` 無効は
    // 自分のグロッキー札 `Debuff_StatChange_DamagedRatio_Self` には効かない。2026-09-07）
    if (!target.immune) { target.immune = {}; }
    for (var zz = 0; zz < (r.tmpl || []).length; zz++) {
      if (String(r.tmpl[zz]).indexOf('Groggy') >= 0) { target.ggImmune = true; }
      if (r.tmpl[zz]) { target.immune[String(r.tmpl[zz])] = 1; }
    }
    return 0;
  }
  // ---- 盾。**受けたぶんを先に食う**（`CasterStatType` × `CasterCoefficientAmount`）
  if (r.kind === 'shield') {
    var ss = statsNow(caster);
    var sh = (ss[r.src || 'MaxHP'] || 0) * (r.rate || 0) / 10000 * mul * dist;
    if (sh > 0) { target.shield = (target.shield || 0) + sh; }
    if (R.probe) { R.probe.push(['shield', caster.key, target.key, Math.round(sh), Math.round(at), ev.gid, ss[r.src || 'MaxHP'] || 0, r.rate]); }
    if (target.side === 'ally' && sh > 0 && R.byAlly) {
      var sk9 = 'shield:' + caster.key + '>' + target.key + ':' + ev.gid;
      R.byAlly[sk9] = (R.byAlly[sk9] || 0) + sh;
    }
    return 0;
  }

  if (isDamage(r.kind)) {
    var a = R.attacker(caster, ev, at);
    var d = R.defender(target);
    // **地形と特効。**効果の欄が偽なら掛からない
    // （`ApplyTerrainAdaptationDamage` / `ApplyBulletType`）
    a.terr = (r.terr === false) ? 1 : R.terrOf(caster);
    a.eff = (r.bt === false) ? 1 : R.effOf(caster, target, statsNow(caster));
    var s = {
      scale: r.rate || 0, flat: r.flat || 0, mult: mul * dist, tick: 1,
      // **`DefensePenetrationRate: 10000` は「防御を全部貫く」ではなく、既定値。**
      // `10000 - pen` にしていて、**ほぼ全部の一撃が防御を素通りしていた**
      // （2026-09-06）。数えると `LogicEffect_PC` 5,753 行のうち 5,433 行、
      // `LogicEffect_NPC` 1,100 行のうち 1,083 行が 10000 で、
      // これを「貫通」と読むとゲームから防御という概念が消える。
      // 本当に貫くものは SchaleDB の `IgnoreDef` に出ていて **30 効果しかない**
      // （10025 の EX が段ごとに 7200/7200/6400/6400/5600 のように減る＝
      // 段が上がるほど貫く）。`dmg.js:defModOf` の `ig` は
      // 「**残る防御の割合**」なので、その値をそのまま渡す。
      // `ApplyDefense` が偽（あるいは欄ごと無い）ものだけが防御を引かない
      ig: (r.def === false) ? 0
        : ((r.pen != null && r.pen !== 10000) ? r.pen : null),
      isEx: ev.slot === 'Ex', isBasic: ev.slot === 'Normal',
      lvDiff: (caster.lv || 0) - (target.lv || 0),
      // **グロッキー中は会心が確定する。**ゲームの定数表には無い決めで、
      // 出どころはボス個別の攻略記事（kamigame / gamerch のクロカゲ）と、
      // 大決戦ビナー Torment の録画で実測が「平均」から「全会心平均」の線へ
      // 乗り換わること。`js/carry.js` の注記と同じものをそのまま持ってきている
      // **`CriticalCheck: 3` は必ず会心**（2026-09-07。24 行。イロハ（水着）の EX
      // `CH0346_Ex01_Effect01` がこれで、`SchaleDB` の "Always"）。1 は出ない、2 は判定
      crit: (r.crit === 3 || (target.groggyUntil != null && at < target.groggyUntil)) ? 1 : null,
      rate: r.rate2 != null ? r.rate2 : (list.applyRate != null ? list.applyRate : null),
      noCrit: r.crit === 1, noStab: r.stab === false,
    };
    // **継続ダメージは `Duration ÷ Period` 回**（戦闘の終わりで打ち切る）
    if (r.kind === 'dot' && r.period && r.dur) {
      s.tick = Math.max(0, Math.min(Math.floor(r.dur / r.period),
                                    Math.floor((R.durMs - at) / r.period)));
    }
    var o = hitOnce(a, d, s, R.C, R.lvTable, R.caps);
    var dmg = R.rnd ? hitRoll(o, R.rnd) : o.avg;
    // **当たる体の数を掛けるのは、ボス本体以外だけ。**
    // TL の `mc` は「範囲に入るミニオンの数」で、ボス本体に当たるかどうかは別の欄（`hb`）。
    // 盤がまだ無くてミニオンが湧かないので、ここで `mc` を掛けるとボスの HP が
    // **ミニオンぶんまで削れる**（2026-09-06。ペロロジラの答え合わせで、
    // 実測が時間切れの TL を核が 87 秒で討伐した）。第 2 段で盤が入ったら、
    // ミニオン 1 体 1 体を狙って当てるので、この掛け算自体が要らなくなる
    dmg *= (ev.single || target.kind === 'Boss') ? 1 : (mc != null ? mc : (R.mc || 1));
    // **遮蔽。**撃つ側と狙われる側のあいだに箱があると、その割合ぶん当たらない。
    // 帯を出す回（`R.rnd` がある）は 1 発ごとに振り、素の 1 回は割合で減らす
    // 物差し用: `o.god` で味方は削れない（生存だけを外して討伐秒を見る）
    if (R.god && target.side === 'ally') { dmg = 0; }
    // **遮蔽で止まるのは弾だけ**（`tree.js:blockable`。範囲は `CheckBlockHit` が真のときだけ）
    var cov = (ev.blk && R.coverOf) ? R.coverOf(caster, target) : 0;
    if (cov > 0) {
      R.miss['cover'] = (R.miss['cover'] || 0) + 1;
      // **止めた弾は遮蔽物へ流れる**（ItJustWorks の Block Rate。壊れる形は
      // 体力が尽きると消えて、陰に居た子は隠れ直す）
      var blocked = 0;
      if (R.rnd) { if (R.rnd() * 10000 < cov) { blocked = dmg; dmg = 0; } }
      else { blocked = dmg * cov / 10000; dmg -= blocked; }
      if (blocked > 0 && R.hitCover) { R.hitCover(caster, target, blocked, at); }
    }
    // **盾が先に食う。**残りだけが HP を削る
    if (target.shield > 0) {
      var eat = Math.min(target.shield, dmg);
      target.shield -= eat;
      dmg -= eat;
    }
    // **Immortal の体は倒れない。**中サイズのペロロミニオンがこれで、
    // 倒せてしまうとボスが吸うものが無くなってグロッキーが起きない
    // （`Dummy_Perorozilla_MiddleSize_Immortal`。2026-09-06）
    var floor = 0, zi;
    for (zi = 0; zi < target.eff.length; zi++) {
      if (/Immortal/.test(String(target.eff[zi].tmpl || ''))) { floor = 1; break; }
    }
    // **測定用の栓**（段階 0 の物差し）。`noBossDmg` のときは味方の HP を減らさない。
    // ゲームの規則ではなく、味方側の数を敵の干渉なしに測るための道具
    if (R.noBossDmg && target.side === 'ally') { dmg = 0; }
    // **当たった 1 発は 1 以上**（2026-09-07）。HP は整数で、ケセドが自分に撃つ
    // `Attack_Damage_Chesed`（素の量 10 × 被ダメージ 0.1 ＝ 1）が 0.9 に丸まると
    // `HPUnder 20,999,999 → ChangePhase 1` が立たず、段 0 の召喚（ドロイド）を 3 度繰り返していた
    if (dmg > 0 && dmg < 1) { dmg = 1; }
    target.hp = Math.max(floor, target.hp - dmg);
    R.total += dmg;
    if (R.onDamaged && target.side === 'enemy') { R.onDamaged(target, dmg, at); }
    // **ダメージの札の名前もボスの木へ**（`ApplyLogicEffectTemplateId`。ケセドは自分の
    // EX01 の `Attack_Damage_Chesed` が当たった瞬間に段を移す）
    if (R.onApply && r.tmpl) { R.onApply(target, r.tmpl, at, R.curCast); }
    // **1 発ごとの中身。**核が伸びないときに、どの掛け算が小さいかを外から見るため
    if (R.probe) {
      R.probe.push([Math.round(dmg), caster.key, ev.slot || '?', ev.gid,
                    Math.round(at), s.scale, +(mul * dist).toFixed(4), Math.round(a.atk),
                    +(o.avg / Math.max(1, a.atk)).toFixed(3), s.tick, ev.dist, ev.share,
                    target.key, Math.round(target.hp),
                    // **掛け算の中身**（核が伸びないときに、どれが 0 かを見る）
                    { eff: a.eff, terr: a.terr, hit: +o.hit.toFixed(3),
                      rate: +o.rate.toFixed(3), crit: +o.crit.toFixed(3),
                      cdm: o.cdm == null ? null : +o.cdm.toFixed(4), cap: o.caps == null ? null : o.caps,
                      sMin: +o.sMin.toFixed(3), base: Math.round(o.base),
                      p: o.parts }]);
    }
    // **受けたぶんを本体へ流す。**ペロロミニオンは Immortal で 100% を転移する。
    // 流した先の HP を削るのはここだけで、`by` には転移として別に立てる
    if (target.xfer && R.unitOf) {
      var host = R.unitOf(target.xfer.to);
      if (host && host !== target && host.alive) {
        var xd = dmg * (target.xfer.ratio / 10000);
        host.hp = Math.max(0, host.hp - xd);
        R.by[caster.key + '/転移'] = (R.by[caster.key + '/転移'] || 0) + xd;
      }
    }
    // **どこから出たダメージか。**核の穴を探すのに要る（合計だけ見ても分からない）
    var bk = caster.key + '/' + (ev.slot || '?');
    R.by[bk] = (R.by[bk] || 0) + dmg;
    // **味方が受けたぶん**（誰の何で削られたか。倒れる理由を外から見る）
    if (target.side === 'ally' && R.byAlly) {
      var bk2 = bk + '>' + target.key + ':' + ev.gid;
      R.byAlly[bk2] = (R.byAlly[bk2] || 0) + dmg;
    }
    return dmg;
  }

  // ---- ダメージ以外は札として盤に置く。**確率はここで振る**
  if (r.rate != null && r.kind !== 'stat' && R.rnd && r.rate < 10000 &&
      r.kind !== 'dmg' && R.rnd() * 10000 >= r.rate) { return 0; }
  // **持続時間の延長。**撃つ側の `ExtendBuffDuration`（味方に貼る札）／
  // `ExtendDebuffDuration`（敵に貼る札）を掛ける。出どころは固有武器の
  // `WeaponPassive`（StatType 46 / 47）。旧い道の `TE.extend` と同じく
  // ミリ秒で丸める（15000 × 1.19 が 17849.999… にならないように）
  // 札に撃った枠を載せる（`state.js:applyMark` の Channel 押し出しが枠を見る）
  var r9 = Object.assign({}, r, { slot: ev.slot });
  if (r.dur != null && r.dur > 0 && caster && caster !== target) {
    var cs9 = statsNow(caster);
    // `statsNow` の率系は素が 10000（＝ ×1.0）。固有武器 Lv10 なら 11900 ＝ ×1.19
    var ext9 = (target.side === caster.side) ? (cs9.ExtendBuffDuration || 0) : (cs9.ExtendDebuffDuration || 0);
    if (ext9 > 0 && ext9 !== 10000) {
      r9 = Object.assign({}, r9, { dur: Math.round(r.dur * (ext9 / 10000)) });
    }
  }
  if (target.immune && r9.tmpl && target.immune[String(r9.tmpl)]) {
    R.miss['immune:' + r9.tmpl] = (R.miss['immune:' + r9.tmpl] || 0) + 1;
    return 0;
  }
  applyMark(target, r9, caster.key, at, lvl);
  // **札の名前をボスの木へ**（`ApplyLogicEffectTemplateId`。ホドは仮設タワーが死んで
  // 自分に貼る `Dummy_HOD_TemporaryDeadChangePhase01` で段が進む。2026-09-07）
  if (R.onApply) { R.onApply(target, r9.tmpl, at, R.curCast); }
  // **札が貼られたら撃つサブスキル**（`TriggerCondition.Event 30`。`ssTrig` の注記）
  if (target._fireSS) { target._fireSS(at, 'apply', r9.gid); }
  // **札が切れたら撃つ通常スキルの見張り**（`setupAlly` の `_nsWatch`）。
  // 貼った札の「切れる時刻」に、同じ札が生きていなければ撃つ。
  // 貼り直し（同じ札の延長）は新しい切れる時刻で積み直すので、古い見張りは空振りする
  if (target._nsWatch && r9.tmpl && target._nsWatch[r9.tmpl] && r9.dur > 0) {
    // **見張るのは「いま貼ったその札」が時間切れになる瞬間**（2026-09-07）。
    // 同じ Channel の札に押し出された札の見張りは空振りにする。「切れる時刻にその札が
    // 無ければ撃つ」だと、押し出された古い札の見張りが、NS の直後（隠しパッシブが
    // 貼り直すまでの 0.9 秒）に空を見て NS をもう 1 発撃っていた——イロハ（水着）の
    // NS が 35.0 秒の次に 40.9 秒（演出明け）にも出て、EX のタップが 46.7 秒まで遅れた
    var mk9 = null, zk9;
    for (zk9 = target.eff.length - 1; zk9 >= 0; zk9--) {
      if (target.eff[zk9].gid === r9.gid && Math.abs(target.eff[zk9].at - at) < 1e-6) { mk9 = target.eff[zk9]; break; }
    }
    (function (tg9, un9, tm9, m0) {
      R.q.push(un9, function (now) {
        var z9, live9 = false, here9 = false;
        for (z9 = 0; z9 < tg9.eff.length; z9++) {
          if (tg9.eff[z9] === m0) { here9 = true; break; }
        }
        // 押し出されていた（もう盤に無い）か、貼り直されて切れる時刻が延びた札は見ない
        if (!here9 || m0 == null || m0.until == null || m0.until > now + 1e-6) { return; }
        // 切れた札を先に落とす。落とさないと、撃った NS と同時に貼り直す隠しパッシブの
        // 「札が無いときだけ」（`CountLogicEffectTemplate` IncludeType 2）が古い札を数える
        expire(tg9, now);
        for (z9 = 0; z9 < tg9.eff.length; z9++) {
          var m9 = tg9.eff[z9];
          if (m9.tmpl === tm9 && (m9.until == null || m9.until > now + 1e-6)) { live9 = true; break; }
        }
        if (!live9 && tg9._nsWatch && tg9._nsWatch[tm9]) { tg9._nsWatch[tm9](now); }
      });
    })(target, at + r9.dur, r9.tmpl, mk9);
  }
  return 0;
}

/** **湧く条件 1 つ**（`EntityTimeline[].SpawnCondition`。2026-09-07）。
    `chk` が `Caster` なら撃つ側、`Target` なら狙った先で見る。
    束ぜんぶで: None 12,700 ／ IncludeLogicEffectTemplateId 9,000（札を持っていたら）／
    IncludeTag 2,600（ボスの札）／ Rate 1,100（確率）／ IncludeArmorType 144 ／
    ExcludeLogicEffectTemplateId 76 ／ TargetSideId 4 ／ UsedExtraSkillCost… 2 ／ HPRateUnder 1。
    ここが無いあいだ、条件つきの体が**全部**湧いていた（イロハ（水着）のサブスキルは
    相棒向け／自分向けの札を両方貼り、同じ Channel の後勝ちで自分向けだけが残っていた） */
function spawnCondOk(R, c, u, target, phase) {
  var chk = c.chk || 'Caster';
  if ((chk === 'Target') !== (phase === 'target')) { return null; }
  var who = (chk === 'Target') ? target : u, cond = c.cond || 'None', prm = c.param;
  if (cond === 'None') { return true; }
  if (cond === 'Rate') {
    var r = +prm || 0;
    if (r >= 10000) { return true; }
    if (r <= 0) { return false; }
    return R.rnd ? (R.rnd() * 10000 < r) : (r >= 5000);
  }
  if (cond === 'IncludeLogicEffectTemplateId' || cond === 'ExcludeLogicEffectTemplateId') {
    var has = false, z;
    for (z = 0; who && z < who.eff.length; z++) {
      var m = who.eff[z];
      if (m.tmpl === prm && (m.until == null || m.until > R.now + 1e-6)) { has = true; break; }
    }
    return cond === 'IncludeLogicEffectTemplateId' ? has : !has;
  }
  if (cond === 'IncludeTag' || cond === 'ExcludeTag') {
    var tg = c.tag || prm, tags = (who && who.tags) || {}, known = false, tk;
    for (tk in tags) { if (Object.prototype.hasOwnProperty.call(tags, tk)) { known = true; break; } }
    // 札（Tag）を持たない体の条件は読めない。止めずに数える
    if (!known) { R.miss['sc:tag?'] = (R.miss['sc:tag?'] || 0) + 1; return true; }
    return cond === 'IncludeTag' ? !!tags[tg] : !tags[tg];
  }
  if (cond === 'IncludeArmorType') { return !!who && who.armor === prm; }
  if (cond === 'ExcludeArmorType') { return !!who && who.armor !== prm; }
  if (cond === 'TargetSideId') {
    return !!who && ((who.side !== u.side) ? 'Enemy' : 'Player') === prm;
  }
  if (cond === 'HPRateUnder' || cond === 'HPRateOver') {
    if (!who || !(who.maxHp > 0)) { return false; }
    var hr = who.hp / who.maxHp * 10000;
    return cond === 'HPRateUnder' ? hr < (+prm || 0) : hr > (+prm || 0);
  }
  R.miss['sc:' + cond] = (R.miss['sc:' + cond] || 0) + 1;
  return true;
}

/** 事象の湧く条件の列（入れ子の湧かせ手ぶん）。`SpawnOnlyOne` は**順に見て最初に
    通った 1 つだけ**（同じ発の同じ群では 1 回だけ決める。`R.scPick`）、
    `SpawnOnlyOnePerFrame` はコマごとに 1 つ、`SpawnAll` は条件の通ったものぜんぶ */
function spawnOk(R, list, u, target, castId, phase) {
  var i, c, k, e, ok, key, chosen, needT;
  for (i = 0; i < list.length; i++) {
    c = list[i];
    if (c.rule === 'SpawnAll') {
      ok = spawnCondOk(R, c, u, target, phase);
      if (ok === false) { return false; }
      continue;
    }
    needT = false;
    for (k = 0; k < c.ents.length; k++) { if ((c.ents[k].chk || 'Caster') === 'Target') { needT = true; } }
    if (needT !== (phase === 'target')) { continue; }
    key = castId + '/' + c.grp + (c.rule === 'SpawnOnlyOnePerFrame' ? '/' + c.f : '') +
          (needT ? '/' + target.key : '');
    chosen = R.scPick[key];
    if (chosen == null) {
      chosen = -1;
      for (k = 0; k < c.ents.length; k++) {
        e = c.ents[k];
        ok = spawnCondOk(R, e, u, target, (e.chk || 'Caster') === 'Target' ? 'target' : 'caster');
        if (ok === null) { ok = true; }
        if (ok) { chosen = e.idx; break; }
      }
      R.scPick[key] = chosen;
    }
    if (chosen !== c.idx) { return false; }
  }
  return true;
}

/** 1 枠ぶんを撃つ。木を歩いて、事象ごとに `fire` を呼ぶ。
    `opt.mc` はこの 1 発が当たる体の数（TL の行が持っている。無ければ `R.mc`） */
function cast(R, u, gid, slot, lvl, at, opt) {
  var doc = u.ls && u.ls[gid];
  if (!doc) { return; }
  if (R.castLog) { var ck9 = u.key + '/' + slot + ':' + gid; R.castLog[ck9] = (R.castLog[ck9] || 0) + 1; }
  var mc = opt && opt.mc != null ? opt.mc : null;
  var to = opt && opt.to != null ? opt.to : null;
  // **狙う先を外から決める**（盤が撃つ技。`TargetCharacterCommandId` で名指し）
  var force = opt && opt.force ? opt.force : null;
  var ev = R.evCache[gid] || (R.evCache[gid] = skillEvents(doc));
  var castId = ++R.castN;
  // **演出中の印。**`TimelineSkillActionDAO` の `Duration`（フレーム）のあいだ、
  // その子は次の NS を撃たない（旧い道の `busyOf` / `exStart` と同じ）
  if ((slot === 'Ex' || slot === 'Public') && doc.Duration > 0) {
    var bu9 = at + doc.Duration / FPS * 1000;
    if (u._busyUntil == null || bu9 > u._busyUntil) { u._busyUntil = bu9; u._busyKind = slot; }
  }
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    var t2 = at + e.f / FPS * 1000;
    if (t2 > R.durMs) { continue; }
    // **狙う先はその瞬間に決める。**仕掛けるときの盤で決めると、
    // 途中で湧いた体・倒れた体を取り違える
    (function (e2, t3) {
      R.q.push(t3, function (now) {
        e2.slot = slot;
        R.now = now;
        R.curCast = castId;
        // **湧く条件**（`SpawnCondition`。撃つ側で見るもの）と **1 つだけ湧く規則**
        // （`SpawnRule: SpawnOnlyOne`）。狙った先で見る条件は相手が決まってから下で
        if (e2.sc && !spawnOk(R, e2.sc, u, null, castId, 'caster')) { return; }
        var tg = force ? force.filter(function (v9) { return v9.alive; }) : R.pick(u, e2, to), k;
        // **狙う先が 1 つも取れなかった回数。**核が伸びないときの手がかり
        if (!tg.length) {
          R.miss['狙えず:' + slot] = (R.miss['狙えず:' + slot] || 0) + 1;
          // **誰の・どの枠の・どの事象が狙えなかったか**（段階 0 の物差し用）
          var mk9 = u.key + '/' + slot + '/' + e2.gid;
          R.missBy[mk9] = (R.missBy[mk9] || 0) + 1;
          if (!R.missT[mk9]) { R.missT[mk9] = [now, now]; } else { R.missT[mk9][1] = now; }
        }
        for (k = 0; k < tg.length; k++) {
          if (e2.sc && !spawnOk(R, e2.sc, u, tg[k], castId, 'target')) { continue; }
          fire(R, e2, u, tg[k], lvl, now, mc);
        }
      }, slot + ':' + e2.gid);
    })(e, t2);
  }
  // **その枠が呼ぶ実体。**グロッキーの鎖の 1 本目（`tree.js:summonsOf` の注記）
  if (R.summon) {
    var sm = R.smCache[gid] || (R.smCache[gid] = summonsOf(doc));
    for (var y = 0; y < sm.length; y++) {
      (function (sv) {
        var t4 = at + (sv.f || 0) / FPS * 1000;
        if (t4 > R.durMs) { return; }
        R.q.push(t4, function (now) { R.summon(sv.name, now, u, sv); });
      })(sm[y]);
    }
  }
  R.used.push({ t: at, who: u.key, slot: slot, gid: gid });
  // **スキルを使ったことを SS に知らせる**（Event 3 / 17）。
  // SS 自身とパッシブからは知らせない（際限なく回る）
  if (u._fireSS && slot !== 'ExtraPassive' && slot !== 'Passive' && slot !== 'HiddenPassive') {
    u._fireSS(at, 'cast', slot);
  }
}

// ---- 特効と地形。**撃つ側と受ける側の組ごとに決まる**（2026-09-06）
//
// ここまで `run()` の引数 `terr` / `effmod` を全員に同じだけ掛けていた。
// 画面はそれで足りる（見ているのは味方 → ボスの 1 組だけ）が、核は
// **ボスが味方を殴る**ので、同じ数を掛けるとボスの攻撃にも味方の特効が乗る。
// しかも `bridge.js` はどちらも渡していないので、実際には**特効が丸ごと抜けていた**
// ——弱点を突く編成が素の 1 倍で殴っていた。
//
// 出どころは `passive.js` の `effMod` / `terrMod` と同じ表:
//   `BulletArmorDamageFactorExcelTable`（`common.ba`）
//   `TerrainAdaptationFactorExcelTable`（`common.terrain`）

/** 弱点のときだけ「◯◯特効増加」が乗る組（`passive.js:ENH` と同じ） */
var ENH = { Explosion: 'LightArmor', Pierce: 'HeavyArmor',
            Mystic: 'Unarmed', Sonic: 'ElasticArmor' };

function baTable(common) {
  var m = {}, i, r, rows = (common && common.ba) || [];
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (r.DamageFactorGroupId && r.DamageFactorGroupId !== 'default') { continue; }
    if (!m[r.BulletType]) { m[r.BulletType] = {}; }
    m[r.BulletType][r.ArmorType] = r.DamageRate;
  }
  return m;
}

function terrTable(common) {
  var m = {}, i, r, rows = (common && common.terrain) || [];
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (!m[r.TerrainAdaptation]) { m[r.TerrainAdaptation] = {}; }
    m[r.TerrainAdaptation][r.TerrainAdaptationStat] = r;
  }
  return m;
}

var GRADE = ['D', 'C', 'B', 'A', 'S', 'SS'];

/** 盤の名前から装甲の語を抜く。盤は `Chesed_Outdoor_LightArmor_Torment`、
    実体（`CharacterExcelTable.DevName`）は `Chesed_Outdoor_Torment` で綴りが違う。
    `tree.js:resolveDev` はここでは使えない——頭が `Chesed` で尻が `Torment` の実体が
    雑魚まで含めて 6 つあって、1 つに絞れず `null` を返す。 */
function noArm2(nm) {
  return String(nm || '').replace(
    /_(LightArmor|HeavyArmor|Unarmed|ElasticArmor|Structure|NormalArmor)(?=_|$)/g, '');
}

/** その体の、この面での地形適性（`CharacterStatExcelTable` の 3 欄）。

    **固有武器ぶんの 1 段を足す**（2026-09-07）。ここは「欄が無い」と書いて
    諦めていたが、`DB/CharacterWeaponExcelTable` の `StatType` / `StatValue` が
    まさにそれで、**275 人ぜんぶが 1 つ持っている**（`StreetBattleAdaptation_Base`
    92 人・`IndoorBattleAdaptation_Base` 92 人・`OutdoorBattleAdaptation_Base` 91 人）。
    開くのは**固有武器★3 から**（SchaleDB `common.js` 7812 行
    `if (statPreviewWeaponGrade >= 3)`）で、`grow.js` が `i < wstar` で
    足しているので `stats` に数として入っている。**素の欄は文字（`S` / `D`）**なので
    `grow` の「数の欄だけ運ぶ」に引っかからず、混ざらない。

    画面側の同じ計算は `js/passive.js:terrGrade`（`GRADE` の並びも clamp も同じ）。
    道具の既定は `js/core.js:19` の `wlv: 50, wstar: 3` なので**既定で 1 段乗る。** */
function gradeOf(st, topo, stats) {
  var k = topo === 'Indoor' ? 'IndoorBattleAdaptation'
        : (topo === 'Street' ? 'StreetBattleAdaptation' : 'OutdoorBattleAdaptation');
  var i = GRADE.indexOf((st && st[k]) || 'D');
  if (i < 0) { i = 0; }
  var b = stats ? +stats[k] : 0;
  if (isFinite(b)) { i += b; }
  return GRADE[Math.max(0, Math.min(5, i))];
}

/** **狙えない体。**`StatusAdd` の `TargetStatus: Untargetable` が付いているあいだ、
    その体は的から外れる。ゲブラのヒーターがこれで、外していないと
    味方の攻撃が全部その 1 体（不死・HP 1）に吸われてボスに 0 しか入らない
    （2026-09-06 に踏んだ。elim2121107 で削った 0.0%）。

    抜け道が 2 つ書いてある。
      `ParameterSecond`  それでも狙える枠の並び（`Ex` / `Ex, Passive` / 空）
      `Parameter`        例外の札の名前。**持っているかを見るのは狙われる側**

    **`Parameter` は撃つ側だと読んでいた。**総力戦の束ぜんぶで
    `TargetStatus: Untargetable` に `Parameter` が付いた札は 11 通りしか無く、
    その札を配っているのは**どれも同じ体の別の効果**だった（2026-09-06 に数えた）:

      HOD01_Passive03_Effect01（Untargetable）← HOD01_Passive03_Effect02 が配る
      HODGuardTower_Cannon_Passive03_Effect03 ← HOD01_Ex04_Effect02 が配る
      EN0010_Heater_Passive01_Effect01        ← EN0010_Heater_Passive01_Effect09 が配る

    決め手は 2 行目。**ボスの EX04 が「守衛塔を狙えるようにする札」を配る。**
    撃つ側（味方）にボスの EX が札を配るはずがないので、見るのは狙われる側。
    札の `TemplateId` も `Dummy_StatusAdd_Untargetable_ExceptionLogicEffectTemplateId`
    ——「例外の札」という名前そのもの。

    撃つ側も一緒に見ておく（束の中に撃つ側へ配る例は 1 つも無いので効かないが、
    出てきたときに黙って外れないように）。 */
function untargeted(v, ev, u) {
  var i, j, m, types, ok;
  for (i = 0; i < v.eff.length; i++) {
    m = v.eff[i].raw;
    if (!m || m.kind !== 'status' || m.status !== 'Untargetable') { continue; }
    ok = false;
    types = String(m.param2 || '').split(',');
    for (j = 0; j < types.length; j++) {
      if (types[j].trim() && types[j].trim() === ev.slot) { ok = true; }
    }
    // **例外の札を持っているのは撃つ側**（2026-09-07 に読み直した）。ホドは本体が
    // `Untargetable`（`Parameter: Dummy_HOD_IgnoreBossUnTarget`）で、その札を持つのは
    // 本体・仮設タワー・守衛塔——敵の側だけ。味方が本体を撃てるようになるのは、
    // 盤の節 3（玉座の前）が `GroundCommandSetStatus Untargetable isAdd:false` で
    // 外したとき。狙われる側の札で見ていて、本体が 0 秒から狙えて 89 秒で倒れていた
    if (!ok && m.param && m.param !== 'None') {
      for (j = 0; j < u.eff.length; j++) {
        if (u.eff[j].tmpl === m.param) { ok = true; }
      }
    }
    if (!ok) { return true; }
  }
  return false;
}

/** **その育ちで実際に効いている `CharacterSkillListExcelTable` の行。**

    生徒 1 人に 4 行ある（固有武器 ★2 の有無 × 愛用品 T2 の有無）。
    アルは素だと `AruPassive01` / `AruPublic01`、固有 2 で `AruWeaponPassive01`、
    愛用品 T2 で `AruGearPublic01` に**枠ごと入れ替わる**。
    **先頭の行を取ると素の枠になる**（2026-09-06 まで `csl[0]` を取っていた）。

    採り方: `MinimumGradeCharacterWeapon`（固有武器の星）と
    `MinimumTierCharacterGear`（愛用品の段）がどちらも「以下」の行のうち、
    **2 つの合計がいちばん大きいもの**。`FormIndex` は変身後の形態で、
    既定は 0。 */
export function cslRow(pack, o, form) {
  var rows = pack.csl || [], best = null, fb = null, i, r;
  var ws = (o && o.wlv) ? (o.wstar || 1) : 0, gt = (o && o.gearT) || 0;
  var fi = form || 0;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if ((r.FormIndex || 0) !== fi) { continue; }
    if (!fb) { fb = r; }
    if ((r.MinimumGradeCharacterWeapon || 0) > ws) { continue; }
    if ((r.MinimumTierCharacterGear || 0) > gt) { continue; }
    if (!best || (r.MinimumGradeCharacterWeapon || 0) + (r.MinimumTierCharacterGear || 0) >
        (best.MinimumGradeCharacterWeapon || 0) + (best.MinimumTierCharacterGear || 0)) {
      best = r;
    }
  }
  return best || fb || rows[0] || {};
}

/** **本体。**

    o = {
      common, boss,                 束（`db/common.json.gz` と `db/boss/<面>.json.gz`）
      party: [{ pack, stats, lv, skillLv, gearT }],
      tl: [{ at, i, slot }],        EX を撃つ時刻（秒）と誰か
      dur, mc, seed, sample
    }
*/
export function run(o) {
  var common = o.common || {}, boss = o.boss || {};
  var b = makeBoard({ common: common, content: o.content || 'Raid' });
  var durMs = (o.dur != null ? o.dur : 240) * 1000;

  // ---- 敵。**ボスと、木から呼ばれるミニオンまで束に入っている**
  var ent = boss.ent || [], stx = {}, byDev = {}, i;
  // **盤が実際に湧かせる体の名前。**束には別の面のボスまで入っていて、
  // 総力戦ゴズの束は `Goz_default_Torment` と `Goz_Outdoor_default_Torment` を
  // 両方持っているが、盤に湧き点があるのは後者だけ。
  // 逆に**盤に湧き点がある「ボス型」は全部が本物**——カイテンジャーは
  // レンジャーの棒（40,000,000）とカイテン FX Mk-0（30,000,000）で 1 本の 7,000 万、
  // シロクロはシロ（35,000,000）とクロ（45,000,000）で 8,000 万（2026-09-07）
  var onBoard = {};
  (function () {
    var bs = boss.board || {}, kk, dd, ss, gg, pp;
    for (kk in bs) {
      dd = bs[kk];
      if (!dd || !dd.Sections) { continue; }
      for (ss = 0; ss < dd.Sections.length; ss++) {
        gg = dd.Sections[ss].EnemySpawnPointGroupList || [];
        for (var g2 = 0; g2 < gg.length; g2++) {
          pp = gg[g2].SpawnPoints || [];
          for (var p2 = 0; p2 < pp.length; p2++) {
            var nm2 = (pp[p2].SpawnData || {}).SpawnTemplateId;
            if (nm2) { onBoard[nm2] = 1; }
          }
        }
      }
    }
  }());
  for (i = 0; i < (boss.st || []).length; i++) { stx[boss.st[i].CharacterId] = boss.st[i]; }
  var bossU = null;
  for (i = 0; i < ent.length; i++) {
    var c = ent[i], s = stx[c.Id];
    if (!s) { continue; }
    var lv = c.TacticEntityType === 'Boss'
      ? (boss.ground.LevelBoss || 90) : (boss.ground.LevelMinion || 90);
    var u = add(b, makeUnit({
      key: 'e' + c.Id, side: 'enemy', charId: c.Id, dev: c.DevName,
      kind: c.TacticEntityType, lv: lv, armor: c.ArmorType, bullet: c.BulletType,
      adapt: gradeOf(s, (boss.ground || {}).StageTopography),
      radius: c.BodyRadius, personality: c.PersonalityId, aiId: c.CharacterAIId,
      role: c.TacticRole, school: c.School, squad: c.SquadType, move: c.CanMove !== false,
      appear: c.AppearFrame,
      hp: s.MaxHP100, maxHp: s.MaxHP100,
      base: s,
    }));
    // **敵も自分の札を引く。**ここを空にしておくと `cast` が黙って帰る
    u.ls = boss.ls || {};
    u.skillLv = {};
    u.csl = (boss.csl || {})[c.Id] || (boss.csl || {})[String(c.Id)] || null;
    byDev[c.DevName] = byDev[c.DevName] || [];
    byDev[c.DevName].push(u);
    // **盤に最初から居るのはボスだけ。**ミニオンは湧いてから
    //
    // **束には別の面のボスまで入っている。**総力戦ゴズの束には
    // `Goz_default_Torment`（HP 50,000,000）と `Goz_Outdoor_default_Torment` が
    // 両方いて、盤の `start` が後者を湧かせ、味方の攻撃が全部そちらへ行っていた
    // （2026-09-06。`9FiPLXveLBs` で与ダメージ 21,056,301 に対して
    // 画面が見ている本体は 0.2% しか減っていなかった）。
    // **どの体が本体かは画面が選んだ `cid`** で決まる
    if (c.TacticEntityType === 'Boss') {
      if (o.cid != null ? (c.Id === o.cid) : !bossU) { bossU = u; } else { u.alive = false; }
    } else { u.alive = false; }
  }
  if (!bossU) {
    for (i = 0; i < ent.length; i++) {
      if (ent[i].TacticEntityType === 'Boss' && b.units['e' + ent[i].Id]) {
        bossU = b.units['e' + ent[i].Id]; bossU.alive = true; break;
      }
    }
  }
  if (!bossU) { throw new Error('ボスの実体が束に無い'); }
  // **盤に湧き点が無いボスは湧かせない。**束に混ざっている別の面のボス
  // （総力戦ゴズの `Goz_default_Torment`）がこれ。
  // **盤に湧き点があるボスは本物**なので、湧かせるし HP の棒にも数える
  var otherBoss = {}, bossUnits = [];
  for (i = 0; i < ent.length; i++) {
    if (ent[i].TacticEntityType !== 'Boss') { continue; }
    var bu2 = b.units['e' + ent[i].Id];
    if (!bu2) { continue; }
    if (onBoard[ent[i].DevName] || bu2 === bossU) { bossUnits.push(bu2); }
    else { otherBoss[ent[i].DevName] = 1; }
  }
  if (!bossUnits.length) { bossUnits = [bossU]; }
  /** **棒に残っている HP。**盤に出るボスぜんぶの合計（まだ湧いていない体は満タン） */
  function bossHp() {
    var z2, v2 = 0;
    for (z2 = 0; z2 < bossUnits.length; z2++) { v2 += Math.max(0, bossUnits[z2].hp); }
    return v2;
  }
  var bossMax = 0;
  for (i = 0; i < bossUnits.length; i++) { bossMax += bossUnits[i].maxHp || 0; }

  // ---- 盤。**味方も敵もここで座標をもらう**（2026-09-06）
  //
  // 味方は「その節の `Formations` の原点」＋「陣形の枠のずれ」。
  // 敵は湧き点の `Position`。**盤の単位はスキルの射程の 1/100。**
  // ここが無いあいだ、範囲攻撃は距離に関係なく盤の全部に当たっていて、
  // 味方が中サイズのペロロミニオンを湧いた端から全部倒し、
  // ボスが吸うものを見つけられずグロッキーが 1 度も起きなかった
  var bd = null, sec = 0, snaps = {}, snapDone = {}, snap = null;
  var bnames = Object.keys(boss.board || {});
  if (bnames.length) { bd = boardPlan(boss.board[bnames[0]]); }
  // **ボスが湧く節で戦う**（2026-09-07）。節 0 に居ないボスが 1 体だけいる——
  // ケセドは 4 節あって、節 0 と 1 が雑魚の通路（湧き点 30 と 41）、節 2 が移動、
  // **節 3 が玉座の間**（`SpawnChesed` ／ `SectionStarted` ／ 湧き点 1）。
  // 節 0 のまま回すと、味方の原点が `Formations` の `SectionIndex 0`（y 6.0）で、
  // ボスは節 3（y 55.74）——**盤の端と端**。湧き点も引けないので座標が `null` になる。
  // 節 0 にボスが居る面（ほかの 12 面ぜんぶ）は今までどおり 0
  //
  // **名前は盤のほうに装甲が入る。**盤は `Chesed_Outdoor_LightArmor_Torment`、
  // 実体（`CharacterExcelTable.DevName`）は `Chesed_Outdoor_Torment`。
  // 装甲の語を抜いて突き合わせる（`tree.js:resolveDev` はここでは使えない——
  // 頭が `Chesed` で尻が `Torment` の実体が雑魚まで含めて 6 つあって、
  // 1 つに絞れず `null` を返す）
  // **節は順に歩く**（2026-09-07）。ボスが節 0 に居ない面（ケセド）へ
  // いきなり飛ばす細工はやめた。通路ぶんの時間が丸ごと落ちるため
  var fgid = (boss.ground || {}).FormationGroupId;
  var formRow = null;
  for (i = 0; i < (common.form || []).length; i++) {
    var fr0 = common.form[i];
    if (fr0.GroupID === fgid || fr0.GroupId === fgid) { formRow = fr0; }
  }
  var origin = originOf(bd, sec);
  // **味方の立ち位置は節をまたいで続く。**歩いた先を持ち回るための入れ物で、
  // `Formations` の行をそのまま持つと次の節で巻き戻る
  var org = origin
    ? { Position: { x: (origin.Position || {}).x || 0, y: (origin.Position || {}).y || 0 },
        Forward: origin.Forward, IgnorePathFind: origin.IgnorePathFind }
    : null;
  // 遮蔽。**総力戦の盤にもある**（2026-09-07。`board.js` の注記）
  var obs = bd ? obstacleBoxes(bd, sec, common) : [];
  // 遮蔽の立ち位置（`board.js:coverPoints`）。生徒はここへ移って隠れる
  var cpts = bd ? coverPoints(bd, sec, common, obs) : [];
  var coverLog = [];
  // 湧き点の座標を実体の名前で引けるように（同じ名前が複数あるので先頭）
  // **装甲を抜いた名前でも引けるようにする。**盤は `..._LightArmor_Torment`、
  // 実体は `..._Torment` で、そのままだとボスの座標が `null` のままになる
  var posOf = {};
  function readPositions() {
    posOf = {};
    if (!bd || !bd.sections[sec]) { return; }
    var pts0 = bd.sections[sec].points, z4;
    for (z4 = 0; z4 < pts0.length; z4++) {
      if (pts0[z4].dev && pts0[z4].pos) {
        if (!posOf[pts0[z4].dev]) { posOf[pts0[z4].dev] = pts0[z4].pos; }
        var nm0 = noArm2(pts0[z4].dev);
        if (!posOf[nm0]) { posOf[nm0] = pts0[z4].pos; }
      }
    }
    var ek = Object.keys(byDev), z5, w5;
    for (z5 = 0; z5 < ek.length; z5++) {
      var pl = byDev[ek[z5]];
      for (w5 = 0; w5 < pl.length; w5++) {
        // **生きている体は動かさない。**節が変わっても、いま盤に立っている体の
        // 座標を書き換えると、殴り合いの最中に瞬間移動する
        if (pl[w5].alive) { continue; }
        pl[w5].pos = posOf[ek[z5]] || posOf[noArm2(ek[z5])] || null;
      }
    }
  }
  readPositions();
  // **本体の座標は湧き点から。**`readPositions` は「生きている体は動かさない」ので、
  // 最初から生きている本体だけ (0, 0) のまま残っていた（2026-09-07。ビナーで
  // 狙う先の「いちばん近い子」と遮蔽の線が全部ずれていた）
  if (bossU && bossU.dev) {
    var bp0 = posOf[bossU.dev] || posOf[noArm2(bossU.dev)];
    if (bp0) { bossU.pos = { x: bp0.x, y: bp0.y }; }
  }
  // **盤が途中で湧かせる本体は、湧くまで居ない**（2026-09-07）。ケセドは節 3 の
  // `CommandSpawnChesed` で (0, 143) に出るのに、0 秒から (0, 0) に居て、味方は波を
  // 素通りして 0.1 倍の本体を殴っていた（bduU6UliYdQ で 240 秒 12%）。
  // 節 0 の `start` で湧く本体（ビナー・ホド）は今までどおり最初から居る。
  // 盤に湧き点が無い本体も今までどおり（湧かせようが無い）
  var bossLate = false;
  if (bd && bossU && bossU.dev && (onBoard[bossU.dev] || onBoard[noArm2(bossU.dev)])) {
    var sp0 = spawnFor(bd, 0, 'start'), z0, atStart = false;
    for (z0 = 0; z0 < sp0.length; z0++) {
      if (sp0[z0].dev === bossU.dev || noArm2(sp0[z0].dev) === noArm2(bossU.dev)) { atStart = true; }
    }
    if (!atStart) { bossLate = true; bossU.alive = false; }
  }

  // ---- 味方
  var party = o.party || [], allies = [];
  for (i = 0; i < party.length; i++) {
    var p = party[i], pc = p.pack, ch = pc.ch || {};
    var au = add(b, makeUnit({
      key: 'a' + i, side: 'ally', charId: pc.id, dev: pc.dev,
      kind: 'Student', lv: p.lv || 90, armor: ch.ArmorType, bullet: ch.BulletType,
      // **生徒の `st` は 1 枚の連想配列**（ボスの束は行の並び）。
      // `[0]` を取っていて全員 D 判定＝攻撃 0.8 倍になっていた（2026-09-06）
      adapt: gradeOf(Array.isArray(pc.st) ? pc.st[0] : pc.st,
                     (boss.ground || {}).StageTopography, p.stats),
      radius: ch.BodyRadius, personality: ch.PersonalityId, aiId: ch.CharacterAIId,
      role: ch.TacticRole, school: ch.School, squad: ch.SquadType, move: ch.CanMove !== false,
      hp: (p.stats && p.stats.MaxHP) || 1, maxHp: (p.stats && p.stats.MaxHP) || 1,
      base: p.stats || {}, skillLv: p.skillLv || {},
    }));
    // **射程と足の速さは素の行から**（`grow.js` は成長する欄しか返さない。2026-09-07）。
    // `Range` 550（HG）〜、`MoveSpeed` 200。無いと射程 0 ＝ 相手の足元まで歩いてしまう
    var st0 = Array.isArray(pc.st) ? pc.st[0] : (pc.st || {});
    if (au.base.Range == null && st0 && st0.Range != null) { au.base.Range = st0.Range; }
    if (au.base.MoveSpeed == null && st0 && st0.MoveSpeed != null) { au.base.MoveSpeed = st0.MoveSpeed; }
    au.ls = pc.ls;
    au.pack = pc;
    au.slot = p.slot != null ? p.slot : i;
    au.pos = org ? slotPos(org, formRow, au.slot) : null;
    allies.push(au);
  }

  // ---- 射程と足。**ItJustWorks の「行動の列」をそのまま写す**（2026-09-07）
  //
  //   1. 視界に敵が居なければ前へ（＝盤の `walkTo`。`stepSection` が歩かせる）
  //   2. 視界に敵が居て射程に居なければ、射程に入るまで近づく
  //   3. 射程内の遮蔽に隠れる
  //   4. 撃つ（射程の外では撃たない）
  //
  // 射程は `CharacterStat.Range`（1/100 単位）で、**相手の体の縁まで**
  // （`BodyRadius` を引く。`board.js:sortByRule` の並べ方と同じ物差し）。
  // 足は `MoveSpeed`（1/100 単位 / 秒）、動けるかは `CharacterExcelTable.CanMove`。
  // 敵も同じ列で動く——ケセドの雑魚（`Range` 500・`MoveSpeed` 255）は本体の手前に湧いてから
  // 味方へ歩いてくるので、本体（縁が 3.5 手前に出る `BodyRadius` 350）より近くなる。
  // 置くまで味方は湧いた場所の雑魚より本体の縁を近いと見て、0.1 倍の本体を殴り続けていた
  var UNIT = 100;
  function edgeDist(u9, t9) {
    if (!u9 || !t9 || !u9.pos || !t9.pos) { return 0; }
    var dx9 = t9.pos.x - u9.pos.x, dy9 = t9.pos.y - u9.pos.y;
    return Math.sqrt(dx9 * dx9 + dy9 * dy9) - (t9.radius || 0) / UNIT;
  }
  function rangeOf(u9) { var rg = statsNow(u9).Range; return (rg == null ? 0 : rg) / UNIT; }
  function inRange(u9, t9) { return edgeDist(u9, t9) <= rangeOf(u9) + 1e-9; }
  /** いちばん近い相手（縁まで）。スペシャルは盤に立たないので相手にならない */
  function aimOf(u9) {
    var vs = living(b, u9.side === 'ally' ? 'enemy' : 'ally'), z9, best = null, bd9 = 0, d9;
    for (z9 = 0; z9 < vs.length; z9++) {
      var v9 = vs[z9];
      if (!v9.pos || v9 === u9) { continue; }
      if (v9.side === 'ally' && v9.squad === 'Support') { continue; }
      d9 = edgeDist(u9, v9);
      if (!best || d9 < bd9) { best = v9; bd9 = d9; }
    }
    return best;
  }
  /** 射程の外なら撃たずに待つ（`R.miss['射程外:<枠>']` に数える）。射程が無い体は今までどおり撃つ */
  function outOfRange(u9, slot) {
    if (rangeOf(u9) <= 0) { return false; }
    var a9 = aimOf(u9);
    if (!a9 || inRange(u9, a9)) { return false; }
    R.miss['射程外:' + slot] = (R.miss['射程外:' + slot] || 0) + 1;
    return true;
  }
  /** 1 刻みぶん近づく。着いたら味方は射程内の遮蔽に隠れ直す */
  function stepApproach(now, dt) {
    var us9 = living(b, 'ally').concat(living(b, 'enemy')), z9;
    for (z9 = 0; z9 < us9.length; z9++) {
      var u9 = us9[z9];
      if (!u9.pos) { continue; }
      // **盤に行き先を指された体は、そこへ歩く**（`ForceMoveToGroundPoint`）
      if (u9.goal) {
        var gx = u9.goal.x - u9.pos.x, gy = u9.goal.y - u9.pos.y, gl = Math.sqrt(gx * gx + gy * gy);
        var gs = ((statsNow(u9).MoveSpeed || 0) / UNIT) * dt / 1000;
        if (gl <= gs || gs <= 0) { u9.pos = { x: u9.goal.x, y: u9.goal.y }; u9.goal = null; }
        else { u9.pos = { x: u9.pos.x + gx / gl * gs, y: u9.pos.y + gy / gl * gs }; }
        continue;
      }
      if (u9.move === false || rangeOf(u9) <= 0) { continue; }
      if (u9.appearUntil != null && now < u9.appearUntil) { continue; }   // 湧きの演出中は立ったまま
      if (u9.side === 'ally' && (u9.squad === 'Support' || walkGoal != null)) { continue; }
      var aim9 = aimOf(u9);
      if (!aim9) { u9.moving = false; continue; }
      var gap = edgeDist(u9, aim9) - rangeOf(u9);
      if (gap <= 1e-9) {
        if (u9.moving) { u9.moving = false; if (u9.side === 'ally') { takeCover(u9, now); } }
        continue;
      }
      var sp9 = ((statsNow(u9).MoveSpeed || 0) / UNIT) * dt / 1000;
      if (sp9 <= 0) { continue; }
      var mv9 = Math.min(sp9, gap), ddx = aim9.pos.x - u9.pos.x, ddy = aim9.pos.y - u9.pos.y;
      var ln9 = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      if (!u9.moving) {
        u9.moving = true;
        if (u9.cover) { u9.cover.used = null; u9.cover = null; }
        moveLog.push([Math.round(now / 100) / 10, u9.key, Math.round(u9.pos.x * 10) / 10, Math.round(u9.pos.y * 10) / 10, aim9.key, Math.round(gap * 10) / 10]);
      }
      u9.pos = { x: u9.pos.x + ddx / ln9 * mv9, y: u9.pos.y + ddy / ln9 * mv9 };
    }
  }
  var moveLog = [];
  /** **TL の合図に使う出来事**（2026-09-07）。`[秒, 種類, 詳細]`。
      種類は `spawn`（敵が湧いた。節の波と召喚）・`move`（隊列が動き出した。歩きも飛びも）。
      TL の「敵出現」「移動開始後」「移動中」「左の扉が開いたら」はコストではなく
      これらの出来事で撃つ行なので、画面のコスト計算に渡す前にここへ結び付ける
      （`tl-work/_cue.py`）。召喚は 1 発の EX で十数体出るので 0.1 秒以内はまとめる */
  var evLog = [];
  function logEv(at, kind, what) {
    var last = evLog.length ? evLog[evLog.length - 1] : null;
    if (last && last[1] === kind && last[2] === what && at - last[0] * 1000 < 100) { return; }
    evLog.push([Math.round(at) / 1000, kind, what]);
  }

  /** **遮蔽に隠れる。**隊列の席から、ボスとのあいだに箱が入る空いた立ち位置のうち
      いちばん近いところへ移る（席の順。1 点に 1 人）。スペシャルは盤に立たない。
      動画（IrVUx0ywuyo の 0:44）では 4 人がトラックと樽の陰に居て、
      隊列の席のまま立たせた核では通常攻撃 3 発で 1 人目が倒れていた（2026-09-07）。
      無い点・隠れられない点しか無ければ席のまま（陰なし）。
      `one` を渡すとその子だけ選び直す（陰の遮蔽物が壊れたとき） */
  function takeCover(one, at) {
    var z, w;
    if (!one) { for (z = 0; z < cpts.length; z++) { cpts[z].used = null; } }
    for (z = 0; z < allies.length; z++) {
      var a2 = allies[z];
      if (one && a2 !== one) { continue; }
      if (one && a2.cover) { a2.cover.used = null; }
      a2.cover = null;
      // **隠れる相手はいちばん近い敵**（居なければ本体）。**射程に入る立ち位置だけ**
      // （ItJustWorks の手順: 射程に入るまで前へ → 射程内の遮蔽に隠れる → 撃つ。2026-09-07）。
      // 歩いて着いた子は、着いた場所が「席」になる
      var foe = aimOf(a2) || ((bossU && bossU.alive) ? bossU : null), bp = foe && foe.pos;
      if (one) { a2.home = { x: a2.pos.x, y: a2.pos.y }; }
      if (a2.squad === 'Support' || !a2.pos || !bp || !cpts.length) { continue; }
      var home = a2.home || (a2.home = { x: a2.pos.x, y: a2.pos.y }), best = null, bd2 = 0;
      var rg2 = rangeOf(a2);
      for (w = 0; w < cpts.length; w++) {
        var cp = cpts[w];
        if (cp.used || cp.box.dead) { continue; }
        if (rg2 > 0 && edgeDist({ pos: cp }, foe) > rg2) { continue; }
        if (!coverBox(bp, cp, [cp.box], a2.radius)) { continue; }
        var dx2 = cp.x - home.x, dy2 = cp.y - home.y, dd = dx2 * dx2 + dy2 * dy2;
        if (!best || dd < bd2) { best = cp; bd2 = dd; }
      }
      if (best) { best.used = a2.key; a2.pos = { x: best.x, y: best.y }; a2.cover = best; }
      else { a2.pos = { x: home.x, y: home.y }; }
      coverLog.push([Math.round((at || 0) / 100) / 10, a2.key,
                     best ? best.box.name + '(' + Math.round(best.x * 10) / 10 + ',' + Math.round(best.y * 10) / 10 + ')' : 'なし',
                     cpts.map(function (c9) { return c9.used ? c9.used : (c9.box.dead ? 'x' : '-'); }).join('')]);
    }
  }

  // ---- 効果の索引。味方とボスをまとめて 1 つに
  var le = [];
  for (i = 0; i < party.length; i++) { le = le.concat(party[i].pack.le || []); }
  le = le.concat(boss.le || []);
  var eff = readAll(le);

  var R = {
    god: !!o.god, castLog: {},
    b: b, ctx: ctxOf(b), eff: eff, q: queue(), evCache: {}, pgCache: {},
    castN: 0, scPick: {},
    fireN: {}, missBy: {}, missT: {}, missWhy: {}, deaths: [], killLog: [], byAlly: {}, noBossDmg: !!o.noBossDmg, noUntargetable: !!o.noUntargetable, total: 0, heal: 0, groggy: [], ggLog: [], secLog: [], summoned: 0, smCache: {}, probe: o.probe ? [] : null, used: [], unknown: 0, unknownBy: {}, miss: {}, by: {},
    durMs: durMs, mc: o.mc || 1, C: constOf(common),
    unitOf: function (k) { return b.units[k] || null; },
    lvTable: common.lvdiff || null, caps: capsOf(common.calcLimit),
    baT: baTable(common), terrT: terrTable(common),
    topo: (boss.ground || {}).StageTopography || 'Outdoor',
    rnd: o.seed != null ? mulberry(o.seed) : null,
    // **撃つ側の値。**素の値に、**その瞬間に乗っている札**を畳んでから返す。
    // 焼き出しにはこれができなかった（状態を持っていないので）
    attacker: function (u, ev, at) {
      var s = statsNow(u);
      return {
        atk: s.AttackPower || 0, pen: s.DefensePenetration || 0,
        dr: s.DamageRatio, dr2: s.DamageRatio2,
        exRate: s.EnhanceExDamageRate, baRate: s.EnhanceBasicsDamageRate,
        stab: s.StabilityPoint, stabR: s.StabilityRate,
        acc: s.AccuracyPoint, crit: s.CriticalPoint, critDmg: s.CriticalDamageRate,
        // **地形と特効は組で決まる。**ここでは素の 1 を入れておいて、
        // 一撃ごとに `R.terrOf` / `R.effOf` が上書きする
        terr: 1, eff: 1,
      };
    },
    /** 遮蔽率（1/10000）。**線を遮る箱の `BlockRate` に、守る側の `BlockFactor` を
        足し、撃つ側の `ShotFactor` を引く。**3 つとも 1/10000 の同じ物差しで、
        地形の 2 欄は説明の鍵が `TerrainFactorDescription_*_Coverrate` と
        `_IgnoreCoverrate`（＝遮蔽率と遮蔽貫通率）。
        **足し引きにしたのは D が 0 だから。**掛け算だと D 適性で遮蔽そのものが消える。 */
    hitCover: function (u, v, amt, at) {
      var bx = coverBox(u.pos, v.pos, obs, v.radius);
      if (!bx) { return; }
      R.coverDmg = (R.coverDmg || 0) + amt;
      if (!bx.destroy) { return; }
      bx.hp -= amt;
      if (bx.hp <= 0 && !bx.dead) {
        bx.dead = true;
        if (R.secLog) { R.secLog.push([Math.round(at / 100) / 10, 'cover-', bx.name + '@' + v.key]); }
        if (v.side === 'ally') { takeCover(v, at); }
      }
    },
    coverOf: function (u, v) {
      if (!obs.length || !u || !v || !u.pos || !v.pos) { return 0; }
      var base = coverRate(u.pos, v.pos, obs, v.radius);
      if (base <= 0) { return 0; }
      var gv = (R.terrT[R.topo] || {})[v.adapt || 'D'];
      var gu = (R.terrT[R.topo] || {})[u.adapt || 'D'];
      var r = base + ((gv && gv.BlockFactor) || 0) - ((gu && gu.ShotFactor) || 0);
      return Math.max(0, Math.min(10000, r));
    },
    /** 体が遮蔽の陰に入っているか（`CoverState`。**1 隠れていない / 2 隠れている**）。
        `u` が見られる側、`v` が相手。
        **見るのは `coverOf` と同じ線で、地形の足し引きは掛けない。**
        あちらは「何割が当たらないか」、こちらは「陰に居るか居ないか」。
        遮蔽の無い面（束 700 面のうち 515 面）と、盤の座標が引けない面は
        **1（隠れていない）。**「分からない」ではなく、遮蔽が無ければ
        誰も隠れていないのが事実。 */
    coverState: function (u, v) {
      if (!obs.length || !u || !v || !u.pos || !v.pos) { return 1; }
      return coverRate(v.pos, u.pos, obs, u.radius) > 0 ? 2 : 1;
    },
    /** その体の地形倍率（`AttackPowerFactor`）。 */
    terrOf: function (u) {
      var g = (R.terrT[R.topo] || {})[u.adapt || 'D'];
      return g ? (g.AttackPowerFactor || 10000) / 10000 : 1;
    },
    /** 撃つ側の弾種 × 受ける側の装甲。**弱点のときだけ「特効増加」が掛かる。**
        `passive.js:effMod` と同じ読み方（足さずに掛ける。2026-09-05 に動画で確定）。 */
    effOf: function (u, v, st) {
      if (!v || v.armor === 'Structure') { return 1; }
      var e = ((R.baT[u.bullet] || {})[v.armor]);
      if (e == null) { e = 10000; }
      if (ENH[u.bullet] === v.armor) {
        var k = st['Enhance' + u.bullet + 'Rate'];
        if (k != null) { e = e * k / 10000; }
      }
      return e / 10000;
    },
    defender: function (u) {
      var s = statsNow(u);
      // **被ダメージ率は 10000 から始めて、札の動きぶんだけ足す。**
      //
      // `CharacterStatExcelTable.DamagedRatio` は ケセド 19000（＝ 0.1 倍）・
      // ホド 19000・ヒエロニムス 16000・ホバークラフト 17500・イェソド 19900 と
      // 10000 でないボスがいるが、**画面側がその素の値を掛けているのは
      // 「この効果以外の DamagedRatio の増加効果を無効化」と書いてあるボス
      // （ケセドの剥き出しの玉座）だけ**（`target.js:414`。動画で確かめたのも
      // ケセドだけで、ホド・ヒエロニムス・イェソドは 1.0 倍で実クリア TL と合う）。
      // 核はここを素の値から始めていて、ホドとケセドが 10 分の 1 になっていた
      // （2026-09-06。`WpfoUpfz5qM` で `drA` が 0.1）。
      // 素の値を掛けるのは `boss.dmgOnly`（束に入れてある。ケセドだけ）
      //
      // **素の値を掛けるボス（ケセド）では、ずらさずそのまま使う**（2026-09-07）。
      // ずらしと `dbase` を両方掛けると二重になる——グロッキー中は札が −9000 で
      // `s.DamagedRatio` が 10000（＝ 1.0 倍）になるのに、
      // `10000 + (10000 − 19000) = 1000` → `(20000 − 1000)/10000 = 1.9` に
      // `dbase` 0.1 を掛けて **0.19 倍**になっていた。生の値なら
      // 19000 → 0.1 倍・10000 → 1.0 倍で、どちらも正しく出る
      var base = u.base || {};
      var raw = boss.dmgOnly && base.DamagedRatio != null;
      var sd = s.DamagedRatio == null ? 10000 : s.DamagedRatio;
      var sd2 = s.DamagedRatio2 == null ? 10000 : s.DamagedRatio2;
      var dg = raw ? sd
        : 10000 + (sd - (base.DamagedRatio == null ? 10000 : base.DamagedRatio));
      var dg2 = raw ? sd2
        : 10000 + (sd2 - (base.DamagedRatio2 == null ? 10000 : base.DamagedRatio2));
      return {
        def: s.DefensePower || 0,
        dodge: s.DodgePoint || 0, critResist: s.CriticalResistPoint || 0,
        critDmgResist: s.CriticalDamageResistRate || 0,
        damaged: dg, damaged2: dg2,
        dbase: 1,
      };
    },
    /** **狙う先。**木の `EssentialCandidateRule.TargetSide` で振り分ける。

        ここを間違えると**自分へのバフがボスに乗る。**（2026-09-06 に踏んだ。
        味方の技も全部ボスへ流していて、攻撃力バフがボスに入っていた）

          Self          撃った本人だけ
          Enemy         相手の側
          Player / Ally / Friendly  味方の側

        人数は `MaxTargetCount`（-1 は無制限）。**位置で絞るのは第 2 段**なので、
        いまは前から順に取る。 */
    /** その事象が何の札か（`effect.js:kindOfList`）。渡し先の判定に要る */
    kindOf: function (ev) {
      var l = R.eff[ev.gid];
      return l ? kindOfList(l) : null;
    },
    pick: function (u, ev, to) {
      var side = (ev.sel && ev.sel.side) || null;
      // **`TargetSide` が無い／`None` の体は、置き方（`SpawnPositionType`）で相手が決まる**
      // （2026-09-07）。`Invoker` は撃った本人に付く体（イブキ（水着）の隠しパッシブ
      // `CH0347_HiddenPassive03_LevelTargetAttachedEntity01` がこれで、NS の札を自分に貼る）。
      // ここが無くて札がボスに付き（無指定は「相手の側」に落ちる）、札切れで撃つ NS が
      // 2 発目から出なかった。`InputBattleEntity`（指した相手）は今までどおり下の「渡し先」で拾う
      var sp9 = ev.spawn || (ev.area && ev.area.spawn) || null;
      if ((side == null || side === 'None') && sp9 === 'Invoker') { side = 'Self'; }
      // **規則そのものが無い事象（`PassiveSkillDAO` は `EssentialCandidateRule` を持たない）は
      // 撃った本人に**（2026-09-07）。ヒナ（ドレス）のサブスキル `CH0230ExtraPassive01`
      // （特効 +63.51%）が「相手の側」に落ちてボスに付いていた。ダメージの事象は今までどおり
      var kd9 = (side == null && (sp9 == null || sp9 === 'None')) ? R.kindOf(ev) : null;
      if (kd9 && kd9 !== '?' && !/^(dmg|dot|deadly|kill|transfer)/.test(kd9)) { side = 'Self'; }
      if (side == null) { side = (u.side === 'ally' ? 'Enemy' : 'Player'); }
      if (side === 'Self') { return [u]; }
      var mine = u.side === 'ally';
      // **倒れた体は狙わない。**ここが `allies.slice()` のままだと、
      // ボスは最初の 1 人の死体を殴り続ける（2026-09-06）
      var alive = living(b, 'ally');
      var team;
      if (side === 'Enemy') { team = mine ? living(b, 'enemy') : alive; }
      else { team = mine ? alive : living(b, 'enemy'); }
      // **`Ally_Except_Self` は自分を外す。**外していなくて、
      // ボスが自分自身に被ダメージ転移の札を貼っていた（2026-09-06）
      if (/Except_Self/.test(String(side))) {
        var t2 = [], z2;
        for (z2 = 0; z2 < team.length; z2++) { if (team[z2] !== u) { t2.push(team[z2]); } }
        team = t2;
      }
      // **`ApplyEntityType` で絞る**（2026-09-07）。木の `EssentialCandidateRule.ApplyEntityType` は
      // 体の種類のビット集合で、**1 = 盤に立つ体（ストライカー・敵）、8 = スペシャル生徒**。
      // `LocalizeSkillExcelTable` の説明文と突き合わせて決めた:
      //   `CH0260ExtraPassive01`（Ally_Except_Self, 8）「自身とスペシャル生徒の攻撃力を…増加」
      //   `CH0076Public01`（Ally_Except_Self, 1）「ストライカーの味方の会心ダメージ率を…増加」
      //   `CH0055ExtraPassive01`（Ally, 9 = 1+8）「味方の治癒力を…増加」
      //   敵を狙う技は 5 / 7（1 を含む）、敵の技が生徒を狙うのも 5 / 7
      // 2 と 4 は遮蔽物・召喚物のたぐい（未確定。生徒は持たない）。
      // ここが無くて、カンナ（水着）のサブスキル（スペシャル向け +30.61%）がネルに乗っていた
      var am = ev.sel ? ev.sel.apply : null;
      if (am != null && am > 0) {
        var t5 = [], z5;
        for (z5 = 0; z5 < team.length; z5++) {
          var bits5 = (team[z5].side === 'ally' && team[z5].squad === 'Support') ? 8 : 1;
          if (bits5 & am) { t5.push(team[z5]); }
        }
        team = t5;
      }
      // **狙えない体を外す**（`Untargetable`）。外れて誰も居なくなったら撃たない
      var t3 = [], z3, n0 = team.length;
      for (z3 = 0; z3 < team.length; z3++) {
        if (R.noUntargetable || !untargeted(team[z3], ev, u)) { t3.push(team[z3]); }
      }
      // **誰も狙えなかった最初の場面を覚える**（段階 0 の物差し用）。
      // 生きている敵の数・狙えない札の中身・その時刻
      if (!t3.length && R.missWhy) {
        var mw = u.key + '/' + (ev.slot || '?') + '/' + side;
        if (!R.missWhy[mw]) {
          var marks = [], zm, zu;
          for (zm = 0; zm < team.length; zm++) {
            for (zu = 0; zu < team[zm].eff.length; zu++) {
              var rw = team[zm].eff[zu].raw;
              if (rw && rw.kind === 'status') { marks.push([team[zm].key, rw.status, rw.param || '', rw.param2 || '', team[zm].eff[zu].tmpl || '', team[zm].eff[zu].gid || '', team[zm].eff[zu].src || '', Math.round(team[zm].eff[zu].at || 0), team[zm].eff[zu].until == null ? null : Math.round(team[zm].eff[zu].until)]); }
            }
          }
          R.missWhy[mw] = { n0: n0, alive: living(b, 'enemy').length, marks: marks.slice(0, 8), t: R.now };
        }
      }
      team = t3;
      var max = ev.sel ? ev.sel.max : null;
      // **味方に配る札は、TL の「渡し先」へ。**規則は旧い道（`target.js:buffTo` と
      // `liveBuffs0` の `limit`）をそのまま写した——**「味方 1 人」なら選んだ子だけ、
      // 「2 人以上」でも選んであればその子たちだけ。**`Self` が並んでいる行は
      // 本人にも乗る。指定が無ければ今までどおり距離で選ぶ。
      //
      // ここが `max === 1` のときだけだったので、イブキ（水着）の EX
      // （会心ダメージ率 +60.72%・2 人指定）がネルではなく近い 2 人に乗っていた。
      // ネルの `EnhancePierceRate` が 20,871 のところ 15,983 にしかならず、
      // 特効が 4.3742 対 3.1966 で **1.37 倍ぶん足りなかった**（2026-09-07）。
      // **ダメージと回復には掛けない**——回復は HP の低い子へ行くのが正しい
      var kd4 = R.kindOf(ev);
      if (to != null && mine && side !== 'Enemy' && !isDamage(kd4) &&
          kd4 !== 'heal' && kd4 !== 'hot' && kd4 !== 'healByHit') {
        var tl4 = (Object.prototype.toString.call(to) === '[object Array]') ? to : [to];
        var want = [], zt, ax;
        for (zt = 0; zt < tl4.length; zt++) {
          ax = allies[tl4[zt]];
          if (ax && ax.alive && want.indexOf(ax) < 0) { want.push(ax); }
        }
        if (/Self/.test(String(side)) && !/Except_Self/.test(String(side))
            && want.indexOf(u) < 0) { want.push(u); }
        if (want.length) { return want; }
      }
      // **狙う先は距離で決まる**（`TargetSortRule` の `SortCriteria: Distance`）。
      // 座標が無い面では並びが変わらないので、今までどおり前から取る
      var sorted = sortByRule(u, team, ev.sel);
      if (!ev.area) {
        if (max != null && max > 0 && sorted.length > max) { sorted = sorted.slice(0, max); }
        return sorted;
      }
      // **範囲。**狙う先を決めてから、その形の中に居るものを全部。
      // ここが `mc`（人が数えていた巻き込み数）の代わりになる
      var aim = sorted[0];
      if (!aim) { return []; }
      var hit = inArea(ev.area, u, aim, sorted);
      // **盤の絶対座標に置いた範囲には「必ず当たる 1 人」が居ない。**
      // `EssentialCandidateRule.TargetingType` も `Target` ではなく `Position` で、
      // 狙った先ではなく置いた点が中心（シロクロ Torment の EX の格子）
      var anchored = String((ev.area && ev.area.spawn) || '') === 'WorldPosition'
        && ev.area.wp;
      if (!anchored && hit.indexOf(aim) < 0) { hit = [aim].concat(hit); }
      if (max != null && max > 0 && hit.length > max) { hit = hit.slice(0, max); }
      return hit;
    },
  };

  // ---- 積む: 常時のパッシブ → 通常攻撃 → 通常スキル → EX
  //
  // **形態（`FormConversion`）で枠がまるごと入れ替わる。**制服ネル（CH0280）の
  // EX は変身そのもので、変身前の通常攻撃は 0 ダメージの置き（2026-09-06 に
  // `IrVUx0ywuyo` で踏んだ——24 発撃って与ダメージ 0）。だから通常攻撃と
  // 通常スキルは「積んだら終わり」ではなく、**自分で次を積む形**にして、
  // 形態が変わったら世代（`_gen`）を上げて古い列を止め、新しい枠で積み直す。
  var setupAlly = function (au, p, from) {
    var gen = ++au._gen;
    var csl = cslRow(au.pack, p, au.form || 0);
    // **枠の名前は配列で、空きが `'EmptySkill'` で埋めてある。**先頭とは限らない
    // ——変身後の行は空きが前に来る（制服ネルの形態 1 は
    // `ExSkillGroupId: ['EmptySkill', 'CH0280Ex02']`）。`[0]` を取ると
    // **変身したとたんに EX が無くなる**（2026-09-07 に `IrVUx0ywuyo` で踏んだ）。
    // 中身のある最初の枠を取る
    var gid = function (k) {
      var v = csl[k], z;
      if (!Array.isArray(v)) { return (v && v !== 'EmptySkill') ? String(v) : null; }
      for (z = 0; z < v.length; z++) {
        if (v[z] && v[z] !== 'EmptySkill') { return String(v[z]); }
      }
      return null;
    };
    /** 中身のある枠ぜんぶ（通常スキルは 2 本以上あることがある） */
    var gidAll = function (k) {
      var v = csl[k], z, out = [];
      if (!Array.isArray(v)) { return (v && v !== 'EmptySkill') ? [String(v)] : []; }
      for (z = 0; z < v.length; z++) {
        if (v[z] && v[z] !== 'EmptySkill') { out.push(String(v[z])); }
      }
      return out;
    };
    var lvOf = function (slot) { return (p.skillLv && p.skillLv[slot]) || 1; };
    var ng = gid('NormalSkillGroupId');
    // **通常スキルは 2 本以上あることがある**（2026-09-07）。イロハ（水着）は
    // `PublicSkillGroupId: ['CH0346Public01', 'CH0346Public02']` で、どちらも札切れで撃つ
    // （相棒向けの札 `Dummy_CH0346_Public01Trigger` ／ 自分向けの `..Public02Trigger`）。
    // 先頭だけ見ていて 2 本目が一度も出なかった。3 人（CH0187 は 3 本・CH0263・CH0346）
    var pgs = gidAll('PublicSkillGroupId'), pz, pg = pgs.length ? pgs[0] : null;
    var autos = [];
    for (pz = 0; pz < pgs.length; pz++) {
      autos.push({ pg: pgs[pz], auto: au.ls[pgs[pz]] ? nsAuto(au.ls[pgs[pz]]) : null });
    }
    if (!R.nsAutoBy) { R.nsAutoBy = {}; }
    R.nsAutoBy[au.key + '/' + (au.form || 0)] = autos.length === 1 ? autos[0] : { list: autos };
    au._ex = gid('ExSkillGroupId');
    au._pub = pg;
    au._pubLv = lvOf('Public');

    // 通常攻撃。**構え → 弾倉ぶん撃つ → リロード**を繰り返す
    var na = ng && au.ls[ng]
      ? naInfo(au.ls[ng], (p.stats || {}).NormalAttackSpeed,
               (p.stats || {}).AmmoCount, (p.stats || {}).AmmoCost) : null;
    if (na) {
      au._na = na;
      var shot = 0;
      var step = function (now) {
        if (au._gen !== gen || now > durMs) { return; }
        // **EX・NS の演出中は通常攻撃が止まる。明けたら構え直し（`AttackEnterDuration`）で、
        // 弾倉の数えは 0 から**（2026-09-07。旧い道 `na.js:naShots0` の `block` →
        // `t = b + frames(b).ent; k = 0` をそのまま写した）。ここが無くて、制服ネルが
        // 7.63 秒の EX の最中も撃ち続け、討伐までの通常攻撃が 23 発のところ 52 発だった
        if (au._busyUntil != null && au._busyUntil > now + 1e-6) {
          shot = 0;
          var re9 = au._busyUntil + na.ent;
          if (re9 <= durMs) { R.q.push(re9, step); }
          return;
        }
        if (au.alive) {
          // **射程の外では撃たない。**近づく（`stepApproach`）のを 0.1 秒ずつ待つ。弾倉の数えは進めない
          if (outOfRange(au, 'Normal')) { R.q.push(now + 100, step); return; }
          cast(R, au, ng, 'Normal', 1, now);
          au._shots++;
          for (var pq = 0; pq < autos.length; pq++) {
            if (autos[pq].auto && autos[pq].auto.kind === 'shots' && au._shots % autos[pq].auto.shots === 0) {
              cast(R, au, autos[pq].pg, 'Public', lvOf('Public'), now, { to: p.nsto });
            }
          }
          au._fireSS(now, 'attack');
          // 形態の終わり方が「装弾数」なら 1 発ぶんの `AmmoCost` を引く
          if (R.formEndTick) {
            R.formEndTick(au, 'ammo', now, (p.stats || {}).AmmoCost || 1);
          }
          if ((shot + 1) % na.mag === 0) {
            au._fireSS(now, 'reload');
            if (R.formEndTick) { R.formEndTick(au, 'reload', now, 1); }
          }
        }
        shot++;
        var nx = now + na.per;
        if (shot % na.mag === 0) { nx += na.rel; }
        if (nx <= durMs) { R.q.push(nx, step); }
      };
      R.q.push(from + (from === 0 ? na.ent : 0), step);
    }
    // 通常スキル。**周期のもの**
    //
    // **周期は戦闘開始から数え、形態が変わっても引き継ぐ**（2026-09-07）。
    // ここで `from + auto.ms` から数え直していて、制服ネルの NS が 18.9 秒の変身から
    // 35 秒後（53.9 秒）に出ていた。旧い道（`ns.js`、動画で確かめ済み）は 35.0 秒に
    // 満期 → EX の演出中なので明けた 41.4 秒に出る。`AutoUseRule` の `Interval` は
    // 時計であって、`FormConversion` に時計を戻す欄は無い。
    // **演出中（EX・NS のモーション）は撃たず、明けた瞬間に撃つ。次の満期は
    // 実際に撃った時刻から周期**（リオ 29.9 秒の EX → 36.6 秒 → 66.6 秒 → 96.6 秒）
    if (!au._nsN) { au._nsN = {}; }
    if (!au._nsDue) { au._nsDue = {}; }
    au._nsWatch = null;
    for (pz = 0; pz < autos.length; pz++) {
      (function (pg, auto) {
        if (!pg || !auto) { return; }
        if (auto.kind === 'interval' && auto.ms > 0) {
          if (au._nsDue[pg] == null) { au._nsDue[pg] = auto.ms; }
          var tick = function (now) {
            if (au._gen !== gen || now > durMs) { return; }
            // **回数の上限**（`MaxTriggerCount`）。形態が変わっても同じ枠の回数は引き継ぐ
            if (auto.max > 0 && (au._nsN[pg] || 0) >= auto.max) { return; }
            if (au._busyUntil != null && au._busyUntil > now + 1e-6) {
              R.q.push(au._busyUntil, tick);
              return;
            }
            if (au.alive) {
              cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
              au._nsN[pg] = (au._nsN[pg] || 0) + 1;
            }
            au._nsDue[pg] = now + auto.ms;
            if (au._nsDue[pg] <= durMs) { R.q.push(au._nsDue[pg], tick); }
          };
          R.q.push(Math.max(from, au._nsDue[pg]), tick);
        }
        // 通常スキル。**札が切れたら撃つもの**（`RemoveLogicEffectTemplateId`。`nsAuto` の注記）。
        // 札は `fire()` が貼るときに「切れる時刻」へ見張りを積む（`_nsWatch[札の種類]`）。
        // 切れた瞬間に生きている同じ札が無ければ撃つ。演出中なら明けてから
        if (auto.kind === 'onRemove') {
          var tickR = function (now) {
            if (au._gen !== gen || now > durMs) { return; }
            if (au._busyUntil != null && au._busyUntil > now + 1e-6) {
              R.q.push(au._busyUntil, tickR);
              return;
            }
            if (au.alive) {
              cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
            }
          };
          if (!au._nsWatch) { au._nsWatch = {}; }
          au._nsWatch[auto.tmpl] = tickR;
        }
      })(autos[pz].pg, autos[pz].auto);
    }
  };
  R.setupAlly = setupAlly;
  R.partyOf = function (au) {
    var z; for (z = 0; z < allies.length; z++) { if (allies[z] === au) { return party[z]; } }
    return null;
  };
  /** **形態は札から決める。**生きている `FormConversion` の札のいちばん新しいものの
      `FormIndex`、無ければ 0。変わったときだけ枠を積み直す。時間切れで戻るときは解除の演出
      （`ReleaseFormConversionDuration` コマ）のあいだ演出中。解除（Dispel）で戻るときは
      `UseImmediateFormReleaseOnDispel` が真なら即、偽なら同じ演出 */
  R.syncForm = function (u, now, byDispel) {
    var pp = R.partyOf(u), z, m, best = null, prev = u._formMark || null;
    if (!pp) { return; }
    for (z = 0; z < u.eff.length; z++) {
      m = u.eff[z];
      if (m.kind !== 'form') { continue; }
      if (m.until != null && m.until <= now + 1e-6) { continue; }
      if (!best || m.at > best.at) { best = m; }
    }
    var want = best ? (best.raw.formIndex != null ? best.raw.formIndex : 1) : 0;
    u._formMark = best;
    if (want === (u.form || 0)) { return; }
    if (want === 0 && prev && prev.raw.release > 0 && !(byDispel && prev.raw.immediate)) {
      var bu = now + prev.raw.release / FPS * 1000;
      if (u._busyUntil == null || bu > u._busyUntil) { u._busyUntil = bu; u._busyKind = 'Form'; }
    }
    // **形態の札で立つサブスキル（Event 30、引き金が `FormConversion` の札）は、
    // 形態が 0 に戻ったら剥がす**（説明文「集中射撃体勢中」。1 射目で起動の札が
    // 押し出されても体勢は続くので、引き金の札ではなく形態で見る）
    if (want === 0 && u._ssList) {
      var sl9 = u._ssList, q9, e9, l9, k9;
      for (q9 = 0; q9 < sl9.length; q9++) {
        e9 = sl9[q9];
        if (!e9.trig || e9.trig.when !== 'apply' || !e9.hit) { continue; }
        l9 = R.eff[e9.trig.param];
        k9 = l9 ? kindOfList(l9) : null;
        if (k9 === 'form') { condOff({ gid: e9.gid, u: u }, now); }
      }
    }
    u.form = want;
    setupAlly(u, pp, now);
  };

  /** **回数で終わる形態を控える**（`FormConversionEndCondition` 2 / 3 / 5。2026-09-08）。
      貼った札そのものを持っておいて、`formEndTick` が数え終わったら `until` を今にして切る。
      札が別の道（解除・押し出し）で先に消えていたら、控えも捨てる */
  R.formEndWatch = function (u, gid2, kind, need, at2) {
    var z, m;
    for (z = u.eff.length - 1; z >= 0; z--) {
      m = u.eff[z];
      if (m.kind === 'form' && m.gid === gid2) {
        (u._formEnd || (u._formEnd = [])).push({ m: m, kind: kind, left: need, at: at2 });
        return;
      }
    }
  };

  /** 数える。`what` は `'reload'`（リロード 1 回）・`'ammo'`（消費した弾数 `amt`）・
      `'ex'`（EX を 1 回）。**弾数はリロードの回数とは別勘定**（3 は消費した弾で、
      2 は弾倉を入れ替えた回数） */
  R.formEndTick = function (u, what, now, amt) {
    var fe = u._formEnd, z, e, cut = false;
    if (!fe || !fe.length) { return; }
    for (z = fe.length - 1; z >= 0; z--) {
      e = fe[z];
      if (u.eff.indexOf(e.m) < 0) { fe.splice(z, 1); continue; }
      if (!((e.kind === 2 && what === 'reload') || (e.kind === 3 && what === 'ammo') ||
            (e.kind === 5 && what === 'ex'))) { continue; }
      // **変身させた当の一発は数えない。**札を貼ったのと同じ刻みは飛ばす
      if (e.at != null && now <= e.at + 1e-6) { continue; }
      e.left -= (amt == null ? 1 : amt);
      if (e.left > 0) { continue; }
      e.m.until = now;
      fe.splice(z, 1);
      cut = true;
    }
    if (cut) { expire(u, now); R.syncForm(u, now, false); }
  };

  for (i = 0; i < allies.length; i++) {
    (function (au, p) {
      var csl = cslRow(au.pack, p, 0);
      var gid = function (k) {
        var v = csl[k];
        v = Array.isArray(v) ? v[0] : v;
        return (v && v !== 'EmptySkill') ? String(v) : null;
      };
      var lvOf = function (slot) { return (p.skillLv && p.skillLv[slot]) || 1; };

      // 常時のパッシブ（0 秒）
      var ps = gid('PassiveSkillGroupId'), es = gid('ExtraPassiveSkillGroupId');
      if (ps) { R.q.push(0, function (t) { cast(R, au, ps, 'Passive', lvOf('Passive'), t); }); }

      // ---- サブスキル（SS）と隠しパッシブの引き金（2026-09-07 に隠しパッシブを足した）
      //
      // `CharacterSkillListExcelTable` の `HiddenPassiveSkillGroupId` は生徒の内部処理で、
      // ここまで丸ごと置いていなかった。イブキ（水着）は 4 枚持っていて、
      // `HiddenPassive03`（Event 3 'Public'）が NS の発動と同時に 30 秒の札を貼り、
      // その札が切れると NS が出る（`RemoveLogicEffectTemplateId`）。置かないと NS が
      // 1 回きりになる。引き金の読み方は SS と同じ `ssTrig`。
      // **読めない引き金（Event 28 = コスト消費 など）は撃たずに `R.miss['hpEv:<番号>']` に数える**
      // （SS は元どおり「常時として置く」。SS はそれで動画と合っている）
      var ssList = [];
      if (es) { ssList.push({ gid: es, slot: 'ExtraPassive', trig: au.ls[es] ? ssTrig(au.ls[es]) : null, n: 0, hit: 0, last: -1e9 }); }
      var hps = csl.HiddenPassiveSkillGroupId || [], hz;
      for (hz = 0; hz < hps.length; hz++) {
        if (hps[hz] && hps[hz] !== 'EmptySkill' && au.ls[hps[hz]]) {
          ssList.push({ gid: String(hps[hz]), slot: 'HiddenPassive', trig: ssTrig(au.ls[hps[hz]]), n: 0, hit: 0, last: -1e9 });
        }
      }
      au._ssList = ssList;
      au._fireSS = function (now, kind, what) {
        var q9, e9, ss9;
        for (q9 = 0; q9 < ssList.length; q9++) {
          e9 = ssList[q9]; ss9 = e9.trig;
          if (!ss9 || ss9.when !== kind) { continue; }
          if (kind === 'cast' && ss9.param && ss9.param.indexOf(what) < 0) { continue; }
          if (kind === 'apply' && String(ss9.param || '') !== String(what || '')) { continue; }
          e9.n++;
          if (ss9.tries > 1 && e9.n % ss9.tries !== 0) { continue; }
          if (ss9.cool && now - e9.last < ss9.cool) { continue; }
          if (ss9.max >= 0 && e9.hit >= ss9.max) { continue; }
          if (ss9.rate < 10000 && R.rnd && R.rnd() * 10000 >= ss9.rate) { continue; }
          e9.last = now; e9.hit++;
          cast(R, au, e9.gid, e9.slot, e9.slot === 'ExtraPassive' ? lvOf('ExtraPassive') : 1, now);
        }
      };
      for (hz = 0; hz < ssList.length; hz++) {
        (function (e9) {
          var ss9 = e9.trig;
          // **常時（1 / 301）は 0 秒に 1 回。**SS は引き金が読めない型もここに落とす
          // （置かないより、常時として置くほうが元の `csl[0]` 時代と同じ）
          if (e9.slot === 'ExtraPassive' && (!ss9 || ss9.when === 'always' || ss9.when === null)) {
            R.q.push(0, function (t) { cast(R, au, e9.gid, e9.slot, lvOf('ExtraPassive'), t); });
          } else if (e9.slot === 'HiddenPassive' && ss9 && ss9.when === 'always' && ss9.ev === 1) {
            R.q.push(0, function (t) { cast(R, au, e9.gid, e9.slot, 1, t); });
          } else if (e9.slot === 'HiddenPassive' && (!ss9 || ss9.when == null || ss9.ev === 301)) {
            var k9 = 'hpEv:' + (ss9 ? ss9.ev : '?');
            R.miss[k9] = (R.miss[k9] || 0) + 1;
          }
          // **N コマ毎（105）**
          if (ss9 && ss9.when === 'every' && ss9.ms > 0) {
            for (var ts = ss9.ms; ts <= durMs; ts += ss9.ms) {
              (function (tt) { R.q.push(tt, function (now) { au._fireSS(now, 'every'); }); })(ts);
            }
          }
        })(ssList[hz]);
      }

      au._shots = 0;
      au._gen = 0;
      setupAlly(au, p, 0);
    })(allies[i], party[i]);
  }
  // EX は TL の指すとおりに。**行が `mc`（当たる体の数）と `f`（形態）を持てる**
  for (i = 0; i < (o.tl || []).length; i++) {
    (function (row) {
      var au = allies[row.i];
      if (!au) { return; }
      var fireEx = function (now) {
        // **NS の演出中のタップは、演出が明けてから出る**（旧い道 `ns.js` の `exStart`。2026-09-05 に動画で確認）
        if (au._busyKind === 'Public' && au._busyUntil != null && au._busyUntil > now + 1e-6) {
          R.q.push(au._busyUntil, fireEx);
          return;
        }
        // **枠は撃つ瞬間に読む。**変身していれば変身後の EX になる
        var gid = au._ex;
        // **形態の札は DB の枠名で撃つ**（2026-09-07。`bridge.js` の `formGid`）。画面の `f` は
        // SchaleDB の並びで `FormIndex` ではない。ミカ（水着）の 3 行が SelectEx01（何も起きない札）
        // に化けていた。on/off だけ来たら「態勢の切り替え」＝今の形態で決める
        if (row.gid) { gid = String(row.gid); }
        else if (row.on || row.off) { gid = (au.form || 0) ? (row.off || row.on) : (row.on || row.off); }
        else if (row.f) {
          var fr = cslRow(au.pack, party[row.i], row.f);
          var fv = fr.ExSkillGroupId, fz;
          if (Array.isArray(fv)) {
            fv = null;
            for (fz = 0; fz < (fr.ExSkillGroupId || []).length; fz++) {
              if (fr.ExSkillGroupId[fz] && fr.ExSkillGroupId[fz] !== 'EmptySkill') {
                fv = fr.ExSkillGroupId[fz]; break;
              }
            }
          }
          if (fv && fv !== 'EmptySkill') { gid = String(fv); }
        }
        if (!gid) { return; }
        cast(R, au, gid, 'Ex', (party[row.i].skillLv || {}).Ex || 1, now,
             { mc: row.mc, to: row.to });
        // 形態の終わり方が「EX の回数」なら 1 回ぶん引く。**変身させた EX そのものは
        // 数えない**（札はこの `cast` の中で貼られるので、控えるのはこの行より後）
        if (R.formEndTick) { R.formEndTick(au, 'ex', now, 1); }
      };
      R.q.push(row.at * 1000, fireEx);
    })(o.tl[i]);
  }

  // ---- ボスを動かす。**木（BossExternalBT）をそのまま回す**（2026-09-06）
  //
  // ここが無いあいだ、核は「ボスが棒立ちの的」を殴っているだけだった。
  // フェーズも通常攻撃も EX も無いので味方が一度も倒れず、答え合わせで
  // 31 本とも 240 秒ボスが生き残っていた（道具は 11 本討伐している）
  /** 湧いた子の常時札を引く。**`PassiveSkillGroupId` は配列で、6 本入ることがある。**
      先頭だけ引いていて、中サイズのペロロミニオンが自分を気絶させる
      `Perorozilla01InsaneMiddleSize01Passive02`（4 本目）が抜けていた。
      それが抜けると Ex09 が吸うものを見つけられず、グロッキーゲージが 1 も溜まらない
      （2026-09-06） */
  // **条件つき常時（`Event: 301`）の札。**0.1 秒ごとに式を見て、
  // 立ったら撃ち、落ちたらその札が置いたものを剥がす
  var condP = [];

  /** その枠が置く効果の `GroupId` ぜんぶ。剥がすときに要る */
  function gidsOfSkill(gid, doc) {
    if (R.pgCache[gid]) { return R.pgCache[gid]; }
    var ev = R.evCache[gid] || (R.evCache[gid] = skillEvents(doc)), m = {}, i;
    for (i = 0; i < ev.length; i++) { m[ev[i].gid] = 1; }
    return (R.pgCache[gid] = m);
  }

  /** 条件が落ちたので剥がす。**撃った本人が置いた札だけ**を、盤の全員から */
  function condOff(c, now) {
    var g = gidsOfSkill(c.gid, c.u.ls && c.u.ls[c.gid]), i, j, us = living(b);
    for (i = 0; i < us.length; i++) {
      for (j = us[i].eff.length - 1; j >= 0; j--) {
        if (g[us[i].eff[j].gid] && us[i].eff[j].src === c.u.key) {
          us[i].eff.splice(j, 1);
        }
      }
    }
    c.on = false;
  }

  /** 0.1 秒ごと。**式が読めなかったら撃たない**（`R.miss` に数える） */
  function pollCond(now) {
    var i, c, v;
    for (i = 0; i < condP.length; i++) {
      c = condP[i];
      if (!c.u.alive) { if (c.on) { condOff(c, now); } continue; }
      v = condExpr(c.tr.expr, R.ctx, c.u);
      if (v == null) {
        if (!c.warned) { c.warned = 1; R.miss['psExpr:' + c.tr.expr] = 1; }
        continue;
      }
      if (v && !c.on) { c.on = true; cast(R, c.u, c.gid, c.slot, 1, now); }
      else if (!v && c.on) { condOff(c, now); }
    }
  }

  function castPassives(mu, at, fi) {
    var cr = null, z, v, zf;
    for (zf = 0; mu.csl && zf < mu.csl.length; zf++) {
      if ((mu.csl[zf].FormIndex || 0) === (fi || 0)) { cr = mu.csl[zf]; break; }
    }
    if (!cr && !fi) { cr = mu.csl && mu.csl[0]; }
    if (!cr) { return; }
    var slots = [['PassiveSkillGroupId', 'Passive'],
                 ['ExtraPassiveSkillGroupId', 'ExtraPassive'],
                 ['HiddenSkillGroupId', 'Passive']];
    // この体ぶんの見張りは湧き直すたびに作り直す（前の生の分が残っていると二重に乗る）
    for (z = condP.length - 1; z >= 0; z--) {
      if (condP[z].u === mu) { condP.splice(z, 1); }
    }
    mu.onDead = [];
    mu.onApplied = {};
    for (z = 0; z < slots.length; z++) {
      v = cr[slots[z][0]];
      v = Array.isArray(v) ? v : (v ? [v] : []);
      for (var w2 = 0; w2 < v.length; w2++) {
        if (!v[w2] || v[w2] === 'EmptySkill') { continue; }
        var g = String(v[w2]), doc = mu.ls && mu.ls[g], tr = psTrig(doc);
        if (!tr) {
          var evn = (doc && doc.TriggerCondition && doc.TriggerCondition.Event);
          R.miss['psEv:' + evn] = (R.miss['psEv:' + evn] || 0) + 1;
          continue;
        }
        if (tr.when === 'always') {
          cast(R, mu, g, slots[z][1], 1, at);
        } else if (tr.when === 'cond') {
          condP.push({ u: mu, gid: g, slot: slots[z][1], tr: tr, on: false });
        } else if (tr.when === 'dead') {
          mu.onDead.push([g, slots[z][1]]);
        } else if (tr.when === 'applied') {
          (mu.onApplied[tr.tmpl] = mu.onApplied[tr.tmpl] || [])
            .push({ gid: g, slot: slots[z][1], tr: tr, n: 0 });
        } else if (tr.when === 'every' && tr.ms > 0) {
          (function (mu2, g2, sl2, ms) {
            var step2 = function (now) {
              if (!mu2.alive) { return; }
              cast(R, mu2, g2, sl2, 1, now);
              if (now + ms <= R.durMs) { R.q.push(now + ms, step2); }
            };
            R.q.push(at + ms, step2);
          })(mu, g, slots[z][1], tr.ms);
        }
      }
    }
  }

  var bst = null;

  // **引き金の式が読む 3 つ。**`ctxOf` は札と素の値しか知らないので、
  // 盤の側にしか無いもの（フェーズ・グロッキー）をここで足す
  R.ctx.phase = function () { return bst ? bst.phase : null; };
  R.ctx.groggy = function (u2) {
    return !!(u2 && u2.groggyUntil != null && b.t < u2.groggyUntil);
  };
  R.ctx.cover = function (u2, v2) { return R.coverState(u2, v2); };
  // **いま盤に居る、ボス以外の敵の数。**木の `CheckSummonCharacterCountUnder` 用
  R.minionCount = function () {
    var vs = living(b, 'enemy'), c = 0, z3;
    for (z3 = 0; z3 < vs.length; z3++) { if (vs[z3] !== bossU) { c++; } }
    return c;
  };
  // **幻影の数**（ゴズ。`TacticEntityType: Hallucination`）。木の `CheckHallucinationCount*` 用
  R.hallucinationCount = function () {
    var vs = living(b, 'enemy'), c = 0, z3;
    for (z3 = 0; z3 < vs.length; z3++) { if (vs[z3].kind === 'Hallucination') { c++; } }
    return c;
  };
  // **呼んだ子の数**（`TacticEntityType: Summoned`）。木の `CheckSummonCharacterCount*` 用。
  // `minionCount`（ボス以外ぜんぶ）だと、ホドの狙えない守衛塔 4 基が最初から数に入って
  // `CheckSummonCharacterCountOver 1 → ClearNormalSkill` が毎刻み立ち、通常攻撃の数えが進まない
  R.summonCount = function () {
    var vs = living(b, 'enemy'), c = 0, z3;
    for (z3 = 0; z3 < vs.length; z3++) { if (vs[z3].kind === 'Summoned') { c++; } }
    return c;
  };
  // **形態が変わった合図**（敵）。本体なら木の枠を引き直す
  R.onForm = function (u2, fi, at) {
    if (u2 === bossU) {
      if (bst && bst.setForm) { bst.setForm(fi, at); }
      castPassives(u2, at, fi);
    }
  };
  // **札が貼られた合図をボスの木へ**（`ApplyLogicEffectTemplateId`）と、
  // **その札が付いたら撃つ常時札へ**（`TriggerCondition.Event 18`。`psTrig` の注記）
  R.onApply = function (tg2, tmpl, at, castId) {
    if (bst && bst.onTemplate && tmpl) { bst.onTemplate(String(tmpl), at, castId); }
    if (tmpl) { fireApplied(tg2, String(tmpl), at); }
  };
  /** `Event 18` の見張り。**貼られた体の上の、その札の名前の見張りだけ撃つ。**
      撃った札がまた札を貼るので、`_ap18` で入れ子を 1 段に止める
      （止めないとホドの仮設タワーが自分の札で自分を呼び続ける） */
  var ap18 = 0;
  function fireApplied(u2, tmpl, at) {
    if (!u2 || !u2.onApplied || ap18) { return; }
    var ws = u2.onApplied[tmpl];
    if (!ws || !ws.length) { return; }
    ap18 = 1;
    try {
      for (var z8 = 0; z8 < ws.length; z8++) {
        var w8 = ws[z8];
        // `MaxTriggerCount` は −1 と 0 が「何度でも」
        if (w8.tr.max > 0 && w8.n >= w8.tr.max) { continue; }
        if (w8.tr.expr) {
          var v8 = condExpr(w8.tr.expr, R.ctx, u2);
          if (v8 == null) {
            R.miss['psExpr:' + w8.tr.expr] = (R.miss['psExpr:' + w8.tr.expr] || 0) + 1;
            continue;
          }
          if (!v8) { continue; }
        }
        w8.n++;
        cast(R, u2, w8.gid, w8.slot, 1, at);
      }
    } finally { ap18 = 0; }
  }
  R.ctx.ggRate = function (u2) {
    if (!u2) { return 0; }
    var need = (u2.base && u2.base.GroggyGauge) || 0;
    var byDmg = (need && u2.maxHp && need <= u2.maxHp * 20)
      ? Math.round((u2.ggDmg || 0) / need * 10000) : 0;
    return Math.max(u2.gg || 0, byDmg);
  };

  /** 合図 `tag` の湧き点を起こす。**同じ実体が何度も湧くので、
      死んでいる体から順に使い回す**（束には 5〜30 体ぶん入っている） */
  function spawn(tag, at) {
    if (!bd) { return 0; }
    var pts = spawnFor(bd, sec, tag), n = 0, z;
    for (z = 0; z < pts.length; z++) {
      if (otherBoss[pts[z].dev]) { continue; }
      var pool = byDev[pts[z].dev] || [], w;
      for (w = 0; w < pool.length; w++) {
        var mu = pool[w];
        if (mu.alive) { continue; }
        mu.alive = true;
        mu.hp = mu.maxHp;
        mu.pos = pts[z].pos || null;
        mu.eff = [];
        n++;
        castPassives(mu, at);
        if (mu === bossU) { startBoss(at); }
        break;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- 節の進行
  //
  // **1 枚目の盤には道のりがまるごと書いてある**（2026-09-07。先生の
  // 「足りない場合材料を徹底的に探すをデフォルトにして」を受けて数え直した）。
  // 核はこれを全部飛ばして最初からボスの前に立っていた。
  //
  //     ケセド大決戦  節 0 で z 17.9 まで進む → 雑魚の波 → 全滅 → 7.5 秒 → 節 1
  //                   → z 42.1 → 波 → 全滅 → 節 2 → z 125.0 → 節 3（玉座の間）
  //     ペロロジラ    節 0 でボスと戦う → 段が変わる → 8 秒 → 節 1 で z 83.7 まで進む
  //                   → 節 2 でまた戦う（同じ形が 4 回）
  //
  // 陣形の目印は `Formations`、進む先は `walkTo`、速さは `MoveSpeed`
  // （アルは 200。盤の単位はスキルの射程と同じ 1/100 なので **2 単位/秒**）。
  // ケセドは目印が y 6.0 → 125.0 で、通路だけで 59.5 秒になる。
  //
  // 次の節へ移る合図は 3 つ。`boardPlan` の `next` に入っている:
  //   `EndWave`   その節の雑魚を片付けたら
  //   `ph:N`      ボスの段が N になったら（`waits` に移るまでの待ちが入る）
  //   `Area`      進む先に着いたら
  var walkGoal = null, secWait = -1, secPhase = null, secTo = -1, secVia = null, sawFoe = false;
  /** その節の隊列の目印（`Formations`。`Index` がいちばん大きいもの＝終点） */
  function beaconOf(i2) {
    var f = (bd && bd.formations) || [], z9, best = null;
    for (z9 = 0; z9 < f.length; z9++) {
      if (f[z9].SectionIndex === i2 && !f[z9].IsEnemy
          && (!best || (f[z9].Index || 0) > (best.Index || 0))) { best = f[z9]; }
    }
    return best ? { x: (best.Position || {}).x || 0, y: (best.Position || {}).y || 0 } : null;
  }
  /** 盤の点の座標（湧き点の `CommandIdList` の名前で引く。どの節でも） */
  function groundPoint(id) {
    var z9, w9, secs9 = (bd && bd.sections) || [];
    for (z9 = 0; z9 < secs9.length; z9++) {
      var pts9 = secs9[z9].points || [];
      for (w9 = 0; w9 < pts9.length; w9++) {
        if ((pts9[w9].cmds || []).indexOf(id) >= 0 && pts9[w9].pos) {
          var p9 = pts9[w9].pos;
          return { x: p9.x || 0, y: p9.z != null ? p9.z : (p9.y || 0) };
        }
      }
    }
    return null;
  }
  /** 本体を盤の点へ（飛ぶ／歩く。歩きは `stepApproach` が `goal` へ運ぶ） */
  function bossGo(bt, at) {
    var p9 = bt && groundPoint(bt.id);
    if (!p9 || !bossU) { if (bt) { R.miss['bossTo:' + bt.id] = 1; } return; }
    if (bt.instant) { bossU.pos = { x: p9.x, y: p9.y }; bossU.goal = null; }
    else { bossU.goal = { x: p9.x, y: p9.y }; }
    moveLog.push([Math.round(at / 100) / 10, bossU.key, bossU.pos ? Math.round(bossU.pos.x * 10) / 10 : null, bossU.pos ? Math.round(bossU.pos.y * 10) / 10 : null, bt.id, bt.instant ? 'jump' : 'walk']);
  }
  /** 隊列を目印へ（飛ぶ／歩く） */
  function formationGo(dest, instant, at) {
    if (!dest || !org) { return; }
    logEv(at, 'move', instant ? 'jump' : 'walk');
    if (instant) {
      org.Position.x = dest.x; org.Position.y = dest.y;
      walkGoal = null; moveAllies(); takeCover(null, at);
    } else {
      walkGoal = { x: dest.x, y: dest.y };
    }
  }

  /** その節の最後の目印（`Formations` の `Index` がいちばん大きいもの）。 */
  function beaconY(i2) {
    var f = (bd && bd.formations) || [], z9, best = null;
    for (z9 = 0; z9 < f.length; z9++) {
      if (f[z9].SectionIndex === i2 && !f[z9].IsEnemy
          && (!best || (f[z9].Index || 0) > (best.Index || 0))) { best = f[z9]; }
    }
    return best ? (best.Position || {}).y : null;
  }

  function moveAllies() {
    var z9;
    for (z9 = 0; z9 < allies.length; z9++) {
      allies[z9].pos = slotPos(org, formRow, allies[z9].slot);
      allies[z9].home = null;
      allies[z9].cover = null;
    }
  }

  /** その節の湧き点のうち、命令 id が `cmd` のものを起こす（`GroundCommandWave`）。 */
  /** **湧いてから動き出すまで**（ms）。`CharacterExcelTable.AppearFrame` を 30 コマ/秒で読む
      （ケセドの召喚ドロイド 65 コマ＝ 2.17 秒、本体 20 コマ。2026-09-07）。
      動画（QnKBiKMMUQE の 98〜101 秒）では湧いた体が 2 秒ほど湧き位置に立ってから歩き出す。
      核はその間も体を狙える（HP バーは湧いた瞬間から出ている）。本体の木もこの刻から回す */
  function appearMs(u2) { return Math.round(((u2 && u2.appear) || 0) * 1000 / 30); }
  /** 湧き点 1 つぶんを起こす。**体は湧く刻に起こす**（`delay` のぶん遅れて） */
  function spawnAt(pt, at) {
    var pool = byDev[pt.dev] || [], mu2 = null, w6;
    for (w6 = 0; w6 < pool.length; w6++) {
      if (!pool[w6].alive) { mu2 = pool[w6]; break; }
    }
    // 本体は増やさない（同じ命令が 2 度来ても 2 体目の本体は作らない）
    if (!mu2 && !(pool.length && pool[0] === bossU)) { mu2 = moreBody(pt.dev); }
    if (!mu2) { return false; }
    mu2.alive = true; mu2.hp = mu2.maxHp; mu2.eff = []; mu2.pos = pt.pos || null;
    mu2.appearUntil = at + appearMs(mu2);
    castPassives(mu2, at);
    if (mu2 === bossU) { startBoss(mu2.appearUntil); }
    return true;
  }
  /** 命令 `cmd` の湧き点をぜんぶ起こす。**点ごとの `Delay` を守る**（2026-09-07。
      同時に出していて、ケセドの節 0 の 15 体が 1 扇で消え、波が 4 秒で終わっていた。
      DB は 0〜10 秒に散らしている）。全部が湧いたら `done()`。合図の記録は最初の体の刻に 1 回 */
  function spawnCmd(cmd, at, done) {
    if (!bd || !bd.sections[sec]) { if (done) { done(at); } return 0; }
    var pts = bd.sections[sec].points, n = 0, z6, left, first = null;
    var list = [];
    for (z6 = 0; z6 < pts.length; z6++) {
      var pt = pts[z6];
      if (!pt.dev || otherBoss[pt.dev]) { continue; }
      if (cmd && (pt.cmds || []).indexOf(cmd) < 0) { continue; }
      list.push(pt);
      if (first == null || (pt.delay || 0) < first) { first = pt.delay || 0; }
    }
    left = list.length;
    if (!left) { if (done) { done(at); } return 0; }
    for (z6 = 0; z6 < list.length; z6++) {
      (function (pt2) {
        var t6 = at + (pt2.delay || 0);
        R.q.push(t6, function (now) {
          if (spawnAt(pt2, now)) { n++; }
          if ((pt2.delay || 0) === first) { logEv(now, 'spawn', 'wave:' + sec); }
          left--;
          if (left === 0 && done) { done(now); }
        });
      })(list[z6]);
    }
    return list.length;
  }

  /** その節の波を出す。**波は順番**（2026-09-07）。`GroundCommandWave.Waves[]` は
      1 波目を片付けてから `WaveDelay` 置いて 2 波目が出る（ケセドの節 0〜2 は
      同じ湧き点に命令 1 と 2 が重なっていて、同時に出すと 2 倍湧く）。
      `EndWave` は最後の波まで片付いてから */
  var waveQ = [], waveLive = false, waveSpawned = false;
  function fireWave(at) {
    var sc2 = bd.sections[sec] || {};
    waveQ = (sc2.wave || []).slice();
    waveLive = false; waveSpawned = false;
    nextWave(at);
  }
  function nextWave(at) {
    if (!waveQ.length) { return; }
    var w7 = waveQ.shift(), t7 = at + (w7.delay || 0);
    if (t7 > R.durMs) { return; }
    waveLive = true; waveSpawned = false;
    R.q.push(t7, function (now) { spawnCmd(w7.cmd, now, function () { waveSpawned = true; }); });
  }

  /** その節に入る。**立ち位置は持ち回る**（前の節の終わりに立っていた場所）。 */
  /** 節の途中の移動（`ForceMove…` を持つ、節を進めない事象）。合図が揃った刻に 1 回。
      行き先は次の節の目印（ケセドの節 2: z 54 の区画に入ったら (0, 125) へ飛ぶ） */
  function runMoves(at) {
    var sc3 = (bd && bd.sections[sec]) || {}, mvs = sc3.moves || [], z12, w12;
    for (z12 = 0; z12 < mvs.length; z12++) {
      if (mvs[z12].done) { continue; }
      var ok12 = mvs[z12].tags.length > 0;
      for (w12 = 0; w12 < mvs[z12].tags.length; w12++) { if (!tagOk(mvs[z12].tags[w12])) { ok12 = false; } }
      if (!ok12) { continue; }
      mvs[z12].done = 1;
      var to2 = (sc3.starts && sc3.starts[0]) ? sc3.starts[0].to : sec + 1;
      if (mvs[z12].beacon) { formationGo(beaconOf(to2) || beaconOf(sec), mvs[z12].beacon.instant, at); }
      if (mvs[z12].bossTo) { bossGo(mvs[z12].bossTo, at); }
    }
  }
  function enterSection(i2, at, via) {
    sec = i2;
    if (R.secLog) {
      R.secLog.push([Math.round(at / 100) / 10, i2,
                     org ? Math.round(org.Position.y * 10) / 10 : null]);
    }
    readPositions();
    obs = bd ? obstacleBoxes(bd, sec, common) : [];
    cpts = bd ? coverPoints(bd, sec, common, obs) : [];
    var sc2 = bd.sections[sec] || {};
    walkGoal = (sc2.walkTo != null && org) ? { x: org.Position.x, y: sc2.walkTo } : null;
    if (walkGoal) { logEv(at, 'move', 'walk'); }
    secWait = -1; secTo = -1; secVia = null; secPhase = null; sawFoe = false;
    waveQ = []; waveLive = false; waveSpawned = false;
    spawn('start', at);
    // **節を進めた事象に付いていた移動**（`ForceMoveToFormationBeacon` /
    // `ForceMoveToGroundPoint`。ビナーの段 1: 隊列は節 1 の目印 (1.06, −14.12) へ歩き、
    // 本体は `1PhaseBinahPoint` (7.69, −3.29) へ歩く。2026-09-07）
    // **段替わりの移動は時計の外**（2026-09-07）。ビナーの段 1 で隊列と本体が歩く 8 秒ほどの間、
    // 動画のタイマーは 2.7 秒しか進まない（IrVUx0ywuyo の OCR: 12.17M のまま 71.8 → 74.5 秒）。
    // 演出の間は時計が止まるので、戦闘時間の上では一瞬で着く
    var phaseMove = false, z14;
    for (z14 = 0; via && z14 < via.tags.length; z14++) { if (String(via.tags[z14]).indexOf('ph:') === 0) { phaseMove = true; } }
    if (via && via.beacon) { formationGo(beaconOf(sec), via.beacon.instant || phaseMove, at); }
    if (via && via.bossTo) { bossGo(Object.assign({}, via.bossTo, { instant: via.bossTo.instant || phaseMove }), at); }
    // **節が始まった合図で飛ぶ移動**（`SectionStarted` の `IsInstantMove`）。
    // 行き先は次の節の目印——ケセドの節 2 は 42.1 → 125.0 の 83 単位で、歩かせると
    // 41 秒かかるが実際は一瞬。ビナーの段 2 も (22.56, −100.65) へ暗転して飛ぶ
    var mvs = sc2.moves || [], z12;
    for (z12 = 0; z12 < mvs.length; z12++) { mvs[z12].done = 0; }
    runMoves(at);
    if (walkGoal == null && !(via && via.beacon)) {
      // 歩かない節は入った席のまま隠れる。歩く節は着いてから（`takeCover` は歩き終わりで）
      takeCover(null, at);
    }
    if (walkGoal == null) { fireWave(at); }
  }

  /** 合図が satisfied か。**読めない合図は満たさない**（勝手に進まない）。 */
  function tagOk(tag) {
    if (tag === 'start') { return true; }
    if (tag === 'EndWave' || tag === 'CharactersDead') {
      return sawFoe && R.minionCount() === 0 && !waveLive && !waveQ.length;
    }
    // **`CharactersDead:<名前>` は「その名前の湧き点で出た体が全部死んだら」。**
    // カイテンジャーの `ConditionDeadDummyBoss` はレンジャーの棒を指していて、
    // 5 人を倒すことではなく**棒が 0 になること**が節 2 へ進む合図
    // （そのあと `GroundCommandCharacterDie` で 5 人が消える。2026-09-07）
    if (tag.indexOf('CharactersDead:') === 0) {
      var cid3 = tag.slice(15), any3 = false, z3, w3;
      var pts3 = ((bd && bd.sections[sec]) || {}).points || [];
      for (z3 = 0; z3 < pts3.length; z3++) {
        if ((pts3[z3].cond || []).indexOf(cid3) < 0) { continue; }
        var pool3 = byDev[pts3[z3].dev] || [];
        for (w3 = 0; w3 < pool3.length; w3++) {
          any3 = true;
          if (pool3[w3].hp > 0) { return false; }
        }
      }
      return any3 ? true : (sawFoe && R.minionCount() === 0);
    }
    if (tag.indexOf('ph:') === 0) {
      return !!bst && secPhase != null && bst.phase !== secPhase
        && String(bst.phase) === tag.slice(3);
    }
    if (tag === 'Area') { return walkGoal == null; }
    return false;
  }

  /** 0.1 秒ごと。歩く・波を出す・次の節へ移る。 */
  /** 合図で体を消す（`GroundCommandCharacterDie`）。**湧き点の命令 id で選ぶ。** */
  function killByCmd(cmds, devs) {
    var pts4 = ((bd && bd.sections[sec]) || {}).points || [], z4, w4, q4;
    for (z4 = 0; z4 < pts4.length; z4++) {
      var hit4 = false;
      for (q4 = 0; q4 < (cmds || []).length; q4++) {
        if ((pts4[z4].cmds || []).indexOf(cmds[q4]) >= 0) { hit4 = true; }
      }
      for (q4 = 0; q4 < (devs || []).length; q4++) {
        if (pts4[z4].dev === devs[q4]) { hit4 = true; }
      }
      if (!hit4) { continue; }
      var pool4 = byDev[pts4[z4].dev] || [];
      for (w4 = 0; w4 < pool4.length; w4++) {
        if (pool4[w4].alive) { pool4[w4].hp = 0; }
      }
    }
  }

  /** 湧き点の命令 id で体を引く（盤ぜんぶの節から。本体は節 0 の点で湧いている） */
  function unitsByCmd(cmds) {
    var out = [], z4, w4, q4, s4;
    for (s4 = 0; bd && s4 < bd.sections.length; s4++) {
      var pts4 = bd.sections[s4].points || [];
      for (z4 = 0; z4 < pts4.length; z4++) {
        var hit4 = false;
        for (q4 = 0; q4 < (cmds || []).length; q4++) {
          if ((pts4[z4].cmds || []).indexOf(cmds[q4]) >= 0) { hit4 = true; }
        }
        if (!hit4 || !pts4[z4].dev) { continue; }
        var pool4 = byDev[pts4[z4].dev] || byDev[noArm2(pts4[z4].dev)] || [];
        for (w4 = 0; w4 < pool4.length; w4++) {
          if (pool4[w4].alive && out.indexOf(pool4[w4]) < 0) { out.push(pool4[w4]); }
        }
      }
    }
    return out;
  }

  /** 盤が状態を付け外しする（`GroundCommandSetStatus`）。外すときは
      その状態の札を全部落とす（ホドの `Untargetable` は `IsDispellable` が無い札） */
  function setStatus(u2, status, add, at) {
    var z, n = 0;
    if (!add) {
      for (z = u2.eff.length - 1; z >= 0; z--) {
        var rw = u2.eff[z].raw;
        if (rw && rw.kind === 'status' && rw.status === status) { u2.eff.splice(z, 1); n++; }
      }
      if (R.secLog) { R.secLog.push([Math.round(at / 100) / 10, 'status-', u2.key + ':' + status + ':' + n]); }
      return n;
    }
    applyMark(u2, { gid: 'Ground_' + status, tmpl: 'Ground_' + status, kind: 'status', status: status,
                    cat: 7, dur: null, ch: 0, disp: false, slot: 'Ground' }, 'ground', at, 1);
    if (R.secLog) { R.secLog.push([Math.round(at / 100) / 10, 'status+', u2.key + ':' + status]); }
    return 1;
  }

  /** 盤が撃つ技（`GroundCommandUseSkill`）。撃つのは盤に立たない地面の体で、
      狙う先は命令 id で名指しされた体（`force`） */
  var groundU = null;
  function castGround(gid, targets, at) {
    if (!boss.ls || !boss.ls[gid]) { R.miss['ground:' + gid] = (R.miss['ground:' + gid] || 0) + 1; return; }
    if (!groundU) {
      groundU = makeUnit({ key: 'ground', side: 'enemy', charId: 18001002, dev: 'Ground', kind: 'Ground',
                           lv: 90, hp: 1, maxHp: 1, base: {} });
      groundU.ls = boss.ls; groundU.skillLv = {}; groundU.alive = true; groundU.eff = [];
    }
    R.q.push(at, function (now) {
      if (R.secLog) { R.secLog.push([Math.round(now / 100) / 10, 'ground', gid]); }
      cast(R, groundU, gid, 'Ex', 1, now, { force: targets });
    });
  }

  function stepSection(t7, dt) {
    if (!bd || !org) { return; }
    var sc2 = bd.sections[sec] || {};
    if (secPhase == null && bst) { secPhase = bst.phase; }
    if (R.minionCount() > 0) { sawFoe = true; }
    // ---- 波を片付けたら次の波
    if (waveLive && waveSpawned && R.minionCount() === 0) {
      waveLive = false; waveSpawned = false;
      nextWave(t7);
    }
    // ---- 歩く。**いちばん遅い子に合わせる**（隊列は崩れない）
    if (walkGoal != null) {
      var sp = 1e9, z8, vs8 = living(b, 'ally');
      for (z8 = 0; z8 < vs8.length; z8++) {
        var ms = (statsNow(vs8[z8]).MoveSpeed || 200) / 100;
        if (ms < sp) { sp = ms; }
      }
      if (!vs8.length) { sp = 2; }
      var dx8 = walkGoal.x - org.Position.x, dy8 = walkGoal.y - org.Position.y;
      var dd8 = Math.sqrt(dx8 * dx8 + dy8 * dy8), mv = sp * dt / 1000;
      if (dd8 <= mv) {
        org.Position.x = walkGoal.x; org.Position.y = walkGoal.y;
        walkGoal = null;
        takeCover(null, t7);
        fireWave(t7);
      } else {
        // **歩いている間だけ席へ戻す。**着いた刻は `takeCover` が置いた場所を崩さない
        //（崩すと次の刻に射程の外と見て歩き直し、空いた遮蔽が無くなる。2026-09-07）
        org.Position.x += dx8 / dd8 * mv; org.Position.y += dy8 / dd8 * mv;
        moveAllies();
      }
      R.walked = Math.round(org.Position.y * 10) / 10;
      return;
    }
    // ---- 節の途中の移動（区画に入ったら飛ぶ、など）
    runMoves(t7);
    // ---- 合図で消える体（`GroundCommandCharacterDie`）
    var dl = sc2.dies || [], z10, w10;
    for (z10 = 0; z10 < dl.length; z10++) {
      if (dl[z10].done) { continue; }
      var ok10 = dl[z10].tags.length > 0;
      for (w10 = 0; w10 < dl[z10].tags.length; w10++) {
        if (!tagOk(dl[z10].tags[w10])) { ok10 = false; }
      }
      if (!ok10) { continue; }
      dl[z10].done = 1;
      killByCmd(dl[z10].cmds, dl[z10].devs);
    }
    // ---- 盤が付け外しする状態（`GroundCommandSetStatus`）と、盤が撃つ技（`GroundCommandUseSkill`）
    var sl = sc2.status || [], z11, w11;
    for (z11 = 0; z11 < sl.length; z11++) {
      if (sl[z11].done) { continue; }
      var ok11 = sl[z11].tags.length > 0;
      for (w11 = 0; w11 < sl[z11].tags.length; w11++) { if (!tagOk(sl[z11].tags[w11])) { ok11 = false; } }
      if (!ok11) { continue; }
      sl[z11].done = 1;
      (function (row, us11) {
        R.q.push(t7 + (row.delay || 0), function (now) {
          var w12;
          for (w12 = 0; w12 < us11.length; w12++) { setStatus(us11[w12], row.status, row.add, now); }
        });
      })(sl[z11], unitsByCmd([sl[z11].cmd]));
    }
    var gl2 = sc2.skills || [], z12, w12;
    for (z12 = 0; z12 < gl2.length; z12++) {
      if (gl2[z12].done) { continue; }
      var ok12 = gl2[z12].tags.length > 0;
      for (w12 = 0; w12 < gl2[z12].tags.length; w12++) { if (!tagOk(gl2[z12].tags[w12])) { ok12 = false; } }
      if (!ok12) { continue; }
      gl2[z12].done = 1;
      var tg12 = unitsByCmd(gl2[z12].to || []);
      if (tg12.length) { castGround(gl2[z12].gid, tg12, t7 + (gl2[z12].delay || 0)); }
      else { R.miss['ground:的なし:' + gl2[z12].gid] = (R.miss['ground:的なし:' + gl2[z12].gid] || 0) + 1; }
    }
    // ---- 次の節へ移る合図。節の側と `Global` の両方を見る
    if (secWait < 0) {
      var lst = (sc2.starts || []).concat(bd.globalStarts || []), z9, w9;
      for (z9 = 0; z9 < lst.length; z9++) {
        var st9 = lst[z9];
        if (!(st9.to > sec) || !bd.sections[st9.to]) { continue; }
        var ok9 = st9.tags.length > 0;
        for (w9 = 0; w9 < st9.tags.length; w9++) {
          if (!tagOk(st9.tags[w9])) { ok9 = false; }
        }
        if (ok9) { secWait = t7 + (st9.wait || 0); secTo = st9.to; secVia = st9; break; }
      }
    }
    if (secWait >= 0 && t7 >= secWait && bd.sections[secTo]) {
      enterSection(secTo, t7, secVia);
    }
  }

  /** **空きが無いときは体を 1 つ増やす**（2026-09-07）。

      束の `ent` は **DevName 1 つにつき 1 行**しか無い面がある（ケセドがそれ。
      ボス 1 ＋ 雑魚 6 種で 7 行）。使い回しだけだと**同時に 6 体までしか湧けず**、
      ケセドの EX が 1 回で 22 体呼ぶ台本（`CharacterEntityDAO` が 22 個）でも
      22 体にならなかった。倒した数がグロッキーゲージになるボスでは、
      ここが頭打ちになると鎖が始まらない。上限は 60 体（暴走よけ）。 */
  function moreBody(dev) {
    var pool = byDev[dev] || (byDev[dev] = []);
    if (!pool.length || pool.length >= 60) { return null; }
    var src = pool[0];
    var u2 = add(b, makeUnit({
      key: src.key + '#' + pool.length, side: 'enemy', charId: src.charId, dev: dev,
      kind: src.kind, lv: src.lv, armor: src.armor, bullet: src.bullet,
      adapt: src.adapt, radius: src.radius, personality: src.personality, move: src.move, appear: src.appear,
      aiId: src.aiId, role: src.role, school: src.school, squad: src.squad,
      hp: src.maxHp, maxHp: src.maxHp, base: src.base,
    }));
    u2.ls = src.ls;
    u2.skillLv = src.skillLv;
    u2.csl = src.csl;
    u2.alive = false;
    pool.push(u2);
    return u2;
  }

  /** 木が呼んだ実体を 1 体起こす。**名前は綴りが違うので当て直す。** */
  /** **呼んだ体の向き。**敵は味方陣（y の小さい側）を、味方は敵陣を向いているものとする。
      盤の体は `Direction` を持つが、戦闘中は狙う相手のほうを向くので、陣の向きで足りる */
  function facingOf(u2) {
    return u2 && u2.side === 'enemy' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }
  /** **湧く座標。**`SpawnPositionType` Invoker ＝ 呼んだ体の足元、`PositionOffset` は
      `OffsetDirectionType` Invoker なら呼んだ体の向きで回す（前 = 向き、右 = (fy, −fx)。
      `board.js` の箱と同じ約束）。知らない種類は足元に置いて `R.miss` に数える */
  function summonPos(by, sv) {
    if (!by || !by.pos) { return null; }
    var o = (sv && sv.off) || { x: 0, y: 0 }, f = facingOf(by);
    if (sv && sv.spos && sv.spos !== 'Invoker') {
      R.miss['spos:' + sv.spos] = (R.miss['spos:' + sv.spos] || 0) + 1;
    }
    if (sv && sv.odir && sv.odir !== 'Invoker') {
      R.miss['odir:' + sv.odir] = (R.miss['odir:' + sv.odir] || 0) + 1;
      return { x: by.pos.x + o.x, y: by.pos.y + o.y };
    }
    return { x: by.pos.x + o.x * f.y + o.y * f.x, y: by.pos.y + o.x * (-f.x) + o.y * f.y };
  }
  R.summon = function (name, at, by, sv) {
    var dev = R.devFix[name];
    if (dev === undefined) { dev = R.devFix[name] = resolveDev(name, byDev); }
    if (!dev) { R.miss['summon:' + name] = (R.miss['summon:' + name] || 0) + 1; return; }
    if (otherBoss[dev]) { return; }
    var pool = byDev[dev] || [], w, mu = null;
    for (w = 0; w < pool.length; w++) {
      if (!pool[w].alive && pool[w] !== bossU) { mu = pool[w]; break; }
    }
    if (!mu) { mu = moreBody(dev); }
    if (!mu) { return; }
    mu.alive = true; mu.hp = mu.maxHp; mu.eff = []; mu.pos = summonPos(by, sv) || (by && by.pos) || null;
    mu.appearUntil = at + appearMs(mu);
    R.summoned++;
    logEv(at, 'spawn', 'summon');
    castPassives(mu, at);
  };
  R.devFix = {};

  // **グロッキー。**ゲージが `GroggyGauge` に届いたら `GroggyTime` のあいだ。
  // その間は会心が確定し、盤の台本が `st:Groggy` の湧きを出す
  // （ペロロジラは Immortal の小さなペロロミニオンで、受けたダメージを本体へ流す）
  function intoGroggy(u2, at) {
    if (u2.groggyUntil != null && at < u2.groggyUntil) { return; }
    if (u2.ggImmune) { return; }
    u2.gg = 0; u2.ggDmg = 0;
    var gt = (u2.base && u2.base.GroggyTime) || 0;
    u2.groggyUntil = at + gt;
    R.groggy.push([at / 1000, gt / 1000]);
    spawn('st:Groggy', at);
    if (u2 === bossU && bst && bst.applyGroggy) { bst.applyGroggy(at); }
  }
  R.onGroggy = function (u2, at) {
    if ((u2.gg || 0) < 10000) { return; }
    intoGroggy(u2, at);
  };
  // **ダメージで溜まるほうのグロッキー**（2026-09-06。ここが無かった）。
  //
  // `CharacterStatExcelTable.GroggyGauge` が目盛りで、**受けたダメージがそのまま
  // 溜まる。**ビナー 6,500,000／シロクロ 22,000,000／ゴズ 40,000,000／
  // ヒエロニムス 9,000,000。**吸って溜めるボスだけが 1,000,000,000** で、
  // これは HP の 20 倍を越える＝ダメージでは届かない印
  // （`js/carry.js:ggMode` の「実質なし」の見分け方をそのまま使う）。
  // 溜まりきると `GroggyTime` のあいだグロッキーで、会心が確定する
  R.onDamaged = function (u2, dmg, at) {
    var need = (u2.base && u2.base.GroggyGauge) || 0;
    if (!need || !u2.maxHp || need > u2.maxHp * 20) { return; }
    if (u2.groggyUntil != null && at < u2.groggyUntil) { return; }
    u2.ggDmg = (u2.ggDmg || 0) + dmg;
    if (u2.ggDmg >= need) { intoGroggy(u2, at); }
  };

  /** 本体の木を回し始める。最初から居る本体は 0 秒、盤が途中で湧かせる本体は湧いた瞬間 */
  function startBoss(at) {
    if (bst || o.bossActs === false) { return; }
    try {
      var plan = bossPlan(boss, bossU.charId);
      var waits = phaseWaits(boss.board);
      bst = driveBoss({
        R: R, u: bossU, plan: plan, waits: waits, durMs: durMs, t0: at,
        outOfRange: function (u9) { return outOfRange(u9, 'Normal'); },
        cast: function (cu, gid, slot, lv, at2) { cast(R, cu, gid, slot, lv, at2); },
      });
    } catch (e) {
      R.bossErr = String(e && e.message || e);
    }
  }
  if (!bossLate) { startBoss(0); }
  // **節の最初から居る敵**（ボス以外に前座が居る盤がある）。
  // ここから節の進行が始まる（歩く → 波 → 片付ける → 次の節）
  enterSection(0, 0);
  // **本体の常時札。**最初から居る本体はここで（湧く本体は `spawn` が引く）。
  // ゴズの `GozInsanePassive01` が丸ごと抜けていた（2026-09-06）
  if (!bossLate && !bossU._psDone) { castPassives(bossU, 0); }

  // ---- 回す。**0.1 秒刻みで札の時間切れとコストを進める**
  var step = o.step || 100, hp = [], t3, downAt = [];
  for (t3 = 0; t3 <= durMs; t3 += step) {
    b.t = t3;
    R.q.drain(t3, 200000);
    var us = living(b), k;
    for (k = 0; k < us.length; k++) { expire(us[k], t3); }
    // **倒れた体は盤から降ろす。**ここを入れるまで味方は 6 人揃ったままだった
    for (k = 0; k < us.length; k++) {
      if (us[k].hp <= 0 && us[k].alive) {
        R.deaths.push([Math.round(t3), us[k].key]);
        // **死ぬ瞬間の札を撃ってから降ろす**（`Event: 14`）。
        // 降ろしたあとだと `R.pick` の候補から外れて、撃つ側が居なくなる
        var od = us[k].onDead || [];
        for (var y2 = 0; y2 < od.length; y2++) {
          cast(R, us[k], od[y2][0], od[y2][1], 1, t3);
        }
        us[k].onDead = [];
        us[k].alive = false;
        if (us[k].side === 'ally') { downAt.push([us[k].key, t3 / 1000]); }
      }
    }
    // **HP のしきい値はダメージが入った瞬間に効く**（`HPUnder → ChangePhase`）
    if (bst && bst.check) { bst.check(t3); }
    // 条件つき常時（`Event: 301`）の入り切り。フェーズが動いたあとに見る
    pollCond(t3);
    // **射程に入るまで近づく**（味方も敵も。歩いている節は隊列ごと動くので待つ）
    stepApproach(t3, step);
    // **節の進行。**歩く・波を出す・片付いたら次の節へ
    stepSection(t3, step);
    // **指した時刻で味方の札を写し取る**（`o.snapAt` ミリ秒。外から中を見る窓）
    // 複数の時刻を渡せる（配列）。1 つなら今までどおり `snap` に、配列なら `snaps[ms]` に
    if (o.snapAt != null) {
      var sl9 = Array.isArray(o.snapAt) ? o.snapAt : [o.snapAt], si9;
      for (si9 = 0; si9 < sl9.length; si9++) {
        if (snapDone[si9] || t3 < sl9[si9]) { continue; }
        snapDone[si9] = 1;
        var sn0 = {};
        for (var sk9 = 0; sk9 < allies.length; sk9++) {
          var au9 = allies[sk9];
          if (!au9) { continue; }
          var sn9 = statsNow(au9);
          sn0['a' + sk9] = {
            atk: sn9.AttackPower, pierce: sn9.EnhancePierceRate,
            expl: sn9.EnhanceExplosionRate, myst: sn9.EnhanceMysticRate, sonic: sn9.EnhanceSonicRate,
            exR: sn9.EnhanceExDamageRate, cdr: sn9.CriticalDamageRate,
            crit: sn9.CriticalPoint, dr2: sn9.DamageRatio2,
            ext: sn9.ExtendBuffDuration, extD: sn9.ExtendDebuffDuration,
            eff: au9.eff.map(function (e9) {
              return [e9.gid, e9.raw && e9.raw.stat, e9.raw && e9.raw.amt, e9.src, Math.round(e9.at || 0), e9.until == null ? null : Math.round(e9.until), e9.lvl];
            })
          };
        }
        // 敵の札も（防御デバフなど）
        var en9 = living(b, 'enemy'), ei9;
        for (ei9 = 0; ei9 < en9.length; ei9++) {
          sn0[en9[ei9].key] = { eff: en9[ei9].eff.map(function (e9) {
            return [e9.gid, e9.raw && e9.raw.stat, e9.raw && e9.raw.amt, e9.src, Math.round(e9.at || 0), e9.until == null ? null : Math.round(e9.until)];
          }) };
        }
        if (Array.isArray(o.snapAt)) { snaps[sl9[si9]] = sn0; } else { snap = sn0; }
      }
    }
    tickCost(b, step);
    hp.push([t3 / 1000, bossHp()]);
    if (bossHp() <= 0) { break; }
    // **全滅したらそこで終わり**
    if (!living(b, 'ally').length) { break; }
  }
  return {
    // **札が乗ったあとの攻撃力。**核が伸びないときに、素の値と見比べるため
    atkNow: (function () {
      var o2 = {}, z;
      for (z = 0; z < allies.length; z++) {
        var sn = statsNow(allies[z]);
        o2[allies[z].key] = [Math.round(allies[z].base.AttackPower || 0),
                             Math.round(sn.AttackPower || 0),
                             Math.round(sn.CriticalPoint || 0),
                             allies[z].eff.length];
      }
      return o2;
    })(),
    // **味方の地形適性（固有武器ぶんを足したあと）と、この面の地形。**
    // 乗っているかどうかを外から見るため（2026-09-07）
    adapt: (function () {
      var o3 = {}, z;
      for (z = 0; z < allies.length; z++) { o3[allies[z].dev] = allies[z].adapt; }
      return o3;
    })(),
    topo: R.topo, sec: sec, secLog: R.secLog,
    origin: org ? [org.Position.x, org.Position.y] : null,
    sectionEnd: sec,
    bossPos: bossU.pos ? [bossU.pos.x, bossU.pos.y] : null,
    moveLog: moveLog.slice(0, 80),
    evLog: evLog,
    coverPts: cpts.map(function (c9) { return [c9.box.name, Math.round(c9.x * 10) / 10, Math.round(c9.y * 10) / 10, c9.box.dead ? 'x' : (c9.used || '-')]; }),
    cover: allies.map(function (a9) { return [a9.key, a9.cover ? [Math.round(a9.cover.x * 100) / 100, Math.round(a9.cover.y * 100) / 100, a9.cover.box.name] : null]; }),
    coverDmg: Math.round(R.coverDmg || 0), coverLog: coverLog, castLog: R.castLog,
    enemyPos: living(b, 'enemy').map(function (e9) { return [e9.key, e9.dev, Math.round(e9.hp), e9.pos ? [Math.round(e9.pos.x * 10) / 10, Math.round(e9.pos.y * 10) / 10] : null, e9.kind]; }).slice(0, 12),
    allyStats: allies.map(function (a9) { return [a9.key, a9.base.AttackPower, a9.base.DefensePower, a9.base.MaxHP, a9.base.DodgePoint, a9.adapt, (a9.pack && a9.pack.ch && a9.pack.ch.TacticRange), a9.radius]; }),
    hp: hp, total: R.total, killAt: bossHp() <= 0 ? t3 / 1000 : null,
    maxHp: bossMax, bossKeys: bossUnits.map(function (v) { return [v.dev, v.maxHp]; }),
    used: R.used,
    unknown: R.unknown, unknownBy: R.unknownBy, miss: R.miss, missBy: R.missBy, missT: R.missT, missWhy: R.missWhy, deaths: R.deaths, units: Object.keys(b.units).map(function (k9) { var u9 = b.units[k9]; return [k9, u9.dev || u9.charId || '', u9.side, u9.alive ? 1 : 0, Math.round(u9.maxHp || 0), Math.round(u9.hp || 0), Math.round((u9.base && u9.base.DefensePower) || 0), Math.round((u9.base && u9.base.AttackPower) || 0)]; }), by: R.by, fireN: R.fireN,
    snap: snap, snaps: snaps,
    heal: R.heal, groggy: R.groggy, ggLog: R.ggLog, summoned: R.summoned, nsAuto: R.nsAutoBy || {},
    aliveEnd: living(b, 'enemy').map(function (v) {
      return [v.dev, Math.round(v.hp), v.eff.map(function (e) { return e.tmpl; })];
    }),
    // **味方に乗っている札。**支援の強化が届いているかを外から見る（2026-09-07）
    allyEnd: Object.keys(b.units).filter(function (k) {
      return b.units[k].side === 'ally';
    }).map(function (k) {
      var v = b.units[k];
      return [v.key, v.dev, v.eff.map(function (e) {
        return [e.gid, e.raw && e.raw.stat, e.raw && e.raw.amt];
      })];
    }),
    probe: R.probe, events: R.q.size(),
    // **ボスが何をしたか。**動いていないときに黙って通らないための報せ
    bossGg: bossU.gg || 0, bossAtg: bossU.atg || 0,
    bossPhase: bst ? bst.phase : null, bossEx: bst ? bst.exCount : 0,
    bossNa: bst ? bst.n : 0, bossErr: R.bossErr || null,
    bossLog: bst ? bst.log : null, bossForm: bossU.form || 0, killLog: R.killLog, byAlly: R.byAlly,
    allyHp: allies.map(function (a9) { return [a9.key, a9.dev, Math.round(a9.maxHp), Math.round(a9.hp), a9.pos ? [Math.round(a9.pos.x * 10) / 10, Math.round(a9.pos.y * 10) / 10] : null]; }),
    wipeAt: living(b, 'ally').length ? null : t3 / 1000, downAt: downAt,
  };
}

/** 差し替えられる乱数（同じ種なら同じ結果。1 万回まわすときに要る） */
export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
