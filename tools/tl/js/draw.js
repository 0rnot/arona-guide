import { $, B, H, esc, img, mmss, skName, stu } from './util.js';
import { SLOTS, TE, live, st } from './core.js';
import { exBuffDur, exCost, exDur } from './uses.js';
import { boss, diff } from './boss.js';
import { kindOf, recPower, sim, whyOf } from './engine.js';
import { costRun, poly, ticks, vgrid, yOf } from './chart.js';
import { ggAt, ggRuns, killAt, phaseSpans } from './carry.js';
import { buffTip, drawCrit, drawRate, n0 } from './rate.js';
import { drawErr, kpi } from './kpi.js';
import { clamp } from './stats.js';
import { ssCount } from './passive.js';
import { nsBuffDur, nsDur, nsInfo, nsKind, nsTimes, nsWhy } from './ns.js';
import { naInfo, naRuns } from './na.js';
import { exKind, usesSorted } from './buff.js';
import { enemyAt } from './target.js';
import { altOf } from './alt.js';
import { zero } from './clear.js';
import { movePh } from './ord.js';
import { drawAlts } from './left.js';
import { drawView, syncAim } from './view.js';
import { drawUse } from './useedit.js';
import { drawRows } from './rows.js';
import { bstName, bstTip } from './bossui.js';
import { laneOn } from './lanes.js';
import { epEvery, epWhy } from './ep.js';

// ------------------------------------------------------------ 盤
export function draw() {
  // **先に鍵を更新する。**この 1 回の描き直しのあいだ覚えておく答え（`memo`）は
  // `sim` の鍵で捨てるので、いちばん先に引いておく（2026-09-03）
  sim();
  var r = diff(), dur = r.dur || 240, px = st.px, W = Math.max(200, Math.round(dur * px));
  // **盤が決められる発は、当たる先・当たる数・本体にも当たるかを盤から書き戻す**
  // （2026-09-04）。`_rt`（コスト指定の実際の秒）が要るので `sim()` のあとに走らせ、
  // **書き戻したら `sim()` をもう一度**。`sim` の鍵は `st.tl` そのものなので、
  // 何も変わらなければ 2 回目はただの取り出しで終わる
  syncAim(r);
  sim();
  var ph0 = r.ph['0'] || { ev: [], g: null, hp: [], raw: [] };
  var side = '', cv = '';
  function lane(hh, inner, cls) {
    return '<div class="ln' + (cls ? ' ' + cls : '') + '" style="height:' + hh +
           'px;width:' + W + 'px">' + vgrid(dur, px) + (inner || '') + '</div>';
  }
  function lbl(hh, html, cls) {
    return '<div class="lb' + (cls ? ' ' + cls : '') + '" style="height:' + hh + 'px">' + html + '</div>';
  }
  // **押せるものだけ置く。**C・詳細・鍵は聞き手がいないボタンだった
  // （2026-09-01 に外した）
  var mini = '';

  side += lbl(H.axis, '<b>時間軸</b>');
  cv += '<div class="ln axis" style="height:' + H.axis + 'px;width:' + W + 'px">' + ticks(dur, px) + '</div>';

  var spans = phaseSpans(r), ggr = ggRuns(r);
  var nameBar = '';
  for (var sp = 0; sp < spans.length; sp++) {
    var sg = spans[sp], x0 = sg.t0 * px, x1 = Math.min(sg.t1, dur) * px;
    var ggv = ggAt(ggr, sg.t0);
    var ttl = 'フェーズ ' + (+sg.p + 1) +
      (sg.need == null ? '' : '\n' + n0(sg.need) + ' 削ると次へ') +
      (sg.t0 > 0 ? '\n' + sg.t0.toFixed(2) + '秒／残り ' + mmss(dur, sg.t0) : '') +
      (ggv == null ? '' : '\nここでグロッキー ' + n0(Math.round(ggv)) + ' / ' +
       n0(ggr.g.need) + '（' + (ggr.g.need ? (ggv / ggr.g.need * 100).toFixed(1) : '0') + '%）');
    nameBar += '<div class="b name ph' + (+sg.p % 3) + '" style="left:' + x0.toFixed(1) +
      'px;width:' + Math.max(2, x1 - x0).toFixed(1) + 'px" title="' + esc(ttl) + '">' +
      (sp === 0 ? esc(boss().n) + '　' + esc(r.df) + '　' : '') +
      'フェーズ ' + (+sg.p + 1) + '</div>';
  }
  // **段の取捨選択**（2026-09-03）。`laneOn` が偽なら見出しも帯も出さない
  if (laneOn('boss')) { side += lbl(H.name, '<b>ボス</b>'); cv += lane(H.name, nameBar); }

  // **フェーズごとに、そのフェーズの頭からの時刻で描く**（2026-09-01）
  var s = '', s2 = '', spi, k, q;
  for (spi = 0; spi < spans.length; spi++) {
    var g0 = spans[spi], pd = r.ph[g0.p] || { ev: [], g: null };
    var lim = Math.min(g0.t1, dur);
    for (k = 0; k < (pd.ev || []).length; k++) {
      var e = pd.ev[k];
      if (e[1] == null) { continue; }
      var tt = g0.t0 + e[1];
      if (tt > lim) { continue; }
      for (q = 0; q < e[2].length; q++) {
        var gi = e[2][q], g = r.ex[gi] || ('?' + gi);
        var w = Math.max(10, ((r.exd && r.exd[gi]) || 60) / B.fps * px);
        s += '<div class="b ' + (gi === 0 ? 'ex' : 'ex2') + '" style="left:' + (tt * px).toFixed(1) +
             'px;width:' + w.toFixed(1) + 'px" title="' + esc(skName(g)) + '（' + esc(g) + '）\n' +
             'フェーズ ' + (+g0.p + 1) + ' の通常スキル ' + e[0] + ' 発目\n' +
             tt.toFixed(1) + '秒／残り ' + mmss(dur, tt) + '">' + esc(skName(g)) + '</div>';
      }
    }
    if (pd.g) {
      var gi2 = pd.g[1][0], g2 = r.ex[gi2] || ('?' + gi2);
      var w2 = Math.max(10, ((r.exd && r.exd[gi2]) || 60) / B.fps * px);
      for (var t2 = g0.t0 + pd.g[0]; t2 <= lim; t2 += pd.g[0]) {
        s2 += '<div class="b ps" style="left:' + (t2 * px).toFixed(1) + 'px;width:' + w2.toFixed(1) +
              'px" title="' + esc(skName(g2)) + '（' + esc(g2) + '）\nフェーズ ' + (+g0.p + 1) +
              '\n' + t2.toFixed(1) + '秒／残り ' + mmss(dur, t2) + '">' + esc(skName(g2)) + '</div>';
      }
    }
  }
  if (laneOn('boss')) {
    side += lbl(H.ex, mini + '<span class="nm">EX</span>');
    cv += lane(H.ex, s);
    side += lbl(H.ps, mini + '<span class="nm">PS</span>');
    cv += lane(H.ps, s2);
  }

  // ボスの状態。**窓を名前つきの帯で出す**（2026-09-03。数字の行だけだと
  // どの EX に乗るのかが見えない）。端の摘みで t0 / t1、× で消す
  var bsB = '', bwi;
  for (bwi = 0; bwi < (st.bst || []).length; bwi++) {
    var wq = st.bst[bwi];
    if (wq.t0 >= dur) { continue; }
    var qx0 = wq.t0 * px, qx1 = Math.min(wq.t1, dur) * px;
    bsB += '<div class="b bst k-' + esc(wq.k) + '" data-bw="' + bwi + '" style="left:' +
           qx0.toFixed(1) + 'px;width:' + Math.max(20, qx1 - qx0).toFixed(1) +
           'px" title="' + esc(bstTip(wq, dur)) + '">' +
           '<i class="gr" data-bg="0"></i>' +
           '<span class="nm">' + esc(bstName(wq)) + '</span>' +
           '<i class="x" data-bx="' + bwi + '">×</i>' +
           '<i class="gr" data-bg="1"></i></div>';
  }
  if (laneOn('boss')) {
    side += lbl(H.bst, '<span class="nm">ボスの状態</span>' +
      (st.bst.length ? '<span class="mb">' + st.bst.length + '</span>' : ''));
    // **空のときは何も書かない。**先生の指示「注釈とかマジでいらないから全箇所」
    // （2026-09-03）。候補が有るか無いかは上のチップの並びを見れば分かる
    cv += lane(H.bst, bsB || '');
  }

  // グロッキー。**ダメージで貯まるボスだけ線を引く**（2026-09-01 の先生の要望）
  var gs = '', gm = ggr.g;
  // **吸収で貯まるボスも同じ折れ線で描く**（2026-09-04。`carry.js` の `ggAbsorbRuns`）
  if (gm.kind === 'ダメージ' || gm.kind === '吸収') {
    var prevG = null, gi3;
    for (gi3 = 0; gi3 < ggr.pts.length; gi3++) {
      var pt = ggr.pts[gi3];
      if (prevG && pt[0] > prevG[0]) {
        gs += '<div class="ggf" style="left:' + (prevG[0] * px).toFixed(1) + 'px;width:' +
              ((pt[0] - prevG[0]) * px).toFixed(1) + 'px;height:' +
              (prevG[1] / gm.need * (H.gg - 2)).toFixed(1) + 'px" title="' +
              n0(Math.round(prevG[1])) + ' / ' + n0(gm.need) + '（' +
              (prevG[1] / gm.need * 100).toFixed(1) + '%）\n' +
              prevG[0].toFixed(1) + '秒／残り ' + mmss(dur, prevG[0]) + '"></div>';
      }
      prevG = pt;
    }
    for (gi3 = 0; gi3 < ggr.hits.length; gi3++) {
      var hh2 = ggr.hits[gi3];
      gs += '<div class="b gg" style="left:' + (hh2.t * px).toFixed(1) + 'px;width:' +
            Math.max(6, (Math.min(hh2.until, dur) - hh2.t) * px).toFixed(1) +
            'px" title="グロッキー ' + hh2.t.toFixed(1) + '秒 〜 ' + hh2.until.toFixed(1) +
            '秒（' + gm.sec + ' 秒）">グロッキー</div>';
    }
  }
  var ggLbl = gm.kind === 'ダメージ'
    ? '<span class="nm">グロッキー</span><span class="tag">' + n0(gm.need) + '</span>'
    : '<span class="nm">グロッキー</span><span class="tag">' +
      (gm.kind === 'なし' ? 'なし' : gm.kind === '実質なし' ? 'ダメージでは貯まらない'
        // **貯まり方が DB から出るボス**（`carry.js` の `ggMode` の `gga`）。
        // ペロロジラは「転倒した大きなペロロミニオン 1 体につき step/10000」で、
        // 上限体数なら `hit` 回の吸収で満ちる（2026-09-04）
        : gm.kind === '吸収' && gm.gga
          ? '吸収 ' + gm.gga.hit + ' 回（1 体 ' + gm.gga.step + '/10000・最大 '
            + gm.gga.cap + ' 体）'
          : '条件つき') +
      '</span>';
  if (laneOn('boss')) { side += lbl(H.gg, ggLbl); cv += lane(H.gg, gs); }

  // デバフ数。**`liveBuffs` と同じ材料から切れ目を作る**（2026-09-01。
  // それまで EX の本体しか見ておらず、形態違いも通常スキルも数に入らず、
  // 置いた時刻（実際に出る時刻ではない）で切っていた）
  var dseg = '', cuts = [0], di, dq;
  var dus = usesSorted();
  for (di = 0; di < dus.length; di++) {
    var du = dus[di], dp = st.party[du.i];
    if (!dp) { continue; }
    var dl = (B.buf[dp.id] || {})[du.k || 'Ex'] || [];
    for (dq = 0; dq < dl.length; dq++) {
      var de = dl[dq], tg2 = de[0] || [], isE = false;
      for (var z3 = 0; z3 < tg2.length; z3++) { if (tg2[z3] === 'Enemy') { isE = true; } }
      if (!isE) { continue; }
      var s0 = du.t + (de[5] || 0) / B.fps;
      cuts.push(s0);
      if (de[4] != null) {
        var wsl2 = st.slots[du.i] || {};
        var wl2 = (wsl2.wstar >= 2 && wsl2.wlv > 0) ? (wsl2.plv || 0) : 0;
        cuts.push(s0 + TE.extend(stu(dp.id) || {}, { wp: wl2 }, de[4], 'enemy') / 1000);
      }
    }
  }
  cuts.push(dur);
  cuts.sort(function (a2, b2) { return a2 - b2; });
  for (di = 0; di < cuts.length - 1; di++) {
    var a1 = cuts[di], b1 = cuts[di + 1];
    if (b1 - a1 < 0.02 || a1 >= dur) { continue; }
    var cnt = enemyAt(r, (a1 + b1) / 2).n;
    if (!cnt) { continue; }
    dseg += '<div class="b dbf" style="left:' + (a1 * px).toFixed(1) + 'px;width:' +
            Math.max(2, (b1 - a1) * px).toFixed(1) + 'px" title="' +
            esc('デバフ ' + cnt + ' 本／' + a1.toFixed(1) + '〜' +
                Math.min(b1, dur).toFixed(1) + '秒' +
                buffTip(null, (a1 + b1) / 2, r, 'enemy')) + '">' +
            ((b1 - a1) * px >= 12 ? cnt : '') + '</div>';
  }
  if (laneOn('boss')) { side += lbl(H.dbf, '<span class="nm">デバフ数</span>'); cv += lane(H.dbf, dseg); }

  var run = costRun(dur), sm = run.sim;
  // **回復力は時間で変わる。**セイアのような「◯秒間コスト回復力増加」が
  // 乗っている間だけ段が上がる（2026-09-01 の先生の指摘。それまで常時ぶんの
  // 水平線 1 本しか描いていなくて、山がまったく見えなかった）
  var rec = recPower(), recPts = [], recMax = rec, rq;
  for (rq = 0; rq < sm.segs.length; rq++) {
    var sg = sm.segs[rq], rv = Math.round((sg.r || 0) * 10000);
    if (recPts.length && recPts[recPts.length - 1][1] === rv) { continue; }
    if (recPts.length) { recPts.push([sg.t, recPts[recPts.length - 1][1]]); }
    recPts.push([sg.t, rv]);
    if (rv > recMax) { recMax = rv; }
  }
  if (!recPts.length) { recPts = [[0, rec]]; }
  recPts.push([dur, recPts[recPts.length - 1][1]]);
  var ymax = Math.max(8000, Math.ceil(recMax / 2000) * 2000 + 2000);
  var recNow = recPts[recPts.length - 1][1];
  if (laneOn('rec')) {
  side += lbl(H.rec, '<b title="戦闘開始から ' + TE.REC_DELAY +
    ' 秒はコストが貯まりません（Excel/ConstCombatExcelTable の PlayerRegenCostDelay）。' +
    'そのあいだレーンは 0 です">回復力</b><span class="mb">最大 ' + recMax + '</span>');
  cv += lane(H.rec,
    '<svg class="plot" viewBox="0 0 ' + W + ' ' + H.rec + '" preserveAspectRatio="none">' +
    '<polyline class="rec0" points="' + poly([[0, rec], [dur, rec]], px, H.rec, ymax, 8) + '"/>' +
    '<polyline class="rec" points="' + poly(recPts, px, H.rec, ymax, 8) + '"/></svg>' +
    '<span class="vl" style="left:44px;top:' +
    clamp(H.rec - 8 - (rec / ymax) * (H.rec - 16) - 10, 1, H.rec - 12) +
    'px">常時 ' + rec +
    (recMax > rec ? '／最大 ' + recMax : '') + '</span>');
  }
  void recNow;

  if (laneOn('cost')) {
  // **オーバーコスト**（2026-09-04 の先生の指示「コストオーバーしてるなら
  // 視覚的にわかるようにしてほしい」）。**使った TL でだけ縦軸を −5 まで伸ばす**ので、
  // 使っていない TL の見た目は今までどおり。帯は「その枠が −5 まで沈められる区間」
  var lo = run.lo, y0 = yOf(0, H.cost, run.cap, 8, lo);
  function ovNm(ix) {
    var pp = st.party[ix];
    return pp ? pp.n : ('枠 ' + (ix + 1));
  }
  // **同じ枠に続けて配ったぶんは 1 本にまとめる。**ナギサ（水着）を 3 回撃つと
  // 26 秒の窓が 3 本重なって、帯の名前が 3 つ重なって読めなかった
  var ovm = [], owk;
  for (owk = 0; owk < run.ov.length; owk++) {
    var cw = run.ov[owk], last = null, om;
    for (om = 0; om < ovm.length; om++) {
      if (ovm[om].to === cw.to && cw.s <= ovm[om].e + 1e-9 &&
          (last === null || ovm[om].e > ovm[last].e)) { last = om; }
    }
    if (last === null) { ovm.push({ to: cw.to, s: cw.s, e: cw.e }); }
    else { ovm[last].e = Math.max(ovm[last].e, cw.e); }
  }
  var ovh = '';
  for (var ow = 0; ow < ovm.length; ow++) {
    var owx = ovm[ow], oa = Math.max(0, owx.s), ob = Math.min(dur, owx.e);
    if (ob <= oa) { continue; }
    ovh += '<div class="ovb" style="left:' + (oa * px) + 'px;width:' +
           ((ob - oa) * px) + 'px" title="' +
           esc('オーバーコスト ' + ovNm(owx.to) + '\n' +
               mmss(dur, oa) + ' 〜 ' + mmss(dur, ob) + '\n' +
               '保有コストを最大 5 まで超過して払えます（超過ぶんはマイナスのコストとして残る）') +
           '"><span>オーバーコスト ' + esc(ovNm(owx.to)) + '</span></div>';
  }
  side += lbl(H.cost, '<b>コスト</b>' +
    (lo < 0 ? '<span class="mb ovt">オーバーコスト</span>' : ''));
  cv += lane(H.cost, ovh +
    '<svg class="plot" viewBox="0 0 ' + W + ' ' + H.cost + '" preserveAspectRatio="none">' +
    '<line class="dash" x1="0" y1="8" x2="' + W + '" y2="8"/>' +
    '<line class="zero" x1="0" y1="' + y0.toFixed(1) + '" x2="' + W + '" y2="' + y0.toFixed(1) + '"/>' +
    (lo < 0 ? '<line class="ovf" x1="0" y1="' + (H.cost - 8) + '" x2="' + W +
              '" y2="' + (H.cost - 8) + '"/>' : '') +
    '<polyline class="cost" points="' + poly(run.pts, px, H.cost, run.cap, 8, lo) + '"/></svg>' +
    '<span class="yl" style="top:8px">' + run.cap.toFixed(1) + '</span>' +
    '<span class="yl" style="top:' + y0.toFixed(1) + 'px">0</span>' +
    (lo < 0 ? '<span class="yl neg" style="top:' + (H.cost - 8) + 'px">' +
              lo.toFixed(1) + '</span>' : ''));
  }

  // engine の行を「置いた 1 件」に結び直す。**形態・コスト・詰まりはここから取る**
  var rowOf = {};
  for (var z2 = 0; z2 < sm.rows.length; z2++) {
    if (sm.rows[z2].e && sm.rows[z2].e._ix != null) { rowOf[sm.rows[z2].e._ix] = sm.rows[z2]; }
  }
  var nlane = 0;
  void nlane;
  for (var i = 0; i < SLOTS; i++) {
    // **空き枠のレーンは描かない**（2026-09-01。初期画面の縦 6 割が
    // 空の EX・NS・通常の 3 本 × 6 人ぶんで埋まっていた）
    if (!live(i) || !st.party[i]) { continue; }
    nlane++;
    var p = st.party[i];
    // **NS と通常攻撃が出せないときの理由は、ここの `title` に持たせる**（43）
    var nsn0 = nsInfo(p.id), naI0 = naInfo(p.id);
    var lt = esc(p.n) +
      (nsn0 ? '' : '\n通常スキル：' + nsWhy(p.id)) +
      (naI0 ? '' : '\n通常攻撃：データがありません');
    side += lbl(H.row, img(p.id, 'ic') +
      '<span class="nm" title="' + lt + '">' + esc(p.n) + '</span>' +
      '<span class="mb">EX</span>');
    var sb = '';
    for (var u2 = 0; u2 < st.tl.length; u2++) {
      var uu = st.tl[u2];
      if (uu.i !== i || uu.t > dur) { continue; }
      var er = rowOf[u2] || null, ek = kindOf(er);
      var showT = (er && er.at != null) ? er.at
                : (uu._rt != null ? uu._rt : uu.t);
      var putT = (uu.md === 't' || !uu.md) ? uu.t
               : (uu._rt != null ? uu._rt : showT);
      var fnm = er && er.sk ? er.sk.n : (p && p.en) || '';
      var fk = exKind(er ? er.fi : 0);
      // **候補（条件つき）にしかダメージが無い形態がある。**ネル（制服）の
      // 「怪我しても知らねえからな」は 10 通りとも条件つきで、`B.dmg` 側が空。
      // それで「この形態にダメージのデータはありません」と出ていた（2026-09-01）
      var hasDmg = !!(B.dmg[p.id] || {})[fk] || !!altOf(p.id, fk);
      var fdu = er && er.sk ? er.sk.d : exDur(p);
      var fc = er ? er.need : exCost(p);
      var uw = Math.max(26, (fdu || 60) / B.fps * px);
      // **効果時間**（2026-09-03 の先生の指示「EX スキルも NS と同じように
      // 効果時間がタイムライン上でわかるようにしてほしい」）。
      // **掴む的（`.b.sk`）は太らせない。**幅を変えるとドラッグの当たり判定が
      // 動くので、薄い帯は別の箱（`.exeff`）にして下に敷く
      var ebd = exBuffDur(p.id, fk), ebw = Math.max(0, ebd * px - uw);
      // **オーバーコストで払った 1 発は、コストの数字を橙にする**（2026-09-04）。
      // `er.over` は engine が「払ったあとコストが 0 を割った」ときに立てる
      var inner = img(p.id, 'ic') +
                  '<b class="cs' + (er && er.over ? ' ovc' : '') + '">' +
                  (Math.round(fc * 10) / 10) + '</b>' +
                  (uw >= 90 ? '<span class="nm">' + esc(fnm) + '</span>' : '');
      var tips = esc(fnm) + '\nコスト ' + (Math.round(fc * 10) / 10) +
        (er && er.isCopy ? '（複製カード）' : '') +
        (er && er.fl && er.fl.length > 1 ? '\n形態 ' + (er.fi + 1) + '/' + er.fl.length : '') +
        (er && er.over
          ? '\nオーバーコストで払いました（残り ' + (Math.round(er.left * 10) / 10) + '）' : '') +
        '\n置いた ' + uu.t.toFixed(2) + '秒（残り ' + mmss(dur, uu.t) + '）' +
        (er && er.at != null && Math.abs(er.at - uu.t) > 0.01
          ? '\n実際に出る ' + er.at.toFixed(2) + '秒' : '') +
        (ebd > 0 ? '\n発動 ' + ((fdu || 60) / B.fps).toFixed(2) + '秒／効果 ' +
                   ebd.toFixed(1) + '秒' : '') +
        (hasDmg ? '' : '\nこの形態にダメージのデータはありません') +
        (er && er.why ? '\n⚠ ' + whyOf(er) : '') +
        buffTip(i, showT, r);
      if (Math.abs(showT - putT) > 0.01) {
        // **置いた時刻の印。**どこでタップしたつもりかが消えないように残す
        sb += '<div class="ghost" style="left:' + (putT * px).toFixed(1) + 'px;width:' +
              Math.max(2, (showT - putT) * px).toFixed(1) + 'px" title="' +
              '置いたのは ' + putT.toFixed(2) + '秒／出るのは ' + showT.toFixed(2) + '秒"></div>';
      }
      if (ebw > 0) {
        sb += '<div class="exeff" style="left:' + (showT * px).toFixed(1) + 'px;width:' +
              (uw + ebw).toFixed(1) + 'px"></div>';
      }
      sb += '<div class="b sk' + (st.sel === u2 ? ' sel' : '') +
            (ek ? ' bad' : '') + (er && er.isCopy ? ' cp' : '') +
            '" data-ix="' + u2 + '" style="left:' + (showT * px).toFixed(1) +
            'px;width:' + uw.toFixed(1) + 'px" title="' + tips + '">' + inner + '</div>';
    }
    cv += lane(H.row, sb, 'alt exlane" data-mem="' + i + '');
    var nb = '', nsn = p ? nsInfo(p.id) : null;
    if (p && nsn) {
      // **発動時間と効果時間を 1 本のバーの中で分ける**（2026-09-01 の先生の指示）。
      // 濃いところが演出（`Duration`）、薄いところがバフの持続（`bf[].du`）
      var nts = nsTimes(p.id, dur, i), nw = Math.max(10, nsDur(p.id) / B.fps * px);
      var nbd = nsBuffDur(p.id), ew = nbd > 0 ? nbd * px : 0;
      var nsk = nsKind(p.id), hasD = !!(B.dmg[p.id] || {})[nsk] || !!altOf(p.id, nsk);
      for (var nq = 0; nq < nts.length; nq++) {
        nb += '<div class="b ns' + (hasD ? '' : ' flat') + (ew > 0 ? ' eff' : '') +
              '" style="left:' + (nts[nq] * px).toFixed(1) + 'px;width:' +
              (nw + ew).toFixed(1) + 'px" title="' +
              esc(nsn.nm || '通常スキル') + '\n' +
              (nsn.src === 'na' ? '通常攻撃 ' + nsn.tc + ' 回ごと'
               : nsn.src === 'ammo' ? '弾倉ごと（弾薬 ' + nsn.trig + ' 発目）'
               : nsn.iv > 0 ? nsn.iv.toFixed(1) + '秒ごと（初回 ' + nsn.st.toFixed(1) + '秒）'
                            : '戦闘開始時に 1 回のみ') +
              '／' + nts[nq].toFixed(1) + '秒' +
              '\n発動 ' + (nsDur(p.id) / B.fps).toFixed(2) + '秒' +
              (nbd > 0 ? '／効果 ' + nbd.toFixed(1) + '秒' : '') +
              (hasD ? '' : '\nこのスキルはダメージを持ちません') +
              buffTip(i, nts[nq], r) + '">' +
              (ew > 0 ? '<i class="cst" style="width:' + nw.toFixed(1) + 'px"></i>' : '') +
              (nw >= 26 ? '<span class="nl">' + (nq + 1) + '</span>' : '') + '</div>';
      }
    }
    // **空の段は出さない**（2026-09-03 の 43。ビナーの盤で「NS 条件」4 行と
    // 「通常 0 発」2 行が空のまま 106px 取っていた）。置けない理由は
    // 上の EX の行の `title` に移してあるので、字は増えない
    if (laneOn('ns') && nb) {
      side += lbl(H.row, mini + '<span class="nm">NS</span>' +
        (p ? '<span class="mb">' +
             (nsn.src === 'na' ? nsn.tc + '発'
              : nsn.src === 'ammo' ? '弾倉'
              : nsn.iv > 0 ? nsn.iv.toFixed(0) + 's' : '1回') +
             '</span>' : ''));
      cv += lane(H.row, nb);
    }

    // 通常攻撃（オートアタック）。**弾倉ごとの塊で描く。**発数は札に出す
    var nab = '', naI = p ? naInfo(p.id) : null, naN = 0;
    if (p && naI) {
      var runs = naRuns(i, dur), hasN = !!(B.dmg[p.id] || {}).Normal || !!altOf(p.id, 'Normal');
      for (var rq = 0; rq < runs.length; rq++) {
        var rn = runs[rq], rw = Math.max(1.5, (Math.min(rn.b, dur) - rn.a) * px);
        naN += rn.n;
        nab += '<div class="b na' + (hasN ? '' : ' flat') + '" style="left:' +
               (rn.a * px).toFixed(1) + 'px;width:' + rw.toFixed(1) + 'px" title="' +
               esc(naI.nm) + '\n' + rn.n + ' 回（' + rn.a.toFixed(1) + '〜' +
               Math.min(rn.b, dur).toFixed(1) + '秒）\n1 回 ' + naI.per.toFixed(2) +
               '秒・弾倉 ' + naI.mag + ' 回・リロード ' + naI.rel.toFixed(2) + '秒' +
               (hasN ? '' : '\nこの生徒の通常攻撃にダメージのデータがありません') + '">' +
               '</div>';
      }
    }
    // **発数は出さない**（2026-09-01 の先生の指示。数はツールチップにある）
    void naN;
    if (laneOn('na') && nab) {
      side += lbl(H.na, '<span class="nm">通常</span>', 'na');
      cv += lane(H.na, nab);
    }
  }
  // SS = サブスキル。**摘みで丸ごと消せるので、編成の全員を出す**
  // （2026-09-03 の先生の指示「SS は表示非表示選べるし、
  //   下にまとめて全キャラ表示させるように」）。
  // 前は「発動して効くもの」を持つ子だけ出していた
  if (laneOn('ss')) {
  side += lbl(H.ss, '<b>SS</b><span class="mb">サブスキル</span>');
  cv += lane(H.ss, '');
  var ssn = 0;
  for (var v2 = 0; v2 < SLOTS; v2++) {
    var vp = st.party[v2];
    if (!vp || !live(v2)) { continue; }
    var cnt = ssCount(v2);
    ssn++;
    var snm = ((B.skname || {})[vp.id] || {}).ExtraPassive || 'サブスキル';
    // **常時ぶんはステータスに乗っている**（`passive.js` の `passiveList`）。
    // **ダメージを持つ SS は 2026-09-03 から数えている**（`ep.js`）。
    // 引き金が判定できない子は `epWhy` がその理由を返す
    var hasD2 = !!((B.dmg[vp.id] || {}).ExtraPassive || []).length;
    var epw = hasD2 ? epWhy(vp.id) : null;
    var sOff = !!cnt[1] || (hasD2 && epw != null);
    side += lbl(H.ss, img(vp.id, 'ic') + '<span class="nm">' + esc(vp.n) + '</span>');
    cv += lane(H.ss,
      '<div class="b ss' + (sOff ? ' off' : '') + '" style="left:0;width:' + W +
      'px" title="' + esc(snm) +
      (cnt[0] ? '\n常時 ' + cnt[0] + ' 件はステータスに乗せています' : '') +
      (hasD2 && !epw ? '\nダメージは通常攻撃に相乗りして数えています' +
        (epEvery(vp.id) > 1 ? '（' + epEvery(vp.id) + ' 発に 1 度）' : '') : '') +
      (hasD2 && epw ? '\nダメージは数えていません：' + epw : '') +
      (cnt[1] ? '\n発動して効くもの ' + cnt[1] + ' 件は、引き金が要るのでまだ数えていません' : '') +
      '">' + esc(snm) + '</div>');
  }
  if (!ssn) {
    side += lbl(H.ss, '<span class="mut">（編成が空です）</span>');
    cv += lane(H.ss, '');
  }
  }

  for (var m = 0; m < st.mk.length; m++) {
    if (st.mk[m].t > dur) { continue; }
    cv += '<div class="mkl" style="left:' + (st.mk[m].t * px).toFixed(1) + 'px"></div>' +
          '<button type="button" class="mkt" data-mk="' + m + '" style="left:' +
          (st.mk[m].t * px).toFixed(1) + 'px" title="' + esc(st.mk[m].n) + '\n' +
          st.mk[m].t.toFixed(2) + '秒（残り ' + mmss(dur, st.mk[m].t) + '）\nクリックで消します">' +
          esc(st.mk[m].n) + '</button>';
  }
  for (var aw = 0; aw < st.bst.length; aw++) {
    var w9 = st.bst[aw];
    if ((w9.k !== 'away' && w9.k !== 'mob') || w9.t0 >= dur) { continue; }
    cv += '<div class="awy' + (w9.k === 'mob' ? ' mob' : '') + '" style="left:' + (w9.t0 * px).toFixed(1) + 'px;width:' +
          Math.max(1, (Math.min(w9.t1, dur) - w9.t0) * px).toFixed(1) + 'px" title="ボスに当たらない区間\n' +
          (+w9.t0).toFixed(1) + '〜' + Math.min(w9.t1, dur).toFixed(1) + '秒"></div>';
  }
  // **倒しきる秒に線を引く**（2026-09-04 の先生の指示
  // 「倒しきった位置がタイムライン上で線でわかるようにしてほしい」）
  var kt9 = killAt(r);
  if (kt9 != null && kt9 <= dur) {
    cv += '<div class="kil" style="left:' + (kt9 * px).toFixed(1) +
          'px" title="倒しきる ' + kt9.toFixed(2) + ' 秒"></div>';
  }
  cv += '<div class="ph" id="ph" style="left:-10px"></div><div class="phbox" id="phbox" hidden></div>';
  $('side').innerHTML = side;
  $('cv').innerHTML = cv;
  $('cv').style.width = W + 'px';

  $('ph-boss').textContent = boss().n + '　' + r.df;
  var pf = '';
  for (var z = 0; z < ph0.hp.length; z++) {
    pf += '<label class="f"><span>フェーズ ' + ph0.hp[z][1] + ' に入る HP</span>' +
          '<input type="text" value="' + ph0.hp[z][0].toLocaleString('ja-JP') + '" readonly ' +
          'style="width:120px"></label>';
  }
  $('phases').innerHTML = pf || '<span class="mut" style="font-size:10px">このボスにはフェーズの切り替わりがありません。</span>';
  tail();
  if (st.pin != null) { movePh(st.pin, true); }
}
// **重い後半は 1 フレームに 1 回だけ**（2026-09-03 の 28。`draw()` が 143.8ms で、
// その 117ms が `kpi` 74.6 と `drawRate` 42.2。行のセレクトを 1 つ動かすたびに
// 全部を引き直していた）。**順番は変えていない**（`kpi` が `ggSolve` を回してから
// `drawUse` が 1 発ぶんのダメージを引く、という並びに意味がある）。
// 立て続けに呼ばれたぶんは 1 回にまとまる
var _tR = 0, _tT = 0;
function tailRun() {
  _tR = 0;
  if (_tT) { clearTimeout(_tT); _tT = 0; }
  drawRate(); drawErr(); kpi(); drawCrit(); drawUse(); drawRows(); drawAlts(); drawView();
}
export function tail() {
  if (_tR || _tT) { return; }
  // rAF が回らない場面（裏のタブ・撮影用のヘッドレス）のために時間でも保険をかける
  _tR = window.requestAnimationFrame(tailRun);
  _tT = setTimeout(tailRun, 60);
}
/** **外から叩くときの `draw`。**待たずに最後まで引く。
    `verify.py` などの道具は `window.__TLDBG.draw()` の直後に画面を読むので、
    ここで待たせると読み取りがずれる */
export function drawNow() {
  draw();
  if (_tR) { window.cancelAnimationFrame(_tR); _tR = 0; }
  tailRun();
}
