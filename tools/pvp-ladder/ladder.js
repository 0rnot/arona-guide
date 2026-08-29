/* 戦術対抗戦の順位経路。
   ------------------------------------------------------------
   **挑戦できる相手の順位は、自分の順位から決まる。**

     13 位より下 … 自分の順位 × 0.95 〜 × 0.7（どちらも小数点以下切り捨て）
     11 〜 13 位 … 自分の順位 − 2 〜 − 4
      5 〜 10 位 … 自分の順位 − 1 〜 − 3
      2 〜  4 位 … 自分の順位 − 1 〜 1 位

   **11 位から 10 位へは挑めない。** ここの段差を落とすと、
   11 位以降の手数が全部ずれる（ブルアカ攻略 Wiki の記述どおり）。

   最小手数 dist[r] は、r が大きいほど大きい（単調）。だから
   「届く範囲でいちばん上の順位」へ跳ぶのが常に最短になる。
   ------------------------------------------------------------ */
(function () {
  'use strict';

  var MAX_RANK = 15001;   // シーズン開始時は全員ここから

  /** 順位 r から挑戦できる範囲を [下位側, 上位側] で返す。 */
  function range(r) {
    // **先に掛けてから割る。** `r * 0.7` だと 10500 が 7349.999… になって
    // 7349 位へ落ちる（Wiki が公表している 23 手の経路と 1 つずれた）。
    if (r > 13) return [Math.floor(r * 95 / 100), Math.floor(r * 7 / 10)];
    if (r > 10) return [r - 2, r - 4];
    if (r > 4)  return [r - 1, r - 3];
    if (r > 1)  return [r - 1, 1];
    return [1, 1];
  }

  /**
   * 経路を作る。
   * @param start 開始順位（2 〜 15001）
   * @param goal  1 か 2
   * @param mode  'top'（届く範囲でいちばん上）/ 'many'（いちばん下＝対戦回数を稼ぐ）
   */
  function path(start, goal, mode) {
    var steps = [];
    var r = start;
    var guard = 0;
    while (r > goal && guard++ < 400) {
      var rg = range(r);
      var lo = Math.max(rg[1], 1);       // 上位側（数字が小さい）
      var hi = Math.min(rg[0], r - 1);   // 下位側（数字が大きい）
      if (hi < lo) break;                // 届く相手が居ない
      var next;
      if (mode === 'many') {
        // 対戦回数を稼ぐ。**ただし目標を飛び越さない範囲で下を選ぶ**
        next = Math.max(hi, goal);
        if (next >= r) next = r - 1;
      } else {
        next = lo;
        if (goal === 2 && next < 2) next = 2;
      }
      if (next >= r) break;
      steps.push({ from: r, to: next, lo: lo, hi: hi });
      r = next;
    }
    return { steps: steps, reached: r, ok: r <= goal };
  }

  /** 順位ごとの日別報酬。**帯の下限（その順位以上なら）で引く。** */
  var REWARD = [
    // [この順位まで, 青輝石, 戦術対抗戦コイン]
    [1,     45, 125],
    [2,     40, 120],
    [10,    35, 110],
    [100,   30, 100],
    [200,   25,  90],
    [500,   20,  80],
    [1000,  18,  70],
    [2000,  16,  60],
    [4000,  14,  50],
    [8000,  12,  40],
    [15000, 10,  30]
  ];

  function rewardAt(rank) {
    for (var i = 0; i < REWARD.length; i++) if (rank <= REWARD[i][0]) return { gem: REWARD[i][1], coin: REWARD[i][2] };
    return { gem: 0, coin: 0 };
  }

  window.PVP_LADDER = {
    MAX_RANK: MAX_RANK,
    range: range,
    path: path,
    REWARD: REWARD,
    rewardAt: rewardAt,
    TICKET_FREE: 5,        // 1 日に配られる挑戦チケット
    TICKET_BUY_GEM: 60,    // 青輝石 60 個で
    TICKET_BUY_N: 5        // 5 枚
  };
})();
