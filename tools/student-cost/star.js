/* 生徒の育成計算機の「星上げ」の区画（元の tools/eleph/。2026-09-26 にまとめた）。
   data-eleph.js（window.ELEPH）を読む。**生徒は区画の外の欄で選び、index.html の
   `window.SCHUB` が `pick()` で渡してくる。**カード（顔と名前）も SCHUB が描き、
   ここは一言（`note()`）だけ返す。要素の id は、ほかの区画と重ならないよう `e-` を付けた。

   **数え方はまとめる前と 1 行も変えていない。**変えたのは、生徒の受け取り方と、
   ハッシュの読み書き（`e=` の 1 区画。中身は元の形から先頭の生徒 id を外したもの）だけ */
(function () {
  'use strict';
  var E = window.ELEPH;
  var HUB = window.SCHUB;
  var el = function (id) { return document.getElementById('e-' + id); };
  var byId = {};
  E.stu.forEach(function (s) { byId[s.id] = s; });

  var student = null;
  /* **段は 8 つある。**1〜5 が ★1〜★5、6〜8 が 固有2・固有3・固有4。
     ★5 になると固有武器が使えるようになり、その状態が固有1。
     つまり **★5 と固有1 は同じ段**で、そこから先が限界解放（2026-08-30 に
     ブルアカ攻略 Wiki と game8 で裏取りして足した。それまで ★5 で止めていた）。 */
  var MAX = 8;
  var from = 1, to = 5;

  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }

  /** 段の呼び名。★5 だけは固有1 でもあるので両方書く。 */
  function lvName(n, brief) {
    if (n <= 4) return '★' + n;
    if (n === 5) return brief ? '★5' : '★5（固有1）';
    return '固有' + (n - 4);
  }

  /** **段 n → 段 n+1 の 1 手。**前半 4 手が神秘解放、後半 3 手が限界解放。 */
  function stepAt(n) {
    if (n <= 4) {
      var s = E.steps[n - 1];
      return { el: s.el, cr: s.cr, fav: s.fav, kind: 'star', w: null, to: n + 1 };
    }
    var w = E.wsteps[n - 4];        // n=5 → wsteps[1]（固有1→固有2）
    return { el: w.el, cr: w.cr, fav: 0, kind: 'weapon', w: w, to: n + 1 };
  }

  /** 段 a から段 b まで上げるぶんの合計。 */
  function sum(a, b) {
    var t = { el: 0, cr: 0 };
    for (var n = a; n < b; n++) {
      var s = stepAt(n);
      t.el += s.el; t.cr += s.cr;
    }
    return t;
  }

  /* ---- 神名のカケラで買うときの値段（2026-09-26 に足した）
     **値段はその子の文字を今までに買った数（累計）で決まる。**表は data.js の `buy`
     （ba-data の GoodsExcelTable の ConsumeExtraStep / ConsumeExtraAmount）。
     step[i] 個ごとに amt[i] 個で、並びを越えたら最後の値のまま。上限は `lim` 個 */
  var B = E.buy;
  /** k 個目（1 起点）の値段 */
  function priceAt(k) {
    var edge = 0;
    for (var i = 0; i < B.step.length; i++) {
      edge += B.step[i];
      if (k <= edge) return B.amt[i];
    }
    return B.amt[B.amt.length - 1];
  }
  /** 累計 bought 個買った続きから n 個買う。**上限を越えるぶんは買えない**ので `over` に分ける。
      `tiers` は値段ごとの内訳（内訳の帳面に出す） */
  function shardCost(bought, n) {
    var can = Math.max(0, Math.min(n, B.lim - bought));
    var r = { total: 0, got: can, over: n - can, tiers: [] };
    for (var k = bought + 1; k <= bought + can; k++) {
      var pr = priceAt(k), last = r.tiers[r.tiers.length - 1];
      if (last && last.pr === pr) { last.n++; last.b = k; }
      else r.tiers.push({ pr: pr, n: 1, a: k, b: k });
      r.total += pr;
    }
    return r;
  }

  /** その段で解放されるもの 1 行。**生徒によって変わるのは固有3・固有4 だけ。** */
  var TERR_JA = { Street: '市街地', Outdoor: '屋外', Indoor: '屋内' };
  var BULLET_JA = { Explosion: '爆発', Pierce: '貫通', Mystic: '神秘', Sonic: '振動' };
  function weaponGain(w, stu) {
    if (w.gain === 'unlock') return '固有武器が使えるようになります';
    if (w.gain === 'passive') return 'パッシブスキル＋を覚えます';
    if (w.gain === 'adapt') {
      if (!stu || !stu.ad) return '地形適性が上がります';
      return TERR_JA[stu.ad] + 'の適性が ' + (stu.av > 1 ? stu.av + ' 段' : '1 段') + '上がります';
    }
    /* **固有4 のぶんはデータから来る。**`f4` が `MaxCostIncrease` ならコスト上限、
       `Enhance〇〇Rate` なら〇〇の特効。値は 10000 分率 */
    if (!stu || !stu.f4) return 'ストライカーは特効＋10%、スペシャルはコスト上限＋0.5';
    if (stu.f4 === 'MaxCostIncrease') {
      return '部隊のコスト上限が ＋' + (stu.f4v / 10000) + ' されます';
    }
    var bt = stu.f4.replace('Enhance', '').replace('Rate', '');
    return (BULLET_JA[bt] || bt) + 'の特効が ＋' + (stu.f4v / 100) + '% されます';
  }
  /** ★の段。**％は出さない**（2026-09-26 に消した）。変わるのは絆の上限と、★5 の固有武器 */
  function starGain(sp, prevFav) {
    if (sp.to === 5) return '固有武器が使えるようになります／絆ランクの上限 ' + sp.fav;
    if (sp.fav && sp.fav !== prevFav) return 'ステータスが上がります／絆ランクの上限 ' + sp.fav;
    return 'ステータスが上がります';
  }


  /** 段のボタン 8 個。**★が 5 個、そのあとに 固有2・固有3・固有4。**
      押した数がそのまま段になる。★5 と固有1 は同じ段なので、
      ★を 5 個押した状態が「固有1」を意味する。 */
  function stars(box, cur, other, isFrom) {
    var h = '';
    for (var i = 1; i <= MAX; i++) {
      var on = isFrom ? (i <= cur) : (i <= cur && i > other);
      // **初期の星より下は選べない。**★3 の子が ★1 だったことはない
      var dis = isFrom ? !!(student && i < student.s) : (i <= other);
      var lab = i <= 5 ? '★' : '固有' + (i - 4);
      h += '<button type="button" class="star' + (i > 5 ? ' ue' : '') + (on ? ' on' : '') +
           (!isFrom && i <= other ? ' from' : '') + '" data-v="' + i + '"' +
           (dis ? ' disabled' : '') + ' aria-pressed="' + (i === cur) + '"' +
           ' aria-label="' + lvName(i) + '">' + lab + '</button>';
    }
    box.innerHTML = h;
  }

  function num(id, max) {
    var v = Math.max(0, Math.floor(+el(id).value || 0));
    return max ? Math.min(max, v) : v;
  }

  /** 早見表。**値段が全員共通なので、表も全員共通。**段と値段が変わらない限り中身は同じで、
      作るのは 1 回だけ。色だけ draw() のたびに付け直す */
  (function buildQuick() {
    var h = '<tr><th scope="col">今＼目標</th>';
    for (var c = 2; c <= MAX; c++) h += '<th scope="col">' + lvName(c, true) + '</th>';
    el('qh').innerHTML = h + '</tr>';
    var rows = [];
    for (var r = 1; r < MAX; r++) {
      var tr = '<tr><th scope="row">' + lvName(r, true) + '</th>';
      for (var c2 = 2; c2 <= MAX; c2++) {
        if (c2 <= r) { tr += '<td class="nil">—</td>'; continue; }
        var need = sum(r, c2).el, sc = shardCost(0, need);
        tr += '<td data-f="' + r + '" data-t="' + c2 + '"><b>' + fmt(need) + '</b><small>' +
              fmt(sc.total) + (sc.over ? '＋' : '') + '</small></td>';
      }
      rows.push(tr + '</tr>');
    }
    el('qb').innerHTML = rows.join('');
  })();

  /** カードの一言（この区画を開いているとき）。**まとめる前はカードそのものを描いていた** */
  function note() {
    if (!student) return '名前を入れると、必要な神名文字と量が出ます。';
    return '要るのは ' +
      (student.si ? '<img class="ico sm" src="../img/' + student.si + '.webp" alt="" width="18" height="18"> ' : '') +
      '<b>' + student.en + '</b> です。' +
      'この子はゲームで <b>★' + student.s + '</b> から始まります。';
  }

  function draw() {
    stars(el('from-stars'), from, to, true);
    stars(el('to-stars'), to, from, false);

    var t = sum(from, to);
    var have = num('i-have'), bought = num('i-bought', B.lim);
    var left = Math.max(0, t.el - have);
    el('o-eleph').textContent = fmt(t.el) + ' 個';
    el('o-eleph-sub').textContent = lvName(from, true) + ' から ' + lvName(to, true) + ' まで' +
      (student ? '' : '（誰でも同じ）');
    el('o-left').textContent = left ? fmt(left) + ' 個' : '足りています';
    el('o-left-sub').textContent = '手持ち ' + fmt(have) + ' 個を引いて';
    el('o-credit').textContent = fmt(t.cr);

    // カケラ。**交換所に並んでいない子（`ns`）は買えない**（2026-09-26 時点で 0 人）
    var sc = shardCost(bought, left), led = [];
    if (student && student.ns) {
      el('o-shard').textContent = '—';
      el('o-shard-sub').textContent = 'この子はカケラでは買えません';
      led.push('<div class="row"><span>この子の文字はショップに並んでいません</span><span>—</span></div>');
    } else if (!left) {
      el('o-shard').textContent = '0 個';
      el('o-shard-sub').textContent = '買わなくて足ります';
      led.push('<div class="row"><span>買うぶんはありません</span><span>0 個</span></div>');
    } else {
      el('o-shard').textContent = fmt(sc.total) + ' 個';
      el('o-shard-sub').textContent = sc.over
        ? '上限 ' + fmt(B.lim) + ' 個まで。あと ' + fmt(sc.over) + ' 個は買えません'
        : (bought ? '累計 ' + fmt(bought) + ' 個買った続きから ' : '') + fmt(left) + ' 個ぶん';
      sc.tiers.forEach(function (x) {
        led.push('<div class="row"><span>' + fmt(x.a) + '〜' + fmt(x.b) + ' 個目<span class="subnote">1 個あたり ' +
                 x.pr + ' カケラ × ' + fmt(x.n) + '</span></span><span>' + fmt(x.pr * x.n) + ' 個</span></div>');
      });
      if (sc.over) {
        led.push('<div class="row over"><span>上限 ' + fmt(B.lim) + ' 個を越えるぶん<span class="subnote">カケラでは買えません</span></span>' +
                 '<span>' + fmt(sc.over) + ' 文字</span></div>');
      }
      led.push('<div class="row total"><span>カケラの合計</span><span>' + fmt(sc.total) + ' 個</span></div>');
    }
    el('shard-ledger').innerHTML = led.join('');

    // 段ごとの中身。**7 手ぶん。**前半 4 手が神秘解放、後半 3 手が限界解放
    var rowsH = [], prevFav = E.fav1;
    for (var n = 1; n < MAX; n++) {
      var sp = stepAt(n), cum = sum(1, n + 1);
      var cls = (n + 1 <= from) ? ' done' : (n + 1 <= to && n >= from ? ' use' : '');
      var up = sp.kind === 'star'
        ? '<b>' + starGain(sp, prevFav) + '</b>'
        : '<b>' + weaponGain(sp.w, student) + '</b>／固有武器のレベル上限 <b>' + sp.w.lv + '</b>';
      if (sp.fav) prevFav = sp.fav;
      rowsH.push('<div class="starstep' + cls + (sp.kind === 'weapon' ? ' ue' : '') + '">' +
        '<span class="to">' + lvName(n, true) + '→' + lvName(n + 1, true) + '</span>' +
        '<span class="cost">' +
        (student && student.si && sp.el ? '<img class="ico sm" src="../img/' + student.si + '.webp" alt="" width="18" height="18" loading="lazy"> ' : '') +
        fmt(sp.el) + ' 個<small>クレジット ' + fmt(sp.cr) +
        '／累計 ' + fmt(cum.el) + ' 個</small></span>' +
        '<span class="up">' + up + '</span>' +
        '</div>');
    }
    el('starsteps').innerHTML = rowsH.join('');

    // 早見表の「いま」のマス
    var cells = el('qb').querySelectorAll('td[data-f]');
    for (var q = 0; q < cells.length; q++) {
      cells[q].classList.toggle('here', +cells[q].dataset.f === from && +cells[q].dataset.t === to);
    }

    // **ハッシュは自分で書かない**（元は location.replace で丸ごと書き直していた）。
    // ほかの区画の `t=` や `p=` を消してしまうので、SCHUB にまとめて書かせる
    HUB.changed('star');
  }

  /* **ハッシュの `e=` は `今|目標|手持ち||累計購入数`。**元の eleph の
     `生徒id|今|目標|手持ち||累計購入数` から、先頭の生徒 id を区画の外の `s=` へ出したもの。
     5 番目は空けておく。2026-09-26 までは `生徒id|今|目標|手持ち|1 週間の見込み` で、その欄を消した。
     **古い URL もそのまま開ける**よう、5 番目は読まずに捨て、累計購入数は 6 番目に置く
     （5 番目に入れると、古い URL の「週 20」が「20 個買った」に化ける）。
     /tools/eleph/ の転送ページが、元の形を `s=` と `e=` に組み替えて渡してくる */
  function seg() {
    return from + '|' + to + '|' + num('i-have') + '||' + num('i-bought', B.lim);
  }

  /** 生徒を選ぶ（区画の外の欄から Id で来る）。0 なら選んでいないことにする */
  function pick(id) {
    var hit = byId[id] || null;
    if (hit === student) return;
    student = hit;
    if (!hit) { draw(); return; }
    // **その生徒の初期の星に合わせる。**★3 の子を ★1 から数えても意味がない
    if (from < hit.s) from = hit.s;
    if (to < from) to = Math.max(5, from);
    draw();
  }

  ['i-have', 'i-bought'].forEach(function (id) {
    el(id).addEventListener('input', draw);
  });
  el('from-stars').addEventListener('click', function (e) {
    var b = e.target.closest('.star'); if (!b || b.disabled) return;
    from = +b.dataset.v; if (to < from) to = from;
    draw();
  });
  el('to-stars').addEventListener('click', function (e) {
    var b = e.target.closest('.star'); if (!b || b.disabled) return;
    to = +b.dataset.v; draw();
  });
  // 早見表のマスを押すと、その段に合わせる
  el('qb').addEventListener('click', function (e) {
    var c = e.target.closest('td[data-f]'); if (!c) return;
    var f = +c.dataset.f;
    if (student && f < student.s) return;       // その子にはありえない段
    from = f; to = +c.dataset.t; draw();
  });

  (function fromHash() {
    var h = HUB.seg.e;
    /* **`e=` が無くても生徒だけは来る**（ほかの区画で選んだ子）。そのときは
       まとめる前に名前の欄で選んだのと同じ動き（初期の星に合わせる） */
    if (!h) { if (byId[HUB.sid]) pick(HUB.sid); return; }
    // **古い形のまま読む。**先頭に生徒 id の欄を戻して、添字をまとめる前と揃える
    var p = [String(HUB.sid || '')].concat(h.split('|'));
    if (p[0] && byId[p[0]]) { student = byId[p[0]]; }
    if (+p[1] >= 1 && +p[1] <= MAX) from = +p[1];
    if (+p[2] >= 1 && +p[2] <= MAX) to = +p[2];
    if (student && from < student.s) from = student.s;
    if (to < from) to = from;
    if (p[3] !== undefined) el('i-have').value = Math.max(0, +p[3] || 0);
    // p[4] は古い形の「1 週間の見込み」。**読まない**
    if (p[5] !== undefined) el('i-bought').value = Math.min(B.lim, Math.max(0, Math.floor(+p[5] || 0)));
  })();

  el('src-n').textContent = E.stu.length;
  el('src-n2').textContent = E.stu.length;
  el('src-step').textContent = '[' + B.step.join(', ') + ']';
  el('src-amt').textContent = '[' + B.amt.join(', ') + ']';
  el('src-lim').textContent = fmt(B.lim);
  el('i-bought').max = B.lim;
  // **人数は data.js から数える。**手で書くと、生徒が増えた日に古いまま残る
  // （2026-09-24 に 247 / 187 / 87 のべた書きを見つけて直した）。
  (function fillCounts() {
    var av1 = 0, av2 = 0, main = 0, sup = 0;
    for (var i = 0; i < E.stu.length; i++) {
      var s = E.stu[i];
      if (s.av === 2) av2++; else if (s.av === 1) av1++;
      if (s.sq === 'Support') sup++; else main++;
    }
    var set = function (id, v) { var e = el(id); if (e) e.textContent = v; };
    set('src-av1', av1); set('src-av2', av2);
    set('src-main', main); set('src-sup', sup); set('src-n3', E.stu.length);
  })();
  el('ver').textContent = E.fetched;

  /* ---- 区画の外（index.html の SCHUB）へ渡す口 */
  HUB.add('star', {
    pick: pick,
    note: note,
    seg: seg,
    /** 総額の区画の「星」の行から。**段 1〜5 が★1〜★5**（まとめる前の ../eleph/#id|今|目標 と同じ） */
    set: function (f, t) {
      if (f >= 1 && f <= MAX) from = f;
      if (t >= 1 && t <= MAX) to = t;
      if (student && from < student.s) from = student.s;
      if (to < from) to = from;
      draw();
    }
  });
  draw();
})();
