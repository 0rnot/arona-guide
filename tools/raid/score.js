/* 総力戦の「スコア」の区画。**元は tools/raid-score/ の 1 本だった**（2026-09-26 に
   「総力戦」1 本へまとめた。grill-me Q12-1）。

   **ボスと難易度はページ先頭の選択（`window.RAID_PICKER`）が持つ。**
   ここはもうボスの一覧も難易度の欄も持たない。選ばれている相手を
   `RSCORE.rows` の行（種類・ボスの番号 `id`・難易度）に引き当てて計算するだけ。
   ボス情報は `HardCore`、スコアのデータは `Hardcore` と綴りが揃っていないので、
   難易度は小文字にして比べる。

   URL の区画は `rs=~~~凸数~入れ方~凸ごとの秒（_区切り）~HP~目標`。
   **頭の 3 つ（種類・ボス・難易度）は空のまま書く。**元の
   `rs=raid~Hieronymus~Torment~…` の形は、ページの読み込み時に
   先頭の選択（`rb=`）へ移してある（index.html の「古い URL を直す」）。
   形を変えないのは、古いリンクを同じ添字のまま読めるようにするため。 */
(function () {
  'use strict';
  var R = window.RSCORE, P = window.RAID_PICKER;
  if (!R || !P) return;
  var el = function (id) { return document.getElementById(id); };
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /** 秒を M:SS.S の形に。**タイムは分と秒で読むもの。** */
  function clock(sec) {
    var m = Math.floor(sec / 60), r = sec - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + (Math.round(r * 10) / 10).toFixed(1);
  }

  var hp = 100;
  var KIND_JA = { raid: '総力戦', elim: '大決戦', multi: '制約解除決戦' };

  /** 先頭の選択に当たる行。**無ければ null**（制約解除決戦、大決戦に出ないボス） */
  function row() {
    var st = P.get();
    if (st.kind !== 'raid' && st.kind !== 'elim') return null;
    var id = +String(st.b).slice(1), d = String(st.d || '').toLowerCase();
    return R.rows.filter(function (r) {
      return r.k === st.kind && r.id === id && String(r.d).toLowerCase() === d;
    })[0] || null;
  }

  /** そのタイムのスコア。**時間ぶんは 0 より下には行かない。**
      HP を削りきれなかったときは、クリアぶんが入らず HP ぶんだけになる。
      `sec` は**部隊をまたいだ合計**の戦闘時間。 */
  function scoreAt(r, sec, hpPct) {
    var hpPart = r.hp * (hpPct / 100);
    if (hpPct < 100) return { total: hpPart, clear: 0, hp: hpPart, time: 0, killed: false };
    var timePart = Math.max(0, r.mx - sec * r.ps);
    return { total: r.cl + hpPart + timePart, clear: r.cl, hp: hpPart, time: timePart, killed: true };
  }

  (function buildHp() {
    var h = '';
    for (var v = 100; v >= 5; v -= 5) {
      h += '<option value="' + v + '"' + (v === 100 ? ' selected' : '') + '>' +
        (v === 100 ? '倒しきった（100%）' : v + ' %') + '</option>';
    }
    el('i-hp').innerHTML = h;
  })();

  /* ---------- 凸ごとのタイム

     **時間ぶんは「部隊をまたいだ合計の戦闘時間」で決まる。**倒しきれなかった回は
     ふつう時間切れなので、初期値をその難易度の制限時間にしてある。
     最後の 1 回だけは「経過」でも「残り」でも入れられる（残り ＝ 制限時間 − 経過）。 */
  var turns = 1, tmode = 'clear';
  var times = [90];                   // 凸ごとの経過秒。最後が倒した回
  /* **凸は好きなだけ足せる。**上限を 30 にしてあるのは、URL に入る長さと、
     合計 60 分（時間ぶんが 0 になる点）を超えたら数える意味が無くなるため
     （2026-08-31 の先生の指示「+で無制限に追加できるようにしたほうがいい」） */
  var MAX_TURNS = 30;

  function drawTimes() {
    var r = row(); if (!r) return;
    while (times.length < turns) times.splice(times.length - 1, 0, r.du);
    while (times.length > turns) times.splice(times.length - 2, 1);
    var h = '';
    for (var i = 0; i < turns; i++) {
      var last = i === turns - 1;
      var v = times[i];
      var show = (last && tmode === 'left') ? Math.max(0, r.du - v) : v;
      var mm = Math.floor(show / 60), ss = Math.round((show - mm * 60) * 10) / 10;
      h += '<div class="timein' + (last ? ' last' : '') + '" data-i="' + i + '">' +
        '<span class="lb">' + (i + 1) + ' 凸目</span>' +
        '<span>分</span><input type="number" inputmode="numeric" min="0" max="60" step="1" ' +
        'data-k="m" data-i="' + i + '" value="' + mm + '" aria-label="' + (i + 1) + ' 凸目の分">' +
        '<span>秒</span><input type="number" inputmode="decimal" min="0" max="59.9" step="0.1" ' +
        'data-k="s" data-i="' + i + '" value="' + ss + '" aria-label="' + (i + 1) + ' 凸目の秒">' +
        '<span class="note">' + (last
          ? (tmode === 'left' ? '倒したときの<b>残り</b>タイム' : '倒すまでの<b>経過</b>タイム')
          : '倒しきれず時間切れ（' + clock(r.du) + '）') + '</span>' +
        // **1 凸のときは外すボタンを出さない。**押しても何も起きない札は置かない
        (turns > 1
          ? '<button type="button" class="del" data-del="' + i + '" aria-label="' +
            (i + 1) + ' 凸目を外す">✕</button>'
          : '<span class="delslot"></span>') + '</div>';
    }
    el('times').innerHTML = h;
    el('turn-n').textContent = turns + ' 凸ぶん。合計の戦闘時間で時間ぶんが減ります';
  }

  function secs() {
    var t = 0;
    for (var i = 0; i < turns; i++) t += Math.max(0, times[i] || 0);
    return t;
  }

  function draw() {
    var r = row();
    var st = P.get();
    /* **この相手のスコアが無いときは、入力ごと伏せて一言だけ。**
       制約解除決戦はスコアの表を読んでいない。大決戦に出ていないボス
       （イェソド・ドラム缶ガニ）も行が無い */
    el('rs-body').hidden = !r;
    el('rs-none').hidden = !!r;
    if (!r) {
      el('rs-none').innerHTML = '<b>' + esc(KIND_JA[st.kind] || '') + 'のこの相手は、スコアのデータがありません。</b>' +
        (st.kind === 'multi' ? '制約解除決戦のスコアは扱っていません。上で総力戦か大決戦を選んでください。'
                             : '大決戦に出ていないボスです。上で総力戦に切り替えてください。');
      el('rs-lead').textContent = '';
      syncHash();
      return;
    }
    var sec = secs();
    hp = parseInt(el('i-hp').value, 10) || 100;
    var sc = scoreAt(r, sec, hp);
    var lo = r.cl + r.hp, hi = lo + r.mx;

    el('t-total').innerHTML = '合計 ' + clock(sec) +
      '<small>時間ぶんは 1 秒あたり ' + fmt(r.ps) + ' 点。合計 ' + (R.span / 60) +
      ' 分で 0 になります</small>';
    var over = sec > R.span;
    el('rs-err').hidden = !over;
    if (over) {
      el('rs-err').textContent = '合計 ' + (R.span / 60) + ' 分を超えると、時間ぶんは 0 のままです。';
    }

    el('o-score').innerHTML = fmt(sc.total) + '<small> 点</small>';
    el('o-score-sub').textContent = sc.killed
      ? 'いちばん高いときとの差は ' + fmt(hi - sc.total) + ' 点'
      : '倒しきっていないので、クリアぶんと時間ぶんは入りません';
    el('o-lo').innerHTML = fmt(lo) + '<small> 点</small>';
    el('o-hi').innerHTML = fmt(hi) + '<small> 点</small>';

    el('ledger').innerHTML = [
      ['倒したぶん', sc.clear, r.cl],
      ['HP を削ったぶん', sc.hp, r.hp],
      ['時間ぶん', sc.time, r.mx]
    ].map(function (x) {
      return '<div class="row"><span>' + x[0] +
        '<span class="subnote">満額 ' + fmt(x[2]) + '</span></span><span>' + fmt(x[1]) + '</span></div>';
    }).join('') +
      '<div class="row total"><span>合計</span><span>' + fmt(sc.total) + ' 点</span></div>';

    drawGauge(r, sec, sc, lo, hi);
    drawTable(r, sec);

    el('goal-note').textContent = fmt(lo) + ' 〜 ' + fmt(hi) + ' 点のあいだで入れてください';
    drawGoal(r, lo, hi);
    el('rs-lead').innerHTML = '<b>' + esc(KIND_JA[r.k]) + '・' + esc(r.n) + '（' + esc(R.diffJa[r.d] || r.d) +
      '）</b>は 1 戦 ' + r.du + ' 秒。' +
      '<button type="button" class="qm" data-hint="ボスと難易度は上の選択のものです。地形と装甲はスコアに関係しません。"></button>';
    syncHash();
  }

  /* 目盛り。**現実に届く範囲の中で、どこに居るか。**

     理屈の下限（合計 60 分）まで目盛りを伸ばすと、どんなタイムでも右端に
     張り付いて何も分からない。**その凸数で使いきれる時間**（制限時間 × 凸数）
     から 0 秒までを幅いっぱいに取る（2026-08-30）。 */
  function drawGauge(r, sec, sc, lo, hi) {
    var W = 720, H = 64, L = 8, Rr = 8, BH = 22, TOP = 10;
    var top = Math.max(r.du * turns, sec);              // 目盛りの左端にあたる秒数
    var g0 = r.cl + r.hp + Math.max(0, r.mx - top * r.ps);   // その秒数のスコア
    var g1 = r.cl + r.hp + r.mx;                             // 0 秒のスコア
    var w = (W - L - Rr);
    var p = Math.max(0, Math.min(1, (sc.total - g0) / (g1 - g0 || 1)));
    var g = '<rect class="track" x="' + L + '" y="' + TOP + '" width="' + w + '" height="' + BH + '" rx="6"></rect>' +
      '<rect class="fill" x="' + L + '" y="' + TOP + '" width="' + (w * p).toFixed(1) + '" height="' + BH + '" rx="6"></rect>';
    var step = top <= 360 ? 60 : top <= 900 ? 120 : 300;
    for (var t = 0; t <= top + 1e-6; t += step) {
      var x = L + w * (1 - t / top);
      g += '<line class="tick" x1="' + x.toFixed(1) + '" y1="' + TOP + '" x2="' + x.toFixed(1) +
           '" y2="' + (TOP + BH) + '"></line>' +
           '<text x="' + Math.min(W - 12, Math.max(12, x)).toFixed(1) + '" y="' + (TOP + BH + 14) +
           '" text-anchor="middle">' + (t / 60) + '分</text>';
    }
    g += '<text class="now" x="' + Math.min(W - 40, Math.max(30, L + w * p)).toFixed(1) +
         '" y="' + (TOP - 2) + '" text-anchor="middle">' + fmt(sc.total) + '</text>';
    el('gauge').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="スコアの位置">' + g + '</svg>';
  }

  /* タイムごとの早見。**30 秒刻み。** */
  function drawTable(r, sec) {
    var hi = r.cl + r.hp + r.mx;
    // **表の範囲は「その凸数で使いきれる時間」まで。**3600 秒まで並べても誰も使わない
    var top = Math.max(r.du * turns, Math.ceil(sec / 30) * 30);
    var step = top <= 360 ? 30 : top <= 900 ? 60 : 120;
    var rows = [];
    for (var t = 0; t <= top; t += step) rows.push(t);
    var near = rows.reduce(function (a, b) {
      return Math.abs(b - sec) < Math.abs(a - sec) ? b : a;
    }, rows[0]);
    el('rs-tb-lead').innerHTML = '倒しきったときのスコアです。横は<b>部隊をまたいだ合計</b>の戦闘時間で、' + turns + ' 凸ぶんの ' + clock(r.du * turns) + ' まで並べています。';
    el('rs-tb').innerHTML = rows.map(function (t) {
      var s2 = r.cl + r.hp + Math.max(0, r.mx - t * r.ps);
      var on = t === near;
      return '<tr' + (on ? ' class="here"' : '') + '><td>' + clock(t) + '</td>' +
        '<td' + (on ? ' class="hi"' : '') + '>' + fmt(s2) + '</td>' +
        '<td>' + (hi - s2 ? '−' + fmt(hi - s2) : '—') + '</td></tr>';
    }).join('');
  }

  /* 目標スコアから、要るタイムを逆に出す。 */
  function drawGoal(r, lo, hi) {
    var g = Math.max(0, parseFloat(el('i-goal').value) || 0);
    if (!g) { el('goal-out').textContent = '目標を入れると、要るタイムが出ます。'; return; }
    if (g > hi) {
      el('goal-out').innerHTML = '<b>' + fmt(g) + ' 点には届きません。</b>倒しきって 0 秒でも ' +
        fmt(hi) + ' 点までです。';
      return;
    }
    if (g <= lo) {
      el('goal-out').innerHTML = '<b>倒しきれば必ず届きます。</b>' + clock(R.span) +
        ' かけても ' + fmt(lo) + ' 点は入ります。';
      return;
    }
    var need = (r.mx - (g - lo)) / r.ps;
    // **この凸数では時間切れが先に来る。**1 凸 3 分ボスに「57:03 までに倒せば」と
    // 出しても意味がない（2026-08-31）。合計が制限時間 × 凸数を超えられない以上、
    // 要るタイムがそれ以上なら、倒しきりさえすれば必ず届く
    if (need >= r.du * turns) {
      var worst = r.cl + r.hp + Math.max(0, r.mx - r.du * turns * r.ps);
      el('goal-out').innerHTML = '<b>倒しきれば必ず届きます。</b>' + turns + ' 凸ぶんの合計 ' +
        clock(r.du * turns) + ' をかけても ' + fmt(worst) + ' 点は入ります。';
      return;
    }
    var pre = r.du * (turns - 1);
    var lastNeed = need - pre;
    el('goal-out').innerHTML = '<b>合計 ' + clock(Math.max(0, need)) + ' までに倒せば ' + fmt(g) +
      ' 点に届きます。</b>いまの合計との差は ' + clock(Math.abs(need - secs())) +
      (need >= secs() ? '（間に合っています）' : '（縮める必要があります）') + '。' +
      (turns > 1
        ? (lastNeed > 0
            ? '<br>前の ' + (turns - 1) + ' 回で ' + clock(pre) + ' 使っているので、' +
              '<b>最後の 1 回は ' + clock(lastNeed) + ' 以内</b>（残り ' +
              clock(Math.max(0, r.du - lastNeed)) + ' で倒す）です。'
            : '<br><b>' + turns + ' 凸では届きません。</b>前の ' + (turns - 1) + ' 回で ' +
              clock(pre) + ' 使ってしまうためです。')
        : '');
  }

  /* ---------- URL ----------
     **自分の区画（`rs=`）だけを書き換える。**ほかの区画（`rb=`・`rc=`・`pane=`…）は
     順番ごと残す（`tools/raid/cal.js` の `rc=` と同じ流儀）。
     既定のまま（1 凸・経過・90 秒・倒しきり・目標なし）のときは区画を書かない。 */
  function tstr() {
    return times.slice(0, turns).map(function (v) {
      return String(Math.round((v || 0) * 10) / 10);
    }).join('_');
  }
  function seg() {
    var s = 'rs=' + ['', '', '', turns, tmode, tstr(), hp,
      Math.max(0, parseFloat(el('i-goal').value) || 0)].join('~');
    return s === 'rs=~~~1~clear~90~100~0' ? '' : s;
  }
  function syncHash() {
    var mine = seg();
    var parts = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x && x.indexOf('rs=') !== 0;
    });
    if (mine) parts.push(mine);
    var h = parts.join('&');
    try {
      history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
    } catch (e) { /* file:// では黙って諦める */ }
  }
  function fromHash() {
    var s = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x.indexOf('rs=') === 0;
    })[0];
    if (!s) return;
    var p = s.slice(3).split('~');
    // p[0]〜p[2]（種類・ボス・難易度）は読まない。先頭の選択が持っている
    var n = parseInt(p[3], 10);
    if (n >= 1 && n <= MAX_TURNS) turns = n;
    if (p[4] === 'clear' || p[4] === 'left') tmode = p[4];
    if (p[5]) {
      var ts = p[5].split('_').map(function (x) { return Math.max(0, parseFloat(x) || 0); });
      if (ts.length) times = ts;
    }
    var hv = parseInt(p[6], 10);
    if (hv >= 5 && hv <= 100 && hv % 5 === 0) { hp = hv; el('i-hp').value = String(hv); }
    var g = parseFloat(p[7]);
    if (g > 0) el('i-goal').value = g;
    // 押しボタンの見た目を合わせる（凸数は `drawTimes` が行ごと描き直す）
    [].forEach.call(el('tmode').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.t === tmode));
    });
  }

  /* **足すのは最後の 1 つ手前**で、最後の行は「倒した回」のまま動かさない */
  el('add-turn').addEventListener('click', function () {
    if (turns >= MAX_TURNS) return;
    turns += 1; drawTimes(); draw();
  });
  el('times').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    if (turns <= 1) return;
    times.splice(+b.dataset.del, 1);
    turns -= 1; drawTimes(); draw();
  });
  el('tmode').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    tmode = b.dataset.t;
    [].forEach.call(el('tmode').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.t === tmode));
    });
    drawTimes(); draw();
  });
  el('times').addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.k) return;
    var i = +t.dataset.i, r = row(); if (!r) return;
    var box = el('times').querySelector('.timein[data-i="' + i + '"]');
    var m = Math.max(0, parseFloat(box.querySelector('[data-k="m"]').value) || 0);
    var ss = Math.max(0, parseFloat(box.querySelector('[data-k="s"]').value) || 0);
    var v = m * 60 + ss;
    // **残りで入れているのは最後の 1 回だけ。**経過に直して持つ
    times[i] = (i === turns - 1 && tmode === 'left') ? Math.max(0, r.du - v) : v;
    draw();
  });
  ['i-hp', 'i-goal'].forEach(function (id) {
    el(id).addEventListener('input', draw);
    el(id).addEventListener('change', draw);
  });

  // **先頭の選択が変わったら描き直す。**大決戦の装甲は `on` に来ないが、スコアに効かないのでよい
  P.on(function () { drawTimes(); draw(); });

  /** 区画の中身（`rs=`）。共有・覚える・最初に戻すは index.html がまとめて組む */
  window.RAIDSEG = window.RAIDSEG || {};
  window.RAIDSEG.score = seg;

  el('rs-ver').textContent = R.fetched;
  // URL に状態が入っていたら、それを戻してから最初の描画をする
  fromHash();
  drawTimes();
  draw();
})();
