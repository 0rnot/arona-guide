import { $, B, esc } from './util.js';
import { st } from './core.js';
import { diff } from './boss.js';
import { bossAdv, phaseSpans, ggRuns, ggSolve } from './carry.js';
import { usesSorted } from './buff.js';
import { beaconOf, bestHitsOf, bodiesOf, hitsOf, secOfSummon, shapeAt } from './board.js';

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
/** **盤の時刻はタイムラインの赤い縦線**（2026-09-04 の先生の指摘
    「発動時間の盤ってより、タイムライン上の赤線の位置の盤か」）。
    節・召喚の波・グロッキーを、その時刻から出す。手で切り替える札は要らなくなった。 */
export var VT = null;
var _raf = 0;
export function viewAt(t) {
  VT = t;
  // **動かすたびに解き直さない。**`movePh` はマウスを動かすたびに来るので、
  // 次の描画まで 1 回にまとめる
  if (!VIEW || _raf) { return; }
  _raf = requestAnimationFrame(function () { _raf = 0; drawView(); });
}

function fmt(t) { return (+t).toFixed(1); }

/** **その時刻の場面。**`{p, gg, wave, sec}`。

      p     … そのときのフェーズ（`phaseSpans`）
      gg    … グロッキー中か（`ggRuns().hits`）
      wave  … 盤に居る召喚の波（最後に撃たれた召喚の EX。吸収の EX で消える）
      sec   … 節（`secOfSummon`。ペロロジラはフェーズごとに前へ移動する）

    **吸収の EX が来たら盤の体は消える**——`Ex09` が 20.0 ワールドの中を
    全部吸ってから、グロッキーの小さなペロロが湧く。 */
function sceneAt(r, t) {
  var sp = phaseSpans(r), gr = ggRuns(r), i, k;
  var cur = sp[sp.length - 1];
  for (i = 0; i < sp.length; i++) {
    if (t >= sp[i].t0 - 1e-9 && t < sp[i].t1) { cur = sp[i]; break; }
  }
  var gg = false;
  for (i = 0; i < (gr.hits || []).length; i++) {
    if (t >= gr.hits[i].t - 1e-9 && t < gr.hits[i].until) { gg = true; }
  }
  var pd = (r.ph || {})[cur.p] || {}, ev = pd.ev || [], smn = (r.board || {}).smn || {};
  var gi = r.gga ? r.gga.exi : null, wave = null, first = null;
  for (i = 0; i < ev.length; i++) {
    if (ev[i][1] == null) { continue; }
    for (k = 0; k < (ev[i][2] || []).length; k++) {
      var nm = r.ex[ev[i][2][k]];
      if (first == null && ev[i][2][k] !== gi && nm && smn[nm]) { first = nm; }
    }
    if (bossAdv(cur.t0, ev[i][1]) > t + 1e-9) { continue; }
    for (k = 0; k < (ev[i][2] || []).length; k++) {
      var g = ev[i][2][k], nm2 = r.ex[g];
      if (g === gi) { wave = null; } else if (nm2 && smn[nm2]) { wave = nm2; }
    }
  }
  var sec = secOfSummon(r, wave || first);
  return { p: cur.p, gg: gg, wave: wave, sec: sec == null ? 0 : sec };
}

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
function boardSvg(r, sc, sh) {
  var sec = sc.sec, on = sc.gg ? ['st:Groggy'] : null, ex = sc.wave || false;
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

/** 経過の並び。**クラス名は `vr` / `v-ph` … と前置きを付ける**（2026-09-04）。
    素の `ph` は**タイムラインの赤い縦線**（再生位置）のクラスで、そのまま使うと
    フェーズの行が `position:absolute` の赤い 1px 線になって盤の横に立っていた。 */
function logRows(r) {
  var dur = r.dur || 240, out = [], i;
  var sp = phaseSpans(r), gr = ggRuns(r);
  for (i = 0; i < sp.length; i++) {
    out.push([sp[i].t0, 'v-ph', 'フェーズ ' + (+sp[i].p + 1) +
              (sp[i].atg ? '（ゲージ）' : sp[i].need == null ? '' : '（HP）')]);
  }
  for (i = 0; i < (gr.abs || []).length; i++) {
    var a = gr.abs[i];
    out.push([a.t, 'v-abs', '吸収　転倒 ' + a.n + ' 体　ゲージ ' +
              Math.round(a.g / 100) + '%']);
  }
  for (i = 0; i < (gr.hits || []).length; i++) {
    out.push([gr.hits[i].t, 'v-gg', 'グロッキー　' + fmt(gr.hits[i].t) + '〜' + fmt(gr.hits[i].until) + ' 秒']);
  }
  var us = usesSorted().filter(function (u) { return u.no == null; });
  for (i = 0; i < us.length; i++) {
    var u = us[i], nm = (st.party[u.i] || {}).en || '?';
    out.push([u.t, 'v-ex', nm + '　' + u.k +
              (u.tg != null ? '　当たる数 ' + (u.mc || 1) + (u.hb ? '＋本体' : '') : '')]);
  }
  out.sort(function (x, y) { return x[0] - y[0]; });
  var h = '';
  for (i = 0; i < out.length; i++) {
    if (out[i][0] > dur + 1e-9) { continue; }
    h += '<div class="vr ' + out[i][1] + '"><b>' + fmt(out[i][0]) + '</b>' +
         esc(out[i][2]) + '</div>';
  }
  return h || '<p class="mut tiny">まだ何も置いていません</p>';
}

export function drawView() {
  if (!VIEW || !$('viewpane')) { return; }
  var r = diff();
  ggSolve(r);
  var dur = r.dur || 240;
  var t = VT == null ? 0 : Math.max(0, Math.min(dur, VT));
  var sc = sceneAt(r, t);
  var sh = pickShot(r);
  var nm = sh ? ((st.party[sh.i] || {}).en || '') : '';
  var q = null;
  if (sh) {
    var sid = (st.party[sh.i] || {}).id;
    if ((B.area[sid] || {})[sh.k]) {
      q = bestHitsOf(r, sid, sh.k, sc.sec, sc.wave || false,
                     sc.gg ? ['st:Groggy'] : null);
    }
  }
  var head = '<div class="vhd">' +
    '<b>' + fmt(t) + ' 秒</b>' +
    '<span class="mut tiny">フェーズ ' + (+sc.p + 1) + (sc.gg ? '　グロッキー' : '') + '</span>' +
    (sh ? '<span class="mut tiny">' + esc(nm) + '　' + esc(sh.k) + '　' + fmt(sh.t) + ' 秒</span>' : '') +
    (q ? '<span class="mut tiny">覆う ' + q.n + ' 体（部位 ' + q.nb + (q.hb ? '＋本体' : '') + '）</span>' : '') +
    '</div>';
  $('viewpane').querySelector('.bd').innerHTML =
    head + '<div class="vwrap"><div class="vbd">' + boardSvg(r, sc, sh) +
    '</div><div class="vlg">' + logRows(r) + '</div></div>';
}
