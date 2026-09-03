import { $, B, S, rest } from './util.js';
import { st } from './core.js';
import { has } from './boss.js';
import { altOf } from './alt.js';
import { NICK } from './parse-apply.js';

// ------------------------------------------------- 文章で書いた TL を読む
/* 先生が使っている書き方をそのまま読む（2026-09-01 に実物をもらった）。
   **読めなかった行は捨てずに全部返して画面に出す。**憶測で埋めない。

   読める書き方
     使用生徒詳細 の行 … 「セイア(水着)　固有1　MMMM　t6/10/10」
     開始SET       … 「開始SET：①イブキ ②セイア ③ネル ④リオ ⑤水着セイア」
     丸数字        … 「⑦セイア」＝ コスト 7 で撃つ（md:'c'）
     残り時間      … 「2:30.100 リオ」＝ 残り 2 分 30.100 秒（md:'t'）
     前からの秒数  … 「9.5 Cネル」＝ 直前の 9.5 秒あと（md:'t'）
     即 / AUTO / 〜後 … 撃てる最短（md:'e'）。
       AUTO は「次の順のスキルが最速で出る」なので最短と同じ扱い
       （2026-09-01 の先生の説明）
     C◯◯          … リオがコピーした◯◯。engine の play.copy がそのまま拾う
     ※バフは全て◯◯指定 … 渡し先を全員ぶんまとめて◯◯へ */
export var CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// **黒丸数字でコストを書く人がいる**（2026-09-02、大決戦カイテンジャーの TL。
// 33 行すべてが「タイミングが読めません」で落ちていた）
export var CIRC2 = '❶❷❸❹❺❻❼❽❾❿';
export function zen0(x) { return String(x).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
export function nrm(s) {
  return String(s == null ? '' : s)
    .replace(/（/g, '(').replace(/）/g, ')')
    // **ゼロ幅空白を落とす。**YouTube の概要欄をコピーすると行頭に U+200B が
    // 付いてくることがある（2026-09-02、グレゴリオの「​⑨ミネ」で気づいた。
    // `charAt(0)` が丸数字にならず「タイミングが読めません」になっていた）
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    // **全角の数字を半角に。**「８　ホシノ」のようにコストを全角で書く TL があり、
    // コストの読み取りが数字に当たらず全部「即」に化けていた（2026-09-03、初見の TL 4 本の
    // 答え合わせで判明）。**丸数字（①②③）は形態の番号なので触らない。**
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[\s　]/g, '');
}
// 「セイア(水着)」に対して ['セイア(水着)', '水着セイア'] を返す。base は 'セイア'
// **「ホシノ（臨戦）／アタッカー」のように「／」で枝分かれする子がいる。**
// TL は「臨戦ホシノ」としか書かないので、「／」から後ろを落とした形も候補に
// 入れる（2026-09-01。入れる前は 1 人も当たらなかった）
export function aliasOf(nm) {
  // **生徒名側の ＊ も落とす**（「シロコ＊テラー」。findStudent は問い合わせ側だけ落としていて、
  // 育成行の名前引きと TL の行の両方で見つからなかった。2026-09-02、グミの報告）
  var n = nrm(nm).replace(/[＊*・]/g, ''), core = n.replace(/[／/].*$/, '');
  var m = core.match(/^(.+?)\((.+)\)$/);
  var alts = [n];
  if (core !== n) { alts.push(core); }
  if (m) {
    alts.push(m[2] + m[1]);
    // **括弧の中を 1 文字に縮める書き方**（「水セイア」「制ネル」「臨ホシノ」）。
    // 同じ TL に セイア と セイア（水着）が両方いると、これが無いと素の
    // セイア に当たって外す（2026-09-02、大決戦ビナー）
    alts.push(m[2].charAt(0) + m[1]);
    // **「水ナギ」**（括弧の頭 1 文字＋名前の頭 2 文字。2026-09-02、大決戦シロクロ u6l8cRf7PME）
    if (m[1].length >= 3) { alts.push(m[2].charAt(0) + m[1].slice(0, 2)); }
  }
  var nkk;
  for (nkk in NICK) { if (has(NICK, nkk) && nrm(NICK[nkk]).replace(/[＊*・]/g, '') === n) { alts.push(nkk); } }
  return { full: n, base: m ? m[1] : core, alts: alts };
}
/** 行の中から編成の誰かを見つける。**先に名乗った子を採る。**
    2026-09-01 の先生の TL で「開始イブキ指定(通常セイア＋ネル)」が
    セイアと読まれていた。**いちばん長く当たったものを採る**だけだと、
    括弧の中に書いてある「渡す相手」のほうが長ければそちらが勝ってしまう。
    TL は「誰が」を先に書くので、**行の中で先に出てきたほうを採る**
    （同じ位置なら長いほう）。括弧の中の名前は「撃つ子」の候補にしない
    （「セイア（水着）」のような括弧つきの名前そのものは別で、これは当てる）。 */
export function whoIn(line, crew, bare, pref) {
  var s = nrm(line).replace(/[＊*]/g, ''), i, q, best = null, ties = [];
  // 括弧の中かどうかの地図。**括弧つきの名前に当たったところは中に数えない**
  var inP = [], depth = 0;
  for (i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '(') { depth++; inP.push(true); continue; }
    inP.push(depth > 0);
    if (ch === ')') { depth = Math.max(0, depth - 1); }
  }
  function take(idx, pos, len, plain) {
    if (pos < 0) { return; }
    if (!best || pos < best.pos || (pos === best.pos && len > best.len)) {
      best = { idx: idx, pos: pos, len: len, plain: plain }; ties = [best];
    } else if (pos === best.pos && len === best.len) { ties.push({ idx: idx, plain: plain }); }
  }
  // 1. 括弧つき・入れ替え形（「セイア(水着)」「水着セイア」）。行のどこでも当てる
  for (i = 0; i < crew.length; i++) {
    var a = crew[i].a;
    for (q = 0; q < a.alts.length; q++) {
      take(crew[i].idx, s.indexOf(a.alts[q]), a.alts[q].length, false);
    }
  }
  // 2. 括弧なしの呼び方（「セイア」「イブキ」）。**括弧の中は数えない**
  var sb = bare == null ? null : nrm(bare);
  for (i = 0; i < crew.length; i++) {
    var b2 = crew[i].a.base, at = -1;
    while ((at = s.indexOf(b2, at + 1)) >= 0) {
      if (inP[at]) { continue; }
      // `bare` を渡されているときは、そちらにも残っている呼び方だけ採る
      if (sb != null && sb.indexOf(b2) < 0) { break; }
      take(crew[i].idx, at, b2.length, crew[i].a.full === b2);
      break;
    }
  }
  if (!best) { return -1; }
  if (ties.length === 1) { return best.idx; }
  // **同じ base が別の部隊に 1 人ずつ**（1 凸目に 制服ネル、2 凸目に ネル。どちらも
  // TL では「ネル」）。育成の行は部隊ごとに 6 行ずつ固まって並ぶので、いま読んでいる
  // 部隊の並び（`pref`＝その塊の真ん中）に近い行を採る。同じ塊の中で割れるときは
  // 下の「括弧の無いほう」（2026-09-02、総力戦ホバークラフト zKyXAcWcxrU・ゲブラ）
  if (pref != null) {
    var blk = {}, nb = 0, bi = -1, bd = 1e9;
    for (i = 0; i < ties.length; i++) {
      var bk = Math.floor(ties[i].idx / 6), dd = Math.abs(ties[i].idx - pref);
      if (!blk[bk]) { blk[bk] = 1; nb++; }
      if (dd < bd) { bd = dd; bi = ties[i].idx; }
    }
    if (nb > 1) { return bi; }
  }
  // **同じ base が 2 人**（セイア と セイア(水着)）。括弧の無いほうを採る
  for (i = 0; i < ties.length; i++) { if (ties[i].plain) { return ties[i].idx; } }
  return -1;                       // 決められない。**当てずっぽうで選ばない**
}
/** コストの上限。編成モードで変わる（通常 10・制約解除 20） */
export function costCap() { return st.mode === 10 ? 20 : 10; }
/** 1 行からタイミングを読む。読めなければ null。 */
export function timeIn(line, dur) {
  var s = nrm(line), m;
  // 残り時間「2:30.100」／経過「t35」「35秒」
  m = s.match(/(\d+):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (m) {
    var rest = (+m[1]) * 60 + (+m[2]) + (m[3] ? +('0.' + m[3]) : 0);
    return { md: 't', t: Math.max(0, dur - rest) };
  }
  m = s.match(/(?:^|[^A-Za-z0-9])[tT](\d+(?:\.\d+)?)(?![\d\/])/);
  if (m) { return { md: 't', t: Math.min(dur, +m[1]) }; }
  // **「開始○○」は最速。**t=0 に置くとコストが 0 なので必ず「間に合いません」に
  // なる（2026-09-01。先生の「開始イブキ指定」がこれ）
  if (/^開始/.test(s)) { return { md: 'e' }; }
  // コスト「⑦」「c7」「コスト7」
  var k = CIRC.indexOf(s.charAt(0));
  if (k < 0) { k = CIRC2.indexOf(s.charAt(0)); }
  if (k >= 0) { return { md: 'c', cv: k + 1 }; }
  m = s.match(/(?:^|[^A-Za-z0-9])(?:[cC]|コスト)\s*(\d+(?:\.\d+)?)/);
  if (m) { return { md: 'c', cv: +m[1] }; }
  // 最速「即」「最速」「AUTO」「〜後」
  if (/^AUTO/i.test(s) || /^即|^最速/.test(s) || /後/.test(s)) { return { md: 'e' }; }
  // **「1射目」はコストではない。**1 回の EX を何発かに分けて撃つ子（ヒナ（ドレス）・
  // ホシノ（臨戦））で、TL は名前を書かずに「1射目(右5体)」と続ける。
  // 数字だけの行のコスト判定より前に置かないと、コスト 1 に化ける
  // （2026-09-02、グレゴリオの TL3 ページ目で気づいた）
  if (/^[0-9０-９一二三四五六七八九]+\s*射/.test(s)) { return { md: 'e' }; }
  // **数字だけの行はコスト。**TL では「⑦」が書けない端数をこう書く
  // （2026-09-01。先生の「9.5 Cネル」＝ コスト 9.5。前の行から 9.5 秒後、と
  // 読んでいて 10 秒ずれていた）。秒のつもりなら「9.5秒」と書く
  // **`(?!秒)` は使わない。**バックトラックで「9.5秒」の「9」だけを拾い、
  // 案内している逃げ道（「秒のつもりなら 9.5秒 と書く」）がコスト 9 に化けた
  // （2026-09-02 の最終レビューで発見。「35秒」もコスト 3 になっていた）。
  // 数を丸ごと 1 回で読み、後ろに「秒」があるかで振り分ける
  m = s.match(/^(\d+(?:\.\d+)?)(秒)?/);
  if (m && !m[2] && +m[1] <= costCap()) { return { md: 'c', cv: +m[1], guess: 'cost' }; }
  if (m) { return { md: 'rel', d: +m[1] }; }
  // **名前のうしろにコストを書く人がいる**（「ハレ 10」「ナギサ 10」「ケイ 10」。
  // 2026-09-03、屋内ペロロジラ cbAthbwldys。数字が前にある「10 ハレ」は上で読めていて、
  // 後ろに書いた 3 行だけが「タイミングが書いていないので即」に落ちていた）
  m = s.match(/[\s　](\d+(?:\.\d+)?)\s*$/);
  if (m && +m[1] <= costCap()) { return { md: 'c', cv: +m[1], guess: 'cost' }; }
  return null;
}
/** 貼られた文章を読む。**状態は変えない。** */
/** 括弧の中が「当たる先」（部位）なら、その番号を返す。無ければ -1。
    **TL の書き方から採った言い換えだけを見る**（2026-09-01 にクラウさんの
    TL 8 本を読んで拾った語）。当てずっぽうで広げない。
      「9.5 Cミカ(下側の柱)」「即ミカ(上側の柱)」 → インベイドピラー（召喚）
      「⑧ Cマリー(緑壺)」「④ イロハ(紫壺)」     → 聖遺物
      「5.2シロコ(装置)」                        → ミサイル誘導装置
      「2:39.000 3射目(左聖歌隊 5体)」           → 聖歌隊
    「(ボス)」「(本体)」は本体を名指ししている＝部位ではない。 */
export var AIMWORD = [['柱', 'ピラー'], ['壺', '聖遺物'], ['装置', '誘導装置'],
               ['聖歌隊', '聖歌隊'], ['ミニオン', 'ミニオン'], ['ペロロ', 'ミニオン'],
               ['片鱗', '片鱗'], ['ハサミ', 'ハサミ'], ['船体', '船体'],
               ['フンドシ', 'フンドシ'], ['ドラム缶', 'ドラム缶'],
               ['灯火', '灯火'], ['ドローン', 'ドローン'], ['タワー', 'タワー']];
export function aimIn(inner, subs) {
  var q = nrm(inner), i, j;
  if (!q || !subs || !subs.length) { return -1; }
  if (/^(ボス|本体)$/.test(q)) { return -1; }
  // 1. 部位の名前がそのまま入っている（「(インベイドピラー)」）
  for (i = 0; i < subs.length; i++) {
    var n = nrm(subs[i].n || '').split('(')[0];
    if (n.length >= 2 && (q.indexOf(n) >= 0 || n.indexOf(q) >= 0)) { return i; }
  }
  // 2. TL の言い換え。**左右の区別があるボスでは、左右まで見る**
  //    （グレゴリオの「聖歌隊（左）／（右）」、イェソドの「左の柱／右の柱」。
  //    2026-09-02。区別する前は「右聖歌隊 5体」も「左聖歌隊 5体」も
  //    同じ 1 つ目の部位に当たっていた）
  var side = /左/.test(q) ? '左' : (/右/.test(q) ? '右' : '');
  for (j = 0; j < AIMWORD.length; j++) {
    if (q.indexOf(AIMWORD[j][0]) < 0) { continue; }
    if (side) {
      for (i = 0; i < subs.length; i++) {
        var ns = nrm(subs[i].n || '');
        if (ns.indexOf(AIMWORD[j][1]) >= 0 && ns.indexOf(side) >= 0) { return i; }
      }
    }
    for (i = 0; i < subs.length; i++) {
      if (nrm(subs[i].n || '').indexOf(AIMWORD[j][1]) >= 0) { return i; }
    }
  }
  // 3. 部位の名前に左右が入っているボスでは、「(右5体)」のように
  //    左右だけで指すことがある
  if (side) {
    for (i = 0; i < subs.length; i++) {
      if (nrm(subs[i].n || '').indexOf(side) >= 0) { return i; }
    }
  }
  return -1;
}
/** その子の EX の形態一覧（`tl-engine.js` の `forms` と同じ並び）。 */
export function formsOf(id) {
  var d = null, i, ss = S.students;
  for (i = 0; i < ss.length; i++) { if (ss[i].id === id) { d = ss[i]; break; } }
  if (!d) { return []; }
  var out = [{ n: d.en }], xs = d.xs || [];
  for (i = 0; i < xs.length; i++) { out.push({ n: xs[i].n }); }
  return out;
}
/** **変身 EX の周期。**形態 0 のあとに形態 1 を撃つ回数（トキ 3・キサキ（水着）2）。
    出どころは `build-tool-data.py` が Ex の説明文から読む `fc`（60 の注記に原文）。
    持っていない子は 0 */
export function fcOf(id) {
  var i, ss = S.students;
  for (i = 0; i < ss.length; i++) { if (ss[i].id === id) { return ss[i].fc || 0; } }
  return 0;
}
export var EXK = ['Ex', 'Ex1', 'Ex2', 'Ex3', 'Ex4'];
export function formHasDmg(id, j) {
  return !!((B.dmg[id] || {})[EXK[j]] || altOf(id, EXK[j]));
}
/** **その形態が持続効果を持っているか**（2026-09-03、61d）。
    「ダメージが無い形態＝選ぶだけの札」ではない。イブキの形態 0 は
    「自身を除く円形範囲内の味方の ATK を増加（35 秒間）」で、これが本命。
    本当に選ぶだけの札はアイコンが `SELECTEXSKILL` で説明文が空の 3 人だけ
    （ミカ（水着）・ラブ・アリス（臨戦）。274 人を見て数えた） */
export function formHasBuff(id, j) {
  var a = (B.buf[id] || {})[EXK[j]];
  return !!(a && a.length);
}
/** 「アリス(チャージ)」「ネル(VS付与)」のように、**括弧が形態を指していることがある。**
    形態の名前そのものか、TL でよく使う言い換えだけを見る（2026-09-01 に
    クラウさんの TL 8 本から拾った）。当てずっぽうで広げない。 */
export var FORMWORD = [['チャージ', 'charge'], ['ため', 'charge'], ['溜め', 'charge'],
                ['貯め', 'charge'], ['タメ', 'charge']];
export function formIn(inner, id) {
  var q = nrm(inner), fl = formsOf(id), i, j;
  if (!q || fl.length < 2) { return -1; }
  for (i = 0; i < fl.length; i++) {
    var n = nrm(fl[i].n || '');
    if (n.length >= 2 && (q.indexOf(n) >= 0 || n.indexOf(q) >= 0)) { return i; }
  }
  // **「[自身]」「(連射モード)」「(自動で連射解除)」は連射態勢の切り替え**（ミカ（水着）の
  // 「あなたとの思い出」。ダメージ 0）。撃つ形態にすると 1 発ぶん多く数える
  // （2026-09-02、大決戦シロクロ。6 行が「星の軌跡」になっていた）
  // **「(自身)」で 0 に落とすのは ミカ（水着）(10122) だけ。**アリス（臨戦）の「即アリス(自身)」は
  // 撃つ側（覚醒：スーパーノヴァ）で、全員に掛けると 10 行がダメージ 0 になっていた（2026-09-02、グミの報告）
  if ((/連射モード|連射態勢|連射解除|連射切/.test(q) || (/自身|^自$/.test(q) && id === 10122)) && !formHasDmg(id, 0)) { return 0; }
  for (j = 0; j < FORMWORD.length; j++) {
    if (q.indexOf(FORMWORD[j][0]) < 0) { continue; }
    // 「チャージ」＝ **元の形態**（選択メニューのほう）。アリス（臨戦）は
    // 「光の勇者」で溜めて「覚醒：スーパーノヴァ」で撃つ。元の形態に
    // ダメージが無いときだけ、そこへ戻す
    if (!formHasDmg(id, 0)) { return 0; }
  }
  return -1;
}
