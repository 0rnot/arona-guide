import { S, esc } from './util.js';
import { _byid } from './core.js';
import { restore, sheet } from './io.js';
import { CIRC } from './parse-text.js';
import { parseTL } from './parse-tl.js';
import { FMT_HELP, applyTL } from './parse-apply.js';

/** 読み込みの窓。**JSON でも、文章で書いた TL でも受ける。** */
// ------------------------------------------------- 画面から TL を組む
/* **文章を貼る以外の入口**（2026-09-01 の先生の指示「読み込むの TL は
   テキスト以外に、サイト内 UI からも入力できるようにして」）。
   フォームは**文章を組み立てて `parseTL` に渡すだけ**にしてある。
   読み取りの実装を 2 本に増やすと、片方だけ直す事故が起きる。 */
export var IMF = { crew: [], start: [], rows: [] };
export function stuOpts(sel, blank) {
  var lst = S.students.slice().sort(function (a, b) {
    return a.n < b.n ? -1 : (a.n > b.n ? 1 : 0);
  });
  var h = blank ? '<option value="">' + esc(blank) + '</option>' : '', i;
  for (i = 0; i < lst.length; i++) {
    h += '<option value="' + lst[i].id + '"' +
         (String(sel) === String(lst[i].id) ? ' selected' : '') + '>' +
         esc(lst[i].n) + '</option>';
  }
  return h;
}
export function imfCrewOpts(sel) {
  var h = '<option value="">—</option>', i;
  for (i = 0; i < IMF.crew.length; i++) {
    var sd = _byid[IMF.crew[i].id];
    if (!sd) { continue; }
    h += '<option value="' + i + '"' + (String(sel) === String(i) ? ' selected' : '') +
         '>' + esc(sd.n) + '</option>';
  }
  return h;
}
/** フォームの中身を、貼り付けと同じ文章に組み立てる */
export function imfText() {
  var L = ['使用生徒詳細'], i;
  for (i = 0; i < IMF.crew.length; i++) {
    var c = IMF.crew[i], sd = _byid[c.id];
    if (!sd) { continue; }
    L.push(sd.n + '　' + (c.ws > 0 ? '固有' + c.ws : '★5') + '　MMMM　t10/10/10' +
           '　絆' + c.bond + '　全WB' + c.pot);
  }
  var ss = [];
  for (i = 0; i < IMF.start.length; i++) {
    var sd2 = _byid[(IMF.crew[IMF.start[i]] || {}).id];
    if (sd2) { ss.push(CIRC.charAt(i) + sd2.n); }
  }
  if (ss.length) { L.push('', '開始SET：' + ss.join(' ')); }
  L.push('', 'TL1ページ目');
  for (i = 0; i < IMF.rows.length; i++) {
    var rw = IMF.rows[i], sd3 = _byid[(IMF.crew[rw.who] || {}).id];
    if (!sd3) { continue; }
    var head = rw.md === 'c' ? (rw.cv >= 1 && rw.cv <= 20 && rw.cv === Math.round(rw.cv)
                                ? CIRC.charAt(rw.cv - 1) : String(rw.cv) + ' ')
             : (rw.md === 't' ? 't' + rw.t + ' ' : '即');
    var to = '';
    if (rw.to != null && IMF.crew[rw.to] && _byid[IMF.crew[rw.to].id]) {
      to = '(' + _byid[IMF.crew[rw.to].id].n + ')';
    }
    L.push(head + (rw.copy ? 'C' : '') + sd3.n + to);
  }
  return L.join('\n');
}
export function imfDraw(w) {
  var h = '', i;
  h += '<div class="fields wrapf" style="margin-bottom:6px">' +
       '<b class="tiny">使用生徒</b>' +
       '<button type="button" class="btn2" data-im="cadd">＋ 生徒</button></div>';
  for (i = 0; i < IMF.crew.length; i++) {
    var c = IMF.crew[i];
    h += '<div class="fields wrapf" style="margin-bottom:3px">' +
      '<select data-im="cid" data-i="' + i + '">' + stuOpts(c.id) + '</select>' +
      '<label class="f"><span>固有</span><select data-im="cws" data-i="' + i + '">' +
      [0, 1, 2, 3, 4].map(function (v) {
        return '<option value="' + v + '"' + (c.ws === v ? ' selected' : '') + '>★' + v + '</option>';
      }).join('') + '</select></label>' +
      '<label class="f"><span>絆</span><input type="number" data-im="cbond" data-i="' + i +
      '" min="1" max="50" value="' + c.bond + '" style="width:58px"></label>' +
      '<label class="f"><span>潜在</span><input type="number" data-im="cpot" data-i="' + i +
      '" min="0" max="25" value="' + c.pot + '" style="width:58px"></label>' +
      '<button type="button" class="btn2 sq" data-im="cdel" data-i="' + i + '">×</button></div>';
  }
  h += '<div class="fields wrapf" style="margin:6px 0 3px"><b class="tiny">開始SET</b>';
  for (i = 0; i < 5; i++) {
    h += '<select data-im="sset" data-i="' + i + '">' +
         imfCrewOpts(IMF.start[i] == null ? '' : IMF.start[i]) + '</select>';
  }
  h += '</div>';
  h += '<div class="fields wrapf" style="margin:6px 0 3px"><b class="tiny">TL</b>' +
       '<button type="button" class="btn2" data-im="radd">＋ 行</button></div>';
  for (i = 0; i < IMF.rows.length; i++) {
    var rw = IMF.rows[i];
    h += '<div class="fields wrapf" style="margin-bottom:3px">' +
      '<span class="mut tiny" style="width:22px">' + (i + 1) + '</span>' +
      '<select data-im="rwho" data-i="' + i + '">' + imfCrewOpts(rw.who) + '</select>' +
      '<select data-im="rmd" data-i="' + i + '">' +
      '<option value="c"' + (rw.md === 'c' ? ' selected' : '') + '>コスト</option>' +
      '<option value="t"' + (rw.md === 't' ? ' selected' : '') + '>秒</option>' +
      '<option value="e"' + (rw.md === 'e' ? ' selected' : '') + '>即</option>' +
      '</select>' +
      (rw.md === 'e' ? '' :
        '<input type="number" data-im="rv" data-i="' + i + '" step="0.5" min="0" value="' +
        (rw.md === 'c' ? rw.cv : rw.t) + '" style="width:64px">') +
      '<label class="f"><span>渡す</span><select data-im="rto" data-i="' + i + '">' +
      imfCrewOpts(rw.to == null ? '' : rw.to) + '</select></label>' +
      '<label class="f"><span>複製</span><input type="checkbox" data-im="rcopy" data-i="' + i +
      '"' + (rw.copy ? ' checked' : '') + '></label>' +
      '<button type="button" class="btn2 sq" data-im="rdel" data-i="' + i + '">×</button></div>';
  }
  w.querySelector('#imform').innerHTML = h;
  w.querySelector('textarea').value = imfText();
}
export function importSheet() {
  var w = document.createElement('div');
  w.className = 'sheet';
  w.innerHTML = '<div class="card"><h3>読み込み</h3>' +
    '<p class="mut tiny" style="margin:0 0 4px">' +
    '「書き出し」の JSON か、<b>文章の TL</b> をそのまま貼れます。' +
    '要るのは<b>育成・いつ（何コストで）撃つか・誰に渡すか</b>の 3 つだけです。' +
    '支援値は編成から計算するので書かなくて構いません。' +
    '<a href="#" data-x="fmt">書き方を見る</a></p>' +
    '<div class="errlog" id="imfmt" hidden style="margin-bottom:6px">' + FMT_HELP + '</div>' +
    '<div class="tabs" id="imtabs" style="margin-bottom:6px">' +
    '<button type="button" class="t on" data-im="tab" data-v="0">文章を貼る</button>' +
    '<button type="button" class="t" data-im="tab" data-v="1">画面から組む</button></div>' +
    '<div id="imform" hidden style="max-height:300px;overflow:auto"></div>' +
    '<textarea spellcheck="false"></textarea>' +
    '<div class="row"><button type="button" class="btn2" data-x="ok">読み込む</button>' +
    '<button type="button" class="btn2" data-x="no">閉じる</button></div>' +
    '<div class="errlog" id="imlog" style="margin-top:6px;display:none"></div></div>';
  var ta = w.querySelector('textarea'), log = w.querySelector('#imlog');
  // ---- 「画面から組む」。触るたびに文章を組み直して textarea に流す
  w.addEventListener('click', function (e) {
    var t = e.target.closest('[data-im]');
    if (!t) { return; }
    var k = t.getAttribute('data-im'), i = +t.getAttribute('data-i');
    if (k === 'tab') {
      var v = t.getAttribute('data-v') === '1';
      var bs = w.querySelectorAll('#imtabs .t'), z;
      for (z = 0; z < bs.length; z++) { bs[z].className = 't' + (bs[z] === t ? ' on' : ''); }
      w.querySelector('#imform').hidden = !v;
      ta.readOnly = v;
      if (v) { imfDraw(w); }
      return;
    }
    if (k === 'cadd') { IMF.crew.push({ id: S.students[0].id, ws: 3, bond: 20, pot: 25 }); }
    else if (k === 'cdel') { IMF.crew.splice(i, 1); IMF.start = []; IMF.rows = []; }
    else if (k === 'radd') { IMF.rows.push({ who: 0, md: 'c', cv: 10, t: 0, to: null, copy: false }); }
    else if (k === 'rdel') { IMF.rows.splice(i, 1); }
    else { return; }
    imfDraw(w);
  });
  w.addEventListener('change', function (e) {
    var t = e.target.closest('[data-im]');
    if (!t || t.getAttribute('data-im') === 'tab') { return; }
    var k = t.getAttribute('data-im'), i = +t.getAttribute('data-i');
    var c = IMF.crew[i], rw = IMF.rows[i];
    if (k === 'cid' && c) { c.id = +t.value; }
    else if (k === 'cws' && c) { c.ws = +t.value; }
    else if (k === 'cbond' && c) { c.bond = Math.max(1, Math.min(50, +t.value || 1)); }
    else if (k === 'cpot' && c) { c.pot = Math.max(0, Math.min(25, +t.value || 0)); }
    else if (k === 'sset') { IMF.start[i] = t.value === '' ? null : +t.value; }
    else if (k === 'rwho' && rw) { rw.who = t.value === '' ? 0 : +t.value; }
    else if (k === 'rmd' && rw) { rw.md = t.value; }
    else if (k === 'rv' && rw) {
      if (rw.md === 'c') { rw.cv = +t.value || 0; } else { rw.t = +t.value || 0; }
    } else if (k === 'rto' && rw) { rw.to = t.value === '' ? null : +t.value; }
    else if (k === 'rcopy' && rw) { rw.copy = t.checked; }
    else { return; }
    imfDraw(w);
  });
  function say(rows) {
    log.style.display = '';
    log.innerHTML = rows.join('');
    log.scrollTop = 0;
  }
  function li(cls, t) { return '<div class="' + cls + '">' + esc(t) + '</div>'; }
  w.addEventListener('click', function (e) {
    if (e.target === w || e.target.getAttribute('data-x') === 'no') {
      document.body.removeChild(w); return;
    }
    if (e.target.getAttribute('data-x') === 'fmt') {
      e.preventDefault();
      var fm = w.querySelector('#imfmt');
      fm.hidden = !fm.hidden;
      return;
    }
    if (e.target.getAttribute('data-x') !== 'ok') { return; }
    var v = ta.value.replace(/^[\s\uFEFF]+/, '');
    if (v.charAt(0) === '{') {
      try { restore(JSON.parse(v)); document.body.removeChild(w); }
      catch (err) { say([li('e', String(err.message || err))]); }
      return;
    }
    var p;
    try { p = parseTL(v); } catch (err2) { say([li('e', String(err2.message || err2))]); return; }
    if (p.err) {
      var eo = [li('e', p.err)], ei;
      for (ei = 0; ei < (p.skipped || []).length && ei < 40; ei++) {
        eo.push(li('', '▸ ' + p.skipped[ei][0] + '　—　' + p.skipped[ei][1]));
      }
      if ((p.skipped || []).length > 40) { eo.push(li('', '…ほか ' + (p.skipped.length - 40) + ' 行')); }
      say(eo); return;
    }
    var r = applyTL(p), out = [], i;
    out.push(li('g', '✔ 生徒 ' + p.crew.length + ' 人・開始スキル ' + p.start.length +
                ' 人ぶん・EX ' + r.n + ' 発を読みました'));
    for (i = 0; i < p.notes.length; i++) { out.push(li('', '▸ ' + p.notes[i])); }
    for (i = 0; i < p.skipped.length; i++) {
      out.push(li('w', '⚠ 読めなかった行: ' + p.skipped[i][0].trim() +
                  '　—　' + p.skipped[i][1]));
    }
    for (i = 0; i < r.ng.length; i++) { out.push(li('w', '⚠ 置けません: ' + r.ng[i])); }
    for (i = 0; i < (r.slip || []).length; i++) {
      out.push(li('', (/置きました|数えていません/.test(r.slip[i]) ? '▸ ' : '▸ 少し後ろにずれます: ') + r.slip[i]));
    }
    if (!p.skipped.length && !r.ng.length) {
      out.push(li('g', r.slip && r.slip.length
        ? '✔ 全部置けました（' + r.slip.length + ' 発は演出やコスト待ちで少し後ろにずれます）'
        : '✔ 全部そのまま置けました'));
    }
    say(out);
  });
  document.body.appendChild(w);
  ta.focus();
}
