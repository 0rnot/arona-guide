import { $, rest } from './util.js';
import { MAIN_MAX, SLOTS, TE, _byid, live } from './core.js';
import { diff, has } from './boss.js';
import { n0 } from './rate.js';
import { wlvMax } from './passive.js';
import { CIRC, aimIn, aliasOf, formHasDmg, formIn, formsOf, nrm, timeIn, whoIn, zen0 } from './parse-text.js';
import { findStudent } from './parse-apply.js';

/** 育成の行かどうか。**書き方は 1 つに縛らない**（2026-09-01 の先生の指示
    「TL はみんないろんな書き方してるから特化しなくていい」）
    「星3/M11M/T199」（星＋4 文字のスキル＋T と 3 桁）も育成行（2026-09-02、ゲブラ） */
var GROW = /固有\s*\d|[★☆星]\s*[\d０-９]|MMMM|[Tt]\s*\d+\s*\/|Lv\s*\d|装備\s*\d|絆\s*\d|EX\s*\d|(?:^|[^A-Za-z0-9])[Tt]\d{3}(?![\d\/])|(?:^|[^A-Za-z0-9])(?=[M\d]{4}(?![A-Za-z0-9]))[M\d]*M/i;
/** 地の文を育成行にしない（「ナギサ固有2あるのであれば…」） */
var PROSE = /です|ます|ません|ください|でしょう|ずれる|場合/;
/** **「サツキ※助っ人」の ※ は但し書きではない。**※ から後ろを落とすと育成が消えて
    行ごと落ちる（2026-09-02、総力戦ゲブラ kH1hmTbIDJI） */
function bodyOf(raw) {
  return String(raw).replace(/[※＊]\s*(?:助っ?人|レンタル|借り|助)(?=[\s　]|$)/g, ' ').replace(/[※#].*$/, '');
}
/** **名前が行頭にあるとは限らない。**実物の概要欄はこれだけ形が違う。
      「⑤ヒナ(ドレス) 固有4 MMMM」   枠の番号が頭に付く
      「❺カンナ（水着）☆5 MMMM」     黒丸の番号＋☆
      「Lv.90 ☆5 レイサ / 5MMM」      名前が 3 つ目
      「水着ミカ（レンタル）：固有4」   名前のうしろが「：」
      「レイサ(マジカル)固有2　MMMM」  空白が無いまま育成が続く
    **前から順に試して、生徒として引けた語を名前にする**（2026-09-01） */
function pickName(body, probe) {
  var toks = body.split(/[\s　\/／|｜]+/).filter(function (x) { return x; });
  var nm = '', sd = null, tq, cand, cutm;
  for (tq = 0; tq < toks.length && !sd; tq++) {
    //   「90ミカ　固有3　T999」        レベルが名前の頭に付く（区切り無し）
    // 生徒の名前が数字で始まることは無いので、頭の数字は落としてよい
    cand = toks[tq].replace(/^[①-⑳❶-❿〇○●◯・\-]+/, '')
                   .replace(/^\d+/, '').replace(/[：:、,]+$/, '')
                   // **名前を「＿」で桁揃えする人がいる**（「シュン＿＿＿＿＿」）。
                   // 末尾の丸数字は部隊の番号（「ホシノ（臨戦）②」）。
                   // どちらも落とさないと生徒が引けない（2026-09-02、大決戦クロカゲ。
                   // 編成 15 行のうち 10 行が落ちて 0.2% になっていた）
                   .replace(/[＿_]+$/, '').replace(/[①-⑳❶-❿]+$/, '').replace(/[1-9１-９]番$/, '');
    cutm = cand.match(/^(.+?)(?:固有|UE\d|[★☆]|星[\d０-９]|MMMM|Lv|装備\d|絆\d|EX\d)/i);
    if (cutm && cutm[1]) { cand = cutm[1].replace(/[：:、,]+$/, ''); }
    if (!cand || /^[\d.]+$/.test(cand)) { continue; }
    sd = findStudent(cand, probe);
    if (sd) { nm = cand; }
    // **括弧の後ろに役割が続く**（「ホシノ（臨戦）防御型」）。括弧までで引き、
    // 「防御」「タンク」ならタンク側にする（2026-09-02、総力戦ゲブラ）
    if (!sd) {
      var pm = cand.match(/^(.+?[)）])(.+)$/);
      if (pm) {
        sd = (/防御|タンク/.test(pm[2]) ? findStudent(pm[1] + '／タンク', probe) : null) || findStudent(pm[1], probe);
        if (sd) { nm = pm[1]; }
      }
    }
  }
  return { sd: sd, nm: nm, toks: toks };
}
/** **名前と育成が 2 行に分かれている概要欄**（2026-09-03、屋内ペロロジラ cbAthbwldys）。

        マコト（水着）助っ人
        Lv.90 固有4 MMMM T10/10/10

    名前だけの行は育成行として読まれず、そのまま TL の 1 発として置かれていた
    （「ケイ」「ナツ」「ハレ（キャンプ）」ほか 5 行が偽の EX になっていた）。
    **次の行が育成行で、そちらから生徒が引けないときだけ**繋ぐ。 */
function joinNameRows(lines) {
  for (var i = 0; i + 1 < lines.length; i++) {
    var a = bodyOf(lines[i]).trim(), b = bodyOf(lines[i + 1]).trim();
    if (!a || !b || a.length > 16) { continue; }
    if (GROW.test(a) || PROSE.test(a) || !GROW.test(b) || PROSE.test(b)) { continue; }
    if (pickName(b, null).sd || !pickName(a, null).sd) { continue; }
    lines[i + 1] = a + ' ' + lines[i + 1];
    lines[i] = '';
  }
  return lines;
}

export function parseTL(txt) {
  var dur = diff().dur || 240;
  var lines = joinNameRows(String(txt).replace(/\r/g, '').split('\n'));
  var res = { crew: [], start: [], uses: [], skipped: [], notes: [], bufTo: null };
  var i, q;
  // ---- 1. 使用生徒詳細
  for (i = 0; i < lines.length; i++) {
    var raw = lines[i], body = bodyOf(raw);
    if (!GROW.test(body) || PROSE.test(body)) { continue; }
    var probe = [], pk = pickName(body, probe), nm = pk.nm, sd = pk.sd, toks = pk.toks;
    if (!sd) { res.skipped.push([raw, '生徒が見つかりません: ' + (toks[0] || '')]); continue; }
    findStudent(nm, res.notes);   // 引けた語のぶんだけ注記を戻す
    var b = { id: sd.id, name: sd.n };
    // **名前の直後の丸数字は部隊の番号**（「ホシノ（臨戦）②」＝ 2 部隊目。2026-09-02）
    var ptm = body.match(/[ぁ-んァ-ヶ一-龥）)]([①-⑳])/);
    if (ptm) { b.pt = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(ptm[1]) + 1; }
    ptm = body.match(/[ぁ-んァ-ヶ一-龥）)]([1-9１-９])番/);   // 「ホシノ(臨戦)1番」
    if (ptm) { b.pt = +zen0(ptm[1]); }
    var rest = body.replace(nm, ' '), mm;
    // 固有武器。「固有4」「固有4/50」「UE4」
    mm = rest.match(/(?:固有|UE)\s*[★☆]?\s*(\d)(?:\s*(?:[\/／]|Lv)\s*(\d+))?/i);
    if (mm) {
      b.star = 5; b.wstar = +mm[1];
      // **段が書いていなければ、その星の上限**（wlvMax の注記に出典）
      b.wlv = mm[2] ? Math.min(+mm[2], wlvMax(b.wstar)) : wlvMax(b.wstar);
    } else {
      mm = rest.match(/[★☆星]\s*([\d０-９])/);   // 「★３」「星3」（2026-09-02）
      if (mm) { b.star = +zen0(mm[1]); b.wstar = 0; b.wlv = 0; }
    }
    // **「能力解放Lv0-0-25」の Lv を生徒レベルにしない**（2026-09-02、大決戦ビナー。
    // 6 人中 5 人が Lv0〜25 になって 7.0% まで落ちていた）。
    // 固有武器の段（「固有★3Lv50」）とも取り違えないよう、直前の語を見る
    mm = rest.match(/(能力解放|潜在|限界突破|WB|固有|UE|[★☆]\s*\d)?\s*Lv\.?\s*(\d+)/i);
    if (mm && !mm[1] && +mm[2] <= 100) { b.lv = +mm[2]; }
    // スキル。「MMMM」＝ 4 つとも上限。個別なら「EX5 NS10 PS10 SS10」
    if (/MMMM/i.test(rest)) { b.ex = 5; b.sk = 10; b.plv = 10; b.sslv = 10; }
    mm = rest.match(/EX\s*(\d)/i); if (mm) { b.ex = +mm[1]; }
    mm = rest.match(/(?:NS|ノーマル)\s*(\d+)/i); if (mm) { b.sk = +mm[1]; }
    mm = rest.match(/(?:PS|パッシブ)\s*(\d+)/i); if (mm) { b.plv = +mm[1]; }
    mm = rest.match(/(?:SS|サブ)\s*(\d+)/i); if (mm) { b.sslv = +mm[1]; }
    mm = rest.match(/(?:絆|Bond)\s*(\d+)/i); if (mm) { b.bond = +mm[1]; }
    // 潜在能力。**クラウさんの概要欄は「WB」と書く**（「全WB25」「攻撃/治癒WB25」
    // 「HP/治癒WB25」）。「潜在25」「限界突破25」も同じものとして読む
    // **書いていないときは 25（上限）**。TL を出す人の生徒はまず開けきっていて、
    // 概要欄の実測値と突き合わせると 25 でぴたりと合う（イロハ（水着）攻撃 7308 と
    // シロコ＊テラー 攻撃 6123 が誤差 0、ケイ HP 46439 が −0.14%。
    // 2026-09-01 にクラウさんの概要欄 7 件で確かめた）
    b.pot = [25, 25, 25];
    mm = rest.match(/([^\s　]*)(?:WB|潜在|限界突破)\s*(\d+)/i);
    if (mm) {
      var pv = Math.min(+mm[2], 25), tg = mm[1] || '';
      if (!tg || /全|ALL/i.test(tg)) { b.pot = [pv, pv, pv]; }
      else {
        b.pot = [/HP|ＨＰ|体力/i.test(tg) ? pv : 0,
                 /攻撃|ATK/i.test(tg) ? pv : 0,
                 /治癒|回復|HEAL/i.test(tg) ? pv : 0];
      }
    }
    if (/愛用品|Gear/i.test(rest)) {
      mm = rest.match(/(?:愛用品|Gear)\s*(\d)/i); b.gear = mm ? Math.min(+mm[1], 2) : 2;
    }
    // 装備。「t6/10/10」「装備9」「T9」——3 枠バラバラでも 1 つでも
    mm = rest.match(/(?:装備|[Tt])\s*(\d+)\s*[\/／]\s*(\d+)\s*[\/／]\s*(\d+)/);
    if (mm) { b.eq = [+mm[1], +mm[2], +mm[3]]; }
    else {
      // **「T998」は 3 枠ぶんを続けて書いたもの**（9・9・8）。装備は 1〜10 なので
      // 3 桁がぜんぶ 1〜9 なら 1 枠ずつに割る（2026-09-01、総力戦ホドの概要欄）
      mm = rest.match(/(?:^|[\s　])[Tt]([1-9])([1-9])([1-9])(?![\/／\d])/);
      if (mm) { b.eq = [+mm[1], +mm[2], +mm[3]]; }
      else {
        mm = rest.match(/装備\s*(\d+)/) || rest.match(/(?:^|[\s　])[Tt](\d+)(?![\/／\d])/);
        if (mm && +mm[1] <= 10) { b.eq = +mm[1]; }
      }
    }
    res.crew.push(b);
  }
  // **育成表が無い TL でも読む。**世の中の TL は概要欄に育成を書かないものが多く、
  // ここで止めると 1 行も読めなかった（2026-09-03、初見の TL 4 本すべてで発生）。
  // 編成は下の「育成の行が無い子を既定値で足す」経路が TL の行から組む
  if (!res.crew.length) {
    res.crewAuto = true;
    res.notes.push('育成の行が無いので、編成は TL に出てくる子から組みました（数字は既定値です）');
  }
  // **枠はまだ決めない。**育成行は全部隊ぶんが一括で並ぶので、どの行がどの部隊かは
  // TL の節（「2凸目」）を読んでから決める（下の `assignParties`）。ここから先の
  // `who` は res.crew の添字で、枠の番号は最後に振り直す（2026-09-02）
  // **同じ子の行は最初の 1 つだけ名前引きに使う。**2 部隊に同じ子がいる TL や、
  // 育成の表が 2 回並ぶ概要欄で、同じ名前が 2 行あると `whoIn` が「決められない」で
  // 落としていた（2026-09-02、総力戦ヒエロニムス yuZnCpRh2YU で 29 発 → 11 発）。
  // 2 部隊目の行への付け替えは `assignParties` の `fresh` がやる
  var crew = [], seenId = {};
  for (i = 0; i < res.crew.length; i++) {
    if (!_byid[res.crew[i].id] || seenId[res.crew[i].id]) { continue; }
    seenId[res.crew[i].id] = true;
    crew.push({ idx: i, a: aliasOf(res.crew[i].name) });
  }
  var idBy = {}, autoF = {};
  for (i = 0; i < res.crew.length; i++) { idBy[i] = res.crew[i].id; }
  // **渡し先を書かない TL は、編成のアタッカーが 1 人ならその子へ。**書かないと支援 EX が誰にも
  // 乗らず、全会心平均が 9.3% → 31.6%（クロカゲ 9yprqPRVcuE）まで違う。1 人に決まらないときは置かない
  // （2026-09-02、ビスケットの報告）。渡し先の行（下の 2.）があればそちらが勝つ
  var ddN = 0, ddI = -1;
  for (i = 0; i < crew.length; i++) {
    var sdd = _byid[res.crew[crew[i].idx].id];
    if (sdd && sdd.ro === 'DamageDealer' && sdd.sq === 'Main') { ddN++; ddI = crew[i].idx; }
  }
  if (ddN === 1) { res.bufTo = ddI; res.notes.push('渡し先の指定が無いバフは、編成でアタッカーが 1 人の ' + res.crew[ddI].name + ' へ乗せています'); }
  // ---- 2. バフの渡し先
  for (i = 0; i < lines.length; i++) {
    // **「指定」と書かない人もいる**（「バフは全てヒナへ」。2026-09-02、大決戦クロカゲ。
    // 拾えないうえに、この行が「即ヒナ」の 1 発として置かれていた）
    var bm = nrm(lines[i]).match(/バフ.*?(?:全て|すべて)(.+?)(?:指定|へ|に)$/) ||
             // 「表記なしは ナギサ、ハレ、キサキ、カヨコ→ホシノ」「無印は ホシノ」（2026-09-02、大決戦クロカゲ Eq24dzcB234）
             nrm(lines[i]).match(/^(?:表記な[しく]|無印|指定な[しく])(?:は|:)?.*?(?:→|->|は)([^→\-]+?)(?:へ|に|指定)?$/);
    if (bm) {
      var to = whoIn(bm[1], crew);
      if (to >= 0) { res.bufTo = to; res.bufToFixed = true; res.notes.push('バフの渡し先を全部 ' + bm[1] + ' にしました'); }
      else { res.skipped.push([lines[i], 'バフの渡し先が編成にいません']); }
      break;
    }
  }
  // ---- 3. 開始スキル。**部隊ごとに読む**ので、4. のループの中で呼ぶ
  function startOf(line, next) {
    var ps = nrm(line).split(/(?=[①-⑳])/), out = [], q2;
    for (q2 = 1; q2 < ps.length; q2++) {
      var w = whoIn(ps[q2], crew);
      if (w >= 0) { out.push(w); }
      else { res.skipped.push([ps[q2], '開始SET の生徒が編成にいません']); }
    }
    if (out.length) { return { out: out, usedNext: false }; }
    // **丸数字で書かない人のほうが多い**（2026-09-03、屋内ペロロジラ。
    // 「開始スキル ケイ、ナギサ、ハレ、キサキ」で 4 枚 → 0 枚になっていた）。
    // 見出しを落として、区切りで割って前から引く
    var body = nrm(line).replace(/^.*?開始\s*(?:SET|スキル|セット)\s*[:：]?/i, ''), usedNext = false;
    // **順番だけ書いて、並びを次の行に書く形**（「開始スキル  1➡2➡3➡4➡5」＋
    // 「セイア/ケイ/マコト(水着)/キサキ/ナギサ(水着)」。5 枚 → 0 枚になっていた）
    // **見出しだけの「開始SET：」では次の行を食わない**（次は TL の 1 発目。
    // 2026-09-03、7bTd5o8Ru80 で「5 セイア/マコト」が 1 発ぶん消えた）。
    // 番号の並びが書いてあるときだけ
    if (/^[\s　0-9０-９→⇒➡➝\-–—、,・／\/]+$/.test(body) && (body.match(/[0-9０-９]/g) || []).length >= 2 &&
        next != null && /[ぁ-んァ-ヶ一-龥]/.test(nrm(next))) {
      body = nrm(next); usedNext = true;
    }
    var qs = body.split(/[、,・／\/＋+→⇒➡➝\s　]+/).filter(function (x) { return x; }), w2;
    for (q2 = 0; q2 < qs.length; q2++) {
      w2 = whoIn(qs[q2], crew);
      if (w2 >= 0 && out.indexOf(w2) < 0) { out.push(w2); }
    }
    return { out: out, usedNext: usedNext && out.length > 0 };
  }
  // 節ごとに、育成行のどれがその部隊かを決めて枠を振る。返すのは
  // [{ crew, start, uses, bufTo, gu }]（`uses[].i` と `to` は枠の番号に直してある）
  function assignParties(parts) {
    var claimed = {}, out = [], k, j, ci;
    function refs(sec) {
      var o = [], q2, u, z;
      function add(c) { if (c != null && c >= 0 && o.indexOf(c) < 0) { o.push(c); } }
      for (q2 = 0; q2 < sec.start.length; q2++) { add(sec.start[q2]); }
      for (q2 = 0; q2 < sec.uses.length; q2++) {
        u = sec.uses[q2]; add(u.i);
        if (u.to != null) {
          if (u.to.length != null) { for (z = 0; z < u.to.length; z++) { add(u.to[z]); } }
          else { add(u.to); }
        }
      }
      return o;
    }
    // **同じ子の行が 2 つある**（2 部隊に同じ子。「シロコ＊テラー」×2）。
    // 前の節が使った行なら、まだ使っていない同じ子の行に付け替える
    function fresh(c0, k0) {
      if (claimed[c0] == null || claimed[c0] === k0) { return c0; }
      for (var z = 0; z < res.crew.length; z++) {
        if (res.crew[z].id === res.crew[c0].id && claimed[z] == null &&
            (res.crew[z].pt == null || res.crew[z].pt === k0 + 1)) { return z; }
      }
      return c0;
    }
    var rowsOf = [];
    for (k = 0; k < parts.length; k++) {
      var rows = [], rf = refs(parts[k]), remap = {};
      for (j = 0; j < res.crew.length; j++) { if (res.crew[j].pt === k + 1) { rows.push(j); claimed[j] = k; } }
      for (j = 0; j < rf.length; j++) {
        ci = fresh(rf[j], k); remap[rf[j]] = ci;
        if (rows.indexOf(ci) < 0) { rows.push(ci); claimed[ci] = k; }
      }
      rowsOf.push({ rows: rows, remap: remap });
    }
    // 節に出なかった行。節が 1 つなら全部その節。複数なら、育成行の並びで
    // 直前の行と同じ節（育成行は部隊ごとに固まって書かれる）
    // **育成行が枠（8）より多くて部隊が 2 つ以上なら、前から 6 人ずつ**（2026-09-02、大決戦ゴズ
    // EVyJni1yfTE。12 人を P1 に詰めて 4 人が「枠が足りません」、P2 が空になっていた）
    var lastK = 0, blockK = parts.length > 1 && res.crew.length > SLOTS, unclaimedN = 0;
    for (j = 0; j < res.crew.length; j++) {
      if (claimed[j] != null) { lastK = claimed[j]; continue; }
      if (res.crew[j].pt != null) { continue; }
      var tk = parts.length === 1 ? 0 : (blockK ? Math.min(parts.length - 1, Math.floor(j / 6)) : lastK);
      rowsOf[tk].rows.push(j); claimed[j] = tk;
    }
    for (k = 0; k < parts.length; k++) {
      var rw = rowsOf[k].rows.slice().sort(function (a, b) { return a - b; });
      var mainN = 0, supN = 0, slot = {}, crewK = [], tag = parts.length > 1 ? '（P' + (k + 1) + '）' : '';
      for (j = 0; j < rw.length; j++) {
        var s2 = _byid[res.crew[rw[j]].id], idx;
        if (!s2) { continue; }
        if (s2.sq === 'Support') { idx = MAIN_MAX + supN; supN++; }
        else { idx = mainN; mainN++; }
        if (!live(idx)) { res.skipped.push([res.crew[rw[j]].name, '枠が足りません' + tag]); continue; }
        var c2 = {}, kk;
        for (kk in res.crew[rw[j]]) { if (has(res.crew[rw[j]], kk)) { c2[kk] = res.crew[rw[j]][kk]; } }
        c2.idx = idx; slot[rw[j]] = idx; crewK.push(c2);
      }
      var rm = rowsOf[k].remap;
      var sl = function (c0) { var c3 = rm[c0] == null ? c0 : rm[c0]; return slot[c3] == null ? -1 : slot[c3]; };
      var startK = [], usesK = [], q3, z2;
      for (q3 = 0; q3 < parts[k].start.length; q3++) {
        var sA = sl(parts[k].start[q3]);
        if (sA >= 0) { startK.push(sA); }
      }
      for (q3 = 0; q3 < parts[k].uses.length; q3++) {
        var u2 = parts[k].uses[q3], sU = sl(u2.i);
        if (sU < 0) { res.skipped.push([u2.line, '撃つ子が枠に入りません' + tag]); continue; }
        u2.i = sU;
        if (u2.to != null) {
          if (u2.to.length != null) {
            var tl2 = [];
            for (z2 = 0; z2 < u2.to.length; z2++) { var sT = sl(u2.to[z2]); if (sT >= 0) { tl2.push(sT); } }
            u2.to = tl2.length ? (tl2.length > 1 ? tl2 : tl2[0]) : null;
          } else { var sT2 = sl(u2.to); u2.to = sT2 >= 0 ? sT2 : null; }
        }
        usesK.push(u2);
      }
      var bT = res.bufTo == null ? -1 : sl(res.bufTo);
      out.push({ crew: crewK, start: startK, uses: usesK, bufTo: bT >= 0 ? bT : null, gu: parts[k].gu, ev: parts[k].ev || [] });
    }
    return out;
  }
  // ---- 4. タイムライン
  // **「2凸目」の見出しで部隊を分けて読む**（2026-09-02。それまでは 2 部隊目から先を
  // 捨てていた。56 本のうち 22 本が 2〜4 部隊）。1 本の時間軸に乗せると 2 部隊ぶんの
  // EX が同じボスに足されて 2 倍以上に膨らむ（ホバークラフトが 262〜273% だった原因）。
  // **切るのは「1 発でも置いたあと」に出てきた見出しだけ。**目次や育成状況に
  // 「2凸目」と書く人がいて、頭から探すと TL の手前で切れて 1 行も読めなくなる
  // （56 本のうち 13 本がこれで全滅した）。「TL2ページ目」は同じ部隊の続きなので切らない。
  // 同じ番号の見出しがもう一度来たら別案（「1凸目 ver2」）、「※…場合」も別案で、
  // 次の部隊の見出しまで読まない
  var CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  function zen(x) { return x.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function cutKind(lc) {
    if (/ページ/.test(lc) || lc.length > 40) { return null; }
    var m = lc.match(/([1-9１-９])\s*(?:凸目?|部隊目?|チーム目?)/);
    if (m && lc.length <= 24) { return { n: +zen(m[1]) }; }
    if (/^[①-⑳]$/.test(lc)) { return { n: CIRC.indexOf(lc) + 1 }; }
    // 別案の見出し（「※超上振れでフェーズ2スキップした場合※」）。**行末で終わるものだけ。**
    // 「※バフは注が無い場合ノア」は但し書きで、切ると 2 部隊目が丸ごと消える
    if (/^※.*(?:場合|とき|パターン|ルート)[※。）)]*$/.test(lc)) { return { alt: true }; }
    return null;
  }
  // **矢印で何発もつなぐ書き方**（「Cost6：カヨコ → アヤネ → Cost6：イオリ → コタマ」
  // 「➝ Cost7：ミカ → ヒマリ → ミカ → ギブアップ」。2026-09-02、総力戦ホド _tH1tzFHoUM と
  // ホバークラフト c3eN2Cf7QVc）。矢印が 3 つ以上つながる行は 1 発ずつの行に割る。
  // 2 つだけなら「→ ネル」の渡し先なのでそのまま。`[➡ミカ]` のような括弧の中は割らない
  var lines2 = [], lz, lq;
  for (lz = 0; lz < lines.length; lz++) {
    var body2 = lines[lz].replace(/[※].*$/, ''), note2 = (lines[lz].match(/[※].*$/) || [''])[0];
    var pcs = body2.split(/(?:→|➝|➡|⇒|->)(?![^\[\]]*\])/), pcs2 = [];
    for (lq = 0; lq < pcs.length; lq++) { if (nrm(pcs[lq])) { pcs2.push(pcs[lq].trim()); } }
    // **「ホシノ→即ミカ」の 2 つ目が「即」や秒で始まるなら渡し先ではなく連鎖**
    // （2026-09-02、大決戦シロクロ B7GPFRbI1vk でミカ 13 発のうち 3 発が消えていた）
    var chain2 = pcs2.length === 2 &&
                 (/^(即|最速)/.test(nrm(pcs2[1])) || !!timeIn(pcs2[1].replace(/[（(\[［][^）)\]］]*[)）\]］]/g, ' '), dur));
    if (pcs2.length < 3 && !chain2) { lines2.push(lines[lz]); continue; }
    for (lq = 0; lq < pcs2.length; lq++) {
      var pc = pcs2[lq];
      if (lq > 0 && !timeIn(pc.replace(/[（(\[［][^）)\]］]*[)）\]］]/g, ' '), dur)) { pc = '即 ' + pc; }
      lines2.push(pc + (lq === pcs2.length - 1 ? note2 : ''));
    }
  }
  lines = lines2;
  // **「以下を3回繰り返し」…「繰り返し後」**（2026-09-02、総力戦ゲブラ kH1hmTbIDJI）。
  // 間の行を N 回並べる。終わりは「繰り返し後」の行。無ければ最初の空行まで
  var lines3 = [], lr, rpM;
  for (lr = 0; lr < lines.length; lr++) {
    rpM = nrm(lines[lr]).match(/^以下を?([0-9０-９]+)回(?:繰り返|ループ)/);
    if (!rpM) { lines3.push(lines[lr]); continue; }
    var nRep = Math.min(20, +zen0(rpM[1])), le = -1, lb = -1, lz2;
    for (lz2 = lr + 1; lz2 < lines.length; lz2++) {
      if (/繰り返し(?:後|た後|終|完了)|ループ(?:後|終)/.test(nrm(lines[lz2]))) { le = lz2; break; }
      if (cutKind(nrm(lines[lz2]))) { break; }
      if (!nrm(lines[lz2]) && lb < 0) { lb = lz2; }
    }
    if (le < 0) { le = lb >= 0 ? lb : lines.length; }
    var blk2 = [];
    for (lz2 = lr + 1; lz2 < le; lz2++) { if (nrm(lines[lz2])) { blk2.push(lines[lz2]); } }
    for (lz2 = 0; lz2 < nRep; lz2++) { lines3 = lines3.concat(blk2); }
    res.notes.push('「' + lines[lr].trim() + '」の ' + blk2.length + ' 行を ' + nRep + ' 回並べました');
    lr = le;   // 終わりの行は飛ばす
  }
  lines = lines3;
  // **1 行に何人も並べた TL を、1 人 1 行に開く。**「即　サツキ　ホシノ　カンナ(紫壺)」
  // 「3:18.000 イロハ　サツキ　キサキ」のように、同じタイミングで続けて撃つぶんを
  // 1 行に書く TL がある。開かないと「撃つ子が読めません」で行ごと落ちていた
  // （2026-09-03、初見の TL の答え合わせで判明）。
  // **開くのは、タイミングが書いてあって、名前が 2 人以上引ける短い行だけ。**
  // 「サツキ→カンナ」は「撃つ子→渡し先」なので 1 つの塊として扱う。
  // 2 人目からは「即」＝ 直後に続けて撃つ、として置く（TL の読み方に合わせた）
  (function () {
    var out = [], q, w;
    for (q = 0; q < lines.length; q++) {
      var ln0 = lines[q], body0 = ln0.replace(/[※#].*$/, ''), n0 = nrm(body0);
      var head = timeIn(body0.replace(/[（(][^）)]*[)）]/g, ' '), dur) ||
                 /^[\s　]*(?:即|コスト|cost)/i.test(body0);
      // **「どちらか」の行は開かない。**「即 リオ or 10 ネル」は 2 発ではなく
      // 「リオ か ネル のどちらか」。開くと 2 発に増えて道具が実測を追い越す
      // （2026-09-03、総力戦ホバークラフト -Uy052WTKng で 126.7% まで膨らんだ）
      var alt0 = /(?:^|[^A-Za-z])or(?:$|[^A-Za-z])|または|もしくは|どちらか|いずれか|[\/／]/i.test(body0);
      if (!head || alt0 || n0.length > 40 || /凸|部隊|開始/.test(n0)) { out.push(ln0); continue; }
      // 塊に割る。空白・「、」・「・」で切り、「→」でつながるところは切らない
      var toks = body0.split(/[\s　、,・]+/).filter(function (x) { return nrm(x); });
      var hits = [], head0 = null;
      for (w = 0; w < toks.length; w++) {
        var t0 = toks[w], nm0 = t0.split(/[→>＞]/)[0];
        var sd0 = /[ぁ-んァ-ヶ一-龥Ａ-Ｚａ-ｚA-Za-z]/.test(nrm(nm0)) ? findStudent(nm0, null) : null;
        if (sd0) { hits.push(t0); }
        else if (!hits.length) { head0 = (head0 == null ? '' : head0) + t0 + ' '; }
      }
      if (hits.length < 2) { out.push(ln0); continue; }
      for (w = 0; w < hits.length; w++) {
        out.push((w === 0 ? (head0 || '') : '即 ') + hits[w]);
      }
      res.notes.push('「' + ln0.trim() + '」は ' + hits.length + ' 発として読みました');
    }
    lines = out;
  }());
  // 節。1 つが 1 部隊。`gu` は「ギブアップ」で終わった印
  var parts = [], cur = { start: [], uses: [], gu: false }, skipping = false;
  // **`lastRem` は戦闘開始（残り = 制限時間）から始める。**「44.50ユウカ」のように M:SS を一度も
  // 書かない TL があり、前の行からの相対秒に化けていた（2026-09-02、総力戦ゴズ 9FiPLXveLBs）
  // **「開始スキル」の行が 1 つも無い TL は、最初から読む。**世の中の TL には
  // 開始スキルを書かないものが多く、そこで `seenStart` が立たないまま全行が捨てられて
  // 「タイムラインの行が 1 つも読めませんでした」になっていた（2026-09-03、初見の TL
  // 4 本すべてで発生）。**書いてある TL の読み方は今までどおり**（見出しより前は捨てる）
  var hasStart = lines.some(function (q) { return /開始\s*(?:SET|スキル|セット)/i.test(nrm(q)); });
  var seenStart = !hasStart, prevT = 0, lastWho = null, lastShot = null, pendT = null, lastRem = dur;
  // **その節で「M:SS」を一度でも見たか。**見ていないと、分を省いた「dd.dd」の分が決められない
  var remAnc = false;
  // **その部隊で、その子がいま何番目の形態まで進んだか。**「ヒナ①②③」の丸数字が
  // 形態の番号なので、飛んでいるときに間の形態（0 コストでない「開演」）を補うのに要る
  var lastForm = {};
  for (i = 0; i < lines.length; i++) {
    var ln = lines[i], lc0 = nrm(ln), ck = null;
    // 名簿の行（「1凸目 カヨコ/クルミ/アリス(臨戦)/ナギサ(水着)/キサキ」）。
    // 部隊の見出しでもあり、誰がその部隊かも書いてある
    var rosterM = lc0.match(/^([1-9１-９])\s*(?:凸目?|部隊目?)\s*[:：]?\s*(.+)$/);
    if (rosterM && rosterM[2].split(/[\/／・,、]/).length >= 3) {
      ck = { n: +zen(rosterM[1]), roster: rosterM[2] };
      var rl = ck.roster.split(/[\/／・,、]/), rz, used = {};
      for (rz = 0; rz < rl.length; rz++) {
        var sdR = findStudent(rl[rz], null), rq2;
        if (!sdR) { continue; }
        for (rq2 = 0; rq2 < res.crew.length; rq2++) {
          if (res.crew[rq2].id === sdR.id && res.crew[rq2].pt == null && !used[rq2]) {
            res.crew[rq2].pt = ck.n; used[rq2] = true; break;
          }
        }
      }
    } else { ck = cutKind(lc0); }
    if (ck) {
      if (!cur.uses.length && !parts.length && !ck.roster) { void 0; }   // 目次・育成状況の見出し
      else if (ck.alt || (ck.n != null && ck.n <= parts.length && cur.uses.length) ||
               (ck.n != null && ck.n === parts.length + 1 && cur.uses.length > 3)) {
        skipping = true;
        res.notes.push('「' + ln.trim() + '」から次の部隊の見出しまでは読んでいません（別案）');
      } else if (ck.n != null && ck.n === parts.length + 1 && cur.uses.length) {
        // いまの部隊の番号の見出しが、数発置いたあとに来た。**前置きの行が 1 発に
        // 化けていた**ので捨てて、ここから本番として読み直す
        res.notes.push('「' + ln.trim() + '」より前の ' + cur.uses.length + ' 発は前置きとして捨てました');
        cur.uses = []; skipping = false; prevT = 0; pendT = null; lastWho = null; lastShot = null; lastForm = {};
      } else {
        if (cur.uses.length) { parts.push(cur); cur = { start: [], uses: [], gu: false }; }
        skipping = false; prevT = 0; pendT = null; lastWho = null; lastShot = null; lastRem = dur; remAnc = false; lastForm = {};
      }
      if (!/開始\s*(?:SET|スキル|セット)/i.test(lc0)) { continue; }
    }
    if (skipping) { continue; }
    // **「TL」だけの行は本番の始まり。**それより前は前置き（育成の注意書き・別案の説明）で、
    // 1 発ではない。**地の文の見分けだけでは足りない**——「1:07ここのカヨコNSが発動しないと
    // 思うので7.1でカヨコEXを発動して移動しないようにする」は「です・ます・ません・ください」の
    // どれも持たないので通り抜けて、カヨコ EX 1 発（残り 1:07 ＝ 173 秒）として置かれていた
    // （2026-09-03、総力戦ペロロジラ y4h8XEXXfgw）。**害は 1 発ぶんでは済まない。**
    // この行が `lastRem` を 67 秒にするので、次の「23.50臨戦」（残り 3:23.50 ＝ 36.5 秒）が
    // 「残り 0:23.50 ＝ 216.5 秒」に化け、以降の「即」「コスト指定」が全部その後ろへ押し出されて
    // 26 発中 23 発が制限時間の外（最後は 309.5 秒）へ出ていた。
    // **`cases.json` の 56 本で「TL」だけの見出しは 9 か所あり、どれも前は前置きだけ**
    // （`■TL` `【TL】` `# TL` `TLメモ` を含む。2026-09-03 に全件見て確かめた）
    if (/^[【■#\[\-]*(?:TL|ＴＬ|タイムライン)(?:メモ)?[】\]\-:：]*$/i.test(lc0)) {
      if (cur.uses.length) {
        res.notes.push('「' + ln.trim() + '」より前の ' + cur.uses.length + ' 発は前置きとして捨てました');
        cur.uses = [];
      }
      prevT = 0; pendT = null; lastWho = null; lastShot = null; lastRem = dur; remAnc = false; lastForm = {};
      continue;
    }
    // 「ギブアップ」。行そのものなら印だけ付けて終わり、「即 ネル ※4万5千以下でギブアップ」の
    // ように但し書きの中なら印を付けて行は読む
    if (/ギブアップ|撤退/.test(lc0) && cur.uses.length) {
      cur.gu = true;
      if (whoIn(ln.replace(/[※].*$/, ''), crew) < 0) { continue; }
    }
    if (/開始\s*(?:SET|スキル|セット)/i.test(lc0)) {
      seenStart = true;
      if (!cur.start.length) {
        var so = startOf(ln, lines[i + 1]);
        cur.start = so.out;
        // **並びの行を 1 発として置かない**（「、」で並んだ行は複数発として読まれる）
        if (so.usedNext) { lines[i + 1] = ''; }
      }
      continue;
    }
    if (!seenStart) { continue; }
    var cut = ln.replace(/[※].*$/, '');
    var note = (ln.match(/[※](.*)$/) || [])[1] || '';
    var noParen = cut.replace(/[（(][^）)]*[)）]/g, ' ');
    if (!nrm(noParen)) { continue; }
    if (/固有\s*\d|[★星]\s*[\d０-９]|MMMM/i.test(cut)) { continue; }
    // **行動ではない行。**「ネル後ボスHP(参考程度)」が名前と「後」を持っていて
    // 1 発ぶん余計に置かれていた（2026-09-01 に実物を読ませて気づいた）
    if (/参考|下振れ|上振れ|ページ目|移行|支援値|使用生徒|リスタート|移動先|立ち位置|位置取り|撃ち切り|足元|固定|ポイント|ブレます|…|凡例|リロードキャンセル|コピースキル/.test(cut) ||
        /[？?]\s*$/.test(cut) ||
        // 「ST 正月カヨコ、臨戦ホシノ…」「SP 水着ナギサ、キサキ」（編成の並び）「-- … --」「表記なしは…」（2026-09-02、クロカゲ）
        // **「ストライカー　ホシノ(臨戦)・アカネ・…」も編成の並び**（2026-09-03。
        // 初見のビナー `gxUEp6GVvDE` で、この 2 行が「即」の 6 発として置かれていた）
        /^(?:ST|SP|STRIKER|SPECIAL|ストライカー|スペシャル)[\s　:：]/i.test(cut.trim()) ||
        /^-{2,}/.test(cut.trim()) || /^(?:表記な|無印)/.test(nrm(cut))) { continue; }
    // 名前を「、」「・」で 2 つ以上並べてタイミングの無い行は編成の並び
    // （「ナギサ、ハレ、キサキ、カヨコ」「ホシノ(臨戦)・アカネ・ミカ(水着)」。
    //  「・」は 2026-09-03 に足した）
    if (!timeIn(noParen, dur) && cut.split(/[、,・]/).length >= 3) {
      var nmC = 0, nmq;
      var nmP = cut.split(/[、,・]/);
      for (nmq = 0; nmq < nmP.length; nmq++) { if (whoIn(nmP[nmq], crew) >= 0) { nmC++; } }
      if (nmC >= 2) { continue; }
    }
    // 渡し先をまとめて書いた行は、上の 2. で読んである。1 発には数えない
    if (/バフ.*?(?:全て|すべて)/.test(nrm(cut))) { continue; }
    // **地の文を 1 発にしない。**「2本目の柱に対して発動するコタマEXとネルEXの
    // タイミングが遅いとずれます。」がコスト 2 の コタマ EX になっていた
    // （2026-09-02、総力戦ホド）
    if (/[。]\s*$/.test(cut) ||
        (nrm(cut).length > 24 && /です|ます|ません|ください/.test(cut))) { continue; }
    if (/を?(ON|OFF|オン|オフ)/i.test(nrm(noParen))) {
      res.notes.push('AUTO の切り替えは行として持てないので飛ばしました: ' + ln.trim());
      continue;
    }
    // **合図の行は使用ではない。**「ハナコNS」「ハナコの銃が床についたら」は
    // 次の行の引き金で、その子が EX を撃つという意味ではない
    // （2026-09-02、大決戦ケセド。t=173 秒の使用として入っていた）
    var cue = nrm(noParen);
    // **TL に書いてある「右ハサミ破壊」「船体破壊」「クレーン使用」は、ボスの状態が変わる事象。**
    // 行の時刻（無ければ直前の行の時刻）で持っておき、applyTL がボスのギミック（`gim`）と
    // 突き合わせて「ボスの状態」に置く。**置いたことは注記に出す**（2026-09-02、グミの報告。
    // ドラム缶ガニの +300%・+5% の起点がこの行だった）
    if (/ハサミ破壊|船体破壊|クレーン/.test(cue)) {
      var tev = timeIn(noParen, dur), tv = tev && tev.md === 't' ? tev.t : prevT;
      if (!cur.ev) { cur.ev = []; }
      cur.ev.push({ k: /クレーン/.test(cue) ? 'crane' : 'break', t: tv, line: ln.trim() });
      continue;
    }
    if (/(?:NS|ノーマル)$/i.test(cue) ||
        /(?:したら|ついたら|見えたら|なったら|出たら|直後|入ったら)$/.test(cue)) {
      res.notes.push('「' + ln.trim() + '」は合図の行として読みました（1 発には数えていません）');
      continue;
    }
    // **時刻だけの行を覚えておく。**「02 : 16.000」だけの行の次に行動が来る
    // 書き方がある（2026-09-02、大決戦カイテンジャー）
    var only = nrm(noParen).replace(/[^0-9:.]/g, '');
    if (only.length >= 4 && !/[ぁ-んァ-ヶ一-龥A-Za-z]/.test(nrm(noParen))) {
      var tp = timeIn(nrm(noParen), dur);
      if (tp && tp.md === 't') { pendT = tp.t; if (/\d+:\d{1,2}/.test(nrm(noParen))) { lastRem = dur - tp.t; } }
      continue;
    }
    var prefC = parts.length * 6 + 2.5, chgF = false;
    var who = whoIn(cut, crew, noParen, prefC);
    // **「1射目」「2射目」は直前の子の続き。**ヒナ（ドレス）やホシノ（臨戦）の
    // ように 1 回の EX を何発かに分けて撃つ子で、TL は名前を書かずに
    // 「即 2射目(左聖歌隊 5体)」と続ける（2026-09-01 にグレゴリオと
    // カイテンジャーの TL で気づいた）
    // **直前に名前が出た子ではなく、「何発かに分けて撃つ子」に付ける。**
    // 「即キサキ」の次に「1射目(右5体)」と続く TL では、射目はキサキではなく
    // その前に置いたヒナ（ドレス）の続き。キサキの EX にはダメージが無いので、
    // 誤帰属すると 15 行のうち 6 行が丸ごと 0 になる
    // （2026-09-02、総力戦グレゴリオ。直すと +40,701,489）
    if (who < 0 && /[0-9０-９一二三四五六七八九]\s*射/.test(cut)) {
      if (lastShot != null) { who = lastShot; }
      else if (lastWho != null) { who = lastWho; }
    }
    if (who < 0) {
      // **黙って捨てない。**編成に入らなかった生徒の行がそのまま消えて、
      // 使う人が「足りない」ことに気づけなかった（2026-09-02、12 本のうち 5 本）。
      // 生徒として引ける名前が書いてあるのに編成にいない行だけ知らせる
      var sd2 = findStudent(nrm(cut).replace(/[0-9０-９:.秒即最速]/g, ''), null);
      // **括弧の中だけの呼び名で編成の子に当たるなら、その子。**「23.50臨戦」の
      // 臨戦 → ホシノ（臨戦）／アタッカー（2026-09-02、ペロロジラ）
      var ci2 = -1, nick = nrm(cut).replace(/[0-9０-９:.秒即最速]/g, ''), nHit = 0;
      if (sd2) { for (q = 0; q < crew.length; q++) { if (res.crew[crew[q].idx].id === sd2.id) { ci2 = crew[q].idx; break; } } }
      // 生徒全体では 8 人に当たる「臨戦」も、編成の中では 1 人。括弧の中が一致する子が
      // 編成に 1 人だけなら、その子
      if (ci2 < 0 && nick) {
        for (q = 0; q < crew.length; q++) {
          var cA = nrm(res.crew[crew[q].idx].name).replace(/[／/].*$/, '').match(/^(.+?)\((.+)\)$/);
          if (cA && cA[2] === nick) { nHit++; ci2 = crew[q].idx; }
        }
        if (nHit !== 1) { ci2 = -1; }
      }
      // **育成の行に無い子が TL に出てくる**（ゲブラ kH1hmTbIDJI の カンナ、ケセドの ハレ）。
      // タイミングつきの短い行なら、その子を既定値で編成に足す。数字は当てずっぽうに
      // なるので注記に出す（2026-09-02）
      // **名前無しの「❽チャージ①」**は、編成の中で溜める子（元の形態にダメージが無い子）が
      // 1 人ならその子（2026-09-02、グミの報告。BPnnoHtwrYA の 7 行）
      if (ci2 < 0 && !sd2 && /チャージ|溜め|ため/.test(nrm(cut))) {
        var nCh = 0, cCh = -1;
        for (q = 0; q < crew.length; q++) {
          var sidC = res.crew[crew[q].idx].id;
          if (formsOf(sidC).length >= 2 && !formHasDmg(sidC, 0)) { nCh++; cCh = crew[q].idx; }
        }
        if (nCh === 1) { ci2 = cCh; chgF = true; }
      }
      // **育成表が無い TL では、タイミングが無い行でも足す**（2026-09-03）。
      // 「即ヒナ」「コスト5 アコ」のように数字を書かない行だけで組まれた TL がある
      if (ci2 < 0 && sd2 && (res.crewAuto || timeIn(noParen, dur)) && nrm(cut).length <= 24) {
        var bN = { id: sd2.id, name: sd2.n, pot: [25, 25, 25] };
        res.crew.push(bN); ci2 = res.crew.length - 1;
        crew.push({ idx: ci2, a: aliasOf(sd2.n) });
        res.notes.push('「' + sd2.n + '」は育成の行が無いので既定値で編成に足しました（数字は自分で直してください）');
      }
      if (ci2 >= 0) { who = ci2; }
      else if (sd2) { res.skipped.push([ln.trim(), '編成にいません: ' + sd2.n]); }
      // **タイミングが書いてある行は黙って捨てない。**「23.50臨戦」のように名前が
      // 引けない行が uses にも skipped にも出ず消えていた（2026-09-02、ペロロジラ）
      else if (timeIn(noParen, dur)) { res.skipped.push([ln.trim(), '撃つ子が読めません']); }
      if (who < 0) { continue; }
    }
    var tm = timeIn(noParen, dur);
    // **分を省いて残り時間の秒だけ書く人がいる**（「33.00 マコト」「07.80 ホシノ」＝
    // 残り 3:33.00・3:07.80。2026-09-02、ペロロジラ 4 本全部）。「dd.dd」の形で、
    // その節に「M:SS」の残り時間が既に出ていれば、直前の残り時間より小さくなる
    // いちばん大きい分を補う。「9.5 Cネル」（コスト）は形が違うので当たらない
    var remM = nrm(noParen).match(/^(\d{2}\.\d{2})(?![\d:])/), remKeep = null;
    if (remM && lastRem != null) {
      var secR = +remM[1], mR = Math.floor(lastRem / 60), remT = null;
      while (mR >= 0) { if (mR * 60 + secR < lastRem - 1e-9) { remT = mR * 60 + secR; break; } mR--; }
      if (remT != null) {
        tm = { md: 't', t: Math.max(0, dur - remT) };
        if (remAnc) {
          res.notes.push('「' + ln.trim() + '」は残り ' + Math.floor(remT / 60) + ':' +
                         (remT % 60 < 10 ? '0' : '') + (remT % 60).toFixed(2) + ' として読みました');
        } else {
          // **その節に「M:SS」が 1 つも無いと、分は書いてある順からしか決まらない**
          // （2026-09-03、屋内ペロロジラ LfeYesN3MSs の「39.60臨戦」が 80.40 秒であるべき
          // ところ 20.40 秒、WPsUxtkDMQU の「07.80　ホシノ」が直前の行より前に置かれていた）。
          // `rem` を持たせて、`applyTL1` が前の行の解けた時刻を見てから分を決める
          remKeep = secR;
          res.notes.push('「' + ln.trim() + '」は分が書いていないので、置いた順から決めます');
        }
      }
    }
    if (tm && tm.md === 't' && /\d+:\d{1,2}/.test(nrm(noParen))) { lastRem = dur - tm.t; remAnc = true; }
    else if (tm && tm.md === 't' && remM) { lastRem = dur - tm.t; }
    // **時刻だけを 1 行に書く人がいる**（「02 : 16.000」の次の行が行動）。
    // 生徒の名前が無い行は上の `who < 0` で落ちているので、ここに来るのは
    // 名前がある行だけ。**時刻だけの行は、上の行から持ってくる**（2026-09-02）
    if (!tm && pendT != null) { tm = { md: 't', t: pendT }; pendT = null; }
    // **書いていなければ「即」。**行に名前があるのに落とすと、その 1 発が
    // 黙って消える。大決戦カイテンジャーの TL は行頭が全角スペースで、
    // 33 行のうち 30 行が消えていた（2026-09-02）
    if (!tm) {
      tm = { md: 'e' };
      res.notes.push('「' + ln.trim() + '」はタイミングが書いていないので「即」として置きました');
    }
    if (tm.guess === 'cost') {
      res.notes.push('「' + ln.trim() + '」はコスト ' + tm.cv +
                     ' として読みました（秒のつもりなら「' + tm.cv + '秒」と書いてください）');
    }
    if (tm.md === 'rel') { tm = { md: 't', t: Math.min(dur, prevT + tm.d) }; }
    if (tm.md === 't') { prevT = tm.t; }
    // **その 1 発だけの渡し先。**「→ ネル」「>ネル」「→ ネル, セイア」
    var arrow = cut.split(/→|->|＞|>/), toL = [];
    if (arrow.length > 1) {
      var pieces = arrow[arrow.length - 1].split(/[,、・]/), pz;
      for (pz = 0; pz < pieces.length; pz++) {
        var w2 = whoIn(pieces[pz], crew, null, prefC);
        if (w2 >= 0) { toL.push(w2); }
      }
      who = whoIn(arrow[0], crew, arrow[0].replace(/[（(][^）)]*[)）]/g, ' '), prefC);
      if (who < 0) { res.skipped.push([ln, '撃つ子が編成にいません']); continue; }
    }
    // **「セイア(コタマ)」型の渡し先。**「→」より、こちらの書き方のほうが多い
    // （クラウさんの TL はどのボスも全部これ。2026-09-01 に大決戦ホドで気づいた）。
    // **括弧の中がその編成の別の子として読めたときだけ**渡し先にする。
    // 「コタマ(キャンプ)」のような名前の一部や、「(下側の柱)」「(ボス)」は外れる。
    // **「バフは全て◯◯指定」がある TL では触らない**——そちらが優先だから
    // **括弧の中は「渡し先」か「当たる先」のどちらか。**
    // 編成の子として読めれば渡し先、部位として読めれば当たる先
    // **角括弧で当たる先を書く人がいる**（「[→緑聖遺物]」）。丸括弧だけ見ていると
    // 書き方の違いだけで結果が変わる（2026-09-02、総力戦ヒエロニムス）
    var pg = cut.match(/[（(\[［][^）)\]］]*[)）\]］]/g) || [], pz2, pz3, aim = null, frm = chgF ? 0 : null, mcn = 1;
    var subsP = diff().sub || [];
    for (pz2 = 0; pz2 < pg.length; pz2++) {
      var inner = pg[pz2].replace(/^[（(\[［]|[)）\]］]$/g, '').replace(/[→⇒➝]/g, '').split(/[＋+,、・]|\sと\s/);
      for (pz3 = 0; pz3 < inner.length; pz3++) {
        var w3 = whoIn(inner[pz3], crew, inner[pz3]);
        if (w3 >= 0) {
          // **渡し先は 2 人以上ありうる**（「イブキ指定（セイア＋ネル）」）。
          // `applyTL` は配列を受けられる（2026-09-02）
          // **行ごとの括弧の渡し先は、既定より強い**（2026-09-03、屋内ペロロジラ
          // MYqGzhY5Jmc。「サツキ(ニコ)」「ニコ(ナツ)」「イブキ(マコト、サツキ)」が
          // 全部アタッカー 1 人へ寄っていた）。**「バフは全て◯◯指定」の行があるときだけ**
          // そちらを立てる
          if (!res.bufToFixed && w3 !== who && toL.indexOf(w3) < 0) {
            toL.push(w3);
          }
          continue;
        }
        if (aim == null) {
          var a3 = aimIn(inner[pz3], subsP);
          if (a3 >= 0) {
            aim = a3;
            // **1 回の湧きで盤に出る体数**（`sub[].spn`）を「当たる数」の既定にする。
            // 書いてあれば下の「N体」が勝つ（2026-09-02）。
            // **`cnt` は使わない**——あれは「同じ役どころの行を何本畳んだか」（名簿の数）で、
            // ペロロジラなら 21 になる。盤に出るのは 6（2026-09-03、`spn` を足した）
            if (subsP[a3].spn > 1) { mcn = subsP[a3].spn; }
            // **「(左聖歌隊 5体)」の「5体」。**転移する部位に範囲攻撃を当てると、
            // 当たった数だけボスへ入る（2026-09-01。グレゴリオとペロロジラの
            // TL はどれもこの書き方）
            var mm3 = nrm(inner[pz3]).match(/(\d+)体/);
            if (mm3) { mcn = Math.max(1, +mm3[1]); }
            continue;
          }
        }
        if (frm == null && idBy[who]) {
          var f3 = formIn(inner[pz3], idBy[who]);
          if (f3 >= 0) { frm = f3; }
        }
      }
    }
    // **「(全員巻き込む)」「(5体巻き込む)」は部位の名前を書かない**（2026-09-03、
    // 屋内ペロロジラ MYqGzhY5Jmc。3 行とも当たる数 1 のままだった）。
    // 転移する部位が盤にいるボスでだけ、当てる先をその部位にする
    if (mcn === 1 && /巻き込|まきこ/.test(nrm(cut))) {
      var mm4 = nrm(cut).match(/(\d+)\s*体/);
      if (aim == null) {
        for (pz2 = 0; pz2 < subsP.length; pz2++) { if (subsP[pz2].tr) { aim = pz2; break; } }
      }
      if (mm4) { mcn = Math.max(1, +mm4[1]); }
      // **「全員」は数が書いていない。**1 回の湧きの体数（`spn`）が分かっていればそれを使う
      else if (aim != null && subsP[aim].spn > 1) {
        mcn = subsP[aim].spn;
        res.notes.push('「' + ln.trim() + '」は ' + subsP[aim].n + ' ' + mcn + ' 体として読みました（' +
                       subsP[aim].spnw + '）');
      } else if (aim != null) {
        res.notes.push('「' + ln.trim() + '」は当たる数が書いていないので 1 体で置きました');
      }
    }
    if (aim != null) {
      res.notes.push('「' + ln.trim() + '」は ' + subsP[aim].n + ' に当てる行として読みました' +
        (subsP[aim].tr ? '（' + subsP[aim].tr + '% がボスへ転移します）'
                       : '（ボスの HP からは引きません）'));
    }
    // **形態を選ばないとダメージが 0 になる子がいる。**engine が `pick` として
    // 形態 1 のまま置く子（アリス（臨戦）・ミカ（水着）・ラブ・キサキ（水着）・
    // シュン（水着）・トキ・ノア（パジャマ）・イブキ）で、形態 1 にダメージが
    // 無いときは、**ダメージのある形態を既定にする**。黙って 0 にするより良い
    // （2026-09-01。ホバークラフト前半のアリスがこれで 42.9% → 87.8% になった）
    var pid = idBy[who];
    if (frm == null && pid && TE.FORM_RULE[pid] === 'pick' && !formHasDmg(pid, 0)) {
      var fl2 = formsOf(pid), fz;
      for (fz = 1; fz < fl2.length; fz++) {
        if (formHasDmg(pid, fz)) { frm = fz; break; }
      }
      if (frm != null) { autoF[pid] = (fl2[frm] || {}).n; }
    }
    lastWho = who;
    // **「何発かに分けて撃つ子」を覚えておく。**ダメージのある形態が 2 つ以上ある子
    // （ヒナ（ドレス）・ホシノ（臨戦）など）。射目行はこの子の続きとして読む
    var pidS = idBy[who], nd = 0, fq, flS = pidS != null ? formsOf(pidS) : [];
    for (fq = 0; fq < flS.length; fq++) { if (formHasDmg(pidS, fq)) { nd++; } }
    if (nd >= 2) { lastShot = who; }
    // 【7】**「A/B」は「渡し先」か「2 人同時」か。**書き方が同じなので、
    // **左の子の EX にダメージがあるかで分ける**（データから決まる）。
    //   「マリー/ホシノ」  マリー（アイドル）の EX はダメージ無し → 渡し先
    //   「イブキ/ホシノ」  どちらも殴る子 → 2 人同時に撃つ
    // 「アリス/溜」のように右が編成にいない語なら、どちらでもない（形態の指定）
    var alsoWho = -1;
    var sl = nrm(noParen).split(/[\/／]/);
    if (sl.length === 2) {
      var wR = whoIn(sl[1], crew);
      if (wR >= 0 && wR !== who) {
        var pidL = idBy[who];
        if (pidL != null && formHasDmg(pidL, 0)) { alsoWho = wR; }
        else if (toL.indexOf(wR) < 0) { toL.push(wR); }
      }
    }
    // 【8】**「1～3射目」「3連射」は 1 行で何発も撃つ。**割らないと 2/3 が消える
    var rep = 1, rm2 = nrm(cut).match(/([0-9０-９])\s*[～~〜\-]\s*([0-9０-９])\s*射/);
    if (rm2) { rep = Math.max(1, +rm2[2] - +rm2[1] + 1); }
    else {
      rm2 = nrm(cut).match(/([0-9０-９])\s*連射/) || nrm(cut).match(/[×x✕]\s*([0-9０-９])(?![0-9０-９:.])/);
      if (rm2) { rep = Math.max(1, +zen0(rm2[1])); }
    }
    // 【8.5】**「ヒナ①②③」は 3 発。**名前のあとに丸数字が 2 つ以上続けて並ぶのは、
    // **1 周の中の何発目か**（ヒナ（ドレス）＝ 開演：イシュ・ボシェテ → ①旋律の一音目・
    // ②二音目・③終演の旋律）。丸数字 N ＝ 形態 N として、並んだぶんだけ発を置く。
    // **飛んでいるときは間の形態を補う。**②③ の前には 0 コストでない「開演」が要る
    // （FORM_RULE が 'alt' の子だけ。順に送って一周する子）。
    // 1 発と読むと 3 周で 9 発のはずが 4 発になっていた
    // （2026-09-03、総力戦ホバークラフト c3eN2Cf7QVc。動画 3 発目 1 発で 4.93M）。
    // **単独の丸数字（「即ヒナ①」「❽チャージ①」）には手を出さない。**前者は今までどおり
    // 1 発、後者は EX の名前側に付く番号で形態ではない
    var fseq = null, pidF = idBy[who];
    if (pidF != null) {
      var nFm = formsOf(pidF).length, cmF = nrm(cut).match(/[①-⑳]{2,}/);
      if (cmF && nFm > 1) {
        var sq = [], okF = true, cz;
        for (cz = 0; cz < cmF[0].length; cz++) {
          var vN = CIRC.indexOf(cmF[0].charAt(cz)) + 1;
          if (vN < 1 || vN >= nFm || (cz > 0 && vN !== sq[cz - 1] + 1)) { okF = false; break; }
          sq.push(vN);
        }
        if (okF) { fseq = sq; }
      }
      if (fseq && TE.FORM_RULE[pidF] === 'alt') {
        var expF = lastForm[who] == null ? 0 : (lastForm[who] + 1) % nFm, preF = [];
        while (expF !== fseq[0] && preF.length < nFm) { preF.push(expF); expF = (expF + 1) % nFm; }
        fseq = preF.concat(fseq);
      }
    }
    if (fseq) { frm = fseq[0]; rep = fseq.length; }
    var one = { i: who, md: tm.md, t: tm.t == null ? 0 : tm.t, tg: aim, f: frm, mc: mcn,
                // 分を省いた残り時間。**分は `applyTL1` が置いた順から決める**
                rem: remKeep,
                to: toL.length ? (toL.length > 1 ? toL : toL[0]) : null,
                cv: tm.cv == null ? null : tm.cv,
                copy: (/C[^\s]*$/i.test(nrm(noParen).replace(/^[^C]*?(?=C)/, '')) &&
                      /(^|[^A-Za-z])C/.test(nrm(noParen))) || /コピー/.test(nrm(noParen)),
                line: ln.trim(), note: note.trim() };
    // **「(緑壺)」「(紫壺)」「［紫色の聖遺物］」は事象。**当たる先としてだけでなく、
    // ボスの状態が変わる引き金でもある（ヒエロニムス: 緑の壺の回復で被ダメージ率
    // +55%（最大 5 回）、紫の壺の破壊で DEF −1,500）。色を持たせておき、`applyTL` が
    // 発射秒の決まったあとに `gim` の同じ色の行と突き合わせて窓を置く
    // （2026-09-03。それまでは人が inputs で窓を置かないと 幅の中 にならなかった）
    var colM = nrm(cut).match(/([緑紫赤青])(?:色)?(?:の)?(?:壺|つぼ|聖遺物)/);
    if (colM) { one.col = colM[1]; }
    // **味方側の「段階」を数える行**（イェソドの分析段階）。「即ハナコ 3」「4.1ハナコ 5 青」の
    // ように**行の末尾に立っている 1 桁**が、壊した灯火の順番＝分析段階。
    // ボスが段階のバフを持っているとき（`stg`）だけ読む
    if (diff().stg) {
      // **`nrm` は空白を全部落とすので、素の行で見る。**「即ハナコ 5 青」の
      // 「5」は名前と離して書いてあり、そこが「段階」と「コスト・秒」の分かれ目
      var stM = cut.replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
                   .match(/[\s　]([1-9])(?:[\s　]*([青赤]))?[\s　]*$/);
      if (stM) { one.stg = +stM[1]; if (stM[2]) { one.stgb = stM[2]; } }
    }
    cur.uses.push(one);
    for (var rq = 1; rq < rep; rq++) {
      var cp2 = {}, ck;
      for (ck in one) { if (has(one, ck)) { cp2[ck] = one[ck]; } }
      cp2.md = 'e'; cp2.cv = null; cp2.t = 0;
      if (fseq) { cp2.f = fseq[rq]; }
      cur.uses.push(cp2);
    }
    if (rep > 1) {
      if (fseq) {
        var fnm = [], fl9 = formsOf(pidF), fz9;
        for (fz9 = 0; fz9 < fseq.length; fz9++) { fnm.push((fl9[fseq[fz9]] || {}).n || fseq[fz9]); }
        res.notes.push('「' + ln.trim() + '」の丸数字は形態の番号なので ' + rep + ' 発（' +
                       fnm.join('→') + '）として置きました');
      } else {
        res.notes.push('「' + ln.trim() + '」は ' + rep + ' 発として置きました');
      }
    }
    // 形態がどこまで進んだかを覚える（次の行の丸数字が飛んでいるかを見るため）
    if (fseq) { lastForm[who] = fseq[fseq.length - 1]; }
    else if (pidF != null && formsOf(pidF).length > 1) {
      var nFm2 = formsOf(pidF).length, rq9;
      for (rq9 = 0; rq9 < rep; rq9++) {
        if (frm != null) { lastForm[who] = frm; }
        else if (TE.FORM_RULE[pidF] === 'alt') {
          lastForm[who] = lastForm[who] == null ? 0 : (lastForm[who] + 1) % nFm2;
        }
      }
    }
    if (alsoWho >= 0) {
      var cp3 = {}, ck2;
      for (ck2 in one) { if (has(one, ck2)) { cp3[ck2] = one[ck2]; } }
      cp3.i = alsoWho; cp3.to = null; cp3.f = null; cp3.md = 'e'; cp3.cv = null; cp3.t = 0;
      cur.uses.push(cp3);
      res.notes.push('「' + ln.trim() + '」は 2 人が続けて撃つ行として読みました');
    }
  }
  for (i in autoF) {
    if (has(autoF, i)) {
      res.notes.push('形態の指定が無いので「' + autoF[i] +
                     '」にしました（ダメージのある形態です。帯をクリックすると変えられます）');
    }
  }
  parts.push(cur);
  var nAll = 0;
  for (i = 0; i < parts.length; i++) { nAll += parts[i].uses.length; }
  if (!nAll) { return { err: 'タイムラインの行が 1 つも読めませんでした', notes: res.notes, skipped: res.skipped, crew: res.crew }; }
  res.parties = assignParties(parts);
  // 互換: 1 部隊目をそのまま res.crew / res.start / res.uses に出す
  res.crew = res.parties[0].crew; res.start = res.parties[0].start;
  res.uses = res.parties[0].uses; res.bufTo = res.parties[0].bufTo;
  if (res.parties.length > 1) {
    res.notes.push(res.parties.length + ' 部隊として読みました（P1〜P' + res.parties.length +
                   '。左の P ボタンで切り替え）');
  }
  return res;
}
