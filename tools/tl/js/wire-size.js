import { $ } from './util.js';
import { relayout } from './zoom.js';
import { drag } from './wire-mouse.js';

// ---- 大きさを変える（2026-09-01 の先生の指示
//      「パネルとパネルの隙間をクリックドラッグで、中身のサイズ変更も崩れないように」）
export function saveSize(k, v) {
  try {
    if (v == null) { localStorage.removeItem('tl-sz-' + k); }
    else { localStorage.setItem('tl-sz-' + k, String(v)); }
  } catch (e) { void e; }
}
export function loadSize(k) {
  try { return localStorage.getItem('tl-sz-' + k); } catch (e) { void e; return null; }
}

export function wireSize() {
  // 左右の幅
  (function () {
    var g = $('cgrip'), m = $('tlmain'), from = 0, base = 0;
    var saved = loadSize('lw');
    // **畳んでいる間は幅の指定を入れない。**インラインの `--lcol` は
    // `.tlmain.wide` の細い幅に勝つので、入れると閉じても右が広がらない
    // （2026-09-03 の先生の指摘「横全部閉じるトグル使っても TL が広がらない」）
    if (saved && !m.classList.contains('wide')) { m.style.setProperty('--lcol', saved + 'px'); }
    function move(e) {
      // **下限は摘みが押せる幅、上限は画面の半分。**それ以上は右が読めなくなる
      var w = Math.max(150, Math.min(window.innerWidth * 0.5, base + (e.clientX - from)));
      m.style.setProperty('--lcol', Math.round(w) + 'px');
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('rz');
      g.classList.remove('drag');
      saveSize('lw', parseInt(m.style.getPropertyValue('--lcol'), 10) || null);
      relayout();
    }
    g.addEventListener('mousedown', function (e) {
      if (e.target.closest('.fold') || m.classList.contains('wide')) { return; }
      e.preventDefault();
      from = e.clientX; base = $('tlleft').getBoundingClientRect().width;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.classList.add('rz');
      g.classList.add('drag');
    });
    g.addEventListener('dblclick', function (e) {
      if (e.target.closest('.fold')) { return; }
      m.style.removeProperty('--lcol'); saveSize('lw', null); relayout();
    });
  })();
  // 縦の高さ。**掴むのは隙間そのもの**（余白を増やさない）
  (function () {
    var boxes = [], i;
    var ls = document.querySelectorAll('.tlapp .tlleft > .pane');
    var rs = document.querySelectorAll('.tlapp .tlright > .pane, .tlapp .tlright > .stage');
    // **鍵は並び順ではなく名前**（`data-pn`）。パネルが 1 枚増減しただけで
    // 保存した高さが隣へずれる（2026-09-04 に盤を消して実際にずれた）
    for (i = 0; i < ls.length; i++) { boxes.push([ls[i].getAttribute('data-pn') || ('L' + i), ls[i]]); }
    for (i = 0; i < rs.length; i++) { boxes.push([rs[i].getAttribute('data-pn') || ('R' + i), rs[i]]); }
    for (i = 0; i < boxes.length; i++) { arm(boxes[i][0], boxes[i][1]); }
    function arm(key, el) {
      var saved = loadSize(key);
      if (saved) { el.style.height = saved + 'px'; el.classList.add('sized'); }
      var g = document.createElement('div');
      g.className = 'vgrip';
      g.title = 'ドラッグで高さを変える／ダブルクリックで戻す';
      el.appendChild(g);
      var from = 0, base = 0;
      function move(e) {
        var h = Math.max(56, base + (e.clientY - from));
        el.style.height = Math.round(h) + 'px';
        el.classList.add('sized');
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('rz', 'row');
        g.classList.remove('drag');
        saveSize(key, parseInt(el.style.height, 10) || null);
        relayout();
      }
      g.addEventListener('mousedown', function (e) {
        e.preventDefault();
        from = e.clientY; base = el.getBoundingClientRect().height;
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        document.body.classList.add('rz', 'row');
        g.classList.add('drag');
      });
      g.addEventListener('dblclick', function () {
        el.style.height = ''; el.classList.remove('sized'); saveSize(key, null); relayout();
      });
    }
  })();

}
