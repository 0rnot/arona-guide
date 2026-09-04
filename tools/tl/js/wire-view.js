import { $ } from './util.js';
import { st } from './core.js';
import { diff } from './boss.js';
import { mark } from './undo.js';
import { draw } from './draw.js';
import { coverOfUse, drawView, pickShot, sceneAt, VT } from './view.js';

// ------------------------------------------------------------ 盤で位置を置く
// **狙う点と、動く体をドラッグで置く**（2026-09-04 の先生の指示
// 「盤の右側を入力にして、スキルの位置も決められる？」「移動する個体は
//   ドラックで動かせるようにすればいいかな？」）。
//
// 置けるのは**「入力」で詳細を開いている 1 発**だけ（`st.sel`）で、その枠が
// 敵をターゲットできる／攻撃範囲を指定できるとき（`board.js` の `placeKind`）
// だけ摘みが出る。**置いたら `mc`（当たる数）と `hb`（本体にも当たる）を
// その場で数え直す。**置かなければ今までどおり「いちばん多く巻き込める置き方」。

var drag = null;

/** 画面の座標をワールドの座標に。**`#bgrp` の行列をそのまま逆に使う**ので、
    viewBox と上下反転（`scale(1,-1)`）を自分で解き直さない。 */
function world(e) {
  var svg = $('bsvg'), g = $('bgrp');
  if (!svg || !g || !svg.createSVGPoint) { return null; }
  var m = g.getScreenCTM();
  if (!m) { return null; }
  var pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  var w = pt.matrixTransform(m.inverse());
  return { x: w.x, y: w.y };
}

/** 置いたあとの数え直し。`mc` は当たった部位の数、`hb` は本体にも当たったか。
    **`st.tl` の行に書き戻す**（`usesSorted` の写しではなく正本のほう）。 */
function recount(sh) {
  var u = st.tl[sh.ix];
  if (!u) { return; }
  var r = diff();
  var q = coverOfUse(r, { i: sh.i, k: sh.k, tg: u.tg, ax: u.ax, ay: u.ay, bp: u.bp },
                     sceneAt(r, VT == null ? 0 : VT));
  if (!q || u.tg == null) { return; }
  u.mc = Math.max(1, q.nb);
  u.hb = q.hb ? 1 : 0;
}

export function wireView() {
  var pane = $('rowpane');
  if (!pane) { return; }
  pane.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !e.target.closest) { return; }
    if (!e.target.closest('#bsvg')) { return; }
    var h = e.target.closest('[data-h="aim"]'), b = e.target.closest('circle.mv[data-k]');
    if (!h && !b) { return; }
    var sh = pickShot(diff());
    if (!sh || sh.ix == null || !st.tl[sh.ix]) { return; }
    e.preventDefault();
    mark();
    drag = { sh: sh, k: b ? b.getAttribute('data-k') : null, moved: false };
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) { return; }
    var w = world(e);
    if (!w) { return; }
    var u = st.tl[drag.sh.ix];
    if (!u) { drag = null; return; }
    drag.moved = true;
    if (drag.k) {
      if (!u.bp) { u.bp = {}; }
      u.bp[drag.k] = [+w.x.toFixed(2), +w.y.toFixed(2)];
    } else {
      u.ax = +w.x.toFixed(2); u.ay = +w.y.toFixed(2);
    }
    drawView();
  });
  window.addEventListener('mouseup', function () {
    if (!drag) { return; }
    var sh = drag.sh, moved = drag.moved;
    drag = null;
    if (!moved) { return; }
    recount(sh);
    draw();
  });
  pane.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('[data-h="reset"]')) { return; }
    var sh = pickShot(diff());
    if (!sh || sh.ix == null || !st.tl[sh.ix]) { return; }
    mark();
    var u = st.tl[sh.ix];
    delete u.ax; delete u.ay; delete u.bp;
    recount(sh);
    draw();
  });
}
