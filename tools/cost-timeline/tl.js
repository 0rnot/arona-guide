/* TL のコスト計算機。

   見ているのは 3 つ。
   ① 編成した 6 人（制約解除決戦なら 10 人）からコスト回復力を出す
   ② 並べた EX を上から順に置いて、コストの都合で撃てる時刻を出す
   ③ **その順番が手札の上で成り立つかを確かめる**

   ③ について。ブルアカのスキルカードは **山札 ＝ 編成人数、手札 ＝ 3 枚**で、
   使ったカードは山札の一番下に戻り、次のカードが順に引かれる。
   **並びが決まれば、そこから先は運が入らない。**開始スキルで最初の並びを
   指定できるので（通常編成 5 人・制約解除決戦 9 人。残り 1 人は自動で決まる）、
   TL は最後まで再現できる。撃ちたい子が手札に無ければ、そこで詰まる。 */
(function () {
  'use strict';
  var D = window.TL;
  var FPS = 30;                        // Duration はフレーム。ブルアカは 30fps
  var el = function (id) { return document.getElementById(id); };
  var byId = {};
  D.students.forEach(function (s) { byId[s.id] = s; });

  /* 通常は ストライカー 4 ＋ スペシャル 2、制約解除決戦は 6 ＋ 4。
     枠の数はモードで変わるが、**slots の並びは常に「ストライカーが先」**にしておき、
     使わない後ろの枠は空のまま持っておく（モードを戻したときに編成が消えない）。 */
  // **`start` は開始スキルで順番を指定できる人数。**2026-05-27 のアップデートで
  // 通常編成 3→5、制約解除決戦 5→9 に増えた。ここまでは並べたとおりに撃てる
  var LAYOUT = { 6: { main: 4, sup: 2, cap: 10, start: 5 },
                 10: { main: 6, sup: 4, cap: 20, start: 9 } };
  var MAIN_MAX = 6, SUP_MAX = 4;

  // **`-0` を出さない。**丸めた結果が 0 なのに符号だけ残ると「残り -0.0 コスト」になる
  function n1(v) { var r = Math.round(v * 10) / 10 || 0; return r.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function n2(v) { return (Math.round(v * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmt(v) { return Math.round(v).toLocaleString('ja-JP'); }
  /** 小数第 2 位まで。**割り切れたら余分な 0 を出さない**（3.8 と 4.26 を並べて出す） */
  function nn(v) { return String(Math.round(v * 100) / 100); }
  /** 半角の `-` を全角の `−` にする。**画面に出す数だけ。**URL には使わない */
  function neg(t) { return String(t).replace(/-/g, '−'); }
  /** URL に書くための数。**`n1` は桁区切りを入れるのでここでは使えない。** */
  function n1x(v) { return String(Math.round(v * 10) / 10); }
  function face(id) { return '../img/student_' + id + '.webp'; }
  /** EX スキルの絵。**中身は真っ白＋透過**なので、`<img>` で置くと明るい画面で
      消える（2026-08-30 に画素を読んで見つけた。全面 #FFFFFF00）。
      `.gi` と同じ型抜き方式にして、文字の色で塗る。 */
  function skIcon(d) {
    if (!d || !d.ei) return '';
    /* **パスはサイトの根から書く。**カスタムプロパティに入れた `url()` は、
       それを使う側のスタイルシート（`tools/tool.css`）を起点に解決されるので、
       `../img/` と書くと `/img/` を見にいって 404 になる（2026-08-30 に実測）。 */
    return icoOf(d.ei);
  }
  function icoOf(ei) {
    if (!ei) return '';
    return '<i class="gi skico" style="--gi:url(/tools/img/skill_' +
      ei.toLowerCase() + '.webp)" aria-hidden="true"></i>';
  }

  /* ---------- EX が途中で変わる子

     `data.js` の `xs` が 2 形態目以降。**0 番は本体**（`en` / `ei` / `c` / `d`）で、
     1 番から `xs[0]`, `xs[1]` … と続く。コストも演出時間も帯も形態ごとに違う。 */
  function forms(d) {
    var out = [{ n: d.en, ei: d.ei, c: d.c, d: d.d, bf: d.bf, cc: d.cc, r: null }];
    (d.xs || []).forEach(function (x) {
      out.push({ n: x.n, ei: x.ei, c: x.c, d: x.d, bf: x.bf, cc: x.cc, r: x.r });
    });
    return out;
  }
  /** 何回目にどの形態を撃つか。**既定は「順送りして、最後の形態を維持」。**
      スキル文がそう読めない 3 人だけ別にしてある（根拠は下の `SP_JA` と
      `sp.txt` の原文で、画面にもそのまま出す）。 */
  var FORM_RULE = {
    // ココロ「潜水状態になり、「上がります！」にスキルが変更」＝ 潜って浮くの繰り返し
    10149: 'alt',
    // アリス（臨戦）は撃つ前に選ぶ形（アイコンが SELECTEXSKILL）。**自動で決めない**
    10134: 'pick',
    // キサキ（水着）は「「実行：ばんざい体操」を2回使用後、「宣言：本日休業」に
    // スキルが変更されます」。**どちらが 1 枚目かがデータの並びと食い違う**ので選ばせる
    10145: 'pick',
    // シュン（水着）は 9 秒間だけ変わる。時間で戻るので回数では決められない
    10143: 'pick',
  };
  function autoForm(d, used) {
    var n = forms(d).length;
    if (n < 2) return 0;
    var k = FORM_RULE[d.id] || 'hold';
    if (k === 'pick') return 0;
    if (k === 'alt') return used % n;
    return Math.min(used, n - 1);
  }
  function formNote(d) {
    var k = FORM_RULE[d.id] || 'hold';
    return k === 'pick' ? '自動では決めていません。撃つ形態を選んでください'
         : k === 'alt' ? '撃つたびに入れ替わるものとして数えています'
         : '2 回目から次の形態、最後の形態はそのまま続くものとして数えています';
  }
  /** `sp` の印を日本語にする。**値は data.js のもの、文は原文のまま出す。** */
  var SP_JA = {
    draw: '撃つと EX カードをすぐに引きます',
    swap: 'このあとスキルが変わります',
    copy: '味方 1 人の EX カードを複製します',
    back: 'カードが山札の一番下へ回ります',
    ovl: 'オーバーコストを配ります',
  };
  /** 秒を M:SS.s にする。TL は分秒で書くのが普通なので、書き出しはこの形にする */
  function clock(sec) {
    // **先に丸めてから桁を数える。**9.99 秒を「0:09.99…」のつもりで
    // 0 詰めしてから n1 に渡すと「0:010.0」になる（2026-08-30 に実測）
    var r = Math.round(sec * 10) / 10, m = Math.floor(r / 60);
    r = Math.round((r - m * 60) * 10) / 10;
    return m + ':' + (r < 10 ? '0' : '') + n1(r);
  }
  /** 入力欄に書き戻すときの M:SS。**割り切れるなら小数を出さない。** */
  function clockIn(sec) {
    var m = Math.floor(sec / 60), r = Math.round((sec - m * 60) * 10) / 10;
    return m + ':' + (r < 10 ? '0' : '') + (r % 1 === 0 ? r : r.toFixed(1));
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 状態

     slots は ストライカー MAIN_MAX 枠 ＋ スペシャル SUP_MAX 枠の固定長。
     order は { i: 枠の番号, t: 指定した秒（null なら最短） }。 */
  function emptySlot() { return { id: null, ex: 5, sk: 10, wp: 0, w4: false, tier: {}, on: {} }; }

  /** 固有武器 ★4 で、スペシャル 1 人につきコストの上限が ＋0.5。
      **データにはまだ無い。**`CharacterWeaponExcelTable` の `Unlock` が
      `[true, true, true, false, false]` のままで、★4 の枠に値が入っていない
      （ba-data の jp・global どちらも 2026-08-30 時点でそう）。
      値は 2025 年 7 月 19 日の告知から取っている。 */
  var W4_CAP = 0.5;

  /** 戦闘開始時にコストをくれる 2 人。**値はノーマルスキルのレベルで変わる。**
      SchaleDB の `Skills.Public.Parameters`（10 段）から。
      ・シュン（10011）「戦闘開始時、スキルコストを<?1>獲得（戦闘中に1回のみ）」
      ・シュン（水着）（10144）「戦闘開始時、編成した味方生徒1人当たり、スキルコストを
        <?1>獲得（最大6人まで）（戦闘中に1回のみ）／ただし自分以外にも、戦闘開始時に
        コストを獲得する生徒が部隊にいる場合、このスキルではスキルコストを獲得しません。」
      後段のとおり、**シュンが居るとシュン（水着）は不発**になる。 */
  var START_COST = {
    10011: { v: [2, 2.1, 2.2, 2.6, 2.7, 2.8, 3.2, 3.3, 3.4, 3.8], per: 0 },
    10144: { v: [0.37, 0.39, 0.41, 0.48, 0.5, 0.52, 0.6, 0.61, 0.63, 0.71], per: 6 },
  };
  /** ナギサ（水着）のオーバーコスト。EX「Teatime in Wartime」が **味方 1 人に
      26 秒間** かける状態で、「生徒が編成可能な最大数まで編成され、誰も退却していない
      場合、保有コストを最大5コストまで超過して消費可能、超過した分はマイナスの
      コストとして差し引かれます」。持続は EX の `Effects[].Duration` と同じ 26000。 */
  var NAGISA_SW = 20048, OVER_FLOOR = -5, OVER_MS = 26000;

  /** 固有武器のパッシブで伸びた持続（ミリ秒）。**バフとデバフで別の値。**
      `ExtendBuffDuration_Base` / `ExtendDebuffDuration_Base` はどちらも
      10000 分率で、Lv10 が 1900 ＝ +19%。**掛かるのは、その子がかけた効果だけ。** */
  function extend(d, slot, du, side) {
    var lv = slot && slot.wp;
    if (!lv) return du;
    var tbl = side === 'enemy' ? d.ed : d.eb;
    if (!tbl) return du;
    // **ミリ秒の段階で丸める。**丸めずに渡すと 15000×1.19 が 17849.999… になり、
    // 同じ値なのに片方が 17.8 秒、もう片方が 17.9 秒と食い違って出る
    return Math.round(du * (1 + (tbl[lv - 1] || 0) / 10000));
  }
  var mode = 6, slots = [], order = [], lastSim = null;
  // ステージギミック { t: 発動する秒, v: 回復力の増加量, du: 効果時間の秒 }
  var gims = [], goal = null;
  for (var z = 0; z < MAIN_MAX + SUP_MAX; z++) slots.push(emptySlot());

  function isMain(i) { return i < MAIN_MAX; }
  function live(i) { return isMain(i) ? i < LAYOUT[mode].main : i - MAIN_MAX < LAYOUT[mode].sup; }

  var KEY = 'arona-cost-timeline';

  /** コストの上限。**素は 10（制約解除決戦は 20）で、固有武器 ★4 の
      スペシャル 1 人につき ＋0.5。** */
  function capNow() {
    var cap = LAYOUT[mode].cap;
    slots.forEach(function (s, i) {
      if (s.id && s.w4 && !isMain(i) && live(i)) cap += W4_CAP;
    });
    return cap;
  }
  /** 全部の枠が埋まっているか。**オーバーコストの条件。** */
  function partyFull() {
    return members().length === LAYOUT[mode].main + LAYOUT[mode].sup;
  }
  /** 戦闘開始時にもらえるコスト。**シュンが居るとシュン（水着）は不発。** */
  function startBonus() {
    var ms = members();
    var have = ms.filter(function (m) { return START_COST[m.d.id]; });
    if (!have.length) return null;
    // **人数に掛けない側（シュン）が優先。**スキル文の「自分以外にも、戦闘開始時に
    // コストを獲得する生徒が部隊にいる場合」に当たるのが、いまはこの 1 人だけ
    var flat = have.filter(function (m) { return !START_COST[m.d.id].per; });
    var win = flat.length ? flat[0] : have[0];
    var c = START_COST[win.d.id];
    var v = c.v[Math.min(c.v.length - 1, Math.max(0, win.s.sk - 1))] || 0;
    var n = Math.min(c.per || 0, ms.length);
    return { d: win.d, lv: win.s.sk, v: v, n: n, per: c.per,
             amt: c.per ? v * n : v,
             off: have.filter(function (m) { return m !== win; })
                      .map(function (m) { return m.d.n; }) };
  }

  function state() {
    return { m: mode, s: slots, o: order, gk: gims, gl: goal,
             st: el('i-start').value, cp: capNow(),
             gb: el('i-gb').value, gc: el('i-gc').value };
  }
  function apply(d) {
    if (!d) return;
    if (d.m === 10 || d.m === 6) mode = d.m;
    if (Array.isArray(d.s)) {
      slots = [];
      for (var i = 0; i < MAIN_MAX + SUP_MAX; i++) {
        var x = d.s[i] || {};
        // **枠と役割が食い違うものは捨てる。**保存していた古い形や、
        // 手で書き換えた URL でスペシャルがストライカーの枠に入るのを防ぐ
        var want = i < MAIN_MAX ? 'Main' : 'Support';
        var ok = byId[x.id] && byId[x.id].sq === want;
        slots.push({ id: ok ? x.id : null, ex: x.ex || 5, sk: x.sk || 10, wp: x.wp || 0,
                     // **固有 ★4 はスペシャルの枠だけ。**ストライカーに付いていたら捨てる
                     w4: !!(ok && x.w4 && i >= MAIN_MAX),
                     tier: ok ? (x.tier || {}) : {}, on: ok ? (x.on || {}) : {} });
      }
    }
    if (Array.isArray(d.o)) {
      order = d.o.map(function (e) {
        return typeof e === 'number' ? { i: e, t: null, to: null, ov: null, f: null }
                                     : { i: e.i, t: (e.t == null ? null : +e.t),
                                         to: (e.to == null ? null : +e.to),
                                         ov: (e.ov == null ? null : +e.ov),
                                         f: (e.f == null ? null : +e.f) };
      }).filter(function (e) { return e.i >= 0 && e.i < slots.length; });
    }
    if (Array.isArray(d.gk)) {
      gims = d.gk.map(function (g) {
        return { t: Math.max(0, +g.t || 0), v: +g.v || 0, du: Math.max(0, +g.du || 0) };
      }).filter(function (g) { return g.v && g.du; });
    }
    if (d.gl !== undefined) {
      goal = (d.gl == null || d.gl === '') ? null : Math.max(0, +d.gl || 0);
      el('i-goal').value = goal == null ? '' : clockIn(goal);
    }
    if (d.st != null) el('i-start').value = d.st;
    /* **上限は数で持たなくなった。**2026-08-30 より前に配ったリンクと保存には
       上限の数（`cp`）しか入っていないので、**素の上限を超えたぶんを 0.5 で割って、
       前から順にスペシャルの「固有 ★4」に置き直す。**新しい形（枠ごとの `w4`）が
       入っているときは、そちらが正しいので触らない。 */
    if (d.cp != null && !slots.some(function (x) { return x.w4; })) {
      var extra = Math.round(((parseFloat(d.cp) || 0) - LAYOUT[mode].cap) / W4_CAP);
      for (var k = MAIN_MAX; k < MAIN_MAX + SUP_MAX && extra > 0; k++) {
        if (slots[k] && slots[k].id) { slots[k].w4 = true; extra--; }
      }
    }
    if (d.gb != null) el('i-gb').value = d.gb;
    if (d.gc != null) el('i-gc').value = d.gc;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state())); } catch (e) { /* 使えない環境でも動く */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) apply(JSON.parse(raw));
    } catch (e) { /* 壊れていたら初期状態のまま */ }
  }

  /* ---------- URL に載せる

     `#6|10001.5.10,_,…|0,2@12.5|0/10/0/0`
     順に モード ／ 編成 ／ 撃つ順番 ／ 開始・上限・ステージ補正。
     **短く保つ。**QR にもチャットにも貼れる長さで収めたい。 */
  function toHash() {
    var ps = slots.map(function (s) {
      if (!s.id) return '_';
      var t = Object.keys(s.tier).map(function (k) { return k + ':' + s.tier[k]; }).join('!');
      var o = Object.keys(s.on).filter(function (k) { return s.on[k]; }).join('!');
      // **後ろから足していく。**`id.ex.sk.段.チェック.固有.固有★4` の順で、
      // 要らない後ろは書かない（古いリンクを読む側は知らない欄を無視する）
      var tail = (t || o || s.wp || s.w4 ? '.' + t + '.' + o : '') +
                 (s.wp || s.w4 ? '.' + s.wp : '') + (s.w4 ? '.1' : '');
      return s.id + '.' + s.ex + '.' + s.sk + tail;
    }).join(',');
    var os = order.map(function (e) {
      return (e.t == null ? String(e.i) : e.i + '@' + e.t) + (e.to == null ? '' : '>' + e.to);
    }).join(',');
    /* 4 つ目の区画は `/` 区切り。**後ろに足すだけにする。**古い形しか知らない
       ページで開いても、知らない欄を読み飛ばして同じ編成が出る（2026-08-30 に追加した
       目標時間・ステージギミック・オーバーコストの渡し先が 5 つ目から）。 */
    var gk = gims.map(function (g) { return n1x(g.t) + ':' + g.v + ':' + n1x(g.du); }).join('!');
    var ov = order.map(function (e, j) { return e.ov == null ? '' : j + ':' + e.ov; })
                  .filter(Boolean).join('!');
    var fm = order.map(function (e, j) { return e.f == null ? '' : j + ':' + e.f; })
                  .filter(Boolean).join('!');
    var tail = [el('i-start').value, capNow(), el('i-gb').value, el('i-gc').value,
                goal == null ? '' : n1x(goal), gk, ov, fm];
    while (tail.length && tail[tail.length - 1] === '') tail.pop();
    return '#' + mode + '|' + ps + '|' + os + '|' + tail.join('/');
  }
  // **共通の共有バー（../share.js）から呼ばれる。**あちらは押された時点で
  // 組み直すので、ここで状態を渡しておけば「URL をコピー」を押していなくても
  // いまの盤面が飛ぶ
  window.shareUrl = toHash;

  function fromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return false;
    var p = h.split('|');
    if (p.length < 3) return false;
    var d = { m: +p[0] === 10 ? 10 : 6, s: [], o: [] };
    p[1].split(',').forEach(function (x) {
      if (x === '_' || !x) { d.s.push({}); return; }
      var f = x.split('.');
      var tier = {}, on = {};
      (f[3] || '').split('!').forEach(function (kv) {
        if (!kv) return; var a = kv.split(':'); tier[a[0]] = +a[1];
      });
      (f[4] || '').split('!').forEach(function (k) { if (k) on[k] = true; });
      d.s.push({ id: +f[0], ex: +f[1] || 5, sk: +f[2] || 10, wp: +f[5] || 0,
                 w4: f[6] === '1', tier: tier, on: on });
    });
    if (p[2]) {
      p[2].split(',').forEach(function (x) {
        if (!x) return;
        var to = null, y = x, gt = x.indexOf('>');
        if (gt >= 0) { to = +x.slice(gt + 1); y = x.slice(0, gt); }
        var a = y.split('@');
        d.o.push({ i: +a[0], t: a.length > 1 ? +a[1] : null, to: isNaN(to) ? null : to });
      });
    }
    var g = (p[3] || '').split('/');
    if (g[0] != null && g[0] !== '') d.st = g[0];
    if (g[1] != null && g[1] !== '') d.cp = g[1];
    if (g[2] != null && g[2] !== '') d.gb = g[2];
    if (g[3] != null && g[3] !== '') d.gc = g[3];
    d.gl = g[4] == null || g[4] === '' ? null : +g[4];
    if (g[5]) {
      d.gk = g[5].split('!').map(function (x) {
        var a = x.split(':');
        return { t: +a[0], v: +a[1], du: +a[2] };
      });
    }
    if (g[6]) {
      g[6].split('!').forEach(function (x) {
        var a = x.split(':');
        if (d.o[+a[0]]) d.o[+a[0]].ov = +a[1];
      });
    }
    if (g[7]) {
      g[7].split('!').forEach(function (x) {
        var a = x.split(':');
        if (d.o[+a[0]]) d.o[+a[0]].f = +a[1];
      });
    }
    apply(d);
    return true;
  }

  function members() {
    return slots.map(function (s, i) { return { i: i, s: s, d: byId[s.id] }; })
                .filter(function (m) { return m.d && live(m.i); });
  }
  function usedIds(except) {
    var out = {};
    slots.forEach(function (s, i) { if (s.id && i !== except && live(i)) out[s.id] = true; });
    return out;
  }

  /* ---------- 効いているコスト回復力のスキル */
  function effects() {
    var ms = members(), out = [];
    ms.forEach(function (m) {
      (m.d.r || []).forEach(function (e, ei) {
        var row = 0;
        if (e.v.length > 1) {
          if (e.cond === 'redwinter') {
            row = Math.min(e.v.length - 1, ms.filter(function (x) {
              return x.d.id !== m.d.id && x.d.sc === 'RedWinter'; }).length);
          } else if (e.cond === 'heavymain') {
            row = Math.min(e.v.length - 1, ms.filter(function (x) {
              return x.d.id !== m.d.id && x.d.at === 'HeavyArmor' && x.d.sq === 'Main'; }).length);
          } else {
            row = Math.min(e.v.length - 1, m.s.tier[ei] || 0);
          }
        }
        var lv = (e.sl === 'Ex' ? m.s.ex : m.s.sk) - 1;
        var arr = e.v[row] || [];
        var v = arr[Math.min(arr.length - 1, Math.max(0, lv))] || 0;
        if (!v) return;
        out.push({ m: m, e: e, v: v, row: row, ei: ei });
      });
    });
    return out;
  }

  /* コスト回復力の合計。**1 人ごとに「（700 ＋ 実数）×（1 ＋ %）」を出して足す。**

     ここで数えるのは**持続時間を持たない効果だけ**（パッシブと常時のもの）。
     持続するバフは TL の中で、その子が EX を撃った瞬間から数える
     （2026-08-30。それまでは手でチェックを入れる形で、入れると最初から
     最後まで効いていることになっていた）。 */
  function pool() {
    var ms = members(), efs = effects().filter(function (x) { return !x.e.du; });
    var gb = parseFloat(el('i-gb').value) || 0;
    var gc = parseFloat(el('i-gc').value) || 0;
    var per = {};
    ms.forEach(function (m) { per[m.i] = { b: D.base + gb, c: gc * 100 }; });
    efs.forEach(function (x) {
      var targets = x.e.p === 'party' ? ms : [x.m];
      targets.forEach(function (t) {
        if (!per[t.i]) return;
        if (x.e.k === 'b') per[t.i].b += x.v; else per[t.i].c += x.v;
      });
    });
    var total = 0;
    ms.forEach(function (m) { total += per[m.i].b * (1 + per[m.i].c / 10000); });
    return { total: total, per: per, efs: efs, ms: ms, gb: gb, gc: gc };
  }

  /* ---------- 画面 */

  function drawParty() {
    el('party-lead').innerHTML = mode === 10
      ? 'ストライカー 6 人とスペシャル 4 人。<b>コスト回復力は 10 人の合計で決まります</b>ので、EX を撃たない子も入れてください。同じ子は 1 人までです。'
      : 'ストライカー 4 人とスペシャル 2 人。<b>コスト回復力は 6 人の合計で決まります</b>ので、EX を撃たない子も入れてください。同じ子は 1 人までです。';
    [['party-main', 0, LAYOUT[mode].main, 'dl-main'],
     ['party-sup', MAIN_MAX, MAIN_MAX + LAYOUT[mode].sup, 'dl-sup']].forEach(function (g) {
      var box = el(g[0]), html = '';
      for (var i = g[1]; i < g[2]; i++) {
        var s = slots[i], d = byId[s.id];
        html += '<div class="slot' + (d ? '' : ' empty') + '" data-i="' + i + '">';
        html += '<div class="face">' + (d
          ? '<img src="' + face(d.id) + '" alt="" width="120" height="120" loading="lazy">'
          : '<span class="ph">空き</span>') + '</div>';
        if (d) {
          html += '<div class="nm">' + esc(d.n) + '<small>' +
            skIcon(d) +
            esc(d.en) + '（' + d.c[s.ex - 1] + ' コスト）</small></div>';
          html += '<div class="lv"><span>EX</span><select data-k="ex" data-i="' + i + '">';
          for (var v = 1; v <= 5; v++) html += '<option value="' + v + '"' + (v === s.ex ? ' selected' : '') + '>Lv' + v + '</option>';
          html += '</select></div>';
          if (d.eb || d.ed) {
            var wk = d.eb ? d.eb : d.ed, wt = d.eb ? 'バフ' : 'デバフ';
            html += '<div class="lv"><span>固有</span><select data-k="wp" data-i="' + i + '">' +
              '<option value="0"' + (!s.wp ? ' selected' : '') + '>なし</option>';
            for (var q = 1; q <= wk.length; q++) {
              html += '<option value="' + q + '"' + (q === s.wp ? ' selected' : '') + '>Lv' + q +
                '（' + wt + ' ＋' + n1(wk[q - 1] / 100) + '%）</option>';
            }
            html += '</select></div>';
          }
          // **固有武器 ★4 はスペシャルの枠だけ。**コストの上限が 1 人につき ＋0.5
          if (!isMain(i)) {
            html += '<div class="lv"><span>固有4</span>' +
              '<label class="tlx-chk"><input type="checkbox" data-k="w4" data-i="' + i + '"' +
              (s.w4 ? ' checked' : '') + '>上限 ＋' + n1(W4_CAP) + '</label></div>';
          }
          var hasOther = d.r && d.r.some(function (e) { return e.sl !== 'Ex'; });
          if (hasOther || START_COST[d.id]) {
            html += '<div class="lv"><span>' + (hasOther ? '他' : 'ノーマル') +
              '</span><select data-k="sk" data-i="' + i + '">';
            for (var w = 1; w <= 10; w++) html += '<option value="' + w + '"' + (w === s.sk ? ' selected' : '') + '>Lv' + w + '</option>';
            html += '</select></div>';
          }
          // 戦闘開始時にコストをくれる子は、その額をここに出す
          if (START_COST[d.id]) {
            var sc = START_COST[d.id];
            var sv = sc.v[Math.min(sc.v.length - 1, Math.max(0, s.sk - 1))] || 0;
            html += '<div class="lv"><span>開始</span><span class="lvnote">コスト ＋' + n1(sv) +
              (sc.per ? '（編成 1 人ごと・最大 ' + sc.per + ' 人）' : '') + '</span></div>';
          }
          (d.r || []).forEach(function (e, ei) {
            if (e.du > 0) {
              // **持続するバフに手を入れる欄はもう要らない。**この子が EX を
              // 撃った瞬間から自動で立って、時間で切れる（2026-08-30）
              html += '<div class="lv"><span>効果</span><span class="lvnote">' +
                esc(e.sn) + '／回復力 ' +
                n1(extend(d, s, e.du, e.p === 'party' ? 'ally' : 'self') / 1000) + ' 秒</span></div>';
            } else if (e.v.length > 1 && !e.cond) {
              html += '<div class="lv"><span>段</span><select data-k="tier" data-i="' + i + '" data-e="' + ei + '">';
              for (var t = 0; t < e.v.length; t++) html += '<option value="' + t + '"' + (t === (s.tier[ei] || 0) ? ' selected' : '') + '>' + (t + 1) + ' 段目</option>';
              html += '</select></div>';
            }
          });
          html += '<button type="button" class="btn rmv" data-k="rmv" data-i="' + i + '">外す</button>';
        } else {
          html += '<input type="search" list="' + g[3] + '" data-k="pick" data-i="' + i + '" placeholder="名前で探す" autocomplete="off">';
        }
        html += '</div>';
      }
      box.innerHTML = html;
    });
    // **候補から、もう入っている子を外す。**同じ子は 2 人まで入れられない
    var used = usedIds(-1);
    [['dl-main', 'Main'], ['dl-sup', 'Support']].forEach(function (g) {
      el(g[0]).innerHTML = D.students.filter(function (s) { return s.sq === g[1] && !used[s.id]; })
        .map(function (s) { return '<option value="' + esc(s.n) + '">'; }).join('');
    });
    [].forEach.call(el('mode').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.m === mode));
    });
  }

  function drawStats() {
    var p = pool();
    if (!p.ms.length) {
      el('o-sec').textContent = '—'; el('o-pool').textContent = '—'; el('o-rate').textContent = '—';
      el('o-sec-sub').textContent = '生徒を入れてください';
      el('o-pool-sub').textContent = ''; el('o-rate-sub').textContent = '';
      el('ledger').innerHTML = '';
      return p;
    }
    var rate = p.total / 10000;
    el('o-sec').textContent = n2(1 / rate);
    el('o-sec-sub').textContent = '秒／コスト（素は ' + n2(10000 / (D.base * LAYOUT[mode].main + D.base * LAYOUT[mode].sup)) + ' 秒）';
    el('o-pool').textContent = fmt(p.total);
    el('o-pool-sub').textContent = p.ms.length + ' 人ぶん（素は ' + fmt(D.base * p.ms.length) + '）';
    el('o-rate').textContent = n2(rate);
    el('o-rate-sub').textContent = '上限（' + n1(capNow()) + '）まで ' + n1(capNow() / rate) + ' 秒';

    var rows = '<div class="row"><span>素のコスト回復力<span class="subnote">' +
      D.base + ' × ' + p.ms.length + ' 人</span></span><span>' + fmt(D.base * p.ms.length) + '</span></div>';
    if (p.gb) rows += '<div class="row"><span>ステージ<span class="subnote">手で入れた実数</span></span><span>＋' +
      fmt(p.gb) + ' × ' + p.ms.length + ' 人</span></div>';
    if (p.gc) rows += '<div class="row"><span>ステージ<span class="subnote">手で入れた係数</span></span><span>＋' +
      n2(p.gc) + '%（全員）</span></div>';
    p.efs.forEach(function (x) {
      var val = x.e.k === 'b'
        ? '＋' + fmt(x.v) + (x.e.p === 'party' ? ' × ' + p.ms.length + ' 人' : '')
        : '＋' + n2(x.v / 100) + '%' + (x.e.p === 'party' ? '（全員）' : '（本人のみ）');
      var note = esc(x.e.sn);
      if (x.e.v.length > 1) note += '（' + (x.row + 1) + ' 段目）';
      if (x.e.du > 0) note += '／' + n1(x.e.du / 1000) + ' 秒';
      rows += '<div class="row"><span>' + esc(x.m.d.n) +
        '<span class="tag2">' + (x.e.sl === 'Ex' ? 'EX' : x.e.sl === 'Public' ? 'ノーマル' : 'パッシブ') + '</span>' +
        '<span class="subnote">' + note + '</span></span><span>' + val + '</span></div>';
    });
    rows += '<div class="row total"><span>合計</span><span>' + fmt(p.total) + '</span></div>';
    el('ledger').innerHTML = rows;
    return p;
  }

  /* 「戦闘のはじまり」の欄。**上限と開始コストは、編成から自分で決まる。** */
  function drawSetup() {
    var cap = capNow(), w4 = 0;
    slots.forEach(function (s, i) { if (s.id && s.w4 && !isMain(i) && live(i)) w4++; });
    el('o-capv').textContent = n1(cap);
    el('o-capnote').textContent = w4
      ? '素の ' + LAYOUT[mode].cap + ' ＋ 固有武器 ★4 のスペシャル ' + w4 + ' 人ぶん（＋' + n1(w4 * W4_CAP) + '）'
      : '素の ' + LAYOUT[mode].cap + '。スペシャルの枠で「固有4」に印を付けると ＋' + n1(W4_CAP) + ' ずつ増えます';

    var b = startBonus(), man = parseFloat(el('i-start').value) || 0;
    var note = el('start-note');
    if (!b) {
      note.hidden = true;
      note.textContent = '';
    } else {
      note.hidden = false;
      note.textContent = b.d.n + ' のノーマルスキル Lv' + b.lv + ' で ＋' + nn(b.amt) + ' コスト' +
        (b.per ? '（' + nn(b.v) + ' × ' + b.n + ' 人）' : '') +
        '。手で入れた ' + nn(man) + ' と合わせて、開始時は ' + nn(Math.min(cap, man + b.amt)) + ' コストです。' +
        (b.off.length ? b.off.join('・') + ' は、同じ効果が重ならないので不発です。' : '');
    }

    el('gims').innerHTML = gims.length ? gims.map(function (g, j) {
      return '<div class="tlx-gim"><span>' + clockIn(g.t) + ' から ' + n1(g.du) + ' 秒間' +
        '<small>コスト回復力 ' + (g.v >= 0 ? '＋' : '−') + fmt(Math.abs(g.v)) + '（合計に足します）</small></span>' +
        '<button type="button" class="btn" data-k="gim-del" data-j="' + j + '">×</button></div>';
    }).join('') : '<p class="lead" style="margin:0">まだありません。</p>';
  }

  /* ---------- 手札

     山札は編成人数ぶん。手札はその先頭 3 枚。1 枚使うと、そのカードは山札の
     一番下へ回り、山札の先頭から 1 枚引いて手札に加わる。**並びが決まれば
     そのあとはずっと決まる**ので、TL は毎回同じように再現できる。 */
  var HAND = 3;
  function deckOrder() {
    // 山札の並びは「TL に出てくる順」。開始スキルで指定するのがこれにあたる
    var seen = {}, deck = [];
    order.forEach(function (e) {
      if (!seen[e.i] && slots[e.i] && slots[e.i].id) { seen[e.i] = true; deck.push(e.i); }
    });
    members().forEach(function (m) { if (!seen[m.i]) { seen[m.i] = true; deck.push(m.i); } });
    return deck;
  }

  function playHand(deck) {
    var hand = deck.slice(0, HAND), rest = deck.slice(HAND);
    return {
      hand: function () { return hand.slice(); },
      /** 撃てたら true。撃てなければ手札を変えずに false */
      use: function (i) {
        var at = hand.indexOf(i);
        if (at < 0) return false;
        rest.push(i);                 // 使ったカードは山札の一番下へ
        hand[at] = rest.shift();      // 空いた枠に山札の先頭を引く
        return true;
      },
    };
  }

  /* コストの都合だけで、上から順に置いていく。
     撃っている間もコストは貯まり、次の EX はその演出が終わるまで撃てない。
     時刻を指定した行は、その時刻に足りているかを見て、足りなければ最短へずらす。 */
  /** スキルコストを下げる効果。**時間ではなく「使用 N 回ぶん」で切れる。**
      `coef` は 10000 分率（-5000 ＝ 50% 引き）で、**減る量のほうを切り捨てる**
      （スキル文の「ただし減少値は小数点以下切り捨て」がこれ）。
      `flat` は引く数そのもの。データは `Excel` ではなく SchaleDB の
      `Skills.Ex.Effects[].Type === "CostChange"` から来ている。 */
  function costAfter(need, cut) {
    if (!cut) return need;
    var down = cut.vt === 'coef' ? Math.floor(need * (-cut.sc / 10000)) : -cut.sc;
    return Math.max(0, need - down);
  }
  /** その発動で配られるコスト減少。**EX のレベルで回数が変わる子がいる**（セイア）。 */
  function grantOf(sk, ex) {
    var cc = sk && sk.cc;
    if (!cc) return null;
    var n = cc.up ? (cc.up[ex - 1] || 0) : cc.u;
    if (!n) return null;
    return { n: n, vt: cc.vt, sc: cc.sc[ex - 1] || 0, sd: cc.sd };
  }

  /** 回復力の入れもの。**1 人ごとに「（700 ＋ 実数）×（1 ＋ %）」を持って足す。**
      持続バフはここに出し入れする。重ねがけはせず、効いている間に撃ち直したら
      切れる時刻だけ延ばす（リフレッシュ）——これは kur-3dcg の TL 作成支援ツールと
      同じ扱いで、あちらの `buildAllBuffEvents` が同じことをしている。 */
  function Recovery(ms, base, gb, gc) {
    var per = {}, live = {}, flat = 0;
    ms.forEach(function (m) { per[m.i] = { b: base + gb, c: gc * 100 }; });
    function apply(x, sign) {
      var targets = x.e.p === 'party' ? ms : [x.m];
      targets.forEach(function (t) {
        if (!per[t.i]) return;
        if (x.e.k === 'b') per[t.i].b += sign * x.v; else per[t.i].c += sign * x.v;
      });
    }
    return {
      addStatic: function (x) { apply(x, 1); },
      /** ステージギミックぶん。**合計に足すだけで、誰の % 倍率も掛けない。** */
      addFlat: function (v) { flat += v; },
      /** key はスロット番号と効果番号。同じ効果を二重に立てない */
      start: function (key, x, end) {
        if (live[key]) { live[key].end = Math.max(live[key].end, end); return false; }
        live[key] = { end: end, x: x };
        apply(x, 1);
        return true;
      },
      next: function () {
        var t = Infinity;
        for (var k in live) if (live[k].end < t) t = live[k].end;
        return t;
      },
      expire: function (t) {
        for (var k in live) {
          if (live[k].end <= t + 1e-9) { apply(live[k].x, -1); delete live[k]; }
        }
      },
      /** 毎秒のコスト回復量 */
      rate: function () {
        var total = flat;
        ms.forEach(function (m) { total += per[m.i].b * (1 + per[m.i].c / 10000); });
        return total / 10000;
      },
    };
  }

  /* **戦闘が始まってすぐは貯まらない。**回復が動き出すのは 2.033 秒後。
     この値は自分で測ったものではなく、kur-3dcg の TL 作成支援ツールの
     `RECOVERY_DELAY_MS = 2033` に合わせている（2026-08-30）。 */
  var REC_DELAY = 2.033;

  function simulate(cap, start, base, gb, gc) {
    var ms = members();
    var rec = Recovery(ms, base, gb, gc);
    var all = effects();
    all.forEach(function (x) { if (!x.e.du) rec.addStatic(x); });
    /* 持続を持つ効果を、スロットごとに引けるようにしておく。
       **EX 本体のぶんと、それ以外（パッシブ・ノーマル）を分ける。**
       EX が途中で変わる子は、2 形態目以降だと本体のぶんが立たない。 */
    var timedEx = {}, timedOn = {};
    all.forEach(function (x) {
      if (!x.e.du) return;
      var box = x.e.sl === 'Ex' ? timedEx : timedOn;
      (box[x.m.i] = box[x.m.i] || []).push(x);
    });
    /** その形態が持っているコスト回復力の効果（キサキ（水着）の 2 形態目など）。 */
    function formEffects(mi, sk) {
      var m = null;
      ms.forEach(function (x) { if (x.i === mi) m = x; });
      if (!m || !sk.r) return [];
      return sk.r.map(function (en, k) {
        var arr = (en.v && en.v[0]) || [];
        var lv = (en.sl === 'Ex' ? m.s.ex : m.s.sk) - 1;
        var v = arr[Math.min(arr.length - 1, Math.max(0, lv))] || 0;
        return { m: m, e: en, v: v, ei: 'x' + k };
      }).filter(function (x) { return x.v && x.e.du; });
    }

    /* ステージギミック。**発動と終わりの時刻で回復力を出し入れする。**
       増やす量は合計にそのまま足す（誰かのステータスとしては数えない）。 */
    var gEdges = [];
    gims.forEach(function (g) {
      if (!g.v || !g.du) return;
      gEdges.push({ t: g.t, v: g.v }, { t: g.t + g.du, v: -g.v });
    });
    gEdges.sort(function (a, b) { return a.t - b.t; });
    var gAt = 0;

    /* ナギサ（水着）のオーバーコスト。**撃った瞬間から 26 秒間、渡した 1 人だけ**
       コストを −5 まで超過して払える。全枠が埋まっていないと立たない。 */
    var ovWin = [], curOv = -1;

    var t = 0, cost = Math.min(cap, start), lock = 0, out = [], segs = [{ t: 0, c: cost }];

    function syncGims() {
      while (gAt < gEdges.length && gEdges[gAt].t <= t + 1e-9) { rec.addFlat(gEdges[gAt].v); gAt++; }
    }
    syncGims();
    /** いま、この枠がコストをどこまで沈められるか。**普段は 0。** */
    function floorAt(at, i) {
      for (var k = 0; k < ovWin.length; k++) {
        var w = ovWin[k];
        if (w.to === i && at >= w.s - 1e-9 && at <= w.e + 1e-9) return OVER_FLOOR;
      }
      return 0;
    }
    function boundary() {
      var nx = rec.next();
      if (gAt < gEdges.length) nx = Math.min(nx, gEdges[gAt].t);
      ovWin.forEach(function (w) {
        if (w.to !== curOv) return;
        if (w.s > t + 1e-9) nx = Math.min(nx, w.s);
        if (w.e > t + 1e-9) nx = Math.min(nx, w.e);
      });
      if (t < REC_DELAY - 1e-9) nx = Math.min(nx, REC_DELAY);
      return nx;
    }
    function rateNow() { return t < REC_DELAY - 1e-9 ? 0 : rec.rate(); }

    /** target 秒まで進める。**途中でバフが切れたら、そこで率を切り替える。** */
    function advance(target) {
      var guard = 0;
      while (t < target - 1e-9 && guard++ < 4000) {
        var b = Math.min(target, boundary());
        var r = rateNow();
        cost = Math.min(cap, cost + r * (b - t));
        t = b;
        rec.expire(t);
        syncGims();
        segs.push({ t: t, c: cost });
      }
      if (t < target) t = target;
    }

    /** need コストに届く最短の時刻。**届かないなら null。**
        オーバーコストが立っている間は、下限（−5）ぶんだけ手前で撃てる。 */
    function reach(need, from) {
      advance(from);
      var guard = 0;
      while (guard++ < 4000) {
        var want = need + floorAt(t, curOv);   // これだけ持っていれば払える
        if (want > cap + 1e-9) {
          // 上限まで貯めても足りない。**あとで下限が下がるなら、そこまで待つ**
          var b0 = boundary();
          if (!isFinite(b0)) return null;
          advance(b0);
          continue;
        }
        if (cost >= want - 1e-9) return t;
        var r = rateNow(), b = boundary();
        if (r > 0) {
          var tt = t + (want - cost) / r;
          if (tt <= b + 1e-9) { advance(tt); return t; }
        }
        if (!isFinite(b)) return null;     // 率が 0 のまま動かない
        advance(b);
      }
      return null;
    }

    var deck = deckOrder(), play = playHand(deck);
    var cut = {};                       // cut[枠] = { n, vt, sc } 残り回数つき
    var used = {};                      // 枠ごとに「何回目か」
    order.forEach(function (e, idx) {
      var s = slots[e.i], d = byId[s.id];
      if (!d || !live(e.i)) { out.push({ e: e, d: null }); return; }
      // **何回目かで形態が変わる。**行で選んであればそちらが優先
      var fl = forms(d), u = used[e.i] || 0;
      used[e.i] = u + 1;
      var auto = autoForm(d, u);
      var fi = e.f == null ? auto : Math.max(0, Math.min(e.f, fl.length - 1));
      var sk = fl[fi];
      var raw = sk.c[s.ex - 1] || 0;
      var mine = cut[e.i];
      var need = costAfter(raw, mine);
      if (mine) { mine.n--; if (mine.n <= 0) delete cut[e.i]; }
      var t0 = Math.max(t, lock);
      curOv = e.i;
      var soon = reach(need, t0);
      var at = soon, why = '';
      if (soon === null) { why = 'コストの上限を超えています'; }
      else if (e.t != null) {
        if (e.t < soon - 1e-6) { why = '間に合いません（最短 ' + n1(soon) + ' 秒）'; at = soon; }
        else { at = e.t; advance(at); }
      }
      var rateAt = 0, over = false;
      if (at !== null) {
        segs.push({ t: at, c: cost });
        // **`fl`（形態の一覧）と名前をぶつけない。**ぶつけると行の「形態」欄が消える
        var flr = floorAt(at, e.i);
        cost = Math.max(flr, cost - need);
        over = cost < -1e-9;
        segs.push({ t: at, c: cost });
        lock = at + (sk.d || 0) / FPS;
        rateAt = rec.rate();
        // **撃った瞬間からバフが立つ。**同じ効果が生きていたら切れる時刻だけ延ばす
        var mine2 = (timedOn[e.i] || [])
          .concat(fi === 0 ? (timedEx[e.i] || []) : formEffects(e.i, sk));
        mine2.forEach(function (x) {
          var du = extend(d, s, x.e.du, x.e.p === 'party' ? 'ally' : 'self');
          rec.start(e.i + '/' + x.ei, x, at + du / 1000);
        });
        // **オーバーコストを配る。**全枠が埋まっていて、渡す先を選んであるときだけ
        if (d.id === NAGISA_SW && e.ov != null && partyFull() &&
            slots[e.ov] && slots[e.ov].id && live(e.ov)) {
          ovWin.push({ to: e.ov, s: at, e: at + extend(d, s, OVER_MS, 'ally') / 1000 });
        }
      }
      var hand = play.hand();
      var drawn = play.use(e.i);
      // **撃ったあとに配る。**自分の発動ぶんには効かない
      var gr = at === null ? null : grantOf(sk, s.ex);
      var to = null;
      if (gr) {
        to = gr.sd === 'self' ? e.i : (e.to == null ? null : e.to);
        if (to != null && slots[to] && slots[to].id && live(to)) {
          cut[to] = { n: gr.n, vt: gr.vt, sc: gr.sc };
        } else { to = null; }
      }
      out.push({ e: e, d: d, s: s, sk: sk, fi: fi, auto: auto, fl: fl, nth: u + 1,
                 need: need, raw: raw, cut: mine, at: at, soon: soon, why: why,
                 over: over, left: at === null ? 0 : cost, idx: idx, rate: rateAt,
                 hand: hand, inHand: drawn, grant: gr, to: to });
    });

    // 最後の 1 発のあとも、バフが切れるところまでは線を伸ばしておく。
    // **ステージギミックの切れ目も同じように追う**（最後の EX より後ろにあると、
    // そこで傾きが変わるのが図に出ないため）
    curOv = -1;
    var tailTo = t;
    for (var q = 0; q < 120; q++) {
      var nx = Math.min(rec.next(), gAt < gEdges.length ? gEdges[gAt].t : Infinity);
      if (!isFinite(nx)) break;
      if (nx > t) { advance(nx); tailTo = t; } else { rec.expire(t); syncGims(); }
    }
    return { rows: out, segs: segs, end: tailTo, cap: cap, rate: rec.rate(),
             deck: deck, ovWin: ovWin };
  }

  /** コスト減少を「誰に渡すか」。**ゲームが自動で選ぶ相手はデータに無い**ので、
      ここだけは手で決めてもらう。スキル文は「自身を除く味方1人」としか言わない。 */
  function giveSel(r, i) {
    var h = '<select data-k="give" data-j="' + i + '" aria-label="コスト減少を渡す先">' +
      '<option value="">渡さない</option>';
    members().forEach(function (m) {
      if (m.i === r.e.i) return;        // 「自身を除く」
      h += '<option value="' + m.i + '"' + (r.e.to === m.i ? ' selected' : '') + '>' +
        esc(m.d.n) + ' へ</option>';
    });
    return h + '</select>';
  }
  /** オーバーコストを渡す先。**スキル文は「味方 1 人」としか言わない**ので、
      コスト減少と同じように手で決めてもらう。付くのはストライカー（`AllyMain`）。 */
  function ovSel(r, i) {
    var h = '<select data-k="ovto" data-j="' + i + '" aria-label="オーバーコストを渡す先">' +
      '<option value="">渡さない</option>';
    members().forEach(function (m) {
      if (!isMain(m.i)) return;                 // Target は AllyMain
      h += '<option value="' + m.i + '"' + (r.e.ov === m.i ? ' selected' : '') + '>' +
        esc(m.d.n) + ' へ</option>';
    });
    return h + '</select>';
  }
  function ovHtml(r) {
    if (!r.d || r.d.id !== NAGISA_SW) return '';
    if (!partyFull()) return '<br><span class="cut2">枠が埋まっていないので、オーバーコストは立ちません</span>';
    if (r.e.ov == null) return '<br><span class="cut2">オーバーコストを誰にも渡していません</span>';
    var d = byId[slots[r.e.ov].id];
    return '<br>' + esc(d ? d.n : '？') + ' が ' + n1(extend(r.d, r.s, OVER_MS, 'ally') / 1000) +
      ' 秒間、コストを ' + neg(OVER_FLOOR) + ' まで超過して払えます';
  }
  /** 撃つ形態を選ぶ欄。**既定は自動**（何回目かで決める）。 */
  function formSel(r, i) {
    var h = '<select data-k="form" data-j="' + i + '" aria-label="撃つ形態">' +
      '<option value=""' + (r.e.f == null ? ' selected' : '') + '>自動（' +
      esc(r.fl[r.auto].n) + '）</option>';
    r.fl.forEach(function (f, k) {
      h += '<option value="' + k + '"' + (r.e.f === k ? ' selected' : '') + '>' +
        (k + 1) + ' 形態目 ' + esc(f.n) + '（' + (f.c[r.s.ex - 1] || 0) + '）</option>';
    });
    return h + '</select>';
  }
  /** スキル文の但し書き。**原文をそのまま畳んで出す。**
      複製・山札送り・ドローは、**このツールの計算には入れていない。** */
  function spHtml(r) {
    var sp = r.d.sp, out = '';
    if (r.fl.length > 1) out += '<br><span class="tlx-sp">形態：' + esc(formNote(r.d)) + '</span>';
    if (!sp) return out;
    var flags = [];
    ['draw', 'swap', 'copy', 'back', 'ovl'].forEach(function (k) {
      if (sp[k] == null || sp[k] === false) return;
      var t = SP_JA[k];
      if (k === 'draw') t = 'EX カードをすぐに ' + sp.draw + ' 回引きます' + (sp.drawCond ? '（条件つき）' : '');
      if (k === 'swap') t = '「' + sp.swap + '」にスキルが変わります';
      flags.push(t);
    });
    if (!flags.length && !(sp.txt || []).length) return out;
    out += '<details class="tlx-sp"><summary>このスキルの但し書き</summary>' +
      '<div>' + flags.map(function (t) { return esc(t); }).join('／') + '</div>' +
      (sp.txt || []).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') +
      ((sp.copy || sp.back || sp.draw)
        ? '<p class="tlx-warn">カードを引く・複製する・山札の一番下へ回す動きは、<b>このツールの手札の並びには入れていません。</b>ここだけ手で読み替えてください。</p>' : '') +
      '</details>';
    return out;
  }
  function giveHtml(r, i) {
    if (!r.grant) return '';
    var g = r.grant;
    var amt = g.vt === 'coef' ? Math.round(-g.sc / 100) + '%（切り捨て）' : g.sc * -1 + ' 引き';
    if (g.sd === 'self') return '<br>このあと自分の ' + g.n + ' 発ぶん、コスト ' + amt;
    if (r.to == null) return '<br><span class="cut2">コスト減少 ' + g.n + ' 発ぶんを誰にも渡していません</span>';
    var d = byId[slots[r.to].id];
    return '<br>' + esc(d ? d.n : '？') + ' の次の ' + g.n + ' 発ぶん、コスト ' + amt;
  }

  function drawTimeline(p) {
    var box = el('add'), html = '';
    slots.forEach(function (s, i) {
      var d = byId[s.id];
      if (!d || !live(i)) return;
      html += '<button type="button" class="btn" data-k="add" data-i="' + i + '">' +
        '<img src="' + face(d.id) + '" alt="" width="26" height="26" loading="lazy">' +
        esc(d.n) +
        skIcon(d) +
        '<small style="color:var(--fg-mute)">（' + d.c[s.ex - 1] + '）</small></button>';
    });
    box.innerHTML = html || '<span class="lead">先に編成を決めてください。</span>';

    if (!p.ms.length || !order.length) {
      el('timeline').innerHTML = ''; el('out').value = ''; el('chart').innerHTML = '';
      el('chart-lead').textContent = 'EX を並べると、コストが貯まって減っていく様子が出ます。';
      el('tl-lead').textContent = order.length ? '生徒を入れてください。' : 'まだ何も並んでいません。';
      return;
    }
    var cap = capNow();
    var b0 = startBonus();
    var start = (parseFloat(el('i-start').value) || 0) + (b0 ? b0.amt : 0);
    var sim = simulate(cap, start, D.base, p.gb, p.gc);
    lastSim = sim;

    el('timeline').innerHTML = sim.rows.map(function (r, i) {
      var fixed = r.e.t != null;
      // **`<b>` は使わない。**`.tlrow .tx b` が display: block なので、
      // 手札の中で太字にすると、そこで行が折れて「手札 ホシノ／・ハナコ」になる
      var names = r.hand.map(function (k) {
        var d = byId[slots[k].id], nm = esc(d ? d.n : '？');
        return k === r.e.i ? '<span class="me">' + nm + '</span>' : nm;
      }).join('・');
      var mark = '';
      if (!r.inHand) {
        mark = '<div class="cut bad"><span>' + esc(r.d.n) +
          ' はこのとき手札にありません（手札は ' + r.hand.map(function (k) {
            var d = byId[slots[k].id]; return d ? d.n : '？'; }).join('・') + '）</span></div>';
      }
      return mark + '<div class="tlrow' + (r.why || !r.inHand ? ' bad' : '') + '">' +
        '<span class="no">' + (i + 1) + '</span>' +
        '<img src="' + face(r.d.id) + '" alt="" width="40" height="40" loading="lazy">' +
        '<span class="tx"><b>' + esc(r.d.n) + '</b><small>' +
        icoOf(r.sk.ei) +
        esc(r.sk.n) +
        (r.fl.length > 1 ? '<span class="tag2">' + (r.fi + 1) + ' / ' + r.fl.length +
          ' 形態目・' + r.nth + ' 回目</span>' : '') + '／' +
        (r.cut ? '<span class="cut2">' + r.raw + ' → ' + r.need + '</span> コスト' : r.need + ' コスト') +
        (r.sk.d ? '／演出 ' + n1(r.sk.d / FPS) + ' 秒' : '') + '<br>手札 ' + names +
        giveHtml(r, i) + ovHtml(r) + spHtml(r) + '</small>' +
        '<span class="when"><select data-k="mode-at" data-j="' + i + '">' +
        '<option value="auto"' + (fixed ? '' : ' selected') + '>最短で</option>' +
        '<option value="fix"' + (fixed ? ' selected' : '') + '>この秒に</option></select>' +
        (fixed ? '<input type="number" step="0.1" min="0" data-k="at" data-j="' + i + '" value="' + r.e.t + '"> 秒' : '') +
        (r.grant && r.grant.sd === 'ally' ? giveSel(r, i) : '') +
        (r.d.id === NAGISA_SW && partyFull() ? ovSel(r, i) : '') +
        (r.fl.length > 1 ? formSel(r, i) : '') +
        '</span></span>' +
        '<span class="at">' + (r.at === null ? '撃てない' : n1(r.at) + ' 秒') +
        '<small>' + (r.why ? esc(r.why)
          : r.over ? 'オーバーコスト 残り ' + neg(n1(r.left)) + ' コスト'
          : '残り ' + n1(r.left) + ' コスト') + '</small></span>' +
        '<span class="ops"><button type="button" class="btn" data-k="up" data-j="' + i + '">↑</button>' +
        '<button type="button" class="btn" data-k="del" data-j="' + i + '">×</button></span></div>';
    }).join('');

    var ok = sim.rows.filter(function (r) { return r.d && r.at !== null; });
    var ng = sim.rows.filter(function (r) { return r.d && r.why; });
    var miss = sim.rows.filter(function (r) { return !r.inHand; });
    var pin = Math.min(LAYOUT[mode].start, sim.deck.length);
    var full = pin >= sim.deck.length - 1;
    el('tl-lead').textContent = (miss.length
      ? miss.length + ' 発、そのとき手札にありません。並べ直してください。'
      : ng.length
        ? ng.length + ' 発、指定した秒には撃てません。'
        : ok.length + ' 発ぜんぶ撃つのに、コストの都合では最短 ' +
          n1(ok.length ? ok[ok.length - 1].at : 0) + ' 秒かかります。') +
      (miss.length || !sim.deck.length ? ''
        : '山札は ' + sim.deck.length + ' 枚で、開始スキルで指定できるのは ' + pin + ' 人。' +
          (full ? '残りは自動で決まるので、この並びは最後まで再現できます。'
                : '指定できない ' + (sim.deck.length - pin) + ' 人ぶんは山札の順しだいです。'));

    /* 書き出し。**4 列の本体は今までと同じ形。**上に `#` で始まる 2 行を足した。
       1 行目に共有 URL が入っているので、**これをそのまま貼り戻すと編成ごと戻る。**
       `#` の行を消して本体だけ貼っても、名前から編成を組み直して読める。 */
    el('out').value = '# TL のコスト計算機　' + shareLink() + '\n' +
      '# 編成　' + members().map(function (m) { return m.d.n; }).join('・') + '\n' +
      sim.rows.filter(function (r) { return r.d && r.at !== null; })
      .map(function (r) {
        return clock(r.at) + '\t' + r.d.n + '\tEX' + r.s.ex + '\t' + r.need + 'コスト';
      }).join('\n');

    drawChart(sim);
  }

  /* コストの動き。**折れ線ひとつだけ。**軸は左に 1 本、EX を撃った点に縦の破線を引く */
  function drawChart(sim) {
    // **上に名札 2 段ぶんの余白を取る。**T=14 のままだと札が折れ線に重なり、
    // 名前を 4 文字で切っていたので「カンナ（」「ネル（制」になっていた
    // （2026-08-30 の先生の指摘「見切れてる」）
    var W = 760, H = 252, L = 34, R = 12, T = 48, B = 26;
    var last = sim.segs[sim.segs.length - 1];
    // **目標時刻とステージギミックも枠の中に入れる。**外に置くと線が引けない
    var span = Math.max(5, last.t + 3, goal == null ? 0 : goal + 2);
    gims.forEach(function (g) { span = Math.max(span, g.t + g.du + 2); });
    var cap = sim.cap;
    /* **下は 0 とは限らない。**ナギサ（水着）のオーバーコストでコストが沈むと
       マイナスまで下りるので、一番低いところまで軸を伸ばす */
    var lo = 0;
    sim.segs.forEach(function (q) { lo = Math.min(lo, q.c); });
    lo = Math.floor(lo);
    // 最後の点のあとも、上限まで貯まる様子を出す
    var pts = sim.segs.slice();
    var toCap = last.c >= cap ? 0 : (cap - last.c) / sim.rate;
    // **上限に届く時刻が枠の外なら、枠の右端までの途中までしか描かない。**
    // 無条件に「右端＝上限」へ線を引くと、実際より速く貯まって見える
    var tail = Math.min(span, last.t + toCap);
    pts.push({ t: tail, c: Math.min(cap, last.c + sim.rate * (tail - last.t)) });
    if (tail < span) pts.push({ t: span, c: cap });

    var x = function (t) { return L + (W - L - R) * (t / span); };
    var y = function (c) { return T + (H - T - B) * (1 - (c - lo) / (cap - lo)); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.c).toFixed(1); }).join(' ');
    var area = line + ' L' + x(span).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';

    var g = '', gstep = cap > 12 ? 5 : 2;
    for (var c = Math.ceil(lo / gstep) * gstep; c <= cap; c += gstep) {
      g += '<line class="grid" x1="' + L + '" y1="' + y(c).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(c).toFixed(1) + '"></line>' +
           '<text x="' + (L - 6) + '" y="' + (y(c) + 4).toFixed(1) + '" text-anchor="end">' + neg(c) + '</text>';
    }
    if (lo < 0) {
      // 0 の線だけは破線で強く出す。**ここから下がオーバーコスト**
      g += '<line class="cap" x1="' + L + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - R) +
           '" y2="' + y(0).toFixed(1) + '"></line>';
    }
    var step = span <= 30 ? 5 : span <= 90 ? 15 : 30;
    for (var t = 0; t <= span; t += step) {
      g += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + '秒</text>';
    }
    /* 撃った位置の名札。**名前は切らない。**「（水着）」のような括弧は 2 行目に回し、
       隣とぶつからないように 1 つおきに段を下げる。全文は <title> に残す */
    var fired = sim.rows.filter(function (r) { return r.d && r.at !== null; });
    var marks = fired.map(function (r, i) {
      var px = x(r.at), m = /^(.+?)[（(]([^）)]+)[）)]$/.exec(r.d.n);
      var l1 = m ? m[1] : r.d.n, l2 = m ? m[2] : '';
      // 端に寄った札は内側へ寄せる。真ん中揃えのままだと枠から出る
      var anchor = px < L + 28 ? 'start' : px > W - R - 28 ? 'end' : 'middle';
      var ty = 14 + (i % 2 ? 20 : 0);
      return '<line class="fire" x1="' + px.toFixed(1) + '" y1="' + T + '" x2="' + px.toFixed(1) +
        '" y2="' + y(0).toFixed(1) + '"></line>' +
        '<text class="n" x="' + px.toFixed(1) + '" y="' + ty + '" text-anchor="' + anchor + '">' +
        '<tspan x="' + px.toFixed(1) + '">' + esc(l1) + '</tspan>' +
        (l2 ? '<tspan x="' + px.toFixed(1) + '" dy="10">' + esc(l2) + '</tspan>' : '') +
        '<title>' + esc(r.d.n) + '　' + n1(r.at) + ' 秒</title></text>';
    }).join('');

    el('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="コストの動き">' +
      g + '<path class="area" d="' + area + '"></path><path class="line" d="' + line + '"></path>' +
      marks + goalMark(goal, x, T, y(lo), span) + '</svg>';
    el('chart-lead').textContent = '縦がコスト（上限 ' + n1(cap) + (lo < 0 ? '、下限 ' + neg(lo) : '') +
      '）、横が秒です。破線は EX を撃ったところ。'
      + '戦闘開始から ' + REC_DELAY + ' 秒は貯まりません。傾きが変わるところは、'
      + 'コスト回復力のバフが立ったか切れたところです。'
      + (goal == null ? '' : '赤い縦線が目標の ' + clockIn(goal) + ' です。');
    drawBars(sim, span, W, L, R);
  }

  /** 目標時刻の赤い縦線。**枠の外なら描かない。**
      札は線の右に置くが、**右端に寄っているときは左側へ回す**（切れるため）。 */
  function goalMark(sec, x, y0, y1, span) {
    if (sec == null || sec > span) return '';
    var px = x(sec), late = px > x(span) - 60;
    return '<line class="tlx-goal" x1="' + px.toFixed(1) + '" y1="' + y0 + '" x2="' + px.toFixed(1) +
      '" y2="' + y1 + '"></line>' +
      '<text class="tlx-goaltx" text-anchor="' + (late ? 'end' : 'start') + '" x="' +
      (late ? px - 4 : px + 4).toFixed(1) + '" y="' + (y0 + 10) + '">目標 ' + clockIn(sec) + '</text>';
  }

  /* バフの持続。**コストの図と横軸を揃えた帯。**
     どの効果がいつ切れるか、次の一手がその中に入っているかを見るためのもの。
     持続を持たない効果（撃った瞬間のダメージ・回復）は帯にならないので出さない。 */
  var SIDE_JA = { self: '本人', ally: '味方', enemy: '敵' };
  function drawBars(sim, span, W, L, R) {
    var bars = [];
    sim.rows.forEach(function (r) {
      if (!r.d || r.at === null || !r.sk || !r.sk.bf) return;
      r.sk.bf.forEach(function (b) {
        var du = extend(r.d, r.s, b.du, b.sd);
        // **秒数は帯の長さから引き算しない。**at が小数なので
        // 17.85 が 17.849999… になって、他の表示と 0.1 秒ずれる
        bars.push({ at: r.at, end: r.at + du / 1000, sec: du / 1000,
                    // **「◯◯特効」は相手の装甲・属性しだい。**印を分けて数える
                    n: r.d.n, e: b.n, sd: b.sd, grew: du > b.du, amp: /特効$/.test(b.n) });
      });
    });
    // オーバーコストの帯。**渡した子が、いつまで超過して払えるか。**
    (sim.ovWin || []).forEach(function (w) {
      var d = byId[slots[w.to] && slots[w.to].id];
      bars.push({ at: w.s, end: w.e, sec: w.e - w.s, n: d ? d.n : '？',
                  e: 'オーバーコスト（下限 ' + neg(OVER_FLOOR) + '）', sd: 'over', grew: false });
    });
    // ステージギミックの帯
    gims.forEach(function (g) {
      bars.push({ at: g.t, end: g.t + g.du, sec: g.du, n: 'ステージ',
                  e: 'コスト回復力 ' + (g.v >= 0 ? '＋' : '−') + fmt(Math.abs(g.v)), sd: 'gim', grew: false });
    });
    var box = el('bars'), lead = el('bars-lead');
    if (!bars.length) {
      box.innerHTML = '';
      lead.textContent = '並べた EX に持続する効果があると、ここに帯が出ます。';
      return;
    }
    var ROW = 22, T = 6, B = 22, H = T + ROW * bars.length + B;
    var x = function (t) { return L + (W - L - R) * (Math.min(t, span) / span); };
    var step = span <= 30 ? 5 : span <= 90 ? 15 : 30;
    var g = '';
    for (var t = 0; t <= span; t += step) {
      g += '<line class="grid" x1="' + x(t).toFixed(1) + '" y1="' + T + '" x2="' + x(t).toFixed(1) +
           '" y2="' + (H - B).toFixed(1) + '"></line>' +
           '<text x="' + x(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + t + '秒</text>';
    }
    var over = 0, amp = 0;
    bars.forEach(function (b) { if (b.amp) amp++; });
    var rows = bars.map(function (b, i) {
      var y = T + ROW * i + 3, h = ROW - 7;
      var x0 = x(b.at), x1 = x(b.end);
      if (b.end > span) over++;
      var w = Math.max(2, x1 - x0);
      // **切れる位置に印を付ける。**帯が枠の外まで伸びるときは付けない
      var endMark = b.end <= span
        ? '<line class="out" x1="' + x1.toFixed(1) + '" y1="' + (y - 2) + '" x2="' + x1.toFixed(1) +
          '" y2="' + (y + h + 2) + '"></line>' : '';
      // **札が右端からはみ出さないようにする。**帯が後ろのほうにあるときは
      // 帯の左に置くと枠の外に出るので、右端に寄せて右揃えにする
      var late = x0 > (W - R) * 0.62;
      return '<rect class="bar ' + b.sd + (b.amp ? ' amp' : '') + '" x="' + x0.toFixed(1) + '" y="' + y +
        '" width="' + w.toFixed(1) + '" height="' + h + '" rx="4"></rect>' + endMark +
        '<text class="lb" text-anchor="' + (late ? 'end' : 'start') + '" x="' +
        (late ? (W - R - 4) : (x0 + 6)).toFixed(1) + '" y="' + (y + h - 3) + '">' +
        esc(b.n) + '／' + esc(b.e) + ' ' + n1(b.sec) + '秒' +
        (b.grew ? '（固有で延長）' : '') + '</text>';
    }).join('');

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="バフの持続">' +
      g + rows + goalMark(goal, x, T, H - B, span) + '</svg>';
    lead.textContent = '帯 ' + bars.length + ' 本。左端が発動、右端の縦線で切れます。' +
      (over ? over + ' 本は図の右端より先まで続きます。' : '') +
      '色は本人（濃い）／味方（中）／敵（薄い）です。' +
      ((sim.ovWin || []).length ? 'オーバーコストの帯も出しています。' : '') +
      (gims.length ? 'ステージギミックの帯も出しています。' : '') +
      (amp ? 'うち ' + amp + ' 本は特効（点線の枠）で、相手の装甲や属性が合ったときだけ効きます。' : '');
  }

  function drawRefList() {
    var holders = D.students.filter(function (s) { return s.r && s.r.length; });
    holders.sort(function (a, b) { return a.n.localeCompare(b.n, 'ja'); });
    el('rlist-lead').textContent = '全 ' + D.students.length + ' 人のうち ' + holders.length +
      ' 人です。数値は右がスキル最大のときの値で、% は編成の全員にかかります。';
    el('rlist').innerHTML = holders.map(function (s) {
      var ef = s.r.map(function (e) {
        var row = e.v[e.v.length - 1] || [];
        var lo = row[0], hi = row[row.length - 1];
        var vs = e.k === 'b' ? '＋' + fmt(lo) + '〜' + fmt(hi)
                             : '＋' + n2(lo / 100) + '〜' + n2(hi / 100) + '%';
        return '<div>' + (e.sl === 'Ex' ? 'EX' : e.sl === 'Public' ? 'ノーマル' : 'パッシブ') +
          '「' + esc(e.sn) + '」<b>' + vs + '</b>' +
          (e.p === 'party' ? '（全員）' : '（本人）') +
          (e.du > 0 ? '／' + n1(e.du / 1000) + ' 秒' : '') + '</div>';
      }).join('');
      return '<div class="rcard"><img src="' + face(s.id) + '" alt="" width="46" height="46" loading="lazy">' +
        '<div><div class="nm">' + esc(s.n) + '</div><div class="ef">' + ef + '</div></div></div>';
    }).join('');
  }

  function shareLink() { return location.href.split('#')[0] + toHash(); }

  /** `M:SS.s` も `16.3` も秒にする。**読めなければ null。** */
  function parseClock(x) {
    x = String(x || '').trim().replace(/[：]/g, ':');
    var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(x);
    if (m) return +m[1] * 60 + +m[2];
    if (/^\d+(\.\d+)?$/.test(x)) return +x;
    return null;
  }

  /* 書き出したものを貼り戻す。**上の `#` 行に共有 URL があれば、それが正本。**
     無ければ 4 列（時刻・名前・EX・コスト）から編成と並びを組み直す。
     本体だけの場合、**撃たない子は書かれていないので回復力が変わる**。そのぶん
     時刻がずれるので、ずれた行は「この秒に」で貼られた時刻に留める。 */
  function importText(text) {
    var lines = String(text || '').split(/\r?\n/);
    var hash = null;
    lines.forEach(function (ln) {
      var m = /#((?:6|10)\|\S*)/.exec(ln);
      if (!hash && m) hash = '#' + m[1];
    });
    if (hash) {
      history.replaceState(null, '', hash);
      if (fromHash()) { draw(); return { n: order.length, way: 'url' }; }
    }
    var want = [], lost = [];
    lines.forEach(function (ln) {
      if (!ln.trim() || ln.trim().charAt(0) === '#') return;
      var f = ln.split('\t');
      if (f.length < 2) f = ln.trim().split(/[\s,]+/);
      var at = parseClock(f[0]), nm = (f[1] || '').trim();
      if (at == null || !nm) return;
      var mx = /EX\s*(\d)/i.exec(f[2] || '');
      want.push({ at: at, n: nm, ex: mx ? +mx[1] : 5 });
    });
    if (!want.length) return { n: 0, way: 'none' };

    // いま編成に入っている子で足りるなら、編成はそのままにする
    var here = {};
    slots.forEach(function (x, i) { if (x.id && live(i)) here[byId[x.id].n] = i; });
    var allHere = want.every(function (w) { return here[w.n] != null; });
    if (!allHere) {
      slots = [];
      for (var z = 0; z < MAIN_MAX + SUP_MAX; z++) slots.push(emptySlot());
      here = {};
      want.forEach(function (w) {
        if (here[w.n] != null) return;
        var d = D.students.filter(function (x) { return x.n === w.n; })[0];
        if (!d) { if (lost.indexOf(w.n) < 0) lost.push(w.n); return; }
        var from = d.sq === 'Main' ? 0 : MAIN_MAX;
        var to = d.sq === 'Main' ? LAYOUT[mode].main : MAIN_MAX + LAYOUT[mode].sup;
        for (var i = from; i < to; i++) {
          if (!slots[i].id) { slots[i] = emptySlot(); slots[i].id = d.id; slots[i].ex = w.ex; here[w.n] = i; return; }
        }
        if (lost.indexOf(w.n) < 0) lost.push(w.n + '（枠が足りません）');
      });
    }
    order = [];
    want.forEach(function (w) {
      var i = here[w.n];
      if (i == null) return;
      slots[i].ex = w.ex;
      order.push({ i: i, t: null, to: null, ov: null, f: null });
    });
    draw();
    // **貼られた時刻より遅くしか撃てない行だけ、時刻を留める。**
    var fix = 0;
    if (lastSim) {
      lastSim.rows.forEach(function (r, j) {
        if (!want[j] || r.at === null) return;
        if (want[j].at > r.at + 0.15) { order[j].t = Math.round(want[j].at * 10) / 10; fix++; }
      });
    }
    if (fix) draw();
    return { n: order.length, way: 'tsv', lost: lost, fix: fix };
  }

  /* ---------- 画像で保存

     **外のライブラリは読み込めない**ので、いま画面に出ている SVG を組み直して
     1 枚にし、`Image` 経由で `canvas` に描いて PNG にする。SVG を `<img>` に
     入れると外のスタイルシートは効かないので、**色は画面から読んで書き写す。** */
  function cssVars() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (k, d) { return (cs.getPropertyValue(k) || '').trim() || d; };
    return { fg: g('--fg', '#222'), mute: g('--fg-mute', '#777'), line: g('--line', '#ddd'),
             acc: g('--accent', '#c8892e'), accTx: g('--accent-tx', '#b5761c'),
             card: g('--card', '#fff') };
  }
  function svgInner(id) {
    var sv = el(id).querySelector('svg');
    if (!sv) return null;
    var vb = (sv.getAttribute('viewBox') || '0 0 760 0').split(/\s+/);
    return { w: +vb[2], h: +vb[3], body: sv.innerHTML };
  }
  function buildSheet(bg) {
    var c = cssVars(), W = 780, pad = 10, y = 0, parts = [];
    var rows = lastSim ? lastSim.rows.filter(function (r) { return r.d && r.at !== null; }) : [];
    y = 34;
    // **見出しは 1 行に収める。**編成が長いと枠から出るので、はみ出す前で切る
    var who = members().map(function (m) { return m.d.n; }).join('・');
    if (who.length > 26) who = who.slice(0, 26) + '…';
    parts.push('<text class="ttl" x="' + pad + '" y="22">TL のコスト計算機　' + esc(who) + '</text>');
    rows.forEach(function (r, i) {
      var yy = y + 16;
      parts.push('<text class="mn" x="' + pad + '" y="' + yy + '">' + (i + 1) + '</text>' +
        '<text class="tm" x="' + (pad + 26) + '" y="' + yy + '">' + clock(r.at) + '</text>' +
        '<text class="nm" x="' + (pad + 96) + '" y="' + yy + '">' + esc(r.d.n) + '</text>' +
        '<text class="mn" x="' + (pad + 290) + '" y="' + yy + '">EX' + r.s.ex +
          (r.fl && r.fl.length > 1 ? '・' + (r.fi + 1) + ' 形態目' : '') + '</text>' +
        '<text class="mn" x="' + (pad + 420) + '" y="' + yy + '">' + r.need + ' コスト</text>' +
        '<text class="mn" x="' + (pad + 510) + '" y="' + yy + '">残り ' + neg(n1(r.left)) + '</text>' +
        '<line class="gr" x1="' + pad + '" y1="' + (y + 22) + '" x2="' + (W - pad) + '" y2="' + (y + 22) + '"></line>');
      y += 22;
    });
    y += 10;
    ['chart', 'bars'].forEach(function (id) {
      var g = svgInner(id);
      if (!g) return;
      var sc = (W - pad * 2) / g.w;
      parts.push('<g transform="translate(' + pad + ',' + y + ') scale(' + sc.toFixed(4) + ')">' + g.body + '</g>');
      y += g.h * sc + 10;
    });
    var H = Math.ceil(y + 6);
    var st = 'text{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;fill:' + c.mute + ';font-size:11px}' +
      'text.ttl{fill:' + c.fg + ';font-size:15px;font-weight:700}' +
      'text.nm{fill:' + c.fg + ';font-size:13px;font-weight:700}' +
      'text.tm{fill:' + c.accTx + ';font-size:13px;font-weight:700}' +
      'line.gr{stroke:' + c.line + '}' +
      '.grid{stroke:' + c.line + '}.cap{stroke:' + c.line + ';stroke-dasharray:4 4}' +
      '.area{fill:' + c.acc + ';fill-opacity:.16}' +
      '.line{fill:none;stroke:' + c.accTx + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round}' +
      '.fire{stroke:' + c.accTx + ';stroke-width:1;stroke-dasharray:3 3}' +
      'text.n{fill:' + c.fg + ';font-weight:700}text.lb{fill:' + c.fg + ';font-weight:600}' +
      '.bar{fill:' + c.acc + '}.bar.self{fill:' + c.acc + ';fill-opacity:.78}' +
      '.bar.ally{fill:' + c.acc + ';fill-opacity:.46}.bar.enemy{fill:' + c.mute + ';fill-opacity:.3}' +
      '.bar.gim{fill:' + c.accTx + ';fill-opacity:.34}.bar.over{fill:' + c.accTx + ';fill-opacity:.2}' +
      '.bar.amp{stroke:' + c.accTx + ';stroke-width:1;stroke-dasharray:3 2}' +
      '.out{stroke:' + c.accTx + ';stroke-width:2}' +
      '.tlx-goal{stroke:#c0392b;stroke-width:1.5;stroke-dasharray:5 3}' +
      'text.tlx-goaltx{fill:#c0392b;font-weight:700}';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '"><style>' + st + '</style>' +
      (bg ? '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"></rect>' : '') +
      parts.join('') + '</svg>';
  }
  function savePng(bg) {
    if (!lastSim || !order.length) { toast('先に EX を並べてください'); return; }
    var svg = buildSheet(bg);
    var img = new Image();
    img.onload = function () {
      var sc = 2, cv = document.createElement('canvas');
      cv.width = img.width * sc; cv.height = img.height * sc;
      var cx = cv.getContext('2d');
      cx.scale(sc, sc);
      cx.drawImage(img, 0, 0);
      var a = document.createElement('a');
      a.download = 'tl-cost' + (bg ? '' : '-alpha') + '.png';
      a.href = cv.toDataURL('image/png');
      a.click();
      toast('画像を保存しました');
    };
    img.onerror = function () { toast('画像にできませんでした'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function draw() {
    // **並びから、居なくなった子を先に落とす。**行の番号と order の番号がずれると、
    // 「この秒に」の切り替えが別の行に効いてしまう
    order = order.filter(function (e) {
      return slots[e.i] && slots[e.i].id && byId[slots[e.i].id] && live(e.i);
    });
    drawParty();
    drawSetup();
    var p = drawStats();
    drawTimeline(p);
    save();
  }

  function findByName(name, sq, slot) {
    name = (name || '').trim();
    var used = usedIds(slot);
    var pick = D.students.filter(function (s) { return s.sq === sq && !used[s.id]; });
    var hit = pick.filter(function (s) { return s.n === name; });
    if (hit.length) return hit[0];
    hit = pick.filter(function (s) { return s.n.indexOf(name) === 0; });
    if (name && hit.length === 1) return hit[0];
    // 名前は合っているのに候補に無い＝もう編成に入っている
    var dup = D.students.filter(function (s) { return s.sq === sq && s.n === name; });
    return dup.length ? { dup: true, n: dup[0].n } : null;
  }
  function say(msg) {
    var e = el('err');
    if (!msg) { e.hidden = true; return; }
    e.hidden = false; e.textContent = msg;
  }

  /* ---------- 入力

     **候補をクリックしたときに `change` が来ないことがある。**その場では何も
     起きず、余所をクリックして初めて（＝ぼかしたときの `change` で）入る、
     という挙動になっていた（2026-08-30 に先生の指摘で気づいた）。
     `input` でも同じ処理を通す。ただし打っている途中で勝手に確定しないよう、
     `input` 側は**名前がぴったり一致したときだけ**受ける。 */
  function takePick(t, exactOnly) {
    var i = +t.dataset.i, sq = isMain(i) ? 'Main' : 'Support';
    var name = (t.value || '').trim();
    if (exactOnly && !D.students.some(function (s) { return s.sq === sq && s.n === name; })) return;
    var d = findByName(name, sq, i);
    if (!d) { if (!exactOnly) say('その名前の生徒が見つかりません。'); return; }
    if (d.dup) { say(d.n + ' はもう編成に入っています。同じ子は 1 人までです。'); return; }
    say('');
    slots[i] = { id: d.id, ex: 5, sk: 10, tier: {}, on: {} };
    draw();
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target, k = t.dataset && t.dataset.k;
    if (k === 'pick') {
      takePick(t, false);
    } else if (k === 'ex' || k === 'sk' || k === 'wp') {
      slots[+t.dataset.i][k] = +t.value; draw();
    } else if (k === 'tier') {
      slots[+t.dataset.i].tier[+t.dataset.e] = +t.value; draw();
    } else if (k === 'on') {
      slots[+t.dataset.i].on[+t.dataset.e] = t.checked; draw();
    } else if (k === 'w4') {
      slots[+t.dataset.i].w4 = t.checked; draw();
    } else if (k === 'form') {
      var jf = +t.dataset.j;
      if (order[jf]) order[jf].f = t.value === '' ? null : +t.value;
      draw();
    } else if (k === 'ovto') {
      var jo = +t.dataset.j;
      if (order[jo]) order[jo].ov = t.value === '' ? null : +t.value;
      draw();
    } else if (k === 'mode-at') {
      var j = +t.dataset.j, e2 = order[j];
      if (!e2) return;
      if (t.value === 'fix') {
        // **いま出ている時刻をそのまま初期値にする。**「この秒に」へ切り替えた
        // 瞬間に 0 秒へ飛ぶと、そこから打ち直しになって使いづらい
        var cur = lastSim && lastSim.rows[j] ? lastSim.rows[j].at : 0;
        e2.t = cur == null ? 0 : Math.round(cur * 10) / 10;
      } else { e2.t = null; }
      draw();
    } else if (k === 'give') {
      var jg = +t.dataset.j;
      if (order[jg]) order[jg].to = t.value === '' ? null : +t.value;
      draw();
    } else if (k === 'at') {
      var j2 = +t.dataset.j;
      if (order[j2]) order[j2].t = Math.max(0, parseFloat(t.value) || 0);
      draw();
    } else if (t.id === 'i-start' || t.id === 'i-gb' || t.id === 'i-gc') {
      draw();
    } else if (t.id === 'i-goal') {
      goal = parseClock(t.value);
      if (t.value.trim() && goal == null) say('目標時間は 3:00 のように入れてください。');
      else say('');
      draw();
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target, id = t.id;
    if (t.dataset && t.dataset.k === 'pick') { takePick(t, true); return; }
    if (id === 'i-start' || id === 'i-gb' || id === 'i-gc') draw();
  });

  function toast(msg) {
    var t = el('toast-page');
    if (!t) return;
    t.textContent = msg; t.classList.add('shown');
    setTimeout(function () { t.classList.remove('shown'); }, 2000);
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var k = b.dataset.k;
    if (k === 'rmv') {
      var i = +b.dataset.i;
      slots[i] = emptySlot();
      order = order.filter(function (e) { return e.i !== i; });
      draw();
    } else if (k === 'add') {
      order.push({ i: +b.dataset.i, t: null, to: null, ov: null, f: null }); draw();
    } else if (k === 'del') {
      order.splice(+b.dataset.j, 1); draw();
    } else if (k === 'up') {
      var j = +b.dataset.j;
      if (j > 0) { var tmp = order[j - 1]; order[j - 1] = order[j]; order[j] = tmp; }
      draw();
    } else if (b.dataset.m) {
      mode = +b.dataset.m;
      order = order.filter(function (e) { return live(e.i); });
      draw();
    } else if (k === 'gim-del') {
      gims.splice(+b.dataset.j, 1); draw();
    } else if (b.id === 'gim-add') {
      var gt = parseClock(el('i-gim-t').value), gv = parseFloat(el('i-gim-v').value),
          gd = parseFloat(el('i-gim-d').value);
      if (gt == null || !gv || !gd) { say('ギミックは 発動時刻・増加量・効果時間 の 3 つとも入れてください。'); return; }
      say('');
      gims.push({ t: gt, v: gv, du: Math.abs(gd) });
      gims.sort(function (a, c) { return a.t - c.t; });
      el('i-gim-t').value = ''; el('i-gim-v').value = ''; el('i-gim-d').value = '';
      draw();
    } else if (b.id === 'load-text') {
      var r = importText(el('in').value);
      if (r.way === 'url') toast('URL から ' + r.n + ' 発を読み込みました');
      else if (r.way === 'none') toast('読める行がありませんでした');
      else toast(r.n + ' 発を読み込みました' +
        (r.fix ? '（' + r.fix + ' 発は貼られた秒に留めました）' : '') +
        (r.lost && r.lost.length ? '／見つからない: ' + r.lost.join('・') : ''));
    } else if (b.id === 'png-white') {
      savePng('#ffffff');
    } else if (b.id === 'png-alpha') {
      savePng('');
    } else if (b.id === 'clear-tl') {
      order = []; draw();
    } else if (b.id === 'clear-party') {
      slots = []; for (var z2 = 0; z2 < MAIN_MAX + SUP_MAX; z2++) slots.push(emptySlot());
      order = []; say(''); draw();
    } else if (b.id === 'copy-url') {
      var url = location.href.split('#')[0] + toHash();
      history.replaceState(null, '', toHash());
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('URL をコピーしました'); },
          function () { toast('コピーできませんでした'); });
      } else { toast('この環境ではコピーできません'); }
    } else if (b.id === 'copy-text') {
      var tx = el('out').value;
      if (!tx) { toast('先に EX を並べてください'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tx).then(function () { toast('テキストをコピーしました'); },
          function () { toast('コピーできませんでした'); });
      } else { el('out').select(); toast('選択しました。手でコピーしてください'); }
    }
  });

  el('ver').textContent = D.version;
  // **URL が先、保存はそのあと。**人からもらったリンクを開いたときに上書きされない
  if (!fromHash()) load();
  drawRefList();
  draw();
})();
