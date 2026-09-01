/* TL のコスト計算そのもの。**DOM を一切見ない純関数の集まり。**

   `tools/cost-timeline/`（コストとスキル順のツール）と `tools/tl/`（TL エディタ）が
   同じ計算を使う。**片方に計算を書き足さない。**足すならこのファイル。
   中身は 2026-09-01 に `tools/cost-timeline/tl.js` から切り出したもので、
   **式も定数も原文のまま**運んである（切り出しの前後で返り値が 1 バイトも
   変わらないことを、共有リンク 7 通りで確かめた）。

   ---------- 渡す `input`（以下 `IN`）

   ひとつのオブジェクトにまとめる。**呼ぶ側が画面から集めて作る。**

     D      … `window.TL`（`tools/cost-timeline/data.js`）。`students` と `base` を見る
     mode   … 6（通常編成）か 10（制約解除決戦）
     slots  … 長さ 10 の枠。0〜5 がストライカー、6〜9 がスペシャル。
              1 枠は { id, ex, sk, wp, w4, tier, on }。空き枠は id が null
     order  … 撃つ順。1 行は { i: 枠番号, t: 指定した秒（null で最短）,
              to: コスト減少を渡す枠, ov: オーバーコストを渡す枠,
              f: 撃つ形態（null で自動）, bt: 味方バフ／複製の相手の枠 }
     gims   … ステージギミック { t: 発動する秒, v: 回復力の増加量, du: 効果時間の秒 }
     cap    … コストの上限（`TLENGINE.capNow(IN)` の返り）
     start  … 開始コスト（手入力 ＋ `TLENGINE.startBonus(IN)` の `amt`）
     base   … 素のコスト回復力。`D.base`（＝ 700）
     gb     … 装備で増えるコスト回復力（実数）
     gc     … 装備で増えるコスト回復力（%）
     show   … 帯の出し分け { ex, ns, pv }。`collectBars` だけが見る
     span   … 図の右端の秒。`collectBars` だけが見る

   **全部を要求するのは `simulate` と `collectBars` だけ。**下の方の関数は
   必要な欄しか読まない（例: `members(IN)` は D・mode・slots だけ）。
   `IN` は読むだけで、**書き換えない。**

   ---------- 出すもの

     simulate(IN)          -> { rows, segs, end, cap, rate, deck, ovWin }
                             `segs[].r` はその点から先の回復量（コスト/秒）
     collectBars(IN, sim)  -> 帯の配列。sim が null なら EX 抜き
     playHand(deck)        -> 手札の模擬（hand / isCopy / copyAt / use / copy）
     Recovery(ms, base, gb, gc) -> コスト回復力の入れもの
     そのほか（画面側も使う小物）: capNow / startBonus / partyFull / members /
     effects / pool / forms / autoForm / timedOf / condOf / mkBar / mergeSegs /
     extend / ovlMs / atLv / bfRow / bfTiered / isPct / redraws / isMain / live /
     costAfter / grantOf / deckOrder と、定数 LAYOUT / MAIN_MAX / SUP_MAX /
     W4_CAP / START_COST / OVER_FLOOR / REC_DELAY / TICK_MAX / FPS / FORM_RULE */
(function () {
  'use strict';
  var FPS = 30;                        // Duration はフレーム。ブルアカは 30fps

  /* **数を文にするのはここだけ。**`simulate` が行に入れる「間に合いません
     （最短 N 秒）」の N に要る。書式を画面側と分けると文言が食い違うので、
     この 1 本だけエンジンに置いて、画面側はこれを借りる。 */
  // **`-0` を出さない。**丸めた結果が 0 なのに符号だけ残ると「残り -0.0 コスト」になる
  function n1(v) { var r = Math.round(v * 10) / 10 || 0; return r.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

  /* 通常は ストライカー 4 ＋ スペシャル 2、制約解除決戦は 6 ＋ 4。
     枠の数はモードで変わるが、**slots の並びは常に「ストライカーが先」**にしておき、
     使わない後ろの枠は空のまま持っておく（モードを戻したときに編成が消えない）。 */
  // **`start` は開始スキルで順番を指定できる人数。**2026-05-27 のアップデートで
  // 通常編成 3→5、制約解除決戦 5→9 に増えた。ここまでは並べたとおりに撃てる
  var LAYOUT = { 6: { main: 4, sup: 2, cap: 10, start: 5 },
                 10: { main: 6, sup: 4, cap: 20, start: 9 } };
  var MAIN_MAX = 6, SUP_MAX = 4;

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
  var OVER_FLOOR = -5;
  /** その子の EX がオーバーコストを配るなら、その持続（ミリ秒）。**0 なら配らない。**
      **生徒 ID で決め打ちにしない**——`data.js` の `sp.ovl` を見る。
      いまは ナギサ（水着）（20048）だけが 26000 を持っている（2026-08-31 に
      274 人ぶんを数えて確かめた）。同じ効果の子が増えたら、そのまま動く */
  function ovlMs(d) { return (d && d.sp && d.sp.ovl) || 0; }

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
    // ヒナ（ドレス）は「集中射撃体勢に転換（10秒間）」→ 旋律の一音目・二音目・
    // 終演の旋律（終演で「集中射撃体勢解除」）で、**4 形態で 1 周する**。
    // 既定の hold だと 4 回目から 0 コストの「終演の旋律」に居座ってしまう
    10086: 'alt',
    // **撃つ前に選ぶ形。**基本の形態が「選択メニュー」で、スキル文が空・アイコンが
    // SELECTEXSKILL になっている（アリス（臨戦）・ミカ（水着）・ラブ）。自動で決めない
    10134: 'pick',
    10122: 'pick',
    16018: 'pick',
    // キサキ（水着）は「「実行：ばんざい体操」を2回使用後、「宣言：本日休業」に
    // スキルが変更されます」。**本体 → ばんざい体操 2 回 → 本体の 3 周期**で、
    // hold でも alt でも合わないので選ばせる
    10145: 'pick',
    // シュン（水着）は 9 秒間だけ変わる。時間で戻るので回数では決められない
    10143: 'pick',
    // トキは「アビ・エシュフでEXスキル3回使用時にモード解除」＝ 本体 → 強化 3 回の
    // 4 周期。ノア（パジャマ）は「「消灯後はお静かに」を 2 回使用時」＝ 本体 2 回 →
    // 強化 1 回の 3 周期。どちらも回数の規則が hold・alt のどちらとも違う
    10062: 'pick',
    10109: 'pick',
    // イブキ（16014）は「イロハの虎丸に搭乗した時」に変わる。**回数でも時間でもなく
    // 編成側の状態**なので、こちらでは決められない
    16014: 'pick',
  };
  function autoForm(d, used) {
    var n = forms(d).length;
    if (n < 2) return 0;
    var k = FORM_RULE[d.id] || 'hold';
    if (k === 'pick') return 0;
    if (k === 'alt') return used % n;
    return Math.min(used, n - 1);
  }

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

  // SchaleDB の `SkillTypeShort`。Public ＝ ノーマル、Passive ＝ パッシブ、
  // ExtraPassive ＝ サブ
  var SKJA = { Public: 'ノーマル', Passive: 'パッシブ', ExtraPassive: 'サブ' };

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  /** 効果の値の並び。**段のあるもの（`v` が二重配列）は 1 段目を使う。**
      段の決まり方はスキル文にしか書かれていないので、画面に「段あり」と出す。 */
  function bfRow(b) { var v = b.v || []; return (v.length && isArr(v[0])) ? (v[0] || []) : v; }
  function bfTiered(b) { var v = b.v || []; return v.length > 1 && isArr(v[0]); }
  /** レベルで 1 つ引く。**EX は 5 段（EX レベル）、それ以外は 10 段（スキルレベル）。** */
  function atLv(arr, s, isEx) {
    if (!arr || !arr.length) return 0;
    var lv = (isEx ? s.ex : s.sk) - 1;
    return arr[Math.min(arr.length - 1, Math.max(0, lv))] || 0;
  }
  /** `Stat` の末尾で足し算か掛け算かが決まる。**この 2 つを混ぜると答えが変わる。**
      `_Coefficient` は素の値に掛かる 10000 分率（2105 ＝ ×1.2105）、
      `_Base` はそのステータスの単位のまま足す。 */
  function statKind(st) { return /_Coefficient$/.test(st || '') ? 'c' : (/_Base$/.test(st || '') ? 'b' : ''); }
  function statRoot(st) { return String(st || '').replace(/_(Base|Coefficient)$/, ''); }
  /** その値が % で読むものか。**`_Coefficient` は必ず % で、`_Base` は
      ステータス名が `Rate` / `Ratio` で終わるものだけ %**（`EnhancePierceRate_Base`
      の 4983 は ＋49.83%、`AttackPower_Base` の 4983 は攻撃力 ＋4,983）。 */
  function isPct(st) {
    return statKind(st) === 'c' || /(Rate|Ratio\d*)$/.test(statRoot(st));
  }

  /** 属性特効。**受け取った子の攻撃属性が合っていないと乗らない**ので、
      攻撃力の倍率には混ぜず、誰に効くかを名指しで出す。 */
  var AMP_BT = { EnhanceExplosionRate: 'Explosion', EnhancePierceRate: 'Pierce',
                 EnhanceMysticRate: 'Mystic', EnhanceSonicRate: 'Sonic',
                 EnhanceNormalRate: 'Normal', EnhanceChemicalRate: 'Chemical' };

  /** その子の、時間軸に置けるスキル（`iv` を持つもの）。 */
  function timedOf(d) {
    var out = [];
    /* **「戦闘開始時、…（戦闘中に1回のみ）」型も時間軸に置く。**間隔は無いが
       発動する時刻（0 秒）が決まっているので、1 本だけ帯を引ける
       （2026-08-30 の先生の指示——「戦闘開始から何秒で発動するかは決まってる」） */
    if (d.ns && (d.ns.iv || (d.ns.once && d.ns.st != null))) {
      out.push({ g: 'ns', key: 'ns', ja: 'ノーマル', sk: d.ns });
    }
    (d.pv || []).forEach(function (p, i) {
      if (p.iv) out.push({ g: 'pv', key: 'pv' + i, ja: SKJA[p.sl] || 'パッシブ', sk: p });
    });
    return out;
  }
  /** 時刻を置けないスキル。**引き金の原文をそのまま持って出す。** */
  function condOf(d) {
    var out = [];
    if (d.ns && !d.ns.iv && !(d.ns.once && d.ns.st != null)) out.push({ ja: 'ノーマル', sk: d.ns });
    (d.pv || []).forEach(function (p) {
      if (!p.iv) out.push({ ja: SKJA[p.sl] || 'パッシブ', sk: p });
    });
    return out;
  }

  /** 帯 1 本ぶんの中身。**時刻はまだ入れない。** */
  function mkBar(d, s, b, isEx, key, si, kindJa, skn) {
    var cc = b.ty === 'CrowdControl';
    /* **CC の長さは `Scale` そのまま。**固有武器の延長（`ExtendDebuffDuration`）を
       掛けていないのは、CC がその対象かどうかをデータから確かめられないため。 */
    var ms = cc ? atLv(b.sc || [], s, isEx) : extend(d, s, b.du, b.sd);
    if (!ms) return null;
    var root = statRoot(b.st);
    return { key: key, si: si, who: d.n, d: d, s: s, e: b.n, sd: b.sd, ms: ms,
             grew: !cc && ms > b.du, cc: cc, ch: cc ? (b.ch == null ? 10000 : b.ch) : 10000,
             amp: !!AMP_BT[root], bt: AMP_BT[root] || '', kind: kindJa, skn: skn,
             st: b.st || '', root: root, k: statKind(b.st),
             v: cc ? 0 : atLv(bfRow(b), s, isEx), tier: bfTiered(b), ty: b.ty || '' };
  }

  /** 重なりをひとつにまとめる。**同じ効果は重ねがけにならず、切れる時刻だけ
      後ろにずれる**——このツールがコスト回復力のバフでやっているのと同じ扱い
      （`Recovery.start()`）に揃えてある。 */
  function mergeSegs(segs) {
    var a = segs.slice().sort(function (p, q) { return p[0] - q[0]; }), out = [];
    a.forEach(function (x) {
      var last = out[out.length - 1];
      if (last && x[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], x[1]);
      else out.push([x[0], x[1]]);
    });
    return out;
  }

  // 1 本の帯に置く発動の上限。**これを超えたら止めて、止めたと画面に出す**
  var TICK_MAX = 200;

  var _byIdD = null, _byId = null;
  /** `id → 生徒` の索引。**同じ `D` なら作り直さない。**`members()` は 1 回の
      描画で何十回も呼ばれるので、274 人ぶんを毎回積み直すと効いてくる。 */
  function byIdOf(D) {
    if (_byIdD === D) return _byId;
    var m = {};
    (D.students || []).forEach(function (s) { m[s.id] = s; });
    _byIdD = D; _byId = m;
    return m;
  }

  function isMain(i) { return i < MAIN_MAX; }
  function live(mode, i) { return isMain(i) ? i < LAYOUT[mode].main : i - MAIN_MAX < LAYOUT[mode].sup; }

  function members(IN) {
    var byId = byIdOf(IN.D), slots = IN.slots, mode = IN.mode;
    return slots.map(function (s, i) { return { i: i, s: s, d: byId[s.id] }; })
                .filter(function (m) { return m.d && live(mode, m.i); });
  }

  /** コストの上限。**素は 10（制約解除決戦は 20）で、固有武器 ★4 の
      スペシャル 1 人につき ＋0.5。** */
  function capNow(IN) {
    var mode = IN.mode, slots = IN.slots;
    var cap = LAYOUT[mode].cap;
    slots.forEach(function (s, i) {
      if (s.id && s.w4 && !isMain(i) && live(mode, i)) cap += W4_CAP;
    });
    return cap;
  }
  /** 全部の枠が埋まっているか。**オーバーコストの条件。** */
  function partyFull(IN) {
    return members(IN).length === LAYOUT[IN.mode].main + LAYOUT[IN.mode].sup;
  }
  /** 戦闘開始時にもらえるコスト。**シュンが居るとシュン（水着）は不発。** */
  function startBonus(IN) {
    var ms = members(IN);
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

  /* ---------- 効いているコスト回復力のスキル */
  function effects(IN) {
    var ms = members(IN), out = [];
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
  function pool(IN) {
    var ms = members(IN), efs = effects(IN).filter(function (x) { return !x.e.du; });
    var gb = IN.gb || 0;
    var gc = IN.gc || 0;
    var per = {};
    ms.forEach(function (m) { per[m.i] = { b: IN.base + gb, c: gc * 100 }; });
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

  /* ---------- 手札

     山札は編成人数ぶん。手札はその先頭 3 枚。1 枚使うと、そのカードは山札の
     一番下へ回り、山札の先頭から 1 枚引いて手札に加わる。**並びが決まれば
     そのあとはずっと決まる**ので、TL は毎回同じように再現できる。 */
  var HAND = 3;
  function deckOrder(IN) {
    var slots = IN.slots, order = IN.order;
    // 山札の並びは「TL に出てくる順」。開始スキルで指定するのがこれにあたる
    var seen = {}, deck = [];
    order.forEach(function (e) {
      if (!seen[e.i] && slots[e.i] && slots[e.i].id) { seen[e.i] = true; deck.push(e.i); }
    });
    members(IN).forEach(function (m) { if (!seen[m.i]) { seen[m.i] = true; deck.push(m.i); } });
    return deck;
  }

  function playHand(deck) {
    var hand = deck.slice(0, HAND), rest = deck.slice(HAND);
    /* **複製カード。**リオの EX「ビッグシスター」だけが作る。
       スキル文は「EXスキルをすぐにドロー後、味方1人のEXスキルカードを複製
       （複製したカードの使用は1回まで）」。**山札には戻さずに自分のカードを
       引き直し、そのカードが相手の EX カードに化ける。**
       `owner` がリオの枠、`of` が化けている相手の枠。 */
    var cp = null;
    return {
      hand: function () {
        var h = hand.slice();
        if (cp) { var k = h.indexOf(cp.owner); if (k >= 0) h[k] = cp.of; }
        return h;
      },
      /** その枠が「複製カード」で撃てるか。**コストが 1 安いのはこのときだけ。** */
      isCopy: function (i) { return !!cp && cp.of === i && hand.indexOf(cp.owner) >= 0; },
      /** 手札の何枚目が複製カードか。**同じ子の本物と並ぶことがある**ので、
          名前だけでは見分けが付かない（−1 なら複製は無い） */
      copyAt: function () { return cp ? hand.indexOf(cp.owner) : -1; },
      /** 撃てたら true。撃てなければ手札を変えずに false。
          `keep` は「山札に戻さず、その場で引き直す」（リオの「すぐにドロー」）。 */
      use: function (i, keep) {
        if (cp && cp.of === i) {
          var k = hand.indexOf(cp.owner);
          if (k >= 0) {
            // **複製を使い切ると、そこでリオが山札の一番下へ回る**
            rest.push(cp.owner);
            hand[k] = rest.shift();
            cp = null;
            return true;
          }
        }
        var at = hand.indexOf(i);
        if (at < 0) return false;
        if (keep) return true;
        rest.push(i);                 // 使ったカードは山札の一番下へ
        hand[at] = rest.shift();      // 空いた枠に山札の先頭を引く
        return true;
      },
      /** リオが撃ったあと、手札に残っている自分のカードを相手のものに化けさせる。 */
      copy: function (owner, of) {
        if (hand.indexOf(owner) < 0) return false;
        cp = { owner: owner, of: of };
        return true;
      },
    };
  }

  /** 撃ったあと、そのカードが手札に戻るか。
      「EXスキルをすぐに1回ドロー」＝**撃った本人のカードがそのまま手札に戻る**
      （2026-08-31 に先生へ確認。ネル（制服）が 1 コストの EX を撃った直後に
      4 コストの「怪我しても知らねえからな」を撃てるのがこれ）。

      **条件つきの 2 人は数えない。**ハナコ（水着）は「水ゲージが1つ以上の場合」、
      ヒヨリ（水着）は「EX充電ゲージが1つ以上の場合」で、そのゲージを
      このツールは持っていない。**戻るかどうかを決められないので、
      今までどおり山札の一番下へ回す。**

      **形態が変わったあとは戻らない。**この一文を持っているのは基本の形態だけ
      （ネル（制服）の「怪我しても知らねえからな」には無い）。 */
  function redraws(d, fi) {
    return !!(d && d.sp && d.sp.draw && !d.sp.drawCond && fi === 0);
  }

  /* コストの都合だけで、上から順に置いていく。撃っている間もコストは貯まる。
     時刻を指定した行は、その時刻に足りているかを見て、足りなければ最短へずらす。

     **コストさえあれば EX は連続で発動できる**（2026-09-01 の先生の指摘）。
     それまでは「次の EX は前の演出が終わるまで撃てない」として全員ぶんを直列に
     積んでいて、公開されている実物の TL を写すと 11 発中 8 発が後ろへずれていた。
     同じ子が続けて撃てないのは手札のほう（`playHand`）が見ている。

     **待つのは「その子自身」だけ**（`lockOf`。2026-09-01 の先生の指摘
     「EX と NS は同時発動出来ないはず」）。1 人が 2 つのスキルを同時には
     出せないので、次の形態はその子の演出が明けてから。 */
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

  /** 図に出す帯を全部集める。**EX は撃った行から、それ以外は発動間隔から。**
      `sim` が無いとき（まだ EX を並べていないとき）は EX 抜きで返す。 */
  function collectBars(IN, sim) {
    var show = IN.show || { ex: true, ns: true, pv: true }, span = IN.span;
    var out = [];
    if (sim && show.ex) sim.rows.forEach(function (r) {
      if (!r.d || r.at === null || !r.sk || !r.sk.bf) return;
      r.sk.bf.forEach(function (b, bi) {
        var one = mkBar(r.d, r.s, b, true, 'ex' + r.idx + '.' + bi, r.e.i, 'EX', r.sk.n);
        if (!one) return;
        /* **効果が乗るのは撃った瞬間ではない。**`ApplyFrame` が着弾までの
           フレーム数で、30 フレーム = 1 秒（`build-tool-data.py` が `af` に
           秒で入れてある）。ヒマリの攻撃力バフが 1.00 秒、リオが 3.77 秒で、
           TL を作っている人の実測（リオ 3.800 秒 / ヒマリ 1.000 秒。
           https://note.com/takoyakiak47/n/nfe0f914f730d ）と合う */
        var lag = b.af || 0;
        one.segs = [[r.at + lag, r.at + lag + one.ms / 1000]];
        one.iv = 0; one.lag = lag; one.afu = !!b.afu;
        // **味方バフの相手。**`null` は全員（既定）
        one.rcv = (r.e && r.e.bt != null) ? r.e.bt : null;
        out.push(one);
      });
    });
    members(IN).forEach(function (m) {
      timedOf(m.d).forEach(function (t) {
        if (!show[t.g]) return;
        (t.sk.bf || []).forEach(function (b, bi) {
          var one = mkBar(m.d, m.s, b, false, m.i + '.' + t.key + '.' + bi, m.i, t.ja, t.sk.n);
          if (!one) return;
          /* **初回は 0 秒とは限らない。**スキル文が
             「戦闘開始時とそれ以降、40秒毎に」と「40秒毎に」を書き分けていて、
             後者は 1 回目も 40 秒後（`build-tool-data.py` が `st` に入れてある。
             274 人を数えて、書き分けている子はレンゲ（水着）と マコト（水着）の
             2 人だけだと確かめた。2026-08-30 の先生の指摘を受けて調べた）。
             そこから更に `af`（着弾までの秒）だけ後ろへずれる。 */
          var lag = b.af || 0;
          var st0 = (t.sk.st == null ? 0 : t.sk.st) + lag;
          var segs = [], cut = false;
          if (!t.sk.iv) {
            // 1 回きり型。戦闘中に 1 回しか出ない
            segs.push([st0, st0 + one.ms / 1000]);
          } else {
            for (var k = 0; ; k++) {
              var at = st0 + k * t.sk.iv;
              if (at > span) break;
              if (segs.length >= TICK_MAX) { cut = true; break; }
              segs.push([at, at + one.ms / 1000]);
            }
          }
          one.segs = segs; one.iv = t.sk.iv; one.cut = cut;
          one.st0 = st0; one.lag = lag; one.once = !!t.sk.once;
          /* **引き金が先にあると初回の時刻を置けない。**「HPが30%以下の時、4秒毎に」の
             ホシノがそれで、274 人のうち 1 人だけ。0 秒から引くが、
             **「いつ始まるかは条件しだい」と見出しに出す**（黙って 0 秒に置かない） */
          one.cond = t.sk.cond || ''; one.hasSt = t.sk.st != null;
          one.afu = !!b.afu;
          out.push(one);
        });
      });
    });
    out.forEach(function (b) { b.segs = mergeSegs(b.segs); });
    return out;
  }

  function simulate(IN) {
    var byId = byIdOf(IN.D), mode = IN.mode, slots = IN.slots,
        order = IN.order, gims = IN.gims;
    var cap = IN.cap, start = IN.start, base = IN.base, gb = IN.gb, gc = IN.gc;
    var ms = members(IN);
    var rec = Recovery(ms, base, gb, gc);
    var all = effects(IN);
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

    /* 枠ごとの「演出が明ける時刻」。**全体の待ちではなく、その子だけの待ち。** */
    var lockOf = {};

    // `segs` の `r` は**その点から先の回復量（コスト/秒）**。画面が回復力の
    // レーンを階段で描くのに要る（2026-09-01 に足した。判定には使っていない）
    var t = 0, cost = Math.min(cap, start), out = [], segs = [{ t: 0, c: cost, r: 0 }];

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
        segs.push({ t: t, c: cost, r: rateNow() });
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

    var deck = deckOrder(IN), play = playHand(deck);
    var cut = {};                       // cut[枠] = { n, vt, sc } 残り回数つき
    var used = {};                      // 枠ごとに「何回目か」
    order.forEach(function (e, idx) {
      var s = slots[e.i], d = byId[s.id];
      if (!d || !live(mode, e.i)) { out.push({ e: e, d: null }); return; }
      // **何回目かで形態が変わる。**行で選んであればそちらが優先
      var fl = forms(d), u = used[e.i] || 0;
      used[e.i] = u + 1;
      var auto = autoForm(d, u);
      var fi = e.f == null ? auto : Math.max(0, Math.min(e.f, fl.length - 1));
      var sk = fl[fi];
      /* **複製カードで撃つと、基本コストから 1 引いた値になる（最小 0）。**
         スキル文の「複製したカードのコストは、対象のEXスキルの基本コストから
         1減少した値を持ちます（最小0）」がこれ。**カードに乗っている
         コスト減少はそのまま効く**（「複製したカードは、対象のEXスキルの
         カード状態に従います」）ので、引き算の順はここ→ costAfter。 */
      var isCopy = play.isCopy(e.i);
      var raw = sk.c[s.ex - 1] || 0;
      if (isCopy) raw = Math.max(0, raw - 1);
      var mine = cut[e.i];
      var need = costAfter(raw, mine);
      if (mine) { mine.n--; if (mine.n <= 0) delete cut[e.i]; }
      var t0 = t;
      curOv = e.i;
      var soon = reach(need, t0);
      var at = soon, why = '';
      if (soon === null) { why = 'コストの上限を超えています'; }
      else if (e.t != null) {
        if (e.t < soon - 1e-6) { why = '間に合いません（最短 ' + n1(soon) + ' 秒）'; at = soon; }
        else { at = e.t; advance(at); }
      }
      /* **同じ子は、前の演出が終わるまで次を撃てない。**
         別の子どうしは待たない（2026-09-01 の先生の指摘）が、1 人が 2 つの
         スキルを同時には出せない。**ヒナ（ドレス）のように次の形態のコストが
         0 の子は、これが無いと 4 発が同じ瞬間に重なる**（2026-09-01 に実測）。 */
      if (at !== null) {
        var lk = lockOf[e.i] || 0;
        if (at < lk - 1e-6) {
          at = lk;
          if (!why) { why = '前の演出が終わっていません（' + n1(lk) + ' 秒から）'; }
          advance(at);
          if (cost < need - 1e-9) { at = reach(need, at); }
        }
      }
      var rateAt = 0, over = false;
      if (at !== null) {
        segs.push({ t: at, c: cost, r: rateNow() });
        // **`fl`（形態の一覧）と名前をぶつけない。**ぶつけると行の「形態」欄が消える
        var flr = floorAt(at, e.i);
        cost = Math.max(flr, cost - need);
        over = cost < -1e-9;
        segs.push({ t: at, c: cost, r: rateNow() });
        rateAt = rec.rate();
        lockOf[e.i] = at + (sk.d || 0) / FPS;
        // **撃った瞬間からバフが立つ。**同じ効果が生きていたら切れる時刻だけ延ばす
        var mine2 = (timedOn[e.i] || [])
          .concat(fi === 0 ? (timedEx[e.i] || []) : formEffects(e.i, sk));
        mine2.forEach(function (x) {
          var du = extend(d, s, x.e.du, x.e.p === 'party' ? 'ally' : 'self');
          rec.start(e.i + '/' + x.ei, x, at + du / 1000);
        });
        // **オーバーコストを配る。**全枠が埋まっていて、渡す先を選んであるときだけ
        if (ovlMs(d) && e.ov != null && partyFull(IN) &&
            slots[e.ov] && slots[e.ov].id && live(mode, e.ov)) {
          ovWin.push({ to: e.ov, s: at, e: at + extend(d, s, ovlMs(d), 'ally') / 1000 });
        }
      }
      var hand = play.hand(), handCp = play.copyAt();
      /* **「すぐにドロー」を持つ子は、山札に戻さずそのまま手札に残す。**
         リオはそのうえで、そのカードを相手の EX カードに化けさせる */
      var keep = !isCopy && at !== null && redraws(d, fi);
      var mkCopy = keep && d.sp && d.sp.copy &&
                   e.bt != null && slots[e.bt] && slots[e.bt].id &&
                   live(mode, e.bt) && isMain(e.bt) && e.bt !== e.i;
      var drawn = play.use(e.i, keep);
      if (drawn && mkCopy) play.copy(e.i, e.bt);
      // **撃ったあとに配る。**自分の発動ぶんには効かない
      var gr = at === null ? null : grantOf(sk, s.ex);
      var to = null;
      if (gr) {
        to = gr.sd === 'self' ? e.i : (e.to == null ? null : e.to);
        if (to != null && slots[to] && slots[to].id && live(mode, to)) {
          cut[to] = { n: gr.n, vt: gr.vt, sc: gr.sc };
        } else { to = null; }
      }
      out.push({ e: e, d: d, s: s, sk: sk, fi: fi, auto: auto, fl: fl, nth: u + 1,
                 need: need, raw: raw, cut: mine, at: at, soon: soon, why: why,
                 over: over, left: at === null ? 0 : cost, idx: idx, rate: rateAt,
                 t0: t0,
                 hand: hand, handCp: handCp, inHand: drawn, grant: gr, to: to,
                 isCopy: isCopy, kept: !!(drawn && keep), madeCopy: !!(drawn && mkCopy) });
    });

    // 最後の 1 発のあとも、バフが切れるところまでは線を伸ばしておく。
    // **ステージギミックの切れ目も同じように追う**（最後の EX より後ろにあると、
    // そこで傾きが変わるのが図に出ないため）
    curOv = -1;
    /* **回復が始まる 2.033 秒の段は必ず刻む。**何も置いていないと `segs` が
       t=0 の 1 点だけになって、画面の回復力レーンが 0 のままだった
       （2026-09-01 の先生の指摘「なんで初動のコスト回復力０なの？」）。 */
    if (t < REC_DELAY) { advance(REC_DELAY); }
    var tailTo = t;
    for (var q = 0; q < 120; q++) {
      var nx = Math.min(rec.next(), gAt < gEdges.length ? gEdges[gAt].t : Infinity);
      if (!isFinite(nx)) break;
      if (nx > t) { advance(nx); tailTo = t; } else { rec.expire(t); syncGims(); }
    }
    return { rows: out, segs: segs, end: tailTo, cap: cap, rate: rec.rate(),
             deck: deck, ovWin: ovWin };
  }

  window.TLENGINE = {
    // ---- 本体
    simulate: simulate, collectBars: collectBars,
    playHand: playHand, Recovery: Recovery,
    // ---- 画面の状態から数を出すもの（どれも IN を取る）
    members: members, effects: effects, pool: pool,
    capNow: capNow, startBonus: startBonus, partyFull: partyFull, deckOrder: deckOrder,
    // ---- 生徒 1 人ぶんの小物（IN は要らない）
    forms: forms, autoForm: autoForm, timedOf: timedOf, condOf: condOf,
    mkBar: mkBar, mergeSegs: mergeSegs, extend: extend, ovlMs: ovlMs,
    redraws: redraws, costAfter: costAfter, grantOf: grantOf,
    atLv: atLv, bfRow: bfRow, bfTiered: bfTiered, isPct: isPct,
    isMain: isMain, live: live, byId: byIdOf,
    // ---- 定数。**画面側が文言に使うので、こちらを正本にする**
    LAYOUT: LAYOUT, MAIN_MAX: MAIN_MAX, SUP_MAX: SUP_MAX, W4_CAP: W4_CAP,
    START_COST: START_COST, OVER_FLOOR: OVER_FLOOR, REC_DELAY: REC_DELAY,
    TICK_MAX: TICK_MAX, FPS: FPS, FORM_RULE: FORM_RULE, HAND: HAND,
    n1: n1,
  };
}());
