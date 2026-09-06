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
import { makeBoard, makeUnit, add, living, ctxOf, applyMark, expire, tickCost }
  from './state.js';
import { once as hitOnce, roll as hitRoll, capsOf } from './hit.js';
import { bossPlan, phaseWaits, driveBoss } from './boss.js';
import { boardPlan, spawnFor, originOf, slotPos, inArea, sortByRule,
         obstacleBoxes, coverRate } from './board.js';

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
    if (!acc[name]) { acc[name] = [pick(name), 0, 1, 0]; }
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
    return { kind: 'interval', ms: +f / FPS * 1000, rate: rate, max: max };
  }
  if (r.ConditionType === 'OnAttackIng') {
    var n = r.TryCount == null ? 0 : +r.TryCount;
    if (!(n > 0)) { return null; }
    return { kind: 'shots', shots: n, rate: rate, max: max };
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

    置けるのは **1（常時）／ 301（条件つき常時）／ 105（周期）** の 3 通り。
    **残りは盤の出来事が要るので置かない**——0 秒に撃つより、撃たないほうが原文に近い。
    `null` を返したぶんは `R.miss['psEv:<番号>']` に数える。 */
function psTrig(doc) {
  var t = doc && doc.TriggerCondition;
  // 引き金の欄そのものが無い札は常時（雑魚の素の札にある）
  if (!t) { return { when: 'always', expr: '' }; }
  var ev = +t.Event, ex = String(t.ConditionExpression || '').trim();
  if (ev === 1) { return ex ? { when: 'cond', expr: ex } : { when: 'always', expr: '' }; }
  if (ev === 301) { return { when: 'cond', expr: ex }; }
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
  if (ev.dist != null) { mul *= ev.dist / 10000; }

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
  // 2（リロード）・3（装弾数）・5（EX の回数）はまだ置いていない（戻らない扱い）
  if (r.kind === 'form') {
    if (target.side === 'ally' && R.setupAlly) {
      var pp = R.partyOf(target);
      if (pp) {
        target.form = r.formIndex != null ? r.formIndex : 1;
        R.setupAlly(target, pp, at);
        if (r.endKind === 1 && r.endArg != null && r.endArg > 0) {
          R.q.push(at + r.endArg, function (now) {
            target.form = 0;
            R.setupAlly(target, pp, now);
          });
        }
      }
    }
    return 0;
  }
  // ---- 最大 HP を越える回復（`MaxHpOverHeal`）。溢れたぶんは仮の HP
  if (r.kind === 'overheal') {
    var os2 = statsNow(caster), or2 = statsNow(target);
    var oa = (os2[r.src || 'HealPower'] || 0) * (r.rate || 0) / 10000 * mul;
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
    var amt = (hs[r.src || 'HealPower'] || 0) * (r.rate || 0) / 10000 * mul;
    amt *= (rs.HealEffectivenessRate != null ? rs.HealEffectivenessRate : 10000) / 10000;
    var ht = 1;
    if (r.kind === 'hot' && r.period && r.dur) {
      ht = Math.max(0, Math.min(Math.floor(r.dur / r.period),
                                Math.floor((R.durMs - at) / r.period)));
    }
    amt *= ht;
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
    // `CharacterStatExcelTable.GroggyGauge`（ペロロジラは 1,000,000,000）は
    // **ダメージで溜めるときの目盛り**で、こちらでは使わない
    // （`js/carry.js:ggMode` の「吸収」と同じ決め）
    var gv = (r.flat || 0) + (r.amt || 0) + (r.tamt || 0);
    gv *= mul;
    if (R.ggLog) { R.ggLog.push([Math.round(at / 100) / 10, r.gid, Math.round(gv)]); }
    if (!target.ggImmune && gv > 0) {
      target.gg = (target.gg || 0) + gv;
      if (R.onGroggy) { R.onGroggy(target, at); }
    }
    return 0;
  }
  // ---- 被ダメージの転移。**受けたぶんを別の体へ流す札**
  if (r.kind === 'transfer') {
    applyMark(target, r, caster.key, at, lvl);
    target.xfer = { ratio: r.ratio == null ? 10000 : r.ratio, to: caster.key };
    return 0;
  }
  if (r.kind === 'immune') {
    for (var zz = 0; zz < (r.tmpl || []).length; zz++) {
      if (String(r.tmpl[zz]).indexOf('Groggy') >= 0) { target.ggImmune = true; }
    }
    return 0;
  }
  // ---- 盾。**受けたぶんを先に食う**（`CasterStatType` × `CasterCoefficientAmount`）
  if (r.kind === 'shield') {
    var ss = statsNow(caster);
    var sh = (ss[r.src || 'MaxHP'] || 0) * (r.rate || 0) / 10000 * mul;
    if (sh > 0) { target.shield = (target.shield || 0) + sh; }
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
      scale: r.rate || 0, mult: mul, tick: 1,
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
      crit: (target.groggyUntil != null && at < target.groggyUntil) ? 1 : null,
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
    var cov = R.coverOf ? R.coverOf(caster, target) : 0;
    if (cov > 0) {
      R.miss['cover'] = (R.miss['cover'] || 0) + 1;
      if (R.rnd) { if (R.rnd() * 10000 < cov) { dmg = 0; } }
      else { dmg *= 1 - cov / 10000; }
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
    target.hp = Math.max(floor, target.hp - dmg);
    R.total += dmg;
    if (R.onDamaged && target.side === 'enemy') { R.onDamaged(target, dmg, at); }
    // **1 発ごとの中身。**核が伸びないときに、どの掛け算が小さいかを外から見るため
    if (R.probe) {
      R.probe.push([Math.round(dmg), caster.key, ev.slot || '?', ev.gid,
                    Math.round(at), s.scale, +(mul).toFixed(4), Math.round(a.atk),
                    +(o.avg / Math.max(1, a.atk)).toFixed(3), s.tick, ev.dist, ev.share,
                    target.key, Math.round(target.hp),
                    // **掛け算の中身**（核が伸びないときに、どれが 0 かを見る）
                    { eff: a.eff, terr: a.terr, hit: +o.hit.toFixed(3),
                      rate: +o.rate.toFixed(3), crit: +o.crit.toFixed(3),
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
    return dmg;
  }

  // ---- ダメージ以外は札として盤に置く。**確率はここで振る**
  if (r.rate != null && r.kind !== 'stat' && R.rnd && r.rate < 10000 &&
      r.kind !== 'dmg' && R.rnd() * 10000 >= r.rate) { return 0; }
  applyMark(target, r, caster.key, at, lvl);
  return 0;
}

/** 1 枠ぶんを撃つ。木を歩いて、事象ごとに `fire` を呼ぶ。
    `opt.mc` はこの 1 発が当たる体の数（TL の行が持っている。無ければ `R.mc`） */
function cast(R, u, gid, slot, lvl, at, opt) {
  var doc = u.ls && u.ls[gid];
  if (!doc) { return; }
  var mc = opt && opt.mc != null ? opt.mc : null;
  var to = opt && opt.to != null ? opt.to : null;
  var ev = R.evCache[gid] || (R.evCache[gid] = skillEvents(doc));
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    var t2 = at + e.f / FPS * 1000;
    if (t2 > R.durMs) { continue; }
    // **狙う先はその瞬間に決める。**仕掛けるときの盤で決めると、
    // 途中で湧いた体・倒れた体を取り違える
    (function (e2, t3) {
      R.q.push(t3, function (now) {
        e2.slot = slot;
        var tg = R.pick(u, e2, to), k;
        for (k = 0; k < tg.length; k++) { fire(R, e2, u, tg[k], lvl, now, mc); }
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
        R.q.push(t4, function (now) { R.summon(sv.name, now, u); });
      })(sm[y]);
    }
  }
  R.used.push({ t: at, who: u.key, slot: slot, gid: gid });
  // **スキルを使ったことを SS に知らせる**（Event 3 / 17）。
  // SS 自身とパッシブからは知らせない（際限なく回る）
  if (u._fireSS && slot !== 'ExtraPassive' && slot !== 'Passive') {
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

/** その体の、この面での地形適性（`CharacterStatExcelTable` の 3 欄）。
    **固有武器ぶんの上がりは入れていない**（`CharacterWeaponExcelTable` に欄が無く、
    画面側は `data.js` の `adapt` から引いている）。 */
function gradeOf(st, topo) {
  var k = topo === 'Indoor' ? 'IndoorBattleAdaptation'
        : (topo === 'Street' ? 'StreetBattleAdaptation' : 'OutdoorBattleAdaptation');
  return (st && st[k]) || 'D';
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
    if (!ok && m.param && m.param !== 'None') {
      for (j = 0; j < v.eff.length; j++) {
        if (v.eff[j].tmpl === m.param) { ok = true; }
      }
      for (j = 0; !ok && j < u.eff.length; j++) {
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
      role: c.TacticRole, school: c.School, squad: c.SquadType,
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
  // **本体以外のボスは湧かせない。**盤の `start` が別の面のボスを起こしてしまう
  var otherBoss = {};
  for (i = 0; i < ent.length; i++) {
    if (ent[i].TacticEntityType === 'Boss' && ent[i].Id !== bossU.charId) {
      otherBoss[ent[i].DevName] = 1;
    }
  }

  // ---- 盤。**味方も敵もここで座標をもらう**（2026-09-06）
  //
  // 味方は「その節の `Formations` の原点」＋「陣形の枠のずれ」。
  // 敵は湧き点の `Position`。**盤の単位はスキルの射程の 1/100。**
  // ここが無いあいだ、範囲攻撃は距離に関係なく盤の全部に当たっていて、
  // 味方が中サイズのペロロミニオンを湧いた端から全部倒し、
  // ボスが吸うものを見つけられずグロッキーが 1 度も起きなかった
  var bd = null, sec = 0;
  var bnames = Object.keys(boss.board || {});
  if (bnames.length) { bd = boardPlan(boss.board[bnames[0]]); }
  var fgid = (boss.ground || {}).FormationGroupId;
  var formRow = null;
  for (i = 0; i < (common.form || []).length; i++) {
    var fr0 = common.form[i];
    if (fr0.GroupID === fgid || fr0.GroupId === fgid) { formRow = fr0; }
  }
  var origin = originOf(bd, sec);
  // 遮蔽。**総力戦の盤にもある**（2026-09-07。`board.js` の注記）
  var obs = bd ? obstacleBoxes(bd, sec, common) : [];
  // 湧き点の座標を実体の名前で引けるように（同じ名前が複数あるので先頭）
  var posOf = {};
  if (bd && bd.sections[sec]) {
    var pts0 = bd.sections[sec].points;
    for (i = 0; i < pts0.length; i++) {
      if (pts0[i].dev && pts0[i].pos && !posOf[pts0[i].dev]) {
        posOf[pts0[i].dev] = pts0[i].pos;
      }
    }
  }
  var ekeys = Object.keys(byDev);
  for (i = 0; i < ekeys.length; i++) {
    var pool0 = byDev[ekeys[i]], w0;
    for (w0 = 0; w0 < pool0.length; w0++) {
      pool0[w0].pos = posOf[ekeys[i]] || null;
    }
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
                     (boss.ground || {}).StageTopography),
      radius: ch.BodyRadius, personality: ch.PersonalityId, aiId: ch.CharacterAIId,
      role: ch.TacticRole, school: ch.School, squad: ch.SquadType,
      hp: (p.stats && p.stats.MaxHP) || 1, maxHp: (p.stats && p.stats.MaxHP) || 1,
      base: p.stats || {}, skillLv: p.skillLv || {},
    }));
    au.ls = pc.ls;
    au.pack = pc;
    au.slot = p.slot != null ? p.slot : i;
    au.pos = origin ? slotPos(origin, formRow, au.slot) : null;
    allies.push(au);
  }

  // ---- 効果の索引。味方とボスをまとめて 1 つに
  var le = [];
  for (i = 0; i < party.length; i++) { le = le.concat(party[i].pack.le || []); }
  le = le.concat(boss.le || []);
  var eff = readAll(le);

  var R = {
    b: b, ctx: ctxOf(b), eff: eff, q: queue(), evCache: {}, pgCache: {},
    total: 0, heal: 0, groggy: [], ggLog: [], summoned: 0, smCache: {}, probe: o.probe ? [] : null, used: [], unknown: 0, unknownBy: {}, miss: {}, by: {},
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
    coverOf: function (u, v) {
      if (!obs.length || !u || !v || !u.pos || !v.pos) { return 0; }
      var base = coverRate(u.pos, v.pos, obs, v.radius);
      if (base <= 0) { return 0; }
      var gv = (R.terrT[R.topo] || {})[v.adapt || 'D'];
      var gu = (R.terrT[R.topo] || {})[u.adapt || 'D'];
      var r = base + ((gv && gv.BlockFactor) || 0) - ((gu && gu.ShotFactor) || 0);
      return Math.max(0, Math.min(10000, r));
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
      var base = u.base || {};
      var dg = 10000 + ((s.DamagedRatio == null ? 10000 : s.DamagedRatio)
                        - (base.DamagedRatio == null ? 10000 : base.DamagedRatio));
      var dg2 = 10000 + ((s.DamagedRatio2 == null ? 10000 : s.DamagedRatio2)
                         - (base.DamagedRatio2 == null ? 10000 : base.DamagedRatio2));
      return {
        def: s.DefensePower || 0,
        dodge: s.DodgePoint || 0, critResist: s.CriticalResistPoint || 0,
        critDmgResist: s.CriticalDamageResistRate || 0,
        damaged: dg, damaged2: dg2,
        // ケセドの剥き出しの玉座。素の 19000 ＝ 0.1 倍で、
        // グロッキー中の「+900%」（＝ 札で −9000）で 1.0 倍に戻る
        dbase: (boss.dmgOnly && base.DamagedRatio)
          ? (20000 - base.DamagedRatio) / 10000 : 1,
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
    pick: function (u, ev, to) {
      var side = (ev.sel && ev.sel.side) || (u.side === 'ally' ? 'Enemy' : 'Player');
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
      // **狙えない体を外す**（`Untargetable`）。外れて誰も居なくなったら撃たない
      var t3 = [], z3;
      for (z3 = 0; z3 < team.length; z3++) {
        if (!untargeted(team[z3], ev, u)) { t3.push(team[z3]); }
      }
      team = t3;
      var max = ev.sel ? ev.sel.max : null;
      // **味方 1 人にだけ乗る札は、TL の「渡し先」へ。**
      // 指定が無いと枠の先頭に乗って、ヒマリの攻撃力バフがタンクに付く
      // （TL の `to` は枠の番号。`bridge.js` が核の並びに直して渡す）
      if (to != null && mine && side !== 'Enemy' && max === 1
          && allies[to] && allies[to].alive) {
        return [allies[to]];
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
      if (hit.indexOf(aim) < 0) { hit = [aim].concat(hit); }
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
    var gid = function (k) {
      var v = csl[k];
      v = Array.isArray(v) ? v[0] : v;
      return (v && v !== 'EmptySkill') ? String(v) : null;
    };
    var lvOf = function (slot) { return (p.skillLv && p.skillLv[slot]) || 1; };
    var ng = gid('NormalSkillGroupId');
    var pg = gid('PublicSkillGroupId');
    var auto = (pg && au.ls[pg]) ? nsAuto(au.ls[pg]) : null;
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
        if (au.alive) {
          cast(R, au, ng, 'Normal', 1, now);
          au._shots++;
          if (auto && auto.kind === 'shots' && pg && au._shots % auto.shots === 0) {
            cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
          }
          au._fireSS(now, 'attack');
          if ((shot + 1) % na.mag === 0) { au._fireSS(now, 'reload'); }
        }
        shot++;
        var nx = now + na.per;
        if (shot % na.mag === 0) { nx += na.rel; }
        if (nx <= durMs) { R.q.push(nx, step); }
      };
      R.q.push(from + (from === 0 ? na.ent : 0), step);
    }
    // 通常スキル。**周期のもの**
    if (pg && auto && auto.kind === 'interval' && auto.ms > 0) {
      var tick = function (now) {
        if (au._gen !== gen || now > durMs) { return; }
        if (au.alive) {
          cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
        }
        if (now + auto.ms <= durMs) { R.q.push(now + auto.ms, tick); }
      };
      R.q.push(from + auto.ms, tick);
    }
  };
  R.setupAlly = setupAlly;
  R.partyOf = function (au) {
    var z; for (z = 0; z < allies.length; z++) { if (allies[z] === au) { return party[z]; } }
    return null;
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

      var ss = (es && au.ls[es]) ? ssTrig(au.ls[es]) : null;

      // ---- サブスキル（SS）の引き金
      au._ssN = 0; au._ssHit = 0; au._ssLast = -1e9;
      au._fireSS = function (now, kind, what) {
        if (!ss || !es || ss.when !== kind) { return; }
        if (kind === 'cast' && ss.param && ss.param.indexOf(what) < 0) { return; }
        au._ssN++;
        if (ss.tries > 1 && au._ssN % ss.tries !== 0) { return; }
        if (ss.cool && now - au._ssLast < ss.cool) { return; }
        if (ss.max >= 0 && au._ssHit >= ss.max) { return; }
        if (ss.rate < 10000 && R.rnd && R.rnd() * 10000 >= ss.rate) { return; }
        au._ssLast = now; au._ssHit++;
        cast(R, au, es, 'ExtraPassive', lvOf('ExtraPassive'), now);
      };
      // **常時（1 / 301）は 0 秒に 1 回。**引き金が読めない型もここに落とす
      // （置かないより、常時として置くほうが元の `csl[0]` 時代と同じ）
      if (es && (!ss || ss.when === 'always' || ss.when === null)) {
        R.q.push(0, function (t) {
          cast(R, au, es, 'ExtraPassive', lvOf('ExtraPassive'), t);
        });
      }
      // **N コマ毎（105）**
      if (ss && ss.when === 'every' && ss.ms > 0) {
        for (var ts = ss.ms; ts <= durMs; ts += ss.ms) {
          (function (tt) { R.q.push(tt, function (now) { au._fireSS(now, 'every'); }); })(ts);
        }
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
      R.q.push(row.at * 1000, function (now) {
        // **枠は撃つ瞬間に読む。**変身していれば変身後の EX になる
        var gid = au._ex;
        if (row.f) {
          var fr = cslRow(au.pack, party[row.i], row.f);
          var fv = fr.ExSkillGroupId;
          fv = Array.isArray(fv) ? fv[0] : fv;
          if (fv && fv !== 'EmptySkill') { gid = String(fv); }
        }
        if (!gid) { return; }
        cast(R, au, gid, 'Ex', (party[row.i].skillLv || {}).Ex || 1, now,
             { mc: row.mc, to: row.to });
      });
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

  function castPassives(mu, at) {
    var cr = mu.csl && mu.csl[0], z, v;
    if (!cr) { return; }
    var slots = [['PassiveSkillGroupId', 'Passive'],
                 ['ExtraPassiveSkillGroupId', 'ExtraPassive'],
                 ['HiddenSkillGroupId', 'Passive']];
    // この体ぶんの見張りは湧き直すたびに作り直す（前の生の分が残っていると二重に乗る）
    for (z = condP.length - 1; z >= 0; z--) {
      if (condP[z].u === mu) { condP.splice(z, 1); }
    }
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
        if (mu.alive || mu === bossU) { continue; }
        mu.alive = true;
        mu.hp = mu.maxHp;
        mu.pos = pts[z].pos || null;
        mu.eff = [];
        n++;
        castPassives(mu, at);
        break;
      }
    }
    return n;
  }

  /** 木が呼んだ実体を 1 体起こす。**名前は綴りが違うので当て直す。** */
  R.summon = function (name, at, by) {
    var dev = R.devFix[name];
    if (dev === undefined) { dev = R.devFix[name] = resolveDev(name, byDev); }
    if (!dev) { R.miss['summon:' + name] = (R.miss['summon:' + name] || 0) + 1; return; }
    if (otherBoss[dev]) { return; }
    var pool = byDev[dev] || [], w;
    for (w = 0; w < pool.length; w++) {
      var mu = pool[w];
      if (mu.alive || mu === bossU) { continue; }
      mu.alive = true; mu.hp = mu.maxHp; mu.eff = []; mu.pos = by && by.pos;
      R.summoned++;
      castPassives(mu, at);
      return;
    }
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

  if (o.bossActs !== false) {
    try {
      var plan = bossPlan(boss, bossU.charId);
      var waits = phaseWaits(boss.board);
      bst = driveBoss({
        R: R, u: bossU, plan: plan, waits: waits, durMs: durMs,
        cast: function (cu, gid, slot, lv, at) { cast(R, cu, gid, slot, lv, at); },
      });
    } catch (e) {
      R.bossErr = String(e && e.message || e);
    }
  }
  // **節の最初から居る敵**（ボス以外に前座が居る盤がある）
  spawn('start', 0);
  // **本体の常時札。**`spawn` は「湧く体」しか見ないので `mu === bossU` を飛ばしていて、
  // **ボス自身の `PassiveSkillGroupId` は一度も引かれていなかった**（2026-09-06）。
  // ゴズの `GozInsanePassive01` が丸ごと抜けていて、`used` に敵の枠が 1 つも無い
  castPassives(bossU, 0);

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
        us[k].alive = false;
        if (us[k].side === 'ally') { downAt.push([us[k].key, t3 / 1000]); }
      }
    }
    // **HP のしきい値はダメージが入った瞬間に効く**（`HPUnder → ChangePhase`）
    if (bst && bst.check) { bst.check(t3); }
    // 条件つき常時（`Event: 301`）の入り切り。フェーズが動いたあとに見る
    pollCond(t3);
    tickCost(b, step);
    hp.push([t3 / 1000, bossU.hp]);
    if (bossU.hp <= 0) { break; }
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
    hp: hp, total: R.total, killAt: bossU.hp <= 0 ? t3 / 1000 : null,
    maxHp: bossU.maxHp, used: R.used,
    unknown: R.unknown, unknownBy: R.unknownBy, miss: R.miss, by: R.by,
    heal: R.heal, groggy: R.groggy, ggLog: R.ggLog, summoned: R.summoned,
    aliveEnd: living(b, 'enemy').map(function (v) {
      return [v.dev, Math.round(v.hp), v.eff.map(function (e) { return e.tmpl; })];
    }), probe: R.probe, events: R.q.size(),
    // **ボスが何をしたか。**動いていないときに黙って通らないための報せ
    bossGg: bossU.gg || 0, bossAtg: bossU.atg || 0,
    bossPhase: bst ? bst.phase : null, bossEx: bst ? bst.exCount : 0,
    bossNa: bst ? bst.n : 0, bossErr: R.bossErr || null,
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
