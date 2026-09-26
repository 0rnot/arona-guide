/* Tier 表の「みんなで編集」。**3 桁の合言葉で、何人かが同じ表を見て直す。**

   2026-09-26 に足した。設計は ~/.claude/specs/2026-09-26-tier-share-api.md（案 B）、
   サーバーは ~/arona/cloud/tier-api/api.py（汎用Arona のクラウド、api.arona-bot.com）。
   決まっていること（先生の承認済み）: 募集の窓は 15 分／最後の保存から 14 日で表が消える／
   トークンを持っている端末は窓が閉じた後も直せる／3 桁は払い出し（自分で選ばない）。

   **部屋に入っていないときは何もしない。**表の持ち方・保存・URL は index.html のまま。

   つなぎ目は index.html の `window.TierTool` と `tier:change` だけ。
     - 送る:   `tier:change`（人が変えたときだけ出る）→ 少し待って PUT。連打は 1 回にまとめる
     - 受ける: 3 秒ごとに head（版の数字だけ）→ 進んでいたら GET → `setState`
     - 入っている間は `setShared(true)` で、このブラウザの保存（arona-tier-v2）に書かせない。
       **抜けたら入る前の表（`local()`）に戻る。**共有の表を手元に残したいなら、抜ける前に
       URL のコピーか画像で

   **部屋の番号とトークンは localStorage（`arona-tier-room`）にだけ置く。URL には入れない。**
   URL に入れると、X に貼った瞬間に編集できる鍵が漏れる。再読み込みしても部屋に居続けられるよう、
   最後に見た表（data）と「まだ送れていない変更がある」印（pending）も一緒に置く。

   **顔の大きさは端末ごと。**スマホと PC で見やすい大きさが違うので、相手の表を取り込むときは
   自分の大きさのまま、バーを動かしただけでは送らない（段の並びが変わったときだけ送る）。 */
(function () {
  'use strict';
  var TT = window.TierTool;
  if (!TT || !window.fetch || !document.getElementById('room')) return;

  var API = 'https://api.arona-bot.com/tier/v1';
  var RKEY = 'arona-tier-room';
  var OPEN_MIN = 15;        // 募集の窓（サーバーの OPEN_MINUTES と同じ）
  var POLL = 3000;          // head を見る間隔
  var DEBOUNCE = 1000;      // 最後の操作からこれだけ待って送る
  var TIMEOUT = 8000;

  var el = function (id) { return document.getElementById(id); };

  /* room = { code, token, v, open_until, data, pending, at }
       v          いま手元の表が基づいている版
       open_until 募集の締切（サーバーの時計の秒）
       data       最後に見た表（再読み込みしたとき、取りに行く前にまず出す）
       pending    まだ送れていない変更がある */
  var room = null;
  var paused = false;       // リンク（#t=）の表を見ている間は、送りも受けもしない
  var putTimer = null, putting = null, pollTimer = null, tick = null;
  var backoff = 0, offline = false, syncedAt = 0, lastSig = '';

  function sig(s) { return JSON.stringify(s.rows); }

  function readRoom() {
    try {
      var r = JSON.parse(localStorage.getItem(RKEY) || 'null');
      if (r && /^[0-9]{3}$/.test(r.code) && typeof r.token === 'string' && r.token) return r;
    } catch (e) {}
    return null;
  }
  function writeRoom() {
    try {
      if (room) localStorage.setItem(RKEY, JSON.stringify(room));
      else localStorage.removeItem(RKEY);
    } catch (e) { /* 覚えられなくても、開いている間の共有は動く */ }
  }

  /* サーバーへの 1 回。**失敗しても投げない。**通信できなければ status 0 で返す */
  function call(method, path, body) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    var opt = { method: method };
    if (ctl) opt.signal = ctl.signal;
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    return fetch(API + path, opt).then(function (res) {
      return res.json().then(function (j) { return j; }, function () { return null; }).then(function (j) {
        clearTimeout(t);
        return { status: res.status, body: j };
      });
    }, function () {
      clearTimeout(t);
      return { status: 0, body: null };
    });
  }
  function q() { return '?token=' + encodeURIComponent(room.token); }

  // ---- 知らせ
  /* **一言だけ。**同じ言葉が続いたら出し直さず、消える時刻だけ延ばす */
  var msgTimer = null;
  function say(t, ms) {
    var n = el('room-msg');
    n.textContent = t;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { n.textContent = ''; }, ms || 6000);
  }
  var MSG = {
    0: 'つながりません。ローカルで続けます',
    404: 'その番号の表はありません',
    429: '少し待ってから、もう一度どうぞ',
    413: '表が大きすぎて送れませんでした',
    503: 'いま部屋がいっぱいです。少し時間をおいてどうぞ'
  };
  function errText(st) {
    if (MSG[st]) return MSG[st];
    if (st >= 500) return MSG[0];
    return 'うまくいきませんでした（' + st + '）';
  }

  // ---- 画面
  function hhmm(ms) {
    var d = new Date(ms);
    return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function drawOpen() {
    if (!room) return;
    /* 締切はサーバーの時計の秒。端末の時計が大きくずれていると分がずれるが、
       CORS では Date が読めないので合わせようが無い（スマホの時計はまず合っている） */
    var left = Math.ceil((room.open_until * 1000 - Date.now()) / 60000);
    var n = el('room-open');
    if (left > 0) {
      n.className = 'room-open';
      n.innerHTML = 'あと <b>' + left + ' 分</b>、だれでも入れます';
    } else {
      n.className = 'room-open shut';
      n.textContent = '募集は締め切りました（入っている人は直せます）';
    }
  }
  function render() {
    var on = !!room;
    el('room-idle').hidden = on;
    el('room-on').hidden = !on || paused;
    el('room-paused').hidden = !on || !paused;
    el('room-tag').hidden = !on;
    if (!on) { el('room-st').textContent = ''; stopTick(); return; }
    el('room-num').textContent = room.code;
    el('room-pnum').textContent = room.code;
    el('room-tag').textContent = '合言葉 ' + room.code + (paused ? '（止めています）' : '');
    drawOpen();
    var st = '';
    if (paused) st = '';
    else if (offline) st = 'つながっていません。直したものはつながったら送ります';
    else if (room.pending || putting) st = '保存しています…';
    else if (syncedAt) st = 'みんなの表と同じです（' + hhmm(syncedAt) + '）';
    el('room-st').textContent = st;
    if (!tick) tick = setInterval(drawOpen, 10000);
  }
  function stopTick() { clearInterval(tick); tick = null; }

  // ---- 表の出し入れ
  /* 相手の表を画面へ。**大きさは自分のまま**（上の説明） */
  function applyRemote(data) {
    TT.setState({ v: 2, size: TT.getState().size, rows: data.rows });
    var s = TT.getState();
    lastSig = sig(s);
    room.data = s;
  }
  function okNow() {
    if (offline) say('つながりました');
    offline = false; backoff = 0; syncedAt = Date.now();
  }

  /* 失敗の後始末。**どれでもローカルの表は壊さない**（画面の表はそのまま残る） */
  function fail(st) {
    if (st === 403 || st === 404) {
      // 部屋が消えた（14 日）か、トークンが合わない。どちらもサーバーは区別しない
      var c = room ? room.code : '';
      drop();
      say('合言葉 ' + c + ' の表に入れなくなりました（消えたか、無効になりました）。この端末の表に戻しました', 12000);
      return;
    }
    if (st === 429) { backoff = 30000; say(MSG[429]); }
    else if (st === 0 || st >= 500) {
      if (!offline) say(MSG[0]);
      offline = true;
      backoff = Math.min(30000, (backoff || POLL) * 2);
    } else {
      // 400・413: 何度送っても同じ。送るのをやめる（画面の表はそのまま）
      say(errText(st));
      if (room) { room.pending = false; lastSig = sig(TT.getState()); writeRoom(); }
    }
    render();
  }

  // ---- 送る
  function schedule() {
    clearTimeout(putTimer);
    putTimer = setTimeout(put, DEBOUNCE);
    render();
  }
  function put() {
    clearTimeout(putTimer); putTimer = null;
    if (!room || paused || !room.pending) return Promise.resolve();
    if (putting) return putting;   // 送っている最中。終わったら pending を見て続きを送る
    var s = TT.getState(), sg = sig(s), code = room.code;
    putting = call('PUT', '/rooms/' + code, { token: room.token, base_v: room.v, data: s }).then(function (r) {
      putting = null;
      if (!room || room.code !== code) return;
      if (r.status === 200 && r.body) {
        room.v = r.body.v;
        lastSig = sg;
        room.pending = sig(TT.getState()) !== sg;   // 送っている間にまた動いた
        okNow();
        /* **後勝ち。**相手の保存の後にこちらが上書きした。サーバーは直前の 1 版
           （＝相手の表）を持っているので、「1 つ戻す」で相手の表に戻せる */
        if (r.body.overwrote) say('ほかの人の直しと重なり、こちらの並びで上書きしました。相手の並びに戻すなら「1 つ戻す」', 9000);
        writeRoom(); render();
        if (room.pending) schedule();
        return;
      }
      fail(r.status);
    });
    render();
    return putting;
  }
  document.addEventListener('tier:change', function () {
    if (!room || paused) return;
    var s = TT.getState();
    room.data = s;
    if (sig(s) !== lastSig) { room.pending = true; room.at = Date.now(); }
    writeRoom();
    if (room.pending) schedule();
  });

  // ---- 受ける
  function next() {
    clearTimeout(pollTimer); pollTimer = null;
    if (!room || paused || document.hidden) return;
    pollTimer = setTimeout(poll, backoff || POLL);
  }
  function poll() {
    clearTimeout(pollTimer); pollTimer = null;
    if (!room || paused || document.hidden) return;
    // 送れていない変更（つながり直した・再読み込みした）を先に送る
    if (room.pending && !putting && !putTimer) { put().then(next); return; }
    if (putting || putTimer) { next(); return; }
    var code = room.code;
    call('GET', '/rooms/' + code + '/head' + q()).then(function (r) {
      if (!room || room.code !== code) return;
      if (r.status === 200 && r.body) {
        okNow();
        // **手が動いている間は取り込まない。**次の周で見る
        if (r.body.v !== room.v && !room.pending && !putting && !TT.busy()) { pull(false).then(next); return; }
        render();
      } else {
        fail(r.status);
      }
      next();
    });
  }
  /* 表を取りに行く。quiet なら知らせない（入った直後・再読み込み） */
  function pull(quiet) {
    var code = room.code;
    return call('GET', '/rooms/' + code + q()).then(function (r) {
      if (!room || room.code !== code) return;
      if (r.status !== 200 || !r.body || !r.body.data) { fail(r.status); return; }
      okNow();
      var remote = r.body.data;
      if (room.pending) {
        /* 手元に送れていない変更がある。**相手の表と同じなら送ったことにする**
           （閉じる直前に送れていた）。違えば送る＝後勝ち */
        if (JSON.stringify(remote.rows) === sig(TT.getState())) {
          room.pending = false; room.v = r.body.v; lastSig = sig(TT.getState());
        } else {
          put();
        }
      } else if (!putting && !TT.busy()) {
        var before = lastSig;
        room.v = r.body.v;
        applyRemote(remote);
        if (!quiet && lastSig !== before) say('ほかの人が表を直しました', 4000);
      }
      writeRoom(); render();
    });
  }

  // ---- 入る・抜ける
  function stripHash() {
    if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  }
  function enter(info, data) {
    room = { code: info.code, token: info.token, v: info.v, open_until: info.open_until, data: null, pending: false, at: 0 };
    paused = false; offline = false; backoff = 0; syncedAt = Date.now();
    TT.setShared(true);
    stripHash();   // リンクの表から入ったとき、再読み込みで「リンクを見ている」にならないように
    applyRemote(data);
    writeRoom(); render(); next();
  }
  /* 共有をやめて、入る前の表へ。**部屋は消さない**（消す口もサーバーに無い） */
  function drop() {
    clearTimeout(putTimer); clearTimeout(pollTimer); putTimer = pollTimer = null;
    room = null; paused = false; offline = false; backoff = 0; lastSig = '';
    writeRoom();
    TT.setShared(false);
    TT.setState(TT.local());
    render();
  }

  var working = false;   // 作る・入るの二度押し止め
  el('room-make').addEventListener('click', function () {
    if (working) return; working = true;
    var s = TT.getState();
    call('POST', '/rooms', { data: s }).then(function (r) {
      working = false;
      if (r.status === 201 && r.body && r.body.code) {
        // 返事を待つ間に動かしていたら、その分は作った直後に送る（作ったときの表で塗りつぶさない）
        var cur = TT.getState();
        enter(r.body, cur);
        if (sig(cur) !== sig(s)) { lastSig = sig(s); room.pending = true; room.at = Date.now(); writeRoom(); schedule(); }
        say('合言葉を作りました。3 桁を伝えてください');
      } else say(errText(r.status));
    });
  });
  el('room-join').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (working) return;
    // 全角の数字も受ける
    var code = el('room-code').value.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\s/g, '');
    if (!/^[0-9]{3}$/.test(code)) { say('3 桁の数字を入れてください'); return; }
    working = true;
    call('POST', '/rooms/' + code + '/join', {}).then(function (r) {
      working = false;
      if (r.status === 200 && r.body && r.body.token) {
        enter({ code: code, token: r.body.token, v: r.body.v, open_until: r.body.open_until }, r.body.data);
        el('room-code').value = '';
        say('入りました。抜けると、この端末の表に戻ります');
      } else if (r.status === 403) {
        say('募集が締め切られています。作った人に「募集を開き直す」を頼んでください', 10000);
      } else say(errText(r.status));
    });
  });
  el('room-leave').addEventListener('click', function () {
    if (!room) return;
    if (!confirm('この端末は共有をやめて、入る前の表に戻ります。部屋はそのまま残ります。')) return;
    var c = room.code;
    // 送れていない変更は送ってから抜ける（届かなくても抜ける）
    put().then(function () {
      if (!room || room.code !== c) return;
      drop();
      say('抜けました。この端末の表に戻しました');
    });
  });
  el('room-copy').addEventListener('click', function () {
    if (!room) return;
    var c = room.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c).then(function () { say('合言葉をコピーしました', 2500); },
        function () { say('コピーできませんでした。合言葉は ' + c + ' です'); });
    } else say('合言葉は ' + c + ' です');
  });
  el('room-reopen').addEventListener('click', function () {
    if (!room) return;
    var c = room.code;
    call('POST', '/rooms/' + c + '/open', { token: room.token, minutes: OPEN_MIN }).then(function (r) {
      if (!room || room.code !== c) return;
      if (r.status === 200 && r.body) {
        room.open_until = r.body.open_until;
        writeRoom(); render();
        say('あと ' + OPEN_MIN + ' 分、だれでも入れます');
      } else fail(r.status);
    });
  });
  el('room-undo').addEventListener('click', function () {
    if (!room) return;
    var c = room.code;
    // 送れていない変更を先に送る。**そうしないと「戻す」が 1 つ前ではなく 2 つ前になる**
    put().then(function () {
      if (!room || room.code !== c) return;
      return call('POST', '/rooms/' + c + '/undo', { token: room.token }).then(function (r) {
        if (!room || room.code !== c) return;
        if (r.status === 200 && r.body && r.body.data) {
          room.v = r.body.v;
          applyRemote(r.body.data);
          okNow(); writeRoom(); render();
          say('1 つ前に戻しました（もう一度押すと取り消せます）');
        } else if (r.status === 409) {
          say('戻せる版がありません');
        } else fail(r.status);
      });
    });
  });
  el('room-resume').addEventListener('click', function () {
    if (!room) return;
    paused = false;
    stripHash();
    applyRemote(room.data || TT.getState());
    render();
    pull(true).then(next);
  });

  // ---- タブが隠れたら止める
  document.addEventListener('visibilitychange', function () {
    if (!room || paused) return;
    if (document.hidden) {
      clearTimeout(pollTimer); pollTimer = null;
      if (room.pending) put();   // スマホでアプリを切り替えた。待たずに送る
    } else {
      poll();
    }
  });

  // ---- 開いたとき
  room = readRoom();
  if (room) {
    TT.setShared(true);
    /* **リンク（#t=）で開いたら、リンクの表を見せる。**部屋の表で塗りつぶすと、人の
       リンクを開けなくなる。共有は止めておき、「共有の表に戻る」で再開する */
    if (/(^#|&)t=/.test(location.hash)) {
      paused = true;
      render();
    } else {
      if (room.data && room.data.rows) {
        TT.setState({ v: 2, size: TT.getState().size, rows: room.data.rows });
        lastSig = room.pending ? '' : sig(TT.getState());
      }
      render();
      pull(true).then(next);
    }
  } else {
    render();
  }
})();
