/* 生徒 1 人の育成費用。data.js（window.COST）を読んで、今 → 目標の差ぶんを足し合わせる。

   段の数え方は全部これ。**「今」の段は済んでいて、「目標」の段はまだ。**
   たとえば EX を 1 → 3 にするなら、レシピの段 0（Lv1→2）と段 1（Lv2→3）を足す。
   配列の添字と「今の値」がそのままずれるので、from-1 から to-2 まで、で統一する。 */
(function () {
  'use strict';
  var C = window.COST;
  var el = function (id) { return document.getElementById(id); };
  var NONE = null;                 // 生徒を選ぶ前
  var student = NONE;
  /* レベルの上限。**need の行数がそのまま上限**（いまは 90。最終行は 0 で、
     「Lv90 から先は無い」の意味）。90 と手で書いていると、上限が上がった日に
     選択肢だけ古いまま残る——固有武器が★3 で取り残されていたのと同じ壊れ方
     （2026-08-31 の先生の指摘。teacher-level・bond と同じ作法に揃えた） */
  var LVMAX = C.need.length;

  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }

  /* ------------------------------------------------------------ 育てるところ

     min / max は「その項目が取りうる値」。step は段の配列で、
     値 v から v+1 へ上がるのに使うのが step[v - min]。 */
  var ROWS = [
    { k: 'lv',  nm: 'レベル',        sub: 'Lv1 〜 Lv' + LVMAX,             min: 1, max: LVMAX },
    { k: 'ex',  nm: 'EX スキル',      sub: '戦術教育 BD で上げるところ',     min: 1, slot: 'ex' },
    { k: 'sk1', nm: 'ノーマルスキル', sub: '技術ノート。Lv10 は秘伝ノート',  min: 1, slot: 'sk' },
    { k: 'sk2', nm: 'パッシブスキル', sub: 'ノーマルと同じ表',               min: 1, slot: 'sk' },
    { k: 'sk3', nm: 'サブスキル',     sub: 'ノーマルと同じ表',               min: 1, slot: 'sk' },
    { k: 'tr',  nm: '星（神秘開放）',  sub: 'その子の初期★から★5 まで',      min: 1, slot: 'tr', star: true },
    { k: 'wp',  nm: '固有武器',       sub: '★3 で手に入り、★—',             min: 1, slot: 'wp', weapon: true },
    { k: 'gr',  nm: '愛用品',         sub: 'T1 で手に入り、T—',              min: 1, slot: 'gr', gear: true }
  ];

  var state = {};                  // state[k] = { f: 今, t: 目標 }
  ROWS.forEach(function (r) { state[r.k] = { f: r.min, t: r.min }; });
  state.lv = { f: 1, t: LVMAX };

  /** その項目が今の生徒で使えるか。使えない行は畳んで選べなくする。 */
  function avail(r) {
    if (!r.slot) return true;
    // **生徒を選ぶまでは、レベル以外は数えない。**素材もクレジットも生徒ごとに違う
    if (!student) return false;
    return (student[r.slot] || []).length > 0;
  }

  /* 段の配列の起点。**どの項目も 1 段目が「1 → 2」**なので 1 で揃っている
     （星は★1→★2、固有武器は★1→★2、愛用品は T1→T2）。
     星だけは「選べる下限」が初期★でこことずれるので、lo() を別に持っている。 */
  var BASE = 1;

  /** 選べる下限。星は初期★より下げられない。 */
  function lo(r) {
    if (r.star && student) return student.r;
    return r.min;
  }

  /** 選べる上限。段の数で決まるので、固有武器と愛用品は生徒によって変わる。 */
  function hi(r) {
    if (!r.slot) return r.max;
    var n = student ? (student[r.slot] || []).length : 0;
    return BASE + n;
  }

  /* 効果の伸びが大きくなる Lv。**データではなく攻略サイトの記載**
     （ブルアカ Wiki「スキル」: EX は Lv3・Lv5、それ以外は Lv4・Lv7・Lv10）。
     選択肢に ◎ を付けて、どこで止めると得かが見えるようにしている。 */
  var JUMP = { ex: [3, 5], sk: [4, 7, 10] };

  /** 表示用の値。mark を立てたときだけ ◎ を付ける（選択肢の中でだけ使う）。 */
  function opt(v, r, mark) {
    if (r.star || r.weapon) return '★' + v;
    if (r.gear) return 'T' + v;
    var j = mark && JUMP[r.slot];
    return 'Lv' + v + (j && j.indexOf(v) >= 0 ? ' ◎' : '');
  }

  function drawGoals() {
    var h = '';
    ROWS.forEach(function (r) {
      var ok = avail(r), a = lo(r), b = hi(r);
      var st = state[r.k];
      st.f = Math.min(Math.max(st.f, a), b);
      st.t = Math.min(Math.max(st.t, st.f), b);
      var sel = function (which) {
        var s = '<select data-k="' + r.k + '" data-w="' + which + '"' + (ok ? '' : ' disabled') + '>';
        for (var v = a; v <= b; v++) {
          s += '<option value="' + v + '"' + (st[which] === v ? ' selected' : '') + '>' + opt(v, r, true) + '</option>';
        }
        return s + '</select>';
      };
      /* **上限はデータから書く。**「★3 まで上がる」と手で書いていたころ、
         日本が★4 になっても文だけ残って気づけなかった（2026-08-31 の先生の
         指摘）。段の数から出せば、データが増えた日に勝手に追いつく */
      var sub = r.sub;
      if (r.weapon || r.gear) {
        sub = (r.weapon ? '★3 で手に入り、★' : 'T1 で手に入り、T') + b + ' まで上がる';
      }
      if (!ok) {
        sub = !student ? '先に生徒を選んでください'
            : (r.weapon ? 'この子には固有武器がありません'
            : r.gear ? 'この子には愛用品がありません' : 'この子には段がありません');
      }
      h += '<div class="goal' + (ok ? '' : ' off') + '">' +
        '<span class="nm">' + r.nm + '<small>' + sub + '</small></span>' +
        sel('f') + '<span class="ar">→</span>' + sel('t') + '</div>';
    });
    el('goals').innerHTML = h;
  }

  /* ------------------------------------------------------------ 集計 */

  /** 段の配列 steps の from → to ぶんを足す。戻りは { credit, mats } */
  function sum(steps, from, to, base, times) {
    var out = { credit: 0, mats: {} };
    if (!steps) return out;
    times = times || 1;
    for (var v = from; v < to; v++) {
      var s = steps[v - base];
      if (!s) continue;
      out.credit += s[0] * times;
      s[1].forEach(function (m) { out.mats[m[0]] = (out.mats[m[0]] || 0) + m[1] * times; });
    }
    return out;
  }

  function merge(dst, src) {
    Object.keys(src).forEach(function (k) { dst[k] = (dst[k] || 0) + src[k]; });
  }

  function calc() {
    var mats = {}, lines = [], credit = 0;

    // レベル。need[L-1] が Lv L → L+1
    var f = state.lv.f, t = state.lv.t, exp = 0;
    for (var L = f; L < t; L++) exp += C.need[L - 1] || 0;
    var lvCredit = exp * C.creditPerExp;
    credit += lvCredit;
    if (exp > 0) lines.push(['レベル Lv' + f + ' → Lv' + t, lvCredit]);

    ROWS.forEach(function (r) {
      if (!r.slot || !avail(r)) return;
      var st = state[r.k];
      var got = sum(student ? student[r.slot] : null, st.f, st.t, BASE);
      if (st.t <= st.f) return;
      credit += got.credit;
      merge(mats, got.mats);
      lines.push([r.nm + ' ' + opt(st.f, r) + ' → ' + opt(st.t, r), got.credit]);
    });

    // ---- 表示
    el('o-credit').textContent = fmt(credit);
    el('o-credit-sub').textContent = credit > 0
      ? '合計。レベル上げのぶんが ' + fmt(lvCredit) + '（' + Math.round(lvCredit / credit * 100) + '%）'
      : '今と目標が同じです';

    el('o-exp').textContent = fmt(exp);
    el('o-exp-sub').textContent = exp > 0
      ? '最上級レポート ' + fmt(Math.ceil(exp / 10000)) + ' 枚ぶん'
      : 'レベルは上げません';

    var ids = Object.keys(mats).filter(function (k) { return mats[k] > 0; });
    var total = 0;
    ids.forEach(function (k) { total += mats[k]; });
    el('o-mat').textContent = fmt(total);
    el('o-mat-sub').textContent = ids.length > 0 ? ids.length + ' 種類' : '素材は要りません';

    // 内訳
    el('ledger').innerHTML = lines.length === 0
      ? '<div class="row"><span>上げるところがありません</span><span>—</span></div>'
      : lines.map(function (x) {
          return '<div class="row"><span>' + x[0] + '</span><span>' + fmt(x[1]) + '</span></div>';
        }).join('') +
        '<div class="row total"><span>合計</span><span>' + fmt(credit) + '</span></div>';

    // レポート
    el('reps').innerHTML = C.rep.map(function (r) {
      return '<div class="rep">' +
        '<img src="../img/' + r.i + '.webp" alt="" width="40" height="40" loading="lazy">' +
        '<div class="v">' + (exp > 0 ? fmt(Math.ceil(exp / r.e)) : '—') + '</div>' +
        '<div class="k">' + r.n + '<br>1 枚 ' + fmt(r.e) + '</div></div>';
    }).join('');

    // 素材。**多い順。**神名文字は種類が 1 つしか出てこないので先頭に固定する
    ids.sort(function (a, b) {
      var sa = (C.mat[a] || {}).s || 0, sb = (C.mat[b] || {}).s || 0;
      if (sa !== sb) return sb - sa;
      return mats[b] - mats[a];
    });
    el('mats').innerHTML = ids.map(function (k) {
      var m = C.mat[k] || { n: '？', i: 'item_icon_expitem_0', s: 0 };
      return '<div class="mat' + (m.s ? ' stone' : '') + '">' +
        '<img src="../img/' + m.i + '.webp" alt="" width="44" height="44" loading="lazy">' +
        '<span class="tx"><span class="nm">' + m.n + '</span>' +
        '<span class="ct">' + fmt(mats[k]) + '</span></span></div>';
    }).join('');
    el('mat-lead').textContent = ids.length === 0
      ? '今と目標が同じなので、要る素材はありません。'
      : (student ? student.n : 'この目標') + 'を今の状態から目標まで上げるのに、' +
        ids.length + ' 種類・' + fmt(total) + ' 個です。';
  }

  /* ------------------------------------------------------------ 入力 */

  function pickStudent(name) {
    var found = null;
    for (var i = 0; i < C.stu.length; i++) {
      if (C.stu[i].n === name) { found = C.stu[i]; break; }
    }
    if (found === student) return;
    student = found;
    var card = el('stucard');
    if (student) {
      card.classList.remove('none');
      el('stu-img').innerHTML = '<img src="../img/student_' + student.id + '.webp" alt="' +
        student.n + '" width="96" height="96">';
      el('stu-name').textContent = student.n;
      var has = [];
      if ((student.wp || []).length) has.push('固有武器あり');
      if ((student.gr || []).length) has.push('愛用品あり');
      el('stu-note').textContent = '初期★' + student.r +
        (has.length ? '。' + has.join('・') : '。固有武器も愛用品もありません') + '。';
      // 星の下限は生徒で変わる。**選び直したら今の値も持ち上げる**
      if (state.tr.f < student.r) state.tr = { f: student.r, t: student.r };
    } else {
      card.classList.add('none');
      el('stu-img').innerHTML = '<span class="ph">none</span>';
      el('stu-name').textContent = 'まだ誰も選んでいません';
      el('stu-note').textContent = '選ぶまではレベルのぶんだけ数えています。';
    }
    drawGoals();
    calc();
  }

  var PRESET = {
    all:  function (r) { return { f: lo(r), t: hi(r) }; },
    mid:  function (r) {
      // 「キリのいい Lv まで」。**根拠はブルアカ Wiki「スキル」**の
      // 「最大まで育成する余裕がない場合は数値が大きく上がるキリのいいLvを目指すと効率がいい」。
      // EX は最後の伸びが Lv5 なので上限まで、ほかは Lv7 で止める
      // （Lv10 はその 1 段だけで秘伝ノート 1 冊と 400 万クレジットが要る）
      if (r.k === 'lv') return { f: 1, t: LVMAX };
      if (r.slot === 'ex') return { f: 1, t: hi(r) };
      if (r.slot === 'sk') return { f: 1, t: Math.min(7, hi(r)) };
      return { f: lo(r), t: lo(r) };
    },
    none: function (r) { return { f: lo(r), t: lo(r) }; }
  };

  el('preset').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var fn = PRESET[b.dataset.p];
    ROWS.forEach(function (r) { if (avail(r)) state[r.k] = fn(r); });
    [].forEach.call(el('preset').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.p === b.dataset.p));
    });
    drawGoals();
    calc();
  });

  el('goals').addEventListener('change', function (ev) {
    var s = ev.target.closest('select'); if (!s) return;
    var st = state[s.dataset.k], v = parseInt(s.value, 10);
    st[s.dataset.w] = v;
    if (st.t < st.f) st[s.dataset.w === 'f' ? 't' : 'f'] = v;
    // **手で変えたらプリセットの押下表示を消す。**もうその組み合わせではない
    [].forEach.call(el('preset').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', 'false');
    });
    drawGoals();
    calc();
  });

  el('i-student').addEventListener('input', function () { pickStudent(this.value.trim()); });
  /* **確定（change）のときだけ前方一致で補完する。**入力中に補完すると
     打っている途中で別の生徒に飛ぶ（eleph と同じ作法）。
     それでも見つからなければ、黙らずにエラーを出す */
  el('i-student').addEventListener('change', function () {
    var name = this.value.trim(), err = el('err');
    err.hidden = true;
    var exact = false;
    for (var i = 0; i < C.stu.length; i++) if (C.stu[i].n === name) { exact = true; break; }
    if (name && !exact) {
      var low = name.toLowerCase(), hit = null;
      for (var j = 0; j < C.stu.length; j++) {
        if (C.stu[j].n.toLowerCase().indexOf(low) === 0) { hit = C.stu[j]; break; }
      }
      if (hit) { this.value = name = hit.n; }
      else { err.textContent = '「' + name + '」という生徒が見つかりません。名前を選び直してください。'; err.hidden = false; }
    }
    pickStudent(name);
  });

  el('students').innerHTML = C.stu.map(function (s) {
    return '<option value="' + s.n + '"></option>';
  }).join('');

  /* ---- 状態を URL に残す。**share.js が「結果を共有」のときに呼ぶ**
     （eleph などと同じ作法。これが無いと、共有バーの「開いている状態ごと
     URL になります」が嘘になる）。形は `#生徒id|f.t|f.t|…`（ROWS の順） */
  window.shareUrl = function () {
    var p = [student ? student.id : 0];
    ROWS.forEach(function (r) { p.push(state[r.k].f + '.' + state[r.k].t); });
    return '#' + p.join('|');
  };
  (function fromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var p = h.split('|');
    if (p.length < 1 + ROWS.length) return;
    var sid = parseInt(p[0], 10);
    if (sid > 0) {
      for (var i = 0; i < C.stu.length; i++) {
        if (C.stu[i].id === sid) {
          el('i-student').value = C.stu[i].n;
          pickStudent(C.stu[i].n);
          break;
        }
      }
    }
    ROWS.forEach(function (r, i) {
      var q = String(p[i + 1]).split('.');
      if (+q[0] >= 1) state[r.k].f = Math.floor(+q[0]);
      if (+q[1] >= 1) state[r.k].t = Math.floor(+q[1]);
    });
    // 範囲を超えたぶんは drawGoals() が lo()/hi() に収める
  })();

  var lvTotal = 0;
  for (var i = 0; i < C.need.length; i++) lvTotal += C.need[i];
  el('src-total').textContent = fmt(lvTotal);
  el('src-lvcost').textContent = fmt(lvTotal * C.creditPerExp);
  el('src-gear').textContent = C.stu.filter(function (s) { return (s.gr || []).length; }).length;
  el('ver').textContent = C.fetched;

  drawGoals();
  calc();
})();
