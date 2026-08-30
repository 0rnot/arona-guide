/* ページの中の「面」を切り替える。**縦に長いツールを畳むためのもの。**

   2026-08-30 の先生の指示——「各ツール、スクロールが多くなってるツールは
   ツール内でタブ選択できるようにして」。スマホ（390×780）で 11.5 画面ぶん
   あったツールがあり、下のほうの参考表までは誰も届かない。

   **切り替えるのは「結果と参考情報の面」だけ。**入力の板はタブの外に置いたまま
   にする。入力が見えなくなると道具として使えなくなるので、そこは畳まない。

   置き方（HTML 側）——**中身は全部 HTML に置く。JS はそれを隠すだけ。**

     <div class="tfull tpanes" data-panes="cafe">
       <div class="ttabs" role="tablist" aria-label="見るもの" hidden>
         <button type="button" role="tab" id="tb-rank" data-p="rank"
                 aria-controls="pn-rank" aria-selected="true">ランクごとの一覧</button>
         <button type="button" role="tab" id="tb-furn" data-p="furn"
                 aria-controls="pn-furn" aria-selected="false">家具とセット</button>
       </div>
       <div class="tpane" id="pn-rank" data-p="rank" role="tabpanel"
            aria-labelledby="tb-rank" tabindex="0"> … </div>
       <div class="tpane" id="pn-furn" data-p="furn" role="tabpanel"
            aria-labelledby="tb-furn" tabindex="0"> … </div>
     </div>

   **`hidden` を HTML に書かないこと。**書いてしまうと、JS を切った人には
   その面が丸ごと消える。逆に `.ttabs` のほうへ `hidden` を書いておく——
   JS が無ければタブは出ず、面は今までどおり縦に全部並ぶ。

   **既定の面は先頭。**別の面を既定にしたいときは、その `.tpane` に
   `data-def` を付ける。開いた瞬間に空の面が出ないように選ぶこと。

   URL は `#…&pane=<面の名前>` の 1 区画だけを読み書きする。区切りは `&` で、
   **ほかの区画には触らない**（`tools/raid/tl-search.js` の `tls=` と同じ流儀）。
   既定の面のときは区画を書かない——URL を短く保つため。
   ハッシュを `|` 区切りで丸ごと持っているツール（`tools/cost-timeline/tl.js`）
   では区画を足すと相手の最後の欄が壊れるので、`data-nourl` を付けて URL には載せない。 */
(function () {
  'use strict';

  var KEY = 'pane';
  var boxes = [];

  /* ---------- URL の 1 区画 ---------------------------------------- */

  function wanted() {
    var s = location.hash.replace(/^#/, '').split('&');
    for (var i = 0; i < s.length; i++) {
      if (s[i].indexOf(KEY + '=') === 0) return s[i].slice(KEY.length + 1);
    }
    return '';
  }

  /** 渡されたハッシュの `pane=` だけ差し替えたものを返す。ほかの区画は順番ごと残す。 */
  function withPane(hash, id) {
    var s = String(hash || '').replace(/^#/, '').split('&').filter(function (x) {
      return x && x.indexOf(KEY + '=') !== 0;
    });
    if (id) s.push(KEY + '=' + id);
    return s.length ? '#' + s.join('&') : '';
  }

  var mine = '';   // いま URL に載せている面（既定なら空）

  function syncHash() {
    var h = withPane(location.hash, mine);
    try {
      history.replaceState(null, '', location.pathname + location.search + h);
    } catch (e) { /* file:// では黙って諦める */ }
  }

  /* ---------- 1 つぶんの切り替え器 ---------------------------------- */

  function build(box) {
    var tabs = box.querySelector('.ttabs');
    if (!tabs) return null;

    var panes = [];
    for (var i = 0; i < box.children.length; i++) {
      var c = box.children[i];
      if (c.className && String(c.className).split(/\s+/).indexOf('tpane') >= 0) panes.push(c);
    }
    if (panes.length < 2) return null;

    var btns = [].slice.call(tabs.querySelectorAll('button[role="tab"]'));
    var def = panes[0].getAttribute('data-p');
    for (var j = 0; j < panes.length; j++) {
      if (panes[j].hasAttribute('data-def')) def = panes[j].getAttribute('data-p');
    }

    var api = { box: box, tabs: tabs, panes: panes, btns: btns, def: def, now: def,
                url: !box.hasAttribute('data-nourl') };

    /** **画面を動かすのは、指で押されたときだけ。**
        `tools/tour.js` は隠れた面を開くために `pre` のボタンを機械で押すが、
        あちらは自分で位置を合わせ直すので、ここで動かすと喧嘩する
        （合成のクリックは `isTrusted` が false なので見分けられる）。 */
    function keepInView() {
      var bar = document.querySelector('.topbar');
      var off = (bar ? bar.getBoundingClientRect().height : 0) + 14;
      var r = tabs.getBoundingClientRect();
      if (r.top >= off) return;             // もう見えている。動かさない
      window.scrollTo({ top: Math.max(0, r.top + window.pageYOffset - off),
                        behavior: 'smooth' });
    }

    api.show = function (id, opt) {
      var hit = false;
      for (var k = 0; k < panes.length; k++) {
        var on = panes[k].getAttribute('data-p') === id;
        if (on) hit = true;
        panes[k].hidden = !on;
      }
      if (!hit) return false;
      for (var m = 0; m < btns.length; m++) {
        var b = btns[m], sel = b.getAttribute('data-p') === id;
        b.setAttribute('aria-selected', sel ? 'true' : 'false');
        /* **タブ列の中では Tab キーを 1 回しか使わない。**選んでいるものだけを
           順路に残して、左右キーで移る（WAI-ARIA の tablist の作法） */
        b.tabIndex = sel ? 0 : -1;
      }
      api.now = id;
      if (api.url) { mine = (id === api.def) ? '' : id; syncHash(); }
      if (opt && opt.focus) {
        for (var n = 0; n < btns.length; n++) {
          if (btns[n].getAttribute('data-p') === id) btns[n].focus();
        }
      }
      if (opt && opt.scroll) keepInView();
      return true;
    };

    tabs.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[role="tab"]') : null;
      if (!b || !tabs.contains(b)) return;
      api.show(b.getAttribute('data-p'), { scroll: ev.isTrusted });
    });

    tabs.addEventListener('keydown', function (ev) {
      var k = ev.key, at = btns.indexOf(document.activeElement);
      if (at < 0) return;
      var to = -1;
      if (k === 'ArrowRight' || k === 'ArrowDown') to = (at + 1) % btns.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') to = (at - 1 + btns.length) % btns.length;
      else if (k === 'Home') to = 0;
      else if (k === 'End') to = btns.length - 1;
      if (to < 0) return;
      ev.preventDefault();
      api.show(btns[to].getAttribute('data-p'), { focus: true, scroll: true });
    });

    tabs.hidden = false;      // ここではじめてタブが出る（JS が無ければ出ない）
    return api;
  }

  var all = document.querySelectorAll('[data-panes]');
  for (var i = 0; i < all.length; i++) {
    var api = build(all[i]);
    if (api) boxes.push(api);
  }
  if (!boxes.length) return;

  // URL で指した面があればそれを、無ければ既定を開く。**ここでは画面を動かさない。**
  var want = wanted();
  for (var b = 0; b < boxes.length; b++) {
    if (!(want && boxes[b].show(want))) boxes[b].show(boxes[b].def);
  }

  /* ---------- 外から使える口 ---------------------------------------- */

  /** その要素が入っている面を出す。**面をまたぐ操作から呼ぶためのもの。**
      例: `tools/raid-calendar/cal.js` は「ボス」の面で押されたボスで
      「開催の記録」の面を絞るので、記録の面へ移してから送る。 */
  window.showPane = function (t) {
    var e = (typeof t === 'string') ? document.querySelector(t) : t;
    for (; e && e !== document.body; e = e.parentElement) {
      if (!e.classList || !e.classList.contains('tpane')) continue;
      for (var k = 0; k < boxes.length; k++) {
        if (boxes[k].box.contains(e)) return boxes[k].show(e.getAttribute('data-p'));
      }
    }
    return false;
  };

  /* **ほかのツールがハッシュを丸ごと書き換えたら、区画を入れ直す。**
     `location.replace('#…')` で作り直すツール（`tools/equip-level/`）があり、
     そのままだと入力を触った瞬間に面の指定が消える。
     `history.replaceState` は `hashchange` を出さないので拾えないが、
     そちらは下の `shareUrl` の包み込みで埋める。 */
  addEventListener('hashchange', function () {
    var w = wanted();
    if (!w) { if (mine) syncHash(); return; }
    for (var k = 0; k < boxes.length; k++) {
      if (boxes[k].url && boxes[k].now !== w) boxes[k].show(w);
    }
  });

  /* **共有 URL にも面を載せる。**`../share.js` は押された時点で
     `window.shareUrl()` を呼ぶ。ツール側の関数はハッシュを自分の区画だけで
     組み直すので、そこに面を足し直す。**ツールの script はこのファイルより
     後ろで読まれる**ので、包むのは組み上がってから。 */
  addEventListener('DOMContentLoaded', function () {
    var used = null;
    for (var k = 0; k < boxes.length; k++) if (boxes[k].url) used = boxes[k];
    if (!used) return;
    var prev = window.shareUrl;
    window.shareUrl = function () {
      var h = '';
      try { h = prev ? prev() : location.hash; } catch (e) { h = location.hash; }
      return withPane(h, used.now === used.def ? '' : used.now);
    };
  });
})();
