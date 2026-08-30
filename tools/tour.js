/* はじめて開いたときの案内。**15 個のツールで同じものを使う。**

   各ツールが用意するのは `window.TOUR`（下の形）だけで、進める仕掛け・
   保存・見た目はここが持つ。**先生の指示（2026-08-30）で、スキップは必須。**

     window.TOUR = {
       key: 'bond',                       // 保存に使う名前。ツールごとに変える
       steps: [
         { sel: '#stucard', t: '見出し', d: '説明' },   // sel が無ければ画面の真ん中
         { sel: '#gears', pre: '#tab button[data-v="gear"]', t: '…', d: '…' },
                                            // pre = 目印が隠れているとき先に押すもの
         ...
       ]
     };

   **一度でも閉じたら二度と自動では出ない。**`localStorage` に印を置く。
   もう一度見たいときは見出しの下の「使い方」から。 */
(function () {
  'use strict';
  var T = window.TOUR;
  if (!T || !T.steps || !T.steps.length) return;

  var KEY = 'arona-tour-' + (T.key || location.pathname);
  var i = 0, open = false, target = null;

  var root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'このツールの使い方');
  root.hidden = true;
  root.innerHTML =
    '<div class="tour-veil"></div>' +
    '<div class="tour-ring" aria-hidden="true"></div>' +
    '<div class="tour-card">' +
      '<p class="tour-step"><span id="tour-no"></span></p>' +
      '<h2 class="tour-t" id="tour-t"></h2>' +
      '<p class="tour-d" id="tour-d"></p>' +
      '<div class="tour-btns">' +
        '<button type="button" class="btn" id="tour-skip">スキップ</button>' +
        '<span class="tour-sp"></span>' +
        '<button type="button" class="btn" id="tour-prev">戻る</button>' +
        '<button type="button" class="btn tone" id="tour-next">次へ</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);

  var veil = root.querySelector('.tour-veil');
  var ring = root.querySelector('.tour-ring');
  var card = root.querySelector('.tour-card');

  /** **枠と札を、いま見えている位置に合わせる。**ここでは画面を動かさない。
      動かすのは `place()` だけで、こちらはスクロールのたびに呼び直される
      （2026-08-30 の先生の指摘——「開いてすぐスクロールするとずれる」。
      枠は `position: fixed` なので、頁が動いた瞬間に目印から離れる。
      スマホでは `body { overflow: hidden }` が指の操作を止めきれない）。 */
  function position(snap) {
    if (!target) return;
    /* **指で動かしているあいだは滑らかにしない。**枠には 0.18 秒の遷移が
       掛かっていて、そのままだとスクロール中ずっと目印に遅れて付いてくる。
       段が変わったときだけ滑らかに動かす */
    ring.style.transition = snap ? 'none' : '';
    var r = target.getBoundingClientRect();
    var pad = 8;
    ring.style.display = '';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.left = (r.left - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px';
    ring.style.height = (r.height + pad * 2) + 'px';

    // **札は枠の下に。**下に入らないときだけ上へ回す。
    // 高さは `getBoundingClientRect` で測る——`offsetHeight` は組み上がる前に
    // 0 を返すことがあって、そのとき札が画面の下にはみ出す（2026-08-30）
    var cr = card.getBoundingClientRect();
    var ch = cr.height || 190, cw = cr.width || 320;
    var below = r.bottom + 14;
    var top = (below + ch + 12 <= innerHeight) ? below : (r.top - ch - 14);
    // **どう転んでも画面の中に収める。**枠が画面いっぱいのときは上に重ねる
    top = Math.min(Math.max(12, top), Math.max(12, innerHeight - ch - 12));
    card.style.top = top + 'px';
    card.style.left = Math.min(Math.max(12, r.left), Math.max(12, innerWidth - cw - 12)) + 'px';
  }

  /** **見えている箱を持っているか。**`hidden` の面の中にある目印や、
      中身がまだ空の入れ物は `getBoundingClientRect` が 0×0 を返す。
      そのまま枠を描くと、画面の左上に潰れた点が出るだけになる
      （2026-08-30、先生から「これの位置おかしい」と画像で指摘された。
      愛用品と固有武器の段が、切り替えていない面の中にあった）。 */
  function boxed(e) {
    if (!e) return false;
    /* **畳んである `<details>` の中は「大きさがある」ように見える。**
       Chromium は閉じた `<details>` の中身を `content-visibility` で隠すので、
       `getBoundingClientRect()` が最後に組んだときの大きさを返し続ける
       （2026-08-30 に実測。閉じたままの `#bosses` が 294×2274 を返していた）。
       閉じた親がいないかを自分で見る。 */
    for (var n = e; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.open) return false;
      if (n.hidden) return false;
    }
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** 目印に箱が無いとき、**それを含んでいるいちばん近い箱**まで登る。
      画面の 8 割を超えるほど大きくなったら、そこは「どこを指すでもない」ので諦める。 */
  function nearest(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      if (!boxed(n)) continue;
      if (n.getBoundingClientRect().height > innerHeight * 0.8) return null;
      return n;
    }
    return null;
  }

  /** 目印まで画面を動かす。**`scroll-behavior: smooth` を一瞬だけ切る。**
      `style.css` が滑らかスクロールを掛けているので、`behavior: 'auto'` を
      渡してもゆっくり動く。その間に位置を読むと、まだ動く前の座標が返る
      （2026-08-30 に画素を読んで見つけた）。 */
  function bring() {
    if (!target) return;
    var he = document.documentElement, keep = he.style.scrollBehavior;
    /* **`body { overflow: hidden }` を一瞬だけ外す。**案内を開いているあいだ
       背景を動かさないために掛けているものだが、body の overflow は viewport に
       伝播するので、掛かったままだと `scrollIntoView` が 1px も動かない
       （2026-08-30、`tools/raid/` のおまけを開いた段で目印が y=903 に
        取り残されて見つけた。手で `scrollIntoView` を呼んでも動かなかった）。 */
    var on = document.body.classList.contains('tour-on');
    if (on) document.body.classList.remove('tour-on');
    he.style.scrollBehavior = 'auto';
    target.scrollIntoView({ block: 'center' });
    he.style.scrollBehavior = keep;
    if (on) document.body.classList.add('tour-on');
  }

  function place() {
    var s = T.steps[i], opened = false;
    target = s.sel ? document.querySelector(s.sel) : null;
    /* **段が「先に押しておくボタン」を持っていたら押す。**
       切り替え式の面（`tools/gear-stats/` の装備／愛用品／固有武器）や
       畳んである面（`tools/raid/` のおまけ）は、押さないと中身に箱が無い */
    if (target && s.pre) {
      var pre = document.querySelector(s.pre);
      /* **`<summary>` は押すと切り替わる。**押しっぱなしにできないので、
         畳んである面は `open` を立てる。二度呼んでも閉じない
         （押す形だと、同じ段をもう一度描いたときに閉じてしまう） */
      if (pre && pre.tagName === 'SUMMARY' && pre.parentElement) {
        if (!pre.parentElement.open) { pre.parentElement.open = true; opened = true; }
      } else if (pre && !boxed(target)) {
        pre.click(); opened = true;
      }
    }
    if (target && !boxed(target)) target = nearest(target);
    if (!target) {
      root.classList.add('nospot');
      ring.style.display = 'none';
      card.style.top = ''; card.style.left = '';
      card.classList.add('mid');
      return;
    }
    root.classList.remove('nospot');
    card.classList.remove('mid');
    bring();
    position();
    /* **指で動かしている途中に開くと、1 回測っただけでは合わない。**
       慣性が残っていると `scrollIntoView` の直後に読んだ座標が古い。
       次の描画と、少し置いてからもう一度合わせ直す。
       **`pre` で面を開いたときは、動かし直しもやる。**開いたぶんの高さが
       まだ反映されていない状態で測ると、目印が画面の外に置き去りになる
       （2026-08-30、`tools/raid/` のおまけを畳んだときに踏んだ）。 */
    requestAnimationFrame(function () { if (opened) bring(); position(); });
    setTimeout(function () { if (opened) bring(); position(); }, 140);
  }

  function draw() {
    var s = T.steps[i];
    document.getElementById('tour-no').textContent = (i + 1) + ' / ' + T.steps.length;
    document.getElementById('tour-t').textContent = s.t || '';
    document.getElementById('tour-d').textContent = s.d || '';
    document.getElementById('tour-prev').hidden = i === 0;
    document.getElementById('tour-next').textContent = i === T.steps.length - 1 ? '終わり' : '次へ';
    place();
  }

  function show() {
    if (open) return;
    open = true; i = 0; root.hidden = false;
    document.body.classList.add('tour-on');
    draw();
    document.getElementById('tour-next').focus();
  }
  function hide() {
    if (!open) return;
    open = false; root.hidden = true;
    document.body.classList.remove('tour-on');
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* 保存できなくても案内は出す */ }
  }

  document.getElementById('tour-skip').addEventListener('click', hide);
  veil.addEventListener('click', hide);
  document.getElementById('tour-prev').addEventListener('click', function () {
    if (i > 0) { i--; draw(); }
  });
  document.getElementById('tour-next').addEventListener('click', function () {
    if (i < T.steps.length - 1) { i++; draw(); } else { hide(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape') hide();
    else if (e.key === 'ArrowRight') document.getElementById('tour-next').click();
    else if (e.key === 'ArrowLeft') document.getElementById('tour-prev').click();
  });
  addEventListener('resize', function () { if (open) place(); });
  /* **スクロールしたら枠だけ追う。**ここで `place()` を呼ぶと `scrollIntoView` が
     指の操作と喧嘩するので、動かさずに位置だけ合わせる。
     `capture: true` なのは、`.tscroll` のような中の箱が動いたときも拾うため */
  addEventListener('scroll', function () { if (open) position(true); }, { passive: true, capture: true });

  // 見出しの下に「使い方」を出す。**何度でも開ける入口。**
  var body = document.querySelector('.thero-body');
  if (body) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn tour-open'; b.textContent = '使い方を見る';
    b.addEventListener('click', show);
    body.appendChild(b);
  }

  var seen = false;
  try { seen = !!localStorage.getItem(KEY); } catch (e) { seen = false; }
  if (!seen) setTimeout(show, 500);   // 画面が組み上がってから
})();
