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
import { skillEvents } from './tree.js';
import { readAll, atLevel, kindOfList, isDamage } from './effect.js';
import { all as condAll, mulOf, unknownOf } from './cond.js';
import { makeBoard, makeUnit, add, living, ctxOf, applyMark, expire, tickCost }
  from './state.js';
import { once as hitOnce, roll as hitRoll, capsOf } from './hit.js';
import { bossPlan, phaseWaits, driveBoss } from './boss.js';
import { boardPlan, spawnFor } from './board.js';

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
  function pick(name) {
    if (base[name] != null) { return base[name]; }
    if (base[name + '100'] != null) { return base[name + '100']; }
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
    // **1 万分率は `GroggyGauge` に対する割合。**撃つ側と受ける側で別の欄
    var cs2 = statsNow(caster), ts2 = statsNow(target);
    var gv = (r.flat || 0)
      + (r.amt || 0) / 10000 * (cs2.GroggyGauge || 0)
      + (r.tamt || 0) / 10000 * (ts2.GroggyGauge || 0);
    gv *= mul;
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
    // **盾が先に食う。**残りだけが HP を削る
    if (target.shield > 0) {
      var eat = Math.min(target.shield, dmg);
      target.shield -= eat;
      dmg -= eat;
    }
    target.hp = Math.max(0, target.hp - dmg);
    R.total += dmg;
    // **1 発ごとの中身。**核が伸びないときに、どの掛け算が小さいかを外から見るため
    if (R.probe) {
      R.probe.push([Math.round(dmg), caster.key, ev.slot || '?', ev.gid,
                    Math.round(at), s.scale, +(mul).toFixed(4), Math.round(a.atk),
                    +(o.avg / Math.max(1, a.atk)).toFixed(3), s.tick, ev.dist, ev.share]);
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
  R.used.push({ t: at, who: u.key, slot: slot, gid: gid });
  // **スキルを使ったことを SS に知らせる**（Event 3 / 17）。
  // SS 自身とパッシブからは知らせない（際限なく回る）
  if (u._fireSS && slot !== 'ExtraPassive' && slot !== 'Passive') {
    u._fireSS(at, 'cast', slot);
  }
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
    if (c.TacticEntityType === 'Boss' && !bossU) { bossU = u; } else { u.alive = false; }
  }
  if (!bossU) { throw new Error('ボスの実体が束に無い'); }

  // ---- 味方
  var party = o.party || [], allies = [];
  for (i = 0; i < party.length; i++) {
    var p = party[i], pc = p.pack, ch = pc.ch || {};
    var au = add(b, makeUnit({
      key: 'a' + i, side: 'ally', charId: pc.id, dev: pc.dev,
      kind: 'Student', lv: p.lv || 90, armor: ch.ArmorType, bullet: ch.BulletType,
      radius: ch.BodyRadius, personality: ch.PersonalityId, aiId: ch.CharacterAIId,
      role: ch.TacticRole, school: ch.School, squad: ch.SquadType,
      hp: (p.stats && p.stats.MaxHP) || 1, maxHp: (p.stats && p.stats.MaxHP) || 1,
      base: p.stats || {}, skillLv: p.skillLv || {},
    }));
    au.ls = pc.ls;
    au.pack = pc;
    au.slot = i;
    allies.push(au);
  }

  // ---- 効果の索引。味方とボスをまとめて 1 つに
  var le = [];
  for (i = 0; i < party.length; i++) { le = le.concat(party[i].pack.le || []); }
  le = le.concat(boss.le || []);
  var eff = readAll(le);

  var R = {
    b: b, ctx: ctxOf(b), eff: eff, q: queue(), evCache: {},
    total: 0, heal: 0, groggy: [], probe: o.probe ? [] : null, used: [], unknown: 0, unknownBy: {}, miss: {}, by: {},
    durMs: durMs, mc: o.mc || 1, C: constOf(common),
    unitOf: function (k) { return b.units[k] || null; },
    lvTable: common.lvdiff || null, caps: capsOf(common.calcLimit),
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
        terr: (o.terr != null ? o.terr : 1), eff: (o.effmod != null ? o.effmod : 1),
      };
    },
    defender: function (u) {
      var s = statsNow(u);
      return {
        def: s.DefensePower || 0,
        dodge: s.DodgePoint || 0, critResist: s.CriticalResistPoint || 0,
        critDmgResist: s.CriticalDamageResistRate || 0,
        // **被ダメージ率は札で動く。**`DamagedRatio` は 10000 が素
        damaged: s.DamagedRatio != null ? s.DamagedRatio : 10000,
        damaged2: s.DamagedRatio2 != null ? s.DamagedRatio2 : 10000,
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
      var max = ev.sel ? ev.sel.max : null;
      // **味方 1 人にだけ乗る札は、TL の「渡し先」へ。**
      // 指定が無いと枠の先頭に乗って、ヒマリの攻撃力バフがタンクに付く
      // （TL の `to` は枠の番号。`bridge.js` が核の並びに直して渡す）
      if (to != null && mine && side !== 'Enemy' && max === 1
          && allies[to] && allies[to].alive) {
        return [allies[to]];
      }
      if (max != null && max > 0 && team.length > max) { team = team.slice(0, max); }
      return team;
    },
  };

  // ---- 積む: 常時のパッシブ → 通常攻撃 → 通常スキル → EX
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

      var ng = gid('NormalSkillGroupId');
      var pg = gid('PublicSkillGroupId');
      var auto = (pg && au.ls[pg]) ? nsAuto(au.ls[pg]) : null;
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

      // 通常攻撃。**構え → 弾倉ぶん撃つ → リロード**を繰り返す
      var na = ng && au.ls[ng]
        ? naInfo(au.ls[ng], (p.stats || {}).NormalAttackSpeed,
                 (p.stats || {}).AmmoCount, (p.stats || {}).AmmoCost) : null;
      au._shots = 0;
      if (na) {
        var t = na.ent, shot = 0;
        while (t <= durMs) {
          (function (tt, reload) {
            R.q.push(tt, function (now) {
              cast(R, au, ng, 'Normal', 1, now);
              au._shots++;
              // **通常攻撃 N 発ごとの通常スキル**（`OnAttackIng` の `TryCount`）
              if (auto && auto.kind === 'shots' && pg && au._shots % auto.shots === 0) {
                cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
              }
              au._fireSS(now, 'attack');
              if (reload) { au._fireSS(now, 'reload'); }
            });
          })(t, (shot + 1) % na.mag === 0);
          shot++;
          t += na.per;
          if (shot % na.mag === 0) { t += na.rel; }
        }
        au._na = na;
      }
      // 通常スキル。**周期のもの**
      if (pg && auto && auto.kind === 'interval') {
        for (var t2 = auto.ms; t2 <= durMs; t2 += auto.ms) {
          (function (tt) {
            R.q.push(tt, function (now) {
              // **通常スキルの渡し先も枠ごと**（画面の `nsto`）
              cast(R, au, pg, 'Public', lvOf('Public'), now, { to: p.nsto });
            });
          })(t2);
        }
      }
      au._ex = gid('ExSkillGroupId');
    })(allies[i], party[i]);
  }
  // EX は TL の指すとおりに。**行が `mc`（当たる体の数）と `f`（形態）を持てる**
  for (i = 0; i < (o.tl || []).length; i++) {
    (function (row) {
      var au = allies[row.i];
      if (!au) { return; }
      // 形態が指定されていれば、その形態の行の EX 枠を撃つ
      var gid = au._ex;
      if (row.f) {
        var fr = cslRow(au.pack, party[row.i], row.f);
        var fv = fr.ExSkillGroupId;
        fv = Array.isArray(fv) ? fv[0] : fv;
        if (fv && fv !== 'EmptySkill') { gid = String(fv); }
      }
      if (!gid) { return; }
      R.q.push(row.at * 1000, function (now) {
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
  var bst = null, bd = null, sec = 0;
  var bnames = Object.keys(boss.board || {});
  if (bnames.length) { bd = boardPlan(boss.board[bnames[0]]); }

  /** 合図 `tag` の湧き点を起こす。**同じ実体が何度も湧くので、
      死んでいる体から順に使い回す**（束には 5〜30 体ぶん入っている） */
  function spawn(tag, at) {
    if (!bd) { return 0; }
    var pts = spawnFor(bd, sec, tag), n = 0, z;
    for (z = 0; z < pts.length; z++) {
      var pool = byDev[pts[z].dev] || [], w;
      for (w = 0; w < pool.length; w++) {
        var mu = pool[w];
        if (mu.alive || mu === bossU) { continue; }
        mu.alive = true;
        mu.hp = mu.maxHp;
        mu.pos = pts[z].pos || null;
        mu.eff = [];
        n++;
        // **湧いた子は自分の常時札を引く。**ペロロミニオンの被ダメージ転移がこれ
        var cr = mu.csl && mu.csl[0];
        if (cr) {
          var pg2 = (cr.PassiveSkillGroupId || [])[0];
          var eg2 = (cr.ExtraPassiveSkillGroupId || [])[0];
          if (pg2 && pg2 !== 'EmptySkill') { cast(R, mu, String(pg2), 'Passive', 1, at); }
          if (eg2 && eg2 !== 'EmptySkill') { cast(R, mu, String(eg2), 'ExtraPassive', 1, at); }
        }
        break;
      }
    }
    return n;
  }

  // **グロッキー。**ゲージが `GroggyGauge` に届いたら `GroggyTime` のあいだ。
  // その間は会心が確定し、盤の台本が `st:Groggy` の湧きを出す
  // （ペロロジラは Immortal の小さなペロロミニオンで、受けたダメージを本体へ流す）
  R.onGroggy = function (u2, at) {
    var need = (u2.base && (u2.base.GroggyGauge || 0)) || 0;
    if (!need || (u2.gg || 0) < need) { return; }
    if (u2.groggyUntil != null && at < u2.groggyUntil) { return; }
    u2.gg = 0;
    var gt = (u2.base && u2.base.GroggyTime) || 0;
    u2.groggyUntil = at + gt;
    R.groggy.push([at / 1000, gt / 1000]);
    spawn('st:Groggy', at);
    if (bst && bst.applyGroggy) { bst.applyGroggy(at); }
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
    heal: R.heal, groggy: R.groggy, probe: R.probe, events: R.q.size(),
    // **ボスが何をしたか。**動いていないときに黙って通らないための報せ
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
