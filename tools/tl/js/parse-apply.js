import { $, S } from './util.js';
import { SLOTS, bump, mkParty, mkSlot, st } from './core.js';
import { mark, usePartyRef } from './undo.js';
import { diff, has } from './boss.js';
import { kindOf, orderOf, simOf } from './engine.js';
import { draw } from './draw.js';
import { aliasOf, nrm } from './parse-text.js';
import { drawCrew, drawParty, drawPicker, fillBuild } from './left.js';
import { bstLabel, drawBstate } from './bossui.js';

/** 名前から生徒を探す。**括弧の全半角と「水着セイア」型を吸収する。** */
/** **「／」で枝分かれしている子がいる。**「ホシノ（臨戦）／アタッカー」と
    「ホシノ（臨戦）／タンク」がそれで、TL は「ホシノ(臨戦)」としか書かない。
    名前だけでは決められないので、**先に並んでいるほうを採って、
    選んだことと候補を `notes` に出す**（2026-09-01）。
    はっきりさせたいときは「ホシノ(臨戦)／タンク」と書けばそちらを採る。 */
export function slashKin(n) {
  var out = [], i;
  for (i = 0; i < S.students.length; i++) {
    var w = nrm(S.students[i].n);
    if (w.indexOf(n + '/') === 0 || w.indexOf(n + '／') === 0) { out.push(S.students[i]); }
  }
  return out;
}
// **通称。**TL に出てくる呼び名で、名前の一部でも括弧の中でもないもの（2026-09-02、ビスケット・ラムネの報告）
export var NICK = { 'クロコ': 'シロコ＊テラー', 'テラー': 'シロコ＊テラー', 'シロコテラー': 'シロコ＊テラー',
             '臨おじ': 'ホシノ（臨戦）／アタッカー', 'おじ': 'ホシノ（臨戦）／アタッカー' };
export function nickOf(n) {
  var k = nrm(n).replace(/[＊*・]/g, '');
  return has(NICK, k) ? NICK[k] : null;
}
export function findStudent(nm, notes) {
  // **名前に飾りが付く。**「リオ（助っ人）」「水着ミカ（レンタル）：固有4」
  // 「[助]マコト固有３」「シロコテラー」（正しくは シロコ＊テラー）。
  // 落としてから引く（2026-09-02、総力戦ゴズ・大決戦ケセドで 5 本が壊れていた）
  var n = nrm(nm)
    .replace(/\[[^\]]*\]/g, '').replace(/[（(](?:助っ?人|レンタル|助|借り)[)）]/g, '')
    // **括弧に入らない「助っ人」もある**（「助っ人水着マコト」「マコト（水着）助っ人」。
    // 2026-09-03、屋内ペロロジラ GzfPSXaZKlU と cbAthbwldys で主砲が丸ごと落ちていた）
    .replace(/^(?:助っ?人|レンタル|借り)/, '').replace(/(?:助っ?人|レンタル|借り)$/, '')
    .replace(/[：:].*$/, '').replace(/[＊*・]/g, ''), i, byBase = [];
  if (!n) { return null; }
  var nk = nickOf(n);
  if (nk) { for (i = 0; i < S.students.length; i++) { if (S.students[i].n === nk) { return S.students[i]; } } }
  for (i = 0; i < S.students.length; i++) {
    var a = aliasOf(S.students[i].n);
    if (a.alts.indexOf(n) >= 0) { return S.students[i]; }
    if (a.base === n) { byBase.push(S.students[i]); }
  }
  for (i = 0; i < byBase.length; i++) {
    if (nrm(byBase[i].n) === n) { return byBase[i]; }
  }
  if (byBase.length === 1) { return byBase[0]; }
  // **括弧の中だけで呼ぶ通称**（「臨戦」＝ ホシノ（臨戦）、「ドレス」＝ …）。
  // **1 人に決まるときだけ**採る（2026-09-02、総力戦ペロロジラで 12 行が消えていた）
  var inn = [];
  for (i = 0; i < S.students.length; i++) {
    var m4 = nrm(S.students[i].n).match(/^(.+?)\((.+)\)/);
    if (m4 && m4[2].split(/[／\/]/)[0] === n) { inn.push(S.students[i]); }
  }
  if (inn.length === 1) { return inn[0]; }
  // **「臨戦」が ホシノ（臨戦）／アタッカー と ／タンク の 2 人に当たる。**括弧の前まで
  // 同じなら同じ子なので先頭を採り、候補を注記に出す（2026-09-02、ペロロジラの
  // 「23.50臨戦」6 行が黙って消えていた）
  if (inn.length > 1) {
    var sameBase = true, mm5, base5 = null;
    for (i = 0; i < inn.length; i++) {
      mm5 = nrm(inn[i].n).match(/^(.+?\(.+?\))/);
      if (!mm5) { sameBase = false; break; }
      if (base5 == null) { base5 = mm5[1]; } else if (base5 !== mm5[1]) { sameBase = false; break; }
    }
    if (sameBase) {
      if (notes) {
        var ns2 = [];
        for (i = 0; i < inn.length; i++) { ns2.push(inn[i].n); }
        notes.push(nm + ' は ' + ns2.join('・') + ' のうち ' + inn[0].n + ' にしました（分けたいときは名前まで書いてください）');
      }
      return inn[0];
    }
  }
  var kin = slashKin(n);
  if (kin.length) {
    if (kin.length > 1 && notes) {
      var ns = [];
      for (i = 0; i < kin.length; i++) { ns.push(kin[i].n); }
      notes.push(nm + ' は ' + ns.join('・') + ' のうち ' + kin[0].n +
                 ' にしました（分けたいときは名前まで書いてください）');
    }
    return kin[0];
  }
  return null;
}
/** 読んだものを実際に入れる。**戻すのは中身の要約。** */
export function applyTL(p) {
  mark();
  var ps = p.parties || [p], k2, z3, out = { n: 0, ng: [], slip: [], parties: 0 };
  // **部隊ごとに入れる。**st.parties を作り直して、1 部隊ずつ今までの手順で流す。
  // ボスの状態の窓は、置いてあったものを部隊の番号ごとに残す
  var oldB = [];
  for (k2 = 0; k2 < st.parties.length; k2++) { oldB.push(st.parties[k2].bst || []); }
  st.parties = [];
  for (k2 = 0; k2 < ps.length && k2 < 4; k2++) {
    st.parties.push(mkParty()); st.parties[k2].bst = oldB[k2] || [];
    st.pi = k2; usePartyRef(); bump();
    st.parties[k2].gu = !!ps[k2].gu;
    var r1 = applyTL1(ps[k2]), tag = ps.length > 1 ? 'P' + (k2 + 1) + ' ' : '';
    out.n += r1.n; out.parties++;
    for (z3 = 0; z3 < r1.ng.length; z3++) { out.ng.push(tag + r1.ng[z3]); }
    for (z3 = 0; z3 < r1.slip.length; z3++) { out.slip.push(tag + r1.slip[z3]); }
  }
  st.pi = 0; usePartyRef(); st.sel = null; st.who = -1; bump();
  fillBuild(); drawParty(); drawBstate(); drawCrew(); drawPicker(); draw();
  return out;
}
export function applyTL1(p) {
  var i, k;
  for (i = 0; i < SLOTS; i++) { st.slots[i] = mkSlot(); }
  st.tl.length = 0; st.start.length = 0; st.sel = null; st.who = -1;
  for (i = 0; i < p.crew.length; i++) {
    var c = p.crew[i];
    if (c.idx == null) { continue; }
    var sl = st.slots[c.idx];
    sl.id = c.id;
    for (k in c) {
      if (k !== 'id' && k !== 'idx' && k !== 'name' && k !== 'pt' && c[k] != null) { sl[k] = c[k]; }
    }
    if (p.bufTo != null) { sl.nsto = p.bufTo; }
  }
  for (i = 0; i < p.start.length && i < 9; i++) { st.start.push(p.start[i]); }
  // **TL の事象（部位の破壊・クレーン）をボスの状態に置く。**ギミックの候補（`gim`）に
  // 「すべて破壊」型（外骨格 +300%）があれば破壊 3 つ目の時刻から、「除去 1 個毎」型
  // （錆びたドラム缶 +5%）があればクレーン 1 回ごとに 1 個として、終わりまで積む。
  // 何個除去したかは行に無いので 1 回 1 個（注記に出す。2026-09-02）
  var evN = [];
  if (p.ev && p.ev.length) {
    var gmL = (diff().gim || []), gAll = null, gEach = null, ge;
    for (ge = 0; ge < gmL.length; ge++) {
      if (gmL[ge].k !== 'damaged') { continue; }
      if (/すべて破壊|全て破壊|外骨格/.test(gmL[ge].t || '')) { gAll = gmL[ge]; }
      else if (/毎|ごと/.test(gmL[ge].t || '')) { gEach = gmL[ge]; }
    }
    var durE = diff().dur || 240, nb = 0, nc = 0;
    if (!st.bst) { st.bst = []; }
    for (ge = 0; ge < p.ev.length; ge++) {
      var ev = p.ev[ge];
      if (ev.k === 'break') {
        nb++;
        if (nb === 3 && gAll) {
          st.bst.push({ k: 'damaged', v: gAll.v, t0: ev.t, t1: durE, n: gAll.n });
          evN.push('「' + ev.line + '」で 3 つ目の破壊なので、' + gAll.n + '（+' + gAll.v + '%）を ' +
                       ev.t.toFixed(1) + ' 秒から終わりまで置きました');
        }
      } else if (gEach) {
        nc++;
        st.bst.push({ k: 'damaged', v: gEach.v, t0: ev.t, t1: durE, n: gEach.n });
        evN.push('「' + ev.line + '」で ' + gEach.n + '（+' + gEach.v + '%、1 回 1 個とみなす）を ' +
                     ev.t.toFixed(1) + ' 秒から終わりまで置きました（' + nc + ' 個目）');
      }
    }
  }
  // **書いてある順を守る。**`tlSorted()` は `t` で並べ替えるので、
  // 「コストで指定」「最速」を `t: 0` のまま積むと順番が潰れる。
  // 1 発ずつ engine に解かせて、決まった時刻を `t` に書き戻す
  var dur = diff().dur || 240, prev = 0;
  for (i = 0; i < p.uses.length; i++) {
    var u = p.uses[i];
    var tt2 = u.to == null ? p.bufTo : u.to;
    // **分を省いた残り時間（「39.60臨戦」）の分を、ここで決める**（2026-09-03）。
    // 候補は 残り = rem, 60+rem, 120+rem …。**前の行より後ろになるいちばん早い時刻**を採る。
    // 節に「M:SS」が 1 つも無いと分は書いてある順からしか決まらず、parse の時点では
    // 前の行の解けた時刻が分からない（コスト指定・最速の行はここで初めて決まる）
    if (u.rem != null && u.md === 't') {
      // **前の行より 5 秒だけ手前まで許す。**コスト指定の行の解けた時刻は engine の
      // コスト回復の見積もりぶんだけ後ろにずれることがあり、ちょうど `prev` で切ると
      // 正しい分（1 つ手前）を弾いて 1 分後ろへ飛ぶ
      var rk = null, mk;
      for (mk = 0; mk * 60 + u.rem <= dur; mk++) {
        if (dur - (mk * 60 + u.rem) >= prev - 5) { rk = mk * 60 + u.rem; }
      }
      if (rk != null) { u.t = Math.max(0, dur - rk); }
    }
    var row = { i: u.i, t: u.md === 't' ? u.t : Math.min(dur, prev + 0.01),
                to: tt2, ov: tt2, f: u.f == null ? null : u.f,
                tg: u.tg == null ? null : u.tg, mc: u.mc == null ? 1 : u.mc,
                // **ボス本体にも当たる**（範囲攻撃。`total0` と `dmgCurve0` が見る）
                hb: u.hb ? 1 : 0,
                bt: tt2, bto: tt2,
                md: u.md, cv: u.cv };
    st.tl.push(row);
    var rr = simOf(orderOf(), dur).rows, at = null, q2;
    for (q2 = 0; q2 < rr.length; q2++) {
      if (rr[q2].e && rr[q2].e._ix != null && st.tl[rr[q2].e._ix] === row) { at = rr[q2].at; }
    }
    // **書き戻す時刻は、前の行より必ず後ろにする。**`tlSorted()` は `t` で
    // 並べ替えるので、素の解決時刻をそのまま書くと**書いてある順が入れ替わる**
    // （2026-09-01。先生の TL で「即ネル」が 54.5 秒、次の「⑨リオ」が 46.2 秒に
    // 解けて、リオがネルより前に回り「間に合いません」になっていた）。
    // 実際に撃つ時刻は `md`／`cv` から毎回解き直すので、ここの `t` は並び順の札
    if (u.md !== 't' && at != null) { row.t = Math.max(at, prev + 1e-4); }
    if (row.t > prev) { prev = row.t; }
  }
  // **色つきの的に当てた行から、ボスの状態の窓を置く**（2026-09-03、総力戦ヒエロニムス）。
  // 発射秒は上の解き直しで `st.tl[i].t` に入っているので、ここで初めて分かる。
  // 値も重ねる回数も `gim`（`RaidSkills` の原文）から取る。**色の付いていない
  // ギミックには当てない**（緑の壺と紫の壺で効果が違うため）
  var gmC = (diff().gim || []), nCol = {}, ic, jc;
  for (ic = 0; ic < p.uses.length && ic < st.tl.length; ic++) {
    if (!p.uses[ic].col) { continue; }
    var hitG = false;
    for (jc = 0; jc < gmC.length; jc++) {
      var g2 = gmC[jc];
      if (g2.c !== p.uses[ic].col) { continue; }
      hitG = true;
      var capM = String(g2.t || '').match(/最大で?(\d+)回/), t0c = +st.tl[ic].t;
      var key2 = p.uses[ic].col + '/' + jc;
      nCol[key2] = (nCol[key2] || 0) + 1;
      if (capM && nCol[key2] > +capM[1]) {
        evN.push('「' + p.uses[ic].line + '」は ' + g2.n + ' の重ねられる回数（' + capM[1] +
                 ' 回）を超えるので置きませんでした');
        continue;
      }
      st.bst.push({ k: g2.k === 'def' ? 'defAbs' : g2.k, v: g2.v,
                    t0: t0c, t1: g2.d ? Math.min(dur, t0c + g2.d) : dur });
      evN.push('「' + p.uses[ic].line + '」（' + p.uses[ic].col + '）で ' + g2.n + '（' +
               bstLabel(g2.k === 'def' ? 'defAbs' : g2.k) + ' ' + (g2.v >= 0 ? '+' : '') + g2.v +
               '）を ' + t0c.toFixed(1) + ' 秒から' + (g2.d ? ' ' + g2.d + ' 秒間' : '終わりまで') +
               '置きました（' + nCol[key2] + ' 回目）');
    }
    if (!hitG) {
      evN.push('「' + p.uses[ic].line + '」の「' + p.uses[ic].col +
               '」に当たるギミックがデータに無いので、窓は置いていません');
    }
  }
  // **味方側の「段階」を、ボスの被ダメージ率の窓で代用する**（2026-09-03、総力戦イェソド）。
  // 分析段階は「1 段階ごとに味方ストライカーの ATK +40%・会心率 +20% …」で**味方側**の
  // バフだが、道具にあるのはボス側の窓だけ。ATK の増加ぶんだけを被ダメージ率に置き換える
  // （会心の増加ぶんは置けないので、そのぶん道具は低く出る。**注記に出す**）。
  // 段階は「イェソドが次の EX を使う時に初期化」なので、**次に段階 1 が出る行まで**続ける
  var sg = diff().stg;
  if (sg && sg.atk) {
    var mk = [], im;
    for (im = 0; im < p.uses.length && im < st.tl.length; im++) {
      if (p.uses[im].stg) {
        mk.push({ n: p.uses[im].stg, t: +st.tl[im].t, b: p.uses[im].stgb || null,
                  line: p.uses[im].line });
      }
    }
    var cyc = [], cq;
    for (im = 0; im < mk.length; im++) {
      if (mk[im].n === 1 || !cyc.length) { cyc.push([]); }
      cyc[cyc.length - 1].push(mk[im]);
    }
    // **効くのは「5 段階に達するか、EX を防いだ」瞬間から。**原文が
    // 「該当効果は分析段階が5段階に達するか、イェソドのスキルを防いだ場合、到達段階の分適用」
    // なので、1 段ずつ積み上げるのではなく、**引き金の秒からまとめて**乗せる。
    // 引き金は「5 段まで数えた」か、行末の「青」「赤」（＝どの色で防いだか）
    var nPut = 0;
    for (im = 0; im < cyc.length; im++) {
      var endC = im + 1 < cyc.length ? cyc[im + 1][0].t : dur;
      var lastM = cyc[im][cyc[im].length - 1], nSt = Math.min(cyc[im].length, sg.max);
      if (cyc[im].length < sg.max && !lastM.b) { continue; }
      st.bst.push({ k: 'damaged', v: sg.atk * nSt, t0: lastM.t, t1: endC });
      nPut++;
    }
    if (mk.length) {
      evN.push(sg.n + 'を ' + cyc.length + ' 周・' + mk.length + ' 段ぶん読んで、' +
               nPut + ' 周ぶんの窓を置きました（' + sg.sk + 'の味方 ATK +' + sg.atk +
               '%／段を、道具に味方側の窓が無いのでボスの被ダメージ率で代用しています' +
               (sg.cr ? '。会心率 +' + sg.cr + '%／段は置けないので入っていません' : '') + '）');
    }
  }
  bump();
  // **「置けない」と「後ろにずれる」を分ける。**ずれるだけのものまで
  // 「成立しません」と出していて、読み込みが失敗したように見えていた
  // （2026-09-01。実際は全部置けていて、演出待ちで数秒後ろになるだけ）
  var rows = simOf(orderOf(), diff().dur || 240).rows, ng = [], slip = [];
  for (i = 0; i < rows.length; i++) {
    if (!rows[i].d) { continue; }
    if (rows[i].at == null) { ng.push(rows[i].d.n + '（置けません）'); }
    else if (rows[i].at > (diff().dur || 240) + 1e-9) {
      slip.push(rows[i].d.n + ' は制限時間を超えます（' + rows[i].at.toFixed(1) + ' 秒。数えていません）');
    }
    else if (rows[i].why) {
      var ix9 = rows[i].e && rows[i].e._ix != null ? rows[i].e._ix : -1;
      if (ix9 >= 0 && st.tl[ix9] && st.tl[ix9].md === 't' && kindOf(rows[i]) === 'cost') {
        slip.push(rows[i].d.n + ' は書いてある ' + (+st.tl[ix9].t).toFixed(1) + ' 秒のまま置きました' +
                  '（道具の計算ではコストが足りず ' + rows[i].at.toFixed(1) + ' 秒。回復力の取りこぼしが疑わしいです）');
      } else {
        slip.push(rows[i].d.n + ' ' + rows[i].at.toFixed(1) + '秒（' + rows[i].why + '）');
      }
    }
  }
  return { n: p.uses.length, ng: ng, slip: slip.concat(evN) };
}

/* 書き方の案内。**1 つの書き方に縛らない**（2026-09-01 の先生の指示）。
   下の形は「こう書けば必ず読める」という目安で、ふだんの書き方も大体通ります */
export var FMT_HELP = [
  '<div class="g">育成の行 — 名前と、分かるものだけ並べます</div>',
  '<div>　<b>ネル（制服）　Lv90 固有4/50 装備10 EX5 NS10 PS10 SS10 絆20</b></div>',
  '<div>　<b>カンナ（水着）　★3 MMMM t10/10/10</b>（MMMM ＝ 4 つとも上限）</div>',
  '<div>　固有N ＝ 固有武器★N（Lv は /50 のように足せます）。' +
    '★N ＝ 固有武器なしで神秘★N。装備は T9 でも 6/10/10 でも</div>',
  '<div class="g">開始スキル</div>',
  '<div>　<b>開始SET：①イブキ ②セイア ③ネル ④リオ ⑤水着セイア</b></div>',
  '<div class="g">TL の行 — いつ撃つか＋誰が＋（渡す相手）</div>',
  '<div>　<b>⑦セイア</b> ／ <b>c7 セイア</b> ／ <b>コスト7 セイア</b>　… コスト 7 で撃つ</div>',
  '<div>　<b>2:30.100 リオ</b>　… 残り 2 分 30.1 秒　／　<b>t35 リオ</b>　… 開始 35 秒</div>',
  '<div>　<b>9.5 ネル</b>　… 直前から 9.5 秒あと</div>',
  '<div>　<b>即ネル</b> ／ <b>最速ネル</b> ／ <b>AUTO ネル</b>　… 撃てるいちばん早い時刻</div>',
  '<div>　<b>c5 ネル → セイア</b>　… 渡す相手をその 1 発だけ指定（「,」で 2 人まで）</div>',
  '<div>　<b>※バフは全てネル指定</b>　… 全部の渡し先をまとめて指定</div>',
  '<div class="g">読まない行</div>',
  '<div>　「※」から後ろ、支援値、ページ目、移行、参考、上振れ・下振れ、' +
    'AUTO の ON/OFF。<b>読めなかった行は下に全部出します</b></div>'
].join('');
