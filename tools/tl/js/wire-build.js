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
        if (k === 'gear') { b.tier = [v, v, v, v, v, v]; }
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
