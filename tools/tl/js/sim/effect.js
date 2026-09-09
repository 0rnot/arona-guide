// ------------------------------------------------------------ 効果の札を読む
/* `LogicEffect_PC` の 1 行を、回す側が扱える形に直す。**要約はしない**——
   読めた欄をそのまま持たせて、読めない型は `kind: '?'` で型名ごと残す。
   **残った型を数えれば「あと何を書けば全部か」が分かる**のが、この作りの取り柄。

   倍率も値も DB にある（2026-09-06 に確かめた）:

     ダメージ  `DamageEffectDAO`      `BonusSourceFirst` 2 ＝ 攻撃力、
                                      `BonusRateFirst` が 1 万分率。`Level` 1〜10 の 10 行。
                                      マキ EX は 67617 → 179192 で、いまの `data.js` の
                                      `Scale` と 1 の位まで一致する
     ステータス `StatChangeEffectDAO`  `TargetCoefficientAmount`（1 万分率）か
                                      `BaseAmount`（実数）。マキ NS の防御ダウンは
                                      `TargetCoefficientAmount` −1837 → −3489 で、
                                      いまの `buf` の並びと一致

   `StatType` の数字 → 名前は、いまの `data.js` の `buf` 1,195 行と機械的に突き合わせて
   決めた（当たり 1,188 / 外れ 7。`tl-work/_stattype.py`）。**推測ではない。**
   名前の後ろは値がどの欄から来たかで決まる（`TargetCoefficientAmount` → `_Coefficient`
   805 件、`BaseAmount` → `_Base` 367 件）。`CriticalPoint`（9）の `BaseAmount` だけは
   `_BaseOuter` 16 件で、`_Base` の例が 1 件も無い。 */

export var STAT = {
  1: 'MaxHP', 2: 'AttackPower', 3: 'DefensePower', 4: 'HealPower',
  5: 'AccuracyPoint', 7: 'DodgePoint', 9: 'CriticalPoint', 12: 'CriticalDamageRate',
  13: 'MoveSpeed', 16: 'StabilityPoint', 19: 'AmmoCount', 20: 'IgnoreDelayCount',
  21: 'Range', 22: 'BlockRate', 30: 'HealEffectivenessRate',
  31: 'CriticalChanceResistPoint', 32: 'CriticalDamageResistRate',
  34: 'AttackSpeed', 39: 'DamagedRatio', 40: 'OppressionPower', 41: 'OppressionResist',
  // **39・10・61 は 2026-09-07 に足した。**束ぜんぶの `TemplateId` で数えると
  // 39 → `Debuff_StatChange_DamagedRatio` 245 件、10 → `CriticalChanceRate` 72 件、
  // 61 → `DamagedRatio2Increase` 203 件。39 が無くて、被ダメージ率を触る札が
  // ぜんぶ素通り（ケセドのグロッキー中の −9000 も、生徒の被ダメ増加も）だった
  10: 'CriticalChanceRate', 61: 'DamagedRatio2Increase',
  42: 'RegenCost', 44: 'DefensePenetration', 46: 'ExtendBuffDuration',
  47: 'ExtendDebuffDuration', 49: 'EnhanceExplosionRate', 50: 'EnhancePierceRate',
  51: 'EnhanceMysticRate', 59: 'DamageRatio2', 62: 'DamagedRatio2',
  63: 'EnhanceSonicRate', 67: 'EnhanceExDamageRate', 69: 'EnhanceBasicsDamageRate',
  88: 'ReduceWeakDamagedRate'
};

/** 弾種。`AccumulateDamageEffectDAO` の `BulletType` などが数字で持っている */
export var BULLET = { 1: 'Explosion', 2: 'Pierce', 3: 'Mystic', 4: 'Sonic', 5: 'Mystic' };

/** ダメージの倍率がどのステータスに掛かるか（`BonusSourceFirst`） */
export var BONUS_SRC = { 1: 'MaxHP', 2: 'AttackPower', 3: 'DefensePower', 4: 'HealPower' };

function typeOf(r) {
  return String((r && r.$type) || '').split(',')[0].split('.').pop().replace(/EffectDAO$/, '');
}

/** ステータスの名前。`_Base` か `_Coefficient` かは値の来た欄で決まる */
function statName(r) {
  var b = STAT[r.StatType];
  if (!b) { return null; }
  if (r.TargetCoefficientAmount) { return b + '_Coefficient'; }
  if (r.BaseAmount) { return b + (r.StatType === 9 ? '_BaseOuter' : '_Base'); }
  // 値が 0 の段（レベルで 0 のことがある）。欄の有無で決める
  if (r.TargetCoefficientAmount === 0 && r.BaseAmount == null) { return b + '_Coefficient'; }
  return b + (r.StatType === 9 ? '_BaseOuter' : '_Base');
}

function amount(r) {
  if (r.TargetCoefficientAmount) { return r.TargetCoefficientAmount; }
  if (r.BaseAmount) { return r.BaseAmount; }
  if (r.CasterCoefficientAmount) { return r.CasterCoefficientAmount; }
  return 0;
}

/** 効き終わり（ms）。**`EndCondition` が 0（時間）のときだけ ms として読む。**
    0 が 13,356 行、1 / 2 / 3 が合わせて 60 行で、そちらは回数や装弾数
    （ツルギ `EndCondition 1` の "1"、ノノミ（水着）`2` の "100"、
    ハスミ `3` の "1"）。ms と読むと持続 1 ミリ秒になる。
    `Duration` を持つ型（`DamageOverTime` ほか）はそちらが持続 */
function dur(r) {
  // **`Duration` が負なら「切れない」。**`-1` をそのまま ms で返していて、
  // `applyMark` が `until = now - 1` を付け、次の刻みで消していた
  // （2026-09-06。中サイズのペロロミニオンが自分に掛ける気絶
  // `Dummy_Perorozilla_MiddleSize_CrowdControl_StatusAdd_Stunned` が
  // `Duration: -1` で、**1 刻みも保たずに消えていた**。
  // ボスがそれを吸えず、グロッキーが 1 度も起きなかった）。
  // 負の `Duration` は NPC 側 383 行・PC 側 81 行ある
  if (r.Duration != null && r.Duration < 0) { return null; }
  if (r.Duration != null && r.Duration !== 0) { return r.Duration; }
  if (r.EndCondition != null && r.EndCondition !== 0) { return null; }
  var v = r.EndConditionArgumentFirst != null ? r.EndConditionArgumentFirst
        : r.EndConditionArgument;
  if (v == null || v === '') { return null; }
  var n = +v;
  // **`-1` は「切れない」。**いまの `data.js` は同じものを `null` で持っているので合わせる
  if (!isFinite(n) || n < 0) { return null; }
  return n;
}

/** 1 行を読む。`lv` を渡すとその段だけ、渡さなければ段の配列を持つ 1 件にまとめる */
export function readOne(r) {
  var t = typeOf(r), o = {
    kind: '?', t: t, gid: r.GroupId, lv: r.Level, ch: r.Channel,
    tmpl: r.TemplateId || null, cat: r.Category, rate: r.ApplyRate,
    dur: dur(r), endc: r.EndCondition != null ? r.EndCondition : null,
    disp: r.Dispellable !== false,
    // **重なり方はどの型にも付いている欄。**型ごとではなくここで読む
    // （`stack` 0 なら積めない。1 以上ならその数まで積める）
    stack: r.StackSameEffectApplied ? (r.StackSameEffectCount || 1) : 0,
    expireOld: r.ExpireOldIfStackCountOver !== false
  };
  if (t === 'Damage') {
    o.kind = 'dmg';
    o.src = BONUS_SRC[r.BonusSourceFirst] || 'AttackPower';
    o.rate = r.BonusRateFirst || 0;
    o.flat = r.Amount || 0;
    o.crit = r.CriticalCheck;                    // 0 なし / 1 出ない / 2 判定する
    o.stab = r.ApplyStability !== false;
    o.def = r.ApplyDefense !== false;
    o.pen = r.DefensePenetrationRate != null ? r.DefensePenetrationRate : 0;
    o.bt = r.ApplyBulletType !== false;
    o.terr = r.ApplyTerrainAdaptationDamage !== false;
    o.exd = r.ApplyEnhanceExDamageRate !== false;
    o.bas = r.ApplyEnhanceBasicsDamageRate !== false;
    o.dr = r.ApplyDamageRatio;
    o.dr2 = r.ApplyDamageRatio2;
    o.ovr = r.OverrideSkillDamageType || 0;
    o.byCost = r.ChangeRateByCost && r.ChangeRateByCost !== '0' ? r.ChangeRateByCost : null;
    o.lvf = r.ApplyLevelFactor !== false;
    return o;
  }
  if (t === 'StatChange') {
    o.kind = 'stat';
    o.stat = statName(r);
    o.amt = amount(r);
    o.raw = r.StatType;
    o.casterStat = r.CasterStatType != null ? r.CasterStatType : null;
    return o;
  }
  if (t === 'Dummy') { o.kind = 'mark'; return o; }
  // **回復系は `BonusSource` / `BonusRate`**（ダメージ系の `…First` とは別の欄。
  // 2026-09-06 に型ごとに数えて確かめた。イズミの EX は `BonusSource 4` `BonusRate` 14560→25480）
  if (t === 'Heal' || t === 'HealOverTime' || t === 'HealByHit') {
    o.kind = t === 'Heal' ? 'heal' : (t === 'HealOverTime' ? 'hot' : 'healByHit');
    o.src = BONUS_SRC[r.BonusSource] || 'HealPower';
    o.rate = r.BonusRate || 0;
    o.period = r.Period || null;
    return o;
  }
  if (t === 'DamageOverTime') {
    o.kind = 'dot';
    o.src = BONUS_SRC[r.BonusSourceFirst] || 'AttackPower';
    o.rate = r.BonusRateFirst || 0;
    o.period = r.Period || null;
    return o;
  }
  if (t === 'StatusAdd' || t === 'StatusAddWithParameter' ||
      t === 'StatusAddWithStringParameter') {
    o.kind = 'status';
    o.status = r.TargetStatus || r.Status || null;
    o.param = r.Parameter != null ? r.Parameter : null;
    // **`ParameterSecond` は「それでも狙える枠」の並び**（`Ex, Passive` など）。
    // 空なら誰も狙えない。`Untargetable` の読み方は `run.js:untargeted`
    o.param2 = r.ParameterSecond != null ? r.ParameterSecond : null;
    return o;
  }
  if (t === 'FormConversion') {
    o.kind = 'form';
    o.formIndex = r.FormIndex != null ? r.FormIndex : 1;
    o.endKind = r.FormConversionEndCondition;   // 1 時間 ms / 2 リロード / 3 装弾数 / 5 EX 回数
    o.endArg = r.EndConditionArgument;
    o.release = r.ReleaseFormConversionDuration || 0;
    o.immediate = !!r.UseImmediateFormReleaseOnDispel;
    return o;
  }
  // **剥がす札の名前は `LogicEffectTemplateToDispel`**（2026-09-09 に直した）。
  // `TemplateIdList` という欄は 1 件も無く、`TemplateId` は**この解除の札そのものの名前**
  // （`Buff_Dispel_LogicEffectTemplate` ほか）なので、それを剥がしにいっても何も落ちない。
  // 束の `DispelLogicEffectTemplateEffectDAO` は 2,315 行あって、
  // **`LogicEffectTemplateToDispel` と `DispelCount` は 2,315 行とも入っている**
  // （`tools/tl/db/_dispel.py`）。**コンマ区切りで 2 つ書く行がある**——
  // `EN0010_Heater_Passive03_Effect01` の
  // `EN0010_Heater_AddOverload, EN0010_Heater_OverloadEffectDummy` ／
  // `EN0013_Ex_Effect13` の 3 つ。`DispelCount` は 99 が大半で、1 / 3 / 9 / 10〜50 もある
  if (t === 'DispelLogicEffectTemplate') {
    o.kind = 'dispel';
    o.templates = String(r.LogicEffectTemplateToDispel || '')
      .split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
    o.max = r.DispelCount == null ? 0 : +r.DispelCount;
    return o;
  }
  if (t === 'DispelLogicEffectGroupId') {
    o.kind = 'dispelGid';
    o.gids = r.LogicEffectGroupIdToDispel
      ? [].concat(r.LogicEffectGroupIdToDispel) : [];
    return o;
  }
  if (t === 'Dispel') { o.kind = 'dispelCat'; o.cats = r.CategoryList || null; return o; }
  // **盾は `CasterCoefficientAmount`**（撃つ子のステータスに対する割合）
  if (t === 'Shield' || t === 'ShieldHealByHit') {
    o.kind = 'shield';
    o.src = STAT[r.CasterStatType] || 'MaxHP';
    o.rate = r.CasterCoefficientAmount || 0;
    return o;
  }
  if (t === 'ReloadAmmo') { o.kind = 'reload'; o.n = r.Amount || 0; return o; }
  if (t === 'AddCurrentAmmo') { o.kind = 'ammo'; o.n = r.AmmoCountToAdd || 0; return o; }
  if (t === 'SkillCostChange') {
    o.kind = 'cost';
    o.amt = r.BaseAmount || 0;
    o.coef = r.Coefficient || 0;
    o.uses = r.EndCondition === 6 ? (r.EndConditionArgument || 1) : null;
    return o;
  }
  if (t === 'AddSkillCost') { o.kind = 'costAdd'; o.amt = r.Amount || r.BaseAmount || 0; return o; }
  if (t === 'NotMove') { o.kind = 'notMove'; return o; }
  if (t === 'Immune') { o.kind = 'immune'; return o; }
  if (t === 'ExtraSkillCostChange') {
    o.kind = 'costExtra'; o.amt = r.BaseAmount || 0;
    o.uses = r.EndCondition === 6 ? (r.EndConditionArgument || 1) : null;
    return o;
  }
  if (t === 'DamageByHit') {
    o.kind = 'dmgByHit';
    o.src = BONUS_SRC[r.BonusSourceFirst] || 'AttackPower';
    o.rate = r.BonusRateFirst || 0;
    o.crit = r.CriticalCheck;
    return o;
  }
  // **追加ダメージ。**黒板から取るぶん（ケイ）と、撃つ子のステータスに掛けるぶん
  // （イズミの SS は `BonusRateFirst` 220→296 で、`MultiplySource: InvokerCurrentHP`）が
  // 同じ型に同居している
  if (t === 'ExtraStatDamage') {
    o.kind = 'dmgBb';
    o.bb = r.BonusSourceBlackboardKeyString || null;
    o.bbRate = r.BonusRateBlackboard || 0;
    o.src = BONUS_SRC[r.BonusSourceFirst] || 'AttackPower';
    o.rate = r.BonusRateFirst || 0;
    o.mulSrc = r.MultiplySource && r.MultiplySource !== 'None' ? r.MultiplySource : null;
    o.mul = r.MultiplierConstant || 0;
    o.cap = r.MaxDamageRate || 0;
    o.crit = r.CriticalCheck;
    o.pen = r.DefensePenetrationRate != null ? r.DefensePenetrationRate : 0;
    return o;
  }
  if (t === 'Accumulate') {
    o.kind = 'acc';
    o.take = r.AccumulateRate || 0;
    o.capStat = r.LimitSourceStat || null;
    o.capRate = r.LimitSourceStatRate || 0;
    return o;
  }
  if (t === 'AccumulateDamage') {
    o.kind = 'accShot';
    // **弾種は上書きするときだけ数字を見る**（2026-09-06 の監査。ワカモもカンナも
    // `IsOverrideBulletType: false` ＝ 撃つ子自身の弾種。カンナは貫通で、
    // 決め打ちの神秘だと重装甲で 0.5 倍 対 2.0 倍だった）
    o.btOvr = !!r.IsOverrideBulletType;
    o.bt = BULLET[r.BulletType] || null;
    o.crit = r.CriticalCheck;
    o.exd = r.ApplyEnhanceExDamageRate !== false;
    o.bas = r.ApplyEnhanceBasicsDamageRate !== false;
    return o;
  }
  if (t === 'AccumulateDamageFromTargets') {
    o.kind = 'accIn';
    o.bb = r.BlackboardKeyToWrite || null;
    o.take = r.AccumulateRate || 0;
    o.capStat = r.LimitSourceStat || null;
    o.capRate = r.LimitSourceStatRate || 0;
    return o;
  }
  if (t === 'ExSkillCardRedrawGauge') {
    o.kind = 'redraw';
    o.charge = r.ChargeValue || 0;
    o.max = r.MaxGaugeValue || 0;
    return o;
  }
  // **押し戻し**（`KnockbackEffectDAO`）。`MoveDistance` は 1/100 単位、`MoveDuration` ms、
  // `KnockbackDirection` 1 は「撃った体から離れる向き」と読む（ケセドの召喚 EX が円の中の生徒に 2 u。2026-09-08）
  if (t === 'Knockback') { o.kind = 'knock'; o.dist = r.MoveDistance || 0; o.dir = r.KnockbackDirection; o.ms = r.MoveDuration || 0; return o; }
  if (t === 'ResetAutoUseRule') { o.kind = 'nsReset'; return o; }
  if (t === 'WriteEntityToBlackboard') { o.kind = 'bbWrite'; o.bb = r.BlackboardKey || null; return o; }
  // **グロッキーゲージ。**欄が 3 つある。`Amount` はそのまま、
  // `CasterCoefficientAmount` / `TargetCoefficientAmount` は
  // 撃つ側 / 受ける側の `GroggyGauge` に対する 1 万分率。
  // ペロロジラの Ex09（吸収）は吸った気絶ミニオンの数で
  // 0 / 834 / 1668 / 2502 / 3336 / 4170 / 5004 と段が変わる（`CountLogicEffectTemplateModifier`）
  if (t === 'GroggyGauge') {
    o.kind = 'groggy';
    o.flat = r.Amount || 0;
    o.amt = r.CasterCoefficientAmount || 0;
    o.tamt = r.TargetCoefficientAmount || 0;
    return o;
  }
  // **被ダメージの転移。**ペロロジラのグロッキー中に湧く小さなペロロミニオンは
  // Immortal で、受けたダメージの `TransferRatio`（100%）を本体へ流す。
  // **総力戦の TL がグロッキー中に爆発するのはこれ**（2026-09-06）
  if (t === 'DamageTransfer') {
    o.kind = 'transfer';
    o.ratio = r.TransferRatio != null ? r.TransferRatio : 10000;
    o.to = r.TransferredDamageEffectGroupId || null;
    o.toLv = r.TransferredDamageEffectLevel || 1;
    return o;
  }
  if (t === 'Immune') {
    o.kind = 'immune';
    o.tmpl = [];
    for (var z = 0; z < 10; z++) {
      var kk = 'TargetLogicEffectTemplateId' + (z < 10 ? '0' + z : z);
      if (r[kk]) { o.tmpl.push(r[kk]); }
    }
    return o;
  }
  // **ボスの EX ゲージ**（`AddCurrentATGEffectDAO`）。ペロロジラは Ex09（吸収）が
  // 1 回 150 入れ、通常攻撃の `AddActiveGauge +1` と合わせて
  // 150 × 2 ＋ 1 ＝ 301 で `CheckActiveGaugeOver 301` を越えて段が回る。
  // **ここが無いあいだ、ボスの段は 0 のまま動かなかった**（2026-09-06）
  if (t === 'AddCurrentATG') { o.kind = 'atg'; o.amt = r.Amount || 0; return o; }
  // **最大 HP を越えて回す回復。**溢れたぶんは「仮の HP」になって、
  // `TemporaryHpLimitRateByTargetMaxHp`（1 万分率、既定 50%）まで積める。
  // 受け口は `run.js` で、仮の HP は盾と同じ器に入れている
  if (t === 'MaxHpOverHeal') {
    o.kind = 'overheal';
    o.src = BONUS_SRC[r.BonusSource] || 'HealPower';
    o.rate = r.BonusRate || 0;
    o.tmpLimit = r.TemporaryHpLimitRateByTargetMaxHp != null
      ? r.TemporaryHpLimitRateByTargetMaxHp : 5000;
    o.tmpRate = r.TemporaryHpByOverHealRate != null ? r.TemporaryHpByOverHealRate : 10000;
    return o;
  }
  if (t === 'Summon') { o.kind = 'summon'; o.id = r.SummonId || null; return o; }
  // **固定ダメージ。**`Amount` をそのまま引く（防御も装甲も通らない）。
  // ペロロの中サイズが HP 半分で撒く 250,000、ゴズの 99,999,999 がこれ
  if (t === 'DeadlyAttack') {
    o.kind = 'deadly'; o.amt = r.Amount || 0; return o;
  }
  // **即死。**`IgnoreImmortal` が真なら不死身でも倒れる
  if (t === 'ImmediateKill') {
    o.kind = 'kill'; o.ignoreImmortal = !!r.IgnoreImmortal; return o;
  }
  return o;
}

/** 札の GroupId → 段ごとの読み終わったもの。`{gid: [段 1, 段 2, …]}` */
export function readAll(rows) {
  var by = {}, i, o;
  for (i = 0; i < (rows || []).length; i++) {
    o = readOne(rows[i]);
    if (!o.gid) { continue; }
    (by[o.gid] = by[o.gid] || [])[(o.lv || 1) - 1] = o;
  }
  return by;
}

/** **1 つの札が段によって型を変えることがある**（2026-09-06 に見つけた。
    イズミの `Izumi_Ex01_Effect02` は段 1〜2 が `DummyEffectDAO`（`Dummy_NotLearnEffect`
    ＝ その段ではまだ覚えていない）で、段 3 から `StatChangeEffectDAO`）。
    **何の札かを決めるときは、いちばん上の段で見る。** */
export function kindOfList(list) {
  var i;
  for (i = (list || []).length - 1; i >= 0; i--) {
    if (list[i] && list[i].kind !== '?' && list[i].kind !== 'mark') { return list[i].kind; }
  }
  for (i = (list || []).length - 1; i >= 0; i--) { if (list[i]) { return list[i].kind; } }
  return null;
}

/** ダメージを与える札か（型ごとに違う欄で倍率を持つ） */
export function isDamage(k) {
  return k === 'dmg' || k === 'dot' || k === 'dmgByHit' || k === 'dmgBb' || k === 'accShot';
}

/** その段の 1 件。段が 1 つしか無い札（常時のパッシブ）はそれを返す */
export function atLevel(list, lv) {
  if (!list || !list.length) { return null; }
  var i = Math.min(Math.max(1, lv || 1), list.length) - 1;
  return list[i] || list[list.length - 1] || list[0];
}
