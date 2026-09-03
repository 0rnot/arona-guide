import { $ } from './util.js';
import { LAY, MAIN_MAX, SLOTS, _byid, bump, live, mkSlot, st } from './core.js';
import { mark } from './undo.js';
import { draw } from './draw.js';
import { _dft, drawCrew, drawPicker, fillBuild } from './left.js';

// ---- 生徒を選ぶ
export function onFilt() {
  st.filt.q = $('i-find').value.trim();
  st.filt.role = $('i-role').value; st.filt.bul = $('i-bul').value;
  st.filt.arm = $('i-arm').value; st.filt.sch = $('i-sch').value;
  st.filt.sq = $('i-sq').value; st.filt.star = $('i-star').value;
  st.filt.sort = $('i-sort').value;
  drawPicker();
}
// **STRIKER は 0〜5、SPECIAL は 6〜9 にしか入らない。**枠の種類はデータの SquadType
export function addStudent(sd) {
  var lo = sd.sq === 'Support' ? MAIN_MAX : 0, hi = sd.sq === 'Support' ? SLOTS : MAIN_MAX, i;
  for (i = 0; i < SLOTS; i++) {
    if (st.slots[i].id === sd.id) {          // もう入っている → 外す
      mark();
      st.slots[i].id = null;
      for (var q = st.tl.length - 1; q >= 0; q--) { if (st.tl[q].i === i) { st.tl.splice(q, 1); } }
      if (st.who === i) { st.who = -1; }
      bump(); fillBuild(); drawCrew(); drawPicker(); draw();
      return;
    }
  }
  for (i = lo; i < hi; i++) {
    if (live(i) && !st.slots[i].id) {
      mark();
      var keep = st.slots[i];
      st.slots[i] = mkSlot();
      var k;
      for (k in _dft) { if (k !== 'id') { st.slots[i][k] = (k === 'tier' ? _dft[k].slice() : _dft[k]); } }
      st.slots[i].id = sd.id;
      void keep;
      st.who = i; bump(); fillBuild(); drawCrew(); drawPicker(); draw();
      return;
    }
  }
  alert((sd.sq === 'Support' ? 'SPECIAL' : 'STRIKER') + 'の枠が埋まっています（' +
        (sd.sq === 'Support' ? LAY[st.mode].sup : LAY[st.mode].main) + ' 人まで）。');
}

export function wirePicker() {
  (function () {
    var ids = ['i-role', 'i-bul', 'i-arm', 'i-sch', 'i-sq', 'i-star', 'i-sort'];
    for (var i = 0; i < ids.length; i++) { $(ids[i]).addEventListener('change', onFilt); }
    $('i-find').addEventListener('input', onFilt);
  })();
  $('b-more').addEventListener('click', function () {
    st.more = !st.more;
    $('filt2').hidden = !st.more;
    this.setAttribute('aria-pressed', st.more ? 'true' : 'false');
    this.textContent = st.more ? '詳細フィルターを畳む' : '詳細フィルター';
  });
  $('b-reset').addEventListener('click', function () {
    $('i-find').value = '';
    var ids = ['i-role', 'i-bul', 'i-arm', 'i-sch', 'i-sq', 'i-star'];
    for (var i = 0; i < ids.length; i++) { $(ids[i]).value = ''; }
    $('i-sort').value = 'n';
    onFilt();
  });
  $('picker').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-add]');
    if (!b) { return; }
    var sd = _byid[+b.getAttribute('data-add')];
    if (sd) { addStudent(sd); }
  });

}
