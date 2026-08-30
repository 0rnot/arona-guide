/* 装備設計図の周回計算機。

   **参考元は「シャーレ装備管理室」**（もやしいため氏）。
   https://st-blue-archive.gitlab.io/equipment-controller/
   画面の作り（在庫を入れる → 足りないものが出る → 周回先が 1 本出る）も、
   周回先の選び方（下の「滑らかな評価」）も、あちらに合わせてある。
   理論の解説は同氏の記事にある。
   https://note.com/st_blue_archive/n/nfcd85a238aca

   **式を自分で発明していない。**係数（κ=3・α=9・inertia の刻み）と
   目標セット数の初期値は、あちらが配っている `optimizer.worker` と
   `index` のバンドルから写した（2026-08-30 に取得）。

   ---------------------------------------------------------------
   周回先の選び方（参考元の実装そのまま）

   ① **希少価値** v[部位][段] ＝ 10 ÷（その設計図がいちばん出るステージでの
      1 周あたりの期待枚数。万能設計図ぶんは交換レートで割って足す）。
      どこにも出ないものは 100。
   ② **基底関数の傾き** f(z)。z は「目標に対する手持ちの割合」。
      完遂重視 f(z) = κe^(−κz)（κ=3）／備蓄重視 f(z) = α/(1+αz)（α=9）。
      どちらも右下がりなので、**足りていないものほど価値が高い。**
   ③ **限界効用** μ ＝ v × f(手持ち ÷ 目標)。万能設計図は、部位の中で
      いちばん割のいい段に配ったものとして扱う（下の水位法）。
   ④ **ステージの点数** ＝ Σ（1 周あたりの期待枚数 × μ）÷ 10。
      いちばん高いステージを推す。
   ⑤ **推奨周回数** ＝ 回すたびに在庫が増えるものとして点数を計算し直し、
      2 番目のステージの inertia 倍を下回る手前まで。 */
(function () {
  'use strict';

  var E = window.EQUIP;
  var CATS = E.cats;
  var TIERS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

  /* 万能設計図 1 枚 → その段の設計図 1 枚に必要な万能設計図の枚数。
     `univRate` は段 1〜10 の並びなので、段 t は添字 t-1 */
  function rateOf(t) { return E.univRate[t - 1]; }

  // 参考元の既定値。**自分で決めていない**
  var KAPPA = 3, ALPHA = 9, MAX_RUNS = 99;
  // 「まとめて」〜「こまめに」の 11 段。1 - 10^-(1 + 2r/10)
  var INERTIA = (function () {
    var out = [];
    for (var r = 0; r < 11; r++) out.push(1 - Math.pow(10, -(1 + (r / 10) * 2)));
    return out;
  })();

  var el = function (id) { return document.getElementById(id); };
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function n1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function fmt(v) { return Math.round(v).toLocaleString('ja-JP'); }
  function key(c, t) { return c + ':' + t; }
  function pieceImg(c, t) {
    return t === 0 ? '../img/equipment_icon_' + c.toLowerCase() + '_useall_piece.webp'
                   : '../img/equipment_icon_' + c.toLowerCase() + '_tier' + t + '_piece.webp';
  }

  /* ---------- 状態 ---------------------------------------------- */
  var KEY = 'arona-equipment';
  var stock = {};                 // "Hat:10" -> 枚数、"Hat:0" が万能
  var targets = {};               // 部位 -> 目標セット数
  var mult = 1, model = 'exponential', inertiaIdx = 5, useHard = false;

  function blank() {
    stock = {};
    CATS.forEach(function (c) {
      stock[key(c, 0)] = 0;
      TIERS.forEach(function (t) { stock[key(c, t)] = 0; });
    });
  }
  blank();
  CATS.forEach(function (c) { targets[c] = E.defSets[c]; });

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, s: stock, t: targets,
        m: mult, md: model, i: inertiaIdx, h: useHard }));
    } catch (e) { /* 保存できない設定でも計算は動かす */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d) return;
      if (d.s) { for (var k in stock) if (typeof d.s[k] === 'number' && d.s[k] >= 0) stock[k] = d.s[k]; }
      if (d.t) { CATS.forEach(function (c) { if (typeof d.t[c] === 'number' && d.t[c] >= 0) targets[c] = d.t[c]; }); }
      if (d.m === 1 || d.m === 2 || d.m === 3) mult = d.m;
      if (d.md === 'exponential' || d.md === 'logarithmic') model = d.md;
      if (typeof d.i === 'number' && d.i >= 0 && d.i < INERTIA.length) inertiaIdx = d.i;
      useHard = !!d.h;
    } catch (e) { /* 壊れていたら初期値のまま */ }
  }

  /* ---------- ステージ ------------------------------------------ */
  /** いま候補にしているステージ。**ハードを外すと希少価値も変わる。**
      参考元はノーマルだけを持っているので、外した状態があちらと同じ */
  function pool() {
    return E.stages.filter(function (s) { return useHard || !s.h; });
  }
  /** 1 周あたりの期待枚数を "部位:段" で引ける形に */
  function dropsOf(s) {
    if (!s._m) {
      var m = {};
      s.d.forEach(function (x) { m[key(x[0], x[1])] = x[2]; });
      s.b.forEach(function (x) { m[key(x[0], 0)] = x[1]; });
      s._m = m;
    }
    return s._m;
  }

  /* ---------- ① 希少価値 ---------------------------------------- */
  function rarity(stages) {
    var v = {};
    CATS.forEach(function (c) {
      v[key(c, 0)] = 0;
      TIERS.forEach(function (t) {
        var best = 0, r = rateOf(t);
        stages.forEach(function (s) {
          var m = dropsOf(s);
          var y = (m[key(c, t)] || 0) + (m[key(c, 0)] || 0) / r;
          if (y > best) best = y;
        });
        v[key(c, t)] = best > 0 ? 10 / best : 100;
      });
    });
    return v;
  }

  /* ---------- ② 基底関数の傾きと、その逆関数 --------------------- */
  function f(z) {
    return model === 'exponential' ? KAPPA * Math.exp(-KAPPA * z)
                                   : ALPHA / (1 + ALPHA * z);
  }
  function finv(y) {
    if (y <= 0) return Infinity;
    var top = f(0);
    if (y >= top) return 0;
    return model === 'exponential' ? -Math.log(y / KAPPA) / KAPPA : 1 / y - 1 / ALPHA;
  }

  /* ---------- ③ 限界効用 ---------------------------------------- */
  /** 目標数。**ユーザーの決めた目標セット数 × ゲーム内レシピの必要枚数。** */
  function targetOf(c, t) { return (targets[c] || 0) * (E.perSet[c][t] || 0); }

  /** 万能設計図をその部位の中で配ったときの、段ごとの「あるべき在庫」 */
  function stockAt(lam, N, v, r) { return N * finv(lam * r / v); }

  function marginal(st) {
    var v = rarity(pool());
    var mu = {};
    CATS.forEach(function (c) {
      var uni = st[key(c, 0)] || 0;
      var best = 0;
      if (uni <= 0) {
        TIERS.forEach(function (t) {
          var N = targetOf(c, t), rv = v[key(c, t)];
          if (N <= 0 || rv <= 0) { mu[key(c, t)] = 0; return; }
          var m = rv * f((st[key(c, t)] || 0) / N);
          mu[key(c, t)] = m;
          best = Math.max(best, m / rateOf(t));
        });
        mu[key(c, 0)] = best;
        return;
      }
      // **水位法。**万能設計図を使い切る「限界効用の水位」を二分法で探す
      var lo = 0, hi = 0;
      TIERS.forEach(function (t) {
        hi = Math.max(hi, (v[key(c, t)] || 0) / rateOf(t) * f(0));
      });
      function need(lam) {
        var s = 0;
        TIERS.forEach(function (t) {
          var N = targetOf(c, t), rv = v[key(c, t)];
          if (N <= 0 || rv <= 0) return;
          var r = rateOf(t);
          s += Math.max(0, (stockAt(lam, N, rv, r) - (st[key(c, t)] || 0)) * r);
        });
        return s;
      }
      for (var i = 0; i < 30; i++) {
        var mid = (lo + hi) / 2;
        if (need(mid) > uni) lo = mid; else hi = mid;
      }
      var lam = hi;
      TIERS.forEach(function (t) {
        var N = targetOf(c, t), rv = v[key(c, t)];
        if (N <= 0 || rv <= 0) { mu[key(c, t)] = 0; return; }
        var r = rateOf(t), have = st[key(c, t)] || 0;
        var want = stockAt(lam, N, rv, r);
        var used = Math.max(0, (want - have) * r);
        var eff = have + used / r;
        var m = rv * f(eff / N);
        mu[key(c, t)] = m;
        best = Math.max(best, m / r);
      });
      mu[key(c, 0)] = best;
    });
    return mu;
  }

  /* ---------- ④ ステージの点数 ---------------------------------- */
  function score(s, mu) {
    var m = dropsOf(s), tot = 0, parts = [];
    for (var k in m) {
      var c = (mu[k] || 0) * m[k] / 10;
      if (c > 0) parts.push({ k: k, v: c });
      tot += c;
    }
    parts.sort(function (a, b) { return b.v - a.v; });
    return { total: tot, parts: parts };
  }
  function rank(mu) {
    return pool().map(function (s) {
      return { s: s, sc: score(s, mu) };
    }).sort(function (a, b) { return b.sc.total - a.sc.total; });
  }

  /* ---------- ⑤ 推奨周回数 -------------------------------------- */
  function runCount(best, list) {
    if (list.length < 2) return MAX_RUNS;
    var inertia = INERTIA[inertiaIdx];
    var n = 1;
    for (var i = 2; i <= MAX_RUNS; i++) {
      var sim = {}, k;
      for (k in stock) sim[k] = stock[k];
      var m = dropsOf(best);
      for (k in m) sim[k] = (sim[k] || 0) + (i - 1) * m[k] * mult;
      var mu = marginal(sim);
      var mine = score(best, mu).total;
      var other = 0;
      pool().forEach(function (s) {
        if (s.id === best.id) return;
        var v = score(s, mu).total;
        if (v > other) other = v;
      });
      if (mine >= inertia * other) n = i; else break;
    }
    return n;
  }

  /* ---------- セットの達成度 ------------------------------------ */
  /** その部位で「T1 から T10 まで上げきれる装備」が何個ぶんあるか。
      **万能設計図は、いちばん足を引っ張っている段に配ったものとして数える。**
      s セットぶん埋めるのに要る万能の枚数を出して、収まる最大の s を二分法で探す */
  function setsDone(c) {
    var per = E.perSet[c];
    function cost(s) {
      var need = 0;
      TIERS.forEach(function (t) {
        var want = s * (per[t] || 0);
        need += Math.max(0, want - (stock[key(c, t)] || 0)) * rateOf(t);
      });
      return need;
    }
    var uni = stock[key(c, 0)] || 0;
    var lo = 0, hi = (targets[c] || 0) + 1;
    if (cost(hi) <= uni) return hi;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (cost(mid) <= uni) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* ---------- 画面 ---------------------------------------------- */
  function drawInventory() {
    el('inv').innerHTML = CATS.map(function (c) {
      var done = setsDone(c), goal = targets[c] || 0;
      var pct = goal > 0 ? Math.min(100, done / goal * 100) : 0;
      return '<section class="cat" data-c="' + c + '">' +
        '<div class="cat-h">' +
          '<b>' + esc(E.catJa[c]) + '</b>' +
          '<span class="cat-n">' + n1(done) + ' / ' + goal + ' セット</span>' +
          '<button type="button" class="btn tiny" data-a="zero">0 に戻す</button>' +
        '</div>' +
        '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="pgrid">' +
          TIERS.map(function (t) { return cell(c, t); }).join('') + cell(c, 0) +
        '</div></section>';
    }).join('');
  }
  function cell(c, t) {
    var N = t === 0 ? 0 : targetOf(c, t);
    var have = stock[key(c, t)] || 0;
    var short = t === 0 ? 0 : Math.max(0, N - have);
    return '<label class="pc' + (t === 0 ? ' uni' : (short > 0 ? ' short' : ' ok')) + '">' +
      '<span class="tg">' + (t === 0 ? '万能' : 'T' + t) + '</span>' +
      '<img src="' + pieceImg(c, t) + '" alt="" width="40" height="40" loading="lazy" title="' +
        esc(E.names[c + t] || '') + '">' +
      '<input type="number" min="0" step="1" inputmode="numeric" value="' + have +
        '" data-c="' + c + '" data-t="' + t + '" aria-label="' + esc(E.catJa[c]) +
        ' ' + (t === 0 ? '万能設計図' : 'T' + t) + ' の所持数">' +
      '<span class="need">' + (t === 0 ? '交換用' : (short > 0 ? 'あと ' + fmt(short) : '足りています')) +
      '</span></label>';
  }

  function drawShort() {
    var rows = [];
    CATS.forEach(function (c) {
      TIERS.forEach(function (t) {
        var N = targetOf(c, t), have = stock[key(c, t)] || 0;
        if (N <= 0) return;
        var d = N - have;
        if (d > 0) rows.push({ c: c, t: t, need: d, N: N, have: have });
      });
    });
    rows.sort(function (a, b) { return b.need - a.need; });
    var totalNeed = rows.reduce(function (a, b) { return a + b.need; }, 0);
    var totalGoal = 0, totalHave = 0;
    CATS.forEach(function (c) {
      TIERS.forEach(function (t) {
        var N = targetOf(c, t);
        totalGoal += N;
        totalHave += Math.min(N, stock[key(c, t)] || 0);
      });
    });
    el('o-pct').textContent = totalGoal > 0 ? n1(totalHave / totalGoal * 100) + '%' : '—';
    el('o-pct-sub').textContent = totalGoal > 0
      ? '目標 ' + fmt(totalGoal) + ' 枚のうち ' + fmt(totalHave) + ' 枚'
      : '目標セット数が 0 です';

    if (!rows.length) {
      el('short').innerHTML = '<p class="empty">目標にした枚数はぜんぶそろっています。' +
        '<b>下の「目標セット数」を増やす</b>と続きが出ます。</p>';
      return;
    }
    el('short').innerHTML =
      '<p class="lead">足りない枚数の多い順です。全部で <b>' + fmt(totalNeed) +
        ' 枚</b>足りません。<b>万能設計図はここでは差し引いていません</b>（上の「セット」の数字が、万能を配ったあとの実力です）。</p>' +
      '<div class="slist">' + rows.slice(0, shortOpen ? rows.length : 8).map(function (r) {
        var pct = Math.min(100, r.have / r.N * 100);
        return '<div class="srow">' +
          '<img src="' + pieceImg(r.c, r.t) + '" alt="" width="34" height="34" loading="lazy">' +
          '<span class="nm">' + esc(E.catJa[r.c]) + ' <b>T' + r.t + '</b>' +
            '<small>' + esc(E.names[r.c + r.t] || '') + '</small></span>' +
          '<span class="bar sm"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
          '<span class="num">あと <b>' + fmt(r.need) + '</b><small>' + fmt(r.have) +
            ' / ' + fmt(r.N) + '</small></span></div>';
      }).join('') + '</div>' +
      (rows.length > 8
        ? '<div class="btnrow" style="margin-top:10px"><button type="button" class="btn" id="more">' +
          (shortOpen ? '上位 8 種類だけにする' : 'あと ' + (rows.length - 8) + ' 種類を見る') +
          '</button></div>'
        : '');
    var mb = el('more');
    if (mb) mb.addEventListener('click', function () { shortOpen = !shortOpen; drawShort(); });
  }

  var lastBest = null, lastRuns = 1, shortOpen = false;

  function drawStages() {
    var mu = marginal(stock);
    var list = rank(mu);
    if (!list.length) {
      el('stages').innerHTML = '<p class="empty">候補のステージがありません。</p>';
      el('plan').innerHTML = '';
      el('o-stage').textContent = '—';
      el('o-runs').textContent = '—';
      lastBest = null;
      return;
    }
    var best = list[0];
    var runs = runCount(best.s, list);
    lastBest = best.s; lastRuns = runs;

    el('o-stage').textContent = best.s.a + '-' + best.s.s;
    el('o-stage-sub').textContent = (best.s.h ? 'ハード' : 'ノーマル') + '／' +
      best.s.n + '／AP ' + best.s.ap;
    el('o-runs').textContent = '〜' + runs + ' 周';
    el('o-runs-sub').textContent = 'AP ' + fmt(best.s.ap * runs) + ' ぶん（点数 ' +
      n1(best.sc.total) + '）';

    // 内訳
    var tot = best.sc.total || 1;
    var why = best.sc.parts.slice(0, 6).map(function (p) {
      var a = p.k.split(':'), t = +a[1];
      return '<span class="why"><img src="' + pieceImg(a[0], t) + '" alt="" width="24" height="24" loading="lazy">' +
        esc(E.catJa[a[0]]) + ' ' + (t === 0 ? '万能' : 'T' + t) +
        ' <b>' + Math.round(p.v / tot * 100) + '%</b></span>';
    }).join('');

    var m = dropsOf(best.s);
    var slots = Object.keys(m).sort(function (x, y) { return m[y] - m[x]; });
    el('plan').innerHTML =
      '<div class="best">' +
        '<div class="best-h"><b>Area ' + best.s.a + '-' + best.s.s + '</b>' +
          '<span class="tg2">' + (best.s.h ? 'ハード' : 'ノーマル') + '</span>' +
          '<span class="nm2">' + esc(best.s.n) + '</span>' +
          '<span class="runs">〜' + runs + ' 周</span></div>' +
        '<p class="why-l"><b>この 1 本が選ばれた理由</b>（点数の内訳）</p>' +
        '<div class="whys">' + why + '</div>' +
        '<p class="why-l" style="margin-top:14px"><b>回った結果を入れてください</b>' +
          '<small>実際に出た枚数を入れて「在庫に足す」を押すと、次の周回先が出ます。</small></p>' +
        '<div class="dgrid">' + slots.map(function (k) {
          var a = k.split(':'), c = a[0], t = +a[1];
          return '<label class="pc drop">' +
            '<span class="tg">' + (t === 0 ? '万能' : 'T' + t) + '</span>' +
            '<img src="' + pieceImg(c, t) + '" alt="" width="40" height="40" loading="lazy">' +
            '<input type="number" min="0" step="1" inputmode="numeric" value="0"' +
              ' data-dc="' + c + '" data-dt="' + t + '" aria-label="' + esc(E.catJa[c]) +
              ' ' + (t === 0 ? '万能' : 'T' + t) + ' の獲得枚数">' +
            '<span class="need">1 周 ' + (Math.round(m[k] * 1000) / 1000) + ' 枚</span>' +
            '</label>';
        }).join('') + '</div>' +
        '<div class="btnrow" style="margin-top:12px">' +
          '<button type="button" class="btn pri" id="apply">在庫に足す</button>' +
          '<button type="button" class="btn" id="fillexp">' + runs + ' 周ぶんの期待値を入れる</button>' +
          '<button type="button" class="btn" id="clearrun">0 に戻す</button>' +
        '</div>' +
      '</div>';

    el('stages').innerHTML =
      '<p class="lead">点数の高い順です。<b>点数は「1 周でどれだけ満足度が上がるか」</b>で、' +
        'AP は割っていません。<b>AP あたりで見たいときは右の列を見てください。</b></p>' +
      (useHard ? '<div class="note-box" style="margin:0 0 12px"><b>ハードは AP が 2 倍で、' +
        '1 日に入れる回数も決まっています。</b>回数はゲームのデータに入っていないので、' +
        'ここには書きません。<b>点数だけで並べるとハードが上に来ます</b>ので、' +
        '「1 AP あたり」の列と見比べてください。</div>' : '') +
      '<div class="tscroll"><table class="dt"><thead><tr><th>ステージ</th><th>難易度</th>' +
      '<th>AP</th><th>点数</th><th>1 AP あたり</th><th>いちばんの目当て</th></tr></thead><tbody>' +
      list.slice(0, 12).map(function (r, i) {
        var p = r.sc.parts[0];
        var lbl = '—';
        if (p) {
          var a = p.k.split(':'), t = +a[1];
          lbl = E.catJa[a[0]] + ' ' + (t === 0 ? '万能' : 'T' + t);
        }
        var per = r.s.ap > 0 ? r.sc.total / r.s.ap : 0;
        return '<tr' + (i === 0 ? ' class="here"' : '') + '><td>' + r.s.a + '-' + r.s.s +
          ' <small>' + esc(r.s.n) + '</small></td><td>' + (r.s.h ? 'ハード' : 'ノーマル') +
          '</td><td>' + r.s.ap + '</td><td>' + n1(r.sc.total) + '</td><td>' +
          (Math.round(per * 100) / 100).toFixed(2) + '</td><td>' + esc(lbl) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function drawSettings() {
    el('tgrid').innerHTML = CATS.map(function (c) {
      return '<label class="tset"><span>' + esc(E.catJa[c]) +
        '<small>使う生徒 ' + (E.slots[c] || 0) + ' 人</small></span>' +
        '<input type="number" min="0" step="1" inputmode="numeric" value="' + (targets[c] || 0) +
        '" data-tc="' + c + '" aria-label="' + esc(E.catJa[c]) + ' の目標セット数"></label>';
    }).join('');
    Array.prototype.forEach.call(el('mult').children, function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.m === mult));
    });
    Array.prototype.forEach.call(el('model').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.md === model));
    });
    el('i-inertia').value = inertiaIdx;
    el('i-hard').checked = useHard;
  }

  function drawAll() {
    drawInventory();
    drawShort();
    drawStages();
    syncHash();
  }

  /* ---------- URL ------------------------------------------------ */
  function b36(n) { return n ? Math.round(n).toString(36) : ''; }
  function hash() {
    var inv = CATS.map(function (c) {
      return TIERS.map(function (t) { return b36(stock[key(c, t)]); })
        .concat(b36(stock[key(c, 0)])).join('.');
    }).join('-');
    var tg = CATS.map(function (c) { return b36(targets[c]); }).join('.');
    return 'eq=' + [inv, tg, mult, model === 'exponential' ? 'e' : 'l',
                    inertiaIdx, useHard ? 1 : 0].join('~');
  }
  window.shareUrl = function () { return '#' + hash(); };
  function syncHash() {
    try {
      history.replaceState(null, '', location.pathname + location.search + '#' + hash());
    } catch (e) { /* file:// では黙って諦める */ }
  }
  function fromHash() {
    var seg = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x.indexOf('eq=') === 0;
    })[0];
    if (!seg) return false;
    var p = seg.slice(3).split('~');
    if (p.length < 6) return false;
    var invs = p[0].split('-');
    if (invs.length !== CATS.length) return false;
    CATS.forEach(function (c, i) {
      var f2 = invs[i].split('.');
      TIERS.forEach(function (t, j) { stock[key(c, t)] = parseInt(f2[j], 36) || 0; });
      stock[key(c, 0)] = parseInt(f2[TIERS.length], 36) || 0;
    });
    var tg = p[1].split('.');
    CATS.forEach(function (c, i) { targets[c] = parseInt(tg[i], 36) || 0; });
    mult = (+p[2] === 2 || +p[2] === 3) ? +p[2] : 1;
    model = p[3] === 'l' ? 'logarithmic' : 'exponential';
    inertiaIdx = Math.min(INERTIA.length - 1, Math.max(0, parseInt(p[4], 10) || 0));
    useHard = p[5] === '1';
    return true;
  }

  /* ---------- 帯 ------------------------------------------------- */
  var toast = el('toast-page'), tmr = null;
  function say(t) {
    if (!toast) return;
    toast.textContent = t; toast.classList.add('shown');
    clearTimeout(tmr); tmr = setTimeout(function () { toast.classList.remove('shown'); }, 2200);
  }

  /* ---------- つなぐ --------------------------------------------- */
  el('inv').addEventListener('input', function (e) {
    var i = e.target;
    if (i.tagName !== 'INPUT') return;
    var v = Math.max(0, Math.round(+i.value || 0));
    stock[key(i.dataset.c, +i.dataset.t)] = v;
    save(); drawShort(); drawStages(); syncHash();
    // **在庫の枠は描き直さない。**打っている最中に作り直すと入力欄から抜ける
    var sec = i.closest('.cat'), c = i.dataset.c;
    if (sec) {
      var done = setsDone(c), goal = targets[c] || 0;
      sec.querySelector('.cat-n').textContent = n1(done) + ' / ' + goal + ' セット';
      sec.querySelector('.bar i').style.width =
        (goal > 0 ? Math.min(100, done / goal * 100) : 0).toFixed(1) + '%';
      var t = +i.dataset.t, lab = i.closest('.pc');
      if (t !== 0 && lab) {
        var short = Math.max(0, targetOf(c, t) - v);
        lab.className = 'pc ' + (short > 0 ? 'short' : 'ok');
        lab.querySelector('.need').textContent = short > 0 ? 'あと ' + fmt(short) : '足りています';
      }
    }
  });
  el('inv').addEventListener('click', function (e) {
    var b = e.target.closest('[data-a="zero"]');
    if (!b) return;
    var c = b.closest('.cat').dataset.c;
    stock[key(c, 0)] = 0;
    TIERS.forEach(function (t) { stock[key(c, t)] = 0; });
    save(); drawAll(); say(E.catJa[c] + ' の在庫を 0 にしました');
  });
  el('zero-all').addEventListener('click', function () {
    if (!window.confirm('入力した在庫をぜんぶ 0 に戻します。よろしいですか。')) return;
    blank(); save(); drawAll(); say('在庫を 0 にしました');
  });

  el('plan').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !lastBest) return;
    var ins = el('plan').querySelectorAll('input[data-dc]');
    if (b.id === 'clearrun') {
      Array.prototype.forEach.call(ins, function (i) { i.value = 0; });
      return;
    }
    if (b.id === 'fillexp') {
      var m = dropsOf(lastBest);
      Array.prototype.forEach.call(ins, function (i) {
        var k = key(i.dataset.dc, +i.dataset.dt);
        i.value = Math.round((m[k] || 0) * lastRuns * mult);
      });
      say(lastRuns + ' 周ぶんの期待値を入れました。実際に出た数に直してください');
      return;
    }
    if (b.id === 'apply') {
      var n = 0;
      Array.prototype.forEach.call(ins, function (i) {
        var v = Math.max(0, Math.round(+i.value || 0));
        if (!v) return;
        stock[key(i.dataset.dc, +i.dataset.dt)] += v;
        n += v;
      });
      if (!n) { say('足す枚数が入っていません'); return; }
      save(); drawAll();
      say(n + ' 枚を在庫に足しました');
    }
  });

  el('tgrid').addEventListener('input', function (e) {
    if (e.target.tagName !== 'INPUT') return;
    targets[e.target.dataset.tc] = Math.max(0, Math.round(+e.target.value || 0));
    save(); drawAll();
  });
  el('t-reset').addEventListener('click', function () {
    CATS.forEach(function (c) { targets[c] = E.defSets[c]; });
    save(); drawSettings(); drawAll(); say('目標セット数を初期値に戻しました');
  });
  el('mult').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    mult = +b.dataset.m; save(); drawSettings(); drawStages(); syncHash();
  });
  el('model').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    model = b.dataset.md; save(); drawSettings(); drawAll();
  });
  el('i-inertia').addEventListener('input', function () {
    inertiaIdx = +el('i-inertia').value;
    el('inertia-v').textContent = inertiaIdx <= 3 ? 'まとめて' : (inertiaIdx >= 7 ? 'こまめに' : 'ふつう');
    save(); drawStages(); syncHash();
  });
  el('i-hard').addEventListener('change', function () {
    useHard = el('i-hard').checked; save(); drawAll();
  });

  /* ---------- 出どころ欄の数字 ----------------------------------- */
  el('src-stages').textContent = E.stages.length;
  el('src-normal').textContent = E.stages.filter(function (s) { return !s.h; }).length;
  el('src-perset').textContent = TIERS.map(function (t) {
    return 'T' + t + ' ' + E.perSet[CATS[0]][t];
  }).join(' / ');
  el('src-rate').textContent = TIERS.map(function (t) {
    return 'T' + t + ' ' + rateOf(t);
  }).join(' / ');
  el('src-def').textContent = CATS.map(function (c) {
    return E.catJa[c] + ' ' + E.defSets[c];
  }).join(' / ');
  el('ver').textContent = E.version;

  /* **URL だけが変わったときも読み直す。**同じページで別の共有リンクを開くと、
     ブラウザは再読み込みせずにハッシュだけ差し替える（2026-08-30 に検査で踏んだ） */
  window.addEventListener('hashchange', function () {
    if ('#' + hash() === location.hash) return;
    if (fromHash()) { save(); drawSettings(); drawAll(); }
  });

  load();
  fromHash();
  drawSettings();
  el('inertia-v').textContent = inertiaIdx <= 3 ? 'まとめて' : (inertiaIdx >= 7 ? 'こまめに' : 'ふつう');
  drawAll();
})();
