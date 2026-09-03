import { $, B, S, esc, img } from './util.js';
import { LAY, SLOTS, TE, st } from './core.js';
import { boss, crewCount, diff } from './boss.js';
import { engIn, kindOf, recPower, whyOf } from './engine.js';
import { costRun } from './chart.js';
import { SCEN, scen, scenIx } from './scen.js';
import { poolName, poolOrder } from './pool.js';
import { awayDrop, carryIn, killAt, partyCalc, scoreOf, secLab } from './carry.js';
import { n0 } from './rate.js';
import { nsInfo, nsWhy } from './ns.js';
import { exKind, usesSorted } from './buff.js';
import { isSingle } from './target.js';
import { altList, altOf } from './alt.js';
import { dmgOf } from './dmg.js';
import { clearStat, total } from './clear.js';
import { PH_T, drawOrd, resetOrdKey } from './ord.js';
import { bstLabel } from './bossui.js';

export function kpi() {
  var r = diff(), hp = (r.bs && r.bs.hp) || 0, t = total(r), run = costRun(r.dur || 240);
  // **100% で止めるのは棒だけ。**数字は本当の値を出す（超えたら倒しきれる）
  // **見せる数字はシナリオで切り替える**（2026-09-01 の先生の指示）。
  // 図（フェーズの移り・グロッキー）も同じシナリオで引き直す
  var sc = scen(), ts = total(r, sc.pf), v = ts[sc.key];
  var real = hp ? v / hp * 100 : 0, pct = Math.min(100, real);
  // 幅を持つスキルがあるときは、下と上も添える
  var lo = total(r, -1).min, hi = total(r, 1).max, band = '';
  if (hp && t.n && hi - lo > 1) {
    band = '　下振れ ' + n0(lo) + '〜 上振れ ' + n0(hi) +
           '（' + (lo / hp * 100).toFixed(1) + '〜' + (hi / hp * 100).toFixed(1) + '%）';
  }
  // **選べるのは `ui: true` の 3 つだけ。**残りは計算にだけ使う（`SCEN` の注記）
  var so = '', sq;
  for (sq = 0; sq < SCEN.length; sq++) {
    if (!SCEN[sq].ui) { continue; }
    so += '<option value="' + sq + '"' + (sq === scenIx() ? ' selected' : '') + '>' +
          esc(SCEN[sq].lab) + '</option>';
  }
  function box(lbl2, val, sub) {
    return '<div class="k"><span class="kl">' + lbl2 + '</span><b class="kv">' + val + '</b>' +
           (sub ? '<span class="ks">' + sub + '</span>' : '') + '</div>';
  }
  function chip(lbl2, val) {
    return '<span class="pill"><b>' + val + '</b> ' + lbl2 + '</span>';
  }
  // **倒しきったときだけスコアを出す**（2026-09-01 の先生の指示）。
  // 削り切れないタイムでは「クリアぶん」が入らないので、数字を出す意味がない
  /** **突破率。**1 発ごとの平均と分散を足して、合計ダメージを正規分布とみなし
      「HP を削り切る確率」を出す（`clearStat`）。**ダメージの振れだけ**で、
      TL が時間内に成立するかは別。 */
  function pct1(v) {
    var x = v * 100;
    return x >= 99.95 ? '99.9+' : (x <= 0.05 && x > 0 ? '0.1-' : x.toFixed(1));
  }
  function probBox() {
    if (!hp || !t.n) { return ''; }
    var cs2 = clearStat(r, 0);
    if (!(cs2.sd > 0)) { return ''; }
    var pc = cs2.p * 100;
    var cls = pc >= 90 ? ' win' : (pc < 50 ? ' bad' : '');
    // **条件つきのスキルがあるときは、下と上の引きでも出す。**
    // どの枝を引くかは盤の状態で決まるので、確率にはできない
    var sub = '平均 ' + n0(Math.round(cs2.mu)) + '・ばらつき ±' +
              n0(Math.round(cs2.sd)) + '（' + cs2.n + ' 発）';
    if (altList().length) {
      var lo2 = clearStat(r, -1), hi2 = clearStat(r, 1);
      if (Math.abs(hi2.p - lo2.p) > 0.001) {
        sub = '倍率の幅が 下振れなら ' + pct1(lo2.p) + '%・上振れなら ' +
              pct1(hi2.p) + '%　' + sub;
      }
    }
    return '<div class="k' + cls + '"><span class="kl">突破率' +
      '<i class="hint" title="置いた TL で HP を削り切る確率です。' +
      '1 発ごとのダメージの振れ・命中・会心を足し合わせて、合計を正規分布とみなしています。' +
      'TL が時間内に成立するか、盤の上で何体に当たるかは入っていません">?</i>' +
      '</span><b class="kv">' + pct1(cs2.p) + '%</b>' +
      '<span class="ks">' + sub + '</span></div>';
  }
  function scoreBox() {
    var k = killAt(r);
    if (k == null) { return ''; }
    // **複数部隊は全部隊の合計秒で減る。**前の部隊の終了時刻を足す
    var secs = [], sum = 0, j;
    for (j = 0; j < st.pi; j++) { var e0 = partyCalc(j).end; secs.push(secLab(e0)); sum += e0; }
    secs.push(secLab(k)); sum += k;
    var sv = scoreOf(r, sum);
    if (sv == null) { return ''; }
    return '<div class="k win"><span class="kl">スコア</span>' +
           '<b class="kv">' + n0(sv) + '</b>' +
           '<span class="ks">' + (st.pi > 0 ? secs.join(' + ') + ' = ' : '') + secLab(sum) +
           ' で撃破' + (st.pi > 0 ? '（' + (st.pi + 1) + ' 部隊）' : '・1 部隊だけの数字') + '</span></div>';
  }
  // **池が 2 つ以上・部隊が 2 つ以上のときの内訳**
  function poolBox() {
    var pc = partyCalc(st.pi), o = poolOrder(r), lines = [], j, cr = carryIn(st.pi);
    if (o.length <= 1 && st.pi === 0) { return ''; }
    for (j = 0; j < pc.pools.length; j++) {
      var pk1 = pc.pools[j], done = pc.dealt[pk1.pid] || 0;
      lines.push(esc(poolName(r, pk1.pid)) + ' ' + n0(Math.round(done)) + ' / ' + n0(pk1.need) +
        (cr[pk1.pid] ? '（持ち越し −' + n0(Math.round(cr[pk1.pid])) + '）' : '') +
        (pk1.kill != null ? '　' + secLab(pk1.kill) + ' で撃破' : ''));
    }
    return box('討伐の内訳', pc.kill != null ? secLab(pc.kill) : '届かない',
               lines.join('<br>') + (st.pi < st.parties.length - 1 ?
               '<br>この部隊の終わり ' + secLab(pc.end) + (pc.manual ? '（手で指定）' : (pc.gu ? '（ギブアップ）' : '')) : ''));
  }
  var sb0 = run.sim.IN._sb, recP = recPower(), lay = LAY[st.mode];
  // **左端にボスの顔と英語表記。**難易度ごとに数字だけ並んでいると
  // どのボスを見ているか分からなかった（2026-09-01 の先生の指摘）
  var bb = boss();
  $('kpi').innerHTML =
    '<div class="kboss" title="' + esc(bb.n + '　' + r.df) + '">' +
    '<img src="../img/bossicon_' + esc(bb.path) + '.webp" alt="" loading="lazy">' +
    '<span class="bn">' + esc(bb.dev || bb.n) + '</span>' +
    '<span class="bd">' + esc(r.df) + '</span></div>' +
    '<div class="kres">' +
    box('与ダメージ<span class="pick" title="どの振れ方で見るか">' + esc(sc.lab) +
        '<i class="cv">\u25be</i><select id="k-scen">' + so + '</select></span>',
        t.n ? n0(v) : '—',
        'EX ' + ts.ex.n + '・NS ' + ts.ns.n + '・通常 ' + ts.na.n + ' 発' + band) +
    box('ボス HP に対して', hp ? real.toFixed(1) + '%' : '—',
        hp ? (real >= 100 ? '倒しきれます（HP ' + n0(hp) + '）' : n0(hp)) : '—') +
    probBox() +
    scoreBox() +
    poolBox() +
    box('置いた EX', st.tl.length + ' 発',
        run.bad.length ? run.bad.length + ' 発がコスト不足でずれます' : '詰まりなし') +
    box('終わりのコスト', run.end.toFixed(2), '上限 ' + run.cap.toFixed(1)) +
    box('編成', crewCount() + ' / ' + (lay.main + lay.sup) + ' 人',
        'ST ' + lay.main + '・SP ' + lay.sup + '　パーティー ' +
        (st.pi + 1) + ' / ' + st.parties.length) +
    '</div>' +
    // **「編成」までを詰めて、空いた右に「スキル順」**（2026-09-03 の先生の要望）。
    // 中身は `drawOrd` が別に入れる（カーソルの秒ごとに引き直すので）
    '<div class="kord" id="kord"></div>' +
    // **条件（動かす前から決まっている数字）は右にまとめる。**
    // ツールバーの 2 段目にあったものをここへ寄せた
    '<div class="kcond">' +
    chip('コスト回復力', recP ? String(recP) : '—') +
    chip('コスト上限', run.cap.toFixed(1)) +
    chip('開始コスト', sb0 ? (Math.round(sb0.amt * 100) / 100) + '（' + sb0.d.n + '）' : '0') +
    chip('制限時間', (r.dur || 240) + '秒') +
    '</div>' +
    '<div class="kbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
  // 入れ物ごと作り直したので、前の絵の覚えは捨ててから引き直す
  resetOrdKey();
  drawOrd(PH_T == null ? 0 : PH_T);
}
/** その 1 発を「いつ指定したか」。**最速・コスト指定は秒を持たない**ので、
    そのまま出すと「ネル（制服） ：…」と空いた（2026-09-01 の先生の指摘） */
export function whenOf(row) {
  if (row.e && row.e.t != null) { return row.e.t.toFixed(2) + '秒'; }
  var u = row.e && row.e._ix != null ? st.tl[row.e._ix] : null;
  if (u && u.md === 'c') { return 'コスト ' + (u.cv == null ? '?' : u.cv) + ' 指定'; }
  if (u && u.md === 'e') { return '最速指定'; }
  return '';
}
export function drawErr() {
  var r = diff(), out = [];
  out.push(['g', boss().n + ' ' + r.df + ' を読み込みました']);
  if (!crewCount()) { out.push(['w', '編成が空です。左から生徒を選んでください']); }
  if (r.fb && r.fb.length) {
    out.push(['w', 'この難易度はビヘイビアツリーが無いので Normal の木で埋めています（' + r.fb.join(' ') + '）']);
  }
  if (!r.per) { out.push(['w', '通常スキルの長さが引けないので、EX はゲージぶんだけです']); }
  var run = costRun(r.dur || 240);
  if (!st.tl.length) {
    out.push(['w', 'EX レーンをクリックするとスキルが置けます（グリッド移動の刻みに吸い付きます）']);
  } else {
    out.push(['g', 'スキルを ' + st.tl.length + ' 個置いています（終わりのコスト ' + run.end.toFixed(2) + '）']);
  }
  for (var q = 0; q < run.bad.length; q++) {
    var br = run.bad[q], bp = st.party[br.e.i], bk = kindOf(br);
    out.push([bk === 'over' ? 'e' : 'w',
      ((bp && bp.n) || '?') + ' ' + whenOf(br) + '：' + whyOf(br)]);
  }
  // **渡し先が決まっていないものを名指しで出す。**実物の TL を写していて、
  // セイアのコスト減少カードの渡し先を決め忘れると、後半が 20 秒ぶんまるごと
  // 撃てなくなった（2026-09-01）。黙って損をするので、ここで知らせる
  for (var w1 = 0; w1 < run.sim.rows.length; w1++) {
    var wr = run.sim.rows[w1];
    if (!wr.d || wr.at == null) { continue; }
    if (wr.grant && wr.grant.sd !== 'self' && wr.to == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：コスト' +
        (wr.grant.vt === 'coef' ? '減少' : '増加') + 'カードの渡し先が決まっていません' +
        '（帯をクリックして選びます）']);
    }
    if (TE.ovlMs(wr.d) && wr.e.ov == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：オーバーコストの渡し先が' +
        '決まっていません（帯をクリックして選びます）']);
    }
    if (wr.d.sp && wr.d.sp.copy && wr.e.bt == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：カードを複製する相手が' +
        '決まっていません（帯をクリックして選びます）']);
    }
  }
  var pl = TE.pool(engIn([], r.dur || 240));
  if (pl.efs.length) {
    var parts = [], pq;
    for (pq = 0; pq < pl.efs.length; pq++) {
      var pe = pl.efs[pq];
      parts.push(pe.m.d.n + ' ' + (pe.e.k === 'b' ? '+' + pe.v : '+' + (pe.v / 100) + '%'));
    }
    out.push(['g', 'コスト回復力（常時ぶん） ' + Math.round(pl.total) + ' ＝ 基礎 ' +
      (S.base * pl.ms.length) + '（' + pl.ms.length + '人）＋ ' + parts.join('・') +
      '。持続するものは、その EX を撃った時刻から効きます']);
  } else {
    out.push(['g', 'コスト回復力 ' + Math.round(pl.total) + '（基礎だけ。1 人 ' + S.base + '）']);
  }
  var sb1 = run.sim.IN._sb;
  if (sb1) {
    out.push(['g', '開始コスト ' + (Math.round(sb1.amt * 100) / 100) + '（' + sb1.d.n +
      ' ノーマル Lv' + sb1.lv + (sb1.per ? '／' + sb1.n + ' 人ぶん' : '') + '）' +
      (sb1.off.length ? '／' + sb1.off.join('・') + ' は不発' : '')]);
  }
  for (var y = 0; y < SLOTS; y++) {
    var yp = st.party[y];
    if (!yp || nsInfo(yp.id)) { continue; }
    out.push(['w', yp.n + ' の通常スキルは置いていません：' + nsWhy(yp.id)]);
  }
  out.push(['w', '通常攻撃は「ずっと撃ち続けられる」前提で数えています。移動・遮蔽・' +
    '射程外・敵の数は入っていないので、そのぶん多めに出ます']);
  // **「味方1人」の渡し先が決まっていないものを名指しする**（2026-09-01）
  for (var s1 = 0; s1 < run.sim.rows.length; s1++) {
    var sr0 = run.sim.rows[s1];
    if (!sr0.d || sr0.at == null || sr0.e.bto != null) { continue; }
    if (!isSingle(sr0.d.id, exKind(sr0.fi))) { continue; }
    out.push(['w', sr0.d.n + ' ' + (sr0.e.t == null ? '' : sr0.e.t.toFixed(2) + '秒') +
      '：バフを渡す相手が決まっていません（帯をクリックして選びます）']);
  }
  for (var s2 = 0; s2 < SLOTS; s2++) {
    var np = st.party[s2];
    if (!np || st.slots[s2].nsto != null) { continue; }
    if (!isSingle(np.id, 'Public') && !isSingle(np.id, 'GearPublic')) { continue; }
    out.push(['w', np.n + '：通常スキルのバフを渡す相手が決まっていません（左の「バフを渡す相手」で選びます）']);
  }
  // **形態を選ばないとダメージが 0 のままの子がいる**（2026-09-01）。
  // アリス（臨戦）・ミカ（水着）・ラブ・キサキ（水着）・シュン（水着）・トキ・
  // ノア（パジャマ）・イブキ は、本体の EX が「選択メニュー」だったり、
  // 何発目でどの形態になるかが回数で決まらなかったりするので、engine が
  // `pick` として形態 1 のまま置く（`tools/tl-engine.js` の `FORM_RULE`）。
  // **黙って 0 になると、貼った TL が丸ごと軽く出る**ので名指しで出す
  var zf = {}, zn = [];
  function zHas(id, k) { return !!((B.dmg[id] || {})[k] || altOf(id, k)); }
  for (var z1 = 0; z1 < run.sim.rows.length; z1++) {
    var zr = run.sim.rows[z1];
    if (!zr.d || zr.at == null || !zr.fl || zr.fl.length < 2) { continue; }
    // **自分で形態を選んである行は言わない**（アリス（臨戦）の「(チャージ)」は
    // ダメージ 0 で正しい）。engine が回数で決めている子（`hold`/`alt`）も
    // 選びようがないので言わない。残るのは `pick` で未指定のときだけ
    if (zr.e && zr.e.f != null) { continue; }
    if (TE.FORM_RULE[zr.d.id] !== 'pick') { continue; }
    if (zHas(zr.d.id, exKind(zr.fi))) { continue; }
    // **そもそも全部の形態にダメージが無い子は、選んでも 0 のまま。**
    // イブキ（水着）の「イブキのお友達！／どれがいいかな？」がそれで、
    // 支援の子を名指ししても直しようがない（2026-09-01 にビナーの TL で気づいた）
    var zAny = false;
    for (var z2 = 0; z2 < zr.fl.length; z2++) {
      if (zHas(zr.d.id, exKind(z2))) { zAny = true; break; }
    }
    if (!zAny) { continue; }
    if (!zf[zr.d.n]) { zf[zr.d.n] = 1; zn.push(zr.d.n); }
  }
  if (zn.length) {
    out.push(['e', zn.join('・') + ' は形態を選ばないとダメージが 0 のままです' +
      '（帯をクリックして「形態」を選びます）']);
  }
  // **部位に当てたぶんの集計。**ボスの HP からは引いていないので、
  // どれだけ当てたかはここで出す（2026-09-01）
  var subs0 = r.sub || [];
  if (subs0.length) {
    var acc = {}, us0 = usesSorted(), z2, key0 = scen().key;
    for (z2 = 0; z2 < us0.length; z2++) {
      var u0 = us0[z2];
      if (u0.tg == null) { continue; }
      var d0 = dmgOf(u0.i, r, u0.t, u0.k, u0.pk, u0.tg, u0.gx);
      if (!d0) { continue; }
      if (!acc[u0.tg]) { acc[u0.tg] = { n: 0, v: 0, mc: 0 }; }
      acc[u0.tg].n++; acc[u0.tg].v += d0[key0] * (u0.mc || 1);
      acc[u0.tg].mc = Math.max(acc[u0.tg].mc, u0.mc || 1);
    }
    var kz;
    for (kz in acc) {
      var sb0 = subs0[kz] || {};
      var hpUnk = sb0.hpCopy || !sb0.hp;
      out.push([hpUnk ? '' : (acc[kz].v >= sb0.hp ? 'g' : 'w'),
        sb0.n + '（HP ' + (hpUnk ? '不明' : n0(sb0.hp)) + '）へ ' + acc[kz].n + ' 発・' +
        n0(Math.round(acc[kz].v)) + '　' +
        (hpUnk ? '（部位の HP はデータに無いので、壊せるかは分かりません）' : (acc[kz].v >= sb0.hp ? '壊せます' : '壊しきれません')) + '。' +
        (sb0.tr
          ? 'ここに当てたぶんは ' + sb0.tr + '% がボスへ転移します（' + sb0.trw + '）'
          : 'ここに当てたぶんはボスの HP から引いていません')]);
    }
    if (!Object.keys(acc).length) {
      // **名前が同じ行が並ぶことがある**（聖歌隊が 6 行、ペロロミニオンが 11 行）。
      // 一覧に出すときは名前で畳む
      var nm0 = [], z4;
      for (z4 = 0; z4 < subs0.length; z4++) {
        if (nm0.indexOf(subs0[z4].n) < 0) { nm0.push(subs0[z4].n); }
      }
      out.push(['w', 'このボスには部位が ' + nm0.length + ' 種あります（' +
        nm0.join('・') + '）。柱や装置に撃つ行は、' +
        '帯をクリックして「当たる先」を選びます']);
    }
    // **転移する部位は、当てないとボスの HP が減らない。**名指しで出す
    var trn = [], z5;
    for (z5 = 0; z5 < subs0.length; z5++) {
      if (subs0[z5].tr && trn.indexOf(subs0[z5].n) < 0) { trn.push(subs0[z5].n); }
    }
    if (trn.length) {
      out.push([Object.keys(acc).length ? 'g' : 'e',
        trn.join('・') + ' に当てたぶんは、そのままボスの HP から減ります' +
        '（' + subs0[0].tr + '% 転移）。範囲攻撃なら当たった数だけ入るので、' +
        '帯の「当たる先」でその部位を選んで、「当たる数」に体数を入れてください。' +
        'TL が「（左聖歌隊 5体）」のように書いていれば読み込みが拾います']);
    }
  }
  // **この道具が自分では決めないもの。**盤の上で起きることは時刻も数もデータに無い
  // （2026-09-01 に 14 体を TL 動画と突き合わせて、先生と線を引いた）
  out.push(['w', '当たる先・当たる数・ボスの状態は、この道具が自分では決めません。' +
    '範囲攻撃が何体に当たるか、ギミックがいつ入るか、部位がいつ出てくるかは' +
    'データに無いので、置くのは先生です']);
  var nalt = altList().length;
  if (nalt) {
    out.push(['w', '条件でダメージが変わるスキルが ' + nalt +
      ' つあります。左の「倍率の幅」のバーで選べます' +
      '（段だけで割れているものは、撃った回数から自動で決めています）']);
  }
  out.push(['w', 'バフは EX・NS・PS・固有武器・SS の全部を見ています。' +
    '乗せていないのは SS の発動ぶん 87 件（引き金が要るもの）だけです']);
  out.push(['w', 'SS のダメージと遮蔽はまだ入っていません']);
  if (st.bst.length) {
    var bh = [], z3;
    for (z3 = 0; z3 < st.bst.length; z3++) {
      var w3 = st.bst[z3];
      bh.push(bstLabel(w3.k) + (w3.k === 'away' || w3.k === 'mob' || w3.k === 'groggy' ? '' : ' ' + (w3.v >= 0 ? '+' : '') + w3.v +
              (w3.k === 'damaged' || w3.k === 'def' ? '%' : '')) +
              '（' + (+w3.t0).toFixed(1) + '〜' + (+w3.t1).toFixed(1) + '秒）');
    }
    out.push(['g', 'ボスの状態を ' + st.bst.length + ' つ置いています：' + bh.join('・')]);
    var ad = awayDrop(r);
    if (ad.sec) {
      out.push(['g', 'ボスに当たらない区間が合計 ' + ad.sec.toFixed(1) + ' 秒。その間の EX ' +
        ad.ex + ' 発・NS ' + ad.ns + ' 発・通常攻撃 ' + ad.na + ' 発は数えていません']);
    }
  } else {
    var gmN = (diff().gim || []).length;
    out.push(['w', 'ボスの状態は置いていません。' + (gmN
      ? 'このボスの説明文からは ' + gmN + ' 件の候補が拾えています（「ギミックから選ぶ」）。'
      : '14 体のうち 11 体が被ダメージ率を動かします。') +
      '**引き金はデータから時刻を決められない**ので、' +
      '「ボスの状態」で効いている間を置いてください']);
  }
  out.push(['w', '通常攻撃はいつもボス本体に当たる前提です。' +
    '柱や装置に撃つ EX は、帯をクリックして「当たる先」を選べます']);
  // **実測 2 本との突き合わせ**（2026-09-01）。下の「数字の出どころ」に詳しい
  out.push(['w', '実物の TL と突き合わせています。大決戦ホド Torment 貫通・屋内は ' +
    '「ミカ最終弾後」の残 HP が 実測 7,322,787 に対して 平均 7,765,262（−4.1%）、' +
    '大決戦ビナー Torment 貫通・屋外は TL 1 ページ目の終わりが ' +
    '実測 残 2,754,853 に対して 全会心平均 3,057,691（−1.5%）です。' +
    'ボスによっては、これより大きく外れます（下の「数字の出どころ」）']);
  $('errlog').innerHTML = out.map(function (x) {
    return '<div class="' + x[0] + '">' + (x[0] === 'g' ? '✔ ' : (x[0] === 'e' ? '✕ ' : '▸ ')) + esc(x[1]) + '</div>';
  }).join('');
}
