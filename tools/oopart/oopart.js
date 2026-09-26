/* オーパーツ逆引き。**データは「生徒 1 人の育成費用」と同じ data.js を借りている。**
   同じ 230KB をもう一本置く意味がないので、../student-cost/data.js をそのまま読む。

   出す個数は**全員共通の範囲 1 つ**で数える——「EX 今→目標」と「ほかのスキル 今→目標」。
   既定は最大まで（EX Lv1→Lv5、ノーマル・パッシブ・サブ Lv1→Lv10）で、2026-09-26 まで
   固定だった「スキルを最大まで上げたとき」と同じ数字になる。**EX 以外の 3 つは同じ表**
   なので、同じ範囲を 3 倍する（2026-09-26 の先生の判断 Q1 oopart。1 人ずつの範囲は
   student-cost の役目なので作らない）。 */
(function () {
  'use strict';
  var C = window.COST;
  var el = function (id) { return document.getElementById(id); };
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }

  var KIND_JA = { oopart: 'オーパーツ', note: '技術ノート', bd: '戦術教育 BD' };
  var TIER_JA = ['初級', '中級', '上級', '最上級'];

  /* ---------- 素材を「系統」にまとめる

     アイコンの末尾が段（0〜3）なので、そこを落としたものが系統名になる。
     item_icon_material_nebra_0 … _3 → item_icon_material_nebra */
  function family(m) { return m.i.replace(/_\d+$/, ''); }

  var fams = {};                       // fams[系統] = { k, tiers: [id,id,id,id], n }
  Object.keys(C.mat).forEach(function (id) {
    var m = C.mat[id];
    if (m.k !== 'oopart' && m.k !== 'note' && m.k !== 'bd') return;
    var f = family(m);
    if (!fams[f]) fams[f] = { k: m.k, key: f, tiers: [], n: '' };
    fams[f].tiers[m.t] = id;
  });
  /** 4 段ぜんぶに共通して入っている、いちばん長い文字列。
      **接頭辞を剥がす方式では足りなかった。**段ごとの言い回しが揃っていない——
      「完全なネブラディスク」「完全なる古代の電池」「高純度のヴォルフスエック鋼鉄」
      「エーテルのエッセンス」…。共通部分を取れば、どの系統でも名前が出る
      （2026-08-30。最初は正規表現で剥がして「る古代の電池」になっていた）。 */
  function commonPart(names) {
    if (!names.length) return '';
    var base = names.reduce(function (a, b) { return a.length <= b.length ? a : b; });
    for (var len = base.length; len >= 2; len--) {
      for (var i = 0; i + len <= base.length; i++) {
        var cand = base.substr(i, len);
        var ok = names.every(function (n) { return n.indexOf(cand) >= 0; });
        if (ok) return cand.replace(/^[のなるっ]+/, '').replace(/[のなるっ]+$/, '');
      }
    }
    return '';
  }

  Object.keys(fams).forEach(function (f) {
    var names = fams[f].tiers.filter(Boolean).map(function (id) { return C.mat[id].n; });
    var top = C.mat[fams[f].tiers[3]] || C.mat[fams[f].tiers[0]];
    // 技術ノート・BD は学校名が括弧に入っている。そちらを名前にする
    var mm = top && top.n.match(/（(.+?)）/);
    if (mm && (fams[f].k === 'note' || fams[f].k === 'bd')) { fams[f].n = mm[1]; return; }
    // **短すぎる共通部分は名前にしない。**「黄金の糸／黄金の巻糸／黄金の布」は
    // 「黄金」しか残らず、別系統の「黄金シャトル」と見分けが付かなくなる
    var cp = commonPart(names);
    fams[f].n = (cp.length >= 3 ? cp : '') || (top ? top.n : f);
  });

  /* ---------- 範囲。**段の数え方は student-cost の sum() と同じ**
     （段の配列の 1 段目が「Lv1 → Lv2」、Lv v → v+1 に使うのが step[v - 1]）。
     ノーマル等の Lv9 → Lv10 の段は秘伝ノート 1 冊だけで、技術ノートは要らない。
     秘伝ノートは学校を問わない 1 種類なので、ここでは系統として出さない */
  var EXMAX = 5, SKMAX = 10;
  var R = { ef: 1, et: EXMAX, sf: 1, st: SKMAX };
  var JUMP = { ex: [3, 5], sk: [4, 7, 10] };   // student-cost と同じ ◎（効果の伸びが大きい Lv）

  function isFull() { return R.ef === 1 && R.et === EXMAX && R.sf === 1 && R.st === SKMAX; }
  /** 今は目標を越えない。**今を上げたら目標を押し上げる**（student-cost と同じ） */
  function norm() {
    R.ef = Math.min(Math.max(R.ef | 0, 1), EXMAX); R.et = Math.min(Math.max(R.et | 0, R.ef), EXMAX);
    R.sf = Math.min(Math.max(R.sf | 0, 1), SKMAX); R.st = Math.min(Math.max(R.st | 0, R.sf), SKMAX);
  }
  /** 画面に出す範囲の言い方。short は「全員ぶんの合計」の下に入れる短い版 */
  function rangeText(short) {
    if (isFull()) return 'スキルを最大まで上げたとき';
    var a = [];
    if (R.et > R.ef) a.push('EX Lv' + R.ef + '→' + R.et);
    if (R.st > R.sf) a.push((short ? 'ほか ' : 'ほかのスキル ') + 'Lv' + R.sf + '→' + R.st);
    return a.length ? a.join('、') : '上げる範囲なし';
  }

  /** 生徒 1 人がこの範囲で使う素材。needOf[素材 id] = 個数 */
  function needOf(s) {
    var acc = {};
    function add(steps, f, t, times) {
      for (var v = f; v < t; v++) {
        var step = (steps || [])[v - 1];
        if (!step) continue;
        step[1].forEach(function (m) { acc[m[0]] = (acc[m[0]] || 0) + m[1] * times; });
      }
    }
    add(s.ex, R.ef, R.et, 1);
    // **EX 以外は 3 つあって、どれも同じ表**（ノーマル・パッシブ・サブ）
    add(s.sk, R.sf, R.st, 3);
    return acc;
  }

  function drawRange() {
    var row = function (k, nm, max, f, t) {
      var sel = function (w, a, cur) {
        var o = '<select data-r="' + k + w + '" aria-label="' + nm + 'の' + (w === 'f' ? '今' : '目標') + '">';
        for (var v = a; v <= max; v++) {
          o += '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>Lv' + v +
               (JUMP[k === 'e' ? 'ex' : 'sk'].indexOf(v) >= 0 ? ' ◎' : '') + '</option>';
        }
        return o + '</select>';
      };
      return '<div class="goal"><span class="nm">' + nm + '</span>' +
        sel('f', 1, f) + '<span class="ar">→</span>' + sel('t', f, t) + '</div>';
    };
    el('range').innerHTML =
      row('e', 'EX スキル', EXMAX, R.ef, R.et) +
      row('s', 'ほかのスキル', SKMAX, R.sf, R.st);
  }

  var kind = 'oopart', pick = null, sort = 'amount';

  function famList() {
    return Object.keys(fams)
      .filter(function (f) { return fams[f].k === kind; })
      .sort(function (a, b) { return fams[a].n.localeCompare(fams[b].n, 'ja'); });
  }

  function drawMats() {
    var list = famList();
    if (list.indexOf(pick) < 0) pick = list[0] || null;
    el('mats').innerHTML = list.map(function (f) {
      var top = C.mat[fams[f].tiers[3]] || C.mat[fams[f].tiers[0]];
      return '<button type="button" class="mbtn" data-f="' + f + '" aria-pressed="' + (f === pick) + '">' +
        '<img src="../img/' + top.i + '.webp" alt="" width="38" height="38" loading="lazy">' +
        '<span class="nm">' + fams[f].n +
        '<span class="sub">' + KIND_JA[fams[f].k] + '</span></span></button>';
    }).join('');
  }

  function draw() {
    if (!pick) return;
    var fam = fams[pick];

    // その系統をひとつでも使う生徒
    var rows = [];
    C.stu.forEach(function (s) {
      var acc = needOf(s), total = 0, per = [0, 0, 0, 0];
      fam.tiers.forEach(function (id, t) {
        var v = id ? (acc[id] || 0) : 0;
        per[t] = v; total += v;
      });
      if (total > 0) rows.push({ s: s, per: per, total: total });
    });

    var grand = [0, 0, 0, 0], sum = 0;
    rows.forEach(function (r) {
      r.per.forEach(function (v, t) { grand[t] += v; });
      sum += r.total;
    });

    el('o-n').textContent = fmt(rows.length);
    el('o-n-sub').textContent = '全 ' + C.stu.length + ' 人のうち';
    el('o-sum').textContent = fmt(sum);
    el('o-sum-sub').textContent = rangeText(true);
    el('t4-h').textContent = fam.n + 'の段ごとの合計';

    el('t4').innerHTML = fam.tiers.map(function (id, t) {
      if (!id) return '';
      var m = C.mat[id], rr = 'rar-' + (m.r || 'N');
      return '<div class="t4 ' + rr + '">' +
        '<img src="../img/' + m.i + '.webp" alt="" width="40" height="40" loading="lazy">' +
        '<div class="v">' + fmt(grand[t]) + '</div>' +
        '<div class="k">' + m.n + '</div>' +
        '<div class="rr">' + (m.r || 'N') + '</div></div>';
    }).join('');

    rows.sort(sort === 'amount'
      ? function (a, b) { return b.total - a.total || a.s.n.localeCompare(b.s.n, 'ja'); }
      : function (a, b) { return a.s.n.localeCompare(b.s.n, 'ja'); });

    el('list-h').textContent = fam.n + 'を使う生徒';
    var none = R.et <= R.ef && R.st <= R.sf;
    el('list-lead').textContent = rows.length === 0
      ? (none ? '上げる範囲が選ばれていません。' : 'この範囲でこの素材を使う生徒はいません。')
      : rows.length + ' 人います。' + (isFull() ? 'スキルを最大まで上げると' : rangeText(false) + 'で') +
        '、合わせて ' + fmt(sum) + ' 個です。';

    el('list').innerHTML = rows.map(function (r) {
      var br = fam.tiers.map(function (id, t) {
        if (!id || !r.per[t]) return '';
        return '<span>' + TIER_JA[t] + ' ' + fmt(r.per[t]) + '</span>';
      }).join('');
      return '<div class="srow">' +
        '<img src="../img/student_' + r.s.id + '.webp" alt="" width="46" height="46" loading="lazy">' +
        '<span><span class="nm">' + r.s.n + '</span><span class="br">' + br + '</span></span>' +
        '<span class="tot">' + fmt(r.total) + '<small> 個</small></span></div>';
    }).join('');
  }

  el('kind').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    kind = b.dataset.k; pick = null;
    [].forEach.call(el('kind').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.k === kind));
    });
    drawMats(); draw();
  });

  el('mats').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    pick = b.dataset.f;
    drawMats(); draw();
  });

  el('range').addEventListener('change', function (ev) {
    var k = ev.target.dataset && ev.target.dataset.r; if (!k) return;
    R[k] = parseInt(ev.target.value, 10);
    norm(); drawRange(); draw();
  });

  el('sort').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    sort = b.dataset.s;
    [].forEach.call(el('sort').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.s === sort));
    });
    draw();
  });

  /* ---- 状態を URL に残す。**share.js が「結果を共有」のときに呼ぶ**
     （eleph などと同じ作法。これが無いと、共有バーの「開いている状態ごと
     URL になります」が嘘になる）。
     **4 つ目が範囲**（`EX今.EX目標.ほか今.ほか目標`、2026-09-26 に足した）。
     potential からは `#oopart|<系統>` の 2 つだけで飛んでくるので、欠けたところは既定のまま */
  window.shareUrl = function () {
    return '#' + [kind, pick || '', sort, [R.ef, R.et, R.sf, R.st].join('.')].join('|');
  };
  (function fromHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return;
    var p = h.split('|');
    if (p[0] === 'oopart' || p[0] === 'note' || p[0] === 'bd') kind = p[0];
    if (p[1] && fams[p[1]] && fams[p[1]].k === kind) pick = p[1];
    if (p[2] === 'amount' || p[2] === 'name') sort = p[2];
    var r = (p[3] || '').split('.').map(function (x) { return parseInt(x, 10); });
    if (r.length === 4 && r.every(function (x) { return x > 0; })) {
      R.ef = r[0]; R.et = r[1]; R.sf = r[2]; R.st = r[3]; norm();
    }
    [].forEach.call(el('kind').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.k === kind));
    });
    [].forEach.call(el('sort').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.s === sort));
    });
  })();

  el('ver').textContent = C.fetched;
  drawRange();
  drawMats();
  draw();
})();
