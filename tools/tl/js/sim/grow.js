// ------------------------------------------------------------ 育ちの層
/* **生徒 1 人の最終ステータスを、束ねた DB の行だけから出す。**

   これまで画面は `data.js` の `build` / `eqp` / `tc` / `maxbond` / `na` を引いていた。
   あれは SchaleDB の `students.min.json` を焼き直したもので、**元の表より情報が少ない**。
   ここは元の表そのものを使う。

   ## 出典（束ねたパックの中の名前 → 元の表）

     pack.st     `DB/CharacterStatExcelTable`         素の値。`*1` と `*100` の対で伸びる
     pack.tr     `DB/CharacterTranscendenceExcelTable` 星の倍率と絆の上限
     pack.gear   `DB/CharacterGearExcelTable`          愛用品。段ごとに 1 行
     pack.wp     `DB/CharacterWeaponExcelTable`        固有武器
     pack.favor  `DB/FavorLevelRewardExcelTable`       絆。**1 レベル 1 行**
     pack.pot    `DB/CharacterPotentialExcelTable`     潜在。どの統計がどの群か
     pack.potst  `DB/CharacterPotentialStatExcelTable` 潜在。段ごとの率
     pack.ch     `DB/CharacterExcelTable`              `EquipmentSlot` の 3 枠
     common.eq / common.eqstat  `DB/Equipment(Stat)ExcelTable`  装備
     common.statInterp          `DB/StatLevelInterpolationExcelTable`  レベル補間
     common.statLimit           `DB/CharacterStatLimitExcelTable`      上下限

   ## data.js から変わったところ（**どれも DB のほうが新しい**）

   - 星の倍率は生徒ごと。`data.js` は全員 `[0,1000,1200,1400,1700]` の決め打ちだった
     （ホシノで一致は確かめた。ほかの生徒に違う値があるかは表が答える）
   - 絆の上限は `MaxFavorLevel` = `[10,10,20,30,100]`。`data.js` の `[10,10,20,20,50]` は古い
   - 絆の伸びは 1 レベル 1 行。`data.js` は 5 レベル刻みの束にまとめた SchaleDB 版だった
   - 装備は段の中でもレベルで伸びる（Hat T9 は `AttackPower_Coefficient` 4600〜4800）。
     `data.js` は上限だけ持っていた。既定は今までどおり上限
   - 潜在（`pot` / `potst`）は `data.js` に無い。**既定は 0** で、頼まれたときだけ乗る

   ## 未確定（**埋めない**）

   `StatLevelInterpolationExcelTable` の `StatTypeIndex` は 5 本あるが、
   `StatLevelUpType`（`Standard` 264 / `LateBloom` 7 / `Premature` 4）との対応が
   表から決まらない。分かっているのは:

     0 番 … `(lv-1)/99` そのもの。Lv100 で 10000
     1 番 … 0 番のちょうど半分。Lv100 で 5000
     2 番 … 0 番のちょうど 1.5 倍。Lv100 で 15000
     3 番 … 0 番と完全に同じ
     4 番 … Lv25 で 808（0 番は 2424）、Lv90 で 0 番に追いつく。**遅咲きの形**

   3 種の武器の `AttackPower100 / AttackPower` はどれも中央 10.0 で差が無い
   （Standard 9.991 / LateBloom 10.008 / Premature 10.020）ので、
   **型ごとに端の値を作り分けてはいない。**つまり 1 番・2 番のような
   「端が半分／1.5 倍」の曲線は武器には当てはまらないはず。
   **決まるまで 3 種とも 0 番を使う**（＝ 今までと同じ。`data.js` も SchaleDB も
   実質これだった）。動画で 11 人のどれかを見れば決まる。
*/

/** `StatLevelUpType` → `StatTypeIndex` の何番目か。**上の「未確定」を読むこと。** */
export var LVUP_INDEX = { Standard: 0, LateBloom: 0, Premature: 0 };

/** レベル補間の割合（0〜1 以上）。**表を引く。式で作らない。**
    表に無いレベル（1 と、上限より上）は端で止める。 */
export function levelScale(common, lv, type) {
  var m = common.__lvi;
  if (!m) {
    m = common.__lvi = {};
    var rows = common.statInterp || [], i;
    for (i = 0; i < rows.length; i++) { m[rows[i].Level] = rows[i].StatTypeIndex; }
    m.__max = rows.length ? rows[rows.length - 1].Level : 1;
  }
  if (lv <= 1) { return 0; }
  var a = m[lv > m.__max ? m.__max : lv];
  if (!a) { return 0; }
  var ix = LVUP_INDEX[type] == null ? 0 : LVUP_INDEX[type];
  return (a[ix] == null ? a[0] : a[ix]) / 10000;
}

/** `min` と `max` の間をレベルで。**`data.js` と同じ丸め**（SchaleDB の写し）。 */
function ip(a, b, sc) { return Math.ceil(Math.round(a + (b - a) * sc)); }

/** 装備の鎖。カテゴリ → 段 → 装備の行。**`TierInit` が 1 の行から
    `NextTierEquipment` を辿る。**同じ段に別 Id（101xxx）が居るので、
    段の番号で引くと強化素材のほうを掴むことがある（`data.js` が踏んだ穴）。 */
export function eqChain(common) {
  if (common.__eqc) { return common.__eqc; }
  var by = {}, out = {}, rows = common.eq || [], i;
  for (i = 0; i < rows.length; i++) { by[rows[i].Id] = rows[i]; }
  var stat = {}, sr = common.eqstat || [];
  for (i = 0; i < sr.length; i++) { stat[sr[i].EquipmentId] = sr[i]; }
  for (i = 0; i < rows.length; i++) {
    if (rows[i].TierInit !== 1) { continue; }
    var cur = rows[i], seen = 0;
    while (cur && seen < 32) {
      (out[cur.EquipmentCategory] || (out[cur.EquipmentCategory] = {}))[cur.TierInit] =
        { eq: cur, st: stat[cur.Id] || null };
      cur = by[cur.NextTierEquipment || 0];
      seen++;
    }
  }
  common.__eqc = out;
  return out;
}

/** 統計 1 つを足し込む。キーの尻（`_Base` / `_Coefficient` / `_BaseOuter`）で行き先が変わる。
    **`run.js:statsNow` と同じ積み方。** */
function add(acc, key, amt) {
  var q = String(key).split('_'), k = q[0], kind = q[1];
  if (!k || k === 'None') { return; }
  var v = acc[k] || (acc[k] = [0, 0, 1, 0]);
  if (kind === 'Coefficient') { v[2] += amt / 10000; }
  else if (kind === 'BaseOuter') { v[3] += amt; }
  else { v[1] += amt; }
}

/** 上下限。`CharacterStatLimitExcelTable` の `Student` の行。 */
function limits(common) {
  if (common.__lim) { return common.__lim; }
  var out = {}, rows = common.statLimit || [], i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].TacticEntityType === 'Student') { out[rows[i].StatType] = rows[i]; }
  }
  common.__lim = out;
  return out;
}

/** レベルで伸びる 5 つ。**この 5 つだけが `*1` と `*100` の対を持っている。** */
var LEVELED = [
  ['AttackPower', 'AttackPower1', 'AttackPower100', 'StatBonusRateAttack'],
  ['MaxHP', 'MaxHP1', 'MaxHP100', 'StatBonusRateHP'],
  ['DefensePower', 'DefensePower1', 'DefensePower100', null],
  ['HealPower', 'HealPower1', 'HealPower100', 'StatBonusRateHeal'],
  ['DefensePenetration', 'DefensePenetration1', 'DefensePenetration100', null],
  ['DefensePenetrationResist', 'DefensePenetrationResist1',
   'DefensePenetrationResist100', null],
];

/** **1 人ぶんの最終ステータス。**

    o = { lv, star, eq, wlv, wstar, gear, bond, pot }
      lv     生徒のレベル（既定 90）
      star   星（1〜5。既定は `ch.DefaultStarGrade`）
      eq     装備 3 枠。`[9,9,9]` のように段だけ書くと**その段の上限レベル**。
             `[{t:9,lv:1},…]` と書けばその段のそのレベル
      wlv    固有武器のレベル（0 なら固有武器なし）
      wstar  固有武器の星（1〜5）。★ごとの追加ステータスがここで開く
      gear   愛用品の段（`true` は「持っている全部の段」＝ 最大。`0`/`false` で無し）
      bond   絆。`MaxFavorLevel[star-1]` で頭打ち
      bondAlt 同じ人物の別バージョンの絆。`pack.alts` の順。頭打ちは 50 だけ
      pot    潜在 `{MaxHP, AttackPower, HealPower}` の段（0〜25）。**既定は 0**

    返すのは平べったい `{統計名: 数}`。`run.js` の `party[i].stats` はこの形。 */
export function grow(pack, common, o) {
  o = o || {};
  var st = pack.st, ch = pack.ch || {}, i, k;
  if (!st) { return null; }
  var lv = o.lv || 90;
  var tr = (pack.tr || [])[0] || {};
  var star = o.star || ch.DefaultStarGrade || 1;
  var sc = levelScale(common, lv, 'Standard');

  // ---- 星の倍率。**生徒ごとの表から。**0 段目から star-1 段目までを足す
  var tcOf = function (key) {
    var a = key && tr[key], m = 1, n;
    for (n = 0; a && n < star && n < a.length; n++) { m += (a[n] || 0) / 10000; }
    return m;
  };

  var acc = {}, gaps = [];
  // ---- 素の値。伸びる 6 つは補間、あとはそのまま
  var leveled = {};
  for (i = 0; i < LEVELED.length; i++) {
    var L = LEVELED[i];
    if (st[L[1]] == null) { continue; }
    leveled[L[0]] = 1;
    acc[L[0]] = [Math.ceil(ip(st[L[1]], st[L[2]], sc) * tcOf(L[3])), 0, 1, 0];
  }
  for (k in st) {
    if (k === 'CharacterId' || leveled[k]) { continue; }
    if (/(1|100)$/.test(k) && leveled[k.replace(/(1|100)$/, '')]) { continue; }
    if (typeof st[k] !== 'number') { continue; }
    if (!acc[k]) { acc[k] = [st[k], 0, 1, 0]; }
  }

  // ---- 装備 3 枠
  var chain = eqChain(common), slots = ch.EquipmentSlot || [];
  for (i = 0; i < slots.length; i++) {
    var want = (o.eq || [])[i];
    if (want == null || want === false) { continue; }
    var tier = typeof want === 'object' ? want.t : want;
    var row = (chain[slots[i]] || {})[tier];
    if (!row || !row.st) { continue; }
    var es = row.st, elv = typeof want === 'object' && want.lv != null
      ? want.lv : (es.DefaultMaxLevel || row.eq.MaxLevel || 1);
    var esc = levelScale(common, elv, es.StatLevelUpType);
    // **装備は上限レベルで割合 1。**レベル 100 基準ではない
    var top = levelScale(common, es.DefaultMaxLevel || row.eq.MaxLevel || 1,
                         es.StatLevelUpType);
    var f = top > 0 ? Math.min(esc / top, 1) : 1;
    for (k = 0; k < (es.StatType || []).length; k++) {
      add(acc, es.StatType[k],
          Math.round((es.MinStat[k] || 0) +
                     ((es.MaxStat[k] || 0) - (es.MinStat[k] || 0)) * f));
    }
  }

  // ---- 固有武器
  var wp = (pack.wp || [])[0];
  if (wp && (o.wlv || 0) > 0) {
    var wstar = o.wstar || 1;
    var wmax = (wp.MaxLevel || [])[wstar - 1] || 70;
    var wlv = Math.min(o.wlv, wmax);
    var wsc = levelScale(common, wlv, wp.StatLevelUpType);
    add(acc, 'AttackPower_Base', Math.round(wp.AttackPower +
        ((wp.AttackPower100 || 0) - (wp.AttackPower || 0)) * wsc));
    add(acc, 'MaxHP_Base', Math.round(wp.MaxHP +
        ((wp.MaxHP100 || 0) - (wp.MaxHP || 0)) * wsc));
    add(acc, 'HealPower_Base', Math.round(wp.HealPower +
        ((wp.HealPower100 || 0) - (wp.HealPower || 0)) * wsc));
    // ★ごとの追加。`StatType[i]` は ★(i+1) で開く
    for (i = 0; i < wstar && i < (wp.StatType || []).length; i++) {
      if (wp.StatType[i] && wp.StatType[i] !== 'None') {
        add(acc, wp.StatType[i], wp.StatValue[i] || 0);
      }
    }
  }

  // ---- 愛用品。段ごとに 1 行。`true` なら持っている全部の段
  if (o.gear) {
    var gmax = o.gear === true ? 99 : o.gear;
    var gs = pack.gear || [];
    for (i = 0; i < gs.length; i++) {
      if ((gs[i].Tier || 0) > gmax) { continue; }
      for (k = 0; k < (gs[i].StatType || []).length; k++) {
        // `MaxLevel` が 1 なので min と max は同じ。念のため max を使う
        add(acc, gs[i].StatType[k], (gs[i].MaxStatValue || [])[k] || 0);
      }
    }
  }

  // ---- 絆。**1 レベル 1 行。**上限は `MaxFavorLevel[star-1]`
  var bcap = (tr.MaxFavorLevel || [])[star - 1];
  var bond = Math.min(o.bond == null ? 1 : o.bond, bcap == null ? 50 : bcap);
  var fv = pack.favor || [];
  // **`FavorLevelRewardExcelTable` に行が無い生徒が 3 人いる**（2026-09-06 に全数で確認）。
  // 10099 小鳥遊ホシノ（臨戦）・10144 シュエリン・20061。`DB/` にも `Excel/` にも
  // 無い（DB は 272 人 × 50 行 = 13,600 行ちょうど）。**埋めない。**
  // 絆ぶんが乗らないので、この 3 人だけ攻撃 1.3% ／ HP 2.5% ほど低く出る。
  // `__gaps` に出しておくので、呼ぶ側はそれを見て「不明」と言える
  if (!fv.length && bond > 1) { gaps.push('favor'); }
  for (i = 0; i < fv.length; i++) {
    if ((fv[i].FavorLevel || 0) > bond) { continue; }
    for (k = 0; k < (fv[i].StatType || []).length; k++) {
      add(acc, fv[i].StatType[k], (fv[i].StatValue || [])[k] || 0);
    }
  }

  // ---- **同じ人物の別バージョンの絆も足す**（2026-09-08）。
  // SchaleDB `js/common.js` 8054 行が `FavorAlts[i-1]` の `getBondStats(alt, bond[i])` を
  // そのまま `addBuff` している。**星による頭打ちは本人ぶんだけ**で、別バージョンには掛からない。
  // TL の「絆40-バ19-通20」がこの 3 つ。**組分けだけは `DB/` にも `Excel/` にも無い**ので、
  // `pack.alts` / `pack.favorAlt` は `students.json` の `FavorAlts` から積んである
  // （`scripts/build-tl-db.py:favor_alts`）。書いていなければ 1 ＝ 加算 0
  var alts = pack.alts || [], fa = pack.favorAlt || {}, ab = o.bondAlt || [];
  for (var ai = 0; ai < alts.length; ai++) {
    var abv = Math.min(ab[ai] == null ? 1 : ab[ai], 50);
    if (abv <= 1) { continue; }
    var far = fa[String(alts[ai])] || [];
    if (!far.length) { gaps.push('favorAlt'); continue; }
    for (i = 0; i < far.length; i++) {
      if ((far[i].FavorLevel || 0) > abv) { continue; }
      for (k = 0; k < (far[i].StatType || []).length; k++) {
        add(acc, far[i].StatType[k], (far[i].StatValue || [])[k] || 0);
      }
    }
  }

  // ---- 潜在（限界突破）。**既定は 0。**`CharacterPotentialStatExcelTable` の
  // `StatBonusRate` は 1 段 20、25 段で 500 の 1 万分率。
  // **掛けるのは「素の補間値」で、星の倍率は掛けない。固定値として足す。**
  // Lv90 未満では付かない（SchaleDB `js/common.js` 7649 行 `if (level >= 90)`、
  // 847 行 `interpolateStat(...) * (potentialLevel * 0.002)`。0.002 = 20/10000 で
  // DB の 1 段ぶんと一致する）。上限は 25 段
  if (o.pot && lv >= 90) {
    var pst = {}, ps = pack.potst || [];
    for (i = 0; i < ps.length; i++) {
      (pst[ps[i].PotentialStatGroupId] || (pst[ps[i].PotentialStatGroupId] = {}))
        [ps[i].PotentialLevel] = ps[i].StatBonusRate;
    }
    var pg = pack.pot || [];
    for (i = 0; i < pg.length; i++) {
      var pk = pg[i].PotentialStatBonusRateType;
      var want2 = Math.min(o.pot[pk] || 0, 25);
      if (!want2 || st[pk + '1'] == null) { continue; }
      var rate = (pst[pg[i].PotentialStatGroupId] || {})[want2] || 0;
      add(acc, pk + '_Base',
          Math.round(ip(st[pk + '1'], st[pk + '100'], sc) * rate / 10000));
    }
  }

  // ---- 仕上げ。**`run.js:statsNow` と同じ形。**係数の下限 0.2 も同じ
  var lim = limits(common), out = {};
  for (k in acc) {
    var v = acc[k];
    var x = Math.round(+(((v[0] + v[1]) * Math.max(v[2], 0.2)).toFixed(4))) + v[3];
    var L2 = lim[k];
    if (L2) {
      if (L2.StatMinValue != null && x < L2.StatMinValue) { x = L2.StatMinValue; }
      if (L2.StatMaxValue != null && x > L2.StatMaxValue) { x = L2.StatMaxValue; }
    } else if (x < 0) { x = 0; }
    out[k] = x;
  }
  // **足りなかったものを持たせる。**統計として数えられないよう列挙から外す
  Object.defineProperty(out, '__gaps', { value: gaps, enumerable: false });
  // **係数を畳む前の形も持たせる**（2026-09-07）。`run.js:statsNow` はここから始める。
  // 装備の `AttackPower_Coefficient`（帽子 +50%）はバフの `Coefficient` と**同じ溜まり**で、
  // 畳んだ値にバフの係数を掛け直すと装備ぶんが 2 度掛かる（ネル（制服）で
  // 16,603 対 14,441。旧い道 `stats.js:mkStats` は 1 つの溜まりで足してから掛ける）
  Object.defineProperty(out, '__raw', { value: acc, enumerable: false });
  return out;
}
