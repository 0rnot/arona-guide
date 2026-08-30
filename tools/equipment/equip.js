/* 装備設計図の周回計算機。
   ------------------------------------------------------------
   踏まえている仕様（出どころはページ下に書いた）:
   - ティアアップは「その Tier の設計図」だけでなく、**2〜3 段下の設計図も食う**。
     T10 の 60 枚だけ数えると丸ごと足りなくなる
   - **お守り・腕時計・ネックレスは T9 が上限。** データ上 T10 の装備もレシピも無い
   - ドロップの期待値は `StageRewardProb ÷ 10000 × StageRewardAmount` の和
   - **箱（GachaGroup）で出る枠がある。**中身と比率は GachaElement に出ているので、
     推測せずそのまま使って期待値に畳んである（data.js を作る時点で済ませている）
   - **「T◯装備設計図選択ボックス」（通称 万能設計図）は部位を選ばない。**
     その Tier の不足なら、どの部位にも充てられる。T2〜T8 しか無い
   ------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EQUIP;
  var el = function (id) { return document.getElementById(id); };
  var CATS = E.cats, JA = E.catJa, MAXT = E.maxTier;

  var state = {};    // state[cat] = {from, to, n}
  var have = {};     // have[cat][tier] = 枚数
  var uni = {};      // uni[tier] = T◯装備設計図選択ボックス（万能設計図）の個数
  var UNI_MIN = 2, UNI_MAX = 8;   // 選択ボックスは T2〜T8 しか存在しない
  var bpCat = CATS[0];
  var diff = 'all';

  CATS.forEach(function (c) {
    state[c] = { from: 1, to: MAXT[c], n: 0 };
    have[c] = {};
  });

  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function icon(c, t) { return '../img/equipment_icon_' + c.toLowerCase() + '_tier' + t + '_piece.webp'; }
  function bpName(c, t) { return E.names[c + t] || (JA[c] + ' T' + t + ' の設計図'); }

  // ---- 目標の行
  function buildGoals() {
    el('goals').innerHTML = CATS.map(function (c) {
      var mx = MAXT[c];
      var from = '', to = '';
      for (var t = 1; t <= mx; t++) from += '<option value="' + t + '">T' + t + '</option>';
      for (var t2 = 2; t2 <= mx; t2++) to += '<option value="' + t2 + '"' + (t2 === mx ? ' selected' : '') + '>T' + t2 + '</option>';
      return '<div class="goalrow">' +
        '<img src="' + icon(c, mx) + '" alt="" width="42" height="42" loading="lazy">' +
        '<span class="nm">' + JA[c] + '<br><small style="color:var(--fg-mute);font-size:.72rem">上限 T' + mx + '</small></span>' +
        '<select data-c="' + c + '" data-k="from" aria-label="' + JA[c] + 'の今の Tier">' + from + '</select>' +
        '<select data-c="' + c + '" data-k="to" aria-label="' + JA[c] + 'の目標 Tier">' + to + '</select>' +
        '<input type="number" inputmode="numeric" min="0" max="99" step="1" value="0" data-c="' + c + '" data-k="n" aria-label="' + JA[c] + 'の個数">' +
        '</div>';
    }).join('');
    el('goals').addEventListener('input', function (e) {
      var t = e.target; if (!t.dataset.c) return;
      state[t.dataset.c][t.dataset.k] = parseInt(t.value, 10) || 0;
      calc();
    });
  }

  // ---- 手持ちの設計図
  function buildBpTabs() {
    el('bpcat').innerHTML = CATS.map(function (c) {
      return '<button type="button" data-c="' + c + '"' + (c === bpCat ? ' aria-pressed="true"' : '') + '>' + JA[c] + '</button>';
    }).join('');
    el('bpcat').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      bpCat = b.dataset.c;
      [].forEach.call(el('bpcat').querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x.dataset.c === bpCat));
      });
      drawBp();
    });
  }

  function drawBp() {
    var need = totalNeed(), sh = shortfall(need);
    var mx = MAXT[bpCat];
    var h = '';
    for (var t = 2; t <= mx; t++) {
      var nd = (need[bpCat] && need[bpCat][t]) || 0;
      var hv = have[bpCat][t] || 0;
      var lack = (sh[bpCat] && sh[bpCat][t]) || 0;
      var cls = lack > 0 ? ' short' : ' done';
      h += '<div class="bp' + cls + '" title="' + bpName(bpCat, t) + '">' +
        '<img src="' + icon(bpCat, t) + '" alt="" width="46" height="46" loading="lazy">' +
        '<div class="t">T' + t + '</div>' +
        '<div class="v">' + fmt(lack) + '</div>' +
        '<div class="have">必要 ' + fmt(nd) + '</div>' +
        '<input type="number" inputmode="numeric" min="0" step="1" value="' + hv + '" data-t="' + t + '" aria-label="' + bpName(bpCat, t) + 'の所持数">' +
        '</div>';
    }
    el('bpgrid').innerHTML = h;
  }
  el('bpgrid').addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset.t) return;
    have[bpCat][parseInt(t.dataset.t, 10)] = Math.max(0, parseInt(t.value, 10) || 0);
    calc(true);
  });

  // ---- 万能設計図（T◯装備設計図選択ボックス）
  function uniIcon(t) { return '../img/equipment_icon_selection_tier' + t + '_piece.webp'; }

  function buildUni() {
    var h = '';
    for (var t = UNI_MIN; t <= UNI_MAX; t++) {
      h += '<div class="uni">' +
        '<img src="' + uniIcon(t) + '" alt="" width="56" height="56" loading="lazy">' +
        '<div class="t">T' + t + '</div>' +
        '<input type="number" inputmode="numeric" min="0" max="999" step="1" value="0" ' +
          'data-t="' + t + '" aria-label="T' + t + '装備設計図選択ボックスの所持数">' +
        '</div>';
    }
    el('unigrid').innerHTML = h;
    el('unigrid').addEventListener('input', function (e) {
      var n = e.target; if (!n.dataset.t) return;
      uni[parseInt(n.dataset.t, 10)] = Math.max(0, Math.min(999, parseInt(n.value, 10) || 0));
      calc();
    });
  }

  // ---- 必要量
  function totalNeed() {
    var need = {}, credit = 0;
    CATS.forEach(function (c) {
      need[c] = {};
      var st = state[c];
      if (!st.n) return;
      for (var t = st.from + 1; t <= st.to; t++) {
        var r = E.recipes[c][t];
        if (!r) continue;
        credit += r.credit * st.n;
        r.ing.forEach(function (pair) {
          need[c][pair[0]] = (need[c][pair[0]] || 0) + pair[1] * st.n;
        });
      }
    });
    need.__credit = credit;
    return need;
  }

  function shortfall(need) {
    var sh = {}, total = 0;
    CATS.forEach(function (c) {
      sh[c] = {};
      Object.keys(need[c] || {}).forEach(function (t) {
        var d = need[c][t] - (have[c][t] || 0);
        if (d > 0) { sh[c][t] = d; total += d; }
      });
    });

    /* **万能設計図は部位を選ばない。**同じ Tier なら、どの部位の不足にも充てられる。
       どこに使うかは持ち主が決められるので、**不足がいちばん多い部位から 1 枚ずつ**
       充てていく（＝残る不足がなるべく平らになる配り方）。 */
    for (var t = UNI_MIN; t <= UNI_MAX; t++) {
      var box = uni[t] || 0;
      while (box > 0) {
        var bc = null, bv = 0;
        for (var i = 0; i < CATS.length; i++) {
          var v = sh[CATS[i]][t] || 0;
          if (v > bv) { bv = v; bc = CATS[i]; }
        }
        if (!bc) break;
        sh[bc][t] -= 1;
        if (sh[bc][t] <= 0) delete sh[bc][t];
        box--; total--;
      }
    }

    sh.__total = total;
    return sh;
  }

  /** 万能設計図が実際に何枚ぶん埋めたか（余ったぶんは数えない） */
  function uniUsed(need) {
    var raw = 0, cut = 0;
    CATS.forEach(function (c) {
      Object.keys(need[c] || {}).forEach(function (t) {
        var d = need[c][t] - (have[c][t] || 0);
        if (d > 0) raw += d;
      });
    });
    var sh = shortfall(need);
    cut = raw - sh.__total;
    return cut;
  }

  /** ステージ 1 周でもらえる設計図を (部位, Tier) ごとに畳む。 */
  function dropsOf(s) {
    var m = {};
    function add(c, t, v) { m[c + '|' + t] = (m[c + '|' + t] || 0) + v; }
    s.d.forEach(function (r) { add(r[0], r[1], r[2]); });
    return m;
  }

  function passDiff(s) {
    if (diff === 'n' && s.h) return false;
    if (diff === 'h' && !s.h) return false;
    return true;
  }

  /**
   * 足りない設計図ごとに、**1 AP でいちばん多くもらえるステージ**を探す。
   * @returns { "Hat|6": {rate, stage}, ... }
   */
  function bestRates(sh) {
    var best = {};
    E.stages.forEach(function (s) {
      if (!passDiff(s) || !s.ap) return;
      var m = dropsOf(s);
      Object.keys(m).forEach(function (k) {
        var p = k.split('|'), c = p[0], t = +p[1];
        if (!(sh[c] && sh[c][t])) return;
        var rate = m[k] / s.ap;
        if (!best[k] || rate > best[k].rate) best[k] = { rate: rate, stage: s };
      });
    });
    return best;
  }

  /**
   * 周回先の並び。**「足りない量が多いものほど重く数える」。**
   * 素朴に「1 AP あたり何枚」で並べると、序盤のステージが全部 30 枚/100AP で
   * 横並びになって順位が付かない（実測）。欲しいのは枚数ではなく、
   * **詰まっているところが埋まるかどうか**なので、不足量で重みを付ける。
   */
  function rankStages(sh) {
    var maxShort = 0;
    CATS.forEach(function (c) {
      Object.keys(sh[c]).forEach(function (t) { if (sh[c][t] > maxShort) maxShort = sh[c][t]; });
    });
    if (!maxShort) return [];

    var out = [];
    E.stages.forEach(function (s) {
      if (!passDiff(s) || !s.ap) return;
      var m = dropsOf(s), got = 0, score = 0, parts = [];
      Object.keys(m).forEach(function (k) {
        var p = k.split('|'), c = p[0], t = +p[1], ev = m[k];
        var lack = (sh[c] && sh[c][t]) || 0;
        if (!lack) return;
        got += ev;
        score += ev * (lack / maxShort);
        parts.push({ txt: JA[c] + ' T' + t + ' ' + ev.toFixed(2), w: lack });
      });
      if (got <= 0) return;
      parts.sort(function (a, b) { return b.w - a.w; });
      out.push({ s: s, got: got, per: got / s.ap, score: score / s.ap,
                 parts: parts.map(function (x) { return x.txt; }) });
    });
    out.sort(function (a, b) { return b.score - a.score || b.per - a.per; });
    return out;
  }

  function stageName(s) {
    return 'Area ' + s.a + '-' + s.s + (s.h ? '（Hard）' : '') + (s.n ? '　' + s.n : '');
  }

  function calc(skipBp) {
    var need = totalNeed();
    var credit = need.__credit;
    var sh = shortfall(need);

    el('o-short').innerHTML = fmt(sh.__total) + '<small>枚</small>';
    var kinds = 0;
    CATS.forEach(function (c) { kinds += Object.keys(sh[c]).length; });
    var cut = uniUsed(need);
    el('o-short-sub').textContent = (kinds > 0 ? (kinds + ' 種類が足りていません') : '足りています') +
      (cut > 0 ? '（万能設計図 ' + fmt(cut) + ' 枚ぶんを差し引き済み）' : '');

    el('o-credit').innerHTML = fmt(credit) + '<small></small>';

    var ranked = rankStages(sh);

    // **いちばん詰まるところを出す。**「不足の合計 ÷ 1 周の枚数」は、
    // 設計図が互いに置き換えられるかのように見えてしまって嘘になる。
    // 実際は 1 種類でも足りなければ終わらないので、
    // **その 1 種類を埋めるのに最低いくら AP が要るか**を出す。
    var best = bestRates(sh), worstAp = 0, worstKey = null;
    Object.keys(best).forEach(function (k) {
      var p = k.split('|'), lack = sh[p[0]][+p[1]];
      var ap = lack / best[k].rate;
      if (ap > worstAp) { worstAp = ap; worstKey = k; }
    });
    var uncovered = [];
    CATS.forEach(function (c) {
      Object.keys(sh[c]).forEach(function (t) { if (!best[c + '|' + t]) uncovered.push(JA[c] + ' T' + t); });
    });

    if (worstKey) {
      var wp = worstKey.split('|');
      el('o-runs').innerHTML = fmt(worstAp) + '<small>AP</small>';
      el('o-runs-sub').textContent = 'いちばん詰まるのは ' + JA[wp[0]] + ' T' + wp[1] +
        '（' + fmt(sh[wp[0]][+wp[1]]) + ' 枚）。' + stageName(best[worstKey].stage) + ' で最短' +
        (uncovered.length ? '。' + uncovered.length + ' 種類は今の絞り込みでは落ちません' : '');
    } else {
      el('o-runs').textContent = '—';
      el('o-runs-sub').textContent = sh.__total > 0 ? '落ちるステージがありません' : '回る必要はありません';
    }

    el('stages').innerHTML = ranked.length === 0
      ? '<p style="color:var(--fg-mute);font-size:.88rem;margin:0">足りない設計図がありません。目標を入れると、ここに周回先が出ます。</p>'
      : ranked.slice(0, 10).map(function (x, i) {
          return '<div class="stagerow">' +
            '<span class="n">' + (i + 1) + '</span>' +
            '<span><b>' + stageName(x.s) + '</b>' +
            '<span class="dt2">AP ' + x.s.ap + '　' + x.parts.join('　') + '</span></span>' +
            '<span class="sc">' + (x.score * 100).toFixed(1) +
            '<small style="font-weight:400;color:var(--fg-mute)"> 点（' + (x.per * 100).toFixed(1) + ' 枚/100AP）</small></span>' +
            '</div>';
        }).join('');

    drawNeedTable(need, sh);
    if (!skipBp) drawBp();
  }

  function drawNeedTable(need, sh) {
    var maxT = 10;
    var head = '<th>部位</th>';
    for (var t = 2; t <= maxT; t++) head += '<th>T' + t + '</th>';
    head += '<th>合計</th>';
    el('need-head').innerHTML = head;

    var body = '';
    CATS.forEach(function (c) {
      var row = '<td>' + JA[c] + '</td>', sum = 0, any = false;
      for (var t = 2; t <= maxT; t++) {
        var nd = (need[c] && need[c][t]) || 0;
        sum += nd;
        if (nd > 0) any = true;
        var lack = (sh[c] && sh[c][t]) || 0;
        row += '<td' + (lack > 0 ? ' style="color:var(--accent-tx);font-weight:800"' : (nd > 0 ? ' style="opacity:.5"' : '')) + '>' +
               (t > MAXT[c] ? '—' : (nd ? fmt(nd) : '')) + '</td>';
      }
      row += '<td><b>' + (sum ? fmt(sum) : '') + '</b></td>';
      if (any) body += '<tr>' + row + '</tr>';
    });
    el('need-body').innerHTML = body || '<tr><td colspan="11" style="text-align:left;color:var(--fg-mute)">目標を入れると、ここに必要な枚数が出ます。</td></tr>';
  }

  // ---- ボタン
  el('b-clear').addEventListener('click', function () {
    CATS.forEach(function (c) { state[c].n = 0; });
    syncInputs(); calc();
  });
  el('b-t9').addEventListener('click', function () {
    CATS.forEach(function (c) { state[c].from = 1; state[c].to = Math.min(9, MAXT[c]); state[c].n = 1; });
    syncInputs(); calc();
  });
  el('b-t10').addEventListener('click', function () {
    CATS.forEach(function (c) { state[c].from = 1; state[c].to = MAXT[c]; state[c].n = 1; });
    syncInputs(); calc();
  });
  function syncInputs() {
    [].forEach.call(el('goals').querySelectorAll('[data-c]'), function (n) {
      n.value = state[n.dataset.c][n.dataset.k];
    });
  }

  el('diff').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    diff = b.dataset.d;
    [].forEach.call(el('diff').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.d === diff));
    });
    calc();
  });

  buildGoals(); buildBpTabs(); buildUni();
  el('ver').textContent = E.version;
  // 最初から何か見えているように、T9 まで 1 個ずつを入れておく
  CATS.forEach(function (c) { state[c].from = 1; state[c].to = Math.min(9, MAXT[c]); state[c].n = 1; });
  syncInputs();
  calc();
})();
