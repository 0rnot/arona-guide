import { $, B, esc, img } from './util.js';
import { SLOTS, live, st } from './core.js';
import { mark } from './undo.js';
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
export function drawRows() {
  if (!ROWS) { return; }
  var h = '', ord = rowOrder(), i, z, sm = sim(), rowOf = {};
  for (z = 0; z < sm.rows.length; z++) {
    if (sm.rows[z].e && sm.rows[z].e._ix != null) { rowOf[sm.rows[z].e._ix] = sm.rows[z]; }
  }
  for (i = 0; i < ord.length; i++) {
    var ix = ord[i], u = st.tl[ix], md = u.md || 't', on = st.sel === ix;
    var p = st.party[u.i], er = rowOf[ix] || null, kd = exKind(er ? er.fi : 0);
    h += '<div class="trow' + (on ? ' on' : '') + (er && er.why ? ' bad' : '') +
      '" data-ix="' + ix + '">' +
      '<span class="ix">' + (i + 1) + '</span>' +
      kindMark(u.i, kd) +
      (p ? img(p.id, 'ic') : '') +
      '<select data-tr="who">' + rowWho(u.i) + '</select>' +
      '<select data-tr="md">' +
      '<option value="t"' + (md === 't' ? ' selected' : '') + '>時間</option>' +
      '<option value="c"' + (md === 'c' ? ' selected' : '') + '>コスト</option>' +
      '<option value="e"' + (md === 'e' ? ' selected' : '') + '>最短</option></select>' +
      (md === 'e' ? '<span class="rv"></span>'
        : '<input class="rv" type="number" data-tr="v" min="0" step="' +
          (md === 'c' ? '0.5' : '0.1') + '" value="' +
          (md === 'c' ? (u.cv == null ? 10 : u.cv) : (+u.t).toFixed(2)) + '">') +
      '<span class="rt" title="実際に出る時刻">' +
      (md === 't' ? '' : (u._rt == null ? '—' : rowTime(u).toFixed(2))) + '</span>' +
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
  h += '<div class="trow add"><span class="ix"></span>' +
    '<button type="button" class="btn2 sq" data-tr="add" title="末尾に 1 発足す">\uff0b</button></div>';
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
  var ord = rowOrder(), at = ord.indexOf(ix), to = at + dir, k;
  if (at < 0 || to < 0 || to >= ord.length) { return; }
  mark();
  var a = st.tl[ix], b = st.tl[ord[to]], K = ['md', 't', 'cv', '_rt'], tmp;
  for (k = 0; k < K.length; k++) { tmp = a[K[k]]; a[K[k]] = b[K[k]]; b[K[k]] = tmp; }
  st.sel = ix;
  draw(); rowShow();
}
