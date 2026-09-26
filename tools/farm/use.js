/* 素材の逆引きの「誰が使う」の区画（元の tools/oopart/。2026-09-26 に素材の掘り場とまとめた）。
   **データは「生徒の育成計算機」と同じ ../student-cost/data.js を借りている。**
   同じ 230KB をもう一本置く意味がないので、そちらをそのまま読む。

   **素材は区画の外の欄で選び、index.html の `window.MATHUB` が `pick()` で渡してくる。**
   渡ってくるのは 1 段ぶんの素材（例 I101 壊れたネブラディスク）で、ここはその「系統」
   （同じ絵柄の 4 段）で数える。元の「種類」と「素材の札」は区画の外の欄に移した。
   要素の id は、掘り場の区画と重ならないよう `u-` を付けた。

   出す個数は**全員共通の範囲 1 つ**で数える——「EX 今→目標」と「ほかのスキル 今→目標」。
   既定は最大まで（EX Lv1→Lv5、ノーマル・パッシブ・サブ Lv1→Lv10）で、2026-09-26 まで
   固定だった「スキルを最大まで上げたとき」と同じ数字になる。**EX 以外の 3 つは同じ表**
   なので、同じ範囲を 3 倍する（2026-09-26 の先生の判断 Q1 oopart。1 人ずつの範囲は
   student-cost の役目なので作らない）。

   **数え方はまとめる前と 1 行も変えていない。**変えたのは、素材の受け取り方と、
   ハッシュの読み書き（`u=` の 1 区画。中身は元の `種類|系統|並び|範囲` から種類と系統を外したもの）だけ */
(function () {
  'use strict';
  var C = window.COST;
  var HUB = window.MATHUB;
  var el = function (id) { return document.getElementById('u-' + id); };
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

  /* **選んでいる素材（1 段ぶん）と、その系統。**系統が無い素材（神名文字・レポートなど）は
     pick が null になり、「スキルには使わない」とだけ出す */
  var mid = null, pick = null, sort = 'amount';

  function famList(kind) {
    return Object.keys(fams)
      .filter(function (f) { return fams[f].k === kind; })
      .sort(function (a, b) { return fams[a].n.localeCompare(fams[b].n, 'ja'); });
  }

  /** スキルに使わない素材のとき。数字の欄は「—」に戻す */
  function drawNone() {
    ['o-n', 'o-sum'].forEach(function (k) { el(k).textContent = '—'; });
    el('o-n-sub').textContent = '';
    el('o-sum-sub').textContent = rangeText(true);
    el('t4-h').textContent = '段ごとの合計';
    el('t4').innerHTML = '';
    el('list-h').textContent = 'この素材を使う生徒';
    el('list-lead').textContent = 'この素材はスキルのレベル上げには使いません。' +
      '誰が使うかを出せるのは、オーパーツ・技術ノート・戦術教育 BD です。';
    el('list').innerHTML = '';
  }

  function draw() {
    if (!pick) { drawNone(); return; }
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

    // **選んでいる段に印を付ける。**区画の外で選んだのは 1 段ぶんなので、どれかが分かるように
    el('t4').innerHTML = fam.tiers.map(function (id, t) {
      if (!id) return '';
      var m = C.mat[id], rr = 'rar-' + (m.r || 'N');
      return '<div class="t4 ' + rr + (id === mid ? ' on' : '') + '">' +
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

  el('range').addEventListener('change', function (ev) {
    var k = ev.target.dataset && ev.target.dataset.r; if (!k) return;
    R[k] = parseInt(ev.target.value, 10);
    norm(); drawRange(); draw();
    HUB.changed('use');
  });

  el('sort').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    sort = b.dataset.s;
    drawSort();
    draw();
    HUB.changed('use');
  });
  function drawSort() {
    [].forEach.call(el('sort').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.s === sort));
    });
  }

  /* ---- 区画のハッシュ `u=並び|EX今.EX目標.ほか今.ほか目標`。**素材は区画の外の `m=`。**
     元の oopart は `種類|系統|並び|範囲` で、転送ページが後ろの 2 つだけをここへ渡す。
     欠けたところは既定のまま */
  function seg() { return [sort, [R.ef, R.et, R.sf, R.st].join('.')].join('|'); }
  (function fromHash() {
    var h = HUB.seg.u;
    if (!h) return;
    var p = h.split('|');
    if (p[0] === 'amount' || p[0] === 'name') sort = p[0];
    var r = (p[1] || '').split('.').map(function (x) { return parseInt(x, 10); });
    if (r.length === 4 && r.every(function (x) { return x > 0; })) {
      R.ef = r[0]; R.et = r[1]; R.sf = r[2]; R.st = r[3]; norm();
    }
  })();

  HUB.add('use', {
    /** 区画の外で選ばれた素材（`I` + アイテム id）。系統に入っていなければ pick は null */
    pick: function (key) {
      var id = String(key || '').replace(/^I/, '');
      var m = C.mat[id];
      mid = m ? id : null;
      pick = (m && fams[family(m)]) ? family(m) : null;
      draw();
    },
    seg: seg,
    /** 元の oopart の `#note` のように種類だけ来たとき、その種類で名前順の先頭の系統 */
    first: function (kind) { return famList(kind)[0] || ''; },
    /** 系統の 4 段（`I` + id）。段が無ければ空 */
    tiers: function (f) {
      return fams[f] ? fams[f].tiers.map(function (id) { return id ? 'I' + id : ''; }) : [];
    },
    /** カードの一言。使う生徒の人数 */
    note: function () {
      if (!pick) return 'スキルのレベル上げには使いません。';
      return '<b>' + KIND_JA[fams[pick].k] + '</b>／' + fams[pick].n + 'の仲間を使う生徒は <b>' +
        el('o-n').textContent + ' 人</b>（' + rangeText(true) + '）。';
    }
  });

  el('ver').textContent = C.fetched;
  drawRange();
  drawSort();
})();
