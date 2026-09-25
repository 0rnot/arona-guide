/* 入力を覚えておく。**次に開いたとき、前の続きから始まる。**

   2026-09-26 の先生の判断——「ツールごとに覚える」。中級の先生は同じツールに
   何度も戻ってくるので、毎回打ち直しになっていた。

   **覚えるのは URL のハッシュそのもの。**各ツールはもう `window.shareUrl()` で
   「開いている状態ごと URL」を作れて、読み込み時に `location.hash` から戻せる
   （共有のための仕組み）。だからここは、

     1. 開いたときハッシュが空なら、前に覚えたハッシュを URL に戻す
        （**ツールの JS より先に読み込むこと。**あとだと、ツールが空の状態で組み上がる）
     2. 触られるたびに `shareUrl()` を覚え直す

   だけで済み、ツール側は 1 行も要らない。**共有された URL で開いたときは、
   そちらが勝つ**（ハッシュが空のときしか戻さない）。

   見出しの下に「最初に戻す」を置く。押すと覚えたものを消して、素の状態で開き直す。
   保存はブラウザの中だけ。どこにも送らない。 */
(function () {
  'use strict';

  var KEY = 'arona-state-' + location.pathname;

  function load() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  // 1) 前の続き。**`replaceState` なので履歴は増えない**
  if (!location.hash) {
    var saved = load();
    if (saved && saved.charAt(0) === '#') {
      try { history.replaceState(null, '', location.pathname + location.search + saved); } catch (e) { /* file:// */ }
    }
  }

  // 2) 覚え直す。入力のたびに書くと重いので、落ち着いてから 1 回
  function current() {
    try {
      if (typeof window.shareUrl === 'function') return window.shareUrl() || '';
    } catch (e) { /* ツール側が転んでも覚えるのは諦めるだけ */ }
    return location.hash;
  }
  function save() {
    var h = current();
    try {
      if (h && h.length > 1) localStorage.setItem(KEY, h);
    } catch (e) { /* 保存できないブラウザでは覚えないだけ */ }
  }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(save, 400); }
  ['input', 'change', 'click'].forEach(function (ev) {
    document.addEventListener(ev, later, true);
  });
  addEventListener('pagehide', save);

  // 3) 最初に戻す。tour.js の「使い方を見る」の隣
  function addReset() {
    var body = document.querySelector('.thero-body');
    if (!body) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn tour-open state-reset'; b.textContent = '最初に戻す';
    b.style.marginLeft = '8px';
    b.addEventListener('click', function () {
      clearTimeout(timer);
      removeEventListener('pagehide', save);
      try { localStorage.removeItem(KEY); } catch (e) { /* 無ければそれでいい */ }
      location.replace(location.pathname + location.search);
    });
    body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addReset);
  else addReset();
})();
