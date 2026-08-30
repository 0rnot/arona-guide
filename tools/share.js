/* 結果の共有。**15 個のツールで同じものを使う。**

   各ツールに書き足すのは `<div class="sharebar" id="sharebar"></div>` の
   1 行だけ。**中身はこのファイルが画面から読む。**`.stat` の作り
   （`.k` が見出し、`.v` が値）が全ツールで揃っているので、そこを拾えば
   ツールごとの細工が要らない（2026-08-30）。

   渡し方は 3 段。
   1. スマホ（`navigator.share`）→ OS の共有シート
   2. PC（クリップボード）→ 文面ごとコピーして帯で伝える
   3. どちらも無い → X の投稿ページを開く

   **URL は `#` ごと配る。**TL のように状態をハッシュに入れているツールでは、
   ここを削ると相手に同じ結果が出ない。 */
(function () {
  'use strict';
  var box = document.getElementById('sharebar');
  if (!box) return;

  var SITE = 'AronaBot のツール';
  var MAX_LINES = 3;

  function toolName() { return (document.title || '').split('｜')[0].trim(); }

  /** 画面に出ている結果を、上から数行ぶん。**「—」や空はまだ計算前なので飛ばす。** */
  function lines() {
    var out = [];
    var stats = document.querySelectorAll('.stat');
    for (var i = 0; i < stats.length && out.length < MAX_LINES; i++) {
      var k = stats[i].querySelector('.k'), v = stats[i].querySelector('.v');
      if (!k || !v) continue;
      var kt = (k.textContent || '').replace(/\s+/g, ' ').trim();
      var vt = (v.textContent || '').replace(/\s+/g, ' ').trim();
      if (!kt || !vt || vt === '—' || vt === '-') continue;
      out.push(kt + ' ' + vt);
    }
    return out;
  }

  function text() {
    var ls = lines();
    return toolName() + (ls.length ? '\n' + ls.join('\n') : '') + '\n\n#ブルアカ';
  }
  /** 配る URL。**状態をハッシュに入れているツールは、押された時点で組み直す。**
      TL は「URL をコピー」を押すまで `location.hash` を書き換えないので、
      ここで `window.shareUrl()` を呼ばないと空の盤面が飛んでいく。 */
  function url() {
    try {
      if (typeof window.shareUrl === 'function') {
        var h = window.shareUrl();
        if (h) return location.href.split('#')[0] + h;
      }
    } catch (e) { /* ツール側が転んでも共有は動かす */ }
    return location.href;
  }

  box.innerHTML =
    '<div class="sharebar-in">' +
      '<p class="sharebar-tx"><b>この結果をそのまま渡せます。</b>' +
        '<span class="sharebar-sub">開いている状態ごと URL になります</span></p>' +
      '<div class="sharebar-btns">' +
        '<button type="button" class="btn tone" id="sb-share">結果を共有</button>' +
        '<button type="button" class="btn" id="sb-copy">URL をコピー</button>' +
        '<a class="btn" id="sb-x" target="_blank" rel="noopener" href="#">X に投稿</a>' +
      '</div>' +
    '</div>';

  var toast = document.getElementById('toast-page');
  var timer = null;
  function say(t) {
    if (!toast) return;
    toast.textContent = t; toast.classList.add('shown');
    clearTimeout(timer); timer = setTimeout(function () { toast.classList.remove('shown'); }, 2000);
  }
  function copy(s, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { say(msg); },
        function () { say('コピーできませんでした'); });
    } else { say('コピーできませんでした'); }
  }

  document.getElementById('sb-share').addEventListener('click', function () {
    var t = text(), u = url();
    if (navigator.share) {
      navigator.share({ title: toolName() + '｜' + SITE, text: t, url: u }).catch(function () {});
      return;
    }
    copy(t + '\n' + u, '結果をコピーしました');
  });
  document.getElementById('sb-copy').addEventListener('click', function () {
    copy(url(), 'URL をコピーしました');
  });

  // **X の href は押される直前に組み直す。**先に作ると、そのあと入力を
  // 変えても古い結果のまま飛んでいく
  var xb = document.getElementById('sb-x');
  function refreshX() {
    xb.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text()) +
              '&url=' + encodeURIComponent(url());
  }
  refreshX();
  ['click', 'focus', 'pointerdown'].forEach(function (ev) {
    xb.addEventListener(ev, refreshX);
  });
})();
