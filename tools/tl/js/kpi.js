import { $, B, esc, img } from './util.js';
import { LAY, SLOTS, TE, st } from './core.js';
import { boss, crewCount, diff } from './boss.js';
import { engIn, kindOf, recPower, whyOf } from './engine.js';
import { costRun } from './chart.js';
import { SCEN, scen, scenIx } from './scen.js';
import { poolName, poolOrder } from './pool.js';
import { carryIn, killAt, partyCalc, scoreOf, secLab } from './carry.js';
import { n0 } from './rate.js';
import { exKind, usesSorted } from './buff.js';
import { isSingle } from './target.js';
import { altList, altOf } from './alt.js';
import { dmgOf } from './dmg.js';
import { clearStat, total } from './clear.js';
import { PH_T, drawOrd, resetOrdKey } from './ord.js';

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
        'EX ' + ts.ex.n + '・NS ' + ts.ns.n + '・通常 ' + ts.na.n +
        (ts.ss && ts.ss.n ? '・SS ' + ts.ss.n : '') + ' 発' + band) +
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
  // **画面に出すのは「先生が直せること」だけ**（2026-09-03 の先生の指示
  // 「注釈とかマジでいらないから全箇所」「画面に入れるべき情報と TL tool を
  // テストする時の注意点を混同しないで」）。道具の限界・突き合わせの経過・
  // 使い方の案内は全部やめた。前は 20 行以上の文章がここに常時出ていた。
  // **1 件も無ければ枠ごと消える**（空の枠が余白になるので）
  var r = diff(), out = [], run = costRun(r.dur || 240), q;
  // 出せない 1 発
  for (q = 0; q < run.bad.length; q++) {
    var br = run.bad[q], bp = st.party[br.e.i];
    out.push([kindOf(br) === 'over' ? 'e' : 'w',
      ((bp && bp.n) || '?') + ' ' + whenOf(br) + '：' + whyOf(br)]);
  }
  // 渡し先が決まっていない 1 発
  for (q = 0; q < run.sim.rows.length; q++) {
    var wr = run.sim.rows[q];
    if (!wr.d || wr.at == null) { continue; }
    if (wr.grant && wr.grant.sd !== 'self' && wr.to == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：コスト' +
        (wr.grant.vt === 'coef' ? '減少' : '増加') + 'カードの渡し先']);
    }
    if (TE.ovlMs(wr.d) && wr.e.ov == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：オーバーコストの渡し先']);
    }
    if (wr.d.sp && wr.d.sp.copy && wr.e.bt == null) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：カードを複製する相手']);
    }
    if (wr.e.bto == null && isSingle(wr.d.id, exKind(wr.fi))) {
      out.push(['w', wr.d.n + ' ' + whenOf(wr) + '：バフを渡す相手']);
    }
  }
  for (q = 0; q < SLOTS; q++) {
    var np = st.party[q];
    if (!np || st.slots[q].nsto != null) { continue; }
    if (!isSingle(np.id, 'Public') && !isSingle(np.id, 'GearPublic')) { continue; }
    out.push(['w', np.n + '：通常スキルのバフを渡す相手']);
  }
  // 形態を選ばないとダメージが 0 のままの子
  var zf = {}, zn = [];
  function zHas(id, k) { return !!((B.dmg[id] || {})[k] || altOf(id, k)); }
  for (q = 0; q < run.sim.rows.length; q++) {
    var zr = run.sim.rows[q];
    if (!zr.d || zr.at == null || !zr.fl || zr.fl.length < 2) { continue; }
    if (zr.e && zr.e.f != null) { continue; }
    if (TE.FORM_RULE[zr.d.id] !== 'pick') { continue; }
    if (zHas(zr.d.id, exKind(zr.fi))) { continue; }
    var zAny = false, z2;
    for (z2 = 0; z2 < zr.fl.length; z2++) {
      if (zHas(zr.d.id, exKind(z2))) { zAny = true; break; }
    }
    if (!zAny) { continue; }
    if (!zf[zr.d.n]) { zf[zr.d.n] = 1; zn.push(zr.d.n); }
  }
  if (zn.length) { out.push(['e', zn.join('・') + '：形態']); }
  // **被ダメージを転移する部位があるのに、当たる先を置いていない発**
  // （2026-09-03。ペロロジラの TL 4 本で、実測との 4 倍の開きが全部これだった。
  //  `7bTd5o8Ru80` は 幅の中 9% → 100%、`WPsUxtkDMQU` は 27% → 100%）。
  // **数は道具では決まらない**（`sub[].cnt` は場に湧く最大で、
  //  その一発が何体に当たったかは盤の上の話）ので、置くのは使う人。
  // ここは「置いていない」ことだけを知らせる
  var trn = null, tq, noTg = 0;
  for (tq = 0; tq < (r.sub || []).length; tq++) {
    if (r.sub[tq] && r.sub[tq].tr > 0) { trn = r.sub[tq]; break; }
  }
  if (trn) {
    // **ダメージを出す発だけ数える。**バフだけの EX に当たる先を置いても何も変わらない
    // （2026-09-03。先生の盤で 21 発中 16 発がバフで、「18 発」と出ていた）
    var uz = usesSorted();
    for (q = 0; q < uz.length; q++) {
      if (uz[q].tg != null || !/^Ex\d*$/.test(uz[q].k)) { continue; }
      if (dmgOf(uz[q].i, r, uz[q].t, uz[q].k, uz[q].pk, null, uz[q].gx)) { noTg++; }
    }
    if (noTg) {
      out.push(['w', noTg + ' 発：当たる先（' + trn.n + 'は被ダメージの ' +
        trn.tr + '% をボスへ転移）']);
    }
  }
  // **グロッキーで分かれるボスなのに、窓を 1 つも置いていない**（2026-09-03）。
  // `gc`（条件つきでグロッキー）のボスは時刻が解けないので、`ggCritAt` が
  // 常に偽になり、確定会心も分裂の ×N も一度も乗らない
  // `gc` はボス（`boss()`）側にある。難易度の行ではない
  if (r.gspl && r.gspl.gg && boss() && boss().gc) {
    var gw = 0;
    for (q = 0; q < (st.bst || []).length; q++) { if (st.bst[q].k === 'groggy') { gw++; } }
    if (!gw) { out.push(['w', 'グロッキーの窓（確定会心と ×' + r.gspl.n + ' が効きません）']); }
  }
  var pane = $('errlog').closest('.pane');
  if (pane) { pane.hidden = !out.length; }
  $('errlog').innerHTML = out.map(function (x) {
    return '<div class="' + x[0] + '">' + (x[0] === 'e' ? '\u2715 ' : '\u25b8 ') + esc(x[1]) + '</div>';
  }).join('');
}
