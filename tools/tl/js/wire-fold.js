import { $ } from './util.js';
import { fit, relayout } from './zoom.js';
import { loadSize } from './wire-size.js';

// ---- 畳む。**摘みは畳む対象の左肩に付ける**（2026-09-01 の先生の指摘
// 「左を畳む が右にあるのキモい／トグルっポイアイコンで全パネル」）
export function foldKey(el) { return el.getAttribute('data-fold') || ''; }
export function setFold(pane, on) {
  pane.classList.toggle('folded', on);
  var btn = pane.querySelector('h2.sect > .fold');
  if (btn) { btn.setAttribute('aria-expanded', on ? 'false' : 'true'); }
  try { localStorage.setItem('tl-fold-' + foldKey(pane), on ? '1' : '0'); } catch (e) { void e; }
}
// **左を畳んだぶんだけ右を広げる**（2026-09-03 の先生の指摘
// 「左のパネルを最小化してもタイムラインが追従しない」）。左の列は 340px 固定で、
// パネルを畳んでも幅が残っていた。**全部畳んだら見出しの幅まで詰める**
export function lcolFit() {
  var m = $('tlmain'), ps = $('tlleft').querySelectorAll('.pane'), i, all = ps.length > 0;
  // **左を丸ごと畳んでいる間は幅を書かない**（2026-09-03）。
  // ドラッグで決めた幅がインラインで残っていると `.tlmain.wide` に勝ってしまう
  if (m.classList.contains('wide')) { m.style.removeProperty('--lcol'); return; }
  for (i = 0; i < ps.length; i++) {
    if (!ps[i].classList.contains('folded')) { all = false; }
  }
  // **畳んだら見出しだけの幅まで詰める。**150px は仕切りを掴めるいちばん細い幅
  // （`max-content` にすると畳んだ見出しの余白まで数えて逆に広がる。実測 457px）
  if (all) { m.style.setProperty('--lcol', '150px'); return; }
  var saved = loadSize('lw');
  if (saved) { m.style.setProperty('--lcol', saved + 'px'); }
  else { m.style.removeProperty('--lcol'); }
}

// **左の列を画面にぴったり収める**（2026-09-03 の先生の指示
// 「左側の育成の下側がピッタリ画面に収まるように」）。上に残っている概況の帯の
// ぶんだけ背を削る。スクロールで帯が抜けたら止まる位置（8px）までで、
// そのぶん背が伸びる。**狭い画面（1 列に畳むとき）は書かない**
export function leftFit() {
  var l = $('tlleft'), m = $('tlmain');
  if (!l || !m) { return; }
  if (window.innerWidth < 1000) { l.style.removeProperty('--lh'); return; }
  var top = Math.max(m.getBoundingClientRect().top, 8);
  l.style.setProperty('--lh', Math.max(240, window.innerHeight - top - 8) + 'px');
}

export function wireFold() {
  // 見出しのあるパネル全部に摘みを足す
  (function () {
    var ps = document.querySelectorAll('.tlapp .pane'), i;
    for (i = 0; i < ps.length; i++) {
      var h = ps[i].querySelector('h2.sect');
      if (!h) { continue; }
      // **鍵は並び順ではなく名前**（`data-pn`）。見出しの無いパネル（盤）を
      // 消したときに番号がずれて、保存した畳みが別のパネルに当たった
      // （2026-09-04。「相手」が勝手に畳まれた状態で開いていた）
      ps[i].setAttribute('data-fold', ps[i].getAttribute('data-pn') || ('p' + i));
      // **見出しは `.bd` の直下とは限らない。**「相手」と「シナリオ別達成率」は
      // `.fields.wrapf` / `.row` の中にあって、そのかたまりごと隠すと**摘みまで
      // 消えて開けなくなる**（2026-09-01 の先生の指摘）。
      // 畳むときに残す枠に印を付けておく
      var bd = ps[i].querySelector(':scope > .bd') || h.parentNode;
      // **見出しへの道すじを全部たどって印を付ける。**「シナリオ別達成率」は
      // `.bd > .row > div > h2` と 2 段深い
      var hdr = h.parentNode;
      while (hdr && hdr !== bd) { hdr.setAttribute('data-hdr', '1'); hdr = hdr.parentNode; }
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'fold'; btn.setAttribute('aria-expanded', 'true');
      btn.title = '畳む／出す';
      btn.innerHTML = '<span class="cv"></span>';
      h.insertBefore(btn, h.firstChild);
      var was = null;
      try { was = localStorage.getItem('tl-fold-' + ps[i].getAttribute('data-fold')); }
      catch (e2) { void e2; }
      if (was === '1') { ps[i].classList.add('folded'); btn.setAttribute('aria-expanded', 'false'); }
    }
  })();
  document.addEventListener('click', function (e) {
    var b = e.target.closest('h2.sect > .fold');
    if (!b) { return; }
    var pane = b.closest('.pane');
    if (!pane) { return; }
    setFold(pane, !pane.classList.contains('folded'));
    lcolFit();
    leftFit();
    setTimeout(relayout, 0);
  });
  lcolFit();
  leftFit();
  (function () {
    var q = 0;
    function go() { q = 0; leftFit(); }
    function ask() { if (!q) { q = requestAnimationFrame(go); } }
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    // **上の帯は後から中身が入って背が伸びる。**最初の 1 回だけでは 84px ずれる
    // （2026-09-03 の実測。概況の帯が空のうちに測っていた）
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(ask);
      ro.observe(document.documentElement);
      if ($('kpi')) { ro.observe($('kpi')); }
      if ($('tlleft')) { ro.observe($('tlleft')); }
    }
    window.addEventListener('load', ask);
  })();
  $('b-side').addEventListener('click', function (e) {
    // **摘みは仕切りの上に乗っている。**押したぶんが幅の変更にならないよう止める
    e.stopPropagation();
    var m = $('tlmain'), on = m.classList.toggle('wide');
    $('tlleft').classList.toggle('shut', on);
    this.setAttribute('aria-expanded', on ? 'false' : 'true');
    // **閉じるときはドラッグで決めた幅を外す。**外さないと右が広がらない
    if (on) { m.style.removeProperty('--lcol'); } else { lcolFit(); }
    try { localStorage.setItem('tl-shut', on ? '1' : '0'); } catch (e2) { void e2; }
    setTimeout(fit, 0);
    setTimeout(relayout, 0);
  });
  (function () {
    var was = null;
    try { was = localStorage.getItem('tl-shut'); } catch (e) { void e; }
    if (was === '1') { $('b-side').click(); }
  })();

}
