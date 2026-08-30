/* TL の保管庫と検索。

   **このファイルは 1 枚で完結させてある。**置き場を変えても、
   `<div id="tlsearch-root"></div>` を 1 つ置いて

       TLSEARCH_MOUNT(document.getElementById('tlsearch-root'));

   と呼べば、その中に画面がぜんぶ組み上がる。外側が `.tcols` でも
   `.panel` でも、何にも入っていなくても動く。中で使っている
   `.panel` / `.field` / `.btn` / `.seg` / `.stat` / `.note-box` / `.tag` は
   `tools/tool.css` のもので、ツールのページなら必ず読まれている。
   このファイル専用の見た目は **すべて `.tls-` で始まる**ので、
   `<style>` のひとかたまりごと移せる。

   ---------------------------------------------------------------
   何をするツールか

   **TL そのものはどこにも投稿できない。**このサイトは GitHub Pages の
   静的配信で、サーバーもデータベースも無い。他人の投稿を集める作りには
   できないし、**中身の分からない TL を勝手に載せることもしない。**
   そこで、できることを 2 つに絞った。

   ① **自分の TL を溜めて引く。**コスト計算機（`tools/cost-timeline/`）は
      編成と撃つ順番を URL のハッシュに全部入れる。そのハッシュに
      ボス・難易度・地形・タイム・メモを付けて `localStorage` に置き、
      あとからボスや使った生徒で絞り込んで、コスト計算機に戻せるようにする。
   ② **よそへ条件ごと飛ばす。**選んだ条件から、TL 動画を集めている
      よそのサイトと YouTube の検索 URL を組み立てる。**外部であることは明示する。**
      **ここは補助。**畳んだ面に入れてあり、ページの主役にはしない
      （2026-08-30 の先生の指示——「サイト内で完結させたい」）。

   ---------------------------------------------------------------
   相手はページのボス選択が持つ

   2026-08-30 に、ボス・地形・難易度・種類の選択を**ページの先頭のボス選択**へ
   一本化した。このファイルはもうボスの `<select>` を持たない。外から

       var api = TLSEARCH_MOUNT(root);
       api.bindPicker(window.RAID_PICKER);

   と渡してもらい、以後は選ばれている相手を

       P.get()  → { kind, b, tr, d }        // b は 'b4' / 'm1000000'
       P.set(o) // 黙って選び直す（通知しない）
       P.on(fn) // 選び直されたら fn(state)

   でやりとりする。**ピッカーが無くても落ちない。**そのときは保管庫の
   絞り込みが効かないだけで、保存も検索も動く。

   ---------------------------------------------------------------
   読むデータ

   `window.RAID`（`tools/raid/data.js`）だけ。ボス 14 体・制約解除決戦 6 体・
   生徒 274 人の名前・装甲と難易度の日本語が 1 ファイルに入っている。
   **移植先が `tools/raid/` なら、あちらが既に読んでいるので追加の読み込みは 0。** */
(function () {
  'use strict';

  /* ---------- 保存の名前 ---------------------------------------- */
  var KEY  = 'arona-tl-vault';        // この保管庫
  var CKEY = 'arona-cost-timeline';   // コスト計算機が置いている盤面
  var HK   = 'tls';                   // URL のハッシュにこの名前で載せる

  /* ---------- コスト計算機のハッシュ ------------------------------

     形は `tools/cost-timeline/tl.js` の `toHash()` / `fromHash()` にある。

         #6|10001.5.10,_,…|0,2@12.5|0/10/0/0
         モード | 編成 | 撃つ順番 | 開始・上限・ステージ補正

     編成は枠の順に `,` 区切りで、空き枠は `_`。1 枠は
     `id.EXレベル.通常スキルレベル[.愛用品.固有スキル[.固有武器レベル]]`。
     **枠は常に「ストライカー 6 枠 → スペシャル 4 枠」の固定長**で、
     モードによって後ろが使われないだけ（通常編成は 4＋2、制約解除決戦は 6＋4）。 */
  var MAIN_MAX = 6, SUP_MAX = 4;
  var LAYOUT = { 6: { main: 4, sup: 2 }, 10: { main: 6, sup: 4 } };

  function liveSlot(i, mode) {
    var l = LAYOUT[mode] || LAYOUT[6];
    return i < MAIN_MAX ? i < l.main : (i - MAIN_MAX) < l.sup;
  }

  /* ---------- 小物 ---------------------------------------------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function nowId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function ymd(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* =============================================================== */
  window.TLSEARCH_MOUNT = function (root) {
    if (!root) return null;
    var R = window.RAID;
    if (!R || !R.bosses || !R.students) {
      root.innerHTML = '<div class="note-box"><b>ボスと生徒のデータが読めませんでした。</b>' +
        'このページで <code>tools/raid/data.js</code> が読み込まれているか確かめてください。</div>';
      return null;
    }

    /* ---------- データを引きやすい形に ---------------------------- */
    var TERR = [['Street', '市街地'], ['Outdoor', '屋外'], ['Indoor', '屋内']];
    var terrJa = {}; TERR.forEach(function (x) { terrJa[x[0]] = x[1]; });

    var armJa = R.labels.ArmorType || {};
    var diffJa = R.labels.RaidDifficulty || {};

    /* 総力戦・大決戦の難易度。**SchaleDB の `RaidDifficulty` の並びそのまま。**
       同じ表に大決戦の防御タイプ（A / B / C）も入っているので、Lunatic で切る */
    var DIFFS = (function () {
      var out = [];
      for (var k in diffJa) { out.push(k); if (k === 'Lunatic') break; }
      return out;
    })();
    /* 制約解除決戦の難易度は「階層の区間」。`multi` の `secs` の lo–hi をそのまま使う */
    var MDIFFS = ((R.multi && R.multi[0] && R.multi[0].secs) || []).map(function (s) {
      return s.lo + '-' + s.hi;
    });

    var KIND = [['raid', '総力戦'], ['elim', '大決戦'], ['multi', '制約解除決戦']];
    var kindJa = {}; KIND.forEach(function (x) { kindJa[x[0]] = x[1]; });

    // 大決戦に出たことのあるボス。`RAID.elim` は開催の記録なので、そこから拾える
    var elimIds = {};
    (R.elim || []).forEach(function (e) { elimIds[e.id] = true; });

    var BOSS = [], bossBy = {};
    R.bosses.forEach(function (b) {
      var o = { key: 'b' + b.id, n: b.n, p: b.p, at: b.at,
                kinds: elimIds[b.id] ? { raid: 1, elim: 1 } : { raid: 1 } };
      BOSS.push(o); bossBy[o.key] = o;
    });
    (R.multi || []).forEach(function (b) {
      var o = { key: 'm' + b.id, n: b.n + '（' + (armJa[b.at] || b.at) + '）',
                p: b.p, at: b.at, kinds: { multi: 1 } };
      BOSS.push(o); bossBy[o.key] = o;
    });

    var stuBy = {};
    R.students.forEach(function (s) { stuBy[s.id] = s; });
    var stuSorted = R.students.slice().sort(function (a, b) {
      return a.n.localeCompare(b.n, 'ja');
    });

    /* ボスの絵。**`boss_<p>.webp` は 20 体ぶん全部そろっている**（`bossicon_` は
       ドラム缶ガニと制約解除決戦のぶんが無く、404 になる）。ボス選択と同じ絵 */
    function bossImg(p) { return '../img/boss_' + p + '.webp'; }
    function face(id) { return '../img/student_' + id + '.webp'; }

    /** 難易度の合言葉を日本語に。制約解除決戦は `1-24` のような階層の区間 */
    function diffLabel(d) {
      if (!d) return '';
      if (MDIFFS.indexOf(d) >= 0) return d.replace('-', '〜') + 'F';
      return diffJa[d] || d;
    }

    /* ---------- いま選ばれている相手 ------------------------------
       ページ先頭のボス選択が正。ここは写しを持っているだけ。 */
    var picker = null;
    var pk = { kind: 'raid', b: '', tr: '', d: '' };   // ピッカーの写し
    var useTgt = false;                                // 保管庫を相手で絞るか

    /* ---------- 保管庫の中身 -------------------------------------- */
    var items = [];
    function load() {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.items)) {
          items = d.items.filter(function (x) { return x && typeof x.h === 'string' && x.h; });
        }
      } catch (e) { items = []; }
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items: items })); return true; }
      catch (e) { say('保存できませんでした。ブラウザの保存領域がいっぱいかもしれません'); return false; }
    }

    /* ---------- ハッシュを読む ------------------------------------ */
    /** 貼られたものからコスト計算機のハッシュを取り出して、中身を数える。
        **読めなければ null。**保存させないための番人でもある。 */
    function readTL(src) {
      var h = String(src || '').trim();
      if (!h) return null;
      var at = h.indexOf('#');
      if (at >= 0) h = h.slice(at + 1);
      h = h.replace(/\s+/g, '');
      if (!h) return null;
      var p = h.split('|');
      if (p.length < 3) return null;
      var mode = +p[0] === 10 ? 10 : (+p[0] === 6 ? 6 : 0);
      if (!mode) return null;
      var raw = p[1].split(',');
      var main = [], sup = [], known = 0, unknown = 0;
      for (var i = 0; i < MAIN_MAX + SUP_MAX; i++) {
        var x = raw[i];
        if (!x || x === '_') continue;
        if (!liveSlot(i, mode)) continue;
        var id = +String(x).split('.')[0];
        if (!id) continue;
        if (stuBy[id]) { known++; (i < MAIN_MAX ? main : sup).push(id); }
        else { unknown++; }
      }
      var ex = p[2] ? p[2].split(',').filter(function (y) { return y !== ''; }).length : 0;
      if (!known && !ex) return null;
      return { mode: mode, main: main, sup: sup, ids: main.concat(sup),
               ex: ex, unknown: unknown, hash: h };
    }

    /** コスト計算機が端末に置いている盤面（`arona-cost-timeline`）を、
        そのままハッシュに直す。**`tl.js` の `toHash()` と同じ組み方をなぞっている。**

        **ここだけは向こうの形に貼り付いている。**あちらは「4 つ目の区画は後ろに
        足すだけ」と決めてあるので、こちらが知らない欄が増えても読む側は困らないが、
        **増えた欄は落ちる。**そのため画面では「取りこぼしなく写したいなら URL を貼る」
        と案内している。組んだものは必ず `readTL()` に通してから使う。
        （2026-08-30 時点の `toHash()`：枠は `id.ex.sk[.段.チェック[.固有[.1]]]`、
        4 つ目は `開始 / 上限 / 地形 / 装甲 / 目標 / ギミック / オーバーコスト`） */
    function pullFromTimeline() {
      var raw = null;
      try { raw = localStorage.getItem(CKEY); } catch (e) { return null; }
      if (!raw) return null;
      var d = null;
      try { d = JSON.parse(raw); } catch (e) { return null; }
      if (!d || !Array.isArray(d.s)) return null;

      function n1x(v) { return String(Math.round(v * 10) / 10); }
      var ps = d.s.map(function (s) {
        if (!s || !s.id) return '_';
        var t = Object.keys(s.tier || {}).map(function (k) { return k + ':' + s.tier[k]; }).join('!');
        var o = Object.keys(s.on || {}).filter(function (k) { return s.on[k]; }).join('!');
        var tail = (t || o || s.wp || s.w4 ? '.' + t + '.' + o : '') +
                   (s.wp || s.w4 ? '.' + (s.wp || 0) : '') + (s.w4 ? '.1' : '');
        return s.id + '.' + (s.ex || 5) + '.' + (s.sk || 10) + tail;
      }).join(',');

      var ord = Array.isArray(d.o) ? d.o : [];
      var os = ord.map(function (e) {
        return (e.t == null ? String(e.i) : e.i + '@' + e.t) + (e.to == null ? '' : '>' + e.to);
      }).join(',');

      var gk = (Array.isArray(d.gk) ? d.gk : []).map(function (g) {
        return n1x(g.t) + ':' + g.v + ':' + n1x(g.du);
      }).join('!');
      var ov = ord.map(function (e, j) { return e.ov == null ? '' : j + ':' + e.ov; })
                  .filter(Boolean).join('!');
      function g(v) { return v == null ? '' : String(v); }
      var tail = [g(d.st), g(d.cp), g(d.gb), g(d.gc),
                  d.gl == null || d.gl === '' ? '' : n1x(d.gl), gk, ov];
      while (tail.length && tail[tail.length - 1] === '') tail.pop();

      return (d.m === 10 ? 10 : 6) + '|' + ps + '|' + os + '|' + tail.join('/');
    }

    /* ---------- 画面を組む ---------------------------------------- */
    function diffFilterOpts() {
      return '<optgroup label="総力戦・大決戦">' + DIFFS.map(function (d) {
        return '<option value="' + esc(d) + '">' + esc(diffJa[d] || d) + '</option>';
      }).join('') + '</optgroup>' +
      '<optgroup label="制約解除決戦">' + MDIFFS.map(function (d) {
        return '<option value="' + esc(d) + '">' + esc(d.replace('-', '〜')) + 'F</option>';
      }).join('') + '</optgroup>';
    }

    root.innerHTML =
      /* ============ ① 選んだ相手の TL（このページの主役） ============ */
      '<div class="panel" id="tls-vault">' +
        '<div class="panel-h"><h2 id="tls-vault-h">保管庫の TL</h2>' +
          '<span class="tls-count" id="tls-count">—</span></div>' +

        '<div class="note-box tls-honest">' +
          '<p><b>TL そのものは、まだこのサイトに集めていません。</b>ここに出るのは、' +
            '<b>あなたがこの端末に保存した TL だけ</b>です。' +
            'このサイトは GitHub Pages の静的配信で、サーバーもデータベースもありません。' +
            '他人の投稿を受け取る仕組みが作れないので、<b>中身の分からない TL を並べることはしません。</b></p>' +
          '<p>他の人の TL を見たいときは、いちばん下の<b>「よそのサイトでも探す」</b>を開いてください。' +
            '上で選んでいる相手を、そのまま先方の検索条件に組み立てて渡します。</p>' +
        '</div>' +

        '<label class="tls-scope" id="tls-scope">' +
          '<input type="checkbox" id="tls-scope-on">' +
          '<span id="tls-scope-tx">上で選んだ相手で絞る</span>' +
        '</label>' +

        '<div class="fields c3 tls-more-f">' +
          '<div class="field"><label for="tls-f-diff">難易度でさらに絞る</label>' +
            '<select id="tls-f-diff"><option value="">ぜんぶ</option>' + diffFilterOpts() + '</select></div>' +
          '<div class="field"><label for="tls-f-stu">使っている生徒</label>' +
            '<select id="tls-f-stu"><option value="">ぜんぶ</option>' +
              stuSorted.map(function (s) {
                return '<option value="' + s.id + '">' + esc(s.n) + '</option>';
              }).join('') + '</select></div>' +
          '<div class="field"><label for="tls-f-q">名前とメモから探す</label>' +
            '<input id="tls-f-q" type="search" autocomplete="off" placeholder="削り、2部隊目、Torment…"></div>' +
        '</div>' +
        '<div class="btnrow" style="margin:14px 0">' +
          '<button type="button" class="btn" id="tls-clear">絞り込みを外す</button>' +
          '<button type="button" class="btn" id="tls-export">書き出す（JSON）</button>' +
          '<button type="button" class="btn" id="tls-import">読み込む（JSON）</button>' +
          '<input type="file" id="tls-file" accept="application/json,.json" hidden>' +
        '</div>' +
        '<div id="tls-list"></div>' +
      '</div>' +

      /* ============ ② 保管庫に貯める ============ */
      '<div class="panel" id="tls-add">' +
        '<div class="panel-h"><h2>この相手の TL を保管庫に入れる</h2></div>' +
        '<p class="lead"><b>コスト計算機で組んだ TL の URL を貼ってください。</b>' +
          '<a href="../cost-timeline/">TL のコスト計算機</a>は編成と撃つ順番をぜんぶ URL に入れるので、' +
          'この 1 本さえ控えておけば、あとから同じ盤面を開き直せます。' +
          '<b>保存先の相手は、上で選んでいるものになります。</b></p>' +
        '<div class="tls-tgt" id="tls-tgt"></div>' +
        '<div class="btnrow" style="margin-bottom:12px">' +
          '<button type="button" class="btn" id="tls-pull">いまコスト計算機で開いている TL を取り込む</button>' +
        '</div>' +
        '<p class="lead" style="margin-top:-4px"><b>取りこぼしなく写したいときは URL を貼ってください。</b>' +
          'このボタンは同じブラウザに残っている盤面から組み直しているので、' +
          'コスト計算機に新しい項目が増えた直後は、その項目が落ちることがあります。</p>' +
        '<div class="field">' +
          '<label for="tls-hash">コスト計算機の URL、または <code>#</code> のあとの部分</label>' +
          '<textarea class="tls-paste" id="tls-hash" spellcheck="false" ' +
            'placeholder="https://arona-bot.com/tools/cost-timeline/#6|10008.5.10,…"></textarea>' +
        '</div>' +
        '<div class="tls-prev bad" id="tls-prev"></div>' +
        '<div class="fields c2" style="margin-top:14px">' +
          '<div class="field"><label for="tls-name">この TL の名前</label>' +
            '<input id="tls-name" type="text" autocomplete="off" placeholder="空ならボス名で付けます"></div>' +
          '<div class="field"><label for="tls-time">タイム・スコアなど</label>' +
            '<input id="tls-time" type="text" autocomplete="off" placeholder="2:31 / 2,300 万 など"></div>' +
        '</div>' +
        '<div class="field"><label for="tls-memo">メモ</label>' +
          '<textarea class="tls-paste" id="tls-memo" ' +
            'placeholder="開始スキルの並び、削り役、詰まりやすいところ…"></textarea></div>' +
        '<div class="btnrow" style="margin-top:14px">' +
          '<button type="button" class="btn pri" id="tls-save">保管庫に入れる</button>' +
          '<button type="button" class="btn" id="tls-cancel" hidden>直すのをやめる</button>' +
        '</div>' +
      '</div>' +

      /* ============ ③ 保管庫のようす ============ */
      '<div class="stats c3" id="tls-stats">' +
        '<div class="stat hero"><div class="k">保管庫の TL</div>' +
          '<div class="v" id="tls-o-n">—</div><div class="sub" id="tls-o-n-sub">まだ 1 本もありません</div></div>' +
        '<div class="stat"><div class="k">ボスの種類</div>' +
          '<div class="v" id="tls-o-b">—</div><div class="sub" id="tls-o-b-sub"></div></div>' +
        '<div class="stat"><div class="k">いちばん多い生徒</div>' +
          '<div class="v" id="tls-o-s">—</div><div class="sub" id="tls-o-s-sub"></div></div>' +
      '</div>' +

      /* ============ ④ よそのサイト（補助。畳んである） ============ */
      '<details class="tls-more" id="tls-ext-wrap">' +
        '<summary>よそのサイトでも探す' +
          '<small>他の人が作った TL は、当サイトの外にあります。上で選んでいる相手を検索条件にして渡します。</small>' +
        '</summary>' +
        '<div class="tls-more-b" id="tls-ext">' +
          '<p class="tls-empty" style="margin-bottom:12px"><b>ここから先は外部のサイトです。</b>' +
            '中身の正しさや掲載の可否は、それぞれの運営者に帰属します。' +
            '<b>当サイトが他人の TL を持っているわけではありません。</b></p>' +
          '<div class="tls-exts" id="tls-exts"></div>' +
        '</div>' +
      '</details>';

    var q = function (id) { return root.querySelector('#' + id); };

    /* ---------- 帯 ------------------------------------------------ */
    var toast = document.getElementById('toast-page'), tmr = null;
    function say(t) {
      if (!toast) return;
      toast.textContent = t; toast.classList.add('shown');
      clearTimeout(tmr); tmr = setTimeout(function () { toast.classList.remove('shown'); }, 2200);
    }

    /* ---------- 取り込み欄 ---------------------------------------- */
    var editing = null;   // 直している最中の id

    function facesHtml(tl) {
      var main = tl.main.map(function (id) { return faceHtml(id, false); }).join('');
      var sup = tl.sup.map(function (id) { return faceHtml(id, true); }).join('');
      return '<div class="tls-faces">' + main + sup + '</div>';
    }
    function faceHtml(id, isSup) {
      var s = stuBy[id];
      if (!s) return '';
      return '<span class="tls-face' + (isSup ? ' sup' : '') + '">' +
        '<img src="' + face(id) + '" alt="" width="52" height="52" loading="lazy" title="' +
        esc(s.n) + '"><span>' + esc(s.n) + '</span></span>';
    }

    function drawPrev() {
      var box = q('tls-prev');
      var tl = readTL(q('tls-hash').value);
      if (!tl) {
        box.className = 'tls-prev bad';
        box.innerHTML = '<p class="ph">' +
          (q('tls-hash').value.trim()
            ? '<b>読めませんでした。</b>コスト計算機の URL を、<code>#</code> のあとまで含めて貼ってください。'
            : 'ここに、貼った TL の編成と EX の本数が出ます。<b>読めたものだけ保管庫に入ります。</b>') +
          '</p>';
        return null;
      }
      box.className = 'tls-prev';
      box.innerHTML = '<p class="hd"><b>' +
        (tl.mode === 10 ? '制約解除決戦の編成（10 人）' : '通常の編成（6 人）') + '</b>' +
        '<span>生徒 ' + tl.ids.length + ' 人／EX ' + tl.ex + ' 本' +
        (tl.unknown ? '／読めなかった枠 ' + tl.unknown : '') + '</span></p>' +
        (tl.ids.length ? facesHtml(tl) : '<p class="ph">枠が空のままです。</p>');
      return tl;
    }

    /** 「保存先の相手」の帯。**上のボス選択の写しをそのまま見せる。** */
    function drawTgt() {
      var b = bossBy[pk.b];
      if (!b) {
        q('tls-tgt').innerHTML = '<p class="ph">ページの上でボスを選ぶと、ここに保存先が出ます。</p>';
        return;
      }
      var bits = [kindJa[pk.kind] || '総力戦'];
      if (pk.tr) bits.push(terrJa[pk.tr] || pk.tr);
      if (pk.d) bits.push(diffLabel(pk.d));
      q('tls-tgt').innerHTML =
        '<img src="' + bossImg(b.p) + '" alt="" width="104" height="32" loading="lazy">' +
        '<span class="tls-tgt-t"><b>' + esc(b.n) + '</b>' +
          '<small>' + esc(bits.join('　')) + '</small></span>' +
        '<span class="tls-tgt-h">上のボス選択で変えられます</span>';
    }

    function fillForm(it) {
      q('tls-hash').value = it ? it.h : '';
      q('tls-name').value = (it && it.t) || '';
      q('tls-time').value = (it && it.tm) || '';
      q('tls-memo').value = (it && it.m) || '';
      q('tls-save').textContent = it ? 'この TL を上書きする' : '保管庫に入れる';
      q('tls-cancel').hidden = !it;
      // **直すときは、上のボス選択もその TL の相手に戻す。**
      // 保存する条件はピッカーから読むので、ここを合わせないと相手が変わってしまう
      if (it && picker && it.b && bossBy[it.b]) {
        picker.set({ kind: it.k || 'raid', b: it.b, tr: it.tr || '', d: it.d || '' });
        pk = picker.get();
      }
      drawTgt();
      drawPrev();
    }

    function autoName() {
      var b = bossBy[pk.b];
      var parts = [];
      if (b) parts.push(b.n);
      if (pk.d) parts.push(diffLabel(pk.d));
      if (!parts.length) parts.push((kindJa[pk.kind] || '総力戦') + ' の TL');
      return parts.join(' ');
    }

    function doSave() {
      var tl = readTL(q('tls-hash').value);
      if (!tl) { say('TL の URL が読めません。コスト計算機の URL を貼ってください'); q('tls-hash').focus(); return; }
      var now = Date.now();
      var rec = {
        id: editing || nowId(),
        t: (q('tls-name').value || '').trim() || autoName(),
        k: kindJa[pk.kind] ? pk.kind : 'raid',
        b: bossBy[pk.b] ? pk.b : '',
        d: pk.d || '',
        tr: terrJa[pk.tr] ? pk.tr : '',
        tm: (q('tls-time').value || '').trim(),
        m: (q('tls-memo').value || '').trim(),
        h: tl.hash,
        c: now, u: now
      };
      if (editing) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === editing) { rec.c = items[i].c || now; items[i] = rec; break; }
        }
      } else {
        items.unshift(rec);
      }
      if (!persist()) return;
      editing = null;
      fillForm(null);
      // **入れたものが見えるところに残るように、相手での絞り込みは掛けたままにする。**
      draw();
      say(rec.t + ' を保管庫に入れました');
    }

    /* ---------- 保管庫の一覧 -------------------------------------- */
    function filters() {
      return { b: useTgt ? pk.b : '', tr: useTgt ? pk.tr : '',
               d: q('tls-f-diff').value,
               s: q('tls-f-stu').value,
               q: (q('tls-f-q').value || '').trim().toLowerCase() };
    }
    function matched() {
      var f = filters();
      return items.filter(function (it) {
        if (f.b && it.b !== f.b) return false;
        if (f.d && it.d !== f.d) return false;
        if (f.tr && it.tr !== f.tr) return false;
        var tl = readTL(it.h);
        if (f.s && (!tl || tl.ids.indexOf(+f.s) < 0)) return false;
        if (f.q) {
          var hay = (it.t || '') + ' ' + (it.m || '') + ' ' + (it.tm || '') + ' ' +
            (bossBy[it.b] ? bossBy[it.b].n : '') + ' ' + diffLabel(it.d) + ' ' +
            (terrJa[it.tr] || '') + ' ' +
            (tl ? tl.ids.map(function (id) { return stuBy[id] ? stuBy[id].n : ''; }).join(' ') : '');
          if (hay.toLowerCase().indexOf(f.q) < 0) return false;
        }
        return true;
      }).sort(function (a, b) { return (b.u || 0) - (a.u || 0); });
    }

    function cardHtml(it) {
      var b = bossBy[it.b], tl = readTL(it.h);
      var tags = [];
      tags.push('<span class="tg hot">' + esc(kindJa[it.k] || '総力戦') + '</span>');
      if (it.d) tags.push('<span class="tg">' + esc(diffLabel(it.d)) + '</span>');
      if (it.tr) tags.push('<span class="tg">' + esc(terrJa[it.tr] || it.tr) + '</span>');
      if (tl) tags.push('<span class="tg">' + (tl.mode === 10 ? '10 人' : '6 人') +
                        '／EX ' + tl.ex + ' 本</span>');
      tags.push('<span class="tg">' + ymd(it.u || it.c || Date.now()) + '</span>');
      return '<article class="tls-tl' + (editing === it.id ? ' edit' : '') +
        '" data-id="' + esc(it.id) + '">' +
        '<div class="tls-tl-h">' +
          (b ? '<img class="tls-tl-bi" src="' + bossImg(b.p) +
               '" alt="" width="104" height="32" loading="lazy">' : '') +
          // **題名にボス名が入っているときは繰り返さない。**自動で付けた名前は
          // 「ボス名 難易度」なので、そのままだと同じ語が 2 度出る
          '<span class="tls-tl-t">' + esc(it.t) +
            (b && it.t.indexOf(b.n) < 0 ? '<small>' + esc(b.n) + '</small>' : '') + '</span>' +
          (it.tm ? '<span class="tls-tl-time">' + esc(it.tm) + '</span>' : '') +
        '</div>' +
        '<div class="tls-tl-tags">' + tags.join('') + '</div>' +
        (tl && tl.ids.length ? facesHtml(tl) : '') +
        (it.m ? '<p class="tls-tl-m">' + esc(it.m) + '</p>' : '') +
        '<div class="btnrow">' +
          '<a class="btn pri" href="../cost-timeline/#' + esc(it.h) + '">コスト計算機で開く</a>' +
          '<button type="button" class="btn" data-a="copy">URL をコピー</button>' +
          '<button type="button" class="btn" data-a="edit">直す</button>' +
          '<button type="button" class="btn" data-a="del">消す</button>' +
        '</div></article>';
    }

    /** 相手の呼び名。「ビナー／屋外」。
        **制約解除決戦のボス名は既に「（弾力装甲）」を抱えている**ので、
        地形まで丸かっこにすると「ティファレト（弾力装甲）（屋内）」になる */
    function tgtName() {
      var b = bossBy[pk.b];
      if (!b) return '';
      return b.n + (pk.tr ? '／' + (terrJa[pk.tr] || pk.tr) : '');
    }

    function draw() {
      var rows = matched();
      var narrowed = useTgt && !!bossBy[pk.b];

      q('tls-vault-h').textContent = narrowed ? tgtName() + 'の TL' : '保管庫の TL';
      q('tls-scope-tx').textContent = bossBy[pk.b]
        ? '上で選んだ ' + tgtName() + ' だけを見る'
        : '上で選んだ相手だけを見る';
      q('tls-scope-on').checked = useTgt;
      q('tls-count').textContent = items.length
        ? rows.length + ' 本 / ' + items.length + ' 本'
        : '0 本';

      q('tls-list').innerHTML = rows.length
        ? rows.map(cardHtml).join('')
        : '<p class="tls-empty">' + (
            !items.length
              ? 'まだ 1 本も入っていません。<b>下の欄にコスト計算機の URL を貼る</b>ところから始めてください。'
              : narrowed
              ? '<b>' + esc(tgtName()) + '</b>の TL はまだ入っていません。' +
                'ほかの相手のぶんも見るときは、上のチェックを外すか<b>「絞り込みを外す」</b>を押してください。'
              : 'その条件に当てはまる TL はありません。<b>「絞り込みを外す」</b>で戻せます。'
          ) + '</p>';

      // 下の 3 つ
      q('tls-o-n').textContent = items.length + ' 本';
      q('tls-o-n-sub').textContent = items.length
        ? (rows.length === items.length ? '絞り込みなし' : 'いまの絞り込みで ' + rows.length + ' 本')
        : 'まだ 1 本もありません';
      var bs = {}; items.forEach(function (it) { if (it.b) bs[it.b] = 1; });
      var bn = Object.keys(bs);
      q('tls-o-b').textContent = bn.length + ' 体';
      q('tls-o-b-sub').textContent = bn.length
        ? bn.slice(0, 3).map(function (k) { return bossBy[k] ? bossBy[k].n : k; }).join('、') +
          (bn.length > 3 ? ' ほか' : '')
        : 'ボスを選んで保存すると出ます';
      var cnt = {};
      items.forEach(function (it) {
        var tl = readTL(it.h);
        if (!tl) return;
        var seen = {};
        tl.ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; cnt[id] = (cnt[id] || 0) + 1; } });
      });
      var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      q('tls-o-s').textContent = top && stuBy[top] ? stuBy[top].n : '—';
      q('tls-o-s-sub').textContent = top ? cnt[top] + ' 本に入っています' : '保存すると出ます';

      drawTgt();
      drawExt();
      syncHash();
    }

    /* ---------- よそのサイトへ ------------------------------------ */
    /* きなこもちさんの「TLサーチ」は GET の検索フォームで、`boss_id` /
       `battle_field_id` / `armor_id` / `difficulty` を受け取る。
       **番号は先方のフォームの `<option value>` をそのまま写した**もので、
       2026-08-30 に実物で確かめている。先方が番号を振り直せば外れる。 */
    var KINA_BOSS = {
      binah: 3, chesed: 6, shirokuro: 9, hieronymus: 10, kaiten: 13, perorodzilla: 16,
      hod: 14, goz: 12, gregorius: 8, hovercraft: 5, kurokage: 1, geburah: 11,
      yesod: 17, drumbarka: 18,
      set_specialarmor: 4, set_lightarmor: 4,
      chokmah_specialarmor: 2, chokmah_heavyarmor: 2,
      tiphareth_elasticarmor: 7, tiphareth_heavyarmor: 7
    };
    var KINA_TERR = { Street: 1, Outdoor: 2, Indoor: 3 };
    var KINA_ARMOR = { ElasticArmor: 1, Unarmed: 2, HeavyArmor: 3, LightArmor: 4, CompositeArmor: 5 };

    /** よそへ渡す条件。**保管庫の絞り込みと違って、こちらは常に
        「上で選んでいる相手」を使う。**チェックを外していても、
        画面に映っている相手を渡すほうが素直（2026-08-30）。 */
    function drawExt() {
      var b = bossBy[pk.b], s = stuBy[q('tls-f-stu').value];
      var d = q('tls-f-diff').value || pk.d;
      var words = ['ブルアカ'];
      if (b) words.push(b.n.replace(/（.*/, ''));
      if (d) words.push(diffLabel(d));
      if (pk.tr) words.push(terrJa[pk.tr]);
      if (s) words.push(s.n.replace(/（.*/, ''));
      words.push('TL');
      var kw = words.join(' ');
      var cond = [];
      if (b) cond.push(b.n);
      if (d) cond.push(diffLabel(d));
      if (pk.tr) cond.push(terrJa[pk.tr]);
      if (s) cond.push(s.n);
      var condTx = cond.length ? cond.join('／') : '条件なし';

      // TLサーチの URL
      var kina = 'https://kina-ko-m-ochi.net/tlsearch/';
      var kq = [];
      if (b && KINA_BOSS[b.p]) kq.push('boss_id=' + KINA_BOSS[b.p]);
      if (pk.tr && KINA_TERR[pk.tr]) kq.push('battle_field_id=' + KINA_TERR[pk.tr]);
      if (b && b.kinds.multi) {
        if (KINA_ARMOR[b.at]) kq.push('armor_id=' + KINA_ARMOR[b.at]);
        // 制約解除決戦の難易度は先方も「階層の区間」で持っている
        if (d && MDIFFS.indexOf(d) >= 0) kq.push('difficulty=' + encodeURIComponent(d));
      }
      var kinaUrl = kina + (kq.length ? '?' + kq.join('&') : '');

      var list = [
        { u: kinaUrl, t: 'TLサーチ（きなこもち）',
          d: kq.length ? 'ボスと地形を URL で渡します — ' + condTx
                       : '有志が集めた TL 動画のデータベース。ボスを選ぶと絞って渡せます' },
        { u: 'https://bluearchive.tools/tl/search', t: 'BlueArchive Tools の TL 検索',
          d: '利用者が投稿した TL をシーズンごとに見られます。条件は先方の画面で選んでください' },
        { u: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(kw),
          t: 'YouTube で探す', d: '検索語「' + kw + '」' },
        { u: 'https://x.com/search?q=' + encodeURIComponent(kw) + '&f=live',
          t: 'X で探す', d: '検索語「' + kw + '」' }
      ];
      q('tls-exts').innerHTML = list.map(function (x) {
        return '<a class="tls-ext" href="' + esc(x.u) + '" target="_blank" rel="noopener noreferrer">' +
          '<b>' + esc(x.t) + '</b><small>' + esc(x.d) + '</small></a>';
      }).join('');
    }

    /* ---------- URL のハッシュ ------------------------------------ */
    /* **`tls=` を付けて載せる。**同じページに別のツールの状態が同居しても
       ぶつからないように、`&` で区切った 1 区画だけを読み書きする。
       **並びは `ボス~難易度~地形~生徒~語句` の 5 つで、`#tls=b4~~Indoor~~` の形は
       2026-08-30 の作り直しでも変えていない**（他のページから飛んでくる入口）。 */
    function hash() {
      var f = filters();
      return HK + '=' + [f.b, f.d, f.tr, f.s, encodeURIComponent(f.q)].join('~');
    }
    function syncHash() {
      var f = filters();
      var mine = (f.b || f.d || f.tr || f.s || f.q) ? hash() : '';
      var parts = location.hash.replace(/^#/, '').split('&').filter(function (x) {
        return x && x.indexOf(HK + '=') !== 0;
      });
      if (mine) parts.push(mine);
      var h = parts.join('&');
      try {
        history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
      } catch (e) { /* file:// などで転んでも画面は動かす */ }
    }
    function fromHash() {
      var seg = location.hash.replace(/^#/, '').split('&').filter(function (x) {
        return x.indexOf(HK + '=') === 0;
      })[0];
      if (!seg) return;
      var p = seg.slice(HK.length + 1).split('~');
      // ボスと地形はピッカーが持つ。ここでは写しに入れておいて、
      // `bindPicker()` のときにピッカーへ渡す
      if (p[0] && bossBy[p[0]]) {
        pk.b = p[0];
        pk.kind = p[0].charAt(0) === 'm' ? 'multi' : 'raid';
        useTgt = true;
      }
      if (p[1]) q('tls-f-diff').value = p[1];
      if (p[2] && terrJa[p[2]]) pk.tr = p[2];
      if (p[3]) q('tls-f-stu').value = p[3];
      if (p[4]) { try { q('tls-f-q').value = decodeURIComponent(p[4]); } catch (e) { /* 壊れた URL は無視 */ } }
    }

    /* ---------- 書き出し・読み込み -------------------------------- */
    function doExport() {
      if (!items.length) { say('保管庫が空です'); return; }
      var blob = new Blob([JSON.stringify({ v: 1, items: items }, null, 1)],
                          { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'arona-tl-vault-' + ymd(Date.now()) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      say(items.length + ' 本を書き出しました');
    }
    function doImport(file) {
      var fr = new FileReader();
      fr.onload = function () {
        var d = null;
        try { d = JSON.parse(String(fr.result)); } catch (e) { say('JSON として読めませんでした'); return; }
        var incoming = (d && Array.isArray(d.items)) ? d.items : (Array.isArray(d) ? d : null);
        if (!incoming) { say('この形の JSON は読めません'); return; }
        var have = {}; items.forEach(function (it) { have[it.id] = 1; });
        var add = 0;
        incoming.forEach(function (x) {
          if (!x || typeof x.h !== 'string' || !readTL(x.h)) return;
          var rec = { id: (x.id && !have[x.id]) ? x.id : nowId(),
                      t: String(x.t || '').slice(0, 200) || 'TL',
                      k: kindJa[x.k] ? x.k : 'raid',
                      b: bossBy[x.b] ? x.b : '',
                      d: String(x.d || ''), tr: terrJa[x.tr] ? x.tr : '',
                      tm: String(x.tm || '').slice(0, 100),
                      m: String(x.m || '').slice(0, 2000),
                      h: readTL(x.h).hash,
                      c: +x.c || Date.now(), u: +x.u || +x.c || Date.now() };
          have[rec.id] = 1; items.push(rec); add++;
        });
        if (!add) { say('入れられる TL がありませんでした'); return; }
        persist(); draw();
        say(add + ' 本を読み込みました');
      };
      fr.readAsText(file);
    }

    /* ---------- つなぐ -------------------------------------------- */
    q('tls-hash').addEventListener('input', drawPrev);
    q('tls-pull').addEventListener('click', function () {
      var h = pullFromTimeline();
      if (!h || !readTL(h)) { say('コスト計算機に保存された盤面が見つかりません'); return; }
      q('tls-hash').value = h;
      var tl = drawPrev();
      say(tl && tl.mode === 10
        ? '取り込みました。制約解除決戦の編成です。上で相手を選んでから保存してください'
        : '取り込みました。上で相手を選んでから保存してください');
    });
    q('tls-save').addEventListener('click', doSave);
    q('tls-cancel').addEventListener('click', function () { editing = null; fillForm(null); draw(); });

    q('tls-scope-on').addEventListener('change', function () {
      useTgt = q('tls-scope-on').checked;
      draw();
    });
    ['tls-f-diff', 'tls-f-stu'].forEach(function (id) {
      q(id).addEventListener('change', draw);
    });
    q('tls-f-q').addEventListener('input', draw);
    q('tls-clear').addEventListener('click', function () {
      useTgt = false;
      ['tls-f-diff', 'tls-f-stu', 'tls-f-q'].forEach(function (id) { q(id).value = ''; });
      draw();
    });
    q('tls-export').addEventListener('click', doExport);
    q('tls-import').addEventListener('click', function () { q('tls-file').click(); });
    q('tls-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = '';
    });

    q('tls-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-a]'); if (!btn) return;
      var card = e.target.closest('.tls-tl'); if (!card) return;
      var id = card.dataset.id;
      var it = items.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var a = btn.dataset.a;
      if (a === 'copy') {
        var u = new URL('../cost-timeline/#' + it.h, location.href).href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(u).then(function () { say('URL をコピーしました'); },
            function () { say('コピーできませんでした'); });
        } else { say('コピーできませんでした'); }
      } else if (a === 'edit') {
        editing = id; fillForm(it); draw();
        q('tls-add').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (a === 'del') {
        if (!window.confirm('「' + it.t + '」を保管庫から消します。よろしいですか。')) return;
        items = items.filter(function (x) { return x.id !== id; });
        if (editing === id) { editing = null; fillForm(null); }
        persist(); draw(); say('消しました');
      }
    });

    load();
    fromHash();
    fillForm(null);
    draw();

    /** **ページ先頭のボス選択をつなぐ。**呼ばれるまでは、保管庫は
        ハッシュから読んだ相手（あれば）のまま動く。 */
    function bindPicker(P) {
      if (!P || typeof P.get !== 'function') return false;
      picker = P;
      // ハッシュで相手が指定されていたら、それをピッカーに反映する（通知しない）
      if (pk.b) P.set({ kind: pk.kind, b: pk.b, tr: pk.tr, d: q('tls-f-diff').value });
      pk = P.get();
      /* **相手が変わったときだけ絞り込みを立てる。**難易度をいじっただけで
         チェックが戻ってくると、外した人の手を引っぱることになる（2026-08-30） */
      P.on(function (st) {
        var moved = (st.b !== pk.b) || (st.tr !== pk.tr);
        pk = st;
        if (moved) useTgt = true;
        draw();
      });
      draw();
      return true;
    }

    /** 外から相手を差し込む。**ピッカーがあればそちらへ回す。** */
    function setFilter(f) {
      if (!f || !f.b || !bossBy[f.b]) return false;
      if (picker) { picker.set(f); pk = picker.get(); }
      else { pk = { kind: f.kind || (f.b.charAt(0) === 'm' ? 'multi' : 'raid'),
                    b: f.b, tr: f.tr || '', d: f.d || '' }; }
      useTgt = true;
      draw();
      return true;
    }

    return { hash: hash, refresh: draw, bindPicker: bindPicker, setFilter: setFilter,
             target: function () { return { kind: pk.kind, b: pk.b, tr: pk.tr, d: pk.d, on: useTgt }; },
             count: function () { return items.length; } };
  };
})();
