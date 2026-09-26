/* 素材の逆引きの「どこで掘る」の区画（元の素材の掘り場。2026-09-26 に oopart とまとめた）。
   data.js（window.FARM。scripts/build-tool-data.py の build_farm）を読む。

   **素材は区画の外の欄で選び、index.html の `window.MATHUB` が `pick()` で渡してくる。**
   素材を選ぶ札・検索・群のタブ・同じ仲間・カードは区画の外へ移した（カードの一言は `note()`）。

   **数え方はまとめる前と 1 行も変えていない。**変えたのは、素材の受け取り方と、
   ハッシュの読み書き（`f=` の 1 区画。中身は元の `素材|目標|手持ち|倍率` から素材を外したもの）だけ */
(function () {
  'use strict';
  var F = window.FARM;
  var HUB = window.MATHUB;
  var el = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  /** **小さい数を 0 と書かない。**1 周 0.0043 個のような段が普通にある。 */
  function per(v) {
    if (!v) return '0';
    if (v >= 100) return fmt(v);
    if (v >= 1) return (+v.toFixed(2)).toString();
    if (v >= 0.01) return (+v.toFixed(3)).toString();
    return (+v.toFixed(5)).toString();
  }

  // 入場料の 3 種。**AP・指名手配券・学園交流会チケットは別の物差し。**
  var UNITS = [
    { id: 0, t: 'AP で回るところ', u: 'AP', nm: 'AP', k: 'AP 10 あたり', n: 10 },
    { id: 22, t: '指名手配券で回るところ', u: '枚', nm: '指名手配券', k: '券 1 枚あたり', n: 1 },
    { id: 23, t: '学園交流会チケットで回るところ', u: '枚', nm: '交流会チケット', k: 'チケット 1 枚あたり', n: 1 }
  ];
  function unitOf(s) { return s.tk || 0; }
  function costOf(s) { return s.tk ? s.tn : s.ap; }

  var mat = null, mult = 1, showAll = {};

  function stageLabel(s) {
    // 任務は「Hard 12-3」が通り名。指名手配などは作った題名をそのまま
    if (s.c === 'Campaign') return (s.h ? 'Hard ' : 'Normal ') + s.a + '-' + s.s;
    return s.n;
  }
  function stageSub(s) {
    if (s.c === 'Campaign') return s.n;
    return s.tj;
  }

  /** いま選んでいる素材の落ちる場所。**倍率を掛けたあとの 1 周あたり。** */
  function rows() {
    return (F.drops[mat] || []).map(function (p) {
      var s = F.stages[p[0]];
      var v = p[1] * mult;
      return { s: s, v: v, c: costOf(s), r: v / (costOf(s) || 1) };
    }).sort(function (a, b) { return b.r - a.r || b.v - a.v; });
  }
  function left() {
    var need = Math.max(0, +el('i-need').value || 0);
    var have = Math.max(0, +el('i-have').value || 0);
    return Math.max(0, need - have);
  }

  /** カードの一言。**区画の外のカードに出す**（素材の群と、落ちるステージの本数） */
  function note() {
    var m = HUB.byKey[mat], rs = rows();
    if (!m) return '—';
    // **ステージから落ちない素材もある。**「誰が使う」のために、合成でしか作れない
    // 最上級のオーパーツ（完全な〇〇）も選べるようにした（2026-09-26）
    if (!rs.length) return '<b>' + esc(m.g) + '</b>／ステージからは落ちません。';
    var kinds = {};
    rs.forEach(function (r) { kinds[unitOf(r.s)] = (kinds[unitOf(r.s)] || 0) + 1; });
    var parts = UNITS.filter(function (u) { return kinds[u.id]; }).map(function (u) {
      return u.nm + ' ' + kinds[u.id] + ' 本';
    });
    return '<b>' + esc(m.g) + '</b>／落ちるのは <b>' + rs.length +
      ' 本</b>のステージ' + (parts.length ? '（' + parts.join('・') + '）' : '') + '。';
  }

  /** 同じ効率のステージを全部拾う。**神名文字は同率が普通。**
      ツバキの神名文字は Hard 15-2 と Hard 23-2 のどちらも 1 周 0.4 個で、
      片方だけ「いちばん効率のいい場所」に出すと、もう片方が無いように見える
      （2026-08-30 の先生の指摘——「神名が落ちるハードが数か所あるキャラもいる」）。 */
  function tied(rs, uid) {
    var list = rs.filter(function (r) { return unitOf(r.s) === uid; });
    if (!list.length) return [];
    var top = list[0].r;
    return list.filter(function (r) { return Math.abs(r.r - top) < 1e-9; });
  }

  function drawTops(rs) {
    var h = '';
    UNITS.forEach(function (u) {
      var ts = tied(rs, u.id), best = ts[0];
      var where = ts.map(function (r) { return stageLabel(r.s) + '｜' + stageSub(r.s); }).join('　／　');
      h += '<div class="row"><span class="topline">' + esc(u.k) +
        '<span class="subnote">' + (best ? esc(where) : 'ここでは出ません') + '</span></span>' +
        '<span>' + (best ? '<b>' + per(best.r * u.n) + '</b> 個' : '—') + '</span></div>';
    });
    el('tops').innerHTML = h;
  }

  /** 見出しに出す 1 本。**AP と券は混ぜない。**
      `costOf` は券のステージだと常に 1 なので、全部まとめて効率順に並べると
      指名手配・交流会のステージが必ず上に来て、AP で回りたい人にいちばん要る
      答えが隠れる。下の「入場料ごとの一番」と同じ物差しで、AP → 指名手配券 →
      交流会チケットの順に、あるものを選ぶ（2026-08-31） */
  function headline(rs) {
    for (var i = 0; i < UNITS.length; i++) {
      var t = tied(rs, UNITS[i].id);
      if (t.length) return t[0];
    }
    return rs[0];
  }

  function drawStats(rs) {
    var need = left();
    if (!rs.length) {
      el('o-best').textContent = '—';
      el('o-best-sub').textContent = 'この素材が落ちるステージはありません。';
      el('o-runs').textContent = '—'; el('o-cost').textContent = '—';
      el('o-runs-sub').textContent = ''; el('o-cost-sub').textContent = '';
      return;
    }
    var b = headline(rs), u = UNITS.filter(function (x) { return x.id === unitOf(b.s); })[0];
    /* **同じ効率が並ぶことがある。**神名文字はたいてい 2 本以上のハードに
       同じ確率で入っていて、1 本だけ出すと他が無いように見える */
    var ts = tied(rs, unitOf(b.s));
    el('o-best').textContent = ts.length > 1
      ? stageLabel(b.s) + ' ほか ' + (ts.length - 1) + ' 本'
      : stageLabel(b.s);
    el('o-best-sub').innerHTML = (ts.length > 1
        ? esc(ts.map(function (r) { return stageLabel(r.s); }).join('・')) + '（同率）'
        : esc(stageSub(b.s))) +
      '｜' + esc(u.k) + ' <b>' + per(b.r * u.n) + '</b> 個';
    if (!need) {
      el('o-runs').innerHTML = '0 <small>周</small>';
      el('o-runs-sub').textContent = '手持ちで足りています。';
      el('o-cost').innerHTML = '0';
      el('o-cost-sub').textContent = '';
      return;
    }
    var runs = b.v > 0 ? Math.ceil(need / b.v) : 0;
    el('o-runs').innerHTML = fmt(runs) + ' <small>周</small>';
    el('o-runs-sub').innerHTML = 'あと <b>' + fmt(need) + '</b> 個ぶん（1 周 ' + per(b.v) + ' 個）';
    el('o-cost').innerHTML = fmt(runs * b.c) + ' <small>' + (u.id ? u.u : 'AP') + '</small>';
    el('o-cost-sub').textContent = u.id === 22 ? '指名手配券のぶん'
      : u.id === 23 ? '交流会チケットのぶん（AP は別に ' + fmt(runs * b.s.ap) + ' 要ります）' : 'AP のぶん';
  }

  var LIMIT = 10;
  function drawTables(rs) {
    var need = left(), h = '';
    UNITS.forEach(function (u) {
      var list = rs.filter(function (r) { return unitOf(r.s) === u.id; });
      if (!list.length) return;
      var all = showAll[u.id], view = all ? list : list.slice(0, LIMIT);
      /* **入場料が全部 1 のときは列を 3 つに畳む。**指名手配は 1 周につき券 1 枚
         なので「1 周」「券 1 枚あたり」「要る券」の 3 列が同じ数字になる。
         そのまま 5 列で出すと、細い画面でいちばん見たい列が右へ押し出される
         （2026-08-30、390px で実物を見て畳んだ） */
      var flat = list.every(function (r) { return r.c === 1; });
      h += '<div class="panel"><div class="panel-h"><h2>' + esc(u.t) + '</h2></div>' +
        '<p class="lead">' + list.length + ' 本あります。<b>' + esc(u.k) +
        'の多い順</b>に並べました。' +
        (flat ? '1 周につき' + u.nm + ' 1 枚なので、<b>周回数がそのまま必要な枚数</b>です。' : '') +
        (u.id === 23 ? '学園交流会はチケットのほかに AP も要ります（表の右に出しています）。' : '') +
        '</p><div class="tscroll"><table class="dt farm"><thead><tr>' +
        '<th>ステージ</th>' +
        (flat ? '' : '<th class="num">1 周</th>') +
        '<th class="num">' + esc(u.k) + '</th>' +
        '<th class="num">あと何周</th>' +
        (flat ? '' : '<th class="num">' + (u.id === 23 ? '券／AP' : u.id ? '要る券' : '要る AP') + '</th>') +
        '</tr></thead><tbody>' +
        view.map(function (r) {
          var runs = need && r.v > 0 ? Math.ceil(need / r.v) : 0;
          return '<tr' + (need ? '' : ' class="done"') + '><td class="stg"><b>' + esc(stageLabel(r.s)) +
            '</b><small>' + esc(stageSub(r.s)) + '</small></td>' +
            (flat ? '' : '<td class="num">' + per(r.v) + '</td>') +
            '<td class="per num">' + per(r.r * u.n) + '</td>' +
            '<td class="num">' + (need ? fmt(runs) + ' 周' : '—') + '</td>' +
            (flat ? '' : '<td class="num">' + (need
              ? (u.id === 23 ? fmt(runs * r.c) + ' ／ ' + fmt(runs * r.s.ap) : fmt(runs * r.c))
              : '—') + '</td>') + '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        (list.length > LIMIT
          ? '<div class="btnrow" style="margin-top:12px"><button type="button" class="btn" data-all="' +
            u.id + '">' + (all ? '上位 ' + LIMIT + ' 本だけ' : '残り ' + (list.length - LIMIT) + ' 本も見る') + '</button></div>'
          : '') +
        '</div>';
    });
    el('tables').innerHTML = h ||
      '<div class="panel"><p class="lead">この素材が落ちるステージは、任務・指名手配・拠点防衛・学園交流会の中にはありません。</p></div>';
  }

  function draw() {
    var rs = rows();
    drawTops(rs); drawStats(rs); drawTables(rs);
  }

  el('mult').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    mult = +b.dataset.m;
    drawMult();
    draw();
    HUB.changed('farm');
  });
  function drawMult() {
    [].forEach.call(el('mult').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(+x.dataset.m === mult));
    });
  }
  el('tables').addEventListener('click', function (e) {
    var b = e.target.closest('[data-all]'); if (!b) return;
    showAll[b.dataset.all] = !showAll[b.dataset.all];
    drawTables(rows());
  });
  ['i-need', 'i-have'].forEach(function (id) {
    el(id).addEventListener('input', function () {
      // **表の入れ物だけ描き直す。**入力欄は作り直さないので焦点は残る
      var rs = rows();
      drawStats(rs); drawTables(rs);
      HUB.changed('farm');
    });
  });

  /* ---- 区画のハッシュ `f=目標|手持ち|倍率`。**素材は区画の外の `m=`** */
  function seg() {
    return Math.max(0, +el('i-need').value || 0) + '|' +
      Math.max(0, +el('i-have').value || 0) + '|' + mult;
  }
  (function fromHash() {
    var h = HUB.seg.f;
    if (!h) return;
    var p = h.split('|');
    if (p[0] !== undefined && +p[0] >= 0) el('i-need').value = Math.floor(+p[0]) || 0;
    if (p[1] !== undefined && +p[1] >= 0) el('i-have').value = Math.floor(+p[1]) || 0;
    if (+p[2] >= 1 && +p[2] <= 3) mult = Math.floor(+p[2]);
  })();

  HUB.add('farm', {
    pick: function (key) { mat = key; draw(); },
    seg: seg,
    note: note,
    /** その素材がステージから落ちるか（系統から 1 段を選ぶときに使う） */
    drops: function (key) { return !!(F.drops[key] && F.drops[key].length); }
  });

  el('src-mat').textContent = F.mats.length;
  el('src-stage').textContent = F.stages.length;
  el('src-pair').textContent = Object.keys(F.drops).reduce(function (a, k) { return a + F.drops[k].length; }, 0);
  el('src-istage').textContent = F.itemStages;
  el('ver').textContent = F.fetched;
  drawMult();
})();
