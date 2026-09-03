import { $, B, S, view } from './util.js';
import { st } from './core.js';
import { mark, redo, undo } from './undo.js';
import { addUse, delSel, fixUse, snap } from './uses.js';
import { diff } from './boss.js';
import { draw } from './draw.js';
import { keyHelp } from './rate.js';
import { movePh } from './ord.js';
import { fit, relayout, zoomAt, zoomAtTime } from './zoom.js';
import { bstDel } from './bossui.js';

export function timeAt(clientX) {
  var box = view.getBoundingClientRect();
  return (clientX - box.left + view.scrollLeft) / st.px;
}
export var drag = null, sdrag = null, bdrag = null;

export function wireMouse() {
  // ------------------------------------------------------------ マウス
  // **定石に合わせる**（2026-09-01 に 12 本のソフトを調べた結論）。
  // ホイール単体は縦スクロール（ブラウザに任せる）、Ctrl+ホイールで拡大、
  // Shift+ホイールで横移動。トラックパッドのピンチは ctrlKey=true の wheel で届く
  view.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.clientX, e.deltaY < 0 ? 1.15 : 1 / 1.15); return; }
    if (e.shiftKey) { e.preventDefault(); view.scrollLeft += (e.deltaY || e.deltaX); }
  }, { passive: false });
  view.addEventListener('mousemove', function (e) {
    // **帯を掴んでいる間はカーソルの札を組み直さない**（2026-09-03）。
    // `movePh` は `drawOrd` → `sim()` を通るので、動かすたびに丸ごと解き直していた
    if (sdrag || bdrag || drag) { return; }
    if (st.pin != null) { return; }
    var box = view.getBoundingClientRect();
    movePh((e.clientX - box.left + view.scrollLeft) / st.px);
  });
  view.addEventListener('click', function (e) {
    var mk = e.target.closest('.mkt');
    if (mk) {
      st.mk.splice(+mk.getAttribute('data-mk'), 1); draw(); return;
    }
    if (e.target.closest('.b')) { return; }
    if (e.target.closest('.exlane')) { return; }
    var t = timeAt(e.clientX);
    st.pin = st.pin == null ? t : null;
    movePh(t); view.focus();
  });
  view.addEventListener('mousedown', function (e) {
    view.focus();
    if (e.button === 1) { drag = { x: e.clientX, l: view.scrollLeft }; e.preventDefault(); return; }
    if (e.button !== 0) { return; }
    if (e.target.closest('.mkt')) { return; }
    // ボスの状態の帯。**端の摘みで t0 / t1、× で消す**（2026-09-03）
    var bnd = e.target.closest('.b.bst');
    if (bnd) {
      e.preventDefault();
      var wi = +bnd.getAttribute('data-bw'), wq = st.bst[wi];
      if (!wq) { return; }
      if (e.target.closest('.x')) { mark(); bstDel(wi); return; }
      // 端の摘み（0 / 1）なら片側だけ、帯の中なら長さを変えずに丸ごと動かす（2）
      var grp = e.target.closest('.gr');
      mark();
      bdrag = { i: wi, sd: grp ? +grp.getAttribute('data-bg') : 2,
                x: e.clientX, t0: wq.t0, t1: wq.t1 };
      return;
    }
    var bar = e.target.closest('.b.sk');
    if (bar) {
      mark();
      st.sel = +bar.getAttribute('data-ix');
      sdrag = { ix: st.sel, x: e.clientX, t0: st.tl[st.sel].t, moved: false, el: bar };
      e.preventDefault(); draw(); return;
    }
    var ln = e.target.closest('.exlane');
    if (ln) {
      e.preventDefault();
      addUse(+ln.getAttribute('data-mem'), timeAt(e.clientX));
      return;
    }
    st.sel = null;
  });
  window.addEventListener('mousemove', function (e) {
    if (drag) { view.scrollLeft = drag.l - (e.clientX - drag.x); return; }
    if (bdrag) {
      // **0.1 秒に吸い付く。**動画から起こす秒はそこまでしか読めない
      var wq2 = st.bst[bdrag.i], d3 = diff().dur || 240;
      if (!wq2) { bdrag = null; return; }
      var dt3 = (e.clientX - bdrag.x) / st.px;
      if (bdrag.sd === 2) {
        var mv = Math.round((bdrag.t0 + dt3) * 10) / 10;
        mv = Math.max(0, Math.min(d3 - (bdrag.t1 - bdrag.t0), mv));
        wq2.t0 = mv; wq2.t1 = mv + (bdrag.t1 - bdrag.t0);
        draw(); return;
      }
      var nv = (bdrag.sd ? bdrag.t1 : bdrag.t0) + dt3;
      nv = Math.max(0, Math.min(d3, Math.round(nv * 10) / 10));
      if (bdrag.sd) { wq2.t1 = Math.max(wq2.t0, nv); } else { wq2.t0 = Math.min(wq2.t1, nv); }
      draw(); return;
    }
    if (!sdrag) { return; }
    var dt = (e.clientX - sdrag.x) / st.px;
    if (Math.abs(e.clientX - sdrag.x) > 2) { sdrag.moved = true; }
    var u = st.tl[sdrag.ix];
    if (!u) { sdrag = null; return; }
    var nt = snap(Math.max(0, sdrag.t0 + dt));
    if (nt === u.t) { return; }
    u.t = nt; u.md = 't';
    // **掴んでいる間は、掴んでいる帯 1 本だけ動かす**（2026-09-03 の先生の指摘
    // 「スキル入れてくとタイムラインで EX をまともにドラッグ出来ないくらい重くなる」）。
    // `draw()` は編成ぜんぶの通常攻撃・達成率・行の表まで引き直すので、
    // 動かすたびに丸ごとやり直していた。**指を離したときに 1 回だけ全部を引き直す**
    if (sdrag.el) {
      sdrag.el.style.left = (nt * st.px).toFixed(1) + 'px';
      sdrag.el.title = nt.toFixed(2) + '秒';
    }
  });
  window.addEventListener('mouseup', function () {
    if (sdrag && sdrag.moved && st.tl[sdrag.ix]) { fixUse(st.tl[sdrag.ix]); draw(); }
    drag = null; sdrag = null; bdrag = null;
  });

  // ------------------------------------------------------------ キーボード
  // W/S 拡大・A/D 横移動は Perfetto と DevTools の Performance に合わせた
  view.addEventListener('keydown', function (e) {
    var r = diff(), dur = r.dur || 240, f = 1 / B.fps;
    var t = st.pin == null ? 0 : st.pin, hit = true;
    var step = e.ctrlKey || e.metaKey ? 1 : (e.shiftKey ? f * 10 : f);
    switch (e.key) {
      case 'ArrowRight': st.pin = Math.min(dur, t + step); break;
      case 'ArrowLeft': st.pin = Math.max(0, t - step); break;
      case 'Home': fit(); return;
      case 'End': st.pin = dur; break;
      case 'w': case 'W': zoomAtTime(t, 1.25); return;
      case 's': case 'S': zoomAtTime(t, 1 / 1.25); return;
      case 'a': case 'A': view.scrollLeft -= view.clientWidth * 0.2; return;
      case 'd': case 'D': view.scrollLeft += view.clientWidth * 0.2; return;
      case 'f': case 'F': fit(); return;
      case 'Delete': case 'Backspace': delSel(); e.preventDefault(); return;
      case 'z': case 'Z':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } }
        return;
      case 'y': case 'Y':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo(); }
        return;
      case 'Escape': st.sel = null; st.pin = null; $('phbox').hidden = true;
        $('ph').style.left = '-10px'; draw(); return;
      case '?': keyHelp(); break;
      default: hit = false;
    }
    if (!hit) { return; }
    e.preventDefault();
    movePh(st.pin);
    var x = st.pin * st.px;
    if (x < view.scrollLeft + 40) { view.scrollLeft = x - 40; }
    if (x > view.scrollLeft + view.clientWidth - 40) { view.scrollLeft = x - view.clientWidth + 40; }
  });
  window.addEventListener('resize', function () {
    clearTimeout(window.__tlrz); window.__tlrz = setTimeout(relayout, 120);
  });
}
