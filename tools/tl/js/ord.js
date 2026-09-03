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
/** その秒の手札と控え。**ゲームと同じ回り方**（2026-09-03 の先生の言葉
    「使ったスキルのいちに次の待機スキルの裏の１番目が入り込む形」）。
    `tools/tl-engine.js` の `playHand` がすでにこの形で、
    **使った札は山札のいちばん下へ回り、空いたその枠へ山札の先頭が入る。**
    左詰めにはならないので、隣の 2 枚は動かない。
    `kept`（撃っても手札に残る）の 1 発は回さない。
    返すのは `{ hand, rest }`（`hand` は画面に並ぶ 3 枠そのもの） */
export function ordAt(list, t) {
  var q = deck0(list), hand = q.slice(0, HAND_N), rest = q.slice(HAND_N), i, at;
  for (i = 0; i < list.length; i++) {
    if (list[i].at > t + 1e-9) { break; }
    if (list[i].kept) { continue; }
    at = hand.indexOf(list[i].i);
    if (at < 0) { continue; }
    rest.push(list[i].i);
    hand[at] = rest.shift();
  }
  return { hand: hand, rest: rest };
}
/** 概況の帯のスキル順（2026-09-03 の先生の要望）。
    **上の段がいま選べる 3 枚、下の段が控え**で、下は上の 0.8 倍。
    「スキル順」の見出しは置かない（言葉を使わない）。
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
  var hr = ordAt(list, t);
  // **同じ絵なら組み直さない。**マウスを動かすたびにアイコンを差し替えると散らつく
  var key = [hr.hand.join(','), hr.rest.join(','), on ? on.ix : -1,
             st.mode, st.pi, _pv].join('|');
  if (key === _ordK) { return; }
  _ordK = key;
  function row(q, cls) {
    var c = '', k, p;
    for (k = 0; k < q.length; k++) {
      p = st.party[q[k]];
      c += '<span class="oc ' + cls + '" title="' +
        esc((cls === 'hd' ? '手札 ' : '控え ') + (k + 1) + '　' + ((p && p.n) || '')) +
        '">' + (p ? img(p.id, 'ic') : '') + '</span>';
    }
    return '<span class="orow ' + cls + '">' + c + '</span>';
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
  box.innerHTML = '<span class="ordrow"><span class="ocs">' +
    row(hr.hand, 'hd') + row(hr.rest, 'wt') + '</span>' + card + '</span>';
}


// `_ordK` は ord.js の持ち物。kpi.js が入れ物を作り直したときに捨てるための窓口
export function resetOrdKey() { _ordK = ''; }
