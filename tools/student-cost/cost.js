/* 生徒の育成計算機の「総額」の区画（元の「生徒 1 人の育成費用」）。data.js（window.COST）を読んで、
   今 → 目標の差ぶんを足し合わせる。

   **2026-09-26 に星上げ（eleph）・潜在解放（potential）と 1 本にまとめた。**生徒は区画の外の
   欄で 1 回だけ選び、index.html の `window.SCHUB` がこの区画へ `pick()` で渡す。
   カード（顔と名前）も SCHUB が描く。この区画は自分の入力と結果だけを持つ。

   段の数え方は全部これ。**「今」の段は済んでいて、「目標」の段はまだ。**
   たとえば EX を 1 → 3 にするなら、レシピの段 0（Lv1→2）と段 1（Lv2→3）を足す。
   配列の添字と「今の値」がそのままずれるので、from-1 から to-2 まで、で統一する。 */
(function () {
  'use strict';
  var C = window.COST;
  var HUB = window.SCHUB;
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
    { k: 'wp',  nm: '固有武器',       sub: '生徒の★5 で手に入り、★—',       min: 1, slot: 'wp', weapon: true },
    { k: 'gr',  nm: '愛用品',         sub: 'T1 で手に入り、T—',              min: 1, slot: 'gr', gear: true }
  ];

  var state = {};                  // state[k] = { f: 今, t: 目標 }
  ROWS.forEach(function (r) { state[r.k] = { f: r.min, t: r.min }; });
  state.lv = { f: 1, t: LVMAX };

  /* ------------------------------------------------------------ 装備 3 部位

     **2026-09-26 に足した**（先生の判断 Q2-1）。部位は生徒ごとに決まっていて
     （`stu[].eq`、ゲームの装備欄の順）、1 行に「今の Tier/Lv → 目標の Tier/Lv」を持つ。

     **数え方は深掘り側の 2 本と同じ。**別の数え方を作ると、リンクで飛んだ先と合わない。
       Tier 上げ  装備設計図の周回計算機と同じレシピ（`eq.rec[部位][T]` が T-1 → T の 1 段）
       レベル     装備の強化珠計算機の rowExp() をそのまま写した。**Tier が上がると
                  Lv1 に戻る**ので、途中の Tier は上限まで上げきった経験値を足す */
  var EQ = C.eq;
  var EQMAX = EQ.maxLv.length;       // 10
  function eqMaxLv(t) { return EQ.maxLv[t - 1]; }
  function eqCum(t, l) { var a = EQ.cum[String(t)]; return a[Math.max(1, Math.min(l, eqMaxLv(t)))]; }
  function eqExp(e) {
    if (e.t1 < e.t0 || (e.t1 === e.t0 && e.l1 <= e.l0)) return 0;
    if (e.t1 === e.t0) return eqCum(e.t0, e.l1) - eqCum(e.t0, e.l0);
    var x = eqCum(e.t0, eqMaxLv(e.t0)) - eqCum(e.t0, e.l0);
    for (var t = e.t0 + 1; t < e.t1; t++) x += eqCum(t, eqMaxLv(t));
    return x + eqCum(e.t1, e.l1);
  }
  /** Tier を t0 → t1 に上げる設計図とクレジット。 */
  function eqTier(cat, t0, t1) {
    var out = { credit: 0, mats: {} };
    for (var t = t0 + 1; t <= t1; t++) {
      var r = (EQ.rec[cat] || {})[String(t)];
      if (!r) continue;
      out.credit += r[0];
      r[1].forEach(function (m) { out.mats[m[0]] = (out.mats[m[0]] || 0) + m[1]; });
    }
    return out;
  }
  /** 範囲に収める。**目標は今より下げない**（同じ Tier なら Lv も） */
  function eqNorm(e) {
    var c = function (v, a, b) { v = Math.floor(+v || 0); return Math.min(Math.max(v, a), b); };
    e.t0 = c(e.t0, 1, EQMAX); e.l0 = c(e.l0, 1, eqMaxLv(e.t0));
    e.t1 = c(e.t1, e.t0, EQMAX); e.l1 = c(e.l1, e.t1 === e.t0 ? e.l0 : 1, eqMaxLv(e.t1));
    return e;
  }
  function eqBlank() { return { t0: 1, l0: 1, t1: 1, l1: 1 }; }
  var eqs = [eqBlank(), eqBlank(), eqBlank()];

  /* ------------------------------------------------------------ 固有武器の Lv

     **2026-09-26 に固有武器の強化計算機（tools/weapon/）から移した**（先生の判断 Q5-1。
     weapon は廃止）。数え方は weapon と同じ:
       経験値   WX.cum[L] が Lv1 から Lv L まで。a → b は cum[b] - cum[a]
       上限     武器の★で決まる（WX.maxLv[★-1]。★1 Lv30 … ★4 Lv60）。日本の上限 WX.jpLv で頭を押さえる
       クレジット  **数えない。**weapon も出していなかった（WeaponLvUpCoefficient はあるが
                実機で突き合わせていない）
     ★は上の「固有武器」行（state.wp）がそのまま使う。**Lv は ROWS に入れない。**
     入れるとハッシュの並びがずれて、古い URL が開けなくなる */
  var WX = C.wx;
  function wcap(s) { return Math.min(WX.maxLv[Math.max(1, s) - 1] || WX.jpLv, WX.jpLv); }
  function wexp(a, b) { return Math.max(0, (WX.cum[b] || 0) - (WX.cum[a] || 0)); }
  var wl = { f: 1, t: 1 };
  /** 範囲に収める。今は今の★の上限まで、目標は目標の★の上限までで、今より下げない */
  function wlNorm() {
    var c = function (v, a, b) { v = Math.floor(+v || 1); return Math.min(Math.max(v, a), b); };
    wl.f = c(wl.f, 1, wcap(state.wp.f));
    wl.t = c(wl.t, wl.f, wcap(state.wp.t));
  }
  /** その生徒の武器で 1.5 倍になる系統（撃針はどの武器種でも入る） */
  function wHot() {
    return (student && student.wt && WX.bonus[student.wt]) || [];
  }
  function wHotText() {
    return wHot().map(function (k) { return WX.ja[k]; }).join('と') + 'が 1.5 倍';
  }

  /* 手持ちのレポート。**初級・中級・上級・最上級の順**（C.rep は経験値の小さい順） */
  var own = [0, 0, 0, 0];

  /* 潜在解放も足すか。**既定は足さない**（まとめる前の数字と変えないため）。
     足すのは「潜在」の区画の今 → 目標のぶんで、pot.js の `SCHUB.secs.pot.total()` から読む。
     星上げ（神名文字）はもともと「星」と「固有武器」の行で数えているので、足す口は作らない */
  var incPot = false;

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

  /* 行から深掘りツールへ。**同じ生徒・同じ今/目標のまま飛ぶ**（Q1-1）。
     ハッシュの形は相手の shareUrl() と fromHash() に合わせてある。
       星上げ       同じページの「星上げ」の区画（`data-star="今.目標"`。段 1〜5 が★1〜★5）。
                    2026-09-26 まで ../eleph/#生徒id|今|目標 へ飛んでいた。押したときの動きは index.html
       （固有武器の計算機は 2026-09-26 に廃止。Lv はこのページの「固有武器の Lv」行で数える）
       装備の強化珠 ../equipment/#pane=level&lv=T.Lv.T.Lv.1   （装備の計算機の「強化珠」の区画。
                    2026-09-26 に equip-level をまとめた。元の #T.Lv.T.Lv.1 と同じ中身を lv= に入れる）
       装備の設計図 ../equipment/#pane=farm           （在庫の eq= は渡さない。渡すと向こうに
                    覚えている在庫を 0 で上書きしてしまう。pane=farm は区画を開くためだけ） */
  function link(href, text) {
    return '<a href="' + href + '">' + text + '</a>';
  }
  function rowLinks(r) {
    if (!student) return '';
    var st = state[r.k];
    if (r.star) return '<a href="#pane=star" data-star="' + st.f + '.' + st.t + '">星上げの区画</a>';
    return '';
  }

  /** 固有武器の Lv の行。**★の行のすぐ下。**上限は★の行で決まる */
  function wlRow(ok) {
    wlNorm();
    var dis = ok ? '' : ' disabled';
    var sel = function (w, a, b) {
      var s = '<select data-wl="' + w + '" aria-label="固有武器の' + (w === 'f' ? '今' : '目標') + 'の Lv"' + dis + '>';
      for (var v = a; v <= b; v++) s += '<option value="' + v + '"' + (wl[w] === v ? ' selected' : '') + '>Lv' + v + '</option>';
      return s + '</select>';
    };
    var sub = ok ? '★' + state.wp.t + ' なら Lv' + wcap(state.wp.t) + ' まで'
                 : (student ? 'この子には固有武器がありません' : '先に生徒を選んでください');
    var hot = '';
    if (ok && wHot().length) {
      hot = '<span class="hot">' + wHot().map(function (k) {
          return '<img src="../img/' + WX.top[k].i + '.webp" alt="" width="18" height="18" loading="lazy">';
        }).join('') + wHotText() +
        '<button type="button" class="qm" data-hint="武器パーツは 4 系統（' + WX.order.map(function (k) { return WX.ja[k]; }).join('・') +
        '）あり、武器種に合う系統だけ経験値が 1.5 倍になります。' + student.n + 'の武器種は ' + student.wt + '。' +
        WX.ja.Z + 'はどの武器種でも 1.5 倍です。1 個の経験値は 4 系統とも 10／50／200／1,000（1.5 倍の前）。"></button></span>';
    }
    return '<div class="goal wl' + (ok ? '' : ' off') + '">' +
      '<span class="nm">固有武器の Lv<small>' + sub + '</small>' + hot + '</span>' +
      sel('f', 1, wcap(state.wp.f)) + '<span class="ar">→</span>' + sel('t', wl.f, wcap(state.wp.t)) + '</div>';
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
        sub = (r.weapon ? '生徒の★5 で手に入り、★' : 'T1 で手に入り、T') + b + ' まで上がる';
      }
      if (!ok) {
        sub = !student ? '先に生徒を選んでください'
            : (r.weapon ? 'この子には固有武器がありません'
            : r.gear ? 'この子には愛用品がありません' : 'この子には段がありません');
      }
      var lk = ok ? rowLinks(r) : '';
      h += '<div class="goal' + (ok ? '' : ' off') + '">' +
        '<span class="nm">' + r.nm + '<small>' + sub + '</small>' +
        (lk ? '<span class="lk">' + lk + '</span>' : '') + '</span>' +
        sel('f') + '<span class="ar">→</span>' + sel('t') + '</div>';
      if (r.weapon) h += wlRow(ok);
    });

    // 装備 3 部位。**1 マスに Tier と Lv を縦に 2 つ**（横に並べるとスマホで入らない）
    eqs.forEach(function (e, i) {
      var cat = student ? student.eq[i] : null;
      eqNorm(e);
      var dis = cat ? '' : ' disabled';
      var opts = function (a, b, cur, pre) {
        var o = '';
        for (var v = a; v <= b; v++) o += '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + pre + v + '</option>';
        return o;
      };
      var side = function (w) {
        var t = w === 'f' ? e.t0 : e.t1, l = w === 'f' ? e.l0 : e.l1;
        var ta = w === 'f' ? 1 : e.t0, la = (w === 't' && e.t1 === e.t0) ? e.l0 : 1;
        return '<span class="eqc">' +
          '<select data-e="' + i + '" data-w="' + (w === 'f' ? 't0' : 't1') + '" aria-label="' +
            (w === 'f' ? '今' : '目標') + 'の Tier"' + dis + '>' + opts(ta, EQMAX, t, 'T') + '</select>' +
          '<select data-e="' + i + '" data-w="' + (w === 'f' ? 'l0' : 'l1') + '" aria-label="' +
            (w === 'f' ? '今' : '目標') + 'の Lv"' + dis + '>' + opts(la, eqMaxLv(t), l, 'Lv') + '</select></span>';
      };
      var lk = '';
      if (cat) {
        lk = link('../equipment/#pane=level&lv=' + [e.t0, e.l0, e.t1, e.l1, 1].join('.'), '強化珠の計算機');
        if (e.t1 > e.t0) lk += link('../equipment/#pane=farm', '設計図の周回');
      }
      h += '<div class="goal eq' + (cat ? '' : ' off') + '">' +
        '<span class="nm">' + (cat ? EQ.catJa[cat] : '装備 ' + (i + 1)) +
        '<small>' + (cat ? '装備 ' + (i + 1) + ' 枠目' : '先に生徒を選んでください') + '</small>' +
        (lk ? '<span class="lk">' + lk + '</span>' : '') + '</span>' +
        side('f') + '<span class="ar">→</span>' + side('t') + '</div>';
    });

    /* 潜在解放。**「潜在」の区画の今 → 目標をそのまま足す**（ここでは段を選ばない）。
       生徒を選ぶまでは押せない（オーパーツが生徒で決まる） */
    var P = potRange();
    h += '<div class="goal inc' + (student ? '' : ' off') + '">' +
      '<span class="nm">潜在解放<small>' + (student ? (P ? P : '「潜在」の区画で段を決めます') : '先に生徒を選んでください') + '</small>' +
      '<span class="lk"><a href="#pane=pot" data-go="pot">潜在の区画</a></span></span>' +
      '<label class="incbox"><input type="checkbox" id="i-incpot"' + (incPot ? ' checked' : '') + (student ? '' : ' disabled') + '> 総額に足す' +
      '<button type="button" class="qm" data-hint="「潜在」の区画で選んだ今 → 目標のオーパーツ・応用 WB・クレジットを、この区画の合計に足します。星上げの神名文字は、上の「星」と「固有武器」の行で数えています。"></button></label></div>';
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

  /** 「潜在」の区画の段（表示用）。区画がまだ無ければ null */
  function potRange() {
    var pt = HUB.secs.pot;
    if (!pt || !student) return null;
    var t = pt.total();
    return t.label;
  }

  function merge(dst, src) {
    Object.keys(src).forEach(function (k) { dst[k] = (dst[k] || 0) + src[k]; });
  }

  /* 要る素材の見出し。**データの `k`（build の mat_kind）でそのまま割れる区分だけ。**
     秘伝ノートは技術ノートの最後の 1 冊なので同じ見出しに入れる。
     愛用品の T1→T2 に使う贈り物などは「その他」 */
  var MGROUP = [
    { k: ['stone'], n: '神名文字' },
    { k: ['oopart'], n: 'オーパーツ' },
    { k: ['note', 'ult'], n: '技術ノート' },
    { k: ['bd'], n: '戦術教育BD' },
    { k: ['eqp'], n: '装備の設計図' },
    { k: ['wb'], n: '応用WB' },
    { k: [], n: 'その他' }
  ];
  /** 並べる鍵 [系統の順, 系統名]。系統の順は、その系統でいちばん小さい Id */
  function series(k) {
    var m = C.mat[k] || {};
    if (m.k === 'eqp') return [student ? student.eq.indexOf(m.c) : 0, m.c];
    if (m.k === 'ult') return [1e9, 'ult'];       // 技術ノートの最後
    var base = String(m.i || '').replace(/_\d+$/, '');
    return [parseInt(k, 10) - (m.t || 0), base];
  }

  /* ---- レポートの手持ち。**欄は 1 度だけ組む。**打つたびに組み直すと焦点が飛ぶ */
  var lastExp = 0;
  (function buildRep() {
    el('reps').innerHTML = C.rep.map(function (r, i) {
      return '<label class="rep">' +
        '<img src="../img/' + r.i + '.webp" alt="" width="36" height="36" loading="lazy">' +
        '<span class="k">' + r.n + '<small>1 枚 ' + fmt(r.e) + '</small></span>' +
        '<input id="own-' + i + '" type="number" inputmode="numeric" min="0" step="1" placeholder="0"' +
        ' aria-label="' + r.n + 'の手持ち"></label>';
    }).join('');
    C.rep.forEach(function (r, i) {
      el('own-' + i).addEventListener('input', function () {
        own[i] = Math.max(0, Math.floor(+this.value || 0));
        drawRep();
      });
    });
  })();
  function drawRep() {
    var have = 0;
    C.rep.forEach(function (r, i) { have += own[i] * r.e; });
    var top = C.rep[C.rep.length - 1], say = el('rep-say');
    say.classList.remove('ok', 'short');
    if (lastExp <= 0) { say.textContent = 'レベルは上げないので、レポートは要りません。'; return; }
    if (have >= lastExp) {
      say.classList.add('ok');
      say.innerHTML = '<b>足ります。</b>' + fmt(have - lastExp) + ' 経験値あまります。';
    } else {
      say.classList.add('short');
      say.innerHTML = 'あと<b>' + top.n + ' ' + fmt(Math.ceil((lastExp - have) / top.e)) +
        ' 枚ぶん</b>足りません（' + fmt(lastExp - have) + ' 経験値）。';
    }
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

    // 装備。**強化珠の経験値はレベルの経験値と混ぜない**（食べさせるものが違う）
    var eqx = 0;
    if (student) {
      eqs.forEach(function (e, i) {
        var cat = student.eq[i];
        var x = eqExp(e), tu = eqTier(cat, e.t0, e.t1);
        if (x <= 0 && tu.credit <= 0) return;
        eqx += x;
        merge(mats, tu.mats);
        var lc = x * EQ.coef;
        credit += lc + tu.credit;
        var note = [];
        if (tu.credit > 0) note.push('Tier ' + fmt(tu.credit));
        if (lc > 0) note.push('強化 ' + fmt(lc));
        lines.push([EQ.catJa[cat] + ' T' + e.t0 + ' Lv' + e.l0 + ' → T' + e.t1 + ' Lv' + e.l1 +
                    '<span class="subnote">' + note.join('・') + '</span>', lc + tu.credit]);
      });
    }

    // 固有武器の Lv。**経験値は別に出す**（食べさせるのは武器パーツ）。クレジットは数えない
    var wx = 0;
    if (avail(ROWS.filter(function (r) { return r.weapon; })[0])) { wlNorm(); wx = wexp(wl.f, wl.t); }

    /* 潜在解放（足すと決めたときだけ）。オーパーツは data.js の素材の Id と同じ番号
       （欠片が student.a、壊れたほうが +1）。応用 WB は data.js に無いので、pot.js が
       `C.mat` に足した行（Id 2000〜2002、k: 'wb'）で並べる */
    var pt = HUB.secs.pot;
    if (incPot && student && pt) {
      var pv = pt.total();
      if (pv.cr > 0 || pv.a0 || pv.a1) {
        credit += pv.cr;
        var pm = {};
        if (pv.a0) pm[pv.art] = pv.a0;
        if (pv.a1) pm[pv.art + 1] = pv.a1;
        pv.bk.forEach(function (n, i) { if (n) pm[pv.bkId[i]] = n; });
        merge(mats, pm);
        lines.push(['潜在解放<span class="subnote">' + pv.label + '</span>', pv.cr]);
      }
    }

    // ---- 表示
    el('o-credit').textContent = fmt(credit);
    el('o-credit-sub').textContent = credit > 0
      ? '合計。レベル上げのぶんが ' + fmt(lvCredit) + '（' + Math.round(lvCredit / credit * 100) + '%）'
      : '今と目標が同じです';

    el('o-exp').textContent = fmt(exp);
    el('o-exp-sub').textContent = exp > 0
      ? '最上級レポート ' + fmt(Math.ceil(exp / 10000)) + ' 枚ぶん'
      : 'レベルは上げません';

    var gTop = EQ.gems[EQ.gems.length - 1];
    el('o-eqexp').textContent = fmt(eqx);
    el('o-eqexp-sub').textContent = eqx > 0
      ? gTop.n + ' ' + fmt(Math.ceil(eqx / gTop.e)) + ' 個ぶん'
      : '装備のレベルは上げません';

    var wTop = WX.top.Z;              // 撃針はどの武器種でも 1.5 倍
    el('o-wpexp').textContent = fmt(wx);
    el('o-wpexp-sub').textContent = wx > 0
      ? 'Lv' + wl.f + ' → Lv' + wl.t + '。' + wTop.n + '（1.5 倍）' + fmt(Math.ceil(wx / (wTop.e * 1.5))) + ' 個ぶん'
      : '固有武器のレベルは上げません';

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

    // レポート。**手持ちと比べて 1 行**（Q2-2。1 種類だけで埋めた枚数の 4 枚札はやめた）
    lastExp = exp;
    drawRep();

    /* 素材。**種類ごとの見出しで割り、同じ系統は段の順**（Q2-3。2026-09-26 まで
       多い順に 1 列で並べていて、欠片と完全なが離れていた）。
       系統はアイコンの名前から末尾の段を落としたもの（nebra_0〜_3 が 1 系統）。
       設計図は部位が系統で、装備欄の順に並べる */
    var groups = MGROUP.map(function (g) { return { g: g, ids: [] }; });
    ids.forEach(function (k) {
      var kind = (C.mat[k] || {}).k;
      var gi = 0;
      for (var i = 0; i < MGROUP.length; i++) {
        if (MGROUP[i].k.indexOf(kind) >= 0) { gi = i; break; }
        if (!MGROUP[i].k.length) gi = i;          // 最後の「その他」が受け皿
      }
      groups[gi].ids.push(k);
    });
    el('mats').innerHTML = groups.filter(function (x) { return x.ids.length; }).map(function (x) {
      x.ids.sort(function (a, b) {
        var ka = series(a), kb = series(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
        return ((C.mat[a] || {}).t || 0) - ((C.mat[b] || {}).t || 0);
      });
      var n = 0;
      x.ids.forEach(function (k) { n += mats[k]; });
      return '<h3 class="mh">' + x.g.n + '<small>' + x.ids.length + ' 種・' + fmt(n) + ' 個</small></h3>' +
        '<div class="mats">' + x.ids.map(function (k) {
          var m = C.mat[k] || { n: '？', i: 'item_icon_expitem_0', s: 0 };
          return '<div class="mat' + (m.s ? ' stone' : '') + '">' +
            '<img src="../img/' + m.i + '.webp" alt="" width="44" height="44" loading="lazy">' +
            '<span class="tx"><span class="nm">' + m.n + '</span>' +
            '<span class="ct">' + fmt(mats[k]) + '</span></span></div>';
        }).join('') + '</div>';
    }).join('');
    el('mat-lead').textContent = ids.length === 0
      ? '今と目標が同じなので、要る素材はありません。'
      : (student ? student.n : 'この目標') + 'を今の状態から目標まで上げるのに、' +
        ids.length + ' 種類・' + fmt(total) + ' 個です。';
  }

  /* ------------------------------------------------------------ 入力 */

  var byId = {};
  C.stu.forEach(function (s) { byId[s.id] = s; });

  /** 生徒を選ぶ。**名前の欄は区画の外（index.html の SCHUB）**で、ここには Id で来る */
  function pickStudent(id) {
    var found = byId[id] || NONE;
    if (found === student) return;
    student = found;
    // 星の下限は生徒で変わる。**選び直したら今の値も持ち上げる**
    if (student && state.tr.f < student.r) state.tr = { f: student.r, t: student.r };
    drawGoals();
    calc();
  }
  /** カードの一言（この区画を開いているとき） */
  function note() {
    if (!student) return '選ぶまではレベルのぶんだけ数えています。';
    var has = [];
    if ((student.wp || []).length) has.push('固有武器あり');
    if ((student.gr || []).length) has.push('愛用品あり');
    return '初期★' + student.r +
      (has.length ? '。' + has.join('・') : '。固有武器も愛用品もありません') + '。';
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
    /* 固有武器の Lv。**★と同じ扱い**: 「ぜんぶ最大まで」だけ Lv1 → 目標の★の上限、
       ほかは★と同じく上げない（Lv1 のまま） */
    wl = b.dataset.p === 'all' ? { f: 1, t: wcap(state.wp.t) } : { f: 1, t: 1 };
    /* 装備。**「ぜんぶ最大まで」だけ T1 Lv1 → 最上 Tier の上限 Lv。**
       「キリのいい Lv まで」の根拠（Wiki のスキルの話）は装備に言っていないので、
       星・固有武器・愛用品と同じく上げない */
    if (student) {
      eqs = eqs.map(function () {
        return b.dataset.p === 'all' ? { t0: 1, l0: 1, t1: EQMAX, l1: eqMaxLv(EQMAX) } : eqBlank();
      });
    }
    [].forEach.call(el('preset').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.p === b.dataset.p));
    });
    drawGoals();
    calc();
    HUB.changed('total');
  });

  el('goals').addEventListener('click', function (ev) {
    // 潜在の欄のチェック。**change ではなくここで拾う**と select の change と混ざらない
    var c = ev.target.closest('#i-incpot'); if (!c) return;
    incPot = c.checked;
    calc();
    HUB.changed('total');
  });

  el('goals').addEventListener('change', function (ev) {
    var s = ev.target.closest('select'); if (!s) return;
    if (s.dataset.e !== undefined) {
      var e = eqs[+s.dataset.e], w = s.dataset.w, n = parseInt(s.value, 10);
      e[w] = n;
      // **目標の Tier を上げたら Lv もその上限へ。**T を上げて Lv1 のままだと数え損ねる
      if (w === 't1') e.l1 = eqMaxLv(n);
      // 今を目標より上げたら、目標も持ち上げる
      if (w === 't0' || w === 'l0') {
        if (e.t0 > e.t1 || (e.t0 === e.t1 && e.l0 > e.l1)) { e.t1 = e.t0; e.l1 = e.l0; }
      }
      [].forEach.call(el('preset').querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', 'false');
      });
      drawGoals();
      calc();
      HUB.changed('total');
      return;
    }
    if (s.dataset.wl !== undefined) {
      wl[s.dataset.wl] = parseInt(s.value, 10);
      if (wl.t < wl.f) wl.t = wl.f;
    } else {
      var st = state[s.dataset.k], v = parseInt(s.value, 10);
      st[s.dataset.w] = v;
      if (st.t < st.f) st[s.dataset.w === 'f' ? 't' : 'f'] = v;
      // **固有武器の目標★を変えたら、目標 Lv もその上限へ**（weapon と同じ作法）。
      // ★を上げて Lv が 30 のままだと、何のために★を上げたのか分からなくなる
      if (s.dataset.k === 'wp' && s.dataset.w === 't') wl.t = wcap(v);
    }
    // **手で変えたらプリセットの押下表示を消す。**もうその組み合わせではない
    [].forEach.call(el('preset').querySelectorAll('button'), function (x) {
      x.setAttribute('aria-pressed', 'false');
    });
    drawGoals();
    calc();
    HUB.changed('total');
  });

  /* ---- 状態を URL に残す。**区画の中身は `t=` の 1 区画**で、生徒は区画の外の `s=`。
     `t=` の中身は、まとめる前の student-cost のハッシュから先頭の生徒 id を外したもの:

       `f.t|f.t|…（ROWS の 8 行）|T.Lv.T.Lv|…（装備 3 行）|初.中.上.最（手持ちのレポート）|今Lv.目標Lv（固有武器）|1（潜在も足す）`

     **後ろに足しただけ**なので、2026-09-26 より前の `#生徒id|f.t|…` 8 行ぶんの
     URL も、固有武器の Lv を足す前の 13 区切りの URL も、潜在を足す前の 14 区切りも
     そのまま開ける（装備は今＝目標、手持ちは 0、固有武器は Lv1、潜在は足さない）。
     古い `#生徒id|…` は index.html の頭の script が `s=` と `t=` に組み替えてから、ここへ来る。
     廃止した tools/weapon/ の転送ページもこの古い形を組んで渡してくる */
  function seg() {
    var p = [];
    ROWS.forEach(function (r) { p.push(state[r.k].f + '.' + state[r.k].t); });
    eqs.forEach(function (e) { p.push([e.t0, e.l0, e.t1, e.l1].join('.')); });
    p.push(own.join('.'));
    p.push(wl.f + '.' + wl.t);
    if (incPot) p.push('1');
    return p.join('|');
  }
  (function fromHash() {
    // 生徒は区画の外（`s=`）。`t=` が無くても、生徒だけは選んでおく
    var sid = HUB.sid;
    if (sid > 0 && byId[sid]) {
      el('i-student').value = byId[sid].n;
      pickStudent(sid);
    }
    var h = HUB.seg.t;
    if (!h) return;
    // **古い形のまま読む。**先頭に生徒 id の欄を戻して、添字をまとめる前と揃える
    var p = [String(sid || 0)].concat(h.split('|'));
    if (p.length < 1 + ROWS.length) return;
    ROWS.forEach(function (r, i) {
      var q = String(p[i + 1]).split('.');
      if (+q[0] >= 1) state[r.k].f = Math.floor(+q[0]);
      if (+q[1] >= 1) state[r.k].t = Math.floor(+q[1]);
    });
    // 範囲を超えたぶんは drawGoals() が lo()/hi() に収める（装備は eqNorm()）
    var at = 1 + ROWS.length;
    eqs.forEach(function (e, i) {
      var q = String(p[at + i] || '').split('.').map(Number);
      if (q.length !== 4 || q.some(isNaN)) return;
      eqs[i] = eqNorm({ t0: q[0], l0: q[1], t1: q[2], l1: q[3] });
    });
    String(p[at + 3] || '').split('.').forEach(function (v, i) {
      v = Math.floor(+v || 0);
      if (i < own.length && v > 0) { own[i] = v; el('own-' + i).value = v; }
    });
    var q = String(p[at + 4] || '').split('.').map(Number);
    if (q.length === 2 && q[0] >= 1 && q[1] >= 1) wl = { f: q[0], t: q[1] };   // 範囲は wlNorm() が収める
    incPot = p[at + 5] === '1';
  })();

  var lvTotal = 0;
  for (var i = 0; i < C.need.length; i++) lvTotal += C.need[i];
  el('src-total').textContent = fmt(lvTotal);
  el('src-lvcost').textContent = fmt(lvTotal * C.creditPerExp);
  el('src-gear').textContent = C.stu.filter(function (s) { return (s.gr || []).length; }).length;
  el('ver').textContent = C.fetched;

  /* ---- 区画の外（index.html の SCHUB）へ渡す口 */
  HUB.add('total', {
    pick: pickStudent,
    note: note,
    seg: seg,
    /** 潜在解放を足しているか（共有 URL に `p=` も載せるかどうか） */
    inc: function () { return incPot && !!student; },
    /** 潜在の区画が変わったとき。**足しているときだけ**数え直す（欄の一言は常に直す） */
    refresh: function () { drawGoals(); calc(); },
    /** 生徒が選べなかったことにする（名前の欄を空にしたとき） */
    none: function () { pickStudent(0); }
  });

  drawGoals();
  calc();
})();
