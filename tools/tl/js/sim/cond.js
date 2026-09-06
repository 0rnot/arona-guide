// ------------------------------------------------------------ 条件を実行時に判定する
/* 木の事象が持っている `mods`（`Modifiers`）を、**その瞬間の状態**で判定する。

   焼き出しはここができなかった。状態を持っていないので、条件つきの行は
   `dmgalt` の「候補」に落として先生に選ばせるか、丸ごと捨てるかしかなかった。
   監査 113 件のうち 63 件が「道具にその概念が無い」ぶんで、その中心がこれ。

   **条件の型は 27 個しか無い**（2026-09-06 に 274 人ぶんの木を数えた。合計 4,037 件）。
   しかも上から 3 つで 86% を覆い、その 3 つは全部**「札を持っているか・何個か」**:

     1605  LogicEffectTemplateModifierDAO          札を持っているか        39.8%
     1060  CountListLogicEffectGroupIdModifierDAO  札（GroupId）の数        66.0%
      803  CountLogicEffectTemplateModifierDAO     札（TemplateId）の数     85.9%
      168  SkillLevelModifierDAO                   スキルレベル             90.1%
       87  CountEntityListCombinedModifierDAO      盤に居る体の数           92.2%
       77  HpRateDamageModifierDAO                 相手の HP 割合で倍率     94.1%
       45  TagConditionalModifierDAO               相手の札（大きさ・ボス） 95.2%
       30  FormIndexCheckModifierDAO               形態                     96.0%

   **`CheckTarget`** が 0 なら自分、1 なら当てる相手、2 なら味方。
   **`IncludeType`** が 1 なら「持っている」、2 なら「持っていない」。

   `ctx` に必要なもの（回す側が渡す）:

     marks(who)      `{TemplateId: 個数}`
     gids(who)       `{GroupId: 個数}`
     cats(who)       `{Category: 個数}`（4 ＝ 弱体）
     hpRate(who)     0〜10000
     form(who)       形態の番号
     skillLv(who, slot)
     armor(who) / bullet(who) / tags(who) / status(who) / bodies() / side(who)

   判定できない型は `null` を返す。**呼ぶ側は `null` を「分からない」として扱い、
   数えて出す。**「分からない」を黙って true にしない。 */

function tOf(m) { return String((m && m.$type) || '').split(',')[0].split('.').pop(); }

/** `CheckTarget` 0 自分 / 1 当てる相手 / 2 味方 */
function whoOf(m, self, target) {
  var c = m.CheckTarget;
  if (c === 1) { return target; }
  return self;
}

function inc(m, ok) { return m.IncludeType === 2 ? !ok : ok; }

/** `Operator` 0 = / 1 ≠ / 2 < / 3 ≧ …（`SkillLevelModifierDAO` と `HpRateModifierDAO`）。
    DB に出てくるのは 0 と 3 だけなので、その 2 つを実装して他は null */
function cmp(op, a, b) {
  if (op === 0) { return a === b; }
  if (op === 1) { return a !== b; }
  if (op === 2) { return a < b; }
  if (op === 3) { return a >= b; }
  if (op === 4) { return a > b; }
  if (op === 5) { return a <= b; }
  return null;
}

function count(map, keys) {
  var n = 0, i;
  for (i = 0; i < (keys || []).length; i++) { n += (map || {})[keys[i]] || 0; }
  return n;
}

function within(n, lo, hi) {
  var h = (hi == null || hi < 0) ? Infinity : hi;
  return n >= (lo || 0) && n <= h;
}

// **`SkillSlot` の書き方は 2 通りある**（2026-09-06 に 274 人ぶんを数えた。
// `PublicSkill01` が 72 件、`ExtraPassive01` が 96 件で `…Skill` が付かない）
var SLOT = { ExSkill01: 'Ex', PublicSkill01: 'Public', NormalSkill01: 'Normal',
             PassiveSkill01: 'Passive', ExtraPassiveSkill01: 'ExtraPassive',
             Ex01: 'Ex', Public01: 'Public', Normal01: 'Normal',
             Passive01: 'Passive', ExtraPassive01: 'ExtraPassive',
             WeaponPassiveSkill01: 'WeaponPassive', WeaponPassive01: 'WeaponPassive' };

/** 条件 1 つ。真・偽・`null`（判定できない） */
export function one(m, ctx, self, target) {
  var t = tOf(m), who = whoOf(m, self, target), n, ok;

  if (t === 'LogicEffectTemplateModifierDAO') {
    n = (ctx.marks(who) || {})[m.TemplateId] || 0;
    return inc(m, n > 0);
  }
  if (t === 'CountLogicEffectTemplateModifierDAO') {
    // **`CheckTarget: 2` は「撃つ側の味方みんな」で、数えるのは体の数**
    n = m.CheckTarget === 2
      ? ctx.sideCount(self, m.TemplateId)
      : ((ctx.marks(who) || {})[m.TemplateId] || 0);
    return inc(m, within(n, m.CountMin, m.CountMax));
  }
  if (t === 'CountListLogicEffectTemplateModifierDAO') {
    n = count(ctx.marks(who), m.TemplateIdList);
    ok = within(n, m.CountMin, m.CountMax);
    // `CountTrueCondition` が偽なら「その数でないこと」
    if (m.CountTrueCondition === false) { ok = !ok; }
    return inc(m, ok);
  }
  if (t === 'CountListLogicEffectGroupIdModifierDAO') {
    n = count(ctx.gids(who), m.LogicEffectGroupIdList || m.GroupIdList);
    return inc(m, within(n, m.CountMin, m.CountMax));
  }
  if (t === 'LogicEffectCategoryModifierDAO') {
    n = (ctx.cats(who) || {})[m.LogicEffectCategory] || 0;
    return inc(m, n > 0);
  }
  if (t === 'CountListLogicEffectCategoryModifierDAO') {
    n = count(ctx.cats(who), m.LogicEffectCategoryList);
    return inc(m, within(n, m.CountMin, m.CountMax));
  }
  if (t === 'SkillLevelModifierDAO') {
    var sl = SLOT[m.SkillSlot];
    if (!sl || !ctx.skillLv) { return null; }
    ok = cmp(m.Operator, ctx.skillLv(who, sl), m.SkillLevel);
    return ok == null ? null : inc(m, ok);
  }
  if (t === 'HpRateModifierDAO') {
    ok = cmp(m.Operator, ctx.hpRate(who), m.HpRate);
    return ok == null ? null : inc(m, ok);
  }
  if (t === 'FormIndexCheckModifierDAO') {
    ok = (ctx.form(who) === (m.FormIndex != null ? m.FormIndex : 0));
    return inc(m, ok);
  }
  if (t === 'ArmorConditionModifierDAO') {
    if (!ctx.armor) { return null; }
    return inc(m, ctx.armor(who) === m.ArmorType);
  }
  if (t === 'BulletTypeConditionModifierDAO') {
    if (!ctx.bullet) { return null; }
    return inc(m, ctx.bullet(who) === m.BulletType);
  }
  if (t === 'TagConditionalModifierDAO' || t === 'CountTagConditionalModifierDAO') {
    if (!ctx.tags) { return null; }
    var tg = ctx.tags(who) || {}, list = m.TagConstraintsInt || [], hit = 0, i;
    for (i = 0; i < list.length; i++) { if (tg[list[i]]) { hit++; } }
    if (t === 'CountTagConditionalModifierDAO') {
      return inc(m, within(hit, m.CountMin, m.CountMax));
    }
    return inc(m, hit > 0);
  }
  if (t === 'StatusConditionalModifierDAO') {
    if (!ctx.status) { return null; }
    return inc(m, !!(ctx.status(who) || {})[m.TargetStatus || m.Status]);
  }
  if (t === 'CoverStateConditionalModifierDAO') {
    // **「盤に遮蔽が無い」は思い込みだった**（2026-09-07。`board.js` の注記。
    // 束 700 面のうち 185 面に 8,831 個ある）。ただし核は**体が遮蔽の陰に
    // 入っているか**を持っていない（線を遮るかは一撃ごとに見るだけで、
    // 体の状態にしていない）ので、ここはまだ `CoverState` 1（隠れていない）を
    // 常に立てる。**残っている穴。**
    if (m.CoverState === 1) { return inc(m, true); }
    return null;
  }
  if (t === 'TargetSideConditionalModifierDAO') {
    if (!ctx.side) { return null; }
    return inc(m, ctx.side(who) === m.TargetSide);
  }
  if (t === 'CharacterIdConditionalModifierDAO') {
    if (!ctx.charId) { return null; }
    return inc(m, (m.CharacterIdList || []).indexOf(ctx.charId(who)) >= 0);
  }
  if (t === 'CountEntityListCombinedModifierDAO') {
    if (!ctx.bodies) { return null; }
    return inc(m, within(ctx.bodies(m), m.CountMin, m.CountMax));
  }
  // **倍率を変えるだけで、出るか出ないかは決めない型**は真として扱い、
  // 倍率は `mulOf` が別に返す
  if (t === 'HpRateDamageModifierDAO' || t === 'StatValueDamageModifierDAO' ||
      t === 'TargetDistanceDamageModifierDAO') {
    return true;
  }
  return null;
}

/** アビリティ 1 本ぶん。**全部の条件が真なら真。**1 つでも `null` があれば `null` */
export function all(mods, ctx, self, target) {
  var i, r, unk = false;
  for (i = 0; i < (mods || []).length; i++) {
    r = one(mods[i], ctx, self, target);
    if (r === false) { return false; }
    if (r == null) { unk = true; }
  }
  return unk ? null : true;
}

/** 倍率を変える型だけを掛け合わせる（`HpRateDamageModifierDAO` ほか）。
    **相手の HP 割合で 3 倍 → 1 倍のように動く**（カリン（制服）・ミカ・ナグサ） */
export function mulOf(mods, ctx, self, target) {
  var mul = 1, i, m, who, h;
  for (i = 0; i < (mods || []).length; i++) {
    m = mods[i];
    if (tOf(m) !== 'HpRateDamageModifierDAO') { continue; }
    who = whoOf(m, self, target);
    h = ctx.hpRate(who);
    if (h == null) { continue; }
    var lo = m.MinHpRate || 0, hi = m.MaxHpRate != null ? m.MaxHpRate : 10000;
    var f = hi > lo ? Math.min(1, Math.max(0, (h - lo) / (hi - lo))) : 0;
    var a = m.MultiplierMin != null ? m.MultiplierMin : 1;
    var b = m.MultiplierMax != null ? m.MultiplierMax : 1;
    mul *= a + (b - a) * f;
  }
  return mul;
}

// ------------------------------------------------------ 引き金の式（ConditionExpression）
/* `TriggerCondition.ConditionExpression` は、常時札の引き金に付いている小さな式。
   **総力戦の束ぜんぶで 24 通りしか無い**（2026-09-06 に数えた。内訳は出てきた数）:

     252  GetCurrentBehavior() == [BehaviorType.Groggy]
     426  GetActiveParts()==0 / ==1 / ==2
     213  GetHPRate() < N（5000 / 3000 / 7500 / 1000 / 100 ／ >= 7000 ／ > 9900）
      65  GetBossAIPhase() == 1 / == 2
      46  GetCurrentBehavior() == [BehaviorType.UseExSkill01〜04]
      25  GroggyGaugeRate() > 9999
      19  GetHPInteger() <= 2 / < 11 / < 12
       4  HasLogicEffectTemplate(名前) == true / false

   **区切りは `&&` だけ**（`||` は 1 件も出てこない）。返すのは真・偽・`null`。
   `null` は「読めない」で、`all` と同じ約束——**黙って true にしない。** */

function cmpOp(op, a, b) {
  if (a == null) { return null; }
  if (op === '<') { return a < b; }
  if (op === '>') { return a > b; }
  if (op === '<=') { return a <= b; }
  if (op === '>=') { return a >= b; }
  if (op === '==') { return a === b; }
  if (op === '!=') { return a !== b; }
  return null;
}

var NUMFN = { 'GetHPRate': 'hpRate', 'GetBossAIPhase': 'phase',
              'GroggyGaugeRate': 'ggRate' };

function term(s, ctx, self) {
  var m = /^(\w+)\(\)\s*(<=|>=|==|!=|<|>)\s*(-?\d+)$/.exec(s);
  if (m && NUMFN[m[1]]) {
    var f = ctx[NUMFN[m[1]]];
    return f ? cmpOp(m[2], f(self), +m[3]) : null;
  }
  m = /^GetCurrentBehavior\(\)\s*(==|!=)\s*\[BehaviorType\.(\w+)\]$/.exec(s);
  if (m) {
    // **読めるのは `Groggy` だけ。**`UseExSkill01`〜`04` は
    // 「いまその EX を撃っている最中」で、木の側に打っている合図が無い
    if (m[2] !== 'Groggy' || !ctx.groggy) { return null; }
    var g = !!ctx.groggy(self);
    return m[1] === '==' ? g : !g;
  }
  m = /^HasLogicEffectTemplate\(([^)]*)\)\s*(==|!=)\s*(true|false)$/.exec(s);
  if (m) {
    if (!ctx.marks) { return null; }
    var has = ((ctx.marks(self) || {})[m[1].trim()] || 0) > 0;
    var want = (m[3] === 'true');
    return m[2] === '==' ? (has === want) : (has !== want);
  }
  // `GetActiveParts()` は部位（体のどこが生きているか）、
  // `GetHPInteger()` は HP の本数。どちらも盤に無いので読めない
  return null;
}

/** 式 1 本。真・偽・`null`（読めない） */
export function expr(s, ctx, self) {
  var t = String(s == null ? '' : s).trim();
  if (!t) { return true; }
  var parts = t.split('&&'), i, r, unk = false;
  for (i = 0; i < parts.length; i++) {
    r = term(parts[i].trim(), ctx, self);
    if (r === false) { return false; }
    if (r == null) { unk = true; }
  }
  return unk ? null : true;
}

/** 読めない型を数える（「あと何を書けば全部か」を出すため） */
export function unknownOf(mods, ctx, self, target) {
  var out = [], i;
  for (i = 0; i < (mods || []).length; i++) {
    if (one(mods[i], ctx, self, target) == null) { out.push(tOf(mods[i])); }
  }
  return out;
}
