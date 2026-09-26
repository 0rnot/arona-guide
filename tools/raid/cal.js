/* 総力戦の「開催」の区画。**元は tools/raid-calendar/ の 1 本だった**（2026-09-26 に
   「総力戦」1 本へまとめた。grill-me Q12-1）。

   **ボスの絞り込みは、ページ先頭の選択（`window.RAID_PICKER`）のボスで効く。**
   ここが持つのは「絞るか・全ボスか」だけ。先頭でボスを選び直すと絞り込みが立ち、
   「ボス」の面の札を押すと先頭の選択ごとそのボスに切り替わる。
   絞っている札をもう一度押すか「全ボスに戻す」で、全ボスに戻る（元の 1 本と同じ動き）。
   制約解除決戦の枠はこの記録に載っていないので、そのときは全ボスのまま。


   **履歴と、これからの予定は別のところから来ている。**
   開催済みは SchaleDB の `raids.min.json`、これからの回は ba-data の期間表
   （`C.next`。ビルドが入れている）。2026-09-24 まではここが無く、
   「間隔の中央値を足しただけ」の見積もりを出していた——**それは
   SchaleDB に先の回が来ていないだけで、ゲームのデータには入っていた。**
   期間表が取れなかったときのために、見積もりは残してある。 */
(function () {
  'use strict';
  var C = window.CAL;
  var el = function (id) { return document.getElementById(id); };
  var L = C.labels || {};
  var AR = L.ArmorType || {}, BT = L.BulletType || {};
  var TERRAIN = { Street: '市街地戦', Outdoor: '屋外戦', Indoor: '屋内戦' };
  var TCLASS = { Street: 'gi-terrain-street', Outdoor: 'gi-terrain-outdoor', Indoor: 'gi-terrain-indoor' };
  var DAY = ['日', '月', '火', '水', '木', '金', '土'];

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /** **日本時間で出す。**端末の時計に合わせると海外から見たときに日付がずれる */
  function jst(sec) { return new Date((sec + 9 * 3600) * 1000); }
  function ymd(sec) {
    var d = jst(sec);
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function hm(sec) {
    var d = jst(sec);
    return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
  }
  function dow(sec) { return DAY[jst(sec).getUTCDay()]; }
  function days(a, b) { return Math.round((b - a) / 86400 * 10) / 10; }

  var all = C.raid.map(function (r) { return { k: 'raid', r: r }; })
    .concat(C.elim.map(function (r) { return { k: 'elim', r: r }; }))
    .sort(function (a, b) { return b.r.o - a.r.o; });

  var P = window.RAID_PICKER;
  var kind = 'all', terrain = '', filt = false, shown = 20;
  /** 先頭で選んでいるボスの番号。**記録に居ないボス（制約解除決戦の枠）なら null** */
  function picked() {
    if (!P) return null;
    var st = P.get();
    if (st.kind === 'multi') return null;
    var id = +String(st.b).slice(1);
    return C.bosses[String(id)] ? id : null;
  }
  /** 絞り込みに使うボス。**絞っていないときは null** */
  function bossNow() { return filt ? picked() : null; }
  var now = Math.floor(Date.now() / 1000);

  /* ---------- URL ----------
     **開いている絞り込みを URL に残す。**下の共有の帯が「開いている状態ごと
     URL になります」と言うので、それを本当にする（2026-08-31。それまで
     このツールは状態が URL に入らなかった）。
     区画は `rc=種類~地形~絞り` の 1 つだけ。**`pane=` と `cp=` は `../panes.js` の
     持ちものなので触らない**——自分の区画だけ入れ替えて、ほかは順番ごと残す。
     **絞りは `*`（先頭で選んだボスで絞る）か空。**元の 1 本はここにボスの番号を
     入れていた。その形（`rc=all~~4`）は index.html の「古い URL を直す」が
     先頭の選択（`rb=`）と `*` に直してから、ここに渡す。 */
  function seg() {
    return (kind !== 'all' || terrain || filt) ? 'rc=' + [kind, terrain, filt ? '*' : ''].join('~') : '';
  }
  function syncHash() {
    var mine = seg();
    var parts = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x && x.indexOf('rc=') !== 0;
    });
    if (mine) parts.push(mine);
    var h = parts.join('&');
    try {
      history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
    } catch (e) { /* file:// では黙って諦める */ }
  }
  function fromHash() {
    var seg = location.hash.replace(/^#/, '').split('&').filter(function (x) {
      return x.indexOf('rc=') === 0;
    })[0];
    if (!seg) return;
    var p = seg.slice(3).split('~');
    if (p[0] === 'all' || p[0] === 'raid' || p[0] === 'elim') kind = p[0];
    if (p[1] === '' || TERRAIN[p[1]]) terrain = p[1] || '';
    filt = p[2] === '*';
    // 押しボタンの見た目を合わせる（種類と地形は描き直しが無い）
    [].forEach.call(el('cal-kind').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.k === kind));
    });
    [].forEach.call(el('cal-terrain').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.t === terrain));
    });
  }

  function bossOf(id) { return C.bosses[String(id)]; }
  function img(b) { return '../img/' + b.ic + '.webp'; }

  /* ---------- これからの開催（ba-data の期間表） */
  /* ボスは総力戦・大決戦なら `b`（`C.bosses` の鍵）、
     制約解除決戦は `Raid` の側に居ないので名前だけ `n` で来る */
  function nameOf(x) {
    if (x.b && C.bosses[x.b]) return C.bosses[x.b].n;
    return x.n || 'ボスは未定';
  }
  function terrainOf(x) { return x.t ? '・' + (TERRAIN[x.t] || x.t) : ''; }

  function upcoming(NX) {
    var KINDS = [['raid', '総力戦'], ['elim', '大決戦'], ['multi', '制約解除決戦']];
    var now = Date.now() / 1000;
    var html = KINDS.map(function (k) {
      var x = NX[k[0]];
      if (!x) return '';
      // 開催中かこれからかで言い方を変える。**同じ「次の回」でも
      // もう始まっているものを「次」と書くと読み違える**
      var head = x.o <= now ? '開催中' : 'あと ' + Math.ceil((x.o - now) / 86400) + ' 日';
      return '<span class="gap"><b>' + k[1] + '</b> ' + nameOf(x) + terrainOf(x) +
        ' ' + ymd(x.o).slice(5) + ' 〜 ' + ymd(x.c).slice(5) +
        ' <b>' + head + '</b></span>';
    }).join('');
    if (!html) return;
    el('upcoming-list').innerHTML = html;
    el('upcoming').hidden = false;
  }

  /* ---------- 概況 */
  function summary() {
    var starts = C.raid.map(function (r) { return r.o; }).sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 86400);
    // **1 点で当てにいかない。**直近の間隔は 28 日と 35 日が混ざっていて、
    // 中央値だけを足すと 1 週間ずれる（2026-08-30 に実際にずれた）。幅で出す
    var recent = gaps.slice(-6).slice().sort(function (a, b) { return a - b; });
    var lo = recent.length ? recent[0] : 28;
    var med = recent.length ? recent[Math.floor(recent.length / 2)] : 35;
    var hi = recent.length ? recent[recent.length - 1] : 35;
    var last = starts[starts.length - 1];

    var NX = C.next || {};
    if (NX.raid) {
      el('o-next').textContent = ymd(NX.raid.o).slice(5) + ' 〜 ' + ymd(NX.raid.c).slice(5);
      el('o-next-sub').textContent = nameOf(NX.raid) + terrainOf(NX.raid) +
        '（' + ymd(NX.raid.o) + ' ' + hm(NX.raid.o) + ' 開始）';
    } else {
      // **期間表が取れなかったときだけここへ来る。**見積もりなので、
      // 見出しにも「目安」と書き足して、予定表と読み違えられないようにする
      el('o-next-k').firstChild.nodeValue = '次の総力戦の目安';
      el('o-next-q').setAttribute('data-hint', '予定表ではありません。ゲームのデータの期間表が取れなかったので、これまでの開催間隔からの見積もりを出しています。ボスと地形は、これまでの並びからは決まりません。');
      el('o-next').textContent = lo === med ? ymd(last + lo * 86400)
        : ymd(last + lo * 86400).slice(5) + ' 〜 ' + ymd(last + med * 86400).slice(5);
      el('o-next-sub').textContent = '前回の開始 ' + ymd(last) + ' に、直近 6 回の間隔の' +
        '最短 ' + lo + ' 日と中央値 ' + med + ' 日を足しただけです' +
        (hi > med ? '（いちばん空いたときは ' + hi + ' 日）' : '');
    }
    upcoming(NX);
    el('o-raid').textContent = C.raid.length;
    el('o-raid-sub').textContent = '回（' + ymd(starts[0]) + ' 〜）';
    el('o-elim').textContent = C.elim.length;
    var es = C.elim.map(function (r) { return r.o; }).sort(function (a, b) { return a - b; });
    el('o-elim-sub').textContent = '回（' + ymd(es[0]) + ' 〜）';

    // 間隔の帯
    var last12 = [];
    for (var j = Math.max(1, starts.length - 12); j < starts.length; j++) {
      last12.push({ a: starts[j - 1], b: starts[j] });
    }
    el('gaps').innerHTML = last12.map(function (g) {
      return '<span class="gap">' + ymd(g.a).slice(5) + ' → ' + ymd(g.b).slice(5) +
        ' <b>' + days(g.a, g.b) + ' 日</b></span>';
    }).join('');
    var cnt = {};
    starts.forEach(function (t) { var d = dow(t); cnt[d] = (cnt[d] || 0) + 1; });
    var byDay = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })
      .map(function (d) { return d + '曜 ' + cnt[d] + ' 回'; }).join('、');
    el('gap-lead').textContent = '総力戦の始まりは' + byDay + '。' +
      '直近 12 回の間隔は下のとおりで、' + Math.min.apply(null, last12.map(function (g) { return days(g.a, g.b); })) +
      '〜' + Math.max.apply(null, last12.map(function (g) { return days(g.a, g.b); })) + ' 日でした。';
  }

  /* ---------- ボスの一覧 */
  function drawBosses() {
    var ids = Object.keys(C.bosses).map(Number);
    var stat = {};
    ids.forEach(function (id) { stat[id] = { r: 0, e: 0, last: 0, t: {} }; });
    all.forEach(function (x) {
      var s = stat[x.r.b]; if (!s) return;
      s[x.k === 'raid' ? 'r' : 'e']++;
      s.t[x.r.t] = (s.t[x.r.t] || 0) + 1;
      if (x.r.o > s.last) s.last = x.r.o;
    });
    ids.sort(function (a, b) { return stat[b].last - stat[a].last; });
    var boss = bossNow();
    el('cal-bosses').innerHTML = ids.map(function (id) {
      var b = bossOf(id), s = stat[id];
      var tr = Object.keys(s.t).sort(function (a, c) { return s.t[c] - s.t[a]; })
        .map(function (t) { return (TERRAIN[t] || t) + ' ' + s.t[t]; }).join('・');
      return '<button type="button" class="bcard" data-b="' + id + '" aria-pressed="' + (boss === id) + '" title="' + esc(b.n) + '">' +
        '<img src="' + img(b) + '" alt="" width="48" height="48" loading="lazy">' +
        '<span class="bi"><span class="nm">' + esc(b.n) + '</span>' +
        '<span class="tags"><span class="tg">' + esc(AR[b.at] || b.at) + '</span>' +
        '<span class="tg hot">' + esc(BT[b.bi] || b.bi) + '</span></span>' +
        '<span class="sub">総力戦 ' + s.r + '・大決戦 ' + s.e + '<br>' + esc(tr) +
        '<br>前回 ' + ymd(s.last) + '</span></span></button>';
    }).join('');
  }

  /* ---------- 開催の記録 */
  function filtered() {
    var boss = bossNow();
    return all.filter(function (x) {
      if (kind !== 'all' && x.k !== kind) return false;
      if (terrain && x.r.t !== terrain) return false;
      if (boss != null && x.r.b !== boss) return false;
      return true;
    });
  }

  function drawList() {
    var rows = filtered(), boss = bossNow();
    /* **絞っているときは、その場で全ボスに戻せるようにする。**札は別の面（「ボス」）に
       あるので、記録の面だけを見ている人には戻り道が無かった */
    el('cal-lead').innerHTML = rows.length + ' 回あります。' +
      (boss != null ? esc(bossOf(boss).n) + 'だけを出しています。' +
        '<button type="button" class="btn sm" id="cal-all" style="margin-left:.6em">全ボスに戻す</button>'
        : '新しい順です。' + (picked() != null ? '<button type="button" class="btn sm" id="cal-one" style="margin-left:.6em">' +
          esc(bossOf(picked()).n) + 'だけにする</button>' : ''));
    el('cal-more').hidden = rows.length <= shown;
    el('cal-more').textContent = 'もっと見る（残り ' + Math.max(0, rows.length - shown) + ' 回）';
    el('cal-list').innerHTML = rows.slice(0, shown).map(function (x) {
      var b = bossOf(x.r.b);
      var live = x.r.o <= now && now < x.r.c;
      var od = '';
      if (x.r.od) {
        var top = Object.keys(x.r.od).filter(function (k) {
          return C.diffs[x.r.od[k]] === 'Torment' || x.r.od[k] >= 6;
        }).map(function (k) { return AR[k] || k; });
        od = top.length ? 'Torment は' + top.join('・') : Object.keys(x.r.od).map(function (k) {
          return (AR[k] || k) + ' ' + (C.diffs[x.r.od[k]] || x.r.od[k]);
        }).join('／');
      }
      // 開催中の印は `.live`。**`.now` はボス情報の区画の「いまの相手」が使っている**
      return '<div class="season' + (live ? ' live' : '') + '">' +
        '<img src="' + img(b) + '" alt="" width="44" height="44" loading="lazy">' +
        '<span class="dt">' + ymd(x.r.o) + '（' + dow(x.r.o) + '）' + hm(x.r.o) +
        '<small>〜 ' + ymd(x.r.c) + ' ' + hm(x.r.c) + '</small></span>' +
        '<span class="tx"><b>' +
        '<span class="gi ' + (TCLASS[x.r.t] || '') + '" aria-hidden="true"></span> ' +
        esc((TERRAIN[x.r.t] || x.r.t) + '・' + b.n) + '</b>' +
        '<small>' + (x.k === 'raid' ? '総力戦' : '大決戦') +
        (od ? '／' + esc(od) : '') + (live ? '／開催中' : '') + '</small></span>' +
        '<span class="rd"><b>' + (x.r.d || x.r.s) + '</b><small>回目</small></span></div>';
    }).join('');
  }

  function draw() { drawBosses(); drawList(); syncHash(); }

  /** 記録の箱まで送る。**上のバーは `position: sticky` なので、その高さぶん
      余計に上げないと見出しと絞り込みがバーの下に隠れる**（2026-08-30 の
      先生の指摘——「スクロール位置が中途半端」）。`scrollIntoView` では
      この差を引けないので、自分で座標を出す。 */
  function scrollToList() {
    /* **記録は別の面にいる。**先に開いておかないと、送った先が隠れたままになる
       （2026-08-30、ボス・記録・間隔をタブに割ったときから）。
       `showPane` は `../panes.js` が置いていく。無くても動くようにしておく。 */
    if (window.showPane) window.showPane(el('cal-list'));
    var box = el('cal-list').closest('.panel') || el('cal-list');
    var bar = document.querySelector('.topbar');
    var off = (bar ? bar.getBoundingClientRect().height : 0) + 14;
    var y = box.getBoundingClientRect().top + window.pageYOffset - off;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* **札を押したら、先頭の選択ごとそのボスに切り替える。**ボス情報とスコアも同じ相手になる。
     絞っている札をもう一度押したら全ボスに戻す（元の 1 本と同じ） */
  el('cal-bosses').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var id = +b.dataset.b;
    if (bossNow() === id) { filt = false; }
    else {
      filt = true;
      if (P && picked() !== id) {
        var st = P.get();
        P.choose({ kind: st.kind === 'elim' ? 'elim' : 'raid', b: 'b' + id });
      }
    }
    shown = 20; draw();
    scrollToList();
  });
  el('cal-lead').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    filt = b.id === 'cal-one'; shown = 20; draw();
  });
  if (P) {
    var last = picked();
    /* **先頭でボスを選び直したら絞る。**地形や難易度を変えただけでは触らない */
    P.on(function () {
      var id = picked();
      if (id !== last && id != null) { filt = true; shown = 20; }
      last = id;
      draw();
    });
  }
  el('cal-kind').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    kind = b.dataset.k; shown = 20;
    [].forEach.call(el('cal-kind').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.k === kind));
    });
    drawList(); syncHash();
  });
  el('cal-terrain').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    terrain = b.dataset.t; shown = 20;
    [].forEach.call(el('cal-terrain').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.t === terrain));
    });
    drawList(); syncHash();
  });
  el('cal-more').addEventListener('click', function () { shown += 30; drawList(); });

  /** 区画の中身（`rc=`）。共有・覚える・最初に戻すは index.html がまとめて組む */
  window.RAIDSEG = window.RAIDSEG || {};
  window.RAIDSEG.cal = seg;

  el('cal-ver').textContent = C.fetched;
  // URL に絞り込みが入っていたら、それを戻してから最初の描画をする
  fromHash();
  summary();
  draw();
})();
