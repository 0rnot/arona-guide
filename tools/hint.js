/* 「くわしく」の吹き出し。**本文を短くするための道具。**

   画面に出す文は一目で読める長さにして、**理由や但し書きは丸に「i」の中へ**
   しまう（2026-08-31 の先生の指示——「文章校正は文字を最低限にしてね、
   詳しいのは◯内の!アイコンで十分、それすら冗長なのもある」）。

   使い方は 1 行。

       <button type="button" class="qm" data-hint="ここに長い説明"></button>

   **中身は空のまま。**丸の中の「i」は CSS が出す。

   `data-hint` の中は**プレーンテキスト**。`<b>` などは入れない（そのまま出る）。
   出す・消すはこのファイルが受け持つので、ツール側の JS は要らない。

   **中身が短いなら、そもそもこれを使わずに本文から消すこと。**
   丸を押させるのも手間には違いない。 */
(function () {
  'use strict';

  var box = null, owner = null;

  function close() {
    if (!box) return;
    box.hidden = true;
    if (owner) { owner.setAttribute('aria-expanded', 'false'); owner = null; }
  }

  /** 吹き出しを画面の中に収める。**右端で切れるのがいちばん多い壊れ方。** */
  function place(btn) {
    var r = btn.getBoundingClientRect();
    var mw = Math.min(320, window.innerWidth - 24);
    box.style.maxWidth = mw + 'px';
    box.hidden = false;                     // 幅を測るために先に出す
    var w = box.offsetWidth, h = box.offsetHeight;
    var x = r.left + r.width / 2 - w / 2;
    if (x < 12) x = 12;
    if (x + w > window.innerWidth - 12) x = window.innerWidth - 12 - w;
    // 上に置く余地が無ければ下へ
    var y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    box.style.left = Math.round(x + window.pageXOffset) + 'px';
    box.style.top = Math.round(y + window.pageYOffset) + 'px';
  }

  function open(btn) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'qm-pop';
      box.setAttribute('role', 'status');
      box.hidden = true;
      document.body.appendChild(box);
    }
    if (owner === btn) { close(); return; }
    close();
    box.textContent = btn.getAttribute('data-hint') || '';
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    place(btn);
  }

  // **押されたときに探す。**ツールは中身を組み直すので、
  // 起動時にボタンを集めておくやり方だと、あとから増えたぶんに効かない
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.qm') : null;
    if (b) { e.preventDefault(); open(b); return; }
    if (box && !box.hidden && !(box.contains && box.contains(e.target))) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', close);
  /* **スクロールでは閉じない。**吹き出しはページの座標に置いてあるので、
     一緒に動く。閉じる作りにしていたら、`scroll-behavior: smooth` の
     慣性が残っているうちに押したぶんが即座に消えていた（2026-08-31） */

  // 読み上げ用の名前だけ足す。**丸の中の字は CSS の `::before` が出す**
  document.addEventListener('DOMContentLoaded', function () {
    var qs = document.querySelectorAll('.qm');
    for (var i = 0; i < qs.length; i++) {
      if (!qs[i].getAttribute('aria-label')) qs[i].setAttribute('aria-label', 'くわしく');
      qs[i].setAttribute('aria-expanded', 'false');
    }
  });
})();
