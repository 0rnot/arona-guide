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
   保存はブラウザの中だけ。どこにも送らない。

   **1 ページに区画が何本もあるツール向けの口**（2026-09-26、装備の 3 本を
   `tools/equipment/` の 1 本にまとめたときに足した。どれも無ければ今までどおり）:

   - `<script src="../remember.js" data-keep="lv,g">` —— ハッシュ付きで開いたときも、
     **URL に無い区画だけは前の続きを足す。**強化珠の区画へのリンクで開いても、
     効果の早見で選んでいた部位が消えない
   - `window.rememberUrl()` —— 覚えるハッシュ。無ければ `shareUrl()`（共有は今の区画だけ、
     覚えるのは全区画、のように分けたいとき）
   - `window.rememberReset()` —— 「最初に戻す」で残すハッシュを返す。`null` なら何もしない */
(function () {
  'use strict';

  var KEY = 'arona-state-' + location.pathname;
  var me = document.currentScript;
  var KEEP = ((me && me.getAttribute('data-keep')) || '').split(',').filter(Boolean);

  function load() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  // 1) 前の続き。**`replaceState` なので履歴は増えない**
  if (!location.hash) {
    var saved = load();
    if (saved && saved.charAt(0) === '#') {
      try { history.replaceState(null, '', location.pathname + location.search + saved); } catch (e) { /* file:// */ }
    }
  } else if (KEEP.length) {
    // **URL が勝つのは、URL に書いてある区画だけ。**書いていない区画は前の続きを足す
    var cur = location.hash.replace(/^#/, '').split('&');
    var has = {};
    cur.forEach(function (x) { has[x.split('=')[0]] = true; });
    var add = load().replace(/^#/, '').split('&').filter(function (x) {
      var k = x.split('=')[0];
      return x && KEEP.indexOf(k) >= 0 && !has[k];
    });
    if (add.length) {
      try {
        history.replaceState(null, '', location.pathname + location.search + '#' + cur.concat(add).join('&'));
      } catch (e) { /* file:// */ }
    }
  }

  // 2) 覚え直す。入力のたびに書くと重いので、落ち着いてから 1 回
  function current() {
    try {
      if (typeof window.rememberUrl === 'function') return window.rememberUrl() || '';
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
      if (typeof window.rememberReset === 'function') {
        // **どこまで戻すかはページが決める。**返ってきたハッシュだけ覚え直して開き直す
        var keep = window.rememberReset();
        if (keep == null) return;
        removeEventListener('pagehide', save);
        try {
          if (keep && keep.length > 1) localStorage.setItem(KEY, keep); else localStorage.removeItem(KEY);
          history.replaceState(null, '', location.pathname + location.search + (keep.length > 1 ? keep : ''));
        } catch (e) { /* file:// */ }
        location.reload();
        return;
      }
      removeEventListener('pagehide', save);
      try { localStorage.removeItem(KEY); } catch (e) { /* 無ければそれでいい */ }
      location.replace(location.pathname + location.search);
    });
    body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addReset);
  else addReset();
})();
