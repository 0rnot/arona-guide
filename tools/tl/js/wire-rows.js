import { $, mmss, view } from './util.js';
import { TE, bump, st } from './core.js';
import { mark, redo, undo } from './undo.js';
import { autoFill, delSel, snap } from './uses.js';
import { diff } from './boss.js';
import { SCEN, scen } from './scen.js';
import { draw } from './draw.js';
import { keyHelp, uiReset } from './rate.js';
import { kpi } from './kpi.js';
import { clamp } from './stats.js';
import { toList } from './target.js';
import { sheet, snapshot } from './io.js';
import { importSheet } from './import-ui.js';
import { MD3, drawRows, rowAdd, rowMove, rowOrder, rowSeek, rowSwap, rowsToggle, selPick, selRows, trIx } from './rows.js';
import { syncTabs } from './wire-boss.js';
import { onAlt } from './wire-build.js';
import { onUse } from './wire-use.js';
import { laneOn, saveLanes } from './lanes.js';


export function onAct(e) {
  var act = e.target.closest('button[data-act]');
  if (act) {
    var a = act.getAttribute('data-act');
    if (a === 'undo') { undo(); }
    if (a === 'redo') { redo(); }
    if (a === 'delsel') { delSel(); }
    if (a === 'clear') { mark(); st.tl.length = 0; st.sel = null; st.mk = []; draw(); }
    if (a === 'auto') { autoFill(); }
    if (a === 'rows') { rowsToggle(); }
    if (a === 'goal') {
      var r0 = diff(), hp0 = (r0.bs && r0.bs.hp) || 0;
      var cur = st.goal || { dmg: hp0, sec: r0.dur || 240 };
      sheet('目標設定', JSON.stringify({ dmg: cur.dmg, sec: cur.sec }, null, 1),
        function (o) {
          if (!isFinite(o.dmg) || !isFinite(o.sec)) { throw new Error('dmg と sec は数字で'); }
          mark();
          st.goal = { dmg: +o.dmg, sec: +o.sec }; st.tab = 1; syncTabs(); draw();
        });
    }
    if (a === 'keys') { keyHelp(); }
    if (a === 'uireset') { uiReset(); }
    if (a === 'export') { sheet('書き出し', JSON.stringify(snapshot()), null); }
    if (a === 'import') { importSheet(); }
    if (a === 'mark') {
      var dur = diff().dur || 240;
      var t = st.pin != null ? st.pin :
              ($('view').scrollLeft + $('view').clientWidth / 2) / st.px;
      t = Math.max(0, Math.min(dur, t));
      var n = window.prompt('マーカーの名前', mmss(dur, t));
      if (n == null) { return; }
      mark();
      st.mk.push({ t: snap(t), n: n || mmss(dur, t) });
      draw();
    }
    return;
  }
  // 段の取捨選択（2026-09-03）。**押した段だけ入れ替えて描き直す**
  var lb = e.target.closest('button[data-lane]');
  if (lb) {
    var lk = lb.getAttribute('data-lane');
    st.lanes[lk] = !laneOn(lk);
    lb.setAttribute('aria-pressed', laneOn(lk) ? 'true' : 'false');
    saveLanes();
    draw();
    return;
  }
  var b = e.target.closest('button[data-grid]');
  if (!b) { return; }
  st.grid = +b.getAttribute('data-grid');
  var all = document.querySelectorAll('.tools2 button[data-grid]');
  for (var i = 0; i < all.length; i++) {
    all[i].setAttribute('aria-pressed', all[i] === b ? 'true' : 'false');
  }
}

export function wireRows() {
  // ---- TL 表の行。**「詳細」の中身は `#useedit` と同じ**なので、
  // 選んだ 1 発の入口（onUse / onAlt / onAct）をそのまま繋ぐ
  $('rowlist').addEventListener('change', function (e) {
    var el = e.target.closest('[data-tr]');
    if (!el) { return; }
    var row = el.closest('.trow'), u = row ? st.tl[+row.getAttribute('data-ix')] : null;
    if (!u) { return; }
    var k = el.getAttribute('data-tr');
    if (k === 'who' && el.value === 'find') {
      // **選んだ子をこの行に入れる。**下の「生徒を選ぶ」で選ぶと、
      // 空いている枠に入ったうえで、この行の子が差し替わる（2026-09-03 の 31）
      st.wantRow = +row.getAttribute('data-ix');
      st.sel = st.wantRow;
      var fi = $('i-find');
      if (fi) { fi.scrollIntoView({ block: 'center' }); fi.focus(); }
      draw(); return;
    }
    mark();
    if (k === 'md') {
      u.md = el.value;
      if (u.md === 'c' && u.cv == null) { u.cv = 10; }
      if (u.md === 't' && u._rt != null) { u.t = u._rt; }
    } else if (k === 'v') {
      // **2 行以上選んでいるときは、動かした差ぶんを全部に乗せる**
      // （2026-09-03 の 33。「5 発まとめて 2 秒ずらす」）
      var sel = selRows(), cur = (u.md || 't') === 'c' ? (u.cv == null ? 10 : u.cv) : u.t;
      var nv = Math.max(0, +el.value || 0), dv = nv - cur, zq;
      if (sel.length > 1 && sel.indexOf(+row.getAttribute('data-ix')) >= 0 && dv) {
        for (zq = 0; zq < sel.length; zq++) {
          var us2 = st.tl[sel[zq]];
          if ((us2.md || 't') === 'c') { us2.cv = Math.max(0, (us2.cv == null ? 10 : us2.cv) + dv); }
          else { us2.t = Math.max(0, us2.t + dv); }
        }
      } else if ((u.md || 't') === 'c') { u.cv = nv; } else { u.t = nv; }
    } else if (k === 'mc') {
      // **当たる数。**1 より大きくすると、転移する部位に当てたうえで本体にも当たる
      // 形にする（2026-09-03。それまで「詳細」を開かないと置けなかった）。
      // まとめて選んでいるときは選んだ行ぜんぶに同じ数を入れる
      var ti2 = trIx(diff()), mv = Math.max(1, Math.min(99, Math.round(+el.value || 1)));
      var msm = selRows(), zm;
      var tgt = (msm.length > 1 && msm.indexOf(+row.getAttribute('data-ix')) >= 0)
        ? msm : [+row.getAttribute('data-ix')];
      for (zm = 0; zm < tgt.length; zm++) {
        var um = st.tl[tgt[zm]];
        if (!um) { continue; }
        if (mv <= 1) { um.mc = null; if (um.tg === ti2) { um.tg = null; um.hb = 0; } }
        // **転移する部位のときだけ「ボス本体にも」を立てる。**HP を共有する池
        // （カイテンジャー）は部位そのものが討伐の相手なので、本体は別に無い
        else if (ti2 >= 0) {
          um.tg = ti2; um.mc = mv;
          um.hb = ((diff().sub || [])[ti2] || {}).tr ? 1 : 0;
        }
      }
    } else if (k === 'who') { u.i = +el.value; st.wantRow = null; }
    else if (k === 'bto') {
      var bx = row.querySelectorAll('select[data-tr="bto"]'), lb = [], zz;
      for (zz = 0; zz < bx.length; zz++) { lb.push(bx[zz].value === '' ? null : +bx[zz].value); }
      u.bto = lb.length > 1 ? lb : (lb[0] == null ? null : lb[0]);
      // **通常スキルのバフも同じ相手へ。**渡し先を行で決められるようにして
      // 左の「バフを渡す相手」パネルを消したので、枠の既定がまだ空のときだけ入れる
      // （後から 1 行だけ変えても、ほかの行は動かない）
      var sl0 = st.slots[u.i];
      if (sl0 && toList(sl0.nsto).length === 0 && u.bto != null) { sl0.nsto = u.bto; }
    }
    draw();
  });
  $('rowlist').addEventListener('change', onUse);
  $('rowlist').addEventListener('input', onAlt);
  $('rowlist').addEventListener('click', onAct);
  $('rowlist').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tr]');
    if (!b) { return; }
    var k = b.getAttribute('data-tr');
    if (k === 'add') { rowAdd(); return; }
    var row = b.closest('.trow'), ix = row ? +row.getAttribute('data-ix') : -1;
    if (!st.tl[ix]) { return; }
    if (k === 'del') {
      // **消したら次の行を選んだままにする**（2026-09-03 の 32。
      // 続けて消すたびに探し直しになっていた）
      // **まとめて選んでいるときは選んだぶん全部**（33）
      var msd = selRows();
      if (msd.length > 1 && msd.indexOf(ix) >= 0) {
        mark();
        var keep = msd.map(function (z) { return st.tl[z]; }), zq2;
        for (zq2 = st.tl.length - 1; zq2 >= 0; zq2--) {
          if (keep.indexOf(st.tl[zq2]) >= 0) { st.tl.splice(zq2, 1); }
        }
        st.msel = []; st.sel = null; draw(); return;
      }
      mark();
      var od = rowOrder(), po = od.indexOf(ix);
      var nx = od[po + 1] != null ? st.tl[od[po + 1]]
             : (po > 0 ? st.tl[od[po - 1]] : null);
      st.tl.splice(ix, 1);
      var ni = nx ? st.tl.indexOf(nx) : -1;
      st.sel = ni >= 0 ? ni : null;
      draw(); return;
    }
    if (k === 'md1') {
      // 秒 → コスト → 最短 → 秒。**押すたびに 1 つ回る**（35）
      mark();
      var cm = MD3.indexOf(b.getAttribute('data-md'));
      var u2 = st.tl[ix];
      u2.md = MD3[(cm + 1) % MD3.length];
      if (u2.md === 'c' && u2.cv == null) { u2.cv = 10; }
      if (u2.md === 't' && u2._rt != null) { u2.t = u2._rt; }
      draw(); return;
    }
    if (k === 'f1') {
      // 形態。自動 → 1 → 2 …→ 自動（36）
      mark();
      var u3 = st.tl[ix], d3 = st.party[u3.i], nf = d3 ? TE.forms(d3).length : 0;
      if (!nf) { return; }
      u3.f = (u3.f == null || u3.f === '') ? 0 : (+u3.f + 1 >= nf ? null : +u3.f + 1);
      draw(); return;
    }
    if (k === 'up' || k === 'dn') {
      var dir = k === 'up' ? -1 : 1, msv = selRows();
      // **まとめて選んでいるときは、選んだぶんを順に 1 歩**（33）。
      // 上へ動かすときは前から、下へ動かすときは後ろから運ばないと潰し合う
      if (msv.length > 1 && msv.indexOf(ix) >= 0) {
        var ordm = rowOrder(), seq = msv.slice().sort(function (a, b) {
          return (ordm.indexOf(a) - ordm.indexOf(b)) * dir;
        }), zq3;
        for (zq3 = 0; zq3 < seq.length; zq3++) { rowSwap(seq[zq3], dir); }
        return;
      }
      rowSwap(ix, dir); return;
    }
    if (k === 'det') { st.sel = (st.sel === ix ? null : ix); draw(); rowSeek(ix); }
  });
  // **行のどこを押しても、その 1 発を選ぶ。**摘みと入力欄の上は今までどおり
  $('rowlist').addEventListener('mousedown', function (e) {
    if (e.target.closest('button, select, input, .fields')) { return; }
    var row = e.target.closest('.trow');
    if (!row || row.classList.contains('add')) { return; }
    var ix = +row.getAttribute('data-ix');
    if (!st.tl[ix]) { return; }
    var add = e.ctrlKey || e.metaKey;
    if (!e.shiftKey && !add && st.sel === ix && !(st.msel || []).length) { return; }
    selPick(ix, e.shiftKey, add);
    draw(); rowSeek(ix);
  });
  // **行を掴んで運ぶ**（30）。掴めるのは左端の番号だけ（入力欄の文字は選べるまま）
  (function () {
    var from = -1;
    function clr() {
      var a = $('rowlist').querySelectorAll('.trow.drop'), i;
      for (i = 0; i < a.length; i++) { a[i].classList.remove('drop', 'dn'); }
    }
    $('rowlist').addEventListener('dragstart', function (e) {
      var row = e.target.closest('.trow');
      if (!row || row.classList.contains('add')) { return; }
      from = +row.getAttribute('data-ix');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); }
    });
    $('rowlist').addEventListener('dragover', function (e) {
      if (from < 0) { return; }
      var row = e.target.closest('.trow');
      if (!row || row.classList.contains('add')) { return; }
      e.preventDefault();
      var r = row.getBoundingClientRect(), dn = e.clientY > r.top + r.height / 2;
      clr();
      row.classList.add('drop');
      if (dn) { row.classList.add('dn'); }
    });
    $('rowlist').addEventListener('drop', function (e) {
      if (from < 0) { return; }
      var row = e.target.closest('.trow');
      e.preventDefault(); clr();
      if (row && !row.classList.contains('add')) {
        var to = +row.getAttribute('data-ix'), od = rowOrder();
        var pf = od.indexOf(from), pt = od.indexOf(to);
        var r2 = row.getBoundingClientRect();
        if (e.clientY > r2.top + r2.height / 2) { pt++; }
        if (pf >= 0 && pt > pf) { pt--; }
        rowMove(from, pt);
      }
      from = -1;
    });
    $('rowlist').addEventListener('dragend', function () { clr(); from = -1; });
  })();
  // シナリオの切り替え。**上の数字も達成率の表も図も同じものを見る**
  $('kpi').addEventListener('change', function (e) {
    if (e.target.id !== 'k-scen') { return; }
    st.scen = +e.target.value;
    try { localStorage.setItem('tl-scen', String(st.scen)); } catch (e2) { void e2; }
    draw();
  });
  $('rate').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-scen]');
    if (!tr) { return; }
    st.scen = +tr.getAttribute('data-scen');
    try { localStorage.setItem('tl-scen', String(st.scen)); } catch (e2) { void e2; }
    draw();
  });
  (function () {
    var v = null;
    try { v = localStorage.getItem('tl-scen'); } catch (e) { void e; }
    // **画面から選べない番号は覚え直さない**（前は 0〜6 のどれでも保存できた）
    if (v != null && isFinite(+v) && SCEN[+v] && SCEN[+v].ui) { st.scen = +v; }
    v = null;
    try { v = localStorage.getItem('tl-crit'); } catch (e2) { void e2; }
    if (v != null && isFinite(+v)) { st.crit = clamp(+v, 0, 1); }
  })();
  // 会心率のバー。**`st.scen` と同じ「見え方の設定」**なので localStorage 側に置く。
  // 動かすと上の帯・表・図が全部その会心率で引き直る（2026-09-03）
  $('i-crit').addEventListener('input', function () {
    st.crit = clamp(+this.value / 100, 0, 1);
    try { localStorage.setItem('tl-crit', String(st.crit)); } catch (e) { void e; }
    bump(); draw();
  });
  $('b-critauto').addEventListener('click', function () {
    st.crit = null;
    try { localStorage.removeItem('tl-crit'); } catch (e) { void e; }
    bump(); draw();
  });
  document.querySelector('.tools2').addEventListener('click', onAct);
  $('b-goal').addEventListener('click', onAct);
  $('useedit').addEventListener('click', onAct);

  // **Ctrl+Z / Ctrl+Y は画面のどこにいても効く。**入力欄の中だけは横取りしない
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) { return; }
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
    var k = (e.key || '').toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } }
    else if (k === 'y') { e.preventDefault(); redo(); }
  });

}
