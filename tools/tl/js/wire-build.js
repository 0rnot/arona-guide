import { $ } from './util.js';
import { SLOTS, bump, st } from './core.js';
import { mark } from './undo.js';
import { draw } from './draw.js';
import { wlvMax } from './passive.js';
import { drawCrew, fillBuild, whoSlot } from './left.js';

export function onAlt(e) {
  var au = e.target.closest('[data-autoalt]');
  if (au) {
    var qa = au.getAttribute('data-autoalt').split('|'), sa = st.slots[+qa[0]];
    if (sa && sa.pk) { mark(); delete sa.pk[qa[1]]; draw(); }
    return;
  }
  // **バフの段（スタック）**（LOOP.md 55）。倍率の候補とは別の軸なので別に持つ
  var rs = e.target.closest('input[data-stk]');
  if (rs) {
    var qs = rs.getAttribute('data-stk').split('|'), sls = st.slots[+qs[0]];
    if (!sls) { return; }
    mark();
    if (!sls.stk) { sls.stk = {}; }
    sls.stk[qs[1]] = +rs.value;
    bump(); draw();
    return;
  }
  var r = e.target.closest('input[data-alt]');
  if (!r) { return; }
  var q = r.getAttribute('data-alt').split('|'), i = +q[0], kind = q[1];
  mark();
  if (q[2] === 'use') {
    // **その 1 発だけ**（左のパネルは編成ぜんぶの既定）
    var u = st.sel == null ? null : st.tl[st.sel];
    if (!u) { return; }
    if (!u.pk) { u.pk = {}; }
    u.pk[kind] = +r.value;
  } else {
    var sl = st.slots[i];
    if (!sl) { return; }
    if (!sl.pk) { sl.pk = {}; }
    sl.pk[kind] = +r.value;
  }
  bump(); draw();
}

export function wireBuild() {
  // ---- 育成
  $('g-who').addEventListener('change', function () {
    st.who = +this.value; fillBuild(); drawCrew();
  });
  $('alts').addEventListener('input', onAlt);
  $('alts').addEventListener('click', onAlt);
  $('useedit').addEventListener('input', onAlt);
  (function () {
    var KEY = { 'g-lv': 'lv', 'g-star': 'star', 'g-eq': 'eq', 'g-wlv': 'wlv', 'g-wstar': 'wstar',
                'g-ex': 'ex', 'g-sk': 'sk', 'g-plv': 'plv', 'g-sslv': 'sslv',
                'g-gear': 'gear', 'g-bond': 'bond', 'g-pot': 'pot' };
    function bind(id) {
      $(id).addEventListener('change', function () {
        mark();
        var k = KEY[id], v = +this.value, b = whoSlot();
        b[k] = v;
        if (k === 'wstar') { b.w4 = v >= 4; b.wlv = Math.min(b.wlv, wlvMax(v)); }
        // **愛用品でエンジンの段を動かさない**（2026-09-03）。`tier` は
        // `tl-engine.js:310` の「効果ごとに何段目を引くか」で、愛用品の段とは別物。
        // 愛用品を T2 に下げただけでバフの段まで下がっていた
        if (k === 'pot') { b.pot = [v, v, v]; }
        bump(); fillBuild(); drawCrew(); draw();
      });
    }
    for (var id in KEY) { bind(id); }
  })();
  $('b-ball').addEventListener('click', function () {
    var b = whoSlot(), i, k;
    mark();
    for (i = 0; i < SLOTS; i++) {
      if (!st.slots[i].id) { continue; }
      for (k in b) { if (k !== 'id') { st.slots[i][k] = (k === 'tier' ? b[k].slice() : b[k]); } }
    }
    bump(); fillBuild(); drawCrew(); draw();
  });

}
