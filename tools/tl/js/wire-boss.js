import { $ } from './util.js';
import { st } from './core.js';
import { boss, diff, resetDiffCache, tormentIdx } from './boss.js';
import { draw } from './draw.js';
import { drawRate } from './rate.js';
import { fit } from './zoom.js';
import { bstPut, fillBoss, npcChips } from './bossui.js';

export function syncTabs() {
  var bs = document.querySelectorAll('#rtabs .t');
  for (var i = 0; i < bs.length; i++) {
    bs[i].className = 't' + (+bs[i].getAttribute('data-tab') === st.tab ? ' on' : '');
  }
}

export function wireBoss() {
  $('rtabs').addEventListener('click', function (e) {
    var b = e.target.closest('.t');
    if (!b) { return; }
    st.tab = +b.getAttribute('data-tab'); syncTabs(); drawRate();
  });
  window.addEventListener('load', fit);
  setTimeout(fit, 60);

  $('i-boss').addEventListener('change', function () {
    st.bi = +this.value; st.di = tormentIdx(boss()); st.arm = null; fillBoss(); fit();
  });
  // チップから窓を置く。**説明文に秒があればその長さ**、無ければ戦闘の終わりまで
  $('bst-chips').addEventListener('click', function (e) {
    var el = e.target.closest('[data-gim],[data-gimk],[data-npc]');
    if (!el) { return; }
    var kk = el.getAttribute('data-gimk');
    if (kk) { bstPut({ k: kk, v: 0 }); return; }
    // 敵側の効果（`DB/LogicEffect_NPC.json`）から置く窓。名乗りはスキル名
    var np = el.getAttribute('data-npc');
    if (np != null) {
      var q = npcChips(diff())[+np];
      if (!q) { return; }
      bstPut({ k: 'damaged', v: q.pc, n: (q.sk && q.sk.length) ? q.sk[0] : q.g, d: q.d });
      return;
    }
    var g = (diff().gim || [])[+el.getAttribute('data-gim')];
    if (!g) { return; }
    bstPut({ k: g.k === 'def' ? 'defAbs' : g.k, v: g.v, n: g.n, d: g.d });
  });
  $('i-armor').addEventListener('change', function () {
    st.arm = this.value || null; resetDiffCache(); fillBoss(); draw();
  });
  $('i-diff').addEventListener('change', function () { st.di = +this.value; fillBoss(); draw(); });
  $('i-phase').addEventListener('change', function () {
    st.phFix = this.value === '' ? null : +this.value; draw();
  });
}
