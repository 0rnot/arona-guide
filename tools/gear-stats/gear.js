/* 装備・愛用品・固有武器の効果早見。

   計算はほとんどしていない。**ゲームの表をそのまま読める形に並べるのが仕事。**
   1 つだけ足しているのが「1 段上げるとどれだけ伸びるか」で、
   これは段の最大値どうしの差（Lv を上げきった装備の比較）。 */
(function () {
  'use strict';
  var G = window.GEAR;
  var el = function (id) { return document.getElementById(id); };
  var ST = (G.labels && G.labels.Stat) || {};
  var TERRAIN = { Street: '市街地戦', Outdoor: '屋外戦', Indoor: '屋内戦' };

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { return Math.round(v).toLocaleString('ja-JP'); }
  function pct(v) { return (Math.round(v) / 100).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '%'; }

  /** **末尾で決まる。**`_Coefficient` は係数、`_Base` でも Rate / Ratio で
      終わる項目は 10000 分率。それ以外の `_Base` は実数（HP や命中値）。 */
  function statName(k) {
    var base = k.replace(/_(Coefficient|Base)$/, '');
    return ST[base] || base;
  }
  function isPct(k) {
    return /_Coefficient$/.test(k) || /(Rate|Ratio)_Base$/.test(k);
  }
  function statVal(k, v) { return (v >= 0 ? '＋' : '−') + (isPct(k) ? pct(Math.abs(v)) : num(Math.abs(v))); }
  function statLine(types, vals, idx) {
    return types.map(function (k, i) {
      var pair = vals[i] || [0, 0];
      return statName(k) + ' ' + statVal(k, pair[idx]);
    }).join('／');
  }

  /* ---------- 装備 */
  var cat = 'Hat';
  function drawCats() {
    el('cat').innerHTML = Object.keys(G.catJa).map(function (c) {
      // **アイコンは既存の gi-icon-inven-* を流用。**部位名と 1:1 で対応する
      return '<button type="button" data-c="' + c + '" aria-pressed="' + (c === cat) + '">' +
        '<span class="gi gi-icon-inven-' + c.toLowerCase() + '" aria-hidden="true"></span>' +
        esc(G.catJa[c]) + '</button>';
    }).join('');
  }
  function drawTiers() {
    var list = (G.eq[cat] || []).slice().sort(function (a, b) { return b.t - a.t; });
    var by = {}; list.forEach(function (e) { by[e.t] = e; });
    el('eq-lead').innerHTML = esc(G.catJa[cat]) + 'は T1〜T' +
      Math.max.apply(null, list.map(function (e) { return e.t; })) + '。' +
      '<button type="button" class="qm" data-hint="右の数字は、1つ下の段を上げきった状態からの伸びです。"></button>';
    el('tiers').innerHTML = list.map(function (e) {
      var prev = by[e.t - 1];
      var up = '';
      if (prev) {
        // 同じ項目どうしを引く。片方にしか無い項目は「新しく付く」として全量出す
        var seen = {};
        // **伸びが 0 の項目は出さない。**「会心ダメージ ＋0%」が並ぶと、
        // どこが本当に変わったのか読めなくなる
        var parts = [];
        e.st.forEach(function (k, i) {
          var j = prev.st.indexOf(k);
          seen[k] = true;
          var now = (e.sv[i] || [0, 0])[1];
          var was = j >= 0 ? (prev.sv[j] || [0, 0])[1] : 0;
          if (now === was) return;
          parts.push(statName(k) + ' ' + statVal(k, now - was) + (j < 0 ? '（新しく付く）' : ''));
        });
        prev.st.forEach(function (k, j) {
          if (!seen[k]) parts.push(statName(k) + ' ' + statVal(k, -(prev.sv[j] || [0, 0])[1]) + '（無くなる）');
        });
        up = parts.length
          ? '<b>' + esc(parts.join('／')) + '</b><small>T' + (e.t - 1) + ' の最大から</small>'
          : '<small>T' + (e.t - 1) + ' の最大から変わりません</small>';
      } else {
        up = '<small>いちばん下の段</small>';
      }
      return '<div class="tier">' +
        '<span class="t">T' + e.t + '<small>最大 Lv' + e.ml + '</small></span>' +
        '<img src="../img/' + esc(e.i) + '.webp" alt="" width="44" height="44" loading="lazy">' +
        '<span class="tx">' + esc(e.n) +
        '<small>' + esc(statLine(e.st, e.sv, 0)) + '（Lv1）<br>' +
        esc(statLine(e.st, e.sv, 1)) + '（Lv' + e.ml + '）' +
        (e.rc ? '<br>作るのに ' + num(e.rc) + ' クレジット' : '') + '</small></span>' +
        '<span class="up">' + up + '</span></div>';
    }).join('');
    syncHash();
  }

  /* ---------- 愛用品 */
  function drawGear() {
    var q = (el('q-gear').value || '').trim();
    var rows = G.gear.filter(function (g) { return !q || g.n.indexOf(q) >= 0 || g.gn.indexOf(q) >= 0; });
    rows.sort(function (a, b) { return a.n.localeCompare(b.n, 'ja'); });
    el('gear-lead').textContent = '愛用品を持っているのは ' + G.gear.length + ' 人です。' +
      (q ? '「' + q + '」で ' + rows.length + ' 人。' : '');
    el('gears').innerHTML = rows.map(function (g) {
      // **愛用品そのものの絵も出す。**顔だけだと、どの品か分からない
      return '<div class="gcard"><img src="../img/student_' + g.id + '.webp" alt="" width="48" height="48" loading="lazy">' +
        '<img class="thing" src="../img/gear_' + g.id + '.webp" alt="" width="48" height="48" loading="lazy">' +
        '<div><div class="nm">' + esc(g.n) + '</div><div class="sub">' + esc(g.gn) + '<br>' +
        g.st.map(function (k, i) {
          var v = g.sv[i] || [0, 0];
          return statName(k) + ' <b>' + statVal(k, v[0]) + '</b>';
        }).join('<br>') + '</div></div></div>';
    }).join('') || '<p class="lead">見つかりませんでした。</p>';
    syncHash();
  }

  /* ---------- 固有武器
     **固有の段（限界解放）でレベル上限が変わるので、ステータスも変わる。**
     以前は Lv1 → Lv100 と出していたが、**Lv100 には届かない**。
     日本で開いているのは固有4 の Lv60 まで（2026-08-30 に直した）。 */
  var WLV = G.wlv || [30, 40, 50, 60];        // 固有1〜固有N のレベル上限
  var WSTAR = G.wstar || WLV.length;

  /** レベル L のときの値。**SchaleDB 本体と同じ式。**
      `Math.ceil(Math.round(lo + (hi - lo) * (L - 1) / 99))`
      （`assets/index-*.js` の `mg()` と `g$()`。Standard・LateBloom・Premature の
      3 つはどれも直線で、段が付くのは TimeAttack だけ。固有武器にその型は無い）。 */
  function atLv(pair, lv) {
    if (!pair || !pair[1]) return 0;
    return Math.ceil(Math.round(pair[0] + (pair[1] - pair[0]) * ((lv - 1) / 99)));
  }

  /** 固有 n 段（1 起点）のときの、その武器のステータス。 */
  function wstats(w, n) {
    var lv = WLV[n - 1];
    return { lv: lv, a: atLv(w.a, lv), h: atLv(w.h, lv), p: atLv(w.p, lv) };
  }

  /** 固有 n 段で新しく付くもの。**段によって内容が変わる。**
      固有2 でパッシブスキル＋、固有3 で地形適性、固有4 で特効かコスト上限。 */
  function wgain(w, n) {
    if (n === 1) return '固有武器が使えるようになります';
    if (n === 2) return 'パッシブスキル＋を覚えます';
    if (n === 3) return (TERRAIN[w.ad] || w.ad) + ' 適性 ＋' + w.av;
    return w.sq === 'Support' ? 'コスト上限 ＋0.5' : '自分の攻撃属性の特効 ＋10%';
  }

  var adapt = '';
  /** **`wstar` は絞り込みそのもの。**0 は「すべて」で、1〜4 はその段だけを出す。
      並べ替えに使う数字は段が要るので、すべてのときは日本の上限（固有4）で代用する。 */
  var wsort = 'name', wstar = 0;
  /** **絞り込みが無いと 274 人ぶん一気に描く。**スマホだと 1 ページが
      140 画面ぶんになる（2026-08-31 に実測）。名前・地形・固有の段のどれかで
      絞ったときだけ全部出し、それ以外は先頭 24 枚＋「もっと見る」にする。
      押して広げた状態は、絞り込みを変えるまで保つ。 */
  var WPAGE = 24;
  var wexpand = false;
  function sortStar() { return wstar || WSTAR; }
  var WSORTS = [
    ['name', '名前', function (a, b) { return a.n.localeCompare(b.n, 'ja'); }],
    ['atk', '攻撃力', function (a, b) { return wstats(b, sortStar()).a - wstats(a, sortStar()).a; }],
    ['hp', '最大 HP', function (a, b) { return wstats(b, sortStar()).h - wstats(a, sortStar()).h; }],
    ['heal', '治癒力', function (a, b) { return wstats(b, sortStar()).p - wstats(a, sortStar()).p; }],
    ['adapt', '適性の伸び', function (a, b) {
      return b.av - a.av || (TERRAIN[a.ad] || '').localeCompare(TERRAIN[b.ad] || '', 'ja')
             || a.n.localeCompare(b.n, 'ja');
    }]
  ];

  function drawWeapons() {
    var q = (el('q-wp').value || '').trim();
    var rows = G.weapon.filter(function (w) {
      if (adapt && w.ad !== adapt) return false;
      return !q || w.n.indexOf(q) >= 0 || (w.wn || '').indexOf(q) >= 0;
    });
    var cmp = WSORTS.filter(function (x) { return x[0] === wsort; })[0];
    rows.sort(cmp ? cmp[2] : WSORTS[0][2]);

    // **絞り込みが無いときだけページを切る。**名前・地形・固有の段のどれかを
    // 選んだら、その結果は数が少ないので全部出す
    var filtered = !!(q || adapt || wstar);
    var shown = rows;
    var hidden = 0;
    if (!filtered && !wexpand && rows.length > WPAGE) {
      shown = rows.slice(0, WPAGE);
      hidden = rows.length - WPAGE;
    }

    var cnt = {};
    G.weapon.forEach(function (w) { cnt[w.ad] = (cnt[w.ad] || 0) + 1; });
    var av = {};
    G.weapon.forEach(function (w) { av[w.av] = (av[w.av] || 0) + 1; });
    el('wp-lead').innerHTML = '全 ' + G.weapon.length + ' 人ぶん。地形は' +
      Object.keys(TERRAIN).map(function (t) { return TERRAIN[t] + ' ' + (cnt[t] || 0) + ' 人'; }).join('、') +
      '、上がり幅は ' + Object.keys(av).sort().map(function (k) { return '＋' + k + ' が ' + av[k] + ' 人'; }).join('、') +
      'です。' + (q || adapt ? 'いまは ' + rows.length + ' 人。' : '') +
      '<button type="button" class="qm" data-hint="日本で開いているのは固有' + WSTAR +
      '（Lv' + WLV[WSTAR - 1] + '）までです。"></button>';

    // 並べ替えの押しボタン
    el('wsort').innerHTML = WSORTS.map(function (x) {
      return '<button type="button" data-s="' + x[0] + '" aria-pressed="' + (x[0] === wsort) + '">' +
        x[1] + '</button>';
    }).join('');
    // 固有の段のしぼり込み。**「すべて」を先頭に置く**
    el('wstar').innerHTML =
      '<button type="button" data-n="0" aria-pressed="' + (wstar === 0) + '">すべて</button>' +
      WLV.map(function (lv, i) {
        return '<button type="button" data-n="' + (i + 1) + '" aria-pressed="' + (i + 1 === wstar) + '">' +
          '固有' + (i + 1) + '</button>';
      }).join('');
    var byNum = wsort === 'atk' || wsort === 'hp' || wsort === 'heal';
    el('wstar-note').innerHTML = (wstar
      ? '固有' + wstar + '（Lv' + WLV[wstar - 1] + '）だけを表示中。'
      : '固有1〜固有' + WSTAR + ' をすべて表示中。') +
      '<button type="button" class="qm" data-hint="' +
      (byNum ? '並べ替えは固有' + sortStar() + '（Lv' + WLV[sortStar() - 1] + '）の数字です。'
             : '並べ替えを攻撃力・最大HP・治癒力にすると、その段の数字で並びます。') +
      '"></button>';

    el('weapons').innerHTML = shown.map(function (w) {
      // **武器の絵は横長。**衣装違いは元の子の絵を使い回すので `wi` を見る
      var wimg = w.wi ? '<img class="wpic" src="../img/' + w.wi + '.webp" alt="" width="130" height="34" loading="lazy">' : '';
      var kinds = [['攻撃力', 'a'], ['最大HP', 'h'], ['治癒力', 'p']]
        .filter(function (x) { return w[x[1]] && w[x[1]][1]; });
      // **見出しに「固有」を出して、中身は数字だけにする。**
      // 4 列に並ぶ 258px の札では「固有1」が 2 行に折れて、表の高さが札ごとにずれる
      var head = '<tr><th>固有</th><th>Lv</th>' +
        kinds.map(function (x) { return '<th>' + x[0] + '</th>'; }).join('') + '</tr>';
      var body = WLV.map(function (lv, i) {
        var n = i + 1;
        if (wstar && n !== wstar) return '';
        var st = wstats(w, n);
        // 全部出しているときだけ、並べ替えに使っている段に色を敷く
        return '<tr' + (!wstar && n === sortStar() ? ' class="on"' : '') +
          '><th>' + n + '</th><td>' + st.lv + '</td>' +
          kinds.map(function (x) {
            return '<td>' + num(st[x[1]]) + '</td>';
          }).join('') + '</tr>';
      }).join('');
      // **効果は積み上がる。**固有3 の子は固有1・固有2 の効果も持っている
      var gains = WLV.map(function (lv, i) {
        var n = i + 1;
        if (wstar && n > wstar) return '';
        return '<li' + (wstar && n === wstar ? ' class="now"' : '') +
          '><b>固有' + n + '</b> ' + esc(wgain(w, n)) + '</li>';
      }).join('');
      return '<div class="gcard"><img src="../img/student_' + w.id + '.webp" alt="" width="48" height="48" loading="lazy">' +
        '<div><div class="nm">' + esc(w.n) + '</div>' + wimg + '<div class="sub">' + esc(w.wn || '—') + '<br>' +
        // 固有2 までを見ているときは、地形適性はまだ乗らない
        '<span class="ad' + (wstar && wstar < 3 ? ' off' : '') + '">' +
        esc(TERRAIN[w.ad] || w.ad) + ' 適性 ＋' + w.av + '（固有3 から）</span></div>' +
        '<table class="wtb">' + head + body + '</table>' +
        '<ul class="wgain">' + gains + '</ul>' +
        '<div class="sub wfoot">装備 ' +
        esc((w.eq || []).map(function (c) { return G.catJa[c] || c; }).join('・')) +
        '</div></div></div>';
    }).join('') || '<p class="lead">見つかりませんでした。</p>';

    // **もっと見るボタン。**押すと絞り込みを変えるまで全部出したままにする
    el('wp-more-wrap').innerHTML = hidden
      ? '<button type="button" id="wp-more" class="btn">あと ' + hidden + ' 人ぶんを見る</button>'
      : '';
    syncHash();
  }

  /* ---------- タブ */
  var view = 'eq';
  function drawTab() {
    ['eq', 'gear', 'wp'].forEach(function (v) { el('pane-' + v).hidden = v !== view; });
    [].forEach.call(el('tab').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === view));
    });
    syncHash();
  }

  /* ---------- URL ----------
     **開いている面と絞り込みを URL に残す。**下の共有の帯は
     「開いている状態ごと URL になります」と言うので、それを本当にする
     （2026-08-31。それまでこのツールだけ状態が URL に入らなかった）。
     区画は `g=面~部位~地形~並べ替え~固有の段~愛用品の検索~武器の検索`。 */
  function hash() {
    return 'g=' + [view, cat, adapt, wsort, wstar,
      encodeURIComponent((el('q-gear').value || '').trim()),
      encodeURIComponent((el('q-wp').value || '').trim())].join('~');
  }
  // 既定のまま。**このときはハッシュを書かず、URL を短いままにしておく**
  var DEF_HASH = 'g=eq~Hat~~name~0~~';
  window.shareUrl = function () { return '#' + hash(); };
  function syncHash() {
    var h = hash();
    try {
      history.replaceState(null, '', location.pathname + location.search +
        (h === DEF_HASH ? '' : '#' + h));
    } catch (e) { /* file:// では黙って諦める */ }
  }
  function fromHash() {
    var seg = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x.indexOf('g=') === 0;
    })[0];
    if (!seg) return;
    var p = seg.slice(2).split('~');
    if (p[0] === 'eq' || p[0] === 'gear' || p[0] === 'wp') view = p[0];
    if (G.catJa[p[1]]) cat = p[1];
    if (p[2] === '' || TERRAIN[p[2]]) adapt = p[2];
    if (WSORTS.some(function (x) { return x[0] === p[3]; })) wsort = p[3];
    var n = parseInt(p[4], 10);
    if (n >= 0 && n <= WSTAR) wstar = n;
    try {
      el('q-gear').value = decodeURIComponent(p[5] || '');
      el('q-wp').value = decodeURIComponent(p[6] || '');
    } catch (e) { /* 壊れた %xx は空のまま */ }
    // 地形の押しボタンは描き直しが無いので、ここで合わせる
    [].forEach.call(el('adapt').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.a === adapt));
    });
  }

  el('tab').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    view = b.dataset.v; drawTab();
  });
  el('cat').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    cat = b.dataset.c; drawCats(); drawTiers();
  });
  el('adapt').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    adapt = b.dataset.a; wexpand = false;
    [].forEach.call(el('adapt').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.a === adapt));
    });
    drawWeapons();
  });
  el('q-gear').addEventListener('input', drawGear);
  el('q-wp').addEventListener('input', function () { wexpand = false; drawWeapons(); });
  el('wsort').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    wsort = b.dataset.s; drawWeapons();
  });
  el('wstar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    wstar = +b.dataset.n; wexpand = false; drawWeapons();
  });
  // **もっと見るボタン。**描き直すたびに作り直すので、親を委任で拾う
  el('wp-more-wrap').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    wexpand = true; drawWeapons();
  });

  el('ver').textContent = G.fetched;
  el('src-gear').textContent = G.gear.length;
  fromHash();
  drawCats(); drawTiers(); drawGear(); drawWeapons(); drawTab();
})();
