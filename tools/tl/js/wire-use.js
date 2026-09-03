import { $ } from './util.js';
import { bump, st } from './core.js';
import { mark } from './undo.js';
import { draw } from './draw.js';

// ---- 選んだ 1 発の設定。**「入力」の TL 表の「詳細」も同じ中身**なので関数にする
export function onUse(e) {
  var el = e.target.closest('[data-us]');
  if (!el || st.sel == null) { return; }
  mark();
  var k = el.getAttribute('data-us'), raw = el.value;
  var u = st.tl[st.sel];
  if (k === 'gx') {
    // **☑ を外した窓の番号を持つ**（2026-09-03）。入っている＝この 1 発では効かない
    var wn = +el.getAttribute('data-w'), lg = (u.gx || []).slice(), zg = lg.indexOf(wn);
    if (el.checked) { if (zg >= 0) { lg.splice(zg, 1); } } else if (zg < 0) { lg.push(wn); }
    u.gx = lg.length ? lg : null;
    bump(); draw(); return;
  }
  if (k === 'md') {
    u.md = raw;
    if (raw === 'c' && u.cv == null) { u.cv = 10; }
    // 秒に戻すときは、いま出ている時刻をそのまま引き継ぐ
    if (raw === 't' && u._rt != null) { u.t = u._rt; }
  } else if (k === 't') {
    u.t = Math.max(0, +raw || 0);
  } else if (k === 'cv') {
    u.cv = Math.max(0, +raw || 0);
  } else if (k === 'bto' && el.getAttribute('data-slot') != null) {
    var bx = el.parentNode.querySelectorAll('select[data-us="bto"]'), lb = [], zz;
    for (zz = 0; zz < bx.length; zz++) { lb.push(bx[zz].value === '' ? null : +bx[zz].value); }
    u.bto = lb.length > 1 ? lb : (lb[0] == null ? null : lb[0]);
  } else {
    u[k] = raw === '' ? null : +raw;
  }
  draw();
}

export function wireUse() {
  $('useedit').addEventListener('change', onUse);

}
