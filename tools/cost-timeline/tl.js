/* TL のコスト計算機。

   見ているのは 3 つ。
   ① 編成した 6 人（制約解除決戦なら 10 人）からコスト回復力を出す
   ② 並べた EX を上から順に置いて、コストの都合で撃てる時刻を出す
   ③ **その順番が手札の上で成り立つかを確かめる**

   ③ について。ブルアカのスキルカードは **山札 ＝ 編成人数、手札 ＝ 3 枚**で、
   使ったカードは山札の一番下に戻り、次のカードが順に引かれる。
   **並びが決まれば、そこから先は運が入らない。**開始スキルで最初の並びを
   指定できるので（通常編成 5 人・制約解除決戦 9 人。残り 1 人は自動で決まる）、
   TL は最後まで再現できる。撃ちたい子が手札に無ければ、そこで詰まる。 */
(function () {
  'use strict';
  var D = window.TL;
  var FPS = 30;                        // Duration はフレーム。ブルアカは 30fps
  var el = function (id) { return document.getElementById(id); };
  var byId = {};
  D.students.forEach(function (s) { byId[s.id] = s; });

  /* 通常は ストライカー 4 ＋ スペシャル 2、制約解除決戦は 6 ＋ 4。
     枠の数はモードで変わるが、**slots の並びは常に「ストライカーが先」**にしておき、
     使わない後ろの枠は空のまま持っておく（モードを戻したときに編成が消えない）。 */
  // **`start` は開始スキルで順番を指定できる人数。**2026-05-27 のアップデートで
  // 通常編成 3→5、制約解除決戦 5→9 に増えた。ここまでは並べたとおりに撃てる
  var LAYOUT = { 6: { main: 4, sup: 2, cap: 10, start: 5 },
                 10: { main: 6, sup: 4, cap: 20, start: 9 } };
  var MAIN_MAX = 6, SUP_MAX = 4;

  // **`-0` を出さない。**丸めた結果が 0 なのに符号だけ残ると「残り -0.0 コスト」になる
  function n1(v) { var r = Math.round(v * 10) / 10 || 0; return r.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function n2(v) { return (Math.round(v * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmt(v) { return Math.round(v).toLocaleString('ja-JP'); }
  function face(id) { return '../img/student_' + id + '.webp'; }
  /** 秒を M:SS.s にする。TL は分秒で書くのが普通なので、書き出しはこの形にする */
  function clock(sec) {
    var m = Math.floor(sec / 60), r = sec - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + n1(r);
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 状態

     slots は ストライカー MAIN_MAX 枠 ＋ スペシャル SUP_MAX 枠の固定長。
     order は { i: 枠の番号, t: 指定した秒（null なら最短） }。 */
  function emptySlot() { return { id: null, ex: 5, sk: 10, wp: 0, tier: {}, on: {} }; }

  /** 固有武器のパッシブで伸びた持続（ミリ秒）。**バフとデバフで別の値。**
      `ExtendBuffDuration_Base` / `ExtendDebuffDuration_Base` はどちらも
      10000 分率で、Lv10 が 1900 ＝ +19%。**掛かるのは、その子がかけた効果だけ。** */
  function extend(d, slot, du, side) {
    var lv = slot && slot.wp;
    if (!lv) return du;
    var tbl = side === 'enemy' ? d.ed : d.eb;
    if (!tbl) return du;
    // **ミリ秒の段階で丸める。**丸めずに渡すと 15000×1.19 が 17849.999… になり、
    // 同じ値なのに片方が 17.8 秒、もう片方が 17.9 秒と食い違って出る
    return Math.round(du * (1 + (tbl[lv - 1] || 0) / 10000));
  }
  var mode = 6, slots = [], order = [], lastSim = null;
  for (var z = 0; z < MAIN_MAX + SUP_MAX; z++) slots.push(emptySlot());

  function isMain(i) { return i < MAIN_MAX; }
  function live(i) { return isMain(i) ? i < LAYOUT[mode].main : i - MAIN_MAX < LAYOUT[mode].sup; }

  var KEY = 'arona-cost-timeline';
  function state() {
    return { m: mode, s: slots, o: order,
             st: el('i-start').value, cp: el('i-cap').value,
             gb: el('i-gb').value, gc: el('i-gc').value };
  }
  function apply(d) {
    if (!d) return;
    if (d.m === 10 || d.m === 6) mode = d.m;
    if (Array.isArray(d.s)) {
      slots = [];
      for (var i = 0; i < MAIN_MAX + SUP_MAX; i++) {
        var x = d.s[i] || {};
        // **枠と役割が食い違うものは捨てる。**保存していた古い形や、
        // 手で書き換えた URL でスペシャルがストライカーの枠に入るのを防ぐ
        var want = i < MAIN_MAX ? 'Main' : 'Support';
        var ok = byId[x.id] && byId[x.id].sq === want;
        slots.push({ id: ok ? x.id : null, ex: x.ex || 5, sk: x.sk || 10, wp: x.wp || 0,
                     tier: ok ? (x.tier || {}) : {}, on: ok ? (x.on || {}) : {} });
      }
    }
    if (Array.isArray(d.o)) {
      order = d.o.map(function (e) {
        return typeof e === 'number' ? { i: e, t: null, to: null }
                                     : { i: e.i, t: (e.t == null ? null : +e.t),
                                         to: (e.to == null ? null : +e.to) };
      }).filter(function (e) { return e.i >= 0 && e.i < slots.length; });
    }
    if (d.st != null) el('i-start').value = d.st;
    if (d.cp != null) el('i-cap').value = d.cp;
    if (d.gb != null) el('i-gb').value = d.gb;
    if (d.gc != null) el('i-gc').value = d.gc;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state())); } catch (e) { /* 使えない環境でも動く */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) apply(JSON.parse(raw));
    } catch (e) { /* 壊れていたら初期状態のまま */ }
  }

  /* ---------- URL に載せる

     `#6|10001.5.10,_,…|0,2@12.5|0/10/0/0`
     順に モード ／ 編成 ／ 撃つ順番 ／ 開始・上限・ステージ補正。
     **短く保つ。**QR にもチャットにも貼れる長さで収めたい。 */
  function toHash() {
    var ps = slots.map(function (s) {
      if (!s.id) return '_';
      var t = Object.keys(s.tier).map(function (k) { return k + ':' + s.tier[k]; }).join('!');
      var o = Object.keys(s.on).filter(function (k) { return s.on[k]; }).join('!');
      return s.id + '.' + s.ex + '.' + s.sk + (t || o || s.wp ? '.' + t + '.' + o + (s.wp ? '.' + s.wp : '') : '');
    }).join(',');
    var os = order.map(function (e) {
      return (e.t == null ? String(e.i) : e.i + '@' + e.t) + (e.to == null ? '' : '>' + e.to);
    }).join(',');
    return '#' + mode + '|' + ps + '|' + os + '|' +
      [el('i-start').value, el('i-cap').value, el('i-gb').value, el('i-gc').value].join('/');
  }
  // **共通の共有バー（../share.js）から呼ばれる。**あちらは押された時点で
  // 組み直すので、ここで状態を渡しておけば「URL をコピー」を押していなくても
  // いまの盤面が飛ぶ
  window.shareUrl = toHash;

  function fromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return false;
    var p = h.split('|');
    if (p.length < 3) return false;
    var d = { m: +p[0] === 10 ? 10 : 6, s: [], o: [] };
    p[1].split(',').forEach(function (x) {
      if (x === '_' || !x) { d.s.push({}); return; }
      var f = x.split('.');
      var tier = {}, on = {};
      (f[3] || '').split('!').forEach(function (kv) {
        if (!kv) return; var a = kv.split(':'); tier[a[0]] = +a[1];
      });
      (f[4] || '').split('!').forEach(function (k) { if (k) on[k] = true; });
      d.s.push({ id: +f[0], ex: +f[1] || 5, sk: +f[2] || 10, wp: +f[5] || 0, tier: tier, on: on });
    });
    if (p[2]) {
      p[2].split(',').forEach(function (x) {
        if (!x) return;
        var to = null, y = x, gt = x.indexOf('>');
        if (gt >= 0) { to = +x.slice(gt + 1); y = x.slice(0, gt); }
        var a = y.split('@');
        d.o.push({ i: +a[0], t: a.length > 1 ? +a[1] : null, to: isNaN(to) ? null : to });
      });
    }
    var g = (p[3] || '').split('/');
    if (g[0] != null && g[0] !== '') d.st = g[0];
    if (g[1] != null && g[1] !== '') d.cp = g[1];
    if (g[2] != null && g[2] !== '') d.gb = g[2];
    if (g[3] != null && g[3] !== '') d.gc = g[3];
    apply(d);
    return true;
  }

  function members() {
    return slots.map(function (s, i) { return { i: i, s: s, d: byId[s.id] }; })
                .filter(function (m) { return m.d && live(m.i); });
  }
  function usedIds(except) {
    var out = {};
    slots.forEach(function (s, i) { if (s.id && i !== except && live(i)) out[s.id] = true; });
    return out;
  }

  /* ---------- 効いているコスト回復力のスキル */
  function effects() {
    var ms = members(), out = [];
    ms.forEach(function (m) {
      (m.d.r || []).forEach(function (e, ei) {
        if (e.du > 0 && !m.s.on[ei]) return;          // 持続バフは既定で数えない
        var row = 0;
        if (e.v.length > 1) {
          if (e.cond === 'redwinter') {
            row = Math.min(e.v.length - 1, ms.filter(function (x) {
              return x.d.id !== m.d.id && x.d.sc === 'RedWinter'; }).length);
          } else if (e.cond === 'heavymain') {
            row = Math.min(e.v.length - 1, ms.filter(function (x) {
              return x.d.id !== m.d.id && x.d.at === 'HeavyArmor' && x.d.sq === 'Main'; }).length);
          } else {
            row = Math.min(e.v.length - 1, m.s.tier[ei] || 0);
          }
        }
        var lv = (e.sl === 'Ex' ? m.s.ex : m.s.sk) - 1;
        var arr = e.v[row] || [];
        var v = arr[Math.min(arr.length - 1, Math.max(0, lv))] || 0;
        if (!v) return;
        out.push({ m: m, e: e, v: v, row: row, ei: ei });
      });
    });
    return out;
  }

  /* コスト回復力の合計。**1 人ごとに「（700 ＋ 実数）×（1 ＋ %）」を出して足す。** */
  function pool() {
    var ms = members(), efs = effects();
    var gb = parseFloat(el('i-gb').value) || 0;
    var gc = parseFloat(el('i-gc').value) || 0;
    var per = {};
    ms.forEach(function (m) { per[m.i] = { b: D.base + gb, c: gc * 100 }; });
    efs.forEach(function (x) {
      var targets = x.e.p === 'party' ? ms : [x.m];
      targets.forEach(function (t) {
        if (!per[t.i]) return;
        if (x.e.k === 'b') per[t.i].b += x.v; else per[t.i].c += x.v;
      });
    });
    var total = 0;
    ms.forEach(function (m) { total += per[m.i].b * (1 + per[m.i].c / 10000); });
    return { total: total, per: per, efs: efs, ms: ms, gb: gb, gc: gc };
  }

  /* ---------- 画面 */

  function drawParty() {
    el('party-lead').innerHTML = mode === 10
      ? 'ストライカー 6 人とスペシャル 4 人。<b>コスト回復力は 10 人の合計で決まります</b>ので、EX を撃たない子も入れてください。同じ子は 1 人までです。'
      : 'ストライカー 4 人とスペシャル 2 人。<b>コスト回復力は 6 人の合計で決まります</b>ので、EX を撃たない子も入れてください。同じ子は 1 人までです。';
    [['party-main', 0, LAYOUT[mode].main, 'dl-main'],
     ['party-sup', MAIN_MAX, MAIN_MAX + LAYOUT[mode].sup, 'dl-sup']].forEach(function (g) {
      var box = el(g[0]), html = '';
      for (var i = g[1]; i < g[2]; i++) {
        var s = slots[i], d = byId[s.id];
        html += '<div class="slot' + (d ? '' : ' empty') + '" data-i="' + i + '">';
        html += '<div class="face">' + (d
          ? '<img src="' + face(d.id) + '" alt="" width="120" height="120" loading="lazy">'
          : '<span class="ph">空き</span>') + '</div>';
        if (d) {
          html += '<div class="nm">' + esc(d.n) + '<small>' + esc(d.en) + '（' + d.c[s.ex - 1] + ' コスト）</small></div>';
          html += '<div class="lv"><span>EX</span><select data-k="ex" data-i="' + i + '">';
          for (var v = 1; v <= 5; v++) html += '<option value="' + v + '"' + (v === s.ex ? ' selected' : '') + '>Lv' + v + '</option>';
          html += '</select></div>';
          if (d.eb || d.ed) {
            var wk = d.eb ? d.eb : d.ed, wt = d.eb ? 'バフ' : 'デバフ';
            html += '<div class="lv"><span>固有</span><select data-k="wp" data-i="' + i + '">' +
              '<option value="0"' + (!s.wp ? ' selected' : '') + '>なし</option>';
            for (var q = 1; q <= wk.length; q++) {
              html += '<option value="' + q + '"' + (q === s.wp ? ' selected' : '') + '>Lv' + q +
                '（' + wt + ' ＋' + n1(wk[q - 1] / 100) + '%）</option>';
            }
            html += '</select></div>';
          }
          if (d.r && d.r.some(function (e) { return e.sl !== 'Ex'; })) {
            html += '<div class="lv"><span>他</span><select data-k="sk" data-i="' + i + '">';
            for (var w = 1; w <= 10; w++) html += '<option value="' + w + '"' + (w === s.sk ? ' selected' : '') + '>Lv' + w + '</option>';
            html += '</select></div>';
          }
          (d.r || []).forEach(function (e, ei) {
            if (e.du > 0) {
              html += '<label class="lv" style="grid-template-columns:auto 1fr"><input type="checkbox" data-k="on" data-i="' +
                i + '" data-e="' + ei + '"' + (s.on[ei] ? ' checked' : '') + '><span>' +
                esc(e.sn) + ' が効いている間（' +
                n1(extend(d, s, e.du, e.p === 'party' ? 'ally' : 'self') / 1000) + ' 秒）</span></label>';
            } else if (e.v.length > 1 && !e.cond) {
              html += '<div class="lv"><span>段</span><select data-k="tier" data-i="' + i + '" data-e="' + ei + '">';
              for (var t = 0; t < e.v.length; t++) html += '<option value="' + t + '"' + (t === (s.tier[ei] || 0) ? ' selected' : '') + '>' + (t + 1) + ' 段目</option>';
              html += '</select></div>';
            }
          });
          html += '<button type="button" class="btn rmv" data-k="rmv" data-i="' + i + '">外す</button>';
        } else {
          html += '<input type="search" list="' + g[3] + '" data-k="pick" data-i="' + i + '" placeholder="名前で探す" autocomplete="off">';
        }
        html += '</div>';
      }
      box.innerHTML = html;
    });
    // **候補から、もう入っている子を外す。**同じ子は 2 人まで入れられない
    var used = usedIds(-1);
    [['dl-main', 'Main'], ['dl-sup', 'Support']].forEach(function (g) {
      el(g[0]).innerHTML = D.students.filter(function (s) { return s.sq === g[1] && !used[s.id]; })
        .map(function (s) { return '<option value="' + esc(s.n) + '">'; }).join('');
    });
    [].forEach.call(el('mode').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.m === mode));
    });
  }

  function drawStats() {
    var p = pool();
    if (!p.ms.length) {
      el('o-sec').textContent = '—'; el('o-pool').textContent = '—'; el('o-rate').textContent = '—';
      el('o-sec-sub').textContent = '生徒を入れてください';
      el('o-pool-sub').textContent = ''; el('o-rate-sub').textContent = '';
      el('ledger').innerHTML = '';
      return p;
    }
    var rate = p.total / 10000;
    el('o-sec').textContent = n2(1 / rate);
    el('o-sec-sub').textContent = '秒／コスト（素は ' + n2(10000 / (D.base * LAYOUT[mode].main + D.base * LAYOUT[mode].sup)) + ' 秒）';
    el('o-pool').textContent = fmt(p.total);
    el('o-pool-sub').textContent = p.ms.length + ' 人ぶん（素は ' + fmt(D.base * p.ms.length) + '）';
    el('o-rate').textContent = n2(rate);
    el('o-rate-sub').textContent = '上限まで ' + n1((parseFloat(el('i-cap').value) || 10) / rate) + ' 秒';

    var rows = '<div class="row"><span>素のコスト回復力<span class="subnote">' +
      D.base + ' × ' + p.ms.length + ' 人</span></span><span>' + fmt(D.base * p.ms.length) + '</span></div>';
    if (p.gb) rows += '<div class="row"><span>ステージ<span class="subnote">手で入れた実数</span></span><span>＋' +
      fmt(p.gb) + ' × ' + p.ms.length + ' 人</span></div>';
    if (p.gc) rows += '<div class="row"><span>ステージ<span class="subnote">手で入れた係数</span></span><span>＋' +
      n2(p.gc) + '%（全員）</span></div>';
    p.efs.forEach(function (x) {
      var val = x.e.k === 'b'
        ? '＋' + fmt(x.v) + (x.e.p === 'party' ? ' × ' + p.ms.length + ' 人' : '')
        : '＋' + n2(x.v / 100) + '%' + (x.e.p === 'party' ? '（全員）' : '（本人のみ）');
      var note = esc(x.e.sn);
      if (x.e.v.length > 1) note += '（' + (x.row + 1) + ' 段目）';
      if (x.e.du > 0) note += '／' + n1(x.e.du / 1000) + ' 秒';
      rows += '<div class="row"><span>' + esc(x.m.d.n) +
        '<span class="tag2">' + (x.e.sl === 'Ex' ? 'EX' : x.e.sl === 'Public' ? 'ノーマル' : 'パッシブ') + '</span>' +
        '<span class="subnote">' + note + '</span></span><span>' + val + '</span></div>';
    });
    rows += '<div class="row total"><span>合計</span><span>' + fmt(p.total) + '</span></div>';
    el('ledger').innerHTML = rows;
    return p;
  }

  /* ---------- 手札

     山札は編成人数ぶん。手札はその先頭 3 枚。1 枚使うと、そのカードは山札の
     一番下へ回り、山札の先頭から 1 枚引いて手札に加わる。**並びが決まれば
     そのあとはずっと決まる**ので、TL は毎回同じように再現できる。 */
  var HAND = 3;
  function deckOrder() {
    // 山札の並びは「TL に出てくる順」。開始スキルで指定するのがこれにあたる
    var seen = {}, deck = [];
    order.forEach(function (e) {
      if (!seen[e.i] && slots[e.i] && slots[e.i].id) { seen[e.i] = true; deck.push(e.i); }
    });
    members().forEach(function (m) { if (!seen[m.i]) { seen[m.i] = true; deck.push(m.i); } });
    return deck;
  }

  function playHand(deck) {
    var hand = deck.slice(0, HAND), rest = deck.slice(HAND);
    return {
      hand: function () { return hand.slice(); },
      /** 撃てたら true。撃てなければ手札を変えずに false */
      use: function (i) {
        var at = hand.indexOf(i);
        if (at < 0) return false;
        rest.push(i);                 // 使ったカードは山札の一番下へ
        hand[at] = rest.shift();      // 空いた枠に山札の先頭を引く
        return true;
      },
    };
  }

  /* コストの都合だけで、上から順に置いていく。
     撃っている間もコストは貯まり、次の EX はその演出が終わるまで撃てない。
     時刻を指定した行は、その時刻に足りているかを見て、足りなければ最短へずらす。 */
  /** スキルコストを下げる効果。**時間ではなく「使用 N 回ぶん」で切れる。**
      `coef` は 10000 分率（-5000 ＝ 50% 引き）で、**減る量のほうを切り捨てる**
      （スキル文の「ただし減少値は小数点以下切り捨て」がこれ）。
      `flat` は引く数そのもの。データは `Excel` ではなく SchaleDB の
      `Skills.Ex.Effects[].Type === "CostChange"` から来ている。 */
  function costAfter(need, cut) {
    if (!cut) return need;
    var down = cut.vt === 'coef' ? Math.floor(need * (-cut.sc / 10000)) : -cut.sc;
    return Math.max(0, need - down);
  }
  /** その発動で配られるコスト減少。**EX のレベルで回数が変わる子がいる**（セイア）。 */
  function grantOf(d, ex) {
    var cc = d.cc;
    if (!cc) return null;
    var n = cc.up ? (cc.up[ex - 1] || 0) : cc.u;
    if (!n) return null;
    return { n: n, vt: cc.vt, sc: cc.sc[ex - 1] || 0, sd: cc.sd };
  }

  function simulate(rate, cap, start) {
    var t = 0, cost = Math.min(cap, start), lock = 0, out = [], segs = [{ t: 0, c: cost }];
    var deck = deckOrder(), play = playHand(deck);
    var cut = {};                       // cut[枠] = { n, vt, sc } 残り回数つき
    order.forEach(function (e, idx) {
      var s = slots[e.i], d = byId[s.id];
      if (!d || !live(e.i)) { out.push({ e: e, d: null }); return; }
      var raw = d.c[s.ex - 1] || 0;
      var mine = cut[e.i];
      var need = costAfter(raw, mine);
      if (mine) { mine.n--; if (mine.n <= 0) delete cut[e.i]; }
      var t0 = Math.max(t, lock);
      var c0 = Math.min(cap, cost + rate * (t0 - t));
      var soon = need > cap ? null
               : (c0 >= need ? t0 : t0 + (need - c0) / rate);
      var at = soon, why = '';
      if (soon === null) { why = 'コストの上限を超えています'; }
      else if (e.t != null) {
        if (e.t < soon - 1e-6) { why = '間に合いません（最短 ' + n1(soon) + ' 秒）'; at = soon; }
        else { at = e.t; }
      }
      if (at !== null) {
        var cAt = Math.min(cap, cost + rate * (at - t));
        segs.push({ t: at, c: cAt });
        cost = cAt - need; t = at; lock = at + (d.d || 0) / FPS;
        segs.push({ t: at, c: cost });
      }
      var hand = play.hand();
      var drawn = play.use(e.i);
      // **撃ったあとに配る。**自分の発動ぶんには効かない
      var gr = at === null ? null : grantOf(d, s.ex);
      var to = null;
      if (gr) {
        to = gr.sd === 'self' ? e.i : (e.to == null ? null : e.to);
        if (to != null && slots[to] && slots[to].id && live(to)) {
          cut[to] = { n: gr.n, vt: gr.vt, sc: gr.sc };
        } else { to = null; }
      }
      out.push({ e: e, d: d, s: s, need: need, raw: raw, cut: mine, at: at, soon: soon, why: why,
                 left: at === null ? 0 : cost, idx: idx,
                 hand: hand, inHand: drawn, grant: gr, to: to });
    });
    return { rows: out, segs: segs, end: t, cap: cap, rate: rate, deck: deck };
  }

  /** コスト減少を「誰に渡すか」。**ゲームが自動で選ぶ相手はデータに無い**ので、
      ここだけは手で決めてもらう。スキル文は「自身を除く味方1人」としか言わない。 */
  function giveSel(r, i) {
    var h = '<select data-k="give" data-j="' + i + '" aria-label="コスト減少を渡す先">' +
      '<option value="">渡さない</option>';
    members().forEach(function (m) {
      if (m.i === r.e.i) return;        // 「自身を除く」
      h += '<option value="' + m.i + '"' + (r.e.to === m.i ? ' selected' : '') + '>' +
        esc(m.d.n) + ' へ</option>';
    });
    return h + '</select>';
  }
  function giveHtml(r, i) {
    if (!r.grant) return '';
    var g = r.grant;
    var amt = g.vt === 'coef' ? Math.round(-g.sc / 100) + '%（切り捨て）' : g.sc * -1 + ' 引き';
    if (g.sd === 'self') return '<br>このあと自分の ' + g.n + ' 発ぶん、コスト ' + amt;
    if (r.to == null) return '<br><span class="cut2">コスト減少 ' + g.n + ' 発ぶんを誰にも渡していません</span>';
    var d = byId[slots[r.to].id];
    return '<br>' + esc(d ? d.n : '？') + ' の次の ' + g.n + ' 発ぶん、コスト ' + amt;
  }

  function drawTimeline(p) {
    var box = el('add'), html = '';
    slots.forEach(function (s, i) {
      var d = byId[s.id];
      if (!d || !live(i)) return;
      html += '<button type="button" class="btn" data-k="add" data-i="' + i + '">' +
        '<img src="' + face(d.id) + '" alt="" width="26" height="26" loading="lazy">' +
        esc(d.n) + '<small style="color:var(--fg-mute)">（' + d.c[s.ex - 1] + '）</small></button>';
    });
    box.innerHTML = html || '<span class="lead">先に編成を決めてください。</span>';

    if (!p.ms.length || !order.length) {
      el('timeline').innerHTML = ''; el('out').value = ''; el('chart').innerHTML = '';
      el('chart-lead').textContent = 'EX を並べると、コストが貯まって減っていく様子が出ます。';
      el('tl-lead').textContent = order.length ? '生徒を入れてください。' : 'まだ何も並んでいません。';
      return;
    }
    var rate = p.total / 10000;
    var cap = parseFloat(el('i-cap').value) || LAYOUT[mode].cap;
    var start = parseFloat(el('i-start').value) || 0;
    var sim = simulate(rate, cap, start);
    lastSim = sim;

    el('timeline').innerHTML = sim.rows.map(function (r, i) {
      var fixed = r.e.t != null;
      // **`<b>` は使わない。**`.tlrow .tx b` が display: block なので、
      // 手札の中で太字にすると、そこで行が折れて「手札 ホシノ／・ハナコ」になる
      var names = r.hand.map(function (k) {
        var d = byId[slots[k].id], nm = esc(d ? d.n : '？');
        return k === r.e.i ? '<span class="me">' + nm + '</span>' : nm;
      }).join('・');
      var mark = '';
      if (!r.inHand) {
        mark = '<div class="cut bad"><span>' + esc(r.d.n) +
          ' はこのとき手札にありません（手札は ' + r.hand.map(function (k) {
            var d = byId[slots[k].id]; return d ? d.n : '？'; }).join('・') + '）</span></div>';
      }
      return mark + '<div class="tlrow' + (r.why || !r.inHand ? ' bad' : '') + '">' +
        '<span class="no">' + (i + 1) + '</span>' +
        '<img src="' + face(r.d.id) + '" alt="" width="40" height="40" loading="lazy">' +
        '<span class="tx"><b>' + esc(r.d.n) + '</b><small>' + esc(r.d.en) + '／' +
        (r.cut ? '<span class="cut2">' + r.raw + ' → ' + r.need + '</span> コスト' : r.need + ' コスト') +
        (r.d.d ? '／演出 ' + n1(r.d.d / FPS) + ' 秒' : '') + '<br>手札 ' + names + giveHtml(r, i) + '</small>' +
        '<span class="when"><select data-k="mode-at" data-j="' + i + '">' +
        '<option value="auto"' + (fixed ? '' : ' selected') + '>最短で</option>' +
        '<option value="fix"' + (fixed ? ' selected' : '') + '>この秒に</option></select>' +
        (fixed ? '<input type="number" step="0.1" min="0" data-k="at" data-j="' + i + '" value="' + r.e.t + '"> 秒' : '') +
        (r.grant && r.grant.sd === 'ally' ? giveSel(r, i) : '') +
        '</span></span>' +
        '<span class="at">' + (r.at === null ? '撃てない' : n1(r.at) + ' 秒') +
        '<small>' + (r.why ? esc(r.why) : '残り ' + n1(r.left) + ' コスト') + '</small></span>' +
        '<span class="ops"><button type="button" class="btn" data-k="up" data-j="' + i + '">↑</button>' +
        '<button type="button" class="btn" data-k="del" data-j="' + i + '">×</button></span></div>';
    }).join('');

    var ok = sim.rows.filter(function (r) { return r.d && r.at !== null; });
    var ng = sim.rows.filter(function (r) { return r.d && r.why; });
    var miss = sim.rows.filter(function (r) { return !r.inHand; });
    var pin = Math.min(LAYOUT[mode].start, sim.deck.length);
    var full = pin >= sim.deck.length - 1;
    el('tl-lead').textContent = (miss.length
      ? miss.length + ' 発、そのとき手札にありません。並べ直してください。'
      : ng.length
        ? ng.length + ' 発、指定した秒には撃てません。'
        : ok.length + ' 発ぜんぶ撃つのに、コストの都合では最短 ' +
          n1(ok.length ? ok[ok.length - 1].at : 0) + ' 秒かかります。') +
      (miss.length || !sim.deck.length ? ''
        : '山札は ' + sim.deck.length + ' 枚で、開始スキルで指定できるのは ' + pin + ' 人。' +
          (full ? '残りは自動で決まるので、この並びは最後まで再現できます。'
                : '指定できない ' + (sim.deck.length - pin) + ' 人ぶんは山札の順しだいです。'));

    el('out').value = sim.rows.filter(function (r) { return r.d && r.at !== null; })
      .map(function (r) {
        return clock(r.at) + '\t' + r.d.n + '\tEX' + r.s.ex + '\t' + r.need + 'コスト';
      }).join('\n');

    drawChart(sim);
  }

  /* コストの動き。**折れ線ひとつだけ。**軸は左に 1 本、EX を撃った点に縦の破線を引く */
  function drawChart(sim) {
    var W = 760, H = 220, L = 34, R = 12, T = 14, B = 26;
    var last = sim.segs[sim.segs.length - 1];
    var span = Math.max(5, last.t + 3);
    var cap = sim.cap;
    // 最後の点のあとも、上限まで貯まる様子を出す
    var pts = sim.segs.slice();
    var toCap = last.c >= cap ? 0 : (cap - last.c) / sim.rate;
    // **上限に届く時刻が枠の外なら、枠の右端までの途中までしか描かない。**
    // 無条件に「右端＝上限」へ線を引くと、実際より速く貯まって見える
    var tail = Math.min(span, last.t + toCap);
    pts.push({ t: tail, c: Math.min(cap, last.c + sim.rate * (tail - last.t)) });
    if (tail < span) pts.push({ t: span, c: cap });

    var x = function (t) { return L + (W - L - R) * (t / span); };
    var y = function (c) { return T + (H - T - B) * (1 - c / cap); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.c).toFixed(1); }).join(' ');
    var area = line + ' L' + x(span).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';

    var g = '';
    for (var c = 0; c <= cap; c += (cap > 12 ? 5 : 2)) {
      g += '<line class="grid" x1="' + L + '" y1="' + y(c).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(c).toFixed(1) + '"></line>' +
           '<text x="' + (L - 6) + '" y="' + (y(c) + 4).toFixed(1) + '" text-anchor="end">' + c + '</text>';
    }
    var step = span <= 30 ? 5 : span <= 90 ? 15 : 30;
    for (var t = 0; t <= span; t += step) {
      g += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + '秒</text>';
    }
    var marks = sim.rows.filter(function (r) { return r.d && r.at !== null; }).map(function (r) {
      return '<line class="fire" x1="' + x(r.at).toFixed(1) + '" y1="' + T + '" x2="' + x(r.at).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"></line>' +
        '<text class="n" x="' + x(r.at).toFixed(1) + '" y="' + (T + 10) + '" text-anchor="middle">' + esc(r.d.n.slice(0, 4)) + '</text>';
    }).join('');

    el('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="コストの動き">' +
      g + '<path class="area" d="' + area + '"></path><path class="line" d="' + line + '"></path>' + marks + '</svg>';
    el('chart-lead').textContent = '縦がコスト（上限 ' + n1(cap) + '）、横が秒です。破線は EX を撃ったところ。';
    drawBars(sim, span, W, L, R);
  }

  /* バフの持続。**コストの図と横軸を揃えた帯。**
     どの効果がいつ切れるか、次の一手がその中に入っているかを見るためのもの。
     持続を持たない効果（撃った瞬間のダメージ・回復）は帯にならないので出さない。 */
  var SIDE_JA = { self: '本人', ally: '味方', enemy: '敵' };
  function drawBars(sim, span, W, L, R) {
    var bars = [];
    sim.rows.forEach(function (r) {
      if (!r.d || r.at === null || !r.d.bf) return;
      r.d.bf.forEach(function (b) {
        var du = extend(r.d, r.s, b.du, b.sd);
        // **秒数は帯の長さから引き算しない。**at が小数なので
        // 17.85 が 17.849999… になって、他の表示と 0.1 秒ずれる
        bars.push({ at: r.at, end: r.at + du / 1000, sec: du / 1000,
                    n: r.d.n, e: b.n, sd: b.sd, grew: du > b.du });
      });
    });
    var box = el('bars'), lead = el('bars-lead');
    if (!bars.length) {
      box.innerHTML = '';
      lead.textContent = '並べた EX に持続する効果があると、ここに帯が出ます。';
      return;
    }
    var ROW = 22, T = 6, B = 22, H = T + ROW * bars.length + B;
    var x = function (t) { return L + (W - L - R) * (Math.min(t, span) / span); };
    var step = span <= 30 ? 5 : span <= 90 ? 15 : 30;
    var g = '';
    for (var t = 0; t <= span; t += step) {
      g += '<line class="grid" x1="' + x(t).toFixed(1) + '" y1="' + T + '" x2="' + x(t).toFixed(1) +
           '" y2="' + (H - B).toFixed(1) + '"></line>' +
           '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + t + '秒</text>';
    }
    var over = 0;
    var rows = bars.map(function (b, i) {
      var y = T + ROW * i + 3, h = ROW - 7;
      var x0 = x(b.at), x1 = x(b.end);
      if (b.end > span) over++;
      var w = Math.max(2, x1 - x0);
      // **切れる位置に印を付ける。**帯が枠の外まで伸びるときは付けない
      var endMark = b.end <= span
        ? '<line class="out" x1="' + x1.toFixed(1) + '" y1="' + (y - 2) + '" x2="' + x1.toFixed(1) +
          '" y2="' + (y + h + 2) + '"></line>' : '';
      return '<rect class="bar ' + b.sd + '" x="' + x0.toFixed(1) + '" y="' + y +
        '" width="' + w.toFixed(1) + '" height="' + h + '" rx="4"></rect>' + endMark +
        '<text class="lb" x="' + (x0 + 6).toFixed(1) + '" y="' + (y + h - 3) + '">' +
        esc(b.n) + '／' + esc(b.e) + ' ' + n1(b.sec) + '秒' +
        (b.grew ? '（固有で延長）' : '') + '</text>';
    }).join('');

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="バフの持続">' +
      g + rows + '</svg>';
    lead.textContent = '帯 ' + bars.length + ' 本。左端が発動、右端の縦線で切れます。' +
      (over ? over + ' 本は図の右端より先まで続きます。' : '') +
      '色は本人（濃い）／味方（中）／敵（薄い）です。';
  }

  function drawRefList() {
    var holders = D.students.filter(function (s) { return s.r && s.r.length; });
    holders.sort(function (a, b) { return a.n.localeCompare(b.n, 'ja'); });
    el('rlist-lead').textContent = '全 ' + D.students.length + ' 人のうち ' + holders.length +
      ' 人です。数値は右がスキル最大のときの値で、% は編成の全員にかかります。';
    el('rlist').innerHTML = holders.map(function (s) {
      var ef = s.r.map(function (e) {
        var row = e.v[e.v.length - 1] || [];
        var lo = row[0], hi = row[row.length - 1];
        var vs = e.k === 'b' ? '＋' + fmt(lo) + '〜' + fmt(hi)
                             : '＋' + n2(lo / 100) + '〜' + n2(hi / 100) + '%';
        return '<div>' + (e.sl === 'Ex' ? 'EX' : e.sl === 'Public' ? 'ノーマル' : 'パッシブ') +
          '「' + esc(e.sn) + '」<b>' + vs + '</b>' +
          (e.p === 'party' ? '（全員）' : '（本人）') +
          (e.du > 0 ? '／' + n1(e.du / 1000) + ' 秒' : '') + '</div>';
      }).join('');
      return '<div class="rcard"><img src="' + face(s.id) + '" alt="" width="46" height="46" loading="lazy">' +
        '<div><div class="nm">' + esc(s.n) + '</div><div class="ef">' + ef + '</div></div></div>';
    }).join('');
  }

  function draw() {
    // **並びから、居なくなった子を先に落とす。**行の番号と order の番号がずれると、
    // 「この秒に」の切り替えが別の行に効いてしまう
    order = order.filter(function (e) {
      return slots[e.i] && slots[e.i].id && byId[slots[e.i].id] && live(e.i);
    });
    drawParty();
    var p = drawStats();
    drawTimeline(p);
    save();
  }

  function findByName(name, sq, slot) {
    name = (name || '').trim();
    var used = usedIds(slot);
    var pick = D.students.filter(function (s) { return s.sq === sq && !used[s.id]; });
    var hit = pick.filter(function (s) { return s.n === name; });
    if (hit.length) return hit[0];
    hit = pick.filter(function (s) { return s.n.indexOf(name) === 0; });
    if (name && hit.length === 1) return hit[0];
    // 名前は合っているのに候補に無い＝もう編成に入っている
    var dup = D.students.filter(function (s) { return s.sq === sq && s.n === name; });
    return dup.length ? { dup: true, n: dup[0].n } : null;
  }
  function say(msg) {
    var e = el('err');
    if (!msg) { e.hidden = true; return; }
    e.hidden = false; e.textContent = msg;
  }

  /* ---------- 入力

     **候補をクリックしたときに `change` が来ないことがある。**その場では何も
     起きず、余所をクリックして初めて（＝ぼかしたときの `change` で）入る、
     という挙動になっていた（2026-08-30 に先生の指摘で気づいた）。
     `input` でも同じ処理を通す。ただし打っている途中で勝手に確定しないよう、
     `input` 側は**名前がぴったり一致したときだけ**受ける。 */
  function takePick(t, exactOnly) {
    var i = +t.dataset.i, sq = isMain(i) ? 'Main' : 'Support';
    var name = (t.value || '').trim();
    if (exactOnly && !D.students.some(function (s) { return s.sq === sq && s.n === name; })) return;
    var d = findByName(name, sq, i);
    if (!d) { if (!exactOnly) say('その名前の生徒が見つかりません。'); return; }
    if (d.dup) { say(d.n + ' はもう編成に入っています。同じ子は 1 人までです。'); return; }
    say('');
    slots[i] = { id: d.id, ex: 5, sk: 10, tier: {}, on: {} };
    draw();
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target, k = t.dataset && t.dataset.k;
    if (k === 'pick') {
      takePick(t, false);
    } else if (k === 'ex' || k === 'sk' || k === 'wp') {
      slots[+t.dataset.i][k] = +t.value; draw();
    } else if (k === 'tier') {
      slots[+t.dataset.i].tier[+t.dataset.e] = +t.value; draw();
    } else if (k === 'on') {
      slots[+t.dataset.i].on[+t.dataset.e] = t.checked; draw();
    } else if (k === 'mode-at') {
      var j = +t.dataset.j, e2 = order[j];
      if (!e2) return;
      if (t.value === 'fix') {
        // **いま出ている時刻をそのまま初期値にする。**「この秒に」へ切り替えた
        // 瞬間に 0 秒へ飛ぶと、そこから打ち直しになって使いづらい
        var cur = lastSim && lastSim.rows[j] ? lastSim.rows[j].at : 0;
        e2.t = cur == null ? 0 : Math.round(cur * 10) / 10;
      } else { e2.t = null; }
      draw();
    } else if (k === 'give') {
      var jg = +t.dataset.j;
      if (order[jg]) order[jg].to = t.value === '' ? null : +t.value;
      draw();
    } else if (k === 'at') {
      var j2 = +t.dataset.j;
      if (order[j2]) order[j2].t = Math.max(0, parseFloat(t.value) || 0);
      draw();
    } else if (t.id === 'i-start' || t.id === 'i-cap' || t.id === 'i-gb' || t.id === 'i-gc') {
      draw();
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target, id = t.id;
    if (t.dataset && t.dataset.k === 'pick') { takePick(t, true); return; }
    if (id === 'i-start' || id === 'i-cap' || id === 'i-gb' || id === 'i-gc') draw();
  });

  function toast(msg) {
    var t = el('toast-page');
    if (!t) return;
    t.textContent = msg; t.classList.add('shown');
    setTimeout(function () { t.classList.remove('shown'); }, 2000);
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var k = b.dataset.k;
    if (k === 'rmv') {
      var i = +b.dataset.i;
      slots[i] = emptySlot();
      order = order.filter(function (e) { return e.i !== i; });
      draw();
    } else if (k === 'add') {
      order.push({ i: +b.dataset.i, t: null }); draw();
    } else if (k === 'del') {
      order.splice(+b.dataset.j, 1); draw();
    } else if (k === 'up') {
      var j = +b.dataset.j;
      if (j > 0) { var tmp = order[j - 1]; order[j - 1] = order[j]; order[j] = tmp; }
      draw();
    } else if (b.dataset.m) {
      mode = +b.dataset.m;
      el('i-cap').value = LAYOUT[mode].cap;
      order = order.filter(function (e) { return live(e.i); });
      draw();
    } else if (b.id === 'clear-tl') {
      order = []; draw();
    } else if (b.id === 'clear-party') {
      slots = []; for (var z2 = 0; z2 < MAIN_MAX + SUP_MAX; z2++) slots.push(emptySlot());
      order = []; say(''); draw();
    } else if (b.id === 'copy-url') {
      var url = location.href.split('#')[0] + toHash();
      history.replaceState(null, '', toHash());
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('URL をコピーしました'); },
          function () { toast('コピーできませんでした'); });
      } else { toast('この環境ではコピーできません'); }
    } else if (b.id === 'copy-text') {
      var tx = el('out').value;
      if (!tx) { toast('先に EX を並べてください'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tx).then(function () { toast('テキストをコピーしました'); },
          function () { toast('コピーできませんでした'); });
      } else { el('out').select(); toast('選択しました。手でコピーしてください'); }
    }
  });

  el('ver').textContent = D.version;
  // **URL が先、保存はそのあと。**人からもらったリンクを開いたときに上書きされない
  if (!fromHash()) load();
  drawRefList();
  draw();
})();
