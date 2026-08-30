/* 宝探し（在庫管理）の確率計算。
   ------------------------------------------------------------
   9 × 5 の盤に、決まった大きさの備品が決まった個数、重ならずに置かれている。
   開けて分かったこと（何も無かった／この備品だった）を入れると、
   残りのマスに何がある確率が何 % かを出す。

   近似ではない。列を左から右へ走る DP で、条件に合う置き方を全部数え上げ、
   その総数で割ったものが確率。

   ## 前提

   - 置き方は、あり得る全通りから一様に選ばれている
   - 置き方は開ける前に決まっていて、あとから変わらない
   - 決まった型（出ない配置）は無い

   ## 持ち歩く状態

   各行について「いまの列から先、あと何マスぶん埋まっているか」だけ。
   値の幅は **いちばん幅の広い備品** で決まるので、2 進ではなく
   その幅を基数にして 5 行ぶんを 1 つの整数に畳む
   （幅 4 までなら 4^5 = 1024 通り。3 ビット固定より小さく収まる）。

   どの備品が埋めているかは覚えない。覚えなくていいのは、開けたマスの条件を
   「置く瞬間」にまとめて確かめるから —— 備品が覆うマスすべてについて
   「まだ開けていない」か「その備品として開いている」かを、置く時点で見る。

   高さ h の備品を置いたら、位置を h 行ぶん飛ばす。飛ばした行はその備品で
   埋まりきっていて他に何も起きないため。これで値が 0〜(幅-1) に収まる。

   ## 確率の出し方

   前向きの数え上げ g と後ろ向きの数え上げ f を両方作る。
   「備品 k をここに置く」という枝の重みは g[手前] × f[置いた後]。
   これをその備品が覆うマスすべてに足し、総数で割る。厳密な確率。
   ------------------------------------------------------------ */
(function (root) {
  'use strict';

  var W = 9, H = 5, N = W * H;
  var UNKNOWN = -1;   // まだ開けていない
  var EMPTY = -2;     // 開けたら何も無かった
  var MAX_W = 6;      // これより幅が広いと状態が持てない（6^5 = 7,776）

  function forms(it) {
    var f = [[it.w, it.h]];
    if (it.w !== it.h) f.push([it.h, it.w]);
    return f.filter(function (x) { return x[0] <= W && x[1] <= H; });
  }

  /**
   * @param items [{w,h,count}] 1〜3 種類
   * @param board 長さ 45 (col*H+row)。UNKNOWN / EMPTY / 0..K-1
   * @returns {total, prob:Float64Array(N*K), empty:Float64Array(N), error}
   */
  function solve(items, board) {
    var K = items.length;
    if (!K) return { total: 0, error: '備品が 1 つも指定されていません。' };

    var fs = items.map(forms);
    for (var i0 = 0; i0 < K; i0++) {
      if (!fs[i0].length) return { total: 0, error: (i0 + 1) + ' 番目の備品が盤に入りません。' };
    }

    // 状態の基数。**置いたあとに残る幅 = 幅 - 1** なので、基数は最大幅でよい
    var RM = 1;
    fs.forEach(function (list) {
      list.forEach(function (f) { if (f[0] > RM) RM = f[0]; });
    });
    if (RM > MAX_W) return { total: 0, error: '横 ' + MAX_W + ' マスより広い備品には対応していません。' };
    RM = Math.max(RM, 1);

    var POW = [1];
    for (var r0 = 1; r0 <= H; r0++) POW.push(POW[r0 - 1] * RM);
    var NW = POW[H];

    function wGet(w, r) { return Math.floor(w / POW[r]) % RM; }
    function wSet(w, r, v) { return w + (v - wGet(w, r)) * POW[r]; }

    var cap = items.map(function (it) { return it.count; });
    var nC = 1, base = [];
    for (var i = 0; i < K; i++) { base.push(nC); nC *= (cap[i] + 1); }

    var SZ = NW * nC;
    if (SZ * (N + 1) > 40e6) return { total: 0, error: '数え上げが大きすぎます。個数を減らしてください。' };

    // ---- 枝を先に作る。盤は固定なので、置ける場所と可否はここで一度だけ決まる
    var branches = new Array(N);
    for (var p = 0; p < N; p++) {
      var col = (p / H) | 0, row = p % H, list = [];
      for (var k = 0; k < K; k++) {
        for (var fi = 0; fi < fs[k].length; fi++) {
          var aw = fs[k][fi][0], ah = fs[k][fi][1];
          if (col + aw > W || row + ah > H) continue;
          var ok = true, cells = [];
          for (var dy = 0; dy < ah && ok; dy++) {
            for (var dx = 0; dx < aw; dx++) {
              var idx = (col + dx) * H + (row + dy), v = board[idx];
              if (v !== UNKNOWN && v !== k) { ok = false; break; }
              cells.push(idx);
            }
          }
          if (ok) list.push({ k: k, aw: aw, ah: ah, cells: cells, dp: ah });
        }
      }
      branches[p] = list;
    }

    // 「空けておく」が許されるか。備品として開いているマスは空にできない
    var canEmpty = new Uint8Array(N);
    for (var q = 0; q < N; q++) canEmpty[q] = (board[q] === UNKNOWN || board[q] === EMPTY) ? 1 : 0;

    // ---- 後ろ向き f
    var f = new Array(N + 1);
    for (var p2 = 0; p2 <= N; p2++) f[p2] = new Float64Array(SZ);
    f[N][0] = 1;   // profile 0（はみ出し無し）・個数 0（使い切り）

    for (var p3 = N - 1; p3 >= 0; p3--) {
      var row3 = p3 % H, cur = f[p3], list3 = branches[p3];
      for (var wb = 0; wb < NW; wb++) {
        var cw = wGet(wb, row3), dstBase = wb * nC;
        if (cw > 0) {
          var src = f[p3 + 1], off = wSet(wb, row3, cw - 1) * nC;
          for (var ci = 0; ci < nC; ci++) cur[dstBase + ci] = src[off + ci];
          continue;
        }
        if (canEmpty[p3]) {
          var s0 = f[p3 + 1], o0 = wb * nC;
          for (var ci2 = 0; ci2 < nC; ci2++) cur[dstBase + ci2] += s0[o0 + ci2];
        }
        for (var bi = 0; bi < list3.length; bi++) {
          var b = list3[bi], fit = true, w2 = wb;
          for (var dy2 = 0; dy2 < b.ah; dy2++) {
            if (wGet(wb, row3 + dy2) !== 0) { fit = false; break; }
            w2 = wSet(w2, row3 + dy2, b.aw - 1);
          }
          if (!fit) continue;
          var nx = f[p3 + b.dp], nOff = w2 * nC, st = base[b.k], capk = cap[b.k];
          for (var ci3 = 0; ci3 < nC; ci3++) {
            if ((((ci3 / st) | 0) % (capk + 1)) === 0) continue;   // 残り 0 なら置けない
            cur[dstBase + ci3] += nx[nOff + ci3 - st];
          }
        }
      }
    }

    var startC = 0;
    for (var i4 = 0; i4 < K; i4++) startC += cap[i4] * base[i4];
    var total = f[0][startC];
    if (!(total > 0)) return { total: 0, prob: null, empty: null };

    // ---- 前向き g と、同時に周辺確率
    var g = new Array(N + 1);
    for (var p5 = 0; p5 <= N; p5++) g[p5] = new Float64Array(SZ);
    g[0][startC] = 1;

    var prob = new Float64Array(N * K), emptyP = new Float64Array(N);

    for (var p6 = 0; p6 < N; p6++) {
      var row6 = p6 % H, gc = g[p6], list6 = branches[p6];
      for (var wb6 = 0; wb6 < NW; wb6++) {
        var gOff = wb6 * nC, any = false;
        for (var t = 0; t < nC; t++) if (gc[gOff + t] !== 0) { any = true; break; }
        if (!any) continue;

        var cw6 = wGet(wb6, row6);
        if (cw6 > 0) {
          var gn = g[p6 + 1], nO = wSet(wb6, row6, cw6 - 1) * nC;
          for (var c7 = 0; c7 < nC; c7++) gn[nO + c7] += gc[gOff + c7];
          continue;
        }
        if (canEmpty[p6]) {
          var gn2 = g[p6 + 1], fn2 = f[p6 + 1], o2 = wb6 * nC, acc = 0;
          for (var c8 = 0; c8 < nC; c8++) {
            var gv = gc[gOff + c8];
            if (gv === 0) continue;
            gn2[o2 + c8] += gv;
            acc += gv * fn2[o2 + c8];
          }
          emptyP[p6] += acc;
        }
        for (var bj = 0; bj < list6.length; bj++) {
          var bb = list6[bj], fit2 = true, w3 = wb6;
          for (var dy3 = 0; dy3 < bb.ah; dy3++) {
            if (wGet(wb6, row6 + dy3) !== 0) { fit2 = false; break; }
            w3 = wSet(w3, row6 + dy3, bb.aw - 1);
          }
          if (!fit2) continue;
          var gnx = g[p6 + bb.dp], fnx = f[p6 + bb.dp];
          var nOff2 = w3 * nC, st2 = base[bb.k], capk2 = cap[bb.k], acc2 = 0;
          for (var c9 = 0; c9 < nC; c9++) {
            var gv2 = gc[gOff + c9];
            if (gv2 === 0) continue;
            if ((((c9 / st2) | 0) % (capk2 + 1)) === 0) continue;
            var tgt = nOff2 + c9 - st2;
            gnx[tgt] += gv2;
            acc2 += gv2 * fnx[tgt];
          }
          if (acc2 !== 0) {
            var cs = bb.cells, kk = bb.k;
            for (var ce = 0; ce < cs.length; ce++) prob[cs[ce] * K + kk] += acc2;
          }
        }
      }
    }

    for (var z = 0; z < prob.length; z++) prob[z] /= total;
    for (var z2 = 0; z2 < emptyP.length; z2++) emptyP[z2] /= total;
    return { total: total, prob: prob, empty: emptyP };
  }

  var api = { W: W, H: H, N: N, UNKNOWN: UNKNOWN, EMPTY: EMPTY, MAX_W: MAX_W, solve: solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TREASURE = api;
})(typeof window !== 'undefined' ? window : globalThis);
