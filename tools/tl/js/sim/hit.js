// ------------------------------------------------------------ 一撃ぶんのダメージ
/* **式は `js/dmg.js` の `dmgAt` の写し。**作り直していない。
   違うのは「どこから値を取るか」だけで、`dmgAt` が `st`（画面の状態）と
   `B`（焼き出した `data.js`）から引くところを、こちらは**引数で全部受け取る**。

   なぜ切り出すか。`dmgAt` は画面が無いと動かない（`st.party` / `B.dmg` / `statsOf` /
   `enemyAt` を掴んでいる）ので、node で 1 万回まわせない。ここは掴むものが無いので
   まわせる。

   **式が 2 つに割れる危険がある。**割れていないことは `tl-work/_hitcmp.mjs` が
   画面の出す数字と突き合わせて確かめる。直すときは必ず両方を直す。

   出典は `dmg.js` に書いてあるとおり:
   SchaleDB の `js/common.js` の `calculateDamage` ／ Zenn「ブルーアーカイブ
   ダメージ計算の仕組み」13〜14 章 ／ ItJustWorks の Library of Stats and Formulas。
   定数は `Excel/ConstCombatExcelTable`（`DefenceConstC 6000` / `AccuracyConstC 3000` /
   `CriticalConstA 4000` `CriticalConstC 6000`）。

   ## 引数

     a  撃つ側   { atk, pen, dr, dr2, exRate, baRate, stab, stabR, acc, crit, critDmg,
                   terr, eff }
        terr は地形の倍率（`TerrainAdaptationFactorExcelTable` の `AttackPowerFactor`）、
        eff は特効の倍率（`BulletArmorDamageFactorExcelTable` の `DamageRate`）。
        **どちらも既に倍率に直した数**（1.3 など）
     d  受ける側 { def, dodge, critResist, critDmgResist, damaged, damaged2, dbase }
     s  この一撃 { scale, mult, tick, ig, sm, hr, isEx, isBasic, lvDiff }

   ## 返り値

     { min, avg0, avg, avgC, max, va, hit, crit }

     avg0  会心が 1 度も出ないときの平均   avgC  毎回会心するときの平均
     avg   会心率で混ぜた平均              va    この一撃の分散（突破率に要る）
*/

/** `Math.min` / `Math.max` を 1 つに。`dmg.js` の `clamp` と同じ */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** 防御による減衰。**`dmg.js:defModOf` の写し。**
    `ig` は効果ごとの防御無視（1 万分率、`null` なら無視しない） */
export function defMod(def, pen, ig, C) {
  var c = (C && C.DefenceConstC) || 6000;
  var a = (C && C.DefenceConstA) || 10000;
  var d2 = Math.max(((def || 0) - (pen || 0)) * ((ig == null ? 10000 : ig) / 10000), 0);
  return (a * 1000) / (d2 * c + a * 1000);
}

/** 命中率。**`dmg.js` の写し。**`AccuracyConstA 10000` / `AccuracyConstC 3000` */
export function hitRate(dodge, acc, C) {
  var a = (C && C.AccuracyConstA) || 10000;
  var c = (C && C.AccuracyConstC) || 3000;
  return clamp((a / 5) / (Math.max((dodge || 0) - (acc || 0), 0) * (c / 1000) + a / 5), 0, 1);
}

/** 会心率。**`dmg.js` の写し。**`CriticalConstA 4000` / `CriticalConstC 6000` */
export function critRate(cp, resist, C) {
  var a = (C && C.CriticalConstA) || 4000;
  var c = (C && C.CriticalConstC) || 6000;
  return clamp(1 - (a * 1000) / (Math.max((cp || 0) - (resist || 0), 0) * c + a * 1000), 0, 1);
}

/** 安定値からくる最小倍率。**`dmg.js` の写し**（`stab / (stab + 1000) + stabR / 10000`） */
export function stabMin(stab, stabR) {
  return clamp((stab || 0) / ((stab || 0) + 1000) + (stabR || 0) / 10000, 0, 1);
}

/** レベル差の倍率。**表は `BattleLevelFactorExcelTable`。**
    `LevelDiff`（撃つ側 − 受ける側）が 0 で 10000、1 レベルごとに 200 減って
    -30 から -50 は 4000 で止まる。**正の行は表に無い**ので 1 で止める。
    表を渡せばそれを引き、無ければ `dmg.js` と同じ式で近似する */
export function lvMod(lvDiff, table) {
  if (table && table.length) {
    var lo = null, i;
    for (i = 0; i < table.length; i++) {
      if (table[i].LevelDiff === lvDiff) { return table[i].DamageRate / 10000; }
      if (table[i].LevelDiff < lvDiff && (lo == null || table[i].LevelDiff > lo.LevelDiff)) {
        lo = table[i];
      }
    }
    // 表の外（＝ 撃つ側のほうが高い）は 1 で止める
    return lo ? Math.min(1, lo.DamageRate / 10000) : 1;
  }
  return clamp(1 + lvDiff * 0.02, 0.4, 1);
}

/** ダメージの上限と逓減。**表は `CharacterCalculationLimitExcelTable` の
    `FinalDamage` 行。**`LimitStartValue` × 400 が段の切れ目、係数は
    `1 − DecreaseRate / 10000`。`dmg.js` の `CAPS` はこれを展開したもの。

    渡さなければ `dmg.js` と同じ既定を使う（値も同じ）。 */
export function capsOf(calcLimit) {
  var rows = calcLimit || [], i, r = null;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].CalculationValue === 'FinalDamage' &&
        rows[i].TacticEntityType === 'Student') { r = rows[i]; }
  }
  if (!r || !r.LimitStartValue || !r.LimitStartValue.length) {
    return [[4000000, 1], [6248000, 0.8], [8496000, 0.65], [10744000, 0.5],
            [12992000, 0.4], [15240000, 0.3], [17488000, 0.225],
            [19736000, 0.15], [22000000, 0.075]];
  }
  var out = [[r.LimitStartValue[0] * 400, 1]], k;
  for (k = 1; k < r.LimitStartValue.length; k++) {
    out.push([r.LimitStartValue[k] * 400, 1 - (r.DecreaseRate[k - 1] || 0) / 10000]);
  }
  return out;
}

/** 1 発ぶんに上限を掛ける。**`dmg.js:dmgCap` の写し。** */
export function cap(x, caps) {
  var C = caps || capsOf(null);
  if (!(x > C[0][0])) { return x || 0; }
  var out = 0, lo = 0, i;
  for (i = 0; i < C.length; i++) {
    out += C[i][1] * Math.max(0, Math.min(x, C[i][0]) - lo);
    lo = C[i][0];
  }
  return out;
}

/** **一撃ぶん。**`dmg.js:dmgAt` の 1 効果ぶんをそのまま。

    `dmg.js` はここで `effs` を回して足し上げるが、こちらは 1 効果ずつ返す。
    **1 発を別々に振る**ためで、突破率をモンテカルロで出すのに要る
    （2026-09-04 に「1 発を別々に振られる 1 単位に分ける」と決めた形）。

    `s.tick`（継続の回数・`HitFrames` の数・居座る範囲の回数）と
    `s.hits`（`Hits` の取り分）は **`dmg.js` と同じ割り方**で扱う。
    まとめて 1 発にすると分散が回数倍に膨らむので、1 回ぶんに割ってから回数を掛ける。 */
export function once(a, d, s, C, lvTable, caps) {
  var dm = defMod(d.def, a.pen, s.ig, C);
  var drA = ((a.dr == null ? 10000 : a.dr) / 10000) *
            ((20000 - (d.damaged == null ? 10000 : d.damaged)) / 10000) *
            (d.dbase == null ? 1 : d.dbase);
  var drB = ((a.dr2 == null ? 10000 : a.dr2) / 10000) *
            ((20000 - (d.damaged2 == null ? 10000 : d.damaged2)) / 10000);
  // **EX 枠（キサキ枠）は EX 由来のダメージにだけ。**通常攻撃には掛からない
  var exM = s.isEx ? ((a.exRate == null ? 10000 : a.exRate) / 10000) : 1;
  var baM = s.isBasic ? ((a.baRate == null ? 10000 : a.baRate) / 10000) : 1;

  var tick = Math.max(1, s.tick == null ? 1 : s.tick);
  var base = (a.atk || 0) * (a.terr == null ? 1 : a.terr) * (a.eff == null ? 1 : a.eff) *
             ((s.scale || 0) / 10000) * (s.mult == null ? 1 : s.mult) * dm *
             drA * drB * exM * baM * lvMod(s.lvDiff || 0, lvTable) * tick *
             (s.sm == null ? 1 : s.sm) * (s.hr == null ? 1 : s.hr);

  var sMin = s.noStab ? 1 : stabMin(a.stab, a.stabR);
  var h = s.hit != null ? s.hit : hitRate(d.dodge, a.acc, C);
  var cr = s.crit != null ? s.crit : critRate(a.crit, d.critResist, C);
  // **会心の倍率には 1 倍の下限。**下限が無いと合計が負になる
  // （イェソド Torment は会心ダメージ抵抗率 30,000 ＞ 生徒の 20,000）。`dmg.js` と同じ
  var cdm = s.noCrit ? 1
    : Math.max(((a.critDmg == null ? 20000 : a.critDmg) - (d.critDmgResist || 0)) / 10000, 1);
  if (s.noCrit) { cr = 0; }
  var pr = s.rate != null ? s.rate / 10000 : 1;

  // **`Hits` の取り分。**`dmg.js:capS` と同じで、取り分ごとに上限を掛けてから足す
  var hs = (s.hits && s.hits.length) ? s.hits : null, hsm = 0, q;
  if (hs) { for (q = 0; q < hs.length; q++) { hsm += hs[q]; } }
  function capS(f) {
    if (!hs || !(hsm > 0)) { return cap(base * f / tick, caps) * tick; }
    var t2 = 0, z;
    for (z = 0; z < hs.length; z++) { t2 += cap(base / tick * (hs[z] / hsm) * f, caps); }
    return t2 * tick;
  }

  var eU = (sMin + 1) / 2;                 // 一様乱数の平均
  var eU2 = (sMin * sMin + sMin + 1) / 3;  // 同じく二乗の平均
  var cA = capS(eU), cB = capS(eU * cdm);
  var avg0 = cA * h * pr, avgC = cB * h * pr;
  var avg = ((1 - cr) * cA + cr * cB) * h * pr;

  // **分散。**1 回ぶんに割ってから回数を掛ける（`dmg.js` と同じ）。
  // `hf2` は `Hits` の取り分が偏っているぶんの効き（均等なら 1）
  var hsq = 0;
  if (hs) { for (q = 0; q < hs.length; q++) { hsq += hs[q] * hs[q]; } }
  var hf2 = (hs && hs.length > 1 && hsm > 0) ? hsq / (hsm * hsm) : 1;
  var b1 = base / tick;
  var eC = 1 + (cdm - 1) * cr, eC2 = (1 - cr) + cr * cdm * cdm;
  var m1 = b1 * eU * h * eC;
  var m2 = b1 * b1 * hf2 * eU2 * h * eC2;
  var v1 = Math.max(0, m2 - m1 * m1 * hf2);

  return {
    min: pr < 1 ? 0 : capS(sMin), max: capS(cdm),
    avg0: avg0, avgC: avgC, avg: avg,
    va: pr * tick * v1 + pr * (1 - pr) * tick * tick * m1 * m1,
    hit: h, crit: cr, cdm: cdm, base: base, b1: b1, tick: tick,
    sMin: sMin, rate: pr, caps: caps,
  };
}

/** **1 回振る。**モンテカルロ用。`rnd` は 0〜1 を返す関数（外から差し替えられる）。
    `tick` 回ぶんを 1 回ずつ振って足す。**まとめて振らない。** */
export function roll(o, rnd) {
  if (rnd() >= o.rate) { return 0; }
  var sum = 0, i, u;
  for (i = 0; i < o.tick; i++) {
    if (rnd() >= o.hit) { continue; }
    u = o.sMin + (1 - o.sMin) * rnd();
    sum += cap(o.b1 * u * (rnd() < o.crit ? o.cdm : 1), o.caps);
  }
  return sum;
}
