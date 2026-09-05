import { B } from './util.js';
import { MAIN_MAX, SLOTS, _byid, bump, mkParty, st } from './core.js';
import { mark, usePartyRef } from './undo.js';
import { boss, diff, resetDiffCache } from './boss.js';
import { draw } from './draw.js';
import { drawCrew, drawParty, drawPicker, fillBuild } from './left.js';
import { fillBoss } from './bossui.js';

// ------------------------------------------------------------ 書き出し・読み込み
export function snapshot() {
  return { v: 2, boss: boss().id, grp: boss().g, diff: diff().df, arm: st.arm,
           mode: st.mode, pi: st.pi, bst: st.bst,
           // **当たる先（`tg`）は `sub` の添字なので、部位の並びが変わると別の体を
           // 指してしまう**（2026-09-05。大きなペロロミニオンの行をまとめたら、
           // 先生の TL の `tg: 1` が小さなペロロミニオンを指した）。
           // 書き出したときの並びの id を添えて、読むときに id で引き直す
           subs: (diff().sub || []).map(function (s) { return s.id; }),
           parties: st.parties, mk: st.mk, goal: st.goal };
}
/** 書き出したときの `sub` の並び（id）で、`tg` を今の並びに引き直す。
    並びが無い古い書き出しはそのまま。**id が今の並びに無ければ、その体より
    小さくていちばん近い代表**へ寄せる（`board.js` の `subIxOfCid` と同じ考え） */
function remapTg(tg, subs) {
  if (tg == null) { return null; }
  tg = +tg;
  if (!subs || !subs.length || tg < 0 || tg >= subs.length) { return tg; }
  var id = subs[tg], now = diff().sub || [], i, best = -1;
  for (i = 0; i < now.length; i++) { if (now[i].id === id) { return i; } }
  for (i = 0; i < now.length; i++) {
    if (!now[i].cnt || now[i].id > id) { continue; }
    if (best < 0 || now[i].id > now[best].id) { best = i; }
  }
  return best < 0 ? tg : best;
}
export function restore(o) {
  if (!o || (o.v !== 1 && o.v !== 2)) { throw new Error('形式が違います（v:1 か v:2 ではありません）'); }
  var bi = -1, di = -1, i, k;
  for (i = 0; i < B.bosses.length; i++) {
    if (o.grp ? B.bosses[i].g === o.grp : B.bosses[i].id === o.boss) { bi = i; }
  }
  if (bi < 0 && o.grp) {
    for (i = 0; i < B.bosses.length; i++) { if (B.bosses[i].id === o.boss) { bi = i; } }
  }
  if (bi < 0) { throw new Error('知らないボスです: ' + o.boss); }
  for (k = 0; k < B.bosses[bi].d.length; k++) { if (B.bosses[bi].d[k].df === o.diff) { di = k; } }
  if (di < 0) { throw new Error('知らない難易度です: ' + o.diff); }
  mark();
  st.bi = bi; st.di = di; resetDiffCache();
  st.arm = (o.arm && (B.bosses[bi].d[di].arm || []).indexOf(o.arm) >= 0) ? o.arm : null;
  if (o.v === 2) {
    st.mode = o.mode === 10 ? 10 : 6;
    st.parties = [];
    for (i = 0; i < (o.parties || []).length && i < 4; i++) {
      var src = o.parties[i], np = mkParty(), q;
      for (q = 0; q < SLOTS && q < (src.slots || []).length; q++) {
        var a = src.slots[q], b = np.slots[q], key;
        for (key in b) { if (a[key] != null) { b[key] = a[key]; } }
        if (b.id != null && !_byid[b.id]) { b.id = null; }
      }
      for (q = 0; q < (src.tl || []).length; q++) {
        var u = src.tl[q];
        if (u && isFinite(u.t) && u.i >= 0 && u.i < SLOTS) {
          np.tl.push({ i: +u.i, t: +u.t, to: u.to == null ? null : +u.to,
                       ov: u.ov == null ? null : +u.ov, f: u.f == null ? null : +u.f,
                       bt: u.bt == null ? null : +u.bt,
                       // **渡し先は 1 人とは限らない**（イブキ（水着）は 2 人）。
                       // 指定の仕方（秒・コスト・最速）も持ち越す
                       bto: u.bto == null ? null : u.bto,
                       md: u.md || 't', cv: u.cv == null ? null : +u.cv,
                       // **当たる先・当たる数・貫通と、その 1 発だけ外した窓**も
                       // 持ち越す（2026-09-03。書き出しには入っていたのに読めていなかった）
                       tg: remapTg(u.tg, o.subs),
                       mc: u.mc == null ? null : +u.mc,
                       hb: u.hb ? 1 : 0,
                       gx: (u.gx && u.gx.length) ? u.gx.slice() : null,
                       // **盤で置いた位置**（2026-09-04）。読めていないと、
                       // 書き出して読み直したときにドラッグした結果が消える
                       ax: (u.ax == null || !isFinite(u.ax)) ? undefined : +u.ax,
                       ay: (u.ay == null || !isFinite(u.ay)) ? undefined : +u.ay,
                       bp: (u.bp && typeof u.bp === 'object') ? u.bp : undefined,
                       bk: (typeof u.bk === 'string' && u.bk) ? u.bk : undefined,
                       pk: u.pk || undefined });
        }
      }
      for (q = 0; q < (src.start || []).length; q++) { np.start.push(src.start[q]); }
      for (q = 0; q < (src.bst || []).length; q++) {
        var wb = src.bst[q];
        if (wb && isFinite(wb.t0) && isFinite(wb.t1)) {
          // `n` はチップから置いたギミックの名前（2026-09-03）
          np.bst.push({ t0: +wb.t0, t1: +wb.t1, k: String(wb.k || 'damaged'),
                        v: +wb.v || 0, n: wb.n ? String(wb.n) : undefined,
                        a: wb.a ? 1 : undefined });
        }
      }
      np.gu = !!src.gu;
      np.end = (src.end != null && isFinite(src.end)) ? +src.end : null;
      st.parties.push(np);
    }
    if (!st.parties.length) { st.parties = [mkParty()]; }
    st.pi = Math.min(o.pi || 0, st.parties.length - 1);
  } else {
    // **v1（枠 6 つ・育成ひとまとめ）を読む。**STRIKER 4 ＋ SPECIAL 2 に割り直す
    st.mode = 6; st.parties = [mkParty()]; st.pi = 0;
    var bd = o.build || {}, m = 0, sp2 = MAIN_MAX;
    for (i = 0; i < (o.party || []).length; i++) {
      var sd = o.party[i] == null ? null : _byid[o.party[i]];
      if (!sd) { continue; }
      var at = sd.sq === 'Support' ? sp2++ : m++;
      if (at >= SLOTS) { continue; }
      var sl = st.parties[0].slots[at];
      sl.id = sd.id;
      if (isFinite(bd.lv)) { sl.lv = +bd.lv; }
      if (isFinite(bd.star)) { sl.star = +bd.star; }
      if (bd.eq && bd.eq.length) { sl.eq = +bd.eq[0]; }
      if (isFinite(bd.wlv)) { sl.wlv = +bd.wlv; }
      if (isFinite(bd.wstar)) { sl.wstar = +bd.wstar; }
      if (isFinite(bd.slv)) { sl.ex = +bd.slv; }
      if (isFinite(bd.pLv)) { sl.plv = +bd.pLv; }
      if (typeof bd.gear === 'boolean') { sl.gear = bd.gear ? 2 : 0; }
      if (isFinite(bd.bond)) { sl.bond = +bd.bond; }
    }
  }
  st.mk = [];
  for (i = 0; i < (o.mk || []).length; i++) {
    var mk2 = o.mk[i];
    if (mk2 && isFinite(mk2.t)) { st.mk.push({ t: +mk2.t, n: String(mk2.n || '') }); }
  }
  st.goal = (o.goal && isFinite(o.goal.dmg)) ? { dmg: +o.goal.dmg, sec: +o.goal.sec } : null;
  // 古い保存（窓が最上位にある）は 1 部隊目の窓として読む
  if (!st.parties[0].bst.length) {
    for (i = 0; i < (o.bst || []).length; i++) {
      var w2 = o.bst[i];
      if (w2 && isFinite(w2.t0) && isFinite(w2.t1)) {
        st.parties[0].bst.push({ t0: +w2.t0, t1: +w2.t1, k: String(w2.k || 'damaged'),
                                 v: +w2.v || 0, n: w2.n ? String(w2.n) : undefined,
                                 a: w2.a ? 1 : undefined });
      }
    }
  }
  st.sel = null; usePartyRef(); bump();
  fillBoss(); fillBuild(); drawParty(); drawCrew(); drawPicker(); draw();
}
export function sheet(title, text, onOK) {
  var w = document.createElement('div');
  w.className = 'sheet';
  w.innerHTML = '<div class="card"><h3></h3><textarea spellcheck="false"></textarea>' +
    '<div class="row"><button type="button" class="btn2" data-x="ok"></button>' +
    '<button type="button" class="btn2" data-x="no">閉じる</button>' +
    '<span class="msg mut"></span></div></div>';
  w.querySelector('h3').textContent = title;
  var ta = w.querySelector('textarea'), ok = w.querySelector('[data-x="ok"]');
  ta.value = text;
  ok.textContent = onOK ? '読み込む' : 'コピー';
  function close() { document.body.removeChild(w); }
  w.addEventListener('click', function (e) {
    if (e.target === w || e.target.getAttribute('data-x') === 'no') { close(); return; }
    if (e.target !== ok) { return; }
    if (!onOK) {
      ta.select();
      try { document.execCommand('copy'); w.querySelector('.msg').textContent = 'コピーしました'; }
      catch (err) { w.querySelector('.msg').textContent = '手で選んでコピーしてください'; }
      return;
    }
    try { onOK(JSON.parse(ta.value)); close(); }
    catch (err) { w.querySelector('.msg').textContent = String(err.message || err); }
  });
  document.body.appendChild(w);
  if (onOK) { ta.focus(); } else { ta.select(); }
}

