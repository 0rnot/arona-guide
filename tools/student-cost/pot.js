/* 生徒の育成計算機の「潜在」の区画（元の tools/potential/。2026-09-26 にまとめた）。
   data-pot.js（window.POT）を読む。**生徒は区画の外の欄で選び、index.html の
   `window.SCHUB` が `pick()` で渡してくる。**カード（顔と名前）も SCHUB が描き、
   ここは一言（`note()`）だけ返す。要素の id は、ほかの区画と重ならないよう `p-` を付けた。

   **数え方はまとめる前と 1 行も変えていない。**変えたのは、生徒の受け取り方と、
   ハッシュの読み書き（`p=` の 1 区画。中身は元の形から先頭の生徒 id を外したもの）、
   それと総額の区画へ今 → 目標の合計を渡す `total()` */
(function () {
  'use strict';
  var P = window.POT;
  var HUB = window.SCHUB;
  var el = function (id) { return document.getElementById('p-' + id); };
  var KEYS = ['MaxHP', 'AttackPower', 'HealPower'];
  var byId = {};
  P.stu.forEach(function (s) { byId[s.id] = s; });

  var student = null;
  var cur = [0, 0, 0], goal = [P.max, P.max, 0];

  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  /** 1 段あたりの伸びは端数が出る（攻撃力 1,590 なら 3.18）。**丸めて 3 と書くと
      25 段で 75 に見えて、目標までの 80 と食い違う**ので小数 1 桁まで出す */
  function fmt1(n) { return n.toLocaleString('ja-JP', { maximumFractionDigits: 1 }); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  /** **P.steps[i] は「i 段目 → i+1 段目」。**a から b へは i = a … b-1 を足す。 */
  function need(a, b) {
    var t = { a0: 0, a1: 0, bk: 0, cr: 0 };
    for (var i = a; i < b; i++) {
      var s = P.steps[i]; if (!s) continue;
      if (s.g === 0) t.a0 += s.an; else t.a1 += s.an;
      t.bk += s.bk; t.cr += s.cr;
    }
    return t;
  }

  /** 基礎値。**SchaleDB と同じ結び方。**★の倍率は掛けない。 */
  function base(pair, lv) {
    var i = +(((lv - 1) / 99).toFixed(4));
    return Math.round(pair[0] + (pair[1] - pair[0]) * i);
  }
  function bonusAt(pair, lv, step) { return Math.round(base(pair, P.openLv) * (step * 0.002)); }

  function total() {
    var t = { a0: 0, a1: 0, cr: 0, bk: [0, 0, 0] };
    for (var k = 0; k < 3; k++) {
      var n = need(cur[k], goal[k]);
      t.a0 += n.a0; t.a1 += n.a1; t.cr += n.cr; t.bk[k] = n.bk;
    }
    return t;
  }

  (function fill() {
    el('lead-max').textContent = P.max;
    el('lead-lv').textContent = P.openLv;
    el('src-n').textContent = fmt(P.checked);
    el('src-s').textContent = P.stu.length;
    el('src-un').textContent = P.stu.filter(function (s) { return s.un[2]; }).length;
    el('ver').textContent = P.fetched;

    // 段ごとの表。**中身は生徒に依らない**ので一度だけ組む。
    // **同じ中身が続く区間はまとめる。**25 行そのまま並べるとスマホで画面 3 枚ぶんになり、
    // しかも 5 段ずつ全く同じ値が続くので読むところが無い（2026-08-30 に実物を見て畳んだ）
    // **累計はその行で使う品目のぶんだけ。**欠片は 15 段で使い切り、壊れたほうは
    // 16 段目からなので、もう片方は 0 か使い切った数にしかならない
    var c0 = 0, c1 = 0, rows = [], run = null;
    var flush = function () {
      if (!run) return;
      var g0 = run.s.g === 0;
      rows.push('<tr><td>' + run.a + '→' + run.b + '</td>' +
        '<td>' + (g0 ? '欠片' : '壊れた') + ' ' + run.s.an + ' 個' +
        '<small>累計 ' + fmt(g0 ? run.c0 : run.c1) + '</small></td>' +
        '<td>' + run.s.bk + ' 冊</td>' +
        '<td>' + fmt(run.s.cr) + '</td></tr>');
      run = null;
    };
    P.steps.forEach(function (s, i) {
      var same = run && run.s.g === s.g && run.s.an === s.an && run.s.bk === s.bk && run.s.cr === s.cr;
      if (!same) { flush(); run = { a: i, s: s }; }
      if (s.g === 0) c0 += s.an; else c1 += s.an;
      run.b = i + 1; run.c0 = c0; run.c1 = c1;
    });
    flush();
    el('tb').innerHTML = rows.join('');
  })();

  /* **入れ物は組み直さない。値だけ合わせる。**
     毎回 `innerHTML` を書き換えていたら、選んだ直後に焦点が飛んで
     キーボードで続けて操作できなかった（2026-08-30 に実物で踏んだ）。
     組み直すのは「この子には不要」の印が変わったときだけ。 */
  var rowsKey = null;
  function drawRows() {
    var key = student ? student.un.join(',') : 'none';
    if (rowsKey !== key) {
      var h = '';
      for (var k = 0; k < 3; k++) {
        var off = student && student.un[k];
        var o = '';
        for (var v = 0; v <= P.max; v++) o += '<option value="' + v + '">' + v + '</option>';
        h += '<div class="potrow' + (off ? ' off' : '') + '">' +
          '<span class="nm">' + P.statJa[KEYS[k]] +
          (off ? '<span class="badge">この子には不要</span>' : '') +
          '<small>' + P.books[KEYS[k]].n + 'を使います</small></span>' +
          '<select data-c="' + k + '" aria-label="' + P.statJa[KEYS[k]] + 'の今の段">' + o + '</select>' +
          '<select data-g="' + k + '" aria-label="' + P.statJa[KEYS[k]] + 'の目標の段">' + o + '</select>' +
          '</div>';
      }
      el('potsteps').innerHTML = h;
      rowsKey = key;
    }
    for (var i = 0; i < 3; i++) {
      el('potsteps').querySelector('[data-c="' + i + '"]').value = cur[i];
      el('potsteps').querySelector('[data-g="' + i + '"]').value = goal[i];
    }
  }

  /* **伸びは枠ごとに「1 段あたり」と「目標まで（今より）」の 2 つ。**
     「目標の段で合計いくつ」だけだと、1 段開けるとどれだけ違うのかが読めなかった
     （2026-09-26 の先生の判断 Q4-1）。基礎値は丸の i へ畳んだ */
  function drawGrowth() {
    var h = '<span class="h"></span><span class="h">1 段あたり</span><span class="h">目標まで（今より）</span>';
    for (var k = 0; k < 3; k++) {
      var per = '<span class="mute">—</span>', up = per;
      if (student) {
        per = '＋' + fmt1(base(student.b[k], P.openLv) * P.rate / 10000);
        up = '＋' + fmt(bonusAt(student.b[k], P.openLv, goal[k]) - bonusAt(student.b[k], P.openLv, cur[k]));
      }
      h += '<span>' + P.statJa[KEYS[k]] + '<span class="subnote">' + cur[k] + '→' + goal[k] + ' 段（＋' +
        ((goal[k] - cur[k]) * P.rate / 100).toFixed(1).replace(/\.0$/, '') + '%）</span></span>' +
        '<span>' + per + '</span><span>' + up + '</span>';
    }
    el('growth').innerHTML = h;
    el('growth-qm').setAttribute('data-hint', student
      ? 'Lv' + P.openLv + 'の基礎値は ' + KEYS.map(function (k, i) {
          return P.statJa[k] + ' ' + fmt(base(student.b[i], P.openLv));
        }).join('／') + '。★の倍率が掛かる前の値から数えています（SchaleDBと同じ数え方）。'
      : '★の倍率が掛かる前の基礎値から数えています（SchaleDBと同じ数え方）。生徒を選ぶと実数が出ます。');
  }

  /* **手持ちの欄は一度だけ組む。**入力のたびに `innerHTML` を書き換えると、
     打っている最中に入力欄そのものが作り直されて焦点も途中の文字も飛ぶ
     （2026-08-30 に実物で踏んだ）。以降は名前と「あと何個」だけ書き換える。 */
  // **応用 WB は枠ごとに別のアイテム。**応用体育（2000）・応用射撃（2001）・
  // 応用衛生（2002）で、互いに融通できない。3 つを 1 つの欄で足していたので、
  // 片方が 0 でも「足りています」と出ていた（2026-09-24 に直した）。
  var HAVE = [
    { id: 'h-a0', ph: '持っている欠片の数' },
    { id: 'h-a1', ph: '持っている壊れたオーパーツの数' },
    { id: 'h-bk0', ph: '持っている' + P.books[KEYS[0]].n + ' の数' },
    { id: 'h-bk1', ph: '持っている' + P.books[KEYS[1]].n + ' の数' },
    { id: 'h-bk2', ph: '持っている' + P.books[KEYS[2]].n + ' の数' }
  ];
  (function buildHave() {
    el('have').innerHTML = HAVE.map(function (x) {
      // id は区画の頭の `p-` 付き（el() が付けて引く）
      return '<div class="row"><span><b id="p-' + x.id + '-k"></b>' +
        '<span class="subnote" id="p-' + x.id + '-s"></span></span>' +
        '<span><input id="p-' + x.id + '" type="number" inputmode="numeric" min="0" step="1" value="0" ' +
        'aria-label="' + x.ph + '" style="width:92px;text-align:right;padding:.3em .5em"></span></div>';
    }).join('');
    HAVE.forEach(function (x) { el(x.id).addEventListener('input', draw); });
  })();
  function haveOf(id) { return Math.max(0, +el(id).value || 0); }
  function drawHave(t) {
    var names = [
      student ? P.arts[student.a].a.n : 'オーパーツの欠片',
      student ? P.arts[student.a].b.n : '壊れたオーパーツ',
      P.books[KEYS[0]].n, P.books[KEYS[1]].n, P.books[KEYS[2]].n
    ];
    var needs = [t.a0, t.a1, t.bk[0], t.bk[1], t.bk[2]];
    HAVE.forEach(function (x, i) {
      var left = Math.max(0, needs[i] - haveOf(x.id));
      el(x.id + '-k').textContent = names[i];
      el(x.id + '-s').textContent = '要る ' + fmt(needs[i]) + ' 個' +
        (left ? '／あと ' + fmt(left) + ' 個' : needs[i] ? '／足りています' : '');
    });
  }

  /** カードの一言（この区画を開いているとき）。**まとめる前はカードそのものを描いていた** */
  function note() {
    if (!student) return '名前を入れると、要るオーパーツの名前が出ます。';
    var a = P.arts[student.a];
    return '使うのは <b>' + esc(a.a.n) + '</b> と <b>' + esc(a.b.n) + '</b>。' +
      student.sc + '／' + student.ro + '。<b>Lv' + P.openLv + '</b> になってから開けます。';
  }

  function draw() {
    var t = total();
    var A = student ? P.arts[student.a] : null;
    el('o-art').innerHTML =
      item(A && A.a.i, A ? A.a.n : 'オーパーツの欠片', t.a0, '個') +
      item(A && A.b.i, A ? A.b.n : '壊れたオーパーツ', t.a1, '個');
    el('o-book').innerHTML = KEYS.map(function (k, i) {
      return item(P.books[k].i, P.books[k].n, t.bk[i], '冊');
    }).join('');
    el('o-credit').textContent = fmt(t.cr);
    /* **素材の逆引きの「誰が使う」へ、欠片そのものを渡す。**あちらの `m=` はアイコン名でも受けて
       1 段の素材に直す（tools/farm/ の MATHUB の resolve()）。2026-09-26 まで ../oopart/ へ
       `#oopart|系統` で飛んでいたもの（oopart は farm の区画にまとめた） */
    el('to-oopart').href = '../farm/#' + (A ? 'm=' + A.a.i + '&' : '') + 'pane=use';
    el('to-oopart').textContent = A ? A.c + 'を使う生徒を見る →' : 'オーパーツから生徒を引く →';

    drawRows();
    drawGrowth();
    drawHave(t);

    var needAll = t.a0 + t.a1;
    // **品目ごとに足りているぶんだけ数える。**単純に足すと、欠片だけ大量に
    // 持っている人が 100% に見える（壊れたオーパーツが 0 でも）。
    // **文には品目ごとの数を出す。**「要る 885 個」と合計を書くと、別のアイテムを
    // 足した数になって何を集めればいいか読めない（2026-09-26）
    var h0 = Math.min(haveOf('h-a0'), t.a0), h1 = Math.min(haveOf('h-a1'), t.a1);
    var p = needAll ? Math.min(100, (h0 + h1) / needAll * 100) : 100;
    el('bar').style.width = p.toFixed(1) + '%';
    el('barnote').textContent = needAll
      ? 'オーパーツは ' + p.toFixed(0) + '% 揃っています（欠片 ' + fmt(h0) + '／' + fmt(t.a0) +
        '、壊れた ' + fmt(h1) + '／' + fmt(t.a1) + '）'
      : '今の段と目標が同じなので、何も要りません。';

    // **ハッシュは自分で書かない**（元は location.replace で丸ごと書き直していた）。
    // ほかの区画の `t=` や `e=` を消してしまうので、SCHUB にまとめて書かせる
    HUB.changed('pot');
  }

  /** 要るものの 1 行。アイコンが無い（生徒を選ぶ前の）ときは名前だけ */
  function item(icon, name, n, unit) {
    return '<div class="it' + (n ? '' : ' zero') + '">' +
      (icon ? '<img src="../img/' + icon + '.webp" alt="" width="30" height="30" loading="lazy">' : '') +
      '<span class="n">' + esc(name) + '</span>' +
      '<span class="c">' + fmt(n) + '<small>' + unit + '</small></span></div>';
  }

  /* **ハッシュの `p=` は `今|目標|欠片|壊れた|WB×3`**（今と目標は枠 3 つを `,` で）。
     元の potential の `生徒id|今|目標|…` から、先頭の生徒 id を区画の外の `s=` へ出したもの。
     /tools/potential/ の転送ページが、元の形を `s=` と `p=` に組み替えて渡してくる */
  function seg() {
    return cur.join(',') + '|' + goal.join(',') + '|' +
      HAVE.map(function (x) { return haveOf(x.id); }).join('|');
  }

  /** 生徒を選ぶ（区画の外の欄から Id で来る）。0 なら選んでいないことにする */
  function pick(id) {
    var hit = byId[id] || null;
    if (hit === student) return;
    student = hit;
    draw();
  }
  el('potsteps').addEventListener('change', function (e) {
    var s = e.target.closest('select'); if (!s) return;
    if (s.dataset.c !== undefined) {
      cur[+s.dataset.c] = +s.value;
      if (goal[+s.dataset.c] < cur[+s.dataset.c]) goal[+s.dataset.c] = cur[+s.dataset.c];
    } else {
      goal[+s.dataset.g] = +s.value;
      if (cur[+s.dataset.g] > goal[+s.dataset.g]) cur[+s.dataset.g] = goal[+s.dataset.g];
    }
    draw();
  });
  el('b-max').addEventListener('click', function () { goal = [P.max, P.max, P.max]; draw(); });
  el('b-atk').addEventListener('click', function () { goal = [0, P.max, 0]; draw(); });
  /* **「戻す」は開いた直後の状態へ。**全部 0 にすると「何も要りません」の
     空の答えで止まってしまう（2026-08-31 に実物で確認）。既定と同じ
     「HP と攻撃力を最大まで」に戻す */
  el('b-reset').addEventListener('click', function () { cur = [0, 0, 0]; goal = [P.max, P.max, 0]; draw(); });

  (function fromHash() {
    // 生徒は区画の外（`s=`）。`p=` が無くても、生徒だけは選んでおく
    if (byId[HUB.sid]) student = byId[HUB.sid];
    var h = HUB.seg.p;
    if (!h) return;
    // **古い形のまま読む。**先頭に生徒 id の欄を戻して、添字をまとめる前と揃える
    var p = [String(HUB.sid || '')].concat(h.split('|'));
    if (p[0] && byId[p[0]]) { student = byId[p[0]]; }
    var read = function (s, into) {
      if (!s) return;
      s.split(',').forEach(function (v, i) {
        var n = parseInt(v, 10);
        if (i < 3 && n >= 0 && n <= P.max) into[i] = n;
      });
    };
    read(p[1], cur); read(p[2], goal);
    for (var k = 0; k < 3; k++) { if (goal[k] < cur[k]) goal[k] = cur[k]; }
    /* **手持ちは 5 欄**（欠片・壊れた・応用 WB 3 種）。2026-09-24 に WB を 3 欄に分けたとき
       ここと toHash が `h-bk` 1 欄のままで、draw() が毎回落ちていた（2026-09-26 に発見）。
       それより前の URL は `id|今|目標|欠片|壊れた|WB合計[|オーパーツ]` の形で、
       WB 合計はどの欄に入れるか決められないので読まない。
       オーパーツは数字の欄と見分けるため、先頭に `a` を付けて置いていた */
    /* **オーパーツの欄は読み捨てる。**「オーパーツから引く」欄を消して oopart へ
       飛ぶ形にしたので（2026-09-26）、画面に効く先が無い。書き出しもやめたが、
       古い共有 URL の数字の欄がずれないよう、末尾にあれば外してから読む */
    var last = p[p.length - 1] || '';
    if (last.charAt(0) === 'a' && P.arts[last.slice(1)]) p.pop();
    else if (p.length === 7 && P.arts[last]) p.pop();
    var n = p.length >= 3 + HAVE.length ? HAVE.length : 2;
    for (var j = 0; j < n; j++) {
      var v = parseInt(p[3 + j], 10);
      if (v > 0) el(HAVE[j].id).value = v;
    }
  })();

  /* ---- 総額の区画へ渡す合計。**応用 WB は COST（data.js）の素材に無い**ので、
     ここで `C.mat` に 3 行足す（Id は WB そのもの。k: 'wb' で「応用WB」の見出しに入る） */
  var C = window.COST;
  var bkId = KEYS.map(function (k) { return P.books[k].id; });
  if (C && C.mat) {
    KEYS.forEach(function (k, i) {
      if (!C.mat[bkId[i]]) C.mat[bkId[i]] = { n: P.books[k].n, i: P.books[k].i, s: 0, k: 'wb', t: i };
    });
  }
  var ABBR = ['HP', '攻撃', '治癒'];
  function totalOut() {
    var t = total();
    t.art = student ? student.a : 0;
    t.bkId = bkId;
    var r = [];
    for (var k = 0; k < 3; k++) if (goal[k] > cur[k]) r.push(ABBR[k] + ' ' + cur[k] + '→' + goal[k]);
    t.label = r.length ? r.join('・') : '上げる枠がありません';
    return t;
  }

  /* ---- 区画の外（index.html の SCHUB）へ渡す口 */
  HUB.add('pot', { pick: pick, note: note, seg: seg, total: totalOut });
  draw();
})();
