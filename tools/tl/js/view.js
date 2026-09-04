import { $, B, esc } from './util.js';
import { st } from './core.js';
import { diff } from './boss.js';
import { phaseSpans, ggRuns, ggSolve } from './carry.js';
import { usesSorted } from './buff.js';
import { beaconOf, bestHitsOf, bodiesOf, fightSecs, hitsOf, shapeAt } from './board.js';

// ------------------------------------------------------------ 盤と経過（第 5 段）
// **画面に文章を足さずに、盤とボスの動きを目で見られるようにする**（2026-09-04）。
// 開くまで何も描かないので、**閉じているあいだはページの高さが変わらない。**
//
// 左に盤の絵（誰がどこに立って、何を狙って、何体を覆っているか）、
// 右に経過の並び（フェーズ・召喚・吸収・グロッキー・置いた発）。
// **形は `board.js` の `shapeAt` から取る**——`coverOf` が数えるのと同じ形なので、
// 「絵では覆っているのに数に入らない」がありえない。

export var VIEW = false;
export function viewToggle() {
  VIEW = !VIEW;
  $('b-view').setAttribute('aria-pressed', VIEW ? 'true' : 'false');
  $('viewpane').hidden = !VIEW;
  drawView();
}
/** 盤に載せる場面。`0` ふだん、`1` グロッキー中 */
export var GG = 0;
export function setGG(v) { GG = v ? 1 : 0; drawView(); }

function fmt(t) { return (+t).toFixed(1); }

/** **絵にする 1 発。**選んでいる行があればそれ、無ければ「当たる先を決めてある発」の
    いちばん早いもの。どれも無ければ編成の先頭の EX。 */
function pickShot(r) {
  var us = usesSorted().filter(function (u) { return u.no == null; }), i;
  var sel = st.sel != null ? st.tl[st.sel] : null;
  if (sel) {
    for (i = 0; i < us.length; i++) {
      if (us[i].i === sel.i && Math.abs(us[i].t - (sel._rt != null ? sel._rt : sel.t)) < 1e-6) {
        return us[i];
      }
    }
  }
  for (i = 0; i < us.length; i++) { if (us[i].tg != null) { return us[i]; } }
  return us[0] || null;
}

/** 盤の絵。`sh` は `pickShot` の 1 発（無ければ形は描かない）。 */
function boardSvg(r, sec, sh) {
  var on = GG ? ['st:Groggy'] : null, ex = GG ? false : null;
  var bs = bodiesOf(r, sec, ex, on), bc = beaconOf(r, sec), i;
  if (!bs.length) { return '<p class="mut tiny">この相手には盤のデータがありません</p>'; }
  var sid = sh ? (st.party[sh.i] || {}).id : null;
  var kd = sh ? sh.k : null;
  var q = (sid != null && (B.area[sid] || {})[kd])
    ? (bestHitsOf(r, sid, kd, sec, ex, on) || hitsOf(r, sid, kd, sec, ex, on)) : null;
  var geo = q ? shapeAt((B.area[sid] || {})[kd], q.c,
                        { x: q.c.x - q.me.x, y: q.c.y - q.me.y },
                        (B.geo[sid] || {})[kd]) : null;
  // 範囲を全部含む枠を取る
  var xs = [], ys = [];
  for (i = 0; i < bs.length; i++) {
    xs.push(bs[i].x - bs[i].br, bs[i].x + bs[i].br);
    ys.push(bs[i].y - bs[i].br, bs[i].y + bs[i].br);
  }
  if (bc) { xs.push(bc.x); ys.push(bc.y); }
  if (q && q.me) { xs.push(q.me.x); ys.push(q.me.y); }
  if (geo) {
    var rr = Math.max(geo.R, geo.EX, Math.max(geo.W, geo.H) / 2);
    xs.push(geo.cx - rr, geo.cx + rr); ys.push(geo.cy - rr, geo.cy + rr);
  }
  var x0 = Math.min.apply(null, xs) - 2, x1 = Math.max.apply(null, xs) + 2;
  var y0 = Math.min.apply(null, ys) - 2, y1 = Math.max.apply(null, ys) + 2;
  var hitN = {};
  if (q) { for (i = 0; i < q.hit.length; i++) { hitN[q.hit[i].n + '|' + q.hit[i].x + '|' + q.hit[i].y] = 1; } }
  // **画面の上が奥。**`Stage` の y は奥ほど大きいので、そのまま描くと上下が逆になる
  var g = '<g transform="translate(0,' + (y0 + y1) + ') scale(1,-1)">';
  if (geo) { g += shapePath(geo); }
  for (i = 0; i < bs.length; i++) {
    var p = bs[i], on2 = hitN[p.n + '|' + p.x + '|' + p.y];
    g += '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' +
         p.br.toFixed(2) + '" class="bd' + (p.cid === r.cid ? ' boss' : '') +
         (on2 ? ' on' : '') + '"><title>' + esc(p.n) +
         (p.sum ? '（' + p.sum + ' の召喚）' : '') + '\n半径 ' + p.br.toFixed(2) +
         '\n' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + '</title></circle>';
  }
  if (bc) { g += '<circle cx="' + bc.x + '" cy="' + bc.y + '" r="0.8" class="bcn"><title>生徒の立ち位置（ビーコン）</title></circle>'; }
  if (q && q.me) {
    g += '<circle cx="' + q.me.x.toFixed(2) + '" cy="' + q.me.y.toFixed(2) +
         '" r="0.8" class="me"><title>撃つ子の立ち位置</title></circle>';
  }
  g += '</g>';
  return '<svg class="bsvg" viewBox="' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' ' +
         (x1 - x0).toFixed(2) + ' ' + (y1 - y0).toFixed(2) + '" preserveAspectRatio="xMidYMid meet">' +
         g + '</svg>';
}

/** 形を SVG の図形に。**`shapeAt` の返り値をそのまま描く。** */
function shapePath(g) {
  var cx = g.cx, cy = g.cy, a = Math.atan2(g.uy, g.ux) * 180 / Math.PI;
  if (g.typ === 'Circle' && !g.EX) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + g.R + '" class="ar"/>';
  }
  if (g.typ === 'Circle' || g.typ === 'Donut') {
    var deg = (g.typ === 'Donut' && g.deg && g.deg < 360) ? g.deg : 360;
    return ring(cx, cy, g.R, g.EX, a, deg);
  }
  if (g.typ === 'Fan') {
    return (!g.deg || g.deg >= 360)
      ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + g.R + '" class="ar"/>'
      : ring(cx, cy, g.R, 0, a, g.deg);
  }
  if (g.typ === 'Obb') {
    return '<rect x="' + (cx - g.W / 2) + '" y="' + (cy - g.H / 2) + '" width="' + g.W +
           '" height="' + g.H + '" class="ar" transform="rotate(' + (a - 90) + ' ' + cx + ' ' + cy + ')"/>';
  }
  return '';
}
function pol(cx, cy, r, deg) {
  var a = deg * Math.PI / 180;
  return [(cx + r * Math.cos(a)).toFixed(3), (cy + r * Math.sin(a)).toFixed(3)];
}
function ring(cx, cy, R, EX, a, deg) {
  if (deg >= 360) {
    return '<path class="ar" d="M ' + (cx - R) + ' ' + cy + ' a ' + R + ' ' + R + ' 0 1 0 ' + (R * 2) +
           ' 0 a ' + R + ' ' + R + ' 0 1 0 ' + (-R * 2) + ' 0 Z' +
           (EX ? ' M ' + (cx - EX) + ' ' + cy + ' a ' + EX + ' ' + EX + ' 0 1 1 ' + (EX * 2) +
                 ' 0 a ' + EX + ' ' + EX + ' 0 1 1 ' + (-EX * 2) + ' 0 Z' : '') + '"/>';
  }
  var s = a - deg / 2, e = a + deg / 2, big = deg > 180 ? 1 : 0;
  var o1 = pol(cx, cy, R, s), o2 = pol(cx, cy, R, e);
  if (!EX) {
    return '<path class="ar" d="M ' + cx + ' ' + cy + ' L ' + o1[0] + ' ' + o1[1] +
           ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + o2[0] + ' ' + o2[1] + ' Z"/>';
  }
  var i1 = pol(cx, cy, EX, e), i2 = pol(cx, cy, EX, s);
  return '<path class="ar" d="M ' + o1[0] + ' ' + o1[1] +
         ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + o2[0] + ' ' + o2[1] +
         ' L ' + i1[0] + ' ' + i1[1] +
         ' A ' + EX + ' ' + EX + ' 0 ' + big + ' 0 ' + i2[0] + ' ' + i2[1] + ' Z"/>';
}

/** 経過の並び。 */
function logRows(r) {
  var dur = r.dur || 240, out = [], i;
  var sp = phaseSpans(r), gr = ggRuns(r);
  for (i = 0; i < sp.length; i++) {
    out.push([sp[i].t0, 'ph', 'フェーズ ' + (+sp[i].p + 1) +
              (sp[i].atg ? '（ゲージ）' : sp[i].need == null ? '' : '（HP）')]);
  }
  for (i = 0; i < (gr.abs || []).length; i++) {
    var a = gr.abs[i];
    out.push([a.t, 'abs', '吸収　転倒 ' + a.n + ' 体　ゲージ ' +
              Math.round(a.g / 100) + '%']);
  }
  for (i = 0; i < (gr.hits || []).length; i++) {
    out.push([gr.hits[i].t, 'gg', 'グロッキー　' + fmt(gr.hits[i].t) + '〜' + fmt(gr.hits[i].until) + ' 秒']);
  }
  var us = usesSorted().filter(function (u) { return u.no == null; });
  for (i = 0; i < us.length; i++) {
    var u = us[i], nm = (st.party[u.i] || {}).en || '?';
    out.push([u.t, 'ex', nm + '　' + u.k +
              (u.tg != null ? '　当たる数 ' + (u.mc || 1) + (u.hb ? '＋本体' : '') : '')]);
  }
  out.sort(function (x, y) { return x[0] - y[0]; });
  var h = '';
  for (i = 0; i < out.length; i++) {
    if (out[i][0] > dur + 1e-9) { continue; }
    h += '<div class="lg ' + out[i][1] + '"><b>' + fmt(out[i][0]) + '</b>' +
         esc(out[i][2]) + '</div>';
  }
  return h || '<p class="mut tiny">まだ何も置いていません</p>';
}

export function drawView() {
  if (!VIEW || !$('viewpane')) { return; }
  var r = diff();
  ggSolve(r);
  var secs = fightSecs(r), sec = secs.length ? secs[0] : 0;
  var sh = pickShot(r);
  var nm = sh ? ((st.party[sh.i] || {}).en || '') : '';
  var q = null;
  if (sh) {
    var sid = (st.party[sh.i] || {}).id;
    if ((B.area[sid] || {})[sh.k]) {
      q = bestHitsOf(r, sid, sh.k, sec, GG ? false : null, GG ? ['st:Groggy'] : null);
    }
  }
  var head = '<div class="vhd">' +
    '<span class="seg"><button type="button" class="sg' + (GG ? '' : ' on') + '" data-gg="0">ふだんの盤</button>' +
    '<button type="button" class="sg' + (GG ? ' on' : '') + '" data-gg="1">グロッキー中</button></span>' +
    (sh ? '<b>' + esc(nm) + '　' + esc(sh.k) + '　' + fmt(sh.t) + ' 秒</b>' : '') +
    (q ? '<span class="mut tiny">覆う ' + q.n + ' 体（部位 ' + q.nb + (q.hb ? '＋本体' : '') + '）</span>' : '') +
    '</div>';
  $('viewpane').querySelector('.bd').innerHTML =
    head + '<div class="vwrap"><div class="vbd">' + boardSvg(r, sec, sh) +
    '</div><div class="vlg">' + logRows(r) + '</div></div>';
}
