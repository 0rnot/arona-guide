/* 募集（ガチャ）の確率。
   ------------------------------------------------------------
   **近似をしない。** 「n 回目でちょうど初めてピックアップを引く確率」を
   1 回目から順に積み上げて、そのまま足している。

   踏まえている仕様（出典はページ下の「数字の出どころ」に書いた）:
   - ピックアップの提供割合は 0.7%。**確率アップでも動かない**
     （★3 の合計が 3.0% → 6.0% になっても、増えるのはすり抜けの側）
   - 呼び出しチャージは引いた回数だけ貯まる。単発 1、10 連 10
   - **100 カウント目は★3 確定で、その 50% がピックアップ**
   - **200 カウント目でピックアップ確定**
   - ピックアップをお迎えするとカウントは 0 に戻る。
     **だから 2 人目は 0 からやり直し** —— ここを見落とすと、
     2 人目以降が 1 人目と同じ確率で出ることになって、答えが甘くなる
   ------------------------------------------------------------ */
(function () {
  'use strict';

  var RATE_PICKUP = 0.007;   // ピックアップ 0.7%
  var CEILING = 200;         // 天井のカウント
  var HALF_AT = 100;         // ここで★3 確定・50% でピックアップ

  /** カウント i 回目（1 始まり）でピックアップを引く確率。 */
  function pAt(i) {
    if (i >= CEILING) return 1;
    if (i === HALF_AT) return 0.5;
    return RATE_PICKUP;
  }

  /**
   * 手持ちのカウント c から数えて、n 回目でちょうど初めて当たる確率。
   * 返すのは添字 0..(200-c) の配列（0 番は 0 固定）。
   */
  function firstHitPmf(c) {
    var len = CEILING - c;
    var pmf = new Array(len + 1).fill(0);
    var alive = 1;
    for (var n = 1; n <= len; n++) {
      var p = pAt(c + n);
      pmf[n] = alive * p;
      alive *= (1 - p);
    }
    return pmf;
  }

  function convolve(a, b) {
    var out = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      for (var j = 0; j < b.length; j++) {
        if (!b[j]) continue;
        out[i + j] += a[i] * b[j];
      }
    }
    return out;
  }

  /**
   * 今のカウント c から、copies 人ぶんお迎えするまでの回数の分布。
   * @returns {{cdf:number[], mean:number, max:number}}
   *   cdf[n] = n 連までに copies 人そろっている確率
   */
  function solve(c, copies) {
    var pmf = firstHitPmf(c);
    var fresh = firstHitPmf(0);   // 2 人目からはカウント 0 からやり直し
    for (var k = 1; k < copies; k++) pmf = convolve(pmf, fresh);

    var max = pmf.length - 1;
    var cdf = new Array(max + 1).fill(0);
    var acc = 0, mean = 0;
    for (var n = 0; n <= max; n++) {
      acc += pmf[n];
      cdf[n] = acc > 1 ? 1 : acc;
      mean += n * pmf[n];
    }
    // 丸め誤差で最後が 0.9999… になることがある。**天井は確実なので 1 に寄せる**
    cdf[max] = 1;
    return { cdf: cdf, mean: mean, max: max, pmf: pmf };
  }

  /**
   * 募集回数特典。**しきい値をまたぐたびに 10 連チケットが 1 枚もらえる。**
   * つまり払う石は「引いた回数」ぶんではない。
   * 200 連（天井）なら 4 枚もらえるので、実際に払うのは 160 連ぶん＝19,200 個。
   * **ここを入れないと天井のコストを 24,000 個と答えてしまう。**
   */
  var BONUS_AT = [70, 130, 150, 170, 270, 330, 350, 370];

  /** n 連するときに、実際に石で払う回数。 */
  function paidPulls(n) {
    if (n <= 0) return 0;
    var t = n;
    for (var i = 0; i < BONUS_AT.length; i++) if (n >= BONUS_AT[i]) t -= 10;
    return t;
  }

  /** n 連するまでにもらえる 10 連チケットの枚数。 */
  function bonusTickets(n) {
    var c = 0;
    for (var i = 0; i < BONUS_AT.length; i++) if (n >= BONUS_AT[i]) c++;
    return c;
  }

  /** 石 g 個で何連できるか。**特典のチケットぶんだけ余分に引ける。** */
  function pullsForGems(g) {
    var n = 0;
    while (paidPulls(n + 1) * 120 <= g) {
      n++;
      if (n > 4000) break;   // 保険
    }
    return n;
  }

  /** cdf が q に届く最小の回数。 */
  function quantile(cdf, q) {
    for (var n = 0; n < cdf.length; n++) if (cdf[n] >= q - 1e-12) return n;
    return cdf.length - 1;
  }

  window.GACHA = {
    RATE_PICKUP: RATE_PICKUP,
    RATE_STAR3: 0.03,
    RATE_STAR3_UP: 0.06,
    RATE_STAR2: 0.185,
    RATE_STAR1: 0.785,
    CEILING: CEILING,
    HALF_AT: HALF_AT,
    COST_ONE: 120,
    COST_TEN: 1200,
    BONUS_AT: BONUS_AT,
    paidPulls: paidPulls,
    bonusTickets: bonusTickets,
    pullsForGems: pullsForGems,
    solve: solve,
    quantile: quantile
  };
})();
