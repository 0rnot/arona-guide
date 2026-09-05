import { $ } from './util.js';
import { st } from './core.js';
import { diff } from './boss.js';
import { aimFromHits } from './board.js';
import { mark } from './undo.js';
import { draw } from './draw.js';
import { coverOfUse, drawView, pickShot, playSet, rateSet, sceneAt,
         PLAY, RATE, VT } from './view.js';
import { movePh } from './ord.js';

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
  // **盤の外へは置けない**（2026-09-04 の先生の指摘「スキル動かす時に盤面が
  // 無限に広がってターゲットしづらい」）。枠は `boardBox` で節ごとに決め打ちなので、
  // その中へ丸めれば絵からはみ出さない
  var vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  if (vb.length === 4 && vb.every(function (v) { return isFinite(v); })) {
    w.x = Math.max(vb[0], Math.min(vb[0] + vb[2], w.x));
    w.y = Math.max(vb[1], Math.min(vb[1] + vb[3], w.y));
  }
  return { x: w.x, y: w.y };
}

/** 置いたあとの数え直し。`mc` は当たった部位の数、`hb` は本体にも当たったか。
    **`st.tl` の行に書き戻す**（`usesSorted` の写しではなく正本のほう）。 */
function recount(sh) {
  var u = st.tl[sh.ix];
  if (!u) { return; }
  var r = diff();
  var q = coverOfUse(r, { i: sh.i, k: sh.k, ax: u.ax, ay: u.ay, bp: u.bp },
                     sceneAt(r, VT == null ? 0 : VT));
  var a = aimFromHits(r, q);
  if (!a) { return; }
  u.tg = a.tg; u.mc = a.mc; u.hb = a.hb;
  delete u._ak;
}

// ---- 再生。**ゲームと同じで、止めているあいだも盤は赤い線の位置**
// （2026-09-04 の先生の「再生停止と等倍から3倍切り替えも実装できちゃう？」）。
// 進めるのは `movePh`——赤い線・概況の帯・盤がまとめて付いてくる
var _raf = 0, _last = 0;
function tick(now) {
  _raf = 0;
  if (!PLAY) { return; }
  var dur = (diff().dur || 240);
  var t = (VT == null ? 0 : VT) + (now - _last) / 1000 * RATE;
  _last = now;
  if (t >= dur) { t = dur; playSet(false); }
  st.pin = t;
  movePh(t);
  if (PLAY) { _raf = requestAnimationFrame(tick); } else { drawView(); }
}
function play(on) {
  playSet(on);
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (!on) { drawView(); return; }
  var dur = (diff().dur || 240);
  // **終わりまで来ていたら頭から。**もう一度押したときに何も起きないと戸惑う
  if ((VT == null ? 0 : VT) >= dur - 1e-6) { st.pin = 0; movePh(0); }
  _last = (window.performance || Date).now();
  _raf = requestAnimationFrame(tick);
}

export function wireView() {
  var pane = $('rowpane');
  if (!pane) { return; }
  pane.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !e.target.closest) { return; }
    if (!e.target.closest('#bsvg')) { return; }
    var h = e.target.closest('[data-h="aim"]'), b = e.target.closest('circle.bd[data-k]');
    if (!h && !b) { return; }
    var sh = pickShot(diff());
    if (!sh || sh.ix == null || !st.tl[sh.ix]) { return; }
    e.preventDefault();
    mark();
    // **体を押したら、その発はその体を狙う**（`bk`。2026-09-05 夜）。体は動かさない——
    // 前は動く体をドラッグで置けたが、置いた瞬間に歩きが止まっていた（先生の指摘）
    if (b) {
      var ub = st.tl[sh.ix];
      ub.bk = b.getAttribute('data-k'); delete ub.ax; delete ub.ay; delete ub.bp;
      recount(sh); draw();
      return;
    }
    drag = { sh: sh, k: null, moved: false };
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
      u.ax = +w.x.toFixed(2); u.ay = +w.y.toFixed(2); delete u.bk;
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
    if (!e.target.closest) { return; }
    if (e.target.closest('[data-h="play"]')) { play(!PLAY); return; }
    if (e.target.closest('[data-h="rate"]')) {
      // **等倍と 3 倍の 2 段**（先生の言葉のまま）
      rateSet(RATE === 1 ? 3 : 1); drawView(); return;
    }
    if (!e.target.closest('[data-h="reset"]')) { return; }
    var sh = pickShot(diff());
    if (!sh || sh.ix == null || !st.tl[sh.ix]) { return; }
    mark();
    var u = st.tl[sh.ix];
    delete u.ax; delete u.ay; delete u.bp; delete u.bk;
    recount(sh);
    draw();
  });
}
