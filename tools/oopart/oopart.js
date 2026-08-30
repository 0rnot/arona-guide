/* オーパーツ逆引き。**データは「生徒 1 人の育成費用」と同じ data.js を借りている。**
   同じ 230KB をもう一本置く意味がないので、../student-cost/data.js をそのまま読む。

   出す個数は「スキルを最大まで上げたとき」——EX を Lv1→Lv5、
   ノーマル・パッシブ・サブをそれぞれ Lv1→Lv10。**EX 以外の 3 つは同じ表**なので 3 倍する。 */
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

  /* ---------- 生徒ごとの「最大まで上げたとき」の必要数 */
  var needOf = {};                     // needOf[生徒 id][素材 id] = 個数
  C.stu.forEach(function (s) {
    var acc = {};
    (s.ex || []).forEach(function (step) {
      step[1].forEach(function (m) { acc[m[0]] = (acc[m[0]] || 0) + m[1]; });
    });
    // **EX 以外は 3 つあって、どれも同じ表**（ノーマル・パッシブ・サブ）
    (s.sk || []).forEach(function (step) {
      step[1].forEach(function (m) { acc[m[0]] = (acc[m[0]] || 0) + m[1] * 3; });
    });
    needOf[s.id] = acc;
  });

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
      var acc = needOf[s.id], total = 0, per = [0, 0, 0, 0];
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
    el('list-lead').textContent = rows.length === 0
      ? 'この素材を使う生徒はいません。'
      : rows.length + ' 人います。スキルを最大まで上げると、合わせて ' + fmt(sum) + ' 個です。';

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

  el('sort').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    sort = b.dataset.s;
    [].forEach.call(el('sort').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.s === sort));
    });
    draw();
  });

  el('ver').textContent = C.fetched;
  drawMats();
  draw();
})();
