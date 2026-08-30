/* TL のコスト計算機。

   見ているのは 2 つだけ。
   ① 編成した 6 人からコスト回復力を出す（素 700 × 6 に、スキルの実数と % を重ねる）
   ② 並べた EX を上から順に「コストの都合で最短いつ撃てるか」で置く

   **手札の並びは扱っていない。** ブルアカのカードは使うと山札に戻って引き直されるので、
   撃ちたい順に撃てるとは限らない。ここで出るのは下限であって、TL そのものではない。 */
(function () {
  'use strict';
  var D = window.TL;
  var FPS = 30;                        // Duration はフレーム。ブルアカは 30fps
  var el = function (id) { return document.getElementById(id); };
  var byId = {};
  D.students.forEach(function (s) { byId[s.id] = s; });

  function n1(v) { return (Math.round(v * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function n2(v) { return (Math.round(v * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmt(v) { return Math.round(v).toLocaleString('ja-JP'); }
  function face(id) { return '../img/student_' + id + '.webp'; }

  /* ---------- 状態

     slots[0..3] がストライカー、slots[4..5] がスペシャル。
     ex / sk はスキルの Lv、tier は「段のあるスキル」で手で選んだ段、
     on は「持続時間のあるバフを効いているものとして数えるか」。 */
  function emptySlot() { return { id: null, ex: 5, sk: 10, tier: {}, on: {} }; }
  var slots = [], order = [];
  for (var i = 0; i < 6; i++) slots.push(emptySlot());

  var KEY = 'arona-cost-timeline';
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ s: slots, o: order,
        st: el('i-start').value, cp: el('i-cap').value }));
    } catch (e) { /* 使えない環境でも動く */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.s) && d.s.length === 6) {
        slots = d.s.map(function (x) {
          return { id: byId[x.id] ? x.id : null, ex: x.ex || 5, sk: x.sk || 10,
                   tier: x.tier || {}, on: x.on || {} };
        });
      }
      if (Array.isArray(d.o)) order = d.o.filter(function (k) { return k >= 0 && k < 6; });
      if (d.st != null) el('i-start').value = d.st;
      if (d.cp != null) el('i-cap').value = d.cp;
    } catch (e) { /* 壊れていたら初期状態のまま */ }
  }

  function members() {
    return slots.map(function (s, i) { return { i: i, s: s, d: byId[s.id] }; })
                .filter(function (m) { return m.d; });
  }

  /* ---------- 効いているコスト回復力のスキルを並べる

     返すのは { m: 持ち主, e: 効果, v: 実際の値, row: 段, ei: 効果の番号 }。 */
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

  /* コスト回復力の合計。**1 人ごとに「（700 ＋ 実数）×（1 ＋ %）」を出して足す。**
     ゲームの他のステータスと同じ順番（足してから掛ける）。 */
  function pool() {
    var ms = members(), efs = effects();
    var per = {};
    ms.forEach(function (m) { per[m.i] = { b: D.base, c: 0 }; });
    efs.forEach(function (x) {
      var targets = x.e.p === 'party' ? ms : [x.m];
      targets.forEach(function (t) {
        if (!per[t.i]) return;
        if (x.e.k === 'b') per[t.i].b += x.v; else per[t.i].c += x.v;
      });
    });
    var total = 0;
    ms.forEach(function (m) { total += per[m.i].b * (1 + per[m.i].c / 10000); });
    return { total: total, per: per, efs: efs, ms: ms };
  }

  /* ---------- 画面 */

  function drawParty() {
    [['party-main', 0, 4, 'dl-main'], ['party-sup', 4, 6, 'dl-sup']].forEach(function (g) {
      var box = el(g[0]), html = '';
      for (var i = g[1]; i < g[2]; i++) {
        var s = slots[i], d = byId[s.id];
        html += '<div class="slot' + (d ? '' : ' empty') + '" data-i="' + i + '">';
        html += '<div class="face">' + (d
          ? '<img src="' + face(d.id) + '" alt="" width="120" height="120" loading="lazy">'
          : '<span class="ph">空き</span>') + '</div>';
        if (d) {
          html += '<div class="nm">' + d.n + '<small>' + d.en + '（' + d.c[s.ex - 1] + ' コスト）</small></div>';
          html += '<div class="lv"><span>EX</span><select data-k="ex" data-i="' + i + '">';
          for (var v = 1; v <= 5; v++) html += '<option value="' + v + '"' + (v === s.ex ? ' selected' : '') + '>Lv' + v + '</option>';
          html += '</select></div>';
          if (d.r && d.r.some(function (e) { return e.sl !== 'Ex'; })) {
            html += '<div class="lv"><span>他</span><select data-k="sk" data-i="' + i + '">';
            for (var w = 1; w <= 10; w++) html += '<option value="' + w + '"' + (w === s.sk ? ' selected' : '') + '>Lv' + w + '</option>';
            html += '</select></div>';
          }
          (d.r || []).forEach(function (e, ei) {
            if (e.du > 0) {
              html += '<label class="lv" style="grid-template-columns:auto 1fr"><input type="checkbox" data-k="on" data-i="' +
                i + '" data-e="' + ei + '"' + (s.on[ei] ? ' checked' : '') + '><span>' +
                e.sn + ' が効いている間（' + n1(e.du / 1000) + ' 秒）</span></label>';
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
    el('o-sec-sub').textContent = '秒／コスト（素の編成は 2.38 秒）';
    el('o-pool').textContent = fmt(p.total);
    el('o-pool-sub').textContent = p.ms.length + ' 人ぶん（素は ' + fmt(D.base * p.ms.length) + '）';
    el('o-rate').textContent = n2(rate);
    el('o-rate-sub').textContent = '10 コスト貯まるまで ' + n1(10 / rate) + ' 秒';

    var rows = '<div class="row"><span>素のコスト回復力<span class="subnote">' +
      D.base + ' × ' + p.ms.length + ' 人</span></span><span>' + fmt(D.base * p.ms.length) + '</span></div>';
    p.efs.forEach(function (x) {
      var who = x.m.d.n;
      var val = x.e.k === 'b'
        ? '＋' + fmt(x.v) + (x.e.p === 'party' ? ' × ' + p.ms.length + ' 人' : '')
        : '＋' + n2(x.v / 100) + '%' + (x.e.p === 'party' ? '（全員）' : '（本人のみ）');
      var note = x.e.sn;
      if (x.e.v.length > 1) note += '（' + (x.row + 1) + ' 段目）';
      if (x.e.du > 0) note += '／' + n1(x.e.du / 1000) + ' 秒';
      rows += '<div class="row"><span>' + who +
        '<span class="tag2">' + (x.e.sl === 'Ex' ? 'EX' : x.e.sl === 'Public' ? 'ノーマル' : 'パッシブ') + '</span>' +
        '<span class="subnote">' + note + '</span></span><span>' + val + '</span></div>';
    });
    rows += '<div class="row total"><span>合計</span><span>' + fmt(p.total) + '</span></div>';
    el('ledger').innerHTML = rows;
    return p;
  }

  /* コストの都合だけで、上から順に置いていく。
     撃っている間もコストは貯まり、次の EX はその演出が終わるまで撃てない。 */
  function simulate(rate, cap, start) {
    var t = 0, cost = Math.min(cap, start), lock = 0, out = [];
    order.forEach(function (si) {
      var s = slots[si], d = byId[s.id];
      if (!d) return;
      var need = d.c[s.ex - 1] || 0;
      var t0 = Math.max(t, lock);
      var c0 = Math.min(cap, cost + rate * (t0 - t));
      var at, ok = true;
      if (need > cap) { at = null; ok = false; }
      else if (c0 >= need) at = t0;
      else at = t0 + (need - c0) / rate;
      if (ok) {
        var cAt = Math.min(cap, c0 + rate * (at - t0));
        cost = cAt - need; t = at; lock = at + (d.d || 0) / FPS;
      }
      out.push({ si: si, d: d, need: need, at: at, ok: ok, left: ok ? cost : 0,
                 end: ok ? lock : null });
    });
    return out;
  }

  function drawTimeline(p) {
    var box = el('add'), html = '';
    slots.forEach(function (s, i) {
      var d = byId[s.id];
      if (!d) return;
      html += '<button type="button" class="btn" data-k="add" data-i="' + i + '">' +
        '<img src="' + face(d.id) + '" alt="" width="26" height="26" loading="lazy">' +
        d.n + '<small style="color:var(--fg-mute)">（' + d.c[s.ex - 1] + '）</small></button>';
    });
    box.innerHTML = html || '<span class="lead">先に編成を決めてください。</span>';

    if (!p.ms.length || !order.length) {
      el('timeline').innerHTML = '';
      el('tl-lead').textContent = order.length ? '生徒を入れてください。' : 'まだ何も並んでいません。';
      return;
    }
    var rate = p.total / 10000;
    var cap = parseFloat(el('i-cap').value) || 10;
    var start = parseFloat(el('i-start').value) || 0;
    var sim = simulate(rate, cap, start);
    el('timeline').innerHTML = sim.map(function (r, i) {
      return '<div class="tlrow' + (r.ok ? '' : ' bad') + '">' +
        '<span class="no">' + (i + 1) + '</span>' +
        '<img src="' + face(r.d.id) + '" alt="" width="40" height="40" loading="lazy">' +
        '<span class="tx"><b>' + r.d.n + '</b><small>' + r.d.en + '／' + r.need + ' コスト' +
        (r.d.d ? '／演出 ' + n1(r.d.d / FPS) + ' 秒' : '') + '</small></span>' +
        '<span class="at">' + (r.ok ? n1(r.at) + ' 秒' : '撃てない') +
        '<small>' + (r.ok ? '残り ' + n1(r.left) + ' コスト' : '上限を超えています') + '</small></span>' +
        '<span class="ops"><button type="button" class="btn" data-k="up" data-j="' + i + '">↑</button>' +
        '<button type="button" class="btn" data-k="del" data-j="' + i + '">×</button></span></div>';
    }).join('');
    var last = sim[sim.length - 1];
    el('tl-lead').textContent = last && last.ok
      ? order.length + ' 発ぜんぶ撃つのに、コストの都合では最短 ' + n1(last.at) + ' 秒かかります。'
      : 'コストの上限を超えている EX があります。';
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
          '「' + e.sn + '」<b>' + vs + '</b>' +
          (e.p === 'party' ? '（全員）' : '（本人）') +
          (e.du > 0 ? '／' + n1(e.du / 1000) + ' 秒' : '') + '</div>';
      }).join('');
      return '<div class="rcard"><img src="' + face(s.id) + '" alt="" width="46" height="46" loading="lazy">' +
        '<div><div class="nm">' + s.n + '</div><div class="ef">' + ef + '</div></div></div>';
    }).join('');
  }

  function draw() {
    drawParty();
    var p = drawStats();
    drawTimeline(p);
    save();
  }

  /* ---------- 名前の候補。ストライカーとスペシャルで分ける */
  function fillLists() {
    [['dl-main', 'Main'], ['dl-sup', 'Support']].forEach(function (g) {
      el(g[0]).innerHTML = D.students.filter(function (s) { return s.sq === g[1]; })
        .map(function (s) { return '<option value="' + s.n + '">'; }).join('');
    });
  }
  function findByName(name, sq) {
    name = (name || '').trim();
    var hit = D.students.filter(function (s) { return s.sq === sq && s.n === name; });
    if (hit.length) return hit[0];
    hit = D.students.filter(function (s) { return s.sq === sq && s.n.indexOf(name) === 0; });
    return name && hit.length === 1 ? hit[0] : null;
  }

  /* ---------- 入力 */
  document.addEventListener('change', function (ev) {
    var t = ev.target, k = t.dataset && t.dataset.k;
    if (k === 'pick') {
      var i = +t.dataset.i;
      var d = findByName(t.value, i < 4 ? 'Main' : 'Support');
      if (!d) { el('err').hidden = false; el('err').textContent = 'その名前の生徒が見つかりません。'; return; }
      el('err').hidden = true;
      slots[i] = { id: d.id, ex: 5, sk: 10, tier: {}, on: {} };
      draw();
    } else if (k === 'ex' || k === 'sk') {
      slots[+t.dataset.i][k] = +t.value; draw();
    } else if (k === 'tier') {
      slots[+t.dataset.i].tier[+t.dataset.e] = +t.value; draw();
    } else if (k === 'on') {
      slots[+t.dataset.i].on[+t.dataset.e] = t.checked; draw();
    } else if (t.id === 'i-start' || t.id === 'i-cap') {
      draw();
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'i-start' || ev.target.id === 'i-cap') draw();
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var k = b.dataset.k;
    if (k === 'rmv') {
      var i = +b.dataset.i;
      slots[i] = emptySlot();
      order = order.filter(function (x) { return x !== i; });
      draw();
    } else if (k === 'add') {
      order.push(+b.dataset.i); draw();
    } else if (k === 'del') {
      order.splice(+b.dataset.j, 1); draw();
    } else if (k === 'up') {
      var j = +b.dataset.j;
      if (j > 0) { var tmp = order[j - 1]; order[j - 1] = order[j]; order[j] = tmp; }
      draw();
    } else if (b.id === 'clear-tl') {
      order = []; draw();
    } else if (b.dataset.p === 'clear') {
      slots = []; for (var z = 0; z < 6; z++) slots.push(emptySlot());
      order = []; draw();
    } else if (b.dataset.p === 'himari') {
      var h = D.students.filter(function (s) { return s.n === 'ヒマリ'; })[0];
      if (!h) return;
      var at = slots[4].id ? 5 : 4;
      slots[at] = { id: h.id, ex: 5, sk: 10, tier: {}, on: {} };
      draw();
    }
  });

  el('ver').textContent = D.version;
  fillLists();
  load();
  drawRefList();
  draw();
})();
