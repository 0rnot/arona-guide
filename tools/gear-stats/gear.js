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
      return '<button type="button" data-c="' + c + '" aria-pressed="' + (c === cat) + '">' +
        esc(G.catJa[c]) + '</button>';
    }).join('');
  }
  function drawTiers() {
    var list = (G.eq[cat] || []).slice().sort(function (a, b) { return b.t - a.t; });
    var by = {}; list.forEach(function (e) { by[e.t] = e; });
    el('eq-lead').innerHTML = esc(G.catJa[cat]) + 'は T1 から T' +
      Math.max.apply(null, list.map(function (e) { return e.t; })) +
      ' まであります。<b>右の数字は、1 つ下の段を上げきった状態からの伸びです。</b>';
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
  var wsort = 'name', wstar = WSTAR;
  var WSORTS = [
    ['name', '名前', function (a, b) { return a.n.localeCompare(b.n, 'ja'); }],
    ['atk', '攻撃力', function (a, b) { return wstats(b, wstar).a - wstats(a, wstar).a; }],
    ['hp', '最大 HP', function (a, b) { return wstats(b, wstar).h - wstats(a, wstar).h; }],
    ['heal', '治癒力', function (a, b) { return wstats(b, wstar).p - wstats(a, wstar).p; }],
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

    var cnt = {};
    G.weapon.forEach(function (w) { cnt[w.ad] = (cnt[w.ad] || 0) + 1; });
    var av = {};
    G.weapon.forEach(function (w) { av[w.av] = (av[w.av] || 0) + 1; });
    el('wp-lead').textContent = '全 ' + G.weapon.length + ' 人ぶん。日本で開いているのは固有' + WSTAR +
      '（Lv' + WLV[WSTAR - 1] + '）までです。固有武器で上がる地形は' +
      Object.keys(TERRAIN).map(function (t) { return TERRAIN[t] + ' ' + (cnt[t] || 0) + ' 人'; }).join('、') +
      '。上がり幅は ' + Object.keys(av).sort().map(function (k) { return '＋' + k + ' が ' + av[k] + ' 人'; }).join('、') +
      'です。' + (q || adapt ? 'いまは ' + rows.length + ' 人。' : '');

    // 並べ替えの押しボタン
    el('wsort').innerHTML = WSORTS.map(function (x) {
      return '<button type="button" data-s="' + x[0] + '" aria-pressed="' + (x[0] === wsort) + '">' +
        x[1] + '</button>';
    }).join('');
    // どの段の数字で並べるか
    el('wstar').innerHTML = WLV.map(function (lv, i) {
      return '<button type="button" data-n="' + (i + 1) + '" aria-pressed="' + (i + 1 === wstar) + '">' +
        '固有' + (i + 1) + '</button>';
    }).join('');
    el('wstar-note').textContent = wsort === 'name' || wsort === 'adapt'
      ? '並べ替えを攻撃力・最大 HP・治癒力にすると、この段の数字で並びます。'
      : '固有' + wstar + '（Lv' + WLV[wstar - 1] + '）の数字で並べています。';

    el('weapons').innerHTML = rows.map(function (w) {
      // **武器の絵は横長。**衣装違いは元の子の絵を使い回すので `wi` を見る
      var wimg = w.wi ? '<img class="wpic" src="../img/' + w.wi + '.webp" alt="" width="130" height="34" loading="lazy">' : '';
      var kinds = [['攻撃力', 'a'], ['最大HP', 'h'], ['治癒力', 'p']]
        .filter(function (x) { return w[x[1]] && w[x[1]][1]; });
      var head = '<tr><th>段</th><th>Lv</th>' +
        kinds.map(function (x) { return '<th>' + x[0] + '</th>'; }).join('') + '</tr>';
      var body = WLV.map(function (lv, i) {
        var n = i + 1, st = wstats(w, n);
        return '<tr' + (n === wstar ? ' class="on"' : '') + '><th>固有' + n + '</th><td>' + st.lv + '</td>' +
          kinds.map(function (x) {
            return '<td>' + num(st[x[1]]) + '</td>';
          }).join('') + '</tr>';
      }).join('');
      var gains = WLV.map(function (lv, i) {
        return '<li><b>固有' + (i + 1) + '</b> ' + esc(wgain(w, i + 1)) + '</li>';
      }).join('');
      return '<div class="gcard"><img src="../img/student_' + w.id + '.webp" alt="" width="48" height="48" loading="lazy">' +
        '<div><div class="nm">' + esc(w.n) + '</div>' + wimg + '<div class="sub">' + esc(w.wn || '—') + '<br>' +
        '<span class="ad">' + esc(TERRAIN[w.ad] || w.ad) + ' 適性 ＋' + w.av + '（固有3 から）</span></div>' +
        '<table class="wtb">' + head + body + '</table>' +
        '<ul class="wgain">' + gains + '</ul>' +
        '<div class="sub">装備 ' + esc((w.eq || []).map(function (c) { return G.catJa[c] || c; }).join('・')) +
        '</div></div></div>';
    }).join('') || '<p class="lead">見つかりませんでした。</p>';
  }

  /* ---------- タブ */
  var view = 'eq';
  function drawTab() {
    ['eq', 'gear', 'wp'].forEach(function (v) { el('pane-' + v).hidden = v !== view; });
    [].forEach.call(el('tab').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === view));
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
    adapt = b.dataset.a;
    [].forEach.call(el('adapt').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.a === adapt));
    });
    drawWeapons();
  });
  el('q-gear').addEventListener('input', drawGear);
  el('q-wp').addEventListener('input', drawWeapons);
  el('wsort').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    wsort = b.dataset.s; drawWeapons();
  });
  el('wstar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    wstar = +b.dataset.n; drawWeapons();
  });

  el('ver').textContent = G.version;
  el('src-gear').textContent = G.gear.length;
  drawCats(); drawTiers(); drawGear(); drawWeapons(); drawTab();
})();
