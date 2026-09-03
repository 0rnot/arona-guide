import { $, B, esc, img } from './util.js';
import { SLOTS, TE, live, st } from './core.js';
import { UNDO, mark } from './undo.js';
import { addUse, exCost } from './uses.js';
import { crewCount, diff } from './boss.js';
import { sim } from './engine.js';
import { draw } from './draw.js';
import { exKind } from './buff.js';
import { buffTo, tgtN, tgtOf } from './target.js';
import { altOf } from './alt.js';
import { drawUse } from './useedit.js';

// ------------------------------------------------------------ 「入力」の TL 表
// **行は `st.tl` そのもの**（2026-09-03 の先生の要望「入力で TL を行で組む」）。
// 帯を動かせば行が動き、行を直せば帯が動く。別の窓は作らず、タイムラインの下に
// 折りたたみで出す。「詳細」は帯クリックの窓と同じ中身をそのまま置く
export var ROWS = false;
export function rowsToggle() {
  ROWS = !ROWS;
  $('b-rows').setAttribute('aria-pressed', ROWS ? 'true' : 'false');
  $('rowpane').hidden = !ROWS;
  drawUse(); drawRows();
}
/** 行に出す時刻。コスト指定・最短は engine が解いた時刻（`_rt`） */
export function rowTime(u) {
  return (u.md === 't' || !u.md) ? u.t : (u._rt != null ? u._rt : u.t);
}
/** 表示の並び（時刻の順）。中身は `st.tl` の番号 */
export function rowOrder() {
  var o = [], i;
  for (i = 0; i < st.tl.length; i++) { o.push(i); }
  o.sort(function (a, b) { return rowTime(st.tl[a]) - rowTime(st.tl[b]) || a - b; });
  return o;
}
/** その 1 発が **敵への攻撃か、味方へのバフか、敵への妨害か**（2026-09-03 の
    先生の指摘「生徒の EX が敵への攻撃なのかバフなのかが理解できてない」）。
    判定はデータだけ。攻撃は `B.dmg[生徒][枠]`（無ければ候補 `altOf`）、
    バフ・デバフは `B.buf[生徒][枠]` の当たる先（`Enemy` が入っていれば敵向け）。
    **混ざっている EX は両方立てる** */
export function useKind(i, kd) {
  var p = st.party[i], o = { atk: false, buf: false, deb: false }, q, z;
  if (!p) { return o; }
  o.atk = !!(B.dmg[p.id] || {})[kd] || !!altOf(p.id, kd);
  var list = (B.buf[p.id] || {})[kd] || [];
  for (q = 0; q < list.length; q++) {
    var tg = list[q][0] || [];
    for (z = 0; z < tg.length; z++) {
      if (tg[z] === 'Enemy') { o.deb = true; } else { o.buf = true; }
    }
  }
  return o;
}
// **言葉を使わずに形と色で出す**（2026-09-03 の先生の指示「文字使わずにアイコンで」）。
// 攻撃＝右向きの刃（赤）／支援＝上向き（水色）／妨害＝下向き（紫）
export var KDSVG = {
  atk: '<svg viewBox="0 0 12 12"><path d="M1.6 1.1 10.6 6l-9 4.9Z"/></svg>',
  buf: '<svg viewBox="0 0 12 12"><path d="M6 .9 11 6.7H8.3V11H3.7V6.7H1Z"/></svg>',
  deb: '<svg viewBox="0 0 12 12"><path d="M6 11.1 1 5.3h2.7V1h4.6v4.3H11Z"/></svg>'
};
export function kindMark(i, kd) {
  var o = useKind(i, kd), h = '';
  if (o.atk) { h += '<i class="kd atk" title="敵への攻撃">' + KDSVG.atk + '</i>'; }
  if (o.buf) { h += '<i class="kd buf" title="味方へのバフ">' + KDSVG.buf + '</i>'; }
  if (o.deb) { h += '<i class="kd deb" title="敵へのデバフ">' + KDSVG.deb + '</i>'; }
  return '<span class="kds">' + (h || '<i class="kd non"></i>') + '</span>';
}
/** 生徒の欄。**編成の子から選ぶ。**編成外は下の「生徒を選ぶ」で探して編成に入れる
    （`st.tl` の 1 件は編成の枠を指しているので、編成外の子は置けない） */
export function rowWho(cur) {
  var h = '', k;
  for (k = 0; k < SLOTS; k++) {
    if (!live(k) || !st.party[k]) { continue; }
    h += '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' +
         esc(st.party[k].n) + '</option>';
  }
  return h + '<option value="find">編成外を探す…</option>';
}
/** 編成の子を並べた `<option>`。`skip` の枠だけ外す（自分に渡せないスキル） */
export function rowMem(cur, skip) {
  var h = '<option value="">—</option>', k;
  for (k = 0; k < SLOTS; k++) {
    if (!live(k) || !st.party[k] || k === skip) { continue; }
    h += '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' +
         esc(st.party[k].n) + '</option>';
  }
  return h;
}
/** **バフを渡す相手は行で決める**（2026-09-03 の先生の指摘。左の
    「バフを渡す相手」パネルと二重だったので、パネルのほうを消した）。
    1 発ごとの指定は `u.bto`。**書いていない行は枠の既定（`slots[].nsto`）を
    そのまま出す**ので、読み込んだ TL の「アタッカーが 1 人ならその子へ」（`bufTo`）は
    そのまま生きている。「味方1人」で誰も選んでいない行は赤い枠で示す（言葉は足さない） */
export function rowTo(u, kd) {
  var p = st.party[u.i];
  if (!p) { return ''; }
  var n = tgtN(p.id, kd);
  // **渡し先の枠は、要らない行でも幅だけ空けておく。**空けないと行ごとに
  // 右の摘みの位置がずれて押しにくい（2026-09-03）
  if (n < 1 || n >= crewCount()) { return '<span class="tos"></span>'; }
  var ex1 = (tgtOf(p.id, kd) || [])[1], cur = buffTo(u), h = '', q;
  for (q = 0; q < n; q++) {
    h += '<select class="rto' + (n === 1 && cur[q] == null ? ' need' : '') +
         '" data-tr="bto" data-slot="' + q + '" title="バフを渡す相手">' +
         rowMem(cur[q] == null ? null : cur[q], ex1 ? u.i : -1) + '</select>';
  }
  return '<span class="tos">' + h + '</span>';
}
// **撃つタイミングは 1 クリックで回す**（2026-09-03 の 35。プルダウンをやめた）。
// 時計＝秒で指定／菱形＝コストで指定／稲妻＝最短。**言葉は出さない**
export var MD3 = ['t', 'c', 'e'];
export var MDSVG = {
  t: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" ' +
     'stroke="currentColor" stroke-width="1.2"/><path d="M6 3.3V6.3L8.1 7.6" fill="none" ' +
     'stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  c: '<svg viewBox="0 0 12 12"><path d="M6 .9 11.1 6 6 11.1.9 6Z" fill="none" ' +
     'stroke="currentColor" stroke-width="1.3"/></svg>',
  e: '<svg viewBox="0 0 12 12"><path d="M7.1.8 2.4 6.9h2.6L4.9 11.2 9.6 5.1H7Z"/></svg>'
};
export var MDJA = { t: '秒で指定', c: 'コストで指定', e: '最短' };
/** 形態の印（2026-09-03 の 36）。**番号だけ。**自動で選ばれているときは薄く、
    手で決めたときは濃く出す。押すと 自動 → 1 → 2 …→ 自動 と回る */
export function rowForm(u, er) {
  var d = st.party[u.i], fl = d ? TE.forms(d) : [];
  if (!d || fl.length < 2) { return '<span class="fmz"></span>'; }
  var au = er ? er.auto : 0, cur = (u.f == null || u.f === '') ? au : +u.f;
  return '<button type="button" class="btn2 sq fm' + (u.f == null ? ' auto' : '') +
    '" data-tr="f1" title="形態 ' + esc((fl[cur] || {}).n || '') + '">' +
    (cur + 1) + '</button>';
}
/** **まとめて選んだ行**（2026-09-03 の 33。「5 発まとめて 2 秒ずらす」ができなかった）。
    Shift ＋番号で範囲、Ctrl／⌘ ＋番号で 1 行ずつ足し引き。
    2 行以上選んでいるときは、値を直すとその差ぶんが全部に乗り、
    ▲▼ と × も選んだぶん全部に効く。**言葉は足さず、番号の色で示す** */
export function selRows() {
  var m = (st.msel || []).filter(function (i) { return !!st.tl[i]; });
  if (m.length > 1) { return m; }
  return st.sel != null && st.tl[st.sel] ? [st.sel] : [];
}
export function selPick(ix, shift, add) {
  var ord = rowOrder(), i;
  if (shift && st.sel != null) {
    var a = ord.indexOf(st.sel), b = ord.indexOf(ix), lo = Math.min(a, b), hi = Math.max(a, b);
    st.msel = [];
    if (a >= 0 && b >= 0) { for (i = lo; i <= hi; i++) { st.msel.push(ord[i]); } }
    return;
  }
  if (add) {
    var at = (st.msel || []).indexOf(ix);
    if (!st.msel.length && st.sel != null && st.sel !== ix) { st.msel = [st.sel]; }
    if (at >= 0) { st.msel.splice(at, 1); } else { st.msel.push(ix); }
    st.sel = ix;
    return;
  }
  st.msel = []; st.sel = ix;
}
export function drawRows() {
  if (!ROWS) { return; }
  var h = '', sm = sim(), ord = rowOrder(), i, z, rowOf = {};
  for (z = 0; z < sm.rows.length; z++) {
    if (sm.rows[z].e && sm.rows[z].e._ix != null) { rowOf[sm.rows[z].e._ix] = sm.rows[z]; }
  }
  for (i = 0; i < ord.length; i++) {
    var ix = ord[i], u = st.tl[ix], md = u.md || 't', on = st.sel === ix;
    var p = st.party[u.i], er = rowOf[ix] || null, kd = exKind(er ? er.fi : 0);
    var ms = (st.msel || []).indexOf(ix) >= 0;
    h += '<div class="trow' + (on ? ' on' : '') + (ms ? ' msel' : '') + (er && er.why ? ' bad' : '') +
      '" data-ix="' + ix + '">' +
      '<span class="ix" draggable="true">' + (i + 1) + '</span>' +
      kindMark(u.i, kd) +
      (p ? img(p.id, 'ic') : '') +
      '<select data-tr="who">' + rowWho(u.i) + '</select>' +
      '<button type="button" class="btn2 sq md1" data-tr="md1" data-md="' + md +
      '" title="' + MDJA[md] + '">' + MDSVG[md] + '</button>' +
      (md === 'e' ? '<span class="rv"></span>'
        : '<input class="rv" type="number" data-tr="v" min="0" step="' +
          (md === 'c' ? '0.5' : '0.1') + '" value="' +
          (md === 'c' ? (u.cv == null ? 10 : u.cv) : (+u.t).toFixed(2)) + '">') +
      '<span class="rt" title="実際に出る時刻">' +
      (md === 't' ? '' : (u._rt == null ? '—' : rowTime(u).toFixed(2))) + '</span>' +
      rowForm(u, er) +
      rowTo(u, kd) +
      '<span class="sp"></span>' +
      '<button type="button" class="btn2 sq" data-tr="up" title="1 つ前と入れ替える">▲</button>' +
      '<button type="button" class="btn2 sq" data-tr="dn" title="1 つ後ろと入れ替える">▼</button>' +
      '<button type="button" class="btn2 sq det" data-tr="det" aria-expanded="' +
      (on ? 'true' : 'false') + '" title="詳しく決める"><span class="cv"></span></button>' +
      '<button type="button" class="btn2 sq del" data-tr="del" ' +
      'title="この 1 発を消す（Ctrl+Z で戻せます）">\u00d7</button>' +
      '</div>' +
      (on ? '<div class="fields wrapf tdet" id="trdet"></div>' : '');
  }
  // **消したものを戻す導線を行のそばに置く**（2026-09-03 の 38。
  // Ctrl+Z を知っている人しか戻せなかった）
  h += '<div class="trow add"><span class="ix"></span>' +
    '<button type="button" class="btn2 sq" data-tr="add" title="末尾に 1 発足す">\uff0b</button>' +
    '<span style="flex:1 1 auto"></span>' +
    '<button type="button" class="btn2 sq" data-act="undo" title="元に戻す"' +
    (UNDO.length ? '' : ' disabled') + '>\u21b6</button></div>';
  $('rowlist').innerHTML = h;
  // 「詳細」は帯クリックの窓と同じ中身。**組み直さずにそのまま写す**
  if ($('trdet')) { $('trdet').innerHTML = $('useedit').innerHTML; }
}
/** 末尾の「＋」。**必ずいちばん後ろの時刻より後ろへ足して、その行の詳細を開く**
    （2026-09-03 の先生の指摘「+押しても詳細開いてるところの下に追加される」
    「+押したあと+した側の詳細押さないと詳細開かない」）。
    コスト指定の行の後ろなら、同じくコスト指定で足す */
export function rowAdd() {
  var dur = diff().dur || 240, ord = rowOrder(), i, lt = 0;
  for (i = 0; i < ord.length; i++) { lt = Math.max(lt, rowTime(st.tl[ord[i]])); }
  var last = ord.length ? st.tl[ord[ord.length - 1]] : null, who = last ? last.i : -1;
  if (who < 0 || !st.party[who] || !live(who)) {
    who = -1;
    for (i = 0; i < SLOTS; i++) { if (live(i) && st.party[i]) { who = i; break; } }
  }
  if (who < 0) { return; }
  if (last && last.md === 'c') {
    mark();
    st.tl.push({ i: who, t: lt, to: null, ov: null, f: null, bt: null, md: 'c',
                 // 既定は「この子の EX が撃てる最小のコスト」
                 cv: Math.ceil(exCost(st.party[who]) * 2) / 2 });
    st.sel = st.tl.length - 1;
    draw(); rowShow(); return;
  }
  addUse(who, Math.min(dur, lt + st.grid / B.fps));
  rowShow();
}
/** 足した行・入れ替えた行を画面に出す。**詳細ごと見えるところまで送る** */
export function rowShow() {
  var el = $('rowlist').querySelector('.trow.on');
  if (el && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); }
  var dt = $('trdet');
  if (dt && dt.scrollIntoView) { dt.scrollIntoView({ block: 'nearest' }); }
}
/** 行の入れ替え（2026-09-03 の先生の要望「スキルの入れ替えも入力欄で出来ない」）。
    **時刻はその場に残して、「いつ撃つか」の指定（`md` / `t` / `cv`）だけを隣と交換する。**
    表は時刻の順に並ぶので、左の数字はそのままで生徒だけが入れ替わって見える。
    コスト指定の行と秒指定の行が混ざっていても、指定そのものを交換するので破綻しない */
export function rowSwap(ix, dir) {
  var ord = rowOrder(), at = ord.indexOf(ix);
  if (at < 0) { return; }
  rowMove(ix, at + dir);
}
/** **行を掴んで好きな位置へ運ぶ**（2026-09-03 の 30。▲▼ は隣とだけで、
    5 行上へ運ぶのに 5 回押していた）。入れ替えるのは `rowSwap` と同じく
    「いつ撃つか」の指定だけ。表示の並びは時刻の順のままなので、
    運んだ行の生徒だけが目当ての位置へ移って見える */
export function rowMove(ix, to) {
  var ord = rowOrder(), at = ord.indexOf(ix), K = ['md', 't', 'cv', '_rt'], i, k;
  if (at < 0 || to < 0 || to >= ord.length || to === at) { return; }
  mark();
  var tm = [];
  for (i = 0; i < ord.length; i++) {
    var o = {}, u0 = st.tl[ord[i]];
    for (k = 0; k < K.length; k++) { o[K[k]] = u0[K[k]]; }
    tm.push(o);
  }
  var seq = ord.slice();
  seq.splice(at, 1);
  seq.splice(to, 0, ix);
  for (i = 0; i < seq.length; i++) {
    var u1 = st.tl[seq[i]];
    for (k = 0; k < K.length; k++) { u1[K[k]] = tm[i][K[k]]; }
  }
  st.sel = ix;
  draw(); rowShow();
}
/** 選んだ 1 発の時刻へタイムラインを送る（2026-09-03 の 37。
    行を選んでも帯が画面の外にいると、どれを直しているのか分からなかった） */
export function rowSeek(ix) {
  var u = st.tl[ix], v = $('view');
  if (!u || !v || !st.px) { return; }
  var x = rowTime(u) * st.px - v.clientWidth / 2;
  v.scrollLeft = Math.max(0, x);
}
