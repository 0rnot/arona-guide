/* 装備設計図の周回計算機。
   ------------------------------------------------------------
   踏まえている仕様（出どころはページ下に書いた）:
   - ティアアップは「その Tier の設計図」だけでなく、**2〜3 段下の設計図も食う**。
     T10 の 60 枚だけ数えると丸ごと足りなくなる
   - **お守り・腕時計・ネックレスは T9 が上限。** データ上 T10 の装備もレシピも無い
   - ドロップの期待値は `StageRewardProb ÷ 10000 × StageRewardAmount` の和
   - **箱（GachaGroup）で出る枠がある。**中身と比率は GachaElement に出ているので、
     推測せずそのまま使って期待値に畳んである（data.js を作る時点で済ませている）
   - **「T◯装備設計図選択ボックス」と「万能設計図」は別のもの。**
     選択ボックスは Tier が決まっていて部位が自由（熟達証書ショップ、T2〜T8）。
     万能設計図は部位が決まっていて Tier が自由（任務でドロップ、T2:2 枚〜T10:50 枚）
   - **部位ごとに使う生徒の数がまるで違う。**ヘアピンは 274 人中 175 人、
     お守りは 38 人。「9 部位を同じ数だけ」揃えるのは無駄が大きい
   - **ドロップ 2 倍・3 倍のときは、期待値がそのまま倍になる。**AP は変わらない
   ------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EQUIP;
  var el = function (id) { return document.getElementById(id); };
  var CATS = E.cats, JA = E.catJa, MAXT = E.maxTier;

  var state = {};    // state[cat] = {from, to, n}
  var have = {};     // have[cat][tier] = 枚数
  var sel = {};      // sel[tier] = T◯装備設計図選択ボックスの個数
  var SEL_MIN = 2, SEL_MAX = 8;   // 選択ボックスは T2〜T8 しか存在しない
  var univ = {};     // univ[cat] = 万能設計図の枚数（部位ごと）
  /* **万能設計図 → 設計図 の交換レート。**高い Tier ほど割に合わない。
     ゲームのデータには出ていないので、ここだけ攻略 wiki の表から取った（出どころに明記） */
  var UR = { 2: 2, 3: 3, 4: 5, 5: 7, 6: 10, 7: 15, 8: 20, 9: 30, 10: 50 };
  var bpCat = CATS[0];
  var diff = 'all';
  var mul = 1;       // ドロップ倍率（2 倍・3 倍のとき）

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
      var used = (E.slots && E.slots[c]) || 0, ros = E.roster || 0;
      var pct = ros ? Math.round(used / ros * 100) : 0;
      return '<div class="goalrow">' +
        '<img src="' + icon(c, mx) + '" alt="" width="42" height="42" loading="lazy">' +
        '<span class="nm">' + JA[c] +
          '<span class="imp">上限 T' + mx + '　' + used + ' 人が使う（' + pct + '%）</span></span>' +
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

  // ---- T◯装備設計図選択ボックス（部位が自由、Tier は固定）
  function selIcon(t) { return '../img/equipment_icon_selection_tier' + t + '_piece.webp'; }

  function buildSel() {
    var h = '';
    for (var t = SEL_MIN; t <= SEL_MAX; t++) {
      h += '<div class="uni">' +
        '<img src="' + selIcon(t) + '" alt="" width="56" height="56" loading="lazy">' +
        '<div class="t">T' + t + '</div>' +
        '<input type="number" inputmode="numeric" min="0" max="999" step="1" value="0" ' +
          'data-t="' + t + '" aria-label="T' + t + '装備設計図選択ボックスの所持数">' +
        '</div>';
    }
    el('unigrid').innerHTML = h;
    el('unigrid').addEventListener('input', function (e) {
      var n = e.target; if (!n.dataset.t) return;
      sel[parseInt(n.dataset.t, 10)] = Math.max(0, Math.min(999, parseInt(n.value, 10) || 0));
      calc();
    });
  }

  // ---- 万能設計図（Tier が自由、部位は固定）
  function univIcon(c) { return '../img/equipment_icon_' + c.toLowerCase() + '_useall_piece.webp'; }

  function buildUniv() {
    el('univgrid').innerHTML = CATS.map(function (c) {
      return '<div class="uni">' +
        '<img src="' + univIcon(c) + '" alt="" width="56" height="56" loading="lazy">' +
        '<div class="t">' + JA[c] + '</div>' +
        '<input type="number" inputmode="numeric" min="0" max="99999" step="1" value="0" ' +
          'data-c="' + c + '" aria-label="' + JA[c] + 'の万能設計図の枚数">' +
        '</div>';
    }).join('');
    el('univgrid').addEventListener('input', function (e) {
      var n = e.target; if (!n.dataset.c) return;
      univ[n.dataset.c] = Math.max(0, Math.min(99999, parseInt(n.value, 10) || 0));
      calc();
    });
    el('urate').innerHTML = Object.keys(UR).map(function (t) {
      return '<span class="rt">T' + t + '<b>' + UR[t] + '</b></span>';
    }).join('');
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

    /* **選択ボックスは部位を選ばない。**同じ Tier なら、どの部位の不足にも充てられる。
       どこに使うかは持ち主が決められるので、**不足がいちばん多い部位から 1 枚ずつ**
       充てていく（＝残る不足がなるべく平らになる配り方）。 */
    for (var t = SEL_MIN; t <= SEL_MAX; t++) {
      var box = sel[t] || 0;
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

    /* **万能設計図は Tier を選ばないかわりに、部位が決まっている。**
       レートが Tier ごとに違って、低い Tier ほど得なので、**低いほうから充てる**。 */
    CATS.forEach(function (c) {
      var stock = univ[c] || 0;
      for (var t2 = 2; t2 <= 10 && stock > 0; t2++) {
        var lack = sh[c][t2] || 0;
        if (!lack) continue;
        var can = Math.min(lack, Math.floor(stock / UR[t2]));
        if (can <= 0) continue;
        stock -= can * UR[t2];
        sh[c][t2] -= can;
        total -= can;
        if (sh[c][t2] <= 0) delete sh[c][t2];
      }
    });

    sh.__total = total;
    return sh;
  }

  /** 手持ちの設計図以外（選択ボックス・万能設計図）で埋まった枚数。余りは数えない */
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
    // **2 倍・3 倍のときは落ちる枚数がそのまま倍になる。**AP は変わらない
    s.d.forEach(function (r) { add(r[0], r[1], r[2] * mul); });
    return m;
  }

  /** ステージ 1 周でもらえる万能設計図。**部位ごとの枚数と、その合計。** */
  function univOf(s) {
    var m = {}, tot = 0;
    (s.b || []).forEach(function (r) { m[r[0]] = r[1] * mul; tot += r[1] * mul; });
    return { by: m, total: tot };
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
      // **ここでは万能設計図を数えない。**1 枚の万能設計図をどの Tier に充てるかは
      // 1 通りしか選べないので、Tier ごとに別々に足すと同じ枚数を何度も数えてしまう。
      // 万能設計図を込みにした周回数は、下の「周回先」の各行に出している
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
  /**
   * この面を N 周したとき、対象の不足がぜんぶ埋まるか。
   * **万能設計図も数える。**部位の中でレートの安い（Tier の低い）ほうから充てる。
   */
  function coversIn(s, sh, n) {
    var m = dropsOf(s), u = univOf(s).by;
    for (var i = 0; i < CATS.length; i++) {
      var c = CATS[i], rest = {}, any = false;
      Object.keys(sh[c]).forEach(function (t) {
        var lack = sh[c][t] - n * (m[c + '|' + t] || 0);
        if (lack > 0) { rest[t] = lack; any = true; }
      });
      if (!any) continue;
      var stock = n * (u[c] || 0);
      for (var t2 = 2; t2 <= 10; t2++) {
        if (!rest[t2]) continue;
        var use = Math.min(rest[t2], Math.floor(stock / UR[t2]));
        stock -= use * UR[t2];
        rest[t2] -= use;
      }
      for (var k in rest) if (rest[k] > 0.0000001 && touches(s, c, +k)) return false;
    }
    return true;
  }
  /** その面が関われる不足か（直接落ちるか、万能設計図で埋められるか） */
  function touches(s, c, t) {
    var m = dropsOf(s), u = univOf(s).by;
    return !!m[c + '|' + t] || !!u[c];
  }

  /**
   * 周回先の並び。**「足りない量が多いものほど重く数える」。**
   * 素朴に「1 AP あたり何枚」で並べると、序盤のステージが全部 30 枚/100AP で
   * 横並びになって順位が付かない（実測）。欲しいのは枚数ではなく、
   * **詰まっているところが埋まるかどうか**なので、不足量で重みを付ける。
   * **万能設計図も同じ物差しに乗せる。**高 Tier の面ほど大量に落ちるので、
   * これを数えないと「低 Tier の面ばかり勧める」ことになる（Wiki の考察と食い違う）。
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

      // 万能設計図ぶん。**1 周でもらえる枚数を、レートの安い Tier から設計図に換算する**
      var u = univOf(s), uScore = 0, uCount = 0;
      CATS.forEach(function (c) {
        var stock = u.by[c] || 0;
        if (!stock) return;
        for (var t = 2; t <= 10; t++) {
          var lack = (sh[c] && sh[c][t]) || 0;
          if (!lack || stock <= 0) continue;
          var can = Math.min(lack, stock / UR[t]);
          stock -= can * UR[t];
          uScore += can * (lack / maxShort);
          uCount += can;
        }
      });
      score += uScore;
      got += uCount;
      if (got <= 0) return;
      parts.sort(function (a, b) { return b.w - a.w; });

      // **この面だけを回ったとき、関われる不足が埋まるまで何周か。**
      // 「不足の合計 ÷ 1 周の枚数」は、設計図が置き換えられるかのように
      // 見えて嘘になる。1 種類でも足りなければ終わらない
      var lo = 0, hi = 1;
      while (hi < 1000000 && !coversIn(s, sh, hi)) hi *= 2;
      if (!coversIn(s, sh, hi)) hi = 1000000;
      while (lo + 1 < hi) {
        var mid = Math.floor((lo + hi) / 2);
        if (coversIn(s, sh, mid)) hi = mid; else lo = mid;
      }
      out.push({ s: s, got: got, per: got / s.ap, score: score / s.ap, runs: hi, uni: u.total,
                 ucount: uCount, parts: parts.map(function (x) { return x.txt; }) });
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
      (cut > 0 ? '（選択ボックスと万能設計図で ' + fmt(cut) + ' 枚ぶんを差し引き済み）' : '');

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
        '（' + fmt(sh[wp[0]][+wp[1]]) + ' 枚）。' + stageName(best[worstKey].stage) +
        ' で最短。万能設計図を数えないときの値です' +
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
            '<span class="dt2">AP ' + x.s.ap + '　' + (x.per * 100).toFixed(1) + ' 枚/100AP　' +
              x.parts.join('　') +
              (x.uni > 0 ? '<br>万能設計図 1 周 ' + x.uni.toFixed(1) + ' 枚（' +
                fmt(x.uni * x.runs) + ' 枚たまります）' : '') +
              '</span></span>' +
            '<span class="sc">' + fmt(x.runs) + '<small style="font-weight:400;color:var(--fg-mute)"> 周' +
              '<br>' + fmt(x.runs * x.s.ap) + ' AP</small></span>' +
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

  // ---- 生徒の人数から部位ごとの個数を割り出す
  // 生徒 1 人は装備欄 3 つ。**どの部位を使うかは生徒ごとに決まっている**ので、
  // 人数 × その部位を使う生徒の割合が、そのまま要る個数になる
  (function buildRoster() {
    var mx = Math.max.apply(null, CATS.map(function (c) { return MAXT[c]; }));
    var o = '';
    for (var t = 2; t <= mx; t++) o += '<option value="' + t + '"' + (t === 9 ? ' selected' : '') + '>T' + t + '</option>';
    el('i-goal').innerHTML = o;
    el('r-n').textContent = E.roster || '—';
    el('imp-note').textContent = '（何人が使うか）';
  })();

  el('b-people').addEventListener('click', function () {
    var people = Math.max(1, parseInt(el('i-people').value, 10) || 0);
    var goal = parseInt(el('i-goal').value, 10) || 9;
    CATS.forEach(function (c) {
      var used = (E.slots && E.slots[c]) || 0, ros = E.roster || 1;
      state[c].from = 1;
      state[c].to = Math.min(goal, MAXT[c]);
      state[c].n = Math.round(people * used / ros);
    });
    syncInputs(); calc();
  });

  el('mul').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    mul = +b.dataset.m;
    [].forEach.call(el('mul').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(+x.dataset.m === mul));
    });
    calc(true);
  });

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

  buildGoals(); buildBpTabs(); buildSel(); buildUniv();
  el('ver').textContent = E.version;
  el('src-roster').textContent = E.roster;   // **人数は増える。**出どころの文にも埋める
  // 最初から何か見えているように、T9 まで 1 個ずつを入れておく
  CATS.forEach(function (c) { state[c].from = 1; state[c].to = Math.min(9, MAXT[c]); state[c].n = 1; });
  syncInputs();
  calc();
})();
