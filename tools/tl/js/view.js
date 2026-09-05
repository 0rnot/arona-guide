import { $, B, esc } from './util.js';
import { memo, st } from './core.js';
import { diff } from './boss.js';
import { bossAdv, ggMode, phaseSpans, ggRuns, ggSolve } from './carry.js';
import { usesSorted } from './buff.js';
import { hitTimes } from './dmg.js';
import { aimFromHits, beaconOf, bestHitsOf, boardBox, bodiesOf, hitsAtOf, hitsOf,
         movedBodies, placeKind, secOfSummon, shapeAt } from './board.js';

// ------------------------------------------------------------ 盤と経過（第 5 段）
// **画面に文章を足さずに、盤とボスの動きを目で見られるようにする**（2026-09-04）。
// 開くまで何も描かないので、**閉じているあいだはページの高さが変わらない。**
//
// 「入力」の左に盤の絵と経過、右に行の表（2026-09-04 の先生の指示
// 「入力ボタンで一緒に盤も出るようにしちゃって盤ボタン消していいよ」）。
// **形は `board.js` の `shapeAt` から取る**——`coverOf` が数えるのと同じ形なので、
// 「絵では覆っているのに数に入らない」がありえない。

export var VIEW = false;
/** 盤は「入力」といっしょに出る。札は 1 つだけ（`b-rows`）。 */
export function viewSet(on) { VIEW = !!on; drawView(); }
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

/** **ゲーム内と同じ書き方の残り時間**（`02:21.733`）。
    2026-09-04 の先生の指示「盤の上の情報は残り時間だけでいいや、ゲーム内の上の
    時間と同じ書き方で」。動画のコマ（`vid/MYqGzhY5Jmc.mp4` の 100 秒）で
    `MM:SS.mmm` と確かめた。 */
function clock(sec) {
  var v = Math.max(0, sec), m = Math.floor(v / 60), r = v - m * 60;
  var ss = Math.floor(r), ms = Math.round((r - ss) * 1000);
  if (ms >= 1000) { ms -= 1000; ss += 1; }
  if (ss >= 60) { ss -= 60; m += 1; }
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss +
         '.' + ('00' + ms).slice(-3);
}

/** その 1 発の範囲を盤に残す長さ（秒）。**最後の着弾まで出す**
    （2026-09-04 の先生の指示「盤のスキル表示が攻撃スキルを発動したタイミングでしか
    表示されないから、最終着弾までは表示させるようにして」）。
    着弾のデータが無い枠は 0.6 秒だけ出す。 */
var HOLD = 0.6;
function holdOf(r, u) {
  var p = st.party[u.i];
  if (!p) { return HOLD; }
  var ht = hitTimes(p.id, u.k, dsOf(r, u)) || [];
  return Math.max(HOLD, (ht.length ? ht[ht.length - 1] : 0) + 0.1);
}

/** **再生の状態**（2026-09-04 の先生の「再生停止と等倍から3倍切り替えも
    実装できちゃう？」）。**進めるのは `wire-view.js`**——`movePh` は `ord.js` に
    あって、そちらが `view.js` を取り込んでいるので、ここから呼ぶと輪になる。 */
export var PLAY = false, RATE = 1;
export function playSet(on) { PLAY = !!on; }
export function rateSet(v) { RATE = v; }

/** **その時刻の場面。**`{p, gg, wave, sec}`。

      p     … そのときのフェーズ（`phaseSpans`）
      gg    … グロッキー中か（`ggRuns().hits`）
      wave  … 盤に居る召喚の波（最後に撃たれた召喚の EX。吸収の EX で消える）
      sec   … 節（`secOfSummon`。ペロロジラはフェーズごとに前へ移動する）

    **吸収の EX が来たら盤の体は消える**——`Ex09` が 20.0 ワールドの中を
    全部吸ってから、グロッキーの小さなペロロが湧く。 */
export function sceneAt(r, t, lite) {
  // **`lite` は曲線を引かない場面**（`dsOf` 用）。HP の段は入口のまま、ダメージで
  // 貯まるグロッキーは見ない（`ggRuns` が曲線を引くため）。吸収で貯まる
  // ペロロジラは `ggAbsorbRuns` が曲線を引かないので、そのまま見る
  var sp = phaseSpans(r, lite), i, k;
  var gr = (lite && ggMode(r).kind === 'ダメージ') ? { hits: [] } : ggRuns(r);
  var cur = sp[sp.length - 1];
  for (i = 0; i < sp.length; i++) {
    if (t >= sp[i].t0 - 1e-9 && t < sp[i].t1) { cur = sp[i]; break; }
  }
  var gg = false;
  for (i = 0; i < (gr.hits || []).length; i++) {
    if (t >= gr.hits[i].t - 1e-9 && t < gr.hits[i].until) { gg = true; }
  }
  var pd = (r.ph || {})[cur.p] || {}, ev = pd.ev || [], smn = (r.board || {}).smn || {};
  var gi = r.gga ? r.gga.exi : null, wave = null, first = null, w0 = null;
  for (i = 0; i < ev.length; i++) {
    if (ev[i][1] == null) { continue; }
    for (k = 0; k < (ev[i][2] || []).length; k++) {
      var nm = r.ex[ev[i][2][k]];
      if (first == null && ev[i][2][k] !== gi && nm && smn[nm]) { first = nm; }
    }
    if (bossAdv(cur.t0, ev[i][1]) > t + 1e-9) { continue; }
    for (k = 0; k < (ev[i][2] || []).length; k++) {
      var g = ev[i][2][k], nm2 = r.ex[g];
      // `w0` はその波が湧いた時刻。**同じ EX で湧き直したら別の波**（2026-09-05）
      if (g === gi) { wave = null; w0 = null; }
      else if (nm2 && smn[nm2]) { wave = nm2; w0 = bossAdv(cur.t0, ev[i][1]); }
    }
  }
  var sec = secOfSummon(r, wave || first);
  return { p: cur.p, gg: gg, wave: wave, sec: sec == null ? 0 : sec, w0: w0 };
}

/** **絵にする 1 発。赤い線がその発の上に居るときだけ。**

    以前は「選んでいる行」か「当たる先を決めてある最初の発」を出しっぱなしにして
    いたので、赤い線を動かしても範囲が残り続けた（2026-09-04 の先生の指摘
    「詳細で攻撃スキルを配置した状態でタイムラインの赤線を移動させても
      詳細を開いた時のEXの範囲が残り続ける」）。
    **「入力」の詳細を押すと赤い線がその発へ飛ぶ**（`rows.js` の `rowSeek`）ので、
    そちらから開けば今までどおりその発の盤が出る。 */
export function pickShot(r, t) {
  var us = usesSorted().filter(function (u) { return u.no == null; }), i, best = null;
  var at = t == null ? (VT == null ? 0 : VT) : t;
  var sel = st.sel != null ? st.tl[st.sel] : null;
  for (i = 0; i < us.length; i++) {
    if (at < us[i].t - 1e-9 || at >= us[i].t + holdOf(r, us[i])) { continue; }
    if (!best || us[i].t > best.t - 1e-9) { best = us[i]; }
    // 同じ時刻に何発もあるときは、詳細を開いている発を優先する
    if (sel && us[i].ix === st.sel) { best = us[i]; break; }
  }
  return best;
}

/** **その時刻で効いている「動かした体の位置」。**
    同じ波のうち、その時刻までに置いたいちばん新しいものを使う。
    波が変われば湧き直すので持ち越さない。 */
export function bpAt(r, t, sc) {
  var us = usesSorted().filter(function (u) { return u.no == null; }), i, out = null;
  for (i = 0; i < us.length; i++) {
    if (us[i].t > t + 1e-9) { break; }
    var pd = placedOf(us[i]);
    if (!pd.bp) { continue; }
    var s2 = sceneAt(r, us[i].t);
    if (s2.sec !== sc.sec || s2.wave !== sc.wave) { continue; }
    out = pd.bp;
  }
  return out;
}

/** 盤の絵。`q` は当たり（`hitsAtOf` / `bestHitsOf`）、`bs` はその盤の体。

    **動かせる体には `data-k`（`bodiesOf` の札）を付ける。**`_Move` の付いた体だけで、
    どこへ動くかはデータに無いので人が置く（2026-09-04 の先生の
    「移動する個体はドラックで動かせるようにすればいいかな？」）。
    狙う点の摘みは `data-h="aim"`。 */
function boardSvg(r, sec, sh, q, bs, pk) {
  var bc = beaconOf(r, sec), i;
  if (!bs.length) { return '<p class="mut tiny">この相手には盤のデータがありません</p>'; }
  var sid = sh ? (st.party[sh.i] || {}).id : null;
  var kd = sh ? sh.k : null;
  var geo = q ? shapeAt((B.area[sid] || {})[kd], q.c,
                        { x: q.c.x - q.me.x, y: q.c.y - q.me.y },
                        (B.geo[sid] || {})[kd]) : null;
  // **枠はその節に出てくる体で決め打ち**（`boardBox`）。時刻でも、狙う点でも、
  // 範囲の形でも変わらない。当たり判定の外へ引いても盤は広がらない
  var bx = boardBox(r, sec);
  if (!bx) { return '<p class="mut tiny">この相手には盤のデータがありません</p>'; }
  var x0 = bx.x0, x1 = bx.x1, y0 = bx.y0, y1 = bx.y1;
  var hitK = {};
  if (q) { for (i = 0; i < q.hit.length; i++) { hitK[q.hit[i].key] = 1; } }
  // **画面の上が奥。**`Stage` の y は奥ほど大きいので、そのまま描くと上下が逆になる
  var g = '<g transform="translate(0,' + (y0 + y1) + ') scale(1,-1)" id="bgrp">';
  if (geo) { g += shapePath(geo); }
  // **狙う点の摘みは体より先に描く。**絵は下に沈むが、**掴むときは体が勝つ**——
  // いちばん多く巻き込める置き方は体の真上に来ることが多く、摘みを後に描くと
  // その体を掴めなくなる（2026-09-04 に実測。ペロロミニオンが 1 体隠れた）。
  // 摘みの輪（1.4）は体（0.5）より大きいので、外側を掴めばこちらも動かせる
  if (q && pk) {
    var a = q.aim || q.c, ax = a.x, ay = a.y;
    g += '<g class="aim" data-h="aim"><circle cx="' + ax.toFixed(2) + '" cy="' + ay.toFixed(2) +
         '" r="1.4" class="ahit"/><circle cx="' + ax.toFixed(2) + '" cy="' + ay.toFixed(2) +
         '" r="0.95" class="ac"/><path d="M' + (ax - 1.9).toFixed(2) + ' ' + ay.toFixed(2) +
         'h3.8M' + ax.toFixed(2) + ' ' + (ay - 1.9).toFixed(2) + 'v3.8" class="ax"/>' +
         '<title>' + (pk === 'aim' ? '狙う体（向きが決まります）' : '範囲の中心') +
         '\nドラッグで動かせます</title></g>';
  }
  for (i = 0; i < bs.length; i++) {
    var p = bs[i];
    g += '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' +
         p.br.toFixed(2) + '" class="bd' + (p.cid === r.cid ? ' boss' : '') +
         (hitK[p.key] ? ' on' : '') + (p.mv ? ' mv' : '') +
         (p.put ? ' put' : '') + '"' +
         (p.mv ? ' data-k="' + esc(p.key) + '"' : '') + '><title>' + esc(p.n) +
         (p.sum ? '（' + p.sum + ' の召喚）' : '') +
         (p.mv ? '\nドラッグで動かせます' : '') + '\n半径 ' + p.br.toFixed(2) +
         '\n' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + '</title></circle>';
  }
  if (bc) { g += '<circle cx="' + bc.x + '" cy="' + bc.y + '" r="0.8" class="bcn"><title>生徒の立ち位置（ビーコン）</title></circle>'; }
  if (q && q.me) {
    g += '<circle cx="' + q.me.x.toFixed(2) + '" cy="' + q.me.y.toFixed(2) +
         '" r="0.8" class="me"><title>撃つ子の立ち位置</title></circle>';
  }
  g += '</g>';
  // **枠の縦横比のとおりに箱を出す**（2026-09-04 の先生の指摘「盤がパネルに
  // フィットしない」）。`preserveAspectRatio` に任せると、横長の入れ物に
  // 縦長の盤（ペロロジラは 18.0 × 26.51）を入れたときに左右が大きく余る。
  // 高さを決めて幅をそこから出し、左の列はその幅に合わせて縮む（`.vleft`）
  var ar = (x1 - x0) / (y1 - y0), BH = 380, BW = BH * ar;
  if (BW > 520) { BW = 520; BH = BW / ar; }
  if (BW < 150) { BW = 150; BH = BW / ar; }
  return '<svg class="bsvg" id="bsvg" style="width:' + Math.round(BW) + 'px;height:' +
         Math.round(BH) + 'px" viewBox="' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' ' +
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

/** **盤で置いたもの。**`usesSorted` の写しではなく `st.tl` の正本から読む
    （ドラッグの最中は写しが古いことがある）。 */
export function placedOf(u) {
  var raw = (u && u.ix != null) ? st.tl[u.ix] : null;
  if (raw) { return { ax: raw.ax, ay: raw.ay, bp: raw.bp || null }; }
  return { ax: u && u.ax, ay: u && u.ay, bp: (u && u.bp) || null };
}

/** **その 1 発の当たり。**人が置いていればその位置で、置いていなければ
    「いちばん多く巻き込める置き方」（`bestHitsOf`）。 */
export function coverOfUse(r, u, sc, bp) {
  if (!u || !st.party[u.i]) { return null; }
  var sid = st.party[u.i].id, kd = u.k;
  var sh = (B.area[sid] || {})[kd], gm = (B.geo[sid] || {})[kd];
  if (!sh || !gm) { return null; }
  var pd = placedOf(u);
  var bpe = bp === undefined ? pd.bp : bp;
  var ex = sc.wave || false, on = sc.gg ? ['st:Groggy'] : null;
  if (pd.ax != null && pd.ay != null) {
    return hitsAtOf(r, sid, kd, sc.sec, ex, on, { x: pd.ax, y: pd.ay }, bpe);
  }
  var q = bestHitsOf(r, sid, kd, sc.sec, ex, on) || hitsOf(r, sid, kd, sc.sec, ex, on);
  if (q && bpe) {
    // 体を動かしてあれば、置き方はそのままで数え直す
    var q2 = hitsAtOf(r, sid, kd, sc.sec, ex, on, q.aim || q.c, bpe);
    if (q2) { return q2; }
  }
  return q;
}

/** **その 1 発の弾が飛ぶ距離**（ワールド）。`{c, e}`——`c` は撃つ子の立ち位置
    （`standOf`）から置いた中心まで、`e` は選んだ体（中心にいちばん近い体）の縁まで。
    盤が無い・形が無い枠は null（`dmg.js` の `travelOf` が届く距離で代える）。
    `hitTimes` / `dmgOf` に渡して、弾に乗る着弾の時刻をずらす（2026-09-05）。
    `memo` の鍵に置き方（`ax`/`ay`/`bp`）と窓（`st.bst`）を入れる——場面が変わると
    体の並びが変わる */
var DS_BUSY = false;
export function dsOf(r, u) {
  if (!r || !u || u.i == null || !st.party[u.i]) { return null; }
  // **輪の保険。**場面 → 曲線 → 着弾 → ここ、と戻ってきたら null（覚えない）。
  // 2026-09-05、ゲブラで `sceneAt → phaseSpans → dmgCurve → dsOf → sceneAt` が
  // 無限に回った（`RangeError: Maximum call stack size exceeded`）。本筋は
  // `sceneAt(r, t, true)` で曲線を引かないこと。これはそれでも戻ってきたときの止め
  if (DS_BUSY) { return null; }
  var p = st.party[u.i], pd = placedOf(u);
  var key = ['ds', r.cid, p.id, u.k, u.t, u.tg, u.mc, pd.ax, pd.ay,
             pd.bp ? JSON.stringify(pd.bp) : '', JSON.stringify(st.bst || null)].join('|');
  return memo(key, function () {
    DS_BUSY = true;
    try { return dsOf0(r, u); } finally { DS_BUSY = false; }
  });
}
function dsOf0(r, u) {
  var sc = sceneAt(r, u.t, true), q = coverOfUse(r, u, sc);
  if (!q || !q.me || !q.c) { return null; }
  var c = Math.hypot(q.c.x - q.me.x, q.c.y - q.me.y), e = c;
  var bs = (q.hit && q.hit.length) ? q.hit : q.bs, best = null, bd = 0, i, dd;
  for (i = 0; i < (bs || []).length; i++) {
    dd = Math.hypot(bs[i].x - q.c.x, bs[i].y - q.c.y);
    if (best == null || dd < bd) { best = bs[i]; bd = dd; }
  }
  if (best) { e = Math.max(0, Math.hypot(best.x - q.me.x, best.y - q.me.y) - (best.br || 0)); }
  return { c: c, e: e };
}

/** **盤が決められる 1 発は、当たる先・当たる数・本体にも当たるかを盤から書く。**

    2026-09-04 の先生の指示「盤で決めるなら入力欄の当たる先当たる数
    ボス本体に当たるかどうかは入力させなくていいかな」。入力欄はこの 3 つが
    決まる発では出さず（`useedit.js`）、代わりにここが `st.tl` へ書き戻す。
    盤のデータが無い相手・範囲の形が無い枠はそのまま人の入力を使う。

    **同じ入力なら数え直さない**（`_ak` に鍵を残す）。`draw()` は操作のたびに
    走るので、毎回 `bestHitsOf` を回すと重い。 */
export function syncAim(r) {
  if (!r || !r.board) { return; }
  var us = usesSorted(), i, u, raw, sid, sc, q, a, key;
  for (i = 0; i < us.length; i++) {
    u = us[i];
    if (u.no != null || u.ix == null) { continue; }
    raw = st.tl[u.ix];
    if (!raw || !st.party[u.i]) { continue; }
    sid = st.party[u.i].id;
    // **盤で置いた発だけ。**置いていない発まで盤から決めると、TL の文章で
    // 指定した当たる先を上書きしてしまう（2026-09-04 に実測。
    // y4h8XEXXfgw が 幅の中 90% → 9% まで落ちた。盤の湧き点は動く個体の
    // 実際の位置ではないので、覆う数を少なく見積もる）。
    // **置いていない発は今までどおり入力欄で決める。**
    if (raw.ax == null && raw.ay == null && !raw.bp) { delete raw._ak; continue; }
    // **摘みが出るか（`placeKind`）では絞らない。**位置を選べない枠でも
    // 形と射程は決まっているので、当たりは盤から出せる
    if (!(B.area[sid] || {})[u.k] || !(B.geo[sid] || {})[u.k]) { delete raw._ak; continue; }
    sc = sceneAt(r, u.t);
    key = [r.cid, sid, u.k, sc.sec, sc.wave, sc.gg ? 1 : 0,
           raw.ax, raw.ay, raw.bp ? JSON.stringify(raw.bp) : ''].join('|');
    if (raw._ak === key) { continue; }
    q = coverOfUse(r, { i: u.i, k: u.k, ax: raw.ax, ay: raw.ay, bp: raw.bp }, sc);
    a = aimFromHits(r, q);
    if (!a) { delete raw._ak; continue; }
    raw._ak = key; raw.tg = a.tg; raw.mc = a.mc; raw.hb = a.hb;
  }
}

/** その 1 発を盤が決めたか（＝「当たる先・当たる数・本体にも」の入力欄を
    出さなくていいか）。**`syncAim` が書いた印を見るだけ。** */
export function aimByBoard(u) { return !!(u && u._ak); }

export function drawView() {
  var bd = $('viewbd');
  if (!VIEW || !bd) { return; }
  var r = diff();
  ggSolve(r);
  var dur = r.dur || 240;
  var t = VT == null ? 0 : Math.max(0, Math.min(dur, VT));
  var sc = sceneAt(r, t);
  var sh = pickShot(r, t);
  var sid = sh ? (st.party[sh.i] || {}).id : null;
  var gm = sid != null ? (B.geo[sid] || {})[sh.k] : null;
  var pk = placeKind(gm);
  var bp = bpAt(r, t, sc);
  var q = sh ? coverOfUse(r, sh, sc, bp) : null;
  var pd = placedOf(sh);
  var bs = q ? q.bs : movedBodies(bodiesOf(r, sc.sec, sc.wave || false,
                                           sc.gg ? ['st:Groggy'] : null), bp);
  var put = sh && (pd.ax != null || pd.bp);
  // **見出しは作り直さない。**再生中は 1 秒に何十回も描き直すので、毎回
  // `innerHTML` で入れ替えると押している最中にボタンが消えて
  // **click が発火しない**（2026-09-04 に実測。止められなくなる）。
  // 中身だけ書き換える
  var hd = bd.querySelector('.vhd'), bx = bd.querySelector('.vbx');
  if (!hd || !bx) {
    bd.innerHTML =
      '<div class="vhd">' +
      '<button type="button" class="btn2 sq vpl" data-h="play" title="再生／停止"></button>' +
      '<button type="button" class="btn2 sq vrt" data-h="rate" title="速さ"></button>' +
      '<button type="button" class="btn2 sq vrs" data-h="reset" title="盤で置いたものを消して、いちばん多く巻き込める置き方に戻す">戻す</button>' +
      '<b class="vclk"></b></div><div class="vbx"></div>';
    hd = bd.querySelector('.vhd'); bx = bd.querySelector('.vbx');
  }
  hd.querySelector('.vpl').textContent = PLAY ? '\u23f8' : '\u25b6';
  hd.querySelector('.vrt').textContent = '\u00d7' + RATE;
  hd.querySelector('.vrs').hidden = !put;
  hd.querySelector('.vclk').textContent = clock(dur - t);
  bx.innerHTML = boardSvg(r, sc.sec, sh, q, bs, pk);
}
