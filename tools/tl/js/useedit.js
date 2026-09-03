import { $, B, esc } from './util.js';
import { SLOTS, TE, isMain, live, st } from './core.js';
import { boss, crewCount, diff } from './boss.js';
import { sim, whyOf } from './engine.js';
import { n0 } from './rate.js';
import { exKind, statAmt, statJA } from './buff.js';
import { aimOf, liveBuffs, tgtN, tgtOf, toList } from './target.js';
import { altOf, altScale, lvlOf, pickOf } from './alt.js';
import { dmgOf, nbOf } from './dmg.js';
import { ROWS } from './rows.js';
import { bstName } from './bossui.js';

// ---- 選んだ EX 1 発の設定（誰に渡すか・どの形態か）
export function drawUse() {
  var u = st.sel == null ? null : st.tl[st.sel];
  if (!u || !st.party[u.i]) { $('usepane').hidden = true; return; }
  var d = st.party[u.i], sm = sim(), er = null, i;
  for (i = 0; i < sm.rows.length; i++) {
    if (sm.rows[i].e && sm.rows[i].e._ix === st.sel) { er = sm.rows[i]; }
  }
  function memOpts(cur, only, skip) {
    var h = '<option value="">—</option>', k;
    for (k = 0; k < SLOTS; k++) {
      if (!live(k) || !st.party[k]) { continue; }
      if (only === 'main' && !isMain(k)) { continue; }
      if (skip != null && k === skip) { continue; }
      if (only === 'other' && k === u.i) { continue; }
      h += '<option value="' + k + '"' + (String(cur) === String(k) ? ' selected' : '') + '>' +
           esc(st.party[k].n) + '</option>';
    }
    return h;
  }
  var h2 = '<h2 class="sect inline"><i></i>' + esc(d.n) + ' の ' +
    (er && er.sk ? esc(er.sk.n) : esc(d.en || 'EX')) + '</h2>';
  // **数字だけ出す。**説明の言い回しは全部やめた（2026-09-03 の先生の指示
  // 「そういうのがあるたびに画面の文字が増えて認知負荷が高くなる」）
  h2 += '<span class="mut tiny" title="置いた秒／コスト／演出の秒' +
    (er && er.at != null && Math.abs(er.at - u.t) > 0.01 ? '／実際に出る秒' : '') + '">' +
    u.t.toFixed(2) + '　◇' + (er ? Math.round(er.need * 10) / 10 : '—') +
    '　▭' + (((er && er.sk ? er.sk.d : d.d) || 0) / B.fps).toFixed(2) +
    (er && er.at != null && Math.abs(er.at - u.t) > 0.01
      ? '　\u2192 ' + er.at.toFixed(2) : '') + '</span>';
  // **撃つタイミング。**秒・コスト・最短の 3 通り（2026-09-01 の先生の指示）。
  // 「入力」を開いているときは行のほうに同じものが出ているので、ここには出さない
  var md = u.md || 't';
  if (!ROWS) {
    h2 += '<label class="f"><span>撃つタイミング</span><select data-us="md">' +
      '<option value="t"' + (md === 't' ? ' selected' : '') + '>秒で指定</option>' +
      '<option value="c"' + (md === 'c' ? ' selected' : '') + '>コストで指定</option>' +
      '<option value="e"' + (md === 'e' ? ' selected' : '') + '>最短</option>' +
      '</select></label>';
    if (md === 't') {
      h2 += '<label class="f"><span>秒</span><input type="number" data-us="t" step="0.1" min="0" ' +
        'value="' + u.t.toFixed(2) + '" style="width:72px"></label>';
    } else if (md === 'c') {
      h2 += '<label class="f"><span>コスト</span><input type="number" data-us="cv" step="0.5" ' +
        'min="0" value="' + (u.cv == null ? 10 : u.cv) + '" style="width:72px"></label>' +
        '<span class="mut tiny' + (u._rt == null ? ' warn' : '') + '">' +
        (u._rt == null ? '\u2014' : u._rt.toFixed(2)) + '</span>';
    }
  }
  var fl = TE.forms(d);
  if (fl.length > 1) {
    var fh = '<option value="">自動（' + esc(fl[er ? er.auto : 0].n) + '）</option>';
    for (i = 0; i < fl.length; i++) {
      fh += '<option value="' + i + '"' + (String(u.f) === String(i) ? ' selected' : '') + '>' +
            (i + 1) + '. ' + esc(fl[i].n) + '（' + (fl[i].c ? fl[i].c[4] : 0) + '）</option>';
    }
    h2 += '<label class="f"><span>形態</span><select data-us="f">' + fh + '</select></label>';
  }
  // **当たる先。**ボスに部位があるときだけ出す（ホドの柱、ホバークラフトの
  // ミサイル誘導装置、ヒエロニムスの聖遺物…）。部位に当てたぶんは
  // ボスの HP から引かない
  var subs = (diff().sub || []);
  if (subs.length) {
    var th = '<option value="">' + esc(boss().n) + '（本体）</option>', ti;
    for (ti = 0; ti < subs.length; ti++) {
      th += '<option value="' + ti + '"' + (String(u.tg) === String(ti) ? ' selected' : '') +
            (subs[ti].trw ? ' title="' + esc(subs[ti].trw) + '"' : '') +
            '>' + esc(subs[ti].n) + '（HP ' + n0(subs[ti].hp) +
            (subs[ti].tr ? '・ボスへ転移 ' + subs[ti].tr + '%' : '') + '）</option>';
    }
    h2 += '<label class="f"><span>当たる先</span><select data-us="tg">' + th + '</select></label>';
    // **転移する部位のときだけ「当たる数」を出す。**範囲攻撃が何体に当たったかで
    // ボスへ入る量が変わる（聖歌隊 5 体・ペロロミニオン…）
    // **転移する部位と、HP を共有する池の体。**どちらも範囲攻撃が
    // 何体に当たったかで入る量が変わる（2026-09-03）
    var shr = 0, zq;
    if (u.tg != null && (subs[u.tg] || {}).pool) {
      for (zq = 0; zq < subs.length; zq++) {
        if (subs[zq].pool === subs[u.tg].pool) { shr++; }
      }
    }
    if (u.tg != null && ((subs[u.tg] || {}).tr || shr > 1)) {
      h2 += '<label class="f"><span>当たる数</span><input type="number" data-us="mc" ' +
        'min="1" max="99" step="1" style="width:64px" value="' + (u.mc == null ? 1 : u.mc) +
        '"></label>';
      // **直線に伸びる攻撃は部位を貫いて本体にも当たる。**当たるかは盤の上の話
      if ((subs[u.tg] || {}).tr) {
        h2 += '<label class="f"><span>ボス本体にも</span><select data-us="hb">' +
          '<option value="0"' + (u.hb ? '' : ' selected') + '>当たらない</option>' +
          '<option value="1"' + (u.hb ? ' selected' : '') + '>当たる</option></select></label>';
      }
    }
  }
  // **乗っているギミック**（2026-09-03）。この 1 発の時刻に重なっている窓は
  // 自動で☑。外すと **その 1 発だけ** 効かない（`u.gx` に窓の番号が入る）。
  // グロッキーは会心の解き直しに関わるので、ここでは外せない
  var at9 = (er && er.at != null) ? er.at : u.t, gxh = '', gi9, gxs = u.gx || [];
  for (gi9 = 0; gi9 < (st.bst || []).length; gi9++) {
    var w9 = st.bst[gi9];
    if (w9.k === 'groggy') { continue; }
    if (at9 < w9.t0 - 1e-9 || at9 >= w9.t1) { continue; }
    gxh += '<label class="gxl"><input type="checkbox" data-us="gx" data-w="' + gi9 + '"' +
      (gxs.indexOf(gi9) >= 0 ? '' : ' checked') + '>' + esc(bstName(w9)) + '</label>';
  }
  if (gxh) {
    h2 += '<label class="f"><span>乗っているギミック</span><span class="two2">' +
      gxh + '</span></label>';
  }
  if (er && er.grant) {
    h2 += '<label class="f"><span>コスト' + (er.grant.vt === 'coef' ? '減少' : '増加') +
      'カードを渡す</span><select data-us="to"' +
      (er.grant.sd === 'self' ? ' disabled' : '') + '>' +
      (er.grant.sd === 'self' ? '<option>自分</option>' : memOpts(u.to)) + '</select></label>';
  }
  if (TE.ovlMs(d)) {
    h2 += '<label class="f"><span>オーバーコストを渡す</span><select data-us="ov">' +
          memOpts(u.ov) + '</select></label>';
  }
  if (d.sp && d.sp.copy) {
    h2 += '<label class="f"><span>カードを複製する相手</span><select data-us="bt">' +
          memOpts(u.bt, 'main') + '</select></label>';
  }
  // **「味方1人」のバフは渡し先を選ばないと誰にも乗らない**（2026-09-01）
  // **「入力」を開いているときは行のほうで決める**（2026-09-03。二重をやめた）
  var bk = exKind(er ? er.fi : 0), nB = ROWS ? 0 : tgtN(d.id, bk);
  if (nB >= 1 && nB < crewCount()) {
    var ex1 = (tgtOf(d.id, bk) || [])[1], curB = toList(u.bto), nb2, sB = '';
    for (nb2 = 0; nb2 < nB; nb2++) {
      sB += '<select data-us="bto" data-slot="' + nb2 + '">' +
            memOpts(curB[nb2] == null ? null : curB[nb2], null, ex1 ? u.i : -1) + '</select>';
    }
    // **選んでいないことは赤い枠で示す**（言葉の注釈は足さない。2026-09-03）
    h2 += '<label class="f' + (nB === 1 && !curB.length ? ' need' : '') +
          '"><span>バフを渡す相手' + (nB > 1 ? '（' + nB + '）' : '') +
          '</span><span class="two2">' + sB + '</span></label>';
  }
  if (er) {
    var dk = exKind(er.fi),
        dd = dmgOf(u.i, diff(), er.at, dk, u.pk, null, u.gx, null, null, nbOf(u));
    h2 += '<span class="mut tiny" title="平均ダメージ（最小〜最大・会心率）">' +
      (dd ? '<b>' + n0(dd.avg) + '</b>　' + n0(dd.min) + '\u301c' + n0(dd.max) +
            '　\u25c8' + (dd.crit * 100).toFixed(1) + '%'
          : '\u2014') + '</span>';
  }
  if (er) {
    // **「N人以下／N人以上」は当たる数で決まる**（2026-09-04）。摘みは出さず、
    // 決まった候補だけを出す（`altOf` が `fixed` を立てて 1 本に絞る）
    var ak = exKind(er.fi), atb = aimOf(diff(), u.tg), aa = altOf(d.id, ak, atb, nbOf(u));
    if (aa && aa.fixed) {
      h2 += '<span class="mut tiny" title="当たる数 ' + nbOf(u) +
        ' で決まります（スキル文が敵の数で倍率を分けているため、選べません）">倍率 ' +
        esc(aa.c[0] || '') + '　' +
        ((altScale(d.id, ak, 0, lvlOf(u.i, ak), atb) || 0) / 100).toFixed(0) + '%</span>';
    } else if (aa && aa.v.length > 1) {
      var apk = pickOf(u.i, ak, u.pk, atb),
          asc = altScale(d.id, ak, apk, lvlOf(u.i, ak), atb);
      h2 += '<label class="f" title="' + esc(aa.c[apk] || '') + '"><span>倍率の幅</span>' +
        '<input type="range" min="0" max="' + (aa.v.length - 1) + '" value="' + apk +
        '" data-alt="' + u.i + '|' + ak + '|use" style="width:110px">' +
        '<b style="margin-left:5px">' + (asc == null ? '—' : (asc / 100).toFixed(0) + '%') +
        '</b><span class="mut" style="margin-left:4px">' + (apk + 1) + '/' + aa.v.length +
        '</span></label>';
    }
  }
  var bfs = (er && er.sk && er.sk.bf) || d.bf || [];
  if (bfs.length) {
    var names = [];
    for (i = 0; i < bfs.length; i++) {
      names.push(bfs[i].n + '（' + (bfs[i].sd === 'self' ? '自分' :
        (bfs[i].sd === 'ally' ? '味方' : '敵')) + '・' +
        Math.round((bfs[i].du || 0) / 1000) + '秒）');
    }
    h2 += '<span class="mut tiny" title="このスキルの効果">' +
      esc(names.join('　')) + '</span>';
  }
  // **その 1 発に、誰のバフが乗っているか。**先生の指示（2026-09-01）
  if (er && er.at != null) {
    var lb = liveBuffs(er.at, 'ally' + u.i, diff()), bn = [], seenb = {};
    for (i = 0; i < lb.length; i++) {
      var z = lb[i];
      if (z.from === u.i && z.kind === bk) { continue; }
      var who = z.from == null ? '育成' : ((st.party[z.from] || {}).n || '?');
      var key = who + '/' + z.stat;
      if (seenb[key]) { continue; }
      seenb[key] = 1;
      bn.push(who + ' の ' + statJA(z.stat) + ' ' + statAmt(z.stat, z.v));
    }
    if (bn.length) {
      h2 += '<span class="mut tiny" title="この 1 発に乗っているバフ">' +
        esc(bn.join('　')) + '</span>';
    }
  }
  if (er && er.why) { h2 += '<span class="warn tiny">⚠ ' + esc(whyOf(er)) + '</span>'; }
  // 「入力」の行には ✕ があるので、ここには置かない（2026-09-03）
  if (!ROWS) {
    h2 += '<span style="flex:1 1 auto"></span>' +
      '<button type="button" class="btn2" data-act="delsel">この 1 発を消す</button>';
  }
  $('useedit').innerHTML = h2;
  // **TL 表を開いている間は、同じ中身を行の下に出す**（2026-09-03）。
  // 上下に 2 つ並べても情報が増えないので、片方だけ見せる
  $('usepane').hidden = ROWS;
}
