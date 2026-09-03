import { B } from './util.js';

// ------------------------------------------------------------ ダメージ
// **式は SchaleDB の js/common.js をそのまま写している**（CharacterStats の
// calculateDamage / getDefenseDamageReductionMod / getCriticalRate / getHitChance /
// getStabilityMinDamageMod / getEffectiveMod / interpolateStat）。
// 表は ba-data の DB/ から: 特効 BulletArmorDamageFactorExcelTable、
// 地形 TerrainAdaptationFactorExcelTable、支援値 CharacterStatsTransExcelTable、
// 敵レベル RaidStageExcelTable→GroundExcelTable。**式を自前で作っていない。**
export var SK = {}, SI = {}, ENVI = { Street: 0, Outdoor: 1, Indoor: 2 };
(function () {
  var i;
  for (i = 0; i < B.statKeys.length; i++) { SK[B.statKeys[i]] = i; }
  for (i = 0; i < B.sinfoKeys.length; i++) { SI[B.sinfoKeys[i]] = i; }
})();
export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function ipol(s1, s100, lv, tr) {
  var sc = +(((lv - 1) / 99).toFixed(4));
  return Math.ceil(+((Math.round(+((s1 + (s100 - s1) * sc).toFixed(4))) * (tr || 1)).toFixed(4)));
}
export function sval(id, key, lv) {
  var a = B.stats[id];
  if (!a) { return 0; }
  var i1 = SK[key + '1'], i2 = SK[key + '100'];
  if (i1 == null) { return a[SK[key]] || 0; }
  return ipol(a[i1], a[i2], lv, 1);
}
// 1 人ぶんの最終ステータス。**SchaleDB の CharacterStats を写している**
// （素の値 → 星 → 装備 → 固有武器 → 愛用品 → 絆 の順に足し、
//  getTotal は `round((素+固定) × 係数) + 別枠固定`）
export function mkStats(id, o) {
  var a = B.stats[id], bd = B.build[id] || {}, stats = {}, i;
  if (!a) { return null; }
  var lv = o.lv, star = o.star;
  function set(k, v) { stats[k] = [v || 0, 0, 1, 0]; }
  function add(key, amt) {
    var q = String(key).split('_'), k = q[0];
    if (!stats[k]) { set(k, 0); }
    if (q[1] === 'Coefficient') { stats[k][2] += amt / 10000; }
    else { stats[k][1] += amt; }
  }
  var tcA = 1, tcH = 1, tcHl = 1;
  for (i = 0; i < star; i++) {
    tcA += B.tc[0][i] / 10000; tcH += B.tc[1][i] / 10000; tcHl += B.tc[2][i] / 10000;
  }
  set('AttackPower', ipol(a[SK.AttackPower1], a[SK.AttackPower100], lv, tcA));
  set('MaxHP', ipol(a[SK.MaxHP1], a[SK.MaxHP100], lv, tcH));
  set('DefensePower', ipol(a[SK.DefensePower1], a[SK.DefensePower100], lv, 1));
  set('HealPower', ipol(a[SK.HealPower1], a[SK.HealPower100], lv, tcHl));
  set('DefensePenetration',
      ipol(a[SK.DefensePenetration1], a[SK.DefensePenetration100], lv, 1));
  var flat = ['AccuracyPoint', 'DodgePoint', 'CriticalPoint', 'CriticalDamageRate',
              'StabilityPoint', 'StabilityRate', 'Range'];
  for (i = 0; i < flat.length; i++) { set(flat[i], a[SK[flat[i]]]); }
  // 特効増加・与ダメージ・被ダメージは 10000 が既定（SchaleDB の CharacterStats と同じ）
  var base1 = ['EnhanceExplosionRate', 'EnhancePierceRate', 'EnhanceMysticRate',
               'EnhanceSonicRate', 'DamageRatio', 'AttackSpeed',
               // 2026-09-01 に足した。EX スキルダメージ倍率（キサキ枠）と
               // 与ダメージ倍率の B 枠。どちらも 10000 が既定
               'DamageRatio2', 'EnhanceExDamageRate', 'EnhanceBasicsDamageRate'];
  for (i = 0; i < base1.length; i++) { set(base1[i], 10000); }
  // 装備 3 枠
  for (i = 0; i < (bd.eqp || []).length; i++) {
    var cat = B.eqp[bd.eqp[i]], t = (o.eq || [])[i] || 0;
    var rowsE = cat && cat[String(t)];
    for (var q2 = 0; rowsE && q2 < rowsE.length; q2++) { add(rowsE[q2][0], rowsE[q2][1]); }
  }
  // 固有武器
  var ad = { Street: 0, Outdoor: 0, Indoor: 0 };
  if (bd.wp && o.wlv > 0) {
    var w = bd.wp, ls = (w[6] === 'Standard') ? +(((o.wlv - 1) / 99).toFixed(4)) : (o.wlv - 1) / 99;
    add('AttackPower_Base', Math.round(w[0] + (w[1] - w[0]) * ls));
    add('MaxHP_Base', Math.round(w[2] + (w[3] - w[2]) * ls));
    add('HealPower_Base', Math.round(w[4] + (w[5] - w[4]) * ls));
    // **地形適性 +1 が付くのは固有武器★3 から**（SchaleDB common.js 7812 行
    // `if (statPreviewWeaponGrade >= 3)`）。星に関係なく足していて、
    // 固有2 の子まで 1 段上がっていた（2026-09-01）
    if (w[7] && (o.wstar || 0) >= 3) { ad[w[7]] = (ad[w[7]] || 0) + (w[8] || 0); }
    // **★4 の追加ステータス。**`DB/CharacterWeaponExcelTable.json` の
    // `StatType` / `StatValue` の 4 番目。ネル（制服）は貫通特効 +1000
    if (w[9] && (o.wstar || 0) >= 4) { add(w[9], w[10] || 0); }
  }
  // 愛用品
  if (o.gear) { for (i = 0; i < (bd.gr || []).length; i++) { add(bd.gr[i][0], bd.gr[i][1]); } }
  // 絆
  var fv = bd.fav || [[], []], b1 = 0, b2 = 0;
  var cap = Math.min(o.bond || 1, (B.maxbond[star - 1] || 50));
  for (i = 1; i < Math.min(cap, 50); i++) {
    var ix = i < 20 ? Math.floor(i / 5) : 2 + Math.floor(i / 10);
    if (fv[1][ix]) { b1 += fv[1][ix][0]; b2 += fv[1][ix][1]; }
  }
  if (fv[0][0]) { add(fv[0][0], b1); }
  if (fv[0][1]) { add(fv[0][1], b2); }
  // 潜在能力（限界突破）。**素の補間値の 0.2% ／ 1 段**を固定値として足す。
  // 星の係数は掛けない（SchaleDB の `getPotentialStatAmount`、common.js 847 行
  // `interpolateStat(character[stat1], character[stat100], level) * (potentialLevel * 0.002)`）。
  // **Lv90 未満では付かない**（同 7649 行 `if (level >= 90)`）。上限は 25
  // （`config.min.json` の `PotentialMax`、Jp）
  var pt = o.pot || [0, 0, 0], PK = ['MaxHP', 'AttackPower', 'HealPower'];
  if (lv >= 90) {
    for (i = 0; i < 3; i++) {
      var pl = Math.min(pt[i] || 0, 25);
      if (!pl) { continue; }
      add(PK[i] + '_Base',
          Math.round(ipol(a[SK[PK[i] + '1']], a[SK[PK[i] + '100']], lv, 1) * pl * 0.002));
    }
  }
  // 常時のパッシブ。同じ（枠, Channel）は先に来たほうが勝つ
  var seen = {};
  for (i = 0; i < (o.extra || []).length; i++) {
    var ex = o.extra[i], key = ex.slot + '/' + ex.ch;
    if (ex.ch != null && seen[key]) { continue; }
    if (ex.ch != null) { seen[key] = 1; }
    // 固有武器パッシブの CriticalPoint_Base だけ別枠固定（common.js 7769 行）
    if (ex.slot === 'WeaponPassive' && ex.stat === 'CriticalPoint_Base') {
      if (!stats.CriticalPoint) { set('CriticalPoint', 0); }
      stats.CriticalPoint[3] += ex.v;
    } else { add(ex.stat, ex.v); }
  }
  function tot(k) {
    var v = stats[k];
    if (!v) { return 0; }
    return Math.max(0, Math.round(+(((v[0] + v[1]) * Math.max(v[2], 0.2)).toFixed(4))) + v[3]);
  }
  return { get: tot, adapt: ad, star: star, lv: lv };
}
