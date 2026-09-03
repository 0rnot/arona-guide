import { $, B, esc, img, rest } from './util.js';
import { SLOTS, _pv, live, st } from './core.js';
import { exCost, exDur } from './uses.js';
import { diff } from './boss.js';
import { sim } from './engine.js';
import { costPts } from './chart.js';

// ------------------------------------------------------------ 再生ヘッド
export function costAt(t) {
  var pts = costPts(diff().dur || 240);
  for (var i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      var a = pts[i - 1], b = pts[i], k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return pts[pts.length - 1][1];
}
export function movePh(t) {
  var r = diff(), dur = r.dur || 240;
  t = Math.max(0, Math.min(dur, t));
  PH_T = t;
  drawOrd(t);
  var e = $('ph'), box = $('phbox');
  if (!e) { return; }
  e.style.left = (t * st.px) + 'px';
  e.className = 'ph' + (st.pin != null ? ' pin' : '');
  var c = costAt(t);
  box.hidden = false;
  box.innerHTML = '残り時間: ' + rest(dur, t) + '<br>コスト: <span class="' +
    (c < 0 ? 'neg' : '') + '">' + c.toFixed(2) + '</span>';
  var w = 96, x = t * st.px + 6;
  if (x + w > dur * st.px) { x = t * st.px - w - 6; }
  box.style.left = Math.max(0, x) + 'px';
}

// ------------------------------------------------------------ スキル順（概況の帯）
/** カーソル（タイムラインの赤いバー）が指している秒。**まだ動かしていなければ null** */
export var PH_T = null, _ordK = '';
// **画面で選べるカードは 3 枚**（2026-09-03 の先生の言葉「ゲーム画面で選べる
// スキルは３つだからその３つプラス裏で控えてる３人の順番って感じ」）。
// engine 側の `HAND` と同じ枚数
export var HAND_N = 3;
/** 置いた EX を時刻の順に。`kept` は「撃っても手札に残る」（すぐにドロー） */
export function ordList() {
  var sm = sim(), ro = {}, out = [], i;
  for (i = 0; i < sm.rows.length; i++) {
    if (sm.rows[i].e && sm.rows[i].e._ix != null) { ro[sm.rows[i].e._ix] = sm.rows[i]; }
  }
  for (i = 0; i < st.tl.length; i++) {
    var u = st.tl[i], er = ro[i] || null;
    out.push({ ix: i, i: u.i, er: er, kept: !!(er && er.kept),
               at: (er && er.at != null) ? er.at : (u._rt != null ? u._rt : u.t) });
  }
  out.sort(function (a, b) { return a.at - b.at || a.ix - b.ix; });
  return out;
}
/** 山札の初めの並び。**起点は開始スキルの指定**（`st.start`）。指定の無いところは
    TL に出てくる順、それでも余る枠は編成の順で埋める（engine の `deckOrder` と
    同じ考え方） */
export function deck0(list) {
  var q = [], seen = {}, i;
  function put(k) {
    if (k == null || seen[k] || !live(k) || !st.party[k]) { return; }
    seen[k] = 1; q.push(k);
  }
  for (i = 0; i < st.start.length; i++) { put(st.start[i]); }
  for (i = 0; i < list.length; i++) { put(list[i].i); }
  for (i = 0; i < SLOTS; i++) { put(i); }
  return q;
}
/** その秒の並び。**1 枚使うとその子は山札のいちばん下へ回り、次の子が手札に入る。**
    engine の `playHand` と同じ回り方で、`kept`（すぐにドロー）の 1 発は回さない。
    **置いた EX の時刻順ではなく、この回り方で決まる順番**（2026-09-03 の先生の
    言葉「タイムライン基準ってよりは Auto の時の順番ってイメージ」） */
export function ordAt(list, t) {
  var q = deck0(list), i, k;
  for (i = 0; i < list.length; i++) {
    if (list[i].at > t + 1e-9) { break; }
    if (list[i].kept) { continue; }
    k = q.indexOf(list[i].i);
    if (k >= 0) { q.splice(k, 1); q.push(list[i].i); }
  }
  return q;
}
/** 概況の帯の「スキル順」（2026-09-03 の先生の要望）。
    マスは生徒のアイコンだけで、**先頭 `HAND_N` 枚がいま選べるカード**、
    残りが控え。見分けは明るさと枠と区切りで、言葉は置かない。
    カーソルが 1 発の演出の中にいれば、その札（名前・コスト・秒）を右に出す */
export function drawOrd(t) {
  var box = $('kord');
  if (!box) { return; }
  var list = ordList(), i;
  // カーソルが乗っている 1 発（演出の中にいるもの）。無ければ null
  var on = null;
  for (i = 0; i < list.length; i++) {
    var q0 = list[i], p0 = st.party[q0.i];
    if (!p0) { continue; }
    var fd = q0.er && q0.er.sk ? q0.er.sk.d : exDur(p0);
    if (t >= q0.at - 1e-9 && t < q0.at + Math.max(0.5, (fd || 0) / B.fps)) { on = q0; }
  }
  var q = ordAt(list, t);
  // **同じ絵なら組み直さない。**マウスを動かすたびにアイコンを差し替えると散らつく
  var key = [q.join(','), on ? on.ix : -1, st.mode, st.pi, _pv].join('|');
  if (key === _ordK) { return; }
  _ordK = key;
  var cells = '';
  for (i = 0; i < q.length; i++) {
    var p = st.party[q[i]];
    cells += '<span class="ocw' + (i < HAND_N ? ' hd' : '') +
      (i === HAND_N ? ' gap' : '') + '" title="' +
      esc((i + 1) + '　' + ((p && p.n) || '')) + '">' +
      '<span class="oc' + (i < HAND_N ? ' hd' : '') + '">' +
      (p ? img(p.id, 'ic') : '') + '</span><i>' + (i + 1) + '</i></span>';
  }
  // **札は名前とコストと秒まで。**効果の列挙はやめた（2026-09-03 の先生の指示
  // 「注釈とかマジでいらないから全箇所」）
  var card = '';
  if (on) {
    var pc = st.party[on.i], er2 = on.er;
    var cn = er2 && er2.sk ? er2.sk.n : (pc ? pc.en : '');
    var cc = er2 ? er2.need : (pc ? exCost(pc) : 0);
    // コストはタイムラインの帯と同じ「アイコンに乗せた数字」。言葉を足さずに済む
    card = '<span class="ocard"><span class="oci">' +
      (pc ? img(pc.id, 'ic') : '') +
      '<b class="cs">' + (Math.round(cc * 10) / 10) + '</b></span>' +
      '<span class="oct"><b>' + esc(cn) + '</b><span>' +
      on.at.toFixed(2) + '秒</span></span></span>';
  }
  box.innerHTML = '<span class="kl">スキル順</span>' +
    '<span class="ordrow"><span class="ocs">' + cells + '</span>' + card + '</span>';
}


// `_ordK` は ord.js の持ち物。kpi.js が入れ物を作り直したときに捨てるための窓口
export function resetOrdKey() { _ordK = ''; }
