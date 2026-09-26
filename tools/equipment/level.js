/* 装備の計算機の「強化珠」の区画（元は tools/equip-level/ の 1 本。2026-09-26 にまとめた）。

   **ハッシュは `lv=` の 1 区画だけ読み書きする。**形は元の equip-level と同じ
   `lv=T.Lv.T.Lv.個数,…|初級.中級.上級.最上級`。ほかの区画（`eq=`・`g=`・`pane=`）には触らない。 */
(function () {
  'use strict';
  var E = window.EQLV;
  var el = function (id) { return document.getElementById(id); };
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  var TIERS = E.tiers;                       // [1..10]
  var GEMS = E.gems;                         // 経験値の小さい順（90 / 360 / 1440 / 5760）
  function maxLv(t) { return E.maxLv[t - 1]; }
  /** その Tier で Lv1 から Lv l までに要る累計。**上限を超えたら上限で頭打ち。** */
  function cum(t, l) {
    var a = E.cum[String(t)];
    return a[Math.max(1, Math.min(l, maxLv(t)))];
  }

  /** 1 行ぶんの必要経験値。**Tier をまたぐときはレベルが Lv1 に戻る。** */
  function rowExp(r) {
    if (r.t1 < r.t0 || (r.t1 === r.t0 && r.l1 <= r.l0)) return 0;
    if (r.t1 === r.t0) return cum(r.t0, r.l1) - cum(r.t0, r.l0);
    var e = cum(r.t0, maxLv(r.t0)) - cum(r.t0, r.l0);
    for (var t = r.t0 + 1; t < r.t1; t++) e += cum(t, maxLv(t));
    return e + cum(r.t1, r.l1);
  }

  /** 上から詰める。**端数は 1 段下で埋めるので、最後だけ切り上げ。** */
  function pack(exp) {
    var out = [0, 0, 0, 0], rem = exp;
    for (var i = GEMS.length - 1; i >= 1; i--) {
      out[i] = Math.floor(rem / GEMS[i].e); rem -= out[i] * GEMS[i].e;
    }
    out[0] = Math.ceil(rem / GEMS[0].e);
    return out;
  }
  function expOf(n) { return n.reduce(function (a, v, i) { return a + v * GEMS[i].e; }, 0); }

  /** 手持ちを使い切ってから買う。**あふれが最小になるように詰める。** */
  function plan(exp, own) {
    var use = [0, 0, 0, 0], left = own.slice(), rem = exp, i;
    for (i = GEMS.length - 1; i >= 0; i--) {
      var k = Math.min(left[i], Math.floor(rem / GEMS[i].e));
      use[i] = k; rem -= k * GEMS[i].e; left[i] -= k;
    }
    // **端数は手持ちの小さいほうから埋める。**あふれてもここがいちばん少ない
    for (i = 0; i < GEMS.length && rem > 0; i++) {
      while (left[i] > 0 && rem > 0) { left[i]--; use[i]++; rem -= GEMS[i].e; }
    }
    var buy = rem > 0 ? pack(rem) : [0, 0, 0, 0];
    return { use: use, buy: buy, left: left, need: Math.max(0, rem) };
  }

  var rows = [];
  function blank() { return { t0: 1, l0: 1, t1: 10, l1: 70, n: 1 }; }
  function own() {
    return GEMS.map(function (g) { return Math.max(0, +el('own-' + g.id).value || 0); });
  }

  /* ---- 手持ちの欄。**一度だけ組む。**入力のたびに作り直すと焦点が飛ぶ */
  (function buildOwn() {
    el('own').innerHTML = GEMS.slice().reverse().map(function (g) {
      return '<div class="gem"><img src="../img/' + g.i + '.webp" alt="" width="34" height="34" loading="lazy">' +
        '<div><span class="gn">' + esc(g.n) + '<small>1 個 ' + fmt(g.e) + ' EXP</small></span>' +
        '<input id="own-' + g.id + '" type="number" inputmode="numeric" min="0" step="1" value="0" ' +
        'aria-label="' + esc(g.n) + 'の手持ち"></div></div>';
    }).join('');
    GEMS.forEach(function (g) { el('own-' + g.id).addEventListener('input', drawOut); });
  })();

  /* ---- 行。**行数が変わったときだけ組み直す。**中に入力欄があるので、
     打っている最中に innerHTML を書き換えると数字も焦点も飛ぶ */
  var built = -1;
  function tierOpts() {
    return TIERS.map(function (t) { return '<option value="' + t + '">T' + t + '</option>'; }).join('');
  }
  function drawRows() {
    if (built !== rows.length) {
      el('rows').innerHTML = rows.map(function (_, i) {
        return '<div class="eqrow" data-i="' + i + '">' +
          '<div class="side"><span class="lb">今</span>' +
            '<select data-f="t0" aria-label="今の Tier">' + tierOpts() + '</select>' +
            '<input data-f="l0" type="number" inputmode="numeric" min="1" step="1" aria-label="今のレベル"></div>' +
          '<div class="arrow" aria-hidden="true">→</div>' +
          '<div class="side"><span class="lb">目標</span>' +
            '<select data-f="t1" aria-label="目標の Tier">' + tierOpts() + '</select>' +
            '<input data-f="l1" type="number" inputmode="numeric" min="1" step="1" aria-label="目標のレベル"></div>' +
          '<div class="cnt"><span class="lb">個数</span>' +
            '<input data-f="n" type="number" inputmode="numeric" min="1" step="1" aria-label="同じ装備の個数"></div>' +
          '<button type="button" class="del" aria-label="この行を消す"' +
            (rows.length < 2 ? ' disabled' : '') + '>✕</button>' +
          '<p class="over"></p></div>';
      }).join('');
      built = rows.length;
    }
    [].forEach.call(el('rows').children, function (box, i) {
      var r = rows[i];
      var q = function (f) { return box.querySelector('[data-f="' + f + '"]'); };
      q('t0').value = r.t0; q('t1').value = r.t1;
      q('l0').max = maxLv(r.t0); q('l1').max = maxLv(r.t1);
      q('l0').value = r.l0; q('l1').value = r.l1;
      q('n').value = r.n;
      box.querySelector('.del').disabled = rows.length < 2;
      var e = rowExp(r);
      box.querySelector('.over').innerHTML = e
        ? 'この行で <b>' + fmt(e * r.n) + '</b> EXP' +
          (r.n > 1 ? '（1 個あたり ' + fmt(e) + '）' : '') +
          '｜T' + r.t0 + ' の上限は Lv' + maxLv(r.t0) + '、T' + r.t1 + ' は Lv' + maxLv(r.t1)
        : '<b>目標が今より下です。</b>この行は 0 EXP として数えます。';
    });
  }

  function totalExp() {
    return rows.reduce(function (a, r) { return a + rowExp(r) * Math.max(0, r.n); }, 0);
  }

  function drawOut() {
    var exp = totalExp(), o = own(), p = plan(exp, o), pure = pack(exp);
    var buyExp = expOf(p.buy), useExp = expOf(p.use);
    var buyN = p.buy.reduce(function (a, v) { return a + v; }, 0);
    var lvCredit = exp * E.coef;
    var shopCredit = Math.round(buyExp * E.dayCredit / E.dayExp);

    el('o-exp').innerHTML = fmt(exp) + ' <small>EXP</small>';
    el('o-exp-sub').innerHTML = exp
      ? '最上級強化珠だけなら <b>' + fmt(Math.ceil(exp / GEMS[3].e)) + '</b> 個ぶん'
      : '今と目標が同じなので、何も要りません。';
    el('o-buy').innerHTML = fmt(buyN) + ' <small>個</small>';
    el('o-buy-sub').innerHTML = p.need
      ? '足りない <b>' + fmt(p.need) + '</b> EXP ぶん'
      : exp ? '手持ちで足りています。' : '—';
    el('o-credit').textContent = fmt(lvCredit + shopCredit);
    el('o-credit-sub').innerHTML =
      '<span>強化</span><b>' + fmt(lvCredit) + '</b>' +
      '<span>買い足し</span><b>' + fmt(shopCredit) + '</b>';

    var pct = exp ? Math.min(100, useExp / exp * 100) : 100;
    el('lv-bar').style.width = pct.toFixed(1) + '%';
    el('barnote').textContent = !exp
      ? '行を足すと、ここに進み具合が出ます。'
      : useExp >= exp
        ? '手持ちだけで足ります（使うのは ' + fmt(useExp) + ' EXP ぶん）'
        : '手持ちで ' + fmt(useExp) + ' EXP ぶん（要る ' + fmt(exp) + ' EXP の ' + pct.toFixed(0) + '%）';

    el('lv-plan').innerHTML = GEMS.slice().reverse().map(function (g) {
      var i = GEMS.indexOf(g);
      return '<div class="row"><span><img class="ico" src="../img/' + g.i + '.webp" alt="" width="20" height="20" loading="lazy">' +
        esc(g.n) + '</span>' +
        '<span class="nowrap">手持ち ' + fmt(p.use[i]) + ' ／ 買う <b>' + fmt(p.buy[i]) + '</b></span></div>';
    }).join('') +
      '<div class="row"><span>あふれる経験値</span>' +
      '<span class="nowrap">' + fmt(Math.max(0, useExp + buyExp - exp)) + ' EXP</span></div>' +
      '<div class="row total"><span>合わせて</span><span class="nowrap">' +
      fmt(p.use.reduce(function (a, v) { return a + v; }, 0)) + ' ／ <b>' + fmt(buyN) + '</b> 個</span></div>';

    // **日数と 1 日の上限だけ。**クレジットは上の 1 枚（2026-09-26）
    el('shop').innerHTML =
      '<div class="row"><span>買う強化珠の経験値<span class="subnote">足りない ' + fmt(p.need) +
        ' EXP ＋ あふれる ' + fmt(buyExp - p.need) + ' EXP</span></span><span>' + fmt(buyExp) + ' EXP</span></div>' +
      '<div class="row total"><span>何日ぶん<span class="subnote">1 日に買えるのは ' + fmt(E.dayExp) + ' EXP まで</span></span><span>' +
        (buyExp ? (buyExp / E.dayExp).toFixed(1) + ' 日' : '0 日') + '</span></div>';

    // あふれるぶん
    var over = expOf(pure) - exp;
    el('waste').innerHTML =
      '<div class="row"><span>上から詰めたときのあふれ</span><span>' +
        fmt(over) + ' EXP</span></div>' +
      '<div class="row"><span>初級を 1 個減らすと<span class="subnote">代わりに埋めたい経験値</span></span><span>' +
        (pure[0] > 0 ? fmt(GEMS[0].e - over) + ' EXP' : '—') + '</span></div>';

    // 表の色付け
    [].forEach.call(el('tb-tier').children, function (tr) {
      var t = +tr.dataset.t;
      var on = rows.some(function (r) { return t >= r.t0 && t <= r.t1 && rowExp(r) > 0; });
      tr.classList.toggle('hi', on);
    });

    /* **自分の区画だけ書き換える。**前は `location.replace('#…')` で丸ごと作り直していたが、
       1 ページにまとめたので、それだと設計図の在庫（`eq=`）や開いている区画が消える */
    setSeg('lv=' + toHash());
  }

  function draw() { drawRows(); drawOut(); }

  /* ---- 動かない表 */
  (function statics() {
    var acc = 0;
    el('tb-tier').innerHTML = TIERS.map(function (t) {
      var e = cum(t, maxLv(t)); acc += e;
      return '<tr data-t="' + t + '"><td class="nowrap">T' + t + '<small>上限 Lv' + maxLv(t) + '</small></td>' +
        '<td class="num">' + fmt(e) + '</td>' +
        '<td class="num">' + Math.ceil(e / GEMS[3].e) + ' 個</td>' +
        '<td class="num">' + (e % GEMS[0].e) + '</td>' +
        '<td class="num">' + fmt(acc) + '</td></tr>';
    }).join('');

    var gname = {};
    GEMS.forEach(function (g) { gname[g.id] = g.n; });
    el('tb-shop').innerHTML = E.bundles.map(function (b) {
      return '<tr><td class="nowrap">' + fmt(b.c) + '</td><td>' +
        b.it.map(function (x) { return esc(gname[x[0]]) + ' × ' + x[1]; }).join('<br>') +
        '</td><td class="num">' + fmt(b.e) + '</td>' +
        '<td class="num">' + (b.c / b.e).toFixed(2) + '</td></tr>';
    }).join('');

    el('tb-feed').innerHTML = GEMS.slice().reverse().map(function (g) {
      return '<tr><td>' + esc(g.n) + '</td><td class="num">' + fmt(g.e) + '</td></tr>';
    }).join('') + E.pieces.slice().reverse().map(function (p) {
      return '<tr><td>' + (p[0] ? 'T' + p[0] + '装備設計図' : '万能設計図') +
        '</td><td class="num">' + fmt(p[1]) + '</td></tr>';
    }).join('');

    // 値段はデータから作るので、丸の i の文も JS で入れる（hint.js は押されたときに読む）
    el('credit-qm').setAttribute('data-hint', '強化は1 EXPにつき' + E.coef + 'クレジット。' +
      '買い足しは通常アイテムショップで強化珠を買うぶんで、どの品も経験値あたりの値段は同じ(' +
      (E.dayCredit / E.dayExp).toFixed(2) + 'クレジット / 1 EXP)です。');
    el('dayexp2').textContent = fmt(E.dayExp);
    el('daycredit').textContent = fmt(E.dayCredit);
    el('src-all').textContent = fmt(E.allTiers);
    el('src-day').textContent = fmt(E.dayExp);
    el('src-daycredit').textContent = fmt(E.dayCredit);
    el('src-cats').textContent = E.cats.length;
    el('lv-ver').textContent = E.fetched;
  })();

  /* ---- 触ったとき */
  el('rows').addEventListener('change', function (e) {
    var f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    var i = +e.target.closest('.eqrow').dataset.i, r = rows[i], v = Math.floor(+e.target.value || 0);
    if (f === 't0' || f === 't1') {
      r[f] = Math.min(10, Math.max(1, v));
      if (r.t1 < r.t0) r[f === 't0' ? 't1' : 't0'] = r[f];
      r.l0 = Math.min(r.l0, maxLv(r.t0)); r.l1 = Math.min(r.l1, maxLv(r.t1));
    } else if (f === 'l0') {
      r.l0 = Math.min(Math.max(1, v), maxLv(r.t0));
    } else if (f === 'l1') {
      r.l1 = Math.min(Math.max(1, v), maxLv(r.t1));
    } else {
      r.n = Math.max(1, v);
    }
    draw();
  });
  // **打っている途中は組み直さない。**数字だけ拾って結果を出し直す
  el('rows').addEventListener('input', function (e) {
    var f = e.target.dataset && e.target.dataset.f;
    if (!f || e.target.tagName !== 'INPUT') return;
    var i = +e.target.closest('.eqrow').dataset.i, v = Math.floor(+e.target.value || 0);
    if (f === 'n') rows[i].n = Math.max(0, v);
    else if (f === 'l0') rows[i].l0 = Math.min(Math.max(1, v), maxLv(rows[i].t0));
    else if (f === 'l1') rows[i].l1 = Math.min(Math.max(1, v), maxLv(rows[i].t1));
    drawOut();
  });
  el('rows').addEventListener('click', function (e) {
    var b = e.target.closest('.del'); if (!b || rows.length < 2) return;
    rows.splice(+b.closest('.eqrow').dataset.i, 1);
    draw();
  });
  el('b-add').addEventListener('click', function () { rows.push(blank()); draw(); });
  el('b-one').addEventListener('click', function () {
    rows = [{ t0: 1, l0: 1, t1: 10, l1: 70, n: 3 }]; draw();
  });

  function toHash() {
    return rows.map(function (r) { return [r.t0, r.l0, r.t1, r.l1, r.n].join('.'); }).join(',') +
      '|' + own().join('.');
  }
  window.EQSEG = window.EQSEG || {};
  window.EQSEG.level = function () { return 'lv=' + toHash(); };

  function setSeg(seg) {
    var s = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x && x.indexOf('lv=') !== 0;
    });
    s.unshift(seg);
    try {
      history.replaceState(null, '', location.pathname + location.search + '#' + s.join('&'));
    } catch (e) { /* file:// では黙って諦める */ }
  }

  /** `lv=` の中身。**無ければ元の equip-level で覚えていたものを 1 回だけ引き継ぐ**
      （remember.js が `arona-state-/tools/equip-level/` に置いていた。移したら消す——
      残すと「最初に戻す」のあとにまた戻ってくる） */
  function mySeg() {
    var s = location.hash.replace(/^#/, '').split('&');
    for (var i = 0; i < s.length; i++) if (s[i].indexOf('lv=') === 0) return s[i].slice(3);
    var OLD = 'arona-state-/tools/equip-level/';
    try {
      var v = localStorage.getItem(OLD);
      if (v) { localStorage.removeItem(OLD); return v.replace(/^#/, '').split('&')[0]; }
    } catch (e) { /* 読めなければ素の状態から */ }
    return '';
  }

  (function fromHash() {
    /* **`lv=` の区画だけ読む。**`&` で割ってから中身をほどく（先にほどくと、効果の早見の
       検索語に入った `%26` が `&` に戻って割れ目が狂う）。古い equip-level の URL
       （`#T.Lv.T.Lv.1`、`&pane=waste` 付きも）は tools/equip-level/ の転送ページが `lv=` に直して渡す。
       student-cost からの `#pane=level&lv=T.Lv.T.Lv.1`（手持ち無し）もここで 1 行になる */
    var h = mySeg();
    try { h = decodeURIComponent(h); } catch (e) { /* 壊れた %xx はそのまま読む */ }
    var p = h.split('|');
    (p[0] || '').split(',').forEach(function (s) {
      var v = s.split('.').map(Number);
      if (v.length !== 5 || v.some(isNaN)) return;
      var t0 = Math.min(10, Math.max(1, v[0])), t1 = Math.min(10, Math.max(1, v[2]));
      rows.push({ t0: t0, l0: Math.min(Math.max(1, v[1]), maxLv(t0)), t1: Math.max(t0, t1),
                  l1: Math.min(Math.max(1, v[3]), maxLv(Math.max(t0, t1))), n: Math.max(0, v[4]) });
    });
    if (!rows.length) rows = [blank()];
    (p[1] || '').split('.').forEach(function (s, i) {
      var v = Math.floor(+s || 0);
      if (GEMS[i] && v > 0) el('own-' + GEMS[i].id).value = v;
    });
  })();

  draw();
})();
