import { $ } from './util.js';
import { LAY, bump, mkParty, st } from './core.js';
import { mark, usePartyRef } from './undo.js';
import { draw } from './draw.js';
import { drawCrew, drawParty, drawPicker, fillBuild } from './left.js';
import { drawBstate } from './bossui.js';


// ---- 編成の枠
export function crewClick(e) {
  var rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    mark();
    var k = +rm.getAttribute('data-rm');
    st.slots[k].id = null;
    for (var q = st.tl.length - 1; q >= 0; q--) { if (st.tl[q].i === k) { st.tl.splice(q, 1); } }
    if (st.who === k) { st.who = -1; }
    st.sel = null; bump(); fillBuild(); drawCrew(); drawPicker(); draw();
    return;
  }
  var c = e.target.closest('[data-slot]');
  if (!c) { return; }
  var i = +c.getAttribute('data-slot');
  if (st.party[i]) { st.who = i; fillBuild(); drawCrew(); }
}

export function wireParty() {
  // ---- パーティーと編成モード
  $('ptabs').addEventListener('change', function (e) {
    if (e.target.id !== 'p-end') { return; }
    mark();
    var v = e.target.value === '' ? null : +e.target.value;
    st.parties[st.pi].end = (v == null || !isFinite(v)) ? null : Math.max(0, v);
    bump(); draw();
  });
  $('ptabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pt]');
    if (!b) { return; }
    st.pi = +b.getAttribute('data-pt'); usePartyRef(); st.sel = null; st.who = -1; bump();
    fillBuild(); drawParty(); drawBstate(); drawCrew(); drawPicker(); draw();
  });
  $('b-addparty').addEventListener('click', function () {
    if (st.parties.length >= 4) { return; }
    mark();
    st.parties.push(mkParty()); st.pi = st.parties.length - 1;
    usePartyRef(); st.sel = null; st.who = -1; bump();
    fillBuild(); drawParty(); drawBstate(); drawCrew(); drawPicker(); draw();
  });
  $('modeseg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) { return; }
    mark();
    st.mode = +b.getAttribute('data-mode'); bump();
    fillBuild(); drawParty(); drawCrew(); drawPicker(); draw();
  });
  $('crew-all').addEventListener('click', crewClick);
  $('crew-all').addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-sk2]');
    if (!sel) { return; }
    mark();
    var i = +sel.getAttribute('data-sk2'), v = sel.value === '' ? null : +sel.value - 1, q;
    var n = LAY[st.mode].start;
    while (st.start.length < n) { st.start.push(null); }
    // **同じ子を 2 か所に置かない。**先にどこからでも外す
    for (q = 0; q < st.start.length; q++) { if (st.start[q] === i) { st.start[q] = null; } }
    if (v != null) { st.start[v] = i; }
    drawCrew(); draw();
  });

}
